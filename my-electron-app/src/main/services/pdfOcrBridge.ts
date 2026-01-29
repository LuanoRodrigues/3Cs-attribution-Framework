import { app } from "electron";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

type OcrResult =
  | { status: "ok"; pdfPath: string }
  | { status: "error"; message: string };

const inflight = new Map<string, Promise<OcrResult>>();

function normalizePdfPath(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  if (raw.startsWith("file://")) {
    try {
      const u = new URL(raw);
      return decodeURIComponent(u.pathname || raw.replace(/^file:\/\//, ""));
    } catch {
      return raw.replace(/^file:\/\//, "");
    }
  }
  return raw;
}

function buildCachePath(pdfPath: string): { outDir: string; outPath: string } {
  const stat = fs.existsSync(pdfPath) ? fs.statSync(pdfPath) : null;
  const sig = stat ? `${pdfPath}|${stat.size}|${stat.mtimeMs}` : pdfPath;
  const hash = crypto.createHash("sha1").update(sig).digest("hex");
  const outDir = path.join(app.getPath("userData"), "pdf_ocr");
  const outPath = path.join(outDir, `${hash}.pdf`);
  return { outDir, outPath };
}

function resolveOcrmypdf(): string {
  const env = process.env.OCR_MY_PDF || process.env.OCRMYPDF;
  if (env && env.trim()) return env.trim();
  return "ocrmypdf";
}

export async function invokePdfOcr(pdfPathRaw: string): Promise<OcrResult> {
  const pdfPath = normalizePdfPath(pdfPathRaw);
  if (!pdfPath) {
    return { status: "error", message: "Missing pdfPath." };
  }
  if (!fs.existsSync(pdfPath)) {
    return { status: "error", message: `PDF not found: ${pdfPath}` };
  }

  if (inflight.has(pdfPath)) {
    return inflight.get(pdfPath) as Promise<OcrResult>;
  }

  const task = new Promise<OcrResult>((resolve) => {
    const { outDir, outPath } = buildCachePath(pdfPath);
    if (fs.existsSync(outPath)) {
      resolve({ status: "ok", pdfPath: outPath });
      return;
    }

    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch {
      // ignore
    }

    const bin = resolveOcrmypdf();
    const args = [
      "--skip-text",
      "--deskew",
      "--rotate-pages",
      "--optimize",
      "1",
      pdfPath,
      outPath
    ];

    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      resolve({ status: "error", message: err.message });
    });
    child.on("close", (code) => {
      if (code !== 0 || !fs.existsSync(outPath)) {
        resolve({ status: "error", message: stderr.trim() || `ocrmypdf exited with ${code}` });
        return;
      }
      resolve({ status: "ok", pdfPath: outPath });
    });
  }).finally(() => {
    inflight.delete(pdfPath);
  });

  inflight.set(pdfPath, task);
  return task;
}
