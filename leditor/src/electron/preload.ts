import { contextBridge, ipcRenderer } from "electron";

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

const readFile = async (request: { sourcePath: string }) => {
  return ipcRenderer.invoke("leditor:read-file", request);
};

const fileExists = async (request: { sourcePath: string }) => {
  return ipcRenderer.invoke("leditor:file-exists", request);
};

const writeFile = async (request: { targetPath: string; data: string }) => {
  return ipcRenderer.invoke("leditor:write-file", request);
};

const agentRequest = async (request: { payload: Record<string, unknown> }) => {
  return ipcRenderer.invoke("leditor:agent-request", request);
};

const openPdfViewer = async (request: { payload: Record<string, unknown> }) => {
  return ipcRenderer.invoke("leditor:open-pdf-viewer", request);
};

const resolvePdfPathForItemKey = async (request: { lookupPath: string; itemKey: string }) => {
  return ipcRenderer.invoke("leditor:resolve-pdf-path", request);
};

const getDirectQuoteEntry = async (request: { lookupPath: string; dqid: string }) => {
  return ipcRenderer.invoke("leditor:get-direct-quote-entry", request);
};

const prefetchDirectQuotes = async (request: { lookupPath: string; dqids: string[] }) => {
  return ipcRenderer.invoke("leditor:prefetch-direct-quotes", request);
};

const PDF_VIEWER_TOKEN_FLAG = "--pdf-viewer-token=";
const viewerTokenArg = process.argv.find((value) => value?.startsWith?.(PDF_VIEWER_TOKEN_FLAG));
const viewerToken = viewerTokenArg ? viewerTokenArg.slice(PDF_VIEWER_TOKEN_FLAG.length) : "";
const getPdfViewerPayload = async (): Promise<Record<string, unknown> | null> => {
  if (!viewerToken) return null;
  return ipcRenderer.invoke("leditor:pdf-viewer-payload", { token: viewerToken });
};

contextBridge.exposeInMainWorld("leditorHost", {
  writePhaseMarker: async () => undefined,
  openFootnotePanel: () => undefined,
  toggleFootnotePanel: () => undefined,
  closeFootnotePanel: () => undefined,
  registerFootnoteHandlers: () => undefined,
  readFile,
  fileExists,
  writeFile,
  agentRequest,
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
