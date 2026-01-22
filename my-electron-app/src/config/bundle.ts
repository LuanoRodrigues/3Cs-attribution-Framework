import fs from "fs";
import path from "path";

import AdmZip from "adm-zip";

import { exportAllSettings, getAppDataPath, getConfigDirectory, setSetting } from "./settingsFacade";
import { SecretsVault, VaultAead, VaultKdfParams } from "./secretsVault";

interface BundleManifest {
  app: string;
  bundle_version: number;
  created_at_unix: number;
  includes_secrets: boolean;
  kdf: VaultKdfParams | null;
  aead: VaultAead | null;
}

function ensureParent(dirPath: string): void {
  fs.mkdirSync(path.dirname(dirPath), { recursive: true });
}

export async function exportConfigBundle(zipPath: string, includeSecrets = false): Promise<string> {
  ensureParent(zipPath);

  const manifest: BundleManifest = {
    app: "annotarium",
    bundle_version: 1,
    created_at_unix: Math.floor(Date.now() / 1000),
    includes_secrets: includeSecrets,
    kdf: null,
    aead: null
  };

  const configSnapshot = exportAllSettings();
  let secretsBytes: Buffer | null = null;

  if (includeSecrets) {
    const vault = new SecretsVault(getAppDataPath());
    const vaultPath = vault.getVaultPath();
    if (!fs.existsSync(vaultPath)) {
      throw new Error("Secrets vault file not found");
    }
    secretsBytes = fs.readFileSync(vaultPath);
    const parsed = JSON.parse(secretsBytes.toString("utf-8"));
    manifest.kdf = parsed.kdf as VaultKdfParams;
    manifest.aead = parsed.aead as VaultAead;
  }

  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));
  zip.addFile("config.json", Buffer.from(JSON.stringify(configSnapshot, null, 2), "utf-8"));

  if (secretsBytes) {
    zip.addFile("secrets.vault", secretsBytes);
  }

  zip.writeZip(zipPath);
  return zipPath;
}

export async function importConfigBundle(zipPath: string): Promise<void> {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Bundle not found: ${zipPath}`);
  }

  const zip = new AdmZip(zipPath);
  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry) {
    throw new Error("manifest.json missing in bundle");
  }
  const manifest = JSON.parse(manifestEntry.getData().toString("utf-8")) as BundleManifest;

  const configEntry = zip.getEntry("config.json");
  if (!configEntry) {
    throw new Error("config.json missing in bundle");
  }
  const configData = JSON.parse(configEntry.getData().toString("utf-8")) as Record<string, unknown>;
  Object.entries(configData).forEach(([key, value]) => {
    setSetting(key, value);
  });

  if (manifest.includes_secrets) {
    const secretsEntry = zip.getEntry("secrets.vault");
    if (!secretsEntry) {
      throw new Error("secrets.vault missing even though manifest claims secrets");
    }
    const vaultPath = path.join(getConfigDirectory(), "secrets.vault");
    ensureParent(vaultPath);
    fs.writeFileSync(vaultPath, secretsEntry.getData());
  }
}
