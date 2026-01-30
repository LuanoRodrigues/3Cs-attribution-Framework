import type { FootnoteRenderEntry } from "./model.ts";

export type PageFootnoteState = {
  pageIndex: number;
  pageElement: HTMLElement;
  contentElement: HTMLElement | null;
  footnoteContainer: HTMLElement;
  continuationContainer: HTMLElement;
};

const renderEntries = (container: HTMLElement, entries: FootnoteRenderEntry[]) => {
  container.innerHTML = "";
  if (entries.length === 0) {
    container.classList.remove("leditor-page-footnotes--active");
    container.setAttribute("aria-hidden", "true");
    return;
  }
  container.classList.add("leditor-page-footnotes--active");
  container.setAttribute("aria-hidden", "false");
  const list = document.createElement("div");
  list.className = "leditor-footnote-list";
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "leditor-footnote-entry";
    if (entry.source === "citation") {
      row.classList.add("leditor-footnote-entry--citation");
    }
    row.dataset.footnoteId = entry.footnoteId;
    const number = document.createElement("span");
    number.className = "leditor-footnote-entry-number";
    number.textContent = entry.number;
    const text = document.createElement("span");
    text.className = "leditor-footnote-entry-text";
    text.dataset.footnoteId = entry.footnoteId;
    text.dataset.placeholder = "Type footnote…";
    text.textContent = (entry.text || "").trim();
    text.contentEditable = entry.source === "citation" ? "false" : "true";
    text.tabIndex = entry.source === "citation" ? -1 : 0;
    text.setAttribute("role", "textbox");
    text.setAttribute("spellcheck", "false");
    row.appendChild(number);
    row.appendChild(text);
    list.appendChild(row);
  });
  container.appendChild(list);
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
