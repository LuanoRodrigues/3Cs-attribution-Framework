import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rewriteImports = (source, sourcePath) => {
  let out = source.replace(
    /(from\s+["']\.{1,2}\/[^"']+)\.ts(["'])/g,
    "$1.mts$2"
  );
  if (sourcePath.endsWith(path.join("src", "layout-v2", "paginate", "page-setup.ts"))) {
    out = out.replace(
      "{ mmToTwips, normalizeTwips, ptToTwips, RectTwips, TWIPS_PER_INCH, twipsToPx }",
      "{ mmToTwips, normalizeTwips, ptToTwips, type RectTwips, TWIPS_PER_INCH, twipsToPx }"
    );
  }
  return out;
};

const copyTsTree = (sourceRoot, destRoot) => {
  mkdirSync(destRoot, { recursive: true });
  const entries = readdirSync(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const destPath = path.join(destRoot, entry.name);
    if (entry.isDirectory()) {
      copyTsTree(sourcePath, destPath);
      continue;
    }
    if (!entry.isFile() || !sourcePath.endsWith(".ts")) continue;
    const source = readFileSync(sourcePath, "utf8");
    const rewritten = rewriteImports(source, sourcePath);
    const mtsPath = `${destPath.slice(0, -3)}.mts`;
    mkdirSync(path.dirname(mtsPath), { recursive: true });
    writeFileSync(mtsPath, rewritten, "utf8");
  }
};

export const prepareLayoutV2Entry = (repoRoot) => {
  const runtimeRoot = mkdtempSync(path.join(tmpdir(), "layout-v2-runtime-"));

  const srcLayoutRoot = path.join(repoRoot, "src", "layout-v2");
  const srcUtilsPageUnits = path.join(repoRoot, "src", "utils", "pageUnits.ts");
  const scriptsEntry = path.join(repoRoot, "scripts", "layout_v2_snapshot_entry.ts");

  if (!existsSync(srcLayoutRoot)) {
    throw new Error(`layout-v2 source tree missing: ${srcLayoutRoot}`);
  }
  if (!existsSync(srcUtilsPageUnits)) {
    throw new Error(`pageUnits source missing: ${srcUtilsPageUnits}`);
  }
  if (!existsSync(scriptsEntry)) {
    throw new Error(`snapshot entry missing: ${scriptsEntry}`);
  }

  copyTsTree(srcLayoutRoot, path.join(runtimeRoot, "src", "layout-v2"));

  const pageUnitsSource = readFileSync(srcUtilsPageUnits, "utf8");
  const pageUnitsOut = path.join(runtimeRoot, "src", "utils", "pageUnits.mts");
  mkdirSync(path.dirname(pageUnitsOut), { recursive: true });
  writeFileSync(pageUnitsOut, rewriteImports(pageUnitsSource, srcUtilsPageUnits), "utf8");

  const entrySource = readFileSync(scriptsEntry, "utf8");
  const entryOut = path.join(runtimeRoot, "scripts", "layout_v2_snapshot_entry.mts");
  mkdirSync(path.dirname(entryOut), { recursive: true });
  writeFileSync(entryOut, rewriteImports(entrySource, scriptsEntry), "utf8");

  return pathToFileURL(entryOut).href;
};
