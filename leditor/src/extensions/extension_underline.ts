import { Mark, mergeAttributes } from "@tiptap/core";

const UnderlineMark = Mark.create({
  name: "underline",
  parseHTML() {
    return [
      { tag: "u" },
      {
        style: "text-decoration",
        getAttrs: (value) => {
          if (typeof value !== "string") return false;
          return value.includes("underline") ? {} : false;
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const existingStyle = (HTMLAttributes.style ?? "").trim();
    const style = existingStyle
      ? `${existingStyle}; text-decoration: underline;`
      : "text-decoration: underline;";
    return ["span", mergeAttributes(HTMLAttributes, { style }), 0];
  }
});

export default UnderlineMark;
