import crypto from "crypto";
import fs from "fs";
import path from "path";

import argon2 from "argon2";

const VAULT_AAD = "annotarium-secrets-vault:v1";
const KEYTAR_SERVICE = "annotarium-secrets";

type KeytarModule = {
  findCredentials: (service: string) => Promise<Array<{ account: string; password: string }>>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
};

let keytarCached: KeytarModule | null | undefined;
let keytarWarned = false;

const loadKeytar = (): KeytarModule | null => {
  if (keytarCached !== undefined) {
    return keytarCached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("keytar") as KeytarModule;
    keytarCached = mod ?? null;
    return keytarCached;
  } catch (error) {
    keytarCached = null;
    if (!keytarWarned) {
      keytarWarned = true;
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "keytar load failed";
      console.warn(`[SecretsVault] keytar unavailable; using file-only secrets. (${msg})`);
    }
    return keytarCached;
  }
};

export interface VaultKdfBase {
  name: "argon2id";
  time_cost: number;
  memory_cost_kib: number;
  parallelism: number;
  hash_len: number;
}

export interface VaultKdfParams extends VaultKdfBase {
  salt_b64: string;
}

const DEFAULT_KDF: VaultKdfBase = {
  name: "argon2id",
  time_cost: 3,
  memory_cost_kib: 262144,
  parallelism: 2,
  hash_len: 32
};

export interface VaultAead {
  name: "aes-256-gcm";
  nonce_b64: string;
  ciphertext_b64: string;
  aad: string;
}

export interface VaultFile {
  version: 1;
  kdf: VaultKdfParams;
  aead: VaultAead;
}

export type SecretsMap = Record<string, string>;

export class SecretsVault {
  private readonly vaultPath: string;
  private secrets: SecretsMap = {};
  private passphrase?: string;
  private unlocked = false;

  constructor(baseDir: string) {
    this.vaultPath = path.join(baseDir, "config", "secrets.vault");
    fs.mkdirSync(path.dirname(this.vaultPath), { recursive: true });
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  async unlockSecrets(passphrase: string): Promise<void> {
    this.passphrase = passphrase;
    this.unlocked = true;
    if (!fs.existsSync(this.vaultPath)) {
      this.secrets = await this.loadFromKeytar();
      await this.persistSecrets();
      return;
    }
    const vaultFile = this.readVault();
    this.secrets = await this.decryptSecrets(vaultFile, passphrase);
    await this.syncKeytar();
  }

  async setSecret(name: string, value: string): Promise<void> {
    this.ensureUnlocked();
    this.secrets[name] = value;
    const keytar = loadKeytar();
    if (keytar) {
      await keytar.setPassword(KEYTAR_SERVICE, name, value);
    }
    await this.persistSecrets();
  }

  getSecret(name: string): string | undefined {
    this.ensureUnlocked();
    return this.secrets[name];
  }

  getAllSecrets(): SecretsMap {
    this.ensureUnlocked();
    return { ...this.secrets };
  }

  getVaultPath(): string {
    return this.vaultPath;
  }

  private ensureUnlocked(): void {
    if (!this.unlocked) {
      throw new Error("Secrets vault is locked. Call unlockSecrets(passphrase) first.");
    }
  }

  private readVault(): VaultFile {
    const raw = fs.readFileSync(this.vaultPath, "utf-8");
    return JSON.parse(raw) as VaultFile;
  }

  private async decryptSecrets(vaultFile: VaultFile, passphrase: string): Promise<SecretsMap> {
    const salt = Buffer.from(vaultFile.kdf.salt_b64, "base64");
    const key = await this.deriveKey(passphrase, salt, vaultFile.kdf);
    const nonce = Buffer.from(vaultFile.aead.nonce_b64, "base64");
    const payload = Buffer.from(vaultFile.aead.ciphertext_b64, "base64");
    const ciphertext = payload.slice(0, payload.length - 16);
    const tag = payload.slice(payload.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(vaultFile.aead.aad, "utf-8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf-8"));
  }

  private async persistSecrets(): Promise<void> {
    const salt = crypto.randomBytes(16);
    const nonce = crypto.randomBytes(12);
    const key = await this.deriveKey(this.passphrase!, salt, DEFAULT_KDF);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(VAULT_AAD, "utf-8"));
    const plaintext = JSON.stringify(this.secrets);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([ciphertext, tag]);

    const vaultFile: VaultFile = {
      version: 1,
      kdf: {
        ...DEFAULT_KDF,
        salt_b64: salt.toString("base64")
      },
      aead: {
        name: "aes-256-gcm",
        nonce_b64: nonce.toString("base64"),
        ciphertext_b64: payload.toString("base64"),
        aad: VAULT_AAD
      }
    };

    fs.writeFileSync(this.vaultPath, JSON.stringify(vaultFile, null, 2), "utf-8");
  }

  private async deriveKey(passphrase: string, salt: Buffer, params: VaultKdfBase): Promise<Buffer> {
    return argon2.hash(passphrase, {
      salt,
      type: argon2.argon2id,
      timeCost: params.time_cost,
      memoryCost: params.memory_cost_kib,
      parallelism: params.parallelism,
      hashLength: params.hash_len,
      raw: true
    });
  }

  private async loadFromKeytar(): Promise<SecretsMap> {
    const keytar = loadKeytar();
    if (!keytar) {
      return {};
    }
    const entries = await keytar.findCredentials(KEYTAR_SERVICE);
    const result: SecretsMap = {};
    entries.forEach((entry) => {
      result[entry.account] = entry.password;
    });
    return result;
  }

  private async syncKeytar(): Promise<void> {
    const keytar = loadKeytar();
    if (!keytar) {
      return;
    }
    const promises = Object.entries(this.secrets).map(([name, secret]) =>
      keytar.setPassword(KEYTAR_SERVICE, name, secret)
    );
    await Promise.all(promises);
  }
}
