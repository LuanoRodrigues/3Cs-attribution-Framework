import { Extension, type CommandProps } from "@tiptap/core";
import { cmToPx, ptToPx } from "../utils/pageUnits.ts";

type ParagraphLayoutAttrs = {
  indentLeftCm?: number;
  indentRightCm?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
};

const toPx = (cm?: number): number => (typeof cm === "number" ? cmToPx(cm) : 0);

const ParagraphLayoutExtension = Extension.create({
  name: "paragraphLayout",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indentLeftCm: {
            default: 0,
            renderHTML: (attrs) => {
              const left = toPx(attrs.indentLeftCm);
              if (!left) return {};
              return { style: `margin-left: ${left}px` };
            }
          },
          indentRightCm: {
            default: 0,
            renderHTML: (attrs) => {
              const right = toPx(attrs.indentRightCm);
              if (!right) return {};
              return { style: `margin-right: ${right}px` };
            }
          },
          spaceBeforePt: {
            default: 0,
            renderHTML: (attrs) => {
              const beforePx = ptToPx(Number(attrs.spaceBeforePt ?? 0));
              if (!beforePx) return {};
              return { style: `margin-top: ${beforePx}px` };
            }
          },
          spaceAfterPt: {
            default: 0,
            renderHTML: (attrs) => {
              const afterPx = ptToPx(Number(attrs.spaceAfterPt ?? 0));
              if (!afterPx) return {};
              return { style: `margin-bottom: ${afterPx}px` };
            }
          }
        }
      }
    ];
  },
  addCommands() {
    return {
      setParagraphIndent:
        (attrs: ParagraphLayoutAttrs) =>
        ({ editor }: CommandProps) =>
          editor
            .chain()
            .updateAttributes("paragraph", {
              indentLeftCm: attrs.indentLeftCm,
              indentRightCm: attrs.indentRightCm
            })
            .updateAttributes("heading", {
              indentLeftCm: attrs.indentLeftCm,
              indentRightCm: attrs.indentRightCm
            })
            .run(),
      setParagraphSpacing:
        (attrs: ParagraphLayoutAttrs) =>
        ({ editor }: CommandProps) =>
          editor
            .chain()
            .updateAttributes("paragraph", {
              spaceBeforePt: attrs.spaceBeforePt,
              spaceAfterPt: attrs.spaceAfterPt
            })
            .updateAttributes("heading", {
              spaceBeforePt: attrs.spaceBeforePt,
              spaceAfterPt: attrs.spaceAfterPt
            })
            .run()
    };
  }
});

export default ParagraphLayoutExtension;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphLayout: {
      setParagraphIndent: (attrs: ParagraphLayoutAttrs) => ReturnType;
      setParagraphSpacing: (attrs: ParagraphLayoutAttrs) => ReturnType;
    };
  }
}
