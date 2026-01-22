export type ImportDocxOptions = {
  sourcePath?: string;
  prompt?: boolean;
};

export type ImportDocxRequest = {
  options?: ImportDocxOptions;
};

export type ImportDocxResult = {
  success: boolean;
  html?: string;
  filePath?: string;
  error?: string;
};
