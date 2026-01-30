import type { LayoutSnapshot } from "../panels/PanelLayoutRoot";
import type { PanelGridState } from "../state/panelGrid";
import type { CodeStateSnapshot } from "../state/codeState";

const LAYOUT_KEY = "annotarium.layout.v1";
const PANEL_LAYOUTS_KEY = "annotarium.layout.panels.v1";
const PANEL_GRID_KEY = "annotarium.panelgrid.v2";
const CODE_STATE_KEY = "annotarium.code.rqs.v1";

export interface SessionStateProvider {
  getLayoutSnapshot(): LayoutSnapshot | null;
  setLayoutSnapshot(value: LayoutSnapshot): void;
  getPanelLayouts?: () => Record<string, LayoutSnapshot> | null;
  setPanelLayouts?: (value: Record<string, LayoutSnapshot>) => void;
  getPanelGridState(): PanelGridState | null;
  setPanelGridState(value: PanelGridState): void;
  getCodeState(): CodeStateSnapshot | null;
  setCodeState(value: CodeStateSnapshot): void;
}

let provider: SessionStateProvider | null = null;

export function registerSessionStateProvider(stateProvider: SessionStateProvider): void {
  provider = stateProvider;
}

export function clearSessionStateProvider(): void {
  provider = null;
}

export function loadLayoutSnapshot(): LayoutSnapshot | null {
  const provided = provider?.getLayoutSnapshot();
  if (provided) {
    return sanitizeLayoutSnapshot(provided);
  }
  const stored = readFromStorage<LayoutSnapshot>(LAYOUT_KEY);
  return stored ? sanitizeLayoutSnapshot(stored) : null;
}

export function persistLayoutSnapshot(snapshot: LayoutSnapshot): void {
  provider?.setLayoutSnapshot(snapshot);
  writeToStorage(LAYOUT_KEY, snapshot);
}

export function loadPanelLayouts(): Record<string, LayoutSnapshot> | null {
  const provided = provider?.getPanelLayouts?.();
  if (provided) {
    return sanitizePanelLayouts(provided);
  }
  const direct = readFromStorage<Record<string, LayoutSnapshot>>(PANEL_LAYOUTS_KEY);
  if (direct) {
    return sanitizePanelLayouts(direct);
  }
  return null;
}

export function persistPanelLayouts(layouts: Record<string, LayoutSnapshot>): void {
  provider?.setPanelLayouts?.(layouts);
  writeToStorage(PANEL_LAYOUTS_KEY, layouts);
}

export function loadPanelGridState(): PanelGridState | null {
  const provided = provider?.getPanelGridState();
  if (provided) {
    return provided;
  }
  const direct = readFromStorage<PanelGridState>(PANEL_GRID_KEY);
  if (direct) {
    return direct;
  }
  return null;
}

export function persistPanelGridState(state: PanelGridState): void {
  provider?.setPanelGridState(state);
  writeToStorage(PANEL_GRID_KEY, state);
}

export function loadCodeState(): CodeStateSnapshot | null {
  const provided = provider?.getCodeState();
  if (provided) {
    return provided;
  }
  return readFromStorage<CodeStateSnapshot>(CODE_STATE_KEY);
}

export function persistCodeState(state: CodeStateSnapshot): void {
  provider?.setCodeState(state);
  writeToStorage(CODE_STATE_KEY, state);
}

function readFromStorage<T>(key: string): T | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeToStorage(key: string, value: unknown): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best effort
  }
}

function sanitizeLayoutSnapshot(snapshot: LayoutSnapshot): LayoutSnapshot {
  const filteredTabs = snapshot.tabs.filter((tab) => tab.toolType !== "settings-panel");
  const activeToolId = filteredTabs.some((tab) => tab.id === snapshot.activeToolId)
    ? snapshot.activeToolId
    : filteredTabs[0]?.id;
  return { tabs: filteredTabs, activeToolId };
}

function sanitizePanelLayouts(layouts: Record<string, LayoutSnapshot>): Record<string, LayoutSnapshot> {
  return Object.fromEntries(
    Object.entries(layouts).map(([panelId, snapshot]) => [panelId, sanitizeLayoutSnapshot(snapshot)])
  );
}
