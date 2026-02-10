export type FootnoteNumbering = {
  start: number;
  format: "numeric";
};

export const defaultFootnoteNumbering = (): FootnoteNumbering => ({ start: 1, format: "numeric" });
