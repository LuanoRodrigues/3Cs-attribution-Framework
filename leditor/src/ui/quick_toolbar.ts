import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { EditorHandle } from "../api/leditor.js";

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

type PhaseFlags = {
  shown: boolean;
  boldUsed: boolean;
  hidden: boolean;
  logged: boolean;
};

const flags: PhaseFlags = {
  shown: false,
  boldUsed: false,
  hidden: false,
  logged: false
};

const maybeLogPhase = () => {
  if (flags.logged) return;
  if (flags.shown && flags.boldUsed && flags.hidden) {
    window.codexLog?.write("[PHASE17_OK]");
    flags.logged = true;
  }
};

const createButton = (label: string, command: string, controller: QuickToolbarController) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = "tb-btn tb-btn--quiet";
  button.setAttribute("aria-label", command);
  const shortcutHints: Record<string, string> = {
    Bold: "Ctrl+B",
    Italic: "Ctrl+I",
    Link: "Ctrl+K"
  };
  const shortcut = shortcutHints[command];
  button.setAttribute("data-tooltip", shortcut ? `${command} (${shortcut})` : command);
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", () => {
    controller.emitCommand(command);
  });
  return button;
};

type QuickToolbarController = {
  emitCommand: (command: string) => void;
};

export const createQuickToolbar = (editorHandle: EditorHandle, editor: Editor) => {

  const toolbar = document.createElement("div");
  toolbar.className = "leditor-quick-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Quick toolbar");

  const controller = {
    emitCommand(command: string) {
      editorHandle.execCommand(command);
      editorHandle.focus();
      if (command === "Bold") {
        flags.boldUsed = true;
        maybeLogPhase();
      }
    }
  };

  toolbar.appendChild(createButton("B", "Bold", controller));
  toolbar.appendChild(createButton("I", "Italic", controller));
  toolbar.appendChild(createButton("Link", "Link", controller));
  toolbar.appendChild(createButton("Clear", "ClearFormatting", controller));
  toolbar.appendChild(createButton("Footnotes", "FootnotePanel", controller));
  document.body.appendChild(toolbar);

  let rafId: number | null = null;
  let visible = false;

  const updatePosition = () => {
    if (!visible) return;
    if (!(editor.state.selection instanceof TextSelection)) return;
    const { selection } = editor.state;
    if (selection.empty) return;
    const start = editor.view.coordsAtPos(selection.from);
    const end = editor.view.coordsAtPos(selection.to);
    const width = toolbar.offsetWidth;
    const left = Math.min(
      Math.max((start.left + end.right) / 2 - width / 2, 8),
      window.innerWidth - width - 8
    );
    const top = Math.max(Math.min(start.top, end.top) - toolbar.offsetHeight - 8, 8);
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  };

  const schedulePosition = () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
    }
    rafId = window.requestAnimationFrame(() => {
      updatePosition();
      rafId = null;
    });
  };

  const show = () => {
    if (visible) {
      schedulePosition();
      return;
    }
    visible = true;
    toolbar.style.display = "flex";
    flags.shown = true;
    maybeLogPhase();
    schedulePosition();
  };

  const hide = (dueToCollapse = false) => {
    if (!visible) return;
    visible = false;
    toolbar.style.display = "none";
    if (dueToCollapse) {
      flags.hidden = true;
      maybeLogPhase();
    }
  };

  const updateVisibility = () => {
    const selection = editor.state.selection;
    if (selection instanceof NodeSelection) {
      hide();
      return;
    }
    if (!(selection instanceof TextSelection)) {
      hide();
      return;
    }
    if (selection.empty) {
      hide(true);
      return;
    }
    show();
  };

  const onScrollOrResize = () => {
    if (visible) schedulePosition();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      hide();
    }
  };

  const onBlur = () => {
    hide();
  };

  editor.on("selectionUpdate", updateVisibility);
  editor.on("blur", onBlur);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);
  document.addEventListener("keydown", onKeyDown);

  return {
    destroy() {
      editor.off("selectionUpdate", updateVisibility);
      editor.off("blur", onBlur);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("keydown", onKeyDown);
      toolbar.remove();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    }
  };
};
