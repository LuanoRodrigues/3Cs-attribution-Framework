import {
  GENERAL_KEYS,
  APPEARANCE_KEYS,
  ZOTERO_KEYS,
  LLM_KEYS,
  DATABASE_KEYS
} from "../config/settingsKeys";

import Picker from "vanilla-picker/csp";
import { resolveDensityTokens, type Density, type Effects } from "../renderer/theme/density";
import { resolveThemeTokens, themeIds, type ThemeId } from "../renderer/theme/tokens";

(() => {
  const root = document.getElementById("settings-root");
  const settingsBridge = window.settingsBridge;
  if (!root || !settingsBridge) {
    if (root) {
      root.textContent = "Settings bridge is unavailable.";
    }
    return;
  }
  const bridge = settingsBridge;

  type SettingInput = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  type FieldType = "text" | "textarea" | "select" | "checkbox";

  interface FieldDefinition {
    key: string;
    label: string;
    type?: FieldType;
    placeholder?: string;
    rows?: number;
    options?: { value: string; label: string }[];
  }

  const fieldInputs: Record<string, SettingInput> = {};
  const secretInputs: Record<string, HTMLInputElement> = {};
  const secretToggles: Record<string, HTMLButtonElement> = {};
  const vaultHints: HTMLElement[] = [];
  const pathCodes: Record<string, HTMLElement> = {};
  const PATH_ENTRIES = [
    { key: "appDataPath", label: "App data" },
    { key: "configPath", label: "Config directory" },
    { key: "settingsFilePath", label: "Settings JSON" },
    { key: "exportPath", label: "Export directory" }
  ] as const;

  const VALUE_KEYS = [
    GENERAL_KEYS.authorName,
    GENERAL_KEYS.authorAffiliation,
    GENERAL_KEYS.authorContact,
    GENERAL_KEYS.projectName,
    GENERAL_KEYS.collectionName,
    GENERAL_KEYS.researchQuestion,
    GENERAL_KEYS.eligibilityCriteria,
    GENERAL_KEYS.lastProjectPath,
    GENERAL_KEYS.lastKeywords,
    ZOTERO_KEYS.lastCollection,
    APPEARANCE_KEYS.theme,
    APPEARANCE_KEYS.density,
    APPEARANCE_KEYS.effects,
    APPEARANCE_KEYS.uiScale,
    APPEARANCE_KEYS.accent,
    ZOTERO_KEYS.libraryId,
    ZOTERO_KEYS.libraryType,
    LLM_KEYS.provider,
    LLM_KEYS.openaiBaseUrl,
    LLM_KEYS.geminiBaseUrl,
    LLM_KEYS.deepSeekBaseUrl,
    LLM_KEYS.mistralBaseUrl
  ];

  const CHECKBOX_KEYS = [GENERAL_KEYS.pdfSelectionAutoCopy, LLM_KEYS.telemetryEnabled];

  const SECRET_KEYS = [
    ZOTERO_KEYS.apiKey,
    LLM_KEYS.openaiKey,
    LLM_KEYS.geminiKey,
    LLM_KEYS.deepSeekKey,
    LLM_KEYS.mistralKey,
    DATABASE_KEYS.wosKey,
    DATABASE_KEYS.serpApiKey,
    DATABASE_KEYS.elsevierKey,
    DATABASE_KEYS.springerKey,
    DATABASE_KEYS.semanticScholarKey
  ];

  const DEFAULT_VAULT_PASSPHRASE = "1234";

  let secretsUnlocked = false;
  let dotenvStatusElement: HTMLElement | null = null;
  const pendingEnvSecrets: Record<string, string> = {};
  let jsonViewElement: HTMLElement;
  let secretsStatusElement: HTMLElement;
  let passphraseField: HTMLInputElement;
  let unlockSecretButton: HTMLButtonElement;

  const navButtons: Record<string, HTMLButtonElement> = {};
  const panels: Record<string, HTMLElement> = {};

  type SettingsSnapshot = Record<string, unknown>;
  let latestSnapshot: SettingsSnapshot = {};

  const LLM_PROVIDERS = [
    {
      id: "openai",
      name: "OpenAI",
      baseKey: LLM_KEYS.openaiBaseUrl,
      secretKey: LLM_KEYS.openaiKey,
      placeholder: "https://api.openai.com/v1",
      envKey: ["OPENAI_API_KEY", "OPENAI_KEY"],
      envBase: ["OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_BASEURL"]
    },
    {
      id: "gemini",
      name: "Gemini",
      baseKey: LLM_KEYS.geminiBaseUrl,
      secretKey: LLM_KEYS.geminiKey,
      placeholder: "https://generative.googleapis.com/v1",
      envKey: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GEMINI_API_KEY"],
      envBase: ["GEMINI_BASE_URL", "GOOGLE_API_BASE", "GEMINI_API_BASE"]
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      baseKey: LLM_KEYS.deepSeekBaseUrl,
      secretKey: LLM_KEYS.deepSeekKey,
      placeholder: "https://api.deepseek.com",
      envKey: ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY"],
      envBase: ["DEEPSEEK_BASE_URL", "DEEPSEEK_API_BASE"]
    },
    {
      id: "mistral",
      name: "Mistral",
      baseKey: LLM_KEYS.mistralBaseUrl,
      secretKey: LLM_KEYS.mistralKey,
      placeholder: "https://api.mistral.ai",
      envKey: ["MISTRAL_API_KEY", "MISTRAL_KEY"],
      envBase: ["MISTRAL_BASE_URL", "MISTRAL_API_BASE"]
    }
  ] as const;

  const isThemeId = (value: unknown): value is ThemeId =>
    typeof value === "string" && themeIds.includes(value as ThemeId);

  const isHexColor = (value: unknown): value is string =>
    typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim());

  const normalizeTheme = (value: unknown): ThemeId => {
    if (isThemeId(value)) return value;
    if (typeof value === "string" && themeIds.includes(value.toLowerCase() as ThemeId)) {
      return value.toLowerCase() as ThemeId;
    }
    return "system";
  };

  const normalizeDensity = (value: unknown): Density => (value === "compact" ? "compact" : "comfortable");
  const normalizeEffects = (value: unknown): Effects => (value === "performance" ? "performance" : "full");

  const normalizeScale = (value: unknown): number => {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? parseFloat(value)
          : Number.NaN;
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(1.4, Math.max(0.8, parsed));
  };

  const getSystemPreference = (): "dark" | "light" =>
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

  const applyCssVars = (vars: Record<string, string>): void => {
    const el = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v));
  };

  const applyAppearance = (snapshot: SettingsSnapshot): void => {
    const themeId = normalizeTheme(snapshot[APPEARANCE_KEYS.theme]);
    const systemPref = getSystemPreference();
    const base = resolveThemeTokens(themeId, systemPref);

    const accentOverride = isHexColor(snapshot[APPEARANCE_KEYS.accent])
      ? String(snapshot[APPEARANCE_KEYS.accent])
      : null;
    const accent = accentOverride ?? base.accent;

    const resolvedTheme: ThemeId =
      themeId === "system" ? (systemPref === "dark" ? "dark" : "light") : themeId;

    const density = normalizeDensity(snapshot[APPEARANCE_KEYS.density]);
    const effects = normalizeEffects(snapshot[APPEARANCE_KEYS.effects]);
    const scale = normalizeScale(snapshot[APPEARANCE_KEYS.uiScale]);

    const themeVars: Record<string, string> = {
      "--bg": base.bg,
      "--panel": base.panel,
      "--panel-2": base.panel2,
      "--surface": base.surface,
      "--surface-muted": base.surfaceMuted,
      "--text": base.text,
      "--muted": base.muted,
      "--border": base.border,
      "--border-soft": base.borderSoft,
      "--card-border": base.cardBorder,
      "--accent": accent,
      "--accent-2": base.accent2,
      "--shadow": base.shadow,
      "--gradient-1": base.gradient1,
      "--gradient-2": base.gradient2,
      "--ribbon": base.ribbon,
      "--focus": base.focus,
      "--highlight": base.accent2,
      "--link": accent,
      "--link-hover": base.accent2,
      "--sidebar-bg": base.panel2,
      "--paper-border": base.border,
      "--paper-text": base.text,
      "--paper-muted": base.muted,
      "--red": base.red,
      "--orange": base.orange,
      "--yellow": base.yellow,
      "--green": base.green,
      "--cyan": base.cyan,
      "--blue": base.blue,
      "--purple": base.purple,
      "--danger": base.danger,
      "--warning": base.warning,
      "--success": base.success,
      "--info": base.info,
      "--app-scale": String(scale)
    };

    const densityVars = resolveDensityTokens(density, effects);
    applyCssVars({ ...themeVars, ...densityVars });

    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.density = density;
    document.documentElement.dataset.effects = effects;
  };

  const shell = document.createElement("div");
  shell.className = "settings-shell";
  root.appendChild(shell);

  const nav = document.createElement("section");
  nav.className = "settings-nav";
  const navTitle = document.createElement("div");
  navTitle.className = "settings-nav-title";
  navTitle.textContent = "Settings";
  nav.appendChild(navTitle);
  shell.appendChild(nav);

  const content = document.createElement("div");
  content.className = "settings-content";
  shell.appendChild(content);

  const header = document.createElement("div");
  header.className = "settings-header";
  const headerText = document.createElement("div");
  const heading = document.createElement("h1");
  heading.className = "settings-title";
  heading.textContent = "Annotarium Settings";
  const subtitle = document.createElement("p");
  subtitle.className = "settings-subtitle";
  subtitle.textContent = "Author profiles, Zotero integration, and model API configuration.";
  headerText.appendChild(heading);
  headerText.appendChild(subtitle);
  header.appendChild(headerText);

  const headerActions = document.createElement("div");
  headerActions.className = "settings-actions";
  const reloadButton = document.createElement("button");
  reloadButton.type = "button";
  reloadButton.className = "action-button";
  reloadButton.textContent = "Reload";
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "action-button primary";
  applyButton.textContent = "Apply changes";
  headerActions.appendChild(reloadButton);
  headerActions.appendChild(applyButton);
  header.appendChild(headerActions);

  content.appendChild(header);

  const statusLine = document.createElement("div");
  statusLine.className = "status-tag";
  statusLine.textContent = "Loading settings...";
  content.appendChild(statusLine);

  const panelWrapper = document.createElement("div");
  content.appendChild(panelWrapper);

  const navGroups = [
    {
      title: "General",
      items: [
        { id: "author", label: "Author details", build: buildAuthorPanel },
        { id: "project", label: "Project defaults", build: buildProjectPanel },
        { id: "appearance", label: "Appearance", build: buildAppearancePanel },
        { id: "coder-shortcuts", label: "Coder shortcuts", build: buildCoderShortcutsPanel }
      ]
    },
    {
      title: "Zotero Integration",
      items: [
        { id: "zotero-library", label: "Library ID", build: buildZoteroLibraryPanel },
        { id: "zotero-type", label: "Library type", build: buildZoteroTypePanel },
        { id: "zotero-api", label: "API key", build: buildZoteroApiPanel }
      ]
    },
    {
      title: "Model APIs",
      items: [
        { id: "model-defaults", label: "Provider defaults", build: buildModelDefaultsPanel },
        { id: "model-providers", label: "LLM providers", build: buildModelProvidersPanel },
        { id: "model-databases", label: "Database keys", build: buildDatabasePanel }
      ]
    },
    {
      title: "Advanced",
      items: [
        { id: "vault", label: "Secrets vault", build: buildVaultPanel },
        { id: "paths", label: "Paths", build: buildPathsPanel },
        { id: "raw", label: "Raw JSON", build: buildRawPanel }
      ]
    }
  ];

  navGroups.forEach((group) => {
    const groupWrapper = document.createElement("div");
    groupWrapper.className = "settings-nav-group";
    const groupTitle = document.createElement("div");
    groupTitle.className = "settings-nav-group-title";
    groupTitle.textContent = group.title;
    groupWrapper.appendChild(groupTitle);
    group.items.forEach((section) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-button";
      button.textContent = section.label;
      button.addEventListener("click", () => setActiveSection(section.id));
      groupWrapper.appendChild(button);
      navButtons[section.id] = button;

      const panel = document.createElement("div");
      panel.className = "settings-panel";
      section.build(panel);
      panelWrapper.appendChild(panel);
      panels[section.id] = panel;
    });
    nav.appendChild(groupWrapper);
  });

  const firstSection = navGroups[0]?.items[0];
  if (firstSection) {
    navButtons[firstSection.id]?.classList.add("active");
    panels[firstSection.id]?.classList.add("active");
  }

  applyInitialSection();

  window.addEventListener("hashchange", () => {
    const section = readSectionFromHash();
    if (section) {
      setActiveSection(section);
    }
  });

  reloadButton.addEventListener("click", reloadAll);
  applyButton.addEventListener("click", applySettings);

  init();

  function setActiveSection(id: string) {
    Object.keys(panels).forEach((key) => {
      const panel = panels[key];
      const navButton = navButtons[key];
      if (!panel || !navButton) {
        return;
      }
      const isActive = key === id;
      panel.classList.toggle("active", isActive);
      navButton.classList.toggle("active", isActive);
    });
  }

  async function init() {
    try {
      await attemptDefaultVaultUnlock();
      await reloadAll();
      setStatus("Settings ready");
    } catch (error) {
      setStatus("Unable to load settings", true);
    }
  }

  async function reloadAll() {
    setStatus("Refreshing settings...");
    await loadSettingsSnapshot();
    await refreshPaths();
    await refreshSecretInputs();
    await refreshDotEnvStatusAndPrefill();
  }

  async function loadSettingsSnapshot() {
    const snapshot = await bridge.getAll();
    latestSnapshot = snapshot as SettingsSnapshot;
    Object.keys(fieldInputs).forEach((key) => {
      const rawValue = snapshot[key];
      const inputElement = fieldInputs[key];
      if (!inputElement) {
        return;
      }
      if (inputElement instanceof HTMLInputElement && inputElement.type === "checkbox") {
        inputElement.checked = rawValue === true || rawValue === "true";
        return;
      }
      const normalized = rawValue === undefined || rawValue === null ? "" : String(rawValue);
      inputElement.value = normalized;
    });
    const accentInput = fieldInputs[APPEARANCE_KEYS.accent];
    if (accentInput) {
      accentInput.dispatchEvent(new Event("input"));
    }
    if (jsonViewElement) {
      jsonViewElement.textContent = JSON.stringify(snapshot, null, 2);
    }
    applyAppearance(latestSnapshot);
    setStatus("Settings loaded");
  }

  async function refreshPaths() {
    try {
      const paths = await bridge.getPaths();
      PATH_ENTRIES.forEach((entry) => {
        const target = pathCodes[entry.key];
        if (!target) {
          return;
        }
        target.textContent = paths[entry.key] || "-";
      });
    } catch (error) {
      setStatus("Failed to read paths", true);
    }
  }

  async function refreshDotEnvStatusAndPrefill() {
    const fn = (bridge as any).getDotEnvStatus as undefined | (() => Promise<{ found: boolean; paths: string[]; values: Record<string, string> }>);
    if (typeof fn !== "function") {
      return;
    }
    try {
      const status = await fn();
      if (dotenvStatusElement) {
        dotenvStatusElement.textContent = status?.found
          ? `.env found (${(status?.paths || []).join(", ")})`
          : "no .env found, insert apis below";
      }

      const envValues = status?.values || {};
      const getEnv = (keys: readonly string[]): string => keys.map((k) => String(envValues[k] || "").trim()).find(Boolean) || "";

      LLM_PROVIDERS.forEach((provider) => {
        const baseVal = getEnv(provider.envBase);
        const keyVal = getEnv(provider.envKey);

        const baseInput = fieldInputs[provider.baseKey];
        if (baseInput && baseVal) {
          const current = baseInput.value.trim();
          if (!current || current === provider.placeholder) {
            baseInput.value = baseVal;
          }
        }

        if (keyVal) {
          pendingEnvSecrets[provider.secretKey] = keyVal;
          const secretInput = secretInputs[provider.secretKey];
          if (secretsUnlocked && secretInput && !secretInput.value.trim()) {
            secretInput.value = keyVal;
          }
        }
      });
    } catch {
      if (dotenvStatusElement) {
        dotenvStatusElement.textContent = "no .env found, insert apis below";
      }
    }
  }

  function createPanelCard(title: string, subtitle?: string) {
    const card = document.createElement("div");
    card.className = "panel-card";
    if (title) {
      const heading = document.createElement("div");
      heading.className = "panel-card-title";
      heading.textContent = title;
      card.appendChild(heading);
    }
    if (subtitle) {
      const hint = document.createElement("div");
      hint.className = "panel-card-subtitle";
      hint.textContent = subtitle;
      card.appendChild(hint);
    }
    return card;
  }

  function createFieldBlock(def: FieldDefinition) {
    const row = document.createElement("div");
    row.className = "field-row";
    const label = document.createElement("label");
    label.textContent = def.label;
    row.appendChild(label);

    let input: SettingInput;
    if (def.type === "textarea") {
      const area = document.createElement("textarea");
      if (def.rows) {
        area.rows = def.rows;
      }
      if (def.placeholder) {
        area.placeholder = def.placeholder;
      }
      input = area;
      row.appendChild(input);
    } else if (def.type === "select") {
      const select = document.createElement("select");
      if (!def.options || def.options.length === 0) {
        throw new Error(`Missing options for select ${def.key}`);
      }
      def.options.forEach((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        select.appendChild(node);
      });
      input = select;
      row.appendChild(input);
    } else if (def.type === "checkbox") {
      const box = document.createElement("input");
      box.type = "checkbox";
      const wrapper = document.createElement("div");
      wrapper.className = "checkbox-row";
      wrapper.appendChild(box);
      const text = document.createElement("span");
      text.textContent = def.label;
      wrapper.appendChild(text);
      row.appendChild(wrapper);
      fieldInputs[def.key] = box;
      return row;
    } else {
      const inputEl = document.createElement("input");
      inputEl.type = "text";
      if (def.placeholder) {
        inputEl.placeholder = def.placeholder;
      }
      input = inputEl;
      row.appendChild(input);
    }

    fieldInputs[def.key] = input;
    return row;
  }

  function createAccentPickerBlock() {
    const row = document.createElement("div");
    row.className = "field-row";

    const label = document.createElement("label");
    label.textContent = "Accent color";
    row.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.placeholder = "#2f74ff";
    input.setAttribute("aria-label", "Accent color value");
    input.style.display = "none";
    fieldInputs[APPEARANCE_KEYS.accent] = input;
    row.appendChild(input);

    const wrapper = document.createElement("div");
    wrapper.className = "accent-picker";

    const valueCode = document.createElement("code");
    valueCode.textContent = input.placeholder || "";

    const swatchGrid = document.createElement("div");
    swatchGrid.className = "accent-swatch-grid";

    const palette = [
      "#2563eb",
      "#0ea5e9",
      "#06b6d4",
      "#10b981",
      "#22c55e",
      "#84cc16",
      "#eab308",
      "#f97316",
      "#ef4444",
      "#ec4899",
      "#a855f7",
      "#64748b"
    ];

    const normalize = (value: string) => {
      const v = (value || "").trim();
      if (!v) return "";
      return v.startsWith("#") ? v.toLowerCase() : `#${v.toLowerCase()}`;
    };

    const applyValue = (raw: string) => {
      const next = normalize(raw);
      if (!next) {
        input.value = "";
        valueCode.textContent = input.placeholder || "";
      } else {
        input.value = next;
        valueCode.textContent = next;
      }
      swatchGrid.querySelectorAll<HTMLButtonElement>("button.accent-swatch").forEach((btn) => {
        const swatchHex = normalize(btn.dataset.hex || "");
        btn.setAttribute("aria-pressed", swatchHex === next ? "true" : "false");
        const dot = btn.querySelector<HTMLElement>(".accent-swatch-dot");
        if (dot) dot.style.display = swatchHex === next ? "block" : "none";
      });
    };

    palette.forEach((hex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "accent-swatch";
      btn.style.background = hex;
      btn.dataset.hex = hex;
      btn.setAttribute("aria-label", `Set accent color to ${hex}`);
      btn.setAttribute("aria-pressed", "false");
      const dot = document.createElement("span");
      dot.className = "accent-swatch-dot";
      dot.style.display = "none";
      btn.appendChild(dot);
      btn.addEventListener("click", () => applyValue(hex));
      swatchGrid.appendChild(btn);
    });

    const customButton = document.createElement("button");
    customButton.type = "button";
    customButton.className = "action-button";
    customButton.textContent = "Custom…";

    const picker = new Picker({
      parent: customButton,
      popup: "bottom",
      alpha: false,
      editor: true,
      editorFormat: "hex",
      cancelButton: true,
      color: input.placeholder || "#2f74ff"
    });
    picker.onOpen = () => {
      picker.setColor(input.value || input.placeholder || "#2f74ff", true);
    };
    picker.onChange = (color) => applyValue(color.hex);
    picker.onDone = (color) => applyValue(color.hex);

    wrapper.append(swatchGrid, customButton, valueCode);
    row.appendChild(wrapper);

    input.addEventListener("input", () => applyValue(input.value));
    applyValue(input.value);
    return row;
  }

  function createSecretField(key: string, labelText: string, placeholder?: string) {
    const block = document.createElement("div");
    block.className = "field-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    const row = document.createElement("div");
    row.className = "secret-row";
    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "new-password";
    if (placeholder) {
      input.placeholder = placeholder;
    }
    input.disabled = true;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "action-button";
    toggle.textContent = "Show";
    toggle.disabled = true;
    toggle.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
      toggle.textContent = input.type === "password" ? "Show" : "Hide";
    });
    row.appendChild(input);
    row.appendChild(toggle);
    block.appendChild(label);
    block.appendChild(row);
    secretInputs[key] = input;
    secretToggles[key] = toggle;
    return block;
  }

  function createVaultHint() {
    const hint = document.createElement("div");
    hint.className = "vault-hint";
    const text = document.createElement("span");
    text.textContent = "Secrets vault is locked. Unlock to edit API keys.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    button.textContent = "Unlock vault";
    button.addEventListener("click", () => {
      setActiveSection("vault");
      requestAnimationFrame(() => passphraseField?.focus());
    });
    hint.append(text, button);
    vaultHints.push(hint);
    return hint;
  }

  function buildAuthorPanel(panel: HTMLElement) {
    const card = createPanelCard("Author details", "Used for exports, citations, and document metadata.");
    const row = document.createElement("div");
    row.className = "control-row";
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.authorName,
        label: "Author name",
        placeholder: "Full name"
      })
    );
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.authorAffiliation,
        label: "Affiliation",
        placeholder: "Institution or lab"
      })
    );
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.authorContact,
        label: "Contact",
        placeholder: "Email or preferred contact"
      })
    );
    card.appendChild(row);
    panel.appendChild(card);
  }

  function buildProjectPanel(panel: HTMLElement) {
    const card = createPanelCard("Project defaults", "Prefill new sessions and exports with these values.");
    const row = document.createElement("div");
    row.className = "control-row";
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.projectName,
        label: "Project name",
        placeholder: "e.g. Annotarium Study 2026"
      })
    );
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.collectionName,
        label: "Collection name",
        placeholder: "Research reading list"
      })
    );
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.researchQuestion,
        label: "Research question",
        type: "textarea",
        rows: 3
      })
    );
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.eligibilityCriteria,
        label: "Eligibility criteria",
        type: "textarea",
        rows: 3
      })
    );
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.lastProjectPath,
        label: "Last project path",
        placeholder: "C:/projects/annotarium"
      })
    );
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.lastKeywords,
        label: "Last keywords",
        placeholder: "keyword, topic"
      })
    );
    row.appendChild(
      createFieldBlock({
        key: ZOTERO_KEYS.lastCollection,
        label: "Last Zotero collection"
      })
    );
    row.appendChild(
      createFieldBlock({
        key: GENERAL_KEYS.pdfSelectionAutoCopy,
        label: "Auto-copy PDF selections",
        type: "checkbox"
      })
    );
    card.appendChild(row);
    panel.appendChild(card);
  }

  function buildAppearancePanel(panel: HTMLElement) {
    const card = createPanelCard("Appearance", "Theme, density, scale, and accent for the workspace.");
    const row = document.createElement("div");
    row.className = "control-row";
    row.appendChild(
      createFieldBlock({
        key: APPEARANCE_KEYS.theme,
        label: "Theme profile",
        type: "select",
        options: [
          { value: "system", label: "System" },
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
          { value: "high-contrast", label: "High contrast" },
          { value: "colorful", label: "Colorful" },
          { value: "warm", label: "Warm" },
          { value: "cold", label: "Cold" }
        ]
      })
    );
    row.appendChild(
      createFieldBlock({
        key: APPEARANCE_KEYS.density,
        label: "Density",
        type: "select",
        options: [
          { value: "comfortable", label: "Comfortable" },
          { value: "compact", label: "Compact" }
        ]
      })
    );
    row.appendChild(
      createFieldBlock({
        key: APPEARANCE_KEYS.effects,
        label: "Effects mode",
        type: "select",
        options: [
          { value: "full", label: "Full effects" },
          { value: "performance", label: "Performance (reduced blur/shadow)" }
        ]
      })
    );
    row.appendChild(
      createFieldBlock({
        key: APPEARANCE_KEYS.uiScale,
        label: "UI scale",
        type: "select",
        options: [
          { value: "0.85", label: "85%" },
          { value: "0.9", label: "90%" },
          { value: "1", label: "100%" },
          { value: "1.1", label: "110%" },
          { value: "1.2", label: "120%" },
          { value: "1.3", label: "130%" },
          { value: "1.4", label: "140%" }
        ]
      })
    );
    row.appendChild(createAccentPickerBlock());
    card.appendChild(row);
    panel.appendChild(card);
  }

  function buildZoteroLibraryPanel(panel: HTMLElement) {
    const card = createPanelCard("Zotero library ID", "Your Zotero library identifier.");
    const row = document.createElement("div");
    row.className = "control-row";
    row.appendChild(
      createFieldBlock({
        key: ZOTERO_KEYS.libraryId,
        label: "Library ID"
      })
    );
    card.appendChild(row);
    panel.appendChild(card);
  }

  function buildZoteroTypePanel(panel: HTMLElement) {
    const card = createPanelCard("Zotero library type", "Select whether this is a user or group library.");
    const row = document.createElement("div");
    row.className = "control-row";
    row.appendChild(
      createFieldBlock({
        key: ZOTERO_KEYS.libraryType,
        label: "Library type",
        type: "select",
        options: [
          { value: "user", label: "User" },
          { value: "group", label: "Group" }
        ]
      })
    );
    card.appendChild(row);
    panel.appendChild(card);
  }

  function buildZoteroApiPanel(panel: HTMLElement) {
    const card = createPanelCard("Zotero API key", "Stored securely in the secrets vault.");
    card.appendChild(createVaultHint());
    card.appendChild(createSecretField(ZOTERO_KEYS.apiKey, "Zotero API key", "Paste your API key"));
    panel.appendChild(card);
  }

  function buildModelDefaultsPanel(panel: HTMLElement) {
    const card = createPanelCard("Model defaults", "Default provider and telemetry preferences.");
    const row = document.createElement("div");
    row.className = "control-row";
    row.appendChild(
      createFieldBlock({
        key: LLM_KEYS.provider,
        label: "Default provider",
        type: "select",
        options: [
          { value: "openai", label: "OpenAI" },
          { value: "gemini", label: "Gemini" },
          { value: "deepseek", label: "DeepSeek" },
          { value: "mistral", label: "Mistral" }
        ]
      })
    );
    row.appendChild(
      createFieldBlock({
        key: LLM_KEYS.telemetryEnabled,
        label: "Telemetry enabled",
        type: "checkbox"
      })
    );
    card.appendChild(row);
    panel.appendChild(card);
  }

  function buildModelProvidersPanel(panel: HTMLElement) {
    panel.appendChild(createVaultHint());
    const envCard = createPanelCard("Environment (.env)", "Auto-load API keys from your .env file.");
    dotenvStatusElement = document.createElement("div");
    dotenvStatusElement.className = "panel-card-subtitle";
    dotenvStatusElement.textContent = "Checking for .env...";
    envCard.appendChild(dotenvStatusElement);
    panel.appendChild(envCard);

    LLM_PROVIDERS.forEach((provider) => {
      const card = createPanelCard(`${provider.name} settings`, "Endpoint and API key for this provider.");
      const row = document.createElement("div");
      row.className = "control-row";
      row.appendChild(
        createFieldBlock({
          key: provider.baseKey,
          label: `${provider.name} base URL`,
          placeholder: provider.placeholder
        })
      );
      row.appendChild(createSecretField(provider.secretKey, `${provider.name} API key`));
      card.appendChild(row);
      panel.appendChild(card);
    });
  }

  function buildDatabasePanel(panel: HTMLElement) {
    const card = createPanelCard("Academic database keys", "Stored securely in the secrets vault.");
    card.appendChild(createVaultHint());
    const row = document.createElement("div");
    row.className = "control-row";
    row.appendChild(createSecretField(DATABASE_KEYS.wosKey, "Web of Science API key"));
    row.appendChild(createSecretField(DATABASE_KEYS.serpApiKey, "SerpApi key"));
    row.appendChild(createSecretField(DATABASE_KEYS.elsevierKey, "Elsevier API key"));
    row.appendChild(createSecretField(DATABASE_KEYS.springerKey, "Springer API key"));
    row.appendChild(createSecretField(DATABASE_KEYS.semanticScholarKey, "Semantic Scholar key"));
    card.appendChild(row);
    panel.appendChild(card);
  }

  function buildVaultPanel(panel: HTMLElement) {
    const card = createPanelCard("Secrets vault", "Unlock to view or update stored API keys.");
    const statusRow = document.createElement("div");
    statusRow.className = "secret-row";
    secretsStatusElement = document.createElement("span");
    secretsStatusElement.className = "status-tag";
    secretsStatusElement.textContent = "Secrets vault is locked";
    statusRow.appendChild(secretsStatusElement);
    card.appendChild(statusRow);

    const unlockRow = document.createElement("div");
    unlockRow.className = "control-row";
    const passBlock = document.createElement("div");
    passBlock.className = "field-block";
    const label = document.createElement("label");
    label.textContent = "Vault passphrase";
    passphraseField = document.createElement("input");
    passphraseField.type = "password";
    passphraseField.placeholder = "Enter passphrase";
    passBlock.appendChild(label);
    passBlock.appendChild(passphraseField);
    unlockSecretButton = document.createElement("button");
    unlockSecretButton.type = "button";
    unlockSecretButton.className = "action-button";
    unlockSecretButton.textContent = "Unlock secrets";
    unlockSecretButton.disabled = true;
    passphraseField.addEventListener("input", () => {
      unlockSecretButton.disabled = passphraseField.value.trim().length === 0;
    });
    unlockRow.appendChild(passBlock);
    unlockRow.appendChild(unlockSecretButton);
    card.appendChild(unlockRow);
    panel.appendChild(card);
    unlockSecretButton.addEventListener("click", () => unlockVault(passphraseField.value));
  }

  function buildCoderShortcutsPanel(panel: HTMLElement) {
    const card = createPanelCard("Coder shortcuts", "Keyboard and mouse shortcuts for the Coder tree.");
    const list = document.createElement("div");
    list.className = "shortcut-list";

    const add = (keys: string, desc: string) => {
      const row = document.createElement("div");
      row.className = "shortcut-row";
      const k = document.createElement("span");
      k.className = "shortcut-keys";
      k.textContent = keys;
      const d = document.createElement("span");
      d.className = "shortcut-desc";
      d.textContent = desc;
      row.append(k, d);
      list.appendChild(row);
    };

    add("Drag", "Move item/folder within the tree");
    add("Ctrl/Alt + Drag", "Copy item/folder to target");
    add("Delete / Backspace", "Delete selection");
    add("F2 or Enter", "Rename selected node");
    add("Ctrl/Cmd + N (Shift for root)", "New folder");
    add("Arrow Up/Down", "Change selection (Shift extends range)");
    add("Ctrl/Cmd + Arrow Up/Down", "Move node up/down within its folder");
    add("Ctrl/Cmd + PageUp/PageDown", "Move node to top/bottom of its folder");
    add("Home / End", "Jump to first/last visible row (Shift extends)");
    add("Ctrl/Cmd + D", "Duplicate selection");
    add("Ctrl/Cmd + Shift + V", "Paste clipboard as new item");
    add("1 / 2 / 3", "Set status: Included / Maybe / Excluded");
    add("Ctrl/Cmd + F", "Focus filter");
    add("F3 / Shift+F3 (Ctrl/Cmd+G)", "Next / previous match");
    add("Space", "Toggle folder expand/collapse");
    add("Alt + Arrow Left/Right", "Collapse / expand all folders");
    add("Alt + N", "Toggle note panel");

    card.appendChild(list);
    panel.appendChild(card);
  }

  function buildPathsPanel(panel: HTMLElement) {
    const card = createPanelCard("Storage paths", "Active paths for settings and vault storage.");
    const list = document.createElement("div");
    list.className = "path-list";
    PATH_ENTRIES.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "path-item";
      const label = document.createElement("span");
      label.textContent = entry.label;
      const code = document.createElement("code");
      code.textContent = "-";
      pathCodes[entry.key] = code;
      item.appendChild(label);
      item.appendChild(code);
      list.appendChild(item);
    });
    card.appendChild(list);
    panel.appendChild(card);
  }

  function buildRawPanel(panel: HTMLElement) {
    const card = createPanelCard("Raw settings snapshot", "JSON export of persisted settings keys.");
    const actions = document.createElement("div");
    actions.className = "json-actions";
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "action-button";
    refreshButton.textContent = "Refresh JSON";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "action-button";
    copyButton.textContent = "Copy JSON";
    actions.appendChild(refreshButton);
    actions.appendChild(copyButton);
    card.appendChild(actions);
    jsonViewElement = document.createElement("div");
    jsonViewElement.className = "json-view";
    card.appendChild(jsonViewElement);
    panel.appendChild(card);
    refreshButton.addEventListener("click", () => loadSettingsSnapshot().catch(() => setStatus("Unable to refresh JSON", true)));
    copyButton.addEventListener("click", copyJson);
  }

  async function copyJson() {
    if (!jsonViewElement) {
      return;
    }
    const text = jsonViewElement.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      setStatus("JSON copied to clipboard");
    } catch (error) {
      setStatus("Copy failed", true);
    }
  }

  async function unlockVault(passphrase: string) {
    if (!passphrase) {
      return;
    }
    try {
      const result = await bridge.unlockSecrets(passphrase);
      secretsUnlocked = result?.success === true;
      secretsStatusElement.textContent = secretsUnlocked ? "Secrets vault is unlocked" : "Secrets vault is locked";
      setStatus(secretsUnlocked ? "Secrets unlocked" : "Secrets unlock failed", !secretsUnlocked);
      updateSecretControls();
      await refreshSecretInputs();
    } catch (error) {
      setStatus("Unable to unlock secrets", true);
    }
  }

  async function attemptDefaultVaultUnlock() {
    if (secretsUnlocked) {
      return;
    }
    try {
      const result = await bridge.unlockSecrets(DEFAULT_VAULT_PASSPHRASE);
      secretsUnlocked = result?.success === true;
      if (!secretsUnlocked) {
        return;
      }
      secretsStatusElement.textContent = "Secrets vault is unlocked";
      setStatus("Secrets vault unlocked by default");
      updateSecretControls();
      await refreshSecretInputs();
    } catch {
      // ignore auto-unlock failures
    }
  }

  function updateSecretControls() {
    Object.keys(secretInputs).forEach((key) => {
      const input = secretInputs[key];
      if (!input) {
        return;
      }
      input.disabled = !secretsUnlocked;
      const toggle = secretToggles[key];
      if (toggle) {
        toggle.disabled = !secretsUnlocked;
      }
    });
    vaultHints.forEach((hint) => {
      hint.classList.toggle("hidden", secretsUnlocked);
    });
  }

  async function refreshSecretInputs() {
    if (!secretsUnlocked) {
      return;
    }
    await Promise.all(
      Object.keys(secretInputs).map(async (key) => {
        try {
          const value = await bridge.getSecret(key);
          secretInputs[key].value = value || "";
        } catch {
          secretInputs[key].value = "";
        }
        if (!secretInputs[key].value && pendingEnvSecrets[key]) {
          secretInputs[key].value = pendingEnvSecrets[key];
        }
      })
    );
  }

  async function applySettings() {
    setStatus("Saving settings...");
    try {
      for (const key of VALUE_KEYS) {
        await bridge.setValue(key, getPlainValue(key));
      }
      for (const key of CHECKBOX_KEYS) {
        await bridge.setValue(key, getCheckboxValue(key));
      }
      if (secretsUnlocked) {
        for (const key of SECRET_KEYS) {
          await bridge.setSecret(key, getSecretValue(key));
        }
      }
      await loadSettingsSnapshot();
      setStatus("Settings saved");
    } catch (error) {
      setStatus("Failed to save settings", true);
    }
  }

  window.addEventListener("settings:updated", async (event: Event) => {
    const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
    const k = detail?.key;
    if (k && ![APPEARANCE_KEYS.theme, APPEARANCE_KEYS.density, APPEARANCE_KEYS.effects, APPEARANCE_KEYS.uiScale, APPEARANCE_KEYS.accent].includes(k as string)) {
      return;
    }
    try {
      await loadSettingsSnapshot();
    } catch {
      // ignore
    }
  });

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    const themeId = normalizeTheme(latestSnapshot[APPEARANCE_KEYS.theme]);
    if (themeId !== "system") return;
    applyAppearance(latestSnapshot);
  });

  function applyInitialSection() {
    const section = readSectionFromHash();
    if (section) {
      setActiveSection(section);
    }
  }

  function readSectionFromHash(): string | null {
    const raw = window.location.hash;
    if (!raw) {
      return null;
    }
    const normalized = raw.replace(/^#/, "");
    if (!normalized.startsWith("section=")) {
      return null;
    }
    const value = normalized.slice("section=".length);
    if (!value) {
      return null;
    }
    if (!panels[value]) {
      return null;
    }
    return value;
  }

  function getPlainValue(key: string) {
    const input = fieldInputs[key];
    if (!input) {
      throw new Error(`Missing input for ${key}`);
    }
    return input.value.trim();
  }

  function getCheckboxValue(key: string) {
    const input = fieldInputs[key];
    if (!input || !(input instanceof HTMLInputElement)) {
      throw new Error(`Missing checkbox for ${key}`);
    }
    return input.checked ? "true" : "false";
  }

  function getSecretValue(key: string) {
    const input = secretInputs[key];
    if (!input) {
      throw new Error(`Missing secret input for ${key}`);
    }
    return input.value.trim();
  }

  function setStatus(message: string, isError?: boolean) {
    statusLine.textContent = message;
    statusLine.style.color = isError ? "#b91c1c" : "#6b7280";
  }
})();
