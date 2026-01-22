import { Mark } from "@tiptap/core";

const FontSizeMark = Mark.create({
  name: "fontSize",
  addAttributes() {
    return {
      fontSize: {
        default: null,
        parseHTML: (element) => {
          const value = (element as HTMLElement).style.fontSize;
          if (!value) return null;
          const match = value.match(/^([0-9.]+)px$/);
          if (!match) return null;
          const parsed = Number(match[1]);
          return Number.isFinite(parsed) ? parsed : null;
        },
        renderHTML: (attrs) => {
          const value = Number(attrs.fontSize);
          if (!value) return {};
          return { style: `font-size: ${value}px` };
        }
      }
    };
  },
  parseHTML() {
    return [{ style: "font-size" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  }
});

export default FontSizeMark;
