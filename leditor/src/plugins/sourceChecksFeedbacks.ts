import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import { getSourceCheckState } from "../editor/source_check_badges.ts";
import { applyClaimRewriteForKey, dismissClaimRewriteForKey } from "../editor/source_check_badges.ts";
import {
  applySourceChecksThreadToEditor,
  clearSourceChecksThread,
  dismissSourceCheckThreadItem,
  getSourceChecksThread,
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

const applyAllFixes = () => {
  const items = getSourceChecksThread().items ?? [];
  if (!items.length) return;
  // Apply at most one fix per paragraph to avoid repeated rewrites in the same sentence.
  const byParagraph = new Map<number, string>();
  for (const it of items as any[]) {
    const key = typeof it?.key === "string" ? String(it.key) : "";
    const paragraphN = Number.isFinite(it?.paragraphN) ? Math.max(1, Math.floor(it.paragraphN)) : 0;
    const verdict = it?.verdict === "verified" ? "verified" : "needs_review";
    const rewrite = typeof it?.claimRewrite === "string" ? String(it.claimRewrite).trim() : "";
    const fixStatus = typeof it?.fixStatus === "string" ? String(it.fixStatus) : "pending";
    if (!key || !paragraphN) continue;
    if (verdict === "verified") continue;
    if (!rewrite) continue;
    if (fixStatus !== "pending") continue;
    if (byParagraph.has(paragraphN)) continue;
    byParagraph.set(paragraphN, key);
  }
  const ordered = [...byParagraph.entries()].sort((a, b) => b[0] - a[0]); // bottom-up by paragraph index
  for (const [, key] of ordered) {
    try {
      applyClaimRewriteForKey(key);
    } catch {
      // ignore; per-key apply is best-effort and may be blocked by safety checks
    }
  }
};

const dismissAllFixes = () => {
  const items = getSourceChecksThread().items ?? [];
  for (const it of items as any[]) {
    const key = typeof it?.key === "string" ? String(it.key) : "";
    const verdict = it?.verdict === "verified" ? "verified" : "needs_review";
    const rewrite = typeof it?.claimRewrite === "string" ? String(it.claimRewrite).trim() : "";
    const fixStatus = typeof it?.fixStatus === "string" ? String(it.fixStatus) : "pending";
    if (!key) continue;
    if (verdict === "verified") continue;
    if (!rewrite) continue;
    if (fixStatus !== "pending") continue;
    try {
      dismissClaimRewriteForKey(key);
    } catch {
      // ignore
    }
  }
};

const applyOneFix = (args?: { key?: unknown }) => {
  const key = typeof args?.key === "string" ? args.key.trim() : "";
  if (!key) return;
  try {
    applyClaimRewriteForKey(key);
  } catch {
    // ignore
  }
};

const dismissOneFix = (args?: { key?: unknown }) => {
  const key = typeof args?.key === "string" ? args.key.trim() : "";
  if (!key) return;
  try {
    dismissClaimRewriteForKey(key);
  } catch {
    // ignore
  }
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
    },
    "ai.sourceChecks.applyAllFixes"() {
      applyAllFixes();
    },
    "ai.sourceChecks.dismissAllFixes"() {
      dismissAllFixes();
    },
    "ai.sourceChecks.applyFix"(_editorHandle: EditorHandle, args?: { key?: unknown }) {
      applyOneFix(args);
    },
    "ai.sourceChecks.dismissFix"(_editorHandle: EditorHandle, args?: { key?: unknown }) {
      dismissOneFix(args);
    },
    // Back-compat / typo tolerance: some UI surfaces referenced "sourcecheck" (singular) or different casing.
    "ai.sourcecheck.toggle"(editorHandle: EditorHandle) {
      toggle(editorHandle);
    },
    "ai.sourcecheck.clear"(editorHandle: EditorHandle) {
      clearAll(editorHandle);
    },
    "ai.sourcecheck.dismiss"(editorHandle: EditorHandle, args?: { key?: unknown }) {
      dismissOne(editorHandle, args);
    },
    "ai.sourcecheck.applyAllFixes"() {
      applyAllFixes();
    },
    "ai.sourcecheck.dismissAllFixes"() {
      dismissAllFixes();
    },
    "ai.sourcecheck.applyFix"(_editorHandle: EditorHandle, args?: { key?: unknown }) {
      applyOneFix(args);
    },
    "ai.sourcecheck.dismissFix"(_editorHandle: EditorHandle, args?: { key?: unknown }) {
      dismissOneFix(args);
    },
    "ai.sourcechecks.toggle"(editorHandle: EditorHandle) {
      toggle(editorHandle);
    },
    "ai.sourcechecks.clear"(editorHandle: EditorHandle) {
      clearAll(editorHandle);
    },
    "ai.sourcechecks.dismiss"(editorHandle: EditorHandle, args?: { key?: unknown }) {
      dismissOne(editorHandle, args);
    }
    ,
    "ai.sourcechecks.applyAllFixes"() {
      applyAllFixes();
    },
    "ai.sourcechecks.dismissAllFixes"() {
      dismissAllFixes();
    }
    ,
    "ai.sourcechecks.applyFix"(_editorHandle: EditorHandle, args?: { key?: unknown }) {
      applyOneFix(args);
    },
    "ai.sourcechecks.dismissFix"(_editorHandle: EditorHandle, args?: { key?: unknown }) {
      dismissOneFix(args);
    }
  }
});
