const VOICE_IPC_CHANNELS = {
  getSession: "zotero:voice-session",
  setVoiceMode: "zotero:voice-mode:set",
  setDictation: "zotero:dictation:set",
  runCommand: "zotero:voice-command",
  eventModeDelta: "zotero:voice-mode-delta"
};

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asText(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized;
}

module.exports = {
  VOICE_IPC_CHANNELS,
  asBoolean,
  asText
};
