import { registerPlugin } from "../legacy/api/plugin_registry.js";
import type { EditorHandle } from "../legacy/api/leditor.js";

const log = (action: string) => window.codexLog?.write(`[AI_ASSISTANT] ${action}`);

const emitAiResult = (detail: { action: string; text: string }): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent("leditor:ai-assistant", { detail }));
};

const buildSummary = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "No selection to summarize.";
  }
  const sentences = trimmed.split(/[.!?]\s+/);
  const sample = sentences.filter(Boolean).slice(0, 3);
  const summary = sample.join(". ");
  return summary || trimmed.slice(0, 120);
};

const rewriteText = (text: string): string => {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return text;
  }
  const reversed = [...words].reverse();
  return `Rewritten: ${reversed.join(" ")}`;
};

const continueText = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "AI suggests: Begin your thought with a short overview.";
  }
  return `${trimmed} ... ${trimmed.split(" ").slice(-3).join(" ")} (AI continues the idea.)`;
};

const getSelectionText = (editorHandle: EditorHandle): string => {
  const editor = editorHandle.getEditor();
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, " ").trim();
};

registerPlugin({
  id: "ai_assistant",
  commands: {
    AiSummarizeSelection(editorHandle: EditorHandle) {
      const selection = getSelectionText(editorHandle);
      const summary = buildSummary(selection);
      log(`summarize -> ${summary}`);
      emitAiResult({ action: "summarize", text: summary });
      editorHandle.focus();
    },
    AiRewriteSelection(editorHandle: EditorHandle) {
      const selection = getSelectionText(editorHandle);
      const rewritten = rewriteText(selection || "AI rewrite placeholder content.");
      const editor = editorHandle.getEditor();
      editor.chain().focus().insertContent(rewritten).run();
      log(`rewrite -> ${rewritten}`);
      emitAiResult({ action: "rewrite", text: rewritten });
      editorHandle.focus();
    },
    AiContinue(editorHandle: EditorHandle) {
      const selection = getSelectionText(editorHandle);
      const continuation = continueText(selection);
      const editor = editorHandle.getEditor();
      editor.chain().focus().insertContent(continuation).run();
      log(`continue -> ${continuation}`);
      emitAiResult({ action: "continue", text: continuation });
      editorHandle.focus();
    }
  }
});
