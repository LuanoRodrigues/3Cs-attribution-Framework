import { buildCitationPayload } from "./citationData";
import type { RetrieveRecord } from "../../shared/types/retrieve";

export class CitationGraphPanel {
  readonly element: HTMLElement;
  private frame: HTMLIFrameElement;
  private payload = buildCitationPayload(undefined);
  private messageListener: (event: MessageEvent) => void;

  constructor(record?: RetrieveRecord) {
    this.payload = buildCitationPayload(record);
    this.element = document.createElement("div");
    this.element.className = "tool-surface";

    const header = document.createElement("div");
    header.className = "tool-header";
    const title = document.createElement("h4");
    title.textContent = "Citation graph";
    header.appendChild(title);

    this.frame = document.createElement("iframe");
    this.frame.src = "../resources/retrieve/graph_view.html";
    this.frame.style.border = "none";
    this.frame.style.width = "100%";
    this.frame.style.height = "520px";
    this.frame.addEventListener("load", () => this.sendPayload());

    this.messageListener = (event: MessageEvent) => {
      if (event.source !== this.frame.contentWindow) {
        return;
      }
      if (event.data?.type === "graphNodeClick" && event.data.nodeId) {
        window.dispatchEvent(
          new CustomEvent("retrieve-citation-node-click", {
            detail: { nodeId: event.data.nodeId }
          })
        );
      }
    };
    window.addEventListener("message", this.messageListener);

    this.element.append(header, this.frame);
  }

  private sendPayload(): void {
    if (!this.frame.contentWindow) {
      return;
    }
    this.frame.contentWindow.postMessage({ type: "graph", payload: this.payload }, "*");
  }

  destroy(): void {
    window.removeEventListener("message", this.messageListener);
  }
}
