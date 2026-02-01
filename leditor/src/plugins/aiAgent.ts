import type { Editor } from "@tiptap/core";
import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { AiSettings } from "../types/ai.ts";
import { getAiSettings } from "../ui/ai_settings.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
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
): { paragraphs: ParagraphTarget[]; sectionToIndices: Map<string, number[]> } => {
  const targets: ParagraphTarget[] = [];
  const sectionToIndices = new Map<string, number[]>();
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
  return { paragraphs: targets, sectionToIndices };
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
  maxParagraph: number,
  sectionToIndices: Map<string, number[]>
): { indices: number[]; instruction: string } => {
  const raw = instructionRaw || "";
  const trimmed = raw.trimStart();

  const sectionMatch =
    trimmed.match(/\b(?:section|sec|§)\s*(\d+(?:\.\d+)*)\b/i) ??
    trimmed.match(/\b(\d+(?:\.\d+)*)\s*(?:section|sec)\b/i);
  if (sectionMatch?.[1]) {
    const sectionNumber = String(sectionMatch[1]).replace(/\.$/, "");
    const indices = sectionToIndices.get(sectionNumber) ?? [];
    const rest = trimmed.replace(sectionMatch[0] ?? "", " ").replace(/^[\s:–—-]+/, "").trim();
    return { indices: indices.slice(), instruction: rest };
  }

  return parseLeadingParagraphSpec(instructionRaw, maxParagraph);
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
  const { paragraphs: allParagraphs, sectionToIndices } = listParagraphTargets(editor);
  if (allParagraphs.length === 0) {
    return { assistantText: "No paragraphs found." };
  }
  const parsed = parseTargetSpec(instructionRaw, allParagraphs.length, sectionToIndices);
  const indices = parsed.indices;
  if (indices.length === 0) {
    return {
      assistantText:
        'Reference a target (e.g. "p35 refine", "paragraph 35", "35-38", or "section 3.1").'
    };
  }
  const instruction = parsed.instruction;
  if (!instruction) {
    return { assistantText: 'Add an instruction after the index (e.g. "35 rewrite in formal tone").' };
  }
  const indexSet = new Set(indices);
  const targets = allParagraphs.filter((p) => indexSet.has(p.n));
  progress?.(`Target paragraphs: ${indices.join(", ")}.`);

  const MAX_PARAGRAPHS = 120;
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
