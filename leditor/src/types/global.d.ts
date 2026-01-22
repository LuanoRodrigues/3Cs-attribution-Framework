import type { ExportPdfRequest, ExportPdfResult } from "../api/export_pdf.js";
import type { ExportDocxRequest, ExportDocxResult } from "../api/export_docx.js";
import type { ImportDocxRequest, ImportDocxResult } from "../api/import_docx.js";

type InsertImageResult = {
  success: boolean;
  url?: string;
  error?: string;
};

type HostReadFileResult = {
  success: boolean;
  data?: string;
  error?: string;
  filePath?: string;
};

type FootnoteHandlerSet = {
  open: () => void;
  toggle: () => void;
  close: () => void;
};

type InstalledAddin = {
  id: string;
  name: string;
  description?: string;
};

declare global {
  interface Window {
    leditorHost?: {
      writePhaseMarker?: (name: string, content: string) => void;
      openFootnotePanel?: () => void;
      toggleFootnotePanel?: () => void;
      closeFootnotePanel?: () => void;
      registerFootnoteHandlers?: (handlers: FootnoteHandlerSet) => void;
      exportPDF?: (request: ExportPdfRequest) => Promise<ExportPdfResult>;
      exportDOCX?: (request: ExportDocxRequest) => Promise<ExportDocxResult>;
      importDOCX?: (request: ImportDocxRequest) => Promise<ImportDocxResult>;
      insertImage?: (request?: { sourcePath?: string }) => Promise<InsertImageResult>;
      readFile?: (request: { sourcePath: string }) => Promise<HostReadFileResult>;
      getInstalledAddins?: () => Promise<InstalledAddin[]>;
      installedAddins?: InstalledAddin[];
    };
    __leditorCoderStatePath?: string;
  }
}
export {};

declare module "*.css";
