import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

type LedocVersionReason = "autosave" | "save" | "manual" | "restore" | "open";

export type LedocVersionEntry = {
  id: string;
  ts: string; // ISO
  reason: LedocVersionReason | string;
  label?: string;
  note?: string;
  pinned?: boolean;
  sizeBytes?: number;
  contentHash?: string;
  layoutHash?: string;
  registryHash?: string;
};

export type LedocVersionsIndex = {
  formatVersion: "1";
  createdAt: string;
  updatedAt: string;
  lastAutoVersionAt?: string;
  retention?: {
    maxEntries?: number;
    maxBytes?: number;
    keepHourly?: number;
    keepDaily?: number;
    keepRecent?: number;
  };
  entries: LedocVersionEntry[];
};

const LEDOC_BUNDLE_VERSION = "2.0";
const BUNDLE_FILES = {
  version: "version.txt",
  content: "content.json",
  layout: "layout.json",
  registry: "registry.json",
  meta: "meta.json",
  mediaDir: "media"
} as const;

const VERSIONS_DIR = "versions";
const INDEX_FILE = "index.json";
const BLOBS_DIR = "blobs";

const normalizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const atomicWriteFile = async (filePath: string, data: string | Buffer) => {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, filePath);
};

const sha256 = (data: string | Buffer): string =>
  crypto.createHash("sha256").update(data).digest("hex");

const readJson = async <T = any>(filePath: string): Promise<T> => {
  const raw = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
};

const writeJsonAtomic = async (filePath: string, value: unknown) => {
  const raw = JSON.stringify(value, null, 2);
  await atomicWriteFile(filePath, `${raw}\n`);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

const isBundlePayload = (value: unknown): value is { version: string; content: object; layout: object; registry: object; meta: object } => {
  if (!isPlainObject(value)) return false;
  if (typeof (value as any).version !== "string") return false;
  if (!isPlainObject((value as any).content)) return false;
  if (!isPlainObject((value as any).layout)) return false;
  if (!isPlainObject((value as any).registry)) return false;
  if (!isPlainObject((value as any).meta)) return false;
  return true;
};

const nowIso = () => new Date().toISOString();

const resolveStorePaths = (bundleDir: string) => {
  const versionsDir = path.join(bundleDir, VERSIONS_DIR);
  const blobsDir = path.join(versionsDir, BLOBS_DIR);
  const indexPath = path.join(versionsDir, INDEX_FILE);
  return { versionsDir, blobsDir, indexPath };
};

const defaultIndex = (): LedocVersionsIndex => {
  const now = nowIso();
  return {
    formatVersion: "1",
    createdAt: now,
    updatedAt: now,
    retention: {
      maxEntries: 250,
      maxBytes: 250 * 1024 * 1024,
      keepHourly: 24,
      keepDaily: 30,
      keepRecent: 50
    },
    entries: []
  };
};

const loadIndex = async (bundleDir: string): Promise<LedocVersionsIndex> => {
  const { indexPath } = resolveStorePaths(bundleDir);
  try {
    const parsed = await readJson<LedocVersionsIndex>(indexPath);
    if (!parsed || parsed.formatVersion !== "1" || !Array.isArray(parsed.entries)) {
      return defaultIndex();
    }
    return parsed;
  } catch {
    return defaultIndex();
  }
};

const saveIndex = async (bundleDir: string, index: LedocVersionsIndex) => {
  const { indexPath } = resolveStorePaths(bundleDir);
  index.updatedAt = nowIso();
  await writeJsonAtomic(indexPath, index);
};

const readBundlePayloadFromDisk = async (bundleDir: string): Promise<any> => {
  const read = async (name: string) => readJson(path.join(bundleDir, name));
  const payload = {
    version: LEDOC_BUNDLE_VERSION,
    content: await read(BUNDLE_FILES.content),
    layout: await read(BUNDLE_FILES.layout),
    registry: await read(BUNDLE_FILES.registry),
    meta: await read(BUNDLE_FILES.meta)
  };
  return payload;
};

const computeHashes = (payload: any) => {
  const contentRaw = JSON.stringify(payload?.content ?? {});
  const layoutRaw = JSON.stringify(payload?.layout ?? {});
  const registryRaw = JSON.stringify(payload?.registry ?? {});
  return {
    contentHash: sha256(contentRaw),
    layoutHash: sha256(layoutRaw),
    registryHash: sha256(registryRaw)
  };
};

const parseIso = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

const pickKeepSet = (entries: LedocVersionEntry[], retention: Required<NonNullable<LedocVersionsIndex["retention"]>>) => {
  const keep = new Set<string>();
  const now = Date.now();
  const hourlyMs = retention.keepHourly * 60 * 60 * 1000;
  const dailyMs = retention.keepDaily * 24 * 60 * 60 * 1000;

  // Always keep most recent N.
  for (const entry of entries.slice(0, Math.max(0, retention.keepRecent))) {
    keep.add(entry.id);
  }

  // Keep pinned.
  for (const entry of entries) {
    if (entry.pinned) keep.add(entry.id);
  }

  // Keep one per hour (most recent in each hour bucket).
  const byHour = new Map<string, LedocVersionEntry>();
  for (const entry of entries) {
    const ts = parseIso(entry.ts);
    if (!ts) continue;
    if (now - ts > hourlyMs) continue;
    const d = new Date(ts);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCHours()}`;
    const prev = byHour.get(key);
    if (!prev || parseIso(prev.ts) < ts) byHour.set(key, entry);
  }
  for (const e of byHour.values()) keep.add(e.id);

  // Keep one per day (most recent in each day bucket).
  const byDay = new Map<string, LedocVersionEntry>();
  for (const entry of entries) {
    const ts = parseIso(entry.ts);
    if (!ts) continue;
    if (now - ts > dailyMs) continue;
    const d = new Date(ts);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
    const prev = byDay.get(key);
    if (!prev || parseIso(prev.ts) < ts) byDay.set(key, entry);
  }
  for (const e of byDay.values()) keep.add(e.id);

  return keep;
};

const enforceRetention = async (bundleDir: string, index: LedocVersionsIndex): Promise<string[]> => {
  const { blobsDir } = resolveStorePaths(bundleDir);
  const retention = {
    maxEntries: index.retention?.maxEntries ?? 250,
    maxBytes: index.retention?.maxBytes ?? 250 * 1024 * 1024,
    keepHourly: index.retention?.keepHourly ?? 24,
    keepDaily: index.retention?.keepDaily ?? 30,
    keepRecent: index.retention?.keepRecent ?? 50
  };
  const keep = pickKeepSet(index.entries, retention);

  const removed: string[] = [];
  const computeTotal = () => index.entries.reduce((sum, e) => sum + (typeof e.sizeBytes === "number" ? e.sizeBytes : 0), 0);
  let totalBytes = computeTotal();

  const shouldDrop = () => index.entries.length > retention.maxEntries || totalBytes > retention.maxBytes;

  const dropOne = async () => {
    const candidate = [...index.entries].reverse().find((e) => !keep.has(e.id));
    if (!candidate) return false;
    const blobPath = path.join(blobsDir, `${candidate.id}.json`);
    try {
      await fs.promises.unlink(blobPath);
    } catch {
      // ignore missing
    }
    const beforeLen = index.entries.length;
    index.entries = index.entries.filter((e) => e.id !== candidate.id);
    if (index.entries.length !== beforeLen) {
      removed.push(candidate.id);
      totalBytes = computeTotal();
    }
    return true;
  };

  while (shouldDrop()) {
    const ok = await dropOne();
    if (!ok) break;
  }
  return removed;
};

const makeId = (tsIso: string): string => {
  const ts = tsIso.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${ts}-${Math.random().toString(36).slice(2, 8)}`;
};

export const listLedocVersions = async (bundleDir: string): Promise<{ success: boolean; index?: LedocVersionsIndex; error?: string }> => {
  try {
    const index = await loadIndex(bundleDir);
    return { success: true, index };
  } catch (error) {
    return { success: false, error: normalizeError(error) };
  }
};

export const createLedocVersion = async (args: {
  bundleDir: string;
  reason: LedocVersionReason | string;
  label?: string;
  note?: string;
  payload?: unknown;
  throttleMs?: number;
  force?: boolean;
}): Promise<{ success: boolean; created?: boolean; entry?: LedocVersionEntry; index?: LedocVersionsIndex; warnings?: string[]; error?: string }> => {
  const warnings: string[] = [];
  try {
    const { bundleDir, reason } = args;
    const { blobsDir } = resolveStorePaths(bundleDir);
    await ensureDir(blobsDir);

    const index = await loadIndex(bundleDir);

    const ts = nowIso();
    const throttleMs = typeof args.throttleMs === "number" ? Math.max(0, args.throttleMs) : 0;
    if (throttleMs > 0 && String(reason) === "autosave") {
      const last = index.lastAutoVersionAt ? parseIso(index.lastAutoVersionAt) : 0;
      if (last && Date.now() - last < throttleMs) {
        return { success: true, created: false, index };
      }
    }

    const payload = isBundlePayload(args.payload) ? (args.payload as any) : await readBundlePayloadFromDisk(bundleDir);
    const hashes = computeHashes(payload);
    const prev = index.entries[0] ?? null;
    const sameAsPrev =
      prev &&
      prev.contentHash === hashes.contentHash &&
      prev.layoutHash === hashes.layoutHash &&
      prev.registryHash === hashes.registryHash;

    const force = Boolean(args.force);
    if (sameAsPrev && !force) {
      if (String(reason) === "autosave") {
        index.lastAutoVersionAt = ts;
        await saveIndex(bundleDir, index);
      }
      return { success: true, created: false, index };
    }

    const id = makeId(ts);
    const blobPath = path.join(blobsDir, `${id}.json`);
    const blobRaw = JSON.stringify(payload, null, 2);
    await atomicWriteFile(blobPath, `${blobRaw}\n`);
    const sizeBytes = Buffer.byteLength(blobRaw, "utf-8");

    const entry: LedocVersionEntry = {
      id,
      ts,
      reason,
      label: args.label?.trim() || undefined,
      note: args.note?.trim() || undefined,
      pinned: false,
      sizeBytes,
      ...hashes
    };

    index.entries.unshift(entry);
    if (String(reason) === "autosave") {
      index.lastAutoVersionAt = ts;
    }
    const removed = await enforceRetention(bundleDir, index);
    if (removed.length) {
      warnings.push(`Retention removed ${removed.length} older version(s).`);
    }
    await saveIndex(bundleDir, index);
    return { success: true, created: true, entry, index, warnings };
  } catch (error) {
    return { success: false, error: normalizeError(error), warnings };
  }
};

const copyDir = async (src: string, dest: string) => {
  await ensureDir(dest);
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(from, to);
    } else if (e.isFile()) {
      await ensureDir(path.dirname(to));
      await fs.promises.copyFile(from, to);
    }
  }
};

const writeBundleFromPayload = async (bundleDir: string, payload: any): Promise<void> => {
  if (!isBundlePayload(payload)) {
    throw new Error("Invalid LEDOC bundle payload");
  }
  await ensureDir(bundleDir);
  await ensureDir(path.join(bundleDir, BUNDLE_FILES.mediaDir));
  await atomicWriteFile(path.join(bundleDir, BUNDLE_FILES.version), `${LEDOC_BUNDLE_VERSION}\n`);
  await writeJsonAtomic(path.join(bundleDir, BUNDLE_FILES.content), payload.content);
  await writeJsonAtomic(path.join(bundleDir, BUNDLE_FILES.layout), payload.layout);
  await writeJsonAtomic(path.join(bundleDir, BUNDLE_FILES.registry), payload.registry);
  await writeJsonAtomic(path.join(bundleDir, BUNDLE_FILES.meta), payload.meta);
};

export const restoreLedocVersion = async (args: {
  bundleDir: string;
  versionId: string;
  mode: "replace" | "copy";
}): Promise<{ success: boolean; filePath?: string; payload?: any; error?: string }> => {
  try {
    const { bundleDir, versionId, mode } = args;
    const { blobsDir } = resolveStorePaths(bundleDir);
    const blobPath = path.join(blobsDir, `${versionId}.json`);
    const payload = await readJson(blobPath);
    if (!isBundlePayload(payload)) {
      return { success: false, error: "Version payload is not a valid LEDOC bundle." };
    }
    const now = nowIso();
    const meta = isPlainObject(payload.meta) ? (payload.meta as any) : {};
    payload.meta = { ...meta, lastModified: now, restoredFromVersionId: versionId };

    if (mode === "copy") {
      const base = bundleDir.replace(/[\\\/]+$/, "");
      const ts = now.replace(/[-:.TZ]/g, "").slice(0, 14);
      const destDir = `${base}-restored-${ts}.ledoc`;
      await writeBundleFromPayload(destDir, payload);
      // Carry media forward so restored versions still show images.
      const mediaSrc = path.join(bundleDir, BUNDLE_FILES.mediaDir);
      const mediaDest = path.join(destDir, BUNDLE_FILES.mediaDir);
      try {
        const st = await fs.promises.stat(mediaSrc);
        if (st.isDirectory()) {
          await copyDir(mediaSrc, mediaDest);
        }
      } catch {
        // ignore
      }
      return { success: true, filePath: destDir, payload };
    }

    // replace in-place; keep media as-is
    await writeBundleFromPayload(bundleDir, payload);
    return { success: true, filePath: bundleDir, payload };
  } catch (error) {
    return { success: false, error: normalizeError(error) };
  }
};

export const deleteLedocVersion = async (args: {
  bundleDir: string;
  versionId: string;
}): Promise<{ success: boolean; index?: LedocVersionsIndex; error?: string }> => {
  try {
    const { bundleDir, versionId } = args;
    const { blobsDir } = resolveStorePaths(bundleDir);
    const blobPath = path.join(blobsDir, `${versionId}.json`);
    try {
      await fs.promises.unlink(blobPath);
    } catch {
      // ignore
    }
    const index = await loadIndex(bundleDir);
    index.entries = index.entries.filter((e) => e.id !== versionId);
    await saveIndex(bundleDir, index);
    return { success: true, index };
  } catch (error) {
    return { success: false, error: normalizeError(error) };
  }
};

export const pinLedocVersion = async (args: {
  bundleDir: string;
  versionId: string;
  pinned: boolean;
}): Promise<{ success: boolean; index?: LedocVersionsIndex; error?: string }> => {
  try {
    const { bundleDir, versionId, pinned } = args;
    const index = await loadIndex(bundleDir);
    for (const e of index.entries) {
      if (e.id === versionId) {
        e.pinned = Boolean(pinned);
      }
    }
    await saveIndex(bundleDir, index);
    return { success: true, index };
  } catch (error) {
    return { success: false, error: normalizeError(error) };
  }
};

