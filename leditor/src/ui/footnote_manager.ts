import type { Editor } from "@tiptap/core";
import type { EditorHandle } from "../api/leditor.ts";
import { getFootnoteRegistry, type FootnoteNodeViewAPI } from "../extensions/extension_footnote.ts";
import { reconcileFootnotes } from "../uipagination/footnotes/registry.ts";

type FootnotePanelController = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
};

const syncFootnoteNumbers = (editor: Editor) => {
  const registry = getFootnoteRegistry();
  const numbering = reconcileFootnotes(editor.state.doc).numbering;
  for (const [id, view] of registry.entries()) {
    const number = numbering.get(id);
    if (number) {
      view.setNumber(number);
    } else {
      view.setNumber(Number.NaN);
    }
  }
};

const normalizeSnippet = (text: string) => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}…`;
};

const sortFootnotes = (views: FootnoteNodeViewAPI[]) =>
  [...views].sort((a, b) => {
    const aNum = Number(a.getNumber()) || 0;
    const bNum = Number(b.getNumber()) || 0;
    return aNum - bNum;
  });

export const createFootnoteManager = (
  editorHandle: EditorHandle,
  editor: Editor
): FootnotePanelController => {
  let syncHandle = 0;
  const scheduleSync = () => {
    if (syncHandle) return;
    syncHandle = window.requestAnimationFrame(() => {
      syncHandle = 0;
      syncFootnoteNumbers(editor);
    });
  };
  const handleEditorUpdate = () => scheduleSync();
  editor.on("update", handleEditorUpdate);
  scheduleSync();
  const overlay = document.createElement("div");
  overlay.className = "leditor-footnote-panel-overlay";
  const panel = document.createElement("div");
  panel.className = "leditor-footnote-panel";
  const header = document.createElement("div");
  header.className = "leditor-footnote-panel-header";
  header.textContent = "Footnotes";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  header.appendChild(closeBtn);
  const list = document.createElement("div");
  list.className = "leditor-footnote-panel-list";
  const actions = document.createElement("div");
  actions.className = "leditor-footnote-panel-actions";
  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.textContent = "Insert Footnote";
  actions.appendChild(insertBtn);
  panel.appendChild(header);
  panel.appendChild(list);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.classList.remove("is-open");
    document.removeEventListener("keydown", onKeydown);
  };
  const open = () => {
    refreshList();
    overlay.classList.add("is-open");
    document.addEventListener("keydown", onKeydown);
  };
  const toggle = () => {
    if (!overlay.classList.contains("is-open")) {
      open();
    } else {
      close();
    }
  };
  const isOpen = () => overlay.classList.contains("is-open");

  const refreshList = () => {
    list.innerHTML = "";
    const registry = getFootnoteRegistry();
    const views = sortFootnotes(Array.from(registry.values()));
    if (views.length === 0) {
      const empty = document.createElement("div");
      empty.className = "leditor-footnote-panel-item";
      empty.textContent = "No footnotes yet.";
      list.appendChild(empty);
      return;
    }
    for (const view of views) {
      const item = document.createElement("div");
      item.className = "leditor-footnote-panel-item";
      const headerRow = document.createElement("div");
      headerRow.className = "leditor-footnote-panel-item-header";
      const label = document.createElement("span");
      label.textContent = `Footnote ${view.getNumber() || "?"}`;
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => {
        view.open();
      });
      headerRow.appendChild(label);
      headerRow.appendChild(openBtn);
      item.appendChild(headerRow);
      const snippet = document.createElement("div");
      snippet.className = "leditor-footnote-panel-item-snippet";
      const plain = view.getPlainText();
      snippet.textContent = plain.length > 0 ? normalizeSnippet(plain) : "Empty footnote";
      item.appendChild(snippet);
      list.appendChild(item);
    }
  };

  const addFootnote = () => {
    const { selection } = editor.state;
    const snippet = editor.state.doc.textBetween(selection.from, selection.to).trim();
    const defaultText = snippet.length > 0 ? snippet : "Footnote text";
    editorHandle.execCommand("InsertFootnote", { text: defaultText });
    requestAnimationFrame(() => {
      refreshList();
    });
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (event.target === overlay) {
      close();
    }
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
    }
  };

  insertBtn.addEventListener("click", addFootnote);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", handleOverlayClick);

  return {
    open() {
      open();
    },
    close() {
      close();
    },
    toggle() {
      toggle();
    },
    isOpen() {
      return isOpen();
    }
  };
};
