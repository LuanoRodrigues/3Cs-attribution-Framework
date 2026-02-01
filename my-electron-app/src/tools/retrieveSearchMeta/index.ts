import { SearchMetaPanel } from "../../panels/retrieve/SearchMetaPanel";
import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createRetrieveSearchMetaTool(): ToolDefinition {
  return {
    type: "retrieve-search-meta",
    title: "Retrieve Details",
    create: (): ToolHandle => {
      const panel = new SearchMetaPanel();
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}

