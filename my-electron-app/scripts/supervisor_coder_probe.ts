#!/usr/bin/env -S node -r ts-node/register
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { FeatureWorker } from "../src/main/agent/featureWorker";

type SignatureArg = { key: string; type: string; required?: boolean; default?: unknown };
type SignatureEntry = { functionName: string; args: SignatureArg[] };

type Plan = {
  collection_name: string;
  collection_key?: string;
  screening: boolean;
  coding_mode: "open" | "targeted";
  rq_scope: number[];
  target_codes: string[];
  min_relevance: number;
  research_questions: string[];
  context: string;
  inclusion_criteria: string[];
  exclusion_criteria: string[];
  source: "llm" | "fallback";
};

const dbg = (fn: string, msg: string) => console.debug(`[supervisor_coder_probe.ts][${fn}][debug] ${msg}`);

function clean(v: unknown): string {
  return String(v || "").trim();
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function loadDotEnv(repoRoot: string): void {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

function parseQuestions(text: string): string[] {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const numbered = lines
    .map((line) => {
      const m = line.match(/^\s*(\d+)[\)\].:\-]\s*(.+)$/);
      return m ? clean(m[2]) : "";
    })
    .filter(Boolean);
  if (numbered.length >= 3) return numbered.slice(0, 5);
  return [];
}

function fallbackQuestions(query: string): string[] {
  const topic = clean(query.match(/about\s+(.+?)(?:[.?!]|$)/i)?.[1] || "the selected topic");
  return [
    `How is ${topic} defined across sources?`,
    `Which frameworks and models are used for ${topic}?`,
    `What evidence supports claims about ${topic}?`
  ];
}

function fallbackPlan(input: {
  query: string;
  collectionName: string;
  collectionKey: string;
  screening: boolean;
}): Plan {
  const q = clean(input.query);
  const targeted = /\btarget(?:ed)?\b/i.test(q);
  const rqs = parseQuestions(q);
  return {
    collection_name: input.collectionName,
    collection_key: input.collectionKey || "",
    screening: input.screening,
    coding_mode: targeted ? "targeted" : "open",
    rq_scope: [],
    target_codes: [],
    min_relevance: targeted ? 4 : 3,
    research_questions: rqs.length >= 3 ? rqs.slice(0, 5) : fallbackQuestions(q),
    context: "",
    inclusion_criteria: [
      "Directly addresses at least one research question.",
      "Contains explicit framework/model/method details.",
      "Provides analyzable evidence."
    ],
    exclusion_criteria: [
      "Out of scope for the research questions.",
      "No substantive evidence or methodological detail.",
      "Duplicate or insufficiently documented source."
    ],
    source: "fallback"
  };
}

async function llmPlan(input: {
  query: string;
  collectionName: string;
  collectionKey: string;
}): Promise<Plan | null> {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return null;
  const baseUrl = clean(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["is_coding_request", "research_questions", "screening"],
    properties: {
      is_coding_request: { type: "boolean" },
      research_questions: { type: "array", minItems: 0, maxItems: 5, items: { type: "string" } },
      screening: { type: "boolean" },
      context: { type: "string" },
      coding_mode: { type: "string", enum: ["open", "targeted"] },
      rq_scope: { type: "array", minItems: 0, maxItems: 5, items: { type: "number" } },
      target_codes: { type: "array", minItems: 0, maxItems: 12, items: { type: "string" } },
      min_relevance: { type: "number", minimum: 1, maximum: 5 }
    }
  };
  const body = {
    model: clean(process.env.INTENT_LLM_MODEL || "gpt-5-mini"),
    messages: [
      {
        role: "system",
        content:
          "You are a supervisor agent for coding workflows. Extract coding intent, produce 3-5 research questions, and screening flag."
      },
      {
        role: "user",
        content: JSON.stringify({
          text: input.query,
          selected_collection_name: input.collectionName,
          selected_collection_key: input.collectionKey
        })
      }
    ],
    tools: [{ type: "function", function: { name: "resolve_coding_intent", description: "Resolve coding intent.", parameters: schema, strict: true } }],
    tool_choice: { type: "function", function: { name: "resolve_coding_intent" } }
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) return null;
  const raw = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const argsText =
    parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
    parsed?.choices?.[0]?.message?.function_call?.arguments ||
    "";
  if (!clean(argsText)) return null;
  let args: any = null;
  try {
    args = JSON.parse(argsText);
  } catch {
    return null;
  }
  const qs = Array.isArray(args?.research_questions) ? args.research_questions.map((x: unknown) => clean(x)).filter(Boolean).slice(0, 5) : [];
  if (qs.length < 3) return null;
  return {
    collection_name: input.collectionName,
    collection_key: input.collectionKey || "",
    screening: args?.screening === true,
    coding_mode: String(args?.coding_mode || "open").toLowerCase() === "targeted" ? "targeted" : "open",
    rq_scope: Array.isArray(args?.rq_scope) ? args.rq_scope.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0).map((n: number) => Math.trunc(n)).slice(0, 5) : [],
    target_codes: Array.isArray(args?.target_codes) ? args.target_codes.map((x: unknown) => clean(x).toLowerCase()).filter(Boolean).slice(0, 12) : [],
    min_relevance: Number.isFinite(Number(args?.min_relevance))
      ? Math.max(1, Math.min(5, Math.trunc(Number(args.min_relevance))))
      : (String(args?.coding_mode || "open").toLowerCase() === "targeted" ? 4 : 3),
    research_questions: qs,
    context: clean(args?.context || ""),
    inclusion_criteria: [],
    exclusion_criteria: [],
    source: "llm"
  };
}

function loadSignatures(repoRoot: string): Record<string, SignatureEntry> {
  const scriptPath = path.join(repoRoot, "src", "main", "py", "get_zotero_signatures.py");
  const out = execFileSync("python3", [scriptPath], { cwd: repoRoot, encoding: "utf-8" });
  const parsed = JSON.parse(out || "{}");
  if (parsed?.status !== "ok" || !parsed?.signatures) throw new Error("Could not load signatures.");
  return parsed.signatures as Record<string, SignatureEntry>;
}

function refineCodebook(repoRoot: string, dirBase: string, plan: Plan): string {
  const folder = String(plan.collection_name || plan.collection_key || "collection")
    .trim()
    .replace(/[\\\/]/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const runDir = path.resolve(dirBase, folder || "collection");
  fs.mkdirSync(runDir, { recursive: true });
  const codebookPath = path.join(runDir, "codebook.md");
  const body = [
    "# Refined Codebook",
    "",
    `- Collection: ${plan.collection_name || plan.collection_key}`,
    `- Coding mode: ${plan.coding_mode}`,
    `- Screening: ${plan.screening ? "enabled" : "disabled"}`,
    `- Min relevance: ${plan.min_relevance}`,
    "",
    "## Research Questions",
    ...plan.research_questions.map((q, i) => `${i + 1}. ${q}`),
    "",
    "## Inclusion Criteria",
    ...(plan.inclusion_criteria.length ? plan.inclusion_criteria.map((x) => `- ${x}`) : ["- Directly addresses at least one research question."]),
    "",
    "## Exclusion Criteria",
    ...(plan.exclusion_criteria.length ? plan.exclusion_criteria.map((x) => `- ${x}`) : ["- Out of scope for the selected questions."]),
    "",
    "## Context",
    plan.context || "No additional context."
  ].join("\n");
  fs.writeFileSync(codebookPath, body, "utf-8");
  return codebookPath;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, "..");
  loadDotEnv(repoRoot);
  const args = parseArgs(process.argv.slice(2));
  const collectionName = clean(args["collection-name"] || args["collection"] || "");
  const collectionKey = clean(args["collection-key"] || "");
  const query = clean(args.query || args.text || "supervisor coding on frameworks and models concerning cyber attribution");
  const dirBase = clean(args["dir-base"] || process.env.ZOTERO_ANALYSE_DIR || path.join(process.env.HOME || "", "annotarium", "analyse", "frameworks"));
  const screening = clean(args.screening).toLowerCase() === "true" || /\bscreen|eligibility|inclusion|exclusion\b/i.test(query);
  if (!collectionName && !collectionKey) throw new Error("Provide --collection-name or --collection-key.");

  const signatures = loadSignatures(repoRoot);
  const eligibilitySig = signatures["set_eligibility_criteria"];
  const verbatimSig = signatures["Verbatim_Evidence_Coding"];
  if (!verbatimSig) throw new Error("Verbatim_Evidence_Coding signature missing.");

  dbg("main", "building supervisor plan");
  const plan =
    (await llmPlan({ query, collectionName, collectionKey })) ||
    fallbackPlan({ query, collectionName, collectionKey, screening });
  if (!plan.inclusion_criteria.length) {
    plan.inclusion_criteria = [
      "Directly addresses at least one research question.",
      "Contains explicit framework/model/method details.",
      "Provides analyzable evidence."
    ];
  }
  if (!plan.exclusion_criteria.length) {
    plan.exclusion_criteria = [
      "Out of scope for the research questions.",
      "No substantive evidence or methodological detail.",
      "Duplicate or insufficiently documented source."
    ];
  }

  const codebookPath = refineCodebook(repoRoot, dirBase, plan);
  const worker = new FeatureWorker();

  let eligibilityResult: unknown = null;
  if (plan.screening && eligibilitySig) {
    dbg("main", "running eligibility preflight");
    eligibilityResult = await worker.run({
      functionName: eligibilitySig.functionName,
      argsSchema: eligibilitySig.args || [],
      argsValues: {
        collection_name: plan.collection_name || plan.collection_key,
        inclusion_criteria: plan.inclusion_criteria.join("\n"),
        exclusion_criteria: plan.exclusion_criteria.join("\n"),
        eligibility_prompt_key: "paper_screener_abs_policy",
        context: plan.context || "",
        research_questions: plan.research_questions.join("\n")
      },
      execute: true
    });
  }

  dbg("main", "running verbatim coding");
  const verbatimResult = await worker.run({
    functionName: verbatimSig.functionName,
    argsSchema: verbatimSig.args || [],
    argsValues: {
      dir_base: dirBase,
      collection_name: plan.collection_name || plan.collection_key,
      collection_key: plan.collection_key || "",
      research_questions: plan.research_questions.join("\n"),
      prompt_key: "code_pdf_page",
      context: `${plan.context || ""}\nRefined codebook path: ${codebookPath}`.trim(),
      coding_mode: plan.coding_mode,
      rq_scope: JSON.stringify(plan.rq_scope || []),
      target_codes: JSON.stringify(plan.target_codes || []),
      min_relevance: plan.min_relevance
    },
    execute: true
  });

  const out = {
    status: "ok",
    supervisor: {
      source: plan.source,
      screening: plan.screening,
      coding_mode: plan.coding_mode,
      research_questions: plan.research_questions
    },
    coder: {
      codebook_path: codebookPath
    },
    eligibility_result: eligibilityResult,
    verbatim_result: verbatimResult
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exit(1);
});

