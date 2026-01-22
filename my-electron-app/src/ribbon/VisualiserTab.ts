import type { RibbonTab } from "../types";

export const VisualiserTab: RibbonTab = {
  phase: "visualiser",
  label: "Visualise",
  description: "Explore exported sections, thumbnails, and exports between Code and Analyse.",
  actions: [
    {
      id: "visualiser-run-inputs",
      label: "Run Inputs",
      hint: "Rebuild the preview with the current inputs.",
      iconId: "visualiser-input",
      group: "Inputs",
      command: { phase: "visualiser", action: "run_inputs" }
    },
    {
      id: "visualiser-refresh-thumbs",
      label: "Refresh Preview",
      hint: "Re-render thumbnails and slide counts.",
      iconId: "visualiser-refresh",
      group: "Inputs",
      command: { phase: "visualiser", action: "refresh_preview" }
    },
    {
      id: "visualiser-build",
      label: "Build Slides",
      hint: "Trigger the export build flow.",
      iconId: "visualiser-build",
      group: "Actions",
      command: { phase: "visualiser", action: "build_deck" }
    },
    {
      id: "visualiser-diag",
      label: "Diag",
      hint: "Log the current Plotly status.",
      iconId: "visualiser-diag",
      group: "Actions",
      command: { phase: "visualiser", action: "diag_status" }
    },
    {
      id: "visualiser-copy-status",
      label: "Copy Status",
      hint: "Copy the export status log.",
      iconId: "visualiser-copy",
      group: "Export",
      command: { phase: "visualiser", action: "copy_status" }
    },
    {
      id: "visualiser-clear-status",
      label: "Clear Status",
      hint: "Clear the export log history.",
      iconId: "visualiser-clear",
      group: "Export",
      command: { phase: "visualiser", action: "clear_status" }
    }
  ]
};
