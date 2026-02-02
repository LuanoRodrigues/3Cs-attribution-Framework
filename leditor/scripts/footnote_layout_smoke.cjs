const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const indexHtml = path.join(repoRoot, "dist", "public", "index.html");
const fixturePath = path.join(repoRoot, "docs", "test_documents", "footnote_regression.json");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (webContents, script, timeout = 15_000) => {
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
  register("leditor:open-pdf-viewer", async () => ({ success: false, error: "disabled" }));
  register("leditor:pdf-viewer-payload", async () => null);
  register("leditor:resolve-pdf-path", async () => null);
  register("leditor:get-direct-quote-entry", async () => null);
  register("leditor:prefetch-direct-quotes", async () => ({ success: true, found: 0 }));
};

const run = async () => {
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
    console.error("[FAIL] footnote layout smoke timed out");
    app.exit(1);
  }, 60_000);

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

  try {
    await win.loadFile(indexHtml);
    await waitFor(win.webContents, "Boolean(window.leditor && window.leditor.getEditor)");
    await delay(400);
    await win.webContents.executeJavaScript(
      "window.__leditorFootnoteLayoutDebug = true; true;",
      true
    );
    const fixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const fixturePayload = JSON.stringify(fixtureJson);
    const flowResult = await win.webContents.executeJavaScript(
      `
      (async () => {
        const editor = window.leditor?.getEditor?.();
        if (!editor || !window.leditor) return { ok: false, reason: "no editor" };

        const lorem =
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
          "Integer nec odio. Praesent libero. Sed cursus ante dapibus diam. ";
        const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
        const heading = { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Footnote Flow" }] };

        const baseDoc = {
          type: "doc",
          content: [
            heading,
            para(lorem.repeat(20)),
            para(lorem.repeat(18))
          ]
        };
        window.leditor.setContent(baseDoc, { format: "json" });
        await new Promise((r) => setTimeout(r, 300));

        let loops = 0;
        while (document.querySelectorAll(".leditor-page").length < 2 && loops < 8) {
          editor.commands.insertContent(para(lorem.repeat(22)));
          loops += 1;
          await new Promise((r) => setTimeout(r, 150));
        }

        const pageCount = document.querySelectorAll(".leditor-page").length;
        if (pageCount < 2) {
          return { ok: false, reason: "could not reach 2 pages", pageCount };
        }

        // Set caret near end of first paragraph.
        const firstPara = editor.state.doc.child(1);
        const firstParaPos = editor.state.doc.content.findIndex(1).offset;
        const endPos = Math.max(1, firstParaPos + firstPara.nodeSize - 2);
        editor.commands.setTextSelection(endPos);
        editor.view.focus();
        const selectionBefore = editor.state.selection.from;

        // Insert footnote (proxy for citation button).
        window.leditor.execCommand("InsertFootnote");
        await new Promise((r) => setTimeout(r, 200));
        const selectionAfterInsert = editor.state.selection.from;

        // Grab inserted footnote id + marker.
        let footnoteId = null;
        editor.state.doc.descendants((node) => {
          if (node.type.name !== "footnote") return true;
          const id = (node.attrs?.footnoteId || node.attrs?.id || "").toString().trim();
          if (id) {
            footnoteId = id;
            return false;
          }
          return true;
        });
        if (!footnoteId) return { ok: false, reason: "no footnote inserted" };

        const marker = document.querySelector('.leditor-footnote-marker');
        const markerIsSup = marker ? marker.tagName === "SUP" : false;
        const selectionDeltaOk = Math.abs(selectionAfterInsert - selectionBefore) <= 2;
        const markerPage = marker ? marker.closest('.leditor-page') : null;
        const markerPageIndex = markerPage ? Number(markerPage.dataset.pageIndex || "0") : 0;

        // Focus footnote entry.
        window.dispatchEvent(new CustomEvent("leditor:footnote-focus", { detail: { footnoteId } }));
        await new Promise((r) => setTimeout(r, 300));
        const entry = document.querySelector(
          '.leditor-footnote-entry-text[data-footnote-id="' + footnoteId + '"]'
        );
        const overlay = entry ? entry.closest('.leditor-page-overlay') : null;
        const footnotePageIndex = overlay ? Number(overlay.dataset.pageIndex || "0") : 0;
        const activeIsFootnote = document.activeElement === entry;

        // Exit footnote mode to modify body content.
        window.dispatchEvent(new CustomEvent("leditor:footnote-exit"));
        await new Promise((r) => setTimeout(r, 200));

        // Add big paragraph to stress layout.
        editor.commands.insertContent(para(lorem.repeat(26)));
        await new Promise((r) => setTimeout(r, 300));

        // Re-enter footnote mode and expand footnote text to multiple lines.
        window.dispatchEvent(new CustomEvent("leditor:footnote-focus", { detail: { footnoteId } }));
        await new Promise((r) => setTimeout(r, 200));
        const entry2 = document.querySelector(
          '.leditor-footnote-entry-text[data-footnote-id="' + footnoteId + '"]'
        );
        if (entry2) {
          entry2.textContent = "Footnote expansion. " + lorem.repeat(6);
          entry2.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
          entry2.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await new Promise((r) => setTimeout(r, 500));

        // Click back into body.
        const prose = document.querySelector(".ProseMirror");
        const body = prose || document.querySelector('.leditor-page .leditor-page-content');
        if (body) {
          const rect = body.getBoundingClientRect();
          const clickX = Math.max(rect.left + 12, rect.left + rect.width * 0.2);
          const clickY = Math.max(rect.top + 12, rect.top + rect.height * 0.3);
          body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: clickX, clientY: clickY }));
          body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: clickX, clientY: clickY }));
          body.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: clickX, clientY: clickY }));
        }
        await new Promise((r) => setTimeout(r, 250));

        const selectionAfter = editor.state.selection.from;
        const caretReturnedToBody =
          (typeof editor.isFocused === "function" ? editor.isFocused() : false) ||
          (document.activeElement?.classList?.contains("ProseMirror") ?? false);

        return {
          ok: true,
          pageCount,
          selectionBefore,
          selectionAfter,
          selectionAfterInsert,
          footnoteId,
          markerPageIndex,
          footnotePageIndex,
          activeIsFootnote,
          markerIsSup,
          selectionDeltaOk,
          caretReturnedToBody
        };
      })();
      `,
      true
    );
    if (!flowResult || !flowResult.ok) {
      throw new Error("Footnote flow setup failed: " + JSON.stringify(flowResult));
    }
    const footnoteId = flowResult.footnoteId;
    await waitFor(
      win.webContents,
      `Boolean(document.querySelector('.leditor-page-overlay .leditor-footnote-entry-text[data-footnote-id="${footnoteId}"]'))`
    );
    await waitFor(
      win.webContents,
      `
      (function () {
        const foot = document.querySelector('.leditor-page-overlay .leditor-page-footnotes');
        if (!foot) return false;
        const rect = foot.getBoundingClientRect();
        return rect.height > 0;
      })();
      `
    );
    await delay(300);
    const result = await win.webContents.executeJavaScript(
      `
      (function () {
        const pages = Array.from(document.querySelectorAll('.leditor-page'));
        if (pages.length === 0) return { ok: false, reason: 'no pages' };
        const overlaps = [];
        const footnotes = Array.from(document.querySelectorAll('.leditor-page-overlay .leditor-page-footnotes'));
        footnotes.forEach((foot) => {
          const hasEntries = foot.querySelector('.leditor-footnote-entry') != null;
          if (!hasEntries) return;
          const overlay = foot.closest('.leditor-page-overlay');
          const pageIndex = overlay ? Number(overlay.dataset.pageIndex || '-1') : -1;
          const page = pages[pageIndex] || null;
          const content = page ? page.querySelector('.leditor-page-content') : null;
          if (!page || !content || !overlay) return;
          const footRect = foot.getBoundingClientRect();
          const contentRect = content.getBoundingClientRect();
          const pageRect = page.getBoundingClientRect();
          const overlayRect = overlay.getBoundingClientRect();
          const contentBottomRel = contentRect.bottom - pageRect.top;
          const footTopRel = footRect.top - overlayRect.top;
          if (contentBottomRel > footTopRel - 1) {
            overlaps.push({
              pageIndex,
              contentBottom: contentBottomRel,
              footTop: footTopRel
            });
          }
        });
        const pageVars = (() => {
          const page = pages[0];
          if (!page) return null;
          const style = getComputedStyle(page);
          return {
            footnoteHeight: style.getPropertyValue('--page-footnote-height').trim(),
            footnoteGap: style.getPropertyValue('--page-footnote-gap').trim(),
            effectiveBottom: style.getPropertyValue('--effective-margin-bottom').trim()
          };
        })();
        const pagesDebug = pages.slice(0, 3).map((page, idx) => {
          const style = getComputedStyle(page);
          return {
            idx,
            datasetIndex: page.dataset.pageIndex || null,
            inlineFootnoteHeight: page.style.getPropertyValue('--page-footnote-height') || null,
            footnoteHeight: style.getPropertyValue('--page-footnote-height').trim(),
            effectiveBottom: style.getPropertyValue('--effective-margin-bottom').trim(),
            parentClass: page.parentElement ? page.parentElement.className : null
          };
        });
        const overlayVars = (() => {
          const overlay = document.querySelector('.leditor-page-overlay[data-page-index="0"]');
          const foot = overlay ? overlay.querySelector('.leditor-page-footnotes') : null;
          if (!overlay || !foot) return null;
          const style = getComputedStyle(overlay);
          return {
            overlayIndex: overlay.dataset.pageIndex || null,
            overlayFootnoteHeight: style.getPropertyValue('--page-footnote-height').trim(),
            overlayEffectiveBottom: style.getPropertyValue('--effective-margin-bottom').trim(),
            footInlineHeight: foot.style.height || null,
            footDebugHeight: foot.getAttribute('data-debug-footnote-height'),
            footActive: foot.classList.contains('leditor-page-footnotes--active')
          };
        })();
        return {
          ok: overlaps.length === 0,
          overlaps,
          pageCount: pages.length,
          footnoteCount: footnotes.length,
          pageVars,
          pagesDebug,
          overlayVars
        };
      })();
      `,
      true
    );
    if (!result || !result.ok) {
      console.error("[FAIL] footnote layout smoke", result);
      throw new Error("Footnote layout smoke check failed");
    }

    const consistencyChecks = [];
    if (flowResult.markerPageIndex !== flowResult.footnotePageIndex) {
      consistencyChecks.push("footnote entry not on same page as marker");
    }
    if (!flowResult.activeIsFootnote) {
      consistencyChecks.push("footnote entry did not receive focus");
    }
    if (!flowResult.markerIsSup) {
      consistencyChecks.push("footnote marker is not rendered as superscript");
    }
    if (!flowResult.selectionDeltaOk) {
      consistencyChecks.push("caret moved too far during footnote insertion");
    }
    if (!flowResult.caretReturnedToBody) {
      consistencyChecks.push("caret did not return to body after click");
    }
    if (consistencyChecks.length > 0) {
      console.error("[FAIL] footnote flow checks", consistencyChecks, flowResult);
      throw new Error("Footnote flow checks failed");
    }

    console.log("[PASS] footnote layout smoke", result);
    console.log("[PASS] footnote flow checks", {
      markerPageIndex: flowResult.markerPageIndex,
      footnotePageIndex: flowResult.footnotePageIndex,
      selectionBefore: flowResult.selectionBefore,
      selectionAfter: flowResult.selectionAfter
    });
  } finally {
    clearTimeout(killTimer);
    if (!win.isDestroyed()) {
      win.destroy();
    }
    app.quit();
  }
};

run().catch((error) => {
  console.error("[FAIL] footnote layout smoke", error);
  app.exit(1);
});
