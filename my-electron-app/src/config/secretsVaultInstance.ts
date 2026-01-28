import { app } from "electron";

import { getAppDataPath } from "./settingsFacade";
import { SecretsVault } from "./secretsVault";

let vaultInstance: SecretsVault | null = null;

const resolveBaseDir = (baseDir?: string): string => {
  if (baseDir && baseDir.trim()) {
    return baseDir;
  }
  try {
    return getAppDataPath();
  } catch {
    try {
      return app.getPath("userData");
    } catch {
      return process.cwd();
    }
  }
};

export const initializeSecretsVault = (baseDir?: string): SecretsVault => {
  const resolved = resolveBaseDir(baseDir);
  vaultInstance = new SecretsVault(resolved);
  return vaultInstance;
};

export const getSecretsVault = (): SecretsVault => {
  if (!vaultInstance) {
    vaultInstance = new SecretsVault(resolveBaseDir());
  }
  return vaultInstance;
};
