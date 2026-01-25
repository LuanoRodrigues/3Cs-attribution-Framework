import { getLayoutController } from "./layout_context.js";
import { applyDocumentLayoutTokens } from "./pagination/index.js";

export const refreshLayoutView = (): void => {
  if (typeof document === "undefined") return;
  applyDocumentLayoutTokens(document.documentElement);
  const layout = getLayoutController();
  layout?.updatePagination();
};
