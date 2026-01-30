import { mountEditor } from "../ui/renderer.ts";
import { getHostAdapter } from "../host/host_adapter.ts";

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

const boot = async () => {
  window.codexLog?.write("[RENDERER_BOOT]");
  await mountEditor();
};

const setupErrorHandlers = () => {
  let lastErrorAt = 0;
  let lastErrorMessage = "";
  let writtenCount = 0;
  const shouldIgnore = (message: string) => message.includes("reading '__widget'");

  window.addEventListener("error", (event) => {
    try {
      const message = String(event.error ?? event.message ?? "Unknown error");
      if (shouldIgnore(message)) return;
      const now = Date.now();
      if (message === lastErrorMessage && now - lastErrorAt < 3000) return;
      if (writtenCount >= 3) return;
      lastErrorAt = now;
      lastErrorMessage = message;
      writtenCount += 1;
      const host = getHostAdapter();
      host?.writePhaseMarker?.("phase2_bootstrap_error.txt", message);
    } catch {
      // ignore
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    try {
      const message = String(event.reason ?? "Unhandled rejection");
      if (shouldIgnore(message)) return;
      const now = Date.now();
      if (message === lastErrorMessage && now - lastErrorAt < 3000) return;
      if (writtenCount >= 3) return;
      lastErrorAt = now;
      lastErrorMessage = message;
      writtenCount += 1;
      const host = getHostAdapter();
      host?.writePhaseMarker?.("phase2_bootstrap_error.txt", message);
    } catch {
      // ignore
    }
  });
};

setupErrorHandlers();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void boot();
  });
} else {
  void boot();
}
