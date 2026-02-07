import { getDocumentLayoutSpec } from "./document_layout_state.ts";
import type { PageHost } from "./page_host.ts";
import { derivePageMetrics } from "./page_metrics.ts";
import { saveSelectionBookmark, restoreSelectionBookmark } from "./selection_bookmark.ts";
import { splitBlockInline, type InlineSplitResult } from "./inline_split.ts";
import { allocateSectionId, parseSectionMeta, type SectionMeta } from "../../editor/section_state";

type PaginatorOptions = {
  root: HTMLElement;
  pageHost: PageHost;
  pageStack: HTMLElement;
  onPageCountChange?: (count: number) => void;
};

export class Paginator {
  private spec = getDocumentLayoutSpec();
  private pageableSelectors: string[];
  private breakSelectors: string[];
  private sectionBreakSelectors: string[];
  private inlineSplitSelectors: string[];
  private inlineSplitEnabled: boolean;
  private headingSelectors: string[];
  private atomicSelectors: string[];
  private flowRules: NonNullable<ReturnType<typeof getDocumentLayoutSpec>["pagination"]>["flowRules"];

  constructor(private options: PaginatorOptions) {
    if (!options.root) {
      throw new Error("Paginator requires a root element.");
    }
    if (!options.pageHost) {
      throw new Error("Paginator requires a PageHost.");
    }
    const pageable = this.spec.pagination?.blockPagination?.pageableBlockSelectors;
    if (!pageable || pageable.length === 0) {
      throw new Error("Paginator requires pageable block selectors.");
    }
    const breaks = this.spec.domPageBreaks?.breakNodeSelectors;
    if (!breaks || breaks.length === 0) {
      throw new Error("Paginator requires break node selectors.");
    }
    const sectionBreaks = this.spec.domPageBreaks?.sectionBreakSelectors;
    if (!sectionBreaks || sectionBreaks.length === 0) {
      throw new Error("Paginator requires section break selectors.");
    }
    const inlineSplit = this.spec.pagination?.inlineSplit;
    if (!inlineSplit) {
      throw new Error("Paginator requires inline split configuration.");
    }
    const flowRules = this.spec.pagination?.flowRules;
    if (!flowRules) {
      throw new Error("Paginator requires pagination flow rules.");
    }
    const inlineSelectors = inlineSplit.eligibleSelectors;
    if (!inlineSelectors || inlineSelectors.length === 0) {
      throw new Error("Paginator requires inline split selectors.");
    }
    const blockPagination = this.spec.pagination?.blockPagination;
    if (!blockPagination) {
      throw new Error("Paginator requires block pagination configuration.");
    }
    const headingSelectors = blockPagination.headingSelectors;
    if (!headingSelectors || headingSelectors.length === 0) {
      throw new Error("Paginator requires heading selectors.");
    }
    const atomicSelectors = blockPagination.atomicSelectors;
    if (!atomicSelectors || atomicSelectors.length === 0) {
      throw new Error("Paginator requires atomic selectors.");
    }
    this.pageableSelectors = Array.from(pageable);
    this.breakSelectors = Array.from(breaks);
    this.sectionBreakSelectors = Array.from(sectionBreaks);
    this.inlineSplitSelectors = Array.from(inlineSelectors);
    this.inlineSplitEnabled = inlineSplit.enabled;
    this.headingSelectors = Array.from(headingSelectors);
    this.atomicSelectors = Array.from(atomicSelectors);
    this.flowRules = flowRules;
  }

  paginate(): void {
    const bookmark = saveSelectionBookmark(this.options.root);
    let currentSectionId = allocateSectionId();
    let currentSectionMeta: SectionMeta = parseSectionMeta();
    const blocks = this.collectBlocks();
    if (blocks.length === 0) {
      this.options.pageHost.ensurePageCount(1);
      const content = this.options.pageHost.getPageContents()[0];
      content.replaceChildren();
      this.notifyPageCount();
      restoreSelectionBookmark(this.options.root, bookmark);
      return;
    }

    blocks.forEach((block) => block.remove());
    this.clearPagesFromIndex(0);
    const result = this.paginateBlocks(blocks, 0, 0, currentSectionId, currentSectionMeta);
    this.options.pageHost.ensurePageCount(Math.max(1, result.usedPages.length));
    this.notifyPageCount();
    restoreSelectionBookmark(this.options.root, bookmark);
  }

  paginateFrom(dirtyBlock: HTMLElement): void {
    const bookmark = saveSelectionBookmark(this.options.root);
    let currentSectionId = allocateSectionId();
    let currentSectionMeta: SectionMeta = parseSectionMeta();
    const blocks = this.collectBlocks();
    const startIndex = blocks.indexOf(dirtyBlock);
    if (startIndex < 0) {
      throw new Error("Dirty block not found during pagination.");
    }
    const pageIndex = this.findPageIndexForBlock(dirtyBlock);
    if (pageIndex < 0) {
      throw new Error("Dirty block page index not found.");
    }
    blocks.slice(startIndex).forEach((block) => block.remove());
    this.clearPagesFromIndex(pageIndex);
    const result = this.paginateBlocks(blocks, startIndex, pageIndex, currentSectionId, currentSectionMeta);
    this.options.pageHost.ensurePageCount(Math.max(1, result.nextPageIndex));
    this.notifyPageCount();
    restoreSelectionBookmark(this.options.root, bookmark);
  }

  private notifyPageCount(): void {
    if (this.options.onPageCountChange) {
      this.options.onPageCountChange(this.options.pageHost.getPageContents().length);
    }
  }

  private paginateBlocks(
    blocks: HTMLElement[],
    startIndex: number,
    startPageIndex: number,
    currentSectionId: string,
    currentSectionMeta: SectionMeta
  ): {
    usedPages: HTMLElement[];
    nextPageIndex: number;
    currentSectionId: string;
    currentSectionMeta: SectionMeta;
  } {
    let cursor = startIndex;
    let pageIndex = startPageIndex;
    const usedPages: HTMLElement[] = [];

    while (cursor < blocks.length) {
      this.options.pageHost.ensurePageCount(pageIndex + 1);
      const pageContents = this.options.pageHost.getPageContents();
      const content = pageContents[pageIndex];
      if (!content) {
        throw new Error(`Missing page content for index ${pageIndex}.`);
      }
      content.replaceChildren();
      const metrics = derivePageMetrics({
        page: content.closest(".leditor-page") as HTMLElement,
        pageContent: content,
        pageStack: this.options.pageStack
      });
      const maxLines = this.computeMaxLines(metrics);
      const pageElement = content.closest<HTMLElement>(".leditor-page");
      if (!pageElement) {
        throw new Error("Paginator requires a page element for section metadata.");
      }
      this.applySectionMetadata(pageElement, currentSectionId, currentSectionMeta);

      let usedLines = 0;
      let pageHasContent = false;
      let pageEndedByHardBreak = false;
      let lastConsumedIndex = -1;
      let lastConsumedBlock: HTMLElement | null = null;

      while (cursor < blocks.length) {
        const block = blocks[cursor];

        if (this.isManualBreak(block) || this.isForcedSectionBreak(block)) {
          content.appendChild(block);
          lastConsumedIndex = cursor;
          lastConsumedBlock = block;
          cursor += 1;
          pageHasContent = true;
          pageEndedByHardBreak = true;
          break;
        }

        content.appendChild(block);
        const usedAfter = this.computeUsedLines(content, metrics);
        if (usedAfter <= maxLines) {
          usedLines = usedAfter;
          pageHasContent = true;
          lastConsumedIndex = cursor;
          lastConsumedBlock = block;
          cursor += 1;

          if (
            this.flowRules.headingKeepWithNext &&
            this.isHeading(block) &&
            cursor < blocks.length
          ) {
            const nextBlock = blocks[cursor];
            const remainingLines = maxLines - usedLines;
            if (
              remainingLines < this.flowRules.headingMinNextLines &&
              !this.isManualBreak(nextBlock) &&
              !this.isForcedSectionBreak(nextBlock)
            ) {
              content.removeChild(block);
              cursor -= 1;
              usedLines = this.computeUsedLines(content, metrics);
              pageHasContent = content.children.length > 0;
              lastConsumedBlock = pageHasContent
                ? (content.lastElementChild as HTMLElement | null)
                : null;
              lastConsumedIndex = pageHasContent ? cursor - 1 : -1;
              break;
            }
          }
          continue;
        }

        content.removeChild(block);

        if (this.isHeading(block)) {
          if (!pageHasContent) {
            content.appendChild(block);
            usedLines = this.computeUsedLines(content, metrics);
            pageHasContent = true;
            lastConsumedIndex = cursor;
            lastConsumedBlock = block;
            cursor += 1;
          }
          break;
        }

        if (this.isAtomic(block)) {
          if (!pageHasContent) {
            content.appendChild(block);
            usedLines = this.computeUsedLines(content, metrics);
            pageHasContent = true;
            lastConsumedIndex = cursor;
            lastConsumedBlock = block;
            cursor += 1;
          }
          break;
        }

        if (this.inlineSplitEnabled && this.isInlineSplitEligible(block)) {
          if (pageHasContent) {
            const remainingLines = maxLines - usedLines;
            if (remainingLines >= this.flowRules.orphansMinLines) {
              const split = this.tryInlineSplit(
                block,
                content,
                metrics,
                usedLines,
                maxLines,
                "append",
                this.flowRules.orphansMinLines
              );
              if (split) {
                blocks[cursor] = split.head;
                blocks.splice(cursor + 1, 0, split.tail);
                content.appendChild(split.head);
                usedLines = this.computeUsedLines(content, metrics);
                pageHasContent = true;
                lastConsumedIndex = cursor;
                lastConsumedBlock = split.head;
                cursor += 1;
              }
            }
            break;
          }

          const relaxedMinHeadLines = Math.max(1, Math.min(this.flowRules.orphansMinLines, maxLines));
          const split = this.tryInlineSplit(
            block,
            content,
            metrics,
            0,
            maxLines,
            "replace",
            relaxedMinHeadLines
          );
          if (split) {
            blocks[cursor] = split.head;
            blocks.splice(cursor + 1, 0, split.tail);
            content.appendChild(split.head);
            usedLines = this.computeUsedLines(content, metrics);
            pageHasContent = true;
            lastConsumedIndex = cursor;
            lastConsumedBlock = split.head;
            cursor += 1;
          } else {
            content.appendChild(block);
            usedLines = this.computeUsedLines(content, metrics);
            pageHasContent = true;
            lastConsumedIndex = cursor;
            lastConsumedBlock = block;
            cursor += 1;
          }
          break;
        }

        if (!pageHasContent) {
          content.appendChild(block);
          usedLines = this.computeUsedLines(content, metrics);
          pageHasContent = true;
          lastConsumedIndex = cursor;
          lastConsumedBlock = block;
          cursor += 1;
        }
        break;
      }

      if (this.flowRules.headingKeepWithNext && !pageEndedByHardBreak && cursor < blocks.length) {
        const nextBlock = blocks[cursor];
        if (!this.isManualBreak(nextBlock) && !this.isForcedSectionBreak(nextBlock)) {
          const lastNonBreak = this.getLastNonBreakChild(content);
          if (lastNonBreak && this.isHeading(lastNonBreak)) {
            if (content.children.length > 1 && lastConsumedIndex >= 0) {
              content.removeChild(lastNonBreak);
              cursor = lastConsumedIndex;
              lastConsumedIndex = cursor - 1;
              lastConsumedBlock = content.lastElementChild as HTMLElement | null;
            }
          }
        }
      }

      if (lastConsumedBlock && this.isSectionBreak(lastConsumedBlock)) {
        const meta = parseSectionMeta(lastConsumedBlock.dataset.sectionSettings);
        currentSectionMeta = meta;
        currentSectionId = allocateSectionId();
      }
      usedPages.push(content);
      pageIndex = this.applyParityPadding(pageIndex, lastConsumedBlock, usedPages);
      pageIndex += 1;
    }

    return { usedPages, nextPageIndex: pageIndex, currentSectionId, currentSectionMeta };
  }

  private collectBlocks(): HTMLElement[] {
    const pageContents = this.options.pageHost.getPageContents();
    const candidates: HTMLElement[] = [];
    pageContents.forEach((content) => {
      candidates.push(
        ...Array.from(content.children).filter(
          (node): node is HTMLElement => node instanceof HTMLElement
        )
      );
    });
    if (candidates.length === 0) {
      candidates.push(
        ...Array.from(this.options.root.children).filter(
          (node): node is HTMLElement => node instanceof HTMLElement
        )
      );
    }
    const nonPageable = candidates.filter((node) => !this.isPageable(node));
    if (nonPageable.length > 0) {
      const sample = nonPageable[0];
      throw new Error(
        `Paginator encountered a non-pageable block: <${sample.tagName.toLowerCase()}>.`
      );
    }
    return candidates;
  }

  private clearPagesFromIndex(startIndex: number): void {
    const pages = this.options.pageHost.getPageContents();
    for (let i = startIndex; i < pages.length; i += 1) {
      pages[i].replaceChildren();
    }
  }

  private findPageIndexForBlock(block: HTMLElement): number {
    const content = block.closest(".leditor-page-content");
    if (!content) return -1;
    return this.options.pageHost.getPageContents().indexOf(content as HTMLElement);
  }

  private isPageable(node: HTMLElement): boolean {
    if (this.pageableSelectors.some((selector) => node.matches(selector))) {
      return true;
    }
    return false;
  }

  private isManualBreak(node: HTMLElement): boolean {
    return this.breakSelectors.some((selector) => node.matches(selector));
  }

  private isSectionBreak(node: HTMLElement): boolean {
    return this.sectionBreakSelectors.some((selector) => node.matches(selector));
  }

  private getSectionBreakKind(node: HTMLElement): string | null {
    if (!this.isSectionBreak(node)) return null;
    const explicit = node.getAttribute("data-kind") || node.dataset.kind || null;
    if (explicit) return explicit;
    const breakKind = node.getAttribute("data-break-kind") || node.dataset.breakKind || null;
    if (!breakKind) return null;
    const normalized = breakKind.trim().toLowerCase();
    if (normalized === "section_next") return "nextPage";
    if (normalized === "section_even") return "evenPage";
    if (normalized === "section_odd") return "oddPage";
    if (normalized === "section_continuous") return "continuous";
    return null;
  }

  private isForcedSectionBreak(node: HTMLElement): boolean {
    const kind = this.getSectionBreakKind(node);
    if (!kind) return false;
    return kind === "nextPage" || kind === "oddPage" || kind === "evenPage";
  }

  private isInlineSplitEligible(node: HTMLElement): boolean {
    return this.inlineSplitSelectors.some((selector) => node.matches(selector));
  }

  private isHeading(node: HTMLElement): boolean {
    return this.headingSelectors.some((selector) => node.matches(selector));
  }

  private isAtomic(node: HTMLElement): boolean {
    return this.atomicSelectors.some((selector) => node.matches(selector));
  }

  private computeMaxLines(metrics: ReturnType<typeof derivePageMetrics>): number {
    const lineHeightPx = metrics.lineHeightPx;
    if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
      throw new Error("Paginator requires a positive line height.");
    }
    const raw = (metrics.contentHeightPx - metrics.paddingBottomPx + metrics.tolerancePx) / lineHeightPx;
    if (!Number.isFinite(raw)) {
      throw new Error("Paginator failed to compute max lines.");
    }
    return Math.max(0, Math.floor(raw));
  }

  private computeUsedLines(
    pageContent: HTMLElement,
    metrics: ReturnType<typeof derivePageMetrics>
  ): number {
    const lineHeightPx = metrics.lineHeightPx;
    if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
      throw new Error("Paginator requires a positive line height.");
    }
    const raw = (pageContent.scrollHeight - metrics.paddingBottomPx) / lineHeightPx;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.ceil(raw));
  }

  private getLastNonBreakChild(content: HTMLElement): HTMLElement | null {
    const children = Array.from(content.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement
    );
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (!this.isManualBreak(child) && !this.isSectionBreak(child)) {
        return child;
      }
    }
    return null;
  }

  private applyParityPadding(
    pageIndex: number,
    lastBlock: HTMLElement | null,
    usedPages: HTMLElement[]
  ): number {
    if (!lastBlock || !this.isForcedSectionBreak(lastBlock)) {
      return pageIndex;
    }
    const kind = this.getSectionBreakKind(lastBlock);
    if (!kind || kind === "nextPage") {
      return pageIndex;
    }
    const nextPageNumber = pageIndex + 2;
    const needsOdd = kind === "oddPage";
    const needsEven = kind === "evenPage";
    if ((needsOdd && nextPageNumber % 2 === 1) || (needsEven && nextPageNumber % 2 === 0)) {
      return pageIndex;
    }
    const blankIndex = pageIndex + 1;
    this.options.pageHost.ensurePageCount(blankIndex + 1);
    const blankContent = this.options.pageHost.getPageContents()[blankIndex];
    if (!blankContent) {
      throw new Error("Parity padding requires a blank page content.");
    }
    blankContent.replaceChildren();
    usedPages.push(blankContent);
    return blankIndex;
  }

  private tryInlineSplit(
    block: HTMLElement,
    pageContent: HTMLElement,
    metrics: ReturnType<typeof derivePageMetrics>,
    usedLinesBefore: number,
    maxLines: number,
    measureMode: "replace" | "append",
    minHeadLines: number
  ): InlineSplitResult | null {
    if (!this.inlineSplitEnabled) {
      return null;
    }
    if (!this.isInlineSplitEligible(block)) {
      return null;
    }
    try {
      return splitBlockInline({
        block,
        pageContent,
        lineHeightPx: metrics.lineHeightPx,
        paddingBottomPx: metrics.paddingBottomPx,
        maxLines,
        usedLinesBefore,
        minHeadLines,
        minTailLines: this.flowRules.widowsMinLines,
        preferWordBoundary: true,
        measureMode
      });
    } catch {
      return null;
    }
  }

  private applySectionMetadata(
    page: HTMLElement,
    sectionId: string,
    meta: SectionMeta
  ): void {
    page.dataset.sectionId = sectionId;
    page.dataset.sectionSettings = JSON.stringify(meta);
  }
}

export type { PaginatorOptions };
