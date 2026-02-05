import type { Editor } from "@tiptap/core";
import { DOMParser as PMDOMParser, Fragment } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { getFootnoteRegistry } from "../extensions/extension_footnote.ts";
import { buildFootnoteBodyContent } from "../extensions/extension_footnote_body.ts";
import {
  normalizeCitationId,
  setCitationSources,
  upsertCitationSource
} from "../editor/citation_state.ts";
import type { CitationSource } from "../editor/citation_state.ts";
import { CITATION_STYLES } from "../constants.ts";
import { showAllowedElementsInspector } from "../ui/allowed_elements_inspector.ts";
import { SANITIZE_OPTIONS } from "../plugins/pasteCleaner.ts";
import { openCitationPicker, type CitationPickerResult } from "../ui/references/picker.ts";
import { openSourcesPanel } from "../ui/references/sources_panel.ts";
import { ensureReferencesLibrary, upsertReferenceItems, getReferencesLibrarySync } from "../ui/references/library.ts";
import { getHostContract } from "../ui/host_contract.ts";
import { createSearchPanel } from "../ui/search_panel.ts";
import { createAISettingsPanel, getAiSettings, type AiSettingsPanelController } from "../ui/ai_settings.ts";
import { runLexiconCommand, closeLexiconPopup } from "../ui/lexicon";
import { openVersionHistoryModal } from "../ui/version_history_modal.ts";
import {
  dismissSourceCheckThreadItem,
  getSourceChecksThread,
  isSourceChecksVisible,
  setSourceChecksVisible,
  clearSourceChecksThread
} from "../ui/source_checks_thread.ts";
import { applyClaimRewriteForKey, dismissClaimRewriteForKey, getSourceCheckState } from "../editor/source_check_badges.ts";
import { nextMatch, prevMatch, replaceAll, replaceCurrent, setQuery } from "../editor/search.ts";
import {
  exportBibliographyBibtex,
  exportBibliographyJson,
  getLibraryPath,
  insertBibliographyField,
  writeUsedBibliography,
  readUsedBibliography,
  ensureBibliographyNode
} from "../ui/references/bibliography.ts";
import {
  buildCitationItems,
  resolveNoteKind,
  updateAllCitationsAndBibliography
} from "../csl/update.ts";
import {
  ensureCslStyleAvailable,
  renderCitationsAndBibliographyWithCiteproc,
  renderBibliographyEntriesWithCiteproc
} from "../csl/citeproc.ts";
import { extractCitedKeysFromDoc, writeCitedWorksKeys, acceptKey, extractKeyFromLinkAttrs } from "../ui/references/cited_works.ts";
import type { BibliographyNode as CslBibliographyNode, CitationNode as CslCitationNode, DocCitationMeta } from "../csl/types.ts";
import {
  homeTab,
  insertTab,
  layoutTab,
  referencesTab,
  reviewTab,
  aiTab,
  viewTab
} from "../ui/ribbon_model.ts";
import type { ControlConfig, TabConfig } from "../ui/ribbon_config.ts";
import { resolveRibbonCommandId } from "../ui/ribbon_command_aliases.ts";
import {
  applySnapshotToTransaction,
  consumeRibbonSelection,
  snapshotFromSelection,
  StoredSelection
} from "../utils/selection_snapshot";
import { insertFootnoteAtSelection as insertManagedFootnote } from "../uipagination/footnotes/commands";
import type { EditorHandle } from "./leditor.ts";
import { isDebugLoggingEnabled } from "../utils/debug.ts";
const findListItemDepth = (editor: Editor) => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "listItem") return depth;
  }
  return null;
};

const MIN_INDENT_LEVEL = 0;
const MAX_INDENT_LEVEL = 8;
const clampIndentLevel = (value: number) => Math.max(MIN_INDENT_LEVEL, Math.min(MAX_INDENT_LEVEL, value));

let citationIdCounter = 0;
const generateCitationId = () => `c-${Date.now().toString(36)}-${(citationIdCounter++).toString(36)}`;

let cslUpdateRunId = 0;

const findFootnoteBodyNodeById = (
  doc: ProseMirrorNode,
  footnoteBodyType: any,
  footnoteId: string
): { node: ProseMirrorNode; pos: number } | null => {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (node.type !== footnoteBodyType) return true;
    const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
    if (id === footnoteId) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
};

const isReferencesDebugEnabled = (): boolean => {
  const g = window as typeof window & { __leditorReferencesDebug?: boolean; __leditorDebug?: boolean };
  return Boolean(g.__leditorReferencesDebug || g.__leditorDebug) || isDebugLoggingEnabled();
};

const refsInfo = (message: string, detail?: Record<string, unknown>): void => {
  if (!isReferencesDebugEnabled()) return;
  if (detail) {
    console.info(message, detail);
  } else {
    console.info(message);
  }
};

const isOverlayEditing = (): boolean => {
  const appRoot = document.getElementById("leditor-app");
  if (!appRoot) return false;
  return (
    appRoot.classList.contains("leditor-footnote-editing") ||
    appRoot.classList.contains("leditor-header-footer-editing")
  );
};

const isEditorActiveSurface = (editor: Editor): boolean => {
  const prose = editor?.view?.dom as HTMLElement | null;
  const active = document.activeElement as HTMLElement | null;
  return Boolean(prose && active && prose.contains(active));
};

const isRibbonActiveSurface = (active: HTMLElement | null): boolean => {
  if (!active) return false;
  return Boolean(active.closest?.(".leditor-ribbon"));
};

const shouldAllowProgrammaticFocus = (editor: Editor, allowRibbon = true): boolean => {
  if (isOverlayEditing()) return false;
  if ((window as any).__leditorRibbonCommandActive) return true;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (isEditorActiveSurface(editor)) return true;
  if (allowRibbon && isRibbonActiveSurface(active)) return true;
  return false;
};

const logCaretGate = (label: string, detail: Record<string, unknown>): void => {
  if (!(window as any).__leditorCaretDebug) return;
  try {
    console.info(`[CaretGate] ${label}`, detail);
  } catch {
    // ignore logging failures
  }
};

const shouldAllowSelectionRestore = (editor: Editor, allowRibbon = true): boolean => {
  if (isOverlayEditing()) return false;
  if ((window as any).__leditorRibbonCommandActive) return true;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (isEditorActiveSurface(editor)) return true;
  if (allowRibbon && isRibbonActiveSurface(active)) return true;
  return false;
};

const safeFocusEditor = (editor: Editor, focusTarget?: Parameters<Editor["commands"]["focus"]>[0]): void => {
  if (!editor?.commands?.focus) return;
  if (!shouldAllowProgrammaticFocus(editor, true)) {
    logCaretGate("focus:skip", { reason: "inactive-surface", focusTarget });
    return;
  }
  try {
    editor.commands.focus(focusTarget as any);
  } catch {
    // ignore focus failures
  }
};

const restoreSelectionSafely = (editor: Editor, snapshot?: StoredSelection | null): void => {
  if (!snapshot) return;
  if (!shouldAllowSelectionRestore(editor, true)) {
    logCaretGate("restore:skip", { reason: "inactive-surface" });
    return;
  }
  try {
    const tr = applySnapshotToTransaction(editor.state.tr, snapshot);
    if (
      tr.selection.from !== editor.state.selection.from ||
      tr.selection.to !== editor.state.selection.to
    ) {
      editor.view.dispatch(tr);
    }
  } catch {
    // ignore selection restore failures
  }
};

const chainWithSafeFocus = (
  editor: Editor,
  focusTarget?: Parameters<Editor["commands"]["focus"]>[0]
) => {
  const chain = editor.chain();
  if (shouldAllowProgrammaticFocus(editor, true)) {
    (chain as any).focus(focusTarget);
  }
  return chain;
};

type CitationNodeRecord = CslCitationNode & { pos: number; pmNode: ProseMirrorNode };
type BibliographyNodeRecord = CslBibliographyNode & { pos: number; pmNode: ProseMirrorNode };

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, " ");

const buildBibliographyEntryParagraphs = (
  editor: Editor,
  itemKeys: string[],
  meta: DocCitationMeta
): ProseMirrorNode[] => {
  const schema = editor.schema;
  const entryNode = schema.nodes.bibliography_entry ?? schema.nodes.paragraph;
  if (!entryNode) return [];
  const parser = PMDOMParser.fromSchema(schema);
  const stripOuterWrapper = (html: string): string => {
    const raw = String(html || "").trim();
    if (!raw) return "";
    const host = document.createElement("div");
    host.innerHTML = raw;
    const entry = host.querySelector(".csl-entry") as HTMLElement | null;
    const target = entry ?? host;

    // Citeproc bibliography entries sometimes contain block-level wrappers (divs).
    // Our bibliography_entry node only allows inline content, so flatten blocks to spans.
    const flatten = (root: Element) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      const toReplace: Element[] = [];
      while (walker.nextNode()) {
        const el = walker.currentNode as Element;
        const tag = el.tagName.toLowerCase();
        if (tag === "div" || tag === "p" || tag === "section" || tag === "article") {
          toReplace.push(el);
        }
      }
      toReplace.forEach((el) => {
        const span = document.createElement("span");
        span.className = (el as HTMLElement).className || "";
        // Preserve a little separation between left-margin / right-inline layouts.
        span.innerHTML = el.innerHTML;
        el.replaceWith(span);
      });
    };
    flatten(target);
    return target.innerHTML.trim();
  };
  const safeText = (html: string): string => String(html || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const parseEntry = (html: string): ProseMirrorNode => {
    const inner = stripOuterWrapper(html);
    const container = document.createElement("div");
    container.innerHTML = `<p data-bibliography-entry="true">${inner || safeText(html) || " "}</p>`;
    const parsed = parser.parse(container);
    const first = parsed.firstChild;
    if (first && first.type === entryNode) return first;
    if (first && first.isTextblock) {
      return entryNode.create(null, first.content);
    }
    return entryNode.create(null, [schema.text(safeText(html) || " ")]);
  };

  let entriesHtml: string[] = [];
  try {
    entriesHtml = renderBibliographyEntriesWithCiteproc({ meta, itemKeys });
  } catch (error) {
    console.warn("[References] citeproc bibliography render failed", error);
    entriesHtml = [];
  }
  if (!entriesHtml.length) {
    return [entryNode.create(null, [schema.text("No sources cited.")])];
  }
  return entriesHtml.map((html) => parseEntry(html));
};

const removeTrailingReferencesSection = (editor: Editor, headingText: string): void => {
  const doc = editor.state.doc;
  const heading = editor.schema.nodes.heading;
  if (!heading) return;
  const target = headingText.trim().toLowerCase();
  if (!target) return;

  let lastMatchPos: number | null = null;
  doc.descendants((node, pos) => {
    if (node.type !== heading) return true;
    const level = typeof node.attrs?.level === "number" ? node.attrs.level : null;
    if (level !== 1) return true;
    const text = (node.textContent || "").trim().toLowerCase();
    if (text === target) {
      lastMatchPos = pos;
    }
    return true;
  });
  if (lastMatchPos == null) return;
  const $pos = doc.resolve(lastMatchPos);
  const pageType = editor.schema.nodes.page;
  if (!pageType) return;
  let pageDepth = -1;
  for (let d = $pos.depth; d > 0; d -= 1) {
    if ($pos.node(d).type === pageType) {
      pageDepth = d;
      break;
    }
  }
  if (pageDepth < 0) return;
  const pageStart = $pos.before(pageDepth);
  editor.view.dispatch(editor.state.tr.delete(pageStart, doc.content.size));
};

const findTrailingBibliographyBreakPos = (doc: ProseMirrorNode): number | null => {
  let lastPos: number | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name !== "page_break") return true;
    const kind = typeof node.attrs?.kind === "string" ? node.attrs.kind : "";
    const sectionId = typeof node.attrs?.sectionId === "string" ? node.attrs.sectionId : "";
    if (kind === "page" && sectionId === "bibliography") {
      lastPos = pos;
    }
    return true;
  });
  return lastPos;
};

const getBibliographyLabelFromBreak = (doc: ProseMirrorNode, breakPos: number): string => {
  const heading = doc.type.schema.nodes.heading;
  if (!heading) return "References";
  let label = "References";
  doc.nodesBetween(breakPos, doc.content.size, (node) => {
    if (node.type !== heading) return true;
    const level = typeof node.attrs?.level === "number" ? node.attrs.level : null;
    if (level !== 1) return true;
    const text = (node.textContent || "").trim();
    if (text) label = text;
    return false;
  });
  return label;
};

const removeTrailingReferencesByBreak = (editor: Editor): void => {
  const doc = editor.state.doc;
  const pos = findTrailingBibliographyBreakPos(doc);
  if (pos == null) return;
  editor.view.dispatch(editor.state.tr.delete(pos, doc.content.size));
};

const collectOrderedCitedItemKeys = (editor: Editor, extras?: string[]): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const register = (value: unknown) => {
    const key = typeof value === "string" ? value.trim() : "";
    if (!acceptKey(key) || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  };
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation" && Array.isArray(node.attrs?.items)) {
      (node.attrs.items as Array<{ itemKey: string }>).forEach((item) => register(item?.itemKey));
    }
    if (Array.isArray((node as any).marks)) {
      (node as any).marks.forEach((mark: any) => {
        if (!mark) return;
        const name = mark.type?.name;
        if (name !== "link" && name !== "anchor") return;
        const key = extractKeyFromLinkAttrs(mark.attrs ?? {});
        register(key);
      });
    }
    return true;
  });
  (extras ?? []).forEach((k) => register(k));
  return ordered;
};

const insertReferencesAsNewLastPages = (editor: Editor, headingText: string, itemKeys: string[]): void => {
  const doc = editor.state.doc;
  const pageType = editor.schema.nodes.page;
  const headingType = editor.schema.nodes.heading;
  const pageBreakType = editor.schema.nodes.page_break;
  if (!pageType || !headingType) return;

  const lastPage = doc.child(doc.childCount - 1);
  if (!lastPage || lastPage.type !== pageType) return;
  let lastPagePos = 0;
  for (let i = 0; i < doc.childCount - 1; i += 1) {
    lastPagePos += doc.child(i).nodeSize;
  }
  const endOfLastPageContent = lastPagePos + lastPage.nodeSize - 1;

  const label = headingText.trim() || "References";
  const meta = getDocCitationMeta(doc);
  const entryNodes = buildBibliographyEntryParagraphs(editor, itemKeys, meta);
  const safeEntries = entryNodes.length
    ? entryNodes
    : [editor.schema.nodes.bibliography_entry?.create(null, [editor.schema.text("No sources cited.")]) ?? editor.schema.nodes.paragraph.create(null, [editor.schema.text("No sources cited.")])];

  // Measure how many entries fit per page using the real page-content height/width.
  const measure = (): { pageContentHeight: number; pageContentWidth: number } => {
    const el = document.querySelector<HTMLElement>(".leditor-page-content");
    if (!el) return { pageContentHeight: 0, pageContentWidth: 0 };
    return { pageContentHeight: el.clientHeight, pageContentWidth: el.clientWidth };
  };
  const { pageContentHeight, pageContentWidth } = measure();

  const chunkEntries = (): ProseMirrorNode[][] => {
    if (!pageContentHeight || !pageContentWidth) {
      // Fallback: rough chunking (keeps it stable even if the DOM isn't ready yet).
      const perPage = 28;
      const pages: ProseMirrorNode[][] = [];
      for (let i = 0; i < safeEntries.length; i += perPage) {
        pages.push(safeEntries.slice(i, i + perPage));
      }
      return pages;
    }

    const host = (document.querySelector(".leditor-app") as HTMLElement | null) ?? document.body;
    const scratch = document.createElement("div");
    scratch.className = "ProseMirror leditor-bibliography";
    scratch.style.position = "fixed";
    scratch.style.left = "-10000px";
    scratch.style.top = "0";
    scratch.style.width = `${pageContentWidth}px`;
    scratch.style.visibility = "hidden";
    scratch.style.pointerEvents = "none";
    scratch.style.whiteSpace = "normal";
    scratch.style.boxSizing = "border-box";
    scratch.style.overflow = "visible";
    try {
      const prose = document.querySelector<HTMLElement>(".ProseMirror");
      if (prose) {
        const cs = getComputedStyle(prose);
        scratch.style.fontFamily = cs.fontFamily;
        scratch.style.fontSize = cs.fontSize;
        scratch.style.lineHeight = cs.lineHeight;
        scratch.style.letterSpacing = cs.letterSpacing;
      }
    } catch {
      // ignore
    }
    host.appendChild(scratch);

    const measureBlockHeight = (tag: string, className: string, text: string): number => {
      const el = document.createElement(tag);
      el.className = className;
      el.textContent = text;
      scratch.appendChild(el);
      const h = el.getBoundingClientRect().height;
      el.remove();
      return h;
    };

    const headingHeight = measureBlockHeight("h1", "", label);
    const entriesHeights = safeEntries.map((node) => {
      const text = (node.textContent || "").trim() || " ";
      return measureBlockHeight("p", "leditor-bibliography-entry", text);
    });
    scratch.remove();

    const pages: ProseMirrorNode[][] = [];
    let current: ProseMirrorNode[] = [];
    let used = Math.max(headingHeight, 0);
    const capacity = Math.max(0, pageContentHeight);
    for (let i = 0; i < safeEntries.length; i += 1) {
      // Add a small safety pad to avoid underestimating due to font/mark differences.
      const h = (entriesHeights[i] ?? 0) * 1.12 + 2;
      // Always place at least one entry on a page.
      if (current.length > 0 && used + h > capacity) {
        pages.push(current);
        current = [];
        used = 0;
      }
      current.push(safeEntries[i]);
      used += h;
    }
    if (current.length) pages.push(current);
    return pages.length ? pages : [safeEntries];
  };

  const pages = chunkEntries();
  const headingNode = headingType.create({ level: 1 }, editor.schema.text(label));

  const tr = editor.state.tr;
  // Insert an internal manual break at the end of the current last page so the
  // paginator/joiner never merges References back into existing content.
  if (pageBreakType) {
    tr.insert(endOfLastPageContent, pageBreakType.create({ kind: "page", sectionId: "bibliography" }));
  }
  // Append one or more fresh pages containing the references blocks.
  const insertAt = tr.doc.content.size;
  const pageNodes: ProseMirrorNode[] = pages.map((chunk, idx) => {
    const content = idx === 0 ? [headingNode, ...chunk] : chunk;
    return pageType.create(null, Fragment.from(content));
  });
  tr.insert(insertAt, Fragment.from(pageNodes));
  if (tr.docChanged) editor.view.dispatch(tr);
};

type CitationSelectionInfo = {
  node: ProseMirrorNode;
  pos: number;
};

const findCitationInSelection = (editor: Editor): CitationSelectionInfo | null => {
  const citationNode = editor.schema.nodes.citation;
  if (!citationNode) return null;

  const { selection, doc } = editor.state;
  const { from, to, $from } = selection;

  // Exact node selection
  if (selection instanceof NodeSelection && selection.node.type === citationNode) {
    return { node: selection.node, pos: selection.from };
  }

  // Cursor immediately before or after the citation atom
  const after = $from.nodeAfter;
  if (after?.type === citationNode) {
    return { node: after, pos: from };
  }
  const before = $from.nodeBefore;
  if (before?.type === citationNode) {
    return { node: before, pos: from - before.nodeSize };
  }

  // Fallback: scan a small window around the selection
  let found: CitationSelectionInfo | null = null;
  const searchFrom = Math.max(0, from - 1);
  const searchTo = Math.min(doc.content.size, to + 1);
  doc.nodesBetween(searchFrom, searchTo, (node, pos) => {
    if (node.type === citationNode) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
};

const insertCitationNode = (
  editor: Editor,
  result: CitationPickerResult,
  citationId: string,
  existing: CitationSelectionInfo | null,
  storedSelection?: StoredSelection
) => {
  const citationNode = editor.schema.nodes.citation;
  if (!citationNode) {
    window.alert("Citations are not supported in this schema.");
    return;
  }
  const items =
    result.items && result.items.length
      ? result.items.map((item) => ({
          itemKey: item.itemKey,
          prefix: item.prefix ?? null,
          locator: item.locator ?? null,
          label: item.label ?? null,
          suffix: item.suffix ?? null,
          suppressAuthor: Boolean(item.suppressAuthor),
          authorOnly: Boolean(item.authorOnly)
        }))
      : buildCitationItems(result.itemKeys, {
          prefix: result.options.prefix ?? null,
          locator: result.options.locator ?? null,
          label: result.options.label ?? null,
          suffix: result.options.suffix ?? null,
          suppressAuthor: Boolean(result.options.suppressAuthor),
          authorOnly: Boolean(result.options.authorOnly)
        });
  const attrs = {
    citationId,
    items,
    renderedHtml: ""
  };
  let tr = editor.state.tr;
  if (!existing) {
    tr = applySnapshotToTransaction(tr, storedSelection);
  }
  if (existing) {
    tr = tr.setNodeMarkup(existing.pos, citationNode, attrs);
  } else {
    tr = tr.replaceSelectionWith(citationNode.create(attrs));
  }
  if (!tr.docChanged) {
    return;
  }
  editor.view.dispatch(tr.scrollIntoView());
};

const MAX_FOOTNOTE_FOCUS_ATTEMPTS = 90;

const placeCaretAtEnd = (el: HTMLElement) => {
  try {
    const selection = window.getSelection?.();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch {
    // ignore
  }
};

const tryFocusFootnoteUi = (footnoteId: string, attempt: number): boolean => {
  const entry = document.querySelector<HTMLElement>(`.leditor-footnote-entry[data-footnote-id="${footnoteId}"]`);
  if (entry) {
    const container = entry.closest<HTMLElement>(".leditor-page-footnotes");
    container?.scrollIntoView({ block: "center", behavior: "auto" });
    entry.classList.add("leditor-footnote-entry--active");
    window.setTimeout(() => entry.classList.remove("leditor-footnote-entry--active"), 900);
    const text = entry.querySelector<HTMLElement>(".leditor-footnote-entry-text");
    text?.focus();
    if (text) placeCaretAtEnd(text);
    if ((window as any).__leditorFootnoteDebug) {
      console.info("[Footnote][focus] focused footnote UI", { footnoteId, attempt, hasText: Boolean(text) });
    }
    return Boolean(text);
  }

  const endnoteText = document.querySelector<HTMLElement>(
    `.leditor-endnote-entry[data-footnote-id="${footnoteId}"] .leditor-endnote-entry-text`
  );
  if (endnoteText) {
    const panel = endnoteText.closest<HTMLElement>(".leditor-endnotes-panel");
    panel?.scrollIntoView({ block: "center", behavior: "auto" });
    endnoteText.focus();
    placeCaretAtEnd(endnoteText);
    if ((window as any).__leditorFootnoteDebug) {
      console.info("[Footnote][focus] focused endnote UI", { footnoteId, attempt });
    }
    return true;
  }

  const marker = document.querySelector<HTMLElement>(`.leditor-footnote[data-footnote-id="${footnoteId}"]`);
  if (marker) {
    const kind = (marker.dataset.footnoteKind ?? "footnote").toLowerCase();
    if (kind === "endnote") {
      const panel = document.querySelector<HTMLElement>(".leditor-endnotes-panel");
      panel?.scrollIntoView({ block: "center", behavior: "auto" });
      return false;
    }
    const container = marker.closest<HTMLElement>(".leditor-page")?.querySelector<HTMLElement>(".leditor-page-footnotes");
    container?.scrollIntoView({ block: "center", behavior: "auto" });
  }

  return false;
};

const focusFootnoteById = (id: string, selectionSnapshot?: StoredSelection | null) => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  // In A4 layout mode, a4_layout.ts owns focusing (it waits for the footnote rows to render).
  // Avoid running our own retry loop here, which spams logs and can fight the layout controller.
  if (document.querySelector(".leditor-page-footnotes")) {
    if ((window as any).__leditorFootnoteDebug) {
      console.info("[Footnote][focus] delegated to A4 layout", { id });
    }
    try {
      // Defer until after the ribbon click completes (focus can otherwise be restored to the button).
      window.requestAnimationFrame(() => {
        try {
          window.dispatchEvent(
            new CustomEvent("leditor:footnote-focus", {
              detail: { footnoteId: id, selectionSnapshot: selectionSnapshot ?? null }
            })
          );
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
    return;
  }

  if ((window as any).__leditorFootnoteDebug) {
    console.info("[Footnote][focus] request", { id });
  }
  tryFocusFootnoteUi(id, 0);
};

const pickStableSelectionSnapshot = (
  editor: Editor
): { selectionSnapshot: StoredSelection; source: "ribbon" | "live" } => {
  const current = snapshotFromSelection(editor.state.selection);
  const stored = consumeRibbonSelection();
  if (!stored) {
    return { selectionSnapshot: current, source: "live" };
  }
  // Ribbon clicks can blur the editor and move the live selection to a bogus location (often end-of-doc).
  // Always trust the stored snapshot captured on ribbon pointerdown.
  return { selectionSnapshot: stored, source: "ribbon" };
};

let searchPanelController: ReturnType<typeof createSearchPanel> | null = null;
const ensureSearchPanel = (editorHandle: EditorHandle) => {
  if (!searchPanelController) {
    searchPanelController = createSearchPanel(editorHandle);
  }
  return searchPanelController;
};

let aiSettingsPanel: AiSettingsPanelController | null = null;
const ensureAISettingsPanel = () => {
  if (!aiSettingsPanel) {
    aiSettingsPanel = createAISettingsPanel();
  }
  return aiSettingsPanel;
};

const handleInsertCitationCommand = (editor: Editor) => {
  const existing = findCitationInSelection(editor);
  const preselectKeys = existing
    ? (Array.isArray(existing.node.attrs.items)
        ? (existing.node.attrs.items as Array<{ itemKey: string }>).map((item) => item.itemKey)
        : undefined)
    : undefined;
  const selectionBeforePicker = editor.state.selection;
  const selectionSnapshot =
    consumeRibbonSelection() ?? snapshotFromSelection(selectionBeforePicker);
  const activeCitationId = existing ? (existing.node.attrs.citationId as string | null) : null;
  refsInfo("[References] insert citation", {
    mode: existing ? "edit" : "insert",
    preselectKeys,
    activeCitationId,
    styleId: editor.state.doc.attrs?.citationStyleId
  });
  openCitationPicker({
    mode: existing ? "edit" : "insert",
    preselectItemKeys: preselectKeys,
    activeCitationId,
    styleId: typeof editor.state.doc.attrs?.citationStyleId === "string" ? editor.state.doc.attrs.citationStyleId : null
  })
    .then((result) => {
      if (!result) return;
      restoreSelectionSafely(editor, selectionSnapshot);
      safeFocusEditor(editor);
      if (result.templateId === "bibliography") {
        commandMap.InsertBibliography(editor);
        return;
      }
      if (result.templateId === "update") {
        commandMap.UpdateCitations(editor);
        commandMap.UpdateBibliography(editor);
        return;
      }
      const citationId = (existing?.node.attrs?.citationId as string | null) ?? generateCitationId();
      insertCitationNode(editor, result, citationId, existing, selectionSnapshot);
      const styleId = editor.state.doc.attrs?.citationStyleId;
      const noteKind = typeof styleId === "string" ? resolveNoteKind(styleId) : null;
      void refreshCitationsAndBibliography(editor).then(() => {
        if (noteKind === "footnote" && !existing) {
          focusFootnoteById(`fn-${citationId}`);
        }
      });
    })
    .catch((error) => {
      console.error("[References] picker failed", error);
    });
};

const getDocCitationMeta = (doc: ProseMirrorNode): DocCitationMeta => {
  const styleId = doc.attrs?.citationStyleId;
  if (typeof styleId !== "string" || styleId.trim().length === 0) {
    throw new Error("Document citationStyleId is missing");
  }
  const locale = doc.attrs?.citationLocale;
  if (typeof locale !== "string" || locale.trim().length === 0) {
    throw new Error("Document citationLocale is missing");
  }
  return { styleId, locale };
};

const extractCitationNodes = (doc: ProseMirrorNode): CitationNodeRecord[] => {
  const nodes: CitationNodeRecord[] = [];
  const citationNode = doc.type.schema.nodes.citation;
  if (!citationNode) {
    throw new Error("Citation node is not registered in schema");
  }
  const styleId = typeof doc.attrs?.citationStyleId === "string" ? doc.attrs.citationStyleId : "";
  const noteKind = styleId ? resolveNoteKind(styleId) : null;
  const noteIndexByCitationId = new Map<string, number>();
  if (noteKind) {
    let noteIndex = 0;
    doc.descendants((node) => {
      if (node.type.name === "footnote") {
        const nodeKind = typeof node.attrs?.kind === "string" ? node.attrs.kind : "footnote";
        if (nodeKind !== noteKind) return true;
        const citationId = typeof node.attrs?.citationId === "string" ? node.attrs.citationId : "";
        if (citationId) {
          noteIndex += 1;
          noteIndexByCitationId.set(citationId, noteIndex);
        }
      }
      return true;
    });
  }
  doc.descendants((node, pos) => {
    if (node.type === citationNode) {
      const citationId = node.attrs?.citationId;
      if (typeof citationId !== "string" || citationId.trim().length === 0) {
        throw new Error("Citation node missing citationId");
      }
      const items = node.attrs?.items;
      if (!Array.isArray(items)) {
        throw new Error("Citation node missing items array");
      }
      const noteIndex = noteIndexByCitationId.get(citationId);
      nodes.push({
        type: "citation",
        citationId,
        items,
        renderedHtml: typeof node.attrs?.renderedHtml === "string" ? node.attrs.renderedHtml : "",
        noteIndex,
        pos,
        pmNode: node
      });
    }
    return true;
  });
  return nodes;
};

const findBibliographyNode = (doc: ProseMirrorNode): BibliographyNodeRecord | null => {
  const bibliographyNode = doc.type.schema.nodes.bibliography;
  if (!bibliographyNode) {
    throw new Error("Bibliography node is not registered in schema");
  }
  let found: BibliographyNodeRecord | null = null;
  doc.descendants((node, pos) => {
    if (node.type === bibliographyNode) {
      const bibId = node.attrs?.bibId;
      if (typeof bibId !== "string" || bibId.trim().length === 0) {
        throw new Error("Bibliography node missing bibId");
      }
      found = {
        type: "bibliography",
        bibId,
        renderedHtml: typeof node.attrs?.renderedHtml === "string" ? node.attrs.renderedHtml : "",
        pos,
        pmNode: node
      };
      return false;
    }
    return true;
  });
  return found;
};

const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

type AnchorInfo = {
  text: string;
  href: string;
  dataKey: string;
  dataOrigHref: string;
  itemKey: string;
  dataItemKey: string;
  from: number;
  to: number;
};

const isCitationLikeMark = (mark: any): boolean => {
  const name = String(mark?.type?.name ?? "");
  if (name === "anchor") return true;
  if (name !== "link") return false;
  const attrs = mark?.attrs ?? {};
  const href = typeof attrs?.href === "string" ? attrs.href : "";
  const looksLikeCitation = Boolean(
    attrs?.dataKey ||
      attrs?.itemKey ||
      attrs?.dataItemKey ||
      attrs?.dataDqid ||
      attrs?.dataQuoteId ||
      attrs?.dataQuoteText
  );
  if (looksLikeCitation) return true;
  if (href && /^(dq|cite|citegrp):\/\//i.test(href)) return true;
  return false;
};

const collectCitationAnchors = (editor: Editor): AnchorInfo[] => {
  const anchors: AnchorInfo[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    const text = node.text || "";
    (node.marks || []).forEach((mark: any) => {
      if (!mark || !isCitationLikeMark(mark)) return;
      const attrs = mark.attrs ?? {};
      const dataKey = typeof attrs.dataKey === "string" ? attrs.dataKey.trim() : "";
      const dataOrigHref = typeof attrs.dataOrigHref === "string" ? attrs.dataOrigHref.trim() : "";
      const itemKey = typeof attrs.itemKey === "string" ? attrs.itemKey.trim() : "";
      const dataItemKey = typeof attrs.dataItemKey === "string" ? attrs.dataItemKey.trim() : "";
      const href = typeof attrs.href === "string" ? attrs.href.trim() : "";
      const hasKey = Boolean(extractKeyFromLinkAttrs(attrs));
      if (!hasKey) return;
      anchors.push({ text: text.slice(0, 140), href, dataKey, dataOrigHref, itemKey, dataItemKey, from: 0, to: 0 });
    });
    return true;
  });
  return anchors;
};

const logAllCitationAnchors = (editor: Editor, label: string): void => {
  const anchors = collectCitationAnchors(editor);
  refsInfo("[References][update] anchors", {
    label,
    anchorCount: anchors.length,
    sample: anchors[0] ?? null,
    anchors
  });
};

const citationKeysToUsedStore = async (editor: Editor): Promise<void> => {
  try {
    const keys = extractCitedKeysFromDoc(editor.state.doc as any);
    await writeCitedWorksKeys(keys);
    refsInfo("[References][sync] wrote cited works", { count: keys.length, sample: keys.slice(0, 5) });
  } catch (error) {
    console.warn("[References][sync] cited works write failed", error);
  }
};

const extractDqidFromLinkAttrs = (attrs: any): string => {
  const direct =
    (typeof attrs?.dataDqid === "string" && attrs.dataDqid.trim()) ||
    (typeof attrs?.dataQuoteId === "string" && attrs.dataQuoteId.trim()) ||
    (typeof attrs?.dataQuoteText === "string" && attrs.dataQuoteText.trim()) ||
    "";
  if (direct) return direct;
  const href = typeof attrs?.href === "string" ? attrs.href.trim() : "";
  return href.startsWith("dq://") ? href.slice("dq://".length) : "";
};

const parseLocatorFromRenderedText = (text: string): { locator: string | null; label: string | null } => {
  const raw = (text || "").replace(/\s+/g, " ").trim();
  if (!raw) return { locator: null, label: null };
  const m = /\bpp?\.\s*([0-9]+(?:\s*[-–]\s*[0-9]+)?)\b/i.exec(raw);
  if (!m) return { locator: null, label: null };
  return { locator: m[1].replace(/\s+/g, ""), label: "page" };
};

const convertCitationAnchorsToCitationNodes = (editor: Editor): void => {
  const citationNode = editor.schema.nodes.citation;
  const linkMark = editor.schema.marks.link;
  const anchorMark = editor.schema.marks.anchor;
  if (!citationNode || (!linkMark && !anchorMark)) return;
  const tr = editor.state.tr;
  const ranges: Array<{ from: number; to: number; attrs: Record<string, any> }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const link = (node.marks || []).find((m) => (linkMark && m.type === linkMark) || (anchorMark && m.type === anchorMark));
    if (!link) return true;
    const attrs = link.attrs ?? {};
    const key = extractKeyFromLinkAttrs(attrs);
    if (!key) return true;
    const text = typeof node.text === "string" ? node.text : "";
    const { locator, label } = parseLocatorFromRenderedText(text);
    const dqid = extractDqidFromLinkAttrs(attrs);
    const title = typeof attrs?.title === "string" ? attrs.title : null;
    const from = pos;
    const to = pos + node.nodeSize;
    ranges.push({
      from,
      to,
      attrs: {
        citationId: generateCitationId(),
        items: buildCitationItems([key], { locator, label }),
        renderedHtml: "",
        hidden: false,
        dqid: dqid || null,
        title
      }
    });
    return true;
  });
  // Replace from end -> start to keep positions stable.
  ranges
    .sort((a, b) => b.from - a.from)
    .forEach((range) => {
      const $from = tr.doc.resolve(range.from);
      const $to = tr.doc.resolve(range.to);
      if (!$from.parent.canReplaceWith($from.index(), $to.index(), citationNode)) {
        return;
      }
      const node = citationNode.createAndFill(range.attrs);
      if (!node) return;
      tr.replaceWith(range.from, range.to, node);
    });
  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }
};

const showBibliographyPreview = async (editor: Editor): Promise<void> => {
  try {
    const keys = await readUsedBibliography();
    const library = await ensureReferencesLibrary();
    const lines = keys
      .map((key) => library.itemsByKey[key])
      .filter(Boolean)
      .map((item) => {
        const author = item.author || "";
        const year = item.year ? `(${item.year})` : "";
        const title = item.title || item.itemKey;
        return `${author} ${year} ${title}`.replace(/\s+/g, " ").trim();
      });
    const payload = lines.join("\n");

    const overlay = document.createElement("div");
    overlay.className = "leditor-source-view-overlay";
    overlay.style.display = "flex";
    overlay.style.zIndex = "2200";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Bibliography preview");

    const panel = document.createElement("div");
    panel.className = "leditor-source-view-panel";
    panel.style.maxWidth = "860px";
    panel.style.width = "min(860px, 96vw)";

    const header = document.createElement("div");
    header.className = "leditor-source-view-header";
    const titleEl = document.createElement("div");
    titleEl.className = "leditor-source-view-title";
    titleEl.textContent = `References preview (${keys.length})`;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "leditor-source-view-close";
    close.textContent = "Close";
    close.addEventListener("click", () => overlay.remove());
    header.append(titleEl, close);

    const content = document.createElement("div");
    content.className = "leditor-source-view-content";
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.margin = "0";
    pre.textContent = payload || "(No cited works found.)";
    content.appendChild(pre);

    panel.append(header, content);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  } catch (error) {
    console.warn("[References] preview failed", error);
  }
};

const collectFootnoteNodesByCitationId = (
  doc: ProseMirrorNode,
  kind: "footnote" | "endnote"
): Array<{ citationId: string; pos: number; node: ProseMirrorNode }> => {
  const matches: Array<{ citationId: string; pos: number; node: ProseMirrorNode }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "footnote") {
      const nodeKind = typeof node.attrs?.kind === "string" ? node.attrs.kind : "footnote";
      if (nodeKind !== kind) return true;
      const citationId = typeof node.attrs?.citationId === "string" ? node.attrs.citationId : "";
      if (citationId) {
        matches.push({ citationId, pos, node });
      }
    }
    return true;
  });
  return matches;
};

const applyCitationStyleToDoc = (editor: Editor, styleId: string): void => {
  const nextStyle = styleId.trim().toLowerCase();
  if (!nextStyle) {
    throw new Error("Unsupported citation style: empty");
  }
  const currentAttrs = editor.state.doc.attrs;
  if (!currentAttrs || typeof currentAttrs !== "object") {
    throw new Error("Document attributes are missing");
  }
  refsInfo("[References] citation style change", { from: currentAttrs.citationStyleId, to: nextStyle });
  const tr = editor.state.tr.setDocAttribute("citationStyleId", nextStyle);
  editor.view.dispatch(tr);
};

const setCitationStyleCommand: CommandHandler = (editor, args) => {
  const payloadRaw = typeof args?.id === "string" ? args.id : typeof args?.style === "string" ? args.style : "";
  const payload = payloadRaw.trim().toLowerCase();
  const style = payload || CITATION_STYLE_DEFAULT;
  applyCitationStyleToDoc(editor, style);
  void refreshCitationsAndBibliography(editor).then(() => {
    // If a references section exists at the end, rebuild it so it matches the new style.
    const breakPos = findTrailingBibliographyBreakPos(editor.state.doc);
    if (breakPos == null) return;
    const label = getBibliographyLabelFromBreak(editor.state.doc, breakPos);
    const keys = collectOrderedCitedItemKeys(editor, collectDocumentCitationKeys(editor));
    // Rebuild on next frame so layout metrics used for page splitting are up to date.
    window.requestAnimationFrame(() => {
      removeTrailingReferencesByBreak(editor);
      insertReferencesAsNewLastPages(editor, label, keys);
    });
  });
};

const runCslUpdate = (editor: Editor): void => {
  const citationNode = editor.schema.nodes.citation;
  const bibliographyNode = editor.schema.nodes.bibliography;
  if (!citationNode) {
    throw new Error("Citation node is not registered in schema");
  }
  if (!bibliographyNode) {
    throw new Error("Bibliography node is not registered in schema");
  }
  const styleId = getDocCitationMeta(editor.state.doc).styleId;
  const noteKind = resolveNoteKind(styleId);
  const trPrelude = editor.state.tr;
  const cslDebug = (window as any).__leditorCslDebug;

  if (noteKind) {
    const existingNotes = collectFootnoteNodesByCitationId(editor.state.doc, noteKind);
    const noteMap = new Map(existingNotes.map((entry) => [entry.citationId, entry]));
    const existingIds = new Set(noteMap.keys());
    let inserted = 0;
    let hidden = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type === citationNode) {
        const citationId = typeof node.attrs?.citationId === "string" ? node.attrs.citationId : "";
        if (!citationId) return true;
        if (!node.attrs?.hidden) {
          const mappedPos = trPrelude.mapping.map(pos);
          trPrelude.setNodeMarkup(mappedPos, citationNode, { ...node.attrs, hidden: true });
          hidden += 1;
        }
        if (!existingIds.has(citationId)) {
          const footnoteNode = editor.schema.nodes.footnote;
          if (!footnoteNode) {
            throw new Error("Footnote node is not registered in schema");
          }
          const footnoteId = `fn-${citationId}`;
          const footnote = footnoteNode.create(
            { footnoteId, kind: noteKind, citationId, text: "Citation" },
            []
          );
          const mappedInsertPos = trPrelude.mapping.map(pos + node.nodeSize);
          trPrelude.insert(mappedInsertPos, footnote);
          existingIds.add(citationId);
          inserted += 1;
        }
      }
      return true;
    });
    if (cslDebug) {
      console.log("[CSLDebug] note prelude", {
        styleId,
        noteKind,
        citationsSeen: existingIds.size,
        inserted,
        hidden,
        existingNotes: existingNotes.length
      });
    }
  } else {
    editor.state.doc.descendants((node, pos) => {
      if (node.type === citationNode && node.attrs?.hidden) {
        const mappedPos = trPrelude.mapping.map(pos);
        trPrelude.setNodeMarkup(mappedPos, citationNode, { ...node.attrs, hidden: false });
      }
      if (node.type.name === "footnote" && typeof node.attrs?.citationId === "string") {
        const mappedPos = trPrelude.mapping.map(pos);
        trPrelude.delete(mappedPos, mappedPos + node.nodeSize);
      }
      return true;
    });
  }

  if (trPrelude.docChanged) {
    editor.view.dispatch(trPrelude);
    // Force the A4 overlay to refresh footnote sections immediately. In some environments,
    // Tiptap's "update" event can be missed when transactions are dispatched directly,
    // and the overlay debouncer ignores footnote text changes by design.
    if (noteKind) {
      try {
        window.dispatchEvent(new CustomEvent("leditor:footnotes-refresh"));
      } catch {
        // ignore
      }
      // Pagination/layout can rebuild page shells after this transaction, wiping rendered rows.
      // Fire a second refresh on the next frame to mirror the "InsertFootnote -> focus" timing.
      try {
        window.requestAnimationFrame(() => {
          try {
            window.dispatchEvent(new CustomEvent("leditor:footnotes-refresh"));
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
      // One more delayed refresh: A4 layout attaches its editor update listener after mount,
      // and style changes can race that attachment in some environments.
      try {
        window.setTimeout(() => {
          try {
            window.dispatchEvent(new CustomEvent("leditor:footnotes-refresh"));
          } catch {
            // ignore
          }
        }, 300);
      } catch {
        // ignore
      }
    }
  }

  if (cslDebug && noteKind) {
    // Footnote bodies are managed by a plugin; log after it has a chance to append its transaction.
    window.requestAnimationFrame(() => {
      try {
        const doc = editor.state.doc;
        const footnoteType = doc.type.schema.nodes.footnote;
        const bodyType = doc.type.schema.nodes.footnoteBody;
        const containerType = doc.type.schema.nodes.footnotesContainer;
        let footnotes = 0;
        let bodies = 0;
        let containers = 0;
        doc.descendants((node) => {
          if (footnoteType && node.type === footnoteType) footnotes += 1;
          if (bodyType && node.type === bodyType) bodies += 1;
          if (containerType && node.type === containerType) containers += 1;
          return true;
        });
        console.log("[CSLDebug] footnote state", { footnotes, bodies, containers });
      } catch (e) {
        console.warn("[CSLDebug] footnote state failed", e);
      }
    });
  }

  const runId = ++cslUpdateRunId;
  void (async () => {
    try {
      await ensureCslStyleAvailable(styleId);
    } catch (error) {
      console.error("[References] CSL style load failed; falling back to simplified renderer", error);
      // Continue; simplified renderer does not require CSL XML.
    }
    if (runId !== cslUpdateRunId) return;

    const tr = editor.state.tr;
    const meta = getDocCitationMeta(editor.state.doc);
    const citationNodes = extractCitationNodes(editor.state.doc);
    const additionalItemKeys = collectDocumentCitationKeys(editor);

    if (cslDebug) {
      console.log("[CSLDebug] doc citation mapping", {
        styleId: meta.styleId,
        locale: meta.locale,
        count: citationNodes.length,
        sample: citationNodes.slice(0, 5).map((c) => ({
          citationId: c.citationId,
          pos: c.pos,
          noteIndex: c.noteIndex,
          itemKeys: Array.isArray(c.items) ? c.items.map((it: any) => it?.itemKey).filter(Boolean) : []
        })),
        all:
          cslDebug === "full"
            ? citationNodes.map((c) => ({
                citationId: c.citationId,
                pos: c.pos,
                noteIndex: c.noteIndex,
                itemKeys: Array.isArray(c.items) ? c.items.map((it: any) => it?.itemKey).filter(Boolean) : []
              }))
            : undefined
      });
    }

    let rendered: ReturnType<typeof renderCitationsAndBibliographyWithCiteproc> | null = null;
    try {
      rendered = renderCitationsAndBibliographyWithCiteproc({
        meta,
        citations: citationNodes.map((c) => ({ citationId: c.citationId, items: c.items, noteIndex: c.noteIndex })),
        additionalItemKeys
      });
    } catch (error) {
      console.error("[References] citeproc update failed; falling back to simplified renderer", error);
    }

    if (rendered) {
      citationNodes.forEach((node) => {
        const html = rendered?.citationHtmlById.get(node.citationId) ?? "";
        if (node.pmNode.attrs?.renderedHtml === html) return;
        tr.setNodeMarkup(node.pos, citationNode, { ...node.pmNode.attrs, renderedHtml: html });
      });
      const bibliography = findBibliographyNode(editor.state.doc);
      if (bibliography) {
        const html = rendered.bibliographyHtml;
        if (bibliography.pmNode.attrs?.renderedHtml !== html) {
          tr.setNodeMarkup(bibliography.pos, bibliographyNode, { ...bibliography.pmNode.attrs, renderedHtml: html });
        }
      }
    } else {
      // Backward-compatible fallback if citeproc fails for any reason.
      updateAllCitationsAndBibliography({
        doc: editor.state.doc,
        getDocCitationMeta: (doc) => getDocCitationMeta(doc as ProseMirrorNode),
        extractCitationNodes: (doc) => extractCitationNodes(doc as ProseMirrorNode),
        additionalItemKeys,
        findBibliographyNode: (doc) => findBibliographyNode(doc as ProseMirrorNode),
        setCitationNodeRenderedHtml: (node, html) => {
          const record = node as CitationNodeRecord;
          if (record.pmNode.attrs?.renderedHtml === html) return;
          tr.setNodeMarkup(record.pos, citationNode, { ...record.pmNode.attrs, renderedHtml: html });
        },
        setBibliographyRenderedHtml: (node, html) => {
          const record = node as BibliographyNodeRecord;
          if (record.pmNode.attrs?.renderedHtml === html) return;
          tr.setNodeMarkup(record.pos, bibliographyNode, { ...record.pmNode.attrs, renderedHtml: html });
        }
      });
    }
    if (tr.docChanged) {
      editor.view.dispatch(tr);
    }

    if (noteKind) {
      const renderedById = new Map<string, string>();
      const updatedCitationNodes = extractCitationNodes(editor.state.doc);
      updatedCitationNodes.forEach((node) => renderedById.set(node.citationId, node.renderedHtml));
      const footnoteNodes = collectFootnoteNodesByCitationId(editor.state.doc, noteKind);
      if (footnoteNodes.length) {
        const trNotes = editor.state.tr;
        const schema = editor.state.schema;
        const footnoteType = schema.nodes.footnote;
        const footnoteBodyType = schema.nodes.footnoteBody;
        const contentByFootnoteId = new Map<string, { text: string; kind: string }>();

        // Update inline footnote marker nodes first (descending positions to keep steps stable).
        footnoteNodes
          .map((entry) => {
            const html = renderedById.get(entry.citationId) ?? "";
            const text = stripHtml(html);
            const contentText = text.length > 0 ? text : "Citation";
            const footnoteId =
              typeof entry.node.attrs?.footnoteId === "string" ? String(entry.node.attrs.footnoteId).trim() : "";
            const kind = typeof entry.node.attrs?.kind === "string" ? String(entry.node.attrs.kind) : "footnote";
            if (footnoteId) contentByFootnoteId.set(footnoteId, { text: contentText, kind });
            return { ...entry, footnoteId, contentText };
          })
          .sort((a, b) => b.pos - a.pos)
          .forEach((entry) => {
            if (!footnoteType) return;
            const live = trNotes.doc.nodeAt(entry.pos);
            if (!live || live.type !== footnoteType) return;
            const prevText = typeof (live.attrs as any)?.text === "string" ? String((live.attrs as any).text) : "";
            if (prevText === entry.contentText) return;
            trNotes.setNodeMarkup(entry.pos, live.type, { ...(live.attrs as any), text: entry.contentText }, live.marks);
          });

        // Patch the corresponding footnoteBody nodes (FootnoteBodyManagement does not rebuild on text changes).
        if (footnoteBodyType && contentByFootnoteId.size > 0) {
          const bodyUpdates: Array<{ pos: number; node: ProseMirrorNode; id: string; text: string; kind: string }> = [];
          trNotes.doc.descendants((node, pos) => {
            if (node.type !== footnoteBodyType) return true;
            const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
            if (!id) return true;
            const payload = contentByFootnoteId.get(id);
            if (!payload) return true;
            bodyUpdates.push({ pos, node, id, text: payload.text, kind: payload.kind });
            return true;
          });
          bodyUpdates
            .sort((a, b) => b.pos - a.pos)
            .forEach((entry) => {
              const nextBody = footnoteBodyType.create(
                { ...(entry.node.attrs as any), footnoteId: entry.id, kind: entry.kind },
                buildFootnoteBodyContent(schema, entry.text)
              );
              trNotes.replaceWith(entry.pos, entry.pos + entry.node.nodeSize, nextBody);
            });

          if ((window as any).__leditorCslDebug) {
            const updated = bodyUpdates.length;
            const wanted = contentByFootnoteId.size;
            if (updated < wanted) {
              console.warn("[CSLDebug] footnote bodies missing", { wanted, updated });
            }
          }
        }
        if (trNotes.docChanged) {
          editor.view.dispatch(trNotes);
        }
        // Force the A4 overlay to refresh footnote sections. The overlay debouncer intentionally
        // ignores footnote text, so purely textual updates won't trigger a re-render automatically.
        try {
          window.dispatchEvent(new CustomEvent("leditor:footnotes-refresh"));
        } catch {
          // ignore
        }
        try {
          window.requestAnimationFrame(() => {
            try {
              window.dispatchEvent(new CustomEvent("leditor:footnotes-refresh"));
            } catch {
              // ignore
            }
          });
        } catch {
          // ignore
        }
        try {
          window.setTimeout(() => {
            try {
              window.dispatchEvent(new CustomEvent("leditor:footnotes-refresh"));
            } catch {
              // ignore
            }
          }, 300);
        } catch {
          // ignore
        }
      }
    }
  })();
};

const refreshCitationsAndBibliography = async (editor: Editor): Promise<void> => {
  await ensureReferencesLibrary();
  // Ensure all legacy/manual citation anchors are normalized into real citation nodes.
  // This is required for style changes (numeric, note-based) to fully re-render in-text citations
  // and to populate footnotes/endnotes for note styles.
  try {
    convertCitationAnchorsToCitationNodes(editor);
  } catch (error) {
    console.warn("[References] convert anchors to citations failed", error);
  }
  runCslUpdate(editor);
  await refreshUsedBibliography(editor);
};

const setCitationLocaleCommand: CommandHandler = (editor) => {
  const current = typeof editor.state.doc.attrs?.citationLocale === "string" ? editor.state.doc.attrs.citationLocale : "en-US";
  const raw = window.prompt("Citation locale (e.g. en-US)", current);
  if (raw === null) return;
  const next = raw.trim();
  if (!next) return;
  editor.view.dispatch(editor.state.tr.setDocAttribute("citationLocale", next));
  void refreshCitationsAndBibliography(editor);
};

const normalizeReferenceItemKey = (value: string): string => value.trim().toUpperCase();

const promptAndInsertCiteKey = (editor: Editor): void => {
  const raw = window.prompt("Insert citekey (8-char key, or comma-separated keys)", "");
  if (raw === null) return;
  const keys = raw
    .split(/[,\s]+/)
    .map((k) => normalizeReferenceItemKey(k))
    .filter((k) => k.length > 0);
  if (!keys.length) return;
  const citationNode = editor.schema.nodes.citation;
  if (!citationNode) {
    window.alert("Citation node is not available.");
    return;
  }
  const citationId = generateCitationId();
  const attrs = {
    citationId,
    items: buildCitationItems(keys, {}),
    renderedHtml: "",
    hidden: false
  };
  editor.view.dispatch(editor.state.tr.replaceSelectionWith(citationNode.create(attrs)).scrollIntoView());
  void refreshCitationsAndBibliography(editor);
};

const importReferencesJsonLike = (raw: any): Array<{ itemKey: string; title?: string; author?: string; year?: string; url?: string; note?: string; dqid?: string }> => {
  const itemsRaw = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return itemsRaw
    .map((it: any) => ({
      itemKey: String(it.itemKey ?? it.id ?? it.item_key ?? "").trim(),
      title: typeof it.title === "string" ? it.title : undefined,
      author: typeof it.author === "string" ? it.author : undefined,
      year: typeof it.year === "string" ? it.year : undefined,
      url: typeof it.url === "string" ? it.url : undefined,
      note: typeof it.note === "string" ? it.note : undefined,
      dqid: typeof it.dqid === "string" ? it.dqid : undefined
    }))
    .filter((it: any) => it.itemKey);
};

const parseBibtex = (text: string) => {
  const items: any[] = [];
  const entryRegex = /@\\w+\\s*\\{\\s*([^,\\s]+)\\s*,([\\s\\S]*?)\\n\\s*\\}\\s*/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(text))) {
    const itemKey = String(match[1] || "").trim();
    const body = match[2] || "";
    const field = (name: string): string => {
      const re = new RegExp(`${name}\\s*=\\s*(\\{([^}]*)\\}|\\\"([^\\\"]*)\\\")`, "i");
      const m = re.exec(body);
      return (m?.[2] || m?.[3] || "").trim();
    };
    items.push({
      itemKey,
      title: field("title") || undefined,
      author: field("author") || undefined,
      year: field("year") || undefined,
      url: field("url") || undefined,
      note: undefined
    });
  }
  return items.filter((it) => it.itemKey);
};

const parseRis = (text: string) => {
  const items: any[] = [];
  const lines = text.split(/\\r?\\n/);
  let current: any | null = null;
  const flush = () => {
    if (current && current.itemKey) items.push(current);
    current = null;
  };
  for (const line of lines) {
    const m = /^([A-Z0-9]{2})\\s*-\\s*(.*)$/.exec(line);
    if (!m) continue;
    const tag = m[1];
    const val = (m[2] || "").trim();
    if (tag === "TY") {
      flush();
      current = {};
      continue;
    }
    if (!current) continue;
    if (tag === "ER") {
      flush();
      continue;
    }
    if (tag === "ID" && !current.itemKey) current.itemKey = val;
    if (tag === "TI" && !current.title) current.title = val;
    if (tag === "T1" && !current.title) current.title = val;
    if (tag === "AU") current.author = current.author ? `${current.author}; ${val}` : val;
    if (tag === "PY" && !current.year) current.year = val.slice(0, 4);
    if (tag === "Y1" && !current.year) current.year = val.slice(0, 4);
    if (tag === "UR" && !current.url) current.url = val;
    if (tag === "DO" && !current.note) current.note = `DOI: ${val}`;
  }
  flush();
  return items.filter((it) => it.itemKey);
};

const applyStyleById = (editor: Editor, styleId: string): void => {
  const id = styleId.toLowerCase();
  if (id.includes("heading1")) {
    chainWithSafeFocus(editor).toggleHeading({ level: 1 }).run();
    return;
  }
  if (id.includes("heading2")) {
    chainWithSafeFocus(editor).toggleHeading({ level: 2 }).run();
    return;
  }
  if (id.includes("heading3")) {
    chainWithSafeFocus(editor).toggleHeading({ level: 3 }).run();
    return;
  }
  if (id.includes("heading4")) {
    chainWithSafeFocus(editor).toggleHeading({ level: 4 }).run();
    return;
  }
  if (id.includes("heading5")) {
    chainWithSafeFocus(editor).toggleHeading({ level: 5 }).run();
    return;
  }
  if (id.includes("heading6")) {
    chainWithSafeFocus(editor).toggleHeading({ level: 6 }).run();
    return;
  }
  if (id.includes("title")) {
    chainWithSafeFocus(editor).toggleHeading({ level: 1 }).run();
    return;
  }
  if (id.includes("subtitle")) {
    chainWithSafeFocus(editor).toggleHeading({ level: 2 }).run();
    return;
  }
  if (id.includes("quote")) {
    chainWithSafeFocus(editor).toggleBlockquote().run();
    return;
  }
  if (id.includes("code")) {
    chainWithSafeFocus(editor).toggleCodeBlock().run();
    return;
  }
  chainWithSafeFocus(editor).setParagraph().run();
};

const parseToCm = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return fallback;
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return fallback;
  if (trimmed.endsWith("cm")) return numeric;
  if (trimmed.endsWith("mm")) return numeric / 10;
  if (trimmed.endsWith("in")) return numeric * 2.54;
  return numeric;
};

const getTiptap = (editor: any): any => {
  if (editor?.commands) return editor;
  if (editor?.getEditor) return editor.getEditor();
  return null;
};

const getBlockAtSelection = (editor: Editor) => {
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
type CaseMode = "sentence" | "lowercase" | "uppercase" | "title";
type CaseTransformer = (value: string) => string;
type InsertImageResult = {
  success: boolean;
  url?: string;
  error?: string;
};

const CASE_TRANSFORMERS: Record<CaseMode, CaseTransformer> = {
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

const applyCaseTransform = (editor: Editor, transform: CaseTransformer): boolean => {
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

const getCaseTransformer = (mode?: string): CaseTransformer => {
  if (mode && mode in CASE_TRANSFORMERS) {
    return CASE_TRANSFORMERS[mode as CaseMode];
  }
  return CASE_TRANSFORMERS.sentence;
};

const execClipboardCommand = (command: "cut" | "copy" | "paste"): void => {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return;
  }
  try {
    document.execCommand(command);
  } catch {
    // swallow
  }
};

const readClipboardText = (): Promise<string> => {
  if (typeof navigator === "undefined" || typeof navigator.clipboard === "undefined") {
    return Promise.resolve("");
  }
  return navigator.clipboard
    .readText()
    .catch(() => "");
};

const requestImageInsert = (editor: Editor): void => {
  const handler = window.leditorHost?.insertImage;
  if (!handler) {
    return;
  }
  void handler()
    .then((result: InsertImageResult | undefined) => {
      if (!result?.success || !result.url) {
        console.error("InsertImage failed", result?.error);
        return;
      }
      chainWithSafeFocus(editor).insertContent({ type: "image", attrs: { src: result.url } }).run();
    })
    .catch((error) => {
      console.error("InsertImage failed", error);
    });
};


const slugifyBookmarkLabel = (value: string): string => {
  const normalized = value.toLowerCase().trim();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "bookmark";
};

type BookmarkEntry = {
  id: string;
  label: string;
};

const collectBookmarks = (editor: Editor): BookmarkEntry[] => {
  const entries: BookmarkEntry[] = [];
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

const ensureUniqueBookmarkId = (base: string, taken: Set<string>): string => {
  const normalized = base.trim() || "bookmark";
  let candidate = normalized;
  let suffix = 1;
  while (taken.has(candidate)) {
    candidate = `${normalized}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

import { notifySearchUndo } from "../editor/search.ts";
import { notifyAutosaveUndoRedo } from "../editor/autosave.ts";
import { toggleVisualBlocks, toggleVisualChars } from "../editor/visual.ts";
import { applyBlockDirection, notifyDirectionUndo } from "../editor/direction.ts";
import { toggleFullscreen } from "../ui/fullscreen.ts";
import {
  isPageBoundariesVisible,
  isPageBreakMarksVisible,
  isRulerVisible,
  isGridlinesVisible,
  setPageBoundariesVisible,
  setPageBreakMarksVisible,
  setPaginationMode,
  setReadMode,
  setRulerVisible,
  setScrollDirection,
  setGridlinesVisible,
  toggleNavigationPanel,
  toggleNavigationDock
} from "../ui/view_state.ts";
import { getLayoutController } from "../ui/layout_context.ts";
import { getTemplateById } from "../templates/index.ts";
import { toggleStylesPane } from "../ui/styles_pane.ts";
import { openStyleMiniApp } from "../ui/style_mini_app.ts";
import { setPageMargins, setPageOrientation, setPageSize, setSectionColumns } from "../ui/layout_settings.ts";
import {
  applyDocumentLayoutTokens,
  setFooterDistance,
  setGutter,
  setHeaderDistance,
  setMarginsCustom,
  setOrientation as setDocOrientation,
  setPageSizePreset,
  setMarginsPreset
} from "../ui/pagination/index.ts";
import type { BreakKind } from "../extensions/extension_page_break.ts";


export type CommandHandler = (editor: Editor, args?: any) => void;

type TocEntry = {
  text: string;
  level: number;
  pos: number;
};

const CITATION_STYLE_DEFAULT = CITATION_STYLES[0];

export const readCitationStyle = (editor?: Editor): string => {
  const styleId = editor?.state?.doc?.attrs?.citationStyleId;
  if (typeof styleId === "string" && styleId.trim().length > 0) {
    return styleId;
  }
  return CITATION_STYLE_DEFAULT;
};

const collectHeadingEntries = (editor: Editor): TocEntry[] => {
  const entries: TocEntry[] = [];
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

const collectTocNodeInfos = (doc: ProseMirrorNode): { pos: number; size: number }[] => {
  const infos: { pos: number; size: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "toc") {
      infos.push({ pos, size: node.nodeSize });
    }
    return true;
  });
  return infos;
};

const deleteTocNodesFromTransaction = (tr: Transaction, doc: ProseMirrorNode): boolean => {
  const infos = collectTocNodeInfos(doc);
  if (infos.length === 0) {
    return false;
  }
  const sorted = [...infos].sort((a, b) => b.pos - a.pos);
  sorted.forEach((entry) => {
    tr.delete(entry.pos, entry.pos + entry.size);
  });
  return true;
};

const insertTocNode = (editor: Editor, entries: TocEntry[], options?: { style?: string }): void => {
  if (entries.length === 0) {
    window.alert("No headings found to populate a table of contents.");
    return;
  }
  const schema = editor.schema;
  const tocNode = schema.nodes.toc;
  if (!tocNode) {
    window.alert("Table of Contents is not available in the current schema.");
    return;
  }
  const styleId = typeof options?.style === "string" && options.style.length > 0 ? options.style : "auto1";
  const pageBreakNode = schema.nodes.page_break;
  const paragraphNode = schema.nodes.paragraph;
  const tr = editor.state.tr;
  deleteTocNodesFromTransaction(tr, editor.state.doc);
  const nodes: ProseMirrorNode[] = [
    tocNode.create({ entries, style: styleId }),
    ...(pageBreakNode ? [pageBreakNode.create({ kind: "page" })] : []),
    ...(paragraphNode ? [paragraphNode.create()] : [])
  ];
  tr.insert(0, Fragment.fromArray(nodes));
  editor.view.dispatch(tr);
};

const updateTocNodes = (editor: Editor, entries: TocEntry[]): boolean => {
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

const removeTocNodes = (editor: Editor, options?: { silent?: boolean }): boolean => {
  const tr = editor.state.tr;
  const removed = deleteTocNodesFromTransaction(tr, editor.state.doc);
  if (!removed) {
    if (!options?.silent) {
      window.alert("No table of contents found to remove.");
    }
    return false;
  }
  editor.view.dispatch(tr);
  return true;
};

const collectDocumentCitationKeys = (editor: Editor): string[] => {
  const keys = new Set<string>();
  const push = (value: unknown) => {
    const key = typeof value === "string" ? value.trim() : "";
    if (acceptKey(key)) keys.add(key);
  };
  const pushGroup = (value: unknown) => {
    const raw = typeof value === "string" ? value : "";
    raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => push(part));
  };
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation" && Array.isArray(node.attrs?.items)) {
      (node.attrs.items as Array<{ itemKey: string }>).forEach((item) => {
        if (item && typeof item.itemKey === "string" && acceptKey(item.itemKey)) {
          keys.add(item.itemKey.trim());
        }
      });
    }
    // Also include citation anchors (link/anchor marks) that carry item keys or dqids.
    if (Array.isArray((node as any).marks)) {
      (node as any).marks.forEach((mark: any) => {
        if (!mark) return;
        const name = mark.type?.name;
        if (name !== "link" && name !== "anchor") return;
        const attrs = mark.attrs ?? {};
        const key = extractKeyFromLinkAttrs(attrs);
        push(key);
        push(attrs.dataOrigHref);
        const href = typeof attrs.href === "string" ? attrs.href : "";
        if (href.startsWith("citegrp://")) {
          pushGroup(href.replace(/^citegrp:\/\//, ""));
        } else if (href.startsWith("cite://")) {
          push(href.replace(/^cite:\/\//, ""));
        }
      });
    }
    return true;
  });
  return Array.from(keys);
};

const collectDocumentDirectQuoteIds = (editor: Editor): string[] => {
  const ids = new Set<string>();
  const push = (value: unknown) => {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw) ids.add(raw);
  };
  editor.state.doc.descendants((node) => {
    if (Array.isArray((node as any).marks)) {
      (node as any).marks.forEach((mark: any) => {
        if (!mark || mark.type?.name !== "link") return;
        const attrs = mark.attrs ?? {};
        push(attrs.dataDqid);
        push(attrs.dataQuoteId);
        const href = typeof attrs.href === "string" ? attrs.href.trim() : "";
        if (href.startsWith("dq://") || href.startsWith("dq:")) {
          const cleaned = href.replace(/^dq:\/*/, "").split(/[?#]/)[0].trim().toLowerCase();
          push(cleaned);
        }
      });
    }
    return true;
  });
  return Array.from(ids);
};

const logFirstParagraphAnchors = (editor: Editor): void => {
  try {
    const anchors: Array<Record<string, string>> = [];
    let paragraphText = "";
    let found = false;
    editor.state.doc.descendants((node) => {
      if (found) return false;
      if (node.type.name !== "paragraph") return true;
      found = true;
      paragraphText = node.textContent || "";
      node.descendants((child: any) => {
        (child?.marks || []).forEach((mark: any) => {
          if (!mark || mark.type?.name !== "link") return;
          const attrs = mark.attrs ?? {};
          anchors.push({
            href: typeof attrs.href === "string" ? attrs.href : "",
            dataKey: typeof attrs.dataKey === "string" ? attrs.dataKey : "",
            dataOrigHref: typeof attrs.dataOrigHref === "string" ? attrs.dataOrigHref : "",
            itemKey: typeof attrs.itemKey === "string" ? attrs.itemKey : "",
            dataItemKey: typeof attrs.dataItemKey === "string" ? attrs.dataItemKey : ""
          });
        });
        return true;
      });
      return false;
    });
    refsInfo("[References][debug] first paragraph", {
      text: paragraphText.slice(0, 220),
      anchorCount: anchors.length,
      anchors: anchors.slice(0, 20)
    });
  } catch (error) {
    console.warn("[References][debug] paragraph anchor dump failed", error);
  }
};

const refreshUsedBibliography = async (editor: Editor) => {
  const keys = collectDocumentCitationKeys(editor);
  logFirstParagraphAnchors(editor);
  await writeUsedBibliography(keys);
  try {
    const contract = getHostContract();
    const lookupPath = (contract?.inputs?.directQuoteJsonPath || "").trim();
    if (lookupPath && window.leditorHost?.prefetchDirectQuotes) {
      const dqids = collectDocumentDirectQuoteIds(editor);
      if (dqids.length) {
        void window.leditorHost.prefetchDirectQuotes({ lookupPath, dqids });
      }
    }
  } catch {
    // ignore
  }
};

const ensureBibliographyStore = (): void => {
  void ensureReferencesLibrary()
    .then((library) => {
      refsInfo("[References] bibliography library persisted", {
        path: getLibraryPath(getHostContract()),
        total: Object.keys(library.itemsByKey).length
      });
    })
    .catch((error) => {
      console.warn("[References] bibliography library persistence failed", error);
    });
};

const hasCitationNodes = (editor: Editor): boolean => {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") {
      found = true;
      return false;
    }
    return true;
  });
  return found;
};

const hasBibliographyNode = (editor: Editor): boolean => {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "bibliography") {
      found = true;
      return false;
    }
    return true;
  });
  return found;
};

const insertBreakNode = (editor: Editor, kind: BreakKind): void => {
  const breakNode = editor.schema.nodes.page_break;
  if (!breakNode) {
    throw new Error("Page break node is not available on the schema");
  }
  chainWithSafeFocus(editor).insertContent({ type: "page_break", attrs: { kind } }).run();
};

const collectFootnoteTargets = (editor: Editor) => {
  const results: Array<{ pos: number; id?: string }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "footnote") {
      const id = typeof node.attrs?.footnoteId === "string" ? node.attrs.footnoteId : undefined;
      results.push({ pos, id });
    }
    return true;
  });
  return results;
};

const navigateFootnote = (editor: Editor, direction: "next" | "previous"): void => {
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
  } else {
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
  const selection = TextSelection.create(editor.state.doc, target.pos);
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  if (target.id) {
    getFootnoteRegistry().get(target.id)?.open();
  }
};


﻿const SPELLING_DICTIONARY = new Set([
  "the", "and", "is", "in", "it", "of", "to", "a", "editor", "document", "review", "word", "count", "text", "paragraph", "comment", "proof", "sentence", "page"
]);

const THESAURUS: Record<string, string[]> = {
  important: ["significant", "notable", "critical"],
  review: ["evaluate", "assess", "examine"],
  document: ["manuscript", "file", "text"],
  word: ["term", "lexeme", "expression"],
  change: ["modify", "adjust", "revise"]
};

const getEditorPlainText = (editor: Editor): string => editor.state.doc.textContent ?? "";

const getWordStatistics = (editor: Editor) => {
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

const getMisspelledWords = (editor: Editor): string[] => {
  const text = getEditorPlainText(editor).toLowerCase();
  const words = text.match(/\b[\p{L}'-]+\b/gu) || [];
  const suggestions = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (word && !SPELLING_DICTIONARY.has(word) && !seen.has(word)) {
      suggestions.push(word);
      seen.add(word);
      if (suggestions.length >= 12) break;
    }
  }
  return suggestions;
};

const getSynonyms = (word: string): string[] => {
  return THESAURUS[word.toLowerCase()] ?? [];
};

let currentUtterance: SpeechSynthesisUtterance | null = null;

const toggleReadAloud = (editor: Editor) => {
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

const MARKUP_MODES = ["All", "None", "Original"] as const;
const MARKUP_STORAGE_KEY = "leditor:markup-mode";
const normalizeMarkupMode = (value?: string | null) => {
  if (value && MARKUP_MODES.includes(value as (typeof MARKUP_MODES)[number])) {
    return value as (typeof MARKUP_MODES)[number];
  }
  return MARKUP_MODES[0];
};

const setMarkupMode = (value?: string) => {
  const mode = normalizeMarkupMode(value);
  try {
    window.localStorage?.setItem(MARKUP_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
  return mode;
};

const getMarkupMode = () => {
  try {
    const stored = window.localStorage?.getItem(MARKUP_STORAGE_KEY);
    return normalizeMarkupMode(stored);
  } catch {
    return MARKUP_MODES[0];
  }
};

const showPlaceholderDialog = (title: string, detail?: string): void => {
  const message = detail ? `${title}\n${detail}` : `${title} (not implemented yet).`;
  window.alert(message);
};

const getPageElements = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(".leditor-page"));

const clampIndex = (value: number, max: number): number => Math.max(0, Math.min(max, value));

const resolveActivePageIndex = (): number | null => {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  if (!anchor) return null;
  const element =
    anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
  if (!element) return null;
  const page = element.closest<HTMLElement>(".leditor-page");
  if (!page) return null;
  const raw = page.dataset.pageIndex;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const scrollToPageIndex = (index: number): void => {
  const pages = getPageElements();
  if (!pages.length) return;
  const target = pages[clampIndex(index, pages.length - 1)];
  target.scrollIntoView({ behavior: "smooth", block: "start" });
};

const stepPage = (dir: "prev" | "next"): void => {
  const pages = getPageElements();
  if (!pages.length) return;
  const current = resolveActivePageIndex() ?? 0;
  const delta = dir === "next" ? 1 : -1;
  const target = clampIndex(current + delta, pages.length - 1);
  scrollToPageIndex(target);
};

const setPaginationModeAndView = (mode: "paged" | "continuous") => {
  setPaginationMode(mode);
  const layout = getLayoutController();
  if (!layout) return;
  if (mode === "paged") {
    layout.setViewMode("single");
  } else {
    layout.setViewMode("fit-width");
  }
};

const setZoomFitWholePage = () => {
  const layout = getLayoutController();
  if (!layout) return;
  const canvas = document.querySelector<HTMLElement>(".leditor-a4-canvas");
  const page = canvas?.querySelector<HTMLElement>(".leditor-page");
  if (!canvas || !page) return;
  const canvasRect = canvas.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0 || pageRect.width <= 0 || pageRect.height <= 0) {
    return;
  }
  const scaleX = canvasRect.width / pageRect.width;
  const scaleY = canvasRect.height / pageRect.height;
  const nextZoom = layout.getZoom() * Math.min(scaleX, scaleY);
  layout.setZoom(nextZoom);
};


export const commandMap: Record<string, CommandHandler> = {
  New() {
    const handler = commandMap.NewDocument;
    handler?.(undefined as any, undefined as any);
  },
  Open() {
    const handler = commandMap.OpenDocument;
    handler?.(undefined as any, undefined as any);
  },
  VersionHistory() {
    const editorHandle = (window as typeof window & { leditor?: EditorHandle }).leditor;
    if (!editorHandle) {
      showPlaceholderDialog("Version History", "Editor handle not available.");
      return;
    }
    void openVersionHistoryModal(editorHandle);
  },
  Save() {
    const exporter = (window as any).__leditorAutoExportLEDOC as undefined | ((opts?: any) => Promise<any>);
    if (typeof exporter !== "function") {
      showPlaceholderDialog("Save document", "ExportLEDOC handler is unavailable.");
      return;
    }
    const last = String(window.localStorage?.getItem("leditor.lastLedocPath") || "").trim();
    if (!last) {
      const handler = commandMap.SaveAs;
      handler?.(undefined as any, undefined as any);
      return;
    }
    void exporter({ prompt: false, targetPath: last, suggestedPath: last })
      .then((result: any) => {
        const nextPath = typeof result?.filePath === "string" ? result.filePath : "";
        if (!nextPath) return;
        try {
          window.localStorage?.setItem("leditor.lastLedocPath", nextPath);
        } catch {
          // ignore
        }
        try {
          const host = (window as any).leditorHost as any;
          host?.createLedocVersion?.({
            ledocPath: nextPath,
            reason: "save",
            payload: result?.payload,
            throttleMs: 0,
            force: false
          });
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // ignore
      });
  },
  SaveAs() {
    const exporter = (window as any).__leditorAutoExportLEDOC as undefined | ((opts?: any) => Promise<any>);
    if (typeof exporter !== "function") {
      showPlaceholderDialog("Save As", "ExportLEDOC handler is unavailable.");
      return;
    }
    void exporter({ prompt: true }).then((result: any) => {
      const nextPath = typeof result?.filePath === "string" ? result.filePath : "";
      if (!nextPath) return;
      try {
        window.localStorage?.setItem("leditor.lastLedocPath", nextPath);
      } catch {
        // ignore
      }
      try {
        const host = (window as any).leditorHost as any;
        host?.createLedocVersion?.({
          ledocPath: nextPath,
          reason: "save",
          payload: result?.payload,
          throttleMs: 0,
          force: false
        });
      } catch {
        // ignore
      }
    }).catch(() => {
      // ignore
    });
  },
  NewDocument() {
    const editorHandle = (window as typeof window & { leditor?: EditorHandle }).leditor;
    if (!editorHandle) {
      showPlaceholderDialog("New document", "Editor handle not available.");
      return;
    }

    const shouldDiscard =
      typeof window.confirm === "function"
        ? window.confirm("Create a new document? Unsaved changes will be lost.")
        : true;
    if (!shouldDiscard) return;

    // Ensure we are not stuck in overlay edit modes (which disable ProseMirror editing).
    try {
      const layout = getLayoutController();
      layout?.exitFootnoteMode?.();
      layout?.exitHeaderFooterMode?.();
    } catch {
      // ignore
    }

    // Prevent coder_state autosave from overwriting the previously loaded document.
    try {
      (globalThis as typeof globalThis & { __leditorAllowCoderAutosave?: boolean }).__leditorAllowCoderAutosave = false;
    } catch {
      // ignore
    }
    // Disable LEDOC autosave for the new blank document.
    try {
      (globalThis as typeof globalThis & { __leditorAllowLedocAutosave?: boolean }).__leditorAllowLedocAutosave = false;
    } catch {
      // ignore
    }

    // Minimal valid PageDocument: doc -> page -> paragraph
    const blankDoc = {
      type: "doc",
      content: [
        {
          type: "page",
          content: [{ type: "paragraph" }]
        }
      ]
    };

    try {
      editorHandle.setContent(blankDoc, { format: "json" });
      editorHandle.focus();
    } catch (error) {
      console.warn("[NewDocument] failed to reset content", error);
      showPlaceholderDialog("New document", "Failed to create a new document.");
      return;
    }

    // Create a new on-disk file immediately (so File > New actually creates a file).
    const exporter = (window as any).__leditorAutoExportLEDOC as undefined | ((opts?: any) => Promise<any>);
    if (typeof exporter === "function") {
      void exporter({
        prompt: true,
        suggestedPath: `Untitled-${Date.now()}.ledoc`
      }).catch(() => {
        // ignore (user may cancel save dialog)
      });
    }
  },

  OpenDocument() {
    const importer = (window as any).__leditorAutoImportLEDOC as undefined | ((opts?: any) => Promise<any>);
    if (typeof importer !== "function") {
      showPlaceholderDialog("Open document", "ImportLEDOC handler is unavailable.");
      return;
    }
    void importer({ prompt: true }).catch(() => {
      // ignore (user may cancel open dialog)
    });
  },

  Bold(editor) {
    chainWithSafeFocus(editor).toggleBold().run();
  },
  Italic(editor) {
    chainWithSafeFocus(editor).toggleItalic().run();
  },
  Underline(editor) {
    chainWithSafeFocus(editor).toggleMark("underline").run();
  },
  Strikethrough(editor) {
    chainWithSafeFocus(editor).toggleMark("strikethrough").run();
  },
  Superscript(editor) {
    chainWithSafeFocus(editor).toggleMark("superscript").run();
  },
  Subscript(editor) {
    chainWithSafeFocus(editor).toggleMark("subscript").run();
  },
  Undo(editor) {
    chainWithSafeFocus(editor).undo().run();
    notifySearchUndo();
    notifyAutosaveUndoRedo();
    notifyDirectionUndo();
  },
  Redo(editor) {
    chainWithSafeFocus(editor).redo().run();
    notifyAutosaveUndoRedo();
  },
  Cut(editor) {
    safeFocusEditor(editor);
    execClipboardCommand("cut");
  },
  Copy(editor) {
    safeFocusEditor(editor);
    execClipboardCommand("copy");
  },
  Paste(editor) {
    safeFocusEditor(editor);
    void readClipboardText().then((text) => {
      if (text) {
        chainWithSafeFocus(editor).insertContent(text).run();
        return;
      }
      execClipboardCommand("paste");
    });
  },
  PastePlain(editor) {
    safeFocusEditor(editor);
    void readClipboardText().then((text) => {
      if (!text) {
        return;
      }
      chainWithSafeFocus(editor).insertContent(text).run();
    });
  },
  SearchReplace() {
    const editorHandle = (window as typeof window & { leditor?: EditorHandle }).leditor;
    if (!editorHandle) {
      showPlaceholderDialog("Search", "Editor handle not available.");
      return;
    }
    try {
      // Prefer the shared UI panel implementation.
      ensureSearchPanel(editorHandle).toggle();
    } catch (error) {
      console.warn("[SearchReplace] failed to open panel", error);
      // Fallback to editor command routing if available.
      try {
        editorHandle.execCommand("SearchReplace" as any);
      } catch {
        showPlaceholderDialog("Search", "Search panel failed to open.");
      }
    }
  },
  Fullscreen() {
    toggleFullscreen();
  },
  BulletList(editor, args) {
    const styleId = typeof args?.styleId === "string" ? args.styleId.trim() : "";
    if (styleId) {
      try {
        (editor.view.dom as HTMLElement).dataset.bulletStyle = styleId;
        window.localStorage?.setItem("leditor:listStyle:bullet", styleId);
      } catch {
        // ignore storage failures
      }
      if (!editor.isActive("bulletList")) {
        chainWithSafeFocus(editor).toggleBulletList().run();
      } else {
        safeFocusEditor(editor);
      }
      return;
    }
    chainWithSafeFocus(editor).toggleBulletList().run();
  },
  NumberList(editor, args) {
    const styleId = typeof args?.styleId === "string" ? args.styleId.trim() : "";
    if (styleId) {
      try {
        (editor.view.dom as HTMLElement).dataset.numberStyle = styleId;
        window.localStorage?.setItem("leditor:listStyle:ordered", styleId);
      } catch {
        // ignore storage failures
      }
      if (!editor.isActive("orderedList")) {
        chainWithSafeFocus(editor).toggleOrderedList().run();
      } else {
        safeFocusEditor(editor);
      }
      return;
    }
    chainWithSafeFocus(editor).toggleOrderedList().run();
  },
  Heading1(editor) {
    chainWithSafeFocus(editor).toggleHeading({ level: 1 }).run();
  },
  Heading2(editor) {
    chainWithSafeFocus(editor).toggleHeading({ level: 2 }).run();
  },
  Heading3(editor) {
    chainWithSafeFocus(editor).toggleHeading({ level: 3 }).run();
  },
  Heading4(editor) {
    chainWithSafeFocus(editor).toggleHeading({ level: 4 }).run();
  },
  Heading5(editor) {
    chainWithSafeFocus(editor).toggleHeading({ level: 5 }).run();
  },
  Heading6(editor) {
    chainWithSafeFocus(editor).toggleHeading({ level: 6 }).run();
  },
  AlignLeft(editor) {
    safeFocusEditor(editor);
    editor.commands.updateAttributes("paragraph", { textAlign: "left" });
    editor.commands.updateAttributes("heading", { textAlign: "left" });
  },
  AlignCenter(editor) {
    safeFocusEditor(editor);
    editor.commands.updateAttributes("paragraph", { textAlign: "center" });
    editor.commands.updateAttributes("heading", { textAlign: "center" });
  },
  AlignRight(editor) {
    safeFocusEditor(editor);
    editor.commands.updateAttributes("paragraph", { textAlign: "right" });
    editor.commands.updateAttributes("heading", { textAlign: "right" });
  },
  JustifyFull(editor) {
    safeFocusEditor(editor);
    editor.commands.updateAttributes("paragraph", { textAlign: "justify" });
    editor.commands.updateAttributes("heading", { textAlign: "justify" });
  },
  VisualBlocks() {
    toggleVisualBlocks();
  },
  VisualChars() {
    toggleVisualChars();
  },
  "view.pageBoundaries.toggle"() {
    setPageBoundariesVisible(!isPageBoundariesVisible());
  },
  "view.pageBreakMarks.toggle"() {
    setPageBreakMarksVisible(!isPageBreakMarksVisible());
  },
  "view.ruler.toggle"() {
    setRulerVisible(!isRulerVisible());
  },
  "view.gridlines.toggle"() {
    setGridlinesVisible(!isGridlinesVisible());
  },
  "view.navigationPanel.toggle"() {
    const handle = window.leditor;
    if (!handle) return;
    toggleNavigationPanel(handle);
  },
  "view.paginationMode.set"(_editor, args) {
    const mode = args?.mode;
    if (mode !== "paged" && mode !== "continuous") {
      throw new Error('view.paginationMode.set requires { mode: "paged" | "continuous" }');
    }
    setPaginationModeAndView(mode);
  },
  "view.paginationMode.openMenu"() {
    // No-op; menu handled by UI.
  },
  "view.page.goto"(_editor, args) {
    const dir = args?.dir;
    if (dir !== "next" && dir !== "prev") {
      throw new Error('view.page.goto requires { dir: "next" | "prev" }');
    }
    stepPage(dir);
  },
  "view.zoom.step"(_editor, args) {
    const delta = typeof args?.delta === "number" ? args.delta : Number(args?.delta);
    if (!Number.isFinite(delta)) {
      throw new Error("view.zoom.step requires { delta: number }");
    }
    const layout = getLayoutController();
    if (!layout) return;
    layout.setZoom(layout.getZoom() + delta);
  },
  "view.zoom.set"(_editor, args) {
    const value = typeof args?.value === "number" ? args.value : Number(args?.value);
    if (!Number.isFinite(value)) {
      throw new Error("view.zoom.set requires { value: number }");
    }
    const layout = getLayoutController();
    if (!layout) return;
    layout.setZoom(value);
  },
  "view.zoom.fit"(_editor, args) {
    const mode = args?.mode;
    const layout = getLayoutController();
    if (!layout) return;
    if (mode === "pageWidth") {
      layout.setViewMode("fit-width");
      return;
    }
    if (mode === "wholePage") {
      setZoomFitWholePage();
      return;
    }
    throw new Error('view.zoom.fit requires { mode: "pageWidth" | "wholePage" }');
  },
  "view.zoom.openMenu"() {
    // No-op; menu handled by UI.
  },
  "view.fullscreen.toggle"() {
    toggleFullscreen();
  },
  DirectionLTR(editor) {
    applyBlockDirection(editor, "ltr");
  },
  DirectionRTL(editor) {
    applyBlockDirection(editor, "rtl");
  },
  "ai.settings.open"() {
    ensureAISettingsPanel().open();
  },
  "lexicon.define"(editor) {
    void runLexiconCommand(editor, "definition");
  },
  "lexicon.explain"(editor) {
    void runLexiconCommand(editor, "explain");
  },
  "lexicon.synonyms"(editor) {
    void runLexiconCommand(editor, "synonyms");
  },
  "lexicon.antonyms"(editor) {
    void runLexiconCommand(editor, "antonyms");
  },
  "lexicon.close"() {
    closeLexiconPopup();
  },
  "ai.sourceChecks.toggle"(editor) {
    const next = !isSourceChecksVisible();
    setSourceChecksVisible(next);
    if (!next) {
      (editor.commands as any).clearSourceChecks?.();
      return;
    }
    // When toggling on, prefer showing existing checks if they exist. If not, the
    // right-side rail will best-effort reattach from the persisted thread.
    const view = (editor as any)?.view;
    const sc = view ? getSourceCheckState(view.state) : null;
    if (!sc?.enabled || !Array.isArray(sc.items) || sc.items.length === 0) {
      const t = getSourceChecksThread();
      if (!t?.items?.length) return;
      // No-op here: renderer rail will reattach using EditorHandle.
      return;
    }
  },
  "ai.sourceChecks.clear"(editor) {
    clearSourceChecksThread();
    (editor.commands as any).clearSourceChecks?.();
  },
  "ai.sourceChecks.dismiss"(editor, args) {
    const key = typeof (args as any)?.key === "string" ? String((args as any).key).trim() : "";
    if (!key) return;
    dismissSourceCheckThreadItem(key);
    try {
      const view = (editor as any)?.view;
      const sc = view ? getSourceCheckState(view.state) : null;
      const remaining = (sc?.items ?? []).filter((it) => String(it?.key) !== key);
      if (remaining.length) {
        (editor.commands as any).setSourceChecks?.(remaining as any);
      } else {
        (editor.commands as any).clearSourceChecks?.();
      }
    } catch {
      // ignore
    }
  },
  "ai.sourceChecks.applyFix"(_editor, args) {
    const key = typeof (args as any)?.key === "string" ? String((args as any).key).trim() : "";
    if (!key) return;
    try {
      applyClaimRewriteForKey(key);
    } catch {
      // ignore
    }
  },
  "ai.sourceChecks.dismissFix"(_editor, args) {
    const key = typeof (args as any)?.key === "string" ? String((args as any).key).trim() : "";
    if (!key) return;
    try {
      dismissClaimRewriteForKey(key);
    } catch {
      // ignore
    }
  },
  // Back-compat / typo tolerance
  "ai.sourcecheck.toggle"(editor) {
    commandMap["ai.sourceChecks.toggle"](editor);
  },
  "ai.sourcecheck.clear"(editor) {
    commandMap["ai.sourceChecks.clear"](editor);
  },
  "ai.sourcecheck.dismiss"(editor, args) {
    commandMap["ai.sourceChecks.dismiss"](editor, args);
  },
  "ai.sourcecheck.applyFix"(editor, args) {
    commandMap["ai.sourceChecks.applyFix"](editor, args);
  },
  "ai.sourcecheck.dismissFix"(editor, args) {
    commandMap["ai.sourceChecks.dismissFix"](editor, args);
  },
  "ai.sourcechecks.toggle"(editor) {
    commandMap["ai.sourceChecks.toggle"](editor);
  },
  "ai.sourcechecks.clear"(editor) {
    commandMap["ai.sourceChecks.clear"](editor);
  },
  "ai.sourcechecks.dismiss"(editor, args) {
    commandMap["ai.sourceChecks.dismiss"](editor, args);
  },
  "ai.sourcechecks.applyFix"(editor, args) {
    commandMap["ai.sourceChecks.applyFix"](editor, args);
  },
  "ai.sourcechecks.dismissFix"(editor, args) {
    commandMap["ai.sourceChecks.dismissFix"](editor, args);
  },
  Indent(editor) {
    safeFocusEditor(editor);
    if (findListItemDepth(editor) !== null) {
      editor.commands.sinkListItem("listItem");
      return;
    }
    const block = getBlockAtSelection(editor);
    if (!block) return;
    const current = Number(block.attrs.indentLevel ?? 0);
    const next = clampIndentLevel(current + 1);
    editor.commands.updateAttributes(block.name, { indentLevel: next });
  },
  Outdent(editor) {
    safeFocusEditor(editor);
    if (findListItemDepth(editor) !== null) {
      editor.commands.liftListItem("listItem");
      return;
    }
    const block = getBlockAtSelection(editor);
    if (!block) return;
    const current = Number(block.attrs.indentLevel ?? 0);
    const next = clampIndentLevel(current - 1);
    editor.commands.updateAttributes(block.name, { indentLevel: next });
  },
  SetIndent(editor, args) {
    const target = typeof args?.level === "number" ? args.level : Number(args?.level);
    if (!Number.isFinite(target)) {
      throw new Error('SetIndent requires { level: number }');
    }
    const block = getBlockAtSelection(editor);
    if (!block) return;
    safeFocusEditor(editor);
    const next = clampIndentLevel(target);
    editor.commands.updateAttributes(block.name, { indentLevel: next });
  },
  LineSpacing(editor, args) {
    if (!args || typeof args.value !== "string") {
      throw new Error("LineSpacing requires { value }");
    }
    safeFocusEditor(editor);
    editor.commands.updateAttributes("paragraph", { lineHeight: args.value });
    editor.commands.updateAttributes("heading", { lineHeight: args.value });
  },
  SpaceBefore(editor, args) {
    if (!args || typeof args.valuePx !== "number") {
      throw new Error("SpaceBefore requires { valuePx }");
    }
    safeFocusEditor(editor);
    editor.commands.updateAttributes("paragraph", { spaceBefore: args.valuePx });
    editor.commands.updateAttributes("heading", { spaceBefore: args.valuePx });
  },
  SpaceAfter(editor, args) {
    if (!args || typeof args.valuePx !== "number") {
      throw new Error("SpaceAfter requires { valuePx }");
    }
    safeFocusEditor(editor);
    editor.commands.updateAttributes("paragraph", { spaceAfter: args.valuePx });
    editor.commands.updateAttributes("heading", { spaceAfter: args.valuePx });
  },
  FontFamily(editor, args) {
    if (!args || typeof args.value !== "string") {
      throw new Error("FontFamily requires { value }");
    }
    const chain = chainWithSafeFocus(editor);
    if (editor.state.selection.empty) {
      chain.selectAll();
    }
    chain.setMark("fontFamily", { fontFamily: args.value }).run();
  },
  FontSize(editor, args) {
    if (!args || typeof args.valuePx !== "number") {
      throw new Error("FontSize requires { valuePx }");
    }
    const chain = chainWithSafeFocus(editor);
    if (editor.state.selection.empty) {
      chain.selectAll();
    }
    chain.setMark("fontSize", { fontSize: args.valuePx }).run();
  },
  "font.size.grow"(editor) {
    const attrs = editor.getAttributes("fontSize") as { fontSize?: unknown } | null;
    const raw = attrs?.fontSize;
    const current =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.length > 0
          ? Number(raw)
          : NaN;
    const next = Number.isFinite(current) ? Math.min(400, current + 1) : 12;
    const chain = chainWithSafeFocus(editor);
    if (editor.state.selection.empty) {
      chain.selectAll();
    }
    chain.setMark("fontSize", { fontSize: next }).run();
  },
  "font.size.shrink"(editor) {
    const attrs = editor.getAttributes("fontSize") as { fontSize?: unknown } | null;
    const raw = attrs?.fontSize;
    const current =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.length > 0
          ? Number(raw)
          : NaN;
    const next = Number.isFinite(current) ? Math.max(1, current - 1) : 12;
    const chain = chainWithSafeFocus(editor);
    if (editor.state.selection.empty) {
      chain.selectAll();
    }
    chain.setMark("fontSize", { fontSize: next }).run();
  },
  NormalStyle(editor) {
    chainWithSafeFocus(editor).setParagraph().run();
  },
  RemoveFontStyle(editor) {
    chainWithSafeFocus(editor).unsetMark("fontFamily").unsetMark("fontSize").run();
  },
  TextColor(editor, args) {
    if (!args || typeof args.value !== "string") {
      throw new Error("TextColor requires { value }");
    }
    chainWithSafeFocus(editor).setMark("textColor", { color: args.value }).run();
  },
  RemoveTextColor(editor) {
    chainWithSafeFocus(editor).unsetMark("textColor").run();
  },
  HighlightColor(editor, args) {
    if (!args || typeof args.value !== "string") {
      throw new Error("HighlightColor requires { value }");
    }
    chainWithSafeFocus(editor).setMark("highlightColor", { highlight: args.value }).run();
  },
  RemoveHighlightColor(editor) {
    chainWithSafeFocus(editor).unsetMark("highlightColor").run();
  },
  Link(editor) {
    const raw = window.prompt("Enter link URL");
    if (raw === null) return;
    const href = raw.trim();
    const chain = chainWithSafeFocus(editor) as any;
    const markChain = (chain.extendMarkRange("link") as any);
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
  BlockquoteToggle(editor) {
    chainWithSafeFocus(editor).toggleBlockquote().run();
  },
  SelectAll(editor) {
    safeFocusEditor(editor);
    editor.commands.selectAll();
  },
  SelectObjects() {
    showPlaceholderDialog("Select Objects");
  },
  SelectSimilarFormatting() {
    showPlaceholderDialog("Select Similar Formatting");
  },
  Navigator() {
    const handle = window.leditor;
    if (!handle) return;
    toggleNavigationPanel(handle);
  },
  NavigatorDockToggle() {
    toggleNavigationDock();
  },
  GoToLastCursor() {
    const layout = getLayoutController();
    const ok = layout?.restoreLastBodySelection?.();
    if (!ok) {
      window.alert("No previous cursor position available.");
    }
  },
  InsertField(editor, args) {
    const raw = typeof args?.name === "string" ? args.name : window.prompt("Field name", "");
    if (raw === null) return;
    const name = (raw ?? "").trim();
    const label = name ? `[${name}]` : "[Field]";
    chainWithSafeFocus(editor).insertContent(label).run();
  },
  UpdateFields() {
    window.alert("Fields updated.");
  },
  ToggleFieldCodes() {
    const appRoot = document.getElementById("leditor-app");
    if (!appRoot) return;
    const next = !appRoot.classList.contains("leditor-field-codes");
    appRoot.classList.toggle("leditor-field-codes", next);
    window.alert(`Field codes ${next ? "shown" : "hidden"}.`);
  },
  UpdateInputFields() {
    showPlaceholderDialog("Update Input Fields");
  },
  FieldShadingToggle() {
    const appRoot = document.getElementById("leditor-app");
    if (!appRoot) return;
    const next = !appRoot.classList.contains("leditor-field-shading");
    appRoot.classList.toggle("leditor-field-shading", next);
    window.alert(`Field shading ${next ? "enabled" : "disabled"}.`);
  },
  DataSourceNavigator() {
    showPlaceholderDialog("Data Sources");
  },
  DataSourceDetach() {
    showPlaceholderDialog("Detach Data Sources");
  },
  ClipboardOptionsDialog() {
    showPlaceholderDialog("Clipboard Options");
  },
  FontOptionsDialog() {
    showPlaceholderDialog("Font Options");
  },
  FontEffectsMenu() {
    showPlaceholderDialog("Text Effects");
  },
  FontEffectsDialog() {
    showPlaceholderDialog("Text Effects Dialog");
  },
  FontEffectsOutline() {
    showPlaceholderDialog("Text Outline");
  },
  FontEffectsShadow() {
    showPlaceholderDialog("Text Shadow");
  },
  UnderlineColorPicker() {
    showPlaceholderDialog("Underline Color");
  },
  ParagraphOptionsDialog() {
    showPlaceholderDialog("Paragraph Options");
  },
  ParagraphSpacingDialog() {
    showPlaceholderDialog("Paragraph Spacing");
  },
  ParagraphSpacingMenu() {
    showPlaceholderDialog("Paragraph Spacing");
  },
  ParagraphBordersDialog() {
    showPlaceholderDialog("Paragraph Borders");
  },
  ParagraphBordersMenu() {
    showPlaceholderDialog("Paragraph Borders");
  },
  ParagraphBordersSet(editor, args) {
    const detail = args && typeof args === "object" ? JSON.stringify(args) : undefined;
    showPlaceholderDialog("Paragraph Borders", detail);
  },
  "styles.apply"(editor, args) {
    const styleId = typeof args?.styleId === "string" ? args.styleId : "";
    if (!styleId) {
      chainWithSafeFocus(editor).setParagraph().run();
      return;
    }
    applyStyleById(editor, styleId);
  },
  "styles.clear"(editor) {
    editor
      .chain()
      .focus()
      .setParagraph()
      .unsetMark("bold")
      .unsetMark("italic")
      .unsetMark("underline")
      .unsetMark("strikethrough")
      .unsetMark("link")
      .unsetMark("fontFamily")
      .unsetMark("fontSize")
      .unsetMark("textColor")
      .unsetMark("highlightColor")
      .run();
  },
  "styles.pane.open"() {
    const handle = window.leditor;
    if (!handle) return;
    toggleStylesPane(handle);
  },
  "styles.manage.openMenu"() {
    showPlaceholderDialog("Manage Styles");
  },
  "styles.create.openDialog"() {
    const handle = window.leditor;
    if (!handle) return;
    openStyleMiniApp(document.body, { editorHandle: handle }, { mode: "create" });
  },
  "styles.modify.openDialog"() {
    const handle = window.leditor;
    if (!handle) return;
    openStyleMiniApp(document.body, { editorHandle: handle }, { mode: "modify" });
  },
  "styles.io.openDialog"() {
    showPlaceholderDialog("Import/Export Styles");
  },
  "styles.options.openDialog"() {
    showPlaceholderDialog("Styles Options");
  },
  "styles.styleSet.openMenu"() {
    showPlaceholderDialog("Style Set");
  },
  "styles.styleSet.set"(_editor, args) {
    const setId = typeof args?.setId === "string" ? args.setId : "default";
    window.localStorage?.setItem("leditor.styleSet", setId);
    showPlaceholderDialog("Style Set", `Applied: ${setId}`);
  },
  EditLink(editor) {
    const current = editor.getAttributes("link").href ?? "";
    const raw = window.prompt("Edit link URL", current);
    if (raw === null) return;
    const href = raw.trim();
    const chain = chainWithSafeFocus(editor) as any;
    const markChain = (chain.extendMarkRange("link") as any);
    if (href.length === 0) {
      markChain.unsetLink().run();
      return;
    }
    markChain.setLink({ href }).run();
  },
  RemoveLink(editor) {
    const chain = chainWithSafeFocus(editor) as any;
    (chain.extendMarkRange("link") as any).unsetLink().run();
  },
  TableInsert(editor, args) {
    const rows = Math.max(1, Number(args?.rows ?? 2));
    const cols = Math.max(1, Number(args?.cols ?? 2));
    chainWithSafeFocus(editor).insertTable({ rows, cols, withHeaderRow: false }).run();
  },
  InsertImage(editor) {
    requestImageInsert(editor);
  },
  TableAddRowAbove(editor) {
    chainWithSafeFocus(editor).addRowBefore().run();
  },
  TableAddRowBelow(editor) {
    chainWithSafeFocus(editor).addRowAfter().run();
  },
  TableAddColumnLeft(editor) {
    chainWithSafeFocus(editor).addColumnBefore().run();
  },
  TableAddColumnRight(editor) {
    chainWithSafeFocus(editor).addColumnAfter().run();
  },
  TableDeleteRow(editor) {
    chainWithSafeFocus(editor).deleteRow().run();
  },
  TableDeleteColumn(editor) {
    chainWithSafeFocus(editor).deleteColumn().run();
  },
  TableMergeCells(editor) {
    chainWithSafeFocus(editor).mergeCells().run();
  },
  TableSplitCell(editor) {
    chainWithSafeFocus(editor).splitCell().run();
  },
  SelectStart(editor) {
    chainWithSafeFocus(editor).setTextSelection(0).run();
  },
  InsertFootnote(editor, args) {
    const picked = pickStableSelectionSnapshot(editor);
    const selectionSnapshot = picked.selectionSnapshot;
    const argText = typeof args?.text === "string" ? args.text : undefined;
    const text = argText;
    if ((window as any).__leditorCaretDebug) {
      console.info("[Footnote][InsertFootnote] selection", {
        selectionSnapshot,
        source: picked.source,
        current: {
          type: editor.state.selection.constructor?.name,
          from: editor.state.selection.from,
          to: editor.state.selection.to,
          empty: editor.state.selection.empty
        }
      });
    }
    const result = insertManagedFootnote(editor, "footnote", text, selectionSnapshot);
    // After insertion, the editor selection should be positioned just after the marker. Preserve it as the
    // "return point" when exiting footnote mode.
    focusFootnoteById(result.footnoteId, result.postInsertSelection);
  },
  "footnote.insert"(editor) {
    commandMap.InsertFootnote(editor);
  },
  InsertEndnote(editor, args) {
    const picked = pickStableSelectionSnapshot(editor);
    const selectionSnapshot = picked.selectionSnapshot;
    const text = typeof args?.text === "string" ? args.text : undefined;
    if ((window as any).__leditorFootnoteDebug) {
      console.info("[Footnote][InsertEndnote] selection", {
        selectionSnapshot,
        source: picked.source,
        current: {
          type: editor.state.selection.constructor?.name,
          from: editor.state.selection.from,
          to: editor.state.selection.to,
          empty: editor.state.selection.empty
        }
      });
    }
    const result = insertManagedFootnote(editor, "endnote", text, selectionSnapshot);
    focusFootnoteById(result.footnoteId, result.postInsertSelection);
  },
  "endnote.insert"(editor) {
    commandMap.InsertEndnote(editor);
  },


  NextFootnote(editor) {
    navigateFootnote(editor, 'next');
  },

  PreviousFootnote(editor) {
    navigateFootnote(editor, 'previous');
  },
  "footnote.navigate"(editor, args) {
    const dir = typeof args?.dir === "string" ? args.dir : "next";
    navigateFootnote(editor, dir === "prev" ? "previous" : "next");
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
    chainWithSafeFocus(editor).insertContent(bookmarkNode.create({ id, label })).insertContent(" ").run();
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
      if (rawTarget === null) return;
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
    chainWithSafeFocus(editor).insertContent(crossRefNode.create({ targetId, label: bookmark.label || targetId })).run();
  },

  InsertTOC(editor, args) {
    const entries = collectHeadingEntries(editor);
    const style =
      typeof args?.id === "string"
        ? args.id
        : typeof args?.style === "string"
          ? args.style
          : "auto1";
    insertTocNode(editor, entries, { style });
  },

  UpdateTOC(editor) {
    const entries = collectHeadingEntries(editor);
    if (!updateTocNodes(editor, entries)) {
      window.alert('No table of contents found to update.');
    }
  },

  RemoveTOC(editor) {
    removeTocNodes(editor);
  },

  InsertTocHeading(editor, args) {
    const defaultText = typeof args?.text === "string" ? args.text.trim() : "";
    const userText = defaultText || window.prompt('Heading text');
    if (!userText) {
      return;
    }
    const trimmed = userText.trim();
    if (trimmed.length === 0) {
      return;
    }
    const levelArg =
      typeof args?.level === "number" && Number.isFinite(args.level) ? Math.floor(args.level) : undefined;
    const levelRaw =
      levelArg !== undefined
        ? levelArg
        : Number.parseInt(window.prompt('Heading level (1-6)', '1') ?? '1', 10);
    const level = levelArg !== undefined ? Math.max(0, Math.min(6, levelArg)) : Math.max(1, Math.min(6, levelRaw || 1));
    if (level === 0) {
      window.alert("Do not show in TOC is not supported yet.");
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

  InsertCitation: handleInsertCitationCommand,
  "citation.insert.openDialog": handleInsertCitationCommand,

  UpdateCitations(editor) {
    void (async () => {
      logAllCitationAnchors(editor, "before");
      // Imported documents often contain citation anchors (dq:// links with data-key).
      // Convert them into atomic citation nodes so users cannot edit inside citations and delete acts
      // on the whole citation. Also ensures they’re tracked as used bibliography keys.
      convertCitationAnchorsToCitationNodes(editor);
      await refreshCitationsAndBibliography(editor);
      logAllCitationAnchors(editor, "after");
      await citationKeysToUsedStore(editor);
      await showBibliographyPreview(editor);
    })();
  },

  SetCitationStyle: setCitationStyleCommand,

  "citation.style.set": setCitationStyleCommand,
  "citation.style.openMenu"() {
    // Dropdown menus are handled by the ribbon UI; this exists to avoid "missing" markers.
  },
  'citation.csl.import.openDialog'() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csl,application/xml,text/xml";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const xml = String(reader.result ?? "");
        refsInfo("[References] CSL imported", { name: file.name, bytes: xml.length });
        try {
          window.localStorage?.setItem(`leditor.csl.style:${file.name}`, xml);
        } catch {
          // ignore
        }
        window.alert(`Imported CSL style: ${file.name}`);
      };
      reader.readAsText(file);
    });
    input.click();
  },
  'citation.csl.manage.openDialog'() {
    try {
      const keys = Object.keys(window.localStorage || {}).filter((k) => k.startsWith("leditor.csl.style:"));
      if (keys.length === 0) {
        window.alert("No imported CSL styles.");
        return;
      }
      const listing = keys.map((k) => k.replace("leditor.csl.style:", "")).join("\n");
      const target = window.prompt(`Imported CSL styles:\n\n${listing}\n\nType an exact name to delete:`);
      if (!target) return;
      const key = `leditor.csl.style:${target}`;
      window.localStorage?.removeItem(key);
      window.alert(`Deleted CSL style: ${target}`);
    } catch {
      window.alert("Unable to manage CSL styles (storage unavailable).");
    }
  },
  "citation.options.openDialog": setCitationLocaleCommand,
  "citation.import.openMenu"() {
    // Dropdown menus are handled by the ribbon UI; this exists to avoid "missing" markers.
  },
  "citation.inspect.openPane"() {
    openSourcesPanel();
  },
  "citation.source.add.openDialog"(_editor) {
    const raw = window.prompt("New source itemKey (8-char key)", "");
    if (!raw) return;
    const itemKey = normalizeReferenceItemKey(raw);
    const title = window.prompt("Title (optional)", "") ?? "";
    const author = window.prompt("Author (optional)", "") ?? "";
    const year = window.prompt("Year (optional)", "") ?? "";
    const url = window.prompt("URL (optional)", "") ?? "";
    upsertReferenceItems([
      {
        itemKey,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        year: year.trim() || undefined,
        url: url.trim() || undefined
      }
    ]);
    window.alert(`Added source: ${itemKey}`);
  },
  "citation.placeholder.add.openDialog"(editor) {
    chainWithSafeFocus(editor).insertContent("(citation)").run();
  },
  "citation.import.bibtex.openDialog"() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".bib,text/plain";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const items = parseBibtex(String(reader.result ?? ""));
          upsertReferenceItems(items);
          window.alert(`Imported ${items.length} BibTeX references.`);
        } catch (error) {
          console.error("[References] import bibtex failed", error);
          window.alert("Failed to import BibTeX.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  },
  "citation.import.ris.openDialog"() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ris,text/plain";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const items = parseRis(String(reader.result ?? ""));
          upsertReferenceItems(items);
          window.alert(`Imported ${items.length} RIS references.`);
        } catch (error) {
          console.error("[References] import ris failed", error);
          window.alert("Failed to import RIS.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  },
  "citation.import.csljson.openDialog"() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = JSON.parse(String(reader.result ?? "")) as any;
          const itemsRaw = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
          const items = itemsRaw
            .map((it: any) => ({
              itemKey: String(it.itemKey ?? it.id ?? it.item_key ?? "").trim(),
              title: typeof it.title === "string" ? it.title : undefined,
              author: typeof it.author === "string" ? it.author : undefined,
              year: typeof it.year === "string" ? it.year : undefined,
              url: typeof it.url === "string" ? it.url : undefined,
              note: typeof it.note === "string" ? it.note : undefined,
              dqid: typeof it.dqid === "string" ? it.dqid : undefined,
              // Preserve full CSL-JSON to allow accurate citeproc rendering.
              csl: it && typeof it === "object" ? it : undefined
            }))
            .filter((it: any) => it.itemKey);
          upsertReferenceItems(items);
          refsInfo("[References] imported CSL-JSON items", { count: items.length });
          window.alert(`Imported ${items.length} references.`);
        } catch (error) {
          console.error("[References] import CSL-JSON failed", error);
          window.alert("Failed to import CSL JSON.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  },
  "citation.citeKey.insert.openDialog"(editor) {
    promptAndInsertCiteKey(editor);
  },
  "citation.citeKey.resolveAll"(editor) {
    // Best-effort resolver: converts dq:// anchors with data-key to citation nodes (already in Update),
    // and resolves standalone "@KEY" tokens into citation nodes.
    const citationNode = editor.schema.nodes.citation;
    if (!citationNode) return;
    const tr = editor.state.tr;
    const ranges: Array<{ from: number; to: number; key: string }> = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      const text = node.text || "";
      const m = /^@([A-Z0-9]{8})$/.exec(text.trim());
      if (!m) return true;
      ranges.push({ from: pos, to: pos + node.nodeSize, key: m[1] });
      return true;
    });
    ranges
      .sort((a, b) => b.from - a.from)
      .forEach((r) => {
        const attrs = {
          citationId: generateCitationId(),
          items: buildCitationItems([r.key], {}),
          renderedHtml: "",
          hidden: false
        };
        tr.replaceWith(r.from, r.to, citationNode.create(attrs));
      });
    if (tr.docChanged) editor.view.dispatch(tr);
    void refreshCitationsAndBibliography(editor);
  },
  "bibliography.insert.default"(editor) {
    commandMap["bibliography.insert"](editor, { template: "references" });
  },
  "bibliography.insert"(editor, args) {
    void (async () => {
      const template = typeof args?.template === "string" ? args.template.trim() : "references";
      const label =
        template === "bibliography" ? "Bibliography" : template === "worksCited" ? "Works Cited" : "References";
      const fromStore = await readUsedBibliography();
      const rawKeys = fromStore.length ? fromStore : collectDocumentCitationKeys(editor);
      const keys = collectOrderedCitedItemKeys(editor, rawKeys);
      if (!fromStore.length) await writeUsedBibliography(rawKeys);
      ensureBibliographyStore();
      // Always rebuild references as the last pages and force a clean page boundary.
      removeTrailingReferencesByBreak(editor);
      insertReferencesAsNewLastPages(editor, label, keys);
      await refreshCitationsAndBibliography(editor);
    })();
  },
  "bibliography.insert.field"(editor) {
    void (async () => {
      const fromStore = await readUsedBibliography();
      if (!fromStore.length) {
        await writeUsedBibliography(collectDocumentCitationKeys(editor));
      }
      ensureBibliographyStore();
      insertBibliographyField(editor);
      await refreshCitationsAndBibliography(editor);
    })();
  },

  SetCitationSources(editor, args) {
    const sources = Array.isArray(args?.sources) ? (args?.sources as CitationSource[]) : [];
    if (!sources.length) {
      return;
    }
    setCitationSources(editor, sources);
  },

  UpsertCitationSource(editor, args) {
    const source = args?.source || args;
    if (!source || typeof source !== "object") {
      return;
    }
    const rawId = String(source.id || source.item_key || "").trim();
    const normalizedId = normalizeCitationId(rawId);
    if (!normalizedId) {
      return;
    }
    const payload: CitationSource = {
      id: normalizedId,
      label: typeof source.label === "string" ? source.label : undefined,
      title: typeof source.title === "string" ? source.title : undefined,
      author: typeof source.author === "string" ? source.author : undefined,
      year: typeof source.year === "string" ? source.year : undefined,
      url: typeof source.url === "string" ? source.url : undefined,
      note: typeof source.note === "string" ? source.note : undefined
    };
    upsertCitationSource(editor, payload);
  },

  InsertBibliography(editor) {
    void (async () => {
      refsInfo("[References] insert bibliography", { styleId: editor.state.doc.attrs?.citationStyleId });
      const fromStore = await readUsedBibliography();
      const rawKeys = fromStore.length ? fromStore : collectDocumentCitationKeys(editor);
      const keys = collectOrderedCitedItemKeys(editor, rawKeys);
      if (!fromStore.length) {
        await writeUsedBibliography(rawKeys);
      }
      refsInfo("[References] insert bibliography", { itemKeys: keys });
      ensureBibliographyStore();
      removeTrailingReferencesByBreak(editor);
      insertReferencesAsNewLastPages(editor, "References", keys);
      await refreshCitationsAndBibliography(editor);
    })();
  },

  UpdateBibliography(editor) {
    void (async () => {
      const fromStore = await readUsedBibliography();
      const rawKeys = fromStore.length ? fromStore : collectDocumentCitationKeys(editor);
      const keys = collectOrderedCitedItemKeys(editor, rawKeys);
      removeTrailingReferencesByBreak(editor);
      insertReferencesAsNewLastPages(editor, "References", keys);
      await refreshCitationsAndBibliography(editor);
    })();
  },
  "citation.sources.manage.openDialog"(editor) {
    refsInfo("[References] manage sources invoked");
    openSourcesPanel();
  },
  "citation.sources.update.openDialog"(editor) {
    commandMap.UpdateCitations(editor);
  },
  "bibliography.export.bibtex.openDialog"() {
    void exportBibliographyBibtex();
  },
  "bibliography.export.json.openDialog"() {
    void exportBibliographyJson();
  },
  InsertPageBreak(editor) {
    insertBreakNode(editor, 'page');
  },
  InsertColumnBreak(editor) {
    insertBreakNode(editor, 'column');
  },
  InsertTextWrappingBreak(editor) {
    insertBreakNode(editor, 'text_wrap');
  },
  InsertSectionBreakNextPage(editor) {
    insertBreakNode(editor, 'section_next');
  },
  InsertSectionBreakContinuous(editor) {
    insertBreakNode(editor, 'section_continuous');
  },
  InsertSectionBreakEven(editor) {
    insertBreakNode(editor, 'section_even');
  },
  InsertSectionBreakOdd(editor) {
    insertBreakNode(editor, 'section_odd');
  },
  InsertTemplate(editor, args) {
    const templateId = typeof args?.id === 'string' ? args.id : undefined;
    if (!templateId) {
      return;
    }
    const template = getTemplateById(templateId);
    if (!template) {
      console.warn('InsertTemplate: unknown template', templateId);
      return;
    }
    chainWithSafeFocus(editor).insertContent(template.document as any).run();
  },
  ApplyTemplate(editor, args) {
    const templateId = typeof args?.id === "string" ? args.id : undefined;
    if (!templateId) return;
    const template = getTemplateById(templateId);
    if (!template) {
      console.warn("ApplyTemplate: unknown template", templateId);
      return;
    }

    const docJson = template.document as any;
    const pageNode = editor.schema.nodes.page;
    const normalized =
      docJson?.type === "doc" && pageNode && Array.isArray(docJson.content) && !docJson.content.some((n: any) => n?.type === "page")
        ? { ...docJson, content: [{ type: "page", content: docJson.content ?? [] }] }
        : docJson;

    editor.commands.setContent(normalized);

    const metadata = (template as any).metadata as Record<string, unknown> | undefined;
    const defaults = (metadata?.documentDefaults as Record<string, unknown> | undefined) ?? undefined;
    if (defaults && typeof defaults === "object") {
      const fontFamily = typeof (defaults as any).fontFamily === "string" ? ((defaults as any).fontFamily as string).trim() : "";
      const fontSizePx = typeof (defaults as any).fontSizePx === "number" ? (defaults as any).fontSizePx : NaN;
      const textColor = typeof (defaults as any).textColor === "string" ? ((defaults as any).textColor as string).trim() : "";
      const markFontFamily = fontFamily ? editor.schema.marks.fontFamily?.create({ fontFamily }) : null;
      const markFontSize = Number.isFinite(fontSizePx) ? editor.schema.marks.fontSize?.create({ fontSize: fontSizePx }) : null;
      const markTextColor = textColor ? editor.schema.marks.textColor?.create({ color: textColor }) : null;

      // Apply text marks to paragraph ranges only (avoid overriding heading sizing).
      if (markFontFamily || markFontSize || markTextColor) {
        const mtFamily = editor.schema.marks.fontFamily;
        const mtSize = editor.schema.marks.fontSize;
        const mtColor = editor.schema.marks.textColor;
        let tr = editor.state.tr;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== "paragraph") return true;
          const from = pos + 1;
          const to = pos + node.nodeSize - 1;
          if (markFontFamily && mtFamily) {
            tr = tr.removeMark(from, to, mtFamily).addMark(from, to, markFontFamily);
          }
          if (markFontSize && mtSize) {
            tr = tr.removeMark(from, to, mtSize).addMark(from, to, markFontSize);
          }
          if (markTextColor && mtColor) {
            tr = tr.removeMark(from, to, mtColor).addMark(from, to, markTextColor);
          }
          return true;
        });
        if (tr.docChanged) {
          editor.view.dispatch(tr);
        }
      }

      // Apply paragraph-level defaults across the document.
      editor.commands.selectAll();
      const textAlign = (defaults as any).textAlign;
      const lineHeight = (defaults as any).lineHeight;
      const spaceBeforePx = (defaults as any).spaceBeforePx;
      const spaceAfterPx = (defaults as any).spaceAfterPx;
      if (textAlign === "left" || textAlign === "center" || textAlign === "right" || textAlign === "justify") {
        editor.commands.updateAttributes("paragraph", { textAlign });
        editor.commands.updateAttributes("heading", { textAlign });
      }
      if (typeof lineHeight === "string" && lineHeight.trim().length > 0) {
        editor.commands.updateAttributes("paragraph", { lineHeight });
        editor.commands.updateAttributes("heading", { lineHeight });
      }
      if (typeof spaceBeforePx === "number" && Number.isFinite(spaceBeforePx)) {
        editor.commands.updateAttributes("paragraph", { spaceBefore: spaceBeforePx });
        editor.commands.updateAttributes("heading", { spaceBefore: spaceBeforePx });
      }
      if (typeof spaceAfterPx === "number" && Number.isFinite(spaceAfterPx)) {
        editor.commands.updateAttributes("paragraph", { spaceAfter: spaceAfterPx });
        editor.commands.updateAttributes("heading", { spaceAfter: spaceAfterPx });
      }

      // Set stored marks so continued typing follows the template defaults.
      const chainAtStart = chainWithSafeFocus(editor, "start");
      if (fontFamily) chainAtStart.setMark("fontFamily", { fontFamily });
      if (Number.isFinite(fontSizePx)) chainAtStart.setMark("fontSize", { fontSize: fontSizePx });
      if (textColor) chainAtStart.setMark("textColor", { color: textColor });
      chainAtStart.run();
    }

    safeFocusEditor(editor, "start");
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

  AllowedElements() {
    showAllowedElementsInspector(SANITIZE_OPTIONS);
  },

  SetReadMode() {
    setReadMode(true);
  },
  SetPrintLayout() {
    setReadMode(false);
  },
  SetScrollDirectionVertical() {
    setScrollDirection("vertical");
  },
  SetScrollDirectionHorizontal() {
    setScrollDirection("horizontal");
  },
  ZoomIn() {
    const layout = getLayoutController();
    if (!layout) return;
    layout.setZoom(layout.getZoom() + 0.1);
  },
  ZoomOut() {
    const layout = getLayoutController();
    if (!layout) return;
    layout.setZoom(layout.getZoom() - 0.1);
  },
  ZoomReset() {
    const layout = getLayoutController();
    if (!layout) return;
    layout.setZoom(1);
  },
  ViewSinglePage() {
    const layout = getLayoutController();
    if (!layout) return;
    layout.setViewMode("single");
  },
  ViewTwoPage() {
    const layout = getLayoutController();
    if (!layout) return;
    layout.setViewMode("two-page");
  },
  ViewFitWidth() {
    const layout = getLayoutController();
    if (!layout) return;
    layout.setViewMode("fit-width");
  },
  SetPageMargins(editor, args) {
    const margins = args?.margins;
    if (!margins || typeof margins !== "object") {
      throw new Error('SetPageMargins requires { margins }');
    }
    const tiptap = getTiptap(editor);
    if (!tiptap?.commands?.setPageMargins) {
      throw new Error("TipTap setPageMargins command unavailable");
    }
    const payload = {
      top: parseToCm((margins as any).top, 2.5),
      right: parseToCm((margins as any).right, 2.5),
      bottom: parseToCm((margins as any).bottom, 2.5),
      left: parseToCm((margins as any).left, 2.5)
    };
    // Debug: silenced noisy ribbon logs.
    tiptap.commands.setPageMargins(payload);
    if (typeof args?.presetId === "string") {
      setMarginsPreset(args.presetId);
    } else {
      setMarginsCustom(margins);
    }
    applyDocumentLayoutTokens(document.documentElement);
    const layout = getLayoutController();
    if (layout?.setMargins) {
      layout.setMargins(margins);
      layout.updatePagination();
      return;
    }
    setPageMargins(margins);
  },
  SetPageOrientation(editor, args) {
    const orientation = args?.orientation;
    if (orientation !== "portrait" && orientation !== "landscape") {
      throw new Error('SetPageOrientation requires { orientation: "portrait" | "landscape" }');
    }
    const tiptap = getTiptap(editor);
    if (!tiptap?.commands?.setPageOrientation) {
      // Debug: silenced noisy ribbon logs.
      throw new Error("TipTap setPageOrientation command unavailable");
    }
    const ok = tiptap.commands.setPageOrientation(orientation);
    // Debug: silenced noisy ribbon logs.
    if (!ok) {
      throw new Error("setPageOrientation command failed");
    }
    setDocOrientation(orientation);
    applyDocumentLayoutTokens(document.documentElement);
    setPageOrientation(orientation);
    const layout = getLayoutController();
    layout?.updatePagination();
  },
  SetPageSize(editor, args) {
    const id = typeof args?.id === "string" ? args.id : undefined;
    const overrides = typeof args?.overrides === "object" && args?.overrides !== null ? args.overrides : undefined;
    const tiptap = getTiptap(editor);
    if (!tiptap?.commands?.setPageSize) {
      // Debug: silenced noisy ribbon logs.
      throw new Error("TipTap setPageSize command unavailable");
    }
    const ok = tiptap.commands.setPageSize(id ?? "a4", overrides);
    // Debug: silenced noisy ribbon logs.
    if (!ok) {
      throw new Error("setPageSize command failed");
    }
    setPageSizePreset(id ?? "a4");
    applyDocumentLayoutTokens(document.documentElement);
    setPageSize(id, overrides);
    const layout = getLayoutController();
    layout?.updatePagination();
  },
  SetContentFrameHeight(editor, args) {
    const value = typeof args?.value === "number" ? args.value : Number(args?.value);
    if (!Number.isFinite(value)) {
      throw new Error("SetContentFrameHeight requires { value: number }");
    }
    const layout = getLayoutController();
    if (!layout || typeof layout.setContentFrameHeight !== "function") {
      throw new Error("Layout controller does not support content frame height.");
    }
    layout.setContentFrameHeight(value);
  },
  ContentFrameHeightInc() {
    const layout = getLayoutController();
    if (!layout || typeof layout.adjustContentFrameHeight !== "function") {
      throw new Error("Layout controller does not support content frame height adjustment.");
    }
    layout.adjustContentFrameHeight(10);
  },
  ContentFrameHeightDec() {
    const layout = getLayoutController();
    if (!layout || typeof layout.adjustContentFrameHeight !== "function") {
      throw new Error("Layout controller does not support content frame height adjustment.");
    }
    layout.adjustContentFrameHeight(-10);
  },
  ContentFrameHeightReset() {
    const layout = getLayoutController();
    if (!layout || typeof layout.resetContentFrameHeight !== "function") {
      throw new Error("Layout controller does not support content frame height reset.");
    }
    layout.resetContentFrameHeight();
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
  SetPageGutter(editor, args) {
    const valueIn = typeof args?.valueIn === "number" ? args.valueIn : Number(args?.valueIn);
    const enabled = args?.enabled;
    const positionId = args?.positionId;
    setGutter({
      enabled,
      valueIn: Number.isFinite(valueIn) ? valueIn : undefined,
      positionId
    });
    applyDocumentLayoutTokens(document.documentElement);
    const layout = getLayoutController();
    layout?.updatePagination();
  },
  SetHeaderDistance(editor, args) {
    const valueIn = typeof args?.valueIn === "number" ? args.valueIn : Number(args?.valueIn);
    if (!Number.isFinite(valueIn)) {
      throw new Error("SetHeaderDistance requires { valueIn }");
    }
    setHeaderDistance(valueIn);
    applyDocumentLayoutTokens(document.documentElement);
    const layout = getLayoutController();
    layout?.updatePagination();
  },
  SetFooterDistance(editor, args) {
    const valueIn = typeof args?.valueIn === "number" ? args.valueIn : Number(args?.valueIn);
    if (!Number.isFinite(valueIn)) {
      throw new Error("SetFooterDistance requires { valueIn }");
    }
    setFooterDistance(valueIn);
    applyDocumentLayoutTokens(document.documentElement);
    const layout = getLayoutController();
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
    setSectionColumns(count);
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
  SetParagraphGrid(editor, args) {
    const enabled = typeof args?.enabled === "boolean" ? args.enabled : Boolean(args?.enabled);
    const tiptap = getTiptap(editor);
    if (!tiptap?.commands?.setParagraphGrid) {
      throw new Error("TipTap setParagraphGrid command unavailable");
    }
    const ok = tiptap.commands.setParagraphGrid(enabled);
    if (!ok) {
      throw new Error("setParagraphGrid command failed");
    }
    const root = document.getElementById("leditor-app") ?? document.body;
    root?.classList.toggle("leditor-app--paragraph-grid", enabled);
  },
  SetAiDraftPreview(editor, args) {
    const items = Array.isArray(args?.items) ? args.items : [];
    const tiptap = getTiptap(editor);
    if (!tiptap?.commands?.setAiDraftPreview) {
      throw new Error("TipTap setAiDraftPreview command unavailable");
    }
    const normalized = items
      .map((it: any) => {
        const from = Number(it?.from);
        const to = Number(it?.to);
        const proposedText = typeof it?.proposedText === "string" ? it.proposedText : "";
        const n = Number(it?.n);
        if (!Number.isFinite(from) || !Number.isFinite(to) || !proposedText) return null;
        return {
          n: Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined,
          from: Math.floor(from),
          to: Math.floor(to),
          proposedText,
          originalText: typeof it?.originalText === "string" ? it.originalText : undefined
        };
      })
      .filter(Boolean);
    const ok = tiptap.commands.setAiDraftPreview(normalized as any);
    if (!ok) {
      throw new Error("setAiDraftPreview command failed");
    }
  },
  ClearAiDraftPreview(editor) {
    const tiptap = getTiptap(editor);
    if (!tiptap?.commands?.clearAiDraftPreview) {
      throw new Error("TipTap clearAiDraftPreview command unavailable");
    }
    const ok = tiptap.commands.clearAiDraftPreview();
    if (!ok) {
      throw new Error("clearAiDraftPreview command failed");
    }
  },
  SetSourceChecks(editor, args) {
    const items = Array.isArray(args?.items) ? args.items : [];
    const tiptap = getTiptap(editor);
    if (!tiptap?.commands?.setSourceChecks) {
      throw new Error("TipTap setSourceChecks command unavailable");
    }
    const normalized = items
      .map((it: any) => {
        const from = Number(it?.from);
        const to = Number(it?.to);
        const key = typeof it?.key === "string" ? it.key : "";
        const verdict = it?.verdict === "verified" ? "verified" : "needs_review";
        const justification = typeof it?.justification === "string" ? it.justification : "";
        if (!key || !Number.isFinite(from) || !Number.isFinite(to)) return null;
        return {
          key,
          verdict,
          justification,
          from: Math.floor(from),
          to: Math.floor(to)
        };
      })
      .filter(Boolean);
    const ok = tiptap.commands.setSourceChecks(normalized as any);
    if (!ok) {
      throw new Error("setSourceChecks command failed");
    }
  },
  ClearSourceChecks(editor) {
    const tiptap = getTiptap(editor);
    if (!tiptap?.commands?.clearSourceChecks) {
      throw new Error("TipTap clearSourceChecks command unavailable");
    }
    const ok = tiptap.commands.clearSourceChecks();
    if (!ok) {
      throw new Error("clearSourceChecks command failed");
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
    const layout = getLayoutController();
    layout?.enterHeaderFooterMode('header');
  },
  EditFooter() {
    const layout = getLayoutController();
    layout?.enterHeaderFooterMode('footer');
  },

  ExitHeaderFooterEdit() {
    const layout = getLayoutController();
    layout?.exitHeaderFooterMode();
  },

  FootnotePanel() {
    window.leditorHost?.toggleFootnotePanel?.();
  },
  "footnote.showNotes.toggle"() {
    window.leditorHost?.toggleFootnotePanel?.();
  },
  "footnote.navigate.openMenu"() {
    // Menu-only control; no action needed here.
  },
  "footnote.options.openDialog"() {
    // Placeholder until options UI exists.
  }
};

const ensureCommand = (id: string): CommandHandler => {
  const handler = commandMap[id];
  if (!handler) {
    throw new Error(`Missing command handler for "${id}"`);
  }
  return handler;
};

const aliasCommand = (aliasId: string, targetId: string, fixedArgs?: any): void => {
  commandMap[aliasId] = (editor, args) => {
    const handler = ensureCommand(targetId);
    handler(editor, fixedArgs ?? args);
  };
};

const aliasCommandWithArgs = (
  aliasId: string,
  targetId: string,
  mergeArgs: (args?: any) => any
): void => {
  commandMap[aliasId] = (editor, args) => {
    const handler = ensureCommand(targetId);
    handler(editor, mergeArgs(args));
  };
};

const applyRibbonAliases = (): void => {
  // File
  aliasCommand("file.new", "New");
  aliasCommand("file.open", "Open");
  aliasCommand("file.save", "Save");
  aliasCommand("file.saveAs", "SaveAs");
  aliasCommand("file.versionHistory", "VersionHistory");

  // Clipboard / history
  aliasCommand("clipboard.cut", "Cut");
  aliasCommand("clipboard.copy", "Copy");
  aliasCommand("clipboard.paste", "Paste");
  aliasCommand("paste.default", "Paste");
  aliasCommand("paste.keepSource", "Paste");
  aliasCommand("paste.mergeFormatting", "Paste");
  aliasCommand("paste.textOnly", "PastePlain");
  aliasCommand("paste.plainText", "PastePlain");
  aliasCommand("paste.fromWordCleanup", "PastePlain");
  aliasCommand("history.undo", "Undo");
  aliasCommand("history.redo", "Redo");

  // Font toggles
  aliasCommand("font.bold.toggle", "Bold");
  aliasCommand("font.italic.toggle", "Italic");
  aliasCommand("font.underline.toggle", "Underline");
  aliasCommand("font.strikethrough.toggle", "Strikethrough");
  aliasCommand("font.subscript.toggle", "Subscript");
  aliasCommand("font.superscript.toggle", "Superscript");
  aliasCommand("font.clearFormatting", "ClearFormatting");

  aliasCommandWithArgs("font.case.set", "ChangeCase", (args) => {
    const mode = args?.mode ?? args?.value ?? args?.case;
    return { mode };
  });

  // Style aliases
  aliasCommand("font.style.normal", "NormalStyle");
  aliasCommand("font.style.title", "Heading1");
  aliasCommand("font.style.subtitle", "Heading2");
  aliasCommand("font.style.heading1", "Heading1");
  aliasCommand("font.style.heading2", "Heading2");
  aliasCommand("font.style.heading3", "Heading3");
  aliasCommand("font.style.heading4", "Heading4");
  aliasCommand("font.style.heading5", "Heading5");
  aliasCommand("font.style.heading6", "Heading6");

  // Paragraph alignment
  commandMap["paragraph.align.set"] = (editor, args) => {
    const mode = String(args?.mode ?? "left").toLowerCase();
    if (mode === "center") return ensureCommand("AlignCenter")(editor);
    if (mode === "right") return ensureCommand("AlignRight")(editor);
    if (mode === "justify") return ensureCommand("JustifyFull")(editor);
    return ensureCommand("AlignLeft")(editor);
  };

  // Lists
  aliasCommand("list.bullet.toggle", "BulletList");
  aliasCommand("list.ordered.toggle", "NumberList");

  // Indent / spacing
  aliasCommand("paragraph.indent", "Indent");
  aliasCommand("paragraph.outdent", "Outdent");
  aliasCommandWithArgs("paragraph.lineSpacing.set", "LineSpacing", (args) => ({ value: args?.value }));
  aliasCommandWithArgs("paragraph.spaceBefore.add", "SpaceBefore", () => ({ valuePx: 8 }));
  aliasCommandWithArgs("paragraph.spaceBefore.remove", "SpaceBefore", () => ({ valuePx: 0 }));
  aliasCommandWithArgs("paragraph.spaceAfter.add", "SpaceAfter", () => ({ valuePx: 8 }));
  aliasCommandWithArgs("paragraph.spaceAfter.remove", "SpaceAfter", () => ({ valuePx: 0 }));
  aliasCommand("paragraph.spacing.openMenu", "ParagraphSpacingMenu");
  aliasCommand("paragraph.spacing.openDialog", "ParagraphSpacingDialog");

  // Borders & shading
  aliasCommand("paragraph.borders.openMenu", "ParagraphBordersMenu");
  aliasCommand("paragraph.borders.openDialog", "ParagraphBordersDialog");
  aliasCommandWithArgs("paragraph.borders.set", "ParagraphBordersSet", (args) => args ?? {});

  // Quote / rule
  aliasCommand("paragraph.blockquote.toggle", "BlockquoteToggle");
  aliasCommand("insert.horizontalRule", "InsertHorizontalRule");

  // Page breaks / sections
  aliasCommand("insert.pageBreak", "InsertPageBreak");
  aliasCommand("insert.columnBreak", "InsertColumnBreak");
  aliasCommand("insert.sectionBreak.nextPage", "InsertSectionBreakNextPage");
  aliasCommand("insert.sectionBreak.continuous", "InsertSectionBreakContinuous");
  aliasCommand("insert.sectionBreak.evenPage", "InsertSectionBreakEven");
  aliasCommand("insert.sectionBreak.oddPage", "InsertSectionBreakOdd");

  // Tables / images / links
  aliasCommandWithArgs("insert.table.apply", "TableInsert", (args) => ({
    rows: Number(args?.rows ?? 2),
    cols: Number(args?.cols ?? 2)
  }));
  aliasCommand("insert.image.upload.openPicker", "InsertImage");
  aliasCommand("links.link", "Link");
  aliasCommand("links.bookmark", "InsertBookmark");
  aliasCommand("links.crossReference", "InsertCrossReference");

  // TOC + references
  aliasCommand("toc.tableOfContents", "InsertTOC");
  aliasCommand("toc.insert.default", "InsertTOC");
  aliasCommand("toc.insert.template", "InsertTOC");
  aliasCommand("toc.insert.custom.openDialog", "InsertTOC");
  aliasCommand("toc.updateTable", "UpdateTOC");
  aliasCommand("toc.update", "UpdateTOC");
  aliasCommand("toc.update.default", "UpdateTOC");
  aliasCommand("toc.addText", "InsertTocHeading");
  aliasCommand("toc.addText.openMenu", "InsertTocHeading");
  aliasCommand("toc.addText.setLevel", "InsertTocHeading");
  aliasCommand("toc.remove", "RemoveTOC");

  // Footnotes
  aliasCommand("footnotes.insertFootnote", "InsertFootnote");
  aliasCommand("footnotes.insertEndnote", "InsertEndnote");
  aliasCommandWithArgs("footnotes.nextFootnote", "footnote.navigate", () => ({ direction: "next" }));
  aliasCommandWithArgs("footnotes.prevFootnote", "footnote.navigate", () => ({ direction: "previous" }));

  // View / pagination / zoom
  aliasCommandWithArgs("view.pagination.mode.paged", "view.paginationMode.set", () => ({ mode: "paged" }));
  aliasCommandWithArgs("view.pagination.mode.continuous", "view.paginationMode.set", () => ({ mode: "continuous" }));
  aliasCommand("view.pagination.mode", "view.paginationMode.openMenu");
};

applyRibbonAliases();

const collectNestedControls = (control: ControlConfig): ControlConfig[] => {
  const nested: ControlConfig[] = [];
  if (Array.isArray(control.controls)) nested.push(...control.controls);
  if (Array.isArray(control.menu)) nested.push(...control.menu);
  if (Array.isArray(control.items)) nested.push(...control.items);
  if (control.gallery && Array.isArray(control.gallery.controls)) {
    nested.push(...control.gallery.controls);
  }
  return nested;
};

const collectTabCommandIds = (tab: TabConfig): Set<string> => {
  const ids = new Set<string>();
  const traverse = (control: ControlConfig) => {
    if (control.command?.id) {
      const resolved = resolveRibbonCommandId(control.command as { id: string; args?: Record<string, unknown> });
      ids.add(resolved);
    }
    collectNestedControls(control).forEach(traverse);
  };
  tab.groups?.forEach((group) => {
    group.clusters?.forEach((cluster) => {
      cluster.controls?.forEach(traverse);
    });
  });
  return ids;
};

const createMissingCommandPlaceholder = (id: string): CommandHandler => {
  const handler: CommandHandler = (_editor, args) => {
    console.warn(`[Ribbon] missing command invoked: ${id}`, { args });
    showPlaceholderDialog(id, "This command is not implemented yet.");
  };
  (handler as CommandHandler & { __missing?: boolean }).__missing = true;
  return handler;
};

const registerMissingCommands = (): void => {
  const tabs = [
    homeTab,
    insertTab,
    layoutTab,
    referencesTab,
    reviewTab,
    aiTab,
    viewTab
  ] as unknown as TabConfig[];
  const ids = new Set<string>();
  tabs.forEach((tab) => {
    collectTabCommandIds(tab).forEach((id) => ids.add(id));
  });
  ids.forEach((id) => {
    if (id in commandMap) return;
    commandMap[id] = createMissingCommandPlaceholder(id);
  });
};

registerMissingCommands();

