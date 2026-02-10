import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const entry = path.join(__dirname, "layout_v2_snapshot_entry.ts");
const outFile = path.join(__dirname, ".layout_v2_snapshot.bundle.mjs");
const baselinePath = path.join(repoRoot, "docs", "test_documents", "layout_v2_snapshot.json");
const currentPath = path.join(repoRoot, "docs", "test_documents", "layout_v2_snapshot.current.json");

const summarize = (snapshot) => {
  const pages = Array.isArray(snapshot?.layout?.pages) ? snapshot.layout.pages : [];
  return pages.map((page) => {
    const blocks = Array.isArray(page.items) ? page.items : [];
    const lines = blocks.reduce((sum, block) => sum + (block.lines?.length ?? 0), 0);
    const fragments = blocks.reduce(
      (sum, block) =>
        sum +
        (block.lines ?? []).reduce((lineSum, line) => lineSum + (line.fragments?.length ?? 0), 0),
      0
    );
    return { blocks: blocks.length, lines, fragments };
  });
};

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  outfile: outFile,
  sourcemap: false
});

process.env.LAYOUT_V2_SNAPSHOT_OUT = currentPath;
const mod = await import(`${pathToFileURL(outFile).href}?t=${Date.now()}`);
if (typeof mod.run !== "function") {
  throw new Error("layout_v2_snapshot_entry did not export run()");
}
mod.run();

if (!existsSync(baselinePath)) {
  console.error("[layout-v2] baseline snapshot missing:", baselinePath);
  console.error("Run npm run test:layout-v2 to generate it.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const current = JSON.parse(readFileSync(currentPath, "utf8"));

const baselineSummary = summarize(baseline);
const currentSummary = summarize(current);

if (baseline.pageCount !== current.pageCount || baseline.blocks !== current.blocks) {
  console.error("[layout-v2] snapshot summary mismatch");
  console.error("baseline:", { pageCount: baseline.pageCount, blocks: baseline.blocks });
  console.error("current:", { pageCount: current.pageCount, blocks: current.blocks });
  process.exit(1);
}

if (JSON.stringify(baselineSummary) !== JSON.stringify(currentSummary)) {
  console.error("[layout-v2] snapshot layout mismatch");
  console.error("baseline summary:", baselineSummary);
  console.error("current summary:", currentSummary);
  process.exit(1);
}

console.log("[layout-v2] snapshot OK");
