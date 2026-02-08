const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const indexHtml = path.join(repoRoot, "dist", "public", "index.html");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (webContents, script, timeout = 45_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const result = await webContents.executeJavaScript(script);
      if (result) return;
    } catch {
      // ignore while loading
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for condition");
};

const registerIpcFallbacks = () => {
  const register = (channel, handler) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignore
    }
    ipcMain.handle(channel, handler);
  };
  register("leditor:ai-status", async () => ({
    success: true,
    hasApiKey: false,
    model: "codex-mini-latest",
    modelFromEnv: false
  }));
  register("leditor:file-exists", async () => ({ success: true, exists: false }));
  register("leditor:agent-request", async () => ({ success: false, error: "disabled", meta: { ms: 0 } }));
  register("leditor:agent-cancel", async () => ({ success: true }));
  register("leditor:read-file", async () => ({ success: false, error: "disabled" }));
  register("leditor:write-file", async () => ({ success: true }));
  register("leditor:export-ledoc", async () => ({ success: false, error: "disabled" }));
  register("leditor:export-docx", async () => ({ success: false, error: "disabled" }));
  register("leditor:import-ledoc", async () => ({ success: false, error: "disabled" }));
  register("leditor:get-default-ledoc-path", async () => ({ success: true, path: "" }));
  register("leditor:open-pdf-viewer", async () => ({ success: false, error: "disabled" }));
  register("leditor:pdf-viewer-payload", async () => null);
  register("leditor:resolve-pdf-path", async () => null);
  register("leditor:get-direct-quote-entry", async () => null);
  register("leditor:prefetch-direct-quotes", async () => ({ success: true, found: 0 }));
};

const readContentJson = (ledocPath) => {
  const contentPath = path.join(ledocPath, "content.json");
  if (!fs.existsSync(contentPath)) {
    throw new Error(`content.json not found in ${ledocPath}`);
  }
  const raw = fs.readFileSync(contentPath, "utf8");
  return JSON.parse(raw);
};

const run = async () => {
  const cliArgs = process.argv.slice(2).filter((arg) => typeof arg === "string");
  const positional = cliArgs.filter((arg) => !arg.startsWith("-"));
  const getFlagValue = (flag) => {
    const direct = cliArgs.find((arg) => arg.startsWith(`${flag}=`));
    if (direct) return direct.slice(flag.length + 1);
    const idx = cliArgs.indexOf(flag);
    if (idx >= 0 && cliArgs[idx + 1] && !cliArgs[idx + 1].startsWith("-")) {
      return cliArgs[idx + 1];
    }
    return null;
  };
  const docJsonFlag =
    getFlagValue("--doc-json") || getFlagValue("--doc") || getFlagValue("--input-json");
  const outputFlag = getFlagValue("--output") || getFlagValue("--out");
  const resolvedDocJson = docJsonFlag ? path.resolve(docJsonFlag) : null;
  const resolveIfLedoc = (value) => {
    if (!value) return null;
    const resolved = path.resolve(value);
    if (resolved.endsWith(".ledoc")) return resolved;
    const contentPath = path.join(resolved, "content.json");
    if (fs.existsSync(contentPath)) return resolved;
    return null;
  };
  const ledocArg = positional.map(resolveIfLedoc).find((value) => value) || null;
  const outputArg =
    outputFlag ||
    positional.find((value) => {
      if (!value || !value.endsWith(".json")) return false;
      if (!resolvedDocJson) return true;
      return path.resolve(value) !== resolvedDocJson;
    }) ||
    null;
  const inputLedoc = ledocArg || path.join(repoRoot, "..", "coder_state.ledoc");
  const outputPath = outputArg ? path.resolve(outputArg) : path.join(repoRoot, "pagination_debug_watch.json");

  const durationMs = Number.parseInt(process.env.PAGINATION_DEBUG_DURATION_MS || "12000", 10);
  const sampleMs = Number.parseInt(process.env.PAGINATION_DEBUG_SAMPLE_MS || "250", 10);
  const enableBlocks = process.env.PAGINATION_DEBUG_BLOCKS === "1";

  const docJson = resolvedDocJson ? JSON.parse(fs.readFileSync(resolvedDocJson, "utf8")) : readContentJson(inputLedoc);

  const tmpRoot = path.join(repoRoot, ".tmp_debug");
  try {
    fs.mkdirSync(tmpRoot, { recursive: true });
  } catch {
    // ignore
  }
  process.env.TMPDIR = tmpRoot;
  process.env.TMP = tmpRoot;
  process.env.TEMP = tmpRoot;
  app.setPath("userData", path.join(tmpRoot, "userData"));
  app.setPath("temp", path.join(tmpRoot, "temp"));

  app.commandLine.appendSwitch("headless");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.commandLine.appendSwitch("disable-features", "UsePortal");
  app.commandLine.appendSwitch("gtk-use-portal", "0");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

  registerIpcFallbacks();

  const killTimer = setTimeout(() => {
    console.error("[FAIL] pagination debug watch timed out");
    app.exit(1);
  }, Math.max(60_000, durationMs + 30_000));

  await app.whenReady();
  const showWindow = process.env.LEDITOR_DEBUG_SHOW === "1";
  const win = new BrowserWindow({
    show: showWindow,
    width: 1280,
    height: 900,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(repoRoot, "dist", "electron", "preload.js")
    }
  });
  try {
    win.webContents.setBackgroundThrottling(false);
  } catch {
    // ignore
  }

  try {
    await win.loadFile(indexHtml);
    console.log("[DEBUG] waiting for editor");
    await waitFor(win.webContents, "Boolean(window.leditor && window.leditor.getEditor)");
    await delay(400);

    const payload = JSON.stringify(docJson);
    await win.webContents.executeJavaScript(
      `
      (async () => {
        const editor = window.leditor?.getEditor?.();
        if (!editor || !window.leditor?.setContent) return false;
        window.__leditorPaginationDebug = true;
        window.__leditorPaginationDebugVerbose = true;
        window.__leditorPaginationDebugJson = true;
        window.__leditorPaginationTraceEnabled = true;
        window.__leditorPaginationTraceLimit = 2000;
        window.__leditorFootnoteLayoutDebug = true;
        if (${enableBlocks ? "true" : "false"}) {
          window.__leditorPaginationDebugBlocks = true;
        }
        window.leditor.setContent(${payload}, { format: "json" });
        try {
          window.leditor.execCommand?.("view.paginationMode.set", { mode: "paged" });
        } catch {}
        return true;
      })();
      `,
      true
    );

    console.log("[DEBUG] waiting for first layout tick");
    await delay(1500);

    const startedAt = Date.now();
    const samples = [];
    const sampleCount = Math.max(1, Math.ceil(durationMs / Math.max(50, sampleMs)));
    for (let i = 0; i < sampleCount; i += 1) {
      const snapshot = await win.webContents.executeJavaScript(
        `
        (() => {
          const editor = window.leditor?.getEditor?.();
          const doc = editor?.state?.doc;
          const pages = Array.from(document.querySelectorAll(".leditor-page"));
          const pageCountDom = pages.length;
          const pageContents = pages
            .map((page) => page.querySelector(".leditor-page-content"))
            .filter(Boolean);
          const pageCountDoc = typeof doc?.childCount === "number" ? doc.childCount : null;
          const widths = pageContents.map((content) => {
            const el = content;
            const clientWidth = el.clientWidth || 0;
            const scrollWidth = el.scrollWidth || 0;
            return {
              clientWidth,
              scrollWidth,
              ratio: clientWidth > 0 ? scrollWidth / clientWidth : 0
            };
          });
          const maxRatio = widths.reduce((m, w) => Math.max(m, w.ratio || 0), 0);
          const footnoteHeights = pages.map((page) =>
            Number.parseFloat(
              getComputedStyle(page).getPropertyValue("--page-footnote-height").trim() || "0"
            )
          );
          const maxFootnoteHeight = footnoteHeights.length
            ? Math.max(...footnoteHeights.filter((v) => Number.isFinite(v)))
            : 0;
          return {
            t: Date.now(),
            pageCountDom,
            pageCountDoc,
            docSize: typeof doc?.content?.size === "number" ? doc.content.size : null,
            docChildCount: typeof doc?.childCount === "number" ? doc.childCount : null,
            maxScrollRatio: Math.round(maxRatio * 1000) / 1000,
            maxFootnoteHeight,
            overflowActive: window.__leditorPaginationOverflowActive ?? null,
            overflowAt: window.__leditorPaginationOverflowAt ?? null,
            continuousMode: document.getElementById("leditor-app")?.classList.contains("leditor-app--pagination-continuous") || false,
            paginationOrigin: window.__leditorPaginationOrigin || null,
            paginationOriginAt: window.__leditorPaginationOriginAt || null,
            lastSetContentAt: window.__leditorLastSetContentAt || null,
            footnoteLayoutEpoch: window.__leditorFootnoteLayoutEpoch || null,
            footnoteLayoutChangedAt: window.__leditorFootnoteLayoutChangedAt || null,
            disablePaginationUntil: window.__leditorDisablePaginationUntil || null,
            engineSnapshotSig: window.__leditorPaginationLastSnapshotSig || null,
            enginePhase: window.__leditorPaginationLastPhase || null,
            engineAction: window.__leditorPaginationLastAction || null,
            engineOverflowPages: window.__leditorPaginationLastOverflowPages || null,
            engineStable: window.__leditorPaginationLastStable ?? null
          };
        })();
        `,
        true
      );
      samples.push(snapshot);
      await delay(Math.max(50, sampleMs));
    }

    const trace = await win.webContents.executeJavaScript(
      `
      (() => {
        try {
          return window.__leditorDumpPaginationTrace?.() ?? window.__leditorPaginationTrace ?? [];
        } catch {
          return [];
        }
      })();
      `,
      true
    );

    const report = {
      startedAt,
      durationMs,
      sampleMs,
      sampleCount: samples.length,
      samples,
      trace
    };
    const pageCounts = samples.map((s) => Number.isFinite(s.pageCountDoc) ? s.pageCountDoc : s.pageCountDom);
    const hasAbab = (() => {
      if (pageCounts.length < 6) return false;
      let cycles = 0;
      for (let i = 0; i + 3 < pageCounts.length; i += 1) {
        const a = pageCounts[i];
        const b = pageCounts[i + 1];
        const c = pageCounts[i + 2];
        const d = pageCounts[i + 3];
        if (a === c && b === d && a !== b) {
          cycles += 1;
          if (cycles > 1) return true;
        }
      }
      return false;
    })();
    if (hasAbab) {
      report.ababOscillation = true;
      report.traceTail = trace.slice(-40);
    }
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`[PASS] pagination debug watch report written: ${outputPath}`);

    clearTimeout(killTimer);
    await win.close();
    if (hasAbab) {
      app.exit(1);
      return;
    }
    app.exit(0);
  } catch (error) {
    clearTimeout(killTimer);
    console.error("[FAIL] pagination debug watch:", error?.message || error);
    app.exit(1);
  }
};

run().catch((error) => {
  console.error("[FAIL] pagination debug watch:", error?.message || error);
  app.exit(1);
});
