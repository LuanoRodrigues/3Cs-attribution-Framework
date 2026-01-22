import { Node, mergeAttributes } from "@tiptap/core";

const AnchorMarker = Node.create({
  name: "anchorMarker",
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return {
      name: { default: null },
      id: { default: null }
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[name], a[id]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const hasHref = node.hasAttribute("href");
          const hasCitation =
            node.hasAttribute("data-key") ||
            node.hasAttribute("item-key") ||
            node.hasAttribute("data-item-key");
          const text = (node.textContent ?? "").trim();
          if (hasHref || hasCitation || text.length > 0) {
            return false;
          }
          const name = node.getAttribute("name");
          const id = node.getAttribute("id");
          if (!name && !id) return false;
          return { name, id };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, string> = {};
    if (HTMLAttributes.name) attrs.name = HTMLAttributes.name;
    if (HTMLAttributes.id) attrs.id = HTMLAttributes.id;
    return ["a", mergeAttributes(attrs)];
  }
});

export default AnchorMarker;
