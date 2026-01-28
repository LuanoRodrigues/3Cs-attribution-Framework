import { DataHubPanel } from "../../panels/retrieve/DataHubPanel";
import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createRetrieveDataHubTool(): ToolDefinition {
  return {
    type: "retrieve-datahub",
    title: "Data Hub",
    create: (): ToolHandle => {
      const panel = new DataHubPanel();
      const surface = document.createElement("div");
      surface.className = "tool-surface";
      surface.appendChild(panel.element);
      return {
        element: surface,
        destroy: () => panel.destroy()
      };
    }
  };
}
