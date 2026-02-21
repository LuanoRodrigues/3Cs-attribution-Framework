import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";
import { ZoteroCollectionsPanel } from "../../panels/retrieve/ZoteroCollectionsPanel";
import { ZoteroItemsPanel } from "../../panels/retrieve/ZoteroItemsPanel";
import { ZoteroDetailPanel } from "../../panels/retrieve/ZoteroDetailPanel";

export function createRetrieveZoteroCollectionsTool(): ToolDefinition {
  return {
    type: "retrieve-zotero-collections",
    title: "Zotero Collections",
    create: (): ToolHandle => {
      const panel = new ZoteroCollectionsPanel();
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}

export function createRetrieveZoteroItemsTool(): ToolDefinition {
  return {
    type: "retrieve-zotero-items",
    title: "Zotero Items",
    create: (): ToolHandle => {
      const panel = new ZoteroItemsPanel();
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}

export function createRetrieveZoteroDetailTool(): ToolDefinition {
  return {
    type: "retrieve-zotero-detail",
    title: "Zotero Detail",
    create: (): ToolHandle => {
      const panel = new ZoteroDetailPanel();
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}
