import { Node } from "@tiptap/core";

const BOOKMARK_CLASS = "leditor-bookmark";

const BookmarkExtension = Node.create({
  name: "bookmark",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      id: {
        default: ""
      },
      label: {
        default: ""
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-bookmark]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return {};
          const id = node.getAttribute("data-bookmark-id") ?? "";
          const label = node.getAttribute("data-bookmark-label") ?? node.textContent ?? "";
          return { id, label };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const id = typeof HTMLAttributes.id === "string" ? HTMLAttributes.id : "";
    const rawLabel = typeof HTMLAttributes.label === "string" && HTMLAttributes.label.trim().length > 0 ? HTMLAttributes.label.trim() : id;
    const label = rawLabel || "bookmark";
    return [
      "span",
      {
        "data-bookmark": "true",
        "data-bookmark-id": id,
        "data-bookmark-label": label,
        class: BOOKMARK_CLASS
      },
      label
    ];
  }
});

export default BookmarkExtension;
