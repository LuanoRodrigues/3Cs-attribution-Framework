const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);

const usage = () => {
  console.log("Usage: node scripts/build-installer.js --os <win|mac>");
  console.log("Example: node scripts/build-installer.js --os win");
};

const readFlagValue = (flag) => {
  const flagWithEquals = args.find((arg) => arg.startsWith(`${flag}=`));
  if (flagWithEquals) {
    return flagWithEquals.split("=").slice(1).join("=");
  }
  const idx = args.indexOf(flag);
  if (idx >= 0 && args[idx + 1]) {
    return args[idx + 1];
  }
  return null;
};

const normalizeTarget = (value) => {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (["win", "windows", "win32"].includes(v)) return "win";
  if (["mac", "macos", "osx", "darwin"].includes(v)) return "mac";
  return null;
};

const target =
  normalizeTarget(readFlagValue("--os")) ||
  normalizeTarget(readFlagValue("--target")) ||
  normalizeTarget(args.find((arg) => !arg.startsWith("--")));

if (!target) {
  usage();
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, "..");
const leditorDir = path.join(repoRoot, "leditor");
const appDir = path.join(repoRoot, "my-electron-app");

const requireDir = (dir, label) => {
  if (!fs.existsSync(dir)) {
    console.error(`Missing ${label} directory at ${dir}`);
    process.exit(1);
  }
};

const run = (command, commandArgs, cwd) => {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", cwd });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const resolveElectronBuilder = () => {
  const binDir = path.join(appDir, "node_modules", ".bin");
  const candidates = [
    path.join(binDir, "electron-builder"),
    path.join(binDir, "electron-builder.cmd")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

requireDir(leditorDir, "leditor");
requireDir(appDir, "my-electron-app");

const builderPath = resolveElectronBuilder();
if (!builderPath) {
  console.error("electron-builder was not found.");
  console.error("Install it with: (cd my-electron-app && npm i -D electron-builder)");
  process.exit(1);
}

console.log("[build-installer] Building leditor assets...");
run("npm", ["run", "build"], leditorDir);
run("npm", ["run", "build:lib"], leditorDir);

console.log("[build-installer] Building Electron app dist...");
run("npm", ["run", "dist"], appDir);

console.log(`[build-installer] Packaging installer for ${target}...`);
const builderArgs = ["--config", "electron-builder.yml", "--publish", "never"];
if (target === "win") {
  builderArgs.push("--win");
} else if (target === "mac") {
  builderArgs.push("--mac");
}
run(builderPath, builderArgs, appDir);

console.log("[build-installer] Done.");
