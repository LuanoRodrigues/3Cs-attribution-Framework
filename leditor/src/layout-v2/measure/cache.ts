import type { FontKey } from "./font-key.ts";

export type TextMeasureCacheKey = `${FontKey}:${string}`;

export class TextMeasureCache {
  private widths = new Map<TextMeasureCacheKey, number>();

  get(key: TextMeasureCacheKey): number | undefined {
    return this.widths.get(key);
  }

  set(key: TextMeasureCacheKey, width: number): void {
    this.widths.set(key, width);
  }
}
