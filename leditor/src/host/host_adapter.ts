export type HostAdapter = NonNullable<Window["leditorHost"]>;

let overriddenAdapter: HostAdapter | null | undefined = undefined;

const LLM_LOG_LIMIT = 200;

const recordLlmRequest = (entry: Record<string, unknown>) => {
  try {
    const g = window as any;
    if (!Array.isArray(g.__leditorLlmRequests)) {
      g.__leditorLlmRequests = [];
    }
    g.__leditorLlmRequests.push(entry);
    if (g.__leditorLlmRequests.length > LLM_LOG_LIMIT) {
      g.__leditorLlmRequests.splice(0, g.__leditorLlmRequests.length - LLM_LOG_LIMIT);
    }
  } catch {
    // ignore
  }
};

const extractLlmText = (payload: any): string => {
  if (!payload || typeof payload !== "object") return "";
  const selection = payload.selection?.text;
  const document = payload.document?.text;
  if (typeof selection === "string") return selection;
  if (typeof document === "string") return document;
  if (payload.documentJson) {
    try {
      return JSON.stringify(payload.documentJson).slice(0, 2000);
    } catch {
      return "";
    }
  }
  return "";
};

const looksSensitive = (text: string): boolean => {
  if (!text) return false;
  const patterns = [
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
    /\b(?:\d[ -]*?){13,16}\b/, // credit card-ish
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // email
    /\b\d{9}\b/, // generic 9-digit id
    /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(\d{2,3}\)|\d{2,3})[-.\s]?\d{3}[-.\s]?\d{4}\b/ // phone
  ];
  return patterns.some((pattern) => pattern.test(text));
};

const LLM_FUNCTIONS: Array<keyof HostAdapter> = [
  "agentRequest",
  "agentRun",
  "lexicon",
  "checkSources",
  "substantiateAnchors"
];

const wrappedAdapters = new WeakMap<HostAdapter, HostAdapter>();
const llmWrapperCache = new WeakMap<HostAdapter, Map<keyof HostAdapter, (...args: any[]) => Promise<any>>>();
const boundFnCache = new WeakMap<HostAdapter, Map<PropertyKey, any>>();

const buildLlmWrapper = (adapter: HostAdapter, name: keyof HostAdapter) => {
  const original = adapter[name];
  if (typeof original !== "function") return null;
  const bound = (original as any).bind(adapter);
  return async (...args: any[]) => {
    const request = args[0];
    const payload = request?.payload ?? null;
    const instruction = typeof payload?.instruction === "string" ? payload.instruction : "";
    const scope = typeof payload?.scope === "string" ? payload.scope : undefined;
    const text = extractLlmText(payload);
    const sensitive = looksSensitive(`${instruction}\n${text}`);
    recordLlmRequest({
      ts: new Date().toISOString(),
      kind: String(name),
      requestId: request?.requestId ?? null,
      scope,
      instructionLength: instruction.length,
      textLength: text.length,
      sensitive
    });
    if (sensitive) {
      try {
        const guard = (window as any).__leditorSensitiveGuard;
        if (guard === "block") {
          return { success: false, error: "Sensitive content blocked by policy." };
        }
        if (guard === "confirm") {
          const ok = window.confirm("Sensitive content detected in AI request. Continue?");
          if (!ok) {
            return { success: false, error: "Sensitive content cancelled." };
          }
        }
      } catch {
        // ignore
      }
    }
    return bound(...args);
  };
};

const getOrCreateLlmWrapper = (adapter: HostAdapter, name: keyof HostAdapter) => {
  let cache = llmWrapperCache.get(adapter);
  if (!cache) {
    cache = new Map();
    llmWrapperCache.set(adapter, cache);
  }
  const existing = cache.get(name);
  if (existing) return existing;
  const wrapped = buildLlmWrapper(adapter, name);
  if (wrapped) {
    cache.set(name, wrapped);
    return wrapped;
  }
  return adapter[name];
};

const getOrBindFunction = (adapter: HostAdapter, prop: PropertyKey, value: any) => {
  let cache = boundFnCache.get(adapter);
  if (!cache) {
    cache = new Map();
    boundFnCache.set(adapter, cache);
  }
  if (cache.has(prop)) return cache.get(prop);
  const bound = value.bind(adapter);
  cache.set(prop, bound);
  return bound;
};

const wrapHostAdapter = (adapter: HostAdapter | null): HostAdapter | null => {
  if (!adapter) return adapter;
  const cached = wrappedAdapters.get(adapter);
  if (cached) return cached;
  const proxy = new Proxy(adapter, {
    get(target, prop, receiver) {
      const descriptor = Object.getOwnPropertyDescriptor(target, prop);
      if (descriptor && descriptor.configurable === false) {
        if ("value" in descriptor && descriptor.writable === false) {
          return descriptor.value;
        }
        return Reflect.get(target, prop, receiver);
      }
      if (LLM_FUNCTIONS.includes(prop as keyof HostAdapter)) {
        return getOrCreateLlmWrapper(target, prop as keyof HostAdapter);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return getOrBindFunction(target, prop, value);
      }
      return value;
    }
  }) as HostAdapter;
  wrappedAdapters.set(adapter, proxy);
  wrappedAdapters.set(proxy, proxy);
  return proxy;
};

export const setHostAdapter = (adapter: HostAdapter | null) => {
  overriddenAdapter = wrapHostAdapter(adapter);
};

export const getHostAdapter = (): HostAdapter | null => {
  if (overriddenAdapter !== undefined) {
    return overriddenAdapter;
  }
  const adapter = wrapHostAdapter(window.leditorHost ?? null);
  overriddenAdapter = adapter;
  return adapter;
};
