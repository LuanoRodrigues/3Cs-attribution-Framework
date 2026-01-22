import { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createPdfTool(): ToolDefinition {
  return {
    type: "pdf",
    title: "PDF Viewer",
    create: ({ metadata, onUpdate }): ToolHandle => {
      const wrap = document.createElement("div");
      wrap.className = "tool-surface";

      const header = document.createElement("div");
      header.className = "tool-header";
      const title = document.createElement("h4");
      title.textContent = "PDF Viewer";
      const fileBtn = document.createElement("button");
      fileBtn.className = "button-ghost";
      fileBtn.textContent = "Open PDF";
      header.appendChild(title);
      header.appendChild(fileBtn);
      wrap.appendChild(header);

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "application/pdf";
      fileInput.style.display = "none";
      wrap.appendChild(fileInput);

      const frame = document.createElement("iframe");
      frame.style.width = "100%";
      frame.style.height = "520px";
      frame.style.border = "1px solid var(--border)";
      frame.style.borderRadius = "12px";
      wrap.appendChild(frame);

      const applySrc = (src?: string) => {
        if (src) {
          frame.src = src;
        }
      };

      if (metadata?.src) {
        applySrc(metadata.src as string);
      }

      fileBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          applySrc(result);
          onUpdate?.({ src: result, name: file.name });
        };
        reader.readAsDataURL(file);
      });

      return {
        element: wrap,
        getMetadata: () => ({ src: frame.src })
      };
    }
  };
}
