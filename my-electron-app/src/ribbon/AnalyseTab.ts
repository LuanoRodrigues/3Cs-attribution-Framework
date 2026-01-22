import type { RibbonTab } from "../types";

export const AnalyseTab: RibbonTab = {
  phase: "analyse",
  label: "Analyse",
  description: "Load corpus data and surface round-specific sections.",
  actions: [
    {
      id: "analyse-dashboard",
      label: "Dashboard",
      hint: "Review run summaries and set the active run.",
      iconId: "analyse-dashboard",
      group: "Data",
      command: { phase: "analyse", action: "analyse/open_dashboard" }
    },
    {
      id: "analyse-corpus",
      label: "Corpus",
      hint: "Open the corpus workspace with filters and batch cards.",
      iconId: "analyse-corpus",
      group: "Data",
      command: { phase: "analyse", action: "analyse/open_phases" }
    },
    {
      id: "analyse-round-1",
      label: "Round 1",
      hint: "View Round 1 sections alongside filters.",
      iconId: "analyse-round",
      group: "Rounds",
      command: { phase: "analyse", action: "analyse/open_sections_r1" }
    },
    {
      id: "analyse-round-2",
      label: "Round 2",
      hint: "View Round 2 sections alongside filters.",
      iconId: "analyse-round",
      group: "Rounds",
      command: { phase: "analyse", action: "analyse/open_sections_r2" }
    },
    {
      id: "analyse-round-3",
      label: "Round 3",
      hint: "View Round 3 sections alongside filters.",
      iconId: "analyse-round",
      group: "Rounds",
      command: { phase: "analyse", action: "analyse/open_sections_r3" }
    }
  ]
};
