import type { AiSettings } from "../types/ai.ts";
import personasLibraryRaw from "./personas.json";
import {
  type PersonaLibrary,
  type PersonaConfig,
  DEFAULT_PERSONA_CONFIG,
  DEFAULT_GLOBAL_PARAMS,
  compilePersonaConfig,
  legacyStyleToGlobalParams,
  normalizePersonaConfig
} from "../shared/persona.ts";

const STORAGE_KEY = "leditor.ai.settings";
const PROFILE_STORAGE_KEY = "leditor.ai.persona.profiles";
const MAX_STACK = 4;
const DIRECTIVE_BUDGET = 2000;

const PROVIDERS = ["openai", "deepseek", "mistral", "gemini"] as const;
type ProviderId = (typeof PROVIDERS)[number];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  gemini: "Gemini"
};

const MODEL_OPTIONS_BY_PROVIDER: Record<ProviderId, string[]> = {
  openai: ["gpt-5-mini", "gpt-5", "o3-mini", "codex-mini-latest"],
  deepseek: ["deepseek-chat", "deepseek-coder", "deepseek-reasoner", "deepseek-r1"],
  mistral: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest", "codestral-latest"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro"]
};

const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  openai: "codex-mini-latest",
  deepseek: "deepseek-chat",
  mistral: "mistral-small-latest",
  gemini: "gemini-2.5-flash"
};

const buildDefaultModelByProvider = (): Record<ProviderId, string> => {
  const out = {} as Record<ProviderId, string>;
  for (const provider of PROVIDERS) {
    const preferred = DEFAULT_MODEL_BY_PROVIDER[provider];
    const list = MODEL_OPTIONS_BY_PROVIDER[provider];
    out[provider] = list.includes(preferred) ? preferred : list[0];
  }
  return out;
};

const normalizeModelByProvider = (value: unknown): Record<ProviderId, string> => {
  const base = buildDefaultModelByProvider();
  if (!value || typeof value !== "object") return base;
  const raw = value as Record<string, unknown>;
  for (const provider of PROVIDERS) {
    const candidate = raw[provider];
    if (typeof candidate === "string" && MODEL_OPTIONS_BY_PROVIDER[provider].includes(candidate)) {
      base[provider] = candidate;
    }
  }
  return base;
};

const PERSONA_LIBRARY = personasLibraryRaw as PersonaLibrary;
const PERSONA_ICON_PATHS: Record<string, string[]> = {
  person_shield: [
    "M10.3 11c-.18.22-.3.5-.3.81V12H4a1 1 0 0 0-1 1c0 1.3.62 2.28 1.67 2.95A8.16 8.16 0 0 0 9 17c.71 0 1.38-.06 2-.18.25.3.52.57.8.8l.04.03C10.96 17.9 10 18 9 18a9.14 9.14 0 0 1-4.87-1.2A4.35 4.35 0 0 1 2 13a2 2 0 0 1 2-2h6.3Zm3.82-1.04c.2-.19.56-.19.76 0 .5.49 1.48 1.26 2.68 1.41.24.04.44.22.44.44v2.11c0 2.84-2.78 3.87-3.39 4.06a.37.37 0 0 1-.22 0c-.6-.19-3.39-1.22-3.39-4.06v-2.1c0-.23.2-.41.44-.45a5.07 5.07 0 0 0 2.68-1.4ZM9 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
  ],
  handshake: [
    "M10.24 3.01a.5.5 0 0 0-.39.19l-.08.06A5.13 5.13 0 0 0 4.7 4.44a4.7 4.7 0 0 0-1.37 4.31l-.05.05-.78.75c-.64.61-.64 1.6 0 2.22.4.38.95.53 1.46.43.06.29.21.56.44.79.31.3.71.45 1.11.46.01.39.17.77.48 1.07.3.3.7.44 1.1.45.02.4.18.78.49 1.07.6.58 1.56.61 2.2.1l.43.42c.64.61 1.68.61 2.32 0 .3-.3.47-.68.48-1.07.4 0 .8-.16 1.1-.46.3-.3.47-.67.48-1.06.4-.01.78-.17 1.09-.46.24-.23.39-.52.45-.82.5.08 1.05-.06 1.44-.44.63-.61.63-1.6 0-2.22l-.72-.7.14-.54c.3-1.13.15-2.32-.42-3.34a4.8 4.8 0 0 0-4.2-2.43h-2.13Zm2.46 3.72 2.4 2.31 1.75 1.68c.24.23.24.6 0 .84a.63.63 0 0 1-.87 0l-1.32-1.27a.52.52 0 0 0-.72 0h-.01c-.2.2-.2.51 0 .7l1.03 1c.24.22.24.6 0 .83a.63.63 0 0 1-.8.05.52.52 0 0 0-.67.05.48.48 0 0 0-.04.64c.18.24.16.57-.06.78a.63.63 0 0 1-.8.05.52.52 0 0 0-.68.04.48.48 0 0 0-.05.64c.2.24.18.58-.05.8a.64.64 0 0 1-.87 0l-.44-.42.16-.16c.64-.61.64-1.6 0-2.22-.3-.3-.7-.45-1.1-.46a1.54 1.54 0 0 0-.49-1.07c-.3-.3-.7-.44-1.1-.45a1.54 1.54 0 0 0-.48-1.07c-.4-.39-.95-.53-1.46-.43a1.55 1.55 0 0 0-.45-.8c-.35-.33-.83-.48-1.29-.45a3.74 3.74 0 0 1 1.13-3.2 4.06 4.06 0 0 1 3.29-1.1L7.25 5.11a1.7 1.7 0 0 0-.33 2.44c.6.76 1.7.9 2.48.33l1.58-1.15h1.72Zm-4.86-.81 2.6-1.9h.53a2.26 2.26 0 0 1 .15 0h1.24c1.4 0 2.69.74 3.34 1.92.44.8.56 1.72.33 2.6l-2.77-2.67a.5.5 0 0 0-.35-.14h-2.1a.5.5 0 0 0-.3.1l-1.7 1.25a.8.8 0 0 1-1.1-.15.7.7 0 0 1 .13-1.01Zm.45 8.6.78-.75.01-.01a.63.63 0 0 1 .86 0c.24.24.24.6 0 .84l-.78.75a.63.63 0 0 1-.86 0 .57.57 0 0 1-.01-.83Zm.07-1.46v.01l-.78.75-.01.01a.63.63 0 0 1-.86 0 .57.57 0 0 1 0-.84l.78-.75a.63.63 0 0 1 .86 0c.24.23.24.6.01.82Zm-1.6-1.52L6 12.3v.01a.63.63 0 0 1-.86 0 .57.57 0 0 1 0-.84l.77-.75a.63.63 0 0 1 .87 0c.24.23.24.6 0 .83Zm-1.9-1.21-.78.74a.63.63 0 0 1-.86 0 .57.57 0 0 1 0-.83L4 9.5a.63.63 0 0 1 .86 0c.24.23.24.6 0 .84Z"
  ],
  factory: [
    "M4.44 2a1.5 1.5 0 0 0-1.5 1.4l-.87 13a1.5 1.5 0 0 0 1.5 1.6h2.86a1.5 1.5 0 0 0 1.5-1.6l-.87-13A1.5 1.5 0 0 0 5.56 2H4.44Zm-.5 1.47a.5.5 0 0 1 .5-.47h1.12c.27 0 .49.2.5.47l.87 13a.5.5 0 0 1-.5.53H3.57a.5.5 0 0 1-.5-.53l.87-13ZM16.5 18H8.43c.22-.3.38-.63.45-1H10v-4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4h.5a.5.5 0 0 0 .5-.5V6.62l-4.17 3.75A.5.5 0 0 1 12 10V6.62L8.49 9.78 8.4 8.51l3.76-3.38a.5.5 0 0 1 .84.37v3.38l4.16-3.75a.5.5 0 0 1 .84.37v11c0 .83-.67 1.5-1.5 1.5ZM11 17h4v-4h-4v4Z"
  ],
  puzzle_piece: [
    "M11 3c-.69 0-1.25.56-1.25 1.25V5H6.5a.5.5 0 0 0-.5.5v3.25h-.75a1.25 1.25 0 1 0 0 2.5H6v3.25c0 .28.22.5.5.5h3.25v.75a1.25 1.25 0 1 0 2.5 0V15h3.25a.5.5 0 0 0 .5-.5v-2.25h-.75a2.25 2.25 0 0 1 0-4.5H16V5.5a.5.5 0 0 0-.5-.5h-3.25v-.75C12.25 3.56 11.69 3 11 3ZM8.76 4a2.25 2.25 0 0 1 4.48 0h2.26c.83 0 1.5.67 1.5 1.5v3.25h-1.75a1.25 1.25 0 1 0 0 2.5H17v3.25c0 .83-.67 1.5-1.5 1.5h-2.26a2.25 2.25 0 0 1-4.48 0H6.5A1.5 1.5 0 0 1 5 14.5v-2.26a2.25 2.25 0 0 1 0-4.48V5.5C5 4.67 5.67 4 6.5 4h2.26Z"
  ],
  channel_alert: [
    "M3.5 4.5c-.1 0-.2 0-.3.02A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v4.1c-.32-.16-.65-.3-1-.4V5.5c0-.83-.67-1.5-1.5-1.5h-9c-.51 0-.97.26-1.24.65a2 2 0 0 0-.76-.15ZM9.2 16c.1.35.24.68.4 1H5.5A2.5 2.5 0 0 1 3 14.5V8.44a2 2 0 0 0 1 0v6.06c0 .83.67 1.5 1.5 1.5h3.7Zm.4-4c.18-.36.4-.7.66-1H7.5a.5.5 0 0 0 0 1h2.1ZM3.5 5.5a1 1 0 0 0-1 1 1 1 0 1 0 1-1Zm4 2.5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5ZM19 14.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM16.5 13a2 2 0 1 0-4 0v1.8l-.35.35a.5.5 0 0 0 .35.85h4a.5.5 0 0 0 .35-.85l-.35-.36V13Zm-3.41 4a1.5 1.5 0 0 0 2.82 0H13.1Z"
  ],
  book: [
    "M6 5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5Zm1 0v1h6V5H7ZM4 4v12c0 1.1.9 2 2 2h9.5a.5.5 0 0 0 0-1H6a1 1 0 0 1-1-1h10a1 1 0 0 0 1-1V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2Zm10-1a1 1 0 0 1 1 1v11H5V4a1 1 0 0 1 1-1h8Z"
  ],
  globe: [
    "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-15c.66 0 1.4.59 2.02 1.9.22.47.4 1.01.56 1.6H7.42c.15-.59.34-1.13.56-1.6C8.59 3.6 9.34 3 10 3ZM7.07 4.49c-.27.59-.5 1.27-.68 2.01H3.94A7.02 7.02 0 0 1 7.7 3.38c-.24.33-.45.7-.64 1.1ZM6.2 7.5a15.97 15.97 0 0 0 0 5H3.46a6.98 6.98 0 0 1 0-5h2.73Zm.2 6c.17.74.4 1.42.68 2.01.19.4.4.78.64 1.1a7.02 7.02 0 0 1-3.77-3.11h2.45Zm1.03 0h5.16a9.25 9.25 0 0 1-.56 1.6C11.41 16.4 10.66 17 10 17c-.66 0-1.4-.59-2.02-1.9-.22-.47-.4-1.01-.56-1.6Zm5.37-1H7.21a14.87 14.87 0 0 1 0-5h5.58a14.86 14.86 0 0 1 0 5Zm.82 1h2.45a7.02 7.02 0 0 1-3.77 3.12c.24-.33.45-.7.64-1.1.27-.6.5-1.28.68-2.02Zm2.93-1h-2.73a15.97 15.97 0 0 0 0-5h2.73a6.98 6.98 0 0 1 0 5Zm-4.25-9.12a7.02 7.02 0 0 1 3.77 3.12h-2.45a10.5 10.5 0 0 0-.68-2.01c-.19-.4-.4-.78-.64-1.1Z"
  ]
};

const renderPersonaIcon = (iconId?: string): SVGSVGElement | null => {
  if (!iconId) return null;
  const paths = PERSONA_ICON_PATHS[iconId];
  if (!paths) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("leditor-ai-settings-panel__personaIcon");
  paths.forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  });
  return svg;
};

const formatFilterLabel = (value: string): string =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
const makeProfileId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `profile-${Date.now()}`;

type PersonaProfile = {
  id: string;
  name: string;
  hash: string;
  config: PersonaConfig;
  updatedAt: string;
};

const loadProfiles = (): PersonaProfile[] => {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const id = typeof entry.id === "string" ? entry.id : makeProfileId();
        const name = typeof entry.name === "string" ? entry.name : "Untitled";
        const hash = typeof entry.hash === "string" ? entry.hash : "";
        const config = normalizePersonaConfig((entry as any).config, PERSONA_LIBRARY);
        const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString();
        return { id, name, hash, config, updatedAt } as PersonaProfile;
      })
      .filter(Boolean) as PersonaProfile[];
  } catch {
    return [];
  }
};

const saveProfiles = (profiles: PersonaProfile[]) => {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // ignore
  }
};

const DEFAULT_SETTINGS: AiSettings = {
  apiKey: "",
  provider: "openai",
  personaConfig: normalizePersonaConfig(DEFAULT_PERSONA_CONFIG, PERSONA_LIBRARY),
  modelByProvider: buildDefaultModelByProvider()
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
    const legacyGlobal = legacyStyleToGlobalParams(parsed as any);
    const personaConfig = normalizePersonaConfig((parsed as any).personaConfig, PERSONA_LIBRARY, legacyGlobal);
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
      personaConfig,
      modelByProvider: normalizeModelByProvider((parsed as any).modelByProvider)
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

  const status = document.createElement("div");
  status.className = "leditor-ai-settings-panel__status";
  const envStatus = document.createElement("div");
  envStatus.className = "leditor-ai-settings-panel__status";
  envStatus.style.opacity = "0.85";
  const syncStatus = (message = "Saved.") => {
    status.textContent = message;
    window.setTimeout(() => {
      status.textContent = "";
    }, 1200);
  };
  const defaultsSection = document.createElement("section");
  defaultsSection.className = "leditor-ai-settings-panel__defaults";
  const defaultsTitle = document.createElement("div");
  defaultsTitle.className = "leditor-ai-settings-panel__defaultsTitle";
  defaultsTitle.textContent = "Default models";
  const defaultsList = document.createElement("div");
  defaultsList.className = "leditor-ai-settings-panel__defaultsList";
  defaultsSection.append(defaultsTitle, defaultsList);
  const modelSelects = new Map<ProviderId, HTMLSelectElement>();

  const buildDefaultModelControls = () => {
    defaultsList.replaceChildren();
    for (const provider of PROVIDERS) {
      const row = document.createElement("div");
      row.className = "leditor-ai-settings-panel__defaultsRow";
      const name = document.createElement("div");
      name.className = "leditor-ai-settings-panel__defaultsName";
      name.textContent = PROVIDER_LABELS[provider] ?? provider;
      const select = document.createElement("select");
      select.className = "leditor-ai-settings-panel__select";
      for (const modelId of MODEL_OPTIONS_BY_PROVIDER[provider]) {
        const option = document.createElement("option");
        option.value = modelId;
        option.textContent = modelId;
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        const current = getAiSettings();
        const next = normalizeModelByProvider(current.modelByProvider);
        next[provider] = select.value;
        setAiSettings({ modelByProvider: next } as any);
        syncStatus("Saved.");
      });
      modelSelects.set(provider, select);
      row.append(name, select);
      defaultsList.appendChild(row);
    }
  };
  buildDefaultModelControls();

  const personaSection = document.createElement("section");
  personaSection.className = "leditor-ai-settings-panel__persona";
  const personaHeader = document.createElement("div");
  personaHeader.className = "leditor-ai-settings-panel__personaHeader";
  const personaTitle = document.createElement("h3");
  personaTitle.className = "leditor-ai-settings-panel__personaTitle";
  personaTitle.textContent = "Persona Panel";

  const personaModeSeg = renderSegmented([
    { value: "simple", label: "Simple" },
    { value: "advanced", label: "Advanced" }
  ]);

  const personaResetBtn = document.createElement("button");
  personaResetBtn.type = "button";
  personaResetBtn.className = "leditor-ai-settings-panel__ghostBtn";
  personaResetBtn.textContent = "Reset";
  personaHeader.append(personaTitle, personaModeSeg.wrap, personaResetBtn);

  const personaTabs = ["Choose", "Compose", "Tune", "Preview", "Export"] as const;
  const personaTabBar = document.createElement("div");
  personaTabBar.className = "leditor-ai-settings-panel__tabs";
  const personaTabButtons = new Map<string, HTMLButtonElement>();
  const personaPanels = new Map<string, HTMLDivElement>();

  const personaTabBody = document.createElement("div");
  personaTabBody.className = "leditor-ai-settings-panel__tabBody";

  for (const tab of personaTabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "leditor-ai-settings-panel__tab";
    btn.textContent = tab;
    personaTabButtons.set(tab, btn);
    personaTabBar.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "leditor-ai-settings-panel__tabPanel";
    panel.dataset.tab = tab;
    personaPanels.set(tab, panel);
    personaTabBody.appendChild(panel);
  }

  personaSection.append(personaHeader, personaTabBar, personaTabBody);

  const choosePanel = personaPanels.get("Choose") as HTMLDivElement;
  const composePanel = personaPanels.get("Compose") as HTMLDivElement;
  const tunePanel = personaPanels.get("Tune") as HTMLDivElement;
  const previewPanel = personaPanels.get("Preview") as HTMLDivElement;
  const exportPanel = personaPanels.get("Export") as HTMLDivElement;

  const chooseFilters = document.createElement("div");
  chooseFilters.className = "leditor-ai-settings-panel__filtersWrap";
  const basicFilters = document.createElement("div");
  basicFilters.className = "leditor-ai-settings-panel__filters";
  const advancedFilters = document.createElement("div");
  advancedFilters.className = "leditor-ai-settings-panel__filters is-advanced is-hidden";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search persona";
  searchInput.className = "leditor-ai-settings-panel__input";

  const theorySelect = document.createElement("select");
  theorySelect.className = "leditor-ai-settings-panel__select";
  const methodSelect = document.createElement("select");
  methodSelect.className = "leditor-ai-settings-panel__select";
  const normSelect = document.createElement("select");
  normSelect.className = "leditor-ai-settings-panel__select";
  const evidenceSelect = document.createElement("select");
  evidenceSelect.className = "leditor-ai-settings-panel__select";
  const epistemologySelect = document.createElement("select");
  epistemologySelect.className = "leditor-ai-settings-panel__select";

  const theoryOption = document.createElement("option");
  theoryOption.value = "";
  theoryOption.textContent = "All theories";
  theorySelect.appendChild(theoryOption);

  const methodOption = document.createElement("option");
  methodOption.value = "";
  methodOption.textContent = "All methods";
  methodSelect.appendChild(methodOption);

  const normOption = document.createElement("option");
  normOption.value = "";
  normOption.textContent = "All stances";
  normSelect.appendChild(normOption);

  const evidenceOption = document.createElement("option");
  evidenceOption.value = "";
  evidenceOption.textContent = "All evidence";
  evidenceSelect.appendChild(evidenceOption);

  const epistemologyOption = document.createElement("option");
  epistemologyOption.value = "";
  epistemologyOption.textContent = "All epistemologies";
  epistemologySelect.appendChild(epistemologyOption);

  const allPersonas = Object.entries(PERSONA_LIBRARY.personas ?? {}).map(([id, def]) => ({ id, def }));
  const theoryValues = Array.from(new Set(allPersonas.map(({ def }) => def.theory).filter(Boolean))).sort();
  theoryValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    theorySelect.appendChild(option);
  });

  const methodValues = Array.from(
    new Set(
      allPersonas
        .map(({ def }) => def.method_type)
        .filter((value): value is string => Boolean(value))
    )
  ).sort();
  methodValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatFilterLabel(value);
    methodSelect.appendChild(option);
  });

  const normValues = Array.from(
    new Set(
      allPersonas
        .map(({ def }) => def.normative_stance)
        .filter((value): value is string => Boolean(value))
    )
  ).sort();
  normValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatFilterLabel(value);
    normSelect.appendChild(option);
  });

  const evidenceValues = Array.from(
    new Set(
      allPersonas
        .map(({ def }) => def.evidence_style)
        .filter((value): value is string => Boolean(value))
    )
  ).sort();
  evidenceValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatFilterLabel(value);
    evidenceSelect.appendChild(option);
  });

  const epistemologyValues = Array.from(
    new Set(
      allPersonas
        .map(({ def }) => def.epistemology)
        .filter((value): value is string => Boolean(value))
    )
  ).sort();
  epistemologyValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatFilterLabel(value);
    epistemologySelect.appendChild(option);
  });

  let advancedFiltersOpen = false;
  const filtersHeader = document.createElement("div");
  filtersHeader.className = "leditor-ai-settings-panel__filtersHeader";
  const filtersTitle = document.createElement("div");
  filtersTitle.className = "leditor-ai-settings-panel__filtersTitle";
  filtersTitle.textContent = "Filters";
  const moreFiltersBtn = document.createElement("button");
  moreFiltersBtn.type = "button";
  moreFiltersBtn.className = "leditor-ai-settings-panel__ghostBtn";
  moreFiltersBtn.textContent = "More filters";
  filtersHeader.append(filtersTitle, moreFiltersBtn);

  const setAdvancedFiltersOpen = (open: boolean) => {
    advancedFiltersOpen = open;
    advancedFilters.classList.toggle("is-hidden", !open);
    moreFiltersBtn.textContent = open ? "Hide filters" : "More filters";
  };

  moreFiltersBtn.addEventListener("click", () => {
    setAdvancedFiltersOpen(!advancedFiltersOpen);
  });

  basicFilters.append(searchInput, theorySelect, methodSelect, normSelect);
  advancedFilters.append(evidenceSelect, epistemologySelect);
  chooseFilters.append(filtersHeader, basicFilters, advancedFilters);

  const personaGrid = document.createElement("div");
  personaGrid.className = "leditor-ai-settings-panel__personaGrid";

  const personaDetail = document.createElement("div");
  personaDetail.className = "leditor-ai-settings-panel__personaDetail";

  choosePanel.append(chooseFilters, personaGrid, personaDetail);

  const composeStack = document.createElement("div");
  composeStack.className = "leditor-ai-settings-panel__stack";
  composePanel.append(composeStack);

  const tuneGlobal = document.createElement("div");
  tuneGlobal.className = "leditor-ai-settings-panel__tune";
  const tuneOverrides = document.createElement("div");
  tuneOverrides.className = "leditor-ai-settings-panel__overrides";
  tunePanel.append(tuneGlobal, tuneOverrides);

  const previewSummary = document.createElement("div");
  previewSummary.className = "leditor-ai-settings-panel__previewSummary";
  const previewMeter = document.createElement("div");
  previewMeter.className = "leditor-ai-settings-panel__meter";
  const previewMeterFill = document.createElement("div");
  previewMeterFill.className = "leditor-ai-settings-panel__meterFill";
  previewMeter.appendChild(previewMeterFill);
  const previewText = document.createElement("pre");
  previewText.className = "leditor-ai-settings-panel__previewText";
  previewPanel.append(previewSummary, previewMeter, previewText);

  const exportSummary = document.createElement("div");
  exportSummary.className = "leditor-ai-settings-panel__previewSummary";
  const exportJson = document.createElement("textarea");
  exportJson.className = "leditor-ai-settings-panel__jsonBlock";
  exportJson.readOnly = true;
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "leditor-ai-settings-panel__ghostBtn";
  copyBtn.textContent = "Copy JSON";

  const importLabel = document.createElement("div");
  importLabel.className = "leditor-ai-settings-panel__label";
  importLabel.textContent = "Import persona config";
  const importJson = document.createElement("textarea");
  importJson.className = "leditor-ai-settings-panel__jsonBlock";
  importJson.placeholder = "Paste PersonaConfig JSON";
  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "leditor-ai-settings-panel__ghostBtn";
  importBtn.textContent = "Import";

  const profileRow = document.createElement("div");
  profileRow.className = "leditor-ai-settings-panel__profileRow";
  const profileName = document.createElement("input");
  profileName.type = "text";
  profileName.placeholder = "Profile name";
  profileName.className = "leditor-ai-settings-panel__input";
  const saveProfileBtn = document.createElement("button");
  saveProfileBtn.type = "button";
  saveProfileBtn.className = "leditor-ai-settings-panel__ghostBtn";
  saveProfileBtn.textContent = "Save profile";
  profileRow.append(profileName, saveProfileBtn);

  const profileList = document.createElement("div");
  profileList.className = "leditor-ai-settings-panel__profileList";

  exportPanel.append(exportSummary, exportJson, copyBtn, importLabel, importJson, importBtn, profileRow, profileList);

  form.append(defaultsSection, personaSection, envStatus, status);

  panel.append(header, form);
  root.appendChild(panel);

  const applySettingsToForm = (settings: AiSettings) => {
    const defaults = normalizeModelByProvider(settings.modelByProvider);
    for (const provider of PROVIDERS) {
      const select = modelSelects.get(provider);
      if (select) {
        select.value = defaults[provider];
      }
    }
    renderPersonaPanel(settings);
  };

  const refreshEnvStatus = async () => {
    if (!window.leditorHost?.getAiStatus) {
      envStatus.textContent = "OpenAI API key: (status unavailable in this host)";
      return;
    }
    try {
      const result = await window.leditorHost.getAiStatus();
      const hasApiKey = Boolean(result?.hasApiKey);
      envStatus.textContent = `OpenAI API key: ${hasApiKey ? "loaded from .env" : "missing"}`;
    } catch {
      envStatus.textContent = "OpenAI API key: (status check failed)";
    }
  };

  const applyPanelSettings = () => {
    applySettingsToForm(getAiSettings());
  };

  let activeTab = "Choose";
  const setActiveTab = (tab: string) => {
    if (!personaTabButtons.has(tab)) return;
    activeTab = tab;
    personaTabButtons.forEach((button, name) => {
      button.classList.toggle("is-active", name === tab);
    });
    personaPanels.forEach((panel, name) => {
      panel.classList.toggle("is-active", name === tab);
    });
  };

  personaTabButtons.forEach((button, tab) => {
    button.addEventListener("click", () => setActiveTab(tab));
  });

  const updatePersonaConfig = (mutator: (cfg: PersonaConfig) => PersonaConfig) => {
    const current = normalizePersonaConfig(getAiSettings().personaConfig, PERSONA_LIBRARY);
    const next = normalizePersonaConfig(mutator(current), PERSONA_LIBRARY);
    setAiSettings({ personaConfig: next });
    syncStatus();
  };

  const renderPersonaPanel = (settings: AiSettings) => {
    const personaConfig = normalizePersonaConfig(settings.personaConfig, PERSONA_LIBRARY);
    const compiled = compilePersonaConfig(personaConfig, PERSONA_LIBRARY);
    const selected = new Set(personaConfig.selectedPersonaIds);

    personaModeSeg.buttons.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.value === personaConfig.mode);
    });

    const composeBtn = personaTabButtons.get("Compose");
    if (composeBtn) {
      composeBtn.style.display = personaConfig.mode === "advanced" ? "inline-flex" : "none";
    }
    if (personaConfig.mode !== "advanced" && activeTab === "Compose") {
      setActiveTab("Choose");
    }

    const personaList = allPersonas.filter(({ def }) => {
      const search = searchInput.value.trim().toLowerCase();
      if (search) {
        const haystack = [def.name, def.theory, ...(def.subtraditions ?? [])].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (theorySelect.value && def.theory !== theorySelect.value) return false;
      if (methodSelect.value && def.method_type !== methodSelect.value) return false;
      if (normSelect.value && def.normative_stance !== normSelect.value) return false;
      if (evidenceSelect.value && def.evidence_style !== evidenceSelect.value) return false;
      if (epistemologySelect.value && def.epistemology !== epistemologySelect.value) return false;
      return true;
    });

    personaGrid.textContent = "";
    personaList.forEach(({ id, def }) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "leditor-ai-settings-panel__personaCard";
      card.dataset.id = id;
      card.classList.toggle("is-selected", selected.has(id));

      const title = document.createElement("div");
      title.className = "leditor-ai-settings-panel__personaCardTitle";
      title.textContent = def.name;
      const headerRow = document.createElement("div");
      headerRow.className = "leditor-ai-settings-panel__personaCardHeader";
      const icon = renderPersonaIcon(def.icon);
      if (icon) headerRow.appendChild(icon);
      headerRow.appendChild(title);
      const subtitle = document.createElement("div");
      subtitle.className = "leditor-ai-settings-panel__personaCardSubtitle";
      subtitle.textContent = def.theory;

      const thesis = document.createElement("div");
      thesis.className = "leditor-ai-settings-panel__personaCardThesis";
      thesis.textContent = def.assumptions?.[0] || def.voice?.tone || "";

      const tags = document.createElement("div");
      tags.className = "leditor-ai-settings-panel__tagRow";
      const tagValues = [def.theory, ...(def.subtraditions ?? []).slice(0, 2)].filter(Boolean);
      tagValues.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "leditor-ai-settings-panel__tag";
        chip.textContent = tag;
        tags.appendChild(chip);
      });

      card.append(headerRow, subtitle, thesis, tags);
      card.addEventListener("click", () => {
        updatePersonaConfig((cfg) => {
          if (cfg.mode === "simple") {
            return { ...cfg, selectedPersonaIds: [id], weights: { [id]: 1 } };
          }
          if (cfg.selectedPersonaIds.includes(id)) {
            const nextIds = cfg.selectedPersonaIds.filter((entry) => entry !== id);
            const nextWeights = { ...cfg.weights };
            delete nextWeights[id];
            return { ...cfg, selectedPersonaIds: nextIds, weights: nextWeights };
          }
          const nextIds = [...cfg.selectedPersonaIds, id].slice(0, MAX_STACK);
          const nextWeights = { ...cfg.weights };
          if (typeof nextWeights[id] !== "number") {
            nextWeights[id] = 1;
          }
          return { ...cfg, selectedPersonaIds: nextIds, weights: nextWeights };
        });
      });
      personaGrid.appendChild(card);
    });

    const selectedId = personaConfig.selectedPersonaIds[0];
    const selectedDef = selectedId ? PERSONA_LIBRARY.personas[selectedId] : null;
    personaDetail.textContent = "";
    if (selectedDef) {
      const detailTitle = document.createElement("div");
      detailTitle.className = "leditor-ai-settings-panel__detailTitle";
      const detailIcon = renderPersonaIcon(selectedDef.icon);
      if (detailIcon) detailTitle.appendChild(detailIcon);
      const detailTitleText = document.createElement("span");
      detailTitleText.textContent = `${selectedDef.name} details`;
      detailTitle.appendChild(detailTitleText);
      const detailBody = document.createElement("div");
      detailBody.className = "leditor-ai-settings-panel__detailBody";

      const makeLine = (label: string, value: string | string[] | undefined) => {
        if (!value || (Array.isArray(value) && value.length === 0)) return;
        const row = document.createElement("div");
        row.className = "leditor-ai-settings-panel__detailRow";
        const strong = document.createElement("strong");
        strong.textContent = label;
        const text = document.createElement("span");
        text.textContent = Array.isArray(value) ? value.join("; ") : value;
        row.append(strong, text);
        detailBody.appendChild(row);
      };

      makeLine("Assumptions", selectedDef.assumptions);
      makeLine("Methods", selectedDef.methods);
      makeLine("Preferred sources", selectedDef.preferred_sources);
      makeLine("Typical questions", selectedDef.typical_questions);
      makeLine("Blind spots", "Not specified; consider counter-posing with another persona.");

      personaDetail.append(detailTitle, detailBody);
    }

    composeStack.textContent = "";
    if (personaConfig.mode === "advanced") {
      const stackHint = document.createElement("div");
      stackHint.className = "leditor-ai-settings-panel__stackHint";
      stackHint.textContent = `Stacked personas (${personaConfig.selectedPersonaIds.length}/${MAX_STACK}).`;
      composeStack.appendChild(stackHint);
      personaConfig.selectedPersonaIds.forEach((personaId) => {
        const persona = PERSONA_LIBRARY.personas?.[personaId];
        if (!persona) return;
        const row = document.createElement("div");
        row.className = "leditor-ai-settings-panel__stackRow";
        const name = document.createElement("div");
        name.className = "leditor-ai-settings-panel__stackName";
        name.textContent = persona.name;
        const weightInput = document.createElement("input");
        weightInput.type = "range";
        weightInput.min = "0";
        weightInput.max = "100";
        weightInput.step = "1";
        weightInput.value = Math.round((personaConfig.weights?.[personaId] ?? 0) * 100).toString();
        weightInput.className = "leditor-ai-settings-panel__range";
        const weightValue = document.createElement("input");
        weightValue.type = "number";
        weightValue.min = "0";
        weightValue.max = "100";
        weightValue.step = "1";
        weightValue.className = "leditor-ai-settings-panel__weightInput";
        weightValue.value = weightInput.value;
        const anchorToggle = document.createElement("button");
        anchorToggle.type = "button";
        anchorToggle.className = "leditor-ai-settings-panel__ghostBtn";
        anchorToggle.textContent = personaConfig.anchorPersonaId === personaId ? "Anchor" : "Set anchor";
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "leditor-ai-settings-panel__ghostBtn";
        removeBtn.textContent = "Remove";

        const onWeightChange = (value: number) => {
          updatePersonaConfig((cfg) => {
            const nextWeights = { ...cfg.weights, [personaId]: Math.max(0, Math.min(1, value / 100)) };
            return { ...cfg, weights: nextWeights };
          });
        };

        weightInput.addEventListener("input", () => {
          weightValue.value = weightInput.value;
        });
        weightInput.addEventListener("change", () => onWeightChange(Number(weightInput.value)));
        weightValue.addEventListener("change", () => {
          weightInput.value = weightValue.value;
          onWeightChange(Number(weightValue.value));
        });
        anchorToggle.addEventListener("click", () => {
          updatePersonaConfig((cfg) => ({
            ...cfg,
            anchorPersonaId: cfg.anchorPersonaId === personaId ? undefined : personaId
          }));
        });
        removeBtn.addEventListener("click", () => {
          updatePersonaConfig((cfg) => ({
            ...cfg,
            selectedPersonaIds: cfg.selectedPersonaIds.filter((id) => id !== personaId)
          }));
        });

        row.append(name, weightInput, weightValue, anchorToggle, removeBtn);
        composeStack.appendChild(row);
      });
    } else {
      const simpleHint = document.createElement("div");
      simpleHint.className = "leditor-ai-settings-panel__stackHint";
      simpleHint.textContent = "Switch to Advanced to compose a persona stack.";
      composeStack.appendChild(simpleHint);
    }

    tuneGlobal.textContent = "";
    const audienceSeg = renderSegmented([
      { value: "non_expert", label: "Non-expert" },
      { value: "interdisciplinary", label: "Interdisciplinary" },
      { value: "expert", label: "Expert" }
    ]);
    audienceSeg.buttons.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.value === personaConfig.global.audience);
      btn.addEventListener("click", () => {
        updatePersonaConfig((cfg) => ({
          ...cfg,
          global: { ...cfg.global, audience: (btn.dataset.value as any) || DEFAULT_GLOBAL_PARAMS.audience }
        }));
      });
    });

    const formalityRange = document.createElement("input");
    formalityRange.type = "range";
    formalityRange.min = "0";
    formalityRange.max = "1";
    formalityRange.step = "0.05";
    formalityRange.value = personaConfig.global.formality.toFixed(2);
    formalityRange.className = "leditor-ai-settings-panel__range";
    const formalityValue = document.createElement("input");
    formalityValue.type = "number";
    formalityValue.min = "0";
    formalityValue.max = "1";
    formalityValue.step = "0.05";
    formalityValue.className = "leditor-ai-settings-panel__rangeValueInput";
    formalityValue.value = personaConfig.global.formality.toFixed(2);
    formalityRange.addEventListener("input", () => {
      formalityValue.value = formalityRange.value;
    });
    formalityRange.addEventListener("change", () => {
      updatePersonaConfig((cfg) => ({
        ...cfg,
        global: { ...cfg.global, formality: Number(formalityRange.value) }
      }));
    });
    formalityValue.addEventListener("change", () => {
      const nextValue = Number(formalityValue.value);
      formalityRange.value = Number.isFinite(nextValue) ? nextValue.toFixed(2) : formalityRange.value;
      updatePersonaConfig((cfg) => ({
        ...cfg,
        global: { ...cfg.global, formality: Number(formalityRange.value) }
      }));
    });

    const citationRange = document.createElement("input");
    citationRange.type = "range";
    citationRange.min = "0";
    citationRange.max = "1";
    citationRange.step = "0.05";
    citationRange.value = personaConfig.global.citationDensity.toFixed(2);
    citationRange.className = "leditor-ai-settings-panel__range";
    const citationValue = document.createElement("input");
    citationValue.type = "number";
    citationValue.min = "0";
    citationValue.max = "1";
    citationValue.step = "0.05";
    citationValue.className = "leditor-ai-settings-panel__rangeValueInput";
    citationValue.value = personaConfig.global.citationDensity.toFixed(2);
    citationRange.addEventListener("input", () => {
      citationValue.value = citationRange.value;
    });
    citationRange.addEventListener("change", () => {
      updatePersonaConfig((cfg) => ({
        ...cfg,
        global: { ...cfg.global, citationDensity: Number(citationRange.value) }
      }));
    });
    citationValue.addEventListener("change", () => {
      const nextValue = Number(citationValue.value);
      citationRange.value = Number.isFinite(nextValue) ? nextValue.toFixed(2) : citationRange.value;
      updatePersonaConfig((cfg) => ({
        ...cfg,
        global: { ...cfg.global, citationDensity: Number(citationRange.value) }
      }));
    });

    const profileSelect = document.createElement("select");
    profileSelect.className = "leditor-ai-settings-panel__select";
    [
      { value: "academic_paper", label: "Academic paper" },
      { value: "policy_memo", label: "Policy memo" },
      { value: "seminar_notes", label: "Seminar notes" },
      { value: "peer_review_response", label: "Peer review" }
    ].forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === personaConfig.global.outputProfile) option.selected = true;
      profileSelect.appendChild(option);
    });
    profileSelect.addEventListener("change", () => {
      updatePersonaConfig((cfg) => ({
        ...cfg,
        global: {
          ...cfg.global,
          outputProfile: (profileSelect.value as any) || DEFAULT_GLOBAL_PARAMS.outputProfile
        }
      }));
    });

    const outputToggleWrap = document.createElement("div");
    outputToggleWrap.className = "leditor-ai-settings-panel__toggleRow";
    const includeConfigToggle = document.createElement("input");
    includeConfigToggle.type = "checkbox";
    includeConfigToggle.checked = personaConfig.includeConfigInOutput;
    const includeConfigLabel = document.createElement("span");
    includeConfigLabel.textContent = "Include persona config appendix";
    const includeHashToggle = document.createElement("input");
    includeHashToggle.type = "checkbox";
    includeHashToggle.checked = personaConfig.includeConfigHashInFootnote;
    const includeHashLabel = document.createElement("span");
    includeHashLabel.textContent = "Cite config hash in footnote";
    const toggleRow1 = document.createElement("label");
    toggleRow1.className = "leditor-ai-settings-panel__toggle";
    toggleRow1.append(includeConfigToggle, includeConfigLabel);
    const toggleRow2 = document.createElement("label");
    toggleRow2.className = "leditor-ai-settings-panel__toggle";
    toggleRow2.append(includeHashToggle, includeHashLabel);
    outputToggleWrap.append(toggleRow1, toggleRow2);

    includeConfigToggle.addEventListener("change", () => {
      updatePersonaConfig((cfg) => ({ ...cfg, includeConfigInOutput: includeConfigToggle.checked }));
    });
    includeHashToggle.addEventListener("change", () => {
      updatePersonaConfig((cfg) => ({ ...cfg, includeConfigHashInFootnote: includeHashToggle.checked }));
    });

    const globalControls = document.createElement("div");
    globalControls.className = "leditor-ai-settings-panel__tuneControls";

    globalControls.append(
      renderField("Audience", audienceSeg.wrap),
      renderField(
        "Formality",
        (() => {
          const wrapper = document.createElement("div");
          wrapper.className = "leditor-ai-settings-panel__rangeRow";
          wrapper.append(formalityRange, formalityValue);
          return wrapper;
        })()
      ),
      renderField(
        "Citation density",
        (() => {
          const wrapper = document.createElement("div");
          wrapper.className = "leditor-ai-settings-panel__rangeRow";
          wrapper.append(citationRange, citationValue);
          return wrapper;
        })()
      ),
      renderField("Output profile", profileSelect)
    );

    globalControls.append(outputToggleWrap);

    tuneGlobal.append(globalControls);

    tuneOverrides.textContent = "";
    personaConfig.selectedPersonaIds.forEach((personaId) => {
      const persona = PERSONA_LIBRARY.personas?.[personaId];
      if (!persona || !persona.params || persona.params.length === 0) return;
      const section = document.createElement("div");
      section.className = "leditor-ai-settings-panel__overrideSection";
      const sectionTitle = document.createElement("div");
      sectionTitle.className = "leditor-ai-settings-panel__overrideTitle";
      sectionTitle.textContent = `${persona.name} parameters`;
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "leditor-ai-settings-panel__ghostBtn";
      resetBtn.textContent = "Reset";
      resetBtn.addEventListener("click", () => {
        updatePersonaConfig((cfg) => {
          const next = { ...cfg, perPersona: { ...cfg.perPersona } };
          delete next.perPersona[personaId];
          return next;
        });
      });
      const headerRow = document.createElement("div");
      headerRow.className = "leditor-ai-settings-panel__overrideHeader";
      headerRow.append(sectionTitle, resetBtn);

      const controlList = document.createElement("div");
      controlList.className = "leditor-ai-settings-panel__overrideControls";

      persona.params.forEach((param) => {
        const row = document.createElement("div");
        row.className = "leditor-ai-settings-panel__overrideRow";
        const label = document.createElement("label");
        label.className = "leditor-ai-settings-panel__label";
        label.textContent = param.name;
        let control: HTMLElement;
        const overrideValue = personaConfig.perPersona?.[personaId]?.[param.name];
        const currentValue = typeof overrideValue !== "undefined" ? overrideValue : param.default;
        const options = String(param.description || "").split("|").map((entry) => entry.trim()).filter(Boolean);

        if (param.type === "boolean") {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = Boolean(currentValue);
          checkbox.addEventListener("change", () => {
            updatePersonaConfig((cfg) => {
              const next = { ...cfg, perPersona: { ...cfg.perPersona } };
              const per = { ...(next.perPersona[personaId] ?? {}) };
              const nextValue = checkbox.checked;
              if (nextValue === param.default) {
                delete per[param.name];
              } else {
                per[param.name] = nextValue;
              }
              if (Object.keys(per).length === 0) {
                delete next.perPersona[personaId];
              } else {
                next.perPersona[personaId] = per;
              }
              return next;
            });
          });
          control = checkbox;
        } else if (options.length > 0) {
          const select = document.createElement("select");
          select.className = "leditor-ai-settings-panel__select";
          options.forEach((optionValue) => {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = optionValue;
            if (optionValue === String(currentValue)) option.selected = true;
            select.appendChild(option);
          });
          select.addEventListener("change", () => {
            updatePersonaConfig((cfg) => {
              const next = { ...cfg, perPersona: { ...cfg.perPersona } };
              const per = { ...(next.perPersona[personaId] ?? {}) };
              const nextValue = select.value;
              if (nextValue === String(param.default)) {
                delete per[param.name];
              } else {
                per[param.name] = nextValue;
              }
              if (Object.keys(per).length === 0) {
                delete next.perPersona[personaId];
              } else {
                next.perPersona[personaId] = per;
              }
              return next;
            });
          });
          control = select;
        } else if (param.type === "number") {
          const input = document.createElement("input");
          input.type = "number";
          input.className = "leditor-ai-settings-panel__input";
          input.value = Number(currentValue).toString();
          input.addEventListener("change", () => {
            const value = Number(input.value);
            updatePersonaConfig((cfg) => {
              const next = { ...cfg, perPersona: { ...cfg.perPersona } };
              const per = { ...(next.perPersona[personaId] ?? {}) };
              if (value === param.default) {
                delete per[param.name];
              } else {
                per[param.name] = value;
              }
              if (Object.keys(per).length === 0) {
                delete next.perPersona[personaId];
              } else {
                next.perPersona[personaId] = per;
              }
              return next;
            });
          });
          control = input;
        } else {
          const input = document.createElement("input");
          input.type = "text";
          input.className = "leditor-ai-settings-panel__input";
          input.value = String(currentValue);
          input.addEventListener("change", () => {
            const value = input.value.trim();
            updatePersonaConfig((cfg) => {
              const next = { ...cfg, perPersona: { ...cfg.perPersona } };
              const per = { ...(next.perPersona[personaId] ?? {}) };
              if (value === String(param.default)) {
                delete per[param.name];
              } else {
                per[param.name] = value;
              }
              if (Object.keys(per).length === 0) {
                delete next.perPersona[personaId];
              } else {
                next.perPersona[personaId] = per;
              }
              return next;
            });
          });
          control = input;
        }

        row.append(label, control);
        controlList.appendChild(row);
      });

      section.append(headerRow, controlList);
      tuneOverrides.appendChild(section);
    });

    previewSummary.textContent = `Config hash: ${compiled.hash} • Directives ${compiled.directiveLength} chars`;
    const budgetPct = Math.min(1, compiled.directiveLength / DIRECTIVE_BUDGET);
    previewMeterFill.style.width = `${Math.round(budgetPct * 100)}%`;
    previewText.textContent = compiled.directives;

    exportSummary.textContent = `PersonaConfig JSON (hash ${compiled.hash})`;
    exportJson.value = compiled.configJsonPretty;

    const profiles = loadProfiles();
    profileList.textContent = "";
    profiles.forEach((profile) => {
      const row = document.createElement("div");
      row.className = "leditor-ai-settings-panel__profileItem";
      const label = document.createElement("div");
      label.className = "leditor-ai-settings-panel__profileLabel";
      label.textContent = `${profile.name} • ${profile.hash}`;
      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "leditor-ai-settings-panel__ghostBtn";
      applyBtn.textContent = "Apply";
      applyBtn.addEventListener("click", () => {
        setAiSettings({ personaConfig: profile.config });
        syncStatus(`Loaded ${profile.name}.`);
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "leditor-ai-settings-panel__ghostBtn";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        const next = profiles.filter((entry) => entry.id !== profile.id);
        saveProfiles(next);
        renderPersonaPanel(getAiSettings());
      });
      row.append(label, applyBtn, deleteBtn);
      profileList.appendChild(row);
    });
  };

  personaModeSeg.buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      updatePersonaConfig((cfg) => ({
        ...cfg,
        mode: btn.dataset.value === "advanced" ? "advanced" : "simple"
      }));
    });
  });

  personaResetBtn.addEventListener("click", () => {
    updatePersonaConfig(() => normalizePersonaConfig(DEFAULT_PERSONA_CONFIG, PERSONA_LIBRARY));
  });

  [searchInput, theorySelect, methodSelect, normSelect, evidenceSelect, epistemologySelect].forEach((el) => {
    el.addEventListener("input", () => renderPersonaPanel(getAiSettings()));
    el.addEventListener("change", () => renderPersonaPanel(getAiSettings()));
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(exportJson.value);
      syncStatus("Copied.");
    } catch {
      exportJson.select();
      syncStatus("Select + copy.");
    }
  });

  importBtn.addEventListener("click", () => {
    try {
      const parsed = JSON.parse(importJson.value);
      const normalized = normalizePersonaConfig(parsed, PERSONA_LIBRARY);
      setAiSettings({ personaConfig: normalized });
      importJson.value = "";
      syncStatus("Imported.");
    } catch {
      syncStatus("Import failed.");
    }
  });

  saveProfileBtn.addEventListener("click", () => {
    const name = profileName.value.trim();
    if (!name) {
      syncStatus("Profile name required.");
      return;
    }
    const compiled = compilePersonaConfig(normalizePersonaConfig(getAiSettings().personaConfig, PERSONA_LIBRARY), PERSONA_LIBRARY);
    const profiles = loadProfiles();
    const next: PersonaProfile = {
      id: makeProfileId(),
      name,
      hash: compiled.hash,
      config: compiled.config,
      updatedAt: new Date().toISOString()
    };
    saveProfiles([next, ...profiles].slice(0, 24));
    profileName.value = "";
    renderPersonaPanel(getAiSettings());
    syncStatus("Profile saved.");
  });

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

  setActiveTab("Choose");
  applyPanelSettings();

  return controller;
};
