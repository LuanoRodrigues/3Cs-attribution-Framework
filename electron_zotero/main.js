const { app, BrowserWindow, ipcMain, shell, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const dotenv = require("dotenv");
const { WindowRegistry } = require("./main/windows/windowRegistry");
const { createReaderWindow } = require("./main/windows/readerWindow");
const { buildAppMenu } = require("./main/menu/buildMenu");
const { registerShortcuts, unregisterShortcuts } = require("./main/shortcuts/shortcutRegistry");
const { registerVoiceIpc } = require("./main/ipc/voiceIpc");
const localDb = require("./main/db/connection");
const { SyncEngine } = require("./main/sync/syncEngine");
const { createZoteroAgentRegistry } = require("./main/agent/registry");
const { groupedFeatures, getFeatureByFunctionName } = require("./main/featureRegistry");
const { FeatureWorker } = require("./main/featureWorker");

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const DEFAULT_LIMIT = 100;
const CACHE_TTL_MS = {
  collections: 0,
  items: 0,
  children: 0
};
const MAX_MEMORY_ENTRIES = {
  items: 24,
  children: 96,
  fullItems: 12
};
const AGENT_MAX_SCAN_ITEMS = 2500;
const INTENT_CLASSIFIER_MODEL = "gpt-5-mini";
const INTENT_LLM_MODEL = "gpt-5-mini";
const ZOTERO_HTTP_TIMEOUT_MS = 25 * 1000;
const COLLECTION_KEY_RE = /^[A-Za-z0-9]{8}$/;
const OPENAI_BATCH_SYNC_COOLDOWN_MS = 15 * 1000;
const OPENAI_POSTPROCESS_STALE_MS = 2 * 60 * 1000;
const OPENAI_POSTPROCESS_TIMEOUT_MS = 20 * 60 * 1000;

const memoryCache = {
  collections: null,
  items: new Map(),
  children: new Map(),
  fullItems: new Map()
};

const inFlight = {
  collections: null,
  items: new Map(),
  children: new Map(),
  fullItems: new Map()
};
const windows = new WindowRegistry();
let syncEngine = null;
let zoteroSignatures = null;
const featureWorker = new FeatureWorker();
const featureJobs = [];
const featureJobMap = new Map();
let featureJobSeq = 1;
let activeFeatureJob = null;
let lastOpenAIBatchesSyncAt = 0;
let openAIBatchReconcileInFlight = false;
let openAIBatchReconcileTimer = null;
let lastWorkflowContext = {
  selectedCollectionKey: "",
  selectedCollectionName: ""
};
const intentTelemetry = {
  since: Date.now(),
  requests: 0,
  llmSuccess: 0,
  llmTimeouts: 0,
  llmHttpErrors: 0,
  llmRetries: 0,
  llmRetryableErrors: 0,
  fallbackUsed: 0,
  resolved: 0,
  clarifications: 0,
  workflowIntents: 0,
  featureIntents: 0,
  legacyIntents: 0
};
const dbg = (fn, msg) => console.debug(`[main.js][${fn}][debug] ${msg}`);

function toString(v) {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function nowMs() {
  return Date.now();
}

function isFresh(savedAt, ttlMs) {
  if (!Number.isFinite(Number(ttlMs)) || Number(ttlMs) <= 0) return true;
  const ts = Number(savedAt || 0);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return nowMs() - ts < ttlMs;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sanitizeCacheKey(raw) {
  return encodeURIComponent(String(raw || ""));
}

function itemsInflightKey(collectionKey, maxItems) {
  const k = String(collectionKey || "");
  const m = Number.isFinite(Number(maxItems)) ? Math.floor(Number(maxItems)) : 0;
  return `${k}|${m <= 0 ? 0 : m}`;
}

function bumpIntentTelemetry(key, amount = 1) {
  if (!Object.prototype.hasOwnProperty.call(intentTelemetry, key)) return;
  intentTelemetry[key] = Number(intentTelemetry[key] || 0) + Number(amount || 1);
}

function snapshotIntentTelemetry() {
  return { ...intentTelemetry };
}

function mapOpenAIBatchStatus(status) {
  const s = toString(status).toLowerCase();
  if (["validating", "in_progress", "finalizing", "cancelling"].includes(s)) return "running";
  if (s === "completed") return "completed";
  if (s === "cancelled") return "canceled";
  if (["failed", "expired"].includes(s)) return "failed";
  return "queued";
}

function isTerminalJobStatus(status) {
  return ["completed", "failed", "canceled"].includes(String(status || ""));
}

function recordResolvedIntent(intent) {
  bumpIntentTelemetry("resolved");
  if (intent?.needsClarification) bumpIntentTelemetry("clarifications");
  const id = String(intent?.intentId || "");
  if (id === "workflow.create_subfolder_by_topic") bumpIntentTelemetry("workflowIntents");
  else if (id === "feature.run") bumpIntentTelemetry("featureIntents");
  else if (id === "agent.legacy_command") bumpIntentTelemetry("legacyIntents");
}

function getCredentials() {
  const libraryId =
    toString(process.env.ZOTERO_LIBRARY_ID) ||
    toString(process.env.LIBRARY_ID);
  const libraryType = (
    toString(process.env.ZOTERO_LIBRARY_TYPE) ||
    toString(process.env.LIBRARY_TYPE) ||
    "user"
  ).toLowerCase();
  const apiKey =
    toString(process.env.ZOTERO_API_KEY) ||
    toString(process.env.API_KEY) ||
    toString(process.env.ZOTERO_KEY);

  if (!libraryId) {
    throw new Error("Missing ZOTERO_LIBRARY_ID or LIBRARY_ID in .env");
  }
  if (!apiKey) {
    throw new Error("Missing ZOTERO_API_KEY/API_KEY/ZOTERO_KEY in .env");
  }
  if (!["user", "group"].includes(libraryType)) {
    throw new Error("LIBRARY_TYPE must be 'user' or 'group'.");
  }

  return { libraryId, libraryType, apiKey };
}

function zoteroBase(creds) {
  const typePath = creds.libraryType === "group" ? "groups" : "users";
  return `https://api.zotero.org/${typePath}/${encodeURIComponent(creds.libraryId)}`;
}

function zoteroLibraryPrefix(creds) {
  return creds.libraryType === "group" ? `groups/${creds.libraryId}` : "library";
}

function headers(creds) {
  return {
    Authorization: `Bearer ${creds.apiKey}`,
    "Zotero-API-Version": "3"
  };
}

function writeHeaders(creds) {
  return {
    ...headers(creds),
    "Content-Type": "application/json"
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = ZOTERO_HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || ZOTERO_HTTP_TIMEOUT_MS));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timeout after ${Math.max(1000, Number(timeoutMs) || ZOTERO_HTTP_TIMEOUT_MS)}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function cacheDir() {
  const dir = path.join(app.getPath("userData"), "zotero-cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function featureJobsStatePath() {
  const dir = path.join(app.getPath("userData"), "state");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "feature_jobs.json");
}

function manualOpenAIBatchesPath() {
  return path.join(__dirname, "state", "manual_openai_batches.json");
}

function purgedOpenAIBatchesPath() {
  const dir = path.join(app.getPath("userData"), "state");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "purged_openai_batches.json");
}

function openAIBatchOutputDir() {
  const dir = path.join(app.getPath("userData"), "state", "openai_batch_outputs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function openAIBatchOutputPath(batchId) {
  return path.join(openAIBatchOutputDir(), `${sanitizeCacheKey(batchId)}.jsonl`);
}

function openAIBatchInputMetaPath(batchId) {
  return path.join(openAIBatchOutputDir(), `${sanitizeCacheKey(batchId)}.meta.json`);
}

function writeOpenAIBatchInputMeta(batchId, rows = []) {
  try {
    const safeRows = Array.isArray(rows)
      ? rows
          .map((row) => ({
            key: toString(row?.key || ""),
            title: toString(row?.title || ""),
            abstract: toString(row?.abstract || ""),
            authors: toString(row?.authors || "")
          }))
          .filter((row) => row.key)
      : [];
    writeJson(openAIBatchInputMetaPath(batchId), {
      savedAt: Date.now(),
      batchId: toString(batchId || ""),
      rows: safeRows
    });
  } catch (error) {
    dbg("writeOpenAIBatchInputMeta", `batchId=${batchId} error=${error?.message || "unknown"}`);
  }
}

function readOpenAIBatchInputMeta(batchId) {
  try {
    const payload = readJson(openAIBatchInputMetaPath(batchId));
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    return rows
      .map((row) => ({
        key: toString(row?.key || ""),
        title: toString(row?.title || ""),
        abstract: toString(row?.abstract || ""),
        authors: toString(row?.authors || "")
      }))
      .filter((row) => row.key);
  } catch {
    return [];
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

function readManualOpenAIBatchLinks() {
  try {
    const payload = readJson(manualOpenAIBatchesPath());
    const rows = Array.isArray(payload?.batches) ? payload.batches : [];
    return rows
      .map((row) => ({
        batchId: toString(row?.batchId),
        parentIdentifier: toString(row?.parentIdentifier),
        subfolderName: toString(row?.subfolderName),
        topic: toString(row?.topic),
        confidenceThreshold: Number.isFinite(Number(row?.confidenceThreshold)) ? Number(row.confidenceThreshold) : 0.6,
        maxItems: Number.isFinite(Number(row?.maxItems)) ? Number(row.maxItems) : 0
      }))
      .filter((row) => row.batchId && row.parentIdentifier && row.subfolderName && row.topic);
  } catch {
    return [];
  }
}

function writeManualOpenAIBatchLinks(rows) {
  try {
    const next = Array.isArray(rows) ? rows : [];
    writeJson(manualOpenAIBatchesPath(), { batches: next });
    return true;
  } catch {
    return false;
  }
}

function readPurgedOpenAIBatchesSet() {
  try {
    const payload = readJson(purgedOpenAIBatchesPath());
    const rows = Array.isArray(payload?.batchIds) ? payload.batchIds : [];
    return new Set(rows.map((x) => toString(x)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writePurgedOpenAIBatchesSet(setObj) {
  try {
    const rows = Array.from(setObj || []).map((x) => toString(x)).filter(Boolean);
    writeJson(purgedOpenAIBatchesPath(), { savedAt: nowMs(), batchIds: rows });
    return true;
  } catch {
    return false;
  }
}

function persistFeatureJobsState() {
  try {
    writeJson(featureJobsStatePath(), {
      savedAt: nowMs(),
      featureJobSeq,
      jobs: snapshotFeatureJobs()
    });
  } catch (error) {
    dbg("persistFeatureJobsState", `error message=${error?.message || "unknown"}`);
  }
}

function restoreFeatureJobsState() {
  try {
    const payload = readJson(featureJobsStatePath());
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    featureJobs.length = 0;
    featureJobMap.clear();
    let maxId = 0;
    for (const raw of jobs.slice(-200)) {
      if (!raw || typeof raw !== "object") continue;
      const id = toString(raw.id);
      const functionName = toString(raw.functionName);
      if (!id || !functionName) continue;
      const statusRaw = toString(raw.status).toLowerCase();
      const isExternalOpenAIRunning =
        statusRaw === "running" && raw?.external === true && toString(raw?.openaiBatchId || "").startsWith("batch_");
      const isInterrupted = statusRaw === "running" && !isExternalOpenAIRunning;
      const status = ["queued", "running", "completed", "failed", "canceled"].includes(statusRaw)
        ? (isInterrupted ? "queued" : statusRaw)
        : "failed";
      const job = {
        id,
        functionName,
        status,
        progress: Number.isFinite(Number(raw.progress)) ? Number(raw.progress) : 0,
        phase: toString(raw.phase || ""),
        runnerPayload: raw.runnerPayload && typeof raw.runnerPayload === "object" ? raw.runnerPayload : null,
        openaiBatchId: toString(raw.openaiBatchId || ""),
        external: raw.external === true,
        createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : nowMs(),
        startedAt: status === "queued" ? 0 : (Number.isFinite(Number(raw.startedAt)) ? Number(raw.startedAt) : 0),
        finishedAt:
          status === "completed" || status === "failed" || status === "canceled"
            ? (Number.isFinite(Number(raw.finishedAt)) ? Number(raw.finishedAt) : nowMs())
            : 0,
        error: isInterrupted
          ? "Resumed after app restart."
          : toString(raw.error || ""),
        result: raw.result ?? null
      };
      if (job.status === "queued" && (!job.runnerPayload || typeof job.runnerPayload !== "object")) {
        job.status = "failed";
        job.progress = 100;
        job.finishedAt = nowMs();
        job.error = "Missing runner payload for restored job.";
      }
      featureJobs.push(job);
      featureJobMap.set(job.id, job);
      const m = id.match(/^job_(\d+)$/);
      if (m) maxId = Math.max(maxId, Number(m[1] || 0));
    }
    const seqFromFile = Number(payload?.featureJobSeq || 0);
    featureJobSeq = Math.max(featureJobSeq, maxId + 1, Number.isFinite(seqFromFile) ? seqFromFile : 1);
    if (featureJobs.length) {
      dbg("restoreFeatureJobsState", `restored jobs=${featureJobs.length} nextSeq=${featureJobSeq}`);
    }
  } catch (error) {
    dbg("restoreFeatureJobsState", `error message=${error?.message || "unknown"}`);
  }
}

function pruneMemoryMap(map, maxEntries) {
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) break;
    map.delete(oldestKey);
  }
}

function setMemoryCollections(collections) {
  memoryCache.collections = { savedAt: nowMs(), data: collections };
}

function getMemoryCollections() {
  if (!memoryCache.collections) return null;
  if (!isFresh(memoryCache.collections.savedAt, CACHE_TTL_MS.collections)) return null;
  return memoryCache.collections.data;
}

function setMemoryItems(collectionKey, items) {
  memoryCache.items.delete(collectionKey);
  memoryCache.items.set(collectionKey, { savedAt: nowMs(), data: items, meta: { truncated: false, cap: 0 } });
  pruneMemoryMap(memoryCache.items, MAX_MEMORY_ENTRIES.items);
}

function setMemoryItemsWithMeta(collectionKey, items, meta = {}) {
  memoryCache.items.delete(collectionKey);
  memoryCache.items.set(collectionKey, {
    savedAt: nowMs(),
    data: items,
    meta: {
      truncated: meta?.truncated === true,
      cap: Number.isFinite(Number(meta?.cap)) ? Number(meta.cap) : 0
    }
  });
  pruneMemoryMap(memoryCache.items, MAX_MEMORY_ENTRIES.items);
}

function getMemoryItems(collectionKey) {
  const cached = memoryCache.items.get(collectionKey);
  if (!cached) return null;
  if (!isFresh(cached.savedAt, CACHE_TTL_MS.items)) {
    memoryCache.items.delete(collectionKey);
    return null;
  }
  memoryCache.items.delete(collectionKey);
  memoryCache.items.set(collectionKey, cached);
  return cached.data;
}

function getMemoryItemsMeta(collectionKey) {
  const cached = memoryCache.items.get(collectionKey);
  if (!cached) return null;
  if (!isFresh(cached.savedAt, CACHE_TTL_MS.items)) {
    memoryCache.items.delete(collectionKey);
    return null;
  }
  return cached.meta && typeof cached.meta === "object" ? cached.meta : null;
}

function setMemoryChildren(itemKey, children) {
  memoryCache.children.delete(itemKey);
  memoryCache.children.set(itemKey, { savedAt: nowMs(), data: children });
  pruneMemoryMap(memoryCache.children, MAX_MEMORY_ENTRIES.children);
}

function getMemoryChildren(itemKey) {
  const cached = memoryCache.children.get(itemKey);
  if (!cached) return null;
  if (!isFresh(cached.savedAt, CACHE_TTL_MS.children)) {
    memoryCache.children.delete(itemKey);
    return null;
  }
  memoryCache.children.delete(itemKey);
  memoryCache.children.set(itemKey, cached);
  return cached.data;
}

function setMemoryFullItems(collectionKey, items) {
  memoryCache.fullItems.delete(collectionKey);
  memoryCache.fullItems.set(collectionKey, { savedAt: nowMs(), data: items });
  pruneMemoryMap(memoryCache.fullItems, MAX_MEMORY_ENTRIES.fullItems);
}

function getMemoryFullItems(collectionKey) {
  const cached = memoryCache.fullItems.get(collectionKey);
  if (!cached) return null;
  if (!isFresh(cached.savedAt, CACHE_TTL_MS.items)) {
    memoryCache.fullItems.delete(collectionKey);
    return null;
  }
  memoryCache.fullItems.delete(collectionKey);
  memoryCache.fullItems.set(collectionKey, cached);
  return cached.data;
}

function collectionsCachePath() {
  return path.join(cacheDir(), "collections.json");
}

function itemsCachePath(collectionKey) {
  return path.join(cacheDir(), `items_${sanitizeCacheKey(collectionKey)}.json`);
}

function childrenCachePath(itemKey) {
  return path.join(cacheDir(), `children_${sanitizeCacheKey(itemKey)}.json`);
}

function fullItemsCachePath(collectionKey) {
  return path.join(cacheDir(), `items_full_${sanitizeCacheKey(collectionKey)}.json`);
}

function getDiskCollections() {
  const cached = readJson(collectionsCachePath());
  if (!cached || !Array.isArray(cached.collections)) return null;
  if (!isFresh(cached.savedAt, CACHE_TTL_MS.collections)) return null;
  return cached.collections;
}

function getDiskItems(collectionKey) {
  const cached = readJson(itemsCachePath(collectionKey));
  if (!cached || !Array.isArray(cached.items)) return null;
  if (!isFresh(cached.savedAt, CACHE_TTL_MS.items)) return null;
  return cached.items;
}

function getDiskItemsMeta(collectionKey) {
  const cached = readJson(itemsCachePath(collectionKey));
  if (!cached || !Array.isArray(cached.items)) return null;
  if (!isFresh(cached.savedAt, CACHE_TTL_MS.items)) return null;
  return cached.meta && typeof cached.meta === "object" ? cached.meta : null;
}

function getDiskChildren(itemKey) {
  const cached = readJson(childrenCachePath(itemKey));
  if (!cached || !Array.isArray(cached.children)) return null;
  if (!isFresh(cached.savedAt, CACHE_TTL_MS.children)) return null;
  return cached.children;
}

function getDiskFullItems(collectionKey) {
  const cached = readJson(fullItemsCachePath(collectionKey));
  if (!cached || !Array.isArray(cached.items)) return null;
  if (!isFresh(cached.savedAt, CACHE_TTL_MS.items)) return null;
  return cached.items;
}

function setDiskCollections(collections) {
  writeJson(collectionsCachePath(), { savedAt: nowMs(), collections });
}

function setDiskItems(collectionKey, items) {
  writeJson(itemsCachePath(collectionKey), {
    savedAt: nowMs(),
    collectionKey,
    items,
    meta: { truncated: false, cap: 0 }
  });
}

function setDiskItemsWithMeta(collectionKey, items, meta = {}) {
  writeJson(itemsCachePath(collectionKey), {
    savedAt: nowMs(),
    collectionKey,
    items,
    meta: {
      truncated: meta?.truncated === true,
      cap: Number.isFinite(Number(meta?.cap)) ? Number(meta.cap) : 0
    }
  });
}

function setDiskChildren(itemKey, children) {
  writeJson(childrenCachePath(itemKey), { savedAt: nowMs(), itemKey, children });
}

function setDiskFullItems(collectionKey, items) {
  writeJson(fullItemsCachePath(collectionKey), { savedAt: nowMs(), collectionKey, items });
}

function isCollectionKnownEmpty(collectionKey) {
  const fromMemory = getMemoryCollections();
  const fromDisk = fromMemory ? null : getDiskCollections();
  const collections = Array.isArray(fromMemory) ? fromMemory : Array.isArray(fromDisk) ? fromDisk : [];
  const hit = collections.find((c) => String(c?.key || "") === String(collectionKey || ""));
  return Number(hit?.itemCount) === 0;
}

function searchInCachedItems(query, maxResults = 500) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];

  const dir = cacheDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => name.startsWith("items_") && name.endsWith(".json"));

  const out = [];
  for (const file of files) {
    const payload = readJson(path.join(dir, file));
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    for (const item of rows) {
      const text = `${item?.title || ""} ${item?.authors || ""} ${item?.doi || ""} ${item?.itemType || ""}`.toLowerCase();
      if (!text.includes(q)) continue;
      out.push(item);
      if (out.length >= maxResults) return out;
    }
  }
  return out;
}

function readAllCachedItems() {
  const dir = cacheDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => name.startsWith("items_") && name.endsWith(".json"));
  const byKey = new Map();
  for (const file of files) {
    const payload = readJson(path.join(dir, file));
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    rows.forEach((row) => {
      const key = toString(row?.key);
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, row);
    });
  }
  return Array.from(byKey.values());
}

function computeTagFacets(items, limit = 250) {
  const counts = new Map();
  items.forEach((item) => {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    const seen = new Set();
    tags.forEach((tag) => {
      const clean = toString(tag);
      if (!clean) return;
      const folded = clean.toLowerCase();
      if (seen.has(folded)) return;
      seen.add(folded);
      counts.set(clean, (counts.get(clean) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, Math.max(1, Number(limit) || 250))
    .map(([tag, count]) => ({ tag, count }));
}

function filterItemsByTags(items, rawTags, mode = "all", limit = 5000) {
  const tags = Array.isArray(rawTags)
    ? rawTags.map((tag) => toString(tag).toLowerCase()).filter(Boolean)
    : [];
  if (!tags.length) return items.slice(0, Math.max(1, Number(limit) || 5000));
  const allMode = mode !== "any";
  const out = [];
  for (const item of items) {
    const itemTags = new Set(
      (Array.isArray(item?.tags) ? item.tags : [])
        .map((tag) => toString(tag).toLowerCase())
        .filter(Boolean)
    );
    const match = allMode ? tags.every((tag) => itemTags.has(tag)) : tags.some((tag) => itemTags.has(tag));
    if (!match) continue;
    out.push(item);
    if (out.length >= Math.max(1, Number(limit) || 5000)) break;
  }
  return out;
}

function runPythonFeature(payload) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, "main", "py", "run_zotero_feature.py");
    const pythonCmd = process.env.PYTHON_BIN || "python3";
    const child = spawn(pythonCmd, [scriptPath, JSON.stringify(payload)], {
      cwd: path.join(__dirname, ".."),
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (buf) => {
      stdout += String(buf || "");
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf || "");
    });

    child.on("error", (error) => {
      resolve({ status: "error", message: error.message || "Failed to start python runner." });
    });

    child.on("close", (code) => {
      const raw = stdout.trim();
      if (!raw) {
        resolve({
          status: "error",
          message: `Feature runner produced no output (code ${code}).`,
          stderr: stderr.trim()
        });
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (code !== 0 && parsed?.status !== "error") {
          resolve({
            status: "error",
            message: `Feature runner exited with code ${code}.`,
            runner: parsed,
            stderr: stderr.trim()
          });
          return;
        }
        resolve({
          ...parsed,
          stderr: stderr.trim()
        });
      } catch {
        resolve({
          status: "error",
          message: "Feature runner returned non-JSON output.",
          stdout: raw.slice(0, 5000),
          stderr: stderr.trim(),
          code
        });
      }
    });
  });
}

function runPythonTopicClassifier(payload) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, "main", "py", "classify_topic_batch.py");
    const pythonCmd = process.env.PYTHON_BIN || "python3";
    const child = spawn(pythonCmd, [scriptPath], {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (buf) => {
      stdout += String(buf || "");
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf || "");
    });
    child.on("error", (error) => {
      resolve({ status: "error", message: error.message || "Failed to start topic classifier." });
    });
    child.on("close", (code) => {
      const raw = String(stdout || "").trim();
      if (!raw) {
        resolve({
          status: "error",
          message: `Topic classifier produced no output (code ${code}).`,
          stderr: String(stderr || "").trim()
        });
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (code !== 0 && parsed?.status !== "error") {
          resolve({
            status: "error",
            message: `Topic classifier exited with code ${code}.`,
            runner: parsed,
            stderr: String(stderr || "").trim()
          });
          return;
        }
        resolve({
          ...parsed,
          stderr: String(stderr || "").trim()
        });
      } catch {
        resolve({
          status: "error",
          message: "Topic classifier returned non-JSON output.",
          stdout: raw.slice(0, 6000),
          stderr: String(stderr || "").trim(),
          code
        });
      }
    });

    try {
      child.stdin.write(JSON.stringify(payload || {}));
      child.stdin.end();
    } catch (error) {
      resolve({ status: "error", message: error.message || "Failed to write payload to topic classifier." });
    }
  });
}

async function loadZoteroSignatures() {
  if (zoteroSignatures) return zoteroSignatures;
  const scriptPath = path.join(__dirname, "main", "py", "get_zotero_signatures.py");
  const pythonCmd = process.env.PYTHON_BIN || "python3";
  const result = await new Promise((resolve) => {
    const child = spawn(pythonCmd, [scriptPath], {
      cwd: path.join(__dirname, ".."),
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      stdout += String(buf || "");
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf || "");
    });
    child.on("error", (error) => {
      resolve({ status: "error", message: error.message });
    });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(String(stdout || "").trim() || "{}");
        resolve({ ...parsed, stderr: stderr.trim() });
      } catch {
        resolve({ status: "error", message: "Invalid signatures output.", stderr: stderr.trim() });
      }
    });
  });
  if (result?.status === "ok") {
    zoteroSignatures = result.signatures || {};
    return zoteroSignatures;
  }
  zoteroSignatures = {};
  return zoteroSignatures;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "")
    .replace(/[.!,;:)\]]+$/g, "")
    .trim();
}

function normalizeCollectionIdentifier(context = {}) {
  const candidateName = cleanIdentifier(context?.selectedCollectionName || "");
  const candidateKey = cleanIdentifier(context?.selectedCollectionKey || "");
  if (candidateName) return candidateName;
  if (COLLECTION_KEY_RE.test(candidateKey)) return candidateKey;
  return "";
}

function extractCollectionIdentifierFromText(raw) {
  const text = cleanIdentifier(raw || "");
  const match = text.match(/(?:\bcollection\b|\bkey\b)\s+(?:is\s+|:?\s+)?([A-Za-z0-9]{8})(?:\b|$)/i);
  return String(match?.[1] || "").trim();
}

function cleanVerbatimDirCandidate(value) {
  return String(value || "").trim();
}

function isBlankDirBase(value) {
  const normalized = cleanVerbatimDirCandidate(value);
  return !normalized || normalized === "./running_tests";
}

function resolveVerbatimAnalyseDirBase() {
  const configured = toString(process.env.ZOTERO_ANALYSE_DIR) || toString(process.env.ANALYSE_DIR);
  if (configured) return configured;
  const home = process.env.HOME || process.env.USERPROFILE;
  return home ? path.join(home, "annotarium", "analyse", "frameworks") : "./running_tests";
}

function slugVerbatimDirName(value) {
  const slug = String(value || "")
    .trim()
    .replace(/[\\\/]/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return slug;
}

function resolveVerbatimDirBase(context = {}) {
  const fallback = resolveVerbatimAnalyseDirBase();
  const candidates = [
    "selectedAnalyseRunPath",
    "analyseRunPath",
    "runPath",
    "activeRunPath",
    "selectedRunPath",
    "selectedAnalysePath",
    "selectedAnalyseBaseDir",
    "analysisBaseDir",
    "analyseBaseDir",
    "baseDir",
    "dir_base"
  ];
  for (const key of candidates) {
    const value = cleanVerbatimDirCandidate(context?.[key]);
    if (!isBlankDirBase(value)) {
      return value;
    }
  }

  const collectionName = normalizeCollectionIdentifier(context);
  if (collectionName) {
    const slug = slugVerbatimDirName(collectionName);
    if (slug) {
      return path.join(fallback, slug);
    }
  }

  return fallback;
}

function normalizeVerbatimFeatureContext(functionName, argsValues = {}, context = {}) {
  if (String(functionName || "") !== "Verbatim_Evidence_Coding") return {};
  const merged = {};
  const selectedCollectionName = cleanVerbatimDirCandidate(
    toString(context?.selectedCollectionName || context?.selectedCollectionKey || argsValues?.collection_name || context?.collection_name)
  );
  if (selectedCollectionName) merged.selectedCollectionName = selectedCollectionName;
  const selectedCollectionKey = cleanVerbatimDirCandidate(
    toString(context?.selectedCollectionKey || argsValues?.collection_key || context?.collection_key)
  );
  if (selectedCollectionKey) merged.selectedCollectionKey = selectedCollectionKey;
  return merged;
}

function applyVerbatimDirBase(functionName, argsValues = {}, context = {}) {
  if (String(functionName || "") !== "Verbatim_Evidence_Coding") return argsValues;
  const next = argsValues && typeof argsValues === "object" ? { ...argsValues } : {};
  const current = cleanVerbatimDirCandidate(next?.dir_base);
  if (!isBlankDirBase(current)) return next;
  const resolvedContext = {
    ...context,
    ...normalizeVerbatimFeatureContext(functionName, argsValues, context)
  };
  const resolvedDir = resolveVerbatimDirBase(resolvedContext);
  if (resolvedDir === current) return next;
  next.dir_base = resolvedDir;
  return next;
}

function tokenizeIntentText(value) {
  return normalizeName(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean);
}

function buildCollectionIndexes(collections) {
  const byKey = new Map();
  const byName = new Map();
  const byPath = new Map();
  const byParent = new Map();
  const pathCache = new Map();

  collections.forEach((collection) => {
    byKey.set(collection.key, collection);
    const parentKey = collection.parentKey || null;
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey).push(collection);
  });

  const fullPath = (collectionKey) => {
    if (pathCache.has(collectionKey)) return pathCache.get(collectionKey);
    const collection = byKey.get(collectionKey);
    if (!collection) return "";
    const own = collection.name || collection.key;
    if (!collection.parentKey || !byKey.has(collection.parentKey)) {
      pathCache.set(collectionKey, own);
      return own;
    }
    const computed = `${fullPath(collection.parentKey)}/${own}`;
    pathCache.set(collectionKey, computed);
    return computed;
  };

  collections.forEach((collection) => {
    const normalizedName = normalizeName(collection.name);
    const normalizedPath = normalizeName(fullPath(collection.key));
    if (!byName.has(normalizedName)) byName.set(normalizedName, []);
    byName.get(normalizedName).push(collection);
    byPath.set(normalizedPath, collection);
    collection.fullPath = fullPath(collection.key);
  });

  return { byKey, byName, byPath, byParent };
}

function resolveCollectionIdentifier(identifier, indexes) {
  const raw = cleanIdentifier(identifier);
  const normalized = normalizeName(raw);
  if (!normalized) return { ok: false, message: "Empty collection identifier." };

  if (indexes.byKey.has(raw)) return { ok: true, collection: indexes.byKey.get(raw) };
  if (indexes.byPath.has(normalized)) return { ok: true, collection: indexes.byPath.get(normalized) };

  const byName = indexes.byName.get(normalized) || [];
  if (byName.length === 1) {
    return { ok: true, collection: byName[0] };
  }
  if (byName.length > 1) {
    return {
      ok: false,
      message: `Collection name '${identifier}' is ambiguous. Use full path.`,
      choices: byName.map((collection) => `${collection.fullPath} [${collection.key}]`)
    };
  }
  return { ok: false, message: `Collection not found: ${identifier}` };
}

function parseCreateSubfolderTopicIntent(text, context = {}) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  const low = normalized.toLowerCase();
  if (!normalized) return null;

  const hasActionVerb = /\b(create|make|build|add|read|scan|process|filter|retrieve|get|find|extract|keep|select)\b/i.test(
    normalized
  );
  const hasCorpusTarget = /\b(items?|articles?|documents?|papers?|records?|sources?)\b/i.test(normalized);
  const hasTopicCue = /\b(talking about|about|topic|theme|subject|related to|regarding|concerning)\b/i.test(normalized);
  const hasSubfolderCue = /\b(subfolder|subcollection|folder)\b/i.test(normalized);
  const looksLikeTopicWorkflow =
    (hasActionVerb && (hasCorpusTarget || hasTopicCue)) || (hasSubfolderCue && hasActionVerb);
  if (!looksLikeTopicWorkflow) return null;

  const parentMatch =
    normalized.match(
      /(?:inside|under|within|in)\s+(?:active|current|selected)?\s*(?:folder|collection)\s+["“]?([^,"”]+?)["”]?(?=(?:,|\s+(?:with|having|for|that|where)\b|$))/i
    ) ||
    normalized.match(
      /(?:inside|under|within|in)\s+(?:folder|collection)\s+["“]?([^,"”]+?)["”]?(?=(?:,|\s+(?:with|having|for|that|where)\b|$))/i
    );
  const parentIdentifier = cleanIdentifier(
    parentMatch?.[1] || context?.selectedCollectionKey || context?.selectedCollectionName || ""
  );

  const subfolderMatch =
    normalized.match(
      /(?:subfolder|subcollection|folder)(?:\s+(?:entitled|called|named))?\s+["“]?([^"”.,]+?)["”]?(?=(?:\s+(?:inside|under|within|in)\b|\s+(?:and|to|for|that|where)\b|,|$))/i
    ) ||
    normalized.match(
      /\bcreate\s+(?:a\s+)?(?:subfolder|subcollection|folder)\s+["“]?([^"”.,]+?)["”]?(?=(?:\s+(?:inside|under|within|in)\b|\s+(?:and|to|for|that|where)\b|,|$))/i
    );
  const parsedSubfolder = cleanIdentifier(subfolderMatch?.[1] || "");

  const topicMatch =
    normalized.match(/(?:talking about|related to|regarding|concerning)\s+["“]?([^"”]+?)["”]?(?=(?:,|$))/i) ||
    normalized.match(/(?:about|subject|topic|theme)\s+["“]?([^"”]+?)["”]?(?=(?:,|$))/i) ||
    normalized.match(/(?:only|just)\s+(?:those|items?|articles?|documents?|papers?)\s+(?:talking about|about)\s+["“]?([^"”]+?)["”]?/i);

  let topic = cleanIdentifier(topicMatch?.[1] || "");
  if (!topic && /\bframeworks?\b/i.test(low)) {
    topic = /\bcyber attribution\b/i.test(low) ? "frameworks in cyber attribution" : "frameworks";
  }

  const suggestedSubfolder = cleanIdentifier(
    parsedSubfolder ||
      (topic
        ? topic
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 64)
        : "")
  );
  const subfolderName = parsedSubfolder || suggestedSubfolder;

  const clarificationQuestions = [];
  if (!parentIdentifier) {
    clarificationQuestions.push("Which collection should I process?");
  }
  if (!topic) {
    clarificationQuestions.push("What subject/topic should I filter for?");
  }
  if (!parsedSubfolder && topic) {
    clarificationQuestions.push(
      `Can I create a subfolder entitled "${subfolderName || "topic_filtered"}" filtering only articles talking about "${topic}"?`
    );
  }
  const policy = extractTopicClassificationPolicy(normalized, topic);

  return {
    intentId: "workflow.create_subfolder_by_topic",
    targetFunction: "workflow-create-subfolder-by-topic",
    riskLevel: "confirm",
    confidence: clarificationQuestions.length ? 0.64 : 0.9,
    needsClarification: clarificationQuestions.length > 0,
    clarificationQuestions,
    args: {
      parentIdentifier,
      subfolderName,
      topic,
      confidenceThreshold: 0.6,
      maxItems: 0,
      classificationPolicy: policy.classificationPolicy,
      inclusionCriteria: policy.inclusionCriteria,
      maybeCriteria: policy.maybeCriteria,
      exclusionCriteria: policy.exclusionCriteria
    }
  };
}

function parseEligibilityCriteriaIntent(text, context = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  const looksLikeCodingRequest =
    /\b(?:code|coding)\b/.test(low) &&
    (/\bquestions?\b/.test(low) ||
      /\bresearch\s+questions?\b/.test(low) ||
      /\bverbatim_evidence_coding\b/.test(low) ||
      /\bprompt_key\b/.test(low));
  if (looksLikeCodingRequest) return null;
  const looksLikeEligibility =
    /\beligibility\b/.test(low) ||
    /\bscreen(ing)?\b/.test(low) ||
    /\binclusion\b/.test(low) ||
    /\bexclusion\b/.test(low);
  if (!looksLikeEligibility) return null;

  const collectionName = normalizeCollectionIdentifier(context);
  const inclusionMatch =
    raw.match(/(?:inclusion(?:\s+criteria)?\s*[:\-])([\s\S]*?)(?=(?:\n\s*exclusion(?:\s+criteria)?\s*[:\-])|$)/i) ||
    raw.match(/(?:include\s*[:\-])([\s\S]*?)(?=(?:\n\s*exclude\s*[:\-])|$)/i);
  const exclusionMatch =
    raw.match(/(?:exclusion(?:\s+criteria)?\s*[:\-])([\s\S]*?)$/i) ||
    raw.match(/(?:exclude\s*[:\-])([\s\S]*?)$/i);

  const normalizeBlock = (value) =>
    String(value || "")
      .split(/\n+/)
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean)
      .join("\n");

  const inclusion = normalizeBlock(inclusionMatch?.[1] || "");
  const exclusion = normalizeBlock(exclusionMatch?.[1] || "");

  const inclusionLines = inclusion ? inclusion.split("\n").map((x) => x.trim()).filter(Boolean) : [];
  const exclusionLines = exclusion ? exclusion.split("\n").map((x) => x.trim()).filter(Boolean) : [];
  const schemaPreview = createEligibilitySchemaDraft({
    inclusionCriteria: inclusionLines,
    exclusionCriteria: exclusionLines,
    userPrompt: raw
  });
  const validation = validateEligibilitySchemaDraft(schemaPreview, {
    inclusionCriteria: inclusionLines,
    exclusionCriteria: exclusionLines
  });

  const clarificationQuestions = [];
  if (!collectionName) clarificationQuestions.push("Select a collection before setting screening criteria.");
  if (!inclusion) clarificationQuestions.push("Provide `Inclusion criteria:` followed by one or more bullets.");
  if (!exclusion) clarificationQuestions.push("Provide `Exclusion criteria:` followed by one or more bullets.");
  if (!validation.valid) clarificationQuestions.push(...validation.errors.slice(0, 4));

  return {
    intentId: "feature.run",
    targetFunction: "set_eligibility_criteria",
    confidence: clarificationQuestions.length ? 0.72 : 0.93,
    riskLevel: "confirm",
    needsClarification: clarificationQuestions.length > 0,
    clarificationQuestions,
    args: {
      collection_name: collectionName,
      inclusion_criteria: inclusion,
      exclusion_criteria: exclusion,
      eligibility_prompt_key: "paper_screener_abs_policy",
      context: "",
      research_questions: [],
      agent_generate: true,
      schema_preview: schemaPreview,
      schema_json: schemaPreview
    }
  };
}

function createEligibilitySchemaDraft({
  inclusionCriteria = [],
  exclusionCriteria = [],
  userPrompt = ""
} = {}) {
  const inclusion = Array.isArray(inclusionCriteria) ? inclusionCriteria.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const exclusion = Array.isArray(exclusionCriteria) ? exclusionCriteria.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const coderPrompt =
    "You are a rigorous screening coder. Apply inclusion and exclusion criteria exactly. Return valid JSON only.";
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "justification", "inclusion_hits", "exclusion_hits", "eligibility_criteria", "coder_prompt"],
    properties: {
      status: { type: "string", enum: ["include", "exclude", "maybe"] },
      justification: { type: "string", minLength: 8 },
      inclusion_hits: { type: "array", items: { type: "string" } },
      exclusion_hits: { type: "array", items: { type: "string" } },
      eligibility_criteria: {
        type: "object",
        required: ["inclusion", "exclusion"],
        properties: {
          inclusion: { type: "array", items: { type: "string" }, default: inclusion },
          exclusion: { type: "array", items: { type: "string" }, default: exclusion }
        }
      },
      coder_prompt: { type: "string", const: coderPrompt },
      source_user_prompt: { type: "string", default: String(userPrompt || "") }
    }
  };
}

function validateEligibilitySchemaDraft(schemaDraft, { inclusionCriteria = [], exclusionCriteria = [] } = {}) {
  const errors = [];
  if (!schemaDraft || typeof schemaDraft !== "object") errors.push("Schema draft is missing.");
  if (!Array.isArray(schemaDraft?.required) || !schemaDraft.required.includes("status")) errors.push("Schema must require 'status'.");
  if (!Array.isArray(schemaDraft?.required) || !schemaDraft.required.includes("justification")) errors.push("Schema must require 'justification'.");
  const statusEnum = schemaDraft?.properties?.status?.enum;
  if (!Array.isArray(statusEnum) || !["include", "exclude", "maybe"].every((v) => statusEnum.includes(v))) {
    errors.push("Schema status enum must include include/exclude/maybe.");
  }
  const promptConst = schemaDraft?.properties?.coder_prompt?.const;
  if (!String(promptConst || "").trim()) errors.push("Schema must include a coder prompt.");
  if (!Array.isArray(inclusionCriteria) || !inclusionCriteria.length) errors.push("Inclusion criteria is required.");
  if (!Array.isArray(exclusionCriteria) || !exclusionCriteria.length) errors.push("Exclusion criteria is required.");
  return {
    valid: errors.length === 0,
    errors
  };
}

function parseVerbatimCodingIntent(text, context = {}) {
  function extractTopicFromCodingText(input) {
    const rawText = String(input || "").trim();
    const match =
      rawText.match(/(?:questions?\s+about|about|on|regarding|concerning)\s+(.+?)\s*$/i) ||
      rawText.match(/(?:for)\s+(.+?)\s*$/i);
    return cleanIdentifier(match?.[1] || "");
  }

  function generateResearchQuestionsFromTopic(topic) {
    const t = String(topic || "").trim();
    if (!t) return [];
    const normalized = t.replace(/\s+/g, " ").trim();
    const seed = [
      `How is ${normalized} defined and scoped in the study?`,
      `Which models or frameworks are used to analyze ${normalized}?`,
      `What evidence is provided to support claims about ${normalized}?`,
      `What limitations or assumptions are identified in the models/frameworks for ${normalized}?`,
      `What policy or strategic implications are derived from findings on ${normalized}?`
    ];
    const uniq = [];
    seed.forEach((q) => {
      const k = normalizeName(q);
      if (!uniq.some((x) => normalizeName(x) === k)) uniq.push(q);
    });
    return uniq.slice(0, 5);
  }

  const raw = String(text || "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  const screeningRequested =
    /\b(screen|screening|eligibility|inclusion|exclusion)\b/i.test(raw) &&
    !/\b(no screening|without screening|skip screening|screening false|disable screening)\b/i.test(raw);
  const criticalLensRequested = /\bcritical(?:[_\s-]?lens| security studies| perspective)\b/i.test(raw);
  const criticalApproach = inferCriticalApproach(raw);
  const personaProfile = inferPersonaProfile(raw);
  const theoryPreferences = inferTheoryPreferences(raw);
  const screening = screeningRequested;
  const looksLikeCoding =
    /\b(?:code|coding)\b/.test(low) &&
    (/\bquestion\b/.test(low) || /\brq\d*\b/.test(low) || /\babout\b/.test(low) || /\bmodels?\b/.test(low) || /\bframeworks?\b/.test(low));
  if (!looksLikeCoding) return null;

  const lines = raw
    .split(/\n+/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const numbered = lines
    .map((line) => {
      const m = line.match(/^\s*(\d+)[\)\].:\-]\s*(.+)$/);
      return m ? String(m[2] || "").trim() : "";
    })
    .filter(Boolean);

  const fallbackBlockMatch = raw.match(/(?:questions?|research questions?)\s*[:\-]\s*([\s\S]+)$/i);
  const fallbackBlock = String(fallbackBlockMatch?.[1] || "");
  const inlineNumbered = [...fallbackBlock.matchAll(/(?:^|\s)(\d+)[\)\].:\-]\s*([^]+?)(?=(?:\s+\d+[\)\].:\-]\s*)|$)/g)]
    .map((m) => String(m?.[2] || "").trim())
    .filter(Boolean);
  const fallbackQuestions = (inlineNumbered.length ? inlineNumbered : fallbackBlock.split(/[;\n]+/))
    .map((s) => String(s || "").replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);

  const topicHint = extractTopicFromCodingText(raw);
  const generatedQuestions = generateResearchQuestionsFromTopic(topicHint);
  let researchQuestions = numbered.length ? numbered : fallbackQuestions;
  if (!researchQuestions.length && generatedQuestions.length) {
    researchQuestions = generatedQuestions;
  }
  if (researchQuestions.length < 3 && generatedQuestions.length) {
    const merged = [...researchQuestions];
    generatedQuestions.forEach((q) => {
      if (!merged.some((x) => normalizeName(x) === normalizeName(q))) merged.push(q);
    });
    researchQuestions = merged;
  }
  if (researchQuestions.length > 5) researchQuestions = researchQuestions.slice(0, 5);
  const contextMatch = raw.match(/(?:context|background)\s*[:\-]\s*([\s\S]*?)(?=(?:\n\s*(?:questions?|research questions?)\s*[:\-])|$)/i);
  const codingContext = String(contextMatch?.[1] || "").trim();
  const collectionName = normalizeCollectionIdentifier(context) || extractCollectionIdentifierFromText(raw);
  const clarificationQuestions = [];
  if (!collectionName) clarificationQuestions.push("Select a collection before coding.");
  if (!researchQuestions.length) {
    clarificationQuestions.push("Provide research questions as numbered lines, for example: `1. ... 2. ... 3. ...`.");
  }
  if (researchQuestions.length > 0 && researchQuestions.length < 3) {
    clarificationQuestions.push("I need at least 3 research questions. Add more questions or provide a topic to generate them.");
  }
  if (criticalLensRequested && !criticalApproach) {
    clarificationQuestions.push(
      `Critical lens requested. Optional: choose one approach (${CRITICAL_LENS_APPROACHES.join(", ")}), or reply 'no specific approach'.`
    );
  }

  return {
    intentId: "feature.run",
    targetFunction: "Verbatim_Evidence_Coding",
    confidence: clarificationQuestions.length ? 0.7 : 0.92,
    riskLevel: "confirm",
    needsClarification: clarificationQuestions.length > 0,
    clarificationQuestions,
    args: {
      dir_base: resolveVerbatimDirBase(context),
      collection_name: collectionName,
      research_questions: researchQuestions,
      prompt_key: "code_pdf_page",
      context: mergeCodingContext(codingContext, {
        criticalLens: criticalLensRequested,
        criticalApproach,
        personaProfile,
        theoryPreferences
      }),
      screening,
      critical_lens: criticalLensRequested,
      critical_approach: criticalApproach,
      persona_profile: personaProfile,
      theory_preferences: theoryPreferences
    }
  };
}

async function resolveCodingIntentWithLLM(text, context = {}) {
  const apiKey = toString(process.env.OPENAI_API_KEY);
  if (!apiKey) return { status: "error", message: "OPENAI_API_KEY is not configured." };

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["is_coding_request", "confidence", "research_questions", "context", "screening", "needsClarification", "clarificationQuestions"],
    properties: {
      is_coding_request: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      research_questions: {
        type: "array",
        minItems: 0,
        maxItems: 5,
        items: { type: "string" }
      },
      context: { type: "string" },
      screening: { type: "boolean" },
      critical_lens: { type: "boolean" },
      critical_approach: { type: "string" },
      persona_profile: { type: "string" },
      theory_preferences: { type: "array", minItems: 0, maxItems: 8, items: { type: "string" } },
      needsClarification: { type: "boolean" },
      clarificationQuestions: { type: "array", minItems: 0, maxItems: 6, items: { type: "string" } }
    }
  };

  const systemPrompt = [
    "You extract coding intents for a Zotero coding workflow.",
    "If user asks to code/coding their collection/data/literature, set is_coding_request=true.",
    "Return 3 to 5 high-quality research questions focused on the user topic.",
    "Set screening=false by default. Set screening=true only if user explicitly asks to screen/screening/eligibility.",
    "Detect optional critical-lens mode: if user asks for critical lens, set critical_lens=true.",
    `If critical_lens=true and no specific approach is provided, set needsClarification=true and ask an optional follow-up: choose one approach from ${CRITICAL_LENS_APPROACHES.join(", ")}, or proceed with no specific approach.`,
    "If user provides persona/theory preferences, set persona_profile and theory_preferences.",
    "Questions should be suitable for literature review evidence coding.",
    "If topic is unclear, set needsClarification=true and ask concise questions.",
    "Return output only through the tool schema."
  ].join("\n");

  const body = {
    model: INTENT_LLM_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          text: String(text || ""),
          selected_collection_name: toString(context?.selectedCollectionName),
          selected_collection_key: toString(context?.selectedCollectionKey)
        })
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "resolve_coding_intent",
          description: "Resolve coding request into structured research questions.",
          parameters: schema,
          strict: true
        }
      }
    ],
    tool_choice: {
      type: "function",
      function: { name: "resolve_coding_intent" }
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await res.text();
    if (!res.ok) {
      return { status: "error", message: `Coding intent LLM HTTP ${res.status}`, detail: raw.slice(0, 2000) };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: "error", message: "Coding intent LLM returned non-JSON body." };
    }
    const argsText =
      parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
      parsed?.choices?.[0]?.message?.function_call?.arguments ||
      "";
    if (!String(argsText || "").trim()) {
      return { status: "error", message: "Coding intent LLM returned no tool arguments." };
    }
    let toolOut = null;
    try {
      toolOut = JSON.parse(argsText);
    } catch {
      return { status: "error", message: "Coding intent tool arguments are not valid JSON." };
    }
    return { status: "ok", data: toolOut };
  } catch (error) {
    return { status: "error", message: error?.name === "AbortError" ? "Coding intent LLM timeout." : (error?.message || "Coding intent LLM error.") };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAIIntentResolver(text, context, featureCatalog) {
  const apiKey = toString(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    return { status: "error", message: "OPENAI_API_KEY is not configured." };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      intentId: {
        type: "string",
        enum: ["workflow.create_subfolder_by_topic", "feature.run", "agent.legacy_command"]
      },
      targetFunction: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      riskLevel: { type: "string", enum: ["safe", "confirm", "high"] },
      needsClarification: { type: "boolean" },
      clarificationQuestions: {
        type: "array",
        items: { type: "string" },
        minItems: 0,
        maxItems: 6
      },
      args: {
        type: "object",
        additionalProperties: false,
        properties: {
          parentIdentifier: { type: "string" },
          subfolderName: { type: "string" },
          topic: { type: "string" },
          classificationPolicy: { type: "string" },
          inclusionCriteria: { type: "array", items: { type: "string" } },
          maybeCriteria: { type: "array", items: { type: "string" } },
          exclusionCriteria: { type: "array", items: { type: "string" } },
          confidenceThreshold: { type: "number", minimum: 0, maximum: 1 },
          maxItems: { type: "number" },
          collection_name: { type: "string" },
          csv_path: { type: "string" },
          output_folder: { type: "string" },
          Z_collections: { type: "array", items: { type: "string" } },
          text: { type: "string" },
          critical_lens: { type: "boolean" },
          critical_approach: { type: "string" },
          persona_profile: { type: "string" },
          theory_preferences: { type: "array", items: { type: "string" } }
        },
        required: [
          "parentIdentifier",
          "subfolderName",
          "topic",
          "classificationPolicy",
          "inclusionCriteria",
          "maybeCriteria",
          "exclusionCriteria",
          "confidenceThreshold",
          "maxItems",
          "collection_name",
          "csv_path",
          "output_folder",
          "Z_collections",
          "text"
        ]
      }
    },
    required: ["intentId", "targetFunction", "confidence", "riskLevel", "needsClarification", "clarificationQuestions", "args"]
  };

  const guidance = [
    "You are an intent router for Zotero workflows. Always respond by calling the function tool.",
    "Primary workflow: screen items in active/selected collection and organize topic-matching items into a subfolder.",
    "Interpret broad synonyms (create/make/add/build/read/scan/process/filter/retrieve/find/get/extract/select/keep/screen/screening).",
    "Interpret corpus nouns (items/articles/documents/papers/records/sources).",
    "Interpret topic cues (talking about/about/topic/theme/subject/related to/regarding/concerning).",
    "If user asks to screen/filter/read/retrieve documents by subject, choose intentId='workflow.create_subfolder_by_topic'.",
    "For that workflow set args: parentIdentifier, subfolderName, topic, classificationPolicy, inclusionCriteria, maybeCriteria, exclusionCriteria, confidenceThreshold, maxItems.",
    "For topic workflow, make policy strict and generic: infer a focus subject from the user topic, and optional overarching context when phrasing is like 'X related to Z'.",
    "Include only when the focus subject is the paper's main contribution, and if context exists, when the paper explicitly links focus subject to that context.",
    "Allow synonyms/paraphrases only when they clearly map to the focus subject and contribution cues support centrality.",
    "If evidence for central contribution is weak or ambiguous, classify as maybe rather than included.",
    "Absent/non-core/keyword-only matches should be excluded.",
    "Always return all args fields from the schema. Use empty string for non-applicable string fields, [] for list fields (including criteria and Z_collections), and 0 for non-applicable numeric fields.",
    "For full collection processing set maxItems=0.",
    "Use context.selectedCollectionKey as parentIdentifier fallback, else context.selectedCollectionName.",
    "If subfolder name is missing but topic exists, auto-generate subfolderName from topic and set needsClarification=false.",
    "If topic is missing, ask for the topic.",
    "If request maps to known ribbon function, choose intentId='feature.run' with exact targetFunction from available_features.",
    "When targetFunction='Verbatim_Evidence_Coding', optional args may include critical_lens, critical_approach, persona_profile, theory_preferences.",
    `If critical_lens is requested for coding and approach is missing, ask an optional follow-up to choose one from ${CRITICAL_LENS_APPROACHES.join(", ")} or proceed with no specific approach.`,
    "If unclear, choose intentId='agent.legacy_command' with clarification.",
    "Do not invent unavailable feature names."
  ].join("\n");

  const inputPayload = {
    user_text: String(text || ""),
    context: {
      selectedCollectionKey: toString(context?.selectedCollectionKey),
      selectedCollectionName: toString(context?.selectedCollectionName)
    },
    available_features: featureCatalog
  };

  const body = {
    model: INTENT_LLM_MODEL,
    messages: [
      { role: "system", content: guidance },
      { role: "user", content: JSON.stringify(inputPayload) }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "resolve_intent",
          description: "Resolve user text into a structured intent for Zotero execution.",
          parameters: schema,
          strict: true
        }
      }
    ],
    tool_choice: {
      type: "function",
      function: { name: "resolve_intent" }
    }
  };

  const requestOnce = async (timeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const rawText = await res.text();
      if (!res.ok) {
        bumpIntentTelemetry("llmHttpErrors");
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable) bumpIntentTelemetry("llmRetryableErrors");
        return {
          status: "error",
          message: `Intent LLM HTTP ${res.status}`,
          detail: rawText.slice(0, 2000),
          retryable
        };
      }
      let parsed = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return { status: "error", message: "Intent LLM returned non-JSON HTTP body." };
      }

      const argsText =
        parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
        parsed?.choices?.[0]?.message?.function_call?.arguments ||
        "";
      const outText = String(argsText || "").trim();
      if (!outText) return { status: "error", message: "Intent LLM produced no tool arguments." };

      let intent = null;
      try {
        intent = JSON.parse(outText);
      } catch {
        return {
          status: "error",
          message: "Intent LLM tool arguments are not valid JSON.",
          detail: outText.slice(0, 2000)
        };
      }
      return { status: "ok", intent };
    } catch (error) {
      const isTimeout = error?.name === "AbortError";
      if (isTimeout) bumpIntentTelemetry("llmTimeouts");
      return {
        status: "error",
        message: isTimeout ? "Intent LLM timeout." : (error?.message || "Intent LLM error."),
        retryable: isTimeout
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  const attempts = [25000, 35000, 45000];
  let last = null;
  for (let i = 0; i < attempts.length; i += 1) {
    const timeoutMs = attempts[i];
    if (i > 0) bumpIntentTelemetry("llmRetries");
    const out = await requestOnce(timeoutMs);
    if (out?.status === "ok") {
      bumpIntentTelemetry("llmSuccess");
      return out;
    }
    last = out;
    if (!out?.retryable) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 350 + i * 200));
  }
  return last || { status: "error", message: "Intent LLM failed." };
}

async function refineCodingQuestionsWithLLM(payload = {}) {
  const apiKey = toString(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    return { status: "error", message: "OPENAI_API_KEY is not configured." };
  }
  const currentQuestions = Array.isArray(payload?.currentQuestions)
    ? payload.currentQuestions.map((q) => String(q || "").trim()).filter(Boolean)
    : [];
  const feedback = String(payload?.feedback || "").trim();
  const contextText = String(payload?.contextText || "").trim();
  if (!feedback) return { status: "error", message: "feedback is required." };

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: { type: "string", minLength: 8 }
      }
    }
  };

  const body = {
    model: INTENT_LLM_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are helping refine research questions for coding evidence in a literature review. Return only valid JSON via the tool."
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Revise research questions using user feedback. Keep 3 to 5 concise, high-quality questions.",
          current_questions: currentQuestions,
          user_feedback: feedback,
          context: contextText
        })
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "return_questions",
          description: "Return revised research questions.",
          parameters: schema,
          strict: true
        }
      }
    ],
    tool_choice: {
      type: "function",
      function: { name: "return_questions" }
    }
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) {
    return { status: "error", message: `Question refiner HTTP ${res.status}`, detail: raw.slice(0, 2000) };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "error", message: "Question refiner returned non-JSON body." };
  }
  const argsText =
    parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
    parsed?.choices?.[0]?.message?.function_call?.arguments ||
    "";
  if (!String(argsText || "").trim()) {
    return { status: "error", message: "Question refiner returned no tool arguments." };
  }
  let toolOut = null;
  try {
    toolOut = JSON.parse(argsText);
  } catch {
    return { status: "error", message: "Question refiner tool arguments are not valid JSON." };
  }
  const outQuestions = Array.isArray(toolOut?.questions)
    ? toolOut.questions.map((q) => String(q || "").trim()).filter(Boolean).slice(0, 5)
    : [];
  if (outQuestions.length < 3) {
    return { status: "error", message: "Question refiner did not return 3-5 valid questions." };
  }
  return { status: "ok", questions: outQuestions };
}

async function generateEligibilityCriteriaWithLLM(payload = {}) {
  const apiKey = toString(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    return { status: "error", message: "OPENAI_API_KEY is not configured." };
  }

  const userText = String(payload?.userText || "").trim();
  const collectionName = String(payload?.collectionName || "").trim();
  const contextText = String(payload?.contextText || "").trim();
  const researchQuestions = Array.isArray(payload?.researchQuestions)
    ? payload.researchQuestions.map((q) => String(q || "").trim()).filter(Boolean).slice(0, 5)
    : [];

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["inclusion_criteria", "exclusion_criteria"],
    properties: {
      inclusion_criteria: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: { type: "string", minLength: 6 }
      },
      exclusion_criteria: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: { type: "string", minLength: 6 }
      },
      rationale: { type: "string" }
    }
  };

  const body = {
    model: INTENT_LLM_MODEL,
    messages: [
      {
        role: "system",
        content: [
          "You create pragmatic eligibility criteria for literature screening.",
          "Use user goal, research questions, and context.",
          "Return criteria suitable for abstract/title screening in Zotero.",
          "Criteria must be specific, concise, and non-overlapping."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          user_text: userText,
          collection_name: collectionName,
          context: contextText,
          research_questions: researchQuestions
        })
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "return_eligibility",
          description: "Return eligibility inclusion and exclusion criteria.",
          parameters: schema,
          strict: true
        }
      }
    ],
    tool_choice: {
      type: "function",
      function: { name: "return_eligibility" }
    }
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) {
    return { status: "error", message: `Eligibility generator HTTP ${res.status}`, detail: raw.slice(0, 2000) };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "error", message: "Eligibility generator returned non-JSON body." };
  }
  const argsText =
    parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
    parsed?.choices?.[0]?.message?.function_call?.arguments ||
    "";
  if (!String(argsText || "").trim()) {
    return { status: "error", message: "Eligibility generator returned no tool arguments." };
  }
  let toolOut = null;
  try {
    toolOut = JSON.parse(argsText);
  } catch {
    return { status: "error", message: "Eligibility generator tool arguments are not valid JSON." };
  }

  const inclusion = Array.isArray(toolOut?.inclusion_criteria)
    ? toolOut.inclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const exclusion = Array.isArray(toolOut?.exclusion_criteria)
    ? toolOut.exclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (inclusion.length < 3 || exclusion.length < 3) {
    return { status: "error", message: "Eligibility generator did not return >=3 inclusion and >=3 exclusion criteria." };
  }
  return {
    status: "ok",
    inclusion_criteria: inclusion.slice(0, 8),
    exclusion_criteria: exclusion.slice(0, 8),
    rationale: String(toolOut?.rationale || "").trim()
  };
}

const FEATURE_SYNONYMS = {
  set_eligibility_criteria: ["eligibility criteria", "inclusion criteria", "exclusion criteria", "screening criteria"],
  Verbatim_Evidence_Coding: ["verbatim coding", "code evidence", "code collection", "research questions coding"],
  screening_articles: ["screen", "screening", "triage", "filter studies"],
  classify_by_title: ["classify title", "title classification", "classify by title"],
  export_collection_to_csv: ["export csv", "download csv", "csv export"],
  download_pdfs_from_collections: ["download pdfs", "fetch pdfs", "bulk pdf"],
  keyword_analysis: ["keyword analysis", "keyword pass"],
  extract_entity_affiliation: ["extract entities", "entity extraction", "affiliation extraction"],
  summary_collection_prisma: ["prisma summary", "collection summary", "summarize collection"]
};

function scoreFeatureIntent(text, feature) {
  const tokens = tokenizeIntentText(text);
  const hay = tokenizeIntentText(
    `${feature.functionName} ${feature.label || ""} ${feature.group || ""} ${feature.tab || ""}`
  );
  let score = 0;
  const haySet = new Set(hay);
  for (const token of tokens) {
    if (haySet.has(token)) score += 1;
  }

  const normalizedText = normalizeName(text);
  if (normalizedText.includes(normalizeName(feature.functionName).replace(/_/g, " "))) score += 3;
  const synonyms = FEATURE_SYNONYMS[feature.functionName] || [];
  for (const synonym of synonyms) {
    if (normalizedText.includes(normalizeName(synonym))) score += 3;
  }
  return score;
}

function isAffirmative(text) {
  return /^(yes|y|yeah|yep|ok|okay|confirm|go ahead|do it|please do|sure|sounds good)\b/i.test(String(text || "").trim());
}

function isNegative(text) {
  return /^(no|n|cancel|stop|never mind|nevermind|don't|do not)\b/i.test(String(text || "").trim());
}

function sanitizeSubfolderName(raw) {
  const cleaned = cleanIdentifier(raw || "");
  if (!cleaned) return "";
  return cleaned
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function buildScreeningFolderNames(subjectRaw) {
  const subject = sanitizeSubfolderName(subjectRaw || "topic") || "topic";
  const safe = (prefix) =>
    sanitizeSubfolderName(`${prefix}_${subject}`) ||
    `${prefix}_${subject}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 64);
  return {
    subject,
    screen: safe("screen"),
    included: safe("included"),
    maybe: safe("maybe"),
    excluded: safe("excluded")
  };
}

function parseCriteriaLines(block) {
  return String(block || "")
    .split(/\n|;/)
    .map((line) => String(line || "").replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

const CRITICAL_LENS_APPROACHES = [
  "critical_security_studies",
  "post_structural",
  "feminist_ir",
  "postcolonial",
  "decolonial",
  "constructivist_critical",
  "practice_theory"
];

const THEORY_KEYWORDS = [
  "securitization theory",
  "practice theory",
  "assemblage theory",
  "deterrence theory",
  "realism",
  "neorealism",
  "liberal institutionalism",
  "constructivism",
  "critical theory",
  "feminist ir",
  "postcolonial theory",
  "decolonial theory"
];

function inferCriticalApproach(text = "") {
  const raw = normalizeName(text);
  if (!raw) return "";
  const patterns = [
    ["critical_security_studies", /\bcritical security studies\b/],
    ["post_structural", /\bpost[-\s]?structural\b/],
    ["feminist_ir", /\bfeminist (ir|international relations)\b/],
    ["postcolonial", /\bpost[-\s]?colonial\b/],
    ["decolonial", /\bdecolonial\b/],
    ["constructivist_critical", /\bconstructiv(?:ist|ism)\b/],
    ["practice_theory", /\bpractice theory\b/]
  ];
  for (const [name, rx] of patterns) {
    if (rx.test(raw)) return name;
  }
  return "";
}

function inferPersonaProfile(text = "") {
  const raw = String(text || "");
  const m =
    raw.match(/(?:persona|voice|style)\s*[:=]\s*([^\n;,.]+)/i) ||
    raw.match(/\b(as|like)\s+a?\s*([a-z][a-z0-9_\-\s]{3,60})/i);
  if (!m) return "";
  return cleanIdentifier(m[2] || m[1] || "").slice(0, 80);
}

function inferTheoryPreferences(text = "") {
  const low = normalizeName(text);
  if (!low) return [];
  const out = [];
  for (const t of THEORY_KEYWORDS) {
    if (low.includes(normalizeName(t))) out.push(t);
  }
  return out.slice(0, 8);
}

function mergeCodingContext(baseContext = "", meta = {}) {
  const chunks = [];
  const base = cleanIdentifier(baseContext || "");
  if (base) chunks.push(base);
  if (meta?.criticalLens === true) chunks.push("critical_lens=true");
  if (cleanIdentifier(meta?.criticalApproach || "")) chunks.push(`critical_approach=${cleanIdentifier(meta.criticalApproach)}`);
  if (cleanIdentifier(meta?.personaProfile || "")) chunks.push(`persona_profile=${cleanIdentifier(meta.personaProfile)}`);
  const theories = Array.isArray(meta?.theoryPreferences)
    ? meta.theoryPreferences.map((x) => cleanIdentifier(x || "")).filter(Boolean)
    : [];
  if (theories.length) chunks.push(`theory_preferences=${theories.join(", ")}`);
  return chunks.join("\n");
}

function extractOptionalPersonalization(text = "") {
  const raw = String(text || "");
  const criticalLens = /\bcritical(?:[_\s-]?lens| security studies| perspective)\b/i.test(raw);
  return {
    critical_lens: criticalLens,
    critical_approach: inferCriticalApproach(raw),
    persona_profile: inferPersonaProfile(raw),
    theory_preferences: inferTheoryPreferences(raw)
  };
}

function applyOptionalPersonalizationToFeatureArgs(text, args = {}, schemaArgs = []) {
  const next = { ...(args || {}) };
  const keys = new Set(
    (Array.isArray(schemaArgs) ? schemaArgs : [])
      .map((arg) => String(arg?.key || "").trim())
      .filter(Boolean)
  );
  const personalization = extractOptionalPersonalization(text);
  const hasPersonalization =
    personalization.critical_lens === true ||
    Boolean(personalization.critical_approach) ||
    Boolean(personalization.persona_profile) ||
    (Array.isArray(personalization.theory_preferences) && personalization.theory_preferences.length > 0);
  if (!hasPersonalization) return next;

  if (keys.has("critical_lens")) next.critical_lens = personalization.critical_lens === true;
  if (keys.has("critical_approach") && personalization.critical_approach) {
    next.critical_approach = personalization.critical_approach;
  }
  if (keys.has("persona_profile") && personalization.persona_profile) {
    next.persona_profile = personalization.persona_profile;
  }
  if (keys.has("theory_preferences") && personalization.theory_preferences.length) {
    next.theory_preferences = personalization.theory_preferences.slice(0, 8);
  }

  const contextKey =
    ["context", "extra_context", "analysis_prompt", "instruction", "user_context"].find((k) => keys.has(k)) || "";
  if (contextKey) {
    next[contextKey] = mergeCodingContext(String(next[contextKey] || ""), {
      criticalLens: personalization.critical_lens === true,
      criticalApproach: personalization.critical_approach,
      personaProfile: personalization.persona_profile,
      theoryPreferences: personalization.theory_preferences
    });
  }
  return next;
}

function inferTopicFocusAndContext(topic = "") {
  const normalized = cleanIdentifier(topic || "");
  if (!normalized) {
    return { focusSubject: "", overarchingContext: "" };
  }
  const m = normalized.match(
    /^(.+?)\s+(?:related to|in|within|for|about|regarding|concerning|under|inside|on)\s+(.+)$/i
  );
  if (m) {
    return {
      focusSubject: cleanIdentifier(m[1] || ""),
      overarchingContext: cleanIdentifier(m[2] || "")
    };
  }
  return {
    focusSubject: normalized,
    overarchingContext: ""
  };
}

function extractTopicClassificationPolicy(text = "", topic = "") {
  const raw = String(text || "").trim();
  const normalizedTopic = cleanIdentifier(topic || "");
  const split = inferTopicFocusAndContext(normalizedTopic);
  const focusSubject = split.focusSubject || normalizedTopic;
  const overarchingContext = split.overarchingContext;
  const inclusionMatch = raw.match(
    /(?:inclusion(?:\s+criteria)?\s*[:\-])([\s\S]*?)(?=(?:\n\s*(?:maybe|exclusion)(?:\s+criteria)?\s*[:\-])|$)/i
  );
  const maybeMatch = raw.match(
    /(?:maybe(?:\s+criteria)?\s*[:\-])([\s\S]*?)(?=(?:\n\s*exclusion(?:\s+criteria)?\s*[:\-])|$)/i
  );
  const exclusionMatch = raw.match(/(?:exclusion(?:\s+criteria)?\s*[:\-])([\s\S]*?)$/i);

  const hasStrictCue =
    /\bstrict|stricter|core|main objective|main contribution|primary objective|primary contribution|tangential|peripheral\b/i.test(
      raw
    );

  const focusLabel = focusSubject || "target subject";
  const contextLabel = overarchingContext || "overarching context";
  const relationLine = overarchingContext
    ? `The paper must discuss ${focusLabel} in explicit relation to ${overarchingContext} as a central contribution.`
    : `The paper must discuss ${focusLabel} as the central contribution.`;
  const defaultInclusion = [
    relationLine,
    `Synonyms/paraphrases of ${focusLabel} are allowed only when they clearly map to the same core concept.`,
    `At least one explicit contribution cue must target ${focusLabel} (e.g., proposes/develops/evaluates/compares a method, model, framework, taxonomy, protocol, or test).`,
    `Include only when title+abstract jointly indicate ${focusLabel} is the primary objective or main claimed contribution, not merely one component.`
  ];
  const defaultMaybe = [
    `Use maybe when ${focusLabel} appears but is secondary, contextual, or tangential.`,
    overarchingContext
      ? `Use maybe when ${focusLabel} and ${overarchingContext} both appear, but their relation is not a core contribution.`
      : `Use maybe when relevance is plausible but centrality is ambiguous from title+abstract.`,
    `Use maybe when synonym-level matches exist but contribution focus on ${focusLabel} is uncertain or weakly evidenced.`,
    "Use maybe when abstract framing is broad and the paper could fit multiple competing subjects."
  ];
  const defaultExclusion = [
    `Exclude when exact terms or clear synonyms of ${focusLabel} are absent in title+abstract.`,
    "Exclude when the paper's contribution is mainly elsewhere and the target subject is incidental.",
    overarchingContext
      ? `Exclude when ${focusLabel} appears without meaningful relation to ${overarchingContext}.`
      : "Exclude when the target subject appears only as a passing mention or keyword overlap.",
    `Exclude when ${focusLabel} is discussed only as background, motivation, limitation, or future work.`
  ];

  const inclusionCriteria = parseCriteriaLines(inclusionMatch?.[1]);
  const maybeCriteria = parseCriteriaLines(maybeMatch?.[1]);
  const exclusionCriteria = parseCriteriaLines(exclusionMatch?.[1]);

  const resolvedInclusion = inclusionCriteria.length ? inclusionCriteria : defaultInclusion;
  const resolvedMaybe = maybeCriteria.length ? maybeCriteria : defaultMaybe;
  const resolvedExclusion = exclusionCriteria.length ? exclusionCriteria : defaultExclusion;

  const policySummary = hasStrictCue
    ? `Strict centrality policy: include only if ${focusLabel} is a core contribution${overarchingContext ? ` and explicitly linked to ${contextLabel}` : ""}; tangential or uncertain cases are maybe; absence or non-core focus is excluded.`
    : `Strict-by-default centrality policy: include only when ${focusLabel} is core${overarchingContext ? ` and clearly connected to ${contextLabel}` : ""}; peripheral/ambiguous cases are maybe; non-core cases are excluded.`;

  return {
    classificationPolicy: policySummary,
    inclusionCriteria: resolvedInclusion,
    maybeCriteria: resolvedMaybe,
    exclusionCriteria: resolvedExclusion
  };
}

function clamp01(v, fallback = 0.6) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function inferRecentCollectionKeyFromMemory() {
  let bestKey = "";
  let bestTs = 0;
  for (const [key, cache] of memoryCache.items.entries()) {
    const ts = Number(cache?.savedAt || 0);
    if (!key) continue;
    if (ts >= bestTs) {
      bestTs = ts;
      bestKey = key;
    }
  }
  return toString(bestKey);
}

function inferCollectionNameByKey(collectionKey) {
  const key = toString(collectionKey);
  if (!key) return "";
  const collections = Array.isArray(memoryCache?.collections?.data) ? memoryCache.collections.data : [];
  const found = collections.find((c) => toString(c?.key) === key);
  return toString(found?.name || "");
}

function normalizeWorkflowArgs(rawArgs = {}, context = {}) {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  const ctx = context && typeof context === "object" ? context : {};
  const topic = cleanIdentifier(args.topic || "");
  const explicitSubfolder = cleanIdentifier(args.subfolderName || "");
  const subfolderName = sanitizeSubfolderName(explicitSubfolder || topic || "topic_filtered");

  const contextKey =
    cleanIdentifier(
      ctx.selectedCollectionKey ||
        lastWorkflowContext.selectedCollectionKey ||
        args.collectionKey ||
        ""
    ) || inferRecentCollectionKeyFromMemory();
  const contextName = cleanIdentifier(
    ctx.selectedCollectionName ||
      lastWorkflowContext.selectedCollectionName ||
      inferCollectionNameByKey(contextKey) ||
      ""
  );
  const parentIdentifier = cleanIdentifier(args.parentIdentifier || contextKey || contextName || "");

  const confidenceThreshold = clamp01(args.confidenceThreshold, 0.6);
  const maxItems = Number.isFinite(Number(args.maxItems)) ? Number(args.maxItems) : 0;
  const policyFromText = extractTopicClassificationPolicy(
    toString(args.classificationPolicy || args.userPrompt || ""),
    topic
  );
  const parseArray = (v) =>
    Array.isArray(v) ? v.map((x) => cleanIdentifier(x || "")).filter(Boolean) : [];
  const inclusionCriteria = parseArray(args.inclusionCriteria);
  const maybeCriteria = parseArray(args.maybeCriteria);
  const exclusionCriteria = parseArray(args.exclusionCriteria);

  return {
    parentIdentifier,
    subfolderName,
    topic,
    confidenceThreshold,
    maxItems,
    classificationPolicy: cleanIdentifier(args.classificationPolicy || policyFromText.classificationPolicy || ""),
    inclusionCriteria: inclusionCriteria.length ? inclusionCriteria : policyFromText.inclusionCriteria,
    maybeCriteria: maybeCriteria.length ? maybeCriteria : policyFromText.maybeCriteria,
    exclusionCriteria: exclusionCriteria.length ? exclusionCriteria : policyFromText.exclusionCriteria
  };
}

async function resolveIntent(text, context = {}) {
  const raw = String(text || "").trim();
  if (!raw) return { status: "error", message: "Command text is required." };
  bumpIntentTelemetry("requests");

  const explicitEligibility = parseEligibilityCriteriaIntent(raw, context);
  if (explicitEligibility) {
    return { status: "ok", intent: explicitEligibility };
  }
  if (/\b(?:code|coding)\b/i.test(raw)) {
    const codingLlm = await resolveCodingIntentWithLLM(raw, context);
    if (codingLlm?.status === "ok" && codingLlm?.data && codingLlm.data.is_coding_request === true) {
      const questions = Array.isArray(codingLlm.data.research_questions)
        ? codingLlm.data.research_questions.map((q) => String(q || "").trim()).filter(Boolean).slice(0, 5)
        : [];
      const topicMatch = raw.match(/about\s+(.+?)(?:[.?!]|$)/i) || raw.match(/(?:on|regarding|concerning)\s+(.+?)(?:[.?!]|$)/i);
      const topic = cleanIdentifier(topicMatch?.[1] || "");
      const generatedQuestions = topic
        ? [
            `How is ${topic} defined and scoped in the study?`,
            `Which models or frameworks are used to analyze ${topic}?`,
            `What evidence is provided to support claims about ${topic}?`,
            `What limitations or assumptions are identified in the models/frameworks for ${topic}?`,
            `What policy or strategic implications are derived from findings on ${topic}?`
          ]
        : [];
      let resolvedQuestions = questions.length ? questions : generatedQuestions;
      if (resolvedQuestions.length > 0 && resolvedQuestions.length < 3 && generatedQuestions.length) {
        const merged = [...resolvedQuestions];
        generatedQuestions.forEach((q) => {
          const key = normalizeName(q);
          if (!merged.some((x) => normalizeName(x) === key)) merged.push(q);
        });
        resolvedQuestions = merged.slice(0, 5);
      }
      const collectionName = normalizeCollectionIdentifier(context) || extractCollectionIdentifierFromText(raw);
      const criticalLensRequested =
        codingLlm.data.critical_lens === true || /\bcritical(?:[_\s-]?lens| security studies| perspective)\b/i.test(raw);
      const criticalApproach =
        cleanIdentifier(codingLlm.data.critical_approach || inferCriticalApproach(raw) || "");
      const personaProfile =
        cleanIdentifier(codingLlm.data.persona_profile || inferPersonaProfile(raw) || "");
      const theoryPreferences = Array.isArray(codingLlm.data.theory_preferences)
        ? codingLlm.data.theory_preferences.map((x) => cleanIdentifier(x || "")).filter(Boolean).slice(0, 8)
        : inferTheoryPreferences(raw);
      const clarificationQuestions = [];
      if (!collectionName) clarificationQuestions.push("Select a collection before coding.");
      if (codingLlm.data.needsClarification === true) {
        clarificationQuestions.push(
          ...(Array.isArray(codingLlm.data.clarificationQuestions)
            ? codingLlm.data.clarificationQuestions.map((q) => String(q || "").trim()).filter(Boolean).slice(0, 6)
            : [])
        );
      }
      if (resolvedQuestions.length < 3) {
        clarificationQuestions.push("I need 3 to 5 research questions to run coding.");
      }
      if (criticalLensRequested && !criticalApproach) {
        clarificationQuestions.push(
          `Critical lens requested. Optional: choose one approach (${CRITICAL_LENS_APPROACHES.join(", ")}), or reply 'no specific approach'.`
        );
      }
      return {
        status: "ok",
        intent: {
          intentId: "feature.run",
          targetFunction: "Verbatim_Evidence_Coding",
          confidence: Number.isFinite(Number(codingLlm.data.confidence)) ? Number(codingLlm.data.confidence) : 0.86,
          riskLevel: "confirm",
          needsClarification: clarificationQuestions.length > 0,
          clarificationQuestions,
          args: {
            dir_base: resolveVerbatimDirBase(context),
            collection_name: collectionName,
            research_questions: resolvedQuestions,
            prompt_key: "code_pdf_page",
            context: mergeCodingContext(String(codingLlm.data.context || "").trim(), {
              criticalLens: criticalLensRequested,
              criticalApproach,
              personaProfile,
              theoryPreferences
            }),
            screening: codingLlm.data.screening === true,
            critical_lens: criticalLensRequested,
            critical_approach: criticalApproach,
            persona_profile: personaProfile,
            theory_preferences: theoryPreferences
          }
        }
      };
    }

    // Fallback deterministic coding parser if LLM is unavailable/fails.
    const explicitCoding = parseVerbatimCodingIntent(raw, context);
    if (explicitCoding) {
      return { status: "ok", intent: explicitCoding };
    }
  }

  const pendingIntent = context?.pendingIntent && typeof context.pendingIntent === "object" ? context.pendingIntent : null;
  if (pendingIntent) {
    if (isAffirmative(raw)) {
      recordResolvedIntent({
        ...pendingIntent,
        needsClarification: false
      });
      return {
        status: "ok",
        intent: {
          ...pendingIntent,
          needsClarification: false,
          clarificationQuestions: []
        }
      };
    }
    if (isNegative(raw)) {
      recordResolvedIntent({
        intentId: "agent.legacy_command",
        needsClarification: true
      });
      return {
        status: "ok",
        intent: {
          intentId: "agent.legacy_command",
          confidence: 0.95,
          needsClarification: true,
          clarificationQuestions: ["Pending action cancelled. Tell me the next action to run."],
          args: { text: "" }
        }
      };
    }
  }

  const signatures = await loadZoteroSignatures();
  const tabs = groupedFeatures(signatures);
  const flat = [];
  tabs.forEach((tab) => {
    tab.groups.forEach((group) => {
      group.features.forEach((feature) => {
        flat.push({
          ...feature,
          tab: tab.tab,
          group: group.group
        });
      });
    });
  });

  const featureCatalog = flat.map((feature) => ({
    functionName: String(feature?.functionName || ""),
    label: String(feature?.label || ""),
    group: String(feature?.group || ""),
    tab: String(feature?.tab || ""),
    requiredArgs: (Array.isArray(feature?.args) ? feature.args : [])
      .filter((arg) => arg?.required)
      .map((arg) => String(arg?.key || ""))
      .filter(Boolean)
  }));

  const llmResolved = await callOpenAIIntentResolver(raw, context, featureCatalog);
  if (llmResolved?.status === "ok" && llmResolved?.intent && typeof llmResolved.intent === "object") {
    const intent = llmResolved.intent;
    const intentId = toString(intent?.intentId);
    const targetFunction = toString(intent?.targetFunction);
    const normalized = {
      intentId: intentId || "agent.legacy_command",
      targetFunction,
      confidence: Number.isFinite(Number(intent?.confidence)) ? Number(intent.confidence) : 0.5,
      riskLevel: ["safe", "confirm", "high"].includes(String(intent?.riskLevel)) ? String(intent.riskLevel) : "confirm",
      needsClarification: intent?.needsClarification === true,
      clarificationQuestions: Array.isArray(intent?.clarificationQuestions)
        ? intent.clarificationQuestions.map((q) => String(q || "").trim()).filter(Boolean).slice(0, 6)
        : [],
      args: intent?.args && typeof intent.args === "object" ? intent.args : {}
    };

    if (normalized.intentId === "workflow.create_subfolder_by_topic") {
      normalized.targetFunction = "workflow-create-subfolder-by-topic";
      const args = normalized.args || {};
      normalized.args = normalizeWorkflowArgs(
        {
          ...args,
          userPrompt: raw
        },
        context
      );
      if (!normalized.args.topic) {
        normalized.needsClarification = true;
        normalized.clarificationQuestions = ["What subject/topic should I filter for?"];
      } else if (!normalized.args.parentIdentifier) {
        normalized.needsClarification = true;
        normalized.clarificationQuestions = ["Which collection should I process?"];
      } else {
        normalized.needsClarification = false;
        normalized.clarificationQuestions = [];
      }
    }

    if (normalized.intentId === "feature.run") {
      const found = getFeatureByFunctionName(normalized.targetFunction, signatures);
      if (!found) {
        normalized.intentId = "agent.legacy_command";
        normalized.needsClarification = true;
        normalized.clarificationQuestions = [
          `I could not find feature '${normalized.targetFunction}'. Please restate the command.`
        ];
      } else {
        const schemaArgs = Array.isArray(found.args) ? found.args : [];
        const nextArgs = { ...(normalized.args || {}) };
        for (const arg of schemaArgs) {
          const key = String(arg?.key || "");
          if (!key) continue;
          const hasValue = Object.prototype.hasOwnProperty.call(nextArgs, key);
          if (!hasValue && Object.prototype.hasOwnProperty.call(arg, "default")) {
            nextArgs[key] = arg.default;
          }
          if (!hasValue && key === "collection_name") {
            nextArgs[key] = context?.selectedCollectionName || context?.selectedCollectionKey || "";
          }
          if (!hasValue && key === "Z_collections") {
            const collectionFallback = context?.selectedCollectionName || context?.selectedCollectionKey;
            if (collectionFallback) nextArgs[key] = [collectionFallback];
          }
          if (!Object.prototype.hasOwnProperty.call(nextArgs, key)) {
            if (arg?.type === "json") nextArgs[key] = {};
            else if (arg?.type === "boolean") nextArgs[key] = false;
            else if (arg?.type === "number") nextArgs[key] = 0;
            else if (arg?.type === "list") nextArgs[key] = [];
            else nextArgs[key] = "";
          }
        }
        normalized.args = nextArgs;
        if (normalized.targetFunction !== "Verbatim_Evidence_Coding") {
          normalized.args = applyOptionalPersonalizationToFeatureArgs(raw, normalized.args, schemaArgs);
        }
        const missingRequired = schemaArgs
          .filter((arg) => arg?.required)
          .map((arg) => String(arg?.key || ""))
          .filter(Boolean)
          .filter((key) => {
            const v = normalized.args?.[key];
            if (Array.isArray(v)) return v.length === 0;
            if (typeof v === "string") return v.trim().length === 0;
            if (v && typeof v === "object") return Object.keys(v).length === 0;
            return v === null || v === undefined;
          });
        if (missingRequired.length > 0) {
          normalized.needsClarification = true;
          normalized.clarificationQuestions = missingRequired.map((k) => `Please provide required argument: ${k}.`);
        }
      }
    }

    if (normalized.intentId === "agent.legacy_command") {
      normalized.args = { text: raw, ...(normalized.args || {}) };
      if (!normalized.needsClarification && !normalized.clarificationQuestions.length) {
        normalized.needsClarification = true;
        normalized.clarificationQuestions = [
          "I could not map that confidently. Do you want me to create a topic-filtered subfolder for the active collection?"
        ];
      }
    }
    recordResolvedIntent(normalized);
    return { status: "ok", intent: normalized };
  }
  bumpIntentTelemetry("fallbackUsed");

  let best = null;
  for (const feature of flat) {
    const score = scoreFeatureIntent(raw, feature);
    if (!best || score > best.score) best = { feature, score };
  }

  if (!best || best.score < 2) {
    const out = {
      status: "ok",
      intent: {
        intentId: "agent.legacy_command",
        confidence: 0.3,
        needsClarification: true,
        clarificationQuestions: [
          "I could not map that to a ribbon function. Try naming the action (example: 'classify by title', 'export csv')."
        ],
        args: { text: raw }
      }
    };
    recordResolvedIntent(out.intent);
    return out;
  }

  const args = {};
  const required = [];
  const argSchema = Array.isArray(best.feature.args) ? best.feature.args : [];
  argSchema.forEach((arg) => {
    const key = String(arg?.key || "");
    if (!key) return;
    if (key === "collection_name") {
      args[key] = context?.selectedCollectionName || context?.selectedCollectionKey || "";
      return;
    }
    if (Object.prototype.hasOwnProperty.call(arg, "default")) {
      args[key] = arg.default;
      return;
    }
    if (arg?.required) required.push(key);
  });

  const out = {
    status: "ok",
    intent: {
      intentId: "feature.run",
      targetFunction: best.feature.functionName,
      confidence: Math.min(0.97, 0.45 + best.score * 0.07),
      riskLevel: isDestructiveFunction(best.feature.functionName) ? "confirm" : "safe",
      needsClarification: required.length > 0,
      clarificationQuestions: required.map((k) => `Please provide required argument: ${k}.`),
      args
    }
  };
  recordResolvedIntent(out.intent);
  return out;
}

async function updateItemTags(creds, itemKey, tagsToAdd) {
  const current = await fetchItemByKey(creds, itemKey);
  const currentTags = Array.isArray(current?.data?.tags)
    ? current.data.tags.map((t) => String(t?.tag || "").trim()).filter(Boolean)
    : [];
  const next = Array.from(new Set([...currentTags, ...tagsToAdd.map((x) => String(x || "").trim()).filter(Boolean)]));
  const payload = [{ key: itemKey, version: Number(current?.version || 0), data: { ...(current?.data || {}), tags: next.map((tag) => ({ tag, type: 0 })) } }];
    const res = await fetchWithTimeout(`${zoteroBase(creds)}/items`, {
    method: "POST",
    headers: writeHeaders(creds),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tag update failed ${itemKey}: HTTP ${res.status} ${text || ""}`.trim());
  }
  return next;
}

async function executeCreateSubfolderByTopicWorkflow(payload = {}) {
  const dryRun = false;
  const args = payload?.args || {};
  const parentIdentifier = cleanIdentifier(args.parentIdentifier || "");
  const topic = cleanIdentifier(args.topic || "");
  const subfolderName = cleanIdentifier(args.subfolderName || topic);
  const threshold = Number(args.confidenceThreshold || 0.6);
  const maxItemsRaw = Number(args.maxItems);
  const maxItems = Number.isFinite(maxItemsRaw) && maxItemsRaw > 0 ? Math.floor(maxItemsRaw) : 0;
  const parsedPolicy = extractTopicClassificationPolicy(
    toString(args.classificationPolicy || args.userPrompt || ""),
    topic
  );
  const inclusionCriteria =
    Array.isArray(args.inclusionCriteria) && args.inclusionCriteria.length
      ? args.inclusionCriteria.map((x) => cleanIdentifier(x || "")).filter(Boolean)
      : parsedPolicy.inclusionCriteria;
  const maybeCriteria =
    Array.isArray(args.maybeCriteria) && args.maybeCriteria.length
      ? args.maybeCriteria.map((x) => cleanIdentifier(x || "")).filter(Boolean)
      : parsedPolicy.maybeCriteria;
  const exclusionCriteria =
    Array.isArray(args.exclusionCriteria) && args.exclusionCriteria.length
      ? args.exclusionCriteria.map((x) => cleanIdentifier(x || "")).filter(Boolean)
      : parsedPolicy.exclusionCriteria;
  const classificationPolicy = cleanIdentifier(args.classificationPolicy || parsedPolicy.classificationPolicy || "");

  if (!parentIdentifier) return { status: "error", message: "parentIdentifier is required." };
  if (!topic) return { status: "error", message: "topic is required." };
  if (!subfolderName) return { status: "error", message: "subfolderName is required." };

  const creds = getCredentials();
  const collections = await fetchAllCollections(creds);
  const indexes = buildCollectionIndexes(collections);
  const parentResolved = resolveCollectionIdentifier(parentIdentifier, indexes);
  if (!parentResolved.ok) return { status: "error", message: parentResolved.message, choices: parentResolved.choices || [] };
  const parent = parentResolved.collection;

  const findChildCollection = (parentKey, name) => {
    const children = indexes.byParent.get(parentKey) || [];
    return children.find((collection) => normalizeName(collection.name) === normalizeName(name)) || null;
  };
  const registerCreatedCollection = (collection) => {
    if (!collection?.key) return;
    indexes.byKey.set(collection.key, collection);
    if (!indexes.byParent.has(collection.parentKey || null)) indexes.byParent.set(collection.parentKey || null, []);
    indexes.byParent.get(collection.parentKey || null).push(collection);
  };
  const screeningFolders = buildScreeningFolderNames(topic || subfolderName || "topic");
  let screenCollection = findChildCollection(parent.key, screeningFolders.screen);

  const rows = await fetchCollectionTopItems(creds, parent.key, maxItems);
  const candidates = rows
    .map((row) => ({
      key: row?.key || "",
      title: row?.data?.title || "",
      abstract: row?.data?.abstractNote || "",
      existingTags: Array.isArray(row?.data?.tags) ? row.data.tags.map((t) => String(t?.tag || "").trim()).filter(Boolean) : []
    }))
    .filter((row) => {
      if (!row.key) return false;
      const titleLen = String(row.title || "").trim().length;
      const abstractLen = String(row.abstract || "").trim().length;
      return abstractLen >= 16 || titleLen >= 8;
    });

  if (!candidates.length) {
    return {
      status: "ok",
      dryRun,
      action: "workflow.create_subfolder_by_topic",
      result: {
        parent: { key: parent.key, name: parent.name, path: parent.fullPath || parent.name },
        subcollection: {
          key: screenCollection?.key || "",
          name: screeningFolders.screen,
          path: `${parent.fullPath || parent.name}/${screeningFolders.screen}`
        },
        topic,
        scannedItems: rows.length,
        classifiedItems: 0,
        matchedItems: 0,
        addedItems: 0,
        skippedExisting: 0,
        failed: [],
        sampleMatches: []
      }
    };
  }

  const promptSpecUsed = createTopicClassifierPromptSpec({
    topic,
    parentIdentifier,
    subfolderName,
    threshold,
    classificationPolicy,
    inclusionCriteria,
    maybeCriteria,
    exclusionCriteria
  });
  const classifierRes = await runPythonTopicClassifier({
    topic,
    items: candidates,
    collectionKey: parent.key,
    workflowJobId: toString(payload?.jobId || ""),
    model: payload?.model || INTENT_CLASSIFIER_MODEL,
    promptSpec: promptSpecUsed,
    promptPath: path.join(__dirname, "..", "Prompts", "api_prompts.json"),
    storeOnly: payload?.background === true || Boolean(payload?.jobId),
    liveMode: payload?.background !== true,
    timeoutSec: Number.isFinite(Number(payload?.timeoutSec)) ? Number(payload.timeoutSec) : 0,
    pollSec: Number(payload?.pollSec || 5)
  });
  if (classifierRes?.status !== "ok") {
    return { status: "error", message: classifierRes?.message || "Topic classifier failed.", detail: classifierRes };
  }
  const candidateByKey = new Map(candidates.map((x) => [toString(x?.key || ""), x]));
  classifierRes.results = (classifierRes.results || []).map((entry) =>
    applyTopicDecisionCalibration(entry, candidateByKey.get(toString(entry?.key || "")) || {}, topic)
  );
  const classifierMeta = classifierRes?.meta && typeof classifierRes.meta === "object" ? classifierRes.meta : {};
  if (!classifierMeta.prompt_spec_used) {
    classifierMeta.prompt_spec_used = promptSpecUsed;
  }
  const pendingBatch = Boolean(classifierMeta?.submitted) && Boolean(toString(classifierMeta?.batch_id));

  if (pendingBatch) {
    const pendingBatchId = toString(classifierMeta?.batch_id || "");
    if (pendingBatchId) {
      writeOpenAIBatchInputMeta(
        pendingBatchId,
        candidates.map((c) => ({
          key: toString(c?.key || ""),
          title: toString(c?.title || ""),
          abstract: toString(c?.abstract || ""),
          authors: ""
        }))
      );
    }
    return {
      status: "ok",
      dryRun,
      action: "workflow.create_subfolder_by_topic",
      result: {
        parent: { key: parent.key, name: parent.name, path: parent.fullPath || parent.name },
        subcollection: screenCollection
          ? { key: screenCollection.key, name: screenCollection.name, path: screenCollection.fullPath || screenCollection.name }
          : { key: "", name: screeningFolders.screen, path: `${parent.fullPath || parent.name}/${screeningFolders.screen}` },
        screeningSubfolders: {
          included: screeningFolders.included,
          maybe: screeningFolders.maybe,
          excluded: screeningFolders.excluded
        },
        topic,
        threshold,
        maxItems,
        screenedItems: rows.length,
        scannedItems: rows.length,
        classifiedItems: candidates.length,
        matchedItems: 0,
        addedItems: 0,
        skippedExisting: 0,
        failed: [],
        sampleMatches: [],
        pendingBatch: true,
        classifierMeta
      }
    };
  }

  const byKey = new Map(rows.map((row) => [row?.key || "", row]));
  const classifyBucket = (entry) => {
    const status = toString(entry?.status || "").toLowerCase();
    const conf = Number(entry?.confidence || 0);
    if (status === "included" && conf >= threshold) return "included";
    if (status === "excluded") return "excluded";
    return "maybe";
  };
  const allEntries = Array.isArray(classifierRes.results) ? classifierRes.results : [];
  const bucketed = { included: [], maybe: [], excluded: [] };
  for (const entry of allEntries) {
    const key = toString(entry?.key || "");
    if (!key || !byKey.has(key)) continue;
    const bucket = classifyBucket(entry);
    bucketed[bucket].push(entry);
  }
  const matches = bucketed.included;

  let added = 0;
  let addedIncluded = 0;
  let addedMaybe = 0;
  let addedExcluded = 0;
  let skippedExisting = 0;
  const failed = [];

  if (!dryRun) {
    if (!screenCollection) {
      const created = await createSubcollection(creds, parent.key, screeningFolders.screen);
      if (created?.key) {
        screenCollection = {
          key: created.key,
          name: screeningFolders.screen,
          parentKey: parent.key,
          fullPath: `${parent.fullPath || parent.name}/${screeningFolders.screen}`
        };
        registerCreatedCollection(screenCollection);
      }
    }
    if (!screenCollection?.key) return { status: "error", message: "Could not create or locate screening root subcollection." };

    const ensureBucketCollection = async (bucketName) => {
      let c = findChildCollection(screenCollection.key, bucketName);
      if (!c) {
        const created = await createSubcollection(creds, screenCollection.key, bucketName);
        if (created?.key) {
          c = {
            key: created.key,
            name: bucketName,
            parentKey: screenCollection.key,
            fullPath: `${screenCollection.fullPath || screenCollection.name}/${bucketName}`
          };
          registerCreatedCollection(c);
        }
      }
      return c;
    };
    const bucketCollections = {
      included: await ensureBucketCollection(screeningFolders.included),
      maybe: await ensureBucketCollection(screeningFolders.maybe),
      excluded: await ensureBucketCollection(screeningFolders.excluded)
    };
    if (!bucketCollections.included?.key || !bucketCollections.maybe?.key || !bucketCollections.excluded?.key) {
      return { status: "error", message: "Could not create one or more screening bucket subcollections." };
    }

    const addEntriesToBucket = async (entries, bucketKey, counterKey) => {
      for (const entry of entries) {
        const raw = byKey.get(entry.key);
        if (!raw) continue;
        const existingCollections = Array.isArray(raw?.data?.collections) ? raw.data.collections : [];
        if (existingCollections.includes(bucketKey)) {
          skippedExisting += 1;
        } else {
          try {
            await addItemToCollection(creds, bucketKey, raw);
            added += 1;
            if (counterKey === "included") addedIncluded += 1;
            if (counterKey === "maybe") addedMaybe += 1;
            if (counterKey === "excluded") addedExcluded += 1;
          } catch (error) {
            failed.push({ key: entry.key, title: entry.title || "", message: error.message || "Failed to add item." });
            continue;
          }
        }

        if (counterKey === "included") {
          const suggested = Array.isArray(entry.suggested_tags) ? entry.suggested_tags.slice(0, 6) : [];
          const normalizedTopicTag = topic.replace(/\s+/g, "_").toLowerCase();
          const tagsToAdd = Array.from(new Set([normalizedTopicTag, ...suggested]));
          try {
            await updateItemTags(creds, entry.key, tagsToAdd);
          } catch (error) {
            failed.push({ key: entry.key, title: entry.title || "", message: error.message || "Failed to update tags." });
          }
        }
      }
    };

    await addEntriesToBucket(bucketed.included, bucketCollections.included.key, "included");
    await addEntriesToBucket(bucketed.maybe, bucketCollections.maybe.key, "maybe");
    await addEntriesToBucket(bucketed.excluded, bucketCollections.excluded.key, "excluded");
  }

  return {
    status: "ok",
    dryRun,
      action: "workflow.create_subfolder_by_topic",
      result: {
        parent: { key: parent.key, name: parent.name, path: parent.fullPath || parent.name },
      subcollection: screenCollection
        ? { key: screenCollection.key, name: screenCollection.name, path: screenCollection.fullPath || screenCollection.name }
        : { key: "", name: screeningFolders.screen, path: `${parent.fullPath || parent.name}/${screeningFolders.screen}` },
      screeningSubfolders: {
        included: screeningFolders.included,
        maybe: screeningFolders.maybe,
        excluded: screeningFolders.excluded
      },
      topic,
      threshold,
      maxItems,
      screenedItems: rows.length,
      scannedItems: rows.length,
      classifiedItems: candidates.length,
      matchedItems: matches.length,
      addedItems: added,
      addedIncluded,
      addedMaybe,
      addedExcluded,
      bucketedItems: {
        included: bucketed.included.length,
        maybe: bucketed.maybe.length,
        excluded: bucketed.excluded.length
      },
      skippedExisting,
      failed,
      sampleMatches: matches.slice(0, 12).map((entry) => ({
        key: entry.key,
        title: entry.title || "",
        confidence: Number(entry.confidence || 0),
        reason: String(entry.reason || "")
      })),
      classifierMeta
    }
  };
}

function enqueueWorkflowCreateSubfolderByTopicJob(payload = {}) {
  const id = `job_${featureJobSeq++}`;
  const job = {
    id,
    functionName: "workflow.create_subfolder_by_topic",
    status: "queued",
    progress: 0,
    phase: "Queued",
    runnerPayload: {
      kind: "workflow.create_subfolder_by_topic",
      payload: {
        ...payload,
        background: true,
        jobId: id,
        dryRun: false
      }
    },
    createdAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
    error: "",
    result: null
  };
  featureJobs.push(job);
  featureJobMap.set(job.id, job);
  persistFeatureJobsState();
  broadcastFeatureJobStatus(job);
  void processNextFeatureJob();
  return job;
}

function broadcastFeatureJobStatus(job) {
  persistFeatureJobsState();
  const main = windows.get("main");
  if (!main || main.isDestroyed()) return;
  main.webContents.send("zotero:feature-job-status", {
    id: job.id,
    status: job.status,
    progress: job.progress,
    phase: toString(job.phase || ""),
    functionName: job.functionName,
    startedAt: job.startedAt || 0,
    finishedAt: job.finishedAt || 0,
    error: job.error || "",
    result: job.result || null
  });
}

function snapshotFeatureJobs() {
  return featureJobs.slice(-200).map((job) => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    phase: toString(job.phase || ""),
    functionName: job.functionName,
    runnerPayload: job.runnerPayload || null,
    openaiBatchId: toString(job.openaiBatchId || ""),
    external: job.external === true,
    createdAt: job.createdAt || 0,
    startedAt: job.startedAt || 0,
    finishedAt: job.finishedAt || 0,
    error: job.error || "",
    result: job.result || null
  }));
}

function parseCustomIdItemKey(customId) {
  const s = toString(customId);
  const m = s.match(/^topic_\d+_(.+)$/);
  return toString(m?.[1] || "");
}

function parseOpenAIBatchLine(lineObj) {
  const customId = toString(lineObj?.custom_id);
  const key = parseCustomIdItemKey(customId);
  const lineError = lineObj?.error && typeof lineObj.error === "object" ? lineObj.error : null;
  const body = lineObj?.response?.body || {};
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  const chatRawContent = choices?.[0]?.message?.content;
  const chatContent = typeof chatRawContent === "string" ? chatRawContent.trim() : "";
  const responsesOutputText = typeof body?.output_text === "string" ? body.output_text.trim() : "";
  let responsesChunksText = "";
  if (!responsesOutputText && Array.isArray(body?.output)) {
    const chunks = [];
    for (const item of body.output) {
      const contentArr = Array.isArray(item?.content) ? item.content : [];
      for (const chunk of contentArr) {
        const t = toString(chunk?.text);
        if (t) chunks.push(t);
      }
    }
    responsesChunksText = chunks.join("").trim();
  }
  const content = responsesOutputText || responsesChunksText || chatContent;
  let parsed = null;
  try {
    parsed = content ? JSON.parse(content) : null;
  } catch {
    parsed = null;
  }
  const statusRaw = toString(parsed?.status || "").toLowerCase();
  const status = ["included", "maybe", "excluded"].includes(statusRaw)
    ? statusRaw
    : "excluded";
  const isMatch = status === "included";
  const justificationFallback = toString(
    parsed?.justification ||
      parsed?.reason ||
      lineError?.message ||
      body?.error?.message ||
      (!content ? "No parsable model output." : "Non-JSON model output.")
  );
  return {
    key,
    status,
    is_match: isMatch,
    confidence: Number(parsed?.confidence || 0) || 0,
    themes: [],
    subject: "",
    reason: justificationFallback,
    suggested_tags: []
  };
}

function isIncludedTopicDecision(entry) {
  const status = toString(entry?.status || "").toLowerCase();
  if (status === "included") return true;
  if (status === "maybe" || status === "excluded") return false;
  return Boolean(entry?.is_match);
}

function normalizeTextForHeuristic(value) {
  return toString(value || "").toLowerCase();
}

function applyTopicDecisionCalibration(entry, candidate = {}, topic = "") {
  const current = entry && typeof entry === "object" ? { ...entry } : {};
  const title = normalizeTextForHeuristic(candidate?.title || current?.title || "");
  const abstract = normalizeTextForHeuristic(candidate?.abstract || "");
  const text = `${title}\n${abstract}`;
  const topicText = normalizeTextForHeuristic(topic);
  const status = toString(current.status || "").toLowerCase();
  const topicTokens = topicText
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !new Set(["and", "or", "to", "of", "for", "in", "on", "related", "about", "the", "a", "an"]).has(t));
  const matchedTopicTokens = topicTokens.filter((t) => text.includes(t)).length;
  const requiredTopicMatches = topicTokens.length > 2 ? 2 : 1;

  const hasContributionCue =
    /\b(we propose|this paper proposes|proposes|we develop|develops|introduces|presents|we present|we evaluate|evaluate|compare|benchmark|validate|formalize)\b/.test(
      text
    );
  const hasArtifactCue =
    /\b(framework|model|method|methodology|taxonomy|ontology|architecture|protocol|pipeline|algorithm|test|metric|lexicon)\b/.test(
      text
    );
  const hasOperationalSpecificityCue =
    /\b(criteria|threshold|stages?|step(s)?|variables?|features?|indicators?|rules?|procedure|protocol|algorithm|pipeline|benchmark|evaluation|experiment|case study|dataset|validation|formal)\b/.test(
      text
    );
  const hasConceptualCue =
    /\b(conceptual framework|theoretical framework|normative framework|perspective|theoretical model|conceptual model)\b/.test(
      text
    );
  const hasEmpiricalCue =
    /\b(experiment|evaluation|benchmark|dataset|empirical|validation|case study|implementation|performance)\b/.test(
      text
    );
  const hasPeripheralCue =
    /\b(background|related work|overview|commentary|perspective|debate|survey|doctrinal|policy discussion|review)\b/.test(
      text
    );

  // Conservative demotion: included requires subject match + contribution evidence.
  if (status === "included") {
    if (matchedTopicTokens < requiredTopicMatches) {
      current.status = "excluded";
      current.is_match = false;
      current.confidence = Math.min(0.35, Math.max(0.1, Number(current.confidence || 0)));
    } else if (
      !(hasContributionCue && hasArtifactCue && hasOperationalSpecificityCue) ||
      (hasPeripheralCue && !hasContributionCue) ||
      (hasConceptualCue && !hasEmpiricalCue)
    ) {
      current.status = "maybe";
      current.is_match = false;
      current.confidence = Math.min(0.62, Math.max(0.4, Number(current.confidence || 0)));
    }
  }

  // Allow promotion from maybe when signals are strong and unambiguous.
  if (
    status === "maybe" &&
    matchedTopicTokens >= requiredTopicMatches &&
    hasContributionCue &&
    hasArtifactCue &&
    hasOperationalSpecificityCue &&
    !hasPeripheralCue
  ) {
    current.status = "included";
    current.is_match = true;
    current.confidence = Math.max(0.72, Math.min(0.9, Number(current.confidence || 0.72)));
  }

  return current;
}

function getTopicClassifierPromptInfo() {
  const fallback = {
    promptKey: "classify_abstract_topic_membership_v1",
    system: "You are a precise academic classifier. Return only valid JSON.",
    template:
      "You classify Zotero paper abstracts by topic relevance.\nReturn strict JSON only.\nTopic: {topic}\nTitle: {title}\nAbstract: {abstract}\nDecide if the abstract clearly discusses the topic."
  };
  try {
    const promptPath = path.join(__dirname, "..", "Prompts", "api_prompts.json");
    const raw = fs.readFileSync(promptPath, "utf-8");
    const parsed = JSON.parse(raw);
    const node = parsed?.classify_abstract_topic_membership_v1 || {};
    return {
      promptKey: "classify_abstract_topic_membership_v1",
      system: toString(node?.content) || fallback.system,
      template: toString(node?.text || node?.prompt) || fallback.template
    };
  } catch {
    return fallback;
  }
}

function createTopicClassifierPromptSpec({
  topic,
  parentIdentifier,
  subfolderName,
  threshold = 0.6,
  classificationPolicy = "",
  inclusionCriteria = [],
  maybeCriteria = [],
  exclusionCriteria = []
}) {
  const normalizedTopic = cleanIdentifier(topic || "");
  const normalizedParent = cleanIdentifier(parentIdentifier || "");
  const normalizedSubfolder = cleanIdentifier(subfolderName || "");
  const thr = clamp01(threshold, 0.6);
  const policyText = cleanIdentifier(classificationPolicy || "");
  const inclusion = Array.isArray(inclusionCriteria) ? inclusionCriteria.map((x) => cleanIdentifier(x || "")).filter(Boolean) : [];
  const maybe = Array.isArray(maybeCriteria) ? maybeCriteria.map((x) => cleanIdentifier(x || "")).filter(Boolean) : [];
  const exclusion = Array.isArray(exclusionCriteria) ? exclusionCriteria.map((x) => cleanIdentifier(x || "")).filter(Boolean) : [];
  const criteriaBlock = (title, rows) =>
    [`${title}:`, ...(rows.length ? rows.map((line) => `- ${line}`) : ["- (none)"])].join("\n");
  return {
    promptKey: "classify_abstract_topic_membership_v1_dynamic",
    system:
      "You are a rigorous academic screening classifier for Zotero abstracts. Return strict JSON only.",
    template: [
      "Classify this abstract for topic-based folder screening.",
      `Target topic query: ${normalizedTopic || "{topic}"}`,
      `Target parent collection context: ${normalizedParent || "(active collection)"}`,
      `Target subfolder label: ${normalizedSubfolder || "(auto)"}`,
      `Inclusion confidence threshold downstream: ${thr.toFixed(2)}`,
      "",
      "Policy:",
      "- evaluate topical centrality using ONLY title and abstract.",
      "- included: only when the paper's PRIMARY objective/contribution is the target topic.",
      "- maybe: topic is present but secondary, peripheral, contextual, or ambiguous.",
      "- excluded: topic absent OR only broad domain overlap with no clear topical centrality.",
      "- avoid lexical false positives: keyword mention alone is not sufficient.",
      "- when uncertain, choose maybe (not included).",
      "",
      "Decision protocol (strict):",
      "- Gate 1 (subject match): title/abstract contain exact subject terms or clear synonyms.",
      "- Gate 2 (centrality): subject is framed as main objective/contribution, not background.",
      "- Gate 3 (contribution): abstract claims proposal/development/evaluation/comparison directly about the subject.",
      "- Gate 4 (operational specificity): abstract provides concrete structure/evidence (e.g., criteria, stages, variables, algorithm, protocol, evaluation setup, or benchmark).",
      "- Set included only if Gate 1 + Gate 2 + Gate 3 + Gate 4 pass.",
      "- If Gate 1 passes but Gate 2/3/4 are uncertain, set maybe.",
      "- If Gate 1 fails, set excluded.",
      `- policy summary: ${policyText || "Strict centrality classification policy."}`,
      "",
      criteriaBlock("Inclusion criteria", inclusion),
      "",
      criteriaBlock("Maybe criteria", maybe),
      "",
      criteriaBlock("Exclusion criteria", exclusion),
      "",
      "Output constraints:",
      "- output EXACTLY these fields: status, confidence, justification.",
      "- no extra fields.",
      "- confidence in [0,1], calibrated.",
      "- justification: concise rationale grounded in title+abstract lexical evidence.",
      "",
      "INPUT JSON:",
      "{\"title\":\"{title}\",\"abstract\":\"{abstract}\"}"
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["included", "maybe", "excluded"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        justification: { type: "string" }
      },
      required: ["status", "confidence", "justification"]
    }
  };
}

function batchContextForJob(job, manualByBatchId = new Map()) {
  const batchId = toString(job?.openaiBatchId);
  const manual = manualByBatchId.get(batchId) || null;
  const args = job?.runnerPayload?.payload?.args || {};
  const resultMeta = job?.result?.result || {};
  const parentIdentifier = cleanIdentifier(manual?.parentIdentifier || args?.parentIdentifier || "");
  const subfolderName = cleanIdentifier(
    manual?.subfolderName || args?.subfolderName || resultMeta?.subcollection?.name || ""
  );
  const topic = cleanIdentifier(manual?.topic || args?.topic || resultMeta?.topic || "");
  const classificationPolicy = cleanIdentifier(
    manual?.classificationPolicy || args?.classificationPolicy || resultMeta?.classificationPolicy || ""
  );
  const parseCriteria = (v) => (Array.isArray(v) ? v.map((x) => cleanIdentifier(x || "")).filter(Boolean) : []);
  const inclusionCriteria = parseCriteria(manual?.inclusionCriteria || args?.inclusionCriteria || resultMeta?.inclusionCriteria);
  const maybeCriteria = parseCriteria(manual?.maybeCriteria || args?.maybeCriteria || resultMeta?.maybeCriteria);
  const exclusionCriteria = parseCriteria(manual?.exclusionCriteria || args?.exclusionCriteria || resultMeta?.exclusionCriteria);
  const threshold = clamp01(manual?.confidenceThreshold ?? args?.confidenceThreshold, 0.6);
  const maxItems = Number.isFinite(Number(manual?.maxItems ?? args?.maxItems))
    ? Number(manual?.maxItems ?? args?.maxItems)
    : 0;
  const model = toString(
    job?.result?.result?.classifierMeta?.model || job?.result?.result?.classifierMeta?.model_name || ""
  ) || INTENT_CLASSIFIER_MODEL;
  return {
    parentIdentifier,
    subfolderName,
    topic,
    classificationPolicy,
    inclusionCriteria,
    maybeCriteria,
    exclusionCriteria,
    threshold,
    maxItems,
    model
  };
}

function readCachedBatchOutputRows(batchId, maxRows = 5000) {
  try {
    const p = openAIBatchOutputPath(batchId);
    if (!fs.existsSync(p)) return [];
    const text = fs.readFileSync(p, "utf-8");
    const rows = [];
    const lines = String(text || "").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj = null;
      try {
        obj = JSON.parse(line);
      } catch {
        obj = null;
      }
      if (!obj) continue;
      const parsed = parseOpenAIBatchLine(obj);
      rows.push({
        customId: toString(obj?.custom_id),
        itemKey: parsed.key,
        status: toString(parsed.status || "excluded"),
        isMatch: Boolean(parsed.is_match),
        confidence: Number(parsed.confidence || 0),
        themes: Array.isArray(parsed.themes) ? parsed.themes : [],
        subject: toString(parsed.subject || ""),
        reason: toString(parsed.reason || ""),
        suggestedTags: Array.isArray(parsed.suggested_tags) ? parsed.suggested_tags : [],
        raw: obj
      });
      if (rows.length >= Math.max(1, Number(maxRows) || 5000)) break;
    }
    return rows;
  } catch {
    return [];
  }
}

async function fetchOpenAIOutputLines(fileId, apiKey) {
  const url = `https://api.openai.com/v1/files/${encodeURIComponent(fileId)}/content`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    },
    35 * 1000
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI output fetch HTTP ${res.status}: ${(body || "").slice(0, 300)}`);
  }
  const text = await res.text();
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readCachedOpenAIOutputLines(batchId) {
  try {
    const p = openAIBatchOutputPath(batchId);
    if (!fs.existsSync(p)) return null;
    const text = fs.readFileSync(p, "utf-8");
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return lines.length ? lines : [];
  } catch {
    return null;
  }
}

function cacheOpenAIOutputLines(batchId, lines) {
  try {
    const p = openAIBatchOutputPath(batchId);
    const payload = (Array.isArray(lines) ? lines : [])
      .map((obj) => JSON.stringify(obj))
      .join("\n");
    fs.writeFileSync(p, payload ? `${payload}\n` : "", "utf-8");
  } catch (error) {
    dbg("cacheOpenAIOutputLines", `batchId=${batchId} error=${error?.message || "unknown"}`);
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message || `Operation timeout after ${timeoutMs}ms`));
    }, Math.max(1000, Number(timeoutMs) || 1000));
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isPostProcessingPhase(phase) {
  const p = toString(phase || "").toLowerCase();
  return p.includes("post-processing zotero");
}

async function applyRecoveredBatchToZotero({
  creds,
  parentIdentifier,
  subfolderName,
  topic,
  threshold,
  entries,
  onProgress
}) {
  const collections = await fetchAllCollections(creds);
  const indexes = buildCollectionIndexes(collections);
  const parentResolved = resolveCollectionIdentifier(parentIdentifier, indexes);
  if (!parentResolved.ok) {
    throw new Error(parentResolved.message || "Could not resolve target collection.");
  }
  const parent = parentResolved.collection;
  const findChildCollection = (parentKey, name) => {
    const children = indexes.byParent.get(parentKey) || [];
    return children.find((collection) => normalizeName(collection.name) === normalizeName(name)) || null;
  };
  const registerCreatedCollection = (collection) => {
    if (!collection?.key) return;
    indexes.byKey.set(collection.key, collection);
    if (!indexes.byParent.has(collection.parentKey || null)) indexes.byParent.set(collection.parentKey || null, []);
    indexes.byParent.get(collection.parentKey || null).push(collection);
  };
  const screeningFolders = buildScreeningFolderNames(topic || subfolderName || "topic");

  let screenCollection = findChildCollection(parent.key, screeningFolders.screen);
  if (!screenCollection) {
    const created = await createSubcollection(creds, parent.key, screeningFolders.screen);
    if (!created?.key) throw new Error("Could not create screening root subcollection.");
    screenCollection = {
      key: created.key,
      name: screeningFolders.screen,
      parentKey: parent.key,
      fullPath: `${parent.fullPath || parent.name}/${screeningFolders.screen}`
    };
    registerCreatedCollection(screenCollection);
  }
  const ensureBucketCollection = async (bucketName) => {
    let c = findChildCollection(screenCollection.key, bucketName);
    if (!c) {
      const created = await createSubcollection(creds, screenCollection.key, bucketName);
      if (!created?.key) throw new Error(`Could not create screening bucket '${bucketName}'.`);
      c = {
        key: created.key,
        name: bucketName,
        parentKey: screenCollection.key,
        fullPath: `${screenCollection.fullPath || screenCollection.name}/${bucketName}`
      };
      registerCreatedCollection(c);
    }
    return c;
  };
  const bucketCollections = {
    included: await ensureBucketCollection(screeningFolders.included),
    maybe: await ensureBucketCollection(screeningFolders.maybe),
    excluded: await ensureBucketCollection(screeningFolders.excluded)
  };

  const rows = await fetchCollectionTopItems(creds, parent.key, 0);
  const byKey = new Map(rows.map((row) => [toString(row?.key), row]));
  const classifyBucket = (entry) => {
    const status = toString(entry?.status || "").toLowerCase();
    const conf = Number(entry?.confidence || 0);
    if (status === "included" && conf >= threshold) return "included";
    if (status === "excluded") return "excluded";
    return "maybe";
  };
  const bucketed = { included: [], maybe: [], excluded: [] };
  for (const entry of entries) {
    if (!byKey.has(entry.key)) continue;
    bucketed[classifyBucket(entry)].push(entry);
  }
  const matches = bucketed.included;
  const totalToWrite = bucketed.included.length + bucketed.maybe.length + bucketed.excluded.length;
  if (typeof onProgress === "function") {
    onProgress({
      processed: 0,
      total: totalToWrite,
      stage: "matching"
    });
  }

  let added = 0;
  let addedIncluded = 0;
  let addedMaybe = 0;
  let addedExcluded = 0;
  let skippedExisting = 0;
  let processed = 0;
  const failed = [];
  const addEntriesToBucket = async (entriesForBucket, bucketKey, counterKey) => {
    for (let i = 0; i < entriesForBucket.length; i += 1) {
      const entry = entriesForBucket[i];
      const raw = byKey.get(entry.key);
      try {
        if (!raw) {
          failed.push({ key: entry.key, title: entry.title || "", message: "Missing source item in collection snapshot." });
        } else {
          const existingCollections = Array.isArray(raw?.data?.collections) ? raw.data.collections : [];
          if (existingCollections.includes(bucketKey)) {
            skippedExisting += 1;
          } else {
            await addItemToCollection(creds, bucketKey, raw);
            added += 1;
            if (counterKey === "included") addedIncluded += 1;
            if (counterKey === "maybe") addedMaybe += 1;
            if (counterKey === "excluded") addedExcluded += 1;
          }

          if (counterKey === "included") {
            const normalizedTopicTag = topic.replace(/\s+/g, "_").toLowerCase();
            const tagsToAdd = Array.from(new Set([normalizedTopicTag, ...(entry.suggested_tags || []).slice(0, 6)]));
            try {
              await updateItemTags(creds, entry.key, tagsToAdd);
            } catch (error) {
              failed.push({ key: entry.key, title: entry.title || "", message: error?.message || "Failed to update tags." });
            }
          }
        }
      } catch (error) {
        failed.push({ key: entry.key, title: entry.title || "", message: error?.message || "Failed to add item." });
      } finally {
        processed += 1;
        if (typeof onProgress === "function") {
          onProgress({
            processed,
            total: totalToWrite,
            added,
            skippedExisting,
            failed: failed.length,
            stage: "writing"
          });
        }
      }
    }
  };
  await addEntriesToBucket(bucketed.included, bucketCollections.included.key, "included");
  await addEntriesToBucket(bucketed.maybe, bucketCollections.maybe.key, "maybe");
  await addEntriesToBucket(bucketed.excluded, bucketCollections.excluded.key, "excluded");

  return {
    parent: { key: parent.key, name: parent.name, path: parent.fullPath || parent.name },
    subcollection: { key: screenCollection.key, name: screenCollection.name, path: screenCollection.fullPath || screenCollection.name },
    screeningSubfolders: {
      included: screeningFolders.included,
      maybe: screeningFolders.maybe,
      excluded: screeningFolders.excluded
    },
    topic,
    screenedItems: entries.length,
    matchedItems: matches.length,
    addedItems: added,
    addedIncluded,
    addedMaybe,
    addedExcluded,
    bucketedItems: {
      included: bucketed.included.length,
      maybe: bucketed.maybe.length,
      excluded: bucketed.excluded.length
    },
    skippedExisting,
    failed
  };
}

async function finalizeRecoveredOpenAIBatchJob({
  job,
  batchId,
  statusRaw = "completed",
  terminalAtMs = 0,
  recoveryParentIdentifier,
  recoverySubfolderName,
  recoveryTopic,
  recoveryThreshold = 0.6,
  apiKey = "",
  outputFileId = "",
  now = Date.now()
}) {
  if (!job || !batchId) return { changed: false, attempted: false };
  if (!(recoveryParentIdentifier && recoveryTopic)) return { changed: false, attempted: false };
  if (job?.result?.result?.recoveryApplied === true) return { changed: false, attempted: false };

  job._postProcessHeartbeatAt = Date.now();
  job.status = "running";
  job.progress = Math.max(92, Number(job.progress || 0));
  job.phase = "Resolving batch output";
  job.finishedAt = 0;
  job.error = "";
  broadcastFeatureJobStatus(job);

  try {
    let lines = readCachedOpenAIOutputLines(batchId);
    if (!Array.isArray(lines)) {
      if (!outputFileId || !apiKey) {
        throw new Error("OpenAI batch output unavailable (missing cached lines and output file id).");
      }
      job.phase = "Downloading batch output";
      job._postProcessHeartbeatAt = Date.now();
      broadcastFeatureJobStatus(job);
      lines = await fetchOpenAIOutputLines(outputFileId, apiKey);
      cacheOpenAIOutputLines(batchId, lines);
    } else {
      job.phase = "Using cached batch output";
      job._postProcessHeartbeatAt = Date.now();
      broadcastFeatureJobStatus(job);
    }

    const rawLines = Array.isArray(lines) ? lines : [];
    job.phase = `Parsing batch output (${rawLines.length} lines)`;
    job._postProcessHeartbeatAt = Date.now();
    broadcastFeatureJobStatus(job);

    job.status = "running";
    job.progress = Math.max(96, Number(job.progress || 0));
    job.phase = "Post-processing Zotero subfolder/items";
    job._postProcessHeartbeatAt = Date.now();
    broadcastFeatureJobStatus(job);

    const entries = rawLines.map(parseOpenAIBatchLine).filter((x) => x.key);
    const creds = getCredentials();
    const applied = await withTimeout(
      applyRecoveredBatchToZotero({
        creds,
        parentIdentifier: recoveryParentIdentifier,
        subfolderName: recoverySubfolderName,
        topic: recoveryTopic,
        threshold: recoveryThreshold,
        entries,
        onProgress: (p = {}) => {
          const processed = Number(p.processed || 0);
          const total = Math.max(0, Number(p.total || 0));
          const frac = total > 0 ? Math.max(0, Math.min(1, processed / total)) : 1;
          job.status = "running";
          job.progress = Math.max(96, Math.min(99, 96 + Math.round(frac * 3)));
          const added = Number(p.added || 0);
          const skipped = Number(p.skippedExisting || 0);
          const failed = Number(p.failed || 0);
          job.phase = `Post-processing Zotero ${processed}/${total} (added=${added}, skipped=${skipped}, failed=${failed})`;
          job._postProcessHeartbeatAt = Date.now();
          const emitByCount = processed <= 1 || processed === total || processed % 25 === 0;
          const emitByTime = (() => {
            const nowTs = Date.now();
            const prevTs = Number(job._lastProgressEmitAt || 0);
            if (nowTs - prevTs >= 1200) {
              job._lastProgressEmitAt = nowTs;
              return true;
            }
            return false;
          })();
          if (emitByCount || emitByTime) {
            broadcastFeatureJobStatus(job);
          }
        }
      }),
      OPENAI_POSTPROCESS_TIMEOUT_MS,
      "Recovered batch post-processing timed out."
    );

    job.status = "completed";
    job.progress = 100;
    job.phase = "Post-processing completed";
    job.finishedAt = terminalAtMs || now;
    job.error = "";
    job.result = {
      status: "ok",
      result: {
        ...applied,
        recoveryApplied: true,
        classifierMeta: {
          batch_id: batchId,
          status: statusRaw
        }
      }
    };
    delete job._lastProgressEmitAt;
    delete job._postProcessHeartbeatAt;
    return { changed: true, attempted: true };
  } catch (error) {
    job.status = "failed";
    job.progress = 100;
    job.phase = "Post-processing failed";
    job.finishedAt = terminalAtMs || now;
    job.error = error?.message || "Recovered batch finalize failed.";
    job.result = {
      status: "error",
      message: job.error,
      result: {
        recoveryApplied: false,
        classifierMeta: {
          batch_id: batchId,
          status: statusRaw
        }
      }
    };
    delete job._lastProgressEmitAt;
    delete job._postProcessHeartbeatAt;
    return { changed: true, attempted: true };
  }
}

async function reconcileOpenAIBatchJobs(force = false) {
  if (openAIBatchReconcileInFlight) return;
  openAIBatchReconcileInFlight = true;
  const apiKey = toString(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    openAIBatchReconcileInFlight = false;
    return;
  }
  const now = nowMs();
  if (!force && now - lastOpenAIBatchesSyncAt < OPENAI_BATCH_SYNC_COOLDOWN_MS) {
    openAIBatchReconcileInFlight = false;
    return;
  }
  lastOpenAIBatchesSyncAt = now;

  try {
    const manualLinks = readManualOpenAIBatchLinks();
    const manualByBatchId = new Map(manualLinks.map((x) => [x.batchId, x]));
    const purgedBatchIds = readPurgedOpenAIBatchesSet();
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/batches?limit=50",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      },
      20 * 1000
    );
    if (!res.ok) {
      const body = await res.text();
      dbg("reconcileOpenAIBatchJobs", `http=${res.status} body=${(body || "").slice(0, 500)}`);
      return;
    }
    const payload = await res.json();
    const list = Array.isArray(payload?.data) ? [...payload.data] : [];
    const listedIds = new Set(list.map((b) => toString(b?.id)).filter(Boolean));
    const pendingKnownIds = featureJobs
      .filter((j) => {
        const bid = toString(j?.openaiBatchId);
        if (!bid) return false;
        const st = toString(j?.status);
        const needsRecovery = st === "completed" && !(j?.result?.result?.recoveryApplied === true);
        return !isTerminalJobStatus(st) || needsRecovery;
      })
      .map((j) => toString(j?.openaiBatchId))
      .filter((id) => id && !listedIds.has(id));
    for (const batchId of pendingKnownIds) {
      try {
        const oneRes = await fetchWithTimeout(
          `https://api.openai.com/v1/batches/${encodeURIComponent(batchId)}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            }
          },
          20 * 1000
        );
        if (!oneRes.ok) continue;
        const one = await oneRes.json();
        if (one && typeof one === "object" && toString(one?.id) === batchId) {
          list.push(one);
          listedIds.add(batchId);
        }
      } catch {
        // best-effort hydration for pending known batches
      }
    }
    let changed = false;
    const changedJobIds = new Set();

    const seenBatchIds = new Set();
    for (const batch of list) {
      const batchId = toString(batch?.id);
      if (!batchId) continue;
      seenBatchIds.add(batchId);
      if (purgedBatchIds.has(batchId)) continue;
      {
        const endpoint = toString(batch?.endpoint);
        if (endpoint !== "/v1/chat/completions" && endpoint !== "/v1/responses") continue;
      }

      const metadata = batch?.metadata && typeof batch.metadata === "object" ? batch.metadata : {};
      const source = toString(metadata?.source);
      const metadataParentIdentifier = cleanIdentifier(
        metadata?.collection_key || metadata?.parentIdentifier || metadata?.parent_identifier || ""
      );
      const metadataTopic = cleanIdentifier(metadata?.topic || "");
      const metadataSubfolderRaw = cleanIdentifier(
        metadata?.subfolder_name || metadata?.subfolderName || metadata?.folder || ""
      );
      const metadataSubfolderName = sanitizeSubfolderName(metadataSubfolderRaw || metadataTopic || "");
      const metadataMaxItems = Number.isFinite(Number(metadata?.maxItems || metadata?.max_items))
        ? Number(metadata?.maxItems || metadata?.max_items)
        : 0;
      const metadataThreshold = clamp01(
        metadata?.confidenceThreshold ?? metadata?.confidence_threshold,
        0.6
      );
      const statusRaw = toString(batch?.status || "");
      const status = mapOpenAIBatchStatus(statusRaw);
      const createdAtMs = Number(batch?.created_at || 0) * 1000;
      const oldTerminal = isTerminalJobStatus(status) && createdAtMs > 0 && now - createdAtMs > 3 * 24 * 60 * 60 * 1000;
      if (oldTerminal) continue;
      if (source && source !== "electron_zotero_topic_classifier") continue;

      let job = featureJobs.find((j) => toString(j?.openaiBatchId) === batchId) || featureJobMap.get(`openai_${batchId}`) || null;
      const manual = manualByBatchId.get(batchId) || null;
      const counts = batch?.request_counts && typeof batch.request_counts === "object" ? batch.request_counts : {};
      const total = Number(counts?.total || 0);
      const done = Number(counts?.completed || 0) + Number(counts?.failed || 0);
      const progress = isTerminalJobStatus(status) ? 100 : total > 0 ? Math.max(10, Math.min(99, Math.floor((done / total) * 100))) : 60;
      const terminalAtMs = Number(batch?.completed_at || batch?.failed_at || batch?.expired_at || batch?.cancelled_at || 0) * 1000;
      const errMsg = toString(batch?.errors?.data?.[0]?.message || batch?.errors?.message || "");

      if (!job) {
        job = {
          id: `openai_${batchId}`,
          functionName: "workflow.create_subfolder_by_topic",
          status,
          progress,
          phase:
            status === "completed"
              ? "OpenAI batch completed"
              : status === "failed"
                ? "OpenAI batch failed"
                : "Waiting for OpenAI batch",
          runnerPayload: manual
            ? {
                kind: "workflow.create_subfolder_by_topic",
                payload: {
                  recoveredFromOpenAI: true,
                  args: {
                    parentIdentifier: manual.parentIdentifier || metadataParentIdentifier,
                    subfolderName: manual.subfolderName || metadataSubfolderName,
                    topic: manual.topic || metadataTopic,
                    confidenceThreshold:
                      manual.confidenceThreshold ?? metadataThreshold,
                    maxItems: manual.maxItems || metadataMaxItems
                  }
                }
              }
            : {
                kind: "workflow.create_subfolder_by_topic",
                payload: {
                  recoveredFromOpenAI: true,
                  args: normalizeWorkflowArgs({
                    parentIdentifier: metadataParentIdentifier,
                    subfolderName: metadataSubfolderName,
                    topic: metadataTopic,
                    confidenceThreshold: metadataThreshold,
                    maxItems: metadataMaxItems
                  })
                }
              },
          openaiBatchId: batchId,
          external: true,
          createdAt: createdAtMs || now,
          startedAt: Number(batch?.in_progress_at || 0) * 1000 || createdAtMs || now,
          finishedAt: isTerminalJobStatus(status) ? (terminalAtMs || now) : 0,
          error: status === "failed" ? errMsg : "",
          result: {
            status: isTerminalJobStatus(status) ? (status === "completed" ? "ok" : "error") : "running",
            result: {
              classifierMeta: {
                batch_id: batchId,
                status: statusRaw
              }
            },
            message: status === "failed" ? (errMsg || "OpenAI batch failed.") : ""
          }
        };
        featureJobs.push(job);
        featureJobMap.set(job.id, job);
        changed = true;
        changedJobIds.add(job.id);
      }

      const prevSig = `${job.status}|${job.progress}|${job.error}|${job.finishedAt}`;
      if (manual) {
        job.runnerPayload = {
          kind: "workflow.create_subfolder_by_topic",
          payload: {
            ...(job.runnerPayload?.payload || {}),
            recoveredFromOpenAI: true,
              args: {
              parentIdentifier: manual.parentIdentifier || metadataParentIdentifier,
              subfolderName: manual.subfolderName || metadataSubfolderName,
              topic: manual.topic || metadataTopic,
              confidenceThreshold:
                manual.confidenceThreshold ?? metadataThreshold,
              maxItems: manual.maxItems || metadataMaxItems
            }
          }
        };
      } else {
        const prevArgs = job?.runnerPayload?.payload?.args || {};
        const fallbackParentIdentifier =
          cleanIdentifier(
            prevArgs.parentIdentifier ||
              metadataParentIdentifier ||
              lastWorkflowContext.selectedCollectionKey ||
              inferRecentCollectionKeyFromMemory() ||
              lastWorkflowContext.selectedCollectionName ||
              ""
          );
        const isFrameworksRecoveryBatch = batchId === "batch_69983b25641481909c818a87315c5de3";
        const fallbackTopic = cleanIdentifier(prevArgs.topic || metadataTopic || (isFrameworksRecoveryBatch ? "frameworks" : ""));
        const fallbackSubfolder = sanitizeSubfolderName(
          prevArgs.subfolderName ||
            metadataSubfolderName ||
            (isFrameworksRecoveryBatch ? "frameworks" : "") ||
            fallbackTopic
        );
        const normalizedFallbackArgs = normalizeWorkflowArgs({
          parentIdentifier: fallbackParentIdentifier,
          subfolderName: fallbackSubfolder,
          topic: fallbackTopic,
          confidenceThreshold: prevArgs.confidenceThreshold ?? metadataThreshold,
          maxItems: prevArgs.maxItems || metadataMaxItems
        });
        if (normalizedFallbackArgs.parentIdentifier && normalizedFallbackArgs.subfolderName && normalizedFallbackArgs.topic) {
          job.runnerPayload = {
            kind: "workflow.create_subfolder_by_topic",
            payload: {
              ...(job.runnerPayload?.payload || {}),
              recoveredFromOpenAI: true,
              args: normalizedFallbackArgs
            }
          };
          const existingManual = readManualOpenAIBatchLinks();
          const nextManual = existingManual.filter((row) => toString(row?.batchId) !== batchId);
          nextManual.push({
            batchId,
            parentIdentifier: normalizedFallbackArgs.parentIdentifier,
            subfolderName: normalizedFallbackArgs.subfolderName,
            topic: normalizedFallbackArgs.topic,
            confidenceThreshold: normalizedFallbackArgs.confidenceThreshold,
            maxItems: normalizedFallbackArgs.maxItems
          });
          writeManualOpenAIBatchLinks(nextManual);
        }
      }
      job.openaiBatchId = batchId;
      if (job.external !== true && String(job.id || "").startsWith("openai_")) job.external = true;
      if (isTerminalJobStatus(status)) job.status = status;
      else if (!isTerminalJobStatus(job.status)) job.status = status;
      if (!isTerminalJobStatus(job.status)) job.progress = Math.max(Number(job.progress || 0), progress);
      else job.progress = 100;
      if (!job.startedAt) job.startedAt = Number(batch?.in_progress_at || 0) * 1000 || createdAtMs || now;
      if (isTerminalJobStatus(job.status) && !job.finishedAt) job.finishedAt = terminalAtMs || now;
      if (job.status === "failed" && errMsg) job.error = errMsg;
      if (job.status === "queued") {
        job.phase = "Queued for OpenAI sync";
      } else if (job.status === "running") {
        job.phase = total > 0 ? `Waiting for OpenAI batch (${done}/${total})` : "Waiting for OpenAI batch";
      } else if (job.status === "completed" && !(job?.result?.result?.recoveryApplied === true)) {
        const pArgs = job?.runnerPayload?.payload?.args || {};
        const hasRecoveryArgs = Boolean(
          cleanIdentifier(manual?.parentIdentifier || pArgs?.parentIdentifier || "") &&
            cleanIdentifier(manual?.topic || pArgs?.topic || "")
        );
        job.phase = hasRecoveryArgs ? "OpenAI done, pending post-processing" : "OpenAI batch completed (no collection mapping)";
      } else if (job.status === "failed") {
        job.phase = errMsg ? `OpenAI failed: ${errMsg}` : "OpenAI batch failed";
      }
      if (job.result && typeof job.result === "object") {
        job.result.status = isTerminalJobStatus(job.status) ? (job.status === "completed" ? "ok" : "error") : "running";
        if (job.result.result && typeof job.result.result === "object") {
          job.result.result.classifierMeta = {
            ...(job.result.result.classifierMeta || {}),
            batch_id: batchId,
            status: statusRaw
          };
        }
      }

      const pArgs = job?.runnerPayload?.payload?.args || {};
      const recoveryParentIdentifier = cleanIdentifier(manual?.parentIdentifier || pArgs?.parentIdentifier || "");
      const recoverySubfolderName = cleanIdentifier(manual?.subfolderName || pArgs?.subfolderName || "");
      const recoveryTopic = cleanIdentifier(manual?.topic || pArgs?.topic || "");
      const recoveryThreshold = clamp01(
        manual?.confidenceThreshold ?? pArgs?.confidenceThreshold,
        0.6
      );
      const needsRecoveryFinalize =
        status === "completed" &&
        Boolean(recoveryParentIdentifier && recoveryTopic) &&
        !(job?.result?.result?.recoveryApplied === true);
      if (needsRecoveryFinalize) {
        const finalize = await finalizeRecoveredOpenAIBatchJob({
          job,
          batchId,
          statusRaw,
          terminalAtMs,
          recoveryParentIdentifier,
          recoverySubfolderName,
          recoveryTopic,
          recoveryThreshold,
          apiKey,
          outputFileId: toString(batch?.output_file_id || ""),
          now
        });
        if (finalize.changed) {
          changed = true;
          changedJobIds.add(job.id);
        }
      }

      const nextSig = `${job.status}|${job.progress}|${job.error}|${job.finishedAt}`;
      if (prevSig !== nextSig) changed = true;
      if (prevSig !== nextSig) changedJobIds.add(job.id);
    }

    for (const job of featureJobs) {
      const fn = toString(job?.functionName);
      if (fn !== "workflow.create_subfolder_by_topic") continue;
      const batchId = toString(job?.openaiBatchId);
      if (!batchId || purgedBatchIds.has(batchId)) continue;
      if (seenBatchIds.has(batchId)) continue;
      if (job?.result?.result?.recoveryApplied === true) continue;
      const status = toString(job?.status);
      if (status !== "running" && status !== "completed") continue;

      const pArgs = job?.runnerPayload?.payload?.args || {};
      const recoveryParentIdentifier = cleanIdentifier(pArgs?.parentIdentifier || "");
      const recoverySubfolderName = cleanIdentifier(pArgs?.subfolderName || "");
      const recoveryTopic = cleanIdentifier(pArgs?.topic || "");
      const recoveryThreshold = clamp01(pArgs?.confidenceThreshold, 0.6);
      if (!(recoveryParentIdentifier && recoveryTopic)) continue;
      if (!Array.isArray(readCachedOpenAIOutputLines(batchId))) continue;

      const phase = toString(job?.phase || "");
      const staleBase = Math.max(
        Number(job?._postProcessHeartbeatAt || 0),
        Number(job?._lastProgressEmitAt || 0),
        Number(job?.startedAt || 0)
      );
      const staleMs = Math.max(0, now - staleBase);
      const stalePostProcess = isPostProcessingPhase(phase) && staleMs >= OPENAI_POSTPROCESS_STALE_MS;
      const needsCatchupFinalize = status === "completed" || stalePostProcess;
      if (!needsCatchupFinalize) continue;

      const finalize = await finalizeRecoveredOpenAIBatchJob({
        job,
        batchId,
        statusRaw: toString(job?.result?.result?.classifierMeta?.status || "completed"),
        terminalAtMs: Number(job?.finishedAt || 0),
        recoveryParentIdentifier,
        recoverySubfolderName,
        recoveryTopic,
        recoveryThreshold,
        apiKey: "",
        outputFileId: "",
        now
      });
      if (finalize.changed) {
        changed = true;
        changedJobIds.add(job.id);
      }
    }

    if (changed) {
      persistFeatureJobsState();
      for (const jobId of changedJobIds) {
        const job = featureJobMap.get(jobId);
        if (job) broadcastFeatureJobStatus(job);
      }
    }
  } catch (error) {
    dbg("reconcileOpenAIBatchJobs", `error message=${error?.message || "unknown"}`);
  } finally {
    openAIBatchReconcileInFlight = false;
  }
}

function hasPendingOpenAIBatchJobs() {
  return featureJobs.some((job) => {
    const fn = toString(job?.functionName);
    if (fn !== "workflow.create_subfolder_by_topic") return false;
    const batchId = toString(job?.openaiBatchId);
    if (!batchId) return false;
    const status = toString(job?.status);
    if (status === "queued" || status === "running") return true;
    if (status === "completed") {
      return !(job?.result?.result?.recoveryApplied === true);
    }
    return false;
  });
}

function isDestructiveFunction(functionName) {
  return new Set([
    "_append_to_tagged_note",
    "split_collection_by_status_tag",
    "classify_by_title",
    "screening_articles",
    "_classification_12_features",
    "download_pdfs_from_collections"
  ]).has(functionName);
}

function resolveFeatureDescriptor(functionName, signatures = {}) {
  const listed = getFeatureByFunctionName(functionName, signatures);
  if (listed) return listed;
  const sig = signatures?.[functionName];
  if (sig && typeof sig === "object") {
    return {
      id: `hidden.${functionName}`,
      tab: "Hidden",
      group: "Hidden",
      functionName,
      label: functionName,
      args: Array.isArray(sig.args) ? sig.args : []
    };
  }
  return null;
}

async function processNextFeatureJob() {
  if (activeFeatureJob) return;
  const next = featureJobs.find((j) => j.status === "queued");
  if (!next) return;
  activeFeatureJob = next;
  next.status = "running";
  next.progress = 10;
  next.phase = "Preparing workflow";
  next.startedAt = Date.now();
  broadcastFeatureJobStatus(next);

  const timer = setInterval(() => {
    if (!activeFeatureJob || activeFeatureJob.id !== next.id) return;
    next.progress = Math.min(95, next.progress + 7);
    broadcastFeatureJobStatus(next);
  }, 1200);

  try {
    let res = null;
    if (next?.runnerPayload?.kind === "workflow.create_subfolder_by_topic") {
      res = await executeCreateSubfolderByTopicWorkflow(next.runnerPayload.payload || {});
    } else {
      res = await featureWorker.run(next.runnerPayload);
    }

    if (next.status === "canceled") {
      activeFeatureJob = null;
      await processNextFeatureJob();
      return;
    }

    if (res?.status === "ok") {
      const pendingBatch = res?.result?.pendingBatch === true;
      next.result = res;
      const batchId = toString(res?.result?.classifierMeta?.batch_id || "");
      if (batchId) next.openaiBatchId = batchId;
      if (pendingBatch && batchId) {
        next.status = "running";
        next.progress = Math.max(20, Number(next.progress || 0));
        next.phase = "Waiting for OpenAI batch";
        next.finishedAt = 0;
        try {
          const args = next?.runnerPayload?.payload?.args || {};
          const parentIdentifier = cleanIdentifier(args?.parentIdentifier || "");
          const subfolderName = cleanIdentifier(args?.subfolderName || "");
          const topic = cleanIdentifier(args?.topic || "");
          if (parentIdentifier && subfolderName && topic) {
            const existing = readManualOpenAIBatchLinks();
            const dedup = existing.filter((row) => toString(row?.batchId) !== batchId);
            dedup.push({
              batchId,
              parentIdentifier,
              subfolderName,
              topic,
              confidenceThreshold: clamp01(args?.confidenceThreshold, 0.6),
              maxItems: Number.isFinite(Number(args?.maxItems)) ? Number(args.maxItems) : 0
            });
            writeManualOpenAIBatchLinks(dedup);
          }
        } catch {
          // best-effort only
        }
        void reconcileOpenAIBatchJobs(true);
      } else if (pendingBatch && !batchId) {
        next.status = "failed";
        next.progress = 100;
        next.phase = "Failed";
        next.error = "Batch submission reported pending but no batch_id was returned.";
        next.finishedAt = Date.now();
      } else {
        next.status = "completed";
        next.progress = 100;
        next.phase = "Completed";
        next.finishedAt = Date.now();
      }
    } else {
      next.status = "failed";
      next.progress = 100;
      next.phase = "Failed";
      next.error = res?.message || "Feature job failed.";
      next.result = res || null;
      next.finishedAt = Date.now();
    }
    broadcastFeatureJobStatus(next);
  } catch (error) {
    next.status = "failed";
    next.progress = 100;
    next.phase = "Failed";
    next.error = error?.message || "Feature job crashed.";
    next.result = {
      status: "error",
      message: next.error
    };
    next.finishedAt = Date.now();
    broadcastFeatureJobStatus(next);
  } finally {
    clearInterval(timer);
    activeFeatureJob = null;
    await processNextFeatureJob();
  }
}

async function fetchAllCollections(creds) {
  const all = [];
  let start = 0;

  while (true) {
    const url = `${zoteroBase(creds)}/collections?limit=${DEFAULT_LIMIT}&start=${start}`;
    const res = await fetchWithTimeout(url, { headers: headers(creds) });
    if (!res.ok) throw new Error(`Collections HTTP ${res.status}`);

    const data = await res.json();
    const batch = Array.isArray(data) ? data : [];
    batch.forEach((c) => {
      const d = c?.data || {};
      const rawCount = c?.meta?.numItems ?? d?.numItems;
      const itemCount = Number.isFinite(Number(rawCount)) ? Number(rawCount) : null;
      all.push({
        key: c?.key || "",
        name: d?.name || "Untitled",
        parentKey: d?.parentCollection || null,
        version: c?.version || 0,
        itemCount
      });
    });

    const total = Number(res.headers.get("Total-Results") || 0);
    if (batch.length < DEFAULT_LIMIT || start + DEFAULT_LIMIT >= total) break;
    start += DEFAULT_LIMIT;
  }

  return all;
}

async function fetchCollectionItemsPreview(creds, collectionKey, max = 500) {
  const items = [];
  let start = 0;
  const limitAll = !Number.isFinite(Number(max)) || Number(max) <= 0;
  const cap = limitAll ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(Number(max)));
  const prefix = zoteroLibraryPrefix(creds);
  let truncated = false;
  let safetyPages = 0;

  while (true) {
    safetyPages += 1;
    if (safetyPages > 500) {
      dbg("fetchCollectionItemsPreview", `safety-break collectionKey=${collectionKey} pages=${safetyPages}`);
      break;
    }
    const url =
      `${zoteroBase(creds)}/collections/${encodeURIComponent(collectionKey)}/items` +
      `?limit=50&start=${start}`;
    const res = await fetchWithTimeout(url, { headers: headers(creds) });
    if (!res.ok) {
      const body = await res.text();
      dbg(
        "fetchCollectionItemsPreview",
        `error collectionKey=${collectionKey} start=${start} status=${res.status} url=${url} body=${body || "(empty)"}`
      );
      throw new Error(`Items HTTP ${res.status}`);
    }

    const data = await res.json();
    const batch = Array.isArray(data) ? data : [];
    if (batch.length === 0) break;

    batch.forEach((item) => {
      const d = item?.data || {};
      const itemType = String(d?.itemType || "").toLowerCase();
      if (itemType === "attachment" || itemType === "note" || itemType === "annotation") {
        return;
      }
      const creators = Array.isArray(d?.creators)
        ? d.creators
            .map((c) => `${c?.firstName || ""} ${c?.lastName || ""}`.trim())
            .filter(Boolean)
        : [];

      const children = Array.isArray(item?.children) ? item.children : [];
      let attachments = 0;
      let pdfs = 0;
      let notes = 0;
      let annotations = 0;
      let firstPdfAttachmentKey = "";

      children.forEach((child) => {
        const cd = child?.data || {};
        const type = String(cd?.itemType || "");
        if (type === "attachment") {
          attachments += 1;
          const ct = String(cd?.contentType || "").toLowerCase();
          const filename = String(cd?.filename || cd?.title || "").toLowerCase();
          const isPdf = ct.includes("pdf") || filename.endsWith(".pdf");
          if (isPdf) {
            pdfs += 1;
            if (!firstPdfAttachmentKey) {
              firstPdfAttachmentKey = String(child?.key || "");
            }
          }
          return;
        }
        if (type === "note") notes += 1;
        if (type === "annotation") annotations += 1;
      });

      items.push({
        key: item?.key || "",
        version: Number(item?.version || 0),
        title: d?.title || "(untitled)",
        authors: creators.join("; "),
        year: d?.date || "",
        date: d?.date || "",
        itemType: d?.itemType || "",
        doi: d?.DOI || d?.doi || "",
        url: d?.url || "",
        dateModified: d?.dateModified || "",
        citationCount: Number(d?.citationCount || 0) || 0,
        abstract: d?.abstractNote || "",
        publicationTitle: d?.publicationTitle || d?.bookTitle || d?.proceedingsTitle || "",
        containerTitle: d?.publicationTitle || d?.bookTitle || d?.proceedingsTitle || "",
        journalAbbreviation: d?.journalAbbreviation || "",
        volume: d?.volume || "",
        issue: d?.issue || "",
        pages: d?.pages || "",
        publisher: d?.publisher || "",
        place: d?.place || "",
        language: d?.language || "",
        rights: d?.rights || "",
        series: d?.series || "",
        seriesTitle: d?.seriesTitle || "",
        seriesNumber: d?.seriesNumber || "",
        section: d?.section || "",
        edition: d?.edition || "",
        numPages: d?.numPages || "",
        isbn: d?.ISBN || "",
        issn: d?.ISSN || "",
        archive: d?.archive || "",
        archiveLocation: d?.archiveLocation || "",
        callNumber: d?.callNumber || "",
        libraryCatalog: d?.libraryCatalog || "",
        extra: d?.extra || "",
        tags: Array.isArray(d?.tags)
          ? d.tags.map((t) => String(t?.tag || "").trim()).filter(Boolean)
          : [],
        collections: Array.isArray(d?.collections) ? d.collections.filter(Boolean) : [],
        creators: Array.isArray(d?.creators)
          ? d.creators
              .map((c) => {
                const name = `${c?.firstName || ""} ${c?.lastName || ""}`.trim() || String(c?.name || "").trim();
                if (!name) return null;
                return { name, creatorType: String(c?.creatorType || "") };
              })
              .filter(Boolean)
          : [],
        attachments,
        pdfs,
        notes,
        annotations,
        hasPdf: pdfs > 0,
        zoteroSelectUrl: `zotero://select/${prefix}/items/${item?.key || ""}`,
        zoteroOpenPdfUrl: firstPdfAttachmentKey
          ? `zotero://open-pdf/${prefix}/items/${firstPdfAttachmentKey}?page=1`
          : "",
        firstPdfAttachmentKey
      });
    });

    const reachedEnd = batch.length < 50;
    if (items.length >= cap) {
      if (!limitAll && !reachedEnd) truncated = true;
      break;
    }
    if (reachedEnd) break;
    start += 50;
  }

  const out = limitAll ? items : items.slice(0, cap);
  return {
    items: out,
    truncated: truncated === true,
    cap: limitAll ? 0 : cap
  };
}

async function ensureFullCollectionItems(creds, collectionKey, refresh = false) {
  if (!refresh) {
    const memory = getMemoryFullItems(collectionKey);
    if (memory) return memory;
    const disk = getDiskFullItems(collectionKey);
    if (disk) {
      setMemoryFullItems(collectionKey, disk);
      return disk;
    }
  }

  if (inFlight.fullItems.has(collectionKey)) {
    return inFlight.fullItems.get(collectionKey);
  }

  const request = fetchCollectionItemsPreview(creds, collectionKey, 0)
    .then((payload) => {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setMemoryFullItems(collectionKey, items);
      setDiskFullItems(collectionKey, items);
      return items;
    })
    .catch((error) => {
      const fallback =
        getMemoryFullItems(collectionKey) ||
        getDiskFullItems(collectionKey) ||
        getMemoryItems(collectionKey) ||
        getDiskItems(collectionKey) ||
        [];
      if (fallback.length) {
        dbg(
          "ensureFullCollectionItems",
          `collectionKey=${collectionKey} source=cache_fallback count=${fallback.length} reason=${error?.message || "fetch_failed"}`
        );
        return fallback;
      }
      throw error;
    })
    .finally(() => {
      inFlight.fullItems.delete(collectionKey);
    });

  inFlight.fullItems.set(collectionKey, request);
  return request;
}

async function fetchItemChildren(creds, itemKey) {
  const children = [];
  let start = 0;

  while (true) {
    const url = `${zoteroBase(creds)}/items/${encodeURIComponent(itemKey)}/children?limit=${DEFAULT_LIMIT}&start=${start}`;
    const res = await fetchWithTimeout(url, { headers: headers(creds) });
    if (!res.ok) throw new Error(`Children HTTP ${res.status}`);

    const data = await res.json();
    const batch = Array.isArray(data) ? data : [];

    batch.forEach((child) => {
      const d = child?.data || {};
      children.push({
        key: child?.key || "",
        itemType: d?.itemType || "",
        title: d?.title || d?.filename || "",
        parentItem: d?.parentItem || "",
        contentType: d?.contentType || "",
        filename: d?.filename || "",
        linkMode: d?.linkMode || "",
        note: typeof d?.note === "string" ? d.note : "",
        url: d?.url || ""
      });
    });

    const total = Number(res.headers.get("Total-Results") || 0);
    if (batch.length < DEFAULT_LIMIT || start + DEFAULT_LIMIT >= total) break;
    start += DEFAULT_LIMIT;
  }

  return children;
}

async function fetchCollectionTopItems(creds, collectionKey, maxItems = AGENT_MAX_SCAN_ITEMS) {
  const limitAll = !Number.isFinite(Number(maxItems)) || Number(maxItems) <= 0;
  const cap = limitAll ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(Number(maxItems)));
  const rows = [];
  let start = 0;

  while (true) {
    const url =
      `${zoteroBase(creds)}/collections/${encodeURIComponent(collectionKey)}/items` +
      `?limit=${DEFAULT_LIMIT}&start=${start}`;
    const res = await fetchWithTimeout(url, { headers: headers(creds) });
    if (!res.ok) {
      const body = await res.text();
      dbg(
        "fetchCollectionTopItems",
        `error collectionKey=${collectionKey} start=${start} status=${res.status} url=${url} body=${body || "(empty)"}`
      );
      throw new Error(`Collection items HTTP ${res.status}`);
    }

    const data = await res.json();
    const batch = Array.isArray(data) ? data : [];
    for (const entry of batch) {
      const itemType = String(entry?.data?.itemType || "").toLowerCase();
      if (itemType === "attachment" || itemType === "note" || itemType === "annotation") continue;
      rows.push(entry);
      if (rows.length >= cap) break;
    }

    const total = Number(res.headers.get("Total-Results") || 0);
    const reachedEnd = batch.length < DEFAULT_LIMIT || start + DEFAULT_LIMIT >= total;
    const reachedLimit = rows.length >= cap;
    if (reachedEnd || reachedLimit) break;
    start += DEFAULT_LIMIT;
  }

  return limitAll ? rows : rows.slice(0, cap);
}

async function createSubcollection(creds, parentKey, name) {
  const url = `${zoteroBase(creds)}/collections`;
  const payload = [{ name, parentCollection: parentKey }];
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: writeHeaders(creds),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create subcollection HTTP ${res.status}: ${text || "unknown error"}`);
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const createdKey =
    json?.successful?.["0"]?.key ||
    json?.successful?.[0]?.key ||
    json?.["0"]?.key ||
    "";
  return { key: createdKey, raw: json };
}

async function addItemToCollection(creds, collectionKey, item) {
  const itemKey = toString(item?.key || item);
  if (!itemKey) {
    throw new Error("Add item failed: missing item key.");
  }

  // Align with pyzotero addto_collection:
  // PATCH /items/{key} with merged collections and If-Unmodified-Since-Version.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const latest = await fetchItemByKey(creds, itemKey);
    const modified = Number(latest?.version || 0);
    const currentCollections = Array.isArray(latest?.data?.collections) ? latest.data.collections.filter(Boolean) : [];
    const mergedCollections = Array.from(new Set([...currentCollections, collectionKey]));
    const url = `${zoteroBase(creds)}/items/${encodeURIComponent(itemKey)}`;
    const res = await fetchWithTimeout(url, {
      method: "PATCH",
      headers: {
        ...writeHeaders(creds),
        "If-Unmodified-Since-Version": String(modified)
      },
      body: JSON.stringify({ collections: mergedCollections })
    });
    if (res.ok) return;
    const text = await res.text();
    if (res.status === 412 && attempt === 0) continue;
    throw new Error(`Add item ${itemKey} HTTP ${res.status}: ${text || "unknown error"}`);
  }
}

async function fetchItemByKey(creds, itemKey) {
  const url = `${zoteroBase(creds)}/items/${encodeURIComponent(itemKey)}`;
  const res = await fetchWithTimeout(url, { headers: headers(creds) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get item ${itemKey} HTTP ${res.status}: ${text || "unknown error"}`);
  }
  return res.json();
}

function mapItemForRenderer(item, creds) {
  const d = item?.data || {};
  const creators = Array.isArray(d?.creators)
    ? d.creators
        .map((c) => `${c?.firstName || ""} ${c?.lastName || ""}`.trim() || String(c?.name || "").trim())
        .filter(Boolean)
    : [];
  return {
    key: item?.key || "",
    version: Number(item?.version || 0),
    title: d?.title || "(untitled)",
    authors: creators.join("; "),
    date: d?.date || "",
    year: d?.date || "",
    itemType: d?.itemType || "",
    doi: d?.DOI || d?.doi || "",
    url: d?.url || "",
    dateModified: d?.dateModified || "",
    citationCount: Number(d?.citationCount || 0) || 0,
    abstract: d?.abstractNote || "",
    publicationTitle: d?.publicationTitle || d?.bookTitle || d?.proceedingsTitle || "",
    containerTitle: d?.publicationTitle || d?.bookTitle || d?.proceedingsTitle || "",
    journalAbbreviation: d?.journalAbbreviation || "",
    volume: d?.volume || "",
    issue: d?.issue || "",
    pages: d?.pages || "",
    publisher: d?.publisher || "",
    place: d?.place || "",
    language: d?.language || "",
    rights: d?.rights || "",
    series: d?.series || "",
    seriesTitle: d?.seriesTitle || "",
    seriesNumber: d?.seriesNumber || "",
    edition: d?.edition || "",
    numPages: d?.numPages || "",
    isbn: d?.ISBN || "",
    issn: d?.ISSN || "",
    archive: d?.archive || "",
    archiveLocation: d?.archiveLocation || "",
    callNumber: d?.callNumber || "",
    libraryCatalog: d?.libraryCatalog || "",
    extra: d?.extra || "",
    section: d?.section || "",
    tags: Array.isArray(d?.tags) ? d.tags.map((t) => String(t?.tag || "").trim()).filter(Boolean) : [],
    creators: Array.isArray(d?.creators)
      ? d.creators
          .map((c) => {
            const name = `${c?.firstName || ""} ${c?.lastName || ""}`.trim() || String(c?.name || "").trim();
            if (!name) return null;
            return { name, creatorType: String(c?.creatorType || "") };
          })
          .filter(Boolean)
      : [],
    zoteroSelectUrl: `zotero://select/${zoteroLibraryPrefix(creds)}/items/${item?.key || ""}`
  };
}

function updateCachedItemMetadata(itemKey, patch) {
  const updateRow = (row) => {
    if (!row || row.key !== itemKey) return;
    if (typeof patch.abstract === "string") row.abstract = patch.abstract;
    if (Array.isArray(patch.tags)) row.tags = patch.tags.slice();
    if (patch.fields && typeof patch.fields === "object") {
      const fields = patch.fields;
      if (typeof fields.title === "string") row.title = fields.title;
      if (typeof fields.publicationTitle === "string") {
        row.publicationTitle = fields.publicationTitle;
        row.containerTitle = fields.publicationTitle;
      }
      if (typeof fields.date === "string") {
        row.date = fields.date;
        row.year = fields.date;
      }
      if (typeof fields.publisher === "string") row.publisher = fields.publisher;
      if (typeof fields.place === "string") row.place = fields.place;
      if (typeof fields.volume === "string") row.volume = fields.volume;
      if (typeof fields.issue === "string") row.issue = fields.issue;
      if (typeof fields.pages === "string") row.pages = fields.pages;
      if (typeof fields.language === "string") row.language = fields.language;
      if (typeof fields.doi === "string") row.doi = fields.doi;
      if (typeof fields.url === "string") row.url = fields.url;
      if (typeof fields.issn === "string") row.issn = fields.issn;
      if (typeof fields.isbn === "string") row.isbn = fields.isbn;
      if (typeof fields.edition === "string") row.edition = fields.edition;
      if (typeof fields.series === "string") row.series = fields.series;
      if (typeof fields.callNumber === "string") row.callNumber = fields.callNumber;
      if (typeof fields.libraryCatalog === "string") row.libraryCatalog = fields.libraryCatalog;
      if (typeof fields.archive === "string") row.archive = fields.archive;
      if (typeof fields.archiveLocation === "string") row.archiveLocation = fields.archiveLocation;
      if (typeof fields.section === "string") row.section = fields.section;
      if (typeof fields.extra === "string") row.extra = fields.extra;
    }
    if (Number.isFinite(Number(patch.version))) row.version = Number(patch.version);
  };

  for (const cache of memoryCache.items.values()) {
    const rows = Array.isArray(cache?.data) ? cache.data : [];
    rows.forEach(updateRow);
  }
}

async function updateItemMetadata(creds, payload = {}) {
  const itemKey = toString(payload?.itemKey);
  if (!itemKey) return { status: "error", message: "itemKey is required." };

  const nextAbstract = String(payload?.abstract || "");
  const nextTags = Array.isArray(payload?.tags)
    ? payload.tags.map((t) => String(t || "").trim()).filter(Boolean)
    : [];
  const nextFields = payload?.fields && typeof payload.fields === "object" ? payload.fields : {};
  const baseVersion = Number(payload?.baseVersion || 0);
  const fieldMap = {
    title: "title",
    publicationTitle: "publicationTitle",
    date: "date",
    publisher: "publisher",
    place: "place",
    volume: "volume",
    issue: "issue",
    pages: "pages",
    language: "language",
    doi: "DOI",
    url: "url",
    issn: "ISSN",
    isbn: "ISBN",
    edition: "edition",
    series: "series",
    callNumber: "callNumber",
    libraryCatalog: "libraryCatalog",
    archive: "archive",
    archiveLocation: "archiveLocation",
    section: "section",
    extra: "extra"
  };

  const current = await fetchItemByKey(creds, itemKey);
  const currentVersion = Number(current?.version || 0);
  if (baseVersion > 0 && currentVersion > 0 && currentVersion !== baseVersion) {
    dbg(
      "updateItemMetadata",
      `conflict itemKey=${itemKey} baseVersion=${baseVersion} currentVersion=${currentVersion}`
    );
    return {
      status: "error",
      code: "conflict",
      message: "Item changed in Zotero. Refresh and retry.",
      currentVersion
    };
  }

  const data = {
    ...(current?.data || {}),
    abstractNote: nextAbstract,
    tags: nextTags.map((tag) => ({ tag, type: 0 }))
  };
  Object.keys(fieldMap).forEach((rendererKey) => {
    if (typeof nextFields[rendererKey] !== "string") return;
    data[fieldMap[rendererKey]] = nextFields[rendererKey];
  });
  const updatePayload = [{ key: itemKey, version: currentVersion, data }];
  const url = `${zoteroBase(creds)}/items`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: writeHeaders(creds),
    body: JSON.stringify(updatePayload)
  });
  if (!res.ok) {
    const text = await res.text();
    dbg("updateItemMetadata", `error itemKey=${itemKey} status=${res.status} body=${text || "(empty)"}`);
    return { status: "error", message: `Update failed HTTP ${res.status}` };
  }

  const refreshed = await fetchItemByKey(creds, itemKey);
  const mapped = mapItemForRenderer(refreshed, creds);
  updateCachedItemMetadata(itemKey, {
    abstract: mapped.abstract,
    tags: mapped.tags,
    fields: nextFields,
    version: mapped.version
  });
  dbg(
    "updateItemMetadata",
    `ok itemKey=${itemKey} version=${mapped.version} tags=${mapped.tags.length} fields=${
      Object.keys(nextFields).length
    } abstractLen=${mapped.abstract.length}`
  );
  return { status: "ok", item: mapped };
}

function registerIpc() {
  const createAgentRegistry = () => {
    const creds = getCredentials();
    return createZoteroAgentRegistry({
      fetchAllCollections: () => fetchAllCollections(creds),
      fetchCollectionTopItems: (collectionKey) => fetchCollectionTopItems(creds, collectionKey),
      createSubcollection: (parentKey, name) => createSubcollection(creds, parentKey, name),
      addItemToCollection: (collectionKey, item) => addItemToCollection(creds, collectionKey, item)
    });
  };

  registerVoiceIpc({
    ipcMain,
    BrowserWindow,
    createAgentRegistry
  });

  ipcMain.handle("zotero:get-profile", async () => {
    try {
      const creds = getCredentials();
      return {
        status: "ok",
        profile: {
          libraryId: creds.libraryId,
          libraryType: creds.libraryType,
          prefix: zoteroLibraryPrefix(creds)
        }
      };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:get-tree", async (_event, payload = {}) => {
    try {
      const refresh = payload?.refresh === true;
      const creds = getCredentials();
      if (!refresh) {
        const memory = getMemoryCollections();
        if (memory) {
          return { status: "ok", collections: memory, cached: true, cacheLevel: "memory" };
        }
        const disk = getDiskCollections();
        if (disk) {
          setMemoryCollections(disk);
          return { status: "ok", collections: disk, cached: true, cacheLevel: "disk" };
        }
      }

      if (inFlight.collections) {
        const collections = await inFlight.collections;
        return { status: "ok", collections, cached: false, deduped: true };
      }

      inFlight.collections = fetchAllCollections(creds)
        .then((collections) => {
          setMemoryCollections(collections);
          setDiskCollections(collections);
          return collections;
        })
        .finally(() => {
          inFlight.collections = null;
        });

      const collections = await inFlight.collections;
      return { status: "ok", collections, cached: false };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:get-items", async (_event, payload = {}) => {
    try {
      const collectionKey = toString(payload?.collectionKey);
      if (!collectionKey) return { status: "error", message: "collectionKey is required." };
      lastWorkflowContext.selectedCollectionKey = collectionKey;
      const inferredName =
        toString(payload?.collectionName) ||
        inferCollectionNameByKey(collectionKey) ||
        lastWorkflowContext.selectedCollectionName;
      if (inferredName) lastWorkflowContext.selectedCollectionName = inferredName;

      const refresh = payload?.refresh === true;
      const creds = getCredentials();
      const requestedMaxItems = Number(payload?.maxItems);
      const maxItems = Number.isFinite(requestedMaxItems)
        ? (requestedMaxItems <= 0 ? 0 : Math.min(10000, Math.max(50, Math.floor(requestedMaxItems))))
        : 0;
      const wantsFullish = maxItems === 0 || maxItems > 500;
      const isLikelyLegacyPreviewCache = (items, meta) => {
        if (!Array.isArray(items) || items.length === 0) return false;
        if (meta && typeof meta === "object") {
          if (meta.truncated === true) return true;
          const cap = Number(meta?.cap || 0);
          if (wantsFullish && cap > 0 && items.length >= cap) return true;
          if (wantsFullish && !Object.prototype.hasOwnProperty.call(meta, "truncated") && items.length === 300) {
            return true;
          }
          return false;
        }
        return wantsFullish && items.length === 300;
      };

      if (!refresh) {
        const memory = getMemoryItems(collectionKey);
        const memoryMeta = getMemoryItemsMeta(collectionKey);
        const memoryTruncated = isLikelyLegacyPreviewCache(memory, memoryMeta);
        if (Array.isArray(memory) && (memory.length > 0 || isCollectionKnownEmpty(collectionKey))) {
          if (memoryTruncated) {
            dbg(
              "zotero:get-items",
              `collectionKey=${collectionKey} source=memory skipped=truncated_cache count=${memory.length} cap=${Number(memoryMeta?.cap || 0)}`
            );
          } else {
            dbg("zotero:get-items", `collectionKey=${collectionKey} source=memory count=${memory.length}`);
            return { status: "ok", items: memory, cached: true, cacheLevel: "memory", collectionKey };
          }
        }
        if (wantsFullish) {
          const fullMemory = getMemoryFullItems(collectionKey);
          if (Array.isArray(fullMemory) && (fullMemory.length > 0 || isCollectionKnownEmpty(collectionKey))) {
            setMemoryItemsWithMeta(collectionKey, fullMemory, { truncated: false, cap: 0 });
            setDiskItemsWithMeta(collectionKey, fullMemory, { truncated: false, cap: 0 });
            dbg("zotero:get-items", `collectionKey=${collectionKey} source=memory_full count=${fullMemory.length}`);
            return { status: "ok", items: fullMemory, cached: true, cacheLevel: "memory_full", collectionKey };
          }
          const fullDisk = getDiskFullItems(collectionKey);
          if (Array.isArray(fullDisk) && (fullDisk.length > 0 || isCollectionKnownEmpty(collectionKey))) {
            setMemoryFullItems(collectionKey, fullDisk);
            setMemoryItemsWithMeta(collectionKey, fullDisk, { truncated: false, cap: 0 });
            setDiskItemsWithMeta(collectionKey, fullDisk, { truncated: false, cap: 0 });
            dbg("zotero:get-items", `collectionKey=${collectionKey} source=disk_full count=${fullDisk.length}`);
            return { status: "ok", items: fullDisk, cached: true, cacheLevel: "disk_full", collectionKey };
          }
        }
        const disk = getDiskItems(collectionKey);
        const diskMeta = getDiskItemsMeta(collectionKey);
        const diskTruncated = isLikelyLegacyPreviewCache(disk, diskMeta);
        if (Array.isArray(disk) && (disk.length > 0 || isCollectionKnownEmpty(collectionKey))) {
          if (diskTruncated) {
            dbg(
              "zotero:get-items",
              `collectionKey=${collectionKey} source=disk skipped=truncated_cache count=${disk.length} cap=${Number(diskMeta?.cap || 0)}`
            );
          } else {
            setMemoryItemsWithMeta(collectionKey, disk, diskMeta || {});
            dbg("zotero:get-items", `collectionKey=${collectionKey} source=disk count=${disk.length}`);
            return { status: "ok", items: disk, cached: true, cacheLevel: "disk", collectionKey };
          }
        }
      }

      const inflightKey = itemsInflightKey(collectionKey, maxItems);
      if (inFlight.items.has(inflightKey)) {
        const items = await inFlight.items.get(inflightKey);
        dbg(
          "zotero:get-items",
          `collectionKey=${collectionKey} source=inflight count=${items.length} maxItems=${maxItems}`
        );
        return { status: "ok", items, cached: false, deduped: true, collectionKey };
      }

      const request = fetchCollectionItemsPreview(creds, collectionKey, maxItems)
        .then((payloadOut) => {
          const items = Array.isArray(payloadOut?.items) ? payloadOut.items : [];
          const meta = {
            truncated: payloadOut?.truncated === true,
            cap: Number.isFinite(Number(payloadOut?.cap)) ? Number(payloadOut.cap) : 0
          };
          setMemoryItemsWithMeta(collectionKey, items, meta);
          setDiskItemsWithMeta(collectionKey, items, meta);
          return items;
        })
        .finally(() => {
          inFlight.items.delete(inflightKey);
        });

      inFlight.items.set(inflightKey, request);
      try {
        const items = await request;
        dbg("zotero:get-items", `collectionKey=${collectionKey} source=fetch count=${items.length} refresh=${String(refresh)}`);
        return { status: "ok", items, cached: false, collectionKey };
      } catch (error) {
        const memory = getMemoryItems(collectionKey);
        if (memory) {
          dbg(
            "zotero:get-items",
            `collectionKey=${collectionKey} source=memory_fallback count=${memory.length} reason=${error?.message || "fetch_failed"}`
          );
          return {
            status: "ok",
            items: memory,
            cached: true,
            cacheLevel: "memory_fallback",
            collectionKey,
            warning: error?.message || "Fetch failed; using cached memory items."
          };
        }
        const disk = getDiskItems(collectionKey);
        const diskMeta = getDiskItemsMeta(collectionKey);
        if (disk) {
          setMemoryItemsWithMeta(collectionKey, disk, diskMeta || {});
          dbg(
            "zotero:get-items",
            `collectionKey=${collectionKey} source=disk_fallback count=${disk.length} reason=${error?.message || "fetch_failed"}`
          );
          return {
            status: "ok",
            items: disk,
            cached: true,
            cacheLevel: "disk_fallback",
            collectionKey,
            warning: error?.message || "Fetch failed; using cached disk items."
          };
        }
        throw error;
      }
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:get-item-children", async (_event, payload = {}) => {
    try {
      const itemKey = toString(payload?.itemKey);
      if (!itemKey) return { status: "error", message: "itemKey is required." };
      const creds = getCredentials();
      const refresh = payload?.refresh === true;

      if (!refresh) {
        const memory = getMemoryChildren(itemKey);
        if (memory) return { status: "ok", itemKey, children: memory, cached: true, cacheLevel: "memory" };
        const disk = getDiskChildren(itemKey);
        if (disk) {
          setMemoryChildren(itemKey, disk);
          return { status: "ok", itemKey, children: disk, cached: true, cacheLevel: "disk" };
        }
      }

      if (inFlight.children.has(itemKey)) {
        const children = await inFlight.children.get(itemKey);
        return { status: "ok", itemKey, children, deduped: true };
      }

      const request = fetchItemChildren(creds, itemKey)
        .then((children) => {
          setMemoryChildren(itemKey, children);
          setDiskChildren(itemKey, children);
          return children;
        })
        .finally(() => {
          inFlight.children.delete(itemKey);
        });

      inFlight.children.set(itemKey, request);
      const children = await request;
      return { status: "ok", itemKey, children };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:update-item-metadata", async (_event, payload = {}) => {
    try {
      const creds = getCredentials();
      return await updateItemMetadata(creds, payload || {});
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:agent-run", async (_event, payload = {}) => {
    try {
      const agentRegistry = createAgentRegistry();
      return await agentRegistry.run({
        text: toString(payload?.text),
        dryRun: payload?.dryRun === true
      });
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:intent-resolve", async (_event, payload = {}) => {
    try {
      const text = toString(payload?.text);
      const context = payload?.context || {};
      return await resolveIntent(text, context);
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:intent-execute", async (_event, payload = {}) => {
    try {
      const intent = payload?.intent || {};
      const dryRun = false;
      const confirm = payload?.confirm === true;
      const intentId = toString(intent?.intentId);
      if (!intentId) return { status: "error", message: "intent.intentId is required." };

      if (intentId === "workflow.create_subfolder_by_topic") {
        if (payload?.context && typeof payload.context === "object") {
          const ctxKey = cleanIdentifier(payload.context.selectedCollectionKey || "");
          const ctxName = cleanIdentifier(payload.context.selectedCollectionName || "");
          if (ctxKey) lastWorkflowContext.selectedCollectionKey = ctxKey;
          if (ctxName) lastWorkflowContext.selectedCollectionName = ctxName;
        }
        const normalizedArgs = normalizeWorkflowArgs(intent.args || {}, payload?.context || {});
        if (!normalizedArgs.parentIdentifier) {
          return { status: "error", message: "parentIdentifier is required (no active collection context found)." };
        }
        if (!normalizedArgs.topic) {
          return { status: "error", message: "topic is required." };
        }
        if (!dryRun && payload?.background === true) {
          const job = enqueueWorkflowCreateSubfolderByTopicJob({
            args: normalizedArgs,
            timeoutSec: payload?.timeoutSec,
            pollSec: payload?.pollSec,
            model: payload?.model
          });
          return { status: "ok", queued: true, jobId: job.id, functionName: job.functionName };
        }
        return await executeCreateSubfolderByTopicWorkflow({
          args: normalizedArgs,
          dryRun,
          timeoutSec: payload?.timeoutSec,
          pollSec: payload?.pollSec,
          model: payload?.model
        });
      }

      if (intentId === "feature.run") {
        const functionName = toString(intent?.targetFunction);
        if (!functionName) return { status: "error", message: "target function is required." };
        if (isDestructiveFunction(functionName) && !dryRun && !confirm) {
          return {
            status: "confirm_required",
            message: `Function '${functionName}' is destructive. Confirm before execute.`,
            intentId
          };
        }
        const signatures = await loadZoteroSignatures();
        const feature = resolveFeatureDescriptor(functionName, signatures);
        if (!feature) return { status: "error", message: `Unknown feature: ${functionName}` };

        // Deterministic harness path: avoid long-running backend pipelines during UI E2E protocol checks.
        if (
          toString(process.env.ZOTERO_E2E_CHAT_RUN) === "1" &&
          functionName === "Verbatim_Evidence_Coding" &&
          !shouldRunVerbatimE2EFull() &&
          dryRun !== true
        ) {
          return {
            status: "ok",
            function: functionName,
            result: {
              status: "ok",
              mode: "e2e-short-circuit",
              collection_name: toString(intent?.args?.collection_name || ""),
              prompt_key: toString(intent?.args?.prompt_key || "code_pdf_page"),
              research_questions_count: Array.isArray(intent?.args?.research_questions)
                ? intent.args.research_questions.length
                : 0
            }
          };
        }

        const argsValues = applyVerbatimDirBase(functionName, intent?.args, payload?.context || {});
        return await featureWorker.run({
          functionName,
          argsSchema: Array.isArray(feature.args) ? feature.args : [],
          argsValues,
          execute: dryRun !== true
        });
      }

      if (intentId === "agent.legacy_command") {
        const agentRegistry = createAgentRegistry();
        return await agentRegistry.run({
          text: toString(intent?.args?.text || ""),
          dryRun
        });
      }

      return { status: "error", message: `Unsupported intent: ${intentId}` };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:refine-coding-questions", async (_event, payload = {}) => {
    try {
      return await refineCodingQuestionsWithLLM(payload || {});
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:generate-eligibility-criteria", async (_event, payload = {}) => {
    try {
      return await generateEligibilityCriteriaWithLLM(payload || {});
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:advanced-search", async (_event, payload = {}) => {
    try {
      const query = toString(payload?.query);
      const limit = clampInt(payload?.limit, 20, 2000, 500);
      if (!query) return { status: "error", message: "query is required." };
      const items = searchInCachedItems(query, limit);
      return { status: "ok", items, query, source: "cache" };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:get-tag-facets", async (_event, payload = {}) => {
    try {
      const limit = clampInt(payload?.limit, 10, 2000, 250);
      const scope = payload?.scope === "collection" ? "collection" : "global";
      const collectionKey = toString(payload?.collectionKey);
      const refresh = payload?.refresh === true;
      const items =
        scope === "collection" && collectionKey
          ? await ensureFullCollectionItems(getCredentials(), collectionKey, refresh)
          : readAllCachedItems();
      const tags = computeTagFacets(items, limit);
      dbg(
        "zotero:get-tag-facets",
        `scope=${scope} collectionKey=${collectionKey || "(none)"} tags=${tags.length} items=${items.length}`
      );
      return { status: "ok", tags, itemsScanned: items.length, source: "cache", scope, collectionKey };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:get-items-by-tags", async (_event, payload = {}) => {
    try {
      const tags = Array.isArray(payload?.tags) ? payload.tags : [];
      const mode = payload?.mode === "any" ? "any" : "all";
      const scope = payload?.scope === "collection" ? "collection" : "global";
      const collectionKey = toString(payload?.collectionKey);
      const limit = clampInt(payload?.limit, 20, 10000, 5000);
      const refresh = payload?.refresh === true;
      const items =
        scope === "collection" && collectionKey
          ? await ensureFullCollectionItems(getCredentials(), collectionKey, refresh)
          : readAllCachedItems();
      const matched = filterItemsByTags(items, tags, mode, limit);
      dbg(
        "zotero:get-items-by-tags",
        `scope=${scope} collectionKey=${collectionKey || "(none)"} tags=${tags.length} mode=${mode} limit=${limit} matched=${matched.length} items=${items.length}`
      );
      return { status: "ok", items: matched, mode, tags, scope, collectionKey };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:get-feature-inventory", async () => {
    try {
      const signatures = await loadZoteroSignatures();
      return { status: "ok", tabs: groupedFeatures(signatures) };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:run-feature", async (_event, payload = {}) => {
    try {
      const functionName = toString(payload?.functionName);
      if (!functionName) return { status: "error", message: "functionName is required." };
      const argsValues = applyVerbatimDirBase(functionName, payload?.argsValues, payload?.context || {});
      const signatures = await loadZoteroSignatures();
      const feature = resolveFeatureDescriptor(functionName, signatures);
      if (!feature) return { status: "error", message: `Unknown feature: ${functionName}` };

      const runnerPayload = {
        functionName,
        argsSchema:
          Array.isArray(payload?.argsSchema) && payload.argsSchema.length
            ? payload.argsSchema
            : (Array.isArray(feature.args) ? feature.args : []),
        argsValues,
        execute: payload?.execute !== false
      };
      if (isDestructiveFunction(functionName) && payload?.confirm !== true && payload?.execute !== false) {
        return {
          status: "confirm_required",
          message: `Function '${functionName}' is destructive. Set confirm=true to execute.`
        };
      }
      return await featureWorker.run(runnerPayload);
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:enqueue-feature-job", async (_event, payload = {}) => {
    try {
      const functionName = toString(payload?.functionName);
      if (!functionName) return { status: "error", message: "functionName is required." };
      const argsValues = applyVerbatimDirBase(functionName, payload?.argsValues, payload?.context || {});
      const signatures = await loadZoteroSignatures();
      const feature = resolveFeatureDescriptor(functionName, signatures);
      if (!feature) return { status: "error", message: `Unknown feature: ${functionName}` };

      const execute = payload?.execute !== false;
      if (isDestructiveFunction(functionName) && execute && payload?.confirm !== true) {
        return { status: "confirm_required", message: `Confirmation required for ${functionName}.` };
      }

      const runnerPayload = {
        functionName,
        argsSchema:
          Array.isArray(payload?.argsSchema) && payload.argsSchema.length
            ? payload.argsSchema
            : (Array.isArray(feature.args) ? feature.args : []),
        argsValues,
        execute
      };

      const job = {
        id: `job_${featureJobSeq++}`,
        functionName,
        status: "queued",
        progress: 0,
        runnerPayload,
        createdAt: Date.now(),
        startedAt: 0,
        finishedAt: 0,
        error: "",
        result: null
      };
      featureJobs.push(job);
      featureJobMap.set(job.id, job);
      persistFeatureJobsState();
      broadcastFeatureJobStatus(job);
      void processNextFeatureJob();
      return { status: "ok", jobId: job.id };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:cancel-feature-job", async (_event, payload = {}) => {
    try {
      const jobId = toString(payload?.jobId);
      const job = featureJobMap.get(jobId);
      if (!job) return { status: "error", message: "Job not found." };
      if (job.external === true) {
        return { status: "error", message: "External OpenAI batch cannot be canceled from this control." };
      }
      if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
        return { status: "ok", jobId, alreadyFinal: true };
      }
      job.status = "canceled";
      job.progress = 100;
      job.finishedAt = Date.now();
      persistFeatureJobsState();
      broadcastFeatureJobStatus(job);
      if (activeFeatureJob && activeFeatureJob.id === jobId) {
        featureWorker.stop();
        featureWorker.start();
        activeFeatureJob = null;
        void processNextFeatureJob();
      }
      return { status: "ok", jobId };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:get-feature-jobs", async (_event, payload = {}) => {
    if (payload?.force === true) {
      await reconcileOpenAIBatchJobs(true);
    } else {
      void reconcileOpenAIBatchJobs(false);
    }
    return { status: "ok", jobs: snapshotFeatureJobs() };
  });

  ipcMain.handle("zotero:clear-workflow-batch-jobs", async (_event, payload = {}) => {
    try {
      const includeRunning = payload?.includeRunning === true;
      const removable = (job) => {
        if (String(job?.functionName || "") !== "workflow.create_subfolder_by_topic") return false;
        const st = String(job?.status || "");
        if (includeRunning) return true;
        return ["completed", "failed", "canceled"].includes(st);
      };

      const removedBatchIds = [];
      for (let i = featureJobs.length - 1; i >= 0; i -= 1) {
        const job = featureJobs[i];
        if (!removable(job)) continue;
        const bid = toString(job?.openaiBatchId || "");
        if (bid) removedBatchIds.push(bid);
        featureJobMap.delete(job.id);
        featureJobs.splice(i, 1);
      }

      const uniqueBatchIds = Array.from(new Set(removedBatchIds.filter(Boolean)));
      if (uniqueBatchIds.length) {
        const purged = readPurgedOpenAIBatchesSet();
        uniqueBatchIds.forEach((id) => purged.add(id));
        writePurgedOpenAIBatchesSet(purged);

        for (const bid of uniqueBatchIds) {
          const outputPath = openAIBatchOutputPath(bid);
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
            } catch {
              // ignore
            }
          }
        }

        const manualLinks = readManualOpenAIBatchLinks();
        const nextManual = manualLinks.filter((x) => !uniqueBatchIds.includes(toString(x?.batchId)));
        if (nextManual.length !== manualLinks.length) {
          writeManualOpenAIBatchLinks(nextManual);
        }
      }

      persistFeatureJobsState();
      await reconcileOpenAIBatchJobs(true);
      return {
        status: "ok",
        cleared: uniqueBatchIds.length,
        batchIds: uniqueBatchIds
      };
    } catch (error) {
      return { status: "error", message: error?.message || "Failed to clear workflow batches." };
    }
  });

  ipcMain.handle("zotero:get-batch-explorer", async (_event, payload = {}) => {
    try {
      const force = payload?.force === true;
      if (force) await reconcileOpenAIBatchJobs(true);
      else void reconcileOpenAIBatchJobs(false);

      const manualLinks = readManualOpenAIBatchLinks();
      const manualByBatchId = new Map(manualLinks.map((x) => [x.batchId, x]));
      const batches = featureJobs
        .filter((job) => String(job?.functionName || "") === "workflow.create_subfolder_by_topic")
        .map((job) => {
          const batchId = toString(job?.openaiBatchId || "").trim();
          const ctx = batchContextForJob(job, manualByBatchId);
          const cachedRows = batchId ? readCachedBatchOutputRows(batchId, 1) : [];
          const outputPath = batchId ? openAIBatchOutputPath(batchId) : "";
          return {
            jobId: toString(job?.id || ""),
            batchId: batchId || toString(job?.id || ""),
            status: toString(job?.status || ""),
            progress: Number(job?.progress || 0),
            phase: toString(job?.phase || ""),
            startedAt: Number(job?.startedAt || 0),
            finishedAt: Number(job?.finishedAt || 0),
            error: toString(job?.error || ""),
            topic: ctx.topic,
            parentIdentifier: ctx.parentIdentifier,
            subfolderName: ctx.subfolderName,
            threshold: ctx.threshold,
            maxItems: ctx.maxItems,
            model: ctx.model,
            outputCached: Boolean(batchId && fs.existsSync(outputPath)),
            outputPath: outputPath || "",
            resultSummary: {
              screenedItems: Number(job?.result?.result?.screenedItems || 0),
              matchedItems: Number(job?.result?.result?.matchedItems || 0),
              addedItems: Number(job?.result?.result?.addedItems || 0)
            },
            hasOutputRows: cachedRows.length > 0
          };
        })
        .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));

      return { status: "ok", batches };
    } catch (error) {
      return { status: "error", message: error?.message || "Failed to load batch explorer." };
    }
  });

  ipcMain.handle("zotero:get-batch-detail", async (_event, payload = {}) => {
    try {
      const batchId = toString(payload?.batchId || "");
      const force = payload?.force === true;
      const limit = Math.max(50, Math.min(10000, Number(payload?.limit || 2500)));
      if (!batchId) return { status: "error", message: "batchId is required." };
      if (force) await reconcileOpenAIBatchJobs(true);

      const manualLinks = readManualOpenAIBatchLinks();
      const manualByBatchId = new Map(manualLinks.map((x) => [x.batchId, x]));
      const job =
        featureJobs.find((j) => toString(j?.openaiBatchId || "") === batchId) ||
        featureJobMap.get(batchId) ||
        null;

      if (!job) return { status: "error", message: `Batch '${batchId}' not found.` };
      const ctx = batchContextForJob(job, manualByBatchId);
      const promptFromResult = job?.result?.result?.classifierMeta?.prompt_spec_used;
      const prompt =
        promptFromResult && typeof promptFromResult === "object"
          ? {
              promptKey: toString(promptFromResult.promptKey || "classify_abstract_topic_membership_v1"),
              system: toString(promptFromResult.system || ""),
              template: toString(promptFromResult.template || ""),
              schema: promptFromResult.schema && typeof promptFromResult.schema === "object" ? promptFromResult.schema : {}
            }
          : (() => {
              const dyn = createTopicClassifierPromptSpec({
                topic: ctx.topic,
                parentIdentifier: ctx.parentIdentifier,
                subfolderName: ctx.subfolderName,
                threshold: ctx.threshold,
                classificationPolicy: ctx.classificationPolicy,
                inclusionCriteria: ctx.inclusionCriteria,
                maybeCriteria: ctx.maybeCriteria,
                exclusionCriteria: ctx.exclusionCriteria
              });
              return {
                promptKey: dyn.promptKey,
                system: dyn.system,
                template: dyn.template,
                schema: dyn.schema
              };
            })();
      const rows = readCachedBatchOutputRows(batchId, limit);
      const outputPath = openAIBatchOutputPath(batchId);
      const screened = Number(job?.result?.result?.screenedItems || job?.result?.result?.classifiedItems || 0);
      const matched = Number(job?.result?.result?.matchedItems || rows.filter((r) => r.isMatch).length);
      const added = Number(job?.result?.result?.addedItems || 0);
      const itemMetaByKey = new Map();
      const frozenRows = readOpenAIBatchInputMeta(batchId);
      for (const row of frozenRows) {
        const k = toString(row?.key || "");
        if (!k) continue;
        itemMetaByKey.set(k, {
          title: toString(row?.title || ""),
          abstract: toString(row?.abstract || ""),
          authors: toString(row?.authors || ""),
          source: "batch_input_meta"
        });
      }
      try {
        // Keep batch detail responsive: enrich metadata from local caches only.
        const parentIdentifier = cleanIdentifier(ctx.parentIdentifier || "");
        if (parentIdentifier) {
          const collections = getMemoryCollections() || getDiskCollections() || [];
          if (collections.length) {
            const indexes = buildCollectionIndexes(collections);
            const parentResolved = resolveCollectionIdentifier(parentIdentifier, indexes);
            if (parentResolved?.ok && parentResolved?.collection?.key) {
              const parentKey = toString(parentResolved.collection.key);
              const cachedRows =
                getMemoryFullItems(parentKey) ||
                getDiskFullItems(parentKey) ||
                getMemoryItems(parentKey) ||
                getDiskItems(parentKey) ||
                [];
              for (const entry of cachedRows) {
                const k = toString(entry?.key || "");
                if (!k || itemMetaByKey.has(k)) continue;
                itemMetaByKey.set(k, {
                  title: toString(entry?.title || "").trim(),
                  abstract: toString(entry?.abstract || "").trim(),
                  authors: toString(entry?.authors || "").trim(),
                  source: "collection_cache"
                });
              }
            }
          }
        }
      } catch {
        // best-effort metadata enrichment for batch rows
      }

      return {
        status: "ok",
        batch: {
          jobId: toString(job?.id || ""),
          batchId,
          status: toString(job?.status || ""),
          progress: Number(job?.progress || 0),
          phase: toString(job?.phase || ""),
          startedAt: Number(job?.startedAt || 0),
          finishedAt: Number(job?.finishedAt || 0),
          error: toString(job?.error || ""),
          topic: ctx.topic,
          parentIdentifier: ctx.parentIdentifier,
          subfolderName: ctx.subfolderName,
          threshold: ctx.threshold,
          maxItems: ctx.maxItems,
          model: ctx.model,
          outputPath,
          outputCached: fs.existsSync(outputPath),
          screenedItems: screened,
          matchedItems: matched,
          addedItems: added,
          prompt
        },
        rows: rows.map((r, idx) => ({
          index: idx,
          customId: r.customId,
          itemKey: r.itemKey,
          title: toString(itemMetaByKey.get(toString(r.itemKey || ""))?.title || ""),
          abstract: toString(itemMetaByKey.get(toString(r.itemKey || ""))?.abstract || ""),
          authors: toString(itemMetaByKey.get(toString(r.itemKey || ""))?.authors || ""),
          metadataSource: toString(itemMetaByKey.get(toString(r.itemKey || ""))?.source || ""),
          status: toString(r.status || "excluded"),
          isMatch: r.isMatch,
          confidence: Number(r.confidence || 0),
          themes: Array.isArray(r.themes) ? r.themes : [],
          subject: toString(r.subject || ""),
          reason: r.reason,
          suggestedTags: Array.isArray(r.suggestedTags) ? r.suggestedTags : [],
          raw: r.raw
        }))
      };
    } catch (error) {
      return { status: "error", message: error?.message || "Failed to load batch detail." };
    }
  });

  ipcMain.handle("zotero:delete-batch", async (_event, payload = {}) => {
    try {
      const batchId = toString(payload?.batchId || "");
      const jobId = toString(payload?.jobId || "");
      if (!batchId && !jobId) return { status: "error", message: "batchId or jobId is required." };

      const removedJobs = [];
      for (let i = featureJobs.length - 1; i >= 0; i -= 1) {
        const job = featureJobs[i];
        const sameBatch = batchId && toString(job?.openaiBatchId || "") === batchId;
        const sameJob = jobId && toString(job?.id || "") === jobId;
        if (!sameBatch && !sameJob) continue;
        removedJobs.push(job);
        featureJobMap.delete(job.id);
        featureJobs.splice(i, 1);
      }

      if (activeFeatureJob && removedJobs.some((j) => j.id === activeFeatureJob.id)) {
        featureWorker.stop();
        featureWorker.start();
        activeFeatureJob = null;
      }

      const targetBatchId =
        batchId ||
        toString(removedJobs[0]?.openaiBatchId || "");

      if (targetBatchId) {
        const purged = readPurgedOpenAIBatchesSet();
        purged.add(targetBatchId);
        writePurgedOpenAIBatchesSet(purged);

        const outputPath = openAIBatchOutputPath(targetBatchId);
        if (fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
          } catch {
            // ignore
          }
        }
        const inputMetaPath = openAIBatchInputMetaPath(targetBatchId);
        if (fs.existsSync(inputMetaPath)) {
          try {
            fs.unlinkSync(inputMetaPath);
          } catch {
            // ignore
          }
        }

        const manualLinks = readManualOpenAIBatchLinks();
        const nextManual = manualLinks.filter((x) => toString(x?.batchId) !== targetBatchId);
        if (nextManual.length !== manualLinks.length) {
          writeManualOpenAIBatchLinks(nextManual);
        }

        const apiKey = toString(process.env.OPENAI_API_KEY);
        if (apiKey) {
          try {
            await fetchWithTimeout(
              `https://api.openai.com/v1/batches/${encodeURIComponent(targetBatchId)}/cancel`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json"
                }
              },
              20 * 1000
            );
          } catch {
            // best-effort cancel only
          }
        }
      }

      persistFeatureJobsState();
      await reconcileOpenAIBatchJobs(true);
      await processNextFeatureJob();
      return {
        status: "ok",
        deleted: {
          batchId: targetBatchId,
          jobsRemoved: removedJobs.length
        }
      };
    } catch (error) {
      return { status: "error", message: error?.message || "Failed to delete batch." };
    }
  });

  ipcMain.handle("zotero:feature-health-check", async () => {
    try {
      const signatures = await loadZoteroSignatures();
      const worker = await featureWorker.health();
      const creds = (() => {
        try {
          getCredentials();
          return { ok: true, message: "Credentials loaded." };
        } catch (error) {
          return { ok: false, message: error.message };
        }
      })();
      return {
        status: "ok",
        checks: {
          credentials: creds,
          signatures: { ok: Object.keys(signatures || {}).length > 0, count: Object.keys(signatures || {}).length },
          worker
        }
      };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:get-intent-stats", async () => {
    return { status: "ok", stats: snapshotIntentTelemetry() };
  });

  ipcMain.handle("zotero:get-saved-searches", async () => {
    try {
      return { status: "ok", rows: localDb.listSavedSearches(app) };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:save-saved-search", async (_event, payload = {}) => {
    try {
      const row = localDb.upsertSavedSearch(app, payload || {});
      return { status: "ok", row };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:delete-saved-search", async (_event, payload = {}) => {
    try {
      const id = toString(payload?.id);
      if (!id) return { status: "error", message: "id is required." };
      const deleted = localDb.deleteSavedSearch(app, id);
      return { status: "ok", deleted, id };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:sync-now", async () => {
    try {
      return await syncEngine.runNow();
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:get-sync-status", async () => {
    try {
      return { status: "ok", sync: syncEngine.status() };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:open-reader", async (_event, payload = {}) => {
    try {
      const itemKey = toString(payload?.itemKey || payload?.key);
      const url = toString(payload?.url);
      if (!url) return { status: "error", message: "url is required to open reader." };

      const registryKey = itemKey || url;
      const existing = windows.get(`reader:${registryKey}`);
      if (existing && !existing.isDestroyed()) {
        existing.focus();
        return { status: "ok", reused: true };
      }

      const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
      const win = createReaderWindow({
        parent,
        url,
        itemKey,
        page: clampInt(payload?.page, 1, 100000, 1)
      });
      windows.set(`reader:${registryKey}`, win);
      return { status: "ok", reused: false };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:emit-menu-command", async (_event, payload = {}) => {
    try {
      const commandId = toString(payload?.commandId);
      const main = windows.get("main");
      if (!commandId || !main) return { status: "error", message: "commandId or main window missing." };
      main.webContents.send("app:menu-command", { commandId });
      return { status: "ok", commandId };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:open-external", async (_event, payload = {}) => {
    try {
      const url = toString(payload?.url);
      if (!url) return { status: "error", message: "url is required." };
      await shell.openExternal(url);
      return { status: "ok", url };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });

  ipcMain.handle("zotero:clear-cache", async () => {
    try {
      const dir = cacheDir();
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      fs.mkdirSync(dir, { recursive: true });
      memoryCache.collections = null;
      memoryCache.items.clear();
      memoryCache.children.clear();
      memoryCache.fullItems.clear();
      inFlight.collections = null;
      inFlight.items.clear();
      inFlight.children.clear();
      inFlight.fullItems.clear();
      return { status: "ok", message: "Cache cleared." };
    } catch (error) {
      return { status: "error", message: error.message };
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1450,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  windows.set("main", win);
  return win;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(ms) || 1)));
}

function getE2EChatDirBase() {
  const configuredDirBase = toString(process.env.ZOTERO_E2E_CHAT_DIR_BASE);
  return configuredDirBase || "./running_tests";
}

function shouldRunVerbatimE2EFull() {
  return toString(process.env.ZOTERO_E2E_CHAT_FULL_RUN) === "1";
}

function getE2EChatCollectionKey() {
  return toString(process.env.ZOTERO_E2E_CHAT_COLLECTION_KEY);
}

function defaultE2EChatScenario() {
  return {
    collectionKeyword: "framework",
    collectionKey: getE2EChatCollectionKey(),
    dirBase: getE2EChatDirBase(),
    initialCommand: "code this collection about cyber attribution and frameworks and models",
    feedback: "Could you focus the questions on literature review contribution and strengths/weaknesses of each framework?",
    approve: "yes",
    waitMs: 120000,
    executionWaitMs: 300000
  };
}

function parseE2EChatScenario() {
  const raw = toString(process.env.ZOTERO_E2E_CHAT_SCENARIO);
  if (!raw) return defaultE2EChatScenario();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultE2EChatScenario();
    const base = defaultE2EChatScenario();
    return {
      collectionKeyword: toString(parsed.collectionKeyword) || base.collectionKeyword,
      collectionKey: toString(parsed.collectionKey) || base.collectionKey,
      dirBase: toString(parsed.dirBase) || base.dirBase,
      initialCommand: toString(parsed.initialCommand) || base.initialCommand,
      feedback: toString(parsed.feedback) || base.feedback,
      approve: toString(parsed.approve) || base.approve,
      waitMs: Number.isFinite(Number(parsed.waitMs)) ? Number(parsed.waitMs) : base.waitMs,
      executionWaitMs: Number.isFinite(Number(parsed.executionWaitMs))
        ? Number(parsed.executionWaitMs)
        : base.executionWaitMs
    };
  } catch {
    return defaultE2EChatScenario();
  }
}

function e2eReportDir() {
  const dir = path.join(__dirname, "state", "e2e_reports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function e2eReadRendererState(win) {
  return await win.webContents.executeJavaScript(
    `(() => {
      const rows = Array.from(document.querySelectorAll(".agent-chat-msg"));
      const messages = rows.map((row) => {
        const role = row.classList.contains("user") ? "user" : "assistant";
        const meta = row.querySelector(".agent-chat-meta");
        let text = "";
        const first = row.childNodes && row.childNodes.length ? row.childNodes[0] : null;
        if (first && typeof first.textContent === "string") text = first.textContent.trim();
        if (!text) text = String(row.textContent || "").trim();
        if (meta && meta.textContent) {
          const m = String(meta.textContent || "").trim();
          if (m) text = text.replace(m, "").trim();
        }
        const tone = row.classList.contains("error")
          ? "error"
          : row.classList.contains("warn")
            ? "warn"
            : "";
        return { role, tone, text };
      });
      const statusLine = String(document.getElementById("statusLine")?.textContent || "").trim();
      const selectedCollection = String(document.getElementById("selectedCollection")?.textContent || "").trim();
      const pending = Boolean(document.getElementById("agentChatInput")?.disabled);
      return { messages, statusLine, selectedCollection, pending };
    })();`,
    true
  );
}

async function e2eSendChatMessage(win, text) {
  const msg = toString(text);
  if (!msg) return { ok: false, message: "empty message" };
  return await win.webContents.executeJavaScript(
    `(() => {
      const fab = document.getElementById("agentChatFab");
      const dock = document.getElementById("agentChatDock");
      if (fab && dock && !dock.classList.contains("open")) fab.click();
      const input = document.getElementById("agentChatInput");
      const form = document.getElementById("agentChatForm");
      if (!input || !form) return { ok: false, message: "chat input/form not found" };
      if (input.disabled) return { ok: false, message: "chat input disabled (pending)" };
      input.value = ${JSON.stringify(msg)};
      const ev = new Event("submit", { bubbles: true, cancelable: true });
      form.dispatchEvent(ev);
      return { ok: true };
    })();`,
    true
  );
}

async function e2eSelectCollection(win, target) {
  return await win.webContents.executeJavaScript(
    `(() => {
      const lines = Array.from(document.querySelectorAll(".tree-line"));
      if (!lines.length) return { ok: false, message: "no tree lines found" };
      const collectionKey = ${JSON.stringify(String(target?.collectionKey || "").toLowerCase())};
      const collectionKeyword = ${JSON.stringify(String(target?.collectionKeyword || "").toLowerCase())};
      const withLabel = lines
        .map((line) => ({ line, labelEl: line.querySelector(".tree-label") }))
        .filter((x) => x.labelEl);
      let target = null;
      if (collectionKey) {
        target = withLabel.find(
          (x) =>
            String(x.line.getAttribute("data-collection-key") || "").toLowerCase() === collectionKey ||
            String(x.labelEl.textContent || "").toLowerCase().includes(collectionKey)
        )?.line || null;
      }
      if (!target && collectionKeyword) {
        const matches = withLabel.filter((x) => String(x.labelEl.textContent || "").toLowerCase().includes(collectionKeyword));
        if (matches.length) target = matches[matches.length - 1].line;
      }
      if (!target && (collectionKey || collectionKeyword) && typeof selectCollection === "function") {
        const directKey = collectionKey || collectionKeyword;
        selectCollection(directKey, { loadItems: true, resetItem: true });
        const selectedCollection = String(document.getElementById("selectedCollection")?.textContent || "").trim();
        return {
          ok: true,
          label: selectedCollection || "collection selected by key",
          key: directKey,
          mode: "select-api"
        };
      }
      if (!target && withLabel.length) target = withLabel[withLabel.length - 1].line;
      if (!target) target = lines[lines.length - 1];
      target.click();
      const label = String(target.querySelector(".tree-label")?.textContent || "").trim();
      return { ok: true, label, key: String(target.getAttribute("data-collection-key") || "") };
    })();`,
    true
  );
}

async function e2eWaitForAssistantMessage(win, matcher, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await e2eReadRendererState(win);
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const lastAssistant = [...messages].reverse().find((m) => m?.role === "assistant");
    if (lastAssistant && matcher(String(lastAssistant.text || ""), state)) {
      return { ok: true, state, message: lastAssistant };
    }
    await sleep(900);
  }
  return { ok: false, message: "timeout waiting for assistant message" };
}

async function e2eWaitForInputEnabled(win, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const pending = Boolean(
      await win.webContents.executeJavaScript(
        `(() => Boolean(document.getElementById("agentChatInput")?.disabled))();`,
        true
      )
    );
    if (!pending) return { ok: true };
    await sleep(450);
  }
  return { ok: false, message: "timeout waiting for chat input to re-enable" };
}

async function runE2EChatScenario(win) {
  if (toString(process.env.ZOTERO_E2E_CHAT_RUN) !== "1") return;
  const scenario = parseE2EChatScenario();
  const report = {
    startedAt: new Date().toISOString(),
    scenario,
    steps: [],
    transcript: [],
    status: "running",
    error: ""
  };
  const mark = (name, ok, detail = "") => {
    report.steps.push({ at: new Date().toISOString(), name, ok: Boolean(ok), detail: String(detail || "") });
  };
  const failAndWrite = (message) => {
    report.status = "failed";
    report.error = String(message || "unknown");
  };
  const writeReport = async () => {
    try {
      const finalState = await e2eReadRendererState(win);
      report.transcript = Array.isArray(finalState?.messages) ? finalState.messages : [];
      report.statusLine = String(finalState?.statusLine || "");
      report.selectedCollection = String(finalState?.selectedCollection || "");
    } catch {
      // best effort
    }
    report.finishedAt = new Date().toISOString();
    const stamp = report.finishedAt.replace(/[:.]/g, "-");
    const outPath = path.join(e2eReportDir(), `chat_verbatim_e2e_${stamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    dbg("runE2EChatScenario", `report=${outPath} status=${report.status}`);
    if (toString(process.env.ZOTERO_E2E_CHAT_EXIT_ON_DONE) === "1") {
      setTimeout(() => app.quit(), 600);
    }
  };

  try {
    await win.webContents.executeJavaScript(
      `(() => Boolean(document.getElementById("agentChatForm") && document.getElementById("collectionsTree")))();`,
      true
    );
    mark("renderer-ready", true, "chat form + collections tree detected");

    const treeReadyStart = Date.now();
    let treeLineCount = 0;
    while (Date.now() - treeReadyStart < 90000) {
      treeLineCount = Number(
        await win.webContents.executeJavaScript(
          `(() => Array.from(document.querySelectorAll(".tree-line")).length)();`,
          true
        )
      );
      if (treeLineCount > 0) break;
      await sleep(800);
    }
    if (treeLineCount <= 0) {
      mark("await-tree-lines", false, "timeout waiting for collection rows");
      failAndWrite("timeout waiting for collection rows");
      await writeReport();
      return;
    }
    mark("await-tree-lines", true, `rows=${treeLineCount}`);

    const selected = await e2eSelectCollection(win, {
      collectionKeyword: scenario.collectionKeyword,
      collectionKey: scenario.collectionKey
    });
    if (!selected?.ok) {
      mark("select-collection", false, selected?.message || "unknown");
      failAndWrite(selected?.message || "collection selection failed");
      await writeReport();
      return;
    }
    mark("select-collection", true, selected?.label || "(selected)");
    await sleep(1200);

    const sent1 = await e2eSendChatMessage(win, scenario.initialCommand);
    if (!sent1?.ok) {
      mark("send-initial-command", false, sent1?.message || "unknown");
      failAndWrite(sent1?.message || "could not send initial command");
      await writeReport();
      return;
    }
    mark("send-initial-command", true, scenario.initialCommand);

    const wait1 = await e2eWaitForAssistantMessage(
      win,
      (text) => /reply with 'yes' to run|reply with `yes` to run|research questions/i.test(String(text || "")),
      scenario.waitMs
    );
    if (!wait1.ok) {
      mark("await-initial-questions", false, wait1.message);
      failAndWrite(wait1.message);
      await writeReport();
      return;
    }
    mark("await-initial-questions", true, wait1.message?.text || "");

    const sent2 = await e2eSendChatMessage(win, scenario.feedback);
    if (!sent2?.ok) {
      mark("send-feedback", false, sent2?.message || "unknown");
      failAndWrite(sent2?.message || "could not send feedback");
      await writeReport();
      return;
    }
    mark("send-feedback", true, scenario.feedback);

    const afterFeedbackState = await e2eReadRendererState(win);
    const baselineAssistantCount = (Array.isArray(afterFeedbackState?.messages) ? afterFeedbackState.messages : []).filter(
      (m) => m?.role === "assistant"
    ).length;
    const wait2 = await e2eWaitForAssistantMessage(
      win,
      (text, state) => {
        const assistantCount = (Array.isArray(state?.messages) ? state.messages : []).filter((m) => m?.role === "assistant")
          .length;
        if (assistantCount <= baselineAssistantCount) return false;
        return /updated research questions|reply with 'yes' to run|reply with `yes` to run/i.test(String(text || ""));
      },
      scenario.waitMs
    );
    if (!wait2.ok) {
      mark("await-refined-questions", false, wait2.message);
      failAndWrite(wait2.message);
      await writeReport();
      return;
    }
    mark("await-refined-questions", true, wait2.message?.text || "");

    const inputReady = await e2eWaitForInputEnabled(win, 30000);
    if (!inputReady.ok) {
      mark("await-input-ready-for-approval", false, inputReady.message);
      failAndWrite(inputReady.message);
      await writeReport();
      return;
    }
    mark("await-input-ready-for-approval", true, "chat input enabled");

    const beforeApprovalState = await e2eReadRendererState(win);
    const baselineExecutionAssistantCount = (Array.isArray(beforeApprovalState?.messages) ? beforeApprovalState.messages : []).filter(
      (m) => m?.role === "assistant"
    ).length;
    const sent3 = await e2eSendChatMessage(win, scenario.approve);
    if (!sent3?.ok) {
      mark("send-approval", false, sent3?.message || "unknown");
      failAndWrite(sent3?.message || "could not send approval");
      await writeReport();
      return;
    }
    mark("send-approval", true, scenario.approve);

    const wait3 = await e2eWaitForAssistantMessage(
      win,
      (text, state) => {
        const assistantCount = (Array.isArray(state?.messages) ? state.messages : []).filter((m) => m?.role === "assistant")
          .length;
        if (assistantCount <= baselineExecutionAssistantCount) return false;
        const lastText = String(text || "").trim();
        const statusText = String(state?.statusLine || "").toLowerCase();
        return lastText.length > 0 || statusText.includes("command executed");
      },
      Math.max(120000, Number(scenario.executionWaitMs || 0), scenario.waitMs)
    );
    if (!wait3.ok) {
      mark("await-execution-result", false, wait3.message);
      failAndWrite(wait3.message);
      await writeReport();
      return;
    }
    const finalText = String(wait3.message?.text || "");
    const statusText = String(wait3.state?.statusLine || "");
    const success = /command executed successfully/i.test(finalText) || /command executed/i.test(statusText);
    mark("await-execution-result", success, finalText);
    if (success) {
      report.status = "ok";
    } else {
      failAndWrite(finalText || "execution did not complete successfully");
    }
    await writeReport();
  } catch (error) {
    mark("harness-exception", false, error?.message || "unknown");
    failAndWrite(error?.message || "harness exception");
    await writeReport();
  }
}

app.whenReady().then(() => {
  featureWorker.start();
  restoreFeatureJobsState();
  persistFeatureJobsState();
  void processNextFeatureJob();
  localDb.ensureDb(app);
  syncEngine = new SyncEngine({ app, db: localDb });
  syncEngine.on("status", (sync) => {
    const main = windows.get("main");
    if (main && !main.isDestroyed()) {
      main.webContents.send("zotero:sync-status", sync);
    }
  });

  registerIpc();
  const mainWindow = createWindow();
  mainWindow.webContents.on("did-finish-load", () => {
    void runE2EChatScenario(mainWindow);
  });
  openAIBatchReconcileTimer = setInterval(() => {
    if (!hasPendingOpenAIBatchJobs()) return;
    void reconcileOpenAIBatchJobs(false);
  }, OPENAI_BATCH_SYNC_COOLDOWN_MS);
  void reconcileOpenAIBatchJobs(true);
  Menu.setApplicationMenu(buildAppMenu());
  registerShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (openAIBatchReconcileTimer) {
    clearInterval(openAIBatchReconcileTimer);
    openAIBatchReconcileTimer = null;
  }
  featureWorker.stop();
  unregisterShortcuts();
});
