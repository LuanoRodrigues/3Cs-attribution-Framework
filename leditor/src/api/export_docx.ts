export type PageSizeDefinition = {
  widthMm: number;
  heightMm: number;
  orientation?: "portrait" | "landscape";
};

export type PageMargins = {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
};

export type SectionOptions = {
  /** Optional header HTML that will repeat on every page. */
  headerHtml?: string;
  /** Optional footer HTML that will repeat on every page. */
  footerHtml?: string;
  /** First page number used when rendering the section. */
  pageNumberStart?: number;
};

export type ExportDocxOptions = {
  suggestedPath?: string;
  prompt?: boolean;
  pageSize?: PageSizeDefinition;
  pageMargins?: PageMargins;
  section?: SectionOptions;
};

export type ExportDocxRequest = {
  docJson: object;
  options?: ExportDocxOptions;
};

export type ExportDocxResult = {
  success: boolean;
  filePath?: string;
  bytes?: number;
  error?: string;
};
