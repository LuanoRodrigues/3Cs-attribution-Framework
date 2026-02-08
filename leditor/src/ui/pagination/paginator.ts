import { getDocumentLayoutSpec } from "./document_layout_state.ts";
import type { PageHost } from "./page_host.ts";
import { derivePageMetrics, type PageMetrics } from "./page_metrics.ts";
import { saveSelectionBookmark, restoreSelectionBookmark, type SelectionBookmark } from "./selection_bookmark.ts";
import { splitBlockInline, type InlineSplitResult } from "./inline_split.ts";
import { allocateSectionId, parseSectionMeta, type SectionMeta } from "../../editor/section_state";

type PaginatorOptions = {
  root: HTMLElement;
  pageHost: PageHost;
  pageStack: HTMLElement;
  onPageCountChange?: (count: number) => void;
};

type BuiltPage = {
  nextCursor: number;
  lastConsumed: HTMLElement | null;
  endedByHardBreak: boolean;
};

export class Paginator {
  private spec = getDocumentLayoutSpec();
  private pageableSelectors: string[];
  private breakSelectors: string[];
  private sectionBreakSelectors: string[];
  private inlineSplitSelectors: string[];
  private headingSelectors: string[];
  private atomicSelectors: string[];

  private inlineSplitEnabled: boolean;
  private widowsMinLines: number;
  private orphansMinLines: number;
  private headingKeepWithNext: boolean;
  private headingMinNextLines: number;

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

    const headingSelectors = this.spec.pagination?.blockPagination?.headingSelectors;
    if (!headingSelectors || headingSelectors.length === 0) {
      throw new Error("Paginator requires heading selectors.");
    }
    const atomicSelectors = this.spec.pagination?.blockPagination?.atomicSelectors;
    if (!atomicSelectors || atomicSelectors.length === 0) {
      throw new Error("Paginator requires atomic selectors.");
    }

    const inlineSplit = this.spec.pagination?.inlineSplit;
    if (!inlineSplit) {
      throw new Error("Paginator requires inline split configuration.");
    }
    const inlineSelectors = inlineSplit.eligibleSelectors;
    if (!inlineSelectors || inlineSelectors.length === 0) {
      throw new Error("Paginator requires inline split selectors.");
    }
    if (!Number.isFinite(inlineSplit.widowsMinLines) || inlineSplit.widowsMinLines < 1) {
      throw new Error("Paginator requires inlineSplit.widowsMinLines >= 1.");
    }
    if (!Number.isFinite(inlineSplit.orphansMinLines) || inlineSplit.orphansMinLines < 1) {
      throw new Error("Paginator requires inlineSplit.orphansMinLines >= 1.");
    }

    this.pageableSelectors = Array.from(pageable);
    this.breakSelectors = Array.from(breaks);
    this.sectionBreakSelectors = Array.from(sectionBreaks);
    this.inlineSplitSelectors = Array.from(inlineSelectors);
    this.headingSelectors = Array.from(headingSelectors);
    this.atomicSelectors = Array.from(atomicSelectors);

    this.inlineSplitEnabled = inlineSplit.enabled;
    this.widowsMinLines = inlineSplit.widowsMinLines;
    this.orphansMinLines = inlineSplit.orphansMinLines;
    this.headingKeepWithNext = Boolean(inlineSplit.headingKeepWithNext);
    this.headingMinNextLines = inlineSplit.headingMinNextLines ?? 1;
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
      const content = this.options.pageHost.getPageContents()[pageIndex];
      if (!content) {
        throw new Error(`Missing page content for index ${pageIndex}.`);
      }
      content.replaceChildren();
      const pageElement = content.closest<HTMLElement>(".leditor-page");
      if (!pageElement) {
        throw new Error("Paginator requires a page element.");
      }

      const metrics = derivePageMetrics({
        page: pageElement,
        pageContent: content,
        pageStack: this.options.pageStack
      });
      const maxLines = this.computeMaxLines(metrics);

      this.applySectionMetadata(pageElement, currentSectionId, currentSectionMeta);

      const built = this.buildPage({
        blocks,
        startCursor: cursor,
        pageContent: content,
        metrics,
        maxLines,
        bookmark
      });

      cursor = built.nextCursor;

      const lastBlock = built.lastConsumed;
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
    const startPageIndex = this.findPageIndexForBlock(dirtyBlock);
    if (startPageIndex < 0) {
      throw new Error("Dirty block page index not found.");
    }

    blocks.slice(startIndex).forEach((block) => block.remove());
    this.clearPagesFromIndex(startPageIndex);

    let cursor = startIndex;
    let pageIndex = startPageIndex;
    const usedPages: HTMLElement[] = [];
    while (cursor < blocks.length) {
      this.options.pageHost.ensurePageCount(pageIndex + 1);
      const content = this.options.pageHost.getPageContents()[pageIndex];
      if (!content) {
        throw new Error(`Missing page content for index ${pageIndex}.`);
      }
      content.replaceChildren();
      const pageElement = content.closest<HTMLElement>(".leditor-page");
      if (!pageElement) {
        throw new Error("Paginator requires a page element.");
      }

      const metrics = derivePageMetrics({
        page: pageElement,
        pageContent: content,
        pageStack: this.options.pageStack
      });
      const maxLines = this.computeMaxLines(metrics);

      this.applySectionMetadata(pageElement, currentSectionId, currentSectionMeta);

      const built = this.buildPage({
        blocks,
        startCursor: cursor,
        pageContent: content,
        metrics,
        maxLines,
        bookmark
      });

      cursor = built.nextCursor;

      const lastBlock = built.lastConsumed;
      if (lastBlock && this.isSectionBreak(lastBlock)) {
        const meta = parseSectionMeta(lastBlock.dataset.sectionSettings);
        currentSectionMeta = meta;
        currentSectionId = allocateSectionId();
      }

      usedPages.push(content);
      pageIndex = this.applyParityPadding(pageIndex, lastBlock, usedPages);
      pageIndex += 1;
    }

    this.options.pageHost.ensurePageCount(Math.max(1, pageIndex));
    this.notifyPageCount();
    restoreSelectionBookmark(this.options.root, bookmark);
  }

  private buildPage(args: {
    blocks: HTMLElement[];
    startCursor: number;
    pageContent: HTMLElement;
    metrics: PageMetrics;
    maxLines: number;
    bookmark: SelectionBookmark;
  }): BuiltPage {
    const { blocks, startCursor, pageContent, metrics, maxLines, bookmark } = args;

    let cursor = startCursor;
    let endedByHardBreak = false;

    while (cursor < blocks.length) {
      const block = blocks[cursor];

      if (this.isManualBreak(block) || this.isForcedSectionBreak(block)) {
        pageContent.appendChild(block);
        cursor += 1;
        endedByHardBreak = true;
        break;
      }

      pageContent.appendChild(block);
      if (this.fitsLineBudget(pageContent, metrics, maxLines)) {
        cursor += 1;
        continue;
      }
      block.remove();

      if (this.headingKeepWithNext && this.isHeading(block) && pageContent.children.length > 0) {
        break;
      }

      if (this.isAtomic(block)) {
        if (pageContent.children.length === 0) {
          pageContent.appendChild(block);
          cursor += 1;
        }
        break;
      }

      if (this.inlineSplitEnabled && this.isInlineSplitEligible(block)) {
        const usedLines = this.computeUsedLines(pageContent, metrics);
        const remainingLines = maxLines - usedLines;
        const minHead = pageContent.children.length === 0 ? 1 : this.orphansMinLines;
        const minTail = pageContent.children.length === 0 ? 1 : this.widowsMinLines;

        if (remainingLines < minHead && pageContent.children.length > 0) {
          break;
        }

        const split = this.applyInlineSplit(block, pageContent, metrics, maxLines, minHead, minTail);
        if (!split) {
          if (pageContent.children.length === 0) {
            pageContent.appendChild(block);
            cursor += 1;
          }
          break;
        }

        this.applySplitNodeIdsAndRemapBookmark(bookmark, block, split);
        blocks[cursor] = split.head;
        blocks.splice(cursor + 1, 0, split.tail);

        pageContent.appendChild(split.head);
        cursor += 1;
        break;
      }

      if (pageContent.children.length === 0) {
        pageContent.appendChild(block);
        cursor += 1;
      }
      break;
    }

    if (this.headingKeepWithNext && !endedByHardBreak && cursor < blocks.length) {
      const last = pageContent.lastElementChild as HTMLElement | null;
      if (last && this.isHeading(last)) {
        last.remove();
        cursor -= 1;
        if (pageContent.children.length === 0) {
          pageContent.appendChild(last);
          cursor += 1;
        }
      }
    }

    const lastConsumed = pageContent.lastElementChild as HTMLElement | null;
    return { nextCursor: cursor, lastConsumed, endedByHardBreak };
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
    return this.pageableSelectors.some((selector) => node.matches(selector));
  }

  private isManualBreak(node: HTMLElement): boolean {
    return this.breakSelectors.some((selector) => node.matches(selector));
  }

  private isSectionBreak(node: HTMLElement): boolean {
    return this.sectionBreakSelectors.some((selector) => node.matches(selector));
  }

  private isHeading(node: HTMLElement): boolean {
    return this.headingSelectors.some((selector) => node.matches(selector));
  }

  private isAtomic(node: HTMLElement): boolean {
    return this.atomicSelectors.some((selector) => node.matches(selector));
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

  private computeMaxLines(metrics: PageMetrics): number {
    const available = metrics.contentHeightPx - metrics.paddingBottomPx + metrics.tolerancePx;
    if (!Number.isFinite(available) || available <= 0) {
      throw new Error("Page has non-positive available height for line budgeting.");
    }
    const maxLines = Math.floor(available / metrics.lineHeightPx);
    return Math.max(1, maxLines);
  }

  private computeUsedLines(pageContent: HTMLElement, metrics: PageMetrics): number {
    const rawHeight = pageContent.scrollHeight - metrics.paddingBottomPx;
    if (!Number.isFinite(rawHeight) || rawHeight <= 0) return 0;
    return Math.ceil(rawHeight / metrics.lineHeightPx);
  }

  private fitsLineBudget(pageContent: HTMLElement, metrics: PageMetrics, maxLines: number): boolean {
    return this.computeUsedLines(pageContent, metrics) <= maxLines;
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
    metrics: PageMetrics,
    maxLines: number,
    minHeadLines: number,
    minTailLines: number
  ): InlineSplitResult | null {
    if (!this.inlineSplitEnabled) {
      throw new Error("Inline split is disabled in spec.");
    }
    if (!this.isInlineSplitEligible(block)) {
      throw new Error("Block is not eligible for inline split.");
    }
    return splitBlockInline({
      block,
      pageContent,
      maxLines,
      lineHeightPx: metrics.lineHeightPx,
      paddingBottomPx: metrics.paddingBottomPx,
      preferWordBoundary: true,
      orphansMinLines: minHeadLines,
      widowsMinLines: minTailLines
    });
  }

  private getNodePath(base: Node, target: Node): number[] {
    const path: number[] = [];
    let current: Node | null = target;
    while (current && current !== base) {
      const parent: ParentNode | null = current.parentNode;
      if (!parent) {
        throw new Error("Selection path cannot be resolved to base node.");
      }
      const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
      if (index < 0) {
        throw new Error("Selection node index not found.");
      }
      path.push(index);
      current = parent as Node;
    }
    if (current !== base) {
      throw new Error("Selection path base mismatch.");
    }
    return path.reverse();
  }

  private resolveNodePath(base: Node, path: number[]): Node {
    let current: Node = base;
    for (const index of path) {
      const child = current.childNodes[index];
      if (!child) {
        throw new Error("Selection path resolution failed.");
      }
      current = child;
    }
    return current;
  }

  private getTextNodes(root: HTMLElement): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
    return nodes;
  }

  private computeAbsoluteTextOffset(base: HTMLElement, locator: { path: number[]; offset: number }): number {
    const node = this.resolveNodePath(base, locator.path);
    if (node.nodeType !== Node.TEXT_NODE) {
      throw new Error("Selection remap requires a Text node container.");
    }
    const nodes = this.getTextNodes(base);
    let total = 0;
    for (const textNode of nodes) {
      if (textNode === node) {
        const value = textNode.nodeValue ?? "";
        if (locator.offset < 0 || locator.offset > value.length) {
          throw new Error("Selection offset is out of bounds.");
        }
        return total + locator.offset;
      }
      total += (textNode.nodeValue ?? "").length;
    }
    throw new Error("Selection remap text node not found.");
  }

  private locateTextOffset(base: HTMLElement, absoluteIndex: number): { path: number[]; offset: number } {
    const nodes = this.getTextNodes(base);
    let remaining = absoluteIndex;
    for (const textNode of nodes) {
      const value = textNode.nodeValue ?? "";
      if (remaining <= value.length) {
        return { path: this.getNodePath(base, textNode), offset: remaining };
      }
      remaining -= value.length;
    }
    throw new Error("Selection remap absolute index is out of bounds.");
  }

  private applySplitNodeIdsAndRemapBookmark(
    bookmark: SelectionBookmark,
    originalBlock: HTMLElement,
    split: InlineSplitResult
  ): void {
    const originalId = (originalBlock.dataset.leditorNodeId || "").trim();
    if (!originalId) {
      return;
    }

    const tailId = `${originalId}:cont:${split.splitIndex}`;
    split.head.dataset.leditorNodeId = originalId;
    split.tail.dataset.leditorNodeId = tailId;

    const remapLocator = (locator: { nodeId: string | null; path: number[]; offset: number }): void => {
      if (locator.nodeId !== originalId) return;

      const abs = this.computeAbsoluteTextOffset(originalBlock, locator);
      const inTail = abs >= split.splitIndex;
      const target = inTail ? split.tail : split.head;
      const targetIndex = inTail ? abs - split.splitIndex : abs;
      const mapped = this.locateTextOffset(target, targetIndex);

      locator.nodeId = inTail ? tailId : originalId;
      locator.path = mapped.path;
      locator.offset = mapped.offset;
    };

    remapLocator(bookmark.anchor);
    remapLocator(bookmark.focus);
  }

  private applySectionMetadata(page: HTMLElement, sectionId: string, meta: SectionMeta): void {
    page.dataset.sectionId = sectionId;
    page.dataset.sectionSettings = JSON.stringify(meta);
  }
}

export type { PaginatorOptions };
