import { getLayoutController } from './layout_context.js';
import {
  getCurrentPageSize,
  getMarginValues
} from './layout_settings.js';

const applyPageSizeVariables = (): void => {
  const root = document.documentElement;
  if (!root) return;
  const { widthMm, heightMm } = getCurrentPageSize();
  root.style.setProperty('--page-width-mm', widthMm.toString());
  root.style.setProperty('--page-height-mm', heightMm.toString());
};

const applyMarginVariables = (): void => {
  const root = document.documentElement;
  if (!root) return;
  const margins = getMarginValues();
  root.style.setProperty('--page-margin-top', margins.top);
  root.style.setProperty('--page-margin-right', margins.right);
  root.style.setProperty('--page-margin-bottom', margins.bottom);
  root.style.setProperty('--page-margin-left', margins.left);
};

export const refreshLayoutView = (): void => {
  if (typeof document === 'undefined') return;
  applyPageSizeVariables();
  applyMarginVariables();
  const layout = getLayoutController();
  layout?.updatePagination();
};
