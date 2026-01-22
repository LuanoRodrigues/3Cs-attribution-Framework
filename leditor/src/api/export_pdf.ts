export type ExportPdfOptions = {
  suggestedPath?: string;
  prompt?: boolean;
};

export type ExportPdfRequest = {
  html: string;
  options?: ExportPdfOptions;
};

export type ExportPdfResult = {
  success: boolean;
  filePath?: string;
  bytes?: number;
  error?: string;
};
