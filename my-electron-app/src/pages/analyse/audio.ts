import type { AnalysePageContext, AnalyseState, AudioSettings } from "../../analyse/types";

const AUDIO_SETTINGS_KEY = "analyse.audio.settings";

function loadSavedSettings(): AudioSettings {
  try {
    const raw = window.localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioSettings>;
      return {
        provider: parsed.provider || "system",
        voice: parsed.voice || "default",
        rate: typeof parsed.rate === "number" ? parsed.rate : 1,
        volume: typeof parsed.volume === "number" ? parsed.volume : 1
      };
    }
  } catch (err) {
    console.warn("Unable to load audio settings", err);
  }
  return { provider: "system", voice: "default", rate: 1, volume: 1 };
}

function persistSettings(settings: AudioSettings): void {
  try {
    window.localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("Unable to persist audio settings", err);
  }
}

function dispatch(container: HTMLElement, action: string, payload?: Record<string, unknown>): void {
  container.dispatchEvent(new CustomEvent("analyse-command", { detail: { action, payload }, bubbles: true }));
}

export function renderAudioPage(container: HTMLElement, state: AnalyseState, ctx?: AnalysePageContext): void {
  container.innerHTML = "";
  let settings: AudioSettings = state.audio || loadSavedSettings();

  const save = () => {
    persistSettings(settings);
    ctx?.updateState({ audio: settings });
  };

  const header = document.createElement("h2");
  header.textContent = "Audio settings";
  container.appendChild(header);

  const form = document.createElement("div");
  form.className = "control-row";
  form.style.flexWrap = "wrap";

  const provider = document.createElement("select");
  ["system", "azure", "elevenlabs"].forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    opt.selected = settings.provider === p;
    provider.appendChild(opt);
  });
  provider.addEventListener("change", () => {
    settings = { ...settings, provider: provider.value };
    save();
  });

  const voice = document.createElement("input");
  voice.type = "text";
  voice.placeholder = "Voice name or id";
  voice.value = settings.voice;
  voice.addEventListener("input", () => {
    settings = { ...settings, voice: voice.value };
    save();
  });

  const rate = document.createElement("input");
  rate.type = "range";
  rate.min = "0.5";
  rate.max = "1.5";
  rate.step = "0.05";
  rate.value = String(settings.rate);
  rate.addEventListener("input", () => {
    settings = { ...settings, rate: Number(rate.value) };
    save();
    rateLabel.textContent = `Rate: ${settings.rate.toFixed(2)}`;
  });
  const rateLabel = document.createElement("span");
  rateLabel.textContent = `Rate: ${settings.rate.toFixed(2)}`;

  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.05";
  volume.value = String(settings.volume);
  volume.addEventListener("input", () => {
    settings = { ...settings, volume: Number(volume.value) };
    save();
    volumeLabel.textContent = `Volume: ${Math.round(settings.volume * 100)}%`;
  });
  const volumeLabel = document.createElement("span");
  volumeLabel.textContent = `Volume: ${Math.round(settings.volume * 100)}%`;

  form.appendChild(provider);
  form.appendChild(voice);
  form.appendChild(rate);
  form.appendChild(rateLabel);
  form.appendChild(volume);
  form.appendChild(volumeLabel);

  container.appendChild(form);

  const preview = document.createElement("textarea");
  preview.rows = 4;
  preview.style.width = "100%";
  preview.placeholder = "Preview text";
  preview.value = "This is an audio preview.";
  container.appendChild(preview);

  const actions = document.createElement("div");
  actions.className = "control-row";
  const playBtn = document.createElement("button");
  playBtn.className = "ribbon-button";
  playBtn.textContent = "Preview";
  playBtn.addEventListener("click", () => {
    dispatch(container, "analyse/audio_read_current", { text: preview.value, settings });
  });

  const stopBtn = document.createElement("button");
  stopBtn.className = "ribbon-button";
  stopBtn.textContent = "Stop";
  stopBtn.addEventListener("click", () => dispatch(container, "analyse/audio_stop"));

  const cacheBtn = document.createElement("button");
  cacheBtn.className = "ribbon-button";
  cacheBtn.textContent = "Cache status";
  cacheBtn.addEventListener("click", () => dispatch(container, "analyse/audio_cache_status"));

  actions.appendChild(playBtn);
  actions.appendChild(stopBtn);
  actions.appendChild(cacheBtn);
  container.appendChild(actions);

  const status = document.createElement("div");
  status.className = "status-bar";
  status.textContent = `Provider: ${settings.provider} · Voice: ${settings.voice}`;
  container.appendChild(status);
}
