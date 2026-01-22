import type { LayoutSnapshot } from "../panels/PanelLayoutRoot";
import { loadPanelLayouts as loadPanelLayoutsFromSession, persistPanelLayouts } from "../session/sessionStorage";

const STORAGE_KEY = "annotarium.layout.v1";
const PANEL_STORAGE_KEY = "annotarium.layout.panels.v1";

type PanelLayouts = Record<string, LayoutSnapshot>;

export function savePanelLayout(panelId: string, snapshot: LayoutSnapshot): void {
  const layouts = loadPanelLayouts() ?? {};
  layouts[panelId] = snapshot;
  persistPanelLayouts(layouts);
}

export function loadPanelLayouts(): PanelLayouts | null {
  return loadPanelLayoutsFromStorage();
}

export function loadPanelLayout(panelId: string): LayoutSnapshot | null {
  const layouts = loadPanelLayoutsFromStorage();
  return layouts ? layouts[panelId] ?? null : null;
}

export function clearLayout(): void {
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(PANEL_STORAGE_KEY);
  }
}

function loadPanelLayoutsFromStorage(): PanelLayouts | null {
  return loadPanelLayoutsFromSession();
}
