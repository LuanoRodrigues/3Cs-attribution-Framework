import type { EditorHandle } from "../api/leditor.ts";
import { peekRibbonSelection, applySnapshotToTransaction } from "../utils/selection_snapshot.ts";

export type EditorCommandId =
  | "Bold"
  | "Italic"
  | "Underline"
  | "Strikethrough"
  | "Undo"
  | "Redo"
  | "AlignLeft"
  | "AlignCenter"
  | "AlignRight"
  | "JustifyFull"
  | "BulletList"
  | "NumberList"
  | "RemoveFontStyle"
  | "FontFamily"
  | "FontSize"
  | "TextColor"
  | "HighlightColor"
  | "RemoveTextColor"
  | "RemoveHighlightColor"
  | "NormalStyle"
  | "ClearFormatting"
  | "ChangeCase"
  | "Link"
  | "Heading1"
  | "Heading2"
  | "Heading3"
  | "Heading4"
  | "Heading5"
  | "Heading6"
  | "Superscript"
  | "Subscript"
  | "LineSpacing"
  | "SpaceBefore"
  | "SpaceAfter"
  | "Outdent"
  | "Indent"
  | "SetIndent"
  | "TableInsert"
  | "InsertImage"
  | "InsertPageBreak"
  | "InsertColumnBreak"
  | "InsertTextWrappingBreak"
  | "InsertSectionBreakNextPage"
  | "InsertSectionBreakContinuous"
  | "InsertSectionBreakEven"
  | "InsertSectionBreakOdd"
  | "InsertTemplate"
  | "InsertFootnote"
  | "InsertEndnote"
  | "NextFootnote"
  | "PreviousFootnote"
  | "InsertBookmark"
  | "InsertCrossReference"
  | "InsertTOC"
  | "UpdateTOC"
  | "InsertTocHeading"
  | "InsertCitation"
  | "UpdateCitations"
  | "SetCitationStyle"
  | "SetCitationSources"
  | "UpsertCitationSource"
  | "InsertBibliography"
  | "UpdateBibliography"
  | "WordCount"
  | "Spelling"
  | "Thesaurus"
  | "ReadAloud"
  | "ProofingPanel"
  | "CommentsNew"
  | "CommentsDelete"
  | "CommentsPrev"
  | "CommentsNext"
  | "ToggleTrackChanges"
  | "AcceptChange"
  | "RejectChange"
  | "PrevChange"
  | "NextChange"
  | "Preview"
  | "SourceView"
  | "Fullscreen"
  | "VisualBlocks"
  | "VisualChars"
  | "InsertComment"
  | "DirectionLTR"
  | "DirectionRTL"
  | "SetReadMode"
  | "SetPrintLayout"
  | "SetScrollDirectionVertical"
  | "SetScrollDirectionHorizontal"
  | "ZoomIn"
  | "ZoomOut"
  | "ZoomReset"
  | "ViewSinglePage"
  | "ViewTwoPage"
  | "ViewFitWidth"
  | "SetPageMargins"
  | "SetPageOrientation"
  | "SetPageSize"
  | "SetContentFrameHeight"
  | "ContentFrameHeightInc"
  | "ContentFrameHeightDec"
  | "ContentFrameHeightReset"
  | "SetHeaderDistance"
  | "SetFooterDistance"
  | "SetPageGutter"
  | "SetSectionColumns"
  | "view.printPreview.open"
  | "SetLineNumbering"
  | "SetHyphenation"
  | "SetParagraphIndent"
  | "SetParagraphSpacing"
  | "MarkupAll"
  | "MarkupNone"
  | "MarkupOriginal"
  | "EditHeader"
  | "EditFooter"
  | "ExitHeaderFooterEdit"
  | "FootnotePanel"
  | "RemoveColor"
  | "Cut"
  | "Copy"
  | "Paste"
  | "PastePlain"
  | "SearchReplace"
  | "ExportDOCX"
  | "ImportDOCX"
  | "PasteClean"
  | "ImportDocx"
  | "ExportDocx"
  | "ExportPdf"
  | "OpenRevisionHistory"
  | "SaveRevision"
  | "RestoreRevision"
  | "ToggleSpellcheck"
  | "AddToDictionary"
  | "ReplaceWithSuggestion"
  | "AiSummarizeSelection"
  | "AiRewriteSelection"
  | "AiContinue"
  | "SelectAll"
  | "SelectObjects"
  | "SelectSimilarFormatting"
  | "ClipboardOptionsDialog"
  | "FontOptionsDialog"
  | "FontEffectsMenu"
  | "FontEffectsDialog"
  | "FontEffectsOutline"
  | "FontEffectsShadow"
  | "UnderlineColorPicker"
  | "ParagraphOptionsDialog"
  | "ParagraphSpacingDialog"
  | "ParagraphSpacingMenu"
  | "ParagraphBordersDialog"
  | "ParagraphBordersMenu"
  | "ParagraphBordersSet"
  | "BlockquoteToggle";

export const MINIMAL_EDITOR_COMMANDS: EditorCommandId[] = [
  "Bold",
  "Italic",
  "Underline",
  "Undo",
  "Redo",
  "AlignLeft",
  "AlignCenter",
  "AlignRight",
  "JustifyFull",
  "BulletList",
  "NumberList"
];

export const dispatchCommand = (
  editorHandle: EditorHandle,
  commandId: EditorCommandId,
  payload?: unknown
) => {
  window.codexLog?.write(`[RIBBON_COMMAND] ${commandId}`);
  // Some commands trigger pagination/layout reflow. Preserve the user's scroll position across the
  // next pagination pass to avoid "scrollbar disappears / cursor jumps to end" reports.
  (window as any).__leditorPreserveScrollOnNextPagination = true;
  // Ribbon clicks can blur the editor and lose the current caret position.
  // Restore the last recorded selection before running commands so formatting changes don't jump to the end.
  const tiptapEditor = (editorHandle as any)?.getEditor?.();
  const snapshot = peekRibbonSelection();
  if (snapshot && tiptapEditor?.view && tiptapEditor?.state?.tr) {
    try {
      const tr = applySnapshotToTransaction(tiptapEditor.state.tr, snapshot);
      if (
        tr.selection.from !== tiptapEditor.state.selection.from ||
        tr.selection.to !== tiptapEditor.state.selection.to
      ) {
        tiptapEditor.view.dispatch(tr);
      }
    } catch {
      // ignore selection restoration failures
    }
  }
  editorHandle.execCommand(commandId, payload);
  // Some commands intentionally move focus away from the main ProseMirror editor (e.g. footnotes,
  // header/footer overlays). For those cases, forcing focus back here will steal the caret and
  // make typing impossible.
  const appRoot = document.getElementById("leditor-app");
  const isOverlayEditing =
    !!appRoot &&
    (appRoot.classList.contains("leditor-footnote-editing") ||
      appRoot.classList.contains("leditor-header-footer-editing"));
  const isOverlayCommand =
    commandId === "InsertFootnote" ||
    commandId === "InsertEndnote" ||
    commandId === "NextFootnote" ||
    commandId === "PreviousFootnote" ||
    commandId === "EditHeader" ||
    commandId === "EditFooter";

  if (!isOverlayEditing && !isOverlayCommand) {
    const tiptap = (editorHandle as any)?.getEditor?.();
    if (tiptap?.commands?.focus) {
      tiptap.commands.focus();
    } else if ((editorHandle as any)?.focus) {
      (editorHandle as any).focus();
    }
  }
};

