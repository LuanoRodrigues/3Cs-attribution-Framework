const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const isWordChar = (ch: string): boolean => {
  if (!ch) return false;
  try {
    return /[\p{L}\p{N}_]/u.test(ch);
  } catch {
    return /[A-Za-z0-9_]/.test(ch);
  }
};

export const findWordBounds = (text: string, offset: number): { start: number; end: number } => {
  const safeOffset = clamp(offset, 0, text.length);
  let start = safeOffset;
  let end = safeOffset;
  while (start > 0 && isWordChar(text[start - 1])) start -= 1;
  while (end < text.length && isWordChar(text[end])) end += 1;
  return { start, end };
};

const isSentenceBoundary = (text: string, index: number): { boundary: boolean; include: boolean } => {
  const ch = text[index];
  if (!ch) return { boundary: false, include: false };
  if (ch === "\n") return { boundary: true, include: false };
  if (ch === "." || ch === "!" || ch === "?") {
    const next = text[index + 1] ?? "";
    if (!next || /\s/.test(next)) {
      return { boundary: true, include: true };
    }
  }
  return { boundary: false, include: false };
};

export const findSentenceBounds = (text: string, offset: number): { start: number; end: number } => {
  const safeOffset = clamp(offset, 0, text.length);
  let start = 0;
  for (let i = safeOffset - 1; i >= 0; i -= 1) {
    const boundary = isSentenceBoundary(text, i);
    if (boundary.boundary) {
      start = boundary.include ? i + 1 : i + 0;
      break;
    }
  }
  let end = text.length;
  for (let i = safeOffset; i < text.length; i += 1) {
    const boundary = isSentenceBoundary(text, i);
    if (boundary.boundary) {
      end = boundary.include ? i + 1 : i;
      break;
    }
  }
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return { start, end };
};
