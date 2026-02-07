export type AgentEdit = { action: "replace"; start: number; end: number; text: string };

export const normalizeEdits = (edits: AgentEdit[], baseLen: number): AgentEdit[] => {
  const cleaned = edits
    .map((e) => ({
      action: e.action,
      start: Math.max(0, Math.min(baseLen, Math.floor(Number(e.start)))),
      end: Math.max(0, Math.min(baseLen, Math.floor(Number(e.end)))),
      text: typeof e.text === "string" ? e.text : String(e.text ?? "")
    }))
    .filter((e) => e.action === "replace" && Number.isFinite(e.start) && Number.isFinite(e.end) && e.end >= e.start);
  const sorted = cleaned.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.start < sorted[i - 1]!.end) {
      throw new Error("Edits overlap; aborting.");
    }
  }
  return sorted;
};

export const applyEditsToText = (base: string, edits: AgentEdit[]): string => {
  let out = base;
  const sorted = normalizeEdits(edits, base.length);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const e = sorted[i]!;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
};

export const extractParagraphsFromMarkedText = (text: string): Map<number, string> => {
  const out = new Map<number, string>();
  const re = /<<<P:(\d+)>>>/g;
  const matches: Array<{ n: number; index: number }> = [];
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    matches.push({ n, index: m.index });
  }
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i]!;
    const next = matches[i + 1];
    const start = cur.index + `<<<P:${cur.n}>>>`.length;
    const end = next ? next.index : text.length;
    const body = text.slice(start, end).trim();
    out.set(cur.n, body);
  }
  return out;
};
