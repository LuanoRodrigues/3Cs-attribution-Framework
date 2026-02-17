import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLayoutV2Entry } from "./layout_v2_ts_runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const entryUrl = prepareLayoutV2Entry(repoRoot);

const mod = await import(`${entryUrl}?t=${Date.now()}`);
if (typeof mod.run === "function") {
  mod.run();
} else {
  throw new Error("layout_v2_snapshot_entry did not export run()");
}
