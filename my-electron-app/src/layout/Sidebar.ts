export interface SidebarProps {
  mount: HTMLElement;
  spawnTool: (toolType: string) => void;
  onFocusCycle: () => void;
}

export class Sidebar {
  private mount: HTMLElement;
  private props: SidebarProps;
  private activeToolType?: string;

  constructor(props: SidebarProps) {
    this.mount = props.mount;
    this.props = props;
    this.render();
  }

  setActive(toolType?: string): void {
    this.activeToolType = toolType;
    this.updateActive();
  }

  private render(): void {
    this.mount.innerHTML = "";
    const title = document.createElement("div");
    title.className = "sidebar-title";
    title.textContent = "Tools";
    this.mount.appendChild(title);

    const toolButtons = [
      { type: "pdf", label: "PDF Viewer" },
      { type: "editor", label: "Document Editor" },
      { type: "notes", label: "Notes" },
      { type: "timeline", label: "Timeline" },
      { type: "viz", label: "Visualizer" }
    ];

    toolButtons.forEach((tool) => {
      const btn = document.createElement("button");
      btn.className = "sidebar-button";
      btn.dataset.toolType = tool.type;
      btn.textContent = tool.label;
      btn.addEventListener("click", () => this.props.spawnTool(tool.type));
      this.mount.appendChild(btn);
    });

    const focusRow = document.createElement("div");
    focusRow.className = "control-row";
    const focusHint = document.createElement("span");
    focusHint.textContent = "Cycle focus";
    const shortcut = document.createElement("kbd");
    shortcut.textContent = "Ctrl+Tab";
    focusRow.appendChild(focusHint);
    focusRow.appendChild(shortcut);
    focusRow.addEventListener("click", () => this.props.onFocusCycle());
    this.mount.appendChild(focusRow);

    this.updateActive();
  }

  private updateActive(): void {
    const buttons = this.mount.querySelectorAll<HTMLButtonElement>(".sidebar-button");
    buttons.forEach((btn) => {
      if (btn.dataset.toolType === this.activeToolType) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }
}
