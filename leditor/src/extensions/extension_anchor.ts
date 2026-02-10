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
          const parseEmbeddedMeta = (hrefRaw: string | null) => {
            if (!hrefRaw) return { href: hrefRaw, meta: null };
            const hashIndex = hrefRaw.indexOf("#");
            if (hashIndex < 0) return { href: hrefRaw, meta: null };
            const base = hrefRaw.slice(0, hashIndex);
            const fragment = hrefRaw.slice(hashIndex + 1);
            if (!fragment) return { href: hrefRaw, meta: null };
            const parts = fragment.split("&").filter(Boolean);
            let metaRaw: string | null = null;
            const kept: string[] = [];
            for (const part of parts) {
              if (part.startsWith("leditor=")) {
                metaRaw = part.slice("leditor=".length);
                continue;
              }
              kept.push(part);
            }
            let meta: Record<string, unknown> | null = null;
            if (metaRaw) {
              try {
                const decoded = decodeURIComponent(metaRaw);
                const parsed = JSON.parse(decoded);
                if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
              } catch {
                meta = null;
              }
            }
            const rebuilt = kept.length ? `${base}#${kept.join("&")}` : base;
            return { href: rebuilt || hrefRaw, meta };
          };

          const { href, meta } = parseEmbeddedMeta(node.getAttribute("href"));
          const dqid =
            (meta?.dataDqid as string | undefined) ||
            node.getAttribute("data-dqid") ||
            node.getAttribute("data-quote-id") ||
            node.getAttribute("data-quote_id") ||
            "";
          const titleAttr = node.getAttribute("title");
          return {
            href,
            title: titleAttr || (meta?.title ? String(meta.title) : null),
            target: node.getAttribute("target"),
            rel: node.getAttribute("rel"),
            name: node.getAttribute("name"),
            id: node.getAttribute("id"),
            dataKey: (meta?.dataKey as string | undefined) || node.getAttribute("data-key"),
            dataOrigHref: (meta?.dataOrigHref as string | undefined) || node.getAttribute("data-orig-href"),
            dataQuoteId:
              (meta?.dataQuoteId as string | undefined) ||
              node.getAttribute("data-quote-id") ||
              node.getAttribute("data-quote_id"),
            dataDqid: dqid,
            dataQuoteText: (meta?.dataQuoteText as string | undefined) || node.getAttribute("data-quote-text"),
            itemKey: (meta?.itemKey as string | undefined) || node.getAttribute("item-key"),
            dataItemKey: (meta?.dataItemKey as string | undefined) || node.getAttribute("data-item-key")
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
