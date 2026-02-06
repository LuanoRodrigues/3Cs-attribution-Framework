import { Mark, mergeAttributes } from "@tiptap/core";

const UnderlineMark = Mark.create({
  name: "underline",
  addAttributes() {
    return {
      underlineStyle: {
        default: "single"
      },
      underlineColor: {
        default: null
      }
    };
  },
  parseHTML() {
    return [
      { tag: "u" },
      {
        style: "text-decoration",
        getAttrs: (value) => {
          if (typeof value !== "string") return false;
          if (!value.includes("underline")) return false;
          const attrs: Record<string, string> = {};
          if (value.includes("double")) attrs.underlineStyle = "double";
          if (value.includes("dotted")) attrs.underlineStyle = "dotted";
          if (value.includes("dashed")) attrs.underlineStyle = "dashed";
          return attrs;
        }
      },
      {
        style: "text-decoration-style",
        getAttrs: (value) => {
          if (typeof value !== "string" || !value.trim()) return false;
          return { underlineStyle: value.trim() };
        }
      },
      {
        style: "text-decoration-color",
        getAttrs: (value) => {
          if (typeof value !== "string" || !value.trim()) return false;
          return { underlineColor: value.trim() };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const existingStyle = (HTMLAttributes.style ?? "").trim();
    const underlineStyle = HTMLAttributes.underlineStyle ?? "single";
    const underlineColor = HTMLAttributes.underlineColor;
    const styles: string[] = [];
    if (existingStyle) styles.push(existingStyle.replace(/;$/, ""));
    styles.push("text-decoration: underline");
    if (underlineStyle && underlineStyle !== "single") {
      styles.push(`text-decoration-style: ${underlineStyle}`);
    }
    if (underlineColor) {
      styles.push(`text-decoration-color: ${underlineColor}`);
    }
    const style = `${styles.join("; ")};`;
    return ["span", mergeAttributes(HTMLAttributes, { style }), 0];
  }
});

export default UnderlineMark;
