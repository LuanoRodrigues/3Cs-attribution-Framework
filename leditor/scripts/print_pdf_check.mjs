import path from "path";
import { promises as fs } from "fs";
import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const INDEX_HTML = path.join(REPO_ROOT, "dist/public/index.html");
const LOG_PATH = path.join(REPO_ROOT, ".codex_logs");
const OUTPUT_PDF = path.join(LOG_PATH, "print-to-pdf-check.pdf");

const A4_WIDTH_POINTS = 595.276;
const A4_HEIGHT_POINTS = 841.89;
const TOLERANCE_POINTS = 4;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (webContents, script, timeout = 15_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const result = await webContents.executeJavaScript(script);
      if (result) return;
    } catch {
      // Ignore race conditions while renderer is still loading.
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for condition");
};

const parseMediaBox = (buffer) => {
  const text = buffer.toString("latin1");
  const match = /MediaBox\s*\[\s*0\s*0\s*([\d.]+)\s*([\d.]+)\s*]/.exec(text);
  if (!match) {
    throw new Error("PDF MediaBox entry not found");
  }
  return {
    width: Number.parseFloat(match[1]),
    height: Number.parseFloat(match[2])
  };
};

const run = async () => {
  app.commandLine.appendSwitch("headless");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-dev-shm-usage");

  await app.whenReady();
  const browserWindow = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(REPO_ROOT, "dist/electron/preload.js")
    }
  });

  try {
    await browserWindow.loadFile(INDEX_HTML);
    await waitFor(browserWindow.webContents, "!!(window.leditor && window.leditor.getEditor)");
    await delay(1_000);
    const pdfBuffer = await browserWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      preferCSSPageSize: true
    });

    await fs.mkdir(LOG_PATH, { recursive: true });
    await fs.writeFile(OUTPUT_PDF, pdfBuffer);

    const { width, height } = parseMediaBox(pdfBuffer);
    if (Math.abs(width - A4_WIDTH_POINTS) > TOLERANCE_POINTS || Math.abs(height - A4_HEIGHT_POINTS) > TOLERANCE_POINTS) {
      throw new Error(`Page size mismatch: ${width.toFixed(2)}×${height.toFixed(2)} pts`);
    }

    console.log("[PASS] Headless print-to-PDF produced A4 page", {
      path: OUTPUT_PDF,
      sizePts: { width, height }
    });
  } finally {
    if (!browserWindow.isDestroyed()) {
      browserWindow.destroy();
    }
    app.quit();
  }
};

run().catch((error) => {
  console.error("[FAIL] print_pdf_check", error);
  app.exit(1);
});
