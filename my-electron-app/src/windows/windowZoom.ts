import type { BrowserWindow } from "electron";

const DEFAULT_ZOOM_FACTOR = 1.15;
const DEFAULT_ZOOM_FACTOR_ENV = "ANNOTARIUM_DEFAULT_ZOOM_FACTOR";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getDefaultZoomFactor(): number {
  const raw = (process.env[DEFAULT_ZOOM_FACTOR_ENV] || "").trim();
  if (!raw) {
    return DEFAULT_ZOOM_FACTOR;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ZOOM_FACTOR;
  }

  return clamp(parsed, 0.5, 3);
}

export function applyDefaultZoomFactor(window: BrowserWindow): void {
  const zoomFactor = getDefaultZoomFactor();

  const apply = (): void => {
    if (window.isDestroyed()) {
      return;
    }
    window.webContents.setZoomFactor(zoomFactor);
  };

  window.webContents.on("did-finish-load", apply);
  window.webContents.on("did-navigate", apply);
  window.webContents.on("did-navigate-in-page", apply);
  apply();
}
