"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEditor = void 0;
const core_1 = require("@tiptap/core");
const starter_kit_1 = __importDefault(require("@tiptap/starter-kit"));
const extension_table_ns_1 = require("@tiptap/extension-table");
const Table = extension_table_ns_1.Table ?? extension_table_ns_1.default;
const extension_table_cell_1 = __importDefault(require("@tiptap/extension-table-cell"));
const extension_table_header_1 = __importDefault(require("@tiptap/extension-table-header"));
const extension_table_row_1 = __importDefault(require("@tiptap/extension-table-row"));
const prosemirror_markdown_1 = require("prosemirror-markdown");
const direction_js_1 = require("../editor/direction.js");
const search_js_1 = require("../editor/search.js");
const visual_js_1 = require("../editor/visual.js");
const autosave_js_1 = require("../editor/autosave.js");
const plugin_registry_js_1 = require("./plugin_registry.js");
const command_map_js_1 = require("./command_map.js");
const extension_align_js_1 = __importDefault(require("../extensions/extension_align.js"));
const extension_indent_js_1 = __importDefault(require("../extensions/extension_indent.js"));
const extension_spacing_js_1 = __importDefault(require("../extensions/extension_spacing.js"));
const extension_font_family_js_1 = __importDefault(require("../extensions/extension_font_family.js"));
const extension_font_size_js_1 = __importDefault(require("../extensions/extension_font_size.js"));
const extension_text_color_js_1 = __importDefault(require("../extensions/extension_text_color.js"));
const extension_highlight_color_js_1 = __importDefault(require("../extensions/extension_highlight_color.js"));
const extension_underline_js_1 = __importDefault(require("../extensions/extension_underline.js"));
const extension_strikethrough_js_1 = __importDefault(require("../extensions/extension_strikethrough.js"));
const extension_superscript_js_1 = __importDefault(require("../extensions/extension_superscript.js"));
const extension_subscript_js_1 = __importDefault(require("../extensions/extension_subscript.js"));
const extension_footnote_js_1 = __importDefault(require("../extensions/extension_footnote.js"));
const extension_page_break_js_1 = __importDefault(require("../extensions/extension_page_break.js"));
const extension_image_js_1 = __importDefault(require("../extensions/extension_image.js"));
const extension_merge_tag_js_1 = __importDefault(require("../extensions/extension_merge_tag.js"));
const extension_bookmark_js_1 = __importDefault(require("../extensions/extension_bookmark.js"));
const extension_cross_reference_js_1 = __importDefault(require("../extensions/extension_cross_reference.js"));
const extension_toc_js_1 = __importDefault(require("../extensions/extension_toc.js"));
const extension_citation_js_1 = __importDefault(require("../extensions/extension_citation.js"));
const extension_citation_sources_js_1 = __importDefault(require("../extensions/extension_citation_sources.js"));
const extension_bibliography_js_1 = __importDefault(require("../extensions/extension_bibliography.js"));
const extension_page_layout_js_1 = __importDefault(require("../extensions/extension_page_layout.js"));
const extension_paragraph_layout_js_1 = __importDefault(require("../extensions/extension_paragraph_layout.js"));
const extension_page_js_1 = require("../extensions/extension_page.js");
class EventEmitter {
    listeners = new Map();
    on(eventName, fn) {
        const existing = this.listeners.get(eventName);
        if (existing) {
            existing.add(fn);
            return;
        }
        this.listeners.set(eventName, new Set([fn]));
    }
    off(eventName, fn) {
        const existing = this.listeners.get(eventName);
        if (!existing)
            return;
        existing.delete(fn);
        if (existing.size === 0)
            this.listeners.delete(eventName);
    }
    emit(eventName, ...args) {
        const existing = this.listeners.get(eventName);
        if (!existing)
            return;
        for (const fn of existing) {
            fn(...args);
        }
    }
    clear() {
        this.listeners.clear();
    }
}
const mapMarkdownTokens = (tokens) => {
    const nodeNameMap = {
        list_item: "listItem",
        bullet_list: "bulletList",
        ordered_list: "orderedList",
        code_block: "codeBlock",
        hard_break: "hardBreak",
        horizontal_rule: "horizontalRule",
        blockquote: "blockquote",
        image: "image"
    };
    const mapped = {};
    for (const [name, spec] of Object.entries(tokens)) {
        const node = spec.node;
        const block = spec.block;
        if (!spec.mark) {
            const mappedSpec = { ...spec };
            if (node && nodeNameMap[node]) {
                mappedSpec.node = nodeNameMap[node];
            }
            if (block && nodeNameMap[block]) {
                mappedSpec.block = nodeNameMap[block];
            }
            mapped[name] = mappedSpec;
            continue;
        }
        if (spec.mark === "strong") {
            mapped[name] = { ...spec, mark: "bold" };
            continue;
        }
        if (spec.mark === "em") {
            mapped[name] = { ...spec, mark: "italic" };
            continue;
        }
        mapped[name] = spec;
    }
    return mapped;
};
const filterMarkdownTokens = (schema, tokens) => {
    const filtered = {};
    for (const [name, spec] of Object.entries(tokens)) {
        const node = spec.node;
        const block = spec.block;
        if (node && !schema.nodes[node])
            continue;
        if (block && !schema.nodes[block])
            continue;
        filtered[name] = spec;
    }
    return filtered;
};
const createMarkdownParser = (schema) => {
    const mapped = mapMarkdownTokens(prosemirror_markdown_1.defaultMarkdownParser.tokens);
    const filtered = filterMarkdownTokens(schema, mapped);
    return new prosemirror_markdown_1.MarkdownParser(schema, prosemirror_markdown_1.defaultMarkdownParser.tokenizer, filtered);
};
const createMarkdownSerializer = () => {
    const marks = { ...prosemirror_markdown_1.defaultMarkdownSerializer.marks };
    if (marks.strong) {
        marks.bold = marks.strong;
        delete marks.strong;
    }
    if (marks.em) {
        marks.italic = marks.em;
        delete marks.em;
    }
    const nodes = { ...prosemirror_markdown_1.defaultMarkdownSerializer.nodes };
    nodes.toc = (state, node) => {
        state.write("[[TOC]]");
        state.closeBlock(node);
    };
    nodes.citation = (state, node) => {
        const label = typeof node.attrs?.label === "string" && node.attrs.label.trim().length > 0
            ? node.attrs.label.trim()
            : (node.attrs?.sourceId ?? "citation");
        state.text(`[${label}]`);
    };
    nodes.citation_sources = (state, node) => {
        state.closeBlock(node);
    };
    nodes.bibliography = (state, node) => {
        state.write("## Bibliography");
        state.ensureNewLine();
        const entries = Array.isArray(node.attrs?.entries) ? node.attrs.entries : [];
        for (const entry of entries) {
            const label = typeof entry?.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : entry?.id;
            if (!label)
                continue;
            state.write(`- ${label}`);
            state.ensureNewLine();
        }
        state.closeBlock(node);
    };
    nodes.bookmark = (state, node) => {
        const rawLabel = typeof node.attrs?.label === "string" && node.attrs.label.trim().length > 0
            ? node.attrs.label.trim()
            : node.attrs?.id ?? "bookmark";
        state.text(`[bookmark:${rawLabel}]`);
    };
    nodes.cross_reference = (state, node) => {
        const label = typeof node.attrs?.label === "string" && node.attrs.label.trim().length > 0
            ? node.attrs.label.trim()
            : node.attrs?.targetId ?? "xref";
        state.text(`[xref:${label}]`);
    };
    return new prosemirror_markdown_1.MarkdownSerializer(nodes, marks, { strict: false });
};
const sanitizeClipboardHTML = (html) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("script").forEach((node) => node.remove());
    const removeEventAttributes = (element) => {
        for (const attr of Array.from(element.attributes)) {
            if (attr.name.toLowerCase().startsWith("on")) {
                element.removeAttribute(attr.name);
            }
        }
        for (const child of Array.from(element.children)) {
            removeEventAttributes(child);
        }
    };
    if (doc.body) {
        removeEventAttributes(doc.body);
    }
    return doc.body?.innerHTML.trim() ?? "";
};
exports.LEditor = {
    /**
     * Initializes the editor within the DOM element `config.elementId`.
     */
    init(config) {
        const mountEl = document.getElementById(config.elementId);
        if (!mountEl) {
            throw new Error(`LEditor: elementId "${config.elementId}" not found`);
        }
        const plugins = (0, plugin_registry_js_1.getPlugins)(config.plugins ?? []);
        const pluginExtensions = plugins.flatMap((plugin) => plugin.tiptapExtensions ?? []);
    const starterKitOptions = {};
    starterKitOptions.image = false;
    starterKitOptions.heading = { levels: [1, 2, 3, 4, 5, 6] };
    starterKitOptions.underline = false;
    console.info("[RibbonDebug] StarterKit typeof", typeof starter_kit_1.default);
    console.info("[RibbonDebug] Table typeof", typeof Table, Table);
    console.info("[RibbonDebug] TableRow typeof", typeof extension_table_row_1.default, extension_table_row_1.default);
    console.info("[RibbonDebug] TableHeader typeof", typeof extension_table_header_1.default, extension_table_header_1.default);
    console.info("[RibbonDebug] TableCell typeof", typeof extension_table_cell_1.default, extension_table_cell_1.default);
        const editor = new core_1.Editor({
            element: mountEl,
            extensions: [
                extension_page_js_1.PageNode,
                extension_page_js_1.PagePagination,
                starter_kit_1.default.configure(starterKitOptions),
                extension_align_js_1.default,
                extension_indent_js_1.default,
                extension_spacing_js_1.default,
                direction_js_1.directionExtension,
                visual_js_1.visualExtension,
                extension_font_family_js_1.default,
                extension_font_size_js_1.default,
                extension_text_color_js_1.default,
                extension_highlight_color_js_1.default,
                extension_underline_js_1.default,
                extension_strikethrough_js_1.default,
                extension_superscript_js_1.default,
                extension_subscript_js_1.default,
                extension_footnote_js_1.default,
                extension_page_break_js_1.default,
                extension_image_js_1.default,
                extension_merge_tag_js_1.default,
                extension_bookmark_js_1.default,
                extension_cross_reference_js_1.default,
                extension_toc_js_1.default,
                extension_citation_js_1.default,
                extension_citation_sources_js_1.default,
                extension_bibliography_js_1.default,
                extension_page_layout_js_1.default,
                extension_paragraph_layout_js_1.default,
                Table && Table.configure ? Table.configure({ resizable: false }) : Table,
                extension_table_row_1.default,
                extension_table_header_1.default,
                extension_table_cell_1.default,
                ...pluginExtensions
            ],
            content: ""
        });
        const handlePaste = (event) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData) {
                return;
            }
            const html = clipboardData.getData("text/html");
            if (!html) {
                return;
            }
            const sanitized = sanitizeClipboardHTML(html);
            if (!sanitized && !clipboardData.getData("text/plain")) {
                event.preventDefault();
                return;
            }
            event.preventDefault();
            if (sanitized) {
                editor.commands.insertContent(sanitized);
                return;
            }
            const plain = clipboardData.getData("text/plain");
            if (plain) {
                editor.commands.insertContent(plain);
            }
        };
        editor.view.dom.addEventListener("paste", handlePaste);
        (0, search_js_1.setSearchEditor)(editor);
        (0, visual_js_1.setVisualEditor)(editor);
        const editorInstanceId = Math.random().toString(36).slice(2, 10);
        const autosaveInterval = config.autosave?.intervalMs && config.autosave.intervalMs > 0
            ? config.autosave.intervalMs
            : 1000;
        const autosaveController = config.autosave?.enabled
            ? (0, autosave_js_1.createAutosaveController)(editor, editorInstanceId, autosaveInterval)
            : null;
        const emitter = new EventEmitter();
        const markdownParser = createMarkdownParser(editor.schema);
        const markdownSerializer = createMarkdownSerializer();
        const pluginCommands = new Map();
        editor.on("update", () => emitter.emit("change"));
        editor.on("focus", () => emitter.emit("focus"));
        editor.on("blur", () => emitter.emit("blur"));
        editor.on("selectionUpdate", () => emitter.emit("selectionChange"));
        const handle = {
            editorInstanceId,
            /** Returns the canonical JSON document currently in the editor. */
            getJSON() {
                return editor.getJSON();
            },
            /** Sets the document content using the requested format. */
            setContent(content, opts) {
                if (opts.format === "html") {
                    if (typeof content !== "string") {
                        throw new Error("LEditor.setContent: html requires string content");
                    }
                    editor.commands.setContent(content);
                    return;
                }
                if (opts.format === "markdown") {
                    if (typeof content !== "string") {
                        throw new Error("LEditor.setContent: markdown requires string content");
                    }
                    const doc = markdownParser.parse(content);
                    editor.commands.setContent(doc.toJSON());
                    return;
                }
                if (opts.format === "json") {
                    const jsonContent = typeof content === "string" ? JSON.parse(content) : content;
                    editor.commands.setContent(jsonContent);
                    return;
                }
                throw new Error(`LEditor.setContent: unsupported format "${opts.format}"`);
            },
            /** Serializes the document according to the requested format. */
            getContent(opts) {
                if (opts.format === "html") {
                    return editor.getHTML();
                }
                if (opts.format === "markdown") {
                    return markdownSerializer.serialize(editor.state.doc);
                }
                if (opts.format === "json") {
                    return editor.getJSON();
                }
                throw new Error(`LEditor.getContent: unsupported format "${opts.format}"`);
            },
            /** Executes a named command from the registry. */
            execCommand(name, args) {
                const pluginCommand = pluginCommands.get(name);
                if (pluginCommand) {
                    if (args === undefined)
                        pluginCommand();
                    else
                        pluginCommand(args);
                    return;
                }
                const command = command_map_js_1.commandMap[name];
                if (!command) {
                    throw new Error(`LEditor.execCommand: unknown command "${name}"`);
                }
                command(editor, args);
            },
            /** Subscribes to lifecycle events emitted by the editor. */
            on(eventName, fn) {
                emitter.on(eventName, fn);
            },
            /** Removes a previously registered event listener. */
            off(eventName, fn) {
                emitter.off(eventName, fn);
            },
            /** Forces focus into the editor view. */
            focus() {
                editor.commands.focus();
            },
            /** Returns the internal TipTap editor instance. */
            getEditor() {
                return editor;
            },
            /** Returns the last autosave snapshot (per editorInstanceId). */
            getAutosaveSnapshot() {
                return (0, autosave_js_1.getAutosaveSnapshot)(editorInstanceId);
            },
            /** Restores the autosave snapshot into the editor. */
            restoreAutosaveSnapshot() {
                (0, autosave_js_1.restoreAutosaveSnapshot)(handle, editorInstanceId);
            },
            /** Destroys the editor instance and cleans up listeners. */
            destroy() {
                emitter.clear();
                autosaveController?.destroy();
                editor.view.dom.removeEventListener("paste", handlePaste);
                editor.destroy();
            }
        };
        handle.__editor = editor;
        for (const plugin of plugins) {
            if (!plugin.commands)
                continue;
            for (const [name, fn] of Object.entries(plugin.commands)) {
                if (pluginCommands.has(name)) {
                    throw new Error(`LEditor: command "${name}" already registered by another plugin`);
                }
                pluginCommands.set(name, (args) => fn(handle, args));
            }
        }
        if (config.initialContent) {
            handle.setContent(config.initialContent.value, { format: config.initialContent.format });
        }
        else {
            handle.setContent("<p>Welcome to LEditor.</p>", { format: "html" });
        }
        for (const plugin of plugins) {
            plugin.onInit?.(handle);
        }
        return handle;
    }
};
