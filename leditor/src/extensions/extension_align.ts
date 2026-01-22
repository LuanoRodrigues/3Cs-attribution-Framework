import { Extension } from "@tiptap/core";

export type TextAlign = "left" | "center" | "right" | "justify";

const AlignExtension = Extension.create({
  name: "align",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => {
              const value = (element as HTMLElement).style.textAlign;
              return value || null;
            },
            renderHTML: (attrs) => {
              if (!attrs.textAlign) return {};
              return { style: `text-align: ${attrs.textAlign}` };
            }
          }
        }
      }
    ];
  },
  addCommands() {
    return {
      setTextAlign:
        (alignment: TextAlign) =>
        ({ chain }: { chain: any }) =>
          chain.updateAttributes("paragraph", { textAlign: alignment }).updateAttributes("heading", { textAlign: alignment }).run(),
      unsetTextAlign:
        () =>
        ({ chain }: { chain: any }) =>
          chain.updateAttributes("paragraph", { textAlign: null }).updateAttributes("heading", { textAlign: null }).run()
    } as any;
  }
});

export default AlignExtension;
