import { loadCodeState as loadSessionCodeState, persistCodeState } from "../session/sessionStorage";

export interface CodeStateSnapshot {
  rqs: string[];
  model: string;
}

type Listener = (state: CodeStateSnapshot) => void;

let snapshot: CodeStateSnapshot = loadInitial();
const listeners: Listener[] = [];

function loadInitial(): CodeStateSnapshot {
  const sessionState = loadSessionCodeState();
  if (sessionState) {
    return sessionState;
  }
  return createDefaultCodeState();
}

export function getCodeState(): CodeStateSnapshot {
  return { rqs: [...snapshot.rqs], model: snapshot.model };
}

export function addResearchQuestion(): CodeStateSnapshot {
  const nextLabel = `RQ ${snapshot.rqs.length + 1}`;
  snapshot = { ...snapshot, rqs: [...snapshot.rqs, nextLabel] };
  persist();
  notify();
  return getCodeState();
}

export function updateResearchQuestion(index: number, text: string): CodeStateSnapshot {
  const next = snapshot.rqs.slice();
  next[index] = text;
  snapshot = { ...snapshot, rqs: next };
  persist();
  notify();
  return getCodeState();
}

export function updateModel(model: string): CodeStateSnapshot {
  snapshot = { ...snapshot, model };
  persist();
  notify();
  return getCodeState();
}

export function subscribe(listener: Listener): () => void {
  listeners.push(listener);
  listener(getCodeState());
  return () => unsubscribe(listener);
}

function unsubscribe(listener: Listener): void {
  const index = listeners.indexOf(listener);
  if (index < 0) {
    return;
  }
  listeners.splice(index, 1);
}

function notify(): void {
  listeners.forEach((listener) => listener(getCodeState()));
}

function persist(): void {
  persistCodeState(snapshot);
}

export function createDefaultCodeState(): CodeStateSnapshot {
  return { rqs: [], model: "gpt-4.1" };
}
