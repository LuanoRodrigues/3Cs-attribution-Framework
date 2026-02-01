import type { EditorHandle } from "../api/leditor.ts";

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

export const createPreviewModal = (editorHandle: EditorHandle): PreviewController => {
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
      overlay.classList.add("is-open");
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
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", handleKeydown);
      panel.removeEventListener("keydown", trapFocus);
      maybeLogPhase();
      lastActiveElement?.focus();
    },
    toggle() {
      if (!overlay.classList.contains("is-open")) {
        controller.open();
      } else {
        controller.close();
      }
    },
    isOpen() {
      return overlay.classList.contains("is-open");
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
