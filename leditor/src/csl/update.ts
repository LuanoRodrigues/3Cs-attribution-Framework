import type { BibliographyNode, CitationItemRef, CitationNode, DocCitationMeta } from "./types.ts";

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

const renderCitationHtml = (node: CitationNode): string => {
  if (typeof node.noteIndex === "number") {
    return `<sup class="leditor-citation-note">${node.noteIndex}</sup>`;
  }
  const label = node.items.map((item) => item.itemKey).join(", ");
  return `<span class="leditor-citation-rendered">(${escapeHtml(label)})</span>`;
};

const renderBibliographyHtml = (items: string[]): string => {
  if (!items.length) return "";
  const rows = items.map((itemKey) => `<li>${escapeHtml(itemKey)}</li>`).join("");
  return `<ol class="leditor-bibliography-list">${rows}</ol>`;
};

export const updateAllCitationsAndBibliography = (args: {
  doc: unknown;
  getDocCitationMeta: (doc: unknown) => DocCitationMeta;
  extractCitationNodes: (doc: unknown) => CitationNode[];
  findBibliographyNode: (doc: unknown) => BibliographyNode | null;
  setCitationNodeRenderedHtml: (node: CitationNode, html: string) => void;
  setBibliographyRenderedHtml: (node: BibliographyNode, html: string) => void;
}) => {
  // Validate citation metadata first to surface schema issues early.
  args.getDocCitationMeta(args.doc);
  const citationNodes = args.extractCitationNodes(args.doc);
  const itemKeys = new Set<string>();
  citationNodes.forEach((node) => {
    node.items.forEach((item) => itemKeys.add(item.itemKey));
    const html = renderCitationHtml(node);
    args.setCitationNodeRenderedHtml(node, html);
  });
  const bibliography = args.findBibliographyNode(args.doc);
  if (bibliography) {
    const html = renderBibliographyHtml(Array.from(itemKeys));
    args.setBibliographyRenderedHtml(bibliography, html);
  }
};
