import { tinykeys } from "tinykeys";
import { dispatchCommand } from "../api/editor_commands.ts";
import type { EditorHandle } from "../api/leditor.ts";
import { getOrientation } from "../ui/layout_settings.ts";
import { toggleInsertMode } from "../editor/input_modes.ts";
import { openContextMenuAtSelection } from "./context_menu.ts";

export const initGlobalShortcuts = (editorHandle: EditorHandle): (() => void) => {
  const exec = (id: string, args?: unknown) => {
    try {
      editorHandle.execCommand(id, args as any);
    } catch (error) {
      console.warn(`[Shortcuts] command failed: ${id}`, error);
    }
  };
  const handler = tinykeys(window, {
    "mod+s": () => {
      dispatchCommand(editorHandle, "Save");
      return true;
    },
    "mod+shift+s": () => {
      dispatchCommand(editorHandle, "SaveAs");
      return true;
    },
    "mod+o": () => {
      dispatchCommand(editorHandle, "Open");
      return true;
    },
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
    "ctrl+pageup": () => {
      dispatchCommand(editorHandle, "EditHeader");
      return true;
    },
    "ctrl+pagedown": () => {
      dispatchCommand(editorHandle, "EditFooter");
      return true;
    },
    f5: () => {
      exec("Navigator");
      return true;
    },
    "shift+f5": () => {
      exec("GoToLastCursor");
      return true;
    },
    f7: () => {
      dispatchCommand(editorHandle, "Spelling");
      return true;
    },
    "ctrl+f7": () => {
      dispatchCommand(editorHandle, "Thesaurus");
      return true;
    },
    "ctrl+f2": () => {
      exec("InsertField");
      return true;
    },
    f9: () => {
      exec("UpdateFields");
      return true;
    },
    "ctrl+f9": () => {
      exec("ToggleFieldCodes");
      return true;
    },
    "ctrl+shift+f9": () => {
      exec("UpdateInputFields");
      return true;
    },
    f11: () => {
      exec("styles.pane.open");
      return true;
    },
    "shift+f11": () => {
      exec("styles.create.openDialog");
      return true;
    },
    "ctrl+shift+f11": () => {
      exec("styles.modify.openDialog");
      return true;
    },
    "ctrl+f8": () => {
      exec("FieldShadingToggle");
      return true;
    },
    "ctrl+f10": () => {
      dispatchCommand(editorHandle, "VisualChars");
      return true;
    },
    "ctrl+shift+f10": () => {
      exec("NavigatorDockToggle");
      return true;
    },
    "shift+f10": () => {
      const editor = editorHandle.getEditor();
      if (editor) {
        openContextMenuAtSelection(editor);
      }
      return true;
    },
    "shift+f4": () => {
      exec("DataSourceNavigator");
      return true;
    },
    "ctrl+shift+f4": () => {
      exec("DataSourceDetach");
      return true;
    },
    insert: () => {
      toggleInsertMode();
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
