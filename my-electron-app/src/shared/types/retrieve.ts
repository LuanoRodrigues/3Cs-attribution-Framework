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
  author_contains?: string;
  venue_contains?: string;
  only_doi?: boolean;
  only_abstract?: boolean;
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

export interface RetrieveCitationNode {
  id: string;
  label: string;
  authors?: string;
  year?: number;
  type?: "selected" | "reference" | "cited";
  citationCount?: number;
}

export interface RetrieveCitationEdge {
  id: string;
  source: string;
  target: string;
  weight?: number;
  context?: string;
  citation_anchor?: string;
  citation_type?: string;
  page_index?: number;
}

export interface RetrieveCitationContext {
  nodeId: string;
  context: string;
  citation_anchor: string;
  citation_type: string;
  page_index?: number;
}

export interface RetrieveCitationNetwork {
  nodes: RetrieveCitationNode[];
  edges: RetrieveCitationEdge[];
  contexts: RetrieveCitationContext[];
}

export interface RetrieveCitationNetworkRequest {
  record: RetrieveRecord;
}
