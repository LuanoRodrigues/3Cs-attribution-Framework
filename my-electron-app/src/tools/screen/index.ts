import { command } from "../../ribbon/commandDispatcher";
import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";

export function createScreenWidget(): ToolDefinition {
  return {
    type: "screen-widget",
    title: "Screen",
    create: (): ToolHandle => {
      const wrap = document.createElement("div");
      wrap.className = "tool-surface";

      const header = document.createElement("div");
      header.className = "tool-header";
      const title = document.createElement("h4");
      title.textContent = "Screening";
      header.appendChild(title);

      const status = document.createElement("div");
      status.className = "status-bar";
      status.textContent = "Screen host not connected.";

      const controls = document.createElement("div");
      controls.className = "control-row";

      const makeBtn = (label: string, action: string) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ribbon-button";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          void command("screen", action).then((resp) => {
            if (resp?.nav) {
              status.textContent = resp.nav;
            } else if (resp?.message) {
              status.textContent = resp.message;
            }
          });
        });
        return btn;
      };

      controls.append(
        makeBtn("Open", "open"),
        makeBtn("Prev", "prev"),
        makeBtn("Next", "next"),
        makeBtn("Status", "status"),
        makeBtn("Close", "close")
      );

      const decisions = document.createElement("div");
      decisions.className = "control-row";
      decisions.append(
        makeBtn("Exclude Item", "exclude_item"),
        makeBtn("Tag for Inclusion", "tag_for_inclusion"),
        makeBtn("Write Note", "write_screening_note")
      );

      wrap.append(header, status, controls, decisions);

      return {
        element: wrap,
        focus: () => wrap.focus()
      };
    }
  };
}
