import type { EditorHandle } from "../api/leditor.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import { getPageSizeDefinitions, setPageMargins, setPageSize } from "./layout_settings.ts";

const LAST_LEDOC_PATH_STORAGE_KEY = "leditor.lastLedocPath";

const pxToCm = (px: number): number => (px / 96) * 2.54;

const applyBundleLayout = (layout: any) => {
  if (!layout || typeof layout !== "object") return;
  const pageSizeRaw = typeof layout.pageSize === "string" ? layout.pageSize.trim() : "";
  if (pageSizeRaw) {
    const sizes = getPageSizeDefinitions();
    const match = sizes.find(
      (s) => s.label.toLowerCase() === pageSizeRaw.toLowerCase() || s.id.toLowerCase() === pageSizeRaw.toLowerCase()
    );
    if (match) setPageSize(match.id);
  }
  const margins = layout.margins && typeof layout.margins === "object" ? layout.margins : null;
  if (!margins) return;
  const unit = typeof (margins as any).unit === "string" ? String((margins as any).unit).toLowerCase() : "cm";
  const toCm = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (unit === "cm") return value;
    if (unit === "px") return pxToCm(value);
    return value;
  };
  setPageMargins({
    top: toCm((margins as any).top),
    right: toCm((margins as any).right),
    bottom: toCm((margins as any).bottom),
    left: toCm((margins as any).left)
  });
};

const formatLocal = (iso: string): string => {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return String(iso || "");
  const d = new Date(t);
  const date = d.toLocaleDateString([], { year: "numeric", month: "short", day: "2-digit" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${date} ${time}`;
};

const readLastLedocPath = (): string => {
  try {
    return String(window.localStorage.getItem(LAST_LEDOC_PATH_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
};

const writeLastLedocPath = (filePath: string) => {
  const trimmed = String(filePath || "").trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(LAST_LEDOC_PATH_STORAGE_KEY, trimmed);
  } catch {
    // ignore
  }
};

export const openVersionHistoryModal = async (editorHandle: EditorHandle): Promise<void> => {
  const adapter = getHostAdapter();
  if (!adapter?.listLedocVersions || !adapter?.restoreLedocVersion) {
    window.alert("Version History is unavailable in this host.");
    return;
  }
  const ledocPath = readLastLedocPath();
  if (!ledocPath) {
    window.alert("No active .ledoc document. Save/Open a document first.");
    return;
  }

  const existing = document.getElementById("leditor-version-history-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "leditor-version-history-modal";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "9999";
  overlay.style.background = "rgba(0,0,0,0.35)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const modal = document.createElement("div");
  modal.style.width = "min(980px, calc(100vw - 40px))";
  modal.style.height = "min(680px, calc(100vh - 40px))";
  modal.style.background = "#fff";
  modal.style.borderRadius = "12px";
  modal.style.boxShadow = "0 14px 60px rgba(0,0,0,0.25)";
  modal.style.display = "flex";
  modal.style.flexDirection = "column";
  modal.style.overflow = "hidden";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.padding = "12px 14px";
  header.style.borderBottom = "1px solid rgba(0,0,0,0.08)";

  const title = document.createElement("div");
  title.textContent = "Version History";
  title.style.fontSize = "16px";
  title.style.fontWeight = "600";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  closeBtn.style.border = "1px solid rgba(0,0,0,0.18)";
  closeBtn.style.borderRadius = "8px";
  closeBtn.style.padding = "6px 10px";
  closeBtn.style.background = "#fff";

  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.style.display = "grid";
  body.style.gridTemplateColumns = "1fr 1fr";
  body.style.flex = "1";
  body.style.minHeight = "0";

  const left = document.createElement("div");
  left.style.borderRight = "1px solid rgba(0,0,0,0.08)";
  left.style.minHeight = "0";
  left.style.display = "flex";
  left.style.flexDirection = "column";

  const toolbar = document.createElement("div");
  toolbar.style.display = "flex";
  toolbar.style.gap = "8px";
  toolbar.style.padding = "10px";
  toolbar.style.borderBottom = "1px solid rgba(0,0,0,0.06)";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.textContent = "Refresh";
  refreshBtn.style.border = "1px solid rgba(0,0,0,0.18)";
  refreshBtn.style.borderRadius = "8px";
  refreshBtn.style.padding = "6px 10px";
  refreshBtn.style.background = "#fff";

  const saveVersionBtn = document.createElement("button");
  saveVersionBtn.type = "button";
  saveVersionBtn.textContent = "Save Version…";
  saveVersionBtn.style.border = "1px solid rgba(0,0,0,0.18)";
  saveVersionBtn.style.borderRadius = "8px";
  saveVersionBtn.style.padding = "6px 10px";
  saveVersionBtn.style.background = "#fff";

  toolbar.append(refreshBtn, saveVersionBtn);

  const list = document.createElement("div");
  list.style.flex = "1";
  list.style.overflow = "auto";
  list.style.padding = "8px";

  left.append(toolbar, list);

  const right = document.createElement("div");
  right.style.minHeight = "0";
  right.style.display = "flex";
  right.style.flexDirection = "column";

  const detail = document.createElement("div");
  detail.style.padding = "12px";
  detail.style.borderBottom = "1px solid rgba(0,0,0,0.06)";
  detail.style.minHeight = "92px";

  const detailTitle = document.createElement("div");
  detailTitle.style.fontWeight = "600";
  detailTitle.textContent = "Select a version";

  const detailMeta = document.createElement("div");
  detailMeta.style.fontSize = "12px";
  detailMeta.style.color = "rgba(0,0,0,0.6)";
  detailMeta.style.marginTop = "6px";

  detail.append(detailTitle, detailMeta);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.padding = "12px";

  const restoreBtn = document.createElement("button");
  restoreBtn.type = "button";
  restoreBtn.textContent = "Restore (replace)";
  restoreBtn.style.border = "1px solid rgba(0,0,0,0.18)";
  restoreBtn.style.borderRadius = "8px";
  restoreBtn.style.padding = "8px 10px";
  restoreBtn.style.background = "#fff";
  restoreBtn.disabled = true;

  const restoreCopyBtn = document.createElement("button");
  restoreCopyBtn.type = "button";
  restoreCopyBtn.textContent = "Restore as copy";
  restoreCopyBtn.style.border = "1px solid rgba(0,0,0,0.18)";
  restoreCopyBtn.style.borderRadius = "8px";
  restoreCopyBtn.style.padding = "8px 10px";
  restoreCopyBtn.style.background = "#fff";
  restoreCopyBtn.disabled = true;

  const pinBtn = document.createElement("button");
  pinBtn.type = "button";
  pinBtn.textContent = "Pin";
  pinBtn.style.border = "1px solid rgba(0,0,0,0.18)";
  pinBtn.style.borderRadius = "8px";
  pinBtn.style.padding = "8px 10px";
  pinBtn.style.background = "#fff";
  pinBtn.disabled = true;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.style.border = "1px solid rgba(0,0,0,0.18)";
  deleteBtn.style.borderRadius = "8px";
  deleteBtn.style.padding = "8px 10px";
  deleteBtn.style.background = "#fff";
  deleteBtn.disabled = true;

  actions.append(restoreBtn, restoreCopyBtn, pinBtn, deleteBtn);

  const warnings = document.createElement("div");
  warnings.style.padding = "0 12px 12px";
  warnings.style.fontSize = "12px";
  warnings.style.color = "rgba(0,0,0,0.7)";

  right.append(detail, actions, warnings);
  body.append(left, right);
  modal.append(header, body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") close();
    },
    { once: true }
  );

  type Entry = { id: string; ts: string; reason?: string; label?: string; note?: string; pinned?: boolean; sizeBytes?: number };
  let entries: Entry[] = [];
  let selected: Entry | null = null;

  const renderList = () => {
    list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.textContent = "No versions yet.";
      empty.style.padding = "10px";
      empty.style.color = "rgba(0,0,0,0.6)";
      list.appendChild(empty);
      return;
    }
    for (const e of entries) {
      const row = document.createElement("button");
      row.type = "button";
      row.style.width = "100%";
      row.style.textAlign = "left";
      row.style.border = "1px solid rgba(0,0,0,0.08)";
      row.style.borderRadius = "10px";
      row.style.padding = "10px";
      row.style.marginBottom = "8px";
      row.style.background = selected?.id === e.id ? "rgba(33,150,243,0.10)" : "#fff";
      row.style.cursor = "pointer";
      const top = document.createElement("div");
      top.style.display = "flex";
      top.style.justifyContent = "space-between";
      const leftText = document.createElement("div");
      leftText.style.fontWeight = "600";
      leftText.textContent = e.label?.trim() ? e.label.trim() : "Untitled version";
      const rightText = document.createElement("div");
      rightText.style.fontSize = "12px";
      rightText.style.color = "rgba(0,0,0,0.65)";
      rightText.textContent = formatLocal(e.ts);
      top.append(leftText, rightText);

      const meta = document.createElement("div");
      meta.style.marginTop = "6px";
      meta.style.fontSize = "12px";
      meta.style.color = "rgba(0,0,0,0.65)";
      const reason = String(e.reason || "manual");
      const pinned = e.pinned ? " • pinned" : "";
      meta.textContent = `Reason: ${reason}${pinned}`;

      row.append(top, meta);
      row.addEventListener("click", () => {
        selected = e;
        detailTitle.textContent = e.label?.trim() ? e.label!.trim() : "Untitled version";
        detailMeta.textContent = `${formatLocal(e.ts)} • ${String(e.reason || "manual")}${e.pinned ? " • pinned" : ""}`;
        restoreBtn.disabled = false;
        restoreCopyBtn.disabled = false;
        deleteBtn.disabled = false;
        pinBtn.disabled = false;
        pinBtn.textContent = e.pinned ? "Unpin" : "Pin";
        renderList();
      });
      list.appendChild(row);
    }
  };

  const reload = async () => {
    warnings.textContent = "";
    const result = await adapter.listLedocVersions!({ ledocPath });
    if (!result?.success) {
      warnings.textContent = `Failed to load versions: ${String(result?.error || "unknown error")}`;
      entries = [];
      selected = null;
      renderList();
      return;
    }
    const next = (result as any)?.index?.entries;
    entries = Array.isArray(next) ? (next as Entry[]) : [];
    if (selected) {
      selected = entries.find((e) => e.id === selected!.id) ?? null;
    }
    renderList();
  };

  refreshBtn.addEventListener("click", () => void reload());

  saveVersionBtn.addEventListener("click", async () => {
    const exporter = (window as any).__leditorAutoExportLEDOC as undefined | ((opts?: any) => Promise<any>);
    if (typeof exporter !== "function") {
      warnings.textContent = "Save is unavailable (ExportLEDOC handler missing).";
      return;
    }
    const label = String(window.prompt("Version label (optional):", "") || "").trim();
    const note = String(window.prompt("Version note (optional):", "") || "").trim();
    try {
      // Ensure we snapshot the latest content: save first.
      const saveResult = await exporter({ prompt: false, targetPath: ledocPath, suggestedPath: ledocPath });
      const savedPath = typeof saveResult?.filePath === "string" ? String(saveResult.filePath).trim() : "";
      if (savedPath) writeLastLedocPath(savedPath);
      const create = await adapter.createLedocVersion?.({
        ledocPath: savedPath || ledocPath,
        reason: "manual",
        label: label || undefined,
        note: note || undefined,
        force: true,
        payload: saveResult?.payload
      });
      if (!create?.success) {
        warnings.textContent = `Failed to create version: ${String(create?.error || "unknown error")}`;
        return;
      }
      await reload();
    } catch (error) {
      warnings.textContent = `Failed to create version: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  const doRestore = async (mode: "replace" | "copy") => {
    if (!selected) return;
    const ok =
      typeof window.confirm === "function"
        ? window.confirm(mode === "replace" ? "Restore this version and replace current document?" : "Restore this version as a new copy?")
        : true;
    if (!ok) return;
    warnings.textContent = "";
    const result = await adapter.restoreLedocVersion!({ ledocPath, versionId: selected.id, mode });
    if (!result?.success) {
      warnings.textContent = `Restore failed: ${String(result?.error || "unknown error")}`;
      return;
    }
    const payload: any = result.payload ?? null;
    if (payload?.content) {
      editorHandle.setContent(payload.content, { format: "json" });
      applyBundleLayout(payload.layout);
      try {
        document.title = `LEditor — ${String(payload?.meta?.title || "Document")}`;
      } catch {
        // ignore
      }
    }
    const nextPath = typeof result.filePath === "string" ? String(result.filePath).trim() : "";
    if (nextPath) writeLastLedocPath(nextPath);
    close();
  };

  restoreBtn.addEventListener("click", () => void doRestore("replace"));
  restoreCopyBtn.addEventListener("click", () => void doRestore("copy"));

  deleteBtn.addEventListener("click", async () => {
    if (!selected) return;
    const ok = typeof window.confirm === "function" ? window.confirm("Delete this version?") : true;
    if (!ok) return;
    warnings.textContent = "";
    const result = await adapter.deleteLedocVersion?.({ ledocPath, versionId: selected.id });
    if (!result?.success) {
      warnings.textContent = `Delete failed: ${String(result?.error || "unknown error")}`;
      return;
    }
    selected = null;
    restoreBtn.disabled = true;
    restoreCopyBtn.disabled = true;
    deleteBtn.disabled = true;
    pinBtn.disabled = true;
    await reload();
  });

  pinBtn.addEventListener("click", async () => {
    if (!selected) return;
    if (!adapter.pinLedocVersion) {
      warnings.textContent = "Pin is unavailable in this host.";
      return;
    }
    const nextPinned = !Boolean(selected.pinned);
    warnings.textContent = "";
    const result = await adapter.pinLedocVersion({ ledocPath, versionId: selected.id, pinned: nextPinned });
    if (!result?.success) {
      warnings.textContent = `Pin failed: ${String(result?.error || "unknown error")}`;
      return;
    }
    await reload();
  });

  await reload();
};

