import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";
import type { RetrieveDataHubState } from "../../session/sessionTypes";
import type { DataHubTable } from "../../shared/types/dataHub";
import {
  SCREEN_ACTIVE_EVENT,
  SCREEN_CODES_COL,
  SCREEN_COMMENT_COL,
  ensureScreenColumns,
  escapeHtml,
  getStringCell,
  pickAbstractText,
  setStringCell,
  tableRowToRecord,
  buildEmptyPdfPayload,
  type PdfViewerPayload,
  type ScreenActiveEventDetail
} from "./screenShared";

function readCachedRetrieveState(): RetrieveDataHubState | undefined {
  return (window as unknown as { __retrieveDataHubState?: RetrieveDataHubState }).__retrieveDataHubState;
}

function dispatchRetrieveState(state: RetrieveDataHubState): void {
  // Persist into session via SessionManager listener.
  document.dispatchEvent(new CustomEvent("retrieve:datahub-updated", { detail: { state } }));
  // Update DataHubPanel grid if it is open.
  document.dispatchEvent(new CustomEvent("retrieve:datahub-restore", { detail: { state } }));
}

function clampIndex(value: number, maxExclusive: number): number {
  if (!Number.isFinite(value)) return 0;
  if (maxExclusive <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(value)), maxExclusive - 1);
}

type PdfAppWindow = Window & {
  PDF_APP?: {
    loadFromPayload?: (payload: PdfViewerPayload) => string;
    setTheme?: (themeId: string) => string;
  };
};

function loadPdfIntoPanel3Viewer(payload: PdfViewerPayload): void {
  const iframe = (window as any).__screenPdfViewerIframe as HTMLIFrameElement | undefined;
  if (!iframe) return;
  let attempts = 0;
  const maxAttempts = 20;
  const interval = window.setInterval(() => {
    attempts += 1;
    try {
      const win = iframe.contentWindow as PdfAppWindow | null;
      const pdfApp = win?.PDF_APP;
      if (pdfApp && typeof pdfApp.loadFromPayload === "function") {
        pdfApp.loadFromPayload(payload);
        window.clearInterval(interval);
      }
    } catch {
      // keep retrying until maxAttempts
    }
    if (attempts >= maxAttempts) {
      window.clearInterval(interval);
    }
  }, 200);
}

function fluentIcon(name: "doc" | "chevLeft" | "chevRight"): string {
  // Minimal SVGs inspired by Fluent UI 20px icons.
  switch (name) {
    case "doc":
      return `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M6.5 2A2.5 2.5 0 0 0 4 4.5v11A2.5 2.5 0 0 0 6.5 18h7A2.5 2.5 0 0 0 16 15.5V7.2a2.5 2.5 0 0 0-.73-1.77l-1.7-1.7A2.5 2.5 0 0 0 11.8 3H6.5Zm5.5 1.5v3A1.5 1.5 0 0 0 13.5 8h3v7.5c0 .55-.45 1-1 1h-9c-.55 0-1-.45-1-1v-11c0-.55.45-1 1-1H12Zm1.5 3V3.86c.16.1.3.22.43.35l1.86 1.86c.13.13.25.27.35.43H13.5Z"/>
      </svg>`;
    case "chevLeft":
      return `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12.78 4.22a.75.75 0 0 1 0 1.06L8.06 10l4.72 4.72a.75.75 0 0 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z"/>
      </svg>`;
    case "chevRight":
      return `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M7.22 15.78a.75.75 0 0 1 0-1.06L11.94 10 7.22 5.28a.75.75 0 1 1 1.06-1.06l5.25 5.25c.3.3.3.77 0 1.06l-5.25 5.25a.75.75 0 0 1-1.06 0Z"/>
      </svg>`;
  }
}

export function createScreenWidget(): ToolDefinition {
  return {
    type: "screen",
    title: "Screen",
    create: (): ToolHandle => {
      const wrap = document.createElement("div");
      wrap.className = "tool-surface";

      const header = document.createElement("div");
      header.className = "tool-header";

      const title = document.createElement("h4");
      title.innerHTML = `${fluentIcon("doc")} <span>Screen — Paper</span>`;
      title.style.display = "inline-flex";
      title.style.alignItems = "center";
      title.style.gap = "8px";

      const status = document.createElement("div");
      status.className = "status-bar";
      status.textContent = "Load a dataset in Retrieve → Data Hub to begin screening.";

      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "ribbon-button";
      prevBtn.innerHTML = `${fluentIcon("chevLeft")} <span>Prev</span>`;
      prevBtn.style.display = "inline-flex";
      prevBtn.style.alignItems = "center";
      prevBtn.style.gap = "6px";
      prevBtn.style.padding = "6px 10px";

      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "ribbon-button";
      nextBtn.innerHTML = `<span>Next</span> ${fluentIcon("chevRight")}`;
      nextBtn.style.display = "inline-flex";
      nextBtn.style.alignItems = "center";
      nextBtn.style.gap = "6px";
      nextBtn.style.padding = "6px 10px";

      const counter = document.createElement("div");
      counter.style.fontSize = "12px";
      counter.style.color = "var(--muted, #94a3b8)";
      counter.textContent = "0 / 0";

      const headerRight = document.createElement("div");
      headerRight.style.display = "inline-flex";
      headerRight.style.alignItems = "center";
      headerRight.style.gap = "8px";
      headerRight.append(prevBtn, nextBtn, counter);

      header.append(title, headerRight);
      wrap.append(header, status);

      const body = document.createElement("div");
      body.style.display = "flex";
      body.style.flexDirection = "column";
      body.style.gap = "10px";
      wrap.appendChild(body);

      const metaBox = document.createElement("div");
      metaBox.style.border = "1px solid var(--border)";
      metaBox.style.borderRadius = "12px";
      metaBox.style.padding = "10px 12px";
      metaBox.style.background = "color-mix(in srgb, var(--panel) 80%, transparent)";

      const metaTitle = document.createElement("div");
      metaTitle.style.fontWeight = "700";
      metaTitle.style.fontSize = "13px";
      metaTitle.style.marginBottom = "4px";
      metaTitle.textContent = "No record selected";
      const metaSub = document.createElement("div");
      metaSub.style.fontSize = "12px";
      metaSub.style.color = "var(--muted, #94a3b8)";
      metaSub.textContent = "";
      metaBox.append(metaTitle, metaSub);
      body.appendChild(metaBox);

      const abstractBox = document.createElement("div");
      abstractBox.style.border = "1px solid var(--border)";
      abstractBox.style.borderRadius = "12px";
      abstractBox.style.padding = "12px";
      abstractBox.style.background = "color-mix(in srgb, var(--panel) 80%, transparent)";

      const abstractHeading = document.createElement("div");
      abstractHeading.textContent = "Abstract";
      abstractHeading.style.fontWeight = "800";
      abstractHeading.style.fontSize = "12px";
      abstractHeading.style.letterSpacing = "0.22px";
      abstractHeading.style.color = "var(--muted, #94a3b8)";
      abstractHeading.style.textTransform = "uppercase";
      abstractHeading.style.marginBottom = "8px";

      const abstractContent = document.createElement("div");
      abstractContent.className = "paper-preview";
      abstractContent.style.padding = "0";
      abstractContent.style.margin = "0";
      abstractContent.style.maxWidth = "none";
      abstractContent.style.width = "100%";
      abstractContent.style.border = "0";
      abstractContent.style.background = "transparent";
      abstractContent.style.fontSize = "20px";
      abstractContent.style.lineHeight = "1.85";
      abstractContent.innerHTML = `<p style="margin:0;color:var(--paper-muted);">No abstract available.</p>`;

      abstractBox.append(abstractHeading, abstractContent);
      body.appendChild(abstractBox);

      const codesBox = document.createElement("div");
      codesBox.style.border = "1px solid var(--border)";
      codesBox.style.borderRadius = "12px";
      codesBox.style.padding = "12px";
      codesBox.style.background = "color-mix(in srgb, var(--panel) 80%, transparent)";

      const codesHeading = document.createElement("div");
      codesHeading.textContent = "Screen codes";
      codesHeading.style.fontWeight = "800";
      codesHeading.style.fontSize = "12px";
      codesHeading.style.letterSpacing = "0.22px";
      codesHeading.style.color = "var(--muted, #94a3b8)";
      codesHeading.style.textTransform = "uppercase";
      codesHeading.style.marginBottom = "8px";

      const codesInput = document.createElement("input");
      codesInput.type = "text";
      codesInput.placeholder = "Comma-separated codes (stored in screen_codes)";
      codesInput.className = "tool-input";
      codesInput.style.width = "100%";

      codesBox.append(codesHeading, codesInput);
      body.appendChild(codesBox);

      const commentBox = document.createElement("div");
      commentBox.style.border = "1px solid var(--border)";
      commentBox.style.borderRadius = "12px";
      commentBox.style.padding = "12px";
      commentBox.style.background = "color-mix(in srgb, var(--panel) 80%, transparent)";

      const commentHeading = document.createElement("div");
      commentHeading.textContent = "Screen comment";
      commentHeading.style.fontWeight = "800";
      commentHeading.style.fontSize = "12px";
      commentHeading.style.letterSpacing = "0.22px";
      commentHeading.style.color = "var(--muted, #94a3b8)";
      commentHeading.style.textTransform = "uppercase";
      commentHeading.style.marginBottom = "8px";

      const commentInput = document.createElement("textarea");
      commentInput.placeholder = "Notes (stored in screen_comment)";
      commentInput.className = "tool-input";
      commentInput.style.width = "100%";
      commentInput.style.minHeight = "120px";
      commentInput.style.resize = "vertical";

      commentBox.append(commentHeading, commentInput);
      body.appendChild(commentBox);

      let activeIndex = 0;
      let currentState: RetrieveDataHubState | undefined;
      let persistTimer: number | null = null;

      const schedulePersist = (): void => {
        const base = currentState;
        if (!base?.table) return;
        if (!base.sourceType) return;
        if (persistTimer) window.clearTimeout(persistTimer);
        persistTimer = window.setTimeout(() => {
          const snapshot = currentState;
          if (!snapshot?.table || !snapshot.sourceType) {
            persistTimer = null;
            return;
          }
          persistTimer = null;
          const next: RetrieveDataHubState = {
            ...snapshot,
            loadedAt: new Date().toISOString(),
            table: snapshot.table
          };
          currentState = next;
          dispatchRetrieveState(next);
        }, 250);
      };

      const setActiveIndex = (next: number, source?: ScreenActiveEventDetail["source"]): void => {
        const rows = currentState?.table?.rows ?? [];
        const clamped = clampIndex(next, rows.length);
        if (clamped === activeIndex && source) {
          // Still broadcast for cross-panel sync if requested.
          document.dispatchEvent(
            new CustomEvent<ScreenActiveEventDetail>(SCREEN_ACTIVE_EVENT, { detail: { index: clamped, source } })
          );
          return;
        }
        activeIndex = clamped;
        document.dispatchEvent(
          new CustomEvent<ScreenActiveEventDetail>(SCREEN_ACTIVE_EVENT, { detail: { index: clamped, source } })
        );
        render();
      };

      const render = (): void => {
        const table = currentState?.table;
        const rows = table?.rows ?? [];
        const cols = table?.columns ?? [];

        const countText = rows.length ? `${activeIndex + 1} / ${rows.length}` : "0 / 0";
        counter.textContent = countText;
        prevBtn.disabled = rows.length === 0 || activeIndex <= 0;
        nextBtn.disabled = rows.length === 0 || activeIndex >= rows.length - 1;

        if (!table || rows.length === 0) {
          status.textContent = "Load a dataset in Retrieve → Data Hub to begin screening.";
          metaTitle.textContent = "No record selected";
          metaSub.textContent = "";
          abstractContent.innerHTML = `<p style="margin:0;color:var(--paper-muted);">No abstract available.</p>`;
          codesInput.value = "";
          commentInput.value = "";
          return;
        }

        status.textContent = `Screening from cached Data Hub table (${cols.length} columns).`;
        const row = rows[activeIndex] ?? [];
        const record = tableRowToRecord(cols, row);
        const titleText = String(record.title ?? record.paper_title ?? record.name ?? "Untitled").trim() || "Untitled";
        const yearText = String(record.year ?? "").trim();
        const sourceText = String(record.source ?? record.journal ?? record.venue ?? "").trim();

        metaTitle.textContent = titleText;
        metaSub.textContent = [yearText, sourceText].filter(Boolean).join(" • ");

        const abstract = pickAbstractText(cols, row) || String(record.abstract ?? "").trim();
        if (!abstract) {
          abstractContent.innerHTML = `<p style="margin:0;color:var(--paper-muted);">No abstract available.</p>`;
        } else {
          const paras = abstract
            .split(/\n{2,}/g)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
            .join("");
          abstractContent.innerHTML = paras || `<p>${escapeHtml(abstract)}</p>`;
        }

        codesInput.value = getStringCell(cols, row, SCREEN_CODES_COL);
        commentInput.value = getStringCell(cols, row, SCREEN_COMMENT_COL);

        const pdfPathRaw = getStringCell(cols, row, "pdf_path").trim();
        if (pdfPathRaw) {
          loadPdfIntoPanel3Viewer(buildEmptyPdfPayload(pdfPathRaw));
        }
      };

      const ensureAndApplyState = (incoming?: RetrieveDataHubState): void => {
        currentState = incoming;
        if (!currentState) {
          render();
          return;
        }
        const { state: ensured, changed } = ensureScreenColumns(currentState);
        if (ensured) {
          currentState = ensured;
          if (changed) {
            dispatchRetrieveState({
              ...ensured,
              loadedAt: new Date().toISOString()
            });
          }
        }
        const rows = currentState.table?.rows ?? [];
        activeIndex = clampIndex(activeIndex, rows.length);
        render();
      };

      const handleDataHubUpdated = (event: Event): void => {
        const detail = (event as CustomEvent<{ state?: RetrieveDataHubState }>).detail;
        if (!detail?.state) return;
        ensureAndApplyState(detail.state);
      };

      const handleDataHubRestore = (event: Event): void => {
        const detail = (event as CustomEvent<{ state?: RetrieveDataHubState }>).detail;
        if (!detail?.state) return;
        ensureAndApplyState(detail.state);
      };

      const handleActiveEvent = (event: Event): void => {
        const detail = (event as CustomEvent<ScreenActiveEventDetail>).detail;
        if (!detail || typeof detail.index !== "number") return;
        const next = clampIndex(detail.index, currentState?.table?.rows?.length ?? 0);
        if (next !== activeIndex) {
          activeIndex = next;
          render();
        }
      };

      prevBtn.addEventListener("click", () => setActiveIndex(activeIndex - 1, "screen"));
      nextBtn.addEventListener("click", () => setActiveIndex(activeIndex + 1, "screen"));

      const updateCellFromInputs = (): void => {
        const table = currentState?.table;
        if (!table) return;
        const row = table.rows[activeIndex];
        if (!row) return;
        setStringCell(table.columns, row, SCREEN_CODES_COL, codesInput.value.trim());
        setStringCell(table.columns, row, SCREEN_COMMENT_COL, commentInput.value.trim());
        schedulePersist();
      };

      codesInput.addEventListener("input", updateCellFromInputs);
      commentInput.addEventListener("input", updateCellFromInputs);

      document.addEventListener("retrieve:datahub-updated", handleDataHubUpdated);
      document.addEventListener("retrieve:datahub-restore", handleDataHubRestore);
      document.addEventListener(SCREEN_ACTIVE_EVENT, handleActiveEvent);

      // Seed from cached state immediately.
      ensureAndApplyState(readCachedRetrieveState());
      // Let panel3 sync to row 0 when Screen opens (if data exists).
      window.setTimeout(() => setActiveIndex(activeIndex, "screen"), 0);

      return {
        element: wrap,
        focus: () => wrap.focus(),
        destroy: () => {
          document.removeEventListener("retrieve:datahub-updated", handleDataHubUpdated);
          document.removeEventListener("retrieve:datahub-restore", handleDataHubRestore);
          document.removeEventListener(SCREEN_ACTIVE_EVENT, handleActiveEvent);
          if (persistTimer) {
            window.clearTimeout(persistTimer);
            persistTimer = null;
          }
        }
      };
    }
  };
}
