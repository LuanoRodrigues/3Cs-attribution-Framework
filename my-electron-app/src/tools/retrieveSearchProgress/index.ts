import { SearchProgressPanel } from "../../panels/retrieve/SearchProgressPanel";
import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createRetrieveSearchProgressTool(): ToolDefinition {
  return {
    type: "retrieve-search-progress",
    title: "Retrieve Progress",
    create: (): ToolHandle => {
      const panel = new SearchProgressPanel();
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}
