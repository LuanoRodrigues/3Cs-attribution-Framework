import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const entry = path.join(__dirname, "layout_v2_snapshot_entry.ts");
const outFile = path.join(__dirname, ".layout_v2_snapshot.bundle.mjs");

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  outfile: outFile,
  sourcemap: false
});

const mod = await import(`${pathToFileURL(outFile).href}?t=${Date.now()}`);
if (typeof mod.run === "function") {
  mod.run();
} else {
  throw new Error("layout_v2_snapshot_entry did not export run()");
}
