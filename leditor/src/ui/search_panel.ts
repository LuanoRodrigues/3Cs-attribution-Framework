import type { EditorHandle } from "../api/leditor.ts";
import {
  clearSearch,
  markSearchPanelOpened,
  setQuery
} from "../editor/search.ts";

type SearchPanelController = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
};

export const createSearchPanel = (editorHandle: EditorHandle): SearchPanelController => {
  const panel = document.createElement("div");
  panel.className = "leditor-search-panel";
  panel.classList.add("leditor-ui-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Search and replace");

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
      panel.classList.add("is-open");
      markSearchPanelOpened();
      applyQuery();
      searchInput.focus();
    },
    close() {
      panel.classList.remove("is-open");
      clearSearch();
    },
    toggle() {
      if (!panel.classList.contains("is-open")) {
        controller.open();
        return;
      }
      controller.close();
    },
    isOpen() {
      return panel.classList.contains("is-open");
    }
  };

  return controller;
};
