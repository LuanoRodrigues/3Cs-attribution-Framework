import { Node, type NodeViewRenderer } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

class BibliographyNodeView {
  private node: ProseMirrorNode;
  private readonly root: HTMLElement;
  private readonly content: HTMLElement;

  constructor(node: ProseMirrorNode) {
    this.node = node;
    this.root = document.createElement("section");
    this.root.className = "leditor-bibliography";
    this.root.dataset.bibliography = "true";
    this.content = document.createElement("div");
    this.content.className = "leditor-bibliography-content";
    this.root.appendChild(this.content);
    this.applyNode(node);
  }

  private applyNode(node: ProseMirrorNode) {
    const attrs = node.attrs ?? {};
    if (typeof attrs.bibId === "string" && attrs.bibId.trim().length > 0) {
      this.root.dataset.bibliographyId = attrs.bibId;
    } else {
      delete this.root.dataset.bibliographyId;
    }
    this.renderContent(typeof attrs.renderedHtml === "string" ? attrs.renderedHtml : "");
  }

  private renderContent(renderedHtml: string) {
    this.content.innerHTML = "";
    if (typeof renderedHtml === "string" && renderedHtml.trim().length > 0) {
      this.content.innerHTML = renderedHtml;
      return;
    }
    const empty = document.createElement("div");
    empty.className = "leditor-bibliography-empty";
    empty.textContent = "No sources cited.";
    this.content.appendChild(empty);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.applyNode(node);
    return true;
  }

  get dom() {
    return this.root;
  }
}

const bibliographyNodeView: NodeViewRenderer = (props) => {
  const view = new BibliographyNodeView(props.node);
  return {
    dom: view.dom,
    update: (node) => view.update(node)
  };
};

const BibliographyExtension = Node.create({
  name: "bibliography",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      bibId: { default: null },
      renderedHtml: { default: "" }
    };
  },
  parseHTML() {
    return [
      {
        tag: "section[data-bibliography]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return {};
          return {
            bibId: node.getAttribute("data-bibliography-id") || null,
            renderedHtml: node.getAttribute("data-bibliography-html") || node.innerHTML || ""
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "section",
      {
        "data-bibliography": "true",
        "data-bibliography-id": HTMLAttributes.bibId ?? undefined,
        "data-bibliography-html": typeof HTMLAttributes.renderedHtml === "string" ? HTMLAttributes.renderedHtml : "",
        class: "leditor-bibliography"
      },
      0
    ];
  },
  addNodeView() {
    return bibliographyNodeView;
  }
});

export default BibliographyExtension;
