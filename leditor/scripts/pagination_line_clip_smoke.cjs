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
    await delay(200);
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
  const outputPath = outputArg ? path.resolve(outputArg) : path.join(repoRoot, "pagination_line_clip_report.json");
  const maxGapLines = Number.parseFloat(process.env.MAX_GAP_LINES || "1.6");
  const maxClipPx = Number.parseFloat(process.env.MAX_CLIP_PX || "1.5");
  const enableDebug = process.env.PAGINATION_DEBUG === "1";
  const enableDebugVerbose = process.env.PAGINATION_DEBUG_VERBOSE === "1";

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

  registerIpcFallbacks();

  const killTimer = setTimeout(() => {
    console.error("[FAIL] line clip smoke timed out");
    app.exit(1);
  }, 90_000);

  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(repoRoot, "dist", "electron", "preload.js")
    }
  });
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
        window.__leditorPaginationDebugVerbose = ${enableDebugVerbose ? "true" : "false"};
        window.leditor.setContent(${payload}, { format: "json" });
        try {
          window.leditor.execCommand?.("view.paginationMode.set", { mode: "paged" });
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 200));
        try {
          window.__leditorDisablePaginationUntil = 0;
          const viewDom = editor?.view?.dom;
          if (viewDom) {
            viewDom.dispatchEvent(new CustomEvent("leditor:pagination-request", { bubbles: true }));
          }
        } catch {
          // ignore
        }
        const waitForStablePages = async () => {
          let lastCount = 0;
          let stable = 0;
          for (let i = 0; i < 60; i += 1) {
            const count = document.querySelectorAll(".leditor-page").length;
            if (count === lastCount) {
              stable += 1;
            } else {
              stable = 0;
              lastCount = count;
            }
            if (count < 3 && i % 10 === 0) {
              try {
                window.leditor.execCommand?.("view.paginationMode.set", { mode: "paged" });
                const viewDom = editor?.view?.dom;
                if (viewDom) {
                  viewDom.dispatchEvent(new CustomEvent("leditor:pagination-request", { bubbles: true }));
                }
              } catch {
                // ignore
              }
            }
            if (stable >= 5 && count > 0) return count;
            await new Promise((r) => setTimeout(r, 150));
          }
          return document.querySelectorAll(".leditor-page").length;
        };
        const finalPageCount = await waitForStablePages();

        const collectLineRects = (node) => {
          const rects = [];
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let textNode = walker.nextNode();
          while (textNode) {
            const text = textNode.nodeValue || "";
            if (text.trim().length > 0) {
              const range = document.createRange();
              range.selectNodeContents(textNode);
              const nodeRects = Array.from(range.getClientRects());
              nodeRects.forEach((rect) => {
                if (rect.height > 0 && rect.width > 0) {
                  rects.push(rect);
                }
              });
            }
            textNode = walker.nextNode();
          }
          return rects;
        };

        const pages = Array.from(document.querySelectorAll(".leditor-page"));
        const footnoteEditing = document.documentElement.classList.contains("leditor-footnote-editing");
        const BLOCK_SELECTOR = [
          "p",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "li",
          "blockquote",
          "pre",
          "table",
          "figure",
          "hr",
          ".leditor-break"
        ].join(", ");
        const getContentChildren = (content) => {
          let container = content;
          if (content.children.length === 1) {
            const only = content.children[0];
            if (
              only &&
              only instanceof HTMLElement &&
              (only.classList.contains("ProseMirror") || only.getAttribute("contenteditable") === "true")
            ) {
              container = only;
            }
          }
          const blocks = Array.from(container.querySelectorAll(BLOCK_SELECTOR)).filter(
            (el) => el instanceof HTMLElement && el.closest(".leditor-page-content") === content
          );
          if (blocks.length > 0) return blocks;
          return Array.from(container.children || []);
        };
        const results = pages.map((page, pageIndex) => {
          const content = page.querySelector(".leditor-page-content");
          if (!content) {
            return { pageIndex, error: "missing content" };
          }
          const contentRect = content.getBoundingClientRect();
          const style = getComputedStyle(content);
          const paddingBottom = parseFloat(style.paddingBottom || "0") || 0;
          const baselinePadRaw = style.getPropertyValue("--page-baseline-pad") || "0";
          const baselinePad = parseFloat(baselinePadRaw) || 0;
          const lineFitRaw = style.getPropertyValue("--page-line-fit-pad") || "0";
          const lineFitPad = parseFloat(lineFitRaw) || 0;
          const lineHeightRaw = style.lineHeight || "";
          let lineHeight = Number.parseFloat(lineHeightRaw) || 0;
          if (!lineHeight || !Number.isFinite(lineHeight)) {
            const sample = content.querySelector("p, h1, h2, h3, h4, h5, h6, li, blockquote");
            if (sample) {
              const sampleStyle = getComputedStyle(sample);
              const sampleLine = Number.parseFloat(sampleStyle.lineHeight || "");
              if (Number.isFinite(sampleLine) && sampleLine > 0) {
                lineHeight = sampleLine;
              } else {
                const sampleFont = Number.parseFloat(sampleStyle.fontSize || "");
                if (Number.isFinite(sampleFont) && sampleFont > 0) {
                  lineHeight = sampleFont * 1.2;
                }
              }
            }
          }
          const blockChildren = getContentChildren(content);
          const lastBlock = blockChildren[blockChildren.length - 1] || null;
          const lastBlockTag = lastBlock ? lastBlock.tagName : null;
          const lastBlockPreview = lastBlock
            ? (lastBlock.textContent || "").trim().slice(0, 120)
            : null;
          const lastBlockMarginBottom = lastBlock
            ? parseFloat(getComputedStyle(lastBlock).marginBottom || "0") || 0
            : 0;
          const lastBlockRect = lastBlock ? lastBlock.getBoundingClientRect() : null;
          const textLen = (content.textContent || "").trim().length;
          let baseHeight =
            content.clientHeight ||
            parseFloat(style.height || "0") ||
            parseFloat(style.maxHeight || "0") ||
            contentRect.height ||
            0;
          const scale = baseHeight > 0 && contentRect.height > 0 ? contentRect.height / baseHeight : 1;
          let usableHeight = Math.max(0, baseHeight - paddingBottom);
          if (lineHeight && Number.isFinite(lineHeight) && usableHeight > lineHeight) {
            const aligned = Math.floor(usableHeight / lineHeight) * lineHeight;
            if (aligned > 0) {
              usableHeight = aligned;
              baseHeight = usableHeight + paddingBottom;
            }
          }
          const rects = collectLineRects(content).filter((rect) => rect.bottom >= contentRect.top);
          let lastBottom = null;
          rects.forEach((rect) => {
            const relBottom = (rect.bottom - contentRect.top) / scale;
            if (lastBottom == null || relBottom > lastBottom) {
              lastBottom = relBottom;
            }
          });
          const guard = lineHeight && Number.isFinite(lineHeight) ? Math.max(2, lineHeight * 0.2) : 2;
          const bottomLimit = Math.max(0, usableHeight - guard);
          const gap = lastBottom == null ? bottomLimit : bottomLimit - lastBottom;
          const clip = lastBottom == null ? 0 : lastBottom - bottomLimit;
          return {
            pageIndex,
            paddingBottom,
            baselinePad,
            lineFitPad,
            lineHeight,
            bottomLimit,
            lastBottom,
            gap,
            clip,
            blockCount: blockChildren.length,
            textLen,
            lastBlockTag,
            lastBlockPreview,
            lastBlockMarginBottom,
            lastBlockRect: lastBlockRect
              ? {
                  top: lastBlockRect.top,
                  bottom: lastBlockRect.bottom,
                  height: lastBlockRect.height
                }
              : null
          };
        });
        return { ok: true, pages: results, footnoteEditing };
      })();
      `,
      true
    );

    if (!report?.ok) {
      throw new Error(report?.reason || "unknown error");
    }
    const pages = report.pages || [];
    const failures = [];
    const warnings = [];
    pages.forEach((entry) => {
      if (!entry || entry.error) {
        failures.push({ type: "missing", entry });
        return;
      }
      const lineHeight = entry.lineHeight || 14;
      const gapLines = entry.gap / lineHeight;
      if (entry.clip > maxClipPx) {
        failures.push({ type: "clip", entry });
      } else if (entry.clip > maxClipPx * 0.5) {
        warnings.push({ type: "clip-warning", entry });
      }
      if (gapLines > maxGapLines) {
        failures.push({ type: "gap", entry });
      } else if (gapLines > maxGapLines * 0.75) {
        warnings.push({ type: "gap-warning", entry });
      }
    });

    const output = {
      ok: failures.length === 0,
      pages,
      failures,
      warnings,
      paginationLogs,
      footnoteEditing: report.footnoteEditing || false
    };
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    if (failures.length > 0) {
      console.error(`[FAIL] line clip smoke found ${failures.length} failures`);
      failures.slice(0, 8).forEach((failure) => {
        console.error(`[FAIL] ${failure.type}`, failure.entry);
      });
      process.exitCode = 1;
    } else {
      console.log("[PASS] line clip smoke");
      if (warnings.length > 0) {
        console.warn(`[WARN] line clip warnings: ${warnings.length}`);
      }
    }
  } finally {
    clearTimeout(killTimer);
    try {
      win.destroy();
    } catch {
      // ignore
    }
    app.exit(process.exitCode || 0);
  }
};

run().catch((error) => {
  console.error("[FAIL] line clip smoke error", error);
  app.exit(1);
});
