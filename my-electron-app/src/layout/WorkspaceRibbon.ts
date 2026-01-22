export interface WorkspaceRibbonProps {
  mount: HTMLElement;
  spawnTool: (toolType: string) => void;
  split: () => void;
  cycleFocus: () => void;
  resetLayout: () => void;
}

export class WorkspaceRibbon {
  private mount: HTMLElement;
  private props: WorkspaceRibbonProps;

  constructor(props: WorkspaceRibbonProps) {
    this.mount = props.mount;
    this.props = props;
    this.render();
  }

  private render(): void {
    this.mount.innerHTML = "";
    this.mount.classList.add("ribbon-root");

    const toolGroup = document.createElement("div");
    toolGroup.className = "ribbon-group";
    const toolTitle = document.createElement("h3");
    toolTitle.textContent = "Tools";
    toolGroup.appendChild(toolTitle);
    [
      { type: "pdf", label: "PDF" },
      { type: "editor", label: "Editor" },
      { type: "notes", label: "Notes" },
      { type: "timeline", label: "Timeline" },
      { type: "viz", label: "Viz" }
    ].forEach((tool) => {
      const btn = document.createElement("button");
      btn.className = "ribbon-button";
      btn.textContent = tool.label;
      btn.addEventListener("click", () => this.props.spawnTool(tool.type));
      toolGroup.appendChild(btn);
    });

    const layoutGroup = document.createElement("div");
    layoutGroup.className = "ribbon-group";
    const layoutTitle = document.createElement("h3");
    layoutTitle.textContent = "Layout";
    layoutGroup.appendChild(layoutTitle);

    const splitH = document.createElement("button");
    splitH.className = "ribbon-button";
    splitH.textContent = "Split Horiz";
    splitH.addEventListener("click", () => this.props.split());
    layoutGroup.appendChild(splitH);

    const splitV = document.createElement("button");
    splitV.className = "ribbon-button";
    splitV.textContent = "Split Vert";
    splitV.addEventListener("click", () => this.props.split());
    layoutGroup.appendChild(splitV);

    const rotate = document.createElement("button");
    rotate.className = "ribbon-button";
    rotate.textContent = "Cycle Focus (Ctrl+Tab)";
    rotate.addEventListener("click", () => this.props.cycleFocus());
    layoutGroup.appendChild(rotate);

    const reset = document.createElement("button");
    reset.className = "ribbon-button";
    reset.textContent = "Reset Layout";
    reset.addEventListener("click", () => this.props.resetLayout());
    layoutGroup.appendChild(reset);

    this.mount.appendChild(toolGroup);
    this.mount.appendChild(layoutGroup);
  }
}
