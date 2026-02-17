import fs from "fs";
import path from "path";
import crypto from "crypto";
// better-sqlite3 ships its own types but CJS/ESM interop can be finicky in Electron builds;
// keep this as a runtime require to avoid type/namespace mismatches.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BetterSqlite3 = require("better-sqlite3") as any;

import type {
  AnalyseDatasets,
  AnalyseRun,
  SectionLevel,
  BatchPayload,
  BatchRecord,
  SectionRecord,
  RunMetrics
} from "./types";
import { DEFAULT_COLLECTION_NAME } from "./constants";
import { getSetting } from "../config/settingsFacade";
import { GENERAL_KEYS, ZOTERO_KEYS } from "../config/settingsKeys";
import { getAnalyseRoot } from "../session/sessionPaths";

export const ANALYSE_DIR = getAnalyseRoot();
const ANALYSE_CACHE_DIR = path.join(ANALYSE_DIR, ".cache");
const CACHE_VERSION = "v1";
const MAX_CACHE_SOURCE_BYTES = 120 * 1024 * 1024;
const MAX_CACHE_WRITE_BYTES = 150 * 1024 * 1024;

function normalizeAnalysePath(candidate?: string): string | undefined {
  return candidate;
}

try {
  fs.mkdirSync(ANALYSE_DIR, { recursive: true });
  fs.mkdirSync(ANALYSE_CACHE_DIR, { recursive: true });
} catch {
  // best effort: throw on collision but swallow other fs errors to keep startup predictable.
}

const BATCH_FILE_CANDIDATES = ["pyr_l1_batches.json", "pyr_l1_batches.feather"];

const SECTION_FILE_MAP: Record<SectionLevel, string[]> = {
  r1: ["pyr_l1_sections.json", "pyr_l1_sections.feather"],
  r2: ["pyr_l2_sections.json", "pyr_l2_sections.feather"],
  r3: ["pyr_l3_sections.json", "pyr_l3_sections.feather"],
};

function preferredCollection(): string | null {
  const zotero = getSetting<string>(ZOTERO_KEYS.lastCollection);
  if (typeof zotero === "string" && zotero.trim()) {
    return zotero.trim();
  }
  const general = getSetting<string>(GENERAL_KEYS.collectionName);
  if (typeof general === "string" && general.trim()) {
    return general.trim();
  }
  return null;
}

export function getAnalyseCollectionDir(collection: string): string {
  const target = path.join(ANALYSE_DIR, collection);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

export function getDefaultBaseDir(): string {
  const collection = preferredCollection();
  const name = collection ?? DEFAULT_COLLECTION_NAME;
  return getAnalyseCollectionDir(name);
}

export function normalizeBaseDir(baseDir?: string): string | undefined {
  return normalizeAnalysePath(baseDir);
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function buildCachePath(sourcePath: string, stat: fs.Stats, kind: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${CACHE_VERSION}|${kind}|${sourcePath}|${stat.mtimeMs}|${stat.size}`)
    .digest("hex");
  return path.join(ANALYSE_CACHE_DIR, `${kind}_${hash}.json`);
}

function buildIndexPath(sourcePath: string, stat: fs.Stats, kind: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${CACHE_VERSION}|sqlite|${kind}|${sourcePath}|${stat.mtimeMs}|${stat.size}`)
    .digest("hex");
  return path.join(ANALYSE_CACHE_DIR, `${kind}_${hash}.sqlite`);
}

function readCache<T>(cachePath: string): T | null {
  try {
    const raw = fs.readFileSync(cachePath, { encoding: "utf8" });
    const parsed = JSON.parse(raw) as { version?: string; data?: T };
    if (parsed?.version !== CACHE_VERSION) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

function writeCache(cachePath: string, data: unknown): void {
  try {
    const payload = JSON.stringify({ version: CACHE_VERSION, createdAt: new Date().toISOString(), data });
    if (payload.length > MAX_CACHE_WRITE_BYTES) return;
    fs.writeFileSync(cachePath, payload, { encoding: "utf8" });
  } catch {
    // ignore cache write errors
  }
}

function findFirstExistingFile(dir: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const candidatePath = path.join(dir, candidate);
    if (fileExists(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

function hasAnyFile(dir: string, candidates: string[]): boolean {
  return findFirstExistingFile(dir, candidates) !== null;
}

export function loadDirectQuoteLookup(runPath: string): { data: Record<string, unknown>; path: string | null } {
  if (!runPath) return { data: {}, path: null };
  // prefer thematics_outputs/<runId> if present, then collection-level lookup
  const runDir = path.dirname(runPath);
  const runId = path.basename(runPath);
  const candidates = [
    path.join(runPath, "direct_quote_lookup.json"),
    path.join(runDir, "thematics_outputs", runId, "direct_quote_lookup.json"),
    path.join(runDir, "direct_quote_lookup.json"),
    path.join(path.dirname(runDir), "direct_quote_lookup.json")
  ];
  const target = candidates.find((p) => fileExists(p)) || null;
  if (!target) return { data: {}, path: null };
  let data: Record<string, unknown> | null = null;
  try {
    const raw = fs.readFileSync(target, { encoding: "utf8" });
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn("[analyse][dq_lookup] failed to read", { path: target, err: (err as Error).message });
    return { data: {}, path: target };
  }
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    Object.entries(data).forEach(([k, v]) => {
      out[String(k).trim().toLowerCase()] = v;
    });
    console.info("[analyse][dq_lookup] loaded", { path: target, count: Object.keys(out).length });
    return { data: out, path: target };
  }
  return { data: {}, path: target };
}

function resolveDirectQuoteLookupPath(runPath: string): string | null {
  if (!runPath) return null;
  const runDir = path.dirname(runPath);
  const runId = path.basename(runPath);
  const candidates = [
    path.join(runPath, "direct_quote_lookup.json"),
    path.join(runDir, "thematics_outputs", runId, "direct_quote_lookup.json"),
    path.join(runDir, "direct_quote_lookup.json"),
    path.join(path.dirname(runDir), "direct_quote_lookup.json")
  ];
  return candidates.find((p) => fileExists(p)) || null;
}

const dqLookupCache: Record<string, { data: Record<string, unknown>; mtimeMs: number }> = {};

export function getDirectQuoteEntries(
  runPath: string,
  ids: string[]
): { entries: Record<string, unknown>; path: string | null } {
  const target = resolveDirectQuoteLookupPath(runPath);
  if (!target) return { entries: {}, path: null };

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(target);
  } catch {
    stat = null;
  }

  const mtimeMs = stat?.mtimeMs ?? 0;
  const cached = dqLookupCache[target];
  if (!cached || cached.mtimeMs !== mtimeMs) {
    // Parse once in the worker/main process and serve per-id entries to the renderer.
    // This avoids transferring the whole lookup table over IPC and bloating renderer memory.
    const raw = fs.readFileSync(target, { encoding: "utf8" });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    Object.entries(parsed || {}).forEach(([k, v]) => {
      normalized[String(k).trim().toLowerCase()] = v;
    });
    dqLookupCache[target] = { data: normalized, mtimeMs };
  }

  const out: Record<string, unknown> = {};
  const source = dqLookupCache[target]?.data || {};
  ids
    .map((id) => String(id || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach((id) => {
      const value = source[id];
      if (value !== undefined) out[id] = value;
    });
  return { entries: out, path: target };
}

function readJsonFile<T = unknown>(filePath: string): T | null {
  try {
    const stat = fs.statSync(filePath);
    // Avoid building gigantic strings for very large files; let caller stream instead.
    if (stat.size > 150 * 1024 * 1024) {
      throw new Error("file-too-large");
    }
    const raw = fs.readFileSync(filePath, { encoding: "utf8" });
    return JSON.parse(raw) as T;
  } catch (err) {
    // Swallow size and parser errors; caller can stream.
    return null;
  }
}

function streamJsonArray(filePath: string, maxItems = 20000): Record<string, unknown>[] {
  const fd = fs.openSync(filePath, "r");
  const chunkSize = 4 * 1024 * 1024; // 4MB
  const buffer = Buffer.alloc(chunkSize);
  let buf = "";
  let inString = false;
  let escape = false;
  let depth = 0;
  const out: Record<string, unknown>[] = [];

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (bytesRead === 0) break;
      const chunk = buffer.toString("utf8", 0, bytesRead);
      for (const ch of chunk) {
        if (inString) {
          buf += ch;
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === "\"") {
            inString = false;
          }
          continue;
        }
        if (ch === "\"") {
          inString = true;
          buf += ch;
          continue;
        }
        if (ch === "{") {
          depth += 1;
          buf += ch;
          continue;
        }
        if (ch === "}") {
          depth -= 1;
          buf += ch;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(buf);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                out.push(parsed as Record<string, unknown>);
              }
            } catch {
              /* ignore malformed chunk */
            }
            buf = "";
            if (out.length >= maxItems) {
              return out;
            }
          }
          continue;
        }
        if (depth > 0) {
          buf += ch;
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

function scanJsonArrayObjects(
  filePath: string,
  onObject: (entry: Record<string, unknown>, index: number) => void
): void {
  const fd = fs.openSync(filePath, "r");
  const chunkSize = 4 * 1024 * 1024;
  const buffer = Buffer.alloc(chunkSize);
  let buf = "";
  let inString = false;
  let escape = false;
  let depth = 0;
  let index = 0;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (bytesRead === 0) break;
      const chunk = buffer.toString("utf8", 0, bytesRead);
      for (const ch of chunk) {
        if (inString) {
          buf += ch;
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === "\"") {
            inString = false;
          }
          continue;
        }
        if (ch === "\"") {
          inString = true;
          buf += ch;
          continue;
        }
        if (ch === "{") {
          depth += 1;
          buf += ch;
          continue;
        }
        if (ch === "}") {
          depth -= 1;
          buf += ch;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(buf);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                onObject(parsed as Record<string, unknown>, index);
                index += 1;
              }
            } catch {
              // ignore malformed chunks and continue scanning
            }
            buf = "";
          }
          continue;
        }
        if (depth > 0) {
          buf += ch;
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

function countJsonArrayItems(filePath: string): number {
  let count = 0;
  scanJsonArrayObjects(filePath, () => {
    count += 1;
  });
  return count;
}

function summariseBatchFile(filePath: string): { batchCount: number; payloadCount: number } {
  const groups = new Set<string>();
  let payloadCount = 0;
  scanJsonArrayObjects(filePath, (entry, idx) => {
    payloadCount += 1;
    const rq = safeString(entry.rq_question ?? entry.rq);
    const over = safeString(entry.overarching_theme ?? entry.gold_theme ?? entry.theme ?? entry.potential_theme);
    const key = `${rq}::${over}` || `batch_${idx + 1}`;
    groups.add(key);
  });
  return { batchCount: groups.size, payloadCount };
}

function streamJsonArrayPage(
  filePath: string,
  offset: number,
  limit: number
): { items: Record<string, unknown>[]; hasMore: boolean; nextOffset: number } {
  const safeOffset = Math.max(0, Math.floor(offset || 0));
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit || 10)));
  const fd = fs.openSync(filePath, "r");
  const chunkSize = 4 * 1024 * 1024; // 4MB
  const buffer = Buffer.alloc(chunkSize);
  let buf = "";
  let inString = false;
  let escape = false;
  let depth = 0;
  let index = 0;
  const items: Record<string, unknown>[] = [];
  let hasMore = false;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (bytesRead === 0) break;
      const chunk = buffer.toString("utf8", 0, bytesRead);
      for (const ch of chunk) {
        if (inString) {
          buf += ch;
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === "\"") {
            inString = false;
          }
          continue;
        }
        if (ch === "\"") {
          inString = true;
          buf += ch;
          continue;
        }
        if (ch === "{") {
          depth += 1;
          buf += ch;
          continue;
        }
        if (ch === "}") {
          depth -= 1;
          buf += ch;
          if (depth === 0) {
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(buf);
            } catch {
              parsed = null;
            }
            buf = "";
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              if (index >= safeOffset && items.length < safeLimit) {
                items.push(parsed as Record<string, unknown>);
              } else if (index >= safeOffset && items.length >= safeLimit) {
                hasMore = true;
                return { items, hasMore, nextOffset: safeOffset + items.length };
              }
              index += 1;
            }
          }
          continue;
        }
        if (depth > 0) {
          buf += ch;
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return { items, hasMore: false, nextOffset: safeOffset + items.length };
}

function streamJsonObjects(filePath: string, onObject: (obj: Record<string, unknown>) => void): void {
  const fd = fs.openSync(filePath, "r");
  const chunkSize = 4 * 1024 * 1024;
  const buffer = Buffer.alloc(chunkSize);
  let buf = "";
  let inString = false;
  let escape = false;
  let depth = 0;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (bytesRead === 0) break;
      const chunk = buffer.toString("utf8", 0, bytesRead);
      for (const ch of chunk) {
        if (inString) {
          buf += ch;
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === "\"") {
            inString = false;
          }
          continue;
        }
        if (ch === "\"") {
          inString = true;
          buf += ch;
          continue;
        }
        if (ch === "{") {
          depth += 1;
          buf += ch;
          continue;
        }
        if (ch === "}") {
          depth -= 1;
          buf += ch;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(buf);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                onObject(parsed as Record<string, unknown>);
              }
            } catch {
              // ignore malformed object
            }
            buf = "";
          }
          continue;
        }
        if (depth > 0) {
          buf += ch;
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

type SectionQuery = {
  search?: string;
  tagContains?: string;
  tags?: string[];
  gold?: string[];
  rq?: string[];
  route?: string[];
  evidence?: string[];
  potential?: string[];
};

function includesInsensitive(hay: string, needle: string): boolean {
  if (!needle) return true;
  return hay.toLowerCase().includes(needle.toLowerCase());
}

function stripHtmlFast(html: string): string {
  return (html || "").replace(/<[^>]+>/g, " ");
}

function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function sortTopCounts(counts: Record<string, number>, topN = 10): Record<string, number> {
  const entries = Object.entries(counts)
    .filter(([k]) => k && k.trim())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  const out: Record<string, number> = {};
  entries.forEach(([k, v]) => (out[k] = v));
  return out;
}

function incrementCounts(counts: Record<string, number>, values: string[]): void {
  values.forEach((value) => {
    const key = String(value || "").trim();
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function safeString(value: unknown, fallback?: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return fallback ?? "";
}

function safeNumber(value: unknown, fallback?: number): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

type SectionsIndex = {
  db: any;
  dbPath: string;
};

const sectionsIndexCache = new Map<string, SectionsIndex>();

function ensureSectionsIndex(datasetPath: string, stat: fs.Stats, level: SectionLevel): SectionsIndex {
  const dbPath = buildIndexPath(datasetPath, stat, `sections_${level}`);
  const existing = sectionsIndexCache.get(dbPath);
  if (existing) return existing;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new BetterSqlite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sections(
      id TEXT PRIMARY KEY,
      title TEXT,
      rq TEXT,
      gold TEXT,
      route TEXT,
      evidence TEXT,
      tags_text TEXT,
      potential_text TEXT,
      search_text TEXT,
      html TEXT,
      meta_json TEXT,
      pdf_path TEXT,
      page INTEGER
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
      id UNINDEXED,
      search_text,
      tags_text,
      potential_text
    );
    CREATE INDEX IF NOT EXISTS idx_sections_rq ON sections(rq);
    CREATE INDEX IF NOT EXISTS idx_sections_gold ON sections(gold);
    CREATE INDEX IF NOT EXISTS idx_sections_route ON sections(route);
    CREATE INDEX IF NOT EXISTS idx_sections_evidence ON sections(evidence);
  `);

  const signature = `${datasetPath}|${stat.mtimeMs}|${stat.size}|${CACHE_VERSION}`;
  const metaKey = `source:${level}`;
  const current = db.prepare("SELECT value FROM meta WHERE key=?").get(metaKey) as { value?: string } | undefined;
  if (current?.value !== signature) {
    db.exec("DELETE FROM sections; DELETE FROM sections_fts; DELETE FROM meta WHERE key LIKE 'source:%';");
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)").run(metaKey, signature);

    const insertSection = db.prepare(`
      INSERT OR REPLACE INTO sections(
        id,title,rq,gold,route,evidence,tags_text,potential_text,search_text,html,meta_json,pdf_path,page
      ) VALUES(
        @id,@title,@rq,@gold,@route,@evidence,@tags_text,@potential_text,@search_text,@html,@meta_json,@pdf_path,@page
      )
    `);
    const insertFts = db.prepare(`
      INSERT INTO sections_fts(id,search_text,tags_text,potential_text)
      VALUES(@id,@search_text,@tags_text,@potential_text)
    `);

    const flush = db.transaction((rows: any[]) => {
      for (const row of rows) {
        insertSection.run(row);
        insertFts.run(row);
      }
    });

    const rows: any[] = [];
    let idx = 0;
    streamJsonObjects(datasetPath, (obj) => {
      const meta = pickMetaFields(asRecord(obj.meta) || {});
      const html = safeString(obj.section_html ?? obj.html);
      const id = safeString(obj.custom_id ?? meta.custom_id ?? `section_${idx + 1}`);
      const rq = safeString(obj.rq ?? meta.rq);
      const gold = safeString(obj.gold_theme ?? meta.gold_theme);
      const route = safeString(obj.route_value ?? meta.route_value ?? meta.route);
      const evidence = safeString(obj.evidence_type ?? meta.evidence_type);
      const potentialTheme = safeString(obj.potential_theme ?? meta.potential_theme);
      const potentialTokens = tokenizePotentialTheme(potentialTheme).map((t) => t.toLowerCase());
      const tags = Array.from(
        new Set([
          ...normalizeTagList(obj.tags ?? obj.tag_cluster ?? meta.tags ?? meta.tag_cluster).map((t) => t.toLowerCase()),
          ...extractTagsFromHtml(html).map((t) => t.toLowerCase()),
        ])
      );
      const title = extractTitleFromHtml(html) || safeString(obj.title ?? meta.title) || id;
      const text = pickFirstString(obj.paraphrase, obj.direct_quote, obj.section_text, obj.text, stripHtmlFast(html)).toLowerCase();
      const searchText = `${title} ${rq} ${gold} ${route} ${evidence} ${tags.join(" ")} ${potentialTokens.join(" ")} ${text}`.trim();
      const pdfPath = safeString((meta as any).pdf_path ?? (meta as any).pdf ?? (obj as any).pdf_path ?? (obj as any).pdf);
      const page = safeNumber((obj as any).page ?? (meta as any).page ?? (meta as any).pdf_page);
      rows.push({
        id,
        title,
        rq,
        gold,
        route,
        evidence,
        tags_text: tags.join(" "),
        potential_text: potentialTokens.join(" "),
        search_text: searchText,
        html,
        meta_json: JSON.stringify(meta),
        pdf_path: pdfPath,
        page: typeof page === "number" ? page : null,
      });
      idx += 1;
      if (rows.length >= 250) {
        flush(rows.splice(0, rows.length));
      }
    });
    if (rows.length) {
      flush(rows.splice(0, rows.length));
    }
  }

  const handle: SectionsIndex = { db, dbPath };
  sectionsIndexCache.set(dbPath, handle);
  return handle;
}

function normalizePayload(raw: unknown, batchId: string, idx: number): BatchPayload {
  if (typeof raw === "string") {
    return { id: `${batchId}:${idx}`, text: raw };
  }
  const obj = asRecord(raw);
  if (!obj) {
    return { id: `${batchId}:${idx}`, text: "" };
  }

  const pageVal = obj.page;
  const payload: BatchPayload = {
    ...obj,
    id: safeString(obj.id ?? `${batchId}:${idx}`),
    text: safeString(obj.text ?? obj.content ?? obj.body ?? ""),
    page: typeof pageVal === "number" ? pageVal : undefined,
  };
  return payload;
}

function extractTitleFromHtml(html: string): string {
  if (!html) return "";
  const headingMatch = html.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/i);
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].replace(/<[^>]+>/g, "").trim();
  }
  const paraMatch = html.match(/<p[^>]*>(.*?)<\/p>/i);
  if (paraMatch && paraMatch[1]) {
    return paraMatch[1].replace(/<[^>]+>/g, "").trim();
  }
  return "";
}

function decodeHtmlEntities(value: string): string {
  if (!value) return "";
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractTagsFromHtml(html: string): string[] {
  if (!html) return [];
  const tags: string[] = [];
  // Handle both single and double quoted attributes, and allow whitespace around '='.
  const regex = /data-tags\s*=\s*(["'])([\s\S]*?)\1/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html))) {
    const raw = decodeHtmlEntities(match[2] || "");
    raw
      .split(/[;|,/]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => tags.push(t));
  }
  return Array.from(new Set(tags));
}

function tokenizePotentialTheme(value: string): string[] {
  if (!value) return [];
  const cleaned = value.replace(/^mixed:\s*/i, "");
  return Array.from(
    new Set(
      cleaned
        .split(/[|,;/]/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
}

function normalizeTagList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    const exploded: string[] = [];
    value.forEach((entry) => {
      if (typeof entry !== "string") return;
      entry
        .split(/[;|,/]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((t) => exploded.push(t));
    });
    return Array.from(
      new Set(
        exploded
          .map((v) => v.trim())
          .filter(Boolean)
      )
    );
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[;|,/]/)
          .map((t) => t.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
}

function pickMetaFields(meta: Record<string, unknown>): Record<string, unknown> {
  const keep = [
    "rq",
    "rq_question",
    "gold_theme",
    "potential_theme",
    "theme",
    "evidence_type",
    "route",
    "route_value",
    "tags",
    "tag_cluster",
    "section_tags",
    "direct_quote_id",
    "dqid",
    "dq_id",
    "custom_id",
    "pdf",
    "pdf_path",
    "pdf_page",
    "page",
    "source",
    "title",
    "url",
    "item_key",
    "tts_cached"
  ];
  const out: Record<string, unknown> = {};
  keep.forEach((key) => {
    if (meta[key] !== undefined) out[key] = meta[key];
  });
  return out;
}

function pickPayloadFields(entry: Record<string, unknown>): Record<string, unknown> {
  const keep = [
    "id",
    "text",
    "paraphrase",
    "direct_quote",
    "section_text",
    "section_html",
    "payload_theme",
    "potential_theme",
    "overarching_theme",
    "gold_theme",
    "theme",
    "rq_question",
    "rq",
    "evidence_type",
    "evidence_type_norm",
    "route",
    "route_value",
    "tags",
    "tag_cluster",
    "section_tags",
    "researcher_comment",
    "first_author_last",
    "author_summary",
    "author",
    "year",
    "source",
    "title",
    "url",
    "item_key",
    "direct_quote_id",
    "custom_id",
    "pdf",
    "pdf_path",
    "pdf_page",
    "page",
  ];
  const out: Record<string, unknown> = {};
  keep.forEach((key) => {
    if (entry[key] !== undefined) out[key] = entry[key];
  });
  const meta = asRecord(entry.meta) || {};
  const trimmedMeta = pickMetaFields(meta);
  if (Object.keys(trimmedMeta).length) {
    out.meta = trimmedMeta;
  }
  return out;
}

export function resolveSectionsRoot(baseDir?: string): string | null {
  const normalized = normalizeBaseDir(baseDir);
  const candidateBase = normalized ? path.resolve(normalized) : getDefaultBaseDir();

  const checkDir = (dir: string): string | null => {
    const candidates = [
      path.join(dir, "thematics_outputs", "sections"),
      path.join(dir, "sections"),
      dir,
    ];
    for (const candidate of candidates) {
      if (fileExists(candidate) && isDirectory(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  const direct = checkDir(candidateBase);
  if (direct) {
    console.info("[analyse][sectionsRoot]", { baseDir, resolved: direct, mode: "direct" });
    return direct;
  }

  // Look one level down for collections that contain thematics_outputs/sections
  try {
    const children = fs.readdirSync(candidateBase, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const child of children) {
      const resolved = checkDir(path.join(candidateBase, child.name));
      if (resolved) {
        console.info("[analyse][sectionsRoot]", {
          baseDir,
          resolved,
          mode: "child",
          collection: child.name,
        });
        return resolved;
      }
    }
  } catch (err) {
    console.info("[analyse][sectionsRoot][scan-failed]", { baseDir, error: String(err) });
  }

  console.info("[analyse][sectionsRoot][fallback-none]", { baseDir, candidateBase });
  return null;
}

export function discoverRuns(baseDir?: string): { runs: AnalyseRun[]; sectionsRoot: string | null } {
  const sectionsRoot = resolveSectionsRoot(baseDir);
  if (!sectionsRoot) {
    console.info("[analyse][discoverRuns] no sectionsRoot", { baseDir });
    return { runs: [], sectionsRoot: null };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sectionsRoot, { withFileTypes: true });
  } catch {
    console.info("[analyse][discoverRuns] readdir failed", { sectionsRoot });
    return { runs: [], sectionsRoot };
  }

  const runs: AnalyseRun[] = [];
  entries.forEach((entry) => {
    if (!entry.isDirectory()) {
      return;
    }
    const runPath = path.join(sectionsRoot, entry.name);
    const hasBatches = hasAnyFile(runPath, BATCH_FILE_CANDIDATES);
    const hasSections = hasAnyFile(runPath, SECTION_FILE_MAP.r1);
    const hasL2 = hasAnyFile(runPath, SECTION_FILE_MAP.r2);
    const hasL3 = hasAnyFile(runPath, SECTION_FILE_MAP.r3);

    if (!(hasBatches || hasSections || hasL2 || hasL3)) {
      return;
    }

    runs.push({
      id: entry.name,
      label: entry.name,
      path: runPath,
      hasBatches,
      hasSections,
      hasL2,
      hasL3,
    });
  });

  console.info("[analyse][discoverRuns]", {
    sectionsRoot,
    count: runs.length,
    runIds: runs.map((r) => r.id),
  });

  return { runs, sectionsRoot };
}

export function buildDatasetHandles(runPath: string): AnalyseDatasets {
  const datasets: AnalyseDatasets = {};
  if (!runPath) {
    console.info("[analyse][datasets] empty runPath");
    return datasets;
  }
  const batches = findFirstExistingFile(runPath, BATCH_FILE_CANDIDATES);
  if (batches) {
    datasets.batches = batches;
  }
  const sectionsR1 = findFirstExistingFile(runPath, SECTION_FILE_MAP.r1);
  if (sectionsR1) {
    datasets.sectionsR1 = sectionsR1;
  }
  const sectionsR2 = findFirstExistingFile(runPath, SECTION_FILE_MAP.r2);
  if (sectionsR2) {
    datasets.sectionsR2 = sectionsR2;
  }
  const sectionsR3 = findFirstExistingFile(runPath, SECTION_FILE_MAP.r3);
  if (sectionsR3) {
    datasets.sectionsR3 = sectionsR3;
  }
  console.info("[analyse][datasets]", { runPath, batches, sectionsR1, sectionsR2, sectionsR3 });
  return datasets;
}

export async function loadBatches(runPath: string): Promise<BatchRecord[]> {
  if (!runPath) return [];
  let datasetPath = findFirstExistingFile(runPath, BATCH_FILE_CANDIDATES);
  if (!datasetPath) return [];
  console.info("[analyse][loadBatches]", { runPath, datasetPath });

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(datasetPath);
  } catch {
    stat = null;
  }

  if (stat && stat.size <= MAX_CACHE_SOURCE_BYTES) {
    const cachePath = buildCachePath(datasetPath, stat, "batches");
    const cached = readCache<BatchRecord[]>(cachePath);
    if (cached && Array.isArray(cached)) {
      return cached;
    }
  }

  let raw = readJsonFile<unknown[]>(datasetPath);
  if (!raw || !Array.isArray(raw)) {
    try {
      raw = streamJsonArray(datasetPath, 20000);
    } catch {
      return [];
    }
  }

  const buckets: Record<string, BatchPayload[]> = {};

  const normalisePayload = (entry: Record<string, unknown>, idx: number): BatchPayload => {
    const text = safeString(
      entry.paraphrase ??
        entry.direct_quote ??
        entry.section_text ??
        entry.payload_json ??
        entry.researcher_comment ??
        ""
    );
    const page = safeNumber(entry.page);
    const payload = {
      id: safeString(entry.item_key ?? entry.direct_quote_id ?? `p_${idx + 1}`),
      text,
      page,
      ...pickPayloadFields(entry)
    } as BatchPayload;
    if (!payload.page && page !== undefined) {
      payload.page = page;
    }
    return payload;
  };

  raw.forEach((entry, idx) => {
    const obj = asRecord(entry);
    if (!obj) return;
    const rq = safeString(obj.rq_question ?? obj.rq);
    const over = safeString(obj.overarching_theme ?? obj.gold_theme ?? obj.theme ?? obj.potential_theme);
    const key = `${rq}::${over}` || `batch_${idx + 1}`;
    if (!buckets[key]) {
      buckets[key] = [];
    }
    buckets[key].push(normalisePayload(obj, buckets[key].length));
  });

  let batchIndex = 1;
  const result = Object.entries(buckets).map(([key, payloads]) => {
    const [rq, over] = key.split("::");
    return {
      id: safeString(key || `batch_${batchIndex++}`),
      theme: safeString(over),
      potentialTheme: safeString(over),
      evidenceType: safeString(payloads[0]?.evidence_type ?? payloads[0]?.evidence_type_norm),
      size: payloads.length,
      payloads,
      prompt: "",
      rqQuestion: safeString(rq)
    };
  });
  if (stat && stat.size <= MAX_CACHE_SOURCE_BYTES) {
    const cachePath = buildCachePath(datasetPath, stat, "batches");
    writeCache(cachePath, result);
  }
  return result;
}

export async function loadSections(runPath: string, level: SectionLevel): Promise<SectionRecord[]> {
  if (!runPath) return [];
  if (level === "r1") {
    const batchPath = findFirstExistingFile(runPath, BATCH_FILE_CANDIDATES);
    if (batchPath) {
      console.info("[analyse][loadSections][r1-batches]", { runPath, batchPath });
      const batches = await loadBatches(runPath);
      if (!batches.length) return [];
      const derived: SectionRecord[] = [];
      const yieldEvery = 500;
      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        const batch = batches[bIdx];
        for (let pIdx = 0; pIdx < batch.payloads.length; pIdx++) {
          const p = batch.payloads[pIdx] as Record<string, unknown>;
          const meta = pickMetaFields(asRecord(p.meta) || {});
          const rq = safeString(p.rq_question ?? p.rq ?? meta.rq);
          const gold = safeString(p.overarching_theme ?? p.gold_theme ?? p.payload_theme ?? p.theme ?? meta.gold_theme);
          const ev = safeString(p.evidence_type ?? p.evidence_type_norm ?? meta.evidence_type);
          const routeVal = safeString(p.route_value ?? p.route ?? meta.route_value ?? meta.route ?? gold);
          const potentialTheme = safeString(p.potential_theme ?? meta.potential_theme);
          const potentialTokens = tokenizePotentialTheme(potentialTheme);
          const html = safeString(p.section_html ?? p.section_text) || `<p>${safeString(p.paraphrase ?? p.direct_quote ?? "")}</p>`;
          const customId = safeString(p.direct_quote_id ?? p.custom_id ?? meta.custom_id ?? `${bIdx}_${pIdx}`);
          const title =
            safeString(p.section_title) ||
            extractTitleFromHtml(html) ||
            safeString(p.potential_theme ?? p.theme ?? p.payload_theme) ||
            safeString(p.rq_question ?? p.rq) ||
            customId;
          const tags = Array.from(
            new Set([
              ...normalizeTagList(p.tags ?? p.tag_cluster ?? p.section_tags ?? meta.tags ?? meta.tag_cluster ?? meta.section_tags),
              ...extractTagsFromHtml(html),
            ])
          );
          derived.push({
            id: customId || `r1_payload_${bIdx}_${pIdx}`,
            html,
            meta: {
              ...meta,
              rq,
              gold_theme: gold,
              evidence_type: ev,
              route: routeVal,
              route_value: routeVal,
              potential_theme: potentialTheme,
              tags,
            },
            route: routeVal || undefined,
            routeValue: routeVal || undefined,
            title: title || customId,
            rq: rq || undefined,
            goldTheme: gold || undefined,
            evidenceType: ev || undefined,
            potentialTheme: potentialTheme || undefined,
            potentialTokens: potentialTokens.length ? potentialTokens : undefined,
            tags,
            paraphrase: safeString(p.paraphrase ?? meta.paraphrase) || undefined,
            directQuote: safeString(p.direct_quote ?? meta.direct_quote) || undefined,
            researcherComment: safeString(p.researcher_comment ?? meta.researcher_comment) || undefined,
            firstAuthorLast: safeString(p.first_author_last ?? meta.first_author_last) || undefined,
            authorSummary: safeString(p.author_summary ?? meta.author_summary) || undefined,
            author: safeString(p.author ?? meta.author) || undefined,
            year: safeString(p.year ?? meta.year) || undefined,
            source: safeString(p.source ?? meta.source) || undefined,
            titleText: safeString(p.title ?? meta.title) || undefined,
            url: safeString(p.url ?? meta.url) || undefined,
            itemKey: safeString(p.item_key ?? meta.item_key) || undefined,
            page: safeNumber(p.page ?? meta.page),
          });
          if (derived.length % yieldEvery === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        }
      }
      console.info("[analyse][loadSections][r1-batches][built]", { runPath, count: derived.length });
      return derived;
    }
  }

  let datasetPath = findFirstExistingFile(runPath, SECTION_FILE_MAP[level]);
  if (!datasetPath) {
    console.warn("[analyse][loadSections] no sections file found", { runPath, level });
    return [];
  }
  console.info("[analyse][loadSections]", { runPath, level, datasetPath });

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(datasetPath);
  } catch {
    stat = null;
  }

  if (stat && stat.size <= MAX_CACHE_SOURCE_BYTES) {
    const cachePath = buildCachePath(datasetPath, stat, `sections_${level}`);
    const cached = readCache<SectionRecord[]>(cachePath);
    if (cached && Array.isArray(cached)) {
      return cached;
    }
  }

  const raw = readJsonFile<unknown[]>(datasetPath);
  if (!raw || !Array.isArray(raw)) return [];

  const result = raw.reduce<SectionRecord[]>((acc, entry, entryIdx) => {
    const obj = asRecord(entry);
    if (!obj) {
      return acc;
    }
    let meta = pickMetaFields(asRecord(obj.meta) || {});
    if (!Object.keys(meta).length && typeof obj.meta_json === "string") {
      try {
        const parsed = JSON.parse(obj.meta_json);
        const parsedMeta = asRecord(parsed);
        if (parsedMeta) {
          meta = pickMetaFields(parsedMeta);
        }
      } catch {
        // ignore invalid JSON
      }
    }
    const html = safeString(obj.section_html ?? obj.html);
    const customId = safeString(obj.custom_id ?? meta.custom_id ?? `section_${entryIdx + 1}`);
    const routeValue = safeString(obj.route_value ?? meta.route_value ?? meta.route);
    const rq = safeString(obj.rq ?? meta.rq);
    const gold = safeString(obj.gold_theme ?? meta.gold_theme);
    const ev = safeString(obj.evidence_type ?? meta.evidence_type);
    const potentialTheme = safeString(obj.potential_theme ?? meta.potential_theme);
    const potentialTokens = tokenizePotentialTheme(potentialTheme);
    const tags = Array.from(
      new Set([
        ...normalizeTagList(obj.tags ?? obj.tag_cluster ?? meta.tags ?? meta.tag_cluster),
        ...extractTagsFromHtml(html),
      ])
    );
    const title = extractTitleFromHtml(html) || safeString(obj.title ?? meta.title) || customId;
    acc.push({
      id: customId,
      html,
      meta,
      route: routeValue || undefined,
      routeValue: routeValue || undefined,
      title,
      rq: rq || undefined,
      goldTheme: gold || undefined,
      evidenceType: ev || undefined,
      potentialTheme: potentialTheme || undefined,
      potentialTokens: potentialTokens.length ? potentialTokens : undefined,
      tags,
      paraphrase: safeString(obj.paraphrase ?? meta.paraphrase) || undefined,
      directQuote: safeString(obj.direct_quote ?? meta.direct_quote) || undefined,
      researcherComment: safeString(obj.researcher_comment ?? meta.researcher_comment) || undefined,
      firstAuthorLast: safeString(obj.first_author_last ?? meta.first_author_last) || undefined,
      authorSummary: safeString(obj.author_summary ?? meta.author_summary) || undefined,
      author: safeString(obj.author ?? meta.author) || undefined,
      year: safeString(obj.year ?? meta.year) || undefined,
      source: safeString(obj.source ?? meta.source) || undefined,
      titleText: safeString(obj.title ?? meta.title) || undefined,
      url: safeString(obj.url ?? meta.url) || undefined,
      itemKey: safeString(obj.item_key ?? meta.item_key) || undefined,
      page: safeNumber(obj.page ?? meta.page),
    });
    return acc;
  }, []);
  if (stat && stat.size <= MAX_CACHE_SOURCE_BYTES) {
    const cachePath = buildCachePath(datasetPath, stat, `sections_${level}`);
    writeCache(cachePath, result);
  }
  return result;
}

export async function loadSectionsPage(
  runPath: string,
  level: SectionLevel,
  offset: number,
  limit: number
): Promise<{ sections: SectionRecord[]; hasMore: boolean; nextOffset: number }> {
  let datasetPath = findFirstExistingFile(runPath, SECTION_FILE_MAP[level]);
  if (!datasetPath) {
    return { sections: [], hasMore: false, nextOffset: 0 };
  }

  const page = streamJsonArrayPage(datasetPath, offset, limit);
  const sections = page.items.reduce<SectionRecord[]>((acc, entry, entryIdx) => {
    const obj = asRecord(entry);
    if (!obj) {
      return acc;
    }
    let meta = pickMetaFields(asRecord(obj.meta) || {});
    if (!Object.keys(meta).length && typeof obj.meta_json === "string") {
      try {
        const parsed = JSON.parse(obj.meta_json);
        const parsedMeta = asRecord(parsed);
        if (parsedMeta) {
          meta = pickMetaFields(parsedMeta);
        }
      } catch {
        // ignore
      }
    }
    const html = safeString(obj.section_html ?? obj.html);
    const customId = safeString(obj.custom_id ?? meta.custom_id ?? `section_${offset + entryIdx + 1}`);
    const routeValue = safeString(obj.route_value ?? meta.route_value ?? meta.route);
    const rq = safeString(obj.rq ?? meta.rq);
    const gold = safeString(obj.gold_theme ?? meta.gold_theme);
    const ev = safeString(obj.evidence_type ?? meta.evidence_type);
    const potentialTheme = safeString(obj.potential_theme ?? meta.potential_theme);
    const potentialTokens = tokenizePotentialTheme(potentialTheme);
    const tags = Array.from(
      new Set([
        ...normalizeTagList(obj.tags ?? obj.tag_cluster ?? meta.tags ?? meta.tag_cluster),
        ...extractTagsFromHtml(html),
      ])
    );
    const title = extractTitleFromHtml(html) || safeString(obj.title ?? meta.title) || customId;
    acc.push({
      id: customId,
      html,
      meta,
      route: routeValue || undefined,
      routeValue: routeValue || undefined,
      title,
      rq: rq || undefined,
      goldTheme: gold || undefined,
      evidenceType: ev || undefined,
      potentialTheme: potentialTheme || undefined,
      potentialTokens: potentialTokens.length ? potentialTokens : undefined,
      tags,
      paraphrase: safeString(obj.paraphrase ?? meta.paraphrase) || undefined,
      directQuote: safeString(obj.direct_quote ?? meta.direct_quote) || undefined,
      researcherComment: safeString(obj.researcher_comment ?? meta.researcher_comment) || undefined,
      firstAuthorLast: safeString(obj.first_author_last ?? meta.first_author_last) || undefined,
      authorSummary: safeString(obj.author_summary ?? meta.author_summary) || undefined,
      author: safeString(obj.author ?? meta.author) || undefined,
      year: safeString(obj.year ?? meta.year) || undefined,
      source: safeString(obj.source ?? meta.source) || undefined,
      titleText: safeString(obj.title ?? meta.title) || undefined,
      url: safeString(obj.url ?? meta.url) || undefined,
      itemKey: safeString(obj.item_key ?? meta.item_key) || undefined,
      page: safeNumber(obj.page ?? meta.page),
    });
    return acc;
  }, []);

  return { sections, hasMore: page.hasMore, nextOffset: page.nextOffset };
}

export async function querySections(
  runPath: string,
  level: SectionLevel,
  query: SectionQuery,
  offset: number,
  limit: number
): Promise<{
  sections: SectionRecord[];
  totalMatches: number;
  hasMore: boolean;
  nextOffset: number;
  facets: Record<string, Record<string, number>>;
}> {
  // UI shows top 10 by default but the facet inventory must represent the whole dataset
  // (expand modal relies on us returning the full set, not just page-local values).
  const FACET_RETURN_LIMIT = 200;

  let datasetPath = findFirstExistingFile(runPath, SECTION_FILE_MAP[level]);
  if (!datasetPath) {
    return { sections: [], totalMatches: 0, hasMore: false, nextOffset: 0, facets: {} };
  }

  // Fast path: use on-disk SQLite index (built once) to avoid rescanning gigabyte-scale JSON for every query/page.
  try {
    const stat = fs.statSync(datasetPath);
    const { db } = ensureSectionsIndex(datasetPath, stat, level);
    const safeOffset = Math.max(0, Math.floor(offset || 0));
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit || 10)));

    const where: string[] = [];
    const params: any[] = [];
    const joinFts = Boolean(String(query?.search || "").trim());
    if (joinFts) {
      where.push("sections_fts MATCH ?");
      params.push(String(query?.search || "").trim().toLowerCase());
    }
    const tagContains = String(query?.tagContains || "").trim().toLowerCase();
    if (tagContains) {
      where.push("sections.tags_text LIKE ?");
      params.push(`%${tagContains}%`);
    }
    const addIn = (col: string, values?: string[]) => {
      const list = (values || []).map((v) => String(v || "").trim()).filter(Boolean);
      if (!list.length) return;
      where.push(`${col} IN (${list.map(() => "?").join(",")})`);
      list.forEach((v) => params.push(v));
    };
    addIn("sections.rq", query?.rq);
    addIn("sections.gold", query?.gold);
    addIn("sections.route", query?.route);
    addIn("sections.evidence", query?.evidence);

    const addAnyLike = (col: string, values?: string[]) => {
      const list = (values || []).map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
      if (!list.length) return;
      where.push(`(${list.map(() => `${col} LIKE ?`).join(" OR ")})`);
      list.forEach((v) => params.push(`%${v}%`));
    };
    addAnyLike("sections.tags_text", query?.tags);
    addAnyLike("sections.potential_text", query?.potential);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const fromSql = joinFts
      ? "FROM sections JOIN sections_fts ON sections_fts.id = sections.id"
      : "FROM sections";

    const countRow = db.prepare(`SELECT COUNT(*) as count ${fromSql} ${whereSql}`).get(...params) as { count: number } | undefined;
    const totalMatches = countRow?.count ?? 0;

    const rows = db
      .prepare(
        `SELECT sections.id, sections.title, sections.rq, sections.gold, sections.route, sections.evidence, sections.tags_text, sections.potential_text, sections.html, sections.meta_json, sections.pdf_path, sections.page
         ${fromSql} ${whereSql}
         LIMIT ? OFFSET ?`
      )
      .all(...params, safeLimit, safeOffset) as any[];

    const sections: SectionRecord[] = rows.map((row) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : {};
      } catch {
        meta = {};
      }
      const tags = String(row.tags_text || "").split(/\s+/).filter(Boolean);
      const potentialTokens = String(row.potential_text || "").split(/\s+/).filter(Boolean);
      return {
        id: String(row.id || ""),
        title: String(row.title || ""),
        rq: String(row.rq || "") || undefined,
        goldTheme: String(row.gold || "") || undefined,
        route: String(row.route || "") || undefined,
        routeValue: String(row.route || "") || undefined,
        evidenceType: String(row.evidence || "") || undefined,
        tags,
        potentialTokens: potentialTokens.length ? potentialTokens : undefined,
        html: String(row.html || ""),
        meta: {
          ...meta,
          pdf_path: row.pdf_path || (meta as any).pdf_path,
          pdf_page: row.page ?? (meta as any).pdf_page
        },
        page: typeof row.page === "number" ? row.page : undefined
      };
    });

    const hasMore = safeOffset + sections.length < totalMatches;

    // Facets must reflect the full filtered match-set, not just the current page.
    // Compute structured facets via GROUP BY and token facets from a bounded sample.
    const rqCounts: Record<string, number> = {};
    const goldCounts: Record<string, number> = {};
    const routeCounts: Record<string, number> = {};
    const evCounts: Record<string, number> = {};
    const tagsCounts: Record<string, number> = {};
    const potCounts: Record<string, number> = {};

    try {
      const facetLimit = FACET_RETURN_LIMIT;
      const sampleLimit = Math.min(4000, Math.max(400, totalMatches));
      const readGroup = (col: string, target: Record<string, number>) => {
        const facetRows = db
          .prepare(
            `SELECT ${col} as value, COUNT(*) as count
             ${fromSql} ${whereSql}
             GROUP BY ${col}
             ORDER BY count DESC
             LIMIT ?`
          )
          .all(...params, facetLimit) as Array<{ value: unknown; count: number }>;
        facetRows.forEach((row) => {
          const key = String((row as any)?.value ?? "").trim();
          if (!key) return;
          target[key] = Number((row as any)?.count ?? 0) || 0;
        });
      };

      readGroup("sections.rq", rqCounts);
      readGroup("sections.gold", goldCounts);
      readGroup("sections.route", routeCounts);
      readGroup("sections.evidence", evCounts);

      const tokenRows = db
        .prepare(
          `SELECT sections.tags_text, sections.potential_text
           ${fromSql} ${whereSql}
           LIMIT ?`
        )
        .all(...params, sampleLimit) as Array<{ tags_text?: string; potential_text?: string }>;
      tokenRows.forEach((row) => {
        const tags = String((row as any)?.tags_text || "")
          .split(/\\s+/)
          .map((t) => t.trim())
          .filter(Boolean);
        const pot = String((row as any)?.potential_text || "")
          .split(/\\s+/)
          .map((t) => t.trim())
          .filter(Boolean);
        incrementCounts(tagsCounts, tags.slice(0, 60));
        incrementCounts(potCounts, pot.slice(0, 60));
      });
    } catch (err) {
      // Fallback: keep the UI working even if facet aggregation fails.
      sections.forEach((s) => {
        if (s.rq) incrementCounts(rqCounts, [s.rq]);
        if (s.goldTheme) incrementCounts(goldCounts, [s.goldTheme]);
        if (s.route) incrementCounts(routeCounts, [s.route]);
        if (s.evidenceType) incrementCounts(evCounts, [s.evidenceType]);
        incrementCounts(tagsCounts, (s.tags || []).slice(0, 30));
        incrementCounts(potCounts, ((s.potentialTokens as string[] | undefined) || []).slice(0, 30));
      });
      console.warn("[analyse][querySections][facets-fallback]", err);
    }

    return {
      sections,
      totalMatches,
      hasMore,
      nextOffset: safeOffset + sections.length,
      facets: {
        tags: sortTopCounts(tagsCounts, FACET_RETURN_LIMIT),
        rq: sortTopCounts(rqCounts, FACET_RETURN_LIMIT),
        gold: sortTopCounts(goldCounts, FACET_RETURN_LIMIT),
        route: sortTopCounts(routeCounts, FACET_RETURN_LIMIT),
        evidence: sortTopCounts(evCounts, FACET_RETURN_LIMIT),
        potential: sortTopCounts(potCounts, FACET_RETURN_LIMIT)
      }
    };
  } catch (error) {
    console.warn("[analyse][querySections][sqlite-fallback]", error);
  }

  const safeOffset = Math.max(0, Math.floor(offset || 0));
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit || 10)));
  const search = String(query?.search || "").trim().toLowerCase();
  const tagContains = String(query?.tagContains || "").trim().toLowerCase();
  const selectedTags = new Set((query?.tags || []).map((t) => String(t).trim()).filter(Boolean));
  const selectedGold = new Set((query?.gold || []).map((t) => String(t).trim()).filter(Boolean));
  const selectedRq = new Set((query?.rq || []).map((t) => String(t).trim()).filter(Boolean));
  const selectedRoute = new Set((query?.route || []).map((t) => String(t).trim()).filter(Boolean));
  const selectedEvidence = new Set((query?.evidence || []).map((t) => String(t).trim()).filter(Boolean));
  const selectedPotential = new Set((query?.potential || []).map((t) => String(t).trim()).filter(Boolean));

  const facets = {
    tags: {} as Record<string, number>,
    gold: {} as Record<string, number>,
    rq: {} as Record<string, number>,
    route: {} as Record<string, number>,
    evidence: {} as Record<string, number>,
    potential: {} as Record<string, number>,
  };

  const fd = fs.openSync(datasetPath, "r");
  const chunkSize = 4 * 1024 * 1024;
  const buffer = Buffer.alloc(chunkSize);
  let buf = "";
  let inString = false;
  let escape = false;
  let depth = 0;

  const pageSections: SectionRecord[] = [];
  let matchIndex = 0;
  let totalMatches = 0;
  let hasMore = false;

  const matchesRecord = (section: SectionRecord, derived: { rq: string; gold: string; route: string; evidence: string; tags: string[]; potential: string[]; text: string }) => {
    if (selectedRq.size && !selectedRq.has(derived.rq)) return false;
    if (selectedGold.size && !selectedGold.has(derived.gold)) return false;
    if (selectedRoute.size && !selectedRoute.has(derived.route)) return false;
    if (selectedEvidence.size && !selectedEvidence.has(derived.evidence)) return false;
    if (selectedPotential.size && !derived.potential.some((t) => selectedPotential.has(t))) return false;
    if (selectedTags.size && !derived.tags.some((t) => selectedTags.has(t))) return false;
    if (tagContains && !derived.tags.some((t) => t.toLowerCase().includes(tagContains))) return false;
    if (search) {
      const hay = `${derived.rq} ${derived.gold} ${derived.route} ${derived.evidence} ${derived.tags.join(" ")} ${derived.text}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  };

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (bytesRead === 0) break;
      const chunk = buffer.toString("utf8", 0, bytesRead);
      for (const ch of chunk) {
        if (inString) {
          buf += ch;
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === "\"") {
            inString = false;
          }
          continue;
        }
        if (ch === "\"") {
          inString = true;
          buf += ch;
          continue;
        }
        if (ch === "{") {
          depth += 1;
          buf += ch;
          continue;
        }
        if (ch === "}") {
          depth -= 1;
          buf += ch;
          if (depth === 0) {
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(buf);
            } catch {
              parsed = null;
            }
            buf = "";
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              const obj = parsed as Record<string, unknown>;
              let meta = pickMetaFields(asRecord(obj.meta) || {});
              if (!Object.keys(meta).length && typeof obj.meta_json === "string") {
                try {
                  const parsedMeta = JSON.parse(obj.meta_json);
                  const record = asRecord(parsedMeta);
                  if (record) meta = pickMetaFields(record);
                } catch {
                  // ignore
                }
              }
              const html = safeString(obj.section_html ?? obj.html);
              const customId = safeString(obj.custom_id ?? meta.custom_id ?? `section_${matchIndex + 1}`);
              const rq = safeString(obj.rq ?? meta.rq);
              const gold = safeString(obj.gold_theme ?? meta.gold_theme);
              const route = safeString(obj.route_value ?? meta.route_value ?? meta.route);
              const evidence = safeString(obj.evidence_type ?? meta.evidence_type);
              const potentialTheme = safeString(obj.potential_theme ?? meta.potential_theme);
              const potentialTokens = tokenizePotentialTheme(potentialTheme);
              const tags = Array.from(
                new Set([
                  ...normalizeTagList(obj.tags ?? obj.tag_cluster ?? meta.tags ?? meta.tag_cluster),
                  ...extractTagsFromHtml(html),
                ])
              );
              const title = extractTitleFromHtml(html) || safeString(obj.title ?? meta.title) || customId;
              const text = pickFirstString(
                obj.paraphrase,
                obj.direct_quote,
                obj.section_text,
                obj.text,
                stripHtmlFast(html)
              );
              const section: SectionRecord = {
                id: customId,
                html,
                meta,
                route: route || undefined,
                routeValue: route || undefined,
                title,
                rq: rq || undefined,
                goldTheme: gold || undefined,
                evidenceType: evidence || undefined,
                potentialTheme: potentialTheme || undefined,
                potentialTokens: potentialTokens.length ? potentialTokens : undefined,
                tags,
              };
              const derived = {
                rq,
                gold,
                route,
                evidence,
                tags,
                potential: potentialTokens,
                text,
              };
              if (matchesRecord(section, derived)) {
                totalMatches += 1;
                incrementCounts(facets.tags, tags);
                if (rq) incrementCounts(facets.rq, [rq]);
                if (gold) incrementCounts(facets.gold, [gold]);
                if (route) incrementCounts(facets.route, [route]);
                if (evidence) incrementCounts(facets.evidence, [evidence]);
                incrementCounts(facets.potential, potentialTokens);
                if (matchIndex >= safeOffset && pageSections.length < safeLimit) {
                  pageSections.push(section);
                }
                matchIndex += 1;
              }
            }
          }
          continue;
        }
        if (depth > 0) {
          buf += ch;
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  hasMore = safeOffset + pageSections.length < totalMatches;
  return {
    sections: pageSections,
    totalMatches,
    hasMore,
    nextOffset: safeOffset + pageSections.length,
    facets: {
      tags: sortTopCounts(facets.tags, FACET_RETURN_LIMIT),
      rq: sortTopCounts(facets.rq, FACET_RETURN_LIMIT),
      gold: sortTopCounts(facets.gold, FACET_RETURN_LIMIT),
      route: sortTopCounts(facets.route, FACET_RETURN_LIMIT),
      evidence: sortTopCounts(facets.evidence, FACET_RETURN_LIMIT),
      potential: sortTopCounts(facets.potential, FACET_RETURN_LIMIT),
    }
  };
}

export async function loadBatchPayloadsPage(
  runPath: string,
  offset: number,
  limit: number
): Promise<{ payloads: BatchPayload[]; hasMore: boolean; nextOffset: number }> {
  if (!runPath) {
    return { payloads: [], hasMore: false, nextOffset: 0 };
  }
  const datasetPath = findFirstExistingFile(runPath, BATCH_FILE_CANDIDATES);
  if (!datasetPath) {
    return { payloads: [], hasMore: false, nextOffset: 0 };
  }
  const page = streamJsonArrayPage(datasetPath, offset, limit);
  const payloads = page.items.map((entry, idx) => normalizePayload(entry, "batch", offset + idx));
  return { payloads, hasMore: page.hasMore, nextOffset: page.nextOffset };
}

export async function summariseRun(runPath: string): Promise<RunMetrics> {
  if (!runPath) {
    return { batches: 0, sectionsR1: 0, sectionsR2: 0, sectionsR3: 0 };
  }
  console.info("[analyse][summariseRun]", { runPath });
  const datasets = buildDatasetHandles(runPath);

  let batches = 0;
  let fallbackR1Count = 0;
  if (datasets.batches) {
    try {
      const summary = summariseBatchFile(datasets.batches);
      batches = summary.batchCount;
      fallbackR1Count = summary.payloadCount;
    } catch (error) {
      console.warn("[analyse][summariseRun][batches-count-failed]", { runPath, error: String(error) });
    }
  }

  const s1 = (() => {
    if (datasets.sectionsR1) {
      try {
        return countJsonArrayItems(datasets.sectionsR1);
      } catch (error) {
        console.warn("[analyse][summariseRun][r1-count-failed]", { runPath, error: String(error) });
        return 0;
      }
    }
    return fallbackR1Count;
  })();

  const s2 = (() => {
    if (!datasets.sectionsR2) return 0;
    try {
      return countJsonArrayItems(datasets.sectionsR2);
    } catch (error) {
      console.warn("[analyse][summariseRun][r2-count-failed]", { runPath, error: String(error) });
      return 0;
    }
  })();

  const s3 = (() => {
    if (!datasets.sectionsR3) return 0;
    try {
      return countJsonArrayItems(datasets.sectionsR3);
    } catch (error) {
      console.warn("[analyse][summariseRun][r3-count-failed]", { runPath, error: String(error) });
      return 0;
    }
  })();

  return {
    batches,
    sectionsR1: s1,
    sectionsR2: s2,
    sectionsR3: s3,
  };
}
