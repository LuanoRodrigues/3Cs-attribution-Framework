import { Mark, mergeAttributes } from "@tiptap/core";

const DEFAULT_STROKE = "1px rgba(0, 0, 0, 0.7)";

const TextOutlineMark = Mark.create({
  name: "textOutline",
  addAttributes() {
    return {
      stroke: {
        default: DEFAULT_STROKE
      }
    };
  },
  parseHTML() {
    return [
      {
        style: "-webkit-text-stroke",
        getAttrs: (value) => {
          if (typeof value !== "string" || !value.trim()) return false;
          return { stroke: value.trim() };
        }
      },
      {
        style: "text-stroke",
        getAttrs: (value) => {
          if (typeof value !== "string" || !value.trim()) return false;
          return { stroke: value.trim() };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const existingStyle = (HTMLAttributes.style ?? "").trim();
    const stroke = HTMLAttributes.stroke ?? DEFAULT_STROKE;
    const styles: string[] = [];
    if (existingStyle) styles.push(existingStyle.replace(/;$/, ""));
    if (stroke) {
      styles.push(`-webkit-text-stroke: ${stroke}`);
      styles.push(`text-stroke: ${stroke}`);
      styles.push("paint-order: stroke fill");
    }
    const style = styles.length ? `${styles.join("; ")};` : "";
    return ["span", mergeAttributes(HTMLAttributes, style ? { style } : {}), 0];
  }
});

export default TextOutlineMark;
