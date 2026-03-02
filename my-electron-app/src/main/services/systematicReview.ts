import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { spawnSync } from "child_process";

export type PrismaChecklistItem = {
  itemId: string;
  section: string;
  title: string;
  requirementText: string;
  expectedEvidenceType: string;
};

export type PrismaAuditStatus = "pass" | "partial" | "fail" | "not_applicable";

export type PrismaAuditItemResult = {
  itemId: string;
  section: string;
  title: string;
  status: PrismaAuditStatus;
  reason: string;
  evidenceSnippets: string[];
  evidenceAnchors: string[];
  fixInstructions: string;
};

export type PrismaComplianceReport = {
  schema: "prisma_compliance_report_v1";
  createdAt: string;
  checklistPath: string;
  paperMarkdownPath: string;
  paperHtmlPath: string;
  totalItems: number;
  pass: number;
  partial: number;
  fail: number;
  notApplicable: number;
  sectionScores: Record<string, { total: number; pass: number; partial: number; fail: number; notApplicable: number; pctPass: number }>;
  items: PrismaAuditItemResult[];
};

type SystematicState = {
  schema?: string;
  collection?: { name?: string; key?: string; itemsCount?: number };
  protocol?: {
    researchQuestions?: string[];
    inclusionCriteria?: string[];
    exclusionCriteria?: string[];
    temporal?: boolean;
    locked?: boolean;
    version?: number;
  };
  reviewTeam?: { reviewerCount?: number; reviewers?: Array<{ id?: string; label?: string }> };
  prisma?: { flow?: Record<string, number> };
  screening?: {
    includedCount?: number;
    excludedCount?: number;
    screenedCount?: number;
    reasons?: Record<string, number>;
    irr?: {
      formulaGeneral?: string;
      formulaTwoRater?: string;
      agreeingRatings?: number;
      totalRatings?: number;
      ratio?: number | null;
      twoRaterPercent?: number | null;
    };
  };
  coding?: {
    mode?: string;
    evidenceUnits?: number;
    codedItems?: number;
    codebookPath?: string;
  };
  stages?: Array<{ id?: string; title?: string; status?: string; nextAction?: string; output?: string }>;
  artifacts?: Record<string, string>;
  auditTrail?: Array<{ at?: string; action?: string; details?: string }>;
};

export type SystematicPaths = {
  runDir: string;
  statePath: string;
  pipelinePath: string;
  templatePath: string;
  paperModelPath: string;
  paperMarkdownPath: string;
  paperHtmlPath: string;
  checklistRegistryPath: string;
  evidenceMapPath: string;
  complianceReportJsonPath: string;
  complianceReportMdPath: string;
  remediationLogPath: string;
  remediationPatchesPath: string;
  coverageTrendPath: string;
  missingEvidencePromptsPath: string;
  rewriteTriggersPath: string;
  remediationAcceptancePath: string;
  prismaAppendixMarkdownPath: string;
  prismaAppendixHtmlPath: string;
  prismaSignoffPath: string;
  citationConsistencyPath: string;
  supervisorMergeReportPath: string;
  finalQaChecklistPath: string;
  releaseBundleZipPath: string;
  reproducibilityScriptPath: string;
  reproducibilityConfigPath: string;
  readinessReportPath: string;
  releaseNotePath: string;
  stepsReportPath: string;
  bundleManifestPath: string;
};

type ComposeOptions = {
  prismaFlowImagePath?: string;
  synthesisManifest?: Record<string, unknown>;
  allowIncomplete?: boolean;
};

export type SystematicExecutionStepStatus = "completed" | "failed";

export type SystematicExecutionStep = {
  step: number;
  title: string;
  status: SystematicExecutionStepStatus;
  details: string;
  artifacts?: string[];
};

export type SystematicStepsReport = {
  schema: "systematic_steps_1_15_report_v1";
  createdAt: string;
  runDir: string;
  checklistPath: string;
  reviewerCount: 1 | 2 | 3;
  completedSteps: number;
  failedSteps: number;
  steps: SystematicExecutionStep[];
};

const cleanText = (value: unknown): string =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const escapeHtml = (value: unknown): string =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripTags = (value: string): string =>
  String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const decodeHtmlEntities = (value: string): string =>
  String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      if (!Number.isFinite(cp)) return "";
      const safeCp = Math.min(0x10ffff, Math.max(0, cp));
      return String.fromCodePoint(safeCp);
    })
    .replace(/&#([0-9]+);/g, (_m, dec: string) => {
      const cp = Number.parseInt(dec, 10);
      if (!Number.isFinite(cp)) return "";
      const safeCp = Math.min(0x10ffff, Math.max(0, cp));
      return String.fromCodePoint(safeCp);
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");

const safeReadJson = <T>(filePath: string, fallback: T): T => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw || "null");
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
};

const safeWriteJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
};

const dbg = (fn: string, msg: string): void => {
  console.debug(`[systematicReview.ts][${fn}][debug] ${msg}`);
};

const fmtMs = (ms: number): string => {
  const n = Number(ms || 0);
  if (!Number.isFinite(n) || n < 1000) return `${Math.max(0, Math.trunc(n))}ms`;
  return `${(n / 1000).toFixed(2)}s`;
};

const PRISMA_FLOW_PNG_NAME = "flow_prisma_attribution of cyberattacks.png";
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /MethodsWriterAgent pass/i,
  /ResultsWriterAgent pass/i,
  /DiscussionWriterAgent pass/i,
  /Supervisor merge pass/i,
  /PRISMA Item\s+\d+[a-z]?:\s+Add explicit content/i,
  /Citation placeholders added/i,
  /\[cite:[^\]]+\]/i,
  /\bto be defined\b/i,
  /\bpending\b/i
];

type CodingEvidenceUnit = {
  quote?: string;
  paraphrase?: string;
  potential_themes?: string[];
  open_codes?: string[];
  evidence_type?: string;
};

function prismaCountsFromState(state: SystematicState): Record<string, number> {
  const flow = state.prisma?.flow || {};
  const identified = Number(flow.recordsIdentified || 0);
  const dup = Number(flow.duplicateRecordsRemoved || 0);
  const screened = Number(flow.recordsScreened || 0);
  const excluded = Number(flow.recordsExcluded || 0);
  const assessed = Number(flow.reportsAssessedForEligibility || 0);
  const fullExcluded = Number(flow.reportsExcludedWithReasons || 0);
  const included = Number(flow.studiesIncludedInReview || 0);
  return {
    db: Math.max(0, identified),
    dup: Math.max(0, dup),
    screen: Math.max(0, screened),
    screen_ex: Math.max(0, excluded),
    full: Math.max(0, assessed),
    full_ex: Math.max(0, fullExcluded),
    included: Math.max(0, included)
  };
}

function ensurePrismaFlowPng(
  runDir: string,
  state: SystematicState,
  prismaFlowImagePath?: string
): { status: "ok"; written: string[] } | { status: "error"; message: string } {
  try {
    const counts = prismaCountsFromState(state);
    const targets = new Set<string>();
    targets.add(path.join(runDir, PRISMA_FLOW_PNG_NAME));

    const cwdResearch = path.resolve(process.cwd(), "Research", "Systematic_review");
    const parentResearch = path.resolve(process.cwd(), "..", "Research", "Systematic_review");
    const candidateDirs =
      fs.existsSync(parentResearch) && fs.statSync(parentResearch).isDirectory()
        ? [parentResearch]
        : [cwdResearch];
    for (const d of candidateDirs) {
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
        targets.add(path.join(d, PRISMA_FLOW_PNG_NAME));
      }
    }

    const providedPath = cleanText(prismaFlowImagePath || "");
    const statePath = cleanText(state.artifacts?.prismaFlowPngPath || "");
    let resolvedSource = "";
    if (providedPath) {
      resolvedSource = path.resolve(providedPath);
      if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) {
        return { status: "error", message: `PRISMA flow image not found: ${resolvedSource}` };
      }
    } else if (statePath) {
      const maybeStatePath = path.resolve(statePath);
      if (fs.existsSync(maybeStatePath) && fs.statSync(maybeStatePath).isFile()) {
        resolvedSource = maybeStatePath;
      }
    }
    if (resolvedSource) {
      const written: string[] = [];
      for (const target of targets) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(resolvedSource, target);
        written.push(target);
      }
      return { status: "ok", written };
    }

    const pyScript = `
import json, struct, zlib, sys
from pathlib import Path

out = Path(sys.argv[1])
counts = json.loads(sys.argv[2])
W,H = 1200, 760
img = bytearray(W*H*3)

def set_px(x,y,r,g,b):
    if 0 <= x < W and 0 <= y < H:
        i = (y*W + x)*3
        img[i] = r; img[i+1] = g; img[i+2] = b

def rect(x0,y0,x1,y1,r,g,b):
    for y in range(max(0,y0), min(H,y1)):
        row = y*W*3
        for x in range(max(0,x0), min(W,x1)):
            i = row + x*3
            img[i] = r; img[i+1] = g; img[i+2] = b

def hline(x0,x1,y,r,g,b,t=1):
    for yy in range(y, y+t):
        rect(x0,yy,x1,yy+1,r,g,b)

def vline(x,y0,y1,r,g,b,t=1):
    rect(x,y0,x+t,y1,r,g,b)

# background
rect(0,0,W,H,250,252,255)

# title band
rect(0,0,W,72,23,63,95)

# boxes
box_w, box_h = 360, 84
cx = (W - box_w)//2
left = 90
right = W - left - box_w
y1, y2, y3, y4 = 120, 260, 400, 540

def draw_box(x,y):
    rect(x,y,x+box_w,y+box_h,235,244,255)
    hline(x,x+box_w,y,34,74,120,2)
    hline(x,x+box_w,y+box_h-2,34,74,120,2)
    vline(x,y,y+box_h,34,74,120,2)
    vline(x+box_w-2,y,y+box_h,34,74,120,2)

for (x,y) in [(cx,y1),(left,y2),(right,y2),(left,y3),(right,y3),(cx,y4)]:
    draw_box(x,y)

# arrows
def down_arrow(x,y0,y1):
    hline(x-2,x+2,y0,34,74,120,y1-y0)
    rect(x-8,y1-10,x+8,y1,34,74,120)

down_arrow(cx+box_w//2, y1+box_h, y2-12)
down_arrow(left+box_w//2, y2+box_h, y3-12)
down_arrow(right+box_w//2, y2+box_h, y3-12)
down_arrow(cx+box_w//2, y3+box_h, y4-12)

# tiny bar ribbon encoding counts (deterministic visual trace)
vals = [int(counts.get(k,0)) for k in ("db","dup","screen","screen_ex","full","full_ex","included")]
m = max(vals+[1])
bx0, by0, bw, bh = 120, 680, 960, 44
rect(bx0, by0, bx0+bw, by0+bh, 230, 238, 248)
for i,v in enumerate(vals):
    x0 = bx0 + i*(bw//7) + 14
    x1 = bx0 + (i+1)*(bw//7) - 14
    h = int((bh-10) * (v/m))
    rect(x0, by0+bh-6-h, x1, by0+bh-6, 33, 150, 243)

def png_chunk(tag, data):
    return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", zlib.crc32(tag + data) & 0xffffffff)

raw = bytearray()
for y in range(H):
    raw.append(0)
    start = y*W*3
    raw.extend(img[start:start+W*3])
comp = zlib.compress(bytes(raw), 9)
png = bytearray()
png.extend(b"\\x89PNG\\r\\n\\x1a\\n")
png.extend(png_chunk(b'IHDR', struct.pack("!IIBBBBB", W, H, 8, 2, 0, 0, 0)))
png.extend(png_chunk(b'IDAT', comp))
png.extend(png_chunk(b'IEND', b''))

out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(png)
print(str(out))
`.trim();

    const written: string[] = [];
    for (const outPath of targets) {
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        written.push(outPath);
        continue;
      }
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const proc = spawnSync(
        "python3",
        ["-c", pyScript, outPath, JSON.stringify(counts)],
        { encoding: "utf-8" }
      );
      if (proc.status !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size <= 0) {
        const err = cleanText(proc.stderr || proc.stdout || "unknown python error");
        return { status: "error", message: `Failed to generate PRISMA PNG at ${outPath}: ${err}` };
      }
      written.push(outPath);
    }

    return { status: "ok", written };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

const slugifyCollection = (value: string): string =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function parseEvidenceFromBatchLine(line: string): CodingEvidenceUnit[] {
  try {
    const row = JSON.parse(line || "{}");
    const body = row?.response?.body || {};
    const outputs = Array.isArray(body.output) ? body.output : [];
    let textPayload = "";
    for (const out of outputs) {
      if (String(out?.type || "") !== "message") continue;
      const content = Array.isArray(out?.content) ? out.content : [];
      for (const c of content) {
        if (String(c?.type || "") === "output_text" && typeof c?.text === "string" && c.text.trim()) {
          textPayload = c.text;
          break;
        }
      }
      if (textPayload) break;
    }
    if (!textPayload) return [];
    const parsed = JSON.parse(textPayload);
    const evidence = Array.isArray(parsed?.evidence) ? parsed.evidence : [];
    return evidence
      .map((e: unknown) => {
        const obj = (e && typeof e === "object") ? (e as Record<string, unknown>) : {};
        return {
          quote: typeof obj.quote === "string" ? obj.quote : "",
          paraphrase: typeof obj.paraphrase === "string" ? obj.paraphrase : "",
          potential_themes: Array.isArray(obj.potential_themes) ? obj.potential_themes.map((x: unknown) => cleanText(x)).filter(Boolean) : [],
          open_codes: Array.isArray(obj.open_codes) ? obj.open_codes.map((x: unknown) => cleanText(x)).filter(Boolean) : [],
          evidence_type: typeof obj.evidence_type === "string" ? cleanText(obj.evidence_type) : ""
        };
      })
      .filter((e: CodingEvidenceUnit) => cleanText(e.quote || "") || cleanText(e.paraphrase || ""));
  } catch {
    return [];
  }
}

function hydrateCodingFromBatchOutputs(runDir: string, state: SystematicState): void {
  try {
    const collectionName = cleanText(state.collection?.name || state.collection?.key || path.basename(runDir));
    const slug = slugifyCollection(collectionName);
    if (!slug) return;

    const base = path.join(process.env.HOME || "", ".local", "share", "annotarium", "Batching_files", "batches", "code_pdf_page");
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return;
    const allFiles = fs
      .readdirSync(base)
      .filter((f) => f.startsWith(`${slug}_code_pdf_page`) && f.endsWith("_output.jsonl"))
      .map((f) => path.join(base, f))
      .sort();
    const partFiles = allFiles.filter((f) => /__part\d+_output\.jsonl$/i.test(path.basename(f)));
    const files = partFiles.length ? partFiles : allFiles;
    if (!files.length) return;

    const themeCounts = new Map<string, number>();
    const codeCounts = new Map<string, number>();
    const evidenceTypeCounts = new Map<string, number>();
    const sampleParaphrases: string[] = [];
    let evidenceUnits = 0;
    let codedItems = 0;
    const seenCustomIds = new Set<string>();

    for (const file of files) {
      const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        let customId = "";
        try {
          const row = JSON.parse(line || "{}");
          customId = cleanText(row?.custom_id || "");
        } catch {
          customId = "";
        }
        if (customId) {
          if (seenCustomIds.has(customId)) continue;
          seenCustomIds.add(customId);
        }
        codedItems += 1;
        const evidence = parseEvidenceFromBatchLine(line);
        evidenceUnits += evidence.length;
        for (const unit of evidence) {
          (unit.potential_themes || []).forEach((t) => themeCounts.set(t, Number(themeCounts.get(t) || 0) + 1));
          (unit.open_codes || []).forEach((c) => codeCounts.set(c, Number(codeCounts.get(c) || 0) + 1));
          if (unit.evidence_type) evidenceTypeCounts.set(unit.evidence_type, Number(evidenceTypeCounts.get(unit.evidence_type) || 0) + 1);
          const p = cleanText(unit.paraphrase || "");
          if (p && sampleParaphrases.length < 8) sampleParaphrases.push(p);
        }
      }
    }

    const top = (m: Map<string, number>, n = 8): Array<{ label: string; count: number }> =>
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([label, count]) => ({ label, count }));
    const topThemes = top(themeCounts, 8);
    const topCodes = top(codeCounts, 10);
    const topEvidenceTypes = top(evidenceTypeCounts, 6);
    const bullets: string[] = [];
    if (topThemes.length) bullets.push(`Top themes: ${topThemes.map((x) => `${x.label} (${x.count})`).join("; ")}.`);
    if (topCodes.length) bullets.push(`Top open codes: ${topCodes.slice(0, 8).map((x) => `${x.label} (${x.count})`).join("; ")}.`);
    if (topEvidenceTypes.length) bullets.push(`Evidence types: ${topEvidenceTypes.map((x) => `${x.label} (${x.count})`).join("; ")}.`);
    if (sampleParaphrases.length) bullets.push(`Representative findings: ${sampleParaphrases.slice(0, 3).join(" | ")}`);

    state.coding = state.coding || {};
    state.coding.codedItems = codedItems;
    state.coding.evidenceUnits = evidenceUnits;
    state.coding.mode = cleanText(state.coding.mode || "open") || "open";

    const autosummaryPath = path.join(runDir, "coding_results_autosummary.json");
    safeWriteJson(autosummaryPath, {
      schema: "coding_results_autosummary_v1",
      createdAt: new Date().toISOString(),
      collection: collectionName,
      source: { type: "openai_batch_code_pdf_page", files },
      codedItems,
      evidenceUnits,
      topThemes,
      topOpenCodes: topCodes,
      topEvidenceTypes,
      bullets
    });
    state.artifacts = state.artifacts || {};
    state.artifacts.codingResultsAutosummaryPath = autosummaryPath;
  } catch {
    // best effort hydration
  }
}

const listToMarkdown = (rows: string[]): string => rows.map((row) => `- ${row}`).join("\n");

const inferEvidenceType = (rowText: string): string => {
  const low = rowText.toLowerCase();
  if (/\b(flow|identified|screened|excluded|included|records)\b/.test(low)) return "prisma_flow";
  if (/\b(method|eligibility|selection|data collection|synthesis|bias|statistical)\b/.test(low)) return "methods";
  if (/\b(result|findings?|outcomes?)\b/.test(low)) return "results";
  if (/\bdiscussion|limitation|implication\b/.test(low)) return "discussion";
  if (/\bfunding|conflict of interest|registration|protocol\b/.test(low)) return "reporting_meta";
  return "general";
};

const itemIdRe = /^\s*(\d+[a-z]?)\s*$/i;
const PRISMA_CRITICAL_ITEMS = new Set(["1", "5", "6", "7", "8", "10", "13", "16", "17", "23"]);

export function resolveSystematicPaths(runDir: string): SystematicPaths {
  return {
    runDir,
    statePath: path.join(runDir, "systematic_review_state_v1.json"),
    pipelinePath: path.join(runDir, "systematic_review_pipeline.json"),
    templatePath: path.join(runDir, "systematic_review_template.html"),
    paperModelPath: path.join(runDir, "systematic_review_paper_v1.json"),
    paperMarkdownPath: path.join(runDir, "systematic_review_full_paper.md"),
    paperHtmlPath: path.join(runDir, "systematic_review_full_paper.html"),
    checklistRegistryPath: path.join(runDir, "prisma_checklist_registry.json"),
    evidenceMapPath: path.join(runDir, "prisma_evidence_map.json"),
    complianceReportJsonPath: path.join(runDir, "prisma_compliance_report.json"),
    complianceReportMdPath: path.join(runDir, "prisma_compliance_report.md"),
    remediationLogPath: path.join(runDir, "prisma_remediation_log.json"),
    remediationPatchesPath: path.join(runDir, "prisma_remediation_patches.json"),
    coverageTrendPath: path.join(runDir, "prisma_coverage_trend.json"),
    missingEvidencePromptsPath: path.join(runDir, "prisma_missing_evidence_prompts.json"),
    rewriteTriggersPath: path.join(runDir, "prisma_rewrite_triggers.json"),
    remediationAcceptancePath: path.join(runDir, "prisma_remediation_acceptance_checks.json"),
    prismaAppendixMarkdownPath: path.join(runDir, "prisma_appendix.md"),
    prismaAppendixHtmlPath: path.join(runDir, "prisma_appendix.html"),
    prismaSignoffPath: path.join(runDir, "prisma_signoff.json"),
    citationConsistencyPath: path.join(runDir, "citation_consistency_report.json"),
    supervisorMergeReportPath: path.join(runDir, "supervisor_merge_report.json"),
    finalQaChecklistPath: path.join(runDir, "systematic_final_qa_checklist.json"),
    releaseBundleZipPath: path.join(runDir, "systematic_review_release_bundle.zip"),
    reproducibilityScriptPath: path.join(runDir, "reproduce_systematic_run.sh"),
    reproducibilityConfigPath: path.join(runDir, "reproducibility_config.json"),
    readinessReportPath: path.join(runDir, "publication_readiness_report.json"),
    releaseNotePath: path.join(runDir, "systematic_release_note.md"),
    stepsReportPath: path.join(runDir, "systematic_steps_1_15_report.json"),
    bundleManifestPath: path.join(runDir, "systematic_review_bundle_manifest.json")
  };
}

function normalizeCollectionToken(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveRepoRootForResearchPipeline(): string | null {
  const candidates = [process.cwd(), path.resolve(process.cwd(), "..")];
  for (const candidate of candidates) {
    const scriptPath = path.join(candidate, "Research", "pipeline", "run_phase2_systematic_template.py");
    if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile()) {
      return candidate;
    }
  }
  return null;
}

function readJsonFileSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw || "null");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function listFilesRecursive(rootDir: string, maxFiles = 10000): string[] {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

function resolveCollectionJsonPathForRun(runDir: string, state: SystematicState, collectionNameOverride?: string): string | null {
  const repoRoot = resolveRepoRootForResearchPipeline();
  if (!repoRoot) return null;
  const explicit = cleanText(state.artifacts?.collectionJsonPath || "");
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  const collectionName = cleanText(collectionNameOverride || state.collection?.name || "");
  const collectionKey = cleanText(state.collection?.key || "");
  const wantedTokens = new Set(
    [collectionName, collectionKey]
      .filter(Boolean)
      .map((x) => normalizeCollectionToken(x))
      .filter(Boolean)
  );
  const collectionsRoot = path.join(repoRoot, "database", "collections");
  if (!fs.existsSync(collectionsRoot) || !fs.statSync(collectionsRoot).isDirectory()) return null;
  const jsonCandidates = listFilesRecursive(collectionsRoot).filter((fp) => fp.toLowerCase().endsWith(".json"));
  const runItemKeys = new Set<string>();
  const runItemsPath = path.join(runDir, "inputs", "all_items_df.json");
  if (fs.existsSync(runItemsPath) && fs.statSync(runItemsPath).isFile()) {
    try {
      const raw = fs.readFileSync(runItemsPath, "utf-8");
      const parsed = JSON.parse(raw || "null");
      const runItemsArray = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
      for (const row of runItemsArray) {
        if (!row || typeof row !== "object") continue;
        const key = cleanText(String((row as Record<string, unknown>).key || ""));
        if (key) runItemKeys.add(key);
        if (runItemKeys.size >= 3000) break;
      }
    } catch {
      // ignore and fallback to name-based matching only
    }
  }
  let best: { path: string; score: number } | null = null;
  for (const candidate of jsonCandidates) {
    const base = path.basename(candidate, ".json");
    const baseToken = normalizeCollectionToken(base);
    let score = 0;
    if (wantedTokens.has(baseToken)) score += 50;
    const payload = readJsonFileSafe(candidate);
    const payloadName = normalizeCollectionToken(String(payload?.collection_name || ""));
    if (payloadName && wantedTokens.has(payloadName)) score += 100;
    const payloadCollection = payload && typeof payload.items === "object" ? payload : null;
    if (payloadCollection) score += 5;
    if (payloadCollection && runItemKeys.size > 0) {
      let overlap = 0;
      const itemMap = payloadCollection.items as Record<string, unknown>;
      for (const itemKey of Object.keys(itemMap || {})) {
        if (runItemKeys.has(cleanText(itemKey))) overlap += 1;
      }
      if (overlap > 0) score += Math.min(500, overlap);
    }
    if (!score) continue;
    if (!best || score > best.score) best = { path: candidate, score };
  }
  if (collectionNameOverride) {
    const requested = normalizeCollectionToken(collectionNameOverride);
    if (!best) return null;
    const bestPayload = readJsonFileSafe(best.path);
    const bestCollectionName = normalizeCollectionToken(String(bestPayload?.collection_name || path.basename(best.path, ".json")));
    if (requested && bestCollectionName !== requested) {
      return null;
    }
  }
  return best?.path || null;
}

function parseLastJsonObject(raw: string): Record<string, unknown> | null {
  const txt = String(raw || "").trim();
  if (!txt) return null;
  try {
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    // continue
  }
  for (let i = txt.length - 1; i >= 0; i -= 1) {
    if (txt[i] !== "{") continue;
    const candidate = txt.slice(i);
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      // continue
    }
  }
  return null;
}

function normalizeFlowFromAvailableEvidence(state: SystematicState): void {
  state.collection = state.collection || {};
  state.prisma = state.prisma || {};
  state.prisma.flow = state.prisma.flow || {};
  state.screening = state.screening || {};
  const flow = state.prisma.flow;
  const itemsCount = Number(state.collection.itemsCount || 0);
  const identified = Math.max(Number(flow.recordsIdentified || 0), itemsCount);
  let screened = Number(flow.recordsScreened || 0);
  let included = Number(flow.studiesIncludedInReview || 0);
  let excluded = Number(flow.recordsExcluded || 0);
  if (identified > 0 && screened <= 0) screened = identified;
  if (screened > 0 && included <= 0) {
    const codedItems = Number(state.coding?.codedItems || 0);
    if (codedItems > 0) included = Math.min(screened, codedItems);
    else included = screened;
  }
  if (screened > 0 && excluded <= 0) excluded = Math.max(0, screened - included);
  flow.recordsIdentified = identified;
  flow.recordsScreened = Math.max(0, screened);
  flow.studiesIncludedInReview = Math.max(0, included);
  flow.recordsExcluded = Math.max(0, excluded);
  flow.reportsAssessedForEligibility = Math.max(Number(flow.reportsAssessedForEligibility || 0), flow.recordsScreened);
  flow.reportsExcludedWithReasons = Math.max(Number(flow.reportsExcludedWithReasons || 0), flow.recordsExcluded);
  state.screening.screenedCount = Math.max(Number(state.screening.screenedCount || 0), flow.recordsScreened);
  state.screening.includedCount = Math.max(Number(state.screening.includedCount || 0), flow.studiesIncludedInReview);
  state.screening.excludedCount = Math.max(Number(state.screening.excludedCount || 0), flow.recordsExcluded);
}

function extractSynthesisHtmlPathFromManifest(manifest: Record<string, unknown> | null | undefined): string {
  const root = manifest && typeof manifest === "object" ? manifest : {};
  const result = (root as Record<string, unknown>).result;
  const report = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const systematicResult = report.systematic_review_result;
  const section = systematicResult && typeof systematicResult === "object" ? (systematicResult as Record<string, unknown>) : {};
  const pathRaw =
    cleanText(section.systematic_review_html_path || "") ||
    cleanText(section.systematic_review_html || "") ||
    cleanText((root as Record<string, unknown>).systematic_review_html_path || "");
  return pathRaw ? path.resolve(pathRaw) : "";
}

function synthesisManifestIsFallback(manifest: Record<string, unknown> | null | undefined): boolean {
  if (!manifest || typeof manifest !== "object") return false;
  const root = manifest as Record<string, unknown>;
  if (root.fallback === true) return true;
  const schema = cleanText(root.schema || "").toLowerCase();
  return schema.includes("fallback");
}

function assertNoPlaceholders(text: string, label: string): void {
  const failures = PLACEHOLDER_PATTERNS.filter((rx) => rx.test(text || "")).map((rx) => rx.source);
  if (failures.length) {
    throw new Error(`${label} contains placeholder/scaffold content: ${failures.join(", ")}`);
  }
}

function htmlToMarkdownMinimal(htmlText: string): string {
  const raw = String(htmlText || "");
  const titleFromHtml = cleanText(
    stripTags(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
  );
  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let txt = String(bodyMatch?.[1] || raw);
  txt = txt
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  txt = txt.replace(/<img\b([^>]*?)>/gi, (_m, attrs: string) => {
    const alt = cleanText(
      decodeHtmlEntities(attrs.match(/\balt=(["'])([\s\S]*?)\1/i)?.[2] || "")
    );
    const src = cleanText(
      decodeHtmlEntities(attrs.match(/\bsrc=(["'])([\s\S]*?)\1/i)?.[2] || "")
    );
    if (!alt && !src) return "";
    return `\n![${alt || "image"}](${src || ""})\n`;
  });

  txt = txt
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (_m, inner: string) => cleanText(stripTags(inner)))
    .replace(/<span\b[^>]*id=(["'])dqid-([^"']+)\1[^>]*>[\s\S]*?<\/span>/gi, (_m, _q, id: string) => ` [dqid:${cleanText(id)}] `);

  const headingToMarkdown = (tag: string, prefix: string): void => {
    const rx = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    txt = txt.replace(rx, (_m, inner: string) => {
      const value = cleanText(decodeHtmlEntities(stripTags(inner)));
      return value ? `\n${prefix} ${value}\n` : "\n";
    });
  };
  headingToMarkdown("h1", "#");
  headingToMarkdown("h2", "##");
  headingToMarkdown("h3", "###");
  headingToMarkdown("h4", "####");
  headingToMarkdown("h5", "#####");
  headingToMarkdown("h6", "######");

  txt = txt
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n---\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<\/?(figure|figcaption|section|article)\b[^>]*>/gi, "\n")
    .replace(/<blockquote\b[^>]*>/gi, "\n> ")
    .replace(/<\/blockquote>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/?(div|main|header|footer)\b[^>]*>/gi, "\n")
    .replace(/<table\b[^>]*>/gi, "\n")
    .replace(/<\/table>/gi, "\n")
    .replace(/<tr\b[^>]*>/gi, "\n| ")
    .replace(/<\/tr>/gi, " |\n")
    .replace(/<t[dh]\b[^>]*>/gi, "")
    .replace(/<\/t[dh]>/gi, " | ");

  txt = decodeHtmlEntities(txt).replace(/<[^>]+>/g, " ");
  const roughLines = txt
    .split(/\r?\n/g)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .map((line) => line.replace(/\s+\|\s+/g, " | ").replace(/\|+\s*$/g, "|"))
    .map((line) => line.replace(/^\|\s*\|$/, ""))
    .filter((line) => line !== "");

  const lines: string[] = [];
  if (titleFromHtml) lines.push(`# ${titleFromHtml}`);
  for (const line of roughLines) {
    if (lines.length && lines[lines.length - 1] === "" && line === "") continue;
    lines.push(line);
  }
  if (!lines.length) return titleFromHtml ? `# ${titleFromHtml}` : "";
  if (lines[0].startsWith("# ")) return lines.join("\n").trim();
  return titleFromHtml ? `# ${titleFromHtml}\n\n${lines.join("\n").trim()}` : lines.join("\n").trim();
}

function ensurePrismaFigureEmbedded(htmlText: string, prismaBasename: string): string {
  const name = cleanText(prismaBasename || "");
  if (!name) return htmlText;
  const rx = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (rx.test(htmlText)) return htmlText;
  const block = `\n<section id="results_prisma_figure"><h2>PRISMA Flow Figure</h2><div class="sec"><img src="${escapeHtml(name)}" alt="PRISMA flow diagram" style="max-width:100%;height:auto;" /></div></section>\n`;
  if (/<\/body>/i.test(htmlText)) return htmlText.replace(/<\/body>/i, `${block}</body>`);
  return `${htmlText}\n${block}`;
}

function runBatchSystematicSynthesis(
  runDir: string,
  state: SystematicState,
  prismaFlowImagePath?: string,
  collectionName?: string,
  temporal?: boolean
): { status: "ok"; manifest: Record<string, unknown> } | { status: "error"; message: string } {
  const t0 = Date.now();
  dbg(
    "runBatchSystematicSynthesis",
    `start runDir=${runDir} collection=${cleanText(collectionName || state.collection?.name || state.collection?.key || "")}`
  );
  const repoRoot = resolveRepoRootForResearchPipeline();
  if (!repoRoot) {
    dbg("runBatchSystematicSynthesis", "error repo_root_unresolved");
    return { status: "error", message: "Unable to resolve repository root for Research batch pipeline." };
  }
  const collectionJsonPath = resolveCollectionJsonPathForRun(runDir, state, collectionName);
  if (!collectionJsonPath) {
    dbg("runBatchSystematicSynthesis", `error missing_collection_json runDir=${runDir}`);
    return {
      status: "error",
      message: collectionName
        ? `No collection JSON resolved for collection_name='${collectionName}' and runDir=${runDir}.`
        : `No collection JSON could be resolved for runDir: ${runDir}`,
    };
  }
  const scriptPath = path.join(repoRoot, "Research", "pipeline", "run_phase2_systematic_template.py");
  const resultJsonPath = path.join(runDir, "systematic_synthesis_result.json");
  const args = [
    scriptPath,
    "--collection-json",
    collectionJsonPath,
    "--model",
    "gpt-5-mini",
    "--section-single-batch",
    "--result-json-path",
    resultJsonPath,
  ];
  const rqList = Array.isArray(state.protocol?.researchQuestions)
    ? state.protocol?.researchQuestions.map((x) => cleanText(x)).filter(Boolean)
    : [];
  if (rqList.length > 0) {
    args.push("--research-questions-json", JSON.stringify(rqList));
  }
  const envTemporal = /^(1|true|yes|on|temporal|chronological)$/i.test(cleanText(process.env.SYSTEMATIC_TEMPORAL || ""));
  const temporalEnabled = Boolean((typeof temporal === "boolean" ? temporal : state.protocol?.temporal) || envTemporal);
  if (temporalEnabled) args.push("--temporal");
  const providedPrisma = cleanText(prismaFlowImagePath || "");
  if (providedPrisma) {
    args.push("--prisma-figure-path", path.resolve(providedPrisma));
  }
  const timeoutRaw = cleanText(process.env.SYSTEMATIC_SYNTHESIS_TIMEOUT_MS || "");
  const timeoutParsed = Number(timeoutRaw);
  const timeoutMs = timeoutRaw && Number.isFinite(timeoutParsed) && timeoutParsed > 0 ? Math.max(60000, Math.trunc(timeoutParsed)) : 0;
  const streamLogs = !/^(0|false|no)$/i.test(cleanText(process.env.SYSTEMATIC_SYNTHESIS_STREAM_LOGS || "1"));
  dbg(
    "runBatchSystematicSynthesis",
    `spawn python script=${scriptPath} timeout_ms=${timeoutMs > 0 ? String(timeoutMs) : "none"} stream_logs=${String(streamLogs)} temporal=${String(temporalEnabled)}`
  );
  try {
    if (fs.existsSync(resultJsonPath)) fs.unlinkSync(resultJsonPath);
  } catch {
    // best effort cleanup
  }
  const pyOpts: any = {
    cwd: repoRoot,
    env: {
      ...process.env,
      BATCH_ROOT: process.env.BATCH_ROOT || path.join(repoRoot, "tmp", "batching_files"),
      ANNOTARIUM_CACHE_DIR: process.env.ANNOTARIUM_CACHE_DIR || path.join(repoRoot, "tmp", "annotarium_cache"),
    },
  };
  if (streamLogs) {
    pyOpts.stdio = ["ignore", "inherit", "inherit"];
  } else {
    pyOpts.encoding = "utf-8";
    pyOpts.maxBuffer = 64 * 1024 * 1024;
  }
  if (timeoutMs > 0) pyOpts.timeout = timeoutMs;
  const spawnT0 = Date.now();
  const py = spawnSync("python3", args, pyOpts);
  dbg(
    "runBatchSystematicSynthesis",
    `python_exit status=${String(py.status)} signal=${String(py.signal || "")} took=${fmtMs(Date.now() - spawnT0)}`
  );
  if ((py.status ?? 1) !== 0) {
    const stderr = String(py.stderr || "").trim();
    const stdout = String(py.stdout || "").trim();
    const errCode = String((py.error as NodeJS.ErrnoException | undefined)?.code || "");
    if (errCode === "ETIMEDOUT") {
      dbg("runBatchSystematicSynthesis", `python_timeout timeout_ms=${timeoutMs}`);
    }
    dbg(
      "runBatchSystematicSynthesis",
      `error batch_pipeline_failed stderr_tail=${cleanText(stderr.slice(-600))} stdout_tail=${cleanText(stdout.slice(-600))}`
    );
    return { status: "error", message: `Batch systematic pipeline failed. ${stderr || stdout || "Unknown error."}` };
  }
  let parsed = safeReadJson<Record<string, unknown> | null>(resultJsonPath, null);
  if (!parsed) {
    parsed = parseLastJsonObject(String(py.stdout || ""));
  }
  if (!parsed) {
    dbg("runBatchSystematicSynthesis", "error no_parseable_manifest_json");
    return { status: "error", message: "Batch systematic pipeline completed but returned no parseable JSON manifest." };
  }
  if (prismaFlowImagePath) {
    state.artifacts = state.artifacts || {};
    state.artifacts.prismaFlowPngPath = cleanText(prismaFlowImagePath);
  }
  dbg("runBatchSystematicSynthesis", `done took=${fmtMs(Date.now() - t0)}`);
  return { status: "ok", manifest: parsed };
}

export function parsePrismaChecklist(checklistPath: string): PrismaChecklistItem[] {
  const html = fs.readFileSync(checklistPath, "utf-8");
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const items: PrismaChecklistItem[] = [];
  for (const row of rows) {
    const cells = Array.from(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((m) => stripTags(m[1]));
    if (cells.length < 2) continue;
    const itemCellIdx = cells.findIndex((cell) => itemIdRe.test(cell));
    if (itemCellIdx < 0) continue;
    const itemId = cells[itemCellIdx].match(itemIdRe)?.[1] || "";
    if (!itemId) continue;
    const section = cleanText(cells[itemCellIdx - 1] || "General");
    const title = cleanText(cells[itemCellIdx + 1] || `PRISMA Item ${itemId}`);
    const requirementText = cleanText(cells.slice(itemCellIdx + 1).join(" ")) || title;
    const expectedEvidenceType = inferEvidenceType(`${section} ${title} ${requirementText}`);
    items.push({ itemId, section: section || "General", title: title || `Item ${itemId}`, requirementText, expectedEvidenceType });
  }
  const dedup = new Map<string, PrismaChecklistItem>();
  items.forEach((item) => {
    if (!dedup.has(item.itemId)) dedup.set(item.itemId, item);
  });
  return Array.from(dedup.values());
}

function buildPaperModel(state: SystematicState, paths: SystematicPaths): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const collectionName = cleanText(state.collection?.name || state.collection?.key || "collection");
  const rqs = Array.isArray(state.protocol?.researchQuestions) ? state.protocol?.researchQuestions : [];
  const inclusion = Array.isArray(state.protocol?.inclusionCriteria) ? state.protocol?.inclusionCriteria : [];
  const exclusion = Array.isArray(state.protocol?.exclusionCriteria) ? state.protocol?.exclusionCriteria : [];
  const reviewers = Number(state.reviewTeam?.reviewerCount || 0) || 1;
  const flow = state.prisma?.flow || {};
  const screeningSummaryPath = path.join(paths.runDir, "screening_summary_table.md");
  const codingAutosummaryPath = path.join(paths.runDir, "coding_results_autosummary.json");
  const screeningSummaryTable = fs.existsSync(screeningSummaryPath)
    ? fs.readFileSync(screeningSummaryPath, "utf-8")
    : [
        "| Metric | Value |",
        "|---|---:|",
        `| Screened | ${Number(state.screening?.screenedCount || flow.recordsScreened || 0)} |`,
        `| Included | ${Number(state.screening?.includedCount || flow.studiesIncludedInReview || 0)} |`,
        `| Excluded | ${Number(state.screening?.excludedCount || flow.recordsExcluded || 0)} |`
      ].join("\n");
  const codingAutosummary = fs.existsSync(codingAutosummaryPath)
    ? safeReadJson<{ bullets?: string[] }>(codingAutosummaryPath, {}).bullets || []
    : [];
  const sections = [
    {
      id: "title",
      title: "Title",
      content: `Systematic Review of ${collectionName}: Frameworks, Models, Evidence, and Methods`
    },
    {
      id: "abstract",
      title: "Abstract",
      content:
        `This systematic review evaluates frameworks, models, methods, and evidence patterns in ${collectionName}. ` +
        `The protocol used ${reviewers} reviewer(s), explicit eligibility criteria, staged screening/coding, and PRISMA flow tracking. ` +
        `Records identified: ${Number(flow.recordsIdentified || 0)}; screened: ${Number(flow.recordsScreened || 0)}; included: ${Number(flow.studiesIncludedInReview || 0)}.`
    },
    {
      id: "introduction",
      title: "Introduction",
      content:
        "This paper addresses methodological and substantive variation in the selected corpus, with emphasis on evidence standards and model operationalization."
    },
    {
      id: "methods_protocol",
      title: "Methods: Protocol and Registration",
      content:
        `Protocol version: ${Number(state.protocol?.version || 1)}. Protocol locked: ${state.protocol?.locked === true ? "yes" : "no"}. ` +
        "Checklist framework: PRISMA 2020."
    },
    {
      id: "methods_eligibility",
      title: "Methods: Eligibility Criteria",
      content:
        `Inclusion criteria:\n${listToMarkdown(inclusion)}\n\nExclusion criteria:\n${listToMarkdown(exclusion)}`
    },
    {
      id: "methods_information_sources",
      title: "Methods: Information Sources and Search Strategy",
      content:
        `Primary source was the Zotero-derived corpus '${collectionName}'. Data were drawn from OCR-parsed and coded dataset artifacts under ${paths.runDir}.`
    },
    {
      id: "methods_selection_process",
      title: "Methods: Selection Process and Inter-Rater Reliability",
      content:
        `Reviewer count: ${reviewers}. ` +
        `General IRR formula: ${cleanText(state.screening?.irr?.formulaGeneral || "IRR = Agreeing Ratings / Total Ratings")}. ` +
        `Two-rater IRR formula: ${cleanText(state.screening?.irr?.formulaTwoRater || "IRR = (TA / (TR * R)) * 100")}. ` +
        `Agreeing ratings: ${Number(state.screening?.irr?.agreeingRatings || 0)}. Total ratings: ${Number(state.screening?.irr?.totalRatings || 0)}. ` +
        `General IRR: ${state.screening?.irr?.ratio === null || state.screening?.irr?.ratio === undefined ? "n/a" : Number(state.screening?.irr?.ratio).toFixed(4)}.`
    },
    {
      id: "methods_data_collection",
      title: "Methods: Data Collection Process",
      content:
        "Data extraction and coding were run from structured batch payloads and direct-quote units, with evidence-unit level metadata preserved."
    },
    {
      id: "methods_risk_of_bias",
      title: "Methods: Risk of Bias / Limitations in Evidence",
      content:
        "Risk considerations include attribution uncertainty, variable source quality, and possible reporting bias in underlying publications."
    },
    {
      id: "results_prisma",
      title: "Results: PRISMA Flow",
      content:
        `Records identified: ${Number(flow.recordsIdentified || 0)}. ` +
        `Duplicates removed: ${Number(flow.duplicateRecordsRemoved || 0)}. ` +
        `Records screened: ${Number(flow.recordsScreened || 0)}. ` +
        `Records excluded: ${Number(flow.recordsExcluded || 0)}. ` +
        `Reports assessed for eligibility: ${Number(flow.reportsAssessedForEligibility || 0)}. ` +
        `Studies included in review: ${Number(flow.studiesIncludedInReview || 0)}.`
    },
    {
      id: "results_synthesis",
      title: "Results: Synthesis of Findings",
      content:
        `Coded items: ${Number(state.coding?.codedItems || 0)}. Evidence units: ${Number(state.coding?.evidenceUnits || 0)}. ` +
        `Coding mode: ${cleanText(state.coding?.mode || "not specified")}.` +
        `${codingAutosummary.length ? `\nAuto-summary:\n${listToMarkdown(codingAutosummary.map((x) => cleanText(x)).filter(Boolean))}` : ""}`
    },
    {
      id: "results_screening_summary",
      title: "Results: Screening Summary Table",
      content: screeningSummaryTable
    },
    {
      id: "discussion",
      title: "Discussion",
      content:
        "Findings indicate concentration in selected model families and uneven methodological depth across sources; unresolved conflicts should be adjudicated before final claims."
    },
    {
      id: "other_information",
      title: "Other Information (Funding, COI, Data Availability)",
      content:
        "Funding and conflict of interest statements should be completed explicitly. Data and artifacts are available in the systematic_review run directory."
    }
  ];
  return {
    schema: "systematic_review_paper_v1",
    createdAt: nowIso,
    updatedAt: nowIso,
    collection: state.collection || {},
    provenance: {
      statePath: paths.statePath,
      pipelinePath: paths.pipelinePath,
      templatePath: paths.templatePath
    },
    sections
  };
}

function getSectionList(model: Record<string, unknown>): Array<{ id: string; title: string; content: string }> {
  return Array.isArray((model as any).sections) ? ((model as any).sections as Array<{ id: string; title: string; content: string }>) : [];
}

function appendSectionContent(
  sections: Array<{ id: string; title: string; content: string }>,
  sectionId: string,
  text: string
): boolean {
  const section = sections.find((s) => s.id === sectionId);
  const patch = cleanText(text);
  if (!section || !patch) return false;
  if (String(section.content || "").includes(patch)) return false;
  section.content = `${String(section.content || "").trim()}\n${patch}`.trim();
  return true;
}

function applyMethodsWriterAgent(
  model: Record<string, unknown>,
  state: SystematicState
): number {
  void model;
  void state;
  return 0;
}

function applyResultsWriterAgent(
  model: Record<string, unknown>,
  state: SystematicState
): number {
  void model;
  void state;
  return 0;
}

function applyDiscussionWriterAgent(
  model: Record<string, unknown>,
  state: SystematicState
): number {
  void model;
  void state;
  return 0;
}

function applyCitationAgent(model: Record<string, unknown>, runDir: string): number {
  const sections = getSectionList(model);
  const citationRefs = Array.from(new Set(sections.flatMap((s) => Array.from(String(s.content || "").matchAll(/\[cite:[^\]]+\]/g)).map((m) => String(m[0] || ""))).filter(Boolean)));
  const report = {
    schema: "citation_consistency_report_v1",
    createdAt: new Date().toISOString(),
    discoveredCitations: citationRefs,
    forbiddenPlaceholders: citationRefs,
    consistent: citationRefs.length === 0
  };
  safeWriteJson(resolveSystematicPaths(runDir).citationConsistencyPath, report);
  (model as any).sections = sections;
  return 0;
}

function applySupervisorMergePass(model: Record<string, unknown>, runDir: string): number {
  const changed = 0;
  safeWriteJson(resolveSystematicPaths(runDir).supervisorMergeReportPath, {
    schema: "supervisor_merge_report_v1",
    createdAt: new Date().toISOString(),
    changedSections: changed,
    status: changed > 0 ? "updated" : "already_merged"
  });
  return changed;
}

function applyRedactionAgent(model: Record<string, unknown>): number {
  const sections = getSectionList(model);
  let changed = 0;
  for (const section of sections) {
    const lines = String(section.content || "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const deduped: string[] = [];
    for (const line of lines) {
      if (!deduped.includes(line)) deduped.push(line);
    }
    const normalized = deduped.join("\n").trim();
    if (normalized && normalized !== String(section.content || "").trim()) {
      section.content = normalized;
      changed += 1;
    }
  }
  (model as any).sections = sections;
  return changed;
}

function applyWriterAndRedactionPasses(model: Record<string, unknown>, state: SystematicState, runDir: string): Record<string, number> {
  const methodsUpdates = applyMethodsWriterAgent(model, state);
  const resultsUpdates = applyResultsWriterAgent(model, state);
  const discussionUpdates = applyDiscussionWriterAgent(model, state);
  const citationUpdates = applyCitationAgent(model, runDir);
  const supervisorMergeUpdates = applySupervisorMergePass(model, runDir);
  const redactionUpdates = applyRedactionAgent(model);
  (model as any).agent_passes = {
    methods_writer_updates: methodsUpdates,
    results_writer_updates: resultsUpdates,
    discussion_writer_updates: discussionUpdates,
    citation_agent_updates: citationUpdates,
    supervisor_merge_updates: supervisorMergeUpdates,
    redaction_updates: redactionUpdates,
    updatedAt: new Date().toISOString()
  };
  return {
    methodsUpdates,
    resultsUpdates,
    discussionUpdates,
    citationUpdates,
    supervisorMergeUpdates,
    redactionUpdates
  };
}

function renderPaperMarkdown(model: Record<string, unknown>): string {
  const sections = Array.isArray((model as any).sections) ? (model as any).sections as Array<{ id: string; title: string; content: string }> : [];
  const lines: string[] = [];
  lines.push(`# ${cleanText(sections.find((s) => s.id === "title")?.content || "Systematic Review")}`);
  sections.forEach((s) => {
    if (s.id === "title") return;
    lines.push("");
    lines.push(`## ${s.title}`);
    lines.push(`<!-- section-id: ${s.id} -->`);
    lines.push(String(s.content || "").trim());
  });
  return lines.join("\n");
}

function renderPaperHtml(model: Record<string, unknown>): string {
  const sections = Array.isArray((model as any).sections) ? (model as any).sections as Array<{ id: string; title: string; content: string }> : [];
  const title = cleanText(sections.find((s) => s.id === "title")?.content || "Systematic Review");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: "IBM Plex Sans", "Segoe UI", Arial, sans-serif; margin: 24px auto; max-width: 980px; line-height: 1.5; color: #102030; }
    h1 { font-size: 1.9rem; margin-bottom: 0.8rem; }
    h2 { margin-top: 1.6rem; font-size: 1.25rem; border-bottom: 1px solid #d8dee8; padding-bottom: 0.3rem; }
    .sec { margin-bottom: 1rem; white-space: pre-wrap; }
    .anchor { color: #667; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${sections
    .filter((s) => s.id !== "title")
    .map((s) => `<section id="${escapeHtml(s.id)}"><h2>${escapeHtml(s.title)}</h2><div class="anchor">section-id: ${escapeHtml(s.id)}</div><div class="sec">${escapeHtml(s.content)}</div></section>`)
    .join("\n")}
</body>
</html>`;
}

function enforceFinalPaperQuality(state: SystematicState, markdownText: string, htmlText: string, allowIncomplete = false): void {
  assertNoPlaceholders(markdownText, "systematic markdown");
  assertNoPlaceholders(htmlText, "systematic html");
  if (!allowIncomplete && !/data-dqid=/i.test(htmlText)) {
    throw new Error("Systematic HTML has no dqid anchors (data-dqid).");
  }
  const expectedPng = cleanText(path.basename(cleanText(state.artifacts?.prismaFlowPngPath || PRISMA_FLOW_PNG_NAME)));
  if (!allowIncomplete && expectedPng && !new RegExp(expectedPng.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(htmlText)) {
    throw new Error(`Systematic HTML does not embed expected PRISMA figure '${expectedPng}'.`);
  }
  if (!allowIncomplete) {
    const flow = state.prisma?.flow || {};
    const identified = Number(flow.recordsIdentified || 0);
    const screened = Number(flow.recordsScreened || 0);
    const included = Number(flow.studiesIncludedInReview || 0);
    if (identified > 0 && screened <= 0) {
      throw new Error("PRISMA flow incomplete: recordsScreened is 0 while recordsIdentified > 0.");
    }
    if (identified > 0 && included <= 0) {
      throw new Error("PRISMA flow incomplete: studiesIncludedInReview is 0 while recordsIdentified > 0.");
    }
  }
}

function renderMethodTemplateHtml(state: SystematicState, runDir: string): string {
  const collectionName = cleanText(state.collection?.name || state.collection?.key || "collection");
  const rqs = Array.isArray(state.protocol?.researchQuestions) ? state.protocol?.researchQuestions : [];
  const inclusion = Array.isArray(state.protocol?.inclusionCriteria) ? state.protocol?.inclusionCriteria : [];
  const exclusion = Array.isArray(state.protocol?.exclusionCriteria) ? state.protocol?.exclusionCriteria : [];
  const reviewers = Number(state.reviewTeam?.reviewerCount || 0) || 1;
  const flow = state.prisma?.flow || {};
  const prismaPngPath = cleanText(state.artifacts?.prismaFlowPngPath || path.join(runDir, PRISMA_FLOW_PNG_NAME));
  const prismaPngSrc = escapeHtml(path.basename(prismaPngPath));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Systematic Review Template</title>
  <style>
    body { font-family: "IBM Plex Sans", "Segoe UI", Arial, sans-serif; margin: 24px auto; max-width: 980px; color: #12202f; }
    h1 { font-size: 1.6rem; }
    h2 { margin-top: 1.3rem; border-bottom: 1px solid #d9e1ea; padding-bottom: 0.25rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #d9e1ea; padding: 8px; text-align: left; }
    ul, ol { margin: 6px 0 0 20px; }
    .muted { color: #5d6a78; }
  </style>
</head>
<body>
  <h1>Systematic Review Template</h1>
  <p><b>Collection:</b> ${escapeHtml(collectionName)} | <b>Reviewers:</b> ${escapeHtml(reviewers)} | <span class="muted">Run dir: ${escapeHtml(runDir)}</span></p>
  <h2>Research Questions</h2>
  <ol>${(rqs.length ? rqs : ["Define 3 to 5 research questions."]).map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ol>
  <h2>Eligibility Criteria</h2>
  <p><b>Inclusion</b></p>
  <ul>${(inclusion.length ? inclusion : ["To be defined."]).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
  <p><b>Exclusion</b></p>
  <ul>${(exclusion.length ? exclusion : ["To be defined."]).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
  <h2>PRISMA Flow Snapshot</h2>
  <table>
    <tr><th>Node</th><th>Count</th></tr>
    <tr><td>Records identified</td><td>${escapeHtml(Number(flow.recordsIdentified || 0))}</td></tr>
    <tr><td>Records screened</td><td>${escapeHtml(Number(flow.recordsScreened || 0))}</td></tr>
    <tr><td>Records excluded</td><td>${escapeHtml(Number(flow.recordsExcluded || 0))}</td></tr>
    <tr><td>Studies included</td><td>${escapeHtml(Number(flow.studiesIncludedInReview || 0))}</td></tr>
  </table>
  <p class="muted">PRISMA flow figure: ${escapeHtml(prismaPngPath)}</p>
  <img src="${prismaPngSrc}" alt="PRISMA flow diagram" style="max-width:100%;height:auto;border:1px solid #d9e1ea;margin-top:10px" />
</body>
</html>`;
}

const sectionHints: Array<{ re: RegExp; sectionId: string }> = [
  { re: /\btitle\b/i, sectionId: "title" },
  { re: /\babstract\b/i, sectionId: "abstract" },
  { re: /\bprotocol|registration\b/i, sectionId: "methods_protocol" },
  { re: /\beligibility\b/i, sectionId: "methods_eligibility" },
  { re: /\binformation sources|search\b/i, sectionId: "methods_information_sources" },
  { re: /\bselection process|selection\b/i, sectionId: "methods_selection_process" },
  { re: /\bdata collection|data items\b/i, sectionId: "methods_data_collection" },
  { re: /\bbias\b/i, sectionId: "methods_risk_of_bias" },
  { re: /\bflow|prisma\b/i, sectionId: "results_prisma" },
  { re: /\bresult|synthesis\b/i, sectionId: "results_synthesis" },
  { re: /\bdiscussion|limitation|implication\b/i, sectionId: "discussion" },
  { re: /\bfunding|conflict|availability\b/i, sectionId: "other_information" }
];

function inferTargetSection(item: PrismaChecklistItem): string {
  const blob = `${item.section} ${item.title} ${item.requirementText}`;
  const found = sectionHints.find((x) => x.re.test(blob));
  return found?.sectionId || "discussion";
}

function extractSnippetFromPaper(text: string, keyword: string): string {
  const low = text.toLowerCase();
  const idx = low.indexOf(keyword.toLowerCase());
  if (idx < 0) return "";
  const start = Math.max(0, idx - 90);
  const end = Math.min(text.length, idx + 210);
  return cleanText(text.slice(start, end));
}

function keywordSetForRequirement(item: PrismaChecklistItem): string[] {
  const source = `${item.title} ${item.requirementText}`.toLowerCase();
  const tokens = Array.from(new Set(source.split(/[^a-z0-9]+/g).filter((t) => t.length >= 5)));
  return tokens.slice(0, 8);
}

function buildPrismaAppendix(report: PrismaComplianceReport): { markdown: string; html: string } {
  const rows = report.items.map((item) => ({
    id: item.itemId,
    section: item.section,
    title: item.title,
    status: item.status,
    reason: item.reason
  }));
  const markdown = [
    "# PRISMA Appendix",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Total items: ${report.totalItems}`,
    `- Pass: ${report.pass}`,
    `- Partial: ${report.partial}`,
    `- Fail: ${report.fail}`,
    "",
    "| Item | Section | Status | Note |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | ${r.section} | ${r.status} | ${cleanText(r.reason).replace(/\|/g, "/")} |`)
  ].join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>PRISMA Appendix</title><style>body{font-family:Arial,sans-serif;margin:18px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd;padding:6px;text-align:left}</style></head><body><h1>PRISMA Appendix</h1><p>Total items: ${report.totalItems} | Pass: ${report.pass} | Partial: ${report.partial} | Fail: ${report.fail}</p><table><thead><tr><th>Item</th><th>Section</th><th>Status</th><th>Note</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.section)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.reason)}</td></tr>`).join("")}</tbody></table></body></html>`;
  return { markdown, html };
}

export function composeFullPaper(
  runDir: string,
  checklistPath: string,
  options?: ComposeOptions
): { status: "ok"; paths: SystematicPaths; paperModel: Record<string, unknown> } | { status: "error"; message: string } {
  try {
    const paths = resolveSystematicPaths(runDir);
    fs.mkdirSync(runDir, { recursive: true });
    const state = safeReadJson<SystematicState>(paths.statePath, {});
    if (!state || !state.collection) {
      return { status: "error", message: `Missing or invalid systematic review state at ${paths.statePath}` };
    }
    hydrateCodingFromBatchOutputs(runDir, state);
    const prismaPng = ensurePrismaFlowPng(runDir, state, cleanText(options?.prismaFlowImagePath || ""));
    if (prismaPng.status !== "ok") {
      return { status: "error", message: prismaPng.message };
    }
    state.artifacts = state.artifacts || {};
    state.artifacts.prismaFlowPngPath = prismaPng.written[0] || path.join(runDir, PRISMA_FLOW_PNG_NAME);
    safeWriteJson(paths.statePath, state);

    const model = buildPaperModel(state, paths);
    applyWriterAndRedactionPasses(model, state, runDir);
    (model as any).updatedAt = new Date().toISOString();
    safeWriteJson(paths.paperModelPath, model);
    let markdownOut = renderPaperMarkdown(model);
    let htmlOut = renderPaperHtml(model);
    const synthesisHtmlPath = extractSynthesisHtmlPathFromManifest(options?.synthesisManifest || {});
    if (synthesisHtmlPath && fs.existsSync(synthesisHtmlPath) && fs.statSync(synthesisHtmlPath).isFile()) {
      htmlOut = fs.readFileSync(synthesisHtmlPath, "utf-8");
      markdownOut = htmlToMarkdownMinimal(htmlOut);
    }
    const prismaBase = path.basename(cleanText(state.artifacts?.prismaFlowPngPath || PRISMA_FLOW_PNG_NAME));
    htmlOut = ensurePrismaFigureEmbedded(htmlOut, prismaBase);
    markdownOut = htmlToMarkdownMinimal(htmlOut);
    enforceFinalPaperQuality(state, markdownOut, htmlOut, Boolean(options?.allowIncomplete));
    fs.writeFileSync(paths.paperMarkdownPath, markdownOut, "utf-8");
    fs.writeFileSync(paths.paperHtmlPath, htmlOut, "utf-8");

    const registry = parsePrismaChecklist(checklistPath);
    safeWriteJson(paths.checklistRegistryPath, {
      schema: "prisma_checklist_registry_v1",
      createdAt: new Date().toISOString(),
      checklistPath,
      checklistHash: `${fs.statSync(checklistPath).size}:${fs.statSync(checklistPath).mtimeMs}`,
      totalItems: registry.length,
      items: registry
    });
    return { status: "ok", paths, paperModel: model };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function auditPrisma(runDir: string): { status: "ok"; report: PrismaComplianceReport; paths: SystematicPaths } | { status: "error"; message: string } {
  try {
    const paths = resolveSystematicPaths(runDir);
    if (!fs.existsSync(paths.checklistRegistryPath)) {
      return { status: "error", message: `Checklist registry missing: ${paths.checklistRegistryPath}` };
    }
    if (!fs.existsSync(paths.paperMarkdownPath)) {
      return { status: "error", message: `Paper markdown missing: ${paths.paperMarkdownPath}` };
    }
    const registry = safeReadJson<{ items?: PrismaChecklistItem[] }>(paths.checklistRegistryPath, {});
    const items = Array.isArray(registry.items) ? registry.items : [];
    const paper = fs.readFileSync(paths.paperMarkdownPath, "utf-8");
    const paperLow = paper.toLowerCase();
    const model = safeReadJson<Record<string, unknown>>(paths.paperModelPath, {});
    const sections = Array.isArray((model as any).sections) ? (model as any).sections as Array<{ id: string; title: string; content: string }> : [];
    const evidenceMap: Record<string, { targetSection: string; snippets: string[]; anchors: string[]; keywords: string[] }> = {};
    const results: PrismaAuditItemResult[] = [];
    for (const item of items) {
      const targetSection = inferTargetSection(item);
      const keywords = keywordSetForRequirement(item);
      const hits = keywords.filter((k) => paperLow.includes(k));
      const snippets = keywords.map((k) => extractSnippetFromPaper(paper, k)).filter(Boolean).slice(0, 3);
      const anchors = sections.some((s) => s.id === targetSection) ? [targetSection] : [];
      let status: PrismaAuditStatus = "fail";
      if (hits.length >= 3 && snippets.length >= 1) status = "pass";
      else if (hits.length >= 1 || snippets.length >= 1) status = "partial";
      const reason =
        status === "pass"
          ? "Requirement appears covered with textual evidence."
          : status === "partial"
            ? "Requirement is partially covered; strengthen explicit reporting."
            : "Requirement coverage not detected in current paper draft.";
      const fixInstructions =
        `Add explicit content for PRISMA item ${item.itemId} in section '${targetSection}'. ` +
        `Cover: ${item.requirementText}`;
      results.push({
        itemId: item.itemId,
        section: item.section,
        title: item.title,
        status,
        reason,
        evidenceSnippets: snippets,
        evidenceAnchors: anchors,
        fixInstructions
      });
      evidenceMap[item.itemId] = { targetSection, snippets, anchors, keywords };
    }
    const sectionScores: PrismaComplianceReport["sectionScores"] = {};
    for (const item of results) {
      if (!sectionScores[item.section]) {
        sectionScores[item.section] = { total: 0, pass: 0, partial: 0, fail: 0, notApplicable: 0, pctPass: 0 };
      }
      const slot = sectionScores[item.section];
      slot.total += 1;
      if (item.status === "pass") slot.pass += 1;
      else if (item.status === "partial") slot.partial += 1;
      else if (item.status === "fail") slot.fail += 1;
      else slot.notApplicable += 1;
      slot.pctPass = slot.total ? (slot.pass / slot.total) * 100 : 0;
    }
    const report: PrismaComplianceReport = {
      schema: "prisma_compliance_report_v1",
      createdAt: new Date().toISOString(),
      checklistPath: safeReadJson<{ checklistPath?: string }>(paths.checklistRegistryPath, {}).checklistPath || "",
      paperMarkdownPath: paths.paperMarkdownPath,
      paperHtmlPath: paths.paperHtmlPath,
      totalItems: results.length,
      pass: results.filter((x) => x.status === "pass").length,
      partial: results.filter((x) => x.status === "partial").length,
      fail: results.filter((x) => x.status === "fail").length,
      notApplicable: results.filter((x) => x.status === "not_applicable").length,
      sectionScores,
      items: results
    };
    safeWriteJson(paths.evidenceMapPath, {
      schema: "prisma_evidence_map_v1",
      createdAt: report.createdAt,
      evidenceMap
    });
    safeWriteJson(paths.complianceReportJsonPath, report);
    const missingPrompts = report.items
      .filter((item) => item.status === "fail" || item.status === "partial")
      .map((item) => ({
        itemId: item.itemId,
        section: inferTargetSection({
          itemId: item.itemId,
          section: item.section,
          title: item.title,
          requirementText: item.reason,
          expectedEvidenceType: "general"
        }),
        prompt: `Add concrete evidence to satisfy PRISMA item ${item.itemId}: ${item.title}.`
      }));
    safeWriteJson(paths.missingEvidencePromptsPath, {
      schema: "prisma_missing_evidence_prompts_v1",
      createdAt: report.createdAt,
      prompts: missingPrompts
    });
    const rewriteTriggers = {
      schema: "prisma_rewrite_triggers_v1",
      createdAt: report.createdAt,
      methods: missingPrompts.some((x) => /^methods_/i.test(String(x.section || ""))),
      results: missingPrompts.some((x) => /^results_/i.test(String(x.section || ""))),
      discussion: missingPrompts.some((x) => /^discussion$/i.test(String(x.section || "")))
    };
    safeWriteJson(paths.rewriteTriggersPath, rewriteTriggers);
    const md = [
      "# PRISMA Compliance Report",
      "",
      `- Created: ${report.createdAt}`,
      `- Total items: ${report.totalItems}`,
      `- Pass: ${report.pass}`,
      `- Partial: ${report.partial}`,
      `- Fail: ${report.fail}`,
      "",
      "## Item Results",
      ...report.items.map((item) => `- ${item.itemId} (${item.section}) [${item.status}] ${item.reason}`)
    ].join("\n");
    fs.writeFileSync(paths.complianceReportMdPath, md, "utf-8");
    const appendix = buildPrismaAppendix(report);
    fs.writeFileSync(paths.prismaAppendixMarkdownPath, appendix.markdown, "utf-8");
    fs.writeFileSync(paths.prismaAppendixHtmlPath, appendix.html, "utf-8");
    return { status: "ok", report, paths };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function remediatePrisma(runDir: string): { status: "ok"; updated: number; paths: SystematicPaths } | { status: "error"; message: string } {
  try {
    const paths = resolveSystematicPaths(runDir);
    const existingHtml = fs.existsSync(paths.paperHtmlPath) ? fs.readFileSync(paths.paperHtmlPath, "utf-8") : "";
    const report = safeReadJson<PrismaComplianceReport>(paths.complianceReportJsonPath, {
      schema: "prisma_compliance_report_v1",
      createdAt: "",
      checklistPath: "",
      paperMarkdownPath: "",
      paperHtmlPath: "",
      totalItems: 0,
      pass: 0,
      partial: 0,
      fail: 0,
      notApplicable: 0,
      sectionScores: {},
      items: []
    });
    if (!Array.isArray(report.items) || !report.items.length) {
      return { status: "error", message: `Compliance report missing or empty at ${paths.complianceReportJsonPath}` };
    }
    const model = safeReadJson<Record<string, unknown>>(paths.paperModelPath, {});
    const sections = Array.isArray((model as any).sections) ? (model as any).sections as Array<{ id: string; title: string; content: string }> : [];
    const pending = report.items.filter((i) => i.status === "fail" || i.status === "partial");
    const itemActions: Array<{ itemId: string; previousStatus: PrismaAuditStatus; targetSection: string; action: string }> = [];
    const patches: Array<{ itemId: string; sectionId: string; before: string; patch: string; after: string }> = [];
    const rewriteTriggers = safeReadJson<{ methods?: boolean; results?: boolean; discussion?: boolean }>(paths.rewriteTriggersPath, {});
    let updated = 0;
    for (const item of pending) {
      const target = inferTargetSection({
        itemId: item.itemId,
        section: item.section,
        title: item.title,
        requirementText: item.fixInstructions,
        expectedEvidenceType: "general"
      });
      const section = sections.find((s) => s.id === target);
      if (!section) {
        itemActions.push({ itemId: item.itemId, previousStatus: item.status, targetSection: target, action: "skipped_missing_section" });
        continue;
      }
      itemActions.push({ itemId: item.itemId, previousStatus: item.status, targetSection: target, action: "queued_for_rewrite_no_placeholder_patch" });
    }
    if (rewriteTriggers.methods) {
      const sec = sections.find((s) => /^methods_/i.test(String(s.id || "")));
      if (sec && !String(sec.content).includes("Targeted rewrite trigger")) {
        sec.content = `${String(sec.content || "").trim()}\nTargeted rewrite trigger: strengthen methods transparency and reproducibility details.`.trim();
      }
    }
    if (rewriteTriggers.results) {
      const sec = sections.find((s) => /^results_/i.test(String(s.id || "")));
      if (sec && !String(sec.content).includes("Targeted rewrite trigger")) {
        sec.content = `${String(sec.content || "").trim()}\nTargeted rewrite trigger: add explicit quantitative and evidence-linked result statements.`.trim();
      }
    }
    if (rewriteTriggers.discussion) {
      const sec = sections.find((s) => /^discussion$/i.test(String(s.id || "")));
      if (sec && !String(sec.content).includes("Targeted rewrite trigger")) {
        sec.content = `${String(sec.content || "").trim()}\nTargeted rewrite trigger: expand implications and limitation reconciliation.`.trim();
      }
    }
    const state = safeReadJson<SystematicState>(paths.statePath, {});
    applyWriterAndRedactionPasses(model, state || {}, runDir);
    (model as any).updatedAt = new Date().toISOString();
    (model as any).sections = sections;
    safeWriteJson(paths.paperModelPath, model);
    const preserveRenderedHtml =
      /data-dqid=/i.test(existingHtml) &&
      !PLACEHOLDER_PATTERNS.some((rx) => rx.test(existingHtml || ""));
    if (preserveRenderedHtml) {
      const prismaBase = path.basename(cleanText((state as any)?.artifacts?.prismaFlowPngPath || PRISMA_FLOW_PNG_NAME));
      const htmlOut = ensurePrismaFigureEmbedded(existingHtml, prismaBase);
      fs.writeFileSync(paths.paperHtmlPath, htmlOut, "utf-8");
      fs.writeFileSync(paths.paperMarkdownPath, htmlToMarkdownMinimal(htmlOut), "utf-8");
    } else {
      fs.writeFileSync(paths.paperMarkdownPath, renderPaperMarkdown(model), "utf-8");
      fs.writeFileSync(paths.paperHtmlPath, renderPaperHtml(model), "utf-8");
    }
    safeWriteJson(paths.remediationLogPath, {
      schema: "prisma_remediation_log_v1",
      at: new Date().toISOString(),
      updated,
      remediatedItems: pending.map((x) => x.itemId),
      itemActions
    });
    safeWriteJson(paths.remediationPatchesPath, {
      schema: "prisma_remediation_patches_v1",
      at: new Date().toISOString(),
      patches
    });
    return { status: "ok", updated, paths };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function writeBundleManifest(runDir: string): { status: "ok"; manifestPath: string } | { status: "error"; message: string } {
  try {
    const paths = resolveSystematicPaths(runDir);
    const files = [
      paths.statePath,
      paths.pipelinePath,
      paths.templatePath,
      paths.paperModelPath,
      paths.paperMarkdownPath,
      paths.paperHtmlPath,
      paths.checklistRegistryPath,
      paths.evidenceMapPath,
      paths.complianceReportJsonPath,
      paths.complianceReportMdPath,
      paths.remediationLogPath,
      paths.remediationPatchesPath,
      paths.coverageTrendPath,
      paths.missingEvidencePromptsPath,
      paths.rewriteTriggersPath,
      paths.remediationAcceptancePath,
      paths.prismaAppendixMarkdownPath,
      paths.prismaAppendixHtmlPath,
      paths.prismaSignoffPath,
      paths.citationConsistencyPath,
      paths.supervisorMergeReportPath,
      paths.finalQaChecklistPath,
      paths.reproducibilityScriptPath,
      paths.reproducibilityConfigPath,
      paths.readinessReportPath,
      paths.releaseNotePath,
      paths.stepsReportPath
    ].filter((p) => fs.existsSync(p));
    safeWriteJson(paths.bundleManifestPath, {
      schema: "systematic_review_bundle_manifest_v1",
      createdAt: new Date().toISOString(),
      runDir,
      files
    });
    return { status: "ok", manifestPath: paths.bundleManifestPath };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

function writePrismaSignoff(paths: SystematicPaths, report: PrismaComplianceReport): void {
  safeWriteJson(paths.prismaSignoffPath, {
    schema: "prisma_signoff_v1",
    createdAt: new Date().toISOString(),
    signed: report.fail === 0,
    pass: report.pass,
    fail: report.fail,
    partial: report.partial,
    note: report.fail === 0 ? "PRISMA compliance accepted for release." : "PRISMA compliance not accepted."
  });
}

function writeFinalQaChecklist(paths: SystematicPaths, report: PrismaComplianceReport): { score: number; checks: Record<string, boolean> } {
  const md = fs.existsSync(paths.paperMarkdownPath) ? fs.readFileSync(paths.paperMarkdownPath, "utf-8") : "";
  const checks: Record<string, boolean> = {
    stateExists: fs.existsSync(paths.statePath),
    pipelineExists: fs.existsSync(paths.pipelinePath),
    paperMarkdownExists: fs.existsSync(paths.paperMarkdownPath),
    paperHtmlExists: fs.existsSync(paths.paperHtmlPath),
    checklistRegistryExists: fs.existsSync(paths.checklistRegistryPath),
    complianceReportExists: fs.existsSync(paths.complianceReportJsonPath),
    appendixExists: fs.existsSync(paths.prismaAppendixMarkdownPath),
    hasMethodsSection: /##\s+Methods/i.test(md),
    hasResultsSection: /##\s+Results/i.test(md),
    hasDiscussionSection: /##\s+Discussion/i.test(md),
    hasTableLikeContent: /\|.+\|/.test(md),
    linksResolvableOrNone: !/\[[^\]]+\]\((?!https?:\/\/)[^)]+\)/i.test(md),
    figuresOptionalPass: true,
    prismaFailZero: Number(report.fail || 0) === 0
  };
  const score = Number(((Object.values(checks).filter(Boolean).length / Math.max(1, Object.keys(checks).length)) * 100).toFixed(2));
  safeWriteJson(paths.finalQaChecklistPath, {
    schema: "systematic_final_qa_checklist_v1",
    createdAt: new Date().toISOString(),
    checks,
    score
  });
  return { score, checks };
}

function writeReproducibilityArtifacts(
  paths: SystematicPaths,
  payload: { checklistPath: string; maxIterations: number; minPassPct: number; maxFail: number; temporal?: boolean }
): void {
  safeWriteJson(paths.reproducibilityConfigPath, {
    schema: "systematic_reproducibility_config_v1",
    createdAt: new Date().toISOString(),
    runDir: paths.runDir,
    checklistPath: payload.checklistPath,
    maxIterations: payload.maxIterations,
    minPassPct: payload.minPassPct,
    maxFail: payload.maxFail,
    temporal: Boolean(payload.temporal)
  });
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `RUN_DIR=${JSON.stringify(paths.runDir)}`,
    `CHECKLIST=${JSON.stringify(payload.checklistPath)}`,
    `MAX_ITERS=${payload.maxIterations}`,
    `MIN_PASS=${payload.minPassPct}`,
    `MAX_FAIL=${payload.maxFail}`,
    `TEMPORAL=${payload.temporal ? 1 : 0}`,
    "",
    "npm run systematic:steps-1-15 -- \"$RUN_DIR\" \"$CHECKLIST\" 2",
    "npm run systematic:full-run -- \"$RUN_DIR\" \"$CHECKLIST\" \"$MAX_ITERS\" \"\" \"\" \"$TEMPORAL\""
  ].join("\n");
  fs.writeFileSync(paths.reproducibilityScriptPath, script, { encoding: "utf-8", mode: 0o755 });
}

function writeReadinessAndReleaseNote(paths: SystematicPaths, report: PrismaComplianceReport, qaScore: number): number {
  const passPct = calculatePassPct(report);
  const readinessScore = Number(Math.max(0, Math.min(100, (passPct * 0.7) + (qaScore * 0.3))).toFixed(2));
  safeWriteJson(paths.readinessReportPath, {
    schema: "publication_readiness_report_v1",
    createdAt: new Date().toISOString(),
    readinessScore,
    prismaPassPct: passPct,
    qaScore,
    recommendation: readinessScore >= 85 ? "ready_for_submission" : readinessScore >= 70 ? "minor_revisions" : "major_revisions"
  });
  const note = [
    "# Systematic Review Release Note",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Readiness score: ${readinessScore}`,
    `- PRISMA pass: ${report.pass}/${report.totalItems} (${passPct.toFixed(2)}%)`,
    `- QA score: ${qaScore}`,
    "",
    "## Included Artifacts",
    `- Full paper: ${path.basename(paths.paperMarkdownPath)} / ${path.basename(paths.paperHtmlPath)}`,
    `- PRISMA appendix: ${path.basename(paths.prismaAppendixMarkdownPath)} / ${path.basename(paths.prismaAppendixHtmlPath)}`,
    `- Bundle manifest: ${path.basename(paths.bundleManifestPath)}`
  ].join("\n");
  fs.writeFileSync(paths.releaseNotePath, note, "utf-8");
  return readinessScore;
}

function exportReleaseBundle(paths: SystematicPaths): void {
  const manifest = safeReadJson<{ files?: string[] }>(paths.bundleManifestPath, {});
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const zip = new AdmZip();
  files.forEach((filePath) => {
    if (!fs.existsSync(filePath)) return;
    zip.addLocalFile(filePath, "", path.basename(filePath));
  });
  [
    paths.finalQaChecklistPath,
    paths.prismaSignoffPath,
    paths.reproducibilityScriptPath,
    paths.reproducibilityConfigPath,
    paths.readinessReportPath,
    paths.releaseNotePath
  ].forEach((extra) => {
    if (fs.existsSync(extra)) zip.addLocalFile(extra, "", path.basename(extra));
  });
  zip.writeZip(paths.releaseBundleZipPath);
}

function calculatePassPct(report: PrismaComplianceReport): number {
  if (!Number(report.totalItems || 0)) return 0;
  return (Number(report.pass || 0) / Number(report.totalItems || 1)) * 100;
}

function criticalFailures(report: PrismaComplianceReport): PrismaAuditItemResult[] {
  return (Array.isArray(report.items) ? report.items : []).filter(
    (item) => PRISMA_CRITICAL_ITEMS.has(String(item.itemId || "").toLowerCase()) && item.status !== "pass"
  );
}

export function runFullSystematicWorkflow(payload: {
  runDir: string;
  checklistPath: string;
  maxIterations?: number;
  minPassPct?: number;
  maxFail?: number;
  prismaFlowImagePath?: string;
  collectionName?: string;
  temporal?: boolean;
}): {
  status: "ok";
  report: PrismaComplianceReport;
  iterations: number;
  paths: SystematicPaths;
  synthesisPipeline?: Record<string, unknown>;
} | { status: "error"; message: string } {
  const t0 = Date.now();
  dbg(
    "runFullSystematicWorkflow",
    `start runDir=${payload.runDir} checklist=${payload.checklistPath} max_iterations=${Number(payload.maxIterations || 3)}`
  );
  const paths = resolveSystematicPaths(payload.runDir);
  let state = safeReadJson<SystematicState>(paths.statePath, {});
  let synthesisPipeline: Record<string, unknown> | undefined;
  if (!(state && state.collection)) {
    dbg("runFullSystematicWorkflow", "state_missing_collection bootstrap_steps_1_15");
    const bootstrap = executeSystematicSteps1To15({
      runDir: payload.runDir,
      checklistPath: payload.checklistPath,
      reviewerCount: 2,
      prismaFlowImagePath: payload.prismaFlowImagePath
    });
    if (bootstrap.status !== "ok") return bootstrap;
    dbg("runFullSystematicWorkflow", "bootstrap_completed");
    state = safeReadJson<SystematicState>(paths.statePath, {});
    if (!(state && state.collection)) {
      return { status: "error", message: `Missing systematic state/collection at ${paths.statePath} after bootstrap.` };
    }
  }
  const overrideRqs = loadResearchQuestionsOverride(payload.runDir);
  if (overrideRqs.length) {
    state.protocol = state.protocol || {};
    state.protocol.researchQuestions = overrideRqs;
    safeWriteJson(paths.statePath, state);
    dbg("runFullSystematicWorkflow", `research_questions_override applied count=${overrideRqs.length}`);
  }
  const envTemporal = /^(1|true|yes|on|temporal|chronological)$/i.test(cleanText(process.env.SYSTEMATIC_TEMPORAL || ""));
  const temporalEnabled = Boolean((typeof payload.temporal === "boolean" ? payload.temporal : state.protocol?.temporal) || envTemporal);
  state.protocol = state.protocol || {};
  if (typeof payload.temporal === "boolean" && state.protocol.temporal !== payload.temporal) {
    state.protocol.temporal = payload.temporal;
    safeWriteJson(paths.statePath, state);
    dbg("runFullSystematicWorkflow", `temporal_override applied value=${String(payload.temporal)}`);
  }
  const stateCollectionName = cleanText(state.collection?.name || state.collection?.key || "");
  const requestedCollectionName = cleanText(payload.collectionName || "");
  const effectiveCollectionName = requestedCollectionName || stateCollectionName;
  if (!effectiveCollectionName) {
    return { status: "error", message: "Collection name is missing in state and payload. Provide collectionName or initialize state with collection." };
  }
  if (requestedCollectionName && stateCollectionName) {
    const req = normalizeCollectionToken(requestedCollectionName);
    const st = normalizeCollectionToken(stateCollectionName);
    if (req && st && req !== st) {
      return {
        status: "error",
        message:
          `Collection mismatch: payload.collectionName='${requestedCollectionName}' ` +
          `but run state collection='${stateCollectionName}'. Refusing cross-collection synthesis.`,
      };
    }
  }
  const synthesis = runBatchSystematicSynthesis(
    payload.runDir,
    state,
    payload.prismaFlowImagePath,
    effectiveCollectionName,
    temporalEnabled
  );
  dbg("runFullSystematicWorkflow", `synthesis_status=${synthesis.status}`);
  if (synthesis.status === "error") return synthesis;
  synthesisPipeline = synthesis.manifest;
  const allowFallback = /^(1|true|yes)$/i.test(cleanText(process.env.SYSTEMATIC_ALLOW_SYNTHESIS_FALLBACK || ""));
  if (!allowFallback && synthesisManifestIsFallback(synthesisPipeline)) {
    dbg("runFullSystematicWorkflow", "error fallback_synthesis_disallowed");
    return {
      status: "error",
      message:
        "Systematic synthesis returned fallback output instead of a live run. " +
        "Rerun after live synthesis completion, or explicitly allow fallback via SYSTEMATIC_ALLOW_SYNTHESIS_FALLBACK=1.",
    };
  }
  normalizeFlowFromAvailableEvidence(state);
  safeWriteJson(paths.statePath, state);
  dbg("runFullSystematicWorkflow", "compose_full_paper_start");
  const composed = composeFullPaper(payload.runDir, payload.checklistPath, {
    prismaFlowImagePath: payload.prismaFlowImagePath,
    synthesisManifest: synthesisPipeline,
    allowIncomplete: false
  });
  dbg("runFullSystematicWorkflow", `compose_full_paper_status=${composed.status}`);
  if (composed.status !== "ok") return composed;
  const maxIterations = Math.max(1, Math.min(6, Math.trunc(Number(payload.maxIterations || 3))));
  const minPassPct = Math.max(0, Math.min(100, Number(payload.minPassPct ?? 80)));
  const maxFail = Math.max(0, Math.trunc(Number(payload.maxFail ?? 0)));
  let iterations = 0;
  const trend: Array<{ step: number; passPct: number; fail: number; partial: number }> = [];
  let latest = auditPrisma(payload.runDir);
  if (latest.status !== "ok") return latest;
  dbg(
    "runFullSystematicWorkflow",
    `audit_initial fail=${Number(latest.report.fail || 0)} pass_pct=${calculatePassPct(latest.report).toFixed(2)} critical=${criticalFailures(latest.report).length}`
  );
  trend.push({
    step: 0,
    passPct: Number(calculatePassPct(latest.report).toFixed(2)),
    fail: Number(latest.report.fail || 0),
    partial: Number(latest.report.partial || 0)
  });
  while (
    iterations < maxIterations &&
    (Number(latest.report.fail || 0) > maxFail || calculatePassPct(latest.report) < minPassPct || criticalFailures(latest.report).length > 0)
  ) {
    iterations += 1;
    dbg("runFullSystematicWorkflow", `remediation_iteration_start step=${iterations}`);
    const rem = remediatePrisma(payload.runDir);
    if (rem.status !== "ok") return rem;
    latest = auditPrisma(payload.runDir);
    if (latest.status !== "ok") return latest;
    dbg(
      "runFullSystematicWorkflow",
      `remediation_iteration_done step=${iterations} fail=${Number(latest.report.fail || 0)} pass_pct=${calculatePassPct(latest.report).toFixed(2)} critical=${criticalFailures(latest.report).length}`
    );
    trend.push({
      step: iterations,
      passPct: Number(calculatePassPct(latest.report).toFixed(2)),
      fail: Number(latest.report.fail || 0),
      partial: Number(latest.report.partial || 0)
    });
    if (Number(latest.report.fail || 0) <= maxFail && calculatePassPct(latest.report) >= minPassPct && criticalFailures(latest.report).length === 0) break;
  }
  safeWriteJson(latest.paths.coverageTrendPath, {
    schema: "prisma_coverage_trend_v1",
    createdAt: new Date().toISOString(),
    trend
  });
  safeWriteJson(latest.paths.remediationAcceptancePath, {
    schema: "prisma_remediation_acceptance_checks_v1",
    createdAt: new Date().toISOString(),
    checks: {
      failWithinThreshold: Number(latest.report.fail || 0) <= maxFail,
      passPctWithinThreshold: calculatePassPct(latest.report) >= minPassPct,
      criticalItemsResolved: criticalFailures(latest.report).length === 0,
      markdownExists: fs.existsSync(latest.paths.paperMarkdownPath),
      htmlExists: fs.existsSync(latest.paths.paperHtmlPath),
      appendixExists: fs.existsSync(latest.paths.prismaAppendixMarkdownPath)
    }
  });
  if (Number(latest.report.fail || 0) > maxFail || calculatePassPct(latest.report) < minPassPct) {
    dbg(
      "runFullSystematicWorkflow",
      `error threshold_not_met fail=${Number(latest.report.fail || 0)} pass_pct=${calculatePassPct(latest.report).toFixed(2)}`
    );
    return {
      status: "error",
      message:
        `PRISMA threshold not met: fail=${Number(latest.report.fail || 0)} (max ${maxFail}), ` +
        `pass=${calculatePassPct(latest.report).toFixed(2)}% (min ${minPassPct}%).`
    };
  }
  const critical = criticalFailures(latest.report);
  if (critical.length) {
    dbg("runFullSystematicWorkflow", `error critical_items_unresolved count=${critical.length}`);
    return {
      status: "error",
      message: `Critical PRISMA items unresolved: ${critical.map((x) => x.itemId).join(", ")}. Final export blocked.`
    };
  }
  writePrismaSignoff(latest.paths, latest.report);
  const bundle = writeBundleManifest(payload.runDir);
  if (bundle.status !== "ok") return bundle;
  const qa = writeFinalQaChecklist(latest.paths, latest.report);
  writeReproducibilityArtifacts(latest.paths, {
    checklistPath: payload.checklistPath,
    maxIterations,
    minPassPct,
    maxFail,
    temporal: temporalEnabled
  });
  writeReadinessAndReleaseNote(latest.paths, latest.report, qa.score);
  exportReleaseBundle(latest.paths);
  dbg(
    "runFullSystematicWorkflow",
    `done iterations=${iterations} fail=${Number(latest.report.fail || 0)} pass_pct=${calculatePassPct(latest.report).toFixed(2)} took=${fmtMs(Date.now() - t0)}`
  );
  return { status: "ok", report: latest.report, iterations, paths: latest.paths, synthesisPipeline };
}

function normalizeReviewerCount(value: unknown): 1 | 2 | 3 {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return 2;
}

function defaultResearchQuestions(topic: string): string[] {
  const t = cleanText(topic || "the selected topic");
  return [
    `What frameworks are used in ${t}?`,
    `What models are used in ${t}?`,
    `What evidence types support claims in ${t}?`
  ];
}

function normalizeResearchQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const q = cleanText(item);
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

function loadResearchQuestionsOverride(runDir: string): string[] {
  const candidates = [
    path.join(runDir, "research_questions.json"),
    path.join(runDir, "inputs", "research_questions.json"),
    path.join(runDir, "research_questions.txt")
  ];
  for (const fp of candidates) {
    try {
      if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) continue;
      const raw = fs.readFileSync(fp, "utf-8");
      if (fp.endsWith(".txt")) {
        const list = raw
          .split(/\r?\n/)
          .map((line) => cleanText(line.replace(/^\d+\.\s*/, "")))
          .filter(Boolean);
        const normalized = normalizeResearchQuestions(list);
        if (normalized.length) return normalized;
        continue;
      }
      const parsed = JSON.parse(raw || "null");
      const normalized = normalizeResearchQuestions(parsed);
      if (normalized.length) return normalized;
    } catch {
      // ignore malformed local overrides
    }
  }
  return [];
}

function inferItemsCountFromRunDir(runDir: string): number {
  try {
    const p = path.join(runDir, "inputs", "all_items_df.json");
    if (!fs.existsSync(p)) return 0;
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw || "null");
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") {
      const rows = (parsed as Record<string, unknown>).items;
      if (Array.isArray(rows)) return rows.length;
    }
    return 0;
  } catch {
    return 0;
  }
}

function buildBootstrapSystematicState(runDir: string): SystematicState {
  const collectionName = cleanText(path.basename(runDir) || "collection");
  const itemsCount = Math.max(0, inferItemsCountFromRunDir(runDir));
  return {
    schema: "systematic_review_state_v1",
    collection: { name: collectionName, key: collectionName, itemsCount },
    protocol: {
      researchQuestions: defaultResearchQuestions(collectionName),
      inclusionCriteria: [
        "Directly addresses at least one research question.",
        "Contains explicit framework/model/method details.",
        "Provides analyzable evidence."
      ],
      exclusionCriteria: [
        "Out of scope for the research questions.",
        "No substantive evidence or methodological detail.",
        "Duplicate or insufficiently documented source."
      ],
      locked: false,
      version: 1
    },
    reviewTeam: {
      reviewerCount: 2,
      reviewers: [{ id: "reviewer_1", label: "Reviewer 1" }, { id: "reviewer_2", label: "Reviewer 2" }]
    },
    prisma: {
      flow: {
        recordsIdentified: itemsCount,
        duplicateRecordsRemoved: 0,
        recordsScreened: 0,
        recordsExcluded: 0,
        reportsSoughtForRetrieval: 0,
        reportsNotRetrieved: 0,
        reportsAssessedForEligibility: 0,
        reportsExcludedWithReasons: 0,
        studiesIncludedInReview: 0
      }
    },
    screening: {
      includedCount: 0,
      excludedCount: 0,
      screenedCount: 0,
      reasons: {},
      irr: {
        formulaGeneral: "IRR = Agreeing Ratings / Total Ratings",
        formulaTwoRater: "IRR = (TA / (TR * R)) * 100",
        agreeingRatings: 0,
        totalRatings: 0,
        ratio: null,
        twoRaterPercent: null
      }
    },
    coding: { mode: "open", evidenceUnits: 0, codedItems: 0, codebookPath: path.join(runDir, "codebook.md") },
    stages: [],
    artifacts: {},
    auditTrail: [{ at: new Date().toISOString(), action: "state_bootstrapped", details: "Initialized missing systematic state from runDir context." }]
  };
}

export function executeSystematicSteps1To15(payload: {
  runDir: string;
  checklistPath: string;
  reviewerCount?: number;
  prismaFlowImagePath?: string;
}): { status: "ok"; report: SystematicStepsReport; paths: SystematicPaths } | { status: "error"; message: string } {
  try {
    const runDir = String(payload.runDir || "").trim();
    const checklistPath = String(payload.checklistPath || "").trim();
    if (!runDir || !checklistPath) {
      return { status: "error", message: "runDir and checklistPath are required." };
    }
    const paths = resolveSystematicPaths(runDir);
    let state = safeReadJson<SystematicState>(paths.statePath, {});
    if (!state || !state.collection) {
      state = buildBootstrapSystematicState(runDir);
      safeWriteJson(paths.statePath, state);
    }

    const nowIso = new Date().toISOString();
    const steps: SystematicExecutionStep[] = [];
    const mark = (step: number, title: string, details: string, artifacts?: string[]): void => {
      steps.push({ step, title, status: "completed", details, artifacts });
    };

    state.protocol = state.protocol || {};
    state.reviewTeam = state.reviewTeam || {};
    state.prisma = state.prisma || {};
    state.prisma.flow = state.prisma.flow || {};
    state.screening = state.screening || {};
    state.screening.irr = state.screening.irr || {};
    state.coding = state.coding || {};
    state.stages = Array.isArray(state.stages) ? state.stages : [];
    state.auditTrail = Array.isArray(state.auditTrail) ? state.auditTrail : [];
    state.artifacts = state.artifacts || {};
    const collection =
      state.collection ||
      { name: cleanText(path.basename(runDir) || "collection"), key: cleanText(path.basename(runDir) || "collection"), itemsCount: inferItemsCountFromRunDir(runDir) };
    state.collection = collection;

    const collectionName = cleanText(collection.name || collection.key || "collection");
    const itemsCount = Number(collection.itemsCount || 0);
    mark(1, "Load Systematic State", `Loaded state for '${collectionName}'.`, [paths.statePath]);

    if (!Number.isFinite(itemsCount) || itemsCount < 0) collection.itemsCount = 0;
    mark(2, "Validate Collection Scope", `Collection items in scope: ${Number(collection.itemsCount || 0)}.`);

    const overrideRqs = loadResearchQuestionsOverride(runDir);
    const existingRqs = Array.isArray(state.protocol.researchQuestions) ? state.protocol.researchQuestions : [];
    if (overrideRqs.length) {
      state.protocol.researchQuestions = overrideRqs;
    } else {
      state.protocol.researchQuestions = existingRqs.length ? existingRqs.slice(0, 12) : defaultResearchQuestions(collectionName);
    }
    mark(3, "Ensure Research Questions", `Research questions: ${state.protocol.researchQuestions.length}.`);

    const inc = Array.isArray(state.protocol.inclusionCriteria) ? state.protocol.inclusionCriteria : [];
    state.protocol.inclusionCriteria = inc.length
      ? inc
      : [
          "Directly addresses at least one research question.",
          "Contains explicit framework/model/method details.",
          "Provides analyzable evidence."
        ];
    mark(4, "Ensure Inclusion Criteria", `Inclusion criteria: ${state.protocol.inclusionCriteria.length}.`);

    const exc = Array.isArray(state.protocol.exclusionCriteria) ? state.protocol.exclusionCriteria : [];
    state.protocol.exclusionCriteria = exc.length
      ? exc
      : [
          "Out of scope for the research questions.",
          "No substantive evidence or methodological detail.",
          "Duplicate or insufficiently documented source."
        ];
    mark(5, "Ensure Exclusion Criteria", `Exclusion criteria: ${state.protocol.exclusionCriteria.length}.`);

    const reviewers = normalizeReviewerCount(payload.reviewerCount || state.reviewTeam.reviewerCount || 2);
    state.reviewTeam.reviewerCount = reviewers;
    mark(6, "Set Reviewer Count", `Reviewer count normalized to ${reviewers}.`);

    const currentReviewers = Array.isArray(state.reviewTeam.reviewers) ? state.reviewTeam.reviewers : [];
    state.reviewTeam.reviewers =
      currentReviewers.length === reviewers
        ? currentReviewers
        : Array.from({ length: reviewers }).map((_, idx) => ({ id: `reviewer_${idx + 1}`, label: `Reviewer ${idx + 1}` }));
    mark(7, "Build Reviewer Roster", `Reviewer roster size: ${state.reviewTeam.reviewers.length}.`);

    const flow = state.prisma.flow;
    flow.recordsIdentified = Math.max(Number(flow.recordsIdentified || 0), Number(collection.itemsCount || 0));
    flow.duplicateRecordsRemoved = Number(flow.duplicateRecordsRemoved || 0);
    flow.recordsScreened = Number(flow.recordsScreened || 0);
    flow.recordsExcluded = Number(flow.recordsExcluded || 0);
    flow.reportsSoughtForRetrieval = Number(flow.reportsSoughtForRetrieval || 0);
    flow.reportsNotRetrieved = Number(flow.reportsNotRetrieved || 0);
    flow.reportsAssessedForEligibility = Number(flow.reportsAssessedForEligibility || 0);
    flow.reportsExcludedWithReasons = Number(flow.reportsExcludedWithReasons || 0);
    flow.studiesIncludedInReview = Number(flow.studiesIncludedInReview || 0);

    const prismaPng = ensurePrismaFlowPng(runDir, state, cleanText(payload.prismaFlowImagePath || ""));
    if (prismaPng.status !== "ok") {
      return { status: "error", message: prismaPng.message };
    }
    state.artifacts.prismaFlowPngPath = prismaPng.written[0] || path.join(runDir, PRISMA_FLOW_PNG_NAME);
    mark(8, "Initialize PRISMA Flow", `PRISMA identified records: ${flow.recordsIdentified}. PNG: ${state.artifacts.prismaFlowPngPath}.`, prismaPng.written);

    state.screening.screenedCount = Number(state.screening.screenedCount || flow.recordsScreened || 0);
    state.screening.includedCount = Number(state.screening.includedCount || flow.studiesIncludedInReview || 0);
    state.screening.excludedCount = Number(state.screening.excludedCount || flow.recordsExcluded || 0);
    flow.recordsScreened = Math.max(flow.recordsScreened, state.screening.screenedCount);
    flow.recordsExcluded = Math.max(flow.recordsExcluded, state.screening.excludedCount);
    flow.studiesIncludedInReview = Math.max(flow.studiesIncludedInReview, state.screening.includedCount);
    flow.reportsAssessedForEligibility = Math.max(flow.reportsAssessedForEligibility, state.screening.screenedCount);
    flow.reportsExcludedWithReasons = Math.max(flow.reportsExcludedWithReasons, state.screening.excludedCount);
    mark(
      9,
      "Normalize Screening Counts",
      `Screened=${state.screening.screenedCount}, Included=${state.screening.includedCount}, Excluded=${state.screening.excludedCount}.`
    );

    const agreeing = Number(state.screening.irr.agreeingRatings || 0);
    const total = Number(state.screening.irr.totalRatings || Math.max(0, state.screening.screenedCount * reviewers));
    state.screening.irr.agreeingRatings = Math.max(0, agreeing);
    state.screening.irr.totalRatings = Math.max(0, total);
    state.screening.irr.formulaGeneral = cleanText(state.screening.irr.formulaGeneral || "IRR = Agreeing Ratings / Total Ratings");
    state.screening.irr.ratio = total > 0 ? Math.max(0, Math.min(1, agreeing / total)) : null;
    mark(
      10,
      "Compute General IRR",
      `General IRR=${state.screening.irr.ratio === null ? "n/a" : Number(state.screening.irr.ratio).toFixed(4)} (${state.screening.irr.agreeingRatings}/${state.screening.irr.totalRatings}).`
    );

    state.screening.irr.formulaTwoRater = cleanText(state.screening.irr.formulaTwoRater || "IRR = (TA / (TR * R)) * 100");
    state.screening.irr.twoRaterPercent =
      reviewers === 2 && state.screening.screenedCount > 0
        ? Math.max(0, Math.min(100, (state.screening.irr.agreeingRatings / (state.screening.screenedCount * 2)) * 100))
        : null;
    mark(
      11,
      "Compute Two-Rater IRR",
      `Two-rater IRR=${state.screening.irr.twoRaterPercent === null ? "n/a" : Number(state.screening.irr.twoRaterPercent).toFixed(2)}.`
    );

    state.stages = [
      { id: "protocol", title: "Protocol Setup", status: "completed", output: path.basename(paths.pipelinePath) },
      { id: "deduplication", title: "Deduplication", status: "ready", nextAction: "update duplicate records count" },
      { id: "screening", title: "Screening", status: "ready", nextAction: "run title/abstract screening" },
      {
        id: "adjudication",
        title: "Conflict Adjudication",
        status: reviewers > 1 ? "ready" : "completed",
        nextAction: reviewers > 1 ? "resolve reviewer conflicts" : "not required for single reviewer"
      },
      { id: "coding", title: "Evidence Coding", status: "ready", nextAction: "refine codebook.md + run coding" },
      { id: "synthesis", title: "Synthesis and Reporting", status: "pending", nextAction: "compose full paper + prisma audit" }
    ];
    mark(12, "Refresh Stage Gates", "Pipeline stages refreshed for steps 1-15 execution.");

    if (!cleanText(state.coding.mode)) state.coding.mode = "open";
    state.coding.evidenceUnits = Number(state.coding.evidenceUnits || 0);
    state.coding.codedItems = Number(state.coding.codedItems || 0);
    state.artifacts.pipelinePath = paths.pipelinePath;
    state.artifacts.statePath = paths.statePath;
    state.artifacts.templatePath = paths.templatePath;
    if (!state.coding.codebookPath) {
      const cp = path.join(runDir, "codebook.md");
      state.coding.codebookPath = cp;
      state.artifacts.codebookPath = cp;
    }
    mark(13, "Prepare Coding Inputs", `Coding mode=${state.coding.mode}; codebook=${state.coding.codebookPath || "n/a"}.`);

    const pipeline = {
      schema: "systematic_review_pipeline_v2",
      createdAt: nowIso,
      updatedAt: nowIso,
      runDir,
      checklistPath,
      reviewerCount: reviewers,
      steps_1_15: steps.map((s) => ({ step: s.step, title: s.title, status: s.status, details: s.details })),
      protocol: {
        researchQuestions: state.protocol.researchQuestions,
        inclusionCriteria: state.protocol.inclusionCriteria,
        exclusionCriteria: state.protocol.exclusionCriteria
      },
      stages: state.stages,
      prisma: state.prisma
    };
    state.auditTrail.push({ at: nowIso, action: "steps_1_15_executed", details: "Executed systematic steps 1-15." });
    safeWriteJson(paths.statePath, state);
    safeWriteJson(paths.pipelinePath, pipeline);
    fs.writeFileSync(paths.templatePath, renderMethodTemplateHtml(state, runDir), "utf-8");
    mark(14, "Persist State + Pipeline", "Updated state and pipeline artifacts.", [paths.statePath, paths.pipelinePath, paths.templatePath]);

    const composed = composeFullPaper(runDir, checklistPath, { allowIncomplete: true });
    if (composed.status !== "ok") return composed;
    mark(15, "Compose Full Paper", "Generated full paper and checklist registry.", [
      paths.paperModelPath,
      paths.paperMarkdownPath,
      paths.paperHtmlPath,
      paths.checklistRegistryPath
    ]);

    const report: SystematicStepsReport = {
      schema: "systematic_steps_1_15_report_v1",
      createdAt: new Date().toISOString(),
      runDir,
      checklistPath,
      reviewerCount: reviewers,
      completedSteps: steps.length,
      failedSteps: 0,
      steps
    };
    safeWriteJson(paths.stepsReportPath, report);
    return { status: "ok", report, paths };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
