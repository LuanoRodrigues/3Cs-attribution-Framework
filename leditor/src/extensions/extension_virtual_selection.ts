import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMSerializer } from "@tiptap/pm/model";
import { getSelectionMode } from "../editor/input_modes.ts";

export type VirtualSelectionRange = { from: number; to: number };
type VirtualSelectionKind = "add" | "block" | null;
type VirtualSelectionState = { ranges: VirtualSelectionRange[]; kind: VirtualSelectionKind };

export const virtualSelectionKey = new PluginKey<VirtualSelectionState>("virtualSelection");

const clampRange = (docSize: number, range: VirtualSelectionRange): VirtualSelectionRange | null => {
  const from = Math.max(0, Math.min(docSize, Math.min(range.from, range.to)));
  const to = Math.max(0, Math.min(docSize, Math.max(range.from, range.to)));
  if (to <= from) return null;
  return { from, to };
};

const normalizeRanges = (docSize: number, ranges: VirtualSelectionRange[]): VirtualSelectionRange[] => {
  const cleaned = ranges
    .map((range) => clampRange(docSize, range))
    .filter((range): range is VirtualSelectionRange => !!range)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  if (cleaned.length <= 1) return cleaned;
  const merged: VirtualSelectionRange[] = [];
  let current = cleaned[0];
  for (let i = 1; i < cleaned.length; i += 1) {
    const next = cleaned[i];
    if (next.from <= current.to + 1) {
      current = { from: current.from, to: Math.max(current.to, next.to) };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
};

const rangesEqual = (a: VirtualSelectionRange, b: VirtualSelectionRange) =>
  a.from === b.from && a.to === b.to;

const isRangeDuplicate = (ranges: VirtualSelectionRange[], next: VirtualSelectionRange) =>
  ranges.some((range) => rangesEqual(range, next));

const mapRanges = (ranges: VirtualSelectionRange[], tr: any): VirtualSelectionRange[] => {
  if (!tr.docChanged || ranges.length === 0) return ranges;
  const docSize = tr.doc.content.size;
  const mapped = ranges
    .map((range) => {
      const from = tr.mapping.map(range.from, 1);
      const to = tr.mapping.map(range.to, -1);
      return clampRange(docSize, { from, to });
    })
    .filter((range): range is VirtualSelectionRange => !!range);
  return normalizeRanges(docSize, mapped);
};

export const setVirtualSelections = (
  editor: { view: any },
  ranges: VirtualSelectionRange[],
  kind: VirtualSelectionKind
) => {
  if (!editor?.view) return;
  const tr = editor.view.state.tr;
  editor.view.dispatch(tr.setMeta(virtualSelectionKey, { type: "set", ranges, kind }));
};

export const clearVirtualSelections = (editor: { view: any }) => {
  if (!editor?.view) return;
  const tr = editor.view.state.tr;
  editor.view.dispatch(tr.setMeta(virtualSelectionKey, { type: "clear" }));
};

export const getVirtualSelections = (state: any): VirtualSelectionState =>
  virtualSelectionKey.getState(state) ?? { ranges: [], kind: null };

const buildClipboardHtml = (state: any, ranges: VirtualSelectionRange[]) => {
  const serializer = DOMSerializer.fromSchema(state.schema);
  const wrap = document.createElement("div");
  for (const range of ranges) {
    const slice = state.doc.slice(range.from, range.to);
    wrap.appendChild(serializer.serializeFragment(slice.content));
    wrap.appendChild(document.createElement("br"));
  }
  return wrap.innerHTML;
};

const buildClipboardText = (state: any, ranges: VirtualSelectionRange[]) =>
  ranges.map((range) => state.doc.textBetween(range.from, range.to, "\n")).join("\n");

const deleteRanges = (view: any, ranges: VirtualSelectionRange[]) => {
  if (!ranges.length) return false;
  const ordered = [...ranges].sort((a, b) => b.from - a.from);
  let tr = view.state.tr;
  for (const range of ordered) {
    tr = tr.delete(range.from, range.to);
  }
  view.dispatch(tr.scrollIntoView());
  return true;
};

const buildDecorations = (doc: any, state: VirtualSelectionState) => {
  if (!state.ranges.length) return null;
  const className =
    state.kind === "block"
      ? "leditor-virtual-selection leditor-virtual-selection--block"
      : "leditor-virtual-selection leditor-virtual-selection--add";
  const decos = state.ranges.map((range) =>
    Decoration.inline(range.from, range.to, { class: className })
  );
  return DecorationSet.create(doc, decos);
};

const VirtualSelectionExtension = Extension.create({
  name: "virtualSelection",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: virtualSelectionKey,
        state: {
          init: () => ({ ranges: [] as VirtualSelectionRange[], kind: null as VirtualSelectionKind }),
          apply(tr, prev) {
            let next = prev;
            const meta = tr.getMeta(virtualSelectionKey) as any;
            if (meta?.type === "set") {
              const docSize = tr.doc.content.size;
              next = {
                ranges: normalizeRanges(docSize, meta.ranges ?? []),
                kind: meta.kind ?? null
              };
            } else if (meta?.type === "clear") {
              next = { ranges: [], kind: null };
            } else if (tr.docChanged && prev.ranges.length) {
              next = { ...prev, ranges: mapRanges(prev.ranges, tr) };
            }
            return next;
          }
        },
        props: {
          decorations(state) {
            const data = virtualSelectionKey.getState(state);
            if (!data || !data.ranges.length) return null;
            return buildDecorations(state.doc, data);
          },
          handleDOMEvents: {
            copy(view, event) {
              const state = virtualSelectionKey.getState(view.state);
              if (!state || state.ranges.length === 0) return false;
              const normalized = normalizeRanges(view.state.doc.content.size, state.ranges);
              const plain = buildClipboardText(view.state, normalized);
              const clipboardEvent = event as ClipboardEvent;
              clipboardEvent.preventDefault();
              if (clipboardEvent.clipboardData) {
                clipboardEvent.clipboardData.setData("text/plain", plain);
                try {
                  const html = buildClipboardHtml(view.state, normalized);
                  if (html.trim().length > 0) {
                    clipboardEvent.clipboardData.setData("text/html", html);
                  }
                } catch {
                  // ignore html failures
                }
              }
              return true;
            },
            cut(view, event) {
              const state = virtualSelectionKey.getState(view.state);
              if (!state || state.ranges.length === 0) return false;
              const normalized = normalizeRanges(view.state.doc.content.size, state.ranges);
              const plain = buildClipboardText(view.state, normalized);
              const clipboardEvent = event as ClipboardEvent;
              clipboardEvent.preventDefault();
              if (clipboardEvent.clipboardData) {
                clipboardEvent.clipboardData.setData("text/plain", plain);
                try {
                  const html = buildClipboardHtml(view.state, normalized);
                  if (html.trim().length > 0) {
                    clipboardEvent.clipboardData.setData("text/html", html);
                  }
                } catch {
                  // ignore
                }
              }
              if (deleteRanges(view, normalized)) {
                const tr = view.state.tr.setMeta(virtualSelectionKey, { type: "clear" });
                view.dispatch(tr);
              }
              return true;
            }
          },
          handleKeyDown(view, event) {
            const state = virtualSelectionKey.getState(view.state);
            if (!state || state.ranges.length === 0) return false;
            if (event.key === "Escape") {
              const tr = view.state.tr.setMeta(virtualSelectionKey, { type: "clear" });
              view.dispatch(tr);
              return true;
            }
            if (event.key === "Backspace" || event.key === "Delete") {
              event.preventDefault();
              const normalized = normalizeRanges(view.state.doc.content.size, state.ranges);
              if (deleteRanges(view, normalized)) {
                const tr = view.state.tr.setMeta(virtualSelectionKey, { type: "clear" });
                view.dispatch(tr);
              }
              return true;
            }
            return false;
          }
        },
        view(view) {
          let pendingAdd = false;
          let lastAdded: VirtualSelectionRange | null = null;

          const handlePointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return;
            const mode = getSelectionMode();
            if (mode !== "add") return;
            pendingAdd = true;
          };

          const handlePointerUp = (event: PointerEvent) => {
            if (!pendingAdd) return;
            pendingAdd = false;
            const mode = getSelectionMode();
            if (mode !== "add") return;
            const sel = view.state.selection;
            if (!(sel instanceof TextSelection)) return;
            if (sel.empty) return;
            const range = clampRange(view.state.doc.content.size, { from: sel.from, to: sel.to });
            if (!range) return;
            const existing = virtualSelectionKey.getState(view.state);
            const current = existing?.ranges ?? [];
            if (lastAdded && rangesEqual(lastAdded, range)) return;
            if (isRangeDuplicate(current, range)) return;
            const next = normalizeRanges(view.state.doc.content.size, [...current, range]);
            lastAdded = range;
            view.dispatch(
              view.state.tr.setMeta(virtualSelectionKey, { type: "set", ranges: next, kind: "add" })
            );
          };

          const handleModeChange = (event: Event) => {
            const detail = (event as CustomEvent<{ mode?: string }>).detail;
            const mode = detail?.mode ?? getSelectionMode();
            if (mode !== "add" && mode !== "block") {
              const tr = view.state.tr.setMeta(virtualSelectionKey, { type: "clear" });
              view.dispatch(tr);
              lastAdded = null;
            }
          };

          const handlePointerDownClear = () => {
            const mode = getSelectionMode();
            if (mode === "add" || mode === "block") return;
            const state = virtualSelectionKey.getState(view.state);
            if (!state || state.ranges.length === 0) return;
            const tr = view.state.tr.setMeta(virtualSelectionKey, { type: "clear" });
            view.dispatch(tr);
          };

          document.addEventListener("pointerup", handlePointerUp, true);
          view.dom.addEventListener("pointerdown", handlePointerDown, true);
          view.dom.addEventListener("pointerdown", handlePointerDownClear, true);
          window.addEventListener("leditor:selection-mode", handleModeChange as EventListener);

          return {
            destroy() {
              document.removeEventListener("pointerup", handlePointerUp, true);
              view.dom.removeEventListener("pointerdown", handlePointerDown, true);
              view.dom.removeEventListener("pointerdown", handlePointerDownClear, true);
              window.removeEventListener("leditor:selection-mode", handleModeChange as EventListener);
            }
          };
        }
      })
    ];
  }
});

export default VirtualSelectionExtension;
