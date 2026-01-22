import { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createNotesTool(): ToolDefinition {
  return {
    type: "notes",
    title: "Notes",
    create: ({ metadata, onUpdate }): ToolHandle => {
      const wrap = document.createElement("div");
      wrap.className = "tool-surface";

      const header = document.createElement("div");
      header.className = "tool-header";
      const title = document.createElement("h4");
      title.textContent = "Notebook";
      const saveBtn = document.createElement("button");
      saveBtn.className = "button-ghost";
      saveBtn.textContent = "Save";
      header.appendChild(title);
      header.appendChild(saveBtn);
      wrap.appendChild(header);

      const textarea = document.createElement("textarea");
      textarea.className = "notes-editor";
      textarea.placeholder = "Capture quick notes, decisions, or todos";
      textarea.value = (metadata?.content as string) || "";
      textarea.style.height = "320px";
      textarea.addEventListener("input", () => {
        onUpdate?.({ content: textarea.value });
      });
      saveBtn.addEventListener("click", () => {
        onUpdate?.({ content: textarea.value });
      });

      wrap.appendChild(textarea);

      return {
        element: wrap,
        getMetadata: () => ({ content: textarea.value })
      };
    }
  };
}
