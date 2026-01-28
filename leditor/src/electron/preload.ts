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

const writeFile = async (request: { targetPath: string; data: string }) => {
  return ipcRenderer.invoke("leditor:write-file", request);
};

contextBridge.exposeInMainWorld("leditorHost", {
  writePhaseMarker: async () => undefined,
  openFootnotePanel: () => undefined,
  toggleFootnotePanel: () => undefined,
  closeFootnotePanel: () => undefined,
  registerFootnoteHandlers: () => undefined,
  readFile,
  writeFile
});
