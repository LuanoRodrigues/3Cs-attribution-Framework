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
    "  ts-node src/main/systematicReviewCli.ts compose <runDir> <checklistPath> [prismaFlowImagePath]",
    "  ts-node src/main/systematicReviewCli.ts audit <runDir>",
    "  ts-node src/main/systematicReviewCli.ts remediate <runDir>",
    "  ts-node src/main/systematicReviewCli.ts steps-1-15 <runDir> <checklistPath> [reviewerCount] [prismaFlowImagePath]",
    "  ts-node src/main/systematicReviewCli.ts full-run <runDir> <checklistPath> [maxIterations] [prismaFlowImagePath] [collectionName] [temporal]"
  ].join("\n");
}

function parseOptionalBoolean(raw: string | undefined): boolean | undefined {
  const txt = String(raw || "").trim();
  if (!txt) return undefined;
  if (/^(1|true|yes|on|temporal|chronological)$/i.test(txt)) return true;
  if (/^(0|false|no|off)$/i.test(txt)) return false;
  return undefined;
}

async function main(): Promise<void> {
  const [cmd, runDirRaw, checklistRaw, iterRaw, prismaFlowImageRaw, collectionNameRaw, temporalRaw] = process.argv.slice(2);
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
    const composeImagePath = iterRaw ? path.resolve(iterRaw) : "";
    const out = composeFullPaper(runDir, checklistPath, { prismaFlowImagePath: composeImagePath });
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
      maxIterations: Number(iterRaw || 3),
      prismaFlowImagePath: prismaFlowImageRaw ? path.resolve(prismaFlowImageRaw) : "",
      collectionName: String(collectionNameRaw || "").trim(),
      temporal: parseOptionalBoolean(temporalRaw)
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
      reviewerCount: Number(iterRaw || 2),
      prismaFlowImagePath: prismaFlowImageRaw ? path.resolve(prismaFlowImageRaw) : ""
    });
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.status === "ok" ? 0 : 1);
  }

  console.error(usage());
  process.exit(1);
}

void main();
