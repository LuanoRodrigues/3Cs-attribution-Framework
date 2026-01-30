import type { EditorHandle } from "../api/leditor.ts";
import { getAiSettings, subscribeAiSettings } from "./ai_settings.ts";

export type AgentScope = "selection" | "document";

export type AgentMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
};

export type AgentRunRequest = {
  instruction: string;
  scope: AgentScope;
};

export type AgentRunResult = {
  assistantText: string;
  apply?:
    | { kind: "replaceRange"; from: number; to: number; text: string }
    | { kind: "setDocument"; doc: object }
    | { kind: "insertAtCursor"; text: string };
};

export type AgentSidebarController = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  destroy: () => void;
};

type AgentSidebarOptions = {
  runAgent: (request: AgentRunRequest, editorHandle: EditorHandle) => Promise<AgentRunResult>;
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

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-agent-sidebar__close";
  closeBtn.textContent = "Close";

  headerRight.appendChild(closeBtn);
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
  const docOption = document.createElement("option");
  docOption.value = "document";
  docOption.textContent = "Document";
  scopeSelect.append(selectionOption, docOption);
  scopeSelect.value = scope;
  scopeRow.append(scopeLabel, scopeSelect);
  const unsubscribeScope = subscribeAiSettings((next) => {
    if (open) return;
    scopeSelect.value = next.defaultScope;
    scope = next.defaultScope;
  });

  const messagesEl = document.createElement("div");
  messagesEl.className = "leditor-agent-sidebar__messages";
  messagesEl.setAttribute("role", "log");
  messagesEl.setAttribute("aria-live", "polite");

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

  composer.append(input, sendBtn);

  sidebar.append(header, scopeRow, messagesEl, composer);
  root.appendChild(sidebar);

  let messages: AgentMessage[] = [
    {
      role: "system",
      content: "Agent is ready. Edits apply via TipTap transactions.",
      ts: Date.now()
    }
  ];
  let inflight = false;
  let destroyed = false;

  const renderMessages = () => {
    messagesEl.replaceChildren();
    for (const msg of messages) {
      const row = document.createElement("div");
      row.className = `leditor-agent-sidebar__msg leditor-agent-sidebar__msg--${msg.role}`;
      const meta = document.createElement("div");
      meta.className = "leditor-agent-sidebar__msgMeta";
      meta.textContent = `${msg.role} • ${formatTimestamp(msg.ts)}`;
      const body = document.createElement("div");
      body.className = "leditor-agent-sidebar__msgBody";
      body.textContent = msg.content;
      row.append(meta, body);
      messagesEl.appendChild(row);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const setInflight = (value: boolean) => {
    inflight = value;
    input.disabled = inflight;
    sendBtn.disabled = inflight;
    sidebar.classList.toggle("is-busy", inflight);
  };

  const addMessage = (role: AgentMessage["role"], content: string) => {
    messages = clampHistory([...messages, { role, content, ts: Date.now() }], 50);
    renderMessages();
  };

  const syncInsets = () => {
    const bottom = getStatusBarHeight();
    sidebar.style.bottom = bottom > 0 ? `${Math.ceil(bottom)}px` : "";
  };

  const applyResult = (result: AgentRunResult) => {
    if (!result.apply) return;
    const editor = editorHandle.getEditor();
    if (result.apply.kind === "replaceRange") {
      editor.chain().focus().insertContentAt({ from: result.apply.from, to: result.apply.to }, result.apply.text).run();
      return;
    }
    if (result.apply.kind === "setDocument") {
      editor.commands.setContent(result.apply.doc as any);
      editor.commands.focus();
      return;
    }
    if (result.apply.kind === "insertAtCursor") {
      editor.chain().focus().insertContent(result.apply.text).run();
      return;
    }
    throw new Error(`AgentSidebar: unknown apply kind "${(result.apply as any).kind}"`);
  };

  const run = async () => {
    if (destroyed) return;
    const instruction = input.value.trim();
    if (!instruction) return;
    addMessage("user", instruction);
    input.value = "";
    setInflight(true);
    try {
      const result = await options.runAgent({ instruction, scope }, editorHandle);
      addMessage("assistant", result.assistantText || "(no response)");
      applyResult(result);
    } catch (error) {
      addMessage("assistant", `Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInflight(false);
      editorHandle.focus();
    }
  };

  const controller: AgentSidebarController = {
    open() {
      if (destroyed) return;
      open = true;
      sidebar.classList.add("is-open");
      root.classList.add(APP_OPEN_CLASS);
      syncInsets();
      renderMessages();
      input.focus();
    },
    close() {
      if (destroyed) return;
      open = false;
      sidebar.classList.remove("is-open");
      root.classList.remove(APP_OPEN_CLASS);
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
      unsubscribeScope();
      sidebar.remove();
    }
  };

  closeBtn.addEventListener("click", () => controller.close());
  scopeSelect.addEventListener("change", () => {
    const next = String(scopeSelect.value || "").trim();
    if (next !== "selection" && next !== "document") {
      scopeSelect.value = scope;
      return;
    }
    scope = next;
  });

  sendBtn.addEventListener("click", () => {
    void run();
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

  window.addEventListener("resize", syncInsets);
  syncInsets();
  renderMessages();

  return controller;
};
