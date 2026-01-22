import { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

type VizItem = { title: string; value: string; hint?: string };

export function createVizTool(): ToolDefinition {
  return {
    type: "viz",
    title: "Visualizer",
    create: ({ metadata, onUpdate }): ToolHandle => {
      const wrap = document.createElement("div");
      wrap.className = "tool-surface";

      const header = document.createElement("div");
      header.className = "tool-header";
      const title = document.createElement("h4");
      title.textContent = "Snapshots";
      const shuffle = document.createElement("button");
      shuffle.className = "button-ghost";
      shuffle.textContent = "Shuffle";
      header.appendChild(title);
      header.appendChild(shuffle);
      wrap.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "viz-grid";
      wrap.appendChild(grid);

      const cards: VizItem[] = (metadata?.cards as VizItem[]) || [
        { title: "Documents", value: "12" },
        { title: "References", value: "38" },
        { title: "Pending", value: "5" },
        { title: "Exports", value: "7" }
      ];

      const render = () => {
        grid.innerHTML = "";
        cards.forEach((card) => {
          const el = document.createElement("div");
          el.className = "viz-card";
          const h = document.createElement("h5");
          h.textContent = card.title;
          const v = document.createElement("div");
          v.style.fontSize = "24px";
          v.style.fontWeight = "700";
          v.textContent = card.value;
          const hint = document.createElement("div");
          hint.style.color = "var(--muted)";
          hint.textContent = card.hint || "";
          el.appendChild(h);
          el.appendChild(v);
          el.appendChild(hint);
          grid.appendChild(el);
        });
      };

      shuffle.addEventListener("click", () => {
        cards.sort(() => Math.random() - 0.5);
        onUpdate?.({ cards });
        render();
      });

      render();

      return {
        element: wrap,
        getMetadata: () => ({ cards })
      };
    }
  };
}
