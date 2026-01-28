import type { AnalyseAction, AnalyseState, AudioCacheEntry } from "../analyse/types";
import { addAudioCacheEntries, getAudioCacheStatus } from "../analyse/data";

type CacheScope = "page" | "selected" | "all";

export interface AnalyseAudioCacheDetail {
  scope: CacheScope;
  cached: number;
  total: number;
  cachedKeys: string[];
}

interface AnalyseAudioControllerOptions {
  widget: HTMLElement;
  getState: () => AnalyseState;
  onCacheUpdate?: (detail: AnalyseAudioCacheDetail) => void;
}

const scopeLabels: Record<CacheScope, string> = {
  page: "Audio: Page",
  selected: "Audio: Selected sections",
  all: "Audio: All sections"
};

export const initAnalyseAudioController = (options: AnalyseAudioControllerOptions) => {
  const { widget, getState, onCacheUpdate } = options;
  const playBtn = widget.querySelector<HTMLButtonElement>(".audio-btn.play");
  const stopBtn = widget.querySelector<HTMLButtonElement>(".audio-btn.stop");
  const cacheBtn = widget.querySelector<HTMLButtonElement>(".audio-cache");
  const voiceSelect = widget.querySelector<HTMLSelectElement>(".audio-select");
  const rateBtn = widget.querySelector<HTMLButtonElement>(".audio-rate");
  const slider = widget.querySelector<HTMLInputElement>(".audio-slider");
  const posLabel = widget.querySelector<HTMLSpanElement>(".audio-time__pos");
  const durLabel = widget.querySelector<HTMLSpanElement>(".audio-time__dur");

  const cacheMenu = document.createElement("div");
  cacheMenu.className = "audio-cache-menu";
  const cacheItems: Record<CacheScope, HTMLButtonElement> = {
    page: document.createElement("button"),
    selected: document.createElement("button"),
    all: document.createElement("button")
  };

  (Object.keys(cacheItems) as CacheScope[]).forEach((scope) => {
    const btn = cacheItems[scope];
    btn.type = "button";
    btn.className = "audio-cache-item";
    btn.textContent = scopeLabels[scope];
    btn.addEventListener("click", () => {
      cacheMenu.classList.remove("open");
      void refreshCache(scope, lastKeysByScope[scope] || []);
    });
    cacheMenu.appendChild(btn);
  });
  widget.appendChild(cacheMenu);

  const rateMenu = document.createElement("div");
  rateMenu.className = "audio-rate-menu";
  const rateHeader = document.createElement("div");
  rateHeader.className = "audio-rate-menu__head";
  rateHeader.textContent = "Speed";
  const rateValue = document.createElement("div");
  rateValue.className = "audio-rate-menu__value";
  rateHeader.appendChild(rateValue);
  const rateSlider = document.createElement("input");
  rateSlider.type = "range";
  rateSlider.min = "0.5";
  rateSlider.max = "2.5";
  rateSlider.step = "0.1";
  rateSlider.className = "audio-rate-slider";
  rateMenu.append(rateHeader, rateSlider);
  widget.appendChild(rateMenu);

  const lastKeysByScope: Record<CacheScope, string[]> = { page: [], selected: [], all: [] };

  const updateRateDisplay = (value: number) => {
    const label = `${value.toFixed(1)}x`;
    if (rateBtn) {
      rateBtn.textContent = label;
    }
    rateValue.textContent = label;
  };

  updateRateDisplay(1.2);
  rateSlider.value = "1.2";

  const toggleMenu = (menu: HTMLElement) => {
    menu.classList.toggle("open");
  };

  const closeMenus = () => {
    cacheMenu.classList.remove("open");
    rateMenu.classList.remove("open");
  };

  cacheBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    rateMenu.classList.remove("open");
    toggleMenu(cacheMenu);
  });

  rateBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    cacheMenu.classList.remove("open");
    toggleMenu(rateMenu);
  });

  rateSlider.addEventListener("input", () => {
    const next = Number(rateSlider.value);
    updateRateDisplay(next);
  });

  document.addEventListener("click", closeMenus);

  const refreshCache = async (scope: CacheScope, keys: string[]) => {
    const state = getState();
    const runId = state.activeRunId;
    const response = await getAudioCacheStatus(runId, keys);
    const cachedKeys = response.cachedKeys ?? [];
    const cached = cachedKeys.length;
    const total = keys.length;
    cacheItems[scope].textContent = `${scopeLabels[scope]} (${cached}/${total})`;
    onCacheUpdate?.({ scope, cached, total, cachedKeys });
  };

  const markPlayState = (playing: boolean) => {
    if (playBtn) {
      playBtn.textContent = playing ? "⏸" : "▶";
    }
  };

  const handleAction = (action: AnalyseAction, payload?: Record<string, unknown>) => {
    if (action === "analyse/audio_read_current") {
      markPlayState(true);
    }
    if (action === "analyse/audio_stop") {
      markPlayState(false);
    }
    if (action === "analyse/audio_cache_status") {
      const scope = (payload?.scope as CacheScope | undefined) ?? "page";
      const keys = Array.isArray(payload?.keys) ? (payload?.keys as string[]) : [];
      lastKeysByScope[scope] = keys;
      void refreshCache(scope, keys);
    }
    if (action === "analyse/audio_cache_add") {
      const entries = Array.isArray(payload?.entries) ? (payload?.entries as AudioCacheEntry[]) : [];
      if (entries.length) {
        const state = getState();
        void addAudioCacheEntries(state.activeRunId, entries).then((result) => {
          onCacheUpdate?.({
            scope: "all",
            cached: result.cachedKeys.length,
            total: result.cachedKeys.length,
            cachedKeys: result.cachedKeys
          });
        });
      }
    }
  };

  const dispose = () => {
    document.removeEventListener("click", closeMenus);
    cacheMenu.remove();
    rateMenu.remove();
  };

  if (slider && posLabel && durLabel) {
    slider.addEventListener("input", () => {
      const current = Number(slider.value);
      const total = Number(slider.max || "0");
      const format = (value: number) => {
        const minutes = Math.floor(value / 60);
        const seconds = Math.floor(value % 60);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
      };
      posLabel.textContent = format(current);
      durLabel.textContent = `/ ${format(total)}`;
    });
  }

  voiceSelect?.addEventListener("change", () => {
    // placeholder to keep UI in sync if needed later
  });

  stopBtn?.addEventListener("click", () => {
    markPlayState(false);
  });

  return { handleAction, dispose };
};
