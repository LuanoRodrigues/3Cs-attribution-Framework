import { Node, type NodeViewRenderer } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type TocEntry = {
  text: string;
  level: number;
  pos: number;
};

const normalizeEntries = (value: unknown): TocEntry[] => {
  if (!Array.isArray(value)) return [];
  const entries: TocEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const text = typeof (item as TocEntry).text === "string" ? (item as TocEntry).text : "";
    const level = Number((item as TocEntry).level);
    const pos = Number((item as TocEntry).pos);
    entries.push({
      text: text.trim() || "Untitled",
      level: Number.isFinite(level) ? Math.max(1, Math.min(6, Math.floor(level))) : 1,
      pos: Number.isFinite(pos) ? Math.max(0, Math.floor(pos)) : 0
    });
  }
  return entries;
};

class TocNodeView {
  private node: ProseMirrorNode;
  private readonly view: any;
  private readonly root: HTMLElement;
  private readonly list: HTMLDivElement;

  constructor(node: ProseMirrorNode, view: any) {
    this.node = node;
    this.view = view;
    this.root = document.createElement("nav");
    this.root.className = "leditor-toc";
    this.root.dataset.toc = "true";
    const title = document.createElement("div");
    title.className = "leditor-toc-title";
    title.textContent = "Table of Contents";
    this.list = document.createElement("div");
    this.list.className = "leditor-toc-list";
    this.root.appendChild(title);
    this.root.appendChild(this.list);
    this.renderEntries(normalizeEntries(node.attrs?.entries), (node.attrs?.style as string) ?? "auto1");
  }

  private renderEntries(entries: TocEntry[], styleId: string) {
    this.root.dataset.tocStyle = styleId ?? "auto1";
    this.list.innerHTML = "";
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "leditor-toc-empty";
      empty.textContent = "No headings found.";
      this.list.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "leditor-toc-entry";
      button.dataset.level = String(entry.level);
      button.textContent = entry.text;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const pos = entry.pos;
        if (!Number.isFinite(pos)) return;
        const maxPos = this.view.state.doc.content.size;
        if (pos <= 0 || pos > maxPos) return;
        const selection = TextSelection.create(this.view.state.doc, pos);
        this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView());
        this.view.focus();
      });
      this.list.appendChild(button);
    }
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.renderEntries(normalizeEntries(node.attrs?.entries), (node.attrs?.style as string) ?? "auto1");
    return true;
  }

  get dom() {
    return this.root;
  }
}

const tocNodeView: NodeViewRenderer = (props) => {
  const view = new TocNodeView(props.node, props.view);
  return {
    dom: view.dom,
    update: (node) => view.update(node)
  };
};

const TocExtension = Node.create({
  name: "toc",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      entries: {
        default: []
      },
      style: {
        default: "auto1",
        parseHTML: (element) => {
          const value = (element as HTMLElement).getAttribute("data-toc-style");
          return value ? value : "auto1";
        }
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "nav[data-toc]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return {};
          const raw = node.getAttribute("data-toc-entries");
          if (!raw) return {};
          try {
            const parsed = JSON.parse(raw);
            const style = node.getAttribute("data-toc-style");
            return { entries: normalizeEntries(parsed), style: style ?? "auto1" };
          } catch {
            return {};
          }
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const entries = normalizeEntries(HTMLAttributes.entries);
    const styleId = typeof HTMLAttributes.style === "string" && HTMLAttributes.style.length > 0 ? HTMLAttributes.style : "auto1";
    return [
      "nav",
      {
        "data-toc": "true",
        "data-toc-style": styleId,
        "data-toc-entries": JSON.stringify(entries),
        class: "leditor-toc"
      },
      0
    ];
  },
  addNodeView() {
    return tocNodeView;
  }
});

export default TocExtension;
