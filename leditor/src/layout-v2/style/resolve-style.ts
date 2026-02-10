import type { StyleKey } from "../types.ts";
import { createDefaultComputedStyle, type ComputedStyle } from "./computed-style.ts";

export type StyleResolver = {
  resolve(key: StyleKey): ComputedStyle;
};

export const createStyleResolver = (registry?: Record<string, Partial<ComputedStyle>>): StyleResolver => {
  const cache = new Map<StyleKey, ComputedStyle>();
  return {
    resolve: (key: StyleKey): ComputedStyle => {
      if (cache.has(key)) return cache.get(key)!;
      const base = createDefaultComputedStyle();
      const resolved = { ...base, ...(registry?.[key] ?? {}) } satisfies ComputedStyle;
      cache.set(key, resolved);
      return resolved;
    }
  };
};
