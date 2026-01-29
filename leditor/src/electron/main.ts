import { app, BrowserWindow, ipcMain } from "electron";
import fs from "fs";
import path from "path";

const normalizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const normalizeLegacyJson = (raw: string): string => {
  return raw
    .replace(/\bNaN\b/g, "null")
    .replace(/\bnan\b/g, "null")
    .replace(/\bInfinity\b/g, "null")
    .replace(/\b-Infinity\b/g, "null");
};

const resolveBibliographyDir = (): string => {
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
      const referencesPath = path.join(dir, "references.json");
      const pickCount = (obj: any): number => {
        if (!obj || typeof obj !== "object") return 0;
        if (Array.isArray((obj as any).items)) return (obj as any).items.length;
        if ((obj as any).itemsByKey && typeof (obj as any).itemsByKey === "object") {
          return Object.keys((obj as any).itemsByKey).length;
        }
        return 0;
      };
      const payload = readJsonIfExists(referencesPath);
      return pickCount(payload);
    } catch {
      return 0;
    }
  };

  const scored = candidates
    .map((dir) => ({ dir, count: refsCount(dir) }))
    .sort((a, b) => b.count - a.count);
  const best = scored[0]?.dir;
  console.info("[leditor][refs] bibliographyDir candidates", scored);
  console.info("[leditor][refs] bibliographyDir picked", { best: best ?? "", fallback: candidates[0] ?? "" });
  return best ?? candidates[0] ?? path.join(app.getPath("userData"), "data-hub-cache");
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
    const outPath = path.join(bibliographyDir, "references.json");

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
        .filter((name) => name.endsWith(".json") && name !== "references.json" && name !== "references_library.json")
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
      const cachePayload = readJsonIfExists(pick) as { table?: { columns?: unknown[]; rows?: unknown[][] } } | null;
      const table = cachePayload?.table;
      const columns = Array.isArray(table?.columns) ? (table?.columns as unknown[]) : [];
      const rows = Array.isArray(table?.rows) ? (table?.rows as unknown[][]) : [];
      if (!columns.length || !rows.length) return null;
      return { sourcePath: pick, columns, rows };
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
      if (title) item.title = title;
      if (author) item.author = author;
      if (year) item.year = year;
      if (url) item.url = url;
      if (source) item.source = source;
      if (doi) item.doi = doi;
      if (note) item.note = note;
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
    console.info("[leditor][refs] seeded references.json", {
      bibliographyDir,
      from: sourcePath,
      prevCount: existingCount,
      nextCount: next.items.length
    });
  } catch (error) {
    console.warn("[leditor][refs] failed to seed references.json", error);
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
    const referencesPath = path.join(bibliographyDir, "references.json");

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

    const bundledPath = path.join(app.getAppPath(), "dist", "public", "references.json");
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
      directQuoteJsonPath: ""
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
  ipcMain.handle("leditor:read-file", async (_event, request: { sourcePath: string }) => {
    try {
      const data = await fs.promises.readFile(request.sourcePath, "utf-8");
      return { success: true, data, filePath: request.sourcePath };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:write-file", async (_event, request: { targetPath: string; data: string }) => {
    try {
      await fs.promises.mkdir(path.dirname(request.targetPath), { recursive: true });
      await fs.promises.writeFile(request.targetPath, request.data, "utf-8");
      return { success: true };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
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
