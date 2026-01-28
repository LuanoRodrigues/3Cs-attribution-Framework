export type HostContract = {
  version: number;
  sessionId: string;
  documentId: string;
  documentTitle: string;
  paths: {
    contentDir: string;
    bibliographyDir: string;
    tempDir: string;
  };
  inputs: {
    directQuoteJsonPath: string;
  };
  policy: {
    allowDiskWrites: boolean;
  };
};

const fallbackContract: HostContract = {
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
};

export const getHostContract = (): HostContract => {
  const host = window.__leditorHost;
  if (host && typeof host === "object") {
    return host as HostContract;
  }
  return fallbackContract;
};
