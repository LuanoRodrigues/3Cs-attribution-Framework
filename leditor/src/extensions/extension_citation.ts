import { Node, mergeAttributes, type NodeViewRenderer } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { CitationItemRef } from "../csl/types.ts";

const KEY_REGEX = /^[A-Z0-9]{8}$/;
const TOKEN_REGEX = /^item_keys=\[([A-Z0-9]{8}(?:,[A-Z0-9]{8})*)\]$/;
const formatToken = (keys: string[]): string => `item_keys=[${keys.join(",")}]`;
const parseBoolAttr = (value: string | null): boolean | undefined => {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
};
const boolAttrString = (value?: boolean | null): string | undefined => {
  if (value === true) return "1";
  if (value === false) return "0";
  return undefined;
};

const parseItemsPayload = (raw: string | null): CitationItemRef[] | null => {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as CitationItemRef[];
  if (!Array.isArray(parsed)) {
    throw new Error("Citation items payload must be an array");
  }
  return parsed;
};

const extractItemKeys = (node: HTMLElement): string[] => {
  const rawKeys = (node.getAttribute("data-item-keys") || "").split(",").map((k) => k.trim()).filter(Boolean);
  const validKeys = rawKeys.filter((key) => KEY_REGEX.test(key));
  if (validKeys.length) {
    return validKeys;
  }
  const token = node.getAttribute("data-token");
  if (!token) return [];
  const match = TOKEN_REGEX.exec(token.trim());
  if (!match) return [];
  return match[1].split(",").filter((key) => KEY_REGEX.test(key));
};

const buildLegacyItems = (node: HTMLElement, itemKeys: string[]): CitationItemRef[] => {
  const locator = node.getAttribute("data-locator") || null;
  const label = node.getAttribute("data-label") || null;
  const prefix = node.getAttribute("data-prefix") || null;
  const suffix = node.getAttribute("data-suffix") || null;
  const suppressAuthor = parseBoolAttr(node.getAttribute("data-suppress-author")) ?? false;
  const authorOnly = parseBoolAttr(node.getAttribute("data-author-only")) ?? false;
  return itemKeys.map((itemKey) => ({
    itemKey,
    locator,
    label,
    prefix,
    suffix,
    suppressAuthor,
    authorOnly
  }));
};

const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, "").trim();

const displayText = (attrs: Record<string, any>): string => {
  if (typeof attrs.renderedHtml === "string" && attrs.renderedHtml.trim().length > 0) {
    return stripHtml(attrs.renderedHtml);
  }
  if (Array.isArray(attrs.items) && attrs.items.length) {
    return attrs.items.map((item: CitationItemRef) => item.itemKey).join(", ");
  }
  return "(citation)";
};

const getItemKeys = (items: CitationItemRef[]): string[] =>
  items.map((item) => item.itemKey).filter((key) => KEY_REGEX.test(key));

class CitationNodeView {
  private node: ProseMirrorNode;
  private readonly anchor: HTMLAnchorElement;
  private readonly onSelect?: () => void;

  constructor(node: ProseMirrorNode, onSelect?: () => void) {
    this.node = node;
    this.onSelect = onSelect;
    this.anchor = document.createElement("a");
    this.anchor.className = "leditor-citation-anchor";
    this.anchor.href = "#";
    this.anchor.contentEditable = "false";
    this.anchor.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onSelect?.();
    });
    this.anchor.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onSelect?.();
    });
    this.applyNode(node);
  }

  private applyNode(node: ProseMirrorNode) {
    const attrs = node.attrs ?? {};
    const items = Array.isArray(attrs.items) ? (attrs.items as CitationItemRef[]) : [];
    const itemKeys = getItemKeys(items);
    this.anchor.dataset.itemKeys = itemKeys.join(",");
    this.anchor.dataset.token = itemKeys.length ? formatToken(itemKeys) : "";
    if (typeof attrs.citationId === "string" && attrs.citationId) {
      this.anchor.dataset.citationId = attrs.citationId;
    } else {
      delete this.anchor.dataset.citationId;
    }
    this.anchor.dataset.citationItems = JSON.stringify(items);
    const dqid = typeof attrs.dqid === "string" ? attrs.dqid.trim() : "";
    if (dqid) {
      this.anchor.dataset.dqid = dqid;
      this.anchor.href = `dq://${dqid}`;
    } else {
      delete this.anchor.dataset.dqid;
      this.anchor.href = "#";
    }
    const title = typeof attrs.title === "string" ? attrs.title.trim() : "";
    if (title) {
      this.anchor.title = title;
    } else {
      this.anchor.removeAttribute("title");
    }
    const hidden = Boolean(attrs.hidden);
    this.anchor.style.display = hidden ? "none" : "";
    this.anchor.dataset.citationHidden = hidden ? "1" : "0";
    if (hidden) {
      this.anchor.innerHTML = "";
      return;
    }
    if (typeof attrs.renderedHtml === "string" && attrs.renderedHtml.trim().length > 0) {
      this.anchor.dataset.renderedHtml = attrs.renderedHtml;
      this.anchor.innerHTML = attrs.renderedHtml;
    } else {
      this.anchor.dataset.renderedHtml = "";
      this.anchor.textContent = "(citation)";
    }
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.applyNode(node);
    return true;
  }

  get dom() {
    return this.anchor;
  }
}

const citationNodeView: NodeViewRenderer = (props) => {
  const onSelect = () => {
    try {
      const pos = typeof props.getPos === "function" ? props.getPos() : null;
      if (typeof pos !== "number") return;
      const selection = NodeSelection.create(props.editor.state.doc, pos);
      props.editor.view.dispatch(props.editor.state.tr.setSelection(selection));
    } catch {
      // ignore
    }
  };
  const view = new CitationNodeView(props.node, onSelect);
  return {
    dom: view.dom,
    update: (node) => view.update(node)
  };
};

const CitationNode = Node.create({
  name: "citation",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      citationId: { default: null },
      items: { default: [] },
      renderedHtml: { default: "" },
      hidden: { default: false },
      dqid: { default: null },
      title: { default: null }
    };
  },
  parseHTML() {
    return [
      {
        tag: "a.leditor-citation-anchor",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const parsedItems = parseItemsPayload(element.getAttribute("data-citation-items"));
          const itemKeys = parsedItems ? getItemKeys(parsedItems) : extractItemKeys(element);
          if (!itemKeys.length && (!parsedItems || parsedItems.length === 0)) return false;
          const items = parsedItems ?? buildLegacyItems(element, itemKeys);
          const href = element.getAttribute("href") || "";
          const dqid =
            element.getAttribute("data-dqid") ||
            element.getAttribute("data-quote-id") ||
            element.getAttribute("data-quote_id") ||
            (href.startsWith("dq://") ? href.slice("dq://".length) : null);
          return {
            citationId: element.getAttribute("data-citation-id") || null,
            items,
            renderedHtml: element.getAttribute("data-rendered-html") || element.innerHTML || "",
            hidden: parseBoolAttr(element.getAttribute("data-citation-hidden")) ?? false,
            dqid: dqid || null,
            title: element.getAttribute("title") || null
          };
        }
      },
      {
        tag: "a[data-item-keys]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const parsedItems = parseItemsPayload(element.getAttribute("data-citation-items"));
          const itemKeys = parsedItems ? getItemKeys(parsedItems) : extractItemKeys(element);
          if (!itemKeys.length && (!parsedItems || parsedItems.length === 0)) return false;
          const items = parsedItems ?? buildLegacyItems(element, itemKeys);
          const href = element.getAttribute("href") || "";
          const dqid =
            element.getAttribute("data-dqid") ||
            element.getAttribute("data-quote-id") ||
            element.getAttribute("data-quote_id") ||
            (href.startsWith("dq://") ? href.slice("dq://".length) : null);
          return {
            citationId: element.getAttribute("data-citation-id") || null,
            items,
            renderedHtml: element.getAttribute("data-rendered-html") || element.innerHTML || "",
            hidden: parseBoolAttr(element.getAttribute("data-citation-hidden")) ?? false,
            dqid: dqid || null,
            title: element.getAttribute("title") || null
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const items = Array.isArray(HTMLAttributes.items) ? (HTMLAttributes.items as CitationItemRef[]) : [];
    const itemKeys = getItemKeys(items);
    const attrs = mergeAttributes(HTMLAttributes, {
      class: "leditor-citation-anchor",
      href: typeof HTMLAttributes.dqid === "string" && HTMLAttributes.dqid ? `dq://${HTMLAttributes.dqid}` : "#",
      "data-token": itemKeys.length ? formatToken(itemKeys) : undefined,
      "data-item-keys": itemKeys.length ? itemKeys.join(",") : undefined,
      "data-citation-items": JSON.stringify(items),
      "data-rendered-html": typeof HTMLAttributes.renderedHtml === "string" ? HTMLAttributes.renderedHtml : "",
      "data-citation-hidden": boolAttrString(HTMLAttributes.hidden)
    });
    if (typeof HTMLAttributes.dqid === "string" && HTMLAttributes.dqid) {
      attrs["data-dqid"] = HTMLAttributes.dqid;
    }
    if (typeof HTMLAttributes.title === "string" && HTMLAttributes.title) {
      attrs.title = HTMLAttributes.title;
    }
    if (HTMLAttributes.citationId) {
      attrs["data-citation-id"] = HTMLAttributes.citationId;
    }
    attrs.contenteditable = "false";
    return ["a", attrs, displayText(HTMLAttributes)];
  },
  addNodeView() {
    return citationNodeView;
  }
});

export default CitationNode;
