type SelectionBookmark = {
  anchor: {
    nodeId: string | null;
    path: number[];
    offset: number;
  };
  focus: {
    nodeId: string | null;
    path: number[];
    offset: number;
  };
  isCollapsed: boolean;
};

type NodePath = number[];

type NodeLocator = {
  nodeId: string | null;
  path: NodePath;
  offset: number;
};

const getNodePath = (base: Node, target: Node): NodePath => {
  const path: number[] = [];
  let current: Node | null = target;
  while (current && current !== base) {
    const parent = current.parentNode;
    if (!parent) {
      throw new Error("Selection path cannot be resolved to base node.");
    }
    const index = Array.from(parent.childNodes).indexOf(current);
    if (index < 0) {
      throw new Error("Selection node index not found.");
    }
    path.push(index);
    current = parent;
  }
  if (current !== base) {
    throw new Error("Selection path base mismatch.");
  }
  return path.reverse();
};

const resolveNodePath = (base: Node, path: NodePath): Node => {
  let current: Node = base;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) {
      throw new Error("Selection path resolution failed.");
    }
    current = child;
  }
  return current;
};

const findNodeId = (node: Node): string | null => {
  if (node instanceof HTMLElement && node.dataset.leditorNodeId) {
    return node.dataset.leditorNodeId;
  }
  if (node.parentElement) {
    return findNodeId(node.parentElement);
  }
  return null;
};

const getNodeLocator = (root: HTMLElement, node: Node, offset: number): NodeLocator => {
  const nodeId = findNodeId(node);
  const base = nodeId ? root.querySelector(`[data-leditor-node-id="${nodeId}"]`) : null;
  if (nodeId && base) {
    const path = getNodePath(base, node);
    return { nodeId, path, offset };
  }
  return { nodeId: null, path: getNodePath(root, node), offset };
};

const resolveNodeLocator = (root: HTMLElement, locator: NodeLocator): { node: Node; offset: number } => {
  if (locator.nodeId) {
    const base = root.querySelector(`[data-leditor-node-id="${locator.nodeId}"]`);
    if (!base) {
      throw new Error(`Selection bookmark nodeId not found: ${locator.nodeId}.`);
    }
    const node = resolveNodePath(base, locator.path);
    return { node, offset: locator.offset };
  }
  const node = resolveNodePath(root, locator.path);
  return { node, offset: locator.offset };
};

export const saveSelectionBookmark = (root: HTMLElement): SelectionBookmark => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    throw new Error("Selection bookmark requires a selection range.");
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    throw new Error("Selection bookmark range is outside pagination root.");
  }
  const anchor = getNodeLocator(root, range.startContainer, range.startOffset);
  const focus = getNodeLocator(root, range.endContainer, range.endOffset);
  return {
    anchor,
    focus,
    isCollapsed: range.collapsed
  };
};

export const restoreSelectionBookmark = (root: HTMLElement, bookmark: SelectionBookmark): void => {
  if (!bookmark) {
    throw new Error("Selection bookmark restore requires a bookmark.");
  }
  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Selection restore requires window selection.");
  }
  const anchor = resolveNodeLocator(root, bookmark.anchor);
  const focus = resolveNodeLocator(root, bookmark.focus);
  const range = document.createRange();
  range.setStart(anchor.node, anchor.offset);
  range.setEnd(focus.node, focus.offset);
  selection.removeAllRanges();
  selection.addRange(range);
};

export type { SelectionBookmark };
