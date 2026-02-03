import type { Editor } from "@tiptap/core";
import { Selection, TextSelection } from "@tiptap/pm/state";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const moveBlock = (editor: Editor, dir: -1 | 1): boolean => {
  const { state, view } = editor;
  const { $from, from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isBlock) depth -= 1;
  if (depth <= 0) return false;
  const parent = $from.node(depth - 1);
  const index = $from.index(depth);
  if (dir < 0 && index === 0) return false;
  if (dir > 0 && index >= parent.childCount - 1) return false;
  const node = $from.node(depth);
  const nodeStart = $from.before(depth);
  const nodeEnd = nodeStart + node.nodeSize;
  const prevNode = dir < 0 ? parent.child(index - 1) : null;
  const nextNode = dir > 0 ? parent.child(index + 1) : null;
  const targetPos =
    dir < 0
      ? nodeStart - (prevNode?.nodeSize ?? 0)
      : nodeStart + node.nodeSize + (nextNode?.nodeSize ?? 0);
  const slice = state.doc.slice(nodeStart, nodeEnd);
  const tr = state.tr.delete(nodeStart, nodeEnd);
  const mappedTarget = tr.mapping.map(targetPos, -1);
  tr.insert(mappedTarget, slice.content);

  const offset = clamp(from - nodeStart, 0, slice.size);
  const selectionPos = clamp(mappedTarget + offset, 0, tr.doc.content.size);
  try {
    tr.setSelection(TextSelection.create(tr.doc, selectionPos));
  } catch {
    const $pos = tr.doc.resolve(selectionPos);
    tr.setSelection(Selection.near($pos, dir));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
};
