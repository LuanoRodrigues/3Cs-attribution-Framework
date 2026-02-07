const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");

process.env.ELECTRON_DISABLE_SANDBOX = "1";

const repoRoot = path.resolve(__dirname, "..");
const indexHtml = path.join(repoRoot, "dist", "public", "index.html");

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
  register("leditor:get-default-ledoc-path", async () => ({ success: true, path: "" }));
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
  app.commandLine.appendSwitch("disable-setuid-sandbox");
  app.commandLine.appendSwitch("no-zygote");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.commandLine.appendSwitch("disable-features", "UsePortal");
  app.commandLine.appendSwitch("gtk-use-portal", "0");

  registerIpcFallbacks();

  const killTimer = setTimeout(() => {
    console.error("[FAIL] citation style footnotes smoke timed out");
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

    const result = await win.webContents.executeJavaScript(
      `
      (async () => {
        // Seed minimal reference library so citeproc has something to render.
        try {
          const payload = {
            items: [
              { itemKey: "ABCD1234", author: "John Smith", year: "2009", title: "The Title", url: "https://example.com" }
            ],
            updatedAt: new Date().toISOString()
          };
          window.localStorage.setItem("leditor.references.library", JSON.stringify(payload));
        } catch {}

        const editor = window.leditor?.getEditor?.();
        if (!editor) return { ok: false, reason: "no editor" };

        const doc = {
          type: "doc",
          attrs: { citationStyleId: "apa", citationLocale: "en-US" },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Test " },
                {
                  type: "citation",
                  attrs: {
                    citationId: "c-test-1",
                    items: [{ itemKey: "ABCD1234", locator: "36", label: "page", prefix: null, suffix: null, suppressAuthor: false, authorOnly: false }],
                    renderedHtml: "",
                    hidden: false,
                    dqid: null,
                    title: null
                  }
                },
                { type: "text", text: " end." }
              ]
            }
          ]
        };
        window.leditor.setContent(doc, { format: "json" });
        await new Promise((r) => setTimeout(r, 300));

        // Ensure pagination/A4 layout has mounted at least one page.
        let loops = 0;
        while (document.querySelectorAll(".leditor-page").length < 1 && loops < 20) {
          await new Promise((r) => setTimeout(r, 100));
          loops += 1;
        }
        const initialContainer = document.querySelector(".leditor-page-stack .leditor-page-footnotes");
        const initialHidden = initialContainer ? initialContainer.getAttribute("aria-hidden") : null;

        // Change style to Chicago NB (note style). This should insert footnote markers AND render footnote areas.
        window.leditor.execCommand("citation.style.set", { id: "chicago-note-bibliography" });
        // Give pagination + footnote renderer time to run (includes delayed refreshes).
        await new Promise((r) => setTimeout(r, 1500));

        const markers = document.querySelectorAll(".leditor-footnote-marker").length;
        const activeContainers = Array.from(document.querySelectorAll(".leditor-page-stack .leditor-page-footnotes"))
          .filter((el) => el.classList.contains("leditor-page-footnotes--active"));
        const anyVisible = activeContainers.some((el) => el.getAttribute("aria-hidden") === "false");
        const entries = document.querySelectorAll(".leditor-page-stack .leditor-footnote-entry-text").length;

        return {
          ok: true,
          initialHidden,
          markers,
          activeContainerCount: activeContainers.length,
          anyVisible,
          entries
        };
      })();
      `,
      true
    );

    if (!result || !result.ok) {
      throw new Error("Smoke run failed: " + JSON.stringify(result));
    }
    if (result.markers < 1) {
      throw new Error("Expected footnote markers after style change; got " + result.markers);
    }
    if (!result.anyVisible) {
      throw new Error(
        "Expected at least one visible footnote container (aria-hidden=false) after style change; got " +
          JSON.stringify(result)
      );
    }
    if (result.entries < 1) {
      throw new Error("Expected footnote entries rendered into page stack; got " + result.entries);
    }

    console.log("[PASS] citation style footnotes smoke", result);
  } finally {
    clearTimeout(killTimer);
    if (!win.isDestroyed()) {
      win.destroy();
    }
    app.quit();
  }
};

run().catch((error) => {
  console.error("[FAIL] citation style footnotes smoke", error);
  app.exit(1);
});
