import { mountEditor } from "../ui/renderer.ts";

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
  window.addEventListener("error", (event) => {
    if (window.leditorHost?.writePhaseMarker) {
      window.leditorHost.writePhaseMarker(
        "phase2_bootstrap_error.txt",
        String(event.error ?? event.message)
      );
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (window.leditorHost?.writePhaseMarker) {
      window.leditorHost.writePhaseMarker(
        "phase2_bootstrap_error.txt",
        String(event.reason ?? "Unhandled rejection")
      );
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
