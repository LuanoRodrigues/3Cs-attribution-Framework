import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { getFootnoteRegistry } from "../extensions/extension_footnote.ts";
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
import { ensureReferencesLibrary } from "../ui/references/library.ts";
import { getHostContract } from "../ui/host_contract.ts";
import { createSearchPanel } from "../ui/search_panel.ts";
import { nextMatch, prevMatch, replaceAll, replaceCurrent, setQuery } from "../editor/search.ts";
import {
  exportBibliographyBibtex,
  exportBibliographyJson,
  getLibraryPath,
  writeUsedBibliography,
  ensureBibliographyNode
} from "../ui/references/bibliography.ts";
import {
  buildCitationItems,
  updateAllCitationsAndBibliography
} from "../csl/update.ts";
import type { BibliographyNode as CslBibliographyNode, CitationNode as CslCitationNode, DocCitationMeta } from "../csl/types.ts";
import referencesTabRaw from "../ui/references.json";
import type { TabConfig } from "../ui/ribbon_config.ts";
import { getReferencesCommandIds } from "../ui/references_command_contract.ts";
import {
  applySnapshotToTransaction,
  consumeRibbonSelection,
  restoreSelectionFromSnapshot,
  snapshotFromSelection,
  StoredSelection
} from "../utils/selection_snapshot";
import { insertFootnoteAtSelection as insertManagedFootnote } from "../uipagination/footnotes/commands";
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

type CitationNodeRecord = CslCitationNode & { pos: number; pmNode: ProseMirrorNode };
type BibliographyNodeRecord = CslBibliographyNode & { pos: number; pmNode: ProseMirrorNode };

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

const scrollFootnoteAreaIntoView = (footnoteId: string, attempt = 0) => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.requestAnimationFrame(() => {
    const marker = document.querySelector<HTMLElement>(`.leditor-footnote[data-footnote-id="${footnoteId}"]`);
    if (!marker) return;
    const kind = (marker.dataset.footnoteKind ?? "footnote").toLowerCase();
    if (kind === "endnote") {
      document
        .querySelector<HTMLElement>(".leditor-endnotes-panel")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const container = marker.closest<HTMLElement>(".leditor-page")?.querySelector<HTMLElement>(".leditor-page-footnotes");
    if (container) {
      container.scrollIntoView({ block: "center", behavior: "smooth" });
      const entry = container.querySelector<HTMLElement>(
        `.leditor-footnote-entry[data-footnote-id="${footnoteId}"]`
      );
      if (entry) {
        entry.classList.add("leditor-footnote-entry--active");
        window.setTimeout(() => entry.classList.remove("leditor-footnote-entry--active"), 900);
        const text = entry.querySelector<HTMLElement>(".leditor-footnote-entry-text");
        text?.focus();
        return;
      }
      if (attempt < 5) {
        scrollFootnoteAreaIntoView(footnoteId, attempt + 1);
      }
      return;
    }
    marker.scrollIntoView({ block: "center", behavior: "smooth" });
  });
};

const focusFootnoteById = (id: string, attempt = 0) => {
  const view = getFootnoteRegistry().get(id);
  if (view) {
    view.open();
    scrollFootnoteAreaIntoView(id);
    return;
  }
  if (attempt >= 5) return;
  window.requestAnimationFrame(() => focusFootnoteById(id, attempt + 1));
};

let searchPanelController: ReturnType<typeof createSearchPanel> | null = null;
const ensureSearchPanel = (editorHandle: EditorHandle) => {
  if (!searchPanelController) {
    searchPanelController = createSearchPanel(editorHandle);
  }
  return searchPanelController;
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
  console.info("[References] insert citation", {
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
      editor.view.focus();
      restoreSelectionFromSnapshot(editor, selectionSnapshot);
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
  const noteKind =
    styleId === "chicago-note-bibliography" || styleId === "chicago-footnotes"
      ? "footnote"
      : styleId === "chicago-note-bibliography-endnote"
        ? "endnote"
        : null;
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

const resolveNoteKind = (styleId: string): "footnote" | "endnote" | null => {
  if (styleId === "chicago-note-bibliography" || styleId === "chicago-footnotes") return "footnote";
  if (styleId === "chicago-note-bibliography-endnote") return "endnote";
  return null;
};

const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

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
  if (!CITATION_STYLES.includes(nextStyle)) {
    throw new Error(`Unsupported citation style: ${styleId}`);
  }
  const currentAttrs = editor.state.doc.attrs;
  if (!currentAttrs || typeof currentAttrs !== "object") {
    throw new Error("Document attributes are missing");
  }
  console.info("[References] citation style change", { from: currentAttrs.citationStyleId, to: nextStyle });
  const tr = editor.state.tr.setDocAttribute("citationStyleId", nextStyle);
  editor.view.dispatch(tr);
};

const setCitationStyleCommand: CommandHandler = (editor, args) => {
  const payloadRaw = typeof args?.id === "string" ? args.id : typeof args?.style === "string" ? args.style : "";
  const payload = payloadRaw.trim().toLowerCase();
  const style = CITATION_STYLES.includes(payload) ? payload : CITATION_STYLE_DEFAULT;
  applyCitationStyleToDoc(editor, style);
  void refreshCitationsAndBibliography(editor);
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

  if (noteKind) {
    const existingNotes = collectFootnoteNodesByCitationId(editor.state.doc, noteKind);
    const noteMap = new Map(existingNotes.map((entry) => [entry.citationId, entry]));
    const existingIds = new Set(noteMap.keys());
    editor.state.doc.descendants((node, pos) => {
      if (node.type === citationNode) {
        const citationId = typeof node.attrs?.citationId === "string" ? node.attrs.citationId : "";
        if (!citationId) return true;
        if (!node.attrs?.hidden) {
          const mappedPos = trPrelude.mapping.map(pos);
          trPrelude.setNodeMarkup(mappedPos, citationNode, { ...node.attrs, hidden: true });
        }
        if (!existingIds.has(citationId)) {
          const footnoteNode = editor.schema.nodes.footnote;
          if (!footnoteNode) {
            throw new Error("Footnote node is not registered in schema");
          }
          const footnoteId = `fn-${citationId}`;
          const footnote = footnoteNode.create(
            { footnoteId, kind: noteKind, citationId },
            editor.schema.text("Citation")
          );
          const mappedInsertPos = trPrelude.mapping.map(pos + node.nodeSize);
          trPrelude.insert(mappedInsertPos, footnote);
          existingIds.add(citationId);
        }
      }
      return true;
    });
    editor.state.doc.descendants((node, pos) => {
      if (node.type === bibliographyNode) {
        const mappedPos = trPrelude.mapping.map(pos);
        trPrelude.delete(mappedPos, mappedPos + node.nodeSize);
      }
      return true;
    });
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
  }

  const tr = editor.state.tr;
  updateAllCitationsAndBibliography({
    doc: editor.state.doc,
    getDocCitationMeta: (doc) => getDocCitationMeta(doc as ProseMirrorNode),
    extractCitationNodes: (doc) => extractCitationNodes(doc as ProseMirrorNode),
    findBibliographyNode: (doc) => (noteKind ? null : findBibliographyNode(doc as ProseMirrorNode)),
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
  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }

  if (noteKind) {
    const rendered = new Map<string, string>();
    const citationNodes = extractCitationNodes(editor.state.doc);
    citationNodes.forEach((node) => rendered.set(node.citationId, node.renderedHtml));
    const footnoteNodes = collectFootnoteNodesByCitationId(editor.state.doc, noteKind);
    if (footnoteNodes.length) {
      const trNotes = editor.state.tr;
      footnoteNodes.forEach((entry) => {
        const text = stripHtml(rendered.get(entry.citationId) ?? "");
        const contentText = text.length > 0 ? text : "Citation";
        const content = editor.schema.text(contentText);
        const newNode = entry.node.type.create(entry.node.attrs, content);
        trNotes.replaceWith(entry.pos, entry.pos + entry.node.nodeSize, newNode);
      });
      if (trNotes.docChanged) {
        editor.view.dispatch(trNotes);
      }
    }
  }
};

const refreshCitationsAndBibliography = async (editor: Editor): Promise<void> => {
  await ensureReferencesLibrary();
  runCslUpdate(editor);
  await refreshUsedBibliography(editor);
};

const applyStyleById = (editor: Editor, styleId: string): void => {
  const id = styleId.toLowerCase();
  if (id.includes("heading1")) {
    editor.chain().focus().toggleHeading({ level: 1 }).run();
    return;
  }
  if (id.includes("heading2")) {
    editor.chain().focus().toggleHeading({ level: 2 }).run();
    return;
  }
  if (id.includes("heading3")) {
    editor.chain().focus().toggleHeading({ level: 3 }).run();
    return;
  }
  if (id.includes("heading4")) {
    editor.chain().focus().toggleHeading({ level: 4 }).run();
    return;
  }
  if (id.includes("heading5")) {
    editor.chain().focus().toggleHeading({ level: 5 }).run();
    return;
  }
  if (id.includes("heading6")) {
    editor.chain().focus().toggleHeading({ level: 6 }).run();
    return;
  }
  if (id.includes("title")) {
    editor.chain().focus().toggleHeading({ level: 1 }).run();
    return;
  }
  if (id.includes("subtitle")) {
    editor.chain().focus().toggleHeading({ level: 2 }).run();
    return;
  }
  if (id.includes("quote")) {
    editor.chain().focus().toggleBlockquote().run();
    return;
  }
  if (id.includes("code")) {
    editor.chain().focus().toggleCodeBlock().run();
    return;
  }
  editor.chain().focus().setParagraph().run();
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
      editor.chain().focus().insertContent({ type: "image", attrs: { src: result.url } }).run();
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
  setPageBoundariesVisible,
  setPageBreakMarksVisible,
  setPaginationMode,
  setReadMode,
  setRulerVisible,
  setScrollDirection
} from "../ui/view_state.ts";
import { getLayoutController } from "../ui/layout_context.ts";
import { getTemplateById } from "../templates/index.ts";
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

const insertTocNode = (editor: Editor, entries: TocEntry[]): void => {
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

const collectDocumentCitationKeys = (editor: Editor): string[] => {
  const keys = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation" && Array.isArray(node.attrs?.items)) {
      (node.attrs.items as Array<{ itemKey: string }>).forEach((item) => {
        if (item && typeof item.itemKey === "string" && item.itemKey.trim().length > 0) {
          keys.add(item.itemKey.trim());
        }
      });
    }
    return true;
  });
  return Array.from(keys);
};

const refreshUsedBibliography = async (editor: Editor) => {
  const keys = collectDocumentCitationKeys(editor);
  await writeUsedBibliography(keys);
};

const ensureBibliographyStore = (): void => {
  void ensureReferencesLibrary()
    .then((library) => {
      console.info("[References] bibliography library persisted", {
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
  editor.chain().focus().insertContent({ type: "page_break", attrs: { kind } }).run();
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
    notifySearchUndo();
    notifyAutosaveUndoRedo();
    notifyDirectionUndo();
  },
  Redo(editor) {
    editor.chain().focus().redo().run();
    notifyAutosaveUndoRedo();
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
    toggleFullscreen();
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
  Indent(editor) {
    editor.commands.focus();
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
    editor.commands.focus();
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
    editor.commands.focus();
    const next = clampIndentLevel(target);
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
    if (raw === null) return;
    const href = raw.trim();
    const chain = editor.chain().focus() as any;
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
    editor.chain().focus().toggleBlockquote().run();
  },
  SelectAll(editor) {
    editor.commands.focus();
    editor.commands.selectAll();
  },
  SelectObjects() {
    showPlaceholderDialog("Select Objects");
  },
  SelectSimilarFormatting() {
    showPlaceholderDialog("Select Similar Formatting");
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
      editor.chain().focus().setParagraph().run();
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
    showPlaceholderDialog("Styles Pane");
  },
  "styles.manage.openMenu"() {
    showPlaceholderDialog("Manage Styles");
  },
  "styles.create.openDialog"() {
    showPlaceholderDialog("New Style");
  },
  "styles.modify.openDialog"() {
    showPlaceholderDialog("Modify Style");
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
    const chain = editor.chain().focus() as any;
    const markChain = (chain.extendMarkRange("link") as any);
    if (href.length === 0) {
      markChain.unsetLink().run();
      return;
    }
    markChain.setLink({ href }).run();
  },
  RemoveLink(editor) {
    const chain = editor.chain().focus() as any;
    (chain.extendMarkRange("link") as any).unsetLink().run();
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
  InsertFootnote(editor, args) {
    const selectionSnapshot = consumeRibbonSelection() ?? snapshotFromSelection(editor.state.selection);
    restoreSelectionFromSnapshot(editor, selectionSnapshot);
    const text = typeof args?.text === "string" ? args.text : undefined;
    const id = insertManagedFootnote(editor, "footnote", text);
    focusFootnoteById(id);
  },
  "footnote.insert"(editor) {
    commandMap.InsertFootnote(editor);
  },
  InsertEndnote(editor, args) {
    const selectionSnapshot = consumeRibbonSelection() ?? snapshotFromSelection(editor.state.selection);
    restoreSelectionFromSnapshot(editor, selectionSnapshot);
    const text = typeof args?.text === "string" ? args.text : undefined;
    const id = insertManagedFootnote(editor, "endnote", text);
    focusFootnoteById(id);
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

  InsertCitation: handleInsertCitationCommand,
  "citation.insert.openDialog": handleInsertCitationCommand,

  UpdateCitations(editor) {
    void (async () => {
      if (!hasCitationNodes(editor)) {
        window.alert("No citations to update.");
        return;
      }
      await refreshCitationsAndBibliography(editor);
    })();
  },

  SetCitationStyle: setCitationStyleCommand,

  "citation.style.set": setCitationStyleCommand,
  'citation.csl.import.openDialog'() {
    console.warn('[References] citation.csl.import.openDialog stub invoked');
  },
  'citation.csl.manage.openDialog'() {
    console.warn('[References] citation.csl.manage.openDialog stub invoked');
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
      console.info("[References] insert bibliography", { styleId: editor.state.doc.attrs?.citationStyleId });
      const styleId = getDocCitationMeta(editor.state.doc).styleId;
      if (resolveNoteKind(styleId)) {
        return;
      }
      const keys = collectDocumentCitationKeys(editor);
      if (!keys.length) {
        window.alert("Insert citations before generating a bibliography.");
        return;
      }
      console.info("[References] insert bibliography", { itemKeys: keys });
      ensureBibliographyStore();
      ensureBibliographyNode(editor);
      await refreshCitationsAndBibliography(editor);
    })();
  },

  UpdateBibliography(editor) {
    void (async () => {
      const styleId = getDocCitationMeta(editor.state.doc).styleId;
      if (resolveNoteKind(styleId)) {
        return;
      }
      if (!hasBibliographyNode(editor)) {
        window.alert("No bibliography found to update.");
        return;
      }
      await refreshCitationsAndBibliography(editor);
    })();
  },
  "citation.sources.manage.openDialog"(editor) {
    console.info("[References] manage sources invoked");
    openSourcesPanel();
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
    editor.chain().focus().insertContent(template.document as any).run();
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

const createReferencePlaceholder = (id: string): CommandHandler => {
  return (_editor, args) => {
    console.warn(`[References] placeholder command invoked: ${id}`, { args });
  };
};

const registerReferenceCommandPlaceholders = (): void => {
  const tab = referencesTabRaw as unknown as TabConfig;
  const ids = getReferencesCommandIds(tab);
  ids.forEach((id) => {
    if (id in commandMap) return;
    commandMap[id] = createReferencePlaceholder(id);
  });
};

registerReferenceCommandPlaceholders();

