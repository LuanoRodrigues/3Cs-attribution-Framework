import { registerPlugin } from "../api/plugin_registry.js";
import type { EditorHandle } from "../api/leditor.js";

type RevisionEntry = {
  id: string;
  timestamp: string;
  summary: string;
  doc: object;
};

const MAX_REVISIONS = 32;
const revisions: RevisionEntry[] = [];

const makeId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const log = (message: string) => window.codexLog?.write(`[REV_HISTORY] ${message}`);

const emitRevisionUpdate = (trigger?: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent("leditor:revision-history", {
      detail: {
        revisions: revisions
          .slice(0, 10)
          .map(({ id, timestamp, summary }) => ({ id, timestamp, summary })),
        trigger
      }
    })
  );
};

const snapshotDoc = (doc: object): object => JSON.parse(JSON.stringify(doc));
const buildSummary = (doc: object): string => {
  const summary = JSON.stringify(doc).slice(0, 120).replace(/\s+/g, " ");
  return summary || "empty document";
};

const pushRevision = (editorHandle: EditorHandle): RevisionEntry => {
  const doc = snapshotDoc(editorHandle.getJSON());
  const entry = {
    id: makeId(),
    timestamp: new Date().toISOString(),
    summary: buildSummary(doc),
    doc
  };
  revisions.unshift(entry);
  if (revisions.length > MAX_REVISIONS) {
    revisions.pop();
  }
  log(`saved ${entry.id} (${revisions.length} entries)`);
  emitRevisionUpdate("save");
  return entry;
};

const findRevision = (args?: { index?: number; id?: string }): RevisionEntry | null => {
  if (args?.id) {
    return revisions.find((entry) => entry.id === args.id) ?? null;
  }
  const safeIndex = typeof args?.index === "number" ? args.index : revisions.length - 1;
  const boundedIndex = Math.max(0, Math.min(revisions.length - 1, safeIndex));
  return revisions[boundedIndex] ?? null;
};

registerPlugin({
  id: "revision_history",
  commands: {
    SaveRevision(editorHandle: EditorHandle) {
      pushRevision(editorHandle);
    },
    OpenRevisionHistory() {
      log(`listing ${revisions.length} revisions`);
      revisions.slice(0, 5).forEach((entry, index) => {
        log(`${index}: ${entry.id} (${entry.timestamp}) - ${entry.summary}`);
      });
      emitRevisionUpdate("open");
    },
    RestoreRevision(editorHandle: EditorHandle, args?: { index?: number; id?: string }) {
      const entry = findRevision(args);
      if (!entry) {
        log("restore target missing");
        return;
      }
      editorHandle.setContent(entry.doc, { format: "json" });
      log(`restored ${entry.id}`);
      emitRevisionUpdate("restore");
    }
  }
});
