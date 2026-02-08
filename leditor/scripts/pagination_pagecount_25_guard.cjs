const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const guardPath = path.join(repoRoot, "scripts", "pagination_pagecount_guard.cjs");

const env = {
  ...process.env,
  EXPECTED_PAGE_COUNT: "25",
  FORCE_PAGES: "25"
};

const result = spawnSync("node", [guardPath], {
  cwd: repoRoot,
  env,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
