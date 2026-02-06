import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { Node as ProseMirrorNode, Mark } from "@tiptap/pm/model";

type CommentEntry = {
  id: string;
  text: string;
  from: number;
  to: number;
  snippet: string;
};

const makeCommentId = (): string => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const emitCommentState = (detail: { total: number; activeId?: string; entries?: CommentEntry[] }) => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent("leditor:comments", {
      detail
    })
  );
};

const getCommentEntries = (editorHandle: EditorHandle): CommentEntry[] => {
  const editor = editorHandle.getEditor();
  const commentMark = editor.schema.marks.comment;
  if (!commentMark) {
    return [];
  }
  const entries = new Map<string, CommentEntry>();
  editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (!node.marks.length) return;
    node.marks.forEach((mark: Mark) => {
      if (mark.type !== commentMark) return;
      const id = String(mark.attrs.id ?? "");
      if (!id) return;
      const existing = entries.get(id);
      const snippet = String(node.textContent ?? "");
      if (!existing) {
        entries.set(id, {
          id,
          text: String(mark.attrs.text ?? ""),
          from: pos,
          to: pos + node.nodeSize,
          snippet
        });
        return;
      }
      existing.from = Math.min(existing.from, pos);
      existing.to = Math.max(existing.to, pos + node.nodeSize);
      if (!existing.snippet && snippet) {
        existing.snippet = snippet;
      }
    });
  });
  const list = Array.from(entries.values()).sort((a, b) => a.from - b.from);
  return list;
};

const focusEntry = (
  editorHandle: EditorHandle,
  entry: { from: number; to: number; id: string }
) => {
  const editor = editorHandle.getEditor();
  editor.chain().focus().setTextSelection({ from: entry.from, to: entry.to }).run();
  emitCommentState({ total: getCommentEntries(editorHandle).length, activeId: entry.id, entries: getCommentEntries(editorHandle) });
};

const runNavigation = (editorHandle: EditorHandle, direction: "next" | "prev") => {
  const entries = getCommentEntries(editorHandle);
  if (!entries.length) {
    return;
  }
  const currentPos = editorHandle.getEditor().state.selection.from;
  if (direction === "next") {
    const next = entries.find((entry) => entry.from > currentPos) ?? entries[0];
    focusEntry(editorHandle, next);
    return;
  }
  const prev = [...entries].reverse().find((entry) => entry.from < currentPos) ?? entries[entries.length - 1];
  focusEntry(editorHandle, prev);
};

const addComment = (editorHandle: EditorHandle, text: string) => {
  const editor = editorHandle.getEditor();
  const id = makeCommentId();
  editor
    .chain()
    .focus()
    .setMark("comment", { id, text })
    .run();
  const entries = getCommentEntries(editorHandle);
  emitCommentState({ total: entries.length, activeId: id, entries });
};

registerPlugin({
  id: "comments",
  commands: {
    CommentsNew(editorHandle: EditorHandle) {
      const editor = editorHandle.getEditor();
      const selection = editor.state.selection;
      const defaultText = editor.state.doc.textBetween(selection.from, selection.to, " ").trim();
      const commentText = window.prompt("Enter comment", defaultText) ?? "";
      if (!commentText) return;
      addComment(editorHandle, commentText.trim());
    },
    CommentsDelete(editorHandle: EditorHandle) {
      const editor = editorHandle.getEditor();
      editor.chain().focus().unsetMark("comment").run();
      const entries = getCommentEntries(editorHandle);
      emitCommentState({ total: entries.length, entries });
    },
    CommentsNext(editorHandle: EditorHandle) {
      runNavigation(editorHandle, "next");
    },
    CommentsPrev(editorHandle: EditorHandle) {
      runNavigation(editorHandle, "prev");
    },
    InsertComment(editorHandle: EditorHandle) {
      const editor = editorHandle.getEditor();
      const selection = editor.state.selection;
      const defaultText = editor.state.doc.textBetween(selection.from, selection.to, " ").trim();
      const commentText = window.prompt("Add a comment", defaultText) ?? "";
      if (!commentText) return;
      addComment(editorHandle, commentText.trim());
    }
  },
  onInit(editorHandle: EditorHandle) {
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        const entries = getCommentEntries(editorHandle);
        const editor = editorHandle.getEditor();
        const commentMark = editor.schema.marks.comment;
        let activeId: string | undefined = undefined;
        if (commentMark) {
          const { from, to, empty, $from, $to } = editor.state.selection;
          const marks = empty ? $from.marks() : $from.marksAcross($to);
          const active = marks?.find((mark) => mark.type === commentMark);
          activeId = active ? String(active.attrs?.id ?? "") : undefined;
          if (!activeId && from !== to) {
            const hit = entries.find((entry) => entry.from <= from && entry.to >= to);
            if (hit) activeId = hit.id;
          }
        }
        emitCommentState({ total: entries.length, activeId, entries });
      });
    };
    const editor = editorHandle.getEditor();
    editor.on("update", schedule);
    editor.on("selectionUpdate", schedule);
    const entries = getCommentEntries(editorHandle);
    emitCommentState({ total: entries.length, entries });
  }
});
