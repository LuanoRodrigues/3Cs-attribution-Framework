import { app, BrowserWindow, ipcMain } from "electron";
import fs from "fs";
import path from "path";

const normalizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const resolveBibliographyDir = (): string => {
  const fromEnv = (process.env.TEIA_DATA_HUB_CACHE_DIR || "").trim();
  const candidates = [
    fromEnv,
    path.join(app.getPath("userData"), "data-hub-cache"),
    // Useful when testing LEditor standalone alongside the main Annotarium app.
    path.join(app.getPath("appData"), "Annotarium", "data-hub-cache"),
    // Useful when testing against the dev app name (matches Electron userData folder).
    path.join(app.getPath("appData"), "my-electron-app", "data-hub-cache")
  ].filter(Boolean);

  const refsCount = (dir: string): number => {
    try {
      const libraryPath = path.join(dir, "references_library.json");
      const legacyPath = path.join(dir, "references.json");
      const pickCount = (obj: any): number => {
        if (!obj || typeof obj !== "object") return 0;
        if (Array.isArray((obj as any).items)) return (obj as any).items.length;
        if ((obj as any).itemsByKey && typeof (obj as any).itemsByKey === "object") {
          return Object.keys((obj as any).itemsByKey).length;
        }
        return 0;
      };
      const lib = readJsonIfExists(libraryPath);
      const legacy = readJsonIfExists(legacyPath);
      return Math.max(pickCount(lib), pickCount(legacy));
    } catch {
      return 0;
    }
  };

  const scored = candidates
    .map((dir) => ({ dir, count: refsCount(dir) }))
    .sort((a, b) => b.count - a.count);
  const best = scored[0]?.dir;
  return best ?? candidates[0] ?? path.join(app.getPath("userData"), "data-hub-cache");
};

const readJsonIfExists = (filePath: string): any | null => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const seedBundledReferences = (bibliographyDir: string): void => {
  try {
    const libraryPath = path.join(bibliographyDir, "references_library.json");
    const legacyPath = path.join(bibliographyDir, "references.json");

    const library = readJsonIfExists(libraryPath);
    const legacy = readJsonIfExists(legacyPath);
    const hasItems = (obj: any): boolean => Boolean(obj && typeof obj === "object" && Array.isArray(obj.items) && obj.items.length);

    if (hasItems(library) || hasItems(legacy)) {
      return;
    }

    const bundledPath = path.join(app.getAppPath(), "dist", "public", "references.json");
    const bundled = readJsonIfExists(bundledPath);
    if (!hasItems(bundled)) {
      return;
    }
    fs.writeFileSync(legacyPath, JSON.stringify(bundled, null, 2), "utf-8");
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
