import { app } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import type { DataHubCollection, DataHubLoadResult, DataHubTable } from "../../shared/types/dataHub";

export interface DataHubLoadRequest {
  sourceType: "zotero" | "file";
  filePath?: string;
  collectionName?: string;
  zotero?: { libraryId: string; libraryType: string; apiKey: string };
  cacheDir?: string;
  cache?: boolean;
  maxRows?: number;
}

export interface DataHubListCollectionsRequest {
  zotero: { libraryId: string; libraryType: string; apiKey: string };
}

export interface DataHubExportExcelRequest {
  filePath: string;
  table: DataHubTable;
}

const resolvePythonBinary = (): string => {
  const candidate = process.env.PYTHON || process.env.PYTHON3;
  if (candidate && candidate.trim()) {
    return candidate.trim();
  }
  return process.platform === "win32" ? "python" : "python3";
};

const resolveHostScript = (): string => {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, "backend", "datahub_host.py"),
    path.join(appPath, "src", "pages", "retrieve", "datahub_host.py"),
    path.join(appPath, "..", "src", "pages", "retrieve", "datahub_host.py"),
    path.join(appPath, "..", "..", "src", "pages", "retrieve", "datahub_host.py")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
};

const runPythonTask = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const python = resolvePythonBinary();
  const script = resolveHostScript();
  if (!fs.existsSync(script)) {
    return { status: "error", message: `Missing data hub host script: ${script}` };
  }
  return new Promise((resolve) => {
    const child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ status: "error", message: error.message });
    });
    child.on("close", (code) => {
      const out = stdout.trim();
      const err = stderr.trim();
      if (code !== 0 && !out) {
        resolve({
          status: "error",
          message: err || `python exited with ${code}`
        });
        return;
      }
      try {
        const parsed = JSON.parse(out || "{}");
        if (err) {
          parsed.stderr = err;
        }
        resolve(parsed);
      } catch (error) {
        resolve({
          status: "error",
          message: `Invalid response from python (${error instanceof Error ? error.message : "parse error"})`,
          raw: out,
          stderr: err
        });
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
};

const defaultCacheDir = (): string => {
  return path.join(app.getPath("userData"), "data-hub-cache");
};

export const invokeDataHubLoad = async (request: DataHubLoadRequest): Promise<DataHubLoadResult> => {
  const cacheDir = request.cacheDir || defaultCacheDir();
  const payload = {
    action: "load",
    sourceType: request.sourceType,
    filePath: request.filePath,
    collectionName: request.collectionName,
    zotero: request.zotero,
    cacheDir,
    cache: request.cache ?? true,
    // When absent, the python host loads the full dataset. The renderer table uses virtualization.
    ...(typeof request.maxRows === "number" ? { maxRows: request.maxRows } : {})
  };
  const response = await runPythonTask(payload);
  return response as DataHubLoadResult;
};

export const invokeDataHubListCollections = async (
  request: DataHubListCollectionsRequest
): Promise<{ collections: DataHubCollection[]; message?: string }> => {
  const response = await runPythonTask({ action: "list_collections", zotero: request.zotero });
  const collections = Array.isArray(response.collections) ? (response.collections as DataHubCollection[]) : [];
  return { collections, message: typeof response.message === "string" ? response.message : undefined };
};

export const invokeDataHubExportExcel = async (
  request: DataHubExportExcelRequest
): Promise<{ status?: string; message?: string; path?: string }> => {
  const response = await runPythonTask({
    action: "export_excel",
    filePath: request.filePath,
    table: request.table
  });
  return response as { status?: string; message?: string; path?: string };
};
