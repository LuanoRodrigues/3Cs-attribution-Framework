import { Editor, Node as TiptapNode, type NodeViewRenderer } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

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

type FootnoteNodeViewProps = {
  node: ProseMirrorNode;
  view: EditorView;
  getPos: () => number | null | undefined;
};

class FootnoteNodeView implements FootnoteNodeViewAPI {
  readonly id: string;
  private node: ProseMirrorNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | null | undefined;
  private readonly root: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly popover: HTMLDivElement;
  private readonly toolbar: HTMLDivElement;
  private readonly editorHost: HTMLDivElement;
  private innerEditor: Editor | null = null;
  private isOpen = false;
  private syncingFromNode = false;
  private lastInnerContent = "";
  private readonly documentClickHandler: (event: MouseEvent) => void;

  constructor({ node, view, getPos }: FootnoteNodeViewProps) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.id = String(node.attrs.id ?? `footnote-${Math.random().toString(36).slice(2)}`);

    this.root = document.createElement("span");
    this.root.className = "leditor-footnote";
    this.root.dataset.footnoteId = this.id;
    this.root.dataset.footnoteKind = String(node.attrs.kind ?? "footnote");

    this.marker = document.createElement("sup");
    this.marker.className = "leditor-footnote-marker";
    this.marker.setAttribute("aria-label", "Footnote");
    this.marker.addEventListener("click", (event) => {
      event.preventDefault();
      this.toggle();
    });
    this.root.appendChild(this.marker);

    this.popover = document.createElement("div");
    this.popover.className = "leditor-footnote-popover";
    this.popover.style.display = "none";
    this.popover.setAttribute("aria-hidden", "true");
    this.root.appendChild(this.popover);

    this.toolbar = document.createElement("div");
    this.toolbar.className = "leditor-footnote-toolbar";
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", "Footnote toolbar");
    const actions: Array<{ label: string; ariaLabel: string; tooltip: string; action: () => void }> = [
      { label: "B", ariaLabel: "Bold", tooltip: "Bold (Ctrl+B)", action: () => this.toggleMark("bold") },
      { label: "I", ariaLabel: "Italic", tooltip: "Italic (Ctrl+I)", action: () => this.toggleMark("italic") },
      {
        label: "Link",
        ariaLabel: "Link",
        tooltip: "Link (Ctrl+K)",
        action: () => {
          const currentHref = this.innerEditor?.getAttributes("link").href ?? "";
          const raw = window.prompt("Enter footnote link URL", currentHref);
          if (raw === null) return;
          const href = raw.trim();
          this.innerEditor?.commands.focus();
          if (href.length === 0) {
            this.innerEditor?.commands.unsetLink();
            return;
          }
          this.innerEditor?.commands.setLink({ href });
        }
      }
    ];
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.className = "tb-btn tb-btn--quiet";
      button.setAttribute("aria-label", action.ariaLabel);
      button.setAttribute("data-tooltip", action.tooltip);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        action.action();
      });
      this.toolbar.appendChild(button);
    }
    this.popover.appendChild(this.toolbar);

    this.editorHost = document.createElement("div");
    this.editorHost.className = "leditor-footnote-editor";
    this.popover.appendChild(this.editorHost);

    this.setupInnerEditor();

    this.documentClickHandler = (event: MouseEvent) => {
      if (!this.root.contains(event.target as globalThis.Node)) {
        this.close();
      }
    };
    document.addEventListener("click", this.documentClickHandler);

    footnoteRegistry.set(this.id, this);
  }

  private setupInnerEditor() {
    this.innerEditor = new Editor({
      element: this.editorHost,
      extensions: [StarterKit.configure({ link: false }), Link],
      content: this.createDocFromNode(this.node),
      editable: true,
      editorProps: {
        attributes: {
          class: "footnote-inner-editor"
        }
      }
    });
    this.innerEditor.on("update", () => {
      if (this.syncingFromNode) {
        this.syncingFromNode = false;
        return;
      }
      this.syncFromInnerEditor();
    });
    this.lastInnerContent = this.serializeInnerContent();
  }

  private serializeInnerContent(): string {
    if (!this.innerEditor) return "";
    return JSON.stringify(this.innerEditor.getJSON().content ?? []);
  }

  private createDocFromNode(node: ProseMirrorNode) {
    const content = node.content.toJSON();
    const normalized = Array.isArray(content) ? content : [];
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: normalized.length ? normalized : []
        }
      ]
    };
  }

  private syncFromInnerEditor() {
    if (!this.innerEditor) return;
    const content = this.innerEditor.getJSON().content ?? [];
    const serialized = JSON.stringify(content);
    if (serialized === this.lastInnerContent) return;
    this.lastInnerContent = serialized;
    this.applyInnerContent(content);
  }

  private applyInnerContent(content: any[]) {
    const inlineNodes = this.extractInlineNodes(content);
    const newNode = this.node.type.create(this.node.attrs, inlineNodes, this.node.marks);
    const pos = this.getPos();
    if (typeof pos !== "number") return;
    const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, newNode);
    this.view.dispatch(tr);
  }

  private extractInlineNodes(content: any[]): ProseMirrorNode[] {
    const schema = this.view.state.schema;
    const nodes: ProseMirrorNode[] = [];
    const hardBreakType = schema.nodes.hardBreak;
    const paragraphType = schema.nodes.paragraph;
    const resolveMarks = (marks: any[] | undefined): Mark[] =>
      (marks ?? [])
        .map((mark) => {
          const type = schema.marks[mark.type];
          return type ? type.create(mark.attrs ?? {}) : null;
        })
        .filter((mark): mark is Mark => Boolean(mark));
    const pushInline = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "text") {
        if (typeof node.text !== "string" || node.text.length === 0) return;
        nodes.push(schema.text(node.text, resolveMarks(node.marks)));
        return;
      }
      if (node.type === "hardBreak" && hardBreakType) {
        nodes.push(hardBreakType.create());
        return;
      }
      const inlineType = schema.nodes[node.type];
      if (inlineType && inlineType.isInline) {
        nodes.push(inlineType.create(node.attrs ?? {}, node.content ?? [], resolveMarks(node.marks)));
      }
    };
    const pushParagraphContent = (block: any) => {
      const inline = Array.isArray(block?.content) ? block.content : [];
      inline.forEach(pushInline);
    };
    content.forEach((block: any, index: number) => {
      if (block?.type === "paragraph") {
        pushParagraphContent(block);
      } else {
        const blockType = paragraphType && block?.type && schema.nodes[block.type];
        if (blockType && blockType.isBlock && Array.isArray(block.content)) {
          block.content.forEach(pushInline);
        } else {
          pushInline(block);
        }
      }
      if (index < content.length - 1 && hardBreakType) {
        nodes.push(hardBreakType.create());
      }
    });
    return nodes;
  }

  private toggleMark(mark: string) {
    this.innerEditor?.chain().focus().toggleMark(mark as any).run();
  }

  private toggle() {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.popover.style.display = "block";
    this.popover.setAttribute("aria-hidden", "false");
    this.innerEditor?.commands.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.popover.style.display = "none";
    this.popover.setAttribute("aria-hidden", "true");
    this.view.focus();
  }

  setPlainText(value: string) {
    if (!this.innerEditor) return;
    const doc = { type: "doc", content: [{ type: "text", text: value }] };
    this.syncingFromNode = true;
    this.innerEditor.commands.setContent(doc);
    this.lastInnerContent = JSON.stringify(doc.content);
  }

  getPlainText(): string {
    return this.innerEditor?.state.doc.textContent ?? "";
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
    const target = this.createDocFromNode(node);
    const serialized = JSON.stringify(target.content);
    if (serialized === this.lastInnerContent) return true;
    this.syncingFromNode = true;
    this.lastInnerContent = serialized;
    this.innerEditor?.commands.setContent(target);
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
    footnoteRegistry.delete(this.id);
    document.removeEventListener("click", this.documentClickHandler);
    this.innerEditor?.destroy();
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
  addAttributes() {
    return {
      id: {
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
    return ["span", attrs, 0];
  },
  addNodeView() {
    return footnoteNodeView;
  }
});

export default FootnoteExtension;
