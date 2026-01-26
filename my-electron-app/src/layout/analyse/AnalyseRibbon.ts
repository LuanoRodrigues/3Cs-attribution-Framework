import type { AnalyseAction } from "../../analyse/types";

export interface AnalyseRibbonProps {
  mount: HTMLElement;
  command: (phase: string, action: AnalyseAction, payload?: Record<string, unknown>) => void;
}

interface ActionMeta {
  id: string;
  label: string;
  action: AnalyseAction;
  payload?: Record<string, unknown>;
  payloadFactory?: () => Record<string, unknown> | undefined;
  tooltip?: string;
}

export class AnalyseRibbon {
  private mount: HTMLElement;
  private props: AnalyseRibbonProps;

  constructor(props: AnalyseRibbonProps) {
    this.mount = props.mount;
    this.props = props;
    this.render();
  }

  private render(): void {
    this.mount.innerHTML = "";
    this.mount.classList.add("ribbon-root");

    this.mount.appendChild(this.renderGroup("Data", this.getDataActions()));
    this.mount.appendChild(this.renderGroup("Analysis", this.getAnalysisActions()));
    this.mount.appendChild(this.renderGroup("Dashboard", this.getDashboardActions()));
    this.mount.appendChild(this.renderGroup("Audio", this.getAudioActions()));
    this.mount.appendChild(this.renderGroup("Tools", this.getToolActions()));
  }

  private renderGroup(titleText: string, actions: ActionMeta[]): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "ribbon-group";
    const title = document.createElement("h3");
    title.textContent = titleText;
    wrapper.appendChild(title);
    actions.forEach((action) => wrapper.appendChild(this.makeButton(action)));
    return wrapper;
  }

  private makeButton(meta: ActionMeta): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ribbon-button";
    btn.id = meta.id;
    btn.dataset.action = meta.action;
    btn.textContent = meta.label;
    btn.title = meta.tooltip || meta.label;
    btn.addEventListener("click", () => {
      const payload = meta.payloadFactory ? meta.payloadFactory() : meta.payload;
      if (payload === undefined && meta.payloadFactory) {
        return;
      }
      this.props.command("analyse", meta.action, payload);
    });
    return btn;
  }

  private getDataActions(): ActionMeta[] {
    return [
      { id: "analyse-corpus", label: "Corpus", action: "analyse/open_corpus", tooltip: "Open corpus batches view" },
      { id: "analyse-batches", label: "Batches", action: "analyse/open_batches", tooltip: "Review batches" },
      {
        id: "analyse-phases",
        label: "Phases",
        action: "analyse/open_phases",
        tooltip: "Open three-panel phases workspace"
      }
    ];
  }

  private getAnalysisActions(): ActionMeta[] {
    return [
      { id: "analyse-sections-r1", label: "Sections R1", action: "analyse/open_sections_r1", tooltip: "Open round 1 sections" },
      { id: "analyse-sections-r2", label: "Sections R2", action: "analyse/open_sections_r2", tooltip: "Open round 2 sections" },
      { id: "analyse-sections-r3", label: "Sections R3", action: "analyse/open_sections_r3", tooltip: "Open round 3 sections" }
    ];
  }

  private getDashboardActions(): ActionMeta[] {
    return [
      { id: "analyse-dashboard", label: "Dashboard", action: "analyse/open_dashboard", tooltip: "Show dashboard" }
    ];
  }

  private getAudioActions(): ActionMeta[] {
    return [
      { id: "analyse-audio", label: "Audio", action: "analyse/open_audio", tooltip: "Audio settings and playback" }
    ];
  }

  private getToolActions(): ActionMeta[] {
    return [
      { id: "analyse-coder", label: "Coder", action: "analyse/open_coder", tooltip: "Open coder tool" },
      { id: "analyse-pdf-viewer", label: "PDF Viewer", action: "analyse/open_pdf_viewer", tooltip: "Open PDF viewer" },
      { id: "analyse-preview", label: "Preview", action: "analyse/open_preview", tooltip: "Open preview panel" }
    ];
  }
}
