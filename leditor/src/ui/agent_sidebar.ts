import type { EditorHandle } from "../api/leditor.ts";
import { getAiSettings, setAiSettings, subscribeAiSettings } from "./ai_settings.ts";
import {
  applySourceChecksThreadToEditor,
  getSourceChecksThread,
  setSourceChecksVisible,
  subscribeSourceChecksThread,
  upsertSourceChecksFromRun
} from "./source_checks_thread.ts";
import { appendAgentHistoryMessage, getAgentHistory } from "./agent_history.ts";
import { Fragment } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import agentActionPrompts from "./agent_action_prompts.json";
import diffMatchPatch from "diff-match-patch";
import { getSourceCheckState } from "../editor/source_check_badges.ts";
import { buildLlmCacheKey, getLlmCacheEntry, setLlmCacheEntry } from "./llm_cache.ts";

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
};

export type AgentRunRequest = {
  instruction: string;
  actionId?: AgentActionId;
  selection?: { from: number; to: number };
};

export type AgentProgressEvent =
  | { kind: "status"; message: string }
  | { kind: "stream"; delta: string }
  | { kind: "tool"; tool: string }
  | { kind: "error"; message: string };

export type AgentRunResult = {
  assistantText: string;
  meta?: { provider?: string; model?: string; ms?: number };
  apply?:
    | { kind: "replaceRange"; from: number; to: number; text: string; autoApply?: boolean }
    | { kind: "setDocument"; doc: object; autoApply?: boolean }
    | { kind: "insertAtCursor"; text: string; autoApply?: boolean }
    | {
        kind: "batchReplace";
        items: Array<{ n: number; from: number; to: number; text: string; originalText: string; anchorInsertions?: SubstantiateAnchorInsertion[] }>;
        autoApply?: boolean;
      };
};

type AgentApply = NonNullable<AgentRunResult["apply"]>;

type SubstantiateMatch = {
  dqid: string;
  title: string;
  itemKey?: string;
  author?: string;
  year?: string;
  source?: string;
  page?: number;
  directQuote?: string;
  paraphrase?: string;
  score?: number;
};

type SubstantiateAnchorSpec = {
  dqid: string;
  dataKey: string;
  dataQuoteId: string;
  text: string;
  title: string;
  href?: string;
  dataDqid?: string;
  dataQuoteText?: string;
  dataOrigHref?: string;
};

type SubstantiateAnchorEdits = {
  action: "none" | "add_anchor_only" | "append_clause_after_anchor" | "prepend_clause_before_anchor";
  clause?: string;
  anchors: SubstantiateAnchorSpec[];
};

type SubstantiateAnchorInsertion = {
  pos: number;
  prefix: string;
  anchors: SubstantiateAnchorSpec[];
};

type SubstantiateSuggestion = {
  key: string;
  paragraphN: number;
  anchorText: string;
  anchorTitle: string;
  sentence: string;
  rewrite: string;
  stance?: "corroborates" | "refutes" | "mixed" | "uncertain";
  notes?: string;
  justification?: string;
  suggestion?: string;
  diffs?: string;
  matches: SubstantiateMatch[];
  anchorEdits?: SubstantiateAnchorEdits;
  from?: number;
  to?: number;
  status?: "pending" | "applied" | "dismissed";
  error?: string;
};

export type AgentActionId =
  | "refine"
  | "paraphrase"
  | "shorten"
  | "substantiate"
  | "proofread"
  | "abstract"
  | "introduction"
  | "methodology"
  | "findings"
  | "recommendations"
  | "conclusion"
  | "check_sources"
  | "clear_checks";

export type AgentSidebarController = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  openView: (view: "chat" | "dictionary" | "sections" | "sources") => void;
  runAction: (actionId: AgentActionId, options?: { mode?: "block" }) => void;
  runSectionsBatch: () => void;
  openDictionary: (mode?: "definition" | "explain" | "synonyms" | "antonyms") => void;
  destroy: () => void;
};

type AgentSidebarOptions = {
  runAgent: (
    request: AgentRunRequest,
    editorHandle: EditorHandle,
    progress?: (event: AgentProgressEvent | string) => void,
    signal?: AbortSignal,
    requestId?: string
  ) => Promise<AgentRunResult>;
};

const APP_OPEN_CLASS = "leditor-app--agent-open";
const ROOT_ID = "leditor-agent-sidebar";
const DRAFT_RAIL_ID = "leditor-ai-draft-rail";
const FEEDBACK_HUB_ID = "leditor-feedback-hub";
const FEEDBACK_HUB_STORAGE_KEY = "leditor.feedbackHub.mode";
type FeedbackHubMode = "edits" | "sources" | "all";

const clampHistory = (messages: AgentMessage[], maxMessages: number): AgentMessage[] => {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(messages.length - maxMessages);
};

const formatTimestamp = (ts: number): string => {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const getAppRoot = (): HTMLElement | null =>
  (document.getElementById("leditor-app") as HTMLElement | null) ?? (document.body as HTMLElement | null);

const getStatusBarHeight = (): number => {
  const el = document.querySelector<HTMLElement>(".leditor-status-bar");
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  return rect.height > 0 ? rect.height : 0;
};

export const createAgentSidebar = (
  editorHandle: EditorHandle,
  options: AgentSidebarOptions
): AgentSidebarController => {
  const root = getAppRoot();
  if (!root) {
    throw new Error("AgentSidebar: unable to resolve app root");
  }

  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    existing.remove();
  }

  const sidebar = document.createElement("aside");
  sidebar.id = ROOT_ID;
  sidebar.className = "leditor-agent-sidebar";
  sidebar.setAttribute("role", "complementary");
  sidebar.setAttribute("aria-label", "Agent");

  const header = document.createElement("div");
  header.className = "leditor-agent-sidebar__header";
  const headerTop = document.createElement("div");
  headerTop.className = "leditor-agent-sidebar__headerTop";
  const headerBottom = document.createElement("div");
  headerBottom.className = "leditor-agent-sidebar__headerTabs";
  const title = document.createElement("div");
  title.className = "leditor-agent-sidebar__title";
  title.textContent = "Agent";

  const headerRight = document.createElement("div");
  headerRight.className = "leditor-agent-sidebar__headerRight";

  type SidebarViewId =
    | "chat"
    | "dictionary"
    | "sections"
    | "refine"
    | "paraphrase"
    | "shorten"
    | "proofread"
    | "substantiate"
    | "sources";
  let viewMode: SidebarViewId = "chat";

  const viewTabs = document.createElement("div");
  viewTabs.className = "leditor-agent-sidebar__viewTabs";
  viewTabs.setAttribute("role", "tablist");
  viewTabs.setAttribute("aria-label", "Agent views");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-agent-sidebar__close";
  closeBtn.textContent = "Close";

  headerRight.append(closeBtn);
  headerTop.append(title, headerRight);

  const modelPickerWrap = document.createElement("div");
  modelPickerWrap.className = "leditor-agent-sidebar__modelPickerWrap";
  const modelPickerBtn = document.createElement("button");
  modelPickerBtn.type = "button";
  modelPickerBtn.className = "leditor-agent-sidebar__modelPickerBtn";
  modelPickerBtn.setAttribute("aria-haspopup", "menu");
  modelPickerBtn.setAttribute("aria-expanded", "false");
  const modelPickerLabel = document.createElement("div");
  modelPickerLabel.className = "leditor-agent-sidebar__modelPickerLabel";
  const modelPickerChevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  modelPickerChevron.setAttribute("viewBox", "0 0 24 24");
  modelPickerChevron.setAttribute("width", "16");
  modelPickerChevron.setAttribute("height", "16");
  modelPickerChevron.classList.add("leditor-agent-sidebar__modelPickerChevron");
  const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  chevronPath.setAttribute("d", "m6 9 6 6 6-6");
  chevronPath.setAttribute("fill", "none");
  chevronPath.setAttribute("stroke", "currentColor");
  chevronPath.setAttribute("stroke-width", "2");
  chevronPath.setAttribute("stroke-linecap", "round");
  chevronPath.setAttribute("stroke-linejoin", "round");
  modelPickerChevron.appendChild(chevronPath);
  modelPickerBtn.append(modelPickerLabel, modelPickerChevron);
  modelPickerWrap.appendChild(modelPickerBtn);

  const statusLine = document.createElement("div");
  statusLine.className = "leditor-agent-sidebar__status";
  statusLine.textContent = "Ready • Reference paragraphs by index (e.g. 35, 35-38).";

  const actionPickerWrap = document.createElement("div");
  actionPickerWrap.className = "leditor-agent-sidebar__actionPickerWrap";
  const actionPickerBtn = document.createElement("button");
  actionPickerBtn.type = "button";
  actionPickerBtn.className = "leditor-agent-sidebar__actionPickerBtn";
  actionPickerBtn.setAttribute("aria-haspopup", "menu");
  actionPickerBtn.setAttribute("aria-expanded", "false");
  const actionPickerLabel = document.createElement("div");
  actionPickerLabel.className = "leditor-agent-sidebar__actionPickerLabel";
  actionPickerLabel.textContent = "Auto";
  const actionPickerChevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  actionPickerChevron.setAttribute("viewBox", "0 0 24 24");
  actionPickerChevron.setAttribute("width", "16");
  actionPickerChevron.setAttribute("height", "16");
  actionPickerChevron.classList.add("leditor-agent-sidebar__modelPickerChevron");
  const actionChevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  actionChevronPath.setAttribute("d", "m6 9 6 6 6-6");
  actionChevronPath.setAttribute("fill", "none");
  actionChevronPath.setAttribute("stroke", "currentColor");
  actionChevronPath.setAttribute("stroke-width", "2");
  actionChevronPath.setAttribute("stroke-linecap", "round");
  actionChevronPath.setAttribute("stroke-linejoin", "round");
  actionPickerChevron.appendChild(actionChevronPath);
  actionPickerBtn.append(actionPickerLabel, actionPickerChevron);
  actionPickerWrap.appendChild(actionPickerBtn);

  const actionMenu = document.createElement("div");
  actionMenu.className = "leditor-agent-sidebar__actionMenu is-hidden";
  actionMenu.setAttribute("role", "menu");
  actionPickerWrap.appendChild(actionMenu);
  actionMenu.addEventListener("click", (event) => event.stopPropagation());

  const showNumbersLabel = document.createElement("label");
  showNumbersLabel.className = "leditor-agent-sidebar__numbersToggle";
  const showNumbers = document.createElement("input");
  showNumbers.type = "checkbox";
  showNumbers.checked = true;
  const showNumbersText = document.createElement("span");
  showNumbersText.textContent = "Numbers";
  showNumbersLabel.append(showNumbers, showNumbersText);

  // Replace the legacy "Auto" action picker with lightweight view tabs (chat / actions / sources).
  // The plus menu and slash commands remain the primary way to run actions.
  headerBottom.append(viewTabs);
  header.append(headerTop, headerBottom);

  let open = false;
  // Keep subscription to prevent stale settings references (and for future Agent settings),
  // but remove UI scope controls: agent targets are selected deterministically by paragraph index.
  let currentSettings = getAiSettings();
  let renderReady = false;
  const unsubscribeScope = subscribeAiSettings((settings) => {
    currentSettings = settings;
    if (renderReady) {
      renderModelPickerLabel();
    }
  });

  type CatalogModel = { id: string; label?: string; description?: string };
  type CatalogProvider = { id: string; label?: string; envKey?: string; models?: CatalogModel[] };
  type LlmCatalog = { providers: CatalogProvider[] };
  type LlmStatus = {
    providers: Array<{
      id: string;
      label?: string;
      envKey?: string;
      hasApiKey?: boolean;
      defaultModel?: string;
      modelFromEnv?: boolean;
    }>;
  };

  let llmCatalog: LlmCatalog | null = null;
  let llmStatus: LlmStatus | null = null;

  const modelMenu = document.createElement("div");
  modelMenu.className = "leditor-agent-sidebar__modelMenu is-hidden";
  modelMenu.setAttribute("role", "menu");
  modelPickerWrap.appendChild(modelMenu);
  modelMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  const messagesEl = document.createElement("div");
  messagesEl.className = "leditor-agent-sidebar__messages";
  messagesEl.setAttribute("role", "log");
  messagesEl.setAttribute("aria-live", "polite");

  const boxesEl = document.createElement("div");
  boxesEl.className = "leditor-agent-sidebar__boxes is-hidden";
  boxesEl.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.className = "leditor-agent-sidebar__panel";

  const results = document.createElement("div");
  results.className = "leditor-agent-sidebar__results";

  const composer = document.createElement("div");
  composer.className = "leditor-agent-sidebar__composer";

  const composerInner = document.createElement("div");
  composerInner.className = "leditor-agent-sidebar__composerInner";

  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "leditor-agent-sidebar__iconBtn";
  plusBtn.setAttribute("aria-label", "Actions");
  plusBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>';

  const inputWrap = document.createElement("div");
  inputWrap.className = "leditor-agent-sidebar__inputWrap";

  const inputShell = document.createElement("div");
  inputShell.className = "leditor-agent-sidebar__inputShell";

  const inputGrid = document.createElement("div");
  inputGrid.className = "leditor-agent-sidebar__inputGrid";

  const inputOverlay = document.createElement("div");
  inputOverlay.className = "leditor-agent-sidebar__inputOverlay";
  inputOverlay.setAttribute("aria-hidden", "true");

  const input = document.createElement("textarea");
  input.className = "leditor-agent-sidebar__input";
  input.placeholder = 'Try: "35 refine" or "35-38 simplify"';
  input.rows = 1;

  const slashMenu = document.createElement("div");
  slashMenu.className = "leditor-agent-sidebar__slashMenu";
  slashMenu.classList.add("is-hidden");

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "leditor-agent-sidebar__sendIcon";
  sendBtn.setAttribute("aria-label", "Send");
  const SEND_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>';
  const STOP_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"></rect></svg>';
  sendBtn.innerHTML = SEND_ICON;

  inputGrid.append(inputOverlay, input);
  inputShell.appendChild(inputGrid);
  inputWrap.append(inputShell, slashMenu);
  composerInner.append(plusBtn, inputWrap, sendBtn);
  composer.appendChild(composerInner);

  const plusMenu = document.createElement("div");
  plusMenu.className = "leditor-agent-sidebar__plusMenu is-hidden";
  plusMenu.setAttribute("role", "menu");
  plusMenu.addEventListener("click", (event) => event.stopPropagation());
  composer.appendChild(plusMenu);

  results.append(messagesEl, boxesEl);
  panel.append(results);

  const footer = document.createElement("div");
  footer.className = "leditor-agent-sidebar__footer";

  const footerMeta = document.createElement("div");
  footerMeta.className = "leditor-agent-sidebar__footerMeta";
  const footerControls = document.createElement("div");
  footerControls.className = "leditor-agent-sidebar__footerControls";
  footerControls.append(modelPickerWrap, actionPickerWrap, showNumbersLabel);
  footerMeta.append(footerControls, statusLine);

  footer.append(footerMeta, composer);

  sidebar.append(header, panel, footer);
  root.appendChild(sidebar);

  let messages: AgentMessage[] = [];
  let inflight = false;
  let destroyed = false;
  let pending: AgentApply | null = null;
  let pendingByView: Partial<Record<SidebarViewId, AgentApply | null>> = {
    refine: null,
    paraphrase: null,
    shorten: null,
    proofread: null,
    sections: null,
    substantiate: null,
    dictionary: null,
    sources: null
  };
  let sourceFocusKey: string | null = null;
  let pendingActionId: AgentActionId | null = null;
  let sectionBatchMode = false;
  let substantiateResults: SubstantiateSuggestion[] = [];
  let substantiateError: string | null = null;
  let substantiateSuppressedKeys = new Set<string>();
  let substantiatePreviewState: "applied" | "failed" | null = null;
  let substantiatePreviewRaf = 0;
  let lastApiMeta: { provider?: string; model?: string; ms?: number; ts: number } | null = null;
  let abortController: AbortController | null = null;
  let activeRequestId: string | null = null;
  let sourcesLoading = false;
  type DictionaryMode = "definition" | "explain" | "synonyms" | "antonyms";
  type DictionaryEntry = {
    status: "idle" | "loading" | "success" | "error";
    text?: string;
    suggestions?: string[];
    selected?: string;
    error?: string;
    raw?: string;
  };
  type DictionarySelection = {
    from: number;
    to: number;
    text: string;
    sentence: string;
    blockText: string;
  };
  type DictionarySearch = {
    id: string;
    createdAt: number;
    selection: DictionarySelection;
    entries: Record<DictionaryMode, DictionaryEntry>;
  };
  const DICT_CONTEXT_LIMIT = 800;
  const dictionaryModes: DictionaryMode[] = ["definition", "explain", "synonyms", "antonyms"];
  let dictionaryActiveMode: DictionaryMode = "synonyms";
  let dictionarySelection: DictionarySelection | null = null;
  let dictionaryNotice: string | null = null;
  let dictionaryHistory: DictionarySearch[] = [];
  let dictionaryActiveId: string | null = null;
  let dictionarySkipNextAutoLookup = false;

  const makeRequestId = () => `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const makeMessageId = () => `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const seedHistoryMessages = () => {
    const stored = getAgentHistory();
    if (!stored.length) return;
    messages = clampHistory(
      stored.map((m) => ({ id: makeMessageId(), role: m.role, content: m.content, ts: m.ts })),
      50
    );
    renderMessages(true);
  };

  type SlashCommand = {
    id: AgentActionId;
    label: string;
    aliases: string[];
  };

  const SLASH_COMMANDS: SlashCommand[] = [
    { id: "refine", label: "Refine", aliases: ["/r", "/refine"] },
    { id: "paraphrase", label: "Paraphrase", aliases: ["/p", "/paraphrase"] },
    { id: "shorten", label: "Shorten", aliases: ["/s", "/shorten"] },
    { id: "proofread", label: "Proofread", aliases: ["/pr", "/proofread"] },
    { id: "substantiate", label: "Substantiate", aliases: ["/sub", "/substantiate"] },
    { id: "abstract", label: "Abstract", aliases: ["/abstract", "/abs"] },
    { id: "introduction", label: "Introduction", aliases: ["/intro", "/introduction"] },
    { id: "methodology", label: "Methodology", aliases: ["/methods", "/methodology"] },
    { id: "findings", label: "Findings", aliases: ["/findings", "/results"] },
    { id: "recommendations", label: "Recommendations", aliases: ["/recs", "/recommendations"] },
    { id: "conclusion", label: "Conclusion", aliases: ["/conclusion", "/conc"] },
    { id: "check_sources", label: "Check sources", aliases: ["/cs", "/check", "/check-sources", "/check sources", "/checksources"] },
    { id: "clear_checks", label: "Clear checks", aliases: ["/cc", "/clear", "/clear-checks", "/clear checks", "/clearchecks"] }
  ];

  const normalizeSlash = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");

  const loadFeedbackHubMode = (): FeedbackHubMode => {
    try {
      const raw = (window.localStorage.getItem(FEEDBACK_HUB_STORAGE_KEY) || "").trim().toLowerCase();
      if (raw === "edits" || raw === "sources" || raw === "all") return raw;
    } catch {
      // ignore
    }
    return "edits";
  };

  const saveFeedbackHubMode = (mode: FeedbackHubMode) => {
    try {
      window.localStorage.setItem(FEEDBACK_HUB_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const detectActionFromInstruction = (instruction: string): AgentActionId | null => {
    const text = String(instruction ?? "").toLowerCase();
    if (/\B\/refine\b/.test(text) || /\brefine\b/.test(text)) return "refine";
    if (/\B\/rewrite\b/.test(text) || /\brewrite\b/.test(text)) return "refine";
    if (/\B\/revise\b/.test(text) || /\brevise\b/.test(text)) return "refine";
    if (/\B\/reword\b/.test(text) || /\breword\b/.test(text)) return "refine";
    if (/\B\/paraphrase\b/.test(text) || /\bparaphrase\b/.test(text)) return "paraphrase";
    if (/\B\/shorten\b/.test(text) || /\bshorten\b/.test(text)) return "shorten";
    if (/\B\/proofread\b/.test(text) || /\bproofread\b/.test(text)) return "proofread";
    if (/\B\/substantiate\b/.test(text) || /\bsubstantiate\b/.test(text)) return "substantiate";
    if (/\B\/abstract\b/.test(text) || /\babstract\b/.test(text)) return "abstract";
    if (/\B\/intro\b/.test(text) || /\B\/introduction\b/.test(text) || /\bintroduction\b/.test(text)) return "introduction";
    if (/\B\/methods\b/.test(text) || /\B\/methodology\b/.test(text) || /\bmethodology\b/.test(text)) return "methodology";
    if (/\B\/findings\b/.test(text) || /\B\/results\b/.test(text) || /\bfindings\b/.test(text)) return "findings";
    if (/\B\/recs\b/.test(text) || /\B\/recommendations\b/.test(text) || /\brecommendations\b/.test(text)) return "recommendations";
    if (/\B\/conclusion\b/.test(text) || /\B\/conc\b/.test(text) || /\bconclusion\b/.test(text)) return "conclusion";
    if (
      /\B\/check(?:\s+sources)?\b/.test(text) ||
      /\bcheck\s+sources?\b/.test(text) ||
      /\bverify\s+sources?\b/.test(text) ||
      /\bcheck\s+citations?\b/.test(text) ||
      /\bverify\s+citations?\b/.test(text)
    ) {
      return "check_sources";
    }
    if (/\B\/clear(?:\s+checks)?\b/.test(text) || /\bclear\s+checks\b/.test(text)) return "clear_checks";
    return null;
  };

  const escapeHtml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");

  const dmp = new (diffMatchPatch as any)();

  const normalizeDiffText = (value: string) => String(value ?? "").replace(/\s+/g, " ").trim();

  const diffByWords = (original: string, proposed: string): Array<[number, string]> => {
    const base = normalizeDiffText(original);
    const next = normalizeDiffText(proposed);
    const aTokens = base ? base.split(/(\s+)/).filter((t) => t.length > 0) : [];
    const bTokens = next ? next.split(/(\s+)/).filter((t) => t.length > 0) : [];
    const totalTokens = aTokens.length + bTokens.length;
    if (!aTokens.length && !bTokens.length) return [[0, ""]];
    if (totalTokens > 65000) {
      const diffs = dmp.diff_main(base, next) as Array<[number, string]>;
      dmp.diff_cleanupSemantic(diffs);
      return diffs;
    }
    const tokenMap = new Map<string, number>();
    const tokenList: string[] = [];
    const encode = (tokens: string[]) => {
      let out = "";
      for (const token of tokens) {
        let id = tokenMap.get(token);
        if (id === undefined) {
          id = tokenList.length;
          tokenList.push(token);
          tokenMap.set(token, id);
        }
        out += String.fromCharCode(id);
      }
      return out;
    };
    const aEncoded = encode(aTokens);
    const bEncoded = encode(bTokens);
    let diffs: Array<[number, string]> = [];
    try {
      diffs = dmp.diff_main(aEncoded, bEncoded) as Array<[number, string]>;
      dmp.diff_cleanupSemantic(diffs);
    } catch {
      return [[0, next]];
    }
    const decoded: Array<[number, string]> = [];
    for (const [op, text] of diffs) {
      if (!text) continue;
      let out = "";
      for (let i = 0; i < text.length; i += 1) {
        const token = tokenList[text.charCodeAt(i)] ?? "";
        out += token;
      }
      decoded.push([op, out]);
    }
    return decoded;
  };

  const renderDiff = (target: HTMLElement, original: string, proposed: string) => {
    target.replaceChildren();
    let diffs: Array<[number, string]> = [];
    try {
      diffs = diffByWords(original, proposed);
    } catch {
      diffs = [[0, normalizeDiffText(proposed)]];
    }
    for (const [op, text] of diffs) {
      if (!text) continue;
      const span = document.createElement("span");
      if (op === 1) {
        span.className = "leditor-agent-sidebar__diffIns";
      } else if (op === -1) {
        span.className = "leditor-agent-sidebar__diffDel";
      } else {
        span.className = "leditor-agent-sidebar__diffEq";
      }
      span.textContent = text;
      target.appendChild(span);
    }
  };

  type HighlightSpan = { start: number; end: number; kind: "cmd" | "target" | "selection" };

  const collectHighlightSpans = (raw: string, selection?: { from: number; to: number }): HighlightSpan[] => {
    const text = String(raw ?? "");
    const spans: HighlightSpan[] = [];

    const addMatches = (re: RegExp, kind: HighlightSpan["kind"]) => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = typeof m.index === "number" ? m.index : -1;
        if (s < 0) continue;
        const e = s + (m[0]?.length ?? 0);
        if (e <= s) continue;
        spans.push({ start: s, end: e, kind });
      }
    };

    // Commands (plain words and slash forms).
    addMatches(/\B\/(?:refine|paraphrase|shorten|proofread|substantiate|abstract|intro(?:duction)?|methods|methodology|findings|results|recs|recommendations|conclusion|conc)\b/gi, "cmd");
    addMatches(/\B\/check(?:\s+sources)?\b/gi, "cmd");
    addMatches(/\B\/clear(?:\s+checks)?\b/gi, "cmd");
    addMatches(/\b(?:refine|paraphrase|shorten|proofread|substantiate|abstract|introduction|methodology|findings|recommendations|conclusion)\b/gi, "cmd");
    addMatches(/\bcheck\s+sources\b/gi, "cmd");

    // Targets: sections + paragraphs (various forms).
    addMatches(/\b(?:section|sec|§)\s*\d+(?:\.\d+)*\b/gi, "target");
    addMatches(/\bp\d{1,5}\b/gi, "target");
    addMatches(/\bparagraphs?\s+\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?(?:\s*,\s*\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)*\b/gi, "target");
    addMatches(
      /^(?:\s*[-–—*•]\s*)?\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?(?:\s*,\s*\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)*\b/gim,
      "target"
    );

    if (selection && selection.to > selection.from) {
      spans.push({ start: selection.from, end: selection.to, kind: "selection" });
    }

    // Sort spans, prefer selection on top (last).
    spans.sort((a, b) => a.start - b.start || a.end - b.end);
    return spans;
  };

  const renderOverlayHtml = (raw: string, spans: HighlightSpan[]) => {
    const text = String(raw ?? "");
    if (!text) return "";
    const merged: HighlightSpan[] = [];
    for (const span of spans) {
      if (span.end <= span.start) continue;
      const prev = merged[merged.length - 1];
      if (prev && span.start <= prev.end && prev.kind === span.kind) {
        prev.end = Math.max(prev.end, span.end);
        continue;
      }
      merged.push({ ...span });
    }

    let out = "";
    let cursor = 0;
    for (const span of merged) {
      const start = Math.max(0, Math.min(text.length, span.start));
      const end = Math.max(0, Math.min(text.length, span.end));
      if (end <= start) continue;
      if (start > cursor) {
        out += escapeHtml(text.slice(cursor, start));
      }
      const cls =
        span.kind === "cmd"
          ? "leditor-agent-sidebar__hl leditor-agent-sidebar__hl--cmd"
          : span.kind === "target"
            ? "leditor-agent-sidebar__hl leditor-agent-sidebar__hl--target"
            : "leditor-agent-sidebar__hl leditor-agent-sidebar__hl--selection";
      out += `<span class="${cls}">${escapeHtml(text.slice(start, end))}</span>`;
      cursor = end;
    }
    if (cursor < text.length) out += escapeHtml(text.slice(cursor));
    // Preserve caret position by rendering newlines and spaces.
    return out.replaceAll("\n", "<br/>").replaceAll("  ", " &nbsp;");
  };

  const stripLeadingParagraphMarker = (value: string, paragraphN: number): string => {
    if (!Number.isFinite(paragraphN)) return String(value ?? "");
    const n = String(Math.max(0, Math.floor(paragraphN)));
    if (!n || n === "0") return String(value ?? "");
    const text = String(value ?? "");
    const re = new RegExp(`^\\s*${n}[.)-]?\\s*(?=[A-Za-z])`);
    if (!re.test(text)) return text;
    return text.replace(re, "");
  };

  const updateInputOverlay = () => {
    const value = String(input.value ?? "");
    const from = Math.min(input.selectionStart ?? 0, input.selectionEnd ?? 0);
    const to = Math.max(input.selectionStart ?? 0, input.selectionEnd ?? 0);
    const spans = collectHighlightSpans(value, { from, to });
    inputOverlay.innerHTML = renderOverlayHtml(value, spans);
    inputOverlay.scrollTop = input.scrollTop;
    updateComposerState();
    autoResizeInput();
  };

  const findInlineSlashCommand = (
    raw: string
  ): { id: AgentActionId; start: number; end: number; token: string } | null => {
    const text = String(raw ?? "");
    const tokens: Array<{ token: string; start: number; end: number }> = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const token = m[0] ?? "";
      const start = m.index ?? 0;
      const end = start + token.length;
      tokens.push({ token, start, end });
    }
    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i]!;
      if (!t.token.startsWith("/")) continue;
      let combined = t.token;
      let combinedEnd = t.end;
      const lower = t.token.toLowerCase();
      const next = tokens[i + 1];
      if (lower === "/check" && next && next.token.toLowerCase() === "sources") {
        combined = `${t.token} ${next.token}`;
        combinedEnd = next.end;
      }
      if (lower === "/clear" && next && next.token.toLowerCase() === "checks") {
        combined = `${t.token} ${next.token}`;
        combinedEnd = next.end;
      }
      const normalized = normalizeSlash(combined);
      const cmd = SLASH_COMMANDS.find((c) => c.aliases.map((a) => normalizeSlash(a)).includes(normalized));
      if (!cmd) continue;
      return { id: cmd.id, start: t.start, end: combinedEnd, token: combined };
    }
    return null;
  };

  const appendTextWithCommandLinks = (container: HTMLElement, text: string) => {
    const raw = String(text ?? "");
    const patterns: Array<{ re: RegExp; id: AgentActionId }> = [
      { re: /\B\/refine\b/gi, id: "refine" },
      { re: /\B\/paraphrase\b/gi, id: "paraphrase" },
      { re: /\B\/shorten\b/gi, id: "shorten" },
      { re: /\B\/proofread\b/gi, id: "proofread" },
      { re: /\B\/substantiate\b/gi, id: "substantiate" },
      { re: /\B\/abstract\b/gi, id: "abstract" },
      { re: /\B\/intro(?:duction)?\b/gi, id: "introduction" },
      { re: /\B\/methods\b/gi, id: "methodology" },
      { re: /\B\/methodology\b/gi, id: "methodology" },
      { re: /\B\/findings\b/gi, id: "findings" },
      { re: /\B\/results\b/gi, id: "findings" },
      { re: /\B\/recs\b/gi, id: "recommendations" },
      { re: /\B\/recommendations\b/gi, id: "recommendations" },
      { re: /\B\/conclusion\b/gi, id: "conclusion" },
      { re: /\B\/conc\b/gi, id: "conclusion" },
      { re: /\B\/check(?:\s+sources)?\b/gi, id: "check_sources" },
      { re: /\B\/clear(?:\s+checks)?\b/gi, id: "clear_checks" },
      { re: /\brefine\b/gi, id: "refine" },
      { re: /\bparaphrase\b/gi, id: "paraphrase" },
      { re: /\bshorten\b/gi, id: "shorten" },
      { re: /\bproofread\b/gi, id: "proofread" },
      { re: /\bsubstantiate\b/gi, id: "substantiate" },
      { re: /\babstract\b/gi, id: "abstract" },
      { re: /\bintroduction\b/gi, id: "introduction" },
      { re: /\bmethodology\b/gi, id: "methodology" },
      { re: /\bfindings\b/gi, id: "findings" },
      { re: /\brecommendations\b/gi, id: "recommendations" },
      { re: /\bconclusion\b/gi, id: "conclusion" },
      { re: /\bcheck sources\b/gi, id: "check_sources" }
    ];

    let cursor = 0;
    while (cursor < raw.length) {
      let next: { start: number; end: number; id: AgentActionId } | null = null;
      for (const p of patterns) {
        p.re.lastIndex = cursor;
        const m = p.re.exec(raw);
        if (!m || typeof m.index !== "number") continue;
        const start = m.index;
        const end = start + m[0].length;
        if (!next || start < next.start) next = { start, end, id: p.id };
      }
      if (!next) {
        container.appendChild(document.createTextNode(raw.slice(cursor)));
        break;
      }
      if (next.start > cursor) {
        container.appendChild(document.createTextNode(raw.slice(cursor, next.start)));
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "leditor-agent-sidebar__cmdLink";
      btn.textContent = raw.slice(next.start, next.end);
      btn.addEventListener("click", () => controller.runAction(next!.id));
      container.appendChild(btn);
      cursor = next.end;
    }
  };

  const getProviderStatus = (providerId: string) => {
    const list = Array.isArray(llmStatus?.providers) ? llmStatus!.providers : [];
    return list.find((p) => String(p.id) === providerId) ?? null;
  };

  const getProviderLabel = (providerId: string): string => {
    const fromCatalog = (Array.isArray(llmCatalog?.providers) ? llmCatalog!.providers : []).find(
      (p) => String(p.id) === providerId
    );
    const label = typeof fromCatalog?.label === "string" ? fromCatalog.label : "";
    return label || (providerId === "openai" ? "OpenAI" : providerId === "deepseek" ? "DeepSeek" : providerId === "mistral" ? "Mistral" : providerId === "gemini" ? "Gemini" : providerId);
  };

  const resolveSelectedProvider = (): { provider: string; envKey?: string; hasKey?: boolean } => {
    const provider = String((currentSettings as any)?.provider ?? "openai");
    const status = getProviderStatus(provider);
    return { provider, envKey: status?.envKey, hasKey: status?.hasApiKey };
  };

  const resolveSelectedModel = (providerId: string): string | undefined => {
    const raw = (currentSettings as any)?.modelByProvider as Record<string, unknown> | undefined;
    const model = typeof raw?.[providerId] === "string" ? String(raw?.[providerId]).trim() : "";
    return model || undefined;
  };

  const renderModelPickerLabel = () => {
    const sel = resolveSelectedProvider();
    modelPickerLabel.textContent = `Provider: ${getProviderLabel(sel.provider)}`;
  };

  const closeModelMenu = () => {
    modelMenu.classList.add("is-hidden");
    modelPickerBtn.setAttribute("aria-expanded", "false");
  };

  const openModelMenu = () => {
    modelMenu.classList.remove("is-hidden");
    modelPickerBtn.setAttribute("aria-expanded", "true");
  };

  const renderModelMenu = () => {
    modelMenu.replaceChildren();
    const providers = Array.isArray(llmCatalog?.providers) ? llmCatalog!.providers : [];
    for (const provider of providers) {
      const providerId = String(provider.id);
      const status = getProviderStatus(providerId);
      const hasKey = status ? Boolean(status.hasApiKey) : true;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "leditor-agent-sidebar__modelOption";
      btn.setAttribute("role", "menuitem");
      btn.disabled = !hasKey;

      const name = document.createElement("div");
      name.className = "leditor-agent-sidebar__modelOptionName";
      name.textContent = getProviderLabel(providerId);
      const desc = document.createElement("div");
      desc.className = "leditor-agent-sidebar__modelOptionDesc";
      desc.textContent = hasKey
        ? "Uses provider defaults."
        : `Missing ${status?.envKey ? String(status.envKey) : "API key"}.`;

      btn.append(name, desc);
      btn.addEventListener("click", () => {
        setAiSettings({ provider: providerId as any } as any);
        closeModelMenu();
      });
      modelMenu.appendChild(btn);
    }
    if (!providers.length) {
      const empty = document.createElement("div");
      empty.className = "leditor-agent-sidebar__modelEmpty";
      empty.textContent = "Providers unavailable in this host.";
      modelMenu.appendChild(empty);
    }
  };

  type ActionMode = "auto" | AgentActionId;
  let actionMode: ActionMode = "auto";

  const actionLabel = (id: ActionMode): string => {
    if (id === "auto") return "Auto";
    if (id === "check_sources") return "Check sources";
    if (id === "clear_checks") return "Clear checks";
    return (
      ((agentActionPrompts as any)?.actions?.[id]?.label as string | undefined) ??
      (id.charAt(0).toUpperCase() + id.slice(1).replaceAll("_", " "))
    );
  };

  const setActionMode = (next: ActionMode) => {
    actionMode = next;
    actionPickerLabel.textContent = actionLabel(next);
  };

  const closeActionMenu = () => {
    actionMenu.classList.add("is-hidden");
    actionPickerBtn.setAttribute("aria-expanded", "false");
  };

  const openActionMenu = () => {
    actionMenu.classList.remove("is-hidden");
    actionPickerBtn.setAttribute("aria-expanded", "true");
  };

  const renderActionMenu = () => {
    actionMenu.replaceChildren();
    const modes: ActionMode[] = [
      "auto",
      "refine",
      "paraphrase",
      "shorten",
      "proofread",
      "substantiate",
      "abstract",
      "introduction",
      "methodology",
      "findings",
      "recommendations",
      "conclusion",
      "check_sources",
      "clear_checks"
    ];
    for (const id of modes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "leditor-agent-sidebar__modelOption";
      btn.setAttribute("role", "menuitem");
      btn.textContent = actionLabel(id);
      if (id === actionMode) {
        btn.style.background = "rgba(245,245,246,0.92)";
      }
      btn.addEventListener("click", () => {
        setActionMode(id);
        closeActionMenu();
        input.focus();
        updateInputOverlay();
      });
      actionMenu.appendChild(btn);
    }
  };

  const closePlusMenu = () => {
    plusMenu.classList.add("is-hidden");
    plusBtn.setAttribute("aria-expanded", "false");
  };

  const openPlusMenu = () => {
    renderPlusMenu();
    plusMenu.classList.remove("is-hidden");
    plusBtn.setAttribute("aria-expanded", "true");
  };

  const actionIdToSlashToken = (id: string): string => {
    const key = String(id ?? "").toLowerCase();
    if (key === "check_sources") return "/check sources";
    if (key === "clear_checks") return "/clear checks";
    return "/" + key;
  };

  const insertIntoComposer = (token: string) => {
    const t = String(token ?? "").trim();
    if (!t) return;
    const before = String(input.value ?? "");
    const start = Number.isFinite(input.selectionStart) ? (input.selectionStart ?? before.length) : before.length;
    const end = Number.isFinite(input.selectionEnd) ? (input.selectionEnd ?? start) : start;
    const left = before.slice(0, start);
    const right = before.slice(end);
    const needsSpace = left.length > 0 && !/\s$/.test(left);
    const insert = (needsSpace ? " " : "") + t + " ";
    const next = left + insert + right;
    input.value = next;
    const caret = (left + insert).length;
    input.selectionStart = caret;
    input.selectionEnd = caret;
    input.focus();
    updateInputOverlay();
  };

  const renderPlusMenu = () => {
    plusMenu.replaceChildren();
    const entries: Array<{ id: Exclude<ActionMode, "auto">; label: string; mode?: "block" }> = [
      { id: "refine", label: "Refine" },
      { id: "refine", label: "Refine Block", mode: "block" },
      { id: "paraphrase", label: "Paraphrase" },
      { id: "paraphrase", label: "Paraphrase Block", mode: "block" },
      { id: "shorten", label: "Shorten" },
      { id: "shorten", label: "Shorten Block", mode: "block" },
      { id: "proofread", label: "Proofread" },
      { id: "proofread", label: "Proofread Block", mode: "block" },
      { id: "substantiate", label: "Substantiate" },
      { id: "abstract", label: "Abstract" },
      { id: "introduction", label: "Introduction" },
      { id: "methodology", label: "Methodology" },
      { id: "findings", label: "Findings" },
      { id: "recommendations", label: "Recommendations" },
      { id: "conclusion", label: "Conclusion" },
      { id: "check_sources", label: "Check sources" },
      { id: "clear_checks", label: "Clear checks" }
    ];
    for (const entry of entries) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "leditor-agent-sidebar__plusItem";
      row.setAttribute("role", "menuitem");
      row.textContent = entry.label;
      row.addEventListener("click", () => {
        closePlusMenu();
        setActionMode(entry.id);
        if (
          entry.mode === "block" &&
          (entry.id === "refine" || entry.id === "paraphrase" || entry.id === "shorten" || entry.id === "proofread")
        ) {
          controller.runAction(entry.id, { mode: "block" });
          return;
        }
        insertIntoComposer(actionIdToSlashToken(entry.id));
      });
      plusMenu.appendChild(row);
    }
  };

  const createMessageEl = (msg: AgentMessage): HTMLElement => {
    const row = document.createElement("div");
    row.className = `leditor-agent-sidebar__msg leditor-agent-sidebar__msg--${msg.role}`;
    if (msg.role === "user") {
      row.classList.add("leditor-agent-sidebar__msg--withTools");
    }
    const meta = document.createElement("div");
    meta.className = "leditor-agent-sidebar__msgMeta";
    meta.textContent = `${msg.role} • ${formatTimestamp(msg.ts)}`;
    const body = document.createElement("div");
    body.className = "leditor-agent-sidebar__msgBody";
    appendTextWithCommandLinks(body, msg.content);
    row.append(meta, body);
    if (msg.role === "user") {
      const tools = document.createElement("div");
      tools.className = "leditor-agent-sidebar__msgTools";
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "leditor-agent-sidebar__msgToolBtn";
      copyBtn.setAttribute("aria-label", "Copy");
      copyBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(String(msg.content ?? ""));
        } catch {
          // ignore
        }
      });
      tools.appendChild(copyBtn);
      row.appendChild(tools);
    }
    return row;
  };

  let renderedCount = 0;
  const renderMessages = (forceFull: boolean = false) => {
    if (forceFull) {
      messagesEl.replaceChildren();
      renderedCount = 0;
    }
    while (renderedCount < messages.length) {
      messagesEl.appendChild(createMessageEl(messages[renderedCount]!));
      renderedCount += 1;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const setStatus = (text: string) => {
    statusLine.textContent = String(text || "").trim() || "Ready.";
  };

  const beginSourcesLoading = () => {
    if (sourcesLoading) return;
    sourcesLoading = true;
    setViewMode("sources");
    setStatus("Loading sources…");
    renderBoxes();
  };

  const endSourcesLoading = () => {
    sourcesLoading = false;
  };

  const truncate = (value: string, maxLen: number) => {
    const s = String(value ?? "").replace(/\s+/g, " ").trim();
    if (s.length <= maxLen) return s;
    return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
  };

  const focusParagraphNumber = (n: number) => {
    try {
      const target = String(Math.max(1, Math.floor(n))).trim();
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          "span.leditor-paragraph-grid__n[data-kind=\"paragraph\"]"
        )
      );
      const el = candidates.find((c) => String(c.textContent ?? "").trim() === target) ?? null;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      el.classList.add("leditor-paragraph-grid__n--flash");
      window.setTimeout(() => {
        try {
          el.classList.remove("leditor-paragraph-grid__n--flash");
        } catch {
          // ignore
        }
      }, 650);
      editorHandle.focus();
    } catch {
      // ignore
    }
  };

  const setInflight = (value: boolean) => {
    inflight = value;
    input.disabled = inflight;
    sidebar.classList.toggle("is-busy", inflight);
    updateComposerState();
  };

  const setViewMode = (next: SidebarViewId) => {
    if (viewMode === next) return;
    // Source checks highlights are shown only while the Sources tab is active.
    if (viewMode === "sources" && next !== "sources") {
      try {
        setSourceChecksVisible(false);
        editorHandle.execCommand("ClearSourceChecks");
      } catch {
        // ignore
      }
    }
    viewMode = next;
    if (next === "sources") {
      setActionMode("check_sources");
    } else if (next === "chat" || next === "dictionary" || next === "sections") {
      setActionMode("auto");
    } else {
      setActionMode(next);
    }
    pending = next === "chat" || next === "dictionary" ? null : ((pendingByView as any)[next] ?? null);
    if (next === "sources") {
      try {
        setSourceChecksVisible(true);
        applySourceChecksThreadToEditor(editorHandle);
      } catch {
        // ignore
      }
    }
    // tab button classes updated in renderViewTabs()
    renderViewTabs();
    renderBoxes();
    if (next === "dictionary") {
      if (!dictionarySkipNextAutoLookup) {
        runDictionaryLookup();
      }
      dictionarySkipNextAutoLookup = false;
    }
  };

  const renderViewTabs = () => {
    viewTabs.replaceChildren();
    const tabs: Array<{ id: SidebarViewId; label: string }> = [
      { id: "chat", label: "Chat" },
      { id: "dictionary", label: "Dictionary" },
      { id: "sections", label: "Sections" },
      { id: "refine", label: "Refine" },
      { id: "paraphrase", label: "Paraphrase" },
      { id: "shorten", label: "Shorten" },
      { id: "proofread", label: "Proofread" },
      { id: "substantiate", label: "Substantiate" },
      { id: "sources", label: "Sources" }
    ];
    for (const t of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "leditor-agent-sidebar__viewTab";
      btn.textContent = t.label;
      btn.setAttribute("role", "tab");
      const active = t.id === viewMode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setViewMode(t.id);
      });
      viewTabs.appendChild(btn);
    }
  };

  // Render tabs immediately so they are visible as soon as the sidebar opens
  // (initial render previously relied on setViewMode, which might not run before first paint).
  renderViewTabs();

  const selectionHasAnchors = (from: number, to: number): boolean => {
    try {
      const editor = editorHandle.getEditor();
      const doc = editor.state.doc;
      const anchorMark = editor.schema.marks.anchor ?? null;
      const linkMark = editor.schema.marks.link ?? null;
      let found = false;
      doc.nodesBetween(from, to, (node: any) => {
        if (!node) return true;
        if (String(node.type?.name ?? "") === "citation") {
          found = true;
          return false;
        }
        if (!node.isText) return true;
        const marks = Array.isArray(node.marks) ? node.marks : [];
        for (const m of marks) {
          if (anchorMark && m.type === anchorMark) {
            found = true;
            return false;
          }
          if (linkMark && m.type === linkMark) {
            const attrs = m.attrs ?? {};
            const href = typeof attrs?.href === "string" ? attrs.href : "";
            const looksLikeCitation = Boolean(
              attrs?.dataKey ||
                attrs?.itemKey ||
                attrs?.dataItemKey ||
                attrs?.dataDqid ||
                attrs?.dataQuoteId ||
                attrs?.dataQuoteText
            );
            if (looksLikeCitation) {
              found = true;
              return false;
            }
            if (href && /^(dq|cite|citegrp):\/\//i.test(href)) {
              found = true;
              return false;
            }
          }
        }
        return true;
      });
      return found;
    } catch {
      return false;
    }
  };

  const getSentenceForSelection = (from: number): { sentence: string; blockText: string } => {
    const editor = editorHandle.getEditor();
    const doc = editor.state.doc;
    const pos = doc.resolve(from);
    let depth = pos.depth;
    while (depth > 0 && !pos.node(depth).isTextblock) depth -= 1;
    const blockNode = pos.node(depth);
    const blockPos = pos.before(depth);
    const blockFrom = blockPos + 1;
    const blockTo = blockFrom + blockNode.content.size;
    const blockText = doc.textBetween(blockFrom, blockTo, "\n").replace(/\s+/g, " ").trim();
    if (!blockText) return { sentence: "", blockText: "" };

    const leftText = doc.textBetween(blockFrom, from, "\n").replace(/\s+/g, " ");
    const offset = Math.max(0, Math.min(blockText.length, leftText.length));
    const clamp = (v: number) => Math.max(0, Math.min(blockText.length, v));

    const left = blockText.slice(0, offset);
    const right = blockText.slice(offset);
    const boundaryRe = /[.!?;]\s+(?=[“"'\(\[]?[A-Z0-9])/g;
    let start = 0;
    for (const m of left.matchAll(boundaryRe)) {
      const idx = typeof m.index === "number" ? m.index : -1;
      if (idx < 0) continue;
      const prev = left.slice(Math.max(0, idx - 3), idx + 1).toLowerCase();
      const next = left.slice(idx + 1).trimStart();
      if ((prev.endsWith("p.") || prev.endsWith("pp.")) && /^\d/.test(next)) continue;
      start = idx + m[0].length;
    }
    start = clamp(start);

    const nextCandidates = Array.from(right.matchAll(/[.!?;]/g))
      .map((m) => (typeof m.index === "number" ? m.index : -1))
      .filter((n) => n >= 0)
      .map((n) => offset + n + 1);
    const end = clamp(nextCandidates.length ? Math.min(...nextCandidates) : blockText.length);

    return { sentence: blockText.slice(start, end).replace(/\s+/g, " ").trim(), blockText };
  };

  const clampDictionaryContext = (text: string) => {
    if (!text) return text;
    if (text.length <= DICT_CONTEXT_LIMIT) return text;
    return text.slice(0, DICT_CONTEXT_LIMIT).trim();
  };

  const DICT_STOPWORDS = new Set([
    "a","an","the","and","or","but","if","then","else","when","while","for","to","from","by","with","of","on","in","at",
    "is","are","was","were","be","been","being","as","that","this","these","those","it","its","their","there","here","we",
    "you","your","our","they","them","he","she","his","her","i","me","my","mine","ours","yours","theirs","not","no","yes",
    "can","could","should","would","may","might","must","will","shall","do","does","did","done","has","have","had","into",
    "over","under","about","between","among","within","without","after","before","during","because","so","such","than","also",
    "each","every","some","any","all","most","more","less","many","much","few","several","per","via","etc","etc.","vs","vs."
  ]);

  type TokenInfo = { raw: string; lower: string; isStop: boolean; score: number };
  const tokenizeContext = (text: string): TokenInfo[] => {
    const tokens = String(text || "").match(/\b[A-Za-z][A-Za-z'-]{2,}\b/g) ?? [];
    return tokens.map((raw) => {
      const lower = raw.toLowerCase();
      const isStop = DICT_STOPWORDS.has(lower);
      let score = raw.length;
      if (raw.includes("-")) score += 3;
      if (/^[A-Z]/.test(raw)) score += 1;
      if (/(tion|ment|ance|ence|ism|ity|ology|graphy|phoria|phile|phobic)$/i.test(raw)) score += 2;
      if (raw.length >= 9) score += 2;
      return { raw, lower, isStop, score };
    });
  };

  const extractKeywordCandidates = (context: string, selection: string): string[] => {
    const tokens = tokenizeContext(context);
    const sel = selection.trim().toLowerCase();
    const freq = new Map<string, { word: string; count: number; score: number }>();
    for (const token of tokens) {
      if (token.isStop) continue;
      if (sel && token.lower === sel) continue;
      if (!/^[a-z][a-z'-]{2,}$/i.test(token.raw)) continue;
      const entry = freq.get(token.lower);
      if (entry) {
        entry.count += 1;
      } else {
        freq.set(token.lower, { word: token.raw, count: 1, score: token.score });
      }
    }
    return Array.from(freq.values())
      .sort((a, b) => b.score - a.score || b.count - a.count || a.word.localeCompare(b.word))
      .map((e) => e.word);
  };

  const extractConceptPhrases = (context: string, selection: string): string[] => {
    const tokens = tokenizeContext(context);
    const sel = selection.trim().toLowerCase();
    const phrases: Array<{ text: string; score: number }> = [];
    const maxN = 3;
    for (let i = 0; i < tokens.length; i += 1) {
      for (let n = 2; n <= maxN; n += 1) {
        const slice = tokens.slice(i, i + n);
        if (slice.length < n) continue;
        const first = slice[0]!;
        const last = slice[slice.length - 1]!;
        if (first.isStop || last.isStop) continue;
        const phrase = slice.map((t) => t.raw).join(" ");
        const lower = phrase.toLowerCase();
        if (sel && lower.includes(sel)) continue;
        const score = slice.reduce((acc, t) => acc + t.score, 0) + (n === 3 ? 3 : 0);
        if (score < 14) continue;
        phrases.push({ text: phrase, score });
      }
    }
    phrases.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const p of phrases) {
      const key = p.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p.text);
      if (unique.length >= 3) break;
    }
    return unique;
  };

  const buildDictionaryFollowUps = (selection: DictionarySelection, mode: DictionaryMode): string[] => {
    const contextRaw = clampDictionaryContext(selection.blockText || selection.sentence || "");
    const context = String(contextRaw || "").replace(/\s+/g, " ").trim();
    const term = selection.text || "";
    if (!context || !term) return [];
    if (mode === "definition") {
      let words = extractKeywordCandidates(context, term).filter((w) => w.length >= 7).slice(0, 3);
      if (!words.length) {
        words = extractKeywordCandidates(context, term).filter((w) => w.length >= 4).slice(0, 3);
      }
      if (!words.length && term) words = [term];
      return words.map((w) => `Define "${w}".`);
    }
    const phrases = extractConceptPhrases(context, term);
    const fallback = extractKeywordCandidates(context, term)
      .filter((w) => w.length >= 6)
      .slice(0, 3);
    const mergedRaw = [...phrases, ...fallback];
    const seen = new Set<string>();
    let merged: string[] = [];
    for (const item of mergedRaw) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= 3) break;
    }
    if (!merged.length && term) merged = [term];
    return merged.map((w) => `Explain "${w}" in simple terms.`);
  };

  const buildDictionaryContextDetails = (selection: DictionarySelection): HTMLElement | null => {
    const raw = clampDictionaryContext(selection.blockText || selection.sentence || "");
    const context = String(raw || "").replace(/\s+/g, " ").trim();
    if (!context) return null;
    const details = document.createElement("details");
    details.className = "leditor-agent-sidebar__dictContext";
    const summary = document.createElement("summary");
    summary.className = "leditor-agent-sidebar__dictContextSummary";
    summary.textContent = "Context …more";
    const body = document.createElement("div");
    body.className = "leditor-agent-sidebar__dictContextBody";
    body.textContent = context;
    details.append(summary, body);
    return details;
  };

  const normalizeSuggestions = (suggestions: string[], selectedText: string) => {
    const seen = new Set<string>();
    const output: string[] = [];
    const target = selectedText.trim().toLowerCase();
    for (const raw of suggestions) {
      const next = String(raw || "")
        .replace(/\s+/g, " ")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .join(" ");
      if (!next) continue;
      if (next.toLowerCase() === target) continue;
      const key = next.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(next);
      if (output.length >= 5) break;
    }
    return output;
  };

  const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}...` : value);
  const logDictionary = (phase: "request" | "result" | "error", detail: Record<string, unknown>) => {
    try {
      window.codexLog?.write(`[dictionary:${phase}] ${JSON.stringify(detail)}`);
    } catch {
      // ignore
    }
    try {
      // eslint-disable-next-line no-console
      console.info("[dictionary]", phase, detail);
    } catch {
      // ignore
    }
  };

  const getDictionarySelection = (): DictionarySelection | null => {
    try {
      const editor = editorHandle.getEditor();
      const sel = editor.state.selection;
      const from = Math.min(sel.from, sel.to);
      const to = Math.max(sel.from, sel.to);
      if (from === to) return null;
      if (selectionHasAnchors(from, to)) return null;
      const text = editor.state.doc.textBetween(from, to, "\n").trim();
      if (!text) return null;
      const { sentence, blockText } = getSentenceForSelection(from);
      return { from, to, text, sentence, blockText };
    } catch {
      return null;
    }
  };

  const highlightDictionarySelection = (selection?: DictionarySelection | null) => {
    const next = selection ?? dictionarySelection;
    if (!next) return;
    try {
      const editor = editorHandle.getEditor();
      editor.commands.setTextSelection?.({ from: next.from, to: next.to });
      editor.commands.setLexiconHighlight?.({ from: next.from, to: next.to });
      editor.commands.focus();
    } catch {
      // ignore
    }
  };

  const getActiveDictionarySearch = (): DictionarySearch | null =>
    dictionaryActiveId ? dictionaryHistory.find((s) => s.id === dictionaryActiveId) ?? null : null;

  const setActiveDictionarySearch = (search: DictionarySearch) => {
    dictionaryActiveId = search.id;
    dictionarySelection = search.selection;
    dictionaryNotice = null;
  };

  const updateDictionaryEntry = (searchId: string, mode: DictionaryMode, entry: DictionaryEntry) => {
    const search = dictionaryHistory.find((s) => s.id === searchId);
    if (!search) return;
    search.entries = { ...search.entries, [mode]: entry };
    if (dictionaryActiveId === searchId && viewMode === "dictionary") {
      renderBoxes();
    }
  };

  const ensureDictionarySearch = (selection: DictionarySelection): DictionarySearch => {
    const existing = dictionaryHistory.find(
      (s) =>
        s.selection.from === selection.from &&
        s.selection.to === selection.to &&
        s.selection.text === selection.text
    );
    if (existing) {
      dictionaryHistory = [existing, ...dictionaryHistory.filter((s) => s.id !== existing.id)];
      setActiveDictionarySearch(existing);
      return existing;
    }
    const search: DictionarySearch = {
      id: `dict-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      selection,
      entries: {
        definition: { status: "idle" },
        explain: { status: "idle" },
        synonyms: { status: "idle" },
        antonyms: { status: "idle" }
      }
    };
    dictionaryHistory = [search, ...dictionaryHistory].slice(0, 25);
    setActiveDictionarySearch(search);
    return search;
  };

  const runDictionaryLookup = (modes: DictionaryMode[] = dictionaryModes) => {
    const selection = getDictionarySelection();
    if (!selection) {
      dictionarySelection = null;
      dictionaryNotice = "Select a word or phrase in the document to look it up.";
      logDictionary("error", { reason: "no-selection" });
      if (viewMode === "dictionary") renderBoxes();
      return;
    }

      const search = ensureDictionarySearch(selection);
      const settings = getAiSettings();
      const model = resolveSelectedModel(settings.provider);

      for (const mode of modes) {
        const current = search.entries[mode];
        updateDictionaryEntry(search.id, mode, {
          status: "loading",
          selected: current?.selected
      });
      const context = clampDictionaryContext(selection.blockText || selection.sentence);
      logDictionary("request", {
        mode,
        provider: settings.provider,
        selection: clip(selection.text, 160),
        contextLen: context.length,
        requestId: search.id
      });
      const payload = {
        provider: settings.provider,
        ...(model ? { model } : {}),
        mode,
        text: selection.text,
        sentence: context
      };
      const requestId = `lex-dict-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${mode}`;
      const host: any = (window as any).leditorHost;
      if (!host || typeof host.lexicon !== "function") {
        logDictionary("error", { mode, error: "host.lexicon unavailable" });
        updateDictionaryEntry(search.id, mode, { status: "error", error: "Dictionary unavailable in this host." });
        continue;
      }
      void host
        .lexicon({ requestId, payload })
        .then((result: any) => {
          if (!result?.success) {
            logDictionary("error", { mode, error: String(result?.error || "Lookup failed") });
            updateDictionaryEntry(search.id, mode, { status: "error", error: String(result?.error || "Lookup failed") });
            return;
          }
          const raw = typeof result?.raw === "string" ? String(result.raw).trim() : "";
          if (mode === "definition") {
            const text = typeof result?.definition === "string" ? String(result.definition).trim() : "";
            logDictionary("result", { mode, text: clip(text, 200) });
            updateDictionaryEntry(search.id, mode, { status: "success", text, raw });
            return;
          }
          if (mode === "explain") {
            const text = typeof result?.explanation === "string" ? String(result.explanation).trim() : "";
            logDictionary("result", { mode, text: clip(text, 200) });
            updateDictionaryEntry(search.id, mode, { status: "success", text, raw });
            return;
          }
          const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
          const rawOpts = suggestions
            .map((s: any) => (typeof s === "string" ? s : typeof s?.text === "string" ? s.text : ""))
            .map((s: string) => s.trim())
            .filter(Boolean);
          const opts = normalizeSuggestions(rawOpts, selection.text);
          logDictionary("result", { mode, suggestions: opts });
          updateDictionaryEntry(search.id, mode, { status: "success", suggestions: opts, raw });
        })
        .catch((error: any) => {
          logDictionary("error", { mode, error: String(error?.message || "Lookup failed") });
          updateDictionaryEntry(search.id, mode, { status: "error", error: String(error?.message || "Lookup failed") });
        });
    }
  };

  const renderBoxes = () => {
    const showBoxes = viewMode !== "chat";
    messagesEl.classList.toggle("is-hidden", showBoxes);
    messagesEl.setAttribute("aria-hidden", showBoxes ? "true" : "false");
    boxesEl.classList.toggle("is-hidden", !showBoxes);
    boxesEl.setAttribute("aria-hidden", showBoxes ? "false" : "true");
    if (!showBoxes) return;

    boxesEl.replaceChildren();

    if (viewMode === "dictionary") {
      const wrapper = document.createElement("div");
      wrapper.className = "leditor-agent-sidebar__dict";

      const activeSearch = getActiveDictionarySearch();
      const activeEntry = activeSearch?.entries?.[dictionaryActiveMode] ?? { status: "idle" };
      const selectionLabel = activeSearch?.selection.text || dictionarySelection?.text || "Select text in the document";

      const header = document.createElement("div");
      header.className = "leditor-agent-sidebar__dictHeader";
      const headerLeft = document.createElement("div");
      headerLeft.className = "leditor-agent-sidebar__dictHeaderLeft";
      const title = document.createElement("div");
      title.className = "leditor-agent-sidebar__dictTitle";
      title.textContent = "Dictionary";
      const selectionBadge = document.createElement("div");
      selectionBadge.className = "leditor-agent-sidebar__dictSelection";
      selectionBadge.textContent = selectionLabel;
      headerLeft.append(title, selectionBadge);

      const headerActions = document.createElement("div");
      headerActions.className = "leditor-agent-sidebar__dictHeaderActions";
      const lookupBtn = document.createElement("button");
      lookupBtn.type = "button";
      lookupBtn.className = "leditor-agent-sidebar__dictBtn";
      lookupBtn.textContent = "Lookup";
      lookupBtn.disabled = !dictionarySelection && !getDictionarySelection();
      lookupBtn.addEventListener("click", () => {
        runDictionaryLookup([dictionaryActiveMode]);
      });
      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.className = "leditor-agent-sidebar__dictBtn";
      refreshBtn.textContent = "Lookup all";
      refreshBtn.disabled = !dictionarySelection && !getDictionarySelection();
      refreshBtn.addEventListener("click", () => {
        runDictionaryLookup();
      });
      headerActions.append(lookupBtn, refreshBtn);
      header.append(headerLeft, headerActions);

      const historyRow = document.createElement("div");
      historyRow.className = "leditor-agent-sidebar__dictHistory";
      if (dictionaryHistory.length) {
        const historyLabel = document.createElement("div");
        historyLabel.className = "leditor-agent-sidebar__dictHistoryLabel";
        historyLabel.textContent = "History";
        const historyList = document.createElement("div");
        historyList.className = "leditor-agent-sidebar__dictHistoryList";
        for (const search of dictionaryHistory) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "leditor-agent-sidebar__dictHistoryItem";
          btn.textContent = search.selection.text;
          const active = search.id === dictionaryActiveId;
          btn.classList.toggle("is-active", active);
          btn.addEventListener("click", () => {
            setActiveDictionarySearch(search);
            highlightDictionarySelection(search.selection);
            renderBoxes();
          });
          historyList.appendChild(btn);
        }
        historyRow.append(historyLabel, historyList);
      }

      const tabs = document.createElement("div");
      tabs.className = "leditor-agent-sidebar__dictTabs";
      const tabLabel = (mode: DictionaryMode) =>
        mode === "definition" ? "Define" : mode === "explain" ? "Explain" : mode === "synonyms" ? "Synonyms" : "Antonyms";
      for (const mode of dictionaryModes) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "leditor-agent-sidebar__dictTab";
        tab.textContent = tabLabel(mode);
        const active = mode === dictionaryActiveMode;
        tab.classList.toggle("is-active", active);
        tab.addEventListener("click", () => {
          dictionaryActiveMode = mode;
          renderBoxes();
          const entry = activeSearch?.entries?.[mode];
          if (entry?.status === "idle") runDictionaryLookup([mode]);
        });
        tabs.appendChild(tab);
      }

      if (dictionaryNotice) {
        const notice = document.createElement("div");
        notice.className = "leditor-agent-sidebar__dictNotice";
        notice.textContent = dictionaryNotice;
        wrapper.append(header, historyRow, tabs, notice);
        boxesEl.appendChild(wrapper);
        return;
      }

      const content = document.createElement("div");
      content.className = "leditor-agent-sidebar__dictPane";

      if (dictionaryActiveMode === "definition" || dictionaryActiveMode === "explain") {
        const entry = document.createElement("div");
        entry.className = "leditor-agent-sidebar__dictEntry";
        const entryHead = document.createElement("div");
        entryHead.className = "leditor-agent-sidebar__dictEntryHead";
        const entryWord = document.createElement("div");
        entryWord.className = "leditor-agent-sidebar__dictEntryWord";
        entryWord.textContent = activeSearch?.selection.text || dictionarySelection?.text || "Selection";
        const entrySense = document.createElement("div");
        entrySense.className = "leditor-agent-sidebar__dictEntrySense";
        entrySense.textContent = dictionaryActiveMode === "definition" ? "Definition" : "Explanation";
        entryHead.append(entryWord, entrySense);

        const body = document.createElement("div");
        body.className = "leditor-agent-sidebar__dictEntryText";
        if (activeEntry.status === "loading") {
          body.textContent = "Loading...";
          content.classList.add("is-loading");
        } else if (activeEntry.status === "error") {
          body.textContent = activeEntry.error || "Lookup failed.";
          content.classList.add("is-error");
        } else if (activeEntry.status === "success") {
          body.textContent = activeEntry.text || "No result.";
        } else {
          body.textContent = "Run a lookup to see results.";
        }
        const contextDetails = activeSearch?.selection
          ? buildDictionaryContextDetails(activeSearch.selection)
          : dictionarySelection
            ? buildDictionaryContextDetails(dictionarySelection)
            : null;
        entry.append(entryHead, body);
        if (contextDetails) {
          entry.appendChild(contextDetails);
        }
        content.appendChild(entry);
        if (activeEntry.raw && (activeEntry.status === "success" || activeEntry.status === "error")) {
          const debug = document.createElement("div");
          debug.className = "leditor-agent-sidebar__dictDebug";
          debug.textContent = `Debug response:\n${activeEntry.raw}`;
          content.appendChild(debug);
        }
        const followUps =
          activeEntry.status === "success" &&
          (dictionaryActiveMode === "definition" || dictionaryActiveMode === "explain") &&
          activeSearch
            ? buildDictionaryFollowUps(activeSearch.selection, dictionaryActiveMode)
            : [];
        if (followUps.length) {
          const followUpWrap = document.createElement("div");
          followUpWrap.className = "leditor-agent-sidebar__dictFollowUp";
          const followUpLabel = document.createElement("div");
          followUpLabel.className = "leditor-agent-sidebar__dictFollowUpLabel";
          followUpLabel.textContent = "Follow-up questions";
          const followUpList = document.createElement("div");
          followUpList.className = "leditor-agent-sidebar__dictFollowUpList";
          for (const q of followUps) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "leditor-agent-sidebar__dictFollowUpBtn";
            btn.textContent = q;
            btn.addEventListener("click", () => {
              setViewMode("chat");
              input.value = q;
              input.focus();
            });
            followUpList.appendChild(btn);
          }
          followUpWrap.append(followUpLabel, followUpList);
          content.appendChild(followUpWrap);
        }
        content.addEventListener("pointerdown", (e) => {
          const target = e.target as HTMLElement | null;
          if (target && target.closest("button")) return;
          highlightDictionarySelection();
        });
      } else {
        const list = document.createElement("div");
        list.className = "leditor-agent-sidebar__dictOptionList";
        let debug: HTMLDivElement | null = null;
        if (activeEntry.status === "loading") {
          const loading = document.createElement("div");
          loading.className = "leditor-agent-sidebar__dictEmpty";
          loading.textContent = "Loading...";
          list.appendChild(loading);
        } else if (activeEntry.status === "error") {
          const error = document.createElement("div");
          error.className = "leditor-agent-sidebar__dictEmpty";
          error.textContent = activeEntry.error || "Lookup failed.";
          list.appendChild(error);
        } else if (activeEntry.status === "success") {
          const options = Array.isArray(activeEntry.suggestions) ? activeEntry.suggestions : [];
          if (!options.length) {
            const empty = document.createElement("div");
            empty.className = "leditor-agent-sidebar__dictEmpty";
            empty.textContent = "No results.";
            list.appendChild(empty);
            if (activeEntry.raw) {
              debug = document.createElement("div");
              debug.className = "leditor-agent-sidebar__dictDebug";
              debug.textContent = `Debug response:\n${activeEntry.raw}`;
            }
          } else {
            for (const opt of options) {
              const row = document.createElement("button");
              row.type = "button";
              row.className = "leditor-agent-sidebar__dictOption";
              row.textContent = opt;
              const isSelected = activeEntry.selected === opt;
              row.classList.toggle("is-selected", isSelected);
              row.addEventListener("click", () => {
                if (!activeSearch) return;
                updateDictionaryEntry(activeSearch.id, dictionaryActiveMode, {
                  ...activeEntry,
                  status: "success",
                  selected: opt
                });
                highlightDictionarySelection();
              });
              list.appendChild(row);
            }
          }
        } else {
          const idle = document.createElement("div");
          idle.className = "leditor-agent-sidebar__dictEmpty";
          idle.textContent = "Run a lookup to see results.";
          list.appendChild(idle);
        }

        const acceptRow = document.createElement("div");
        acceptRow.className = "leditor-agent-sidebar__dictAcceptRow";
        const acceptBtn = document.createElement("button");
        acceptBtn.type = "button";
        acceptBtn.className = "leditor-agent-sidebar__dictAcceptBtn";
        acceptBtn.textContent = "Accept replacement";
        acceptBtn.disabled = !activeEntry.selected || activeEntry.status !== "success";
        acceptBtn.addEventListener("click", () => {
          if (!activeEntry.selected || !activeSearch) return;
          const editor = editorHandle.getEditor();
          const replacement = activeEntry.selected;
          const sel = activeSearch.selection;
          try {
            editor.view.dispatch(editor.state.tr.insertText(replacement, sel.from, sel.to));
            const nextSelection = {
              ...sel,
              text: replacement,
              to: sel.from + replacement.length
            };
            activeSearch.selection = nextSelection;
            dictionarySelection = nextSelection;
            try {
              editor.commands.setTextSelection?.({ from: nextSelection.from, to: nextSelection.to });
              editor.commands.clearLexiconHighlight?.();
              editor.commands.focus();
            } catch {
              // ignore
            }
            renderBoxes();
          } catch {
            // ignore
          }
        });
        acceptRow.appendChild(acceptBtn);
        if (debug) {
          content.append(list, debug, acceptRow);
        } else {
          content.append(list, acceptRow);
        }
      }

      wrapper.append(header, historyRow, tabs, content);
      boxesEl.appendChild(wrapper);
      return;
    }

    if (viewMode === "sections") {
      const wrapper = document.createElement("div");
      wrapper.className = "leditor-agent-sidebar__sections";

      const header = document.createElement("div");
      header.className = "leditor-agent-sidebar__sectionsHeader";
      const title = document.createElement("div");
      title.className = "leditor-agent-sidebar__sectionsTitle";
      title.textContent = "Sections";
      const subtitle = document.createElement("div");
      subtitle.className = "leditor-agent-sidebar__sectionsSubtitle";
      subtitle.textContent =
        "Create or refine core sections using the entire document. Each button writes or updates the section in place.";
      header.append(title, subtitle);

      const bulk = document.createElement("div");
      bulk.className = "leditor-agent-sidebar__sectionsBulk";
      const bulkBtn = document.createElement("button");
      bulkBtn.type = "button";
      bulkBtn.className = "leditor-agent-sidebar__sectionsBulkBtn";
      bulkBtn.textContent = "Draft all sections";
      bulkBtn.addEventListener("click", () => {
        void runSectionBatch();
      });
      bulk.appendChild(bulkBtn);

      const grid = document.createElement("div");
      grid.className = "leditor-agent-sidebar__sectionsGrid";
      const sections: Array<{ id: AgentActionId; label: string; helper: string }> = [
        { id: "abstract", label: "Abstract", helper: "Concise summary of purpose, method, and key findings." },
        { id: "introduction", label: "Introduction", helper: "Context, problem framing, and roadmap." },
        { id: "methodology", label: "Methodology", helper: "Research design, data, and analytic approach." },
        { id: "findings", label: "Findings", helper: "Core results or claims drawn from the document." },
        { id: "recommendations", label: "Recommendations", helper: "Actionable implications or next steps." },
        { id: "conclusion", label: "Conclusion", helper: "Synthesize contributions and close the argument." }
      ];
      for (const s of sections) {
        const card = document.createElement("div");
        card.className = "leditor-agent-sidebar__sectionCard";
        const label = document.createElement("div");
        label.className = "leditor-agent-sidebar__sectionLabel";
        label.textContent = s.label;
        const helper = document.createElement("div");
        helper.className = "leditor-agent-sidebar__sectionHelper";
        helper.textContent = s.helper;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "leditor-agent-sidebar__sectionBtn";
        btn.textContent = "Draft section";
        btn.addEventListener("click", () => {
          controller.runAction(s.id);
        });
        card.append(label, helper, btn);
        grid.appendChild(card);
      }

      wrapper.append(header, bulk, grid);
      boxesEl.appendChild(wrapper);
    }

    if (viewMode === "sources") {
      const threadItems = getSourceChecksThread().items ?? [];

      const normalizeText = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

      const focusAnchor = (anchor: any) => {
        try {
          const editor = editorHandle.getEditor();
          const href = String(anchor?.href ?? "").trim();
          const text = normalizeText(anchor?.text);
          if (!href) return;
          const candidates = Array.from(document.querySelectorAll<HTMLElement>("a.leditor-citation-anchor")).filter(
            (el) => String(el.getAttribute("href") ?? "").trim() === href
          );
          if (!candidates.length) return;
          const exact = text ? candidates.find((el) => normalizeText(el.textContent) === text) : null;
          const el = exact ?? candidates[0];
          if (!el) return;
          el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          try {
            const view: any = (editor as any)?.view;
            if (view?.posAtDOM) {
              const pos = view.posAtDOM(el, 0);
              if (typeof pos === "number" && pos >= 0) {
                editor.commands.setTextSelection?.({ from: pos, to: pos });
              }
            }
          } catch {
            // ignore
          }
          el.classList.add("leditor-citation-anchor--flash");
          window.setTimeout(() => {
            try {
              el.classList.remove("leditor-citation-anchor--flash");
            } catch {
              // ignore
            }
          }, 650);
          editor.commands.focus();
        } catch {
          // ignore
        }
      };

      const bindIconAction = (el: HTMLElement, fn: () => void) => {
        let fired = false;
        el.addEventListener("pointerdown", (e) => {
          fired = true;
          try {
            e.preventDefault();
            e.stopPropagation();
            (e as any).stopImmediatePropagation?.();
          } catch {
            // ignore
          }
          fn();
        });
        el.addEventListener("click", (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
            (e as any).stopImmediatePropagation?.();
          } catch {
            // ignore
          }
          if (fired) {
            fired = false;
            return;
          }
          fn();
        });
      };

      const iconSvg = (name: "collapse" | "expand" | "close"): string => {
        if (name === "close") {
          return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z\"/></svg>";
        }
        if (name === "collapse") {
          return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M7.4 14.6a1 1 0 0 1 0-1.4l4.0-4.0a1 1 0 0 1 1.4 0l4.0 4.0a1 1 0 1 1-1.4 1.4L12 11.4l-3.2 3.2a1 1 0 0 1-1.4 0Z\"/></svg>";
        }
        return "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M16.6 9.4a1 1 0 0 1 0 1.4l-4.0 4.0a1 1 0 0 1-1.4 0l-4.0-4.0a1 1 0 1 1 1.4-1.4L12 12.6l3.2-3.2a1 1 0 0 1 1.4 0Z\"/></svg>";
      };

      const header = document.createElement("div");
      header.className = "leditor-source-check-rail__header";
      const titleEl = document.createElement("div");
      titleEl.className = "leditor-source-check-rail__title";
      titleEl.textContent = "Source checks";
      const headerBtns = document.createElement("div");
      headerBtns.className = "leditor-source-check-rail__headerBtns";

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "leditor-source-check-rail__btn";
      clearBtn.textContent = "Clear";
      bindIconAction(clearBtn, () => {
        try {
          editorHandle.execCommand("ai.sourceChecks.clear");
        } catch {
          // ignore
        }
        renderBoxes();
      });

      const applyAllBtn = document.createElement("button");
      applyAllBtn.type = "button";
      applyAllBtn.className = "leditor-source-check-rail__btn";
      applyAllBtn.textContent = "Apply fixes";
      bindIconAction(applyAllBtn, () => {
        try {
          queueAllSourceRewriteDrafts(threadItems as any[]);
          setStatus("Drafts queued • Review inline in the document.");
        } catch {
          // ignore
        }
      });

      const dismissAllBtn = document.createElement("button");
      dismissAllBtn.type = "button";
      dismissAllBtn.className = "leditor-source-check-rail__btn";
      dismissAllBtn.textContent = "Dismiss fixes";
      bindIconAction(dismissAllBtn, () => {
        clearSourceRewriteDrafts();
        setStatus("Cleared queued rewrites.");
      });

      headerBtns.append(clearBtn, applyAllBtn, dismissAllBtn);
      header.append(titleEl, headerBtns);
      boxesEl.appendChild(header);

      if (threadItems.length === 0) {
        const empty = document.createElement("div");
        empty.className = "leditor-agent-sidebar__boxEmpty";
        empty.textContent = sourcesLoading ? "Loading sources…" : "No source checks yet.";
        boxesEl.appendChild(empty);
        return;
      }

      const listEl = document.createElement("div");
      listEl.className = "leditor-source-check-rail__list";
      boxesEl.appendChild(listEl);

      const byP = new Map<number, any[]>();
      for (const it of threadItems as any[]) {
        const p = Number.isFinite(it?.paragraphN) ? Math.max(1, Math.floor(it.paragraphN)) : 1;
        const list = byP.get(p) ?? [];
        list.push(it);
        byP.set(p, list);
      }

      const paragraphs = [...byP.entries()].sort((a, b) => a[0] - b[0]);
      for (const [p, items] of paragraphs) {
        const pCard = document.createElement("div");
        pCard.className = "leditor-source-check-rail__pCard";
        pCard.dataset.paragraph = String(p);

        const pHeader = document.createElement("div");
        pHeader.className = "leditor-source-check-rail__pHeader";

        const pTitle = document.createElement("div");
        pTitle.className = "leditor-source-check-rail__pTitle";
        pTitle.textContent = "P" + String(p);

        const pCount = document.createElement("div");
        pCount.className = "leditor-source-check-rail__pCount";
        pCount.textContent = String(items.length);

        const cardBtns = document.createElement("div");
        cardBtns.className = "leditor-source-check-rail__cardBtns";

        const collapseBtn = document.createElement("button");
        collapseBtn.type = "button";
        collapseBtn.className = "leditor-source-check-rail__iconBtn";
        collapseBtn.setAttribute("aria-label", "Collapse");
        collapseBtn.title = "Collapse";
        collapseBtn.innerHTML = iconSvg("collapse");

        const dismissPBtn = document.createElement("button");
        dismissPBtn.type = "button";
        dismissPBtn.className = "leditor-source-check-rail__iconBtn";
        dismissPBtn.setAttribute("aria-label", "Dismiss paragraph checks");
        dismissPBtn.title = "Dismiss paragraph checks";
        dismissPBtn.innerHTML = iconSvg("close");

        bindIconAction(collapseBtn, () => {
          const collapsed = pCard.classList.toggle("is-collapsed");
          collapseBtn.innerHTML = iconSvg(collapsed ? "expand" : "collapse");
          collapseBtn.title = collapsed ? "Expand" : "Collapse";
          collapseBtn.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
        });

        bindIconAction(dismissPBtn, () => {
          for (const it of items as any[]) {
            const key = typeof it?.key === "string" ? String(it.key) : "";
            if (!key) continue;
            try {
              editorHandle.execCommand("ai.sourceChecks.dismiss", { key });
            } catch {
              // ignore
            }
          }
          renderBoxes();
        });

        cardBtns.append(collapseBtn, dismissPBtn);
        pHeader.append(pTitle, pCount, cardBtns);

        const pBody = document.createElement("div");
        pBody.className = "leditor-source-check-rail__pBody";

        for (const it of items as any[]) {
          const key = typeof it?.key === "string" ? String(it.key) : "";
          const verdict = it?.verdict === "verified" ? "verified" : "needs_review";
          const anchorText = String(it?.anchor?.text ?? "");
          const justification = String(it?.justification ?? "");
          const fixSuggestion = typeof it?.fixSuggestion === "string" ? String(it.fixSuggestion) : "";
          const claimRewrite = typeof it?.claimRewrite === "string" ? String(it.claimRewrite) : "";
          const suggestedReplacementKey = typeof it?.suggestedReplacementKey === "string" ? String(it.suggestedReplacementKey) : "";

          const row = document.createElement("div");
          row.className = "leditor-source-check-rail__row";
          const shouldAutoFocus = key && key === sourceFocusKey;
          row.classList.toggle("is-verified", verdict === "verified");
          row.classList.toggle("is-needsReview", verdict !== "verified");
          if (key) row.dataset.key = key;
          if (shouldAutoFocus) row.classList.add("is-selected");

          const badge = document.createElement("span");
          badge.className = "leditor-source-check-rail__badge";
          badge.textContent = verdict === "verified" ? "✓" : "!";

          const rowMain = document.createElement("div");
          rowMain.className = "leditor-source-check-rail__rowMain";

          const aEl = document.createElement("div");
          aEl.className = "leditor-source-check-rail__anchor";
          aEl.textContent = anchorText;

          const justEl = document.createElement("div");
          justEl.className = "leditor-source-check-rail__rowJust";
          justEl.textContent = fixSuggestion ? justification + " Suggestion: " + fixSuggestion : justification;

          rowMain.append(aEl, justEl);

          if (verdict !== "verified" && claimRewrite.trim()) {
            const rewriteEl = document.createElement("div");
            rewriteEl.className = "leditor-source-check-rail__rowRewrite";
            rewriteEl.textContent = "Suggested rewrite (aligns with this citation): " + claimRewrite.trim();
            rowMain.appendChild(rewriteEl);

            const actions = document.createElement("div");
            actions.className = "leditor-source-check-rail__rowFixActions";

            const applyFix = document.createElement("button");
            applyFix.type = "button";
            applyFix.className = "leditor-source-check-rail__rowReplace";
            applyFix.textContent = "Insert rewrite";
            bindIconAction(applyFix, () => {
              if (!key) return;
              queueSourceRewriteDraft({ key, rewrite: claimRewrite, paragraphN: it?.paragraphN });
              renderBoxes();
              focusAnchor(it?.anchor);
            });
            actions.appendChild(applyFix);

            rowMain.appendChild(actions);
          }

          if (verdict !== "verified" && suggestedReplacementKey.trim()) {
            // Suggested a different citation anchor in the same paragraph.
            const byKey = new Map<string, any>();
            for (const x of items as any[]) {
              const k = typeof x?.key === "string" ? String(x.key) : "";
              if (k) byKey.set(k, x);
            }
            const suggested = byKey.get(suggestedReplacementKey.trim()) ?? (threadItems as any[]).find((x) => String(x?.key) === suggestedReplacementKey.trim());
            const suggestedAnchorText = String(suggested?.anchor?.text ?? "").trim() || suggestedReplacementKey.trim();

            const rep = document.createElement("button");
            rep.type = "button";
            rep.className = "leditor-source-check-rail__rowReplace";
            rep.textContent = "Suggested citation: " + suggestedAnchorText;
            rep.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              focusAnchor(suggested?.anchor);
            });
            rowMain.appendChild(rep);
          }

          const rowBtns = document.createElement("div");
          rowBtns.className = "leditor-source-check-rail__rowBtns";

          const expandBtn = document.createElement("button");
          expandBtn.type = "button";
          expandBtn.className = "leditor-source-check-rail__iconBtn";
          expandBtn.setAttribute("aria-label", "Expand");
          expandBtn.title = "Expand";
          expandBtn.innerHTML = iconSvg("expand");

          const dismissBtn = document.createElement("button");
          dismissBtn.type = "button";
          dismissBtn.className = "leditor-source-check-rail__iconBtn";
          dismissBtn.setAttribute("aria-label", "Dismiss");
          dismissBtn.title = "Dismiss";
          dismissBtn.innerHTML = iconSvg("close");

          bindIconAction(expandBtn, () => {
            const expanded = row.classList.toggle("is-expanded");
            expandBtn.innerHTML = iconSvg(expanded ? "collapse" : "expand");
            expandBtn.title = expanded ? "Collapse" : "Expand";
            expandBtn.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
          });

          bindIconAction(dismissBtn, () => {
            if (!key) return;
            try {
              editorHandle.execCommand("ai.sourceChecks.dismiss", { key });
            } catch {
              // ignore
            }
            renderBoxes();
          });

          rowBtns.append(expandBtn, dismissBtn);

          row.append(badge, rowMain, rowBtns);

          row.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              for (const el of Array.from(listEl.querySelectorAll(".leditor-source-check-rail__row.is-selected"))) {
                (el as HTMLElement).classList.remove("is-selected");
              }
              row.classList.add("is-selected");
            } catch {
              // ignore
            }
            focusAnchor(it?.anchor);
          });

          if (shouldAutoFocus) {
            // One-time: scroll sidebar row into view and focus the citation in the document.
            window.requestAnimationFrame(() => {
              try {
                row.scrollIntoView({ block: "nearest" });
              } catch {
                // ignore
              }
              focusAnchor(it?.anchor);
            });
            sourceFocusKey = null;
          }

          pBody.appendChild(row);
        }

        pCard.append(pHeader, pBody);
        listEl.appendChild(pCard);
      }

      return;
    }

    if (viewMode === "substantiate") {
      if (substantiateError) {
        const empty = document.createElement("div");
        empty.className = "leditor-agent-sidebar__boxEmpty";
        empty.textContent = substantiateError;
        boxesEl.appendChild(empty);
        return;
      }
      if (substantiateResults.length === 0) {
        const empty = document.createElement("div");
        empty.className = "leditor-agent-sidebar__boxEmpty";
        empty.textContent = inflight ? "Loading substantiate…" : "No substantiate suggestions.";
        boxesEl.appendChild(empty);
        return;
      }

      const stanceLabel = (stance?: string) => {
        if (stance === "corroborates") return "Corroborates";
        if (stance === "refutes") return "Refutes";
        if (stance === "mixed") return "Mixed";
        return "Uncertain";
      };

      const headerRow = document.createElement("div");
      headerRow.className = "leditor-agent-sidebar__boxHeaderRow";
      const headerTitle = document.createElement("div");
      headerTitle.className = "leditor-agent-sidebar__boxHeaderTitle";
      headerTitle.textContent = "Substantiate suggestions";
      const headerActions = document.createElement("div");
      headerActions.className = "leditor-agent-sidebar__boxHeaderActions";
      if (substantiatePreviewState) {
        const badge = document.createElement("div");
        badge.className = `leditor-agent-sidebar__boxHeaderBadge${substantiatePreviewState === "applied" ? " is-ok" : " is-fail"}`;
        badge.textContent = substantiatePreviewState === "applied" ? "Inline preview applied" : "Inline preview failed";
        headerActions.appendChild(badge);
      }
      const btnRejectAll = document.createElement("button");
      btnRejectAll.type = "button";
      btnRejectAll.className = "leditor-agent-sidebar__boxHeaderBtn";
      btnRejectAll.textContent = "Reject all";
      btnRejectAll.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        rejectAllPending();
      });
      const btnAcceptAll = document.createElement("button");
      btnAcceptAll.type = "button";
      btnAcceptAll.className = "leditor-agent-sidebar__boxHeaderBtn leditor-agent-sidebar__boxHeaderBtn--primary";
      btnAcceptAll.textContent = "Accept all";
      btnAcceptAll.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        acceptAllPending();
      });
      const subApply = (pendingByView as any).substantiate as AgentRunResult["apply"] | null;
      const hasPending =
        subApply &&
        subApply.kind === "batchReplace" &&
        Array.isArray((subApply as any).items) &&
        (subApply as any).items.length > 0;
      btnRejectAll.disabled = !hasPending;
      btnAcceptAll.disabled = !hasPending;
      headerActions.append(btnRejectAll, btnAcceptAll);
      headerRow.append(headerTitle, headerActions);
      boxesEl.appendChild(headerRow);

      for (const s of substantiateResults) {
        const h = document.createElement("div");
        h.className = "leditor-agent-sidebar__boxHeader";
        h.textContent = `P${s.paragraphN} • ${stanceLabel(s.stance)}`;

        const meta = document.createElement("div");
        meta.className = "leditor-agent-sidebar__boxMeta";
        meta.textContent = s.anchorTitle || s.anchorText || "Anchor";

        let anchorHint: HTMLElement | null = null;
        const anchorAction = s.anchorEdits?.action;
        if (anchorAction && anchorAction !== "none") {
          anchorHint = document.createElement("div");
          anchorHint.className = "leditor-agent-sidebar__subLabel";
          if (anchorAction === "add_anchor_only") {
            anchorHint.textContent = "Anchor-only (adds citation)";
          } else if (anchorAction === "prepend_clause_before_anchor") {
            anchorHint.textContent = "Clause + anchor (before citations)";
          } else if (anchorAction === "append_clause_after_anchor") {
            anchorHint.textContent = "Clause + anchor (after citations)";
          } else {
            anchorHint.textContent = "Anchor update";
          }
        }

        const original = String(s.sentence ?? "").replace(/\s+/g, " ").trim();
        const proposed = String(s.rewrite ?? "").replace(/\s+/g, " ").trim() || original;
        const canEdit =
          typeof s.from === "number" &&
          typeof s.to === "number" &&
          Number.isFinite(s.from) &&
          Number.isFinite(s.to) &&
          s.from < s.to;

        const card = document.createElement("div");
        card.className = "leditor-agent-sidebar__boxCard";
        card.addEventListener("click", (e) => {
          if ((e.target as HTMLElement)?.closest?.("button,summary")) return;
          focusParagraphNumber(s.paragraphN);
          if (canEdit) {
            const key = `${s.from}:${s.to}`;
            ensureSubstantiateDraftItem(s);
            window.requestAnimationFrame(() => {
              openDraftPopoverForKey(key);
            });
          }
        });

        const diffBody = document.createElement("div");
        diffBody.className = "leditor-agent-sidebar__boxBody leditor-agent-sidebar__boxBody--diff";
        if (original || proposed) {
          renderDiff(diffBody, original, proposed);
        }

        const editLabel = document.createElement("div");
        editLabel.className = "leditor-agent-sidebar__subLabel";
        editLabel.textContent = "Proposed (editable)";

        const proposedEl = document.createElement("div");
        proposedEl.className = "leditor-agent-sidebar__boxBody leditor-agent-sidebar__boxBody--edit";
        proposedEl.textContent = proposed;
        if (original) {
          proposedEl.title = `Original:\n${original}\n\nClick to edit.`;
        }
        if (canEdit) {
          proposedEl.contentEditable = "true";
          proposedEl.spellcheck = true;
          proposedEl.addEventListener("blur", () => {
            const nextText = proposedEl.textContent ?? "";
            updateSubstantiateDraftText(s.from as number, s.to as number, nextText);
          });
        }

        const noteBlocks: HTMLElement[] = [];
        const justificationText = s.justification || s.suggestion || s.notes || "";
        if (justificationText) {
          const label = document.createElement("div");
          label.className = "leditor-agent-sidebar__subLabel";
          label.textContent = "Justification";
          const body = document.createElement("div");
          body.className = "leditor-agent-sidebar__subNotes";
          body.textContent = justificationText;
          noteBlocks.push(label, body);
        }
        const anchorList = Array.isArray(s.anchorEdits?.anchors) ? s.anchorEdits?.anchors : [];
        if (anchorList.length > 0) {
          const label = document.createElement("div");
          label.className = "leditor-agent-sidebar__subLabel";
          label.textContent = "Anchors to add";
          const box = document.createElement("div");
          box.className = "leditor-agent-sidebar__anchorBox";
          for (const anchor of anchorList) {
            const item = document.createElement("div");
            item.className = "leditor-agent-sidebar__anchorItem";
            item.textContent = String(anchor?.text ?? "").trim();
            item.title = String(anchor?.title ?? anchor?.text ?? "").trim();
            box.appendChild(item);
          }
          noteBlocks.push(label, box);
        }
        if (s.diffs) {
          const label = document.createElement("div");
          label.className = "leditor-agent-sidebar__subLabel";
          label.textContent = "Diff summary";
          const diffs = document.createElement("div");
          diffs.className = "leditor-agent-sidebar__subNotes";
          diffs.textContent = s.diffs;
          noteBlocks.push(label, diffs);
        }

        const matchesWrap = document.createElement("div");
        matchesWrap.className = "leditor-agent-sidebar__subMatches is-hidden";
        if (Array.isArray(s.matches) && s.matches.length > 0) {
          for (const m of s.matches) {
            const row = document.createElement("div");
            row.className = "leditor-agent-sidebar__subMatch";
            const title = document.createElement("div");
            title.className = "leditor-agent-sidebar__subMatchTitle";
            title.textContent = m.title || "(untitled)";
            const metaLine = document.createElement("div");
            metaLine.className = "leditor-agent-sidebar__subMatchMeta";
            const score =
              typeof m.score === "number" ? `${Math.round(Math.max(0, m.score) * 1000) / 10}%` : "";
            metaLine.textContent = [m.author, m.year, m.source, m.page ? `p.${m.page}` : "", score].filter(Boolean).join(" • ");
            const quote = document.createElement("div");
            quote.className = "leditor-agent-sidebar__subMatchQuote";
            quote.textContent = m.directQuote || m.paraphrase || "";
            row.append(title, metaLine);
            if (quote.textContent) row.appendChild(quote);
            matchesWrap.appendChild(row);
          }
        } else {
          const empty = document.createElement("div");
          empty.className = "leditor-agent-sidebar__subMatchEmpty";
          empty.textContent = "No matches found.";
          matchesWrap.appendChild(empty);
        }

        const actions = document.createElement("div");
        actions.className = "leditor-agent-sidebar__boxActions";
        const hasRange =
          canEdit &&
          (() => {
            if (!subApply) return false;
            if (subApply.kind === "replaceRange") {
              return subApply.from === s.from && subApply.to === s.to;
            }
            if (subApply.kind === "batchReplace") {
              return Array.isArray(subApply.items) && subApply.items.some((it) => it.from === s.from && it.to === s.to);
            }
            return false;
          })();
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "leditor-agent-sidebar__boxBtn";
        reject.textContent = "Reject";
        reject.disabled = !hasRange;
        reject.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!hasRange) return;
          rejectPendingItem({ from: s.from, to: s.to });
        });
        const accept = document.createElement("button");
        accept.type = "button";
        accept.className = "leditor-agent-sidebar__boxBtn leditor-agent-sidebar__boxBtn--primary";
        accept.textContent = "Accept";
        accept.disabled = !hasRange;
        accept.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!hasRange) return;
          acceptPendingItem({ from: s.from, to: s.to });
        });
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "leditor-agent-sidebar__boxBtn";
        toggle.textContent = `Matches (${s.matches?.length ?? 0})`;
        toggle.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          matchesWrap.classList.toggle("is-hidden");
        });
        actions.append(reject, accept, toggle);

        if (hasRange) {
          card.dataset.pendingKey = `${s.from}:${s.to}`;
        }
        if (anchorHint) {
          card.append(h, meta, anchorHint);
        } else {
          card.append(h, meta);
        }
        card.append(diffBody, ...noteBlocks, editLabel, proposedEl, matchesWrap, actions);
        boxesEl.appendChild(card);
      }

      return;
    }

    // Edits view (refine/paraphrase/shorten/proofread)
    if (!pending) {
      const empty = document.createElement("div");
      empty.className = "leditor-agent-sidebar__boxEmpty";
      empty.textContent = "No edits pending. Run an action to see suggestions here.";
      boxesEl.appendChild(empty);
      return;
    }

    const headerRow = document.createElement("div");
    headerRow.className = "leditor-agent-sidebar__boxHeaderRow";
    const headerTitle = document.createElement("div");
    headerTitle.className = "leditor-agent-sidebar__boxHeaderTitle";
    const viewLabel = viewMode.replaceAll("_", " ");
    headerTitle.textContent = `${viewLabel.slice(0, 1).toUpperCase()}${viewLabel.slice(1)} suggestions`;
    const headerActions = document.createElement("div");
    headerActions.className = "leditor-agent-sidebar__boxHeaderActions";
    const btnRejectAll = document.createElement("button");
    btnRejectAll.type = "button";
    btnRejectAll.className = "leditor-agent-sidebar__boxHeaderBtn";
    btnRejectAll.textContent = "Reject all";
    btnRejectAll.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      rejectAllPending();
    });
    const btnAcceptAll = document.createElement("button");
    btnAcceptAll.type = "button";
    btnAcceptAll.className = "leditor-agent-sidebar__boxHeaderBtn leditor-agent-sidebar__boxHeaderBtn--primary";
    btnAcceptAll.textContent = "Accept all";
    btnAcceptAll.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      acceptAllPending();
    });
    headerActions.append(btnRejectAll, btnAcceptAll);
    headerRow.append(headerTitle, headerActions);
    boxesEl.appendChild(headerRow);

    const mkCard = (
      title: string,
      subtitle: string,
      originalText: string,
      proposedText: string,
      onAccept: () => void,
      onReject: () => void,
      onFocus?: () => void
    ) => {
      const card = document.createElement("div");
      card.className = "leditor-agent-sidebar__boxCard";
      if (onFocus) {
        card.addEventListener("click", (e) => {
          // Buttons stopPropagation; this only runs when the card body is clicked.
          e.preventDefault();
          e.stopPropagation();
          try {
            onFocus();
          } catch {
            // ignore
          }
        });
      }
      const h = document.createElement("div");
      h.className = "leditor-agent-sidebar__boxHeader";
      h.textContent = title;
      const meta = document.createElement("div");
      meta.className = "leditor-agent-sidebar__boxMeta";
      meta.textContent = subtitle;
      const body = document.createElement("div");
      body.className = "leditor-agent-sidebar__boxBody leditor-agent-sidebar__boxBody--diff";
      const original = String(originalText ?? "");
      const proposed = String(proposedText ?? "");
      if (original || proposed) {
        renderDiff(body, original, proposed);
      } else {
        body.textContent = "";
      }
      const actions = document.createElement("div");
      actions.className = "leditor-agent-sidebar__boxActions";
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "leditor-agent-sidebar__boxBtn";
      reject.textContent = "Reject";
      reject.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onReject();
        renderBoxes();
      });
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "leditor-agent-sidebar__boxBtn leditor-agent-sidebar__boxBtn--primary";
      accept.textContent = "Accept";
      accept.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onAccept();
        renderBoxes();
      });
      actions.append(reject, accept);
      card.append(h, meta, body, actions);
      return card;
    };

    if (pending.kind === "batchReplace") {
      const editor = editorHandle.getEditor();
      for (const it of pending.items) {
        const originalText =
          typeof it.originalText === "string" && it.originalText.trim()
            ? it.originalText
            : editor.state.doc.textBetween(it.from, it.to, "\n");
        const card = mkCard(
          `P${it.n}`,
          `Pending ${viewMode}`,
          originalText,
          it.text,
          () => acceptPendingItem({ n: it.n }),
          () => rejectPendingItem({ n: it.n }),
          () => focusParagraphNumber(it.n)
        );
        card.dataset.pendingKey = `${it.from}:${it.to}`;
        boxesEl.appendChild(card);
      }
      return;
    }
    if (pending.kind === "replaceRange") {
      const { from, to } = pending;
      const editor = editorHandle.getEditor();
      const originalText = editor.state.doc.textBetween(from, to, "\n");
      const card = mkCard(
        "Selection",
        `Pending ${viewMode}`,
        originalText,
        pending.text,
        () => acceptPendingItem({ from, to }),
        () => rejectPendingItem({ from, to }),
        () => {
          try {
            const editor = editorHandle.getEditor();
            editor.commands.setTextSelection({ from, to });
            editor.commands.focus();
          } catch {
            // ignore
          }
        }
      );
      card.dataset.pendingKey = `${from}:${to}`;
      boxesEl.appendChild(card);
      return;
    }

    const empty = document.createElement("div");
    empty.className = "leditor-agent-sidebar__boxEmpty";
    empty.textContent = "This edit type is shown inline in the document.";
    boxesEl.appendChild(empty);
  };

  const findPendingViewByKey = (key: string): SidebarViewId | null => {
    if (!key) return null;
    const entries = Object.entries(pendingByView as any) as Array<[SidebarViewId, any]>;
    for (const [view, apply] of entries) {
      if (!apply) continue;
      if (apply.kind === "replaceRange") {
        if (`${apply.from}:${apply.to}` === key) return view;
        continue;
      }
      if (apply.kind === "batchReplace") {
        const items = Array.isArray(apply.items) ? apply.items : [];
        if (items.find((it: any) => `${it.from}:${it.to}` === key)) return view;
      }
    }
    return null;
  };

  const highlightPendingCard = (key: string) => {
    if (!key) return;
    const doHighlight = () => {
      try {
        const cards = Array.from(boxesEl.querySelectorAll<HTMLElement>(".leditor-agent-sidebar__boxCard"));
        for (const el of cards) el.classList.remove("is-selected");
        const match = cards.find((el) => el.dataset.pendingKey === key);
        if (match) {
          match.classList.add("is-selected");
          match.scrollIntoView({ block: "nearest" });
        }
      } catch {
        // ignore
      }
    };
    const targetView = findPendingViewByKey(key);
    if (targetView && targetView !== viewMode) {
      setViewMode(targetView);
      window.requestAnimationFrame(doHighlight);
    } else {
      doHighlight();
    }
  };

  const autoResizeInput = () => {
    try {
      input.style.height = "auto";
      const max = 200;
      const next = Math.min(max, Math.max(26, input.scrollHeight));
      input.style.height = `${next}px`;
    } catch {
      // ignore
    }
  };

  const updateComposerState = () => {
    const hasText = Boolean(String(input.value ?? "").trim());
    sendBtn.disabled = !inflight && !hasText;
    plusBtn.disabled = inflight;
    sendBtn.innerHTML = inflight ? STOP_ICON : SEND_ICON;
    sendBtn.setAttribute("aria-label", inflight ? "Stop" : "Send");
  };

  const addMessage = (role: AgentMessage["role"], content: string): string | null => {
    if (role === "system") {
      setStatus(content);
      return null;
    }
    const prevLen = messages.length;
    const id = makeMessageId();
    messages = clampHistory([...messages, { id, role, content, ts: Date.now() }], 50);
    const clamped = messages.length !== prevLen + 1;
    renderMessages(clamped);
    if (role === "user") {
      appendAgentHistoryMessage({ role, content });
    }
    return id;
  };

  const updateMessage = (id: string, content: string) => {
    const idx = messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    messages[idx] = { ...messages[idx]!, content };
    renderMessages(true);
  };

  const syncInsets = () => {
    const bottom = getStatusBarHeight();
    sidebar.style.bottom = bottom > 0 ? `${Math.ceil(bottom)}px` : "";
  };
  const clearPending = () => {
    pending = null;
    pendingByView = {
      ...pendingByView,
      refine: null,
      paraphrase: null,
      shorten: null,
      proofread: null,
      sections: null,
      substantiate: null,
      sources: null
    };
    pendingActionId = null;
    substantiateResults = [];
    substantiateError = null;
    substantiateSuppressedKeys.clear();
    setStatus("Ready.");
    try {
      editorHandle.execCommand("ClearAiDraftPreview");
    } catch {
      // ignore
    }
    renderBoxes();
  };

  const buildTextblockReplacementFragment = (doc: any, from: number, to: number, text: string) => {
    // Preserve citation/anchor tokens even when the model omits them in its rewrite.
    // Works when the replacement stays within the same textblock parent.
    try {
      const schema = doc.type.schema;
      const $from = doc.resolve(from);
      const $to = doc.resolve(to);
      if (!$from.sameParent($to)) return null;
      const parent = $from.parent;
      if (!parent?.isTextblock) return null;

      const slice = doc.slice(from, to);
      const content = slice.content;

      const isCitationLikeMarkLocal = (mark: any): boolean => {
        const name = String(mark?.type?.name ?? "");
        if (name === "anchor") return true;
        if (name !== "link") return false;
        const attrs = mark?.attrs ?? {};
        const href = typeof attrs?.href === "string" ? attrs.href : "";
        const looksLikeCitation = Boolean(
          attrs?.dataKey ||
            attrs?.itemKey ||
            attrs?.dataItemKey ||
            attrs?.dataDqid ||
            attrs?.dataQuoteId ||
            attrs?.dataQuoteText
        );
        if (looksLikeCitation) return true;
        if (href && /^(dq|cite|citegrp):\/\//i.test(href)) return true;
        return false;
      };

      const isProtectedTextNode = (node: any): boolean => {
        if (!node?.isText) return false;
        const marks = Array.isArray(node.marks) ? node.marks : [];
        return marks.some((m: any) => isCitationLikeMarkLocal(m));
      };

      const isProtectedInlineNode = (node: any): boolean => {
        const name = String(node?.type?.name ?? "");
        if (name === "citation") return true;
        return false;
      };

      // Build a template of inline units from the original slice.
      const units: Array<
        | { kind: "plain"; text: string; marks: any[] }
        | { kind: "protected"; node: any; text: string }
      > = [];
      for (let i = 0; i < content.childCount; i += 1) {
        const child = content.child(i);
        if (!child) continue;
        if (child.isText) {
          const t = String(child.text ?? "");
          if (isProtectedTextNode(child)) units.push({ kind: "protected", node: child, text: t });
          else units.push({ kind: "plain", text: t, marks: Array.isArray((child as any).marks) ? (child as any).marks : [] });
          continue;
        }
        if (isProtectedInlineNode(child)) {
          units.push({ kind: "protected", node: child, text: "" });
          continue;
        }
        // Non-text inline nodes (images, etc.) are preserved as-is.
        units.push({ kind: "protected", node: child, text: "" });
      }

      const originalPlainChunks: string[] = [];
      const originalPlainChunkMarks: any[][] = [];
      let curPlain = "";
      let curMarks: any[] | null = null;
      const protectedNodes: any[] = [];
      const protectedTexts: string[] = [];
      for (const u of units) {
        if (u.kind === "plain") {
          if (!curPlain && !curMarks) {
            curMarks = Array.isArray((u as any).marks) ? (u as any).marks : [];
          }
          curPlain += u.text;
          continue;
        }
        originalPlainChunks.push(curPlain);
        originalPlainChunkMarks.push(curMarks ?? []);
        curPlain = "";
        curMarks = null;
        protectedNodes.push(u.node);
        if (u.text) protectedTexts.push(u.text);
      }
      originalPlainChunks.push(curPlain);
      originalPlainChunkMarks.push(curMarks ?? []);

      const stripProtectedTexts = (value: string): string => {
        let out = String(value ?? "");
        for (const t of protectedTexts) {
          if (!t) continue;
          out = out.split(t).join("");
        }
        return out.replace(/\s+/g, " ").trim();
      };

      const nextPlain = stripProtectedTexts(String(text ?? ""));
      const totalOriginalPlainLen = originalPlainChunks.reduce((acc, s) => acc + s.length, 0);
      const proportions = originalPlainChunks.map((s) => (totalOriginalPlainLen > 0 ? s.length / totalOriginalPlainLen : 0));

      const splitByProportions = (value: string, props: number[]): string[] => {
        const out: string[] = [];
        const input = String(value ?? "");
        if (props.length <= 1) return [input];
        let idx = 0;
        for (let i = 0; i < props.length; i += 1) {
          if (i === props.length - 1) {
            out.push(input.slice(idx));
            break;
          }
          const target = idx + Math.floor(input.length * (props[i] ?? 0));
          const limit = Math.max(idx, Math.min(input.length, target));
          let cut = input.lastIndexOf(" ", limit);
          if (cut < idx + 8) cut = input.indexOf(" ", limit);
          if (cut < 0) cut = limit;
          out.push(input.slice(idx, cut).trim());
          idx = cut;
        }
        return out.map((s) => s.replace(/\s+/g, " ").trim());
      };

      const nextChunks = splitByProportions(nextPlain, proportions);
      while (nextChunks.length < originalPlainChunks.length) nextChunks.push("");
      if (nextChunks.length > originalPlainChunks.length) {
        const extra = nextChunks.slice(originalPlainChunks.length - 1).join(" ").trim();
        nextChunks.length = originalPlainChunks.length;
        nextChunks[originalPlainChunks.length - 1] = [nextChunks[originalPlainChunks.length - 1], extra].filter(Boolean).join(" ").trim();
      }

      const nodes: any[] = [];
      const maybeAddSpaceBetween = (a: string, b: any) => {
        if (!a) return;
        if (!b) return;
        if (typeof b === "string") {
          if (a && b && /\S$/.test(a) && /^\S/.test(b)) nodes.push(schema.text(" "));
          return;
        }
        if (a && /\S$/.test(a)) nodes.push(schema.text(" "));
      };

      for (let i = 0; i < originalPlainChunks.length; i += 1) {
        const chunk = String(nextChunks[i] ?? "");
        if (chunk) {
          const marks = Array.isArray(originalPlainChunkMarks[i]) ? originalPlainChunkMarks[i] : [];
          nodes.push(schema.text(chunk, marks));
        }
        const prot = protectedNodes[i];
        if (prot) {
          if (chunk) maybeAddSpaceBetween(chunk, prot);
          nodes.push(prot);
          const next = String(nextChunks[i + 1] ?? "");
          if (next && /^\S/.test(next)) nodes.push(schema.text(" "));
        }
      }

      return Fragment.fromArray(nodes.filter(Boolean));
    } catch {
      return null;
    }
  };

  const pickPrimaryAuthor = (value: string): string => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const parts = raw.split(/;|\band\b|\s&\s/i).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 0) return parts[0] ?? raw;
    return raw;
  };

  const formatAnchorTextFromMatch = (match: SubstantiateMatch | null, fallbackText: string): string => {
    const author = typeof match?.author === "string" ? pickPrimaryAuthor(match.author) : "";
    const year = typeof match?.year === "string" ? match.year.trim() : "";
    const page = Number.isFinite(match?.page) ? String(match?.page) : "";
    const parts = [author, year, page ? `p. ${page}` : ""].filter(Boolean);
    if (parts.length) return `(${parts.join(", ")})`;
    return fallbackText;
  };

  const normalizeAnchorEditsFromResult = (
    raw: any,
    matches: SubstantiateMatch[]
  ): SubstantiateAnchorEdits | null => {
    if (!raw || typeof raw !== "object") return null;
    const source = raw.anchorEdits && typeof raw.anchorEdits === "object" ? raw.anchorEdits : raw;
    const actionRaw = typeof source.action === "string" ? source.action.trim().toLowerCase() : "";
    const action =
      actionRaw === "add_anchor_only" || actionRaw === "append_clause_after_anchor" || actionRaw === "prepend_clause_before_anchor"
        ? (actionRaw as SubstantiateAnchorEdits["action"])
        : "none";
    if (action === "none") return null;
    const anchorsRaw = Array.isArray(source.anchors) ? source.anchors : [];
    if (!anchorsRaw.length) return null;
    const byDqid = new Map(matches.map((m) => [String(m?.dqid ?? ""), m]));
    const anchors: SubstantiateAnchorSpec[] = anchorsRaw
      .map((a: any) => {
        const dqid = String(a?.dqid ?? a?.dataQuoteId ?? a?.dataDqid ?? "").trim();
        if (!dqid) return null;
        const match = byDqid.get(dqid) ?? null;
        if (!match) return null;
        const dataKey = String(a?.dataKey ?? match?.itemKey ?? match?.dqid ?? "").trim();
        const dataQuoteId = String(a?.dataQuoteId ?? dqid).trim();
        const title = String(a?.title ?? match?.directQuote ?? match?.paraphrase ?? match?.title ?? "").trim();
        const fallbackText = typeof a?.text === "string" ? a.text.trim() : "";
        const text = formatAnchorTextFromMatch(match, fallbackText);
        if (!text) return null;
        const safeTitle = title || fallbackText || text;
        const href = String(a?.href ?? (dqid ? `dq://${dqid}` : "")).trim();
        const dataDqid = String(a?.dataDqid ?? "").trim();
        const dataQuoteText = String(a?.dataQuoteText ?? "").trim();
        const dataOrigHref = String(a?.dataOrigHref ?? "").trim();
        return { dqid, dataKey, dataQuoteId, text, title: safeTitle, href, dataDqid, dataQuoteText, dataOrigHref };
      })
      .filter(Boolean) as SubstantiateAnchorSpec[];
    if (!anchors.length) return null;
    const clause = typeof source.clause === "string" ? source.clause.trim() : "";
    return { action, clause, anchors };
  };

  const computeInsertionOffsetAfterAnchors = (text: string, anchorEndOffset: number): number => {
    const raw = String(text ?? "");
    let idx = Math.max(0, Math.min(raw.length, Math.floor(anchorEndOffset)));
    while (idx < raw.length && /[)\]\}"'”’]/.test(raw[idx] ?? "")) idx += 1;
    while (idx < raw.length && /[.!?]/.test(raw[idx] ?? "")) idx += 1;
    while (idx < raw.length && /\s/.test(raw[idx] ?? "")) idx += 1;
    return idx;
  };

  const buildAnchorInsertionPrefix = (text: string, offset: number, clauseRaw: string): string => {
    const raw = String(text ?? "");
    const clause = String(clauseRaw ?? "").trim();
    const prevChar = offset > 0 ? raw[offset - 1] : "";
    const clauseStartsWithPunct = clause ? /^[,.;:!?)]/.test(clause) : false;
    const needsLeadingSpace = prevChar && !/\s/.test(prevChar) && !clauseStartsWithPunct;
    let prefix = needsLeadingSpace ? " " : "";
    if (clause) {
      prefix += clause;
      if (!/\s$/.test(prefix)) prefix += " ";
    } else if (!prefix && prevChar && !/\s/.test(prevChar)) {
      prefix = " ";
    }
    return prefix;
  };

  const buildSubstantiateAnchorInsertions = (args: {
    context: {
      paragraph: { from: number; to: number };
      paragraphTextRaw: string;
      anchors: Array<{ startOffset: number; endOffset: number }>;
    };
    edits: SubstantiateAnchorEdits;
  }): SubstantiateAnchorInsertion[] => {
    const { context, edits } = args;
    if (!edits?.anchors?.length) return [];
    const offsets = context.anchors.map((a) => ({ start: a.startOffset, end: a.endOffset }));
    if (!offsets.length) return [];
    const groupStartOffset = Math.min(...offsets.map((o) => o.start));
    const groupEndOffset = Math.max(...offsets.map((o) => o.end));
    const paragraphTextRaw = context.paragraphTextRaw;
    const insertOffset =
      edits.action === "prepend_clause_before_anchor"
        ? groupStartOffset
        : edits.action === "append_clause_after_anchor"
          ? computeInsertionOffsetAfterAnchors(paragraphTextRaw, groupEndOffset)
          : groupEndOffset;
    const insertPos = resolveTextOffsetToDocPos(context.paragraph.from, context.paragraph.to, insertOffset);
    const clause = edits.action === "add_anchor_only" ? "" : edits.clause ?? "";
    const prefix = buildAnchorInsertionPrefix(paragraphTextRaw, insertOffset, clause);
    return [
      {
        pos: insertPos,
        prefix,
        anchors: edits.anchors
      }
    ];
  };



  const isCitationLikeMark = (mark: any): boolean => {
    const name = String(mark?.type?.name ?? "");
    if (name === "anchor") return true;
    if (name !== "link") return false;
    const attrs = mark?.attrs ?? {};
    const href = typeof attrs?.href === "string" ? attrs.href : "";
    const looksLikeCitation = Boolean(
      attrs?.dataKey ||
        attrs?.itemKey ||
        attrs?.dataItemKey ||
        attrs?.dataDqid ||
        attrs?.dataQuoteId ||
        attrs?.dataQuoteText
    );
    if (looksLikeCitation) return true;
    if (href && /^(dq|cite|citegrp):\/\//i.test(href)) return true;
    return false;
  };

  const extractAnchorTextsInRange = (doc: any, from: number, to: number): string[] => {
    const texts: string[] = [];
    doc.nodesBetween(from, to, (node: any) => {
      if (!node?.isText) return true;
      const marks = Array.isArray(node.marks) ? node.marks : [];
      if (!marks.some((m: any) => isCitationLikeMark(m))) return true;
      const t = String(node.text ?? "");
      if (t) texts.push(t);
      return true;
    });
    return texts;
  };

  const countOccurrences = (haystack: string, needle: string) => {
    if (!needle) return 0;
    let count = 0;
    let idx = 0;
    for (;;) {
      const next = haystack.indexOf(needle, idx);
      if (next < 0) break;
      count += 1;
      idx = next + needle.length;
    }
    return count;
  };

  const assertAnchorsPreserved = (doc: any, from: number, to: number, nextText: string) => {
    const segments = extractAnchorTextsInRange(doc, from, to);
    if (segments.length === 0) return;
    const originalText = String(doc.textBetween(from, to, "\n") ?? "");
    const proposed = String(nextText ?? "");
    const unique = Array.from(new Set(segments));
    for (const seg of unique) {
      const originalCount = countOccurrences(originalText, seg);
      const nextCount = countOccurrences(proposed, seg);
      if (nextCount < originalCount) {
        throw new Error(`Anchor/citation text must be preserved exactly. Missing or altered: "${seg}".`);
      }
    }
  };

  const splitTextByProportions = (value: string, lengths: number[]): string[] => {
    const input = String(value ?? "");
    if (lengths.length <= 1) return [input];
    const total = lengths.reduce((acc, n) => acc + Math.max(0, n), 0);
    if (total <= 0) {
      const chunk = input;
      return [chunk, ...lengths.slice(1).map(() => "")];
    }
    const out: string[] = [];
    let idx = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      if (i === lengths.length - 1) {
        out.push(input.slice(idx));
        break;
      }
      const share = Math.max(0, lengths[i]) / total;
      const target = idx + Math.floor(input.length * share);
      const limit = Math.max(idx, Math.min(input.length, target));
      let cut = input.lastIndexOf(" ", limit);
      if (cut < idx) cut = input.indexOf(" ", limit);
      if (cut < 0) cut = limit;
      out.push(input.slice(idx, cut));
      idx = cut;
    }
    while (out.length < lengths.length) out.push("");
    if (out.length > lengths.length) {
      const extra = out.slice(lengths.length - 1).join("");
      out.length = lengths.length;
      out[lengths.length - 1] = `${out[lengths.length - 1]}${extra}`;
    }
    return out;
  };

  const splitDraftTextByParagraphs = (text: string, originals: string[]): string[] => {
    const count = originals.length;
    const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
    if (count <= 1) return [normalized];
    if (!normalized) return originals.map(() => "");
    const byBlank = normalized.split(/\n{2,}/);
    if (byBlank.length === count) return byBlank;
    const byLine = normalized.split(/\n/);
    if (byLine.length === count) return byLine;
    const lengths = originals.map((s) => s.length);
    return splitTextByProportions(normalized, lengths);
  };

  const resolveParagraphRangesForSpan = (from: number, to: number) => {
    const ranges = listParagraphRanges();
    return ranges.filter((p) => p.to >= from && p.from <= to);
  };

  const applyRangeAsTransaction = (
    from: number,
    to: number,
    text: string,
    meta?: { source?: string; n?: number | null; anchorInsertions?: SubstantiateAnchorInsertion[] }
  ) => {
    const editor = editorHandle.getEditor();
    const state = editor.state;
    const baseDoc = state.doc;
    const getMarksAtPos = (doc: any, pos: number) => {
      try {
        const $pos = doc.resolve(pos);
        return Array.isArray($pos.marks()) ? $pos.marks() : [];
      } catch {
        return [];
      }
    };
    const buildAnchorMark = (schema: any, anchor: SubstantiateAnchorSpec) => {
      const markType = schema?.marks?.anchor ?? schema?.marks?.link;
      if (!markType) return null;
      const dqid = String(anchor?.dqid ?? "");
      const dataKey = String(anchor?.dataKey ?? "");
      const dataQuoteId = String(anchor?.dataQuoteId ?? dqid);
      const href = String(anchor?.href ?? (dqid ? `dq://${dqid}` : ""));
      const title = String(anchor?.title ?? "");
      const dataDqid = String(anchor?.dataDqid ?? "");
      const dataQuoteText = String(anchor?.dataQuoteText ?? "");
      const dataOrigHref = String(anchor?.dataOrigHref ?? dataKey);
      return markType.create({
        href,
        title,
        dataKey,
        dataQuoteId,
        dataDqid,
        dataQuoteText,
        dataOrigHref
      });
    };
    const buildFallbackTextNode = (doc: any, rangeFrom: number, rangeTo: number, value: string) => {
      const schema = doc.type?.schema ?? editor.state.schema;
      let marks: any[] = [];
      doc.nodesBetween(rangeFrom, rangeTo, (node: any) => {
        if (!node?.isText) return true;
        marks = Array.isArray(node.marks) ? node.marks : [];
        return false;
      });
      if (!marks.length) {
        try {
          const $from = doc.resolve(rangeFrom);
          marks = Array.isArray($from.marks()) ? $from.marks() : [];
        } catch {
          marks = [];
        }
      }
      return schema.text(String(value ?? ""), marks);
    };
    const paragraphs = resolveParagraphRangesForSpan(from, to);
    if (paragraphs.length > 1) {
      const originals = paragraphs.map((p) => baseDoc.textBetween(p.from, p.to, "\n"));
      const chunks = splitDraftTextByParagraphs(text, originals);
      const items = paragraphs.map((p, i) => ({
        from: p.from,
        to: p.to,
        text: String(chunks[i] ?? "").trim()
      }));
      applyBatchAsTransaction(items, meta?.source ? { source: meta.source } : undefined);
      return;
    }
    const fragment = buildTextblockReplacementFragment(baseDoc, from, to, text);
    if (!fragment) {
      // Fallback: if not an exact textblock replacement, still prevent citation loss.
      assertAnchorsPreserved(baseDoc, from, to, text);
    }
    const tr = fragment
      ? state.tr.replaceWith(from, to, fragment as any)
      : state.tr.replaceWith(from, to, buildFallbackTextNode(baseDoc, from, to, text) as any);
    if (meta?.anchorInsertions?.length) {
      const schema = baseDoc.type?.schema ?? editor.state.schema;
      for (const insertion of meta.anchorInsertions) {
        if (!insertion || !Number.isFinite(insertion.pos)) continue;
        let pos = tr.mapping.map(insertion.pos);
        const prefix = String(insertion.prefix ?? "");
        if (prefix) {
          const marks = getMarksAtPos(tr.doc, pos);
          tr.insert(pos, schema.text(prefix, marks));
          pos += prefix.length;
        }
        const anchors = Array.isArray(insertion.anchors) ? insertion.anchors : [];
        for (let i = 0; i < anchors.length; i += 1) {
          const anchor = anchors[i];
          const anchorText = String(anchor?.text ?? "");
          if (!anchorText) continue;
          const mark = buildAnchorMark(schema, anchor);
          tr.insert(pos, mark ? schema.text(anchorText, [mark]) : schema.text(anchorText));
          pos += anchorText.length;
          if (i < anchors.length - 1) {
            tr.insert(pos, schema.text(" "));
            pos += 1;
          }
        }
      }
    }
    tr.setMeta("leditor-ai", { kind: "agent", ts: Date.now() });
    editor.view.dispatch(tr);
    editor.commands.focus();
    if (meta?.source === "substantiate") {
      try {
        const beforeText = normalizeDiffText(baseDoc.textBetween(from, to, "\n"));
        const expected = normalizeDiffText(text);
        const afterDoc = editor.state.doc;
        const probeEnd = Math.min(afterDoc.content.size, from + Math.max(8, expected.length + 16));
        const afterText = normalizeDiffText(afterDoc.textBetween(from, probeEnd, "\n"));
        const ok = expected ? afterText.includes(expected.slice(0, Math.min(40, expected.length))) : false;
        console.info("[substantiate] applied", {
          from,
          to,
          n: meta?.n ?? undefined,
          ok,
          expected: expected.slice(0, 160),
          before: beforeText.slice(0, 160),
          after: afterText.slice(0, 160)
        });
      } catch (error) {
        console.warn("[substantiate] applied_log_failed", error);
      }
    }
  };

  const applyBatchAsTransaction = (
    items: Array<{ from: number; to: number; text: string }>,
    meta?: { source?: string }
  ) => {
    const editor = editorHandle.getEditor();
    const state = editor.state;
    const baseDoc = state.doc;
    const buildFallbackTextNode = (doc: any, rangeFrom: number, rangeTo: number, value: string) => {
      const schema = doc.type?.schema ?? editor.state.schema;
      let marks: any[] = [];
      doc.nodesBetween(rangeFrom, rangeTo, (node: any) => {
        if (!node?.isText) return true;
        marks = Array.isArray(node.marks) ? node.marks : [];
        return false;
      });
      if (!marks.length) {
        try {
          const $from = doc.resolve(rangeFrom);
          marks = Array.isArray($from.marks()) ? $from.marks() : [];
        } catch {
          marks = [];
        }
      }
      return schema.text(String(value ?? ""), marks);
    };
    const sorted = [...items].sort((a, b) => b.from - a.from);
    let tr = state.tr;
    for (const item of sorted) {
      const fragment = buildTextblockReplacementFragment(baseDoc, item.from, item.to, item.text);
      if (!fragment) {
        assertAnchorsPreserved(baseDoc, item.from, item.to, item.text);
      }
      tr = fragment
        ? tr.replaceWith(item.from, item.to, fragment as any)
        : tr.replaceWith(item.from, item.to, buildFallbackTextNode(baseDoc, item.from, item.to, item.text) as any);
    }
    tr.setMeta("leditor-ai", { kind: "agent", ts: Date.now(), items: sorted.length });
    editor.view.dispatch(tr);
    editor.commands.focus();
    if (meta?.source === "substantiate") {
      try {
        const afterDoc = editor.state.doc;
        const sample = sorted.slice(0, 3).map((it) => {
          const expected = normalizeDiffText(it.text);
          const probeEnd = Math.min(afterDoc.content.size, it.from + Math.max(8, expected.length + 16));
          const afterText = normalizeDiffText(afterDoc.textBetween(it.from, probeEnd, "\n"));
          const ok = expected ? afterText.includes(expected.slice(0, Math.min(40, expected.length))) : false;
          const beforeText = normalizeDiffText(baseDoc.textBetween(it.from, it.to, "\n"));
          return {
            from: it.from,
            to: it.to,
            ok,
            expected: expected.slice(0, 120),
            before: beforeText.slice(0, 120),
            after: afterText.slice(0, 120)
          };
        });
        console.info("[substantiate] applied_batch", { count: sorted.length, sample });
      } catch (error) {
        console.warn("[substantiate] applied_batch_log_failed", error);
      }
    }
  };

  const markSubstantiateSuppressedByRange = (from: number, to: number) => {
    const match = substantiateResults.find((it) => it.from === from && it.to === to);
    if (match?.key) substantiateSuppressedKeys.add(match.key);
  };

  const markSubstantiateSuppressedAll = () => {
    for (const it of substantiateResults) {
      if (it?.key) substantiateSuppressedKeys.add(it.key);
    }
  };

  const getRangeOriginalText = (from: number, to: number): string => {
    try {
      const editor = editorHandle.getEditor();
      return String(editor.state.doc.textBetween(from, to, "\n") ?? "");
    } catch {
      return "";
    }
  };

  const updateSubstantiateDraftText = (from: number, to: number, text: string) => {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    const nextText = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!nextText) return;
    let updated = false;
    const apply = (pendingByView as any).substantiate as AgentRunResult["apply"] | null;
    if (apply) {
      if (apply.kind === "replaceRange") {
        if (apply.from === from && apply.to === to) {
          apply.text = nextText;
          updated = true;
        }
      } else if (apply.kind === "batchReplace") {
        for (const it of apply.items ?? []) {
          if (it.from === from && it.to === to) {
            it.text = nextText;
            updated = true;
            break;
          }
        }
      }
    }
    if (updated) {
      substantiateResults = substantiateResults.map((it) =>
        it.from === from && it.to === to ? { ...it, rewrite: nextText } : it
      );
      syncDraftPreview();
      renderBoxes();
    }
  };

  const ensureSubstantiateDraftItem = (entry: SubstantiateSuggestion) => {
    if (typeof entry.from !== "number" || typeof entry.to !== "number") return false;
    if (!Number.isFinite(entry.from) || !Number.isFinite(entry.to) || entry.from >= entry.to) return false;
    const text = String(entry.rewrite ?? "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    const current = (pendingByView as any).substantiate as AgentRunResult["apply"] | null;
    if (!current) {
      (pendingByView as any).substantiate = {
        kind: "batchReplace",
        items: [
          {
            n: Number.isFinite(entry.paragraphN) ? entry.paragraphN : 0,
            from: entry.from,
            to: entry.to,
            text,
            originalText: getRangeOriginalText(entry.from, entry.to)
          }
        ]
      };
      pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
      syncDraftPreview();
      return true;
    }
    if (current.kind === "replaceRange") {
      if (current.from === entry.from && current.to === entry.to) return false;
      (pendingByView as any).substantiate = {
        kind: "batchReplace",
        items: [
          {
            n: Number.isFinite(entry.paragraphN) ? entry.paragraphN : 0,
            from: entry.from,
            to: entry.to,
            text,
            originalText: getRangeOriginalText(entry.from, entry.to)
          },
          {
            n: (current as any).n ?? 0,
            from: current.from,
            to: current.to,
            text: current.text,
            originalText: getRangeOriginalText(current.from, current.to)
          }
        ]
      };
      pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
      syncDraftPreview();
      return true;
    }
    if (current.kind === "batchReplace") {
      const items = Array.isArray(current.items) ? current.items : [];
      if (items.some((it: any) => it.from === entry.from && it.to === entry.to)) return false;
      items.push({
        n: Number.isFinite(entry.paragraphN) ? entry.paragraphN : 0,
        from: entry.from,
        to: entry.to,
        text,
        originalText: getRangeOriginalText(entry.from, entry.to)
      });
      current.items = items;
      pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
      syncDraftPreview();
      return true;
    }
    return false;
  };

  const openDraftPopoverForKey = (key: string): boolean => {
    if (!key) return false;
    const el = document.querySelector<HTMLElement>(`[data-ai-draft-key="${key}"]`);
    if (!el) return false;
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
      // ignore
    }
    try {
      const evt = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
      el.dispatchEvent(evt);
      return true;
    } catch {
      return false;
    }
  };

  const focusAtPos = (pos: number) => {
    if (!Number.isFinite(pos)) return;
    const editor = editorHandle.getEditor();
    try {
      const doc = editor.state.doc;
      const safePos = Math.max(1, Math.min(doc.content.size - 1, pos));
      const tr = editor.state.tr.setSelection(TextSelection.create(doc, safePos)).scrollIntoView();
      editor.view.dispatch(tr);
      editor.view.focus();
      console.info("[agent][sections][debug]", {
        label: "focus",
        requested: pos,
        safePos,
        ok: true
      });
    } catch {
      try {
        editor.commands.setTextSelection?.({ from: pos, to: pos });
        editor.commands.focus();
        console.info("[agent][sections][debug]", {
          label: "focus",
          requested: pos,
          safePos: pos,
          ok: true,
          fallback: true
        });
      } catch (error) {
        console.warn("[agent][sections][debug]", {
          label: "focus",
          requested: pos,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
        // ignore
      }
    }
  };

  const dropSubstantiateByRange = (from: number, to: number) => {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    markSubstantiateSuppressedByRange(from, to);
    substantiateResults = substantiateResults.filter((it) => it.from !== from || it.to !== to);
  };
  const syncDraftPreview = () => {
    try {
      const items: any[] = [];
      const seen = new Set<string>();
      const push = (it: any) => {
        const k = `${it.from}:${it.to}`;
        if (seen.has(k)) return;
        seen.add(k);
        items.push(it);
      };
      const editor = editorHandle.getEditor();
      const baseDoc = editor.state.doc;

      const addApply = (apply: any) => {
        if (!apply) return;
        if (apply.kind === "replaceRange") {
          push({
            from: apply.from,
            to: apply.to,
            proposedText: apply.text,
            originalText: baseDoc.textBetween(apply.from, apply.to, "\n")
          });
          return;
        }
        if (apply.kind === "batchReplace") {
          for (const it of apply.items ?? []) {
            push({
              from: it.from,
              to: it.to,
              proposedText: it.text,
              originalText: it.originalText
            });
          }
        }
      };

      for (const apply of Object.values(pendingByView as any)) {
        addApply(apply);
      }

      const hasSubstantiatePending = Boolean((pendingByView as any).substantiate);
      const prevPreviewState = substantiatePreviewState;
      if (!items.length) {
        editorHandle.execCommand("ClearAiDraftPreview");
        if (hasSubstantiatePending) {
          substantiatePreviewState = null;
        }
        if (prevPreviewState !== substantiatePreviewState && viewMode === "substantiate") {
          renderBoxes();
        }
        return;
      }
      editorHandle.execCommand("SetAiDraftPreview", { items });
      if (hasSubstantiatePending) {
        substantiatePreviewState = "applied";
        console.info("[substantiate] draft_preview_set", { items: items.length });
        if (substantiatePreviewRaf) {
          window.cancelAnimationFrame(substantiatePreviewRaf);
        }
        substantiatePreviewRaf = window.requestAnimationFrame(() => {
          substantiatePreviewRaf = 0;
          try {
            const nodes = document.querySelectorAll<HTMLElement>("[data-ai-draft-repl]");
            const count = nodes.length;
            console.info("[substantiate] preview_dom", { count });
          } catch (error) {
            console.warn("[substantiate] preview_dom_failed", error);
          }
        });
      }
      if (prevPreviewState !== substantiatePreviewState && viewMode === "substantiate") {
        renderBoxes();
      }
    } catch (error) {
      try {
        if ((pendingByView as any).substantiate) {
          substantiatePreviewState = "failed";
          if (viewMode === "substantiate") {
            renderBoxes();
          }
        }
        console.warn("[substantiate] draft_preview_failed", error);
      } catch {
        // ignore
      }
    }
  };

  let draftRail: null | { update: () => void; destroy: () => void; setVisible?: (next: boolean) => void } = null;
  let draftRailVisible = true;
  const acceptPendingItem = (detail: { n?: number; from?: number; to?: number }) => {
    const n = Number.isFinite(detail.n) ? Number(detail.n) : null;
    const from = Number.isFinite(detail.from) ? Number(detail.from) : null;
    const to = Number.isFinite(detail.to) ? Number(detail.to) : null;

    const entries = Object.entries(pendingByView as any) as Array<[SidebarViewId, any]>;
    for (const [view, apply] of entries) {
      if (!apply) continue;
      if (apply.kind === "replaceRange") {
        const match = (from !== null && to !== null) ? (apply.from === from && apply.to === to) : true;
        if (!match) continue;
        applyRangeAsTransaction(
          apply.from,
          apply.to,
          apply.text,
          view === "substantiate"
            ? { source: "substantiate", n: (apply as any).n ?? null, anchorInsertions: (apply as any).anchorInsertions }
            : undefined
        );
        if (view === "substantiate") {
          dropSubstantiateByRange(apply.from, apply.to);
        }
        (pendingByView as any)[view] = null;
        pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
        syncDraftPreview();
        renderBoxes();
        return;
      }
      if (apply.kind === "batchReplace") {
        const items = Array.isArray(apply.items) ? apply.items : [];
        const match =
          (from !== null && to !== null) ? items.find((it: any) => it.from === from && it.to === to) :
          (n !== null) ? items.find((it: any) => it.n === n) :
          null;
        if (!match) continue;
        applyRangeAsTransaction(
          match.from,
          match.to,
          match.text,
          view === "substantiate"
            ? { source: "substantiate", n: (match as any).n ?? null, anchorInsertions: (match as any).anchorInsertions }
            : undefined
        );
        if (view === "substantiate") {
          dropSubstantiateByRange(match.from, match.to);
        }
        const nextItems = items.filter((it: any) => it !== match);
        (pendingByView as any)[view] = nextItems.length ? { ...apply, items: nextItems } : null;
        pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
        syncDraftPreview();
        renderBoxes();
        return;
      }
    }
  };

  const acceptAllPending = () => {
    if (!pending || viewMode === "chat" || viewMode === "dictionary" || viewMode === "sources") return;
    applyPending(viewMode === "substantiate" ? { source: "substantiate" } : undefined);
    (pendingByView as any)[viewMode] = null;
    pending = null;
    if (viewMode === "substantiate") {
      markSubstantiateSuppressedAll();
      substantiateResults = [];
    }
    syncDraftPreview();
    renderBoxes();
  };

  const rejectAllPending = () => {
    if (viewMode === "chat" || viewMode === "dictionary" || viewMode === "sources") return;
    (pendingByView as any)[viewMode] = null;
    pending = null;
    if (viewMode === "substantiate") {
      markSubstantiateSuppressedAll();
      substantiateResults = [];
    }
    syncDraftPreview();
    renderBoxes();
  };
  const rejectPendingItem = (detail: { n?: number; from?: number; to?: number }) => {
    const n = Number.isFinite(detail.n) ? Number(detail.n) : null;
    const from = Number.isFinite(detail.from) ? Number(detail.from) : null;
    const to = Number.isFinite(detail.to) ? Number(detail.to) : null;

    const entries = Object.entries(pendingByView as any) as Array<[SidebarViewId, any]>;
    for (const [view, apply] of entries) {
      if (!apply) continue;
      if (apply.kind === "replaceRange") {
        const match = (from !== null && to !== null) ? (apply.from === from && apply.to === to) : true;
        if (!match) continue;
        if (view === "substantiate") {
          dropSubstantiateByRange(apply.from, apply.to);
        }
        (pendingByView as any)[view] = null;
        pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
        syncDraftPreview();
        renderBoxes();
        return;
      }
      if (apply.kind === "batchReplace") {
        const items = Array.isArray(apply.items) ? apply.items : [];
        const match =
          (from !== null && to !== null) ? items.find((it: any) => it.from === from && it.to === to) :
          (n !== null) ? items.find((it: any) => it.n === n) :
          null;
        if (!match) continue;
        if (view === "substantiate") {
          dropSubstantiateByRange(match.from, match.to);
        }
        const nextItems = items.filter((it: any) => it !== match);
        (pendingByView as any)[view] = nextItems.length ? { ...apply, items: nextItems } : null;
        pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
        syncDraftPreview();
        renderBoxes();
        return;
      }
    }
  };

  const mountDraftRail = () => {
    const appRoot = getAppRoot();
    if (!appRoot) return null as null | { update: () => void; destroy: () => void };
    const mountEl =
      (appRoot.querySelector(".leditor-a4-zoom-content") as HTMLElement | null) ??
      (appRoot.querySelector(".leditor-a4-zoom") as HTMLElement | null) ??
      (appRoot.querySelector(".leditor-a4-canvas") as HTMLElement | null) ??
      appRoot;

    const existing = document.getElementById(DRAFT_RAIL_ID);
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = DRAFT_RAIL_ID;
    overlay.className = "leditor-ai-draft-rail is-hidden";
    overlay.setAttribute("aria-hidden", "true");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("leditor-ai-draft-rail__lines");
    svg.setAttribute("aria-hidden", "true");

    const rail = document.createElement("div");
    rail.className = "leditor-ai-draft-rail__rail";
    overlay.append(svg, rail);
    mountEl.appendChild(overlay);

    let raf = 0;

    const clearSvg = () => {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    };

    const sanitize = (value: string, maxLen: number) => {
      const s = String(value || "").replace(/\s+/g, " ").trim();
      if (s.length <= maxLen) return s;
      return `${s.slice(0, maxLen - 1)}…`;
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    const acceptOne = (n: number) => {
      acceptPendingItem({ n });
      schedule();
    };

    const rejectOne = (n: number) => {
      rejectPendingItem({ n });
      schedule();
    };

    const update = () => {
      if (!draftRailVisible || !open || !pending || pending.kind !== "batchReplace") {
        overlay.classList.add("is-hidden");
        rail.replaceChildren();
        clearSvg();
        return;
      }
      const batch = pending;
      const show = batch.items.length > 0;
      overlay.classList.toggle("is-hidden", !show);
      if (!show) {
        rail.replaceChildren();
        clearSvg();
        return;
      }
      try {
        const root = getAppRoot();
        root?.classList.add("leditor-app--feedback-rail-open");
      } catch {
        // ignore
      }

      const editor = editorHandle.getEditor();
      const view = (editor as any)?.view;
      if (!view) return;
      const overlayRect = overlay.getBoundingClientRect();
      const stackEl = appRoot.querySelector<HTMLElement>(".leditor-page-stack") ?? null;
      const stackRect = stackEl?.getBoundingClientRect?.() ?? null;
      const railLeftX = Math.round((stackRect?.right ?? overlayRect.left + 680) - overlayRect.left + 18);

      rail.replaceChildren();
      clearSvg();
      const sorted = [...batch.items].sort((a, b) => a.from - b.from);
      const minGap = 10;
      let cursorY = -Infinity;

      for (const it of sorted) {
        const coords = view.coordsAtPos(Math.max(0, Math.min(view.state.doc.content.size, it.to)));
        const anchorX = Math.round(coords.right - overlayRect.left);
        const anchorY = Math.round(((coords.top + coords.bottom) / 2) - overlayRect.top);

        const card = document.createElement("div");
        card.className = "leditor-ai-draft-rail__card";
        card.style.left = `${Math.max(12, railLeftX)}px`;
        card.style.top = `0px`;

        const header = document.createElement("div");
        header.className = "leditor-ai-draft-rail__cardHeader";
        const badge = document.createElement("span");
        badge.className = "leditor-ai-draft-rail__badge";
        badge.textContent = "AI";
        const title = document.createElement("span");
        title.className = "leditor-ai-draft-rail__title";
        title.textContent = "Draft update";
        const meta = document.createElement("span");
        meta.className = "leditor-ai-draft-rail__meta";
        meta.textContent = it.n ? `P${it.n}` : "";
        header.append(badge, title, meta);

        const body = document.createElement("div");
        body.className = "leditor-ai-draft-rail__body";
        body.textContent = sanitize(it.text, 420);

        const actions = document.createElement("div");
        actions.className = "leditor-ai-draft-rail__actions";
        const rejectBtnEl = document.createElement("button");
        rejectBtnEl.type = "button";
        rejectBtnEl.className = "leditor-ai-draft-rail__btn";
        rejectBtnEl.textContent = "Reject";
        rejectBtnEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          rejectOne(it.n);
        });
        const acceptBtnEl = document.createElement("button");
        acceptBtnEl.type = "button";
        acceptBtnEl.className = "leditor-ai-draft-rail__btn leditor-ai-draft-rail__btn--primary";
        acceptBtnEl.textContent = "Accept";
        acceptBtnEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          acceptOne(it.n);
        });
        actions.append(rejectBtnEl, acceptBtnEl);

        card.append(header, body, actions);
        rail.appendChild(card);

        const h = Math.ceil(card.getBoundingClientRect().height || 120);
        const desiredY = anchorY - 14;
        const y = Math.max(desiredY, cursorY + minGap);
        cursorY = y + h;
        card.style.top = `${Math.max(0, y)}px`;

        const endX = Math.max(0, railLeftX - 4);
        const endY = Math.max(0, y + 18);
        const elbowX = Math.max(anchorX + 18, endX - 18);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${anchorX} ${anchorY} L ${elbowX} ${anchorY} L ${elbowX} ${endY} L ${endX} ${endY}`);
        svg.appendChild(path);
      }
    };

    const onScroll = () => schedule();
    appRoot.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    editorHandle.on("change", schedule);
    editorHandle.on("selectionChange", schedule);

    schedule();

    return {
      update: schedule,
      setVisible(next: boolean) {
        draftRailVisible = Boolean(next);
        schedule();
      },
      destroy() {
        try {
          if (raf) window.cancelAnimationFrame(raf);
        } catch {
          // ignore
        }
        try {
          appRoot.removeEventListener("scroll", onScroll);
        } catch {
          // ignore
        }
        try {
          window.removeEventListener("resize", schedule);
        } catch {
          // ignore
        }
        try {
          editorHandle.off("change", schedule);
          editorHandle.off("selectionChange", schedule);
        } catch {
          // ignore
        }
        try {
          overlay.remove();
        } catch {
          // ignore
        }
      }
    };
  };

  let feedbackHub: null | { update: () => void; destroy: () => void; setMode: (mode: FeedbackHubMode) => void } = null;

  const mountFeedbackHub = () => {
    const appRoot = getAppRoot();
    if (!appRoot) return null;
    const mountEl =
      (appRoot.querySelector(".leditor-a4-zoom-content") as HTMLElement | null) ??
      (appRoot.querySelector(".leditor-a4-zoom") as HTMLElement | null) ??
      (appRoot.querySelector(".leditor-a4-canvas") as HTMLElement | null) ??
      appRoot;

    const existing = document.getElementById(FEEDBACK_HUB_ID);
    if (existing) existing.remove();

    let mode: FeedbackHubMode = loadFeedbackHubMode();

    const hub = document.createElement("div");
    hub.id = FEEDBACK_HUB_ID;
    hub.className = "leditor-feedback-hub is-hidden";
    hub.setAttribute("aria-hidden", "true");

    const title = document.createElement("div");
    title.className = "leditor-feedback-hub__title";
    title.textContent = "Feedbacks";

    const tabs = document.createElement("div");
    tabs.className = "leditor-feedback-hub__tabs";
    const mkTab = (label: string, value: FeedbackHubMode) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "leditor-feedback-hub__tab";
      b.textContent = label;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setMode(value);
      });
      return b;
    };
    const tabEdits = mkTab("Edits", "edits");
    const tabSources = mkTab("Sources", "sources");
    const tabAll = mkTab("All", "all");
    tabs.append(tabEdits, tabSources, tabAll);

    const counts = document.createElement("div");
    counts.className = "leditor-feedback-hub__counts";

    const actions = document.createElement("div");
    actions.className = "leditor-feedback-hub__actions";

    const btnRejectAll = document.createElement("button");
    btnRejectAll.type = "button";
    btnRejectAll.className = "leditor-feedback-hub__btn";
    btnRejectAll.textContent = "Reject all";
    btnRejectAll.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (mode === "edits" || mode === "all") {
        clearPending();
        addMessage("system", "Rejected all edits.");
      }
      if (mode === "sources" || mode === "all") {
        try {
          editorHandle.execCommand("ai.sourceChecks.dismissAllFixes");
          addMessage("system", "Dismissed all source fixes.");
        } catch {
          // ignore
        }
      }
      editorHandle.focus();
      schedule();
    });

    const btnApplyAll = document.createElement("button");
    btnApplyAll.type = "button";
    btnApplyAll.className = "leditor-feedback-hub__btn leditor-feedback-hub__btn--primary";
    btnApplyAll.textContent = "Apply all";
    btnApplyAll.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if ((mode === "edits" || mode === "all") && pending) {
          applyPending();
          clearPending();
          addMessage("system", "Applied all edits.");
        }
      } catch (error) {
        addMessage("assistant", `Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        if (mode === "sources" || mode === "all") {
          editorHandle.execCommand("ai.sourceChecks.applyAllFixes");
          addMessage("system", "Applied all source fixes.");
        }
      } catch {
        // ignore
      } finally {
        editorHandle.focus();
        schedule();
      }
    });

    actions.append(btnRejectAll, btnApplyAll);
    hub.append(title, tabs, counts, actions);
    mountEl.appendChild(hub);

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    const updateTabs = () => {
      tabEdits.classList.toggle("is-active", mode === "edits");
      tabSources.classList.toggle("is-active", mode === "sources");
      tabAll.classList.toggle("is-active", mode === "all");
    };

    const update = () => {
      const sourceCount = getSourceChecksThread().items?.length ?? 0;
      const editsCount = pending && pending.kind === "batchReplace" ? pending.items.length : pending ? 1 : 0;
      counts.textContent = `${editsCount ? `${editsCount} edit(s)` : ""}${editsCount && sourceCount ? " • " : ""}${sourceCount ? `${sourceCount} source check(s)` : ""}` || "";

      const visible = open && (Boolean(pending) || sourceCount > 0);
      hub.classList.toggle("is-hidden", !visible);
      hub.setAttribute("aria-hidden", visible ? "false" : "true");
      updateTabs();

      try {
        const rect = mountEl.getBoundingClientRect();
        const stackEl = appRoot.querySelector<HTMLElement>(".leditor-page-stack") ?? null;
        const stackRect = stackEl?.getBoundingClientRect?.() ?? null;
        const leftPx = Math.round((stackRect?.right ?? rect.left + 680) - rect.left + 18);
        hub.style.left = `${Math.max(12, leftPx)}px`;
        hub.style.top = "12px";
      } catch {
        // ignore
      }

            // Mode effects (source checks are shown inside the Agent sidebar, not in a document rail).
      if (mode === "sources") {
        draftRailVisible = false;
      } else {
        draftRailVisible = true;
      }
      try {
        draftRail?.setVisible?.(draftRailVisible);
      } catch {
        // ignore
      }
      try {
        const root = getAppRoot();
        const anyOpen = draftRailVisible;
        root?.classList.toggle("leditor-app--feedback-rail-open", anyOpen);
      } catch {
        // ignore
      }
    };

    const setMode = (next: FeedbackHubMode) => {
      mode = next;
      saveFeedbackHubMode(mode);
      schedule();
    };

    const onScroll = () => schedule();
    appRoot.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    editorHandle.on("change", schedule);
    editorHandle.on("selectionChange", schedule);
    const unsub = subscribeSourceChecksThread(() => schedule());

    schedule();

    return {
      update: schedule,
      setMode,
      destroy() {
        try {
          if (raf) window.cancelAnimationFrame(raf);
        } catch {
          // ignore
        }
        try {
          unsub();
        } catch {
          // ignore
        }
        try {
          appRoot.removeEventListener("scroll", onScroll);
        } catch {
          // ignore
        }
        try {
          window.removeEventListener("resize", schedule);
        } catch {
          // ignore
        }
        try {
          editorHandle.off("change", schedule);
          editorHandle.off("selectionChange", schedule);
        } catch {
          // ignore
        }
        try {
          hub.remove();
        } catch {
          // ignore
        }
      }
    };
  };

  const applyPending = (meta?: { source?: string }) => {
    if (!pending) return;
    const editor = editorHandle.getEditor();
    if (pending.kind === "replaceRange") {
      applyRangeAsTransaction(pending.from, pending.to, pending.text, meta);
      return;
    }
    if (pending.kind === "setDocument") {
      editor.commands.setContent(pending.doc as any);
      editor.commands.focus();
      return;
    }
    if (pending.kind === "insertAtCursor") {
      editor.chain().focus().insertContent(pending.text).run();
      return;
    }
    if (pending.kind === "batchReplace") {
      const items = [...pending.items].sort((a, b) => b.from - a.from);
      for (const item of items) {
        const current = editor.state.doc.textBetween(item.from, item.to, "\n").trim();
        if (current !== item.originalText.trim()) {
          throw new Error(`Document changed since draft for paragraph ${item.n}. Re-run the agent.`);
        }
      }
      const hasAnchorInsertions = items.some(
        (it: any) => Array.isArray(it.anchorInsertions) && it.anchorInsertions.length > 0
      );
      if (hasAnchorInsertions) {
        for (const item of items) {
          applyRangeAsTransaction(item.from, item.to, item.text, {
            ...(meta ?? {}),
            anchorInsertions: (item as any).anchorInsertions
          });
        }
        return;
      }
      applyBatchAsTransaction(items.map((it) => ({ from: it.from, to: it.to, text: it.text })), meta);
      return;
    }
    throw new Error(`AgentSidebar: unknown apply kind "${(pending as any).kind}"`);
  };

  const findSentenceStartInBlock = (state: any, blockFrom: number, pos: number): number => {
    const doc = state.doc;
    const left = doc.textBetween(blockFrom, pos, "\n");
    if (!left) return blockFrom;
    const re = /[.!?;]\s+(?=[“"'\(\[]?[A-Z])/g;
    let lastEnd = -1;
    for (const m of left.matchAll(re)) {
      const idx = typeof m.index === "number" ? m.index : -1;
      if (idx < 0) continue;
      const prev = left.slice(Math.max(0, idx - 3), idx + 1).toLowerCase();
      const next = left.slice(idx + 1).trimStart();
      if ((prev.endsWith("p.") || prev.endsWith("pp.")) && /^\d/.test(next)) continue;
      lastEnd = idx + m[0].length;
    }
    return lastEnd >= 0 ? blockFrom + lastEnd : blockFrom;
  };

  const rangeHasCitationLikeMarks = (state: any, from: number, to: number): boolean => {
    let found = false;
    state.doc.nodesBetween(from, to, (node: any) => {
      if (found) return false;
      if (!node) return true;
      if (String(node.type?.name ?? "") === "citation") {
        found = true;
        return false;
      }
      if (!node.isText || !Array.isArray(node.marks)) return true;
      for (const m of node.marks) {
        if (isCitationLikeMark(m)) {
          found = true;
          return false;
        }
      }
      return true;
    });
    return found;
  };

  const getParagraphNumberForRange = (from: number, to: number): number | null => {
    const ranges = listParagraphRanges();
    const hit = ranges.find((p) => from >= p.from && to <= p.to);
    return hit ? hit.n : null;
  };

  const buildSourceRewriteDraft = (key: string, rewrite: string) => {
    const editor = editorHandle.getEditor();
    const view = (editor as any)?.view;
    const state = view?.state;
    if (!state) return null;
    const sc = getSourceCheckState(state);
    const item = sc?.items?.find((it) => String(it?.key) === String(key)) ?? null;
    if (!item) return null;
    const docSize = state.doc.content.size;
    const from = Math.max(0, Math.min(docSize, Math.floor(item.from)));
    const to = Math.max(0, Math.min(docSize, Math.floor(item.to)));
    if (to <= from) return null;

    const $pos = state.doc.resolve(from);
    let depth = $pos.depth;
    while (depth > 0 && !$pos.node(depth).isTextblock) depth -= 1;
    const blockNode = $pos.node(depth);
    const blockPos = $pos.before(depth);
    const blockFrom = blockPos + 1;
    const blockTo = blockFrom + blockNode.content.size;
    if (blockTo <= blockFrom) return null;

    const sentenceStart = findSentenceStartInBlock(state, blockFrom, from);
    const inBlock = sc?.items?.filter((x: any) => x && x.from >= blockFrom && x.to <= blockTo) ?? [];
    const inSentence = inBlock.filter((x: any) => x.from >= sentenceStart);
    const firstCitationFrom = inSentence.reduce(
      (min: number, x: any) => Math.min(min, Math.floor(x.from)),
      Number.POSITIVE_INFINITY
    );
    if (!Number.isFinite(firstCitationFrom) || firstCitationFrom <= sentenceStart) return null;
    if (rangeHasCitationLikeMarks(state, sentenceStart, firstCitationFrom)) return null;

    const insert = rewrite.endsWith(" ") ? rewrite : `${rewrite} `;
    const originalText = state.doc.textBetween(sentenceStart, firstCitationFrom, "\n");
    return { from: sentenceStart, to: firstCitationFrom, text: insert, originalText };
  };

  const queueSourceRewriteDraft = (args: { key: string; rewrite: string; paragraphN?: number }) => {
    const key = String(args.key || "").trim();
    const rewrite = String(args.rewrite || "").trim();
    if (!key || !rewrite) return;
    const draft = buildSourceRewriteDraft(key, rewrite);
    if (!draft) {
      addMessage("assistant", "Unable to insert rewrite: could not resolve a safe target range.");
      return;
    }
    const paragraphN = Number.isFinite(args.paragraphN) ? Math.max(1, Math.floor(args.paragraphN!)) : null;
    const current = (pendingByView as any).sources as AgentRunResult["apply"] | null;
    let nextApply: AgentRunResult["apply"];
    if (!current) {
      nextApply = { kind: "replaceRange", from: draft.from, to: draft.to, text: draft.text };
    } else if (current.kind === "replaceRange") {
      const existingN = getParagraphNumberForRange(current.from, current.to) ?? paragraphN ?? 1;
      const items = [
        {
          n: existingN,
          from: current.from,
          to: current.to,
          text: current.text,
          originalText: editorHandle.getEditor().state.doc.textBetween(current.from, current.to, "\n")
        },
        {
          n: paragraphN ?? existingN,
          from: draft.from,
          to: draft.to,
          text: draft.text,
          originalText: draft.originalText
        }
      ];
      nextApply = { kind: "batchReplace", items };
    } else if (current.kind === "batchReplace") {
      const items = Array.isArray(current.items) ? [...current.items] : [];
      const existing = items.find((it) => it.from === draft.from && it.to === draft.to) ?? null;
      if (existing) {
        existing.text = draft.text;
        existing.originalText = draft.originalText;
        if (paragraphN) existing.n = paragraphN;
      } else {
        items.push({
          n: paragraphN ?? (getParagraphNumberForRange(draft.from, draft.to) ?? 1),
          from: draft.from,
          to: draft.to,
          text: draft.text,
          originalText: draft.originalText
        });
      }
      nextApply = { kind: "batchReplace", items };
    } else {
      nextApply = current;
    }
    pendingByView = { ...pendingByView, sources: nextApply };
    pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
    syncDraftPreview();
    setStatus("Draft ready • Review inline in the document.");
  };

  const queueAllSourceRewriteDrafts = (items: any[]) => {
    const byParagraph = new Map<number, any>();
    for (const it of items) {
      const key = typeof it?.key === "string" ? String(it.key) : "";
      const verdict = it?.verdict === "verified" ? "verified" : "needs_review";
      const rewrite = typeof it?.claimRewrite === "string" ? String(it.claimRewrite).trim() : "";
      const paragraphN = Number.isFinite(it?.paragraphN) ? Math.max(1, Math.floor(it.paragraphN)) : 0;
      if (!key || !paragraphN) continue;
      if (verdict === "verified") continue;
      if (!rewrite) continue;
      if (byParagraph.has(paragraphN)) continue;
      byParagraph.set(paragraphN, { key, rewrite, paragraphN });
    }
    const ordered = [...byParagraph.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    for (const entry of ordered) {
      queueSourceRewriteDraft(entry);
    }
  };

  const clearSourceRewriteDrafts = () => {
    (pendingByView as any).sources = null;
    pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
    syncDraftPreview();
  };

  type RunOverrides = {
    actionId?: AgentActionId;
    selection?: { from: number; to: number };
  };

  const run = async (overrides?: RunOverrides) => {
    if (destroyed) return;
    let instruction = input.value.trim();
    const modeAction: ActionMode = actionMode;
    const overrideAction = overrides?.actionId ?? null;
    const overrideSelection = overrides?.selection ?? null;
    if (!instruction) {
      if (modeAction === "check_sources") {
        setViewMode("sources");
        await runCheckSources();
        return;
      }
      if (modeAction === "substantiate") {
        await runSubstantiate();
        return;
      }
      if (modeAction === "clear_checks") {
        try {
          editorHandle.execCommand("ai.sourceChecks.clear");
        } catch {
          try {
            editorHandle.execCommand("ClearSourceChecks");
          } catch {
            // ignore
          }
        }
        addMessage("system", "Cleared source checks.");
        return;
      }
      if (modeAction !== "auto") {
        await applyActionTemplate(modeAction);
        return;
      }
      return;
    }

    const rawInstruction = instruction;
    const inlineSlash = findInlineSlashCommand(instruction);
    let forcedAction: AgentActionId | null = null;
    let actionFromText: AgentActionId | null = null;

    if (overrideAction) {
      forcedAction = overrideAction;
      actionFromText = overrideAction;
    } else if (inlineSlash) {
      const normalizedAll = normalizeSlash(instruction);
      const isOnlyCommand = inlineSlash.start === 0 && normalizeSlash(inlineSlash.token) === normalizedAll;
      if (isOnlyCommand) {
        addMessage("user", instruction);
        input.value = "";
        autoResizeInput();
        controller.runAction(inlineSlash.id);
        return;
      }
      if (inlineSlash.id === "check_sources" || inlineSlash.id === "clear_checks") {
        addMessage("user", instruction);
        input.value = "";
        autoResizeInput();
        controller.runAction(inlineSlash.id);
        return;
      }
      forcedAction = inlineSlash.id;
      const prompt = getActionPrompt(inlineSlash.id);
      const before = instruction.slice(0, inlineSlash.start).trimEnd();
      const after = instruction.slice(inlineSlash.end).trimStart();
      if (!before && /^\d/.test(after)) {
        const m =
          after.match(
            /^(?:p(?:aragraph)?\s*)?\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?(?:\s*,\s*\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)*/i
          ) ?? null;
        const idxPart = m ? m[0] : "";
        const rest = idxPart ? after.slice(idxPart.length).trim() : after;
        instruction = [idxPart.trim(), prompt, rest].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      } else {
        instruction = [before, prompt, after].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      }
    } else {
      actionFromText = detectActionFromInstruction(rawInstruction);
      if (actionFromText) {
        forcedAction = actionFromText;
      } else if (modeAction !== "auto") {
        forcedAction = modeAction;
      }
      if (
        forcedAction &&
        forcedAction !== "check_sources" &&
        forcedAction !== "clear_checks" &&
        !actionFromText
      ) {
        const prompt = getActionPrompt(forcedAction);
        const trimmed = instruction.trim();
        const m =
          trimmed.match(
            /^(?:p(?:aragraph)?\s*)?\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?(?:\s*,\s*\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)*/i
          ) ?? null;
        if (m?.[0]) {
          const idxPart = m[0];
          const rest = trimmed.slice(idxPart.length).trim();
          instruction = [idxPart.trim(), prompt, rest].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        } else {
          instruction = [prompt, trimmed].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        }
      }
    }

    if (forcedAction === "substantiate") {
      addMessage("user", rawInstruction);
      input.value = "";
      autoResizeInput();
      const parsedTargets = parseTargetsFromText(rawInstruction);
      if (parsedTargets.kind === "paragraphs" || parsedTargets.kind === "section") {
        await runSubstantiateForParagraphs(parsedTargets.indices);
      } else {
        await runSubstantiate();
      }
      return;
    }

    if (forcedAction === "clear_checks") {
      try {
        editorHandle.execCommand("ai.sourceChecks.clear");
      } catch {
        try {
          editorHandle.execCommand("ClearSourceChecks");
        } catch {
          // ignore
        }
      }
      addMessage("system", "Cleared source checks.");
      return;
    }

    if (forcedAction === "check_sources") {
      setViewMode("sources");
      addMessage("user", instruction);
      input.value = "";
      autoResizeInput();
      updateInputOverlay();
      const parsedTargets = parseTargetsFromText(instruction);
      if (parsedTargets.kind === "paragraphs" || parsedTargets.kind === "section") {
        await runCheckSourcesForParagraphs(parsedTargets.indices);
      } else {
        await runCheckSources();
      }
      return;
    }

    addMessage("user", instruction);
    input.value = "";
    autoResizeInput();
    updateInputOverlay();
    setInflight(true);
    try {
      const preservePending = Boolean(sectionBatchMode && forcedAction && isSectionAction(forcedAction));
      if (!preservePending) {
        clearPending();
      }
      let streamMessageId: string | null = null;
      let streamBuffer = "";
      const progress = (event: AgentProgressEvent | string) => {
        if (typeof event === "string") {
          addMessage("system", event);
          return;
        }
        switch (event.kind) {
          case "status":
            addMessage("system", event.message);
            break;
          case "tool":
            addMessage("system", `Tool: ${event.tool}`);
            break;
          case "stream": {
            if (!event.delta) return;
            if (!streamMessageId) {
              streamMessageId = addMessage("assistant", "");
            }
            streamBuffer += event.delta;
            if (streamMessageId) updateMessage(streamMessageId, streamBuffer.trimStart());
            break;
          }
          case "error":
            addMessage("assistant", `Error: ${event.message}`);
            break;
          default:
            break;
        }
      };
      const request: AgentRunRequest = {
        instruction,
        actionId: forcedAction ?? undefined,
        ...(overrideSelection ? { selection: overrideSelection } : {})
      };
      abortController = new AbortController();
      activeRequestId = makeRequestId();
      pendingActionId = forcedAction ?? null;
      if (pendingActionId && isSectionAction(pendingActionId)) {
        console.info("[agent][sections] input", {
          requestId: activeRequestId,
          action: pendingActionId,
          instruction
        });
      }
      const result = await options.runAgent(request, editorHandle, progress, abortController.signal, activeRequestId);
      if (abortController.signal.aborted) {
        addMessage("assistant", "Cancelled.");
        return;
      }
      if (result.meta && (result.meta.provider || result.meta.model || typeof result.meta.ms === "number")) {
        lastApiMeta = { ...result.meta, ts: Date.now() };
        const parts = [
          result.meta.provider ? `provider=${String(result.meta.provider)}` : "",
          result.meta.model ? `model=${String(result.meta.model)}` : "",
          typeof result.meta.ms === "number" ? `ms=${Math.max(0, Math.round(result.meta.ms))}` : ""
        ].filter(Boolean);
        if (parts.length) {
          addMessage("system", `API OK • ${parts.join(" • ")}`);
        }
      }
      pending = result.apply ?? null;
      const autoApply = Boolean(pending && (pending as any).autoApply);
      if (pending && autoApply) {
        const label = pendingActionId ? actionLabel(pendingActionId) : "Section";
        const prevPending = pending;
        let focusFrom: number | null = null;
        if (pending.kind === "replaceRange") {
          focusFrom = pending.from;
        } else if (pending.kind === "batchReplace" && pending.items.length) {
          focusFrom = pending.items.reduce((min, it) => Math.min(min, it.from), pending.items[0]!.from);
        }
        try {
          applyPending();
          setStatus(`${label} applied.`);
          if (focusFrom != null) {
            focusAtPos(focusFrom);
          }
        } catch (error) {
          addMessage("assistant", `Error: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          pending = prevPending;
          pendingActionId = null;
          pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
          syncDraftPreview();
          renderBoxes();
          try {
            draftRail?.update();
          } catch {
            // ignore
          }
        }
        return;
      }
      const isBatchSection = Boolean(sectionBatchMode && pendingActionId && isSectionAction(pendingActionId));
      if (pending && isBatchSection) {
        const merged = mergeSectionApply((pendingByView as any).sections ?? null, pending);
        pendingByView = { ...pendingByView, sections: merged };
        pending = viewMode === "sections" ? merged : pending;
        const count = merged.kind === "batchReplace" ? merged.items.length : 1;
        const label = pendingActionId ? actionLabel(pendingActionId) : "Section";
        setStatus(`Queued ${label} • ${count} section draft(s) queued.`);
        syncDraftPreview();
        renderBoxes();
        try {
          draftRail?.update();
        } catch {
          // ignore
        }
        if (pendingActionId && isSectionAction(pendingActionId)) {
          console.info("[agent][sections] output", {
            requestId: activeRequestId,
            action: pendingActionId,
            applyKind: merged?.kind ?? null,
            assistantText: result.assistantText ?? ""
          });
        }
      } else if (pending) {
        const viewKey =
          pendingActionId && isSectionAction(pendingActionId)
            ? ("sections" as SidebarViewId)
            : (pendingActionId as SidebarViewId | null);
        if (viewKey) {
          pendingByView = { ...pendingByView, [viewKey]: pending };
        }
        const applied =
          viewKey === "sections"
            ? pending
            : viewMode === "chat"
              ? null
              : ((pendingByView as any)[viewMode] ?? pending);
        if (viewKey && viewKey !== viewMode) {
          setViewMode(viewKey as SidebarViewId);
        }
        if (applied) {
          const count = applied.kind === "batchReplace" ? applied.items.length : 1;
          setStatus(`Draft ready • ${count} change(s). Review inline in the document.`);
          syncDraftPreview();
          try {
            draftRail?.update();
          } catch {
            // ignore
          }
        } else {
          pending = null;
        }
        pending = applied;
        if (pendingActionId && isSectionAction(pendingActionId)) {
          console.info("[agent][sections] output", {
            requestId: activeRequestId,
            action: pendingActionId,
            applyKind: pending?.kind ?? null,
            assistantText: result.assistantText ?? ""
          });
        }
      } else {
        const finalText = (result.assistantText || streamBuffer || "(no response)").trim();
        if (streamMessageId) {
          updateMessage(streamMessageId, finalText);
        } else {
          addMessage("assistant", finalText);
        }
        appendAgentHistoryMessage({ role: "assistant", content: finalText });
        if (pendingActionId && isSectionAction(pendingActionId)) {
          console.info("[agent][sections] output", {
            requestId: activeRequestId,
            action: pendingActionId,
            applyKind: null,
            assistantText: finalText
          });
        }
      }
    } catch (error) {
      addMessage("assistant", `Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      abortController = null;
      activeRequestId = null;
      setInflight(false);
      editorHandle.focus();
    }
  };

  const listParagraphRanges = () => {
    const editor = editorHandle.getEditor();
    const targets: Array<{ n: number; from: number; to: number }> = [];
    const excludedParentTypes = new Set(["tableCell", "tableHeader", "table_cell", "table_header", "footnoteBody"]);
    let n = 0;
    editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node: any, pos: number, parent: any) => {
      if (!node?.isTextblock) return true;
      if (node.type?.name === "doc") return true;
      if (node.type?.name === "heading") return true;
      const parentName = parent?.type?.name;
      if (parentName && excludedParentTypes.has(parentName)) return true;
      const from = pos + 1;
      const to = pos + node.nodeSize - 1;
      n += 1;
      targets.push({ n, from, to });
      return true;
    });
    return targets;
  };

  const buildSectionToParagraphIndices = (): Map<string, number[]> => {
    const editor = editorHandle.getEditor();
    const excludedParentTypes = new Set(["tableCell", "tableHeader", "table_cell", "table_header", "footnoteBody"]);
    const sectionToIndices = new Map<string, number[]>();
    const headingCounters: number[] = [];
    let currentSectionNumber = "";
    let paragraphN = 0;

    const bumpHeading = (levelRaw: unknown): string => {
      const level = Math.max(1, Math.min(6, Number(levelRaw ?? 1) || 1));
      while (headingCounters.length < level) headingCounters.push(0);
      headingCounters[level - 1] += 1;
      for (let i = level; i < headingCounters.length; i += 1) headingCounters[i] = 0;
      return headingCounters.slice(0, level).join(".");
    };

    editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node: any, _pos: number, parent: any) => {
      if (!node?.isTextblock) return true;
      if (node.type?.name === "doc") return true;
      const parentName = parent?.type?.name;
      if (parentName && excludedParentTypes.has(parentName)) return true;
      if (node.type?.name === "heading") {
        currentSectionNumber = bumpHeading((node.attrs as any)?.level);
        if (!sectionToIndices.has(currentSectionNumber)) sectionToIndices.set(currentSectionNumber, []);
        return true;
      }
      if (node.type?.name === "heading") return true;
      paragraphN += 1;
      if (!currentSectionNumber) return true;
      const list = sectionToIndices.get(currentSectionNumber) ?? [];
      list.push(paragraphN);
      sectionToIndices.set(currentSectionNumber, list);
      return true;
    });

    return sectionToIndices;
  };

  const parseTargetsFromText = (
    raw: string
  ): { kind: "none" } | { kind: "paragraphs"; indices: number[] } | { kind: "section"; sectionNumber: string; indices: number[] } => {
    const text = String(raw ?? "");
    const sectionMatch =
      text.match(/\b(?:section|sec|§)\s*(\d+(?:\.\d+)*)\b/i) ??
      text.match(/\b(\d+(?:\.\d+)*)\s*(?:section|sec)\b/i);
    const sectionNumber = sectionMatch?.[1] ? String(sectionMatch[1]).replace(/\.$/, "") : "";
    if (sectionNumber) {
      const map = buildSectionToParagraphIndices();
      const indices = map.get(sectionNumber) ?? [];
      return { kind: "section", sectionNumber, indices };
    }

    const max = listParagraphRanges().length;
    if (max <= 0) return { kind: "none" };

    const explicit =
      text.match(
        /\b(?:p(?:aragraph)?s?|paras?)\s*(\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)(?:\s*,\s*\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)*\b/i
      )?.[0] ?? "";
    const pPrefix =
      text.match(
        /(?:^|\s)(p\d{1,5}(?:\s*(?:-|to)\s*p?\d{1,5})?)(?:\s*,\s*p?\d{1,5}(?:\s*(?:-|to)\s*p?\d{1,5})?)*(?=\s|$)/i
      )?.[0] ?? "";
    const leadingNumbers =
      text.match(
        /^(?:\s*[-–—*•]\s*)?(\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)(?:\s*,\s*\d{1,5}(?:\s*(?:-|to)\s*\d{1,5})?)*\b/i
      )?.[0] ?? "";

    const listRaw = (explicit || pPrefix || leadingNumbers).trim();
    if (!listRaw) return { kind: "none" };
    const normalized = listRaw.replace(/\b(?:paragraphs|paragraph|paras|para)\b/gi, "").replace(/\bp/gi, "").trim();
    const parts = normalized
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const indices = new Set<number>();
    for (const part of parts) {
      const range = part.match(/^(\d{1,5})\s*(?:-|to)\s*(\d{1,5})$/i);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const from = Math.min(a, b);
        const to = Math.max(a, b);
        for (let n = from; n <= to; n += 1) {
          if (n >= 1 && n <= max) indices.add(n);
        }
        continue;
      }
      const single = Number(part);
      if (!Number.isFinite(single)) continue;
      if (single >= 1 && single <= max) indices.add(single);
    }
    const list = Array.from(indices).sort((a, b) => a - b);
    return list.length ? { kind: "paragraphs", indices: list } : { kind: "none" };
  };

  const formatIndexSpec = (indices: number[]): string => {
    const list = Array.from(new Set(indices)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (list.length === 0) return "";
    if (list.length === 1) return String(list[0]);
    const contiguous = list.every((v, i) => i === 0 || v === list[i - 1]! + 1);
    return contiguous ? `${list[0]}-${list[list.length - 1]}` : list.join(",");
  };

  const getIndicesForCurrentSelectionOrCursor = (): { indices: number[]; from: number; to: number } | null => {
    const editor = editorHandle.getEditor();
    const sel = editor.state.selection;
    const ranges = listParagraphRanges();
    if (ranges.length === 0) return null;
    const from = sel.from;
    const to = sel.to;
    const selectionFrom = Math.min(from, to);
    const selectionTo = Math.max(from, to);
    if (selectionFrom !== selectionTo) {
      const indices = ranges.filter((p) => p.to >= selectionFrom && p.from <= selectionTo).map((p) => p.n);
      if (indices.length === 0) return null;
      return { indices, from: selectionFrom, to: selectionTo };
    }
    const cursorPos = selectionFrom;
    const at = ranges.find((p) => cursorPos >= p.from && cursorPos <= p.to) ?? ranges[ranges.length - 1]!;
    return { indices: [at.n], from: at.from, to: at.to };
  };

  const getSelectionRangeForAction = (): { from: number; to: number } | null => {
    const target = getIndicesForCurrentSelectionOrCursor();
    if (!target) return null;
    const ranges = listParagraphRanges();
    if (!ranges.length) return { from: target.from, to: target.to };
    const selected = ranges.filter((p) => target.indices.includes(p.n));
    if (!selected.length) return { from: target.from, to: target.to };
    const from = Math.min(...selected.map((p) => p.from));
    const to = Math.max(...selected.map((p) => p.to));
    return { from, to };
  };

  const getActionPrompt = (actionId: AgentActionId): string => {
    const actions: any = (agentActionPrompts as any)?.actions ?? {};
    const entry = actions[actionId];
    const prompt =
      entry && typeof entry.prompt === "string" && entry.prompt.trim()
        ? entry.prompt.trim()
        : "Refine for clarity. Keep citations/anchors unchanged.";
    return prompt;
  };

  const isSectionAction = (actionId: AgentActionId): boolean =>
    actionId === "abstract" ||
    actionId === "introduction" ||
    actionId === "methodology" ||
    actionId === "findings" ||
    actionId === "recommendations" ||
    actionId === "conclusion";

  const mergeSectionApply = (base: AgentApply | null, next: AgentApply): AgentApply => {
    if (!base) return next;
    if (base.kind !== "batchReplace" || next.kind !== "batchReplace") {
      return next;
    }
    const items = [...base.items];
    const seen = new Set(items.map((it) => `${it.from}:${it.to}`));
    for (const item of next.items) {
      const key = `${item.from}:${item.to}`;
      if (seen.has(key)) continue;
      items.push(item);
      seen.add(key);
    }
    items.sort((a, b) => a.n - b.n);
    return { kind: "batchReplace", items };
  };

  const applyActionTemplate = async (
    actionId: AgentActionId,
    options?: { selectionBlock?: boolean }
  ) => {
    if (isSectionAction(actionId)) {
      const prompt = getActionPrompt(actionId);
      input.value = prompt;
      await run();
      return;
    }
    if (options?.selectionBlock) {
      const range = getSelectionRangeForAction();
      if (!range) {
        addMessage("system", "Select text or place cursor in a paragraph, then run an action.");
        return;
      }
      const prompt = `${getActionPrompt(actionId)} Treat the selection as a single block. Preserve paragraph breaks; separate paragraphs with a blank line.`;
      input.value = prompt;
      await run({ actionId, selection: range });
      return;
    }
    const target = getIndicesForCurrentSelectionOrCursor();
    if (!target) {
      addMessage("system", "Select text or place cursor in a paragraph, then run an action.");
      return;
    }
    const spec = formatIndexSpec(target.indices);
    const prompt = getActionPrompt(actionId);
    input.value = `${spec} ${prompt}`;
    await run();
  };

  const runSectionBatch = async () => {
    if (sectionBatchMode) return;
    clearPending();
    sectionBatchMode = true;
    setViewMode("sections");
    addMessage(
      "system",
      "Drafting all sections. This may take a moment; drafts will be queued for review in the Sections tab."
    );
    const sequence: AgentActionId[] = [
      "abstract",
      "introduction",
      "methodology",
      "findings",
      "recommendations",
      "conclusion"
    ];
    try {
      for (const id of sequence) {
        setStatus(`Drafting ${actionLabel(id)}...`);
        await applyActionTemplate(id);
      }
    } finally {
      sectionBatchMode = false;
      pending = (pendingByView as any).sections ?? null;
      pendingActionId = null;
      const count = pending?.kind === "batchReplace" ? pending.items.length : pending ? 1 : 0;
      setStatus(
        count
          ? `Drafts queued • ${count} section change(s). Review inline in the document.`
          : "No section drafts created."
      );
      addMessage(
        "system",
        count ? "All section drafts are queued. Review them in the Sections tab." : "No section drafts were created."
      );
      syncDraftPreview();
      renderBoxes();
      try {
        draftRail?.update();
      } catch {
        // ignore
      }
    }
  };

  const collectAnchorsInRange = (from: number, to: number) => {
    const editor = editorHandle.getEditor();
    const anchors: Array<{
      key: string;
      from: number;
      to: number;
      text: string;
      title: string;
      href: string;
      dataKey: string;
      dataDqid: string;
      dataQuoteId: string;
    }> = [];
    const doc = editor.state.doc;
    const seen = new Set<string>();
    doc.nodesBetween(from, to, (node: any, pos: number) => {
      if (!node?.isText) return true;
      const marks = Array.isArray(node.marks) ? node.marks : [];
      const mark = marks.find((m: any) => isCitationLikeMark(m));
      if (!mark) return true;
      const attrs = mark.attrs ?? {};
      const hrefRaw = typeof attrs.href === "string" ? attrs.href : "";
      const href = hrefRaw || (attrs.dataDqid ? `dq://${attrs.dataDqid}` : "");
      const title = String(attrs.title ?? attrs.dataQuoteText ?? "");
      const dataKey = String(attrs.dataKey ?? attrs.itemKey ?? attrs.dataItemKey ?? "");
      const dataDqid = String(attrs.dataDqid ?? "");
      const dataQuoteId = String(attrs.dataQuoteId ?? "");
      const text = String(node.text ?? "");
      const baseId = dataKey || dataDqid || dataQuoteId || href || "anchor";
      const key = `${baseId}@${pos}`;
      if (seen.has(key)) return true;
      seen.add(key);
      anchors.push({
        key,
        from: pos,
        to: pos + node.nodeSize,
        text,
        title,
        href,
        dataKey,
        dataDqid,
        dataQuoteId
      });
      return true;
    });
    return anchors;
  };

  const collectCitationsInRange = (from: number, to: number) => {
    const editor = editorHandle.getEditor();
    const citations: Array<{
      key: string;
      from: number;
      to: number;
      text: string;
      title: string;
      href: string;
      dataKey: string;
      dataDqid: string;
      dataQuoteId: string;
    }> = [];
    const doc = editor.state.doc;
    doc.nodesBetween(from, to, (node: any, pos: number) => {
      if (!node) return true;
      if (String(node.type?.name ?? "") !== "citation") return true;
      const attrs = node.attrs ?? {};
      const title = typeof attrs.title === "string" ? attrs.title : "";
      const dqid = typeof attrs.dqid === "string" ? attrs.dqid : "";
      const href = dqid ? `dq://${dqid}` : "";
      const citationId = typeof attrs.citationId === "string" ? attrs.citationId : "";
      const items = Array.isArray(attrs.items) ? attrs.items : [];
      const itemKeys = items
        .map((it: any) => (typeof it?.itemKey === "string" ? it.itemKey : ""))
        .filter(Boolean)
        .join(",");
      const baseId = citationId || itemKeys || dqid || "citation";
      const key = `citation:${baseId}@${pos}`;
      const rendered = typeof attrs.renderedHtml === "string" ? String(attrs.renderedHtml) : "";
      const text = rendered ? rendered.replace(/<[^>]*>/g, "").trim() : "(citation)";
      citations.push({
        key,
        from: pos,
        to: pos + node.nodeSize,
        text,
        title: String(title ?? ""),
        href,
        dataKey: itemKeys,
        dataDqid: dqid,
        dataQuoteId: citationId
      });
      return true;
    });
    return citations;
  };

  const collectSourceRefsInRange = (from: number, to: number) => {
    return [...collectAnchorsInRange(from, to), ...collectCitationsInRange(from, to)];
  };

  const cssEscape = (value: string) => {
    const raw = String(value ?? "");
    const esc = (window as any).CSS?.escape;
    if (typeof esc === "function") return esc(raw);
    return raw.replace(/["\\]/g, "\\$&");
  };

  const findAnchorDomElement = (anchor: {
    from: number;
    text: string;
    href: string;
    dataKey: string;
    dataDqid: string;
    dataQuoteId: string;
  }): HTMLElement | null => {
    const editor = editorHandle.getEditor();
    const view = (editor as any)?.view;
    if (!view) return null;
    try {
      const domAt = view.domAtPos(anchor.from);
      const baseNode = domAt?.node as any;
      let el: HTMLElement | null = null;
      if (baseNode instanceof HTMLElement) el = baseNode;
      else if (baseNode?.parentElement) el = baseNode.parentElement as HTMLElement;
      if (el) {
        const closest = el.closest?.(
          "[data-dqid],[data-quote-id],[data-key],[data-item-key],a[href^='dq://'],a[href^='cite://'],a[href^='citegrp://']"
        );
        if (closest) return closest as HTMLElement;
      }
    } catch {
      // ignore
    }
    const root = view.dom as HTMLElement | null;
    if (!root) return null;
    const selectors: string[] = [];
    if (anchor.dataDqid) selectors.push(`[data-dqid="${cssEscape(anchor.dataDqid)}"]`);
    if (anchor.dataQuoteId) selectors.push(`[data-quote-id="${cssEscape(anchor.dataQuoteId)}"]`);
    if (anchor.dataKey) selectors.push(`[data-key="${cssEscape(anchor.dataKey)}"]`, `[data-item-key="${cssEscape(anchor.dataKey)}"]`);
    if (anchor.href) selectors.push(`a[href="${cssEscape(anchor.href)}"]`);
    const selector = selectors.filter(Boolean).join(",");
    if (!selector) return null;
    try {
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
      if (nodes.length === 1) return nodes[0];
      if (nodes.length > 1) {
        const needle = normalizeDiffText(anchor.text);
        const match = nodes.find((el) => {
          const txt = normalizeDiffText(el.textContent ?? "");
          return needle ? txt.includes(needle) : false;
        });
        return match ?? nodes[0] ?? null;
      }
    } catch {
      // ignore
    }
    const needleRaw = String(anchor.text ?? "");
    const needleNorm = normalizeDiffText(needleRaw);
    if (!needleRaw && !needleNorm) return null;
    try {
      const selectorFallback =
        "[data-dqid],[data-quote-id],[data-key],[data-item-key],a[href^='dq://'],a[href^='cite://'],a[href^='citegrp://']";
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let bestEl: HTMLElement | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const raw = String(node.nodeValue ?? "");
        if (!raw) continue;
        const idx = needleRaw ? raw.indexOf(needleRaw) : -1;
        const rawMatch = idx >= 0;
        const normMatch = !rawMatch && needleNorm ? normalizeDiffText(raw).includes(needleNorm) : false;
        if (!rawMatch && !normMatch) continue;
        const parent = node.parentElement;
        if (!parent) continue;
        const candidate = parent.closest(selectorFallback) ?? parent;
        if (rawMatch) {
          let pos: number | null = null;
          try {
            pos = view.posAtDOM(node, idx);
          } catch {
            pos = null;
          }
          if (typeof pos === "number") {
            const dist = Math.abs(pos - anchor.from);
            if (dist < bestDist) {
              bestDist = dist;
              bestEl = candidate as HTMLElement;
            }
            continue;
          }
        }
        if (!bestEl) {
          bestEl = candidate as HTMLElement;
        }
      }
      return bestEl;
    } catch {
      // ignore
    }
    return null;
  };

  const resolveDomOffsetToDocPos = (rootEl: HTMLElement, offset: number): number | null => {
    const editor = editorHandle.getEditor();
    const view = (editor as any)?.view;
    if (!view) return null;
    let remaining = Math.max(0, Math.floor(offset));
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = String((node as Text).nodeValue ?? "");
        if (remaining <= text.length) {
          try {
            return view.posAtDOM(node, remaining);
          } catch {
            return null;
          }
        }
        remaining -= text.length;
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
        if (remaining <= 1) {
          const parent = node.parentNode as HTMLElement | null;
          if (!parent) return null;
          const idx = Array.prototype.indexOf.call(parent.childNodes, node);
          try {
            return view.posAtDOM(parent, Math.max(0, idx + 1));
          } catch {
            return null;
          }
        }
        remaining -= 1;
      }
    }
    try {
      return view.posAtDOM(rootEl, rootEl.childNodes.length);
    } catch {
      return null;
    }
  };

  const resolveAnchorDomContext = (anchor: {
    from: number;
    text: string;
    href: string;
    dataKey: string;
    dataDqid: string;
    dataQuoteId: string;
  }) => {
    const anchorEl = findAnchorDomElement(anchor);
    if (!anchorEl) return null;
    const paragraphEl = anchorEl.closest?.("p") as HTMLElement | null;
    if (!paragraphEl) return null;
    if (anchorEl === paragraphEl) return null;
    const paragraphText = String(paragraphEl.textContent ?? "");
    if (!paragraphText) return null;
    try {
      const range = document.createRange();
      range.selectNodeContents(paragraphEl);
      range.setEndBefore(anchorEl);
      const beforeText = range.toString();
      const anchorOffset = beforeText.length;
      const bounds = findSentenceBoundsAt(paragraphText, anchorOffset);
      const sentenceStart = bounds.start;
      const rawSlice = paragraphText.slice(sentenceStart, anchorOffset);
      const oldTextRaw = rawSlice.replace(/\s+$/g, "");
      const oldTextModel = oldTextRaw.replace(/\s+/g, " ").trim();
      const from = resolveDomOffsetToDocPos(paragraphEl, sentenceStart);
      const to = resolveDomOffsetToDocPos(paragraphEl, anchorOffset);
      if (!Number.isFinite(from) || !Number.isFinite(to) || (from as number) >= (to as number)) {
        return null;
      }
      return {
        paragraphText,
        oldTextRaw,
        oldTextModel,
        anchorOffset,
        sentenceStart,
        from: Number(from),
        to: Number(to)
      };
    } catch {
      return null;
    }
  };

  const extractCitationContext = (
    paragraphText: string,
    anchors: Array<{ text: string; key: string }>
  ): Map<string, { start: number; end: number; sentence: string; before: string; after: string }> => {
    const text = String(paragraphText ?? "");
    const out = new Map<string, { start: number; end: number; sentence: string; before: string; after: string }>();
    let searchFrom = 0;
    for (const a of anchors) {
      const needle = String(a.text ?? "");
      if (!needle) continue;
      let idx = text.indexOf(needle, searchFrom);
      if (idx < 0) idx = text.indexOf(needle);
      if (idx >= 0) searchFrom = idx + needle.length;
      const anchorIdx = idx >= 0 ? idx : 0;
      const bounds = findSentenceBoundsAt(text, anchorIdx);
      const sentence = text.slice(bounds.start, bounds.end).replace(/\s+/g, " ").trim();
      const before = text.slice(Math.max(0, anchorIdx - 140), anchorIdx).replace(/\s+/g, " ").trim();
      const after = text.slice(anchorIdx + needle.length, Math.min(text.length, anchorIdx + needle.length + 140)).replace(/\s+/g, " ").trim();
      out.set(String(a.key), { start: bounds.start, end: bounds.end, sentence, before, after });
    }
    return out;
  };

  const resolveDocPosToTextOffset = (from: number, to: number, targetPos: number): number => {
    const editor = editorHandle.getEditor();
    let offset = 0;
    let done = false;
    editor.state.doc.nodesBetween(from, to, (node: any, pos: number) => {
      if (done) return false;
      if (!node) return true;
      if (node.isText) {
        const text = String(node.text ?? "");
        const endPos = pos + text.length;
        if (targetPos <= pos) {
          done = true;
          return false;
        }
        if (targetPos < endPos) {
          offset += Math.max(0, targetPos - pos);
          done = true;
          return false;
        }
        offset += text.length;
        return true;
      }
      if (String(node.type?.name ?? "") === "hard_break") {
        if (targetPos <= pos) {
          done = true;
          return false;
        }
        if (targetPos <= pos + 1) {
          offset += 1;
          done = true;
          return false;
        }
        offset += 1;
        return true;
      }
      return true;
    });
    return offset;
  };

  const findSentenceBoundsAt = (text: string, offset: number): { start: number; end: number } => {
    const value = String(text ?? "");
    const clamp = (v: number) => Math.max(0, Math.min(value.length, v));
    const idx = clamp(Math.floor(offset));
    const isBoundary = (pos: number): boolean => {
      const ch = value[pos] ?? "";
      if (ch === "\n") return true;
      if (ch !== "." && ch !== "?" && ch !== "!" && ch !== ";" && ch !== ":") return false;
      const prev = value.slice(Math.max(0, pos - 3), pos + 1).toLowerCase();
      const next = value.slice(pos + 1).trimStart();
      if ((prev.endsWith("p.") || prev.endsWith("pp.")) && /^\d/.test(next)) return false;
      let k = pos + 1;
      while (k < value.length && /[\"'”’)\]\}]/.test(value[k] ?? "")) k += 1;
      while (k < value.length && /\s/.test(value[k] ?? "")) k += 1;
      if (k >= value.length) return true;
      const nextChar = value[k] ?? "";
      return /[A-Z]/.test(nextChar);
    };

    let start = 0;
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (isBoundary(i)) {
        start = i + 1;
        break;
      }
    }
    let end = value.length;
    for (let i = idx; i < value.length; i += 1) {
      if (isBoundary(i)) {
        end = i + 1;
        break;
      }
    }
    return { start: clamp(start), end: clamp(end) };
  };

  const findSentenceBeforeOffset = (text: string, offset: number) => {
    const value = String(text ?? "");
    const bounds = findSentenceBoundsAt(value, offset);
    const end = Math.max(bounds.start, Math.min(bounds.end, Math.floor(offset)));
    let start = bounds.start;
    while (start < end && /\s/.test(value[start] ?? "")) start += 1;
    const segment = value.slice(start, end);
    const trimmed = segment.replace(/\s+/g, " ").trim();
    const suffixMatch = segment.match(/\s+$/);
    const suffix = suffixMatch ? suffixMatch[0] : "";
    const punctMatch = trimmed.match(/[.!?;:]+$/);
    const terminalPunct = punctMatch ? punctMatch[0] : "";
    return { start, end, segment, trimmed, suffix, terminalPunct };
  };

  const resolveTextOffsetToDocPos = (from: number, to: number, offset: number): number => {
    const editor = editorHandle.getEditor();
    let remaining = Math.max(0, Math.floor(offset));
    let resolved = from;
    let resolvedSet = false;
    editor.state.doc.nodesBetween(from, to, (node: any, pos: number) => {
      if (!node) return true;
      if (node.isText) {
        const text = String(node.text ?? "");
        if (remaining <= text.length) {
          resolved = pos + remaining;
          resolvedSet = true;
          return false;
        }
        remaining -= text.length;
        return true;
      }
      if (String(node.type?.name ?? "") === "hard_break") {
        if (remaining <= 1) {
          resolved = pos + 1;
          resolvedSet = true;
          return false;
        }
        remaining -= 1;
        return true;
      }
      return true;
    });
    if (!resolvedSet && remaining > 0) {
      return to;
    }
    return resolved;
  };

  const runCheckSources = async () => {
    const target = getIndicesForCurrentSelectionOrCursor();
    if (!target) {
      addMessage("system", "No sources to be checked.");
      return;
    }
    beginSourcesLoading();
    await runCheckSourcesForParagraphs(target.indices);
  };

  const runCheckSourcesForParagraphs = async (indices: number[]) => {
    beginSourcesLoading();
    const ranges = listParagraphRanges();
    const byN = new Map<number, { n: number; from: number; to: number }>();
    for (const r of ranges) byN.set(r.n, r);
    const selected = indices
      .map((n) => byN.get(n))
      .filter(Boolean) as Array<{ n: number; from: number; to: number }>;
    if (selected.length === 0) {
      addMessage("system", "No sources to be checked.");
      endSourcesLoading();
      return;
    }

    const host: any = (window as any).leditorHost;
    if (!host || typeof host.checkSources !== "function") {
      addMessage("assistant", "Source checking host bridge unavailable.");
      endSourcesLoading();
      return;
    }

    setInflight(true);
    try {
      try {
        editorHandle.execCommand("ClearSourceChecks");
      } catch {
        // ignore
      }
      const editor = editorHandle.getEditor();
      const allItems: any[] = [];
      for (const paragraph of selected) {
        const anchorsRaw = collectSourceRefsInRange(paragraph.from, paragraph.to);
        const paragraphText = editor.state.doc.textBetween(paragraph.from, paragraph.to, "\n").trim();
        const anchors = anchorsRaw.map((a, idx) => {
          const base = String(a?.href || a?.dataDqid || a?.dataKey || a?.text || "").replace(/\s+/g, " ").trim();
          const baseShort = base.length > 72 ? `${base.slice(0, 71)}…` : base;
          const stableKey = `P${paragraph.n}:${baseShort}:${idx + 1}`;
          return { ...a, key: stableKey };
        });
        const ctxByKey = extractCitationContext(
          paragraphText,
          anchors.map((a) => ({ key: a.key, text: a.text }))
        );
        addMessage(
          "system",
          `[check_sources][P${paragraph.n}] sources=${anchors.length} paragraphLen=${paragraphText.length}`
        );
        console.info("[agent][check_sources]", {
          paragraph: paragraph.n,
          anchorCount: anchors.length,
          anchors: anchors.map((a) => ({
            key: a.key,
            text: a.text,
            title: a.title,
            href: a.href,
            dataKey: a.dataKey,
            dataDqid: a.dataDqid,
            dataQuoteId: a.dataQuoteId
          }))
        });
        if (anchors.length === 0) {
          console.warn("[agent][check_sources]", {
            paragraph: paragraph.n,
            status: "no_sources_found",
            hint: "No citation anchors found in this paragraph (anchor/link marks or citation nodes)."
          });
          continue;
        }
        const sel = resolveSelectedProvider();
        const model = resolveSelectedModel(sel.provider);
        const requestPayload = {
          provider: sel.provider,
          ...(model ? { model } : {}),
          paragraphN: paragraph.n,
          paragraphText,
          anchors: anchors.map((a) => ({
            key: a.key,
            text: a.text,
            title: a.title,
            href: a.href,
            dataKey: a.dataKey,
            dataDqid: a.dataDqid,
            dataQuoteId: a.dataQuoteId,
            context: ctxByKey.get(a.key) ?? null
          }))
        };
        console.info("[agent][check_sources]", { paragraph: paragraph.n, requestPayload });
        const cacheKey = buildLlmCacheKey({
          fn: "check_sources",
          provider: requestPayload.provider,
          payload: requestPayload
        });
        const cached = getLlmCacheEntry(cacheKey);
        let result: any = cached?.value ?? null;
        if (!result) {
          const requestId = `check-${paragraph.n}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          result = await host.checkSources({ requestId, payload: requestPayload });
          if (result?.success) {
            setLlmCacheEntry({
              key: cacheKey,
              fn: "check_sources",
              value: result,
              meta: { provider: requestPayload.provider }
            });
          }
        }
        if (!result?.success) {
          addMessage("assistant", result?.error ? String(result.error) : "Source check failed.");
          continue;
        }
        const checksRaw = Array.isArray(result.checks) ? result.checks : [];
        const byKey = new Map<
          string,
          {
            verdict: "verified" | "needs_review";
            justification: string;
            fixSuggestion?: string;
            suggestedReplacementKey?: string;
            claimRewrite?: string;
          }
        >();
        for (const c of checksRaw) {
          const key = typeof c?.key === "string" ? c.key : "";
          if (!key) continue;
          byKey.set(key, {
            verdict: c?.verdict === "verified" ? "verified" : "needs_review",
            justification: typeof c?.justification === "string" ? c.justification : "",
            fixSuggestion: typeof c?.fixSuggestion === "string" ? c.fixSuggestion : undefined,
            suggestedReplacementKey:
              typeof c?.suggestedReplacementKey === "string" ? c.suggestedReplacementKey : undefined
            ,
            claimRewrite: typeof c?.claimRewrite === "string" ? c.claimRewrite : undefined
          });
        }
        for (const a of anchors) {
          const check = byKey.get(a.key);
          if (!check) continue;
          allItems.push({
            key: a.key,
            from: a.from,
            to: a.to,
            verdict: check.verdict,
            justification:
              check.justification ||
              (check.verdict === "verified" ? "Citation appears consistent." : "Check citation relevance.")
          });
        }
        try {
          upsertSourceChecksFromRun({
            paragraphN: paragraph.n,
            provider: requestPayload.provider,
            anchors: requestPayload.anchors,
            checksByKey: byKey
          });
        } catch {
          // ignore
        }
      }
      if (allItems.length === 0) {
        // Help user diagnose paragraph index mismatches: show where citations actually exist.
        const paragraphsWithSources: Array<{ n: number; count: number }> = [];
        for (const r of ranges) {
          const refs = collectSourceRefsInRange(r.from, r.to);
          if (refs.length > 0) paragraphsWithSources.push({ n: r.n, count: refs.length });
        }
        const hint =
          paragraphsWithSources.length > 0
            ? `Found citation anchors in: ${paragraphsWithSources
                .slice(0, 20)
                .map((p) => `P${p.n}(${p.count})`)
                .join(", ")}${paragraphsWithSources.length > 20 ? ", …" : ""}`
            : "No citation anchors found anywhere in this document.";
        console.info("[agent][check_sources]", {
          status: "no_sources_overall",
          requested: indices,
          paragraphsWithSources
        });
        addMessage(
          "system",
          `No sources to be checked. (${hint})`
        );
        return;
      }
      editorHandle.execCommand("SetSourceChecks", { items: allItems });
      try {
        const firstKey = typeof (allItems[0] as any)?.key === "string" ? String((allItems[0] as any).key) : "";
        sourceFocusKey = firstKey || null;
      } catch {
        sourceFocusKey = null;
      }
      setViewMode("sources");
      addMessage("system", `Checked ${allItems.length} source(s).`);
    } finally {
      setInflight(false);
      endSourcesLoading();
      editorHandle.focus();
    }
  };

  const runSubstantiate = async () => {
    const target = getIndicesForCurrentSelectionOrCursor();
    if (!target) {
      addMessage("system", "Select text or place cursor in a paragraph, then run Substantiate.");
      return;
    }
    await runSubstantiateForParagraphs(target.indices);
  };

  const runSubstantiateForParagraphs = async (indices: number[]) => {
    const ranges = listParagraphRanges();
    const byN = new Map<number, { n: number; from: number; to: number }>();
    for (const r of ranges) byN.set(r.n, r);
    const selected = indices
      .map((n) => byN.get(n))
      .filter(Boolean) as Array<{ n: number; from: number; to: number }>;
    if (selected.length === 0) {
      addMessage("system", "No target paragraphs for substantiate.");
      return;
    }

    const host: any = (window as any).leditorHost;
    if (!host || typeof host.substantiateAnchors !== "function") {
      addMessage("assistant", "Substantiate host bridge unavailable.");
      return;
    }
    const contract: any = (window as any).__leditorHost;
    const lookupPath = String(contract?.inputs?.directQuoteJsonPath ?? "").trim();
    if (!lookupPath) {
      addMessage("assistant", "Direct-quote lookup path is not configured.");
      return;
    }

    setInflight(true);
    substantiateResults = [];
    substantiateError = null;
    substantiateSuppressedKeys = new Set<string>();
    substantiatePreviewState = null;
    pendingByView = { ...pendingByView, substantiate: null };
    pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
    syncDraftPreview();
    setViewMode("substantiate");
    setStatus("Running substantiate…");
    renderBoxes();
    let streamUnsub: (() => void) | null = null;
    try {
      const editor = editorHandle.getEditor();
      const anchorsPayload: any[] = [];
      const anchorContextByKey = new Map<
        string,
        {
          paragraph: { n: number; from: number; to: number };
          paragraphText: string;
          paragraphTextRaw: string;
          oldTextRaw: string;
          oldTextModel: string;
          sentenceStartOffset: number;
          anchorStartOffset: number;
          dom?: {
            paragraphText: string;
            oldTextRaw: string;
            oldTextModel: string;
            anchorOffset: number;
            sentenceStart: number;
            from: number;
            to: number;
          };
          anchors: Array<{
            key: string;
            text: string;
            title: string;
            href: string;
            dataKey: string;
            dataDqid: string;
            dataQuoteId: string;
            startOffset: number;
            endOffset: number;
          }>;
          anchorText: string;
          anchorTitle: string;
          anchorTexts: string[];
        }
      >();
      for (const paragraph of selected) {
        const anchorsRaw = collectSourceRefsInRange(paragraph.from, paragraph.to);
        const paragraphTextRaw = editor.state.doc.textBetween(paragraph.from, paragraph.to, "\n");
        const paragraphText = paragraphTextRaw.trim();
        const anchors = anchorsRaw
          .map((a, idx) => {
            const base = String(a?.href || a?.dataDqid || a?.dataKey || a?.text || "").replace(/\s+/g, " ").trim();
            const baseShort = base.length > 72 ? `${base.slice(0, 71)}…` : base;
            const stableKey = `P${paragraph.n}:${baseShort}:${idx + 1}`;
            const anchorText = String(a?.text ?? "");
            const startOffset = resolveDocPosToTextOffset(paragraph.from, paragraph.to, a.from);
            const endOffset = startOffset + anchorText.length;
            const sentenceBounds = findSentenceBoundsAt(paragraphTextRaw, startOffset);
            return { ...a, key: stableKey, startOffset, endOffset, sentenceBounds };
          })
          .sort((a, b) => a.startOffset - b.startOffset);
        if (anchors.length === 0) continue;

        const isGapOnlyPunct = (value: string) =>
          String(value ?? "").replace(/[\s,;:()\[\]{}"“”‘’'`~–—-]+/g, "") === "";

        let i = 0;
        while (i < anchors.length) {
          const first = anchors[i]!;
          const sentenceBounds = first.sentenceBounds;
          const group: typeof anchors = [first];
          let prev = first;
          let j = i + 1;
          while (j < anchors.length) {
            const next = anchors[j]!;
            const sameSentence =
              next.sentenceBounds?.start === sentenceBounds?.start &&
              next.sentenceBounds?.end === sentenceBounds?.end;
            if (!sameSentence) break;
            const gap = paragraphTextRaw.slice(prev.endOffset, next.startOffset);
            if (!isGapOnlyPunct(gap)) break;
            group.push(next);
            prev = next;
            j += 1;
          }

          const sentenceStartOffset = Number.isFinite(sentenceBounds?.start) ? Number(sentenceBounds.start) : 0;
          const anchorStartOffset = first.startOffset;
          const rawSlice = paragraphTextRaw.slice(sentenceStartOffset, anchorStartOffset);
          const oldTextRaw = rawSlice.replace(/\s+$/g, "");
          const oldTextModel = oldTextRaw.replace(/\s+/g, " ").trim();
          const domContext = resolveAnchorDomContext({
            from: first.from,
            text: String(first.text ?? ""),
            href: String(first.href ?? ""),
            dataKey: String(first.dataKey ?? ""),
            dataDqid: String(first.dataDqid ?? ""),
            dataQuoteId: String(first.dataQuoteId ?? "")
          });
          if (!domContext) {
            console.info("[substantiate] dom_context_missing", { key: String(first.key ?? ""), paragraphN: paragraph.n });
          }
          const oldTextPayloadRaw = domContext?.oldTextRaw || oldTextRaw || oldTextModel;
          const oldTextPayload = stripLeadingParagraphMarker(oldTextPayloadRaw, paragraph.n);
          const hasOldText = Boolean(domContext?.oldTextModel || oldTextModel);
          if (hasOldText) {
            const groupKey =
              group.length > 1 ? `P${paragraph.n}:grp:${first.key}:${group.length}` : String(first.key);
            const groupAnchors = group.map((a) => ({
              key: String(a.key ?? ""),
              text: String(a.text ?? ""),
              title: String(a.title ?? ""),
              href: String(a.href ?? ""),
              dataKey: String(a.dataKey ?? ""),
              dataDqid: String(a.dataDqid ?? ""),
              dataQuoteId: String(a.dataQuoteId ?? ""),
              startOffset: a.startOffset,
              endOffset: a.endOffset
            }));
            const anchorTexts = groupAnchors.map((a) => a.text).filter(Boolean);
            const anchorTitles = groupAnchors.map((a) => a.title).filter(Boolean);
            const anchorTitle = anchorTitles.length
              ? anchorTitles.join(" • ")
              : group.length > 1
                ? `Multiple citations (${group.length})`
                : "";
            const anchorText = anchorTexts.length ? anchorTexts.join(" ") : "";

            const paragraphTextPayloadRaw = domContext?.paragraphText
              ? String(domContext.paragraphText).trim()
              : paragraphText;
            const paragraphTextPayload = stripLeadingParagraphMarker(paragraphTextPayloadRaw, paragraph.n);
            anchorsPayload.push({
              key: groupKey,
              paragraphN: paragraph.n,
              anchors: groupAnchors.map((a) => ({
                text: a.text,
                title: a.title,
                href: a.href,
                dataKey: a.dataKey,
                dataDqid: a.dataDqid,
                dataQuoteId: a.dataQuoteId
              })),
              oldText: oldTextPayload,
              paragraphText: paragraphTextPayload
            });
            anchorContextByKey.set(groupKey, {
              paragraph,
              paragraphText,
              paragraphTextRaw,
              oldTextRaw,
              oldTextModel,
              sentenceStartOffset,
              anchorStartOffset,
              dom: domContext ?? undefined,
              anchors: groupAnchors,
              anchorText,
              anchorTitle,
              anchorTexts
            });
          }

          i = j;
        }
      }

      if (anchorsPayload.length === 0) {
        addMessage("system", "No citation anchors found in the selected paragraphs.");
        setViewMode("substantiate");
        renderBoxes();
        return;
      }

      try {
        console.info("[substantiate] input", {
          paragraphs: selected.map((p) => p.n),
          requests: anchorsPayload.length,
          sample: anchorsPayload.slice(0, 3).map((r) => ({
            key: r.key,
            paragraphN: r.paragraphN,
            oldText: String(r.oldText ?? "").slice(0, 180),
            anchors: Array.isArray(r.anchors) ? r.anchors.map((a: any) => a?.text).filter(Boolean) : []
          }))
        });
      } catch {
        // ignore
      }

      const sel = resolveSelectedProvider();
      const model = resolveSelectedModel(sel.provider);
      const requestId = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const streamEnabled = typeof host.onSubstantiateStreamUpdate === "function";
      const resultsByKey = new Map<string, any>();
      let streamCompleted = 0;
      let streamTotal = anchorsPayload.length;
      let streamIndexSkipped = 0;
      let streamIndexTotal = 0;
      let noSubstantiateNoticeSent = false;

      const updateSubstantiateState = (byKey: Map<string, any>) => {
        const nextResults: SubstantiateSuggestion[] = [];
        const applyItems: Array<{
          n: number;
          from: number;
          to: number;
          text: string;
          originalText: string;
          anchorInsertions?: SubstantiateAnchorInsertion[];
        }> = [];
        const locateOldTextRange = (paragraphTextRaw: string, needleRaw: string, anchorStartOffset: number) => {
          const needle = String(needleRaw ?? "");
          if (!needle) return null;
          const maxIdx = Math.max(0, Math.min(paragraphTextRaw.length, anchorStartOffset));
          const idx = paragraphTextRaw.lastIndexOf(needle, maxIdx);
          if (idx < 0) return null;
          return { start: idx, end: idx + needle.length };
        };
        const normalizedCache = new Map<string, { norm: string; map: number[] }>();
        const buildNormalizedMap = (value: string) => {
          const cached = normalizedCache.get(value);
          if (cached) return cached;
          const raw = String(value ?? "");
          let norm = "";
          const map: number[] = [];
          let inWs = false;
          for (let i = 0; i < raw.length; i += 1) {
            const ch = raw[i] ?? "";
            if (/\s/.test(ch)) {
              if (!inWs) {
                norm += " ";
                map.push(i);
                inWs = true;
              }
              continue;
            }
            inWs = false;
            norm += ch;
            map.push(i);
          }
          const built = { norm, map };
          normalizedCache.set(value, built);
          return built;
        };
        const normalizedIndexForRawOffset = (map: number[], rawOffset: number) => {
          if (!map.length) return -1;
          let lo = 0;
          let hi = map.length - 1;
          let ans = -1;
          const target = Math.max(0, Math.floor(rawOffset));
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const v = map[mid] ?? 0;
            if (v <= target) {
              ans = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          return ans;
        };
        const locateOldTextRangeNormalized = (paragraphTextRaw: string, needleRaw: string, anchorStartOffset: number) => {
          const needleNorm = normalizeDiffText(needleRaw);
          if (!needleNorm) return null;
          const { norm, map } = buildNormalizedMap(paragraphTextRaw);
          if (!norm) return null;
          const anchorNormIdx = normalizedIndexForRawOffset(map, anchorStartOffset);
          const maxIdx = anchorNormIdx >= 0 ? anchorNormIdx : norm.length - 1;
          const idx = norm.lastIndexOf(needleNorm, maxIdx);
          if (idx < 0) return null;
          const startRaw = map[idx] ?? 0;
          const endNormIdx = idx + needleNorm.length - 1;
          const endRaw = endNormIdx >= 0 ? (map[endNormIdx] ?? startRaw) + 1 : startRaw + needleNorm.length;
          return { start: startRaw, end: endRaw };
        };
        const clampOffset = (value: number, max: number) => Math.max(0, Math.min(max, value));
        for (const [key, context] of anchorContextByKey.entries()) {
          if (substantiateSuppressedKeys.has(key)) continue;
          const r = byKey.get(key);
          if (!r) continue;
          const rawOldText =
            typeof r?.old_text === "string"
              ? String(r.old_text)
              : typeof r?.oldText === "string"
                ? String(r.oldText)
                : context.dom?.oldTextRaw || context.oldTextRaw || context.oldTextModel;
          const domContext = context.dom;
          let from: number | undefined;
          let to: number | undefined;
          let sentenceRaw = "";
          if (domContext && Number.isFinite(domContext.from) && Number.isFinite(domContext.to) && domContext.from < domContext.to) {
            from = domContext.from;
            to = domContext.to;
            sentenceRaw = getRangeOriginalText(from, to);
            console.info("[substantiate] range_dom", {
              key,
              paragraphN: context.paragraph.n,
              from,
              to
            });
          }
          const candidates = [context.oldTextRaw, rawOldText, context.oldTextModel]
            .map((v) => (typeof v === "string" ? v : ""))
            .filter((v) => normalizeDiffText(v).length > 0);
          let range: { start: number; end: number } | null = null;
          let fallbackStartOffset: number | null = null;
          let fallbackEndOffset: number | null = null;
          if (!from || !to) {
            for (const candidate of candidates) {
              range = locateOldTextRange(context.paragraphTextRaw, candidate, context.anchorStartOffset);
              if (range) break;
            }
            if (!range) {
              for (const candidate of candidates) {
                range = locateOldTextRangeNormalized(context.paragraphTextRaw, candidate, context.anchorStartOffset);
                if (range) break;
              }
            }
            const maxLen = context.paragraphTextRaw.length;
            const startOffset = clampOffset(range ? range.start : context.sentenceStartOffset, maxLen);
            const endFallback = context.sentenceStartOffset + context.oldTextRaw.length;
            const endOffset = clampOffset(range ? range.end : endFallback, maxLen);
            fallbackStartOffset = startOffset;
            fallbackEndOffset = endOffset;
            const safeEndOffset = Math.max(startOffset, endOffset);
            from = Number.isFinite(startOffset)
              ? resolveTextOffsetToDocPos(context.paragraph.from, context.paragraph.to, startOffset)
              : undefined;
            to = Number.isFinite(safeEndOffset)
              ? resolveTextOffsetToDocPos(context.paragraph.from, context.paragraph.to, safeEndOffset)
              : undefined;
            sentenceRaw =
              Number.isFinite(startOffset) && Number.isFinite(safeEndOffset)
                ? context.paragraphTextRaw.slice(startOffset, safeEndOffset)
                : context.oldTextRaw;
          }
          const sentence = normalizeDiffText(sentenceRaw);
          if (!domContext && !range) {
            console.info("[substantiate] range_fallback", {
              key,
              paragraphN: context.paragraph.n,
              anchorStartOffset: context.anchorStartOffset,
              fallbackStart: fallbackStartOffset ?? undefined,
              fallbackEnd: fallbackEndOffset ?? undefined
            });
          }
          if (typeof from === "number" && typeof to === "number" && from < to) {
            const originalFromDoc = getRangeOriginalText(from, to);
            const normalizedOriginal = normalizeDiffText(originalFromDoc);
            if (normalizedOriginal && sentence && normalizedOriginal !== sentence) {
              console.info("[substantiate] range_mismatch", {
                key,
                paragraphN: context.paragraph.n,
                from,
                to,
                expected: sentence.slice(0, 160),
                actual: normalizedOriginal.slice(0, 160)
              });
            }
          }
          let rewrite = typeof r?.rewrite === "string" ? String(r.rewrite) : sentence;
          rewrite = normalizeDiffText(rewrite);
          for (const t of context.anchorTexts) {
            if (t && rewrite.includes(t)) {
              rewrite = normalizeDiffText(rewrite.split(t).join(" "));
            }
          }
          if (!rewrite) rewrite = sentence;
          const normalizedSentence = sentence;
          let normalizedRewrite = rewrite;
          const stance =
            r?.stance === "corroborates" || r?.stance === "refutes" || r?.stance === "mixed" || r?.stance === "uncertain"
              ? r.stance
              : "uncertain";
          let anchorEdits = normalizeAnchorEditsFromResult(r, Array.isArray(r?.matches) ? r.matches : []);
          if (anchorEdits && stance !== "corroborates" && stance !== "refutes") {
            anchorEdits = null;
          }
          if (anchorEdits && anchorEdits.action === "add_anchor_only") {
            rewrite = normalizedSentence;
          }
          normalizedRewrite = normalizeDiffText(rewrite);
          const anchorInsertions = anchorEdits
            ? buildSubstantiateAnchorInsertions({
                context: {
                  paragraph: context.paragraph,
                  paragraphTextRaw: context.paragraphTextRaw,
                  anchors: context.anchors
                },
                edits: anchorEdits
              })
            : [];
          const hasChange =
            Boolean(normalizedRewrite && normalizedRewrite !== normalizedSentence) || anchorInsertions.length > 0;
          const error = typeof r?.error === "string" ? String(r.error) : "";
          const justification =
            typeof r?.justification === "string"
              ? String(r.justification).trim()
              : typeof r?.suggestion === "string"
                ? String(r.suggestion).trim()
                : typeof r?.notes === "string"
                  ? String(r.notes).trim()
                  : "";
          if (!hasChange && !error) {
            continue;
          }
          nextResults.push({
            key,
            paragraphN: context.paragraph.n,
            anchorText: context.anchorText,
            anchorTitle: context.anchorTitle,
            sentence,
            rewrite,
            stance,
            notes: error ? error : (typeof r?.notes === "string" ? String(r.notes) : undefined),
            justification: error ? error : (justification || undefined),
            suggestion: typeof r?.suggestion === "string" ? String(r.suggestion) : undefined,
            diffs: typeof r?.diffs === "string" ? String(r.diffs) : undefined,
            matches: Array.isArray(r?.matches) ? r.matches : [],
            anchorEdits: anchorEdits ?? undefined,
            from,
            to,
            status: "pending",
            ...(error ? { error } : {})
          });
          console.info("[substantiate] output", {
            key,
            paragraphN: context.paragraph.n,
            stance:
              r?.stance === "corroborates" || r?.stance === "refutes" || r?.stance === "mixed" || r?.stance === "uncertain"
                ? r.stance
                : "uncertain",
            hasChange,
            rewrite: rewrite.slice(0, 240)
          });
          if (hasChange && typeof from === "number" && typeof to === "number" && from < to) {
            const originalText = getRangeOriginalText(from, to) || sentenceRaw || sentence || "";
            applyItems.push({
              n: Number.isFinite(context.paragraph.n) ? context.paragraph.n : 0,
              from,
              to,
              text: rewrite,
              originalText,
              ...(anchorInsertions.length ? { anchorInsertions } : {})
            });
          }
        }

        console.info("[substantiate] preview_items", {
          count: applyItems.length,
          sample: applyItems.slice(0, 3).map((it) => ({
            n: it.n,
            from: it.from,
            to: it.to,
            text: String(it.text ?? "").slice(0, 120)
          }))
        });

        substantiateResults = nextResults;
        pendingByView = {
          ...pendingByView,
          substantiate: applyItems.length ? { kind: "batchReplace", items: applyItems } : null
        };
        pending = viewMode === "chat" ? null : ((pendingByView as any)[viewMode] ?? null);
        syncDraftPreview();
        renderBoxes();
      };

      const updateStatus = (final: boolean) => {
        const skipped = streamIndexSkipped;
        const total = streamIndexTotal;
        const skipNote = skipped > 0 ? ` Skipped ${skipped}${total ? ` of ${total}` : ""} malformed entries.` : "";
        if (final) {
          if (substantiateResults.length === 0) {
            setStatus(`No substantiate suggestions.${skipNote}`);
            if (!noSubstantiateNoticeSent) {
              addMessage("assistant", "No substantiate suggestions.");
              noSubstantiateNoticeSent = true;
            }
          } else {
            setStatus(`Substantiate ready • ${substantiateResults.length} suggestion(s).${skipNote}`);
          }
          return;
        }
        const totalCount = Math.max(0, streamTotal);
        const doneCount = Math.min(Math.max(0, streamCompleted), totalCount);
        setStatus(`Substantiating ${doneCount}/${totalCount}…${skipNote}`);
      };

      const requestPayload = {
        provider: sel.provider,
        ...(model ? { model } : {}),
        lookupPath,
        requests: anchorsPayload,
        stream: streamEnabled
      };
      const cacheKey = buildLlmCacheKey({
        fn: "substantiate",
        provider: sel.provider,
        payload: requestPayload
      });
      const cached = getLlmCacheEntry(cacheKey);
      if (cached?.value?.success) {
        const cachedResults = Array.isArray(cached.value?.results) ? cached.value.results : [];
        for (const r of cachedResults) {
          const key = typeof r?.key === "string" ? r.key : "";
          if (!key) continue;
          resultsByKey.set(key, r);
        }
        const skipped = Number((cached.value?.meta as any)?.index?.skipped ?? 0);
        const total = Number((cached.value?.meta as any)?.index?.total ?? 0);
        if (Number.isFinite(skipped)) streamIndexSkipped = skipped;
        if (Number.isFinite(total)) streamIndexTotal = total;
        updateSubstantiateState(resultsByKey);
        setViewMode("substantiate");
        updateStatus(true);
        return;
      }

      if (streamEnabled) {
        streamUnsub = host.onSubstantiateStreamUpdate((payload: any) => {
          if (!payload || payload.requestId !== requestId) return;
          const kind = String(payload.kind || "");
          if (kind === "index") {
            const total = Number(payload?.total ?? payload?.index?.total ?? 0);
            const skipped = Number(payload?.skipped ?? payload?.index?.skipped ?? 0);
            if (Number.isFinite(total)) streamIndexTotal = total;
            if (Number.isFinite(skipped)) streamIndexSkipped = skipped;
            updateStatus(false);
            return;
          }
          if (kind === "item") {
            const item = payload?.item ?? null;
            const key = typeof item?.key === "string" ? String(item.key) : "";
            if (key && !substantiateSuppressedKeys.has(key)) {
              resultsByKey.set(key, item);
              streamCompleted = Number(payload?.completed ?? resultsByKey.size);
              updateSubstantiateState(resultsByKey);
              updateStatus(false);
            }
            return;
          }
          if (kind === "error") {
            substantiateError = payload?.message ? String(payload.message) : "Substantiate failed.";
            addMessage("assistant", substantiateError);
            setViewMode("substantiate");
            renderBoxes();
            return;
          }
          if (kind === "done") {
            streamCompleted = Number(payload?.completed ?? resultsByKey.size);
            updateStatus(false);
          }
        });
      }

      streamTotal = anchorsPayload.length;
      updateStatus(false);

      const result = await host.substantiateAnchors({
        requestId,
        stream: streamEnabled,
        payload: requestPayload
      });

      if (!result?.success) {
        substantiateError = result?.error ? String(result.error) : "Substantiate failed.";
        addMessage("assistant", substantiateError);
        setViewMode("substantiate");
        renderBoxes();
        return;
      }
      setLlmCacheEntry({
        key: cacheKey,
        fn: "substantiate",
        value: result,
        meta: { provider: sel.provider }
      });
      substantiateError = null;

      const resultsRaw = Array.isArray(result?.results) ? result.results : [];
      for (const r of resultsRaw) {
        const key = typeof r?.key === "string" ? r.key : "";
        if (!key) continue;
        resultsByKey.set(key, r);
      }

      const skipped = Number((result?.meta as any)?.index?.skipped ?? streamIndexSkipped ?? 0);
      const total = Number((result?.meta as any)?.index?.total ?? streamIndexTotal ?? 0);
      if (Number.isFinite(skipped)) streamIndexSkipped = skipped;
      if (Number.isFinite(total)) streamIndexTotal = total;
      updateSubstantiateState(resultsByKey);
      setViewMode("substantiate");
      updateStatus(true);
    } finally {
      try {
        streamUnsub?.();
      } catch {
        // ignore
      }
      setInflight(false);
      editorHandle.focus();
    }
  };

  // Keep the Sources tab in sync with persisted checks as they are loaded/updated.
  let sourceThreadRaf = 0;
  const unsubscribeSourceThread = subscribeSourceChecksThread(() => {
    if (destroyed || !open) return;
    if (viewMode !== "sources") return;
    if (sourceThreadRaf) return;
    sourceThreadRaf = window.requestAnimationFrame(() => {
      sourceThreadRaf = 0;
      renderBoxes();
    });
  });

  const controller: AgentSidebarController = {
    open() {
      if (destroyed) return;
      open = true;
      sidebar.classList.add("is-open");
      root.classList.add(APP_OPEN_CLASS);
      try {
        editorHandle.execCommand("SetParagraphGrid", { enabled: showNumbers.checked });
      } catch {
        // ignore
      }
      syncInsets();
      renderMessages();
      updateComposerState();
      setStatus("Ready • Reference paragraphs by index (e.g. 35, 35-38).");
      input.focus();
      // Sidebar-only UX: remove any legacy document-side rails if present.
      try {
        document.getElementById(DRAFT_RAIL_ID)?.remove();
      } catch {
        // ignore
      }
      try {
        document.getElementById(FEEDBACK_HUB_ID)?.remove();
      } catch {
        // ignore
      }
      try {
        document.getElementById("leditor-source-check-rail")?.remove();
      } catch {
        // ignore
      }
      draftRail = null;
      feedbackHub = null;

      // Inline accept/reject buttons (rendered inside the document) dispatch this event.
      const onDraftAction = (event: Event) => {
        const detail = (event as CustomEvent).detail as any;
        if (!detail || typeof detail !== "object") return;
        if (detail.action === "accept") {
          acceptPendingItem(detail);
          return;
        }
        if (detail.action === "reject") {
          rejectPendingItem(detail);
        }
      };
      window.addEventListener("leditor:ai-draft-action", onDraftAction as any, { passive: true });
      (controller as any).__onDraftAction = onDraftAction;

      const onDraftFocus = (event: Event) => {
        const target = event.target as HTMLElement | null;
        const repl = target?.closest?.("[data-ai-draft-key]") as HTMLElement | null;
        if (!repl) return;
        const key = String(repl.getAttribute("data-ai-draft-key") ?? "");
        if (!key) return;
        highlightPendingCard(key);
      };
      document.addEventListener("pointerdown", onDraftFocus, true);
      (controller as any).__onDraftFocus = onDraftFocus;
    },
    close() {
      if (destroyed) return;
      open = false;
      sidebar.classList.remove("is-open");
      root.classList.remove(APP_OPEN_CLASS);
      try {
        editorHandle.execCommand("SetParagraphGrid", { enabled: false });
      } catch {
        // ignore
      }
      try {
        editorHandle.execCommand("ClearAiDraftPreview");
      } catch {
        // ignore
      }
      try {
        editorHandle.execCommand("ClearSourceChecks");
      } catch {
        // ignore
      }
      try {
        setSourceChecksVisible(false);
      } catch {
        // ignore
      }
      try {
        document.getElementById(DRAFT_RAIL_ID)?.remove();
        document.getElementById(FEEDBACK_HUB_ID)?.remove();
        document.getElementById("leditor-source-check-rail")?.remove();
      } catch {
        // ignore
      }
      try {
        draftRail?.destroy();
      } catch {
        // ignore
      }
      draftRail = null;
      try {
        feedbackHub?.destroy();
      } catch {
        // ignore
      }
      feedbackHub = null;
      try {
        const fn = (controller as any).__onDraftAction as any;
        if (fn) window.removeEventListener("leditor:ai-draft-action", fn);
      } catch {
        // ignore
      }
      (controller as any).__onDraftAction = null;
      try {
        const fn = (controller as any).__onDraftFocus as any;
        if (fn) document.removeEventListener("pointerdown", fn, true);
      } catch {
        // ignore
      }
      (controller as any).__onDraftFocus = null;
    },
    toggle() {
      if (destroyed) return;
      if (open) controller.close();
      else controller.open();
    },
    isOpen() {
      return open;
    },
    openView(view) {
      if (destroyed) return;
      if (!open) controller.open();
      const next =
        view === "chat" || view === "dictionary" || view === "sections" || view === "sources" ? view : "chat";
      setViewMode(next as SidebarViewId);
    },
    runAction(actionId: AgentActionId, options?: { mode?: "block" }) {
      if (destroyed) return;
      if (!open) controller.open();
      if (actionId === "clear_checks") {
        try {
          editorHandle.execCommand("ai.sourceChecks.clear");
        } catch {
          try {
            editorHandle.execCommand("ClearSourceChecks");
          } catch {
            // ignore
          }
        }
        addMessage("system", "Cleared source checks.");
        return;
      }
      if (actionId === "check_sources") {
        void runCheckSources();
        return;
      }
      if (actionId === "substantiate") {
        void runSubstantiate();
        return;
      }
      if (
        options?.mode === "block" &&
        (actionId === "refine" || actionId === "paraphrase" || actionId === "shorten" || actionId === "proofread")
      ) {
        void applyActionTemplate(actionId, { selectionBlock: true });
        return;
      }
      if (isSectionAction(actionId)) {
        setViewMode("chat");
      }
      void applyActionTemplate(actionId);
    },
    runSectionsBatch() {
      if (destroyed) return;
      if (!open) controller.open();
      setViewMode("sections");
      void runSectionBatch();
    },
    openDictionary(mode?: DictionaryMode) {
      if (destroyed) return;
      if (!open) controller.open();
      if (mode) {
        dictionaryActiveMode = mode;
      }
      dictionarySkipNextAutoLookup = true;
      setViewMode("dictionary");
      runDictionaryLookup(mode ? [mode] : dictionaryModes);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.classList.remove(APP_OPEN_CLASS);
      try {
        editorHandle.execCommand("SetParagraphGrid", { enabled: false });
      } catch {
        // ignore
      }
      try {
        editorHandle.execCommand("ClearAiDraftPreview");
      } catch {
        // ignore
      }
      try {
        editorHandle.execCommand("ClearSourceChecks");
      } catch {
        // ignore
      }
      try {
        setSourceChecksVisible(false);
      } catch {
        // ignore
      }
      try {
        document.getElementById(DRAFT_RAIL_ID)?.remove();
        document.getElementById(FEEDBACK_HUB_ID)?.remove();
        document.getElementById("leditor-source-check-rail")?.remove();
      } catch {
        // ignore
      }
      clearPending();
      unsubscribeScope();
      try {
        unsubscribeSourceThread();
      } catch {
        // ignore
      }
      try {
        if (sourceThreadRaf) window.cancelAnimationFrame(sourceThreadRaf);
      } catch {
        // ignore
      }
      sourceThreadRaf = 0;
      try {
        draftRail?.destroy();
      } catch {
        // ignore
      }
      draftRail = null;
      try {
        feedbackHub?.destroy();
      } catch {
        // ignore
      }
      feedbackHub = null;
      try {
        const fn = (controller as any).__onDraftAction as any;
        if (fn) window.removeEventListener("leditor:ai-draft-action", fn);
      } catch {
        // ignore
      }
      (controller as any).__onDraftAction = null;
      try {
        const fn = (controller as any).__onDraftFocus as any;
        if (fn) document.removeEventListener("pointerdown", fn, true);
      } catch {
        // ignore
      }
      (controller as any).__onDraftFocus = null;
      sidebar.remove();
    }
  };

  let slashOpen = false;
  let slashSelectionIndex = 0;
  let slashMatches: SlashCommand[] = [];

  const resolveSlashQueryAtCursor = (): string | null => {
    const value = input.value ?? "";
    const cursor = input.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const lastSlash = before.lastIndexOf("/");
    if (lastSlash < 0) return null;
    if (lastSlash > 0 && !/\s/.test(before[lastSlash - 1] ?? "")) return null;
    const fragment = before.slice(lastSlash, cursor);
    if (!/^\/[a-zA-Z-]*(?:\s+[a-zA-Z-]*)*$/.test(fragment)) return null;
    return fragment;
  };

  const findSlashMatches = (rawQuery: string): SlashCommand[] => {
    const q = normalizeSlash(rawQuery);
    if (!q.startsWith("/")) return [];
    const needle = q.slice(1);
    if (!needle) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((cmd) => {
      if (cmd.label.toLowerCase().startsWith(needle)) return true;
      return cmd.aliases.some((a) => normalizeSlash(a).slice(1).startsWith(needle));
    });
  };

  const closeSlashMenu = () => {
    slashOpen = false;
    slashMatches = [];
    slashSelectionIndex = 0;
    slashMenu.classList.add("is-hidden");
    slashMenu.replaceChildren();
  };

  const renderSlashMenu = (matches: SlashCommand[]) => {
    slashMenu.replaceChildren();
    if (matches.length === 0) {
      closeSlashMenu();
      return;
    }
    slashOpen = true;
    slashMatches = matches;
    slashSelectionIndex = Math.max(0, Math.min(slashSelectionIndex, matches.length - 1));
    slashMenu.classList.remove("is-hidden");
    const preferredAlias = (cmd: SlashCommand) =>
      cmd.aliases.find((a) => a.includes(" ")) ??
      cmd.aliases.find((a) => a.includes("-")) ??
      cmd.aliases[1] ??
      cmd.aliases[0] ??
      `/${cmd.label.toLowerCase()}`;
    for (let i = 0; i < matches.length; i += 1) {
      const cmd = matches[i]!;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "leditor-agent-sidebar__slashItem";
      if (i === slashSelectionIndex) row.classList.add("is-selected");
      row.textContent = `${cmd.label} (${cmd.aliases[0]})`;
      row.addEventListener("click", () => {
      input.value = preferredAlias(cmd);
        void run();
        closeSlashMenu();
      });
      slashMenu.appendChild(row);
    }
  };

  const maybeOpenSlashMenu = () => {
    const q = resolveSlashQueryAtCursor();
    if (!q) {
      closeSlashMenu();
      return;
    }
    renderSlashMenu(findSlashMatches(q));
  };

  actionPickerBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    renderActionMenu();
    if (actionMenu.classList.contains("is-hidden")) {
      openActionMenu();
    } else {
      closeActionMenu();
    }
  });

  modelPickerBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    renderModelMenu();
    if (modelMenu.classList.contains("is-hidden")) {
      openModelMenu();
    } else {
      closeModelMenu();
    }
  });

  const closeMenus = () => {
    closeModelMenu();
    closeActionMenu();
    closePlusMenu();
  };

  window.addEventListener("click", () => closeMenus());

  closeBtn.addEventListener("click", () => controller.close());

  sendBtn.addEventListener("click", () => {
    if (inflight) {
      try {
        abortController?.abort();
        const host = (window as any).leditorHost;
        if (activeRequestId && host && typeof host.agentCancel === "function") {
          void host.agentCancel({ requestId: activeRequestId });
        }
      } catch {
        // ignore
      } finally {
        addMessage("system", "Cancelled.");
        setInflight(false);
      }
      return;
    }
    void run();
  });

  plusBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (plusMenu.classList.contains("is-hidden")) {
      openPlusMenu();
    } else {
      closePlusMenu();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (slashOpen) {
        closeSlashMenu();
        return;
      }
      if (!plusMenu.classList.contains("is-hidden")) {
        closePlusMenu();
        return;
      }
      if (!actionMenu.classList.contains("is-hidden")) {
        closeActionMenu();
        return;
      }
      controller.close();
      return;
    }
    if (slashOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        slashSelectionIndex = Math.min(slashMatches.length - 1, slashSelectionIndex + 1);
        renderSlashMenu(slashMatches);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        slashSelectionIndex = Math.max(0, slashSelectionIndex - 1);
        renderSlashMenu(slashMatches);
        return;
      }
      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        const cmd = slashMatches[slashSelectionIndex];
        if (cmd) {
          const preferredAlias =
            cmd.aliases.find((a) => a.includes(" ")) ??
            cmd.aliases.find((a) => a.includes("-")) ??
            cmd.aliases[1] ??
            cmd.aliases[0] ??
            `/${cmd.label.toLowerCase()}`;
          input.value = preferredAlias;
          void run();
          closeSlashMenu();
        }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      void run();
      closeSlashMenu();
    }
  });

  input.addEventListener("input", () => {
    maybeOpenSlashMenu();
    updateInputOverlay();
  });

  input.addEventListener("focus", () => {
    maybeOpenSlashMenu();
    updateInputOverlay();
  });

  input.addEventListener("scroll", () => {
    updateInputOverlay();
  });

  input.addEventListener("keyup", () => {
    updateInputOverlay();
  });

  input.addEventListener("mouseup", () => {
    updateInputOverlay();
  });

  showNumbers.addEventListener("change", () => {
    try {
      editorHandle.execCommand("SetParagraphGrid", { enabled: showNumbers.checked });
    } catch {
      // ignore
    }
  });

  window.addEventListener("resize", syncInsets);
  syncInsets();
  seedHistoryMessages();
  renderMessages();
  updateInputOverlay();
  const host = (window as any).leditorHost;
  const loadStatus = async () => {
    if (host && typeof host.getLlmCatalog === "function") {
      try {
        const catalog = await host.getLlmCatalog();
        if (catalog?.success && Array.isArray(catalog?.providers)) {
          llmCatalog = { providers: catalog.providers as any };
        }
      } catch {
        // ignore
      }
    }
    if (host && typeof host.getLlmStatus === "function") {
      try {
        const status = await host.getLlmStatus();
        if (status?.success && Array.isArray(status?.providers)) {
          llmStatus = { providers: status.providers as any };
        }
      } catch {
        // ignore
      }
    } else if (host && typeof host.getAiStatus === "function") {
      // Backward compatibility (OpenAI-only hosts).
      try {
        await host.getAiStatus();
        // env status is reflected by disabling providers without keys in the provider menu.
      } catch {
        // ignore
      }
    }
  };

  void loadStatus().finally(() => {
    renderReady = true;
    renderModelPickerLabel();
  });

  return controller;
};
