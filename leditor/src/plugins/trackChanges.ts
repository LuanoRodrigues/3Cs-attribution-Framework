import { registerPlugin } from "../legacy/api/plugin_registry.js";
import type { EditorHandle } from "../legacy/api/leditor.js";
import DiffMatchPatch from "diff-match-patch";

type ChangeRecord = {
  id: string;
  type: "insert" | "delete";
  text: string;
  timestamp: number;
};

const makeId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const diffEngine = new DiffMatchPatch();
const pendingChanges: ChangeRecord[] = [];
let trackChangesActive = false;
let reviewIndex = 0;

const log = (message: string) => window.codexLog?.write(`[TRACK_CHANGES] ${message}`);

const emitTrackState = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent("leditor:track-changes", {
      detail: {
        active: trackChangesActive,
        pendingChanges: pendingChanges.map((change) => ({ ...change }))
      }
    })
  );
};

const getDocText = (editorHandle: EditorHandle): string => {
  const editor = editorHandle.getEditor();
  const doc = editor.state.doc;
  return doc.textBetween(0, doc.content.size, " ");
};

const recordDiffs = (diffs: Array<[number, string]>, timestamp: number): void => {
  if (!diffs.length) {
    return;
  }
  diffs.forEach(([operation, text]) => {
    if (!text.trim()) {
      return;
    }
    const type = operation === 1 ? "insert" : operation === -1 ? "delete" : null;
    if (!type) {
      return;
    }
    pendingChanges.push({
      id: makeId(),
      type,
      text: text.trim(),
      timestamp
    });
  });
  log(`captured ${pendingChanges.length} change(s)`);
  emitTrackState();
};

const clampReviewIndex = (): void => {
  if (!pendingChanges.length) {
    reviewIndex = 0;
    return;
  }
  const maxIndex = pendingChanges.length - 1;
  if (reviewIndex < 0) {
    reviewIndex = 0;
    return;
  }
  if (reviewIndex > maxIndex) {
    reviewIndex = maxIndex;
  }
};

const getCurrentChange = (): ChangeRecord | null => {
  clampReviewIndex();
  return pendingChanges[reviewIndex] ?? null;
};

registerPlugin({
  id: "track_changes",
  commands: {
    ToggleTrackChanges(editorHandle: EditorHandle) {
      trackChangesActive = !trackChangesActive;
      log(trackChangesActive ? "enabled" : "disabled");
      if (trackChangesActive) {
        reviewIndex = pendingChanges.length > 0 ? pendingChanges.length - 1 : 0;
      }
      emitTrackState();
      editorHandle.focus();
    },
    AcceptChange() {
      const change = pendingChanges.shift();
      if (!change) {
        log("no change to accept");
        return;
      }
      log(`accepted ${change.id}`);
      reviewIndex = 0;
      emitTrackState();
    },
    RejectChange() {
      const change = pendingChanges.shift();
      if (!change) {
        log("no change to reject");
        return;
      }
      log(`rejected ${change.id}`);
      reviewIndex = 0;
      emitTrackState();
    },
    PrevChange() {
      if (!pendingChanges.length) {
        log("no change to navigate");
        return;
      }
      reviewIndex = reviewIndex === 0 ? pendingChanges.length - 1 : reviewIndex - 1;
      const change = getCurrentChange();
      if (change) {
        log(`preview ${change.id} (${change.type})`);
      }
    },
    NextChange() {
      if (!pendingChanges.length) {
        log("no change to navigate");
        return;
      }
      reviewIndex = (reviewIndex + 1) % pendingChanges.length;
      const change = getCurrentChange();
      if (change) {
        log(`next ${change.id} (${change.type})`);
      }
    }
  },
  onInit(editorHandle: EditorHandle) {
    let previousText = getDocText(editorHandle);
    const handleUpdate = () => {
      const newText = getDocText(editorHandle);
      if (newText === previousText) {
        return;
      }
      if (trackChangesActive) {
        const diffs = diffEngine.diff_main(previousText, newText);
        diffEngine.diff_cleanupSemantic(diffs);
        recordDiffs(diffs, Date.now());
      }
      previousText = newText;
    };
    const editor = editorHandle.getEditor();
    editor.on("update", handleUpdate);
    window.addEventListener("beforeunload", () => editor.off("update", handleUpdate));
    emitTrackState();
  }
});
