require("./load-dotenv");

const WAV_SAMPLE_RATE = 24000;

const buildSilenceWav = (durationSec = 1) => {
  const sampleRate = WAV_SAMPLE_RATE;
  const channels = 1;
  const bitsPerSample = 16;
  const totalSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = totalSamples * blockAlign;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataBytes);
  let offset = 0;
  const push = (text) => {
    buffer.write(text, offset, text.length, "ascii");
    offset += text.length;
  };
  push("RIFF");
  buffer.writeUInt32LE(headerSize + dataBytes - 8, offset);
  offset += 4;
  push("WAVE");
  push("fmt ");
  buffer.writeUInt32LE(16, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(channels, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(byteRate, offset);
  offset += 4;
  buffer.writeUInt16LE(blockAlign, offset);
  offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset);
  offset += 2;
  push("data");
  buffer.writeUInt32LE(dataBytes, offset);
  offset += 4;
  for (let i = 0; i < totalSamples; i++) {
    const phase = (2 * Math.PI * 440 * i) / sampleRate;
    const sample = Math.sin(phase) * 0.02;
    buffer.writeInt16LE(Math.max(-1, Math.min(1, sample)) * 0x7fff, offset);
    offset += 2;
  }
  return buffer;
};

const parseResponse = async (res) => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};

(async () => {
  const apiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "").trim();
  const baseUrl = String(process.env.OPENAI_API_BASE || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const transcribeModel = String(process.env.OPENAI_TRANSCRIBE_MODEL || process.env.OPENAI_VOICE_TRANSCRIBE_MODEL || "whisper-1").trim();
  const ttsModel = String(process.env.OPENAI_TTS_MODEL || process.env.OPENAI_VOICE_TTS_MODEL || "tts-1").trim();
  const ttsVoice = String(process.env.OPENAI_TTS_VOICE || process.env.OPENAI_VOICE_TTS_VOICE || "alloy").trim();
  if (!apiKey) {
    console.error("[voice-model-audio-check] missing OPENAI_API_KEY");
    process.exit(2);
  }
  const wav = buildSilenceWav(1);
  const wavBlob = new Blob([wav], { type: "audio/wav" });
  const transcribeForm = new FormData();
  transcribeForm.append("file", wavBlob, "voice-check.wav");
  transcribeForm.append("model", transcribeModel);
  const transcribeStart = Date.now();
  const transcribeResponse = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: transcribeForm
  });
  const transcribeText = await parseResponse(transcribeResponse);
  if (!transcribeResponse.ok) {
    console.error(`[voice-model-audio-check] transcribe failed: ${transcribeResponse.status} ${transcribeText.slice(0, 400)}`);
    process.exit(3);
  }
  console.info(`[voice-model-audio-check] transcribe ok ${Math.round(Date.now() - transcribeStart)}ms`);

  const ttsResponse = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: ttsModel, input: "Voice diagnostics test.", voice: ttsVoice })
  });
  const ttsBuffer = await ttsResponse.arrayBuffer();
  if (!ttsResponse.ok) {
    const raw = new TextDecoder().decode(ttsBuffer);
    console.error(`[voice-model-audio-check] tts failed: ${ttsResponse.status} ${raw.slice(0, 400)}`);
    process.exit(4);
  }
  if (!ttsBuffer.byteLength) {
    console.error("[voice-model-audio-check] tts response empty");
    process.exit(5);
  }
  console.info(`[voice-model-audio-check] tts ok bytes=${ttsBuffer.byteLength}`);
  process.exit(0);
})();
