export type InlineSplitResult = {
  head: HTMLElement;
  tail: HTMLElement;
  splitIndex: number;
};

type InlineSplitOptions = {
  block: HTMLElement;
  pageContent: HTMLElement;
  lineHeightPx: number;
  paddingBottomPx: number;
  maxLines: number;
  usedLinesBefore: number;
  minHeadLines: number;
  minTailLines: number;
  preferWordBoundary: boolean;
  measureMode: "replace" | "append";
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

const computeUsedLines = (scrollHeightPx: number, paddingBottomPx: number, lineHeightPx: number): number => {
  if (!Number.isFinite(scrollHeightPx) || !Number.isFinite(paddingBottomPx) || !Number.isFinite(lineHeightPx)) {
    throw new Error("computeUsedLines requires finite inputs.");
  }
  if (lineHeightPx <= 0) {
    throw new Error("computeUsedLines requires a positive line height.");
  }
  const raw = (scrollHeightPx - paddingBottomPx) / lineHeightPx;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.ceil(raw));
};

const withProbe = <T>(
  pageContent: HTMLElement,
  probe: HTMLElement,
  mode: "replace" | "append",
  fn: () => T
): T => {
  if (mode === "append") {
    pageContent.appendChild(probe);
    try {
      return fn();
    } finally {
      probe.remove();
    }
  }
  const existing = Array.from(pageContent.childNodes);
  pageContent.replaceChildren(probe);
  try {
    return fn();
  } finally {
    pageContent.replaceChildren(...existing);
  }
};

const measurePageLines = (
  probe: HTMLElement,
  pageContent: HTMLElement,
  paddingBottomPx: number,
  lineHeightPx: number,
  mode: "replace" | "append"
): number =>
  withProbe(pageContent, probe, mode, () =>
    computeUsedLines(pageContent.scrollHeight, paddingBottomPx, lineHeightPx)
  );

const measureBlockLines = (
  probe: HTMLElement,
  pageContent: HTMLElement,
  lineHeightPx: number
): number =>
  withProbe(pageContent, probe, "replace", () => {
    const raw = probe.scrollHeight / lineHeightPx;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(1, Math.round(raw));
  });

const buildSplitCandidates = (text: string, preferWordBoundary: boolean): number[] => {
  const length = text.length;
  if (length <= 1) return [];
  if (!preferWordBoundary) {
    return Array.from({ length: length - 1 }, (_, index) => index + 1);
  }
  let indices: number[] = [];
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const segment of segmenter.segment(text)) {
      const end = segment.index + segment.segment.length;
      if (end > 0 && end < length) {
        indices.push(end);
      }
    }
  }
  if (indices.length === 0) {
    for (let i = 0; i < length; i += 1) {
      const ch = text[i];
      if (ch === " " || ch === "\n" || ch === "\t") {
        if (i + 1 < length) {
          indices.push(i + 1);
        }
      }
    }
  }
  if (indices.length === 0) {
    indices = Array.from({ length: length - 1 }, (_, index) => index + 1);
  }
  return Array.from(new Set(indices)).sort((a, b) => a - b);
};

export const splitBlockInline = (options: InlineSplitOptions): InlineSplitResult => {
  const {
    block,
    pageContent,
    lineHeightPx,
    paddingBottomPx,
    maxLines,
    usedLinesBefore,
    minHeadLines,
    minTailLines,
    preferWordBoundary,
    measureMode
  } = options;
  if (lineHeightPx <= 0 || !Number.isFinite(lineHeightPx)) {
    throw new Error("Inline split requires a positive lineHeightPx.");
  }
  if (!Number.isFinite(paddingBottomPx) || paddingBottomPx < 0) {
    throw new Error("Inline split requires a non-negative paddingBottomPx.");
  }
  if (!Number.isFinite(maxLines) || maxLines <= 0) {
    throw new Error("Inline split requires a positive maxLines.");
  }
  if (!Number.isFinite(usedLinesBefore) || usedLinesBefore < 0) {
    throw new Error("Inline split requires a non-negative usedLinesBefore.");
  }
  if (!Number.isFinite(minHeadLines) || !Number.isFinite(minTailLines)) {
    throw new Error("Inline split requires finite widow/orphan constraints.");
  }
  if (minHeadLines < 0 || minTailLines < 0) {
    throw new Error("Inline split requires non-negative widow/orphan constraints.");
  }
  const remainingLines = maxLines - usedLinesBefore;
  if (!Number.isFinite(remainingLines) || remainingLines <= 0) {
    throw new Error("Inline split requires remaining line capacity.");
  }
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

  let bestCandidateIndex = -1;
  let low = 0;
  let high = candidates.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const splitIndex = candidates[mid];
    const probe = block.cloneNode(true) as HTMLElement;
    deleteAfterIndex(probe, splitIndex);
    const usedLinesAfter = measurePageLines(probe, pageContent, paddingBottomPx, lineHeightPx, measureMode);
    if (usedLinesAfter <= maxLines) {
      bestCandidateIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (bestCandidateIndex < 0) {
    throw new Error("Inline split could not find a fitting split point.");
  }

  const originalNodeId = block.dataset.leditorNodeId || null;
  for (let i = bestCandidateIndex; i >= 0; i -= 1) {
    const splitIndex = candidates[i];
    const head = block.cloneNode(true) as HTMLElement;
    const tail = block.cloneNode(true) as HTMLElement;
    deleteAfterIndex(head, splitIndex);
    deleteBeforeIndex(tail, splitIndex);

    if (!head.textContent || !tail.textContent) {
      continue;
    }

    const headLines = measureBlockLines(head, pageContent, lineHeightPx);
    if (headLines < minHeadLines) {
      break;
    }
    const tailLines = measureBlockLines(tail, pageContent, lineHeightPx);
    if (tailLines < minTailLines) {
      continue;
    }
    const usedLinesAfter = measurePageLines(head, pageContent, paddingBottomPx, lineHeightPx, measureMode);
    if (usedLinesAfter > maxLines) {
      continue;
    }

    head.classList.add("leditor-split-fragment--head");
    tail.classList.add("leditor-split-fragment--tail");
    if (originalNodeId) {
      head.dataset.leditorNodeId = originalNodeId;
      tail.dataset.leditorNodeId = `${originalNodeId}:cont:${splitIndex}`;
    }
    return { head, tail, splitIndex };
  }

  throw new Error("Inline split could not satisfy widow/orphan constraints.");
};
