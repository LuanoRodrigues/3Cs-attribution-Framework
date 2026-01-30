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

const dbg = (fn: string, msg: string, extra?: Record<string, unknown>) => {
  const line = `[renderer-entry.ts][${fn}][debug] ${msg}`;
  if (extra) {
    console.debug(line, extra);
  } else {
    console.debug(line);
  }
};

const g = globalThis as typeof globalThis & { __leditorRendererEntryLoaded?: boolean };
if (g.__leditorRendererEntryLoaded) {
  dbg("entry", "already loaded; skipping duplicate entry.");
} else {
  const isDevtoolsDocument = () => {
    if (typeof window === "undefined") return false;
    const protocol = String(window.location?.protocol || "").toLowerCase();
    const href = String(window.location?.href || "").toLowerCase();
    return (
      protocol === "devtools:" ||
      protocol === "chrome-devtools:" ||
      href.startsWith("devtools://") ||
      href.startsWith("chrome-devtools://")
    );
  };
  // Never attempt to mount the app in a Chromium DevTools document.
  // In Electron/Chromium, DevTools can host its own renderer context.
  if (isDevtoolsDocument()) {
    g.__leditorRendererEntryLoaded = true;
    dbg("entry", "devtools document detected; skipping mount.");
  } else {
  g.__leditorRendererEntryLoaded = true;
  dbg("entry", "loaded", { buildTime: __BUILD_TIME__ });
  // Electron/Chromium may disable `prompt()` / `alert()` in some environments (e.g. WSL).
  // Wrap them to avoid hard crashes inside command handlers.
  try {
    const originalPrompt = window.prompt?.bind(window);
    window.prompt = ((message?: string, defaultValue?: string) => {
      try {
        return originalPrompt ? originalPrompt(message, defaultValue) : null;
      } catch {
        dbg("prompt", "prompt() is not supported in this environment.");
        return null;
      }
    }) as any;
    const originalAlert = window.alert?.bind(window);
    window.alert = ((message?: any) => {
      try {
        return originalAlert ? originalAlert(message) : undefined;
      } catch {
        dbg("alert", "alert() is not supported in this environment.", { messageType: typeof message });
        return undefined;
      }
    }) as any;
  } catch {
    // ignore
  }
  import("../src/ui/renderer.ts")
    .then(({ mountEditor }) => {
      let hasMounted = false;
      const mountOnce = () => {
        if (hasMounted) return;
        hasMounted = true;
        dbg("mountOnce", "mounting editor");
        mountEditor();
      };
      window.__leditorMountEditor = mountOnce;
      if (window.__leditorAutoMount !== false) {
        mountOnce();
      }
    })
    .catch((error) => {
      console.error("[renderer-entry.ts][entry][debug] mount failed", error);
    });
}
}
