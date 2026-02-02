import type { EditorHandle } from "../api/leditor.ts";
import { getSourceCheckState } from "../editor/source_check_badges.ts";
import {
  applySourceChecksThreadToEditor,
  dismissSourceCheckThreadItem,
  getSourceChecksThread,
  isSourceChecksVisible,
  setSourceChecksVisible,
  subscribeSourceChecksThread
} from "./source_checks_thread.ts";

type CardState = { collapsed: boolean };

const OVERLAY_ID = "leditor-source-check-rail";
const CARDS_ID = "leditor-source-check-rail-cards";
const COLLAPSE_KEY = "leditor.sourceChecks.cardState";
const ROW_EXPANDED_KEY = "leditor.sourceChecks.rowExpanded";
const DRAW_CONNECTOR_LINES = false;
const AUTO_FOCUS_EVENT = "leditor:source-checks-focus";

const loadCardState = (): Record<string, CardState> => {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, CardState>;
  } catch {
    return {};
  }
};

const loadRowExpanded = (): Record<string, boolean> => {
  try {
    const raw = window.localStorage.getItem(ROW_EXPANDED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
};

const saveRowExpanded = (state: Record<string, boolean>) => {
  try {
    window.localStorage.setItem(ROW_EXPANDED_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

const saveCardState = (state: Record<string, CardState>) => {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

const pickAppRoot = (): HTMLElement | null =>
  (document.getElementById("leditor-app") as HTMLElement | null) ?? (document.body as HTMLElement | null);

const sanitize = (value: string, maxLen: number) => {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
};

const iconSvg = (name: "collapse" | "expand" | "close"): string => {
  if (name === "close") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z"/>
      </svg>
    `;
  }
  if (name === "collapse") {
    // Chevron up (collapse)
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M7.4 14.6a1 1 0 0 1 0-1.4l4.0-4.0a1 1 0 0 1 1.4 0l4.0 4.0a1 1 0 1 1-1.4 1.4L12 11.4l-3.2 3.2a1 1 0 0 1-1.4 0Z"/>
      </svg>
    `;
  }
  // Chevron down (expand)
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M16.6 9.4a1 1 0 0 1 0 1.4l-4.0 4.0a1 1 0 0 1-1.4 0l-4.0-4.0a1 1 0 1 1 1.4-1.4L12 12.6l3.2-3.2a1 1 0 0 1 1.4 0Z"/>
    </svg>
  `;
};

const bindIconAction = (el: HTMLElement, fn: () => void) => {
  // Use pointerdown instead of click to avoid focus/selection interactions swallowing events.
  el.addEventListener("pointerdown", (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {
      // ignore
    }
    fn();
  });
  el.addEventListener("click", (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {
      // ignore
    }
  });
};

const closestPage = (el: Element | null): HTMLElement | null => {
  const page = el?.closest?.(".leditor-page") as HTMLElement | null;
  if (page) return page;
  const content = el?.closest?.(".leditor-page-content") as HTMLElement | null;
  return (content?.closest?.(".leditor-page") as HTMLElement | null) ?? null;
};

const cssEscape = (value: string): string => {
  const v = String(value ?? "");
  const esc = (globalThis as any).CSS?.escape;
  if (typeof esc === "function") return esc(v);
  return v.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
};

const getScale = (el: HTMLElement): { sx: number; sy: number } => {
  try {
    const rect = el.getBoundingClientRect();
    const sx = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
    const sy = el.offsetHeight > 0 ? rect.height / el.offsetHeight : sx;
    return {
      sx: Number.isFinite(sx) && sx > 0 ? sx : 1,
      sy: Number.isFinite(sy) && sy > 0 ? sy : 1
    };
  } catch {
    return { sx: 1, sy: 1 };
  }
};

const queryCitationAnchorByHrefAndText = (root: ParentNode, href: string, text: string): HTMLElement | null => {
  const wantHref = String(href ?? "").trim();
  const wantText = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!wantHref) return null;
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(`.leditor-citation-anchor[href="${cssEscape(wantHref)}"]`));
  if (!candidates.length) return null;
  if (!wantText) return candidates[0] ?? null;
  const exact = candidates.find((el) => String(el.textContent ?? "").replace(/\s+/g, " ").trim() === wantText);
  return exact ?? candidates[0] ?? null;
};

const normalizeCitationAnchorEl = (el: HTMLElement | null): HTMLElement | null => {
  if (!el) return null;
  if (el.classList.contains("leditor-citation-anchor")) return el;
  const a =
    (el.closest?.("a.leditor-citation-anchor") as HTMLElement | null) ??
    (el.closest?.('[data-citation-anchor="true"]') as HTMLElement | null) ??
    null;
  return a ?? el;
};

const findAnchorElementFromViewPos = (view: any, pos: number): HTMLElement | null => {
  try {
    const domAt = view.domAtPos(Math.max(0, pos));
    const node: any = domAt?.node;
    if (!node) return null;
    const el: HTMLElement | null =
      node.nodeType === 3 ? (node.parentElement as HTMLElement | null) : (node as HTMLElement | null);
    return normalizeCitationAnchorEl(el);
  } catch {
    return null;
  }
};

export const mountSourceCheckRail = (editorHandle: EditorHandle) => {
  const appRoot = pickAppRoot();
  if (!appRoot) return { destroy() {} };
  const scrollRoot =
    (appRoot.querySelector(".leditor-doc-shell") as HTMLElement | null) ??
    (appRoot.querySelector(".leditor-editor-pane") as HTMLElement | null) ??
    (appRoot as HTMLElement);
  // Prefer the scaled content wrapper as the coordinate space for the rail. This keeps the
  // cards aligned with the A4 page stack even when zoom/centering is applied.
  const overlayHost =
    (appRoot.querySelector(".leditor-a4-zoom-content") as HTMLElement | null) ??
    (appRoot.querySelector(".leditor-a4-zoom") as HTMLElement | null) ??
    (appRoot.querySelector(".leditor-a4-canvas") as HTMLElement | null) ??
    appRoot;
  const scaleEl = overlayHost;

  const existingCards = document.getElementById(CARDS_ID);
  if (existingCards) existingCards.remove();
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "leditor-source-check-rail";
  overlay.classList.add("is-hidden");
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("leditor-source-check-rail__lines");
  svg.setAttribute("aria-hidden", "true");
  if (!DRAW_CONNECTOR_LINES) {
    (svg as any).style.display = "none";
  }

  const cardsLayer = document.createElement("div");
  cardsLayer.id = CARDS_ID;
  cardsLayer.className = "leditor-source-check-rail__cardsLayer";
  cardsLayer.style.display = "none";
  (cardsLayer.style as any).zIndex = "45";
  cardsLayer.setAttribute("aria-hidden", "true");

  const header = document.createElement("div");
  header.className = "leditor-source-check-rail__header";

  const title = document.createElement("div");
  title.className = "leditor-source-check-rail__title";
  title.textContent = "Source checks";

  const headerBtns = document.createElement("div");
  headerBtns.className = "leditor-source-check-rail__headerBtns";

  const btnClear = document.createElement("button");
  btnClear.type = "button";
  btnClear.className = "leditor-source-check-rail__btn";
  btnClear.textContent = "Clear";
  btnClear.addEventListener("click", () => {
    try {
      editorHandle.execCommand("ai.sourceChecks.clear");
    } catch {
      // ignore
    }
  });

  const btnHide = document.createElement("button");
  btnHide.type = "button";
  btnHide.className = "leditor-source-check-rail__btn";
  btnHide.textContent = "Hide";
  btnHide.addEventListener("click", () => {
    try {
      editorHandle.execCommand("ai.sourceChecks.toggle");
    } catch {
      setSourceChecksVisible(false);
    }
  });

  headerBtns.append(btnClear, btnHide);
  header.append(title, headerBtns);
  cardsLayer.appendChild(header);

  const list = document.createElement("div");
  list.className = "leditor-source-check-rail__list";
  cardsLayer.appendChild(list);

  overlay.append(svg);
  overlayHost.appendChild(overlay);
  overlayHost.appendChild(cardsLayer);

  const cardByParagraph = new Map<number, HTMLElement>();
  let cardStateByKey: Record<string, CardState> = loadCardState();
  let rowExpandedByKey: Record<string, boolean> = loadRowExpanded();
  let raf = 0;
  let pulseTimer: number | null = null;
  let selectedKey: string = "";
  let selectedAnchorEl: HTMLElement | null = null;
  const anchorElByKey = new Map<string, HTMLElement>();
  const threadAnchorByKey = new Map<string, { href?: string; text?: string }>();

  // Keep wheel scrolling inside the cards instead of bubbling to the document surface.
  const onWheel = (e: WheelEvent) => {
    try {
      const target = e.target as HTMLElement | null;
      const body = (target?.closest?.(".leditor-source-check-rail__pBody") as HTMLElement | null) ?? null;
      if (!body) return;
      const canScroll = body.scrollHeight > body.clientHeight + 1;
      if (!canScroll) return;
      // Manual scroll to avoid the doc-shell stealing the wheel.
      e.preventDefault();
      e.stopPropagation();
      body.scrollTop += e.deltaY;
    } catch {
      // ignore
    }
  };
  cardsLayer.addEventListener("wheel", onWheel, { passive: false });

  const focusAnchorByKey = (key: string, from?: number, to?: number, opts?: { behavior?: ScrollBehavior }) => {
    const k = String(key || "");
    if (!k) return;
    selectedKey = k;
    const selector = `[data-source-check-key="${cssEscape(k)}"]`;
    const rawEl =
      (appRoot.querySelector(selector) as HTMLElement | null) ??
      anchorElByKey.get(k) ??
      null;
    const thread = threadAnchorByKey.get(k) ?? {};
    const anchorEl =
      normalizeCitationAnchorEl(rawEl) ??
      normalizeCitationAnchorEl(
        queryCitationAnchorByHrefAndText(appRoot, String(thread.href ?? ""), String(thread.text ?? ""))
      );
    console.debug("[source_check_rail.ts][focusAnchorByKey][debug]", {
      key: k,
      found: Boolean(anchorEl),
      hasFromTo: typeof from === "number" && typeof to === "number"
    });
    try {
      if (anchorEl) {
        anchorEl.scrollIntoView({ block: "center", inline: "nearest", behavior: opts?.behavior ?? "smooth" });
      }
    } catch {
      // ignore
    }
    try {
      if (typeof from === "number" && typeof to === "number") {
        const editor = editorHandle.getEditor();
        editor.commands.setTextSelection?.({ from, to });
        editor.commands.focus?.();
      }
      // Fallback: if we don't have doc positions (e.g. rendering from persisted thread),
      // derive a best-effort ProseMirror position from the DOM anchor element.
      if ((!from || !to) && anchorEl) {
        const editor = editorHandle.getEditor();
        const view = (editor as any)?.view;
        if (view?.posAtDOM) {
          try {
            const pos = view.posAtDOM(anchorEl, 0);
            const node = view.state.doc.nodeAt(pos);
            const size = node?.nodeSize ?? 1;
            const selFrom = Math.max(0, Math.min(view.state.doc.content.size, pos));
            const selTo = Math.max(selFrom, Math.min(view.state.doc.content.size, selFrom + size));
            editor.commands.setTextSelection?.({ from: selFrom, to: selTo });
            editor.commands.focus?.();
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
    try {
      if (selectedAnchorEl && selectedAnchorEl !== anchorEl) {
        selectedAnchorEl.classList.remove("leditor-source-check--selected");
      }
      selectedAnchorEl = anchorEl ?? null;
      if (anchorEl) {
        anchorEl.classList.add("leditor-source-check--selected");
      }
      if (anchorEl) {
        anchorEl.classList.remove("leditor-citation-anchor--flash");
        void anchorEl.offsetWidth;
        anchorEl.classList.add("leditor-citation-anchor--flash");
        if (pulseTimer) window.clearTimeout(pulseTimer);
        pulseTimer = window.setTimeout(() => {
          try {
            anchorEl.classList.remove("leditor-citation-anchor--flash");
          } catch {
            // ignore
          }
          pulseTimer = null;
        }, 1400);
      }
    } catch {
      // ignore
    }
  };

  const ensureParagraphCard = (paragraphN: number): HTMLElement => {
    const existingCard = cardByParagraph.get(paragraphN);
    if (existingCard) return existingCard;
    const card = document.createElement("div");
    card.className = "leditor-source-check-rail__pCard";
    card.dataset.paragraph = String(paragraphN);
    cardByParagraph.set(paragraphN, card);
    list.appendChild(card);
    return card;
  };

  const dismissKey = (key: string) => {
    const k = String(key || "").trim();
    if (!k) return;
    try {
      editorHandle.execCommand("ai.sourceChecks.dismiss", { key: k });
      console.debug("[source_check_rail.ts][dismissKey][debug]", { key: k, ok: true });
    } catch {
      dismissSourceCheckThreadItem(k);
      schedule();
      console.debug("[source_check_rail.ts][dismissKey][debug]", { key: k, ok: false });
    }
  };

  const renderParagraphCard = (
    card: HTMLElement,
    data: {
      paragraphN: number;
      keys: string[];
      items: Array<{
        key: string;
        verdict: string;
        anchorText: string;
        justification: string;
        fixSuggestion?: string;
        suggestedReplacementKey?: string;
        claimRewrite?: string;
        from: number;
        to: number;
      }>;
    }
  ) => {
    const groupKey = `P${data.paragraphN}`;
    const state = cardStateByKey[groupKey] ?? { collapsed: false };
    card.classList.toggle("is-collapsed", Boolean(state.collapsed));

    const headerEl = document.createElement("div");
    headerEl.className = "leditor-source-check-rail__pHeader";

    const titleEl = document.createElement("div");
    titleEl.className = "leditor-source-check-rail__pTitle";
    titleEl.textContent = `P${data.paragraphN}`;

    const countEl = document.createElement("div");
    countEl.className = "leditor-source-check-rail__pCount";
    countEl.textContent = `${data.items.length}`;

    const btns = document.createElement("div");
    btns.className = "leditor-source-check-rail__cardBtns";

    const btnCollapse = document.createElement("button");
    btnCollapse.type = "button";
    btnCollapse.className = "leditor-source-check-rail__iconBtn";
    btnCollapse.innerHTML = state.collapsed ? iconSvg("expand") : iconSvg("collapse");
    btnCollapse.setAttribute("aria-label", state.collapsed ? "Expand" : "Collapse");
    btnCollapse.setAttribute("title", state.collapsed ? "Expand" : "Collapse");
    bindIconAction(btnCollapse, () => {
      const next = { collapsed: !Boolean(cardStateByKey[groupKey]?.collapsed) };
      cardStateByKey = { ...cardStateByKey, [groupKey]: next };
      saveCardState(cardStateByKey);
      console.debug("[source_check_rail.ts][toggleParagraphCollapse][debug]", { paragraph: data.paragraphN, collapsed: next.collapsed });
      schedule();
    });

    const btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.className = "leditor-source-check-rail__iconBtn";
    btnClose.innerHTML = iconSvg("close");
    btnClose.setAttribute("aria-label", "Dismiss paragraph checks");
    btnClose.setAttribute("title", "Dismiss paragraph checks");
    bindIconAction(btnClose, () => {
      for (const k of data.keys) dismissKey(k);
      schedule();
    });

    btns.append(btnCollapse, btnClose);
    headerEl.append(titleEl, countEl, btns);

    const body = document.createElement("div");
    body.className = "leditor-source-check-rail__pBody";

    const anchorTextByKey = new Map<string, string>();
    for (const it of data.items) anchorTextByKey.set(it.key, it.anchorText);

    for (const it of data.items) {
      const row = document.createElement("div");
      row.className = "leditor-source-check-rail__row";
      row.classList.toggle("is-verified", it.verdict === "verified");
      row.classList.toggle("is-needsReview", it.verdict !== "verified");
      row.dataset.key = it.key;
      row.classList.toggle("is-expanded", Boolean(rowExpandedByKey[it.key]));
      row.classList.toggle("is-selected", selectedKey === it.key);

      const badge = document.createElement("span");
      badge.className = "leditor-source-check-rail__badge";
      badge.textContent = it.verdict === "verified" ? "✓" : "!";

      const main = document.createElement("div");
      main.className = "leditor-source-check-rail__rowMain";

      const aText = document.createElement("div");
      aText.className = "leditor-source-check-rail__anchor";
      aText.textContent = sanitize(it.anchorText, 72);

      const j = document.createElement("div");
      j.className = "leditor-source-check-rail__rowJust";
      const baseJust = it.justification || (it.verdict === "verified" ? "Citation appears consistent." : "Needs review.");
      const extra =
        it.verdict !== "verified" && typeof it.fixSuggestion === "string" && it.fixSuggestion.trim()
          ? `Suggestion: ${it.fixSuggestion.trim()}`
          : "";
      const replKey =
        it.verdict !== "verified" && typeof it.suggestedReplacementKey === "string" && it.suggestedReplacementKey.trim()
          ? it.suggestedReplacementKey.trim()
          : "";
      const replText = replKey ? anchorTextByKey.get(replKey) ?? "" : "";
      const replLine = replKey ? `Suggested replacement citation: ${replText ? sanitize(replText, 84) : replKey}` : "";
      const claimRewriteLine =
        it.verdict !== "verified" && typeof it.claimRewrite === "string" && it.claimRewrite.trim()
          ? `Rewrite: ${it.claimRewrite.trim()}`
          : "";
      const expanded = Boolean(rowExpandedByKey[it.key]);
      if (expanded) {
        const parts = [baseJust, extra, replLine, claimRewriteLine].filter(Boolean);
        j.textContent = parts.join("\n\n");
      } else {
        const inline = [baseJust, extra, replLine, claimRewriteLine].filter(Boolean).join(" ");
        j.textContent = sanitize(inline, 160);
      }

      main.append(aText, j);

      const rowBtns = document.createElement("div");
      rowBtns.className = "leditor-source-check-rail__rowBtns";

      const rowExpand = document.createElement("button");
      rowExpand.type = "button";
      rowExpand.className = "leditor-source-check-rail__iconBtn";
      rowExpand.innerHTML = expanded ? iconSvg("collapse") : iconSvg("expand");
      rowExpand.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
      rowExpand.setAttribute("title", expanded ? "Collapse" : "Expand");
      bindIconAction(rowExpand, () => {
        rowExpandedByKey = { ...rowExpandedByKey, [it.key]: !Boolean(rowExpandedByKey[it.key]) };
        saveRowExpanded(rowExpandedByKey);
        console.debug("[source_check_rail.ts][toggleRowExpanded][debug]", { key: it.key, expanded: Boolean(rowExpandedByKey[it.key]) });
        schedule();
      });

      const rowClose = document.createElement("button");
      rowClose.type = "button";
      rowClose.className = "leditor-source-check-rail__iconBtn";
      rowClose.innerHTML = iconSvg("close");
      rowClose.setAttribute("aria-label", "Dismiss");
      rowClose.setAttribute("title", "Dismiss");
      bindIconAction(rowClose, () => {
        dismissKey(it.key);
        schedule();
      });

      rowBtns.append(rowExpand, rowClose);

      row.append(badge, main, rowBtns);
      row.addEventListener("click", () => {
        focusAnchorByKey(it.key, it.from, it.to);
        schedule();
      });
      body.appendChild(row);
    }

    card.replaceChildren(headerEl, body);
  };

  const clearSvg = () => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  };

  const schedule = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  };

  const render = () => {
    const shouldShow = isSourceChecksVisible();
    overlay.classList.toggle("is-hidden", !shouldShow);
    overlay.style.display = shouldShow ? "" : "none";
    overlay.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    cardsLayer.style.display = shouldShow ? "" : "none";
    cardsLayer.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    if (!shouldShow) {
      try {
        appRoot.classList.remove("leditor-app--source-checks-open");
      } catch {
        // ignore
      }
      clearSvg();
      anchorElByKey.clear();
      try {
        cardsLayer.style.left = "";
      } catch {
        // ignore
      }
      try {
        list.replaceChildren();
      } catch {
        // ignore
      }
      return;
    }
    try {
      appRoot.classList.add("leditor-app--source-checks-open");
    } catch {
      // ignore
    }
    const editor = editorHandle.getEditor();
    const view = (editor as any)?.view;
    if (!view) {
      clearSvg();
      return;
    }
    const { sx, sy } = getScale(scaleEl);
    const threadItems = getSourceChecksThread().items ?? [];
    threadAnchorByKey.clear();
    for (const it of threadItems as any[]) {
      const k = typeof it?.key === "string" ? String(it.key) : "";
      if (!k) continue;
      const a = it?.anchor ?? {};
      threadAnchorByKey.set(k, {
        href: typeof a?.href === "string" ? a.href : "",
        text: typeof a?.text === "string" ? a.text : ""
      });
    }
    let sc = getSourceCheckState(view.state);
    // If we have stored checks but no current decorations, best-effort attach once.
    if ((!sc?.enabled || !Array.isArray(sc.items) || sc.items.length === 0) && threadItems.length > 0) {
      try {
        applySourceChecksThreadToEditor(editorHandle);
        sc = getSourceCheckState(view.state);
      } catch {
        // ignore
      }
    }

    const scItems = sc?.enabled && Array.isArray(sc.items) ? sc.items : [];
    const scByKey = new Map<string, (typeof scItems)[number]>();
    for (const it of scItems) {
      const k = String((it as any)?.key ?? "");
      if (k) scByKey.set(k, it as any);
    }

    // Thread is the source of truth for what to render.
    // Decorations (scItems) are used only for positional data when keys match.
    if (threadItems.length === 0) {
      clearSvg();
      anchorElByKey.clear();
      list.replaceChildren();
      return;
    }

    const overlayRect = overlayHost.getBoundingClientRect();
    const stackEl = appRoot.querySelector<HTMLElement>(".leditor-page-stack") ?? null;
    const stackRect = stackEl?.getBoundingClientRect?.() ?? null;
    const railLeftX = Math.round((((stackRect?.right ?? overlayRect.left + 680) - overlayRect.left) + 18) / sx);
    cardsLayer.style.left = `${Math.max(12, railLeftX)}px`;

    const resolvedByParagraph = new Map<
      number,
      Array<{
        key: string;
        verdict: string;
        justification: string;
        fixSuggestion?: string;
        suggestedReplacementKey?: string;
        anchorText: string;
        from: number;
        to: number;
        anchorX: number;
        anchorY: number;
        pageTopY: number;
        pageBottomY: number;
      }>
    >();

    for (const fromThread of threadItems as any[]) {
      const key = String(fromThread?.key ?? "");
      if (!key) continue;
      const paragraphN = Number.isFinite(fromThread?.paragraphN) ? Math.max(1, Math.floor(fromThread.paragraphN)) : 1;
      const fromSc = scByKey.get(key) as any;
      const verdict = fromSc?.verdict === "verified" ? "verified" : fromThread?.verdict === "verified" ? "verified" : "needs_review";
      const justification = String(fromSc?.justification ?? fromThread?.justification ?? "");
      const fixSuggestion = typeof fromThread?.fixSuggestion === "string" ? String(fromThread.fixSuggestion) : "";
      const suggestedReplacementKey =
        typeof fromThread?.suggestedReplacementKey === "string" ? String(fromThread.suggestedReplacementKey) : "";
      const from = typeof fromSc?.from === "number" ? fromSc.from : 0;
      const to = typeof fromSc?.to === "number" ? fromSc.to : 0;

      const anchorNodeRaw = (appRoot.querySelector<HTMLElement>(`[data-source-check-key="${cssEscape(key)}"]`) as HTMLElement | null) ?? null;
      const anchorNodeFromThread = normalizeCitationAnchorEl(
        queryCitationAnchorByHrefAndText(appRoot, String(fromThread?.anchor?.href ?? ""), String(fromThread?.anchor?.text ?? ""))
      );
      const anchorNode =
        normalizeCitationAnchorEl(anchorNodeRaw) ??
        anchorNodeFromThread ??
        (fromSc ? findAnchorElementFromViewPos(view, Math.max(0, fromSc.from)) : null) ??
        (fromSc ? findAnchorElementFromViewPos(view, Math.max(0, fromSc.to)) : null) ??
        null;
      if (anchorNode) anchorElByKey.set(key, anchorNode);

      const rect = anchorNode?.getBoundingClientRect?.() ?? null;
      const fallback = () => {
        if (fromSc && typeof fromSc.to === "number") {
          const coords = view.coordsAtPos(Math.max(0, Math.min(view.state.doc.content.size, fromSc.to)));
          const cy = (coords.top + coords.bottom) / 2;
          return {
            anchorX: Math.round((coords.right - overlayRect.left) / sx),
            anchorY: Math.round((cy - overlayRect.top) / sy)
          };
        }
        return { anchorX: Math.round((stackRect?.right ?? overlayRect.left + 680) - overlayRect.left + 4), anchorY: 64 };
      };
      const anchorX = rect ? Math.round((rect.right - overlayRect.left) / sx) : fallback().anchorX;
      const anchorY = rect ? Math.round(((rect.top + rect.bottom) / 2 - overlayRect.top) / sy) : fallback().anchorY;

      const pageEl = closestPage(anchorNode) ?? null;
      const pageRect = pageEl?.getBoundingClientRect?.() ?? null;
      const pageTopY = pageRect ? Math.round((pageRect.top - overlayRect.top) / sy) : 0;
      const pageBottomY = pageRect ? Math.round((pageRect.bottom - overlayRect.top) / sy) : Number.MAX_SAFE_INTEGER;

      const anchorText =
        (fromSc && typeof fromSc.from === "number" && typeof fromSc.to === "number" && fromSc.to > fromSc.from
          ? view.state.doc.textBetween(fromSc.from, fromSc.to, " ").trim()
          : "") ||
        String(fromThread?.anchor?.text ?? "") ||
        "(citation)";

      const arr = resolvedByParagraph.get(paragraphN) ?? [];
      arr.push({
        key,
        verdict,
        justification,
        fixSuggestion: fixSuggestion || undefined,
        suggestedReplacementKey: suggestedReplacementKey || undefined,
        anchorText,
        from,
        to,
        anchorX,
        anchorY,
        pageTopY,
        pageBottomY
      });
      resolvedByParagraph.set(paragraphN, arr);
    }

    list.replaceChildren();
    clearSvg();

    const minGap = 10;
    const paragraphCards: Array<{ paragraphN: number; anchorY: number; pageTopY: number; pageBottomY: number }> = [];
    for (const [paragraphN, items] of resolvedByParagraph.entries()) {
      const sorted = [...items].sort((a, b) => a.anchorY - b.anchorY || a.key.localeCompare(b.key));
      const anchorY = sorted[0]?.anchorY ?? 0;
      const pageTopY = sorted[0]?.pageTopY ?? 0;
      const pageBottomY = sorted[0]?.pageBottomY ?? Number.MAX_SAFE_INTEGER;
      paragraphCards.push({ paragraphN, anchorY, pageTopY, pageBottomY });
      resolvedByParagraph.set(paragraphN, sorted);
    }

    const pageBuckets = new Map<string, Array<{ paragraphN: number; anchorY: number; pageTopY: number; pageBottomY: number }>>();
    for (const it of paragraphCards) {
      const bucketKey = `${it.pageTopY}:${it.pageBottomY}`;
      const arr = pageBuckets.get(bucketKey) ?? [];
      arr.push(it);
      pageBuckets.set(bucketKey, arr);
    }
    const sortedBuckets = [...pageBuckets.entries()].sort((a, b) => {
      const aTop = a[1][0]?.pageTopY ?? 0;
      const bTop = b[1][0]?.pageTopY ?? 0;
      return aTop - bTop;
    });

    for (const [_bucketKey, bucketItems] of sortedBuckets) {
      const pageItems = [...bucketItems].sort((a, b) => a.anchorY - b.anchorY || a.paragraphN - b.paragraphN);
      let cursorY = Math.max(0, (pageItems[0]?.pageTopY ?? 0) + 20);
      for (const it of pageItems) {
        const items = resolvedByParagraph.get(it.paragraphN) ?? [];
        const card = ensureParagraphCard(it.paragraphN);
        renderParagraphCard(card, {
          paragraphN: it.paragraphN,
          keys: items.map((x) => x.key),
          items: items.map((x) => ({
            key: x.key,
            verdict: x.verdict,
            anchorText: x.anchorText,
            justification: x.justification,
            fixSuggestion: x.fixSuggestion,
            suggestedReplacementKey: x.suggestedReplacementKey,
            from: x.from,
            to: x.to
          }))
        });

        if (card.parentElement !== list) list.appendChild(card);
        card.style.left = `0px`;
        card.style.top = `0px`;

        const h = Math.ceil((card as any).offsetHeight || (card.getBoundingClientRect().height / sy) || 84);
        const desiredY = it.anchorY - 16;
        const y = Math.max(desiredY, cursorY + minGap);
        cursorY = y + h;

        const clampTop = Math.max(0, it.pageTopY + 12);
        const clampBottom = Math.max(clampTop, it.pageBottomY - h - 12);
        const clampedY = Math.max(clampTop, Math.min(clampBottom, y));
        card.style.top = `${clampedY}px`;
      }
    }
  };

  const onScroll = () => schedule();
  const onResize = () => schedule();
  const onAutoFocus = (event: Event) => {
    try {
      const detail = (event as CustomEvent).detail as any;
      const key = typeof detail?.key === "string" ? String(detail.key) : "";
      if (!key) return;
      if (!isSourceChecksVisible()) return;
      schedule();
      window.setTimeout(() => {
        try {
          focusAnchorByKey(key, undefined, undefined, { behavior: "auto" });
        } catch {
          // ignore
        }
      }, 30);
    } catch {
      // ignore
    }
  };

  const unsubThread = subscribeSourceChecksThread(() => schedule());
  scrollRoot.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener(AUTO_FOCUS_EVENT, onAutoFocus as any);
  editorHandle.on("change", schedule);
  editorHandle.on("selectionChange", schedule);

  // Initial render (showing stored thread if toggle is on).
  schedule();

  return {
    destroy() {
      try {
        if (raf) window.cancelAnimationFrame(raf);
      } catch {
        // ignore
      }
      try {
        if (pulseTimer) window.clearTimeout(pulseTimer);
      } catch {
        // ignore
      }
      try {
        unsubThread();
      } catch {
        // ignore
      }
      try {
        scrollRoot.removeEventListener("scroll", onScroll);
      } catch {
        // ignore
      }
      try {
        window.removeEventListener("resize", onResize);
      } catch {
        // ignore
      }
      try {
        window.removeEventListener(AUTO_FOCUS_EVENT, onAutoFocus as any);
      } catch {
        // ignore
      }
      try {
        cardsLayer.removeEventListener("wheel", onWheel as any);
      } catch {
        // ignore
      }
      try {
        editorHandle.off("change", schedule);
        editorHandle.off("selectionChange", schedule);
      } catch {
        // ignore
      }
      try {
        overlay.remove();
      } catch {
        // ignore
      }
      try {
        cardsLayer.remove();
      } catch {
        // ignore
      }
    }
  };
};
