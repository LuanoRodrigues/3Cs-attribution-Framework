import { exportAllSettings, getSetting, setSetting } from "./settingsFacade";

export class SettingsService {
  getValue<T = unknown>(key: string, defaultValue?: T): T | undefined {
    return getSetting<T>(key, defaultValue);
  }

  setValue(key: string, value: unknown): void {
    setSetting(key, value);
  }

  getAllSettings(): Record<string, unknown> {
    return exportAllSettings();
  }
}
