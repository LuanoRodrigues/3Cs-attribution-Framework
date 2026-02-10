import type { LayoutBlock } from "../types.ts";
import type { HeaderFooterStory } from "./header-footer-model.ts";

export type HeaderFooterLayout = {
  headerBlocks: LayoutBlock[];
  footerBlocks: LayoutBlock[];
};

export const layoutHeadersAndFooters = (_story: HeaderFooterStory | undefined): HeaderFooterLayout => {
  return { headerBlocks: [], footerBlocks: [] };
};
