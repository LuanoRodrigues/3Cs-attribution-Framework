import fs from "fs";
import path from "path";
import sanitizeHtml from "sanitize-html";
import { LEDOC_BUNDLE_VERSION, writeLedocBundle } from "./ledoc";

const normalizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type ParsedCoderState = {
  title: string;
  html: string | null;
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const isSafeAnchorHref = (value: string | null | undefined): boolean => {
  const href = String(value ?? "").trim();
  if (!href) return false;
  if (href.startsWith("#")) return true;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href);
};

const normalizeAnchorHref = (attrs: Record<string, string>): string => {
  const rawHref = String(attrs.href ?? "").trim();
  const dqid = attrs["data-dqid"] ?? attrs["data-quote-id"] ?? attrs["data-quote_id"] ?? "";
  const dqHref = dqid ? `dq://${dqid}` : "";
  if (isSafeAnchorHref(rawHref)) return rawHref;
  if (isSafeAnchorHref(dqHref)) return dqHref;
  const origHref = String(attrs["data-orig-href"] ?? "").trim();
  if (isSafeAnchorHref(origHref)) return origHref;
  return "#";
};

type HtmlText = { type: "text"; value: string };
type HtmlElement = { type: "element"; tag: string; attrs: Record<string, string>; children: HtmlNode[] };
type HtmlNode = HtmlText | HtmlElement;

const tokenizeHtml = (html: string): HtmlNode[] => {
  const tokens: Array<{ type: "text" | "tag"; closing?: boolean; selfClosing?: boolean; name?: string; attrs?: string; raw: string }> = [];
  const tagRe = /<\/?[^>]+?>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", raw: html.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    const closing = raw.startsWith("</");
    const selfClosing = /\/>$/.test(raw);
    const nameMatch = raw.match(/^<\/?\s*([^\s/>]+)/);
    const name = nameMatch ? nameMatch[1].toLowerCase() : "";
    const attrs = raw.replace(/^<\/?\s*[^\s/>]+/, "").replace(/\/?>$/, "").trim();
    tokens.push({ type: "tag", closing, selfClosing, name, attrs, raw });
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < html.length) {
    tokens.push({ type: "text", raw: html.slice(lastIndex) });
  }

  const root: HtmlElement = { type: "element", tag: "root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];

  const parseAttrs = (rawAttrs?: string): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!rawAttrs) return out;
    const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(rawAttrs)) !== null) {
      out[m[1]] = m[2] ?? m[3] ?? "";
    }
    return out;
  };

  for (const tok of tokens) {
    if (tok.type === "text") {
      const parent = stack[stack.length - 1];
      parent.children.push({ type: "text", value: tok.raw });
      continue;
    }
    const tag = tok.name ?? "";
    if (tok.closing) {
      while (stack.length > 1) {
        const popped = stack.pop();
        if (popped && (popped as any).tag === tag) break;
      }
      continue;
    }
    const node: HtmlElement = { type: "element", tag, attrs: parseAttrs(tok.attrs), children: [] };
    const parent = stack[stack.length - 1];
    parent.children.push(node);
    if (!tok.selfClosing && tag !== "br") {
      stack.push(node);
    }
  }
  return root.children;
};

const extractOwnHtml = (node: any): string | null => {
  if (!node || typeof node !== "object") return null;
  const html =
    typeof node.edited_html === "string"
      ? node.edited_html
      : typeof node.editedHtml === "string"
        ? node.editedHtml
        : typeof node.payload?.html === "string"
          ? node.payload.html
          : null;
  return html && html.trim().length > 0 ? html : null;
};

const extractFirstHtml = (state: any): string | null => {
  if (!state || typeof state !== "object") return null;
  const pick = (node: any): string | null => {
    if (!node || typeof node !== "object") return null;
    const html = extractOwnHtml(node);
    if (html) return html;
    if (Array.isArray(node.nodes)) {
      for (const child of node.nodes) {
        const found = pick(child);
        if (found) return found;
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = pick(child);
        if (found) return found;
      }
    }
    return null;
  };
  return pick(state);
};

const extractTitle = (state: any, fallback: string): string => {
  const fromNode = (node: any): string | null => {
    if (!node || typeof node !== "object") return null;
    if (typeof node.name === "string" && node.name.trim()) return node.name.trim();
    if (Array.isArray(node.nodes)) {
      for (const child of node.nodes) {
        const found = fromNode(child);
        if (found) return found;
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = fromNode(child);
        if (found) return found;
      }
    }
    return null;
  };
  return fromNode(state) ?? fallback;
};

type PMMark = { type: string; attrs?: Record<string, unknown> };
type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: PMMark[] };

const sanitizeForParsing = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [
      "p",
      "div",
      "section",
      "article",
      "br",
      "span",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "strike",
      "sup",
      "sub",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li"
    ],
    allowedAttributes: {
      a: [
        "href",
        "title",
        "target",
        "rel",
        "name",
        "id",
        "data-key",
        "data-orig-href",
        "data-quote-id",
        "data-quote_id",
        "data-dqid",
        "data-quote-text",
        "item-key",
        "data-item-key"
      ],
      "*": ["style", "class", "id", "data-key", "data-dqid", "data-quote-id", "data-quote_id", "data-quote-text"]
    },
    textFilter: (text: string) => decodeEntities(text),
    allowedSchemes: [...sanitizeHtml.defaults.allowedSchemes, "dq"]
  });

const hasStyle = (style: string | undefined, needle: string): boolean =>
  typeof style === "string" ? style.toLowerCase().includes(needle) : false;

const inlineHasText = (content: PMNode[]): boolean =>
  content.some((node) => node?.type === "text" && String(node.text || "").trim().length > 0);

const marksEqual = (a?: PMMark[], b?: PMMark[]): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left?.type !== right?.type) return false;
    const leftAttrs = left?.attrs ?? null;
    const rightAttrs = right?.attrs ?? null;
    if (leftAttrs === rightAttrs) continue;
    if (!leftAttrs || !rightAttrs) return false;
    if (JSON.stringify(leftAttrs) !== JSON.stringify(rightAttrs)) return false;
  }
  return true;
};

const normalizeInlineContent = (content: PMNode[]): PMNode[] => {
  const out: PMNode[] = [];
  for (const node of content) {
    if (!node) continue;
    if (node.type === "text") {
      const text = String(node.text || "").replace(/\s+/g, " ");
      if (!text) continue;
      const prev = out[out.length - 1];
      if (prev?.type === "text" && marksEqual(prev.marks, node.marks)) {
        prev.text = `${prev.text ?? ""}${text}`;
      } else {
        out.push({ ...node, text });
      }
      continue;
    }
    out.push(node);
  }
  while (out.length && out[0].type === "text" && !String(out[0].text || "").trim()) out.shift();
  while (out.length && out[out.length - 1].type === "text" && !String(out[out.length - 1].text || "").trim()) out.pop();
  return out;
};

const mergeLeadingSpaceParagraphs = (blocks: PMNode[]): PMNode[] => {
  const out: PMNode[] = [];
  const lastTextNode = (node: PMNode | undefined): PMNode | null => {
    if (!node?.content) return null;
    for (let i = node.content.length - 1; i >= 0; i -= 1) {
      const child = node.content[i];
      if (child?.type === "text") return child;
    }
    return null;
  };
  const firstTextNode = (node: PMNode | undefined): PMNode | null => {
    if (!node?.content) return null;
    for (const child of node.content) {
      if (child?.type === "text") return child;
    }
    return null;
  };
  for (const block of blocks) {
    if (block?.type === "paragraph" && out.length) {
      const prev = out[out.length - 1];
      if (prev?.type === "paragraph") {
        const first = firstTextNode(block);
        if (first && typeof first.text === "string" && /^\s+/.test(first.text)) {
          const prevLast = lastTextNode(prev);
          if (prevLast && typeof prevLast.text === "string" && /\s$/.test(prevLast.text)) {
            first.text = first.text.replace(/^\s+/, "");
          }
          prev.content = [...(prev.content || []), ...(block.content || [])];
          continue;
        }
      }
    }
    out.push(block);
  }
  return out;
};

const firstNonWhitespaceChar = (node: PMNode | undefined): string | null => {
  if (!node?.content) return null;
  for (const child of node.content) {
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    const match = text.match(/[^\s\u00A0\u2000-\u200B]/);
    if (match) return match[0];
  }
  return null;
};

const lastNonWhitespaceChar = (node: PMNode | undefined): string | null => {
  if (!node?.content) return null;
  for (let i = node.content.length - 1; i >= 0; i -= 1) {
    const child = node.content[i];
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    const match = text.match(/[^\s\u00A0\u2000-\u200B](?!.*[^\s\u00A0\u2000-\u200B])/);
    if (match) return match[0];
  }
  return null;
};

const mergeContinuationParagraphs = (blocks: PMNode[]): PMNode[] => {
  const out: PMNode[] = [];
  const trimLeadingWhitespace = (node: PMNode): PMNode => {
    if (!node?.content) return node;
    const trimmed: PMNode[] = [];
    let trimming = true;
    for (const child of node.content) {
      if (!trimming || child?.type !== "text") {
        trimmed.push(child);
        if (child?.type !== "text") trimming = false;
        continue;
      }
      const text = String(child.text ?? "");
      const nextText = text.replace(/^[\s\u00A0\u2000-\u200B]+/, "");
      if (!nextText) continue;
      trimmed.push({ ...child, text: nextText });
      trimming = false;
    }
    return { ...node, content: trimmed };
  };
  const endsWithSpace = (node: PMNode): boolean => {
    if (!node?.content) return false;
    for (let i = node.content.length - 1; i >= 0; i -= 1) {
      const child = node.content[i];
      if (child?.type !== "text") continue;
      const text = String(child.text ?? "");
      if (!text) continue;
      return /\s$/.test(text);
    }
    return false;
  };
  for (const block of blocks) {
    if (block?.type === "paragraph" && out.length) {
      const prev = out[out.length - 1];
      if (prev?.type === "paragraph") {
        const first = firstNonWhitespaceChar(block);
        const last = lastNonWhitespaceChar(prev);
        const startsLower =
          typeof first === "string" && first.length === 1 && /[a-z]/.test(first);
        const startsPunct =
          typeof first === "string" && first.length === 1 && /[),.;:\]]/.test(first);
        const prevTerminal =
          typeof last === "string" && last.length === 1 && /[.!?]/.test(last);
        if (!prevTerminal && (startsLower || startsPunct)) {
          let next = block;
          if (endsWithSpace(prev)) {
            next = trimLeadingWhitespace(block);
          }
          prev.content = [...(prev.content || []), ...(next.content || [])];
          continue;
        }
      }
    }
    out.push(block);
  }
  return out;
};

const inlineFromNodes = (nodes: HtmlNode[], activeMarks: PMMark[] = []): PMNode[] => {
  const out: PMNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = (node as HtmlText).value.replace(/\s+/g, " ");
      if (text.trim().length === 0) continue;
      out.push({ type: "text", text, marks: activeMarks.length ? activeMarks : undefined });
      continue;
    }
    const tag = (node as HtmlElement).tag.toLowerCase();
    const attrs = (node as HtmlElement).attrs || {};
    const nextMarks = [...activeMarks];
    if (tag === "strong" || tag === "b" || hasStyle(attrs.style, "font-weight")) nextMarks.push({ type: "bold" });
    if (tag === "em" || tag === "i" || hasStyle(attrs.style, "font-style")) nextMarks.push({ type: "italic" });
    if (tag === "u" || hasStyle(attrs.style, "text-decoration: underline")) nextMarks.push({ type: "underline" });
    if (tag === "s" || tag === "strike") nextMarks.push({ type: "strikethrough" });
    if (tag === "sup") nextMarks.push({ type: "superscript" });
    if (tag === "sub") nextMarks.push({ type: "subscript" });
    if (tag === "a") {
      const fallbackHref = normalizeAnchorHref(attrs);
      const markAttrs: Record<string, unknown> = {
        href: fallbackHref,
        title: attrs.title ?? null,
        target: attrs.target ?? null,
        rel: attrs.rel ?? null,
        name: attrs.name ?? null,
        id: attrs.id ?? null,
        dataKey: attrs["data-key"] ?? null,
        dataOrigHref: attrs["data-orig-href"] ?? null,
        dataQuoteId: attrs["data-quote-id"] ?? attrs["data-quote_id"] ?? null,
        dataDqid: attrs["data-dqid"] ?? null,
        dataQuoteText: attrs["data-quote-text"] ?? null,
        itemKey: attrs["item-key"] ?? null,
        dataItemKey: attrs["data-item-key"] ?? null
      };
      nextMarks.push({ type: "anchor", attrs: markAttrs });
    }
    if (tag === "br") {
      out.push({ type: "text", text: " ", marks: activeMarks.length ? activeMarks : undefined });
      continue;
    }
    out.push(...inlineFromNodes(node.children, nextMarks));
  }
  return out;
};

const blockFromElement = (el: HtmlNode): PMNode | null => {
  if (el.type !== "element") return null;
  const element = el as HtmlElement;
  const tag = element.tag.toLowerCase();
  const inline = () => inlineFromNodes(el.children);
  if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
    const level = Number.parseInt(tag.slice(1), 10) || 1;
    const content = normalizeInlineContent(inline());
    if (!inlineHasText(content)) return null;
    return { type: "heading", attrs: { level }, content };
  }
  if (tag === "p") {
    const content = normalizeInlineContent(inline());
    if (!inlineHasText(content)) return null;
    return { type: "paragraph", attrs: paragraphAttrs(), content };
  }
  if (tag === "div" || tag === "section" || tag === "article") {
    return null;
  }
  if (tag === "li") {
    const blocks: PMNode[] = [];
    let pendingInline = normalizeInlineContent(inlineFromNodes(element.children));
    if (pendingInline.length) {
      blocks.push({ type: "paragraph", attrs: paragraphAttrs(), content: pendingInline });
      pendingInline = [];
    }
    return { type: "listItem", content: blocks.length ? blocks : [{ type: "paragraph", attrs: paragraphAttrs() }] };
  }
  if (tag === "ul" || tag === "ol") {
    const items = element.children
      .map((child) => blockFromElement(child))
      .filter((n): n is PMNode => n !== null && n !== undefined && (n as PMNode).type === "listItem");
    return { type: tag === "ul" ? "bulletList" : "orderedList", content: items };
  }
  // Inline-only container: descend.
  if (tag === "span") {
    const content = normalizeInlineContent(inlineFromNodes([el]));
    if (!inlineHasText(content)) return null;
    return { type: "paragraph", attrs: paragraphAttrs(), content };
  }
  // Unknown: flatten children as inline into a paragraph.
  const fallback = normalizeInlineContent(inlineFromNodes(el.children));
  if (inlineHasText(fallback)) {
    return { type: "paragraph", attrs: paragraphAttrs(), content: fallback };
  }
  return null;
};

const paragraphAttrs = () => ({
  dir: null,
  indentLeftCm: 0,
  indentLevel: 0,
  indentRight: 0,
  indentRightCm: 0,
  lineHeight: null,
  spaceAfter: 0,
  spaceAfterPt: 0,
  spaceBefore: 0,
  spaceBeforePt: 0,
  textAlign: null
});

const htmlToBlocks = (html: string): PMNode[] => {
  const sanitized = sanitizeForParsing(html);
  const tree = tokenizeHtml(sanitized);
  const blocks: PMNode[] = [];
  let inlineBuffer: PMNode[] = [];
  const flushInline = () => {
    if (!inlineBuffer.length) return;
    const content = normalizeInlineContent(inlineBuffer);
    inlineBuffer = [];
    if (!inlineHasText(content)) return;
    blocks.push({ type: "paragraph", attrs: paragraphAttrs(), content });
  };
  const walk = (nodes: HtmlNode[]) => {
    for (const n of nodes) {
      if (n.type === "text") {
        const text = n.value.replace(/\s+/g, " ");
        if (text.trim()) {
          inlineBuffer.push({ type: "text", text });
        }
        continue;
      }
      const element = n as HtmlElement;
      const tag = element.tag.toLowerCase();
      if (tag === "div" || tag === "section" || tag === "article" || tag === "body" || tag === "html") {
        walk(element.children || []);
        continue;
      }
      const block = blockFromElement(n);
      if (block) {
        flushInline();
        blocks.push(block);
        continue;
      }
      if (Array.isArray(element.children) && element.children.length > 0) {
        walk(element.children);
      }
    }
  };
  walk(tree);
  flushInline();
  const normalizedBlocks = mergeContinuationParagraphs(mergeLeadingSpaceParagraphs(blocks));
  return normalizedBlocks.length ? normalizedBlocks : [{ type: "paragraph", attrs: paragraphAttrs(), content: [] }];
};

const buildDocument = (blocks: PMNode[], title: string): any => {
  const docAttrs = {
    pageSizeId: "a4",
    orientation: "portrait",
    marginsTopCm: 2.5,
    marginsRightCm: 2.5,
    marginsBottomCm: 2.5,
    marginsLeftCm: 2.5,
    columns: 1,
    columnsMode: "one",
    lineNumbering: "none",
    hyphenation: "none",
    citationLocale: "en-US",
    citationStyleId: "apa"
  };
  const pageContent = blocks.length ? blocks : [{ type: "paragraph", attrs: paragraphAttrs(), content: [] }];
  return {
    type: "doc",
    attrs: docAttrs,
    content: [
      {
        type: "page",
        content: pageContent
      }
    ]
  };
};

export const convertCoderStateToLedoc = async (
  sourcePath: string
): Promise<{
  success: boolean;
  payload?: any;
  ledocPath?: string;
  warnings: string[];
  title?: string;
  error?: string;
}> => {
  const warnings: string[] = [];
  try {
    const raw = await fs.promises.readFile(sourcePath, "utf-8");
    const state = JSON.parse(raw);
    const allBlocks: PMNode[] = [];
    const fallbackTitle = path.basename(sourcePath, path.extname(sourcePath)) || "Document";
    const title = extractTitle(state, fallbackTitle);

    const nodes = Array.isArray(state.nodes) ? state.nodes : [];
    const visited = new Set<string>();

    const visit = (node: any, depth: number) => {
      if (!node || typeof node !== "object") return;
      const nodeId = typeof node.id === "string" ? node.id : null;
      if (nodeId) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
      }
      const name = typeof node.name === "string" ? node.name.trim() : "";
      const isFolder = node.type === "folder";
      if (isFolder && name) {
        const level = Math.min(Math.max(depth, 1), 6);
        allBlocks.push({
          type: "heading",
          attrs: { level },
          content: [{ type: "text", text: name }]
        });
      }
      if (!isFolder) {
        const html = extractOwnHtml(node);
        if (html) {
          allBlocks.push(...htmlToBlocks(html));
        }
      }
      const children = Array.isArray(node.children) ? node.children : [];
      const nested = children.length === 0 && Array.isArray(node.nodes) ? node.nodes : [];
      for (const child of [...children, ...nested]) {
        visit(child, depth + (isFolder ? 1 : 0));
      }
    };

    if (nodes.length === 0) {
      const html = extractFirstHtml(state);
      if (html) allBlocks.push(...htmlToBlocks(html));
    } else {
      for (const n of nodes) visit(n, 1);
    }

    const mergedBlocks = mergeLeadingSpaceParagraphs(allBlocks);

    if (mergedBlocks.length === 0) {
      warnings.push("No content blocks found; created an empty document.");
    }

    const document = buildDocument(mergedBlocks, title);
    const now = new Date().toISOString();
    const payload = {
      version: LEDOC_BUNDLE_VERSION,
      content: document,
      meta: {
        version: LEDOC_BUNDLE_VERSION,
        title,
        authors: [],
        created: now,
        lastModified: now,
        sourceFormat: "bundle"
      },
      layout: {
        version: LEDOC_BUNDLE_VERSION,
        pageSize: "A4",
        margins: { unit: "cm", top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }
      },
      registry: {
        version: LEDOC_BUNDLE_VERSION,
        footnoteIdState: { counters: { footnote: 0, endnote: 0 } },
        knownFootnotes: []
      }
    };

    let ledocPath: string | undefined;
    try {
      ledocPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.ledoc`);
      await writeLedocBundle(ledocPath, payload as any);
    } catch (error) {
      warnings.push(`Failed to write LEDOC bundle: ${normalizeError(error)}`);
    }

    return { success: true, payload, ledocPath, warnings, title };
  } catch (error) {
    return { success: false, error: normalizeError(error), warnings };
  }
};
