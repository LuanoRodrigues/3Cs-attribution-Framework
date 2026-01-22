import { Mark } from "@tiptap/core";

const TextColorMark = Mark.create({
  name: "textColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => {
          const value = (element as HTMLElement).style.color;
          return value || null;
        },
        renderHTML: (attrs) => {
          if (!attrs.color) return {};
          return { style: `color: ${attrs.color}` };
        }
      }
    };
  },
  parseHTML() {
    return [{ style: "color" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  }
});

export default TextColorMark;
