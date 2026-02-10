import type { EditorView } from "@tiptap/pm/view";
import type { PluginKey, Transaction } from "@tiptap/pm/state";
import { runPaginationEngine } from "../ui/pagination_engine/controller.ts";
import { layoutDocumentV2 } from "../layout-v2/index.ts";
import type { LayoutResult, LayoutEngineFeatureFlags, PageSetup } from "../layout-v2/types.ts";
import { renderLayoutResult } from "../render/dom/layout-dom-renderer.ts";

export type EngineKind = "legacy" | "v2";

export type LayoutEngineOutcome = {
  transaction?: Transaction | null;
  layout?: LayoutResult | null;
  kind: EngineKind;
};

export type LayoutEngineContext = {
  view: EditorView;
  memo: any;
  options?: { preferJoin?: boolean; preferFill?: boolean };
  paginationKey: PluginKey;
  pageSetup?: PageSetup;
};

export type LayoutEngine = {
  kind: EngineKind;
  layout: (ctx: LayoutEngineContext) => LayoutEngineOutcome;
};

const pickEngineKind = (flags?: Partial<LayoutEngineFeatureFlags>): EngineKind => {
  if (flags?.useLayoutV2) return "v2";
  try {
    if (typeof window !== "undefined") {
      const urlFlag = new URLSearchParams(window.location.search).get("layout");
      if (urlFlag === "v2") return "v2";
      if (urlFlag === "legacy") return "legacy";
      const globalFlag = (window as any).__leditorLayoutEngine;
      if (globalFlag === "v2") return "v2";
    }
  } catch {
    // ignore
  }
  return "legacy";
};

const legacyEngine: LayoutEngine = {
  kind: "legacy",
  layout: ({ view, memo, options, paginationKey }): LayoutEngineOutcome => {
    const transaction = runPaginationEngine(view, memo, options, paginationKey);
    return { transaction, kind: "legacy" };
  }
};

const v2Engine: LayoutEngine = {
  kind: "v2",
  layout: ({ view, pageSetup }): LayoutEngineOutcome => {
    const layout = layoutDocumentV2({ doc: view.state.doc, setup: pageSetup });
    renderLayoutResult(layout);
    return { layout, transaction: null, kind: "v2" };
  }
};

export const getLayoutEngine = (flags?: Partial<LayoutEngineFeatureFlags>): LayoutEngine => {
  const kind = pickEngineKind(flags);
  return kind === "v2" ? v2Engine : legacyEngine;
};
