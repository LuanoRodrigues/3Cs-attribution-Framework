import { ANALYSE_COLLECTION_KEY, DEFAULT_COLLECTION_NAME } from "./constants";

export function getDefaultCoderScope(): string {
  try {
    const stored = window.localStorage.getItem(ANALYSE_COLLECTION_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch {
    // ignore storage failures
  }
  return DEFAULT_COLLECTION_NAME;
}
