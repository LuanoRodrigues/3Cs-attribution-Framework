if (typeof globalThis !== "undefined") {
  const g = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
  if (!g.process) {
    g.process = { env: {} };
  } else if (!g.process.env) {
    g.process.env = {};
  }
}

import("../src/ui/renderer.ts")
  .then(({ mountEditor }) => mountEditor())
  .catch((error) => {
    console.error("[renderer-entry] mount failed", error);
  });
