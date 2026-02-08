import type { Editor } from "@tiptap/core";
import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { AiSettings } from "../types/ai.ts";
import { getAiSettings } from "../ui/ai_settings.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import { Fragment } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import {
  createAgentSidebar,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentActionId,
  type AgentSidebarController,
  type AgentProgressEvent
} from "../ui/agent_sidebar.ts";
import { appendAgentHistoryMessage, getAgentHistory } from "../ui/agent_history.ts";
import { buildLlmCacheKey, getLlmCacheEntry, setLlmCacheEntry } from "../ui/llm_cache.ts";

type AgentContext = {
  scope: "selection" | "document";
  instruction: string;
  actionId?: AgentActionId;
  selection?: { from: number; to: number; text: string };
  document?: { text: string };
  documentJson?: object;
  blocks?: Array<{ n: number; type: string; attrs?: unknown; text: string; nodeJson?: unknown }>;
  targets?: Array<{ n: number; headingNumber?: string; headingTitle?: string }>;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  settings?: AiSettings;
};

type AgentBridge = {
  request: (
    request: { requestId?: string; payload: AgentContext }
  ) => Promise<{
    success: boolean;
    assistantText?: string;
    applyText?: string;
    operations?: Array<
      | { op: "replaceSelection"; text: string }
      | { op: "replaceParagraph"; n: number; text: string }
      | { op: "replaceDocument"; text: string }
    >;
    error?: string;
    meta?: { provider?: string; model?: string; ms?: number };
  }>;
  run?: (
    request: { requestId?: string; payload: AgentContext }
  ) => Promise<{
    success: boolean;
    assistantText?: string;
    applyText?: string;
    operations?: Array<
      | { op: "replaceSelection"; text: string }
      | { op: "replaceParagraph"; n: number; text: string }
      | { op: "replaceDocument"; text: string }
    >;
    error?: string;
    meta?: { provider?: string; model?: string; ms?: number };
  }>;
  onUpdate?: (handler: (update: { requestId?: string; kind?: string; message?: string; delta?: string; tool?: string }) => void) => () => void;
};

const log = (action: string) => window.codexLog?.write(`[AI_AGENT] ${action}`);
const DEFAULT_CHUNK_LIMIT = 12000;

const getAgentBridge = (): AgentBridge | null => {
  const host = getHostAdapter();
  if (host && typeof host.agentRequest === "function") {
    return {
      request: (request: { requestId?: string; payload: AgentContext }) => host.agentRequest!(request as any),
      run:
        typeof (host as any).agentRun === "function"
          ? (request: { requestId?: string; payload: AgentContext }) => (host as any).agentRun(request as any)
          : undefined,
      onUpdate:
        typeof (host as any).onAgentStreamUpdate === "function"
          ? (handler: (update: any) => void) => (host as any).onAgentStreamUpdate(handler)
          : undefined
    };
  }
  return null;
};

type ParagraphTarget = {
  n: number;
  from: number;
  to: number;
  text: string;
  type: string;
  attrs?: unknown;
  nodeJson?: unknown;
  headingNumber?: string;
  headingTitle?: string;
};

const listParagraphTargets = (
  editor: Editor
): {
  paragraphs: ParagraphTarget[];
  sectionToIndices: Map<string, number[]>;
  sectionTitleByNumber: Map<string, string>;
} => {
  const targets: ParagraphTarget[] = [];
  const sectionToIndices = new Map<string, number[]>();
  const sectionTitleByNumber = new Map<string, string>();
  let n = 0;
  const excludedParentTypes = new Set([
    "tableCell",
    "tableHeader",
    "table_cell",
    "table_header",
    "footnoteBody"
  ]);
  const headingCounters: number[] = [];
  let currentSectionNumber = "";
  let currentSectionTitle = "";

  const bumpHeading = (levelRaw: unknown): string => {
    const level = Math.max(1, Math.min(6, Number(levelRaw ?? 1) || 1));
    while (headingCounters.length < level) headingCounters.push(0);
    headingCounters[level - 1] += 1;
    for (let i = level; i < headingCounters.length; i += 1) {
      headingCounters[i] = 0;
    }
    return headingCounters.slice(0, level).join(".");
  };

  editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node, pos, parent) => {
    if (!node?.isTextblock) return true;
    if (node.type?.name === "doc") return true;
    const parentName = parent?.type?.name;
    if (parentName && excludedParentTypes.has(parentName)) return true;
    if (node.type?.name === "heading") {
      currentSectionNumber = bumpHeading((node.attrs as any)?.level);
      currentSectionTitle = String(node.textContent || "").trim();
      if (!sectionToIndices.has(currentSectionNumber)) sectionToIndices.set(currentSectionNumber, []);
      if (currentSectionNumber && currentSectionTitle) {
        sectionTitleByNumber.set(currentSectionNumber, currentSectionTitle);
      }
      return true;
    }
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    const text = editor.state.doc.textBetween(from, to, "\n").trim();
    n += 1;
    if (currentSectionNumber) {
      const list = sectionToIndices.get(currentSectionNumber) ?? [];
      list.push(n);
      sectionToIndices.set(currentSectionNumber, list);
    }
    targets.push({
      n,
      from,
      to,
      text,
      type: String(node.type?.name ?? "unknown"),
      attrs: node.attrs ?? undefined,
      nodeJson: typeof (node as any)?.toJSON === "function" ? (node as any).toJSON() : undefined,
      headingNumber: currentSectionNumber || undefined,
      headingTitle: currentSectionTitle || undefined
    });
    return true;
  });
  return { paragraphs: targets, sectionToIndices, sectionTitleByNumber };
};

const normalizeInsertPos = (editor: Editor, insertPosRaw: number): number => {
  const doc = editor.state.doc;
  const schema: any = (editor as any).schema;
  const pageType = schema?.nodes?.page;
  const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
  let insertPos = clamp(Number(insertPosRaw) || 0, 0, doc.content.size);

  try {
    if (pageType) {
      const ranges: Array<{ from: number; to: number }> = [];
      doc.descendants((node, pos) => {
        if (node?.type === pageType) {
          ranges.push({ from: pos + 1, to: pos + node.nodeSize - 1 });
          return false;
        }
        return true;
      });
      if (ranges.length) {
        const match = ranges.find((r) => insertPos >= r.from && insertPos <= r.to) ?? ranges[ranges.length - 1]!;
        insertPos = clamp(insertPos, match.from, match.to);
      }
    }
  } catch {
    // ignore
  }

  try {
    const $pos = doc.resolve(insertPos);
    if ($pos.parent?.isTextblock) {
      insertPos = $pos.after($pos.depth);
    }
  } catch {
    // ignore
  }

  return clamp(insertPos, 0, doc.content.size);
};

const ensureHeadingAndEmptyParagraph = (
  editor: Editor,
  titleRaw: string,
  insertPosRaw: number,
  headingLevelRaw: number
): { from: number; to: number } => {
  const schema: any = (editor as any).schema;
  const headingType = schema?.nodes?.heading;
  const paragraphType = schema?.nodes?.paragraph;
  if (!headingType || !paragraphType || typeof schema?.text !== "function") {
    throw new Error("Schema missing heading/paragraph.");
  }

  const title = String(titleRaw || "").trim() || "Untitled";
  const insertPos = normalizeInsertPos(editor, insertPosRaw);
  const level = Math.max(1, Math.min(6, Number(headingLevelRaw ?? 1) || 1));
  const heading = headingType.create({ level }, [schema.text(title)]);
  const paragraph = paragraphType.createAndFill() ?? paragraphType.create({});
  const fragment = Fragment.fromArray([heading, paragraph]);

  let tr = editor.state.tr.insert(insertPos, fragment);
  tr = tr.setMeta("addToHistory", true);
  editor.view.dispatch(tr);

  const paragraphPos = insertPos + heading.nodeSize;
  return { from: paragraphPos + 1, to: paragraphPos + paragraph.nodeSize - 1 };
};

let sidebarController: AgentSidebarController | null = null;
const parseLeadingParagraphSpec = (
  instructionRaw: string,
  maxParagraph: number
): { indices: number[]; instruction: string } => {
  const raw = instructionRaw || "";
  const trimmedStart = raw.trimStart();
  const match =
    trimmedStart.match(
      /^(?:p(?:aragraph)?s?\s*)?(\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)(?:\s*,\s*\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)*\s*/i
    ) ??
    trimmedStart.match(
      /\b(?:p(?:aragraph)?s?\s*)(\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)(?:\s*,\s*\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)*\b/i
    );

  if (!match) return { indices: [], instruction: raw.trim() };

  const spec = match[0] ?? "";
  const numberList = match[0] ?? "";
  const indices = new Set<number>();
  const parts = numberList
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const normalized = part.replace(/^p(?:aragraph)?\s*/i, "").trim();
    const range = normalized.match(/^(\d{1,5})\s*(?:-|to)\s*(\d{1,5})$/i);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      for (let n = from; n <= to; n += 1) {
        if (n >= 1 && n <= maxParagraph) indices.add(n);
      }
      continue;
    }
    const single = Number(normalized);
    if (!Number.isFinite(single)) continue;
    if (single >= 1 && single <= maxParagraph) indices.add(single);
  }
  const restRaw = trimmedStart.replace(spec, " ");
  const instruction = restRaw.replace(/^[\s:–—-]+/, "").trim();
  return { indices: Array.from(indices).sort((a, b) => a - b), instruction };
};

const parseTargetSpec = (
  instructionRaw: string,
  allParagraphs: ParagraphTarget[],
  sectionToIndices: Map<string, number[]>,
  sectionTitleByNumber: Map<string, string>,
  editor: Editor
): { indices: number[]; instruction: string } => {
  const raw = instructionRaw || "";
  const trimmed = raw.trimStart();
  const maxParagraph = allParagraphs.length;

  const strip = (value: string, fragment: string) => {
    const next = value.replace(fragment, " ");
    return next.replace(/^[\s:–—-]+/, "").replace(/\s+/g, " ").trim();
  };

  const resolveIndicesFromSelection = (): number[] => {
    const sel = editor.state.selection;
    const from = Math.min(sel.from, sel.to);
    const to = Math.max(sel.from, sel.to);
    if (from === to) return [];
    return allParagraphs.filter((p) => p.to >= from && p.from <= to).map((p) => p.n);
  };

  const tokenize = (q: string): string[] => {
    const stop = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "to",
      "of",
      "in",
      "on",
      "for",
      "with",
      "about",
      "talking",
      "regarding",
      "section",
      "sections",
      "paragraph",
      "paragraphs",
      "refine",
      "shorten",
      "paraphrase",
      "proofread",
      "substantiate",
      "rewrite",
      "summarize",
      "summarise",
      "all",
      "whole",
      "entire",
      "document",
      "paper",
      "text",
      "manuscript"
    ]);
    return String(q || "")
      .toLowerCase()
      .replace(/["'“”‘’]/g, "")
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/g)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3 && !stop.has(w));
  };

  const scoreText = (text: string, terms: string[]): number => {
    const hay = String(text || "").toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (!t) continue;
      if (hay.includes(t)) score += 1;
    }
    return score;
  };

  const resolveSectionByTitle = (titleRaw: string): string | null => {
    const title = String(titleRaw || "").trim().toLowerCase();
    if (!title) return null;
    for (const [num, t] of sectionTitleByNumber.entries()) {
      const tt = String(t || "").toLowerCase();
      if (tt === title) return num;
    }
    for (const [num, t] of sectionTitleByNumber.entries()) {
      const tt = String(t || "").toLowerCase();
      if (tt.includes(title)) return num;
    }
    return null;
  };

  const resolveSectionByTopic = (query: string): number[] => {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const bySection = new Map<string, number>();
    for (const p of allParagraphs) {
      const section = String(p.headingNumber || "");
      if (!section) continue;
      const s = scoreText(p.text, terms);
      if (s <= 0) continue;
      bySection.set(section, (bySection.get(section) ?? 0) + s);
    }
    let bestSection = "";
    let bestScore = 0;
    for (const [section, s] of bySection.entries()) {
      if (s > bestScore) {
        bestScore = s;
        bestSection = section;
      }
    }
    if (!bestSection) return [];
    return (sectionToIndices.get(bestSection) ?? []).slice();
  };

  const resolveParagraphsByTopic = (query: string, maxHits: number): number[] => {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const scored = allParagraphs
      .map((p) => ({ n: p.n, score: scoreText(p.text, terms) }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score || a.n - b.n)
      .slice(0, Math.max(1, Math.min(10, maxHits)));
    return scored.map((s) => s.n);
  };

  // Selection
  const selectionMatch = trimmed.match(/\b(selection|selected text|highlighted)\b/i);
  if (selectionMatch) {
    const indices = resolveIndicesFromSelection();
    const rest = strip(trimmed, selectionMatch[0] ?? "");
    return { indices, instruction: rest };
  }

  // Whole document / all sections
  const docMatch =
    trimmed.match(/\b(whole|entire|full)\s+(document|paper|text|manuscript)\b/i) ??
    trimmed.match(/\ball\s+sections\b/i) ??
    trimmed.match(/\bentire\s+doc\b/i);
  if (docMatch) {
    const indices = allParagraphs.map((p) => p.n);
    const rest = strip(trimmed, docMatch[0] ?? "");
    return { indices, instruction: rest || trimmed };
  }

  const sectionMatch =
    trimmed.match(/\b(?:section|sec|§)\s*(\d+(?:\.\d+)*)\b/i) ??
    trimmed.match(/\b(\d+(?:\.\d+)*)\s*(?:section|sec)\b/i);
  if (sectionMatch?.[1]) {
    const sectionNumber = String(sectionMatch[1]).replace(/\.$/, "");
    const indices = sectionToIndices.get(sectionNumber) ?? [];
    const rest = strip(trimmed, sectionMatch[0] ?? "");
    return { indices: indices.slice(), instruction: rest };
  }

  // Heading by title
  const headingQuoted =
    trimmed.match(/\b(?:heading|section)\s+"([^"]+)"\b/i) ??
    trimmed.match(/\b(?:heading|section)\s+'([^']+)'\b/i);
  if (headingQuoted?.[1]) {
    const sectionNumber = resolveSectionByTitle(headingQuoted[1]);
    const indices = sectionNumber ? (sectionToIndices.get(sectionNumber) ?? []).slice() : [];
    const rest = strip(trimmed, headingQuoted[0] ?? "");
    return { indices, instruction: rest };
  }

  const headingPlain = trimmed.match(
    /\b(?:the\s+)?(?:heading|section)\s+([^\d][^.,;:]+?)(?=\s+(?:for|to|in|with|by|that)\b|$)/i
  );
  if (headingPlain?.[1]) {
    const title = String(headingPlain[1]).trim();
    let sectionNumber = resolveSectionByTitle(title);
    if (!sectionNumber) {
      const byTopic = resolveSectionByTopic(title);
      if (byTopic.length > 0) {
        return { indices: byTopic, instruction: strip(trimmed, headingPlain[0] ?? "") };
      }
    }
    const indices = sectionNumber ? (sectionToIndices.get(sectionNumber) ?? []).slice() : [];
    const rest = strip(trimmed, headingPlain[0] ?? "");
    return { indices, instruction: rest };
  }

  // Section about topic
  const sectionTopic = trimmed.match(/\bsection\s+(?:about|on|regarding|talking about)\s+(.+?)\s*$/i);
  if (sectionTopic?.[1]) {
    const indices = resolveSectionByTopic(sectionTopic[1]);
    const rest = strip(trimmed, sectionTopic[0] ?? "");
    return { indices, instruction: rest };
  }

  // Paragraph(s) about topic
  const paraTopic = trimmed.match(/\bparagraphs?\s+(?:about|on|regarding|containing)\s+(.+?)\s*$/i);
  if (paraTopic?.[1]) {
    const indices = resolveParagraphsByTopic(paraTopic[1], 3);
    const rest = strip(trimmed, paraTopic[0] ?? "");
    return { indices, instruction: rest };
  }

  return parseLeadingParagraphSpec(instructionRaw, maxParagraph);
};

const ensureEmptyParagraphAt = (
  editor: Editor,
  insertPosRaw: number
): { from: number; to: number } => {
  const schema: any = (editor as any).schema;
  const paragraphType = schema?.nodes?.paragraph;
  if (!paragraphType) {
    throw new Error("Schema missing paragraph.");
  }

  const insertPos = normalizeInsertPos(editor, insertPosRaw);

  const paragraph = paragraphType.createAndFill() ?? paragraphType.create({});
  const fragment = Fragment.fromArray([paragraph]);
  let tr = editor.state.tr.insert(insertPos, fragment);
  tr = tr.setMeta("addToHistory", true);
  editor.view.dispatch(tr);

  const paragraphPos = insertPos;
  return { from: paragraphPos + 1, to: paragraphPos + paragraph.nodeSize - 1 };
};

const runAgent = async (
  request: AgentRunRequest,
  editorHandle: EditorHandle,
  progress?: (event: AgentProgressEvent | string) => void,
  signal?: AbortSignal,
  requestId?: string
): Promise<AgentRunResult> => {
  const instructionRaw = request.instruction.trim();
  if (!instructionRaw) {
    throw new Error("Agent: instruction is required");
  }
  const editor = editorHandle.getEditor();

  const bridge = getAgentBridge();
  if (!bridge) {
    return {
      assistantText:
        "Agent bridge is not available. (Expected `window.leditorHost.agentRequest` from Electron preload.)",
      apply: undefined
    };
  }

  const runBridge = async (ctx: AgentContext) => {
    const cacheKey = buildLlmCacheKey({
      fn: "agent.run",
      provider: ctx.settings?.provider ?? settings?.provider,
      payload: ctx
    });
    const cached = getLlmCacheEntry(cacheKey);
    if (cached?.value?.success) {
      progress?.("Cache hit.");
      return cached.value;
    }
    let unsubscribe: (() => void) | null = null;
    if (requestId && bridge.run && bridge.onUpdate) {
      unsubscribe = bridge.onUpdate((update) => {
        if (!update || (update.requestId && update.requestId !== requestId)) return;
        const kind = typeof update.kind === "string" ? update.kind : "";
        if (kind === "delta" && typeof update.delta === "string") {
          progress?.({ kind: "stream", delta: update.delta });
        } else if (kind === "tool" && typeof update.tool === "string") {
          progress?.({ kind: "tool", tool: update.tool });
        } else if (kind === "status" && typeof update.message === "string") {
          progress?.({ kind: "status", message: update.message });
        } else if (kind === "error" && typeof update.message === "string") {
          progress?.({ kind: "error", message: update.message });
        }
      });
    }
    try {
      const result = bridge.run
        ? await bridge.run({ requestId, payload: ctx })
        : await bridge.request({ requestId, payload: ctx });
      if (result?.success) {
        setLlmCacheEntry({
          key: cacheKey,
          fn: "agent.run",
          value: result,
          meta: result?.meta
        });
      }
      return result;
    } finally {
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          // ignore
        }
      }
    }
  };

  const settings = getAiSettings();
  let { paragraphs: allParagraphs, sectionToIndices, sectionTitleByNumber } = listParagraphTargets(editor);

  const selectionOverride = request.selection;
  if (selectionOverride && Number.isFinite(selectionOverride.from) && Number.isFinite(selectionOverride.to)) {
    const from = Math.min(selectionOverride.from, selectionOverride.to);
    const to = Math.max(selectionOverride.from, selectionOverride.to);
    if (from === to) {
      return { assistantText: "Select text to edit." };
    }
    const selectionText = editor.state.doc.textBetween(from, to, "\n");
    if (!selectionText.trim()) {
      return { assistantText: "Selection is empty." };
    }
    if (signal?.aborted) {
      return { assistantText: "Cancelled." };
    }
    const ctx: AgentContext = {
      scope: "selection",
      instruction: instructionRaw,
      actionId: request.actionId,
      selection: { from, to, text: selectionText },
      history: getAgentHistory(),
      settings
    };
    const result = await runBridge(ctx);
    if (signal?.aborted) {
      return { assistantText: "Cancelled." };
    }
    if (!result?.success) {
      return { assistantText: result?.error ? String(result.error) : "Agent request failed.", meta: result?.meta };
    }
    const ops = Array.isArray(result.operations) ? result.operations : [];
    const replaceOp = ops.find((op: any) => op && op.op === "replaceSelection" && typeof (op as any).text === "string") as
      | { op: "replaceSelection"; text: string }
      | undefined;
    const replaceText =
      replaceOp?.text ??
      (typeof (result as any).applyText === "string" ? String((result as any).applyText) : "");
    const assistantText = String(result.assistantText || "").trim() || "(no response)";
    appendAgentHistoryMessage({ role: "assistant", content: assistantText });
    if (!replaceText || !replaceText.trim()) {
      return { assistantText, meta: result?.meta };
    }
    return { assistantText, meta: result?.meta, apply: { kind: "replaceRange", from, to, text: replaceText } };
  }

  const normalizeTitle = (t: string) => String(t || "").trim().toLowerCase();
  const stripPrefix = (value: string, fragment: string) =>
    String(value || "")
      .replace(fragment, " ")
      .replace(/^[\s:–—-]+/, "")
      .replace(/\s+/g, " ")
      .trim();
  type HeadingTarget = { from: number; to: number; title: string; level: number };
  const getHeadingAnchors = (): { headings: HeadingTarget[]; firstHeading: HeadingTarget | null; introHeading: HeadingTarget | null } => {
    const headings: HeadingTarget[] = [];
    let firstHeading: HeadingTarget | null = null;
    let introHeading: HeadingTarget | null = null;
    const excludedParentTypes = new Set([
      "tableCell",
      "tableHeader",
      "table_cell",
      "table_header",
      "footnoteBody"
    ]);
    editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node, pos, parent) => {
      if (!node || node.type?.name !== "heading") return true;
      const parentName = parent?.type?.name;
      if (parentName && excludedParentTypes.has(parentName)) return true;
      const title = String(node.textContent || "").trim();
      const level = Math.max(1, Math.min(6, Number((node.attrs as any)?.level ?? 1) || 1));
      const from = pos;
      const to = pos + node.nodeSize;
      const entry = { from, to, title, level };
      headings.push(entry);
      if (!firstHeading) firstHeading = entry;
      if (!introHeading && normalizeTitle(title) === "introduction") introHeading = entry;
      return true;
    });
    return { headings, firstHeading, introHeading };
  };

  const genMatch =
    instructionRaw.match(/\b(?:create|write|generate)\s+(?:an?\s+|the\s+)?(abstract|introduction|methodology|findings|recommendations|conclusion)\b/i) ??
    instructionRaw.match(/^\s*(abstract|introduction|methodology|findings|recommendations|conclusion)\b/i);
  const sectionActionHint = typeof request.actionId === "string" ? normalizeTitle(request.actionId) : "";
  const sectionKindRaw = genMatch?.[1] ? normalizeTitle(genMatch[1]) : "";
  const sectionKind =
    sectionActionHint === "abstract" ||
    sectionActionHint === "introduction" ||
    sectionActionHint === "methodology" ||
    sectionActionHint === "findings" ||
    sectionActionHint === "recommendations" ||
    sectionActionHint === "conclusion"
      ? sectionActionHint
      : sectionKindRaw;
  if (sectionKind) {
    const title =
      sectionKind === "abstract"
        ? "Abstract"
        : sectionKind === "introduction"
          ? "Introduction"
          : sectionKind === "methodology"
            ? "Methodology"
          : sectionKind === "findings"
            ? "Findings"
            : sectionKind === "recommendations"
              ? "Recommendations"
              : "Conclusion";
    const { headings, firstHeading, introHeading } = getHeadingAnchors();
    const findHeadingByTitle = (label: string) =>
      headings.find((h) => normalizeTitle(h.title) === normalizeTitle(label)) ?? null;
    const findNextHeading = (heading: HeadingTarget) => {
      const idx = headings.indexOf(heading);
      if (idx < 0) return null;
      return headings[idx + 1] ?? null;
    };
    const findParagraphUnderHeading = (heading: HeadingTarget) => {
      const nextHeading = findNextHeading(heading);
      return (
        allParagraphs.find(
          (p) =>
            p.type === "paragraph" &&
            p.from > heading.to &&
            (!nextHeading || p.from < nextHeading.from)
        ) ?? null
      );
    };
    const headingHasContent = (heading: HeadingTarget) => Boolean(findParagraphUnderHeading(heading));
    const getSectionEndPos = (heading: HeadingTarget) => {
      const idx = headings.indexOf(heading);
      if (idx < 0) return editor.state.doc.content.size;
      const level = heading.level;
      for (let i = idx + 1; i < headings.length; i += 1) {
        const candidate = headings[i]!;
        if (candidate.level <= level) return candidate.from;
      }
      return editor.state.doc.content.size;
    };
    const logSectionDebug = (label: string, data: Record<string, unknown>) => {
      try {
        console.info("[agent][sections][debug]", { label, ...data });
      } catch {
        // ignore
      }
    };
    const describePos = (pos: number) => {
      const doc = editor.state.doc;
      const safe = Math.max(0, Math.min(doc.content.size, pos));
      try {
        const $pos = doc.resolve(safe);
        const before = $pos.nodeBefore;
        const after = $pos.nodeAfter;
        return {
          pos: safe,
          depth: $pos.depth,
          parent: $pos.parent?.type?.name ?? null,
          before: before?.type?.name ?? null,
          after: after?.type?.name ?? null,
          beforeText: before?.textContent ? String(before.textContent).slice(0, 80) : "",
          afterText: after?.textContent ? String(after.textContent).slice(0, 80) : ""
        };
      } catch {
        return { pos: safe };
      }
    };
    const findPrevHeading = (pos: number) =>
      headings.filter((h) => h.from < pos).slice(-1)[0] ?? null;
    const findNextHeadingByPos = (pos: number) =>
      headings.find((h) => h.from > pos) ?? null;

    const existingHeading = findHeadingByTitle(title);
    let createdHeading = false;
    let target = existingHeading ? findParagraphUnderHeading(existingHeading) : null;
    if (!existingHeading || !target) {
      try {
        const firstParagraph = allParagraphs[0] ?? null;
        const abstractH = findHeadingByTitle("Abstract");
        const introH = findHeadingByTitle("Introduction");
        const methodologyH = findHeadingByTitle("Methodology");
        const findingsH = findHeadingByTitle("Findings");
        const recsH = findHeadingByTitle("Recommendations");
        const conclusionH = findHeadingByTitle("Conclusion");
        const defaultHeadingLevel =
          introHeading?.level ??
          firstHeading?.level ??
          1;
        const docEnd = editor.state.doc.content.size;
        const insertDefault = firstParagraph ? firstParagraph.from - 1 : 0;
        const beforeIntro = introHeading ? introHeading.from : null;
        const beforeRecs = recsH ? recsH.from : null;
        const beforeConclusion = conclusionH ? conclusionH.from : null;
        let insertPos = insertDefault;
        if (!existingHeading) {
          const firstEmptyHeading = headings.find((h) => !findParagraphUnderHeading(h)) ?? null;
          if (sectionKind === "abstract") {
            if (firstEmptyHeading) {
              insertPos = firstEmptyHeading.to;
            } else if (introHeading && beforeIntro != null) {
              insertPos = beforeIntro;
            } else if (firstHeading) {
              insertPos = getSectionEndPos(firstHeading);
            } else {
              insertPos = insertDefault;
            }
          } else if (sectionKind === "introduction") {
            if (abstractH) {
              insertPos = getSectionEndPos(abstractH);
            } else if (firstHeading) {
              insertPos = getSectionEndPos(firstHeading);
            } else {
              insertPos = insertDefault;
            }
          } else if (sectionKind === "methodology") {
            if (introH) {
              insertPos = getSectionEndPos(introH);
            } else if (abstractH) {
              insertPos = getSectionEndPos(abstractH);
            } else if (firstHeading) {
              insertPos = headingHasContent(firstHeading) ? getSectionEndPos(firstHeading) : firstHeading.to;
            } else {
              insertPos = insertDefault;
            }
          } else if (sectionKind === "findings") {
            const lowerBound = methodologyH
              ? getSectionEndPos(methodologyH)
              : introH
                ? getSectionEndPos(introH)
                : abstractH
                  ? getSectionEndPos(abstractH)
                  : firstHeading
                    ? (headingHasContent(firstHeading) ? getSectionEndPos(firstHeading) : firstHeading.to)
                    : insertDefault;
            const anchor = [beforeRecs, beforeConclusion]
              .filter((pos): pos is number => typeof pos === "number" && Number.isFinite(pos))
              .sort((a, b) => a - b)[0];
            insertPos = anchor != null && anchor > lowerBound ? anchor : lowerBound;
          } else if (sectionKind === "recommendations") {
            const lowerBound = findingsH
              ? getSectionEndPos(findingsH)
              : methodologyH
                ? getSectionEndPos(methodologyH)
                : introH
                  ? getSectionEndPos(introH)
                  : abstractH
                    ? getSectionEndPos(abstractH)
                    : firstHeading
                      ? (headingHasContent(firstHeading) ? getSectionEndPos(firstHeading) : firstHeading.to)
                      : insertDefault;
            insertPos = beforeConclusion != null && beforeConclusion > lowerBound ? beforeConclusion : lowerBound;
          } else if (sectionKind === "conclusion") {
            if (recsH) {
              insertPos = getSectionEndPos(recsH);
            } else if (findingsH) {
              insertPos = getSectionEndPos(findingsH);
            } else if (methodologyH) {
              insertPos = getSectionEndPos(methodologyH);
            } else if (introH) {
              insertPos = getSectionEndPos(introH);
            } else if (abstractH) {
              insertPos = getSectionEndPos(abstractH);
            } else {
              insertPos = docEnd;
            }
          }
          const safeInsert = normalizeInsertPos(editor, insertPos);
          logSectionDebug("insert", {
            section: sectionKind,
            title,
            insertPos,
            safeInsertPos: safeInsert,
            prevHeading: (() => {
              const h = findPrevHeading(safeInsert);
              return h ? { title: h.title, from: h.from, to: h.to, level: h.level } : null;
            })(),
            nextHeading: (() => {
              const h = findNextHeadingByPos(safeInsert);
              return h ? { title: h.title, from: h.from, to: h.to, level: h.level } : null;
            })(),
            at: describePos(safeInsert)
          });
          const inserted = ensureHeadingAndEmptyParagraph(editor, title, insertPos, defaultHeadingLevel);
          createdHeading = true;
          ({ paragraphs: allParagraphs, sectionToIndices, sectionTitleByNumber } = listParagraphTargets(editor));
          target = allParagraphs.find((p) => p.from === inserted.from) ?? null;
          if (!target) {
            const nextHeading = findHeadingByTitle(title);
            target = nextHeading ? findParagraphUnderHeading(nextHeading) : null;
          }
          if (target) {
            try {
              const tr = editor.state.tr
                .setSelection(TextSelection.create(editor.state.doc, target.from))
                .scrollIntoView();
              editor.view.dispatch(tr);
              editor.view.focus();
              console.info("[agent][sections][debug]", {
                label: "focus_after_insert",
                ok: true,
                pos: target.from
              });
            } catch (error) {
              console.warn("[agent][sections][debug]", {
                label: "focus_after_insert",
                ok: false,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
        } else {
          logSectionDebug("existing_heading_no_paragraph", {
            section: sectionKind,
            title,
            heading: { title: existingHeading.title, from: existingHeading.from, to: existingHeading.to, level: existingHeading.level },
            at: describePos(existingHeading.to)
          });
          const inserted = ensureEmptyParagraphAt(editor, existingHeading.to);
          ({ paragraphs: allParagraphs, sectionToIndices, sectionTitleByNumber } = listParagraphTargets(editor));
          target = allParagraphs.find((p) => p.from === inserted.from) ?? null;
        }
      } catch (e) {
        return { assistantText: `Failed to insert ${title}: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    logSectionDebug("target", {
      section: sectionKind,
      title,
      createdHeading,
      target: target ? { n: target.n, from: target.from, to: target.to, type: target.type } : null
    });
    if (!target) return { assistantText: `Unable to locate ${title} target paragraph.` };
    const rest = stripPrefix(instructionRaw, genMatch?.[0] ?? "");
    const extra = rest ? ` Constraints: ${rest}` : "";
    const instructionBase =
      sectionKind === "abstract"
        ? "Write an academic abstract for the whole document."
        : sectionKind === "introduction"
          ? "Write an introduction for the whole document."
          : sectionKind === "methodology"
            ? "Write a methodology section for the whole document."
          : sectionKind === "findings"
            ? "Write a findings section for the whole document."
            : sectionKind === "recommendations"
              ? "Write a recommendations section for the whole document."
              : "Write a conclusion for the whole document.";
    const instruction = `${instructionBase}${extra} Replace only paragraph P${target.n}.`;
    const indices = [target.n];
    const indexSet = new Set(indices);
    const targets = allParagraphs.filter((p) => indexSet.has(p.n));
    progress?.(`Target paragraphs: ${indices.join(", ")}.`);
    const chunk = targets;

    const ctx: AgentContext = {
      scope: "document",
      instruction,
      actionId: request.actionId,
      history: getAgentHistory(),
      settings,
      targets: chunk.map((p) => ({
        n: p.n,
        headingNumber: p.headingNumber,
        headingTitle: p.headingTitle
      })),
      blocks: chunk.map((p) => ({
        n: p.n,
        type: p.type,
        attrs: p.attrs,
        text: p.text,
        nodeJson: p.nodeJson
      })),
      documentJson: editor.getJSON(),
      document: {
        text: allParagraphs
          .map((p) => [`<<<P:${p.n}>>>`, p.text, ""].join("\n"))
          .join("\n")
      }
    };
    const result = await runBridge(ctx);
    if (!result?.success) {
      return { assistantText: result?.error ? String(result.error) : "Agent request failed.", meta: result?.meta };
    }
    const ops = Array.isArray(result.operations) ? result.operations : [];
    const edits: Array<{ n: number; from: number; to: number; text: string; originalText: string }> = [];
    for (const op of ops) {
      if (!op || op.op !== "replaceParagraph") continue;
      const n = Number((op as any).n);
      let text = typeof (op as any).text === "string" ? (op as any).text : "";
      if (!Number.isFinite(n) || !text.trim()) continue;
      const t = chunk.find((p) => p.n === n);
      if (!t) continue;
      if (text.trim() !== t.text.trim()) {
        edits.push({ n: t.n, from: t.from, to: t.to, text, originalText: t.text });
      }
    }
    const assistantText = edits.length === 0 ? "No changes proposed." : `Draft ready for ${edits.length} paragraph(s).`;
    appendAgentHistoryMessage({ role: "assistant", content: assistantText });
    return edits.length === 0
      ? { assistantText, meta: result?.meta }
      : { assistantText, meta: result?.meta, apply: { kind: "batchReplace", items: edits } };
  }

  if (allParagraphs.length === 0) {
    return { assistantText: "No paragraphs found." };
  }

  const parsed = parseTargetSpec(instructionRaw, allParagraphs, sectionToIndices, sectionTitleByNumber, editor);
  const indices = parsed.indices;
  if (indices.length === 0) {
    return {
      assistantText:
        'Reference a target (e.g. "p35", "35-38", "section 3.1", "heading \\"Methods\\"", "selection", or "whole document").'
    };
  }
  const instruction = parsed.instruction;
  if (!instruction) {
    return { assistantText: 'Add an instruction after the index (e.g. "35 rewrite in formal tone").' };
  }
  const indexSet = new Set(indices);
  const targets = allParagraphs.filter((p) => indexSet.has(p.n));
  progress?.(`Target paragraphs: ${indices.join(", ")}.`);

  const MAX_PARAGRAPHS = 600;
  if (targets.length > MAX_PARAGRAPHS) {
    return { assistantText: `Too many paragraphs (${targets.length}). Narrow the list (max ${MAX_PARAGRAPHS}).` };
  }

  const chunkLimit = DEFAULT_CHUNK_LIMIT;
  const chunks: ParagraphTarget[][] = [];
  let cur: ParagraphTarget[] = [];
  let curLen = 0;
  for (const p of targets) {
    const addLen = p.text.length + 16;
    if (cur.length > 0 && curLen + addLen > chunkLimit) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(p);
    curLen += addLen;
  }
  if (cur.length) chunks.push(cur);

  const edits: Array<{ n: number; from: number; to: number; text: string; originalText: string }> = [];
  let lastMeta: { provider?: string; model?: string; ms?: number } | null = null;

  for (let i = 0; i < chunks.length; i += 1) {
    if (signal?.aborted) {
      return { assistantText: "Cancelled." };
    }
    const chunk = chunks[i]!;
    const first = chunk[0]!.n;
    const last = chunk[chunk.length - 1]!.n;
    progress?.(`Processing chunk ${i + 1}/${chunks.length} (paragraphs ${first}-${last})…`);
    const ctx: AgentContext = {
      scope: "document",
      instruction,
      actionId: request.actionId,
      history: getAgentHistory(),
      settings,
      targets: chunk.map((p) => ({
        n: p.n,
        headingNumber: p.headingNumber,
        headingTitle: p.headingTitle
      })),
      blocks: chunk.map((p) => ({
        n: p.n,
        type: p.type,
        attrs: p.attrs,
        text: p.text,
        nodeJson: p.nodeJson
      })),
      documentJson: editor.getJSON(),
      document: {
        text: chunk
          .map((p) => [`<<<P:${p.n}>>>`, p.text, ""].join("\n"))
          .join("\n")
      }
    };
    const result = await runBridge(ctx);
    if (signal?.aborted) {
      return { assistantText: "Cancelled." };
    }
    if (!result?.success) {
      return { assistantText: result?.error ? String(result.error) : "Agent request failed.", meta: result?.meta };
    }
    if (result.meta) lastMeta = result.meta;
    const ops = Array.isArray(result.operations) ? result.operations : [];
    for (const op of ops) {
      if (!op || op.op !== "replaceParagraph") continue;
      const n = Number((op as any).n);
      const text = typeof (op as any).text === "string" ? (op as any).text : "";
      if (!Number.isFinite(n) || !text.trim()) continue;
      const target = chunk.find((p) => p.n === n);
      if (!target) continue;
      if (text.trim() !== target.text.trim()) {
        edits.push({ n: target.n, from: target.from, to: target.to, text, originalText: target.text });
      }
    }
  }

  const assistantText =
    edits.length === 0 ? "No changes proposed." : `Draft ready for ${edits.length} paragraph(s).`;
  appendAgentHistoryMessage({ role: "assistant", content: assistantText });
  if (lastMeta?.provider || lastMeta?.model || typeof lastMeta?.ms === "number") {
    const parts = [
      lastMeta?.provider ? `provider=${String(lastMeta.provider)}` : "",
      lastMeta?.model ? `model=${String(lastMeta.model)}` : "",
      typeof lastMeta?.ms === "number" ? `ms=${Math.max(0, Math.round(lastMeta.ms))}` : ""
    ].filter(Boolean);
    if (parts.length) {
      progress?.(`API OK • ${parts.join(" • ")}`);
    }
  }
  if (edits.length === 0) return { assistantText, meta: lastMeta ?? undefined };
  return { assistantText, meta: lastMeta ?? undefined, apply: { kind: "batchReplace", items: edits } };
};

const ensureSidebar = (editorHandle: EditorHandle): AgentSidebarController => {
  if (sidebarController) {
    return sidebarController;
  }
  sidebarController = createAgentSidebar(editorHandle, { runAgent });
  return sidebarController;
};

registerPlugin({
  id: "ai_agent",
  commands: {
    "agent.sidebar.toggle"(editorHandle: EditorHandle) {
      const sidebar = ensureSidebar(editorHandle);
      sidebar.toggle();
      log(`sidebar.toggle -> ${sidebar.isOpen() ? "open" : "closed"}`);
      editorHandle.focus();
    },
    "agent.view.open"(editorHandle: EditorHandle, args?: { view?: unknown }) {
      const sidebar = ensureSidebar(editorHandle);
      const viewRaw = typeof args?.view === "string" ? String(args.view).trim().toLowerCase() : "";
      const view =
        viewRaw === "chat" || viewRaw === "dictionary" || viewRaw === "sections" || viewRaw === "sources"
          ? (viewRaw as "chat" | "dictionary" | "sections" | "sources")
          : null;
      if (!view) {
        throw new Error('agent.view.open requires args.view ("chat" | "dictionary" | "sections" | "sources")');
      }
      sidebar.openView(view);
      log(`view.open ${view}`);
      editorHandle.focus();
    },
    "agent.action"(editorHandle: EditorHandle, args?: { id?: unknown; mode?: unknown }) {
      const sidebar = ensureSidebar(editorHandle);
      const id = typeof args?.id === "string" ? (args.id as AgentActionId) : null;
      if (!id) {
        throw new Error('agent.action requires args.id (e.g. "refine")');
      }
      const modeRaw = typeof args?.mode === "string" ? String(args.mode).trim().toLowerCase() : "";
      const mode = modeRaw === "block" ? "block" : undefined;
      sidebar.runAction(id, mode ? { mode } : undefined);
      log(`action ${id}`);
      editorHandle.focus();
    },
    "agent.sections.runAll"(editorHandle: EditorHandle) {
      const sidebar = ensureSidebar(editorHandle);
      sidebar.runSectionsBatch();
      log("sections.runAll");
      editorHandle.focus();
    },
    "agent.dictionary.open"(editorHandle: EditorHandle, args?: { mode?: unknown }) {
      const sidebar = ensureSidebar(editorHandle);
      const modeRaw = typeof args?.mode === "string" ? String(args.mode).trim().toLowerCase() : "";
      const mode =
        modeRaw === "definition" || modeRaw === "define"
          ? "definition"
          : modeRaw === "explain"
            ? "explain"
            : modeRaw === "synonyms"
              ? "synonyms"
              : modeRaw === "antonyms"
                ? "antonyms"
                : undefined;
      sidebar.openDictionary(mode as any);
      log(`dictionary.open ${mode ?? "all"}`);
      editorHandle.focus();
    }
  }
});
