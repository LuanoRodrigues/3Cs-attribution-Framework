"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountStatusBar = void 0;
const stats_js_1 = require("../editor/stats.js");
const ensureStatusBarStyles = () => {
    if (document.getElementById("leditor-statusbar-styles"))
        return;
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
const mountStatusBar = (editorHandle, layout) => {
    ensureStatusBarStyles();
    const bar = document.createElement("div");
    bar.className = "leditor-status-bar";
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
    const zoomInput = document.createElement("input");
    zoomInput.type = "text";
    zoomInput.value = "100%";
    const zoomIn = document.createElement("button");
    zoomIn.type = "button";
    zoomIn.textContent = "+";
    const viewSelect = document.createElement("select");
    const viewOptions = [
        { label: "Single Page", value: "single" },
        { label: "Page Width", value: "fit-width" },
        { label: "Two Page", value: "two-page" }
    ];
    viewOptions.forEach((option) => {
        const item = document.createElement("option");
        item.value = option.value;
        item.textContent = option.label;
        viewSelect.appendChild(item);
    });
    zoomGroup.appendChild(zoomOut);
    zoomGroup.appendChild(zoomInput);
    zoomGroup.appendChild(zoomIn);
    zoomGroup.appendChild(viewSelect);
    bar.appendChild(statsGroup);
    bar.appendChild(zoomGroup);
    document.body.appendChild(bar);
    let last = "";
    let changeCount = 0;
    let logged = false;
    const updateStats = () => {
        const stats = (0, stats_js_1.computeStats)(editorHandle.getJSON());
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
    const handleZoomStep = (direction) => {
        if (!layout)
            return;
        const step = 0.1;
        const next = layout.getZoom() + direction * step;
        layout.setZoom(next);
        zoomInput.value = `${Math.round(layout.getZoom() * 100)}%`;
    };
    zoomOut.addEventListener("click", () => handleZoomStep(-1));
    zoomIn.addEventListener("click", () => handleZoomStep(1));
    zoomInput.addEventListener("change", () => {
        if (!layout)
            return;
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
        if (!layout)
            return;
        layout.setViewMode(viewSelect.value);
    });
    const handleKeydown = (event) => {
        if (!layout)
            return;
        if (!event.ctrlKey)
            return;
        if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            handleZoomStep(1);
        }
        else if (event.key === "-") {
            event.preventDefault();
            handleZoomStep(-1);
        }
    };
    const handleWheel = (event) => {
        if (!layout || !event.ctrlKey)
            return;
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
exports.mountStatusBar = mountStatusBar;
