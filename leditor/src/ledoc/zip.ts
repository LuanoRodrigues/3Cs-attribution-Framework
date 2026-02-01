import JSZip from "jszip";
import {
  LEDOC_FORMAT_VERSION,
  LEDOC_PATHS,
  type LedocFootnotesFile,
  type LedocMetaFile,
  type LedocPayload,
  type LedocSettingsFile
} from "./format.ts";

const normalizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

const assertLedocVersion = (value: unknown): asserts value is typeof LEDOC_FORMAT_VERSION => {
  if (value !== LEDOC_FORMAT_VERSION) {
    throw new Error(`Unsupported format version: ${String(value ?? "") || "unknown"}`);
  }
};

const assertString = (value: unknown, label: string): asserts value is string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${label}`);
  }
};

const assertStringArray = (value: unknown, label: string): asserts value is string[] => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Invalid ${label}`);
  }
};

const assertNumber = (value: unknown, label: string): asserts value is number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}`);
  }
};

const parseJsonObject = (raw: string, label: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} parse failed: ${normalizeError(error)}`);
  }
};

const readTextFileOptional = async (zip: JSZip, archivePath: string): Promise<string | null> => {
  const entry = zip.file(archivePath);
  if (!entry) return null;
  return entry.async("string");
};

const readJsonObjectOptional = async (
  zip: JSZip,
  archivePath: string,
  label: string
): Promise<Record<string, unknown> | null> => {
  const raw = await readTextFileOptional(zip, archivePath);
  if (raw == null) return null;
  return parseJsonObject(raw, label);
};

const requireJsonObject = async (zip: JSZip, archivePath: string, label: string): Promise<Record<string, unknown>> => {
  const parsed = await readJsonObjectOptional(zip, archivePath, label);
  if (!parsed) {
    throw new Error(`Archive missing required file: ${archivePath}`);
  }
  return parsed;
};

const assertMetaFile = (value: Record<string, unknown>): LedocMetaFile => {
  assertLedocVersion(value.version);
  assertString(value.title, "meta.title");
  assertStringArray(value.authors, "meta.authors");
  assertString(value.created, "meta.created");
  assertString(value.lastModified, "meta.lastModified");
  if (value.appVersion !== undefined && value.appVersion !== null) {
    if (typeof value.appVersion !== "string") {
      throw new Error("Invalid meta.appVersion");
    }
  }
  return value as unknown as LedocMetaFile;
};

const assertSettingsFile = (value: Record<string, unknown>): LedocSettingsFile => {
  assertString(value.pageSize, "settings.pageSize");
  if (!isPlainObject(value.margins)) {
    throw new Error("Invalid settings.margins");
  }
  const margins = value.margins as Record<string, unknown>;
  assertNumber(margins.top, "settings.margins.top");
  assertNumber(margins.bottom, "settings.margins.bottom");
  assertNumber(margins.left, "settings.margins.left");
  assertNumber(margins.right, "settings.margins.right");
  if (value.footnoteOffset !== undefined && value.footnoteOffset !== null) {
    assertNumber(value.footnoteOffset, "settings.footnoteOffset");
  }
  if (value.fontFamily !== undefined && value.fontFamily !== null) {
    if (typeof value.fontFamily !== "string") {
      throw new Error("Invalid settings.fontFamily");
    }
  }
  if (value.fontSize !== undefined && value.fontSize !== null) {
    assertNumber(value.fontSize, "settings.fontSize");
  }
  return value as unknown as LedocSettingsFile;
};

const assertFootnotesFile = (value: Record<string, unknown>): LedocFootnotesFile => {
  assertLedocVersion(value.version);
  if (!Array.isArray(value.footnotes)) {
    throw new Error("Invalid footnotes.footnotes");
  }
  const ids = new Set<string>();
  const indexes = new Set<number>();
  for (const entry of value.footnotes as unknown[]) {
    if (!isPlainObject(entry)) {
      throw new Error("Invalid footnotes entry");
    }
    const rec = entry as Record<string, unknown>;
    assertString(rec.id, "footnotes[].id");
    assertString(rec.text ?? "", "footnotes[].text");
    assertNumber(rec.index, "footnotes[].index");
    if (ids.has(rec.id)) {
      throw new Error(`Duplicate footnote id: ${rec.id}`);
    }
    if (indexes.has(rec.index)) {
      throw new Error(`Duplicate footnote index: ${rec.index}`);
    }
    ids.add(rec.id);
    indexes.add(rec.index);
  }
  return value as unknown as LedocFootnotesFile;
};

export const packLedocZip = async (payload: LedocPayload): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file(LEDOC_PATHS.document, JSON.stringify(payload.document ?? {}, null, 2));
  zip.file(LEDOC_PATHS.meta, JSON.stringify(payload.meta ?? {}, null, 2));
  if (payload.settings) {
    zip.file(LEDOC_PATHS.settings, JSON.stringify(payload.settings, null, 2));
  }
  if (payload.footnotes) {
    zip.file(LEDOC_PATHS.footnotes, JSON.stringify(payload.footnotes, null, 2));
  }
  if (payload.styles !== undefined) {
    zip.file(LEDOC_PATHS.styles, JSON.stringify(payload.styles, null, 2));
  }
  if (payload.history !== undefined) {
    zip.file(LEDOC_PATHS.history, JSON.stringify(payload.history, null, 2));
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer as Buffer;
};

export const unpackLedocZip = async (
  buffer: Buffer
): Promise<{
  payload: { document: object; meta: LedocMetaFile; settings?: LedocSettingsFile; footnotes?: LedocFootnotesFile };
  warnings: string[];
}> => {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(buffer);

  const document = await requireJsonObject(zip, LEDOC_PATHS.document, "document.json");
  const metaRaw = await requireJsonObject(zip, LEDOC_PATHS.meta, "meta.json");
  const meta = assertMetaFile(metaRaw);

  const settingsRaw = await readJsonObjectOptional(zip, LEDOC_PATHS.settings, "settings.json");
  const settings = settingsRaw ? assertSettingsFile(settingsRaw) : undefined;
  if (!settingsRaw) warnings.push("settings.json missing; using editor defaults.");

  const footnotesRaw = await readJsonObjectOptional(zip, LEDOC_PATHS.footnotes, "footnotes.json");
  const footnotes = footnotesRaw ? assertFootnotesFile(footnotesRaw) : undefined;
  if (!footnotesRaw) warnings.push("footnotes.json missing; loaded content only.");

  if (footnotes && footnotes.version !== meta.version) {
    throw new Error(`Unsupported format version: ${footnotes.version}`);
  }

  return { payload: { document, meta, settings, footnotes }, warnings };
};

