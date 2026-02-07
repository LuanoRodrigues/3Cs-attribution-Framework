import type { PanelId } from "./panelRegistry";
import type { PanelGridPresetId } from "./PanelGrid";

export type RouteId =
  | "analyse:dashboard"
  | "analyse:corpus"
  | "analyse:r1"
  | "analyse:r2"
  | "analyse:r3"
  | "analyse:phases"
  | "retrieve:datahub"
  | "retrieve:search"
  | "retrieve:search-selected"
  | "retrieve:graph"
  | "screen:main"
  | "visualiser:main"
  | "write:main"
  | "code:main";

export type RouteDefinition = {
  id: RouteId;
  presetId: PanelGridPresetId;
  // Tools that are allowed to remain in each panel when this route is active.
  // Anything else should be closed so only the last-clicked route's widgets are present.
  allowedToolTypesByPanel: Partial<Record<PanelId, string[]>>;
  // Tools that should exist after applying the route.
  ensureTools?: Array<{ toolType: string; panelId: PanelId; focus?: boolean; metadata?: Record<string, unknown> }>;
};

export const ROUTES: Record<RouteId, RouteDefinition> = {
  "analyse:dashboard": {
    id: "analyse:dashboard",
    presetId: "analyse:dashboard",
    allowedToolTypesByPanel: {
      panel1: [],
      panel2: [],
      panel3: [],
      panel4: []
    }
  },
  "analyse:corpus": {
    id: "analyse:corpus",
    presetId: "analyse:corpus",
    allowedToolTypesByPanel: { panel4: [] }
  },
  "analyse:r1": {
    id: "analyse:r1",
    presetId: "analyse:r1",
    allowedToolTypesByPanel: { panel4: [] }
  },
  "analyse:r2": {
    id: "analyse:r2",
    presetId: "analyse:r2",
    allowedToolTypesByPanel: { panel4: ["coder-panel", "analyse-pdf-tabs"] },
    ensureTools: [{ toolType: "coder-panel", panelId: "panel4" }]
  },
  "analyse:r3": {
    id: "analyse:r3",
    presetId: "analyse:r3",
    allowedToolTypesByPanel: { panel4: ["coder-panel", "analyse-pdf-tabs"] },
    ensureTools: [{ toolType: "coder-panel", panelId: "panel4" }]
  },
  "analyse:phases": {
    id: "analyse:phases",
    presetId: "analyse:phases",
    allowedToolTypesByPanel: { panel4: [] }
  },
  "retrieve:datahub": {
    id: "retrieve:datahub",
    presetId: "retrieve:datahub",
    allowedToolTypesByPanel: { panel2: ["retrieve-datahub"], panel4: [] },
    ensureTools: [{ toolType: "retrieve-datahub", panelId: "panel2", focus: true, metadata: { layoutPresetId: "retrieve:datahub" } }]
  },
  "retrieve:search": {
    id: "retrieve:search",
    presetId: "retrieve:search-empty",
    allowedToolTypesByPanel: { panel2: ["retrieve-search-app", "retrieve"], panel4: [] },
    ensureTools: [{ toolType: "retrieve-search-app", panelId: "panel2", focus: true, metadata: { layoutPresetId: "retrieve:search-empty" } }]
  },
  "retrieve:search-selected": {
    id: "retrieve:search-selected",
    presetId: "retrieve:search-selected",
    allowedToolTypesByPanel: { panel2: ["retrieve-search-app", "retrieve"], panel4: ["retrieve-search-meta"] },
    ensureTools: [
      { toolType: "retrieve-search-app", panelId: "panel2", metadata: { layoutPresetId: "retrieve:search-selected" } },
      { toolType: "retrieve-search-meta", panelId: "panel4", focus: true, metadata: { layoutPresetId: "retrieve:search-selected" } }
    ]
  },
  "retrieve:graph": {
    id: "retrieve:graph",
    presetId: "retrieve:search-graph",
    allowedToolTypesByPanel: { panel2: ["retrieve-search-app", "retrieve"], panel3: ["retrieve-citation-graph"], panel4: [] },
    ensureTools: [
      { toolType: "retrieve-search-app", panelId: "panel2", metadata: { layoutPresetId: "retrieve:search-graph" } }
    ]
  },
  "screen:main": {
    id: "screen:main",
    presetId: "screen:main",
    allowedToolTypesByPanel: { panel2: ["screen"], panel3: ["screen-pdf-viewer"] },
    ensureTools: [
      { toolType: "screen", panelId: "panel2", focus: true, metadata: { layoutPresetId: "screen:main" } },
      { toolType: "screen-pdf-viewer", panelId: "panel3", metadata: { layoutPresetId: "screen:main" } }
    ]
  },
  "visualiser:main": {
    id: "visualiser:main",
    presetId: "visualiser:main",
    allowedToolTypesByPanel: { panel2: ["visualiser"] },
    ensureTools: [{ toolType: "visualiser", panelId: "panel2", focus: true, metadata: { layoutPresetId: "visualiser:main" } }]
  },
  "write:main": {
    id: "write:main",
    presetId: "write:main",
    allowedToolTypesByPanel: { panel2: ["write-leditor"] },
    ensureTools: [{ toolType: "write-leditor", panelId: "panel2", focus: true, metadata: { layoutPresetId: "write:main" } }]
  },
  "code:main": {
    id: "code:main",
    presetId: "code:main",
    allowedToolTypesByPanel: { panel2: ["code-panel"] },
    ensureTools: [{ toolType: "code-panel", panelId: "panel2", focus: true, metadata: { layoutPresetId: "code:main" } }]
  }
};

