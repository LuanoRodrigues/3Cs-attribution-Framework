const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "public");
const outDir = path.join(repoRoot, "dist", "public");

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const copyRecursive = (from, to) => {
  ensureDir(to);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

ensureDir(outDir);
if (fs.existsSync(srcDir)) {
  copyRecursive(srcDir, outDir);
} else {
  console.warn("[copy-public] public/ directory not found; skipping");
}
