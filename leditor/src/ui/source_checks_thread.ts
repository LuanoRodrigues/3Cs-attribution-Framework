import type { EditorHandle } from "../api/leditor.ts";

export type SourceCheckThreadAnchor = {
  key: string;
  text: string;
  title?: string;
  href?: string;
  dataKey?: string;
  dataDqid?: string;
  dataQuoteId?: string;
  context?: { start?: number; end?: number; sentence?: string; before?: string; after?: string } | null;
};

export type SourceCheckThreadItem = {
  key: string;
  paragraphN: number;
  anchor: SourceCheckThreadAnchor;
  verdict: "verified" | "needs_review";
  justification: string;
  fixSuggestion?: string;
  suggestedReplacementKey?: string;
  claimRewrite?: string;
  fixStatus?: "pending" | "dismissed" | "applied";
  createdAt: string;
  provider?: string;
  model?: string;
};

export type SourceChecksThread = {
  version: 1;
  lastRunAt?: string;
  items: SourceCheckThreadItem[];
};

// Important: visibility is session-only. Do not auto-show source checks on load.
let visible = false;

let thread: SourceChecksThread = { version: 1, items: [] };
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((fn) => fn());
  try {
    window.dispatchEvent(new CustomEvent("leditor:source-checks-thread", { detail: { thread, visible } }));
  } catch {
    // ignore
  }
};

export const subscribeSourceChecksThread = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const isSourceChecksVisible = (): boolean => visible;

export const setSourceChecksVisible = (next: boolean) => {
  visible = Boolean(next);
  notify();
};

export const toggleSourceChecksVisible = (): boolean => {
  setSourceChecksVisible(!visible);
  return visible;
};

export const getSourceChecksThread = (): SourceChecksThread => thread;

export const setSourceChecksThread = (next: SourceChecksThread) => {
  thread = next && typeof next === "object" ? next : { version: 1, items: [] };
  if (!Array.isArray(thread.items)) thread.items = [];
  notify();
};

export const clearSourceChecksThread = () => {
  thread = { version: 1, items: [] };
  notify();
};

export const dismissSourceCheckThreadItem = (key: string) => {
  const k = String(key || "").trim();
  if (!k) return;
  thread = { ...thread, items: thread.items.filter((it) => String(it?.key) !== k) };
  notify();
};

export const setSourceCheckFixStatus = (key: string, status: "pending" | "dismissed" | "applied") => {
  const k = String(key || "").trim();
  if (!k) return;
  const nextItems = thread.items.map((it) => {
    if (String(it?.key) !== k) return it;
    return { ...it, fixStatus: status } as SourceCheckThreadItem;
  });
  thread = { ...thread, items: nextItems };
  notify();
};

export const upsertSourceChecksFromRun = (args: {
  paragraphN: number;
  provider?: string;
  model?: string;
  anchors: SourceCheckThreadAnchor[];
  checksByKey: Map<
    string,
    {
      verdict: "verified" | "needs_review";
      justification: string;
      fixSuggestion?: string;
      suggestedReplacementKey?: string;
      claimRewrite?: string;
    }
  >;
}) => {
  const now = new Date().toISOString();
  const paragraphN = Math.max(1, Math.floor(Number(args.paragraphN) || 1));
  const nextItems = [...thread.items];
  const existingByKey = new Map<string, number>();
  nextItems.forEach((it, idx) => {
    const k = typeof it?.key === "string" ? it.key : "";
    if (k) existingByKey.set(k, idx);
  });
  for (const a of args.anchors) {
    const key = typeof a?.key === "string" ? a.key : "";
    if (!key) continue;
    const c = args.checksByKey.get(key);
    if (!c) continue;
    const item: SourceCheckThreadItem = {
      key,
      paragraphN,
      anchor: {
        key,
        text: String(a.text ?? ""),
        title: typeof a.title === "string" ? a.title : "",
        href: typeof a.href === "string" ? a.href : "",
        dataKey: typeof a.dataKey === "string" ? a.dataKey : "",
        dataDqid: typeof a.dataDqid === "string" ? a.dataDqid : "",
        dataQuoteId: typeof a.dataQuoteId === "string" ? a.dataQuoteId : "",
        context: a.context ?? null
      },
      verdict: c.verdict,
      justification: String(c.justification ?? ""),
      fixSuggestion: typeof c.fixSuggestion === "string" ? c.fixSuggestion : undefined,
      suggestedReplacementKey: typeof c.suggestedReplacementKey === "string" ? c.suggestedReplacementKey : undefined,
      claimRewrite: typeof c.claimRewrite === "string" ? c.claimRewrite : undefined,
      fixStatus: "pending",
      createdAt: now,
      provider: args.provider,
      model: args.model
    };
    const existingIdx = existingByKey.get(key);
    if (typeof existingIdx === "number") {
      nextItems[existingIdx] = item;
    } else {
      nextItems.push(item);
    }
  }
  thread = { version: 1, lastRunAt: now, items: nextItems };
  notify();
};

export const exportSourceChecksThreadForLedoc = (): unknown => {
  if (!thread.items.length) return null;
  return thread;
};

export const loadSourceChecksThreadFromLedoc = (history: unknown) => {
  if (!history || typeof history !== "object") return;
  const h = history as any;
  const raw = h.sourceChecksThread ?? h.source_checks_thread ?? h.sourceChecks ?? null;
  if (!raw || typeof raw !== "object") return;
  const items = Array.isArray((raw as any).items) ? (raw as any).items : [];
  const normalized: SourceChecksThread = {
    version: 1,
    lastRunAt: typeof (raw as any).lastRunAt === "string" ? (raw as any).lastRunAt : undefined,
    items: items
      .map((it: any) => {
        const key = typeof it?.key === "string" ? it.key : "";
        const paragraphN = Number.isFinite(it?.paragraphN) ? Math.max(1, Math.floor(it.paragraphN)) : 1;
        const verdict = it?.verdict === "verified" ? "verified" : "needs_review";
        const justification = typeof it?.justification === "string" ? it.justification : "";
        const fixSuggestion = typeof it?.fixSuggestion === "string" ? it.fixSuggestion : "";
        const suggestedReplacementKey =
          typeof it?.suggestedReplacementKey === "string" ? it.suggestedReplacementKey : "";
        const claimRewrite = typeof it?.claimRewrite === "string" ? it.claimRewrite : "";
        const fixStatusRaw = typeof it?.fixStatus === "string" ? it.fixStatus : "";
        const fixStatus =
          fixStatusRaw === "applied" ? "applied" : fixStatusRaw === "dismissed" ? "dismissed" : "pending";
        const createdAt = typeof it?.createdAt === "string" ? it.createdAt : "";
        const anchor = it?.anchor && typeof it.anchor === "object" ? it.anchor : {};
        const text = typeof anchor?.text === "string" ? anchor.text : "";
        if (!key || !text) return null;
        return {
          key,
          paragraphN,
          verdict,
          justification,
          fixSuggestion: fixSuggestion || undefined,
          suggestedReplacementKey: suggestedReplacementKey || undefined,
          claimRewrite: claimRewrite || undefined,
          fixStatus,
          createdAt: createdAt || new Date().toISOString(),
          provider: typeof it?.provider === "string" ? it.provider : undefined,
          model: typeof it?.model === "string" ? it.model : undefined,
          anchor: {
            key,
            text,
            title: typeof anchor?.title === "string" ? anchor.title : "",
            href: typeof anchor?.href === "string" ? anchor.href : "",
            dataKey: typeof anchor?.dataKey === "string" ? anchor.dataKey : "",
            dataDqid: typeof anchor?.dataDqid === "string" ? anchor.dataDqid : "",
            dataQuoteId: typeof anchor?.dataQuoteId === "string" ? anchor.dataQuoteId : "",
            context: anchor?.context ?? null
          }
        } satisfies SourceCheckThreadItem;
      })
      .filter(Boolean) as SourceCheckThreadItem[]
  };
  setSourceChecksThread(normalized);
};

type ResolvedAnchor = { key: string; from: number; to: number; text: string; href: string; dataKey: string; dataDqid: string };

const listParagraphRanges = (editorHandle: EditorHandle): Array<{ n: number; from: number; to: number }> => {
  const editor = editorHandle.getEditor();
  const targets: Array<{ n: number; from: number; to: number }> = [];
  const excludedParentTypes = new Set(["tableCell", "tableHeader", "table_cell", "table_header", "footnoteBody"]);
  let n = 0;
  editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node: any, pos: number, parent: any) => {
    if (!node?.isTextblock) return true;
    if (node.type?.name === "doc") return true;
    if (node.type?.name === "heading") return true;
    const parentName = parent?.type?.name;
    if (parentName && excludedParentTypes.has(parentName)) return true;
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    n += 1;
    targets.push({ n, from, to });
    return true;
  });
  return targets;
};

const scanAnchorsInRange = (editorHandle: EditorHandle, from: number, to: number): ResolvedAnchor[] => {
  const editor = editorHandle.getEditor();
  const doc = editor.state.doc;
  const anchors: ResolvedAnchor[] = [];
  const anchorMark = editor.schema.marks.anchor ?? null;
  const linkMark = editor.schema.marks.link ?? null;
  doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (!node) return true;
    if (String(node.type?.name ?? "") === "citation") {
      const attrs = node.attrs ?? {};
      const dqid = typeof attrs.dqid === "string" ? attrs.dqid : "";
      const href = dqid ? `dq://${dqid}` : "";
      const items = Array.isArray(attrs.items) ? attrs.items : [];
      const itemKeys = items
        .map((it: any) => (typeof it?.itemKey === "string" ? it.itemKey : ""))
        .filter(Boolean)
        .join(",");
      const rendered = typeof attrs.renderedHtml === "string" ? String(attrs.renderedHtml) : "";
      const text = rendered ? rendered.replace(/<[^>]*>/g, "").trim() : "(citation)";
      anchors.push({
        key: `citation@${pos}`,
        from: pos,
        to: pos + node.nodeSize,
        text,
        href,
        dataKey: itemKeys,
        dataDqid: dqid
      });
      return true;
    }
    if (!node.isText || !Array.isArray(node.marks) || node.marks.length === 0) return true;
    for (const m of node.marks) {
      if (anchorMark && m.type === anchorMark) {
        const attrs = m.attrs ?? {};
        const href = typeof attrs.href === "string" ? attrs.href : "";
        const dataKey = typeof attrs.dataKey === "string" ? attrs.dataKey : "";
        const dqid = href.startsWith("dq://") ? href.slice("dq://".length) : "";
        anchors.push({
          key: `anchor@${pos}`,
          from: pos,
          to: pos + node.nodeSize,
          text: String(node.text ?? ""),
          href,
          dataKey,
          dataDqid: dqid
        });
        break;
      }
      if (linkMark && m.type === linkMark) {
        const attrs = m.attrs ?? {};
        const href = typeof attrs.href === "string" ? attrs.href : "";
        if (!href.startsWith("dq://")) continue;
        anchors.push({
          key: `link@${pos}`,
          from: pos,
          to: pos + node.nodeSize,
          text: String(node.text ?? ""),
          href,
          dataKey: "",
          dataDqid: href.slice("dq://".length)
        });
        break;
      }
    }
    return true;
  });
  return anchors;
};

export const applySourceChecksThreadToEditor = (editorHandle: EditorHandle) => {
  const items = thread.items;
  if (!items.length) {
    editorHandle.execCommand("ClearSourceChecks");
    return;
  }
  // Best-effort re-attach by matching within the same paragraph index.
  const byN = new Map<number, { from: number; to: number }>();
  for (const r of listParagraphRanges(editorHandle)) {
    byN.set(r.n, { from: r.from, to: r.to });
  }
  const resolved: Array<{ key: string; from: number; to: number; verdict: string; justification: string }> = [];
  for (const it of items) {
    const range = byN.get(it.paragraphN);
    const scanFrom = range?.from ?? 0;
    const scanTo = range?.to ?? editorHandle.getEditor().state.doc.content.size;
    const candidates = scanAnchorsInRange(editorHandle, scanFrom, scanTo);
    const wantHref = String(it.anchor?.href ?? "");
    const wantText = String(it.anchor?.text ?? "");
    const occ = (() => {
      const tail = String(it.key || "").split(":").pop() ?? "";
      const n = Number(tail);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
    })();
    const byHref = wantHref ? candidates.filter((c) => c.href && c.href === wantHref) : [];
    const byText = wantText ? candidates.filter((c) => c.text.trim() === wantText.trim()) : [];
    const match =
      (byHref.length ? byHref[Math.min(byHref.length - 1, occ - 1)] : null) ??
      (byText.length ? byText[Math.min(byText.length - 1, occ - 1)] : null) ??
      candidates[0] ??
      null;
    if (!match) continue;
    resolved.push({
      key: it.key,
      from: match.from,
      to: match.to,
      verdict: it.verdict,
      justification: it.justification
    });
  }
  editorHandle.execCommand("SetSourceChecks", { items: resolved });
};
