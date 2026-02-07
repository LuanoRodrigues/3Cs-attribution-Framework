export type InlineSplitResult = {
  head: HTMLElement;
  tail: HTMLElement;
  splitIndex: number;
};

type InlineSplitOptions = {
  block: HTMLElement;
  pageContent: HTMLElement;
  maxLines: number;
  lineHeightPx: number;
  paddingBottomPx: number;
  preferWordBoundary: boolean;
  orphansMinLines: number;
  widowsMinLines: number;
};

const getTextNodes = (root: HTMLElement): Text[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
};

const getTextLength = (nodes: Text[]): number =>
  nodes.reduce((total, node) => total + (node.nodeValue?.length ?? 0), 0);

const deleteAfterIndex = (root: HTMLElement, index: number): void => {
  const nodes = getTextNodes(root);
  let remaining = index;
  for (const node of nodes) {
    const value = node.nodeValue ?? "";
    if (remaining <= value.length) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, remaining));
      range.setEnd(root, root.childNodes.length);
      range.deleteContents();
      return;
    }
    remaining -= value.length;
  }
};

const deleteBeforeIndex = (root: HTMLElement, index: number): void => {
  const nodes = getTextNodes(root);
  let remaining = index;
  for (const node of nodes) {
    const value = node.nodeValue ?? "";
    if (remaining <= value.length) {
      const range = document.createRange();
      range.setStart(root, 0);
      range.setEnd(node, Math.max(0, remaining));
      range.deleteContents();
      return;
    }
    remaining -= value.length;
  }
};

const computeUsedLines = (pageContent: HTMLElement, lineHeightPx: number, paddingBottomPx: number): number => {
  const rawHeight = pageContent.scrollHeight - paddingBottomPx;
  if (!Number.isFinite(rawHeight) || rawHeight <= 0) return 0;
  return Math.ceil(rawHeight / lineHeightPx);
};

const computeBlockLines = (block: HTMLElement, lineHeightPx: number): number => {
  const height = block.scrollHeight;
  if (!Number.isFinite(height) || height <= 0) return 0;
  return Math.max(1, Math.round(height / lineHeightPx));
};

const measureHeadFits = (
  headProbe: HTMLElement,
  pageContent: HTMLElement,
  maxLines: number,
  lineHeightPx: number,
  paddingBottomPx: number
): { fits: boolean; usedLines: number; headLines: number } => {
  pageContent.appendChild(headProbe);
  const usedLines = computeUsedLines(pageContent, lineHeightPx, paddingBottomPx);
  const headLines = computeBlockLines(headProbe, lineHeightPx);
  headProbe.remove();
  return { fits: usedLines <= maxLines, usedLines, headLines };
};

const measureTailLines = (tailProbe: HTMLElement, pageContent: HTMLElement, lineHeightPx: number): number => {
  pageContent.appendChild(tailProbe);
  const lines = computeBlockLines(tailProbe, lineHeightPx);
  tailProbe.remove();
  return lines;
};

const buildSplitCandidates = (text: string, preferWordBoundary: boolean): number[] => {
  const length = text.length;
  if (length <= 1) return [];
  if (!preferWordBoundary) {
    return Array.from({ length: length - 1 }, (_, index) => index + 1);
  }
  const indices: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const ch = text[i];
    if (ch === " " || ch === "\n" || ch === "\t") {
      if (i + 1 < length) {
        indices.push(i + 1);
      }
    }
  }
  if (indices.length === 0) {
    return Array.from({ length: length - 1 }, (_, index) => index + 1);
  }
  return indices;
};

export const splitBlockInline = (options: InlineSplitOptions): InlineSplitResult | null => {
  const {
    block,
    pageContent,
    maxLines,
    lineHeightPx,
    paddingBottomPx,
    preferWordBoundary,
    orphansMinLines,
    widowsMinLines
  } = options;

  if (!Number.isFinite(maxLines) || maxLines < 1) {
    throw new Error("Inline split requires a positive maxLines.");
  }
  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
    throw new Error("Inline split requires a positive lineHeightPx.");
  }
  if (!Number.isFinite(paddingBottomPx) || paddingBottomPx < 0) {
    throw new Error("Inline split requires a non-negative paddingBottomPx.");
  }
  if (!Number.isFinite(orphansMinLines) || orphansMinLines < 1) {
    throw new Error("Inline split requires a positive orphansMinLines.");
  }
  if (!Number.isFinite(widowsMinLines) || widowsMinLines < 1) {
    throw new Error("Inline split requires a positive widowsMinLines.");
  }

  const textNodes = getTextNodes(block);
  if (textNodes.length === 0) {
    return null;
  }
  const totalLength = getTextLength(textNodes);
  if (totalLength <= 1) {
    return null;
  }
  const text = block.textContent ?? "";
  if (text.length !== totalLength) {
    return null;
  }
  const candidates = buildSplitCandidates(text, preferWordBoundary);
  if (candidates.length === 0) {
    return null;
  }

  let bestIndex = -1;
  let low = 0;
  let high = candidates.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const splitIndex = candidates[mid];

    const headProbe = block.cloneNode(true) as HTMLElement;
    headProbe.classList.add("leditor-split-fragment--head");
    deleteAfterIndex(headProbe, splitIndex);

    const { fits, headLines } = measureHeadFits(headProbe, pageContent, maxLines, lineHeightPx, paddingBottomPx);
    if (!fits) {
      high = mid - 1;
      continue;
    }
    if (headLines < orphansMinLines) {
      high = mid - 1;
      continue;
    }

    const tailProbe = block.cloneNode(true) as HTMLElement;
    deleteBeforeIndex(tailProbe, splitIndex);
    const tailLines = measureTailLines(tailProbe, pageContent, lineHeightPx);
    if (tailLines < widowsMinLines) {
      high = mid - 1;
      continue;
    }

    bestIndex = splitIndex;
    low = mid + 1;
  }

  if (bestIndex <= 0 || bestIndex >= totalLength) {
    return null;
  }

  const head = block.cloneNode(true) as HTMLElement;
  const tail = block.cloneNode(true) as HTMLElement;
  head.classList.add("leditor-split-fragment--head");
  tail.classList.add("leditor-split-fragment--tail");
  deleteAfterIndex(head, bestIndex);
  deleteBeforeIndex(tail, bestIndex);

  if (!head.textContent || !tail.textContent) {
    return null;
  }

  return { head, tail, splitIndex: bestIndex };
};
