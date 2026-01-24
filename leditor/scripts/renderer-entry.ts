if (typeof globalThis !== "undefined") {
  const g = globalThis as typeof globalThis & { process?: NodeJS.Process };
  if (!g.process) {
    g.process = { env: {} } as NodeJS.Process;
  } else if (!g.process.env) {
    g.process.env = {};
  }
}

import("../src/ui/renderer.ts")
  .then(({ mountEditor }) => mountEditor())
  .catch((error) => {
    console.error("[renderer-entry] mount failed", error);
  });
