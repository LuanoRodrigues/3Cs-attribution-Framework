import type { Editor } from "@tiptap/core";
import type { EditorHandle } from "../api/leditor.ts";
import { openStyleMiniApp } from "./style_mini_app.ts";

const PANEL_ID = "leditor-styles-panel";

type StyleEntry = {
  id: string;
  label: string;
};

const STYLE_ENTRIES: StyleEntry[] = [
  { id: "NormalStyle", label: "Normal" },
  { id: "Heading1", label: "Heading 1" },
  { id: "Heading2", label: "Heading 2" },
  { id: "Heading3", label: "Heading 3" },
  { id: "Heading4", label: "Heading 4" },
  { id: "Heading5", label: "Heading 5" },
  { id: "Heading6", label: "Heading 6" }
];

let stylesPanel: HTMLElement | null = null;
let stylesVisible = false;
let lastHandle: EditorHandle | null = null;

const getHost = (): HTMLElement | null => {
  const appRoot = document.getElementById("leditor-app");
  if (!appRoot) return null;
  return appRoot.querySelector<HTMLElement>(".leditor-main-split") ?? appRoot;
};

const detectActiveStyle = (editor: Editor): string => {
  for (let level = 1; level <= 6; level += 1) {
    if (editor.isActive("heading", { level })) return `Heading${level}`;
  }
  return "NormalStyle";
};

const updateActiveStyle = (editor: Editor) => {
  if (!stylesPanel) return;
  const activeId = detectActiveStyle(editor);
  const items = stylesPanel.querySelectorAll<HTMLButtonElement>(".leditor-styles-item");
  items.forEach((item) => {
    const id = item.dataset.styleId ?? item.dataset.command ?? "";
    item.classList.toggle("is-active", id === activeId);
  });
  const activeLabel = stylesPanel.querySelector<HTMLElement>(".leditor-styles-active");
  if (activeLabel) {
    const label = STYLE_ENTRIES.find((entry) => entry.id === activeId)?.label ?? "Normal";
    activeLabel.textContent = `Active: ${label}`;
  }
};

const ensureStylesPanel = (editorHandle: EditorHandle): HTMLElement | null => {
  if (stylesPanel) return stylesPanel;
  const host = getHost();
  if (!host) return null;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "leditor-styles-panel";

  const header = document.createElement("div");
  header.className = "leditor-styles-header";

  const title = document.createElement("div");
  title.className = "leditor-styles-title";
  title.textContent = "Styles";

  const active = document.createElement("div");
  active.className = "leditor-styles-active";
  active.textContent = "Active: Normal";

  header.append(title, active);

  const actions = document.createElement("div");
  actions.className = "leditor-styles-actions";

  const makeAction = (label: string, onClick: () => void) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "leditor-ui-btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  };

  actions.append(
    makeAction("New", () => {
      openStyleMiniApp(panel, { editorHandle }, { mode: "create" });
    }),
    makeAction("Modify", () => {
      openStyleMiniApp(panel, { editorHandle }, { mode: "modify" });
    }),
    makeAction("Clear", () => {
      try {
        editorHandle.execCommand("styles.clear");
      } catch {
        // ignore
      }
    })
  );

  const list = document.createElement("div");
  list.className = "leditor-styles-list";

  STYLE_ENTRIES.forEach((entry) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "leditor-styles-item";
    item.dataset.styleId = entry.id;
    item.textContent = entry.label;
    item.addEventListener("click", () => {
      try {
        editorHandle.execCommand(entry.id);
      } catch {
        // ignore
      }
    });
    list.appendChild(item);
  });

  panel.append(header, actions, list);

  const docShell = host.querySelector<HTMLElement>(".leditor-doc-shell");
  const pdfShell = host.querySelector<HTMLElement>(".leditor-pdf-shell");
  if (pdfShell) {
    host.insertBefore(panel, pdfShell);
  } else if (docShell && docShell.nextSibling) {
    host.insertBefore(panel, docShell.nextSibling);
  } else {
    host.appendChild(panel);
  }

  stylesPanel = panel;
  return stylesPanel;
};

export const toggleStylesPane = (editorHandle: EditorHandle) => {
  lastHandle = editorHandle;
  const panel = ensureStylesPanel(editorHandle);
  if (!panel) return;
  stylesVisible = !stylesVisible;
  panel.classList.toggle("is-open", stylesVisible);
  if (stylesVisible) {
    updateActiveStyle(editorHandle.getEditor());
  }
};

export const refreshStylesPane = (editor: Editor) => {
  if (!stylesVisible || !stylesPanel) return;
  updateActiveStyle(editor);
};

export const isStylesPaneVisible = () => stylesVisible;

export const reopenStylesPaneIfVisible = () => {
  if (!stylesVisible || !lastHandle) return;
  toggleStylesPane(lastHandle);
  toggleStylesPane(lastHandle);
};
