import { createAnalyseState } from "../analyse/types";
import { DEFAULT_PANEL_PARTS, type PanelId } from "../layout/panelRegistry";
import type { PanelGridState } from "../state/panelGrid";
import { createDefaultCodeState } from "../state/codeState";
import type { SessionData } from "./sessionTypes";
import type { TabId } from "../layout/TabRibbon";

function createBooleanRecord(value: boolean): Record<PanelId, boolean> {
  const record: Record<PanelId, boolean> = {
    panel1: value,
    panel2: value,
    panel3: value,
    panel4: value
  };
  return record;
}

function createFloatingPositions(): Record<PanelId, { left: number; top: number } | null> {
  const positions: Record<PanelId, { left: number; top: number } | null> = {
    panel1: null,
    panel2: null,
    panel3: null,
    panel4: null
  };
  return positions;
}

function createDefaultPanelGridState(): PanelGridState {
  return {
    ratios: { ...DEFAULT_PANEL_PARTS },
    collapsed: createBooleanRecord(false),
    lastRatios: { ...DEFAULT_PANEL_PARTS },
    undocked: createBooleanRecord(false),
    floatingPositions: createFloatingPositions()
  };
}

const DEFAULT_RIBBON_TAB: TabId = "export";
const EMPTY_LAYOUT: { tabs: []; activeToolId: undefined } = { tabs: [], activeToolId: undefined };

export function createEmptySessionData(projectName: string, projectId: string): SessionData {
  const now = new Date().toISOString();
  return {
    projectId,
    projectName,
    createdAt: now,
    updatedAt: now,
    layout: { tabs: [], activeToolId: undefined },
    panelLayouts: {
      panel1: { ...EMPTY_LAYOUT },
      panel2: { ...EMPTY_LAYOUT },
      panel3: { ...EMPTY_LAYOUT },
      panel4: { ...EMPTY_LAYOUT }
    },
    panelGrid: createDefaultPanelGridState(),
    code: createDefaultCodeState(),
    analyse: createAnalyseState(),
    activeRibbonTab: DEFAULT_RIBBON_TAB,
    assets: {},
    retrieve: {}
  };
}
