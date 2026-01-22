import { tinykeys } from "tinykeys";
import { dispatchCommand } from "../api/editor_commands.js";
import type { EditorHandle } from "../api/leditor.js";
import { getOrientation } from "./layout_settings.js";

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
      return true;
    }
  });
  return () => handler();
};
