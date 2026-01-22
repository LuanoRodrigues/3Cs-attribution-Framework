"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFootnoteManager = void 0;
const extension_footnote_js_1 = require("../extensions/extension_footnote.js");
const footnote_state_js_1 = require("../editor/footnote_state.js");
const syncFootnoteNumbers = (editor) => {
    const registry = (0, extension_footnote_js_1.getFootnoteRegistry)();
    let counter = 0;
    editor.state.doc.descendants((node) => {
        if (node.type.name !== "footnote")
            return true;
        counter += 1;
        const id = node.attrs?.id;
        if (typeof id === "string") {
            registry.get(id)?.setNumber(counter);
        }
        return true;
    });
};
const ensureFootnoteStyles = () => {
    if (document.getElementById("leditor-footnote-panel-styles"))
        return;
    const style = document.createElement("style");
    style.id = "leditor-footnote-panel-styles";
    style.textContent = `
.leditor-footnote-panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(14, 18, 22, 0.65);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 24px;
}
.leditor-footnote-panel {
  width: min(560px, 90vw);
  max-height: 80vh;
  background: #fbf7ee;
  border: 1px solid #cbbf9a;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
.leditor-footnote-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #f2e8d3;
  border-bottom: 1px solid #d8cba8;
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 16px;
}
.leditor-footnote-panel-list {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}
.leditor-footnote-panel-item {
  padding: 10px 12px;
  background: #fffdfa;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.leditor-footnote-panel-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
.leditor-footnote-panel-item-snippet {
  color: #4c4c4c;
  font-size: 13px;
  line-height: 1.3;
}
.leditor-footnote-panel-actions {
  padding: 12px 16px;
  border-top: 1px solid #d8cba8;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.leditor-footnote-panel button {
  border: 1px solid #8c7a53;
  border-radius: 999px;
  background: #eadbb8;
  padding: 6px 14px;
  cursor: pointer;
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 13px;
}
.leditor-footnote-panel button:hover {
  background: #f6e8c8;
}
`;
    document.head.appendChild(style);
};
const normalizeSnippet = (text) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length <= 80)
        return trimmed;
    return `${trimmed.slice(0, 77)}…`;
};
const sortFootnotes = (views) => [...views].sort((a, b) => {
    const aNum = Number(a.getNumber()) || 0;
    const bNum = Number(b.getNumber()) || 0;
    return aNum - bNum;
});
const createFootnoteManager = (editorHandle, editor) => {
    ensureFootnoteStyles();
    const handleEditorUpdate = () => syncFootnoteNumbers(editor);
    editor.on("update", handleEditorUpdate);
    syncFootnoteNumbers(editor);
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
        overlay.style.display = "none";
        document.removeEventListener("keydown", onKeydown);
    };
    const open = () => {
        refreshList();
        overlay.style.display = "flex";
        document.addEventListener("keydown", onKeydown);
    };
    const toggle = () => {
        if (overlay.style.display === "none" || overlay.style.display === "") {
            open();
        }
        else {
            close();
        }
    };
    const isOpen = () => overlay.style.display === "flex";
    const refreshList = () => {
        list.innerHTML = "";
        const registry = (0, extension_footnote_js_1.getFootnoteRegistry)();
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
            const ids = (0, footnote_state_js_1.getFootnoteIds)();
            const id = ids[ids.length - 1];
            const view = (0, extension_footnote_js_1.getFootnoteRegistry)().get(id);
            view?.open();
            refreshList();
        });
    };
    const handleOverlayClick = (event) => {
        if (event.target === overlay) {
            close();
        }
    };
    const onKeydown = (event) => {
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
exports.createFootnoteManager = createFootnoteManager;
