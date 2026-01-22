"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSourceViewModal = void 0;
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const getFocusableElements = (container) => Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => !element.hasAttribute("disabled") &&
    element.getAttribute("aria-hidden") !== "true" &&
    element.tabIndex >= 0);
const ensureSourceViewStyles = () => {
    if (document.getElementById("leditor-source-view-styles"))
        return;
    const style = document.createElement("style");
    style.id = "leditor-source-view-styles";
    style.textContent = `
.leditor-source-view-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 10, 14, 0.9);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 1200;
}
.leditor-source-view-panel {
  width: min(960px, 100%);
  max-height: 90vh;
  background: #0f1116;
  color: #f5f5f5;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.leditor-source-view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.leditor-source-view-close {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 10px;
}
.leditor-source-view-tabs {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #13161e;
}
.leditor-source-view-tab {
  appearance: none;
  border: none;
  background: rgba(255, 255, 255, 0.05);
  color: #f5f5f5;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.leditor-source-view-tab.is-active {
  background: rgba(165, 211, 255, 0.2);
  color: #a5d3ff;
}
.leditor-source-view-body {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #0b0d13;
}
.leditor-source-view-text {
  flex: 1;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: #090b12;
  color: #e6ecff;
  font-size: 13px;
  font-family: "Courier New", Consolas, "Menlo", monospace;
  padding: 12px;
  resize: none;
  outline: none;
  box-sizing: border-box;
}
`;
    document.head.appendChild(style);
};
const createSourceViewModal = (editorHandle) => {
    ensureSourceViewStyles();
    const overlay = document.createElement("div");
    overlay.className = "leditor-source-view-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Source view");
    overlay.setAttribute("aria-hidden", "true");
    overlay.tabIndex = -1;
    const panel = document.createElement("div");
    panel.className = "leditor-source-view-panel";
    panel.tabIndex = -1;
    const header = document.createElement("div");
    header.className = "leditor-source-view-header";
    header.textContent = "Source view";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "leditor-source-view-close";
    closeBtn.textContent = "Close";
    closeBtn.setAttribute("aria-label", "Close source view dialog");
    header.appendChild(closeBtn);
    const tabs = document.createElement("div");
    tabs.className = "leditor-source-view-tabs";
    const body = document.createElement("div");
    body.className = "leditor-source-view-body";
    const tabDefinitions = [
        { key: "html", label: "HTML" },
        { key: "markdown", label: "Markdown" },
        { key: "json", label: "JSON" }
    ];
    const textareaMap = new Map();
    const tabButtons = new Map();
    let activeTab = "html";
    const switchTab = (tab) => {
        activeTab = tab;
        tabButtons.forEach((button, key) => {
            if (key === tab) {
                button.classList.add("is-active");
            }
            else {
                button.classList.remove("is-active");
            }
        });
        textareaMap.forEach((area, key) => {
            area.style.display = key === tab ? "block" : "none";
        });
    };
    tabDefinitions.forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "leditor-source-view-tab";
        button.textContent = entry.label;
        button.dataset.tab = entry.key;
        button.addEventListener("click", () => switchTab(entry.key));
        tabs.appendChild(button);
        tabButtons.set(entry.key, button);
        const textarea = document.createElement("textarea");
        textarea.className = "leditor-source-view-text";
        textarea.readOnly = true;
        textarea.dataset.tab = entry.key;
        textarea.style.display = "none";
        textarea.rows = 10;
        textarea.wrap = "off";
        body.appendChild(textarea);
        textareaMap.set(entry.key, textarea);
    });
    panel.append(header, tabs, body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const updateContent = () => {
        const html = editorHandle.getContent({ format: "html" });
        const htmlValue = typeof html === "string" ? html : "";
        const markdown = editorHandle.getContent({ format: "markdown" });
        const markdownValue = typeof markdown === "string" ? markdown : "";
        const jsonValue = JSON.stringify(editorHandle.getJSON(), null, 2);
        textareaMap.get("html").value = htmlValue;
        textareaMap.get("markdown").value = markdownValue;
        textareaMap.get("json").value = jsonValue;
    };
    const trapFocus = (event) => {
        if (event.key !== "Tab")
            return;
        const focusable = getFocusableElements(panel);
        if (focusable.length === 0)
            return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey) {
            if (!active || active === first || !panel.contains(active)) {
                event.preventDefault();
                last.focus();
            }
            return;
        }
        if (!active || active === last || !panel.contains(active)) {
            event.preventDefault();
            first.focus();
        }
    };
    const handleKeydown = (event) => {
        if (event.key === "Escape") {
            controller.close();
        }
    };
    let lastActiveElement = null;
    let controller;
    controller = {
        open() {
            lastActiveElement = document.activeElement;
            updateContent();
            overlay.style.display = "flex";
            overlay.setAttribute("aria-hidden", "false");
            switchTab(activeTab);
            document.addEventListener("keydown", handleKeydown);
            panel.addEventListener("keydown", trapFocus);
            const focusable = getFocusableElements(panel);
            (focusable.length > 0 ? focusable[0] : closeBtn).focus();
        },
        close() {
            overlay.style.display = "none";
            overlay.setAttribute("aria-hidden", "true");
            document.removeEventListener("keydown", handleKeydown);
            panel.removeEventListener("keydown", trapFocus);
            lastActiveElement?.focus();
        },
        toggle() {
            if (overlay.style.display === "flex") {
                controller.close();
            }
            else {
                controller.open();
            }
        },
        isOpen() {
            return overlay.style.display === "flex";
        }
    };
    closeBtn.addEventListener("click", () => controller.close());
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
            controller.close();
        }
    });
    return controller;
};
exports.createSourceViewModal = createSourceViewModal;
