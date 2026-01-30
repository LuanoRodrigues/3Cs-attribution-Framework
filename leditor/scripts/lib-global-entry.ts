import * as LEditor from "./lib-entry.ts";

// CDN-friendly "global" module: when loaded with `<script type="module" ...>`,
// it also attaches the API to `globalThis.LEditor`.
(globalThis as any).LEditor = LEditor;

export * from "./lib-entry.ts";

