export const FEATURE_FLAG_KEYS = {
  ribbonV2: "ribbon.v2.enabled",
  panelsV2: "panels.v2.enabled"
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[keyof typeof FEATURE_FLAG_KEYS];

const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  "ribbon.v2.enabled": true,
  "panels.v2.enabled": true
};

type SettingsReader = {
  getValue: (key: string, defaultValue?: unknown) => Promise<unknown>;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function coerceBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return defaultValue;
}

export async function readFeatureFlag(
  key: FeatureFlagKey,
  options?: { settings?: SettingsReader | null; storage?: StorageLike | null }
): Promise<boolean> {
  const defaultValue = FEATURE_FLAG_DEFAULTS[key] ?? false;
  try {
    const settings = options?.settings;
    if (settings) {
      const value = await settings.getValue(key, defaultValue);
      return coerceBoolean(value, defaultValue);
    }
  } catch {
    // fall through to storage/default
  }
  try {
    const storage = options?.storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (storage) {
      const stored = storage.getItem(key);
      if (stored !== null) {
        return coerceBoolean(stored, defaultValue);
      }
    }
  } catch {
    // ignore storage errors
  }
  return defaultValue;
}

export function applyFeatureClass(html: HTMLElement, className: string, enabled: boolean): void {
  if (enabled) {
    html.classList.add(className);
  } else {
    html.classList.remove(className);
  }
}
