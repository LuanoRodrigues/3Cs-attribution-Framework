import { tinykeys } from "tinykeys";
import { dispatchCommand } from "../api/editor_commands.ts";
import type { EditorHandle } from "../api/leditor.ts";
import { getOrientation } from "../ui/layout_settings.ts";

export const initGlobalShortcuts = (editorHandle: EditorHandle): (() => void) => {
  const handler = tinykeys(window, {
    "mod+b": () => {
      dispatchCommand(editorHandle, "Bold");
      return true;
    },
    "mod+i": () => {
      dispatchCommand(editorHandle, "Italic");
      return true;
    },
    "mod+u": () => {
      dispatchCommand(editorHandle, "Underline");
      return true;
    },
    "mod+shift+s": () => {
      dispatchCommand(editorHandle, "ExportDOCX");
      return true;
    },
    "mod+shift+p": () => {
      dispatchCommand(editorHandle, "SetPrintLayout");
      return true;
    },
    "mod+p": () => {
      dispatchCommand(editorHandle, "Preview");
      return true;
    },
    "mod+shift+f": () => {
      dispatchCommand(editorHandle, "FootnotePanel");
      return true;
    },
    "mod+f": () => {
      dispatchCommand(editorHandle, "SearchReplace");
      return true;
    },
    "mod+shift+o": () => {
      const next = getOrientation() === "portrait" ? "landscape" : "portrait";
      dispatchCommand(editorHandle, "SetPageOrientation", { orientation: next });
      return true;
    },
    "ctrl+shift+r": () => {
      window.__logCoderNode?.();
      const controls = Array.from(document.querySelectorAll<HTMLElement>(".leditor-ribbon [data-control-id]"));
      const supported = new Set([
        "button",
        "toggleButton",
        "splitButton",
        "splitToggleButton",
        "colorSplitButton",
        "dropdown",
        "colorPicker",
        "dialogLauncher"
      ]);
      const emptyControls = controls
        .filter((el) => {
          const type = el.dataset.controlType;
          return type && supported.has(type);
        })
        .map((el) => {
          const icon = el.querySelector(".leditor-ribbon-icon");
          const hasIcon = icon && !icon.classList.contains("leditor-ribbon-icon-placeholder");
          return { controlId: el.dataset.controlId ?? "", controlType: el.dataset.controlType ?? "", hasIcon };
        })
        .filter((entry) => !entry.hasIcon);
      if (emptyControls.length) {
        console.info("[Ribbon] Controls missing icons:", emptyControls.map((entry) => entry.controlId));
        console.table(emptyControls);
      } else {
        console.info("[Ribbon] All icon-capable controls have icons.");
      }
      return true;
    }
  });
  return () => handler();
};
