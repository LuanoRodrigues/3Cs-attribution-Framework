import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export type AiDraftPreviewItem = {
  n?: number;
  from: number;
  to: number;
  originalText?: string;
  proposedText: string;
};

type DraftActionEvent = {
  action: "accept" | "reject";
  n?: number;
  from: number;
  to: number;
};

type DraftState = {
  enabled: boolean;
  items: AiDraftPreviewItem[];
};

const draftKey = new PluginKey<DraftState>("leditor-ai-draft-preview");

let editorRef: Editor | null = null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const sanitizeSnippet = (value: string, maxLen: number) => {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
};

const isCitationLikeMark = (mark: any): boolean => {
  const name = String(mark?.type?.name ?? "");
  if (name === "anchor") return true;
  if (name !== "link") return false;
  const attrs = mark?.attrs ?? {};
  const href = typeof attrs?.href === "string" ? attrs.href : "";
  const looksLikeCitation = Boolean(
    attrs?.dataKey ||
      attrs?.itemKey ||
      attrs?.dataItemKey ||
      attrs?.dataDqid ||
      attrs?.dataQuoteId ||
      attrs?.dataQuoteText ||
      attrs?.dataCitationAnchor
  );
  if (looksLikeCitation) return true;
  if (href && /^(dq|cite|citegrp):\/\//i.test(href)) return true;
  return false;
};

type ActivePopover = {
  key: string;
  popover: HTMLElement;
  cleanup: Array<() => void>;
};

let activePopover: ActivePopover | null = null;

const closePopover = () => {
  if (!activePopover) return;
  for (const fn of activePopover.cleanup) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
  try {
    activePopover.popover.remove();
  } catch {
    // ignore
  }
  activePopover = null;
};

const openPopover = (args: {
  key: string;
  anchorEl: HTMLElement;
  original: string;
  proposed: string;
  eventDetail: DraftActionEvent;
}) => {
  if (activePopover?.key === args.key) {
    closePopover();
    return;
  }
  closePopover();

  const pop = document.createElement("div");
  pop.className = "leditor-ai-draft-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "AI edit review");

  const title = document.createElement("div");
  title.className = "leditor-ai-draft-popover__title";
  title.textContent = "AI edit";

  const body = document.createElement("div");
  body.className = "leditor-ai-draft-popover__body";

  const oldBlock = document.createElement("div");
  oldBlock.className = "leditor-ai-draft-popover__block";
  const oldLabel = document.createElement("div");
  oldLabel.className = "leditor-ai-draft-popover__label";
  oldLabel.textContent = "Original";
  const oldTxt = document.createElement("div");
  oldTxt.className = "leditor-ai-draft-popover__text";
  oldTxt.textContent = sanitizeSnippet(args.original, 420);

  const newBlock = document.createElement("div");
  newBlock.className = "leditor-ai-draft-popover__block";
  const newLabel = document.createElement("div");
  newLabel.className = "leditor-ai-draft-popover__label";
  newLabel.textContent = "Proposed";
  const newTxt = document.createElement("div");
  newTxt.className = "leditor-ai-draft-popover__text";
  newTxt.textContent = sanitizeSnippet(args.proposed, 420);

  oldBlock.append(oldLabel, oldTxt);
  newBlock.append(newLabel, newTxt);
  body.append(oldBlock, newBlock);

  const actions = document.createElement("div");
  actions.className = "leditor-ai-draft-popover__actions";

  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "leditor-ai-draft-popover__btn";
  rejectBtn.textContent = "Reject";
  rejectBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      window.dispatchEvent(new CustomEvent("leditor:ai-draft-action", { detail: { ...args.eventDetail, action: "reject" } }));
    } catch {
      // ignore
    }
    closePopover();
  });

  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className = "leditor-ai-draft-popover__btn leditor-ai-draft-popover__btn--primary";
  acceptBtn.textContent = "Accept";
  acceptBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      window.dispatchEvent(new CustomEvent("leditor:ai-draft-action", { detail: { ...args.eventDetail, action: "accept" } }));
    } catch {
      // ignore
    }
    closePopover();
  });

  actions.append(rejectBtn, acceptBtn);
  pop.append(title, body, actions);
  document.body.appendChild(pop);

  // Position near the clicked replacement span, clamped within viewport.
  const rect = args.anchorEl.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const viewport = {
    left: 10,
    top: 10,
    right: window.innerWidth - 10,
    bottom: window.innerHeight - 10
  };
  const preferBelow = rect.bottom + 8 + popRect.height <= viewport.bottom;
  const top = preferBelow ? rect.bottom + 8 : Math.max(viewport.top, rect.top - 8 - popRect.height);
  const left = Math.max(viewport.left, Math.min(viewport.right - popRect.width, rect.left));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;

  const onDocPointerDown = (e: Event) => {
    const t = e.target as Node | null;
    if (!t) return;
    if (pop.contains(t) || args.anchorEl.contains(t)) return;
    closePopover();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopover();
    }
  };
  const docShell = document.querySelector(".leditor-doc-shell") as HTMLElement | null;
  const onScroll = () => closePopover();

  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  docShell?.addEventListener("scroll", onScroll, { passive: true });

  activePopover = {
    key: args.key,
    popover: pop,
    cleanup: [
      () => document.removeEventListener("pointerdown", onDocPointerDown, true),
      () => document.removeEventListener("keydown", onKeyDown, true),
      () => docShell?.removeEventListener("scroll", onScroll)
    ]
  };
};

const stripProtectedTexts = (value: string, protectedTexts: string[]) => {
  let out = String(value ?? "");
  for (const t of protectedTexts) {
    const needle = String(t ?? "");
    if (!needle) continue;
    out = out.split(needle).join("");
  }
  return out;
};

const splitByProportions = (value: string, lengths: number[]): string[] => {
  const input = String(value ?? "");
  if (lengths.length <= 1) return [input];
  const total = lengths.reduce((acc, n) => acc + Math.max(0, n), 0);
  if (total <= 0) {
    const chunk = input;
    return [chunk, ...lengths.slice(1).map(() => "")];
  }
  const out: string[] = [];
  let idx = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    if (i === lengths.length - 1) {
      out.push(input.slice(idx));
      break;
    }
    const share = Math.max(0, lengths[i]) / total;
    const target = idx + Math.floor(input.length * share);
    const limit = Math.max(idx, Math.min(input.length, target));
    let cut = input.lastIndexOf(" ", limit);
    if (cut < idx) cut = input.indexOf(" ", limit);
    if (cut < 0) cut = limit;
    out.push(input.slice(idx, cut));
    idx = cut;
  }
  while (out.length < lengths.length) out.push("");
  if (out.length > lengths.length) {
    const extra = out.slice(lengths.length - 1).join("");
    out.length = lengths.length;
    out[lengths.length - 1] = `${out[lengths.length - 1]}${extra}`;
  }
  return out;
};

const buildDecorations = (state: EditorState, draft: DraftState): DecorationSet => {
  if (!draft.enabled || draft.items.length === 0) return DecorationSet.empty;
  const docSize = state.doc.content.size;
  const decos: Decoration[] = [];
  for (const item of draft.items) {
    const from = clamp(Math.floor(item.from), 0, docSize);
    const to = clamp(Math.floor(item.to), 0, docSize);
    if (to <= from) continue;

    // Split the textblock into plain segments separated by citation anchors/atoms, so citation nodes remain visible.
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    if (!$from.sameParent($to) || !$from.parent?.isTextblock) {
      // Fallback: treat the whole range as a single segment.
      const key = `${from}:${to}`;
      const original = typeof item.originalText === "string" ? item.originalText : state.doc.textBetween(from, to, "\n");
      const proposed = String(item.proposedText ?? "");
      decos.push(
        Decoration.inline(from, to, {
          class: "leditor-ai-draft-hidden",
          "data-ai-draft": "hidden"
        })
      );
      decos.push(
        Decoration.widget(
          from,
          () => {
            const el = document.createElement("span");
            el.className = "leditor-ai-draft-repl";
            el.textContent = proposed;
            el.title = `Original:\n${original}\n\nClick to accept/reject`;
            el.contentEditable = "false";
            el.setAttribute("data-ai-draft-repl", "true");
            const detail: DraftActionEvent = {
              action: "accept",
              n: typeof item.n === "number" ? item.n : undefined,
              from,
              to
            };
            el.addEventListener("pointerdown", (e) => {
              e.preventDefault();
              e.stopPropagation();
              openPopover({
                key,
                anchorEl: el,
                original,
                proposed,
                eventDetail: detail
              });
            });
            return el;
          },
          { side: -1 }
        )
      );
      continue;
    }

    const parent = $from.parent;
    const depth = $from.depth;
    const parentStart = $from.start(depth);

    const plainSegments: Array<{ from: number; to: number; oldText: string }> = [];
    const protectedTexts: string[] = [];

    let segFrom: number | null = null;
    let segTo: number | null = null;
    let segText = "";

    const flush = () => {
      if (segFrom !== null && segTo !== null && segTo > segFrom) {
        plainSegments.push({ from: segFrom, to: segTo, oldText: segText });
      }
      segFrom = null;
      segTo = null;
      segText = "";
    };

    let offset = 0;
    for (let i = 0; i < parent.childCount; i += 1) {
      const child: any = parent.child(i);
      const childFrom = parentStart + offset;
      const childTo = childFrom + child.nodeSize;
      offset += child.nodeSize;

      // Only consider nodes that intersect the range.
      const clipFrom = Math.max(from, childFrom);
      const clipTo = Math.min(to, childTo);
      if (clipTo <= clipFrom) continue;

      if (child.isText) {
        const marks = Array.isArray(child.marks) ? child.marks : [];
        const isProtected = marks.some((m: any) => isCitationLikeMark(m));
        const startOff = Math.max(0, clipFrom - childFrom);
        const endOff = Math.max(startOff, Math.min(String(child.text ?? "").length, clipTo - childFrom));
        const sub = String(child.text ?? "").slice(startOff, endOff);
        if (isProtected) {
          flush();
          if (sub) protectedTexts.push(sub);
          continue;
        }
        if (segFrom === null) {
          segFrom = clipFrom;
          segTo = clipTo;
          segText = sub;
        } else {
          segTo = clipTo;
          segText += sub;
        }
        continue;
      }

      // Non-text inline nodes are treated as boundaries (citation atoms, images, etc.).
      flush();
      continue;
    }
    flush();

    const proposed = String(item.proposedText ?? "");
    const proposedPlain = stripProtectedTexts(proposed, protectedTexts);
    const lengths = plainSegments.map((s) => s.oldText.length);
    const chunks = splitByProportions(proposedPlain, lengths);

    const itemKey = `${from}:${to}`;
    for (let i = 0; i < plainSegments.length; i += 1) {
      const seg = plainSegments[i];
      const newChunk = String(chunks[i] ?? "");
      // Replace the original plain segment and render the new chunk in-place.
      decos.push(
        Decoration.inline(seg.from, seg.to, {
          class: "leditor-ai-draft-hidden",
          "data-ai-draft": "hidden"
        })
      );
      if (!newChunk) continue;
      decos.push(
        Decoration.widget(
          seg.from,
          () => {
            const el = document.createElement("span");
            el.className = "leditor-ai-draft-repl";
            el.textContent = newChunk;
            el.title = `Original:\n${seg.oldText}\n\nClick to accept/reject`;
            el.contentEditable = "false";
            el.setAttribute("data-ai-draft-repl", "true");
            const detail: DraftActionEvent = {
              action: "accept",
              n: typeof item.n === "number" ? item.n : undefined,
              from,
              to
            };
            el.addEventListener("pointerdown", (e) => {
              e.preventDefault();
              e.stopPropagation();
              openPopover({
                key: itemKey,
                anchorEl: el,
                original: typeof item.originalText === "string" ? item.originalText : state.doc.textBetween(from, to, "\n"),
                proposed,
                eventDetail: detail
              });
            });
            return el;
          },
          { side: -1 }
        )
      );
    }
  }
  return DecorationSet.create(state.doc, decos);
};

const applyDraftMeta = (tr: Transaction, prev: DraftState): DraftState => {
  const meta = tr.getMeta(draftKey) as Partial<DraftState> | null;
  if (!meta) return prev;
  return {
    enabled: typeof meta.enabled === "boolean" ? meta.enabled : prev.enabled,
    items: Array.isArray(meta.items) ? (meta.items as AiDraftPreviewItem[]) : prev.items
  };
};

export const setAiDraftPreviewEditor = (editor: Editor) => {
  editorRef = editor;
};

export const setAiDraftPreview = (items: AiDraftPreviewItem[]) => {
  if (!editorRef) return;
  const tr = editorRef.state.tr.setMeta(draftKey, { enabled: true, items });
  editorRef.view.dispatch(tr);
};

export const clearAiDraftPreview = () => {
  if (!editorRef) return;
  closePopover();
  const tr = editorRef.state.tr.setMeta(draftKey, { enabled: false, items: [] });
  editorRef.view.dispatch(tr);
};

export const aiDraftPreviewExtension = Extension.create({
  name: "aiDraftPreview",
  addCommands() {
    return {
      setAiDraftPreview:
        (items: AiDraftPreviewItem[]) =>
        () => {
          setAiDraftPreview(items);
          return true;
        },
      clearAiDraftPreview:
        () =>
        () => {
          clearAiDraftPreview();
          return true;
        }
    } as any;
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<DraftState>({
        key: draftKey,
        state: {
          init() {
            return { enabled: false, items: [] };
          },
          apply(tr, prev, _oldState, newState) {
            const next = applyDraftMeta(tr, prev);
            if (tr.docChanged || tr.getMeta(draftKey)) {
              // If positions are stale due to doc changes, keep them as-is; Accept will revalidate anyway.
              (this as any)._decorations = buildDecorations(newState, next);
            }
            return next;
          }
        },
        props: {
          decorations(state) {
            const pluginState = draftKey.getState(state);
            if (!pluginState?.enabled) return null;
            const cached = (this as any)._decorations as DecorationSet | undefined;
            return cached ?? buildDecorations(state, pluginState);
          }
        }
      })
    ];
  }
});
