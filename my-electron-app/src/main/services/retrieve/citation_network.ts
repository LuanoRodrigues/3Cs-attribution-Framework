import type { RetrieveCitationNetwork, RetrieveRecord } from "../../../shared/types/retrieve";

const sanitizeTitle = (text?: string): string => {
  if (!text) {
    return "Untitled";
  }
  return text.length > 50 ? `${text.slice(0, 47)}…` : text;
};

const createContexts = (edges: RetrieveCitationNetwork["edges"]): RetrieveCitationNetwork["contexts"] =>
  edges.map((edge) => ({
    nodeId: edge.target,
    context: edge.context ?? "",
    citation_anchor: edge.citation_anchor ?? "",
    citation_type: edge.citation_type ?? "",
    page_index: edge.page_index
  }));

// Placeholder backend implementation: keeps the contract stable while the real
// citation/reference fetching pipeline is integrated.
export const buildCitationNetwork = (record: RetrieveRecord): RetrieveCitationNetwork => {
  const baseId = record.paperId;
  const mainNode = {
    id: baseId,
    label: sanitizeTitle(record.title),
    authors: record.authors?.slice(0, 3).join(", ") ?? "Unknown authors",
    year: record.year,
    type: "selected" as const,
    citationCount: record.citationCount
  };
  const nodes = [
    mainNode,
    {
      id: `${baseId}-ref-1`,
      label: "Reference stub 1",
      authors: "Unknown",
      year: record.year ? record.year - 2 : undefined,
      type: "reference" as const
    },
    {
      id: `${baseId}-ref-2`,
      label: "Reference stub 2",
      authors: "Unknown",
      year: record.year ? record.year - 1 : undefined,
      type: "reference" as const
    },
    {
      id: `${baseId}-cited-1`,
      label: "Cited-by stub 1",
      authors: "Unknown",
      year: record.year ? record.year + 1 : undefined,
      type: "cited" as const
    }
  ];
  const edges = [
    {
      id: `${baseId}-edge-1`,
      source: baseId,
      target: `${baseId}-ref-1`,
      weight: 1,
      citation_anchor: "Stub (ref 1)",
      citation_type: "cites"
    },
    {
      id: `${baseId}-edge-2`,
      source: baseId,
      target: `${baseId}-ref-2`,
      weight: 1,
      citation_anchor: "Stub (ref 2)",
      citation_type: "cites"
    },
    {
      id: `${baseId}-edge-3`,
      source: `${baseId}-cited-1`,
      target: baseId,
      weight: 1,
      citation_anchor: "Stub (cited-by 1)",
      citation_type: "is_cited_by"
    }
  ];
  const contexts = createContexts(edges);
  return { nodes, edges, contexts };
};

