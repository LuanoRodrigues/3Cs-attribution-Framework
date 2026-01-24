import { registerPlugin } from "../api/plugin_registry.js";
import type { EditorHandle } from "../api/leditor.js";
import type {
  ExportDocxOptions,
  ExportDocxRequest,
  ExportDocxResult,
  PageMargins,
  PageSizeDefinition,
  SectionOptions
} from "../api/export_docx.js";

const triggerExport = (docJson: object, options?: ExportDocxOptions) => {
  const handler = window.leditorHost?.exportDOCX;
  if (!handler) {
    return Promise.resolve({
      success: false,
      error: "ExportDOCX handler is unavailable"
    } as ExportDocxResult);
  }
  return handler({ docJson, options });
};

const readComputedRootValue = (name: string) => {
  const root = document.documentElement;
  if (!root) return "";
  const computed = getComputedStyle(root);
  return computed.getPropertyValue(name) || root.style.getPropertyValue(name) || "";
};

const parseNumber = (value: string, fallback: number) => {
  const parsed = parseFloat(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readPageSize = (): PageSizeDefinition => {
  const widthMm = parseNumber(readComputedRootValue("--page-width-mm"), 210);
  const heightMm = parseNumber(readComputedRootValue("--page-height-mm"), 297);
  return {
    widthMm,
    heightMm,
    orientation: widthMm > heightMm ? "landscape" : "portrait"
  };
};

const readPageMargins = (): PageMargins => ({
  top: readComputedRootValue("--page-margin-top") || "1in",
  right: readComputedRootValue("--page-margin-right") || "1in",
  bottom: readComputedRootValue("--page-margin-bottom") || "1in",
  left: readComputedRootValue("--page-margin-left") || "1in"
});

const mergeMargins = (base: PageMargins, override?: PageMargins): PageMargins => ({
  top: override?.top ?? base.top,
  right: override?.right ?? base.right,
  bottom: override?.bottom ?? base.bottom,
  left: override?.left ?? base.left
});

const mergePageSize = (base: PageSizeDefinition, override?: PageSizeDefinition): PageSizeDefinition => ({
  widthMm: override?.widthMm ?? base.widthMm,
  heightMm: override?.heightMm ?? base.heightMm,
  orientation: override?.orientation ?? base.orientation
});

const readSectionDefaults = (): SectionOptions => ({
  headerHtml: document.querySelector(".leditor-page-header")?.innerHTML ?? undefined,
  footerHtml: document.querySelector(".leditor-page-footer")?.innerHTML ?? undefined,
  pageNumberStart: 1
});

const mergeSection = (base: SectionOptions, override?: SectionOptions): SectionOptions => ({
  headerHtml: override?.headerHtml ?? base.headerHtml,
  footerHtml: override?.footerHtml ?? base.footerHtml,
  pageNumberStart: override?.pageNumberStart ?? base.pageNumberStart
});

const buildDefaultOptions = (): ExportDocxOptions => ({
  prompt: true,
  suggestedPath: `.codex_logs/exports/docx-${Date.now()}.docx`,
  pageSize: readPageSize(),
  pageMargins: readPageMargins(),
  section: readSectionDefaults()
});

const buildExportOptions = (override?: ExportDocxOptions): ExportDocxOptions => {
  const defaults = buildDefaultOptions();
  return {
    prompt: override?.prompt ?? defaults.prompt,
    suggestedPath: override?.suggestedPath ?? defaults.suggestedPath,
    pageSize: mergePageSize(defaults.pageSize ?? { widthMm: 210, heightMm: 297 }, override?.pageSize),
    pageMargins: mergeMargins(defaults.pageMargins ?? {}, override?.pageMargins),
    section: mergeSection(defaults.section ?? {}, override?.section)
  };
};

registerPlugin({
  id: "export_docx",
  commands: {
    ExportDOCX(editorHandle: EditorHandle, args?: { options?: ExportDocxOptions }) {
      const docJson = editorHandle.getJSON();
      const options = buildExportOptions(args?.options);
      void triggerExport(docJson, options).catch((error: unknown) => {
        console.error("ExportDOCX failed", error);
      });
    }
  },
  onInit(editorHandle: EditorHandle) {
    window.__leditorAutoExportDOCX = (options?: ExportDocxOptions) => {
      const docJson = editorHandle.getJSON();
      const mergedOptions = buildExportOptions(options);
      return triggerExport(docJson, mergedOptions);
    };
  }
});
