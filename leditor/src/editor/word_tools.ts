import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { findWordBounds, isWordChar } from "./sentence_utils.ts";

type CompletionState = {
  prefix: string;
  candidates: string[];
  index: number;
  anchor: number;
  from: number;
  to: number;
};

let completionState: CompletionState | null = null;

const AUTO_TEXT_KEY = "leditor.autotext.store";

const readAutoTextStore = (): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage?.getItem(AUTO_TEXT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
  } catch {
    // ignore
  }
  return {};
};

const writeAutoTextStore = (store: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(AUTO_TEXT_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
};

const extractWords = (text: string): string[] => {
  try {
    return Array.from(text.matchAll(/[\p{L}\p{N}_]+/gu)).map((m) => m[0]);
  } catch {
    return Array.from(text.matchAll(/[A-Za-z0-9_]+/g)).map((m) => m[0]);
  }
};

const getWordPrefixAtCursor = (editor: Editor): {
  prefix: string;
  wordStart: number;
  wordEnd: number;
} | null => {
  const { selection, doc } = editor.state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1;
  if (depth <= 0) return null;
  const block = $from.node(depth);
  const blockText = block.textBetween(0, block.content.size, "\n", "\n");
  const offset = $from.parentOffset;
  const bounds = findWordBounds(blockText, offset);
  const prefix = blockText.slice(bounds.start, offset);
  if (!prefix) return null;
  const blockStart = $from.start(depth);
  return {
    prefix,
    wordStart: blockStart + bounds.start,
    wordEnd: blockStart + bounds.end
  };
};

const updateCompletionState = (next: CompletionState | null) => {
  completionState = next;
};

export const resetWordCompletion = () => {
  completionState = null;
};

export const completeWord = (editor: Editor, dir: 1 | -1): boolean => {
  const prefixInfo = getWordPrefixAtCursor(editor);
  if (!prefixInfo) {
    resetWordCompletion();
    return false;
  }
  const { prefix, wordStart, wordEnd } = prefixInfo;
  const currentWord = editor.state.doc.textBetween(wordStart, wordEnd, "\n", "\n");

  let state = completionState;
  if (!state || state.prefix !== prefix || state.anchor !== wordStart) {
    const docText = editor.state.doc.textBetween(0, editor.state.doc.content.size, " ");
    const words = extractWords(docText);
    const lowerPrefix = prefix.toLowerCase();
    const candidates = Array.from(
      new Set(
        words.filter((word) => word.length > prefix.length && word.toLowerCase().startsWith(lowerPrefix))
      )
    );
    if (!candidates.length) {
      resetWordCompletion();
      return false;
    }
    state = {
      prefix,
      candidates,
      index: -1,
      anchor: wordStart,
      from: wordStart,
      to: wordEnd
    };
  } else if (!currentWord.toLowerCase().startsWith(prefix.toLowerCase())) {
    resetWordCompletion();
    return false;
  }

  const nextIndex =
    state.candidates.length === 0
      ? -1
      : (state.index + (dir > 0 ? 1 : state.candidates.length - 1)) % state.candidates.length;
  const candidate = state.candidates[nextIndex];
  if (!candidate) {
    resetWordCompletion();
    return false;
  }
  const tr = editor.state.tr.insertText(candidate, state.from, state.to);
  const nextPos = state.from + candidate.length;
  tr.setSelection(TextSelection.create(tr.doc, nextPos));
  editor.view.dispatch(tr);

  updateCompletionState({
    ...state,
    index: nextIndex,
    from: state.from,
    to: state.from + candidate.length
  });
  return true;
};

export const createAutoTextFromSelection = (editor: Editor): boolean => {
  const { selection, doc } = editor.state;
  if (selection.empty) {
    window.alert("Select text to create AutoText.");
    return false;
  }
  const text = doc.textBetween(selection.from, selection.to, "\n", "\n").trim();
  if (!text) {
    window.alert("Selected text is empty.");
    return false;
  }
  const defaultKey = text.split(/\s+/).slice(0, 2).join("").slice(0, 12);
  const rawKey = window.prompt("AutoText key", defaultKey) ?? "";
  const key = rawKey.trim();
  if (!key) return false;
  const store = readAutoTextStore();
  store[key] = text;
  writeAutoTextStore(store);
  window.alert(`AutoText saved: ${key}`);
  return true;
};

export const expandAutoText = (editor: Editor): boolean => {
  const store = readAutoTextStore();
  const keys = Object.keys(store);
  if (!keys.length) {
    window.alert("No AutoText entries found.");
    return false;
  }
  const prefixInfo = getWordPrefixAtCursor(editor);
  let key = prefixInfo?.prefix ?? "";
  if (!key || !store[key]) {
    const listing = keys.slice(0, 12).join(", ");
    const raw = window.prompt(`AutoText key (${listing})`, key) ?? "";
    key = raw.trim();
  }
  if (!key || !store[key]) return false;
  const text = store[key];
  const from = prefixInfo ? prefixInfo.wordStart : editor.state.selection.from;
  const to = prefixInfo ? prefixInfo.wordEnd : editor.state.selection.to;
  const tr = editor.state.tr.insertText(text, from, to);
  const nextPos = from + text.length;
  tr.setSelection(TextSelection.create(tr.doc, nextPos));
  editor.view.dispatch(tr);
  return true;
};

export const insertSpecialText = (editor: Editor, text: string): boolean => {
  if (!text) return false;
  const { state } = editor;
  const tr = state.tr.insertText(text, state.selection.from, state.selection.to);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};

export const getWordPrefixBeforeCursor = (editor: Editor): string => {
  const { selection } = editor.state;
  if (!selection.empty) return "";
  const $from = selection.$from;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1;
  if (depth <= 0) return "";
  const block = $from.node(depth);
  const blockText = block.textBetween(0, block.content.size, "\n", "\n");
  let offset = $from.parentOffset;
  while (offset > 0 && !isWordChar(blockText[offset - 1])) offset -= 1;
  const bounds = findWordBounds(blockText, offset);
  return blockText.slice(bounds.start, offset);
};
