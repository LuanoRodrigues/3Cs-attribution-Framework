import { Mark, mergeAttributes, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReplaceStep, ReplaceAroundStep, Mapping } from "@tiptap/pm/transform";
import { Fragment, Slice } from "@tiptap/pm/model";
import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";

type ChangeRecord = {
  id: string;
  type: "insert" | "delete";
  from: number;
  to: number;
  text: string;
  timestamp: number;
};

type ChangeAttrs = {
  id: string;
  author?: string;
  ts: number;
};

const TRACK_INSERT = "trackInsert";
const TRACK_DELETE = "trackDelete";
const TRACK_PLUGIN_KEY = new PluginKey("track_changes");
const SKIP_META = "leditor:skipTrackChanges";

const makeId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const log = (message: string) => window.codexLog?.write(`[TRACK_CHANGES] ${message}`);

const TrackInsertMark = Mark.create({
  name: TRACK_INSERT,
  inclusive: true,
  addAttributes() {
    return {
      id: { default: null },
      author: { default: "" },
      ts: { default: null }
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-change-type="insert"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs = {
      class: "leditor-change leditor-change--insert",
      "data-change-type": "insert",
      "data-change-id": HTMLAttributes.id,
      "data-change-author": HTMLAttributes.author,
      "data-change-ts": HTMLAttributes.ts
    };
    return ["span", mergeAttributes(attrs, HTMLAttributes), 0];
  }
});

const TrackDeleteMark = Mark.create({
  name: TRACK_DELETE,
  inclusive: false,
  addAttributes() {
    return {
      id: { default: null },
      author: { default: "" },
      ts: { default: null }
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-change-type="delete"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs = {
      class: "leditor-change leditor-change--delete",
      "data-change-type": "delete",
      "data-change-id": HTMLAttributes.id,
      "data-change-author": HTMLAttributes.author,
      "data-change-ts": HTMLAttributes.ts
    };
    return ["span", mergeAttributes(attrs, HTMLAttributes), 0];
  }
});

const readAuthor = (): string => {
  try {
    return window.localStorage?.getItem("leditor.user")?.trim() ?? "";
  } catch {
    return "";
  }
};

const buildAttrs = (): ChangeAttrs => ({
  id: makeId(),
  author: readAuthor(),
  ts: Date.now()
});

const stripMarkFromFragment = (fragment: Fragment, markType: any): Fragment => {
  const nodes: any[] = [];
  fragment.forEach((child) => {
    if (child.isText) {
      const marks = child.marks.filter((m) => m.type !== markType);
      nodes.push(child.mark(marks));
      return;
    }
    if (!child.content || child.content.size === 0) {
      nodes.push(child);
      return;
    }
    const nextContent = stripMarkFromFragment(child.content, markType);
    nodes.push(child.copy(nextContent));
  });
  return Fragment.fromArray(nodes);
};

const sliceOnlyInsert = (slice: Slice, insertMark: any): boolean => {
  let hasText = false;
  let allInsert = true;
  slice.content.descendants((node) => {
    if (!node.isText) return true;
    hasText = true;
    if (!node.marks.some((m) => m.type === insertMark)) {
      allInsert = false;
      return false;
    }
    return true;
  });
  return hasText && allInsert;
};

let trackChangesActive = false;
let reviewIndex = 0;
let cachedChanges: ChangeRecord[] = [];

const collectChanges = (editorHandle: EditorHandle): ChangeRecord[] => {
  const editor = editorHandle.getEditor();
  const insertMark = editor.schema.marks[TRACK_INSERT];
  const deleteMark = editor.schema.marks[TRACK_DELETE];
  if (!insertMark || !deleteMark) return [];

  const entries = new Map<string, ChangeRecord>();
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.marks?.length) return true;
    node.marks.forEach((mark) => {
      const type =
        mark.type === insertMark ? "insert" : mark.type === deleteMark ? "delete" : null;
      if (!type) return;
      const id = String(mark.attrs?.id ?? "");
      if (!id) return;
      const key = `${type}:${id}`;
      const existing = entries.get(key);
      const text = node.text ?? "";
      if (!existing) {
        entries.set(key, {
          id,
          type,
          from: pos,
          to: pos + node.nodeSize,
          text,
          timestamp: Number(mark.attrs?.ts) || Date.now()
        });
        return;
      }
      existing.from = Math.min(existing.from, pos);
      existing.to = Math.max(existing.to, pos + node.nodeSize);
      if (text) existing.text += text;
    });
    return true;
  });

  const list = Array.from(entries.values()).sort((a, b) => a.from - b.from);
  return list;
};

const clampReviewIndex = (changes: ChangeRecord[]) => {
  if (!changes.length) {
    reviewIndex = 0;
    return;
  }
  const maxIndex = changes.length - 1;
  if (reviewIndex < 0) reviewIndex = 0;
  if (reviewIndex > maxIndex) reviewIndex = maxIndex;
};

const emitTrackState = (editorHandle: EditorHandle): void => {
  cachedChanges = collectChanges(editorHandle);
  clampReviewIndex(cachedChanges);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("leditor:track-changes", {
      detail: {
        active: trackChangesActive,
        pendingChanges: cachedChanges.map((change) => ({ ...change }))
      }
    })
  );
};

const TrackChangesExtension = Extension.create({
  name: "trackChangesExtension",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: TRACK_PLUGIN_KEY,
        appendTransaction(transactions, oldState, newState) {
          if (!trackChangesActive) return;
          const insertMark = newState.schema.marks[TRACK_INSERT];
          const deleteMark = newState.schema.marks[TRACK_DELETE];
          if (!insertMark || !deleteMark) return;

          const ops: Array<
            | { kind: "markInsert"; from: number; to: number; attrs: ChangeAttrs }
            | { kind: "insertDeletion"; pos: number; slice: Slice; attrs: ChangeAttrs }
          > = [];

          const mappingAfterTrs: Array<Mapping> = new Array(transactions.length);
          let after = new Mapping();
          for (let i = transactions.length - 1; i >= 0; i -= 1) {
            mappingAfterTrs[i] = after;
            const next = new Mapping();
            next.appendMapping(transactions[i].mapping);
            next.appendMapping(after);
            after = next;
          }

          transactions.forEach((tr, trIndex) => {
            if (!tr.docChanged) return;
            if (tr.getMeta(SKIP_META)) return;
            let docBefore = (tr as any).docs?.[0] ?? oldState.doc;

            tr.steps.forEach((step, stepIndex) => {
              const isReplace = step instanceof ReplaceStep || step instanceof ReplaceAroundStep;
              if (!isReplace) {
                const result = step.apply(docBefore);
                if (result.doc) docBefore = result.doc;
                return;
              }
              const map = step.getMap();
              map.forEach((oldStart, oldEnd, newStart, newEnd) => {
                if (oldEnd === oldStart && newEnd === newStart) return;
                const attrs = buildAttrs();
                if (newEnd > newStart) {
                  const mappingAfterStep = tr.mapping.slice(stepIndex + 1);
                  const mappedFrom = mappingAfterTrs[trIndex].map(
                    mappingAfterStep.map(newStart, 1),
                    1
                  );
                  const mappedTo = mappingAfterTrs[trIndex].map(
                    mappingAfterStep.map(newEnd, -1),
                    -1
                  );
                  if (mappedFrom < mappedTo) {
                    ops.push({ kind: "markInsert", from: mappedFrom, to: mappedTo, attrs });
                  }
                }
                if (oldEnd > oldStart) {
                  const slice = docBefore.slice(oldStart, oldEnd);
                  if (!sliceOnlyInsert(slice, insertMark)) {
                    const cleaned = new Slice(
                      stripMarkFromFragment(slice.content, insertMark),
                      slice.openStart,
                      slice.openEnd
                    );
                    const mappingFromStep = tr.mapping.slice(stepIndex);
                    const mappedPos = mappingAfterTrs[trIndex].map(
                      mappingFromStep.map(oldStart, -1),
                      -1
                    );
                    ops.push({ kind: "insertDeletion", pos: mappedPos, slice: cleaned, attrs });
                  }
                }
              });
              const result = step.apply(docBefore);
              if (result.doc) docBefore = result.doc;
            });
          });

          if (!ops.length) return;
          const tr = newState.tr;
          ops.sort((a, b) => {
            const posA = a.kind === "markInsert" ? a.from : a.pos;
            const posB = b.kind === "markInsert" ? b.from : b.pos;
            return posA - posB;
          });

          ops.forEach((op) => {
            if (op.kind === "markInsert") {
              const from = tr.mapping.map(op.from, 1);
              const to = tr.mapping.map(op.to, -1);
              if (from < to) {
                tr.addMark(from, to, insertMark.create(op.attrs));
              }
              return;
            }
            const pos = tr.mapping.map(op.pos, 1);
            tr.replaceRange(pos, pos, op.slice);
            const markFrom = pos;
            const markTo = pos + op.slice.size;
            if (markFrom < markTo) {
              tr.addMark(markFrom, markTo, deleteMark.create(op.attrs));
            }
          });

          if (tr.docChanged) {
            tr.setMeta(SKIP_META, true);
            return tr;
          }
          return;
        }
      })
    ];
  }
});

const focusChange = (editorHandle: EditorHandle, change: ChangeRecord | null) => {
  if (!change) return;
  const editor = editorHandle.getEditor();
  editor.chain().focus().setTextSelection({ from: change.from, to: change.to }).run();
};

registerPlugin({
  id: "track_changes",
  tiptapExtensions: [TrackInsertMark, TrackDeleteMark, TrackChangesExtension],
  commands: {
    ToggleTrackChanges(editorHandle: EditorHandle) {
      trackChangesActive = !trackChangesActive;
      log(trackChangesActive ? "enabled" : "disabled");
      if (trackChangesActive && cachedChanges.length > 0) {
        reviewIndex = cachedChanges.length - 1;
      }
      emitTrackState(editorHandle);
      editorHandle.focus();
    },
    AcceptChange(editorHandle: EditorHandle) {
      const editor = editorHandle.getEditor();
      emitTrackState(editorHandle);
      const change = cachedChanges[reviewIndex] ?? null;
      if (!change) {
        log("no change to accept");
        return;
      }
      const insertMark = editor.schema.marks[TRACK_INSERT];
      const deleteMark = editor.schema.marks[TRACK_DELETE];
      if (!insertMark || !deleteMark) return;
      const tr = editor.state.tr;
      if (change.type === "insert") {
        tr.removeMark(change.from, change.to, insertMark);
      } else {
        tr.delete(change.from, change.to);
      }
      tr.setMeta(SKIP_META, true);
      if (tr.docChanged) editor.view.dispatch(tr);
      emitTrackState(editorHandle);
      focusChange(editorHandle, cachedChanges[reviewIndex] ?? null);
    },
    RejectChange(editorHandle: EditorHandle) {
      const editor = editorHandle.getEditor();
      emitTrackState(editorHandle);
      const change = cachedChanges[reviewIndex] ?? null;
      if (!change) {
        log("no change to reject");
        return;
      }
      const insertMark = editor.schema.marks[TRACK_INSERT];
      const deleteMark = editor.schema.marks[TRACK_DELETE];
      if (!insertMark || !deleteMark) return;
      const tr = editor.state.tr;
      if (change.type === "insert") {
        tr.delete(change.from, change.to);
      } else {
        tr.removeMark(change.from, change.to, deleteMark);
      }
      tr.setMeta(SKIP_META, true);
      if (tr.docChanged) editor.view.dispatch(tr);
      emitTrackState(editorHandle);
      focusChange(editorHandle, cachedChanges[reviewIndex] ?? null);
    },
    PrevChange(editorHandle: EditorHandle) {
      emitTrackState(editorHandle);
      if (!cachedChanges.length) {
        log("no change to navigate");
        return;
      }
      reviewIndex = reviewIndex === 0 ? cachedChanges.length - 1 : reviewIndex - 1;
      focusChange(editorHandle, cachedChanges[reviewIndex] ?? null);
    },
    NextChange(editorHandle: EditorHandle) {
      emitTrackState(editorHandle);
      if (!cachedChanges.length) {
        log("no change to navigate");
        return;
      }
      reviewIndex = (reviewIndex + 1) % cachedChanges.length;
      focusChange(editorHandle, cachedChanges[reviewIndex] ?? null);
    }
  },
  onInit(editorHandle: EditorHandle) {
    const editor = editorHandle.getEditor();
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        emitTrackState(editorHandle);
      });
    };
    editor.on("update", schedule);
    editor.on("selectionUpdate", schedule);
    emitTrackState(editorHandle);
  }
});
