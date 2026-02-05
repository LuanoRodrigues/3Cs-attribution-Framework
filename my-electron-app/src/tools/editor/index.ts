import { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";
import { Schema, DOMParser as PMDOMParser, DOMSerializer, Node as PMNode, DOMOutputSpec, NodeSpec } from "prosemirror-model";
import OrderedMap from "orderedmap";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo, redo } from "prosemirror-history";
import { baseKeymap, exitCode, toggleMark, setBlockType } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes, wrapInList, sinkListItem, liftListItem } from "prosemirror-schema-list";
import { gapCursor } from "prosemirror-gapcursor";
import { tableEditing } from "prosemirror-tables";
import { marked } from "marked";
import { safeDropCursor } from "./safe_dropcursor";

function buildSchema(): Schema {
  const listNodes = addListNodes(basicSchema.spec.nodes as any, "paragraph block*", "block");

  const tableNodes: Record<string, NodeSpec> = {
    table: {
      content: "table_row+",
      tableRole: "table",
      isolating: true,
      group: "block",
      parseDOM: [{ tag: "table" }],
      toDOM(): DOMOutputSpec {
        return ["table", ["tbody", 0]];
      }
    },
    table_row: {
      content: "table_cell+",
      tableRole: "row",
      parseDOM: [{ tag: "tr" }],
      toDOM(): DOMOutputSpec {
        return ["tr", 0];
      }
    },
    table_cell: {
      content: "block+",
      attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } },
      tableRole: "cell",
      isolating: true,
      parseDOM: [{ tag: "td" }],
      toDOM(node): DOMOutputSpec {
        const attrs: Record<string, string> = {};
        if (node.attrs.colspan !== 1) attrs.colspan = String(node.attrs.colspan);
        if (node.attrs.rowspan !== 1) attrs.rowspan = String(node.attrs.rowspan);
        if (node.attrs.colwidth) attrs["data-colwidth"] = (node.attrs.colwidth as number[]).join(",");
        return ["td", attrs, 0];
      }
    },
    table_header: {
      content: "block+",
      attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } },
      tableRole: "header_cell",
      isolating: true,
      parseDOM: [{ tag: "th" }],
      toDOM(node): DOMOutputSpec {
        const attrs: Record<string, string> = {};
        if (node.attrs.colspan !== 1) attrs.colspan = String(node.attrs.colspan);
        if (node.attrs.rowspan !== 1) attrs.rowspan = String(node.attrs.rowspan);
        if (node.attrs.colwidth) attrs["data-colwidth"] = (node.attrs.colwidth as number[]).join(",");
        return ["th", attrs, 0];
      }
    }
  };

  const footnote: NodeSpec = {
    group: "inline",
    inline: true,
    content: "inline*",
    attrs: { id: { default: null } },
    toDOM(node): DOMOutputSpec {
      return ["span", { class: "footnote", "data-id": node.attrs.id || undefined }, 0];
    },
    parseDOM: [{ tag: "span.footnote", getAttrs: (dom: Element) => ({ id: dom.getAttribute("data-id") }) }]
  };

  const pageBreak: NodeSpec = {
    group: "block",
    parseDOM: [{ tag: "div.page-break" }, { tag: "hr.page-break" }],
    toDOM(): DOMOutputSpec {
      return ["div", { class: "page-break" }, 0];
    }
  };

  const nodes = (listNodes as any)
    .append(tableNodes as any)
    .append({ footnote, page_break: pageBreak } as any);
  const marks = basicSchema.spec.marks;

  return new Schema({ nodes, marks });
}

function renderToolbarButton(label: string, handler: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.className = "button-ghost";
  btn.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    handler();
  });
  return btn;
}

function createTable(view: EditorView, rows = 3, cols = 3): void {
  const { state, dispatch } = view;
  const rowsArray: PMNode[] = [];
  for (let r = 0; r < rows; r += 1) {
    const cells: PMNode[] = [];
    for (let c = 0; c < cols; c += 1) {
      cells.push(state.schema.nodes.table_cell.createAndFill()!);
    }
    rowsArray.push(state.schema.nodes.table_row.createChecked(null, cells));
  }
  const table = state.schema.nodes.table.createChecked(null, rowsArray);
  dispatch(state.tr.replaceSelectionWith(table).scrollIntoView());
}

function countWords(doc: PMNode): { words: number; chars: number } {
  const text = doc.textContent || "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { words, chars: text.length };
}

function serializeHTML(schema: Schema, doc: PMNode): string {
  const serializer = DOMSerializer.fromSchema(schema);
  const fragment = serializer.serializeFragment(doc.content);
  const wrap = document.createElement("div");
  wrap.appendChild(fragment);
  return wrap.innerHTML;
}

function docToMarkdown(node: PMNode): string {
  const chunks: string[] = [];
  node.forEach((child) => {
    switch (child.type.name) {
      case "paragraph":
        chunks.push(serializeInline(child));
        chunks.push("\n\n");
        break;
      case "heading":
        chunks.push("#".repeat(child.attrs.level || 1) + " " + serializeInline(child));
        chunks.push("\n\n");
        break;
      case "bullet_list": {
        child.forEach((li) => {
          chunks.push("- " + serializeInline(li));
          chunks.push("\n");
        });
        chunks.push("\n");
        break;
      }
      case "ordered_list": {
        let i = 1;
        child.forEach((li) => {
          chunks.push(`${i}. ${serializeInline(li)}`);
          chunks.push("\n");
          i += 1;
        });
        chunks.push("\n");
        break;
      }
      case "table":
        child.forEach((row, rowIndex) => {
          const cells: string[] = [];
          row.forEach((cell) => {
            cells.push(serializeInline(cell));
          });
          chunks.push("| " + cells.join(" | ") + " |\n");
          if (rowIndex === 0) {
            chunks.push("|" + cells.map(() => " --- |").join("") + "\n");
          }
        });
        chunks.push("\n");
        break;
      case "page_break":
        chunks.push("---\n\n");
        break;
      case "footnote":
        chunks.push(`[^${child.attrs.id || "note"}]: ${serializeInline(child)}\n\n`);
        break;
      default:
        chunks.push(serializeInline(child));
        chunks.push("\n");
    }
  });
  return chunks.join("");
}

function serializeInline(node: PMNode): string {
  let text = "";
  node.forEach((child) => {
    if (child.isText) {
      let markWrapped = child.text as string;
      child.marks.forEach((mark) => {
        if (mark.type.name === "strong") markWrapped = `**${markWrapped}**`;
        if (mark.type.name === "em") markWrapped = `*${markWrapped}*`;
        if (mark.type.name === "link") markWrapped = `[${markWrapped}](${mark.attrs.href})`;
      });
      text += markWrapped;
    } else if (child.type.name === "hard_break") {
      text += "  \n";
    } else {
      text += serializeInline(child);
    }
  });
  return text || (node.isInline ? "" : node.textContent);
}

export function createEditorTool(): ToolDefinition {
  return {
    type: "editor",
    title: "Editor",
    create: ({ metadata, onUpdate }): ToolHandle => {
      const schema = buildSchema();
      const mount = document.createElement("div");
      mount.className = "tool-surface";

      const toolbar = document.createElement("div");
      toolbar.className = "editor-toolbar";
      mount.appendChild(toolbar);

      const surface = document.createElement("div");
      surface.className = "prosemirror-surface";
      mount.appendChild(surface);

      const statusBar = document.createElement("div");
      statusBar.className = "status-bar";
      mount.appendChild(statusBar);

      const docJSON = metadata?.doc as any;
      const content = docJSON ? PMNode.fromJSON(schema, docJSON) : null;

      const state = EditorState.create({
        schema,
        doc: content || schema.node("doc", undefined, [schema.node("paragraph", undefined, schema.text("Start writing..."))]),
        plugins: [
          history(),
          safeDropCursor(),
          gapCursor(),
          tableEditing(),
          keymap({
            "Mod-b": toggleMark(schema.marks.strong),
            "Mod-i": toggleMark(schema.marks.em),
            "Mod-z": undo,
            "Shift-Mod-z": redo,
            "Mod-Enter": exitCode,
            Tab: sinkListItem(schema.nodes.list_item),
            "Shift-Tab": liftListItem(schema.nodes.list_item)
          }),
          keymap(baseKeymap)
        ]
      });

      const view = new EditorView(surface, {
        state,
        dispatchTransaction: (tr) => {
          const newState = view.state.apply(tr);
          view.updateState(newState);
          const counts = countWords(newState.doc);
          statusBar.textContent = `${counts.words} words • ${counts.chars} chars`;
          if (onUpdate) {
            onUpdate({ doc: newState.doc.toJSON() });
          }
        }
      });

      const applyCommand = (cmd: any) => {
        cmd(view.state, view.dispatch, view);
      };

      const addButton = (label: string, handler: () => void) => {
        toolbar.appendChild(renderToolbarButton(label, handler));
      };

      addButton("Bold", () => applyCommand(toggleMark(schema.marks.strong)));
      addButton("Italic", () => applyCommand(toggleMark(schema.marks.em)));
      addButton("H1", () => applyCommand(setBlockType(schema.nodes.heading, { level: 1 })));
      addButton("H2", () => applyCommand(setBlockType(schema.nodes.heading, { level: 2 })));
      addButton("Bullet", () => applyCommand(wrapInList(schema.nodes.bullet_list)));
      addButton("Ordered", () => applyCommand(wrapInList(schema.nodes.ordered_list)));
      addButton("Indent", () => applyCommand(sinkListItem(schema.nodes.list_item)));
      addButton("Outdent", () => applyCommand(liftListItem(schema.nodes.list_item)));
      addButton("Link", () => {
        const href = prompt("Link URL?");
        if (!href) return;
        applyCommand(toggleMark(schema.marks.link, { href }));
      });
      addButton("Table", () => createTable(view));
      addButton("Footnote", () => {
        const text = prompt("Footnote text");
        if (!text) return;
        const { state, dispatch } = view;
        const foot = schema.nodes.footnote.create({ id: `fn-${Date.now()}` }, schema.text(text));
        dispatch(state.tr.replaceSelectionWith(foot).scrollIntoView());
      });
      addButton("Page Break", () => {
        const { state, dispatch } = view;
        const pb = schema.nodes.page_break.create();
        dispatch(state.tr.replaceSelectionWith(pb).scrollIntoView());
      });
      addButton("Undo", () => applyCommand(undo));
      addButton("Redo", () => applyCommand(redo));

      const exportRow = document.createElement("div");
      exportRow.className = "control-row";
      const htmlBtn = document.createElement("button");
      htmlBtn.className = "ribbon-button";
      htmlBtn.textContent = "Export HTML";
      htmlBtn.addEventListener("click", () => {
        const html = serializeHTML(schema, view.state.doc);
        showModal("HTML", html);
      });
      const mdBtn = document.createElement("button");
      mdBtn.className = "ribbon-button";
      mdBtn.textContent = "Export MD";
      mdBtn.addEventListener("click", () => {
        const md = docToMarkdown(view.state.doc);
        showModal("Markdown", md);
      });

      const importBtn = document.createElement("button");
      importBtn.className = "ribbon-button";
      importBtn.textContent = "Import";
      importBtn.addEventListener("click", async () => {
        const input = prompt("Paste HTML or Markdown");
        if (!input) return;
        const html = input.includes("<") ? input : marked.parse(input);
        const wrap = document.createElement("div");
        wrap.innerHTML = html as string;
        const newDoc = PMDOMParser.fromSchema(schema).parse(wrap);
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content);
        view.dispatch(tr);
      });

      exportRow.appendChild(htmlBtn);
      exportRow.appendChild(mdBtn);
      exportRow.appendChild(importBtn);
      mount.appendChild(exportRow);

      const showModal = (title: string, value: string) => {
        const modal = document.createElement("div");
        modal.className = "modal";
        Object.assign(modal.style, {
          position: "fixed",
          inset: "10%",
          background: "#0f172a",
          border: "1px solid #1f2937",
          padding: "12px",
          zIndex: 9999,
          borderRadius: "12px",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: "8px"
        });
        const heading = document.createElement("div");
        heading.textContent = title;
        heading.style.fontWeight = "600";
        const area = document.createElement("textarea");
        area.value = value;
        area.style.width = "100%";
        area.style.height = "100%";
        area.style.background = "#0b1220";
        area.style.color = "#e5e7eb";
        const close = document.createElement("button");
        close.textContent = "Close";
        close.className = "ribbon-button";
        close.addEventListener("click", () => modal.remove());
        modal.appendChild(heading);
        modal.appendChild(area);
        modal.appendChild(close);
        document.body.appendChild(modal);
      };

      const counts = countWords(view.state.doc);
      statusBar.textContent = `${counts.words} words • ${counts.chars} chars`;

      return {
        element: mount,
        focus: () => view.focus(),
        destroy: () => view.destroy(),
        getMetadata: () => ({ doc: view.state.doc.toJSON() })
      };
    }
  };
}



