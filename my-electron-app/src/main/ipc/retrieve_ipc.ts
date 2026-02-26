import { app, dialog, ipcMain } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import type {
  RetrievePaperSnapshot,
  RetrieveProviderId,
  RetrieveCitationNetwork,
  RetrieveCitationNetworkRequest,
  RetrieveSnowballRequest,
  RetrieveSaveRequest,
  RetrieveQuery,
  RetrieveRecord,
  RetrieveSearchResult
} from "../../shared/types/retrieve";
import type { DataHubTable } from "../../shared/types/dataHub";
import { GENERAL_KEYS, ZOTERO_KEYS } from "../../config/settingsKeys";
import { getAppDataPath, getSetting, setSetting } from "../../config/settingsFacade";
import { getSecretsVault } from "../../config/secretsVaultInstance";
import { getProviderSpec, mergeCosResults, type ProviderSearchResult } from "../services/retrieve/providers";
import { getCachedResult, setCachedResult } from "../services/retrieve/cache";
import { addTagToPaper, listTagsForPaper, removeTagFromPaper } from "../services/retrieve/tags_db";
import { buildCitationNetwork } from "../services/retrieve/citation_network";
import { fetchSemanticSnowball } from "../services/retrieve/snowball";
import { getUnpaywallEmail } from "../services/retrieve/providers";
import AdmZip from "adm-zip";
import { invokeDataHubExportExcel, invokeDataHubListCollections, invokeDataHubLoad } from "../services/dataHubBridge";
import {
  fetchZoteroCollectionItems,
  fetchZoteroCollectionItemsPreview,
  fetchZoteroCollectionCount,
  normalizeZoteroCollectionKey,
  listZoteroCollections,
  listZoteroCollectionsCached,
  mergeTables,
  resolveZoteroCredentialsTs
} from "../services/retrieve/zotero";

const rateTracker = new Map<RetrieveProviderId, number>();
let vmControlLease: { owner: string; acquiredAt: number } | null = null;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const throttle = async (providerId: RetrieveProviderId, rateMs?: number): Promise<void> => {
  if (!rateMs || rateMs <= 0) {
    return;
  }
  const last = rateTracker.get(providerId) ?? 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < rateMs) {
    await sleep(rateMs - elapsed);
  }
  rateTracker.set(providerId, Date.now());
};

const toNumberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const toStringOrUndefined = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
};

const normalizeCollectionSelector = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return normalizeZoteroCollectionKey(value).toLowerCase();
};

const normalizeCollectionSelectorStrict = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return normalizeZoteroCollectionKey(value).replace(/\s+/g, "").toLowerCase();
};

const resolveCollectionFromList = (
  collections: { key: string; name: string }[],
  target: string
): { key: string; name: string } | undefined => {
  const normalized = normalizeCollectionSelector(target);
  if (!normalized) return undefined;
  const byKey = collections.find((collection) => normalizeCollectionSelector(collection.key) === normalized);
  if (byKey) return byKey;
  const byName = collections.find(
    (collection) => normalizeCollectionSelector(collection.name) === normalized
  );
  return byName || undefined;
};

const resolveZoteroCredentials = (): { libraryId: string; libraryType: string; apiKey: string } => {
  const libraryId =
    toStringOrUndefined(getSetting<string>(ZOTERO_KEYS.libraryId)) ||
    toStringOrUndefined(process.env.ZOTERO_LIBRARY_ID) ||
    toStringOrUndefined(process.env.LIBRARY_ID);
  const libraryType =
    toStringOrUndefined(getSetting<string>(ZOTERO_KEYS.libraryType)) ||
    toStringOrUndefined(process.env.ZOTERO_LIBRARY_TYPE) ||
    toStringOrUndefined(process.env.LIBRARY_TYPE) ||
    "user";
  if (!libraryId) {
    throw new Error("Zotero library ID is not configured in settings or .env (ZOTERO_LIBRARY_ID / LIBRARY_ID).");
  }
  let apiKey: string | undefined;
  try {
    apiKey = getSecretsVault().getSecret(ZOTERO_KEYS.apiKey);
  } catch {
    // vault might be locked; fall through to env
  }
  apiKey =
    apiKey ||
    toStringOrUndefined(process.env.ZOTERO_API_KEY) ||
    toStringOrUndefined(process.env.API_KEY) ||
    toStringOrUndefined(process.env.ZOTERO_KEY);
  if (!apiKey) {
    throw new Error("Zotero API key is not configured (settings, secrets vault, or .env ZOTERO_API_KEY/API_KEY).");
  }
  return { libraryId, libraryType, apiKey };
};

const resolveZoteroCollection = (payload?: Record<string, unknown>): string | undefined => {
  return (
    toStringOrUndefined(payload?.collectionName) ||
    toStringOrUndefined(getSetting<string>(GENERAL_KEYS.collectionName)) ||
    toStringOrUndefined(getSetting<string>(ZOTERO_KEYS.lastCollection)) ||
    toStringOrUndefined(process.env.ZOTERO_COLLECTION) ||
    toStringOrUndefined(process.env.COLLECTION_NAME)
  );
};

const resolveDataHubCacheDir = (): string => {
  return path.join(app.getPath("userData"), "data-hub-cache");
};

const ensureDataHubLastMarker = (args: {
  source: { type: "file" | "zotero"; path?: string; collectionName?: string };
}): void => {
  const cacheDir = resolveDataHubCacheDir();
  const lastPath = path.join(cacheDir, "last.json");
  if (fs.existsSync(lastPath)) {
    return;
  }
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    // ignore
  }
  const payload = {
    version: 1,
    writtenAt: new Date().toISOString(),
    source: args.source
  };
  try {
    fs.writeFileSync(lastPath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // ignore: marker is best-effort
  }
};

const findMostRecentCachedTable = async (
  cacheDir: string
): Promise<{ table: DataHubTable; cacheFilePath: string } | undefined> => {
  const ignoreNames = new Set([
    "references.json",
    "references_library.json",
    "references.used.json",
    "references_library.used.json",
    "last.json"
  ]);
  let entries: string[] = [];
  try {
    entries = await fs.promises.readdir(cacheDir);
  } catch {
    return undefined;
  }
  const candidates: Array<{ filePath: string; mtimeMs: number }> = [];
  for (const name of entries) {
    const lower = name.toLowerCase();
    if (!lower.endsWith(".json")) continue;
    if (ignoreNames.has(lower)) continue;
    const filePath = path.join(cacheDir, name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) continue;
      candidates.push({ filePath, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath));
  for (const candidate of candidates) {
    try {
      const raw = await fs.promises.readFile(candidate.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const table = (parsed as any)?.table as DataHubTable | undefined;
      if (!table || !Array.isArray((table as any).columns) || !Array.isArray((table as any).rows)) continue;
      if ((table as any).columns.length <= 0 || (table as any).rows.length <= 0) continue;
      return { table, cacheFilePath: candidate.filePath };
    } catch {
      // ignore corrupt caches
    }
  }
  return undefined;
};

const ensureTablePayload = (payload?: Record<string, unknown>): DataHubTable => {
  const table = payload?.table as DataHubTable | undefined;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    throw new Error("Table payload is required.");
  }
  return table;
};

const normalizeCell = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  return false;
};

const resolveNaTable = (
  table: DataHubTable,
  columns: string[] | undefined,
  replacement: string
): { table: DataHubTable; replaced: number } => {
  const columnSet = columns && columns.length > 0 ? new Set(columns) : null;
  const nextRows: Array<Array<unknown>> = [];
  let replaced = 0;
  table.rows.forEach((row) => {
    const nextRow = row.slice();
    nextRow.forEach((cell, idx) => {
      const colName = table.columns[idx];
      if (columnSet && !columnSet.has(colName)) {
        return;
      }
      if (normalizeCell(cell)) {
        nextRow[idx] = replacement;
        replaced += 1;
      }
    });
    nextRows.push(nextRow);
  });
  return { table: { columns: table.columns.slice(), rows: nextRows }, replaced };
};

const filterColumns = (table: DataHubTable, columns: string[]): DataHubTable => {
  const wanted = columns.map((name) => table.columns.indexOf(name)).filter((idx) => idx >= 0);
  if (wanted.length === 0) {
    throw new Error("No matching columns were found.");
  }
  const nextColumns = wanted.map((idx) => table.columns[idx]);
  const nextRows = table.rows.map((row) => wanted.map((idx) => row[idx]));
  return { columns: nextColumns, rows: nextRows };
};

const escapeCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "string" ? value : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/\"/g, "\"\"")}"`;
  }
  return text;
};

const stringifyCsv = (table: DataHubTable): string => {
  const lines: string[] = [];
  lines.push(table.columns.map((value) => escapeCsvValue(value)).join(","));
  table.rows.forEach((row) => {
    lines.push(row.map((value) => escapeCsvValue(value)).join(","));
  });
  return `${lines.join("\n")}\n`;
};

const normalizeQuery = (payload?: Record<string, unknown>): RetrieveQuery => {
  const base: RetrieveQuery = {
    query: toStringOrUndefined(payload?.query) ?? "",
    year_from: toNumberOrUndefined(payload?.year_from),
    year_to: toNumberOrUndefined(payload?.year_to),
    sort: typeof payload?.sort === "string" ? (payload.sort as RetrieveQuery["sort"]) : undefined,
    limit: toNumberOrUndefined(payload?.limit),
    cursor: toStringOrUndefined(payload?.cursor),
    offset: toNumberOrUndefined(payload?.offset),
    page: toNumberOrUndefined(payload?.page),
    author_contains: toStringOrUndefined(payload?.author_contains),
    venue_contains: toStringOrUndefined(payload?.venue_contains),
    only_doi: Boolean(payload?.only_doi),
    only_abstract: Boolean(payload?.only_abstract)
  };
  const providerId = typeof payload?.provider === "string" ? (payload.provider as RetrieveProviderId) : undefined;
  if (providerId) {
    base.provider = providerId;
  }
  return base;
};

type UnifiedStrategyPayload = {
  query: string;
  browserProviders: string[];
  maxPages: number;
  headed: boolean;
  vmMode: boolean;
  vmCpus?: number;
  vmMemoryMb?: number;
  profileDir: string;
  profileName: string;
  includeSemanticApi: boolean;
  includeCrossrefApi: boolean;
};

type VmCommandPayload = {
  imageUrl?: string;
  isoPath?: string;
  sizeGb?: number;
  cpus?: number;
  memoryMb?: number;
  browserProfileDir?: string;
  browserProfileName?: string;
  skipSeed?: boolean;
  owner?: string;
};

const normalizeUnifiedStrategyPayload = (payload?: Record<string, unknown>): UnifiedStrategyPayload => {
  const providerEntries = Array.isArray(payload?.browserProviders) ? payload?.browserProviders : [];
  const browserProviders = providerEntries
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  const maxPages = Math.max(1, Math.min(20, toNumberOrUndefined(payload?.maxPages) || 3));
  return {
    query: toStringOrUndefined(payload?.query) || "",
    browserProviders,
    maxPages,
    headed: payload?.headed !== false,
    vmMode: payload?.vmMode === true,
    vmCpus: toNumberOrUndefined(payload?.vmCpus),
    vmMemoryMb: toNumberOrUndefined(payload?.vmMemoryMb),
    profileDir: toStringOrUndefined(payload?.profileDir) || "scrapping/browser/searches/profiles/default",
    profileName: toStringOrUndefined(payload?.profileName) || "Default",
    includeSemanticApi: payload?.includeSemanticApi !== false,
    includeCrossrefApi: payload?.includeCrossrefApi !== false
  };
};

const normalizeVmCommandPayload = (payload?: Record<string, unknown>): VmCommandPayload => ({
  imageUrl: toStringOrUndefined(payload?.imageUrl),
  isoPath: toStringOrUndefined(payload?.isoPath),
  sizeGb: toNumberOrUndefined(payload?.sizeGb),
  cpus: toNumberOrUndefined(payload?.cpus),
  memoryMb: toNumberOrUndefined(payload?.memoryMb),
  browserProfileDir: toStringOrUndefined(payload?.browserProfileDir),
  browserProfileName: toStringOrUndefined(payload?.browserProfileName),
  skipSeed: payload?.skipSeed === true
});

const resolveTeiaRoot = (): string => {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "scrapping"))) {
    return cwd;
  }
  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, "scrapping"))) {
    return parent;
  }
  const appPath = app.getAppPath();
  const candidates = [appPath, path.resolve(appPath, ".."), path.resolve(appPath, "../.."), path.resolve(appPath, "../../..")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "scrapping"))) {
      return candidate;
    }
  }
  return cwd;
};

const resolvePythonBin = (): string => {
  const envPython = toStringOrUndefined(process.env.PYTHON_BIN) || toStringOrUndefined(process.env.PYTHON);
  return envPython || "python3";
};

const resolveVmSharedDownloadsDir = (): string => {
  const teiaRoot = resolveTeiaRoot();
  return path.join(teiaRoot, "scrapping", "browser", "searches", "downloads");
};

type VmSshTarget = { user: string; host: string; port: number };

const parseVmSshTarget = (value: string): VmSshTarget | null => {
  const text = String(value || "").trim();
  const m = text.match(/^([^@\s:]+)@([^:\s]+):(\d+)$/);
  if (!m) return null;
  return { user: m[1], host: m[2], port: Number(m[3]) || 22 };
};

const buildVmSshOptions = (vm: Record<string, unknown>): string[] => {
  const sshKeyPath = String(vm?.ssh_key_path || "").trim();
  const knownHostsPath = String(vm?.ssh_known_hosts_path || "").trim();
  if (!sshKeyPath) {
    throw new Error("VM SSH key path missing; regenerate VM seed and restart VM.");
  }
  if (!knownHostsPath) {
    throw new Error("VM known_hosts path missing; regenerate VM seed and restart VM.");
  }
  const options = [
    "-i",
    sshKeyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "PreferredAuthentications=publickey",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "UserKnownHostsFile=" + knownHostsPath,
  ];
  return options;
};

type VmDiskGuardReport = {
  usagePercent: number;
  freeMb: number;
  totalMb: number;
  cleanupApplied: boolean;
  warnThreshold: number;
  pruneThreshold: number;
};

const runVmSshCommand = async (
  vm: Record<string, unknown>,
  command: string,
  timeoutMs = 120000
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const ssh = parseVmSshTarget(String(vm?.ssh_target || ""));
  if (!ssh) throw new Error("VM SSH target missing or invalid; run VM preflight/start first.");
  const sshArgs = [...buildVmSshOptions(vm), "-p", String(ssh.port), `${ssh.user}@${ssh.host}`, command];
  const proc = spawn("ssh", sshArgs, { cwd: resolveTeiaRoot(), stdio: ["ignore", "pipe", "pipe"], env: process.env });
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (c: Buffer | string) => (stdout += String(c)));
  proc.stderr.on("data", (c: Buffer | string) => (stderr += String(c)));
  const timeout = setTimeout(() => {
    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore
    }
  }, timeoutMs);
  const code = await new Promise<number>((resolve) => proc.on("close", (exitCode) => resolve(exitCode ?? 1)));
  clearTimeout(timeout);
  return { code, stdout, stderr };
};

const parseDfPkRoot = (text: string): VmDiskGuardReport => {
  const line = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .find((x) => x.includes(" /"));
  if (!line) {
    throw new Error("Failed to parse VM disk usage.");
  }
  const parts = line.split(/\s+/);
  if (parts.length < 6) {
    throw new Error(`Unexpected df output: ${line}`);
  }
  const totalKb = Number(parts[1]);
  const freeKb = Number(parts[3]);
  const usePctRaw = String(parts[4] || "0").replace("%", "");
  const usagePercent = Number(usePctRaw);
  return {
    usagePercent: Number.isFinite(usagePercent) ? usagePercent : 0,
    freeMb: Math.max(0, Math.floor((Number.isFinite(freeKb) ? freeKb : 0) / 1024)),
    totalMb: Math.max(0, Math.floor((Number.isFinite(totalKb) ? totalKb : 0) / 1024)),
    cleanupApplied: false,
    warnThreshold: 80,
    pruneThreshold: 90
  };
};

const runVmDiskGuard = async (
  vm: Record<string, unknown>,
  opts?: { warnThreshold?: number; pruneThreshold?: number; minFreeMb?: number }
): Promise<VmDiskGuardReport> => {
  const warnThreshold = Math.max(1, Math.min(99, Number(opts?.warnThreshold ?? 80)));
  const pruneThreshold = Math.max(warnThreshold, Math.min(99, Number(opts?.pruneThreshold ?? 90)));
  const minFreeMb = Math.max(128, Number(opts?.minFreeMb ?? 2048));
  const dfFirst = await runVmSshCommand(vm, "df -Pk / | tail -n 1");
  if (dfFirst.code !== 0) {
    throw new Error(`VM disk check failed: ${dfFirst.stderr || dfFirst.stdout || `exit=${dfFirst.code}`}`);
  }
  let report = parseDfPkRoot(dfFirst.stdout);
  report.warnThreshold = warnThreshold;
  report.pruneThreshold = pruneThreshold;
  const needsCleanup = report.usagePercent >= pruneThreshold || report.freeMb < minFreeMb;
  if (!needsCleanup) return report;

  const ssh = parseVmSshTarget(String(vm?.ssh_target || ""));
  if (!ssh) throw new Error("VM SSH target missing for cleanup.");
  const cleanupScript = [
    "set -euo pipefail",
    `sudo mkdir -p /home/${ssh.user}/vm_runs`,
    `sudo bash -lc 'ls -1dt /home/${ssh.user}/vm_runs/* 2>/dev/null | tail -n +6 | xargs -r rm -rf'`,
    "sudo apt-get clean || true",
    "sudo journalctl --vacuum-time=3d || true",
    "sudo find /tmp -mindepth 1 -maxdepth 1 -exec rm -rf {} + || true",
    "sudo find /var/tmp -mindepth 1 -maxdepth 1 -exec rm -rf {} + || true",
    "df -Pk / | tail -n 1"
  ].join("; ");
  const cleaned = await runVmSshCommand(vm, cleanupScript, 180000);
  if (cleaned.code !== 0) {
    throw new Error(`VM cleanup failed: ${cleaned.stderr || cleaned.stdout || `exit=${cleaned.code}`}`);
  }
  report = parseDfPkRoot(cleaned.stdout);
  report.cleanupApplied = true;
  report.warnThreshold = warnThreshold;
  report.pruneThreshold = pruneThreshold;
  return report;
};

const listVmProfiles = async (vm: Record<string, unknown>): Promise<string[]> => {
  const ssh = parseVmSshTarget(String(vm?.ssh_target || ""));
  if (!ssh) throw new Error("VM SSH target missing for profile listing.");
  const cmd = `mkdir -p /home/${ssh.user}/.browser-profiles && find /home/${ssh.user}/.browser-profiles -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' | sort`;
  const out = await runVmSshCommand(vm, cmd);
  if (out.code !== 0) {
    throw new Error(`VM profile listing failed: ${out.stderr || out.stdout || `exit=${out.code}`}`);
  }
  return out.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const syncHostProfileToVm = async (
  vm: Record<string, unknown>,
  sourceDir: string,
  profileName: string
): Promise<{ source: string; target: string }> => {
  const ssh = parseVmSshTarget(String(vm?.ssh_target || ""));
  if (!ssh) throw new Error("VM SSH target missing for profile sync.");
  const teiaRoot = resolveTeiaRoot();
  const source = path.isAbsolute(sourceDir) ? sourceDir : path.join(teiaRoot, sourceDir);
  const resolvedSource = path.resolve(source);
  const stat = await fs.promises.stat(resolvedSource).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Host profile source not found: ${resolvedSource}`);
  }
  const safeName = (profileName || "Default").trim() || "Default";
  const target = `/home/${ssh.user}/.browser-profiles/${safeName}`;
  const tarProc = spawn("tar", ["-czf", "-", "-C", resolvedSource, "."], {
    cwd: teiaRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  const sshProc = spawn(
    "ssh",
    [...buildVmSshOptions(vm), "-p", String(ssh.port), `${ssh.user}@${ssh.host}`, `rm -rf '${target}' && mkdir -p '${target}' && tar -xzf - -C '${target}'`],
    { cwd: teiaRoot, stdio: ["pipe", "pipe", "pipe"], env: process.env }
  );
  tarProc.stdout.pipe(sshProc.stdin);
  let tarErr = "";
  let sshErr = "";
  tarProc.stderr.on("data", (c: Buffer | string) => (tarErr += String(c)));
  sshProc.stderr.on("data", (c: Buffer | string) => (sshErr += String(c)));
  const [tarCode, sshCode] = await Promise.all([
    new Promise<number>((resolve) => tarProc.on("close", (code) => resolve(code ?? 1))),
    new Promise<number>((resolve) => sshProc.on("close", (code) => resolve(code ?? 1)))
  ]);
  if (tarCode !== 0) throw new Error(`Profile tar failed: ${tarErr || `exit=${tarCode}`}`);
  if (sshCode !== 0) throw new Error(`Profile SSH sync failed: ${sshErr || `exit=${sshCode}`}`);
  return { source: resolvedSource, target };
};

const runProviderSmokeReport = async (payload?: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const teiaRoot = resolveTeiaRoot();
  const python = resolvePythonBin();
  const defaultProviders = ["google", "cambridge", "jstor", "brill", "digital_commons", "rand", "academia", "elgaronline", "springerlink"];
  const providers = Array.isArray(payload?.providers)
    ? (payload?.providers as unknown[]).map((x) => String(x || "").trim()).filter(Boolean)
    : defaultProviders;
  const query = toStringOrUndefined(payload?.query) || "cyber attribution";
  const maxPages = Math.max(1, Math.min(3, toNumberOrUndefined(payload?.maxPages) || 1));
  const profileDir = toStringOrUndefined(payload?.profileDir) || "scrapping/browser/searches/profiles/default";
  const profileName = toStringOrUndefined(payload?.profileName) || "Default";
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const reportDir = path.join(teiaRoot, "scrapping/browser/searches/runs/smoke_reports");
  await fs.promises.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${stamp}_smoke.json`);
  const results: Array<Record<string, unknown>> = [];

  for (const provider of providers) {
    const outPath = path.join(reportDir, `${stamp}_${provider}.json`);
    const started = Date.now();
    const args = [
      "-u",
      "-m",
      "scrapping.browser.searches.cli",
      provider,
      query,
      "--max-pages",
      String(maxPages),
      "--profile-dir",
      profileDir,
      "--profile-name",
      profileName,
      "--out",
      outPath
    ];
    const child = spawn(python, args, { cwd: teiaRoot, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (c: Buffer | string) => (stdout += String(c)));
    child.stderr.on("data", (c: Buffer | string) => (stderr += String(c)));
    const code = await new Promise<number>((resolve) => child.on("close", (exitCode) => resolve(exitCode ?? 1)));
    results.push({
      provider,
      status: code === 0 ? "ok" : "error",
      exitCode: code,
      elapsedMs: Date.now() - started,
      outputPath: outPath,
      stdout: stdout.trim().slice(0, 2000),
      stderr: stderr.trim().slice(0, 2000)
    });
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    query,
    maxPages,
    providers,
    ok: results.filter((r) => r.status === "ok").length,
    error: results.filter((r) => r.status !== "ok").length,
    results
  };
  await fs.promises.writeFile(reportPath, JSON.stringify(summary, null, 2), "utf-8");
  return { status: "ok", reportPath, summary };
};

const mapGuestSharedPathToHost = (guestPath: string): string => {
  const gp = String(guestPath || "").trim();
  if (!gp) return "";
  if (!gp.startsWith("/mnt/shared_downloads")) return gp;
  const rel = gp.replace(/^\/mnt\/shared_downloads\/?/, "");
  return path.join(resolveVmSharedDownloadsDir(), rel);
};

const findLatestRunDir = async (rootDir: string): Promise<string> => {
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const dirs: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(rootDir, entry.name);
    const stat = await fs.promises.stat(full).catch(() => null);
    if (!stat) continue;
    dirs.push({ path: full, mtimeMs: stat.mtimeMs });
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  if (!dirs.length) {
    throw new Error(`No run directories found in ${rootDir}`);
  }
  return dirs[0].path;
};

const collectPdfInventory = async (rootDir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        out.push(full);
      }
    }
  };
  await walk(rootDir);
  return out.sort((a, b) => a.localeCompare(b));
};

const runUnifiedBundle = async (args: UnifiedStrategyPayload): Promise<{
  runDir: string;
  mergedPath: string;
  manifestPath: string;
  logs: string[];
}> => {
  const teiaRoot = resolveTeiaRoot();
  const providers = args.browserProviders.length
    ? args.browserProviders
    : ["google", "cambridge", "jstor", "brill", "digital_commons", "rand", "academia", "elgaronline", "springerlink"];
  const pyArgs = [
    "-u",
    "-m",
    "scrapping.browser.searches.provider_bundle",
    args.query,
    "--providers",
    providers.join(","),
    "--max-pages",
    String(args.maxPages),
    "--profile-dir",
    args.profileDir,
    "--profile-name",
    args.profileName
  ];
  if (args.headed) {
    pyArgs.push("--headed");
  }
  const logs: string[] = [];
  const python = resolvePythonBin();
  const child = spawn(python, pyArgs, {
    cwd: teiaRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    stdout += text;
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => logs.push(line));
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    stderr += text;
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => logs.push(`[stderr] ${line}`));
  });

  const code = await new Promise<number>((resolve) => {
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    throw new Error(`Unified browser bundle failed (exit=${code}): ${stderr || stdout || "unknown error"}`);
  }

  const outputLine = logs.find((line) => line.startsWith("[bundle] output="));
  const manifestLine = logs.find((line) => line.startsWith("[bundle] manifest="));
  const runDir = outputLine ? outputLine.replace("[bundle] output=", "").trim() : "";
  const manifestPath = manifestLine ? manifestLine.replace("[bundle] manifest=", "").trim() : path.join(runDir, "manifest.json");
  if (!runDir) {
    throw new Error("Unified browser bundle did not report output directory.");
  }
  const mergedPath = path.join(runDir, "merged_deduplicated.json");
  return { runDir, mergedPath, manifestPath, logs };
};

const runUnifiedBundleViaVm = async (
  args: UnifiedStrategyPayload,
  vm: Record<string, unknown>
): Promise<{
  runDir: string;
  mergedPath: string;
  manifestPath: string;
  logs: string[];
}> => {
  const ssh = parseVmSshTarget(String(vm?.ssh_target || ""));
  if (!ssh) {
    throw new Error("VM SSH target missing or invalid; run VM preflight/start first.");
  }
  const sshKeyPath = String(vm?.ssh_key_path || "").trim();
  if (!sshKeyPath) {
    throw new Error("VM SSH key path missing; regenerate VM seed and restart VM.");
  }
  const providers = args.browserProviders.length
    ? args.browserProviders
    : ["google", "cambridge", "jstor", "brill", "digital_commons", "rand", "academia", "elgaronline", "springerlink"];
  const guestOutRoot = `/home/${ssh.user}/vm_runs`;
  const guestProfileDir = `/home/${ssh.user}/.browser-profiles`;
  const guestProfileName = (args.profileName || "Default").trim() || "Default";
  await syncVmSearchCode(vm);
  const guestPythonArgs = [
    "bash",
    "-lc",
    [
      "cd ~/teia_vm_runtime",
      "export DISPLAY=:1",
      "export CHROME_BINARY=/usr/bin/chromium",
      `mkdir -p '${guestProfileDir}'`,
      "PYTHONPATH=~/teia_vm_runtime",
      "python3",
      "-u",
      "-m",
      "scrapping.browser.searches.provider_bundle",
      `"${args.query.replace(/"/g, '\\"')}"`,
      "--providers",
      providers.join(","),
      "--max-pages",
      String(args.maxPages),
      "--out-root",
      guestOutRoot,
      "--profile-dir",
      guestProfileDir,
      "--profile-name",
      guestProfileName,
      ...(args.headed ? ["--headed"] : [])
    ].join(" ")
  ];
  const sshArgs = [
    ...buildVmSshOptions(vm),
    "-p",
    String(ssh.port),
    `${ssh.user}@${ssh.host}`,
    ...guestPythonArgs
  ];
  const logs: string[] = [];
  const child = spawn("ssh", sshArgs, {
    cwd: resolveTeiaRoot(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    stdout += text;
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => logs.push(`[vm-ssh] ${line}`));
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    stderr += text;
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => logs.push(`[vm-ssh][stderr] ${line}`));
  });
  const code = await new Promise<number>((resolve) => child.on("close", (exitCode) => resolve(exitCode ?? 1)));
  if (code !== 0) {
    throw new Error(`VM provider bundle failed (exit=${code}): ${stderr || stdout || "unknown error"}`);
  }
  const outputLine = logs.find((line) => line.includes("[bundle] output="));
  const manifestLine = logs.find((line) => line.includes("[bundle] manifest="));
  const guestRunDir = outputLine ? outputLine.split("[bundle] output=")[1]?.trim() || "" : "";
  const guestManifestPath = manifestLine ? manifestLine.split("[bundle] manifest=")[1]?.trim() || "" : "";

  let resolvedGuestRunDir = guestRunDir;
  if (!resolvedGuestRunDir) {
    const lsArgs = [
      ...buildVmSshOptions(vm),
      "-p",
      String(ssh.port),
      `${ssh.user}@${ssh.host}`,
      `ls -1dt ${guestOutRoot}/* | head -n 1`
    ];
    const lsProc = spawn("ssh", lsArgs, { cwd: resolveTeiaRoot(), stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let lsOut = "";
    lsProc.stdout.on("data", (c: Buffer | string) => (lsOut += String(c)));
    await new Promise<number>((resolve) => lsProc.on("close", (code) => resolve(code ?? 1)));
    resolvedGuestRunDir = String(lsOut || "").trim();
  }
  if (!resolvedGuestRunDir) {
    throw new Error("VM run completed but guest run directory could not be resolved.");
  }

  const hostRunRoot = path.join(resolveVmSharedDownloadsDir(), "vm_runs");
  await fs.promises.mkdir(hostRunRoot, { recursive: true });
  const scpArgs = [
    ...buildVmSshOptions(vm),
    "-P",
    String(ssh.port),
    "-r",
    `${ssh.user}@${ssh.host}:${resolvedGuestRunDir}`,
    hostRunRoot
  ];
  const scpProc = spawn("scp", scpArgs, { cwd: resolveTeiaRoot(), stdio: ["ignore", "pipe", "pipe"], env: process.env });
  let scpErr = "";
  scpProc.stderr.on("data", (c: Buffer | string) => (scpErr += String(c)));
  const scpCode = await new Promise<number>((resolve) => scpProc.on("close", (code) => resolve(code ?? 1)));
  if (scpCode !== 0) {
    throw new Error(`Failed to copy VM run outputs to host via scp: ${scpErr || `exit=${scpCode}`}`);
  }

  const runDir = await findLatestRunDir(hostRunRoot);
  const manifestPath = path.join(runDir, "manifest.json");
  const mergedPath = path.join(runDir, "merged_deduplicated.json");
  logs.unshift(`[vm] ssh_target=${ssh.user}@${ssh.host}:${ssh.port}`);
  logs.unshift(`[vm] guest_run_dir=${resolvedGuestRunDir}`);
  logs.unshift(`[vm] run_dir=${runDir}`);
  return { runDir, mergedPath, manifestPath, logs };
};

const bootstrapVmGuestServices = async (vm: Record<string, unknown>): Promise<void> => {
  const ssh = parseVmSshTarget(String(vm?.ssh_target || ""));
  const sshKeyPath = String(vm?.ssh_key_path || "").trim();
  if (!ssh || !sshKeyPath) {
    throw new Error("VM SSH target/key missing for guest bootstrap.");
  }
  const remoteScript = [
    "set -euo pipefail",
    `sudo mkdir -p /home/${ssh.user}/.browser-profiles`,
    `sudo chown -R ${ssh.user}:${ssh.user} /home/${ssh.user}/.browser-profiles`,
    "sudo mkdir -p /mnt/shared_downloads",
    "if ! grep -q 'shared_downloads /mnt/shared_downloads 9p' /etc/fstab; then",
    "  echo 'shared_downloads /mnt/shared_downloads 9p trans=virtio,version=9p2000.L,msize=262144,_netdev 0 0' | sudo tee -a /etc/fstab >/dev/null",
    "fi",
    "sudo mount -a || true",
    "sudo apt-get update -y || true",
    "sudo apt-get install -y xvfb openbox x11vnc websockify novnc chromium chromium-driver python3-bs4 python3-requests python3-selenium || true",
    "if [ -f /usr/local/bin/start-browser-stack.sh ]; then",
    `  sudo sed -i "s#/home/${ssh.user}/.browser-profile#/home/${ssh.user}/.browser-profiles#g" /usr/local/bin/start-browser-stack.sh || true`,
    `  sudo sed -i "s/pgrep -f \\\\\\\"x11vnc \\\\.*5900\\\\\\\"/pidof x11vnc/g" /usr/local/bin/start-browser-stack.sh || true`,
    `  sudo sed -i "s/pgrep -f \\\\\\\"websockify \\\\.*6080\\\\\\\"/pidof websockify/g" /usr/local/bin/start-browser-stack.sh || true`,
    "fi",
    "sudo tee /etc/systemd/system/browser-stack.service >/dev/null <<'UNIT'",
    "[Unit]",
    "Description=Browser Stack (Xvfb + Chromium + x11vnc + websockify)",
    "After=network.target",
    "",
    "[Service]",
    "Type=oneshot",
    "ExecStart=/usr/local/bin/start-browser-stack.sh",
    "RemainAfterExit=yes",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "UNIT",
    "if [ -f /etc/systemd/system/browser-stack.service ]; then",
    "  sudo systemctl daemon-reload || true",
    "  sudo systemctl enable --now browser-stack.service || true",
    "fi",
    "if [ -x /usr/local/bin/start-browser-stack.sh ]; then",
    "  sudo /usr/local/bin/start-browser-stack.sh || true",
    "fi",
  ].join("; ");
  const sshArgs = [
    ...buildVmSshOptions(vm),
    "-p",
    String(ssh.port),
    `${ssh.user}@${ssh.host}`,
    remoteScript
  ];
  const proc = spawn("ssh", sshArgs, { cwd: resolveTeiaRoot(), stdio: ["ignore", "pipe", "pipe"], env: process.env });
  let stderr = "";
  proc.stderr.on("data", (c: Buffer | string) => (stderr += String(c)));
  const code = await new Promise<number>((resolve) => proc.on("close", (exitCode) => resolve(exitCode ?? 1)));
  if (code !== 0) {
    throw new Error(`VM guest bootstrap failed: ${stderr || `ssh exit ${code}`}`);
  }
};

const syncVmSearchCode = async (vm: Record<string, unknown>): Promise<void> => {
  const ssh = parseVmSshTarget(String(vm?.ssh_target || ""));
  const sshKeyPath = String(vm?.ssh_key_path || "").trim();
  if (!ssh || !sshKeyPath) {
    throw new Error("VM SSH target/key missing for code sync.");
  }
  const teiaRoot = resolveTeiaRoot();
  const tarArgs = [
    "--exclude=scrapping/browser/searches/runs",
    "--exclude=scrapping/browser/searches/downloads",
    "--exclude=scrapping/browser/searches/profiles",
    "--exclude=__pycache__",
    "-czf",
    "-",
    "scrapping/__init__.py",
    "scrapping/browser/__init__.py",
    "scrapping/browser/merge_search_json.py",
    "scrapping/browser/searches"
  ];
  const sshArgs = [
    ...buildVmSshOptions(vm),
    "-p",
    String(ssh.port),
    `${ssh.user}@${ssh.host}`,
    "mkdir -p ~/teia_vm_runtime && tar -xzf - -C ~/teia_vm_runtime"
  ];
  const tarProc = spawn("tar", tarArgs, { cwd: teiaRoot, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const sshProc = spawn("ssh", sshArgs, { cwd: teiaRoot, stdio: ["pipe", "pipe", "pipe"], env: process.env });
  tarProc.stdout.pipe(sshProc.stdin);
  let tarErr = "";
  let sshErr = "";
  tarProc.stderr.on("data", (c: Buffer | string) => (tarErr += String(c)));
  sshProc.stderr.on("data", (c: Buffer | string) => (sshErr += String(c)));
  const [tarCode, sshCode] = await Promise.all([
    new Promise<number>((resolve) => tarProc.on("close", (code) => resolve(code ?? 1))),
    new Promise<number>((resolve) => sshProc.on("close", (code) => resolve(code ?? 1)))
  ]);
  if (tarCode !== 0) {
    throw new Error(`Local tar sync failed: ${tarErr || `exit=${tarCode}`}`);
  }
  if (sshCode !== 0) {
    throw new Error(`SSH sync failed: ${sshErr || `exit=${sshCode}`}`);
  }
};

const vmMessageHas = (vm: Record<string, unknown> | null | undefined, token: string): boolean => {
  const msg = String(vm?.message || "");
  return msg.includes(token);
};

const shouldRetryVmBundleError = (error: unknown): boolean => {
  const text = String((error as Error)?.message || error || "");
  return (
    text.includes("Unable to launch Chrome") ||
    text.includes("ModuleNotFoundError") ||
    text.includes("Connection timed out") ||
    text.includes("Connection reset") ||
    text.includes("ssh exit") ||
    text.includes("Failed to copy VM run outputs")
  );
};

const acquireVmLease = (owner: string): { ok: boolean; message?: string } => {
  const cleanOwner = owner.trim() || "anonymous";
  if (vmControlLease && vmControlLease.owner !== cleanOwner) {
    return { ok: false, message: `VM control is held by '${vmControlLease.owner}'.` };
  }
  vmControlLease = { owner: cleanOwner, acquiredAt: Date.now() };
  return { ok: true };
};

const releaseVmLease = (owner: string): { ok: boolean; message?: string } => {
  if (!vmControlLease) return { ok: true };
  const cleanOwner = owner.trim() || "anonymous";
  if (vmControlLease.owner !== cleanOwner && cleanOwner !== "admin") {
    return { ok: false, message: `VM control is held by '${vmControlLease.owner}'.` };
  }
  vmControlLease = null;
  return { ok: true };
};

const runVmCli = async (
  commandName: "status" | "preflight" | "prepare-image" | "init-image" | "seed" | "start" | "stop" | "repair",
  payload?: VmCommandPayload
): Promise<Record<string, unknown>> => {
  const teiaRoot = resolveTeiaRoot();
  const python = resolvePythonBin();
  const pyArgs: string[] = ["-u", "-m", "scrapping.browser.vm.cli", commandName];
  if (commandName === "prepare-image" && payload?.imageUrl) {
    pyArgs.push("--image-url", payload.imageUrl);
  }
  if (commandName === "init-image" && Number.isFinite(payload?.sizeGb)) {
    pyArgs.push("--size-gb", String(Math.max(10, Math.trunc(Number(payload?.sizeGb)))));
  }
  if (commandName === "start") {
    if (payload?.isoPath) pyArgs.push("--iso-path", payload.isoPath);
    if (payload?.skipSeed) pyArgs.push("--skip-seed");
  }

  const childEnv = { ...process.env } as NodeJS.ProcessEnv;
  const cpus = Number(payload?.cpus);
  if (Number.isFinite(cpus) && cpus > 0) {
    childEnv.VM_CPUS = String(Math.max(1, Math.min(16, Math.trunc(cpus))));
  }
  const memoryMb = Number(payload?.memoryMb);
  if (Number.isFinite(memoryMb) && memoryMb > 0) {
    childEnv.VM_MEMORY_MB = String(Math.max(1024, Math.min(32768, Math.trunc(memoryMb))));
  }
  const browserProfileDir = toStringOrUndefined(payload?.browserProfileDir);
  if (browserProfileDir) {
    childEnv.VM_BROWSER_PROFILE_DIR = browserProfileDir;
  }
  const browserProfileName = toStringOrUndefined(payload?.browserProfileName);
  if (browserProfileName) {
    childEnv.VM_BROWSER_PROFILE_NAME = browserProfileName;
  }

  const child = spawn(python, pyArgs, {
    cwd: teiaRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
  });
  const code = await new Promise<number>((resolve) => child.on("close", (exitCode) => resolve(exitCode ?? 1)));
  if (code !== 0) {
    throw new Error(`VM command failed (${commandName}, exit=${code}): ${stderr || stdout || "unknown error"}`);
  }
  const text = (stdout || "").trim();
  if (!text) {
    return { state: "error", message: "VM command returned empty output", command: commandName };
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      state: "error",
      message: `VM command returned non-JSON output for ${commandName}`,
      command: commandName,
      output: text
    };
  }
};

const normalizeKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const unifiedRecordToRetrieveRecord = (record: Record<string, unknown>, index: number): RetrieveRecord => {
  const title = toStringOrUndefined(record.title) || "Untitled";
  const yearValue = toNumberOrUndefined(record.year);
  const doi = toStringOrUndefined(record.doi);
  const url = toStringOrUndefined(record.url);
  const source =
    (toStringOrUndefined(record.provider) as RetrieveProviderId | undefined) ||
    (Array.isArray(record.sources) && record.sources.length ? (String(record.sources[0]) as RetrieveProviderId) : undefined) ||
    "cos";
  const authorsRaw = Array.isArray(record.authors) ? record.authors : [];
  const authors = authorsRaw.map((a) => String(a || "").trim()).filter(Boolean);
  const paperId =
    toStringOrUndefined(record.id) ||
    (doi ? `doi:${doi}` : `unified:${normalizeKey(title)}:${yearValue || "na"}:${index}`);
  return {
    title,
    authors,
    year: yearValue,
    doi,
    url,
    venue: toStringOrUndefined(record.journal) || toStringOrUndefined(record.venue),
    journal: toStringOrUndefined(record.journal),
    abstract: toStringOrUndefined(record.snippet),
    source,
    citationCount: toNumberOrUndefined(record.cited_by),
    paperId,
    ...(toStringOrUndefined(record.pdf_path) ? ({ pdfPath: toStringOrUndefined(record.pdf_path) } as Record<string, unknown>) : {}),
    ...(toStringOrUndefined(record.pdf_url) ? ({ pdfUrl: toStringOrUndefined(record.pdf_url) } as Record<string, unknown>) : {})
  };
};

const deduplicateRecords = (records: RetrieveRecord[]): { deduped: RetrieveRecord[]; duplicates: number } => {
  const map = new Map<string, RetrieveRecord>();
  let duplicates = 0;
  records.forEach((record) => {
    const doiKey = normalizeKey(record.doi || "");
    const titleKey = normalizeKey(record.title || "");
    const yearKey = record.year ? String(record.year) : "";
    const key = doiKey ? `doi:${doiKey}` : `ty:${titleKey}:${yearKey}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, record);
      return;
    }
    duplicates += 1;
    const existingScore = Number(Boolean(existing.doi)) + Number(Boolean(existing.url)) + Number((existing.authors || []).length > 0);
    const nextScore = Number(Boolean(record.doi)) + Number(Boolean(record.url)) + Number((record.authors || []).length > 0);
    if (nextScore > existingScore) {
      map.set(key, record);
    }
  });
  return { deduped: Array.from(map.values()), duplicates };
};

const retrieveRecordToUnified = (record: RetrieveRecord): Record<string, unknown> => ({
  id: record.paperId,
  provider: record.source,
  sources: [record.source],
  title: record.title,
  authors: record.authors || [],
  year: record.year ? String(record.year) : "",
  doi: record.doi || "",
  url: record.url || "",
  journal: (record as any).journal || (record as any).venue || "",
  snippet: record.abstract || "",
  cited_by: typeof record.citationCount === "number" ? record.citationCount : 0,
  pdf_path: toStringOrUndefined((record as unknown as Record<string, unknown>).pdfPath) || "",
  pdf_url: toStringOrUndefined((record as unknown as Record<string, unknown>).pdfUrl) || ""
});

const headerAuthSignature = (headers?: Record<string, unknown>): string => {
  if (!headers) return "";
  const authKeys = ["x-api-key", "x-els-apikey", "x-apikey", "authorization", "X-ApiKey", "X-ELS-APIKey"];
  const pairs: Array<[string, string]> = [];
  Object.entries(headers).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    const key = String(k).trim();
    if (!authKeys.includes(key) && !authKeys.includes(key.toLowerCase())) return;
    pairs.push([key.toLowerCase(), String(v)]);
  });
  if (!pairs.length) return "";
  return JSON.stringify(pairs.sort((a, b) => a[0].localeCompare(b[0])));
};

const executeProviderSearch = async (
  providerId: RetrieveProviderId,
  query: RetrieveQuery
): Promise<ProviderSearchResult> => {
  const spec = getProviderSpec(providerId);
  if (!spec) {
    return { records: [], total: 0 };
  }

  let authSig = "";
  const cached = getCachedResult(providerId, query);
  if (cached) {
    return cached;
  }

  if (spec.mergeSources?.length) {
    const children: Array<{ providerId: RetrieveProviderId; result: ProviderSearchResult }> = [];
    for (const child of spec.mergeSources) {
      try {
        const result = await executeProviderSearch(child, query);
        children.push({ providerId: child, result });
      } catch (error) {
        console.warn("[retrieve_ipc.ts][executeProviderSearch][debug] merge child failed", {
          providerId,
          child,
          error: error instanceof Error ? error.message : String(error)
        });
        children.push({ providerId: child, result: { records: [], total: 0 } });
      }
    }
    const merged = mergeCosResults(children);
    setCachedResult(providerId, query, merged, authSig);
    return merged;
  }

  if (!spec.buildRequest || !spec.parseResponse) {
    return { records: [], total: 0 };
  }

  const request = spec.buildRequest(query);
  if (!request) {
    return { records: [], total: 0 };
  }

  authSig = headerAuthSignature(request.headers as Record<string, unknown> | undefined);
  const cachedWithAuth = getCachedResult(providerId, query, authSig);
  if (cachedWithAuth) {
    return cachedWithAuth;
  }

  await throttle(providerId, spec.rateMs);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(request.url, {
        headers: request.headers ?? {}
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const snippet = bodyText ? bodyText.slice(0, 600) : "";
        console.error("[retrieve_ipc.ts][executeProviderSearch][debug] provider request failed", {
          providerId,
          attempt,
          status: response.status,
          statusText: response.statusText,
          url: request.url,
          hasApiKey: Boolean(
            (request.headers as Record<string, unknown> | undefined)?.["x-api-key"] ||
              (request.headers as Record<string, unknown> | undefined)?.["X-ApiKey"] ||
              (request.headers as Record<string, unknown> | undefined)?.["X-ELS-APIKey"]
          ),
          body: snippet
        });

        if (response.status === 429 && attempt < 2) {
          const retryHeader = response.headers.get("retry-after");
          const retrySeconds = retryHeader ? Number(retryHeader) : NaN;
          const delayMs = Number.isFinite(retrySeconds) ? Math.max(250, retrySeconds * 1000) : 800 * (attempt + 1);
          console.warn("[retrieve_ipc.ts][executeProviderSearch][debug] rate limited, retrying", {
            providerId,
            attempt,
            delayMs
          });
          await sleep(delayMs);
          continue;
        }

        if (providerId === "semantic_scholar" && response.status === 403) {
          throw new Error(
            "Semantic Scholar request was forbidden (403). Add a Semantic Scholar key in Settings → Academic database keys (or set SEMANTIC_API/SEMANTIC_SCHOLAR_API_KEY)."
          );
        }
        if (providerId === "semantic_scholar" && response.status === 429) {
          throw new Error(
            "Semantic Scholar rate-limited this app (429). Add a Semantic Scholar key in Settings → Academic database keys and retry, or wait and try again."
          );
        }

        throw new Error(`Retrieve provider ${providerId} failed (${response.status} ${response.statusText}).`);
      }
      const payload = await response.json();
      const parsed = spec.parseResponse(payload);
      setCachedResult(providerId, query, parsed, authSig);
      return parsed;
    } catch (error) {
      if (attempt < 2) {
        console.warn("[retrieve_ipc.ts][executeProviderSearch][debug] request attempt failed, retrying", {
          providerId,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
        await sleep(600 * (attempt + 1));
        continue;
      }
      console.error("Retrieve provider error", providerId, error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  return { records: [], total: 0 };
};

export const executeRetrieveSearch = async (query: RetrieveQuery): Promise<RetrieveSearchResult> => {
  const provider = query.provider ?? "semantic_scholar";
  const normalized: RetrieveQuery = {
    ...query,
    provider
  };
  const spec = getProviderSpec(provider);
  if (!spec) {
    return { provider, items: [], total: 0 };
  }
  const result = await executeProviderSearch(provider, normalized);
  const filtered = applyRecordFilters(result.records, normalized);
  const limited =
    typeof normalized.limit === "number" && normalized.limit > 0
      ? filtered.slice(0, Math.min(normalized.limit, 1000))
      : filtered;
  return {
    provider,
    items: limited,
    total: result.total,
    nextCursor: result.nextCursor
  };
};

const applyRecordFilters = (records: RetrieveRecord[], query: RetrieveQuery): RetrieveRecord[] => {
  let next = records ?? [];
  if (query.only_doi) {
    next = next.filter((r) => !!r.doi);
  }
  if (query.only_abstract) {
    next = next.filter((r) => !!(r.abstract && r.abstract.trim()));
  }
  if (query.author_contains) {
    const needle = query.author_contains.toLowerCase();
    next = next.filter((r) => (r.authors || []).some((a) => a.toLowerCase().includes(needle)));
  }
  if (query.venue_contains) {
    const needle = query.venue_contains.toLowerCase();
    next = next.filter((r) => {
      const venue = (r as any).venue || (r as any).journal;
      return typeof venue === "string" && venue.toLowerCase().includes(needle);
    });
  }
  return next;
};

export const handleRetrieveCommand = async (
  action: string,
  payload?: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  if (action === "vm_acquire_control") {
    const owner = toStringOrUndefined(payload?.owner) || "panel";
    const acquired = acquireVmLease(owner);
    if (!acquired.ok) return { status: "error", message: acquired.message || "VM control acquire failed." };
    return { status: "ok", lease: vmControlLease };
  }
  if (action === "vm_release_control") {
    const owner = toStringOrUndefined(payload?.owner) || "panel";
    const released = releaseVmLease(owner);
    if (!released.ok) return { status: "error", message: released.message || "VM control release failed." };
    return { status: "ok", lease: vmControlLease };
  }
  if (action === "vm_install_deps") {
    const install = spawn("bash", [
      "-lc",
      "sudo -n apt-get update && sudo -n apt-get install -y qemu-system-x86 qemu-utils cloud-image-utils openssh-client"
    ], {
      cwd: resolveTeiaRoot(),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let out = "";
    let err = "";
    install.stdout.on("data", (c: Buffer | string) => (out += String(c)));
    install.stderr.on("data", (c: Buffer | string) => (err += String(c)));
    const code = await new Promise<number>((resolve) => install.on("close", (exitCode) => resolve(exitCode ?? 1)));
    if (code !== 0) {
      return {
        status: "error",
        message:
          "Automatic dependency install failed (likely sudo password required). Run: sudo apt-get update && sudo apt-get install -y qemu-system-x86 qemu-utils cloud-image-utils openssh-client",
        details: err || out
      };
    }
    const vm = await runVmCli("preflight");
    return { status: "ok", vm };
  }
  if (action === "fetch_from_source") {
    const query = normalizeQuery(payload);
    if (!query.query) {
      return { status: "error", message: "Query text is required" };
    }
    const search = await executeRetrieveSearch(query);
    return {
      status: "ok",
      provider: search.provider,
      items: search.items,
      total: search.total,
      nextCursor: search.nextCursor
    };
  }
  if (action === "run_unified_strategy") {
    const args = normalizeUnifiedStrategyPayload(payload);
    if (!args.query) {
      return { status: "error", message: "Query text is required." };
    }
    const startedAt = Date.now();
    try {
      const lease = acquireVmLease("agent");
      if (!lease.ok) {
        return { status: "error", message: lease.message || "VM is controlled by another owner." };
      }
      let vmStatus: Record<string, unknown> | null = null;
      if (args.vmMode) {
        const preStatus = await runVmCli("status");
        vmStatus = preStatus;
        const preState = String(preStatus?.state || "");
        if (preState === "not_configured") {
          const prepared = await runVmCli("prepare-image");
          vmStatus = prepared;
        }
        const seeded = await runVmCli("seed");
        if (String(seeded?.state || "") === "error") {
          return {
            status: "error",
            message: `VM seed failed: ${String(seeded?.message || "unknown error")}`,
            vm: seeded
          };
        }
        const started = await runVmCli("start", {
          cpus: args.vmCpus,
          memoryMb: args.vmMemoryMb,
          browserProfileName: args.profileName
        });
        vmStatus = started;
        if (String(started?.state || "") !== "running") {
          return {
            status: "error",
            message: `VM start failed: ${String(started?.message || "unknown error")}`,
            vm: started
          };
        }
        if (vmMessageHas(started, "guest_web_service=down") || vmMessageHas(started, "ssh_service=down")) {
          await bootstrapVmGuestServices(started);
          vmStatus = await runVmCli("status");
        }
        if (vmStatus) {
          try {
            const disk = await runVmDiskGuard(vmStatus, { warnThreshold: 80, pruneThreshold: 90, minFreeMb: 2048 });
            if (disk.cleanupApplied || disk.usagePercent >= 80) {
              console.debug(
                `[retrieve_ipc.ts][run_unified_strategy][debug] vm disk guard usage=${disk.usagePercent}% free_mb=${disk.freeMb} cleanup=${disk.cleanupApplied}`
              );
            }
          } catch (guardErr) {
            console.warn(
              "[retrieve_ipc.ts][run_unified_strategy][debug] vm disk guard failed",
              guardErr instanceof Error ? guardErr.message : String(guardErr)
            );
          }
        }
      }
      let bundle:
        | {
            runDir: string;
            mergedPath: string;
            manifestPath: string;
            logs: string[];
          }
        | null = null;
      if (args.vmMode && vmStatus) {
        const maxAttempts = 4;
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            if (attempt > 1) {
              await sleep(4000 * attempt);
              await bootstrapVmGuestServices(vmStatus);
              try {
                await runVmDiskGuard(vmStatus, { warnThreshold: 80, pruneThreshold: 90, minFreeMb: 2048 });
              } catch {
                // best-effort
              }
              vmStatus = await runVmCli("status");
            }
            bundle = await runUnifiedBundleViaVm(args, vmStatus);
            break;
          } catch (error) {
            lastError = error;
            if (!shouldRetryVmBundleError(error) || attempt >= maxAttempts) {
              throw error;
            }
          }
        }
        if (!bundle) {
          throw new Error(`VM bundle failed after retries: ${String((lastError as Error)?.message || lastError || "unknown")}`);
        }
      } else {
        bundle = await runUnifiedBundle(args);
      }
      if (args.vmMode && vmStatus) {
        bundle.logs.unshift(`[vm] state=${String(vmStatus.state || "unknown")} message=${String(vmStatus.message || "")}`);
        if (vmStatus.guest_web_url) bundle.logs.unshift(`[vm] guest_web=${String(vmStatus.guest_web_url)}`);
      }
      let mergedPayload: Record<string, unknown> = {};
      try {
        mergedPayload = JSON.parse(await fs.promises.readFile(bundle.mergedPath, "utf-8")) as Record<string, unknown>;
      } catch {
        mergedPayload = {};
      }
      const browserRecordsRaw = Array.isArray(mergedPayload.records) ? (mergedPayload.records as Array<Record<string, unknown>>) : [];
      const browserRecords = browserRecordsRaw.map((record, idx) => unifiedRecordToRetrieveRecord(record, idx));

      const apiRecords: RetrieveRecord[] = [];
      const apiQuery: RetrieveQuery = {
        query: args.query,
        limit: Math.max(25, Math.min(500, args.maxPages * 20)),
        sort: "relevance"
      };
      if (args.includeSemanticApi) {
        try {
          const semantic = await executeProviderSearch("semantic_scholar", { ...apiQuery, provider: "semantic_scholar" });
          apiRecords.push(...semantic.records);
        } catch (error) {
          bundle.logs.push(`[api] semantic_scholar failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (args.includeCrossrefApi) {
        try {
          const crossref = await executeProviderSearch("crossref", { ...apiQuery, provider: "crossref" });
          apiRecords.push(...crossref.records);
        } catch (error) {
          bundle.logs.push(`[api] crossref failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const all = [...browserRecords, ...apiRecords];
      const dedup = deduplicateRecords(all);
      const pdfInventory = await collectPdfInventory(resolveVmSharedDownloadsDir());
      const missingPdfRecords = dedup.deduped
        .filter((record) => !toStringOrUndefined((record as unknown as Record<string, unknown>).pdfPath))
        .map((record) => ({
          paperId: record.paperId,
          title: record.title,
          source: record.source,
          doi: record.doi || "",
          year: record.year || ""
        }));
      const unifiedJsonPath = path.join(bundle.runDir, "merged_unified.json");
      const unifiedPayload = {
        input_dir: bundle.runDir,
        generated_file: unifiedJsonPath,
        stats: {
          vm_mode: args.vmMode,
          browser_count: browserRecords.length,
          api_count: apiRecords.length,
          merged_count: all.length,
          duplicates_removed: dedup.duplicates,
          deduplicated_count: dedup.deduped.length,
          missing_pdf_count: missingPdfRecords.length,
          pdf_inventory_count: pdfInventory.length,
          elapsed_ms: Date.now() - startedAt
        },
        pdf_inventory: pdfInventory,
        missing_pdf_records: missingPdfRecords,
        records: dedup.deduped.map(retrieveRecordToUnified),
        browser_merged_path: bundle.mergedPath,
        manifest_path: bundle.manifestPath
      };
      await fs.promises.writeFile(unifiedJsonPath, JSON.stringify(unifiedPayload, null, 2), "utf-8");
      let providerSummary: Array<Record<string, unknown>> = [];
      let failedProviders: string[] = [];
      try {
        const manifest = JSON.parse(await fs.promises.readFile(bundle.manifestPath, "utf-8")) as Record<string, unknown>;
        providerSummary = Array.isArray(manifest?.providers) ? (manifest.providers as Array<Record<string, unknown>>) : [];
        failedProviders = providerSummary
          .filter((entry) => String(entry?.status || "").toLowerCase() !== "ok")
          .map((entry) => String(entry?.provider || "").trim())
          .filter(Boolean);
      } catch {
        providerSummary = [];
        failedProviders = [];
      }

      return {
        status: "ok",
        provider: "cos",
        items: dedup.deduped,
        total: dedup.deduped.length,
        vm: vmStatus,
        vmMode: args.vmMode,
        runDir: bundle.runDir,
        mergedPath: bundle.mergedPath,
        unifiedPath: unifiedJsonPath,
        logs: bundle.logs,
        stats: unifiedPayload.stats,
        providerSummary,
        failedProviders
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      releaseVmLease("agent");
    }
  }
  if (action === "vm_status") {
    try {
      const result = await runVmCli("status");
      return { status: "ok", vm: result };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_preflight") {
    try {
      const result = await runVmCli("preflight");
      return { status: "ok", vm: result };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_prepare_image") {
    try {
      const args = normalizeVmCommandPayload(payload);
      const result = await runVmCli("prepare-image", args);
      return { status: "ok", vm: result };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_seed") {
    try {
      const result = await runVmCli("seed");
      return { status: "ok", vm: result };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_init_image") {
    try {
      const args = normalizeVmCommandPayload(payload);
      const result = await runVmCli("init-image", args);
      return { status: "ok", vm: result };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_start") {
    try {
      const args = normalizeVmCommandPayload(payload);
      const result = await runVmCli("start", args);
      return { status: "ok", vm: result };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_stop") {
    try {
      const result = await runVmCli("stop");
      return { status: "ok", vm: result };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_repair") {
    try {
      const result = await runVmCli("repair");
      return { status: "ok", vm: result };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_disk_guard") {
    try {
      const vm = await runVmCli("status");
      const report = await runVmDiskGuard(vm, {
        warnThreshold: toNumberOrUndefined(payload?.warnThreshold) ?? 80,
        pruneThreshold: toNumberOrUndefined(payload?.pruneThreshold) ?? 90,
        minFreeMb: toNumberOrUndefined(payload?.minFreeMb) ?? 2048
      });
      return { status: "ok", vm, report };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_list_profiles") {
    try {
      const vm = await runVmCli("status");
      const profiles = await listVmProfiles(vm);
      return { status: "ok", vm, profiles };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "vm_sync_profile") {
    try {
      const vm = await runVmCli("status");
      const sourceDir = toStringOrUndefined(payload?.sourceDir);
      const profileName = toStringOrUndefined(payload?.profileName) || "Default";
      if (!sourceDir) return { status: "error", message: "sourceDir is required." };
      const sync = await syncHostProfileToVm(vm, sourceDir, profileName);
      const profiles = await listVmProfiles(vm);
      return { status: "ok", vm, sync, profiles };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "run_provider_smoke") {
    try {
      return await runProviderSmokeReport(payload);
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_load_zotero") {
    const collectionName = resolveZoteroCollection(payload);
    const collectionKey = toStringOrUndefined(payload?.collectionKey);
    const resolvedTarget = String(collectionKey || collectionName || "");
    const normalizedTarget = normalizeCollectionSelector(resolvedTarget);
    const cache = payload?.cache !== false;
    let credentials: { libraryId: string; libraryType: "user" | "group"; apiKey: string };
    try {
      credentials = resolveZoteroCredentialsTs();
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "Zotero credentials unavailable." };
    }
    if (!normalizedTarget) {
      return { status: "error", message: "Collection key or name is required to load Zotero items." };
    }
    // store last collection as NAME for UI, not key
    try {
      const collections = await listZoteroCollectionsCached(credentials as any, resolveDataHubCacheDir());
      const match = resolveCollectionFromList(collections, resolvedTarget);
      if (!match) {
        return {
          status: "error",
          message: `Collection '${resolvedTarget}' not found.`,
          available: collections.slice(0, 10)
        };
      }
      const cacheDir = resolveDataHubCacheDir();
      const { table, cached } = await fetchZoteroCollectionItems(credentials as any, match.key, undefined, cacheDir, cache);
      setSetting(ZOTERO_KEYS.lastCollection, match.name || match.key);
      ensureDataHubLastMarker({ source: { type: "zotero", collectionName: match.name || match.key } });
      return {
        status: "ok",
        table,
        cached,
        message: cached ? "Loaded from cache." : "Loaded from Zotero.",
        source: { type: "zotero", collectionName: match.name || match.key }
      };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_list_collections") {
    try {
      const creds = resolveZoteroCredentialsTs();
      const collections = await listZoteroCollectionsCached(creds as any, resolveDataHubCacheDir());
      return { status: "ok", collections, profile: { libraryId: creds.libraryId, libraryType: creds.libraryType } };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_zotero_tree") {
    try {
      const creds = resolveZoteroCredentialsTs();
      const cacheDir = resolveDataHubCacheDir();
      const collections = await listZoteroCollectionsCached(creds as any, cacheDir);
      return { status: "ok", collections, profile: { libraryId: creds.libraryId, libraryType: creds.libraryType } };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_zotero_items") {
    const target = toStringOrUndefined(payload?.collectionKey) || toStringOrUndefined(payload?.collectionName);
    if (!target) {
      return { status: "error", message: "collectionKey or collectionName required." };
    }
    try {
      const creds = resolveZoteroCredentialsTs();
      const collections = await listZoteroCollectionsCached(creds as any, resolveDataHubCacheDir());
      const match = resolveCollectionFromList(collections, target);
      if (!match) {
        return { status: "error", message: `Collection '${target}' not found.` };
      }
      const items = await fetchZoteroCollectionItemsPreview(creds as any, match.key);
      return { status: "ok", items, collectionKey: match.key };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_zotero_count") {
    const rawTarget = toStringOrUndefined(payload?.collectionKey);
    const target = normalizeCollectionSelectorStrict(rawTarget);
    if (!target) {
      return { status: "error", message: "collectionKey required." };
    }
    try {
      const creds = resolveZoteroCredentialsTs();
      const count = await fetchZoteroCollectionCount(creds as any, target, resolveDataHubCacheDir());
      return { status: "ok", key: target, count };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_load_zotero_multi") {
    const rawKeys = Array.isArray(payload?.collectionKeys) ? payload.collectionKeys : [];
    const keys = rawKeys.map((entry) => normalizeCollectionSelectorStrict(entry)).filter(Boolean);
    if (!keys.length) {
      return { status: "error", message: "collectionKeys required." };
    }
    try {
      const creds = resolveZoteroCredentialsTs();
      const cacheDir = resolveDataHubCacheDir();
      const cache = payload?.cache !== false;
      const tables: DataHubTable[] = [];
      let cachedAny = false;
      for (const key of keys) {
        const { table, cached } = await fetchZoteroCollectionItems(creds as any, key, undefined, cacheDir, cache);
        if (table) tables.push(table);
        if (cached) cachedAny = true;
      }
      const merged = mergeTables(tables);
      return {
        status: "ok",
        table: merged,
        cached: cachedAny,
        message: cachedAny
          ? `Loaded ${tables.length} collections from cache.`
          : `Loaded ${tables.length} collections from Zotero.`,
        source: { type: "zotero", collectionName: keys.join(",") }
      };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_load_file") {
    let filePath = toStringOrUndefined(payload?.filePath);
    if (!filePath) {
      const result = await dialog.showOpenDialog({
        title: "Load data file",
        properties: ["openFile"],
        filters: [
          { name: "Data Files", extensions: ["csv", "tsv", "xls", "xlsx", "xlsm"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { status: "canceled", message: "File selection canceled." };
      }
      filePath = result.filePaths[0];
    }
    const result = await invokeDataHubLoad({ sourceType: "file", filePath });
    if ((result as Record<string, unknown>)?.status === "error") {
      return result as Record<string, unknown>;
    }
    ensureDataHubLastMarker({ source: { type: "file", path: filePath } });
    return { status: "ok", ...result };
  }
  if (action === "datahub_load_excel") {
    const result = await dialog.showOpenDialog({
      title: "Load Excel file",
      properties: ["openFile"],
      filters: [{ name: "Excel", extensions: ["xls", "xlsx", "xlsm"] }, { name: "All Files", extensions: ["*"] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { status: "canceled", message: "File selection canceled." };
    }
    const filePath = result.filePaths[0];
    const resultLoad = await invokeDataHubLoad({ sourceType: "file", filePath });
    if ((resultLoad as Record<string, unknown>)?.status === "error") {
      return resultLoad as Record<string, unknown>;
    }
    ensureDataHubLastMarker({ source: { type: "file", path: filePath } });
    return { status: "ok", ...resultLoad };
  }
  if (action === "datahub_load_last") {
    const cacheDir = resolveDataHubCacheDir();
    const lastPath = path.join(cacheDir, "last.json");
    if (!fs.existsSync(lastPath)) {
      const fallback = await findMostRecentCachedTable(cacheDir);
      if (fallback) {
        return {
          status: "ok",
          table: fallback.table,
          source: { type: "file", path: fallback.cacheFilePath },
          message: "Loaded last cached table (fallback)."
        };
      }
      return { status: "error", message: "No cached data found.", cacheDir };
    }
    let last: Record<string, unknown> | undefined;
    try {
      last = JSON.parse(fs.readFileSync(lastPath, "utf-8")) as Record<string, unknown>;
    } catch (error) {
      return {
        status: "error",
        message: `Failed to read cache marker: ${error instanceof Error ? error.message : String(error)}`,
        cacheDir
      };
    }
    // Prefer loading the cached table directly when available (fast + does not require original file/network).
    const cachePath = toStringOrUndefined(last?.cachePath);
    if (cachePath && fs.existsSync(cachePath)) {
      try {
        const raw = await fs.promises.readFile(cachePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const table = (parsed as any)?.table as DataHubTable | undefined;
        if (table && Array.isArray((table as any).columns) && Array.isArray((table as any).rows)) {
          return { status: "ok", table, source: (last?.source as any) ?? undefined, last };
        }
      } catch {
        // fall back to re-loading from source below
      }
    }
    const source = (last?.source ?? {}) as Record<string, unknown>;
    const sourceType = toStringOrUndefined(source.type);
    if (sourceType === "file") {
      const filePath = toStringOrUndefined(source.path);
      if (!filePath) {
        return { status: "error", message: "Cached source is missing file path.", cacheDir, last };
      }
      const result = await invokeDataHubLoad({ sourceType: "file", filePath, cacheDir, cache: true });
      if ((result as Record<string, unknown>)?.status === "error") {
        return result as Record<string, unknown>;
      }
      return { status: "ok", ...result, last };
    }
    if (sourceType === "zotero") {
      const collectionName = toStringOrUndefined(source.collectionName) ?? "";
      let credentials: { libraryId: string; libraryType: string; apiKey: string };
      try {
        credentials = resolveZoteroCredentials();
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : "Zotero credentials unavailable." };
      }
      const result = await invokeDataHubLoad({
        sourceType: "zotero",
        collectionName,
        zotero: credentials,
        cacheDir,
        cache: true
      });
      if ((result as Record<string, unknown>)?.status === "error") {
        return result as Record<string, unknown>;
      }
      return { status: "ok", ...result, last };
    }
    return { status: "error", message: `Unknown cached source type '${sourceType ?? ""}'.`, cacheDir, last };
  }
  if (action === "datahub_export_csv") {
    const table = ensureTablePayload(payload);
    let filePath = toStringOrUndefined(payload?.filePath);
    if (!filePath) {
      const result = await dialog.showSaveDialog({
        title: "Export CSV",
        defaultPath: path.join(process.cwd(), "data-hub-export.csv"),
        filters: [{ name: "CSV", extensions: ["csv"] }]
      });
      if (result.canceled || !result.filePath) {
        return { status: "canceled", message: "Export canceled." };
      }
      filePath = result.filePath;
    }
    const csv = stringifyCsv(table);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, csv, "utf-8");
    return { status: "ok", message: `Exported ${table.rows.length} rows.`, path: filePath };
  }
  if (action === "datahub_export_excel") {
    const table = ensureTablePayload(payload);
    let filePath = toStringOrUndefined(payload?.filePath);
    if (!filePath) {
      const result = await dialog.showSaveDialog({
        title: "Export Excel",
        defaultPath: path.join(process.cwd(), "data-hub-export.xlsx"),
        filters: [{ name: "Excel", extensions: ["xlsx"] }]
      });
      if (result.canceled || !result.filePath) {
        return { status: "canceled", message: "Export canceled." };
      }
      filePath = result.filePath;
    }
    const result = await invokeDataHubExportExcel({ filePath, table });
    if ((result as Record<string, unknown>)?.status === "error") {
      return result as Record<string, unknown>;
    }
    return { status: "ok", ...result };
  }
  if (action === "datahub_clear_cache") {
    const collectionName = toStringOrUndefined(payload?.collectionName);
    const cacheRoot = path.join(app.getPath("userData"), "data-hub-cache");
    if (collectionName) {
      const target = path.join(cacheRoot, collectionName);
      if (!fs.existsSync(target)) {
        return { status: "ok", message: "No cache found for the selected collection." };
      }
      fs.rmSync(target, { recursive: true, force: true });
      return { status: "ok", message: `Cleared cache for ${collectionName}.` };
    }
    if (!fs.existsSync(cacheRoot)) {
      return { status: "ok", message: "No cache directory found." };
    }
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    return { status: "ok", message: "Cleared data hub cache." };
  }
  if (action === "datahub_resolve_na") {
    const table = ensureTablePayload(payload);
    const columns = Array.isArray(payload?.columns) ? (payload?.columns as string[]) : undefined;
    const replacement = toStringOrUndefined(payload?.replacement) ?? "Unknown";
    const result = resolveNaTable(table, columns, replacement);
    return {
      status: "ok",
      table: result.table,
      message: `Replaced ${result.replaced} empty values.`
    };
  }
  if (action === "datahub_codebook") {
    const table = ensureTablePayload(payload);
    const columns = payload?.columns as string[] | undefined;
    if (!columns || columns.length === 0) {
      return { status: "error", message: "Provide a list of columns for the codebook." };
    }
    const filtered = filterColumns(table, columns);
    return { status: "ok", table: filtered, message: `Applied codebook (${columns.length} columns).` };
  }
  if (action === "datahub_codes") {
    const table = ensureTablePayload(payload);
    const columns = payload?.columns as string[] | undefined;
    if (!columns || columns.length === 0) {
      return { status: "error", message: "Provide coding columns to display." };
    }
    const filtered = filterColumns(table, columns);
    return { status: "ok", table: filtered, message: `Applied coding columns (${columns.length}).` };
  }
  return { status: "ok" };
};

export const registerRetrieveIpcHandlers = (options: { search?: (query: RetrieveQuery) => Promise<RetrieveSearchResult> } = {}): void => {
  const searchImpl = options.search ?? ((query: RetrieveQuery) => executeRetrieveSearch(query));
  ipcMain.handle("retrieve:search", async (_event, query: RetrieveQuery) => searchImpl(query));
  ipcMain.handle("retrieve:tags:list", (_event, paperId: string) => listTagsForPaper(paperId));
  ipcMain.handle("retrieve:tags:add", (_event, payload: { paper: RetrievePaperSnapshot; tag: string }) =>
    addTagToPaper(payload.paper, payload.tag)
  );
  ipcMain.handle("retrieve:tags:remove", (_event, payload: { paperId: string; tag: string }) =>
    removeTagFromPaper(payload.paperId, payload.tag)
  );
  ipcMain.handle("retrieve:citation-network", (_event, payload: RetrieveCitationNetworkRequest): RetrieveCitationNetwork => {
    if (!payload?.record?.paperId) {
      throw new Error("Citation network request missing record.");
    }
    return buildCitationNetwork(payload.record);
  });
  ipcMain.handle("retrieve:snowball", async (_event, payload: RetrieveSnowballRequest) => {
    if (!payload?.record) {
      throw new Error("Snowball request missing record.");
    }
    return await fetchSemanticSnowball(payload.record, payload.direction);
  });
  ipcMain.handle("retrieve:oa", async (_event, payload: { doi?: string }) => {
    const doi = (payload?.doi || "").trim();
    if (!doi) {
      throw new Error("OA lookup requires a DOI.");
    }
    const email = getUnpaywallEmail();
    if (!email) {
      throw new Error("UNPAYWALL_EMAIL is not configured in .env or settings.");
    }
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`;
    const res = await fetch(`${url}?email=${encodeURIComponent(email)}`);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Unpaywall HTTP ${res.status}: ${txt.slice(0, 120)}`);
    }
    const json = (await res.json()) as any;
    const best = json?.best_oa_location;
    const oaUrl = best?.url_for_pdf || best?.url || json?.oa_locations?.[0]?.url_for_pdf || json?.oa_locations?.[0]?.url;
    const status = json?.is_oa ? "open" : "closed";
    const license = best?.license || json?.license;
    return { status, url: oaUrl, license };
  });
  ipcMain.handle("retrieve:library:save", async (_event, payload: { record: RetrieveRecord }) => {
    if (!payload?.record) {
      throw new Error("Save request missing record.");
    }
    // Reuse tags_db to persist minimal snapshot + tags table; store JSON for now.
    const snapshot: RetrievePaperSnapshot = {
      paperId: payload.record.paperId,
      title: payload.record.title,
      doi: payload.record.doi,
      url: payload.record.url,
      source: payload.record.source,
      year: payload.record.year
    };
    addTagToPaper(snapshot, "__saved__");
    const base = getAppDataPath();
    const outDir = path.join(base, "retrieve", "library");
    fs.mkdirSync(outDir, { recursive: true });
    const fileName = `${snapshot.paperId || snapshot.doi || "record"}.json`.replace(/[\\/:]+/g, "_");
    fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(payload.record, null, 2), "utf-8");
    return { status: "ok", message: "Saved to library cache." };
  });
  ipcMain.handle(
    "retrieve:export",
    async (_event, payload: { rows: RetrieveRecord[]; format: "csv" | "xlsx" | "ris"; targetPath?: string }) => {
      if (!payload?.rows || !Array.isArray(payload.rows) || payload.rows.length === 0) {
        throw new Error("Export request missing rows.");
      }
      const rows = payload.rows;
      const format = payload.format;
      const defaultDir = path.join(getAppDataPath(), "retrieve", "exports");
      fs.mkdirSync(defaultDir, { recursive: true });
      const fallbackName = `export-${Date.now()}.${format === "xlsx" ? "csv" : format}`;
      const target = payload.targetPath && payload.targetPath.trim() ? payload.targetPath : path.join(defaultDir, fallbackName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (format === "csv") {
        const cols = ["title", "authors", "year", "venue", "doi", "url", "source", "abstract"];
        const escape = (v: unknown) => {
          if (v === null || v === undefined) return "";
          const s = String(Array.isArray(v) ? v.join("; ") : v);
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const lines = [cols.join(",")];
        rows.forEach((r) => lines.push(cols.map((c) => escape((r as any)[c])).join(",")));
        fs.writeFileSync(target, lines.join("\n"), "utf-8");
      } else if (format === "ris") {
        const toRis = (r: RetrieveRecord) => {
          const lines: string[] = ["TY  - JOUR"];
          if (r.title) lines.push(`TI  - ${r.title}`);
          if (r.authors) r.authors.forEach((a) => lines.push(`AU  - ${a}`));
          if (r.year) lines.push(`PY  - ${r.year}`);
          const venue = (r as any).venue ?? (r as any).journal;
          if (venue) lines.push(`JO  - ${venue}`);
          if (r.doi) lines.push(`DO  - ${r.doi}`);
          if (r.url) lines.push(`UR  - ${r.url}`);
          if (r.abstract) lines.push(`AB  - ${r.abstract}`);
          lines.push("ER  - ");
          return lines.join("\n");
        };
        fs.writeFileSync(target, rows.map(toRis).join("\n"), "utf-8");
      } else if (format === "xlsx") {
        const zip = new AdmZip();
        const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ROWS_PLACEHOLDER
  </sheetData>
</worksheet>`;
        const cols = ["title", "authors", "year", "venue", "doi", "url", "source", "abstract"];
        const esc = (v: unknown) => {
          if (v === null || v === undefined) return "";
          const s = String(Array.isArray(v) ? v.join("; ") : v);
          return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        };
        const rowsXml: string[] = [];
        const row = (idx: number, cells: string[]) =>
          `<row r="${idx}">${cells
            .map(
              (val, i) =>
                `<c r="${String.fromCharCode(65 + i)}${idx}" t="inlineStr"><is><t>${val}</t></is></c>`
            )
            .join("")}</row>`;
        rowsXml.push(row(1, cols.map((c) => esc(c))));
        rows.forEach((r, i) => rowsXml.push(row(i + 2, cols.map((c) => esc((r as any)[c])))));
        const sheetXml = workbook.replace("ROWS_PLACEHOLDER", rowsXml.join(""));
        zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml, "utf8"));
        zip.addFile(
          "[Content_Types].xml",
          Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`,
            "utf8"
          )
        );
        zip.addFile(
          "xl/workbook.xml",
          Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets>
    <sheet name="results" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
            "utf8"
          )
        );
        zip.addFile(
          "_rels/.rels",
          Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
            "utf8"
          )
        );
        zip.addFile(
          "xl/_rels/workbook.xml.rels",
          Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
            "utf8"
          )
        );
        zip.writeZip(target);
      }
      return { status: "ok", message: `Exported ${rows.length} rows to ${target}` };
    }
  );
};
