import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

const visualPluginKey = new PluginKey("leditor-visual");

let editorRef: Editor | null = null;
let updateListener: (() => void) | null = null;

const phaseFlags = {
  blocksToggled: false,
  charsToggled: false,
  typed: false,
  logged: false
};

let visualBlocksEnabled = false;
let visualCharsEnabled = false;

const maybeLogPhase = () => {
  if (phaseFlags.logged) return;
  if (phaseFlags.blocksToggled && phaseFlags.charsToggled && phaseFlags.typed) {
    window.codexLog?.write("[PHASE18_OK]");
    phaseFlags.logged = true;
  }
};

export const setVisualEditor = (editor: Editor) => {
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

const requestDecorationsRefresh = () => {
  if (!editorRef) return;
  editorRef.view.dispatch(
    editorRef.state.tr.setMeta(visualPluginKey, {
      refresh: true
    })
  );
};

const ensureStyles = () => {
  if (document.getElementById("leditor-visual-styles")) return;
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

const getVisibleRange = (state: EditorState) => {
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

const buildDecorations = (state: EditorState) => {
  const decorations: Decoration[] = [];

  if (visualBlocksEnabled) {
    state.doc.descendants((node, pos) => {
      if (node.type.name === "doc") return true;
      if (blockNodeTypes.has(node.type.name)) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "leditor-visual-block"
          })
        );
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
            decorations.push(
              Decoration.inline(pos + i, pos + i + 1, {
                class: "leditor-visual-char-space"
              })
            );
          }
        }
        return true;
      }
      if (node.isTextblock && blockNodeTypes.has(node.type.name)) {
        const widgetPos = pos + node.nodeSize - 1;
        if (widgetPos >= from && widgetPos <= to + 1) {
          decorations.push(
            Decoration.widget(widgetPos, createParagraphMarker, { side: 1 })
          );
        }
      }
      return true;
    });
  }

  return DecorationSet.create(state.doc, decorations);
};

export const toggleVisualBlocks = () => {
  visualBlocksEnabled = !visualBlocksEnabled;
  if (visualBlocksEnabled) {
    phaseFlags.blocksToggled = true;
  }
  maybeLogPhase();
  requestDecorationsRefresh();
};

export const toggleVisualChars = () => {
  visualCharsEnabled = !visualCharsEnabled;
  if (visualCharsEnabled) {
    phaseFlags.charsToggled = true;
  }
  maybeLogPhase();
  requestDecorationsRefresh();
};

export const isVisualBlocksEnabled = () => visualBlocksEnabled;
export const isVisualCharsEnabled = () => visualCharsEnabled;

export const visualExtension = Extension.create({
  name: "visualDecorations",
  addProseMirrorPlugins() {
    ensureStyles();
    return [
      new Plugin({
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
