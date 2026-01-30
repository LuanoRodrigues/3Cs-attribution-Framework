import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export type AiDraftPreviewItem = {
  n?: number;
  from: number;
  to: number;
  originalText?: string;
  proposedText: string;
};

type DraftState = {
  enabled: boolean;
  items: AiDraftPreviewItem[];
};

const draftKey = new PluginKey<DraftState>("leditor-ai-draft-preview");

let editorRef: Editor | null = null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const sanitizeSnippet = (value: string, maxLen: number) => {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
};

const buildDecorations = (state: EditorState, draft: DraftState): DecorationSet => {
  if (!draft.enabled || draft.items.length === 0) return DecorationSet.empty;
  const docSize = state.doc.content.size;
  const decos: Decoration[] = [];
  for (const item of draft.items) {
    const from = clamp(Math.floor(item.from), 0, docSize);
    const to = clamp(Math.floor(item.to), 0, docSize);
    if (to <= from) continue;

    decos.push(
      Decoration.inline(from, to, {
        class: "leditor-ai-draft-old",
        "data-ai-draft": "old"
      })
    );

    const label = item.n && item.n > 0 ? `P${item.n}` : "Selection";
    const preview = sanitizeSnippet(item.proposedText, 240);
    decos.push(
      Decoration.widget(
        from,
        () => {
          const el = document.createElement("span");
          el.className = "leditor-ai-draft-pill";
          el.textContent = `AI draft • ${label}`;
          el.setAttribute("title", `Proposed:\n${preview}`);
          el.contentEditable = "false";
          el.setAttribute("aria-hidden", "true");
          return el;
        },
        { side: -1 }
      )
    );

    decos.push(
      Decoration.widget(
        to,
        () => {
          const el = document.createElement("span");
          el.className = "leditor-ai-draft-new";
          const snippet = sanitizeSnippet(item.proposedText, 220);
          el.textContent = snippet ? ` ${snippet}` : "";
          el.setAttribute("title", `Proposed:\n${sanitizeSnippet(item.proposedText, 2000)}`);
          el.contentEditable = "false";
          el.setAttribute("aria-hidden", "true");
          return el;
        },
        { side: 1 }
      )
    );
  }
  return DecorationSet.create(state.doc, decos);
};

const applyDraftMeta = (tr: Transaction, prev: DraftState): DraftState => {
  const meta = tr.getMeta(draftKey) as Partial<DraftState> | null;
  if (!meta) return prev;
  return {
    enabled: typeof meta.enabled === "boolean" ? meta.enabled : prev.enabled,
    items: Array.isArray(meta.items) ? (meta.items as AiDraftPreviewItem[]) : prev.items
  };
};

export const setAiDraftPreviewEditor = (editor: Editor) => {
  editorRef = editor;
};

export const setAiDraftPreview = (items: AiDraftPreviewItem[]) => {
  if (!editorRef) return;
  const tr = editorRef.state.tr.setMeta(draftKey, { enabled: true, items });
  editorRef.view.dispatch(tr);
};

export const clearAiDraftPreview = () => {
  if (!editorRef) return;
  const tr = editorRef.state.tr.setMeta(draftKey, { enabled: false, items: [] });
  editorRef.view.dispatch(tr);
};

export const aiDraftPreviewExtension = Extension.create({
  name: "aiDraftPreview",
  addCommands() {
    return {
      setAiDraftPreview:
        (items: AiDraftPreviewItem[]) =>
        () => {
          setAiDraftPreview(items);
          return true;
        },
      clearAiDraftPreview:
        () =>
        () => {
          clearAiDraftPreview();
          return true;
        }
    } as any;
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<DraftState>({
        key: draftKey,
        state: {
          init() {
            return { enabled: false, items: [] };
          },
          apply(tr, prev, _oldState, newState) {
            const next = applyDraftMeta(tr, prev);
            if (tr.docChanged || tr.getMeta(draftKey)) {
              // If positions are stale due to doc changes, keep them as-is; Accept will revalidate anyway.
              (this as any)._decorations = buildDecorations(newState, next);
            }
            return next;
          }
        },
        props: {
          decorations(state) {
            const pluginState = draftKey.getState(state);
            if (!pluginState?.enabled) return null;
            const cached = (this as any)._decorations as DecorationSet | undefined;
            return cached ?? buildDecorations(state, pluginState);
          }
        }
      })
    ];
  }
});
