import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type CitationSource = {
  id: string;
  label?: string;
  title?: string;
  author?: string;
  year?: string;
  url?: string;
  note?: string;
};

const STORE_NODE_NAME = "citation_sources";

const normalizeId = (value: string) => value.trim().replace(/\s+/g, " ");

const normalizeSource = (source: CitationSource): CitationSource => {
  const id = normalizeId(source.id);
  return {
    id,
    label: source.label?.trim() || undefined,
    title: source.title?.trim() || undefined,
    author: source.author?.trim() || undefined,
    year: source.year?.trim() || undefined,
    url: source.url?.trim() || undefined,
    note: source.note?.trim() || undefined
  };
};

const normalizeSources = (sources: CitationSource[]) => {
  const seen = new Set<string>();
  const normalized: CitationSource[] = [];
  for (const source of sources) {
    if (!source || typeof source.id !== "string") continue;
    const next = normalizeSource(source);
    if (!next.id || seen.has(next.id)) continue;
    seen.add(next.id);
    normalized.push(next);
  }
  return normalized;
};

const readSourcesFromNode = (node?: ProseMirrorNode | null): CitationSource[] => {
  if (!node) return [];
  const raw = node.attrs?.sources;
  if (!Array.isArray(raw)) return [];
  return normalizeSources(raw as CitationSource[]);
};

const findStoreNode = (doc: ProseMirrorNode) => {
  let storeNode: ProseMirrorNode | null = null;
  let storePos: number | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === STORE_NODE_NAME) {
      storeNode = node;
      storePos = pos;
      return false;
    }
    return true;
  });
  return { storeNode, storePos };
};

export const getCitationSources = (editor: Editor): CitationSource[] => {
  const { storeNode } = findStoreNode(editor.state.doc);
  return readSourcesFromNode(storeNode);
};

export const getCitationSourceById = (editor: Editor, id: string): CitationSource | null => {
  const normalizedId = normalizeId(id);
  const sources = getCitationSources(editor);
  return sources.find((source) => source.id === normalizedId) ?? null;
};

export const upsertCitationSource = (editor: Editor, source: CitationSource): CitationSource[] => {
  const normalized = normalizeSource(source);
  const schemaNode = editor.schema.nodes.citation_sources;
  if (!schemaNode) {
    throw new Error("Citation source store node is not registered.");
  }
  const { storeNode, storePos } = findStoreNode(editor.state.doc);
  const sources = readSourcesFromNode(storeNode);
  const existingIndex = sources.findIndex((item) => item.id === normalized.id);
  if (existingIndex >= 0) {
    sources.splice(existingIndex, 1, normalized);
  } else {
    sources.push(normalized);
  }
  const nextSources = normalizeSources(sources);
  const tr = editor.state.tr;
  if (storeNode && typeof storePos === "number") {
    const mapped = tr.mapping.map(storePos);
    const attrs = (storeNode as ProseMirrorNode).attrs ?? {};
    tr.setNodeMarkup(mapped, schemaNode, { ...attrs, sources: nextSources });
  } else {
    const endPos = tr.doc.content.size;
    tr.insert(endPos, schemaNode.create({ sources: nextSources }));
  }
  editor.view.dispatch(tr);
  return nextSources;
};

export const setCitationSources = (editor: Editor, sources: CitationSource[]) => {
  const schemaNode = editor.schema.nodes.citation_sources;
  if (!schemaNode) {
    throw new Error("Citation source store node is not registered.");
  }
  const normalized = normalizeSources(sources);
  const { storeNode, storePos } = findStoreNode(editor.state.doc);
  const tr = editor.state.tr;
  if (storeNode && typeof storePos === "number") {
    const mapped = tr.mapping.map(storePos);
    const attrs = (storeNode as ProseMirrorNode).attrs ?? {};
    tr.setNodeMarkup(mapped, schemaNode, { ...attrs, sources: normalized });
  } else {
    const endPos = tr.doc.content.size;
    tr.insert(endPos, schemaNode.create({ sources: normalized }));
  }
  editor.view.dispatch(tr);
};

export const normalizeCitationSources = (sources: CitationSource[]) => normalizeSources(sources);

export const normalizeCitationId = normalizeId;
