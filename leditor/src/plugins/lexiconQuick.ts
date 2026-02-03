import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import { getAiSettings } from "../ui/ai_settings.ts";

type LexiconMode = "synonyms" | "antonyms" | "definition" | "explain";

let popupEl: HTMLElement | null = null;
let cleanupFns: Array<() => void> = [];

const closePopup = (editorHandle?: EditorHandle) => {
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
  try {
    editorHandle?.getEditor()?.commands?.clearLexiconHighlight?.();
  } catch {
    // ignore
  }
};

const selectionHasAnchors = (editorHandle: EditorHandle, from: number, to: number): boolean => {
  const editor = editorHandle.getEditor();
  const doc = editor.state.doc;
  const anchorMark = editor.schema.marks.anchor ?? null;
  const linkMark = editor.schema.marks.link ?? null;
  let found = false;
  doc.nodesBetween(from, to, (node: any) => {
    if (!node) return true;
    if (String(node.type?.name ?? "") === "citation") {
      found = true;
      return false;
    }
    if (!node.isText) return true;
    const marks = Array.isArray(node.marks) ? node.marks : [];
    for (const m of marks) {
      if (anchorMark && m.type === anchorMark) {
        found = true;
        return false;
      }
      if (linkMark && m.type === linkMark) {
        const attrs = m.attrs ?? {};
        const href = typeof attrs?.href === "string" ? attrs.href : "";
        const looksLikeCitation = Boolean(
          attrs?.dataKey ||
            attrs?.itemKey ||
            attrs?.dataItemKey ||
            attrs?.dataDqid ||
            attrs?.dataQuoteId ||
            attrs?.dataQuoteText
        );
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

const getSentenceForSelection = (editorHandle: EditorHandle, from: number): { sentence: string; blockText: string } => {
  const editor = editorHandle.getEditor();
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

const openDropdown = (args: {
  title: string;
  from: number;
  to: number;
  options: string[];
  onPick: (value: string) => void;
  editorHandle: EditorHandle;
}) => {
  closePopup(args.editorHandle);
  const editor = args.editorHandle.getEditor();
  const view: any = (editor as any)?.view;
  if (!view?.coordsAtPos) return;

  // Apply green highlight to the selection while the menu is open.
  try {
    editor.commands.setLexiconHighlight?.({ from: args.from, to: args.to });
  } catch {
    // ignore
  }

  const a = view.coordsAtPos(args.from);
  const b = view.coordsAtPos(args.to);
  const left = Math.min(a.left, b.left);
  const top = Math.max(a.bottom, b.bottom) + 6;

  const popup = document.createElement("div");
  popup.className = "leditor-lexicon-popup";
  popup.setAttribute("role", "menu");
  popup.setAttribute("aria-label", args.title);
  popup.style.left = "0px";
  popup.style.top = "0px";

  const header = document.createElement("div");
  header.className = "leditor-lexicon-popup__header";
  header.textContent = args.title;

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
        closePopup(args.editorHandle);
        return;
      }
      args.onPick(value);
      closePopup(args.editorHandle);
    });
    list.appendChild(btn);
  };

  for (const opt of args.options.slice(0, 5)) {
    if (!opt) continue;
    addItem(opt, opt);
  }
  addItem("None", null);

  popup.append(header, list);
  document.body.appendChild(popup);
  popupEl = popup;

  const rect = popup.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  popup.style.left = `${Math.round(Math.max(8, Math.min(maxLeft, left)))}px`;
  popup.style.top = `${Math.round(Math.max(8, Math.min(maxTop, top)))}px`;

  const onDocPointerDown = (e: Event) => {
    const t = e.target as Node | null;
    if (!t) return;
    if (popup.contains(t)) return;
    closePopup(args.editorHandle);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopup(args.editorHandle);
    }
  };
  const docShell = document.querySelector(".leditor-doc-shell") as HTMLElement | null;
  const onScroll = () => closePopup(args.editorHandle);

  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  docShell?.addEventListener("scroll", onScroll, { passive: true });
  args.editorHandle.on("selectionChange", onScroll);

  cleanupFns.push(() => document.removeEventListener("pointerdown", onDocPointerDown, true));
  cleanupFns.push(() => document.removeEventListener("keydown", onKeyDown, true));
  cleanupFns.push(() => docShell?.removeEventListener("scroll", onScroll));
  cleanupFns.push(() => args.editorHandle.off("selectionChange", onScroll));
};

const openDefinition = (args: {
  title: string;
  from: number;
  to: number;
  text: string;
  editorHandle: EditorHandle;
}) => {
  closePopup(args.editorHandle);
  const editor = args.editorHandle.getEditor();
  const view: any = (editor as any)?.view;
  if (!view?.coordsAtPos) return;

  try {
    editor.commands.setLexiconHighlight?.({ from: args.from, to: args.to });
  } catch {
    // ignore
  }

  const a = view.coordsAtPos(args.from);
  const b = view.coordsAtPos(args.to);
  const left = Math.min(a.left, b.left);
  const top = Math.max(a.bottom, b.bottom) + 6;

  const popup = document.createElement("div");
  popup.className = "leditor-lexicon-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", args.title);
  popup.style.left = "0px";
  popup.style.top = "0px";

  const header = document.createElement("div");
  header.className = "leditor-lexicon-popup__header";
  header.textContent = args.title;

  const body = document.createElement("div");
  body.className = "leditor-lexicon-popup__list";
  body.style.padding = "8px 10px";
  body.style.whiteSpace = "pre-wrap";
  body.textContent = args.text;

  popup.append(header, body);
  document.body.appendChild(popup);
  popupEl = popup;

  const rect = popup.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  popup.style.left = `${Math.round(Math.max(8, Math.min(maxLeft, left)))}px`;
  popup.style.top = `${Math.round(Math.max(8, Math.min(maxTop, top)))}px`;

  const onDocPointerDown = (e: Event) => {
    const t = e.target as Node | null;
    if (!t) return;
    if (popup.contains(t)) return;
    closePopup(args.editorHandle);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopup(args.editorHandle);
    }
  };
  const docShell = document.querySelector(".leditor-doc-shell") as HTMLElement | null;
  const onScroll = () => closePopup(args.editorHandle);

  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  docShell?.addEventListener("scroll", onScroll, { passive: true });
  args.editorHandle.on("selectionChange", onScroll);

  cleanupFns.push(() => document.removeEventListener("pointerdown", onDocPointerDown, true));
  cleanupFns.push(() => document.removeEventListener("keydown", onKeyDown, true));
  cleanupFns.push(() => docShell?.removeEventListener("scroll", onScroll));
  cleanupFns.push(() => args.editorHandle.off("selectionChange", onScroll));
};

const runLexicon = async (editorHandle: EditorHandle, mode: LexiconMode, title: string) => {
  const editor = editorHandle.getEditor();
  const sel = editor.state.selection;
  const from = Math.min(sel.from, sel.to);
  const to = Math.max(sel.from, sel.to);
  if (from === to) {
    return;
  }
  if (selectionHasAnchors(editorHandle, from, to)) {
    return;
  }
  const selectedText = editor.state.doc.textBetween(from, to, "\n").trim();
  if (!selectedText) {
    return;
  }

  const { sentence, blockText } = getSentenceForSelection(editorHandle, from);
  const context = mode === "explain" ? (blockText || sentence) : sentence;
  const host: any = (window as any).leditorHost;
  if (!host || typeof host.lexicon !== "function") {
    return;
  }

  const requestId = `lexq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await host.lexicon({
    requestId,
    payload: {
      provider: getAiSettings().provider,
      model: getAiSettings().model,
      mode,
      text: selectedText,
      sentence: context
    }
  });

  if (!result?.success) {
    closePopup(editorHandle);
    return;
  }

  if (mode === "definition" || mode === "explain") {
    const key = mode === "definition" ? "definition" : "explanation";
    const text = typeof result?.[key] === "string" ? String(result[key]).trim() : "";
    if (!text) {
      closePopup(editorHandle);
      return;
    }
    openDefinition({ title, from, to, text, editorHandle });
    return;
  }

  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
  const opts = suggestions
    .map((s: any) => (typeof s === "string" ? s : typeof s?.text === "string" ? s.text : ""))
    .map((s: string) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!opts.length) {
    closePopup(editorHandle);
    return;
  }

  openDropdown({
    title,
    from,
    to,
    options: opts,
    editorHandle,
    onPick: (replacement) => {
      const tr = editor.state.tr.insertText(replacement, from, to);
      editor.view.dispatch(tr);
    }
  });
};

registerPlugin({
  id: "lexicon_quick",
  commands: {
    "lexicon.define"(editorHandle: EditorHandle) {
      void runLexicon(editorHandle, "definition", "Define");
    },
    "lexicon.explain"(editorHandle: EditorHandle) {
      void runLexicon(editorHandle, "explain", "Explain");
    },
    "lexicon.synonyms"(editorHandle: EditorHandle) {
      void runLexicon(editorHandle, "synonyms", "Synonyms");
    },
    "lexicon.antonyms"(editorHandle: EditorHandle) {
      void runLexicon(editorHandle, "antonyms", "Antonyms");
    },
    "lexicon.close"(editorHandle: EditorHandle) {
      closePopup(editorHandle);
    }
  }
});
