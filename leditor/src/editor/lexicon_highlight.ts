import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type LexiconHighlightState = {
  active: boolean;
  from: number;
  to: number;
};

const lexiconHighlightKey = new PluginKey<LexiconHighlightState>("leditor-lexicon-highlight");

export const lexiconHighlightExtension = Extension.create({
  name: "lexiconHighlight",
  addCommands() {
    return {
      setLexiconHighlight:
        (args: { from: number; to: number }) =>
        ({ tr, dispatch }: CommandProps) => {
          const from = Math.max(0, Math.floor(Number(args?.from) || 0));
          const to = Math.max(from, Math.floor(Number(args?.to) || 0));
          if (!dispatch) return true;
          dispatch(tr.setMeta(lexiconHighlightKey, { active: true, from, to }));
          return true;
        },
      clearLexiconHighlight:
        () =>
        ({ tr, dispatch }: CommandProps) => {
          if (!dispatch) return true;
          dispatch(tr.setMeta(lexiconHighlightKey, { active: false, from: 0, to: 0 }));
          return true;
        }
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<LexiconHighlightState>({
        key: lexiconHighlightKey,
        state: {
          init() {
            return { active: false, from: 0, to: 0 };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(lexiconHighlightKey) as Partial<LexiconHighlightState> | null;
            let next: LexiconHighlightState = prev;
            if (meta && typeof meta === "object") {
              next = {
                active: typeof meta.active === "boolean" ? meta.active : prev.active,
                from: typeof meta.from === "number" ? meta.from : prev.from,
                to: typeof meta.to === "number" ? meta.to : prev.to
              };
            }
            if (tr.docChanged && next.active) {
              try {
                const mappedFrom = tr.mapping.map(next.from);
                const mappedTo = tr.mapping.map(next.to);
                next = { ...next, from: mappedFrom, to: mappedTo };
              } catch {
                // ignore
              }
            }
            return next;
          }
        },
        props: {
          decorations(state) {
            const s = lexiconHighlightKey.getState(state);
            if (!s?.active) return null;
            const from = Math.max(0, Math.min(state.doc.content.size, Math.floor(s.from)));
            const to = Math.max(from, Math.min(state.doc.content.size, Math.floor(s.to)));
            if (to <= from) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(from, to, {
                class: "leditor-lexicon-highlight"
              })
            ]);
          }
        }
      })
    ];
  }
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lexiconHighlight: {
      setLexiconHighlight: (args: { from: number; to: number }) => ReturnType;
      clearLexiconHighlight: () => ReturnType;
    };
  }
}
