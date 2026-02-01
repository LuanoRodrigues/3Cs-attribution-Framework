import { BrowserWindow, nativeTheme } from "electron";
import path from "path";
import { applyDefaultZoomFactor } from "./windowZoom";
import { APPEARANCE_KEYS } from "../config/settingsKeys";
import { getSetting } from "../config/settingsFacade";
import { resolveThemeTokens, themeIds, type ThemeId } from "../renderer/theme/tokens";

let cachedWindow: BrowserWindow | null = null;

function getSettingsHtmlPath(): string {
  return path.join(__dirname, "settings.html");
}

function resolveSettingsBackgroundColor(): string {
  try {
    const raw = getSetting<string>(APPEARANCE_KEYS.theme, "system") ?? "system";
    const themeId: ThemeId = themeIds.includes(raw as ThemeId) ? (raw as ThemeId) : "system";
    const systemPref: "dark" | "light" = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    return resolveThemeTokens(themeId, systemPref).bg;
  } catch {
    return "#f6f7fb";
  }
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
    backgroundColor: resolveSettingsBackgroundColor(),
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
