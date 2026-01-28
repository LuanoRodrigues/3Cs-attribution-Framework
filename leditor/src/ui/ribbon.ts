import type { EditorHandle } from "../api/leditor.ts";
import { dispatchCommand, type EditorCommandId } from "../api/editor_commands.ts";
import { loadRibbonModel } from "./ribbon_config.ts";
import { renderRibbonLayout } from "./ribbon_layout.ts";
import { RibbonStateBus } from "./ribbon_state.ts";
import {
  watchRibbonSelectionState,
  type RibbonSelectionTargets
} from "./ribbon_selection.ts";
import type { AlignmentVariant } from "./ribbon_selection_helpers.ts";

type RibbonHooks = {
  registerToggle?: (commandId: EditorCommandId, element: HTMLButtonElement) => void;
  registerAlignment?: (variant: AlignmentVariant, element: HTMLButtonElement) => void;
};

export const renderRibbon = (host: HTMLElement, editorHandle: EditorHandle): void => {
  if (host.dataset.ribbonRendered === "true") {
    console.warn("[Ribbon] renderRibbon called twice; skipping duplicate render.");
    return;
  }
  host.dataset.ribbonRendered = "true";

  const selectionTargets: RibbonSelectionTargets = {
    toggles: [],
    alignmentButtons: {}
  };

  const hooks: RibbonHooks = {
    registerToggle: (commandId, element) => {
      selectionTargets.toggles.push({ commandId, element });
    },
    registerAlignment: (variant, element) => {
      selectionTargets.alignmentButtons[variant] = element;
    }
  };

  const model = loadRibbonModel();
  const stateBus = new RibbonStateBus(editorHandle);

  renderRibbonLayout(host, editorHandle, hooks, stateBus, model);
  watchRibbonSelectionState(stateBus, selectionTargets);

  const handleFindShortcut = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "f") {
      event.preventDefault();
      dispatchCommand(editorHandle, "SearchReplace");
    }
  };
  document.addEventListener("keydown", handleFindShortcut);
};
