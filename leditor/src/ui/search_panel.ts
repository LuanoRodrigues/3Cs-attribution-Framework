import type { EditorHandle } from "../api/leditor.js";
import {
  clearSearch,
  markSearchPanelOpened,
  setQuery
} from "../editor/search.js";

type SearchPanelController = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
};

const ensureSearchStyles = () => {
  if (document.getElementById("leditor-search-styles")) return;
  const style = document.createElement("style");
  style.id = "leditor-search-styles";
  style.textContent = `
.leditor-search-panel {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  background: #f7f3e8;
  border: 1px solid #cbbf9a;
  padding: 8px;
  display: none;
  font-family: "Georgia", "Times New Roman", serif;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}
.leditor-search-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.leditor-search-row:last-child {
  margin-bottom: 0;
}
.leditor-search-input {
  width: 180px;
  padding: 4px 6px;
  border: 1px solid #a89a74;
  background: #fffaf0;
  font-size: 13px;
}
.leditor-search-btn {
  padding: 4px 8px;
  border: 1px solid #8c7a53;
  background: #eadbb8;
  font-size: 12px;
  cursor: pointer;
}
.leditor-search-btn:hover {
  background: #dfcfac;
}
.leditor-search-match {
  background: #ffe9a8;
}
.leditor-search-match-active {
  background: #ffd46a;
  outline: 1px solid #b38b2a;
}
`;
  document.head.appendChild(style);
};

export const createSearchPanel = (editorHandle: EditorHandle): SearchPanelController => {
  ensureSearchStyles();

  const panel = document.createElement("div");
  panel.className = "leditor-search-panel";

  const searchRow = document.createElement("div");
  searchRow.className = "leditor-search-row";
  const searchInput = document.createElement("input");
  searchInput.className = "leditor-search-input";
  searchInput.type = "text";
  searchInput.placeholder = "Search";
  searchRow.appendChild(searchInput);

  const replaceRow = document.createElement("div");
  replaceRow.className = "leditor-search-row";
  const replaceInput = document.createElement("input");
  replaceInput.className = "leditor-search-input";
  replaceInput.type = "text";
  replaceInput.placeholder = "Replace";
  replaceRow.appendChild(replaceInput);

  const buttonRow = document.createElement("div");
  buttonRow.className = "leditor-search-row";

  let controller: SearchPanelController;

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "leditor-search-btn";
  prevBtn.textContent = "Previous";
  prevBtn.addEventListener("click", () => {
    editorHandle.execCommand("SearchPrev");
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "leditor-search-btn";
  nextBtn.textContent = "Next";
  nextBtn.addEventListener("click", () => {
    editorHandle.execCommand("SearchNext");
  });

  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.className = "leditor-search-btn";
  replaceBtn.textContent = "Replace";
  replaceBtn.addEventListener("click", () => {
    editorHandle.execCommand("ReplaceCurrent", { replacement: replaceInput.value });
  });

  const replaceAllBtn = document.createElement("button");
  replaceAllBtn.type = "button";
  replaceAllBtn.className = "leditor-search-btn";
  replaceAllBtn.textContent = "Replace All";
  replaceAllBtn.addEventListener("click", () => {
    editorHandle.execCommand("ReplaceAll", {
      query: searchInput.value,
      replacement: replaceInput.value
    });
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-search-btn";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => {
    controller.close();
  });

  buttonRow.append(prevBtn, nextBtn, replaceBtn, replaceAllBtn, closeBtn);

  panel.append(searchRow, replaceRow, buttonRow);
  document.body.appendChild(panel);

  const applyQuery = () => {
    setQuery(searchInput.value);
  };

  searchInput.addEventListener("input", applyQuery);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      editorHandle.execCommand("SearchNext");
      return;
    }
    if (event.key === "Escape") {
      controller.close();
    }
  });

  controller = {
    open() {
      panel.style.display = "block";
      markSearchPanelOpened();
      applyQuery();
      searchInput.focus();
    },
    close() {
      panel.style.display = "none";
      clearSearch();
    },
    toggle() {
      if (panel.style.display === "none" || panel.style.display === "") {
        controller.open();
        return;
      }
      controller.close();
    },
    isOpen() {
      return panel.style.display !== "none" && panel.style.display !== "";
    }
  };

  return controller;
};
