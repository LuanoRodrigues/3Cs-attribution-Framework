const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const electronBin = path.join(repoRoot, "node_modules", ".bin", "electron");

const ledocArg = process.argv[2];
const outArg = process.argv[3];
const ledocPath = ledocArg ? path.resolve(ledocArg) : path.join(repoRoot, "coder_state.ledoc");
const outputPath = outArg ? path.resolve(outArg) : path.join(repoRoot, "pagination_audit_linebreak.json");

const shouldSkipAudit = process.argv.includes("--skip-audit");

const runAudit = () => {
  if (shouldSkipAudit) return;
  if (!fs.existsSync(electronBin)) {
    console.error(`[FAIL] electron binary missing at ${electronBin}`);
    process.exit(1);
  }
  const args = [
    "--disable-setuid-sandbox",
    "--no-sandbox",
    "scripts/pagination_audit.cjs",
    ledocPath,
    outputPath
  ];
  const env = { ...process.env, ELECTRON_DISABLE_SANDBOX: "1" };
  const result = spawnSync(electronBin, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    console.warn(`[WARN] pagination audit exited with status ${result.status}`);
  }
};

const normalizeText = (value) =>
  String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\u00e2\u0080\u0091/g, "-")
    .replace(/\u00e2\u0080\u0093/g, "-")
    .replace(/\u00e2\u0080\u0094/g, "-")
    .replace(/\u00e2\u0080\u0098/g, "'")
    .replace(/\u00e2\u0080\u0099/g, "'")
    .replace(/\u00e2\u0080\u009c/g, "\"")
    .replace(/\u00e2\u0080\u009d/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2013\u2014\u2011]/g, "-")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const assertNoForcedLineBreaks = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] audit output missing at ${outputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  const data = JSON.parse(raw);
  const needle = "Across the literature, a consistent pattern is the absence of clear legal";
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const match = pages.find((page) => {
    if (typeof page.fullText !== "string") return false;
    return normalizeText(page.fullText).includes(normalizeText(needle));
  });
  if (!match) {
    console.error("[FAIL] did not find target paragraph in audit output");
    process.exit(1);
  }
  const blocks = Array.isArray(match.blocks) ? match.blocks : [];
  const brCountInText = blocks
    .filter((block) => Number(block.brCount || 0) > 0)
    .filter((block) => (block.sample || []).join(" ").trim().length > 0)
    .reduce((sum, block) => sum + Number(block.brCount || 0), 0);
  const lineTextCount = Number(match.lineTextCount || 0);
  const singleWordLineCount = Number(match.singleWordLineCount || 0);
  const singleWordRatio = lineTextCount > 0 ? singleWordLineCount / lineTextCount : 0;

  const forcedBreaksDetected =
    brCountInText > 0 || (singleWordLineCount >= 10 && singleWordRatio > 0.5);

  if (forcedBreaksDetected) {
    console.error(
      `[FAIL] forced line breaks detected on pageIndex ${match.pageIndex} (brCountInText=${brCountInText}, singleWordLines=${singleWordLineCount}, totalLines=${lineTextCount}, ratio=${singleWordRatio.toFixed(
        2
      )})`
    );
    process.exit(1);
  }

  console.log("[PASS] no forced line breaks detected in target paragraph page");
};

const assertPageAnchors = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] audit output missing at ${outputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  const data = JSON.parse(raw);
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const anchors = [
    {
      label: "attribution_uncertainty",
      needle: "Attribution uncertainty creates concrete alliance dilemmas",
      expectedPageNumber: 16
    },
    {
      label: "escalation_risk",
      needle: "challenges 3 - risk of escalation",
      expectedPageNumber: 16
    }
  ];
  anchors.forEach((anchor) => {
    const normalizedNeedle = normalizeText(anchor.needle);
    const hit = pages.find((page) =>
      typeof page.fullText === "string" && normalizeText(page.fullText).includes(normalizedNeedle)
    );
    if (!hit) {
      console.error(`[FAIL] ${anchor.label} anchor not found`);
      process.exit(1);
    }
    const pageNumber = hit.pageIndex + 1;
    if (pageNumber !== anchor.expectedPageNumber) {
      console.error(
        `[FAIL] ${anchor.label} anchor expected on page ${anchor.expectedPageNumber} but found on page ${pageNumber}`
      );
      process.exit(1);
    }
  });
  console.log("[PASS] page anchor checks passed");
};

const assertSplitContinuity = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] audit output missing at ${outputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  const data = JSON.parse(raw);
  const pages = Array.isArray(data.pages) ? data.pages : [];

  const getContentBlocks = (page) => {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    return blocks.filter((block) => {
      if (!block) return false;
      if (block.isBreak) return false;
      const className = String(block.className || "");
      if (className.includes("leditor-break")) return false;
      return true;
    });
  };

  const parentIdFor = (nodeId) => {
    if (!nodeId || typeof nodeId !== "string") return null;
    const parts = nodeId.split(":cont:");
    if (parts.length <= 1) return null;
    return parts.slice(0, -1).join(":cont:");
  };

  const errors = [];
  const pageLastBlocks = pages.map((page) => {
    const blocks = getContentBlocks(page);
    return blocks.length ? blocks[blocks.length - 1] : null;
  });

  pages.forEach((page, pageIndex) => {
    const blocks = getContentBlocks(page);
    if (!blocks.length) return;
    const firstBlock = blocks[0];

    blocks.forEach((block, blockIndex) => {
      const nodeId = block.nodeId;
      const parentId = parentIdFor(nodeId);
      if (!parentId) return;

      if (blockIndex !== 0) {
        errors.push(
          `tail fragment ${nodeId} is not first block on page ${pageIndex + 1}`
        );
      }
      if (pageIndex === 0) {
        errors.push(`tail fragment ${nodeId} appears on first page`);
        return;
      }
      const prevLast = pageLastBlocks[pageIndex - 1];
      if (!prevLast || prevLast.nodeId !== parentId) {
        errors.push(
          `tail fragment ${nodeId} does not immediately follow parent ${parentId} (prev page last was ${prevLast?.nodeId || "none"})`
        );
      }
      if (prevLast && prevLast.nodeId === parentId) {
        const prevTag = String(prevLast.tag || "");
        const tailTag = String(block.tag || "");
        if (prevTag && tailTag && prevTag !== tailTag) {
          errors.push(
            `tail fragment ${nodeId} tag ${tailTag} does not match parent tag ${prevTag} on page ${pageIndex + 1}`
          );
        }
      }
    });

    const tailParents = new Set(
      blocks.map((block) => parentIdFor(block.nodeId)).filter((id) => id)
    );
    tailParents.forEach((parentId) => {
      const parentIndex = blocks.findIndex((block) => block.nodeId === parentId);
      if (parentIndex >= 0 && parentIndex !== blocks.length - 1) {
        errors.push(
          `parent fragment ${parentId} is not last block on page ${pageIndex + 1}`
        );
      }
    });

    if (firstBlock.nodeId && parentIdFor(firstBlock.nodeId)) {
      // already validated above; keep for clarity
    }
  });

  if (errors.length) {
    console.error(`[FAIL] split continuity violations:\\n- ${errors.join("\\n- ")}`);
    process.exit(1);
  }
  console.log("[PASS] split continuity checks passed");
};

const assertNoBrInsideParagraphs = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] audit output missing at ${outputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  const data = JSON.parse(raw);
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const offenders = [];
  pages.forEach((page) => {
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    blocks.forEach((block) => {
      if (!block || typeof block !== "object") return;
      const tag = String(block.tag || "");
      if (tag !== "P") return;
      const brCount = Number(block.brCount || 0);
      if (brCount <= 0) return;
      offenders.push({
        pageNumber: page.pageIndex + 1,
        brCount,
        sample: Array.isArray(block.sample) ? block.sample.join(" ") : ""
      });
    });
  });
  if (offenders.length) {
    const lines = offenders.slice(0, 6).map(
      (item) => `page ${item.pageNumber} br=${item.brCount} sample="${item.sample.slice(0, 120)}"`
    );
    console.error(`[FAIL] paragraph <br> detected:\\n- ${lines.join("\\n- ")}`);
    process.exit(1);
  }
  console.log("[PASS] no paragraph <br> detected");
};

const assertNoSingleWordLinesWithCapacity = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] audit output missing at ${outputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  const data = JSON.parse(raw);
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const offenders = [];
  pages.forEach((page) => {
    const remainingLines = Number(page.remainingLines || 0);
    if (!Number.isFinite(remainingLines) || remainingLines < 1) return;
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    blocks.forEach((block) => {
      if (!block || typeof block !== "object") return;
      const tag = String(block.tag || "");
      if (tag !== "P") return;
      const wordCount = Number(block.wordCount || 0);
      const singleWordLines = Number(block.singleWordLines || 0);
      if (wordCount <= 5) return;
      if (singleWordLines <= 0) return;
      offenders.push({
        pageNumber: page.pageIndex + 1,
        singleWordLines,
        remainingLines,
        sample: Array.isArray(block.sample) ? block.sample.join(" ") : ""
      });
    });
  });
  if (offenders.length) {
    const lines = offenders.slice(0, 6).map(
      (item) =>
        `page ${item.pageNumber} singleWordLines=${item.singleWordLines} remainingLines=${item.remainingLines} sample="${item.sample.slice(0, 120)}"`
    );
    console.error(`[FAIL] single-word lines despite remaining capacity:\\n- ${lines.join("\\n- ")}`);
    process.exit(1);
  }
  console.log("[PASS] no single-word lines with remaining capacity");
};

const assertNoExcessSingleWordLinesInParagraphs = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] audit output missing at ${outputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  const data = JSON.parse(raw);
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const offenders = [];
  pages.forEach((page) => {
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    blocks.forEach((block) => {
      if (!block || typeof block !== "object") return;
      const tag = String(block.tag || "");
      if (tag !== "P") return;
      const wordCount = Number(block.wordCount || 0);
      const singleWordLines = Number(block.singleWordLines || 0);
      if (wordCount < 8) return;
      if (singleWordLines < 2) return;
      offenders.push({
        pageNumber: page.pageIndex + 1,
        singleWordLines,
        wordCount,
        sample: Array.isArray(block.sample) ? block.sample.join(" ") : ""
      });
    });
  });
  if (offenders.length) {
    const lines = offenders.slice(0, 6).map(
      (item) =>
        `page ${item.pageNumber} singleWordLines=${item.singleWordLines} wordCount=${item.wordCount} sample="${item.sample.slice(0, 120)}"`
    );
    console.error(`[FAIL] excessive single-word lines in paragraphs:\\n- ${lines.join("\\n- ")}`);
    process.exit(1);
  }
  console.log("[PASS] no excessive single-word lines in paragraphs");
};

runAudit();
assertNoForcedLineBreaks();
assertPageAnchors();
assertSplitContinuity();
assertNoBrInsideParagraphs();
assertNoSingleWordLinesWithCapacity();
assertNoExcessSingleWordLinesInParagraphs();
