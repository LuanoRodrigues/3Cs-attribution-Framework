import { getLayoutController } from "../ui/layout_context.ts";
import { applyDocumentLayoutTokens } from "./pagination/index.ts";

export const refreshLayoutView = (): void => {
  if (typeof document === "undefined") return;
  applyDocumentLayoutTokens(document.documentElement);
  const layout = getLayoutController();
  layout?.updatePagination();
};
