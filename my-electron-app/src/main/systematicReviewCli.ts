import path from "path";
import {
  auditPrisma,
  composeFullPaper,
  executeSystematicSteps1To15,
  remediatePrisma,
  runFullSystematicWorkflow
} from "./services/systematicReview";

function usage(): string {
  return [
    "Usage:",
    "  ts-node src/main/systematicReviewCli.ts compose <runDir> <checklistPath>",
    "  ts-node src/main/systematicReviewCli.ts audit <runDir>",
    "  ts-node src/main/systematicReviewCli.ts remediate <runDir>",
    "  ts-node src/main/systematicReviewCli.ts steps-1-15 <runDir> <checklistPath> [reviewerCount]",
    "  ts-node src/main/systematicReviewCli.ts full-run <runDir> <checklistPath> [maxIterations]"
  ].join("\n");
}

async function main(): Promise<void> {
  const [cmd, runDirRaw, checklistRaw, iterRaw] = process.argv.slice(2);
  const runDir = runDirRaw ? path.resolve(runDirRaw) : "";
  const checklistPath = checklistRaw ? path.resolve(checklistRaw) : "";

  if (!cmd) {
    console.error(usage());
    process.exit(1);
  }

  if (cmd === "compose") {
    if (!runDir || !checklistPath) {
      console.error(usage());
      process.exit(1);
    }
    const out = composeFullPaper(runDir, checklistPath);
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.status === "ok" ? 0 : 1);
  }

  if (cmd === "audit") {
    if (!runDir) {
      console.error(usage());
      process.exit(1);
    }
    const out = auditPrisma(runDir);
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.status === "ok" ? 0 : 1);
  }

  if (cmd === "remediate") {
    if (!runDir) {
      console.error(usage());
      process.exit(1);
    }
    const out = remediatePrisma(runDir);
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.status === "ok" ? 0 : 1);
  }

  if (cmd === "full-run") {
    if (!runDir || !checklistPath) {
      console.error(usage());
      process.exit(1);
    }
    const out = runFullSystematicWorkflow({
      runDir,
      checklistPath,
      maxIterations: Number(iterRaw || 3)
    });
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.status === "ok" ? 0 : 1);
  }

  if (cmd === "steps-1-15") {
    if (!runDir || !checklistPath) {
      console.error(usage());
      process.exit(1);
    }
    const out = executeSystematicSteps1To15({
      runDir,
      checklistPath,
      reviewerCount: Number(iterRaw || 2)
    });
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.status === "ok" ? 0 : 1);
  }

  console.error(usage());
  process.exit(1);
}

void main();
