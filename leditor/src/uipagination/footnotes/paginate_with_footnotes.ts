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
  fragment: "primary" | "continuation";
  text: string;
  number: string;
};

const CONTINUED_FROM_LABEL = "Continued from previous page";
const CONTINUED_TO_LABEL = "Continued on next page";

const ensureList = (container: HTMLElement, className = "leditor-footnote-list"): HTMLElement => {
  const existing = container.querySelector<HTMLElement>(`.${className}`);
  if (existing) return existing;
  const list = document.createElement("div");
  list.className = className;
  container.appendChild(list);
  return list;
};

const syncRow = (row: HTMLElement, item: RenderItem) => {
  const entry = item.entry;
  row.dataset.footnoteId = entry.footnoteId;
  row.dataset.footnoteFragment = item.fragment;
  row.classList.toggle("leditor-footnote-entry--citation", entry.source === "citation");
  row.classList.toggle(
    "leditor-footnote-entry--continuation",
    item.continuation || item.fragment === "continuation"
  );
  const number = row.querySelector<HTMLElement>(".leditor-footnote-entry-number");
  if (number) number.textContent = item.number ?? "";
  const text = row.querySelector<HTMLElement>(".leditor-footnote-entry-text");
  if (!text) return;
  text.dataset.footnoteId = entry.footnoteId;
  text.dataset.footnoteFragment = item.fragment;
  text.dataset.placeholder = "Type footnote…";
  const isReadOnly = entry.source === "citation" || item.fragment === "continuation";
  text.contentEditable = isReadOnly ? "false" : "true";
  text.tabIndex = isReadOnly ? -1 : 0;
  text.setAttribute("spellcheck", isReadOnly ? "false" : "true");

  // Do not clobber the user's caret: avoid rewriting text while this entry is actively focused.
  const active = document.activeElement as HTMLElement | null;
  const isActive =
    active?.classList?.contains("leditor-footnote-entry-text") &&
    (active.getAttribute("data-footnote-id") || "").trim() === entry.footnoteId &&
    active.getAttribute("contenteditable") === "true";
  if (isActive) return;
  const next = item.text ?? "";
  const current = text.textContent ?? "";
  if (current !== next) {
    text.textContent = next;
  }
};

const buildRow = (item: RenderItem): HTMLElement => {
  const entry = item.entry;
  const row = document.createElement("div");
  row.className = "leditor-footnote-entry";
  if (item.continuation || item.fragment === "continuation") {
    row.classList.add("leditor-footnote-entry--continuation");
  }
  if (entry.source === "citation") {
    row.classList.add("leditor-footnote-entry--citation");
  }
  row.dataset.footnoteId = entry.footnoteId;
  row.dataset.footnoteFragment = item.fragment;
  const number = document.createElement("span");
  number.className = "leditor-footnote-entry-number";
  const text = document.createElement("span");
  text.className = "leditor-footnote-entry-text";
  text.dataset.footnoteId = entry.footnoteId;
  text.dataset.footnoteFragment = item.fragment;
  text.dataset.placeholder = "Type footnote…";
  text.setAttribute("role", "textbox");
  text.setAttribute("spellcheck", entry.source === "citation" ? "false" : "true");
  row.appendChild(number);
  row.appendChild(text);
  syncRow(row, item);
  return row;
};

const renderEntries = (
  container: HTMLElement,
  items: RenderItem[],
  prefixLabel?: string,
  suffixLabel?: string
) => {
  if (items.length === 0) {
    // Keep the footnote area visible even when no entries are present so users always see the
    // reserved region and placeholder.
    container.classList.add("leditor-page-footnotes--active");
    container.setAttribute("aria-hidden", "false");
    if (!container.dataset.leditorPlaceholder) {
      container.dataset.leditorPlaceholder = "Footnotes";
    }
    container.style.minHeight = container.style.minHeight || "var(--footnote-area-height)";
    const list = container.querySelector<HTMLElement>(".leditor-footnote-list") ?? ensureList(container);
    list.replaceChildren();
    return;
  }
  container.classList.add("leditor-page-footnotes--active");
  container.setAttribute("aria-hidden", "false");

  const list = ensureList(container);
  const prefixText = (prefixLabel || "").trim();
  const suffixText = (suffixLabel || "").trim();
  const existingPrefix = list.querySelector<HTMLElement>(
    ".leditor-footnote-continuation-label[data-position=\"prefix\"]"
  );
  const existingSuffix = list.querySelector<HTMLElement>(
    ".leditor-footnote-continuation-label[data-position=\"suffix\"]"
  );
  if (prefixText) {
    const label = existingPrefix ?? document.createElement("div");
    label.className = "leditor-footnote-continuation-label";
    label.dataset.position = "prefix";
    label.textContent = prefixText;
    if (!existingPrefix) {
      list.insertBefore(label, list.firstChild);
    }
  } else if (existingPrefix) {
    existingPrefix.remove();
  }
  if (existingSuffix) {
    existingSuffix.remove();
  }
  const nextIds = new Set(items.map((item) => `${item.entry.footnoteId}:${item.fragment}`));
  // Remove rows that no longer exist.
  Array.from(list.querySelectorAll<HTMLElement>(".leditor-footnote-entry")).forEach((row) => {
    const id = (row.dataset.footnoteId || "").trim();
    const fragment = (row.dataset.footnoteFragment || "").trim() || "primary";
    const key = `${id}:${fragment}`;
    if (!id || !nextIds.has(key)) row.remove();
  });
  // Insert/update in order.
  const labelNode = list.querySelector<HTMLElement>(
    ".leditor-footnote-continuation-label[data-position=\"prefix\"]"
  );
  let cursor: ChildNode | null = labelNode ? labelNode.nextSibling : list.firstChild;
  items.forEach((item) => {
    const entry = item.entry;
    const selector = `.leditor-footnote-entry[data-footnote-id="${entry.footnoteId}"][data-footnote-fragment="${item.fragment}"]`;
    const existing = list.querySelector<HTMLElement>(selector);
    const row = existing ?? buildRow(item);
    syncRow(row, item);
    if (row !== cursor) {
      list.insertBefore(row, cursor);
    } else {
      cursor = cursor?.nextSibling ?? null;
    }
    cursor = row.nextSibling;
  });
  if (suffixText) {
    const label = document.createElement("div");
    label.className = "leditor-footnote-continuation-label";
    label.dataset.position = "suffix";
    label.textContent = suffixText;
    list.appendChild(label);
  }
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
  const maxRatio = Math.min(0.9, Math.max(0, getCssNumber(root, "--footnote-max-height-ratio", 0.35)));
  const lineHeight = (() => {
    if (!state.contentElement) return 18;
    const raw = getComputedStyle(state.contentElement).lineHeight.trim();
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 18;
  })();
  const minBodyPx = Math.max(12, Math.min(36, Math.round(lineHeight)));
  const available =
    pageHeight - marginTop - marginBottom - footerDistance - footerHeight - footnoteGap - minBodyPx;
  const hardCap = Math.max(0, Math.round(pageHeight * maxRatio));
  const max = Math.max(0, Math.min(hardCap, available));
  return max;
};

const measureFittedItems = (
  container: HTMLElement,
  items: RenderItem[],
  maxHeight: number,
  opts?: { prefixLabel?: string; suffixLabel?: string }
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
  measureList.style.width = `${Math.max(0, container.clientWidth || 0)}px`;
  container.appendChild(measureList);
  const prefixLabel = (opts?.prefixLabel || "").trim();
  const suffixLabel = (opts?.suffixLabel || "").trim();
  if (prefixLabel) {
    const label = document.createElement("div");
    label.className = "leditor-footnote-continuation-label";
    label.dataset.position = "prefix";
    label.textContent = prefixLabel;
    measureList.appendChild(label);
  }
  let suffixReserve = 0;
  if (suffixLabel) {
    const label = document.createElement("div");
    label.className = "leditor-footnote-continuation-label";
    label.dataset.position = "suffix";
    label.textContent = suffixLabel;
    measureList.appendChild(label);
    const labelHeight = label.getBoundingClientRect().height || label.offsetHeight || 0;
    measureList.removeChild(label);
    const gapRaw = getComputedStyle(measureList).rowGap || getComputedStyle(measureList).gap || "0";
    const gap = Number.parseFloat(gapRaw) || 0;
    suffixReserve = Math.max(0, labelHeight + (items.length > 0 ? gap : 0));
  }
  const fitted: RenderItem[] = [];
  let overflow: RenderItem[] = [];
  let lastHeight = 0;
  const splitIntoSegments = (value: string): string[] => {
    if (!value) return [];
    const segments = value.match(/\s*\S+/g);
    return segments ?? [];
  };
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const row = buildRow(item);
    measureList.appendChild(row);
    const height = measureList.scrollHeight;
    if (height <= Math.max(0, maxHeight - suffixReserve)) {
      fitted.push(item);
      lastHeight = height;
      continue;
    }
    // overflow
    measureList.removeChild(row);
    const available = Math.max(0, Math.max(0, maxHeight - suffixReserve) - lastHeight);
    const text = item.text ?? "";
    if (available <= 0 || !text) {
      overflow = items.slice(i);
      break;
    }
    const segments = splitIntoSegments(text);
    if (segments.length === 0) {
      overflow = items.slice(i);
      break;
    }
    let low = 1;
    let high = segments.length;
    let best = 0;
    const testRow = buildRow(item);
    const textEl = testRow.querySelector<HTMLElement>(".leditor-footnote-entry-text");
    if (!textEl) {
      overflow = items.slice(i);
      break;
    }
    measureList.appendChild(testRow);
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      textEl.textContent = segments.slice(0, mid).join("");
      const h = measureList.scrollHeight;
      if (h <= Math.max(0, maxHeight - suffixReserve)) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (best <= 0) {
      best = 1;
    }
    const headText = segments.slice(0, best).join("");
    const tailText = segments.slice(best).join("");
    textEl.textContent = headText;
    const headHeight = measureList.scrollHeight;
    if (headHeight > Math.max(0, maxHeight - suffixReserve) && fitted.length === 0) {
      // fallback: allow this fragment even if it slightly exceeds; prevents deadlock
      fitted.push({ ...item, text: headText });
    } else {
      fitted.push({
        ...item,
        text: headText
      });
    }
    measureList.removeChild(testRow);
    if (tailText) {
      const tailItem: RenderItem = {
        ...item,
        fragment: "continuation",
        continuation: true,
        number: "",
        text: tailText
      };
      overflow = [tailItem, ...items.slice(i + 1)];
    } else {
      overflow = items.slice(i + 1);
    }
    break;
  }
  const height = measureList.scrollHeight;
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
      ...own.map<RenderItem>((entry) => ({
        entry,
        continuation: false,
        fragment: "primary",
        text: entry.text || "",
        number: entry.number || ""
      }))
    ];
    const hasCarry = carry.some((item) => item.continuation || item.fragment === "continuation");
    const chrome =
      getCssNumber(state.footnoteContainer, "padding-top", 0) +
      getCssNumber(state.footnoteContainer, "border-top-width", 0) +
      getCssNumber(state.footnoteContainer, "border-bottom-width", 0);
    const maxHeight = getMaxFootnoteHeight(state);
    const maxListHeight = Math.max(0, Math.floor(maxHeight - chrome));
    const lineHeightRaw = getComputedStyle(state.footnoteContainer).lineHeight;
    const lineHeight = Number.parseFloat(lineHeightRaw || "0");
    const safeLine = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 18;
    const safeMaxListHeight = maxListHeight > 0 ? maxListHeight : Math.max(16, Math.round(safeLine * 2));
    let measurement = measureFittedItems(state.footnoteContainer, items, safeMaxListHeight, {
      prefixLabel: hasCarry ? CONTINUED_FROM_LABEL : ""
    });
    if (measurement.overflow.length > 0) {
      measurement = measureFittedItems(state.footnoteContainer, items, safeMaxListHeight, {
        prefixLabel: hasCarry ? CONTINUED_FROM_LABEL : "",
        suffixLabel: CONTINUED_TO_LABEL
      });
    }
    const { fitted, overflow } = measurement;
    renderEntries(
      state.footnoteContainer,
      fitted,
      hasCarry ? CONTINUED_FROM_LABEL : "",
      overflow.length > 0 ? CONTINUED_TO_LABEL : ""
    );
    carry = overflow;
    state.continuationContainer.classList.remove("leditor-footnote-continuation--active");
    state.continuationContainer.setAttribute("aria-hidden", "true");
    state.continuationContainer.innerHTML = "";
  });
};
