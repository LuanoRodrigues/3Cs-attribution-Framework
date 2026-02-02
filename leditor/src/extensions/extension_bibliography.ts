import { Node } from "@tiptap/core";

const BibliographyExtension = Node.create({
  name: "bibliography",
  group: "block",
  // The bibliography must be splittable across pages, so we keep it as normal block content.
  content: "block+",
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      bibId: { default: null },
      // Kept for backward compatibility / export, but the visible content is the node's children.
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
});

export default BibliographyExtension;
