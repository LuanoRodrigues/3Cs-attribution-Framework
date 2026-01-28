const fs = require("fs");
const path = require("path");

const logPath = path.resolve(__dirname, "..", "..", ".codex_logs", "editor.log");
const threshold = Number(process.env.PERF_MAX_MS || "2500");

if (!fs.existsSync(logPath)) {
  console.error("Perf smoke: log file not found:", logPath);
  process.exit(1);
}

const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
const perfLines = lines.filter((line) => line.includes("[analyse][perf]"));

if (!perfLines.length) {
  console.error("Perf smoke: no perf entries found.");
  process.exit(1);
}

let max = 0;
perfLines.forEach((line) => {
  const match = line.match(/\"ms\":\s*(\d+)/);
  if (match) {
    const ms = Number(match[1]);
    if (ms > max) max = ms;
  }
});

if (max > threshold) {
  console.error(`Perf smoke: max ${max}ms exceeds threshold ${threshold}ms`);
  process.exit(1);
}

console.log(`Perf smoke: OK (max ${max}ms <= ${threshold}ms)`);
