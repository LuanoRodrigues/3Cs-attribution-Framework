const path = require("path");
const fs = require("fs");

let electronModule = null;
const getElectron = () => {
  if (!electronModule) {
    electronModule = require("electron");
  }
  return electronModule;
};

const repoRoot = path.resolve(__dirname, "..");
const indexHtml = path.join(repoRoot, "dist", "public", "index.html");
const defaultExpectationsPath = path.join(__dirname, "pagination_page_cases.json");
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
  const { ipcMain } = getElectron();
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

const readEnvNumber = (key) => {
  const raw = process.env[key];
  if (raw == null || raw === "") return null;
  if (raw === "off" || raw === "false" || raw === "0") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseArgs = () => {
  const rawArgs = process.argv.slice(2);
  const dashDashIndex = rawArgs.indexOf("--");
  const trimmed = dashDashIndex >= 0 ? rawArgs.slice(dashDashIndex + 1) : rawArgs;
  const args = trimmed.filter((arg) => !String(arg).startsWith("-"));
  const expectIndex = trimmed.findIndex((arg) => arg === "--expect" || arg === "--expected");
  const expectPath = expectIndex >= 0 ? trimmed[expectIndex + 1] : null;
  const ledocPath = args[0] ? path.resolve(args[0]) : path.join(repoRoot, "..", "coder_state.ledoc");
  const outputPath = args[1]
    ? path.resolve(args[1])
    : path.join(repoRoot, "pagination_page_cases_report.json");
  return { ledocPath, outputPath, expectPath };
};

const loadExpectations = (pathValue) => {
  const resolved = pathValue ? path.resolve(pathValue) : defaultExpectationsPath;
  if (!fs.existsSync(resolved)) {
    throw new Error(`expectations file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  const pages = Array.isArray(parsed?.pages) ? parsed.pages : Array.isArray(parsed) ? parsed : [];
  return { path: resolved, pages };
};

const normalizeExpectations = (pages) => {
  const out = [];
  pages.forEach((entry) => {
    const pageIndex =
      Number.isFinite(entry.pageIndex) ? Number(entry.pageIndex)
        : Number.isFinite(entry.pageNumber) ? Number(entry.pageNumber) - 1
          : null;
    const pageIndexFromEnd =
      Number.isFinite(entry.pageIndexFromEnd) ? Number(entry.pageIndexFromEnd)
        : Number.isFinite(entry.pageNumberFromEnd) ? Number(entry.pageNumberFromEnd)
          : null;
    if (
      (pageIndex == null || !Number.isFinite(pageIndex) || pageIndex < 0) &&
      (pageIndexFromEnd == null || !Number.isFinite(pageIndexFromEnd) || pageIndexFromEnd <= 0)
    ) {
      throw new Error(`invalid pageIndex for expectation: ${JSON.stringify(entry)}`);
    }
    out.push({ ...entry, pageIndex, pageIndexFromEnd });
  });
  return out;
};

const evaluateExpectations = (pages, expectations) => {
  const failures = [];
  const defaultMaxWhiteSpaceRatio = readEnvNumber("LEDITOR_MAX_WHITESPACE_RATIO") ?? 0.25;
  const defaultMaxWhiteSpacePx = readEnvNumber("LEDITOR_MAX_WHITESPACE_PX");
  const defaultMaxFreeLines = readEnvNumber("LEDITOR_MAX_WHITESPACE_LINES") ?? 12;
  const sparseMinWordCount = readEnvNumber("LEDITOR_SPARSE_MIN_WORDS") ?? 80;
  const sparseMaxFillRatioBottom = readEnvNumber("LEDITOR_SPARSE_MAX_FILL_RATIO_BOTTOM") ?? 0.35;
  const sparseMaxFreeLines = readEnvNumber("LEDITOR_SPARSE_MAX_FREE_LINES") ?? 18;
  const minLineChars = readEnvNumber("LEDITOR_MIN_LINE_CHARS") ?? 5;
  const maxShortLines = readEnvNumber("LEDITOR_MAX_SHORT_LINES") ?? 0;
  const allowSentenceCaseSplitGlobal = process.env.LEDITOR_ALLOW_SENTENCE_CASE_SPLIT === "1";
  const allowPunctuationSplitGlobal = process.env.LEDITOR_ALLOW_PUNCTUATION_SPLIT === "1";
  const allowMidWordSplitGlobal = process.env.LEDITOR_ALLOW_MIDWORD_SPLIT === "1";
  const allowAnchorSplitGlobal = process.env.LEDITOR_ALLOW_ANCHOR_SPLIT === "1";
  const allowCharacterSplitGlobal = process.env.LEDITOR_ALLOW_CHARACTER_SPLIT === "1";
  const defaultMaxParaSplitFreeLines =
    readEnvNumber("LEDITOR_MAX_PARAGRAPH_SPLIT_FREE_LINES") ?? Math.max(2, defaultMaxFreeLines - 2);
  expectations.forEach((expect) => {
    const resolvedIndex = (() => {
      if (Number.isFinite(expect.pageIndex)) return expect.pageIndex;
      if (Number.isFinite(expect.pageIndexFromEnd)) {
        const idx = pages.length - Math.floor(expect.pageIndexFromEnd);
        return idx >= 0 ? idx : null;
      }
      return null;
    })();
    if (resolvedIndex == null) {
      failures.push({
        label: expect.label || "page_unknown",
        pageIndex: expect.pageIndex ?? -1,
        reason: "page index unresolved"
      });
      return;
    }
    const page = pages.find((p) => p.pageIndex === resolvedIndex);
    if (!page) {
      failures.push({
        label: expect.label || `page_${resolvedIndex + 1}`,
        pageIndex: resolvedIndex,
        reason: "page missing"
      });
      return;
    }
    const label = expect.label || `page_${resolvedIndex + 1}`;
    if (Number.isFinite(expect.minParagraphs) && page.paragraphCount < expect.minParagraphs) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `paragraphCount ${page.paragraphCount} < minParagraphs ${expect.minParagraphs}`
      });
    }
    if (Number.isFinite(expect.minWordCount) && page.wordCount < expect.minWordCount) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `wordCount ${page.wordCount} < minWordCount ${expect.minWordCount}`
      });
    }
    if (Number.isFinite(expect.minBlocks) && page.blockCount < expect.minBlocks) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `blockCount ${page.blockCount} < minBlocks ${expect.minBlocks}`
      });
    }
    if (Number.isFinite(expect.minFillRatio) && page.fillRatio < expect.minFillRatio) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `fillRatio ${page.fillRatio} < minFillRatio ${expect.minFillRatio}`
      });
    }
    if (Number.isFinite(expect.minFillRatioBottom) && page.fillRatioBottom < expect.minFillRatioBottom) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `fillRatioBottom ${page.fillRatioBottom} < minFillRatioBottom ${expect.minFillRatioBottom}`
      });
    }
    if (Number.isFinite(expect.maxOverflowPx) && page.overflowY > expect.maxOverflowPx) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `overflowY ${page.overflowY} > maxOverflowPx ${expect.maxOverflowPx}`
      });
    }
    if (Number.isFinite(expect.maxHorizontalOverflowPx) && page.overflowX > expect.maxHorizontalOverflowPx) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `overflowX ${page.overflowX} > maxHorizontalOverflowPx ${expect.maxHorizontalOverflowPx}`
      });
    }
    const maxWhiteSpaceRatio =
      Number.isFinite(expect.maxWhiteSpaceRatio) ? expect.maxWhiteSpaceRatio : defaultMaxWhiteSpaceRatio;
    const maxWhiteSpacePx =
      Number.isFinite(expect.maxWhiteSpacePx) ? expect.maxWhiteSpacePx : defaultMaxWhiteSpacePx;
    const maxFreeLines =
      Number.isFinite(expect.maxFreeLines) ? expect.maxFreeLines : defaultMaxFreeLines;
    const allowHeadingWhitespace =
      expect.allowHeadingWhitespace !== false;
    const allowKeepWithNextWhitespace =
      expect.allowKeepWithNextWhitespace !== false;
    const lastBlockIsHeading = typeof page.lastBlockTag === "string" && /^H[1-6]$/.test(page.lastBlockTag);
    const keepWithNextBreak = page.breakRule === "keepWithNext" || page.breakRule === "manual" || page.breakManual === true;
    const whitespaceExempt =
      (allowHeadingWhitespace && lastBlockIsHeading) ||
      (allowKeepWithNextWhitespace && keepWithNextBreak);
    if (!whitespaceExempt && Number.isFinite(maxWhiteSpaceRatio) && page.whiteSpaceRatio > maxWhiteSpaceRatio) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `whiteSpaceRatio ${page.whiteSpaceRatio} > maxWhiteSpaceRatio ${maxWhiteSpaceRatio}`
      });
    }
    if (!whitespaceExempt && Number.isFinite(maxWhiteSpacePx) && page.whiteSpacePx > maxWhiteSpacePx) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `whiteSpacePx ${page.whiteSpacePx} > maxWhiteSpacePx ${maxWhiteSpacePx}`
      });
    }
    if (!whitespaceExempt && Number.isFinite(maxFreeLines) && page.freeLines > maxFreeLines) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `freeLines ${page.freeLines} > maxFreeLines ${maxFreeLines}`
      });
    }
    const allowMidWordSplit = expect.allowMidWordSplit === true || allowMidWordSplitGlobal;
    if (!allowMidWordSplit && page.midWordSplit) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `midWordSplit at boundary (${page.splitBeforeChar || ""}|${page.splitAfterChar || ""})`
      });
    }
    const allowAnchorSplit = expect.allowAnchorSplit === true || allowAnchorSplitGlobal;
    if (!allowAnchorSplit && page.anchorSplit) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: "anchorSplit at boundary"
      });
    }
    const allowCharacterSplit = expect.allowCharacterSplit === true || allowCharacterSplitGlobal;
    if (!allowCharacterSplit && page.characterSplitCount > 0) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `characterSplitCount ${page.characterSplitCount}`
      });
    }
    const allowSentenceCaseSplit =
      expect.allowSentenceCaseSplit === true || allowSentenceCaseSplitGlobal;
    if (!allowSentenceCaseSplit && page.sentenceCaseViolation) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `sentenceCaseViolation (${page.sentenceCaseBeforeChar || ""}|${page.sentenceCaseAfterChar || ""})`
      });
    }
    const allowPunctuationSplit =
      expect.allowPunctuationSplit === true || allowPunctuationSplitGlobal;
    if (!allowPunctuationSplit && page.punctuationSplit) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `punctuationSplit (${page.punctuationSplitPrevChar || ""}|${page.punctuationSplitChar || ""})`
      });
    }
    if (Number.isFinite(maxShortLines) && Number.isFinite(minLineChars) && page.shortLineCount > maxShortLines) {
      failures.push({
        label,
        pageIndex: resolvedIndex,
        reason: `shortLineCount ${page.shortLineCount} > maxShortLines ${maxShortLines} (minLineChars ${minLineChars})`
      });
    }
    const maxParaSplitFreeLines = Number.isFinite(expect.maxParagraphSplitFreeLines)
      ? expect.maxParagraphSplitFreeLines
      : defaultMaxParaSplitFreeLines;
    const allowParagraphSplit = expect.allowParagraphSplit === true;
    if (!allowParagraphSplit && page.paragraphSplitAtBoundary && page.pageIndex > 0) {
      const prev = pages.find((p) => p.pageIndex === page.pageIndex - 1);
      const prevFreeLines = prev ? prev.freeLines : 0;
      if (prevFreeLines >= maxParaSplitFreeLines) {
        failures.push({
          label,
          pageIndex: resolvedIndex,
          reason: `paragraphSplit with prev freeLines ${prevFreeLines} >= ${maxParaSplitFreeLines}`
        });
      }
    }
  });
  if (!allowMidWordSplitGlobal) {
    pages.forEach((page) => {
      if (!page?.midWordSplit) return;
      failures.push({
        label: `midword_page_${page.pageNumber}`,
        pageIndex: page.pageIndex,
        reason: `midWordSplit at boundary (${page.splitBeforeChar || ""}|${page.splitAfterChar || ""})`
      });
    });
  }
  if (!allowAnchorSplitGlobal) {
    pages.forEach((page) => {
      if (!page?.anchorSplit) return;
      failures.push({
        label: `anchor_page_${page.pageNumber}`,
        pageIndex: page.pageIndex,
        reason: "anchorSplit at boundary"
      });
    });
  }
  if (!allowCharacterSplitGlobal) {
    pages.forEach((page) => {
      if (!page?.characterSplitCount) return;
      failures.push({
        label: `charsplit_page_${page.pageNumber}`,
        pageIndex: page.pageIndex,
        reason: `characterSplitCount ${page.characterSplitCount}`
      });
    });
  }
  if (!allowSentenceCaseSplitGlobal) {
    pages.forEach((page) => {
      if (!page?.sentenceCaseViolation) return;
      failures.push({
        label: `sentencecase_page_${page.pageNumber}`,
        pageIndex: page.pageIndex,
        reason: `sentenceCaseViolation (${page.sentenceCaseBeforeChar || ""}|${page.sentenceCaseAfterChar || ""})`
      });
    });
  }
  if (!allowPunctuationSplitGlobal) {
    pages.forEach((page) => {
      if (!page?.punctuationSplit) return;
      failures.push({
        label: `punctsplit_page_${page.pageNumber}`,
        pageIndex: page.pageIndex,
        reason: `punctuationSplit (${page.punctuationSplitPrevChar || ""}|${page.punctuationSplitChar || ""})`
      });
    });
  }
  pages.forEach((page) => {
    if (!page) return;
    const manualBreak = page.breakManual === true || page.breakRule === "manual";
    if (manualBreak) return;
    const sparseByFreeLines =
      Number.isFinite(sparseMaxFreeLines) &&
      Number.isFinite(sparseMinWordCount) &&
      page.freeLines >= sparseMaxFreeLines &&
      page.wordCount < sparseMinWordCount;
    const sparseByFill =
      Number.isFinite(sparseMaxFillRatioBottom) &&
      Number.isFinite(sparseMinWordCount) &&
      page.fillRatioBottom <= sparseMaxFillRatioBottom &&
      page.wordCount < sparseMinWordCount;
    if (sparseByFreeLines || sparseByFill) {
      failures.push({
        label: `sparse_page_${page.pageNumber}`,
        pageIndex: page.pageIndex,
        reason: `sparsePage freeLines=${page.freeLines} fillRatioBottom=${page.fillRatioBottom} wordCount=${page.wordCount}`
      });
    }
  });
  return failures;
};

const run = async ({ ledocPath, outputPath, expectations, expectationsPath }) => {
  const { app, BrowserWindow } = getElectron();
  const docJson = readContentJson(ledocPath);

  const tmpRoot = path.join(repoRoot, ".tmp_page_cases");
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
    console.error("[FAIL] page cases timed out");
    app.exit(1);
  }, 120_000);

  await app.whenReady();
  const showWindow = process.env.LEDITOR_CASES_SHOW === "1";
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

    const payload = JSON.stringify(docJson);
    const payloadBase64 = Buffer.from(payload, "utf8").toString("base64");
    const disableFlatten = process.env.LEDITOR_DISABLE_FLATTEN === "1";
    const minLineChars = readEnvNumber("LEDITOR_MIN_LINE_CHARS") ?? 5;
    const setupResult = await win.webContents.executeJavaScript(
      `
      (() => {
        try {
          const __payload = JSON.parse(atob("${payloadBase64}"));
          if (${disableFlatten ? "true" : "false"}) {
            window.__leditorDisableFlatten = true;
          }
          try {
            window.__leditorPaginationTraceEnabled = true;
            window.__leditorPaginationTraceLimit = 600;
          } catch {}
          window.leditor.setContent(__payload, { format: "json" });
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
        try {
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
          let lastUnderfill = 0;
          let underfillStable = 0;
          for (let i = 0; i < 260; i += 1) {
            const count = getPages().length;
            if (count === lastCount) stable += 1;
            else { stable = 0; lastCount = count; }
            const overflowPages = Array.isArray(window.__leditorPaginationLastOverflowPages)
              ? window.__leditorPaginationLastOverflowPages
              : null;
            const noOverflow = Array.isArray(overflowPages) ? overflowPages.length === 0 : false;
            const trace = Array.isArray(window.__leditorPaginationTrace)
              ? window.__leditorPaginationTrace
              : [];
            const lastTrace = trace.length ? trace[trace.length - 1] : null;
            const lastTraceTs = typeof lastTrace?.ts === "number" ? lastTrace.ts : 0;
            const quietFor = lastTraceTs > 0 ? performance.now() - lastTraceTs : 0;
            const underfillRan = typeof window.__leditorPhase2UnderfillRan === "number"
              ? window.__leditorPhase2UnderfillRan
              : 0;
            const minUnderfillRuns = 5;
            if (underfillRan === lastUnderfill) underfillStable += 1;
            else { underfillStable = 0; lastUnderfill = underfillRan; }
            const followupAt = typeof window.__leditorPhase2UnderfillFollowupAt === "number"
              ? window.__leditorPhase2UnderfillFollowupAt
              : 0;
            const followupQuiet = followupAt > 0 ? performance.now() - followupAt > 900 : true;
            const quiet = quietFor > 1200;
            const settled =
              stable >= 8 &&
              count > 0 &&
              noOverflow &&
              quiet &&
              followupQuiet &&
              underfillStable >= 6 &&
              underfillRan >= minUnderfillRuns;
            if (settled) return count;
            await new Promise((r) => setTimeout(r, 180));
          }
          return getPages().length;
        };
        const pageCount = await waitForStablePages();
        const pages = getPages();
        const editor = window.leditor?.getEditor?.();
        const docPageCount = Number.isFinite(editor?.state?.doc?.childCount)
          ? editor.state.doc.childCount
          : null;
        const doc = editor?.state?.doc ?? null;
        const pageType = editor?.state?.schema?.nodes?.page ?? null;
        const manualBreakAtEnd = {};
        const manualBreakAtStart = {};
        const boundaryPosByIndex = {};
        const pageBoundaryInfo = {};
        const isFootnoteNode = (node) => {
          const name = node?.type?.name;
          return name === "footnotesContainer" || name === "footnoteBody";
        };
        if (doc && pageType && Number.isFinite(doc.childCount)) {
          let pos = 0;
          for (let i = 0; i < doc.childCount; i += 1) {
            const child = doc.child(i);
            if (!child || child.type !== pageType) break;
            boundaryPosByIndex[i] = pos;
            const pageEndsWithBreak = (pageNode) => {
              for (let c = pageNode.childCount - 1; c >= 0; c -= 1) {
                const node = pageNode.child(c);
                if (isFootnoteNode(node)) continue;
                return node.type?.name === "page_break";
              }
              return false;
            };
            const pageStartsWithBreak = (pageNode) => {
              for (let c = 0; c < pageNode.childCount; c += 1) {
                const node = pageNode.child(c);
                if (isFootnoteNode(node)) continue;
                return node.type?.name === "page_break";
              }
              return false;
            };
            manualBreakAtEnd[i] = pageEndsWithBreak(child);
            manualBreakAtStart[i] = pageStartsWithBreak(child);
            pos += child.nodeSize;
          }
        }
        const trace = Array.isArray(window.__leditorPaginationTrace)
          ? window.__leditorPaginationTrace
          : [];
        const splitEvents = trace.filter((entry) =>
          entry &&
          (entry.event === "dispatch:split" || entry.event === "dispatch:pullup")
        );
        const findBreakReason = (boundaryPos) => {
          if (!Number.isFinite(boundaryPos)) return null;
          let best = null;
          let bestDelta = Infinity;
          for (let i = splitEvents.length - 1; i >= 0; i -= 1) {
            const entry = splitEvents[i];
            const pos = entry?.pos;
            if (!Number.isFinite(pos)) continue;
            const delta = Math.abs(pos - boundaryPos);
            if (delta <= 3) {
              best = entry;
              break;
            }
            if (delta < bestDelta && delta <= 20) {
              best = entry;
              bestDelta = delta;
            }
          }
          if (!best) return null;
          const op = typeof best.event === "string" ? best.event.split(":")[1] : null;
          return best.reason || op || null;
        };
        const isWordChar = (ch) => /[\\p{L}\\p{N}]/u.test(ch || "");
        const isPunctuation = (ch) => /[.,;:!?]/.test(ch || "");
        const isHyphen = (ch) =>
          ch === "-" || ch === "\\u2010" || ch === "\\u2011" || ch === "\\u00ad" || ch === "\\u2212";
        const getChar = (from, to) => {
          try {
            return doc ? doc.textBetween(from, to, "\\n", "\\n") : "";
          } catch {
            return "";
          }
        };
        const hasAnchorMark = (node) =>
          Boolean(node?.marks && node.marks.some((mark) => mark?.type?.name === "anchor"));
        const isAnchorNode = (node) => node?.type?.name === "anchorMarker";
        const hasAnchorInNode = (node) => {
          if (!node) return false;
          if (hasAnchorMark(node) || isAnchorNode(node)) return true;
          if (!node.childCount) return false;
          for (let i = 0; i < node.childCount; i += 1) {
            if (hasAnchorInNode(node.child(i))) return true;
          }
          return false;
        };
        const findFirstTextblock = (node) => {
          if (!node) return null;
          if (node.isTextblock) return node;
          if (!node.childCount) return null;
          for (let i = 0; i < node.childCount; i += 1) {
            const child = node.child(i);
            if (isFootnoteNode(child)) continue;
            if (child.type?.name === "page_break") continue;
            const found = findFirstTextblock(child);
            if (found) return found;
          }
          return null;
        };
        const findLastTextblock = (node) => {
          if (!node) return null;
          if (node.isTextblock) return node;
          if (!node.childCount) return null;
          for (let i = node.childCount - 1; i >= 0; i -= 1) {
            const child = node.child(i);
            if (isFootnoteNode(child)) continue;
            if (child.type?.name === "page_break") continue;
            const found = findLastTextblock(child);
            if (found) return found;
          }
          return null;
        };
        const getBlockText = (node) => {
          if (!node) return "";
          try {
            return node.textBetween(0, node.content.size, "\\n", "\\n");
          } catch {
            return "";
          }
        };
        if (doc && pageType && Number.isFinite(doc.childCount)) {
          for (let i = 0; i < doc.childCount; i += 1) {
            const child = doc.child(i);
            if (!child || child.type !== pageType) break;
            const first = findFirstTextblock(child);
            const last = findLastTextblock(child);
            pageBoundaryInfo[i] = {
              firstSplitId: first?.attrs?.paginationSplitId ?? null,
              lastSplitId: last?.attrs?.paginationSplitId ?? null,
              firstText: getBlockText(first),
              lastText: getBlockText(last),
              firstHasAnchor: hasAnchorInNode(first),
              lastHasAnchor: hasAnchorInNode(last)
            };
          }
        }
        const normalize = (value) => String(value || "").replace(/\\u00a0/g, " ").replace(/\\s+/g, " ").trim();
        const MIN_LINE_CHARS = ${minLineChars};
        const getCanvas = (() => {
          let canvas = null;
          return () => {
            if (!canvas) canvas = document.createElement("canvas");
            return canvas;
          };
        })();
        const estimateCharWidth = (el) => {
          try {
            const style = window.getComputedStyle(el);
            const font = style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
            const canvas = getCanvas();
            const ctx = canvas.getContext("2d");
            if (!ctx) return 7;
            ctx.font = font;
            const sample = "abcdefghijklmnopqrstuvwxyz";
            const width = ctx.measureText(sample).width;
            return width > 0 ? width / sample.length : 7;
          } catch {
            return 7;
          }
        };
        const countShortLines = (blocks, minChars) => {
          if (!Array.isArray(blocks) || !blocks.length) return { shortLineCount: 0, shortLineExamples: [] };
          const shortLines = [];
          blocks.forEach((block) => {
            if (!block) return;
            let range;
            try {
              range = document.createRange();
              range.selectNodeContents(block);
            } catch {
              return;
            }
            const rects = Array.from(range.getClientRects());
            if (!rects.length) return;
            const avgChar = estimateCharWidth(block);
            const lines = [];
            rects.forEach((rect) => {
              let line = lines.find((entry) => Math.abs(entry.top - rect.top) <= 1);
              if (!line) {
                line = { top: rect.top, width: 0 };
                lines.push(line);
              }
              line.width += rect.width;
            });
            lines.sort((a, b) => a.top - b.top);
            const lastLine = lines[lines.length - 1];
            if (lastLine) {
              const estChars = avgChar > 0 ? lastLine.width / avgChar : 0;
              if (estChars > 0 && estChars < minChars) {
                shortLines.push(estChars);
              }
            }
          });
          return {
            shortLineCount: shortLines.length,
            shortLineExamples: shortLines.slice(0, 5)
          };
        };
        const countWordSplits = (root) => {
          const result = {
            characterSplitCount: 0,
            midWordSplitCount: 0,
            examples: []
          };
          if (!root) return result;
          if (typeof document.createTreeWalker !== "function" || typeof document.createRange !== "function") {
            return result;
          }
          const filter = typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4;
          let walker;
          let range;
          try {
            walker = document.createTreeWalker(root, filter, null);
            range = document.createRange();
          } catch {
            return result;
          }
          const wordRegex = /[\\p{L}\\p{N}]{2,}/gu;
          let scanned = 0;
          let node = walker.nextNode();
          while (node) {
            const text = node.nodeValue || "";
            if (text && /[\\p{L}\\p{N}]/u.test(text)) {
              wordRegex.lastIndex = 0;
              let match = wordRegex.exec(text);
              while (match) {
                const word = match[0];
                if (word.length >= 4) {
                  try {
                    range.setStart(node, match.index);
                    range.setEnd(node, match.index + word.length);
                  } catch {
                    match = wordRegex.exec(text);
                    continue;
                  }
                  const rects = Array.from(range.getClientRects());
                  if (rects.length > 1) {
                    result.midWordSplitCount += 1;
                    const firstTop = rects.reduce((min, rect) => Math.min(min, rect.top), rects[0].top);
                    let low = match.index;
                    let high = match.index + word.length - 1;
                    let best = match.index;
                    let safety = 0;
                    while (low <= high && safety < 32) {
                      safety += 1;
                      const mid = Math.floor((low + high) / 2);
                      try {
                        range.setStart(node, match.index);
                        range.setEnd(node, mid + 1);
                      } catch {
                        high = mid - 1;
                        continue;
                      }
                      const midRects = Array.from(range.getClientRects());
                      const lastRect = midRects.length ? midRects[midRects.length - 1] : null;
                      if (lastRect && Math.abs(lastRect.top - firstTop) <= 0.5) {
                        best = mid + 1;
                        low = mid + 1;
                      } else {
                        high = mid - 1;
                      }
                    }
                    const tailLen = match.index + word.length - best;
                    if (tailLen === 1) {
                      result.characterSplitCount += 1;
                      if (result.examples.length < 3) result.examples.push(word);
                    }
                    scanned += 1;
                    if (scanned > 800) return result;
                  }
                }
                match = wordRegex.exec(text);
              }
            }
            node = walker.nextNode();
          }
          return result;
        };
        const summaries = pages.map((page, index) => {
          const datasetIndexRaw = page?.dataset?.pageIndex ?? "";
          const datasetIndex = datasetIndexRaw !== "" ? Number.parseInt(datasetIndexRaw, 10) : null;
          const content = page.querySelector(".leditor-page-content");
          const contentRect = content ? content.getBoundingClientRect() : null;
          const blocks = content
            ? Array.from(content.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figure, hr, .leditor-break"))
            : [];
          const shortLineData = countShortLines(blocks, MIN_LINE_CHARS);
          const contentStyle = content ? window.getComputedStyle(content) : null;
          const lineHeightRaw = contentStyle ? contentStyle.lineHeight : "";
          const paddingBottomRaw = contentStyle ? contentStyle.paddingBottom : "";
          let lineHeight = Number.parseFloat(lineHeightRaw || "0");
          const sample =
            content?.querySelector("p, li, blockquote, pre") ??
            content?.querySelector("h1, h2, h3, h4, h5, h6");
          if (sample) {
            const sampleStyle = window.getComputedStyle(sample);
            const sampleLineHeight = Number.parseFloat(sampleStyle.lineHeight || "0");
            if (Number.isFinite(sampleLineHeight) && sampleLineHeight > 0) {
              lineHeight = sampleLineHeight;
            } else {
              const sampleFontSize = Number.parseFloat(sampleStyle.fontSize || "0");
              if (Number.isFinite(sampleFontSize) && sampleFontSize > 0 && (!Number.isFinite(lineHeight) || lineHeight <= 0)) {
                lineHeight = sampleFontSize * 1.2;
              }
            }
          }
          const paddingBottom = Number.parseFloat(paddingBottomRaw || "0") || 0;
          const tagCounts = {};
          blocks.forEach((block) => {
            const tag = block.classList?.contains("leditor-break") ? ".leditor-break" : block.tagName;
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          });
          const rawText = content ? (content.innerText || "") : "";
          const fullText = normalize(rawText);
          const words = fullText.length ? fullText.split(/\\s+/).filter(Boolean) : [];
          const scrollHeight = content ? content.scrollHeight : 0;
          const clientHeight = content ? content.clientHeight : 0;
          const scrollWidth = content ? content.scrollWidth : 0;
          const clientWidth = content ? content.clientWidth : 0;
          const scale = contentRect && clientHeight > 0 ? (contentRect.height / clientHeight) : 1;
          const guardPx = (() => {
            if (!content) return 0;
            const cssGuardRaw = window.getComputedStyle(content).getPropertyValue("--page-footnote-guard");
            const cssGuard = Number.parseFloat(cssGuardRaw || "0") || 0;
            const lhGuard = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight * 0.35 : 0;
            return Math.max(8, lhGuard, cssGuard);
          })();
          const usableHeight = Math.max(0, clientHeight - paddingBottom);
          const bottomLimit = Math.max(0, usableHeight - guardPx);
          const lastBottom = (() => {
            if (!content || !contentRect || !blocks.length) return 0;
            let maxBottom = 0;
            blocks.forEach((block) => {
              const rect = block.getBoundingClientRect();
              const marginBottom = Number.parseFloat(window.getComputedStyle(block).marginBottom || "0") || 0;
              const bottom = (rect.bottom - contentRect.top) / (scale || 1) + marginBottom;
              if (bottom > maxBottom) maxBottom = bottom;
            });
            return Math.max(0, maxBottom);
          })();
          const overflowByBottom = lastBottom > bottomLimit + 1;
          const whiteSpacePx = Math.max(0, bottomLimit - lastBottom);
          const whiteSpaceRatio = bottomLimit > 0 ? Math.min(1, Math.max(0, whiteSpacePx / bottomLimit)) : 0;
          let overflowBlockIndex = -1;
          let overflowBlockTag = null;
          let overflowBlockBottom = 0;
          let overflowBlockText = "";
          if (content && contentRect && blocks.length) {
            for (let i = 0; i < blocks.length; i += 1) {
              const block = blocks[i];
              const rect = block.getBoundingClientRect();
              const marginBottom = Number.parseFloat(window.getComputedStyle(block).marginBottom || "0") || 0;
              const bottom = (rect.bottom - contentRect.top) / (scale || 1) + marginBottom;
              if (bottom > bottomLimit + 1) {
                overflowBlockIndex = i;
                overflowBlockTag = block.tagName;
                overflowBlockBottom = bottom;
                overflowBlockText = normalize(block.textContent || "").slice(0, 80);
                break;
              }
            }
          }
          const usedHeight = (() => {
            if (!content || !contentRect || !blocks.length) return 0;
            let maxBottom = 0;
            blocks.forEach((block) => {
              const rect = block.getBoundingClientRect();
              const marginBottom = Number.parseFloat(window.getComputedStyle(block).marginBottom || "0") || 0;
              const bottom = rect.bottom - contentRect.top + marginBottom;
              if (bottom > maxBottom) maxBottom = bottom;
            });
            return Math.max(0, maxBottom);
          })();
          const fillRatioBottom = bottomLimit > 0
            ? Math.min(1, Math.max(0, lastBottom / bottomLimit))
            : 0;
          const fillRatio = contentRect && contentRect.height > 0
            ? Math.min(1, Math.max(0, usedHeight / contentRect.height))
            : 0;
          const maxLines =
            Number.isFinite(lineHeight) && lineHeight > 0
              ? Math.max(0, Math.floor(bottomLimit / lineHeight))
              : 0;
          const usedLines =
            Number.isFinite(lineHeight) && lineHeight > 0
              ? Math.max(0, Math.ceil(Math.min(lastBottom, bottomLimit) / lineHeight))
              : 0;
          const freeLines = Math.max(0, maxLines - usedLines);
          const firstBlock = blocks.length ? blocks[0] : null;
          const lastBlock = blocks.length ? blocks[blocks.length - 1] : null;
          const firstBlockTag = firstBlock ? (firstBlock.classList?.contains("leditor-break") ? ".leditor-break" : firstBlock.tagName) : null;
          const lastBlockTag = lastBlock ? (lastBlock.classList?.contains("leditor-break") ? ".leditor-break" : lastBlock.tagName) : null;
          const lastBlockText = lastBlock ? normalize(lastBlock.textContent || "").slice(0, 80) : "";
          const boundaryPos = boundaryPosByIndex[index] ?? null;
          const manualBreak =
            Boolean(manualBreakAtEnd[index - 1]) || Boolean(manualBreakAtStart[index]);
          const breakRule =
            index === 0
              ? "start"
              : manualBreak
                ? "manual"
                : (findBreakReason(boundaryPos) ?? null);
          const rawLines = rawText.split(/\\r?\\n/);
          let singleCharLineCount = 0;
          const charSplitLines = [];
          for (let i = 0; i < rawLines.length; i += 1) {
            const line = rawLines[i].trim();
            if (!line) continue;
            if (line.length === 1 && isWordChar(line)) {
              singleCharLineCount += 1;
              if (charSplitLines.length < 3) charSplitLines.push(line);
            }
          }
          const rangeSplits = content
            ? countWordSplits(content)
            : { characterSplitCount: 0, midWordSplitCount: 0, examples: [] };
          let characterSplitCount = singleCharLineCount + rangeSplits.characterSplitCount;
          if (rangeSplits.examples?.length) {
            rangeSplits.examples.forEach((example) => {
              if (charSplitLines.length < 3) charSplitLines.push(example);
            });
          }
          let midWordSplit = rangeSplits.midWordSplitCount > 0;
          let anchorSplit = false;
          let splitBeforeChar = "";
          let splitAfterChar = "";
          let splitBeforeText = "";
          let splitAfterText = "";
          let paragraphSplitAtBoundary = false;
          const boundaryInfo = pageBoundaryInfo[index] || {};
          const prevBoundaryInfo = pageBoundaryInfo[index - 1] || {};
          const prevLastText = String(prevBoundaryInfo.lastText || "").trim();
          const currFirstText = String(boundaryInfo.firstText || "").trim();
          const prevLastChar = prevLastText.slice(-1);
          const currFirstChar = currFirstText.slice(0, 1);
          const splitIdMatch =
            boundaryInfo.firstSplitId != null &&
            boundaryInfo.firstSplitId === prevBoundaryInfo.lastSplitId;
          if (splitIdMatch) {
            paragraphSplitAtBoundary = true;
            if (isWordChar(prevLastChar) && isWordChar(currFirstChar) && !isHyphen(prevLastChar)) {
              midWordSplit = true;
            }
            anchorSplit = Boolean(prevBoundaryInfo.lastHasAnchor || boundaryInfo.firstHasAnchor);
            const firstToken = currFirstText.split(/\\s+/).filter(Boolean)[0] || "";
            if (firstToken.length === 1 && isWordChar(firstToken) && isWordChar(prevLastChar)) {
              characterSplitCount += 1;
              if (charSplitLines.length < 3) charSplitLines.push(firstToken);
            }
          }
          if (!paragraphSplitAtBoundary && prevLastText && currFirstText) {
            const prevLower = /[\\p{Ll}]$/u.test(prevLastText);
            const currLower = /^[\\p{Ll}]/u.test(currFirstText);
            if (prevLower && currLower) {
              paragraphSplitAtBoundary = true;
            }
          }
          if (prevLastChar) {
            splitBeforeChar = prevLastChar;
            splitBeforeText = prevLastText.slice(-6);
          }
          if (currFirstChar) {
            splitAfterChar = currFirstChar;
            splitAfterText = currFirstText.slice(0, 6);
          }
          if (
            doc &&
            Number.isFinite(boundaryPos) &&
            boundaryPos > 0 &&
            boundaryPos < doc.content.size
          ) {
            const before = getChar(Math.max(0, boundaryPos - 1), boundaryPos);
            const after = getChar(boundaryPos, Math.min(doc.content.size, boundaryPos + 1));
            const boundaryBeforeChar = before ? before.slice(-1) : "";
            const boundaryAfterChar = after ? after.slice(0, 1) : "";
            if (!splitBeforeChar) splitBeforeChar = boundaryBeforeChar;
            if (!splitAfterChar) splitAfterChar = boundaryAfterChar;
            if (!splitBeforeText) splitBeforeText = getChar(Math.max(0, boundaryPos - 6), boundaryPos);
            if (!splitAfterText) splitAfterText = getChar(boundaryPos, Math.min(doc.content.size, boundaryPos + 6));
            midWordSplit =
              midWordSplit ||
              (isWordChar(boundaryBeforeChar) &&
                isWordChar(boundaryAfterChar) &&
                !isHyphen(boundaryBeforeChar));
            try {
              const $pos = doc.resolve(boundaryPos);
              const beforeNode = $pos.nodeBefore;
              const afterNode = $pos.nodeAfter;
              anchorSplit =
                anchorSplit ||
                hasAnchorMark(beforeNode) ||
                hasAnchorMark(afterNode) ||
                isAnchorNode(beforeNode) ||
                isAnchorNode(afterNode);
              if ($pos.parent?.isTextblock) {
                paragraphSplitAtBoundary =
                  paragraphSplitAtBoundary ||
                  Boolean(beforeNode?.isText && afterNode?.isText);
              }
            } catch {
              // ignore
            }
          }
          const firstLetter = (() => {
            for (let i = 0; i < currFirstText.length; i += 1) {
              const ch = currFirstText[i];
              if (/[A-Za-z]/.test(ch)) return ch;
            }
            return "";
          })();
          const lastNonSpace = (() => {
            for (let i = prevLastText.length - 1; i >= 0; i -= 1) {
              const ch = prevLastText[i];
              if (!/\s/.test(ch)) return ch;
            }
            return "";
          })();
          const firstNonSpace = (() => {
            for (let i = 0; i < currFirstText.length; i += 1) {
              const ch = currFirstText[i];
              if (!/\s/.test(ch)) return ch;
            }
            return "";
          })();
          const sentenceCaseViolation =
            !(/^H[1-6]$/.test(firstBlockTag || "")) &&
            /[.!?]/.test(lastNonSpace) &&
            firstLetter &&
            /[a-z]/.test(firstLetter);
          const punctuationSplit =
            Boolean(firstNonSpace) && isPunctuation(firstNonSpace) && isWordChar(prevLastChar);
          return {
            pageIndex: index,
            pageNumber: index + 1,
            datasetIndex,
            blockCount: blocks.length,
            paragraphCount: blocks.filter((b) => b.tagName === "P").length,
            headingCount: blocks.filter((b) => /^H[1-6]$/.test(b.tagName)).length,
            listItemCount: blocks.filter((b) => b.tagName === "LI").length,
            wordCount: words.length,
            fullText,
            rawText,
            tagCounts,
            overflowY: Math.max(0, Math.round(scrollHeight - clientHeight)),
            overflowX: Math.max(0, Math.round(scrollWidth - clientWidth)),
            clientHeight,
            scrollHeight,
            usableHeight,
            bottomLimit,
            lastBottom,
            overflowByBottom,
            scale,
            guardPx,
            whiteSpacePx: Math.round(whiteSpacePx * 10) / 10,
            bottomWhitespacePx: Math.round(whiteSpacePx * 10) / 10,
            whiteSpaceRatio: Math.round(whiteSpaceRatio * 1000) / 1000,
            overflowBlockIndex,
            overflowBlockTag,
            overflowBlockBottom,
            overflowBlockText,
            usedHeight,
            fillRatioBottom: Math.round(fillRatioBottom * 1000) / 1000,
            fillRatio: Math.round(fillRatio * 1000) / 1000,
            lineHeight,
            usedLines,
            maxLines,
            freeLines,
            firstBlockTag,
            lastBlockTag,
            lastBlockText,
            breakRule,
            breakBoundaryPos: boundaryPos,
            breakManual: manualBreak,
            midWordSplit,
            anchorSplit,
            splitBeforeChar,
            splitAfterChar,
            splitBeforeText,
            splitAfterText,
            paragraphSplitAtBoundary,
            singleCharLineCount,
            characterSplitCount,
            characterSplitLines: charSplitLines,
            shortLineCount: shortLineData.shortLineCount,
            shortLineExamples: shortLineData.shortLineExamples,
            sentenceCaseViolation,
            sentenceCaseBeforeChar: lastNonSpace,
            sentenceCaseAfterChar: firstLetter,
            punctuationSplit,
            punctuationSplitChar: firstNonSpace,
            punctuationSplitPrevChar: prevLastChar,
            contentBox: contentRect
              ? { width: Math.round(contentRect.width * 10) / 10, height: Math.round(contentRect.height * 10) / 10 }
              : null
          };
        });
        return {
          ok: true,
          pageCount,
          docPageCount,
          pages: summaries,
          paginationMemo: (() => {
            try {
              const memo = window.__leditorPaginationMemo || {};
              return {
                lastSplitPos: memo.lastSplitPos ?? null,
                lastSplitAttemptPos: memo.lastSplitAttemptPos ?? null,
                lastSplitAt: memo.lastSplitAt ?? null,
                lastSplitReason: memo.lastSplitReason ?? null,
                lastJoinPos: memo.lastJoinPos ?? null,
                lastJoinAt: memo.lastJoinAt ?? null,
                lastPaginationOnlySplitCount: memo.lastPaginationOnlySplitCount ?? null
              };
            } catch {
              return null;
            }
          })(),
          paginationTraceTail: (() => {
            try {
              const trace = Array.isArray(window.__leditorPaginationTrace)
                ? window.__leditorPaginationTrace
                : [];
              return trace.slice(-120);
            } catch {
              return [];
            }
          })(),
          paginationState: {
            lastPhase: window.__leditorPaginationLastPhase || null,
            lastAction: window.__leditorPaginationLastAction || null,
            lastOverflowPages: Array.isArray(window.__leditorPaginationLastOverflowPages)
              ? window.__leditorPaginationLastOverflowPages
              : [],
            lastStable: typeof window.__leditorPaginationLastStable === "boolean"
              ? window.__leditorPaginationLastStable
              : null
          },
          domCounts: {
            pageCount: document.querySelectorAll(".leditor-page").length,
            pageStackCount: document.querySelectorAll(".leditor-page-stack").length,
            pageStackPageCount: document.querySelectorAll(".leditor-page-stack .leditor-page").length
          },
          phase2UnderfillRan: typeof window.__leditorPhase2UnderfillRan === "number"
            ? window.__leditorPhase2UnderfillRan
            : null
          ,
          phase2UnderfillDebug: window.__leditorPhase2UnderfillDebug ?? null,
          phase2UnderfillMeta: window.__leditorPhase2UnderfillMeta ?? null,
          phase2UnderfillFailures: window.__leditorPhase2UnderfillFailures ?? null
        };
        } catch (err) {
          return { ok: false, reason: String(err && err.message ? err.message : err) };
        }
      })();
      `,
      true
    );

    if (!report || report.ok !== true) {
      throw new Error(report?.reason || "report failed");
    }

    const failures = evaluateExpectations(report.pages, expectations);
    const output = {
      ledocPath,
      expectationsPath,
      pageCount: report.pageCount,
      docPageCount: report.docPageCount,
      paginationState: report.paginationState,
      domCounts: report.domCounts ?? null,
      phase2UnderfillRan: report.phase2UnderfillRan ?? null,
      phase2UnderfillDebug: report.phase2UnderfillDebug ?? null,
      phase2UnderfillMeta: report.phase2UnderfillMeta ?? null,
      phase2UnderfillFailures: report.phase2UnderfillFailures ?? null,
      paginationMemo: report.paginationMemo,
      paginationTraceTail: report.paginationTraceTail,
      failures,
      pages: report.pages
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
    if (failures.length) {
      console.error(`[FAIL] pagination page cases failed (${failures.length})`);
      failures.forEach((fail) => {
        console.error(`- ${fail.label} (page ${fail.pageIndex + 1}): ${fail.reason}`);
      });
      process.exitCode = 1;
    } else {
      console.log(`[PASS] pagination page cases passed: ${outputPath}`);
    }
  } catch (err) {
    console.error("[FAIL] page cases error", err?.message || err);
    process.exitCode = 1;
  } finally {
    clearTimeout(killTimer);
    setTimeout(() => app.exit(process.exitCode || 0), 250);
  }
};

const main = async () => {
  const { ledocPath, outputPath, expectPath } = parseArgs();
  const expectationsRaw = loadExpectations(expectPath);
  const expectations = normalizeExpectations(expectationsRaw.pages);
  await run({
    ledocPath,
    outputPath,
    expectations,
    expectationsPath: expectationsRaw.path
  });
};

if (require.main === module) {
  main().catch((error) => {
    console.error("[FAIL] page cases runner error", error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  evaluateExpectations,
  normalizeExpectations,
  readEnvNumber
};
