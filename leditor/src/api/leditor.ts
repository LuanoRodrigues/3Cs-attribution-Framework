import { Editor } from "@tiptap/core";
import StarterKit, { type StarterKitOptions } from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";

import {
  MarkdownParser,
  MarkdownSerializer,
  type ParseSpec,
  defaultMarkdownParser,
  defaultMarkdownSerializer
} from "prosemirror-markdown";
import type { Schema } from "prosemirror-model";
import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { directionExtension } from "../editor/direction.ts";
import { setSearchEditor } from "../editor/search.ts";
import { setVisualEditor, visualExtension } from "../editor/visual.ts";
import { createAutosaveController, getAutosaveSnapshot, restoreAutosaveSnapshot } from "../editor/autosave.ts";
import { getPlugins } from "./plugin_registry.ts";
import "../plugins/pasteCleaner.ts";
import "../plugins/docx.ts";
import "../plugins/pdf.ts";
import "../plugins/trackChanges.ts";
import "../plugins/revisionHistory.ts";
import "../plugins/spellcheck.ts";
import "../plugins/aiAssistant.ts";
import "../plugins/aiAgent.ts";
import "../plugins/comments.ts";
import "../extensions/plugin_source_view.ts";
import "../extensions/plugin_debug.ts";
import "../extensions/plugin_print_preview.ts";
import { commandMap } from "./command_map.ts";
import AlignExtension from "../extensions/extension_align.ts";
import IndentExtension from "../extensions/extension_indent.ts";
import SpacingExtension from "../extensions/extension_spacing.ts";
import FontFamilyMark from "../extensions/extension_font_family.ts";
import FontSizeMark from "../extensions/extension_font_size.ts";
import TextColorMark from "../extensions/extension_text_color.ts";
import HighlightColorMark from "../extensions/extension_highlight_color.ts";
import UnderlineMark from "../extensions/extension_underline.ts";
import StrikethroughMark from "../extensions/extension_strikethrough.ts";
import SuperscriptMark from "../extensions/extension_superscript.ts";
import SubscriptMark from "../extensions/extension_subscript.ts";
import CitationLink from "../extensions/extension_citation_link.ts";
import CitationNode from "../extensions/extension_citation.ts";
import AnchorMark from "../extensions/extension_anchor.ts";
import AnchorMarker from "../extensions/extension_anchor_marker.ts";
import FootnoteExtension from "../extensions/extension_footnote.ts";
import PageBreakExtension from "../extensions/extension_page_break.ts";
import ImageExtension from "../extensions/extension_image.ts";
import MergeTagExtension from "../extensions/extension_merge_tag.ts";
import BookmarkExtension from "../extensions/extension_bookmark.ts";
import CrossReferenceExtension from "../extensions/extension_cross_reference.ts";
import TocExtension from "../extensions/extension_toc.ts";
import CitationSourcesExtension from "../extensions/extension_citation_sources.ts";
import BibliographyExtension from "../extensions/extension_bibliography.ts";
import WordShortcutsExtension from "../extensions/extension_word_shortcuts.ts";
import CommentMark from "../extensions/extension_comment.ts";
import PageLayoutExtension from "../extensions/extension_page_layout.ts";
import ParagraphLayoutExtension from "../extensions/extension_paragraph_layout.ts";
import { PageDocument, PageNode, PagePagination } from "../extensions/extension_page.ts";
import StyleStoreExtension from "../extensions/extension_style_store.ts";
import { extractCitedKeysFromDoc, writeCitedWorksKeys } from "../ui/references/cited_works.ts";
import {
  FootnotesContainerExtension,
  FootnoteBodyExtension,
  FootnoteBodyManagementExtension
} from "../extensions/extension_footnote_body.ts";

type ContentFormat = "json" | "html" | "markdown";
type EditorEventName = "change" | "focus" | "blur" | "selectionChange";

export type EditorInitConfig = {
  elementId: string;
  toolbar?: string;
  plugins?: string[];
  initialContent?: { format: ContentFormat; value: string | object };
  autosave?: { enabled: boolean; intervalMs: number };
};

/** Handle exposed to the host application for driving the editor. */
export type EditorHandle = {
  editorInstanceId: string;
  /** Returns the canonical JSON document. */
  getJSON(): object;
  /** Replaces document content (html/markdown/json). */
  setContent(content: string | object, opts: { format: ContentFormat }): void;
  /** Exports the document in the requested format. */
  getContent(opts: { format: ContentFormat }): string | object;
  /** Executes a registered command by name. */
  execCommand(name: string, args?: any): void;
  /** Subscribe to editor events. */
  on(eventName: EditorEventName, fn: Function): void;
  /** Unsubscribe from editor events. */
  off(eventName: EditorEventName, fn: Function): void;
  /** Focuses the editor viewport. */
  focus(): void;
  /** Returns the internal TipTap editor instance. */
  getEditor(): Editor;
  /** Returns the autosave snapshot (if any). */
  getAutosaveSnapshot(): object | null;
  /** Restores the autosave snapshot. */
  restoreAutosaveSnapshot(): void;
  /** Tears down the editor instance. */
  destroy(): void;
};
type Listener = (...args: any[]) => void;

class EventEmitter {
  private listeners = new Map<EditorEventName, Set<Listener>>();

  on(eventName: EditorEventName, fn: Listener) {
    const existing = this.listeners.get(eventName);
    if (existing) {
      existing.add(fn);
      return;
    }
    this.listeners.set(eventName, new Set([fn]));
  }

  off(eventName: EditorEventName, fn: Listener) {
    const existing = this.listeners.get(eventName);
    if (!existing) return;
    existing.delete(fn);
    if (existing.size === 0) this.listeners.delete(eventName);
  }

  emit(eventName: EditorEventName, ...args: any[]) {
    const existing = this.listeners.get(eventName);
    if (!existing) return;
    for (const fn of existing) {
      fn(...args);
    }
  }

  clear() {
    this.listeners.clear();
  }
}

const mapMarkdownTokens = (tokens: { [name: string]: ParseSpec }) => {
  const nodeNameMap: Record<string, string> = {
    list_item: "listItem",
    bullet_list: "bulletList",
    ordered_list: "orderedList",
    code_block: "codeBlock",
    hard_break: "hardBreak",
    horizontal_rule: "horizontalRule",
    blockquote: "blockquote",
    image: "image"
  };
  const mapped: { [name: string]: ParseSpec } = {};
  for (const [name, spec] of Object.entries(tokens)) {
    const node = (spec as ParseSpec & { node?: string }).node;
    const block = (spec as ParseSpec & { block?: string }).block;
    if (!spec.mark) {
      const mappedSpec = { ...spec } as ParseSpec & { node?: string; block?: string };
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

const filterMarkdownTokens = (schema: Schema, tokens: { [name: string]: ParseSpec }) => {
  const filtered: { [name: string]: ParseSpec } = {};
  for (const [name, spec] of Object.entries(tokens)) {
    const node = (spec as ParseSpec & { node?: string }).node;
    const block = (spec as ParseSpec & { block?: string }).block;
    if (node && !schema.nodes[node]) continue;
    if (block && !schema.nodes[block]) continue;
    filtered[name] = spec;
  }
  return filtered;
};

const createMarkdownParser = (schema: Schema) => {
  const mapped = mapMarkdownTokens(defaultMarkdownParser.tokens);
  const filtered = filterMarkdownTokens(schema, mapped);
  return new MarkdownParser(schema, defaultMarkdownParser.tokenizer, filtered);
};

const createMarkdownSerializer = () => {
  const marks = { ...defaultMarkdownSerializer.marks };
  if (marks.strong) {
    marks.bold = marks.strong;
    delete marks.strong;
  }
  if (marks.em) {
    marks.italic = marks.em;
    delete marks.em;
  }
  const nodes = { ...defaultMarkdownSerializer.nodes } as typeof defaultMarkdownSerializer.nodes & {
    toc?: any;
    citation?: any;
    citation_sources?: any;
    bibliography?: any;
    bookmark?: any;
    cross_reference?: any;
  };
  nodes.toc = (state: any, node: any) => {
    state.write("[[TOC]]");
    state.closeBlock(node);
  };
  nodes.citation = (state: any, node: any) => {
    const rendered = typeof node.attrs?.renderedHtml === "string" ? node.attrs.renderedHtml : "";
    const text = rendered.replace(/<[^>]*>/g, "").trim();
    const fallback = Array.isArray(node.attrs?.items)
      ? node.attrs.items.map((item: any) => item?.itemKey).filter(Boolean).join(", ")
      : "citation";
    state.text(`[${text || fallback}]`);
  };
  nodes.citation_sources = (state: any, node: any) => {
    state.closeBlock(node);
  };
  nodes.bibliography = (state: any, node: any) => {
    state.write("## Bibliography");
    state.ensureNewLine();
    const rendered = typeof node.attrs?.renderedHtml === "string" ? node.attrs.renderedHtml : "";
    const text = rendered.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text) {
      state.write(text);
      state.ensureNewLine();
    }
    state.closeBlock(node);
  };

  nodes.bookmark = (state: any, node: any) => {
    const rawLabel =
      typeof node.attrs?.label === "string" && node.attrs.label.trim().length > 0
        ? node.attrs.label.trim()
        : node.attrs?.id ?? "bookmark";
    state.text(`[bookmark:${rawLabel}]`);
  };
  nodes.cross_reference = (state: any, node: any) => {
    const label =
      typeof node.attrs?.label === "string" && node.attrs.label.trim().length > 0
        ? node.attrs.label.trim()
        : node.attrs?.targetId ?? "xref";
    state.text(`[xref:${label}]`);
  };
  return new MarkdownSerializer(nodes, marks, { strict: false });
};

const sanitizeClipboardHTML = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("script").forEach((node) => node.remove());
  const removeEventAttributes = (element: Element) => {
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

export const LEditor = {
  /**
   * Initializes the editor within the DOM element `config.elementId`.
   */
  init(config: EditorInitConfig): EditorHandle {
    const mountEl = document.getElementById(config.elementId);
    if (!mountEl) {
      throw new Error(`LEditor: elementId "${config.elementId}" not found`);
    }

    const plugins = getPlugins(config.plugins ?? []);
    const pluginExtensions = plugins.flatMap((plugin) => plugin.tiptapExtensions ?? []);

    const starterKitOptions = {} as StarterKitOptions & { image?: boolean };
    starterKitOptions.image = false;
    starterKitOptions.heading = { levels: [1, 2, 3, 4, 5, 6] };
    starterKitOptions.underline = false;
    starterKitOptions.link = false;
    starterKitOptions.document = false;
    // Debug: silenced noisy ribbon logs.

    const editor = new Editor({
      element: mountEl,
      extensions: [
        PageDocument,
        PageNode,
        PagePagination,
        StarterKit.configure(starterKitOptions),
        AlignExtension,
        IndentExtension,
        SpacingExtension,
        directionExtension,
        visualExtension,
        FontFamilyMark,
        FontSizeMark,
        TextColorMark,
        HighlightColorMark,
        UnderlineMark,
        StrikethroughMark,
        SuperscriptMark,
        SubscriptMark,
        AnchorMark,
        AnchorMarker,
        CitationNode,
        CitationLink.configure({
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          validate: () => true,
          protocols: ["dq", "http", "https", "mailto", "file", "cite", "citegrp"]
        }),
        FootnoteExtension,
        FootnoteBodyExtension,
        FootnotesContainerExtension,
        FootnoteBodyManagementExtension,
        PageBreakExtension,
        ImageExtension,
        MergeTagExtension,
        BookmarkExtension,
        CrossReferenceExtension,
        TocExtension,
        CitationSourcesExtension,
        BibliographyExtension,
        PageLayoutExtension,
        ParagraphLayoutExtension,
        WordShortcutsExtension,
        StyleStoreExtension,
        CommentMark,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        ...pluginExtensions
      ],
      content: ""
    });
    const handlePaste = (event: ClipboardEvent) => {
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
    setSearchEditor(editor);
    setVisualEditor(editor);

    const editorInstanceId = Math.random().toString(36).slice(2, 10);
    const autosaveInterval =
      config.autosave?.intervalMs && config.autosave.intervalMs > 0
        ? config.autosave.intervalMs
        : 1000;
    const autosaveController = config.autosave?.enabled
      ? createAutosaveController(editor, editorInstanceId, autosaveInterval)
      : null;

    const emitter = new EventEmitter();
    const markdownParser = createMarkdownParser(editor.schema);
    const markdownSerializer = createMarkdownSerializer();
    const pluginCommands = new Map<string, (args?: any) => void>();

    editor.on("update", () => emitter.emit("change"));
    editor.on("focus", () => emitter.emit("focus"));
    editor.on("blur", () => emitter.emit("blur"));
    editor.on("selectionUpdate", () => emitter.emit("selectionChange"));

    // Keep the cited-works store (`references.used.json`) synced with the document so deletions are
    // reflected without requiring a manual "Update".
    let citedWorksSyncTimer: number | null = null;
    const scheduleCitedWorksSync = () => {
      if (citedWorksSyncTimer != null) {
        window.clearTimeout(citedWorksSyncTimer);
      }
      citedWorksSyncTimer = window.setTimeout(() => {
        citedWorksSyncTimer = null;
        try {
          const keys = extractCitedKeysFromDoc(editor.state.doc as any);
          void writeCitedWorksKeys(keys);
        } catch {
          // ignore
        }
      }, 450);
    };
    editor.on("update", scheduleCitedWorksSync);

    const handle: EditorHandle = {
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
          const inputAnchorCount = (content.match(/<a\b/gi) || []).length;
          console.info("[LEditor][setContent][html][input]", {
            inputAnchorCount,
            length: content.length
          });
          console.info("[LEditor][setContent][schema][marks]", Object.keys(editor.schema.marks || {}));

          type AnchorSeed = {
            href: string;
            text: string;
            title?: string;
            target?: string;
            rel?: string;
            dataKey?: string;
            dataOrigHref?: string;
            dataQuoteId?: string;
            dataDqid?: string;
            dataQuoteText?: string;
            itemKey?: string;
            dataItemKey?: string;
            dataItemKeys?: string;
          };

          const pickFirstItemKey = (raw: string): string | undefined => {
            const trimmed = (raw || "").trim();
            if (!trimmed) return undefined;
            // Accept "A,B" or "A B" or "[A]" style tokens.
            const cleaned = trimmed.replace(/^\[|\]$/g, "");
            const parts = cleaned.split(/[,\s]+/).filter(Boolean);
            return parts[0] || undefined;
          };

          const extractAnchorsFromHtml = (html: string): AnchorSeed[] => {
            try {
              const doc = new DOMParser().parseFromString(html, "text/html");
              const anchors = Array.from(doc.querySelectorAll("a"));
              return anchors
                .map((a) => {
                  const href = (a.getAttribute("href") || "").trim();
                  const text = (a.textContent || "").trim();
                  if (!href || !text) return null;
                  return {
                    href,
                    text,
                    title: (a.getAttribute("title") || "").trim() || undefined,
                    target: (a.getAttribute("target") || "").trim() || undefined,
                    rel: (a.getAttribute("rel") || "").trim() || undefined,
                    dataKey: (a.getAttribute("data-key") || "").trim() || undefined,
                    dataOrigHref: (a.getAttribute("data-orig-href") || "").trim() || undefined,
                    dataQuoteId:
                      (a.getAttribute("data-quote-id") || a.getAttribute("data-quote_id") || "").trim() || undefined,
                    dataDqid:
                      (a.getAttribute("data-dqid") || a.getAttribute("dqid") || "").trim() || undefined,
                    dataQuoteText: (a.getAttribute("data-quote-text") || "").trim() || undefined,
                    itemKey: (a.getAttribute("item-key") || "").trim() || undefined,
                    dataItemKey: (a.getAttribute("data-item-key") || "").trim() || undefined,
                    dataItemKeys: (a.getAttribute("data-item-keys") || "").trim() || undefined
                  } as AnchorSeed;
                })
                .filter((v): v is AnchorSeed => Boolean(v));
            } catch {
              return [];
            }
          };

          const anchorSeeds = inputAnchorCount > 0 ? extractAnchorsFromHtml(content) : [];

          try {
            const parsedDoc = ProseMirrorDOMParser.fromSchema(editor.schema).parse(
              new DOMParser().parseFromString(content, "text/html").body
            );
            const parsedJson = JSON.stringify(parsedDoc.toJSON());
            console.info("[LEditor][setContent][html][parsed]", {
              hasLinkMark: parsedJson.includes("\"link\""),
              textSample: parsedDoc.textBetween(0, Math.min(parsedDoc.content.size, 200), " ")
            });
          } catch (err) {
            console.warn("[LEditor][setContent][html][parsed] failed", err);
          }

          editor.commands.setContent(content, { parseOptions: { preserveWhitespace: "full" } });

          const rehydrateLinksByText = (seeds: AnchorSeed[]) => {
            if (!seeds.length) return;
            const linkMark = editor.schema.marks.link;
            if (!linkMark) return;
            // Build a fast lookup so we can enrich existing link marks with missing attributes,
            // and also re-create links if the parser dropped them.
            const seedByKey = new Map<string, AnchorSeed>();
            const toKey = (seed: AnchorSeed) =>
              `${(seed.href || "").trim()}|${(seed.dataQuoteId || seed.dataDqid || "").trim()}|${seed.text}`;
            seeds.forEach((seed) => {
              const k = toKey(seed);
              if (k) seedByKey.set(k, seed);
            });

            const tr = editor.state.tr;
            const ops: Array<{ from: number; to: number; mark: any }> = [];
            editor.state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return true;
              const marks = node.marks || [];
              const link = marks.find((m) => m.type === linkMark);
              if (!link) return true;

              const attrs = (link.attrs || {}) as Record<string, unknown>;
              const href = typeof attrs.href === "string" ? attrs.href : "";
              const dqid =
                (typeof attrs.dataQuoteId === "string" && attrs.dataQuoteId) ||
                (typeof attrs.dataDqid === "string" && attrs.dataDqid) ||
                "";
              const key = `${href.trim()}|${String(dqid || "").trim()}|${node.text}`;
              const seed = seedByKey.get(key);
              if (!seed) return true;

              const needs =
                !attrs.dataKey ||
                (!attrs.dataQuoteId && !attrs.dataDqid) ||
                (!attrs.dataOrigHref && seed.dataOrigHref) ||
                (!attrs.itemKey && seed.itemKey);
              if (!needs) return true;

              const itemKeyFallback = seed.itemKey || seed.dataItemKey || pickFirstItemKey(seed.dataItemKeys || "");
              const merged = {
                ...attrs,
                href: href || seed.href,
                title: (typeof attrs.title === "string" && attrs.title) || seed.title,
                target: (typeof attrs.target === "string" && attrs.target) || seed.target,
                rel: (typeof attrs.rel === "string" && attrs.rel) || seed.rel,
                dataKey: (typeof attrs.dataKey === "string" && attrs.dataKey) || seed.dataKey,
                dataOrigHref: (typeof attrs.dataOrigHref === "string" && attrs.dataOrigHref) || seed.dataOrigHref,
                dataQuoteId: (typeof attrs.dataQuoteId === "string" && attrs.dataQuoteId) || seed.dataQuoteId,
                dataDqid: (typeof attrs.dataDqid === "string" && attrs.dataDqid) || seed.dataDqid,
                dataQuoteText: (typeof attrs.dataQuoteText === "string" && attrs.dataQuoteText) || seed.dataQuoteText,
                itemKey: (typeof attrs.itemKey === "string" && attrs.itemKey) || itemKeyFallback,
                dataItemKey:
                  (typeof attrs.dataItemKey === "string" && attrs.dataItemKey) ||
                  seed.dataItemKey ||
                  pickFirstItemKey(seed.dataItemKeys || "")
              } as Record<string, unknown>;

              const from = pos;
              const to = pos + node.text.length;
              ops.push({ from, to, mark: linkMark.create(merged) });
              return true;
            });

            // Apply ops from end -> start to avoid position mapping issues.
            ops
              .sort((a, b) => b.from - a.from)
              .forEach((op) => {
                tr.addMark(op.from, op.to, op.mark);
              });

            if (tr.docChanged) editor.view.dispatch(tr);
          };

          try {
            const afterHtml = editor.getHTML();
            const afterAnchorCount = (afterHtml.match(/<a\b/gi) || []).length;
            console.info("[LEditor][setContent][html][after]", {
              afterAnchorCount,
              length: afterHtml.length
            });
            if (inputAnchorCount > 0 && anchorSeeds.length > 0) {
              if (afterAnchorCount === 0) {
                console.warn("[LEditor][setContent] anchors dropped; rehydrating link marks");
              } else {
                console.info("[LEditor][setContent] enriching link marks from source anchors", {
                  inputAnchorCount,
                  afterAnchorCount
                });
              }
              rehydrateLinksByText(anchorSeeds);
              const afterFix = editor.getHTML();
              console.info("[LEditor][setContent][html][after][rehydrate]", {
                anchorCount: (afterFix.match(/<a\b/gi) || []).length,
                length: afterFix.length
              });
            }
          } catch (err) {
            console.warn("[LEditor][setContent][html][after] failed", err);
          }
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
          if (args === undefined) pluginCommand();
          else pluginCommand(args);
          return;
        }
        const command = commandMap[name];
        if (!command) {
          throw new Error(`LEditor.execCommand: unknown command "${name}"`);
        }
        command(editor, args);
      },
      /** Subscribes to lifecycle events emitted by the editor. */
      on(eventName, fn) {
        emitter.on(eventName, fn as Listener);
      },
      /** Removes a previously registered event listener. */
      off(eventName, fn) {
        emitter.off(eventName, fn as Listener);
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
        return getAutosaveSnapshot(editorInstanceId);
      },
      /** Restores the autosave snapshot into the editor. */
      restoreAutosaveSnapshot() {
        restoreAutosaveSnapshot(handle, editorInstanceId);
      },
      /** Destroys the editor instance and cleans up listeners. */
      destroy() {
        emitter.clear();
        autosaveController?.destroy();
        editor.view.dom.removeEventListener("paste", handlePaste);
        editor.destroy();
      }
    };

    (handle as EditorHandle & { __editor?: Editor }).__editor = editor;

    for (const plugin of plugins) {
      if (!plugin.commands) continue;
      for (const [name, fn] of Object.entries(plugin.commands)) {
        if (pluginCommands.has(name)) {
          throw new Error(`LEditor: command "${name}" already registered by another plugin`);
        }
        pluginCommands.set(name, (args?: any) => fn(handle, args));
      }
    }

    if (config.initialContent) {
      handle.setContent(config.initialContent.value, { format: config.initialContent.format });
    } else {
      handle.setContent("<p>Welcome to LEditor.</p>", { format: "html" });
    }

    // Initialize cited-works store (`references.used.json`) on load so bibliographies work before any edits.
    try {
      const keys = extractCitedKeysFromDoc(editor.state.doc as any);
      void writeCitedWorksKeys(keys);
    } catch {
      // ignore
    }

    for (const plugin of plugins) {
      plugin.onInit?.(handle);
    }

    return handle;
  }
};





