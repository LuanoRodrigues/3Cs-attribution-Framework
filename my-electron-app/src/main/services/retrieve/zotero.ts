import fs from "fs";
import os from "os";
import path from "path";

import { getSetting } from "../../../config/settingsFacade";
import { getSecretsVault } from "../../../config/secretsVaultInstance";
import { ZOTERO_KEYS } from "../../../config/settingsKeys";
import type { DataHubTable } from "../../../shared/types/dataHub";

type LibraryType = "user" | "group";

export interface ZoteroCredentials {
  libraryId: string;
  libraryType: LibraryType;
  apiKey: string;
}

export interface ZoteroCollection {
  key: string;
  name: string;
  parentKey?: string | null;
}

export interface ZoteroItemPreview {
  key: string;
  title: string;
  authors: string;
  date?: string;
  year?: string;
  itemType?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  publicationTitle?: string;
  tags?: string[];
  collections?: string[];
  attachments?: number;
  pdfs?: number;
  hasPdf?: boolean;
  zoteroSelectUrl?: string;
  firstPdfKey?: string;
  firstPdfTitle?: string;
  firstPdfPath?: string;
  notes?: number;
  annotations?: number;
}

export interface ZoteroCount {
  key: string;
  count: number;
}

const toString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
};

export const resolveZoteroCredentialsTs = (): ZoteroCredentials => {
  const libraryId =
    toString(getSetting<string>(ZOTERO_KEYS.libraryId)) ||
    toString(process.env.ZOTERO_LIBRARY_ID) ||
    toString(process.env.LIBRARY_ID);
  const libraryType =
    (toString(getSetting<string>(ZOTERO_KEYS.libraryType)) as LibraryType | undefined) ||
    (toString(process.env.ZOTERO_LIBRARY_TYPE) as LibraryType | undefined) ||
    (toString(process.env.LIBRARY_TYPE) as LibraryType | undefined) ||
    "user";
  if (!libraryId) throw new Error("Zotero library ID missing (settings or .env ZOTERO_LIBRARY_ID / LIBRARY_ID).");
  let apiKey: string | undefined;
  try {
    apiKey = getSecretsVault().getSecret(ZOTERO_KEYS.apiKey);
  } catch {
    // ignore vault errors; fall back to env
  }
  apiKey = apiKey || toString(process.env.ZOTERO_API_KEY) || toString(process.env.API_KEY) || toString(process.env.ZOTERO_KEY);
  if (!apiKey) throw new Error("Zotero API key missing (settings, secrets, or .env ZOTERO_API_KEY/API_KEY).");
  return { libraryId, libraryType, apiKey };
};

const zoteroBase = (creds: ZoteroCredentials): string => {
  const typePath = creds.libraryType === "group" ? "groups" : "users";
  return `https://api.zotero.org/${typePath}/${encodeURIComponent(creds.libraryId)}`;
};

const zoteroLibraryPrefix = (creds: ZoteroCredentials): string => {
  return creds.libraryType === "group" ? `groups/${creds.libraryId}` : "library";
};

const authHeaders = (creds: ZoteroCredentials): Record<string, string> => ({
  Authorization: `Bearer ${creds.apiKey}`,
  "Zotero-API-Version": "3"
});

const resolveCacheDir = (baseDir?: string): string => {
  return baseDir || path.join(process.cwd(), "data-hub-cache", "zotero");
};

const resolveZoteroStorageBase = (): string => {
  return (
    process.env.ZOTERO_STORAGE ||
    process.env.ZOTERO_STORAGE_BASE ||
    path.join(os.homedir(), "Zotero", "storage")
  );
};

const findLocalPdfPath = (attachmentKey: string, filename?: string): string => {
  const base = resolveZoteroStorageBase();
  const folder = path.join(base, attachmentKey);
  try {
    if (!fs.existsSync(folder)) return "";
    if (filename) {
      const target = path.join(folder, filename);
      if (fs.existsSync(target) && target.toLowerCase().endsWith(".pdf")) return target;
    }
    const entries = fs.readdirSync(folder);
    const pdf = entries.find((f) => f.toLowerCase().endsWith(".pdf"));
    return pdf ? path.join(folder, pdf) : "";
  } catch {
    return "";
  }
};

export const listZoteroCollections = async (creds: ZoteroCredentials): Promise<ZoteroCollection[]> => {
  const all: ZoteroCollection[] = [];
  const limit = 100;
  let start = 0;
  while (true) {
    const url = `${zoteroBase(creds)}/collections?limit=${limit}&start=${start}`;
    const res = await fetch(url, { headers: authHeaders(creds) });
    if (!res.ok) throw new Error(`Collections HTTP ${res.status}`);
    const data = (await res.json()) as Array<{ key: string; data: { name: string; parentCollection?: string } }>;
    (data || []).forEach((c) => {
      all.push({
        key: c.key,
        name: c.data?.name ?? "",
        parentKey: c.data?.parentCollection ?? null
      });
    });
    const total = Number(res.headers.get("Total-Results") || 0);
    if ((data || []).length < limit || start + limit >= total) break;
    start += limit;
  }
  return all;
};

export const listZoteroCollectionsCached = async (
  creds: ZoteroCredentials,
  cacheDir?: string,
  maxAgeMs = 60 * 60 * 1000
): Promise<ZoteroCollection[]> => {
  const root = resolveCacheDir(cacheDir);
  const cachePath = path.join(root, "collections.json");
  if (fs.existsSync(cachePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      const age = Date.now() - Number(raw?.savedAt || 0);
      if (Array.isArray(raw?.collections) && age >= 0 && age < maxAgeMs) {
        if (raw.collections.length >= 10) {
          return raw.collections as ZoteroCollection[];
        }
        // If cached list looks too small, refresh.
      }
    } catch {
      /* ignore stale cache */
    }
  }
  const collections = await listZoteroCollections(creds);
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ savedAt: Date.now(), collections }), "utf-8");
  } catch {
    /* ignore cache write */
  }
  return collections;
};

export const fetchZoteroCollectionItems = async (
  creds: ZoteroCredentials,
  collectionKey: string,
  max: number | undefined,
  cacheDir: string | undefined,
  useCache: boolean
): Promise<{ table: DataHubTable; cached: boolean }> => {
  const cacheRoot = resolveCacheDir(cacheDir);
  const cachePath = path.join(cacheRoot, `${collectionKey}.json`);
  if (useCache && fs.existsSync(cachePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      if (Array.isArray(parsed?.rows) && parsed.rows.length > 0 && Array.isArray(parsed?.columns)) {
        const cols = parsed.columns as string[];
        const needCols = ["pdf_path", "pdf_key", "pdf_exists", "pdf_size"];
        const hasAll = needCols.every((c) => cols.includes(c));
        if (!hasAll) {
          // cache lacks pdf columns; refresh
        } else {
          const idxKey = cols.indexOf("pdf_key");
          const idxPath = cols.indexOf("pdf_path");
          const idxExists = cols.indexOf("pdf_exists");
          const idxSize = cols.indexOf("pdf_size");
          let changed = false;
          parsed.rows.forEach((row: any[]) => {
            const key = String(row[idxKey] || "");
            const existing = String(row[idxPath] || "");
            if (key && !existing) {
              const found = findLocalPdfPath(key, "");
              if (found) {
                row[idxPath] = found;
                try {
                  const stat = fs.statSync(found);
                  row[idxExists] = stat.isFile() ? "true" : "false";
                  row[idxSize] = stat.isFile() ? String(stat.size) : "";
                } catch {
                  row[idxExists] = "false";
                  row[idxSize] = "";
                }
                changed = true;
              }
            }
          });
          if (changed) {
            try {
              fs.writeFileSync(cachePath, JSON.stringify(parsed), "utf-8");
            } catch {
              /* ignore write errors */
            }
          }
          return { table: parsed as DataHubTable, cached: true };
        }
      }
    } catch {
      /* ignore bad cache */
    }
  }

  const limit = 100;
  let start = 0;
  const rows: Array<Array<unknown>> = [];
  const attachmentsByParent = new Map<string, Array<Record<string, unknown>>>();
  const columns = [
    "key",
    "title",
    "authors",
    "date",
    "year",
    "itemType",
    "url",
    "doi",
    "publicationTitle",
    "publisher",
    "abstract",
    "tags",
    "collections",
    "attachments",
    "pdf_url",
    "pdf_key",
    "pdf_path",
    "pdf_mime",
    "pdf_exists",
    "pdf_size"
  ];
  while (true) {
    const url = `${zoteroBase(creds)}/collections/${encodeURIComponent(
      collectionKey
    )}/items?limit=${limit}&start=${start}`;
    const res = await fetch(url, { headers: authHeaders(creds) });
    if (!res.ok) throw new Error(`Items HTTP ${res.status}`);
    const data = (await res.json()) as Array<{ key: string; data: any }>;
    const batch = (data || []).map((item) => {
      const d = item.data || {};
      const itemType = String(d.itemType || "");
      if (itemType === "attachment" && d.parentItem) {
        const parent = String(d.parentItem);
        const att = {
          key: item.key,
          title: d.title || "",
          filename: d.filename || "",
          linkMode: d.linkMode || "",
          url: d.url || "",
          path: d.path || "",
          contentType: d.contentType || ""
        };
        const list = attachmentsByParent.get(parent) || [];
        list.push(att);
        attachmentsByParent.set(parent, list);
        return null;
      }
      const creators = Array.isArray(d.creators)
        ? d.creators
            .map((c: any) => `${c.firstName || ""} ${c.lastName || ""}`.trim())
            .filter(Boolean)
        : [];
      const tags = Array.isArray(d.tags) ? d.tags.map((t: any) => t.tag).filter(Boolean) : [];
      const collections = Array.isArray(d.collections) ? d.collections : [];
      return [
        item.key,
        d.title || "",
        creators.join("; "),
        d.date || "",
        d.date ? String(d.date).slice(0, 4) : "",
        itemType,
        d.url || "",
        d.DOI || "",
        d.publicationTitle || d.source || "",
        d.publisher || "",
        d.abstractNote || "",
        tags.join("; "),
        collections.join("; "),
        "",
        "",
        "",
        "",
        ""
      ];
    });
    rows.push(...(batch.filter(Boolean) as Array<Array<unknown>>));
    start += limit;
    const total = Number(res.headers.get("Total-Results") || 0);
    if (batch.length < limit || (max && rows.length >= max) || start >= total) break;
  }

  // Attachments enrichment for PDFs and files
  rows.forEach((row) => {
    const key = String(row[0]);
    const attachments = attachmentsByParent.get(key) || [];
    if (!attachments.length) return;
    const attTitles = attachments.map((a) => a.title).filter(Boolean).join("; ");
    const pdf = attachments.find((a) => String(a.contentType).toLowerCase().includes("pdf") || String(a.filename).toLowerCase().endsWith(".pdf"));
    const pdfUrl = pdf ? (pdf.url as string) : "";
    const pdfKey = pdf ? (pdf.key as string) : "";
    const pdfPath = pdf ? (pdf.path as string) || findLocalPdfPath(pdfKey, String((pdf as any).filename || "")) : "";
    const pdfMime = pdf ? (pdf.contentType as string) : "";
    let pdfExists = false;
    let pdfSize = "";
    if (pdfPath) {
      try {
        const stat = fs.statSync(pdfPath);
        pdfExists = stat.isFile();
        pdfSize = pdfExists ? String(stat.size) : "";
      } catch {
        pdfExists = false;
      }
    }
    row[columns.indexOf("attachments")] = attTitles;
    row[columns.indexOf("pdf_url")] = pdfUrl;
    row[columns.indexOf("pdf_key")] = pdfKey;
    row[columns.indexOf("pdf_path")] = pdfPath;
    row[columns.indexOf("pdf_mime")] = pdfMime;
    row[columns.indexOf("pdf_exists")] = pdfExists ? "true" : "false";
    row[columns.indexOf("pdf_size")] = pdfSize;
  });
  const table: DataHubTable = { columns, rows: max ? rows.slice(0, max) : rows };
  try {
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(table), "utf-8");
  } catch {
    /* ignore cache write errors */
  }
  return { table, cached: false };
};

export const fetchZoteroCollectionItemsPreview = async (
  creds: ZoteroCredentials,
  collectionKey: string,
  max = 200
): Promise<ZoteroItemPreview[]> => {
  const limit = 50;
  let start = 0;
  const items: ZoteroItemPreview[] = [];
  while (true) {
    // Use the stable top-level items endpoint. Some Zotero APIs/libraries return HTTP 400
    // for `include=children` + `itemType=-attachment` combinations.
    const url = `${zoteroBase(creds)}/collections/${encodeURIComponent(collectionKey)}/items/top?limit=${limit}&start=${start}`;
    const res = await fetch(url, { headers: authHeaders(creds) });
    if (!res.ok) throw new Error(`Items HTTP ${res.status}`);
    const data = (await res.json()) as Array<{ key: string; data: any }>;
    (data || []).forEach((item) => {
      const d = item.data || {};
      const creators = Array.isArray(d.creators)
        ? d.creators
            .map((c: any) => `${c.firstName || ""} ${c.lastName || ""}`.trim())
            .filter(Boolean)
        : [];
      const tags = Array.isArray(d.tags)
        ? d.tags.map((tag: any) => String(tag?.tag || "").trim()).filter(Boolean)
        : [];
      const collections = Array.isArray(d.collections)
        ? d.collections.map((entry: any) => String(entry || "").trim()).filter(Boolean)
        : [];
      const attachments = typeof d.numChildren === "number" ? d.numChildren : 0;
      const libraryPrefix = zoteroLibraryPrefix(creds);
      items.push({
        key: item.key,
        title: d.title || "",
        authors: creators.join("; "),
        date: d.date ? String(d.date) : "",
        year: d.date ? String(d.date).slice(0, 4) : "",
        itemType: d.itemType || "",
        doi: d.DOI || d.doi || "",
        url: d.url || "",
        abstract: d.abstractNote || "",
        publicationTitle: d.publicationTitle || "",
        tags,
        collections,
        attachments,
        pdfs: 0,
        hasPdf: false,
        zoteroSelectUrl: `zotero://select/${libraryPrefix}/items/${item.key}`,
        firstPdfKey: undefined,
        firstPdfTitle: undefined,
        firstPdfPath: undefined,
        notes: 0,
        annotations: 0
      });
    });
    start += limit;
    if (items.length >= max || data.length < limit) break;
  }
  return items.slice(0, max);
};

export const mergeTables = (tables: DataHubTable[]): DataHubTable => {
  const columns = tables[0]?.columns ?? [];
  const rows: Array<Array<unknown>> = [];
  tables.forEach((t) => {
    if (t?.columns?.join("|") !== columns.join("|")) {
      return;
    }
    rows.push(...(t.rows || []));
  });
  return { columns, rows };
};

const loadCountsCache = (cacheDir?: string): Record<string, number> => {
  const root = resolveCacheDir(cacheDir);
  const cachePath = path.join(root, "counts.json");
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    return typeof raw === "object" && raw ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
};

const writeCountsCache = (cacheDir: string | undefined, data: Record<string, number>): void => {
  const root = resolveCacheDir(cacheDir);
  const cachePath = path.join(root, "counts.json");
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data), "utf-8");
  } catch {
    /* ignore cache errors */
  }
};

export const fetchZoteroCollectionCount = async (
  creds: ZoteroCredentials,
  collectionKey: string,
  cacheDir?: string
): Promise<number> => {
  const cache = loadCountsCache(cacheDir);
  if (typeof cache[collectionKey] === "number") {
    return cache[collectionKey];
  }
  const url = `${zoteroBase(creds)}/collections/${encodeURIComponent(collectionKey)}/items?limit=1`;
  const res = await fetch(url, { headers: authHeaders(creds) });
  if (!res.ok) throw new Error(`Count HTTP ${res.status}`);
  const total = Number(res.headers.get("Total-Results") || 0);
  cache[collectionKey] = Number.isFinite(total) ? total : 0;
  writeCountsCache(cacheDir, cache);
  return cache[collectionKey];
};
