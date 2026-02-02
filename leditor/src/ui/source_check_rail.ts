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
const COLLAPSE_KEY = "leditor.sourceChecks.cardState";

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

const closestPage = (el: Element | null): HTMLElement | null => {
  const page = el?.closest?.(".leditor-page") as HTMLElement | null;
  if (page) return page;
  const content = el?.closest?.(".leditor-page-content") as HTMLElement | null;
  return (content?.closest?.(".leditor-page") as HTMLElement | null) ?? null;
};

export const mountSourceCheckRail = (editorHandle: EditorHandle) => {
  const appRoot = pickAppRoot();
  if (!appRoot) return { destroy() {} };
  const zoomLayer =
    (appRoot.querySelector(".leditor-a4-zoom") as HTMLElement | null) ??
    (appRoot.querySelector(".leditor-a4-canvas") as HTMLElement | null) ??
    appRoot;

  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "leditor-source-check-rail";
  overlay.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("leditor-source-check-rail__lines");
  svg.setAttribute("aria-hidden", "true");

  const rail = document.createElement("div");
  rail.className = "leditor-source-check-rail__rail";

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
  rail.appendChild(header);

  const list = document.createElement("div");
  list.className = "leditor-source-check-rail__list";
  rail.appendChild(list);

  overlay.append(svg, rail);
  zoomLayer.appendChild(overlay);

  const cardByKey = new Map<string, HTMLElement>();
  let cardStateByKey: Record<string, CardState> = loadCardState();
  let raf = 0;

  const ensureCard = (key: string): HTMLElement => {
    const existingCard = cardByKey.get(key);
    if (existingCard) return existingCard;
    const card = document.createElement("div");
    card.className = "leditor-source-check-rail__card";
    card.dataset.key = key;
    cardByKey.set(key, card);
    list.appendChild(card);
    return card;
  };

  const renderCard = (card: HTMLElement, data: { verdict: string; anchorText: string; p?: number; justification: string }) => {
    const key = String(card.dataset.key || "");
    const state = cardStateByKey[key] ?? { collapsed: false };
    card.classList.toggle("is-collapsed", Boolean(state.collapsed));
    card.classList.toggle("is-verified", data.verdict === "verified");
    card.classList.toggle("is-needsReview", data.verdict !== "verified");

    const headerEl = document.createElement("div");
    headerEl.className = "leditor-source-check-rail__cardHeader";
    const badge = document.createElement("span");
    badge.className = "leditor-source-check-rail__badge";
    badge.textContent = data.verdict === "verified" ? "✓" : "!";
    const anchor = document.createElement("span");
    anchor.className = "leditor-source-check-rail__anchor";
    anchor.textContent = sanitize(data.anchorText, 64);
    const meta = document.createElement("span");
    meta.className = "leditor-source-check-rail__meta";
    meta.textContent = data.p ? `P${data.p}` : "";

    const btns = document.createElement("div");
    btns.className = "leditor-source-check-rail__cardBtns";

    const btnCollapse = document.createElement("button");
    btnCollapse.type = "button";
    btnCollapse.className = "leditor-source-check-rail__iconBtn";
    btnCollapse.textContent = state.collapsed ? "+" : "–";
    btnCollapse.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = { collapsed: !Boolean(cardStateByKey[key]?.collapsed) };
      cardStateByKey = { ...cardStateByKey, [key]: next };
      saveCardState(cardStateByKey);
      schedule();
    });

    const btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.className = "leditor-source-check-rail__iconBtn";
    btnClose.textContent = "×";
    btnClose.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        editorHandle.execCommand("ai.sourceChecks.dismiss", { key });
      } catch {
        dismissSourceCheckThreadItem(key);
        schedule();
      }
    });

    btns.append(btnCollapse, btnClose);
    headerEl.append(badge, anchor, meta, btns);

    const body = document.createElement("div");
    body.className = "leditor-source-check-rail__body";
    body.textContent = data.justification || (data.verdict === "verified" ? "Citation appears consistent." : "Needs review.");

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
    if (!shouldShow) {
      clearSvg();
      return;
    }
    const editor = editorHandle.getEditor();
    const view = (editor as any)?.view;
    if (!view) {
      clearSvg();
      return;
    }
    const sc = getSourceCheckState(view.state);
    if (!sc?.enabled || !Array.isArray(sc.items) || sc.items.length === 0) {
      // If we have stored thread items, best-effort re-attach so the rail can show.
      if (getSourceChecksThread().items.length > 0) {
        try {
          applySourceChecksThreadToEditor(editorHandle);
        } catch {
          // ignore
        }
      }
      clearSvg();
      list.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "leditor-source-check-rail__empty";
      empty.textContent = "No source checks yet.";
      empty.style.left = header.style.left || "12px";
      list.appendChild(empty);
      return;
    }

    const overlayRect = overlay.getBoundingClientRect();
    try {
      const pages = Array.from(document.querySelectorAll<HTMLElement>(".leditor-page"));
      const topmost =
        pages
          .map((p) => ({ p, rect: p.getBoundingClientRect() }))
          .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]?.rect ?? null;
      if (topmost) {
        header.style.left = `${Math.max(12, Math.round(topmost.right - overlayRect.left + 18))}px`;
      } else {
        header.style.left = "12px";
      }
    } catch {
      header.style.left = "12px";
    }
    const groups = new Map<string, Array<{ key: string; anchorX: number; anchorY: number; pageKey: string; pageRightX: number }>>();
    const cardDataByKey = new Map<string, { verdict: string; anchorText: string; justification: string; p?: number }>();

    for (const item of sc.items) {
      const key = String(item.key || "");
      if (!key) continue;
      const coords = view.coordsAtPos(Math.max(0, Math.min(view.state.doc.content.size, item.to)));
      const cx = (coords.left + coords.right) / 2;
      const cy = (coords.top + coords.bottom) / 2;
      const elAt = document.elementFromPoint(cx, cy);
      const pageEl = closestPage(elAt);
      const pageIndex = pageEl?.dataset?.pageIndex ? String(pageEl.dataset.pageIndex) : "page";
      const pageRect = pageEl?.getBoundingClientRect();
      const pageRight = pageRect ? pageRect.right : overlayRect.left + 680;
      const pageRightX = Math.round(pageRight - overlayRect.left);
      const anchorX = Math.round(coords.right - overlayRect.left);
      const anchorY = Math.round(cy - overlayRect.top);
      const group = groups.get(pageIndex) ?? [];
      group.push({ key, anchorX, anchorY, pageKey: pageIndex, pageRightX });
      groups.set(pageIndex, group);

      const anchorText = view.state.doc.textBetween(item.from, item.to, " ").trim() || "(citation)";
      cardDataByKey.set(key, {
        verdict: item.verdict === "verified" ? "verified" : "needs_review",
        anchorText,
        justification: String(item.justification || "")
      });
    }

    // Ensure list order is stable.
    list.replaceChildren();
    clearSvg();

    const minGap = 10;
    for (const [pageKey, listItems] of groups) {
      const pageItems = [...listItems].sort((a, b) => a.anchorY - b.anchorY || a.key.localeCompare(b.key));
      let cursorY = -Infinity;
      for (const it of pageItems) {
        const data = cardDataByKey.get(it.key)!;
        const card = ensureCard(it.key);
        renderCard(card, data);
        // Attach before measuring.
        if (card.parentElement !== list) list.appendChild(card);
        card.style.left = `${Math.max(0, it.pageRightX + 18)}px`;
        card.style.top = `0px`;
        // Measure and stack.
        const h = Math.ceil(card.getBoundingClientRect().height || 64);
        const desiredY = it.anchorY - 12;
        const y = Math.max(desiredY, cursorY + minGap);
        cursorY = y + h;
        card.style.top = `${Math.max(0, y)}px`;
        card.dataset.pageKey = pageKey;

        const endX = Math.max(0, it.pageRightX + 14);
        const endY = Math.max(0, y + 18);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const elbowX = Math.max(it.anchorX + 18, endX - 18);
        path.setAttribute(
          "d",
          `M ${it.anchorX} ${it.anchorY} L ${elbowX} ${it.anchorY} L ${elbowX} ${endY} L ${endX} ${endY}`
        );
        path.setAttribute("class", data.verdict === "verified" ? "is-verified" : "is-needsReview");
        svg.appendChild(path);
      }
    }
  };

  const onScroll = () => schedule();
  const onResize = () => schedule();

  const unsubThread = subscribeSourceChecksThread(() => schedule());
  appRoot.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
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
        unsubThread();
      } catch {
        // ignore
      }
      try {
        appRoot.removeEventListener("scroll", onScroll);
      } catch {
        // ignore
      }
      try {
        window.removeEventListener("resize", onResize);
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
    }
  };
};
