import { SearchAppPanel } from "../../panels/retrieve/SearchAppPanel";
import type { RetrieveQuery } from "../../shared/types/retrieve";
import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createRetrieveSearchAppTool(): ToolDefinition {
  return {
    type: "retrieve-search-app",
    title: "Retrieve Search",
    create: ({ metadata, onUpdate }): ToolHandle => {
      const initialQuery = (metadata as { query?: RetrieveQuery } | undefined)?.query;
      const panel = new SearchAppPanel(initialQuery);
      if (onUpdate) {
        // TODO: expose query snapshot once SearchAppPanel supports it.
        onUpdate({ query: initialQuery });
      }
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}

