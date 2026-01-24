export type Density = "comfortable" | "compact";
export type Effects = "full" | "performance";

type DensityVars = Record<string, string>;

/**
 * Density controls spatial rhythm and perceived softness.
 * Comfortable = modern, airy, editorial.
 * Compact = information-dense, IDE / power-user friendly.
 */
const densityPresets: Record<Density, DensityVars> = {
  comfortable: {
    // Global layout
    "--workspace-gap": "16px",
    "--section-gap": "20px",

    // Corners
    "--panel-radius": "18px",
    "--card-radius": "16px",
    "--control-radius": "12px",
    "--chip-radius": "999px",

    // Controls
    "--control-height": "44px",
    "--control-padding-x": "14px",
    "--control-padding-y": "12px",

    // Lists / inline elements
    "--item-gap": "12px",
    "--chip-gap": "10px",

    // Typography rhythm helpers
    "--line-height-tight": "1.2",
    "--line-height-normal": "1.45",
    "--line-height-loose": "1.65"
  },

  compact: {
    // Global layout
    "--workspace-gap": "10px",
    "--section-gap": "14px",

    // Corners (sharper, IDE-like)
    "--panel-radius": "12px",
    "--card-radius": "10px",
    "--control-radius": "8px",
    "--chip-radius": "999px",

    // Controls
    "--control-height": "36px",
    "--control-padding-x": "10px",
    "--control-padding-y": "8px",

    // Lists / inline elements
    "--item-gap": "8px",
    "--chip-gap": "8px",

    // Typography rhythm helpers
    "--line-height-tight": "1.15",
    "--line-height-normal": "1.4",
    "--line-height-loose": "1.6"
  }
};

/**
 * Effects control visual richness vs performance.
 * Full = modern ambient depth + blur (Mac / high-end feel).
 * Performance = flatter, faster, still intentional.
 */
const effectsPresets: Record<Effects, DensityVars> = {
  full: {
    // Shadows (ambient-first, not heavy drop shadows)
    "--shadow-ambient": "0 8px 24px rgba(0, 0, 0, 0.18)",
    "--shadow-elevated": "0 20px 48px rgba(0, 0, 0, 0.32)",
    "--shadow-overlay": "0 30px 80px rgba(0, 0, 0, 0.45)",

    // Focus / interaction
    "--focus-ring-width": "3px",
    "--focus-ring-offset": "2px",

    // Blur & glow
    "--blur-soft": "10px",
    "--blur-strong": "20px",
    "--glow-strength": "1",

    // Motion timing helpers (used by UI, not animations themselves)
    "--motion-fast": "120ms",
    "--motion-medium": "200ms",
    "--motion-slow": "320ms"
  },

  performance: {
    // Shadows simplified and cheaper to render
    "--shadow-ambient": "0 4px 12px rgba(0, 0, 0, 0.16)",
    "--shadow-elevated": "0 10px 24px rgba(0, 0, 0, 0.24)",
    "--shadow-overlay": "0 16px 36px rgba(0, 0, 0, 0.32)",

    // Focus / interaction
    "--focus-ring-width": "2px",
    "--focus-ring-offset": "2px",

    // Reduced blur
    "--blur-soft": "4px",
    "--blur-strong": "8px",
    "--glow-strength": "0.6",

    // Motion timing helpers
    "--motion-fast": "100ms",
    "--motion-medium": "160ms",
    "--motion-slow": "240ms"
  }
};

export function resolveDensityTokens(
  density: Density,
  effects: Effects
): DensityVars {
  return {
    ...densityPresets[density],
    ...effectsPresets[effects]
  };
}
