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
import { debugFootnoteIdState } from "../uipagination/footnotes/footnote_id_generator.ts";

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
    const text = typeof (node.attrs as any)?.text === "string" ? String((node.attrs as any).text) : "";
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

const buildLegacyPayloadV1 = (editorHandle: EditorHandle) => {
  const host = getHostContract();
  const now = new Date().toISOString();
  const page = getCurrentPageSize();
  const marginsCm = getMarginValuesCm();
  const sourceChecksThread = exportSourceChecksThreadForLedoc();
  const agentHistory = exportAgentHistoryForLedoc();
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
      (sourceChecksThread && typeof sourceChecksThread === "object") || agentHistory
        ? {
            ...(sourceChecksThread && typeof sourceChecksThread === "object" ? { sourceChecksThread } : {}),
            ...(agentHistory ? { agentHistory } : {})
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
    ...(agentHistory ? { agentHistory } : {})
  };
  return {
    version: LEDOC_BUNDLE_VERSION,
    content: editorHandle.getJSON(),
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
