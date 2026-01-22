import type { SettingsBridge } from "./global";

function requireBridge(): SettingsBridge {
  const bridge = window.settingsBridge;
  if (!bridge) {
    throw new Error("Settings bridge is unavailable.");
  }
  return bridge;
}

export const settingsClient = {
  getValue: (key: string, defaultValue?: unknown) => requireBridge().getValue(key, defaultValue),
  setValue: (key: string, value: unknown) => requireBridge().setValue(key, value),
  getAll: () => requireBridge().getAll(),
  unlockSecrets: (passphrase: string) => requireBridge().unlockSecrets(passphrase),
  getSecret: (name: string) => requireBridge().getSecret(name),
  setSecret: (name: string, value: string) => requireBridge().setSecret(name, value),
  getPaths: () => requireBridge().getPaths(),
  exportBundle: (zipPath: string, includeSecrets?: boolean) => requireBridge().exportBundle(zipPath, includeSecrets),
  importBundle: (zipPath: string) => requireBridge().importBundle(zipPath)
};
