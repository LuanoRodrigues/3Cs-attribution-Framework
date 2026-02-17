import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prepareLayoutV2Entry } from "./layout_v2_ts_runtime.mjs";

const makeFixtureRoot = () => mkdtempSync(path.join(tmpdir(), "layout-v2-runtime-test-"));

const removeTree = (dirPath) => {
  if (!dirPath || !existsSync(dirPath)) return;
  rmSync(dirPath, { recursive: true, force: true });
};

test("prepareLayoutV2Entry rewrites .ts imports and preserves page-setup type import", () => {
  const fixtureRoot = makeFixtureRoot();
  let runtimeRoot = "";
  try {
    mkdirSync(path.join(fixtureRoot, "src", "layout-v2", "paginate"), { recursive: true });
    mkdirSync(path.join(fixtureRoot, "src", "utils"), { recursive: true });
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });

    writeFileSync(
      path.join(fixtureRoot, "src", "layout-v2", "index.ts"),
      [
        'import { pageSetup } from "./paginate/page-setup.ts";',
        "export const runLayout = () => pageSetup;"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      path.join(fixtureRoot, "src", "layout-v2", "paginate", "page-setup.ts"),
      [
        'import { mmToTwips, normalizeTwips, ptToTwips, RectTwips, TWIPS_PER_INCH, twipsToPx } from "../../utils/pageUnits.ts";',
        "export const pageSetup = TWIPS_PER_INCH + mmToTwips(1) + ptToTwips(1) + normalizeTwips(twipsToPx(1));",
        "export type PageRect = RectTwips;"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      path.join(fixtureRoot, "src", "utils", "pageUnits.ts"),
      [
        "export type RectTwips = { x: number };",
        "export const mmToTwips = (n: number) => n;",
        "export const normalizeTwips = (n: number) => n;",
        "export const ptToTwips = (n: number) => n;",
        "export const TWIPS_PER_INCH = 1440;",
        "export const twipsToPx = (n: number) => n;"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      path.join(fixtureRoot, "scripts", "layout_v2_snapshot_entry.ts"),
      [
        'import { runLayout } from "../src/layout-v2/index.ts";',
        "export const run = () => runLayout();"
      ].join("\n"),
      "utf8"
    );

    const entryUrl = prepareLayoutV2Entry(fixtureRoot);
    const entryPath = fileURLToPath(entryUrl);
    runtimeRoot = path.resolve(entryPath, "..", "..");

    assert.ok(entryPath.endsWith(path.join("scripts", "layout_v2_snapshot_entry.mts")));
    assert.ok(existsSync(entryPath));

    const entrySource = readFileSync(entryPath, "utf8");
    assert.match(entrySource, /\.\.\/src\/layout-v2\/index\.mts/);
    assert.ok(!entrySource.includes(".ts\""));
    assert.ok(!entrySource.includes(".ts'"));

    const pageSetupPath = path.join(runtimeRoot, "src", "layout-v2", "paginate", "page-setup.mts");
    assert.ok(existsSync(pageSetupPath));
    const pageSetupSource = readFileSync(pageSetupPath, "utf8");
    assert.match(pageSetupSource, /type RectTwips/);
    assert.match(pageSetupSource, /\.\.\/\.\.\/utils\/pageUnits\.mts/);

    const indexPath = path.join(runtimeRoot, "src", "layout-v2", "index.mts");
    assert.ok(existsSync(indexPath));
    const indexSource = readFileSync(indexPath, "utf8");
    assert.match(indexSource, /\.\/paginate\/page-setup\.mts/);
  } finally {
    removeTree(runtimeRoot);
    removeTree(fixtureRoot);
  }
});

test("prepareLayoutV2Entry fails fast when required source trees are missing", () => {
  const fixtureRoot = makeFixtureRoot();
  try {
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    writeFileSync(path.join(fixtureRoot, "scripts", "layout_v2_snapshot_entry.ts"), "export const run = () => null;", "utf8");
    assert.throws(() => prepareLayoutV2Entry(fixtureRoot), /layout-v2 source tree missing/);

    mkdirSync(path.join(fixtureRoot, "src", "layout-v2"), { recursive: true });
    writeFileSync(path.join(fixtureRoot, "src", "layout-v2", "index.ts"), "export {};", "utf8");
    assert.throws(() => prepareLayoutV2Entry(fixtureRoot), /pageUnits source missing/);
  } finally {
    removeTree(fixtureRoot);
  }
});
