import { Node as TiptapNode, type NodeViewRenderer } from "@tiptap/core";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { reconcileFootnotes } from "../uipagination/footnotes/registry.ts";
import { getNextFootnoteId, registerFootnoteId } from "../uipagination/footnotes/footnote_id_generator.ts";
import type { FootnoteKind } from "../uipagination/footnotes/model.ts";

export type FootnoteNodeViewAPI = {
  id: string;
  open(): void;
  close(): void;
  setPlainText(value: string): void;
  getPlainText(): string;
  getNumber(): string;
  setNumber(value: number): void;
};

const footnoteRegistry = new Map<string, FootnoteNodeViewAPI>();

export const getFootnoteRegistry = () => footnoteRegistry;
export const clearFootnoteRegistry = () => footnoteRegistry.clear();

type FootnoteNodeViewProps = {
  node: ProseMirrorNode;
  view: EditorView;
  getPos: () => number | null | undefined;
};

class FootnoteNodeView implements FootnoteNodeViewAPI {
  readonly id: string;
  readonly footnoteId: string;
  private node: ProseMirrorNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | null | undefined;
  private readonly root: HTMLElement;
  private readonly marker: HTMLElement;

  constructor({ node, view, getPos }: FootnoteNodeViewProps) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    const rawKind = typeof node.attrs?.kind === "string" ? String(node.attrs.kind) : "footnote";
    const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
    let footnoteId = typeof node.attrs?.footnoteId === "string" ? String(node.attrs.footnoteId).trim() : "";
    if (!footnoteId) {
      // Deterministically allocate an ID and patch the document so the ID is stable across reloads.
      footnoteId = getNextFootnoteId(kind);
      const pos = this.getPos();
      if (typeof pos === "number") {
        const attrs = { ...(node.attrs as any), footnoteId, kind };
        window.requestAnimationFrame(() => {
          try {
            // Only patch if the node is still at this position and still missing an id.
            const live = this.view.state.doc.nodeAt(pos);
            const liveId = typeof live?.attrs?.footnoteId === "string" ? String(live?.attrs?.footnoteId).trim() : "";
            if (live && live.type === node.type && !liveId) {
              this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, live.type, attrs, live.marks));
            }
          } catch {
            // ignore
          }
        });
      }
    } else {
      registerFootnoteId(footnoteId, kind);
    }
    this.footnoteId = footnoteId;
    this.id = this.footnoteId;

    this.root = document.createElement("span");
    this.root.className = "leditor-footnote";
    this.root.dataset.footnoteId = this.footnoteId;
    this.root.dataset.footnoteKind = kind;
    const citationId = typeof node.attrs?.citationId === "string" ? node.attrs.citationId.trim() : "";
    if (citationId) {
      this.root.dataset.citationId = citationId;
      this.root.dataset.footnoteSource = "citation";
    } else {
      delete this.root.dataset.citationId;
      this.root.dataset.footnoteSource = "manual";
    }

    this.marker = document.createElement("sup");
    this.marker.className = "leditor-footnote-marker";
    this.marker.setAttribute("aria-label", "Footnote");
    this.marker.addEventListener("click", (event) => {
      event.preventDefault();
      // A4 layout owns the footnote UI. Trigger a focus request instead of opening a legacy popover.
      try {
        window.dispatchEvent(new CustomEvent("leditor:footnote-focus", { detail: { footnoteId: this.footnoteId } }));
      } catch {
        // ignore
      }
    });
    this.root.appendChild(this.marker);

    footnoteRegistry.set(this.footnoteId, this);
    this.syncNumberFromDoc();
  }

  private syncNumberFromDoc() {
    const numbering = reconcileFootnotes(this.view.state.doc).numbering;
    const number = numbering.get(this.footnoteId);
    if (number) {
      this.setNumber(number);
    } else {
      this.setNumber(Number.NaN);
    }
  }

  open() {
    // Legacy popover removed. Use the main (A4) footnote surface.
    try {
      window.dispatchEvent(new CustomEvent("leditor:footnote-focus", { detail: { footnoteId: this.footnoteId } }));
    } catch {
      // ignore
    }
  }

  close() {
    // no-op (no legacy popover)
  }

  setPlainText(value: string) {
    const trimmed = typeof value === "string" ? value : "";
    const textNode = trimmed.length ? this.view.state.schema.text(trimmed) : null;
    const newNode = this.node.type.create(this.node.attrs, textNode ? [textNode] : [], this.node.marks);
    const pos = this.getPos();
    if (typeof pos === "number") {
      const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, newNode);
      this.view.dispatch(tr);
    }
  }

  getPlainText(): string {
    return this.node.textContent ?? "";
  }

  getNumber(): string {
    return this.marker.textContent ?? "";
  }

  setNumber(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      this.marker.textContent = "";
      delete this.root.dataset.footnoteNumber;
      return;
    }
    const normalized = String(Math.floor(value));
    this.marker.textContent = normalized;
    this.root.dataset.footnoteNumber = normalized;
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    // Keep dataset flags in sync (citation/manual).
    const citationId = typeof node.attrs?.citationId === "string" ? node.attrs.citationId.trim() : "";
    if (citationId) {
      this.root.dataset.citationId = citationId;
      this.root.dataset.footnoteSource = "citation";
    } else {
      delete this.root.dataset.citationId;
      this.root.dataset.footnoteSource = "manual";
    }
    // Track newly seen ids so deterministic insertion never collides.
    const rawKind = typeof node.attrs?.kind === "string" ? String(node.attrs.kind) : "footnote";
    const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
    const id = typeof node.attrs?.footnoteId === "string" ? String(node.attrs.footnoteId).trim() : "";
    if (id) registerFootnoteId(id, kind);
    this.syncNumberFromDoc();
    return true;
  }

  selectNode() {
    this.root.classList.add("is-selected");
  }

  deselectNode() {
    this.root.classList.remove("is-selected");
  }

  stopEvent(event: Event) {
    return this.root.contains(event.target as globalThis.Node);
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    footnoteRegistry.delete(this.footnoteId);
  }

  get dom() {
    return this.root;
  }
}

const footnoteNodeView: NodeViewRenderer = (props) => {
  const view = new FootnoteNodeView({ ...props });
  return {
    dom: view.dom,
    update: (node) => view.update(node),
    selectNode: () => view.selectNode(),
    deselectNode: () => view.deselectNode(),
    stopEvent: (event) => view.stopEvent(event),
    ignoreMutation: () => view.ignoreMutation(),
    destroy: () => view.destroy()
  };
};

const FootnoteExtension = TiptapNode.create({
  name: "footnote",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  content: "inline*",
  addKeyboardShortcuts() {
    // Word-like deletion: pressing Backspace/Delete adjacent to a footnote marker removes the
    // marker in a single keystroke (instead of selecting it first and requiring a second press).
    const deleteNeighbor = (dir: "back" | "forward") => () => {
      const editor: any = (this as any).editor;
      const state = editor?.state;
      const view = editor?.view;
      if (!state || !view) return false;
      const { selection } = state;
      if (!(selection instanceof TextSelection) || !selection.empty) return false;
      const footnoteType = state.schema.nodes.footnote;
      if (!footnoteType) return false;
      const $from = selection.$from;
      const node = dir === "back" ? $from.nodeBefore : $from.nodeAfter;
      if (!node || node.type !== footnoteType) return false;
      const from = dir === "back" ? selection.from - node.nodeSize : selection.from;
      const to = from + node.nodeSize;
      try {
        view.dispatch(state.tr.delete(from, to).scrollIntoView());
        return true;
      } catch {
        return false;
      }
    };
    return {
      Backspace: deleteNeighbor("back"),
      Delete: deleteNeighbor("forward")
    };
  },
  addAttributes() {
    return {
      footnoteId: {
        default: null
      },
      kind: {
        default: "footnote"
      },
      citationId: {
        default: null
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-footnote]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return {};
          return {
            footnoteId: node.getAttribute("data-footnote-id") || null,
            kind: node.getAttribute("data-footnote-kind") ?? "footnote",
            citationId: node.getAttribute("data-citation-id") || null
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes.kind ?? "footnote";
    const attrs: Record<string, any> = {
      "data-footnote": "true",
      "data-footnote-kind": kind,
      ...HTMLAttributes
    };
    if (HTMLAttributes.citationId) {
      attrs["data-citation-id"] = HTMLAttributes.citationId;
    }
    if (HTMLAttributes.footnoteId) {
      attrs["data-footnote-id"] = HTMLAttributes.footnoteId;
    }
    return ["span", attrs, 0];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: (view) => {
          let lastDoc = view.state.doc;
          // Ensure any imported/legacy footnote nodes missing ids get a deterministic id.
          const ensureIds = () => {
            const footnoteType = view.state.schema.nodes.footnote;
            if (!footnoteType) return;
            const missing: Array<{ pos: number; kind: FootnoteKind }> = [];
            view.state.doc.descendants((node, pos) => {
              if (node.type !== footnoteType) return true;
              const id = typeof node.attrs?.footnoteId === "string" ? String(node.attrs.footnoteId).trim() : "";
              const rawKind = typeof node.attrs?.kind === "string" ? String(node.attrs.kind) : "footnote";
              const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
              if (!id) missing.push({ pos, kind });
              else registerFootnoteId(id, kind);
              return true;
            });
            if (missing.length === 0) return;
            let tr = view.state.tr;
            missing.forEach((entry) => {
              const node = tr.doc.nodeAt(entry.pos);
              if (!node || node.type !== footnoteType) return;
              const nextId = getNextFootnoteId(entry.kind);
              tr = tr.setNodeMarkup(entry.pos, node.type, { ...(node.attrs as any), footnoteId: nextId, kind: entry.kind }, node.marks);
            });
            if (tr.docChanged) {
              try {
                view.dispatch(tr);
              } catch {
                // ignore
              }
            }
          };
          const sync = () => {
            const numbering = reconcileFootnotes(view.state.doc).numbering;
            for (const [id, api] of footnoteRegistry.entries()) {
              api.setNumber(numbering.get(id) ?? Number.NaN);
            }
          };
          // Run once after mount.
          window.requestAnimationFrame(() => {
            ensureIds();
            sync();
          });
          return {
            update: (_view, prevState) => {
              if (prevState.doc === _view.state.doc || _view.state.doc === lastDoc) return;
              lastDoc = _view.state.doc;
              ensureIds();
              sync();
            }
          };
        }
      })
    ];
  },
  addNodeView() {
    return footnoteNodeView;
  }
});

export default FootnoteExtension;
