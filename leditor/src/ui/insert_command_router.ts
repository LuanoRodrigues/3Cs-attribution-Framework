import type { EditorHandle } from "../api/leditor.ts";
import { getLayoutController } from "../ui/layout_context.ts";
import { refreshLayoutView } from "./layout_engine.ts";
import { getTemplateById, getTemplates } from "../templates/index.ts";

const execute = (handle: EditorHandle, commandId: string, args?: unknown) => {
  handle.execCommand(commandId, args);
  refreshLayoutView();
};

const insertTemplate = (handle: EditorHandle, templateId?: string) => {
  const available = getTemplates();
  const id = typeof templateId === "string" ? templateId : available[0]?.id;
  if (!id) return;
  handle.execCommand("InsertTemplate", { id });
};

export const handleInsertCommand = (
  editorHandle: EditorHandle,
  commandId: string,
  payload?: unknown
): void => {
  const layout = getLayoutController();
  switch (commandId) {
    case "insert.coverPage.default":
      insertTemplate(editorHandle);
      return;
    case "insert.coverPage.apply":
      insertTemplate(editorHandle, typeof payload === "object" ? (payload as Record<string, unknown>).templateId as string : undefined);
      return;
    case "insert.coverPage.remove":
    case "insert.blankPage":
      execute(editorHandle, "InsertPageBreak");
      return;
    case "insert.pageBreak":
      execute(editorHandle, "InsertPageBreak");
      return;
    case "insert.columnBreak":
      execute(editorHandle, "InsertColumnBreak");
      return;
    case "insert.sectionBreak.nextPage":
      execute(editorHandle, "InsertSectionBreakNextPage");
      return;
    case "insert.sectionBreak.continuous":
      execute(editorHandle, "InsertSectionBreakContinuous");
      return;
    case "insert.sectionBreak.evenPage":
      execute(editorHandle, "InsertSectionBreakEven");
      return;
    case "insert.sectionBreak.oddPage":
      execute(editorHandle, "InsertSectionBreakOdd");
      return;
    case "insert.table.openGridPicker":
      execute(editorHandle, "TableInsert", { rows: 2, cols: 2 });
      return;
    case "insert.table.apply":
      execute(editorHandle, "TableInsert", payload);
      return;
    case "insert.table.openDialog":
      execute(editorHandle, "TableInsert", payload);
      return;
    case "insert.coverPage.default":
    case "insert.coverPage.apply":
      return;
  }

  if (commandId.startsWith("insert.header")) {
    execute(editorHandle, "EditHeader");
    layout?.enterHeaderFooterMode("header");
    return;
  }

  if (commandId.startsWith("insert.footer")) {
    execute(editorHandle, "EditFooter");
    layout?.enterHeaderFooterMode("footer");
    return;
  }

  console.warn(`[InsertCommandRouter] unhandled command "${commandId}"`);
};
