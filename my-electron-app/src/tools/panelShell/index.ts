import type { ToolCreateContext, ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createPanelShellTool(): ToolDefinition {
  return {
    type: "panel-shell",
    title: "Panel",
    create: ({ metadata }: ToolCreateContext): ToolHandle => {
      const element = document.createElement("div");
      element.className = "panel-shell";

      const title = document.createElement("h3");
      title.textContent = (metadata as { title?: string } | undefined)?.title || "Panel";
      element.appendChild(title);

      const description = document.createElement("p");
      description.textContent = (metadata as { description?: string } | undefined)?.description || "";
      if (description.textContent) {
        element.appendChild(description);
      }

      return { element };
    }
  };
}
