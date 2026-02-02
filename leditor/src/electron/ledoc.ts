import JSZip from "jszip";

export const LEDOC_EXTENSION = "ledoc" as const;
export const LEDOC_FORMAT_VERSION = "1.0" as const;

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

const normalizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

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

const readJsonAnyOptional = async (
  zip: JSZip,
  archivePath: string,
  label: string
): Promise<unknown | null> => {
  const raw = await readTextFileOptional(zip, archivePath);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${label} parse failed: ${normalizeError(error)}`);
  }
};

const requireJsonObject = async (zip: JSZip, archivePath: string, label: string): Promise<Record<string, unknown>> => {
  const parsed = await readJsonObjectOptional(zip, archivePath, label);
  if (!parsed) {
    throw new Error(`Archive missing required file: ${archivePath}`);
  }
  return parsed;
};

export const packLedocZip = async (payload: any): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file(LEDOC_PATHS.document, JSON.stringify(payload?.document ?? {}, null, 2));
  zip.file(LEDOC_PATHS.meta, JSON.stringify(payload?.meta ?? {}, null, 2));
  if (payload?.settings) {
    zip.file(LEDOC_PATHS.settings, JSON.stringify(payload.settings, null, 2));
  }
  if (payload?.footnotes) {
    zip.file(LEDOC_PATHS.footnotes, JSON.stringify(payload.footnotes, null, 2));
  }
  if (payload?.styles !== undefined) {
    zip.file(LEDOC_PATHS.styles, JSON.stringify(payload.styles, null, 2));
  }
  if (payload?.history !== undefined) {
    zip.file(LEDOC_PATHS.history, JSON.stringify(payload.history, null, 2));
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer as Buffer;
};

export const unpackLedocZip = async (
  buffer: Buffer
): Promise<{
  payload: {
    document: object;
    meta: Record<string, unknown>;
    settings?: Record<string, unknown>;
    footnotes?: Record<string, unknown>;
    styles?: unknown;
    history?: unknown;
  };
  warnings: string[];
}> => {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(buffer);

  const document = await requireJsonObject(zip, LEDOC_PATHS.document, "document.json");
  const meta = await requireJsonObject(zip, LEDOC_PATHS.meta, "meta.json");

  const settings = await readJsonObjectOptional(zip, LEDOC_PATHS.settings, "settings.json");
  if (!settings) warnings.push("settings.json missing; using editor defaults.");

  const footnotes = await readJsonObjectOptional(zip, LEDOC_PATHS.footnotes, "footnotes.json");
  if (!footnotes) warnings.push("footnotes.json missing; loaded content only.");

  const styles = await readJsonAnyOptional(zip, LEDOC_PATHS.styles, "styles.json");
  if (styles == null) warnings.push("styles.json missing; using default styles.");

  const history = await readJsonAnyOptional(zip, LEDOC_PATHS.history, "history.json");
  if (history == null) warnings.push("history.json missing; no persisted session metadata.");

  return {
    payload: {
      document,
      meta,
      settings: settings ?? undefined,
      footnotes: footnotes ?? undefined,
      styles: styles ?? undefined,
      history: history ?? undefined
    },
    warnings
  };
};
