import path from "path";

import { SettingsStore } from "../storage/settingsStore";
import { CONFIG_DIR_NAME, getConfigDir } from "../session/sessionPaths";
import { hydrateSettings, validateSettingValue } from "./settingsSchema";
import { applyMigrations, SETTINGS_VERSION_KEY } from "./settingsMigrations";

let store: SettingsStore | null = null;
let appDataPath: string | null = null;
let configDir: string | null = null;
let migrationsApplied = false;

function requireStore(): SettingsStore {
  if (!store) {
    throw new Error("SettingsFacade has not been initialized.");
  }
  return store;
}

export function initializeSettingsFacade(userDataPath: string): void {
  // userDataPath is still accepted for compatibility, but we centralise to getConfigDir()
  appDataPath = userDataPath;
  configDir = path.join(userDataPath, CONFIG_DIR_NAME);
  store = new SettingsStore(configDir);
}

export function getAppDataPath(): string {
  if (!appDataPath) {
    throw new Error("SettingsFacade has not been initialized.");
  }
  return appDataPath;
}

export function getConfigDirectory(): string {
  return configDir ?? getConfigDir();
}

export function getSetting<T = unknown>(key: string, defaultValue?: T): T | undefined {
  ensureSettingsVersion();
  const raw = requireStore().getValue<T>(key, defaultValue);
  return validateSettingValue(key, raw) as T;
}

export function setSetting(key: string, value: unknown): void {
  ensureSettingsVersion();
  const validated = validateSettingValue(key, value);
  requireStore().setValue(key, validated);
}

export function exportAllSettings(): Record<string, unknown> {
  ensureSettingsVersion();
  return hydrateSettings(requireStore().exportAllSettings());
}

export function getSettingsFilePath(): string {
  return requireStore().getStoragePath();
}

export function getSettingsPaths(): { appDataPath: string; configPath: string; settingsFilePath: string } {
  return {
    appDataPath: getAppDataPath(),
    configPath: getConfigDirectory(),
    settingsFilePath: getSettingsFilePath()
  };
}

function ensureSettingsVersion(): void {
  if (migrationsApplied) {
    return;
  }
  const snapshot = requireStore().exportSnapshot();
  const migrated = applyMigrations(snapshot);
  const previousVersion = typeof snapshot[SETTINGS_VERSION_KEY] === "number" ? snapshot[SETTINGS_VERSION_KEY] : 0;
  const nextVersion = typeof migrated[SETTINGS_VERSION_KEY] === "number" ? migrated[SETTINGS_VERSION_KEY] : 0;
  if (nextVersion !== previousVersion) {
    Object.entries(migrated).forEach(([key, value]) => {
      requireStore().setValue(key, value);
    });
  }
  migrationsApplied = true;
}
