import { app } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import type { DataHubTable } from "../../shared/types/dataHub";

export interface VisualisePreviewRequest {
  table: DataHubTable;
  include?: string[];
  params?: Record<string, unknown>;
  selection?: { sections?: string[]; slideIds?: string[] };
  collectionName?: string;
  mode?: string;
}

export interface VisualiseExportPptxRequest {
  table: DataHubTable;
  include?: string[];
  params?: Record<string, unknown>;
  selection?: { sections?: string[]; slideIds?: string[] };
  collectionName?: string;
  outputPath: string;
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
  const pythonBackendPath = path.join(appPath, "shared", "python_backend", "visualise", "visualise_host.py");
  const candidates = [
    pythonBackendPath,
    path.join(appPath, "..", "shared", "python_backend", "visualise", "visualise_host.py"),
    path.join(appPath, "..", "..", "shared", "python_backend", "visualise", "visualise_host.py"),
    path.join(appPath, "backend", "visualise_host.py"),
    path.join(appPath, "src", "pages", "visualise", "visualise_host.py"),
    path.join(appPath, "..", "src", "pages", "visualise", "visualise_host.py"),
    path.join(appPath, "..", "..", "src", "pages", "visualise", "visualise_host.py")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
};

const splitLines = (text: string): string[] => {
  return String(text || "")
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
};

const parsePythonJson = (stdout: string): { parsed?: Record<string, unknown>; extraLogs: string[] } => {
  const raw = (stdout || "").trim();
  if (!raw) {
    return { parsed: {}, extraLogs: [] };
  }
  try {
    return { parsed: JSON.parse(raw), extraLogs: [] };
  } catch {
    // If python printed debug lines, try parsing the last JSON-looking line and treat the rest as logs.
    const lines = raw.split(/\r?\n/g).filter((l) => l.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const candidate = lines[i].trim();
      if (!(candidate.startsWith("{") && candidate.endsWith("}"))) {
        continue;
      }
      try {
        const parsed = JSON.parse(candidate);
        const extraLogs = lines.slice(0, i);
        return { parsed, extraLogs };
      } catch {
        // continue
      }
    }
  }
  return { extraLogs: splitLines(raw) };
};

const runPythonTask = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const python = resolvePythonBinary();
  const script = resolveHostScript();
  if (!fs.existsSync(script)) {
    return { status: "error", message: `Missing visualise host script: ${script}` };
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
      if (code !== 0 && !stdout.trim()) {
        resolve({
          status: "error",
          message: stderr.trim() || `python exited with ${code}`,
          pythonLogs: splitLines(stderr)
        });
        return;
      }
      const { parsed, extraLogs } = parsePythonJson(stdout);
      const stderrLogs = splitLines(stderr);
      const pythonLogs = [...extraLogs, ...stderrLogs];
      if (parsed) {
        resolve({ ...(parsed as any), pythonLogs });
        return;
      }
      resolve({
        status: "error",
        message: "Invalid response from python (parse error)",
        raw: stdout.trim(),
        stderr: stderr.trim(),
        pythonLogs
      });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
};

export const invokeVisualiseSections = async (): Promise<Record<string, unknown>> => {
  return runPythonTask({ action: "sections" });
};

export const invokeVisualisePreview = async (request: VisualisePreviewRequest): Promise<Record<string, unknown>> => {
  return runPythonTask({
    action: "preview",
    table: request.table,
    include: request.include ?? [],
    params: request.params ?? {},
    selection: request.selection ?? undefined,
    collectionName: request.collectionName,
    mode: request.mode
  });
};

export const invokeVisualiseExportPptx = async (request: VisualiseExportPptxRequest): Promise<Record<string, unknown>> => {
  return runPythonTask({
    action: "export_pptx",
    table: request.table,
    include: request.include ?? [],
    params: request.params ?? {},
    selection: request.selection ?? undefined,
    collectionName: request.collectionName,
    outputPath: request.outputPath
  });
};
