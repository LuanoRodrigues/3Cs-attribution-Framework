import type { RibbonTab } from "../types";
export const ToolsTab: RibbonTab = {
  phase: "tools",
  label: "Tools",
  description: "Accessory utilities (PDF/Coder test fixtures) plus anything that lands in panel shells.",
  actions: [
    {
      id: "test-pdf",
      label: "PDF",
      hint: "Open the PDF viewer in Panel 3 (drag the tab to move it).",
      iconId: "test-pdf",
      group: "Tools",
      command: { phase: "tools", action: "open_tool", payload: { toolType: "pdf", panelId: "panel3" } }
    },
    {
      id: "test-coder",
      label: "Coder",
      hint: "Open the coder workspace in Panel 4 (drag the tab to move it).",
      iconId: "test-coder",
      group: "Tools",
      command: { phase: "tools", action: "open_tool", payload: { toolType: "coder-panel", panelId: "panel4" } }
    }
  ]
};
