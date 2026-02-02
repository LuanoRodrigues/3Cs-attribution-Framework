import type { FootnoteRenderEntry } from "./model.ts";

export type PageFootnoteState = {
  pageIndex: number;
  pageElement: HTMLElement;
  contentElement: HTMLElement | null;
  footnoteContainer: HTMLElement;
  continuationContainer: HTMLElement;
};

type RenderItem = {
  entry: FootnoteRenderEntry;
  continuation: boolean;
};

const ensureList = (container: HTMLElement, className = "leditor-footnote-list"): HTMLElement => {
  const existing = container.querySelector<HTMLElement>(`.${className}`);
  if (existing) return existing;
  const list = document.createElement("div");
  list.className = className;
  container.appendChild(list);
  return list;
};

const syncRow = (row: HTMLElement, entry: FootnoteRenderEntry, continuation = false) => {
  row.dataset.footnoteId = entry.footnoteId;
  row.classList.toggle("leditor-footnote-entry--citation", entry.source === "citation");
  row.classList.toggle("leditor-footnote-entry--continuation", continuation);
  const number = row.querySelector<HTMLElement>(".leditor-footnote-entry-number");
  if (number) number.textContent = entry.number;
  const text = row.querySelector<HTMLElement>(".leditor-footnote-entry-text");
  if (!text) return;
  text.dataset.footnoteId = entry.footnoteId;
  text.dataset.placeholder = "Type footnote…";
  const isReadOnly = entry.source === "citation";
  text.contentEditable = isReadOnly ? "false" : "true";
  text.tabIndex = isReadOnly ? -1 : 0;

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

const buildRow = (entry: FootnoteRenderEntry, continuation = false): HTMLElement => {
  const row = document.createElement("div");
  row.className = "leditor-footnote-entry";
  if (continuation) {
    row.classList.add("leditor-footnote-entry--continuation");
  }
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
  syncRow(row, entry, continuation);
  return row;
};

const renderEntries = (container: HTMLElement, items: RenderItem[]) => {
  if (items.length === 0) {
    container.classList.remove("leditor-page-footnotes--active");
    container.setAttribute("aria-hidden", "true");
    const list = container.querySelector<HTMLElement>(".leditor-footnote-list");
    if (list) list.replaceChildren();
    return;
  }
  container.classList.add("leditor-page-footnotes--active");
  container.setAttribute("aria-hidden", "false");

  const list = ensureList(container);
  const nextIds = new Set(items.map((item) => item.entry.footnoteId));
  // Remove rows that no longer exist.
  Array.from(list.querySelectorAll<HTMLElement>(".leditor-footnote-entry")).forEach((row) => {
    const id = (row.dataset.footnoteId || "").trim();
    if (!id || !nextIds.has(id)) row.remove();
  });
  // Insert/update in order.
  let cursor: ChildNode | null = list.firstChild;
  items.forEach((item) => {
    const entry = item.entry;
    const existing = list.querySelector<HTMLElement>(`.leditor-footnote-entry[data-footnote-id="${entry.footnoteId}"]`);
    const row = existing ?? buildRow(entry, item.continuation);
    syncRow(row, entry, item.continuation);
    if (row !== cursor) {
      list.insertBefore(row, cursor);
    } else {
      cursor = cursor?.nextSibling ?? null;
    }
    cursor = row.nextSibling;
  });
};

const getCssNumber = (element: HTMLElement, name: string, fallback = 0): number => {
  const raw = getComputedStyle(element).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getMaxFootnoteHeight = (state: PageFootnoteState): number => {
  const root = document.documentElement;
  const pageHeight =
    state.pageElement.getBoundingClientRect().height ||
    getCssNumber(root, "--page-height", 1122);
  const marginTop = getCssNumber(state.pageElement, "--local-page-margin-top", getCssNumber(root, "--page-margin-top", 0));
  const marginBottom = getCssNumber(
    state.pageElement,
    "--local-page-margin-bottom",
    getCssNumber(root, "--page-margin-bottom", 0)
  );
  const footerDistance = getCssNumber(root, "--doc-footer-distance", 0);
  const footerHeight = getCssNumber(root, "--footer-height", 0);
  const footnoteGap = getCssNumber(state.pageElement, "--page-footnote-gap", 0);
  const lineHeight = (() => {
    if (!state.contentElement) return 18;
    const raw = getComputedStyle(state.contentElement).lineHeight.trim();
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 18;
  })();
  const minBodyPx = Math.max(12, Math.min(36, Math.round(lineHeight)));
  const available =
    pageHeight - marginTop - marginBottom - footerDistance - footerHeight - footnoteGap - minBodyPx;
  const hardCap = Math.max(0, Math.round(pageHeight * 0.35));
  const max = Math.max(0, Math.min(hardCap, available));
  return max;
};

const measureFittedItems = (
  container: HTMLElement,
  items: RenderItem[],
  maxHeight: number
): { fitted: RenderItem[]; overflow: RenderItem[]; height: number } => {
  if (items.length === 0 || maxHeight <= 0) {
    return { fitted: [], overflow: items, height: 0 };
  }
  const measureList = document.createElement("div");
  measureList.className = "leditor-footnote-list";
  measureList.style.position = "absolute";
  measureList.style.visibility = "hidden";
  measureList.style.pointerEvents = "none";
  measureList.style.left = "-9999px";
  measureList.style.top = "0";
  container.appendChild(measureList);
  const fitted: RenderItem[] = [];
  let overflowStart = items.length;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const row = buildRow(item.entry, item.continuation);
    measureList.appendChild(row);
    const height = measureList.scrollHeight;
    if (height > maxHeight && fitted.length > 0) {
      measureList.removeChild(row);
      overflowStart = i;
      break;
    }
    fitted.push(item);
    if (height > maxHeight && fitted.length === 1) {
      overflowStart = i + 1;
      break;
    }
  }
  const height = measureList.scrollHeight;
  const overflow = overflowStart < items.length ? items.slice(overflowStart) : [];
  container.removeChild(measureList);
  return { fitted, overflow, height };
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
  const ordered = [...params.pageStates].sort((a, b) => a.pageIndex - b.pageIndex);
  let carry: RenderItem[] = [];
  ordered.forEach((state) => {
    const own = grouped.get(state.pageIndex) ?? [];
    const items: RenderItem[] = [
      ...carry,
      ...own.map((entry) => ({ entry, continuation: false }))
    ];
    const chrome =
      getCssNumber(state.footnoteContainer, "padding-top", 0) +
      getCssNumber(state.footnoteContainer, "border-top-width", 0) +
      getCssNumber(state.footnoteContainer, "border-bottom-width", 0);
    const maxHeight = getMaxFootnoteHeight(state);
    const maxListHeight = Math.max(0, Math.floor(maxHeight - chrome));
    const { fitted, overflow } = measureFittedItems(state.footnoteContainer, items, maxListHeight);
    renderEntries(state.footnoteContainer, fitted);
    carry = overflow.map((item) => ({ entry: item.entry, continuation: true }));
    state.continuationContainer.innerHTML = "";
    state.continuationContainer.classList.remove("leditor-footnote-continuation--active");
    state.continuationContainer.setAttribute("aria-hidden", "true");
  });
};
