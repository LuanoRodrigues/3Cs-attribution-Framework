import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";
import type { RetrieveDataHubState } from "../../session/sessionTypes";
import type { DataHubTable } from "../../shared/types/dataHub";
import {
  SCREEN_ACTIVE_EVENT,
  SCREEN_CODES_COL,
  SCREEN_COMMENT_COL,
  SCREEN_DECISION_COL,
  SCREEN_BLIND_COL,
  SCREEN_LLM_DECISION_COL,
  SCREEN_LLM_JUSTIFICATION_COL,
  ensureScreenColumns,
  escapeHtml,
  getStringCell,
  pickAbstractText,
  setStringCell,
  tableRowToRecord,
  buildEmptyPdfPayload,
  buildPdfPayloadFromRow,
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
      wrap.style.borderLeft = "3px solid transparent";
      wrap.style.paddingLeft = "10px";
      wrap.tabIndex = 0;

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

      const progress = document.createElement("div");
      progress.style.fontSize = "12px";
      progress.style.color = "var(--muted, #94a3b8)";
      progress.textContent = "0% coded";

      const shuffleLabel = document.createElement("div");
      shuffleLabel.style.fontSize = "11px";
      shuffleLabel.style.color = "var(--muted, #94a3b8)";
      shuffleLabel.textContent = "Order: shuffled";

      const headerRight = document.createElement("div");
      headerRight.style.display = "inline-flex";
      headerRight.style.alignItems = "center";
      headerRight.style.gap = "10px";
      const blindToggle = document.createElement("button");
      blindToggle.type = "button";
      blindToggle.className = "ribbon-button";
      blindToggle.textContent = "Blind: Off";
      blindToggle.style.display = "inline-flex";
      blindToggle.style.alignItems = "center";
      blindToggle.style.gap = "6px";
      blindToggle.style.padding = "6px 10px";

      const shuffleBtn = document.createElement("button");
      shuffleBtn.type = "button";
      shuffleBtn.className = "ribbon-button";
      shuffleBtn.textContent = "Shuffle";
      shuffleBtn.style.display = "inline-flex";
      shuffleBtn.style.alignItems = "center";
      shuffleBtn.style.gap = "6px";
      shuffleBtn.style.padding = "6px 10px";

      headerRight.append(blindToggle, shuffleBtn, prevBtn, nextBtn, counter, progress, shuffleLabel);

      header.append(title, headerRight);
      wrap.append(header, status);

      const shortcutHint = document.createElement("div");
      shortcutHint.style.fontSize = "11px";
      shortcutHint.style.color = "var(--muted, #94a3b8)";
      shortcutHint.style.margin = "4px 0 0 0";
      shortcutHint.style.opacity = "0.6";
      shortcutHint.textContent = "Click here for keyboard shortcuts.";
      wrap.appendChild(shortcutHint);

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

      const decisionBox = document.createElement("div");
      decisionBox.style.border = "1px solid var(--border)";
      decisionBox.style.borderRadius = "12px";
      decisionBox.style.padding = "12px";
      decisionBox.style.background = "color-mix(in srgb, var(--panel) 80%, transparent)";
      decisionBox.style.display = "flex";
      decisionBox.style.flexDirection = "column";
      decisionBox.style.gap = "8px";
      decisionBox.style.position = "relative";

      const decisionBadge = document.createElement("div");
      decisionBadge.style.position = "absolute";
      decisionBadge.style.left = "-12px";
      decisionBadge.style.top = "12px";
      decisionBadge.style.width = "6px";
      decisionBadge.style.height = "56px";
      decisionBadge.style.borderRadius = "6px";
      decisionBadge.style.background = "transparent";
      decisionBox.appendChild(decisionBadge);
      const decisionHeading = document.createElement("div");
      decisionHeading.textContent = "Screen decision";
      decisionHeading.style.fontWeight = "800";
      decisionHeading.style.fontSize = "12px";
      decisionHeading.style.letterSpacing = "0.22px";
      decisionHeading.style.color = "var(--muted, #94a3b8)";
      decisionHeading.style.textTransform = "uppercase";

      const decisionRow = document.createElement("div");
      decisionRow.style.display = "flex";
      decisionRow.style.gap = "8px";
      decisionRow.style.flexWrap = "wrap";

      const mkDecisionBtn = (label: string, color: string) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ribbon-button";
        btn.textContent = label;
        btn.style.padding = "8px 12px";
        btn.style.borderRadius = "10px";
        btn.style.border = `1px solid ${color}`;
        btn.dataset.color = color;
        return btn;
      };

      const includeBtn = mkDecisionBtn("Include", "var(--accent, #60a5fa)");
      const excludeBtn = mkDecisionBtn("Exclude", "#ef4444");
      const maybeBtn = mkDecisionBtn("Maybe", "#facc15");

      const decisionStatus = document.createElement("div");
      decisionStatus.style.fontSize = "12px";
      decisionStatus.style.color = "var(--muted, rgba(255, 255, 255, 0.65))";
      decisionStatus.textContent = "Uncoded";

      decisionRow.append(includeBtn, excludeBtn, maybeBtn);
      decisionBox.append(decisionHeading, decisionRow, decisionStatus);
      body.appendChild(decisionBox);

      const llmBox = document.createElement("div");
      llmBox.style.border = "1px solid var(--border)";
      llmBox.style.borderRadius = "12px";
      llmBox.style.padding = "12px";
      llmBox.style.background = "color-mix(in srgb, var(--panel) 80%, transparent)";
      llmBox.style.display = "block";

      const llmHeading = document.createElement("div");
      llmHeading.textContent = "LLM decision";
      llmHeading.style.fontWeight = "800";
      llmHeading.style.fontSize = "12px";
      llmHeading.style.letterSpacing = "0.22px";
      llmHeading.style.color = "var(--muted, rgba(255, 255, 255, 0.65))";
      llmHeading.style.textTransform = "uppercase";
      llmHeading.style.marginBottom = "6px";

      const llmCodes = document.createElement("div");
      llmCodes.style.display = "inline-flex";
      llmCodes.style.alignItems = "center";
      llmCodes.style.gap = "8px";
      llmCodes.style.fontWeight = "700";
      llmCodes.style.fontSize = "13px";
      llmCodes.style.color = "var(--text, rgba(255, 255, 255, 0.92))";
      llmCodes.textContent = "—";

      const llmComment = document.createElement("div");
      llmComment.style.fontSize = "12px";
      llmComment.style.color = "var(--muted, rgba(255, 255, 255, 0.65))";
      llmComment.textContent = "";

      llmBox.append(llmHeading, llmCodes, llmComment);
      body.appendChild(llmBox);

      const llmActions = document.createElement("div");
      llmActions.style.display = "flex";
      llmActions.style.gap = "8px";
      llmActions.style.marginTop = "6px";

      const applyLlmBtn = document.createElement("button");
      applyLlmBtn.type = "button";
      applyLlmBtn.className = "ribbon-button";
      applyLlmBtn.textContent = "Apply LLM decision";
      applyLlmBtn.style.padding = "6px 10px";

      const clearCodesBtn = document.createElement("button");
      clearCodesBtn.type = "button";
      clearCodesBtn.className = "ribbon-button";
      clearCodesBtn.textContent = "Clear codes";
      clearCodesBtn.style.padding = "6px 10px";

      const jumpUncodedBtn = document.createElement("button");
      jumpUncodedBtn.type = "button";
      jumpUncodedBtn.className = "ribbon-button";
      jumpUncodedBtn.textContent = "Jump to next uncoded";
      jumpUncodedBtn.style.padding = "6px 10px";

      const jumpPrevUncodedBtn = document.createElement("button");
      jumpPrevUncodedBtn.type = "button";
      jumpPrevUncodedBtn.className = "ribbon-button";
      jumpPrevUncodedBtn.textContent = "Jump to previous uncoded";
      jumpPrevUncodedBtn.style.padding = "6px 10px";

      llmActions.append(applyLlmBtn, clearCodesBtn, jumpUncodedBtn, jumpPrevUncodedBtn);
      llmBox.appendChild(llmActions);

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
      let activeDecision: "include" | "exclude" | "maybe" | "uncoded" = "uncoded";
      let blindMode = false;
      let rowOrder: number[] = [];
      let shuffleSeed = "";
      let shuffleKey = "";
      let rowOrderSeed = "";
      let currentState: RetrieveDataHubState | undefined;
      let persistTimer: number | null = null;
      let codedCount = 0;

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

      const hashSeed = (input: string): number => {
        let h = 2166136261;
        for (let i = 0; i < input.length; i++) {
          h ^= input.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return h >>> 0;
      };

      const mulberry32 = (seed: number): (() => number) => {
        let t = seed >>> 0;
        return () => {
          t += 0x6d2b79f5;
          let r = Math.imul(t ^ (t >>> 15), 1 | t);
          r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
          return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
      };

      const makeSeed = (): string => {
        const buf = new Uint32Array(1);
        const rand = window.crypto?.getRandomValues(buf)[0] ?? Math.floor(Math.random() * 0xffffffff);
        return `${Date.now().toString(36)}-${rand.toString(36)}`;
      };

      const computeShuffleKey = (state?: RetrieveDataHubState): string => {
        if (!state) return "screen:shuffle:unknown";
        const keyPart = state.filePath || state.collectionName || state.sourceType || "unknown";
        return `screen:shuffle:${keyPart}`;
      };

      const applyShuffleSeed = (length: number): void => {
        if (!length) {
          rowOrder = [];
          rowOrderSeed = "";
          return;
        }
        const seedNum = hashSeed(shuffleSeed || "default");
        const rng = mulberry32(seedNum);
        rowOrder = Array.from({ length }, (_v, idx) => idx);
        for (let i = length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [rowOrder[i], rowOrder[j]] = [rowOrder[j], rowOrder[i]];
        }
        rowOrderSeed = shuffleSeed;
        shuffleLabel.textContent = shuffleSeed ? `Seed: ${shuffleSeed.slice(0, 8)}` : "Order: shuffled";
      };

      const ensureRowOrder = (length: number): void => {
        if (rowOrder.length === length && shuffleSeed && rowOrderSeed === shuffleSeed) return;
        if (!shuffleSeed) {
          shuffleSeed = makeSeed();
        }
        applyShuffleSeed(length);
      };

      const rowIndexAt = (viewIndex: number): number => {
        return rowOrder[viewIndex] ?? viewIndex;
      };

      const shuffleOrder = (): void => {
        const rows = currentState?.table?.rows ?? [];
        const len = rows.length;
        if (!len) return;
        shuffleSeed = makeSeed();
        if (shuffleKey) {
          try {
            window.sessionStorage.setItem(shuffleKey, shuffleSeed);
          } catch {
            // ignore
          }
        }
        applyShuffleSeed(len);
        setActiveIndex(0, "screen");
        render();
      };

      const applyDecisionStyles = (): void => {
        const setBtn = (btn: HTMLButtonElement, match: string) => {
          const active = activeDecision === match;
          btn.style.background = active ? btn.dataset.color ?? "var(--panel)" : "transparent";
          btn.style.color = active ? "#1e1e1e" : "var(--text, rgba(255, 255, 255, 0.92))";
          btn.style.borderColor = active ? "transparent" : btn.dataset.color ?? "var(--border)";
        };
        setBtn(includeBtn, "include");
        setBtn(excludeBtn, "exclude");
        setBtn(maybeBtn, "maybe");
        decisionStatus.textContent =
          activeDecision === "uncoded" ? "Uncoded" : `Decision: ${activeDecision}`;
        const badgeColor =
          activeDecision === "include"
            ? "var(--accent, #5b9bd5)"
            : activeDecision === "exclude"
              ? "#ef4444"
              : activeDecision === "maybe"
                ? "#facc15"
                : "transparent";
        decisionBadge.style.background = badgeColor;
        wrap.style.borderLeft = badgeColor === "transparent" ? "3px solid transparent" : `3px solid ${badgeColor}`;
      };

      const updateBlindUi = (): void => {
        blindToggle.textContent = blindMode ? "Blind: On" : "Blind: Off";
        llmBox.style.display = blindMode ? "none" : "block";
      };

      const updateShortcutHint = (focused: boolean): void => {
        if (focused) {
          shortcutHint.textContent =
            "Shortcuts: I include • E exclude • M maybe • N next • P prev • J next uncoded • K prev uncoded";
          shortcutHint.style.opacity = "1";
        } else {
          shortcutHint.textContent = "Click here for keyboard shortcuts.";
          shortcutHint.style.opacity = "0.6";
        }
      };

      const readLlmDecision = (record: Record<string, unknown>): string => {
        const direct = String(record.llm_screen_decision ?? "").trim();
        if (direct) return direct;
        const status = String(record.status ?? record.llm_status ?? record.llm_decision ?? "").trim();
        return status;
      };

      const readLlmJustification = (record: Record<string, unknown>): string => {
        const direct = String(record.llm_screen_justification ?? "").trim();
        if (direct) return direct;
        const justification = String(
          record.justification ??
            record.llm_justification ??
            record.reason ??
            record.rationale ??
            ""
        ).trim();
        return justification;
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
        ensureRowOrder(rows.length);

        const countText = rows.length ? `${activeIndex + 1} / ${rows.length}` : "0 / 0";
        counter.textContent = countText;
        prevBtn.disabled = rows.length === 0 || activeIndex <= 0;
        nextBtn.disabled = rows.length === 0 || activeIndex >= rows.length - 1;
        codedCount = rows.filter((r) => {
          const decision = getStringCell(cols, r, SCREEN_DECISION_COL).toLowerCase();
          return decision === "include" || decision === "included" || decision === "exclude" || decision === "excluded" || decision === "maybe";
        }).length;
        const pct = rows.length ? Math.round((codedCount / rows.length) * 100) : 0;
        progress.textContent = `${pct}% coded`;

        if (!table || rows.length === 0) {
          status.textContent = "Load a dataset in Retrieve → Data Hub to begin screening.";
          metaTitle.textContent = "No record selected";
          metaSub.textContent = "";
          abstractContent.innerHTML = `<p style="margin:0;color:var(--paper-muted);">No abstract available.</p>`;
          codesInput.value = "";
          commentInput.value = "";
          activeDecision = "uncoded";
          applyDecisionStyles();
          blindMode = false;
          updateBlindUi();
          llmCodes.textContent = "—";
          llmComment.textContent = "";
          shuffleLabel.textContent = "Order: shuffled";
          return;
        }

        status.textContent = `Screening from cached Data Hub table (${cols.length} columns).`;
        const row = rows[rowIndexAt(activeIndex)] ?? [];
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
        const decisionRaw = getStringCell(cols, row, SCREEN_DECISION_COL).toLowerCase();
        if (decisionRaw === "include" || decisionRaw === "included") {
          activeDecision = "include";
        } else if (decisionRaw === "exclude" || decisionRaw === "excluded") {
          activeDecision = "exclude";
        } else if (decisionRaw === "maybe") {
          activeDecision = "maybe";
        } else {
          activeDecision = "uncoded";
        }
        applyDecisionStyles();

        const blindRaw = getStringCell(cols, row, SCREEN_BLIND_COL).toLowerCase();
        blindMode = ["1", "true", "yes", "on"].includes(blindRaw);
        updateBlindUi();

        const llmDecisionVal = readLlmDecision(record);
        const llmJustificationVal = readLlmJustification(record);
        const llmColor =
          llmDecisionVal.toLowerCase() === "include"
            ? "var(--accent, #60a5fa)"
            : llmDecisionVal.toLowerCase() === "exclude"
              ? "#ef4444"
              : llmDecisionVal.toLowerCase() === "maybe"
                ? "#facc15"
                : "var(--border)";
        llmCodes.innerHTML = llmDecisionVal
          ? `<span style="padding:3px 8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid ${llmColor};text-transform:capitalize;">${escapeHtml(llmDecisionVal)}</span>`
          : "No LLM decision";
        llmComment.textContent = llmJustificationVal || "";

        const pdfPathRaw = getStringCell(cols, row, "pdf_path").trim();
        if (pdfPathRaw) {
          const payload = buildPdfPayloadFromRow(cols, row, titleText, sourceText);
          loadPdfIntoPanel3Viewer(payload);
        }
      };

      const ensureAndApplyState = (incoming?: RetrieveDataHubState): void => {
        currentState = incoming;
        if (!currentState) {
          rowOrder = [];
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
        shuffleKey = computeShuffleKey(currentState);
        try {
          const stored = window.sessionStorage.getItem(shuffleKey);
          if (stored) {
            shuffleSeed = stored;
          } else {
            shuffleSeed = makeSeed();
            window.sessionStorage.setItem(shuffleKey, shuffleSeed);
          }
        } catch {
          shuffleSeed = shuffleSeed || makeSeed();
        }
        ensureRowOrder(rows.length);
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

      const updateCellFromInputs = (): void => {
        const table = currentState?.table;
        if (!table) return;
        const row = table.rows[rowIndexAt(activeIndex)];
        if (!row) return;
        setStringCell(table.columns, row, SCREEN_CODES_COL, codesInput.value.trim());
        setStringCell(table.columns, row, SCREEN_COMMENT_COL, commentInput.value.trim());
        schedulePersist();
      };

      const setDecision = (value: "include" | "exclude" | "maybe"): void => {
        const table = currentState?.table;
        if (!table) return;
        const row = table.rows[rowIndexAt(activeIndex)];
        if (!row) return;
        activeDecision = value;
        setStringCell(table.columns, row, SCREEN_DECISION_COL, value);
        applyDecisionStyles();
        schedulePersist();
      };

      const toggleBlind = (): void => {
        const table = currentState?.table;
        if (!table) return;
        const row = table.rows[rowIndexAt(activeIndex)];
        if (!row) return;
        blindMode = !blindMode;
        setStringCell(table.columns, row, SCREEN_BLIND_COL, blindMode ? "1" : "");
        updateBlindUi();
        schedulePersist();
      };

      const applyLlmToUser = (): void => {
        const table = currentState?.table;
        if (!table) return;
        const row = table.rows[rowIndexAt(activeIndex)];
        if (!row) return;
        const record = tableRowToRecord(table.columns, row);
        const llmDecisionVal = readLlmDecision(record);
        const llmJustificationVal = readLlmJustification(record);
        if (llmDecisionVal) {
          const normalized = llmDecisionVal.toLowerCase();
          if (normalized === "include" || normalized === "exclude" || normalized === "maybe") {
            setDecision(normalized);
          }
        }
        if (llmJustificationVal) {
          commentInput.value = llmJustificationVal;
          updateCellFromInputs();
        }
      };

      const clearUserCodes = (): void => {
        codesInput.value = "";
        commentInput.value = "";
        updateCellFromInputs();
      };

      const jumpToNextUncoded = (): void => {
        const table = currentState?.table;
        if (!table) return;
        const rows = table.rows ?? [];
        const start = activeIndex + 1;
        const len = rows.length;
        for (let i = 0; i < len; i++) {
          const idx = (start + i) % len;
          const decision = getStringCell(table.columns, rows[rowIndexAt(idx)], SCREEN_DECISION_COL).toLowerCase();
          if (!decision || decision === "uncoded") {
            setActiveIndex(idx, "screen");
            return;
          }
        }
      };

      const jumpToPrevUncoded = (): void => {
        const table = currentState?.table;
        if (!table) return;
        const rows = table.rows ?? [];
        const len = rows.length;
        const start = activeIndex - 1;
        for (let i = 0; i < len; i++) {
          const idx = (start - i + len) % len;
          const decision = getStringCell(table.columns, rows[rowIndexAt(idx)], SCREEN_DECISION_COL).toLowerCase();
          if (!decision || decision === "uncoded") {
            setActiveIndex(idx, "screen");
            return;
          }
        }
      };

      const handleKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
          return;
        }
        if (!wrap.contains(document.activeElement)) {
          return;
        }
        const key = event.key.toLowerCase();
        if (key === "i") {
          event.preventDefault();
          setDecision("include");
        } else if (key === "e") {
          event.preventDefault();
          setDecision("exclude");
        } else if (key === "m") {
          event.preventDefault();
          setDecision("maybe");
        } else if (key === "n") {
          event.preventDefault();
          setActiveIndex(activeIndex + 1, "screen");
        } else if (key === "p") {
          event.preventDefault();
          setActiveIndex(activeIndex - 1, "screen");
        } else if (key === "j") {
          event.preventDefault();
          jumpToNextUncoded();
        } else if (key === "k") {
          event.preventDefault();
          jumpToPrevUncoded();
        }
      };

      prevBtn.addEventListener("click", () => setActiveIndex(activeIndex - 1, "screen"));
      nextBtn.addEventListener("click", () => setActiveIndex(activeIndex + 1, "screen"));
      includeBtn.addEventListener("click", () => setDecision("include"));
      excludeBtn.addEventListener("click", () => setDecision("exclude"));
      maybeBtn.addEventListener("click", () => setDecision("maybe"));
      blindToggle.addEventListener("click", toggleBlind);
      shuffleBtn.addEventListener("click", shuffleOrder);
      applyLlmBtn.addEventListener("click", applyLlmToUser);
      clearCodesBtn.addEventListener("click", clearUserCodes);
      jumpUncodedBtn.addEventListener("click", jumpToNextUncoded);
      jumpPrevUncodedBtn.addEventListener("click", jumpToPrevUncoded);
      document.addEventListener("keydown", handleKeyDown);
      wrap.addEventListener("focusin", () => updateShortcutHint(true));
      wrap.addEventListener("focusout", (event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !wrap.contains(next)) {
          updateShortcutHint(false);
        }
      });

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
          document.removeEventListener("keydown", handleKeyDown);
          if (persistTimer) {
            window.clearTimeout(persistTimer);
            persistTimer = null;
          }
        }
      };
    }
  };
}
