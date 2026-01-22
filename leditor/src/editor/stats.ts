type DocNode = {
  type?: string;
  text?: string;
  content?: DocNode[];
};

const blockBoundaryTypes = new Set([
  "paragraph",
  "heading",
  "list_item",
  "table_cell",
  "table_header",
  "blockquote",
  "code_block"
]);

export const computeStats = (docJson: any): {
  words: number;
  charsWithSpaces: number;
  charsNoSpaces: number;
} => {
  let words = 0;
  let charsWithSpaces = 0;
  let charsNoSpaces = 0;
  let prevWasNonSpace = false;

  const consumeText = (text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const isSpace = /\s/.test(ch);
      charsWithSpaces += 1;
      if (!isSpace) {
        charsNoSpaces += 1;
        if (!prevWasNonSpace) words += 1;
        prevWasNonSpace = true;
      } else {
        prevWasNonSpace = false;
      }
    }
  };

  const walk = (node: DocNode) => {
    if (!node) return;
    if (node.type === "text" && typeof node.text === "string") {
      consumeText(node.text);
      return;
    }
    if (node.type === "hardBreak") {
      prevWasNonSpace = false;
      return;
    }
    if (node.type && blockBoundaryTypes.has(node.type)) {
      prevWasNonSpace = false;
    }
    if (node.content) {
      for (const child of node.content) {
        walk(child);
      }
    }
    if (node.type && blockBoundaryTypes.has(node.type)) {
      prevWasNonSpace = false;
    }
  };

  walk(docJson as DocNode);

  return { words, charsWithSpaces, charsNoSpaces };
};
