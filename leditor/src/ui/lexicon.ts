import type { Editor } from "@tiptap/core";
import { buildLlmCacheKey, getLlmCacheEntry, setLlmCacheEntry } from "./llm_cache.ts";
import { stableStringify } from "../shared/persona.ts";
import { getAiSettings } from "./ai_settings.ts";

type LexiconMode = "synonyms" | "antonyms" | "definition" | "explain";

let popupEl: HTMLElement | null = null;
let cleanupFns: Array<() => void> = [];
const LEXICON_CACHE_TTL_MS = 2 * 60 * 1000;
const LEXICON_CACHE_MAX = 40;
const LEXICON_CONTEXT_LIMIT = 800;
const lexiconCache = new Map<string, { at: number; value: any }>();
const lexiconInflight = new Map<string, Promise<any>>();

const getCacheKey = (args: {
  mode: string;
  text: string;
  sentence: string;
  provider: string;
  model: string;
  personaKey: string;
}) => JSON.stringify(args);

const getCached = (key: string): any | null => {
  const entry = lexiconCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > LEXICON_CACHE_TTL_MS) {
    lexiconCache.delete(key);
    return null;
  }
  return entry.value;
};

const setCached = (key: string, value: any) => {
  if (lexiconCache.size >= LEXICON_CACHE_MAX) {
    const oldest = lexiconCache.keys().next().value as string | undefined;
    if (oldest) lexiconCache.delete(oldest);
  }
  lexiconCache.set(key, { at: Date.now(), value });
};

const clampContext = (text: string) => {
  if (!text) return text;
  if (text.length <= LEXICON_CONTEXT_LIMIT) return text;
  return text.slice(0, LEXICON_CONTEXT_LIMIT).trim();
};

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}...` : value);

const buildContextDetails = (contextRaw: string): HTMLElement | null => {
  const context = String(contextRaw || "").replace(/\s+/g, " ").trim();
  if (!context) return null;
  const details = document.createElement("details");
  details.className = "leditor-lexicon-popup__context";
  const summary = document.createElement("summary");
  summary.className = "leditor-lexicon-popup__contextSummary";
  summary.textContent = "Context …more";
  const body = document.createElement("div");
  body.className = "leditor-lexicon-popup__contextBody";
  body.textContent = context;
  details.append(summary, body);
  return details;
};

const logLexicon = (phase: "request" | "result" | "error", detail: Record<string, unknown>) => {
  try {
    window.codexLog?.write(`[lexicon:${phase}] ${JSON.stringify(detail)}`);
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line no-console
    console.info("[lexicon]", phase, detail);
  } catch {
    // ignore
  }
};

const extractSuggestionsFromStream = (buffer: string): string[] => {
  const keyMatch = buffer.match(/\"suggestions\"\s*:/);
  if (!keyMatch || keyMatch.index == null) return [];
  const arrayStart = buffer.indexOf("[", keyMatch.index);
  if (arrayStart === -1) return [];
  const slice = buffer.slice(arrayStart + 1);
  const results: string[] = [];
  let inString = false;
  let escape = false;
  let current = "";
  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i];
    if (!inString) {
      if (ch === "]") break;
      if (ch === "\"") {
        inString = true;
        current = "";
      }
      continue;
    }
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escape = true;
      continue;
    }
    if (ch === "\"") {
      try {
        results.push(JSON.parse(`\"${current}\"`));
      } catch {
        results.push(current);
      }
      inString = false;
      current = "";
      continue;
    }
    current += ch;
  }
  return results;
};

const normalizeSuggestions = (suggestions: string[], selectedText: string) => {
  const seen = new Set<string>();
  const output: string[] = [];
  const target = selectedText.trim().toLowerCase();
  for (const raw of suggestions) {
    const next = String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ");
    if (!next) continue;
    if (next.toLowerCase() === target) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(next);
    if (output.length >= 5) break;
  }
  return output;
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

const renderDefinitionPopup = (
  editor: Editor,
  title: string,
  headword: string,
  from: number,
  to: number,
  text: string,
  mode: LexiconMode,
  context?: string
) => {
  const popup = document.createElement("div");
  popup.className = "leditor-lexicon-popup";
  if (mode === "definition") popup.classList.add("is-definition");
  if (mode === "explain") popup.classList.add("is-explain");
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", title);

  const header = document.createElement("div");
  header.className = "leditor-lexicon-popup__header";
  const headwordEl = document.createElement("div");
  headwordEl.className = "leditor-lexicon-popup__headword";
  headwordEl.textContent = headword;
  const meta = document.createElement("div");
  meta.className = "leditor-lexicon-popup__meta";
  meta.textContent = title;
  header.append(headwordEl, meta);

  const contextDetails = context ? buildContextDetails(context) : null;

  const body = document.createElement("div");
  body.className = "leditor-lexicon-popup__body";
  body.style.whiteSpace = "pre-wrap";
  body.textContent = text;

  const footer = document.createElement("div");
  footer.className = "leditor-lexicon-popup__footer";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "leditor-lexicon-popup__action";
  close.textContent = "Close";
  close.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeLexiconPopup(editor);
  });
  footer.appendChild(close);

  if (contextDetails) {
    popup.append(header, contextDetails, body, footer);
  } else {
    popup.append(header, body, footer);
  }
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

const renderLoadingPopup = (
  editor: Editor,
  title: string,
  headword: string,
  from: number,
  to: number,
  helperText?: string,
  onPick?: (value: string) => void,
  context?: string,
  mode?: LexiconMode
) => {
  const popup = document.createElement("div");
  popup.className = "leditor-lexicon-popup";
  if (mode === "definition") popup.classList.add("is-definition");
  if (mode === "explain") popup.classList.add("is-explain");
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", title);

  const header = document.createElement("div");
  header.className = "leditor-lexicon-popup__header";
  const headwordEl = document.createElement("div");
  headwordEl.className = "leditor-lexicon-popup__headword";
  headwordEl.textContent = headword;
  const meta = document.createElement("div");
  meta.className = "leditor-lexicon-popup__meta";
  meta.textContent = title;
  header.append(headwordEl, meta);

  const helper = document.createElement("div");
  helper.className = "leditor-lexicon-popup__helper";
  helper.textContent = helperText || "";
  if (!helperText) helper.style.display = "none";

  const contextDetails = context ? buildContextDetails(context) : null;

  const body = document.createElement("div");
  body.className = "leditor-lexicon-popup__body";
  body.textContent = "Loading...";

  const footer = document.createElement("div");
  footer.className = "leditor-lexicon-popup__footer";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "leditor-lexicon-popup__action";
  close.textContent = "Close";
  close.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeLexiconPopup(editor);
  });
  footer.appendChild(close);

  if (contextDetails) {
    popup.append(header, contextDetails, helper, body, footer);
  } else {
    popup.append(header, helper, body, footer);
  }
  if (!attachPopup(popup, editor, from, to)) {
    popup.remove();
    return null;
  }
  try {
    (editor.commands as any).setLexiconHighlight?.({ from, to });
  } catch {
    // ignore
  }
  const updateSuggestions = (suggestions: string[]) => {
    body.replaceChildren();
    if (!suggestions.length) {
      body.textContent = "Loading...";
      return;
    }
    const list = document.createElement("div");
    list.className = "leditor-lexicon-popup__list is-chips";
    for (const opt of suggestions.slice(0, 5)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "leditor-lexicon-popup__chip";
      btn.textContent = opt;
      btn.tabIndex = -1;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onPick === "function") onPick(opt);
        closeLexiconPopup(editor);
      });
      list.appendChild(btn);
    }
    body.appendChild(list);
  };
  return {
    updateText: (text: string) => {
      body.textContent = text;
    },
    updateHelper: (text: string) => {
      helper.textContent = text;
      helper.style.display = text ? "block" : "none";
    },
    updateSuggestions
  };
};

const renderSuggestionsPopup = (
  editor: Editor,
  title: string,
  headword: string,
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
  const headwordEl = document.createElement("div");
  headwordEl.className = "leditor-lexicon-popup__headword";
  headwordEl.textContent = headword;
  const meta = document.createElement("div");
  meta.className = "leditor-lexicon-popup__meta";
  meta.textContent = title;
  header.append(headwordEl, meta);

  const helper = document.createElement("div");
  helper.className = "leditor-lexicon-popup__helper";
  helper.textContent = "Click a word to replace the selection.";

  const list = document.createElement("div");
  list.className = "leditor-lexicon-popup__list is-chips";

  const addItem = (label: string, value: string | null) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "leditor-lexicon-popup__chip";
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
  const footer = document.createElement("div");
  footer.className = "leditor-lexicon-popup__footer";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "leditor-lexicon-popup__action";
  close.textContent = "Close";
  close.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeLexiconPopup(editor);
  });
  footer.appendChild(close);

  popup.append(header, helper, list, footer);
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
  try {
    const handle = (window as any).leditor as { execCommand?: (name: string, args?: any) => void } | undefined;
    if (handle?.execCommand) {
      handle.execCommand("agent.dictionary.open", { mode });
      return;
    }
  } catch {
    // fallback to popup flow
  }
  const sel = editor.state.selection;
  const from = Math.min(sel.from, sel.to);
  const to = Math.max(sel.from, sel.to);
  if (from === to) return;
  if (selectionHasAnchors(editor, from, to)) return;
  const selectedText = editor.state.doc.textBetween(from, to, "\n").trim();
  if (!selectedText) return;

  const { sentence, blockText } = getSentenceForSelection(editor, from);
  const context = mode === "explain" ? clampContext(blockText || sentence) : sentence;
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

  const loading = renderLoadingPopup(
    editor,
    title,
    selectedText,
    from,
    to,
    mode === "synonyms" || mode === "antonyms" ? "Fetching suggestions..." : "",
    mode === "synonyms" || mode === "antonyms"
      ? (replacement) => {
          try {
            editor.view.dispatch(editor.state.tr.insertText(replacement, from, to));
          } catch {
            // ignore
          }
        }
      : undefined,
    mode === "definition" || mode === "explain" ? context : "",
    mode
  );

  const settings = getAiSettings();
  const personaKey = stableStringify(settings.personaConfig ?? {});
  const model = settings.modelByProvider?.[settings.provider];
  const payload = {
    provider: settings.provider,
    ...(typeof model === "string" && model ? { model } : {}),
    mode,
    text: selectedText,
    sentence: context,
    personaConfig: settings.personaConfig
  };
  logLexicon("request", {
    mode,
    provider: settings.provider,
    text: clip(selectedText, 160),
    sentence: clip(context, 200)
  });
  const cacheKey = getCacheKey({
    mode,
    text: selectedText,
    sentence: context,
    provider: settings.provider,
    model: model || "",
    personaKey
  });
  const llmCacheKey = buildLlmCacheKey({
    fn: "lexicon",
    provider: settings.provider,
    payload
  });
  const cached = getLlmCacheEntry(llmCacheKey)?.value ?? getCached(cacheKey);
  const requestId = `lex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let result: any = null;
  let streamUnsub: (() => void) | null = null;
  let hasStreamedSuggestions = false;
  if (typeof host.onLexiconStreamUpdate === "function") {
    let streamed = "";
    let lastKey = "";
    streamUnsub = host.onLexiconStreamUpdate((payload: any) => {
      if (!payload || payload.requestId !== requestId) return;
      if (payload.kind === "delta" && typeof payload.delta === "string") {
        streamed += payload.delta;
        if (mode === "synonyms" || mode === "antonyms") {
          const next = normalizeSuggestions(extractSuggestionsFromStream(streamed), selectedText);
          const key = next.join("|");
          if (key && key !== lastKey) {
            lastKey = key;
            hasStreamedSuggestions = true;
            loading?.updateSuggestions(next);
          }
        } else {
          loading?.updateText(streamed.trimStart());
        }
      }
    });
    cleanupFns.push(() => {
      try {
        streamUnsub?.();
      } catch {
        // ignore
      }
    });
  }
  try {
    if (cached) {
      result = cached;
    } else {
      let inflight = lexiconInflight.get(cacheKey);
      if (!inflight) {
        const request = host.lexicon?.({
          requestId,
          stream: true,
          payload
        });
        if (!request) {
          closeLexiconPopup(editor);
          return;
        }
        const nextInflight = request.finally(() => {
          lexiconInflight.delete(cacheKey);
        });
        lexiconInflight.set(cacheKey, nextInflight);
        inflight = nextInflight;
      }
      result = await inflight;
      if (result?.success) {
        setCached(cacheKey, result);
        setLlmCacheEntry({
          key: llmCacheKey,
          fn: "lexicon",
          value: result,
          meta: { provider: settings.provider }
        });
      }
    }
  } catch {
    closeLexiconPopup(editor);
    return;
  }
  if (!result?.success) {
    logLexicon("error", { mode, error: String(result?.error || "lexicon failed") });
    closeLexiconPopup(editor);
    return;
  }

  if (mode === "definition" || mode === "explain") {
    const key = mode === "definition" ? "definition" : "explanation";
    const text = typeof result?.[key] === "string" ? String(result[key]).trim() : "";
    if (!text) {
      logLexicon("error", { mode, error: "empty response" });
      closeLexiconPopup(editor);
      return;
    }
    logLexicon("result", { mode, text: clip(text, 200) });
    loading?.updateText(text);
    if (!loading) {
      renderDefinitionPopup(editor, title, selectedText, from, to, text, mode, context);
    }
    return;
  }

  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
  const rawOpts = suggestions
    .map((s: any) => (typeof s === "string" ? s : typeof s?.text === "string" ? s.text : ""))
    .map((s: string) => s.trim())
    .filter(Boolean);
  const opts = normalizeSuggestions(rawOpts, selectedText);
  if (!opts.length) {
    logLexicon("error", { mode, error: "empty suggestions" });
    if (hasStreamedSuggestions) return;
    closeLexiconPopup(editor);
    return;
  }
  logLexicon("result", { mode, suggestions: opts });
  if (loading) {
    loading.updateSuggestions(opts);
    return;
  }
  renderSuggestionsPopup(editor, title, selectedText, from, to, opts);
};
