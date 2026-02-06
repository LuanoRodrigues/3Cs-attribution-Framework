import { NodeSelection } from "prosemirror-state";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";
import type { EditorHandle } from "../api/leditor.ts";

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

type ContextType = "text" | "link" | "table";

type ContextGroup = "agent" | "dictionary" | "ref";

type MenuItem = {
  label: string;
  command: string;
  args?: any;
  action?: string;
  requireSelection?: boolean;
};

type PhaseFlags = {
  textAction: boolean;
  linkAction: boolean;
  tableAction: boolean;
  logged: boolean;
};

const phaseFlags: PhaseFlags = {
  textAction: false,
  linkAction: false,
  tableAction: false,
  logged: false
};

const recordAction = (context: ContextType) => {
  if (context === "text") {
    phaseFlags.textAction = true;
  } else if (context === "link") {
    phaseFlags.linkAction = true;
  } else if (context === "table") {
    phaseFlags.tableAction = true;
  }
  if (phaseFlags.textAction && phaseFlags.linkAction && phaseFlags.tableAction && !phaseFlags.logged) {
    window.codexLog?.write("[PHASE16_OK]");
    phaseFlags.logged = true;
  }
};

const isInsideTableCell = (editor: Editor) => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "table_cell" || node.type.name === "table_header") return true;
  }
  return false;
};

const determineContext = (editor: Editor): ContextType | null => {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === "image") {
    return null;
  }
  if (isInsideTableCell(editor)) {
    return "table";
  }
  if (editor.isActive("link")) {
    return "link";
  }
  const { $from } = selection;
  if ($from.parent.isTextblock) {
    return "text";
  }
  return null;
};

const tableSizes = [
  { rows: 2, cols: 2 },
  { rows: 3, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 3 }
];

const buildMenuGroups = (context: ContextType): Record<ContextGroup, MenuItem[]> => {
  const agentItems: MenuItem[] = [
    { label: "Refine", command: "agent.action", args: { id: "refine" } },
    { label: "Paraphrase", command: "agent.action", args: { id: "paraphrase" } },
    { label: "Shorten", command: "agent.action", args: { id: "shorten" } },
    { label: "Proofread", command: "agent.action", args: { id: "proofread" } },
    { label: "Substantiate", command: "agent.action", args: { id: "substantiate" } },
    { label: "Abstract", command: "agent.action", args: { id: "abstract" } },
    { label: "Introduction", command: "agent.action", args: { id: "introduction" } },
    { label: "Findings", command: "agent.action", args: { id: "findings" } },
    { label: "Recommendations", command: "agent.action", args: { id: "recommendations" } },
    { label: "Conclusion", command: "agent.action", args: { id: "conclusion" } },
    { label: "Check sources", command: "agent.action", args: { id: "check_sources" } },
    { label: "Clear checks", command: "agent.action", args: { id: "clear_checks" } }
  ];

  const dictionaryItems: MenuItem[] = [
    { label: "Explain", command: "lexicon.explain", requireSelection: true },
    { label: "Define", command: "lexicon.define", requireSelection: true },
    { label: "Synonyms", command: "lexicon.synonyms", requireSelection: true },
    { label: "Antonyms", command: "lexicon.antonyms", requireSelection: true }
  ];

  const refItemsText: MenuItem[] = [
    { label: "Open picker…", command: "", action: "ref_open_picker" },
    { label: "Insert bibliography", command: "", action: "ref_insert_biblio" },
    { label: "Update from editor", command: "", action: "ref_update_from_editor" },
    { label: "Style = APA", command: "", action: "ref_style_apa" },
    { label: "Style = Numeric", command: "", action: "ref_style_numeric" },
    { label: "Style = Footnote", command: "", action: "ref_style_footnote" }
  ];

  const refItemsLink: MenuItem[] = [
    { label: "Open picker…", command: "", action: "ref_open_picker" },
    { label: "Update from editor", command: "", action: "ref_update_from_editor" },
    { label: "Edit link", command: "EditLink" },
    { label: "Remove link", command: "RemoveLink" }
  ];

  if (context === "link") {
    return { agent: agentItems, dictionary: dictionaryItems, ref: refItemsLink };
  }
  if (context === "table") {
    // Context menu is intentionally simplified. Table/formatting actions are removed per product UX.
    return { agent: [], dictionary: [], ref: [] };
  }
  return { agent: agentItems, dictionary: dictionaryItems, ref: refItemsText };
};

const getSelectionSnapshot = (editor: Editor) => {
  const { from, to } = editor.state.selection;
  if (from === to) {
    return { html: "", text: "" };
  }
  const slice = editor.state.doc.slice(from, to);
  const serializer = DOMSerializer.fromSchema(editor.state.schema);
  const wrapper = document.createElement("div");
  wrapper.appendChild(serializer.serializeFragment(slice.content));
  const html = wrapper.innerHTML;
  const text = editor.state.doc.textBetween(from, to, "\n\n");
  return { html, text };
};

const dispatchContextAction = (action: string, editor: Editor) => {
  const selection = getSelectionSnapshot(editor);
  const payload = { action, selectionHtml: selection.html, selectionText: selection.text };
  window.dispatchEvent(new CustomEvent("leditor-context-action", { detail: payload }));
  const host = (window as typeof window & { leditorHost?: any }).leditorHost;
  if (host && typeof host.onContextAction === "function") {
    try {
      host.onContextAction(payload);
    } catch {
      // ignore host failures
    }
  }
};

export const attachContextMenu = (handle: EditorHandle, editorDom: HTMLElement, editor: Editor) => {
  let menuEl: HTMLDivElement | null = null;
  let activeGroup: ContextGroup = "agent";

  // Word-like right-click behavior: when right-clicking inside an existing range selection, do not
  // collapse/move the selection before opening the context menu.
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 2) return;
    const target = event.target as HTMLElement | null;
    if (!target || !editorDom.contains(target)) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    const docPos = typeof pos?.pos === "number" ? pos.pos : null;
    if (docPos == null) return;
    const min = Math.min(from, to);
    const max = Math.max(from, to);
    if (docPos >= min && docPos <= max) {
      event.preventDefault();
    }
  };

  const closeMenu = () => {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
  };

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !editorDom.contains(target)) return;
    const context = determineContext(editor);
    if (!context) return;
    event.preventDefault();
    closeMenu();
    const groups = buildMenuGroups(context);
    const selection = getSelectionSnapshot(editor);
    const selectionRange = { from: editor.state.selection.from, to: editor.state.selection.to };
    const hasSelection = Boolean(selection.text || selection.html);
    const anyItems = Object.values(groups).some((list) => list.length > 0);
    if (!anyItems) return;
    menuEl = document.createElement("div");
    menuEl.className = "leditor-context-menu";
    menuEl.style.position = "fixed";
    menuEl.style.top = `${event.clientY}px`;
    menuEl.style.left = `${event.clientX}px`;

    const header = document.createElement("div");
    header.className = "leditor-context-menu__header";

    const itemsEl = document.createElement("div");
    itemsEl.className = "leditor-context-menu__items";

    const tab = (group: ContextGroup, label: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "leditor-context-menu__tab";
      b.textContent = label;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", group === activeGroup ? "true" : "false");
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeGroup = group;
        renderItems();
      });
      return b;
    };

    const renderItems = () => {
      header.querySelectorAll(".leditor-context-menu__tab").forEach((el) => {
        const btn = el as HTMLButtonElement;
        const g = (btn.dataset.group ?? "") as ContextGroup;
        const isActive = g === activeGroup;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      itemsEl.replaceChildren();
      const items = groups[activeGroup] ?? [];
      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "leditor-context-menu__item";
        button.textContent = item.label;
        const disabled = Boolean(item.requireSelection && !hasSelection);
        button.disabled = disabled;
        button.addEventListener("click", () => {
          if (button.disabled) {
            closeMenu();
            return;
          }
          if (item.requireSelection) {
            try {
              const from = Math.min(selectionRange.from, selectionRange.to);
              const to = Math.max(selectionRange.from, selectionRange.to);
              if (from !== to) {
                editor.commands.setTextSelection?.({ from, to });
              }
            } catch {
              // ignore
            }
          }
          if (item.action) {
            dispatchContextAction(item.action, editor);
            recordAction(context);
            closeMenu();
            return;
          }
          if (item.command) {
            handle.execCommand(item.command, item.args);
            recordAction(context);
          }
          closeMenu();
        });
        itemsEl.appendChild(button);
      }
    };

    const tAgent = tab("agent", "Agent");
    tAgent.dataset.group = "agent";
    const tDict = tab("dictionary", "Dictionary");
    tDict.dataset.group = "dictionary";
    const tRef = tab("ref", "Ref");
    tRef.dataset.group = "ref";
    header.append(tAgent, tDict, tRef);

    menuEl.append(header, itemsEl);
    renderItems();

    document.body.appendChild(menuEl);

    // Clamp to viewport.
    try {
      const rect = menuEl.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      const left = Math.max(8, Math.min(maxLeft, event.clientX));
      const top = Math.max(8, Math.min(maxTop, event.clientY));
      menuEl.style.left = `${Math.round(left)}px`;
      menuEl.style.top = `${Math.round(top)}px`;
    } catch {
      // ignore
    }

    // Focus first tab.
    try {
      (menuEl.querySelector(".leditor-context-menu__tab") as HTMLButtonElement | null)?.focus();
    } catch {
      // ignore
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeMenu();
  };

  document.addEventListener("click", closeMenu);
  document.addEventListener("scroll", closeMenu, true);
  document.addEventListener("keydown", onKeyDown);
  editorDom.addEventListener("mousedown", onMouseDown, true);
    editorDom.addEventListener("contextmenu", onContextMenu);

  return () => {
    closeMenu();
    document.removeEventListener("click", closeMenu);
    document.removeEventListener("scroll", closeMenu, true);
    document.removeEventListener("keydown", onKeyDown);
    editorDom.removeEventListener("mousedown", onMouseDown, true);
        editorDom.removeEventListener("contextmenu", onContextMenu);
  };
};

export const openContextMenuAtSelection = (editor: Editor) => {
  try {
    const pos = editor.state.selection.from;
    const coords = editor.view.coordsAtPos(pos);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: coords.left,
      clientY: coords.top
    });
    editor.view.dom.dispatchEvent(event);
  } catch {
    // ignore context menu errors
  }
};
