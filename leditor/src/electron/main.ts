import { app, BrowserWindow, ipcMain } from "electron";
import fs from "fs";
import path from "path";

const REFERENCES_LIBRARY_FILENAME = "references_library.json";
const REFERENCES_LEGACY_FILENAME = "references.json";

const normalizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const randomToken = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const pdfViewerPayloads = new Map<string, Record<string, unknown>>();
const pdfResolveCache = new Map<string, string | null>();
let pdfViewerWindow: BrowserWindow | null = null;

const convertWslUncPath = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/^\\\\+/, "");
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  // Examples:
  //   \\wsl$\Ubuntu-20.04\home\pantera\... -> /home/pantera/...
  //   \\wsl.localhost\Ubuntu-22.04\home\pantera\... -> /home/pantera/...
  const head = String(segments[0] || "").toLowerCase();
  const isWslDollar = head === "wsl$";
  const isWslLocalhost = head === "wsl.localhost";
  if ((isWslDollar || isWslLocalhost) && segments.length >= 3) {
    return `/${segments.slice(2).join("/")}`;
  }
  return trimmed;
};

const normalizeFsPath = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("\\\\")) {
    return convertWslUncPath(trimmed);
  }
  return trimmed;
};

const dirnameLike = (filePath: string): string => {
  const normalized = String(filePath || "").trim().replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx > 0 ? normalized.slice(0, idx) : "";
};

const findPdfInLargeBatchesJson = async (filePath: string, itemKey: string): Promise<string | null> => {
  const key = String(itemKey || "").trim();
  if (!key) return null;
  const needleVariants = [`"item_key":"${key}"`, `"itemKey":"${key}"`, `"key":"${key}"`];
  const pdfRegexes = [/"pdf_path"\s*:\s*"([^"]+)"/, /"pdf"\s*:\s*"([^"]+)"/, /"source"\s*:\s*"([^"]+)"/];
  return await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    let buf = "";
    const keepMax = 2 * 1024 * 1024;
    const searchWindow = 32 * 1024;
    const flush = () => {
      if (buf.length > keepMax) buf = buf.slice(buf.length - keepMax);
    };
    stream.on("data", (chunk: string | Buffer) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      flush();
      for (const needle of needleVariants) {
        const idx = buf.indexOf(needle);
        if (idx === -1) continue;
        const slice = buf.slice(idx, Math.min(buf.length, idx + searchWindow));
        for (const re of pdfRegexes) {
          const m = slice.match(re);
          if (m && m[1]) {
            stream.close();
            resolve(String(m[1]));
            return;
          }
        }
      }
    });
    stream.on("end", () => resolve(null));
    stream.on("error", (err) => reject(err));
  });
};

const normalizeLegacyJson = (raw: string): string => {
  return raw
    .replace(/\bNaN\b/g, "null")
    .replace(/\bnan\b/g, "null")
    .replace(/\bInfinity\b/g, "null")
    .replace(/\b-Infinity\b/g, "null");
};

const dqEntryCache = new Map<string, { mtimeMs: number; entries: Map<string, unknown> }>();
let cachedBibliographyDir: string | null = null;

type DqidIndexCacheEntry = { mtimeMs: number; positions: Map<string, number> };
const dqidIndexCache = new Map<string, DqidIndexCacheEntry>();
const dqidIndexInflight = new Map<string, Promise<Map<string, number>>>();

const ensureDqidIndex = async (lookupPath: string): Promise<Map<string, number>> => {
  const target = normalizeFsPath(lookupPath);
  if (!target) return new Map();

  let stat: fs.Stats | null = null;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    stat = null;
  }
  const mtimeMs = stat?.mtimeMs ?? 0;
  const cached = dqidIndexCache.get(target);
  if (cached && cached.mtimeMs === mtimeMs) return cached.positions;
  const inflight = dqidIndexInflight.get(target);
  if (inflight) return inflight;

  const buildPromise = (async () => {
    const positions = new Map<string, number>();
    // Match keys like "bb20a0475f":  (10 hex chars).
    const keyRe = /"([0-9a-f]{10})"\s*:/gi;
    // NOTE: positions are byte offsets (fs read positions are byte-based).
    // We stream Buffers (no encoding) so we can track byte offsets accurately even when
    // the JSON contains non-ASCII characters.
    const stream = fs.createReadStream(target);
    let offsetBytes = 0;
    let carryText = "";
    let carryBytes = 0;
    const maxCarry = 128;

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: string | Buffer) => {
        const bufChunk = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        const text = bufChunk.toString("utf8");
        const buf = carryText + text;
        keyRe.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = keyRe.exec(buf))) {
          const id = String(match[1] || "").trim().toLowerCase();
          if (!id) continue;
          if (positions.has(id)) continue;
          // Absolute position points to the opening quote of the key inside the file.
          // Convert the string index into a byte offset for this (carry+chunk) buffer.
          const prefix = buf.slice(0, match.index);
          const prefixBytes = Buffer.byteLength(prefix, "utf8");
          const abs = offsetBytes - carryBytes + prefixBytes;
          if (abs >= 0) positions.set(id, abs);
        }
        carryText = buf.slice(Math.max(0, buf.length - maxCarry));
        carryBytes = Buffer.byteLength(carryText, "utf8");
        offsetBytes += bufChunk.length;
      });
      stream.on("end", () => resolve());
      stream.on("error", (err) => reject(err));
    });

    dqidIndexCache.set(target, { mtimeMs, positions });
    console.info("[leditor][directquote] index built", { path: target, count: positions.size });
    return positions;
  })().finally(() => {
    dqidIndexInflight.delete(target);
  });

  dqidIndexInflight.set(target, buildPromise);
  return buildPromise;
};

const computeValueStartPos = async (fd: fs.promises.FileHandle, keyPos: number): Promise<number | null> => {
  // Read a small window starting at keyPos to find the ':' then the value start.
  const windowSize = 4096;
  const buf = Buffer.alloc(windowSize);
  const read = await fd.read(buf, 0, windowSize, keyPos);
  const text = buf.toString("utf8", 0, read.bytesRead);
  const colonIdx = text.indexOf(":");
  if (colonIdx === -1) return null;
  let i = colonIdx + 1;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (i >= text.length) return null;
  return keyPos + i;
};

const readJsonValueAt = async (lookupPath: string, startPos: number): Promise<unknown | null> => {
  const target = normalizeFsPath(lookupPath);
  if (!target) return null;
  const fd = await fs.promises.open(target, "r");
  try {
    const chunkSize = 128 * 1024;
    let pos = startPos;
    let buf = "";
    // State machine for JSON value parsing.
    let started = false;
    let firstChar = "";
    let inString = false;
    let escape = false;
    let braceDepth = 0;
    let bracketDepth = 0;
    let scanned = 0;
    for (let iter = 0; iter < 20000; iter += 1) {
      const chunk = Buffer.alloc(chunkSize);
      const read = await fd.read(chunk, 0, chunkSize, pos);
      if (read.bytesRead <= 0) break;
      const text = chunk.toString("utf8", 0, read.bytesRead);
      pos += read.bytesRead;
      buf += text;

      // Skip leading whitespace once.
      if (!started) {
        const m = buf.match(/^\s*/);
        const skip = m ? m[0].length : 0;
        if (skip) buf = buf.slice(skip);
        if (buf.length === 0) continue;
        started = true;
        firstChar = buf[0];
        braceDepth = 0;
        bracketDepth = 0;
        if (firstChar === "\"") inString = true;
        scanned = 0;
      }

      // Walk buffer to determine end position for objects/arrays/strings/primitives.
      for (let i = scanned; i < buf.length; i += 1) {
        const ch = buf[i];
        if (inString) {
          if (escape) {
            escape = false;
            continue;
          }
          if (ch === "\\\\") {
            escape = true;
            continue;
          }
          if (ch === "\"") {
            inString = false;
            if (firstChar === "\"") {
              const slice = buf.slice(0, i + 1);
              return JSON.parse(normalizeLegacyJson(slice));
            }
          }
          continue;
        }
        if (ch === "\"") {
          inString = true;
          continue;
        }
        if (firstChar === "{" || braceDepth > 0) {
          if (ch === "{") braceDepth += 1;
          else if (ch === "}") braceDepth -= 1;
          if (firstChar === "{" && braceDepth === 0 && ch === "}") {
            const slice = buf.slice(0, i + 1);
            return JSON.parse(normalizeLegacyJson(slice));
          }
          continue;
        }
        if (firstChar === "[" || bracketDepth > 0) {
          if (ch === "[") bracketDepth += 1;
          else if (ch === "]") bracketDepth -= 1;
          if (firstChar === "[" && bracketDepth === 0 && ch === "]") {
            const slice = buf.slice(0, i + 1);
            return JSON.parse(normalizeLegacyJson(slice));
          }
          continue;
        }
        // Primitive ends at ',' or '}' or ']'
        if (ch === "," || ch === "}" || ch === "]") {
          const slice = buf.slice(0, i).trim();
          if (!slice) return null;
          return JSON.parse(normalizeLegacyJson(slice));
        }
      }
      scanned = buf.length;

      // Bound memory for very large values (but keep enough).
      if (buf.length > 64 * 1024 * 1024) {
        // If we're in an object/array/string, we need the whole prefix. Fail fast.
        throw new Error("direct-quote-value-too-large");
      }
    }
    return null;
  } finally {
    await fd.close();
  }
};

export const getDirectQuotePayload = async (lookupPath: string, dqid: string): Promise<unknown | null> => {
  const target = normalizeFsPath(lookupPath);
  const id = String(dqid || "").trim().toLowerCase();
  if (!target || !id) return null;

  let stat: fs.Stats | null = null;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    stat = null;
  }
  const mtimeMs = stat?.mtimeMs ?? 0;
  const cached = dqEntryCache.get(target);
  if (cached && cached.mtimeMs === mtimeMs && cached.entries.has(id)) {
    return cached.entries.get(id) ?? null;
  }
  const entries = cached && cached.mtimeMs === mtimeMs ? cached.entries : new Map<string, unknown>();
  dqEntryCache.set(target, { mtimeMs, entries });

  const positions = await ensureDqidIndex(target);
  const keyPos = positions.get(id);
  if (typeof keyPos !== "number") {
    entries.set(id, null);
    return null;
  }
  const fd = await fs.promises.open(target, "r");
  try {
    const valueStart = await computeValueStartPos(fd, keyPos);
    if (valueStart == null) {
      entries.set(id, null);
      return null;
    }
    const value = await readJsonValueAt(target, valueStart);
    entries.set(id, value);
    return value;
  } finally {
    await fd.close();
  }
};

const resolveBibliographyDir = (): string => {
  if (cachedBibliographyDir) {
    return cachedBibliographyDir;
  }
  const fromEnv = (process.env.TEIA_DATA_HUB_CACHE_DIR || "").trim();
  const home = (process.env.HOME || "").trim();
  const candidates = [
    fromEnv,
    path.join(app.getPath("userData"), "data-hub-cache"),
    // Useful when testing LEditor standalone alongside the main Annotarium app.
    path.join(app.getPath("appData"), "Annotarium", "data-hub-cache"),
    // Useful when testing against the dev app name (matches Electron userData folder).
    path.join(app.getPath("appData"), "my-electron-app", "data-hub-cache"),
    home ? path.join(home, ".config", "Annotarium", "data-hub-cache") : "",
    home ? path.join(home, ".config", "my-electron-app", "data-hub-cache") : ""
  ].filter(Boolean);

  const refsCount = (dir: string): number => {
    try {
      const pickCount = (obj: any): number => {
        if (!obj || typeof obj !== "object") return 0;
        if (Array.isArray((obj as any).items)) return (obj as any).items.length;
        if ((obj as any).itemsByKey && typeof (obj as any).itemsByKey === "object") {
          return Object.keys((obj as any).itemsByKey).length;
        }
        return 0;
      };
      const library = readJsonIfExists(path.join(dir, REFERENCES_LIBRARY_FILENAME));
      const legacy = readJsonIfExists(path.join(dir, REFERENCES_LEGACY_FILENAME));
      return Math.max(pickCount(library), pickCount(legacy));
    } catch {
      return 0;
    }
  };

  const tableCount = (dir: string): number => {
    try {
      if (!fs.existsSync(dir)) return 0;
      const files = fs
        .readdirSync(dir)
        .filter(
          (name) =>
            name.endsWith(".json") &&
            name !== REFERENCES_LIBRARY_FILENAME &&
            name !== REFERENCES_LEGACY_FILENAME &&
            !name.startsWith("references.")
        )
        .map((name) => path.join(dir, name))
        .filter((p) => {
          try {
            return fs.statSync(p).isFile();
          } catch {
            return false;
          }
        })
        .sort((a, b) => {
          try {
            return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
          } catch {
            return 0;
          }
        });
      for (const filePath of files) {
        const parsed = readJsonIfExists(filePath) as { table?: { rows?: unknown[] } } | null;
        const rows = parsed?.table?.rows;
        if (Array.isArray(rows) && rows.length) return rows.length;
      }
      return 0;
    } catch {
      return 0;
    }
  };

  const scored = candidates
    .map((dir) => {
      const refs = refsCount(dir);
      const table = refs > 0 ? 0 : tableCount(dir);
      return { dir, refsCount: refs, tableCount: table };
    })
    .sort((a, b) => {
      if (b.refsCount !== a.refsCount) return b.refsCount - a.refsCount;
      return b.tableCount - a.tableCount;
    });
  const best = scored[0]?.dir;
  console.info("[leditor][refs] bibliographyDir candidates", scored);
  console.info("[leditor][refs] bibliographyDir picked", { best: best ?? "", fallback: candidates[0] ?? "" });
  cachedBibliographyDir = best ?? candidates[0] ?? path.join(app.getPath("userData"), "data-hub-cache");
  return cachedBibliographyDir;
};

const readJsonIfExists = (filePath: string): any | null => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(normalizeLegacyJson(raw));
  } catch {
    return null;
  }
};

const seedReferencesFromDataHubCache = (bibliographyDir: string): void => {
  try {
    const outPath = path.join(bibliographyDir, REFERENCES_LIBRARY_FILENAME);
    const legacyOutPath = path.join(bibliographyDir, REFERENCES_LEGACY_FILENAME);

    const existing = readJsonIfExists(outPath);
    const existingCount =
      existing && typeof existing === "object"
        ? Array.isArray((existing as any).items)
          ? (existing as any).items.length
          : (existing as any).itemsByKey && typeof (existing as any).itemsByKey === "object"
            ? Object.keys((existing as any).itemsByKey).length
            : 0
        : 0;

    if (!fs.existsSync(bibliographyDir)) return;

    const readLatestJsonTable = (): { sourcePath: string; columns: unknown[]; rows: unknown[][] } | null => {
      const candidates = fs
        .readdirSync(bibliographyDir)
        .filter(
          (name) =>
            name.endsWith(".json") &&
            name !== REFERENCES_LIBRARY_FILENAME &&
            !name.startsWith("references.")
        )
        .map((name) => path.join(bibliographyDir, name))
        .filter((p) => {
          try {
            return fs.statSync(p).isFile();
          } catch {
            return false;
          }
        })
        .sort((a, b) => {
          try {
            return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
          } catch {
            return 0;
          }
        });
      for (const candidate of candidates) {
        const cachePayload = readJsonIfExists(candidate) as { table?: { columns?: unknown[]; rows?: unknown[][] } } | null;
        const table = cachePayload?.table;
        const columns = Array.isArray(table?.columns) ? (table?.columns as unknown[]) : [];
        const rows = Array.isArray(table?.rows) ? (table?.rows as unknown[][]) : [];
        if (columns.length && rows.length) {
          return { sourcePath: candidate, columns, rows };
        }
      }
      return null;
    };

    const parseCsvRow = (line: string): string[] => {
      const out: string[] = [];
      let field = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === "\"") {
            const next = line[i + 1];
            if (next === "\"") {
              field += "\"";
              i += 1;
              continue;
            }
            inQuotes = false;
            continue;
          }
          field += ch;
          continue;
        }
        if (ch === "\"") {
          inQuotes = true;
          continue;
        }
        if (ch === ",") {
          out.push(field);
          field = "";
          continue;
        }
        field += ch;
      }
      out.push(field);
      return out;
    };

    const readLatestCsvTable = (): { sourcePath: string; columns: unknown[]; rows: unknown[][] } | null => {
      const candidates = fs
        .readdirSync(bibliographyDir)
        .filter((name) => name.toLowerCase().endsWith(".csv") && name.toLowerCase() !== "references.csv")
        .map((name) => path.join(bibliographyDir, name))
        .filter((p) => {
          try {
            return fs.statSync(p).isFile();
          } catch {
            return false;
          }
        })
        .sort((a, b) => {
          try {
            return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
          } catch {
            return 0;
          }
        });
      const pick = candidates[0];
      if (!pick) return null;
      const raw = fs.readFileSync(pick, "utf-8");
      const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length < 2) return null;
      const columns = parseCsvRow(lines[0]).map((c) => c.trim());
      const rows: unknown[][] = [];
      for (let i = 1; i < lines.length; i += 1) {
        rows.push(parseCsvRow(lines[i]));
      }
      return { sourcePath: pick, columns, rows };
    };

    const tableSource = readLatestJsonTable() ?? readLatestCsvTable();
    if (!tableSource) return;
    const { sourcePath, columns, rows } = tableSource;

    const colIndex = new Map<string, number>();
    columns.forEach((col, idx) => colIndex.set(String(col).trim().toLowerCase(), idx));
    const pickCell = (row: unknown[], name: string): string => {
      const idx = colIndex.get(name);
      if (idx === undefined) return "";
      const value = row[idx];
      return value == null ? "" : String(value).trim();
    };

    const itemsByKey = new Map<string, any>();
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const itemKey = pickCell(row, "key");
      if (!itemKey) continue;
      if (itemsByKey.has(itemKey)) continue;
      const item: any = { itemKey };
      const title = pickCell(row, "title");
      const year = pickCell(row, "year");
      const author = pickCell(row, "creator_summary") || pickCell(row, "author_summary") || pickCell(row, "authors");
      const url = pickCell(row, "url");
      const source = pickCell(row, "source");
      const doi = pickCell(row, "doi");
      const note = pickCell(row, "abstract");
      const pdfPath =
        pickCell(row, "pdf_path") ||
        pickCell(row, "pdf") ||
        pickCell(row, "file_path") ||
        pickCell(row, "file") ||
        pickCell(row, "attachment_path");
      if (title) item.title = title;
      if (author) item.author = author;
      if (year) item.year = year;
      if (url) item.url = url;
      if (source) item.source = source;
      if (doi) item.doi = doi;
      if (note) item.note = note;
      if (pdfPath) item.pdf_path = pdfPath;
      itemsByKey.set(itemKey, item);
    }

    const next = {
      updatedAt: new Date().toISOString(),
      items: Array.from(itemsByKey.values())
    };

    if (next.items.length <= existingCount) {
      return;
    }

    fs.writeFileSync(outPath, JSON.stringify(next, null, 2), "utf-8");
    fs.writeFileSync(legacyOutPath, JSON.stringify(next, null, 2), "utf-8");
    console.info("[leditor][refs] seeded references_library.json", {
      bibliographyDir,
      from: sourcePath,
      prevCount: existingCount,
      nextCount: next.items.length
    });
  } catch (error) {
    console.warn("[leditor][refs] failed to seed references_library.json", error);
  }
};

const seedBundledReferences = (bibliographyDir: string): void => {
  try {
    // Never seed into another app's cache directory (e.g. my-electron-app / Annotarium).
    // Seeding is only for standalone smoke testing when using LEditor’s own userData cache.
    const leditorCacheDir = path.join(app.getPath("userData"), "data-hub-cache");
    if (path.resolve(bibliographyDir) !== path.resolve(leditorCacheDir)) {
      return;
    }
    const referencesPath = path.join(bibliographyDir, REFERENCES_LIBRARY_FILENAME);

    const current = readJsonIfExists(referencesPath);
    const hasItems = (obj: any): boolean =>
      Boolean(
        obj &&
          typeof obj === "object" &&
          ((Array.isArray((obj as any).items) && (obj as any).items.length) ||
            ((obj as any).itemsByKey && typeof (obj as any).itemsByKey === "object" && Object.keys((obj as any).itemsByKey).length))
      );

    if (hasItems(current)) {
      return;
    }

    const bundledPath = path.join(app.getAppPath(), "dist", "public", REFERENCES_LIBRARY_FILENAME);
    const bundled = readJsonIfExists(bundledPath);
    if (!hasItems(bundled)) {
      return;
    }
    fs.writeFileSync(referencesPath, JSON.stringify(bundled, null, 2), "utf-8");
  } catch {
    // ignore
  }
};

const createWindow = () => {
  const bibliographyDir = resolveBibliographyDir();
  const contentDir = path.join(app.getPath("userData"), "content");
  const tempDir = path.join(app.getPath("userData"), "temp");
  [bibliographyDir, contentDir, tempDir].forEach((dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  });
  seedReferencesFromDataHubCache(bibliographyDir);
  seedBundledReferences(bibliographyDir);

  const hostContract = {
    version: 1,
    sessionId: "local-session",
    documentId: "local-document",
    documentTitle: "Untitled document",
    paths: {
      contentDir,
      bibliographyDir,
      tempDir
    },
    inputs: {
      directQuoteJsonPath:
        (process.env.LEDITOR_DIRECT_QUOTE_JSON_PATH || "").trim() ||
        "\\\\wsl.localhost\\Ubuntu-22.04\\home\\pantera\\annotarium\\analyse\\0.13_cyber_attribution_corpus_records_total_included\\1999-2009_2010-2018_2019-2025__rq=0,3,4,2,1\\direct_quote_lookup.json"
    },
    policy: {
      allowDiskWrites: true
    }
  };
  const leditorHostArg = `--leditor-host=${encodeURIComponent(JSON.stringify(hostContract))}`;

  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    backgroundColor: "#f6f2e7",
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [leditorHostArg]
    }
  });

  const indexPath = path.join(app.getAppPath(), "dist", "public", "index.html");
  void window.loadFile(indexPath);
  return window;
};

app.whenReady().then(() => {
  ipcMain.handle("leditor:file-exists", async (_event, request: { sourcePath: string }) => {
    try {
      const sourcePath = normalizeFsPath(request.sourcePath);
      if (!sourcePath) return { success: false, exists: false };
      await fs.promises.access(sourcePath, fs.constants.R_OK);
      return { success: true, exists: true };
    } catch {
      return { success: true, exists: false };
    }
  });

  ipcMain.handle("leditor:read-file", async (_event, request: { sourcePath: string }) => {
    try {
      const sourcePath = normalizeFsPath(request.sourcePath);
      const data = await fs.promises.readFile(sourcePath, "utf-8");
      return { success: true, data, filePath: sourcePath };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:write-file", async (_event, request: { targetPath: string; data: string }) => {
    try {
      const targetPath = normalizeFsPath(request.targetPath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, request.data, "utf-8");
      return { success: true };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:open-pdf-viewer", async (_event, request: { payload: Record<string, unknown> }) => {
    try {
      const payload = request?.payload || {};
      console.info("[leditor][pdf] open viewer requested", {
        dqid: (payload as any).dqid ?? null,
        item_key: (payload as any).item_key ?? (payload as any).itemKey ?? null,
        pdf_path: (payload as any).pdf_path ?? (payload as any).pdf ?? null,
        page: (payload as any).page ?? null
      });

      const viewerPath = path.join(app.getAppPath(), "dist", "public", "pdf_viewer.html");
      const sendPayload = (win: BrowserWindow) => {
        try {
          win.webContents.send("leditor:pdf-viewer-payload", payload);
        } catch {
          // ignore
        }
      };

      if (pdfViewerWindow && !pdfViewerWindow.isDestroyed()) {
        pdfViewerWindow.show();
        pdfViewerWindow.focus();
        sendPayload(pdfViewerWindow);
        console.info("[leditor][pdf] viewer reused");
        return { success: true };
      }

      const token = randomToken();
      pdfViewerPayloads.set(token, payload);

      pdfViewerWindow = new BrowserWindow({
        width: 1100,
        height: 900,
        backgroundColor: "#f6f2e7",
        webPreferences: {
          preload: path.join(app.getAppPath(), "dist", "electron", "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          additionalArguments: [`--pdf-viewer-token=${token}`]
        }
      });
      pdfViewerWindow.on("closed", () => {
        pdfViewerWindow = null;
      });
      pdfViewerWindow.webContents.once("did-finish-load", () => sendPayload(pdfViewerWindow!));
      await pdfViewerWindow.loadFile(viewerPath);
      console.info("[leditor][pdf] viewer window opened", { token });
      return { success: true };
    } catch (error) {
      console.warn("[leditor][pdf] open viewer failed", { error: normalizeError(error) });
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:pdf-viewer-payload", async (_event, request: { token: string }) => {
    const token = String(request?.token || "");
    if (!token) return null;
    const payload = pdfViewerPayloads.get(token) || null;
    pdfViewerPayloads.delete(token);
    return payload;
  });

  ipcMain.handle("leditor:resolve-pdf-path", async (_event, request: { lookupPath: string; itemKey: string }) => {
    try {
      const lookupPath = normalizeFsPath(request.lookupPath);
      const itemKey = String(request.itemKey || "").trim();
      if (!lookupPath || !itemKey) return null;
      const runDir = dirnameLike(lookupPath);
      if (!runDir) return null;
      console.info("[leditor][pdf] resolve requested", { lookupPath, itemKey });
      const cacheKey = `${lookupPath}::${itemKey}`;
      if (pdfResolveCache.has(cacheKey)) {
        return pdfResolveCache.get(cacheKey) ?? null;
      }

      // Fast path: check references library/legacy files in userData bibliographyDir.
      try {
        const bibliographyDir = resolveBibliographyDir();
        const candidates = [
          path.join(bibliographyDir, REFERENCES_LIBRARY_FILENAME),
          path.join(bibliographyDir, REFERENCES_LEGACY_FILENAME)
        ];
        for (const candidate of candidates) {
          const raw = readJsonIfExists(candidate);
          if (!raw || typeof raw !== "object") continue;
          const itemsByKey = (raw as any).itemsByKey;
          if (itemsByKey && typeof itemsByKey === "object") {
            const entry = (itemsByKey as any)[itemKey] || (itemsByKey as any)[itemKey.toLowerCase()];
            const pdf =
              (entry && typeof entry === "object" && (entry.pdf_path || entry.pdf || entry.file_path || entry.file)) ||
              "";
            if (pdf) {
              console.info("[leditor][pdf] resolved from references", { itemKey, path: candidate });
              const resolved = String(pdf);
              pdfResolveCache.set(cacheKey, resolved);
              return resolved;
            }
          }
        }
      } catch {
        // ignore
      }

      const candidates = [path.join(runDir, "pyr_l1_batches.json"), path.join(runDir, "batches.json")];
      for (const candidate of candidates) {
        try {
          const stat = await fs.promises.stat(candidate);
          if (!stat.isFile()) continue;
        } catch {
          continue;
        }
        const resolved = await findPdfInLargeBatchesJson(candidate, itemKey);
        if (resolved) {
          console.info("[leditor][pdf] resolved from batches", { itemKey, path: candidate });
          pdfResolveCache.set(cacheKey, resolved);
          return resolved;
        }
      }
      pdfResolveCache.set(cacheKey, null);
      return null;
    } catch (error) {
      console.warn("[leditor][pdf] resolve failed", { error: normalizeError(error) });
      return null;
    }
  });

  ipcMain.handle("leditor:get-direct-quote-entry", async (_event, request: { lookupPath: string; dqid: string }) => {
    try {
      const lookupPath = normalizeFsPath(request.lookupPath);
      const dqid = String(request.dqid || "").trim().toLowerCase();
      if (!lookupPath || !dqid) return null;
      console.info("[leditor][directquote] entry requested", { dqid, lookupPath });
      const entry = await getDirectQuotePayload(lookupPath, dqid);
      if (entry == null) console.info("[leditor][directquote] entry miss", { dqid });
      return entry;
    } catch (error) {
      console.warn("[leditor][directquote] entry fetch failed", { error: normalizeError(error) });
      return null;
    }
  });

  ipcMain.handle("leditor:prefetch-direct-quotes", async (_event, request: { lookupPath: string; dqids: string[] }) => {
    try {
      const lookupPath = normalizeFsPath(request.lookupPath);
      const dqids = Array.isArray(request.dqids) ? request.dqids : [];
      let found = 0;
      if (!lookupPath || dqids.length === 0) return { success: false, found };
      // Avoid hammering huge files; cap prefetch work.
      const capped = dqids.slice(0, 250);
      for (const dqid of capped) {
        const id = String(dqid || "").trim().toLowerCase();
        if (!id) continue;
        const entry = await getDirectQuotePayload(lookupPath, id);
        if (entry != null) found += 1;
      }
      console.info("[leditor][directquote] prefetch", { lookupPath, requested: dqids.length, attempted: capped.length, found });
      return { success: true, found };
    } catch (error) {
      console.warn("[leditor][directquote] prefetch failed", { error: normalizeError(error) });
      return { success: false, found: 0 };
    }
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
