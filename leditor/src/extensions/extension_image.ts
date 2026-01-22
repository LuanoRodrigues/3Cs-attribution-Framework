import { Node, mergeAttributes } from "@tiptap/core";

export type ImageAttributes = {
  src: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
};

const ImageExtension = Node.create<ImageAttributes>({
  name: "image",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  inline: false,

  addAttributes() {
    const parseNumeric = (element: Element, name: string): number | null => {
      const value = element.getAttribute(name);
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    return {
      src: {
        default: null,
        parseHTML: (element) => (element as HTMLImageElement).getAttribute("src") ?? null
      },
      alt: {
        default: null,
        parseHTML: (element) => (element as HTMLImageElement).getAttribute("alt") ?? null
      },
      width: {
        default: null,
        parseHTML: (element) => parseNumeric(element, "width")
      },
      height: {
        default: null,
        parseHTML: (element) => parseNumeric(element, "height")
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[src]"
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  }
});

export default ImageExtension;
