import { Mark, mergeAttributes } from "@tiptap/core";

const SUBSCRIPT_STYLE = "vertical-align: sub; font-size: 0.85em;";

const SubscriptMark = Mark.create({
  name: "subscript",
  parseHTML() {
    return [
      { tag: "sub" },
      {
        style: "vertical-align",
        getAttrs: (value) => {
          if (typeof value !== "string") return false;
          return value.includes("sub") ? {} : false;
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const existingStyle = (HTMLAttributes.style ?? "").trim();
    const style = existingStyle
      ? `${existingStyle}; ${SUBSCRIPT_STYLE}`
      : SUBSCRIPT_STYLE;
    return ["span", mergeAttributes(HTMLAttributes, { style }), 0];
  }
});

export default SubscriptMark;
