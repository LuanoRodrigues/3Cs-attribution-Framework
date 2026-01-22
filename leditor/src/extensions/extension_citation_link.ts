import { mergeAttributes } from "@tiptap/core";
import Link from "@tiptap/extension-link";

const ALLOWED_PROTOCOLS = new Set(["dq", "cite", "citegrp", "http", "https", "mailto", "file"]);

const isAllowedCitationHref = (href: string | null): boolean => {
  const raw = (href ?? "").trim();
  if (!raw) return false;
  if (raw.startsWith("#")) return true;
  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!schemeMatch) return true;
  return ALLOWED_PROTOCOLS.has(schemeMatch[1].toLowerCase());
};

const CitationLink = Link.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      autolink: false,
      linkOnPaste: false,
      openOnClick: false,
      protocols: ["dq", "http", "https", "mailto", "file", "cite", "citegrp"],
      validate: () => true,
      isAllowedUri: (href) => isAllowedCitationHref(href)
    };
  },
  parseHTML() {
    return [
      {
        tag: "a",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const href = node.getAttribute("href");
          const hasCitation =
            node.hasAttribute("data-key") ||
            node.hasAttribute("item-key") ||
            node.hasAttribute("data-item-key") ||
            node.hasAttribute("data-dqid") ||
            node.hasAttribute("data-quote-id") ||
            node.hasAttribute("data-quote_id");
          if (!href && !hasCitation) return false;
          if (href && !isAllowedCitationHref(href)) return false;
          return null;
        }
      }
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      dataKey: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).getAttribute("data-key"),
        renderHTML: (attrs) => (attrs.dataKey ? { "data-key": attrs.dataKey } : {})
      },
      dataOrigHref: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).getAttribute("data-orig-href"),
        renderHTML: (attrs) => (attrs.dataOrigHref ? { "data-orig-href": attrs.dataOrigHref } : {})
      },
      dataQuoteId: {
        default: null,
        parseHTML: (element) =>
          (element as HTMLElement).getAttribute("data-quote-id") ||
          (element as HTMLElement).getAttribute("data-quote_id"),
        renderHTML: (attrs) => (attrs.dataQuoteId ? { "data-quote-id": attrs.dataQuoteId } : {})
      },
      dataDqid: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).getAttribute("data-dqid"),
        renderHTML: (attrs) => (attrs.dataDqid ? { "data-dqid": attrs.dataDqid } : {})
      },
      itemKey: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).getAttribute("item-key"),
        renderHTML: (attrs) => (attrs.itemKey ? { "item-key": attrs.itemKey } : {})
      },
      dataItemKey: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).getAttribute("data-item-key"),
        renderHTML: (attrs) => (attrs.dataItemKey ? { "data-item-key": attrs.dataItemKey } : {})
      }
    };
  },
  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
    const isCitationAnchor = Boolean(
      HTMLAttributes.dataKey ||
        HTMLAttributes.itemKey ||
        HTMLAttributes.dataItemKey ||
        HTMLAttributes.dataDqid ||
        HTMLAttributes.dataQuoteId
    );
    const className = typeof attrs.class === "string" ? attrs.class : "";
    if (isCitationAnchor) {
      attrs["data-citation-anchor"] = "true";
      attrs.contenteditable = "false";
      attrs.class = className ? `${className} leditor-citation-anchor` : "leditor-citation-anchor";
    }
    return ["a", attrs, 0];
  }
});

export default CitationLink;
