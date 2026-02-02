import type { EditorHandle } from "../api/leditor.ts";
import type { AiSettings } from "../types/ai.ts";
import type { ExportPdfOptions, ExportPdfRequest, ExportPdfResult } from "../api/export_pdf.ts";
import type { ExportDocxOptions, ExportDocxRequest, ExportDocxResult } from "../api/export_docx.ts";
import type { ImportDocxOptions, ImportDocxRequest, ImportDocxResult } from "../api/import_docx.ts";
import type { ExportLedocOptions, ExportLedocRequest, ExportLedocResult } from "../api/export_ledoc.ts";
import type { ImportLedocOptions, ImportLedocRequest, ImportLedocResult } from "../api/import_ledoc.ts";

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

type AgentRequestPayload = {
  scope: "selection" | "document";
  instruction: string;
  selection?: { from: number; to: number; text: string };
  document?: { text: string };
  targets?: Array<{ n: number; headingNumber?: string; headingTitle?: string }>;
  history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  settings?: AiSettings;
};

type AgentOperation =
  | { op: "replaceSelection"; text: string }
  | { op: "replaceParagraph"; n: number; text: string }
  | { op: "replaceDocument"; text: string };

type AgentRequestResult = {
  success: boolean;
  assistantText?: string;
  applyText?: string;
  operations?: AgentOperation[];
  meta?: {
    provider: string;
    model?: string;
    ms?: number;
  };
  error?: string;
};

type LlmStatusResult = {
  success: boolean;
  providers?: Array<{
    id: string;
    label?: string;
    envKey?: string;
    hasApiKey?: boolean;
    defaultModel?: string;
    modelFromEnv?: boolean;
  }>;
  error?: string;
};

type LlmCatalogResult = {
  success: boolean;
  providers?: Array<{
    id: string;
    label?: string;
    envKey?: string;
    models?: Array<{ id: string; label?: string; description?: string }>;
  }>;
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
    saveState?(request: { scopeId: string; state: Record<string, unknown> }): Promise<{ baseDir?: string; statePath?: string }>;
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
    __leditorRibbonDebug?: boolean;
    __leditorRibbonDebugTab?: string;
    __leditorRibbonDebugVerbose?: boolean;
    __leditorHost?: LeditorHostInfo;
    leditor?: EditorHandle;
    leditorHost?: {
      writePhaseMarker?: (name: string, content: string) => void;
      openFootnotePanel?: () => void;
      toggleFootnotePanel?: () => void;
      closeFootnotePanel?: () => void;
      registerFootnoteHandlers?: (handlers: FootnoteHandlerSet) => void;
      prefetchDirectQuotes?: (request: { lookupPath: string; dqids: string[] }) => Promise<{ success: boolean; error?: string }>;
      exportPDF?: (request: ExportPdfRequest) => Promise<ExportPdfResult>;
      exportDOCX?: (request: ExportDocxRequest) => Promise<ExportDocxResult>;
      importDOCX?: (request: ImportDocxRequest) => Promise<ImportDocxResult>;
      exportLEDOC?: (request: ExportLedocRequest) => Promise<ExportLedocResult>;
      importLEDOC?: (request: ImportLedocRequest) => Promise<ImportLedocResult>;
      insertImage?: (request?: { sourcePath?: string }) => Promise<InsertImageResult>;
      getDefaultLEDOCPath?: () => Promise<string>;
      readFile?: (request: { sourcePath: string }) => Promise<HostReadFileResult>;
      writeFile?: (request: { targetPath: string; data: string }) => Promise<HostWriteFileResult>;
      agentRequest?: (request: { requestId?: string; payload: AgentRequestPayload }) => Promise<AgentRequestResult>;
      agentCancel?: (request: { requestId: string }) => Promise<{ success: boolean; cancelled?: boolean; error?: string }>;
      getAiStatus?: () => Promise<{ success: boolean; hasApiKey?: boolean; model?: string; modelFromEnv?: boolean; error?: string }>;
      getLlmStatus?: () => Promise<LlmStatusResult>;
      getLlmCatalog?: () => Promise<LlmCatalogResult>;
      checkSources?: (request: { requestId?: string; payload: Record<string, unknown> }) => Promise<Record<string, unknown>>;
      lexicon?: (request: { requestId?: string; payload: Record<string, unknown> }) => Promise<Record<string, unknown>>;
      getInstalledAddins?: () => Promise<InstalledAddin[]>;
      installedAddins?: InstalledAddin[];
    };
    settingsBridge?: SettingsBridge;
    coderBridge?: CoderBridge;
    __leditorCoderStatePath?: string;
    __leditorAutoImportDOCX?: (options?: ImportDocxOptions) => Promise<ImportDocxResult>;
    __leditorAutoExportDOCX?: (options?: ExportDocxOptions) => Promise<ExportDocxResult>;
    __leditorAutoExportPDF?: (options?: ExportPdfOptions) => Promise<ExportPdfResult>;
    __leditorAutoImportLEDOC?: (options?: ImportLedocOptions) => Promise<ImportLedocResult>;
    __leditorAutoExportLEDOC?: (options?: ExportLedocOptions) => Promise<ExportLedocResult>;
    __leditorAutoPreview?: () => void;
    __leditorAutoSourceView?: () => void;
  }
}
export {};

declare module "*.css";
