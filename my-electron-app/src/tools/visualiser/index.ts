import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";
import { VisualiserPage } from "../../pages/VisualiserPage";

export function createVisualiserTool(): ToolDefinition {
  return {
    type: "visualiser",
    title: "Visualiser",
    create: (): ToolHandle => {
      const container = document.createElement("div");
      container.className = "tool-surface";
      container.classList.add("visualiser-tool-surface");
      const page = new VisualiserPage(container);
      return {
        element: container,
        destroy: () => page.destroy()
      };
    }
  };
}
