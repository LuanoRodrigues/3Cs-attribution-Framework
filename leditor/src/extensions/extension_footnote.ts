import { Node as TiptapNode, type NodeViewRenderer } from "@tiptap/core";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { reconcileFootnotes } from "../uipagination/footnotes/registry.ts";
import { getNextFootnoteId, registerFootnoteId } from "../uipagination/footnotes/footnote_id_generator.ts";
import type { FootnoteKind } from "../uipagination/footnotes/model.ts";
import { buildFootnoteBodyContent, getFootnoteBodyPlainText } from "./extension_footnote_body.ts";

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

const findFootnoteBodyNode = (
  doc: ProseMirrorNode,
  footnoteBodyType: any,
  footnoteId: string
): { node: ProseMirrorNode; pos: number } | null => {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (node.type !== footnoteBodyType) return true;
    const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
    if (id === footnoteId) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
};

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
    const state = this.view.state;
    const footnoteBodyType = state.schema.nodes.footnoteBody;
    const pos = this.getPos();
    let tr = state.tr;
    let updated = false;
    if (footnoteBodyType) {
      const found = findFootnoteBodyNode(state.doc, footnoteBodyType, this.footnoteId);
      if (found) {
        const nextNode = footnoteBodyType.create(
          { ...(found.node.attrs as any), footnoteId: this.footnoteId, kind: this.node.attrs?.kind ?? "footnote" },
          buildFootnoteBodyContent(state.schema, trimmed)
        );
        tr = tr.replaceWith(found.pos, found.pos + found.node.nodeSize, nextNode);
        updated = true;
      }
    }
    if (!updated) {
      const nextAttrs = { ...(this.node.attrs as any), text: trimmed };
      const newNode = this.node.type.create(nextAttrs, [], this.node.marks);
      if (typeof pos === "number") {
        tr = tr.replaceWith(pos, pos + this.node.nodeSize, newNode);
      }
    } else if (typeof pos === "number") {
      const nextAttrs = { ...(this.node.attrs as any), text: trimmed };
      tr = tr.setNodeMarkup(pos, this.node.type, nextAttrs, this.node.marks);
    }
    if (tr.docChanged) {
      const prevSelection = state.selection;
      try {
        const mapped = prevSelection.map(tr.doc, tr.mapping);
        tr = tr.setSelection(mapped);
      } catch {
        // ignore
      }
      this.view.dispatch(tr);
    }
  }

  getPlainText(): string {
    const state = this.view.state;
    const footnoteBodyType = state.schema.nodes.footnoteBody;
    if (footnoteBodyType) {
      const found = findFootnoteBodyNode(state.doc, footnoteBodyType, this.footnoteId);
      if (found) {
        return getFootnoteBodyPlainText(found.node);
      }
    }
    const attrText = typeof (this.node.attrs as any)?.text === "string" ? String((this.node.attrs as any).text) : "";
    return attrText;
  }

  getNumber(): string {
    return this.marker.textContent ?? "";
  }

  setNumber(value: string | number) {
    const normalized =
      typeof value === "string"
        ? value.trim()
        : Number.isFinite(value) && value > 0
          ? String(Math.floor(value))
          : "";
    if (!normalized) {
      this.marker.textContent = "";
      delete this.root.dataset.footnoteNumber;
      return;
    }
    this.marker.textContent = normalized;
    this.root.dataset.footnoteNumber = normalized;
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    const nextId =
      typeof node.attrs?.footnoteId === "string" ? String(node.attrs.footnoteId).trim() : "";
    if (nextId && nextId !== this.footnoteId) {
      // Force a fresh NodeView so registry keys and datasets stay consistent.
      return false;
    }
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
    const id = nextId;
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
    const deleteSelected = () => {
      const editor: any = (this as any).editor;
      const state = editor?.state;
      const view = editor?.view;
      if (!state || !view) return false;
      const { selection } = state;
      const footnoteType = state.schema.nodes.footnote;
      if (!footnoteType) return false;
      if (!(selection instanceof NodeSelection)) return false;
      if (!selection.node || selection.node.type !== footnoteType) return false;
      try {
        view.dispatch(state.tr.deleteSelection().scrollIntoView());
        return true;
      } catch {
        return false;
      }
    };
    const deleteNeighbor = (dir: "back" | "forward") => () => {
      const editor: any = (this as any).editor;
      const state = editor?.state;
      const view = editor?.view;
      if (!state || !view) return false;
      const { selection } = state;
      if (selection instanceof NodeSelection) {
        return deleteSelected();
      }
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
      Backspace: () => deleteSelected() || deleteNeighbor("back")(),
      Delete: () => deleteSelected() || deleteNeighbor("forward")()
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
      },
      // Legacy fallback for footnote text. The canonical text now lives in `footnoteBody` nodes.
      text: {
        default: ""
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-footnote]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return {};
          const rawTextAttr = (node.getAttribute("data-footnote-text") || "").trim();
          const rawText =
            rawTextAttr.length > 0 ? rawTextAttr : (node.textContent || "").trim();
          return {
            footnoteId: node.getAttribute("data-footnote-id") || null,
            kind: node.getAttribute("data-footnote-kind") ?? "footnote",
            citationId: node.getAttribute("data-citation-id") || null,
            text: rawText
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
    if (typeof HTMLAttributes.text === "string" && HTMLAttributes.text.trim().length > 0) {
      attrs["data-footnote-text"] = HTMLAttributes.text;
    }
    // Do not serialize the footnote text into the body HTML; the overlay renders it from attrs.
    return ["span", attrs];
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
            const needsId: Array<{ pos: number; kind: FootnoteKind }> = [];
            const seen = new Set<string>();
            view.state.doc.descendants((node, pos) => {
              if (node.type !== footnoteType) return true;
              const id = typeof node.attrs?.footnoteId === "string" ? String(node.attrs.footnoteId).trim() : "";
              const rawKind = typeof node.attrs?.kind === "string" ? String(node.attrs.kind) : "footnote";
              const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
              if (!id) {
                needsId.push({ pos, kind });
              } else if (seen.has(id)) {
                // Duplicate id detected; schedule a replacement.
                needsId.push({ pos, kind });
              } else {
                seen.add(id);
                registerFootnoteId(id, kind);
              }
              return true;
            });
            let tr = view.state.tr;
            needsId.forEach((entry) => {
              const node = tr.doc.nodeAt(entry.pos);
              if (!node || node.type !== footnoteType) return;
              let nextId = getNextFootnoteId(entry.kind);
              while (seen.has(nextId)) {
                nextId = getNextFootnoteId(entry.kind);
              }
              seen.add(nextId);
              tr = tr.setNodeMarkup(
                entry.pos,
                node.type,
                { ...(node.attrs as any), footnoteId: nextId, kind: entry.kind, text: (node.attrs as any)?.text ?? "" },
                node.marks
              );
            });
            // Apply text migrations by replacing nodes so we can clear any legacy content.
            // Re-read the updated doc so migrated nodes use the current, de-duplicated ids.
            const nextMigrations: Array<{ pos: number; kind: FootnoteKind; id: string; attrs: any; marks: Mark[] }> = [];
            tr.doc.descendants((node, pos) => {
              if (node.type !== footnoteType) return true;
              const id = typeof node.attrs?.footnoteId === "string" ? String(node.attrs.footnoteId).trim() : "";
              if (!id) return true;
              const rawKind = typeof node.attrs?.kind === "string" ? String(node.attrs.kind) : "footnote";
              const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
              const attrText = typeof (node.attrs as any)?.text === "string" ? String((node.attrs as any).text) : "";
              const legacyText = (node.textContent || "").trim();
              if (legacyText && !attrText.trim()) {
                nextMigrations.push({
                  pos,
                  kind,
                  id,
                  attrs: { ...(node.attrs as any), footnoteId: id, kind, text: legacyText },
                  marks: (node.marks as any) ?? []
                });
              } else if (attrText.trim() && node.content && node.content.size > 0) {
                nextMigrations.push({
                  pos,
                  kind,
                  id,
                  attrs: { ...(node.attrs as any), footnoteId: id, kind, text: attrText },
                  marks: (node.marks as any) ?? []
                });
              }
              return true;
            });
            nextMigrations
              .sort((a, b) => b.pos - a.pos)
              .forEach((entry) => {
                const node = tr.doc.nodeAt(entry.pos);
                if (!node || node.type !== footnoteType) return;
                const next = footnoteType.create(entry.attrs, [], entry.marks);
                tr = tr.replaceWith(entry.pos, entry.pos + node.nodeSize, next);
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
              const raw = numbering.get(id);
              const n = typeof raw === "number" ? raw : Number(raw);
              api.setNumber(Number.isFinite(n) ? n : Number.NaN);
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
