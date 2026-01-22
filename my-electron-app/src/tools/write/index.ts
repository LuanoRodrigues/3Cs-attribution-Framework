import { WritePage } from "../../pages/WritePage";
import type { ToolDefinition } from "../../registry/toolRegistry";

export function createWriteTool(): ToolDefinition {
  return {
    type: "write-leditor",
    title: "Write",
    create: () => {
      const container = document.createElement("div");
      container.className = "write-page-container";
      const page = new WritePage(container);
      return {
        element: container,
        focus: () => page.focus(),
        destroy: () => page.destroy()
      };
    }
  };
}
