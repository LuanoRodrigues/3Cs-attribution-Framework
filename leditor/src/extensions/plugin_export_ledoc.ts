import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { ExportLedocOptions, ExportLedocRequest, ExportLedocResult } from "../api/export_ledoc.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import { LEDOC_FORMAT_VERSION, type LedocFootnoteEntry } from "../ledoc/format.ts";
import { getHostContract } from "../ui/host_contract.ts";
import { getCurrentPageSize, getMarginValuesCm } from "../ui/layout_settings.ts";
import { reconcileFootnotes } from "../uipagination/footnotes/registry.ts";

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
    const index = numbering.get(id) ?? entries.length + 1;
    const text = typeof (node.attrs as any)?.text === "string" ? String((node.attrs as any).text) : "";
    entries.push({ id, text, index });
    return true;
  });
  entries.sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  return entries;
};

const buildDefaultOptions = (): ExportLedocOptions => ({
  prompt: true,
  suggestedPath: `.codex_logs/exports/ledoc-${Date.now()}.ledoc`
});

const buildPayload = (editorHandle: EditorHandle) => {
  const host = getHostContract();
  const now = new Date().toISOString();
  const page = getCurrentPageSize();
  const marginsCm = getMarginValuesCm();
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
    }
  };
};

registerPlugin({
  id: "export_ledoc",
  commands: {
    ExportLEDOC(editorHandle: EditorHandle, args?: { options?: ExportLedocOptions }) {
      const options = { ...buildDefaultOptions(), ...(args?.options ?? {}) };
      void triggerExport({ payload: buildPayload(editorHandle), options }).catch((error: unknown) => {
        console.error("ExportLEDOC failed", error);
      });
    }
  },
  onInit(editorHandle: EditorHandle) {
    window.__leditorAutoExportLEDOC = (options?: ExportLedocOptions) => {
      const mergedOptions = { ...buildDefaultOptions(), ...(options ?? {}) };
      return triggerExport({ payload: buildPayload(editorHandle), options: mergedOptions });
    };
  }
});
