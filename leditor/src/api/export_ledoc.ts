import type { LedocPayload } from "../ledoc/format.ts";

export type ExportLedocOptions = {
  targetPath?: string;
  suggestedPath?: string;
  prompt?: boolean;
};

export type ExportLedocRequest = {
  payload: LedocPayload;
  options?: ExportLedocOptions;
};

export type ExportLedocResult = {
  success: boolean;
  filePath?: string;
  bytes?: number;
  warnings?: string[];
  error?: string;
};

