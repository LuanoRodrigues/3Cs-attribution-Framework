const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "..", ".codex_logs");
const LOG_PATH = path.join(LOG_DIR, "plan_autonomous.log");
const TARGET_DURATION_MS = 31 * 60 * 1000; // 31 minutes.

function appendLog(message) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_PATH, `${timestamp} ${message}\n`, "utf-8");
  } catch (error) {
    // If logging fails, still let the script continue.
    console.warn("Unable to write autonomous log", error);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runBuild(iteration) {
  return new Promise((resolve, reject) => {
    const command = "npm";
    const args = ["--prefix", "my-electron-app", "run", "build"];
    appendLog(`iteration=${iteration} start command="${command} ${args.join(" ")}"`);
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (error) => {
      appendLog(`iteration=${iteration} error ${error.message}`);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        appendLog(`iteration=${iteration} finished code=0`);
        resolve();
      } else {
        appendLog(`iteration=${iteration} finished code=${code} signal=${signal}`);
        reject(new Error(`build failed with code=${code}`));
      }
    });
  });
}

async function run() {
  const startTime = Date.now();
  appendLog("plan_autonomous started");
  let iteration = 0;
  while (Date.now() - startTime < TARGET_DURATION_MS) {
    iteration += 1;
    try {
      await runBuild(iteration);
    } catch (error) {
      appendLog(`iteration=${iteration} failed: ${error.message}`);
      appendLog("plan_autonomous aborting early due to failure");
      process.exit(1);
    }
    const elapsed = Date.now() - startTime;
    const remaining = TARGET_DURATION_MS - elapsed;
    if (remaining <= 0) {
      break;
    }
    const waitMs = Math.min(60 * 1000, remaining);
    appendLog(`iteration=${iteration} sleeping ${waitMs}ms`);
    await delay(waitMs);
  }
  const totalElapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  appendLog(`plan_autonomous completed duration=${totalElapsedSeconds}s iterations=${iteration}`);
}

run().catch((error) => {
  appendLog(`plan_autonomous runner error ${error.message}`);
  process.exit(1);
});
