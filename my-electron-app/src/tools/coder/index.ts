import { CoderPanel } from "../../panels/coder/CoderPanel";
import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";
import { getDefaultCoderScope } from "../../analyse/collectionScope";

export function createCoderTool(): ToolDefinition {
  return {
    type: "coder-panel",
    title: "Coder",
    create: (): ToolHandle => {
      const panel = new CoderPanel({ scopeId: getDefaultCoderScope() });
      return {
        element: panel.element,
        destroy: () => panel.destroy()
      };
    }
  };
}
