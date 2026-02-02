export const ribbonDebugEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return (window as typeof window & { __leditorRibbonDebug?: boolean }).__leditorRibbonDebug === true;
  } catch {
    return false;
  }
};

export const ribbonDebugLog = (message: string, detail?: Record<string, unknown>): void => {
  if (!ribbonDebugEnabled()) return;
  if (detail) {
    console.info(`[RibbonDebug] ${message}`, detail);
    return;
  }
  console.info(`[RibbonDebug] ${message}`);
};

export const ribbonDebugTrace = (message: string, detail?: Record<string, unknown>): void => {
  if (!ribbonDebugEnabled()) return;
  if (detail) {
    console.trace(`[RibbonDebug] ${message}`, detail);
    return;
  }
  console.trace(`[RibbonDebug] ${message}`);
};

export const ribbonDebugEvent = (type: string, detail?: Record<string, unknown>): void => {
  if (!ribbonDebugEnabled()) return;
  try {
    console.info(`[RibbonDebug][event] ${type}`, detail ?? {});
  } catch {
    // avoid throwing inside logger
  }
};

export const ribbonDebugMutation = (label: string, detail?: Record<string, unknown>): void => {
  if (!ribbonDebugEnabled()) return;
  try {
    console.info(`[RibbonDebug][mutation] ${label}`, detail ?? {});
  } catch {
    // avoid throwing inside logger
  }
};

export const ribbonDebugTabFilter = (): string | "all" | null => {
  if (typeof window === "undefined") return null;
  try {
    const tab = (window as typeof window & { __leditorRibbonDebugTab?: string }).__leditorRibbonDebugTab;
    if (!tab) return null;
    if (tab.toLowerCase() === "all") return "all";
    return tab.toLowerCase();
  } catch {
    return null;
  }
};

export const ribbonDebugVerbose = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return (window as typeof window & { __leditorRibbonDebugVerbose?: boolean }).__leditorRibbonDebugVerbose === true;
  } catch {
    return false;
  }
};
