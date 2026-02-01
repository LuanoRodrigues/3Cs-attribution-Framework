import { getReferencesLibrarySync, upsertReferenceItem, type ReferenceItem } from "./library.ts";

let panel: HTMLElement | null = null;

const renderItems = (container: HTMLElement) => {
  const library = getReferencesLibrarySync();
  const items = Object.values(library.itemsByKey);
  container.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.textContent = "No sources registered.";
    container.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "source-item";
    row.textContent = `${item.itemKey} — ${item.title ?? item.author ?? "Untitled"}`;
    container.appendChild(row);
  });
};

const buildPanel = (): HTMLElement => {
  const root = document.createElement("div");
  root.className = "leditor-sources-panel";
  const header = document.createElement("header");
  header.textContent = "Citation Sources";
  const controls = document.createElement("div");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "Add";
  controls.appendChild(addBtn);
  header.appendChild(controls);
  const body = document.createElement("div");
  body.className = "sources-body";
  root.appendChild(header);
  root.appendChild(body);
  addBtn.addEventListener("click", () => {
    const itemKey = window.prompt("Item key (8 chars recommended)");
    if (!itemKey) return;
    const title = window.prompt("Title") ?? undefined;
    const author = window.prompt("Author") ?? undefined;
    const year = window.prompt("Year") ?? undefined;
    const entry: ReferenceItem = {
      itemKey: itemKey.trim(),
      title: title?.trim() || undefined,
      author: author?.trim() || undefined,
      year: year?.trim() || undefined
    };
    upsertReferenceItem(entry);
    renderItems(body);
  });
  renderItems(body);
  return root;
};

export const openSourcesPanel = (): void => {
  if (!panel) {
    panel = buildPanel();
    document.body.appendChild(panel);
  }
  panel.classList.toggle("is-open");
};
