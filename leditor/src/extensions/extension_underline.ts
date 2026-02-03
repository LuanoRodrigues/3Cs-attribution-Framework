import { Mark, mergeAttributes } from "@tiptap/core";

const UnderlineMark = Mark.create({
  name: "underline",
  addAttributes() {
    return {
      underlineStyle: {
        default: "single"
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
          return value.includes("double") ? { underlineStyle: "double" } : {};
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const existingStyle = (HTMLAttributes.style ?? "").trim();
    const underlineStyle = HTMLAttributes.underlineStyle ?? "single";
    const styles: string[] = [];
    if (existingStyle) styles.push(existingStyle.replace(/;$/, ""));
    styles.push("text-decoration: underline");
    if (underlineStyle === "double") {
      styles.push("text-decoration-style: double");
    }
    const style = `${styles.join("; ")};`;
    return ["span", mergeAttributes(HTMLAttributes, { style }), 0];
  }
});

export default UnderlineMark;
