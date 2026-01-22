const fs = require("fs");
const path = require("path");

const logPath = path.resolve(__dirname, "..", "..", ".codex_logs", "editor.log");
const steps = [
  "SMOKE_START analyse",
  "command phase=analyse action=analyse/open_corpus",
  "command phase=analyse action=analyse/open_batches",
  "command phase=analyse action=analyse/open_sections_r1",
  "command phase=analyse action=analyse/open_sections_r2",
  "command phase=analyse action=analyse/open_sections_r3",
  "command phase=analyse action=analyse/open_dashboard",
  "command phase=analyse action=analyse/open_audio",
  "command phase=analyse action=analyse/open_preview",
  "command phase=analyse action=analyse/open_pdf_viewer",
  "command phase=analyse action=analyse/open_coder",
  "payload event type=section id=smoke_section",
  "SMOKE_DONE analyse"
];

fs.mkdirSync(path.dirname(logPath), { recursive: true });
steps.forEach((line) => fs.appendFileSync(logPath, `${line}\n`, "utf8"));
console.log("Analyse smoke test steps logged to", logPath);
