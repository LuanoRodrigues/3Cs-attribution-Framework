const BASE_FEATURES = [
  { id: "coding.open_coding", tab: "Coding", group: "Open Coding", functionName: "open_coding", label: "Open Coding" },

  { id: "kw.keyword_analysis", tab: "Keywords & Themes", group: "Keyword Passes", functionName: "keyword_analysis", label: "Keyword Analysis" },
  { id: "kw.keyword_analysis_multi", tab: "Keywords & Themes", group: "Keyword Passes", functionName: "keyword_analysis_multi", label: "Keyword Analysis Multi" },
  { id: "kw.keyword_html_first_pass", tab: "Keywords & Themes", group: "Keyword Passes", functionName: "keyword_html_first_pass", label: "Keyword HTML First Pass" },
  { id: "kw.consolidate_keyword_batches", tab: "Keywords & Themes", group: "Consolidation", functionName: "consolidate_keyword_batches", label: "Consolidate Keyword Batches" },
  { id: "kw.consolidate_keyword_batches_html", tab: "Keywords & Themes", group: "Consolidation", functionName: "consolidate_keyword_batches_html", label: "Consolidate Keyword Batches HTML" },
  { id: "kw.run_store_only_then_collect", tab: "Keywords & Themes", group: "Consolidation", functionName: "run_store_only_then_collect", label: "Run Store-Only Then Collect" },
  { id: "kw.build_thematic_section_after_collect", tab: "Keywords & Themes", group: "Thematic Build", functionName: "build_thematic_section_after_collect", label: "Build Thematic Section After Collect" },
  { id: "kw.thematic_section_from_consolidated_html", tab: "Keywords & Themes", group: "Thematic Build", functionName: "thematic_section_from_consolidated_html", label: "Thematic Section from Consolidated HTML" },

  { id: "extract.extract_entity_affiliation", tab: "Extraction", group: "Entities", functionName: "extract_entity_affiliation", label: "Extract Entity Affiliation" },
  { id: "extract.extract_na", tab: "Extraction", group: "NA", functionName: "extract_na", label: "Extract NA" },
  { id: "extract.extract_na_flat", tab: "Extraction", group: "NA", functionName: "extract_na_flat", label: "Extract NA Flat" },
  { id: "extract.get_item_payload", tab: "Extraction", group: "Payload", functionName: "get_item_payload", label: "Get Item Payload" },

  { id: "screen.set_eligibility_criteria", tab: "Screening", group: "Screen", functionName: "set_eligibility_criteria", label: "Set Eligibility Criteria" },
  { id: "screen.screening_articles", tab: "Screening", group: "Screen", functionName: "screening_articles", label: "Screening Articles" },
  { id: "screen.classify_by_title", tab: "Screening", group: "Classify", functionName: "classify_by_title", label: "Classify by Title" },
  { id: "screen.classification_12", tab: "Screening", group: "Classify", functionName: "_classification_12_features", label: "Classification 12 Features" },

  { id: "export.export_collection_to_csv", tab: "Export & Files", group: "Export", functionName: "export_collection_to_csv", label: "Export Collection to CSV" },
  { id: "export.download_pdfs_from_collections", tab: "Export & Files", group: "PDF", functionName: "download_pdfs_from_collections", label: "Download PDFs from Collections" },

  { id: "notes.get_note_by_tag", tab: "Notes & Tags", group: "Notes", functionName: "get_note_by_tag", label: "Get Note by Tag" },
  { id: "notes.parse_note_html", tab: "Notes & Tags", group: "Notes", functionName: "_parse_note_html", label: "Parse Note HTML" },
  { id: "notes.append_to_tagged_note", tab: "Notes & Tags", group: "Tag Append", functionName: "_append_to_tagged_note", label: "Append to Tagged Note" },

  { id: "qa.summary_collection_prisma", tab: "Collection QA", group: "PRISMA", functionName: "summary_collection_prisma", label: "Summary Collection PRISMA" },
  { id: "qa.filter_missing_keyword", tab: "Collection QA", group: "PRISMA", functionName: "filter_missing_keyword", label: "Filter Missing Keyword" },
  { id: "qa.compare_collections", tab: "Collection QA", group: "Compare", functionName: "compare_collections", label: "Compare Collections" },
  { id: "qa.getting_duplicates", tab: "Collection QA", group: "Compare", functionName: "getting_duplicates", label: "Getting Duplicates" },
  { id: "qa.get_all_items", tab: "Collection QA", group: "Inventory", functionName: "get_all_items", label: "Get All Items" }
];

function mergeWithSignatures(signatureMap) {
  return BASE_FEATURES.map((feature) => {
    const sig = signatureMap?.[feature.functionName] || null;
    return {
      ...feature,
      args: Array.isArray(sig?.args) ? sig.args : []
    };
  });
}

function groupedFeatures(signatureMap) {
  const merged = mergeWithSignatures(signatureMap);
  const tabs = new Map();
  merged.forEach((f) => {
    if (!tabs.has(f.tab)) tabs.set(f.tab, new Map());
    const groups = tabs.get(f.tab);
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  });

  return Array.from(tabs.entries()).map(([tab, groups]) => ({
    tab,
    groups: Array.from(groups.entries()).map(([group, features]) => ({ group, features }))
  }));
}

function getFeatureByFunctionName(functionName, signatureMap) {
  const merged = mergeWithSignatures(signatureMap);
  return merged.find((f) => f.functionName === functionName) || null;
}

module.exports = {
  groupedFeatures,
  getFeatureByFunctionName
};
