require("./load-dotenv");

const { spawnSync } = require("child_process");
const path = require("path");

const cwd = path.resolve(__dirname, "..");
const spawnOptions = { stdio: "inherit", cwd };

function runCommand(command, args) {
  return spawnSync(command, args, spawnOptions);
}

console.log("Running build before starting the app...");
const buildResult = runCommand("npm", ["run", "build"]);
if (buildResult.status !== 0) {
  console.warn(
    "Build failed (tsc or another step missing). Falling back to the existing `dist/` output."
  );
}

if (process.env.SKIP_ELECTRON === "1") {
  process.exit(buildResult.status || 0);
}

console.log("Starting Electron...");
let electronResult = runCommand("electron", ["."]);
if (electronResult.error) {
  console.warn(
    `[start.js][launchElectron][debug] direct electron launch failed: ${electronResult.error.message}`
  );
  console.log("Retrying with npx electron...");
  electronResult = runCommand("npx", ["electron", "."]);
}
if (electronResult.error) {
  console.error(
    `[start.js][launchElectron][debug] electron launch failed: ${electronResult.error.message}`
  );
}

process.exit(
  electronResult.status ?? buildResult.status ?? 0
);
