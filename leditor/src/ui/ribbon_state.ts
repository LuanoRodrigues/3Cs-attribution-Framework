import type { Editor } from "@tiptap/core";
import type { EditorHandle } from "../api/leditor.ts";
import { dispatchCommand, type EditorCommandId } from "../api/editor_commands.ts";
import { loadRibbonRegistry } from "./ribbon_config.ts";
import { getSelectionAlignment, getSelectionBlockDescriptor } from "./ribbon_selection_helpers.ts";
import { getLayoutController } from "./layout_context.ts";
import { isFullscreenActive } from "./fullscreen.ts";
import {
  getPaginationMode,
  isPageBoundariesVisible,
  isPageBreakMarksVisible,
  isRulerVisible
} from "./view_state.ts";
import { isVisualBlocksEnabled } from "../editor/visual.ts";

const STATE_CONTRACT = (loadRibbonRegistry().stateContract ?? {}) as Record<string, string>;
export type RibbonStateContract = typeof STATE_CONTRACT;
export type RibbonStateKey = keyof RibbonStateContract;

export type RibbonStateSnapshot = Partial<Record<RibbonStateKey, unknown>>;
export type RibbonStateListener = (state: RibbonStateSnapshot) => void;

const STATE_KEYS = Object.keys(STATE_CONTRACT) as RibbonStateKey[];

export const readBinding = (snapshot: RibbonStateSnapshot, bindingKey: RibbonStateKey): unknown => {
  return snapshot[bindingKey];
};

export const isMixed = (value: unknown): boolean => {
  if (value === "mixed") return true;
  if (value && typeof value === "object") {
    return (value as Record<string, unknown>).mixed === true;
  }
  return false;
};

const readMarkAttribute = (editor: Editor, mark: string, attribute: string): unknown => {
  const attrs = editor.getAttributes(mark);
  if (attrs && typeof attrs === "object" && attribute in attrs) {
    return (attrs as Record<string, unknown>)[attribute];
  }
  return null;
};

const getListCoverage = (editor: Editor): string => {
  if (editor.isActive("taskList")) return "task";
  if (editor.isActive("orderedList")) return "numbered";
  if (editor.isActive("bulletList")) return "bulleted";
  return "none";
};

const stateSelectors: Partial<
  Record<RibbonStateKey, (editor: Editor, snapshot: RibbonStateSnapshot) => unknown>
> = {
  canUndo: (editor) => Boolean(editor.can().undo()),
  canRedo: (editor) => Boolean(editor.can().redo()),
  bold: (editor) => editor.isActive("bold"),
  italic: (editor) => editor.isActive("italic"),
  underline: (editor) => editor.isActive("underline"),
  strikethrough: (editor) => editor.isActive("strikethrough"),
  subscript: (editor) => editor.isActive("subscript"),
  superscript: (editor) => editor.isActive("superscript"),
  inlineCode: (editor) => editor.isActive("code"),
  listType: (editor) => getListCoverage(editor),
  alignment: (editor) => getSelectionAlignment(editor),
  fontFamily: (editor) => readMarkAttribute(editor, "fontFamily", "fontFamily"),
  fontSize: (editor) => {
    const value = readMarkAttribute(editor, "fontSize", "fontSize");
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.length > 0) {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return null;
  },
  fontColor: (editor) => readMarkAttribute(editor, "textColor", "color"),
  highlightColor: (editor) => readMarkAttribute(editor, "highlightColor", "highlight"),
  lineSpacing: (editor) => {
    const block = getSelectionBlockDescriptor(editor);
    return block?.attrs?.lineHeight ?? null;
  },
  selectionContext: (editor) => ({
    hasSelection: !editor.state.selection.empty,
    isRange: editor.state.selection.empty === false
  }),
  linkActive: (editor) => editor.isActive("link"),
  canInsert: (editor) => editor.isEditable,
  canComment: (editor) => editor.isEditable,
  availableStyles: () => [],
  activeStyle: () => null,
  styleSet: () => null,
  blockquote: (editor) => editor.isActive("blockquote"),
  showFormattingMarks: () => isVisualBlocksEnabled(),
  pageBoundaries: () => isPageBoundariesVisible(),
  pageBreakMarks: () => isPageBreakMarksVisible(),
  ruler: () => isRulerVisible(),
  fullscreen: () => isFullscreenActive(),
  paginationMode: () => getPaginationMode(),
  zoomLevel: () => {
    const layout = getLayoutController();
    return layout?.getZoom() ?? 1;
  },
  pageCount: () => {
    const layout = getLayoutController();
    return layout?.getPageCount?.() ?? 1;
  },
  autoLink: () => false,
  tableDrawMode: () => false,
  responsiveTableDefault: () => false,
  textBoxDrawMode: () => false,
  formatPainter: () => false,
  pasteAutoClean: () => false,
  findRegex: () => false,
  findMatchCase: () => false,
  findWholeWords: () => false,
  borders: () => null,
  shading: () => null,
  citationStyle: (editor) => {
    const styleId = editor.state.doc.attrs?.citationStyleId;
    if (typeof styleId === "string") return styleId;
    return null;
  }
};

export class RibbonStateBus {
  private state: RibbonStateSnapshot = {};
  private listeners = new Set<RibbonStateListener>();
  private pendingUpdate: number | NodeJS.Timeout | null = null;

  private readonly handleSelectionChange = (): void => {
    this.scheduleUpdate();
  };

  constructor(public readonly editorHandle: EditorHandle) {
    this.updateState();
    this.editorHandle.on("selectionChange", this.handleSelectionChange);
    this.editorHandle.on("change", this.handleSelectionChange);
  }

  dispatch(commandId: EditorCommandId, payload?: unknown): void {
    dispatchCommand(this.editorHandle, commandId, payload);
    this.scheduleUpdate();
  }

  getState(): RibbonStateSnapshot {
    return { ...this.state };
  }

  subscribe(listener: RibbonStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleUpdate(): void {
    if (this.pendingUpdate !== null) return;
    const callback = () => {
      this.pendingUpdate = null;
      this.updateState();
    };
    if (typeof window !== "undefined") {
      this.pendingUpdate = window.setTimeout(callback, 32);
    } else {
      this.pendingUpdate = setTimeout(callback, 0);
    }
  }

  private updateState(): void {
    const editor = this.editorHandle.getEditor();
    const nextState: RibbonStateSnapshot = {};
    for (const key of STATE_KEYS) {
      const selector = stateSelectors[key];
      if (!selector) {
        continue;
      }
      nextState[key] = selector(editor, this.state);
    }
    if (this.hasStateChanged(nextState)) {
      this.state = { ...this.state, ...nextState };
      const snapshot = this.getState();
      this.listeners.forEach((listener) => listener(snapshot));
    } else {
      this.state = { ...this.state, ...nextState };
    }
  }

  private hasStateChanged(next: RibbonStateSnapshot): boolean {
    const keys = new Set([...Object.keys(this.state), ...Object.keys(next)]);
    for (const key of keys) {
      const typedKey = key as RibbonStateKey;
      if (this.state[typedKey] !== next[typedKey]) {
        return true;
      }
    }
    return false;
  }
}
