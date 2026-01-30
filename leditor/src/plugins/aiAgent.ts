import type { Editor } from "@tiptap/core";
import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { AiSettings } from "../types/ai.ts";
import { getAiSettings } from "../ui/ai_settings.ts";
import {
  createAgentSidebar,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentSidebarController
} from "../ui/agent_sidebar.ts";

type AgentContext = {
  scope: "selection" | "document";
  instruction: string;
  selection?: { from: number; to: number; text: string };
  document?: { text: string };
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  settings?: AiSettings;
};

type AgentBridge = {
  request: (
    payload: AgentContext
  ) => Promise<{ success: boolean; assistantText?: string; applyText?: string; error?: string }>;
};

const log = (action: string) => window.codexLog?.write(`[AI_AGENT] ${action}`);

const getAgentBridge = (): AgentBridge | null => {
  const host = window.leditorHost as any;
  if (host && typeof host.agentRequest === "function") {
    return { request: (payload: AgentContext) => host.agentRequest({ payload }) };
  }
  return null;
};

const docTextFromEditor = (editor: Editor): string => editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");

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

const asPlainDocJson = (text: string): object => {
  const paras = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: "doc",
    content: (paras.length ? paras : [""]).map((p) => ({
      type: "paragraph",
      content: p ? [{ type: "text", text: p }] : []
    }))
  };
};

let sidebarController: AgentSidebarController | null = null;
let history: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

const runAgent = async (request: AgentRunRequest, editorHandle: EditorHandle): Promise<AgentRunResult> => {
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

  const ctx: AgentContext = {
    scope: request.scope,
    instruction,
    history: history.slice(-20),
    settings: getAiSettings()
  };

  if (request.scope === "selection") {
    const range = selectionRangeFromEditor(editor);
    const text = editor.state.doc.textBetween(range.from, range.to, "\n").trim();
    ctx.selection = { ...range, text };
  } else {
    const text = docTextFromEditor(editor);
    if (text.length > 20_000) {
      throw new Error("Agent: document is too large for the current provider; select a smaller range.");
    }
    ctx.document = { text };
  }

  history.push({ role: "user", content: instruction });

  const result = await bridge.request(ctx);
  if (!result?.success) {
    const msg = result?.error ? String(result.error) : "Agent request failed.";
    history.push({ role: "assistant", content: msg });
    return { assistantText: msg };
  }

  const assistantText = String(result.assistantText || "").trim() || "(no response)";
  history.push({ role: "assistant", content: assistantText });

  const applyText = typeof result.applyText === "string" ? result.applyText : "";
  if (!applyText) {
    return { assistantText };
  }

  if (request.scope === "selection" && ctx.selection) {
    return { assistantText, apply: { kind: "replaceRange", from: ctx.selection.from, to: ctx.selection.to, text: applyText } };
  }

  if (request.scope === "document") {
    return { assistantText, apply: { kind: "setDocument", doc: asPlainDocJson(applyText) } };
  }

  return { assistantText };
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
