"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visualExtension = exports.toggleVisualChars = exports.toggleVisualBlocks = exports.setVisualEditor = void 0;
const core_1 = require("@tiptap/core");
const prosemirror_view_1 = require("prosemirror-view");
const prosemirror_state_1 = require("prosemirror-state");
const visualPluginKey = new prosemirror_state_1.PluginKey("leditor-visual");
let editorRef = null;
let updateListener = null;
const phaseFlags = {
    blocksToggled: false,
    charsToggled: false,
    typed: false,
    logged: false
};
let visualBlocksEnabled = false;
let visualCharsEnabled = false;
const maybeLogPhase = () => {
    if (phaseFlags.logged)
        return;
    if (phaseFlags.blocksToggled && phaseFlags.charsToggled && phaseFlags.typed) {
        window.codexLog?.write("[PHASE18_OK]");
        phaseFlags.logged = true;
    }
};
const setVisualEditor = (editor) => {
    if (editorRef && updateListener) {
        editorRef.off("update", updateListener);
    }
    editorRef = editor;
    updateListener = () => {
        if (visualBlocksEnabled || visualCharsEnabled) {
            phaseFlags.typed = true;
            maybeLogPhase();
        }
    };
    editorRef.on("update", updateListener);
};
exports.setVisualEditor = setVisualEditor;
const requestDecorationsRefresh = () => {
    if (!editorRef)
        return;
    editorRef.view.dispatch(editorRef.state.tr.setMeta(visualPluginKey, {
        refresh: true
    }));
};
const ensureStyles = () => {
    if (document.getElementById("leditor-visual-styles"))
        return;
    const style = document.createElement("style");
    style.id = "leditor-visual-styles";
    style.textContent = `
.leditor-visual-block {
  outline: none;
  outline-offset: 0;
  border-radius: 6px;
}
.leditor-visual-char-space {
  position: relative;
}
.leditor-visual-char-space::after {
  content: "¶ú";
  position: absolute;
  right: -16px;
  font-size: 10px;
  color: #bb7f3d;
  pointer-events: none;
}
.leditor-visual-char-paragraph-end {
  font-size: 11px;
  color: #bb7f3d;
  margin-left: 4px;
  display: inline-block;
}
`;
    document.head.appendChild(style);
};
const blockNodeTypes = new Set([
    "paragraph",
    "heading",
    "listItem",
    "table_cell",
    "table_header",
    "blockquote",
    "code_block"
]);
const getVisibleRange = (state) => {
    const pad = 80;
    const from = Math.max(0, state.selection.from - pad);
    const to = Math.min(state.doc.content.size, state.selection.to + pad);
    return { from, to };
};
const createParagraphMarker = () => {
    const marker = document.createElement("span");
    marker.className = "leditor-visual-char-paragraph-end";
    marker.textContent = "¶ô";
    return marker;
};
const buildDecorations = (state) => {
    const decorations = [];
    if (visualBlocksEnabled) {
        state.doc.descendants((node, pos) => {
            if (node.type.name === "doc")
                return true;
            if (blockNodeTypes.has(node.type.name)) {
                decorations.push(prosemirror_view_1.Decoration.node(pos, pos + node.nodeSize, {
                    class: "leditor-visual-block"
                }));
            }
            return true;
        });
    }
    if (visualCharsEnabled) {
        const { from, to } = getVisibleRange(state);
        state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.isText && typeof node.text === "string") {
                const start = Math.max(0, from - pos);
                const end = Math.min(node.text.length, to - pos);
                for (let i = start; i < end; i += 1) {
                    if (node.text[i] === " ") {
                        decorations.push(prosemirror_view_1.Decoration.inline(pos + i, pos + i + 1, {
                            class: "leditor-visual-char-space"
                        }));
                    }
                }
                return true;
            }
            if (node.isTextblock && blockNodeTypes.has(node.type.name)) {
                const widgetPos = pos + node.nodeSize - 1;
                if (widgetPos >= from && widgetPos <= to + 1) {
                    decorations.push(prosemirror_view_1.Decoration.widget(widgetPos, createParagraphMarker, { side: 1 }));
                }
            }
            return true;
        });
    }
    return prosemirror_view_1.DecorationSet.create(state.doc, decorations);
};
const toggleVisualBlocks = () => {
    visualBlocksEnabled = !visualBlocksEnabled;
    if (visualBlocksEnabled) {
        phaseFlags.blocksToggled = true;
    }
    maybeLogPhase();
    requestDecorationsRefresh();
};
exports.toggleVisualBlocks = toggleVisualBlocks;
const toggleVisualChars = () => {
    visualCharsEnabled = !visualCharsEnabled;
    if (visualCharsEnabled) {
        phaseFlags.charsToggled = true;
    }
    maybeLogPhase();
    requestDecorationsRefresh();
};
exports.toggleVisualChars = toggleVisualChars;
exports.visualExtension = core_1.Extension.create({
    name: "visualDecorations",
    addProseMirrorPlugins() {
        ensureStyles();
        return [
            new prosemirror_state_1.Plugin({
                key: visualPluginKey,
                state: {
                    init(_, state) {
                        return buildDecorations(state);
                    },
                    apply(tr, value, oldState, newState) {
                        const meta = tr.getMeta(visualPluginKey);
                        if (tr.docChanged || (meta && meta.refresh)) {
                            return buildDecorations(newState);
                        }
                        return value.map(tr.mapping, newState.doc);
                    }
                },
                props: {
                    decorations(state) {
                        return this.getState(state);
                    }
                }
            })
        ];
    }
});
