import type { BibliographyNode, CitationItemRef, CitationNode, DocCitationMeta } from "./types.ts";
import { getReferencesLibrarySync } from "../ui/references/library.ts";

export const buildCitationItems = (
  itemKeys: string[],
  options: {
    prefix?: string | null;
    locator?: string | null;
    label?: string | null;
    suffix?: string | null;
    suppressAuthor?: boolean;
    authorOnly?: boolean;
  }
): CitationItemRef[] =>
  itemKeys.map((itemKey) => ({
    itemKey,
    prefix: options.prefix ?? null,
    locator: options.locator ?? null,
    label: options.label ?? null,
    suffix: options.suffix ?? null,
    suppressAuthor: Boolean(options.suppressAuthor),
    authorOnly: Boolean(options.authorOnly)
  }));

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const splitAuthors = (raw: string): string[] => {
  const text = (raw || "").trim();
  if (!text) return [];
  return text
    .split(/;| and /i)
    .map((part) => part.trim())
    .filter(Boolean);
};

const isNumericStyle = (styleId: string): boolean => {
  const style = (styleId || "").toLowerCase();
  if (!style) return false;
  if (style.includes("numeric")) return true;
  return style === "vancouver" || style === "ieee" || style === "nature" || style === "oscola";
};

const formatApaInText = (itemKey: string): string => {
  const library = getReferencesLibrarySync();
  const item = library.itemsByKey[itemKey];
  if (!item) return itemKey;
  const authors = splitAuthors(item.author || "");
  const author = authors[0] || item.author || itemKey;
  const year = item.year || "";
  if (author && year) return `${author}, ${year}`;
  return author || year || itemKey;
};

const formatAuthorOnly = (itemKey: string): string => {
  const library = getReferencesLibrarySync();
  const item = library.itemsByKey[itemKey];
  if (!item) return itemKey;
  const authors = splitAuthors(item.author || "");
  const author = authors[0] || item.author || itemKey;
  return author || itemKey;
};

const renderCitationHtml = (
  node: CitationNode,
  meta: DocCitationMeta,
  numberByKey?: Map<string, number>
): string => {
  if (typeof node.noteIndex === "number") {
    return `<sup class="leditor-citation-note">${node.noteIndex}</sup>`;
  }
  const style = (meta.styleId || "").toLowerCase();
  if (style.includes("apa")) {
    const label = node.items.map((item) => formatApaInText(item.itemKey)).join("; ");
    return `<span class="leditor-citation-rendered">(${escapeHtml(label)})</span>`;
  }
  if (style.includes("modern-language-association") || style === "mla") {
    const label = node.items.map((item) => formatAuthorOnly(item.itemKey)).join("; ");
    return `<span class="leditor-citation-rendered">(${escapeHtml(label)})</span>`;
  }
  if (isNumericStyle(style)) {
    const numbers = node.items
      .map((item) => numberByKey?.get(item.itemKey))
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const label = numbers.length ? numbers.join(", ") : node.items.map((item) => item.itemKey).join(", ");
    return `<span class="leditor-citation-rendered">[${escapeHtml(label)}]</span>`;
  }
  const label = node.items.map((item) => item.itemKey).join(", ");
  return `<span class="leditor-citation-rendered">(${escapeHtml(label)})</span>`;
};

const renderBibliographyHtml = (
  items: string[],
  meta: DocCitationMeta,
  numberByKey?: Map<string, number>
): string => {
  if (!items.length) return "";
  const style = (meta.styleId || "").toLowerCase();
  const library = getReferencesLibrarySync();
  const rows = items
    .map((itemKey) => {
      const item = library.itemsByKey[itemKey];
      if (!item) {
        return `<li>${escapeHtml(itemKey)}</li>`;
      }
      if (style.includes("apa")) {
        const authors = splitAuthors(item.author || "");
        const author = authors.join(", ") || item.author || itemKey;
        const year = item.year ? `(${escapeHtml(item.year)})` : "";
        const title = item.title ? escapeHtml(item.title) : escapeHtml(itemKey);
        const source = item.source ? escapeHtml(item.source) : "";
        const urlOrDoi = item.url ? escapeHtml(item.url) : "";
        const parts = [
          author ? `${escapeHtml(author)}.` : "",
          year ? ` ${year}.` : "",
          ` ${title}.`,
          source ? ` ${source}.` : "",
          urlOrDoi ? ` ${urlOrDoi}` : ""
        ]
          .join("")
          .trim();
        return `<li data-item-key="${escapeHtml(itemKey)}">${parts}</li>`;
      }
      if (isNumericStyle(style)) {
        const n = numberByKey?.get(itemKey);
        const prefix = typeof n === "number" ? `${n}. ` : "";
        const label = item.title || item.author || item.itemKey;
        return `<li data-item-key="${escapeHtml(itemKey)}">${escapeHtml(prefix + label)}</li>`;
      }
      const label = item.title || item.author || item.itemKey;
      return `<li data-item-key="${escapeHtml(itemKey)}">${escapeHtml(label)}</li>`;
    })
    .join("");
  return `<ol class="leditor-bibliography-list">${rows}</ol>`;
};

export const updateAllCitationsAndBibliography = (args: {
  doc: unknown;
  getDocCitationMeta: (doc: unknown) => DocCitationMeta;
  extractCitationNodes: (doc: unknown) => CitationNode[];
  additionalItemKeys?: string[];
  findBibliographyNode: (doc: unknown) => BibliographyNode | null;
  setCitationNodeRenderedHtml: (node: CitationNode, html: string) => void;
  setBibliographyRenderedHtml: (node: BibliographyNode, html: string) => void;
}) => {
  // Validate citation metadata first to surface schema issues early.
  const meta = args.getDocCitationMeta(args.doc);
  const citationNodes = args.extractCitationNodes(args.doc);
  const seen = new Set<string>();
  const orderedKeys: string[] = [];
  const numberByKey: Map<string, number> | undefined = isNumericStyle(meta.styleId || "")
    ? new Map<string, number>()
    : undefined;
  let nextNumber = 1;

  const registerKey = (key: string): void => {
    const normalized = (key || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    orderedKeys.push(normalized);
    if (numberByKey) {
      numberByKey.set(normalized, nextNumber);
      nextNumber += 1;
    }
  };

  citationNodes.forEach((node) => {
    node.items.forEach((item) => registerKey(item.itemKey));
    const html = renderCitationHtml(node, meta, numberByKey);
    args.setCitationNodeRenderedHtml(node, html);
  });
  (args.additionalItemKeys ?? []).forEach((key) => registerKey(key));
  const bibliography = args.findBibliographyNode(args.doc);
  if (bibliography) {
    const html = renderBibliographyHtml(orderedKeys, meta, numberByKey);
    args.setBibliographyRenderedHtml(bibliography, html);
  }
};
