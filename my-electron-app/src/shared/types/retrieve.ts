export type RetrieveProviderId =
  | "semantic_scholar"
  | "crossref"
  | "openalex"
  | "elsevier"
  | "wos"
  | "unpaywall"
  | "cos";

export type RetrieveSort = "relevance" | "year";

export interface RetrieveQuery {
  query: string;
  year_from?: number;
  year_to?: number;
  sort?: RetrieveSort;
  limit?: number;
  cursor?: string;
  offset?: number;
  page?: number;
  provider?: RetrieveProviderId;
}

export interface RetrieveRecord {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  url?: string;
  abstract?: string;
  source: RetrieveProviderId;
  citationCount?: number;
  openAccess?: {
    status?: "open" | "closed" | "unknown";
    license?: string;
    url?: string;
  };
  paperId: string;
}

export interface RetrievePaperSnapshot {
  paperId: string;
  title?: string;
  doi?: string;
  url?: string;
  source?: RetrieveProviderId;
  year?: number;
}

export interface RetrieveSearchResult {
  provider: RetrieveProviderId;
  items: RetrieveRecord[];
  total: number;
  nextCursor?: string | number | null;
}
