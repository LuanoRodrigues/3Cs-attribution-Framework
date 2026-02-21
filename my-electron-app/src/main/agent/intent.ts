import { getFeatureByFunctionName } from "./featureRegistry";

type IntentPayload = {
  intentId: "feature.run" | "agent.legacy_command" | "workflow.create_subfolder_by_topic";
  targetFunction?: string;
  confidence: number;
  riskLevel: "safe" | "confirm" | "high";
  needsClarification: boolean;
  clarificationQuestions: string[];
  args: Record<string, unknown>;
};

const clean = (value: unknown): string => String(value || "").trim();
const normalize = (value: unknown): string => clean(value).toLowerCase();

function extractTopic(raw: string): string {
  const q = raw.match(/about\s+(.+?)(?:\.|$)/i)?.[1] || raw.match(/on\s+(.+?)(?:\.|$)/i)?.[1] || "";
  return clean(q).replace(/^the\s+/i, "");
}

function parseResearchQuestionsInput(text: string): string[] {
  const raw = clean(text);
  if (!raw) return [];
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const numbered = lines
    .map((line) => {
      const m = line.match(/^\s*(\d+)[\)\].:\-]\s*(.+)$/);
      return m ? clean(m[2]) : "";
    })
    .filter(Boolean);
  const fallback = raw.split(/[;\n]+/).map((s) => s.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  return (numbered.length ? numbered : fallback).slice(0, 5);
}

function generateResearchQuestionsFromTopic(topic: string): string[] {
  const t = clean(topic) || "the selected topic";
  return [
    `How is ${t} conceptually defined across the literature?`,
    `What attribution frameworks and models are used to analyze ${t}?`,
    `What evidence sources and methods are used to support claims about ${t}?`,
    `What limitations, disagreements, or gaps appear in current approaches to ${t}?`,
    `What implications for policy or practice are identified regarding ${t}?`
  ];
}

function parseWorkflowIntent(text: string, context: Record<string, unknown> = {}): IntentPayload | null {
  const raw = clean(text);
  const low = normalize(raw);
  const workflowCue =
    /\b(subfolder|subcollection|folder)\b/.test(low) &&
    /\b(topic|about|regarding|concerning|framework|model|filter|screen|retrieve|find)\b/.test(low);
  if (!workflowCue) return null;
  const topic =
    clean(raw.match(/(?:about|regarding|concerning|topic)\s+(.+?)(?:[.?!]|$)/i)?.[1] || "") ||
    clean(raw.match(/\bfor\s+(.+?)(?:[.?!]|$)/i)?.[1] || "");
  const parentIdentifier =
    clean(context.selectedCollectionKey || "") ||
    clean(context.selectedCollectionName || "");
  const subfolderRaw =
    clean(raw.match(/(?:subfolder|subcollection|folder)\s+(?:named|called)?\s*['"]?([a-zA-Z0-9_\-\s]{2,80})/i)?.[1] || "");
  const subfolderName = clean(subfolderRaw).replace(/\s+/g, "_").toLowerCase() || (topic ? clean(topic).replace(/\s+/g, "_").toLowerCase().slice(0, 64) : "");
  const clarification: string[] = [];
  if (!parentIdentifier) clarification.push("Select a collection before creating a topic subfolder.");
  if (!topic) clarification.push("Provide the topic to filter for.");
  return {
    intentId: "workflow.create_subfolder_by_topic",
    targetFunction: "workflow-create-subfolder-by-topic",
    confidence: clarification.length ? 0.68 : 0.88,
    riskLevel: "confirm",
    needsClarification: clarification.length > 0,
    clarificationQuestions: clarification,
    args: {
      parentIdentifier,
      topic,
      subfolderName,
      confidenceThreshold: 0.6,
      maxItems: 0
    }
  };
}

export function parseVerbatimCodingIntent(text: string, context: Record<string, unknown> = {}): IntentPayload | null {
  const raw = clean(text);
  if (!/\b(code|coding|verbatim|evidence)\b/i.test(raw)) return null;
  const screening = !/\b(skip|without|disable)\s+screening\b/i.test(raw);
  const collectionName = clean(context.selectedCollectionName || "");
  const parsed = parseResearchQuestionsInput(raw);
  const topic = extractTopic(raw);
  let researchQuestions = parsed;
  if (!researchQuestions.length) researchQuestions = generateResearchQuestionsFromTopic(topic);
  if (researchQuestions.length > 5) researchQuestions = researchQuestions.slice(0, 5);
  const clarification: string[] = [];
  if (!collectionName) clarification.push("Select a collection before coding.");
  if (researchQuestions.length < 3) clarification.push("Provide 3 to 5 research questions.");
  return {
    intentId: "feature.run",
    targetFunction: "Verbatim_Evidence_Coding",
    confidence: clarification.length ? 0.7 : 0.92,
    riskLevel: "confirm",
    needsClarification: clarification.length > 0,
    clarificationQuestions: clarification,
    args: {
      dir_base: "./running_tests",
      collection_name: collectionName,
      research_questions: researchQuestions,
      prompt_key: "code_pdf_page",
      screening
    }
  };
}

export function resolveIntentForCommand(
  text: string,
  context: Record<string, unknown>,
  signatures: Record<string, { functionName?: string; args?: Array<{ key?: string; required?: boolean; default?: unknown }> }>
): { status: string; intent?: IntentPayload; message?: string } {
  const raw = clean(text);
  if (!raw) return { status: "error", message: "Command text is required." };

  const coding = parseVerbatimCodingIntent(raw, context);
  if (coding) {
    return { status: "ok", intent: coding };
  }

  const workflow = parseWorkflowIntent(raw, context);
  if (workflow) {
    return { status: "ok", intent: workflow };
  }

  if (/\b(refresh|reload)\b/i.test(raw) && /\bzotero|collection|tree|items?\b/i.test(raw)) {
    return {
      status: "ok",
      intent: {
        intentId: "agent.legacy_command",
        confidence: 0.95,
        riskLevel: "safe",
        needsClarification: false,
        clarificationQuestions: [],
        args: { text: "refresh zotero" }
      }
    };
  }

  const maybeFeature = /\b(screen|classify|export|eligibility|payload)\b/i.test(raw);
  if (maybeFeature) {
    const mapped =
      /\bclassify\b/i.test(raw)
        ? "classify_by_title"
        : /\beligibility\b/i.test(raw)
          ? "set_eligibility_criteria"
          : /\bexport\b/i.test(raw)
            ? "export_collection_to_csv"
            : /\bpayload\b/i.test(raw)
              ? "get_item_payload"
              : "screening_articles";
    const feature = getFeatureByFunctionName(mapped, signatures);
    if (feature) {
      const args: Record<string, unknown> = {};
      for (const arg of feature.args || []) {
        const key = String(arg?.key || "");
        if (!key) continue;
        if (Object.prototype.hasOwnProperty.call(arg, "default")) args[key] = arg.default;
      }
      if (Object.prototype.hasOwnProperty.call(args, "collection_name")) {
        args.collection_name = clean(context.selectedCollectionName || "");
      }
      return {
        status: "ok",
        intent: {
          intentId: "feature.run",
          targetFunction: mapped,
          confidence: 0.75,
          riskLevel: "confirm",
          needsClarification: false,
          clarificationQuestions: [],
          args
        }
      };
    }
  }

  return {
    status: "ok",
    intent: {
      intentId: "agent.legacy_command",
      confidence: 0.3,
      riskLevel: "confirm",
      needsClarification: true,
      clarificationQuestions: [
        "I could not map that command. Try a coding request, or specify a concrete action like 'screening articles'."
      ],
      args: { text: raw }
    }
  };
}
