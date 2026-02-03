import type { Editor } from "@tiptap/core";
import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { AiSettings } from "../types/ai.ts";
import { getAiSettings } from "../ui/ai_settings.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import { TextSelection } from "prosemirror-state";
import { Fragment } from "prosemirror-model";
import {
  createAgentSidebar,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentActionId,
  type AgentSidebarController
} from "../ui/agent_sidebar.ts";

type AgentContext = {
  scope: "selection" | "document";
  instruction: string;
  selection?: { from: number; to: number; text: string };
  document?: { text: string };
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
};

const log = (action: string) => window.codexLog?.write(`[AI_AGENT] ${action}`);

const getAgentBridge = (): AgentBridge | null => {
  const host = getHostAdapter();
  if (host && typeof host.agentRequest === "function") {
    return {
      request: (request: { requestId?: string; payload: AgentContext }) => host.agentRequest!(request as any)
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

const ensureHeadingAndEmptyParagraph = (
  editor: Editor,
  titleRaw: string,
  insertPosRaw: number
): { from: number; to: number } => {
  const schema: any = (editor as any).schema;
  const headingType = schema?.nodes?.heading;
  const paragraphType = schema?.nodes?.paragraph;
  const pageType = schema?.nodes?.page;
  if (!headingType || !paragraphType || typeof schema?.text !== "function") {
    throw new Error("Schema missing heading/paragraph.");
  }

  const title = String(titleRaw || "").trim() || "Untitled";
  const doc = editor.state.doc;
  const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
  let insertPos = clamp(Number(insertPosRaw) || 0, 0, doc.content.size);

  // Prefer inserting inside a page node so schema constraints are satisfied.
  try {
    if (pageType) {
      const $pos = doc.resolve(insertPos);
      for (let d = $pos.depth; d >= 0; d -= 1) {
        if ($pos.node(d)?.type === pageType) {
          insertPos = clamp(insertPos, $pos.start(d), $pos.end(d));
          break;
        }
      }
    }
  } catch {
    // ignore; use clamped insertPos
  }

  const heading = headingType.create({ level: 1 }, [schema.text(title)]);
  const paragraph = paragraphType.createAndFill() ?? paragraphType.create({});
  const fragment = Fragment.fromArray([heading, paragraph]);

  let tr = editor.state.tr.insert(insertPos, fragment);
  tr = tr.setMeta("addToHistory", true);
  editor.view.dispatch(tr);

  const paragraphPos = insertPos + heading.nodeSize;
  return { from: paragraphPos + 1, to: paragraphPos + paragraph.nodeSize - 1 };
};

let sidebarController: AgentSidebarController | null = null;
let history: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

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

const ensureLabeledParagraph = (
  editor: Editor,
  title: string,
  insertAt: number
): { paragraphFrom: number; paragraphTo: number; selectionFrom: number; selectionTo: number } => {
  const { state } = editor;
  const { schema } = state;
  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType) throw new Error("Schema missing paragraph.");
  const label = String(title || "").trim() || "Note";
  const paragraphNode = paragraphType.create(null, schema.text(`${label} — `));
  const insertPos = Math.max(0, Math.min(state.doc.content.size, insertAt));
  const fragment = Fragment.fromArray([paragraphNode]);
  const tr = state.tr.insert(insertPos, fragment);
  const paraPos = insertPos;
  const paragraphFrom = paraPos + 1;
  const paragraphTo = paraPos + paragraphNode.nodeSize - 1;
  const selectionFrom = paragraphFrom + `${label} — `.length;
  const selectionTo = selectionFrom;
  tr.setSelection(TextSelection.create(tr.doc, selectionFrom, selectionTo));
  tr.setMeta("leditor-ai", { kind: "agent", ts: Date.now(), op: "insertLabeledParagraph" });
  editor.view.dispatch(tr);
  editor.commands.focus();
  return { paragraphFrom, paragraphTo, selectionFrom, selectionTo };
};

const runAgent = async (
  request: AgentRunRequest,
  editorHandle: EditorHandle,
  progress?: (message: string) => void,
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

  const settings = getAiSettings();
  let { paragraphs: allParagraphs, sectionToIndices, sectionTitleByNumber } = listParagraphTargets(editor);
  if (allParagraphs.length === 0) {
    return { assistantText: "No paragraphs found." };
  }

  const normalizeTitle = (t: string) => String(t || "").trim().toLowerCase();
  const stripPrefix = (value: string, fragment: string) =>
    String(value || "")
      .replace(fragment, " ")
      .replace(/^[\s:–—-]+/, "")
      .replace(/\s+/g, " ")
      .trim();

  const genMatch =
    instructionRaw.match(/\b(?:create|write|generate)\s+(?:an?\s+)?(abstract|introduction|conclusion)\b/i) ??
    instructionRaw.match(/^\s*(abstract|introduction|conclusion)\b/i);
  if (genMatch?.[1]) {
    const kind = normalizeTitle(genMatch[1]);
    const title = kind === "abstract" ? "Abstract" : kind === "introduction" ? "Introduction" : "Conclusion";
    const labelPrefix = `${title} —`;
    const existing =
      allParagraphs.find((p) => normalizeTitle(p.text).startsWith(normalizeTitle(labelPrefix))) ?? null;
    let target = existing;
    if (!target) {
      try {
        const first = allParagraphs[0] ?? null;
        const last = allParagraphs[allParagraphs.length - 1] ?? null;
        let insertPos = first ? first.from - 1 : 0;
        if (kind === "introduction") {
          const abstractP =
            allParagraphs.find((p) => normalizeTitle(p.text).startsWith(normalizeTitle("Abstract —"))) ?? null;
          if (abstractP) insertPos = abstractP.to + 1;
        }
        if (kind === "conclusion") {
          insertPos = last ? last.to + 1 : editor.state.doc.content.size;
        }
        const inserted = ensureLabeledParagraph(editor, title, insertPos);
        ({ paragraphs: allParagraphs, sectionToIndices, sectionTitleByNumber } = listParagraphTargets(editor));
        target = allParagraphs.find((p) => p.from === inserted.paragraphFrom) ?? null;
      } catch (e) {
        return { assistantText: `Failed to insert ${title}: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    if (!target) return { assistantText: `Unable to locate ${title} target paragraph.` };
    const rest = stripPrefix(instructionRaw, genMatch[0] ?? "");
    const extra = rest ? ` Constraints: ${rest}` : "";
    const instruction =
      kind === "abstract"
        ? `Write an academic abstract for the whole document.${extra} Replace only paragraph P${target.n}. Keep the prefix "${labelPrefix} " exactly at the start.`
        : kind === "introduction"
          ? `Write an introduction for the whole document.${extra} Replace only paragraph P${target.n}. Keep the prefix "${labelPrefix} " exactly at the start.`
          : `Write a conclusion for the whole document.${extra} Replace only paragraph P${target.n}. Keep the prefix "${labelPrefix} " exactly at the start.`;
    const indices = [target.n];
    const indexSet = new Set(indices);
    const targets = allParagraphs.filter((p) => indexSet.has(p.n));
    progress?.(`Target paragraphs: ${indices.join(", ")}.`);
    const chunk = targets;

    const ctx: AgentContext = {
      scope: "document",
      instruction,
      history: [],
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
      document: {
        text: allParagraphs
          .slice(0, 200)
          .map((p) => [`<<<P:${p.n}>>>`, p.text, ""].join("\n"))
          .join("\n")
      }
    };
    const result = await bridge.request({ requestId, payload: ctx });
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
      // Ensure the generated paragraph keeps its label prefix for stability.
      if (n === target.n) {
        const want = `${labelPrefix} `;
        if (!normalizeTitle(text).startsWith(normalizeTitle(labelPrefix))) {
          text = `${want}${text.trim()}`;
        } else if (!text.startsWith(want)) {
          text = `${want}${text.replace(new RegExp(`^${labelPrefix}\\s*[-—–]?\\s*`, "i"), "").trim()}`;
        }
      }
      const t = chunk.find((p) => p.n === n);
      if (!t) continue;
      if (text.trim() !== t.text.trim()) {
        edits.push({ n: t.n, from: t.from, to: t.to, text, originalText: t.text });
      }
    }
    const assistantText = edits.length === 0 ? "No changes proposed." : `Draft ready for ${edits.length} paragraph(s).`;
    return edits.length === 0
      ? { assistantText, meta: result?.meta }
      : { assistantText, meta: result?.meta, apply: { kind: "batchReplace", items: edits } };
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

  const chunkLimit = typeof settings?.chunkSize === "number" && settings.chunkSize > 2000 ? settings.chunkSize : 12000;
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
      history: [],
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
      document: {
        text: chunk
          .map((p) => [`<<<P:${p.n}>>>`, p.text, ""].join("\n"))
          .join("\n")
      }
    };
    const result = await bridge.request({ requestId, payload: ctx });
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
  history.push({ role: "assistant", content: assistantText });
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
    "agent.action"(editorHandle: EditorHandle, args?: { id?: unknown }) {
      const sidebar = ensureSidebar(editorHandle);
      const id = typeof args?.id === "string" ? (args.id as AgentActionId) : null;
      if (!id) {
        throw new Error('agent.action requires args.id (e.g. "refine")');
      }
      sidebar.runAction(id);
      log(`action ${id}`);
      editorHandle.focus();
    }
  }
});
