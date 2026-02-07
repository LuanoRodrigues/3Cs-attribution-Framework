import { getHostContract } from "./host_contract.ts";

type DirectQuotePayload = Record<string, unknown> & {
  dqid?: string;
  pdf_path?: string;
  pdf?: string;
  page?: number | string;
};

type DirectQuoteLookup = Record<string, unknown>;

type AnchorClickDetail = {
  href: string;
  dqid: string;
  anchorId?: string;
  title?: string;
  text?: string;
  dataKey?: string;
  dataItemKeys?: string;
};

const normalizeDqid = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

const normalizeLegacyJson = (raw: string): string =>
  raw
    .replace(/\bNaN\b/g, "null")
    .replace(/\bnan\b/g, "null")
    .replace(/\bInfinity\b/g, "null")
    .replace(/\b-Infinity\b/g, "null");

const dirnameLike = (filePath: string): string => {
  const normalized = String(filePath || "").trim();
  if (!normalized) return "";
  const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (idx <= 0) return "";
  return normalized.slice(0, idx);
};

const joinLike = (dir: string, name: string): string => {
  const base = String(dir || "").replace(/[\\/]+$/, "");
  if (!base) return name;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${sep}${name}`;
};

const fileExistsViaHost = async (filePath: string): Promise<boolean> => {
  const host = (window as any).leditorHost;
  if (host?.fileExists) {
    const res = await host.fileExists({ sourcePath: filePath });
    const ok = Boolean(res?.exists);
    console.info("[leditor][directquote] lookup probe", { path: filePath, ok, error: ok ? "" : (res as any)?.error });
    return ok;
  }
  if (!host?.readFile) return false;
  const res = await host.readFile({ sourcePath: filePath });
  const ok = Boolean(res?.success);
  console.info("[leditor][directquote] lookup probe", { path: filePath, ok, error: ok ? "" : (res as any)?.error });
  return ok;
};

const readTextViaHost = async (filePath: string): Promise<string> => {
  const host = (window as any).leditorHost;
  if (!host?.readFile) {
    throw new Error("leditorHost.readFile unavailable");
  }
  const res = await host.readFile({ sourcePath: filePath });
  if (!res?.success) {
    throw new Error(res?.error || "readFile failed");
  }
  console.info("[leditor][directquote] lookup read", { path: filePath, bytes: String(res.data ?? "").length });
  return String(res.data ?? "");
};

const safeString = (value: unknown): string => (value == null ? "" : String(value));

const isPdfDataUrl = (value: string): boolean => /^data:application\/pdf/i.test(value);

const looksLikeBase64Pdf = (value: string): boolean => {
  const raw = safeString(value).trim();
  if (!raw) return false;
  if (!/^[A-Za-z0-9+/]+=*$/.test(raw)) return false;
  return raw.length > 256;
};

const describePdfRef = (value: unknown): string | null => {
  const raw = safeString(value).trim();
  if (!raw) return null;
  if (isPdfDataUrl(raw)) return "data:application/pdf;base64,(inline)";
  if (looksLikeBase64Pdf(raw)) return "[base64-pdf]";
  return raw;
};

const fileUrlToPath = (value: string): string => {
  const raw = safeString(value).trim();
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

const toPosixPathFromWindows = (value: string): string => {
  const raw = safeString(value).trim();
  if (!raw) return "";
  const norm = raw.replace(/\\/g, "/");
  const match = norm.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return raw;
  const isWindowsHost = (() => {
    try {
      const plat = String(
        (navigator && (navigator as any).userAgentData && (navigator as any).userAgentData.platform) ||
          navigator.platform ||
          ""
      );
      const ua = String(navigator.userAgent || "");
      return /win/i.test(plat) || /windows/i.test(ua);
    } catch {
      return false;
    }
  })();
  if (isWindowsHost) return raw;
  const drive = String(match[1] || "").toLowerCase();
  const rest = String(match[2] || "");
  return `/mnt/${drive}/${rest}`;
};

const looksLikePdfRef = (value: unknown): boolean => {
  const raw = safeString(value).trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower.startsWith("data:application/pdf")) return true;
  if (lower.startsWith("http://") || lower.startsWith("https://")) return lower.includes(".pdf");
  if (lower.startsWith("file://")) return lower.includes(".pdf");
  const cleaned = raw.split(/[?#]/)[0].trim().toLowerCase();
  return cleaned.endsWith(".pdf");
};

const shouldInlinePdf = (value: string): boolean => {
  const raw = safeString(value).trim();
  if (!raw) return false;
  if (isPdfDataUrl(raw) || looksLikeBase64Pdf(raw)) return false;
  if (/^https?:\/\//i.test(raw)) return false;
  return true;
};

const maybeInlinePdfPayload = async (payload: DirectQuotePayload): Promise<void> => {
  const host = (window as any).leditorHost;
  if (!host?.readBinaryFile) {
    console.info("[leditor][pdf-inline] readBinaryFile unavailable");
    return;
  }
  const pdfRef = safeString(payload.pdf_path ?? payload.pdf ?? "").trim();
  if (!pdfRef || !shouldInlinePdf(pdfRef)) return;
  const sourcePathRaw = fileUrlToPath(pdfRef);
  const sourcePath = toPosixPathFromWindows(sourcePathRaw);
  if (!sourcePath) return;
  try {
    console.info("[leditor][pdf-inline] inline attempt", { path: sourcePath });
    const res = await host.readBinaryFile({ sourcePath, maxBytes: 80 * 1024 * 1024 });
    if (res?.success && res?.dataBase64) {
      payload.pdf = `data:application/pdf;base64,${res.dataBase64}`;
      console.info("[leditor][pdf-inline] inline ok", { bytes: res.bytes ?? null });
    } else {
      console.warn("[leditor][pdf-inline] inline failed", { error: res?.error || "unknown" });
    }
  } catch {
    console.warn("[leditor][pdf-inline] inline failed", { error: "exception" });
  }
};

const parsePageFromHref = (href: string): number | undefined => {
  const raw = String(href || "").trim();
  if (!raw) return undefined;
  const parseNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const numeric = Number.parseInt(trimmed, 10);
      return Number.isFinite(numeric) ? numeric : undefined;
    }
    return undefined;
  };
  try {
    const url = new URL(raw, window.location.href);
    const qPage = parseNumber(url.searchParams.get("page"));
    if (qPage) return qPage;
    const hash = (url.hash || "").replace(/^#/, "");
    if (hash) {
      const hp = new URLSearchParams(hash.replace("?", "&"));
      const hPage = parseNumber(hp.get("page"));
      if (hPage) return hPage;
      const m = hash.match(/page=(\d+)/i);
      if (m && m[1]) return parseNumber(m[1]);
    }
  } catch {
    // ignore malformed urls
  }
  const m = raw.match(/[?#&]page=(\d+)/i);
  if (m && m[1]) return parseNumber(m[1]);
  return undefined;
};

const coerceLookup = (raw: unknown): DirectQuoteLookup => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: DirectQuoteLookup = {};
  Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
    const key = String(k || "").trim().toLowerCase();
    if (!key) return;
    out[key] = v;
  });
  return out;
};

const coercePayload = (raw: unknown, dqid: string): DirectQuotePayload | null => {
  if (raw == null) return null;
  if (typeof raw === "string") {
    return { dqid, direct_quote: raw };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const payload = raw as DirectQuotePayload;
    if (!payload.dqid) payload.dqid = dqid;
    return payload;
  }
  return { dqid, direct_quote: String(raw) };
};

const resolveLookupPath = async (): Promise<string | null> => {
  const contract = getHostContract();
  const configured = String(contract?.inputs?.directQuoteJsonPath || "").trim();
  if (!configured) return null;
  return (await fileExistsViaHost(configured)) ? configured : null;
};

const openPdfViewer = async (payload: DirectQuotePayload): Promise<void> => {
  const host = (window as any).leditorHost;
  if (host?.openPdfViewer) {
    console.info("[leditor][pdf] invoking host.openPdfViewer", {
      dqid: payload.dqid ?? null,
      pdf_path: describePdfRef((payload as any).pdf_path ?? (payload as any).pdf),
      page: (payload as any).page ?? null
    });
    const res = await host.openPdfViewer({ payload });
    if (!res?.success) {
      throw new Error(res?.error || "openPdfViewer failed");
    }
    console.info("[leditor][pdf] host.openPdfViewer ok", { dqid: payload.dqid ?? null });
    return;
  }

  console.warn("[leditor][pdf] host.openPdfViewer unavailable; falling back to window.open", {
    dqid: payload.dqid ?? null
  });
  const pdfPath = String(payload.pdf_path || payload.pdf || "").trim();
  const page = payload.page;
  if (!pdfPath) {
    console.warn("[leditor][pdf] missing pdf_path/pdf in payload", payload);
    return;
  }
  const url = pdfPath.startsWith("file:") ? pdfPath : `file://${pdfPath.replace(/\\/g, "/")}`;
  const pageSuffix = page ? `#page=${encodeURIComponent(String(page))}` : "";
  window.open(`${url}${pageSuffix}`, "_blank", "noopener,noreferrer");
};

const openEmbeddedPdfPanel = (payload: DirectQuotePayload): boolean => {
  try {
    const api = (window as any).__leditorEmbeddedPdf;
    if (!api || typeof api.open !== "function") return false;
    api.open(payload as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
};

const inFlightByDqid = new Map<string, Promise<void>>();

export const installDirectQuotePdfOpenHandler = (opts?: { coderStatePath?: string | null }): void => {
  const coderStatePath = opts?.coderStatePath ? String(opts.coderStatePath) : "";
  if (coderStatePath) {
    (window as any).__lastCoderStatePath = coderStatePath;
  }

  window.addEventListener("leditor-anchor-click", (event: Event) => {
    const detail = (event as CustomEvent<AnchorClickDetail>).detail;
    const dqid = normalizeDqid(detail?.dqid);
    if (!dqid) return;
    if (inFlightByDqid.has(dqid)) {
      console.info("[leditor][directquote] dedupe in-flight click", { dqid });
      return;
    }
    const task = (async () => {
      try {
        const lookupPath = await resolveLookupPath();
        if (!lookupPath) {
          console.warn("[leditor][directquote] missing lookup path", { dqid });
          return;
        }
        const host = (window as any).leditorHost;
        if (!host?.getDirectQuoteEntry) {
          console.warn("[leditor][directquote] host getDirectQuoteEntry unavailable", { dqid });
          return;
        }
        console.info("[leditor][directquote] click", { dqid, lookupPath, anchorId: detail?.anchorId || "" });
        const raw = await host.getDirectQuoteEntry({ lookupPath, dqid });
        const payload = coercePayload(raw, dqid);
        if (!payload) {
          console.warn("[leditor][directquote] dqid not found", { dqid, lookupPath });
          return;
        }
        if (payload.page == null) {
          const page = parsePageFromHref(detail?.href || "");
          if (page) payload.page = page;
        }
        const itemKey =
          safeString((payload as any).item_key ?? (payload as any).itemKey ?? detail?.dataKey ?? "").trim() ||
          safeString(detail?.dataKey ?? "").trim() ||
          safeString(detail?.dataItemKeys ?? "")
            .split(/[,\s]+/)
            .filter(Boolean)[0]
            ?.trim() ||
          "";
        const sourceCandidate = safeString((payload as any).source).trim();
        if (!(payload as any).pdf_path && !(payload as any).pdf && sourceCandidate) {
          payload.pdf_path = sourceCandidate;
        }
        let pdfCandidate = safeString(payload.pdf_path ?? payload.pdf ?? sourceCandidate).trim();
        if (!looksLikePdfRef(pdfCandidate) && looksLikePdfRef(sourceCandidate)) {
          payload.pdf_path = sourceCandidate;
          pdfCandidate = sourceCandidate;
        }
        const missingPdf = !looksLikePdfRef(pdfCandidate);
        if (missingPdf && itemKey && host?.resolvePdfPathForItemKey) {
          const resolvedPdf = await host.resolvePdfPathForItemKey({ lookupPath, itemKey });
          if (typeof resolvedPdf === "string" && resolvedPdf.trim()) {
            payload.pdf_path = resolvedPdf.trim();
          }
        }
        const finalPdfCandidate = safeString(payload.pdf_path ?? payload.pdf ?? sourceCandidate).trim();
        if (!looksLikePdfRef(finalPdfCandidate)) {
          // Avoid feeding obviously-not-a-path values (e.g. journal/source strings) into the iframe src.
          delete (payload as any).pdf_path;
          delete (payload as any).pdf;
        } else if (!(payload as any).pdf_path && (payload as any).pdf) {
          // The embedded PDF viewer prefers `pdf_path`; keep compatibility with payloads using `pdf`.
          (payload as any).pdf_path = (payload as any).pdf;
        }
        if (payload.pdf_path && typeof payload.pdf_path === "string") {
          const posix = toPosixPathFromWindows(payload.pdf_path);
          if (posix && posix !== payload.pdf_path) {
            payload.pdf_path = posix;
          }
        }
        console.info("[leditor][directquote] open-pdf", {
          dqid,
          itemKey: itemKey || null,
          pdf_path: describePdfRef(payload.pdf_path || payload.pdf),
          page: payload.page ?? null,
          lookupPath
        });
        await maybeInlinePdfPayload(payload);
        if (openEmbeddedPdfPanel(payload)) {
          return;
        }
        console.info("[leditor][directquote] calling openPdfViewer", { dqid });
        await openPdfViewer(payload);
        console.info("[leditor][directquote] openPdfViewer returned", { dqid });
      } catch (error) {
        console.error("[leditor][directquote] click handler failed", { dqid, error: String(error) });
      } finally {
        inFlightByDqid.delete(dqid);
      }
    })();
    inFlightByDqid.set(dqid, task);
    void task;
  });
};
