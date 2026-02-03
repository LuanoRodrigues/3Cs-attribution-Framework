import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";

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

// LEDOC v2 (directory bundle)
export const LEDOC_BUNDLE_VERSION = "2.0" as const;
export const LEDOC_BUNDLE_PATHS = {
  version: "version.txt",
  content: "content.json",
  layout: "layout.json",
  registry: "registry.json",
  meta: "meta.json",
  mediaDir: "media"
} as const;

type LedocPayload = {
  document: object;
  meta: Record<string, unknown>;
  settings?: Record<string, unknown>;
  footnotes?: Record<string, unknown>;
  styles?: unknown;
  history?: unknown;
};

type LedocBundlePayload = {
  version: typeof LEDOC_BUNDLE_VERSION;
  content: object;
  layout: Record<string, unknown>;
  registry: Record<string, unknown>;
  meta: Record<string, unknown>;
};

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

const readJsonFile = async (filePath: string): Promise<any> => {
  const raw = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(raw);
};

const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  const raw = JSON.stringify(value, null, 2);
  await fs.promises.writeFile(filePath, raw, "utf-8");
};

export const normalizeLedocToBundle = (
  raw: unknown
): {
  payload: LedocBundlePayload;
  warnings: string[];
} => {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  // Already a bundle payload.
  if (isPlainObject(raw) && (raw as any).version === LEDOC_BUNDLE_VERSION && isPlainObject((raw as any).content)) {
    const content = (raw as any).content as object;
    const metaRaw = isPlainObject((raw as any).meta) ? ((raw as any).meta as any) : {};
    const layoutRaw = isPlainObject((raw as any).layout) ? ((raw as any).layout as any) : {};
    const registryRaw = isPlainObject((raw as any).registry) ? ((raw as any).registry as any) : {};

    const payload: LedocBundlePayload = {
      version: LEDOC_BUNDLE_VERSION,
      content,
      meta: {
        version: LEDOC_BUNDLE_VERSION,
        title: typeof metaRaw.title === "string" ? metaRaw.title : "Untitled document",
        authors: Array.isArray(metaRaw.authors) ? metaRaw.authors.filter((a: any) => typeof a === "string") : [],
        created: typeof metaRaw.created === "string" ? metaRaw.created : now,
        lastModified: typeof metaRaw.lastModified === "string" ? metaRaw.lastModified : now,
        appVersion: typeof metaRaw.appVersion === "string" ? metaRaw.appVersion : undefined,
        sourceFormat: metaRaw.sourceFormat === "zip-v1" ? "zip-v1" : "bundle"
      },
      layout: {
        version: LEDOC_BUNDLE_VERSION,
        pageSize: typeof layoutRaw.pageSize === "string" ? layoutRaw.pageSize : "A4",
        margins: {
          unit: "cm",
          top: typeof layoutRaw?.margins?.top === "number" ? layoutRaw.margins.top : 2.5,
          right: typeof layoutRaw?.margins?.right === "number" ? layoutRaw.margins.right : 2.5,
          bottom: typeof layoutRaw?.margins?.bottom === "number" ? layoutRaw.margins.bottom : 2.5,
          left: typeof layoutRaw?.margins?.left === "number" ? layoutRaw.margins.left : 2.5
        },
        pagination: isPlainObject(layoutRaw.pagination) ? layoutRaw.pagination : undefined,
        footnotes: isPlainObject(layoutRaw.footnotes) ? layoutRaw.footnotes : undefined
      },
      registry: {
        version: LEDOC_BUNDLE_VERSION,
        footnoteIdState: isPlainObject(registryRaw.footnoteIdState) ? registryRaw.footnoteIdState : undefined,
        knownFootnotes: Array.isArray(registryRaw.knownFootnotes) ? registryRaw.knownFootnotes : undefined
      }
    };
    return { payload, warnings };
  }

  // Best-effort conversion from legacy payload shape.
  if (!isPlainObject(raw)) {
    warnings.push("LEDOC payload was not an object; using empty document.");
    return {
      payload: {
        version: LEDOC_BUNDLE_VERSION,
        content: { type: "doc", content: [{ type: "page", content: [{ type: "paragraph" }] }] },
        meta: { version: LEDOC_BUNDLE_VERSION, title: "Untitled document", authors: [], created: now, lastModified: now, sourceFormat: "bundle" },
        layout: { version: LEDOC_BUNDLE_VERSION, pageSize: "A4", margins: { unit: "cm", top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } },
        registry: { version: LEDOC_BUNDLE_VERSION }
      },
      warnings
    };
  }

  const legacy = raw as Partial<LedocPayload> & Record<string, any>;
  const content = isPlainObject(legacy.document) ? (legacy.document as object) : { type: "doc", content: [{ type: "page", content: [{ type: "paragraph" }] }] };
  if (!isPlainObject(legacy.document)) warnings.push("Legacy LEDOC missing document; created empty document.");

  const metaRaw = isPlainObject(legacy.meta) ? (legacy.meta as any) : {};
  const pageSize = typeof legacy.settings?.pageSize === "string" ? legacy.settings.pageSize : "A4";
  const margins = legacy.settings?.margins && typeof legacy.settings.margins === "object" ? (legacy.settings.margins as any) : {};
  const toCm = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const layoutMargins = {
    unit: "cm" as const,
    top: toCm(margins.topCm ?? margins.top_cm ?? margins.topcm) ?? 2.5,
    right: toCm(margins.rightCm ?? margins.right_cm ?? margins.rightcm) ?? 2.5,
    bottom: toCm(margins.bottomCm ?? margins.bottom_cm ?? margins.bottomcm) ?? 2.5,
    left: toCm(margins.leftCm ?? margins.left_cm ?? margins.leftcm) ?? 2.5
  };

  const payload: LedocBundlePayload = {
    version: LEDOC_BUNDLE_VERSION,
    content,
    meta: {
      version: LEDOC_BUNDLE_VERSION,
      title: typeof metaRaw.title === "string" ? metaRaw.title : "Untitled document",
      authors: Array.isArray(metaRaw.authors) ? metaRaw.authors.filter((a: any) => typeof a === "string") : [],
      created: typeof metaRaw.created === "string" ? metaRaw.created : now,
      lastModified: typeof metaRaw.lastModified === "string" ? metaRaw.lastModified : now,
      appVersion: typeof metaRaw.appVersion === "string" ? metaRaw.appVersion : undefined,
      sourceFormat: "zip-v1"
    },
    layout: {
      version: LEDOC_BUNDLE_VERSION,
      pageSize,
      margins: layoutMargins
    },
    registry: {
      version: LEDOC_BUNDLE_VERSION
    }
  };
  return { payload, warnings };
};

export const writeLedocBundle = async (
  bundleDir: string,
  payload: LedocBundlePayload
): Promise<{ warnings: string[] }> => {
  const warnings: string[] = [];
  await fs.promises.mkdir(bundleDir, { recursive: true });
  await fs.promises.mkdir(path.join(bundleDir, LEDOC_BUNDLE_PATHS.mediaDir), { recursive: true });
  await fs.promises.writeFile(path.join(bundleDir, LEDOC_BUNDLE_PATHS.version), `${LEDOC_BUNDLE_VERSION}\n`, "utf-8");
  await writeJsonFile(path.join(bundleDir, LEDOC_BUNDLE_PATHS.content), payload.content);
  await writeJsonFile(path.join(bundleDir, LEDOC_BUNDLE_PATHS.layout), payload.layout);
  await writeJsonFile(path.join(bundleDir, LEDOC_BUNDLE_PATHS.registry), payload.registry);
  await writeJsonFile(path.join(bundleDir, LEDOC_BUNDLE_PATHS.meta), payload.meta);
  return { warnings };
};

export const readLedocBundle = async (
  bundleDir: string
): Promise<{ payload: LedocBundlePayload; warnings: string[] }> => {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  const versionPath = path.join(bundleDir, LEDOC_BUNDLE_PATHS.version);
  try {
    const raw = await fs.promises.readFile(versionPath, "utf-8");
    const v = raw.trim();
    if (v && v !== LEDOC_BUNDLE_VERSION) {
      warnings.push(`Unexpected bundle version "${v}". Attempting to load as ${LEDOC_BUNDLE_VERSION}.`);
    }
  } catch {
    warnings.push("version.txt missing; assuming bundle version 2.0.");
  }

  const content = await readJsonFile(path.join(bundleDir, LEDOC_BUNDLE_PATHS.content)).catch(() => {
    warnings.push("content.json missing; using empty document.");
    return { type: "doc", content: [{ type: "page", content: [{ type: "paragraph" }] }] };
  });
  const meta = await readJsonFile(path.join(bundleDir, LEDOC_BUNDLE_PATHS.meta)).catch(() => {
    warnings.push("meta.json missing; using defaults.");
    return { version: LEDOC_BUNDLE_VERSION, title: "Untitled document", authors: [], created: now, lastModified: now, sourceFormat: "bundle" };
  });
  const layout = await readJsonFile(path.join(bundleDir, LEDOC_BUNDLE_PATHS.layout)).catch(() => {
    warnings.push("layout.json missing; using defaults.");
    return { version: LEDOC_BUNDLE_VERSION, pageSize: "A4", margins: { unit: "cm", top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } };
  });
  const registry = await readJsonFile(path.join(bundleDir, LEDOC_BUNDLE_PATHS.registry)).catch(() => {
    warnings.push("registry.json missing; using defaults.");
    return { version: LEDOC_BUNDLE_VERSION };
  });

  const normalized = normalizeLedocToBundle({ version: LEDOC_BUNDLE_VERSION, content, meta, layout, registry });
  normalized.warnings.unshift(...warnings);
  return normalized;
};
