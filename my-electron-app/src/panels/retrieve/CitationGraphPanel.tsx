import { buildCitationPayload } from "./citationData";
import type { RetrieveCitationNetwork, RetrieveRecord } from "../../shared/types/retrieve";

export class CitationGraphPanel {
  readonly element: HTMLElement;
  private frame: HTMLIFrameElement;
  private payload = buildCitationPayload(undefined);
  private frameLoaded = false;
  private seedId: string | null = null;
  private messageListener: (event: MessageEvent) => void;

  constructor(record?: RetrieveRecord) {
    this.payload = buildCitationPayload(record);
    this.seedId = record?.paperId ?? null;
    this.element = document.createElement("div");
    this.element.className = "tool-surface";
    this.element.style.display = "flex";
    this.element.style.flexDirection = "column";
    this.element.style.height = "100%";

    const header = document.createElement("div");
    header.className = "tool-header";
    const title = document.createElement("h4");
    title.textContent = "Citation graph";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ribbon-button ribbon-button--compact";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("retrieve:close-graph"));
    });
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "ribbon-button ribbon-button--compact";
    backBtn.textContent = "Back";
    backBtn.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("retrieve:close-graph"));
    });

    const fullscreenBtn = document.createElement("button");
    fullscreenBtn.type = "button";
    fullscreenBtn.className = "ribbon-button ribbon-button--compact";
    fullscreenBtn.textContent = "Fullscreen";
    fullscreenBtn.addEventListener("click", () => {
      if (this.frame.requestFullscreen) {
        void this.frame.requestFullscreen().catch(() => undefined);
      } else {
        window.open(this.frame.src, "_blank", "noopener,noreferrer");
      }
    });

    const detachBtn = document.createElement("button");
    detachBtn.type = "button";
    detachBtn.className = "ribbon-button ribbon-button--compact";
    detachBtn.textContent = "Detach";
    detachBtn.addEventListener("click", () => {
      window.open(this.frame.src, "_blank", "noopener,noreferrer");
    });

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "6px";
    controls.append(backBtn, detachBtn, fullscreenBtn, closeBtn);
    header.appendChild(controls);

    this.frame = document.createElement("iframe");
    this.frame.src = "../resources/retrieve/graph_view.html";
    this.frame.style.border = "none";
    this.frame.style.width = "100%";
    this.frame.style.flex = "1";
    this.frame.style.height = "100%";
    this.frame.addEventListener("load", () => {
      this.frameLoaded = true;
      this.sendPayload();
    });

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

    if (record && window.retrieveBridge?.citationNetwork?.fetch) {
      void this.fetchBackendPayload(record);
    }
  }

  private async fetchBackendPayload(record: RetrieveRecord): Promise<void> {
    try {
      const payload = await window.retrieveBridge!.citationNetwork.fetch({ record });
      this.payload = payload as unknown as ReturnType<typeof buildCitationPayload>;
      this.seedId = record.paperId ?? this.seedId;
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
    const legacyPayload = this.toLegacyGraphPayload(this.payload);
    this.frame.contentWindow.postMessage({ type: "updateGraph", payload: legacyPayload }, "*");
    const seedId =
      this.seedId ??
      (Array.isArray(legacyPayload.nodes) ? (legacyPayload.nodes[0]?.data?.id as string | undefined) : undefined) ??
      null;
    if (seedId) {
      this.frame.contentWindow.postMessage({ type: "selectNode", payload: { id: seedId } }, "*");
    }
  }

  private toLegacyGraphPayload(payload: RetrieveCitationNetwork): Record<string, unknown> {
    const nodes = (payload.nodes ?? []).map((node) => ({
      data: {
        id: node.id,
        label: node.label,
        authors: node.authors,
        year: node.year,
        type: node.type,
        citationCount: node.citationCount
      }
    }));
    const edges = (payload.edges ?? []).map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        weight: edge.weight,
        context: edge.context,
        citation_anchor: edge.citation_anchor,
        citation_type: edge.citation_type,
        page_index: edge.page_index
      }
    }));
    return { nodes, edges, priorIds: [], derivativeIds: [] };
  }

  destroy(): void {
    window.removeEventListener("message", this.messageListener);
  }
}
