import type { PanelId } from "../layout/panelRegistry";
import type { PanelNode } from "../panels/panelTree";
import { loadPanelGridState as loadSessionPanelGridState, persistPanelGridState } from "../session/sessionStorage";

export interface PanelGridState {
  ratios: Record<string, number>;
  collapsed: Record<string, boolean>;
  lastRatios: Record<string, number>;
  undocked: Record<string, boolean>;
  floatingPositions: Record<string, { left: number; top: number } | null>;
  splitTree?: PanelNode;
}

export function loadPanelGridState(): PanelGridState | null {
  return loadSessionPanelGridState();
}

export function savePanelGridState(state: PanelGridState): void {
  persistPanelGridState(state);
}
