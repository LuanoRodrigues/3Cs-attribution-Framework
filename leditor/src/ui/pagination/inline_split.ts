export type InlineSplitResult = {
  head: HTMLElement;
  tail: HTMLElement;
  splitIndex: number;
};

type InlineSplitOptions = {
  block: HTMLElement;
  pageContent: HTMLElement;
  contentHeightPx: number;
  tolerancePx: number;
  preferWordBoundary: boolean;
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

const measureFits = (
  block: HTMLElement,
  pageContent: HTMLElement,
  contentHeightPx: number,
  tolerancePx: number
): boolean => {
  pageContent.replaceChildren(block);
  return block.scrollHeight <= contentHeightPx + tolerancePx;
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

export const splitBlockInline = (options: InlineSplitOptions): InlineSplitResult => {
  const { block, pageContent, contentHeightPx, tolerancePx, preferWordBoundary } = options;
  const textNodes = getTextNodes(block);
  if (textNodes.length === 0) {
    throw new Error("Inline split requires text nodes.");
  }
  const totalLength = getTextLength(textNodes);
  if (totalLength <= 1) {
    throw new Error("Inline split requires a longer text block.");
  }
  const text = block.textContent ?? "";
  if (text.length !== totalLength) {
    throw new Error("Inline split text length mismatch.");
  }
  const candidates = buildSplitCandidates(text, preferWordBoundary);
  if (candidates.length === 0) {
    throw new Error("Inline split has no candidate boundaries.");
  }

  let bestIndex = -1;
  let low = 0;
  let high = candidates.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const splitIndex = candidates[mid];
    const probe = block.cloneNode(true) as HTMLElement;
    deleteAfterIndex(probe, splitIndex);
    const fits = measureFits(probe, pageContent, contentHeightPx, tolerancePx);
    if (fits) {
      bestIndex = splitIndex;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (bestIndex <= 0 || bestIndex >= totalLength) {
    throw new Error("Inline split could not find a valid split point.");
  }

  const head = block.cloneNode(true) as HTMLElement;
  const tail = block.cloneNode(true) as HTMLElement;
  deleteAfterIndex(head, bestIndex);
  deleteBeforeIndex(tail, bestIndex);

  if (!head.textContent || !tail.textContent) {
    throw new Error("Inline split produced empty block.");
  }

  return { head, tail, splitIndex: bestIndex };
};
