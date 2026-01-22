import type { EditorHandle } from "../api/leditor.js";

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

type PreviewController = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
};

type PhaseFlags = {
  opened: boolean;
  hasHtml: boolean;
  logged: boolean;
};

const phaseFlags: PhaseFlags = {
  opened: false,
  hasHtml: false,
  logged: false
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.tabIndex >= 0
  );

const ensurePreviewStyles = () => {
  if (document.getElementById("leditor-preview-styles")) return;
  const style = document.createElement("style");
  style.id = "leditor-preview-styles";
  style.textContent = `
.leditor-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 28, 0.75);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 24px;
}
.leditor-preview-panel {
  background: #fbf7ee;
  color: #1b1b1b;
  border: 1px solid #cbbf9a;
  max-width: 900px;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.leditor-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #d8cba8;
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 14px;
  background: #f2e8d3;
}
.leditor-preview-close {
  border: 1px solid #8c7a53;
  background: #eadbb8;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.leditor-preview-content {
  padding: 20px 24px;
  overflow: auto;
  font-family: "Georgia", "Times New Roman", serif;
  background: #fffdfa;
}
`;
  document.head.appendChild(style);
};

export const createPreviewModal = (editorHandle: EditorHandle): PreviewController => {
  ensurePreviewStyles();

  const overlay = document.createElement("div");
  overlay.className = "leditor-preview-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Print preview");
  overlay.setAttribute("aria-hidden", "true");
  overlay.tabIndex = -1;

  const panel = document.createElement("div");
  panel.className = "leditor-preview-panel";
  panel.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "leditor-preview-header";
  header.textContent = "Preview";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-preview-close";
  closeBtn.textContent = "Close";
  closeBtn.setAttribute("aria-label", "Close preview dialog");

  const content = document.createElement("div");
  content.className = "leditor-preview-content";

  header.appendChild(closeBtn);
  panel.appendChild(header);
  panel.appendChild(content);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const trapFocus = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const focusable = getFocusableElements(panel);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
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

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      controller.close();
    }
  };

  const maybeLogPhase = () => {
    if (phaseFlags.logged) return;
    if (phaseFlags.opened && phaseFlags.hasHtml) {
      window.codexLog?.write("[PHASE14_OK]");
      phaseFlags.logged = true;
    }
  };

  let lastActiveElement: HTMLElement | null = null;
  let controller: PreviewController;
  controller = {
    open() {
      lastActiveElement = document.activeElement as HTMLElement | null;
      const html = editorHandle.getContent({ format: "html" });
      const htmlString = typeof html === "string" ? html : "";
      content.innerHTML = htmlString;
      overlay.style.display = "flex";
      overlay.setAttribute("aria-hidden", "false");
      phaseFlags.opened = true;
      if (htmlString.trim().length > 0) {
        phaseFlags.hasHtml = true;
      }
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
      maybeLogPhase();
      lastActiveElement?.focus();
    },
    toggle() {
      if (overlay.style.display === "none" || overlay.style.display === "") {
        controller.open();
      } else {
        controller.close();
      }
    },
    isOpen() {
      return overlay.style.display !== "none" && overlay.style.display !== "";
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
