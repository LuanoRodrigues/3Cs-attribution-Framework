import type { RetrieveProviderId, RetrieveQuery, RetrieveRecord } from "../../../shared/types/retrieve";
import { DATABASE_KEYS } from "../../../config/settingsKeys";
import { getSecretsVault } from "../../../config/secretsVaultInstance";
import { sanitizeSecret } from "./util";

const USER_AGENT = "Annotarium/1.0";
const SEMANTIC_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search";
const CROSSREF_SEARCH_URL = "https://api.crossref.org/works";
const OPENALEX_SEARCH_URL = "https://api.openalex.org/works";
const ELSEVIER_SEARCH_URL = "https://api.elsevier.com/content/search/scopus";
const WOS_SEARCH_URL = "https://api.clarivate.com/apis/wos-starter/v1/documents";
const UNPAYWALL_BASE_URL = "https://api.unpaywall.org/v2";

const readVaultSecret = (name: string): string => {
  try {
    return sanitizeSecret(getSecretsVault().getSecret(name));
  } catch {
    return "";
  }
};

const getSemanticKey = (): string =>
  readVaultSecret(DATABASE_KEYS.semanticScholarKey) ||
  sanitizeSecret(process.env.SEMANTIC_API) ||
  sanitizeSecret(process.env.SEMANTIC_SCHOLAR_API_KEY);

const getElsevierKey = (): string =>
  readVaultSecret(DATABASE_KEYS.elsevierKey) || sanitizeSecret(process.env.ELSEVIER_KEY) || sanitizeSecret(process.env.ELSEVIER_API);

const getWosKey = (): string => readVaultSecret(DATABASE_KEYS.wosKey) || sanitizeSecret(process.env.WOS_API_KEY) || sanitizeSecret(process.env.wos_api_key);

export const getUnpaywallEmail = (): string =>
  sanitizeSecret(process.env.UNPAYWALL_EMAIL) || sanitizeSecret(process.env.unpaywall_email);
const COS_MERGE_ORDER: RetrieveProviderId[] = ["semantic_scholar", "openalex", "crossref"];

export interface ProviderHeaders {
  [key: string]: string;
}

export interface ProviderSearchRequest {
  providerId: RetrieveProviderId;
  url: string;
  headers?: ProviderHeaders;
}

export interface ProviderSearchResult {
  records: RetrieveRecord[];
  total: number;
  nextCursor?: string | number | null;
}

export interface ProviderSpec {
  id: RetrieveProviderId;
  label: string;
  rateMs: number;
  buildRequest?: (query: RetrieveQuery) => ProviderSearchRequest | undefined;
  parseResponse?: (payload: unknown) => ProviderSearchResult;
  mergeSources?: RetrieveProviderId[];
}

const SEMANTIC_FIELDS = [
  "paperId",
  "externalIds",
  "title",
  "abstract",
  "year",
  "venue",
  "publicationVenue",
  "publicationDate",
  "publicationTypes",
  "journal",
  "url",
  "authors",
  "citationCount",
  "referenceCount",
  "influentialCitationCount",
  "isOpenAccess",
  "openAccessPdf",
  "fieldsOfStudy",
  "s2FieldsOfStudy",
  "tldr"
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const safeString = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value).trim();
  }
  return "";
};

const maybeString = (value: unknown): string | undefined => {
  const candidate = safeString(value);
  return candidate ? candidate : undefined;
};

const safeNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const safeYearValue = (value: unknown): number | undefined => {
  const numeric = safeNumber(value);
  if (numeric && numeric > 0) {
    return Math.floor(numeric);
  }
  return undefined;
};

const buildUrlWithQuery = (base: string, params?: Record<string, unknown>): string => {
  const url = new URL(base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) {
        continue;
      }
      const formatted = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
      url.searchParams.append(key, formatted);
    }
  }
  return url.toString();
};

const getLimit = (query: RetrieveQuery, fallback: number, maximum: number): number => {
  if (typeof query.limit === "number" && Number.isFinite(query.limit) && query.limit > 0) {
    return Math.min(Math.max(Math.floor(query.limit), 1), maximum);
  }
  return fallback;
};

const getOffset = (query: RetrieveQuery): number => {
  if (typeof query.offset === "number" && Number.isFinite(query.offset) && query.offset >= 0) {
    return Math.floor(query.offset);
  }
  return 0;
};

const buildYearRange = (yearFrom?: number, yearTo?: number): string | undefined => {
  const from = safeYearValue(yearFrom);
  const to = safeYearValue(yearTo);
  if (from && to) {
    return `${from}-${to}`;
  }
  return undefined;
};

const scopusQueryWithYear = (query: string, yearFrom?: number, yearTo?: number): string => {
  const trimmed = query.trim();
  if (!trimmed) {
    return "";
  }
  const upper = trimmed.toUpperCase();
  if (upper.includes("PUBYEAR")) {
    return trimmed;
  }
  const parts = [trimmed];
  if (yearFrom && yearFrom > 0) {
    parts.push(`PUBYEAR >= ${Math.floor(yearFrom)}`);
  }
  if (yearTo && yearTo > 0) {
    parts.push(`PUBYEAR <= ${Math.floor(yearTo)}`);
  }
  return parts.join(" AND ");
};

const wosQueryWithYear = (query: string, yearFrom?: number, yearTo?: number): string => {
  const trimmed = query.trim();
  if (!trimmed) {
    return "";
  }
  const upper = trimmed.toUpperCase();
  if (upper.includes("PY=")) {
    return trimmed;
  }
  if (yearFrom && yearFrom > 0 && yearTo && yearTo > 0) {
    return `${trimmed} AND PY=(${Math.floor(yearFrom)}-${Math.floor(yearTo)})`;
  }
  if (yearFrom && yearFrom > 0) {
    return `${trimmed} AND PY=(${Math.floor(yearFrom)}-${Math.floor(yearFrom)})`;
  }
  if (yearTo && yearTo > 0) {
    return `${trimmed} AND PY=(${Math.floor(yearTo)}-${Math.floor(yearTo)})`;
  }
  return trimmed;
};

const buildOpenAlexFilter = (yearFrom?: number, yearTo?: number): string | undefined => {
  const parts: string[] = [];
  if (yearFrom && yearFrom > 0) {
    parts.push(`from_publication_date:${Math.floor(yearFrom)}-01-01`);
  }
  if (yearTo && yearTo > 0) {
    parts.push(`to_publication_date:${Math.floor(yearTo)}-12-31`);
  }
  return parts.length ? parts.join(",") : undefined;
};

const normalizeDoi = (value: unknown): string => {
  const candidate = safeString(value);
  if (!candidate) {
    return "";
  }
  return candidate.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
};

const doiFromExternalIds = (value: unknown): string => {
  if (!isRecord(value)) {
    return "";
  }
  return (
    normalizeDoi(value.DOI) ||
    normalizeDoi(value.doi) ||
    normalizeDoi(value["doi"]) ||
    ""
  );
};

const detectOpenAccessStatus = (value: unknown): "open" | "closed" | undefined => {
  if (typeof value === "boolean") {
    return value ? "open" : "closed";
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized.includes("open")) {
      return "open";
    }
    if (normalized.includes("closed")) {
      return "closed";
    }
  }
  return undefined;
};

const buildOpenAccessRecord = (
  statusSource: unknown,
  url?: string,
  license?: string
): RetrieveRecord["openAccess"] | undefined => {
  const status = detectOpenAccessStatus(statusSource);
  const payload: RetrieveRecord["openAccess"] = {};
  if (status) {
    payload.status = status;
  }
  if (url) {
    payload.url = url;
  }
  if (license) {
    payload.license = license;
  }
  return Object.keys(payload).length ? payload : undefined;
};

const authorsFromSemantic = (value: unknown): string[] => {
  if (typeof value === "string") {
    return value
      .split(/,\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      if (isRecord(item)) {
        return safeString(item.name ?? item.displayName);
      }
      return "";
    })
    .filter(Boolean);
};

const authorsFromCrossref = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }
      const given = safeString(item.given);
      const family = safeString(item.family);
      return [given, family].filter(Boolean).join(" ").trim();
    })
    .filter(Boolean);
};

const authorsFromOpenAlex = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }
      const author = item.author;
      if (!isRecord(author)) {
        return "";
      }
      return safeString(
        author.display_name ??
          author.displayName ??
          author.name ??
          author.literature_name ??
          author.normalized_name
      );
    })
    .filter(Boolean);
};

const authorsFromDelimited = (value: unknown): string[] => {
  const text = safeString(value);
  if (!text) {
    return [];
  }
  return text
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const openAlexAbstractFromInverted = (value: unknown): string => {
  if (!isRecord(value)) {
    return "";
  }
  const positions: Array<{ index: number; word: string }> = [];
  Object.entries(value).forEach(([word, coords]) => {
    if (!Array.isArray(coords)) {
      return;
    }
    const cleaned = safeString(word);
    if (!cleaned) {
      return;
    }
    coords.forEach((pos) => {
      if (typeof pos === "number" && Number.isFinite(pos) && pos >= 0) {
        positions.push({ index: Math.floor(pos), word: cleaned });
      }
    });
  });
  if (!positions.length) {
    return "";
  }
  const maxIndex = Math.max(...positions.map((entry) => entry.index));
  const slots = Array.from({ length: maxIndex + 1 }, () => "");
  positions.forEach((entry) => {
    slots[entry.index] = entry.word;
  });
  return slots.filter(Boolean).join(" ").trim();
};

const firstStringFromArray = (value: unknown): string | undefined => {
  if (Array.isArray(value) && value.length) {
    return safeString(value[0]);
  }
  if (typeof value === "string") {
    return safeString(value);
  }
  return undefined;
};

const getWosUrl = (links: unknown): string | undefined => {
  const list = Array.isArray(links) ? links : isRecord(links) ? [links] : [];
  for (const item of list) {
    if (!isRecord(item)) {
      continue;
    }
    const href = maybeString(item.url ?? item.link);
    if (href) {
      return href;
    }
  }
  return undefined;
};

const pickElsevierUrl = (links: unknown): string | undefined => {
  const list = Array.isArray(links) ? links : isRecord(links) ? [links] : [];
  for (const item of list) {
    if (!isRecord(item)) {
      continue;
    }
    const ref = safeString(item["@ref"]);
    if (["scidir", "scopus", "self"].includes(ref.toLowerCase())) {
      const href = maybeString(item["@href"] ?? item.href);
      if (href) {
        return href;
      }
    }
  }
  return undefined;
};

const authorsFromWos = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  return list
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }
      return safeString(item.displayName ?? item.wosStandard);
    })
    .filter(Boolean);
};

type RetrieveRecordInput = Omit<RetrieveRecord, "paperId"> & { paperId?: string };

const buildPaperId = (record: Partial<RetrieveRecord>): string => {
  const doi = normalizeDoi(record.doi);
  if (doi) {
    return `doi:${doi.toLowerCase()}`;
  }
  const rawUrl = safeString(record.url);
  if (rawUrl) {
    return `url:${rawUrl.toLowerCase()}`;
  }
  const title = record.title?.trim().toLowerCase() ?? "";
  const year = record.year ? String(record.year) : "";
  if (title || year) {
    return `title:${title}|year:${year}`;
  }
  const authors = Array.isArray(record.authors) ? record.authors.join(",") : "";
  return `source:${record.source ?? "unknown"}|authors:${authors}|year:${year}`;
};

const ensurePaperId = (record: RetrieveRecordInput): string => {
  if (record.paperId) {
    return record.paperId;
  }
  const id = buildPaperId(record);
  record.paperId = id;
  return id;
};

const normalizeRecord = (record: RetrieveRecordInput): RetrieveRecord => {
  const paperId = ensurePaperId(record);
  return {
    ...record,
    paperId
  };
};

const dedupeKey = (record: RetrieveRecord, fallback: number): string => {
  const candidate = record.paperId || buildPaperId(record);
  if (candidate) {
    return candidate;
  }
  return `idx:${fallback}`;
};

const parseSemanticResponse = (payload: unknown): ProviderSearchResult => {
  if (!isRecord(payload)) {
    return { records: [], total: 0 };
  }
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const total = safeNumber(payload.total) ?? 0;
  const offset = safeNumber(payload.offset);
  const limit = safeNumber(payload.limit);
  let nextCursor: number | string | null | undefined = null;
  if (typeof offset === "number" && typeof limit === "number" && rows.length) {
    nextCursor = offset + limit;
  } else {
    const token = maybeString(payload.token);
    if (token) {
      nextCursor = token;
    }
  }
  const records: RetrieveRecord[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const doi = doiFromExternalIds(row.externalIds);
    const oaData = isRecord(row.openAccessPdf) ? row.openAccessPdf : undefined;
    const oaStatus = oaData?.status ?? row.isOpenAccess;
    const oaUrl = maybeString(oaData?.url ?? oaData?.pdfUrl);
    const oaLicense = maybeString(oaData?.license);
    records.push(
      normalizeRecord({
      title: safeString(row.title),
      authors: authorsFromSemantic(row.authors),
      year: safeYearValue(row.year),
      doi: doi || normalizeDoi(row.doi),
      url: maybeString(row.url),
      abstract: maybeString(row.abstract),
      source: "semantic_scholar",
      citationCount: safeNumber(row.citationCount),
      openAccess: buildOpenAccessRecord(oaStatus, oaUrl, oaLicense)
      })
    );
  }
  return { records, total, nextCursor };
};

const parseCrossrefResponse = (payload: unknown): ProviderSearchResult => {
  if (!isRecord(payload)) {
    return { records: [], total: 0 };
  }
  const message = isRecord(payload.message) ? payload.message : {};
  const items = Array.isArray(message.items) ? message.items : [];
  const total = safeNumber(message["total-results"]) ?? 0;
  let nextCursor: number | undefined;
  const offset = safeNumber(message.offset);
  const rows = safeNumber(message.rows);
  if (typeof offset === "number" && typeof rows === "number" && rows > 0 && items.length) {
    nextCursor = offset + rows;
  }
  const records: RetrieveRecord[] = [];
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const title = firstStringFromArray(item.title) ?? "";
    const issued = isRecord(item.issued) ? item.issued : {};
    const dateParts = Array.isArray(issued["date-parts"]) ? issued["date-parts"] : [];
    const firstPart = Array.isArray(dateParts[0]) ? dateParts[0] : [];
    const yearValue = firstPart.length ? firstPart[0] : undefined;
    records.push(
      normalizeRecord({
      title,
      authors: authorsFromCrossref(item.author),
      year: safeYearValue(yearValue),
      doi: normalizeDoi(item.DOI),
      url: maybeString(item.URL),
      abstract: maybeString(item.abstract),
      source: "crossref",
      citationCount: safeNumber(item["is-referenced-by-count"])
      })
    );
  }
  return { records, total, nextCursor };
};

const parseOpenAlexResponse = (payload: unknown): ProviderSearchResult => {
  if (!isRecord(payload)) {
    return { records: [], total: 0 };
  }
  const rows = Array.isArray(payload.results) ? payload.results : [];
  const meta = isRecord(payload.meta) ? payload.meta : {};
  const total = safeNumber(meta.count) ?? 0;
  const nextCursor = maybeString(meta.next_cursor);
  const records: RetrieveRecord[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const doi = normalizeDoi(row.doi);
    const url = doi ? `https://doi.org/${doi}` : maybeString(row.id);
    const openAccessPayload = isRecord(row.open_access) ? row.open_access : undefined;
    const bestLocation = isRecord(row.best_oa_location) ? row.best_oa_location : undefined;
    const oaUrl =
      maybeString(openAccessPayload?.oa_url) ??
      maybeString(bestLocation?.landing_page_url) ??
      maybeString(bestLocation?.url) ??
      maybeString(bestLocation?.pdf_url);
    records.push(
      normalizeRecord({
      title: safeString(row.display_name),
      authors: authorsFromOpenAlex(row.authorships),
      year: safeYearValue(row.publication_year),
      doi,
      url,
      abstract: openAlexAbstractFromInverted(row.abstract_inverted_index),
      source: "openalex",
      citationCount: safeNumber(row.cited_by_count),
      openAccess: buildOpenAccessRecord(row.is_oa, oaUrl, safeString(openAccessPayload?.license))
      })
    );
  }
  return { records, total, nextCursor };
};

const parseElsevierResponse = (payload: unknown): ProviderSearchResult => {
  const root = isRecord(payload) ? payload : {};
  const sr = isRecord(root["search-results"]) ? root["search-results"] : {};
  const rawEntries = sr.entry;
  const entriesList: Record<string, unknown>[] = (() => {
    if (Array.isArray(rawEntries)) {
      return rawEntries.filter(isRecord);
    }
    if (isRecord(rawEntries)) {
      return [rawEntries];
    }
    return [];
  })();
  const records = entriesList.map((entry) => {
    const coverDate = safeString(entry["prism:coverDate"]);
    const year = safeYearValue(coverDate ? Number(coverDate.slice(0, 4)) : undefined);
    const record: RetrieveRecordInput = {
      title: safeString(entry["dc:title"]),
      authors: authorsFromDelimited(entry["dc:creator"]),
      year,
      doi: normalizeDoi(entry["prism:doi"]),
      url: pickElsevierUrl(entry.link) ?? maybeString(entry["prism:url"]),
      abstract: safeString(entry["dc:description"]),
      source: "elsevier"
    };
    return normalizeRecord(record);
  });
  const total = safeNumber(sr["opensearch:totalResults"]) ?? 0;
  return { records, total };
};

const parseWosResponse = (payload: unknown): ProviderSearchResult => {
  const root = isRecord(payload) ? payload : {};
  const rawHits = root.hits;
  const hitList: Record<string, unknown>[] = (() => {
    if (Array.isArray(rawHits)) {
      return rawHits.filter(isRecord);
    }
    if (isRecord(rawHits)) {
      return [rawHits];
    }
    return [];
  })();
  const records = hitList.map((hit) => {
    const metadata = isRecord(hit.names) ? hit.names : {};
    const authors = authorsFromWos(metadata.authors);
    const identifiers = isRecord(hit.identifiers) ? hit.identifiers : {};
    const record: RetrieveRecordInput = {
      title: safeString(hit.title),
      authors,
      year: safeYearValue(hit.year),
      doi: normalizeDoi(identifiers.doi ?? identifiers.DOI),
      url: getWosUrl(hit.links),
      abstract: safeString(hit.abstract),
      source: "wos"
    };
    return normalizeRecord(record);
  });
  const meta = isRecord(root.metadata) ? root.metadata : {};
  const total = safeNumber(meta.total) ?? 0;
  const page = safeNumber(meta.page) ?? 1;
  const limit = safeNumber(meta.limit) ?? 0;
  const nextCursor = limit && total && page * limit < total ? page + 1 : undefined;
  return { records, total, nextCursor };
};

const parseUnpaywallResponse = (payload: unknown): ProviderSearchResult => {
  if (!isRecord(payload)) {
    return { records: [], total: 0 };
  }
  const doi = normalizeDoi(payload.doi);
  if (!doi) {
    return { records: [], total: 0 };
  }
  const bestLocation = isRecord(payload.best_oa_location) ? payload.best_oa_location : undefined;
  const url =
    maybeString(bestLocation?.url_for_pdf) ??
    maybeString(bestLocation?.url) ??
    `https://doi.org/${doi}`;
  const records: RetrieveRecord[] = [
    normalizeRecord({
      title: safeString(payload.title) || doi,
      authors: [],
      year: safeYearValue(payload.year ?? payload.publication_year),
      doi,
      url,
      abstract: maybeString(payload.abstract),
      source: "unpaywall",
      openAccess: buildOpenAccessRecord(payload.oa_status ?? payload.is_oa, url, safeString(payload.license))
    })
  ];
  return { records, total: 1 };
};

const buildSemanticRequest = (query: RetrieveQuery): ProviderSearchRequest | undefined => {
  const text = safeString(query.query);
  if (!text) {
    return undefined;
  }
  const params: Record<string, unknown> = {
    query: text,
    limit: getLimit(query, 50, 100),
    offset: getOffset(query),
    fields: SEMANTIC_FIELDS.join(","),
    year: buildYearRange(query.year_from, query.year_to)
  };
  if (query.sort === "year") {
    params.sort = "year";
    params.order = "desc";
  }
  const headers: ProviderHeaders = {
    Accept: "application/json",
    "User-Agent": USER_AGENT
  };
  const semanticKey = getSemanticKey();
  if (semanticKey) {
    headers["x-api-key"] = semanticKey;
  }
  return {
    providerId: "semantic_scholar",
    url: buildUrlWithQuery(SEMANTIC_SEARCH_URL, params),
    headers
  };
};

const buildCrossrefRequest = (query: RetrieveQuery): ProviderSearchRequest | undefined => {
  const text = safeString(query.query);
  if (!text) {
    return undefined;
  }
  const params: Record<string, unknown> = {
    "query.bibliographic": text,
    rows: getLimit(query, 50, 100),
    offset: getOffset(query)
  };
  if (query.sort === "year") {
    params.sort = "published";
  }
  if (query.sort) {
    params.order = "desc";
  }
  const filters = [
    query.year_from ? `from-pub-date:${Math.floor(query.year_from)}-01-01` : "",
    query.year_to ? `until-pub-date:${Math.floor(query.year_to)}-12-31` : ""
  ].filter(Boolean);
  if (filters.length) {
    params.filter = filters.join(",");
  }
  return {
    providerId: "crossref",
    url: buildUrlWithQuery(CROSSREF_SEARCH_URL, params),
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT
    }
  };
};

const buildOpenAlexRequest = (query: RetrieveQuery): ProviderSearchRequest | undefined => {
  const text = safeString(query.query);
  if (!text) {
    return undefined;
  }
  const limit = getLimit(query, 50, 200);
  const params: Record<string, unknown> = {
    search: text,
    "per-page": Math.min(limit, 200),
    cursor: typeof query.cursor === "string" && query.cursor ? query.cursor : "*",
    filter: buildOpenAlexFilter(query.year_from, query.year_to)
  };
  return {
    providerId: "openalex",
    url: buildUrlWithQuery(OPENALEX_SEARCH_URL, params),
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT
    }
  };
};

const buildElsevierRequest = (query: RetrieveQuery): ProviderSearchRequest | undefined => {
  const text = safeString(query.query);
  if (!text) {
    return undefined;
  }
  const params: Record<string, unknown> = {
    query: scopusQueryWithYear(text, query.year_from, query.year_to),
    count: getLimit(query, 50, 200),
    start: getOffset(query),
    view: "COMPLETE"
  };
  if (query.sort === "year") {
    params.sort = "-coverDate";
  }
  const headers: ProviderHeaders = {
    Accept: "application/json",
    "User-Agent": USER_AGENT
  };
  const elsevierKey = getElsevierKey();
  if (elsevierKey) {
    headers["X-ELS-APIKey"] = elsevierKey;
  }
  return {
    providerId: "elsevier",
    url: buildUrlWithQuery(ELSEVIER_SEARCH_URL, params),
    headers
  };
};

const buildWosRequest = (query: RetrieveQuery): ProviderSearchRequest | undefined => {
  const raw = safeString(query.query);
  if (!raw) {
    return undefined;
  }
  const page = typeof query.page === "number" && Number.isFinite(query.page) && query.page > 0 ? Math.floor(query.page) : 1;
  const params: Record<string, unknown> = {
    q: wosQueryWithYear(`TS=("${raw}")`, query.year_from, query.year_to),
    db: "WOS",
    limit: getLimit(query, 25, 100),
    page
  };
  const headers: ProviderHeaders = {
    Accept: "application/json",
    "User-Agent": USER_AGENT
  };
  const wosKey = getWosKey();
  if (wosKey) {
    headers["X-ApiKey"] = wosKey;
  }
  return {
    providerId: "wos",
    url: buildUrlWithQuery(WOS_SEARCH_URL, params),
    headers
  };
};

const buildUnpaywallRequest = (query: RetrieveQuery): ProviderSearchRequest | undefined => {
  const doi = normalizeDoi(query.query);
  if (!doi) {
    return undefined;
  }
  const unpaywallEmail = getUnpaywallEmail();
  const params = unpaywallEmail ? { email: unpaywallEmail } : undefined;
  return {
    providerId: "unpaywall",
    url: buildUrlWithQuery(`${UNPAYWALL_BASE_URL}/${doi}`, params),
    headers: {
      "User-Agent": USER_AGENT
    }
  };
};

export interface ProviderSearchWithId {
  providerId: RetrieveProviderId;
  result: ProviderSearchResult;
}

export const mergeCosResults = (items: ProviderSearchWithId[]): ProviderSearchResult => {
  const seen = new Set<string>();
  const merged: RetrieveRecord[] = [];
  let fallbackCounter = 0;
  for (const providerId of COS_MERGE_ORDER) {
    const entry = items.find((item) => item.providerId === providerId);
    if (!entry) {
      continue;
    }
    for (const record of entry.result.records) {
      fallbackCounter += 1;
      const key = dedupeKey(record, fallbackCounter);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(record);
    }
  }
  return { records: merged, total: merged.length };
};

const providerRegistry: Record<RetrieveProviderId, ProviderSpec> = {
  semantic_scholar: {
    id: "semantic_scholar",
    label: "Semantic Scholar",
    rateMs: 1000,
    buildRequest: buildSemanticRequest,
    parseResponse: parseSemanticResponse
  },
  crossref: {
    id: "crossref",
    label: "Crossref",
    rateMs: 250,
    buildRequest: buildCrossrefRequest,
    parseResponse: parseCrossrefResponse
  },
  openalex: {
    id: "openalex",
    label: "OpenAlex",
    rateMs: 250,
    buildRequest: buildOpenAlexRequest,
    parseResponse: parseOpenAlexResponse
  },
  elsevier: {
    id: "elsevier",
    label: "Elsevier",
    rateMs: 400,
    buildRequest: buildElsevierRequest,
    parseResponse: parseElsevierResponse
  },
  wos: {
    id: "wos",
    label: "Web of Science",
    rateMs: 650,
    buildRequest: buildWosRequest,
    parseResponse: parseWosResponse
  },
  unpaywall: {
    id: "unpaywall",
    label: "Unpaywall",
    rateMs: 400,
    buildRequest: buildUnpaywallRequest,
    parseResponse: parseUnpaywallResponse
  },
  cos: {
    id: "cos",
    label: "COS (Merged)",
    rateMs: 250,
    mergeSources: COS_MERGE_ORDER
  }
};

export const getProviderSpec = (providerId: RetrieveProviderId): ProviderSpec | undefined =>
  providerRegistry[providerId];

export const allRetrieveProviders = Object.values(providerRegistry);
