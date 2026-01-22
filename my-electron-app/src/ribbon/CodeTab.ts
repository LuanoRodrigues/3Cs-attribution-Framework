import type { RibbonTab } from "../types";

export const CodeTab: RibbonTab = {
  phase: "code",
  label: "Code",
  description: "Create, apply, and batch-automate coding.",
  actions: [
    {
      id: "code-add",
      label: "Add Code",
      hint: "Create a new code and attach it to the current context.",
      iconId: "code-add",
      group: "Coding",
      command: { phase: "code", action: "add_code" }
    },
    {
      id: "code-apply-manual",
      label: "Apply Code",
      hint: "Manually apply codes to selected excerpts.",
      iconId: "code-apply",
      group: "Coding",
      command: { phase: "code", action: "apply_code_manual" }
    },
    {
      id: "code-auto",
      label: "Auto-code",
      hint: "Run a batch auto-coding job across the active corpus.",
      iconId: "code-auto",
      group: "Coding",
      command: { phase: "code", action: "auto_code" }
    }
  ]
};
