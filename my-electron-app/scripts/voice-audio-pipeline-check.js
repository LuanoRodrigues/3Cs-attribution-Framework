require("./load-dotenv");

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "src/renderer/index.ts");
const stylesPath = path.join(projectRoot, "src/renderer/styles.css");
const htmlPath = path.join(projectRoot, "src/renderer/index.html");
const source = fs.readFileSync(sourcePath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");

const failures = [];

const ensure = (label, ok) => {
  if (!ok) {
    failures.push(label);
  }
};

ensure("realtime audio start listener exists", /session\.on\(\s*["']audio_start["']/.test(source));
ensure("realtime audio done/stop listener exists", /session\.on\(\s*["']audio_stopped["']/.test(source));
ensure("realtime audio queue handler exists", /session\.on\(\s*["']audio["']/.test(source));
ensure("realtime turn_done listener exists", /session\.on\(\s*["']turn_done["']/.test(source));
ensure("audio output helper exists", /const ensureAgentChatAudioOutput/.test(source));
ensure("playback helper is called on connect", /await session\.connect[\s\S]{0,120}ensureAgentChatAudioOutput/.test(source));
ensure("audio handler can clear previous queue", /clearRealtimeVoicePulseQueue\(\);\s*void ensureAgentChatAudioOutput\(\)/.test(source));
ensure("agent chat audio element exists", /id=\"agentChatAudio\"/.test(html));
ensure("fab button is fixed bottom right", /id=\"agentChatFab\"/.test(html));
ensure(
  "fab button style positions fixed at bottom right",
  /\.agent-chat-fab\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*12px;[\s\S]*?bottom:\s*24px;/.test(styles)
);

if (failures.length) {
  console.error("[voice-audio-pipeline] checks failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.info("[voice-audio-pipeline] checks passed");
