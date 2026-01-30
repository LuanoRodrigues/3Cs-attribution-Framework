import type { DataHubTable } from "../../shared/types/dataHub";
import type { RetrieveDataHubState } from "../../session/sessionTypes";

export const SCREEN_CODES_COL = "screen_codes";
export const SCREEN_COMMENT_COL = "screen_comment";

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
  const win = trimmed.match(/^([A-Za-z]):[\\/](.*)$/);
  if (win) {
    const drive = win[1].toLowerCase();
    const rest = win[2].replace(/\\/g, "/");
    return `file:///mnt/${drive}/${rest}`;
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

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
