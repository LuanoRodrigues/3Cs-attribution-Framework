export const LEDOC_FORMAT_VERSION = "1.0" as const;
export type LedocFormatVersion = typeof LEDOC_FORMAT_VERSION;

export const LEDOC_EXTENSION = "ledoc" as const;

export const LEDOC_PATHS = {
  document: "document.json",
  footnotes: "footnotes.json",
  meta: "meta.json",
  settings: "settings.json",
  styles: "styles.json",
  history: "history.json",
  mediaDir: "media",
  preview: "preview.png"
} as const;

export type LedocFootnoteEntry = {
  id: string;
  text: string;
  index: number;
};

export type LedocFootnotesFile = {
  version: LedocFormatVersion;
  footnotes: LedocFootnoteEntry[];
};

export type LedocMetaFile = {
  version: LedocFormatVersion;
  title: string;
  authors: string[];
  created: string;
  lastModified: string;
  appVersion?: string;
};

export type LedocSettingsFile = {
  pageSize: string;
  margins: { top: number; bottom: number; left: number; right: number };
  footnoteOffset?: number;
  fontFamily?: string;
  fontSize?: number;
};

export type LedocPayload = {
  document: object;
  meta: LedocMetaFile;
  settings?: LedocSettingsFile;
  footnotes?: LedocFootnotesFile;
  styles?: unknown;
  history?: unknown;
};

