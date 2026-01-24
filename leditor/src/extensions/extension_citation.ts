import { Node, mergeAttributes } from "@tiptap/core";

const KEY_REGEX = /^[A-Z0-9]{8}$/;
const TOKEN_REGEX = /^item_keys=\[([A-Z0-9]{8}(?:,[A-Z0-9]{8})*)\]$/;
const formatToken = (keys: string[]): string => `item_keys=[${keys.join(",")}]`;
const boolAttrString = (value?: boolean | null): string | undefined => {
  if (value === true) return "1";
  if (value === false) return "0";
  return undefined;
};
const parseBoolAttr = (value: string | null): boolean | undefined => {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
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

const displayText = (attrs: Record<string, any>): string => {
  if (typeof attrs.rendered === "string" && attrs.rendered.trim().length > 0) {
    return attrs.rendered;
  }
  if (typeof attrs.label === "string" && attrs.label.trim().length > 0) {
    return attrs.label;
  }
  if (Array.isArray(attrs.itemKeys) && attrs.itemKeys.length) {
    return attrs.itemKeys.join(", ");
  }
  return "(citation)";
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
      itemKeys: { default: [] },
      locator: { default: null },
      label: { default: null },
      prefix: { default: null },
      suffix: { default: null },
      suppressAuthor: { default: false },
      authorOnly: { default: false },
      styleId: { default: null },
      locale: { default: null },
      rendered: { default: null }
    };
  },
  parseHTML() {
    return [
      {
        tag: "a.leditor-citation-anchor",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const itemKeys = extractItemKeys(element);
          if (!itemKeys.length) return false;
          return {
            citationId: element.getAttribute("data-citation-id") || null,
            itemKeys,
            locator: element.getAttribute("data-locator") || null,
            label: element.getAttribute("data-label") || null,
            prefix: element.getAttribute("data-prefix") || null,
            suffix: element.getAttribute("data-suffix") || null,
            suppressAuthor: parseBoolAttr(element.getAttribute("data-suppress-author")) ?? false,
            authorOnly: parseBoolAttr(element.getAttribute("data-author-only")) ?? false,
            styleId: element.getAttribute("data-style-id") || null,
            locale: element.getAttribute("data-locale") || null,
            rendered: element.textContent?.trim() || null
          };
        }
      },
      {
        tag: "a[data-item-keys]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const itemKeys = extractItemKeys(element);
          if (!itemKeys.length) return false;
          return {
            citationId: element.getAttribute("data-citation-id") || null,
            itemKeys,
            locator: element.getAttribute("data-locator") || null,
            label: element.getAttribute("data-label") || null,
            prefix: element.getAttribute("data-prefix") || null,
            suffix: element.getAttribute("data-suffix") || null,
            suppressAuthor: parseBoolAttr(element.getAttribute("data-suppress-author")) ?? false,
            authorOnly: parseBoolAttr(element.getAttribute("data-author-only")) ?? false,
            styleId: element.getAttribute("data-style-id") || null,
            locale: element.getAttribute("data-locale") || null,
            rendered: element.textContent?.trim() || null
          };
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, {
      class: "leditor-citation-anchor",
      href: "#",
      "data-token": Array.isArray(HTMLAttributes.itemKeys) ? formatToken(HTMLAttributes.itemKeys) : undefined,
      "data-item-keys": Array.isArray(HTMLAttributes.itemKeys) ? (HTMLAttributes.itemKeys as string[]).join(",") : undefined
    });
    if (HTMLAttributes.citationId) {
      attrs["data-citation-id"] = HTMLAttributes.citationId;
    }
    if (HTMLAttributes.locator) {
      attrs["data-locator"] = HTMLAttributes.locator;
    }
    if (HTMLAttributes.label) {
      attrs["data-label"] = HTMLAttributes.label;
    }
    if (HTMLAttributes.prefix) {
      attrs["data-prefix"] = HTMLAttributes.prefix;
    }
    if (HTMLAttributes.suffix) {
      attrs["data-suffix"] = HTMLAttributes.suffix;
    }
    const suppress = boolAttrString(HTMLAttributes.suppressAuthor);
    if (suppress !== undefined) {
      attrs["data-suppress-author"] = suppress;
    }
    const authorOnly = boolAttrString(HTMLAttributes.authorOnly);
    if (authorOnly !== undefined) {
      attrs["data-author-only"] = authorOnly;
    }
    if (HTMLAttributes.styleId) {
      attrs["data-style-id"] = HTMLAttributes.styleId;
    }
    if (HTMLAttributes.locale) {
      attrs["data-locale"] = HTMLAttributes.locale;
    }
    attrs.contenteditable = "false";
    return ["a", attrs, displayText(HTMLAttributes)];
  }
});

export default CitationNode;
