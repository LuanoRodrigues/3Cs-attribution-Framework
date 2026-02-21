export type FeatureArg = {
  key?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
};

export type FeatureDescriptor = {
  id: string;
  tab: string;
  group: string;
  functionName: string;
  label: string;
  args?: FeatureArg[];
};

const BASE_FEATURES: FeatureDescriptor[] = [
  { id: "coding.open_coding", tab: "Coding", group: "Open Coding", functionName: "open_coding", label: "Open Coding" },
  { id: "coding.verbatim", tab: "Coding", group: "Open Coding", functionName: "Verbatim_Evidence_Coding", label: "Verbatim Evidence Coding" },
  { id: "screen.set_eligibility_criteria", tab: "Screening", group: "Screen", functionName: "set_eligibility_criteria", label: "Set Eligibility Criteria" },
  { id: "screen.screening_articles", tab: "Screening", group: "Screen", functionName: "screening_articles", label: "Screening Articles" },
  { id: "screen.classify_by_title", tab: "Screening", group: "Classify", functionName: "classify_by_title", label: "Classify by Title" },
  { id: "workflow.enqueue_topic", tab: "Workflow", group: "Topic Workflow", functionName: "enqueue_topic_classification_for_collection", label: "Enqueue Topic Classification" },
  { id: "workflow.apply_topic", tab: "Workflow", group: "Topic Workflow", functionName: "apply_topic_batch_results", label: "Apply Topic Batch Results" },
  { id: "workflow.collect_topic", tab: "Workflow", group: "Topic Workflow", functionName: "collect_after_enqueue", label: "Collect Topic Batch Results" },
  { id: "workflow.keyword_multi", tab: "Workflow", group: "Topic Workflow", functionName: "keyword_analysis_multi", label: "Keyword Analysis Multi" },
  { id: "extract.get_item_payload", tab: "Extraction", group: "Payload", functionName: "get_item_payload", label: "Get Item Payload" },
  { id: "export.export_collection_to_csv", tab: "Export & Files", group: "Export", functionName: "export_collection_to_csv", label: "Export Collection to CSV" }
];

type SignatureMap = Record<string, { functionName?: string; args?: FeatureArg[] }>;

export function mergeWithSignatures(signatureMap: SignatureMap): FeatureDescriptor[] {
  return BASE_FEATURES.map((feature) => {
    const sig = signatureMap?.[feature.functionName] || null;
    return {
      ...feature,
      args: Array.isArray(sig?.args) ? sig.args : []
    };
  });
}

export function groupedFeatures(signatureMap: SignatureMap): Array<{ tab: string; groups: Array<{ group: string; features: FeatureDescriptor[] }> }> {
  const merged = mergeWithSignatures(signatureMap);
  const tabs = new Map<string, Map<string, FeatureDescriptor[]>>();
  merged.forEach((feature) => {
    if (!tabs.has(feature.tab)) tabs.set(feature.tab, new Map());
    const groups = tabs.get(feature.tab)!;
    if (!groups.has(feature.group)) groups.set(feature.group, []);
    groups.get(feature.group)!.push(feature);
  });
  return Array.from(tabs.entries()).map(([tab, groups]) => ({
    tab,
    groups: Array.from(groups.entries()).map(([group, features]) => ({ group, features }))
  }));
}

export function getFeatureByFunctionName(functionName: string, signatureMap: SignatureMap): FeatureDescriptor | null {
  const merged = mergeWithSignatures(signatureMap);
  return merged.find((feature) => feature.functionName === functionName) || null;
}
