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

const buildMenuItems = (context: ContextType): MenuItem[] => {
  switch (context) {
    case "text":
      return [
        { label: "Agent: Refine", command: "agent.action", args: { id: "refine" } },
        { label: "Agent: Paraphrase", command: "agent.action", args: { id: "paraphrase" } },
        { label: "Agent: Shorten", command: "agent.action", args: { id: "shorten" } },
        { label: "Agent: Proofread", command: "agent.action", args: { id: "proofread" } },
        { label: "Agent: Substantiate", command: "agent.action", args: { id: "substantiate" } },
        { label: "Agent: Synonyms", command: "agent.action", args: { id: "synonyms" }, requireSelection: true },
        { label: "Agent: Antonyms", command: "agent.action", args: { id: "antonyms" }, requireSelection: true },
        { label: "Agent: Check sources", command: "agent.action", args: { id: "check_sources" } },
        { label: "Agent: Clear checks", command: "agent.action", args: { id: "clear_checks" } },
        { label: "Ref: Open picker…", command: "", action: "ref_open_picker" },
        { label: "Ref: Insert bibliography", command: "", action: "ref_insert_biblio" },
        { label: "Ref: Update from editor", command: "", action: "ref_update_from_editor" },
        { label: "Ref: Style = APA", command: "", action: "ref_style_apa" },
        { label: "Ref: Style = Numeric", command: "", action: "ref_style_numeric" },
        { label: "Ref: Style = Footnote", command: "", action: "ref_style_footnote" },
        { label: "Bold", command: "Bold" },
        { label: "Italic", command: "Italic" },
        { label: "Clear Formatting", command: "ClearFormatting" },
        ...tableSizes.map((size) => ({
          label: `Insert Table ${size.rows}Į-${size.cols}`,
          command: "TableInsert",
          args: { rows: size.rows, cols: size.cols }
        })),
        { label: "Footnotes…", command: "FootnotePanel" }
      ];
    case "link":
      return [
        { label: "Agent: Refine", command: "agent.action", args: { id: "refine" } },
        { label: "Agent: Paraphrase", command: "agent.action", args: { id: "paraphrase" } },
        { label: "Agent: Shorten", command: "agent.action", args: { id: "shorten" } },
        { label: "Agent: Proofread", command: "agent.action", args: { id: "proofread" } },
        { label: "Agent: Substantiate", command: "agent.action", args: { id: "substantiate" } },
        { label: "Agent: Synonyms", command: "agent.action", args: { id: "synonyms" }, requireSelection: true },
        { label: "Agent: Antonyms", command: "agent.action", args: { id: "antonyms" }, requireSelection: true },
        { label: "Agent: Check sources", command: "agent.action", args: { id: "check_sources" } },
        { label: "Agent: Clear checks", command: "agent.action", args: { id: "clear_checks" } },
        { label: "Ref: Open picker…", command: "", action: "ref_open_picker" },
        { label: "Ref: Update from editor", command: "", action: "ref_update_from_editor" },
        { label: "Edit Link", command: "EditLink" },
        { label: "Remove Link", command: "RemoveLink" }
      ];
    case "table":
      return tableSizes.map((size) => ({
        label: `Insert Table ${size.rows}Į-${size.cols}`,
        command: "TableInsert",
        args: { rows: size.rows, cols: size.cols }
      }));
    default:
      return [];
  }
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
    const items = buildMenuItems(context);
    if (items.length === 0) return;
    menuEl = document.createElement("div");
    menuEl.className = "leditor-context-menu";
    menuEl.style.position = "fixed";
    menuEl.style.top = `${event.clientY}px`;
    menuEl.style.left = `${event.clientX}px`;

    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => {
        if (item.action) {
          const selection = getSelectionSnapshot(editor);
          if (item.requireSelection && !selection.text && !selection.html) {
            closeMenu();
            return;
          }
          dispatchContextAction(item.action, editor);
          recordAction(context);
          closeMenu();
          return;
        }
        if (item.command) {
          if (item.requireSelection) {
            const selection = getSelectionSnapshot(editor);
            if (!selection.text && !selection.html) {
              closeMenu();
              return;
            }
          }
          handle.execCommand(item.command, item.args);
          recordAction(context);
        }
        closeMenu();
      });
      menuEl.appendChild(button);
    }

    document.body.appendChild(menuEl);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeMenu();
  };

  document.addEventListener("click", closeMenu);
  document.addEventListener("scroll", closeMenu, true);
  document.addEventListener("keydown", onKeyDown);
    editorDom.addEventListener("contextmenu", onContextMenu);

  return () => {
    closeMenu();
    document.removeEventListener("click", closeMenu);
    document.removeEventListener("scroll", closeMenu, true);
    document.removeEventListener("keydown", onKeyDown);
        editorDom.removeEventListener("contextmenu", onContextMenu);
  };
};
