import { buildCitationPayload, type CitationPayload } from "./citationData";
import type { RetrieveRecord } from "../../shared/types/retrieve";

export class CitationsPanel {
  readonly element: HTMLElement;
  private frame: HTMLIFrameElement;
  private payload: CitationPayload;
  private frameLoaded = false;
  private highlightListener: (event: Event) => void;

  constructor(record?: RetrieveRecord) {
    this.payload = buildCitationPayload(record);
    this.element = document.createElement("div");
    this.element.className = "tool-surface";

    const header = document.createElement("div");
    header.className = "tool-header";
    const title = document.createElement("h4");
    title.textContent = "Citation list";
    header.appendChild(title);

    this.frame = document.createElement("iframe");
    this.frame.src = "../resources/retrieve/citations.html";
    this.frame.style.border = "none";
    this.frame.style.width = "100%";
    this.frame.style.height = "520px";
    this.frame.addEventListener("load", () => {
      this.frameLoaded = true;
      this.sendPayload();
    });

    this.highlightListener = (event: Event) => {
      const custom = event as CustomEvent<{ nodeId?: string }>;
      const nodeId = custom.detail?.nodeId;
      if (!nodeId) {
        return;
      }
      this.frame.contentWindow?.postMessage({ type: "nodeSelect", nodeId }, "*");
    };
    window.addEventListener("retrieve-citation-node-click", this.highlightListener);

    this.element.append(header, this.frame);

    if (record && window.retrieveBridge?.citationNetwork?.fetch) {
      void this.fetchBackendPayload(record);
    }
  }

  private async fetchBackendPayload(record: RetrieveRecord): Promise<void> {
    try {
      const payload = await window.retrieveBridge!.citationNetwork.fetch({ record });
      this.payload = payload as unknown as CitationPayload;
      if (this.frameLoaded) {
        this.sendPayload();
      }
    } catch (error) {
      console.warn("Citation network fetch failed; falling back to placeholder payload.", error);
    }
  }

  private sendPayload(): void {
    if (!this.frame.contentWindow) {
      return;
    }
    this.frame.contentWindow.postMessage({ type: "citations", payload: this.payload }, "*");
  }

  destroy(): void {
    window.removeEventListener("retrieve-citation-node-click", this.highlightListener);
  }
}
