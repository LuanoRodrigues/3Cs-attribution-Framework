import type { Editor } from "@tiptap/core";
import { DOMParser as PMDOMParser, Fragment } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import sanitizeHtml from "sanitize-html";
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
import {
  ensureReferencesLibrary,
  upsertReferenceItems,
  getReferencesLibrarySync,
  refreshReferencesLibrary,
  pushRecentReference,
  type ReferenceItem
} from "../ui/references/library.ts";
import { getHostContract } from "../ui/host_contract.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import { createSearchPanel } from "../ui/search_panel.ts";
import { createAISettingsPanel, getAiSettings, type AiSettingsPanelController } from "../ui/ai_settings.ts";
import {
  openRibbonColorDialog,
  openParagraphSpacingDialog,
  openBordersDialog,
  openTextEffectsDialog,
  openSortDialog,
  openColumnsDialog,
  openLinkDialog,
  openCopyLinkDialog,
  openBookmarkManagerDialog,
  openEquationDialog,
  openSymbolDialog,
  openSingleInputDialog,
  openAddSourceDialog,
  openFileImportDialog,
  openCslManageDialog,
  openTocAddTextDialog,
  openTocUpdateDialog,
  openToaExportDialog,
  openReferenceManagerDialog,
  openReferenceConflictDialog,
  showRibbonToast,
  pushRecentColor
} from "../ui/ribbon_dialogs.ts";
import {
  openAccessibilityPopover,
  openTranslatePopover,
  openProofingLanguagePopover,
  openCommentsDeletePopover,
  openMarkupPopover,
  openRestrictEditingPopover,
  openInfoPopover
} from "../ui/review_dialogs.ts";
import { runLexiconCommand, closeLexiconPopup } from "../ui/lexicon";
import { openVersionHistoryModal } from "../ui/version_history_modal.ts";
import { buildLlmCacheKey, getLlmCacheEntry, setLlmCacheEntry } from "../ui/llm_cache.ts";
import { allocateSectionId, parseSectionMeta, serializeSectionMeta } from "../editor/section_state.ts";
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
let citeprocModulePromise: Promise<typeof import("../csl/citeproc.ts")> | null = null;
const loadCiteprocModule = async () => {
  if (!citeprocModulePromise) {
    citeprocModulePromise = import("../csl/citeproc.ts");
  }
  return citeprocModulePromise;
};
type CiteprocModule = typeof import("../csl/citeproc.ts");
type CiteprocRenderResult = ReturnType<CiteprocModule["renderCitationsAndBibliographyWithCiteproc"]>;

let directQuoteLookupModulePromise: Promise<typeof import("../ui/direct_quote_lookup.ts")> | null = null;
const loadDirectQuoteLookupModule = async () => {
  if (!directQuoteLookupModulePromise) {
    directQuoteLookupModulePromise = import("../ui/direct_quote_lookup.ts");
  }
  return directQuoteLookupModulePromise;
};

const openDirectQuoteLookupPanelLazy = (handle: EditorHandle | null) => {
  if (!handle) return;
  void loadDirectQuoteLookupModule()
    .then(({ openDirectQuoteLookupPanel }) => {
      openDirectQuoteLookupPanel(handle);
    })
    .catch((error) => {
      console.error("[DirectQuote] lazy load failed", error);
    });
};
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

const getEditorHandle = (): EditorHandle | null => {
  const handle = (window as typeof window & { leditor?: EditorHandle }).leditor;
  return handle ?? null;
};

const PREF_AUTO_LINK = "leditor.autoLink";
const PREF_PASTE_AUTO_CLEAN = "leditor.pasteAutoClean";
const PREF_EVENT_NAME = "leditor:ribbon-preferences";

const readBoolPref = (key: string, fallback = false): boolean => {
  try {
    const raw = window.localStorage?.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw.toLowerCase() === "true";
  } catch {
    return fallback;
  }
};

const writeBoolPref = (key: string, value: boolean): void => {
  try {
    window.localStorage?.setItem(key, value ? "1" : "0");
  } catch {
    // ignore
  }
};

const toggleBoolPref = (key: string, fallback = false): boolean => {
  const next = !readBoolPref(key, fallback);
  writeBoolPref(key, next);
  return next;
};

const emitPrefChange = (): void => {
  try {
    window.dispatchEvent(new CustomEvent(PREF_EVENT_NAME));
  } catch {
    // ignore
  }
};

const PREF_TRANSLATE_LANG = "leditor.translate.language";

const readTranslateLanguage = (): string => {
  try {
    return window.localStorage?.getItem(PREF_TRANSLATE_LANG) ?? "Spanish";
  } catch {
    return "Spanish";
  }
};

const writeTranslateLanguage = (value: string): void => {
  try {
    window.localStorage?.setItem(PREF_TRANSLATE_LANG, value);
  } catch {
    // ignore
  }
};

const setDocumentFromPlainText = (editor: Editor, text: string) => {
  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }));
  const doc = {
    type: "doc",
    content: [
      {
        type: "page",
        content: paragraphs.length ? paragraphs : [{ type: "paragraph" }]
      }
    ]
  };
  editor.commands.setContent(doc);
};

const runAiTranslation = async (editor: Editor, scope: "selection" | "document", language: string) => {
  const host = getHostAdapter();
  if (!host?.agentRequest) {
    showRibbonToast("AI host bridge unavailable.");
    return;
  }
  if (!language) return;
  const settings = getAiSettings();
  if (scope === "selection") {
    const { from, to } = editor.state.selection;
    if (from === to) {
      showRibbonToast("Select text to translate.");
      return;
    }
    const original = editor.state.doc.textBetween(from, to, " ");
    const instruction = `Translate the TARGET TEXT into ${language}. Return replaceSelection.`;
    const payload = {
      scope: "selection" as const,
      instruction,
      selection: { from, to, text: original },
      history: [],
      settings
    };
    const cacheKey = buildLlmCacheKey({
      fn: "translate.selection",
      provider: settings.provider,
      payload
    });
    const cached = getLlmCacheEntry(cacheKey);
    let result: any = cached?.value ?? null;
    if (!result) {
      const requestId = `translate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      result = await host.agentRequest({ requestId, payload });
      if (result?.success) {
        setLlmCacheEntry({ key: cacheKey, fn: "translate.selection", value: result, meta: result?.meta });
      }
    }
    if (!result?.success) {
      showRibbonToast(result?.error ? String(result.error) : "Translation failed.");
      return;
    }
    const ops = Array.isArray(result.operations)
      ? (result.operations as Array<{ op: string; text?: string }>)
      : [];
    const replaceOp = ops.find((op) => op && op.op === "replaceSelection" && typeof op.text === "string") as
      | { op: "replaceSelection"; text: string }
      | undefined;
    const translated = replaceOp?.text ?? (typeof result.applyText === "string" ? result.applyText : result.assistantText);
    const next = String(translated || "").trim();
    if (!next) return;
    chainWithSafeFocus(editor).insertContentAt({ from, to }, next).run();
    return;
  }
  const original = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n\n");
  const instruction = `Translate the DOCUMENT TEXT into ${language}. Return replaceDocument with paragraphs separated by blank lines.`;
  const payload = {
    scope: "document" as const,
    instruction,
    document: { text: original },
    history: [],
    settings
  };
  const cacheKey = buildLlmCacheKey({
    fn: "translate.document",
    provider: settings.provider,
    payload
  });
  const cached = getLlmCacheEntry(cacheKey);
  let result: any = cached?.value ?? null;
  if (!result) {
    const requestId = `translate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    result = await host.agentRequest({ requestId, payload });
    if (result?.success) {
      setLlmCacheEntry({ key: cacheKey, fn: "translate.document", value: result, meta: result?.meta });
    }
  }
  if (!result?.success) {
    showRibbonToast(result?.error ? String(result.error) : "Translation failed.");
    return;
  }
  const ops = Array.isArray(result.operations)
    ? (result.operations as Array<{ op: string; text?: string }>)
    : [];
  const replaceDoc = ops.find((op) => op && op.op === "replaceDocument" && typeof op.text === "string") as
    | { op: "replaceDocument"; text: string }
    | undefined;
  const translated = replaceDoc?.text ?? (typeof result.applyText === "string" ? result.applyText : result.assistantText);
  const next = String(translated || "").trim();
  if (!next) return;
  setDocumentFromPlainText(editor, next);
};

const tryExecHandleCommand = (name: string, args?: any): boolean => {
  const handle = getEditorHandle();
  if (!handle?.execCommand) return false;
  try {
    handle.execCommand(name as any, args);
    return true;
  } catch {
    return false;
  }
};

const readClipboardHtml = async (): Promise<string | null> => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    return null;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes("text/html")) continue;
      const blob = await item.getType("text/html");
      return await blob.text();
    }
  } catch {
    return null;
  }
  return null;
};

const sanitizeClipboardHtml = (html: string): string => {
  const sanitized = sanitizeHtml(html, SANITIZE_OPTIONS).trim();
  return sanitized || "";
};

const downloadTextFile = (filename: string, content: string, mime = "text/plain"): void => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 0);
};

type MarkerEntry = { term: string; count: number };

const collectMarkerEntries = (doc: ProseMirrorNode, kind: "index" | "toa"): MarkerEntry[] => {
  const counts = new Map<string, number>();
  const pattern = new RegExp(`\\[\\[${kind}:([^\\]]+)\\]\\]`, "gi");
  doc.descendants((node) => {
    if (!node.isText) return true;
    const text = node.text ?? "";
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const term = String(match[1] ?? "").trim();
      if (!term) continue;
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    return true;
  });
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => a.term.localeCompare(b.term));
};

const insertIndexSection = (editor: Editor, title: string, entries: MarkerEntry[]): void => {
  const heading = {
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: title }]
  };
  const items = entries.length
    ? entries.map((entry) => ({
        type: "paragraph",
        content: [{ type: "text", text: `${entry.term} ..... ${entry.count}` }]
      }))
    : [
        {
          type: "paragraph",
          content: [{ type: "text", text: "No entries found." }]
        }
      ];
  const insertPos = editor.state.doc.content.size;
  editor.commands.insertContentAt(insertPos, [heading, ...items]);
};

const looksLikeUrl = (value: string): boolean => /^(https?:\/\/|mailto:|file:)/i.test(value.trim());

const resolveLinkHref = (editor: Editor): string => {
  const attrs = editor.getAttributes("link") as { href?: unknown } | null;
  const href = typeof attrs?.href === "string" ? attrs.href.trim() : "";
  if (href) return href;
  const { from, to } = editor.state.selection;
  if (from === to) return "";
  const text = editor.state.doc.textBetween(from, to, " ").trim();
  return looksLikeUrl(text) ? text : "";
};

let trackChangesSnapshot: { active?: boolean; pendingChanges?: unknown[] } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("leditor:track-changes", (event) => {
    const detail = (event as CustomEvent).detail as { active?: boolean; pendingChanges?: unknown[] } | undefined;
    trackChangesSnapshot = detail ?? null;
  });
}

const applyTemplateStyles = (editor: Editor, template: TemplateDefinition): void => {
  const docJson = template.document as any;
  const docAttrs = docJson?.attrs && typeof docJson.attrs === "object" ? docJson.attrs : null;
  let refreshCitations = false;

  if (docAttrs && typeof docAttrs.citationStyleId === "string") {
    const nextStyle = docAttrs.citationStyleId.trim();
    if (nextStyle) {
      const current = typeof editor.state.doc.attrs?.citationStyleId === "string" ? editor.state.doc.attrs.citationStyleId : "";
      if (current.trim().toLowerCase() !== nextStyle.trim().toLowerCase()) {
        applyCitationStyleToDoc(editor, nextStyle);
        refreshCitations = true;
      }
    }
  }
  if (docAttrs && typeof docAttrs.citationLocale === "string") {
    const nextLocale = docAttrs.citationLocale.trim();
    if (nextLocale) {
      const current = typeof editor.state.doc.attrs?.citationLocale === "string" ? editor.state.doc.attrs.citationLocale : "";
      if (current.trim() !== nextLocale) {
        editor.view.dispatch(editor.state.tr.setDocAttribute("citationLocale", nextLocale));
        refreshCitations = true;
      }
    }
  }
  if (refreshCitations) {
    void refreshCitationsAndBibliography(editor);
  }

  const metadata = (template as any).metadata as Record<string, unknown> | undefined;
  const defaults = (metadata?.documentDefaults as Record<string, unknown> | undefined) ?? undefined;
  if (defaults && typeof defaults === "object") {
    const fontFamily = typeof (defaults as any).fontFamily === "string" ? ((defaults as any).fontFamily as string).trim() : "";
    const fontSizePx = typeof (defaults as any).fontSizePx === "number" ? (defaults as any).fontSizePx : NaN;
    const textColor = typeof (defaults as any).textColor === "string" ? ((defaults as any).textColor as string).trim() : "";
    const headingColor = typeof (defaults as any).headingColor === "string" ? ((defaults as any).headingColor as string).trim() : "";
    const markFontFamily = fontFamily ? editor.schema.marks.fontFamily?.create({ fontFamily }) : null;
    const markFontSize = Number.isFinite(fontSizePx) ? editor.schema.marks.fontSize?.create({ fontSize: fontSizePx }) : null;
    const markTextColor = textColor ? editor.schema.marks.textColor?.create({ color: textColor }) : null;
    const markHeadingColor = headingColor ? editor.schema.marks.textColor?.create({ color: headingColor }) : null;

    // Apply text marks to paragraph ranges only (avoid overriding heading sizing).
    if (markFontFamily || markFontSize || markTextColor) {
      const mtFamily = editor.schema.marks.fontFamily;
      const mtSize = editor.schema.marks.fontSize;
      const mtColor = editor.schema.marks.textColor;
      let tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        const isParagraph = node.type.name === "paragraph";
        const isHeading = node.type.name === "heading";
        if (!isParagraph && !isHeading) return true;
        const from = pos + 1;
        const to = pos + node.nodeSize - 1;
        if (markFontFamily && mtFamily && isParagraph) {
          tr = tr.removeMark(from, to, mtFamily).addMark(from, to, markFontFamily);
        }
        if (markFontSize && mtSize && isParagraph) {
          tr = tr.removeMark(from, to, mtSize).addMark(from, to, markFontSize);
        }
        if (markTextColor && mtColor && isParagraph) {
          tr = tr.removeMark(from, to, mtColor).addMark(from, to, markTextColor);
        }
        if (markHeadingColor && mtColor && isHeading) {
          tr = tr.removeMark(from, to, mtColor).addMark(from, to, markHeadingColor);
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

const buildBibliographyEntryParagraphs = async (
  editor: Editor,
  itemKeys: string[],
  meta: DocCitationMeta
): Promise<ProseMirrorNode[]> => {
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
    const { renderBibliographyEntriesWithCiteproc } = await loadCiteprocModule();
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

const insertReferencesAsNewLastPages = async (
  editor: Editor,
  headingText: string,
  itemKeys: string[]
): Promise<void> => {
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
  const entryNodes = await buildBibliographyEntryParagraphs(editor, itemKeys, meta);
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
  result.itemKeys.forEach((key) => {
    if (key) {
      pushRecentReference(key);
    }
  });
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
  const hasA4Layout = Boolean(
    document.querySelector(".leditor-page-stack") ||
      document.querySelector(".leditor-page-overlays") ||
      document.querySelector(".leditor-a4-canvas")
  );
  if (hasA4Layout) {
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

const handleInsertDirectCitation = (editor: Editor, args?: any) => {
  const itemKey = String(args?.itemKey ?? args?.dqid ?? "").trim();
  if (!itemKey) {
    window.alert("Missing citation key.");
    return;
  }
  const page = Number.isFinite(args?.page) ? Number(args.page) : null;
  const entry = {
    itemKey,
    title: typeof args?.title === "string" ? args.title : undefined,
    author: typeof args?.author === "string" ? args.author : undefined,
    year: typeof args?.year === "string" ? args.year : undefined,
    source: typeof args?.source === "string" ? args.source : undefined,
    dqid: typeof args?.dqid === "string" ? args.dqid : itemKey
  };
  upsertReferenceItems([entry]);

  const selectionSnapshot = (args?.selectionSnapshot as StoredSelection | undefined) ?? pickStableSelectionSnapshot(editor).selectionSnapshot;
  const existing = findCitationInSelection(editor);
  const citationId = (existing?.node.attrs?.citationId as string | null) ?? generateCitationId();
  const result: CitationPickerResult = {
    itemKeys: [itemKey],
    items: [
      {
        itemKey,
        locator: page != null ? String(page) : null,
        label: page != null ? "page" : null
      }
    ],
    options: {}
  };
  insertCitationNode(editor, result, citationId, existing, selectionSnapshot);
  const styleId = editor.state.doc.attrs?.citationStyleId;
  const noteKind = typeof styleId === "string" ? resolveNoteKind(styleId) : null;
  void refreshCitationsAndBibliography(editor).then(() => {
    if (noteKind === "footnote" && !existing) {
      focusFootnoteById(`fn-${citationId}`);
    }
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
      void insertReferencesAsNewLastPages(editor, label, keys);
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
          const rawTitle = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
          const rendered = typeof node.attrs?.renderedHtml === "string" ? node.attrs.renderedHtml : "";
          const title = rawTitle || (rendered ? stripHtml(rendered) : "");
          const footnoteId = `fn-${citationId}`;
          const footnote = footnoteNode.create(
            { footnoteId, kind: noteKind, citationId, text: "Citation", title: title || null },
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
    let citeproc: CiteprocModule | null = null;
    try {
      citeproc = await loadCiteprocModule();
      await citeproc.ensureCslStyleAvailable(styleId);
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

    let rendered: CiteprocRenderResult | null = null;
    if (citeproc) {
      try {
        rendered = citeproc.renderCitationsAndBibliographyWithCiteproc({
          meta,
          citations: citationNodes.map((c) => ({ citationId: c.citationId, items: c.items, noteIndex: c.noteIndex })),
          additionalItemKeys
        });
      } catch (error) {
        console.error("[References] citeproc update failed; falling back to simplified renderer", error);
      }
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
      const titleById = new Map<string, string>();
      const updatedCitationNodes = extractCitationNodes(editor.state.doc);
      updatedCitationNodes.forEach((node) => {
        renderedById.set(node.citationId, node.renderedHtml);
        const explicitTitle = typeof (node as any).title === "string" ? String((node as any).title).trim() : "";
        const derivedTitle = explicitTitle || (node.renderedHtml ? stripHtml(node.renderedHtml) : "");
        if (derivedTitle) titleById.set(node.citationId, derivedTitle);
      });
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
            const title = titleById.get(entry.citationId) ?? "";
            const footnoteId =
              typeof entry.node.attrs?.footnoteId === "string" ? String(entry.node.attrs.footnoteId).trim() : "";
            const kind = typeof entry.node.attrs?.kind === "string" ? String(entry.node.attrs.kind) : "footnote";
            if (footnoteId) contentByFootnoteId.set(footnoteId, { text: contentText, kind });
            return { ...entry, footnoteId, contentText, title };
          })
          .sort((a, b) => b.pos - a.pos)
          .forEach((entry) => {
            if (!footnoteType) return;
            const live = trNotes.doc.nodeAt(entry.pos);
            if (!live || live.type !== footnoteType) return;
            const prevText = typeof (live.attrs as any)?.text === "string" ? String((live.attrs as any).text) : "";
            const prevTitle = typeof (live.attrs as any)?.title === "string" ? String((live.attrs as any).title).trim() : "";
            const nextTitle = entry.title ? String(entry.title).trim() : "";
            if (prevText === entry.contentText && prevTitle === nextTitle) return;
            trNotes.setNodeMarkup(
              entry.pos,
              live.type,
              { ...(live.attrs as any), text: entry.contentText, title: nextTitle || null },
              live.marks
            );
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

type ReferenceConflict = {
  itemKey: string;
  existing: ReferenceItem;
  incoming: ReferenceItem;
};

const splitReferenceImport = (items: ReferenceItem[]) => {
  const library = getReferencesLibrarySync();
  const existingKeys = new Set(Object.keys(library.itemsByKey));
  const seen = new Map<string, ReferenceItem>();
  Object.values(library.itemsByKey).forEach((item) => {
    seen.set(item.itemKey, item);
  });
  const unique: ReferenceItem[] = [];
  const duplicates: ReferenceConflict[] = [];
  items.forEach((raw) => {
    const key = normalizeReferenceItemKey(raw.itemKey ?? "");
    if (!key) return;
    const incoming = { ...raw, itemKey: key };
    const existing = seen.get(key);
    if (existing) {
      duplicates.push({ itemKey: key, existing, incoming });
      return;
    }
    unique.push(incoming);
    seen.set(key, incoming);
  });
  return { unique, duplicates, existingKeys };
};

const buildReferenceItemKey = (seed: string, existing: Record<string, unknown>): string => {
  const cleaned = String(seed || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const base = (cleaned || "REF").slice(0, 8);
  let key = base;
  let i = 1;
  while (existing[key]) {
    const suffix = String(i);
    key = (base.slice(0, Math.max(1, 8 - suffix.length)) + suffix).slice(0, 8);
    i += 1;
  }
  return key;
};

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

const UNDERLINE_STYLE_VALUES = new Set(["single", "double", "dotted", "dashed"]);
const normalizeUnderlineStyle = (value?: unknown): "single" | "double" | "dotted" | "dashed" => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (UNDERLINE_STYLE_VALUES.has(normalized)) {
      return normalized as "single" | "double" | "dotted" | "dashed";
    }
  }
  return "single";
};

const isSelectableObjectNode = (node: ProseMirrorNode): boolean => {
  if (node.isText) return false;
  if (node.type.name === "table") return true;
  if (node.isAtom || node.isLeaf) return true;
  return false;
};

const findNextSelectableObject = (
  doc: ProseMirrorNode,
  from: number,
  to: number
): number | null => {
  let found: number | null = null;
  doc.nodesBetween(from, to, (node, pos) => {
    if (found !== null) return false;
    if (isSelectableObjectNode(node)) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
};

const serializeMarks = (marks: readonly any[] | null | undefined): string => {
  if (!marks || marks.length === 0) return "";
  return marks
    .map((mark) => {
      const attrs = mark?.attrs ? JSON.stringify(mark.attrs) : "";
      return `${mark?.type?.name ?? "mark"}:${attrs}`;
    })
    .sort()
    .join("|");
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
import { getTemplateById, type TemplateDefinition } from "../templates/index.ts";
import { toggleStylesPane } from "../ui/styles_pane.ts";
import { openStyleMiniApp } from "../ui/style_mini_app.ts";
import {
  getCurrentPageSize,
  getMarginValues,
  getLayoutColumns,
  getColumnGapIn,
  getColumnWidthIn,
  setPageMargins,
  setPageOrientation,
  setPageSize,
  setSectionColumns
} from "../ui/layout_settings.ts";
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
  id?: string;
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

const buildTocId = (): string => {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `toc-${crypto.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `toc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const ensureHeadingTocIds = (editor: Editor): void => {
  const headingType = editor.schema.nodes.heading;
  if (!headingType) return;
  const used = new Set<string>();
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((node, pos) => {
    if (node.type !== headingType) return true;
    const raw = typeof (node.attrs as any)?.tocId === "string" ? String((node.attrs as any).tocId).trim() : "";
    if (raw && !used.has(raw)) {
      used.add(raw);
      return true;
    }
    let nextId = "";
    while (!nextId || used.has(nextId)) {
      nextId = buildTocId();
    }
    used.add(nextId);
    tr.setNodeMarkup(pos, headingType, { ...node.attrs, tocId: nextId });
    changed = true;
    return true;
  });
  if (changed) {
    editor.view.dispatch(tr);
  }
};

const collectHeadingEntries = (editor: Editor): TocEntry[] => {
  const entries: TocEntry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      if (node.attrs?.tocExclude) {
        return true;
      }
      const tocId = typeof (node.attrs as any)?.tocId === "string" ? String((node.attrs as any).tocId).trim() : "";
      const level = Number(node.attrs?.level ?? 1);
      const text = (node.textContent ?? "").trim();
      if (text.length === 0) {
        return true;
      }
      entries.push({
        ...(tocId ? { id: tocId } : {}),
        text,
        level: Math.max(1, Math.min(6, level)),
        pos
      });
    }
    return true;
  });
  return entries;
};

const normalizeTocEntries = (value: unknown): TocEntry[] => {
  if (!Array.isArray(value)) return [];
  const entries: TocEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = typeof (item as TocEntry).id === "string" ? (item as TocEntry).id : undefined;
    const text = typeof (item as TocEntry).text === "string" ? (item as TocEntry).text : "";
    const level = Number((item as TocEntry).level);
    const pos = Number((item as TocEntry).pos);
    entries.push({
      ...(id ? { id } : {}),
      text: text.trim() || "Untitled",
      level: Number.isFinite(level) ? Math.max(1, Math.min(6, Math.floor(level))) : 1,
      pos: Number.isFinite(pos) ? Math.max(0, Math.floor(pos)) : 0
    });
  }
  return entries;
};

const findSelectionHeadingNode = (editor: Editor): { node: ProseMirrorNode; pos: number } | null => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "heading" || node.type.name === "paragraph") {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
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

const updateTocNodes = (
  editor: Editor,
  entries: TocEntry[],
  options?: { mode?: "pageNumbers" | "all" }
): boolean => {
  const tocNode = editor.schema.nodes.toc;
  if (!tocNode) {
    return false;
  }
  const tr = editor.state.tr;
  let updated = false;
  const mode = options?.mode ?? "all";
  editor.state.doc.descendants((node, pos) => {
    if (node.type === tocNode) {
      let nextEntries = entries;
      if (mode === "pageNumbers") {
        const existing = normalizeTocEntries(node.attrs?.entries);
        const map = new Map<string, TocEntry[]>();
        const idMap = new Map<string, TocEntry>();
        entries.forEach((entry) => {
          if (entry.id) {
            idMap.set(entry.id, entry);
          }
          const key = `${entry.level}|${entry.text.toLowerCase()}`;
          const list = map.get(key) ?? [];
          list.push(entry);
          map.set(key, list);
        });
        nextEntries = existing.map((entry) => {
          if (entry.id && idMap.has(entry.id)) {
            const match = idMap.get(entry.id);
            if (match) {
              return { ...entry, pos: match.pos };
            }
          }
          const key = `${entry.level}|${entry.text.toLowerCase()}`;
          const list = map.get(key);
          if (list && list.length) {
            const match = list.shift();
            if (match) {
              return { ...entry, pos: match.pos };
            }
          }
          return entry;
        });
      }
      tr.setNodeMarkup(pos, tocNode, { ...node.attrs, entries: nextEntries });
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

const parseLengthToIn = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return null;
  if (trimmed.endsWith("in")) return numeric;
  if (trimmed.endsWith("cm")) return numeric / 2.54;
  if (trimmed.endsWith("mm")) return numeric / 25.4;
  if (trimmed.endsWith("px")) return numeric / 96;
  return numeric;
};

const getContentWidthIn = (): number | null => {
  const page = getCurrentPageSize();
  if (!page) return null;
  const widthIn = page.widthMm / 25.4;
  const margins = getMarginValues();
  const leftIn = parseLengthToIn(margins.left) ?? 0;
  const rightIn = parseLengthToIn(margins.right) ?? 0;
  const content = widthIn - leftIn - rightIn;
  return Number.isFinite(content) && content > 0 ? content : null;
};

const parseOptionalNumber = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return numeric;
};

const applySectionColumnSettings = (
  editor: Editor,
  payload: { count: number; gapIn?: number | null; widthIn?: number | null }
): boolean => {
  if (typeof window !== "undefined") {
    (window as any).__leditorDisableColumns = payload.count > 1 ? false : true;
  }
  const normalizedCount = Math.max(1, Math.min(4, Math.floor(payload.count))) as 1 | 2 | 3 | 4;
  const { from } = editor.state.selection;
  let target: { pos: number; node: ProseMirrorNode } | null = null;
  editor.state.doc.nodesBetween(0, from, (node, pos) => {
    if (node.type.name !== "page_break") return true;
    const kind = typeof node.attrs?.kind === "string" ? node.attrs.kind : "";
    if (kind.startsWith("section_")) {
      target = { pos, node };
    }
    return true;
  });
  if (!target) {
    const breakNode = editor.schema.nodes.page_break;
    if (!breakNode) return false;
    const sectionId = allocateSectionId();
    const meta = {
      ...parseSectionMeta(undefined),
      columns: normalizedCount,
      columnGapIn: payload.gapIn === null ? undefined : payload.gapIn,
      columnWidthIn: payload.widthIn === undefined ? null : payload.widthIn
    };
    const node = breakNode.create({
      kind: "section_continuous",
      sectionId,
      sectionSettings: serializeSectionMeta(meta)
    });
    const tr = editor.state.tr.insert(from, node);
    const nextPos = Math.min(tr.doc.content.size, from + node.nodeSize);
    tr.setSelection(TextSelection.create(tr.doc, nextPos));
    editor.view.dispatch(tr);
    return true;
  }
  const ensured = target as { pos: number; node: ProseMirrorNode };
  const meta = parseSectionMeta(ensured.node.attrs?.sectionSettings);
  const nextMeta = { ...meta, columns: normalizedCount };
  if (payload.gapIn !== undefined) {
    (nextMeta as any).columnGapIn = payload.gapIn === null ? undefined : payload.gapIn;
  }
  if (payload.widthIn !== undefined) {
    (nextMeta as any).columnWidthIn = payload.widthIn;
  }
  const tr = editor.state.tr.setNodeMarkup(ensured.pos, undefined, {
    ...ensured.node.attrs,
    sectionSettings: serializeSectionMeta(nextMeta)
  });
  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }
  return true;
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
  ExportDOCX(_editor, args) {
    const exporter = (window as any).__leditorAutoExportDOCX as undefined | ((opts?: any) => Promise<any>);
    if (typeof exporter !== "function") {
      showPlaceholderDialog("Export DOCX", "ExportDOCX handler is unavailable.");
      return;
    }
    void exporter(args?.options ?? {}).catch(() => {
      // ignore
    });
  },
  ExportPdf(_editor, args) {
    const exporter = (window as any).__leditorAutoExportPDF as undefined | ((opts?: any) => Promise<any>);
    if (typeof exporter !== "function") {
      showPlaceholderDialog("Export PDF", "ExportPDF handler is unavailable.");
      return;
    }
    void exporter(args?.options ?? {}).catch(() => {
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
  Underline(editor, args) {
    const rawStyle = typeof (args as any)?.style === "string" ? (args as any).style : null;
    if (rawStyle) {
      const style = normalizeUnderlineStyle(rawStyle);
      const current = editor.getAttributes("underline") as { underlineColor?: unknown };
      const underlineColor = typeof current?.underlineColor === "string" ? current.underlineColor : null;
      chainWithSafeFocus(editor).setMark("underline", { underlineStyle: style, underlineColor }).run();
      return;
    }
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
  PasteClean(editor) {
    safeFocusEditor(editor);
    void (async () => {
      const html = await readClipboardHtml();
      if (html) {
        const sanitized = sanitizeClipboardHtml(html);
        if (sanitized) {
          chainWithSafeFocus(editor).insertContent(sanitized).run();
          return;
        }
      }
      const fallback = await readClipboardText();
      if (fallback) {
        chainWithSafeFocus(editor).insertContent(fallback).run();
      }
    })();
  },
  PasteAutoCleanToggle() {
    toggleBoolPref(PREF_PASTE_AUTO_CLEAN, false);
    emitPrefChange();
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
  "view.pagination.reflow"(editor) {
    try {
      (window as any).__leditorForcePaginationReflow = true;
    } catch {
      // ignore
    }
    try {
      const viewDom = (editor?.view?.dom as HTMLElement | null) ?? null;
      viewDom?.dispatchEvent(
        new CustomEvent("leditor:pagination-request", { bubbles: true, detail: { reason: "reflow" } })
      );
    } catch {
      // ignore
    }
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
  "agent.sidebar.toggle"() {
    const handle = window.leditor;
    if (!handle) {
      openInfoPopover({ title: "Agent", message: "Agent sidebar unavailable." });
      return;
    }
    handle.execCommand("agent.sidebar.toggle");
  },
  "agent.view.open"(_editor, args?: { view?: string }) {
    const handle = window.leditor;
    if (!handle) {
      openInfoPopover({ title: "Agent", message: "Agent sidebar unavailable." });
      return;
    }
    handle.execCommand("agent.view.open", args);
  },
  "agent.action"(_editor, args?: { id?: string }) {
    const handle = window.leditor;
    if (!handle) {
      openInfoPopover({ title: "Agent", message: "Agent sidebar unavailable." });
      return;
    }
    handle.execCommand("agent.action", args);
  },
  "agent.sections.runAll"() {
    const handle = window.leditor;
    if (!handle) {
      openInfoPopover({ title: "Agent", message: "Agent sidebar unavailable." });
      return;
    }
    handle.execCommand("agent.sections.runAll");
  },
  "agent.dictionary.open"(editor, args?: { mode?: string }) {
    const handle = window.leditor;
    if (!handle) {
      openInfoPopover({ title: "Dictionary", message: "Dictionary sidebar unavailable." });
      return;
    }
    handle.execCommand("agent.dictionary.open", args);
  },
  "lexicon.define"(editor) {
    const handle = window.leditor;
    if (handle) {
      try {
        handle.execCommand("agent.dictionary.open", { mode: "definition" });
        return;
      } catch {
        // ignore
      }
    }
    void runLexiconCommand(editor, "definition");
  },
  "lexicon.explain"(editor) {
    const handle = window.leditor;
    if (handle) {
      try {
        handle.execCommand("agent.dictionary.open", { mode: "explain" });
        return;
      } catch {
        // ignore
      }
    }
    void runLexiconCommand(editor, "explain");
  },
  "lexicon.synonyms"(editor) {
    const handle = window.leditor;
    if (handle) {
      try {
        handle.execCommand("agent.dictionary.open", { mode: "synonyms" });
        return;
      } catch {
        // ignore
      }
    }
    void runLexiconCommand(editor, "synonyms");
  },
  "lexicon.antonyms"(editor) {
    const handle = window.leditor;
    if (handle) {
      try {
        handle.execCommand("agent.dictionary.open", { mode: "antonyms" });
        return;
      } catch {
        // ignore
      }
    }
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
    if (!args || (typeof args.value !== "string" && typeof args.value !== "number")) {
      throw new Error("LineSpacing requires { value }");
    }
    const value = typeof args.value === "number" ? String(args.value) : args.value;
    safeFocusEditor(editor);
    editor.commands.updateAttributes("paragraph", { lineHeight: value });
    editor.commands.updateAttributes("heading", { lineHeight: value });
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
    if (!args || args.value == null) {
      const current = editor.getAttributes("textColor") as { color?: unknown };
      const existing = typeof current?.color === "string" ? current.color : null;
      openRibbonColorDialog({
        title: "Font Color",
        current: existing,
        allowClear: true,
        recentKey: "text",
        onSelect: (color) => {
          if (!color) {
            commandMap.RemoveTextColor(editor);
            return;
          }
          pushRecentColor("text", color);
          chainWithSafeFocus(editor).setMark("textColor", { color }).run();
        }
      });
      return;
    }
    if (args.value === null) {
      commandMap.RemoveTextColor(editor);
      return;
    }
    if (typeof args.value !== "string") {
      throw new Error("TextColor requires { value }");
    }
    pushRecentColor("text", args.value);
    chainWithSafeFocus(editor).setMark("textColor", { color: args.value }).run();
  },
  RemoveTextColor(editor) {
    chainWithSafeFocus(editor).unsetMark("textColor").run();
  },
  HighlightColor(editor, args) {
    if (!args || args.value == null) {
      const current = editor.getAttributes("highlightColor") as { highlight?: unknown };
      const existing = typeof current?.highlight === "string" ? current.highlight : null;
      openRibbonColorDialog({
        title: "Highlight Color",
        current: existing,
        allowClear: true,
        recentKey: "highlight",
        onSelect: (color) => {
          if (!color) {
            commandMap.RemoveHighlightColor(editor);
            return;
          }
          pushRecentColor("highlight", color);
          chainWithSafeFocus(editor).setMark("highlightColor", { highlight: color }).run();
        }
      });
      return;
    }
    if (typeof args.value !== "string") {
      throw new Error("HighlightColor requires { value }");
    }
    pushRecentColor("highlight", args.value);
    chainWithSafeFocus(editor).setMark("highlightColor", { highlight: args.value }).run();
  },
  RemoveHighlightColor(editor) {
    chainWithSafeFocus(editor).unsetMark("highlightColor").run();
  },
  Link(editor) {
    const current = editor.getAttributes("link").href ?? "";
    openLinkDialog({
      title: "Insert Link",
      current,
      allowClear: Boolean(current),
      onApply: (href) => {
        const chain = chainWithSafeFocus(editor) as any;
        const markChain = (chain.extendMarkRange("link") as any);
        if (!href) {
          markChain.unsetLink().run();
          return;
        }
        markChain.setLink({ href }).run();
      }
    });
  },
  InsertLink(editor, args) {
    const href = typeof args?.href === "string" ? args.href.trim() : "";
    if (href) {
      const chain = chainWithSafeFocus(editor) as any;
      (chain.extendMarkRange("link") as any).setLink({ href }).run();
      return;
    }
    commandMap.Link(editor);
  },
  CopyLink(editor) {
    const href = resolveLinkHref(editor);
    if (!href) {
      showRibbonToast("No link found at selection.");
      return;
    }
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(href)
        .then(() => showRibbonToast("Link copied."))
        .catch(() => openCopyLinkDialog({ href }));
      return;
    }
    openCopyLinkDialog({ href });
  },
  OpenLink(editor) {
    const href = resolveLinkHref(editor);
    if (!href) {
      showRibbonToast("No link found at selection.");
      return;
    }
    window.open(href, "_blank", "noopener");
  },
  AutoLink(editor) {
    const enabled = toggleBoolPref(PREF_AUTO_LINK, false);
    emitPrefChange();
    const { from, to } = editor.state.selection;
    if (from === to) {
      if (!enabled) {
        if (editor.isActive("link")) {
          commandMap.RemoveLink(editor);
        }
        return;
      }
      commandMap.Link(editor);
      return;
    }
    const text = editor.state.doc.textBetween(from, to, " ").trim();
    if (enabled) {
      if (!looksLikeUrl(text)) {
        showRibbonToast("Select a URL to auto-link.");
        return;
      }
      chainWithSafeFocus(editor).setLink({ href: text }).run();
      return;
    }
    if (editor.isActive("link")) {
      commandMap.RemoveLink(editor);
    }
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
  SelectObjects(editor) {
    const { doc, selection } = editor.state;
    const start = Math.min(selection.to, doc.content.size);
    let pos = findNextSelectableObject(doc, start, doc.content.size);
    if (pos === null) {
      pos = findNextSelectableObject(doc, 0, start);
    }
    if (pos === null) {
      showRibbonToast("No selectable objects found.");
      return;
    }
    const tr = editor.state.tr.setSelection(NodeSelection.create(doc, pos));
    editor.view.dispatch(tr);
    editor.view.focus();
  },
  SelectSimilarFormatting(editor) {
    const { doc, selection, storedMarks } = editor.state;
    const marks = storedMarks ?? selection.$from.marks();
    const targetKey = serializeMarks(marks);
    if (!targetKey) {
      showRibbonToast("No formatting to match.");
      return;
    }
    let found: { pos: number; node: ProseMirrorNode } | null = null;
    const scan = (from: number, to: number) => {
      doc.nodesBetween(from, to, (node, pos) => {
        if (found) return false;
        if (!node.isText || !node.text) return true;
        if (serializeMarks(node.marks) === targetKey) {
          found = { pos, node };
          return false;
        }
        return true;
      });
    };
    const start = Math.min(selection.to, doc.content.size);
    scan(start, doc.content.size);
    if (!found) {
      scan(0, start);
    }
    if (!found) {
      showRibbonToast("No similar formatting found.");
      return;
    }
    const match = found as { pos: number; node: ProseMirrorNode };
    const fromPos = match.pos;
    const toPos = match.pos + match.node.nodeSize;
    const tr = editor.state.tr.setSelection(TextSelection.create(doc, fromPos, toPos));
    editor.view.dispatch(tr);
    editor.view.focus();
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
    // Menu-only control; handled by ribbon UI.
  },
  FontEffectsDialog(editor) {
    const shadowAttrs = editor.getAttributes("textShadow") as { shadow?: unknown };
    const outlineAttrs = editor.getAttributes("textOutline") as { stroke?: unknown };
    const shadowCurrent = typeof shadowAttrs.shadow === "string" ? shadowAttrs.shadow : null;
    const outlineCurrent = typeof outlineAttrs.stroke === "string" ? outlineAttrs.stroke : null;
    openTextEffectsDialog({
      shadow: shadowCurrent,
      outline: outlineCurrent,
      onApply: ({ shadow, outline }) => {
        const chain = chainWithSafeFocus(editor);
        if (shadow) {
          chain.setMark("textShadow", { shadow });
        } else {
          chain.unsetMark("textShadow");
        }
        if (outline) {
          chain.setMark("textOutline", { stroke: outline });
        } else {
          chain.unsetMark("textOutline");
        }
        chain.run();
      }
    });
  },
  FontEffectsOutline(editor, args) {
    const override = typeof (args as any)?.stroke === "string" ? String((args as any).stroke) : "";
    const chain = chainWithSafeFocus(editor);
    if (editor.isActive("textOutline")) {
      chain.unsetMark("textOutline").run();
      return;
    }
    if (override.trim()) {
      chain.setMark("textOutline", { stroke: override.trim() }).run();
      return;
    }
    chain.setMark("textOutline").run();
  },
  FontEffectsShadow(editor, args) {
    const override = typeof (args as any)?.shadow === "string" ? String((args as any).shadow) : "";
    const chain = chainWithSafeFocus(editor);
    if (editor.isActive("textShadow")) {
      chain.unsetMark("textShadow").run();
      return;
    }
    if (override.trim()) {
      chain.setMark("textShadow", { shadow: override.trim() }).run();
      return;
    }
    chain.setMark("textShadow").run();
  },
  UnderlineColorPicker(editor, args) {
    const current = editor.getAttributes("underline") as {
      underlineStyle?: unknown;
      underlineColor?: unknown;
    };
    const underlineStyle = normalizeUnderlineStyle(current.underlineStyle);
    const existingColor = typeof current.underlineColor === "string" ? current.underlineColor : null;
    if (args && typeof (args as any).value === "string") {
      const value = String((args as any).value);
      pushRecentColor("underline", value);
      chainWithSafeFocus(editor).setMark("underline", { underlineStyle, underlineColor: value }).run();
      return;
    }
    if (args && (args as any).value === null) {
      if (editor.isActive("underline")) {
        chainWithSafeFocus(editor).setMark("underline", { underlineStyle, underlineColor: null }).run();
      }
      return;
    }
    openRibbonColorDialog({
      title: "Underline Color",
      current: existingColor,
      allowClear: true,
      recentKey: "underline",
      onSelect: (color) => {
        const chain = chainWithSafeFocus(editor);
        if (!color) {
          if (editor.isActive("underline")) {
            chain.setMark("underline", { underlineStyle, underlineColor: null }).run();
          }
          return;
        }
        pushRecentColor("underline", color);
        chain.setMark("underline", { underlineStyle, underlineColor: color }).run();
      }
    });
  },
  ParagraphOptionsDialog() {
    showPlaceholderDialog("Paragraph Options");
  },
  ParagraphSpacingDialog(editor) {
    const block = getBlockAtSelection(editor);
    if (!block) return;
    openParagraphSpacingDialog({
      currentLineHeight: typeof block.attrs?.lineHeight === "string" ? block.attrs.lineHeight : "",
      spaceBefore: typeof block.attrs?.spaceBefore === "number" ? block.attrs.spaceBefore : undefined,
      spaceAfter: typeof block.attrs?.spaceAfter === "number" ? block.attrs.spaceAfter : undefined,
      onApply: ({ lineHeight, spaceBefore, spaceAfter }) => {
        if (lineHeight) {
          commandMap.LineSpacing(editor, { value: lineHeight });
        }
        if (typeof spaceBefore === "number" && Number.isFinite(spaceBefore)) {
          commandMap.SpaceBefore(editor, { valuePx: spaceBefore });
        }
        if (typeof spaceAfter === "number" && Number.isFinite(spaceAfter)) {
          commandMap.SpaceAfter(editor, { valuePx: spaceAfter });
        }
      }
    });
  },
  ParagraphSpacingMenu() {
    // Menu-only control; the ribbon UI handles opening the dropdown.
  },
  ParagraphBordersDialog(editor) {
    const block = getBlockAtSelection(editor);
    if (!block) return;
    const preset = typeof (block.attrs as any)?.borderPreset === "string" ? String((block.attrs as any).borderPreset) : "none";
    const color = typeof (block.attrs as any)?.borderColor === "string" ? String((block.attrs as any).borderColor) : null;
    const width = typeof (block.attrs as any)?.borderWidth === "number" ? Number((block.attrs as any).borderWidth) : null;
    openBordersDialog({
      preset,
      color,
      width,
      onApply: ({ preset: nextPreset, color: nextColor, width: nextWidth }) => {
        commandMap.ParagraphBordersSet(editor, { preset: nextPreset, color: nextColor, width: nextWidth });
      }
    });
  },
  ParagraphBordersMenu() {
    // Menu-only control; the ribbon UI handles opening the dropdown.
  },
  ParagraphBordersSet(editor, args) {
    const presetRaw = typeof (args as any)?.preset === "string" ? (args as any).preset : "none";
    const preset = presetRaw.trim().toLowerCase();
    const allowed = new Set(["none", "bottom", "top", "left", "right", "all", "outside", "inside"]);
    if (!allowed.has(preset)) {
      showRibbonToast("Unknown border preset.");
      return;
    }
    const next = preset === "none" ? null : preset;
    const color = typeof (args as any)?.color === "string" ? String((args as any).color) : undefined;
    const widthRaw = (args as any)?.width;
    const width = typeof widthRaw === "number" ? widthRaw : widthRaw != null ? Number(widthRaw) : undefined;
    const payload: Record<string, unknown> = { borderPreset: next };
    if (typeof color === "string" && color.trim()) {
      payload.borderColor = color.trim();
    }
    if (Number.isFinite(width)) {
      payload.borderWidth = width;
    }
    safeFocusEditor(editor);
    editor.commands.updateAttributes("paragraph", payload);
    editor.commands.updateAttributes("heading", payload);
  },
  ParagraphSort(editor) {
    const { from, to, empty } = editor.state.selection;
    const sortLines = (order: "asc" | "desc") => {
      const text = editor.state.doc.textBetween(from, to, "\n");
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      if (order === "desc") lines.reverse();
      if (!lines.length) return;
      chainWithSafeFocus(editor).insertContentAt({ from, to }, lines.join("\n")).run();
    };
    if (empty) {
      openSortDialog({
        hasSelection: false,
        onApply: () => {
          // no-op
        }
      });
      return;
    }
    openSortDialog({
      hasSelection: true,
      onApply: ({ order }) => sortLines(order)
    });
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
    openLinkDialog({
      title: "Edit Link",
      current,
      allowClear: true,
      onApply: (href) => {
        const chain = chainWithSafeFocus(editor) as any;
        const markChain = (chain.extendMarkRange("link") as any);
        if (!href) {
          markChain.unsetLink().run();
          return;
        }
        markChain.setLink({ href }).run();
      }
    });
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
  InsertTable(editor, args) {
    commandMap.TableInsert(editor, args);
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
  "insert.bookmark.openDialog"(editor, args) {
    commandMap.InsertBookmark(editor, args);
  },
  "insert.bookmark.manage.openDialog"(editor) {
    const bookmarks = collectBookmarks(editor);
    openBookmarkManagerDialog({
      bookmarks,
      onDelete: (id) => {
        const tr = editor.state.tr;
        const positions: Array<{ from: number; to: number }> = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type?.name !== "bookmark") return true;
          const nodeId = typeof (node.attrs as any)?.id === "string" ? String((node.attrs as any).id) : "";
          if (nodeId === id) {
            positions.push({ from: pos, to: pos + node.nodeSize });
          }
          return true;
        });
        if (positions.length === 0) {
          showRibbonToast(`Bookmark "${id}" not found.`);
          return;
        }
        positions
          .sort((a, b) => b.from - a.from)
          .forEach((range) => tr.delete(range.from, range.to));
        if (tr.docChanged) {
          editor.view.dispatch(tr);
          showRibbonToast(`Deleted bookmark "${id}".`);
        }
      }
    });
  },
  "insert.crossReference.openDialog"(editor, args) {
    commandMap.InsertCrossReference(editor, args);
  },
  "insert.crossReference.updateAll"(editor) {
    const bookmarks = collectBookmarks(editor);
    if (!bookmarks.length) {
      showRibbonToast("No bookmarks found.");
      return;
    }
    const labelById = new Map(bookmarks.map((b) => [b.id, b.label || b.id]));
    const tr = editor.state.tr;
    let updated = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type?.name !== "cross_reference") return true;
      const attrs = node.attrs as any;
      const targetId = typeof attrs?.targetId === "string" ? attrs.targetId : "";
      const nextLabel = labelById.get(targetId);
      if (!nextLabel) return true;
      if (attrs.label === nextLabel) return true;
      tr.setNodeMarkup(pos, undefined, { ...attrs, label: nextLabel });
      updated += 1;
      return true;
    });
    if (tr.docChanged) {
      editor.view.dispatch(tr);
    } else {
      showRibbonToast("No cross-references to update.");
    }
    if (updated > 0) {
      showRibbonToast(`Updated ${updated} cross-reference${updated === 1 ? "" : "s"}.`);
    }
  },

  InsertTOC(editor, args) {
    ensureHeadingTocIds(editor);
    const entries = collectHeadingEntries(editor);
    const style =
      typeof args?.id === "string"
        ? args.id
        : typeof args?.style === "string"
          ? args.style
          : "auto1";
    insertTocNode(editor, entries, { style });
  },

  UpdateTOC(editor, args) {
    ensureHeadingTocIds(editor);
    const entries = collectHeadingEntries(editor);
    const mode = args?.mode === "pageNumbers" || args?.mode === "all" ? args.mode : null;
    const runUpdate = (nextMode: "pageNumbers" | "all") => {
      if (!updateTocNodes(editor, entries, { mode: nextMode })) {
        showRibbonToast("No table of contents found to update.");
        return;
      }
      showRibbonToast(nextMode === "pageNumbers" ? "Updated page numbers." : "Updated table of contents.");
    };
    if (!mode) {
      openTocUpdateDialog({ onApply: runUpdate });
      return;
    }
    runUpdate(mode);
  },

  RemoveTOC(editor) {
    removeTocNodes(editor);
  },

  InsertTocHeading(editor, args) {
    const applyLevel = (levelRaw: number) => {
      const level = Math.max(0, Math.min(6, Math.floor(levelRaw)));
      const target = findSelectionHeadingNode(editor);
      if (!target) {
        showRibbonToast("Place the cursor in a paragraph or heading first.");
        return;
      }
      const { node, pos } = target;
      const headingType = editor.schema.nodes.heading;
      if (!headingType) {
        showRibbonToast("Heading styles are unavailable.");
        return;
      }
      const tr = editor.state.tr;
      if (level === 0) {
        if (node.type.name !== "heading") {
          showRibbonToast("Select a heading to exclude from the TOC.");
          return;
        }
        tr.setNodeMarkup(pos, headingType, { ...node.attrs, tocExclude: true });
      } else if (node.type.name === "heading") {
        tr.setNodeMarkup(pos, headingType, { ...node.attrs, level, tocExclude: false });
      } else {
        tr.setNodeMarkup(pos, headingType, { ...node.attrs, level, tocExclude: false });
      }
      if (tr.docChanged) {
        editor.view.dispatch(tr);
      }
    };

    const levelArg =
      typeof args?.level === "number" && Number.isFinite(args.level) ? Math.floor(args.level) : undefined;
    if (levelArg !== undefined) {
      applyLevel(levelArg);
      return;
    }

    const selectionLevel = (() => {
      const target = findSelectionHeadingNode(editor);
      if (!target) return 1;
      if (target.node.type.name === "heading") {
        return target.node.attrs?.tocExclude ? 0 : Number(target.node.attrs?.level ?? 1);
      }
      return 1;
    })();
    openTocAddTextDialog({
      currentLevel: Number.isFinite(selectionLevel) ? selectionLevel : 1,
      onApply: applyLevel
    });
  },

  InsertCitation: handleInsertCitationCommand,
  "citation.insert.openDialog": handleInsertCitationCommand,
  "citation.insert.direct": handleInsertDirectCitation,

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
    openFileImportDialog({
      title: "Import CSL Style",
      accept: ".csl,application/xml,text/xml",
      hint: "Select a CSL style (.csl) file to import.",
      onLoad: (file, xml) => {
        refsInfo("[References] CSL imported", { name: file.name, bytes: xml.length });
        try {
          window.localStorage?.setItem(`leditor.csl.style:${file.name}`, xml);
        } catch {
          // ignore
        }
        showRibbonToast(`Imported CSL style: ${file.name}`);
      }
    });
  },
  'citation.csl.manage.openDialog'() {
    try {
      const keys = Object.keys(window.localStorage || {}).filter((k) => k.startsWith("leditor.csl.style:"));
      const styles = keys.map((k) => k.replace("leditor.csl.style:", ""));
      openCslManageDialog({
        styles,
        onDelete: (name) => {
          const key = `leditor.csl.style:${name}`;
          window.localStorage?.removeItem(key);
          showRibbonToast(`Deleted CSL style: ${name}`);
        }
      });
    } catch {
      showRibbonToast("Unable to manage CSL styles (storage unavailable).");
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
    openAddSourceDialog({
      onApply: (payload) => {
        const itemKey = normalizeReferenceItemKey(payload.itemKey);
        if (!itemKey) {
          showRibbonToast("Item key is required.");
          return;
        }
        upsertReferenceItems([
          {
            itemKey,
            title: payload.title?.trim() || undefined,
            author: payload.author?.trim() || undefined,
            year: payload.year?.trim() || undefined,
            url: payload.url?.trim() || undefined,
            note: payload.note?.trim() || undefined
          }
        ]);
        showRibbonToast(`Added source: ${itemKey}`);
      }
    });
  },
  "citation.manager.openDialog"(editor) {
    void (async () => {
      try {
        await refreshReferencesLibrary();
      } catch {
        // ignore refresh errors
      }
      openReferenceManagerDialog({
        onInsert: (itemKey) => {
          commandMap["citation.insert.direct"](editor, { itemKey });
        },
        onOpenPicker: () => {
          handleInsertCitationCommand(editor);
        },
        onAddSource: () => {
          commandMap["citation.source.add.openDialog"](editor);
        }
      });
    })();
  },
  "citation.placeholder.add.openDialog"(editor) {
    chainWithSafeFocus(editor).insertContent("(citation)").run();
  },
  "citation.import.bibtex.openDialog"() {
    openFileImportDialog({
      title: "Import BibTeX",
      accept: ".bib,text/plain",
      hint: "Select a BibTeX (.bib) file to import.",
      maxSizeMb: 8,
      onLoad: (_file, text) => {
        try {
          const items = parseBibtex(text);
          const { unique, duplicates, existingKeys } = splitReferenceImport(items);
          if (duplicates.length) {
            const usedKeys = new Set<string>([...existingKeys, ...unique.map((item) => item.itemKey)]);
            openReferenceConflictDialog({
              duplicates,
              usedKeys,
              onApply: ({ resolved, skipped }) => {
                const merged = [...unique, ...resolved];
                upsertReferenceItems(merged);
                showRibbonToast(
                  `Imported ${merged.length} BibTeX references${skipped.length ? ` (${skipped.length} skipped)` : ""}.`
                );
              }
            });
            return;
          }
          upsertReferenceItems(unique);
          showRibbonToast(`Imported ${unique.length} BibTeX references.`);
        } catch (error) {
          console.error("[References] import bibtex failed", error);
          showRibbonToast("Failed to import BibTeX.");
        }
      }
    });
  },
  "citation.import.ris.openDialog"() {
    openFileImportDialog({
      title: "Import RIS",
      accept: ".ris,text/plain",
      hint: "Select a RIS (.ris) file to import.",
      maxSizeMb: 8,
      onLoad: (_file, text) => {
        try {
          const items = parseRis(text);
          const { unique, duplicates, existingKeys } = splitReferenceImport(items);
          if (duplicates.length) {
            const usedKeys = new Set<string>([...existingKeys, ...unique.map((item) => item.itemKey)]);
            openReferenceConflictDialog({
              duplicates,
              usedKeys,
              onApply: ({ resolved, skipped }) => {
                const merged = [...unique, ...resolved];
                upsertReferenceItems(merged);
                showRibbonToast(
                  `Imported ${merged.length} RIS references${skipped.length ? ` (${skipped.length} skipped)` : ""}.`
                );
              }
            });
            return;
          }
          upsertReferenceItems(unique);
          showRibbonToast(`Imported ${unique.length} RIS references.`);
        } catch (error) {
          console.error("[References] import ris failed", error);
          showRibbonToast("Failed to import RIS.");
        }
      }
    });
  },
  "citation.import.csljson.openDialog"() {
    openFileImportDialog({
      title: "Import CSL JSON",
      accept: ".json,application/json",
      hint: "Select a CSL JSON file to import.",
      maxSizeMb: 12,
      onLoad: (_file, text) => {
        try {
          const raw = JSON.parse(text) as any;
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
          const { unique, duplicates, existingKeys } = splitReferenceImport(items);
          if (duplicates.length) {
            const usedKeys = new Set<string>([...existingKeys, ...unique.map((item) => item.itemKey)]);
            openReferenceConflictDialog({
              duplicates,
              usedKeys,
              onApply: ({ resolved, skipped }) => {
                const merged = [...unique, ...resolved];
                upsertReferenceItems(merged);
                refsInfo("[References] imported CSL-JSON items", { count: merged.length });
                showRibbonToast(
                  `Imported ${merged.length} references${skipped.length ? ` (${skipped.length} skipped)` : ""}.`
                );
              }
            });
            return;
          }
          upsertReferenceItems(unique);
          refsInfo("[References] imported CSL-JSON items", { count: unique.length });
          showRibbonToast(`Imported ${unique.length} references.`);
        } catch (error) {
          console.error("[References] import CSL-JSON failed", error);
          showRibbonToast("Failed to import CSL JSON.");
        }
      }
    });
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
      await insertReferencesAsNewLastPages(editor, label, keys);
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
      await insertReferencesAsNewLastPages(editor, "References", keys);
      await refreshCitationsAndBibliography(editor);
    })();
  },

  UpdateBibliography(editor) {
    void (async () => {
      const fromStore = await readUsedBibliography();
      const rawKeys = fromStore.length ? fromStore : collectDocumentCitationKeys(editor);
      const keys = collectOrderedCitedItemKeys(editor, rawKeys);
      removeTrailingReferencesByBreak(editor);
      await insertReferencesAsNewLastPages(editor, "References", keys);
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
  "research.smartLookup.open"() {
    const handle = getEditorHandle();
    openDirectQuoteLookupPanelLazy(handle);
  },
  "research.library.search.open"() {
    const handle = getEditorHandle();
    openDirectQuoteLookupPanelLazy(handle);
  },
  "research.doi.openDialog"() {
    ensureReferencesLibrary();
    openSingleInputDialog({
      title: "Lookup DOI",
      label: "DOI",
      placeholder: "e.g. 10.1000/xyz123",
      onApply: (value) => {
        const doi = value.trim();
        if (!doi) return;
        const library = getReferencesLibrarySync();
        const itemKey = buildReferenceItemKey(doi, library.itemsByKey);
        const url = doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
        upsertReferenceItems([
          {
            itemKey,
            title: doi,
            url
          }
        ]);
        showRibbonToast(`Added DOI source: ${itemKey}`);
        openSourcesPanel();
      }
    });
  },
  "research.url.openDialog"() {
    ensureReferencesLibrary();
    openSingleInputDialog({
      title: "Open URL",
      label: "URL",
      placeholder: "https://example.com",
      onApply: (value) => {
        const url = value.trim();
        if (!url) return;
        const library = getReferencesLibrarySync();
        const itemKey = buildReferenceItemKey(url, library.itemsByKey);
        upsertReferenceItems([
          {
            itemKey,
            title: url,
            url
          }
        ]);
        showRibbonToast(`Added URL source: ${itemKey}`);
        openSourcesPanel();
      }
    });
  },
  "research.resolveCitation.openDialog"() {
    ensureReferencesLibrary();
    openSingleInputDialog({
      title: "Resolve Citation",
      label: "Citation text",
      placeholder: "Paste a full citation or reference text",
      multiline: true,
      onApply: (value) => {
        const text = value.trim();
        if (!text) return;
        const library = getReferencesLibrarySync();
        const itemKey = buildReferenceItemKey(text, library.itemsByKey);
        upsertReferenceItems([
          {
            itemKey,
            title: text
          }
        ]);
        showRibbonToast(`Added citation: ${itemKey}`);
        openSourcesPanel();
      }
    });
  },
  "index.mark.openDialog"(editor) {
    openSingleInputDialog({
      title: "Mark Index Entry",
      label: "Index entry",
      placeholder: "e.g. Public international law",
      onApply: (value) => {
        const term = value.trim();
        if (!term) return;
        chainWithSafeFocus(editor).insertContent(`[[index:${term}]] `).run();
      }
    });
  },
  "index.insert.openDialog"(editor) {
    const entries = collectMarkerEntries(editor.state.doc, "index");
    insertIndexSection(editor, "Index", entries);
  },
  "index.automark.openDialog"(editor) {
    openSingleInputDialog({
      title: "AutoMark Index Terms",
      label: "Terms (comma-separated)",
      placeholder: "e.g. cyber, attribution, proportionality",
      onApply: (value) => {
        const terms = value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        if (!terms.length) return;
        const markers = terms.map((term) => `[[index:${term}]]`).join(" ");
        chainWithSafeFocus(editor).insertContent(`${markers} `).run();
      }
    });
  },
  "index.preview.toggle"() {
    showRibbonToast("Index preview is inline; markers are visible in the document.");
  },
  "toa.mark.openDialog"(editor) {
    openSingleInputDialog({
      title: "Mark Authority Entry",
      label: "Authority entry",
      placeholder: "e.g. Convention on Cybercrime",
      onApply: (value) => {
        const term = value.trim();
        if (!term) return;
        chainWithSafeFocus(editor).insertContent(`[[toa:${term}]] `).run();
      }
    });
  },
  "toa.insert.openDialog"(editor) {
    const entries = collectMarkerEntries(editor.state.doc, "toa");
    insertIndexSection(editor, "Table of Authorities", entries);
  },
  "toa.update"(editor) {
    commandMap["toa.insert.openDialog"](editor);
  },
  "toa.export.openMenu"() {
    openToaExportDialog({
      onApply: (mode) => {
        const handle = getEditorHandle();
        if (!handle) return;
        const editor = handle.getEditor();
        if (mode === "csv") {
          commandMap["toa.export.csv.openDialog"](editor);
        } else {
          commandMap["toa.export.json.openDialog"](editor);
        }
      }
    });
  },
  "toa.export.json.openDialog"() {
    const handle = getEditorHandle();
    if (!handle) return;
    const editor = handle.getEditor();
    const entries = collectMarkerEntries(editor.state.doc, "toa");
    downloadTextFile(
      "table_of_authorities.json",
      JSON.stringify({ entries }, null, 2),
      "application/json"
    );
  },
  "toa.export.csv.openDialog"() {
    const handle = getEditorHandle();
    if (!handle) return;
    const editor = handle.getEditor();
    const entries = collectMarkerEntries(editor.state.doc, "toa");
    const lines = ["term,count", ...entries.map((e) => `"${e.term.replace(/\"/g, '""')}",${e.count}`)];
    downloadTextFile("table_of_authorities.csv", lines.join("\n"), "text/csv");
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
  InsertHorizontalRule(editor) {
    const chain = chainWithSafeFocus(editor) as any;
    if (typeof chain.setHorizontalRule === "function") {
      chain.setHorizontalRule().run();
      return;
    }
    chain.insertContent("---").run();
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
  "insert.sectionBreak"(editor, args) {
    const kind = typeof args?.kind === "string" ? args.kind : "nextPage";
    switch (kind) {
      case "continuous":
        commandMap.InsertSectionBreakContinuous(editor);
        break;
      case "evenPage":
        commandMap.InsertSectionBreakEven(editor);
        break;
      case "oddPage":
        commandMap.InsertSectionBreakOdd(editor);
        break;
      case "nextPage":
      default:
        commandMap.InsertSectionBreakNextPage(editor);
        break;
    }
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
  "insert.equation.insertInline"(editor, args) {
    const raw = typeof args?.text === "string" ? args.text : "";
    const value = String(raw ?? "").trim();
    if (value) {
      chainWithSafeFocus(editor).insertContent(`$${value}$`).run();
      return;
    }
    openEquationDialog({
      mode: "inline",
      onApply: (next) => {
        chainWithSafeFocus(editor).insertContent(`$${next}$`).run();
      }
    });
  },
  "insert.equation.insertDisplay"(editor, args) {
    const raw = typeof args?.text === "string" ? args.text : "";
    const value = String(raw ?? "").trim();
    if (value) {
      chainWithSafeFocus(editor).insertContent(`\n$$${value}$$\n`).run();
      return;
    }
    openEquationDialog({
      mode: "display",
      onApply: (next) => {
        chainWithSafeFocus(editor).insertContent(`\n$$${next}$$\n`).run();
      }
    });
  },
  "insert.symbol.insert"(editor, args) {
    const raw = typeof args?.codepoint === "string" ? args.codepoint : "";
    const codepoint = raw.trim();
    if (!codepoint) {
      openSymbolDialog({
        onApply: (parsed) => {
          chainWithSafeFocus(editor).insertContent(String.fromCodePoint(parsed)).run();
        }
      });
      return;
    }
    const parsed = Number.parseInt(codepoint, 16);
    if (!Number.isFinite(parsed)) {
      showRibbonToast("Invalid codepoint.");
      return;
    }
    chainWithSafeFocus(editor).insertContent(String.fromCodePoint(parsed)).run();
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
    applyTemplateStyles(editor, template);
    safeFocusEditor(editor, "start");
  },
  ApplyTemplateStyles(editor, args) {
    const templateId = typeof args?.id === "string" ? args.id : undefined;
    if (!templateId) return;
    const template = getTemplateById(templateId);
    if (!template) {
      console.warn("ApplyTemplateStyles: unknown template", templateId);
      return;
    }
    applyTemplateStyles(editor, template);
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

  "review.wordCount.open"(editor) {
    commandMap.WordCount(editor);
  },
  "review.spellingGrammar.open"(editor) {
    commandMap.Spelling(editor);
  },
  "review.thesaurus.open"(editor) {
    commandMap.Thesaurus(editor);
  },
  "review.accessibility.open"(editor) {
    const issues: string[] = [];
    let headingCount = 0;
    let imageMissingAlt = 0;
    editor.state.doc.descendants((node) => {
      if (node.type?.name === "heading") {
        headingCount += 1;
      }
      if (node.type?.name === "image") {
        const alt = typeof (node.attrs as any)?.alt === "string" ? String((node.attrs as any).alt).trim() : "";
        if (!alt) imageMissingAlt += 1;
      }
      return true;
    });
    if (headingCount === 0) {
      issues.push("No headings found (add headings for structure).");
    }
    if (imageMissingAlt > 0) {
      issues.push(`${imageMissingAlt} image(s) missing alt text.`);
    }
    openAccessibilityPopover(issues);
  },
  "review.translate.open"(editor) {
    openTranslatePopover({
      language: readTranslateLanguage(),
      onApply: ({ language, scope }) => {
        writeTranslateLanguage(language);
        void runAiTranslation(editor, scope, language);
      }
    });
  },
  "review.translate.selection"(editor, args) {
    const language = typeof args?.language === "string" ? args.language : readTranslateLanguage();
    void runAiTranslation(editor, "selection", language);
  },
  "review.translate.document"(editor, args) {
    const language = typeof args?.language === "string" ? args.language : readTranslateLanguage();
    void runAiTranslation(editor, "document", language);
  },
  "review.language.openDialog"() {
    const current = window.localStorage?.getItem("leditor.proofingLanguage") ?? "en-US";
    openProofingLanguagePopover({
      current,
      onApply: (value) => {
        window.localStorage?.setItem("leditor.proofingLanguage", value);
        showRibbonToast(`Proofing language set to ${value}`);
      }
    });
  },
  "review.comment.add"() {
    if (tryExecHandleCommand("CommentsNew")) return;
    const handle = getEditorHandle();
    if (!handle) return;
    try {
      handle.execCommand("InsertComment");
    } catch {
      // ignore
    }
  },
  "review.comment.delete.openMenu"() {
    const handle = getEditorHandle();
    if (!handle) return;
    const editor = handle.getEditor();
    openCommentsDeletePopover({
      onDeleteCurrent: () => {
        commandMap["review.comment.delete.current"](editor);
      },
      onDeleteAll: () => {
        commandMap["review.comment.delete.all"](editor);
      }
    });
  },
  "review.comment.delete.current"() {
    if (tryExecHandleCommand("CommentsDelete")) return;
    const handle = getEditorHandle();
    if (!handle) return;
    const editor = handle.getEditor();
    editor.chain().focus().unsetMark("comment").run();
  },
  "review.comment.delete.all"() {
    const handle = getEditorHandle();
    if (!handle) return;
    const editor = handle.getEditor();
    const commentMark = editor.schema.marks.comment;
    if (!commentMark) return;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      if (!node.marks?.some((mark) => mark.type === commentMark)) return true;
      tr.removeMark(pos, pos + node.nodeSize, commentMark);
      return true;
    });
    if (tr.docChanged) {
      editor.view.dispatch(tr);
    }
  },
  "review.trackChanges.toggle"() {
    tryExecHandleCommand("ToggleTrackChanges");
  },
  "review.change.accept"() {
    tryExecHandleCommand("AcceptChange");
  },
  "review.change.acceptAll"() {
    const count = trackChangesSnapshot?.pendingChanges?.length ?? 0;
    const max = Math.max(1, Math.min(200, count || 50));
    for (let i = 0; i < max; i += 1) {
      if (!tryExecHandleCommand("AcceptChange")) break;
    }
  },
  "review.change.reject"() {
    tryExecHandleCommand("RejectChange");
  },
  "review.change.rejectAll"() {
    const count = trackChangesSnapshot?.pendingChanges?.length ?? 0;
    const max = Math.max(1, Math.min(200, count || 50));
    for (let i = 0; i < max; i += 1) {
      if (!tryExecHandleCommand("RejectChange")) break;
    }
  },
  "review.change.previous"() {
    tryExecHandleCommand("PrevChange");
  },
  "review.change.next"() {
    tryExecHandleCommand("NextChange");
  },
  "review.markup.openMenu"() {
    const current = window.localStorage?.getItem("leditor.markupMode") ?? "simple";
    openMarkupPopover({
      current: current === "all" || current === "none" ? current : "simple",
      onApply: (mode) => {
        commandMap["review.markup.set"](undefined as any, { mode });
      }
    });
  },
  "review.markup.set"(_editor, args) {
    const raw = typeof args?.mode === "string" ? args.mode : typeof args?.value === "string" ? args.value : "";
    const mode = raw.trim().toLowerCase() || "simple";
    window.localStorage?.setItem("leditor.markupMode", mode);
    showRibbonToast(`Markup mode set to ${mode}.`);
  },
  "review.restrictEditing.open"(editor) {
    const next = !editor.isEditable;
    openRestrictEditingPopover({
      isRestricted: next,
      onApply: () => {
        editor.setEditable(!next);
        const appRoot = document.getElementById("leditor-app");
        if (appRoot) {
          appRoot.classList.toggle("leditor-restrict-editing", next);
        }
        window.localStorage?.setItem("leditor.restrictEditing", next ? "1" : "0");
        showRibbonToast(next ? "Editing restricted." : "Editing enabled.");
      }
    });
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
  "pageSetup.columns.openDialog"(editor) {
    const currentFromDoc =
      typeof (editor.state.doc.attrs as any)?.columns === "number"
        ? (editor.state.doc.attrs as any).columns
        : Number((editor.state.doc.attrs as any)?.columns);
    const currentCount = Number.isFinite(currentFromDoc) ? currentFromDoc : getLayoutColumns();
    const gapIn = getColumnGapIn();
    const widthIn = getColumnWidthIn();
    const contentWidthIn = getContentWidthIn();
    openColumnsDialog({
      currentCount,
      currentGapIn: gapIn,
      currentWidthIn: widthIn,
      contentWidthIn,
      scope: "document",
      onApply: ({ count, gapIn: nextGap, widthIn: nextWidth, scope }) => {
        commandMap.SetSectionColumns(editor, {
          count,
          gapIn: nextGap,
          widthIn: nextWidth,
          scope
        });
      }
    });
  },
  SetSectionColumns(editor, args) {
    const count = typeof args?.count === "number" ? args.count : Number(args?.count);
    if (!Number.isFinite(count)) {
      throw new Error('SetSectionColumns requires { count: number }');
    }
    const normalizedCount = Math.max(1, Math.min(4, Math.floor(count))) as 1 | 2 | 3 | 4;
    if (typeof window !== "undefined") {
      (window as any).__leditorDisableColumns = normalizedCount > 1 ? false : true;
    }
    const scope = typeof args?.scope === "string" ? args.scope : "document";
    let gapIn = parseOptionalNumber((args as any)?.gapIn ?? (args as any)?.gap);
    let widthIn = parseOptionalNumber((args as any)?.widthIn ?? (args as any)?.width);
    if (gapIn != null && gapIn < 0) gapIn = null;
    if (widthIn != null && widthIn <= 0) widthIn = null;
    if (scope === "section") {
      const applied = applySectionColumnSettings(editor, { count: normalizedCount, gapIn, widthIn });
      if (applied) {
        showRibbonToast("Section columns updated.");
        return;
      }
      showRibbonToast("Unable to update section; applied to document.");
    }
    const tiptap = getTiptap(editor);
    if (!tiptap?.commands?.setPageColumns) {
      throw new Error("TipTap setPageColumns command unavailable");
    }
    const gapValue = gapIn == null ? undefined : gapIn;
    const widthValue = widthIn == null ? undefined : widthIn;
    const ok = tiptap.commands.setPageColumns({
      count: normalizedCount,
      gapIn: gapValue,
      widthIn: widthValue
    });
    if (!ok) {
      throw new Error("setPageColumns command failed");
    }
    setSectionColumns(normalizedCount, {
      gapIn: gapValue,
      widthIn: widthValue
    });
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

