// Shared PDF viewer integration used by Analyse and Screen panels.
// Keeps logic out of renderer/index.ts so tools can reuse it.

import type { PdfTestPayload } from "../test/testFixtures";

export type PdfUiTokens = Record<string, string>;

const pdfViewerRetry = new WeakMap<HTMLIFrameElement, number>();
const inlinePdfCache = new Map<string, Promise<string | null>>();
const MAX_INLINE_BYTES = 80 * 1024 * 1024;

const looksLikeBase64Pdf = (value: string): boolean => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (!/^[A-Za-z0-9+/]+=*$/.test(raw)) return false;
  return raw.length > 256;
};

const isPdfDataCandidate = (value: string): boolean =>
  /^data:application\/pdf/i.test(value) || looksLikeBase64Pdf(value);

const shouldInlinePdf = (value: string): boolean => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (isPdfDataCandidate(raw)) return false;
  if (/^https?:\/\//i.test(raw)) return false;
  return true;
};

const fileUrlToPath = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^file:\/\//i.test(raw)) return raw;
  let cleaned = raw.replace(/^file:\/\//i, "");
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // ignore decode failures
  }
  if (cleaned.startsWith("/") && /^[A-Za-z]:\//.test(cleaned.slice(1))) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
};

const maybeInlinePdfPayload = async (payload: PdfTestPayload): Promise<void> => {
  const host: any = (window as any).leditorHost;
  if (!host?.readBinaryFile) return;
  const pdfRef = String(payload.pdf || payload.pdf_path || "").trim();
  if (!shouldInlinePdf(pdfRef)) return;
  const sourcePath = fileUrlToPath(pdfRef);
  if (!sourcePath) return;
  if (!inlinePdfCache.has(sourcePath)) {
    const task = (async () => {
      try {
        console.info("[pdf-inline] attempt", { path: sourcePath });
        const res = await host.readBinaryFile({ sourcePath, maxBytes: MAX_INLINE_BYTES });
        if (res?.success && res?.dataBase64) {
          console.info("[pdf-inline] ok", { bytes: res.bytes ?? null });
          return `data:application/pdf;base64,${res.dataBase64}`;
        }
        console.warn("[pdf-inline] failed", { error: res?.error || "unknown" });
        return null;
      } catch {
        console.warn("[pdf-inline] failed", { error: "exception" });
        return null;
      }
    })();
    inlinePdfCache.set(sourcePath, task);
  }
  const dataUrl = await inlinePdfCache.get(sourcePath)!;
  if (dataUrl) {
    payload.pdf = dataUrl;
  }
};

export function getBundledPdfViewerUrl(): string {
  // Renderer bundle lives in dist/renderer; resources are copied to dist/resources.
  return new URL("../resources/pdf_viewer/viewer.html", window.location.href).href;
}

export function mapAppThemeToPdfTheme(theme: string): string {
  const t = (theme || "").toLowerCase();
  if (t === "high-contrast" || t === "highcontrast") return "highcontrast";
  if (t === "light") return "paper";
  if (t === "warm") return "sepia";
  if (t === "colorful") return "paper";
  if (t === "cold" || t === "dark" || t === "system") return "midnight";
  return ["midnight", "dim", "paper", "sepia", "highcontrast"].includes(t) ? t : "midnight";
}

export function getAppThemeId(): string {
  const docTheme = document.documentElement.dataset.theme;
  if (docTheme) return docTheme;
  try {
    const raw = window.localStorage.getItem("appearance.theme");
    if (raw) return raw;
  } catch {
    // ignore
  }
  return "system";
}

const readRootCssVar = (name: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value ? value.trim() : "";
};

export function buildPdfViewerUiTokens(): PdfUiTokens {
  const bg = readRootCssVar("--bg");
  const panel = readRootCssVar("--panel");
  const panel2 = readRootCssVar("--panel-2");
  const surface = readRootCssVar("--surface");
  const surfaceMuted = readRootCssVar("--surface-muted");
  const border = readRootCssVar("--border");
  const borderSoft = readRootCssVar("--border-soft");
  const text = readRootCssVar("--text");
  const muted = readRootCssVar("--muted");
  const accent = readRootCssVar("--accent");
  const shadowOverlay = readRootCssVar("--shadow-overlay") || readRootCssVar("--shadow");
  const shadowAmbient = readRootCssVar("--shadow-ambient") || readRootCssVar("--shadow");

  return {
    "--bg0": bg || "#0b0f14",
    "--bg1": panel || "#0f141b",
    "--bg2": panel2 || "#151c26",
    "--panel": surface || panel || "#0f141b",
    "--panel2": surfaceMuted || panel2 || "#151c26",
    "--stroke": border || "rgba(226, 232, 240, 0.14)",
    "--stroke2": borderSoft || "rgba(226, 232, 240, 0.08)",
    "--txt": text || "#e8eef5",
    "--muted": muted || "#a8b3c3",
    "--muted2": muted || "#a8b3c3",
    "--accent": accent || "#10a37f",
    "--shadow": shadowOverlay || "0 30px 80px rgba(0, 0, 0, 0.45)",
    "--shadow2": shadowAmbient || "0 8px 24px rgba(0, 0, 0, 0.18)"
  };
}

export function syncPdfViewerUiTokens(iframe: HTMLIFrameElement): void {
  const vars = buildPdfViewerUiTokens();
  const win =
    iframe.contentWindow as (Window & { PDF_APP?: { setUiTokens?: (vars: Record<string, string>) => string } }) | null;

  try {
    if (win?.PDF_APP && typeof win.PDF_APP.setUiTokens === "function") {
      win.PDF_APP.setUiTokens(vars);
      return;
    }
  } catch {
    // ignore
  }

  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    Object.entries(vars).forEach(([k, v]) => doc.documentElement.style.setProperty(k, v));
  } catch {
    // ignore
  }
}

export function syncPdfViewerTheme(iframe: HTMLIFrameElement): void {
  const win = iframe.contentWindow as Window & { PDF_APP?: { setTheme?: (t: string) => string } };
  if (win?.PDF_APP && typeof win.PDF_APP.setTheme === "function") {
    win.PDF_APP.setTheme(mapAppThemeToPdfTheme(getAppThemeId()));
  }
  syncPdfViewerUiTokens(iframe);
}

export function syncAllPdfViewersTheme(): void {
  document.querySelectorAll<HTMLIFrameElement>("iframe[data-pdf-app-viewer='true']").forEach((iframe) => {
    syncPdfViewerTheme(iframe);
  });
}

export function ensurePdfViewerFrame(
  host: HTMLElement,
  options?: { viewerUrl?: string; sidebar?: "0" | "1" }
): HTMLIFrameElement {
  let iframe = host.querySelector<HTMLIFrameElement>("iframe.pdf-test-viewer");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.className = "pdf-test-viewer";
    iframe.dataset.pdfAppViewer = "true";
    const theme = mapAppThemeToPdfTheme(getAppThemeId());
    const url = new URL(options?.viewerUrl || getBundledPdfViewerUrl());
    url.searchParams.set("theme", theme);
    url.searchParams.set("sidebar", options?.sidebar ?? "0");
    iframe.src = url.toString();
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.style.background = "var(--panel, #252526)";
    iframe.title = "PDF Viewer";
    host.appendChild(iframe);
  }
  return iframe;
}

export function applyPayloadToViewer(
  iframe: HTMLIFrameElement,
  payload: PdfTestPayload,
  options?: { resolvePdfPath?: (p?: string) => string | undefined }
): void {
  const viewerPayload: PdfTestPayload = {
    ...payload,
    pdf_path: (options?.resolvePdfPath ? options.resolvePdfPath(payload.pdf_path) : undefined) ?? payload.pdf_path
  };
  const tryApply = (): boolean => {
    const win = iframe.contentWindow as Window & { PDF_APP?: { loadFromPayload?: (payload: PdfTestPayload) => string } };
    if (!win) return false;
    const pdfApp = win.PDF_APP;
    if (pdfApp && typeof pdfApp.loadFromPayload === "function") {
      pdfApp.loadFromPayload(viewerPayload);
      syncPdfViewerTheme(iframe);
      return true;
    }
    return false;
  };

  if (tryApply()) {
    pdfViewerRetry.delete(iframe);
    return;
  }

  const existingInterval = pdfViewerRetry.get(iframe);
  if (existingInterval !== undefined) {
    window.clearInterval(existingInterval);
    pdfViewerRetry.delete(iframe);
  }

  let intervalId: number | undefined;
  function cleanup(): void {
    iframe.removeEventListener("load", onLoad);
    if (intervalId !== undefined) {
      window.clearInterval(intervalId);
      intervalId = undefined;
    }
    pdfViewerRetry.delete(iframe);
  }

  function onLoad(): void {
    if (tryApply()) cleanup();
  }

  iframe.addEventListener("load", onLoad);
  intervalId = window.setInterval(() => {
    if (tryApply()) cleanup();
  }, 250);
  pdfViewerRetry.set(iframe, intervalId);
}

export function renderPdfTabs(host: HTMLElement, payload: PdfTestPayload, rawPayload?: any): void {
  const rawData = rawPayload || payload;
  const citations = rawData?.citations || rawData?.meta?.citations;
  const references = rawData?.references || rawData?.meta?.references;
  host.innerHTML = "";

  const tabsWrap = document.createElement("div");
  tabsWrap.style.display = "flex";
  tabsWrap.style.gap = "6px";
  tabsWrap.style.padding = "6px 8px";
  tabsWrap.style.borderBottom = "1px solid var(--border, #1f2937)";

  const views: Record<string, HTMLElement> = {};
  const tabIds: Array<{ id: string; label: string }> = [
    { id: "pdf", label: "PDF" },
    { id: "raw", label: "Raw data" },
    { id: "cit", label: "Citations" },
    { id: "ref", label: "References" }
  ];

  const contentWrap = document.createElement("div");
  contentWrap.style.flex = "1 1 auto";
  contentWrap.style.minHeight = "0";
  contentWrap.style.display = "flex";
  contentWrap.style.flexDirection = "column";

  tabIds.forEach((t, idx) => {
    const btn = document.createElement("button");
    btn.className = "button-ghost";
    btn.textContent = t.label;
    btn.style.padding = "6px 10px";
    btn.style.borderRadius = "10px";
    btn.style.border = "1px solid var(--border, #1f2937)";
    btn.style.background = idx === 0 ? "color-mix(in srgb, var(--panel-2) 85%, transparent)" : "transparent";
    btn.addEventListener("click", () => {
      tabIds.forEach((x) => {
        const v = views[x.id];
        if (v) v.style.display = x.id === t.id ? "flex" : "none";
      });
      tabsWrap.querySelectorAll("button").forEach((b) => {
        b instanceof HTMLButtonElement &&
          (b.style.background =
            b === btn ? "color-mix(in srgb, var(--panel-2) 85%, transparent)" : "transparent");
      });
    });
    tabsWrap.appendChild(btn);

    const view = document.createElement("div");
    view.style.flex = "1 1 auto";
    view.style.minHeight = "0";
    view.style.display = idx === 0 ? "flex" : "none";
    view.style.flexDirection = "column";
    view.style.padding = "8px";
    view.style.gap = "10px";
    view.style.overflow = "hidden";
    views[t.id] = view;
    contentWrap.appendChild(view);
  });

  host.appendChild(tabsWrap);
  host.appendChild(contentWrap);

  const pdfView = views["pdf"];
  if (pdfView) {
    const header = document.createElement("div");
    header.className = "status-bar";
    header.textContent = `${payload.title || "PDF"} · ${payload.pdf_path}`;
    pdfView.appendChild(header);

    const iframe = ensurePdfViewerFrame(pdfView, { sidebar: "0" });
    iframe.style.zIndex = "1";
    iframe.style.flex = "1 1 auto";
    iframe.style.height = "100%";
    iframe.style.minHeight = "0";
    iframe.style.width = "100%";
    applyPayloadToViewer(iframe, payload);
    void maybeInlinePdfPayload(payload).then(() => {
      if (payload.pdf && isPdfDataCandidate(String(payload.pdf))) {
        applyPayloadToViewer(iframe, payload);
      }
    });
  }

  const rawView = views["raw"];
  if (rawView) {
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.flex = "1";
    pre.style.minHeight = "0";
    pre.style.overflow = "auto";
    pre.textContent = JSON.stringify(rawData || payload, null, 2);
    rawView.appendChild(pre);
  }

  const citView = views["cit"];
  if (citView) {
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.flex = "1";
    pre.style.minHeight = "0";
    pre.style.overflow = "auto";
    pre.textContent = JSON.stringify(citations || [], null, 2);
    citView.appendChild(pre);
  }

  const refView = views["ref"];
  if (refView) {
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.flex = "1";
    pre.style.minHeight = "0";
    pre.style.overflow = "auto";
    pre.textContent = JSON.stringify(references || [], null, 2);
    refView.appendChild(pre);
  }
}
