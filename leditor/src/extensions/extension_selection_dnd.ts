import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { DOMSerializer } from "@tiptap/pm/model";

type DragState = {
  from: number;
  to: number;
  slice: any;
  text: string;
  html: string;
};

const dragKey = new PluginKey("selectionDragDrop");

const clampPos = (doc: any, pos: number) => Math.max(0, Math.min(doc.content.size, pos));

const resolveInlinePos = (view: any, pos: number) => {
  const doc = view.state.doc;
  const max = doc.content.size;
  const clamp = (p: number) => Math.max(0, Math.min(max, p));
  const isInline = (p: number) => {
    const $pos = doc.resolve(p);
    return $pos.parent.inlineContent;
  };
  let candidate = clamp(pos);
  if (isInline(candidate)) return candidate;
  for (let step = 1; step <= 4; step += 1) {
    const left = clamp(candidate - step);
    if (isInline(left)) return left;
    const right = clamp(candidate + step);
    if (isInline(right)) return right;
  }
  try {
    const $pos = doc.resolve(candidate);
    const near = Selection.near($pos, 1);
    const nearPos = clampPos(doc, (near as any).from ?? candidate);
    if (isInline(nearPos)) return nearPos;
  } catch {
    // ignore
  }
  return candidate;
};

const buildDragPayload = (view: any, from: number, to: number): DragState | null => {
  if (to <= from) return null;
  const slice = view.state.doc.slice(from, to);
  const serializer = DOMSerializer.fromSchema(view.state.schema);
  const wrap = document.createElement("div");
  wrap.appendChild(serializer.serializeFragment(slice.content));
  const html = wrap.innerHTML;
  const text = view.state.doc.textBetween(from, to, "\n");
  return { from, to, slice, text, html };
};

const SelectionDragDropExtension = Extension.create({
  name: "selectionDragDrop",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dragKey,
        props: {
          handleDOMEvents: {
            dragstart(view, event) {
              const dragEvent = event as DragEvent;
              const sel = view.state.selection;
              if (sel.empty) return false;
              const target = dragEvent.target as HTMLElement | null;
              if (!target || !view.dom.contains(target)) return false;
              const payload = buildDragPayload(view, sel.from, sel.to);
              if (!payload) return false;
              (view as any).__leditorDragState = payload;
              if (dragEvent.dataTransfer) {
                dragEvent.dataTransfer.effectAllowed = "copyMove";
                dragEvent.dataTransfer.setData("text/plain", payload.text);
                if (payload.html.trim().length > 0) {
                  dragEvent.dataTransfer.setData("text/html", payload.html);
                }
              }
              return true;
            },
            dragover(_view, event) {
              const dragEvent = event as DragEvent;
              const payload = (_view as any).__leditorDragState as DragState | null;
              if (!payload) return false;
              if (dragEvent.dataTransfer) {
                dragEvent.dataTransfer.dropEffect = dragEvent.ctrlKey ? "copy" : "move";
              }
              dragEvent.preventDefault();
              return true;
            },
            drop(view, event) {
              const payload = (view as any).__leditorDragState as DragState | null;
              if (!payload) return false;
              const dragEvent = event as DragEvent;
              const coords = view.posAtCoords?.({ left: dragEvent.clientX, top: dragEvent.clientY }) ?? null;
              if (!coords || typeof coords.pos !== "number") return false;
              let insertPos = resolveInlinePos(view, coords.pos);
              const { from, to, slice } = payload;
              const rangeSize = to - from;
              const isCopy = dragEvent.ctrlKey;
              if (!isCopy && insertPos > from) {
                insertPos = Math.max(from, insertPos - rangeSize);
              }
              let tr = view.state.tr;
              if (!isCopy) {
                tr = tr.delete(from, to);
              }
              tr = tr.replaceRange(insertPos, insertPos, slice);
              try {
                const $pos = tr.doc.resolve(clampPos(tr.doc, insertPos));
                tr = tr.setSelection(Selection.near($pos, 1));
              } catch {
                // ignore
              }
              view.dispatch(tr.scrollIntoView());
              (view as any).__leditorDragState = null;
              dragEvent.preventDefault();
              return true;
            },
            dragend(view) {
              (view as any).__leditorDragState = null;
              return false;
            }
          }
        }
      })
    ];
  }
});

export default SelectionDragDropExtension;
