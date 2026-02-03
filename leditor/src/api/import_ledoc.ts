import type { LedocBundlePayload, LedocPayload } from "../ledoc/format.ts";

export type ImportLedocOptions = {
  sourcePath?: string;
  prompt?: boolean;
};

export type ImportLedocRequest = {
  options?: ImportLedocOptions;
};

export type ImportLedocResult = {
  success: boolean;
  filePath?: string;
  payload?: LedocPayload | LedocBundlePayload;
  warnings?: string[];
  error?: string;
};
