// Pragmatic break opportunities; this is not a full UAX14 implementation yet.
export const findBreakPoints = (text: string): number[] => {
  const breaks: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "-" || ch === "\n") {
      breaks.push(i + 1);
    }
  }
  return breaks;
};
