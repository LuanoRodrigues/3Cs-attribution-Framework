export type CitationItemRef = {
  itemKey: string;
  locator?: string | null;
  label?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  suppressAuthor?: boolean;
  authorOnly?: boolean;
};

export type CitationNode = {
  type: "citation";
  citationId: string;
  items: CitationItemRef[];
  renderedHtml: string;
  noteIndex?: number;
};

export type BibliographyNode = {
  type: "bibliography";
  bibId: string;
  renderedHtml: string;
};

export type DocCitationMeta = {
  styleId: string;
  locale: string;
};
