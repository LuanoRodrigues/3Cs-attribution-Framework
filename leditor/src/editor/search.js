"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchExtension = exports.notifySearchUndo = exports.markSearchPanelOpened = exports.clearSearch = exports.replaceAll = exports.replaceCurrent = exports.prevMatch = exports.nextMatch = exports.getActiveIndex = exports.getMatches = exports.setQuery = exports.findAll = exports.setSearchEditor = void 0;
const core_1 = require("@tiptap/core");
const prosemirror_state_1 = require("prosemirror-state");
const prosemirror_view_1 = require("prosemirror-view");
const phaseFlags = {
    opened: false,
    hasMatch: false,
    cycled: false,
    replaced: false,
    logged: false
};
const searchPluginKey = new prosemirror_state_1.PluginKey("leditor-search");
let editorRef = null;
let currentQuery = "";
let matches = [];
let activeIndex = -1;
const computeMatches = (doc, query) => {
    if (query.length === 0)
        return [];
    const results = [];
    doc.descendants((node, pos) => {
        if (!node.isText || !node.text)
            return;
        let start = 0;
        while (true) {
            const found = node.text.indexOf(query, start);
            if (found === -1)
                break;
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
    if (activeIndex < 0)
        activeIndex = 0;
    if (activeIndex >= matches.length)
        activeIndex = matches.length - 1;
};
const refreshMatches = (doc) => {
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
const buildDecorations = (doc) => {
    if (currentQuery.length === 0 || matches.length === 0) {
        return prosemirror_view_1.DecorationSet.empty;
    }
    const decos = matches.map((match, index) => {
        const className = index === activeIndex
            ? "leditor-search-match leditor-search-match-active"
            : "leditor-search-match";
        return prosemirror_view_1.Decoration.inline(match.from, match.to, { class: className });
    });
    return prosemirror_view_1.DecorationSet.create(doc, decos);
};
const requestDecorationsRefresh = () => {
    if (!editorRef)
        return;
    editorRef.view.dispatch(editorRef.state.tr.setMeta(searchPluginKey, { refresh: true }));
};
const selectActiveMatch = () => {
    if (!editorRef)
        return;
    if (activeIndex < 0 || activeIndex >= matches.length)
        return;
    const match = matches[activeIndex];
    const selection = prosemirror_state_1.TextSelection.create(editorRef.state.doc, match.from, match.to);
    const tr = editorRef.state.tr.setSelection(selection).scrollIntoView();
    editorRef.view.dispatch(tr);
    editorRef.commands.focus();
    requestDecorationsRefresh();
};
const setSearchEditor = (editor) => {
    editorRef = editor;
};
exports.setSearchEditor = setSearchEditor;
const findAll = (query) => {
    if (!editorRef)
        return [];
    return computeMatches(editorRef.state.doc, query);
};
exports.findAll = findAll;
const setQuery = (query) => {
    currentQuery = query;
    activeIndex = 0;
    if (!editorRef)
        return;
    refreshMatches(editorRef.state.doc);
    requestDecorationsRefresh();
};
exports.setQuery = setQuery;
const getMatches = () => matches.slice();
exports.getMatches = getMatches;
const getActiveIndex = () => activeIndex;
exports.getActiveIndex = getActiveIndex;
const nextMatch = () => {
    if (!editorRef || matches.length === 0)
        return;
    activeIndex = (activeIndex + 1) % matches.length;
    phaseFlags.cycled = true;
    selectActiveMatch();
};
exports.nextMatch = nextMatch;
const prevMatch = () => {
    if (!editorRef || matches.length === 0)
        return;
    activeIndex = (activeIndex - 1 + matches.length) % matches.length;
    phaseFlags.cycled = true;
    selectActiveMatch();
};
exports.prevMatch = prevMatch;
const replaceCurrent = (replacement) => {
    if (!editorRef || matches.length === 0)
        return;
    clampActiveIndex();
    if (activeIndex === -1)
        return;
    const match = matches[activeIndex];
    const tr = editorRef.state.tr.insertText(replacement, match.from, match.to);
    editorRef.view.dispatch(tr);
    editorRef.commands.focus();
    phaseFlags.replaced = true;
};
exports.replaceCurrent = replaceCurrent;
const replaceAll = (query, replacement) => {
    if (!editorRef)
        return;
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
exports.replaceAll = replaceAll;
const clearSearch = () => {
    currentQuery = "";
    matches = [];
    activeIndex = -1;
    requestDecorationsRefresh();
};
exports.clearSearch = clearSearch;
const markSearchPanelOpened = () => {
    phaseFlags.opened = true;
};
exports.markSearchPanelOpened = markSearchPanelOpened;
const notifySearchUndo = () => {
    if (phaseFlags.logged)
        return;
    if (!phaseFlags.opened || !phaseFlags.hasMatch || !phaseFlags.cycled || !phaseFlags.replaced) {
        return;
    }
    window.codexLog?.write("[PHASE11_OK]");
    phaseFlags.logged = true;
};
exports.notifySearchUndo = notifySearchUndo;
exports.searchExtension = core_1.Extension.create({
    name: "searchHighlight",
    addProseMirrorPlugins() {
        return [
            new prosemirror_state_1.Plugin({
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
