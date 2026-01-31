import type { EditorHandle } from "../api/leditor.ts";
import { subscribeAiSettings } from "./ai_settings.ts";
import { Fragment } from "prosemirror-model";

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

export type AgentSidebarController = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
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

  const apiBadge = document.createElement("div");
  apiBadge.className = "leditor-agent-sidebar__apiBadge";
  apiBadge.textContent = "API: not used yet";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-agent-sidebar__close";
  closeBtn.textContent = "Close";

  headerRight.append(apiBadge, closeBtn);
  header.append(title, headerRight);

  let open = false;
  // Keep subscription to prevent stale settings references (and for future Agent settings),
  // but remove UI scope controls: agent targets are selected deterministically by paragraph index.
  const unsubscribeScope = subscribeAiSettings(() => undefined);

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

  const messagesEl = document.createElement("div");
  messagesEl.className = "leditor-agent-sidebar__messages";
  messagesEl.setAttribute("role", "log");
  messagesEl.setAttribute("aria-live", "polite");

  const draftList = document.createElement("div");
  draftList.className = "leditor-agent-sidebar__draftList";

  const composer = document.createElement("div");
  composer.className = "leditor-agent-sidebar__composer";

  const input = document.createElement("textarea");
  input.className = "leditor-agent-sidebar__input";
  input.placeholder = 'Try: "35 refine" or "35-38 simplify"';
  input.rows = 2;

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "leditor-agent-sidebar__send";
  sendBtn.textContent = "Send";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "leditor-agent-sidebar__cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.classList.add("is-hidden");

  composer.append(input, sendBtn, cancelBtn);

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

  const suggestionsHeader = document.createElement("div");
  suggestionsHeader.className = "leditor-agent-sidebar__suggestionsHeader";
  const suggestionsTitle = document.createElement("div");
  suggestionsTitle.className = "leditor-agent-sidebar__suggestionsTitle";
  suggestionsTitle.textContent = "Suggestions";
  const suggestionsMeta = document.createElement("div");
  suggestionsMeta.className = "leditor-agent-sidebar__suggestionsMeta";
  suggestionsMeta.textContent = "";
  suggestionsHeader.append(suggestionsTitle, suggestionsMeta);

  const suggestionsPanel = document.createElement("div");
  suggestionsPanel.className = "leditor-agent-sidebar__suggestionsPanel";
  suggestionsPanel.append(suggestionsHeader, draftList);

  sidebar.append(header, showNumbersRow, messagesEl, suggestionsPanel, composer, footer);
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

  const createMessageEl = (msg: AgentMessage): HTMLElement => {
    const row = document.createElement("div");
    row.className = `leditor-agent-sidebar__msg leditor-agent-sidebar__msg--${msg.role}`;
    const meta = document.createElement("div");
    meta.className = "leditor-agent-sidebar__msgMeta";
    meta.textContent = `${msg.role} • ${formatTimestamp(msg.ts)}`;
    const body = document.createElement("div");
    body.className = "leditor-agent-sidebar__msgBody";
    body.textContent = msg.content;
    row.append(meta, body);
    return row;
  };

  const renderApiBadge = () => {
    const parts: string[] = [];
    if (lastApiMeta?.provider) parts.push(String(lastApiMeta.provider));
    if (lastApiMeta?.model) parts.push(String(lastApiMeta.model));
    if (typeof lastApiMeta?.ms === "number") parts.push(`${Math.max(0, Math.round(lastApiMeta.ms))}ms`);

    const time =
      lastApiMeta?.ts ? ` • ${formatTimestamp(lastApiMeta.ts)}` : "";
    const envParts: string[] = [];
    if (!lastApiMeta?.model && envStatus?.model) {
      envParts.push(envStatus.modelFromEnv ? `envModel=${envStatus.model}` : `defaultModel=${envStatus.model}`);
    }
    if (envStatus && !envStatus.hasApiKey) envParts.push("key missing (OPENAI_API_KEY)");
    const env = envParts.length ? ` • ${envParts.join(" • ")}` : "";
    const base =
      parts.length > 0 ? `API: ${parts.join(" • ")}${time}${env}` : `API: not used yet${env}`;
    apiBadge.textContent = base;
    apiBadge.classList.toggle("is-ok", Boolean(lastApiMeta));
    apiBadge.classList.toggle("is-missing", Boolean(envStatus && !envStatus.hasApiKey));
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
    sendBtn.disabled = inflight;
    cancelBtn.classList.toggle("is-hidden", !inflight);
    acceptBtn.disabled = inflight || !pending;
    rejectBtn.disabled = inflight || !pending;
    sidebar.classList.toggle("is-busy", inflight);
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

  const applyRangeAsTransaction = (from: number, to: number, text: string) => {
    const editor = editorHandle.getEditor();
    const state = editor.state;
    const baseDoc = state.doc;
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
    draftList.replaceChildren();
    if (!pending || pending.kind !== "batchReplace" || pending.items.length === 0) return;
    suggestionsMeta.textContent = `${pending.items.length} change(s)`;
    for (const item of pending.items) {
      const row = document.createElement("div");
      row.className = "leditor-agent-sidebar__draftRow";
      const top = document.createElement("div");
      top.className = "leditor-agent-sidebar__draftTop";

      const label = document.createElement("div");
      label.className = "leditor-agent-sidebar__draftLabel";
      label.textContent = `P${item.n}`;
      const actions = document.createElement("div");
      actions.className = "leditor-agent-sidebar__draftActions";
      const btnApply = document.createElement("button");
      btnApply.type = "button";
      btnApply.className = "leditor-agent-sidebar__draftApply";
      btnApply.textContent = "Apply";
      const btnReject = document.createElement("button");
      btnReject.type = "button";
      btnReject.className = "leditor-agent-sidebar__draftReject";
      btnReject.textContent = "Reject";
      actions.append(btnApply, btnReject);
      top.append(label, actions);

      const draft = document.createElement("pre");
      draft.className = "leditor-agent-sidebar__draftText";
      draft.textContent = item.text;

      const original = document.createElement("details");
      original.className = "leditor-agent-sidebar__draftOriginal";
      const originalSummary = document.createElement("summary");
      originalSummary.textContent = "Show original";
      const originalBody = document.createElement("pre");
      originalBody.className = "leditor-agent-sidebar__draftOriginalText";
      originalBody.textContent = item.originalText;
      original.append(originalSummary, originalBody);

      row.append(top, draft, original);
      draftList.appendChild(row);

      btnApply.addEventListener("click", () => {
        try {
          const editor = editorHandle.getEditor();
          const current = editor.state.doc.textBetween(item.from, item.to, "\n").trim();
          if (current !== item.originalText.trim()) {
            throw new Error(`Document changed since draft for paragraph ${item.n}. Re-run the agent.`);
          }
          applyRangeAsTransaction(item.from, item.to, item.text);
          if (!pending || pending.kind !== "batchReplace") return;
          pending.items = pending.items.filter((x) => x.n !== item.n);
          const count = pending.items.length;
          pendingLabel.textContent = count ? `Draft ready • ${count} change(s)` : "";
          suggestionsMeta.textContent = count ? `${count} change(s)` : "";
          if (count === 0) {
            clearPending();
          } else {
            renderDraftList();
            syncDraftPreview();
          }
          addMessage("system", `Applied paragraph ${item.n}.`);
        } catch (error) {
          addMessage("assistant", `Error: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          editorHandle.focus();
        }
      });

      btnReject.addEventListener("click", () => {
        if (!pending || pending.kind !== "batchReplace") return;
        pending.items = pending.items.filter((x) => x.n !== item.n);
        const count = pending.items.length;
        pendingLabel.textContent = count ? `Draft ready • ${count} change(s)` : "";
        suggestionsMeta.textContent = count ? `${count} change(s)` : "";
        if (count === 0) {
          clearPending();
        } else {
          renderDraftList();
          syncDraftPreview();
        }
        addMessage("system", `Rejected paragraph ${item.n}.`);
        editorHandle.focus();
      });
    }
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
    const instruction = input.value.trim();
    if (!instruction) return;
    addMessage("user", instruction);
    input.value = "";
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
        addMessage("system", `Suggestions ready • ${count} change(s). Review inline in the document.`);
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
      const anchorMark = marks.find((m: any) => String(m?.type?.name ?? "") === "anchor");
      if (!anchorMark) return true;
      const attrs = anchorMark.attrs ?? {};
      const href = String(attrs.href ?? (attrs.dataDqid ? `dq://${attrs.dataDqid}` : "") ?? "");
      const title = String(attrs.title ?? "");
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

  const runCheckSources = async () => {
    const target = getIndicesForCurrentSelectionOrCursor();
    if (!target) {
      addMessage("system", "No sources to be checked.");
      return;
    }
    const anchors = collectAnchorsInRange(target.from, target.to);
    if (anchors.length === 0) {
      try {
        editorHandle.execCommand("ClearSourceChecks");
      } catch {
        // ignore
      }
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
      const editor = editorHandle.getEditor();
      const contextText = editor.state.doc.textBetween(target.from, target.to, "\n").trim();
      const requestId = `check-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await host.checkSources({
        requestId,
        payload: {
          contextText,
          anchors: anchors.map((a) => ({
            key: a.key,
            text: a.text,
            title: a.title,
            href: a.href,
            dataKey: a.dataKey,
            dataDqid: a.dataDqid,
            dataQuoteId: a.dataQuoteId
          }))
        }
      });
      if (!result?.success) {
        addMessage("assistant", result?.error ? String(result.error) : "Source check failed.");
        return;
      }
      const checksRaw = Array.isArray(result.checks) ? result.checks : [];
      const byKey = new Map<string, { verdict: string; justification: string }>();
      for (const c of checksRaw) {
        const key = typeof c?.key === "string" ? c.key : "";
        if (!key) continue;
        byKey.set(key, {
          verdict: c?.verdict === "verified" ? "verified" : "needs_review",
          justification: typeof c?.justification === "string" ? c.justification : ""
        });
      }
      const items = anchors
        .map((a) => {
          const check = byKey.get(a.key);
          if (!check) return null;
          return {
            key: a.key,
            from: a.from,
            to: a.to,
            verdict: check.verdict,
            justification:
              check.justification || (check.verdict === "verified" ? "Citation appears consistent." : "Check citation relevance.")
          };
        })
        .filter(Boolean);
      if (items.length === 0) {
        addMessage("system", "No sources to be checked.");
        return;
      }
      editorHandle.execCommand("SetSourceChecks", { items });
      addMessage("system", `Checked ${items.length} source(s).`);
    } finally {
      setInflight(false);
      editorHandle.focus();
    }
  };

  const applyActionTemplate = (actionId: AgentActionId) => {
    const target = getIndicesForCurrentSelectionOrCursor();
    if (!target) {
      addMessage("system", "Select text or place cursor in a paragraph, then run an action.");
      return;
    }
    const spec = formatIndexSpec(target.indices);
    const actions: any = (agentActionPrompts as any)?.actions ?? {};
    const entry = actions[actionId];
    const prompt =
      entry && typeof entry.prompt === "string" && entry.prompt.trim()
        ? entry.prompt.trim()
        : "Refine for clarity. Keep citations/anchors unchanged.";
    input.value = `${spec} ${prompt}`;
    void run();
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
          editorHandle.execCommand("ClearSourceChecks");
        } catch {
          // ignore
        }
        addMessage("system", "Cleared source checks.");
        return;
      }
      if (actionId === "check_sources") {
        void runCheckSources();
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

  closeBtn.addEventListener("click", () => controller.close());

  sendBtn.addEventListener("click", () => {
    void run();
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
      controller.close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void run();
    }
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
  renderMessages();
  const host = (window as any).leditorHost;
  if (host && typeof host.getAiStatus === "function") {
    host
      .getAiStatus()
      .then((status: any) => {
        const hasApiKey = Boolean(status?.hasApiKey);
        const model = String(status?.model || "").trim();
        const modelFromEnv = Boolean(status?.modelFromEnv);
        envStatus = { hasApiKey, model, modelFromEnv };
        renderApiBadge();
      })
      .catch(() => {
        // ignore
      });
  } else {
    renderApiBadge();
  }

  return controller;
};
