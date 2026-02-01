import fs from "fs";
import path from "path";
import sanitizeHtml from "sanitize-html";
import { LEDOC_FORMAT_VERSION, packLedocZip } from "./ledoc";

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
    const attrRe = /([^\s=]+)\s*=\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(rawAttrs)) !== null) {
      out[m[1]] = m[2];
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

const extractFirstHtml = (state: any): string | null => {
  if (!state || typeof state !== "object") return null;
  const pick = (node: any): string | null => {
    if (!node || typeof node !== "object") return null;
    const html =
      typeof node.edited_html === "string"
        ? node.edited_html
        : typeof node.editedHtml === "string"
          ? node.editedHtml
          : typeof node.payload?.html === "string"
            ? node.payload.html
            : null;
    if (html && html.trim().length > 0) return html;
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
      const fallbackHref =
        attrs.href ??
        attrs["data-orig-href"] ??
        (attrs["data-dqid"] ? `dq://${attrs["data-dqid"]}` : null) ??
        attrs["data-key"] ??
        null;
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
      out.push({ type: "hardBreak" });
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
    return { type: "heading", attrs: { level }, content: inline() };
  }
  if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
    const content = inline();
    return { type: "paragraph", attrs: paragraphAttrs(), content: content.length ? content : undefined };
  }
  if (tag === "li") {
    const blocks: PMNode[] = [];
    let pendingInline = inlineFromNodes(element.children);
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
    const content = inlineFromNodes([el]);
    if (!content.length) return null;
    return { type: "paragraph", attrs: paragraphAttrs(), content };
  }
  // Unknown: flatten children as inline into a paragraph.
  const fallback = inlineFromNodes(el.children);
  if (fallback.length) {
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
  const walk = (nodes: HtmlNode[]) => {
    for (const n of nodes) {
      if (n.type === "text") {
        const text = n.value.trim();
        if (text) {
          blocks.push({
            type: "paragraph",
            attrs: paragraphAttrs(),
            content: [{ type: "text", text }]
          });
        }
        continue;
      }
      const block = blockFromElement(n);
      if (block) blocks.push(block);
    }
  };
  walk(tree);
  return blocks.length ? blocks : [{ type: "paragraph", attrs: paragraphAttrs(), content: [] }];
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

    const visit = (node: any, depth: number) => {
      if (!node || typeof node !== "object") return;
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
        const html = extractFirstHtml(node);
        if (html) {
          allBlocks.push(...htmlToBlocks(html));
        }
      }
      const children = Array.isArray(node.children) ? node.children : [];
      const nested = Array.isArray(node.nodes) ? node.nodes : [];
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

    if (allBlocks.length === 0) {
      warnings.push("No content blocks found; created an empty document.");
    }

    const document = buildDocument(allBlocks, title);
    const now = new Date().toISOString();
    const payload = {
      document,
      meta: {
        version: LEDOC_FORMAT_VERSION,
        title,
        authors: [],
        created: now,
        lastModified: now
      },
      settings: {
        version: LEDOC_FORMAT_VERSION,
        pageSize: "a4",
        margins: {
          top: 2.5 * (96 / 2.54),
          right: 2.5 * (96 / 2.54),
          bottom: 2.5 * (96 / 2.54),
          left: 2.5 * (96 / 2.54),
          topCm: 2.5,
          rightCm: 2.5,
          bottomCm: 2.5,
          leftCm: 2.5
        }
      },
      footnotes: {
        version: LEDOC_FORMAT_VERSION,
        footnotes: []
      }
    };

    let ledocPath: string | undefined;
    try {
      const buffer = await packLedocZip(payload);
      ledocPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.ledoc`);
      await fs.promises.writeFile(ledocPath, buffer);
    } catch (error) {
      warnings.push(`Failed to write LEDOC archive: ${normalizeError(error)}`);
    }

    return { success: true, payload, ledocPath, warnings, title };
  } catch (error) {
    return { success: false, error: normalizeError(error), warnings };
  }
};
