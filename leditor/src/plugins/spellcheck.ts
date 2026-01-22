import { registerPlugin } from "../api/plugin_registry.js";
import type { EditorHandle } from "../api/leditor.js";
import nspell from "nspell";

type SpellChecker = ReturnType<typeof nspell>;
type Suggestion = {
  id: string;
  word: string;
  suggestions: string[];
};

const WORD_REGEX = /[A-Za-zÀ-ÖØ-öø-ÿ’'-]{2,}/g;
const makeId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let spellChecker: SpellChecker | null = null;
let dictionaryPromise: Promise<SpellChecker | null> | null = null;
let spellcheckEnabled = false;
let pendingSuggestions: Suggestion[] = [];

const log = (message: string) => window.codexLog?.write(`[SPELLCHECK] ${message}`);

const emitSpellSuggestions = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent("leditor:spellcheck:suggestions", {
      detail: { suggestions: pendingSuggestions.slice(0, 8) }
    })
  );
};

const ensureSpellChecker = (): Promise<SpellChecker | null> => {
  if (spellChecker) {
    return Promise.resolve(spellChecker);
  }
  if (dictionaryPromise) {
    return dictionaryPromise;
  }
  dictionaryPromise = import("dictionary-en")
    .then((module) => {
      const dictionary = module.default;
      const checker = nspell(dictionary);
      spellChecker = checker;
      return checker;
    })
    .catch((error) => {
      log(`dictionary load failed ${error}`);
      return null;
    });
  return dictionaryPromise;
};

const scanDocument = (editorHandle: EditorHandle, checker: SpellChecker): void => {
  const editor = editorHandle.getEditor();
  const doc = editor.state.doc;
  const text = doc.textBetween(0, doc.content.size, " ");
  const suggestions: Suggestion[] = [];
  WORD_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while (suggestions.length < 10 && (match = WORD_REGEX.exec(text)) !== null) {
    const word = match[0];
    const normalized = word.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    const correct = checker.correct(normalized);
    if (correct) {
      continue;
    }
    const nextSuggestions = checker.suggest(normalized).slice(0, 4);
  suggestions.push({
    id: makeId(),
    word: normalized,
    suggestions: nextSuggestions
  });
}
pendingSuggestions = suggestions;
log(`${suggestions.length} suggestion(s) ready`);
emitSpellSuggestions();
};

registerPlugin({
  id: "spellcheck",
  commands: {
    ToggleSpellcheck(editorHandle: EditorHandle) {
      spellcheckEnabled = !spellcheckEnabled;
      log(spellcheckEnabled ? "enabled" : "disabled");
      if (!spellcheckEnabled) {
        pendingSuggestions = [];
        emitSpellSuggestions();
        return;
      }
      void ensureSpellChecker().then((checker) => {
        if (!checker) {
          log("dictionary unavailable");
          return;
        }
        scanDocument(editorHandle, checker);
      });
    },
    AddToDictionary(editorHandle: EditorHandle, args?: { word?: string }) {
      const word = typeof args?.word === "string" ? args.word.trim() : "";
      if (!word) {
        log("no word provided");
        return;
      }
      void ensureSpellChecker().then((checker) => {
        if (!checker) {
          log("dictionary unavailable");
          return;
        }
        checker.add(word);
        log(`added "${word}"`);
        if (spellcheckEnabled) {
          scanDocument(editorHandle, checker);
        }
      });
    },
    ReplaceWithSuggestion(editorHandle: EditorHandle, args?: { suggestion?: string }) {
      const suggestionText =
        typeof args?.suggestion === "string" && args.suggestion.trim()
          ? args.suggestion.trim()
          : pendingSuggestions[0]?.suggestions[0];
      if (!suggestionText) {
        log("no suggestion available");
        return;
      }
      const editor = editorHandle.getEditor();
      editor.chain().focus().insertContent(suggestionText).run();
      log(`inserted suggestion "${suggestionText}"`);
    }
  }
});
