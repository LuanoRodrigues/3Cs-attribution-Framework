import { Extension } from "@tiptap/core";
import type { Transaction } from "prosemirror-state";
import { debugInfo } from "../utils/debug.ts";

type Orientation = "portrait" | "landscape";
type ColumnsMode = "one" | "two" | "three" | "left" | "right";

type MarginsCm = {
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  left?: number | string;
};

type PageLayoutAttrs = {
  pageSizeId: string;
  pageWidthMm?: number;
  pageHeightMm?: number;
  orientation: Orientation;
  marginsTopCm: number;
  marginsRightCm: number;
  marginsBottomCm: number;
  marginsLeftCm: number;
  columns: number;
  columnsMode: ColumnsMode;
  columnGapIn?: number;
  columnWidthIn?: number | null;
  lineNumbering?: string;
  hyphenation?: string;
};

const shouldForceSingleColumn = (): boolean =>
  typeof window !== "undefined" && (window as any).__leditorDisableColumns !== false;

const defaultLayout: PageLayoutAttrs = {
  pageSizeId: "a4",
  orientation: "portrait",
  marginsTopCm: 2.54,
  marginsRightCm: 2.54,
  marginsBottomCm: 2.54,
  marginsLeftCm: 2.54,
  columns: 1,
  columnsMode: "one",
  columnGapIn: 0.25,
  columnWidthIn: null
};

const parseToCm = (value: number | string | undefined, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return fallback;
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return fallback;
  if (trimmed.endsWith("cm")) return numeric;
  if (trimmed.endsWith("mm")) return numeric / 10;
  if (trimmed.endsWith("in")) return numeric * 2.54;
  return numeric;
};

const PageLayoutExtension = Extension.create({
  name: "pageLayout",
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: {
          pageSizeId: {
            default: defaultLayout.pageSizeId
          },
          pageWidthMm: {
            default: defaultLayout.pageWidthMm
          },
          pageHeightMm: {
            default: defaultLayout.pageHeightMm
          },
          orientation: {
            default: defaultLayout.orientation
          },
          marginsTopCm: { default: defaultLayout.marginsTopCm },
          marginsRightCm: { default: defaultLayout.marginsRightCm },
          marginsBottomCm: { default: defaultLayout.marginsBottomCm },
          marginsLeftCm: { default: defaultLayout.marginsLeftCm },
          columns: { default: defaultLayout.columns },
          columnsMode: { default: defaultLayout.columnsMode },
          columnGapIn: { default: defaultLayout.columnGapIn },
          columnWidthIn: { default: defaultLayout.columnWidthIn },
          lineNumbering: { default: "none" },
          hyphenation: { default: "none" }
        }
      }
    ];
  },
  addCommands() {
    const updateDocAttrs = (updater: (attrs: PageLayoutAttrs) => PageLayoutAttrs) =>
      ({ editor, tr, dispatch }: { editor: any; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        const current = (editor.state.doc.attrs ?? {}) as Partial<PageLayoutAttrs>;
        const next = updater(current as PageLayoutAttrs);
        Object.entries(next).forEach(([key, value]) => {
          tr.setDocAttribute(key, value as PageLayoutAttrs[keyof PageLayoutAttrs]);
        });
        if (dispatch) dispatch(tr);
        return true;
      };

    return {
      setPageMargins:
        (margins: MarginsCm) =>
        updateDocAttrs((attrs) => {
          const payload = {
            ...attrs,
            marginsTopCm: parseToCm(margins.top, defaultLayout.marginsTopCm),
            marginsRightCm: parseToCm(margins.right, defaultLayout.marginsRightCm),
            marginsBottomCm: parseToCm(margins.bottom, defaultLayout.marginsBottomCm),
            marginsLeftCm: parseToCm(margins.left, defaultLayout.marginsLeftCm)
          };
          debugInfo("[A4Debug] setPageMargins cmd", payload);
          return payload;
        }),
      setPageSize:
        (id: string, overrides?: { widthMm?: number; heightMm?: number }) =>
          updateDocAttrs((attrs) => ({
            ...attrs,
            pageSizeId: id,
            pageWidthMm: overrides?.widthMm,
            pageHeightMm: overrides?.heightMm
          })),
      setPageOrientation:
        (orientation: Orientation) =>
          updateDocAttrs((attrs) => ({ ...attrs, orientation })),
      setPageColumns:
        (input: { count: number; mode?: ColumnsMode; gapIn?: number; widthIn?: number | null }) =>
          updateDocAttrs((attrs) => {
            const forceSingle = shouldForceSingleColumn();
            const normalized = forceSingle ? 1 : Math.max(1, Math.min(4, Math.floor(input.count)));
            const gapIn =
              typeof input.gapIn === "number" && Number.isFinite(input.gapIn)
                ? input.gapIn
                : attrs.columnGapIn ?? defaultLayout.columnGapIn;
            const widthIn =
              input.widthIn !== undefined
                ? typeof input.widthIn === "number" && Number.isFinite(input.widthIn) && input.widthIn > 0
                  ? input.widthIn
                  : null
                : attrs.columnWidthIn ?? defaultLayout.columnWidthIn;
            return {
              ...attrs,
              columns: normalized,
              columnsMode: forceSingle ? "one" : input.mode ?? defaultLayout.columnsMode,
              columnGapIn: gapIn,
              columnWidthIn: widthIn
            };
          }),
      setLineNumbering:
        (mode: string) =>
          updateDocAttrs((attrs) => ({ ...attrs, lineNumbering: mode })),
      setHyphenation:
        (mode: string) =>
          updateDocAttrs((attrs) => ({ ...attrs, hyphenation: mode }))
    } as any;
  }
});

export default PageLayoutExtension;
