import { Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

export type TextRange = { from: number; to: number };

type PhaseFlags = {
  opened: boolean;
  hasMatch: boolean;
  cycled: boolean;
  replaced: boolean;
  logged: boolean;
};

const phaseFlags: PhaseFlags = {
  opened: false,
  hasMatch: false,
  cycled: false,
  replaced: false,
  logged: false
};

const searchPluginKey = new PluginKey("leditor-search");
let editorRef: Editor | null = null;
let currentQuery = "";
let matches: TextRange[] = [];
let activeIndex = -1;

const computeMatches = (doc: ProseMirrorNode, query: string): TextRange[] => {
  if (query.length === 0) return [];
  const results: TextRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let start = 0;
    while (true) {
      const found = node.text.indexOf(query, start);
      if (found === -1) break;
      results.push({ from: pos + found, to: pos + found + query.length });
      start = found + query.length;
    }
  });
  return results;
};

const clampActiveIndex = () => {
  if (matches.length === 0) {
    activeIndex = -1;
    return;
  }
  if (activeIndex < 0) activeIndex = 0;
  if (activeIndex >= matches.length) activeIndex = matches.length - 1;
};

const refreshMatches = (doc: ProseMirrorNode) => {
  if (currentQuery.length === 0) {
    matches = [];
    activeIndex = -1;
    return;
  }
  matches = computeMatches(doc, currentQuery);
  clampActiveIndex();
  if (matches.length > 0) {
    phaseFlags.hasMatch = true;
  }
};

const buildDecorations = (doc: ProseMirrorNode) => {
  if (currentQuery.length === 0 || matches.length === 0) {
    return DecorationSet.empty;
  }
  const decos = matches.map((match, index) => {
    const className =
      index === activeIndex
        ? "leditor-search-match leditor-search-match-active"
        : "leditor-search-match";
    return Decoration.inline(match.from, match.to, { class: className });
  });
  return DecorationSet.create(doc, decos);
};

const requestDecorationsRefresh = () => {
  if (!editorRef) return;
  editorRef.view.dispatch(editorRef.state.tr.setMeta(searchPluginKey, { refresh: true }));
};

const selectActiveMatch = () => {
  if (!editorRef) return;
  if (activeIndex < 0 || activeIndex >= matches.length) return;
  const match = matches[activeIndex];
  const selection = TextSelection.create(editorRef.state.doc, match.from, match.to);
  const tr = editorRef.state.tr.setSelection(selection).scrollIntoView();
  editorRef.view.dispatch(tr);
  editorRef.commands.focus();
  requestDecorationsRefresh();
};

export const setSearchEditor = (editor: Editor) => {
  editorRef = editor;
};

export const findAll = (query: string): TextRange[] => {
  if (!editorRef) return [];
  return computeMatches(editorRef.state.doc, query);
};

export const setQuery = (query: string) => {
  currentQuery = query;
  activeIndex = 0;
  if (!editorRef) return;
  refreshMatches(editorRef.state.doc);
  requestDecorationsRefresh();
};

export const getMatches = () => matches.slice();

export const getActiveIndex = () => activeIndex;

export const nextMatch = () => {
  if (!editorRef || matches.length === 0) return;
  activeIndex = (activeIndex + 1) % matches.length;
  phaseFlags.cycled = true;
  selectActiveMatch();
};

export const prevMatch = () => {
  if (!editorRef || matches.length === 0) return;
  activeIndex = (activeIndex - 1 + matches.length) % matches.length;
  phaseFlags.cycled = true;
  selectActiveMatch();
};

export const replaceCurrent = (replacement: string) => {
  if (!editorRef || matches.length === 0) return;
  clampActiveIndex();
  if (activeIndex === -1) return;
  const match = matches[activeIndex];
  const tr = editorRef.state.tr.insertText(replacement, match.from, match.to);
  editorRef.view.dispatch(tr);
  editorRef.commands.focus();
  phaseFlags.replaced = true;
};

export const replaceAll = (query: string, replacement: string) => {
  if (!editorRef) return;
  currentQuery = query;
  activeIndex = 0;
  refreshMatches(editorRef.state.doc);
  if (matches.length === 0) {
    requestDecorationsRefresh();
    return;
  }
  const tr = editorRef.state.tr;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    tr.insertText(replacement, match.from, match.to);
  }
  editorRef.view.dispatch(tr);
  editorRef.commands.focus();
};

export const clearSearch = () => {
  currentQuery = "";
  matches = [];
  activeIndex = -1;
  requestDecorationsRefresh();
};

export const markSearchPanelOpened = () => {
  phaseFlags.opened = true;
};

export const notifySearchUndo = () => {
  if (phaseFlags.logged) return;
  if (!phaseFlags.opened || !phaseFlags.hasMatch || !phaseFlags.cycled || !phaseFlags.replaced) {
    return;
  }
  window.codexLog?.write("[PHASE11_OK]");
  phaseFlags.logged = true;
};

export const searchExtension = Extension.create({
  name: "searchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init(_, state) {
            refreshMatches(state.doc);
            return buildDecorations(state.doc);
          },
          apply(tr, value, oldState, newState) {
            const meta = tr.getMeta(searchPluginKey);
            if (tr.docChanged || (meta && meta.refresh)) {
              refreshMatches(newState.doc);
              return buildDecorations(newState.doc);
            }
            return value.map(tr.mapping, tr.doc);
          }
        },
        props: {
          decorations(state) {
            return this.getState(state);
          }
        }
      })
    ];
  }
});
