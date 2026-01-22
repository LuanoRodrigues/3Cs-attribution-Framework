import { Extension } from "@tiptap/core";

type LineHeight = "1.0" | "1.15" | "1.5" | "2.0";

const parsePx = (value: string | null) => {
  if (!value) return 0;
  const match = value.match(/^([0-9.]+)px$/);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
};

const SpacingExtension = Extension.create({
  name: "spacing",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => {
              const value = (element as HTMLElement).style.lineHeight;
              return value || null;
            },
            renderHTML: (attrs) => {
              if (!attrs.lineHeight) return {};
              return { style: `line-height: ${attrs.lineHeight}` };
            }
          },
          spaceBefore: {
            default: 0,
            parseHTML: (element) => parsePx((element as HTMLElement).style.marginTop),
            renderHTML: (attrs) => {
              const value = Number(attrs.spaceBefore ?? 0);
              if (!value) return {};
              return { style: `margin-top: ${value}px` };
            }
          },
          spaceAfter: {
            default: 0,
            parseHTML: (element) => parsePx((element as HTMLElement).style.marginBottom),
            renderHTML: (attrs) => {
              const value = Number(attrs.spaceAfter ?? 0);
              if (!value) return {};
              return { style: `margin-bottom: ${value}px` };
            }
          }
        }
      }
    ];
  },
  addCommands() {
    return {
      setLineHeight:
        (value: LineHeight) =>
        ({ chain }: { chain: any }) =>
          chain.updateAttributes("paragraph", { lineHeight: value }).updateAttributes("heading", { lineHeight: value }).run(),
      setSpaceBefore:
        (valuePx: number) =>
        ({ chain }: { chain: any }) =>
          chain.updateAttributes("paragraph", { spaceBefore: valuePx }).updateAttributes("heading", { spaceBefore: valuePx }).run(),
      setSpaceAfter:
        (valuePx: number) =>
        ({ chain }: { chain: any }) =>
          chain.updateAttributes("paragraph", { spaceAfter: valuePx }).updateAttributes("heading", { spaceAfter: valuePx }).run()
    } as any;
  }
});

export default SpacingExtension;
