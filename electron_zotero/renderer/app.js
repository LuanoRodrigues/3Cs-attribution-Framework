const state = {
  profile: null,
  collections: [],
  expanded: new Set(),
  collectionSearch: "",
  selectedCollectionKey: "",
  items: [],
  itemsCollectionKey: "",
  itemsLoading: false,
  itemsLoadCtx: {
    key: "",
    refresh: false,
    startedAt: 0
  },
  itemSearch: "",
  selectedItem: null,
  itemChildren: [],
  treeItemsByCollection: new Map(),
  treeItemsLoading: new Set(),
  treeItemsInFlight: new Map(),
  sync: {
    state: "idle",
    lastRunAt: 0,
    lastError: ""
  },
  virtual: {
    rowHeight: 76,
    scrollTop: 0
  },
  advanced: {
    query: "",
    active: false,
    saved: []
  },
  ribbon: {
    tabs: [],
    activeTab: "",
    activeFeature: null,
    profileByFeature: {},
    accessLevel: "safe",
    featureHistory: []
  },
  itemsTable: {
    sortKey: "title",
    sortDir: "asc",
    selectedKeys: new Set(),
    anchorKey: "",
    columnOrder: ["title", "authors", "year", "publicationTitle", "dateModified", "citationCount"],
    columnWidths: {
      title: 320,
      authors: 220,
      year: 72,
      publicationTitle: 220,
      dateModified: 150,
      citationCount: 80
    },
    rowHeight: 34
  },
  layout: {
    paneLeft: 1,
    paneMid: 3,
    paneRight: 1,
    hideLeft: false,
    hideMid: false,
    hideRight: false
  },
  leftRail: {
    savedExpanded: true,
    tagsExpanded: true,
    selectedTags: [],
    tagCatalog: [],
    collectionTagSet: [],
    collectionTagCounts: {},
    collectionTagLoaded: false,
    collectionTagLoading: false,
    collectionTagCache: {},
    tagLoading: false,
    tagMode: "all",
    tagScope: "collection",
    tagSearch: "",
    tagLimit: 120
  },
  voice: {
    supported: false,
    voiceModeOn: false,
    dictationOn: false,
    listeningVoice: false,
    listeningDictation: false,
    lastTranscript: "",
    lastError: ""
  },
  inspector: {
    autoSync: true,
    density: "comfortable",
    viewTab: "item",
    metadataEdit: false,
    status: "idle",
    message: "",
    draftItemKey: "",
    draftAbstract: "",
    draftTags: [],
    draftFields: {},
    baseVersion: 0,
    syncTimer: null,
    lastSyncedAt: 0
  },
  chat: {
    open: false,
    pending: false,
    messages: [],
    pendingIntent: null,
    pendingConfirmation: null,
    jobProgress: {}
  },
  batch: {
    finalNotified: new Set(),
    collectionRefreshed: new Set(),
    showFeatureJobs: false,
    showBatchMonitor: false,
    monitorCollapsed: false
  },
  workspace: {
    activeTab: "home"
  },
  batchExplorer: {
    loading: false,
    detailLoading: false,
    batches: [],
    selectedBatchId: "",
    rows: [],
    selectedRowIndex: -1,
    sortKey: "confidence",
    sortDir: "desc",
    meta: null
  }
};
let refreshFeatureJobsTimer = null;
let refreshBatchExplorerTimer = null;
let lastFeatureJobsRefreshAt = 0;

if (!window.zoteroBridge) {
  const unavailable = { status: "error", message: "Electron preload bridge unavailable." };
  window.zoteroBridge = {
    getProfile: async () => unavailable,
    getTree: async () => unavailable,
    getItems: async () => unavailable,
    getItemChildren: async () => unavailable,
    runAgentCommand: async () => unavailable,
    resolveIntent: async () => unavailable,
    executeIntent: async () => unavailable,
    refineCodingQuestions: async () => unavailable,
    generateEligibilityCriteria: async () => unavailable,
    getVoiceSession: async () => unavailable,
    setVoiceMode: async () => unavailable,
    setDictation: async () => unavailable,
    runVoiceCommand: async () => unavailable,
    advancedSearch: async () => unavailable,
    getTagFacets: async () => unavailable,
    getItemsByTags: async () => unavailable,
    getFeatureInventory: async () => unavailable,
    runFeature: async () => unavailable,
    getBatchExplorer: async () => unavailable,
    getBatchDetail: async () => unavailable,
    deleteBatch: async () => unavailable,
    clearWorkflowBatchJobs: async () => unavailable,
    getIntentStats: async () => unavailable,
    getSavedSearches: async () => unavailable,
    saveSavedSearch: async () => unavailable,
    deleteSavedSearch: async () => unavailable,
    syncNow: async () => unavailable,
    getSyncStatus: async () => unavailable,
    openReader: async () => unavailable,
    emitMenuCommand: async () => unavailable,
    openExternal: async () => unavailable,
    updateItemMetadata: async () => unavailable,
    clearCache: async () => unavailable,
    onMenuCommand: () => () => {},
    onSyncStatus: () => () => {},
    onVoiceModeDelta: () => () => {},
    onFeatureJobStatus: () => () => {}
  };
}

const STORAGE_KEY = "electron_zotero_ui_state_v2";
const DEFAULT_PANE_WEIGHTS = Object.freeze({
  paneLeft: 1,
  paneMid: 3,
  paneRight: 1
});
const MIN_PANE_WEIGHT = 0.6;
const TREE_PREVIEW_FETCH_MAX = Number.POSITIVE_INFINITY;
const TREE_PREVIEW_RENDER_LIMIT = 120;
const dbg = (fn, msg) => console.debug(`[app.js][${fn}][debug] ${msg}`);

function defaultPaneWeight(key) {
  return Number(DEFAULT_PANE_WEIGHTS[key] || 1);
}

function normalizedPaneWeight(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_PANE_WEIGHT) return Number(fallback);
  return Number(n.toFixed(3));
}

function normalizedPaneWeights(source) {
  return {
    paneLeft: normalizedPaneWeight(source?.paneLeft, defaultPaneWeight("paneLeft")),
    paneMid: normalizedPaneWeight(source?.paneMid, defaultPaneWeight("paneMid")),
    paneRight: normalizedPaneWeight(source?.paneRight, defaultPaneWeight("paneRight"))
  };
}

function applyPaneWeightState(source) {
  const next = normalizedPaneWeights(source);
  state.layout.paneLeft = next.paneLeft;
  state.layout.paneMid = next.paneMid;
  state.layout.paneRight = next.paneRight;
}

const requestTokens = {
  tree: 0,
  items: 0,
  children: 0,
  advanced: 0,
  tags: 0,
  collectionTags: 0,
  batchDetail: 0
};

const els = {
  profileLine: document.getElementById("profileLine"),
  statusLine: document.getElementById("statusLine"),
  workspaceTabs: document.getElementById("workspaceTabs"),
  btnWorkspaceHome: document.getElementById("btnWorkspaceHome"),
  btnWorkspaceBatches: document.getElementById("btnWorkspaceBatches"),
  collectionSearch: document.getElementById("collectionSearch"),
  collectionsTree: document.getElementById("collectionsTree"),
  itemSearch: document.getElementById("itemSearch"),
  itemsList: document.getElementById("itemsList"),
  itemsMeta: document.getElementById("itemsMeta"),
  itemsActiveFilters: document.getElementById("itemsActiveFilters"),
  selectedCollection: document.getElementById("selectedCollection"),
  selectedItem: document.getElementById("selectedItem"),
  childrenList: document.getElementById("childrenList"),
  activeSelection: document.getElementById("activeSelection"),
  chipCollections: document.getElementById("chipCollections"),
  chipItems: document.getElementById("chipItems"),
  chipChildren: document.getElementById("chipChildren"),
  chipSync: document.getElementById("chipSync"),
  chipVoice: document.getElementById("chipVoice"),
  toastHost: document.getElementById("toastHost"),
  contextMenu: document.getElementById("contextMenu"),
  layoutRoot: document.getElementById("layoutRoot"),
  paneCollections: document.getElementById("paneCollections"),
  paneItems: document.getElementById("paneItems"),
  splitterLeft: document.getElementById("splitterLeft"),
  splitterRight: document.getElementById("splitterRight"),
  paneDetails: document.getElementById("paneDetails"),
  batchesLayout: document.getElementById("batchesLayout"),
  btnBatchesRefresh: document.getElementById("btnBatchesRefresh"),
  batchesList: document.getElementById("batchesList"),
  batchRowsMeta: document.getElementById("batchRowsMeta"),
  batchRowsTable: document.getElementById("batchRowsTable"),
  btnBatchDetailRefresh: document.getElementById("btnBatchDetailRefresh"),
  batchDetailPanel: document.getElementById("batchDetailPanel"),
  btnRefreshTree: document.getElementById("btnRefreshTree"),
  btnPurgeCache: document.getElementById("btnPurgeCache"),
  btnSyncNow: document.getElementById("btnSyncNow"),
  btnVoiceMode: document.getElementById("btnVoiceMode"),
  btnDictation: document.getElementById("btnDictation"),
  btnInspectorDensity: document.getElementById("btnInspectorDensity"),
  btnToggleCollections: document.getElementById("btnToggleCollections"),
  btnToggleItems: document.getElementById("btnToggleItems"),
  btnToggleInspector: document.getElementById("btnToggleInspector"),
  btnAdvancedSearch: document.getElementById("btnAdvancedSearch"),
  btnResetLayout: document.getElementById("btnResetLayout"),
  btnExpandAll: document.getElementById("btnExpandAll"),
  btnCollapseAll: document.getElementById("btnCollapseAll"),
  btnCopyCollectionKey: document.getElementById("btnCopyCollectionKey"),
  btnOpenCollection: document.getElementById("btnOpenCollection"),
  btnLoadItems: document.getElementById("btnLoadItems"),
  btnLoadItemsFresh: document.getElementById("btnLoadItemsFresh"),
  btnOpenReader: document.getElementById("btnOpenReader"),
  btnCommandPalette: document.getElementById("btnCommandPalette"),
  btnCollectionLoadCache: document.getElementById("btnCollectionLoadCache"),
  btnCollectionLoadFresh: document.getElementById("btnCollectionLoadFresh"),
  btnCollectionOpen: document.getElementById("btnCollectionOpen"),
  btnCollectionCopy: document.getElementById("btnCollectionCopy"),
  btnItemOpenZotero: document.getElementById("btnItemOpenZotero"),
  btnItemOpenUrl: document.getElementById("btnItemOpenUrl"),
  btnItemOpenDoi: document.getElementById("btnItemOpenDoi"),
  btnItemOpenPdf: document.getElementById("btnItemOpenPdf"),
  btnItemChildren: document.getElementById("btnItemChildren"),
  btnItemCopy: document.getElementById("btnItemCopy"),
  advancedSearchModal: document.getElementById("advancedSearchModal"),
  advancedSearchInput: document.getElementById("advancedSearchInput"),
  advancedSearchMeta: document.getElementById("advancedSearchMeta"),
  btnAdvancedSearchClose: document.getElementById("btnAdvancedSearchClose"),
  btnAdvancedSearchRun: document.getElementById("btnAdvancedSearchRun"),
  btnAdvancedSearchSave: document.getElementById("btnAdvancedSearchSave"),
  savedSearchSelect: document.getElementById("savedSearchSelect"),
  btnSavedSearchDelete: document.getElementById("btnSavedSearchDelete"),
  commandPalette: document.getElementById("commandPalette"),
  btnCommandPaletteClose: document.getElementById("btnCommandPaletteClose"),
  commandList: document.getElementById("commandList"),
  accessLevelSelect: document.getElementById("accessLevelSelect"),
  btnDownloadPdfs: document.getElementById("btnDownloadPdfs"),
  btnFeatureHealth: document.getElementById("btnFeatureHealth"),
  btnFeatureDryHarness: document.getElementById("btnFeatureDryHarness"),
  ribbonTabs: document.getElementById("ribbonTabs"),
  ribbonGroups: document.getElementById("ribbonGroups"),
  featureRunModal: document.getElementById("featureRunModal"),
  featureRunTitle: document.getElementById("featureRunTitle"),
  featureRunSchema: document.getElementById("featureRunSchema"),
  featureRunForm: document.getElementById("featureRunForm"),
  btnFeatureRunClose: document.getElementById("btnFeatureRunClose"),
  btnFeatureDryRun: document.getElementById("btnFeatureDryRun"),
  btnFeatureExecute: document.getElementById("btnFeatureExecute"),
  btnFeatureQueue: document.getElementById("btnFeatureQueue"),
  btnFeatureReplay: document.getElementById("btnFeatureReplay"),
  featureHistorySelect: document.getElementById("featureHistorySelect"),
  featureRunResultMeta: document.getElementById("featureRunResultMeta"),
  featureRunArtifacts: document.getElementById("featureRunArtifacts"),
  featureRunOutput: document.getElementById("featureRunOutput"),
  btnRefreshJobs: document.getElementById("btnRefreshJobs"),
  featureJobsPanel: document.getElementById("featureJobsPanel"),
  featureJobsList: document.getElementById("featureJobsList"),
  batchMonitorPanel: document.getElementById("batchMonitorPanel"),
  btnBatchMonitorClear: document.getElementById("btnBatchMonitorClear"),
  btnBatchMonitorHide: document.getElementById("btnBatchMonitorHide"),
  btnBatchMonitorClose: document.getElementById("btnBatchMonitorClose"),
  btnBatchMonitorRefresh: document.getElementById("btnBatchMonitorRefresh"),
  batchMonitorBadge: document.getElementById("batchMonitorBadge"),
  batchMonitorList: document.getElementById("batchMonitorList"),
  batchDoneModal: document.getElementById("batchDoneModal"),
  btnBatchDoneClose: document.getElementById("btnBatchDoneClose"),
  batchDoneSummary: document.getElementById("batchDoneSummary"),
  agentChatFab: document.getElementById("agentChatFab"),
  agentChatDock: document.getElementById("agentChatDock"),
  agentChatMessages: document.getElementById("agentChatMessages"),
  agentChatForm: document.getElementById("agentChatForm"),
  agentChatInput: document.getElementById("agentChatInput"),
  agentChatDryRun: document.getElementById("agentChatDryRun"),
  btnAgentChatSend: document.getElementById("btnAgentChatSend"),
  btnAgentChatClose: document.getElementById("btnAgentChatClose"),
  btnAgentChatClear: document.getElementById("btnAgentChatClear")
};

const commandRegistry = window.ZoteroCommandRegistry.create();
let voiceRuntime = null;
const FEATURE_SAFE_PRESETS = {
  set_eligibility_criteria: {
    collection_name: "$selectedCollectionName",
    inclusion_criteria: "Include studies directly relevant to the active research question.",
    exclusion_criteria: "Exclude studies that are out of scope or do not provide relevant evidence.",
    eligibility_prompt_key: "paper_screener_abs_policy"
  },
  open_coding: {
    prompt_key: "policy_cluster_theme",
    research_question: "RQ1",
    collection_name: "$selectedCollectionName",
    read: false,
    store_only: true,
    process_for: true,
    eligibility_prompt_key: "paper_screener_abs_policy",
    apply_updates: true,
    save_local: true
  },
  open_coding_policy_cluster: {
    research_question: "RQ1",
    collection_name: "$selectedCollectionName",
    read: false,
    store_only: false
  },
  code_single_item: {
    item: {},
    prompt_key: "policy_cluster_theme",
    read: false,
    store_only: false,
    research_question: "RQ1",
    collection_name: "$selectedCollectionName"
  },
  code_single_item_policy_cluster: {
    item: {},
    read: false,
    store_only: false,
    research_question: "RQ1",
    collection_name: "$selectedCollectionName"
  },
  Verbatim_Evidence_Coding: {
    dir_base: "./running_tests",
    collection_name: "$selectedCollectionName",
    research_questions: ["RQ1"],
    prompt_key: "code_pdf_page"
  },
  paper_coding: { collection_name: "$selectedCollectionName", read: false, store_only: false },
  cluster_notes_codes: { tag: "Note_Codes", heading: "Theoretical Orientation" },
  keyword_analysis: { collection_name: "$selectedCollectionName", keyword: "policy" },
  keyword_analysis_multi: { collection_name: "$selectedCollectionName", keywords: ["policy"] },
  keyword_html_first_pass: { collection_name: "$selectedCollectionName", keyword: "policy", notes: [] },
  consolidate_keyword_batches: { keyword: "policy", per_item_results: [] },
  consolidate_keyword_batches_html: { collection_name: "$selectedCollectionName", keyword: "policy", batch_html_list: [] },
  run_store_only_then_collect: { collection_name: "$selectedCollectionName", keyword: "policy" },
  build_thematic_section_after_collect: { collection_name: "$selectedCollectionName", keywords: ["policy"] },
  thematic_section_from_consolidated_html: { collection_name: "$selectedCollectionName", consolidated_by_keyword_html: {} },
  extract_entity_affiliation: { collection_name: "$selectedCollectionName", read: false, store_only: false },
  extract_na: { collection_name: "$selectedCollectionName" },
  extract_na_flat: { collection_name: "$selectedCollectionName" },
  get_item_payload: { item_key: "$selectedItemKey" },
  screening_articles: { collection_name: "$selectedCollectionName", custom_criteria: false, store: false, read: false, cache: false },
  classify_by_title: { collection_name: "$selectedCollectionName" },
  _classification_12_features: { collection_name: "$selectedCollectionName", read: false, store_only: false },
  split_collection_by_status_tag: { collection_name: "$selectedCollectionName" },
  parse_extra_justifications: { collection_name: "$selectedCollectionName" },
  export_collection_to_csv: {
    collection_name: "$selectedCollectionName",
    cols_list: ["key", "title", "itemType", "date", "url"],
    csv_path: "./running_tests/export_collection.csv"
  },
  download_pdfs_from_collections: { output_folder: "./running_tests/pdfs", Z_collections: ["$selectedCollectionName"] },
  get_note_by_tag: { tag: "Note_Codes", collection_name: "$selectedCollectionName" },
  _parse_note_html: { note_html: "<h2>Sample</h2><p>Template note</p>" },
  _append_to_tagged_note: { item_key: "$selectedItemKey", snippet: "Template snippet", tag: "Note_Codes" },
  summary_collection_prisma: { collection_name: "$selectedCollectionName" },
  filter_missing_keyword: {
    screen_collections_tree: [],
    summary_collections_tree: [],
    items: [],
    keyword: "policy"
  },
  compare_collections: { coll_a: "$selectedCollectionName", coll_b: "$selectedCollectionName" },
  getting_duplicates: { collection_name: "$selectedCollectionName", items: [] },
  get_all_items: { collection_name: "$selectedCollectionName", cache: false, all: false }
};
const FEATURE_PROFILE_OVERRIDES = {
  open_coding: {
    full: { read: true, store_only: false },
    strict: { read: true, store_only: true }
  },
  paper_coding: {
    full: { read: true, store_only: false },
    strict: { read: true, store_only: true }
  },
  extract_entity_affiliation: {
    full: { read: true, store_only: false },
    strict: { read: true, store_only: true }
  },
  _classification_12_features: {
    full: { read: true, store_only: false },
    strict: { read: true, store_only: true }
  },
  get_all_items: {
    full: { cache: true, all: true },
    strict: { cache: true, all: true }
  },
  keyword_analysis_multi: {
    full: { collections: ["$selectedCollectionName", "$selectedCollectionName"] },
    strict: { collections: ["$selectedCollectionName", "$selectedCollectionName"] }
  }
};

function setStatus(text, tone = "") {
  els.statusLine.textContent = text;
  els.statusLine.className = `statusbar ${tone}`.trim();
}

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}

function showToast(text, tone = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`.trim();
  toast.textContent = text;
  els.toastHost.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2200);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const ICON_PATHS = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  "folder-open": "M3 9a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 1.9 2.6l-1.2 4A2 2 0 0 1 17.8 17H5a2 2 0 0 1-2-2V9z",
  search: "M11 19a8 8 0 1 1 5.3-14l4.2 4.2-1.4 1.4-4.2-4.2A8 8 0 0 1 11 19z",
  tag: "M20 10l-8 8-9-9V4h5l9 9z",
  "refresh-cw": "M20 4v6h-6M4 20v-6h6M5 9a7 7 0 0 1 12-3l3 3M19 15a7 7 0 0 1-12 3l-3-3",
  copy: "M9 9h10v10H9zM5 5h10",
  "external-link": "M14 4h6v6M20 4l-8 8M5 8v12h12",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  "rotate-ccw": "M3 12a9 9 0 1 0 3-6.7M3 3v6h6",
  "book-open": "M2 6a3 3 0 0 1 3-3h6v16H5a3 3 0 0 0-3 3V6zm20 0a3 3 0 0 0-3-3h-6v16h6a3 3 0 0 1 3 3V6z",
  link: "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
  globe: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zm-7.5 10h15M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
  "file-text": "M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6M8 13h8M8 17h6",
  "git-branch": "M6 3v12a3 3 0 1 0 2 0V9h8a3 3 0 1 0-2-2H8V3",
  command: "M6 6h3v3H6zM15 6h3v3h-3zM6 15h3v3H6zM15 15h3v3h-3z",
  "layout-panel-left": "M3 4h18v16H3zM9 4v16",
  "panel-right-open": "M3 4h18v16H3zM15 4v16M7 9l3 3-3 3",
  "panel-left-open": "M3 4h18v16H3zM9 4v16M7 12h4",
  "panel-top-open": "M3 4h18v16H3zM3 10h18M12 7v4",
  "trash-2": "M3 6h18M8 6V4h8v2M7 6l1 14h8l1-14",
  cloud: "M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 5.4 8A4 4 0 0 0 7 18",
  mic: "M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm0 0v4m-4-4a4 4 0 0 0 8 0",
  "audio-lines": "M4 7h2v10H4zM10 4h2v16h-2zM16 7h2v10h-2z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z",
  hash: "M5 9h14M5 15h14M9 3L7 21M17 3l-2 18",
  building: "M4 22h16M6 22V6l6-3l6 3v16M9 10h.01M15 10h.01M9 14h.01M15 14h.01",
  "map-pin": "M12 22s7-4.6 7-11a7 7 0 1 0-14 0c0 6.4 7 11 7 11zm0-8a3 3 0 1 0 0-6a3 3 0 0 0 0 6z",
  languages: "M4 5h8M8 3c0 5 2.5 9 6 11M6 9c1.5 2.5 3.8 4.8 7 6M15 18l4-10l4 10M16.5 14h5",
  clock: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zm0 5v5l4 2",
  quote: "M10 11H6a4 4 0 0 1 4-4v4zm8 0h-4a4 4 0 0 1 4-4v4z",
  archive: "M3 7h18v13H3zM1 3h22v4H1zM10 12h4",
  "chevron-right": "M9 6l6 6l-6 6",
  "chevron-down": "M6 9l6 6l6-6",
  key: "M21 2l-2 2m-3 3l3-3l2 2l-3 3M13 10a5 5 0 1 1-7 7l-4 4l-2-2l4-4a5 5 0 0 1 9-5z",
  article: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h6",
  newspaper: "M3 6h18v12H3zM7 10h6M7 14h6M14 10h4M14 14h4",
  scroll: "M8 4h8a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm0 0v5h8",
  flask: "M10 3v5l-5 8a4 4 0 0 0 3.4 6h7.2a4 4 0 0 0 3.4-6l-5-8V3",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3s-3.6 3-8 3s-8-1.3-8-3zm0 6c0 1.7 3.6 3 8 3s8-1.3 8-3m-16 6c0 1.7 3.6 3 8 3s8-1.3 8-3"
};

function renderIcon(name, cls = "") {
  const path = ICON_PATHS[name] || ICON_PATHS["file-text"];
  const klass = cls ? ` ${cls}` : "";
  return `<span class="ui-icon${klass}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg></span>`;
}

function itemTypeIconName(itemType) {
  const t = String(itemType || "").toLowerCase();
  if (t.includes("book")) return "book-open";
  if (t.includes("report") || t.includes("newspaper")) return "newspaper";
  if (t.includes("thesis") || t.includes("dissertation")) return "scroll";
  if (t.includes("webpage")) return "globe";
  if (t.includes("conference")) return "bookmark";
  if (t.includes("patent")) return "flask";
  if (t.includes("journal") || t.includes("article")) return "article";
  return "file-text";
}

const INSPECTOR_FIELD_META = {
  type: { label: "Type", category: "identity", icon: "bookmark", editable: false },
  title: { label: "Title", category: "identity", icon: "file-text", editable: true },
  creator: { label: "Creator", category: "identity", icon: "users", editable: false },
  publicationTitle: { label: "Publication", category: "publication", icon: "book-open", editable: true },
  date: { label: "Date", category: "publication", icon: "calendar", editable: true },
  volume: { label: "Volume", category: "publication", icon: "hash", editable: true },
  issue: { label: "Issue", category: "publication", icon: "hash", editable: true },
  pages: { label: "Pages", category: "publication", icon: "file-text", editable: true },
  publisher: { label: "Publisher", category: "publication", icon: "building", editable: true },
  place: { label: "Place", category: "publication", icon: "map-pin", editable: true },
  edition: { label: "Edition", category: "publication", icon: "bookmark", editable: true },
  series: { label: "Series", category: "publication", icon: "bookmark", editable: true },
  section: { label: "Section", category: "publication", icon: "scroll", editable: true },
  language: { label: "Language", category: "identity", icon: "languages", editable: true },
  doi: { label: "DOI", category: "linking", icon: "link", editable: true },
  url: { label: "URL", category: "linking", icon: "globe", editable: true },
  issn: { label: "ISSN", category: "linking", icon: "hash", editable: true },
  isbn: { label: "ISBN", category: "linking", icon: "hash", editable: true },
  dateModified: { label: "Date Modified", category: "system", icon: "clock", editable: false },
  citationCount: { label: "Citation Count", category: "system", icon: "quote", editable: false },
  libraryCatalog: { label: "Library Catalog", category: "archive", icon: "database", editable: true },
  callNumber: { label: "Call Number", category: "archive", icon: "hash", editable: true },
  archive: { label: "Archive", category: "archive", icon: "archive", editable: true },
  archiveLocation: { label: "Archive Location", category: "archive", icon: "map-pin", editable: true },
  extra: { label: "Extra", category: "system", icon: "file-text", editable: true },
  key: { label: "Key", category: "system", icon: "key", editable: false }
};

const INSPECTOR_TEMPLATE_KEYS = {
  article: ["type", "title", "creator", "publicationTitle", "date", "volume", "issue", "pages", "doi", "url", "issn"],
  book: ["type", "title", "creator", "publisher", "place", "date", "edition", "series", "isbn", "url"],
  report: ["type", "title", "creator", "publisher", "place", "date", "pages", "doi", "url", "callNumber"],
  legal: ["type", "title", "creator", "publicationTitle", "date", "section", "pages", "place", "url"]
};

function inspectorTemplateForType(itemType) {
  const t = String(itemType || "").toLowerCase();
  if (t.includes("book")) return "book";
  if (t.includes("report") || t.includes("newspaper")) return "report";
  if (t.includes("statute") || t.includes("case") || t.includes("legal")) return "legal";
  return "article";
}

function inspectorValueFromItem(item, key, creatorList = []) {
  if (!item) return "";
  if (key === "type") return item.itemType || "";
  if (key === "title") return item.title || "";
  if (key === "creator") return item.authors || creatorList.join("; ") || "";
  if (key === "publicationTitle") return item.containerTitle || item.publicationTitle || "";
  if (key === "date") return item.date || item.year || "";
  if (key === "volume") return item.volume || "";
  if (key === "issue") return item.issue || "";
  if (key === "pages") return item.pages || "";
  if (key === "publisher") return item.publisher || "";
  if (key === "place") return item.place || "";
  if (key === "edition") return item.edition || "";
  if (key === "series") return item.series || item.seriesTitle || "";
  if (key === "section") return item.section || "";
  if (key === "language") return item.language || "";
  if (key === "doi") return item.doi || "";
  if (key === "url") return item.url || "";
  if (key === "issn") return item.issn || "";
  if (key === "isbn") return item.isbn || "";
  if (key === "dateModified") return item.dateModified || "";
  if (key === "citationCount") return Number(item.citationCount || 0) > 0 ? String(Number(item.citationCount || 0)) : "";
  if (key === "libraryCatalog") return item.libraryCatalog || "";
  if (key === "callNumber") return item.callNumber || "";
  if (key === "archive") return item.archive || "";
  if (key === "archiveLocation") return item.archiveLocation || "";
  if (key === "extra") return item.extra || "";
  if (key === "key") return item.key || "";
  return "";
}

function editableInspectorFieldKeys(itemType) {
  const template = inspectorTemplateForType(itemType);
  const keys = [...(INSPECTOR_TEMPLATE_KEYS[template] || []), "language", "libraryCatalog", "archive", "archiveLocation", "extra"];
  const seen = new Set();
  return keys.filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(INSPECTOR_FIELD_META[key]?.editable);
  });
}

function hydrateButtonIcons() {
  document.querySelectorAll("button[data-icon]").forEach((btn) => {
    if (btn.getAttribute("data-icon-hydrated") === "1") return;
    const name = String(btn.getAttribute("data-icon") || "").trim();
    if (!name) return;
    btn.innerHTML = `${renderIcon(name, "btn-icn")}<span>${escapeHtml(btn.textContent || "")}</span>`;
    btn.setAttribute("data-icon-hydrated", "1");
  });
}

function applyInspectorDensity() {
  const density =
    state.inspector.density === "compact" || state.inspector.density === "ultra"
      ? state.inspector.density
      : "comfortable";
  if (els.paneDetails) {
    els.paneDetails.classList.toggle("inspector-density-compact", density === "compact");
    els.paneDetails.classList.toggle("inspector-density-ultra", density === "ultra");
  }
  if (els.btnInspectorDensity) {
    const label = density === "ultra" ? "Ultra-compact" : density === "compact" ? "Compact" : "Comfortable";
    els.btnInspectorDensity.textContent = `Inspector: ${label}`;
    els.btnInspectorDensity.setAttribute("data-icon-hydrated", "0");
  }
  hydrateButtonIcons();
}

function nextInspectorDensity(current) {
  if (current === "comfortable") return "compact";
  if (current === "compact") return "ultra";
  return "comfortable";
}

function applyFloatingPanelsVisibility() {
  if (els.featureJobsPanel) {
    els.featureJobsPanel.classList.toggle("is-hidden", !state.batch.showFeatureJobs);
  }
  if (els.batchMonitorPanel) {
    els.batchMonitorPanel.classList.toggle("is-hidden", !state.batch.showBatchMonitor);
    els.batchMonitorPanel.classList.toggle("is-collapsed", state.batch.monitorCollapsed === true);
  }
  if (els.btnBatchMonitorHide) {
    els.btnBatchMonitorHide.textContent = state.batch.monitorCollapsed ? "Show" : "Hide";
    els.btnBatchMonitorHide.setAttribute("data-icon", state.batch.monitorCollapsed ? "chevron-right" : "chevron-down");
    els.btnBatchMonitorHide.setAttribute("data-icon-hydrated", "0");
    hydrateButtonIcons();
  }
}

function formatClock(ts) {
  const n = Number(ts || 0);
  if (!n) return "—";
  try {
    return new Date(n).toLocaleString();
  } catch {
    return "—";
  }
}

function setWorkspaceTab(tab) {
  const next = tab === "batches" ? "batches" : "home";
  state.workspace.activeTab = next;
  if (els.btnWorkspaceHome) els.btnWorkspaceHome.classList.toggle("active", next === "home");
  if (els.btnWorkspaceBatches) els.btnWorkspaceBatches.classList.toggle("active", next === "batches");
  if (els.layoutRoot) els.layoutRoot.classList.toggle("is-hidden", next !== "home");
  if (els.batchesLayout) els.batchesLayout.classList.toggle("is-hidden", next !== "batches");
  persistUiState();
  if (next === "home") {
    renderCollections();
    renderItems();
    renderDetails();
    if (state.selectedCollectionKey && state.itemsCollectionKey !== state.selectedCollectionKey) {
      void loadItems(false, { ignoreTagFilter: true });
    }
    return;
  }
  void refreshBatchExplorer(true);
}

function renderBatchExplorerList() {
  if (!els.batchesList) return;
  const rows = Array.isArray(state.batchExplorer.batches) ? state.batchExplorer.batches : [];
  if (!rows.length) {
    els.batchesList.innerHTML = "<div class='meta'>No OpenAI workflow batches found.</div>";
    return;
  }
  els.batchesList.innerHTML = "";
  rows.forEach((batch) => {
    const el = document.createElement("div");
    el.className = "batch-list-row";
    if (batch.batchId === state.batchExplorer.selectedBatchId) el.classList.add("active");
    const title = document.createElement("div");
    title.className = "batch-list-title";
    title.textContent = `${batch.status} • ${Math.round(Number(batch.progress || 0))}% • ${batch.batchId}`;
    const meta = document.createElement("div");
    meta.className = "batch-list-meta";
    meta.textContent = `${batch.topic || "(topic missing)"} • folder=${batch.subfolderName || "(pending)"} • model=${
      batch.model || "n/a"
    }`;
    el.append(title, meta);
    el.addEventListener("click", () => {
      state.batchExplorer.selectedBatchId = batch.batchId;
      state.batchExplorer.selectedRowIndex = -1;
      renderBatchExplorerList();
      void loadBatchDetail(batch.batchId, false);
      persistUiState();
    });
    el.addEventListener("contextmenu", (ev) => {
      showContextMenu(ev, [
        {
          icon: "trash-2",
          label: "Delete Batch (Purge)",
          onClick: async () => {
            const ok = window.confirm(
              `Delete batch '${batch.batchId}' from backend state and purge cached output?\nThis cannot be undone.`
            );
            if (!ok) return;
            setStatus(`Deleting batch ${batch.batchId}…`);
            const res = await window.zoteroBridge.deleteBatch({
              batchId: batch.batchId,
              jobId: batch.jobId
            });
            if (res?.status !== "ok") {
              setStatus(res?.message || "Failed to delete batch.", "err");
              showToast(res?.message || "Failed to delete batch.", "err");
              return;
            }
            if (state.batchExplorer.selectedBatchId === batch.batchId) {
              state.batchExplorer.selectedBatchId = "";
              state.batchExplorer.selectedRowIndex = -1;
              state.batchExplorer.rows = [];
              state.batchExplorer.meta = null;
            }
            showToast(`Batch ${batch.batchId} purged.`, "ok");
            setStatus(`Batch ${batch.batchId} deleted.`, "ok");
            await refreshFeatureJobs(true);
            await refreshBatchExplorer(true);
          }
        }
      ]);
    });
    els.batchesList.appendChild(el);
  });
}

function sortedBatchRows() {
  const list = Array.isArray(state.batchExplorer.rows) ? state.batchExplorer.rows.slice() : [];
  const key = state.batchExplorer.sortKey || "confidence";
  const dir = state.batchExplorer.sortDir === "asc" ? 1 : -1;
  return list.sort((a, b) => {
    const va = a?.[key];
    const vb = b?.[key];
    if (typeof va === "number" || typeof vb === "number") {
      return (Number(va || 0) - Number(vb || 0)) * dir;
    }
    return String(va || "").localeCompare(String(vb || "")) * dir;
  });
}

function batchRowToTsv(row) {
  const cols = [
    row?.itemKey || "",
    row?.title || "",
    row?.authors || "",
    row?.status || "",
    row?.isMatch ? "yes" : "no",
    Number(row?.confidence || 0).toFixed(3),
    row?.reason || ""
  ];
  return cols.map((v) => String(v || "").replace(/\r?\n/g, " ").trim()).join("\t");
}

function renderBatchRowsTable() {
  if (!els.batchRowsTable || !els.batchRowsMeta) return;
  if (state.batchExplorer.detailLoading) {
    els.batchRowsMeta.textContent = "Loading batch rows…";
    els.batchRowsTable.innerHTML = "<div class='meta'>Loading…</div>";
    return;
  }
  const rows = sortedBatchRows();
  const total = rows.length;
  const included = rows.filter((r) => String(r.status || "").toLowerCase() === "included").length;
  const maybe = rows.filter((r) => String(r.status || "").toLowerCase() === "maybe").length;
  const excluded = rows.filter((r) => String(r.status || "").toLowerCase() === "excluded").length;
  const matches = rows.filter((r) => r.isMatch).length;
  els.batchRowsMeta.textContent = `${total} rows • included=${included} • maybe=${maybe} • excluded=${excluded} • matches=${matches}`;
  if (!total) {
    els.batchRowsTable.innerHTML = "<div class='meta'>No cached batch output rows for this batch yet.</div>";
    return;
  }
  const sortArrow = (k) =>
    state.batchExplorer.sortKey === k ? (state.batchExplorer.sortDir === "asc" ? " ▲" : " ▼") : "";
  const html = [
    "<div class='batch-rows-actions'>",
    "<button type='button' data-batch-copy-all='1'>Copy All Rows (TSV)</button>",
    "</div>",
    "<table class='batch-table'>",
    "<thead><tr>",
    `<th><button data-batch-sort='index'>#${sortArrow("index")}</button></th>`,
    `<th><button data-batch-sort='itemKey'>Item${sortArrow("itemKey")}</button></th>`,
    `<th><button data-batch-sort='title'>Title${sortArrow("title")}</button></th>`,
    `<th><button data-batch-sort='authors'>Author${sortArrow("authors")}</button></th>`,
    `<th><button data-batch-sort='status'>Status${sortArrow("status")}</button></th>`,
    `<th><button data-batch-sort='isMatch'>Match${sortArrow("isMatch")}</button></th>`,
    `<th><button data-batch-sort='confidence'>Confidence${sortArrow("confidence")}</button></th>`,
    `<th><button data-batch-sort='reason'>Justification${sortArrow("reason")}</button></th>`,
    "<th>Copy</th>",
    "</tr></thead><tbody>"
  ];
  rows.forEach((row, idx) => {
    const active = state.batchExplorer.selectedRowIndex === row.index ? " class='active'" : "";
    html.push(
      `<tr data-batch-row='${idx}'${active}><td>${Number(row.index) + 1}</td><td>${escapeHtml(
        row.itemKey || ""
      )}</td><td>${escapeHtml(row.title || "")}</td><td>${escapeHtml(
        row.authors || ""
      )}</td><td>${escapeHtml(String(row.status || ""))}</td><td>${row.isMatch ? "yes" : "no"}</td><td>${Number(
        row.confidence || 0
      ).toFixed(3)}</td><td>${escapeHtml(
        row.reason || ""
      )}</td><td><button type='button' data-batch-copy-row='${idx}'>Copy</button></td></tr>`
    );
  });
  html.push("</tbody></table>");
  els.batchRowsTable.innerHTML = html.join("");
}

function renderBatchDetailPanel() {
  if (!els.batchDetailPanel) return;
  const meta = state.batchExplorer.meta;
  if (!meta) {
    els.batchDetailPanel.textContent = "No batch selected";
    return;
  }
  const selected = (state.batchExplorer.rows || []).find((r) => r.index === state.batchExplorer.selectedRowIndex) || null;
  const promptTemplate = String(meta?.prompt?.template || "");
  const promptSystem = String(meta?.prompt?.system || "");
  const promptSchema = meta?.prompt?.schema && typeof meta.prompt.schema === "object" ? meta.prompt.schema : {};
  const promptSchemaText = JSON.stringify(promptSchema, null, 2);
  const selectedRaw = selected?.raw ? JSON.stringify(selected.raw, null, 2) : "";
  const selectedTags = Array.isArray(selected?.suggestedTags) ? selected.suggestedTags.join(", ") : "";
  const kv = (k, v) => `<div class="batch-kv"><span class="batch-k">${escapeHtml(k)}</span><span class="batch-v">${escapeHtml(v)}</span></div>`;
  els.batchDetailPanel.innerHTML = `
    <div class="batch-detail">
      <div class="batch-detail-section">
        <div class="batch-section-title">Batch Overview</div>
        ${kv("Batch ID", meta.batchId || "")}
        ${kv("Status", `${meta.status || ""} • ${meta.phase || ""}`)}
        ${kv("Model", meta.model || "")}
        ${kv("Topic", meta.topic || "")}
        ${kv("Threshold", Number(meta.threshold || 0).toFixed(2))}
        ${kv("Started", formatClock(meta.startedAt))}
        ${kv("Finished", formatClock(meta.finishedAt))}
        ${kv("Target Parent", meta.parentIdentifier || "")}
        ${kv("Target Subfolder", meta.subfolderName || "")}
        ${kv(
          "Counts",
          `screened=${Number(meta.screenedItems || 0)} • matched=${Number(meta.matchedItems || 0)} • added=${Number(meta.addedItems || 0)}`
        )}
        ${kv("Cached Output", meta.outputCached ? "yes" : "no")}
      </div>
      <div class="batch-detail-section">
        <div class="batch-section-title">OpenAI Prompt + Schema</div>
        ${kv("Prompt Key", meta?.prompt?.promptKey || "")}
        <div class="meta">Exact system prompt used</div>
        <pre class="batch-detail-pre">${escapeHtml(promptSystem)}</pre>
        <div class="meta">Exact user prompt template used</div>
        <pre class="batch-detail-pre">${escapeHtml(promptTemplate)}</pre>
        <div class="meta">Exact JSON schema sent to OpenAI</div>
        <pre class="batch-detail-pre">${escapeHtml(promptSchemaText)}</pre>
      </div>
      ${
        selected
          ? `<div class="batch-detail-section">
             <div class="batch-section-title">Selected Row Detail</div>
             ${kv("Item Key", selected.itemKey || "")}
             ${kv("Title", selected.title || "")}
             ${kv("Author", selected.authors || "")}
             ${kv("Status", String(selected.status || ""))}
             ${kv("Match", selected.isMatch ? "yes" : "no")}
             ${kv("Confidence", Number(selected.confidence || 0).toFixed(3))}
             ${kv("Suggested Tags", selectedTags || "(none)")}
             ${kv("Subject", String(selected.subject || ""))}
             ${kv("Themes", Array.isArray(selected.themes) ? selected.themes.join(", ") : "")}
             <pre class="batch-detail-pre">${escapeHtml(selectedRaw)}</pre></div>`
          : "<div class='meta'>Click a table row to inspect full model response payload.</div>"
      }
    </div>
  `;
}

async function loadBatchDetail(batchId, force = false) {
  if (!batchId) return;
  const token = ++requestTokens.batchDetail;
  dbg("loadBatchDetail", `start token=${token} batchId=${batchId} force=${String(Boolean(force))}`);
  state.batchExplorer.detailLoading = true;
  renderBatchRowsTable();
  try {
    const res = await window.zoteroBridge.getBatchDetail({ batchId, force, limit: 5000 });
    if (token !== requestTokens.batchDetail) return;
    if (res?.status !== "ok") {
      setStatus(res?.message || "Failed to load batch detail.", "err");
      return;
    }
    if (state.batchExplorer.selectedBatchId !== batchId) {
      dbg(
        "loadBatchDetail",
        `stale token=${token} requested=${batchId} selected=${state.batchExplorer.selectedBatchId || "(empty)"}`
      );
      return;
    }
    state.batchExplorer.rows = Array.isArray(res.rows) ? res.rows : [];
    state.batchExplorer.meta = res.batch || null;
    if (state.batchExplorer.selectedRowIndex < 0 && state.batchExplorer.rows.length) {
      state.batchExplorer.selectedRowIndex = state.batchExplorer.rows[0].index;
    }
    dbg(
      "loadBatchDetail",
      `done token=${token} batchId=${batchId} rows=${state.batchExplorer.rows.length} status=${state.batchExplorer.meta?.status || ""}`
    );
  } catch (error) {
    if (token !== requestTokens.batchDetail) return;
    setStatus(error?.message || "Failed to load batch detail.", "err");
  } finally {
    if (token !== requestTokens.batchDetail) return;
    state.batchExplorer.detailLoading = false;
    renderBatchRowsTable();
    renderBatchDetailPanel();
  }
}

async function refreshBatchExplorer(force = false) {
  if (state.batchExplorer.loading) return;
  state.batchExplorer.loading = true;
  try {
    const res = await window.zoteroBridge.getBatchExplorer({ force });
    if (res?.status !== "ok") {
      setStatus(res?.message || "Failed to load batches.", "err");
      return;
    }
    state.batchExplorer.batches = Array.isArray(res.batches) ? res.batches : [];
    const selectedStillExists = state.batchExplorer.batches.some((b) => b.batchId === state.batchExplorer.selectedBatchId);
    if (!selectedStillExists) {
      state.batchExplorer.selectedBatchId = state.batchExplorer.batches[0]?.batchId || "";
      state.batchExplorer.selectedRowIndex = -1;
    }
    renderBatchExplorerList();
    if (state.batchExplorer.selectedBatchId) {
      await loadBatchDetail(state.batchExplorer.selectedBatchId, false);
    } else {
      state.batchExplorer.rows = [];
      state.batchExplorer.meta = null;
      renderBatchRowsTable();
      renderBatchDetailPanel();
    }
  } catch (error) {
    setStatus(error?.message || "Failed to refresh batches.", "err");
  } finally {
    state.batchExplorer.loading = false;
  }
}

function highlightText(text, query) {
  const safe = escapeHtml(text || "");
  if (!query) return safe;
  const idx = String(text || "").toLowerCase().indexOf(query);
  if (idx < 0) return safe;
  const raw = String(text || "");
  const pre = escapeHtml(raw.slice(0, idx));
  const mid = escapeHtml(raw.slice(idx, idx + query.length));
  const post = escapeHtml(raw.slice(idx + query.length));
  return `${pre}<span class="highlight">${mid}</span>${post}`;
}

function byParent(collections) {
  const map = new Map();
  collections.forEach((c) => {
    const key = c.parentKey || null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  });
  for (const arr of map.values()) {
    arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return map;
}

function collectionPathLookup(collections) {
  const byKey = new Map();
  const memo = new Map();
  const stack = new Set();
  collections.forEach((c) => {
    if (c?.key) byKey.set(c.key, c);
  });
  const pathOf = (key) => {
    if (!key) return "";
    if (memo.has(key)) return memo.get(key);
    const node = byKey.get(key);
    if (!node) return "";
    if (stack.has(key)) {
      const fallback = String(node.name || node.key || "");
      memo.set(key, fallback);
      return fallback;
    }
    stack.add(key);
    const own = String(node.name || node.key || "");
    const parentKey = String(node.parentKey || "");
    const parentPath = parentKey && byKey.has(parentKey) ? pathOf(parentKey) : "";
    stack.delete(key);
    const out = parentPath ? `${parentPath}/${own}` : own;
    memo.set(key, out);
    return out;
  };
  collections.forEach((c) => {
    if (c?.key) pathOf(c.key);
  });
  return memo;
}

function rootCollections(collections) {
  const byKey = new Set(
    (Array.isArray(collections) ? collections : [])
      .map((c) => String(c?.key || ""))
      .filter(Boolean)
  );
  return (Array.isArray(collections) ? collections : [])
    .filter((c) => {
      const parentKey = String(c?.parentKey || "");
      return !parentKey || !byKey.has(parentKey);
    })
    .slice()
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
}

function selectedCollection() {
  return state.collections.find((c) => c.key === state.selectedCollectionKey) || null;
}

function selectedZoteroItemUrlByKey(itemKey) {
  if (!itemKey || !state.profile?.prefix) return "";
  return `zotero://select/${state.profile.prefix}/items/${itemKey}`;
}

function selectedCollectionZoteroUrl() {
  if (!state.selectedCollectionKey || !state.profile?.prefix) return "";
  return `zotero://select/${state.profile.prefix}/collections/${state.selectedCollectionKey}`;
}

function collectionZoteroUrlByKey(collectionKey) {
  if (!collectionKey || !state.profile?.prefix) return "";
  return `zotero://select/${state.profile.prefix}/collections/${collectionKey}`;
}

function selectedItemZoteroUrl() {
  return selectedZoteroItemUrlByKey(state.selectedItem?.key || "");
}

function selectedItemDoiUrl() {
  if (!state.selectedItem?.doi) return "";
  const doi = String(state.selectedItem.doi).trim();
  return doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
}

function selectedItemPdfUrl() {
  return state.selectedItem?.zoteroOpenPdfUrl || "";
}

function detailRow(label, value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `<div class="detail-row"><span class="detail-key">${escapeHtml(label)}</span><span class="detail-val">${escapeHtml(text)}</span></div>`;
}

function detailRows(entries) {
  return entries
    .map(([label, value]) => detailRow(label, value))
    .filter(Boolean)
    .join("");
}

function parseTagList(raw) {
  const src = Array.isArray(raw) ? raw.join(",") : String(raw || "");
  const out = [];
  const seen = new Set();
  src
    .split(/[,;\n]/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(tag);
    });
  return out;
}

function formatSyncStamp(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}

function inspectorStatusText() {
  const status = state.inspector.status;
  const stamp = formatSyncStamp(state.inspector.lastSyncedAt);
  if (status === "syncing") return "Syncing…";
  if (status === "synced") return `Synced${stamp ? ` at ${stamp}` : ""}`;
  if (status === "dirty") return "Unsynced local changes";
  if (status === "conflict") return state.inspector.message || "Conflict detected";
  if (status === "error") return state.inspector.message || "Sync failed";
  return "No pending edits";
}

function setInspectorTab(tab) {
  const normalized = tab === "children" ? "metadata" : tab;
  const allowed = new Set(["item", "metadata", "collection"]);
  state.inspector.viewTab = allowed.has(normalized) ? normalized : "item";
  if (state.inspector.viewTab === "metadata" && state.selectedItem?.key) {
    state.inspector.metadataEdit = true;
  }
}

function applyInspectorTab() {
  const tab = state.inspector.viewTab || "item";
  const isItem = tab === "item";
  const isMetadata = tab === "metadata";
  const isCollection = tab === "collection";
  if (els.selectedItem) els.selectedItem.classList.toggle("is-active", isItem);
  if (els.childrenList) els.childrenList.classList.toggle("is-active", isMetadata);
  if (els.selectedCollection) els.selectedCollection.classList.toggle("is-active", isCollection);
  const btnItem = document.getElementById("btnInspectorTabItem");
  const btnMetadata = document.getElementById("btnInspectorTabMetadata");
  const btnCollection = document.getElementById("btnInspectorTabCollection");
  if (btnItem) btnItem.classList.toggle("active", isItem);
  if (btnMetadata) btnMetadata.classList.toggle("active", isMetadata);
  if (btnCollection) btnCollection.classList.toggle("active", isCollection);
}

function updateInspectorStatusNode() {
  const node = document.getElementById("inspectorSyncStatus");
  if (!node) return;
  node.textContent = inspectorStatusText();
  node.setAttribute("data-status", state.inspector.status);
}

function clearInspectorSyncTimer() {
  if (state.inspector.syncTimer) {
    clearTimeout(state.inspector.syncTimer);
    state.inspector.syncTimer = null;
  }
}

function ensureInspectorDraftForSelectedItem() {
  const item = state.selectedItem;
  if (!item?.key) {
    state.inspector.draftItemKey = "";
    state.inspector.draftAbstract = "";
    state.inspector.draftTags = [];
    state.inspector.draftFields = {};
    state.inspector.baseVersion = 0;
    state.inspector.metadataEdit = false;
    state.inspector.status = "idle";
    state.inspector.message = "";
    return;
  }
  if (state.inspector.draftItemKey === item.key) return;
  const creatorList = Array.isArray(item.creators)
    ? item.creators
        .map((creator) => String(creator?.name || "").trim())
        .filter(Boolean)
    : [];
  const draftFields = {};
  editableInspectorFieldKeys(item.itemType).forEach((key) => {
    draftFields[key] = String(inspectorValueFromItem(item, key, creatorList) || "");
  });
  state.inspector.draftItemKey = item.key;
  state.inspector.draftAbstract = String(item.abstract || "");
  state.inspector.draftTags = parseTagList(item.tags || []);
  state.inspector.draftFields = draftFields;
  state.inspector.baseVersion = Number(item.version || 0);
  state.inspector.metadataEdit = false;
  state.inspector.status = "idle";
  state.inspector.message = "";
}

function markInspectorDirty(message = "") {
  state.inspector.status = "dirty";
  state.inspector.message = message;
}

function applyInspectorDraftToCurrentItem() {
  const item = state.selectedItem;
  if (!item?.key || state.inspector.draftItemKey !== item.key) return;
  item.abstract = state.inspector.draftAbstract;
  item.tags = state.inspector.draftTags.slice();
  const fields = state.inspector.draftFields || {};
  const applyFields = (row) => {
    if (!row) return;
    if (typeof fields.title === "string") row.title = fields.title;
    if (typeof fields.publicationTitle === "string") {
      row.publicationTitle = fields.publicationTitle;
      row.containerTitle = fields.publicationTitle;
    }
    if (typeof fields.date === "string") {
      row.date = fields.date;
      row.year = fields.date;
    }
    if (typeof fields.publisher === "string") row.publisher = fields.publisher;
    if (typeof fields.place === "string") row.place = fields.place;
    if (typeof fields.volume === "string") row.volume = fields.volume;
    if (typeof fields.issue === "string") row.issue = fields.issue;
    if (typeof fields.pages === "string") row.pages = fields.pages;
    if (typeof fields.language === "string") row.language = fields.language;
    if (typeof fields.doi === "string") row.doi = fields.doi;
    if (typeof fields.url === "string") row.url = fields.url;
    if (typeof fields.issn === "string") row.issn = fields.issn;
    if (typeof fields.isbn === "string") row.isbn = fields.isbn;
    if (typeof fields.edition === "string") row.edition = fields.edition;
    if (typeof fields.series === "string") row.series = fields.series;
    if (typeof fields.callNumber === "string") row.callNumber = fields.callNumber;
    if (typeof fields.libraryCatalog === "string") row.libraryCatalog = fields.libraryCatalog;
    if (typeof fields.archive === "string") row.archive = fields.archive;
    if (typeof fields.archiveLocation === "string") row.archiveLocation = fields.archiveLocation;
    if (typeof fields.section === "string") row.section = fields.section;
    if (typeof fields.extra === "string") row.extra = fields.extra;
  };
  if (typeof fields.title === "string") item.title = fields.title;
  if (typeof fields.publicationTitle === "string") {
    item.publicationTitle = fields.publicationTitle;
    item.containerTitle = fields.publicationTitle;
  }
  if (typeof fields.date === "string") {
    item.date = fields.date;
    item.year = fields.date;
  }
  if (typeof fields.publisher === "string") item.publisher = fields.publisher;
  if (typeof fields.place === "string") item.place = fields.place;
  if (typeof fields.volume === "string") item.volume = fields.volume;
  if (typeof fields.issue === "string") item.issue = fields.issue;
  if (typeof fields.pages === "string") item.pages = fields.pages;
  if (typeof fields.language === "string") item.language = fields.language;
  if (typeof fields.doi === "string") item.doi = fields.doi;
  if (typeof fields.url === "string") item.url = fields.url;
  if (typeof fields.issn === "string") item.issn = fields.issn;
  if (typeof fields.isbn === "string") item.isbn = fields.isbn;
  if (typeof fields.edition === "string") item.edition = fields.edition;
  if (typeof fields.series === "string") item.series = fields.series;
  if (typeof fields.callNumber === "string") item.callNumber = fields.callNumber;
  if (typeof fields.libraryCatalog === "string") item.libraryCatalog = fields.libraryCatalog;
  if (typeof fields.archive === "string") item.archive = fields.archive;
  if (typeof fields.archiveLocation === "string") item.archiveLocation = fields.archiveLocation;
  if (typeof fields.section === "string") item.section = fields.section;
  if (typeof fields.extra === "string") item.extra = fields.extra;
  applyFields(item);
  const key = item.key;
  state.items.forEach((row) => {
    if (row?.key === key) {
      row.abstract = item.abstract;
      row.tags = item.tags.slice();
      applyFields(row);
    }
  });
  for (const rows of state.treeItemsByCollection.values()) {
    rows.forEach((row) => {
      if (row?.key === key) {
        row.abstract = item.abstract;
        row.tags = item.tags.slice();
        applyFields(row);
      }
    });
  }
}

function scheduleInspectorSync(reason = "auto") {
  clearInspectorSyncTimer();
  if (!state.inspector.autoSync) return;
  state.inspector.syncTimer = setTimeout(() => {
    void runInspectorSync(reason);
  }, 900);
}

async function runInspectorSync(reason = "manual") {
  const item = state.selectedItem;
  if (!item?.key || state.inspector.draftItemKey !== item.key) return;
  clearInspectorSyncTimer();
  state.inspector.status = "syncing";
  state.inspector.message = "";
  updateInspectorStatusNode();

  const payload = {
    itemKey: item.key,
    abstract: state.inspector.draftAbstract,
    tags: state.inspector.draftTags.slice(),
    fields: { ...(state.inspector.draftFields || {}) },
    baseVersion: Number(state.inspector.baseVersion || item.version || 0)
  };
  dbg(
    "runInspectorSync",
    `start reason=${reason} itemKey=${payload.itemKey} tags=${payload.tags.length} fields=${
      Object.keys(payload.fields || {}).length
    } abstractLen=${payload.abstract.length}`
  );
  const res = await window.zoteroBridge.updateItemMetadata(payload);
  if (res?.status !== "ok") {
    state.inspector.status = res?.code === "conflict" ? "conflict" : "error";
    state.inspector.message = res?.message || "Sync failed";
    dbg("runInspectorSync", `error itemKey=${payload.itemKey} message=${state.inspector.message}`);
    updateInspectorStatusNode();
    setStatus(state.inspector.message, "err");
    return;
  }

  if (res.item) state.selectedItem = { ...state.selectedItem, ...res.item };
  state.inspector.baseVersion = Number(res?.item?.version || state.selectedItem?.version || payload.baseVersion || 0);
  state.inspector.lastSyncedAt = Date.now();
  state.inspector.status = "synced";
  state.inspector.message = "";
  applyInspectorDraftToCurrentItem();
  dbg(
    "runInspectorSync",
    `done reason=${reason} itemKey=${payload.itemKey} version=${state.inspector.baseVersion} tags=${state.inspector.draftTags.length}`
  );
  updateInspectorStatusNode();
  setStatus("Inspector synced to Zotero.", "ok");
}

function renderCollectionDetailsHtml(coll) {
  if (!coll) return "<div class='meta'>No collection selected.</div>";
  const childCount = state.collections.filter((c) => c.parentKey === coll.key).length;
  const loadedInPanel = state.itemsCollectionKey === coll.key ? state.items.length : 0;
  const treeCached = (state.treeItemsByCollection.get(coll.key) || []).length;
  const rows = [
    ["Name", coll.name || "Untitled"],
    ["Parent Key", coll.parentKey || "(root)"],
    ["Version", coll.version || ""],
    ["Subcollections", childCount],
    ["Items in Panel", loadedInPanel],
    ["Items in Tree Cache", treeCached]
  ]
    .map(
      ([label, value]) =>
        `<div class="inspector-krow cat-system"><span class="inspector-klabel">${escapeHtml(label)}</span><span class="inspector-kval">${escapeHtml(
          String(value)
        )}</span></div>`
    )
    .join("");
  const collLink = collectionZoteroUrlByKey(coll.key);
  return `
    <section class="inspector-block">
      <h4>Collection</h4>
      <div class="inspector-kv">${rows}</div>
      <div class="detail-tags inspector-links-row">
        ${
          collLink
            ? `<a class="detail-link" href="${escapeHtml(collLink)}" target="_blank" rel="noreferrer noopener">Open in Zotero</a>`
            : "<span class='meta'>Collection URL unavailable</span>"
        }
      </div>
    </section>
  `;
}

function renderItemDetailsHtml(item) {
  if (!item) return "<div class='meta'>No item selected.</div>";
  ensureInspectorDraftForSelectedItem();

  const creatorList = Array.isArray(item.creators)
    ? item.creators
        .map((creator) => {
          const name = String(creator?.name || "").trim();
          if (!name) return "";
          const role = String(creator?.creatorType || "").trim();
          return `${role ? `${role}: ` : ""}${name}`;
        })
        .filter(Boolean)
    : [];

  const templateName = inspectorTemplateForType(item.itemType);
  const templateKeys = [
    ...(INSPECTOR_TEMPLATE_KEYS[templateName] || []),
    "language",
    "dateModified",
    "citationCount",
    "libraryCatalog",
    "callNumber",
    "archive",
    "archiveLocation",
    "key"
  ];
  const seenKeys = new Set();
  const fieldRows = templateKeys
    .filter((key) => {
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return Boolean(INSPECTOR_FIELD_META[key]);
    })
    .map((key) => {
      const meta = INSPECTOR_FIELD_META[key];
      const draftVal = state.inspector.draftFields?.[key];
      const baseVal = inspectorValueFromItem(item, key, creatorList);
      const value = meta?.editable && typeof draftVal === "string" ? draftVal : baseVal;
      return { key, meta, value };
    })
    .filter((row) => String(row.value || "").trim())
    .map(
      (row) =>
        `<div class="inspector-krow cat-${escapeHtml(row.meta.category || "system")}"><span class="inspector-klabel">${renderIcon(
          row.meta.icon || "file-text",
          "inspector-kicon"
        )}<span>${escapeHtml(row.meta.label || row.key)}</span></span><span class="inspector-kval">${escapeHtml(
          String(row.value)
        )}</span></div>`
    )
    .join("");

  const abstractText = String(item.abstract || "").trim();
  const abstractHtml = abstractText
    ? `<div class="detail-abstract">${escapeHtml(abstractText)}</div>`
    : "<div class='meta'>No abstract</div>";

  const links = [
    ["Open in Zotero", selectedItemZoteroUrl()],
    ["Open URL", item.url || ""],
    ["Open DOI", selectedItemDoiUrl()],
    ["Open PDF", selectedItemPdfUrl()]
  ]
    .filter((entry) => entry[1])
    .map(
      ([label, href]) =>
        `<a class="detail-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`
    )
    .join("");
  return `
    <div class="detail-hero inspector-hero">
      <div class="detail-hero-title">${escapeHtml(item.title || "(untitled)")}</div>
      <div class="detail-hero-sub">${escapeHtml(item.itemType || "item")} • ${escapeHtml(item.date || item.year || "n.d.")}</div>
      <div class="detail-tags">
        ${item.pdfs > 0 ? `<span class="type-pill">PDF ${item.pdfs}</span>` : ""}
        ${item.attachments > 0 ? `<span class="type-pill">ATT ${item.attachments}</span>` : ""}
        ${item.notes > 0 ? `<span class="type-pill">NOTES ${item.notes}</span>` : ""}
      </div>
    </div>
    <section class="inspector-block">
      <h4>Bibliographic Info</h4>
      <div class="inspector-kv">${fieldRows || "<div class='meta'>No bibliographic data</div>"}</div>
    </section>
    <section class="inspector-block">
      <h4>Abstract</h4>
      ${abstractHtml}
    </section>
    <section class="inspector-block">
      <h4>Links</h4>
      <div class="detail-tags">${links || "<span class='meta'>No links available</span>"}</div>
    </section>
  `;
}

function renderMetadataDetailsHtml(item) {
  if (!item?.key) return "No item selected";
  const draftTags = state.inspector.draftTags || [];
  const draftExtra =
    typeof state.inspector.draftFields?.extra === "string"
      ? state.inspector.draftFields.extra
      : String(item.extra || "");
  const editMode = state.inspector.metadataEdit === true;
  const tagsView = draftTags.length
    ? draftTags.map((tag) => `<span class="type-pill ${tagToneClass(tag)}">${escapeHtml(tag)}</span>`).join("")
    : "<span class='meta'>No tags</span>";
  const tagsEditor = draftTags.length
    ? draftTags
        .map(
          (tag) =>
            `<button type="button" class="inspector-tag-chip ${tagToneClass(tag)}" data-tag-remove="${escapeHtml(tag)}">${escapeHtml(tag)} <span>×</span></button>`
        )
        .join("")
    : "<span class='meta'>No tags</span>";
  const statusText = inspectorStatusText();
  return `
    <section class="inspector-block">
      <h4>Live Metadata</h4>
      <div class="inspector-edit-banner ${editMode ? "is-editing" : ""}">
        <strong>${editMode ? "Editing Mode" : "Read Mode"}</strong>
        <span>${editMode ? "Changes are live and sync automatically when Auto Sync is on." : "Double-click this panel or click Edit to modify tags/extra."}</span>
      </div>
      <div class="inspector-sync-bar">
        <span id="inspectorSyncStatus" class="meta">${escapeHtml(statusText)}</span>
        <button type="button" id="btnInspectorAutoSync" class="secondary-btn">${state.inspector.autoSync ? "Auto Sync: On" : "Auto Sync: Off"}</button>
        <button type="button" id="btnInspectorSaveNow">Sync Now</button>
        <button type="button" id="btnInspectorRevert">Revert</button>
        <button type="button" id="btnInspectorEditMeta" class="secondary-btn">${editMode ? "Editing" : "Edit (Double-click)"}</button>
        ${editMode ? '<button type="button" id="btnInspectorDoneEdit">Done Editing</button>' : ""}
      </div>
    </section>
    <section class="inspector-block">
      <h4>Tags</h4>
      ${
        editMode
          ? `<div class="inspector-editor-grid">
               <label class="inspector-field">
                 <span>Add/Replace Tags</span>
                 <input id="inspectorTagsInput" type="text" placeholder="tag1, tag2, tag3" value="${escapeHtml(draftTags.join(", "))}" />
               </label>
               <div class="inspector-editor-actions">
                 <button type="button" id="btnInspectorApplyTags">Apply Tags</button>
                 <button type="button" id="btnInspectorClearTags" class="secondary-btn">Clear Tags</button>
               </div>
               <div class="detail-tags">${tagsEditor}</div>
             </div>`
          : `<div class="detail-tags">${tagsView}</div>`
      }
    </section>
    <section class="inspector-block">
      <h4>Extra</h4>
      ${
        editMode
          ? `<label class="inspector-field">
               <span>Extra</span>
               <textarea id="inspectorExtraInput" placeholder="Edit extra">${escapeHtml(draftExtra)}</textarea>
             </label>`
          : draftExtra.trim()
            ? `<div class="detail-abstract">${escapeHtml(draftExtra)}</div>`
            : "<div class='meta'>No extra field</div>"
      }
      <div class="meta inspector-meta-hint">${editMode ? "Live editing enabled." : "Double-click this tab to edit tags and extra."}</div>
    </section>
  `;
}

function updateCounters() {
  if (els.chipCollections) els.chipCollections.textContent = `Collections: ${state.collections.length}`;
  if (els.chipItems) els.chipItems.textContent = `Items: ${state.items.length}`;
  if (els.chipChildren) els.chipChildren.textContent = `Children: ${state.itemChildren.length}`;
  const errBit = state.sync.lastError ? " (error)" : "";
  if (els.chipSync) els.chipSync.textContent = `Sync: ${state.sync.state}${errBit}`;
  const voiceBits = [];
  if (state.voice.voiceModeOn) voiceBits.push(state.voice.listeningVoice ? "mode:listening" : "mode:on");
  if (state.voice.dictationOn) voiceBits.push(state.voice.listeningDictation ? "dictation:listening" : "dictation:on");
  if (!voiceBits.length) voiceBits.push("off");
  if (!state.voice.supported) voiceBits.push("unsupported");
  if (els.chipVoice) els.chipVoice.textContent = `Voice: ${voiceBits.join(" | ")}`;
}

function updateSelectionBanner() {
  const coll = selectedCollection();
  const item = state.selectedItem;
  const bits = [];
  if (coll) bits.push(`Collection: ${coll.name}`);
  if (item) bits.push(`Item: ${item.title || item.key}`);
  if (state.advanced.active) bits.push(`Advanced: ${state.advanced.query || "on"}`);
  els.activeSelection.textContent = bits.length ? bits.join(" • ") : "No active selection";
}

function updateActionStates() {
  const hasCollection = Boolean(state.selectedCollectionKey);
  const hasItem = Boolean(state.selectedItem?.key);
  const hasItemUrl = Boolean(state.selectedItem?.url);
  const hasDoi = Boolean(selectedItemDoiUrl());
  const hasPdf = Boolean(selectedItemPdfUrl());

  [
    els.btnCopyCollectionKey,
    els.btnOpenCollection,
    els.btnCollectionLoadCache,
    els.btnCollectionLoadFresh,
    els.btnCollectionOpen,
    els.btnCollectionCopy,
    els.btnLoadItems,
    els.btnLoadItemsFresh
  ].forEach((btn) => {
    if (btn) btn.disabled = !hasCollection;
  });

  if (els.btnItemOpenZotero) els.btnItemOpenZotero.disabled = !hasItem;
  if (els.btnItemOpenUrl) els.btnItemOpenUrl.disabled = !hasItemUrl;
  if (els.btnItemOpenDoi) els.btnItemOpenDoi.disabled = !hasDoi;
  if (els.btnItemOpenPdf) els.btnItemOpenPdf.disabled = !hasPdf;
  if (els.btnItemChildren) els.btnItemChildren.disabled = !hasItem;
  if (els.btnItemCopy) els.btnItemCopy.disabled = !hasItem;
  if (els.btnOpenReader) els.btnOpenReader.disabled = !hasItem;
  if (els.btnVoiceMode) els.btnVoiceMode.disabled = !state.voice.supported;
  if (els.btnDictation) els.btnDictation.disabled = !state.voice.supported;
}

function renderStateCard(title, detail, tone = "") {
  const safeTitle = escapeHtml(title || "");
  const safeDetail = escapeHtml(detail || "");
  const klass = tone ? ` ${tone}` : "";
  return `<div class="state-card${klass}"><div class="state-card-title">${safeTitle}</div><div class="state-card-detail">${safeDetail}</div></div>`;
}

function persistUiState() {
  try {
    const paneWeights = normalizedPaneWeights(state.layout);
    applyPaneWeightState(paneWeights);
    const payload = {
      expanded: Array.from(state.expanded),
      selectedCollectionKey: state.selectedCollectionKey || "",
      selectedItemKey: state.selectedItem?.key || "",
      collectionSearch: state.collectionSearch || "",
      itemSearch: state.itemSearch || "",
      virtualRowHeight: state.virtual.rowHeight,
      profileByFeature: state.ribbon.profileByFeature || {},
      accessLevel: state.ribbon.accessLevel || "safe",
      inspectorAutoSync: Boolean(state.inspector.autoSync),
      inspectorDensity:
        state.inspector.density === "compact" || state.inspector.density === "ultra"
          ? state.inspector.density
          : "comfortable",
      inspectorTab: state.inspector.viewTab || "item",
      tableSortKey: state.itemsTable.sortKey || "title",
      tableSortDir: state.itemsTable.sortDir || "asc",
      tableColumnOrder: Array.isArray(state.itemsTable.columnOrder) ? state.itemsTable.columnOrder : [],
      tableColumnWidths: state.itemsTable.columnWidths || {},
      paneLeft: paneWeights.paneLeft,
      paneMid: paneWeights.paneMid,
      paneRight: paneWeights.paneRight,
      hideLeft: Boolean(state.layout.hideLeft),
      hideMid: Boolean(state.layout.hideMid),
      hideRight: Boolean(state.layout.hideRight),
      showFeatureJobs: Boolean(state.batch.showFeatureJobs),
      showBatchMonitor: Boolean(state.batch.showBatchMonitor),
      batchMonitorCollapsed: Boolean(state.batch.monitorCollapsed),
      pendingIntent: state.chat.pendingIntent || null,
      leftRailSavedExpanded: Boolean(state.leftRail.savedExpanded),
      leftRailTagsExpanded: Boolean(state.leftRail.tagsExpanded),
      leftRailSelectedTags: Array.isArray(state.leftRail.selectedTags) ? state.leftRail.selectedTags.slice(0, 30) : [],
      leftRailTagMode: state.leftRail.tagMode === "any" ? "any" : "all",
      leftRailTagScope: "collection",
      leftRailTagSearch: state.leftRail.tagSearch || "",
      leftRailTagLimit: Number(state.leftRail.tagLimit || 120),
      workspaceTab: state.workspace.activeTab === "batches" ? "batches" : "home",
      batchExplorerSelectedBatchId: state.batchExplorer.selectedBatchId || "",
      batchExplorerSortKey: state.batchExplorer.sortKey || "confidence",
      batchExplorerSortDir: state.batchExplorer.sortDir === "asc" ? "asc" : "desc",
      featureHistory: (state.ribbon.featureHistory || []).slice(-100)
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // noop
  }
}

function restoreUiState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.expanded)) state.expanded = new Set(parsed.expanded);
    if (typeof parsed?.selectedCollectionKey === "string") state.selectedCollectionKey = parsed.selectedCollectionKey;
    if (parsed?.pendingIntent && typeof parsed.pendingIntent === "object") {
      state.chat.pendingIntent = parsed.pendingIntent;
    }
    if (typeof parsed?.collectionSearch === "string") {
      state.collectionSearch = parsed.collectionSearch.toLowerCase();
      els.collectionSearch.value = parsed.collectionSearch;
    }
    if (typeof parsed?.itemSearch === "string") {
      state.itemSearch = parsed.itemSearch.toLowerCase();
      els.itemSearch.value = parsed.itemSearch;
    }
    if (parsed?.profileByFeature && typeof parsed.profileByFeature === "object") {
      state.ribbon.profileByFeature = parsed.profileByFeature;
    }
    if (typeof parsed?.accessLevel === "string") {
      state.ribbon.accessLevel = parsed.accessLevel;
    }
    if (typeof parsed?.inspectorAutoSync === "boolean") {
      state.inspector.autoSync = parsed.inspectorAutoSync;
    }
    if (parsed?.inspectorDensity === "compact" || parsed?.inspectorDensity === "comfortable" || parsed?.inspectorDensity === "ultra") {
      state.inspector.density = parsed.inspectorDensity;
    }
    if (typeof parsed?.inspectorTab === "string") {
      setInspectorTab(parsed.inspectorTab);
    }
    if (typeof parsed?.tableSortKey === "string") {
      state.itemsTable.sortKey = parsed.tableSortKey;
    }
    if (typeof parsed?.tableSortDir === "string") {
      state.itemsTable.sortDir = parsed.tableSortDir === "desc" ? "desc" : "asc";
    }
    if (Array.isArray(parsed?.tableColumnOrder) && parsed.tableColumnOrder.length) {
      state.itemsTable.columnOrder = parsed.tableColumnOrder.slice();
    }
    if (parsed?.tableColumnWidths && typeof parsed.tableColumnWidths === "object") {
      state.itemsTable.columnWidths = {
        ...state.itemsTable.columnWidths,
        ...parsed.tableColumnWidths
      };
    }
    applyPaneWeightState(parsed);
    if (typeof parsed?.hideLeft === "boolean") state.layout.hideLeft = parsed.hideLeft;
    if (typeof parsed?.hideMid === "boolean") state.layout.hideMid = parsed.hideMid;
    if (typeof parsed?.hideRight === "boolean") state.layout.hideRight = parsed.hideRight;
    if (typeof parsed?.showFeatureJobs === "boolean") state.batch.showFeatureJobs = parsed.showFeatureJobs;
    if (typeof parsed?.showBatchMonitor === "boolean") state.batch.showBatchMonitor = parsed.showBatchMonitor;
    if (typeof parsed?.batchMonitorCollapsed === "boolean") state.batch.monitorCollapsed = parsed.batchMonitorCollapsed;
    if (typeof parsed?.leftRailSavedExpanded === "boolean") state.leftRail.savedExpanded = parsed.leftRailSavedExpanded;
    if (typeof parsed?.leftRailTagsExpanded === "boolean") state.leftRail.tagsExpanded = parsed.leftRailTagsExpanded;
    if (Array.isArray(parsed?.leftRailSelectedTags)) {
      state.leftRail.selectedTags = parsed.leftRailSelectedTags
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .slice(0, 30);
    }
    if (parsed?.leftRailTagMode === "any" || parsed?.leftRailTagMode === "all") state.leftRail.tagMode = parsed.leftRailTagMode;
    state.leftRail.tagScope = "collection";
    if (typeof parsed?.leftRailTagSearch === "string") state.leftRail.tagSearch = parsed.leftRailTagSearch;
    if (Number.isFinite(Number(parsed?.leftRailTagLimit))) {
      state.leftRail.tagLimit = Math.max(20, Math.min(500, Number(parsed.leftRailTagLimit)));
    }
    if (parsed?.workspaceTab === "batches" || parsed?.workspaceTab === "home") {
      state.workspace.activeTab = parsed.workspaceTab;
    }
    if (typeof parsed?.batchExplorerSelectedBatchId === "string") {
      state.batchExplorer.selectedBatchId = parsed.batchExplorerSelectedBatchId;
    }
    if (typeof parsed?.batchExplorerSortKey === "string") {
      state.batchExplorer.sortKey = parsed.batchExplorerSortKey;
    }
    if (parsed?.batchExplorerSortDir === "asc" || parsed?.batchExplorerSortDir === "desc") {
      state.batchExplorer.sortDir = parsed.batchExplorerSortDir;
    }
    if (Array.isArray(parsed?.featureHistory)) {
      state.ribbon.featureHistory = parsed.featureHistory.slice(-100);
    }
  } catch {
    // noop
  }
}

function collectionMatch(collection, query, pathLookup = null) {
  if (!query) return true;
  const path = pathLookup?.get?.(collection?.key) || "";
  const text = `${collection.name || ""} ${collection.key || ""} ${path}`.toLowerCase();
  return text.includes(query);
}

function treeItemMatch(item, query) {
  if (!query) return true;
  const text = `${item.title || ""} ${item.authors || ""} ${item.key || ""} ${item.itemType || ""}`.toLowerCase();
  return text.includes(query);
}

function itemMatch(item, query) {
  if (!query) return true;
  const text = `${item.title || ""} ${item.authors || ""} ${item.doi || ""} ${item.itemType || ""}`.toLowerCase();
  return text.includes(query);
}

function itemMatchesSelectedTags(item) {
  const selected = Array.isArray(state.leftRail.selectedTags) ? state.leftRail.selectedTags : [];
  if (!selected.length) return true;
  const tags = new Set(
    (Array.isArray(item?.tags) ? item.tags : [])
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (state.leftRail.tagMode === "any") {
    return selected.some((tag) => tags.has(String(tag).toLowerCase()));
  }
  return selected.every((tag) => tags.has(String(tag).toLowerCase()));
}

function filteredItemsSource() {
  return state.items.filter((item) => itemMatchesSelectedTags(item));
}

function tableSortValue(item, key) {
  if (!item) return "";
  if (key === "year") return Number.parseInt(String(item.year || "").slice(0, 4), 10) || 0;
  if (key === "dateModified") return String(item.dateModified || "");
  return String(item[key] || "").toLowerCase();
}

function sortedItems(rows) {
  const sortKey = state.itemsTable.sortKey || "title";
  const sortDir = state.itemsTable.sortDir === "desc" ? "desc" : "asc";
  const factor = sortDir === "desc" ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const av = tableSortValue(a, sortKey);
    const bv = tableSortValue(b, sortKey);
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return String(a?.title || "").localeCompare(String(b?.title || "")) * factor;
  });
}

function visibleSortedItems() {
  return sortedItems(filteredItemsSource().filter((item) => itemMatch(item, state.itemSearch)));
}

async function refreshTagFacets() {
  const token = ++requestTokens.tags;
  const selectedCollectionKey = state.selectedCollectionKey || "";
  if (state.leftRail.tagLoading && state.leftRail.tagLoadingKey === selectedCollectionKey) {
    dbg("refreshTagFacets", `deduped collectionKey=${selectedCollectionKey || "(none)"}`);
    return;
  }
  state.leftRail.tagLoading = true;
  state.leftRail.tagLoadingKey = selectedCollectionKey;
  renderCollections();
  try {
    const res = await window.zoteroBridge.getTagFacets({
      limit: 300,
      scope: "collection",
      collectionKey: selectedCollectionKey,
      refresh: false
    });
    if (token !== requestTokens.tags) return;
    if (res?.status !== "ok") {
      dbg("refreshTagFacets", `error message=${res?.message || "unknown"}`);
      setStatus(res?.message || "Failed to load tag facets.", "warn");
      return;
    }
    state.leftRail.tagCatalog = Array.isArray(res.tags) ? res.tags : [];
    dbg(
      "refreshTagFacets",
      `done tags=${state.leftRail.tagCatalog.length} selected=${state.leftRail.selectedTags.length} itemsScanned=${Number(
        res.itemsScanned || 0
      )}`
    );
  } catch (error) {
    if (token !== requestTokens.tags) return;
    const message = error?.message || "Failed to load tag facets.";
    dbg("refreshTagFacets", `exception message=${message}`);
    setStatus(message, "warn");
  } finally {
    if (token === requestTokens.tags) {
      state.leftRail.tagLoading = false;
      state.leftRail.tagLoadingKey = "";
      renderCollections();
    }
  }
}

async function refreshCollectionTagPresence() {
  const token = ++requestTokens.collectionTags;
  const collectionKey = state.selectedCollectionKey || "";
  if (!collectionKey) {
    state.leftRail.collectionTagSet = [];
    state.leftRail.collectionTagCounts = {};
    state.leftRail.collectionTagLoaded = false;
    state.leftRail.collectionTagLoading = false;
    renderCollections();
    return;
  }
  const cacheEntry = state.leftRail.collectionTagCache?.[collectionKey];
  if (cacheEntry && Array.isArray(cacheEntry.set)) {
    state.leftRail.collectionTagSet = cacheEntry.set.slice();
    state.leftRail.collectionTagCounts = { ...(cacheEntry.counts || {}) };
    state.leftRail.collectionTagLoaded = true;
    renderCollections();
  } else {
    state.leftRail.collectionTagLoaded = false;
  }
  if (state.leftRail.collectionTagLoading && state.leftRail.collectionTagLoadingKey === collectionKey) {
    dbg("refreshCollectionTagPresence", `deduped collectionKey=${collectionKey}`);
    return;
  }
  state.leftRail.collectionTagLoading = true;
  state.leftRail.collectionTagLoadingKey = collectionKey;
  try {
    const res = await window.zoteroBridge.getTagFacets({
      limit: 2000,
      scope: "collection",
      collectionKey
    });
    if (token !== requestTokens.collectionTags) return;
    if (res?.status !== "ok") {
      state.leftRail.collectionTagSet = cacheEntry?.set ? cacheEntry.set.slice() : [];
      state.leftRail.collectionTagCounts = { ...(cacheEntry?.counts || {}) };
      state.leftRail.collectionTagLoaded = Boolean(cacheEntry);
      state.leftRail.collectionTagLoading = false;
      return;
    }
    const rows = Array.isArray(res.tags) ? res.tags : [];
    const set = new Set(
      rows
        .map((row) => String(row?.tag || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const counts = {};
    rows.forEach((row) => {
      const tag = String(row?.tag || "").trim().toLowerCase();
      if (!tag) return;
      counts[tag] = Number(row?.count || 0);
    });
    state.leftRail.collectionTagSet = Array.from(set);
    state.leftRail.collectionTagCounts = counts;
    state.leftRail.collectionTagLoaded = true;
    state.leftRail.collectionTagLoading = false;
    state.leftRail.collectionTagCache[collectionKey] = {
      set: state.leftRail.collectionTagSet.slice(),
      counts: { ...counts }
    };
    if (state.leftRail.selectedTags.length) {
      const next = state.leftRail.selectedTags.filter((tag) => set.has(String(tag || "").toLowerCase()));
      if (next.length !== state.leftRail.selectedTags.length) {
        state.leftRail.selectedTags = next;
        if (next.length) await applyTagFilterFromSelection();
        else {
          state.items = [];
          state.itemsCollectionKey = "";
          state.itemsLoading = false;
          await loadItems(false);
        }
      }
    }
  } catch (error) {
    if (token !== requestTokens.collectionTags) return;
    dbg("refreshCollectionTagPresence", `exception message=${error?.message || "unknown"}`);
    state.leftRail.collectionTagSet = cacheEntry?.set ? cacheEntry.set.slice() : [];
    state.leftRail.collectionTagCounts = { ...(cacheEntry?.counts || {}) };
    state.leftRail.collectionTagLoaded = Boolean(cacheEntry);
    state.leftRail.collectionTagLoading = false;
  }
  if (token === requestTokens.collectionTags) {
    state.leftRail.collectionTagLoading = false;
    state.leftRail.collectionTagLoadingKey = "";
    renderCollections();
  }
}

function visibleTagCatalog() {
  const q = String(state.leftRail.tagSearch || "").trim().toLowerCase();
  const limit = Math.max(20, Math.min(500, Number(state.leftRail.tagLimit || 120)));
  const rows = Array.isArray(state.leftRail.tagCatalog) ? state.leftRail.tagCatalog : [];
  const filtered = q
    ? rows.filter((row) => String(row?.tag || "").toLowerCase().includes(q))
    : rows;
  return filtered.slice(0, limit);
}

function renderItemsActiveFilters() {
  if (!els.itemsActiveFilters) return;
  const selected = Array.isArray(state.leftRail.selectedTags) ? state.leftRail.selectedTags : [];
  if (!selected.length) {
    els.itemsActiveFilters.innerHTML = "";
    return;
  }
  const chips = selected
    .map((tag) => `<button type="button" class="type-pill ${tagToneClass(tag)}" data-filter-tag-remove="${escapeHtml(tag)}">${escapeHtml(tag)} ×</button>`)
    .join("");
  els.itemsActiveFilters.innerHTML = `
    <div class="items-filter-bar">
      <span class="meta">Tag Filter • Collection • ${state.leftRail.tagMode === "any" ? "Any" : "All"}</span>
      ${chips}
      <button type="button" class="secondary-btn" data-filter-clear-tags>Clear</button>
    </div>
  `;
}

async function applyTagFilterFromSelection() {
  const selected = Array.isArray(state.leftRail.selectedTags) ? state.leftRail.selectedTags : [];
  if (!selected.length) {
    renderItems();
    renderCollections();
    persistUiState();
    return;
  }
  const res = await window.zoteroBridge.getItemsByTags({
    tags: selected,
    mode: state.leftRail.tagMode === "any" ? "any" : "all",
    scope: "collection",
    collectionKey: state.selectedCollectionKey || "",
    limit: 5000
  });
  if (res?.status !== "ok") {
    dbg("applyTagFilterFromSelection", `error tags=${selected.length} message=${res?.message || "unknown"}`);
    setStatus(res?.message || "Failed to apply tag filter.", "err");
    return;
  }
  state.items = Array.isArray(res.items) ? res.items : [];
  state.itemSearch = "";
  if (els.itemSearch) els.itemSearch.value = "";
  state.itemsCollectionKey = "";
  state.itemsLoading = false;
  state.selectedItem = state.items[0] || null;
  state.itemsTable.selectedKeys.clear();
  state.itemsTable.anchorKey = state.selectedItem?.key || "";
  if (state.selectedItem?.key) state.itemsTable.selectedKeys.add(state.selectedItem.key);
  state.itemChildren = [];
  state.advanced.active = false;
  setStatus(`Tag filter (Collection) active: ${selected.join(", ")} (${state.items.length} items).`, "ok");
  dbg("applyTagFilterFromSelection", `done tags=${selected.length} items=${state.items.length}`);
  renderItems();
  renderDetails();
  renderCollections();
  persistUiState();
}

function moveTableSelection(delta, extendRange = false) {
  const rows = visibleSortedItems();
  if (!rows.length) return;
  const currentKey = state.selectedItem?.key || rows[0].key;
  const currentIdx = Math.max(0, rows.findIndex((r) => r.key === currentKey));
  const nextIdx = Math.max(0, Math.min(rows.length - 1, currentIdx + delta));
  const next = rows[nextIdx];
  if (!next) return;

  if (extendRange && state.itemsTable.anchorKey) {
    const anchorIdx = rows.findIndex((r) => r.key === state.itemsTable.anchorKey);
    const start = Math.min(anchorIdx >= 0 ? anchorIdx : nextIdx, nextIdx);
    const end = Math.max(anchorIdx >= 0 ? anchorIdx : nextIdx, nextIdx);
    state.itemsTable.selectedKeys.clear();
    rows.slice(start, end + 1).forEach((r) => state.itemsTable.selectedKeys.add(r.key));
  } else {
    state.itemsTable.selectedKeys.clear();
    state.itemsTable.selectedKeys.add(next.key);
    state.itemsTable.anchorKey = next.key;
  }

  state.selectedItem = next;
  state.itemChildren = [];
  const rowHeight = Number(state.itemsTable.rowHeight || 34);
  if (els.itemsList) {
    const targetTop = Math.max(0, nextIdx * rowHeight - rowHeight * 2);
    els.itemsList.scrollTop = targetTop;
    state.virtual.scrollTop = targetTop;
  }
  renderItems();
  renderDetails();
}

function applyPaneWidths() {
  const paneWeights = normalizedPaneWeights(state.layout);
  applyPaneWeightState(paneWeights);
  const left = paneWeights.paneLeft;
  const mid = paneWeights.paneMid;
  const right = paneWeights.paneRight;
  if (Number(state.layout.hideLeft) + Number(state.layout.hideMid) + Number(state.layout.hideRight) >= 3) {
    state.layout.hideRight = false;
  }
  const hideLeft = Boolean(state.layout.hideLeft);
  const hideMid = Boolean(state.layout.hideMid);
  const hideRight = Boolean(state.layout.hideRight);

  if (els.paneCollections) els.paneCollections.style.display = hideLeft ? "none" : "";
  if (els.paneItems) els.paneItems.style.display = hideMid ? "none" : "";
  if (els.paneDetails) els.paneDetails.style.display = hideRight ? "none" : "";
  if (els.splitterLeft) els.splitterLeft.style.display = hideLeft || hideMid ? "none" : "";
  if (els.splitterRight) els.splitterRight.style.display = hideMid || hideRight ? "none" : "";

  const columns = [];
  if (!hideLeft) columns.push(`minmax(260px, ${left}fr)`);
  if (!hideLeft && !hideMid) columns.push("8px");
  if (!hideMid) columns.push(`minmax(360px, ${mid}fr)`);
  if (!hideMid && !hideRight) columns.push("8px");
  if (!hideRight) columns.push(`minmax(300px, ${right}fr)`);
  els.layoutRoot.style.gridTemplateColumns = columns.length ? columns.join(" ") : "1fr";

  if (els.btnToggleCollections) {
    els.btnToggleCollections.textContent = hideLeft ? "Collections: Hidden" : "Collections: Visible";
    els.btnToggleCollections.setAttribute("data-icon-hydrated", "0");
  }
  if (els.btnToggleItems) {
    els.btnToggleItems.textContent = hideMid ? "Items: Hidden" : "Items: Visible";
    els.btnToggleItems.setAttribute("data-icon-hydrated", "0");
  }
  if (els.btnToggleInspector) {
    els.btnToggleInspector.textContent = hideRight ? "Inspector: Hidden" : "Inspector: Visible";
    els.btnToggleInspector.setAttribute("data-icon-hydrated", "0");
  }
}

function topTagsForRail(limit = 12) {
  const source =
    state.items.length > 0
      ? state.items
      : state.selectedCollectionKey
        ? state.treeItemsByCollection.get(state.selectedCollectionKey) || []
        : [];
  const counts = new Map();
  source.forEach((item) => {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    tags.forEach((tag) => {
      const clean = String(tag || "").trim();
      if (!clean) return;
      counts.set(clean, (counts.get(clean) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, limit));
}

function tagToneClass(tag) {
  const text = String(tag || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  const tones = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"];
  return tones[hash % tones.length];
}

function treeHasMatch(node, query, treeMap, pathLookup) {
  if (collectionMatch(node, query, pathLookup)) return true;
  const loadedItems = state.treeItemsByCollection.get(node.key) || [];
  if (loadedItems.some((item) => treeItemMatch(item, query))) return true;
  const children = treeMap.get(node.key) || [];
  return children.some((child) => treeHasMatch(child, query, treeMap, pathLookup));
}

function selectCollection(collectionKey, options = {}) {
  const collectionChanged = state.selectedCollectionKey !== collectionKey;
  const resetItem = options.resetItem !== false;
  const wantsLoad = options.loadItems !== false;
  const wantsRefresh = Boolean(options.refreshItems);
  dbg(
    "selectCollection",
    `collectionKey=${collectionKey || "(empty)"} changed=${String(collectionChanged)} loadItems=${String(
      wantsLoad
    )} refreshItems=${String(wantsRefresh)} resetItem=${String(resetItem)}`
  );
  state.selectedCollectionKey = collectionKey;
  if (state.layout.hideMid) {
    state.layout.hideMid = false;
    applyPaneWidths();
    persistUiState();
  }
  state.advanced.active = false;
  if (collectionChanged) {
    state.items = [];
    state.itemsCollectionKey = "";
    state.itemsLoading = false;
    state.itemsTable.selectedKeys.clear();
    state.itemsTable.anchorKey = "";
    state.virtual.scrollTop = 0;
    if (els.itemsList) els.itemsList.scrollTop = 0;
    state.itemChildren = [];
    state.itemSearch = "";
    if (els.itemSearch) els.itemSearch.value = "";
    void refreshTagFacets();
    void refreshCollectionTagPresence();
  }
  if (resetItem) {
    state.selectedItem = null;
    state.itemChildren = [];
  }
  renderCollections();
  renderItems();
  renderDetails();
  const shouldLoad =
    wantsLoad &&
    (wantsRefresh || collectionChanged || state.itemsCollectionKey !== collectionKey || state.items.length === 0);
  if (shouldLoad) {
    void loadItems(wantsRefresh);
  } else if (wantsLoad) {
    dbg("selectCollection", `skip-load collectionKey=${collectionKey || "(empty)"} reason=already_loaded`);
  }
}

function findItemInCollectionCache(collectionKey, itemKey) {
  const cached = state.treeItemsByCollection.get(collectionKey) || [];
  return cached.find((item) => item.key === itemKey) || null;
}

function selectItemFromAnySource(item, collectionKey) {
  if (!item?.key) return;
  state.selectedCollectionKey = collectionKey || state.selectedCollectionKey;
  state.selectedItem = item;
  state.itemsTable.selectedKeys.clear();
  state.itemsTable.selectedKeys.add(item.key);
  state.itemsTable.anchorKey = item.key;
  state.itemChildren = [];
  state.advanced.active = false;
  if (collectionKey && state.selectedCollectionKey === collectionKey && state.items.length === 0) {
    const cached = state.treeItemsByCollection.get(collectionKey) || [];
    if (cached.length) {
      state.items = cached.slice();
      state.itemsCollectionKey = collectionKey;
    }
  }
  renderCollections();
  renderItems();
  renderDetails();
}

async function loadTreeItems(collectionKey, refresh = false) {
  if (!collectionKey) return;
  if (state.treeItemsInFlight.has(collectionKey)) {
    return state.treeItemsInFlight.get(collectionKey);
  }

  state.treeItemsLoading.add(collectionKey);
  renderCollections();

  const promise = (async () => {
    const res = await window.zoteroBridge.getItems({
      collectionKey,
      refresh,
      maxItems: TREE_PREVIEW_FETCH_MAX
    });
    if (res?.status !== "ok") {
      throw new Error(res?.message || "Tree item preview fetch failed.");
    }
    const rows = Array.isArray(res.items) ? res.items : [];
    state.treeItemsByCollection.set(collectionKey, rows);
    return rows;
  })();

  state.treeItemsInFlight.set(collectionKey, promise);
  try {
    await promise;
  } catch (error) {
    setStatus(error.message || "Failed to load tree items.", "err");
    showToast(error.message || "Failed to load tree items.", "err");
  } finally {
    state.treeItemsInFlight.delete(collectionKey);
    state.treeItemsLoading.delete(collectionKey);
    renderCollections();
  }
}

function ensureTreeItemsLoaded(collectionKey, refresh = false) {
  if (!collectionKey) return;
  if (!refresh && state.treeItemsByCollection.has(collectionKey)) return;
  void loadTreeItems(collectionKey, refresh);
}

function createContextMenuEntry(entry) {
  if (entry.separator) {
    const sep = document.createElement("div");
    sep.className = "context-menu-sep";
    return sep;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "context-menu-item";
  btn.innerHTML = `${renderIcon(entry.icon || "file-text", "menu-icn")}<span>${escapeHtml(entry.label || "")}</span>`;
  btn.disabled = entry.disabled === true;
  if (typeof entry.onClick === "function") {
    btn.addEventListener("click", () => {
      hideContextMenu();
      entry.onClick();
    });
  }
  return btn;
}

function hideContextMenu() {
  els.contextMenu.classList.remove("open");
  els.contextMenu.style.left = "-9999px";
  els.contextMenu.style.top = "-9999px";
  els.contextMenu.innerHTML = "";
}

function showContextMenu(ev, entries) {
  ev.preventDefault();
  ev.stopPropagation();
  const validEntries = (entries || []).filter(Boolean);
  if (!validEntries.length) return;

  els.contextMenu.innerHTML = "";
  validEntries.forEach((entry) => {
    els.contextMenu.appendChild(createContextMenuEntry(entry));
  });
  els.contextMenu.classList.add("open");

  const margin = 8;
  const menuRect = els.contextMenu.getBoundingClientRect();
  let left = ev.clientX;
  let top = ev.clientY;

  if (left + menuRect.width + margin > window.innerWidth) {
    left = window.innerWidth - menuRect.width - margin;
  }
  if (top + menuRect.height + margin > window.innerHeight) {
    top = window.innerHeight - menuRect.height - margin;
  }
  left = Math.max(margin, left);
  top = Math.max(margin, top);

  els.contextMenu.style.left = `${left}px`;
  els.contextMenu.style.top = `${top}px`;
}

function collectionContextEntries(node, hasChildren) {
  const isExpanded = state.expanded.has(node.key);
  return [
    {
      icon: isExpanded ? "folder" : "folder-open",
      label: isExpanded ? "Collapse Folder" : "Expand Folder",
      onClick: () => {
        if (isExpanded) state.expanded.delete(node.key);
        else state.expanded.add(node.key);
        renderCollections();
        if (!isExpanded) ensureTreeItemsLoaded(node.key, false);
      }
    },
    {
      icon: "database",
      label: "Load Folder Items (Cache)",
      onClick: () => {
        selectCollection(node.key, { loadItems: false, resetItem: true });
        void loadItems(false);
      }
    },
    {
      icon: "refresh-cw",
      label: "Load Folder Items (Fresh)",
      onClick: () => {
        selectCollection(node.key, { loadItems: false, resetItem: true });
        void loadItems(true);
      }
    },
    {
      icon: "rotate-ccw",
      label: "Refresh Tree Preview",
      onClick: () => {
        if (hasChildren || state.treeItemsByCollection.has(node.key)) ensureTreeItemsLoaded(node.key, true);
      }
    },
    {
      icon: "book-open",
      label: "Download PDFs",
      onClick: () => {
        void downloadPdfsForCollection(node);
      }
    },
    { separator: true },
    {
      icon: "external-link",
      label: "Open Collection in Zotero",
      onClick: () => {
        selectCollection(node.key, { loadItems: false, resetItem: false });
        void openExternal(selectedCollectionZoteroUrl());
      }
    },
    {
      icon: "copy",
      label: "Copy Collection Key",
      onClick: () => copyText(node.key, "collection key")
    }
  ];
}

function sanitizeFolderName(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/*?:"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "collection";
}

async function downloadPdfsForCollection(collection) {
  if (!collection?.key) {
    setStatus("No collection selected for PDF download.", "err");
    return;
  }

  const folderName = sanitizeFolderName(collection.name || collection.key);
  const outputFolder = `./zotero_pdfs/${folderName}`;

  setStatus(`Downloading PDFs for '${collection.name || collection.key}'...`);
  const res = await window.zoteroBridge.runFeature({
    functionName: "download_pdfs_from_collections",
    argsSchema: [
      { key: "output_folder", type: "string", required: true },
      { key: "Z_collections", type: "json", required: true }
    ],
    argsValues: {
      output_folder: outputFolder,
      Z_collections: [collection.key]
    },
    execute: true,
    confirm: true
  });

  if (res?.status === "ok") {
    setStatus(`PDF download queued/completed for '${collection.name || collection.key}'.`, "ok");
    showToast(`PDFs: ${collection.name || collection.key}`, "ok");
    return;
  }

  setStatus(res?.message || "Failed to download PDFs for collection.", "err");
  showToast(res?.message || "PDF download failed.", "err");
}

function itemContextEntries(item, collectionKey) {
  return [
    {
      icon: "bookmark",
      label: "Select Item",
      onClick: () => selectItemFromAnySource(item, collectionKey)
    },
    {
      icon: "external-link",
      label: "Open Item in Zotero",
      onClick: () => {
        selectItemFromAnySource(item, collectionKey);
        void openExternal(selectedItemZoteroUrl());
      }
    },
    {
      icon: "book-open",
      label: "Open Reader",
      onClick: () => {
        selectItemFromAnySource(item, collectionKey);
        void openReader();
      }
    },
    {
      icon: "link",
      label: "Open URL",
      disabled: !item?.url,
      onClick: () => void openExternal(item?.url || "")
    },
    {
      icon: "globe",
      label: "Open DOI",
      disabled: !(item?.doi || "").trim(),
      onClick: () => {
        const doi = String(item?.doi || "").trim();
        const target = doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
        void openExternal(target);
      }
    },
    {
      icon: "git-branch",
      label: "Fetch Children",
      onClick: () => {
        selectItemFromAnySource(item, collectionKey);
        void fetchChildren();
      }
    },
    { separator: true },
    {
      icon: "copy",
      label: "Copy Item Key",
      onClick: () => copyText(item?.key || "", "item key")
    }
  ];
}

function childContextEntries(child) {
  return [
    {
      icon: "copy",
      label: "Copy Child Key",
      onClick: () => copyText(child?.key || "", "child key")
    },
    {
      icon: "link",
      label: "Open Child URL",
      disabled: !child?.url,
      onClick: () => void openExternal(child?.url || "")
    },
    {
      icon: "external-link",
      label: "Open Child in Zotero",
      disabled: !child?.key,
      onClick: () => void openExternal(selectedZoteroItemUrlByKey(child?.key || ""))
    }
  ];
}

function renderCollections() {
  const treeMap = byParent(state.collections);
  const pathLookup = collectionPathLookup(state.collections);
  const hasSearch = Boolean(state.collectionSearch);
  const root = document.createElement("div");

  const renderNode = (node) => {
    if (!treeHasMatch(node, state.collectionSearch, treeMap, pathLookup)) return null;

    const nodeWrap = document.createElement("div");
    nodeWrap.className = "tree-node";

    const line = document.createElement("div");
    line.className = "tree-line";
    if (node.key === state.selectedCollectionKey) line.classList.add("active");

    const children = treeMap.get(node.key) || [];
    const isExpanded = state.expanded.has(node.key);
    const effectiveExpanded = isExpanded || hasSearch;
    const expander = document.createElement("button");
    expander.className = "expander-btn";
    expander.innerHTML = children.length
      ? renderIcon(effectiveExpanded ? "chevron-down" : "chevron-right", "tree-chevron-icon")
      : "";
    expander.disabled = !children.length;
    expander.setAttribute("aria-label", children.length ? (isExpanded ? "Collapse folder" : "Expand folder") : "No children");
    expander.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!children.length) return;
      if (state.expanded.has(node.key)) state.expanded.delete(node.key);
      else {
        state.expanded.add(node.key);
        ensureTreeItemsLoaded(node.key, false);
      }
      renderCollections();
    });

    const label = document.createElement("span");
    label.innerHTML = highlightText(node.name || "Untitled", state.collectionSearch);
    label.className = "tree-label";

    const folder = document.createElement("span");
    folder.className = "tree-folder-icon";
    folder.innerHTML = renderIcon(effectiveExpanded ? "folder-open" : "folder");

    const pill = document.createElement("span");
    pill.className = "count-pill";
    const exactCount = Number(node?.itemCount);
    const cachedCount = (state.treeItemsByCollection.get(node.key) || []).length;
    const hasExact = Number.isFinite(exactCount) && exactCount >= 0;
    pill.textContent = String(hasExact ? exactCount : cachedCount);
    pill.title = hasExact ? "Items in this collection" : "Items loaded for this collection";

    line.append(expander, folder, label, pill);
    line.addEventListener("click", () => {
      selectCollection(node.key, { loadItems: true, resetItem: true });
    });
    line.addEventListener("dblclick", () => {
      void openExternal(collectionZoteroUrlByKey(node.key));
    });
    line.addEventListener("contextmenu", (ev) => showContextMenu(ev, collectionContextEntries(node, children.length > 0)));

    nodeWrap.appendChild(line);

    if (effectiveExpanded) {
      const childWrap = document.createElement("div");
      childWrap.className = "tree-children";

      const loading = state.treeItemsLoading.has(node.key);
      const loadedItems = state.treeItemsByCollection.get(node.key) || [];
      const visibleItems = loadedItems.filter((item) => treeItemMatch(item, state.collectionSearch)).slice(0, TREE_PREVIEW_RENDER_LIMIT);

      if (loading) {
        const loadingRow = document.createElement("div");
        loadingRow.className = "tree-item-line tree-item-meta";
        loadingRow.textContent = "Loading items…";
        childWrap.appendChild(loadingRow);
      } else if (visibleItems.length) {
        visibleItems.forEach((item) => {
          const row = document.createElement("div");
          row.className = "tree-item-line";
          if (state.selectedItem?.key === item.key) row.classList.add("active");

          const icon = document.createElement("span");
          icon.className = "tree-item-icon";
          icon.innerHTML = renderIcon(itemTypeIconName(item.itemType));

          const title = document.createElement("span");
          title.className = "tree-item-title";
          title.innerHTML = highlightText(item.title || item.key, state.collectionSearch);

          const type = document.createElement("span");
          type.className = "type-pill";
          type.textContent = item.itemType || "item";

          row.append(icon, title, type);
          row.addEventListener("click", (ev) => {
            ev.stopPropagation();
            selectItemFromAnySource(item, node.key);
          });
          row.addEventListener("dblclick", (ev) => {
            ev.stopPropagation();
            selectItemFromAnySource(item, node.key);
            void openExternal(item.zoteroSelectUrl || selectedItemZoteroUrl());
          });
          row.addEventListener("contextmenu", (ev) => showContextMenu(ev, itemContextEntries(item, node.key)));
          childWrap.appendChild(row);
        });
      }

      children.forEach((child) => {
        const childNode = renderNode(child);
        if (childNode) childWrap.appendChild(childNode);
      });
      nodeWrap.appendChild(childWrap);
    }

    return nodeWrap;
  };

  const roots = rootCollections(state.collections);
  roots.forEach((node) => {
    const el = renderNode(node);
    if (el) root.appendChild(el);
  });

  const host = document.createElement("div");
  host.className = "tree-host";
  const topMeta = document.createElement("div");
  topMeta.className = "panel-section-title";
  topMeta.textContent = `My Library • ${state.collections.length} collections`;
  host.appendChild(topMeta);
  host.appendChild(root);
  const savedSection = document.createElement("div");
  savedSection.className = "left-rail-section";
  const savedTitle = document.createElement("button");
  savedTitle.type = "button";
  savedTitle.className = "panel-section-title panel-section-toggle";
  savedTitle.innerHTML = `Saved Searches <span>${state.leftRail.savedExpanded ? "▾" : "▸"}</span>`;
  savedTitle.addEventListener("click", () => {
    state.leftRail.savedExpanded = !state.leftRail.savedExpanded;
    renderCollections();
  });
  savedSection.appendChild(savedTitle);
  if (state.leftRail.savedExpanded) {
    const savedBody = document.createElement("div");
    savedBody.className = "left-rail-list";
    const savedRows = Array.isArray(state.advanced.saved) ? state.advanced.saved.slice(0, 8) : [];
    if (!savedRows.length) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = "No saved searches";
      savedBody.appendChild(meta);
    } else {
      savedRows.forEach((row) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "left-rail-item";
        btn.textContent = row?.name || "Untitled search";
        btn.addEventListener("click", () => {
          if (row?.id) void runSavedSearchById(row.id);
        });
        savedBody.appendChild(btn);
      });
    }
    savedSection.appendChild(savedBody);
  }
  host.appendChild(savedSection);

  const tagSection = document.createElement("div");
  tagSection.className = "left-rail-section";
  const tagTitle = document.createElement("button");
  tagTitle.type = "button";
  tagTitle.className = "panel-section-title panel-section-toggle";
  const selectedTagCount = state.leftRail.selectedTags.length;
  const scopeLabel = "Collection";
  tagTitle.innerHTML = `Top Tags [${scopeLabel}]${selectedTagCount ? ` (${selectedTagCount})` : ""} <span>${
    state.leftRail.tagsExpanded ? "▾" : "▸"
  }</span>`;
  tagTitle.addEventListener("click", () => {
    state.leftRail.tagsExpanded = !state.leftRail.tagsExpanded;
    renderCollections();
  });
  tagSection.appendChild(tagTitle);
  if (state.leftRail.tagsExpanded) {
    const tagBody = document.createElement("div");
    tagBody.className = "left-rail-list left-rail-tags-wrap";
    const allTagRows = Array.isArray(state.leftRail.tagCatalog) ? state.leftRail.tagCatalog : [];
    const tags = visibleTagCatalog();
    const q = String(state.leftRail.tagSearch || "").trim();
    const controls = document.createElement("div");
    controls.className = "left-rail-tags-controls";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search tags";
    search.value = q;
    search.className = "left-rail-tags-search";
    search.addEventListener("input", () => {
      state.leftRail.tagSearch = search.value;
      renderCollections();
      persistUiState();
    });
    const modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.className = "left-rail-item left-rail-tags-mode";
    modeBtn.textContent = `Match: ${state.leftRail.tagMode === "any" ? "Any" : "All"}`;
    modeBtn.addEventListener("click", async () => {
      state.leftRail.tagMode = state.leftRail.tagMode === "any" ? "all" : "any";
      await applyTagFilterFromSelection();
      renderCollections();
      persistUiState();
    });
    controls.append(search, modeBtn);
    tagBody.appendChild(controls);
    if (state.leftRail.tagLoading) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = "Loading tags…";
      tagBody.appendChild(meta);
    } else if (!tags.length) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = "No tags in cache yet";
      tagBody.appendChild(meta);
    } else {
      const selected = new Set((state.leftRail.selectedTags || []).map((tag) => String(tag).toLowerCase()));
      const collectionTagSet = new Set((state.leftRail.collectionTagSet || []).map((tag) => String(tag).toLowerCase()));
      const collectionTagCounts = state.leftRail.collectionTagCounts || {};
      const hasPresenceInfo = Boolean(state.leftRail.collectionTagLoaded);
      tags.forEach((row) => {
        const tag = String(row?.tag || "").trim();
        const count = Number(row?.count || 0);
        if (!tag) return;
        const btn = document.createElement("button");
        btn.type = "button";
        const lower = tag.toLowerCase();
        const active = selected.has(lower);
        const belongsToCollection = collectionTagSet.has(lower);
        const displayCount = hasPresenceInfo && belongsToCollection ? Number(collectionTagCounts[lower] || 0) : count;
        const markInactive = hasPresenceInfo && !belongsToCollection;
        btn.className = `left-rail-item left-rail-tag-chip ${tagToneClass(tag)}${active ? " is-active" : ""}${
          markInactive ? " is-inactive" : ""
        }`;
        if (markInactive) {
          btn.disabled = true;
          btn.title = "Not in current active folder";
          btn.setAttribute("aria-disabled", "true");
        }
        btn.innerHTML = `${escapeHtml(tag)} <span>${escapeHtml(String(displayCount))}</span>`;
        btn.addEventListener("click", async () => {
          if (markInactive) return;
          const next = Array.isArray(state.leftRail.selectedTags) ? state.leftRail.selectedTags.slice() : [];
          const idx = next.findIndex((entry) => String(entry || "").toLowerCase() === lower);
          if (idx >= 0) next.splice(idx, 1);
          else next.push(tag);
          state.leftRail.selectedTags = next.slice(0, 30);
          dbg("leftRailTagToggle", `selected=${state.leftRail.selectedTags.length} tag=${tag}`);
          await applyTagFilterFromSelection();
        });
        tagBody.appendChild(btn);
      });
      if (state.leftRail.selectedTags.length) {
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "left-rail-item left-rail-tags-clear";
        clearBtn.textContent = "Clear Tag Filter";
        clearBtn.addEventListener("click", () => {
          state.leftRail.selectedTags = [];
          if (state.selectedCollectionKey) void loadItems(false);
          else renderItems();
          renderCollections();
          persistUiState();
        });
        tagBody.appendChild(clearBtn);
      }
      if (tags.length < allTagRows.length) {
        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = "left-rail-item left-rail-tags-more";
        moreBtn.textContent = `Show More (${Math.min(allTagRows.length, state.leftRail.tagLimit + 80)}/${allTagRows.length})`;
        moreBtn.addEventListener("click", () => {
          state.leftRail.tagLimit = Math.max(20, Math.min(500, state.leftRail.tagLimit + 80));
          renderCollections();
          persistUiState();
        });
        tagBody.appendChild(moreBtn);
      }
    }
    tagSection.appendChild(tagBody);
  }
  host.appendChild(tagSection);
  els.collectionsTree.innerHTML = "";
  els.collectionsTree.appendChild(host);

  if (!root.children.length) {
    els.collectionsTree.innerHTML = renderStateCard(
      "No Collections",
      "No collection matches current search.",
      "state-empty"
    );
  }
  updateCounters();
  updateSelectionBanner();
  updateActionStates();
  persistUiState();
}

function renderVirtualItems(rows) {
  const viewportHeight = els.itemsList.clientHeight || 240;
  const win = window.ZoteroVirtualList.computeWindow({
    total: rows.length,
    rowHeight: state.virtual.rowHeight,
    scrollTop: state.virtual.scrollTop,
    viewportHeight,
    overscan: 8
  });

  const root = document.createElement("div");
  root.className = "virtual-viewport";

  const spacer = document.createElement("div");
  spacer.className = "virtual-spacer";
  spacer.style.height = `${win.totalHeight}px`;

  const content = document.createElement("div");
  content.className = "virtual-content";
  content.style.transform = `translateY(${win.offsetTop}px)`;

  for (let i = win.start; i < win.end; i += 1) {
    const item = rows[i];
    if (!item) continue;

    const row = document.createElement("div");
    row.className = "item-row";
    row.style.height = `${state.virtual.rowHeight - 2}px`;
    if (state.selectedItem && state.selectedItem.key === item.key) row.classList.add("active");

    const title = document.createElement("div");
    title.className = "item-title";
    title.innerHTML = highlightText(item.title || item.key, state.itemSearch);

    const meta = document.createElement("div");
    meta.className = "item-meta";
    const bits = [];
    if (item.authors) bits.push(item.authors);
    if (item.year) bits.push(item.year);
    if (item.itemType) bits.push(item.itemType);
    if (item.doi) bits.push(`DOI: ${item.doi}`);
    meta.innerHTML = highlightText(bits.join(" • "), state.itemSearch);

    const badges = document.createElement("div");
    badges.className = "panel-actions";
    badges.style.padding = "0";
    badges.style.border = "none";
    const addPill = (txt) => {
      const pill = document.createElement("span");
      pill.className = "type-pill";
      pill.textContent = txt;
      badges.appendChild(pill);
    };
    if (item.pdfs > 0) addPill(`PDF ${item.pdfs}`);
    if (item.attachments > 0) addPill(`ATT ${item.attachments}`);
    if (item.notes > 0) addPill(`NOTES ${item.notes}`);

    row.append(title, meta, badges);
    row.addEventListener("click", () => {
      state.selectedItem = item;
      state.itemChildren = [];
      renderItems();
      renderDetails();
    });
    row.addEventListener("contextmenu", (ev) => showContextMenu(ev, itemContextEntries(item, state.selectedCollectionKey)));
    content.appendChild(row);
  }

  root.append(spacer, content);
  els.itemsList.innerHTML = "";
  els.itemsList.appendChild(root);
}

function sortHeader(label, key) {
  const dir = state.itemsTable.sortKey === key ? state.itemsTable.sortDir : "";
  const arrow = dir === "asc" ? " ▲" : dir === "desc" ? " ▼" : "";
  return `<button class="table-sort-btn" data-sort-key="${escapeHtml(key)}">${escapeHtml(label)}${arrow}</button><span class="table-col-resizer" data-resize-key="${escapeHtml(
    key
  )}"></span>`;
}

function renderItemsTable(rows) {
  const columns = {
    title: { label: "Title", cls: "col-title" },
    authors: { label: "Creator", cls: "col-creator" },
    year: { label: "Year", cls: "col-year" },
    publicationTitle: { label: "Publication", cls: "col-publication" },
    dateModified: { label: "Date Modified", cls: "col-modified" },
    citationCount: { label: "Citation", cls: "col-citation" }
  };
  const defaultOrder = ["title", "authors", "year", "publicationTitle", "dateModified", "citationCount"];
  const order = (state.itemsTable.columnOrder || []).filter((k) => columns[k]);
  const columnOrder = order.length ? order : defaultOrder;
  const sorted = sortedItems(rows);
  const parsedRowHeight = Number(state.itemsTable.rowHeight);
  const rowHeight = Number.isFinite(parsedRowHeight) && parsedRowHeight >= 24 ? parsedRowHeight : 34;
  const headerHeight = 34;
  const viewportHeight = Math.max(120, (els.itemsList.clientHeight || 420) - headerHeight);
  const safeScrollTop = Math.max(0, Number(state.virtual.scrollTop || 0));
  const win = window.ZoteroVirtualList.computeWindow({
    total: sorted.length,
    rowHeight,
    scrollTop: safeScrollTop,
    viewportHeight,
    overscan: 14
  });
  let start = win.start;
  let end = win.end;
  const indexByKey = new Map(sorted.map((item, idx) => [item.key, idx]));
  const selectedIdx = state.selectedItem?.key ? indexByKey.get(state.selectedItem.key) : -1;
  if (Number.isInteger(selectedIdx) && selectedIdx >= 0 && (selectedIdx < start || selectedIdx >= end)) {
    const pad = 6;
    start = Math.max(0, selectedIdx - pad);
    end = Math.min(sorted.length, start + Math.max(20, Math.ceil(viewportHeight / rowHeight) + pad * 2));
  }
  if (sorted.length > 0 && (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)) {
    start = 0;
    end = Math.min(sorted.length, Math.max(20, Math.ceil(viewportHeight / rowHeight)));
  }
  const visibleRows = sorted.slice(start, end);
  const topSpacer = start * rowHeight;
  const bottomSpacer = Math.max(0, (sorted.length - end) * rowHeight);
  const bodyRows = sorted
    .slice(start, end)
    .map((item) => {
      const active = state.selectedItem?.key === item.key ? " is-active" : "";
      const selected = state.itemsTable.selectedKeys.has(item.key) ? " is-selected" : "";
      const citation = Number(item.citationCount || 0) || 0;
      const values = {
        title: `<span class="cell-main">${renderIcon(
          itemTypeIconName(item.itemType),
          "item-kind-icon"
        )}<span>${highlightText(item.title || item.key, state.itemSearch)}</span></span>`,
        authors: highlightText(item.authors || "-", state.itemSearch),
        year: escapeHtml(item.year || "-"),
        publicationTitle: highlightText(item.publicationTitle || "-", state.itemSearch),
        dateModified: escapeHtml(item.dateModified || "-"),
        citationCount: escapeHtml(String(citation))
      };
      const cells = columnOrder
        .map((key) => `<td class="${columns[key].cls}">${values[key] ?? "-"}</td>`)
        .join("");
      return `<tr class="items-table-row${active}${selected}" data-item-key="${escapeHtml(item.key || "")}" style="height:${rowHeight}px">${cells}</tr>`;
    })
    .join("");
  const colgroup = columnOrder
    .map((key) => {
      const width = Number(state.itemsTable.columnWidths[key] || 0);
      return `<col style="${width > 0 ? `width:${width}px;` : ""}" />`;
    })
    .join("");
  const head = columnOrder
    .map((key) => {
      const meta = columns[key];
      return `<th class="items-head-cell" data-col-key="${escapeHtml(key)}" draggable="true">${sortHeader(meta.label, key)}</th>`;
    })
    .join("");
  const table = `
    <div class="virtual-viewport items-table-viewport">
      <table class="items-table">
      <colgroup>${colgroup}</colgroup>
      <thead>
        <tr>${head}</tr>
      </thead>
      <tbody>
        ${topSpacer > 0 ? `<tr class="items-spacer-row"><td colspan="${columnOrder.length}" style="height:${topSpacer}px"></td></tr>` : ""}
        ${bodyRows}
        ${bottomSpacer > 0 ? `<tr class="items-spacer-row"><td colspan="${columnOrder.length}" style="height:${bottomSpacer}px"></td></tr>` : ""}
      </tbody>
      </table>
    </div>`;
  els.itemsList.innerHTML = table;
  if (Math.abs(els.itemsList.scrollTop - safeScrollTop) > 1) {
    els.itemsList.scrollTop = safeScrollTop;
  }
  dbg(
    "renderItemsTable",
    `sorted=${sorted.length} start=${start} end=${end} visible=${visibleRows.length} rowHeight=${rowHeight} scrollTop=${safeScrollTop}`
  );
  els.itemsList.querySelectorAll(".table-sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-sort-key") || "title";
      if (state.itemsTable.sortKey === key) {
        state.itemsTable.sortDir = state.itemsTable.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.itemsTable.sortKey = key;
        state.itemsTable.sortDir = "asc";
      }
      renderItems();
    });
  });
  let dragSourceKey = "";
  els.itemsList.querySelectorAll(".items-head-cell").forEach((cell) => {
    cell.addEventListener("dragstart", (ev) => {
      dragSourceKey = cell.getAttribute("data-col-key") || "";
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
    });
    cell.addEventListener("dragover", (ev) => {
      ev.preventDefault();
    });
    cell.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const targetKey = cell.getAttribute("data-col-key") || "";
      if (!dragSourceKey || !targetKey || dragSourceKey === targetKey) return;
      const next = state.itemsTable.columnOrder.slice();
      const from = next.indexOf(dragSourceKey);
      const to = next.indexOf(targetKey);
      if (from < 0 || to < 0) return;
      next.splice(from, 1);
      next.splice(to, 0, dragSourceKey);
      state.itemsTable.columnOrder = next;
      renderItems();
    });
  });
  els.itemsList.querySelectorAll(".table-col-resizer").forEach((handle) => {
    handle.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const key = handle.getAttribute("data-resize-key") || "";
      if (!key) return;
      const th = handle.closest("th");
      const startX = ev.clientX;
      const startWidth = Math.max(60, th?.getBoundingClientRect().width || 120);
      const onMove = (moveEv) => {
        const nextWidth = Math.max(60, Math.round(startWidth + (moveEv.clientX - startX)));
        state.itemsTable.columnWidths[key] = nextWidth;
        renderItems();
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
  els.itemsList.querySelectorAll(".items-table-row").forEach((row) => {
    row.addEventListener("click", (ev) => {
      const key = row.getAttribute("data-item-key") || "";
      const item = visibleRows.find((x) => x.key === key) || sorted.find((x) => x.key === key) || state.items.find((x) => x.key === key);
      if (!item) return;
      if (ev.shiftKey && state.itemsTable.anchorKey && indexByKey.has(state.itemsTable.anchorKey)) {
        const a = indexByKey.get(state.itemsTable.anchorKey);
        const b = indexByKey.get(key);
        if (Number.isInteger(a) && Number.isInteger(b)) {
          const [minIdx, maxIdx] = a < b ? [a, b] : [b, a];
          state.itemsTable.selectedKeys.clear();
          sorted.slice(minIdx, maxIdx + 1).forEach((x) => state.itemsTable.selectedKeys.add(x.key));
        }
      } else if (ev.metaKey || ev.ctrlKey) {
        if (state.itemsTable.selectedKeys.has(key)) state.itemsTable.selectedKeys.delete(key);
        else state.itemsTable.selectedKeys.add(key);
        state.itemsTable.anchorKey = key;
      } else {
        state.itemsTable.selectedKeys.clear();
        state.itemsTable.selectedKeys.add(key);
        state.itemsTable.anchorKey = key;
      }
      state.selectedItem = item;
      state.itemChildren = [];
      renderItems();
      renderDetails();
    });
    row.addEventListener("contextmenu", (ev) => {
      const key = row.getAttribute("data-item-key") || "";
      const item = state.items.find((x) => x.key === key);
      if (!item) return;
      showContextMenu(ev, itemContextEntries(item, state.selectedCollectionKey));
    });
  });
}

function renderItems() {
  const rows = filteredItemsSource().filter((item) => itemMatch(item, state.itemSearch));
  const baseRows = filteredItemsSource();

  if (state.itemsLoading && !rows.length) {
    els.itemsList.innerHTML = renderStateCard("Loading Items", "Fetching selected collection records…", "state-loading");
  } else if (!rows.length) {
    if (baseRows.length > 0 && state.itemSearch) {
      els.itemsList.innerHTML = renderStateCard(
        "No Search Matches",
        `No rows match '${state.itemSearch}'. Clear search to show ${baseRows.length} item(s).`,
        "state-warn"
      );
    } else if (state.leftRail.selectedTags.length > 0) {
      els.itemsList.innerHTML = renderStateCard(
        "No Tag Matches",
        `Filter ${state.leftRail.tagScope === "collection" ? "Collection" : "Global"} • ${
          state.leftRail.tagMode === "any" ? "Any" : "All"
        } returned no rows.`,
        "state-warn"
      );
    } else {
      els.itemsList.innerHTML = renderStateCard("No Items", "Load a collection or choose tags to begin.", "state-empty");
    }
  } else {
    renderItemsTable(rows);
  }

  if (state.itemsLoading) {
    els.itemsMeta.textContent = "Loading selected collection…";
  } else if (state.leftRail.selectedTags.length) {
    els.itemsMeta.textContent = `${rows.length} shown / ${state.items.length} loaded (${
      state.leftRail.tagScope === "collection" ? "collection" : "global"
    } tag filter)`;
  } else {
    els.itemsMeta.textContent = `${rows.length} shown / ${state.items.length} loaded`;
  }
  renderItemsActiveFilters();
  dbg(
    "renderItems",
    `rows=${rows.length} items=${state.items.length} renderedRows=${
      els.itemsList.querySelectorAll(".item-row, .items-table-row").length
    } listHeight=${
      els.itemsList.clientHeight || 0
    }`
  );
  updateCounters();
  updateSelectionBanner();
  updateActionStates();
  persistUiState();
}

function renderChildren() {
  els.childrenList.innerHTML = renderMetadataDetailsHtml(state.selectedItem);
  updateCounters();
  updateActionStates();
}

function renderDetails() {
  const coll = selectedCollection();
  els.selectedCollection.innerHTML = renderCollectionDetailsHtml(coll);
  els.selectedItem.innerHTML = renderItemDetailsHtml(state.selectedItem);
  renderChildren();
  updateInspectorStatusNode();
  applyInspectorTab();
  updateSelectionBanner();
  updateActionStates();
  persistUiState();
}

function handleInspectorActions(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  if (!state.selectedItem?.key) return;

  if (target.id === "btnInspectorAutoSync") {
    state.inspector.autoSync = !state.inspector.autoSync;
    if (!state.inspector.autoSync) clearInspectorSyncTimer();
    persistUiState();
    renderDetails();
    return;
  }

  if (target.id === "btnInspectorSaveNow") {
    void runInspectorSync("manual");
    return;
  }

  if (target.id === "btnInspectorRevert") {
    const creatorList = Array.isArray(state.selectedItem.creators)
      ? state.selectedItem.creators
          .map((creator) => String(creator?.name || "").trim())
          .filter(Boolean)
      : [];
    const draftFields = {};
    editableInspectorFieldKeys(state.selectedItem.itemType).forEach((key) => {
      draftFields[key] = String(inspectorValueFromItem(state.selectedItem, key, creatorList) || "");
    });
    state.inspector.draftAbstract = String(state.selectedItem.abstract || "");
    state.inspector.draftTags = parseTagList(state.selectedItem.tags || []);
    state.inspector.draftFields = draftFields;
    state.inspector.baseVersion = Number(state.selectedItem.version || state.inspector.baseVersion || 0);
    state.inspector.status = "idle";
    state.inspector.message = "";
    state.inspector.metadataEdit = false;
    clearInspectorSyncTimer();
    renderDetails();
    return;
  }

  if (target.id === "btnInspectorEditMeta") {
    state.inspector.metadataEdit = true;
    renderDetails();
    return;
  }

  if (target.id === "btnInspectorDoneEdit") {
    state.inspector.metadataEdit = false;
    clearInspectorSyncTimer();
    renderDetails();
    return;
  }

  if (target.id === "btnInspectorApplyTags") {
    const input = document.getElementById("inspectorTagsInput");
    if (input instanceof HTMLInputElement) {
      state.inspector.draftTags = parseTagList(input.value);
      markInspectorDirty();
      applyInspectorDraftToCurrentItem();
      renderDetails();
      scheduleInspectorSync("tags_apply");
    }
    return;
  }

  if (target.id === "btnInspectorClearTags") {
    state.inspector.draftTags = [];
    markInspectorDirty();
    applyInspectorDraftToCurrentItem();
    renderDetails();
    scheduleInspectorSync("tags_clear");
    return;
  }

  const removeBtn = target.closest("[data-tag-remove]");
  const removeTag = removeBtn ? removeBtn.getAttribute("data-tag-remove") : "";
  if (removeTag) {
    state.inspector.draftTags = state.inspector.draftTags.filter((tag) => tag !== removeTag);
    markInspectorDirty();
    applyInspectorDraftToCurrentItem();
    renderDetails();
    scheduleInspectorSync("tag_remove");
  }
}

function handleInspectorInputs(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  if (!state.selectedItem?.key) return;

  if (target.id === "inspectorTagsInput" && target instanceof HTMLInputElement) {
    state.inspector.draftTags = parseTagList(target.value);
    markInspectorDirty();
    applyInspectorDraftToCurrentItem();
    updateInspectorStatusNode();
    scheduleInspectorSync("tags_input");
    return;
  }

  if (target.id === "inspectorAbstractInput" && target instanceof HTMLTextAreaElement) {
    state.inspector.draftAbstract = target.value;
    markInspectorDirty();
    applyInspectorDraftToCurrentItem();
    updateInspectorStatusNode();
    scheduleInspectorSync("abstract_input");
    return;
  }

  if (target.id === "inspectorExtraInput" && target instanceof HTMLTextAreaElement) {
    state.inspector.draftFields = {
      ...(state.inspector.draftFields || {}),
      extra: target.value
    };
    markInspectorDirty();
    applyInspectorDraftToCurrentItem();
    updateInspectorStatusNode();
    scheduleInspectorSync("field_extra");
    return;
  }

  const fieldKey = target.getAttribute("data-inspector-field");
  if (!fieldKey) return;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  state.inspector.draftFields = {
    ...(state.inspector.draftFields || {}),
    [fieldKey]: target.value
  };
  markInspectorDirty();
  applyInspectorDraftToCurrentItem();
  updateInspectorStatusNode();
  scheduleInspectorSync(`field_${fieldKey}`);
}

function handleInspectorKeydown(ev) {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.id !== "inspectorTagsInput") return;
  if (!(target instanceof HTMLInputElement)) return;
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  state.inspector.draftTags = parseTagList(target.value);
  markInspectorDirty();
  applyInspectorDraftToCurrentItem();
  renderDetails();
  scheduleInspectorSync("tags_enter");
}

function openAdvancedSearch() {
  els.advancedSearchModal.classList.remove("hidden");
  els.advancedSearchModal.setAttribute("aria-hidden", "false");
  els.advancedSearchInput.focus();
  els.advancedSearchInput.select();
}

function closeAdvancedSearch() {
  els.advancedSearchModal.classList.add("hidden");
  els.advancedSearchModal.setAttribute("aria-hidden", "true");
}

function openCommandPalette() {
  renderCommandList();
  els.commandPalette.classList.remove("hidden");
}

function closeCommandPalette() {
  els.commandPalette.classList.add("hidden");
}

async function runAdvancedSearch() {
  const check = window.ZoteroSearchSchema.validateQuery(els.advancedSearchInput.value);
  if (!check.ok) {
    setStatus(check.message, "err");
    return;
  }

  const token = ++requestTokens.advanced;
  state.advanced.query = check.query;
  setStatus("Running advanced search…");
  const res = await window.zoteroBridge.advancedSearch({ query: check.query, limit: 1500 });
  if (token !== requestTokens.advanced) return;

  if (res?.status !== "ok") {
    setStatus(res?.message || "Advanced search failed.", "err");
    return;
  }

  state.items = Array.isArray(res.items) ? res.items : [];
  state.itemsCollectionKey = "";
  state.itemsLoading = false;
  state.selectedItem = state.items[0] || null;
  state.itemsTable.selectedKeys.clear();
  state.itemsTable.anchorKey = state.selectedItem?.key || "";
  if (state.selectedItem?.key) state.itemsTable.selectedKeys.add(state.selectedItem.key);
  state.itemChildren = [];
  state.advanced.active = true;
  renderItems();
  renderDetails();
  els.advancedSearchMeta.textContent = `Search '${check.query}' matched ${state.items.length} cached items.`;
  setStatus(`Advanced search loaded ${state.items.length} items.`, "ok");
  showToast(`Advanced search: ${state.items.length} items`, "ok");
}

async function refreshSavedSearches() {
  const rows = await window.ZoteroSavedSearchStore.list();
  state.advanced.saved = rows;
  els.savedSearchSelect.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Select saved search";
  els.savedSearchSelect.appendChild(empty);

  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row.name;
    els.savedSearchSelect.appendChild(option);
  });
}

async function saveCurrentSearch() {
  const check = window.ZoteroSearchSchema.validateQuery(els.advancedSearchInput.value);
  if (!check.ok) {
    setStatus(check.message, "err");
    return;
  }
  const name = window.prompt("Saved search name", check.query);
  if (!name) return;
  try {
    await window.ZoteroSavedSearchStore.save({ name, query: { text: check.query } });
    await refreshSavedSearches();
    setStatus("Saved search created.", "ok");
    showToast("Saved search created.", "ok");
  } catch (error) {
    setStatus(error.message || "Failed to save search.", "err");
  }
}

async function runSavedSearchById(id) {
  const row = state.advanced.saved.find((x) => String(x.id) === String(id));
  if (!row) return;
  els.advancedSearchInput.value = row.query?.text || "";
  await runAdvancedSearch();
}

async function deleteSelectedSavedSearch() {
  const id = els.savedSearchSelect.value;
  if (!id) return;
  try {
    await window.ZoteroSavedSearchStore.remove(id);
    await refreshSavedSearches();
    setStatus("Saved search deleted.", "ok");
  } catch (error) {
    setStatus(error.message || "Delete failed.", "err");
  }
}

function pushChatMessage(role, text, tone = "") {
  state.chat.messages.push({
    role,
    text: String(text || "").trim(),
    tone,
    at: Date.now()
  });
  if (state.chat.messages.length > 60) {
    state.chat.messages = state.chat.messages.slice(-60);
  }
  renderAgentChatMessages();
}

function renderAgentChatMessages() {
  if (!els.agentChatMessages) return;
  els.agentChatMessages.innerHTML = "";
  const fragment = document.createDocumentFragment();
  state.chat.messages.forEach((entry) => {
    const row = document.createElement("div");
    row.className = `agent-chat-msg ${entry.role}${entry.tone ? ` ${entry.tone}` : ""}`;
    row.textContent = entry.text || "(empty)";
    const meta = document.createElement("div");
    meta.className = "agent-chat-meta";
    const stamp = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    meta.textContent = `${entry.role === "user" ? "You" : "Agent"} • ${stamp}`;
    row.appendChild(meta);
    fragment.appendChild(row);
  });
  els.agentChatMessages.appendChild(fragment);
  els.agentChatMessages.scrollTop = els.agentChatMessages.scrollHeight;
}

function setAgentChatOpen(open) {
  state.chat.open = open === true;
  els.agentChatDock.classList.toggle("open", state.chat.open);
  els.agentChatDock.setAttribute("aria-hidden", state.chat.open ? "false" : "true");
  els.agentChatFab.setAttribute("aria-label", state.chat.open ? "Hide agent chat" : "Open agent chat");
  if (state.chat.open) {
    window.setTimeout(() => {
      els.agentChatInput.focus();
      els.agentChatInput.select();
    }, 0);
  }
}

function setAgentChatPending(pending) {
  state.chat.pending = pending === true;
  els.agentChatInput.disabled = state.chat.pending;
  if (els.agentChatDryRun) els.agentChatDryRun.disabled = state.chat.pending;
  els.btnAgentChatSend.disabled = state.chat.pending;
}

function isChatAffirmative(text) {
  const v = String(text || "").trim().toLowerCase();
  return ["yes", "y", "ok", "confirm", "approved", "approve", "go", "run"].includes(v);
}

function isChatNegative(text) {
  const v = String(text || "").trim().toLowerCase();
  return ["no", "n", "cancel", "stop", "reject"].includes(v);
}

function parseResearchQuestionsInput(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lines = raw
    .split(/\n+/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const numbered = lines
    .map((line) => {
      const m = line.match(/^\s*(\d+)[\)\].:\-]\s*(.+)$/);
      return m ? String(m[2] || "").trim() : "";
    })
    .filter(Boolean);
  const fallback = raw
    .split(/[;\n]+/)
    .map((s) => String(s || "").replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  return (numbered.length ? numbered : fallback).slice(0, 5);
}

async function executeIntentWithTimeout(payload, phase = "intent execution") {
  const timeoutMs = Number.parseInt(String(window.__ZOTERO_INTENT_TIMEOUT_MS__ || "300000"), 10);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300000;
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        status: "error",
        message: `${phase} timed out after ${Math.round(timeout / 1000)}s.`
      });
    }, timeout);
  });
  return Promise.race([window.zoteroBridge.executeIntent(payload), timeoutPromise]);
}

async function executeResolvedIntent(intent) {
  const preflightIntents = Array.isArray(intent?.preflightIntents) ? intent.preflightIntents : [];
  for (const preflightIntent of preflightIntents) {
    const preRes = await executeIntentWithTimeout({
      intent: preflightIntent,
      dryRun: false,
      confirm: true,
      background: false,
      context: {
        selectedCollectionKey: state.selectedCollectionKey || "",
        selectedCollectionName: selectedCollection()?.name || ""
      }
    }, "preflight execution");
    if (preRes?.status !== "ok") {
      const msg = preRes?.message || "Preflight step failed.";
      setAgentChatPending(false);
      setStatus(msg, "err");
      pushChatMessage("assistant", msg, "error");
      return;
    }
  }

  const dryRun = false;
  setStatus("Executing intent…");
  const res = await executeIntentWithTimeout({
    intent,
    dryRun,
    confirm: dryRun ? false : true,
    background: !dryRun && intent?.intentId === "workflow.create_subfolder_by_topic",
    context: {
      selectedCollectionKey: state.selectedCollectionKey || "",
      selectedCollectionName: selectedCollection()?.name || ""
    }
  }, "intent execution");
  setAgentChatPending(false);

  if (res?.status === "confirm_required") {
    const msg = res?.message || "Confirmation required before execute.";
    pushChatMessage("assistant", msg, "error");
    setStatus(msg, "warn");
    return;
  }

  if (res?.status !== "ok") {
    const message = res?.message || "Intent execution failed.";
    setStatus(message, "err");
    showToast(message, "err");
    pushChatMessage("assistant", message, "error");
    return;
  }

  state.chat.pendingIntent = null;
  persistUiState();

  if (res?.queued === true && intent?.intentId === "workflow.create_subfolder_by_topic") {
    const jobId = String(res?.jobId || "");
    const summary = `Background batch started for the active folder.\nJob: ${jobId || "(unknown)"}\nYou can continue working while processing runs.`;
    pushChatMessage("assistant", summary);
    state.batch.showBatchMonitor = true;
    applyFloatingPanelsVisibility();
    persistUiState();
    setStatus(`Batch queued in background${jobId ? ` (${jobId})` : ""}.`, "ok");
    showToast("Batch queued in background.", "ok");
    void refreshFeatureJobs();
    return;
  }

  const workflowResult = res?.result || {};
  const matched = Number(workflowResult?.matchedItems || 0);
  const added = Number(workflowResult?.addedItems || 0);
  const screened = Number(workflowResult?.screenedItems || workflowResult?.classifiedItems || workflowResult?.scannedItems || 0);
  const subPath = String(workflowResult?.subcollection?.path || "");
  if (intent?.intentId === "workflow.create_subfolder_by_topic") {
    const summary = `Command complete.\nScreened: ${screened}\nMatched: ${matched}\nAdded: ${added}\nTarget: ${subPath || "(new subfolder)"}`;
    pushChatMessage("assistant", summary);
    setStatus(`Workflow complete: ${matched} matched, ${added} added.`, "ok");
    showToast(`${added} items added${subPath ? ` to ${subPath}` : ""}.`, "ok");
    if (workflowResult?.subcollection?.key) {
      await loadTree(true);
      selectCollection(workflowResult.subcollection.key, { loadItems: false, resetItem: true });
      await loadItems(false);
    }
    return;
  }

  pushChatMessage("assistant", "Command executed successfully.");
  setStatus("Command executed.", "ok");
}

async function runAgentChatCommand(text) {
  const query = String(text || "").trim();
  if (!query) return;
  pushChatMessage("user", query);

  if (state.chat.pendingConfirmation) {
    if (isChatAffirmative(query)) {
      const pending = state.chat.pendingConfirmation;
      state.chat.pendingConfirmation = null;
      persistUiState();
      setAgentChatPending(true);
      await executeResolvedIntent(pending.intent);
      return;
    }
    if (isChatNegative(query)) {
      const pendingType = state.chat.pendingConfirmation?.type;
      state.chat.pendingConfirmation = null;
      persistUiState();
      if (pendingType === "coding_questions") {
        setStatus("Coding confirmation canceled.", "warn");
        pushChatMessage("assistant", "Coding run canceled. Send a new coding request when ready.", "warn");
      } else {
        setStatus("Schema confirmation canceled.", "warn");
        pushChatMessage("assistant", "Schema confirmation canceled. Send updated criteria when ready.", "warn");
      }
      return;
    }
    if (state.chat.pendingConfirmation?.type === "coding_questions") {
      setAgentChatPending(true);
      const pendingIntent = state.chat.pendingConfirmation.intent || {};
      const currentQuestions = Array.isArray(pendingIntent?.args?.research_questions)
        ? pendingIntent.args.research_questions
        : [];
      const ref = await window.zoteroBridge.refineCodingQuestions({
        currentQuestions,
        feedback: query,
        contextText: String(pendingIntent?.args?.context || "")
      });
      setAgentChatPending(false);
      if (ref?.status === "ok" && Array.isArray(ref?.questions) && ref.questions.length >= 3) {
        const revised = ref.questions.slice(0, 5).map((q) => String(q || "").trim()).filter(Boolean);
        state.chat.pendingConfirmation.intent.args = {
          ...(state.chat.pendingConfirmation.intent.args || {}),
          research_questions: revised
        };
        const screeningEnabled = state.chat.pendingConfirmation.intent?.args?.screening !== false;
        if (screeningEnabled && Array.isArray(revised) && revised.length >= 3) {
          const regen = await window.zoteroBridge.generateEligibilityCriteria({
            userText: query,
            collectionName: String(pendingIntent?.args?.collection_name || ""),
            contextText: String(pendingIntent?.args?.context || ""),
            researchQuestions: revised
          });
          if (regen?.status === "ok") {
            const inclusionText = regen.inclusion_criteria.join("\n");
            const exclusionText = regen.exclusion_criteria.join("\n");
            const schemaPreview = {
              type: "object",
              additionalProperties: false,
              required: ["status", "justification", "inclusion_hits", "exclusion_hits", "eligibility_criteria", "coder_prompt"],
              properties: {
                status: { type: "string", enum: ["include", "exclude", "maybe"] },
                justification: { type: "string" },
                inclusion_hits: { type: "array", items: { type: "string" } },
                exclusion_hits: { type: "array", items: { type: "string" } },
                eligibility_criteria: {
                  type: "object",
                  required: ["inclusion", "exclusion"],
                  properties: {
                    inclusion: { type: "array", items: { type: "string" }, default: regen.inclusion_criteria },
                    exclusion: { type: "array", items: { type: "string" }, default: regen.exclusion_criteria }
                  }
                },
                coder_prompt: {
                  type: "string",
                  const: "You are a rigorous screening coder. Apply inclusion and exclusion criteria exactly. Return valid JSON only."
                }
              }
            };
            state.chat.pendingConfirmation.intent.preflightIntents = [
              {
                intentId: "feature.run",
                targetFunction: "set_eligibility_criteria",
                riskLevel: "confirm",
                confidence: 0.9,
                needsClarification: false,
                clarificationQuestions: [],
                args: {
                  collection_name: String(pendingIntent?.args?.collection_name || ""),
                  inclusion_criteria: inclusionText,
                  exclusion_criteria: exclusionText,
                  eligibility_prompt_key: "paper_screener_abs_policy",
                  schema_json: schemaPreview,
                  context: String(pendingIntent?.args?.context || ""),
                  research_questions: revised
                }
              }
            ];
          } else {
            state.chat.pendingConfirmation.intent.preflightIntents = [];
          }
        } else if (!screeningEnabled) {
          state.chat.pendingConfirmation.intent.preflightIntents = [];
        }
        persistUiState();
        pushChatMessage(
          "assistant",
          `Updated research questions:\n${revised.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nReply with 'yes' to run, 'no' to cancel, or send another modification.`
        );
        setStatus("Questions refined. Awaiting approval.", "warn");
        return;
      }

      // Fallback to local parse only if LLM refinement fails.
      const fallback = parseResearchQuestionsInput(query);
      if (fallback.length >= 3 && fallback.length <= 5) {
        state.chat.pendingConfirmation.intent.args = {
          ...(state.chat.pendingConfirmation.intent.args || {}),
          research_questions: fallback
        };
        persistUiState();
        pushChatMessage(
          "assistant",
          `Updated research questions:\n${fallback.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nReply with 'yes' to run, 'no' to cancel, or send another modification.`
        );
        setStatus("Questions updated. Awaiting approval.", "warn");
        return;
      }

      pushChatMessage("assistant", ref?.message || "I could not infer a valid 3-5 question set. Please provide clearer feedback.");
      setStatus("Need 3-5 valid research questions.", "warn");
      return;
    }
    setStatus("Awaiting yes/no confirmation.", "warn");
    pushChatMessage("assistant", "Please reply with `yes` to continue or `no` to cancel.");
    return;
  }

  setAgentChatPending(true);
  setStatus("Resolving intent…");
  const resolved = await window.zoteroBridge.resolveIntent({
    text: query,
    context: {
      selectedCollectionKey: state.selectedCollectionKey || "",
      selectedCollectionName: selectedCollection()?.name || "",
      pendingIntent: state.chat.pendingIntent || null
    }
  });

  if (resolved?.status !== "ok" || !resolved?.intent) {
    const message = resolved?.message || "Could not resolve command intent.";
    setAgentChatPending(false);
    setStatus(message, "err");
    showToast(message, "err");
    pushChatMessage("assistant", message, "error");
    return;
  }

  const intent = resolved.intent;
  if (intent?.needsClarification) {
    setAgentChatPending(false);
    state.chat.pendingIntent = intent;
    persistUiState();
    const qList = Array.isArray(intent?.clarificationQuestions) ? intent.clarificationQuestions : [];
    const clarifyText = qList.length
      ? `I need a bit more detail:\n- ${qList.join("\n- ")}`
      : "I need more details to run this command.";
    pushChatMessage("assistant", clarifyText);
    setStatus("Intent needs clarification.", "warn");
    return;
  }

  if (intent?.intentId === "feature.run" && intent?.targetFunction === "set_eligibility_criteria") {
    const schemaPreview = intent?.args?.schema_preview;
    if (schemaPreview && typeof schemaPreview === "object") {
      pushChatMessage(
        "assistant",
        `Schema draft for confirmation:\n${JSON.stringify(schemaPreview, null, 2)}`
      );
    }
    const include = String(intent?.args?.inclusion_criteria || "").trim();
    const exclude = String(intent?.args?.exclusion_criteria || "").trim();
    const collectionName = String(intent?.args?.collection_name || "").trim() || "(selected collection)";
    pushChatMessage(
      "assistant",
      `Confirm screening schema for '${collectionName}'.\nInclusion:\n${include || "(missing)"}\n\nExclusion:\n${exclude || "(missing)"}\n\nReply with 'yes' or 'no'.`
    );
    state.chat.pendingConfirmation = { type: "screening_schema", intent };
    persistUiState();
    setAgentChatPending(false);
    setStatus("Awaiting schema confirmation in chat.", "warn");
    return;
  }

  if (intent?.intentId === "feature.run" && intent?.targetFunction === "Verbatim_Evidence_Coding") {
    const questions = Array.isArray(intent?.args?.research_questions)
      ? intent.args.research_questions.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const collectionName = String(intent?.args?.collection_name || "").trim() || "(selected collection)";
    const screeningEnabled = intent?.args?.screening !== false;
    if (questions.length >= 3 && questions.length <= 5) {
      if (screeningEnabled) {
        const eligibilityDraft = await window.zoteroBridge.generateEligibilityCriteria({
          userText: query,
          collectionName,
          contextText: String(intent?.args?.context || ""),
          researchQuestions: questions
        });
        if (eligibilityDraft?.status === "ok") {
          const inclusion = Array.isArray(eligibilityDraft?.inclusion_criteria)
            ? eligibilityDraft.inclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
            : [];
          const exclusion = Array.isArray(eligibilityDraft?.exclusion_criteria)
            ? eligibilityDraft.exclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
            : [];
          const schemaPreview = {
            type: "object",
            additionalProperties: false,
            required: ["status", "justification", "inclusion_hits", "exclusion_hits", "eligibility_criteria", "coder_prompt"],
            properties: {
              status: { type: "string", enum: ["include", "exclude", "maybe"] },
              justification: { type: "string" },
              inclusion_hits: { type: "array", items: { type: "string" } },
              exclusion_hits: { type: "array", items: { type: "string" } },
              eligibility_criteria: {
                type: "object",
                required: ["inclusion", "exclusion"],
                properties: {
                  inclusion: { type: "array", items: { type: "string" }, default: inclusion },
                  exclusion: { type: "array", items: { type: "string" }, default: exclusion }
                }
              },
              coder_prompt: {
                type: "string",
                const: "You are a rigorous screening coder. Apply inclusion and exclusion criteria exactly. Return valid JSON only."
              }
            }
          };
          intent.preflightIntents = [
            {
              intentId: "feature.run",
              targetFunction: "set_eligibility_criteria",
              riskLevel: "confirm",
              confidence: 0.9,
              needsClarification: false,
              clarificationQuestions: [],
              args: {
                collection_name: collectionName,
                inclusion_criteria: inclusion.join("\n"),
                exclusion_criteria: exclusion.join("\n"),
                eligibility_prompt_key: "paper_screener_abs_policy",
                schema_json: schemaPreview,
                context: String(intent?.args?.context || ""),
                research_questions: questions
              }
            }
          ];
        } else {
          intent.preflightIntents = [];
        }
      } else {
        intent.preflightIntents = [];
      }
      const preInclusion = String(intent?.preflightIntents?.[0]?.args?.inclusion_criteria || "").trim();
      const preExclusion = String(intent?.preflightIntents?.[0]?.args?.exclusion_criteria || "").trim();
      const screeningLine = screeningEnabled ? "Screening: enabled (eligibility preflight will run)." : "Screening: disabled (skipping eligibility preflight).";
      pushChatMessage(
        "assistant",
        `I will prepare coding for '${collectionName}'.\n${screeningLine}\n\nInclusion criteria (draft):\n${preInclusion || "(skipped)"}\n\nExclusion criteria (draft):\n${preExclusion || "(skipped)"}\n\nResearch questions:\n${questions
          .map((q, i) => `${i + 1}. ${q}`)
          .join("\n")}\n\nReply with 'yes' to run, 'no' to cancel, or send modified questions (3-5).`
      );
      state.chat.pendingConfirmation = { type: "coding_questions", intent };
      persistUiState();
      setAgentChatPending(false);
      setStatus("Awaiting question approval in chat.", "warn");
      return;
    }
  }

  await executeResolvedIntent(intent);
}

function runAgentCommandPrompt() {
  openAgentChatWithTemplate("create subfolder inside folder frameworks, getting only items with framework tag");
}

function openAgentChatWithTemplate(templateText) {
  setAgentChatOpen(true);
  if (!String(els.agentChatInput.value || "").trim()) {
    els.agentChatInput.value = String(templateText || "").trim();
  }
  els.agentChatInput.focus();
  els.agentChatInput.select();
}

function getDictationTargetInput() {
  const active = document.activeElement;
  if (
    active &&
    (active === els.collectionSearch || active === els.itemSearch || active === els.advancedSearchInput)
  ) {
    return active;
  }
  return els.collectionSearch;
}

function appendTextToInput(input, text) {
  if (!input || !text) return;
  const piece = String(text || "").trim();
  if (!piece) return;
  const prefix = input.value && !/\s$/.test(input.value) ? " " : "";
  input.value = `${input.value || ""}${prefix}${piece}`;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function handleVoiceCommandResult(transcript) {
  const res = await window.zoteroBridge.runVoiceCommand({ text: transcript });
  if (res?.status !== "ok") {
    setStatus(res?.message || "Voice command failed.", "err");
    showToast(res?.message || "Voice command failed.", "err");
    return;
  }

  if (res.type === "help") {
    setStatus("Voice help printed in console.", "ok");
    console.info("[voice-help]", res.help || []);
    return;
  }

  if (res.type === "needs_confirm") {
    const message = res?.message || "Confirmation required. Say confirm or cancel.";
    setStatus(message, "warn");
    showToast(message, "warn");
    if (res?.preview) {
      console.info("[voice-preview]", res.preview);
    }
    return;
  }

  if (res.type === "cancelled") {
    const message = res?.message || "Pending command cancelled.";
    setStatus(message, "warn");
    showToast(message, "warn");
    return;
  }

  if (res.type === "confirm_skipped" || res.type === "cancel_skipped") {
    setStatus(res?.message || "No pending command.", "warn");
    return;
  }

  if (res.type === "ui_command" && res.commandId) {
    commandRegistry.run(res.commandId, {});
    setStatus(`Voice command: ${res.commandId}`, "ok");
    return;
  }

  if (res.type === "voice_mode_set" || res.type === "dictation_set") {
    state.voice = { ...state.voice, ...(res.voice || {}) };
    updateCounters();
    return;
  }

  if (res.type === "agent_command") {
    const agentResult = res?.result?.result || {};
    const matched = Number(agentResult?.matchedItems || 0);
    const added = Number(agentResult?.addedItems || 0);
    const message = `Voice command done: ${matched} matched, ${added} added.`;
    setStatus(message, "ok");
    showToast(message, "ok");
    if (agentResult?.subcollection?.key) {
      await loadTree(true);
      selectCollection(agentResult.subcollection.key, { loadItems: false, resetItem: true });
      await loadItems(false);
    }
    return;
  }
}

function syncVoiceRuntimeToState() {
  if (!voiceRuntime || !voiceRuntime.supported) return;
  if (state.voice.voiceModeOn) voiceRuntime.startVoice();
  else voiceRuntime.stopVoice();
  if (state.voice.dictationOn) voiceRuntime.startDictation();
  else voiceRuntime.stopDictation();
}

async function setVoiceMode(enabled) {
  if (!voiceRuntime || !voiceRuntime.supported) {
    setStatus("Voice recognition is not supported in this environment.", "err");
    return;
  }
  const res = await window.zoteroBridge.setVoiceMode({ enabled });
  if (res?.status !== "ok") {
    setStatus(res?.message || "Failed to toggle voice mode.", "err");
    return;
  }
  state.voice = { ...state.voice, ...(res.voice || {}) };
  syncVoiceRuntimeToState();
  updateCounters();
}

async function setDictation(enabled) {
  if (!voiceRuntime || !voiceRuntime.supported) {
    setStatus("Voice recognition is not supported in this environment.", "err");
    return;
  }
  const res = await window.zoteroBridge.setDictation({ enabled });
  if (res?.status !== "ok") {
    setStatus(res?.message || "Failed to toggle dictation.", "err");
    return;
  }
  state.voice = { ...state.voice, ...(res.voice || {}) };
  syncVoiceRuntimeToState();
  updateCounters();
}

function registerCommands() {
  const commands = [
    { id: "refresh-tree", label: "Refresh Tree", run: () => loadTree(true) },
    { id: "sync-now", label: "Sync Now", run: () => syncNow() },
    { id: "voice-mode-toggle", label: "Toggle Voice Mode", run: () => setVoiceMode(!state.voice.voiceModeOn) },
    { id: "dictation-toggle", label: "Toggle Dictation", run: () => setDictation(!state.voice.dictationOn) },
    { id: "advanced-search", label: "Advanced Search", run: () => openAdvancedSearch() },
    { id: "agent-command", label: "Agent Command", run: () => runAgentCommandPrompt() },
    { id: "open-reader", label: "Open Reader", run: () => openReader() },
    { id: "layout-reset", label: "Reset Layout", run: () => resetLayout() },
    { id: "command-palette", label: "Command Palette", run: () => openCommandPalette() },
    { id: "about", label: "About", run: () => showToast("Zotero Internal Electron UI", "ok") }
  ];
  commands.forEach((cmd) => commandRegistry.register(cmd));
}

function renderCommandList() {
  els.commandList.innerHTML = "";
  commandRegistry.list().forEach((cmd) => {
    const btn = document.createElement("button");
    btn.textContent = cmd.label;
    btn.addEventListener("click", () => {
      closeCommandPalette();
      commandRegistry.run(cmd.id, {});
    });
    els.commandList.appendChild(btn);
  });
}

function isDestructiveFeature(functionName) {
  return new Set([
    "_append_to_tagged_note",
    "split_collection_by_status_tag",
    "classify_by_title",
    "screening_articles",
    "_classification_12_features",
    "download_pdfs_from_collections"
  ]).has(functionName);
}

function levelRank(level) {
  if (level === "expert") return 3;
  if (level === "advanced") return 2;
  return 1;
}

function minLevelForFeature(feature) {
  const functionName = feature?.functionName || "";
  if (functionName.startsWith("_")) return "expert";
  const args = Array.isArray(feature?.args) ? feature.args : [];
  if (args.some((a) => a.required && a.type === "json")) return "advanced";
  return "safe";
}

function featureVisibleByAccess(feature) {
  const needed = minLevelForFeature(feature);
  return levelRank(state.ribbon.accessLevel) >= levelRank(needed);
}

function renderFeatureHistorySelect() {
  els.featureHistorySelect.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Select past run";
  els.featureHistorySelect.appendChild(empty);
  state.ribbon.featureHistory.slice().reverse().forEach((h, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${h.functionName} • ${h.profile || "fast"} • ${new Date(h.ts).toLocaleString()}`;
    els.featureHistorySelect.appendChild(opt);
  });
}

function appendRunHistory(entry) {
  state.ribbon.featureHistory.push({
    ...entry,
    ts: Date.now()
  });
  state.ribbon.featureHistory = state.ribbon.featureHistory.slice(-100);
  renderFeatureHistorySelect();
  persistUiState();
}

function renderFeatureArtifacts(result) {
  els.featureRunArtifacts.innerHTML = "";
  if (!result) return;
  const maybePaths = [];
  if (typeof result === "string") maybePaths.push(result);
  if (Array.isArray(result)) {
    result.forEach((x) => {
      if (typeof x === "string") maybePaths.push(x);
    });
  }
  if (result && typeof result === "object") {
    Object.values(result).forEach((v) => {
      if (typeof v === "string") maybePaths.push(v);
    });
  }
  maybePaths
    .filter((v) => /\.(csv|json|html|md|txt)$/i.test(v))
    .slice(0, 6)
    .forEach((filePath) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `Open ${filePath.split("/").pop()}`;
      btn.addEventListener("click", () => {
        const uri = filePath.startsWith("file://") ? filePath : `file://${filePath}`;
        void openExternal(uri);
      });
      els.featureRunArtifacts.appendChild(btn);
    });
}

function renderFeatureJobsList(jobs) {
  els.featureJobsList.innerHTML = "";
  (jobs || []).slice(-40).reverse().forEach((job) => {
    const row = document.createElement("div");
    row.className = "job-row";
    const title = document.createElement("span");
    title.textContent = `${job.functionName} • ${job.status}`;
    const bar = document.createElement("div");
    bar.className = "job-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(0, Math.min(100, Number(job.progress || 0)))}%`;
    bar.appendChild(fill);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Cancel";
    btn.disabled = job?.external === true || !["queued", "running"].includes(job.status);
    if (job?.external === true) btn.title = "Recovered from OpenAI endpoint";
    btn.addEventListener("click", async () => {
      await window.zoteroBridge.cancelFeatureJob({ jobId: job.id });
      await refreshFeatureJobs();
    });
    row.append(title, bar, btn);
    els.featureJobsList.appendChild(row);
  });
}

function closeBatchDoneModal() {
  if (!els.batchDoneModal) return;
  els.batchDoneModal.classList.add("hidden");
  els.batchDoneModal.setAttribute("aria-hidden", "true");
}

function openBatchDoneModal(text) {
  if (!els.batchDoneModal || !els.batchDoneSummary) return;
  els.batchDoneSummary.textContent = String(text || "").trim() || "Batch completed.";
  els.batchDoneModal.classList.remove("hidden");
  els.batchDoneModal.setAttribute("aria-hidden", "false");
}

function renderBatchMonitorList(jobs) {
  if (!els.batchMonitorList || !els.batchMonitorBadge) return;
  const workflowJobs = (jobs || []).filter(
    (job) => String(job?.functionName || "") === "workflow.create_subfolder_by_topic"
  );
  const running = workflowJobs.filter((job) => ["queued", "running"].includes(String(job?.status || ""))).length;
  els.batchMonitorBadge.textContent = `${running} running`;
  els.batchMonitorList.innerHTML = "";

  workflowJobs.slice(-20).reverse().forEach((job) => {
    const status = String(job?.status || "").trim().toLowerCase();
    const terminal = ["completed", "failed", "canceled"].includes(status);
    const pct = terminal ? 100 : Math.max(0, Math.min(100, Math.round(Number(job.progress || 0))));
    const row = document.createElement("div");
    row.className = "batch-monitor-row";
    if (status) row.classList.add(`is-${status}`);
    const title = document.createElement("div");
    title.className = "batch-monitor-row-title";
    const phase = String(job?.phase || "").trim();
    title.textContent = `${job.status} • ${pct}%${phase ? ` • ${phase}` : ""}`;
    const bar = document.createElement("div");
    bar.className = "batch-monitor-progress";
    const fill = document.createElement("span");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    const meta = document.createElement("div");
    meta.className = "batch-monitor-row-meta";
    const started = job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : "pending";
    const ended = job.finishedAt ? new Date(job.finishedAt).toLocaleTimeString() : "—";
    const result = job?.result?.result || {};
    const screened = Number(result?.screenedItems || result?.classifiedItems || result?.scannedItems || 0);
    const matched = Number(result?.matchedItems || 0);
    const added = Number(result?.addedItems || 0);
    meta.textContent = `job=${job.id} • started=${started} • done=${ended} • screened=${screened} • matched=${matched} • added=${added}${
      phase ? ` • phase=${phase}` : ""
    }`;
    row.append(title, bar, meta);
    els.batchMonitorList.appendChild(row);
  });

  if (!workflowJobs.length) {
    const empty = document.createElement("div");
    empty.className = "meta";
    empty.textContent = "No workflow batches yet.";
    els.batchMonitorList.appendChild(empty);
  }
}

function notifyBatchJobFinal(payload) {
  const job = payload || {};
  const jobId = String(job?.id || "");
  if (!jobId) return;
  if (!["completed", "failed"].includes(String(job?.status || ""))) return;
  if (String(job?.functionName || "") !== "workflow.create_subfolder_by_topic") return;
  if (state.batch.finalNotified.has(jobId)) return;
  state.batch.finalNotified.add(jobId);

  const result = job?.result?.result || {};
  if (job.status === "completed") {
    const screened = Number(result?.screenedItems || result?.classifiedItems || result?.scannedItems || 0);
    const matched = Number(result?.matchedItems || 0);
    const added = Number(result?.addedItems || 0);
    const target = String(result?.subcollection?.path || result?.subcollection?.name || "");
    const summary = `Background batch finished.\nScreened: ${screened}\nMatched: ${matched}\nAdded: ${added}\nTarget: ${target || "(subfolder)"}`;
    showToast(`Batch complete: ${added} added${target ? ` to ${target}` : ""}.`, "ok");
    openBatchDoneModal(summary);
  } else {
    const err = String(job?.error || job?.result?.message || "Background batch failed.");
    showToast(err, "err");
    openBatchDoneModal(`Background batch failed.\n${err}`);
  }
}

async function refreshFeatureJobs(force = false) {
  const res = await window.zoteroBridge.getFeatureJobs({ force });
  if (res?.status !== "ok") return [];
  const jobs = Array.isArray(res.jobs) ? res.jobs : [];
  renderFeatureJobsList(jobs);
  renderBatchMonitorList(jobs);
  const hasPendingWorkflowBatch = jobs.some(
    (job) =>
      String(job?.functionName || "") === "workflow.create_subfolder_by_topic" &&
      ["queued", "running"].includes(String(job?.status || ""))
  );
  if (hasPendingWorkflowBatch && !state.batch.showBatchMonitor) {
    state.batch.showBatchMonitor = true;
    applyFloatingPanelsVisibility();
    persistUiState();
  }
  return jobs;
}

function scheduleRefreshFeatureJobs(delayMs = 180) {
  if (refreshFeatureJobsTimer) window.clearTimeout(refreshFeatureJobsTimer);
  refreshFeatureJobsTimer = window.setTimeout(() => {
    refreshFeatureJobsTimer = null;
    lastFeatureJobsRefreshAt = Date.now();
    void refreshFeatureJobs(false);
  }, Math.max(50, Number(delayMs) || 180));
}

function scheduleRefreshBatchExplorer(delayMs = 320) {
  if (refreshBatchExplorerTimer) window.clearTimeout(refreshBatchExplorerTimer);
  refreshBatchExplorerTimer = window.setTimeout(() => {
    refreshBatchExplorerTimer = null;
    if (state.workspace.activeTab === "batches") void refreshBatchExplorer(false);
  }, Math.max(120, Number(delayMs) || 320));
}

let activeCollectionRefreshInFlight = false;
async function refreshActiveCollectionAfterBatchUpdate() {
  if (activeCollectionRefreshInFlight) return;
  const collectionKey = String(state.selectedCollectionKey || "");
  if (!collectionKey) return;
  activeCollectionRefreshInFlight = true;
  try {
    await loadTree(true);
    ensureTreeItemsLoaded(collectionKey, true);
    await loadItems(true, { ignoreTagFilter: true });
    await refreshCollectionTagPresence();
    renderCollections();
    renderDetails();
  } finally {
    activeCollectionRefreshInFlight = false;
  }
}

function openFeatureRunModal(feature) {
  state.ribbon.activeFeature = feature || null;
  els.featureRunTitle.textContent = feature ? `Run ${feature.label}` : "Run Feature";
  const schemaLine = (feature?.args || [])
    .map((arg) => `${arg.key}:${arg.type}${arg.required ? "*" : ""}`)
    .join(" | ");
  els.featureRunSchema.textContent = schemaLine || "No parameters";
  els.featureRunForm.innerHTML = "";
  els.featureRunOutput.textContent = "No run yet.";

  (feature?.args || []).forEach((arg) => {
    const wrap = document.createElement("div");
    wrap.className = "feature-field";

    const label = document.createElement("label");
    label.textContent = `${arg.key}${arg.required ? " *" : ""}`;
    wrap.appendChild(label);

    const isJson = arg.type === "json";
    const isBool = arg.type === "boolean";
    const isNumber = arg.type === "number";
    const input = document.createElement(isJson ? "textarea" : "input");
    input.dataset.argKey = arg.key;
    input.dataset.argType = arg.type || "string";
    if (!isJson) input.type = isNumber ? "number" : (isBool ? "checkbox" : "text");
    const templateValue = resolveSafeValue(feature, arg.key);
    if (templateValue !== undefined) {
      if (isBool) input.checked = Boolean(templateValue);
      else input.value = typeof templateValue === "object" ? JSON.stringify(templateValue, null, 2) : String(templateValue);
    } else if (arg.default !== undefined) {
      if (isBool) input.checked = Boolean(arg.default);
      else input.value = typeof arg.default === "object" ? JSON.stringify(arg.default, null, 2) : String(arg.default);
    } else if (isJson) {
      input.value = "";
      input.placeholder = "JSON value";
    }
    wrap.appendChild(input);
    els.featureRunForm.appendChild(wrap);
  });

  els.featureRunModal.classList.remove("hidden");
  els.featureRunModal.setAttribute("aria-hidden", "false");
}

function currentTemplateContext() {
  const coll = selectedCollection();
  return {
    "$selectedCollectionName": coll?.name || "",
    "$selectedCollectionKey": coll?.key || "",
    "$selectedItemKey": state.selectedItem?.key || "",
    "$selectedItemTitle": state.selectedItem?.title || ""
  };
}

function getFeatureProfile(functionName) {
  return state.ribbon.profileByFeature[functionName] || "fast";
}

function profilePresetFor(functionName, profile) {
  const base = FEATURE_SAFE_PRESETS[functionName] || {};
  const overrides = FEATURE_PROFILE_OVERRIDES[functionName]?.[profile] || {};
  return {
    ...base,
    ...overrides
  };
}

function materializeTemplateValue(value, context) {
  if (typeof value === "string" && context[value] !== undefined) {
    return context[value];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => materializeTemplateValue(entry, context));
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((k) => {
      out[k] = materializeTemplateValue(value[k], context);
    });
    return out;
  }
  return value;
}

function inferArgTypeFromValue(value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value) || (value && typeof value === "object")) return "json";
  return "string";
}

function resolveSafeValue(feature, argKey) {
  const selectedProfile = getFeatureProfile(feature?.functionName || "");
  const preset = profilePresetFor(feature?.functionName || "", selectedProfile);
  if (!(argKey in preset)) return undefined;
  const context = currentTemplateContext();
  return materializeTemplateValue(preset[argKey], context);
}

function buildSafeArgs(feature, profile = "fast") {
  const out = {};
  const context = currentTemplateContext();
  const preset = profilePresetFor(feature?.functionName || "", profile);

  (feature?.args || []).forEach((arg) => {
    let value;
    if (arg.key in preset) {
      value = materializeTemplateValue(preset[arg.key], context);
    } else if (arg.default !== undefined) {
      value = arg.default;
    } else {
      value = "";
    }

    if (arg.required && (value === "" || value === null || value === undefined)) {
      throw new Error(`Missing required template value for '${arg.key}'. Select item/collection or run manual form.`);
    }
    if (arg.required && arg.type === "json") {
      const looksPlaceholderJson = typeof value === "object" && value !== null && !Array.isArray(value) && !Object.keys(value).length;
      if (looksPlaceholderJson) {
        throw new Error(`'${arg.key}' requires real JSON payload. Use Params for manual input.`);
      }
    }
    if (value !== "" && value !== undefined) out[arg.key] = value;
  });
  return out;
}

function closeFeatureRunModal() {
  els.featureRunModal.classList.add("hidden");
  els.featureRunModal.setAttribute("aria-hidden", "true");
  els.featureRunResultMeta.textContent = "";
  els.featureRunArtifacts.innerHTML = "";
}

function collectFeatureArgs() {
  const out = {};
  const fields = els.featureRunForm.querySelectorAll("[data-arg-key]");
  fields.forEach((field) => {
    const key = field.dataset.argKey;
    const type = field.dataset.argType || "string";
    const value = type === "boolean" ? field.checked : field.value;
    if (type !== "boolean" && value === "") return;
    if (type === "json") {
      out[key] = value;
      return;
    }
    if (type === "number") {
      out[key] = value === "" ? "" : Number(value);
      return;
    }
    out[key] = value;
  });
  return out;
}

async function runRibbonFeature(execute) {
  const feature = state.ribbon.activeFeature;
  if (!feature) {
    setStatus("No ribbon feature selected.", "err");
    return;
  }
  if (execute && isDestructiveFeature(feature.functionName)) {
    const ok = window.confirm(`'${feature.functionName}' can modify data. Execute?`);
    if (!ok) return;
  }
  els.featureRunOutput.textContent = "Running...";
  els.featureRunResultMeta.textContent = "";
  const argsValues = collectFeatureArgs();
  const argsSchema = (feature.args || []).map((arg) => {
    const next = { ...arg };
    if ((!next.type || next.type === "string") && Object.prototype.hasOwnProperty.call(argsValues, arg.key)) {
      next.type = inferArgTypeFromValue(argsValues[arg.key]);
    }
    return next;
  });
  const res = await window.zoteroBridge.runFeature({
    functionName: feature.functionName,
    argsSchema,
    argsValues,
    execute,
    confirm: true
  });
  els.featureRunOutput.textContent = JSON.stringify(res, null, 2);
  renderFeatureArtifacts(res?.result);
  els.featureRunResultMeta.textContent = `${feature.functionName} • ${res?.status || "unknown"}`;
  appendRunHistory({
    functionName: feature.functionName,
    profile: getFeatureProfile(feature.functionName),
    execute,
    argsValues,
    argsSchema
  });
  if (res?.status === "ok") {
    setStatus(`${feature.label} ${execute ? "executed" : "dry-run completed"}.`, "ok");
    showToast(`${feature.label}: ${execute ? "done" : "dry-run"}`, "ok");
  } else {
    setStatus(res?.message || `${feature.label} failed.`, "err");
    showToast(res?.message || `${feature.label} failed`, "err");
  }
}

async function runRibbonFeatureSafe(feature, execute) {
  if (!feature) return;
  try {
    const profile = getFeatureProfile(feature.functionName);
    const argsValues = buildSafeArgs(feature, profile);
    if (execute && isDestructiveFeature(feature.functionName)) {
      const ok = window.confirm(`'${feature.functionName}' can modify data. Execute with '${profile}' profile?`);
      if (!ok) return;
    }
    setStatus(`${feature.label} (${profile}): ${execute ? "executing" : "dry-run"}...`);
    const argsSchema = (feature.args || []).map((arg) => {
      const next = { ...arg };
      if ((!next.type || next.type === "string") && Object.prototype.hasOwnProperty.call(argsValues, arg.key)) {
        next.type = inferArgTypeFromValue(argsValues[arg.key]);
      }
      return next;
    });
    const res = await window.zoteroBridge.runFeature({
      functionName: feature.functionName,
      argsSchema,
      argsValues,
      execute,
      confirm: true
    });
    appendRunHistory({
      functionName: feature.functionName,
      profile,
      execute,
      argsValues,
      argsSchema
    });
    if (res?.status === "ok") {
      setStatus(`${feature.label} (${profile}) ${execute ? "executed" : "dry-run completed"}.`, "ok");
      showToast(`${feature.label} (${profile}): ${execute ? "done" : "dry-run"}`, "ok");
    } else {
      setStatus(res?.message || `${feature.label} failed.`, "err");
      showToast(res?.message || `${feature.label} failed`, "err");
    }
  } catch (error) {
    setStatus(error.message || "Safe run failed.", "err");
    showToast(error.message || "Safe run failed.", "err");
  }
}

async function queueCurrentFeatureRun(execute) {
  const feature = state.ribbon.activeFeature;
  if (!feature) {
    setStatus("No feature selected.", "err");
    return;
  }
  const argsValues = collectFeatureArgs();
  const argsSchema = (feature.args || []).map((arg) => ({ ...arg }));
  const res = await window.zoteroBridge.enqueueFeatureJob({
    functionName: feature.functionName,
    argsSchema,
    argsValues,
    execute,
    confirm: true
  });
  if (res?.status === "ok") {
    setStatus(`Queued ${feature.functionName} (${res.jobId}).`, "ok");
    await refreshFeatureJobs();
    return;
  }
  if (res?.status === "confirm_required") {
    const ok = window.confirm(`${res.message} Queue anyway with confirmation?`);
    if (!ok) return;
    const retry = await window.zoteroBridge.enqueueFeatureJob({
      functionName: feature.functionName,
      argsSchema,
      argsValues,
      execute,
      confirm: true
    });
    if (retry?.status === "ok") {
      setStatus(`Queued ${feature.functionName} (${retry.jobId}).`, "ok");
      await refreshFeatureJobs();
      return;
    }
    setStatus(retry?.message || "Queue failed.", "err");
    return;
  }
  setStatus(res?.message || "Queue failed.", "err");
}

function replaySelectedHistory() {
  if (els.featureHistorySelect.value === "") return;
  const idx = Number(els.featureHistorySelect.value);
  if (!Number.isFinite(idx)) return;
  const rows = state.ribbon.featureHistory.slice().reverse();
  const h = rows[idx];
  if (!h) return;
  window.zoteroBridge
    .runFeature({
      functionName: h.functionName,
      argsSchema: h.argsSchema || [],
      argsValues: h.argsValues || {},
      execute: h.execute === true,
      confirm: true
    })
    .then((res) => {
      els.featureRunOutput.textContent = JSON.stringify(res, null, 2);
      renderFeatureArtifacts(res?.result);
      setStatus(`Replay ${h.functionName}: ${res?.status || "unknown"}`, res?.status === "ok" ? "ok" : "err");
    });
}

async function runFeatureDryHarness() {
  const tabs = state.ribbon.tabs || [];
  let okCount = 0;
  let failCount = 0;
  for (const tab of tabs) {
    for (const group of tab.groups || []) {
      for (const feature of group.features || []) {
        if (!featureVisibleByAccess(feature)) continue;
        try {
          const argsValues = buildSafeArgs(feature, getFeatureProfile(feature.functionName));
          const argsSchema = (feature.args || []).map((arg) => ({ ...arg }));
          const res = await window.zoteroBridge.runFeature({
            functionName: feature.functionName,
            argsSchema,
            argsValues,
            execute: false
          });
          if (res?.status === "ok") okCount += 1;
          else failCount += 1;
        } catch {
          failCount += 1;
        }
      }
    }
  }
  setStatus(`Dry harness done: ${okCount} ok, ${failCount} failed/skipped.`, failCount ? "warn" : "ok");
}

async function runFeatureHealthCheck() {
  const res = await window.zoteroBridge.getFeatureHealthCheck();
  els.featureRunOutput.textContent = JSON.stringify(res, null, 2);
  if (res?.status === "ok") {
    setStatus("Feature health check completed.", "ok");
  } else {
    setStatus(res?.message || "Feature health check failed.", "err");
  }
}

function renderSystemRibbonTab(tabName) {
  const group = document.createElement("div");
  group.className = "ribbon-group";
  const title = document.createElement("h4");
  title.textContent = tabName;
  const actions = document.createElement("div");
  actions.className = "ribbon-actions";
  const btn = (label, action, icon, disabled = false) =>
    `<button type="button" class="ribbon-sys-btn" data-action="${escapeHtml(action)}" data-icon="${escapeHtml(icon)}" ${
      disabled ? "disabled" : ""
    }>${escapeHtml(label)}</button>`;

  if (tabName === "Collections") {
    const hasCollection = Boolean(state.selectedCollectionKey);
    actions.innerHTML = [
      btn("Expand All", "expand_all", "folder-open"),
      btn("Collapse All", "collapse_all", "folder"),
      btn("Load Cache", "load_items_cache", "database", !hasCollection),
      btn("Load Fresh", "load_items_fresh", "refresh-cw", !hasCollection),
      btn("Open Zotero", "open_collection", "external-link", !hasCollection),
      btn("Copy Key", "copy_collection_key", "copy", !hasCollection)
    ].join("");
  } else {
    const hasCollection = Boolean(state.selectedCollectionKey);
    const hasItem = Boolean(state.selectedItem?.key);
    actions.innerHTML = [
      btn("Refresh Tree", "refresh_tree", "refresh-cw"),
      btn("Purge Cache", "purge_cache", "trash-2"),
      btn("Sync", "sync_now", "cloud"),
      btn(state.voice.voiceModeOn ? "Voice: On" : "Voice: Off", "voice_mode", "mic", !state.voice.supported),
      btn(state.voice.dictationOn ? "Dictation: On" : "Dictation: Off", "dictation", "audio-lines", !state.voice.supported),
      btn(
        state.inspector.density === "ultra"
          ? "Inspector: Ultra-compact"
          : state.inspector.density === "compact"
            ? "Inspector: Compact"
            : "Inspector: Comfortable",
        "inspector_density",
        "panel-right-open"
      ),
      btn("Advanced", "advanced_search", "search"),
      btn("Commands", "command_palette", "command"),
      btn(state.batch.showFeatureJobs ? "Hide Feature Jobs" : "Show Feature Jobs", "toggle_feature_jobs", "list"),
      btn(state.batch.showBatchMonitor ? "Hide Batch Monitor" : "Show Batch Monitor", "toggle_batch_monitor", "git-branch"),
      btn("Reset Layout", "reset_layout", "layout-panel-left"),
      btn(state.layout.hideLeft ? "Collections: Hidden" : "Collections: Visible", "toggle_left", "panel-left-open"),
      btn(state.layout.hideMid ? "Items: Hidden" : "Items: Visible", "toggle_mid", "panel-top-open"),
      btn(state.layout.hideRight ? "Inspector: Hidden" : "Inspector: Visible", "toggle_right", "panel-right-open"),
      btn("Load Items", "load_items_cache", "list", !hasCollection),
      btn("Open Reader", "open_reader", "book-open", !hasItem),
      btn("Open Item", "open_item", "external-link", !hasItem)
    ].join("");
  }
  group.append(title, actions);
  els.ribbonGroups.innerHTML = "";
  els.ribbonGroups.appendChild(group);
  hydrateButtonIcons();
}

async function runSystemRibbonAction(action) {
  if (action === "expand_all") {
    state.collections.forEach((c) => state.expanded.add(c.key));
    renderCollections();
    return;
  }
  if (action === "collapse_all") {
    state.expanded.clear();
    renderCollections();
    return;
  }
  if (action === "load_items_cache") return loadItems(false);
  if (action === "load_items_fresh") return loadItems(true);
  if (action === "open_collection") return openExternal(selectedCollectionZoteroUrl());
  if (action === "copy_collection_key") return copyText(state.selectedCollectionKey, "collection key");
  if (action === "refresh_tree") return loadTree(true);
  if (action === "purge_cache") {
    const res = await window.zoteroBridge.clearCache();
    if (res?.status !== "ok") {
      setStatus(res?.message || "Failed to purge cache.", "err");
      return;
    }
    return loadTree(true);
  }
  if (action === "sync_now") return syncNow();
  if (action === "voice_mode") return setVoiceMode(!state.voice.voiceModeOn);
  if (action === "dictation") return setDictation(!state.voice.dictationOn);
  if (action === "inspector_density") {
    state.inspector.density = nextInspectorDensity(state.inspector.density);
    applyInspectorDensity();
    persistUiState();
    renderRibbon();
    return;
  }
  if (action === "advanced_search") return openAdvancedSearch();
  if (action === "command_palette") return openCommandPalette();
  if (action === "toggle_feature_jobs") {
    state.batch.showFeatureJobs = !state.batch.showFeatureJobs;
    applyFloatingPanelsVisibility();
    persistUiState();
    renderRibbon();
    return;
  }
  if (action === "toggle_batch_monitor") {
    state.batch.showBatchMonitor = !state.batch.showBatchMonitor;
    applyFloatingPanelsVisibility();
    persistUiState();
    renderRibbon();
    return;
  }
  if (action === "reset_layout") return resetLayout();
  if (action === "toggle_left") state.layout.hideLeft = !state.layout.hideLeft;
  if (action === "toggle_mid") state.layout.hideMid = !state.layout.hideMid;
  if (action === "toggle_right") state.layout.hideRight = !state.layout.hideRight;
  if (action === "toggle_left" || action === "toggle_mid" || action === "toggle_right") {
    applyPaneWidths();
    hydrateButtonIcons();
    persistUiState();
    renderRibbon();
    return;
  }
  if (action === "open_reader") return openReader();
  if (action === "open_item") return openExternal(selectedItemZoteroUrl());
}

function renderRibbon() {
  const featureTabs = Array.isArray(state.ribbon.tabs) ? state.ribbon.tabs : [];
  const tabs = [{ tab: "Collections", system: true }, { tab: "Workspace", system: true }, ...featureTabs];

  if (!state.ribbon.activeTab || !tabs.some((t) => t.tab === state.ribbon.activeTab)) {
    state.ribbon.activeTab = tabs[0]?.tab || "Collections";
  }

  els.ribbonTabs.innerHTML = "";
  tabs.forEach((tabEntry) => {
    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.className = "ribbon-tab";
    if (tabEntry.tab === state.ribbon.activeTab) tabBtn.classList.add("active");
    tabBtn.textContent = tabEntry.tab;
    tabBtn.addEventListener("click", () => {
      state.ribbon.activeTab = tabEntry.tab;
      renderRibbon();
    });
    els.ribbonTabs.appendChild(tabBtn);
  });

  const active = tabs.find((t) => t.tab === state.ribbon.activeTab) || tabs[0];
  if (active?.system) {
    renderSystemRibbonTab(active.tab);
    return;
  }
  els.ribbonGroups.innerHTML = "";
  (active.groups || []).forEach((groupEntry) => {
    const visible = (groupEntry.features || []).filter((f) => featureVisibleByAccess(f));
    if (!visible.length) return;
    const group = document.createElement("div");
    group.className = "ribbon-group";
    const title = document.createElement("h4");
    title.textContent = groupEntry.group || "Group";
    const actions = document.createElement("div");
    actions.className = "ribbon-actions";
    const isExportPdfGroup = active?.tab === "Export & Files" && String(groupEntry.group || "") === "PDF";
    const isOpenCodingGroup = active?.tab === "Coding" && String(groupEntry.group || "") === "Open Coding";
    const isScreeningGroup = active?.tab === "Screening" && String(groupEntry.group || "") === "Screen";

    if (isExportPdfGroup) {
      const wrap = document.createElement("div");
      wrap.className = "ribbon-action-pair";
      const primaryBtn = document.createElement("button");
      primaryBtn.type = "button";
      primaryBtn.textContent = "Download PDFs";
      primaryBtn.title = "Download PDFs for selected collection into ./zotero_pdfs/<collection_name>";
      primaryBtn.addEventListener("click", () => {
        const coll = selectedCollection();
        if (!coll) {
          setStatus("Select a collection first.", "err");
          return;
        }
        void downloadPdfsForCollection(coll);
      });
      wrap.append(primaryBtn);
      actions.appendChild(wrap);
      group.append(title, actions);
      els.ribbonGroups.appendChild(group);
      return;
    }

    visible.forEach((feature) => {
      const wrap = document.createElement("div");
      wrap.className = "ribbon-action-pair";

      if (isOpenCodingGroup) {
        if (feature.functionName !== "open_coding") return;
        const primaryBtn = document.createElement("button");
        primaryBtn.type = "button";
        primaryBtn.textContent = "Code Collection";
        primaryBtn.title = "Open agent chat for verbatim evidence coding";
        primaryBtn.addEventListener("click", () => {
          openAgentChatWithTemplate(
            "code my collection with the following questions:\n1. [question 1]\n2. [question 2]\n3. [question 3]"
          );
        });
        wrap.append(primaryBtn);
        actions.appendChild(wrap);
        return;
      }

      if (isScreeningGroup && feature.functionName === "set_eligibility_criteria") {
        const primaryBtn = document.createElement("button");
        primaryBtn.type = "button";
        primaryBtn.textContent = "Set Eligibility Criteria";
        primaryBtn.title = "Open agent chat for eligibility criteria + schema confirmation";
        primaryBtn.addEventListener("click", () => {
          openAgentChatWithTemplate(
            "set eligibility criteria for screening:\nInclusion criteria:\n- [criterion 1]\n- [criterion 2]\nExclusion criteria:\n- [criterion 1]\n- [criterion 2]"
          );
        });
        wrap.append(primaryBtn);
        actions.appendChild(wrap);
        return;
      }

      const profileSelect = document.createElement("select");
      profileSelect.className = "ribbon-profile-select";
      ["fast", "full", "strict"].forEach((profile) => {
        const opt = document.createElement("option");
        opt.value = profile;
        opt.textContent = profile;
        profileSelect.appendChild(opt);
      });
      profileSelect.value = getFeatureProfile(feature.functionName);
      profileSelect.addEventListener("change", () => {
        state.ribbon.profileByFeature[feature.functionName] = profileSelect.value;
        persistUiState();
      });

      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.textContent = `Run ${feature.label || feature.functionName}`;
      runBtn.title = "Run with safe template defaults";
      runBtn.addEventListener("click", () => {
        void runRibbonFeatureSafe(feature, true);
      });

      const cfgBtn = document.createElement("button");
      cfgBtn.type = "button";
      cfgBtn.className = "secondary-btn";
      cfgBtn.textContent = "Params";
      cfgBtn.addEventListener("click", () => openFeatureRunModal(feature));

      wrap.append(profileSelect, runBtn, cfgBtn);
      actions.appendChild(wrap);
    });
    group.append(title, actions);
    els.ribbonGroups.appendChild(group);
  });
  if (!els.ribbonGroups.children.length) {
    els.ribbonGroups.innerHTML = "<div class='meta'>No features visible for this access level.</div>";
  }
  hydrateButtonIcons();
}

async function loadRibbonInventory() {
  const res = await window.zoteroBridge.getFeatureInventory();
  if (res?.status !== "ok") {
    setStatus(res?.message || "Failed to load feature inventory.", "err");
    return;
  }
  state.ribbon.tabs = Array.isArray(res.tabs) ? res.tabs : [];
  renderRibbon();
}

async function loadProfile() {
  const res = await window.zoteroBridge.getProfile();
  if (res?.status !== "ok") {
    if (els.profileLine) els.profileLine.textContent = `Error: ${res?.message || "profile unavailable"}`;
    setStatus(res?.message || "Could not load Zotero profile.", "err");
    return false;
  }
  state.profile = res.profile;
  if (els.profileLine) {
    els.profileLine.textContent = `Library: ${res.profile.libraryType} • ${res.profile.libraryId}`;
  } else {
    setStatus(`Library: ${res.profile.libraryType} • ${res.profile.libraryId}`, "ok");
  }
  return true;
}

async function loadTree(refresh) {
  const token = ++requestTokens.tree;
  dbg("loadTree", `start refresh=${String(Boolean(refresh))} token=${token}`);
  setStatus(refresh ? "Refreshing tree…" : "Loading tree…");
  const res = await window.zoteroBridge.getTree({ refresh });
  if (token !== requestTokens.tree) return;
  if (res?.status !== "ok") {
    dbg("loadTree", `error token=${token} message=${res?.message || "unknown"}`);
    setStatus(res?.message || "Failed to fetch collections.", "err");
    return;
  }
  state.collections = Array.isArray(res.collections) ? res.collections : [];
  if (refresh) {
    state.treeItemsByCollection.clear();
    state.treeItemsLoading.clear();
    state.treeItemsInFlight.clear();
  }

  if (state.collections.length) {
    const exists = state.collections.some((c) => c.key === state.selectedCollectionKey);
    if (!state.selectedCollectionKey || !exists) {
      state.selectedCollectionKey = state.collections[0].key;
    }
  }

  state.collections.forEach((c) => {
    if (!c.parentKey) state.expanded.add(c.key);
  });

  renderCollections();
  renderDetails();
  const msg = `Collections loaded (${state.collections.length})${res.cached ? " from cache" : ""}.`;
  dbg("loadTree", `done token=${token} collections=${state.collections.length} cached=${String(Boolean(res.cached))}`);
  setStatus(msg, "ok");
  void refreshTagFacets();

  const roots = rootCollections(state.collections);
  roots.slice(0, 4).forEach((root) => {
    if (state.expanded.has(root.key)) ensureTreeItemsLoaded(root.key, false);
  });
}

async function findFallbackNonEmptyCollectionKey(options = {}) {
  const excluded = new Set(
    (Array.isArray(options?.excludeKeys) ? options.excludeKeys : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const probeLimitRaw = Number(options?.probeLimit ?? 64);
  const probeLimit = Number.isFinite(probeLimitRaw) ? Math.max(1, Math.trunc(probeLimitRaw)) : 64;
  if (!state.collections.length) return "";

  for (const coll of state.collections) {
    const key = String(coll?.key || "");
    if (!key || excluded.has(key)) continue;
    const cached = state.treeItemsByCollection.get(key);
    if (Array.isArray(cached) && cached.length > 0) {
      dbg("findFallbackNonEmptyCollectionKey", `hit-cache collectionKey=${key} count=${cached.length}`);
      return key;
    }
  }

  let probed = 0;
  for (const coll of state.collections) {
    const key = String(coll?.key || "");
    if (!key || excluded.has(key)) continue;
    if (probed >= probeLimit) break;
    probed += 1;
    try {
      const res = await window.zoteroBridge.getItems({
        collectionKey: key,
        refresh: false,
        maxItems: 1
      });
      const rows = Array.isArray(res?.items) ? res.items : [];
      if (res?.status === "ok") {
        if (rows.length > 0) {
          dbg("findFallbackNonEmptyCollectionKey", `hit-probe collectionKey=${key} index=${probed}`);
          return key;
        }
        state.treeItemsByCollection.set(key, []);
      }
    } catch (error) {
      dbg(
        "findFallbackNonEmptyCollectionKey",
        `probe-error collectionKey=${key} index=${probed} message=${error?.message || "unknown"}`
      );
    }
  }

  dbg("findFallbackNonEmptyCollectionKey", `none-found probed=${probed} totalCollections=${state.collections.length}`);
  return "";
}

async function loadItems(refresh, options = {}) {
  const requestedCollectionKey = state.selectedCollectionKey;
  const refreshFlag = Boolean(refresh);
  const ignoreTagFilter = options?.ignoreTagFilter === true;
  if (!requestedCollectionKey) {
    dbg("loadItems", "aborted reason=no_selected_collection");
    setStatus("Select a collection first.", "err");
    return;
  }
  if (
    state.leftRail.selectedTags.length &&
    !refreshFlag &&
    !ignoreTagFilter &&
    state.itemsCollectionKey === requestedCollectionKey
  ) {
    dbg(
      "loadItems",
      `redirected collectionKey=${requestedCollectionKey} reason=collection_tag_filter selectedTags=${state.leftRail.selectedTags.length}`
    );
    await applyTagFilterFromSelection();
    return;
  }
  if (
    !refreshFlag &&
    state.itemsCollectionKey === requestedCollectionKey &&
    Array.isArray(state.items) &&
    state.items.length > 0
  ) {
    dbg(
      "loadItems",
      `skip collectionKey=${requestedCollectionKey} reason=already_loaded count=${state.items.length}`
    );
    state.itemsLoading = false;
    renderItems();
    return;
  }
  if (
    state.itemsLoading &&
    state.itemsLoadCtx.key === requestedCollectionKey &&
    state.itemsLoadCtx.refresh === refreshFlag
  ) {
    const ageMs = Math.max(0, Date.now() - Number(state.itemsLoadCtx.startedAt || 0));
    if (ageMs > 15000) {
      dbg(
        "loadItems",
        `stale-inflight-retry collectionKey=${requestedCollectionKey} refresh=${String(refreshFlag)} ageMs=${ageMs}`
      );
      state.itemsLoading = false;
      state.itemsLoadCtx.key = "";
      state.itemsLoadCtx.refresh = false;
      state.itemsLoadCtx.startedAt = 0;
    } else {
      dbg("loadItems", `deduped collectionKey=${requestedCollectionKey} refresh=${String(refreshFlag)} ageMs=${ageMs}`);
      return;
    }
  }
  if (
    state.itemsLoading &&
    state.itemsLoadCtx.key === requestedCollectionKey &&
    state.itemsLoadCtx.refresh === refreshFlag
  ) {
    dbg("loadItems", `deduped collectionKey=${requestedCollectionKey} refresh=${String(refreshFlag)}`);
    return;
  }
  const token = ++requestTokens.items;
  dbg(
    "loadItems",
    `start token=${token} collectionKey=${requestedCollectionKey || "(empty)"} refresh=${String(refreshFlag)}`
  );

  state.advanced.active = false;
  state.itemsLoading = true;
  state.itemsLoadCtx.key = requestedCollectionKey;
  state.itemsLoadCtx.refresh = refreshFlag;
  state.itemsLoadCtx.startedAt = Date.now();
  renderItems();
  setStatus(refreshFlag ? "Loading items fresh…" : "Loading items…");
  let res;
  try {
    res = await window.zoteroBridge.getItems({
      collectionKey: requestedCollectionKey,
      refresh: refreshFlag,
      maxItems: 0
    });
  } catch (error) {
    if (token !== requestTokens.items) return;
    state.itemsLoading = false;
    state.itemsLoadCtx.key = "";
    state.itemsLoadCtx.refresh = false;
    state.itemsLoadCtx.startedAt = 0;
    const message = error?.message || "Failed to load items.";
    const timedOut = String(message).toLowerCase().includes("timeout");
    if (timedOut) {
      const preview = state.treeItemsByCollection.get(requestedCollectionKey) || [];
      if (preview.length) {
        state.items = preview.slice();
        state.itemsCollectionKey = requestedCollectionKey;
        state.selectedItem = state.items[0] || null;
        state.itemsTable.selectedKeys.clear();
        state.itemsTable.anchorKey = "";
        if (state.selectedItem?.key) {
          state.itemsTable.selectedKeys.add(state.selectedItem.key);
          state.itemsTable.anchorKey = state.selectedItem.key;
        }
        renderItems();
        renderCollections();
        renderDetails();
        dbg(
          "loadItems",
          `timeout-fallback token=${token} collectionKey=${requestedCollectionKey} previewItems=${preview.length}`
        );
        setStatus(`Items request timed out. Showing ${preview.length} cached preview item(s).`, "warn");
        showToast("Items fetch slow; using cached preview.", "warn");
        return;
      }
    }
    renderItems();
    dbg("loadItems", `exception token=${token} collectionKey=${requestedCollectionKey} message=${message}`);
    setStatus(message, "err");
    showToast(message, "err");
    return;
  }
  if (token !== requestTokens.items) return;
  state.itemsLoadCtx.key = "";
  state.itemsLoadCtx.refresh = false;
  state.itemsLoadCtx.startedAt = 0;

  if (res?.status !== "ok") {
    state.itemsLoading = false;
    renderItems();
    dbg("loadItems", `error token=${token} collectionKey=${requestedCollectionKey} message=${res?.message || "unknown"}`);
    setStatus(res?.message || "Failed to load items.", "err");
    return;
  }
  if (state.selectedCollectionKey !== requestedCollectionKey) {
    state.itemsLoading = false;
    renderItems();
    dbg(
      "loadItems",
      `stale token=${token} requested=${requestedCollectionKey} current=${state.selectedCollectionKey || "(empty)"}`
    );
    return;
  }

  state.items = Array.isArray(res.items) ? res.items : [];
  state.itemsCollectionKey = requestedCollectionKey;
  state.itemsLoading = false;
  state.itemsTable.selectedKeys.clear();
  state.itemsTable.anchorKey = "";
  state.virtual.scrollTop = 0;
  if (els.itemsList) els.itemsList.scrollTop = 0;
  state.treeItemsByCollection.set(requestedCollectionKey, state.items.slice(0, TREE_PREVIEW_FETCH_MAX));

  const selectedItemKey = (() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return typeof parsed?.selectedItemKey === "string" ? parsed.selectedItemKey : "";
    } catch {
      return "";
    }
  })();

  state.selectedItem = state.items.find((item) => item.key === selectedItemKey) || state.items[0] || null;
  if (state.selectedItem?.key) {
    state.itemsTable.selectedKeys.add(state.selectedItem.key);
    state.itemsTable.anchorKey = state.selectedItem.key;
  }
  state.itemChildren = [];
  renderItems();
  renderCollections();
  renderDetails();

  const msg = `Items loaded (${state.items.length})${res.cached ? " from cache" : ""}.`;
  if (res?.warning) {
    dbg("loadItems", `warning token=${token} collectionKey=${requestedCollectionKey} warning=${String(res.warning)}`);
    showToast(String(res.warning), "warn");
  }
  dbg(
    "loadItems",
    `done token=${token} collectionKey=${requestedCollectionKey} items=${state.items.length} cached=${String(
      Boolean(res.cached)
    )}`
  );
  setStatus(msg, "ok");
  showToast(msg, "ok");
  void refreshTagFacets();
}

async function fetchChildren() {
  const token = ++requestTokens.children;
  if (!state.selectedItem?.key) {
    setStatus("Select an item first.", "err");
    return;
  }

  setStatus("Fetching item children…");
  const res = await window.zoteroBridge.getItemChildren({ itemKey: state.selectedItem.key });
  if (token !== requestTokens.children) return;
  if (res?.status !== "ok") {
    setStatus(res?.message || "Failed to load children.", "err");
    return;
  }

  state.itemChildren = Array.isArray(res.children) ? res.children : [];
  renderChildren();
  const msg = `Loaded ${state.itemChildren.length} children.`;
  setStatus(msg, "ok");
  showToast(msg, "ok");
}

async function syncNow() {
  setStatus("Syncing…");
  const res = await window.zoteroBridge.syncNow();
  if (res?.status !== "ok") {
    setStatus(res?.message || "Sync failed.", "err");
    showToast(res?.message || "Sync failed.", "err");
    return;
  }
  if (res.sync) {
    state.sync = res.sync;
    updateCounters();
  }
  setStatus("Sync run complete.", "ok");
  showToast("Sync run complete.", "ok");
}

async function openReader() {
  if (!state.selectedItem) {
    setStatus("Select an item first.", "err");
    return;
  }

  const readerTarget = state.selectedItem.url || selectedItemPdfUrl() || selectedItemDoiUrl();
  if (!readerTarget) {
    setStatus("No reader-compatible URL on selected item.", "err");
    return;
  }

  const res = await window.zoteroBridge.openReader({
    itemKey: state.selectedItem.key,
    url: readerTarget,
    page: 1
  });
  if (res?.status !== "ok") {
    setStatus(res?.message || "Failed to open reader.", "err");
    return;
  }
  setStatus("Reader opened.", "ok");
}

async function openExternal(url) {
  if (!url) {
    setStatus("No target URL available.", "err");
    return;
  }
  const res = await window.zoteroBridge.openExternal({ url });
  if (res?.status !== "ok") {
    setStatus(res?.message || "Failed to open external URL.", "err");
    return;
  }
  setStatus(`Opened: ${url}`, "ok");
}

async function copyText(text, label) {
  if (!text) {
    setStatus(`No ${label} available.`, "err");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Copied ${label}: ${text}`, "ok");
    showToast(`Copied ${label}.`, "ok");
  } catch {
    setStatus("Clipboard write failed.", "err");
  }
}

function resetLayout() {
  els.layoutRoot.removeAttribute("data-compact");
  state.layout.hideLeft = false;
  state.layout.hideMid = false;
  state.layout.hideRight = false;
  applyPaneWidths();
  hydrateButtonIcons();
  persistUiState();
  setStatus("Layout reset.", "ok");
}

function applyResponsiveLayout() {
  const compact = window.innerWidth < 1220;
  els.layoutRoot.setAttribute("data-compact", compact ? "1" : "0");
}

function wirePaneSplitters() {
  const startDrag = (splitter, leftKey, rightKey) => {
    if (!splitter) return;
    splitter.addEventListener("mousedown", (ev) => {
      if (els.layoutRoot.getAttribute("data-compact") === "1") return;
      ev.preventDefault();
      const startX = ev.clientX;
      const startLeft = normalizedPaneWeight(state.layout[leftKey], defaultPaneWeight(leftKey));
      const startRight = normalizedPaneWeight(state.layout[rightKey], defaultPaneWeight(rightKey));
      const total = Math.max(0.6, startLeft + startRight);
      const onMove = (moveEv) => {
        const deltaPx = moveEv.clientX - startX;
        const deltaFr = deltaPx / 360;
        let nextLeft = startLeft + deltaFr;
        nextLeft = Math.max(0.6, Math.min(total - 0.6, nextLeft));
        const nextRight = total - nextLeft;
        state.layout[leftKey] = Number(nextLeft.toFixed(3));
        state.layout[rightKey] = Number(nextRight.toFixed(3));
        applyPaneWidths();
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        persistUiState();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  };
  startDrag(els.splitterLeft, "paneLeft", "paneMid");
  startDrag(els.splitterRight, "paneMid", "paneRight");
}

function wireEvents() {
  const debouncedCollectionsRender = debounce(() => renderCollections(), 90);
  const debouncedItemsRender = debounce(() => renderItems(), 90);

  if (els.btnWorkspaceHome) {
    els.btnWorkspaceHome.addEventListener("click", () => setWorkspaceTab("home"));
  }
  if (els.btnWorkspaceBatches) {
    els.btnWorkspaceBatches.addEventListener("click", () => setWorkspaceTab("batches"));
  }

  els.collectionSearch.addEventListener("input", () => {
    state.collectionSearch = els.collectionSearch.value.trim().toLowerCase();
    debouncedCollectionsRender();
  });

  els.itemSearch.addEventListener("input", () => {
    state.itemSearch = els.itemSearch.value.trim().toLowerCase();
    debouncedItemsRender();
  });
  els.itemsList.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      moveTableSelection(1, ev.shiftKey);
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      moveTableSelection(-1, ev.shiftKey);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      const rows = visibleSortedItems();
      state.itemsTable.selectedKeys.clear();
      rows.forEach((r) => state.itemsTable.selectedKeys.add(r.key));
      if (rows[0]?.key) {
        state.itemsTable.anchorKey = rows[0].key;
        state.selectedItem = rows[0];
      }
      renderItems();
      renderDetails();
    }
  });
  if (els.itemsActiveFilters) {
    els.itemsActiveFilters.addEventListener("click", (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target.closest("[data-filter-tag-remove], [data-filter-clear-tags]") : null;
      if (!(target instanceof HTMLElement)) return;
      if (target.hasAttribute("data-filter-clear-tags")) {
        state.leftRail.selectedTags = [];
        if (state.selectedCollectionKey) void loadItems(false);
        else renderItems();
        renderCollections();
        persistUiState();
        return;
      }
      const tag = target.getAttribute("data-filter-tag-remove") || "";
      if (!tag) return;
      state.leftRail.selectedTags = state.leftRail.selectedTags.filter((x) => x !== tag);
      void applyTagFilterFromSelection();
    });
  }
  els.selectedItem.addEventListener("click", handleInspectorActions);
  els.selectedItem.addEventListener("input", handleInspectorInputs);
  els.selectedItem.addEventListener("keydown", handleInspectorKeydown);
  els.childrenList.addEventListener("click", handleInspectorActions);
  els.childrenList.addEventListener("input", handleInspectorInputs);
  els.childrenList.addEventListener("keydown", handleInspectorKeydown);
  els.childrenList.addEventListener("dblclick", () => {
    if (!state.selectedItem?.key) return;
    if (state.inspector.viewTab !== "metadata") return;
    state.inspector.metadataEdit = true;
    renderDetails();
  });
  if (els.paneDetails) {
    els.paneDetails.addEventListener("click", (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target.closest("[data-inspector-tab]") : null;
      if (!(target instanceof HTMLElement)) return;
      const tab = target.getAttribute("data-inspector-tab") || "item";
      setInspectorTab(tab);
      applyInspectorTab();
      persistUiState();
    });
    els.paneDetails.addEventListener("dblclick", () => {
      if (!state.selectedItem?.key) return;
      setInspectorTab("metadata");
      state.inspector.metadataEdit = true;
      renderDetails();
      persistUiState();
    });
  }

  let itemsScrollRaf = 0;
  els.itemsList.addEventListener("scroll", () => {
    state.virtual.scrollTop = els.itemsList.scrollTop;
    if (itemsScrollRaf) return;
    itemsScrollRaf = window.requestAnimationFrame(() => {
      itemsScrollRaf = 0;
      renderItems();
    });
  });

  if (els.btnRefreshTree) els.btnRefreshTree.addEventListener("click", () => loadTree(true));
  if (els.btnPurgeCache) els.btnPurgeCache.addEventListener("click", async () => {
    setStatus("Purging cache…");
    const res = await window.zoteroBridge.clearCache();
    if (res?.status !== "ok") {
      setStatus(res?.message || "Failed to purge cache.", "err");
      return;
    }
    await loadTree(true);
  });
  if (els.btnSyncNow) els.btnSyncNow.addEventListener("click", () => syncNow());
  if (els.btnVoiceMode) els.btnVoiceMode.addEventListener("click", () => setVoiceMode(!state.voice.voiceModeOn));
  if (els.btnDictation) els.btnDictation.addEventListener("click", () => setDictation(!state.voice.dictationOn));
  if (els.btnInspectorDensity)
    els.btnInspectorDensity.addEventListener("click", () => {
      state.inspector.density = nextInspectorDensity(state.inspector.density);
      applyInspectorDensity();
      persistUiState();
    });
  if (els.btnAdvancedSearch) els.btnAdvancedSearch.addEventListener("click", () => openAdvancedSearch());
  if (els.btnResetLayout) els.btnResetLayout.addEventListener("click", () => resetLayout());

  if (els.btnExpandAll) els.btnExpandAll.addEventListener("click", () => {
    state.collections.forEach((c) => state.expanded.add(c.key));
    renderCollections();
  });

  if (els.btnCollapseAll) els.btnCollapseAll.addEventListener("click", () => {
    state.expanded.clear();
    renderCollections();
  });

  if (els.btnLoadItems) els.btnLoadItems.addEventListener("click", () => loadItems(false));
  if (els.btnLoadItemsFresh) els.btnLoadItemsFresh.addEventListener("click", () => loadItems(true));
  if (els.btnOpenReader) els.btnOpenReader.addEventListener("click", () => openReader());
  if (els.btnCommandPalette) els.btnCommandPalette.addEventListener("click", () => openCommandPalette());

  if (els.btnCopyCollectionKey)
    els.btnCopyCollectionKey.addEventListener("click", () => copyText(state.selectedCollectionKey, "collection key"));
  if (els.btnOpenCollection) els.btnOpenCollection.addEventListener("click", () => openExternal(selectedCollectionZoteroUrl()));

  if (els.btnCollectionLoadCache) els.btnCollectionLoadCache.addEventListener("click", () => loadItems(false));
  if (els.btnCollectionLoadFresh) els.btnCollectionLoadFresh.addEventListener("click", () => loadItems(true));
  if (els.btnCollectionOpen) els.btnCollectionOpen.addEventListener("click", () => openExternal(selectedCollectionZoteroUrl()));
  if (els.btnCollectionCopy)
    els.btnCollectionCopy.addEventListener("click", () => copyText(state.selectedCollectionKey, "collection key"));

  if (els.btnItemOpenZotero) els.btnItemOpenZotero.addEventListener("click", () => openExternal(selectedItemZoteroUrl()));
  if (els.btnItemOpenUrl) els.btnItemOpenUrl.addEventListener("click", () => openExternal(state.selectedItem?.url || ""));
  if (els.btnItemOpenDoi) els.btnItemOpenDoi.addEventListener("click", () => openExternal(selectedItemDoiUrl()));
  if (els.btnItemOpenPdf) els.btnItemOpenPdf.addEventListener("click", () => openExternal(selectedItemPdfUrl()));
  if (els.btnItemChildren) els.btnItemChildren.addEventListener("click", () => fetchChildren());
  if (els.btnItemCopy) els.btnItemCopy.addEventListener("click", () => copyText(state.selectedItem?.key || "", "item key"));

  els.btnAdvancedSearchClose.addEventListener("click", () => closeAdvancedSearch());
  els.btnAdvancedSearchRun.addEventListener("click", () => runAdvancedSearch());
  els.btnAdvancedSearchSave.addEventListener("click", () => saveCurrentSearch());
  els.savedSearchSelect.addEventListener("change", () => {
    const id = els.savedSearchSelect.value;
    if (id) void runSavedSearchById(id);
  });
  els.btnSavedSearchDelete.addEventListener("click", () => deleteSelectedSavedSearch());
  els.ribbonGroups.addEventListener("click", (ev) => {
    const target = ev.target instanceof HTMLElement ? ev.target.closest("[data-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    const action = target.getAttribute("data-action");
    if (!action) return;
    void runSystemRibbonAction(action);
  });

  els.btnCommandPaletteClose.addEventListener("click", () => closeCommandPalette());
  els.btnFeatureRunClose.addEventListener("click", () => closeFeatureRunModal());
  els.btnFeatureDryRun.addEventListener("click", (ev) => {
    ev.preventDefault();
    void runRibbonFeature(false);
  });
  els.btnFeatureExecute.addEventListener("click", (ev) => {
    ev.preventDefault();
    void runRibbonFeature(true);
  });
  els.btnFeatureQueue.addEventListener("click", (ev) => {
    ev.preventDefault();
    void queueCurrentFeatureRun(true);
  });
  els.btnFeatureReplay.addEventListener("click", (ev) => {
    ev.preventDefault();
    replaySelectedHistory();
  });
  if (els.btnRefreshJobs) {
    els.btnRefreshJobs.addEventListener("click", () => {
      void refreshFeatureJobs();
    });
  }
  if (els.btnBatchesRefresh) {
    els.btnBatchesRefresh.addEventListener("click", () => {
      void refreshBatchExplorer(true);
    });
  }
  if (els.btnBatchDetailRefresh) {
    els.btnBatchDetailRefresh.addEventListener("click", () => {
      if (state.batchExplorer.selectedBatchId) {
        void loadBatchDetail(state.batchExplorer.selectedBatchId, true);
      }
    });
  }
  if (els.batchRowsTable) {
    els.batchRowsTable.addEventListener("click", (ev) => {
      const copyAllTarget = ev.target instanceof HTMLElement ? ev.target.closest("[data-batch-copy-all]") : null;
      if (copyAllTarget instanceof HTMLElement) {
        const rows = sortedBatchRows();
        if (!rows.length) {
          setStatus("No batch rows to copy.", "err");
          return;
        }
        const header = ["item", "title", "author", "status", "match", "confidence", "justification"].join("\t");
        const body = rows.map((row) => batchRowToTsv(row)).join("\n");
        void copyText(`${header}\n${body}`, "batch rows");
        return;
      }
      const copyRowTarget = ev.target instanceof HTMLElement ? ev.target.closest("[data-batch-copy-row]") : null;
      if (copyRowTarget instanceof HTMLElement) {
        const idx = Number(copyRowTarget.getAttribute("data-batch-copy-row"));
        const rows = sortedBatchRows();
        const row = rows[idx];
        if (!row) {
          setStatus("Batch row not found.", "err");
          return;
        }
        const header = ["item", "title", "author", "status", "match", "confidence", "justification"].join("\t");
        void copyText(`${header}\n${batchRowToTsv(row)}`, "batch row");
        return;
      }
      const sortTarget = ev.target instanceof HTMLElement ? ev.target.closest("[data-batch-sort]") : null;
      if (sortTarget instanceof HTMLElement) {
        const key = String(sortTarget.getAttribute("data-batch-sort") || "");
        if (key) {
          if (state.batchExplorer.sortKey === key) {
            state.batchExplorer.sortDir = state.batchExplorer.sortDir === "asc" ? "desc" : "asc";
          } else {
            state.batchExplorer.sortKey = key;
            state.batchExplorer.sortDir = key === "confidence" ? "desc" : "asc";
          }
          renderBatchRowsTable();
          persistUiState();
        }
        return;
      }
      const rowTarget = ev.target instanceof HTMLElement ? ev.target.closest("[data-batch-row]") : null;
      if (!(rowTarget instanceof HTMLElement)) return;
      const sorted = sortedBatchRows();
      const idx = Number(rowTarget.getAttribute("data-batch-row"));
      const row = sorted[idx];
      if (!row) return;
      state.batchExplorer.selectedRowIndex = Number(row.index);
      renderBatchRowsTable();
      renderBatchDetailPanel();
      persistUiState();
    });
  }
  if (els.btnBatchMonitorRefresh) {
    els.btnBatchMonitorRefresh.addEventListener("click", async () => {
      setStatus("Refreshing batch monitor and active collection…");
      await refreshFeatureJobs(true);
      await refreshActiveCollectionAfterBatchUpdate();
      setStatus("Batch monitor refreshed.", "ok");
    });
  }
  if (els.btnBatchMonitorClear) {
    els.btnBatchMonitorClear.addEventListener("click", async () => {
      const res = await window.zoteroBridge.clearWorkflowBatchJobs({ includeRunning: false });
      if (res?.status !== "ok") {
        setStatus(res?.message || "Failed to clear batch monitor.", "err");
        return;
      }
      setStatus("Cleared completed batch rows.", "ok");
      await refreshFeatureJobs(true);
      if (state.workspace.activeTab === "batches") await refreshBatchExplorer(true);
    });
  }
  if (els.btnBatchMonitorHide) {
    els.btnBatchMonitorHide.addEventListener("click", () => {
      state.batch.monitorCollapsed = !state.batch.monitorCollapsed;
      applyFloatingPanelsVisibility();
      persistUiState();
    });
  }
  if (els.btnBatchMonitorClose) {
    els.btnBatchMonitorClose.addEventListener("click", () => {
      state.batch.showBatchMonitor = false;
      applyFloatingPanelsVisibility();
      persistUiState();
    });
  }
  if (els.btnBatchDoneClose) {
    els.btnBatchDoneClose.addEventListener("click", () => closeBatchDoneModal());
  }
  els.agentChatFab.addEventListener("click", () => {
    setAgentChatOpen(!state.chat.open);
  });
  els.btnAgentChatClose.addEventListener("click", () => {
    setAgentChatOpen(false);
  });
  els.btnAgentChatClear.addEventListener("click", () => {
    state.chat.messages = [];
    state.chat.pendingIntent = null;
    state.chat.pendingConfirmation = null;
    state.chat.jobProgress = {};
    persistUiState();
    renderAgentChatMessages();
  });
  els.agentChatForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = String(els.agentChatInput.value || "").trim();
    if (!text || state.chat.pending) return;
    els.agentChatInput.value = "";
    void runAgentChatCommand(text);
  });
  els.btnFeatureHealth.addEventListener("click", () => {
    void runFeatureHealthCheck();
  });
  els.btnFeatureDryHarness.addEventListener("click", () => {
    void runFeatureDryHarness();
  });
  if (els.btnDownloadPdfs) {
    els.btnDownloadPdfs.addEventListener("click", () => {
      const coll = selectedCollection();
      if (!coll) {
        setStatus("Select a collection first.", "err");
        return;
      }
      void downloadPdfsForCollection(coll);
    });
  }
  els.accessLevelSelect.addEventListener("change", () => {
    state.ribbon.accessLevel = els.accessLevelSelect.value;
    persistUiState();
    renderRibbon();
  });

  bindGlobalWindowEvents();
  bindBridgeSubscriptions();
  bindLifecycleEvents();
}

function bindGlobalWindowEvents() {
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
      event.preventDefault();
      void loadTree(true);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      if (document.activeElement === els.collectionSearch) {
        els.itemSearch.focus();
        els.itemSearch.select();
      } else {
        els.collectionSearch.focus();
        els.collectionSearch.select();
      }
    }
    if (event.key === "Escape") {
      hideContextMenu();
      closeAdvancedSearch();
      closeCommandPalette();
      closeFeatureRunModal();
      closeBatchDoneModal();
      if (state.chat.open) setAgentChatOpen(false);
    }
  });

  window.addEventListener("click", () => hideContextMenu());
  window.addEventListener("resize", () => {
    hideContextMenu();
    applyResponsiveLayout();
    applyPaneWidths();
    renderItems();
  });
}

function handleFeatureJobStatus(payload) {
  notifyBatchJobFinal(payload || {});
  const job = payload || {};
  const status = String(job?.status || "");
  const isTerminal = ["completed", "failed", "canceled"].includes(status);
  if (
    String(job?.functionName || "") === "workflow.create_subfolder_by_topic" &&
    ["queued", "running"].includes(String(job?.status || "")) &&
    !state.batch.showBatchMonitor
  ) {
    state.batch.showBatchMonitor = true;
    applyFloatingPanelsVisibility();
    persistUiState();
  }
  if (isTerminal) {
    scheduleRefreshFeatureJobs(120);
    scheduleRefreshBatchExplorer(220);
  } else {
    const nowTs = Date.now();
    if (nowTs - lastFeatureJobsRefreshAt >= 1400) {
      scheduleRefreshFeatureJobs(220);
    }
    if (state.workspace.activeTab === "batches") {
      scheduleRefreshBatchExplorer(900);
    }
  }
  if (
    String(job?.functionName || "") === "workflow.create_subfolder_by_topic" &&
    status === "completed"
  ) {
    const jobId = String(job?.id || "");
    if (jobId && !state.batch.collectionRefreshed.has(jobId)) {
      state.batch.collectionRefreshed.add(jobId);
      void refreshActiveCollectionAfterBatchUpdate();
    }
  }
}

function bindBridgeSubscriptions() {
  window.zoteroBridge.onMenuCommand((payload) => {
    const id = payload?.commandId || "";
    if (id === "voice-mode-start") {
      void setVoiceMode(true);
      return;
    }
    if (id === "voice-mode-stop") {
      void setVoiceMode(false);
      return;
    }
    if (id === "dictation-start") {
      void setDictation(true);
      return;
    }
    if (id === "dictation-stop") {
      void setDictation(false);
      return;
    }
    commandRegistry.run(id, {});
  });

  window.zoteroBridge.onSyncStatus((sync) => {
    state.sync = {
      ...state.sync,
      ...sync
    };
    updateCounters();
    if (state.sync.state === "failed") {
      setStatus(state.sync.lastError || "Sync failed.", "err");
    }
  });

  window.zoteroBridge.onVoiceModeDelta((voice) => {
    state.voice = { ...state.voice, ...(voice || {}) };
    syncVoiceRuntimeToState();
    updateCounters();
  });

  window.zoteroBridge.onFeatureJobStatus((payload) => {
    handleFeatureJobStatus(payload);
  });
}

function bindLifecycleEvents() {
  window.addEventListener("beforeunload", () => {
    clearInspectorSyncTimer();
    if (voiceRuntime) voiceRuntime.stopAll();
  });
}

function initializeUiState() {
  restoreUiState();
  hydrateButtonIcons();
  applyInspectorDensity();
  applyPaneWidths();
  applyFloatingPanelsVisibility();
  registerCommands();
  wireEvents();
  wirePaneSplitters();
  applyResponsiveLayout();
  setWorkspaceTab(state.workspace.activeTab || "home");
  state.chat.messages = [
    {
      role: "assistant",
      text: "Agent ready. Send a command to organize collections by tag.",
      tone: "",
      at: Date.now()
    }
  ];
  renderAgentChatMessages();
  setAgentChatOpen(false);
  els.accessLevelSelect.value = state.ribbon.accessLevel || "safe";
  renderFeatureHistorySelect();
}

function initializeVoiceRuntime() {
  voiceRuntime = window.ZoteroVoiceRuntime.create({
    lang: "en-US",
    onVoiceFinal: (transcript) => {
      state.voice.lastTranscript = transcript;
      void handleVoiceCommandResult(transcript);
    },
    onDictationFinal: (transcript) => {
      state.voice.lastTranscript = transcript;
      appendTextToInput(getDictationTargetInput(), transcript);
    },
    onState: (runtimeState) => {
      state.voice.listeningVoice = Boolean(runtimeState?.voiceListening);
      state.voice.listeningDictation = Boolean(runtimeState?.dictationListening);
      updateCounters();
    },
    onError: (event) => {
      state.voice.lastError = event?.message || "speech error";
      setStatus(`Voice error: ${state.voice.lastError}`, "err");
      updateCounters();
    }
  });
  state.voice.supported = Boolean(voiceRuntime?.supported);
  updateCounters();
  updateSelectionBanner();
  updateActionStates();
}

async function loadRuntimePanels() {
  await loadRibbonInventory();
  const health = await window.zoteroBridge.getFeatureHealthCheck();
  if (health?.status === "ok") {
    const credsOk = Boolean(health?.checks?.credentials?.ok);
    const sigOk = Boolean(health?.checks?.signatures?.ok);
    if (!credsOk || !sigOk) {
      setStatus("Feature health check reports issues. Open Health in ribbon.", "warn");
    }
  } else {
    setStatus("Feature health check failed. Open Health in ribbon.", "warn");
  }
  const initialJobs = await refreshFeatureJobs();
  const hasPendingWorkflowBatch = (initialJobs || []).some(
    (job) =>
      String(job?.functionName || "") === "workflow.create_subfolder_by_topic" &&
      ["queued", "running"].includes(String(job?.status || ""))
  );
  if (hasPendingWorkflowBatch) {
    state.batch.showBatchMonitor = true;
    applyFloatingPanelsVisibility();
    persistUiState();
  }

  const voiceRes = await window.zoteroBridge.getVoiceSession();
  if (voiceRes?.status === "ok" && voiceRes.voice) {
    state.voice = { ...state.voice, ...voiceRes.voice };
    syncVoiceRuntimeToState();
  }
  updateCounters();
  updateActionStates();

  const syncRes = await window.zoteroBridge.getSyncStatus();
  if (syncRes?.status === "ok" && syncRes.sync) {
    state.sync = syncRes.sync;
  }
  updateCounters();

  await refreshSavedSearches();
}

async function loadInitialCollectionData() {
  const ok = await loadProfile();
  if (!ok) return;
  await loadTree(false);
  if (!state.selectedCollectionKey) return;
  await loadItems(false, { ignoreTagFilter: true });
  if (!state.items.length) {
    const fromKey = state.selectedCollectionKey;
    const fallbackKey = await findFallbackNonEmptyCollectionKey({
      excludeKeys: [fromKey],
      probeLimit: 96
    });
    if (fallbackKey) {
      dbg("boot", `auto-switch-nonempty from=${fromKey || "(empty)"} to=${fallbackKey}`);
      selectCollection(fallbackKey, { loadItems: false, resetItem: true });
      await loadItems(false, { ignoreTagFilter: true });
      showToast("Switched to first non-empty collection.", "warn");
    } else {
      dbg("boot", `no-nonempty-fallback from=${fromKey || "(empty)"}`);
    }
  }
  void refreshCollectionTagPresence();
  if (state.leftRail.selectedTags.length) {
    await applyTagFilterFromSelection();
  }
  ensureTreeItemsLoaded(state.selectedCollectionKey, false);
  if (state.selectedItem?.key) {
    const fromCache = findItemInCollectionCache(state.selectedCollectionKey, state.selectedItem.key);
    if (fromCache) state.selectedItem = fromCache;
  }
}

async function boot() {
  dbg("boot", "start");
  initializeUiState();
  initializeVoiceRuntime();
  await loadRuntimePanels();
  await loadInitialCollectionData();
  dbg("boot", "complete");
}

boot();
