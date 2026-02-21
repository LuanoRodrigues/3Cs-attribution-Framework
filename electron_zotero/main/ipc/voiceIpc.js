const { VOICE_IPC_CHANNELS, asBoolean, asText } = require("../../shared/ipc/voice.contract");
const VOICE_CONFIRM_TTL_MS = 15_000;

function parseVoiceCommandIntent(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return { kind: "none" };
  if (normalized === "help") return { kind: "help" };
  if (/^(confirm|yes|execute|apply|run now)$/.test(normalized)) return { kind: "confirm" };
  if (/^(cancel|no|abort|stop that)$/.test(normalized)) return { kind: "cancel" };
  if (/^(start|enable)\s+voice(\s+mode)?$/.test(normalized)) return { kind: "voice_mode_set", enabled: true };
  if (/^(stop|disable)\s+voice(\s+mode)?$/.test(normalized)) return { kind: "voice_mode_set", enabled: false };
  if (/^(start|enable)\s+dictation$/.test(normalized)) return { kind: "dictation_set", enabled: true };
  if (/^(stop|disable)\s+dictation$/.test(normalized)) return { kind: "dictation_set", enabled: false };
  if (/\b(refresh( tree)?|reload tree)\b/.test(normalized)) return { kind: "ui_command", commandId: "refresh-tree" };
  if (/\bsync now\b/.test(normalized)) return { kind: "ui_command", commandId: "sync-now" };
  if (/\badvanced search\b/.test(normalized)) return { kind: "ui_command", commandId: "advanced-search" };
  if (/\bopen reader\b/.test(normalized)) return { kind: "ui_command", commandId: "open-reader" };
  if (/\b(command palette|open commands?)\b/.test(normalized)) return { kind: "ui_command", commandId: "command-palette" };
  return { kind: "agent_command" };
}

function createVoiceState() {
  return {
    supported: true,
    voiceModeOn: false,
    dictationOn: false,
    lastTranscript: "",
    lastError: "",
    updatedAt: Date.now()
  };
}

function registerVoiceIpc(deps) {
  const { ipcMain, BrowserWindow, createAgentRegistry } = deps;
  const voiceState = createVoiceState();
  let pendingConfirmation = null;

  const emitVoiceDelta = (patch = {}) => {
    Object.assign(voiceState, patch, { updatedAt: Date.now() });
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(VOICE_IPC_CHANNELS.eventModeDelta, { ...voiceState });
      }
    }
  };

  const clearPendingConfirmation = () => {
    pendingConfirmation = null;
  };

  const getPendingIfValid = () => {
    if (!pendingConfirmation) return null;
    if (Date.now() > pendingConfirmation.expiresAt) {
      clearPendingConfirmation();
      return null;
    }
    return pendingConfirmation;
  };

  const setPendingConfirmation = (transcript, previewResult) => {
    const id = `voice_confirm_${Date.now().toString(36)}`;
    pendingConfirmation = {
      id,
      transcript,
      previewResult,
      createdAt: Date.now(),
      expiresAt: Date.now() + VOICE_CONFIRM_TTL_MS
    };
    return pendingConfirmation;
  };

  ipcMain.handle(VOICE_IPC_CHANNELS.getSession, async () => {
    const pending = getPendingIfValid();
    return {
      status: "ok",
      voice: { ...voiceState },
      pendingConfirmation: pending
        ? {
            id: pending.id,
            transcript: pending.transcript,
            expiresAt: pending.expiresAt
          }
        : null
    };
  });

  ipcMain.handle(VOICE_IPC_CHANNELS.setVoiceMode, async (_event, payload = {}) => {
    const enabled = asBoolean(payload?.enabled, false);
    emitVoiceDelta({
      voiceModeOn: enabled,
      dictationOn: enabled ? false : voiceState.dictationOn,
      lastError: ""
    });
    return { status: "ok", voice: { ...voiceState } };
  });

  ipcMain.handle(VOICE_IPC_CHANNELS.setDictation, async (_event, payload = {}) => {
    const enabled = asBoolean(payload?.enabled, false);
    emitVoiceDelta({
      dictationOn: enabled,
      voiceModeOn: enabled ? false : voiceState.voiceModeOn,
      lastError: ""
    });
    return { status: "ok", voice: { ...voiceState } };
  });

  ipcMain.handle(VOICE_IPC_CHANNELS.runCommand, async (_event, payload = {}) => {
    try {
      const text = asText(payload?.text);
      if (!text) return { status: "error", message: "text is required." };
      const intent = parseVoiceCommandIntent(text);
      emitVoiceDelta({ lastTranscript: text, lastError: "" });
      const pending = getPendingIfValid();

      if (intent.kind === "help") {
        return {
          status: "ok",
          type: "help",
          help: [
            "start voice mode",
            "stop voice mode",
            "start dictation",
            "stop dictation",
            "refresh tree",
            "sync now",
            "advanced search",
            "open reader",
            "command palette",
            "confirm",
            "cancel",
            "create subfolder inside folder frameworks, getting only items with framework tag"
          ]
        };
      }

      if (intent.kind === "confirm") {
        if (!pending) {
          return {
            status: "ok",
            type: "confirm_skipped",
            message: "No pending command to confirm."
          };
        }
        const agentRegistry = createAgentRegistry();
        const agentRes = await agentRegistry.run({
          text: pending.transcript,
          dryRun: false
        });
        clearPendingConfirmation();
        if (agentRes?.status !== "ok") return agentRes;
        return {
          status: "ok",
          type: "agent_command",
          confirmed: true,
          result: agentRes
        };
      }

      if (intent.kind === "cancel") {
        if (!pending) {
          return {
            status: "ok",
            type: "cancel_skipped",
            message: "No pending command to cancel."
          };
        }
        clearPendingConfirmation();
        return {
          status: "ok",
          type: "cancelled",
          message: "Pending command cancelled."
        };
      }

      if (intent.kind === "voice_mode_set") {
        emitVoiceDelta({
          voiceModeOn: intent.enabled,
          dictationOn: intent.enabled ? false : voiceState.dictationOn
        });
        return { status: "ok", type: "voice_mode_set", voice: { ...voiceState } };
      }

      if (intent.kind === "dictation_set") {
        emitVoiceDelta({
          dictationOn: intent.enabled,
          voiceModeOn: intent.enabled ? false : voiceState.voiceModeOn
        });
        return { status: "ok", type: "dictation_set", voice: { ...voiceState } };
      }

      if (intent.kind === "ui_command") {
        return { status: "ok", type: "ui_command", commandId: intent.commandId, transcript: text };
      }

      const agentRegistry = createAgentRegistry();
      const preview = await agentRegistry.run({
        text,
        dryRun: true
      });
      if (preview?.status !== "ok") return preview;

      const wantsExecute = /\b(execute|apply|run now)\b/i.test(text);
      if (!wantsExecute) {
        const confirmation = setPendingConfirmation(text, preview);
        return {
          status: "ok",
          type: "needs_confirm",
          message: `Command preview ready. Say "confirm" within ${Math.floor(VOICE_CONFIRM_TTL_MS / 1000)} seconds to execute, or say "cancel".`,
          confirmation: {
            id: confirmation.id,
            expiresAt: confirmation.expiresAt
          },
          preview
        };
      }

      const agentRes = await agentRegistry.run({
        text,
        dryRun: false
      });
      if (agentRes?.status !== "ok") return agentRes;
      clearPendingConfirmation();
      return {
        status: "ok",
        type: "agent_command",
        confirmed: true,
        result: agentRes
      };
    } catch (error) {
      emitVoiceDelta({ lastError: error.message || "Voice command failed." });
      return { status: "error", message: error.message };
    }
  });
}

module.exports = {
  registerVoiceIpc
};
