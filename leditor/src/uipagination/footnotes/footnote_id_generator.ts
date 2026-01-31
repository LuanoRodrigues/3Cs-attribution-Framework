import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { FootnoteKind } from "./model.ts";

type FootnoteIdState = {
  counters: Record<FootnoteKind, number>;
  used: Set<string>;
};

const state: FootnoteIdState = {
  counters: { footnote: 0, endnote: 0 },
  used: new Set()
};

const parseNumericId = (id: string): { kind: FootnoteKind; n: number } | null => {
  const trimmed = (id || "").trim();
  const m = /^(footnote|endnote)-(\d+)$/.exec(trimmed);
  if (!m) return null;
  const kind = (m[1] as FootnoteKind) === "endnote" ? "endnote" : "footnote";
  const n = Number.parseInt(m[2], 10);
  if (!Number.isFinite(n)) return null;
  return { kind, n };
};

export const resetFootnoteCounter = () => {
  state.counters.footnote = 0;
  state.counters.endnote = 0;
  state.used.clear();
};

export const registerFootnoteId = (id: string, kind?: FootnoteKind) => {
  const trimmed = (id || "").trim();
  if (!trimmed) return;
  state.used.add(trimmed);
  const parsed = parseNumericId(trimmed);
  if (!parsed) return;
  const parsedKind = parsed.kind;
  if (kind && kind !== parsedKind) return;
  state.counters[parsedKind] = Math.max(state.counters[parsedKind], parsed.n + 1);
};

export const seedFootnoteCounterFromDoc = (doc: ProseMirrorNode) => {
  resetFootnoteCounter();
  doc.descendants((node) => {
    if (node.type.name !== "footnote") return true;
    const id = typeof node.attrs?.footnoteId === "string" ? node.attrs.footnoteId : "";
    const rawKind = typeof node.attrs?.kind === "string" ? node.attrs.kind : "footnote";
    const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
    if (id) registerFootnoteId(id, kind);
    return true;
  });
};

export const getNextFootnoteId = (kind: FootnoteKind): string => {
  const normalizedKind: FootnoteKind = kind === "endnote" ? "endnote" : "footnote";
  for (let guard = 0; guard < 100000; guard += 1) {
    const id = `${normalizedKind}-${state.counters[normalizedKind]}`;
    state.counters[normalizedKind] += 1;
    if (state.used.has(id)) continue;
    state.used.add(id);
    return id;
  }
  throw new Error("Footnote ID generator exceeded guard limit.");
};

export const debugFootnoteIdState = () => ({
  counters: { ...state.counters },
  usedCount: state.used.size
});

