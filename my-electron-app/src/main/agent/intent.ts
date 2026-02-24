import { getFeatureByFunctionName } from "./featureRegistry";
import path from "path";

export type IntentPayload = {
  intentId:
    | "feature.run"
    | "agent.legacy_command"
    | "workflow.create_subfolder_by_topic"
    | "workflow.systematic_review_pipeline"
    | "workflow.literature_review_pipeline"
    | "workflow.bibliographic_review_pipeline";
  targetFunction?: string;
  confidence: number;
  riskLevel: "safe" | "confirm" | "high";
  needsClarification: boolean;
  clarificationQuestions: string[];
  args: Record<string, unknown>;
};

const clean = (value: unknown): string => String(value || "").trim();
const normalize = (value: unknown): string => clean(value).toLowerCase();
const DEFAULT_VERBATIM_DIR_BASE = resolveVerbatimAnalyseDirBase();
const COLLECTION_KEY_RE = /^[A-Za-z0-9]{8}$/;

const isBlankDirBase = (value: unknown): boolean => {
  const normalized = clean(value);
  return !normalized || normalized === "./running_tests";
};

function resolveVerbatimAnalyseDirBase(): string {
  const configured = clean(process.env.ZOTERO_ANALYSE_DIR || process.env.ANALYSE_DIR);
  if (configured) return configured;
  const home = process.env.HOME || process.env.USERPROFILE;
  return home ? path.join(home, "annotarium", "analyse", "frameworks") : "./running_tests";
}

function slugVerbatimDirName(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[\\\/]/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export function normalizeCollectionIdentifier(context: Record<string, unknown>): string {
  const collectionName = clean(context.selectedCollectionName);
  const collectionKey = clean(context.selectedCollectionKey);
  if (collectionName) return collectionName;
  if (COLLECTION_KEY_RE.test(collectionKey)) return collectionKey;
  return "";
}

function extractCollectionIdentifierFromText(raw: string): string {
  const match = clean(raw).match(/(?:\bcollection\b|\bkey\b)\s+(?:is\s+|:?\s+)?([A-Za-z0-9]{8})(?:\b|$)/i);
  return match ? match[1] : "";
}

const resolveDirCandidate = (context: Record<string, unknown>, key: string): string => {
  const raw = context?.[key];
  if (raw === undefined) return "";
  const normalized = clean(raw);
  return normalized;
};

const inferCollectionNameFromAnalyseRunPath = (rawPath: string): string => {
  const normalizedPath = clean(rawPath);
  if (!normalizedPath) return "";
  const normalizedSegments = normalizedPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment);
  if (!normalizedSegments.length) return "";

  const isRunSlug = (value: string): boolean => {
    if (!value) return false;
    const s = value.trim();
    return /^[0-9a-f]{8,}$/i.test(s) || /.+_[0-9a-f]{8,}$/i.test(s);
  };

  const sanitizeCollectionName = (value: string): string => {
    const candidate = clean(value);
    if (!candidate || candidate === "running_tests") return "";
    return candidate;
  };

  const analyseIndex = normalizedSegments.findIndex((segment) => segment.toLowerCase() === "analyse");
  if (analyseIndex >= 0 && analyseIndex + 1 < normalizedSegments.length) {
    const candidate = sanitizeCollectionName(normalizedSegments[analyseIndex + 1]);
    if (candidate) return candidate;
  }

  const lastSegment = sanitizeCollectionName(normalizedSegments[normalizedSegments.length - 1] || "");
  if (lastSegment && !isRunSlug(lastSegment) && normalizedSegments.length > 1) {
    return lastSegment;
  }

  const previousSegment = sanitizeCollectionName(normalizedSegments[normalizedSegments.length - 2] || "");
  if (previousSegment && isRunSlug(lastSegment)) {
    return previousSegment;
  }

  return "";
};

export const inferCollectionNameFromContextPath = (context: Record<string, unknown>): string => {
  const candidateKeys = [
    "selectedAnalyseRunPath",
    "analyseRunPath",
    "runPath",
    "activeRunPath",
    "selectedRunPath",
    "selectedAnalysePath",
    "selectedAnalyseBaseDir",
    "analysisBaseDir",
    "analyseBaseDir"
  ];
  for (const key of candidateKeys) {
    const inferred = inferCollectionNameFromAnalyseRunPath(clean(context[key]));
    if (inferred) return inferred;
  }
  return "";
};

export function resolveVerbatimDirBase(
  context: Record<string, unknown> = {},
  fallback: string = DEFAULT_VERBATIM_DIR_BASE
): string {
  const candidates = [
    "selectedAnalyseRunPath",
    "analyseRunPath",
    "runPath",
    "activeRunPath",
    "selectedRunPath",
    "selectedAnalysePath",
    "selectedAnalyseBaseDir",
    "analysisBaseDir",
    "analyseBaseDir",
    "baseDir",
    "dir_base"
  ];
  for (const key of candidates) {
    const candidate = resolveDirCandidate(context, key);
    if (!isBlankDirBase(candidate)) return candidate;
  }
  const collectionName = normalizeCollectionIdentifier(context);
  const collectionSlug = slugVerbatimDirName(collectionName);
  const fallbackBase = clean(fallback) || "./running_tests";
  if (collectionSlug) {
    const fallbackBaseName = path.basename(path.resolve(fallbackBase));
    if (fallbackBaseName === collectionSlug) return fallbackBase;
    return path.join(fallbackBase, collectionSlug);
  }
  return fallback;
}

function extractTopic(raw: string): string {
  const q = raw.match(/about\s+(.+?)(?:\.|$)/i)?.[1] || raw.match(/on\s+(.+?)(?:\.|$)/i)?.[1] || "";
  return clean(q).replace(/^the\s+/i, "");
}

function parseResearchQuestionsInput(text: string): string[] {
  const raw = clean(text);
  if (!raw) return [];
  const hasQuestionLabel = /\b(research\s+questions?|questions?|rq\d*)\b/i.test(raw);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const numbered = lines
    .map((line) => {
      const m = line.match(/^\s*(\d+)[\)\].:\-]\s*(.+)$/);
      return m ? clean(m[2]) : "";
    })
    .filter(Boolean);
  const fallback = hasQuestionLabel
    ? raw.split(/[;\n]+/).map((s) => s.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean)
    : [];
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

function parseOverarchingTheme(text: string, context: Record<string, unknown> = {}): string {
  const raw = clean(text);
  const explicit =
    clean(raw.match(/\boverarching\s+theme\s*[:=-]?\s*(.+?)(?:[.?!]|$)/i)?.[1] || "") ||
    clean(raw.match(/\btheme\s*[:=-]?\s*(.+?)(?:[.?!]|$)/i)?.[1] || "") ||
    clean(raw.match(/\btopic\s*[:=-]?\s*(.+?)(?:[.?!]|$)/i)?.[1] || "");
  if (explicit) return explicit;
  const fromAbout = extractTopic(raw);
  if (fromAbout) return fromAbout;
  return clean(context.selectedTopic || context.topic || "");
}

function parseCodingControlsFromText(raw: string): {
  coding_mode: "open" | "semi_structured";
  mode_specified: boolean;
  screening_blinded: boolean;
  rq_scope: number[];
  target_codes: string[];
  min_relevance: number;
  allowed_evidence_types: string[];
} {
  const text = clean(raw);
  const low = normalize(text);
  const explicitOpen = /\bopen\s+code|open\s+coding\b/i.test(text);
  const explicitSemi = /\bsemi[\s-]*structured\s+code|semi[\s-]*structured\s+coding|deductive\s+coding\b/i.test(text);
  const explicitTargeted = /\btarget(?:ed)?\s+code|target(?:ed)?\s+coding|\btargeted\b/i.test(text);
  const hasRqCue = /\b(research\s+questions?|rq\d*|question\s*[1-9]\d*)\b/i.test(text);
  const coding_mode: "open" | "semi_structured" =
    explicitOpen ? "open" : (explicitSemi || explicitTargeted || hasRqCue) ? "semi_structured" : "open";

  const rqScope = new Set<number>();
  const re = /\brq\s*([1-9]\d*)\b|\bquestion\s*([1-9]\d*)\b/gi;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text))) {
    const n = Number(m[1] || m[2] || 0);
    if (Number.isFinite(n) && n > 0) rqScope.add(n - 1);
  }

  const focusMatch =
    text.match(/(?:focus(?:ed)?\s+on|target(?:ed)?\s+(?:at|on)?|on)\s+(.+?)(?:[.?!]|$)/i) ||
    text.match(/(?:codes?|themes?)\s*[:\-]\s*(.+?)(?:[.?!]|$)/i);
  const target_codes = String(focusMatch?.[1] || "")
    .split(/,|;|\band\b/gi)
    .map((s) => clean(s).toLowerCase())
    .filter((s) => s.length >= 3)
    .slice(0, 12);

  const typeMap: Array<{ re: RegExp; key: string }> = [
    { re: /\bmethod/i, key: "method" },
    { re: /\bframework/i, key: "framework" },
    { re: /\bpolicy/i, key: "policy_position" },
    { re: /\bfindings?\b/i, key: "finding" },
    { re: /\bclaim/i, key: "claim" },
    { re: /\btaxonom/i, key: "taxonomy" },
    { re: /\blimitation/i, key: "limitation" },
    { re: /\brecommendation/i, key: "recommendation" },
    { re: /\bdefinition/i, key: "definition" },
    { re: /\bexample/i, key: "example" }
  ];
  const allowed_evidence_types = typeMap.filter((entry) => entry.re.test(text)).map((entry) => entry.key);
  const strict = /\bstrict|high\s+precision|high\s+relevance|only\s+high\b/i.test(text);
  const min_relevance = coding_mode === "semi_structured" ? (strict ? 5 : 4) : 3;
  return {
    coding_mode,
    mode_specified: explicitOpen || explicitSemi || explicitTargeted,
    screening_blinded: /\bblind(ed)?\b/i.test(raw) && /\bscreen(?:ing)?\b/i.test(text),
    rq_scope: Array.from(rqScope.values()).sort((a, b) => a - b).slice(0, 5),
    target_codes,
    min_relevance,
    allowed_evidence_types
  };
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

function parseTextListSection(rawText: string, labels: string[]): string[] {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?:${labelPattern})\\s*[:\\-]\\s*([\\s\\S]*?)(?=(?:\\n\\s*[A-Za-z][A-Za-z\\s]{1,30}\\s*[:\\-])|$)`, "i");
  const match = String(rawText || "").match(re);
  if (!match) return [];
  return String(match[1] || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function parseReviewerCountFromText(rawText: string): 1 | 2 | 3 {
  const text = String(rawText || "").toLowerCase();
  const direct = text.match(/\b([1-3])\s*(?:reviewers?|raters?)\b/i);
  if (direct) {
    const n = Number(direct[1]);
    if (n === 1 || n === 2 || n === 3) return n;
  }
  if (/\b(single reviewer|one reviewer)\b/i.test(text)) return 1;
  if (/\b(two reviewers?|dual reviewers?|pair reviewers?)\b/i.test(text)) return 2;
  if (/\b(three reviewers?|triple reviewers?)\b/i.test(text)) return 3;
  return 2;
}

function parseSystematicReviewPipelineIntent(text: string, context: Record<string, unknown> = {}): IntentPayload | null {
  const raw = clean(text);
  const low = normalize(raw);
  const isSystematicCue =
    /\b(systematic\s+review|prisma)\b/.test(low) ||
    (/\bpipeline\b/.test(low) && /\b(screening|coding|eligibility|synthesis|review)\b/.test(low));
  if (!isSystematicCue) return null;
  const collectionName = clean(context.selectedCollectionName);
  const collectionKey = clean(context.selectedCollectionKey);
  const parsedQuestions = parseResearchQuestionsInput(raw);
  const topic = extractTopic(raw);
  const generatedQuestions = generateResearchQuestionsFromTopic(topic);
  const researchQuestions = parsedQuestions.length ? parsedQuestions : generatedQuestions.slice(0, 5);
  const inclusion = parseTextListSection(raw, ["inclusion", "inclusion criteria", "include"]);
  const exclusion = parseTextListSection(raw, ["exclusion", "exclusion criteria", "exclude"]);
  const reviewerCount = parseReviewerCountFromText(raw);
  const clarification: string[] = [];
  if (!collectionName && !collectionKey) clarification.push("Select a Zotero collection before creating the systematic review pipeline.");
  if (researchQuestions.length < 3) clarification.push("Provide 3 to 5 research questions.");
  return {
    intentId: "workflow.systematic_review_pipeline",
    targetFunction: "workflow-systematic-review-pipeline",
    confidence: clarification.length ? 0.72 : 0.9,
    riskLevel: "confirm",
    needsClarification: clarification.length > 0,
    clarificationQuestions: clarification,
    args: {
      collection_name: collectionName,
      collection_key: collectionKey,
      items_count: Number(context.itemsCount || 0),
      reviewer_count: reviewerCount,
      research_questions: researchQuestions.slice(0, 5),
      inclusion_criteria: inclusion,
      exclusion_criteria: exclusion,
      prisma_checklist_path: "Research/Systematic_review/prisma_check_list.html"
    }
  };
}

function parseLiteratureOrBibliographicPipelineIntent(text: string, context: Record<string, unknown> = {}): IntentPayload | null {
  const raw = clean(text);
  const low = normalize(raw);
  const isLiterature = /\b(literature\s+review|narrative\s+review|state[\s-]+of[\s-]+the[\s-]+art\s+review|scoping\s+review|scoping\s+study)\b/.test(low);
  const isBibliographic = /\b(bibliographic\s+review|bibliometric(?:\s+analysis)?|bibliograph(?:y|ic)\s+review)\b/.test(low);
  if (!isLiterature && !isBibliographic) return null;
  const reviewType = isBibliographic ? "bibliographic" : "literature";
  const collectionName = clean(context.selectedCollectionName || inferCollectionNameFromContextPath(context));
  const collectionKey = clean(context.selectedCollectionKey);
  const parsedQuestions = parseResearchQuestionsInput(raw);
  const topic = extractTopic(raw);
  const generatedQuestions = generateResearchQuestionsFromTopic(topic);
  const researchQuestions = (parsedQuestions.length ? parsedQuestions : generatedQuestions).slice(0, 5);
  const clarification: string[] = [];
  if (!collectionName && !collectionKey) clarification.push(`Select a Zotero collection before creating the ${reviewType} review pipeline.`);
  if (researchQuestions.length < 3) clarification.push("Provide 3 to 5 research questions.");
  return {
    intentId: reviewType === "literature" ? "workflow.literature_review_pipeline" : "workflow.bibliographic_review_pipeline",
    targetFunction: reviewType === "literature" ? "workflow-literature-review-pipeline" : "workflow-bibliographic-review-pipeline",
    confidence: clarification.length ? 0.72 : 0.9,
    riskLevel: "confirm",
    needsClarification: clarification.length > 0,
    clarificationQuestions: clarification,
    args: {
      review_type: reviewType,
      collection_name: collectionName,
      collection_key: collectionKey,
      items_count: Number(context.itemsCount || 0),
      research_questions: researchQuestions,
      template_path: reviewType === "literature" ? "Research/templates/literature_review.html" : "Research/templates/bibliographic.html"
    }
  };
}

function parseReviewSupervisorIntent(
  text: string,
  context: Record<string, unknown> = {},
  defaultDirBase: string = DEFAULT_VERBATIM_DIR_BASE
): IntentPayload | null {
  const raw = clean(text);
  const low = normalize(raw);
  const supervisorCue =
    /\b(review\s+supervisor|run\s+review\s+supervisor|full\s+review\s+run|end[\s-]*to[\s-]*end\s+review)\b/.test(low) ||
    (/\bsupervisor\b/.test(low) && /\b(review|screening|eligibility|coding)\b/.test(low)) ||
    (/\beligibility\b/.test(low) && /\bscreen(?:ing)?\b/.test(low) && /\bcod(?:e|ing)\b/.test(low));
  if (!supervisorCue) return null;

  const collectionName = clean(context.selectedCollectionName || inferCollectionNameFromContextPath(context));
  const collectionKey = clean(context.selectedCollectionKey);
  const parsedQuestions = parseResearchQuestionsInput(raw);
  const researchQuestions = parsedQuestions.slice(0, 5);

  const controls = parseCodingControlsFromText(raw);
  const overarchingTheme = parseOverarchingTheme(raw, context);
  const inclusion = parseTextListSection(raw, ["inclusion", "inclusion criteria", "include"]);
  const exclusion = parseTextListSection(raw, ["exclusion", "exclusion criteria", "exclude"]);
  const disableEligibility = /\b(skip|without|disable|no)\s+eligibility\b/i.test(raw);
  const disableScreening = /\b(skip|without|disable|no)\s+screen(?:ing)?\b/i.test(raw);
  const disableCoding = /\b(skip|without|disable|no)\s+cod(?:e|ing)\b/i.test(raw);
  const dirBase = resolveVerbatimDirBase(context, defaultDirBase);

  const clarification: string[] = [];
  if (!collectionName && !collectionKey) clarification.push("Select a Zotero collection before running the review supervisor.");
  if (!overarchingTheme) clarification.push("Provide the overarching theme for coding (for example: cyber attribution).");
  if (controls.coding_mode === "semi_structured" && researchQuestions.length < 1) {
    clarification.push("Semi-structured coding requires at least one research question.");
  }

  return {
    intentId: "feature.run",
    targetFunction: "run_review_supervisor",
    confidence: clarification.length ? 0.7 : 0.92,
    riskLevel: "confirm",
    needsClarification: clarification.length > 0,
    clarificationQuestions: clarification,
    args: {
      dir_base: dirBase,
      collection_name: collectionName,
      collection_key: collectionKey,
      research_questions: researchQuestions,
      inclusion_criteria: inclusion.join("\n"),
      exclusion_criteria: exclusion.join("\n"),
      context: "",
      overarching_theme: overarchingTheme,
      run_eligibility: !disableEligibility,
      run_screening: !disableScreening,
      run_coding: !disableCoding,
      coding_mode: controls.coding_mode,
      rq_scope: controls.rq_scope,
      target_codes: controls.target_codes,
      min_relevance: controls.min_relevance,
      allowed_evidence_types: controls.allowed_evidence_types,
      screening_function: "classify_by_abs",
      screening_mode: "simple",
      use_saved_criteria: true,
      agent_generate_eligibility: inclusion.length === 0 || exclusion.length === 0,
      cache: true
    }
  };
}

export function parseVerbatimCodingIntent(
  text: string,
  context: Record<string, unknown> = {},
  defaultDirBase: string = DEFAULT_VERBATIM_DIR_BASE
): IntentPayload | null {
  const raw = clean(text);
  if (!/\b(code|coding|verbatim|evidence)\b/i.test(raw)) return null;
  const screeningRequested =
    /\b(screen|screening|eligibility|inclusion|exclusion)\b/i.test(raw) &&
    !/\b(skip|without|disable|no)\s+screen(?:ing)?\b/i.test(raw);
  const screening = screeningRequested;
  const collectionNameFromContext = clean(context.selectedCollectionName);
  const collectionKeyFromContext = clean(context.selectedCollectionKey);
  const collectionNameFromPath = inferCollectionNameFromContextPath(context);
  const collectionIdentifierFromText = extractCollectionIdentifierFromText(raw);
  const selectedItemKey = clean(context.selectedItemKey);
  const itemKeyFromText = String(raw.match(/\bitem[_\s-]*key[:=\s]*([A-Za-z0-9]{8})\b/i)?.[1] || "").trim();
  const collectionName = collectionNameFromContext || collectionNameFromPath;
  const parsed = parseResearchQuestionsInput(raw);
  const topic = extractTopic(raw);
  const overarchingTheme = parseOverarchingTheme(raw, context);
  const controls = parseCodingControlsFromText(raw);
  let researchQuestions = parsed.slice(0, 5);
  if (controls.coding_mode === "open") {
    researchQuestions = [];
  }
  const clarification: string[] = [];
  if (!collectionName && !collectionKeyFromContext && !collectionIdentifierFromText) clarification.push("Select a collection before coding.");
  if (!controls.mode_specified) clarification.push("Choose coding mode: open or semi-structured.");
  if (!overarchingTheme) clarification.push("Provide the overarching theme for coding (for example: cyber attribution).");
  if (controls.coding_mode === "semi_structured" && researchQuestions.length < 1) {
    clarification.push("Semi-structured coding requires at least one research question.");
  }
  const dirBase = resolveVerbatimDirBase(context, defaultDirBase);
  return {
    intentId: "feature.run",
    targetFunction: "Verbatim_Evidence_Coding",
    confidence: clarification.length ? 0.7 : 0.92,
    riskLevel: "confirm",
    needsClarification: clarification.length > 0,
    clarificationQuestions: clarification,
    args: {
      dir_base: dirBase,
      collection_name: collectionName,
      collection_key: collectionKeyFromContext || collectionIdentifierFromText,
      item_key: selectedItemKey || itemKeyFromText,
      overarching_theme: overarchingTheme || topic,
      research_questions: researchQuestions,
      prompt_key: "code_pdf_page",
      screening,
      coding_mode: controls.coding_mode,
      rq_scope: controls.rq_scope,
      target_codes: controls.target_codes,
      min_relevance: controls.min_relevance,
      allowed_evidence_types: controls.allowed_evidence_types
    }
  };
}

export function resolveIntentForCommand(
  text: string,
  context: Record<string, unknown>,
  signatures: Record<string, { functionName?: string; args?: Array<{ key?: string; required?: boolean; default?: unknown }> }>,
  defaultDirBase: string = DEFAULT_VERBATIM_DIR_BASE
): { status: string; intent?: IntentPayload; message?: string } {
  const raw = clean(text);
  if (!raw) return { status: "error", message: "Command text is required." };

  const reviewSupervisor = parseReviewSupervisorIntent(raw, context, defaultDirBase);
  if (reviewSupervisor) {
    return { status: "ok", intent: reviewSupervisor };
  }

  const systematic = parseSystematicReviewPipelineIntent(raw, context);
  if (systematic) {
    return { status: "ok", intent: systematic };
  }
  const reviewPipeline = parseLiteratureOrBibliographicPipelineIntent(raw, context);
  if (reviewPipeline) {
    return { status: "ok", intent: reviewPipeline };
  }

  const coding = parseVerbatimCodingIntent(raw, context, defaultDirBase);
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
        args.collection_name = clean(context.selectedCollectionName || context.selectedCollectionKey || "");
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
