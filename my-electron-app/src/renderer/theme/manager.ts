import { APPEARANCE_KEYS } from "../../config/settingsKeys";
import { settingsClient } from "../settingsClient";
import { resolveDensityTokens } from "./density";
import { resolveThemeTokens, themeIds, type ThemeId } from "./tokens";

type SettingsSnapshot = Record<string, unknown>;

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.includes(value as ThemeId);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim());
}

function normalizeTheme(theme: unknown): ThemeId {
  if (isThemeId(theme)) return theme;
  if (typeof theme === "string" && themeIds.includes(theme.toLowerCase() as ThemeId)) {
    return theme.toLowerCase() as ThemeId;
  }
  return "system";
}

function normalizeDensity(value: unknown): "comfortable" | "compact" {
  return value === "compact" ? "compact" : "comfortable";
}

function normalizeEffects(value: unknown): "full" | "performance" {
  return value === "performance" ? "performance" : "full";
}

function normalizeScale(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(1.4, Math.max(0.8, parsed));
}

function getSystemPreference(): "dark" | "light" {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyCssVars(vars: Record<string, string>): void {
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

function buildThemeCss(
  themeId: ThemeId,
  snapshot: SettingsSnapshot
): { vars: Record<string, string>; resolvedTheme: ThemeId } {
  const systemPref = getSystemPreference();
  const base = resolveThemeTokens(themeId, systemPref);
  const accentOverride = isHexColor(snapshot[APPEARANCE_KEYS.accent]) ? String(snapshot[APPEARANCE_KEYS.accent]) : null;
  const accent = accentOverride ?? base.accent;

  const vars: Record<string, string> = {
    "--bg": base.bg,
    "--panel": base.panel,
    "--panel-2": base.panel2,
    "--surface": base.surface,
    "--surface-muted": base.surfaceMuted,
    "--text": base.text,
    "--muted": base.muted,
    "--border": base.border,
    "--border-soft": base.borderSoft,
    "--accent": accent,
    "--accent-2": base.accent2,
    "--card-border": base.cardBorder,
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
    "--danger": "#f87171",
    "--success": "#34d399"
  };

  return { vars, resolvedTheme: themeId === "system" ? (systemPref === "dark" ? "dark" : "light") : themeId };
}

function buildDensityCss(snapshot: SettingsSnapshot): Record<string, string> {
  const density = normalizeDensity(snapshot[APPEARANCE_KEYS.density]);
  const effects = normalizeEffects(snapshot[APPEARANCE_KEYS.effects]);
  return resolveDensityTokens(density, effects);
}

async function loadSettingsSnapshot(): Promise<SettingsSnapshot> {
  try {
    return await settingsClient.getAll();
  } catch (err) {
    console.error("[theme] failed to load settings", err);
    return {};
  }
}

async function applyFromSettings(snapshot: SettingsSnapshot): Promise<void> {
  const themeId = normalizeTheme(snapshot[APPEARANCE_KEYS.theme]);
  const themeCss = buildThemeCss(themeId, snapshot);
  const densityCss = buildDensityCss(snapshot);
  const scale = normalizeScale(snapshot[APPEARANCE_KEYS.uiScale]);
  applyCssVars({ ...themeCss.vars, ...densityCss, "--app-scale": String(scale) });
  document.documentElement.dataset.theme = themeCss.resolvedTheme;
  document.documentElement.dataset.density = normalizeDensity(snapshot[APPEARANCE_KEYS.density]);
  document.documentElement.dataset.effects = normalizeEffects(snapshot[APPEARANCE_KEYS.effects]);
  const leditorMode = themeCss.resolvedTheme === "light" ? "light" : "dark";
  document.dispatchEvent(
    new CustomEvent("leditor:theme-change", { detail: { mode: leditorMode, surface: leditorMode } })
  );
}

export async function initThemeManager(): Promise<void> {
  const initial = await loadSettingsSnapshot();
  await applyFromSettings(initial);

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const systemListener = () => {
    const snapshot = { ...initial, [APPEARANCE_KEYS.theme]: initial[APPEARANCE_KEYS.theme] ?? "system" };
    void applyFromSettings(snapshot);
  };
  media.addEventListener("change", systemListener);

  window.addEventListener("settings:updated", async (event: Event) => {
    const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
    const k = detail?.key;
    if (k && k !== "appearance" && !Object.values(APPEARANCE_KEYS).includes(k as any)) {
      return;
    }
    const fresh = await loadSettingsSnapshot();
    await applyFromSettings(fresh);
  });
}
