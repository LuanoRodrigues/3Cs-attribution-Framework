import {
  LEDOC_BUNDLE_VERSION,
  type LedocBundleLayoutFile,
  type LedocBundleMetaFile,
  type LedocBundlePayload,
  type LedocBundleRegistryFile
} from "./format.ts";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

export const isLedocBundlePayload = (value: unknown): value is LedocBundlePayload => {
  if (!isPlainObject(value)) return false;
  if (value.version !== LEDOC_BUNDLE_VERSION) return false;
  if (!isPlainObject((value as any).content)) return false;
  if (!isPlainObject((value as any).meta)) return false;
  if (!isPlainObject((value as any).layout)) return false;
  if (!isPlainObject((value as any).registry)) return false;
  return true;
};

export const normalizeLedocBundlePayload = (
  raw: unknown
): { payload: LedocBundlePayload; warnings: string[] } => {
  const warnings: string[] = [];
  if (!isPlainObject(raw)) {
    throw new Error("LEDOC bundle payload must be an object");
  }
  const version = (raw as any).version;
  if (version !== LEDOC_BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version: ${String(version ?? "") || "unknown"}`);
  }

  const content = isPlainObject((raw as any).content) ? ((raw as any).content as object) : {};
  if (!isPlainObject((raw as any).content)) warnings.push("content missing/invalid; using empty document.");

  const metaRaw = isPlainObject((raw as any).meta) ? ((raw as any).meta as Record<string, unknown>) : {};
  const meta: LedocBundleMetaFile = {
    version: LEDOC_BUNDLE_VERSION,
    title: typeof metaRaw.title === "string" ? metaRaw.title : "Untitled document",
    authors: Array.isArray(metaRaw.authors) ? (metaRaw.authors as unknown[]).filter((a) => typeof a === "string") as string[] : [],
    created: typeof metaRaw.created === "string" ? metaRaw.created : new Date().toISOString(),
    lastModified: typeof metaRaw.lastModified === "string" ? metaRaw.lastModified : new Date().toISOString(),
    appVersion: typeof metaRaw.appVersion === "string" ? metaRaw.appVersion : undefined,
    sourceFormat: metaRaw.sourceFormat === "zip-v1" ? "zip-v1" : "bundle"
  };

  const layoutRaw = isPlainObject((raw as any).layout) ? ((raw as any).layout as Record<string, unknown>) : {};
  const marginsRaw = isPlainObject(layoutRaw.margins) ? (layoutRaw.margins as Record<string, unknown>) : {};
  const layout: LedocBundleLayoutFile = {
    version: LEDOC_BUNDLE_VERSION,
    pageSize: typeof layoutRaw.pageSize === "string" ? layoutRaw.pageSize : "A4",
    margins: {
      unit: "cm",
      top: typeof marginsRaw.top === "number" ? marginsRaw.top : 2.5,
      bottom: typeof marginsRaw.bottom === "number" ? marginsRaw.bottom : 2.5,
      left: typeof marginsRaw.left === "number" ? marginsRaw.left : 2.5,
      right: typeof marginsRaw.right === "number" ? marginsRaw.right : 2.5
    },
    pagination: isPlainObject(layoutRaw.pagination) ? (layoutRaw.pagination as any) : undefined,
    footnotes: isPlainObject(layoutRaw.footnotes) ? (layoutRaw.footnotes as any) : undefined
  };

  const registryRaw = isPlainObject((raw as any).registry) ? ((raw as any).registry as Record<string, unknown>) : {};
  const agentHistory =
    isPlainObject((registryRaw as any).agentHistory)
      ? ((registryRaw as any).agentHistory as any)
      : isPlainObject((registryRaw as any).agent_history)
        ? ((registryRaw as any).agent_history as any)
        : isPlainObject((registryRaw as any).agent)
          ? ((registryRaw as any).agent as any)
          : undefined;
  const llmCache =
    isPlainObject((registryRaw as any).llmCache)
      ? ((registryRaw as any).llmCache as any)
      : isPlainObject((registryRaw as any).llm_cache)
        ? ((registryRaw as any).llm_cache as any)
        : isPlainObject((registryRaw as any)?.cache?.llm)
          ? ((registryRaw as any).cache.llm as any)
          : undefined;
  const registry: LedocBundleRegistryFile = {
    version: LEDOC_BUNDLE_VERSION,
    footnoteIdState: isPlainObject(registryRaw.footnoteIdState) ? (registryRaw.footnoteIdState as any) : undefined,
    knownFootnotes: Array.isArray(registryRaw.knownFootnotes) ? (registryRaw.knownFootnotes as any) : undefined,
    sourceChecksThread: isPlainObject(registryRaw.sourceChecksThread) ? (registryRaw.sourceChecksThread as any) : undefined,
    agentHistory,
    llmCache
  };

  return { payload: { version: LEDOC_BUNDLE_VERSION, content, meta, layout, registry }, warnings };
};
