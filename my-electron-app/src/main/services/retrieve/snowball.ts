import type { RetrieveCitationNetwork, RetrieveRecord } from "../../../shared/types/retrieve";
import { getProviderSpec } from "./providers";
import { sanitizeSecret } from "./util";

const SEMANTIC_API_BASE = "https://api.semanticscholar.org/graph/v1";

const buildHeaders = (): Record<string, string> => {
  const apiKey =
    sanitizeSecret(process.env.SEMANTIC_API) || sanitizeSecret(process.env.SEMANTIC_SCHOLAR_API_KEY) || "";
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
};

const extractId = (record: RetrieveRecord): string | null => {
  if (record.paperId) return record.paperId;
  if (record.doi) return record.doi;
  const externalIds = record.externalIds ?? {};
  const candidates = [
    externalIds.doi,
    externalIds.DOI,
    externalIds.Crossref,
    externalIds.PubMed,
    externalIds.PMID,
    externalIds.ArXiv,
    externalIds.arxivId,
    externalIds.S2PaperId,
    externalIds.paperId
  ].filter(Boolean) as string[];
  if (candidates.length) return candidates[0];
  return null;
};

const mapNodesEdges = (
  seed: RetrieveRecord,
  items: Array<Record<string, any>>,
  direction: "references" | "citations"
): RetrieveCitationNetwork => {
  const nodes: RetrieveCitationNetwork["nodes"] = [];
  const edges: RetrieveCitationNetwork["edges"] = [];

  nodes.push({
    id: seed.paperId ?? seed.doi ?? "seed",
    label: seed.title ?? "Untitled",
    authors: seed.authors?.slice(0, 3).join(", "),
    year: seed.year,
    type: "selected" as const,
    citationCount: seed.citationCount
  });

  items.forEach((item, idx) => {
    const pid = item.paperId || item.doi || `${direction}-${idx}`;
    nodes.push({
      id: pid,
      label: item.title || pid,
      authors: Array.isArray(item.authors) ? item.authors.map((a: any) => a.name).slice(0, 3).join(", ") : "",
      year: item.year,
      type: direction === "references" ? "reference" : "cited",
      citationCount: item.citationCount
    });
    edges.push({
      id: `e-${idx}`,
      source: direction === "references" ? seed.paperId ?? seed.doi ?? "seed" : pid,
      target: direction === "references" ? pid : seed.paperId ?? seed.doi ?? "seed",
      weight: 1
    });
  });

  return { nodes, edges, contexts: [] };
};

export const fetchSemanticSnowball = async (
  record: RetrieveRecord,
  direction: "references" | "citations"
): Promise<RetrieveCitationNetwork> => {
  const id = extractId(record);
  if (!id) {
    throw new Error("Record missing paperId/doi for snowball.");
  }
  const headers = buildHeaders();
  const url = `${SEMANTIC_API_BASE}/paper/${encodeURIComponent(id)}/${direction}`;
  const params = new URLSearchParams({
    limit: "100",
    fields:
      "paperId,title,year,authors,externalIds,url,doi,citationCount,referenceCount,influentialCitationCount,isOpenAccess,openAccessPdf"
  });
  const response = await fetch(`${url}?${params.toString()}`, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Snowball failed (${response.status}): ${body.slice(0, 200)}`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return mapNodesEdges(record, items, direction);
};
