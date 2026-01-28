// Minimal prelude shim for the embedded LEditor bundle.
// Keep lightweight: just ensure globals exist before vendor/renderer load.
if (typeof globalThis !== "undefined") {
  const g = globalThis as typeof globalThis & { process?: NodeJS.Process };
  if (!g.process) {
    g.process = { env: {} } as NodeJS.Process;
  } else if (!g.process.env) {
    g.process.env = {};
  }
}
