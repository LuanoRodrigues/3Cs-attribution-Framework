import { documentLayoutSpec } from "../pagination/layout_spec.ts";

export type PaginationPolicy = {
  selectors: {
    pageable: string[];
    hardBreaks: string[];
    sectionBreaks: string[];
    headings: string[];
    atomic: string[];
    paragraphs: string[];
  };
  numeric: {
    widowsMinLines: number;
    orphansMinLines: number;
    headingKeepWithNext: boolean;
    headingMinNextLines: number;
    tolerancePx: number;
  };
  headerFooter: {
    reserveSpaceInContentBox: boolean;
  };
  footnotes: {
    gapDefaultIn: number;
    maxHeightRatioDefault: number;
  };
};

export const getPaginationPolicy = (): PaginationPolicy => {
  const spec = documentLayoutSpec;
  const pagination = spec.pagination ?? {};
  const flowRules = pagination.flowRules ?? pagination.inlineSplit ?? {};
  const block = pagination.blockPagination ?? {};
  return {
    selectors: {
      pageable: [...(block.pageableBlockSelectors ?? [])],
      hardBreaks: [...(spec.domPageBreaks?.breakNodeSelectors ?? [])],
      sectionBreaks: [...(spec.domPageBreaks?.sectionBreakSelectors ?? [])],
      headings: [...(block.headingSelectors ?? [])],
      atomic: [...(block.atomicSelectors ?? [])],
      paragraphs: ["p", "li", "blockquote"]
    },
    numeric: {
      widowsMinLines: flowRules.widowsMinLines ?? 2,
      orphansMinLines: flowRules.orphansMinLines ?? 2,
      headingKeepWithNext: flowRules.headingKeepWithNext ?? true,
      headingMinNextLines: flowRules.headingMinNextLines ?? 1,
      tolerancePx: pagination.measurement?.tolerancePx ?? 1
    },
    headerFooter: {
      reserveSpaceInContentBox:
        spec.headerFooter?.contentFlowPolicy?.reserveSpaceInContentBox ?? false
    },
    footnotes: {
      gapDefaultIn: spec.footnotes?.gapDefaultIn ?? 0.125,
      maxHeightRatioDefault: spec.footnotes?.maxHeightRatioDefault ?? 0.35
    }
  };
};
