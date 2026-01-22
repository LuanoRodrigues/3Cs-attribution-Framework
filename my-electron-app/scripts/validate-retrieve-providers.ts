import type { RetrieveProviderId, RetrieveQuery } from "../src/shared/types/retrieve";
import { getProviderSpec } from "../src/main/services/retrieve/providers";

const defaultQuery: RetrieveQuery = {
  query: "cyber attribution",
  year_from: 2020,
  year_to: 2024,
  limit: 5,
  sort: "relevance"
};
const doiQuery: RetrieveQuery = {
  query: "10.1038/nature12345"
};

const tests: Array<{ id: RetrieveProviderId; query: RetrieveQuery }> = [
  { id: "semantic_scholar", query: defaultQuery },
  { id: "crossref", query: defaultQuery },
  { id: "openalex", query: defaultQuery },
  { id: "elsevier", query: defaultQuery },
  { id: "wos", query: defaultQuery },
  { id: "unpaywall", query: doiQuery }
];

const ensureUrl = (value: string): string => {
  if (!value.startsWith("https://")) {
    throw new Error(`Expected https:// url but got ${String(value)}`);
  }
  return value;
};

for (const test of tests) {
  const spec = getProviderSpec(test.id);
  if (!spec) {
    throw new Error(`Missing provider spec for ${test.id}`);
  }
  if (!spec.buildRequest) {
    throw new Error(`Provider ${test.id} is missing buildRequest`);
  }
  const request = spec.buildRequest(test.query);
  if (!request) {
    throw new Error(`Provider ${test.id} returned no request`);
  }
  const requestUrl: string = request.url;
  ensureUrl(requestUrl);
  if (test.id === "semantic_scholar") {
    const keyHeader = request.headers?.["x-api-key"];
    if (typeof keyHeader !== "string" || !keyHeader) {
      throw new Error("Semantic Scholar request missing API key header");
    }
  }
  if (test.id === "elsevier") {
    const keyHeader = request.headers?.["X-ELS-APIKey"];
    if (typeof keyHeader !== "string" || !keyHeader) {
      throw new Error("Elsevier request missing API key header");
    }
  }
}

console.info("Retrieve providers validation passed");
