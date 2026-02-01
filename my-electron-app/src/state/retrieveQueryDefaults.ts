import type { RetrieveProviderId, RetrieveSort } from "../shared/types/retrieve";

export type RetrieveQueryDefaults = {
  provider: RetrieveProviderId;
  sort: RetrieveSort;
  year_from?: number;
  year_to?: number;
  limit: number;
};

const STORAGE_KEY = "retrieve.queryDefaults";

const DEFAULTS: RetrieveQueryDefaults = {
  provider: "semantic_scholar",
  sort: "relevance",
  limit: 50
};

export function readRetrieveQueryDefaults(): RetrieveQueryDefaults {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return { ...DEFAULTS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<RetrieveQueryDefaults>;
    return {
      provider: (parsed.provider as RetrieveProviderId) ?? DEFAULTS.provider,
      sort: (parsed.sort as RetrieveSort) ?? DEFAULTS.sort,
      year_from: typeof parsed.year_from === "number" ? parsed.year_from : undefined,
      year_to: typeof parsed.year_to === "number" ? parsed.year_to : undefined,
      limit: typeof parsed.limit === "number" && parsed.limit > 0 ? parsed.limit : DEFAULTS.limit
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeRetrieveQueryDefaults(next: Partial<RetrieveQueryDefaults>): RetrieveQueryDefaults {
  const current = readRetrieveQueryDefaults();
  const merged: RetrieveQueryDefaults = {
    ...current,
    ...next
  };
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }
  document.dispatchEvent(new CustomEvent("retrieve:query-defaults-updated", { detail: { defaults: merged } }));
  return merged;
}
