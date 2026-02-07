import { Node } from "@tiptap/core";

export type BreakKind =
  | "page"
  | "column"
  | "text_wrap"
  | "section_next"
  | "section_continuous"
  | "section_even"
  | "section_odd";

export const BREAK_KIND_LABELS: Record<BreakKind, string> = {
  page: "Page Break",
  column: "Column Break",
  text_wrap: "Text Wrapping Break",
  section_next: "Section Break (Next Page)",
  section_continuous: "Section Break (Continuous)",
  section_even: "Section Break (Even Page)",
  section_odd: "Section Break (Odd Page)"
};

const PageBreakExtension = Node.create({
  name: "page_break",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      kind: {
        default: "page"
      },
      sectionId: {
        default: null
      },
      sectionSettings: {
        default: null
      }
    };
  },
  parseHTML() {
    return [{ tag: "div[data-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const kind = (HTMLAttributes.kind as BreakKind) ?? "page";
    const sectionId = HTMLAttributes.sectionId;
    const sectionSettings = HTMLAttributes.sectionSettings;
    const label = BREAK_KIND_LABELS[kind] ?? "Break";
    const attrs: Record<string, string> = {
      "data-break": "true",
      "data-break-kind": kind,
      "data-break-label": label,
      class: `leditor-break leditor-break-${kind}`
    };
    if (kind.startsWith("section_")) {
      const raw = kind.slice("section_".length);
      const normalized =
        raw === "next" ? "nextPage" : raw === "odd" ? "oddPage" : raw === "even" ? "evenPage" : raw;
      attrs["data-kind"] = normalized;
    }
    if (sectionId) {
      attrs["data-section-id"] = String(sectionId);
    }
    if (sectionSettings) {
      attrs["data-section-settings"] = String(sectionSettings);
    }
    if (kind === "page") {
      attrs["style"] = "break-before: page; page-break-before: always;";
    } else if (kind === "column") {
      attrs["style"] = "break-before: column; column-break-before: always;";
    }
    return ["div", attrs, 0];
  }
});

export default PageBreakExtension;
