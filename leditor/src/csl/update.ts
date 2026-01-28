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

const renderCitationHtml = (node: CitationNode, meta: DocCitationMeta): string => {
  if (typeof node.noteIndex === "number") {
    return `<sup class="leditor-citation-note">${node.noteIndex}</sup>`;
  }
  const style = (meta.styleId || "").toLowerCase();
  if (style.includes("apa")) {
    const label = node.items.map((item) => formatApaInText(item.itemKey)).join("; ");
    return `<span class="leditor-citation-rendered">(${escapeHtml(label)})</span>`;
  }
  if (style.includes("numeric") || style.includes("nature")) {
    // Lightweight numeric fallback: show keys (the registry provides stable numbering elsewhere).
    const label = node.items.map((item) => item.itemKey).join(", ");
    return `<span class="leditor-citation-rendered">[${escapeHtml(label)}]</span>`;
  }
  const label = node.items.map((item) => item.itemKey).join(", ");
  return `<span class="leditor-citation-rendered">(${escapeHtml(label)})</span>`;
};

const renderBibliographyHtml = (items: string[], meta: DocCitationMeta): string => {
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
  const itemKeys = new Set<string>();
  citationNodes.forEach((node) => {
    node.items.forEach((item) => itemKeys.add(item.itemKey));
    const html = renderCitationHtml(node, meta);
    args.setCitationNodeRenderedHtml(node, html);
  });
  (args.additionalItemKeys ?? []).forEach((key) => {
    const normalized = (key || "").trim();
    if (normalized) itemKeys.add(normalized);
  });
  const bibliography = args.findBibliographyNode(args.doc);
  if (bibliography) {
    const html = renderBibliographyHtml(Array.from(itemKeys), meta);
    args.setBibliographyRenderedHtml(bibliography, html);
  }
};
