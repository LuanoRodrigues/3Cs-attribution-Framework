import type { PanelGridPreset } from "./PanelGrid";

// Deterministic panel presets (no cross-page carryover).
// Ratios are relative parts; collapsed panels should have 0 ratios.
export const PANEL_PRESETS: Record<string, PanelGridPreset> = {
  "analyse:dashboard": {
    id: "analyse:dashboard",
    roundLayout: false,
    layoutHint: { mode: "centeredSingle", panelId: "panel2", maxWidthPx: 1400 },
    collapsed: { panel1: true, panel2: false, panel3: true, panel4: true },
    ratios: { panel1: 0, panel2: 6, panel3: 0, panel4: 0 }
  },
  "analyse:corpus": {
    id: "analyse:corpus",
    roundLayout: false,
    layoutHint: { mode: "centeredGrid", maxWidthFrac: 5 / 6 },
    collapsed: { panel1: false, panel2: false, panel3: true, panel4: true },
    ratios: { panel1: 2, panel2: 3, panel3: 0, panel4: 0 }
  },
  "analyse:r1": {
    id: "analyse:r1",
    roundLayout: false,
    layoutHint: { mode: "centeredGrid", maxWidthFrac: 5 / 6 },
    collapsed: { panel1: false, panel2: false, panel3: true, panel4: true },
    ratios: { panel1: 2, panel2: 3, panel3: 0, panel4: 0 }
  },
  "analyse:phases": {
    id: "analyse:phases",
    roundLayout: false,
    layoutHint: { mode: "centeredGrid", maxWidthFrac: 5 / 6 },
    collapsed: { panel1: false, panel2: false, panel3: true, panel4: true },
    ratios: { panel1: 2, panel2: 3, panel3: 0, panel4: 0 }
  },
  "analyse:r2": {
    id: "analyse:r2",
    roundLayout: true,
    layoutHint: null,
    collapsed: { panel1: false, panel2: false, panel3: false, panel4: false },
    ratios: { panel1: 1, panel2: 1, panel3: 2, panel4: 2 },
    fixedPanelSizes: { panel1: 320, panel2: 420 }
  },
  "analyse:r3": {
    id: "analyse:r3",
    roundLayout: true,
    layoutHint: null,
    collapsed: { panel1: false, panel2: false, panel3: false, panel4: false },
    ratios: { panel1: 1, panel2: 1, panel3: 2, panel4: 2 },
    fixedPanelSizes: { panel1: 320, panel2: 420 }
  },
  "write:main": {
    id: "write:main",
    roundLayout: false,
    layoutHint: null,
    collapsed: { panel1: true, panel2: false, panel3: true, panel4: true },
    ratios: { panel1: 0, panel2: 6, panel3: 0, panel4: 0 }
  },
  "code:main": {
    id: "code:main",
    roundLayout: false,
    layoutHint: { mode: "centeredSingle", panelId: "panel2", maxWidthPx: 1100 },
    collapsed: { panel1: true, panel2: false, panel3: true, panel4: true },
    ratios: { panel1: 0, panel2: 3, panel3: 0, panel4: 0 }
  },
  "screen:main": {
    id: "screen:main",
    roundLayout: false,
    layoutHint: null,
    collapsed: { panel1: true, panel2: false, panel3: false, panel4: true },
    ratios: { panel1: 0, panel2: 3, panel3: 3, panel4: 0 }
  },
  "retrieve:datahub": {
    id: "retrieve:datahub",
    roundLayout: false,
    layoutHint: { mode: "centeredSingle", panelId: "panel2", maxWidthPx: 1400 },
    collapsed: { panel1: true, panel2: false, panel3: true, panel4: true },
    ratios: { panel1: 0, panel2: 3, panel3: 0, panel4: 0 }
  },
  "retrieve:search-empty": {
    id: "retrieve:search-empty",
    roundLayout: false,
    layoutHint: null,
    collapsed: { panel1: true, panel2: false, panel3: true, panel4: true },
    ratios: { panel1: 0, panel2: 6, panel3: 0, panel4: 0 }
  },
  "retrieve:search-selected": {
    id: "retrieve:search-selected",
    roundLayout: false,
    layoutHint: null,
    collapsed: { panel1: true, panel2: false, panel3: true, panel4: false },
    ratios: { panel1: 0, panel2: 6, panel3: 0, panel4: 1 }
  },
  "retrieve:search-graph": {
    id: "retrieve:search-graph",
    roundLayout: false,
    layoutHint: null,
    collapsed: { panel1: true, panel2: false, panel3: false, panel4: true },
    ratios: { panel1: 0, panel2: 3, panel3: 3, panel4: 0 }
  },
  "visualiser:main": {
    id: "visualiser:main",
    roundLayout: false,
    layoutHint: null,
    collapsed: { panel1: false, panel2: false, panel3: false, panel4: true },
    ratios: { panel1: 1, panel2: 4, panel3: 1, panel4: 0 }
  }
};
