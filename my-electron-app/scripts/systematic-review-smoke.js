#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const runDir = process.argv[2] || "/home/pantera/annotarium/analyse/frameworks_and_models/systematic_review";
const checklistPath = process.argv[3] || path.resolve(process.cwd(), "../Research/Systematic_review/prisma_check_list.html");
const cliPath = path.resolve(process.cwd(), "src/main/systematicReviewCli.ts");

const tsNodeEntrypoint = require.resolve("ts-node/dist/bin.js", { paths: [process.cwd()] });
const run = spawnSync(process.execPath, [tsNodeEntrypoint, cliPath, "full-run", runDir, checklistPath, "2"], {
  cwd: process.cwd(),
  stdio: "pipe",
  encoding: "utf8"
});

process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");
if (run.error) {
  console.error("[systematic-review-smoke] spawn error:", run.error.message || run.error);
}

if (run.status !== 0) {
  console.error("[systematic-review-smoke] full-run failed");
  process.exit(run.status || 1);
}

const required = [
  "systematic_review_paper_v1.json",
  "systematic_review_full_paper.md",
  "systematic_review_full_paper.html",
  "prisma_checklist_registry.json",
  "prisma_evidence_map.json",
  "prisma_compliance_report.json",
  "prisma_compliance_report.md",
  "systematic_review_bundle_manifest.json"
];

const missing = required.filter((name) => !fs.existsSync(path.join(runDir, name)));
if (missing.length) {
  console.error("[systematic-review-smoke] missing artifacts:", missing.join(", "));
  process.exit(2);
}
console.log("[systematic-review-smoke] ok");
