const fs = require("fs");
const path = require("path");

const srcPath = path.join(__dirname, "..", "src", "ui", "personas.json");
const destDir = path.join(__dirname, "..", "dist", "ui");
const destPath = path.join(destDir, "personas.json");

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

try {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Missing personas.json at ${srcPath}`);
  }
  ensureDir(destDir);
  fs.copyFileSync(srcPath, destPath);
  console.log(`[copy-personas] Copied to ${destPath}`);
} catch (err) {
  console.error(`[copy-personas] Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
