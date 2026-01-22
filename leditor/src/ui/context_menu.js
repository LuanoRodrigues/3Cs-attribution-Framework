"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachContextMenu = void 0;
const prosemirror_state_1 = require("prosemirror-state");
const phaseFlags = {
    textAction: false,
    linkAction: false,
    tableAction: false,
    logged: false
};
const ensureStyles = () => {
    if (document.getElementById("leditor-context-menu-styles"))
        return;
    const style = document.createElement("style");
    style.id = "leditor-context-menu-styles";
    style.textContent = `
.leditor-context-menu {
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 13px;
  background: #fffdfa;
  border: 1px solid #cbbf9a;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 6px;
  display: grid;
  grid-auto-rows: min-content;
  gap: 4px;
  z-index: 10000;
}
.leditor-context-menu button {
  border: none;
  background: transparent;
  text-align: left;
  padding: 6px 10px;
  cursor: pointer;
  color: #1e1e1e;
}
.leditor-context-menu button:hover {
  background: #fff2d2;
}
`;
    document.head.appendChild(style);
};
const recordAction = (context) => {
    if (context === "text") {
        phaseFlags.textAction = true;
    }
    else if (context === "link") {
        phaseFlags.linkAction = true;
    }
    else if (context === "table") {
        phaseFlags.tableAction = true;
    }
    if (phaseFlags.textAction && phaseFlags.linkAction && phaseFlags.tableAction && !phaseFlags.logged) {
        window.codexLog?.write("[PHASE16_OK]");
        phaseFlags.logged = true;
    }
};
const isInsideTableCell = (editor) => {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type.name === "table_cell" || node.type.name === "table_header")
            return true;
    }
    return false;
};
const determineContext = (editor) => {
    const { selection } = editor.state;
    if (selection instanceof prosemirror_state_1.NodeSelection && selection.node.type.name === "image") {
        return null;
    }
    if (isInsideTableCell(editor)) {
        return "table";
    }
    if (editor.isActive("link")) {
        return "link";
    }
    const { $from } = selection;
    if ($from.parent.isTextblock) {
        return "text";
    }
    return null;
};
const tableSizes = [
    { rows: 2, cols: 2 },
    { rows: 3, cols: 2 },
    { rows: 3, cols: 3 },
    { rows: 4, cols: 3 }
];
const buildMenuItems = (context) => {
    switch (context) {
        case "text":
            return [
                { label: "Bold", command: "Bold" },
                { label: "Italic", command: "Italic" },
                { label: "Clear Formatting", command: "ClearFormatting" },
                ...tableSizes.map((size) => ({
                    label: `Insert Table ${size.rows}Į-${size.cols}`,
                    command: "TableInsert",
                    args: { rows: size.rows, cols: size.cols }
                })),
                { label: "Footnotes…", command: "FootnotePanel" }
            ];
        case "link":
            return [
                { label: "Edit Link", command: "EditLink" },
                { label: "Remove Link", command: "RemoveLink" }
            ];
        case "table":
            return tableSizes.map((size) => ({
                label: `Insert Table ${size.rows}Į-${size.cols}`,
                command: "TableInsert",
                args: { rows: size.rows, cols: size.cols }
            }));
        default:
            return [];
    }
};
const attachContextMenu = (handle, editorDom, editor) => {
    ensureStyles();
    let menuEl = null;
    const closeMenu = () => {
        if (!menuEl)
            return;
        menuEl.remove();
        menuEl = null;
    };
    const onContextMenu = (event) => {
        const target = event.target;
        if (!target || !editorDom.contains(target))
            return;
        const context = determineContext(editor);
        if (!context)
            return;
        event.preventDefault();
        closeMenu();
        const items = buildMenuItems(context);
        if (items.length === 0)
            return;
        menuEl = document.createElement("div");
        menuEl.className = "leditor-context-menu";
        menuEl.style.position = "fixed";
        menuEl.style.top = `${event.clientY}px`;
        menuEl.style.left = `${event.clientX}px`;
        for (const item of items) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = item.label;
            button.addEventListener("click", () => {
                handle.execCommand(item.command, item.args);
                recordAction(context);
                closeMenu();
            });
            menuEl.appendChild(button);
        }
        document.body.appendChild(menuEl);
    };
    const onKeyDown = (event) => {
        if (event.key === "Escape")
            closeMenu();
    };
    document.addEventListener("click", closeMenu);
    document.addEventListener("scroll", closeMenu, true);
    document.addEventListener("keydown", onKeyDown);
    editorDom.addEventListener("contextmenu", onContextMenu);
    return () => {
        closeMenu();
        document.removeEventListener("click", closeMenu);
        document.removeEventListener("scroll", closeMenu, true);
        document.removeEventListener("keydown", onKeyDown);
        editorDom.removeEventListener("contextmenu", onContextMenu);
    };
};
exports.attachContextMenu = attachContextMenu;
