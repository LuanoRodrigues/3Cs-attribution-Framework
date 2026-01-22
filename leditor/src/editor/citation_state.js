"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCitationId = exports.normalizeCitationSources = exports.setCitationSources = exports.upsertCitationSource = exports.getCitationSourceById = exports.getCitationSources = void 0;
const STORE_NODE_NAME = "citation_sources";
const normalizeId = (value) => value.trim().replace(/\s+/g, " ");
const normalizeSource = (source) => {
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
const normalizeSources = (sources) => {
    const seen = new Set();
    const normalized = [];
    for (const source of sources) {
        if (!source || typeof source.id !== "string")
            continue;
        const next = normalizeSource(source);
        if (!next.id || seen.has(next.id))
            continue;
        seen.add(next.id);
        normalized.push(next);
    }
    return normalized;
};
const readSourcesFromNode = (node) => {
    if (!node)
        return [];
    const raw = node.attrs?.sources;
    if (!Array.isArray(raw))
        return [];
    return normalizeSources(raw);
};
const findStoreNode = (doc) => {
    let storeNode = null;
    let storePos = null;
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
const getCitationSources = (editor) => {
    const { storeNode } = findStoreNode(editor.state.doc);
    return readSourcesFromNode(storeNode);
};
exports.getCitationSources = getCitationSources;
const getCitationSourceById = (editor, id) => {
    const normalizedId = normalizeId(id);
    const sources = (0, exports.getCitationSources)(editor);
    return sources.find((source) => source.id === normalizedId) ?? null;
};
exports.getCitationSourceById = getCitationSourceById;
const upsertCitationSource = (editor, source) => {
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
    }
    else {
        sources.push(normalized);
    }
    const nextSources = normalizeSources(sources);
    const tr = editor.state.tr;
    if (storeNode && typeof storePos === "number") {
        const mapped = tr.mapping.map(storePos);
        const attrs = storeNode.attrs ?? {};
        tr.setNodeMarkup(mapped, schemaNode, { ...attrs, sources: nextSources });
    }
    else {
        const endPos = tr.doc.content.size;
        tr.insert(endPos, schemaNode.create({ sources: nextSources }));
    }
    editor.view.dispatch(tr);
    return nextSources;
};
exports.upsertCitationSource = upsertCitationSource;
const setCitationSources = (editor, sources) => {
    const schemaNode = editor.schema.nodes.citation_sources;
    if (!schemaNode) {
        throw new Error("Citation source store node is not registered.");
    }
    const normalized = normalizeSources(sources);
    const { storeNode, storePos } = findStoreNode(editor.state.doc);
    const tr = editor.state.tr;
    if (storeNode && typeof storePos === "number") {
        const mapped = tr.mapping.map(storePos);
        const attrs = storeNode.attrs ?? {};
        tr.setNodeMarkup(mapped, schemaNode, { ...attrs, sources: normalized });
    }
    else {
        const endPos = tr.doc.content.size;
        tr.insert(endPos, schemaNode.create({ sources: normalized }));
    }
    editor.view.dispatch(tr);
};
exports.setCitationSources = setCitationSources;
const normalizeCitationSources = (sources) => normalizeSources(sources);
exports.normalizeCitationSources = normalizeCitationSources;
exports.normalizeCitationId = normalizeId;
