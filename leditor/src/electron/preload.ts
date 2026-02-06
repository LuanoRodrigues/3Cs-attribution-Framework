import { contextBridge, ipcRenderer } from "electron";

const DEBUG_LOGS = process.env.LEDITOR_DEBUG === "1";

const dbg = (fn: string, msg: string, extra?: Record<string, unknown>) => {
  if (!DEBUG_LOGS) return;
  const line = `[preload.ts][${fn}][debug] ${msg}`;
  if (extra) {
    console.debug(line, extra);
  } else {
    console.debug(line);
  }
};

const summarizeInvokeRequest = (channel: string, request: unknown): Record<string, unknown> => {
  if (!request || typeof request !== "object") return { channel, requestType: typeof request };
  const obj = request as any;
  switch (channel) {
    case "leditor:ai-status":
      return { channel };
    case "leditor:llm-status":
    case "leditor:llm-catalog":
      return { channel };
    case "leditor:check-sources": {
      const payload = obj?.payload as any;
      return {
        channel,
        requestIdLen: typeof obj?.requestId === "string" ? obj.requestId.length : 0,
        provider: typeof payload?.provider === "string" ? payload.provider : "unknown",
        model: typeof payload?.model === "string" ? payload.model : "unknown",
        paragraphTextLen: typeof payload?.paragraphText === "string" ? payload.paragraphText.length : 0,
        anchorsLen: Array.isArray(payload?.anchors) ? payload.anchors.length : 0,
        anchorsWithContext:
          Array.isArray(payload?.anchors) ? payload.anchors.filter((a: any) => a && typeof a === "object" && a.context).length : 0
      };
    }
    case "leditor:lexicon": {
      const payload = obj?.payload as any;
      return {
        channel,
        requestIdLen: typeof obj?.requestId === "string" ? obj.requestId.length : 0,
        provider: typeof payload?.provider === "string" ? payload.provider : "unknown",
        model: typeof payload?.model === "string" ? payload.model : "unknown",
        mode: typeof payload?.mode === "string" ? payload.mode : "unknown",
        textLen: typeof payload?.text === "string" ? payload.text.length : 0
      };
    }
    case "leditor:read-file":
    case "leditor:file-exists":
      return { channel, sourcePathLen: typeof obj?.sourcePath === "string" ? obj.sourcePath.length : 0 };
    case "leditor:write-file":
      return {
        channel,
        targetPathLen: typeof obj?.targetPath === "string" ? obj.targetPath.length : 0,
        dataLen: typeof obj?.data === "string" ? obj.data.length : 0
      };
    case "leditor:export-ledoc":
      return {
        channel,
        hasPayload: Boolean(obj?.payload && typeof obj.payload === "object"),
        targetPathLen: typeof obj?.options?.targetPath === "string" ? obj.options.targetPath.length : 0,
        suggestedPathLen: typeof obj?.options?.suggestedPath === "string" ? obj.options.suggestedPath.length : 0,
        prompt: Boolean(obj?.options?.prompt)
      };
    case "leditor:import-ledoc":
      return {
        channel,
        sourcePathLen: typeof obj?.options?.sourcePath === "string" ? obj.options.sourcePath.length : 0,
        prompt: Boolean(obj?.options?.prompt)
      };
	    case "leditor:agent-request": {
	      const payload = obj?.payload as any;
	      return {
	        channel,
	        scope: typeof payload?.scope === "string" ? payload.scope : "unknown",
	        instructionLen: typeof payload?.instruction === "string" ? payload.instruction.length : 0,
	        selectionTextLen: typeof payload?.selection?.text === "string" ? payload.selection.text.length : 0,
	        documentTextLen: typeof payload?.document?.text === "string" ? payload.document.text.length : 0,
	        historyLen: Array.isArray(payload?.history) ? payload.history.length : 0,
	        targetsLen: Array.isArray(payload?.targets) ? payload.targets.length : 0
	      };
	    }
    case "leditor:open-pdf-viewer":
      return { channel, payloadKeys: obj?.payload && typeof obj.payload === "object" ? Object.keys(obj.payload).length : 0 };
    case "leditor:resolve-pdf-path":
      return {
        channel,
        lookupPathLen: typeof obj?.lookupPath === "string" ? obj.lookupPath.length : 0,
        itemKeyLen: typeof obj?.itemKey === "string" ? obj.itemKey.length : 0
      };
    case "leditor:get-direct-quote-entry":
      return {
        channel,
        lookupPathLen: typeof obj?.lookupPath === "string" ? obj.lookupPath.length : 0,
        dqidLen: typeof obj?.dqid === "string" ? obj.dqid.length : 0
      };
    case "leditor:search-direct-quotes":
      return {
        channel,
        lookupPathLen: typeof obj?.lookupPath === "string" ? obj.lookupPath.length : 0,
        queryLen: typeof obj?.query === "string" ? obj.query.length : 0,
        hasFilters: Boolean(obj?.filters && typeof obj.filters === "object")
      };
    case "leditor:get-direct-quote-filters":
      return {
        channel,
        lookupPathLen: typeof obj?.lookupPath === "string" ? obj.lookupPath.length : 0
      };
    case "leditor:prefetch-direct-quotes":
      return {
        channel,
        lookupPathLen: typeof obj?.lookupPath === "string" ? obj.lookupPath.length : 0,
        dqids: Array.isArray(obj?.dqids) ? obj.dqids.length : 0
      };
    case "leditor:pdf-viewer-payload":
      return { channel, tokenLen: typeof obj?.token === "string" ? obj.token.length : 0 };
    default:
      return { channel, keys: Object.keys(obj).length };
  }
};

const summarizeInvokeResult = (_channel: string, result: unknown): Record<string, unknown> => {
  if (result == null) return { result: null };
  if (typeof result !== "object") return { resultType: typeof result };
  const obj = result as any;
  return {
    success: typeof obj?.success === "boolean" ? obj.success : undefined,
    hasError: typeof obj?.error === "string" ? obj.error.length > 0 : undefined,
    dataLen: typeof obj?.data === "string" ? obj.data.length : undefined
  };
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resolveUiScale = (host: any): number => {
  const fromHost = typeof host?.uiScale === "number" && Number.isFinite(host.uiScale) ? host.uiScale : null;
  const fromArg = (() => {
    try {
      const raw = (process.argv || []).find((v) => typeof v === "string" && v.startsWith("--ui-scale="));
      if (!raw) return null;
      const parsed = Number(raw.slice("--ui-scale=".length));
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  })();
  const fromEnv = (() => {
    const raw = String(process.env.LEDITOR_UI_SCALE || "").trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const chosen = fromHost ?? fromArg ?? fromEnv ?? 1.8;
  return clamp(chosen, 0.75, 4.0);
};

const invoke = async <TReq, TRes>(channel: string, request: TReq): Promise<TRes> => {
  const started = Date.now();
  dbg("invoke", `ipcRenderer.invoke ${channel}`, summarizeInvokeRequest(channel, request));
  try {
    const result = (await ipcRenderer.invoke(channel, request)) as TRes;
    dbg("invoke", `ipcRenderer.invoke ${channel} done`, {
      ms: Date.now() - started,
      ...summarizeInvokeResult(channel, result)
    });
    return result;
  } catch (error) {
    dbg("invoke", `ipcRenderer.invoke ${channel} threw`, {
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

const LEDITOR_HOST_FLAG = "--leditor-host=";
const encodedHostArg = process.argv.find((value) => value?.startsWith?.(LEDITOR_HOST_FLAG));
const decodeHostContract = (): { [key: string]: unknown } | null => {
  if (!encodedHostArg) {
    return null;
  }
  try {
    const payload = encodedHostArg.slice(LEDITOR_HOST_FLAG.length);
    return JSON.parse(decodeURIComponent(payload));
  } catch {
    return null;
  }
};
const hostContract =
  decodeHostContract() ??
  ({
    version: 1,
    sessionId: "local-session",
    documentId: "local-document",
    documentTitle: "Untitled document",
    uiScale: 1.8,
    paths: {
      contentDir: "",
      bibliographyDir: "",
      tempDir: ""
    },
    inputs: {
      directQuoteJsonPath: ""
    },
    policy: {
      allowDiskWrites: false
    }
  } as const);

contextBridge.exposeInMainWorld("__leditorHost", hostContract);
dbg("init", "host contract ready", {
  version: (hostContract as any).version,
  sessionId: (hostContract as any).sessionId,
  documentId: (hostContract as any).documentId,
  hasContentDir: Boolean((hostContract as any)?.paths?.contentDir),
  hasBibliographyDir: Boolean((hostContract as any)?.paths?.bibliographyDir)
});

const uiScale = resolveUiScale(hostContract as any);
contextBridge.exposeInMainWorld("leditorUiScale", uiScale);
dbg("init", "ui scale ready", { uiScale });

const readFile = async (request: { sourcePath: string }) => {
  return invoke<typeof request, any>("leditor:read-file", request);
};

const fileExists = async (request: { sourcePath: string }) => {
  return invoke<typeof request, any>("leditor:file-exists", request);
};

const getDefaultLEDOCPath = async (): Promise<string> => {
  const result = await invoke<Record<string, never>, any>("leditor:get-default-ledoc-path", {} as any);
  const value = typeof result?.path === "string" ? result.path.trim() : "";
  if (result?.success && value) return value;
  const error = typeof result?.error === "string" && result.error.trim() ? result.error.trim() : "Default LEDOC path unavailable";
  throw new Error(error);
};

const writeFile = async (request: { targetPath: string; data: string }) => {
  return invoke<typeof request, any>("leditor:write-file", request);
};

const exportLEDOC = async (request: Record<string, unknown>) => {
  return invoke<typeof request, any>("leditor:export-ledoc", request as any);
};

const importLEDOC = async (request: Record<string, unknown>) => {
  return invoke<typeof request, any>("leditor:import-ledoc", request as any);
};

const listLedocVersions = async (request: { ledocPath: string }) => {
  return invoke<typeof request, any>("leditor:versions:list", request as any);
};

const createLedocVersion = async (request: {
  ledocPath: string;
  reason?: string;
  label?: string;
  note?: string;
  payload?: any;
  throttleMs?: number;
  force?: boolean;
}) => {
  return invoke<typeof request, any>("leditor:versions:create", request as any);
};

const restoreLedocVersion = async (request: { ledocPath: string; versionId: string; mode?: "replace" | "copy" }) => {
  return invoke<typeof request, any>("leditor:versions:restore", request as any);
};

const deleteLedocVersion = async (request: { ledocPath: string; versionId: string }) => {
  return invoke<typeof request, any>("leditor:versions:delete", request as any);
};

const pinLedocVersion = async (request: { ledocPath: string; versionId: string; pinned: boolean }) => {
  return invoke<typeof request, any>("leditor:versions:pin", request as any);
};

const getAiStatus = async () => {
  return invoke<void, any>("leditor:ai-status", undefined as any);
};

const getLlmStatus = async () => {
  return invoke<void, any>("leditor:llm-status", undefined as any);
};

const getLlmCatalog = async () => {
  return invoke<void, any>("leditor:llm-catalog", undefined as any);
};

const agentRun = async (request: { requestId?: string; payload: Record<string, unknown> }) => {
  return invoke<typeof request, any>("leditor:agent-run", request);
};

const agentRequest = async (request: { requestId?: string; payload: Record<string, unknown> }) => {
  return invoke<typeof request, any>("leditor:agent-request", request);
};

const agentCancel = async (request: { requestId: string }) => {
  return invoke<typeof request, any>("leditor:agent-cancel", request);
};

const onAgentStreamUpdate = (handler: (payload: Record<string, unknown>) => void) => {
  const listener = (_event: any, payload: any) => {
    if (payload && typeof payload === "object") {
      handler(payload as Record<string, unknown>);
    }
  };
  ipcRenderer.on("leditor:agent-stream-update", listener);
  return () => {
    ipcRenderer.off("leditor:agent-stream-update", listener);
  };
};

const onLexiconStreamUpdate = (handler: (payload: Record<string, unknown>) => void) => {
  const listener = (_event: any, payload: any) => {
    if (payload && typeof payload === "object") {
      handler(payload as Record<string, unknown>);
    }
  };
  ipcRenderer.on("leditor:lexicon-stream-update", listener);
  return () => {
    ipcRenderer.off("leditor:lexicon-stream-update", listener);
  };
};

const onSubstantiateStreamUpdate = (handler: (payload: Record<string, unknown>) => void) => {
  const listener = (_event: any, payload: any) => {
    if (payload && typeof payload === "object") {
      handler(payload as Record<string, unknown>);
    }
  };
  ipcRenderer.on("leditor:substantiate-stream-update", listener);
  return () => {
    ipcRenderer.off("leditor:substantiate-stream-update", listener);
  };
};

const checkSources = async (request: { requestId?: string; payload: Record<string, unknown> }) => {
  return invoke<typeof request, any>("leditor:check-sources", request);
};

const substantiateAnchors = async (request: { requestId?: string; stream?: boolean; payload: Record<string, unknown> }) => {
  return invoke<typeof request, any>("leditor:substantiate-anchors", request);
};

const lexicon = async (request: { requestId?: string; payload: Record<string, unknown> }) => {
  return invoke<typeof request, any>("leditor:lexicon", request);
};

const openPdfViewer = async (request: { payload: Record<string, unknown> }) => {
  return invoke<typeof request, any>("leditor:open-pdf-viewer", request);
};

const resolvePdfPathForItemKey = async (request: { lookupPath: string; itemKey: string }) => {
  return invoke<typeof request, any>("leditor:resolve-pdf-path", request);
};

const getDirectQuoteEntry = async (request: { lookupPath: string; dqid: string }) => {
  return invoke<typeof request, any>("leditor:get-direct-quote-entry", request);
};

const prefetchDirectQuotes = async (request: { lookupPath: string; dqids: string[] }) => {
  return invoke<typeof request, any>("leditor:prefetch-direct-quotes", request);
};

const searchDirectQuotes = async (request: {
  lookupPath: string;
  query: string;
  limit?: number;
  maxScan?: number;
  filters?: {
    evidenceTypes?: string[];
    themes?: string[];
    researchQuestions?: string[];
    authors?: string[];
    years?: number[];
    yearFrom?: number;
    yearTo?: number;
  };
}) => {
  return invoke<typeof request, any>("leditor:search-direct-quotes", request);
};

const getDirectQuoteFilters = async (request: { lookupPath: string; maxScan?: number }) => {
  return invoke<typeof request, any>("leditor:get-direct-quote-filters", request);
};

const PDF_VIEWER_TOKEN_FLAG = "--pdf-viewer-token=";
const viewerTokenArg = process.argv.find((value) => value?.startsWith?.(PDF_VIEWER_TOKEN_FLAG));
const viewerToken = viewerTokenArg ? viewerTokenArg.slice(PDF_VIEWER_TOKEN_FLAG.length) : "";
dbg("init", "pdf viewer token", { present: Boolean(viewerToken), len: viewerToken.length });
const getPdfViewerPayload = async (): Promise<Record<string, unknown> | null> => {
  if (!viewerToken) return null;
  return invoke<{ token: string }, any>("leditor:pdf-viewer-payload", { token: viewerToken });
};

contextBridge.exposeInMainWorld("leditorHost", {
  writePhaseMarker: async () => undefined,
  openFootnotePanel: () => undefined,
  toggleFootnotePanel: () => undefined,
  closeFootnotePanel: () => undefined,
  registerFootnoteHandlers: () => undefined,
  getAiStatus,
  getLlmStatus,
  getLlmCatalog,
  readFile,
  fileExists,
  getDefaultLEDOCPath,
  writeFile,
  exportDOCX: (request: { docJson: object; options?: Record<string, unknown> }) =>
    invoke("leditor:export-docx", request),
  exportPDF: (request: { html: string; options?: { suggestedPath?: string; prompt?: boolean } }) =>
    invoke("leditor:export-pdf", request),
  exportLEDOC,
  importDOCX: (request?: { options?: { sourcePath?: string; prompt?: boolean } }) =>
    invoke("leditor:import-docx", request ?? {}),
  importLEDOC,
  insertImage: () => invoke("leditor:insert-image", {}),
  listLedocVersions,
  createLedocVersion,
  restoreLedocVersion,
  deleteLedocVersion,
  pinLedocVersion,
  agentRun,
  agentRequest,
  agentCancel,
  onAgentStreamUpdate,
  onLexiconStreamUpdate,
  onSubstantiateStreamUpdate,
  checkSources,
  substantiateAnchors,
  lexicon,
  openPdfViewer,
  resolvePdfPathForItemKey,
  getDirectQuoteEntry,
  prefetchDirectQuotes,
  searchDirectQuotes,
  getDirectQuoteFilters
});

const onPdfViewerPayload = (handler: (payload: Record<string, unknown>) => void) => {
  ipcRenderer.on("leditor:pdf-viewer-payload", (_event, payload) => {
    if (payload && typeof payload === "object") {
      handler(payload as Record<string, unknown>);
    }
  });
};

contextBridge.exposeInMainWorld("leditorPdfViewer", {
  getPayload: getPdfViewerPayload,
  onPayload: onPdfViewerPayload
});
