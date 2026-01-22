import path from "path";

export const SESSION_FILE_NAME = "session.json";
export const PROJECT_ASSETS_DIR = "assets";
export const EXPORTS_DIR_NAME = "exports";
export const MANIFEST_FILE_NAME = "manifest.json";
export const PROJECT_METADATA_FILE_NAME = "project.json";
export const APP_HOME_DIR_NAME = "annotarium";
export const ANALYSE_DIR_NAME = "analyse";
export const CODER_DIR_NAME = "coder";
export const CONFIG_DIR_NAME = "config";

export function getSessionFilePath(projectRoot: string): string {
  return path.join(projectRoot, SESSION_FILE_NAME);
}

export function getAssetsDirectory(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_ASSETS_DIR);
}

export function getAppHome(): string {
  return path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", APP_HOME_DIR_NAME);
}

export function getExportDirectory(): string {
  return path.join(getAppHome(), EXPORTS_DIR_NAME);
}

export function getProjectMetadataPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_METADATA_FILE_NAME);
}

export function getAnalyseRoot(collection?: string): string {
  const base = path.join(getAppHome(), ANALYSE_DIR_NAME);
  if (!collection) return base;
  return path.join(base, collection);
}

export function getCoderCacheDir(): string {
  return path.join(getAppHome(), CODER_DIR_NAME);
}

export function getConfigDir(): string {
  return path.join(getAppHome(), CONFIG_DIR_NAME);
}
