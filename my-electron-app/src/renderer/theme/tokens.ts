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
  bg: string;
  panel: string;
  panel2: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  muted: string;
  border: string;
  borderSoft: string;
  accent: string;
  accent2: string;
  cardBorder: string;
  shadow: string;
  gradient1: string;
  gradient2: string;
  ribbon: string;
  focus: string;
};

type NonSystemThemeId = Exclude<ThemeId, "system">;

/**
 * Notes on the palettes:
 * - "light" is a softer “document/Word-like” neutral with gentle blue-gray separation (not pure white).
 * - "dark" is a deeper charcoal/ink base with OpenAI-ish teal/green accents (not pure black).
 * - "colorful" draws from UI-friendly purple/teal with slate neutrals (Radix-style scales).
 * - "high-contrast" keeps WCAG intent but avoids flat “all #000 / #fff” by introducing near-black steps.
 * - "warm" and "cold" keep their mood but add more steps between bg/panels/surfaces + richer borders/gradients.
 */
const themes: Record<NonSystemThemeId, ThemeTokens> = {
  dark: {
    name: "Dark",
    // Deep charcoal/ink with subtle green-cyan undertone (less flat than pure black)
    bg: "#0b0f14",
    panel: "#0f141b",
    panel2: "#151c26",
    surface: "rgba(17, 24, 39, 0.88)",
    surfaceMuted: "rgba(22, 30, 46, 0.78)",
    text: "#e8eef5",
    muted: "#a8b3c3",
    border: "rgba(226, 232, 240, 0.14)",
    borderSoft: "rgba(226, 232, 240, 0.08)",
    // OpenAI-ish teal/green accents
    accent: "#10a37f",
    accent2: "#22c55e",
    cardBorder: "rgba(16, 163, 127, 0.30)",
    shadow: "0 28px 80px rgba(0, 0, 0, 0.70)",
    gradient1: "rgba(16, 163, 127, 0.22)",
    gradient2: "rgba(59, 130, 246, 0.18)",
    ribbon: "rgba(13, 18, 26, 0.92)",
    focus: "rgba(16, 163, 127, 0.42)"
  },

  light: {
    name: "Light",
    // Soft paper-like base (not pure white) with subtle cool separation
    bg: "#f6f7fb",
    panel: "#fbfcff",
    panel2: "#f1f4fa",
    surface: "rgba(255, 255, 255, 0.92)",
    surfaceMuted: "rgba(243, 246, 252, 0.92)",
    text: "#111827",
    muted: "#4b5563",
    border: "rgba(17, 24, 39, 0.12)",
    borderSoft: "rgba(17, 24, 39, 0.08)",
    // Office-like blue accent family (less “primary-blue only”, more nuanced)
    accent: "#2563eb",
    accent2: "#0f56b3",
    cardBorder: "rgba(37, 99, 235, 0.18)",
    shadow: "0 18px 60px rgba(15, 23, 42, 0.12)",
    gradient1: "rgba(37, 99, 235, 0.14)",
    gradient2: "rgba(99, 102, 241, 0.12)",
    ribbon: "rgba(241, 244, 250, 0.96)",
    focus: "rgba(37, 99, 235, 0.26)"
  },

  "high-contrast": {
    name: "High contrast",
    // Still very high contrast, but with stepped near-black surfaces for depth
    bg: "#070707",
    panel: "#0b0b0b",
    panel2: "#101010",
    surface: "#0d0d0d",
    surfaceMuted: "#121212",
    text: "#ffffff",
    muted: "#e5e7eb",
    // Keep borders extremely clear
    border: "#ffffff",
    borderSoft: "rgba(255, 255, 255, 0.85)",
    // Strong yellow/orange for attention and focus
    accent: "#ffd400",
    accent2: "#ff8a00",
    cardBorder: "#ffffff",
    shadow: "0 0 0 2px #ffffff",
    gradient1: "rgba(255, 255, 255, 0.10)",
    gradient2: "rgba(255, 212, 0, 0.14)",
    ribbon: "#0b0b0b",
    focus: "rgba(255, 212, 0, 0.82)"
  },

  colorful: {
    name: "Colorful",
    // Slate/ink base with richer chroma separation
    bg: "#0b1020",
    panel: "#0f1630",
    panel2: "#131d3a",
    surface: "rgba(15, 22, 48, 0.88)",
    surfaceMuted: "rgba(18, 28, 60, 0.78)",
    text: "#f1f5ff",
    muted: "#c7d2fe",
    border: "rgba(167, 139, 250, 0.28)",
    borderSoft: "rgba(94, 234, 212, 0.18)",
    // Purple + teal combo (UI-friendly + vivid)
    accent: "#8b5cf6",
    accent2: "#2dd4bf",
    cardBorder: "rgba(45, 212, 191, 0.34)",
    shadow: "0 26px 70px rgba(3, 6, 22, 0.80)",
    gradient1: "rgba(139, 92, 246, 0.30)",
    gradient2: "rgba(45, 212, 191, 0.24)",
    ribbon: "rgba(15, 29, 58, 0.92)",
    focus: "rgba(45, 212, 191, 0.44)"
  },

  warm: {
    name: "Warm",
    // Deep cocoa base with amber highlights and more mid-tones
    bg: "#120a07",
    panel: "#1a100c",
    panel2: "#241611",
    surface: "rgba(34, 20, 14, 0.90)",
    surfaceMuted: "rgba(43, 26, 18, 0.82)",
    text: "#fff2d6",
    muted: "#f1c79b",
    border: "rgba(251, 146, 60, 0.34)",
    borderSoft: "rgba(251, 146, 60, 0.18)",
    accent: "#fb923c",
    accent2: "#f59e0b",
    cardBorder: "rgba(251, 146, 60, 0.32)",
    shadow: "0 26px 70px rgba(16, 8, 5, 0.82)",
    gradient1: "rgba(251, 146, 60, 0.20)",
    gradient2: "rgba(244, 63, 94, 0.16)",
    ribbon: "rgba(26, 16, 12, 0.92)",
    focus: "rgba(251, 146, 60, 0.42)"
  },

  cold: {
    name: "Cold",
    // Deeper navy with icy separation and improved mid-tone steps
    bg: "#07101c",
    panel: "#0b1727",
    panel2: "#102036",
    surface: "rgba(11, 23, 39, 0.88)",
    surfaceMuted: "rgba(12, 31, 50, 0.80)",
    text: "#eaf3ff",
    muted: "#b7cbe2",
    border: "rgba(96, 165, 250, 0.30)",
    borderSoft: "rgba(56, 189, 248, 0.18)",
    accent: "#38bdf8",
    accent2: "#0ea5e9",
    cardBorder: "rgba(56, 189, 248, 0.28)",
    shadow: "0 26px 70px rgba(3, 10, 22, 0.86)",
    gradient1: "rgba(56, 189, 248, 0.24)",
    gradient2: "rgba(59, 130, 246, 0.18)",
    ribbon: "rgba(11, 23, 39, 0.92)",
    focus: "rgba(56, 189, 248, 0.42)"
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
