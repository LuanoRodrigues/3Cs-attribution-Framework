if (typeof globalThis !== "undefined") {
  const g = globalThis as typeof globalThis & { process?: NodeJS.Process };
  if (!g.process) {
    g.process = { env: {} } as NodeJS.Process;
  } else if (!g.process.env) {
    g.process.env = {};
  }
}

declare global {
  interface Window {
    __leditorMountEditor?: () => void;
    __leditorAutoMount?: boolean;
  }
}

declare const __BUILD_TIME__: string;

const g = globalThis as typeof globalThis & { __leditorRendererEntryLoaded?: boolean };
if (g.__leditorRendererEntryLoaded) {
  console.warn("[renderer-entry] already loaded; skipping duplicate entry.");
} else {
  g.__leditorRendererEntryLoaded = true;
  // Simple build marker to prove which bundle is currently running.
  console.info("[renderer-entry] loaded", { buildTime: __BUILD_TIME__ });
  import("../src/ui/renderer.ts")
    .then(({ mountEditor }) => {
      let hasMounted = false;
      const mountOnce = () => {
        if (hasMounted) return;
        hasMounted = true;
        mountEditor();
      };
      window.__leditorMountEditor = mountOnce;
      if (window.__leditorAutoMount !== false) {
        mountOnce();
      }
    })
    .catch((error) => {
      console.error("[renderer-entry] mount failed", error);
    });
}
