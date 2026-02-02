import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import { getSourceCheckState } from "../editor/source_check_badges.ts";
import {
  applySourceChecksThreadToEditor,
  clearSourceChecksThread,
  dismissSourceCheckThreadItem,
  isSourceChecksVisible,
  setSourceChecksVisible
} from "../ui/source_checks_thread.ts";

const toggle = (editorHandle: EditorHandle) => {
  const next = !isSourceChecksVisible();
  setSourceChecksVisible(next);
  if (!next) {
    editorHandle.execCommand("ClearSourceChecks");
    return;
  }
  // Best-effort: if checks already exist, keep them; otherwise attach stored thread.
  try {
    const editor = editorHandle.getEditor();
    const view = (editor as any)?.view;
    const sc = view ? getSourceCheckState(view.state) : null;
    if (!sc?.enabled || !sc.items.length) {
      applySourceChecksThreadToEditor(editorHandle);
    } else {
      editorHandle.execCommand("SetSourceChecks", { items: sc.items });
    }
  } catch {
    // ignore
  }
};

const clearAll = (editorHandle: EditorHandle) => {
  clearSourceChecksThread();
  editorHandle.execCommand("ClearSourceChecks");
};

const dismissOne = (editorHandle: EditorHandle, args?: { key?: unknown }) => {
  const key = typeof args?.key === "string" ? args.key.trim() : "";
  if (!key) return;
  try {
    const editor = editorHandle.getEditor();
    const view = (editor as any)?.view;
    const sc = view ? getSourceCheckState(view.state) : null;
    const nextItems = (sc?.items ?? []).filter((it) => String(it?.key) !== key);
    if (nextItems.length) {
      editorHandle.execCommand("SetSourceChecks", { items: nextItems });
    } else {
      editorHandle.execCommand("ClearSourceChecks");
    }
  } catch {
    // ignore
  }
  dismissSourceCheckThreadItem(key);
};

registerPlugin({
  id: "source_checks_feedbacks",
  commands: {
    "ai.sourceChecks.toggle"(editorHandle: EditorHandle) {
      toggle(editorHandle);
    },
    "ai.sourceChecks.clear"(editorHandle: EditorHandle) {
      clearAll(editorHandle);
    },
    "ai.sourceChecks.dismiss"(editorHandle: EditorHandle, args?: { key?: unknown }) {
      dismissOne(editorHandle, args);
    }
  }
});

