const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const indexHtml = path.join(repoRoot, "dist", "public", "index.html");
const PAGE_QUERY = ".leditor-page-stack";
const PAGE_FALLBACK_QUERY = ".leditor-page";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (webContents, script, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const ok = await webContents.executeJavaScript(script);
      if (ok) return;
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
  register("leditor:open-pdf-viewer", async () => ({ success: false, error: "disabled" }));
  register("leditor:pdf-viewer-payload", async () => null);
  register("leditor:resolve-pdf-path", async () => null);
  register("leditor:get-direct-quote-entry", async () => null);
  register("leditor:prefetch-direct-quotes", async () => ({ success: true, found: 0 }));
  register("leditor:get-default-ledoc-path", async () => ({ success: true, path: null }));
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
  const rawArgs = process.argv.slice(2);
  const dashDashIndex = rawArgs.indexOf("--");
  const trimmed = dashDashIndex >= 0 ? rawArgs.slice(dashDashIndex + 1) : rawArgs;
  const firstNonFlag = trimmed.findIndex((arg) => !String(arg).startsWith("-"));
  const args = firstNonFlag >= 0 ? trimmed.slice(firstNonFlag) : [];
  if (args[0] && String(args[0]).endsWith(".cjs") && fs.existsSync(args[0])) {
    args.shift();
  }
  const ledocPath = args[0] ? path.resolve(args[0]) : path.join(repoRoot, "..", "coder_state.ledoc");
  const pageIndex = Number.parseInt(args[1] || "15", 10);
  const outputPath = args[2]
    ? path.resolve(args[2])
    : path.join(repoRoot, `page_${Number.isFinite(pageIndex) ? pageIndex + 1 : "unknown"}_dump.json`);

  if (!Number.isFinite(pageIndex) || pageIndex < 0) {
    throw new Error(`invalid page index: ${args[1]}`);
  }

  const docJson = readContentJson(ledocPath);

  const tmpRoot = path.join(repoRoot, ".tmp_page_dump");
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.TMPDIR = tmpRoot;
  process.env.TMP = tmpRoot;
  process.env.TEMP = tmpRoot;
  app.setPath("userData", path.join(tmpRoot, "userData"));
  app.setPath("temp", path.join(tmpRoot, "temp"));

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
    console.error("[FAIL] page dump timed out");
    app.exit(1);
  }, 120_000);

  await app.whenReady();
  const showWindow = process.env.LEDITOR_DUMP_SHOW === "1";
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
    await waitFor(win.webContents, "Boolean(window.leditor && window.leditor.getEditor)");
    await delay(500);
    try {
      await win.webContents.executeJavaScript(
        `
        (() => {
          if (!window.__leditorPatchedRaf) {
            window.__leditorPatchedRaf = true;
            const nativeSetTimeout = window.setTimeout.bind(window);
            window.requestAnimationFrame = (cb) => nativeSetTimeout(() => cb(performance.now()), 0);
            window.cancelAnimationFrame = (id) => window.clearTimeout(id);
          }
          return true;
        })();
        `,
        true
      );
    } catch {
      // ignore raf patch failures
    }

    const payload = JSON.stringify(docJson);
    const payloadBase64 = Buffer.from(payload, "utf8").toString("base64");
    const disableFlatten = process.env.LEDITOR_DISABLE_FLATTEN !== "0";
    const setupResult = await win.webContents.executeJavaScript(
      `
      (() => {
        try {
          const __payload = JSON.parse(atob("${payloadBase64}"));
          if (${disableFlatten ? "true" : "false"}) {
            window.__leditorDisableFlatten = true;
          }
          window.leditor.setContent(__payload, { format: "json" });
          try {
            if (${disableFlatten ? "true" : "false"}) {
              window.__leditorPaginationOrigin = "script";
              window.__leditorPaginationOriginAt = 0;
              window.__leditorLastSetContentAt = 0;
              window.setTimeout(() => {
                try {
                  window.__leditorPaginationOrigin = "script";
                  window.__leditorPaginationOriginAt = 0;
                  window.__leditorLastSetContentAt = 0;
                } catch {}
              }, 50);
            }
          } catch {}
          try {
            if (window.leditor && typeof window.leditor.execCommand === "function") {
              window.leditor.execCommand("view.paginationMode.set", { mode: "paged" });
            }
          } catch {}
          try {
            const editor = window.leditor?.getEditor?.();
            const viewDom = editor?.view?.dom;
            if (viewDom) {
              viewDom.dispatchEvent(new CustomEvent("leditor:pagination-request", { bubbles: true }));
            }
          } catch {}
          return { ok: true };
        } catch (err) {
          return { ok: false, reason: String(err && err.message ? err.message : err) };
        }
      })();
      `,
      true
    );
    if (!setupResult || setupResult.ok !== true) {
      throw new Error(setupResult?.reason || "setup failed");
    }

    await waitFor(
      win.webContents,
      `(() => {
        const el = document.querySelector(".leditor-page-content");
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.height > 0 && rect.width > 0;
      })()`,
      30000
    );

    const report = await win.webContents.executeJavaScript(
      `
      (async () => {
        const PAGE_QUERY = ${JSON.stringify(PAGE_QUERY)};
        const PAGE_FALLBACK_QUERY = ${JSON.stringify(PAGE_FALLBACK_QUERY)};
        const getPages = () => {
          const stack = document.querySelector(PAGE_QUERY);
          const stackPages = stack ? Array.from(stack.querySelectorAll(".leditor-page")) : [];
          if (stackPages.length) return stackPages;
          return Array.from(document.querySelectorAll(PAGE_FALLBACK_QUERY));
        };
        const waitForStablePages = async () => {
          let lastCount = 0;
          let stable = 0;
          for (let i = 0; i < 80; i += 1) {
            const count = getPages().length;
            if (count === lastCount) stable += 1;
            else { stable = 0; lastCount = count; }
            if (stable >= 8 && count > 0) return count;
            await new Promise((r) => setTimeout(r, 150));
          }
          return getPages().length;
        };
        const pageCount = await waitForStablePages();
        const pages = getPages();
        const editor = window.leditor?.getEditor?.();
        const schemaHasPage = Boolean(editor?.schema?.nodes?.page);
        const memo = editor?.view?.__leditorPaginationMemo || null;
        const traceLen = Array.isArray(window.__leditorPaginationTrace)
          ? window.__leditorPaginationTrace.length
          : 0;
        const docPageCount = Number.isFinite(editor?.state?.doc?.childCount)
          ? editor.state.doc.childCount
          : null;
        const page = pages[${pageIndex}] || null;
        if (!page) {
          return {
            ok: false,
            reason: "page not found",
            pageCount,
            docPageCount,
            schemaHasPage,
            traceLen,
            hasMemo: Boolean(memo),
            pageIndex: ${pageIndex}
          };
        }
        const content = page.querySelector(".leditor-page-content");
        const blocks = content
          ? Array.from(content.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre"))
          : [];
        const contentRect = content ? content.getBoundingClientRect() : null;
        const contentChildren = content
          ? Array.from(content.children).slice(0, 20).map((child) => ({
              tag: child.tagName,
              className: child.className || ""
            }))
          : [];
        const normalize = (value) => String(value || "").replace(/\\u00a0/g, " ").replace(/\\s+/g, " ").trim();
        const fullText = normalize(content ? content.innerText || "" : "");
        const describeBlock = (block, index) => {
          const html = block.innerHTML || "";
          const brCount = (html.match(/<br\\b/gi) || []).length;
          const childTags = Array.from(block.children || []).map((el) => el.tagName);
          const rect = contentRect ? block.getBoundingClientRect() : null;
          const relBox = rect && contentRect
            ? {
                top: Math.round((rect.top - contentRect.top) * 10) / 10,
                bottom: Math.round((rect.bottom - contentRect.top) * 10) / 10,
                left: Math.round((rect.left - contentRect.left) * 10) / 10,
                right: Math.round((rect.right - contentRect.left) * 10) / 10,
                height: Math.round(rect.height * 10) / 10,
                width: Math.round(rect.width * 10) / 10
              }
            : null;
          const style = block instanceof HTMLElement ? window.getComputedStyle(block) : null;
          return {
            index,
            tag: block.tagName,
            text: normalize(block.innerText || ""),
            htmlSample: html.length > 900 ? html.slice(0, 900) + "…" : html,
            brCount,
            childTags,
            display: style ? style.display : null,
            whiteSpace: style ? style.whiteSpace : null,
            lineHeight: style ? style.lineHeight : null,
            rect: relBox
          };
        };
        const blockEntries = blocks.map(describeBlock);
        const blocksWithBreaks = blockEntries.filter((item) =>
          item.brCount > 0 ||
          item.whiteSpace === "pre" ||
          item.whiteSpace === "pre-line" ||
          item.whiteSpace === "pre-wrap"
        );
        return {
          ok: true,
          pageIndex: ${pageIndex},
          pageCount,
          docPageCount,
          schemaHasPage,
          traceLen,
          hasMemo: Boolean(memo),
          contentChildren,
          contentBox: contentRect
            ? {
                width: Math.round(contentRect.width * 10) / 10,
                height: Math.round(contentRect.height * 10) / 10
              }
            : null,
          fullText,
          blocks: blockEntries,
          blocksWithBreaks
        };
      })();
      `,
      true
    );

    if (!report || report.ok !== true) {
      throw new Error(report?.reason || "report failed");
    }
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`[PASS] page dump written: ${outputPath}`);
  } catch (err) {
    console.error("[FAIL] page dump error", err?.message || err);
    process.exitCode = 1;
  } finally {
    clearTimeout(killTimer);
    setTimeout(() => app.exit(process.exitCode || 0), 250);
  }
};

run();
