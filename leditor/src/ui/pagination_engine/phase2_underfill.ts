import type { EditorView } from "@tiptap/pm/view";
import type { PluginKey, Transaction } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";
import type { PaginationSnapshot } from "./snapshot.ts";
import type { PaginationPolicy } from "./policy.ts";

type PageInfo = { index: number; pos: number; node: any };

const collectPages = (doc: any, pageType: any): PageInfo[] => {
  const out: PageInfo[] = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (child.type === pageType) {
      out.push({ index: out.length, pos, node: child });
    }
    pos += child.nodeSize;
  }
  return out;
};

export const phase2Underfill = (
  view: EditorView,
  paginationKey: PluginKey,
  snapshot: PaginationSnapshot,
  _policy: PaginationPolicy
): Transaction | null => {
  const pageType = view.state.schema.nodes.page;
  if (!pageType) return null;
  const pages = collectPages(view.state.doc, pageType);
  if (pages.length < 2) return null;
  const metricsByIndex = new Map<number, typeof snapshot.pageChromeByIndex[number]>();
  snapshot.pageChromeByIndex.forEach((page) => metricsByIndex.set(page.pageIndex, page));
  for (let i = 0; i < pages.length - 1; i += 1) {
    const current = metricsByIndex.get(i);
    const next = metricsByIndex.get(i + 1);
    if (!current || !next) continue;
    if (current.freeLines <= 0) continue;
    if (next.usedLines <= 0) continue;
    if (current.freeLines < next.usedLines + 1) continue;
    const joinPos = pages[i].pos + pages[i].node.nodeSize;
    if (canJoin(view.state.doc, joinPos)) {
      const tr = view.state.tr.join(joinPos);
      tr.setMeta(paginationKey, { source: "pagination", op: "join", pos: joinPos });
      return tr;
    }
  }
  return null;
};
