import { SearchPanel } from "../../panels/retrieve/SearchPanel";
import { CitationsPanel } from "../../panels/retrieve/CitationsPanel";
import { CitationGraphPanel } from "../../panels/retrieve/CitationGraphPanel";
import type { RetrieveQuery, RetrieveRecord } from "../../shared/types/retrieve";
import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createRetrieveTool(): ToolDefinition {
  return {
    type: "retrieve",
    title: "Retrieve",
    create: ({ metadata, onUpdate }): ToolHandle => {
      const initialQuery = (metadata as { query?: RetrieveQuery } | undefined)?.query;
      const panel = new SearchPanel(initialQuery);
      if (onUpdate) {
        panel.onChange((query) => onUpdate({ query }));
      }
      return {
        element: panel.element,
        destroy: () => panel.destroy(),
        getMetadata: () => ({ query: panel.getQuery() })
      };
    }
  };
}

export function createRetrieveCitationsTool(): ToolDefinition {
  return {
    type: "retrieve-citations",
    title: "Citations",
    create: ({ metadata }): ToolHandle => {
      const record = metadata?.record as RetrieveRecord | undefined;
      const panel = new CitationsPanel(record);
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}

export function createRetrieveCitationGraphTool(): ToolDefinition {
  return {
    type: "retrieve-citation-graph",
    title: "Citation graph",
    create: ({ metadata }): ToolHandle => {
      const record = metadata?.record as RetrieveRecord | undefined;
      const panel = new CitationGraphPanel(record);
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}
