import { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

type TimelineItem = { label: string; ts: string };

export function createTimelineTool(): ToolDefinition {
  return {
    type: "timeline",
    title: "Timeline",
    create: ({ metadata, onUpdate }): ToolHandle => {
      const wrap = document.createElement("div");
      wrap.className = "tool-surface";

      const header = document.createElement("div");
      header.className = "tool-header";
      const title = document.createElement("h4");
      title.textContent = "Progress";
      const addBtn = document.createElement("button");
      addBtn.className = "button-ghost";
      addBtn.textContent = "Add";
      header.appendChild(title);
      header.appendChild(addBtn);
      wrap.appendChild(header);

      const list = document.createElement("ul");
      list.className = "timeline";
      wrap.appendChild(list);

      const items: TimelineItem[] = Array.isArray(metadata?.items)
        ? (metadata!.items as TimelineItem[])
        : [
            { label: "Project created", ts: new Date().toISOString() },
            { label: "Panels layout ready", ts: new Date().toISOString() }
          ];

      const render = () => {
        list.innerHTML = "";
        items.forEach((item, idx) => {
          const li = document.createElement("li");
          const titleEl = document.createElement("div");
          titleEl.textContent = item.label;
          const ts = document.createElement("div");
          ts.style.color = "var(--muted)";
          ts.style.fontSize = "12px";
          ts.textContent = new Date(item.ts).toLocaleString();
          const close = document.createElement("button");
          close.className = "button-ghost";
          close.textContent = "×";
          close.style.float = "right";
          close.addEventListener("click", () => {
            items.splice(idx, 1);
            onUpdate?.({ items });
            render();
          });
          li.appendChild(titleEl);
          li.appendChild(ts);
          li.appendChild(close);
          list.appendChild(li);
        });
      };

      addBtn.addEventListener("click", () => {
        const label = prompt("Milestone");
        if (!label) return;
        items.push({ label, ts: new Date().toISOString() });
        onUpdate?.({ items });
        render();
      });

      render();

      return {
        element: wrap,
        getMetadata: () => ({ items })
      };
    }
  };
}
