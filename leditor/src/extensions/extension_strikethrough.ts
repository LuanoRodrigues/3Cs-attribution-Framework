import { Mark, mergeAttributes } from "@tiptap/core";

const STRIKE_STYLE = "text-decoration: line-through;";

const StrikethroughMark = Mark.create({
  name: "strikethrough",
  parseHTML() {
    return [
      { tag: "s" },
      { tag: "del" },
      {
        style: "text-decoration",
        getAttrs: (value) => {
          if (typeof value !== "string") return false;
          return value.includes("line-through") ? {} : false;
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const existingStyle = (HTMLAttributes.style ?? "").trim();
    const style = existingStyle
      ? `${existingStyle}; ${STRIKE_STYLE}`
      : STRIKE_STYLE;
    return ["span", mergeAttributes(HTMLAttributes, { style }), 0];
  }
});

export default StrikethroughMark;
