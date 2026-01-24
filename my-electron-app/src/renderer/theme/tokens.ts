export type ThemeId =
  | "system"
  | "dark"
  | "light"
  | "high-contrast"
  | "colorful"
  | "warm"
  | "cold";

export type ThemeTokens = {
  name: string;

  // Core surfaces
  bg: string;
  panel: string;
  panel2: string;
  surface: string;
  surfaceMuted: string;

  // Typography
  text: string;
  muted: string;

  // Lines
  border: string;
  borderSoft: string;
  cardBorder: string;

  // Brand / emphasis
  accent: string;
  accent2: string;

  // Effects
  shadow: string;
  gradient1: string;
  gradient2: string;
  ribbon: string;
  focus: string;

  // Full-spectrum palette (harmonized per theme)
  red: string;
  orange: string;
  yellow: string;
  green: string;
  cyan: string;
  blue: string;
  purple: string;

  // Optional helpers for common UI semantics
  danger: string;
  warning: string;
  success: string;
  info: string;
};

type NonSystemThemeId = Exclude<ThemeId, "system">;

/**
 * Design intent:
 * - Each theme defines a stable neutral foundation + a primary accent family.
 * - Each theme also defines a *harmonized spectrum* (red/orange/yellow/green/cyan/blue/purple)
 *   so components can use rich colors (status, charts, code highlighting) without breaking harmony.
 *
 * Notes:
 * - "dark" targets a PyCharm/OpenAI-like experience: deep background + vivid, readable colors.
 * - "light" is paper-like and calm, but keeps strong chroma available for UI states.
 * - "cold" and "warm" keep mood through neutrals, while spectrum stays coherent and usable.
 * - "high-contrast" remains accessibility-first; spectrum is intense and unambiguous.
 */
const themes: Record<NonSystemThemeId, ThemeTokens> = {
  dark: {
    name: "Dark",

    // Deep ink base (not pure black). A touch of cool undertone for modern “editor dark”.
    bg: "#0b0f14",
    panel: "#0f141b",
    panel2: "#151c26",
    surface: "rgba(17, 24, 39, 0.88)",
    surfaceMuted: "rgba(22, 30, 46, 0.78)",

    text: "#e8eef5",
    muted: "#a8b3c3",

    border: "rgba(226, 232, 240, 0.14)",
    borderSoft: "rgba(226, 232, 240, 0.08)",
    cardBorder: "rgba(16, 163, 127, 0.30)",

    // OpenAI-ish teal family
    accent: "#10a37f",
    accent2: "#22c55e",

    shadow: "0 24px 72px rgba(0, 0, 0, 0.70)",
    gradient1: "rgba(16, 163, 127, 0.22)",
    gradient2: "rgba(59, 130, 246, 0.18)",
    ribbon: "rgba(13, 18, 26, 0.92)",
    focus: "rgba(16, 163, 127, 0.42)",

    // Rich editor-like spectrum (balanced against bg)
    red: "#ff5c7a",
    orange: "#ff9a3c",
    yellow: "#ffd166",
    green: "#2ee59d",
    cyan: "#2dd4bf",
    blue: "#60a5fa",
    purple: "#a78bfa",

    danger: "#ff5c7a",
    warning: "#ffd166",
    success: "#2ee59d",
    info: "#60a5fa"
  },

  light: {
    name: "Light",

    // Soft “document” base; avoids harsh #fff everywhere.
    bg: "#f6f7fb",
    panel: "#fbfcff",
    panel2: "#f1f4fa",
    surface: "rgba(255, 255, 255, 0.92)",
    surfaceMuted: "rgba(243, 246, 252, 0.92)",

    text: "#111827",
    muted: "#4b5563",

    border: "rgba(17, 24, 39, 0.12)",
    borderSoft: "rgba(17, 24, 39, 0.08)",
    cardBorder: "rgba(37, 99, 235, 0.18)",

    // Calm blue family (professional, not “neon primary”)
    accent: "#2563eb",
    accent2: "#0f56b3",

    shadow: "0 18px 60px rgba(15, 23, 42, 0.12)",
    gradient1: "rgba(37, 99, 235, 0.14)",
    gradient2: "rgba(99, 102, 241, 0.12)",
    ribbon: "rgba(241, 244, 250, 0.96)",
    focus: "rgba(37, 99, 235, 0.26)",

    // Spectrum tuned to read on light surfaces without looking childish
    red: "#dc2626",
    orange: "#ea580c",
    yellow: "#ca8a04",
    green: "#16a34a",
    cyan: "#0f766e",
    blue: "#2563eb",
    purple: "#7c3aed",

    danger: "#dc2626",
    warning: "#ca8a04",
    success: "#16a34a",
    info: "#2563eb"
  },

  "high-contrast": {
    name: "High contrast",

    bg: "#070707",
    panel: "#0b0b0b",
    panel2: "#101010",
    surface: "#0d0d0d",
    surfaceMuted: "#121212",

    text: "#ffffff",
    muted: "#e5e7eb",

    border: "#ffffff",
    borderSoft: "rgba(255, 255, 255, 0.85)",
    cardBorder: "#ffffff",

    accent: "#ffd400",
    accent2: "#ff8a00",

    shadow: "0 0 0 2px #ffffff",
    gradient1: "rgba(255, 255, 255, 0.10)",
    gradient2: "rgba(255, 212, 0, 0.14)",
    ribbon: "#0b0b0b",
    focus: "rgba(255, 212, 0, 0.82)",

    // Intense, unambiguous spectrum (AA/AAA intent)
    red: "#ff2e2e",
    orange: "#ff8a00",
    yellow: "#ffd400",
    green: "#00ff84",
    cyan: "#00e5ff",
    blue: "#3b82f6",
    purple: "#b26bff",

    danger: "#ff2e2e",
    warning: "#ffd400",
    success: "#00ff84",
    info: "#00e5ff"
  },

  colorful: {
    name: "Colorful",

    bg: "#0b1020",
    panel: "#0f1630",
    panel2: "#131d3a",
    surface: "rgba(15, 22, 48, 0.88)",
    surfaceMuted: "rgba(18, 28, 60, 0.78)",

    text: "#f1f5ff",
    muted: "#c7d2fe",

    border: "rgba(167, 139, 250, 0.28)",
    borderSoft: "rgba(94, 234, 212, 0.18)",
    cardBorder: "rgba(45, 212, 191, 0.34)",

    accent: "#8b5cf6",
    accent2: "#2dd4bf",

    shadow: "0 24px 72px rgba(3, 6, 22, 0.80)",
    gradient1: "rgba(139, 92, 246, 0.30)",
    gradient2: "rgba(45, 212, 191, 0.24)",
    ribbon: "rgba(15, 29, 58, 0.92)",
    focus: "rgba(45, 212, 191, 0.44)",

    // High-chroma spectrum, still usable on dark slate base
    red: "#ff4d6d",
    orange: "#ff9f1c",
    yellow: "#ffe066",
    green: "#2ee59d",
    cyan: "#2dd4bf",
    blue: "#60a5fa",
    purple: "#a78bfa",

    danger: "#ff4d6d",
    warning: "#ffe066",
    success: "#2ee59d",
    info: "#60a5fa"
  },

  warm: {
    name: "Warm",

    bg: "#120a07",
    panel: "#1a100c",
    panel2: "#241611",
    surface: "rgba(34, 20, 14, 0.90)",
    surfaceMuted: "rgba(43, 26, 18, 0.82)",

    text: "#fff2d6",
    muted: "#f1c79b",

    border: "rgba(251, 146, 60, 0.34)",
    borderSoft: "rgba(251, 146, 60, 0.18)",
    cardBorder: "rgba(251, 146, 60, 0.32)",

    accent: "#fb923c",
    accent2: "#f59e0b",

    shadow: "0 24px 72px rgba(16, 8, 5, 0.82)",
    gradient1: "rgba(251, 146, 60, 0.20)",
    gradient2: "rgba(244, 63, 94, 0.16)",
    ribbon: "rgba(26, 16, 12, 0.92)",
    focus: "rgba(251, 146, 60, 0.42)",

    // Warm spectrum: reds/oranges strong; cool colors slightly softened to fit mood
    red: "#ff4d5d",
    orange: "#fb923c",
    yellow: "#fbbf24",
    green: "#34d399",
    cyan: "#22d3ee",
    blue: "#60a5fa",
    purple: "#c4b5fd",

    danger: "#ff4d5d",
    warning: "#fbbf24",
    success: "#34d399",
    info: "#60a5fa"
  },

  cold: {
    name: "Cold",

    bg: "#07101c",
    panel: "#0b1727",
    panel2: "#102036",
    surface: "rgba(11, 23, 39, 0.88)",
    surfaceMuted: "rgba(12, 31, 50, 0.80)",

    text: "#eaf3ff",
    muted: "#b7cbe2",

    border: "rgba(96, 165, 250, 0.30)",
    borderSoft: "rgba(56, 189, 248, 0.18)",
    cardBorder: "rgba(56, 189, 248, 0.28)",

    accent: "#38bdf8",
    accent2: "#0ea5e9",

    shadow: "0 24px 72px rgba(3, 10, 22, 0.86)",
    gradient1: "rgba(56, 189, 248, 0.24)",
    gradient2: "rgba(59, 130, 246, 0.18)",
    ribbon: "rgba(11, 23, 39, 0.92)",
    focus: "rgba(56, 189, 248, 0.42)",

    // Cold spectrum: blues/cyans strong; warm hues slightly cooled but still rich
    red: "#ff5c7a",
    orange: "#ff9a3c",
    yellow: "#ffd166",
    green: "#2ee59d",
    cyan: "#38bdf8",
    blue: "#3b82f6",
    purple: "#a78bfa",

    danger: "#ff5c7a",
    warning: "#ffd166",
    success: "#2ee59d",
    info: "#38bdf8"
  }
};

export function resolveThemeTokens(
  themeId: ThemeId,
  systemPreference: "dark" | "light" = "light"
): ThemeTokens {
  const effective: NonSystemThemeId =
    themeId === "system"
      ? systemPreference === "dark"
        ? "dark"
        : "light"
      : (themeId as NonSystemThemeId);

  return themes[effective];
}

export const themeIds: ThemeId[] = [
  "system",
  "dark",
  "light",
  "high-contrast",
  "colorful",
  "warm",
  "cold"
];
