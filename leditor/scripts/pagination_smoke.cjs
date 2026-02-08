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
        const samplePageCounts = async () => {
          const history = [];
          const epochs = [];
          const maxBlockOffsetRatioHistory = [];
          const maxScrollLeftHistory = [];
          const maxScrollRatioHistory = [];
          for (let i = 0; i < 20; i += 1) {
            history.push(document.querySelectorAll(".leditor-page").length);
            epochs.push(window.__leditorFootnoteLayoutEpoch ?? null);
            let maxBlockOffsetLeft = 0;
            let maxContentWidth = 0;
            let maxScrollLeft = 0;
            let maxScrollRatio = 0;
            const contents = Array.from(document.querySelectorAll(".leditor-page-content"));
            contents.forEach((content) => {
              const contentWidth = content.clientWidth || 0;
              if (contentWidth > maxContentWidth) maxContentWidth = contentWidth;
              const scrollWidth = content.scrollWidth || 0;
              if (contentWidth > 0) {
                maxScrollRatio = Math.max(maxScrollRatio, scrollWidth / contentWidth);
              }
              maxScrollLeft = Math.max(maxScrollLeft, content.scrollLeft || 0);
              const blocks = Array.from(content.children);
              blocks.forEach((block) => {
                const offsetLeft = Number.isFinite(block.offsetLeft) ? block.offsetLeft : 0;
                if (offsetLeft > maxBlockOffsetLeft) maxBlockOffsetLeft = offsetLeft;
              });
            });
            const ratio = maxContentWidth > 0 ? maxBlockOffsetLeft / maxContentWidth : 0;
            maxBlockOffsetRatioHistory.push(ratio);
            maxScrollLeftHistory.push(maxScrollLeft);
            maxScrollRatioHistory.push(maxScrollRatio);
            await new Promise((r) => setTimeout(r, 120));
          }
          return {
            history,
            epochs,
            maxBlockOffsetRatioHistory,
            maxScrollLeftHistory,
            maxScrollRatioHistory
          };
        };
        const {
          history: pageCountHistory,
          epochs: footnoteEpochHistory,
          maxBlockOffsetRatioHistory,
          maxScrollLeftHistory,
          maxScrollRatioHistory
        } = await samplePageCounts();
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
          const pageIndexAttr = page.getAttribute("data-page-index");
          const blocks = Array.from(content.children);
          const contentRect = content.getBoundingClientRect();
          const style = getComputedStyle(content);
          const styleAttr = content.getAttribute("style") || "";
          const pageStyle = getComputedStyle(page);
          const pageStyleAttr = page.getAttribute("style") || "";
          const prose = content.querySelector(".ProseMirror");
          const proseStyle = prose ? getComputedStyle(prose) : null;
          const rootProse = page.closest("#editor")?.querySelector(".ProseMirror") || null;
          const rootProseStyle = rootProse ? getComputedStyle(rootProse) : null;
          const paddingBottom = parseFloat(style.paddingBottom || "0") || 0;
          const baseHeight = content.clientHeight || parseFloat(style.height || "0") || 0;
          const usableHeight = Math.max(0, baseHeight - paddingBottom);
          const baseWidth = content.clientWidth || parseFloat(style.width || "0") || 0;
          const scrollWidth = content.scrollWidth || 0;
          const scrollHeight = content.scrollHeight || 0;
          const scrollLeft = content.scrollLeft || 0;
          const scrollDelta = Math.max(0, scrollWidth - baseWidth);
          const scrollRatio = baseWidth > 0 ? scrollWidth / baseWidth : 0;
          let maxRightDelta = 0;
          let maxRightLeft = null;
          let maxRightRight = null;
          let maxOffsetLeft = 0;
          let maxOffsetTag = null;
          let maxOffsetText = null;
          let maxOffsetStyles = null;
          let maxOffsetChain = null;
          let maxBlockOffsetLeft = 0;
          let maxBlockOffsetTag = null;
          let maxBlockOffsetText = null;
          blocks.forEach((block) => {
            const offsetLeft = Number.isFinite(block.offsetLeft) ? block.offsetLeft : 0;
            if (offsetLeft > maxBlockOffsetLeft) {
              maxBlockOffsetLeft = offsetLeft;
              maxBlockOffsetTag = block.tagName;
              maxBlockOffsetText = (block.textContent || "").trim().slice(0, 120) || null;
            }
          });
          let maxRightTag = null;
          let maxRightClass = null;
          let maxRightId = null;
          let maxRightStyleAttr = null;
          let maxRightText = null;
          let maxRightStyles = null;
          let maxRightChain = null;
          let columnAnomalies = [];
          try {
            const nodes = Array.from(content.querySelectorAll("*")).slice(0, 1200);
            nodes.forEach((node) => {
              const rect = node.getBoundingClientRect();
              const offsetLeft = Number.isFinite(node.offsetLeft) ? node.offsetLeft : 0;
              if (offsetLeft > maxOffsetLeft) {
                maxOffsetLeft = offsetLeft;
                maxOffsetTag = node.tagName;
                maxOffsetText = (node.textContent || "").trim().slice(0, 140) || null;
                try {
                  const os = getComputedStyle(node);
                  maxOffsetStyles = {
                    display: os.display,
                    position: os.position,
                    whiteSpace: os.whiteSpace,
                    overflowWrap: os.overflowWrap,
                    wordBreak: os.wordBreak,
                    columnCount: os.columnCount,
                    columns: os.columns,
                    transform: os.transform,
                    left: os.left,
                    right: os.right,
                    marginLeft: os.marginLeft,
                    paddingLeft: os.paddingLeft,
                    styleAttr: node.getAttribute("style") || null
                  };
                  try {
                    const chain = [];
                    let cursor = node;
                    let depth = 0;
                    while (cursor && depth < 6) {
                      const rect = cursor.getBoundingClientRect();
                      const style = getComputedStyle(cursor);
                      chain.push({
                        tag: cursor.tagName,
                        className: cursor.className || null,
                        id: cursor.id || null,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        position: style.position,
                        display: style.display,
                        float: style.cssFloat,
                        transform: style.transform
                      });
                      cursor = cursor.parentElement;
                      depth += 1;
                    }
                    maxOffsetChain = chain;
                  } catch {
                    maxOffsetChain = null;
                  }
                } catch {
                  maxOffsetStyles = null;
                }
              }
              const delta = rect.right - contentRect.left;
              if (delta > maxRightDelta) {
                maxRightDelta = delta;
                maxRightLeft = rect.left;
                maxRightRight = rect.right;
                maxRightTag = node.tagName;
                maxRightClass = node.className || null;
                const cs = getComputedStyle(node);
                maxRightId = node.id || null;
                maxRightStyleAttr = node.getAttribute("style") || null;
                maxRightText = (node.textContent || "").trim().slice(0, 180) || null;
                maxRightStyles = {
                  whiteSpace: cs.whiteSpace,
                  overflowWrap: cs.overflowWrap,
                  wordBreak: cs.wordBreak,
                  columnCount: cs.columnCount,
                  columnSpan: cs.columnSpan,
                  display: cs.display,
                  position: cs.position,
                  direction: cs.direction,
                  writingMode: cs.writingMode,
                  float: cs.cssFloat,
                  left: cs.left,
                  right: cs.right,
                  marginLeft: cs.marginLeft,
                  paddingLeft: cs.paddingLeft,
                  textIndent: cs.textIndent,
                  width: cs.width,
                  minWidth: cs.minWidth,
                  maxWidth: cs.maxWidth,
                  transform: cs.transform,
                  styleAttr: node.getAttribute("style") || null
                };
                try {
                  const offsetParent = node.offsetParent;
                  maxRightStyles.offsetLeft = Number.isFinite(node.offsetLeft) ? node.offsetLeft : null;
                  maxRightStyles.offsetTop = Number.isFinite(node.offsetTop) ? node.offsetTop : null;
                  maxRightStyles.offsetParentTag = offsetParent ? offsetParent.tagName : null;
                  maxRightStyles.offsetParentClass = offsetParent ? offsetParent.className : null;
                } catch {
                  // ignore
                }
                try {
                  const chain = [];
                  let cursor = node;
                  let depth = 0;
                  while (cursor && depth < 6) {
                    const rect = cursor.getBoundingClientRect();
                    const style = getComputedStyle(cursor);
                      chain.push({
                        tag: cursor.tagName,
                        className: cursor.className || null,
                        id: cursor.id || null,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        position: style.position,
                        display: style.display,
                        float: style.cssFloat,
                        transform: style.transform
                      });
                    cursor = cursor.parentElement;
                    depth += 1;
                  }
                  maxRightChain = chain;
                } catch {
                  maxRightChain = null;
                }
              }
              if (columnAnomalies.length < 5) {
                const cs = getComputedStyle(node);
                const columnCount = cs.columnCount;
                const columns = cs.columns;
                if (columnCount && columnCount !== "1" && columnCount !== "auto") {
                  columnAnomalies.push({
                    tag: node.tagName,
                    className: node.className || null,
                    columnCount,
                    columns
                  });
                }
              }
            });
          } catch {
            // ignore
          }
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
          const maxLineWidth =
            totalLines > 0
              ? Math.max(...lineEntries.map((line) => Number.isFinite(line.width) ? line.width : 0))
              : 0;
          const shortLines = lineEntries.filter((line) => (line.len || 0) <= 3).length;
          const shortLineRatio = totalLines > 0 ? shortLines / totalLines : 0;
          const fillRatio = usableHeight > 0 ? Math.min(1, lastBottom / usableHeight) : 0;

          const proseRect = prose ? prose.getBoundingClientRect() : null;
          const proseComputed = prose ? getComputedStyle(prose) : null;
          const proseMeta = proseComputed
            ? {
                width: proseComputed.width,
                minWidth: proseComputed.minWidth,
                maxWidth: proseComputed.maxWidth,
                position: proseComputed.position,
                left: proseComputed.left,
                right: proseComputed.right,
                marginLeft: proseComputed.marginLeft,
                transform: proseComputed.transform
              }
            : null;

          return {
            pageIndex,
            pageIndexAttr,
            blockCount: blocks.length,
            totalLines,
            avgLineLen: avgLen,
            maxLineWidth,
            shortLineRatio,
            contentHeight: usableHeight,
            paddingBottom,
            contentWidth: baseWidth,
            contentScrollWidth: scrollWidth,
            contentScrollHeight: scrollHeight,
            contentScrollDelta: scrollDelta,
            contentScrollRatio: scrollRatio,
            contentScrollLeft: scrollLeft,
            contentColumnCount: style.columnCount || null,
            contentColumns: style.columns || null,
            contentColumnWidth: style.columnWidth || null,
            contentColumnGap: style.columnGap || null,
            contentColumnFill: style.columnFill || null,
            contentDisplay: style.display || null,
            contentFlow: style.gridAutoFlow || null,
            contentFlexDirection: style.flexDirection || null,
            contentFlexWrap: style.flexWrap || null,
            contentWhiteSpace: style.whiteSpace || null,
            contentOverflowWrap: style.overflowWrap || null,
            contentWordBreak: style.wordBreak || null,
            contentWritingMode: style.writingMode || null,
            contentDirection: style.direction || null,
            contentTransform: style.transform || null,
            contentStyleAttr: styleAttr || null,
            pageColumns: pageStyle.columns || null,
            pageColumnCount: pageStyle.columnCount || null,
            pageColumnWidth: pageStyle.columnWidth || null,
            pageColumnGap: pageStyle.columnGap || null,
            pageStyleAttr: pageStyleAttr || null,
            proseColumnCount: proseStyle ? proseStyle.columnCount : null,
            proseRect: proseRect
              ? {
                  left: proseRect.left,
                  right: proseRect.right,
                  width: proseRect.width
                }
              : null,
            proseMeta,
            rootProseDisplay: rootProseStyle ? rootProseStyle.display : null,
            rootProseWhiteSpace: rootProseStyle ? rootProseStyle.whiteSpace : null,
            rootProseOverflowWrap: rootProseStyle ? rootProseStyle.overflowWrap : null,
            maxRightDelta,
            maxRightLeft,
            maxRightRight,
            maxOffsetLeft,
            maxOffsetTag,
            maxOffsetText,
            maxOffsetStyles,
            maxOffsetChain,
            maxBlockOffsetLeft,
            maxBlockOffsetTag,
            maxBlockOffsetText,
            maxRightTag,
            maxRightClass,
            maxRightId,
            maxRightStyleAttr,
            maxRightText,
            maxRightStyles,
            maxRightChain,
            columnAnomalies,
            contentRectWidth: contentRect.width,
            contentRectLeft: contentRect.left,
            contentRectRight: contentRect.right,
            pageRectWidth: page.getBoundingClientRect().width,
            pageRectLeft: page.getBoundingClientRect().left,
            pageRectRight: page.getBoundingClientRect().right,
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

        return {
          ok: true,
          pageCount,
          pageCountHistory,
          footnoteEpochHistory,
          maxBlockOffsetRatioHistory,
          maxScrollLeftHistory,
          maxScrollRatioHistory,
          pages: pageReports,
          suspects
        };
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
