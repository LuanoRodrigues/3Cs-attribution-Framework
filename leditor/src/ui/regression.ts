import type { EditorHandle } from "../api/leditor.ts";
import { collectNestedControls, loadRibbonModel } from "./ribbon_config.ts";

const safeExec = (handle: EditorHandle, command: string, args?: any) => {
  try {
    handle.execCommand(command, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    throw new Error(`Regression command "${command}" failed: ${message}`);
  }
};

export const runRegressionRoutine = (editorHandle: EditorHandle) => {
  editorHandle.setContent("<p>Phase 30 regression test</p>", { format: "html" });
  editorHandle.focus();
  safeExec(editorHandle, "Bold");
  safeExec(editorHandle, "InsertPageBreak");
  safeExec(editorHandle, "InsertFootnote");
  safeExec(editorHandle, "InsertMergeTag", { key: "REG" });
  safeExec(editorHandle, "TableInsert", { rows: 2, cols: 2 });
  safeExec(editorHandle, "TableAddRowBelow");
  safeExec(editorHandle, "TableAddColumnRight");
  safeExec(editorHandle, "TableMergeCells");
  safeExec(editorHandle, "TableSplitCell");
  safeExec(editorHandle, "InsertTemplate", { id: "conference_note" });
  safeExec(editorHandle, "Undo");
  safeExec(editorHandle, "Redo");
  safeExec(editorHandle, "ClearFormatting");
  return editorHandle.getJSON();
};

export const runUiSmokeChecks = (): void => {
  try {
    const model = loadRibbonModel();
    const menuItems: any[] = [];
    model.orderedTabs.forEach((tab) => {
      tab.groups.forEach((group) => {
        group.clusters.forEach((cluster) => {
          cluster.controls.forEach((control) => {
            if (control.type === "menuItem") menuItems.push(control);
            collectNestedControls(control).forEach((nested) => {
              if (nested.type === "menuItem") menuItems.push(nested);
            });
          });
        });
      });
    });
    const missingDescriptions = menuItems.filter((item) => !item.description);
    const missingShortcuts = menuItems.filter((item) => !item.shortcut);
    console.info("[Regression] ribbon menu items", {
      total: menuItems.length,
      missingDescriptions: missingDescriptions.length,
      missingShortcuts: missingShortcuts.length
    });
  } catch (error) {
    console.warn("[Regression] ribbon smoke check failed", error);
  }
};
