import { CODER_MIME, type CoderPayload } from "./coderTypes";
import { normalizePayloadHtml } from "./coderState";

function isInsideCoderPanel(target?: Element | null): boolean {
  if (!target) return false;
  return Boolean(target.closest?.(".coder-surface"));
}

function buildPayloadFromSelection(): CoderPayload | null {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed) {
    return null;
  }
  const text = sel.toString?.() || "";
  if (!text.trim()) {
    return null;
  }
  try {
    const range = sel.getRangeAt(0);
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
    const rawHtml = container.innerHTML;
    const normalizedHtml = normalizePayloadHtml({ text, html: rawHtml });
    return {
      title: text.length > 80 ? `${text.slice(0, 80).trimEnd()}…` : text,
      text,
      html: normalizedHtml,
      section_html: normalizedHtml,
      source: { scope: "selection" }
    };
  } catch {
    return null;
  }
}

function attachPayloadToTransfer(dataTransfer: DataTransfer, payload: CoderPayload): void {
  try {
    const serialized = JSON.stringify(payload);
    dataTransfer.setData(CODER_MIME, serialized);
    dataTransfer.setData("text/plain", payload.text || "");
    dataTransfer.setData("text/html", payload.html || "");
  } catch {
    // best effort only
  }
}

export function attachGlobalCoderDragSources(): () => void {
  const onDragStart = (ev: DragEvent) => {
    if (!ev || !ev.dataTransfer) return;
    if (isInsideCoderPanel(ev.target as Element | null)) return;
    const payload = buildPayloadFromSelection();
    if (!payload) return;
    attachPayloadToTransfer(ev.dataTransfer, payload);
    ev.dataTransfer.effectAllowed = "copy";
  };

  const onCopy = (ev: ClipboardEvent) => {
    if (!ev || !ev.clipboardData) return;
    if (isInsideCoderPanel(ev.target as Element | null)) return;
    const payload = buildPayloadFromSelection();
    if (!payload) return;
    attachPayloadToTransfer(ev.clipboardData, payload);
    ev.preventDefault();
  };

  document.addEventListener("dragstart", onDragStart);
  document.addEventListener("copy", onCopy);

  return () => {
    document.removeEventListener("dragstart", onDragStart);
    document.removeEventListener("copy", onCopy);
  };
}
