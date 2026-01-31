import type { FootnoteRenderEntry } from "./model.ts";

export type PageFootnoteState = {
  pageIndex: number;
  pageElement: HTMLElement;
  contentElement: HTMLElement | null;
  footnoteContainer: HTMLElement;
  continuationContainer: HTMLElement;
};

const ensureList = (container: HTMLElement): HTMLElement => {
  const existing = container.querySelector<HTMLElement>(".leditor-footnote-list");
  if (existing) return existing;
  const list = document.createElement("div");
  list.className = "leditor-footnote-list";
  container.appendChild(list);
  return list;
};

const syncRow = (row: HTMLElement, entry: FootnoteRenderEntry) => {
  row.dataset.footnoteId = entry.footnoteId;
  row.classList.toggle("leditor-footnote-entry--citation", entry.source === "citation");
  const number = row.querySelector<HTMLElement>(".leditor-footnote-entry-number");
  if (number) number.textContent = entry.number;
  const text = row.querySelector<HTMLElement>(".leditor-footnote-entry-text");
  if (!text) return;
  text.dataset.footnoteId = entry.footnoteId;
  text.dataset.placeholder = "Type footnote…";
  text.contentEditable = entry.source === "citation" ? "false" : "true";
  text.tabIndex = entry.source === "citation" ? -1 : 0;

  // Do not clobber the user's caret: avoid rewriting text while this entry is actively focused.
  const active = document.activeElement as HTMLElement | null;
  const isActive =
    active?.classList?.contains("leditor-footnote-entry-text") &&
    (active.getAttribute("data-footnote-id") || "").trim() === entry.footnoteId;
  if (isActive) return;
  const next = (entry.text || "").trim();
  const current = (text.textContent || "").trim();
  if (current !== next) {
    text.textContent = next;
  }
};

const buildRow = (entry: FootnoteRenderEntry): HTMLElement => {
  const row = document.createElement("div");
  row.className = "leditor-footnote-entry";
  if (entry.source === "citation") {
    row.classList.add("leditor-footnote-entry--citation");
  }
  row.dataset.footnoteId = entry.footnoteId;
  const number = document.createElement("span");
  number.className = "leditor-footnote-entry-number";
  const text = document.createElement("span");
  text.className = "leditor-footnote-entry-text";
  text.dataset.footnoteId = entry.footnoteId;
  text.dataset.placeholder = "Type footnote…";
  text.setAttribute("role", "textbox");
  text.setAttribute("spellcheck", "false");
  row.appendChild(number);
  row.appendChild(text);
  syncRow(row, entry);
  return row;
};

const renderEntries = (container: HTMLElement, entries: FootnoteRenderEntry[]) => {
  if (entries.length === 0) {
    container.classList.remove("leditor-page-footnotes--active");
    container.setAttribute("aria-hidden", "true");
    const list = container.querySelector<HTMLElement>(".leditor-footnote-list");
    if (list) list.replaceChildren();
    return;
  }
  container.classList.add("leditor-page-footnotes--active");
  container.setAttribute("aria-hidden", "false");

  const list = ensureList(container);
  const nextIds = new Set(entries.map((e) => e.footnoteId));
  // Remove rows that no longer exist.
  Array.from(list.querySelectorAll<HTMLElement>(".leditor-footnote-entry")).forEach((row) => {
    const id = (row.dataset.footnoteId || "").trim();
    if (!id || !nextIds.has(id)) row.remove();
  });
  // Insert/update in order.
  let cursor: ChildNode | null = list.firstChild;
  entries.forEach((entry) => {
    const existing = list.querySelector<HTMLElement>(`.leditor-footnote-entry[data-footnote-id="${entry.footnoteId}"]`);
    const row = existing ?? buildRow(entry);
    syncRow(row, entry);
    if (row !== cursor) {
      list.insertBefore(row, cursor);
    } else {
      cursor = cursor?.nextSibling ?? null;
    }
    cursor = row.nextSibling;
  });
};

export const paginateWithFootnotes = (params: {
  entries: FootnoteRenderEntry[];
  pageStates: PageFootnoteState[];
}) => {
  const grouped = new Map<number, FootnoteRenderEntry[]>();
  params.entries.forEach((entry) => {
    const list = grouped.get(entry.pageIndex) ?? [];
    list.push(entry);
    grouped.set(entry.pageIndex, list);
  });
  params.pageStates.forEach((state) => {
    const entries = grouped.get(state.pageIndex) ?? [];
    renderEntries(state.footnoteContainer, entries);
    state.continuationContainer.innerHTML = "";
  });
};
