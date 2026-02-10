import type { LayoutPage, LayoutResult } from "../../layout-v2/types.ts";
import type { ComputedStyle } from "../../layout-v2/style/computed-style.ts";
import { createStyleResolver, type StyleResolver } from "../../layout-v2/style/resolve-style.ts";
import { renderPageDom } from "./page-dom.ts";

const ensureRoot = (): HTMLElement | null => {
  if (typeof document === "undefined") return null;
  const existing = document.querySelector<HTMLElement>('[data-leditor-paged-root="true"]');
  if (existing) return existing;
  const root = document.createElement("div");
  root.dataset.leditorPagedRoot = "true";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.gap = "16px";
  document.body.appendChild(root);
  return root;
};

const defaultStyleResolver = createStyleResolver();

export const renderLayoutResult = (result: LayoutResult, styleResolver?: StyleResolver): void => {
  const root = ensureRoot();
  if (!root) return;
  const resolver =
    styleResolver ??
    (result.styles ? createStyleResolver(result.styles as Record<string, Partial<ComputedStyle>>) : defaultStyleResolver);
  root.innerHTML = "";
  result.pages.forEach((page: LayoutPage) => {
    const dom = renderPageDom(page, resolver, result.headerHtml, result.footerHtml);
    root.appendChild(dom);
  });
};
