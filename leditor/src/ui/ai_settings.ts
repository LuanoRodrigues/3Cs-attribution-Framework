import type { AiScope, AiSettings } from "../types/ai.ts";

const STORAGE_KEY = "leditor.ai.settings";

const DEFAULT_SETTINGS: AiSettings = {
  apiKey: "",
  provider: "openai",
  model: "codex-mini-latest",
  temperature: 0.2,
  chunkSize: 32000,
  defaultScope: "selection",
  audience: "expert",
  formality: "formal"
};

const parseStoredSettings = (): AiSettings => {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_SETTINGS;
    return {
      // API keys are loaded from the environment (`OPENAI_API_KEY`) in the Electron main process.
      // Do not persist API keys in renderer storage.
      apiKey: "",
      provider: (() => {
        const rawProvider = typeof (parsed as any).provider === "string" ? String((parsed as any).provider).trim() : "";
        if (rawProvider === "openai" || rawProvider === "deepseek" || rawProvider === "mistral" || rawProvider === "gemini") {
          return rawProvider;
        }
        return DEFAULT_SETTINGS.provider;
      })(),
      model: (() => {
        const rawModel = typeof parsed.model === "string" ? parsed.model.trim() : "";
        if (!rawModel) return DEFAULT_SETTINGS.model;
        if (rawModel === "gpt-4o-mini") return "gpt-5-mini";
        if (rawModel === "gpt-4o") return "gpt-5";
        return rawModel;
      })(),
      temperature: typeof parsed.temperature === "number" ? parsed.temperature : DEFAULT_SETTINGS.temperature,
      chunkSize: Number.isFinite(parsed.chunkSize) ? Number(parsed.chunkSize) : DEFAULT_SETTINGS.chunkSize,
      defaultScope:
        parsed.defaultScope === "selection" || parsed.defaultScope === "document"
          ? parsed.defaultScope
          : DEFAULT_SETTINGS.defaultScope,
      audience: (() => {
        const rawAudience = typeof (parsed as any).audience === "string" ? String((parsed as any).audience).trim() : "";
        if (rawAudience === "general" || rawAudience === "knowledgeable" || rawAudience === "expert") return rawAudience;
        return DEFAULT_SETTINGS.audience;
      })(),
      formality: (() => {
        const rawFormality = typeof (parsed as any).formality === "string" ? String((parsed as any).formality).trim() : "";
        if (rawFormality === "casual" || rawFormality === "neutral" || rawFormality === "formal") return rawFormality;
        return DEFAULT_SETTINGS.formality;
      })()
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

let currentSettings: AiSettings = parseStoredSettings();
const listeners = new Set<(settings: AiSettings) => void>();

const persistSettings = () => {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  } catch {
    // ignore
  }
};

const notifyListeners = () => {
  listeners.forEach((listener) => listener(currentSettings));
};

export const getAiSettings = (): AiSettings => currentSettings;

export const setAiSettings = (updates: Partial<AiSettings>) => {
  currentSettings = { ...currentSettings, ...updates };
  persistSettings();
  notifyListeners();
};

export const subscribeAiSettings = (callback: (settings: AiSettings) => void): (() => void) => {
  listeners.add(callback);
  callback(currentSettings);
  return () => {
    listeners.delete(callback);
  };
};

export type AiSettingsPanelController = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  destroy: () => void;
};

const APP_ROOT_ID = "leditor-app";
const PANEL_ID = "leditor-ai-settings-panel";
const APP_OPEN_CLASS = "leditor-app--ai-settings-open";

const getAppRoot = (): HTMLElement | null =>
  (document.getElementById(APP_ROOT_ID) as HTMLElement | null) ?? (document.body as HTMLElement | null);

export const createAISettingsPanel = (): AiSettingsPanelController => {
  const root = getAppRoot();
  if (!root) {
    throw new Error("AI settings: unable to resolve app root");
  }

  const existing = document.getElementById(PANEL_ID);
  if (existing) {
    existing.remove();
  }

  const panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.className = "leditor-ai-settings-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "AI Settings");

  const header = document.createElement("header");
  header.className = "leditor-ai-settings-panel__header";
  const title = document.createElement("h2");
  title.textContent = "AI Settings";
  title.className = "leditor-ai-settings-panel__title";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-ai-settings-panel__close";
  closeBtn.textContent = "Close";
  header.append(title, closeBtn);

  const form = document.createElement("form");
  form.className = "leditor-ai-settings-panel__form";
  form.addEventListener("submit", (event) => event.preventDefault());

  const renderField = (labelText: string, widget: HTMLElement) => {
    const row = document.createElement("div");
    row.className = "leditor-ai-settings-panel__field";
    const label = document.createElement("label");
    label.className = "leditor-ai-settings-panel__label";
    label.textContent = labelText;
    row.append(label, widget);
    return row;
  };

  const modelInput = document.createElement("input");
  modelInput.type = "text";
  modelInput.className = "leditor-ai-settings-panel__input";
  modelInput.placeholder = "codex-mini-latest";

  const temperatureInput = document.createElement("input");
  temperatureInput.type = "range";
  temperatureInput.min = "0";
  temperatureInput.max = "1";
  temperatureInput.step = "0.05";
  temperatureInput.className = "leditor-ai-settings-panel__range";
  const temperatureValue = document.createElement("span");
  temperatureValue.className = "leditor-ai-settings-panel__rangeValue";

  const chunkInput = document.createElement("input");
  chunkInput.type = "number";
  chunkInput.min = "2000";
  chunkInput.step = "1000";
  chunkInput.className = "leditor-ai-settings-panel__input";

  const renderSegmented = (options: Array<{ value: string; label: string }>) => {
    const wrap = document.createElement("div");
    wrap.className = "leditor-ai-settings-panel__seg";
    const buttons = options.map((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "leditor-ai-settings-panel__segBtn";
      btn.textContent = opt.label;
      btn.dataset.value = opt.value;
      wrap.appendChild(btn);
      return btn;
    });
    return { wrap, buttons };
  };

  const audienceSeg = renderSegmented([
    { value: "general", label: "General" },
    { value: "knowledgeable", label: "Knowledgeable" },
    { value: "expert", label: "Expert" }
  ]);

  const formalitySeg = renderSegmented([
    { value: "casual", label: "Casual" },
    { value: "neutral", label: "Neutral" },
    { value: "formal", label: "Formal" }
  ]);

  const scopeSelect = document.createElement("select");
  scopeSelect.className = "leditor-ai-settings-panel__select";
  const optionSelection = document.createElement("option");
  optionSelection.value = "selection";
  optionSelection.textContent = "Selection";
  const optionDocument = document.createElement("option");
  optionDocument.value = "document";
  optionDocument.textContent = "Document";
  scopeSelect.append(optionSelection, optionDocument);

  const status = document.createElement("div");
  status.className = "leditor-ai-settings-panel__status";
  const envStatus = document.createElement("div");
  envStatus.className = "leditor-ai-settings-panel__status";
  envStatus.style.opacity = "0.85";

  form.append(
    renderField("Model", modelInput),
    renderField("Temperature", ((): HTMLElement => {
      const wrapper = document.createElement("div");
      wrapper.className = "leditor-ai-settings-panel__rangeRow";
      wrapper.append(temperatureInput, temperatureValue);
      return wrapper;
    })()),
    renderField("Chunk size", chunkInput),
    renderField("Audience", audienceSeg.wrap),
    renderField("Formality", formalitySeg.wrap),
    renderField("Default scope", scopeSelect),
    envStatus,
    status
  );

  panel.append(header, form);
  root.appendChild(panel);

  const applySettingsToForm = (settings: AiSettings) => {
    modelInput.value = settings.model;
    temperatureInput.value = settings.temperature.toString();
    temperatureValue.textContent = settings.temperature.toFixed(2);
    chunkInput.value = `${settings.chunkSize}`;
    scopeSelect.value = settings.defaultScope;
    for (const btn of audienceSeg.buttons) {
      btn.classList.toggle("is-active", btn.dataset.value === settings.audience);
    }
    for (const btn of formalitySeg.buttons) {
      btn.classList.toggle("is-active", btn.dataset.value === settings.formality);
    }
  };

  const syncStatus = () => {
    status.textContent = "Saved.";
    window.setTimeout(() => {
      status.textContent = "";
    }, 1200);
  };

  const refreshEnvStatus = async () => {
    if (!window.leditorHost?.getAiStatus) {
      envStatus.textContent = "OpenAI API key: (status unavailable in this host)";
      return;
    }
    try {
      const result = await window.leditorHost.getAiStatus();
      const hasApiKey = Boolean(result?.hasApiKey);
      const model = typeof result?.model === "string" ? result.model : "";
      envStatus.textContent = `OpenAI API key: ${hasApiKey ? "loaded from .env" : "missing"}${model ? ` • Default model: ${model}` : ""}`;
    } catch {
      envStatus.textContent = "OpenAI API key: (status check failed)";
    }
  };

  const handleChange = () => {
    setAiSettings({
      model: modelInput.value.trim() || DEFAULT_SETTINGS.model,
      temperature: Number.parseFloat(temperatureInput.value) || DEFAULT_SETTINGS.temperature,
      chunkSize: Number.parseInt(chunkInput.value, 10) || DEFAULT_SETTINGS.chunkSize,
      defaultScope: (scopeSelect.value === "document" ? "document" : "selection") as AiScope
    });
    syncStatus();
  };

  modelInput.addEventListener("change", handleChange);
  temperatureInput.addEventListener("input", () => {
    temperatureValue.textContent = temperatureInput.value;
  });
  temperatureInput.addEventListener("change", handleChange);
  chunkInput.addEventListener("change", handleChange);
  scopeSelect.addEventListener("change", handleChange);

  const setSegmentValue = (kind: "audience" | "formality", value: string) => {
    if (kind === "audience") {
      setAiSettings({ audience: (value === "general" || value === "knowledgeable" ? value : "expert") as any });
    } else {
      setAiSettings({ formality: (value === "casual" || value === "neutral" ? value : "formal") as any });
    }
    syncStatus();
  };

  for (const btn of audienceSeg.buttons) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSegmentValue("audience", String(btn.dataset.value || ""));
    });
  }
  for (const btn of formalitySeg.buttons) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSegmentValue("formality", String(btn.dataset.value || ""));
    });
  }

  const applyPanelSettings = () => {
    applySettingsToForm(getAiSettings());
  };

  const controller: AiSettingsPanelController = {
    open() {
      panel.classList.add("is-open");
      root.classList.add(APP_OPEN_CLASS);
      applyPanelSettings();
      void refreshEnvStatus();
    },
    close() {
      panel.classList.remove("is-open");
      root.classList.remove(APP_OPEN_CLASS);
      window.leditor?.focus();
    },
    toggle() {
      if (panel.classList.contains("is-open")) {
        controller.close();
      } else {
        controller.open();
      }
    },
    isOpen() {
      return panel.classList.contains("is-open");
    },
    destroy() {
      panel.remove();
      root.classList.remove(APP_OPEN_CLASS);
    }
  };

  closeBtn.addEventListener("click", controller.close);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      controller.close();
      return;
    }
  });

  const unsubscribe = subscribeAiSettings(applyPanelSettings);

  panel.addEventListener("remove", () => {
    unsubscribe();
  });

  applyPanelSettings();

  return controller;
};
