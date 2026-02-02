import {
  ribbonDebugEnabled,
  ribbonDebugEvent,
  ribbonDebugLog,
  ribbonDebugMutation,
  ribbonDebugTabFilter,
  ribbonDebugVerbose
} from "./ribbon_debug.ts";

type DebugHandles = {
  dispose: () => void;
};

const CONTROL_SELECTOR =
  ".leditor-ribbon-button, .ribbon-dropdown-button, .leditor-split-primary, .leditor-split-caret, " +
  ".leditor-ribbon-icon-btn, .leditor-ribbon-spinner-step, .ribbon-dialog-launcher-btn, .ribbon-overflow-button, .ribbon-group-button";

let lastRibbonTab: string | null = null;
let lastRibbonControl: string | null = null;
export const setRibbonDebugContext = (tabId: string | null, controlId: string | null): void => {
  lastRibbonTab = tabId;
  lastRibbonControl = controlId;
};

export const ribbonTraceCall = <T>(label: string, detail: Record<string, unknown>, fn: () => T): T => {
  const tab = lastRibbonTab;
  if (!tabMatches(tab)) return fn();
  const verbose = ribbonDebugVerbose();
  const start = performance.now();
  try {
    ribbonDebugLog(`call:start:${label}`, { ...detail, tab, control: lastRibbonControl, stack: verbose ? new Error().stack : undefined });
    const result = fn();
    if (ribbonDebugVerbose()) {
      ribbonDebugLog(`call:result:${label}`, {
        tab,
        control: lastRibbonControl,
        result: safeResultPreview(result)
      });
    }
    return result;
  } finally {
    const duration = performance.now() - start;
    ribbonDebugLog(`call:end:${label}`, { duration, tab, control: lastRibbonControl, stack: verbose ? new Error().stack : undefined });
  }
};

type ControlSnapshot = {
  controlId: string | null;
  tabId: string | null;
  svgCount: number;
  hasIcon: boolean;
  dataset: Record<string, string>;
  display: string | null;
  visibility: string | null;
  opacity: string | null;
  client: { w: number; h: number } | null;
};

const snapshotControl = (control: HTMLElement | null): ControlSnapshot | null => {
  if (!control) return null;
  const style = getComputedStyle(control);
  const dataset: Record<string, string> = {};
  Object.keys(control.dataset).forEach((k) => {
    dataset[k] = control.dataset[k] ?? "";
  });
  return {
    controlId: control.dataset.controlId ?? null,
    tabId: control.closest?.(".leditor-ribbon-panel")?.getAttribute("data-tab-id") ?? null,
    svgCount: control.querySelectorAll("svg").length,
    hasIcon: Boolean(control.querySelector("svg")),
    dataset,
    display: style?.display ?? null,
    visibility: style?.visibility ?? null,
    opacity: style?.opacity ?? null,
    client: control ? { w: control.clientWidth, h: control.clientHeight } : null
  };
};

const safeResultPreview = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" && value.length > 120) return `${value.slice(0, 120)}…`;
  if (Array.isArray(value)) return { kind: "array", length: value.length };
  if (value instanceof HTMLElement) return { kind: "HTMLElement", tag: value.tagName, class: value.className };
  if (typeof value === "object") return { kind: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 10) };
  return value;
};

const tabMatches = (tabId: string | null): boolean => {
  const filter = ribbonDebugTabFilter();
  if (!filter) return true;
  if (filter === "all") return true;
  return (tabId ?? "").toLowerCase() === filter;
};

const formatNode = (node: Node | null): string | null => {
  if (!node) return null;
  if (node instanceof HTMLElement) {
    const id = node.getAttribute("data-control-id") || node.id;
    const cls = node.className || "";
    return `${node.tagName}${id ? `#${id}` : ""}${cls ? `.${cls}` : ""}`;
  }
  return node.nodeName;
};

const installEventLogger = (host: HTMLElement): (() => void) => {
  const docShell = host.closest(".leditor-app")?.querySelector(".leditor-doc-shell") as HTMLElement | null;
  const events: (keyof GlobalEventHandlersEventMap)[] = [
    "pointerenter",
    "pointerleave",
    // pointermove intentionally omitted to avoid log spam
    "pointerdown",
    "pointerup",
    "click",
    "focus",
    "blur",
    "contextmenu",
    "keydown",
    "keyup"
  ];
  const handler = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const control = target?.closest?.(CONTROL_SELECTOR) as HTMLElement | null;
    const tabId = control?.closest?.(".leditor-ribbon-panel")?.getAttribute("data-tab-id") ?? null;
    if (!tabMatches(tabId)) return;
    setRibbonDebugContext(tabId, control?.dataset?.controlId ?? null);
    const active = document.activeElement as HTMLElement | null;
    const scrollTop = docShell?.scrollTop ?? null;
    const verbose = ribbonDebugVerbose();
    const snap = snapshotControl(control);
    ribbonDebugEvent(event.type, {
      controlId: control?.dataset?.controlId ?? null,
      tabId,
      node: target?.tagName ?? null,
      activeNode: active?.tagName ?? null,
      activeControlId: active?.closest?.(CONTROL_SELECTOR)?.getAttribute("data-control-id") ?? null,
      docScrollTop: scrollTop,
      key: event instanceof KeyboardEvent ? event.key : undefined,
      buttons: event instanceof PointerEvent ? event.buttons : undefined,
      stack: verbose ? new Error().stack : undefined,
      snapshot: snap
    });
    if (snap && control?.dataset?.controlId && /grammar|proof|spell|review/i.test(control.dataset.controlId)) {
      ribbonDebugLog("grammar/proofing control event", { event: event.type, control: control.dataset.controlId, snapshot: snap });
    }
  };
  events.forEach((ev) => host.addEventListener(ev, handler, true));
  return () => events.forEach((ev) => host.removeEventListener(ev, handler, true));
};

const installMutationLogger = (host: HTMLElement): MutationObserver => {
  let mutationCount = 0;
  const loopInterval = window.setInterval(() => {
    if (!mutationCount) return;
    if (mutationCount > 50) {
      ribbonDebugLog("background mutation burst", { count: mutationCount, tab: lastRibbonTab, control: lastRibbonControl });
    }
    mutationCount = 0;
  }, 1000);

  const isNonFluentNode = (node: Node | null): string | null => {
    if (!(node instanceof HTMLElement)) return null;
    if (node.matches("i, span[class*='icon'], span[class*='Icon'], .codicon, .ms-Icon")) {
      return node.className || node.tagName;
    }
    if (node.tagName.toLowerCase() === "svg" && !node.classList.contains("leditor-ribbon-icon")) {
      return `${node.tagName}.${node.className}`;
    }
    return null;
  };

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      mutationCount += 1;
      const control =
        (m.target instanceof HTMLElement && m.target.matches(CONTROL_SELECTOR)
          ? (m.target as HTMLElement)
          : m.target instanceof HTMLElement
            ? (m.target.closest?.(CONTROL_SELECTOR) as HTMLElement | null)
            : null) || null;
      const snap = snapshotControl(control);
      const verbose = ribbonDebugVerbose();
      const targetIsControl = control && control === m.target;
      const targetHasIcon =
        m.target instanceof HTMLElement && (m.target.matches("svg") || m.target.querySelector?.("svg"));

      // Allow common state-class mutations to be suppressed unless they touch a control or icon.
      const suppressedAttribute =
        m.type === "attributes" &&
        !verbose &&
        (m.attributeName === "class" ||
          m.attributeName === "aria-pressed" ||
          m.attributeName === "data-state" ||
          m.attributeName === "hidden" ||
          m.attributeName === "aria-checked");
      if (suppressedAttribute && !targetIsControl && !targetHasIcon) {
        return;
      }

      // Detect non-Fluent icon injections (e.g., icon fonts or unexpected nodes) on mutation.
      let nonFluentIcon: string | null = null;
      if (control) {
        const bad =
          isNonFluentNode(m.target) ||
          Array.from(m.addedNodes).map(isNonFluentNode).find(Boolean) ||
          Array.from(control.querySelectorAll("*")).map(isNonFluentNode).find(Boolean);
        if (bad) nonFluentIcon = bad;
      }
      ribbonDebugMutation("ribbon mutation", {
        type: m.type,
        target: formatNode(m.target),
        attributeName: m.attributeName ?? null,
        added: m.addedNodes.length,
        removed: m.removedNodes.length,
        controlId: control?.dataset?.controlId ?? null,
        tabId: control?.closest?.(".leditor-ribbon-panel")?.getAttribute("data-tab-id") ?? null,
        snapshot: snap,
        nonFluentIcon
      });
    });
  });
  observer.observe(host, { subtree: true, childList: true, attributes: true });
  (observer as any).__loopInterval = loopInterval;
  return observer;
};

const installResizeLogger = (host: HTMLElement): ResizeObserver => {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const rect = entry.contentRect;
      ribbonDebugLog("ribbon resize", { width: rect.width, height: rect.height, tab: lastRibbonTab });
    }
  });
  observer.observe(host);
  return observer;
};

const installScrollLogger = (host: HTMLElement): (() => void) => {
  const docShell = host.closest(".leditor-app")?.querySelector(".leditor-doc-shell") as HTMLElement | null;
  if (!docShell) return () => {};
  const handler = () => ribbonDebugLog("doc shell scroll", { scrollTop: docShell.scrollTop, tab: lastRibbonTab });
  docShell.addEventListener("scroll", handler, { passive: true });
  return () => docShell.removeEventListener("scroll", handler);
};

const installErrorLogger = (host: HTMLElement): (() => void) => {
  const handler = (event: ErrorEvent) => {
    if (!(event.target instanceof Node)) return;
    if (!host.contains(event.target)) return;
    ribbonDebugLog("error in ribbon subtree", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack
    });
  };
  window.addEventListener("error", handler, true);
  return () => window.removeEventListener("error", handler, true);
};

export const installRibbonDebugger = (host: HTMLElement): DebugHandles => {
  const badge = document.createElement("div");
  badge.className = "ribbon-debug-badge";
  badge.textContent = "DEBUG";
  host.appendChild(badge);
  const uninstallEvents = installEventLogger(host);
  const mutationObserver = installMutationLogger(host);
  const resizeObserver = installResizeLogger(host);
  const uninstallScroll = installScrollLogger(host);
  const uninstallError = installErrorLogger(host);
  // Icon integrity auditor: detect disappearing/reappearing icons.
  const iconState = new Map<string, { tab: string | null; svgCount: number; hash: string }>();
  const iconAuditor = window.setInterval(() => {
    if (!ribbonDebugEnabled()) return;
    host.querySelectorAll<HTMLElement>(CONTROL_SELECTOR).forEach((control) => {
      const tab = control.closest?.(".leditor-ribbon-panel")?.getAttribute("data-tab-id") ?? null;
      if (!tabMatches(tab)) return;
      const id = control.dataset.controlId ?? `anon-${control.dataset.size ?? ""}-${control.className}`;
      const svgs = control.querySelectorAll("svg").length;
      const hash = `${svgs}|${control.className}`;
      const prev = iconState.get(id);
      if (!prev) {
        iconState.set(id, { tab, svgCount: svgs, hash });
        return;
      }
      if (prev.hash !== hash) {
        ribbonDebugLog("icon change detected", {
          controlId: id,
          tab,
          prevSvg: prev.svgCount,
          nextSvg: svgs,
          prevClass: prev.hash,
          nextClass: hash
        });
        iconState.set(id, { tab, svgCount: svgs, hash });
      }
    });
  }, 800);
  const syncVisual = () => {
    const on = ribbonDebugEnabled();
    host.classList.toggle("leditor-ribbon-debug", on);
    badge.hidden = !on;
  };
  syncVisual();
  const visualInterval = window.setInterval(syncVisual, 500);
  const keyHandler = (event: KeyboardEvent) => {
    if (!event.ctrlKey || !event.altKey || event.key.toLowerCase() !== "d") return;
    const win = window as typeof window & { __leditorRibbonDebugTab?: string | null };
    if (event.shiftKey) {
      win.__leditorRibbonDebugTab = "all";
      ribbonDebugLog("debug tab set to all via keyboard");
    } else {
      const next = lastRibbonTab ?? "home";
      win.__leditorRibbonDebugTab = next;
      ribbonDebugLog("debug tab set via keyboard", { tab: next });
    }
  };
  window.addEventListener("keydown", keyHandler, true);
  ribbonDebugLog("ribbon debugger installed");

  const dispose = () => {
    try {
      uninstallEvents();
    } catch {
      // ignore
    }
    try {
      uninstallScroll();
    } catch {
      // ignore
    }
    try {
      uninstallError();
    } catch {
      // ignore
    }
    try {
      mutationObserver.disconnect();
    } catch {
      // ignore
    }
    try {
      const interval = (mutationObserver as any).__loopInterval as number | undefined;
      if (interval) window.clearInterval(interval);
    } catch {
      // ignore
    }
    try {
      resizeObserver.disconnect();
    } catch {
      // ignore
    }
    try {
      window.removeEventListener("keydown", keyHandler, true);
    } catch {
      // ignore
    }
    try {
      window.clearInterval(iconAuditor);
    } catch {
      // ignore
    }
    try {
      window.clearInterval(visualInterval);
    } catch {
      // ignore
    }
    try {
      badge.remove();
    } catch {
      // ignore
    }
    host.classList.remove("leditor-ribbon-debug");
  };

  return { dispose };
};
