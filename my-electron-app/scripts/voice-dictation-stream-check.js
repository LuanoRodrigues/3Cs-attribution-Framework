require("./load-dotenv");

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const mainPath = path.join(projectRoot, "src/main.ts");
const preloadPath = path.join(projectRoot, "src/preload.ts");
const rendererPath = path.join(projectRoot, "src/renderer/index.ts");
const typesPath = path.join(projectRoot, "src/renderer/global.d.ts");

const main = fs.readFileSync(mainPath, "utf8");
const preload = fs.readFileSync(preloadPath, "utf8");
const renderer = fs.readFileSync(rendererPath, "utf8");
const types = fs.readFileSync(typesPath, "utf8");

const failures = [];
const ensure = (label, ok) => {
  if (!ok) failures.push(label);
};

ensure("main has dictation start ipc", /ipcMain\.handle\("agent:dictation-start"/.test(main));
ensure("main has dictation stop ipc", /ipcMain\.handle\("agent:dictation-stop"/.test(main));
ensure("main has dictation audio ipc", /ipcMain\.on\("agent:dictation-audio"/.test(main));
ensure("main has dictation delta event", /agent:voice:event:dictation:delta/.test(main));
ensure("main has dictation completed event", /agent:voice:event:dictation:completed/.test(main));
ensure("main has dictation error event", /agent:voice:event:dictation:error/.test(main));
ensure("main has realtime websocket ctor fallback", /resolveRealtimeWebSocketCtor/.test(main));

ensure("preload exposes dictationStart", /dictationStart:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("agent:dictation-start"\)/.test(preload));
ensure("preload exposes dictationStop", /dictationStop:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("agent:dictation-stop"\)/.test(preload));
ensure("preload exposes dictationAudio", /dictationAudio:\s*\(audio:\s*ArrayBuffer\)\s*=>\s*ipcRenderer\.send\("agent:dictation-audio",\s*audio\)/.test(preload));
ensure("preload exposes onDictationDelta", /onDictationDelta:\s*\(callback:/.test(preload));
ensure("preload exposes onDictationCompleted", /onDictationCompleted:\s*\(callback:/.test(preload));
ensure("preload exposes onDictationError", /onDictationError:\s*\(callback:/.test(preload));

ensure("renderer listens dictation delta", /onDictationDelta\(\(payload\)/.test(renderer));
ensure("renderer starts dictation session", /dictationStart\?\.\(\)/.test(renderer));
ensure("renderer streams dictation audio", /dictationAudio\?\.\(ab\)/.test(renderer));
ensure("renderer stops dictation session", /dictationStop\?\.\(\)/.test(renderer));
ensure("renderer has dictation listener teardown", /teardownDictationDelta/.test(renderer));

ensure("types include dictationStart", /dictationStart:\s*\(\)\s*=>\s*Promise<\{ status: string; sessionId\?: number; message\?: string \}>;/.test(types));
ensure("types include onDictationDelta", /onDictationDelta:\s*\(callback:/.test(types));

if (failures.length) {
  console.error("[voice-dictation-stream-check] checks failed:");
  failures.forEach((item) => console.error(` - ${item}`));
  process.exit(1);
}

console.info("[voice-dictation-stream-check] checks passed");
