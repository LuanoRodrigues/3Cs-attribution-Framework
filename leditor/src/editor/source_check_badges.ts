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

const sourceCheckKey = new PluginKey<SourceCheckState>("leditor-source-check-badges");

let editorRef: Editor | null = null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const sanitize = (value: string, maxLen: number) => {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
};

const buildDecorations = (state: EditorState, sc: SourceCheckState): DecorationSet => {
  if (!sc.enabled || sc.items.length === 0) return DecorationSet.empty;
  const docSize = state.doc.content.size;
  const decos: Decoration[] = [];

  for (const item of sc.items) {
    const from = clamp(Math.floor(item.from), 0, docSize);
    const to = clamp(Math.floor(item.to), 0, docSize);
    if (to <= from) continue;
    const verdict = item.verdict === "verified" ? "verified" : "needs_review";
    const title = sanitize(item.justification, 280);

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

    decos.push(
      Decoration.widget(
        to,
        () => {
          const el = document.createElement("span");
          el.className =
            verdict === "verified"
              ? "leditor-source-check-badge leditor-source-check-badge--verified"
              : "leditor-source-check-badge leditor-source-check-badge--needsReview";
          el.textContent = verdict === "verified" ? "✓" : "✕";
          el.setAttribute("title", title || (verdict === "verified" ? "Verified" : "Needs review"));
          el.contentEditable = "false";
          el.dataset.key = item.key;
          return el;
        },
        { side: 1 }
      )
    );

    decos.push(
      Decoration.widget(
        to,
        () => {
          const el = document.createElement("span");
          el.className =
            verdict === "verified"
              ? "leditor-source-check-note leditor-source-check-note--verified"
              : "leditor-source-check-note leditor-source-check-note--needsReview";
          el.textContent = sanitize(item.justification, 140);
          el.contentEditable = "false";
          el.setAttribute("aria-hidden", "true");
          return el;
        },
        { side: 2 }
      )
    );
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
