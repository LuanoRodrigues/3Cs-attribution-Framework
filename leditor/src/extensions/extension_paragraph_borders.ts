import { Extension } from "@tiptap/core";

const DEFAULT_BORDER_COLOR = "#1e1e1e";
const DEFAULT_BORDER_WIDTH = 1;

const buildBorderStyle = (
  preset: string | null,
  color?: string | null,
  width?: number | null
): string | null => {
  if (!preset || preset === "none") return null;
  const resolvedColor = typeof color === "string" && color.trim() ? color.trim() : DEFAULT_BORDER_COLOR;
  const resolvedWidth = Number.isFinite(width) && (width as number) > 0 ? Number(width) : DEFAULT_BORDER_WIDTH;
  const size = `${resolvedWidth}px`;
  switch (preset) {
    case "bottom":
      return `border-bottom: ${size} solid ${resolvedColor}`;
    case "top":
      return `border-top: ${size} solid ${resolvedColor}`;
    case "left":
      return `border-left: ${size} solid ${resolvedColor}`;
    case "right":
      return `border-right: ${size} solid ${resolvedColor}`;
    case "all":
    case "outside":
      return `border: ${size} solid ${resolvedColor}`;
    case "inside":
      return `border-left: ${size} solid ${resolvedColor}; border-right: ${size} solid ${resolvedColor}`;
    default:
      return null;
  }
};

const hasBorderWidth = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) && numeric > 0;
};

const parseBorderWidth = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const parseBorderColor = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "initial" || trimmed === "inherit" || trimmed === "unset") return null;
  return trimmed;
};

const inferPresetFromElement = (element: HTMLElement): string | null => {
  const style = element.style;
  const top = hasBorderWidth(style.borderTopWidth);
  const right = hasBorderWidth(style.borderRightWidth);
  const bottom = hasBorderWidth(style.borderBottomWidth);
  const left = hasBorderWidth(style.borderLeftWidth);

  if (!top && !right && !bottom && !left) return null;
  if (top && right && bottom && left) return "all";
  if (bottom && !top && !left && !right) return "bottom";
  if (top && !bottom && !left && !right) return "top";
  if (left && !right && !top && !bottom) return "left";
  if (right && !left && !top && !bottom) return "right";
  return "all";
};

const inferBorderColor = (element: HTMLElement): string | null => {
  const style = element.style;
  return (
    parseBorderColor(style.borderBottomColor) ||
    parseBorderColor(style.borderTopColor) ||
    parseBorderColor(style.borderLeftColor) ||
    parseBorderColor(style.borderRightColor) ||
    parseBorderColor(style.borderColor) ||
    null
  );
};

const inferBorderWidth = (element: HTMLElement): number | null => {
  const style = element.style;
  return (
    parseBorderWidth(style.borderBottomWidth) ||
    parseBorderWidth(style.borderTopWidth) ||
    parseBorderWidth(style.borderLeftWidth) ||
    parseBorderWidth(style.borderRightWidth) ||
    parseBorderWidth(style.borderWidth) ||
    null
  );
};

const ParagraphBordersExtension = Extension.create({
  name: "paragraphBorders",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          borderPreset: {
            default: null,
            parseHTML: (element) => inferPresetFromElement(element as HTMLElement),
            renderHTML: (attrs) => {
              const preset = typeof attrs.borderPreset === "string" ? attrs.borderPreset : null;
              const color = typeof attrs.borderColor === "string" ? attrs.borderColor : null;
              const width = typeof attrs.borderWidth === "number" ? attrs.borderWidth : null;
              const style = buildBorderStyle(preset, color, width);
              if (!style) return {};
              return { style };
            }
          },
          borderColor: {
            default: null,
            parseHTML: (element) => inferBorderColor(element as HTMLElement),
            renderHTML: () => ({})
          },
          borderWidth: {
            default: null,
            parseHTML: (element) => inferBorderWidth(element as HTMLElement),
            renderHTML: () => ({})
          }
        }
      }
    ];
  }
});

export default ParagraphBordersExtension;
