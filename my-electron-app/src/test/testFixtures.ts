/**
 * Fixtures borrowed from earlier Python prototypes:
 * - `annotarium_package/Z_Corpus_analysis/PDF_widget.py` for the PDF payload schema.
 * - `annotarium_package/Z_Corpus_analysis/Coder.py` for the coder statuses and tree hints.
 */

export interface PdfTestPayload {
  item_key: string;
  pdf_path: string;
  pdf?: string;
  url: string;
  author_summary: string;
  first_author_last: string;
  year: string;
  title: string;
  source: string;
  page: number;
  section_title: string;
  section_text: string;
  rq_question: string;
  overarching_theme: string;
  gold_theme: string;
  route: string;
  theme: string;
  potential_theme: string;
  evidence_type: string;
  evidence_type_norm: string;
  direct_quote: string;
  direct_quote_clean: string;
  paraphrase: string;
  researcher_comment: string;
}

export interface CoderTestNode {
  label: string;
  status: "Included" | "Maybe" | "Excluded";
  detail: string;
  children?: CoderTestNode[];
}

const TEST_PDF_PATH =
  "C:\\Users\\luano\\Zotero\\storage\\5MYV4X6F\\Williamson - 2024 - Do Proxies Provide Plausible Deniability Evidence from Experiments on Three Surveys.pdf";

export function createPdfTestPayload(): PdfTestPayload {
  return {
    item_key: "test-0001",
    pdf_path: TEST_PDF_PATH,
    url: "https://doi.org/10.1234/example",
    author_summary: "Williamson et al. explore proxy indicators for deniability in controlled surveys.",
    first_author_last: "Williamson",
    year: "2024",
    title: "Do Proxies Provide Plausible Deniability Evidence from Experiments on Three Surveys",
    source: "Empirical Surveys Archive",
    page: 4,
    section_title: "Proxy design and manipulation",
    section_text:
      "We evaluated whether proxies introduced into online surveys could be isolated from the respondents' trust cues.",
    rq_question: "Does adding proxy cues alter the interpretation of survey evidence?",
    overarching_theme: "Evidence Validity",
    gold_theme: "Proxy Effects",
    route: "analysis/pdf",
    theme: "Proxy Resilience",
    potential_theme: "Survey Credibility",
    evidence_type: "Experimental",
    evidence_type_norm: "exp",
    direct_quote: "\"Proxies can often shield subjects from the experimental intervention.\"",
    direct_quote_clean: "Proxies can often shield subjects from the experimental intervention.",
    paraphrase: "The study shows that proxies alter how participants perceive manipulations.",
    researcher_comment: "Use the next pages to verify the new viewer's framing and navigation controls."
  };
}

export function createCoderTestTree(): CoderTestNode[] {
  return [
    {
      label: "Data Handling",
      status: "Included",
      detail: "Confirmed protocols for anonymizing proxy responses.",
      children: [
        {
          label: "Consent proofs",
          status: "Included",
          detail: "Signed forms stored alongside the dataset."
        },
        {
          label: "Proxy labeling",
          status: "Maybe",
          detail: "Investigate whether the proxy tags remain consistent across waves."
        }
      ]
    },
    {
      label: "Survey Fidelity",
      status: "Maybe",
      detail: "Responses show drift in the third wave.",
      children: [
        {
          label: "Third wave sample",
          status: "Maybe",
          detail: "Need to confirm if the proxy cues influenced drop-off rates."
        },
        {
          label: "Replication plan",
          status: "Excluded",
          detail: "Replication was deferred due to budget."
        }
      ]
    },
    {
      label: "Coding heuristics",
      status: "Excluded",
      detail: "Legacy heuristic will be retired after the pilot."
    }
  ];
}
