import { Extension } from "@tiptap/core";
import type { Level } from "@tiptap/extension-heading";
import { keymap } from "@tiptap/pm/keymap";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { CellSelection, findTable, selectionCell, TableMap } from "@tiptap/pm/tables";
import { moveBlock } from "../editor/block_movement.ts";
import { getInsertMode, getSelectionMode, toggleInsertMode, toggleSelectionMode } from "../editor/input_modes.ts";
import { findSentenceBounds, isWordChar } from "../editor/sentence_utils.ts";
import {
  completeWord,
  createAutoTextFromSelection,
  expandAutoText,
  insertSpecialText,
  resetWordCompletion
} from "../editor/word_tools.ts";

const ALIGN_SHORTCUTS: Record<string, "left" | "center" | "right" | "justify"> = {
  "Mod-Shift-L": "left",
  "Mod-Shift-E": "center",
  "Mod-Shift-R": "right",
  "Mod-Shift-J": "justify",
  "Mod-L": "left",
  "Mod-E": "center",
  "Mod-R": "right",
  "Mod-J": "justify"
};

const HEADING_SHORTCUTS: Record<string, number> = {
  "Mod-Alt-1": 1,
  "Mod-Alt-2": 2,
  "Mod-Alt-3": 3,
  "Mod-1": 1,
  "Mod-2": 2,
  "Mod-3": 3
};

const WordShortcutsExtension = Extension.create({
  name: "wordShortcuts",
  priority: 1000,
  addProseMirrorPlugins() {
    const editor = this.editor;
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const focusIfEditable = () => {
      const appRoot = document.getElementById("leditor-app");
      if (
        appRoot?.classList.contains("leditor-footnote-editing") ||
        appRoot?.classList.contains("leditor-header-footer-editing")
      ) {
        return;
      }
      try {
        editor.view.focus();
      } catch {
        // ignore focus errors
      }
    };

    const shouldExtendSelection = (explicitExtend: boolean) => explicitExtend || getSelectionMode() === "extend";

    const showPlaceholder = (label: string) => {
      window.alert(`${label} (not implemented yet).`);
      return true;
    };

    const findPrevTextblockEnd = (fromPos: number): number | null => {
      const doc = editor.state.doc;
      let found: number | null = null;
      doc.nodesBetween(0, Math.max(0, fromPos), (node: any, pos: number) => {
        if (node?.isTextblock) {
          const end = pos + node.nodeSize - 1;
          if (end < fromPos) {
            found = end;
          }
        }
        return true;
      });
      return found;
    };

    const findNextTextblockStart = (fromPos: number): number | null => {
      const doc = editor.state.doc;
      let found: number | null = null;
      doc.nodesBetween(Math.max(0, fromPos), doc.content.size, (node: any, pos: number) => {
        if (found != null) return false;
        if (node?.isTextblock) {
          const start = pos + 1;
          if (start > fromPos) {
            found = start;
            return false;
          }
        }
        return true;
      });
      return found;
    };

    const findPrevTextblockStart = (fromPos: number): number | null => {
      const prevEnd = findPrevTextblockEnd(fromPos);
      if (prevEnd == null) return null;
      try {
        const $pos = editor.state.doc.resolve(prevEnd);
        let depth = $pos.depth;
        while (depth > 0 && !$pos.node(depth).isTextblock) depth -= 1;
        if (depth <= 0) return null;
        return $pos.start(depth);
      } catch {
        return null;
      }
    };

    const moveByChar = (dir: -1 | 1, extend: boolean) => {
      const view = editor.view;
      if (!view) return false;
      const state = view.state;
      const head = state.selection.head;
      const next = Math.max(0, Math.min(state.doc.content.size, head + dir));
      try {
        const $pos = state.doc.resolve(next);
        const near = Selection.near($pos, dir);
        const anchor = extend ? state.selection.anchor : near.head;
        const sel = TextSelection.create(state.doc, anchor, near.head);
        view.dispatch(state.tr.setSelection(sel).scrollIntoView());
        focusIfEditable();
        return true;
      } catch {
        return false;
      }
    };

    const moveByLine = (dir: -1 | 1, extend: boolean) => {
      const view = editor.view;
      if (!view) return false;
      const state = view.state;
      const coords = view.coordsAtPos(state.selection.head);
      const lineHeight = Math.max(4, coords.bottom - coords.top);
      const target = view.posAtCoords({ left: coords.left, top: coords.top + dir * lineHeight });
      if (!target) return false;
      const anchor = extend ? state.selection.anchor : target.pos;
      const sel = TextSelection.create(state.doc, anchor, target.pos);
      view.dispatch(state.tr.setSelection(sel).scrollIntoView());
      focusIfEditable();
      return true;
    };

    const moveByParagraph = (dir: -1 | 1, extend: boolean) => {
      const view = editor.view;
      if (!view) return false;
      const state = view.state;
      const pos = state.selection.head;
      const target =
        dir < 0 ? findPrevTextblockStart(pos - 1) : findNextTextblockStart(pos + 1);
      if (target == null) return false;
      const anchor = extend ? state.selection.anchor : target;
      const sel = TextSelection.create(state.doc, anchor, target);
      view.dispatch(state.tr.setSelection(sel).scrollIntoView());
      focusIfEditable();
      return true;
    };

    const moveByPage = (delta: number, extend: boolean) => {
      const view = editor.view;
      if (!view) return false;
      const appRoot = document.getElementById("leditor-app");
      const pageEl = document.querySelector<HTMLElement>(".leditor-page");
      const pageHeight = pageEl?.getBoundingClientRect().height ?? appRoot?.clientHeight ?? 0;
      if (!pageHeight) return false;
      const coords = view.coordsAtPos(view.state.selection.head);
      const targetCoords = { left: coords.left, top: coords.top + delta * pageHeight };
      const target = view.posAtCoords(targetCoords);
      if (!target) {
        appRoot?.scrollBy({ top: delta * pageHeight, behavior: "auto" });
        return false;
      }
      const anchor = extend ? view.state.selection.anchor : target.pos;
      const sel = TextSelection.create(view.state.doc, anchor, target.pos);
      view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
      appRoot?.scrollBy({ top: delta * pageHeight, behavior: "auto" });
      focusIfEditable();
      return true;
    };

    const getTableContext = () => {
      const cell = selectionCell(editor.state);
      if (!cell) return null;
      const table = findTable(cell);
      if (!table) return null;
      return { cell, table };
    };

    const selectCurrentCell = () => {
      const ctx = getTableContext();
      if (!ctx) return false;
      const sel = new CellSelection(ctx.cell, ctx.cell);
      editor.view.dispatch(editor.state.tr.setSelection(sel));
      focusIfEditable();
      return true;
    };

    const selectEntireTable = () => {
      const ctx = getTableContext();
      if (!ctx) return false;
      const map = TableMap.get(ctx.table.node);
      const first = ctx.table.start + map.map[0];
      const last = ctx.table.start + map.map[map.map.length - 1];
      const sel = new CellSelection(editor.state.doc.resolve(first), editor.state.doc.resolve(last));
      editor.view.dispatch(editor.state.tr.setSelection(sel));
      focusIfEditable();
      return true;
    };

    const isFullTableSelection = () => {
      const ctx = getTableContext();
      if (!ctx) return false;
      const selection = editor.state.selection;
      if (!(selection instanceof CellSelection)) return false;
      const map = TableMap.get(ctx.table.node);
      const first = ctx.table.start + map.map[0];
      const last = ctx.table.start + map.map[map.map.length - 1];
      const anchor = selection.$anchorCell.pos;
      const head = selection.$headCell.pos;
      return (
        (anchor === first && head === last) || (anchor === last && head === first)
      );
    };

    const moveToTableEdge = (edge: "start" | "end", extend: boolean) => {
      const ctx = getTableContext();
      if (!ctx) return false;
      const map = TableMap.get(ctx.table.node);
      const first = ctx.table.start + map.map[0];
      const last = ctx.table.start + map.map[map.map.length - 1];
      const pos = edge === "start" ? first : last;
      const anchor = extend ? editor.state.selection.anchor : pos;
      const sel = TextSelection.create(editor.state.doc, anchor, pos);
      editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView());
      focusIfEditable();
      return true;
    };

    const calculateSelection = () => {
      const { selection, doc } = editor.state;
      if (selection.empty) return false;
      const text = doc.textBetween(selection.from, selection.to, " ");
      const matches = text.match(/-?\\d+(?:\\.\\d+)?/g) ?? [];
      if (matches.length === 0) {
        window.alert("No numbers found in selection.");
        return true;
      }
      const total = matches.reduce((sum, raw) => sum + Number.parseFloat(raw), 0);
      window.alert(`Sum: ${total}`);
      return true;
    };

    const deleteSentence = (dir: -1 | 1) => {
      const { selection, doc } = editor.state;
      if (!selection.empty) {
        editor.view.dispatch(editor.state.tr.deleteSelection().scrollIntoView());
        return true;
      }
      const $from = selection.$from;
      let depth = $from.depth;
      while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1;
      if (depth <= 0) return false;
      const block = $from.node(depth);
      const text = block.textBetween(0, block.content.size, "\\n", "\\n");
      const offset = $from.parentOffset;
      const bounds = findSentenceBounds(text, offset);
      const blockStart = $from.start(depth);
      const from = dir < 0 ? blockStart + bounds.start : blockStart + offset;
      const to = dir < 0 ? blockStart + offset : blockStart + bounds.end;
      if (from === to) return false;
      editor.view.dispatch(editor.state.tr.delete(from, to).scrollIntoView());
      return true;
    };

    const toggleDoubleUnderline = () => {
      const isDouble = editor.isActive("underline", { underlineStyle: "double" });
      if (isDouble) {
        editor.commands.unsetMark("underline");
        return true;
      }
      editor.commands.setMark("underline", { underlineStyle: "double" });
      return true;
    };

    const findListItemDepth = () => {
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name === "listItem") return depth;
      }
      return null;
    };

    const insertParagraphAfterList = () => {
      if (findListItemDepth() == null) return false;
      editor.commands.splitListItem("listItem");
      editor.commands.liftListItem("listItem");
      focusIfEditable();
      return true;
    };

    const moveByWord = (dir: -1 | 1, extend: boolean) => {
      const view = editor.view;
      if (!view) return false;
      const state = view.state;
      const { selection } = state;
      let pos = selection.head;
      if (!extend && !selection.empty) {
        pos = dir < 0 ? selection.from : selection.to;
      }
      for (let hop = 0; hop < 2; hop += 1) {
        const $head = state.doc.resolve(pos);
        let depth = $head.depth;
        while (depth > 0 && !$head.node(depth).isTextblock) depth -= 1;
        if (depth <= 0) break;
        const blockStart = $head.start(depth);
        const blockEnd = $head.end(depth);

        if (dir < 0 && pos <= blockStart) {
          const prev = findPrevTextblockEnd(blockStart - 1);
          if (prev == null) break;
          pos = prev;
          continue;
        }
        if (dir > 0 && pos >= blockEnd) {
          const next = findNextTextblockStart(blockEnd + 1);
          if (next == null) break;
          pos = next;
          continue;
        }

        if (dir < 0) {
          while (pos > blockStart) {
            const ch = getCharBetween(pos - 1, pos);
            if (!ch || !/\s/.test(ch)) break;
            pos -= 1;
          }
          if (pos > blockStart) {
            const first = getCharBetween(pos - 1, pos);
            const movingWord = isWordChar(first);
            while (pos > blockStart) {
              const ch = getCharBetween(pos - 1, pos);
              if (!ch) break;
              if (/\s/.test(ch)) break;
              if (movingWord !== isWordChar(ch)) break;
              pos -= 1;
            }
          }
        } else {
          while (pos < blockEnd) {
            const ch = getCharBetween(pos, pos + 1);
            if (!ch || !/\s/.test(ch)) break;
            pos += 1;
          }
          if (pos < blockEnd) {
            const first = getCharBetween(pos, pos + 1);
            const movingWord = isWordChar(first);
            while (pos < blockEnd) {
              const ch = getCharBetween(pos, pos + 1);
              if (!ch) break;
              if (/\s/.test(ch)) break;
              if (movingWord !== isWordChar(ch)) break;
              pos += 1;
            }
          }
        }
        break;
      }
      const anchor = extend ? selection.anchor : pos;
      const nextSelection = TextSelection.create(state.doc, anchor, pos);
      view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView());
      focusIfEditable();
      return true;
    };

    const scrollByPage = (delta: number) => {
      const appRoot = document.getElementById("leditor-app");
      if (!appRoot) return false;
      const pageEl = document.querySelector<HTMLElement>(".leditor-page");
      const pageHeight = pageEl?.getBoundingClientRect().height ?? appRoot.clientHeight;
      if (!pageHeight) return false;
      appRoot.scrollBy({ top: delta * pageHeight, behavior: "auto" });
      focusIfEditable();
      return true;
    };

    const moveToTextblockEdge = (edge: "start" | "end", extend: boolean) => {
      const state = editor.state;
      const { selection } = state;
      const { $from } = selection;

      let depth = $from.depth;
      while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1;
      if (depth <= 0) return false;

      const pos = edge === "start" ? $from.start(depth) : $from.end(depth);
      const anchor = extend ? selection.anchor : pos;
      const nextSelection = TextSelection.create(state.doc, anchor, pos);
      editor.view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView());
      focusIfEditable();
      return true;
    };

    const moveToDocEdge = (edge: "start" | "end", extend: boolean) => {
      const state = editor.state;
      const { selection } = state;
      const pos = edge === "start" ? 0 : state.doc.content.size;
      const anchor = extend ? selection.anchor : pos;
      const nextSelection = TextSelection.create(state.doc, anchor, pos);
      editor.view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView());
      focusIfEditable();
      return true;
    };

    const getCharBetween = (from: number, to: number) => {
      if (from < 0 || to < 0) return "";
      if (from >= to) return "";
      return editor.state.doc.textBetween(from, to, "\0", "\0");
    };

    const deleteRange = (from: number, to: number) => {
      if (from === to) return false;
      const state = editor.state;
      resetWordCompletion();
      editor.view.dispatch(state.tr.delete(from, to).scrollIntoView());
      focusIfEditable();
      return true;
    };

    const deleteWordBackward = () => {
      const state = editor.state;
      const { selection } = state;
      if (!selection.empty) return deleteRange(selection.from, selection.to);
      const head = selection.from;
      if (head <= 0) return false;
      const $pos = state.doc.resolve(head);
      const blockStart = $pos.start($pos.depth);
      let pos = head;

      while (pos > blockStart) {
        const ch = getCharBetween(pos - 1, pos);
        if (!ch || !/\s/.test(ch)) break;
        pos -= 1;
      }
      if (pos === blockStart) return false;

      const first = getCharBetween(pos - 1, pos);
      const deletingWord = isWordChar(first);
      while (pos > blockStart) {
        const ch = getCharBetween(pos - 1, pos);
        if (!ch) break;
        if (/\s/.test(ch)) break;
        if (deletingWord !== isWordChar(ch)) break;
        pos -= 1;
      }
      return deleteRange(pos, head);
    };

    const deleteWordForward = () => {
      const state = editor.state;
      const { selection } = state;
      if (!selection.empty) return deleteRange(selection.from, selection.to);
      const head = selection.from;
      const $pos = state.doc.resolve(head);
      const blockEnd = $pos.end($pos.depth);
      let pos = head;
      if (pos >= blockEnd) return false;

      while (pos < blockEnd) {
        const ch = getCharBetween(pos, pos + 1);
        if (!ch || !/\s/.test(ch)) break;
        pos += 1;
      }
      if (pos >= blockEnd) return false;

      const first = getCharBetween(pos, pos + 1);
      const deletingWord = isWordChar(first);
      while (pos < blockEnd) {
        const ch = getCharBetween(pos, pos + 1);
        if (!ch) break;
        if (/\s/.test(ch)) break;
        if (deletingWord !== isWordChar(ch)) break;
        pos += 1;
      }
      return deleteRange(head, pos);
    };

    const execHandleCommand = (command: string, args?: unknown) => {
      const handle = (window as typeof window & {
        leditor?: { execCommand: (name: string, args?: any) => void };
      }).leditor;
      handle?.execCommand?.(command, args);
    };

    const overwritePlugin = new Plugin({
      key: new PluginKey("leditor-overwrite-mode"),
      props: {
        handleTextInput(view, from, to, text) {
          if (getInsertMode() !== "overwrite") return false;
          resetWordCompletion();
          const state = view.state;
          const docSize = state.doc.content.size;
          const $from = state.doc.resolve(from);
          const blockEnd = $from.end($from.depth);
          const replaceTo = Math.min(blockEnd, docSize, from + text.length);
          const tr = state.tr.insertText(text, from, Math.max(to, replaceTo));
          view.dispatch(tr.scrollIntoView());
          return true;
        },
        handleKeyDown(_view, event) {
          if (event.key === "Insert") {
            event.preventDefault();
            toggleInsertMode();
            return true;
          }
          return false;
        }
      }
    });

    return [
      keymap({
        ...Object.fromEntries(
          Object.entries(ALIGN_SHORTCUTS).map(([key, align]) => [
            key,
            () => {
              focusIfEditable();
              editor
                .chain()
                .updateAttributes("paragraph", { textAlign: align })
                .updateAttributes("heading", { textAlign: align })
                .run();
              return true;
            }
          ])
        ),
        ...Object.fromEntries(
          Object.entries(HEADING_SHORTCUTS).map(([key, level]) => [
            key,
            () => {
              focusIfEditable();
              editor.commands.toggleHeading({ level: level as Level });
              return true;
            }
          ])
        ),

        "Mod-0": () => {
          focusIfEditable();
          editor.commands.setParagraph();
          return true;
        },

        // Selection mode toggles (LibreOffice-style)
        F8: () => {
          toggleSelectionMode("extend");
          return true;
        },
        "Shift-F8": () => {
          toggleSelectionMode("add");
          if (getSelectionMode() === "add") showPlaceholder("Add selection mode");
          return true;
        },
        "Ctrl-Shift-F8": () => {
          toggleSelectionMode("block");
          if (getSelectionMode() === "block") showPlaceholder("Block selection mode");
          return true;
        },

        "Mod-Enter": () => {
          execHandleCommand("InsertPageBreak");
          return true;
        },
        "Mod-Shift-Enter": () => {
          execHandleCommand("InsertColumnBreak");
          return true;
        },

        "Mod-Alt-T": () => {
          focusIfEditable();
          editor.commands.insertTable({ rows: 2, cols: 2 });
          return true;
        },
        "Mod-Alt-F": () => {
          focusIfEditable();
          const footnoteCommand = (editor.commands as Record<string, unknown>)["insertFootnote"];
          if (typeof footnoteCommand === "function") {
            (footnoteCommand as () => boolean)();
          }
          return true;
        },

        "Mod-D": () => {
          focusIfEditable();
          return toggleDoubleUnderline();
        },
        "Mod-Shift-P": () => {
          focusIfEditable();
          return editor.commands.toggleMark("superscript");
        },
        "Mod-Shift-B": () => {
          focusIfEditable();
          return editor.commands.toggleMark("subscript");
        },
        "Mod-5": () => {
          execHandleCommand("LineSpacing", { value: "1.5" });
          return true;
        },

        // Remove direct formatting (LibreOffice Ctrl+M)
        "Mod-M": () => {
          execHandleCommand("ClearFormatting");
          return true;
        },

        // Redo (Word-ish)
        "Mod-Y": () => {
          focusIfEditable();
          editor.commands.redo();
          return true;
        },
        "Mod-Shift-Z": () => {
          focusIfEditable();
          editor.commands.redo();
          return true;
        },

        // Paste plain text (Word-ish: Ctrl+Shift+V / Cmd+Shift+V)
        "Mod-Shift-V": () => {
          focusIfEditable();
          execHandleCommand("PastePlain");
          return true;
        },
        "Mod-F": () => {
          execHandleCommand("SearchReplace");
          return true;
        },
        "Mod-H": () => {
          execHandleCommand("SearchReplace");
          return true;
        },

        // AutoText + word completion
        F3: () => expandAutoText(editor),
        "Ctrl-F3": () => createAutoTextFromSelection(editor),
        "Ctrl-Tab": () => {
          if (getTableContext()) {
            return insertSpecialText(editor, "\t");
          }
          if (findListItemDepth() != null) {
            return editor.commands.sinkListItem("listItem");
          }
          return completeWord(editor, 1);
        },
        "Ctrl-Shift-Tab": () => {
          if (findListItemDepth() != null) {
            return editor.commands.liftListItem("listItem");
          }
          return completeWord(editor, -1);
        },

        // Special characters
        "Ctrl-Shift-Space": () => insertSpecialText(editor, "\u00A0"),
        "Ctrl--": () => insertSpecialText(editor, "\u00AD"),
        "Ctrl-Shift--": () => insertSpecialText(editor, "\u2011"),
        "Mod-=": () => calculateSelection(),
        "Mod-+": () => calculateSelection(),

        // Word delete left/right (Win/Linux: Ctrl+Backspace/Delete; Mac: Option+Backspace/Delete)
        "Mod-Shift-Backspace": () => deleteSentence(-1),
        "Mod-Shift-Delete": () => deleteSentence(1),
        "Mod-Backspace": () => (isMac ? false : deleteWordBackward()),
        "Mod-Delete": () => (isMac ? false : deleteWordForward()),
        "Alt-Backspace": () => deleteWordBackward(),
        "Alt-Delete": () => deleteWordForward(),

        // Word navigation by word.
        ...(isMac
          ? {
              "Alt-ArrowLeft": () => moveByWord(-1, shouldExtendSelection(false)),
              "Alt-ArrowRight": () => moveByWord(1, shouldExtendSelection(false)),
              "Alt-Shift-ArrowLeft": () => moveByWord(-1, true),
              "Alt-Shift-ArrowRight": () => moveByWord(1, true)
            }
          : {
              "Mod-ArrowLeft": () => moveByWord(-1, shouldExtendSelection(false)),
              "Mod-ArrowRight": () => moveByWord(1, shouldExtendSelection(false)),
              "Mod-Shift-ArrowLeft": () => moveByWord(-1, true),
              "Mod-Shift-ArrowRight": () => moveByWord(1, true)
            }),

        // Extend-selection arrow keys (F8 mode)
        ArrowLeft: () => (getSelectionMode() === "extend" ? moveByChar(-1, true) : false),
        ArrowRight: () => (getSelectionMode() === "extend" ? moveByChar(1, true) : false),
        ArrowUp: () => (getSelectionMode() === "extend" ? moveByLine(-1, true) : false),
        ArrowDown: () => (getSelectionMode() === "extend" ? moveByLine(1, true) : false),

        // Paragraph navigation + move
        "Ctrl-ArrowUp": () => moveByParagraph(-1, shouldExtendSelection(false)),
        "Ctrl-ArrowDown": () => moveByParagraph(1, shouldExtendSelection(false)),
        "Ctrl-Shift-ArrowUp": () => moveByParagraph(-1, true),
        "Ctrl-Shift-ArrowDown": () => moveByParagraph(1, true),
        "Ctrl-Alt-ArrowUp": () => moveBlock(editor, -1),
        "Ctrl-Alt-ArrowDown": () => moveBlock(editor, 1),

        // Alt+Enter exits list with a plain paragraph
        "Alt-Enter": () => insertParagraphAfterList(),

        // Table-aware select-all
        "Mod-A": () => {
          if (!getTableContext()) return false;
          if (!(editor.state.selection instanceof CellSelection)) {
            return selectCurrentCell();
          }
          if (!isFullTableSelection()) {
            return selectEntireTable();
          }
          return false;
        },

        // Home/End block navigation (+ Shift extend). (Approximation: start/end of current textblock.)
        Home: () => moveToTextblockEdge("start", shouldExtendSelection(false)),
        End: () => moveToTextblockEdge("end", shouldExtendSelection(false)),
        "Shift-Home": () => moveToTextblockEdge("start", true),
        "Shift-End": () => moveToTextblockEdge("end", true),

        // Win/Linux doc start/end (table-aware).
        "Ctrl-Home": () =>
          (getTableContext()
            ? moveToTableEdge("start", shouldExtendSelection(false))
            : moveToDocEdge("start", shouldExtendSelection(false))),
        "Ctrl-End": () =>
          (getTableContext()
            ? moveToTableEdge("end", shouldExtendSelection(false))
            : moveToDocEdge("end", shouldExtendSelection(false))),
        "Ctrl-Shift-Home": () =>
          (getTableContext()
            ? moveToTableEdge("start", true)
            : moveToDocEdge("start", true)),
        "Ctrl-Shift-End": () =>
          (getTableContext()
            ? moveToTableEdge("end", true)
            : moveToDocEdge("end", true)),

        // PageUp/PageDown move selection by page.
        PageUp: () => moveByPage(-1, shouldExtendSelection(false)) || scrollByPage(-1),
        PageDown: () => moveByPage(1, shouldExtendSelection(false)) || scrollByPage(1),
        "Shift-PageUp": () => moveByPage(-1, true) || scrollByPage(-1),
        "Shift-PageDown": () => moveByPage(1, true) || scrollByPage(1),

        // List toggles
        F12: () => editor.commands.toggleBulletList(),
        "Shift-F12": () => editor.commands.toggleOrderedList(),
        "Ctrl-Shift-F12": () =>
          findListItemDepth() != null ? editor.commands.liftListItem("listItem") : false,

        // Table resize placeholders (non-mac)
        "Alt-Shift-ArrowLeft": () =>
          !isMac && getTableContext() ? showPlaceholder("Table column resize") : false,
        "Alt-Shift-ArrowRight": () =>
          !isMac && getTableContext() ? showPlaceholder("Table column resize") : false,
        "Alt-Shift-ArrowUp": () =>
          !isMac && getTableContext() ? showPlaceholder("Table row resize") : false,
        "Alt-Shift-ArrowDown": () =>
          !isMac && getTableContext() ? showPlaceholder("Table row resize") : false
      }),
      overwritePlugin
    ];
  }
});

export default WordShortcutsExtension;
