import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { FootnoteKind } from "./model.ts";

export type FootnoteNumbering = {
  numbering: Map<string, string>;
};

type NumberFormat =
  | "decimal"
  | "roman-upper"
  | "roman-lower"
  | "alpha-upper"
  | "alpha-lower";

const formatAlpha = (value: number): string => {
  let n = Math.max(0, Math.floor(value));
  if (n <= 0) return "";
  let result = "";
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
};

const formatRoman = (value: number): string => {
  let n = Math.max(0, Math.floor(value));
  if (n <= 0) return "";
  const map: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
  ];
  let result = "";
  for (const [num, sym] of map) {
    while (n >= num) {
      result += sym;
      n -= num;
    }
  }
  return result;
};

const formatNumber = (value: number, format: NumberFormat): string => {
  if (!Number.isFinite(value) || value <= 0) return "";
  switch (format) {
    case "roman-upper":
      return formatRoman(value);
    case "roman-lower":
      return formatRoman(value).toLowerCase();
    case "alpha-upper":
      return formatAlpha(value).toUpperCase();
    case "alpha-lower":
      return formatAlpha(value).toLowerCase();
    case "decimal":
    default:
      return String(Math.floor(value));
  }
};

export const reconcileFootnotes = (doc: ProseMirrorNode): FootnoteNumbering => {
  const numbering = new Map<string, string>();
  let footnoteCounter = 0;
  let endnoteCounter = 0;
  const attrs = (doc?.attrs ?? {}) as Record<string, unknown>;
  const numberingMode =
    typeof attrs.footnoteNumbering === "string" ? String(attrs.footnoteNumbering) : "document";
  const footnoteFormat = ((): NumberFormat => {
    const raw = typeof attrs.footnoteNumberFormat === "string" ? String(attrs.footnoteNumberFormat) : "decimal";
    return (["decimal", "roman-upper", "roman-lower", "alpha-upper", "alpha-lower"] as const).includes(raw as any)
      ? (raw as NumberFormat)
      : "decimal";
  })();
  const endnoteFormat = ((): NumberFormat => {
    const raw = typeof attrs.endnoteNumberFormat === "string" ? String(attrs.endnoteNumberFormat) : footnoteFormat;
    return (["decimal", "roman-upper", "roman-lower", "alpha-upper", "alpha-lower"] as const).includes(raw as any)
      ? (raw as NumberFormat)
      : footnoteFormat;
  })();
  const footnotePrefix = typeof attrs.footnoteNumberPrefix === "string" ? String(attrs.footnoteNumberPrefix) : "";
  const footnoteSuffix = typeof attrs.footnoteNumberSuffix === "string" ? String(attrs.footnoteNumberSuffix) : "";
  const endnotePrefix = typeof attrs.endnoteNumberPrefix === "string" ? String(attrs.endnoteNumberPrefix) : footnotePrefix;
  const endnoteSuffix = typeof attrs.endnoteNumberSuffix === "string" ? String(attrs.endnoteNumberSuffix) : footnoteSuffix;
  const pageType = doc.type?.schema?.nodes?.page ?? null;

  const parseResetFlag = (raw: unknown): boolean => {
    if (!raw) return false;
    if (raw === true) return true;
    if (typeof raw === "string") {
      const trimmed = raw.trim().toLowerCase();
      if (trimmed === "true" || trimmed === "1" || trimmed === "yes") return true;
    }
    return false;
  };

  const isResetBoundary = (node: ProseMirrorNode): boolean => {
    // Generic future-proof hook: any node can carry `resetFootnotes=true`.
    if (parseResetFlag((node.attrs as any)?.resetFootnotes)) return true;

    // Section breaks are represented by the `page_break` node with kind `section_*`.
    if (node.type.name === "page_break") {
      const kind = typeof (node.attrs as any)?.kind === "string" ? String((node.attrs as any).kind) : "";
      if (!kind.startsWith("section_")) return false;
      const settingsRaw = (node.attrs as any)?.sectionSettings;
      if (!settingsRaw) return false;
      if (parseResetFlag(settingsRaw)) return true;
      if (typeof settingsRaw === "string") {
        try {
          const parsed = JSON.parse(settingsRaw);
          return parseResetFlag((parsed as any)?.resetFootnotes);
        } catch {
          return false;
        }
      }
      if (typeof settingsRaw === "object") {
        return parseResetFlag((settingsRaw as any)?.resetFootnotes);
      }
    }
    return false;
  };

  doc.descendants((node) => {
    if (numberingMode === "page" && pageType && node.type === pageType) {
      footnoteCounter = 0;
      endnoteCounter = 0;
      return true;
    }
    if (isResetBoundary(node)) {
      footnoteCounter = 0;
      endnoteCounter = 0;
      return true;
    }
    if (node.type.name !== "footnote") return true;
    const id = typeof node.attrs?.footnoteId === "string" ? node.attrs.footnoteId : "";
    if (!id) return true;
    const kind = (typeof node.attrs?.kind === "string" ? node.attrs.kind : "footnote") as FootnoteKind;
    if (kind === "endnote") {
      endnoteCounter += 1;
      const label = endnotePrefix + formatNumber(endnoteCounter, endnoteFormat) + endnoteSuffix;
      numbering.set(id, label);
    } else {
      footnoteCounter += 1;
      const label = footnotePrefix + formatNumber(footnoteCounter, footnoteFormat) + footnoteSuffix;
      numbering.set(id, label);
    }
    return true;
  });
  return { numbering };
};
