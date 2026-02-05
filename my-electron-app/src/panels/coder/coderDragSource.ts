import { CODER_MIME } from "./coderTypes";

function isInsideCoderPanel(target?: Element | null): boolean {
  if (!target) return false;
  return Boolean(target.closest?.(".coder-surface"));
}

function buildTextFromSelection(): string | null {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed) {
    return null;
  }
  const text = sel.toString?.() || "";
  if (!text.trim()) {
    return null;
  }
  return text;
}

function attachTextToTransfer(dataTransfer: DataTransfer, text: string): void {
  try {
    // Keep drag/copy fast: avoid cloning DOM ranges to HTML, which can be extremely expensive
    // for large documents and will block the renderer main thread.
    dataTransfer.setData("text/plain", text);
  } catch {
    // best effort only
  }
}

export function attachGlobalCoderDragSources(): () => void {
  const onDragStart = (ev: DragEvent) => {
    if (!ev || !ev.dataTransfer) return;
    if (isInsideCoderPanel(ev.target as Element | null)) return;
    const text = buildTextFromSelection();
    if (!text) return;
    attachTextToTransfer(ev.dataTransfer, text);
    ev.dataTransfer.effectAllowed = "copy";
  };

  const onCopy = (ev: ClipboardEvent) => {
    if (!ev || !ev.clipboardData) return;
    if (isInsideCoderPanel(ev.target as Element | null)) return;
    const text = buildTextFromSelection();
    if (!text) return;
    attachTextToTransfer(ev.clipboardData, text);
    ev.preventDefault();
  };

  document.addEventListener("dragstart", onDragStart);
  document.addEventListener("copy", onCopy);

  return () => {
    document.removeEventListener("dragstart", onDragStart);
    document.removeEventListener("copy", onCopy);
  };
}
