import type { PanelDefinition, PanelId } from "../layout/panelRegistry";

export type SplitOrientation = "row" | "col";

export type SplitNode = {
  type: "split";
  orient: SplitOrientation;
  ratio: number;
  a: PanelNode;
  b: PanelNode;
};

export type LeafNode = {
  type: "leaf";
  panelId: PanelId;
  tabs: string[];
  activeTabId?: string;
};

export type PanelNode = SplitNode | LeafNode;

export function createDefaultPanelTree(definitions: PanelDefinition[]): PanelNode {
  if (!definitions.length) {
    throw new Error("No panel definitions available to build panel tree");
  }
  // Start with first panel as root leaf
  let tree: PanelNode = createLeaf(definitions[0].id);
  for (let i = 1; i < definitions.length; i += 1) {
    const def = definitions[i];
    tree = {
      type: "split",
      orient: "row",
      ratio: 0.5,
      a: tree,
      b: createLeaf(def.id)
    };
  }
  return tree;
}

export function createLeaf(panelId: PanelId): LeafNode {
  return {
    type: "leaf",
    panelId,
    tabs: [panelId],
    activeTabId: panelId
  };
}

export function collectLeaves(node: PanelNode, leaves: LeafNode[] = []): LeafNode[] {
  if (node.type === "leaf") {
    leaves.push(node);
    return leaves;
  }
  collectLeaves(node.a, leaves);
  collectLeaves(node.b, leaves);
  return leaves;
}
