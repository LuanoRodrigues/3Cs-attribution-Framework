import { Mark, mergeAttributes } from "@tiptap/core";

const DEFAULT_SHADOW = "0 1px 2px rgba(0, 0, 0, 0.35)";

const TextShadowMark = Mark.create({
  name: "textShadow",
  addAttributes() {
    return {
      shadow: {
        default: DEFAULT_SHADOW
      }
    };
  },
  parseHTML() {
    return [
      {
        style: "text-shadow",
        getAttrs: (value) => {
          if (typeof value !== "string" || !value.trim()) return false;
          return { shadow: value.trim() };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const existingStyle = (HTMLAttributes.style ?? "").trim();
    const shadow = HTMLAttributes.shadow ?? DEFAULT_SHADOW;
    const styles: string[] = [];
    if (existingStyle) styles.push(existingStyle.replace(/;$/, ""));
    if (shadow) styles.push(`text-shadow: ${shadow}`);
    const style = styles.length ? `${styles.join("; ")};` : "";
    return ["span", mergeAttributes(HTMLAttributes, style ? { style } : {}), 0];
  }
});

export default TextShadowMark;
