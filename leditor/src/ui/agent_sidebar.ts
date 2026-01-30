import type { EditorHandle } from "../api/leditor.ts";
import { getAiSettings, subscribeAiSettings } from "./ai_settings.ts";

export type AgentScope = "selection" | "paragraphs" | "section" | "document";

export type AgentMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
};

export type AgentRunRequest = {
  instruction: string;
  scope: AgentScope;
  range?: { from: number; to: number };
  section?: number;
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

  const scopeRow = document.createElement("div");
  scopeRow.className = "leditor-agent-sidebar__scope";

  let open = false;
  let scope: AgentScope = getAiSettings().defaultScope;

  const scopeLabel = document.createElement("div");
  scopeLabel.className = "leditor-agent-sidebar__scopeLabel";
  scopeLabel.textContent = "Scope";

  const scopeSelect = document.createElement("select");
  scopeSelect.className = "leditor-agent-sidebar__scopeSelect";
  const selectionOption = document.createElement("option");
  selectionOption.value = "selection";
  selectionOption.textContent = "Selection";
  const paragraphsOption = document.createElement("option");
  paragraphsOption.value = "paragraphs";
  paragraphsOption.textContent = "Paragraphs";
  const sectionOption = document.createElement("option");
  sectionOption.value = "section";
  sectionOption.textContent = "Section";
  const docOption = document.createElement("option");
  docOption.value = "document";
  docOption.textContent = "Document";
  scopeSelect.append(selectionOption, paragraphsOption, sectionOption, docOption);
  scopeSelect.value = scope;
  scopeRow.append(scopeLabel, scopeSelect);

  const rangeFrom = document.createElement("input");
  rangeFrom.className = "leditor-agent-sidebar__scopeInput";
  rangeFrom.type = "number";
  rangeFrom.min = "1";
  rangeFrom.placeholder = "From";

  const rangeTo = document.createElement("input");
  rangeTo.className = "leditor-agent-sidebar__scopeInput";
  rangeTo.type = "number";
  rangeTo.min = "1";
  rangeTo.placeholder = "To";

  const sectionInput = document.createElement("input");
  sectionInput.className = "leditor-agent-sidebar__scopeInput";
  sectionInput.type = "number";
  sectionInput.min = "1";
  sectionInput.placeholder = "Section #";

  const scopeExtras = document.createElement("div");
  scopeExtras.className = "leditor-agent-sidebar__scopeExtras";
  scopeExtras.append(rangeFrom, rangeTo, sectionInput);
  scopeRow.appendChild(scopeExtras);

  const unsubscribeScope = subscribeAiSettings((next) => {
    if (open) return;
    scopeSelect.value = next.defaultScope;
    scope = next.defaultScope;
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
  input.placeholder = 'Try: "Rewrite in formal tone"';
  input.rows = 2;

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "leditor-agent-sidebar__send";
  sendBtn.textContent = "Send";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "leditor-agent-sidebar__cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.display = "none";

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

  sidebar.append(header, scopeRow, showNumbersRow, messagesEl, draftList, composer, footer);
  root.appendChild(sidebar);

  let messages: AgentMessage[] = [
    {
      role: "system",
      content:
        "Agent is ready. Use scopes: Selection / Paragraphs / Section / Document. You can reference: paragraphs 2-4, section 3.1, heading \"Methods\", or paragraph \"keywords\".",
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
    cancelBtn.style.display = inflight ? "" : "none";
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
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    try {
      editorHandle.execCommand("ClearAiDraftPreview");
    } catch {
      // ignore
    }
  };

  const applyRangeAsTransaction = (from: number, to: number, text: string) => {
    const editor = editorHandle.getEditor();
    const tr = editor.state.tr.insertText(text, from, to);
    tr.setMeta("leditor-ai", { kind: "agent", ts: Date.now() });
    editor.view.dispatch(tr);
    editor.commands.focus();
  };

  const applyBatchAsTransaction = (items: Array<{ from: number; to: number; text: string }>) => {
    const editor = editorHandle.getEditor();
    const sorted = [...items].sort((a, b) => b.from - a.from);
    let tr = editor.state.tr;
    for (const item of sorted) {
      tr = tr.insertText(item.text, item.from, item.to);
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
    for (const item of pending.items) {
      const row = document.createElement("div");
      row.className = "leditor-agent-sidebar__draftRow";
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
      row.append(label, actions);
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
      const request: AgentRunRequest = { instruction, scope };
      if (scope === "paragraphs") {
        const from = Math.max(1, Math.floor(Number(rangeFrom.value || "1")));
        const to = Math.max(from, Math.floor(Number(rangeTo.value || String(from))));
        request.range = { from, to };
      }
      if (scope === "section") {
        const section = Math.max(1, Math.floor(Number(sectionInput.value || "1")));
        request.section = section;
      }
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
      addMessage("assistant", result.assistantText || "(no response)");
      pending = result.apply ?? null;
      if (pending) {
        const count = pending.kind === "batchReplace" ? pending.items.length : 1;
        pendingLabel.textContent = `Draft ready • ${count} change(s)`;
        renderDraftList();
        syncDraftPreview();
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

  const syncScopeUi = () => {
    const current = scopeSelect.value as AgentScope;
    rangeFrom.style.display = current === "paragraphs" ? "" : "none";
    rangeTo.style.display = current === "paragraphs" ? "" : "none";
    sectionInput.style.display = current === "section" ? "" : "none";
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
      clearPending();
      unsubscribeScope();
      sidebar.remove();
    }
  };

  closeBtn.addEventListener("click", () => controller.close());
  scopeSelect.addEventListener("change", () => {
    const next = String(scopeSelect.value || "").trim();
    if (next !== "selection" && next !== "document" && next !== "paragraphs" && next !== "section") {
      scopeSelect.value = scope;
      return;
    }
    scope = next;
    syncScopeUi();
  });

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
  syncScopeUi();
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
