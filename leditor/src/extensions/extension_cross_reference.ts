import { Node } from "@tiptap/core";

const CROSS_REFERENCE_CLASS = "leditor-cross-reference";

const CrossReferenceExtension = Node.create({
  name: "cross_reference",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      targetId: {
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
        tag: "span[data-cross-reference]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return {};
          const targetId = node.getAttribute("data-cross-reference-target") ?? "";
          const label = node.getAttribute("data-cross-reference-label") ?? node.textContent ?? "";
          return { targetId, label };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const targetId = typeof HTMLAttributes.targetId === "string" ? HTMLAttributes.targetId : "";
    const rawLabel = typeof HTMLAttributes.label === "string" && HTMLAttributes.label.trim().length > 0 ? HTMLAttributes.label.trim() : targetId;
    const label = rawLabel || "xref";
    return [
      "span",
      {
        "data-cross-reference": "true",
        "data-cross-reference-target": targetId,
        "data-cross-reference-label": label,
        class: CROSS_REFERENCE_CLASS
      },
      label
    ];
  }
});

export default CrossReferenceExtension;
