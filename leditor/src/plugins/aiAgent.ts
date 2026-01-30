import type { Editor } from "@tiptap/core";
import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { AiSettings } from "../types/ai.ts";
import { getAiSettings } from "../ui/ai_settings.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import {
  createAgentSidebar,
  type AgentScope,
  type AgentRunRequest,
  type AgentRunResult,
type AgentSidebarController
} from "../ui/agent_sidebar.ts";

type AgentContext = {
  scope: "selection" | "document";
  instruction: string;
  selection?: { from: number; to: number; text: string };
  document?: { text: string };
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

const selectionRangeFromEditor = (editor: Editor): { from: number; to: number } => {
  const { selection } = editor.state;
  if (selection.from !== selection.to) {
    return { from: selection.from, to: selection.to };
  }
  const $from = selection.$from;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.isTextblock) {
      return { from: $from.start(depth), to: $from.end(depth) };
    }
  }
  return { from: selection.from, to: selection.to };
};

type ParagraphTarget = { n: number; from: number; to: number; text: string };

const listParagraphTargets = (editor: Editor): ParagraphTarget[] => {
  const targets: ParagraphTarget[] = [];
  let n = 0;
  const excludedParentTypes = new Set([
    "tableCell",
    "tableHeader",
    "table_cell",
    "table_header",
    "footnoteBody"
  ]);
  editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node, pos, parent) => {
    if (!node?.isTextblock) return true;
    if (node.type?.name === "doc") return true;
    const parentName = parent?.type?.name;
    if (parentName && excludedParentTypes.has(parentName)) return true;
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    const text = editor.state.doc.textBetween(from, to, "\n").trim();
    n += 1;
    targets.push({ n, from, to, text });
    return true;
  });
  return targets;
};

type SectionTarget = { n: number; number: string; level: number; title: string; fromPos: number; toPos: number };

const listSections = (editor: Editor): SectionTarget[] => {
  const headingCounters: number[] = [];
  const bumpHeading = (levelRaw: unknown): string => {
    const level = Math.max(1, Math.min(6, Number(levelRaw ?? 1) || 1));
    while (headingCounters.length < level) headingCounters.push(0);
    headingCounters[level - 1] += 1;
    for (let i = level; i < headingCounters.length; i += 1) {
      headingCounters[i] = 0;
    }
    return headingCounters.slice(0, level).join(".");
  };

  const sections: Array<{ number: string; level: number; title: string; fromPos: number }> = [];
  editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node, pos) => {
    if (node?.type?.name !== "heading") return true;
    const fromPos = pos + 1;
    const toPos = pos + node.nodeSize - 1;
    const title = editor.state.doc.textBetween(fromPos, toPos, "\n").trim();
    const level = typeof (node.attrs as any)?.level === "number" ? (node.attrs as any).level : Number((node.attrs as any)?.level || 1);
    const number = bumpHeading(level);
    sections.push({ number, level: Number.isFinite(level) ? level : 1, title, fromPos: pos });
    return true;
  });
  const out: SectionTarget[] = [];
  for (let i = 0; i < sections.length; i += 1) {
    const cur = sections[i]!;
    const nextSameOrHigher = sections.slice(i + 1).find((s) => s.level <= cur.level);
    const toPos = nextSameOrHigher ? nextSameOrHigher.fromPos : editor.state.doc.content.size;
    out.push({ n: i + 1, number: cur.number, level: cur.level, title: cur.title, fromPos: cur.fromPos, toPos });
  }
  return out;
};

type HeadingTarget = { number: string; level: number; title: string; from: number; to: number };

const listHeadings = (editor: Editor): HeadingTarget[] => {
  const headingCounters: number[] = [];
  const bumpHeading = (levelRaw: unknown): string => {
    const level = Math.max(1, Math.min(6, Number(levelRaw ?? 1) || 1));
    while (headingCounters.length < level) headingCounters.push(0);
    headingCounters[level - 1] += 1;
    for (let i = level; i < headingCounters.length; i += 1) {
      headingCounters[i] = 0;
    }
    return headingCounters.slice(0, level).join(".");
  };
  const out: HeadingTarget[] = [];
  editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node, pos) => {
    if (node?.type?.name !== "heading") return true;
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    const title = editor.state.doc.textBetween(from, to, "\n").trim();
    const level =
      typeof (node.attrs as any)?.level === "number"
        ? (node.attrs as any).level
        : Number((node.attrs as any)?.level || 1);
    const number = bumpHeading(level);
    out.push({ number, level: Number.isFinite(level) ? level : 1, title, from, to });
    return true;
  });
  return out;
};

let sidebarController: AgentSidebarController | null = null;
let history: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

const extractParagraphRangeFromInstruction = (instruction: string): { from: number; to: number } | null => {
  const match = instruction.match(/\bparagraphs?\s+(\d+)\s*(?:-|to)\s*(\d+)\b/i);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return null;
  return { from: Math.min(from, to), to: Math.max(from, to) };
};

const extractSectionFromInstruction = (instruction: string): number | null => {
  const match = instruction.match(/\bsection\s+(\d+)\b/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
};

const extractHeadingNumberFromInstruction = (instruction: string): string | null => {
  const match = instruction.match(/\b(?:heading|section)\s+(\d+(?:\.\d+)*)\b/i);
  if (!match) return null;
  const value = String(match[1] || "").trim();
  if (!/^\d+(?:\.\d+)*$/.test(value)) return null;
  return value;
};

const extractHeadingTitleFromInstruction = (instruction: string): string | null => {
  const match = instruction.match(/\b(?:heading|section)\s+[“"']([^"”']+)[”"']\b/i);
  if (!match) return null;
  const value = String(match[1] || "").trim();
  if (!value) return null;
  return value;
};

const extractParagraphQueryFromInstruction = (instruction: string): string | null => {
  const match = instruction.match(/\bparagraph\s+(?:that\s+(?:mentions|contains)\s+)?[“"']([^"”']+)[”"']\b/i);
  if (!match) return null;
  const value = String(match[1] || "").trim();
  if (!value) return null;
  return value;
};

const normalizeHeadingTitle = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

const isHeadingEditInstruction = (instruction: string): boolean => {
  const v = instruction.toLowerCase();
  if (!v.includes("heading") && !v.includes("title") && !v.includes("section")) return false;
  return /\b(rename|retitle|change|edit|fix|rewrite|reword|shorten|expand)\b/i.test(instruction);
};

const runAgent = async (
  request: AgentRunRequest,
  editorHandle: EditorHandle,
  progress?: (message: string) => void,
  signal?: AbortSignal,
  requestId?: string
): Promise<AgentRunResult> => {
  const instruction = request.instruction.trim();
  if (!instruction) {
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

  const inferredParagraphs = extractParagraphRangeFromInstruction(instruction);
  const inferredSection = extractSectionFromInstruction(instruction);
  const inferredHeadingNumber = extractHeadingNumberFromInstruction(instruction);
  const inferredHeadingTitle = extractHeadingTitleFromInstruction(instruction);
  const inferredParagraphQuery = extractParagraphQueryFromInstruction(instruction);

  const editorSections = listSections(editor);
  const editorHeadings = (inferredHeadingNumber || inferredHeadingTitle) ? listHeadings(editor) : [];
  const inferredSectionFromHeadingNumber = inferredHeadingNumber
    ? editorSections.find((s) => s.number === inferredHeadingNumber) ?? null
    : null;
  const inferredSectionFromHeadingTitle = inferredHeadingTitle
    ? (() => {
        const q = normalizeHeadingTitle(inferredHeadingTitle);
        const candidates = editorSections
          .map((s) => ({ s, title: normalizeHeadingTitle(s.title) }))
          .filter((x) => x.title && (x.title === q || x.title.includes(q) || q.includes(x.title)));
        if (candidates.length === 0) return null;
        const scored = candidates
          .map((x) => ({
            s: x.s,
            score: x.title === q ? 3 : x.title.includes(q) ? 2 : 1
          }))
          .sort((a, b) => b.score - a.score);
        const bestScore = scored[0]!.score;
        const best = scored.filter((x) => x.score === bestScore).slice(0, 2);
        if (best.length === 1) return best[0]!.s;
        return null;
      })()
    : null;

  let effectiveScope: AgentScope = inferredParagraphs
    ? "paragraphs"
    : inferredSectionFromHeadingNumber || inferredSectionFromHeadingTitle || inferredSection
      ? "section"
      : request.scope;

  history.push({ role: "user", content: instruction });

  // If user wants to change a heading title, route as a selection edit on that heading.
  if (isHeadingEditInstruction(instruction) && (inferredHeadingNumber || inferredHeadingTitle) && editorHeadings.length) {
    const byNumber = inferredHeadingNumber ? editorHeadings.find((h) => h.number === inferredHeadingNumber) ?? null : null;
    const byTitle = inferredHeadingTitle
      ? (() => {
          const q = normalizeHeadingTitle(inferredHeadingTitle);
          const candidates = editorHeadings
            .map((h) => ({ h, title: normalizeHeadingTitle(h.title) }))
            .filter((x) => x.title && (x.title === q || x.title.includes(q) || q.includes(x.title)));
          if (candidates.length === 0) return null;
          const scored = candidates
            .map((x) => ({ h: x.h, score: x.title === q ? 3 : x.title.includes(q) ? 2 : 1 }))
            .sort((a, b) => b.score - a.score);
          const bestScore = scored[0]!.score;
          const best = scored.filter((x) => x.score === bestScore).slice(0, 2);
          if (best.length === 1) return best[0]!.h;
          return null;
        })()
      : null;
    const heading = byNumber ?? byTitle;
    if (heading) {
      const text = editor.state.doc.textBetween(heading.from, heading.to, "\n").trim();
      progress?.(`Targeting heading ${heading.number}${heading.title ? ` "${heading.title}"` : ""}…`);
      const ctx: AgentContext = {
        scope: "selection",
        instruction,
        history: history.slice(-12),
        settings,
        selection: { from: heading.from, to: heading.to, text }
      };
      const result = await bridge.request({ requestId, payload: ctx });
      if (!result?.success) {
        const msg = result?.error ? String(result.error) : "Agent request failed.";
        history.push({ role: "assistant", content: msg });
        return { assistantText: msg, meta: result?.meta };
      }
      const assistantText = String(result.assistantText || "").trim() || "(no response)";
      history.push({ role: "assistant", content: assistantText });
      const meta = result?.meta;
      const op = Array.isArray(result?.operations)
        ? result.operations.find((x) => x && x.op === "replaceSelection" && typeof (x as any).text === "string")
        : null;
      const applyText = op ? String((op as any).text) : typeof result.applyText === "string" ? result.applyText : "";
      if (!applyText) return { assistantText, meta };
      return { assistantText, meta, apply: { kind: "replaceRange", from: heading.from, to: heading.to, text: applyText } };
    }
  }

  const sectionForPos = (pos: number): SectionTarget | null =>
    editorSections.find((s) => pos >= s.fromPos && pos <= s.toPos) ?? null;

  const formatSectionRef = (section: SectionTarget | null): string => {
    if (!section) return "";
    const title = section.title ? ` "${section.title}"` : "";
    return `Heading ${section.number}${title}`;
  };

  if (inferredSectionFromHeadingNumber) {
    progress?.(`Matched ${formatSectionRef(inferredSectionFromHeadingNumber)}.`);
  } else if (inferredHeadingTitle && inferredSectionFromHeadingTitle) {
    progress?.(`Matched ${formatSectionRef(inferredSectionFromHeadingTitle)}.`);
  } else if (inferredHeadingTitle && editorSections.length) {
    progress?.(`Heading "${inferredHeadingTitle}" was ambiguous or not found.`);
  }

  if (!inferredParagraphs && inferredParagraphQuery) {
    const q = inferredParagraphQuery.toLowerCase();
    const candidates = listParagraphTargets(editor)
      .filter((p) => p.text.trim().length > 0)
      .filter((p) => p.text.toLowerCase().includes(q));
    if (candidates.length === 1) {
      effectiveScope = "paragraphs";
      progress?.(`Matched paragraph ${candidates[0]!.n} by query.`);
      request = { ...request, scope: "paragraphs", range: { from: candidates[0]!.n, to: candidates[0]!.n } };
    } else if (candidates.length > 1) {
      return {
        assistantText: `Multiple paragraphs matched "${inferredParagraphQuery}". Use a narrower query or specify paragraphs X–Y.`
      };
    } else {
      progress?.(`No paragraph matched "${inferredParagraphQuery}".`);
    }
  }

  if (effectiveScope === "selection") {
    const range = selectionRangeFromEditor(editor);
    const text = editor.state.doc.textBetween(range.from, range.to, "\n").trim();
    const sec = sectionForPos(range.from);
    const ref = [`Target: Selection`, sec ? `Under ${formatSectionRef(sec)}` : ""].filter(Boolean).join(" • ");
    const ctx: AgentContext = {
      scope: "selection",
      instruction: `${instruction}\n\n${ref}`,
      history: history.slice(-12),
      settings,
      selection: { ...range, text }
    };
    const result = await bridge.request({ requestId, payload: ctx });
    if (!result?.success) {
      const msg = result?.error ? String(result.error) : "Agent request failed.";
      history.push({ role: "assistant", content: msg });
      return { assistantText: msg, meta: result?.meta };
    }
    const assistantText = String(result.assistantText || "").trim() || "(no response)";
    history.push({ role: "assistant", content: assistantText });
    const meta = result?.meta;
    if (meta?.provider || meta?.model || typeof meta?.ms === "number") {
      const parts = [
        meta?.provider ? `provider=${String(meta.provider)}` : "",
        meta?.model ? `model=${String(meta.model)}` : "",
        typeof meta?.ms === "number" ? `ms=${Math.max(0, Math.round(meta.ms))}` : ""
      ].filter(Boolean);
      if (parts.length) {
        progress?.(`API OK • ${parts.join(" • ")}`);
      }
    }
    const op = Array.isArray(result?.operations)
      ? result.operations.find((x) => x && x.op === "replaceSelection" && typeof (x as any).text === "string")
      : null;
    const applyText = op ? String((op as any).text) : typeof result.applyText === "string" ? result.applyText : "";
    if (!applyText) return { assistantText, meta };
    return { assistantText, meta, apply: { kind: "replaceRange", from: range.from, to: range.to, text: applyText } };
  }

  const allParagraphs = listParagraphTargets(editor).filter((p) => p.text.trim().length > 0);
  if (allParagraphs.length === 0) {
    return { assistantText: "No paragraphs found." };
  }

  let targets: ParagraphTarget[] = [];
  if (effectiveScope === "paragraphs") {
    const from = request.range?.from ?? inferredParagraphs?.from ?? 1;
    const to = request.range?.to ?? inferredParagraphs?.to ?? from;
    targets = allParagraphs.filter((p) => p.n >= from && p.n <= to);
  } else if (effectiveScope === "section") {
    const sections = editorSections;
    const sectionN =
      inferredSectionFromHeadingNumber?.n ??
      inferredSectionFromHeadingTitle?.n ??
      request.section ??
      inferredSection ??
      1;
    const section = sections.find((s) => s.n === sectionN);
    if (!section) {
      return { assistantText: `Section ${sectionN} not found.` };
    }
    targets = allParagraphs.filter((p) => p.from >= section.fromPos && p.to <= section.toPos);
  } else {
    // document
    targets = allParagraphs;
  }

  const MAX_PARAGRAPHS = 120;
  if (targets.length > MAX_PARAGRAPHS) {
    return { assistantText: `Too many paragraphs (${targets.length}). Narrow the scope (e.g. paragraphs 5–25 or section N).` };
  }

  const buildChunkText = (chunk: ParagraphTarget[]): string => {
    const parts: string[] = [];
    for (const p of chunk) {
      parts.push(`<<<P:${p.n}>>>`);
      parts.push(p.text);
      parts.push("");
    }
    return parts.join("\n");
  };

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
      history: history.slice(-12),
      settings,
      targets: chunk.map((p) => {
        const sec = sectionForPos(p.from);
        return { n: p.n, headingNumber: sec?.number, headingTitle: sec?.title };
      }),
      document: { text: buildChunkText(chunk) }
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
    }
  }
});
