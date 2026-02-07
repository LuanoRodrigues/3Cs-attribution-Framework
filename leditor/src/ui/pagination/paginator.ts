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

type PageRange = {
  start: number;
  end: number;
};

export class Paginator {
  private spec = getDocumentLayoutSpec();
  private pageableSelectors: string[];
  private breakSelectors: string[];
  private sectionBreakSelectors: string[];
  private inlineSplitSelectors: string[];
  private inlineSplitEnabled: boolean;

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
    const inlineSelectors = inlineSplit.eligibleSelectors;
    if (!inlineSelectors || inlineSelectors.length === 0) {
      throw new Error("Paginator requires inline split selectors.");
    }
    this.pageableSelectors = Array.from(pageable);
    this.breakSelectors = Array.from(breaks);
    this.sectionBreakSelectors = Array.from(sectionBreaks);
    this.inlineSplitSelectors = Array.from(inlineSelectors);
    this.inlineSplitEnabled = inlineSplit.enabled;
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

    let cursor = 0;
    let pageIndex = 0;
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
      const range = this.findPageRange(
        blocks,
        cursor,
        content,
        metrics.contentHeightPx,
        metrics.tolerancePx
      );
      const pageElement = content.closest<HTMLElement>(".leditor-page");
      if (!pageElement) {
        throw new Error("Paginator requires a page element for section metadata.");
      }
      this.applySectionMetadata(pageElement, currentSectionId, currentSectionMeta);
      if (range.end <= range.start) {
        const block = blocks[cursor];
        const split = this.applyInlineSplit(block, content, metrics.contentHeightPx, metrics.tolerancePx);
        blocks[cursor] = split.head;
        blocks.splice(cursor + 1, 0, split.tail);
        content.appendChild(split.head);
        cursor += 1;
      } else {
        content.append(...blocks.slice(range.start, range.end));
        cursor = range.end;
      }
      const lastBlock = blocks[cursor - 1] ?? null;
      if (lastBlock && this.isSectionBreak(lastBlock)) {
        const meta = parseSectionMeta(lastBlock.dataset.sectionSettings);
        currentSectionMeta = meta;
        currentSectionId = allocateSectionId();
      }
      usedPages.push(content);
      pageIndex = this.applyParityPadding(pageIndex, lastBlock, usedPages);
      pageIndex += 1;
    }

    this.options.pageHost.ensurePageCount(Math.max(1, usedPages.length));
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

    let cursor = startIndex;
    let targetPageIndex = pageIndex;
    const usedPages: HTMLElement[] = [];
    while (cursor < blocks.length) {
      this.options.pageHost.ensurePageCount(targetPageIndex + 1);
      const pageContents = this.options.pageHost.getPageContents();
      const content = pageContents[targetPageIndex];
      if (!content) {
        throw new Error(`Missing page content for index ${targetPageIndex}.`);
      }
      content.replaceChildren();
      const metrics = derivePageMetrics({
        page: content.closest(".leditor-page") as HTMLElement,
        pageContent: content,
        pageStack: this.options.pageStack
      });
      const range = this.findPageRange(
        blocks,
        cursor,
        content,
        metrics.contentHeightPx,
        metrics.tolerancePx
      );
      const pageElement = content.closest<HTMLElement>(".leditor-page");
      if (!pageElement) {
        throw new Error("Paginator requires a page element for section metadata.");
      }
      this.applySectionMetadata(pageElement, currentSectionId, currentSectionMeta);
      if (range.end <= range.start) {
        const block = blocks[cursor];
        const split = this.applyInlineSplit(block, content, metrics.contentHeightPx, metrics.tolerancePx);
        blocks[cursor] = split.head;
        blocks.splice(cursor + 1, 0, split.tail);
        content.appendChild(split.head);
        cursor += 1;
      } else {
        content.append(...blocks.slice(range.start, range.end));
        cursor = range.end;
      }
      const lastBlock = blocks[cursor - 1] ?? null;
      if (lastBlock && this.isSectionBreak(lastBlock)) {
        const meta = parseSectionMeta(lastBlock.dataset.sectionSettings);
        currentSectionMeta = meta;
        currentSectionId = allocateSectionId();
      }
      usedPages.push(content);
      targetPageIndex = this.applyParityPadding(targetPageIndex, lastBlock, usedPages);
      targetPageIndex += 1;
    }

    this.options.pageHost.ensurePageCount(Math.max(1, targetPageIndex));
    this.notifyPageCount();
    restoreSelectionBookmark(this.options.root, bookmark);
  }

  private notifyPageCount(): void {
    if (this.options.onPageCountChange) {
      this.options.onPageCountChange(this.options.pageHost.getPageContents().length);
    }
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

  private findPageRange(
    blocks: HTMLElement[],
    start: number,
    pageContent: HTMLElement,
    contentHeightPx: number,
    tolerancePx: number
  ): PageRange {
    const breakIndex = this.findManualOrSectionBreak(blocks, start);
    const limit = breakIndex >= 0 ? breakIndex + 1 : blocks.length;
    const canFit = (end: number): boolean => {
      pageContent.replaceChildren(...blocks.slice(start, end));
      const height = pageContent.scrollHeight;
      return height <= contentHeightPx + tolerancePx;
    };

    let low = start;
    let high = limit;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (canFit(mid)) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const fitEnd = low;
    if (breakIndex >= 0 && fitEnd < breakIndex + 1) {
      return { start, end: Math.max(start, fitEnd) };
    }
    if (breakIndex >= 0) {
      const finalEnd = Math.max(start + 1, breakIndex + 1);
      return { start, end: finalEnd };
    }
    return { start, end: Math.max(start, fitEnd) };
  }

  private findManualOrSectionBreak(blocks: HTMLElement[], start: number): number {
    for (let i = start; i < blocks.length; i += 1) {
      if (this.isManualBreak(blocks[i]) || this.isForcedSectionBreak(blocks[i])) {
        return i;
      }
    }
    return -1;
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

  private applyInlineSplit(
    block: HTMLElement,
    pageContent: HTMLElement,
    contentHeightPx: number,
    tolerancePx: number
  ): InlineSplitResult {
    if (!this.inlineSplitEnabled) {
      throw new Error("Inline split is disabled in spec.");
    }
    if (!this.isInlineSplitEligible(block)) {
      throw new Error("Block is not eligible for inline split.");
    }
    return splitBlockInline({
      block,
      pageContent,
      contentHeightPx,
      tolerancePx,
      preferWordBoundary: true
    });
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
