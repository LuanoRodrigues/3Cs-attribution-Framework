import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import { getAiSettings } from "../ui/ai_settings.ts";
import { buildLlmCacheKey, getLlmCacheEntry, setLlmCacheEntry } from "../ui/llm_cache.ts";

const log = (action: string) => window.codexLog?.write(`[AI_ASSISTANT] ${action}`);

const emitAiResult = (detail: { action: string; text: string }): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("leditor:ai-assistant", { detail }));
};

const getSelectionText = (editorHandle: EditorHandle): { from: number; to: number; text: string } => {
  const editor = editorHandle.getEditor();
  const { from, to } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, " ").trim();
  return { from, to, text };
};

const requestAssistant = async (
  editorHandle: EditorHandle,
  action: "summarize" | "rewrite" | "continue",
  instruction: string
): Promise<{ ok: boolean; assistantText: string; replaceText?: string }> => {
  const host = getHostAdapter();
  if (!host?.agentRequest) {
    return { ok: false, assistantText: "AI host bridge unavailable." };
  }
  const sel = getSelectionText(editorHandle);
  const payload = {
    scope: "selection" as const,
    instruction,
    selection: sel,
    history: [],
    settings: getAiSettings()
  };
  const cacheKey = buildLlmCacheKey({
    fn: "assistant.request",
    provider: payload.settings?.provider,
    model: payload.settings?.model,
    payload
  });
  const cached = getLlmCacheEntry(cacheKey);
  let result: any = cached?.value ?? null;
  if (!result) {
    const requestId = `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    result = await host.agentRequest({
      requestId,
      payload
    });
    if (result?.success) {
      setLlmCacheEntry({
        key: cacheKey,
        fn: "assistant.request",
        value: result,
        meta: result?.meta
      });
    }
  }
  if (!result?.success) {
    return { ok: false, assistantText: result?.error ? String(result.error) : "AI request failed." };
  }
  const assistantText = String(result.assistantText || "").trim() || "(no response)";
  const ops = Array.isArray((result as any).operations) ? ((result as any).operations as any[]) : [];
  const replaceOp = ops.find((x) => x && x.op === "replaceSelection" && typeof x.text === "string");
  const replaceText = replaceOp ? String(replaceOp.text) : typeof result.applyText === "string" ? result.applyText : undefined;
  log(`${action} -> model=${String(result?.meta?.model || "")} ms=${String(result?.meta?.ms ?? "")}`);
  return { ok: true, assistantText, replaceText };
};

registerPlugin({
  id: "ai_assistant",
  commands: {
    async AiSummarizeSelection(editorHandle: EditorHandle) {
      const { ok, assistantText } = await requestAssistant(
        editorHandle,
        "summarize",
        "Summarize the TARGET TEXT in 3-5 bullet points. Do not modify the text. Return operations: []."
      );
      emitAiResult({ action: "summarize", text: assistantText });
      if (!ok) log(`summarize failed: ${assistantText}`);
      editorHandle.focus();
    },
    async AiRewriteSelection(editorHandle: EditorHandle) {
      const { ok, assistantText, replaceText } = await requestAssistant(
        editorHandle,
        "rewrite",
        "Rewrite the TARGET TEXT to be clearer and more formal. Return replaceSelection."
      );
      if (!ok || !replaceText) {
        emitAiResult({ action: "rewrite", text: assistantText });
        editorHandle.focus();
        return;
      }
      const editor = editorHandle.getEditor();
      const { from, to } = editor.state.selection;
      editor.chain().focus().insertContentAt({ from, to }, replaceText).run();
      emitAiResult({ action: "rewrite", text: assistantText });
      editorHandle.focus();
    },
    async AiContinue(editorHandle: EditorHandle) {
      const { ok, assistantText, replaceText } = await requestAssistant(
        editorHandle,
        "continue",
        "Continue the TARGET TEXT with 1-2 sentences that follow naturally. Return replaceSelection only if you rewrite the target; otherwise return operations: [] and put the continuation in assistantText."
      );
      if (!ok) {
        emitAiResult({ action: "continue", text: assistantText });
        editorHandle.focus();
        return;
      }
      if (replaceText) {
        const editor = editorHandle.getEditor();
        const { from, to } = editor.state.selection;
        editor.chain().focus().insertContentAt({ from, to }, replaceText).run();
        emitAiResult({ action: "continue", text: assistantText });
        editorHandle.focus();
        return;
      }
      // No replacement requested: insert continuation at cursor.
      const editor = editorHandle.getEditor();
      editor.chain().focus().insertContent(`\n${assistantText}`).run();
      emitAiResult({ action: "continue", text: assistantText });
      editorHandle.focus();
    }
  }
});
