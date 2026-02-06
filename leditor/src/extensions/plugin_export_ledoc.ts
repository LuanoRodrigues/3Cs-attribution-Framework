import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { ExportLedocOptions, ExportLedocRequest, ExportLedocResult } from "../api/export_ledoc.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import {
  LEDOC_BUNDLE_VERSION,
  type LedocBundleLayoutFile,
  type LedocBundleMetaFile,
  type LedocBundlePayload,
  type LedocBundleRegistryFile,
  LEDOC_FORMAT_VERSION,
  type LedocFootnoteEntry
} from "../ledoc/format.ts";
import { getHostContract } from "../ui/host_contract.ts";
import { getCurrentPageSize, getMarginValuesCm } from "../ui/layout_settings.ts";
import { reconcileFootnotes } from "../uipagination/footnotes/registry.ts";
import { exportSourceChecksThreadForLedoc } from "../ui/source_checks_thread.ts";
import { exportAgentHistoryForLedoc } from "../ui/agent_history.ts";
import { exportLlmCacheForLedoc } from "../ui/llm_cache.ts";
import { debugFootnoteIdState } from "../uipagination/footnotes/footnote_id_generator.ts";
import { getFootnoteBodyPlainText } from "./extension_footnote_body.ts";

const triggerExport = (request: ExportLedocRequest) => {
  const handler = getHostAdapter()?.exportLEDOC;
  if (!handler) {
    return Promise.resolve({
      success: false,
      error: "ExportLEDOC handler is unavailable"
    } as ExportLedocResult);
  }
  return handler(request);
};

const cmToPx = (cm: number): number => Math.round((cm / 2.54) * 96);

const sanitizeFilenameBase = (raw: string): string => {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "untitled";
  const safe = trimmed.replace(/[\\/:"*?<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return safe.slice(0, 96) || "untitled";
};

const collectFootnotes = (editorHandle: EditorHandle): LedocFootnoteEntry[] => {
  const editor = editorHandle.getEditor();
  const numbering = reconcileFootnotes(editor.state.doc as any).numbering;
  const seen = new Set<string>();
  const entries: LedocFootnoteEntry[] = [];
  const footnoteBodyType = editor.state.schema.nodes.footnoteBody;
  const bodyTextById = new Map<string, string>();
  if (footnoteBodyType) {
    editor.state.doc.descendants((node) => {
      if (node.type !== footnoteBodyType) return true;
      const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
      if (!id || bodyTextById.has(id)) return true;
      bodyTextById.set(id, getFootnoteBodyPlainText(node));
      return true;
    });
  }
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "footnote") return true;
    const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
    if (!id) {
      throw new Error("Footnote is missing footnoteId");
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate footnoteId in document: ${id}`);
    }
    seen.add(id);
    const rawIndex = numbering.get(id);
    const index = typeof rawIndex === "number" ? rawIndex : Number(rawIndex);
    const safeIndex = Number.isFinite(index) ? index : entries.length + 1;
    const attrText = typeof (node.attrs as any)?.text === "string" ? String((node.attrs as any).text) : "";
    const bodyText = bodyTextById.get(id) ?? "";
    const text = bodyText.trim().length > 0 ? bodyText : attrText;
    entries.push({ id, text, index: safeIndex });
    return true;
  });
  entries.sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  return entries;
};

const collectKnownFootnotes = (editorHandle: EditorHandle) => {
  const editor = editorHandle.getEditor();
  const numbering = reconcileFootnotes(editor.state.doc as any).numbering;
  const seen = new Set<string>();
  const entries: Array<{
    id: string;
    kind: "footnote" | "endnote";
    index?: number;
    deleted?: boolean;
    citationId?: string;
  }> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "footnote") return true;
    const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
    if (!id) return true;
    if (seen.has(id)) return true;
    seen.add(id);
    const rawKind = typeof (node.attrs as any)?.kind === "string" ? String((node.attrs as any).kind) : "footnote";
    const kind: "footnote" | "endnote" = rawKind === "endnote" ? "endnote" : "footnote";
    const citationId = typeof (node.attrs as any)?.citationId === "string" ? String((node.attrs as any).citationId).trim() : "";
    const index = numbering.get(id);
    entries.push({ id, kind, index: typeof index === "number" ? index : undefined, deleted: false, citationId: citationId || undefined });
    return true;
  });
  entries.sort((a, b) => (a.index ?? 0) - (b.index ?? 0) || a.id.localeCompare(b.id));
  return entries;
};

const buildDefaultOptions = (): ExportLedocOptions => {
  const host = getHostContract();
  const base = sanitizeFilenameBase(host.documentTitle || "untitled");
  return {
    prompt: true,
    suggestedPath: `${base}.ledoc`
  };
};

const firstNonWhitespaceChar = (content: any[]): string | null => {
  for (const child of content || []) {
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    const match = text.match(/[^\s\u00A0\u2000-\u200B]/);
    if (match) return match[0];
  }
  return null;
};

const lastNonWhitespaceChar = (content: any[]): string | null => {
  for (let i = (content || []).length - 1; i >= 0; i -= 1) {
    const child = content[i];
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    const match = text.match(/[^\s\u00A0\u2000-\u200B](?!.*[^\s\u00A0\u2000-\u200B])/);
    if (match) return match[0];
  }
  return null;
};

const startsWithWhitespace = (content: any[]): boolean => {
  for (const child of content || []) {
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    return /^[\s\u00A0\u2000-\u200B]/.test(text);
  }
  return false;
};

const endsWithSpace = (content: any[]): boolean => {
  for (let i = (content || []).length - 1; i >= 0; i -= 1) {
    const child = content[i];
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    return /\s$/.test(text);
  }
  return false;
};

const trimLeadingWhitespace = (content: any[]): any[] => {
  const out = [...(content || [])];
  for (let i = 0; i < out.length; i += 1) {
    const child = out[i];
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    const trimmed = text.replace(/^[\s\u00A0\u2000-\u200B]+/, "");
    if (!trimmed) {
      out.splice(i, 1);
      i -= 1;
      continue;
    }
    if (trimmed !== text) {
      out[i] = { ...child, text: trimmed };
    }
    break;
  }
  return out;
};

const normalizeContinuationParagraphs = (doc: any): any => {
  if (!doc || typeof doc !== "object") return doc;
  if (!Array.isArray(doc.content)) return doc;
  let changed = false;
  for (const node of doc.content) {
    if (!node || node.type !== "page" || !Array.isArray(node.content)) continue;
    const merged: any[] = [];
    for (const block of node.content) {
      if (block?.type === "paragraph" && merged.length) {
        const prev = merged[merged.length - 1];
        if (prev?.type === "paragraph") {
          const prevContent = Array.isArray(prev.content) ? prev.content : [];
          const currContent = Array.isArray(block.content) ? block.content : [];
          const first = firstNonWhitespaceChar(currContent);
          const last = lastNonWhitespaceChar(prevContent);
          const startsLower = typeof first === "string" && /[a-z]/.test(first);
          const startsPunct = typeof first === "string" && /[),.;:!?\]]/.test(first);
          const startsSpace = startsWithWhitespace(currContent);
          const prevTerminal = typeof last === "string" && /[.!?]/.test(last);
          if (!prevTerminal && (startsSpace || startsLower || startsPunct)) {
            let nextContent = currContent;
            if (endsWithSpace(prevContent)) {
              nextContent = trimLeadingWhitespace(currContent);
            } else if (!startsPunct && !startsSpace) {
              prevContent.push({ type: "text", text: " " });
            }
            prev.content = [...prevContent, ...nextContent];
            changed = true;
            continue;
          }
        }
      }
      merged.push(block);
    }
    if (merged.length !== node.content.length) {
      node.content = merged;
    }
  }
  return changed ? doc : doc;
};

const buildLegacyPayloadV1 = (editorHandle: EditorHandle) => {
  const host = getHostContract();
  const now = new Date().toISOString();
  const page = getCurrentPageSize();
  const marginsCm = getMarginValuesCm();
  const sourceChecksThread = exportSourceChecksThreadForLedoc();
  const agentHistory = exportAgentHistoryForLedoc();
  const llmCache = exportLlmCacheForLedoc();
  return {
    document: editorHandle.getJSON(),
    meta: {
      version: LEDOC_FORMAT_VERSION,
      title: host.documentTitle || "Untitled document",
      authors: [],
      created: now,
      lastModified: now
    },
    settings: {
      pageSize: page.label,
      margins: {
        top: cmToPx(marginsCm.top),
        bottom: cmToPx(marginsCm.bottom),
        left: cmToPx(marginsCm.left),
        right: cmToPx(marginsCm.right)
      }
    },
    footnotes: {
      version: LEDOC_FORMAT_VERSION,
      footnotes: collectFootnotes(editorHandle)
    },
    history:
      (sourceChecksThread && typeof sourceChecksThread === "object") || agentHistory || llmCache
        ? {
            ...(sourceChecksThread && typeof sourceChecksThread === "object" ? { sourceChecksThread } : {}),
            ...(agentHistory ? { agentHistory } : {}),
            ...(llmCache ? { llmCache } : {})
          }
        : undefined
  };
};

const buildBundlePayloadV2 = (editorHandle: EditorHandle): LedocBundlePayload => {
  const host = getHostContract();
  const now = new Date().toISOString();
  const page = getCurrentPageSize();
  const marginsCm = getMarginValuesCm();
  const idState = debugFootnoteIdState();
  const sourceChecksThread = exportSourceChecksThreadForLedoc();
  const agentHistory = exportAgentHistoryForLedoc();
  const llmCache = exportLlmCacheForLedoc();
  const meta: LedocBundleMetaFile = {
    version: LEDOC_BUNDLE_VERSION,
    title: host.documentTitle || "Untitled document",
    authors: [],
    created: now,
    lastModified: now,
    sourceFormat: "bundle"
  };
  const layout: LedocBundleLayoutFile = {
    version: LEDOC_BUNDLE_VERSION,
    pageSize: page.label,
    margins: {
      unit: "cm",
      top: marginsCm.top,
      right: marginsCm.right,
      bottom: marginsCm.bottom,
      left: marginsCm.left
    },
    pagination: undefined,
    footnotes: undefined
  };
  const registry: LedocBundleRegistryFile = {
    version: LEDOC_BUNDLE_VERSION,
    footnoteIdState: { counters: idState.counters as any },
    knownFootnotes: collectKnownFootnotes(editorHandle),
    ...(sourceChecksThread && typeof sourceChecksThread === "object"
      ? { sourceChecksThread }
      : {}),
    ...(agentHistory ? { agentHistory } : {}),
    ...(llmCache ? { llmCache } : {})
  };
  const content = normalizeContinuationParagraphs(editorHandle.getJSON());
  return {
    version: LEDOC_BUNDLE_VERSION,
    content,
    meta,
    layout,
    registry
  };
};

registerPlugin({
  id: "export_ledoc",
  commands: {
    ExportLEDOC(editorHandle: EditorHandle, args?: { options?: ExportLedocOptions }) {
      const options = { ...buildDefaultOptions(), ...(args?.options ?? {}) };
      // Default to v2 bundle; host may still choose to write legacy v1 zip based on targetPath.
      void triggerExport({ payload: buildBundlePayloadV2(editorHandle), options }).catch((error: unknown) => {
        console.error("ExportLEDOC failed", error);
      });
    }
  },
  onInit(editorHandle: EditorHandle) {
    window.__leditorAutoExportLEDOC = (options?: ExportLedocOptions) => {
      const mergedOptions = { ...buildDefaultOptions(), ...(options ?? {}) };
      return triggerExport({ payload: buildBundlePayloadV2(editorHandle), options: mergedOptions });
    };
  }
});
