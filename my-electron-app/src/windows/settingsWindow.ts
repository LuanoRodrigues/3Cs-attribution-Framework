import { BrowserWindow } from "electron";
import path from "path";
import { applyDefaultZoomFactor } from "./windowZoom";

let cachedWindow: BrowserWindow | null = null;

function getSettingsHtmlPath(): string {
  return path.join(__dirname, "settings.html");
}

export function openSettingsWindow(targetSection?: string): void {
  if (cachedWindow && !cachedWindow.isDestroyed()) {
    const hash = targetSection ? `section=${targetSection}` : "";
    cachedWindow.loadFile(getSettingsHtmlPath(), { hash });
    cachedWindow.focus();
    return;
  }

  const window = new BrowserWindow({
    width: 1200,
    height: 960,
    minWidth: 900,
    minHeight: 700,
    title: "Annotarium Settings",
    backgroundColor: "#f3f4f6",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "..", "preload.js")
    }
  });

  applyDefaultZoomFactor(window);

  const hash = targetSection ? `section=${targetSection}` : "";
  window.loadFile(getSettingsHtmlPath(), { hash });
  window.on("closed", () => {
    cachedWindow = null;
  });
  cachedWindow = window;
}
