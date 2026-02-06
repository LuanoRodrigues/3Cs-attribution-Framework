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
  isRulerVisible,
  isGridlinesVisible,
  isNavigationVisible,
  isReadMode
} from "./view_state.ts";
import { isVisualBlocksEnabled } from "../editor/visual.ts";
import { isSourceChecksVisible, subscribeSourceChecksThread } from "./source_checks_thread.ts";
import { ribbonTraceCall } from "./ribbon_debugger.ts";
import { parseSectionMeta } from "../editor/section_state.ts";

const STATE_CONTRACT = (loadRibbonRegistry().stateContract ?? {}) as Record<string, string>;
export type RibbonStateContract = typeof STATE_CONTRACT;
export type RibbonStateKey = keyof RibbonStateContract;

export type RibbonStateSnapshot = Partial<Record<RibbonStateKey, unknown>>;
export type RibbonStateListener = (state: RibbonStateSnapshot) => void;

const STATE_KEYS = Object.keys(STATE_CONTRACT) as RibbonStateKey[];

const PREF_AUTO_LINK = "leditor.autoLink";
const PREF_PASTE_AUTO_CLEAN = "leditor.pasteAutoClean";
const PREF_EVENT_NAME = "leditor:ribbon-preferences";

const readBoolPref = (key: string, fallback = false): boolean => {
  try {
    const raw = window.localStorage?.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw.toLowerCase() === "true";
  } catch {
    return fallback;
  }
};

let trackChangesActive = false;
if (typeof window !== "undefined") {
  window.addEventListener("leditor:track-changes", (event) => {
    const detail = (event as CustomEvent).detail as { active?: boolean } | undefined;
    trackChangesActive = Boolean(detail?.active);
  });
}

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
  textShadow: (editor) => editor.isActive("textShadow"),
  textOutline: (editor) => editor.isActive("textOutline"),
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
  activeStyle: (editor) => {
    if (editor.isActive("blockquote")) return "font.style.blockquote";
    for (let level = 1; level <= 6; level += 1) {
      if (editor.isActive("heading", { level })) {
        return `font.style.heading${level}`;
      }
    }
    return "font.style.normal";
  },
  styleSet: () => null,
  blockquote: (editor) => editor.isActive("blockquote"),
  showFormattingMarks: () => isVisualBlocksEnabled(),
  pageBoundaries: () => isPageBoundariesVisible(),
  pageBreakMarks: () => isPageBreakMarksVisible(),
  ruler: () => isRulerVisible(),
  gridlines: () => isGridlinesVisible(),
  navigationPane: () => isNavigationVisible(),
  readMode: () => isReadMode(),
  fullscreen: () => isFullscreenActive(),
  paginationMode: () => getPaginationMode(),
  zoomLevel: () => {
    const layout = getLayoutController();
    return layout?.getZoom() ?? 1;
  },
  viewMode: () => {
    const layout = getLayoutController();
    return layout?.getViewMode?.() ?? "single";
  },
  pageCount: () => {
    const layout = getLayoutController();
    return layout?.getPageCount?.() ?? 1;
  },
  pageColumns: (editor) => {
    const { from } = editor.state.selection;
    let sectionColumns: number | null = null;
    editor.state.doc.nodesBetween(0, from, (node) => {
      if (node.type.name !== "page_break") return true;
      const kind = typeof node.attrs?.kind === "string" ? node.attrs.kind : "";
      if (!kind.startsWith("section_")) return true;
      const meta = parseSectionMeta(node.attrs?.sectionSettings);
      sectionColumns = typeof meta.columns === "number" ? meta.columns : null;
      return true;
    });
    if (typeof sectionColumns === "number" && Number.isFinite(sectionColumns)) {
      return sectionColumns;
    }
    const raw = (editor.state.doc.attrs as any)?.columns;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 1;
  },
  autoLink: () => readBoolPref(PREF_AUTO_LINK, false),
  tableDrawMode: () => false,
  responsiveTableDefault: () => false,
  textBoxDrawMode: () => false,
  formatPainter: () => false,
  pasteAutoClean: () => readBoolPref(PREF_PASTE_AUTO_CLEAN, false),
  findRegex: () => false,
  findMatchCase: () => false,
  findWholeWords: () => false,
  borders: (editor) => {
    const block = getSelectionBlockDescriptor(editor);
    const preset = block?.attrs?.borderPreset;
    return typeof preset === "string" ? preset : null;
  },
  shading: () => null,
  trackChanges: () => trackChangesActive,
  citationStyle: (editor) => {
    const styleId = editor.state.doc.attrs?.citationStyleId;
    if (typeof styleId === "string") return styleId;
    return null;
  },
  sourceChecksVisible: () => isSourceChecksVisible()
};

export class RibbonStateBus {
  private state: RibbonStateSnapshot = {};
  private listeners = new Set<RibbonStateListener>();
  private pendingUpdate: number | NodeJS.Timeout | null = null;
  private unsubscribeSourceChecks: (() => void) | null = null;
  private readonly handlePrefChange = (): void => {
    this.scheduleUpdate();
  };

  private readonly handleSelectionChange = (): void => {
    this.scheduleUpdate();
  };

  constructor(public readonly editorHandle: EditorHandle) {
    this.updateState();
    this.editorHandle.on("selectionChange", this.handleSelectionChange);
    this.editorHandle.on("change", this.handleSelectionChange);
    if (typeof window !== "undefined") {
      window.addEventListener(PREF_EVENT_NAME, this.handlePrefChange);
      window.addEventListener("leditor:track-changes", this.handlePrefChange);
    }
    // Keep ribbon toggle bindings in sync with non-editor state (source checks visibility + thread).
    try {
      this.unsubscribeSourceChecks = subscribeSourceChecksThread(() => this.scheduleUpdate());
    } catch {
      // ignore
    }
  }

  dispose(): void {
    try {
      this.editorHandle.off("selectionChange", this.handleSelectionChange);
      this.editorHandle.off("change", this.handleSelectionChange);
    } catch {
      // ignore
    }
    if (typeof window !== "undefined") {
      window.removeEventListener(PREF_EVENT_NAME, this.handlePrefChange);
      window.removeEventListener("leditor:track-changes", this.handlePrefChange);
    }
    try {
      this.unsubscribeSourceChecks?.();
    } catch {
      // ignore
    }
    if (this.pendingUpdate !== null && typeof window !== "undefined") {
      try {
        window.cancelAnimationFrame(this.pendingUpdate as number);
      } catch {
        // ignore
      }
    }
    this.pendingUpdate = null;
    this.listeners.clear();
  }

  dispatch(commandId: EditorCommandId, payload?: unknown): void {
    ribbonTraceCall("stateBus.dispatch", { commandId }, () => {
      dispatchCommand(this.editorHandle, commandId, payload);
      this.scheduleUpdate();
    });
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
      // Coalesce to a single update per frame to avoid tight loops on selection changes.
      this.pendingUpdate = window.requestAnimationFrame(callback);
    } else {
      this.pendingUpdate = setTimeout(callback, 0);
    }
  }

  private updateState(): void {
    ribbonTraceCall("stateBus.updateState", { keys: STATE_KEYS.length }, () => {
      const editor = this.editorHandle.getEditor();
      const nextState: RibbonStateSnapshot = {};
      for (const key of STATE_KEYS) {
        const selector = stateSelectors[key];
        if (!selector) {
          continue;
        }
        const raw = selector(editor, this.state);
        if (key === "selectionContext" && raw && typeof raw === "object") {
          const prev = this.state.selectionContext as any;
          if (
            prev &&
            typeof prev === "object" &&
            (raw as any).hasSelection === prev.hasSelection &&
            (raw as any).isRange === prev.isRange
          ) {
            nextState[key] = prev;
          } else {
            nextState[key] = raw;
          }
        } else {
          nextState[key] = raw;
        }
      }
      if (this.hasStateChanged(nextState)) {
        this.state = { ...this.state, ...nextState };
        const snapshot = this.getState();
        this.listeners.forEach((listener) => listener(snapshot));
      } else {
        this.state = { ...this.state, ...nextState };
      }
    });
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
