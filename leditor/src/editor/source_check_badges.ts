import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export type SourceCheckItem = {
  key: string;
  from: number;
  to: number;
  verdict: "verified" | "needs_review";
  justification: string;
};

type SourceCheckState = {
  enabled: boolean;
  items: SourceCheckItem[];
};

export const sourceCheckKey = new PluginKey<SourceCheckState>("leditor-source-check-badges");

let editorRef: Editor | null = null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const buildDecorations = (state: EditorState, sc: SourceCheckState): DecorationSet => {
  if (!sc.enabled || sc.items.length === 0) return DecorationSet.empty;
  const docSize = state.doc.content.size;
  const decos: Decoration[] = [];

  for (const item of sc.items) {
    const from = clamp(Math.floor(item.from), 0, docSize);
    const to = clamp(Math.floor(item.to), 0, docSize);
    if (to <= from) continue;
    const verdict = item.verdict === "verified" ? "verified" : "needs_review";

    const nodeAtFrom = state.doc.nodeAt(from);
    const isExactNode =
      nodeAtFrom && typeof nodeAtFrom.nodeSize === "number" && from + nodeAtFrom.nodeSize === to;
    const cls =
      verdict === "verified"
        ? "leditor-source-check--verified leditor-source-check--anchor"
        : "leditor-source-check--needsReview leditor-source-check--anchor";
    if (isExactNode) {
      decos.push(
        Decoration.node(from, to, {
          class: cls,
          "data-source-check": verdict
        })
      );
    } else {
      decos.push(
        Decoration.inline(from, to, {
          class: cls,
          "data-source-check": verdict
        })
      );
    }
  }

  return DecorationSet.create(state.doc, decos);
};

const applyMeta = (tr: Transaction, prev: SourceCheckState): SourceCheckState => {
  const meta = tr.getMeta(sourceCheckKey) as Partial<SourceCheckState> | null;
  if (!meta) return prev;
  return {
    enabled: typeof meta.enabled === "boolean" ? meta.enabled : prev.enabled,
    items: Array.isArray(meta.items) ? (meta.items as SourceCheckItem[]) : prev.items
  };
};

export const setSourceCheckBadgesEditor = (editor: Editor) => {
  editorRef = editor;
};

export const getSourceCheckState = (state: EditorState): SourceCheckState | null => {
  try {
    return sourceCheckKey.getState(state) ?? null;
  } catch {
    return null;
  }
};

export const setSourceChecks = (items: SourceCheckItem[]) => {
  if (!editorRef) return;
  const tr = editorRef.state.tr.setMeta(sourceCheckKey, { enabled: true, items });
  editorRef.view.dispatch(tr);
};

export const clearSourceChecks = () => {
  if (!editorRef) return;
  const tr = editorRef.state.tr.setMeta(sourceCheckKey, { enabled: false, items: [] });
  editorRef.view.dispatch(tr);
};

export const sourceCheckBadgesExtension = Extension.create({
  name: "sourceCheckBadges",
  addCommands() {
    return {
      setSourceChecks:
        (items: SourceCheckItem[]) =>
        () => {
          setSourceChecks(items);
          return true;
        },
      clearSourceChecks:
        () =>
        () => {
          clearSourceChecks();
          return true;
        }
    } as any;
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<SourceCheckState>({
        key: sourceCheckKey,
        state: {
          init() {
            return { enabled: false, items: [] };
          },
          apply(tr, prev, _oldState, newState) {
            const next = applyMeta(tr, prev);
            if (tr.docChanged || tr.getMeta(sourceCheckKey)) {
              (this as any)._decorations = buildDecorations(newState, next);
            }
            return next;
          }
        },
        props: {
          decorations(state) {
            const pluginState = sourceCheckKey.getState(state);
            if (!pluginState?.enabled) return null;
            const cached = (this as any)._decorations as DecorationSet | undefined;
            return cached ?? buildDecorations(state, pluginState);
          }
        }
      })
    ];
  }
});
