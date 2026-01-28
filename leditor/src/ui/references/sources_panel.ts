import { getReferencesLibrarySync, upsertReferenceItem, type ReferenceItem } from "./library.ts";

let panel: HTMLElement | null = null;

const ensurePanelStyles = () => {
  if (document.getElementById("leditor-sources-panel-styles")) return;
  const style = document.createElement("style");
  style.id = "leditor-sources-panel-styles";
  style.textContent = `
.leditor-sources-panel {
  position: fixed;
  top: 72px;
  right: 16px;
  width: 320px;
  max-height: 70vh;
  overflow: auto;
  background: #fffaf0;
  border: 1px solid #cbbf9a;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
  z-index: 1200;
  font-family: "Georgia", "Times New Roman", serif;
  display: none;
}
.leditor-sources-panel header {
  padding: 10px 12px;
  border-bottom: 1px solid #d8cba8;
  background: #f2e8d3;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.leditor-sources-panel .sources-body {
  padding: 10px 12px;
}
.leditor-sources-panel button {
  border: 1px solid #8c7a53;
  background: #eadbb8;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.leditor-sources-panel .source-item {
  margin-bottom: 8px;
  font-size: 12px;
}
`;
  document.head.appendChild(style);
};

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
  ensurePanelStyles();
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
  panel.style.display = panel.style.display === "block" ? "none" : "block";
};
