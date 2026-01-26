import type { EditorHandle } from "../legacy/api/leditor.js";
import type { A4LayoutController, A4ViewMode } from "./a4_layout.ts";
import { computeStats } from "../legacy/editor/stats.js";

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

const getZoomRanges = () => {
  const styles = getComputedStyle(document.documentElement);
  const parseValue = (name: string, fallback: number) => {
    const raw = styles.getPropertyValue(name).trim();
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    min: parseValue('--min-zoom', 0.3),
    max: parseValue('--max-zoom', 3),
    step: Math.max(parseValue('--zoom-step', 0.1), 0.01)
  };
}

const ensureStatusBarStyles = () => {
  if (document.getElementById("leditor-statusbar-styles")) return;
  const style = document.createElement("style");
  style.id = "leditor-statusbar-styles";
  style.textContent = `
.leditor-status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 6px 12px;
  background: #1d232a;
  color: #f1e7d0;
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 12px;
  letter-spacing: 0.2px;
  border-top: 1px solid #3b424b;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-sizing: border-box;
}

.leditor-status-bar--embedded {
  position: absolute;
  border-radius: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.leditor-status-group {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.leditor-zoom-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.leditor-zoom-controls button,
.leditor-zoom-controls input,
.leditor-zoom-controls select {
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 12px;
  background: #2a3139;
  color: #f1e7d0;
  border: 1px solid #3b424b;
  border-radius: 4px;
  padding: 2px 6px;
  height: 24px;
  box-sizing: border-box;
}

.leditor-zoom-controls input {
  width: 64px;
  text-align: center;
}

.leditor-status-pages {
  opacity: 0.9;
}
`;
  document.head.appendChild(style);
};

export type MountStatusBarOptions = {
  parent?: HTMLElement | null;
};

export const mountStatusBar = (
  editorHandle: EditorHandle,
  layout?: A4LayoutController | null,
  options?: MountStatusBarOptions
) => {
  ensureStatusBarStyles();
  const bar = document.createElement("div");
  bar.className = "leditor-status-bar";

  const parent = options?.parent ?? document.body;
  const embedded = Boolean(options?.parent && options.parent !== document.body);
  if (embedded) {
    bar.classList.add("leditor-status-bar--embedded");
  }

  const statsGroup = document.createElement("div");
  statsGroup.className = "leditor-status-group";

  const statsLabel = document.createElement("span");
  statsLabel.textContent = "Words: 0 | Chars: 0 | Chars (no spaces): 0";
  statsGroup.appendChild(statsLabel);

  const pagesLabel = document.createElement("span");
  pagesLabel.className = "leditor-status-pages";
  pagesLabel.textContent = "Pages: 1";
  statsGroup.appendChild(pagesLabel);

  const zoomGroup = document.createElement("div");
  zoomGroup.className = "leditor-zoom-controls";

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.textContent = "-";

  const zoomRanges = getZoomRanges();

  const zoomSlider = document.createElement("input");
  zoomSlider.type = "range";
  zoomSlider.className = "leditor-zoom-slider";
  zoomSlider.min = String(Math.round(zoomRanges.min * 100));
  zoomSlider.max = String(Math.round(zoomRanges.max * 100));
  zoomSlider.step = String(Math.round(zoomRanges.step * 100));
  zoomSlider.value = String(Math.round((layout?.getZoom() ?? 1) * 100));
  zoomSlider.disabled = !layout;

  const zoomInput = document.createElement("input");
  zoomInput.type = "text";
  zoomInput.value = "100%";

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.textContent = "+";

  const viewSelect = document.createElement("select");
  const viewOptions: Array<{ label: string; value: A4ViewMode }> = [
    { label: "One Page", value: "single" },
    { label: "Page Width", value: "fit-width" },
    { label: "Multiple Pages", value: "two-page" }
  ];
  viewOptions.forEach((option) => {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    viewSelect.appendChild(item);
  });

  zoomGroup.appendChild(zoomOut);
  zoomGroup.appendChild(zoomSlider);
  zoomGroup.appendChild(zoomInput);
  zoomGroup.appendChild(zoomIn);
  zoomGroup.appendChild(viewSelect);

  bar.appendChild(statsGroup);
  bar.appendChild(zoomGroup);
  parent.appendChild(bar);

  let last = "";
  let changeCount = 0;
  let logged = false;

  const updateStats = () => {
    const stats = computeStats(editorHandle.getJSON());
    const text = `Words: ${stats.words} | Chars: ${stats.charsWithSpaces} | Chars (no spaces): ${stats.charsNoSpaces}`;
    if (text !== last) {
      last = text;
      statsLabel.textContent = text;
      if (stats.words > 0) {
        changeCount += 1;
        if (!logged && changeCount >= 2) {
          window.codexLog?.write("[PHASE12_OK]");
          logged = true;
        }
      }
    }
    if (layout) {
      pagesLabel.textContent = `Pages: ${layout.getPageCount()}`;
    }
  };

  const handleZoomStep = (direction: 1 | -1) => {
    if (!layout) return;
    const step = 0.1;
    const next = layout.getZoom() + direction * step;
    layout.setZoom(next);
    zoomInput.value = `${Math.round(layout.getZoom() * 100)}%`;
  };

  zoomOut.addEventListener("click", () => handleZoomStep(-1));
  zoomIn.addEventListener("click", () => handleZoomStep(1));

  zoomInput.addEventListener("change", () => {
    if (!layout) return;
    const raw = zoomInput.value.replace("%", "").trim();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      zoomInput.value = `${Math.round(layout.getZoom() * 100)}%`;
      return;
    }
    const next = parsed / 100;
    layout.setZoom(next);
    zoomInput.value = `${Math.round(layout.getZoom() * 100)}%`;
  });

  viewSelect.addEventListener("change", () => {
    if (!layout) return;
    layout.setViewMode(viewSelect.value as A4ViewMode);
  });

  const handleKeydown = (event: KeyboardEvent) => {
    if (!layout) return;
    if (!event.ctrlKey) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      handleZoomStep(1);
    } else if (event.key === "-") {
      event.preventDefault();
      handleZoomStep(-1);
    }
  };

  const handleWheel = (event: WheelEvent) => {
    if (!layout || !event.ctrlKey) return;
    event.preventDefault();
    handleZoomStep(event.deltaY < 0 ? 1 : -1);
  };

  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("wheel", handleWheel, { passive: false });

  editorHandle.on("change", updateStats);
  updateStats();

  if (layout) {
    zoomInput.value = `${Math.round(layout.getZoom() * 100)}%`;
  }
};



