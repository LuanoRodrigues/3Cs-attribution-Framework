import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";

const paragraphGridKey = new PluginKey("leditor-paragraph-grid");

let enabled = false;
let editorRef: Editor | null = null;

const excludedParentTypes = new Set([
  "tableCell",
  "tableHeader",
  "table_cell",
  "table_header",
  "footnoteBody"
]);

const isCountedTextblock = (node: any, parent: any): boolean => {
  if (!node?.isTextblock) return false;
  if (node.type?.name === "doc") return false;
  const parentName = parent?.type?.name;
  if (parentName && excludedParentTypes.has(parentName)) return false;
  return true;
};

const createNumberWidget = (
  label: string,
  meta?: { kind?: "paragraph" | "heading"; sectionNumber?: string; sectionTitle?: string; paragraphInSection?: number }
) => {
  const el = document.createElement("span");
  el.className = "leditor-paragraph-grid__n";
  if (meta?.kind === "heading") {
    el.classList.add("leditor-paragraph-grid__n--heading");
  }
  el.textContent = String(label);
  el.contentEditable = "false";
  el.setAttribute("aria-hidden", "true");
  if (meta?.kind) el.dataset.kind = meta.kind;
  if (meta?.sectionNumber) el.dataset.sectionNumber = meta.sectionNumber;
  if (meta?.sectionTitle) el.dataset.sectionTitle = meta.sectionTitle;
  if (typeof meta?.paragraphInSection === "number") el.dataset.paragraphInSection = String(meta.paragraphInSection);
  return el;
};

const buildDecorations = (state: EditorState) => {
  if (!enabled) {
    return DecorationSet.empty;
  }
  const decorations: Decoration[] = [];
  let paragraphN = 0;
  const headingCounters: number[] = [];
  let currentSectionNumber = "";
  let currentSectionTitle = "";
  let paragraphInSection = 0;

  const bumpHeading = (levelRaw: unknown): string => {
    const level = Math.max(1, Math.min(6, Number(levelRaw ?? 1) || 1));
    while (headingCounters.length < level) headingCounters.push(0);
    headingCounters[level - 1] += 1;
    for (let i = level; i < headingCounters.length; i += 1) {
      headingCounters[i] = 0;
    }
    return headingCounters.slice(0, level).join(".");
  };

  state.doc.nodesBetween(0, state.doc.content.size, (node, pos, parent) => {
    if (!isCountedTextblock(node, parent)) return true;
    const widgetPos = pos + 1;
    if (node.type?.name === "heading") {
      const number = bumpHeading((node.attrs as any)?.level);
      currentSectionNumber = number;
      paragraphInSection = 0;
      currentSectionTitle = String(node.textContent || "").trim();
      decorations.push(
        Decoration.widget(widgetPos, () =>
          createNumberWidget(number, {
            kind: "heading",
            sectionNumber: currentSectionNumber,
            sectionTitle: currentSectionTitle
          }),
          { side: -1 }
        )
      );
      return true;
    }
    paragraphN += 1;
    paragraphInSection += 1;
    decorations.push(
      Decoration.widget(
        widgetPos,
        () =>
          createNumberWidget(String(paragraphN), {
            kind: "paragraph",
            sectionNumber: currentSectionNumber,
            sectionTitle: currentSectionTitle,
            paragraphInSection
          }),
        { side: -1 }
      )
    );
    return true;
  });

  return DecorationSet.create(state.doc, decorations);
};

export const setParagraphGridEnabled = (value: boolean) => {
  enabled = Boolean(value);
  if (!editorRef) return;
  editorRef.view.dispatch(editorRef.state.tr.setMeta(paragraphGridKey, { refresh: true }));
};

export const toggleParagraphGrid = () => {
  setParagraphGridEnabled(!enabled);
};

export const isParagraphGridEnabled = () => enabled;

export const setParagraphGridEditor = (editor: Editor) => {
  editorRef = editor;
};

export const paragraphGridExtension = Extension.create({
  name: "paragraphGrid",
  addCommands() {
    return {
      setParagraphGrid:
        (value: boolean) =>
        () => {
          setParagraphGridEnabled(value);
          return true;
        },
      toggleParagraphGrid:
        () =>
        () => {
          toggleParagraphGrid();
          return true;
        }
    } as any;
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: paragraphGridKey,
        state: {
          init(_, state) {
            return buildDecorations(state);
          },
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(paragraphGridKey);
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
