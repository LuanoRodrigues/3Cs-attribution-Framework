import type { DataHubTable } from "../../shared/types/dataHub";
import type { RetrieveDataHubState } from "../../session/sessionTypes";

export const SCREEN_CODES_COL = "screen_codes";
export const SCREEN_COMMENT_COL = "screen_comment";
export const SCREEN_DECISION_COL = "screen_decision";
export const SCREEN_BLIND_COL = "screen_blind";
export const SCREEN_LLM_DECISION_COL = "llm_screen_decision";
export const SCREEN_LLM_JUSTIFICATION_COL = "llm_screen_justification";

export const SCREEN_ACTIVE_EVENT = "screen:active-changed";

export type ScreenActiveEventDetail = { index: number; source?: "screen" | "screen-pdfs" };

export type PdfViewerPayload = {
  item_key: string;
  pdf_path: string;
  url: string;
  author_summary: string;
  first_author_last: string;
  year: string;
  title: string;
  source: string;
  page: number;
  section_title: string;
  section_text: string;
  rq_question: string;
  overarching_theme: string;
  gold_theme: string;
  route: string;
  theme: string;
  potential_theme: string;
  evidence_type: string;
  evidence_type_norm: string;
  direct_quote: string;
  direct_quote_clean: string;
  paraphrase: string;
  researcher_comment: string;
};

export function normalizePdfPath(input: string): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("file://")) return trimmed;
  const win = trimmed.match(/^([A-Za-z]):[\\/](.*)$/);
  if (win) {
    const drive = win[1];
    const rest = win[2].replace(/\\/g, "/");
    const isWindowsAgent =
      typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent || "");
    if (isWindowsAgent) {
      const path = rest.startsWith("/") ? rest : `/${rest}`;
      return `file:///${drive}:${path}`;
    }
    // WSL/Linux fallback: map Windows-style paths onto /mnt/<drive>/...
    return `file:///mnt/${drive.toLowerCase()}/${rest}`;
  }
  if (trimmed.startsWith("\\\\")) {
    // UNC paths (\\server\share) → file://server/share
    return `file://${trimmed.replace(/\\/g, "/")}`;
  }
  if (trimmed.startsWith("/")) {
    return trimmed.startsWith("file://") ? trimmed : `file://${trimmed}`;
  }
  return trimmed;
}

export function tableRowToRecord(columns: string[], row: unknown[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  columns.forEach((name, idx) => {
    record[name] = row[idx];
  });
  return record;
}

export function getStringCell(columns: string[], row: unknown[], colName: string): string {
  const idx = columns.indexOf(colName);
  if (idx < 0) return "";
  const value = row[idx];
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function findColumnIndexCaseInsensitive(columns: string[], name: string): number {
  const needle = name.trim().toLowerCase();
  if (!needle) return -1;
  for (let i = 0; i < columns.length; i++) {
    if (String(columns[i] ?? "").trim().toLowerCase() === needle) return i;
  }
  return -1;
}

function findColumnIndexContains(columns: string[], fragment: string): number {
  const needle = fragment.trim().toLowerCase();
  if (!needle) return -1;
  for (let i = 0; i < columns.length; i++) {
    const col = String(columns[i] ?? "").toLowerCase();
    if (col.includes(needle)) return i;
  }
  return -1;
}

export function pickTextCell(columns: string[], row: unknown[], candidates: string[]): string {
  for (const candidate of candidates) {
    const idx = findColumnIndexCaseInsensitive(columns, candidate);
    if (idx >= 0) {
      const value = row[idx];
      const text = value === null || value === undefined ? "" : String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

export function pickTextCellByContains(columns: string[], row: unknown[], fragments: string[]): string {
  for (const fragment of fragments) {
    const idx = findColumnIndexContains(columns, fragment);
    if (idx >= 0) {
      const value = row[idx];
      const text = value === null || value === undefined ? "" : String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

export function pickAbstractText(columns: string[], row: unknown[]): string {
  // Prefer canonical names, then any column containing "abstract", then common fallbacks.
  const direct = pickTextCell(columns, row, ["abstract", "Abstract", "ABSTRACT"]);
  if (direct) return direct;
  const byContains = pickTextCellByContains(columns, row, ["abstract"]);
  if (byContains) return byContains;
  const fallback = pickTextCell(columns, row, ["section_text", "SectionText", "summary", "description"]);
  if (fallback) return fallback;
  return "";
}

export function setStringCell(columns: string[], row: unknown[], colName: string, value: string): void {
  const idx = columns.indexOf(colName);
  if (idx < 0) return;
  row[idx] = value;
}

export function ensureScreenColumns(state?: RetrieveDataHubState): { state?: RetrieveDataHubState; changed: boolean } {
  if (!state?.table) return { state, changed: false };
  const table: DataHubTable = state.table;
  const nextColumns = table.columns.slice();
  const nextRows = table.rows.map((r) => r.slice());

  let changed = false;
  const ensureColumn = (name: string) => {
    if (nextColumns.includes(name)) return;
    nextColumns.push(name);
    nextRows.forEach((r) => r.push(""));
    changed = true;
  };

  ensureColumn(SCREEN_CODES_COL);
  ensureColumn(SCREEN_COMMENT_COL);
   // Decision + blind + optional LLM assist columns
  ensureColumn(SCREEN_DECISION_COL);
  ensureColumn(SCREEN_BLIND_COL);
  ensureColumn(SCREEN_LLM_DECISION_COL);
  ensureColumn(SCREEN_LLM_JUSTIFICATION_COL);

  if (!changed) return { state, changed: false };
  return {
    state: {
      ...state,
      table: { columns: nextColumns, rows: nextRows }
    },
    changed: true
  };
}

export function buildEmptyPdfPayload(pdfPath: string): PdfViewerPayload {
  const normalized = normalizePdfPath(pdfPath);
  return {
    item_key: "",
    pdf_path: normalized,
    url: "",
    author_summary: "",
    first_author_last: "",
    year: "",
    title: "",
    source: "",
    page: 1,
    section_title: "",
    section_text: "",
    rq_question: "",
    overarching_theme: "",
    gold_theme: "",
    route: "",
    theme: "",
    potential_theme: "",
    evidence_type: "",
    evidence_type_norm: "",
    direct_quote: "",
    direct_quote_clean: "",
    paraphrase: "",
    researcher_comment: ""
  };
}

function pickFirstAuthor(authors: string): string {
  if (!authors) return "";
  const parts = authors.split(/[,;]+/);
  return parts[0]?.trim() ?? "";
}

function parsePageNumber(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return 1;
}

export function buildPdfPayloadFromRow(columns: string[], row: unknown[], titleHint: string, sourceHint: string): PdfViewerPayload {
  const pdfPathRaw = getStringCell(columns, row, "pdf_path");
  const authors =
    getStringCell(columns, row, "authors") ||
    getStringCell(columns, row, "author") ||
    getStringCell(columns, row, "first_author_last");
  const firstAuthor =
    getStringCell(columns, row, "first_author_last") ||
    pickFirstAuthor(authors);
  const sectionText =
    getStringCell(columns, row, "section_text") ||
    getStringCell(columns, row, "abstract") ||
    getStringCell(columns, row, "description");

  return {
    item_key: getStringCell(columns, row, "item_key") || getStringCell(columns, row, "key"),
    pdf_path: normalizePdfPath(pdfPathRaw),
    url: getStringCell(columns, row, "url") || getStringCell(columns, row, "link"),
    author_summary: authors,
    first_author_last: firstAuthor,
    year: getStringCell(columns, row, "year"),
    title: titleHint,
    source: sourceHint,
    page: parsePageNumber(
      getStringCell(columns, row, "page") ||
        getStringCell(columns, row, "page_number") ||
        getStringCell(columns, row, "pdf_page")
    ),
    section_title: getStringCell(columns, row, "section_title"),
    section_text: sectionText,
    rq_question: getStringCell(columns, row, "rq_question"),
    overarching_theme: getStringCell(columns, row, "overarching_theme"),
    gold_theme: getStringCell(columns, row, "gold_theme"),
    route: getStringCell(columns, row, "route"),
    theme: getStringCell(columns, row, "theme"),
    potential_theme: getStringCell(columns, row, "potential_theme"),
    evidence_type: getStringCell(columns, row, "evidence_type"),
    evidence_type_norm: getStringCell(columns, row, "evidence_type_norm"),
    direct_quote: getStringCell(columns, row, "direct_quote"),
    direct_quote_clean: getStringCell(columns, row, "direct_quote_clean"),
    paraphrase: getStringCell(columns, row, "paraphrase"),
    researcher_comment: getStringCell(columns, row, "researcher_comment")
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
