"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandMap = void 0;
const state_1 = require("@tiptap/pm/state");
const extension_footnote_js_1 = require("../extensions/extension_footnote.js");
const citation_state_js_1 = require("../editor/citation_state.js");
const constants_js_1 = require("../constants.js");
const getTiptap = (editor) => {
    if (editor?.commands)
        return editor;
    if (editor?.getEditor)
        return editor.getEditor();
    return null;
};
const findListItemDepth = (editor) => {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name === "listItem")
            return depth;
    }
    return null;
};
const getBlockAtSelection = (editor) => {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        const name = node.type.name;
        if (name === "paragraph" || name === "heading") {
            return { name, attrs: node.attrs };
        }
    }
    return null;
};
const parseToCm = (value, fallback) => {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value !== "string")
        return fallback;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed)
        return fallback;
    const numeric = Number.parseFloat(trimmed);
    if (!Number.isFinite(numeric))
        return fallback;
    if (trimmed.endsWith("cm"))
        return numeric;
    if (trimmed.endsWith("mm"))
        return numeric / 10;
    if (trimmed.endsWith("in"))
        return numeric * 2.54;
    return numeric;
};
const CASE_TRANSFORMERS = {
    sentence(value) {
        const normalized = value.toLowerCase();
        if (!normalized) {
            return "";
        }
        return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    },
    lowercase(value) {
        return value.toLowerCase();
    },
    uppercase(value) {
        return value.toUpperCase();
    },
    title(value) {
        return value
            .toLowerCase()
            .replace(/\b\w/g, (character) => character.toUpperCase());
    }
};
const applyCaseTransform = (editor, transform) => {
    const { state } = editor;
    const { from, to } = state.selection;
    if (from === to) {
        return false;
    }
    let tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) {
            return;
        }
        const nodeStart = pos;
        const nodeEnd = pos + node.nodeSize;
        const selectionStart = Math.max(from, nodeStart);
        const selectionEnd = Math.min(to, nodeEnd);
        if (selectionStart >= selectionEnd) {
            return;
        }
        const text = node.text?.slice(selectionStart - nodeStart, selectionEnd - nodeStart) ?? "";
        if (!text) {
            return;
        }
        const transformed = transform(text);
        if (transformed === text) {
            return;
        }
        const replacement = editor.schema.text(transformed, node.marks);
        tr = tr.replaceWith(selectionStart, selectionEnd, replacement);
    });
    if (tr.docChanged) {
        editor.view.dispatch(tr);
        return true;
    }
    return false;
};
const getCaseTransformer = (mode) => {
    if (mode && mode in CASE_TRANSFORMERS) {
        return CASE_TRANSFORMERS[mode];
    }
    return CASE_TRANSFORMERS.sentence;
};
const execClipboardCommand = (command) => {
    if (typeof document === "undefined" || typeof document.execCommand !== "function") {
        return;
    }
    try {
        document.execCommand(command);
    }
    catch {
        // swallow
    }
};
const readClipboardText = () => {
    if (typeof navigator === "undefined" || typeof navigator.clipboard === "undefined") {
        return Promise.resolve("");
    }
    return navigator.clipboard
        .readText()
        .catch(() => "");
};
const requestImageInsert = (editor) => {
    const handler = window.leditorHost?.insertImage;
    if (!handler) {
        return;
    }
    void handler()
        .then((result) => {
        if (!result?.success || !result.url) {
            console.error("InsertImage failed", result?.error);
            return;
        }
        editor.chain().focus().insertContent({ type: "image", attrs: { src: result.url } }).run();
    })
        .catch((error) => {
        console.error("InsertImage failed", error);
    });
};
const slugifyBookmarkLabel = (value) => {
    const normalized = value.toLowerCase().trim();
    const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    return slug || "bookmark";
};
const collectBookmarks = (editor) => {
    const entries = [];
    editor.state.doc.descendants((node) => {
        if (node.type.name === "bookmark") {
            const id = typeof node.attrs?.id === "string" ? node.attrs.id : "";
            if (!id) {
                return true;
            }
            const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
            entries.push({ id, label });
        }
        return true;
    });
    return entries;
};
const ensureUniqueBookmarkId = (base, taken) => {
    const normalized = base.trim() || "bookmark";
    let candidate = normalized;
    let suffix = 1;
    while (taken.has(candidate)) {
        candidate = `${normalized}-${suffix}`;
        suffix += 1;
    }
    return candidate;
};
const search_js_1 = require("../editor/search.js");
const autosave_js_1 = require("../editor/autosave.js");
const visual_js_1 = require("../editor/visual.js");
const direction_js_1 = require("../editor/direction.js");
const fullscreen_js_1 = require("../ui/fullscreen.js");
const view_state_js_1 = require("../ui/view_state.js");
const footnote_state_js_1 = require("../editor/footnote_state.js");
const layout_context_js_1 = require("../ui/layout_context.js");
const layout_settings_js_1 = require("../ui/layout_settings.js");
const pagination_index_js_1 = require("../ui/pagination/index.js");
const index_js_1 = require("../templates/index.js");
const CITATION_STYLE_DEFAULT = constants_js_1.CITATION_STYLES[0];
const readCitationStyle = () => {
    try {
        const stored = localStorage.getItem(constants_js_1.CITATION_STYLE_STORAGE_KEY);
        if (stored && constants_js_1.CITATION_STYLES.includes(stored)) {
            return stored;
        }
    }
    catch {
        // ignore storage failures
    }
    return CITATION_STYLE_DEFAULT;
};
const saveCitationStyle = (style) => {
    try {
        localStorage.setItem(constants_js_1.CITATION_STYLE_STORAGE_KEY, style);
    }
    catch {
        // ignore
    }
};
const collectHeadingEntries = (editor) => {
    const entries = [];
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
            const level = Number(node.attrs?.level ?? 1);
            const text = (node.textContent ?? "").trim();
            if (text.length === 0) {
                return true;
            }
            entries.push({
                text,
                level: Math.max(1, Math.min(6, level)),
                pos
            });
        }
        return true;
    });
    return entries;
};
const insertTocNode = (editor, entries) => {
    if (entries.length === 0) {
        window.alert("No headings found to populate a table of contents.");
        return;
    }
    const tocNode = editor.schema.nodes.toc;
    if (!tocNode) {
        window.alert("Table of Contents is not available in the current schema.");
        return;
    }
    editor.chain().focus().insertContent({ type: "toc", attrs: { entries } }).run();
};
const updateTocNodes = (editor, entries) => {
    const tocNode = editor.schema.nodes.toc;
    if (!tocNode) {
        return false;
    }
    const tr = editor.state.tr;
    let updated = false;
    editor.state.doc.descendants((node, pos) => {
        if (node.type === tocNode) {
            tr.setNodeMarkup(pos, tocNode, { ...node.attrs, entries });
            updated = true;
        }
        return true;
    });
    if (updated) {
        editor.view.dispatch(tr);
    }
    return updated;
};
const collectBibliographyEntries = (editor) => (0, citation_state_js_1.getCitationSources)(editor);
const insertBibliographyNode = (editor, entries) => {
    if (entries.length === 0) {
        window.alert("No sources available to create a bibliography.");
        return;
    }
    const bibliographyNode = editor.schema.nodes.bibliography;
    if (!bibliographyNode) {
        window.alert("Bibliography support is not available in this schema.");
        return;
    }
    editor.chain().focus().insertContent({ type: "bibliography", attrs: { entries } }).run();
};
const updateBibliographyNodes = (editor, entries) => {
    const bibliographyNode = editor.schema.nodes.bibliography;
    if (!bibliographyNode) {
        return false;
    }
    const tr = editor.state.tr;
    let updated = false;
    editor.state.doc.descendants((node, pos) => {
        if (node.type === bibliographyNode) {
            tr.setNodeMarkup(pos, bibliographyNode, { ...node.attrs, entries });
            updated = true;
        }
        return true;
    });
    if (updated) {
        editor.view.dispatch(tr);
    }
    return updated;
};
const updateCitationNodes = (editor, sources) => {
    const citationNode = editor.schema.nodes.citation;
    if (!citationNode) {
        return false;
    }
    const tr = editor.state.tr;
    let updated = false;
    editor.state.doc.descendants((node, pos) => {
        if (node.type === citationNode) {
            const targetId = typeof node.attrs?.sourceId === "string" ? node.attrs.sourceId : "";
            const source = sources.find((entry) => entry.id === targetId);
            const desiredLabel = source?.label || targetId;
            if (desiredLabel && node.attrs?.label !== desiredLabel) {
                tr.setNodeMarkup(pos, citationNode, { ...node.attrs, label: desiredLabel });
                updated = true;
            }
        }
        return true;
    });
    if (updated) {
        editor.view.dispatch(tr);
    }
    return updated;
};
const collectFootnoteTargets = (editor) => {
    const results = [];
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote") {
            const id = typeof node.attrs?.id === "string" ? node.attrs.id : undefined;
            results.push({ pos, id });
        }
        return true;
    });
    return results;
};
const navigateFootnote = (editor, direction) => {
    const entries = collectFootnoteTargets(editor);
    if (entries.length === 0) {
        window.alert("No footnotes exist in this document.");
        return;
    }
    const { from } = editor.state.selection;
    let targetIndex = -1;
    if (direction === "next") {
        for (let i = 0; i < entries.length; i += 1) {
            if (entries[i].pos > from) {
                targetIndex = i;
                break;
            }
        }
    }
    else {
        for (let i = entries.length - 1; i >= 0; i -= 1) {
            if (entries[i].pos < from) {
                targetIndex = i;
                break;
            }
        }
    }
    if (targetIndex === -1) {
        window.alert(direction === "next" ? "Already at the last footnote." : "Already at the first footnote.");
        return;
    }
    const target = entries[targetIndex];
    const selection = state_1.TextSelection.create(editor.state.doc, target.pos);
    editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
    if (target.id) {
        (0, extension_footnote_js_1.getFootnoteRegistry)().get(target.id)?.open();
    }
};
const SPELLING_DICTIONARY = new Set([
    "the", "and", "is", "in", "it", "of", "to", "a", "editor", "document", "review", "word", "count", "text", "paragraph", "comment", "proof", "sentence", "page"
]);
const THESAURUS = {
    important: ["significant", "notable", "critical"],
    review: ["evaluate", "assess", "examine"],
    document: ["manuscript", "file", "text"],
    word: ["term", "lexeme", "expression"],
    change: ["modify", "adjust", "revise"]
};
const getEditorPlainText = (editor) => editor.state.doc.textContent ?? "";
const getWordStatistics = (editor) => {
    const text = getEditorPlainText(editor);
    const words = (text.match(/\b[\p{L}\p{N}']+\b/gu) || []).length;
    const characters = text.replace(/\s+/g, "").length;
    let paragraphs = 0;
    editor.state.doc.descendants((node) => {
        if (node.type.name === "paragraph" || node.type.name === "heading") {
            paragraphs += 1;
        }
        return true;
    });
    const sentences = (text.match(/[^.!?]+[.!?]+/g) || []).length;
    return { text, words, characters, paragraphs, sentences };
};
const getMisspelledWords = (editor) => {
    const text = getEditorPlainText(editor).toLowerCase();
    const words = text.match(/\b[\p{L}'-]+\b/gu) || [];
    const suggestions = [];
    const seen = new Set();
    for (const word of words) {
        if (word && !SPELLING_DICTIONARY.has(word) && !seen.has(word)) {
            suggestions.push(word);
            seen.add(word);
            if (suggestions.length >= 12)
                break;
        }
    }
    return suggestions;
};
const getSynonyms = (word) => {
    return THESAURUS[word.toLowerCase()] ?? [];
};
let currentUtterance = null;
const toggleReadAloud = (editor) => {
    if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") {
        window.alert("Read aloud is not supported in this environment.");
        return;
    }
    const synth = window.speechSynthesis;
    if (currentUtterance) {
        synth.cancel();
        currentUtterance = null;
        return;
    }
    const { text } = getWordStatistics(editor);
    const trimmed = text.trim();
    if (!trimmed) {
        window.alert("Nothing to read.");
        return;
    }
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.addEventListener("end", () => {
        currentUtterance = null;
    });
    currentUtterance = utterance;
    synth.speak(utterance);
};
const MARKUP_MODES = ["All", "None", "Original"];
const MARKUP_STORAGE_KEY = "leditor:markup-mode";
const normalizeMarkupMode = (value) => {
    if (value && MARKUP_MODES.includes(value)) {
        return value;
    }
    return MARKUP_MODES[0];
};
const setMarkupMode = (value) => {
    const mode = normalizeMarkupMode(value);
    try {
        window.localStorage?.setItem(MARKUP_STORAGE_KEY, mode);
    }
    catch {
        // ignore
    }
    return mode;
};
const getMarkupMode = () => {
    try {
        const stored = window.localStorage?.getItem(MARKUP_STORAGE_KEY);
        return normalizeMarkupMode(stored);
    }
    catch {
        return MARKUP_MODES[0];
    }
};
exports.commandMap = {
    Bold(editor) {
        editor.chain().focus().toggleBold().run();
    },
    Italic(editor) {
        editor.chain().focus().toggleItalic().run();
    },
    Underline(editor) {
        editor.chain().focus().toggleMark("underline").run();
    },
    Strikethrough(editor) {
        editor.chain().focus().toggleMark("strikethrough").run();
    },
    Superscript(editor) {
        editor.chain().focus().toggleMark("superscript").run();
    },
    Subscript(editor) {
        editor.chain().focus().toggleMark("subscript").run();
    },
    Undo(editor) {
        editor.chain().focus().undo().run();
        (0, search_js_1.notifySearchUndo)();
        (0, autosave_js_1.notifyAutosaveUndoRedo)();
        (0, direction_js_1.notifyDirectionUndo)();
    },
    Redo(editor) {
        editor.chain().focus().redo().run();
        (0, autosave_js_1.notifyAutosaveUndoRedo)();
    },
    Cut(editor) {
        editor.commands.focus();
        execClipboardCommand("cut");
    },
    Copy(editor) {
        editor.commands.focus();
        execClipboardCommand("copy");
    },
    Paste(editor) {
        editor.commands.focus();
        void readClipboardText().then((text) => {
            if (text) {
                editor.chain().focus().insertContent(text).run();
                return;
            }
            execClipboardCommand("paste");
        });
    },
    PastePlain(editor) {
        editor.commands.focus();
        void readClipboardText().then((text) => {
            if (!text) {
                return;
            }
            editor.chain().focus().insertContent(text).run();
        });
    },
    Fullscreen() {
        (0, fullscreen_js_1.toggleFullscreen)();
    },
    BulletList(editor) {
        editor.chain().focus().toggleBulletList().run();
    },
    NumberList(editor) {
        editor.chain().focus().toggleOrderedList().run();
    },
    Heading1(editor) {
        editor.chain().focus().toggleHeading({ level: 1 }).run();
    },
    Heading2(editor) {
        editor.chain().focus().toggleHeading({ level: 2 }).run();
    },
    Heading3(editor) {
        editor.chain().focus().toggleHeading({ level: 3 }).run();
    },
    Heading4(editor) {
        editor.chain().focus().toggleHeading({ level: 4 }).run();
    },
    Heading5(editor) {
        editor.chain().focus().toggleHeading({ level: 5 }).run();
    },
    Heading6(editor) {
        editor.chain().focus().toggleHeading({ level: 6 }).run();
    },
    AlignLeft(editor) {
        editor.commands.focus();
        editor.commands.updateAttributes("paragraph", { textAlign: "left" });
        editor.commands.updateAttributes("heading", { textAlign: "left" });
    },
    AlignCenter(editor) {
        editor.commands.focus();
        editor.commands.updateAttributes("paragraph", { textAlign: "center" });
        editor.commands.updateAttributes("heading", { textAlign: "center" });
    },
    AlignRight(editor) {
        editor.commands.focus();
        editor.commands.updateAttributes("paragraph", { textAlign: "right" });
        editor.commands.updateAttributes("heading", { textAlign: "right" });
    },
    JustifyFull(editor) {
        editor.commands.focus();
        editor.commands.updateAttributes("paragraph", { textAlign: "justify" });
        editor.commands.updateAttributes("heading", { textAlign: "justify" });
    },
    VisualBlocks() {
        (0, visual_js_1.toggleVisualBlocks)();
    },
    VisualChars() {
        (0, visual_js_1.toggleVisualChars)();
    },
    DirectionLTR(editor) {
        (0, direction_js_1.applyBlockDirection)(editor, "ltr");
    },
    DirectionRTL(editor) {
        (0, direction_js_1.applyBlockDirection)(editor, "rtl");
    },
    Indent(editor) {
        editor.commands.focus();
        if (findListItemDepth(editor) !== null) {
            editor.commands.sinkListItem("listItem");
            return;
        }
        const block = getBlockAtSelection(editor);
        if (!block)
            return;
        const current = Number(block.attrs.indentLevel ?? 0);
        const next = current + 1;
        editor.commands.updateAttributes(block.name, { indentLevel: next });
    },
    Outdent(editor) {
        editor.commands.focus();
        if (findListItemDepth(editor) !== null) {
            editor.commands.liftListItem("listItem");
            return;
        }
        const block = getBlockAtSelection(editor);
        if (!block)
            return;
        const current = Number(block.attrs.indentLevel ?? 0);
        const next = Math.max(0, current - 1);
        editor.commands.updateAttributes(block.name, { indentLevel: next });
    },
    LineSpacing(editor, args) {
        if (!args || typeof args.value !== "string") {
            throw new Error("LineSpacing requires { value }");
        }
        editor.commands.focus();
        editor.commands.updateAttributes("paragraph", { lineHeight: args.value });
        editor.commands.updateAttributes("heading", { lineHeight: args.value });
    },
    SpaceBefore(editor, args) {
        if (!args || typeof args.valuePx !== "number") {
            throw new Error("SpaceBefore requires { valuePx }");
        }
        editor.commands.focus();
        editor.commands.updateAttributes("paragraph", { spaceBefore: args.valuePx });
        editor.commands.updateAttributes("heading", { spaceBefore: args.valuePx });
    },
    SpaceAfter(editor, args) {
        if (!args || typeof args.valuePx !== "number") {
            throw new Error("SpaceAfter requires { valuePx }");
        }
        editor.commands.focus();
        editor.commands.updateAttributes("paragraph", { spaceAfter: args.valuePx });
        editor.commands.updateAttributes("heading", { spaceAfter: args.valuePx });
    },
    FontFamily(editor, args) {
        if (!args || typeof args.value !== "string") {
            throw new Error("FontFamily requires { value }");
        }
        const chain = editor.chain().focus();
        if (editor.state.selection.empty) {
            chain.selectAll();
        }
        chain.setMark("fontFamily", { fontFamily: args.value }).run();
    },
    FontSize(editor, args) {
        if (!args || typeof args.valuePx !== "number") {
            throw new Error("FontSize requires { valuePx }");
        }
        const chain = editor.chain().focus();
        if (editor.state.selection.empty) {
            chain.selectAll();
        }
        chain.setMark("fontSize", { fontSize: args.valuePx }).run();
    },
    NormalStyle(editor) {
        editor.chain().focus().setParagraph().run();
    },
    RemoveFontStyle(editor) {
        editor.chain().focus().unsetMark("fontFamily").unsetMark("fontSize").run();
    },
    TextColor(editor, args) {
        if (!args || typeof args.value !== "string") {
            throw new Error("TextColor requires { value }");
        }
        editor.chain().focus().setMark("textColor", { color: args.value }).run();
    },
    RemoveTextColor(editor) {
        editor.chain().focus().unsetMark("textColor").run();
    },
    HighlightColor(editor, args) {
        if (!args || typeof args.value !== "string") {
            throw new Error("HighlightColor requires { value }");
        }
        editor.chain().focus().setMark("highlightColor", { highlight: args.value }).run();
    },
    RemoveHighlightColor(editor) {
        editor.chain().focus().unsetMark("highlightColor").run();
    },
    Link(editor) {
        const raw = window.prompt("Enter link URL");
        if (raw === null)
            return;
        const href = raw.trim();
        const chain = editor.chain().focus();
        const markChain = chain.extendMarkRange("link");
        if (href.length === 0) {
            markChain.unsetLink().run();
            return;
        }
        markChain.setLink({ href }).run();
    },
    ClearFormatting(editor) {
        editor
            .chain()
            .focus()
            .unsetMark("bold")
            .unsetMark("italic")
            .unsetMark("link")
            .unsetMark("fontFamily")
            .unsetMark("fontSize")
            .run();
    },
    ChangeCase(editor, args) {
        const mode = typeof args?.mode === "string" ? args.mode : undefined;
        const transformer = getCaseTransformer(mode);
        applyCaseTransform(editor, transformer);
    },
    EditLink(editor) {
        const current = editor.getAttributes("link").href ?? "";
        const raw = window.prompt("Edit link URL", current);
        if (raw === null)
            return;
        const href = raw.trim();
        const chain = editor.chain().focus();
        const markChain = chain.extendMarkRange("link");
        if (href.length === 0) {
            markChain.unsetLink().run();
            return;
        }
        markChain.setLink({ href }).run();
    },
    RemoveLink(editor) {
        const chain = editor.chain().focus();
        chain.extendMarkRange("link").unsetLink().run();
    },
    TableInsert(editor, args) {
        const rows = Math.max(1, Number(args?.rows ?? 2));
        const cols = Math.max(1, Number(args?.cols ?? 2));
        editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run();
    },
    InsertImage(editor) {
        requestImageInsert(editor);
    },
    TableAddRowAbove(editor) {
        editor.chain().focus().addRowBefore().run();
    },
    TableAddRowBelow(editor) {
        editor.chain().focus().addRowAfter().run();
    },
    TableAddColumnLeft(editor) {
        editor.chain().focus().addColumnBefore().run();
    },
    TableAddColumnRight(editor) {
        editor.chain().focus().addColumnAfter().run();
    },
    TableDeleteRow(editor) {
        editor.chain().focus().deleteRow().run();
    },
    TableDeleteColumn(editor) {
        editor.chain().focus().deleteColumn().run();
    },
    TableMergeCells(editor) {
        editor.chain().focus().mergeCells().run();
    },
    TableSplitCell(editor) {
        editor.chain().focus().splitCell().run();
    },
    SelectStart(editor) {
        editor.chain().focus().setTextSelection(0).run();
    },
    InsertFootnote(editor) {
        const footnoteNode = editor.schema.nodes.footnote;
        if (!footnoteNode) {
            throw new Error("Footnote node is not available on the schema");
        }
        const id = (0, footnote_state_js_1.allocateFootnoteId)();
        const textNode = editor.schema.text("Footnote text");
        const footnote = footnoteNode.create({ id }, textNode);
        editor.chain().focus().insertContent(footnote).insertContent(" ").run();
    },
    InsertEndnote(editor) {
        const footnoteNode = editor.schema.nodes.footnote;
        if (!footnoteNode) {
            throw new Error('Footnote node is not available on the schema');
        }
        const id = (0, footnote_state_js_1.allocateFootnoteId)();
        const textNode = editor.schema.text('Endnote text');
        const footnote = footnoteNode.create({ id, kind: 'endnote' }, textNode);
        editor.chain().focus().insertContent(footnote).insertContent(' ').run();
    },
    NextFootnote(editor) {
        navigateFootnote(editor, 'next');
    },
    PreviousFootnote(editor) {
        navigateFootnote(editor, 'previous');
    },
    InsertBookmark(editor, args) {
        const bookmarkNode = editor.schema.nodes.bookmark;
        if (!bookmarkNode) {
            throw new Error("Bookmark node is not available on the schema");
        }
        const existing = new Set(collectBookmarks(editor).map((entry) => entry.id));
        const suggestedLabel = typeof args?.label === "string" ? args.label : "";
        const rawLabel = window.prompt("Bookmark label", suggestedLabel);
        if (rawLabel === null) {
            return;
        }
        const label = rawLabel.trim();
        if (!label) {
            return;
        }
        const overrideId = typeof args?.id === "string" && args.id.trim().length > 0 ? args.id.trim() : undefined;
        const idBase = overrideId ?? slugifyBookmarkLabel(label);
        const id = ensureUniqueBookmarkId(idBase, existing);
        editor.chain().focus().insertContent(bookmarkNode.create({ id, label })).insertContent(" ").run();
    },
    InsertCrossReference(editor, args) {
        const crossRefNode = editor.schema.nodes.cross_reference;
        if (!crossRefNode) {
            throw new Error("Cross reference node is not available on the schema");
        }
        const bookmarks = collectBookmarks(editor);
        if (bookmarks.length === 0) {
            window.alert("Insert a bookmark before creating a cross-reference.");
            return;
        }
        const targetIdArg = typeof args?.targetId === "string" ? args.targetId.trim() : "";
        let targetId = targetIdArg;
        if (!targetId) {
            const summary = bookmarks
                .slice(0, 6)
                .map((entry) => `${entry.id} (${entry.label || "unnamed"})`)
                .join(", ");
            const rawTarget = window.prompt(`Reference bookmark id (${summary})`, bookmarks[0].id);
            if (rawTarget === null)
                return;
            targetId = rawTarget.trim();
        }
        if (!targetId) {
            return;
        }
        const bookmark = bookmarks.find((entry) => entry.id === targetId);
        if (!bookmark) {
            window.alert(`Bookmark "${targetId}" not found.`);
            return;
        }
        editor.chain().focus().insertContent(crossRefNode.create({ targetId, label: bookmark.label || targetId })).run();
    },
    InsertTOC(editor) {
        const entries = collectHeadingEntries(editor);
        insertTocNode(editor, entries);
    },
    UpdateTOC(editor) {
        const entries = collectHeadingEntries(editor);
        if (!updateTocNodes(editor, entries)) {
            window.alert('No table of contents found to update.');
        }
    },
    InsertTocHeading(editor) {
        const text = window.prompt('Heading text');
        if (!text) {
            return;
        }
        const rawLevel = window.prompt('Heading level (1-6)', '1');
        const level = Math.max(1, Math.min(6, Number.parseInt(rawLevel ?? '1', 10) || 1));
        const trimmed = text.trim();
        if (trimmed.length === 0) {
            return;
        }
        editor
            .chain()
            .focus()
            .insertContent([
            { type: 'heading', attrs: { level }, content: [{ type: 'text', text: trimmed }] },
            { type: 'paragraph' }
        ])
            .run();
    },
    InsertCitation(editor) {
        const sources = (0, citation_state_js_1.getCitationSources)(editor);
        const summary = sources
            .slice(0, 6)
            .map((entry) => `${entry.id}${entry.label ? ` (${entry.label})` : ''}`)
            .join(', ');
        const defaultId = sources[0]?.id ?? '';
        const promptMessage = summary
            ? `Existing sources:
${summary}
Enter citation ID`
            : 'Enter citation ID';
        const rawId = window.prompt(promptMessage, defaultId);
        if (!rawId) {
            return;
        }
        const normalizedId = (0, citation_state_js_1.normalizeCitationId)(rawId);
        if (!normalizedId) {
            return;
        }
        let source = (0, citation_state_js_1.getCitationSourceById)(editor, normalizedId);
        let label = source?.label || normalizedId;
        if (!source) {
            const customLabel = window.prompt('Citation label', label);
            if (customLabel === null) {
                return;
            }
            label = customLabel.trim() || normalizedId;
            (0, citation_state_js_1.upsertCitationSource)(editor, { id: normalizedId, label });
            source = { id: normalizedId, label };
        }
        const citationNode = editor.schema.nodes.citation;
        if (!citationNode) {
            window.alert('Citations are not supported in this schema.');
            return;
        }
        editor.chain().focus().insertContent(citationNode.create({ sourceId: normalizedId, label })).run();
    },
    UpdateCitations(editor) {
        const sources = (0, citation_state_js_1.getCitationSources)(editor);
        if (!updateCitationNodes(editor, sources)) {
            window.alert('No citations to update.');
        }
    },
    SetCitationStyle(editor, args) {
        const payload = typeof args?.style === 'string' ? args.style : '';
        const style = constants_js_1.CITATION_STYLES.includes(payload) ? payload : CITATION_STYLE_DEFAULT;
        saveCitationStyle(style);
        updateCitationNodes(editor, (0, citation_state_js_1.getCitationSources)(editor));
        updateBibliographyNodes(editor, collectBibliographyEntries(editor));
    },
    InsertBibliography(editor) {
        insertBibliographyNode(editor, collectBibliographyEntries(editor));
    },
    UpdateBibliography(editor) {
        if (!updateBibliographyNodes(editor, collectBibliographyEntries(editor))) {
            window.alert('No bibliography found to update.');
        }
    },
    InsertPageBreak(editor) {
        const pageBreakNode = editor.schema.nodes.page_break;
        if (!pageBreakNode) {
            throw new Error('Page break node is not available on the schema');
        }
        editor.chain().focus().insertContent({ type: 'page_break', attrs: { kind: 'page' } }).run();
    },
    InsertTemplate(editor, args) {
        const templateId = typeof args?.id === 'string' ? args.id : undefined;
        if (!templateId) {
            return;
        }
        const template = (0, index_js_1.getTemplateById)(templateId);
        if (!template) {
            console.warn('InsertTemplate: unknown template', templateId);
            return;
        }
        editor.chain().focus().insertContent(template.document).run();
    },
    WordCount(editor) {
        const stats = getWordStatistics(editor);
        window.alert(`Words: ${stats.words}
Characters: ${stats.characters}
Paragraphs: ${stats.paragraphs}
Sentences: ${stats.sentences}`);
    },
    Spelling(editor) {
        const suggestions = getMisspelledWords(editor);
        if (suggestions.length === 0) {
            window.alert('No obvious spelling issues detected.');
            return;
        }
        window.alert(`Potential spelling issues:
${suggestions.slice(0, 6).join('\\n')}`);
    },
    Thesaurus(editor) {
        const rawWord = window.prompt('Enter a word to look up in the thesaurus');
        if (!rawWord) {
            return;
        }
        const word = rawWord.trim();
        const synonyms = getSynonyms(word);
        if (synonyms.length === 0) {
            window.alert(`No synonyms found for "${word.trim()}"`);
            return;
        }
        window.alert(`Synonyms for "${word.trim()}":
${synonyms.join(', ')}`);
    },
    ReadAloud(editor) {
        toggleReadAloud(editor);
    },
    ProofingPanel(editor) {
        const stats = getWordStatistics(editor);
        window.alert(`Proofing summary:
Words: ${stats.words}
Characters: ${stats.characters}
Paragraphs: ${stats.paragraphs}`);
    },
    CommentsNew() {
        window.alert('Comments are not supported in this build.');
    },
    CommentsDelete() {
        window.alert('Comments are not supported in this build.');
    },
    CommentsPrev() {
        window.alert('Comments navigation is not supported.');
    },
    CommentsNext() {
        window.alert('Comments navigation is not supported.');
    },
    ToggleTrackChanges() {
        window.alert('Track changes is disabled for now.');
    },
    AcceptChange() {
        window.alert('Track changes is disabled.');
    },
    RejectChange() {
        window.alert('Track changes is disabled.');
    },
    PrevChange() {
        window.alert('Track changes navigation is disabled.');
    },
    NextChange() {
        window.alert('Track changes navigation is disabled.');
    },
    SetReadMode() {
        (0, view_state_js_1.setReadMode)(true);
    },
    SetPrintLayout() {
        (0, view_state_js_1.setReadMode)(false);
    },
    SetScrollDirectionVertical() {
        (0, view_state_js_1.setScrollDirection)("vertical");
    },
    SetScrollDirectionHorizontal() {
        (0, view_state_js_1.setScrollDirection)("horizontal");
    },
    ZoomIn() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout)
            return;
        layout.setZoom(layout.getZoom() + 0.1);
    },
    ZoomOut() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout)
            return;
        layout.setZoom(layout.getZoom() - 0.1);
    },
    ZoomReset() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout)
            return;
        layout.setZoom(1);
    },
    ViewSinglePage() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout)
            return;
        layout.setViewMode("single");
    },
    ViewTwoPage() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout)
            return;
        layout.setViewMode("two-page");
    },
    ViewFitWidth() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout)
            return;
        layout.setViewMode("fit-width");
    },
    SetPageMargins(editor, args) {
        const margins = args?.margins;
        if (!margins || typeof margins !== "object") {
            throw new Error("SetPageMargins requires { margins }");
        }
        const tiptap = getTiptap(editor);
        if (!tiptap?.commands?.setPageMargins) {
            throw new Error("TipTap setPageMargins command unavailable");
        }
        const payload = {
            top: parseToCm(margins.top, 2.5),
            right: parseToCm(margins.right, 2.5),
            bottom: parseToCm(margins.bottom, 2.5),
            left: parseToCm(margins.left, 2.5)
        };
        console.info("[RibbonDebug] SetPageMargins dispatch", payload);
        tiptap.commands.setPageMargins(payload);
        if (typeof args?.presetId === "string") {
            (0, pagination_index_js_1.setMarginsPreset)(args.presetId);
        }
        else {
            (0, pagination_index_js_1.setMarginsCustom)(margins);
        }
        (0, pagination_index_js_1.applyDocumentLayoutTokens)(document.documentElement);
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (layout?.setMargins) {
            layout.setMargins(margins);
            layout.updatePagination();
            return;
        }
        (0, layout_settings_js_1.setPageMargins)(margins);
    },
    SetPageOrientation(editor, args) {
        const orientation = args?.orientation;
        if (orientation !== "portrait" && orientation !== "landscape") {
            throw new Error('SetPageOrientation requires { orientation: "portrait" | "landscape" }');
        }
        const tiptap = getTiptap(editor);
        if (!tiptap?.commands?.setPageOrientation) {
            console.info("[RibbonDebug] SetPageOrientation missing command", { orientation });
            throw new Error("TipTap setPageOrientation command unavailable");
        }
        const ok = tiptap.commands.setPageOrientation(orientation);
        console.info("[RibbonDebug] SetPageOrientation result", { orientation, ok });
        if (!ok) {
            throw new Error("setPageOrientation command failed");
        }
        (0, pagination_index_js_1.setOrientation)(orientation);
        (0, pagination_index_js_1.applyDocumentLayoutTokens)(document.documentElement);
        (0, layout_settings_js_1.setPageOrientation)(orientation);
        const layout = (0, layout_context_js_1.getLayoutController)();
        layout?.updatePagination();
    },
    SetPageSize(editor, args) {
        const id = typeof args?.id === "string" ? args.id : undefined;
        const overrides = typeof args?.overrides === "object" && args?.overrides !== null ? args.overrides : undefined;
        const tiptap = getTiptap(editor);
        if (!tiptap?.commands?.setPageSize) {
            console.info("[RibbonDebug] SetPageSize missing command", { id, overrides });
            throw new Error("TipTap setPageSize command unavailable");
        }
        const ok = tiptap.commands.setPageSize(id ?? "a4", overrides);
        console.info("[RibbonDebug] SetPageSize result", { id: id ?? "a4", ok, overrides });
        if (!ok) {
            throw new Error("setPageSize command failed");
        }
        (0, pagination_index_js_1.setPageSizePreset)(id ?? "a4");
        (0, pagination_index_js_1.applyDocumentLayoutTokens)(document.documentElement);
        (0, layout_settings_js_1.setPageSize)(id, overrides);
        const layout = (0, layout_context_js_1.getLayoutController)();
        layout?.updatePagination();
    },
    SetContentFrameHeight(editor, args) {
        const value = typeof args?.value === "number" ? args.value : Number(args?.value);
        if (!Number.isFinite(value)) {
            throw new Error("SetContentFrameHeight requires { value: number }");
        }
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout || typeof layout.setContentFrameHeight !== "function") {
            throw new Error("Layout controller does not support content frame height.");
        }
        layout.setContentFrameHeight(value);
    },
    ContentFrameHeightInc() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout || typeof layout.adjustContentFrameHeight !== "function") {
            throw new Error("Layout controller does not support content frame height adjustment.");
        }
        layout.adjustContentFrameHeight(10);
    },
    ContentFrameHeightDec() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout || typeof layout.adjustContentFrameHeight !== "function") {
            throw new Error("Layout controller does not support content frame height adjustment.");
        }
        layout.adjustContentFrameHeight(-10);
    },
    ContentFrameHeightReset() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        if (!layout || typeof layout.resetContentFrameHeight !== "function") {
            throw new Error("Layout controller does not support content frame height reset.");
        }
        layout.resetContentFrameHeight();
    },
    SetPageGutter(editor, args) {
        const valueIn = typeof args?.valueIn === "number" ? args.valueIn : Number(args?.valueIn);
        const enabled = args?.enabled;
        const positionId = args?.positionId;
        (0, pagination_index_js_1.setGutter)({
            enabled,
            valueIn: Number.isFinite(valueIn) ? valueIn : undefined,
            positionId
        });
        (0, pagination_index_js_1.applyDocumentLayoutTokens)(document.documentElement);
        const layout = (0, layout_context_js_1.getLayoutController)();
        layout?.updatePagination();
    },
    SetHeaderDistance(editor, args) {
        const valueIn = typeof args?.valueIn === "number" ? args.valueIn : Number(args?.valueIn);
        if (!Number.isFinite(valueIn)) {
            throw new Error("SetHeaderDistance requires { valueIn }");
        }
        (0, pagination_index_js_1.setHeaderDistance)(valueIn);
        (0, pagination_index_js_1.applyDocumentLayoutTokens)(document.documentElement);
        const layout = (0, layout_context_js_1.getLayoutController)();
        layout?.updatePagination();
    },
    SetFooterDistance(editor, args) {
        const valueIn = typeof args?.valueIn === "number" ? args.valueIn : Number(args?.valueIn);
        if (!Number.isFinite(valueIn)) {
            throw new Error("SetFooterDistance requires { valueIn }");
        }
        (0, pagination_index_js_1.setFooterDistance)(valueIn);
        (0, pagination_index_js_1.applyDocumentLayoutTokens)(document.documentElement);
        const layout = (0, layout_context_js_1.getLayoutController)();
        layout?.updatePagination();
    },
    SetSectionColumns(editor, args) {
        const count = typeof args?.count === "number" ? args.count : Number(args?.count);
        if (!Number.isFinite(count)) {
            throw new Error('SetSectionColumns requires { count: number }');
        }
        const tiptap = getTiptap(editor);
        if (!tiptap?.commands?.setPageColumns) {
            throw new Error("TipTap setPageColumns command unavailable");
        }
        const ok = tiptap.commands.setPageColumns({ count });
        if (!ok) {
            throw new Error("setPageColumns command failed");
        }
        (0, layout_settings_js_1.setSectionColumns)(count);
    },
    SetLineNumbering(editor, args) {
        const mode = typeof args?.mode === "string" ? args.mode : "none";
        const tiptap = getTiptap(editor);
        if (!tiptap?.commands?.setLineNumbering) {
            throw new Error("TipTap setLineNumbering command unavailable");
        }
        const ok = tiptap.commands.setLineNumbering(mode);
        if (!ok) {
            throw new Error("setLineNumbering command failed");
        }
    },
    SetHyphenation(editor, args) {
        const mode = typeof args?.mode === "string" ? args.mode : "none";
        const tiptap = getTiptap(editor);
        if (!tiptap?.commands?.setHyphenation) {
            throw new Error("TipTap setHyphenation command unavailable");
        }
        const ok = tiptap.commands.setHyphenation(mode);
        if (!ok) {
            throw new Error("setHyphenation command failed");
        }
    },
    SetParagraphIndent(editor, args) {
        const tiptap = getTiptap(editor);
        if (!tiptap?.commands?.setParagraphIndent) {
            throw new Error("TipTap setParagraphIndent command unavailable");
        }
        const ok = tiptap.commands.setParagraphIndent({
            leftCm: args?.leftCm,
            rightCm: args?.rightCm
        });
        if (!ok) {
            throw new Error("setParagraphIndent command failed");
        }
    },
    SetParagraphSpacing(editor, args) {
        const tiptap = getTiptap(editor);
        if (!tiptap?.commands?.setParagraphSpacing) {
            throw new Error("TipTap setParagraphSpacing command unavailable");
        }
        const ok = tiptap.commands.setParagraphSpacing({
            spaceBeforePt: args?.spaceBeforePt,
            spaceAfterPt: args?.spaceAfterPt
        });
        if (!ok) {
            throw new Error("setParagraphSpacing command failed");
        }
    },
    "view.printPreview.open"(editor) {
        const tiptap = getTiptap(editor);
        if (!tiptap) {
            throw new Error("Print preview requires a TipTap editor.");
        }
        const handle = window.leditor;
        if (!handle) {
            throw new Error("Print preview requires an editor handle.");
        }
        handle.execCommand("PrintPreview");
    },
    MarkupAll(editor) {
        const mode = setMarkupMode('All');
        window.alert(`Markup mode set to ${mode}.`);
    },
    MarkupNone(editor) {
        const mode = setMarkupMode('None');
        window.alert(`Markup mode set to ${mode}.`);
    },
    MarkupOriginal(editor) {
        const mode = setMarkupMode('Original');
        window.alert(`Markup mode set to ${mode}.`);
    },
    EditHeader() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        layout?.enterHeaderFooterMode('header');
    },
    EditFooter() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        layout?.enterHeaderFooterMode('footer');
    },
    ExitHeaderFooterEdit() {
        const layout = (0, layout_context_js_1.getLayoutController)();
        layout?.exitHeaderFooterMode();
    },
    FootnotePanel() {
        window.leditorHost?.toggleFootnotePanel?.();
    }
};
