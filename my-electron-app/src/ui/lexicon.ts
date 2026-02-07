import type { Editor } from "@tiptap/core";

type LexiconMode = "synonyms" | "antonyms" | "definition" | "explain";

let popupEl: HTMLElement | null = null;
let cleanupFns: Array<() => void> = [];

const getAiSettings = (): { provider: string; model: string } => {
  const fallback = { provider: "openai", model: "gpt-4o-mini" };
  try {
    const host: any = (window as any).leditorHost;
    if (host?.getAiSettings) {
      const cfg = host.getAiSettings();
      if (cfg?.provider && cfg?.model) return { provider: cfg.provider, model: cfg.model };
    }
  } catch {
    /* ignore */
  }
  return fallback;
};

const clearHighlight = (editor?: Editor) => {
  try {
    (editor?.commands as any)?.clearLexiconHighlight?.();
  } catch {
    // ignore
  }
};

export const closeLexiconPopup = (editor?: Editor) => {
  for (const fn of cleanupFns) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
  cleanupFns = [];
  try {
    popupEl?.remove();
  } catch {
    // ignore
  }
  popupEl = null;
  clearHighlight(editor);
};

const selectionHasAnchors = (editor: Editor, from: number, to: number): boolean => {
  const anchorMark = editor.schema.marks.anchor ?? null;
  const linkMark = editor.schema.marks.link ?? null;
  let found = false;
  editor.state.doc.nodesBetween(from, to, (node: any) => {
    if (!node?.isText) return true;
    const marks = Array.isArray(node.marks) ? node.marks : [];
    for (const m of marks) {
      if (anchorMark && m.type === anchorMark) {
        found = true;
        return false;
      }
      if (linkMark && m.type === linkMark) {
        const attrs = m.attrs ?? {};
        const href = typeof attrs.href === "string" ? attrs.href : "";
        const looksLikeCitation =
          attrs?.dataKey ||
          attrs?.itemKey ||
          attrs?.dataItemKey ||
          attrs?.dataDqid ||
          attrs?.dataQuoteId ||
          attrs?.dataQuoteText;
        if (looksLikeCitation) {
          found = true;
          return false;
        }
        if (href && /^(dq|cite|citegrp):\/\//i.test(href)) {
          found = true;
          return false;
        }
      }
    }
    return true;
  });
  return found;
};

const getSentenceForSelection = (editor: Editor, from: number): { sentence: string; blockText: string } => {
  const doc = editor.state.doc;
  const pos = doc.resolve(from);
  let depth = pos.depth;
  while (depth > 0 && !pos.node(depth).isTextblock) depth -= 1;
  const blockNode = pos.node(depth);
  const blockPos = pos.before(depth);
  const blockFrom = blockPos + 1;
  const blockTo = blockFrom + blockNode.content.size;
  const blockText = doc.textBetween(blockFrom, blockTo, "\n").replace(/\s+/g, " ").trim();
  if (!blockText) return { sentence: "", blockText: "" };

  const leftText = doc.textBetween(blockFrom, from, "\n").replace(/\s+/g, " ");
  const offset = Math.max(0, Math.min(blockText.length, leftText.length));
  const clamp = (v: number) => Math.max(0, Math.min(blockText.length, v));

  const left = blockText.slice(0, offset);
  const right = blockText.slice(offset);
  const boundaryRe = /[.!?;]\s+(?=[“"'\(\[]?[A-Z0-9])/g;
  let start = 0;
  for (const m of left.matchAll(boundaryRe)) {
    const idx = typeof m.index === "number" ? m.index : -1;
    if (idx < 0) continue;
    const prev = left.slice(Math.max(0, idx - 3), idx + 1).toLowerCase();
    const next = left.slice(idx + 1).trimStart();
    if ((prev.endsWith("p.") || prev.endsWith("pp.")) && /^\d/.test(next)) continue;
    start = idx + m[0].length;
  }
  start = clamp(start);

  const nextCandidates = Array.from(right.matchAll(/[.!?;]/g))
    .map((m) => (typeof m.index === "number" ? m.index : -1))
    .filter((n) => n >= 0)
    .map((n) => offset + n + 1);
  const end = clamp(nextCandidates.length ? Math.min(...nextCandidates) : blockText.length);

  return { sentence: blockText.slice(start, end).replace(/\s+/g, " ").trim(), blockText };
};

const attachPopup = (popup: HTMLElement, editor: Editor, from: number, to: number) => {
  const view: any = (editor as any)?.view;
  if (!view?.coordsAtPos) return false;
  const a = view.coordsAtPos(from);
  const b = view.coordsAtPos(to);
  const left = Math.min(a.left, b.left);
  const top = Math.max(a.bottom, b.bottom) + 6;
  document.body.appendChild(popup);
  popupEl = popup;
  const rect = popup.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  popup.style.left = `${Math.round(Math.max(8, Math.min(maxLeft, left)))}px`;
  popup.style.top = `${Math.round(Math.max(8, Math.min(maxTop, top)))}px`;

  const onDocPointerDown = (e: Event) => {
    const t = e.target as Node | null;
    if (t && popup.contains(t)) return;
    closeLexiconPopup(editor);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeLexiconPopup(editor);
    }
  };
  const docShell = document.querySelector(".leditor-doc-shell") as HTMLElement | null;
  const onScroll = () => closeLexiconPopup(editor);

  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  docShell?.addEventListener("scroll", onScroll, { passive: true });
  try {
    (editor as any)?.on?.("selectionUpdate", onScroll);
  } catch {
    // ignore
  }

  cleanupFns.push(() => document.removeEventListener("pointerdown", onDocPointerDown, true));
  cleanupFns.push(() => document.removeEventListener("keydown", onKeyDown, true));
  cleanupFns.push(() => docShell?.removeEventListener("scroll", onScroll));
  cleanupFns.push(() => {
    try {
      (editor as any)?.off?.("selectionUpdate", onScroll);
    } catch {
      // ignore
    }
  });
  return true;
};

const renderDefinitionPopup = (editor: Editor, title: string, from: number, to: number, text: string) => {
  const popup = document.createElement("div");
  popup.className = "leditor-lexicon-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", title);

  const header = document.createElement("div");
  header.className = "leditor-lexicon-popup__header";
  header.textContent = title;

  const body = document.createElement("div");
  body.className = "leditor-lexicon-popup__list";
  body.style.padding = "8px 10px";
  body.style.whiteSpace = "pre-wrap";
  body.textContent = text;

  const footer = document.createElement("div");
  footer.className = "leditor-lexicon-popup__list";
  footer.style.padding = "8px 10px";
  footer.style.display = "flex";
  footer.style.justifyContent = "flex-end";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "leditor-lexicon-popup__item";
  close.textContent = "Close";
  close.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeLexiconPopup(editor);
  });
  footer.appendChild(close);

  popup.append(header, body, footer);
  if (!attachPopup(popup, editor, from, to)) {
    popup.remove();
    return;
  }
  try {
    (editor.commands as any).setLexiconHighlight?.({ from, to });
  } catch {
    // ignore
  }
};

const renderSuggestionsPopup = (
  editor: Editor,
  title: string,
  from: number,
  to: number,
  suggestions: string[]
) => {
  const popup = document.createElement("div");
  popup.className = "leditor-lexicon-popup";
  popup.setAttribute("role", "menu");
  popup.setAttribute("aria-label", title);

  const header = document.createElement("div");
  header.className = "leditor-lexicon-popup__header";
  header.textContent = title;

  const list = document.createElement("div");
  list.className = "leditor-lexicon-popup__list";

  const addItem = (label: string, value: string | null) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "leditor-lexicon-popup__item";
    btn.textContent = label;
    btn.tabIndex = -1;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (value === null) {
        closeLexiconPopup(editor);
        return;
      }
      try {
        editor.view.dispatch(editor.state.tr.insertText(value, from, to));
      } catch {
        // ignore
      }
      closeLexiconPopup(editor);
    });
    list.appendChild(btn);
  };

  for (const opt of suggestions) addItem(opt, opt);
  addItem("None", null);

  popup.append(header, list);
  if (!attachPopup(popup, editor, from, to)) {
    popup.remove();
    return;
  }
  try {
    (editor.commands as any).setLexiconHighlight?.({ from, to });
  } catch {
    // ignore
  }
};

export const runLexiconCommand = async (editor: Editor, mode: LexiconMode): Promise<void> => {
  const sel = editor.state.selection;
  const from = Math.min(sel.from, sel.to);
  const to = Math.max(sel.from, sel.to);
  if (from === to) return;
  if (selectionHasAnchors(editor, from, to)) return;
  const selectedText = editor.state.doc.textBetween(from, to, "\n").trim();
  if (!selectedText) return;

  const { sentence, blockText } = getSentenceForSelection(editor, from);
  const context = mode === "explain" ? blockText || sentence : sentence;
  const host: any = (window as any).leditorHost;
  if (!host || typeof host.lexicon !== "function") return;

  const title =
    mode === "synonyms"
      ? "Synonyms"
      : mode === "antonyms"
        ? "Antonyms"
        : mode === "definition"
          ? "Definition"
          : "Explain";

  const requestId = `lex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let result: any = null;
  try {
    result = await host.lexicon({
      requestId,
      payload: {
        provider: getAiSettings().provider,
        model: getAiSettings().model,
        mode,
        text: selectedText,
        sentence: context
      }
    });
  } catch {
    closeLexiconPopup(editor);
    return;
  }
  if (!result?.success) {
    closeLexiconPopup(editor);
    return;
  }

  if (mode === "definition" || mode === "explain") {
    const key = mode === "definition" ? "definition" : "explanation";
    const text = typeof result?.[key] === "string" ? String(result[key]).trim() : "";
    if (!text) {
      closeLexiconPopup(editor);
      return;
    }
    renderDefinitionPopup(editor, title, from, to, text);
    return;
  }

  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
  const opts = suggestions
    .map((s: any) => (typeof s === "string" ? s : typeof s?.text === "string" ? s.text : ""))
    .map((s: string) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!opts.length) {
    closeLexiconPopup(editor);
    return;
  }
  renderSuggestionsPopup(editor, title, from, to, opts);
};
