const { registerPlugin } = require("../api/plugin_registry.js");

const makeCommentId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const emitCommentState = (detail) => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent("leditor:comments", {
      detail
    })
  );
};

const getCommentEntries = (editorHandle) => {
  const editor = editorHandle.getEditor();
  const commentMark = editor.schema.marks.comment;
  if (!commentMark) {
    return [];
  }
  const entries = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.marks.length) return;
    node.marks.forEach((mark) => {
      if (mark.type !== commentMark) return;
      entries.push({
        pos,
        size: node.nodeSize,
        id: String(mark.attrs.id ?? ""),
        text: String(mark.attrs.text ?? "")
      });
    });
  });
  entries.sort((a, b) => a.pos - b.pos);
  return entries;
};

const focusEntry = (editorHandle, entry) => {
  const editor = editorHandle.getEditor();
  editor.chain().focus().setTextSelection({ from: entry.pos, to: entry.pos + entry.size }).run();
  emitCommentState({ total: getCommentEntries(editorHandle).length, activeId: entry.id });
};

const runNavigation = (editorHandle, direction) => {
  const entries = getCommentEntries(editorHandle);
  if (!entries.length) {
    return;
  }
  const currentPos = editorHandle.getEditor().state.selection.from;
  if (direction === "next") {
    const next = entries.find((entry) => entry.pos > currentPos) ?? entries[0];
    focusEntry(editorHandle, next);
    return;
  }
  const prev = [...entries].reverse().find((entry) => entry.pos < currentPos) ?? entries[entries.length - 1];
  focusEntry(editorHandle, prev);
};

const addComment = (editorHandle, text) => {
  const editor = editorHandle.getEditor();
  const id = makeCommentId();
  editor
    .chain()
    .focus()
    .setMark("comment", { id, text })
    .run();
  const total = getCommentEntries(editorHandle).length;
  emitCommentState({ total, activeId: id });
};

registerPlugin({
  id: "comments",
  commands: {
    CommentsNew(editorHandle) {
      const editor = editorHandle.getEditor();
      const selection = editor.state.selection;
      const defaultText = editor.state.doc.textBetween(selection.from, selection.to, " ").trim();
      const commentText = window.prompt("Enter comment", defaultText) ?? "";
      if (!commentText) return;
      addComment(editorHandle, commentText.trim());
    },
    CommentsDelete(editorHandle) {
      const editor = editorHandle.getEditor();
      editor.chain().focus().unsetMark("comment").run();
      const total = getCommentEntries(editorHandle).length;
      emitCommentState({ total });
    },
    CommentsNext(editorHandle) {
      runNavigation(editorHandle, "next");
    },
    CommentsPrev(editorHandle) {
      runNavigation(editorHandle, "prev");
    },
    InsertComment(editorHandle) {
      const editor = editorHandle.getEditor();
      const selection = editor.state.selection;
      const defaultText = editor.state.doc.textBetween(selection.from, selection.to, " ").trim();
      const commentText = window.prompt("Add a comment", defaultText) ?? "";
      if (!commentText) return;
      addComment(editorHandle, commentText.trim());
    }
  },
  onInit(editorHandle) {
    emitCommentState({ total: getCommentEntries(editorHandle).length });
  }
});
