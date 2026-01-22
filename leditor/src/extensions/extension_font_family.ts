import { Mark } from "@tiptap/core";

const FontFamilyMark = Mark.create({
  name: "fontFamily",
  addAttributes() {
    return {
      fontFamily: {
        default: null,
        parseHTML: (element) => {
          const value = (element as HTMLElement).style.fontFamily;
          if (!value) return null;
          return value.replace(/["']/g, "");
        },
        renderHTML: (attrs) => {
          if (!attrs.fontFamily) return {};
          return { style: `font-family: ${attrs.fontFamily}` };
        }
      }
    };
  },
  parseHTML() {
    return [{ style: "font-family" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  }
});

export default FontFamilyMark;
