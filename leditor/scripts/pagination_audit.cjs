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

const normalizeText = (value) =>
  String(value || "")
    .replace(/\u00a0/g, " ")
    // Fix common UTF-8 mojibake sequences (e.g. â from en dash).
    .replace(/\u00e2\u0080\u0091/g, "-")
    .replace(/\u00e2\u0080\u0093/g, "-")
    .replace(/\u00e2\u0080\u0094/g, "-")
    .replace(/\u00e2\u0080\u0098/g, "'")
    .replace(/\u00e2\u0080\u0099/g, "'")
    .replace(/\u00e2\u0080\u009c/g, "\"")
    .replace(/\u00e2\u0080\u009d/g, "\"")
    // Strip remaining C1 controls that often appear in mojibake.
    .replace(/[\u0080-\u009f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLoose = (value) =>
  normalizeText(value)
    .replace(/\([^)]+\)/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const loadExpectations = (pathValue) => {
  if (!pathValue) return null;
  const resolved = path.resolve(pathValue);
  if (!fs.existsSync(resolved)) {
    throw new Error(`expected fragments file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.fragments)) return parsed.fragments;
  if (Array.isArray(parsed.expectedPages)) return parsed.expectedPages;
  throw new Error(`expected fragments file has unknown shape: ${resolved}`);
};

const expectedPages = [
  {
    pageNumber: 5,
    label: "page5_fragment",
    match: "contains",
    mustInclude:
      "In practice the evidentiary shortfall is not merely academic: researchers traced espionage hosts to a country but explicitly"
  },
  {
    pageNumber: 10,
    label: "page10_fragment",
    match: "contains",
    mustInclude:
      "invest in confidence-building mechanisms (CBMs), notifications, and hotlines to manage mis-signalling. Scholars propose due-diligence framing and notification mechanisms"
  }
];

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
  const cliArgs = process.argv.slice(2).filter((arg) => typeof arg === "string");
  const expectIndex = cliArgs.findIndex((arg) => arg === "--expect" || arg === "--expected");
  let expectedPathArg = null;
  if (expectIndex >= 0) {
    expectedPathArg = cliArgs[expectIndex + 1] || null;
  }
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
  const outputPath = outputArg ? path.resolve(outputArg) : path.join(repoRoot, "pagination_audit.json");
  const expectedOverride = expectedPathArg ? loadExpectations(expectedPathArg) : null;
  const minAvgLen = Number.parseFloat(process.env.MIN_AVG_LINE_LEN || "18");
  const minLines = Number.parseInt(process.env.MIN_LINES_PER_PAGE || "6", 10);
  const minFillRatio = Number.parseFloat(process.env.MIN_FILL_RATIO || "0.35");
  const maxRemainingLines = Number.parseInt(process.env.MAX_REMAINING_LINES || "2", 10);
  const allowHeadless = process.env.LEDITOR_HEADLESS === "1";

  const docJson = readContentJson(inputLedoc);

  const tmpRoot = path.join(repoRoot, ".tmp_audit");
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.TMPDIR = tmpRoot;
  process.env.TMP = tmpRoot;
  process.env.TEMP = tmpRoot;
  app.setPath("userData", path.join(tmpRoot, "userData"));
  app.setPath("temp", path.join(tmpRoot, "temp"));

  if (allowHeadless) {
    app.commandLine.appendSwitch("headless");
  }
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
    console.error("[FAIL] pagination audit timed out");
    app.exit(1);
  }, 120_000);

  await app.whenReady();
  const showWindow = process.env.LEDITOR_AUDIT_SHOW === "1";
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
  const consoleLogPath = path.join(repoRoot, "pagination_logs.txt");
  try { fs.writeFileSync(consoleLogPath, "", "utf8"); } catch {}
  win.webContents.on("console-message", (_event, _level, message) => {
    if (!message || typeof message !== "string") return;
    paginationLogs.push(message);
    try { fs.appendFileSync(consoleLogPath, message + "\n"); } catch {}
  });

  try {
    await win.loadFile(indexHtml);
    await waitFor(win.webContents, "Boolean(window.leditor && window.leditor.getEditor)");
    await delay(600);
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
    let setupResult;
    try {
      setupResult = await win.webContents.executeJavaScript(
        `
        (() => {
          try {
            const __payload = JSON.parse(atob("${payloadBase64}"));
            window.__leditorPaginationDebug = true;
            window.__leditorPaginationDebugJson = true;
            window.__leditorPaginationDebugVerbose = true;
            window.__leditorPaginationDebugBlocks = true;
            window.__leditorDisableFlatten = true;
            window.leditor.setContent(__payload, { format: "json" });
            try {
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
            } catch {}
            try {
              if (window.leditor && typeof window.leditor.execCommand === "function") {
                window.leditor.execCommand("view.paginationMode.set", { mode: "paged" });
              }
            } catch (err) {}
            try {
              window.__leditorDisablePaginationUntil = 0;
              const editor = window.leditor?.getEditor?.();
              const viewDom = editor?.view?.dom;
              if (viewDom) {
                viewDom.dispatchEvent(new CustomEvent("leditor:pagination-request", { bubbles: true }));
              }
            } catch (err) {}
            return { ok: true };
          } catch (err) {
            return { ok: false, reason: String(err && err.message ? err.message : err) };
          }
        })();
        `,
        true
      );
    } catch (err) {
      console.error("[FAIL] setup script failed", err?.message || err);
      throw err;
    }
    if (!setupResult || setupResult.ok !== true) {
      throw new Error(setupResult?.reason || "setup failed");
    }
    try {
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
    } catch (err) {
      console.warn("[WARN] layout metrics not ready before audit", err?.message || err);
    }

    const waitForStablePages = async () => {
      let lastCount = 0;
      let stable = 0;
      for (let i = 0; i < 80; i += 1) {
        const count = await win.webContents.executeJavaScript(
          `
          (() => {
            const stack = document.querySelector(${JSON.stringify(PAGE_QUERY.replace(/\"/g, '\\"'))});
            return stack
              ? stack.querySelectorAll(".leditor-page").length
              : document.querySelectorAll(${JSON.stringify(PAGE_FALLBACK_QUERY.replace(/\"/g, '\\"'))}).length;
          })();
          `,
          true
        );
        if (count === lastCount) stable += 1;
        else {
          stable = 0;
          lastCount = count;
        }
        if (stable >= 8 && count > 0) return count;
        await delay(150);
      }
      return win.webContents.executeJavaScript(
        `
        (() => {
          const stack = document.querySelector(${JSON.stringify(PAGE_QUERY.replace(/\"/g, '\\"'))});
          return stack
            ? stack.querySelectorAll(".leditor-page").length
            : document.querySelectorAll(${JSON.stringify(PAGE_FALLBACK_QUERY.replace(/\"/g, '\\"'))}).length;
        })();
        `,
        true
      );
    };

    const waitForDocDomSync = async () => {
      let stable = 0;
      let lastDoc = 0;
      let lastDom = 0;
      for (let i = 0; i < 80; i += 1) {
        const state = await win.webContents.executeJavaScript(
          `
          (() => {
            const editor = window.leditor?.getEditor?.();
            const docCount = editor?.state?.doc?.childCount ?? 0;
            const stack = document.querySelector(${JSON.stringify(PAGE_QUERY.replace(/\"/g, '\\"'))});
            const domCount = stack
              ? stack.querySelectorAll(".leditor-page").length
              : document.querySelectorAll(${JSON.stringify(PAGE_FALLBACK_QUERY.replace(/\"/g, '\\"'))}).length;
            return { docCount, domCount };
          })();
          `,
          true
        );
        if (state.docCount === state.domCount && state.docCount > 0) {
          if (state.docCount === lastDoc && state.domCount === lastDom) {
            stable += 1;
          } else {
            stable = 0;
            lastDoc = state.docCount;
            lastDom = state.domCount;
          }
        } else {
          stable = 0;
          lastDoc = state.docCount;
          lastDom = state.domCount;
        }
        if (stable >= 6) return state;
        await delay(150);
      }
      return { docCount: lastDoc, domCount: lastDom };
    };

    let report;
    try {
      report = await win.webContents.executeJavaScript(
        `
        (async () => {
          console.info("[PaginationAudit] report start");
          try {
          const BLOCK_SELECTOR = ${JSON.stringify(BLOCK_SELECTOR)};
          const PAGE_QUERY = ${JSON.stringify(PAGE_QUERY)};
          const PAGE_FALLBACK_QUERY = ${JSON.stringify(PAGE_FALLBACK_QUERY)};
          const getPages = () => {
            const stack = document.querySelector(PAGE_QUERY);
            const stackPages = stack ? Array.from(stack.querySelectorAll(".leditor-page")) : [];
            if (stackPages.length) return stackPages;
            return Array.from(document.querySelectorAll(PAGE_FALLBACK_QUERY));
          };
            const __auditNormalizeText = (value) => { const nbsp = String.fromCharCode(160); return String(value || "").split(nbsp).join(" ").replace(/\\s+/g, " ").trim(); };
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
          const waitForDocDomSync = async () => {
            let stable = 0;
            let lastDoc = 0;
            let lastDom = 0;
            for (let i = 0; i < 80; i += 1) {
              const editor = window.leditor?.getEditor?.();
              const docCount = editor?.state?.doc?.childCount ?? 0;
              const domCount = getPages().length;
              if (docCount === domCount && docCount > 0) {
                if (docCount === lastDoc && domCount === lastDom) {
                  stable += 1;
                } else {
                  stable = 0;
                  lastDoc = docCount;
                  lastDom = domCount;
                }
              } else {
                stable = 0;
                lastDoc = docCount;
                lastDom = domCount;
              }
              if (stable >= 6) return { docCount, domCount };
              await new Promise((r) => setTimeout(r, 150));
            }
            return { docCount: lastDoc, domCount: lastDom };
          };
          const syncState = await waitForDocDomSync();
          const pages = getPages();
          const stableCount = await waitForStablePages();
          const pageCount = syncState?.domCount || pages.length || stableCount;
          const editor = window.leditor
            ? typeof window.leditor.getEditor === "function"
              ? window.leditor.getEditor()
              : window.leditor.editor
            : null;
          const getPageContent = (index) =>
            pages[index] ? pages[index].querySelector(".leditor-page-content") : null;
          const isFootnoteElement = (el) =>
            !!el &&
            (el.matches("[data-footnotes-container], .leditor-footnotes-container, [data-footnote-body], .leditor-footnote-body") ||
              el.closest("[data-footnotes-container], .leditor-footnotes-container, [data-footnote-body], .leditor-footnote-body"));
          const collectBlocks = (content) => {
            if (!content) return [];
            const all = Array.from(content.querySelectorAll(BLOCK_SELECTOR));
            const filtered = all.filter((el) => {
              if (!(el instanceof HTMLElement)) return false;
              if (isFootnoteElement(el)) return false;
              if (el.closest(".leditor-page-content") !== content) return false;
              let parent = el.parentElement;
              while (parent && parent !== content) {
                if (parent.matches && parent.matches(BLOCK_SELECTOR)) return false;
                if (isFootnoteElement(parent)) return false;
                parent = parent.parentElement;
              }
              return true;
            });
            return filtered.length ? filtered : Array.from(content.children);
          };
          const countBr = (root) => {
            if (!root) return 0;
            const brs = Array.from(root.querySelectorAll("br"));
            return brs.filter((br) => !isFootnoteElement(br)).length;
          };
          const findTextNode = (root, fromStart) => {
            if (!root) return null;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
              acceptNode: (node) => {
                if (!node || !node.nodeValue || !node.nodeValue.trim().length) return NodeFilter.FILTER_SKIP;
                const parent = node.parentElement;
                if (parent && isFootnoteElement(parent)) return NodeFilter.FILTER_SKIP;
                return NodeFilter.FILTER_ACCEPT;
              }
            });
            if (fromStart) {
              return walker.nextNode();
            }
            let last = null;
            while (walker.nextNode()) {
              last = walker.currentNode;
            }
            return last;
          };
          const getPosAt = (node, offset) => {
            if (!editor || !editor.view || !node) return null;
            try {
              return editor.view.posAtDOM(node, offset);
            } catch (err) {
              return null;
            }
          };
          const resolveLineHeightPx = (style) => {
            const raw = String(style.lineHeight || "").trim();
            const fontSize = parseFloat(style.fontSize || "0") || 16;
            let parsed = 0;
            if (raw.endsWith("px")) {
              parsed = parseFloat(raw) || 0;
            } else {
              const unitless = parseFloat(raw);
              if (Number.isFinite(unitless) && unitless > 0) {
                parsed = unitless * fontSize;
              }
            }
            if (!Number.isFinite(parsed) || parsed <= 0) {
              parsed = fontSize * 1.2;
            }
            return parsed;
          };
          const computeMaxLines = (contentHeight, paddingBottom, lineHeight) => {
            const tolerancePx = 1;
            if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0;
            const raw = (contentHeight - paddingBottom + tolerancePx) / lineHeight;
            if (!Number.isFinite(raw)) return 0;
            return Math.max(0, Math.floor(raw));
          };
          const computeUsedLines = (scrollHeight, paddingBottom, lineHeight) => {
            if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0;
            const raw = (scrollHeight - paddingBottom) / lineHeight;
            if (!Number.isFinite(raw)) return 0;
            return Math.max(0, Math.ceil(raw));
          };
          const getContentMetrics = (content) => {
            if (!content) return null;
            const style = getComputedStyle(content);
            const paddingBottom = parseFloat(style.paddingBottom || "0") || 0;
            const lineHeight = resolveLineHeightPx(style);
            const rect = content.getBoundingClientRect();
            const tokenHeight = parseFloat(style.getPropertyValue("--doc-content-height") || "");
            const baseHeight =
              content.clientHeight ||
              rect.height ||
              parseFloat(style.height || "0") ||
              (Number.isFinite(tokenHeight) ? tokenHeight : 0) ||
              0;
            const usableHeight = Math.max(0, baseHeight - paddingBottom);
            const maxLines = computeMaxLines(baseHeight, paddingBottom, lineHeight);
            const usedLines = computeUsedLines(content.scrollHeight || 0, paddingBottom, lineHeight);
            const remainingLines = Math.max(0, maxLines - usedLines);
            return { usableHeight, paddingBottom, lineHeight, maxLines, usedLines, remainingLines };
          };
          const pageReports = pages.map((page, pageIndex) => {
            const content = page.querySelector(".leditor-page-content");
            if (!content) return { pageIndex, error: "missing content" };
            const blocks = collectBlocks(content);
            const nbspChar = String.fromCharCode(160);
            const contentRect = content.getBoundingClientRect();
            const style = getComputedStyle(content);
            const paddingBottom = parseFloat(style.paddingBottom || "0") || 0;
            const lineHeight = resolveLineHeightPx(style);
            const rectHeight = contentRect.height || 0;
            const clientHeight = content.clientHeight || 0;
            const offsetHeight = content.offsetHeight || 0;
            const scrollHeight = content.scrollHeight || 0;
            const tokenHeight = parseFloat(style.getPropertyValue("--doc-content-height") || "");
            const baseHeight =
              clientHeight ||
              rectHeight ||
              parseFloat(style.height || "0") ||
              (Number.isFinite(tokenHeight) ? tokenHeight : 0) ||
              0;
            const usableHeight = Math.max(0, baseHeight - paddingBottom);
            const maxLines = computeMaxLines(baseHeight, paddingBottom, lineHeight);
            const usedLines = computeUsedLines(scrollHeight, paddingBottom, lineHeight);
            const remainingLines = Math.max(0, maxLines - usedLines);
            const contentWidth = contentRect.width || content.clientWidth || 0;
            const getVisualLineRects = (element) => {
              if (!element) return [];
              try {
                const range = document.createRange();
                range.selectNodeContents(element);
                const rects = Array.from(range.getClientRects());
                const buckets = new Map();
                rects.forEach((rect) => {
                  const key = Math.round(rect.top);
                  if (!buckets.has(key)) buckets.set(key, rect);
                });
                return Array.from(buckets.values());
              } catch (err) {
                return [];
              }
            };
            let lastBottom = 0;
            let lastLineBottom = 0;
            let lastVisibleLineBottom = 0;
            const allLineWidths = [];
            const allLineRatios = [];
            let lineTextCount = 0;
            let singleWordLineCount = 0;
            const pageBrCount = countBr(content);
            const blockEntries = blocks.map((block, blockIndex) => {
              const rect = block.getBoundingClientRect();
              lastBottom = Math.max(lastBottom, rect.bottom - contentRect.top);
              const text = (block.innerText || "").split(nbspChar).join(" ");
              const normalizedText = text.replace(/\s+/g, " ").trim();
              const wordCount = normalizedText.length ? normalizedText.split(/\s+/).length : 0;
              const textLength = normalizedText.length;
              const nodeId = block.getAttribute("data-leditor-node-id") || null;
              const isBreak = block.classList?.contains("leditor-break") || false;
              const lineTexts = text
                .split("\\n")
                .map((line) => line.replace(/\\s+/g, " ").trim())
                .filter((line) => line.length > 0);
              const lineWordCounts = lineTexts.map((line) => line.split(/\\s+/).filter(Boolean).length);
              const blockSingleWordLines = lineWordCounts.filter((count) => count === 1).length;
              lineTextCount += lineTexts.length;
              singleWordLineCount += blockSingleWordLines;
              const visualRects = getVisualLineRects(block);
              if (visualRects.length) {
                visualRects.forEach((lineRect) => {
                  const relativeBottom = lineRect.bottom - contentRect.top;
                  lastLineBottom = Math.max(lastLineBottom, relativeBottom);
                  if (lineRect.bottom <= contentRect.bottom + 1) {
                    lastVisibleLineBottom = Math.max(lastVisibleLineBottom, relativeBottom);
                  }
                  const width = Math.max(0, lineRect.width || (lineRect.right - lineRect.left));
                  if (Number.isFinite(width) && width > 0) {
                    allLineWidths.push(width);
                    if (contentWidth > 0) {
                      allLineRatios.push(width / contentWidth);
                    }
                  }
                });
              }
              const visualLineCount = visualRects.length || (text.trim().length ? 1 : 0);
              const blockBrCount = countBr(block);
              return {
                index: blockIndex,
                tag: block.tagName,
                className: block.className || "",
                wordCount,
                textLength,
                nodeId,
                isBreak,
                lineCount: visualLineCount,
                brCount: blockBrCount,
                singleWordLines: blockSingleWordLines,
                sample: text.split("\\n").slice(0, 2)
              };
            });
            const allLines = blockEntries.flatMap((block) => {
              if (block.lineCount <= 0) return [];
              return new Array(block.lineCount).fill("");
            });
            const rawText = blocks.map((block) => block.innerText || "").join("\\n\\n");
            const fullText = __auditNormalizeText(rawText);
            const textLength = fullText.length;
            const lineLens = allLines.length
              ? new Array(allLines.length).fill(Math.max(1, Math.round(textLength / allLines.length)))
              : [];
            const avgLineLen = lineLens.length ? lineLens.reduce((a, b) => a + b, 0) / lineLens.length : 0;
            const shortLines = lineLens.filter((len) => len <= 3).length;
            const wordCount = fullText.trim().length ? fullText.trim().split(/\s+/).length : 0;
            const avgWordsPerLine = lineLens.length ? wordCount / lineLens.length : 0;
            const singleWordLines = avgWordsPerLine > 0 && avgWordsPerLine < 1.2 ? lineLens.length : 0;
            const narrowLineCount = allLineRatios.filter((ratio) => ratio <= 0.25).length;
            const narrowLineRatio = allLineRatios.length ? narrowLineCount / allLineRatios.length : 0;
            const avgLineWidth = allLineWidths.length
              ? allLineWidths.reduce((sum, width) => sum + width, 0) / allLineWidths.length
              : 0;
            const effectiveBottom =
              lastVisibleLineBottom > 0
                ? lastVisibleLineBottom
                : lastLineBottom > 0
                  ? lastLineBottom
                  : lastBottom;
            const fillRatio = maxLines > 0 ? Math.min(1, usedLines / maxLines) : 0;
            const spacePx = Math.max(0, remainingLines * lineHeight);
            return {
              pageIndex,
              blockCount: blocks.length,
              totalLines: allLines.length,
              brCount: pageBrCount,
              lineTextCount,
              singleWordLineCount,
              avgLineLen,
              minLineLen: lineLens.length ? Math.min(...lineLens) : 0,
              maxLineLen: lineLens.length ? Math.max(...lineLens) : 0,
              shortLines,
              singleWordLines,
              wordCount,
              avgWordsPerLine,
              narrowLineCount,
              narrowLineRatio,
              avgLineWidth,
              contentHeight: usableHeight,
              paddingBottom,
              maxLines,
              usedLines,
              remainingLines,
              rectHeight,
              clientHeight,
              offsetHeight,
              scrollHeight,
              lastBottom,
              lastLineBottom,
              lastVisibleLineBottom,
              fillRatio,
              lineHeight,
              spacePx,
              hasSpaceForLine: remainingLines >= 1,
              blocks: blockEntries,
              rawText,
              fullText
            };
          });
          const interaction = (() => {
            const result = {
              enter: { attempted: false, movedToNext: null, pageCountBefore: null, pageCountAfter: null },
              backspace: { attempted: false, movedToPrev: null, pageCountBefore: null, pageCountAfter: null },
              page1: { hasSpaceForLine: null, spacePx: null }
            };
            if (!editor || pages.length < 2) return result;
            const page1Content = getPageContent(0);
            const page2Content = getPageContent(1);
            const page1Metrics = getContentMetrics(page1Content);
            if (page1Metrics && pageReports[0]) {
              const spacePx = Math.max(0, (page1Metrics.remainingLines || 0) * (page1Metrics.lineHeight || 0));
              result.page1.spacePx = spacePx;
              result.page1.lineHeight = page1Metrics.lineHeight;
              result.page1.hasSpaceForLine = (page1Metrics.remainingLines || 0) >= 1;
            }
            const page2TextBefore = pageReports[1] ? pageReports[1].fullText : "";
            const lastNode = findTextNode(page1Content, false);
            if (lastNode) {
              const pos = getPosAt(lastNode, lastNode.nodeValue.length);
              if (pos && Number.isFinite(pos)) {
                result.enter.attempted = true;
                result.enter.pageCountBefore = pages.length;
                try {
                  editor.commands.setTextSelection(pos);
                  editor.view.focus();
                  editor.view.dom.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "Enter",
                      code: "Enter",
                      bubbles: true
                    })
                  );
                  editor.view.dom.dispatchEvent(
                    new KeyboardEvent("keyup", {
                      key: "Enter",
                      code: "Enter",
                      bubbles: true
                    })
                  );
                } catch (err) {
                  // ignore
                }
              }
            }
            if (editor && pages.length >= 2) {
              const pagesNow = getPages();
              const page2Content = pagesNow[1]
                ? pagesNow[1].querySelector(".leditor-page-content")
                : null;
              const firstNode = findTextNode(page2Content, true);
              if (firstNode) {
                const pos = getPosAt(firstNode, 0);
                if (pos && pos > 1) {
                  result.backspace.attempted = true;
                  result.backspace.pageCountBefore = pagesNow.length;
                  try {
                    editor.commands.setTextSelection(pos);
                    editor.view.focus();
                    editor.view.dom.dispatchEvent(
                      new KeyboardEvent("keydown", {
                        key: "Backspace",
                        code: "Backspace",
                        bubbles: true
                      })
                    );
                    editor.view.dom.dispatchEvent(
                      new KeyboardEvent("keyup", {
                        key: "Backspace",
                        code: "Backspace",
                        bubbles: true
                      })
                    );
                  } catch (err) {
                    // ignore
                  }
                }
              }
            }
            return result;
          })();
          if (interaction.enter.attempted) {
            await new Promise((r) => setTimeout(r, 250));
            const pagesAfter = getPages();
            const page2AfterContent = pagesAfter[1]
              ? pagesAfter[1].querySelector(".leditor-page-content")
              : null;
            const page2AfterText = page2AfterContent ? page2AfterContent.innerText || "" : "";
            interaction.enter.pageCountAfter = pagesAfter.length;
            interaction.enter.movedToNext =
              interaction.enter.pageCountAfter > interaction.enter.pageCountBefore ||
              __auditNormalizeText(page2AfterText) !==
                __auditNormalizeText(pageReports[1] ? pageReports[1].fullText : "");
          }
          if (interaction.backspace.attempted) {
            await new Promise((r) => setTimeout(r, 250));
            const pagesAfter = getPages();
            const page1AfterContent = pagesAfter[0]
              ? pagesAfter[0].querySelector(".leditor-page-content")
              : null;
            const page1AfterText = page1AfterContent ? page1AfterContent.innerText || "" : "";
            interaction.backspace.pageCountAfter = pagesAfter.length;
            interaction.backspace.movedToPrev =
              interaction.backspace.pageCountAfter < interaction.backspace.pageCountBefore ||
              __auditNormalizeText(page1AfterText) !==
                __auditNormalizeText(pageReports[0] ? pageReports[0].fullText : "");
          }
          const finalSync = {
            docCount: editor?.state?.doc?.childCount ?? 0,
            domCount: pages.length
          };
          return { ok: true, pageCount, pages: pageReports, interaction, syncState, finalSync };
        } catch (err) {
          return { ok: false, reason: String(err && err.message ? err.message : err), stack: err && err.stack ? String(err.stack) : null };
        }
      })();
        `,
        true
      );
    } catch (err) {
      console.error("[FAIL] report script failed", err?.message || err);
      throw err;
    }
    if (!report || report.ok !== true) {
      throw new Error(report?.reason || "Unknown report failure");
    }
    const isSectionPage = (page) => {
      if (!page) return false;
      const text = String(page.fullText || "");
      if (/Synthesis across paragraphs|Challenges?|Challenge\s+\d+|Gaps|Proposals|Findings/i.test(text)) {
        return true;
      }
      const blocks = Array.isArray(page.blocks) ? page.blocks : [];
      return blocks.some((block) => {
        const tag = String(block?.tag || "");
        if (!/^H[1-6]$/.test(tag)) return false;
        const sample = Array.isArray(block.sample) ? block.sample.join(" ") : String(block.sample || "");
        return /Synthesis|Challenges?|Challenge\s+\d+|Gaps|Proposals|Findings/i.test(sample);
      });
    };
    const suspects = report.pages.filter((page) => {
      const isSection = isSectionPage(page);
      const minLinesForPage = isSection ? Math.max(3, Math.round(minLines * 0.6)) : minLines;
      const minAvgLenForPage = isSection ? minAvgLen * 0.6 : minAvgLen;
      const minFillForPage = isSection ? minFillRatio * 0.6 : minFillRatio;
      const maxRemainingForPage = isSection
        ? Math.max(2, Math.round(maxRemainingLines * 1.5))
        : maxRemainingLines;
      if (page.totalLines < minLinesForPage) return true;
      if (page.avgLineLen < minAvgLenForPage) return true;
      if (Number.isFinite(page.remainingLines) && Number.isFinite(page.maxLines) && page.maxLines > 0) {
        if (page.remainingLines > maxRemainingForPage) return true;
      } else if (page.fillRatio < minFillForPage) {
        return true;
      }
      if (page.shortLines > 3 || page.singleWordLines > 3) return true;
      if (typeof page.narrowLineRatio === "number" && page.narrowLineRatio > 0.25) return true;
      if (typeof page.narrowLineCount === "number" && page.narrowLineCount > 4) return true;
      if (typeof page.avgWordsPerLine === "number" && page.avgWordsPerLine > 0 && page.avgWordsPerLine < 1.2) {
        return true;
      }
      return false;
    });
    const expectationsSource = expectedOverride || expectedPages;
    const expectations = expectationsSource.map((expectation) => {
      const resolvedPageIndexFromNumber =
        typeof expectation.pageNumber === "number" && Number.isFinite(expectation.pageNumber)
          ? Math.max(0, Math.round(expectation.pageNumber) - 1)
          : null;
      const declaredIndex =
        typeof expectation.pageIndex === "number" && Number.isFinite(expectation.pageIndex)
          ? expectation.pageIndex
          : resolvedPageIndexFromNumber;
      const page = report.pages.find((p) => p.pageIndex === declaredIndex);
      const expectedText = expectation.mustInclude || expectation.text || "";
      const matchMode = expectation.match || "contains";
      const normalizedExpected = normalizeText(expectedText);
      const normalizedEnd = expectation.mustEndWith ? normalizeText(expectation.mustEndWith) : null;
      const normalizedPage = normalizeText(page?.fullText || "");
      const normalizedPageLoose = normalizeLoose(page?.fullText || "");
      const normalizedExpectedLoose = normalizeLoose(expectedText);
      const findIndexByMatch = (candidate) => {
        const normalizedCandidate = normalizeText(candidate.fullText || "");
        if (matchMode === "equals") return normalizedCandidate === normalizedExpected;
        if (matchMode === "startsWith") return normalizedCandidate.startsWith(normalizedExpected);
        if (matchMode === "endsWith") return normalizedCandidate.endsWith(normalizedExpected);
        return normalizedCandidate.includes(normalizedExpected);
      };
      const foundOnPageIndex = report.pages.findIndex((p) => findIndexByMatch(p));
      const resolvedIndex = foundOnPageIndex >= 0 ? foundOnPageIndex : declaredIndex ?? null;
      const resolvedPage = resolvedIndex !== null && resolvedIndex !== undefined ? report.pages[resolvedIndex] : null;
      const resolvedNormalized = normalizeText(resolvedPage?.fullText || "");
      const resolvedLoose = normalizeLoose(resolvedPage?.fullText || "");
      const matches =
        matchMode === "equals"
          ? resolvedNormalized === normalizedExpected
          : matchMode === "startsWith"
            ? resolvedNormalized.startsWith(normalizedExpected)
            : matchMode === "endsWith"
              ? resolvedNormalized.endsWith(normalizedExpected)
              : Boolean(resolvedNormalized && resolvedNormalized.includes(normalizedExpected));
      const looseMatches = Boolean(
        resolvedLoose && normalizedExpectedLoose && resolvedLoose.includes(normalizedExpectedLoose)
      );
      const endsWith = normalizedEnd ? resolvedNormalized.endsWith(normalizedEnd) : null;
      return {
        pageIndex: declaredIndex,
        pageNumber: resolvedPageIndexFromNumber != null ? resolvedPageIndexFromNumber + 1 : null,
        label: expectation.label,
        resolvedPageIndex: resolvedIndex,
        foundOnPageIndex: foundOnPageIndex >= 0 ? foundOnPageIndex : null,
        matches,
        looseMatches,
        endsWith,
        expected: normalizedExpected.slice(0, 300),
        expectedEnd: normalizedEnd ? normalizedEnd.slice(0, 120) : null,
        pageSnippet: resolvedNormalized.slice(0, 300),
        pageLooseSnippet: resolvedLoose.slice(0, 300),
        rawSnippet: String(resolvedPage?.rawText || "").slice(0, 300)
      };
    });
    const interactionFindings = [];
    if (report.interaction) {
      if (report.interaction.page1?.hasSpaceForLine === true && report.interaction.enter?.movedToNext === false) {
        interactionFindings.push("Page 1 has space for a line but Enter did not push content to the next page.");
      }
      if (report.interaction.backspace?.movedToPrev === false) {
        interactionFindings.push("Backspace at start of page 2 did not pull content up to page 1.");
      }
    }

    const payloadOut = {
      ok: true,
      pageCount: report.pageCount,
      pages: report.pages,
      suspects,
      expectations,
      interaction: report.interaction || null,
      syncState: report.syncState || null,
      finalSync: report.finalSync || null,
      interactionExpectations: report.interaction
        ? {
            enterMovesToNext: report.interaction.enter?.movedToNext === true,
            backspaceMovesToPrev: report.interaction.backspace?.movedToPrev === true,
            page1HasSpaceForLine: report.interaction.page1?.hasSpaceForLine === true
          }
        : null,
      interactionFindings,
      paginationLogs
    };

    fs.writeFileSync(outputPath, JSON.stringify(payloadOut, null, 2), "utf8");
    console.log(`[PASS] pagination audit written: ${outputPath}`);
    if (suspects.length) {
      console.log(`[WARN] suspects: ${suspects.map((p) => p.pageIndex).join(", ")}`);
    }

    const failedExpectations = expectations.filter((e) => !e.matches);
    if (failedExpectations.length) {
      console.log(`[WARN] expectations failed: ${failedExpectations.map((e) => e.pageIndex).join(", ")}`);
    }
    if (interactionFindings.length) {
      console.log(`[WARN] interaction failures: ${interactionFindings.join(" | ")}`);
    }

    if (failedExpectations.length || suspects.length || interactionFindings.length) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("[FAIL] pagination audit error", err?.message || err);
    process.exitCode = 1;
  } finally {
    clearTimeout(killTimer);
    setTimeout(() => app.exit(process.exitCode || 0), 250);
  }
};

run();
