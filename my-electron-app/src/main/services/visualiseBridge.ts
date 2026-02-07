import { app } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import type { DataHubTable } from "../../shared/types/dataHub";

export interface VisualisePreviewRequest {
  table?: DataHubTable;
  include?: string[];
  params?: Record<string, unknown>;
  selection?: { sections?: string[]; slideIds?: string[] };
  collectionName?: string;
  mode?: string;
}

export interface VisualiseExportPptxRequest {
  table?: DataHubTable;
  include?: string[];
  params?: Record<string, unknown>;
  selection?: { sections?: string[]; slideIds?: string[] };
  collectionName?: string;
  outputPath: string;
  notesOverrides?: Record<string, string>;
  renderedImages?: Record<string, string>;
}

export interface VisualiseDescribeSlideRequest {
  slide: Record<string, unknown>;
  params?: Record<string, unknown>;
  collectionName?: string;
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
    path.join(appPath, "dist", "shared", "python_backend", "visualise", "visualise_host.py"),
    pythonBackendPath,
    path.join(appPath, "..", "shared", "python_backend", "visualise", "visualise_host.py"),
    path.join(appPath, "..", "..", "shared", "python_backend", "visualise", "visualise_host.py"),
    path.join(appPath, "dist", "backend", "visualise_host.py"),
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
    const cacheDir = path.join(app.getPath("userData"), "data-hub-cache");
    const child = spawn(python, [script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1", DATAHUB_CACHE_DIR: cacheDir }
    });
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

type PendingRequest = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void };

class VisualiseWorker {
  private child = spawn(resolvePythonBinary(), [resolveHostScript()], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      VISUALISE_SERVER: "1",
      DATAHUB_CACHE_DIR: path.join(app.getPath("userData"), "data-hub-cache")
    }
  });
  private stdoutBuf = "";
  private stdoutExtraLogs: string[] = [];
  private stderrLogs: string[] = [];
  private pending: PendingRequest[] = [];
  private closed = false;

  constructor() {
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk.toString()));
    this.child.stderr.on("data", (chunk) => this.handleStderr(chunk.toString()));
    this.child.on("error", (error) => this.handleClose(error));
    this.child.on("close", () => this.handleClose(new Error("visualise worker exited")));
  }

  public reset(reason = "visualise worker reset"): void {
    // Reject in-flight requests immediately so callers can recover without waiting.
    this.handleClose(new Error(reason));
    try {
      this.child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }

  private handleStdout(text: string): void {
    this.stdoutBuf += text;
    const lines = this.stdoutBuf.split(/\r?\n/g);
    this.stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const looksJson = trimmed.startsWith("{") && trimmed.endsWith("}");
      if (!looksJson) {
        this.stdoutExtraLogs.push(trimmed);
        continue;
      }
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        this.stdoutExtraLogs.push(trimmed);
        continue;
      }
      const req = this.pending.shift();
      if (!req) {
        continue;
      }
      const pythonLogs = [...this.stdoutExtraLogs, ...this.stderrLogs];
      this.stdoutExtraLogs = [];
      this.stderrLogs = [];
      req.resolve({ ...(parsed as any), pythonLogs });
    }
  }

  private handleStderr(text: string): void {
    this.stderrLogs.push(...splitLines(text));
    // Cap growth if a request hangs.
    if (this.stderrLogs.length > 5000) {
      this.stderrLogs = this.stderrLogs.slice(-2000);
    }
  }

  private handleClose(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    const err = error instanceof Error ? error : new Error(String(error));
    while (this.pending.length) {
      const req = this.pending.shift();
      if (req) req.reject(err);
    }
  }

  public async send(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed || !this.child.stdin.writable) {
      throw new Error("visualise worker unavailable");
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        this.pending.pop();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

let worker: VisualiseWorker | null = null;

export const resetVisualiseWorker = (): void => {
  try {
    worker?.reset();
  } finally {
    worker = null;
  }
};

const runPythonTaskPersistent = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
  try {
    if (!worker) {
      worker = new VisualiseWorker();
    }
    return await worker.send(payload);
  } catch (error) {
    worker = null;
    return runPythonTask(payload);
  }
};

export const invokeVisualiseSections = async (): Promise<Record<string, unknown>> => {
  return runPythonTaskPersistent({ action: "sections" });
};

export const invokeVisualisePreview = async (request: VisualisePreviewRequest): Promise<Record<string, unknown>> => {
  return runPythonTaskPersistent({
    action: "preview",
    ...(request.table ? { table: request.table } : {}),
    include: request.include ?? [],
    params: request.params ?? {},
    selection: request.selection ?? undefined,
    collectionName: request.collectionName,
    mode: request.mode
  });
};

export const invokeVisualiseExportPptx = async (request: VisualiseExportPptxRequest): Promise<Record<string, unknown>> => {
  return runPythonTaskPersistent({
    action: "export_pptx",
    ...(request.table ? { table: request.table } : {}),
    include: request.include ?? [],
    params: request.params ?? {},
    selection: request.selection ?? undefined,
    collectionName: request.collectionName,
    outputPath: request.outputPath,
    notesOverrides: request.notesOverrides ?? {},
    renderedImages: request.renderedImages ?? {}
  });
};

export const invokeVisualiseDescribeSlide = async (
  request: VisualiseDescribeSlideRequest
): Promise<Record<string, unknown>> => {
  return runPythonTaskPersistent({
    action: "describe_slide",
    slide: request.slide,
    params: request.params ?? {},
    collectionName: request.collectionName
  });
};
