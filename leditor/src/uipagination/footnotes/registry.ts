import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { FootnoteKind } from "./model.ts";

export type FootnoteNumbering = {
  numbering: Map<string, number>;
};

export const reconcileFootnotes = (doc: ProseMirrorNode): FootnoteNumbering => {
  const numbering = new Map<string, number>();
  let footnoteCounter = 0;
  let endnoteCounter = 0;

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
      numbering.set(id, endnoteCounter);
    } else {
      footnoteCounter += 1;
      numbering.set(id, footnoteCounter);
    }
    return true;
  });
  return { numbering };
};
