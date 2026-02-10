import type { LayoutBlock, LayoutLine, LayoutPage, LayoutResult, PageSetup } from "../types.ts";
import { computeFramesPx } from "./page-setup.ts";

export type PaginatorInput = {
  blocks: LayoutBlock[];
  setup: PageSetup;
};

const DEFAULT_WIDOW_LINES = 2;
const DEFAULT_ORPHAN_LINES = 2;
const LINE_EPSILON = 0.01;

const cloneLines = (lines: LayoutLine[], offsetY: number, idPrefix: string): LayoutLine[] =>
  lines.map((line, lineIndex) => {
    const lineId = `${idPrefix}-line-${lineIndex}`;
    const rect = { ...line.rect, y: line.rect.y - offsetY };
    const fragments = line.fragments.map((fragment, fragIndex) => ({
      ...fragment,
      id: `${lineId}-frag-${fragIndex}`,
      y: fragment.y - offsetY
    }));
    return { ...line, id: lineId, rect, fragments };
  });

const computeSpacingAfter = (block: LayoutBlock): number => {
  if (block.lines.length === 0) return 0;
  const last = block.lines[block.lines.length - 1];
  const lastBottom = last.rect.y + last.rect.h;
  return Math.max(0, block.rect.h - lastBottom);
};

const countFittingLines = (block: LayoutBlock, remaining: number): number => {
  let count = 0;
  for (const line of block.lines) {
    const bottom = line.rect.y + line.rect.h;
    if (bottom <= remaining + LINE_EPSILON) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
};

const splitBlockByLines = (block: LayoutBlock, headCount: number): { head: LayoutBlock; tail: LayoutBlock } | null => {
  if (headCount <= 0 || headCount >= block.lines.length) return null;
  const spacingAfter = computeSpacingAfter(block);
  const headLines = block.lines.slice(0, headCount);
  const tailLines = block.lines.slice(headCount);
  if (headLines.length === 0 || tailLines.length === 0) return null;

  const headLast = headLines[headLines.length - 1];
  const headBottom = headLast.rect.y + headLast.rect.h;
  const tailOffset = tailLines[0].rect.y;
  const tailLinesRebased = cloneLines(tailLines, tailOffset, `${block.id}:tail`);
  const tailLast = tailLinesRebased[tailLinesRebased.length - 1];
  const tailBottom = tailLast.rect.y + tailLast.rect.h;
  const headCells = block.tableCells?.map((cell) => ({ ...cell, h: headBottom }));
  const tailCells = block.tableCells?.map((cell) => ({ ...cell, h: tailBottom + spacingAfter }));

  const head: LayoutBlock = {
    ...block,
    id: `${block.id}:head:${headCount}`,
    rect: { ...block.rect, y: 0, h: headBottom },
    lines: cloneLines(headLines, 0, `${block.id}:head`),
    tableCells: headCells
  };
  const tail: LayoutBlock = {
    ...block,
    id: `${block.id}:tail:${headCount}`,
    rect: { ...block.rect, y: 0, h: tailBottom + spacingAfter },
    lines: tailLinesRebased,
    tableCells: tailCells
  };
  return { head, tail };
};

export const paginate = (input: PaginatorInput): LayoutResult => {
  const frames = computeFramesPx(input.setup);
  const pages: LayoutPage[] = [];
  let currentBlocks: LayoutBlock[] = [];
  let cursorY = 0;
  let pageNumber = 1;
  const bodyHeight = frames.bodyRect.h;
  const columnCount = Math.max(1, Math.floor(input.setup.columns ?? 1));
  const columnGap = input.setup.columnGapPx ?? 0;
  const columnWidthBase =
    columnCount > 1
      ? (frames.bodyRect.w - columnGap * (columnCount - 1)) / columnCount
      : frames.bodyRect.w;
  const columnWidth =
    input.setup.columnWidthPx && input.setup.columnWidthPx > 0 && columnCount > 1
      ? Math.min(columnWidthBase, input.setup.columnWidthPx)
      : columnWidthBase;
  const columnStride = columnWidth + (columnCount > 1 ? columnGap : 0);
  let columnIndex = 0;
  const tableHeaders = new Map<string, LayoutBlock>();

  const flushPage = () => {
    pages.push({
      number: pageNumber,
      setup: input.setup,
      frames: {
        headerRect: { x: frames.headerRect.x, y: frames.headerRect.y, w: frames.headerRect.w, h: frames.headerRect.h },
        bodyRect: { x: frames.bodyRect.x, y: frames.bodyRect.y, w: frames.bodyRect.w, h: frames.bodyRect.h },
        footnotesRect: { x: frames.footnotesRect.x, y: frames.footnotesRect.y, w: frames.footnotesRect.w, h: frames.footnotesRect.h },
        footerRect: { x: frames.footerRect.x, y: frames.footerRect.y, w: frames.footerRect.w, h: frames.footerRect.h }
      },
      items: currentBlocks
    });
    pageNumber += 1;
    currentBlocks = [];
    cursorY = 0;
    columnIndex = 0;
  };

  const offsetBlockForPage = (block: LayoutBlock, offsetX: number, offsetY: number): LayoutBlock => {
    const lines = block.lines.map((line) => ({
      ...line,
      rect: { ...line.rect, x: line.rect.x + offsetX, y: line.rect.y + offsetY },
      fragments: line.fragments.map((fragment) => ({
        ...fragment,
        x: fragment.x + offsetX,
        y: fragment.y + offsetY
      }))
    }));
    return {
      ...block,
      rect: { ...block.rect, x: offsetX, y: offsetY },
      lines
    };
  };

  const blocks = [...input.blocks];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.kind === "page-break") {
      flushPage();
      index += 1;
      continue;
    }
    if (
      block.kind === "table-row" &&
      !block.tableHeader &&
      block.tableId &&
      cursorY === 0 &&
      tableHeaders.has(block.tableId)
    ) {
      const header = tableHeaders.get(block.tableId)!;
      const clone: LayoutBlock = {
        ...header,
        id: `${header.id}:clone:${pageNumber}:${columnIndex}`,
        tableHeaderClone: true
      };
      blocks.splice(index, 0, clone);
      continue;
    }
    if (block.kind === "table-row" && block.tableHeader && block.tableId && !block.tableHeaderClone) {
      tableHeaders.set(block.tableId, block);
    }
    const blockHeight = block.rect.h;
    const remaining = bodyHeight - cursorY;
    if (block.kind === "table-row" && block.tableHeader && index + 1 < blocks.length) {
      const nextBlock = blocks[index + 1];
      if (nextBlock && remaining < blockHeight + nextBlock.rect.h && currentBlocks.length > 0) {
        if (columnIndex + 1 < columnCount) {
          columnIndex += 1;
          cursorY = 0;
        } else {
          flushPage();
        }
        continue;
      }
    }

    if (cursorY + blockHeight <= bodyHeight) {
      const offsetX = columnIndex * columnStride;
      const adjusted = offsetBlockForPage(block, offsetX, cursorY);
      currentBlocks.push(adjusted);
      cursorY += blockHeight;
      index += 1;
      continue;
    }

    const canSplit = block.kind === "paragraph" && block.lines.length > 1;
    if (canSplit) {
      const totalLines = block.lines.length;
      const fitLines = countFittingLines(block, remaining);
      const minHead = currentBlocks.length === 0 ? 1 : DEFAULT_ORPHAN_LINES;
      const minTail = currentBlocks.length === 0 ? 1 : DEFAULT_WIDOW_LINES;

      if (fitLines < minHead) {
        if (currentBlocks.length > 0) {
          if (columnIndex + 1 < columnCount) {
            columnIndex += 1;
            cursorY = 0;
            continue;
          }
          flushPage();
          continue;
        }
        const offsetX = columnIndex * columnStride;
        const adjusted = offsetBlockForPage(block, offsetX, cursorY);
        currentBlocks.push(adjusted);
        cursorY += blockHeight;
        index += 1;
        continue;
      }

      const maxHead = totalLines - minTail;
      if (maxHead >= minHead) {
        const headCount = Math.max(minHead, Math.min(fitLines, maxHead));
        if (headCount > 0 && headCount < totalLines) {
          const split = splitBlockByLines(block, headCount);
          if (split) {
            const offsetX = columnIndex * columnStride;
            const adjustedHead = offsetBlockForPage(split.head, offsetX, cursorY);
            currentBlocks.push(adjustedHead);
            cursorY += split.head.rect.h;
            if (columnIndex + 1 < columnCount) {
              columnIndex += 1;
              cursorY = 0;
            } else {
              flushPage();
            }
            blocks[index] = split.tail;
            continue;
          }
        }
      }

      if (currentBlocks.length > 0) {
        if (columnIndex + 1 < columnCount) {
          columnIndex += 1;
          cursorY = 0;
        } else {
          flushPage();
        }
        continue;
      }
      const offsetX = columnIndex * columnStride;
      const adjusted = offsetBlockForPage(block, offsetX, cursorY);
      currentBlocks.push(adjusted);
      cursorY += blockHeight;
      index += 1;
      continue;
    }

    if (currentBlocks.length > 0) {
      if (columnIndex + 1 < columnCount) {
        columnIndex += 1;
        cursorY = 0;
      } else {
        flushPage();
      }
      continue;
    }
    const offsetX = columnIndex * columnStride;
    const adjusted = offsetBlockForPage(block, offsetX, cursorY);
    currentBlocks.push(adjusted);
    cursorY += blockHeight;
    index += 1;
  }
  if (currentBlocks.length > 0 || pages.length === 0) {
    flushPage();
  }

  const layoutIndex = { fragmentsByDocRange: new Map() };
  return { pages, index: layoutIndex };
};
