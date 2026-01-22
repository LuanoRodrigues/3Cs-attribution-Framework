import type { RibbonTab } from "../types";

export const ScreenTab: RibbonTab = {
  phase: "screen",
  label: "Screen",
  description: "Quickly triage candidate studies and log screening notes.",
  actions: [
    {
      id: "screen-exclude-item",
      label: "Exclude Item",
      hint: "Mark the active result as excluded.",
      iconId: "screen-exclude",
      group: "Navigation",
      command: { phase: "screen", action: "exclude_item" }
    },
    {
      id: "screen-tag-include",
      label: "Tag for Inclusion",
      hint: "Tag the record so it remains in scope.",
      iconId: "screen-include",
      group: "Navigation",
      command: { phase: "screen", action: "tag_for_inclusion" }
    },
    {
      id: "screen-note",
      label: "Write Screening Note",
      hint: "Add a short note explaining the decision.",
      iconId: "screen-note",
      group: "Notes",
      command: { phase: "screen", action: "write_screening_note" }
    },
    {
      id: "screen-settings",
      label: "Settings",
      hint: "Open screening settings",
      iconId: "settings",
      group: "Settings",
      command: { phase: "screen", action: "open_settings" },
      opensPanel: true,
      panel: {
        title: "Screen settings",
        description: "Adjust screening behaviour."
      }
    }
  ]
};
