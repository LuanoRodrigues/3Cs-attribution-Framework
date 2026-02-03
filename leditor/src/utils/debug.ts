export const isDebugLoggingEnabled = (): boolean => {
  try {
    const g = globalThis as typeof globalThis & { __leditorDebug?: boolean };
    return g.__leditorDebug === true;
  } catch {
    return false;
  }
};

export const debugInfo = (message: string, detail?: unknown): void => {
  if (!isDebugLoggingEnabled()) return;
  if (detail !== undefined) {
    console.info(message, detail);
  } else {
    console.info(message);
  }
};

export const debugWarn = (message: string, detail?: unknown): void => {
  if (!isDebugLoggingEnabled()) return;
  if (detail !== undefined) {
    console.warn(message, detail);
  } else {
    console.warn(message);
  }
};
