import { contextBridge, ipcRenderer } from "electron";

const dbg = (fn: string, msg: string, extra?: Record<string, unknown>) => {
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

const readFile = async (request: { sourcePath: string }) => {
  return invoke<typeof request, any>("leditor:read-file", request);
};

const fileExists = async (request: { sourcePath: string }) => {
  return invoke<typeof request, any>("leditor:file-exists", request);
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

const getAiStatus = async () => {
  return invoke<void, any>("leditor:ai-status", undefined as any);
};

const getLlmStatus = async () => {
  return invoke<void, any>("leditor:llm-status", undefined as any);
};

const getLlmCatalog = async () => {
  return invoke<void, any>("leditor:llm-catalog", undefined as any);
};

const agentRequest = async (request: { requestId?: string; payload: Record<string, unknown> }) => {
  return invoke<typeof request, any>("leditor:agent-request", request);
};

const agentCancel = async (request: { requestId: string }) => {
  return invoke<typeof request, any>("leditor:agent-cancel", request);
};

const checkSources = async (request: { requestId?: string; payload: Record<string, unknown> }) => {
  return invoke<typeof request, any>("leditor:check-sources", request);
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
  writeFile,
  exportLEDOC,
  importLEDOC,
  agentRequest,
  agentCancel,
  checkSources,
  lexicon,
  openPdfViewer,
  resolvePdfPathForItemKey,
  getDirectQuoteEntry,
  prefetchDirectQuotes
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
