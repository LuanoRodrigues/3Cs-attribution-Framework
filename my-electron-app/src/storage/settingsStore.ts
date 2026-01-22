import fs from "fs";
import path from "path";

import ElectronStore from "electron-store";

export interface SettingsStoreOptions {
  fileName?: string;
}

export type SettingsMap = Record<string, unknown>;
type ElectronStoreLike = {
  has(key: string): boolean;
  get(key: string, defaultValue?: unknown): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  store: Record<string, unknown>;
  path: string;
};

export class SettingsStore {
  private readonly store: ElectronStoreLike;

  constructor(baseDir: string, options?: SettingsStoreOptions) {
    const fileName = options?.fileName ?? "settings";
    const configDir = baseDir;
    fs.mkdirSync(configDir, { recursive: true });
    this.store = new ElectronStore({
      cwd: configDir,
      name: fileName,
      fileExtension: "json",
      watch: false,
      accessPropertiesByDotNotation: false
    }) as unknown as ElectronStoreLike;
  }

  reload(): void {
    // electron-store handles internal reloading; no-op retained for compatibility.
  }

  getValue<T = unknown>(key: string, defaultValue?: T): T | undefined {
    if (!this.store.has(key)) {
      return defaultValue;
    }
    return this.store.get(key) as T;
  }

  setValue(key: string, value: unknown): void {
    if (value === undefined) {
      this.store.delete(key);
      return;
    }
    this.store.set(key, value);
  }

  exportSnapshot(): SettingsMap {
    return { ...this.store.store };
  }

  exportAllSettings(): SettingsMap {
    return this.exportSnapshot();
  }

  getStoragePath(): string {
    return this.store.path;
  }

  getConfigDirectoryPath(): string {
    return path.dirname(this.store.path);
  }
}
