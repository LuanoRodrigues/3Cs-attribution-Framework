export type AgentHistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
};

type AgentHistoryPayload = {
  version: 1;
  messages: AgentHistoryMessage[];
};

const MAX_MESSAGES = 50;

let history: AgentHistoryMessage[] = [];
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((fn) => fn());
};

const clamp = (messages: AgentHistoryMessage[]): AgentHistoryMessage[] => {
  if (messages.length <= MAX_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_MESSAGES);
};

export const subscribeAgentHistory = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getAgentHistory = (): AgentHistoryMessage[] => history;

export const setAgentHistory = (messages: AgentHistoryMessage[]) => {
  history = clamp(
    Array.isArray(messages)
      ? messages
          .map((m) => ({
            role: m?.role,
            content: typeof m?.content === "string" ? m.content : String(m?.content ?? ""),
            ts: Number.isFinite(m?.ts) ? Number(m.ts) : Date.now()
          }))
          .filter((m) => (m.role === "user" || m.role === "assistant" || m.role === "system") && m.content.trim())
      : []
  );
  notify();
};

export const appendAgentHistoryMessage = (message: { role: "user" | "assistant" | "system"; content: string }) => {
  const content = typeof message?.content === "string" ? message.content.trim() : String(message?.content ?? "");
  if (!content) return;
  history = clamp([...history, { role: message.role, content, ts: Date.now() }]);
  notify();
};

export const clearAgentHistory = () => {
  history = [];
  notify();
};

export const exportAgentHistoryForLedoc = (): unknown => {
  if (!history.length) return null;
  const payload: AgentHistoryPayload = { version: 1, messages: history };
  return payload;
};

export const loadAgentHistoryFromLedoc = (historyContainer: unknown) => {
  if (!historyContainer || typeof historyContainer !== "object") return;
  const raw = historyContainer as any;
  const candidate = raw.agentHistory ?? raw.agent_history ?? raw.agent ?? null;
  if (!candidate || typeof candidate !== "object") return;
  const messages = Array.isArray((candidate as any).messages) ? (candidate as any).messages : [];
  setAgentHistory(messages as AgentHistoryMessage[]);
};
