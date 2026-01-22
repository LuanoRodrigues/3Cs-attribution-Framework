import type { RetrieveRecord } from "../../shared/types/retrieve";

export interface CitationNode {
  id: string;
  label: string;
  authors?: string;
  year?: number;
  type?: "selected" | "reference" | "cited";
  citationCount?: number;
}

export interface CitationEdge {
  id: string;
  source: string;
  target: string;
  weight?: number;
  context?: string;
  citation_anchor?: string;
  citation_type?: string;
  page_index?: number;
}

export interface CitationContext {
  nodeId: string;
  context: string;
  citation_anchor: string;
  citation_type: string;
  page_index?: number;
}

export interface CitationPayload {
  nodes: CitationNode[];
  edges: CitationEdge[];
  contexts: CitationContext[];
}

const sanitizeTitle = (text?: string): string => {
  if (!text) {
    return "Untitled";
  }
  return text.length > 50 ? `${text.slice(0, 47)}…` : text;
};

const createContexts = (edges: CitationEdge[]): CitationContext[] =>
  edges.map((edge) => ({
    nodeId: edge.target,
    context: edge.context ?? "",
    citation_anchor: edge.citation_anchor ?? "",
    citation_type: edge.citation_type ?? "",
    page_index: edge.page_index
  }));

export const buildCitationPayload = (record?: RetrieveRecord): CitationPayload => {
  const baseId = record?.paperId ?? "active";
  const label = sanitizeTitle(record?.title);
  const mainNode: CitationNode = {
    id: baseId,
    label,
    authors: record?.authors?.slice(0, 3).join(", ") ?? "Unknown authors",
    year: record?.year ?? 2024,
    type: "selected",
    citationCount: record?.citationCount
  };
  const references: CitationNode[] = [
    {
      id: `${baseId}-ref-1`,
      label: "Evidence-based attribution framework",
      authors: "Smith et al.",
      year: 2020,
      type: "reference"
    },
    {
      id: `${baseId}-ref-2`,
      label: "Review of citation merging",
      authors: "Lopez & Vega",
      year: 2022,
      type: "reference"
    },
    {
      id: `${baseId}-cited-1`,
      label: "Cited in policy narrative",
      authors: "Nguyen & Patel",
      year: 2023,
      type: "cited"
    }
  ];
  const nodes = [mainNode, ...references];
  const edges: CitationEdge[] = [
    {
      id: `${baseId}-edge-1`,
      source: baseId,
      target: references[0].id,
      weight: 1.2,
      context: "Builds on the method described in Example 1",
      citation_anchor: "Smith et al. (2020)",
      citation_type: "cites",
      page_index: 12
    },
    {
      id: `${baseId}-edge-2`,
      source: baseId,
      target: references[1].id,
      weight: 1,
      context: "Compares performance metrics for the merged search",
      citation_anchor: "Lopez & Vega (2022)",
      citation_type: "cites",
      page_index: 5
    },
    {
      id: `${baseId}-edge-3`,
      source: references[2].id,
      target: baseId,
      weight: 0.8,
      context: "Uses the merged dataset to justify policy guidance",
      citation_anchor: "Nguyen & Patel (2023)",
      citation_type: "is_cited_by",
      page_index: 22
    }
  ];
  const contexts = createContexts(edges);
  return { nodes, edges, contexts };
};
