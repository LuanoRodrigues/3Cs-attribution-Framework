import type { EditorHandle } from "../api/leditor.js";
import type { ExportPdfOptions, ExportPdfRequest, ExportPdfResult } from "../api/export_pdf.js";
import type { ExportDocxOptions, ExportDocxRequest, ExportDocxResult } from "../api/export_docx.js";
import type { ImportDocxOptions, ImportDocxRequest, ImportDocxResult } from "../api/import_docx.js";

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

type HostWriteFileResult = {
  success: boolean;
  error?: string;
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

type SettingsBridge = {
  getValue(key: string, fallback: string): Promise<string>;
};

type CoderBridge = {
    loadState(request: { scopeId: string }): Promise<{ state?: Record<string, unknown>; statePath?: string }>;
  };
type LeditorHostInfo = {
  version: number;
  sessionId: string;
  documentId: string;
  documentTitle: string;
  paths: {
    contentDir: string;
    bibliographyDir: string;
    tempDir: string;
  };
  inputs: {
    directQuoteJsonPath: string;
  };
  policy: {
    allowDiskWrites: boolean;
  };
};

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
    __logCoderNode?: () => void;
    __leditorPaginationDebug?: boolean;
    __leditorHost?: LeditorHostInfo;
    leditor?: EditorHandle;
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
      writeFile?: (request: { targetPath: string; data: string }) => Promise<HostWriteFileResult>;
      getInstalledAddins?: () => Promise<InstalledAddin[]>;
      installedAddins?: InstalledAddin[];
    };
    settingsBridge?: SettingsBridge;
    coderBridge?: CoderBridge;
    __leditorCoderStatePath?: string;
    __leditorAutoImportDOCX?: (options?: ImportDocxOptions) => Promise<ImportDocxResult>;
    __leditorAutoExportDOCX?: (options?: ExportDocxOptions) => Promise<ExportDocxResult>;
    __leditorAutoExportPDF?: (options?: ExportPdfOptions) => Promise<ExportPdfResult>;
    __leditorAutoPreview?: () => void;
    __leditorAutoSourceView?: () => void;
  }
}
export {};

declare module "*.css";
