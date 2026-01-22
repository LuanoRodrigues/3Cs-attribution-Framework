export type PanelId = string;

export interface PanelDefinition {
  id: PanelId;
  index: number;
  title: string;
  variant: "half" | "main";
  position?: "left" | "right";
  anchorId?: string;
  defaultPart: number;
  minWidthPx: number;
}

export const PANEL_REGISTRY: PanelDefinition[] = [
  {
    id: "panel1",
    index: 1,
    title: "Panel 1",
    variant: "half",
    position: "left",
    anchorId: undefined,
    defaultPart: 1,
    minWidthPx: 120
  },
  {
    id: "panel2",
    index: 2,
    title: "Panel 2",
    variant: "main",
    position: undefined,
    anchorId: "panel-root",
    defaultPart: 3,
    minWidthPx: 220
  },
  {
    id: "panel3",
    index: 3,
    title: "Panel 3",
    variant: "main",
    position: undefined,
    anchorId: undefined,
    defaultPart: 2,
    minWidthPx: 200
  },
  {
    id: "panel4",
    index: 4,
    title: "Panel 4",
    variant: "half",
    position: "right",
    anchorId: undefined,
    defaultPart: 1,
    minWidthPx: 120
  }
];

export const DEFAULT_PANEL_PARTS: Record<string, number> = {
  panel1: 1,
  panel2: 3,
  panel3: 2,
  panel4: 1
};
