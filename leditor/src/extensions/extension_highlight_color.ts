import { Mark } from "@tiptap/core";

const HighlightColorMark = Mark.create({
  name: "highlightColor",
  addAttributes() {
    return {
      highlight: {
        default: null,
        parseHTML: (element) => {
          const value = (element as HTMLElement).style.backgroundColor;
          return value || null;
        },
        renderHTML: (attrs) => {
          if (!attrs.highlight) return {};
          return { style: `background-color: ${attrs.highlight}` };
        }
      }
    };
  },
  parseHTML() {
    return [{ style: "background-color" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  }
});

export default HighlightColorMark;
