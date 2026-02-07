import CSL from "citeproc";
import type { CitationItemRef, DocCitationMeta } from "./types.ts";
import { getReferencesLibrarySync, type ReferenceItem } from "../ui/references/library.ts";
import { getHostContract } from "../ui/host_contract.ts";

// esbuild loads these XML/CSL files as strings (see package.json loaders).
import LOCALE_EN_US from "./locales-en-US.xml";
import APA from "../ui/references/csl/apa.csl";
import CHICAGO_NB from "../ui/references/csl/chicago-note-bibliography.csl";
import CHICAGO_AD from "../ui/references/csl/chicago-author-date.csl";
import HARVARD from "../ui/references/csl/harvard-cite-them-right.csl";
import IEEE from "../ui/references/csl/ieee.csl";
import MLA from "../ui/references/csl/modern-language-association.csl";
import NATURE from "../ui/references/csl/nature.csl";
import OSCOLA from "../ui/references/csl/oscola.csl";
import TURABIAN from "../ui/references/csl/turabian-fullnote-bibliography.csl";
import VANCOUVER from "../ui/references/csl/vancouver.csl";

export type CiteprocCitation = {
  citationID: string;
  citationItems: Array<Record<string, any>>;
  properties: {
    noteIndex: number;
  };
};

export type CiteprocRenderResult = {
  citationHtmlById: Map<string, string>;
  bibliographyHtml: string;
  bibliographyEntriesHtml: string[];
};

type StyleCacheEntry = { xml: string; source: string };
const styleCache = new Map<string, StyleCacheEntry>();

const STYLE_XML_BY_ID: Record<string, string> = {
  apa: APA,
  vancouver: VANCOUVER,
  ieee: IEEE,
  nature: NATURE,
  mla: MLA,
  "modern-language-association": MLA,
  oscola: OSCOLA,
  "chicago-note-bibliography": CHICAGO_NB,
  "chicago-author-date": CHICAGO_AD,
  "turabian-fullnote-bibliography": TURABIAN
};

const normalizeStyleId = (styleId: string): string => (styleId || "").trim().toLowerCase();

// citeproc-js treats strings as XML only if the first non-space character is "<".
// Some loaders can preserve a UTF-8 BOM; strip it and trim safely.
const sanitizeXmlText = (raw: string): string => {
  const text = String(raw || "")
    .replace(/^\uFEFF/, "")
    // Some environments can inject NUL or replacement chars at the start.
    .replace(/^[\u0000\uFFFD]+/, "")
    .trimStart();
  if (text.startsWith("<")) return text;
  const idx = text.indexOf("<");
  return idx >= 0 ? text.slice(idx) : text;
};

const isCslDebugEnabled = (): boolean => Boolean((window as any).__leditorCslDebug);

const looksLikeXml = (raw: string): boolean => {
  const text = sanitizeXmlText(raw);
  return text.trimStart().startsWith("<");
};

const debugXml = (label: string, xml: string): void => {
  if (!isCslDebugEnabled()) return;
  const head = String(xml || "").slice(0, 80);
  const codes = head.split("").slice(0, 12).map((c) => c.charCodeAt(0));
  const firstLt = String(xml || "").indexOf("<");
  // Keep this log compact; it's used to catch BOM/NUL issues in the wild.
  console.log("[CSLDebug] xml", {
    label,
    len: String(xml || "").length,
    head,
    codes,
    startsWithLt: String(xml || "").trimStart().startsWith("<"),
    firstLt
  });
};

const joinPathLike = (dir: string, name: string): string => {
  const base = String(dir || "").replace(/[\\/]+$/, "");
  if (!base) return name;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${sep}${name}`;
};

const getStyleCachePath = (styleId: string): string => {
  const contract = getHostContract();
  const dir = String(contract?.paths?.bibliographyDir || "").trim();
  return joinPathLike(joinPathLike(dir, "csl_styles"), `${normalizeStyleId(styleId) || "apa"}.csl`);
};

const readStyleFromHost = async (styleId: string): Promise<string | null> => {
  try {
    const host = (window as any).leditorHost;
    if (!host?.readFile) return null;
    const res = await host.readFile({ sourcePath: getStyleCachePath(styleId) });
    if (!res?.success || typeof res.data !== "string") return null;
    return res.data;
  } catch {
    return null;
  }
};

const writeStyleToHost = async (styleId: string, xml: string): Promise<void> => {
  try {
    const host = (window as any).leditorHost;
    const contract = getHostContract();
    if (!host?.writeFile || !contract?.policy?.allowDiskWrites) return;
    await host.writeFile({ targetPath: getStyleCachePath(styleId), data: xml });
  } catch {
    // ignore
  }
};

const normalizeLocale = (locale: string): string => {
  const raw = (locale || "").trim();
  if (!raw) return "en-US";
  // We currently ship a single locale; fall back to it for any English-ish variant.
  if (/^en\b/i.test(raw)) return "en-US";
  return "en-US";
};

const getStyleXml = (styleId: string): string => {
  const raw = String(styleId || "").trim();
  const normalized = normalizeStyleId(raw);
  const cached = styleCache.get(normalized);
  if (cached) return cached.xml;
  // Support imported styles (stored by command_map.ts under the original filename).
  try {
    const candidates = [
      `leditor.csl.style:${raw}`,
      `leditor.csl.style:${normalized}`,
      raw ? `leditor.csl.style:${raw}.csl` : "",
      normalized ? `leditor.csl.style:${normalized}.csl` : ""
    ].filter(Boolean);
    for (const key of candidates) {
      const imported = window.localStorage?.getItem(key);
      if (typeof imported === "string" && imported.trim() && looksLikeXml(imported)) {
        const xml = sanitizeXmlText(imported);
        styleCache.set(normalized, { xml, source: `localStorage:${key}` });
        return xml;
      }
    }
  } catch {
    // ignore
  }
  const fromBuiltins = STYLE_XML_BY_ID[normalized];
  if (fromBuiltins && looksLikeXml(fromBuiltins)) {
    const xml = sanitizeXmlText(fromBuiltins);
    styleCache.set(normalized, { xml, source: "bundle" });
    return xml;
  }
  // Graceful fallback: treat unknown style id as APA.
  // Do NOT cache fallback under the requested styleId; ensureCslStyleAvailable()
  // should still attempt a remote fetch for missing/corrupt style XML.
  if (normalized === "apa") {
    const xml = sanitizeXmlText(APA);
    styleCache.set("apa", { xml, source: "bundle" });
    return xml;
  }
  return sanitizeXmlText(APA);
};

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${res.statusText} for ${url}`);
  }
  return await res.text();
};

const resolveRemoteStyleUrls = (styleId: string): string[] => {
  const normalized = normalizeStyleId(styleId);
  const slug = normalized || "apa";
  // Prefer a CDN mirror to avoid GitHub raw flakiness. Fallback to Zotero style endpoint.
  return [
    `https://cdn.jsdelivr.net/gh/citation-style-language/styles@master/${slug}.csl`,
    `https://www.zotero.org/styles/${slug}`
  ];
};

export const ensureCslStyleAvailable = async (styleId: string): Promise<void> => {
  const normalized = normalizeStyleId(styleId);
  // If we already have something valid cached, we are done.
  const existing = styleCache.get(normalized);
  if (existing && looksLikeXml(existing.xml)) return;
  // Try sync resolution paths first (but do not accept fallback APA for other styles).
  try {
    const candidates = [
      `leditor.csl.style:${styleId}`,
      `leditor.csl.style:${normalized}`,
      styleId ? `leditor.csl.style:${styleId}.csl` : "",
      normalized ? `leditor.csl.style:${normalized}.csl` : ""
    ].filter(Boolean);
    for (const key of candidates) {
      const imported = window.localStorage?.getItem(key);
      if (typeof imported === "string" && imported.trim() && looksLikeXml(imported)) {
        const xml = sanitizeXmlText(imported);
        styleCache.set(normalized, { xml, source: `localStorage:${key}` });
        return;
      }
    }
  } catch {
    // ignore
  }
  const bundled = STYLE_XML_BY_ID[normalized];
  if (bundled && looksLikeXml(bundled)) {
    const xml = sanitizeXmlText(bundled);
    styleCache.set(normalized, { xml, source: "bundle" });
    return;
  }

  // Try disk cache in bibliographyDir (offline-friendly).
  const fromHost = await readStyleFromHost(normalized);
  if (typeof fromHost === "string" && fromHost.trim() && looksLikeXml(fromHost)) {
    const xml = sanitizeXmlText(fromHost);
    styleCache.set(normalized, { xml, source: `host:${getStyleCachePath(normalized)}` });
    if (isCslDebugEnabled()) console.log("[CSLDebug] style loaded from host", { styleId: normalized, path: getStyleCachePath(normalized), len: xml.length });
    return;
  }

  // Fetch remote style and cache it (best-effort).
  const urls = resolveRemoteStyleUrls(normalized);
  let lastErr: unknown = null;
  for (const url of urls) {
    try {
      const raw = await fetchText(url);
      if (!looksLikeXml(raw)) {
        throw new Error(`remote style did not look like XML: ${url}`);
      }
      const xml = sanitizeXmlText(raw);
      styleCache.set(normalized, { xml, source: `remote:${url}` });
      try {
        window.localStorage?.setItem(`leditor.csl.style:${normalized}`, xml);
      } catch {
        // ignore
      }
      void writeStyleToHost(normalized, xml);
      if (isCslDebugEnabled()) {
        console.log("[CSLDebug] style fetched", { styleId: normalized, url, len: xml.length });
      }
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`Unable to load CSL style: ${normalized}`);
};

const splitAuthors = (raw: string): string[] => {
  const text = (raw || "").trim();
  if (!text) return [];
  return text
    .split(/;| and /i)
    .map((part) => part.trim())
    .filter(Boolean);
};

const toCslJsonItem = (ref: ReferenceItem): any => {
  // If the library contains a CSL-JSON object, prefer it.
  const raw = (ref as any).csl;
  if (raw && typeof raw === "object") {
    const cloned = { ...raw };
    cloned.id = ref.itemKey;
    return cloned;
  }

  // Otherwise, build a best-effort CSL-JSON item from our minimal schema.
  const authors = splitAuthors(ref.author || "");
  const author = authors.length ? authors.map((name) => ({ literal: name })) : undefined;
  const yearNum = parseInt(String(ref.year || "").trim(), 10);
  const issued =
    Number.isFinite(yearNum) && yearNum > 0
      ? {
          "date-parts": [[yearNum]]
        }
      : undefined;
  return {
    id: ref.itemKey,
    type: "article-journal",
    title: ref.title || ref.itemKey,
    author,
    issued,
    URL: ref.url
  };
};

const buildSys = (locale: string) => {
  const library = getReferencesLibrarySync();
  const localeXml = sanitizeXmlText(LOCALE_EN_US);
  debugXml("locale:en-US", localeXml);
  return {
    retrieveLocale: (_lang: string) => localeXml,
    retrieveItem: (id: string) => {
      const key = String(id || "").trim();
      const ref = library.itemsByKey[key] as ReferenceItem | undefined;
      if (!ref) {
        return { id: key, type: "article-journal", title: key };
      }
      return toCslJsonItem(ref);
    }
  };
};

const toCiteprocItem = (item: CitationItemRef): Record<string, any> => {
  const out: Record<string, any> = { id: item.itemKey };
  const locator = (item.locator || "").trim();
  const label = (item.label || "").trim();
  if (locator) out.locator = locator;
  if (label) out.label = label;
  const prefix = (item.prefix || "").trim();
  const suffix = (item.suffix || "").trim();
  if (prefix) out.prefix = prefix;
  if (suffix) out.suffix = suffix;
  if (item.suppressAuthor) out["suppress-author"] = true;
  if (item.authorOnly) out["author-only"] = true;
  return out;
};

const wrapCitationHtml = (html: string): string => {
  const trimmed = String(html || "").trim();
  if (!trimmed) return "";
  // Citeproc may return bare text or spans; keep it inline and stable.
  if (trimmed.startsWith("<")) return trimmed;
  return `<span class="leditor-citation-rendered">${trimmed}</span>`;
};

export const renderCitationsAndBibliographyWithCiteproc = (args: {
  meta: DocCitationMeta;
  citations: Array<{ citationId: string; items: CitationItemRef[]; noteIndex?: number }>;
  additionalItemKeys?: string[];
}): CiteprocRenderResult => {
  const meta = args.meta;
  const styleId = normalizeStyleId(meta.styleId || "");
  const locale = normalizeLocale(meta.locale || "en-US");
  const styleXml = sanitizeXmlText(getStyleXml(styleId));
  if (isCslDebugEnabled()) {
    const entry = styleCache.get(styleId);
    if (entry) console.log("[CSLDebug] style source", { styleId, source: entry.source });
  }
  debugXml(`style:${styleId}`, styleXml);
  const sys = buildSys(locale);
  const engine = new (CSL as any).Engine(sys, styleXml, locale);
  engine.setOutputFormat("html");

  const noteBased =
    styleId === "chicago-note-bibliography" ||
    styleId === "turabian-fullnote-bibliography" ||
    styleId === "oscola" ||
    styleId === "chicago-note-bibliography-endnote";

  const citations: CiteprocCitation[] = args.citations.map((c, idx) => {
    const provided = typeof c.noteIndex === "number" && Number.isFinite(c.noteIndex) ? c.noteIndex : null;
    const noteIndex = noteBased ? (provided ?? idx + 1) : 0;
    return {
      citationID: c.citationId,
      citationItems: c.items.map(toCiteprocItem),
      properties: { noteIndex }
    };
  });

  // Render all citations in document order.
  const triples: Array<[string, number, string]> = engine.rebuildProcessorState(citations, "html");
  const citationHtmlById = new Map<string, string>();
  triples.forEach(([citationId, _noteIndex, html]) => {
    citationHtmlById.set(String(citationId), wrapCitationHtml(html));
  });

  // Ensure all extra items are registered (e.g. from used store).
  const allItemKeys = new Set<string>();
  args.citations.forEach((c) => c.items.forEach((it) => allItemKeys.add(it.itemKey)));
  (args.additionalItemKeys ?? []).forEach((k) => allItemKeys.add(String(k || "").trim()));
  engine.updateItems(Array.from(allItemKeys).filter(Boolean));

  const bib = engine.makeBibliography();
  const bibliographyEntriesHtml = Array.isArray(bib?.[1]) ? (bib[1] as string[]) : [];
  const bibliographyHtml = bibliographyEntriesHtml.length
    ? `<div class="csl-bib-body">${bibliographyEntriesHtml.join("")}</div>`
    : "";

  return { citationHtmlById, bibliographyHtml, bibliographyEntriesHtml };
};

export const renderBibliographyEntriesWithCiteproc = (args: {
  meta: DocCitationMeta;
  itemKeys: string[];
}): string[] => {
  const meta = args.meta;
  const styleId = normalizeStyleId(meta.styleId || "");
  const locale = normalizeLocale(meta.locale || "en-US");
  const styleXml = sanitizeXmlText(getStyleXml(styleId));
  debugXml(`style:${styleId}`, styleXml);
  const sys = buildSys(locale);
  const engine = new (CSL as any).Engine(sys, styleXml, locale);
  engine.setOutputFormat("html");

  // Seed processor state in the intended order (important for numeric styles).
  const citations: CiteprocCitation[] = (args.itemKeys || [])
    .map((k) => String(k || "").trim())
    .filter(Boolean)
    .map((itemKey, idx) => ({
      citationID: `bib-${idx}-${itemKey}`,
      citationItems: [{ id: itemKey }],
      properties: { noteIndex: 0 }
    }));
  engine.rebuildProcessorState(citations, "html");
  engine.updateItems(args.itemKeys);

  const bib = engine.makeBibliography();
  return Array.isArray(bib?.[1]) ? (bib[1] as string[]) : [];
};
