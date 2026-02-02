import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { ImportLedocOptions, ImportLedocResult } from "../api/import_ledoc.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import { getPageSizeDefinitions, setPageMargins, setPageSize } from "../ui/layout_settings.ts";
import { loadSourceChecksThreadFromLedoc } from "../ui/source_checks_thread.ts";

const triggerImport = (options?: ImportLedocOptions) => {
  const handler = getHostAdapter()?.importLEDOC;
  if (!handler) {
    return Promise.reject(new Error("ImportLEDOC handler is unavailable"));
  }
  return handler({ options });
};

const pxToCm = (px: number): number => (px / 96) * 2.54;
const pickMarginCm = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
};

const applySettings = (settings: any) => {
  if (!settings || typeof settings !== "object") return;
  const pageSizeRaw = typeof settings.pageSize === "string" ? settings.pageSize.trim() : "";
  const sizes = getPageSizeDefinitions();
  const match = sizes.find(
    (s) => s.label.toLowerCase() === pageSizeRaw.toLowerCase() || s.id.toLowerCase() === pageSizeRaw.toLowerCase()
  );
  if (match) {
    setPageSize(match.id);
  }
  const margins = settings.margins && typeof settings.margins === "object" ? settings.margins : null;
  if (margins) {
    const rawTop = typeof (margins as any).top === "number" ? (margins as any).top : undefined;
    const rawRight = typeof (margins as any).right === "number" ? (margins as any).right : undefined;
    const rawBottom = typeof (margins as any).bottom === "number" ? (margins as any).bottom : undefined;
    const rawLeft = typeof (margins as any).left === "number" ? (margins as any).left : undefined;
    const topCm =
      pickMarginCm((margins as any).topCm ?? (margins as any).top_cm ?? (margins as any).topcm) ??
      (typeof rawTop === "number" ? pxToCm(rawTop) : undefined);
    const rightCm =
      pickMarginCm((margins as any).rightCm ?? (margins as any).right_cm ?? (margins as any).rightcm) ??
      (typeof rawRight === "number" ? pxToCm(rawRight) : undefined);
    const bottomCm =
      pickMarginCm((margins as any).bottomCm ?? (margins as any).bottom_cm ?? (margins as any).bottomcm) ??
      (typeof rawBottom === "number" ? pxToCm(rawBottom) : undefined);
    const leftCm =
      pickMarginCm((margins as any).leftCm ?? (margins as any).left_cm ?? (margins as any).leftcm) ??
      (typeof rawLeft === "number" ? pxToCm(rawLeft) : undefined);
    setPageMargins({
      top: topCm,
      right: rightCm,
      bottom: bottomCm,
      left: leftCm
    });
  }
};

const deriveTitle = (result: ImportLedocResult): string | null => {
  const payloadTitle =
    typeof (result as any)?.payload?.meta?.title === "string" && (result as any).payload.meta.title.trim()
      ? (result as any).payload.meta.title.trim()
      : null;
  if (payloadTitle) return payloadTitle;
  const pathValue = typeof result.filePath === "string" ? result.filePath : "";
  if (!pathValue) return null;
  const normalized = pathValue.replace(/\\\\/g, "/");
  const base = normalized.split("/").pop() ?? "";
  if (!base) return null;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

const applyImportedTitle = (result: ImportLedocResult) => {
  const title = deriveTitle(result);
  if (!title) return;
  try {
    document.title = `LEditor — ${title}`;
  } catch {
    // ignore
  }
  try {
    const host = (window as typeof window & { __leditorHost?: any }).__leditorHost;
    if (host && typeof host === "object") {
      host.documentTitle = title;
    }
  } catch {
    // ignore
  }
};

const tryImportFromDroppedFile = (file: File, editorHandle: EditorHandle) => {
  const anyFile = file as any;
  const path = typeof anyFile?.path === "string" ? String(anyFile.path) : "";
  if (!path) return;
  void triggerImport({ sourcePath: path, prompt: false })
    .then((result) => {
      if (!result?.success) return;
      const documentJson = (result as any)?.payload?.document;
      if (documentJson) {
        editorHandle.setContent(documentJson, { format: "json" });
      }
      applySettings((result as any)?.payload?.settings);
    })
    .catch(() => {});
};

registerPlugin({
  id: "import_ledoc",
  commands: {
    ImportLEDOC(editorHandle: EditorHandle, args?: { options?: ImportLedocOptions }) {
      void triggerImport(args?.options)
        .then((result: ImportLedocResult) => {
          if (!result?.success) {
            console.error("ImportLEDOC failed", result?.error);
            return;
          }
          const doc = result.payload?.document;
          if (doc) {
            editorHandle.setContent(doc, { format: "json" });
          }
          applyImportedTitle(result);
          if (result.payload?.settings) {
            applySettings(result.payload.settings);
          }
          try {
            loadSourceChecksThreadFromLedoc((result as any)?.payload?.history);
          } catch {
            // ignore
          }
          if (result.warnings?.length) {
            console.warn("ImportLEDOC warnings", result.warnings);
          }
        })
        .catch((error) => {
          console.error("ImportLEDOC failed", error);
        });
    }
  },
  onInit(editorHandle: EditorHandle) {
    window.__leditorAutoImportLEDOC = (options?: ImportLedocOptions) => {
      return triggerImport(options).then((result) => {
        if (!result.success) {
          return Promise.reject(new Error(result.error ?? "ImportLEDOC failed"));
        }
        if (result.payload?.document) {
          editorHandle.setContent(result.payload.document, { format: "json" });
        }
        applyImportedTitle(result);
        if (result.payload?.settings) {
          applySettings(result.payload.settings);
        }
        try {
          loadSourceChecksThreadFromLedoc((result as any)?.payload?.history);
        } catch {
          // ignore
        }
        return result;
      });
    };

    const isImportable = (fileName: string): boolean => {
      const lower = fileName.toLowerCase();
      return lower.endsWith(".ledoc") || lower.endsWith(".json");
    };

    const onDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      const first = files.find((file) => isImportable(String(file.name || "")));
      if (!first) return;
      event.preventDefault();
      tryImportFromDroppedFile(first, editorHandle);
    };
    const onDragOver = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      const hasImportable = files.some((file) => isImportable(String(file.name || "")));
      if (!hasImportable) return;
      event.preventDefault();
    };
    document.addEventListener("drop", onDrop);
    document.addEventListener("dragover", onDragOver);
  }
});
