import type { EditorHandle } from "../api/leditor.ts";

import { TextSelection } from "@tiptap/pm/state";

import type { Editor } from "@tiptap/core";

import { createFluentSvgIcon } from "./fluent_svg.ts";



const APP_CLASS_READ = "leditor-app--read-mode";

const APP_CLASS_HORIZONTAL = "leditor-app--horizontal-scroll";

const APP_CLASS_RULER = "leditor-app--show-ruler";
const APP_CLASS_PAGE_BOUNDARIES = "leditor-app--show-page-boundaries";
const APP_CLASS_PAGE_BREAKS = "leditor-app--show-page-breaks";
const APP_CLASS_PAGINATION_CONTINUOUS = "leditor-app--pagination-continuous";

const APP_CLASS_GRID = "leditor-app--show-gridlines";

const NAV_PANEL_ID = "leditor-navigation-panel";



let appRoot: HTMLElement | null = null;

let navPanel: HTMLElement | null = null;
let navBody: HTMLElement | null = null;
let navDockButton: HTMLButtonElement | null = null;
let navSearchInput: HTMLInputElement | null = null;
let navTreeHost: HTMLElement | null = null;

let navVisible = false;
let navDocked = false;
let navEntriesFlat: Array<{ id: string; label: string; level: number; pos: number; parentId: string | null }> = [];
let navActiveId: string | null = null;
let navRenderLockUntil = 0;
let navGestureUntil = 0;
let navCollapsed: Record<string, boolean> = {};
let navSearchQuery = "";
let readModeActive = false;
let scrollDirectionState: "vertical" | "horizontal" = "vertical";
let rulerVisibleState = false;
let gridVisibleState = false;
let pageBoundariesVisibleState = true;
let pageBreakMarksVisibleState = true;
let paginationModeState: "paged" | "continuous" = "paged";

type NavNode = {
  id: string;
  label: string;
  level: number;
  pos: number;
  parentId: string | null;
  children: NavNode[];
};

const NAV_STORAGE_KEY = "leditor:navigationPanel:state:v1";

const safeParseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const navDebugEnabled = (): boolean => {
  try {
    return (
      Boolean((window as any).__leditorNavDebug) ||
      (window.localStorage?.getItem("leditor:nav:debug") ?? "") === "1"
    );
  } catch {
    return false;
  }
};

const navLog = (event: string, data?: any) => {
  if (!navDebugEnabled()) return;
  try {
    console.info(`[leditor][nav] ${event}`, data ?? "");
    // Expose state for debugging in DevTools when debug is on.
    (window as any).__navCollapsed = navCollapsed;
  } catch {
    // ignore
  }
};

const getCurrentEditor = (): Editor | null => {
  try {
    const handle = (window as any).leditor as EditorHandle | undefined;
    return handle?.getEditor?.() ?? null;
  } catch {
    return null;
  }
};

const normalizeNavText = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const flashHeading = (editor: Editor, pos: number) => {
  try {
    const view = editor.view;
    const dom = view.domAtPos(Math.max(0, pos));
    const target =
      (dom.node as HTMLElement | null)?.closest?.("h1,h2,h3,h4,h5,h6") ||
      (dom.node as HTMLElement | null)?.parentElement;
    if (!target) return;
    const cls = "leditor-heading-flash";
    target.classList.add(cls);
    window.setTimeout(() => target.classList.remove(cls), 5000);
  } catch {
    // ignore
  }
};

const loadNavState = () => {
  const stored = safeParseJson<{ collapsed?: Record<string, boolean>; query?: string }>(
    window.localStorage?.getItem(NAV_STORAGE_KEY) ?? null,
    {}
  );
  if (stored.collapsed && typeof stored.collapsed === "object") {
    navCollapsed = stored.collapsed;
  }
  if (typeof stored.query === "string") {
    navSearchQuery = stored.query;
  }
};

const saveNavState = () => {
  try {
    window.localStorage?.setItem(
      NAV_STORAGE_KEY,
      JSON.stringify({ collapsed: navCollapsed, query: navSearchQuery })
    );
  } catch {
    // ignore storage failures
  }
};

const getDocScroller = (): HTMLElement | null => {
  if (!appRoot) return null;
  return appRoot.querySelector<HTMLElement>(".leditor-doc-shell") ?? appRoot;
};

const scrollEditorToPos = (editor: Editor, pos: number) => {
  const doc = editor.state.doc;
  const target = Math.max(0, Math.min((doc.content.size || 0), pos + 1));
  navLog("scrollToPos", { pos, target, docSize: doc.content.size });
  try {
    const selection = TextSelection.create(doc, target);
    editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  } catch {
    // ignore
  }

  try {
    const coords = editor.view.coordsAtPos(target);
    const scroller = getDocScroller();
    if (scroller) {
      const s = scroller.getBoundingClientRect();
      const delta = coords.top - s.top - 80;
      navLog("scrollFallback", {
        coordsTop: coords.top,
        scrollerTop: s.top,
        delta,
        scrollTopBefore: scroller.scrollTop
      });
      scroller.scrollTo({ top: scroller.scrollTop + delta, left: scroller.scrollLeft, behavior: "auto" });
    }
  } catch {
    // ignore
  }

  try {
    (editor.view.dom as any)?.focus?.({ preventScroll: true });
  } catch {
    editor.commands.focus();
  }
};



const getNavigationHost = (): HTMLElement | null => {
  if (!appRoot) return null;
  return appRoot.querySelector<HTMLElement>(".leditor-main-split") ?? appRoot;
};

const updateNavDocking = () => {
  if (!navPanel) return;
  navPanel.classList.toggle("is-docked", navDocked);
  navPanel.classList.toggle("is-floating", !navDocked);
  if (navDockButton) {
    navDockButton.textContent = navDocked ? "Undock" : "Dock";
  }
};

export const toggleNavigationDock = () => {
  navDocked = !navDocked;
  updateNavDocking();
};

const ensureNavPanel = (): HTMLElement | null => {

  if (!appRoot) {

    return null;

  }

  if (navPanel) {

    return navPanel;

  }

	  const host = getNavigationHost();
	  if (!host) return null;

	  loadNavState();
	
	  navPanel = document.createElement("div");

  navPanel.id = NAV_PANEL_ID;

  navPanel.className = "leditor-navigation-panel";

  navPanel.setAttribute("role", "navigation");

  navPanel.setAttribute("aria-label", "Document map");

	  const header = document.createElement("div");
	  header.className = "leditor-navigation-header";
	  const title = document.createElement("div");
	  title.className = "leditor-navigation-title";
	  try {
	    const icon = createFluentSvgIcon("Navigation20Filled");
	    icon.classList.add("leditor-navigation-title-icon");
	    title.appendChild(icon);
	  } catch {
	    // icon optional
	  }
	  const titleText = document.createElement("div");
	  titleText.className = "leditor-navigation-title-text";
	  titleText.textContent = "Navigation";
	  title.appendChild(titleText);
	  const actions = document.createElement("div");
	  actions.className = "leditor-navigation-actions";
  navDockButton = document.createElement("button");
  navDockButton.type = "button";
  navDockButton.className = "leditor-navigation-dock";
  navDockButton.textContent = navDocked ? "Undock" : "Dock";
  navDockButton.addEventListener("click", () => toggleNavigationDock());
  actions.appendChild(navDockButton);
  header.append(title, actions);

	  navBody = document.createElement("div");
	  navBody.className = "leditor-navigation-body";
	  const searchWrap = document.createElement("div");
	  searchWrap.className = "leditor-navigation-search-wrap";
	  navSearchInput = document.createElement("input");
	  navSearchInput.className = "leditor-navigation-search";
	  navSearchInput.type = "search";
	  navSearchInput.placeholder = "Search headings";
	  navSearchInput.value = navSearchQuery;
	  navSearchInput.addEventListener("input", () => {
	    navSearchQuery = navSearchInput?.value ?? "";
	    saveNavState();
	    // Re-render against the current editor instance if available.
	    const handle = (window as any).leditor as EditorHandle | undefined;
	    const editor = handle?.getEditor?.();
	    if (editor) renderNavigation(editor);
	  });
	  searchWrap.appendChild(navSearchInput);

	  navTreeHost = document.createElement("div");
	  navTreeHost.className = "leditor-navigation-tree";
	  navTreeHost.setAttribute("role", "tree");

  navBody.append(searchWrap, navTreeHost);

  navPanel.append(header, navBody);

  // Keep renders stable during nav gestures without blocking events.
  const onPointerDown = () => {
    const now = performance.now();
    navGestureUntil = now + 220;
    navRenderLockUntil = Math.max(navRenderLockUntil, now + 120);
  };
  const onPointerUp = () => {
    const now = performance.now();
    navGestureUntil = now + 80;
    navRenderLockUntil = Math.max(navRenderLockUntil, now + 40);
  };
  navPanel.addEventListener("pointerdown", onPointerDown, true);
  navPanel.addEventListener("pointerup", onPointerUp, true);
  navPanel.addEventListener("pointercancel", onPointerUp, true);
  navPanel.addEventListener("mouseleave", onPointerUp, true);

  const docShell = host.querySelector<HTMLElement>(".leditor-doc-shell");
  if (docShell) {
    host.insertBefore(navPanel, docShell);
  } else {
    host.appendChild(navPanel);
  }

  navPanel.classList.toggle("is-open", navVisible);
  updateNavDocking();

  return navPanel;

};



const buildHeadingFlatList = (
  editor: Editor
): Array<{ id: string; label: string; level: number; pos: number; parentId: string | null }> => {
  const results: Array<{ id: string; label: string; level: number; pos: number; parentId: string | null }> = [];
  const stack: Array<{ id: string; level: number }> = [];
  const countsByBase = new Map<string, number>();

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;

    const text = node.textContent?.trim() ?? "";
    if (!text) return true;

    const level = Math.max(1, Math.min(6, Number(node.attrs?.level ?? 1) || 1));

    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parentId = stack.length ? stack[stack.length - 1].id : null;

    const base = `${level}:${normalizeNavText(text)}`;
    const next = (countsByBase.get(base) ?? 0) + 1;
    countsByBase.set(base, next);
    const id = `${base}:${next}`;

    results.push({ id, label: text, level, pos, parentId });
    stack.push({ id, level });
    return true;
  });

  return results;
};

const buildHeadingTree = (
  flat: Array<{ id: string; label: string; level: number; pos: number; parentId: string | null }>
): NavNode[] => {
  const nodesById = new Map<string, NavNode>();
  const roots: NavNode[] = [];

  flat.forEach((h) => {
    nodesById.set(h.id, {
      id: h.id,
      label: h.label,
      level: h.level,
      pos: h.pos,
      parentId: h.parentId,
      children: []
    });
  });

  flat.forEach((h) => {
    const node = nodesById.get(h.id);
    if (!node) return;
    if (h.parentId && nodesById.has(h.parentId)) {
      nodesById.get(h.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
};

const computeActiveHeadingId = (
  flat: Array<{ id: string; label: string; level: number; pos: number; parentId: string | null }>,
  activePos: number
): string | null => {
  let best: { pos: number; id: string } | null = null;
  for (const entry of flat) {
    if (entry.pos <= activePos) {
      if (!best || entry.pos >= best.pos) best = { pos: entry.pos, id: entry.id };
    }
  }
  return best?.id ?? null;
};

const ensureAncestorsExpanded = (
  flat: Array<{ id: string; label: string; level: number; pos: number; parentId: string | null }>,
  id: string | null
) => {
  if (!id) return false;
  const parentById = new Map<string, string | null>();
  flat.forEach((e) => parentById.set(e.id, e.parentId));

  let cur = parentById.get(id) ?? null;
  let changed = false;
  while (cur) {
    if (navCollapsed[cur]) {
      navCollapsed[cur] = false;
      changed = true;
    }
    cur = parentById.get(cur) ?? null;
  }
  if (changed) saveNavState();
  return changed;
};

const buildNavigationEntries = (
  editor: Editor
): Array<{ id: string; label: string; level: number; pos: number; parentId: string | null }> => {
  const flat = buildHeadingFlatList(editor);
  navEntriesFlat = flat;
  const q = normalizeNavText(navSearchQuery);
  if (!q) return flat;
  return flat.filter((e) => normalizeNavText(e.label).includes(q));
};



const renderNavigation = (editor: Editor, force = false) => {

  const panel = ensureNavPanel();

  if (!panel) return;

  if (!force && shouldDeferNavRender("renderNavigation")) {
    const now = performance.now();
    navLog("render:skip-pointer", {
      headings: navEntriesFlat.length,
      activeId: navActiveId,
      query: navSearchQuery,
      lockMs: Math.max(0, navRenderLockUntil - now)
    });
    return;
  }

  const body = navBody ?? panel.querySelector<HTMLElement>(".leditor-navigation-body");
  if (!body) return;

  const treeHost = navTreeHost ?? body.querySelector<HTMLElement>(".leditor-navigation-tree");
  if (!treeHost) return;
  treeHost.innerHTML = "";

  const flat = buildHeadingFlatList(editor);
  navEntriesFlat = flat;
  navActiveId = computeActiveHeadingId(flat, editor.state.selection.from);
  ensureAncestorsExpanded(flat, navActiveId);
  // After rendering, allow subsequent renders again.
  navRenderLockUntil = performance.now() + 10;
  navLog("render", {
    headings: flat.length,
    activeId: navActiveId,
    query: navSearchQuery
  });

  if (flat.length === 0) {
    const empty = document.createElement("div");
    empty.className = "leditor-navigation-empty";
    empty.textContent = "No headings defined.";
    treeHost.appendChild(empty);
    return;
  }

  const nodesById = new Map<string, NavNode>();
  const tree = buildHeadingTree(flat);
  const walk = (nodes: NavNode[]) => {
    nodes.forEach((n) => {
      nodesById.set(n.id, n);
      walk(n.children);
    });
  };
  walk(tree);

  const q = normalizeNavText(navSearchQuery);
  const matchesQuery = (node: NavNode): boolean => {
    if (!q) return true;
    return normalizeNavText(node.label).includes(q);
  };
  const filterTree = (nodes: NavNode[]): NavNode[] => {
    if (!q) return nodes;
    const out: NavNode[] = [];
    for (const n of nodes) {
      const kids = filterTree(n.children);
      if (matchesQuery(n) || kids.length) {
        out.push({ ...n, children: kids });
      }
    }
    return out;
  };
  const roots = filterTree(tree);

  if (!roots.length) {
    const empty = document.createElement("div");
    empty.className = "leditor-navigation-empty";
    empty.textContent = "No matches.";
    treeHost.appendChild(empty);
    return;
  }

  const renderNode = (node: NavNode, depth: number): HTMLElement => {
    const item = document.createElement("div");
    item.className = "leditor-navigation-item";
    item.dataset.id = node.id;

    const row = document.createElement("div");
    row.className = "leditor-navigation-row";
    row.style.setProperty("--nav-depth", String(depth));

    const hasChildren = node.children.length > 0;
    const collapsed = !!navCollapsed[node.id];
    const expanded = hasChildren ? !collapsed : false;

    const twisty = document.createElement("button");
    twisty.type = "button";
    twisty.className = "leditor-navigation-twisty";
    twisty.tabIndex = -1;
    twisty.disabled = !hasChildren;
    if (hasChildren) {
      twisty.setAttribute("aria-label", expanded ? "Collapse section" : "Expand section");
      try {
        const icon = createFluentSvgIcon(expanded ? "ChevronDown20Filled" : "ChevronRight20Filled");
        icon.classList.add("leditor-navigation-twisty-icon");
        twisty.appendChild(icon);
      } catch {
        twisty.textContent = expanded ? "▾" : "▸";
      }
    } else {
      twisty.setAttribute("aria-hidden", "true");
    }
    twisty.dataset.id = node.id;

    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "leditor-navigation-entry";
    entry.dataset.id = node.id;
    entry.dataset.parentId = node.parentId ?? "";
    entry.dataset.level = String(node.level);
    entry.dataset.hasChildren = hasChildren ? "1" : "0";
    entry.dataset.expanded = expanded ? "1" : "0";
    entry.setAttribute("role", "treeitem");
    entry.setAttribute("aria-level", String(depth + 1));
    if (hasChildren) entry.setAttribute("aria-expanded", String(Boolean(expanded)));
    if (navActiveId && node.id === navActiveId) {
      entry.classList.add("is-active");
      entry.setAttribute("aria-current", "true");
    }
    entry.textContent = node.label;

    row.append(twisty, entry);
    item.appendChild(row);

    if (hasChildren && expanded) {
      const group = document.createElement("div");
      group.className = "leditor-navigation-group";
      group.setAttribute("role", "group");
      node.children.forEach((child) => group.appendChild(renderNode(child, depth + 1)));
      item.appendChild(group);
    }

    return item;
  };

  roots.forEach((n) => treeHost.appendChild(renderNode(n, 0)));

  // Event delegation so clicks survive rerenders.
  treeHost.onclick = (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const twisty = target.closest(".leditor-navigation-twisty") as HTMLElement | null;
    const entry = target.closest(".leditor-navigation-entry") as HTMLButtonElement | null;
    if (twisty && twisty.dataset.id) {
      ev.preventDefault();
      ev.stopPropagation();
      const now = performance.now();
      navGestureUntil = Math.max(navGestureUntil, now + 120);
      navRenderLockUntil = Math.max(navRenderLockUntil, now + 80);
      const id = twisty.dataset.id;
      const collapsed = !!navCollapsed[id];
      navLog("toggle", { id, collapsed, nextCollapsed: !collapsed, via: "delegate", targetTag: target.tagName });
      navCollapsed[id] = !collapsed;
      saveNavState();
      renderNavigation(editor, true);
      return;
    }
    if (entry && entry.dataset.id) {
      ev.preventDefault();
      ev.stopPropagation();
      const now = performance.now();
      navGestureUntil = Math.max(navGestureUntil, now + 80);
      navRenderLockUntil = Math.max(navRenderLockUntil, now + 60);
      const id = entry.dataset.id;
      const node = nodesById.get(id);
      if (!node) return;
      navLog("click", {
        id: node.id,
        label: node.label,
        pos: node.pos,
        level: node.level,
        depth: Number(entry.dataset.level || 0),
        targetTag: target.tagName
      });
      scrollEditorToPos(editor, node.pos);
      flashHeading(editor, node.pos);
    }
  };

  // Keyboard navigation on the visible tree items.
  treeHost.onkeydown = (ev) => {
    const key = ev.key;
    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl || !treeHost.contains(activeEl)) return;
    if (!activeEl.classList.contains("leditor-navigation-entry")) return;

    const items = Array.from(treeHost.querySelectorAll<HTMLButtonElement>(".leditor-navigation-entry"));
    const idx = items.indexOf(activeEl as HTMLButtonElement);
    if (idx < 0) return;

    const currentId = (activeEl as HTMLButtonElement).dataset.id || "";
    const node = currentId ? nodesById.get(currentId) : null;
    const hasChildren = Boolean(node && node.children && node.children.length);
    const expanded = Boolean(node && !navCollapsed[node.id]);

    if (key === "ArrowDown") {
      ev.preventDefault();
      items[Math.min(items.length - 1, idx + 1)]?.focus();
    } else if (key === "ArrowUp") {
      ev.preventDefault();
      items[Math.max(0, idx - 1)]?.focus();
    } else if (key === "Enter") {
      ev.preventDefault();
      (activeEl as HTMLButtonElement).click();
    } else if (key === "ArrowLeft") {
      if (hasChildren && expanded) {
        ev.preventDefault();
        navCollapsed[node!.id] = true;
        saveNavState();
        renderNavigation(editor);
        treeHost.querySelector<HTMLButtonElement>(`.leditor-navigation-entry[data-id="${CSS.escape(node!.id)}"]`)?.focus();
        return;
      }
      const parentId = (activeEl as HTMLButtonElement).dataset.parentId || "";
      if (parentId) {
        ev.preventDefault();
        treeHost.querySelector<HTMLButtonElement>(`.leditor-navigation-entry[data-id="${CSS.escape(parentId)}"]`)?.focus();
      }
    } else if (key === "ArrowRight") {
      if (hasChildren && !expanded) {
        ev.preventDefault();
        navCollapsed[node!.id] = false;
        saveNavState();
        renderNavigation(editor);
        treeHost.querySelector<HTMLButtonElement>(`.leditor-navigation-entry[data-id="${CSS.escape(node!.id)}"]`)?.focus();
        return;
      }
      if (hasChildren && expanded) {
        ev.preventDefault();
        const firstChild = node!.children[0]?.id;
        if (firstChild) {
          treeHost.querySelector<HTMLButtonElement>(`.leditor-navigation-entry[data-id="${CSS.escape(firstChild)}"]`)?.focus();
        }
      }
    }
  };

};



export const initViewState = (root: HTMLElement) => {

  appRoot = root;
  appRoot.classList.toggle(APP_CLASS_PAGE_BOUNDARIES, pageBoundariesVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGE_BREAKS, pageBreakMarksVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGINATION_CONTINUOUS, paginationModeState === "continuous");

};



export const setReadMode = (value: boolean) => {

  if (!appRoot) return;
  readModeActive = value;

  appRoot.classList.toggle(APP_CLASS_READ, value);

};



export const setScrollDirection = (mode: "vertical" | "horizontal") => {

  if (!appRoot) return;
  scrollDirectionState = mode;

  appRoot.classList.toggle(APP_CLASS_HORIZONTAL, mode === "horizontal");

};



export const setRulerVisible = (value: boolean) => {

  if (!appRoot) return;
  rulerVisibleState = value;

  appRoot.classList.toggle(APP_CLASS_RULER, value);

};

export const setPageBoundariesVisible = (value: boolean) => {

  if (!appRoot) return;
  pageBoundariesVisibleState = value;

  appRoot.classList.toggle(APP_CLASS_PAGE_BOUNDARIES, value);

};

export const setPageBreakMarksVisible = (value: boolean) => {

  if (!appRoot) return;
  pageBreakMarksVisibleState = value;

  appRoot.classList.toggle(APP_CLASS_PAGE_BREAKS, value);

};

export const setPaginationMode = (mode: "paged" | "continuous") => {

  if (!appRoot) return;
  paginationModeState = mode;

  appRoot.classList.toggle(APP_CLASS_PAGINATION_CONTINUOUS, mode === "continuous");

};



export const setGridlinesVisible = (value: boolean) => {

  if (!appRoot) return;
  gridVisibleState = value;

  appRoot.classList.toggle(APP_CLASS_GRID, value);

};

export const syncViewToggles = () => {
  if (!appRoot) return;
  appRoot.classList.toggle(APP_CLASS_RULER, rulerVisibleState);
  appRoot.classList.toggle(APP_CLASS_GRID, gridVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGE_BOUNDARIES, pageBoundariesVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGE_BREAKS, pageBreakMarksVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGINATION_CONTINUOUS, paginationModeState === "continuous");
};



export const toggleNavigationPanel = (editorHandle: EditorHandle) => {

  if (!appRoot) return;

  const panel = ensureNavPanel();

  if (!panel) return;

  const tiptapEditor = editorHandle.getEditor();

  if (navVisible) {

    panel.classList.remove("is-open");

    navVisible = false;

    return;

  }

  renderNavigation(tiptapEditor);

  panel.classList.add("is-open");

  navVisible = true;

};

export const refreshNavigationPanel = (editor: Editor) => {
  if (!navVisible) return;
  if (shouldDeferNavRender("refresh")) {
    navLog("refresh:skip-pointer");
    return;
  }
  renderNavigation(editor);
};

export const updateNavigationActive = (editor: Editor) => {
  if (!navVisible || !navPanel) return;
  if (!navEntriesFlat.length) return;
  if (shouldDeferNavRender("updateActive")) {
    navLog("updateActive:skip-pointer");
    return;
  }
  const nextActive = computeActiveHeadingId(navEntriesFlat, editor.state.selection.from);
  if (nextActive === navActiveId) return;
  navActiveId = nextActive;
  const expandedChanged = ensureAncestorsExpanded(navEntriesFlat, navActiveId);
  if (expandedChanged) {
    renderNavigation(editor);
    return;
  }
  const treeHost = navTreeHost ?? navPanel.querySelector<HTMLElement>(".leditor-navigation-tree");
  if (!treeHost) return;
  const buttons = treeHost.querySelectorAll<HTMLButtonElement>(".leditor-navigation-entry");
  buttons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.id === navActiveId));
};

export const isReadMode = () => readModeActive;
export const getScrollDirection = () => scrollDirectionState;
export const isRulerVisible = () => rulerVisibleState;
export const isGridlinesVisible = () => gridVisibleState;
export const isNavigationVisible = () => navVisible;
export const isNavigationDocked = () => navDocked;
export const isPageBoundariesVisible = () => pageBoundariesVisibleState;
export const isPageBreakMarksVisible = () => pageBreakMarksVisibleState;
export const getPaginationMode = () => paginationModeState;



const shouldDeferNavRender = (_reason: string): boolean => {
  const now = performance.now();
  return now < navRenderLockUntil || now < navGestureUntil;
};
