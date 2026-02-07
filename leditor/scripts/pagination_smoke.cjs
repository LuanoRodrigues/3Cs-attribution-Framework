const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const indexHtml = path.join(repoRoot, "dist", "public", "index.html");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (webContents, script, timeout = 20_000) => {
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
  const resolveIfLedoc = (value) => {
    if (!value) return null;
    const resolved = path.resolve(value);
    if (resolved.endsWith(".ledoc")) return resolved;
    const contentPath = path.join(resolved, "content.json");
    if (fs.existsSync(contentPath)) return resolved;
    return null;
  };
  const ledocArg = positional.map(resolveIfLedoc).find((value) => value) || null;
  const outputArg = positional.find((value) => value && value.endsWith(".json")) || null;
  const inputLedoc = ledocArg || path.join(repoRoot, "..", "coder_state.ledoc");
  const outputPath = outputArg ? path.resolve(outputArg) : path.join(repoRoot, "pagination_report.json");
  const minAvgLen = Number.parseFloat(process.env.MIN_AVG_LINE_LEN || "18");
  const minLines = Number.parseInt(process.env.MIN_LINES_PER_PAGE || "6", 10);
  const minFillRatio = Number.parseFloat(process.env.MIN_FILL_RATIO || "0.35");
  const forcePages = Number.parseInt(process.env.FORCE_PAGES || "0", 10);
  const enableDebug = process.env.PAGINATION_DEBUG === "1";

  const docJson = readContentJson(inputLedoc);

  const tmpRoot = path.join(repoRoot, ".tmp_headless");
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
    console.error("[FAIL] pagination smoke timed out");
    app.exit(1);
  }, 90_000);

  await app.whenReady();
  const showWindow = process.env.LEDITOR_SMOKE_SHOW === "1";
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
  const paginationLogs = [];
  win.webContents.on("console-message", (_event, _level, message) => {
    if (!message || typeof message !== "string") return;
    if (!message.includes("[PaginationDebug]")) return;
    paginationLogs.push(message);
  });

  try {
    await win.loadFile(indexHtml);
    await waitFor(win.webContents, "Boolean(window.leditor && window.leditor.getEditor)");
    await delay(400);

    const payload = JSON.stringify(docJson);
    const report = await win.webContents.executeJavaScript(
      `
      (async () => {
        const editor = window.leditor?.getEditor?.();
        if (!editor || !window.leditor?.setContent) {
          return { ok: false, reason: "editor missing" };
        }

        window.__leditorPaginationDebug = ${enableDebug ? "true" : "false"};
        window.leditor.setContent(${payload}, { format: "json" });
        try {
          window.leditor.execCommand?.("view.paginationMode.set", { mode: "paged" });
        } catch {
          // ignore if command unavailable
        }
        try {
          const waitForLayout = async () => {
            for (let i = 0; i < 60; i += 1) {
              const el = document.querySelector(".leditor-page-content");
              if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.height > 0 && rect.width > 0) return;
              }
              await new Promise((r) => setTimeout(r, 150));
            }
          };
          await waitForLayout();
        } catch {
          // ignore layout wait failures
        }

        const waitForStablePages = async () => {
          let lastCount = 0;
          let stable = 0;
          for (let i = 0; i < 40; i += 1) {
            const count = document.querySelectorAll(".leditor-page").length;
            if (count === lastCount) {
              stable += 1;
            } else {
              stable = 0;
              lastCount = count;
            }
            if (stable >= 5 && count > 0) return count;
            await new Promise((r) => setTimeout(r, 150));
          }
          return document.querySelectorAll(".leditor-page").length;
        };

        let pageCount = await waitForStablePages();
        if (pageCount < 2 || (${forcePages} > 0 && pageCount < ${forcePages})) {
          const target = Math.max(2, ${forcePages} || 2);
          const lorem =
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
            "Integer nec odio. Praesent libero. Sed cursus ante dapibus diam. ";
          const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
          let safety = 0;
          while (pageCount < target && safety < 40) {
            editor.commands.insertContent(para(lorem.repeat(40)));
            await new Promise((r) => setTimeout(r, 120));
            pageCount = document.querySelectorAll(".leditor-page").length;
            safety += 1;
          }
        }
        const pages = Array.from(document.querySelectorAll(".leditor-page"));
        const pageReports = pages.map((page, pageIndex) => {
          const content = page.querySelector(".leditor-page-content");
          if (!content) return { pageIndex, error: "missing content" };
          const blocks = Array.from(content.children);
          const contentRect = content.getBoundingClientRect();
          const style = getComputedStyle(content);
          const pageStyle = getComputedStyle(page);
          const paddingBottom = parseFloat(style.paddingBottom || "0") || 0;
          const baseHeight = content.clientHeight || parseFloat(style.height || "0") || 0;
          const usableHeight = Math.max(0, baseHeight - paddingBottom);
          const baseWidth = content.clientWidth || parseFloat(style.width || "0") || 0;
          const lineEntries = [];
          const blockEntries = [];
          let lastBottom = 0;
          blocks.forEach((block, blockIndex) => {
            const text = (block.innerText || "")
              .replace(/\\u00a0/g, " ")
              .replace(/\\r\\n/g, "\\n")
              .replace(/\\r/g, "\\n");
            const lines = text
              .split("\\n")
              .map((line) => line.replace(/\\s+$/g, ""))
              .filter((line) => line.trim().length > 0);
            const range = document.createRange();
            range.selectNodeContents(block);
            const rects = Array.from(range.getClientRects());
            const blockRect = block.getBoundingClientRect();
            const marginBottom = parseFloat(getComputedStyle(block).marginBottom || "0") || 0;
            const blockBottom = blockRect.bottom - contentRect.top + marginBottom;
            if (blockBottom > lastBottom) lastBottom = blockBottom;
            const lineMetrics = lines.map((line, idx) => ({
              len: line.length,
              width: rects[idx] ? rects[idx].width : null,
              text: line
            }));
            lineEntries.push(...lineMetrics);
            blockEntries.push({
              blockIndex,
              tag: block.tagName,
              lineCount: lines.length,
              lines: lineMetrics
            });
          });

          const totalLines = lineEntries.length;
          const avgLen =
            totalLines > 0
              ? lineEntries.reduce((sum, line) => sum + (line.len || 0), 0) / totalLines
              : 0;
          const shortLines = lineEntries.filter((line) => (line.len || 0) <= 3).length;
          const shortLineRatio = totalLines > 0 ? shortLines / totalLines : 0;
          const fillRatio = usableHeight > 0 ? Math.min(1, lastBottom / usableHeight) : 0;

          return {
            pageIndex,
            blockCount: blocks.length,
            totalLines,
            avgLineLen: avgLen,
            shortLineRatio,
            contentHeight: usableHeight,
            paddingBottom,
            contentWidth: baseWidth,
            contentRectWidth: contentRect.width,
            pageRectWidth: page.getBoundingClientRect().width,
            marginLeft: pageStyle.getPropertyValue("--local-page-margin-left") || "",
            marginRight: pageStyle.getPropertyValue("--local-page-margin-right") || "",
            lastBottom,
            fillRatio,
            lines: lineEntries,
            blocks: blockEntries
          };
        });

        const suspects = pageReports
          .filter((page) => !page.error)
          .map((page) => {
            const shortAvg = page.avgLineLen < ${minAvgLen};
            const lowLines = page.totalLines < ${minLines};
            const underfill = page.fillRatio < ${minFillRatio};
            const wordWrap = page.shortLineRatio > 0.35;
            if (!shortAvg && !lowLines && !underfill && !wordWrap) return null;
            return {
              pageIndex: page.pageIndex,
              avgLineLen: page.avgLineLen,
              totalLines: page.totalLines,
              fillRatio: page.fillRatio,
              shortLineRatio: page.shortLineRatio,
              shortAvg,
              lowLines,
              underfill,
              wordWrap
            };
          })
          .filter(Boolean);

        return { ok: true, pageCount, pages: pageReports, suspects };
      })();
      `,
      true
    );

    if (!report || !report.ok) {
      throw new Error("Pagination report failed: " + JSON.stringify(report));
    }

    const finalReport = { ...report, paginationLogs };
    fs.writeFileSync(outputPath, JSON.stringify(finalReport, null, 2), "utf8");
    console.log(`[PASS] pagination report written: ${outputPath}`);

    clearTimeout(killTimer);
    await win.close();
    app.exit(0);
  } catch (error) {
    clearTimeout(killTimer);
    console.error("[FAIL] pagination smoke:", error?.message || error);
    app.exit(1);
  }
};

run().catch((error) => {
  console.error("[FAIL] pagination smoke:", error?.message || error);
  app.exit(1);
});
