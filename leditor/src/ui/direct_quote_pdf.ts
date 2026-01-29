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
      pdf_path: (payload as any).pdf_path ?? (payload as any).pdf ?? null,
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
        const itemKey =
          safeString((payload as any).item_key ?? (payload as any).itemKey ?? detail?.dataKey ?? "").trim() ||
          safeString(detail?.dataKey ?? "").trim();
        const missingPdf = !safeString(payload.pdf_path ?? payload.pdf).trim();
        if (missingPdf && itemKey && host?.resolvePdfPathForItemKey) {
          const resolvedPdf = await host.resolvePdfPathForItemKey({ lookupPath, itemKey });
          if (typeof resolvedPdf === "string" && resolvedPdf.trim()) {
            payload.pdf_path = resolvedPdf.trim();
          }
        }
        console.info("[leditor][directquote] open-pdf", {
          dqid,
          itemKey: itemKey || null,
          pdf_path: payload.pdf_path || payload.pdf || null,
          page: payload.page ?? null,
          lookupPath
        });
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
