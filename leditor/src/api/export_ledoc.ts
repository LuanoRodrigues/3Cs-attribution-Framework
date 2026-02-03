import type { LedocBundlePayload, LedocPayload } from "../ledoc/format.ts";

export type ExportLedocOptions = {
  targetPath?: string;
  suggestedPath?: string;
  prompt?: boolean;
};

export type ExportLedocRequest = {
  payload: LedocPayload | LedocBundlePayload;
  options?: ExportLedocOptions;
};

export type ExportLedocResult = {
  success: boolean;
  filePath?: string;
  bytes?: number;
  payload?: LedocPayload | LedocBundlePayload;
  warnings?: string[];
  error?: string;
};
