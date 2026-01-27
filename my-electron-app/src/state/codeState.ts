import { loadCodeState as loadSessionCodeState, persistCodeState } from "../session/sessionStorage";

export interface CodeStateSnapshot {
  themesDir: string;
  collection: string;
  batchSize: string;
  rqs: string[];
  model: string;
  lens: string;
  additionalPrompt: string;
}

type Listener = (state: CodeStateSnapshot) => void;

let snapshot: CodeStateSnapshot = loadInitial();
const listeners: Listener[] = [];

function loadInitial(): CodeStateSnapshot {
  const sessionState = loadSessionCodeState();
  if (sessionState) {
    return normalizeState(sessionState);
  }
  return createDefaultCodeState();
}

export function getCodeState(): CodeStateSnapshot {
  return {
    themesDir: snapshot.themesDir,
    collection: snapshot.collection,
    batchSize: snapshot.batchSize,
    rqs: [...snapshot.rqs],
    model: snapshot.model,
    lens: snapshot.lens,
    additionalPrompt: snapshot.additionalPrompt
  };
}

export function addResearchQuestion(): CodeStateSnapshot {
  snapshot = { ...snapshot, rqs: [...snapshot.rqs, ""] };
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

export function updateThemesDir(themesDir: string): CodeStateSnapshot {
  snapshot = { ...snapshot, themesDir };
  persist();
  notify();
  return getCodeState();
}

export function updateCollection(collection: string): CodeStateSnapshot {
  snapshot = { ...snapshot, collection };
  persist();
  notify();
  return getCodeState();
}

export function updateBatchSize(batchSize: string): CodeStateSnapshot {
  snapshot = { ...snapshot, batchSize };
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

export function updateLens(lens: string): CodeStateSnapshot {
  snapshot = { ...snapshot, lens };
  persist();
  notify();
  return getCodeState();
}

export function updateAdditionalPrompt(additionalPrompt: string): CodeStateSnapshot {
  snapshot = { ...snapshot, additionalPrompt };
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
  return {
    themesDir: "",
    collection: "",
    batchSize: "",
    rqs: [],
    model: "gpt-5-thinking",
    lens: "constructivist (social meaning / norms)",
    additionalPrompt: ""
  };
}

function normalizeState(state: CodeStateSnapshot): CodeStateSnapshot {
  const defaults = createDefaultCodeState();
  return {
    ...defaults,
    ...state,
    rqs: Array.isArray(state.rqs) ? state.rqs : []
  };
}
