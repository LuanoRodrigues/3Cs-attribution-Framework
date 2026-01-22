export type Density = "comfortable" | "compact";
export type Effects = "full" | "performance";

type DensityVars = Record<string, string>;

const densityPresets: Record<Density, DensityVars> = {
  comfortable: {
    "--workspace-gap": "16px",
    "--panel-radius": "20px",
    "--card-radius": "18px",
    "--control-height": "44px",
    "--control-padding-x": "14px",
    "--control-padding-y": "12px",
    "--chip-gap": "10px"
  },
  compact: {
    "--workspace-gap": "10px",
    "--panel-radius": "14px",
    "--card-radius": "12px",
    "--control-height": "38px",
    "--control-padding-x": "10px",
    "--control-padding-y": "9px",
    "--chip-gap": "8px"
  }
};

const effectsPresets: Record<Effects, DensityVars> = {
  full: {
    "--shadow-level-1": "0 20px 48px rgba(0, 0, 0, 0.35)",
    "--shadow-level-2": "0 30px 80px rgba(0, 0, 0, 0.5)",
    "--blur-soft": "12px",
    "--blur-strong": "24px",
    "--glow-strength": "1"
  },
  performance: {
    "--shadow-level-1": "0 10px 20px rgba(0, 0, 0, 0.2)",
    "--shadow-level-2": "0 18px 38px rgba(0, 0, 0, 0.3)",
    "--blur-soft": "6px",
    "--blur-strong": "10px",
    "--glow-strength": "0.6"
  }
};

export function resolveDensityTokens(density: Density, effects: Effects): DensityVars {
  return {
    ...densityPresets[density],
    ...effectsPresets[effects]
  };
}
