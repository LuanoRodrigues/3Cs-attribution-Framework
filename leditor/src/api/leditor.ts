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
import { paragraphGridExtension, setParagraphGridEditor } from "../editor/paragraph_grid.ts";
import { aiDraftPreviewExtension, setAiDraftPreviewEditor } from "../editor/ai_draft_preview.ts";
import { sourceCheckBadgesExtension, setSourceCheckBadgesEditor } from "../editor/source_check_badges.ts";
import { lexiconHighlightExtension } from "../editor/lexicon_highlight.ts";
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
import "../plugins/sourceChecksFeedbacks.ts";
import "../plugins/lexiconQuick.ts";
import "../extensions/plugin_source_view.ts";
import "../extensions/plugin_print_preview.ts";
import { commandMap } from "./command_map.ts";
import AlignExtension from "../extensions/extension_align.ts";
import IndentExtension from "../extensions/extension_indent.ts";
import SpacingExtension from "../extensions/extension_spacing.ts";
import ParagraphBordersExtension from "../extensions/extension_paragraph_borders.ts";
import FontFamilyMark from "../extensions/extension_font_family.ts";
import FontSizeMark from "../extensions/extension_font_size.ts";
import TextColorMark from "../extensions/extension_text_color.ts";
import HighlightColorMark from "../extensions/extension_highlight_color.ts";
import TextShadowMark from "../extensions/extension_text_shadow.ts";
import TextOutlineMark from "../extensions/extension_text_outline.ts";
import UnderlineMark from "../extensions/extension_underline.ts";
import StrikethroughMark from "../extensions/extension_strikethrough.ts";
import SuperscriptMark from "../extensions/extension_superscript.ts";
import SubscriptMark from "../extensions/extension_subscript.ts";
import CitationLink from "../extensions/extension_citation_link.ts";
import CitationNode from "../extensions/extension_citation.ts";
import AnchorMark from "../extensions/extension_anchor.ts";
import AnchorMarker from "../extensions/extension_anchor_marker.ts";
import FootnoteExtension from "../extensions/extension_footnote.ts";
import { HeadingWithToc } from "../extensions/extension_heading_toc.ts";
import PageBreakExtension from "../extensions/extension_page_break.ts";
import ImageExtension from "../extensions/extension_image.ts";
import MergeTagExtension from "../extensions/extension_merge_tag.ts";
import BookmarkExtension from "../extensions/extension_bookmark.ts";
import CrossReferenceExtension from "../extensions/extension_cross_reference.ts";
import TocExtension from "../extensions/extension_toc.ts";
import CitationSourcesExtension from "../extensions/extension_citation_sources.ts";
import BibliographyExtension from "../extensions/extension_bibliography.ts";
import BibliographyEntryExtension from "../extensions/extension_bibliography_entry.ts";
import WordShortcutsExtension from "../extensions/extension_word_shortcuts.ts";
import SafeDropcursorExtension from "../extensions/extension_dropcursor_safe.ts";
import CommentMark from "../extensions/extension_comment.ts";
import PageLayoutExtension from "../extensions/extension_page_layout.ts";
import ParagraphLayoutExtension from "../extensions/extension_paragraph_layout.ts";
import { PageDocument, PageNode, PagePagination } from "../extensions/extension_page.ts";
import StyleStoreExtension from "../extensions/extension_style_store.ts";
import VirtualSelectionExtension from "../extensions/extension_virtual_selection.ts";
import SelectionDragDropExtension from "../extensions/extension_selection_dnd.ts";
import { extractCitedKeysFromDoc, writeCitedWorksKeys } from "../ui/references/cited_works.ts";
import { debugInfo } from "../utils/debug.ts";
import { refreshNavigationPanel, updateNavigationActive } from "../ui/view_state.ts";
import { refreshStylesPane } from "../ui/styles_pane.ts";
import {
  FootnotesContainerExtension,
  FootnoteBodyExtension,
  FootnoteBodyManagementExtension
} from "../extensions/extension_footnote_body.ts";
import {
  getNextFootnoteId,
  resetFootnoteCounter,
  seedFootnoteCounterFromDoc
} from "../uipagination/footnotes/footnote_id_generator.ts";
import { clearFootnoteRegistry } from "../extensions/extension_footnote.ts";

type ContentFormat = "json" | "html" | "markdown";
type EditorEventName = "change" | "focus" | "blur" | "selectionChange";

export type EditorInitConfig = {
  elementId: string;
  /**
   * Optional direct mount element override.
   * Prefer this in embedded/hosted scenarios to avoid relying on global DOM lookups.
   */
  mountElement?: HTMLElement | null;
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

const PREF_AUTO_LINK = "leditor.autoLink";
const PREF_PASTE_AUTO_CLEAN = "leditor.pasteAutoClean";

const readBoolPref = (key: string, fallback = false): boolean => {
  try {
    const raw = window.localStorage?.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw.toLowerCase() === "true";
  } catch {
    return fallback;
  }
};

const URL_PATTERN = /(https?:\/\/[^\s]+|mailto:[^\s]+)/gi;

const linkifyPlainText = (text: string) => {
  const nodes: Array<{ type: string; text: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }> = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const start = match.index;
    const url = match[0];
    if (start > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, start) });
    }
    nodes.push({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] });
    lastIndex = start + url.length;
  }
  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }
  return nodes.length ? nodes : [{ type: "text", text }];
};

export const LEditor = {
  /**
   * Initializes the editor within the DOM element `config.elementId`.
   */
  init(config: EditorInitConfig): EditorHandle {
    const mountEl = config.mountElement ?? document.getElementById(config.elementId);
    if (!mountEl) {
      throw new Error(`LEditor: elementId "${config.elementId}" not found`);
    }

    const plugins = getPlugins(config.plugins ?? []);
    const pluginExtensions = plugins.flatMap((plugin) => plugin.tiptapExtensions ?? []);

    const starterKitOptions = {} as StarterKitOptions & { image?: boolean };
    starterKitOptions.image = false;
    // Workaround: prosemirror-dropcursor can throw during teardown when its element was already removed
    // (seen as `Cannot read properties of null (reading 'removeChild')` in DropCursorView.setCursor).
    // We can reintroduce a patched dropcursor later via a custom extension.
    starterKitOptions.dropcursor = false;
    starterKitOptions.heading = false;
    starterKitOptions.underline = false;
    starterKitOptions.link = false;
    starterKitOptions.document = false;
    // Debug: silenced noisy ribbon logs.

    const startupAt = performance.now();
    try {
      (window as any).__leditorStartupAt = startupAt;
    } catch {
      // ignore
    }
    const editor = new Editor({
      element: mountEl,
      extensions: [
        PageDocument,
        PageNode,
        PagePagination,
        StarterKit.configure(starterKitOptions),
        HeadingWithToc.configure({ levels: [1, 2, 3, 4, 5, 6] }),
        AlignExtension,
        IndentExtension,
        SpacingExtension,
        ParagraphBordersExtension,
	        directionExtension,
	        visualExtension,
	        paragraphGridExtension,
	        aiDraftPreviewExtension,
          sourceCheckBadgesExtension,
        FontFamilyMark,
        FontSizeMark,
        TextColorMark,
        HighlightColorMark,
        TextShadowMark,
        TextOutlineMark,
        lexiconHighlightExtension,
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
          BibliographyEntryExtension,
		        PageLayoutExtension,
	        ParagraphLayoutExtension,
	        WordShortcutsExtension,
	        SafeDropcursorExtension.configure({ width: 2, color: "black" }),
	        VirtualSelectionExtension,
	        SelectionDragDropExtension,
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
    const appRoot = document.getElementById("leditor-app");
    if (appRoot) {
      appRoot.classList.add("leditor-app--loading");
    }
    const markAppReady = () => {
      if (appRoot) {
        appRoot.classList.remove("leditor-app--loading");
      }
    };
    const waitForFonts = async () => {
      const fontsReady = (document as any)?.fonts?.ready as Promise<void> | undefined;
      if (!fontsReady) return;
      await Promise.race([
        fontsReady,
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1500);
        })
      ]);
    };
    const waitForLayoutSettled = async (timeoutMs = 4500) => {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (reason: string) => {
          if (done) return;
          done = true;
          editor.view?.dom?.removeEventListener("leditor:layout-settled", handler as EventListener);
          if (reason) {
            console.info("[Startup] layout settled", {
              reason,
              ms: Math.round(performance.now() - startupAt)
            });
          }
          resolve();
        };
        const handler = () => finish("event");
        editor.view?.dom?.addEventListener("leditor:layout-settled", handler as EventListener, { once: true });
        window.setTimeout(() => finish("timeout"), timeoutMs);
      });
    };
    const waitForA4Ready = async (timeoutMs = 5000) => {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          observer.disconnect();
          resolve();
        };
        const hasA4 = () => {
          const page = document.querySelector<HTMLElement>(".leditor-page");
          const content = document.querySelector<HTMLElement>(".leditor-page-content");
          if (!page || !content) return false;
          return page.clientHeight > 0 && content.clientHeight > 0;
        };
        const start = performance.now();
        const check = () => {
          if (hasA4()) {
            finish();
            return;
          }
          if (performance.now() - start > timeoutMs) {
            finish();
            return;
          }
          window.requestAnimationFrame(check);
        };
        const observer = new MutationObserver(() => {
          if (!done) {
            check();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        check();
      });
    };
    void (async () => {
      try {
        await waitForFonts();
        console.info("[Startup] fonts ready", {
          ms: Math.round(performance.now() - startupAt)
        });
      } catch {
        // ignore font readiness errors
      }
      try {
        try {
          editor.view.dom.dispatchEvent(new CustomEvent("leditor:pagination-request"));
        } catch {
          // ignore pagination dispatch errors
        }
        await Promise.race([waitForLayoutSettled(), waitForA4Ready()]);
      } catch {
        // ignore A4 readiness errors
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(markAppReady);
      });
    })();
	    const handlePaste = (event: ClipboardEvent) => {
	      const clipboardData = event.clipboardData;
	      if (!clipboardData) {
	        return;
	      }
	      const insertPlainText = (plain: string) => {
	        const autoLink = readBoolPref(PREF_AUTO_LINK, false);
	        if (autoLink) {
	          editor.commands.insertContent(linkifyPlainText(plain));
	          return;
	        }
	        editor.commands.insertContent(plain);
	      };
	      const eAny = event as any;
	      const plainOnly = !!(eAny.getModifierState?.("Shift") ?? eAny.shiftKey);
	      if (plainOnly) {
	        const plain = clipboardData.getData("text/plain");
	        if (plain) {
	          event.preventDefault();
	          insertPlainText(plain);
	          return;
	        }
	      }
	      const html = clipboardData.getData("text/html");
	      if (!html) {
	        return;
	      }
	      const autoClean = readBoolPref(PREF_PASTE_AUTO_CLEAN, false);
	      if (!autoClean) {
	        const plain = clipboardData.getData("text/plain");
	        if (plain) {
	          event.preventDefault();
	          insertPlainText(plain);
	          return;
	        }
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
        insertPlainText(plain);
      }
    };
    editor.view.dom.addEventListener("paste", handlePaste);
	    setSearchEditor(editor);
	    setVisualEditor(editor);
	    setParagraphGridEditor(editor);
	    setAiDraftPreviewEditor(editor);
      setSourceCheckBadgesEditor(editor);

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

    editor.on("update", () => {
      emitter.emit("change");
      refreshNavigationPanel(editor);
      refreshStylesPane(editor);
    });
    editor.on("focus", () => emitter.emit("focus"));
    editor.on("blur", () => emitter.emit("blur"));
    editor.on("selectionUpdate", () => {
      emitter.emit("selectionChange");
      updateNavigationActive(editor);
      refreshStylesPane(editor);
    });

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
          debugInfo("[References][sync] cited keys", { count: keys.length, sample: keys.slice(0, 5) });
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
        // Treat setContent as a full document replacement: reset deterministic footnote id state so ids
        // start from a clean slate and then reseed from the new document.
        try {
          resetFootnoteCounter();
          clearFootnoteRegistry();
        } catch {
          // ignore
        }
        try {
          const g = window as typeof window & {
            __leditorPaginationOrigin?: string;
            __leditorPaginationOriginAt?: number;
            __leditorLastSetContentAt?: number;
            __leditorDisablePaginationUntil?: number;
          };
          const now = performance.now();
          g.__leditorPaginationOrigin = "setContent";
          g.__leditorPaginationOriginAt = now;
          g.__leditorLastSetContentAt = now;
        } catch {
          // ignore
        }
        const queuePostSetContentPagination = () => {
          if (typeof window === "undefined") return;
          const viewDom = (editor?.view?.dom as HTMLElement | null) ?? null;
          if (!viewDom) return;
          const token = performance.now() + 2000;
          try {
            (window as any).__leditorDisablePaginationUntil = token;
          } catch {
            // ignore
          }
          const release = () => {
            try {
              if ((window as any).__leditorDisablePaginationUntil === token) {
                (window as any).__leditorDisablePaginationUntil = 0;
              }
            } catch {
              // ignore
            }
            try {
              viewDom.dispatchEvent(new CustomEvent("leditor:pagination-request", { bubbles: true }));
            } catch {
              // ignore
            }
          };
          const timeoutId = window.setTimeout(release, 1200);
          const fonts = (document as any).fonts;
          if (fonts && typeof fonts.ready?.then === "function") {
            fonts.ready
              .then(() => {
                window.clearTimeout(timeoutId);
                release();
              })
              .catch(() => {
                window.clearTimeout(timeoutId);
                release();
              });
          }
        };
        const ensureFootnoteIds = () => {
          try {
            const footnoteType = editor.state.schema.nodes.footnote;
            if (!footnoteType) return;
            let tr = editor.state.tr;
            let changed = false;
            editor.state.doc.descendants((node, pos) => {
              if (node.type !== footnoteType) return true;
              const rawId =
                typeof (node.attrs as any)?.footnoteId === "string"
                  ? String((node.attrs as any).footnoteId).trim()
                  : "";
              if (rawId) return true;
              const rawKind = typeof (node.attrs as any)?.kind === "string" ? String((node.attrs as any).kind) : "footnote";
              const kind = rawKind === "endnote" ? "endnote" : "footnote";
              const nextId = getNextFootnoteId(kind);
              const nextAttrs = { ...(node.attrs as any), footnoteId: nextId, kind };
              tr = tr.setNodeMarkup(pos, undefined, nextAttrs, node.marks);
              changed = true;
              return true;
            });
            if (!changed) return;
            tr = tr.setMeta("addToHistory", false);
            editor.view.dispatch(tr);
          } catch {
            // ignore
          }
        };
        if (opts.format === "html") {
          if (typeof content !== "string") {
            throw new Error("LEditor.setContent: html requires string content");
          }
          const inputAnchorCount = (content.match(/<a\b/gi) || []).length;

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
            ProseMirrorDOMParser.fromSchema(editor.schema).parse(
              new DOMParser().parseFromString(content, "text/html").body
            );
          } catch {
            // parse diagnostics suppressed
          }

          editor.commands.setContent(content, { parseOptions: { preserveWhitespace: "full" } });
          try {
            seedFootnoteCounterFromDoc(editor.state.doc as any);
            ensureFootnoteIds();
            seedFootnoteCounterFromDoc(editor.state.doc as any);
          } catch {
            // ignore
          }

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
            if (inputAnchorCount > 0 && anchorSeeds.length > 0 && afterAnchorCount === 0) {
              rehydrateLinksByText(anchorSeeds);
            }
          } catch {
            // ignore post-setContent diagnostics
          }
          try {
            seedFootnoteCounterFromDoc(editor.state.doc as any);
            ensureFootnoteIds();
            seedFootnoteCounterFromDoc(editor.state.doc as any);
          } catch {
            // ignore
          }
          queuePostSetContentPagination();
          return;
        }
        if (opts.format === "markdown") {
          if (typeof content !== "string") {
            throw new Error("LEditor.setContent: markdown requires string content");
          }
          const doc = markdownParser.parse(content);
          editor.commands.setContent(doc.toJSON());
          try {
            seedFootnoteCounterFromDoc(editor.state.doc as any);
            ensureFootnoteIds();
            seedFootnoteCounterFromDoc(editor.state.doc as any);
          } catch {
            // ignore
          }
          queuePostSetContentPagination();
          return;
        }
        if (opts.format === "json") {
          const jsonContent = typeof content === "string" ? JSON.parse(content) : content;
          editor.commands.setContent(jsonContent);
          try {
            seedFootnoteCounterFromDoc(editor.state.doc as any);
            ensureFootnoteIds();
            seedFootnoteCounterFromDoc(editor.state.doc as any);
          } catch {
            // ignore
          }
          queuePostSetContentPagination();
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





