type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const isPlainObject = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stableReplacer = (value: JsonValue, seen: WeakSet<object>): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((entry) => stableReplacer(entry, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return "[Circular]" as unknown as JsonValue;
    seen.add(value);
    const keys = Object.keys(value).sort();
    const out: Record<string, JsonValue> = {};
    for (const key of keys) {
      out[key] = stableReplacer(value[key], seen);
    }
    return out;
  }
  return value;
};

export const stableStringify = (value: JsonValue): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(stableReplacer(value, seen));
};

export const hashSignature = (input: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
