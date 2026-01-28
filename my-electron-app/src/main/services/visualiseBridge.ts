import { app } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import type { DataHubTable } from "../../shared/types/dataHub";

export interface VisualisePreviewRequest {
  table: DataHubTable;
  include?: string[];
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
  const candidates = [
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
          message: stderr.trim() || `python exited with ${code}`
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim() || "{}");
        resolve(parsed);
      } catch (error) {
        resolve({
          status: "error",
          message: `Invalid response from python (${error instanceof Error ? error.message : "parse error"})`,
          raw: stdout.trim(),
          stderr: stderr.trim()
        });
      }
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
    collectionName: request.collectionName
  });
};
