import { Mark, mergeAttributes } from "@tiptap/core";

const AnchorMark = Mark.create({
  name: "anchor",
  inclusive: false,
  addAttributes() {
    return {
      href: { default: null },
      title: { default: null },
      target: { default: null },
      rel: { default: null },
      name: { default: null },
      id: { default: null },
      dataKey: { default: null },
      dataOrigHref: { default: null },
      dataQuoteId: { default: null },
      dataDqid: { default: null },
      dataQuoteText: { default: null },
      itemKey: { default: null },
      dataItemKey: { default: null }
    };
  },
  parseHTML() {
    return [
      {
        tag: "a",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const text = node.textContent ?? "";
          const hasHref = node.hasAttribute("href");
          const hasCitation =
            node.hasAttribute("data-key") ||
            node.hasAttribute("item-key") ||
            node.hasAttribute("data-item-key") ||
            node.hasAttribute("data-dqid") ||
            node.hasAttribute("data-quote-id") ||
            node.hasAttribute("data-quote_id");
          const hasName = node.hasAttribute("name") || node.hasAttribute("id");
          if (!hasHref && !hasCitation && hasName && text.trim().length === 0) {
            return false;
          }
          const dqid =
            node.getAttribute("data-dqid") ||
            node.getAttribute("data-quote-id") ||
            node.getAttribute("data-quote_id") ||
            "";
          return {
            href: node.getAttribute("href"),
            title: node.getAttribute("title"),
            target: node.getAttribute("target"),
            rel: node.getAttribute("rel"),
            name: node.getAttribute("name"),
            id: node.getAttribute("id"),
            dataKey: node.getAttribute("data-key"),
            dataOrigHref: node.getAttribute("data-orig-href"),
            dataQuoteId: node.getAttribute("data-quote-id") || node.getAttribute("data-quote_id"),
            dataDqid: dqid,
            dataQuoteText: node.getAttribute("data-quote-text"),
            itemKey: node.getAttribute("item-key"),
            dataItemKey: node.getAttribute("data-item-key")
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, string> = {};
    if (HTMLAttributes.href) {
      attrs.href = HTMLAttributes.href;
    } else if (HTMLAttributes.dataDqid) {
      attrs.href = `dq://${HTMLAttributes.dataDqid}`;
    }
    if (HTMLAttributes.title) attrs.title = HTMLAttributes.title;
    if (HTMLAttributes.target) attrs.target = HTMLAttributes.target;
    if (HTMLAttributes.rel) attrs.rel = HTMLAttributes.rel;
    if (HTMLAttributes.name) attrs.name = HTMLAttributes.name;
    if (HTMLAttributes.id) attrs.id = HTMLAttributes.id;
    if (HTMLAttributes.style) attrs.style = HTMLAttributes.style;
    if (HTMLAttributes.dataKey) attrs["data-key"] = HTMLAttributes.dataKey;
    if (HTMLAttributes.dataOrigHref) attrs["data-orig-href"] = HTMLAttributes.dataOrigHref;
    if (HTMLAttributes.dataQuoteId) attrs["data-quote-id"] = HTMLAttributes.dataQuoteId;
    if (HTMLAttributes.dataDqid) attrs["data-dqid"] = HTMLAttributes.dataDqid;
    if (HTMLAttributes.dataQuoteText) attrs["data-quote-text"] = HTMLAttributes.dataQuoteText;
    if (HTMLAttributes.itemKey) attrs["item-key"] = HTMLAttributes.itemKey;
    if (HTMLAttributes.dataItemKey) attrs["data-item-key"] = HTMLAttributes.dataItemKey;

    const isCitationAnchor = Boolean(
      HTMLAttributes.dataKey ||
        HTMLAttributes.itemKey ||
        HTMLAttributes.dataItemKey ||
        HTMLAttributes.dataDqid ||
        HTMLAttributes.dataQuoteId ||
        HTMLAttributes.dataQuoteText
    );
    const className = typeof HTMLAttributes.class === "string" ? HTMLAttributes.class : "";
    if (isCitationAnchor) {
      attrs["data-citation-anchor"] = "true";
      attrs.contenteditable = "false";
      attrs.class = className ? `${className} leditor-citation-anchor` : "leditor-citation-anchor";
    } else if (className) {
      attrs.class = className;
    }

    return ["a", mergeAttributes(attrs), 0];
  }
});

export default AnchorMark;
