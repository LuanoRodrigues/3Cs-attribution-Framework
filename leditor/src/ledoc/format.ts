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

// LEDOC v2 (directory bundle format)
export const LEDOC_BUNDLE_VERSION = "2.0" as const;
export type LedocBundleVersion = typeof LEDOC_BUNDLE_VERSION;

export const LEDOC_BUNDLE_PATHS = {
  version: "version.txt",
  content: "content.json",
  layout: "layout.json",
  registry: "registry.json",
  meta: "meta.json",
  mediaDir: "media"
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

export type LedocBundleMetaFile = {
  version: LedocBundleVersion;
  title: string;
  authors: string[];
  created: string;
  lastModified: string;
  appVersion?: string;
  sourceFormat?: "bundle" | "zip-v1";
};

export type LedocBundleLayoutFile = {
  version: LedocBundleVersion;
  pageSize: string;
  margins: { unit: "cm"; top: number; bottom: number; left: number; right: number };
  pagination?: { pageCount?: number; computedAt?: string; engine?: string };
  footnotes?: { offsetCm?: number; computedAt?: string };
};

export type LedocBundleRegistryFile = {
  version: LedocBundleVersion;
  footnoteIdState?: { counters: { footnote: number; endnote: number } };
  knownFootnotes?: Array<{
    id: string;
    kind: "footnote" | "endnote";
    index?: number;
    deleted?: boolean;
    citationId?: string;
  }>;
  // Optional persisted AI/source-check thread state (renderer decides how to interpret it).
  sourceChecksThread?: unknown;
  agentHistory?: unknown;
};

export type LedocBundlePayload = {
  version: LedocBundleVersion;
  content: object;
  layout: LedocBundleLayoutFile;
  registry: LedocBundleRegistryFile;
  meta: LedocBundleMetaFile;
};
