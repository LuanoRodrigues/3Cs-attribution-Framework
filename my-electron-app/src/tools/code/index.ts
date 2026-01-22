import { CodePanel } from "../../panels/code/CodePanel";
import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createCodeTool(): ToolDefinition {
  return {
    type: "code-panel",
    title: "Code",
    create: (): ToolHandle => {
      const panel = new CodePanel();
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}
