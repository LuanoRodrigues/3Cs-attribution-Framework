import type { EditorHandle } from "../api/leditor.ts";
import { getAiSettings, setAiSettings, subscribeAiSettings } from "./ai_settings.ts";
import { setSourceChecksVisible, upsertSourceChecksFromRun } from "./source_checks_thread.ts";
import { Fragment } from "prosemirror-model";
import agentActionPrompts from "./agent_action_prompts.json";

export type AgentMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
};

export type AgentRunRequest = {
  instruction: string;
};

export type AgentRunResult = {
  assistantText: string;
  meta?: { provider?: string; model?: string; ms?: number };
  apply?:
    | { kind: "replaceRange"; from: number; to: number; text: string }
    | { kind: "setDocument"; doc: object }
    | { kind: "insertAtCursor"; text: string }
    | {
        kind: "batchReplace";
        items: Array<{ n: number; from: number; to: number; text: string; originalText: string }>;
      };
};

export type AgentActionId =
  | "refine"
  | "paraphrase"
  | "shorten"
  | "substantiate"
  | "proofread"
  | "synonyms"
  | "antonyms"
  | "check_sources"
  | "clear_checks";

export type AgentSidebarController = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  runAction: (actionId: AgentActionId) => void;
  destroy: () => void;
};

type AgentSidebarOptions = {
  runAgent: (
    request: AgentRunRequest,
    editorHandle: EditorHandle,
    progress?: (message: string) => void,
    signal?: AbortSignal,
    requestId?: string
  ) => Promise<AgentRunResult>;
};

const APP_OPEN_CLASS = "leditor-app--agent-open";
const ROOT_ID = "leditor-agent-sidebar";

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
  const title = document.createElement("div");
  title.className = "leditor-agent-sidebar__title";
  title.textContent = "Agent";

  const headerRight = document.createElement("div");
  headerRight.className = "leditor-agent-sidebar__headerRight";

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

  const apiBadge = document.createElement("div");
  apiBadge.className = "leditor-agent-sidebar__apiBadge";
  apiBadge.textContent = "API: not used yet";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-agent-sidebar__close";
  closeBtn.textContent = "Close";

  headerRight.append(modelPickerWrap, apiBadge, closeBtn);
  header.append(title, headerRight);

  let open = false;
  // Keep subscription to prevent stale settings references (and for future Agent settings),
  // but remove UI scope controls: agent targets are selected deterministically by paragraph index.
  let currentSettings = getAiSettings();
  let renderReady = false;
  const unsubscribeScope = subscribeAiSettings((settings) => {
    currentSettings = settings;
    if (renderReady) {
      renderApiBadge();
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

  const showNumbersRow = document.createElement("div");
  showNumbersRow.className = "leditor-agent-sidebar__numbersRow";
  const showNumbersLabel = document.createElement("label");
  showNumbersLabel.className = "leditor-agent-sidebar__checkboxRow";
  const showNumbers = document.createElement("input");
  showNumbers.type = "checkbox";
  showNumbers.checked = true;
  const showNumbersText = document.createElement("span");
  showNumbersText.textContent = "Show paragraph numbers";
  showNumbersLabel.append(showNumbers, showNumbersText);
  showNumbersRow.appendChild(showNumbersLabel);

  const actionsPanel = document.createElement("div");
  actionsPanel.className = "leditor-agent-sidebar__actionsPanel";
  const actionsTitle = document.createElement("div");
  actionsTitle.className = "leditor-agent-sidebar__actionsTitle";
  actionsTitle.textContent = "Actions";
  const actionsRow = document.createElement("div");
  actionsRow.className = "leditor-agent-sidebar__actionsRow";
  actionsPanel.append(actionsTitle, actionsRow);

  const parsePills = document.createElement("div");
  parsePills.className = "leditor-agent-sidebar__parsePills";

  const messagesEl = document.createElement("div");
  messagesEl.className = "leditor-agent-sidebar__messages";
  messagesEl.setAttribute("role", "log");
  messagesEl.setAttribute("aria-live", "polite");

  const draftList = document.createElement("div");
  draftList.className = "leditor-agent-sidebar__draftList";

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

  const micBtn = document.createElement("button");
  micBtn.type = "button";
  micBtn.className = "leditor-agent-sidebar__iconBtn";
  micBtn.setAttribute("aria-label", "Dictation");
  micBtn.disabled = true;
  micBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19v3"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><rect x="9" y="2" width="6" height="13" rx="3"></rect></svg>';

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "leditor-agent-sidebar__sendIcon";
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>';

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "leditor-agent-sidebar__cancelIcon";
  cancelBtn.setAttribute("aria-label", "Cancel");
  cancelBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
  cancelBtn.classList.add("is-hidden");

  inputGrid.append(inputOverlay, input);
  inputShell.appendChild(inputGrid);
  inputWrap.append(inputShell, slashMenu);
  composerInner.append(plusBtn, inputWrap, micBtn, sendBtn, cancelBtn);
  composer.appendChild(composerInner);

  const footer = document.createElement("div");
  footer.className = "leditor-agent-sidebar__footer";
  const pendingLabel = document.createElement("div");
  pendingLabel.className = "leditor-agent-sidebar__pending";
  pendingLabel.textContent = "";
  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "leditor-agent-sidebar__reject";
  rejectBtn.textContent = "Reject";
  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className = "leditor-agent-sidebar__accept";
  acceptBtn.textContent = "Accept";
  footer.append(pendingLabel, rejectBtn, acceptBtn);

  // Intentionally omit the "Suggestions" panel UI: drafts are reviewed inline in the document.
  const suggestionsMeta = document.createElement("div");
  suggestionsMeta.className = "leditor-agent-sidebar__suggestionsMeta";
  suggestionsMeta.textContent = "";

  sidebar.append(header, showNumbersRow, actionsPanel, parsePills, messagesEl, composer, footer);
  root.appendChild(sidebar);

  let messages: AgentMessage[] = [
    {
      role: "system",
      content:
        "Agent is ready. Reference paragraphs by index only (e.g. 35, 35-38, 35,37) then add your instruction.",
      ts: Date.now()
    }
  ];
  let inflight = false;
  let destroyed = false;
  let pending: AgentRunResult["apply"] | null = null;
  let lastApiMeta: { provider?: string; model?: string; ms?: number; ts: number } | null = null;
  let envStatus: { hasApiKey: boolean; model: string; modelFromEnv: boolean } | null = null;
  let abortController: AbortController | null = null;
  let activeRequestId: string | null = null;

  const makeRequestId = () => `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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
    { id: "synonyms", label: "Synonyms", aliases: ["/syn", "/synonyms"] },
    { id: "antonyms", label: "Antonyms", aliases: ["/ant", "/antonyms"] },
    { id: "check_sources", label: "Check sources", aliases: ["/cs", "/check", "/check-sources", "/check sources", "/checksources"] },
    { id: "clear_checks", label: "Clear checks", aliases: ["/cc", "/clear", "/clear-checks", "/clear checks", "/clearchecks"] }
  ];

  const normalizeSlash = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");

  const escapeHtml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");

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
    addMatches(/\B\/(?:refine|paraphrase|shorten|proofread|substantiate|synonyms|antonyms)\b/gi, "cmd");
    addMatches(/\B\/check(?:\s+sources)?\b/gi, "cmd");
    addMatches(/\B\/clear(?:\s+checks)?\b/gi, "cmd");
    addMatches(/\b(?:refine|paraphrase|shorten|proofread|substantiate|synonyms|antonyms)\b/gi, "cmd");
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
      { re: /\B\/synonyms\b/gi, id: "synonyms" },
      { re: /\B\/antonyms\b/gi, id: "antonyms" },
      { re: /\B\/check(?:\s+sources)?\b/gi, id: "check_sources" },
      { re: /\B\/clear(?:\s+checks)?\b/gi, id: "clear_checks" },
      { re: /\brefine\b/gi, id: "refine" },
      { re: /\bparaphrase\b/gi, id: "paraphrase" },
      { re: /\bshorten\b/gi, id: "shorten" },
      { re: /\bproofread\b/gi, id: "proofread" },
      { re: /\bsubstantiate\b/gi, id: "substantiate" },
      { re: /\bsynonyms\b/gi, id: "synonyms" },
      { re: /\bantonyms\b/gi, id: "antonyms" },
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

  const getModelLabel = (providerId: string, modelId: string): string => {
    const provider = (Array.isArray(llmCatalog?.providers) ? llmCatalog!.providers : []).find(
      (p) => String(p.id) === providerId
    );
    const models = Array.isArray(provider?.models) ? (provider!.models as CatalogModel[]) : [];
    const found = models.find((m) => String(m.id) === modelId);
    const label = typeof found?.label === "string" ? found.label : "";
    return label || modelId;
  };

  const resolveSelectedModelId = (): { provider: string; model: string; envKey?: string; hasKey?: boolean } => {
    const provider = String((currentSettings as any)?.provider ?? "openai");
    const explicitModel = String(currentSettings?.model ?? "").trim();
    const status = getProviderStatus(provider);
    const model = explicitModel || String(status?.defaultModel ?? "").trim() || "codex-mini-latest";
    return { provider, model, envKey: status?.envKey, hasKey: status?.hasApiKey };
  };

  const renderModelPickerLabel = () => {
    const sel = resolveSelectedModelId();
    modelPickerLabel.textContent = `${getProviderLabel(sel.provider)} • ${getModelLabel(sel.provider, sel.model)}`;
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
      const groupTitle = document.createElement("div");
      groupTitle.className = "leditor-agent-sidebar__modelGroupTitle";
      groupTitle.textContent = getProviderLabel(providerId);
      modelMenu.appendChild(groupTitle);

      const status = getProviderStatus(providerId);
      const hasKey = status ? Boolean(status.hasApiKey) : true;
      const models = Array.isArray(provider.models) ? (provider.models as CatalogModel[]) : [];
      for (const model of models) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "leditor-agent-sidebar__modelOption";
        btn.setAttribute("role", "menuitem");
        btn.disabled = !hasKey;

        const name = document.createElement("div");
        name.className = "leditor-agent-sidebar__modelOptionName";
        name.textContent = getModelLabel(providerId, String(model.id));
        const desc = document.createElement("div");
        desc.className = "leditor-agent-sidebar__modelOptionDesc";
        desc.textContent = typeof model.description === "string" ? model.description : "";

        btn.append(name, desc);
        btn.addEventListener("click", () => {
          setAiSettings({ provider: providerId as any, model: String(model.id) } as any);
          closeModelMenu();
        });
        modelMenu.appendChild(btn);
      }
    }
    if (!providers.length) {
      const empty = document.createElement("div");
      empty.className = "leditor-agent-sidebar__modelEmpty";
      empty.textContent = "Models unavailable in this host.";
      modelMenu.appendChild(empty);
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

  const renderApiBadge = () => {
    const sel = resolveSelectedModelId();
    const parts: string[] = [];
    if (lastApiMeta?.provider) parts.push(String(lastApiMeta.provider));
    if (lastApiMeta?.model) parts.push(String(lastApiMeta.model));
    if (typeof lastApiMeta?.ms === "number") parts.push(`${Math.max(0, Math.round(lastApiMeta.ms))}ms`);

    const time =
      lastApiMeta?.ts ? ` • ${formatTimestamp(lastApiMeta.ts)}` : "";
    const envParts: string[] = [];
    envParts.push(`provider=${sel.provider}`);
    envParts.push(`model=${sel.model}`);
    if (sel.hasKey === false) {
      envParts.push(`key missing (${sel.envKey || "API key"})`);
    }
    const env = envParts.length ? ` • ${envParts.join(" • ")}` : "";
    const base =
      parts.length > 0 ? `API: ${parts.join(" • ")}${time}${env}` : `API: not used yet${env}`;
    apiBadge.textContent = base;
    apiBadge.classList.toggle("is-ok", Boolean(lastApiMeta));
    apiBadge.classList.toggle("is-missing", Boolean(sel.hasKey === false));
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

  const setInflight = (value: boolean) => {
    inflight = value;
    input.disabled = inflight;
    // sendBtn disabled state is computed in updateComposerState()
    cancelBtn.classList.toggle("is-hidden", !inflight);
    acceptBtn.disabled = inflight || !pending;
    rejectBtn.disabled = inflight || !pending;
    sidebar.classList.toggle("is-busy", inflight);
    updateComposerState();
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
    sendBtn.disabled = inflight || !hasText;
    plusBtn.disabled = inflight;
    micBtn.disabled = true;
  };

  const addMessage = (role: AgentMessage["role"], content: string) => {
    const prevLen = messages.length;
    messages = clampHistory([...messages, { role, content, ts: Date.now() }], 50);
    const clamped = messages.length !== prevLen + 1;
    renderMessages(clamped);
  };

  const syncInsets = () => {
    const bottom = getStatusBarHeight();
    sidebar.style.bottom = bottom > 0 ? `${Math.ceil(bottom)}px` : "";
  };

  const clearPending = () => {
    pending = null;
    pendingLabel.textContent = "";
    draftList.replaceChildren();
    suggestionsMeta.textContent = "";
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    try {
      editorHandle.execCommand("ClearAiDraftPreview");
    } catch {
      // ignore
    }
  };

  const buildTextblockReplacementFragment = (doc: any, from: number, to: number, text: string) => {
    const $from = doc.resolve(from);

    const protectedMarkNames = new Set(["anchor", "link"]);

    let blockDepth = -1;
    let blockNode: any = null;
    let blockStart = 0;
    for (let d = $from.depth; d >= 0; d -= 1) {
      const node = $from.node(d);
      if (!node?.isTextblock) continue;
      const start = $from.start(d);
      const contentFrom = start + 1;
      const contentTo = start + node.nodeSize - 1;
      if (contentFrom === from && contentTo === to) {
        blockDepth = d;
        blockNode = node;
        blockStart = start;
        break;
      }
    }

    if (!blockNode || blockDepth < 0) return null;

    const protectedSegments: Array<{ text: string; marks: any[] }> = [];
    blockNode.descendants((node: any) => {
      if (!node?.isText) return;
      const marks = Array.isArray(node.marks)
        ? node.marks.filter((m: any) => protectedMarkNames.has(String(m?.type?.name ?? "")))
        : [];
      if (marks.length === 0) return;
      protectedSegments.push({ text: String(node.text ?? ""), marks });
    });

    const schema = doc.type.schema;
    const nodes: any[] = [];
    const nextText = String(text ?? "");
    let cursor = 0;
    let searchFrom = 0;
    for (const seg of protectedSegments) {
      if (!seg.text) continue;
      const idx = nextText.indexOf(seg.text, searchFrom);
      if (idx < 0) continue;
      const before = nextText.slice(cursor, idx);
      if (before) nodes.push(schema.text(before));
      nodes.push(schema.text(seg.text, seg.marks));
      cursor = idx + seg.text.length;
      searchFrom = cursor;
    }
    const after = nextText.slice(cursor);
    if (after) nodes.push(schema.text(after));

    return Fragment.fromArray(nodes);
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
    const anchors = extractAnchorTextsInRange(doc, from, to);
    if (anchors.length === 0) return;
    const originalText = String(doc.textBetween(from, to, "\n") ?? "");
    const proposed = String(nextText ?? "");
    for (const anchorText of anchors) {
      const originalCount = countOccurrences(originalText, anchorText);
      const nextCount = countOccurrences(proposed, anchorText);
      if (nextCount < originalCount) {
        throw new Error(`Anchor/citation text must be preserved exactly. Missing or altered: "${anchorText}".`);
      }
    }
  };

  const applyRangeAsTransaction = (from: number, to: number, text: string) => {
    const editor = editorHandle.getEditor();
    const state = editor.state;
    const baseDoc = state.doc;
    assertAnchorsPreserved(baseDoc, from, to, text);
    const fragment = buildTextblockReplacementFragment(baseDoc, from, to, text);
    const tr = fragment ? state.tr.replaceWith(from, to, fragment as any) : state.tr.insertText(text, from, to);
    tr.setMeta("leditor-ai", { kind: "agent", ts: Date.now() });
    editor.view.dispatch(tr);
    editor.commands.focus();
  };

  const applyBatchAsTransaction = (items: Array<{ from: number; to: number; text: string }>) => {
    const editor = editorHandle.getEditor();
    const state = editor.state;
    const baseDoc = state.doc;
    for (const item of items) {
      assertAnchorsPreserved(baseDoc, item.from, item.to, item.text);
    }
    const sorted = [...items].sort((a, b) => b.from - a.from);
    let tr = state.tr;
    for (const item of sorted) {
      const fragment = buildTextblockReplacementFragment(baseDoc, item.from, item.to, item.text);
      tr = fragment ? tr.replaceWith(item.from, item.to, fragment as any) : tr.insertText(item.text, item.from, item.to);
    }
    tr.setMeta("leditor-ai", { kind: "agent", ts: Date.now(), items: sorted.length });
    editor.view.dispatch(tr);
    editor.commands.focus();
  };

  const syncDraftPreview = () => {
    try {
      if (!pending) {
        editorHandle.execCommand("ClearAiDraftPreview");
        return;
      }
      if (pending.kind === "replaceRange") {
        editorHandle.execCommand("SetAiDraftPreview", {
          items: [
            {
              n: 0,
              from: pending.from,
              to: pending.to,
              proposedText: pending.text
            }
          ]
        });
        return;
      }
      if (pending.kind === "batchReplace") {
        editorHandle.execCommand("SetAiDraftPreview", {
          items: pending.items.map((it) => ({
            n: it.n,
            from: it.from,
            to: it.to,
            proposedText: it.text,
            originalText: it.originalText
          }))
        });
        return;
      }
    } catch {
      // ignore
    }
  };

  const renderDraftList = () => {
    // Intentionally no suggestions UI list; drafts are previewed inline in the document.
    suggestionsMeta.textContent =
      pending && pending.kind === "batchReplace" ? `${pending.items.length} change(s)` : "";
  };

  const applyPending = () => {
    if (!pending) return;
    const editor = editorHandle.getEditor();
    if (pending.kind === "replaceRange") {
      applyRangeAsTransaction(pending.from, pending.to, pending.text);
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
      applyBatchAsTransaction(items.map((it) => ({ from: it.from, to: it.to, text: it.text })));
      return;
    }
    throw new Error(`AgentSidebar: unknown apply kind "${(pending as any).kind}"`);
  };

  const run = async () => {
    if (destroyed) return;
    let instruction = input.value.trim();
    if (!instruction) return;
    // Keep target + action pills in sync with what will be sent.
    renderParsePills();
    const parsedTargets = parseTargetsFromText(instruction);
    if (parsedTargets.kind === "paragraphs" || parsedTargets.kind === "section") {
      const targetIndices = parsedTargets.kind === "paragraphs" ? parsedTargets.indices : parsedTargets.indices;
      const normalized = instruction.toLowerCase();
      if (
        /\bcheck\s+sources?\b/i.test(normalized) ||
        /\bverify\s+sources?\b/i.test(normalized) ||
        /\bcheck\s+citations?\b/i.test(normalized)
      ) {
        addMessage("user", instruction);
        input.value = "";
        autoResizeInput();
        updateInputOverlay();
        await runCheckSourcesForParagraphs(targetIndices);
        return;
      }
    }
    const inlineSlash = findInlineSlashCommand(instruction);
    if (inlineSlash) {
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
      if (inlineSlash.id === "synonyms" || inlineSlash.id === "antonyms") {
        addMessage("user", instruction);
        input.value = "";
        autoResizeInput();
        controller.runAction(inlineSlash.id);
        return;
      }
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
    }

    addMessage("user", instruction);
    input.value = "";
    autoResizeInput();
    updateInputOverlay();
    setInflight(true);
    try {
      clearPending();
      const progress = (message: string) => addMessage("system", message);
      const request: AgentRunRequest = { instruction };
      abortController = new AbortController();
      activeRequestId = makeRequestId();
      const result = await options.runAgent(request, editorHandle, progress, abortController.signal, activeRequestId);
      if (abortController.signal.aborted) {
        addMessage("assistant", "Cancelled.");
        return;
      }
      if (result.meta && (result.meta.provider || result.meta.model || typeof result.meta.ms === "number")) {
        lastApiMeta = { ...result.meta, ts: Date.now() };
        renderApiBadge();
      }
      pending = result.apply ?? null;
      if (pending) {
        const count = pending.kind === "batchReplace" ? pending.items.length : 1;
        pendingLabel.textContent = `Draft ready • ${count} change(s)`;
        renderDraftList();
        syncDraftPreview();
      } else {
        addMessage("assistant", (result.assistantText || "(no response)").trim());
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

  const renderParsePills = () => {
    parsePills.replaceChildren();
    const value = String(input.value ?? "").trim();
    if (!value) return;
    const targets = parseTargetsFromText(value);
    const inlineSlash = findInlineSlashCommand(value);

    const addPill = (label: string, kind: "target" | "action") => {
      const pill = document.createElement("span");
      pill.className = `leditor-agent-sidebar__pill leditor-agent-sidebar__pill--${kind}`;
      pill.textContent = label;
      parsePills.appendChild(pill);
    };

    if (targets.kind === "paragraphs") {
      addPill(`Targets: P${formatIndexSpec(targets.indices)}`, "target");
    }
    if (targets.kind === "section") {
      const spec = targets.indices.length ? `P${formatIndexSpec(targets.indices)}` : "no paragraphs";
      addPill(`Targets: Section ${targets.sectionNumber} (${spec})`, "target");
    }
    if (inlineSlash) {
      const label = SLASH_COMMANDS.find((c) => c.id === inlineSlash.id)?.label ?? inlineSlash.id;
      addPill(`Action: ${label}`, "action");
    }
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

  const getActionPrompt = (actionId: AgentActionId): string => {
    const actions: any = (agentActionPrompts as any)?.actions ?? {};
    const entry = actions[actionId];
    const prompt =
      entry && typeof entry.prompt === "string" && entry.prompt.trim()
        ? entry.prompt.trim()
        : "Refine for clarity. Keep citations/anchors unchanged.";
    return prompt;
  };

  const applyActionTemplate = (actionId: AgentActionId) => {
    const target = getIndicesForCurrentSelectionOrCursor();
    if (!target) {
      addMessage("system", "Select text or place cursor in a paragraph, then run an action.");
      return;
    }
    const spec = formatIndexSpec(target.indices);
    const prompt = getActionPrompt(actionId);
    input.value = `${spec} ${prompt}`;
    void run();
  };

  const selectionHasAnchors = (from: number, to: number): boolean => {
    const editor = editorHandle.getEditor();
    let found = false;
    editor.state.doc.nodesBetween(from, to, (node: any) => {
      if (!node?.isText) return true;
      const marks = Array.isArray(node.marks) ? node.marks : [];
      if (marks.some((m: any) => isCitationLikeMark(m))) {
        found = true;
        return false;
      }
      return true;
    });
    return found;
  };

  const lexiconPanel = document.createElement("div");
  lexiconPanel.className = "leditor-agent-sidebar__lexiconPanel";
  lexiconPanel.classList.add("is-hidden");
  const lexiconTitle = document.createElement("div");
  lexiconTitle.className = "leditor-agent-sidebar__lexiconTitle";
  const lexiconRow = document.createElement("div");
  lexiconRow.className = "leditor-agent-sidebar__lexiconRow";
  lexiconPanel.append(lexiconTitle, lexiconRow);
  actionsPanel.appendChild(lexiconPanel);

  const clearLexicon = () => {
    lexiconTitle.textContent = "";
    lexiconRow.replaceChildren();
    lexiconPanel.classList.add("is-hidden");
  };

  const runLexicon = async (mode: "synonyms" | "antonyms") => {
    const editor = editorHandle.getEditor();
    const sel = editor.state.selection;
    const from = Math.min(sel.from, sel.to);
    const to = Math.max(sel.from, sel.to);
    if (from === to) {
      addMessage("system", "Select a word or phrase first.");
      return;
    }
    if (selectionHasAnchors(from, to)) {
      addMessage("system", "Cannot replace anchored/cited text. Adjust your selection.");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, "\n").trim();
    if (!selectedText) {
      addMessage("system", "Select a word or phrase first.");
      return;
    }
    const host: any = (window as any).leditorHost;
    if (!host || typeof host.lexicon !== "function") {
      addMessage("assistant", "Lexicon host bridge unavailable.");
      return;
    }
    clearLexicon();
    setInflight(true);
    try {
      const sel = resolveSelectedModelId();
      const requestId = `lex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await host.lexicon({
        requestId,
        payload: {
          provider: sel.provider,
          model: sel.model,
          mode,
          text: selectedText
        }
      });
      if (!result?.success) {
        addMessage("assistant", result?.error ? String(result.error) : "Lexicon request failed.");
        return;
      }
      const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
      const normalized = suggestions
        .map((s: any) => (typeof s === "string" ? s : typeof s?.text === "string" ? s.text : ""))
        .map((s: string) => s.trim())
        .filter(Boolean)
        .slice(0, 4);
      if (normalized.length === 0) {
        addMessage("system", "No suggestions.");
        return;
      }
      lexiconTitle.textContent = mode === "synonyms" ? "Synonyms" : "Antonyms";
      for (const suggestion of normalized) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "leditor-agent-sidebar__lexiconBtn";
        btn.textContent = suggestion;
        btn.addEventListener("click", () => {
          try {
            editor.chain().focus().insertContent(suggestion).run();
            addMessage("system", `Applied ${mode.slice(0, -1)}.`);
          } finally {
            clearLexicon();
            editorHandle.focus();
          }
        });
        lexiconRow.appendChild(btn);
      }
      lexiconPanel.classList.remove("is-hidden");
    } finally {
      setInflight(false);
      editorHandle.focus();
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

  const extractCitationContext = (
    paragraphText: string,
    anchors: Array<{ text: string; key: string }>
  ): Map<string, { start: number; end: number; sentence: string; before: string; after: string }> => {
    const text = String(paragraphText ?? "");
    const out = new Map<string, { start: number; end: number; sentence: string; before: string; after: string }>();
    let searchFrom = 0;
    const findSentenceBounds = (idx: number): { start: number; end: number } => {
      const clamp = (v: number) => Math.max(0, Math.min(text.length, v));
      const i = clamp(idx);
      const leftSlice = text.slice(0, i);
      const rightSlice = text.slice(i);
      const leftBoundary = Math.max(
        leftSlice.lastIndexOf("."),
        leftSlice.lastIndexOf("?"),
        leftSlice.lastIndexOf("!"),
        leftSlice.lastIndexOf(";"),
        leftSlice.lastIndexOf("\n")
      );
      const start = clamp(leftBoundary >= 0 ? leftBoundary + 1 : 0);
      const rightCandidates = [rightSlice.indexOf("."), rightSlice.indexOf("?"), rightSlice.indexOf("!"), rightSlice.indexOf(";"), rightSlice.indexOf("\n")]
        .filter((n) => n >= 0)
        .map((n) => i + n + 1);
      const end = clamp(rightCandidates.length ? Math.min(...rightCandidates) : text.length);
      return { start, end };
    };
    for (const a of anchors) {
      const needle = String(a.text ?? "");
      if (!needle) continue;
      let idx = text.indexOf(needle, searchFrom);
      if (idx < 0) idx = text.indexOf(needle);
      if (idx >= 0) searchFrom = idx + needle.length;
      const anchorIdx = idx >= 0 ? idx : 0;
      const bounds = findSentenceBounds(anchorIdx);
      const sentence = text.slice(bounds.start, bounds.end).replace(/\s+/g, " ").trim();
      const before = text.slice(Math.max(0, anchorIdx - 140), anchorIdx).replace(/\s+/g, " ").trim();
      const after = text.slice(anchorIdx + needle.length, Math.min(text.length, anchorIdx + needle.length + 140)).replace(/\s+/g, " ").trim();
      out.set(String(a.key), { start: bounds.start, end: bounds.end, sentence, before, after });
    }
    return out;
  };

  const runCheckSources = async () => {
    const target = getIndicesForCurrentSelectionOrCursor();
    if (!target) {
      addMessage("system", "No sources to be checked.");
      return;
    }
    await runCheckSourcesForParagraphs(target.indices);
  };

  const runCheckSourcesForParagraphs = async (indices: number[]) => {
    const ranges = listParagraphRanges();
    const byN = new Map<number, { n: number; from: number; to: number }>();
    for (const r of ranges) byN.set(r.n, r);
    const selected = indices
      .map((n) => byN.get(n))
      .filter(Boolean) as Array<{ n: number; from: number; to: number }>;
    if (selected.length === 0) {
      addMessage("system", "No sources to be checked.");
      return;
    }

    const host: any = (window as any).leditorHost;
    if (!host || typeof host.checkSources !== "function") {
      addMessage("assistant", "Source checking host bridge unavailable.");
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
        const sel = resolveSelectedModelId();
        const requestPayload = {
          provider: sel.provider,
          model: sel.model,
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
        const requestId = `check-${paragraph.n}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const result = await host.checkSources({ requestId, payload: requestPayload });
        if (!result?.success) {
          addMessage("assistant", result?.error ? String(result.error) : "Source check failed.");
          continue;
        }
        const checksRaw = Array.isArray(result.checks) ? result.checks : [];
        const byKey = new Map<string, { verdict: "verified" | "needs_review"; justification: string }>();
        for (const c of checksRaw) {
          const key = typeof c?.key === "string" ? c.key : "";
          if (!key) continue;
          byKey.set(key, {
            verdict: c?.verdict === "verified" ? "verified" : "needs_review",
            justification: typeof c?.justification === "string" ? c.justification : ""
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
            model: requestPayload.model,
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
      setSourceChecksVisible(true);
      addMessage("system", `Checked ${allItems.length} source(s).`);
    } finally {
      setInflight(false);
      editorHandle.focus();
    }
  };

  const renderActions = () => {
    const order: AgentActionId[] = [
      "refine",
      "paraphrase",
      "shorten",
      "proofread",
      "substantiate",
      "synonyms",
      "antonyms",
      "check_sources",
      "clear_checks"
    ];
    actionsRow.replaceChildren();
    for (const id of order) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "leditor-agent-sidebar__actionBtn";
      const label =
        id === "check_sources"
          ? "Check sources"
          : id === "clear_checks"
            ? "Clear checks"
            : id === "synonyms"
              ? "Synonyms"
              : id === "antonyms"
                ? "Antonyms"
            : ((agentActionPrompts as any)?.actions?.[id]?.label as string | undefined) ?? id;
      btn.textContent = label;
      btn.addEventListener("click", () => controller.runAction(id));
      actionsRow.appendChild(btn);
    }
  };

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
      renderActions();
      renderParsePills();
      renderMessages();
      input.focus();
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
    },
    toggle() {
      if (destroyed) return;
      if (open) controller.close();
      else controller.open();
    },
    isOpen() {
      return open;
    },
    runAction(actionId: AgentActionId) {
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
      if (actionId === "synonyms") {
        void runLexicon("synonyms");
        return;
      }
      if (actionId === "antonyms") {
        void runLexicon("antonyms");
        return;
      }
      applyActionTemplate(actionId);
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
      clearPending();
      unsubscribeScope();
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

  window.addEventListener("click", () => closeModelMenu());

  closeBtn.addEventListener("click", () => controller.close());

  sendBtn.addEventListener("click", () => {
    void run();
  });

  plusBtn.addEventListener("click", () => {
    // Placeholder for future attachments/actions menu.
    input.focus();
  });

  cancelBtn.addEventListener("click", () => {
    try {
      abortController?.abort();
      const host = (window as any).leditorHost;
      if (activeRequestId && host && typeof host.agentCancel === "function") {
        void host.agentCancel({ requestId: activeRequestId });
      }
      addMessage("system", "Cancelled.");
    } catch {
      // ignore
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (slashOpen) {
        closeSlashMenu();
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
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void run();
      return;
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      // Allow exact slash commands with Enter.
      const raw = String(input.value ?? "").trim();
      if (raw.startsWith("/")) {
        const normalized = normalizeSlash(raw);
        const cmd = SLASH_COMMANDS.find((c) => c.aliases.map((a) => normalizeSlash(a)).includes(normalized));
        if (cmd) {
          event.preventDefault();
          void run();
          closeSlashMenu();
          return;
        }
      }
    }
  });

  input.addEventListener("input", () => {
    maybeOpenSlashMenu();
    renderParsePills();
    updateInputOverlay();
  });

  input.addEventListener("focus", () => {
    maybeOpenSlashMenu();
    renderParsePills();
    updateInputOverlay();
  });

  input.addEventListener("input", () => {
    maybeOpenSlashMenu();
    renderParsePills();
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

  acceptBtn.addEventListener("click", () => {
    try {
      applyPending();
      clearPending();
      addMessage("system", "Applied.");
    } catch (error) {
      addMessage("assistant", `Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      editorHandle.focus();
    }
  });

  rejectBtn.addEventListener("click", () => {
    clearPending();
    addMessage("system", "Rejected.");
    editorHandle.focus();
  });

  window.addEventListener("resize", syncInsets);
  syncInsets();
  renderActions();
  renderParsePills();
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
        const status: any = await host.getAiStatus();
        const hasApiKey = Boolean(status?.hasApiKey);
        const model = String(status?.model || "").trim();
        const modelFromEnv = Boolean(status?.modelFromEnv);
        envStatus = { hasApiKey, model, modelFromEnv };
      } catch {
        // ignore
      }
    }
  };

  void loadStatus().finally(() => {
    renderReady = true;
    renderModelPickerLabel();
    renderApiBadge();
  });

  return controller;
};
