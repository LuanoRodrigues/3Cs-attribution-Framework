import type { EditorHandle } from "../api/leditor.ts";

type CommentEntry = {
  id: string;
  text: string;
  from: number;
  to: number;
  snippet: string;
};

const PANEL_ID = "leditor-comments-panel";
const STORAGE_KEY = "leditor.comments.panel";

let panel: HTMLElement | null = null;
let mounted = false;
let visible = false;
let lastCount = 0;
let currentHandle: EditorHandle | null = null;

const getHost = (): HTMLElement | null => {
  const appRoot = document.getElementById("leditor-app");
  if (!appRoot) return null;
  return appRoot.querySelector<HTMLElement>(".leditor-main-split") ?? appRoot;
};

const readStoredVisibility = (): boolean => {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return false;
    return raw === "1" || raw.toLowerCase() === "true";
  } catch {
    return false;
  }
};

const persistVisibility = (next: boolean) => {
  try {
    window.localStorage?.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // ignore
  }
};

const setVisible = (next: boolean) => {
  visible = next;
  persistVisibility(next);
  if (panel) {
    panel.classList.toggle("is-open", next);
  }
};

const focusEntry = (entry: CommentEntry) => {
  const handle = currentHandle;
  if (!handle) return;
  const editor = handle.getEditor();
  editor.chain().focus().setTextSelection({ from: entry.from, to: entry.to }).run();
};

const deleteCommentById = (id: string) => {
  const handle = currentHandle;
  if (!handle) return;
  const editor = handle.getEditor();
  const commentMark = editor.schema.marks.comment;
  if (!commentMark) return;
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (!node.marks?.some((mark) => mark.type === commentMark && String(mark.attrs?.id ?? "") === id)) return true;
    tr.removeMark(pos, pos + node.nodeSize, commentMark);
    return true;
  });
  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }
};

const renderEntries = (entries: CommentEntry[], activeId?: string) => {
  if (!panel) return;
  const list = panel.querySelector<HTMLElement>(".leditor-comments-list");
  const empty = panel.querySelector<HTMLElement>(".leditor-comments-empty");
  if (!list || !empty) return;
  list.innerHTML = "";
  if (!entries.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  entries.forEach((entry, index) => {
    const card = document.createElement("div");
    card.className = "leditor-comment-card";
    card.dataset.commentId = entry.id;
    if (activeId && entry.id === activeId) {
      card.classList.add("is-active");
    }

    const meta = document.createElement("div");
    meta.className = "leditor-comment-card__meta";
    meta.textContent = `#${index + 1}`;

    const text = document.createElement("div");
    text.className = "leditor-comment-card__text";
    text.textContent = entry.text || "(No comment text)";

    const snippet = document.createElement("div");
    snippet.className = "leditor-comment-card__snippet";
    const snippetText = entry.snippet.trim();
    snippet.textContent = snippetText ? `"${snippetText}"` : "";

    const actions = document.createElement("div");
    actions.className = "leditor-comment-card__actions";
    const jumpBtn = document.createElement("button");
    jumpBtn.type = "button";
    jumpBtn.className = "leditor-ui-btn";
    jumpBtn.textContent = "Go";
    jumpBtn.addEventListener("click", (event) => {
      event.preventDefault();
      focusEntry(entry);
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "leditor-ui-btn leditor-ui-btn--ghost";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      deleteCommentById(entry.id);
    });
    actions.append(jumpBtn, deleteBtn);

    card.append(meta, text, snippet, actions);
    card.addEventListener("click", () => focusEntry(entry));
    list.appendChild(card);
  });
};

const ensurePanel = (editorHandle: EditorHandle): HTMLElement | null => {
  if (panel) return panel;
  const host = getHost();
  if (!host) return null;
  const root = document.createElement("aside");
  root.id = PANEL_ID;
  root.className = "leditor-comments-panel";
  root.setAttribute("role", "complementary");
  root.setAttribute("aria-label", "Comments");

  const header = document.createElement("div");
  header.className = "leditor-comments-header";
  const title = document.createElement("div");
  title.className = "leditor-comments-title";
  title.textContent = "Comments";
  const actions = document.createElement("div");
  actions.className = "leditor-comments-actions";
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "leditor-ui-btn";
  newBtn.textContent = "New";
  newBtn.addEventListener("click", () => {
    try {
      editorHandle.execCommand("CommentsNew");
    } catch {
      // ignore
    }
  });
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-ui-btn leditor-ui-btn--ghost";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => setVisible(false));
  actions.append(newBtn, closeBtn);
  header.append(title, actions);

  const body = document.createElement("div");
  body.className = "leditor-comments-body";
  const empty = document.createElement("div");
  empty.className = "leditor-comments-empty";
  empty.textContent = "No comments yet.";
  const list = document.createElement("div");
  list.className = "leditor-comments-list";
  body.append(empty, list);

  root.append(header, body);

  const docShell = host.querySelector<HTMLElement>(".leditor-doc-shell");
  const pdfShell = host.querySelector<HTMLElement>(".leditor-pdf-shell");
  if (pdfShell) {
    host.insertBefore(root, pdfShell);
  } else if (docShell && docShell.nextSibling) {
    host.insertBefore(root, docShell.nextSibling);
  } else {
    host.appendChild(root);
  }

  panel = root;
  return panel;
};

export const mountCommentsPanel = (editorHandle: EditorHandle) => {
  if (mounted) return;
  mounted = true;
  currentHandle = editorHandle;
  const root = ensurePanel(editorHandle);
  if (!root) return;
  setVisible(readStoredVisibility());
  window.addEventListener("leditor:comments", (event) => {
    const detail = (event as CustomEvent).detail as {
      total?: number;
      activeId?: string;
      entries?: CommentEntry[];
    };
    const entries = Array.isArray(detail?.entries) ? detail.entries : [];
    const total = typeof detail?.total === "number" ? detail.total : entries.length;
    renderEntries(entries, detail?.activeId);
    if (total > 0 && lastCount === 0) {
      setVisible(true);
    }
    if (total === 0) {
      setVisible(false);
    }
    lastCount = total;
  });
};
