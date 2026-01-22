import { Mark, mergeAttributes } from "@tiptap/core";

const SUPERSCRIPT_STYLE = "vertical-align: super; font-size: 0.85em;";

const SuperscriptMark = Mark.create({
  name: "superscript",
  parseHTML() {
    return [
      { tag: "sup" },
      {
        style: "vertical-align",
        getAttrs: (value) => {
          if (typeof value !== "string") return false;
          return value.includes("super") ? {} : false;
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const existingStyle = (HTMLAttributes.style ?? "").trim();
    const style = existingStyle
      ? `${existingStyle}; ${SUPERSCRIPT_STYLE}`
      : SUPERSCRIPT_STYLE;
    return ["span", mergeAttributes(HTMLAttributes, { style }), 0];
  }
});

export default SuperscriptMark;
