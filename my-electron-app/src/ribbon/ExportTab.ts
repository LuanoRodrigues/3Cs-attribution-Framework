import type { RibbonTab } from "../types";

export const ExportTab: RibbonTab = {
  phase: "export",
  label: "File",
  description: "Share your project bundle or derive structured outputs.",
  actions: [
    {
      id: "export-word",
      label: "Export to Word",
      hint: "Generate a Word document from the current summary.",
      iconId: "export-word",
      group: "Export",
      command: { phase: "export", action: "export_word" }
    },
    {
      id: "export-json",
      label: "Export to JSON",
      hint: "Serialize the entire project into JSON.",
      iconId: "export-json",
      group: "Export",
      command: { phase: "export", action: "export_json" }
    },
    {
      id: "export-snapshot",
      label: "Save Project Snapshot",
      hint: "Persist the current workspace snapshot for later recall.",
      iconId: "export-snapshot",
      group: "Export",
      command: { phase: "export", action: "save_project_snapshot" }
    },
    {
      id: "project-export",
      label: "Export Project ZIP",
      hint: "Package the current project folder as a portable ZIP archive.",
      iconId: "export-zip",
      group: "Export",
      command: { phase: "project", action: "export_project" }
    }
  ]
};
