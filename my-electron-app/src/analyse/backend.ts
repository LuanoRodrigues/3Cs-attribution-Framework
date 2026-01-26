import fs from "fs";
import path from "path";

import type {
  AnalyseDatasets,
  AnalyseRun,
  SectionLevel,
  BatchPayload,
  BatchRecord,
  SectionRecord,
  RunMetrics
} from "./types";
import { DEFAULT_COLLECTION_NAME } from "./constants";
import { getSetting } from "../config/settingsFacade";
import { GENERAL_KEYS, ZOTERO_KEYS } from "../config/settingsKeys";
import { getAnalyseRoot } from "../session/sessionPaths";

export const ANALYSE_DIR = getAnalyseRoot();
const LEGACY_ANALYSE_DIR = path.join(process.env.HOME ?? "", ".annotarium", "analyse");
const LEGACY_EVIDENCE_DIR = path.join(process.env.HOME ?? "", "annotarium", "evidence_coding_outputs");

function normalizeAnalysePath(candidate?: string): string | undefined {
  if (!candidate) return undefined;
  const resolved = path.resolve(candidate);
  const legacyAnalyse = path.resolve(LEGACY_ANALYSE_DIR);
  const legacyEvidence = path.resolve(LEGACY_EVIDENCE_DIR);
  for (const legacy of [legacyAnalyse, legacyEvidence]) {
    if (resolved === legacy) return ANALYSE_DIR;
    if (resolved.startsWith(legacy + path.sep)) {
      const suffix = path.relative(legacy, resolved);
      return path.join(ANALYSE_DIR, suffix);
    }
  }
  return candidate;
}

function migrateLegacyAnalyseDir(): void {
  const candidates = [LEGACY_ANALYSE_DIR, LEGACY_EVIDENCE_DIR];
  fs.mkdirSync(ANALYSE_DIR, { recursive: true });
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const entries = fs.readdirSync(candidate, { withFileTypes: true });
    for (const entry of entries) {
      const source = path.join(candidate, entry.name);
      const target = path.join(ANALYSE_DIR, entry.name);
      if (fs.existsSync(target)) {
        throw new Error(`Legacy analyse migration aborted: target already exists at ${target}`);
      }
      if (entry.isDirectory()) {
        fs.cpSync(source, target, { recursive: true, errorOnExist: true });
      } else if (entry.isFile()) {
        fs.copyFileSync(source, target);
      }
    }
  }
}

try {
  fs.mkdirSync(ANALYSE_DIR, { recursive: true });
  migrateLegacyAnalyseDir();
} catch {
  // best effort: throw on collision but swallow other fs errors to keep startup predictable.
}

const BATCH_FILE_CANDIDATES = ["pyr_l1_batches.json", "pyr_l1_batches.feather"];

const SECTION_FILE_MAP: Record<SectionLevel, string[]> = {
  r1: ["pyr_l1_sections.json", "pyr_l1_sections.feather"],
  r2: ["pyr_l2_sections.json", "pyr_l2_sections.feather"],
  r3: ["pyr_l3_sections.json", "pyr_l3_sections.feather"],
};

function preferredCollection(): string | null {
  const zotero = getSetting<string>(ZOTERO_KEYS.lastCollection);
  if (typeof zotero === "string" && zotero.trim()) {
    return zotero.trim();
  }
  const general = getSetting<string>(GENERAL_KEYS.collectionName);
  if (typeof general === "string" && general.trim()) {
    return general.trim();
  }
  return null;
}

export function getAnalyseCollectionDir(collection: string): string {
  const target = path.join(ANALYSE_DIR, collection);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

export function getDefaultBaseDir(): string {
  const collection = preferredCollection();
  const name = collection ?? DEFAULT_COLLECTION_NAME;
  return getAnalyseCollectionDir(name);
}

export function normalizeBaseDir(baseDir?: string): string | undefined {
  return normalizeAnalysePath(baseDir);
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function findFirstExistingFile(dir: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const candidatePath = path.join(dir, candidate);
    if (fileExists(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

function hasAnyFile(dir: string, candidates: string[]): boolean {
  return findFirstExistingFile(dir, candidates) !== null;
}

export function loadDirectQuoteLookup(runPath: string): { data: Record<string, unknown>; path: string | null } {
  if (!runPath) return { data: {}, path: null };
  // prefer thematics_outputs/<runId> if present, then collection-level lookup
  const runDir = path.dirname(runPath);
  const runId = path.basename(runPath);
  const candidates = [
    path.join(runDir, "thematics_outputs", runId, "direct_quote_lookup.json"),
    path.join(runDir, "direct_quote_lookup.json"),
    path.join(path.dirname(runDir), "direct_quote_lookup.json"),
    path.join(runPath, "direct_quote_lookup.json")
  ];
  const target = candidates.find((p) => fileExists(p)) || null;
  if (!target) return { data: {}, path: null };
  let data: Record<string, unknown> | null = null;
  try {
    const raw = fs.readFileSync(target, { encoding: "utf8" });
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn("[analyse][dq_lookup] failed to read", { path: target, err: (err as Error).message });
    return { data: {}, path: target };
  }
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    Object.entries(data).forEach(([k, v]) => {
      out[String(k).trim().toLowerCase()] = v;
    });
    console.info("[analyse][dq_lookup] loaded", { path: target, count: Object.keys(out).length });
    return { data: out, path: target };
  }
  return { data: {}, path: target };
}

function readJsonFile<T = unknown>(filePath: string): T | null {
  try {
    const stat = fs.statSync(filePath);
    // Avoid building gigantic strings for very large files; let caller stream instead.
    if (stat.size > 150 * 1024 * 1024) {
      throw new Error("file-too-large");
    }
    const raw = fs.readFileSync(filePath, { encoding: "utf8" });
    return JSON.parse(raw) as T;
  } catch (err) {
    // Swallow size and parser errors; caller can stream.
    return null;
  }
}

function streamJsonArray(filePath: string, maxItems = 20000): Record<string, unknown>[] {
  const fd = fs.openSync(filePath, "r");
  const chunkSize = 4 * 1024 * 1024; // 4MB
  const buffer = Buffer.alloc(chunkSize);
  let buf = "";
  let inString = false;
  let escape = false;
  let depth = 0;
  const out: Record<string, unknown>[] = [];

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (bytesRead === 0) break;
      const chunk = buffer.toString("utf8", 0, bytesRead);
      for (const ch of chunk) {
        if (inString) {
          buf += ch;
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === "\"") {
            inString = false;
          }
          continue;
        }
        if (ch === "\"") {
          inString = true;
          buf += ch;
          continue;
        }
        if (ch === "{") {
          depth += 1;
          buf += ch;
          continue;
        }
        if (ch === "}") {
          depth -= 1;
          buf += ch;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(buf);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                out.push(parsed as Record<string, unknown>);
              }
            } catch {
              /* ignore malformed chunk */
            }
            buf = "";
            if (out.length >= maxItems) {
              return out;
            }
          }
          continue;
        }
        if (depth > 0) {
          buf += ch;
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function safeString(value: unknown, fallback?: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return fallback ?? "";
}

function safeNumber(value: unknown, fallback?: number): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizePayload(raw: unknown, batchId: string, idx: number): BatchPayload {
  if (typeof raw === "string") {
    return { id: `${batchId}:${idx}`, text: raw };
  }
  const obj = asRecord(raw);
  if (!obj) {
    return { id: `${batchId}:${idx}`, text: "" };
  }

  const pageVal = obj.page;
  const payload: BatchPayload = {
    ...obj,
    id: safeString(obj.id ?? `${batchId}:${idx}`),
    text: safeString(obj.text ?? obj.content ?? obj.body ?? ""),
    page: typeof pageVal === "number" ? pageVal : undefined,
  };
  return payload;
}

function extractTitleFromHtml(html: string): string {
  if (!html) return "";
  const headingMatch = html.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/i);
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].replace(/<[^>]+>/g, "").trim();
  }
  const paraMatch = html.match(/<p[^>]*>(.*?)<\/p>/i);
  if (paraMatch && paraMatch[1]) {
    return paraMatch[1].replace(/<[^>]+>/g, "").trim();
  }
  return "";
}

function decodeHtmlEntities(value: string): string {
  if (!value) return "";
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractTagsFromHtml(html: string): string[] {
  if (!html) return [];
  const tags: string[] = [];
  const regex = /data-tags="([^"]*)"/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html))) {
    const raw = decodeHtmlEntities(match[1] || "");
    raw
      .split(/[;|,/]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => tags.push(t));
  }
  return Array.from(new Set(tags));
}

function tokenizePotentialTheme(value: string): string[] {
  if (!value) return [];
  const cleaned = value.replace(/^mixed:\s*/i, "");
  return Array.from(
    new Set(
      cleaned
        .split(/[|,;/]/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
}

function normalizeTagList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
      )
    );
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[;|,/]/)
          .map((t) => t.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
}

export function resolveSectionsRoot(baseDir?: string): string | null {
  const normalized = normalizeBaseDir(baseDir);
  const candidateBase = normalized ? path.resolve(normalized) : getDefaultBaseDir();

  const checkDir = (dir: string): string | null => {
    const candidates = [
      path.join(dir, "thematics_outputs", "sections"),
      path.join(dir, "sections"),
      dir,
    ];
    for (const candidate of candidates) {
      if (fileExists(candidate) && isDirectory(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  const direct = checkDir(candidateBase);
  if (direct) {
    console.info("[analyse][sectionsRoot]", { baseDir, resolved: direct, mode: "direct" });
    return direct;
  }

  // Look one level down for collections that contain thematics_outputs/sections
  try {
    const children = fs.readdirSync(candidateBase, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const child of children) {
      const resolved = checkDir(path.join(candidateBase, child.name));
      if (resolved) {
        console.info("[analyse][sectionsRoot]", {
          baseDir,
          resolved,
          mode: "child",
          collection: child.name,
        });
        return resolved;
      }
    }
  } catch (err) {
    console.info("[analyse][sectionsRoot][scan-failed]", { baseDir, error: String(err) });
  }

  console.info("[analyse][sectionsRoot][fallback-none]", { baseDir, candidateBase });
  return null;
}

export function discoverRuns(baseDir?: string): { runs: AnalyseRun[]; sectionsRoot: string | null } {
  const sectionsRoot = resolveSectionsRoot(baseDir);
  if (!sectionsRoot) {
    console.info("[analyse][discoverRuns] no sectionsRoot", { baseDir });
    return { runs: [], sectionsRoot: null };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sectionsRoot, { withFileTypes: true });
  } catch {
    console.info("[analyse][discoverRuns] readdir failed", { sectionsRoot });
    return { runs: [], sectionsRoot };
  }

  const runs: AnalyseRun[] = [];
  entries.forEach((entry) => {
    if (!entry.isDirectory()) {
      return;
    }
    const runPath = path.join(sectionsRoot, entry.name);
    const hasBatches = hasAnyFile(runPath, BATCH_FILE_CANDIDATES);
    const hasSections = hasAnyFile(runPath, SECTION_FILE_MAP.r1);
    const hasL2 = hasAnyFile(runPath, SECTION_FILE_MAP.r2);
    const hasL3 = hasAnyFile(runPath, SECTION_FILE_MAP.r3);

    if (!(hasBatches || hasSections || hasL2 || hasL3)) {
      return;
    }

    runs.push({
      id: entry.name,
      label: entry.name,
      path: runPath,
      hasBatches,
      hasSections,
      hasL2,
      hasL3,
    });
  });

  console.info("[analyse][discoverRuns]", {
    sectionsRoot,
    count: runs.length,
    runIds: runs.map((r) => r.id),
  });

  return { runs, sectionsRoot };
}

export function buildDatasetHandles(runPath: string): AnalyseDatasets {
  const datasets: AnalyseDatasets = {};
  if (!runPath) {
    console.info("[analyse][datasets] empty runPath");
    return datasets;
  }
  const batches = findFirstExistingFile(runPath, BATCH_FILE_CANDIDATES);
  if (batches) {
    datasets.batches = batches;
  }
  const sectionsR1 = findFirstExistingFile(runPath, SECTION_FILE_MAP.r1);
  if (sectionsR1) {
    datasets.sectionsR1 = sectionsR1;
  }
  const sectionsR2 = findFirstExistingFile(runPath, SECTION_FILE_MAP.r2);
  if (sectionsR2) {
    datasets.sectionsR2 = sectionsR2;
  }
  const sectionsR3 = findFirstExistingFile(runPath, SECTION_FILE_MAP.r3);
  if (sectionsR3) {
    datasets.sectionsR3 = sectionsR3;
  }
  console.info("[analyse][datasets]", { runPath, batches, sectionsR1, sectionsR2, sectionsR3 });
  return datasets;
}

export async function loadBatches(runPath: string): Promise<BatchRecord[]> {
  if (!runPath) return [];
  let datasetPath = findFirstExistingFile(runPath, BATCH_FILE_CANDIDATES);
  if (!datasetPath) return [];
  console.info("[analyse][loadBatches]", { runPath, datasetPath });

  let raw = readJsonFile<unknown[]>(datasetPath);
  if (!raw || !Array.isArray(raw)) {
    try {
      raw = streamJsonArray(datasetPath, 20000);
    } catch {
      return [];
    }
  }

  const buckets: Record<string, BatchPayload[]> = {};

  const normalisePayload = (entry: Record<string, unknown>, idx: number): BatchPayload => {
    const text = safeString(
      entry.paraphrase ??
        entry.direct_quote ??
        entry.section_text ??
        entry.payload_json ??
        entry.researcher_comment ??
        ""
    );
    const page = safeNumber(entry.page);
    return {
      id: safeString(entry.item_key ?? entry.direct_quote_id ?? `p_${idx + 1}`),
      text,
      page,
      ...entry
    } as BatchPayload;
  };

  raw.forEach((entry, idx) => {
    const obj = asRecord(entry);
    if (!obj) return;
    const rq = safeString(obj.rq_question ?? obj.rq);
    const over = safeString(obj.overarching_theme ?? obj.gold_theme ?? obj.theme ?? obj.potential_theme);
    const key = `${rq}::${over}` || `batch_${idx + 1}`;
    if (!buckets[key]) {
      buckets[key] = [];
    }
    buckets[key].push(normalisePayload(obj, buckets[key].length));
  });

  let batchIndex = 1;
  return Object.entries(buckets).map(([key, payloads]) => {
    const [rq, over] = key.split("::");
    return {
      id: safeString(key || `batch_${batchIndex++}`),
      theme: safeString(over),
      potentialTheme: safeString(over),
      evidenceType: safeString(payloads[0]?.evidence_type ?? payloads[0]?.evidence_type_norm),
      size: payloads.length,
      payloads,
      prompt: "",
      rqQuestion: safeString(rq)
    };
  });
}

export async function loadSections(runPath: string, level: SectionLevel): Promise<SectionRecord[]> {
  if (!runPath) return [];
  if (level === "r1") {
    const batchPath = findFirstExistingFile(runPath, BATCH_FILE_CANDIDATES);
    if (batchPath) {
      console.info("[analyse][loadSections][r1-batches]", { runPath, batchPath });
      const batches = await loadBatches(runPath);
      if (!batches.length) return [];
      const derived: SectionRecord[] = [];
      const yieldEvery = 500;
      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        const batch = batches[bIdx];
        for (let pIdx = 0; pIdx < batch.payloads.length; pIdx++) {
          const p = batch.payloads[pIdx] as Record<string, unknown>;
          const meta = asRecord(p.meta) || {};
          const rq = safeString(p.rq_question ?? p.rq ?? meta.rq);
          const gold = safeString(p.overarching_theme ?? p.gold_theme ?? p.payload_theme ?? p.theme ?? meta.gold_theme);
          const ev = safeString(p.evidence_type ?? p.evidence_type_norm ?? meta.evidence_type);
          const routeVal = safeString(p.route_value ?? p.route ?? meta.route_value ?? meta.route ?? gold);
          const potentialTheme = safeString(p.potential_theme ?? meta.potential_theme);
          const potentialTokens = tokenizePotentialTheme(potentialTheme);
          const html = safeString(p.section_html ?? p.section_text) || `<p>${safeString(p.paraphrase ?? p.direct_quote ?? "")}</p>`;
          const customId = safeString(p.direct_quote_id ?? p.custom_id ?? meta.custom_id ?? `${bIdx}_${pIdx}`);
          const title =
            safeString(p.section_title) ||
            extractTitleFromHtml(html) ||
            safeString(p.potential_theme ?? p.theme ?? p.payload_theme) ||
            safeString(p.rq_question ?? p.rq) ||
            customId;
          const tags = Array.from(
            new Set([
              ...normalizeTagList(p.tags ?? p.tag_cluster ?? p.section_tags ?? meta.tags ?? meta.tag_cluster ?? meta.section_tags),
              ...extractTagsFromHtml(html),
            ])
          );
          derived.push({
            id: customId || `r1_payload_${bIdx}_${pIdx}`,
            html,
            meta: {
              ...meta,
              rq,
              gold_theme: gold,
              evidence_type: ev,
              route: routeVal,
              route_value: routeVal,
              potential_theme: potentialTheme,
              tags,
            },
            route: routeVal || undefined,
            routeValue: routeVal || undefined,
            title: title || customId,
            rq: rq || undefined,
            goldTheme: gold || undefined,
            evidenceType: ev || undefined,
            potentialTheme: potentialTheme || undefined,
            potentialTokens: potentialTokens.length ? potentialTokens : undefined,
            tags,
            paraphrase: safeString(p.paraphrase ?? meta.paraphrase) || undefined,
            directQuote: safeString(p.direct_quote ?? meta.direct_quote) || undefined,
            researcherComment: safeString(p.researcher_comment ?? meta.researcher_comment) || undefined,
            firstAuthorLast: safeString(p.first_author_last ?? meta.first_author_last) || undefined,
            authorSummary: safeString(p.author_summary ?? meta.author_summary) || undefined,
            author: safeString(p.author ?? meta.author) || undefined,
            year: safeString(p.year ?? meta.year) || undefined,
            source: safeString(p.source ?? meta.source) || undefined,
            titleText: safeString(p.title ?? meta.title) || undefined,
            url: safeString(p.url ?? meta.url) || undefined,
            itemKey: safeString(p.item_key ?? meta.item_key) || undefined,
            page: safeNumber(p.page ?? meta.page),
          });
          if (derived.length % yieldEvery === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        }
      }
      console.info("[analyse][loadSections][r1-batches][built]", { runPath, count: derived.length });
      return derived;
    }
  }

  let datasetPath = findFirstExistingFile(runPath, SECTION_FILE_MAP[level]);
  if (!datasetPath) {
    console.warn("[analyse][loadSections] no sections file found", { runPath, level });
    return [];
  }
  console.info("[analyse][loadSections]", { runPath, level, datasetPath });

  const raw = readJsonFile<unknown[]>(datasetPath);
  if (!raw || !Array.isArray(raw)) return [];

  return raw.reduce<SectionRecord[]>((acc, entry, entryIdx) => {
    const obj = asRecord(entry);
    if (!obj) {
      return acc;
    }
    let meta = asRecord(obj.meta) || {};
    if (!Object.keys(meta).length && typeof obj.meta_json === "string") {
      try {
        const parsed = JSON.parse(obj.meta_json);
        const parsedMeta = asRecord(parsed);
        if (parsedMeta) {
          meta = parsedMeta;
        }
      } catch {
        // ignore invalid JSON
      }
    }
    const html = safeString(obj.section_html ?? obj.html);
    const customId = safeString(obj.custom_id ?? meta.custom_id ?? `section_${entryIdx + 1}`);
    const routeValue = safeString(obj.route_value ?? meta.route_value ?? meta.route);
    const rq = safeString(obj.rq ?? meta.rq);
    const gold = safeString(obj.gold_theme ?? meta.gold_theme);
    const ev = safeString(obj.evidence_type ?? meta.evidence_type);
    const potentialTheme = safeString(obj.potential_theme ?? meta.potential_theme);
    const potentialTokens = tokenizePotentialTheme(potentialTheme);
    const tags = Array.from(
      new Set([
        ...normalizeTagList(obj.tags ?? obj.tag_cluster ?? meta.tags ?? meta.tag_cluster),
        ...extractTagsFromHtml(html),
      ])
    );
    const title = extractTitleFromHtml(html) || safeString(obj.title ?? meta.title) || customId;
    acc.push({
      id: customId,
      html,
      meta,
      route: routeValue || undefined,
      routeValue: routeValue || undefined,
      title,
      rq: rq || undefined,
      goldTheme: gold || undefined,
      evidenceType: ev || undefined,
      potentialTheme: potentialTheme || undefined,
      potentialTokens: potentialTokens.length ? potentialTokens : undefined,
      tags,
      paraphrase: safeString(obj.paraphrase ?? meta.paraphrase) || undefined,
      directQuote: safeString(obj.direct_quote ?? meta.direct_quote) || undefined,
      researcherComment: safeString(obj.researcher_comment ?? meta.researcher_comment) || undefined,
      firstAuthorLast: safeString(obj.first_author_last ?? meta.first_author_last) || undefined,
      authorSummary: safeString(obj.author_summary ?? meta.author_summary) || undefined,
      author: safeString(obj.author ?? meta.author) || undefined,
      year: safeString(obj.year ?? meta.year) || undefined,
      source: safeString(obj.source ?? meta.source) || undefined,
      titleText: safeString(obj.title ?? meta.title) || undefined,
      url: safeString(obj.url ?? meta.url) || undefined,
      itemKey: safeString(obj.item_key ?? meta.item_key) || undefined,
      page: safeNumber(obj.page ?? meta.page),
    });
    return acc;
  }, []);
}

export async function summariseRun(runPath: string): Promise<RunMetrics> {
  if (!runPath) {
    return { batches: 0, sectionsR1: 0, sectionsR2: 0, sectionsR3: 0 };
  }
  console.info("[analyse][summariseRun]", { runPath });
  const [batches, s1, s2, s3] = await Promise.all([
    loadBatches(runPath).then((v) => v.length).catch(() => 0),
    loadSections(runPath, "r1").then((v) => v.length).catch(() => 0),
    loadSections(runPath, "r2").then((v) => v.length).catch(() => 0),
    loadSections(runPath, "r3").then((v) => v.length).catch(() => 0),
  ]);
  return {
    batches,
    sectionsR1: s1,
    sectionsR2: s2,
    sectionsR3: s3,
  };
}
