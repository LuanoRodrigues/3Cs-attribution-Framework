import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  getSourceChecksThread,
  isSourceChecksVisible,
  setSourceCheckFixStatus
} from "../ui/source_checks_thread.ts";

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
const sourceCheckFixKey = new PluginKey("leditor-source-check-fix-widgets");

let editorRef: Editor | null = null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const findSentenceStartInBlock = (state: EditorState, blockFrom: number, pos: number): number => {
  const doc = state.doc;
  const left = doc.textBetween(blockFrom, pos, "\n");
  if (!left) return blockFrom;
  // Heuristic: last boundary punctuation followed by whitespace and an uppercase letter/quote/paren.
  const re = /[.!?;]\s+(?=[“"'\(\[]?[A-Z])/g;
  let lastEnd = -1;
  for (const m of left.matchAll(re)) {
    const idx = typeof m.index === "number" ? m.index : -1;
    if (idx < 0) continue;
    // Exclude common citation abbreviations like "p. 12" / "pp. 12".
    const prev = left.slice(Math.max(0, idx - 3), idx + 1).toLowerCase();
    const next = left.slice(idx + 1).trimStart();
    if ((prev.endsWith("p.") || prev.endsWith("pp.")) && /^\d/.test(next)) continue;
    lastEnd = idx + m[0].length;
  }
  return lastEnd >= 0 ? blockFrom + lastEnd : blockFrom;
};

const rangeHasCitationLikeMarks = (state: EditorState, from: number, to: number): boolean => {
  let found = false;
  state.doc.nodesBetween(from, to, (node: any) => {
    if (found) return false;
    if (!node) return true;
    if (String(node.type?.name ?? "") === "citation") {
      found = true;
      return false;
    }
    if (!node.isText || !Array.isArray(node.marks)) return true;
    for (const m of node.marks) {
      const href = typeof m?.attrs?.href === "string" ? String(m.attrs.href) : "";
      const dataDqid = typeof m?.attrs?.dataDqid === "string" ? String(m.attrs.dataDqid) : "";
      if (href.startsWith("dq://") || dataDqid) {
        found = true;
        return false;
      }
      const markName = String(m?.type?.name ?? "");
      if (markName === "anchor" || markName === "citationLink" || markName === "link") {
        if (href.startsWith("dq://")) {
          found = true;
          return false;
        }
      }
    }
    return true;
  });
  return found;
};

const applyClaimRewriteForKey = (key: string) => {
  if (!editorRef) return;
  const k = String(key || "").trim();
  if (!k) return;
  const threadItem = getSourceChecksThread().items.find((it) => String(it?.key) === k) as any;
  const rewrite = typeof threadItem?.claimRewrite === "string" ? String(threadItem.claimRewrite).trim() : "";
  if (!rewrite) return;
  const view = (editorRef as any).view;
  const state = view?.state as EditorState | undefined;
  if (!state) return;
  const sc = getSourceCheckState(state);
  const item = sc?.items?.find((it) => String(it?.key) === k) ?? null;
  if (!item) return;

  const docSize = state.doc.content.size;
  const from = clamp(Math.floor(item.from), 0, docSize);
  const to = clamp(Math.floor(item.to), 0, docSize);
  if (to <= from) return;

  const $pos = state.doc.resolve(from);
  let depth = $pos.depth;
  while (depth > 0 && !$pos.node(depth).isTextblock) depth -= 1;
  const blockNode = $pos.node(depth);
  const blockPos = $pos.before(depth);
  const blockFrom = blockPos + 1;
  const blockTo = blockFrom + blockNode.content.size;
  if (blockTo <= blockFrom) return;

  const sentenceStart = findSentenceStartInBlock(state, blockFrom, from);
  const inBlock = sc?.items?.filter((x) => x && x.from >= blockFrom && x.to <= blockTo) ?? [];
  const inSentence = inBlock.filter((x) => x.from >= sentenceStart);
  const firstCitationFrom = inSentence.reduce((min: number, x: any) => Math.min(min, Math.floor(x.from)), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(firstCitationFrom) || firstCitationFrom <= sentenceStart) return;

  // Safety: never replace any citation-like marked range.
  if (rangeHasCitationLikeMarks(state, sentenceStart, firstCitationFrom)) {
    console.warn("[source_check_badges.ts][applyClaimRewriteForKey][debug] blocked (citation-like marks in range)", {
      key: k,
      sentenceStart,
      firstCitationFrom
    });
    return;
  }

  const insert = rewrite.endsWith(" ") ? rewrite : `${rewrite} `;
  const tr = state.tr.insertText(insert, sentenceStart, firstCitationFrom);
  view.dispatch(tr);
  try {
    setSourceCheckFixStatus(k, "applied");
  } catch {
    // ignore
  }
  try {
    editorRef.commands.setTextSelection?.({ from, to });
    editorRef.commands.focus?.();
  } catch {
    // ignore
  }
};

const dismissClaimRewriteForKey = (key: string) => {
  const k = String(key || "").trim();
  if (!k) return;
  try {
    setSourceCheckFixStatus(k, "dismissed");
  } catch {
    // ignore
  }
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
    const key = String(item.key || "");

    const nodeAtFrom = state.doc.nodeAt(from);
    const isExactNode =
      nodeAtFrom &&
      !nodeAtFrom.isText &&
      typeof nodeAtFrom.nodeSize === "number" &&
      from + nodeAtFrom.nodeSize === to;
    const cls =
      verdict === "verified"
        ? "leditor-source-check--verified leditor-source-check--anchor"
        : "leditor-source-check--needsReview leditor-source-check--anchor";
    if (isExactNode) {
      decos.push(
        Decoration.node(from, to, {
          class: cls,
          "data-source-check": verdict,
          ...(key ? { "data-source-check-key": key } : {})
        })
      );
    } else {
      decos.push(
        Decoration.inline(from, to, {
          class: cls,
          "data-source-check": verdict,
          ...(key ? { "data-source-check-key": key } : {})
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
      }),
      new Plugin({
        key: sourceCheckFixKey,
        props: {
          decorations(state) {
            try {
              if (!isSourceChecksVisible()) return null;
              const sc = getSourceCheckState(state);
              if (!sc?.enabled || !Array.isArray(sc.items) || sc.items.length === 0) return null;
              const thread = getSourceChecksThread();
              if (!thread?.items?.length) return null;
              const byKey = new Map<string, any>();
              for (const it of thread.items as any[]) {
                const k = typeof it?.key === "string" ? String(it.key) : "";
                if (!k) continue;
                byKey.set(k, it);
              }
              const docSize = state.doc.content.size;
              const decos: Decoration[] = [];
              for (const it of sc.items) {
                if (it.verdict === "verified") continue;
                const t = byKey.get(String(it.key));
                if (!t) continue;
                if (t.fixStatus === "dismissed" || t.fixStatus === "applied") continue;
                const rewrite = typeof t.claimRewrite === "string" ? String(t.claimRewrite).trim() : "";
                if (!rewrite) continue;
                const pos = clamp(Math.floor(it.to), 0, docSize);
                decos.push(
                  Decoration.widget(
                    pos,
                    () => {
                      const root = document.createElement("span");
                      root.className = "leditor-source-check-fix";
                      root.dataset.key = String(it.key);

                      const chip = document.createElement("button");
                      chip.type = "button";
                      chip.className = "leditor-source-check-fix__chip";
                      chip.textContent = "Fix";
                      chip.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          root.classList.toggle("is-open");
                        } catch {
                          // ignore
                        }
                      });

                      const pop = document.createElement("span");
                      pop.className = "leditor-source-check-fix__popover";

                      const txt = document.createElement("div");
                      txt.className = "leditor-source-check-fix__text";
                      txt.textContent = rewrite;

                      const actions = document.createElement("div");
                      actions.className = "leditor-source-check-fix__actions";

                      const reject = document.createElement("button");
                      reject.type = "button";
                      reject.className = "leditor-source-check-fix__btn";
                      reject.textContent = "Reject";
                      reject.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dismissClaimRewriteForKey(String(it.key));
                      });

                      const apply = document.createElement("button");
                      apply.type = "button";
                      apply.className = "leditor-source-check-fix__btn leditor-source-check-fix__btn--primary";
                      apply.textContent = "Apply";
                      apply.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        applyClaimRewriteForKey(String(it.key));
                      });

                      actions.append(reject, apply);
                      pop.append(txt, actions);
                      root.append(chip, pop);
                      return root;
                    },
                    { side: 1, key: `fix:${String(it.key)}` }
                  )
                );
              }
              return DecorationSet.create(state.doc, decos);
            } catch {
              return null;
            }
          }
        }
      })
    ];
  }
});
