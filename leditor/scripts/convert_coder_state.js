#!/usr/bin/env node
/**
 * Convert coder_state.json (version 2) into a LEDOC v2 bundle directory (`*.ledoc/`).
 *
 * Usage:
 *   node scripts/convert_coder_state.js [sourcePath] [targetPath]
 *
 * Defaults:
 *   sourcePath: ./coder_state.json
 *   targetPath: ./coder_state.ledoc   (directory)
 */

const fs = require("fs");
const path = require("path");
const sanitizeHtml = require("sanitize-html");
const { parseDocument } = require("htmlparser2");

const LEDOC_BUNDLE_VERSION = "2.0";
const LEDOC_BUNDLE_FILES = {
  version: "version.txt",
  content: "content.json",
  layout: "layout.json",
  registry: "registry.json",
  meta: "meta.json",
  mediaDir: "media"
};

const normalizeError = (error) => (error instanceof Error ? error.message : String(error));

const decodeEntities = (value) =>
  String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const parseHtmlTree = (html) => {
  const doc = parseDocument(html, {
    lowerCaseTags: true,
    lowerCaseAttributeNames: true,
    decodeEntities: true
  });
  return Array.isArray(doc.children) ? doc.children : [];
};

const extractFirstHtml = (state) => {
  const pick = (node) => {
    if (!node || typeof node !== "object") return null;
    const candidates = [];
    if (typeof node.edited_html === "string") candidates.push(node.edited_html);
    if (typeof node.editedHtml === "string") candidates.push(node.editedHtml);
    if (typeof node.payload?.html === "string") candidates.push(node.payload.html);
    const html = candidates.find((value) => typeof value === "string" && value.trim().length > 0) || null;
    if (html) return html;
    const collections = [node.nodes, node.children];
    for (const col of collections) {
      if (!Array.isArray(col)) continue;
      for (const child of col) {
        const found = pick(child);
        if (found) return found;
      }
    }
    return null;
  };
  return pick(state);
};

const extractTitle = (state, fallback) => {
  const pick = (node) => {
    if (!node || typeof node !== "object") return null;
    if (typeof node.name === "string" && node.name.trim()) return node.name.trim();
    const collections = [node.nodes, node.children];
    for (const col of collections) {
      if (!Array.isArray(col)) continue;
      for (const child of col) {
        const found = pick(child);
        if (found) return found;
      }
    }
    return null;
  };
  return pick(state) || fallback;
};

const sanitizeForParsing = (html) =>
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
    textFilter: (text) => decodeEntities(text),
    allowedSchemes: [...sanitizeHtml.defaults.allowedSchemes, "dq"]
  });

const hasStyle = (style, needle) => (typeof style === "string" ? style.toLowerCase().includes(needle) : false);

const parseFontWeight = (style) => {
  if (typeof style !== "string") return null;
  const match = style.match(/font-weight\s*:\s*([^;]+)/i);
  if (!match) return null;
  const raw = match[1].trim().toLowerCase();
  if (!raw) return null;
  if (raw === "bold" || raw === "bolder") return 700;
  if (raw === "normal" || raw === "lighter") return 400;
  const num = Number.parseInt(raw, 10);
  return Number.isFinite(num) ? num : null;
};

const inlineHasText = (content) =>
  Array.isArray(content) &&
  content.some((node) => node?.type === "text" && typeof node.text === "string" && node.text.trim().length > 0);

let DEFAULT_LINE_HEIGHT = null;

const normalizeLineHeightValue = (value) => {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^(normal|inherit|initial|unset)$/i.test(raw)) return null;
  const percent = raw.match(/^(\d+(?:\.\d+)?)%$/);
  if (percent) {
    const num = Number.parseFloat(percent[1]);
    if (Number.isFinite(num) && num > 0) return String(num / 100);
  }
  const numeric = raw.match(/^(\d+(?:\.\d+)?)$/);
  if (numeric) return numeric[1];
  const unit = raw.match(/^(\d+(?:\.\d+)?)(px|pt|em|rem)$/i);
  if (unit) return `${unit[1]}${unit[2].toLowerCase()}`;
  return null;
};

const extractDefaultLineHeight = (html) => {
  if (typeof html !== "string" || !html.trim()) return null;
  const styleMatch = html.match(/p\s*\{[^}]*line-height\s*:\s*([^;}\n]+)[;}\n]/i);
  if (styleMatch) return normalizeLineHeightValue(styleMatch[1]);
  const inlineMatch = html.match(/line-height\s*:\s*([^;\"']+)/i);
  if (inlineMatch) return normalizeLineHeightValue(inlineMatch[1]);
  return null;
};

const paragraphAttrs = () => ({
  dir: null,
  indentLeftCm: 0,
  indentLevel: 0,
  indentRight: 0,
  indentRightCm: 0,
  lineHeight: DEFAULT_LINE_HEIGHT,
  spaceAfter: 0,
  spaceAfterPt: 0,
  spaceBefore: 0,
  spaceBeforePt: 0,
  textAlign: null
});

const stripAnchorMarks = (marks) => (marks || []).filter((mark) => mark?.type !== "anchor");

const normalizeInlineText = (value) => {
  let text = String(value ?? "");
  if (!text) return "";
  text = text.replace(/\s+/g, " ");
  // Collapse duplicated citation parentheses like "((Smith, 2020))".
  text = text.replace(/\(\s*\(/g, "(").replace(/\)\s*\)/g, ")");
  return text;
};

const pushTextNode = (out, text, marks) => {
  let normalized = normalizeInlineText(text);
  if (!normalized) return;
  const last = out[out.length - 1];
  const currentHasAnchor = Array.isArray(marks) && marks.some((mark) => mark?.type === "anchor");
  const lastHasAnchor =
    last &&
    last.type === "text" &&
    Array.isArray(last.marks) &&
    last.marks.some((mark) => mark?.type === "anchor");
  if (last && last.type === "text" && !currentHasAnchor && !lastHasAnchor) {
    const lastText = String(last.text ?? "");
    if (/\(\s*$/.test(lastText) && /^\s*\(/.test(normalized)) {
      normalized = normalized.replace(/^\s*\(/, "");
    }
    if (/\)\s*$/.test(lastText) && /^\s*\)/.test(normalized)) {
      normalized = normalized.replace(/^\s*\)/, "");
    }
  }
  if (!normalized) return;
  out.push({ type: "text", text: normalized, marks: marks && marks.length ? marks : undefined });
};

const normalizeInlineContent = (content) => {
  const out = [];
  const hasAnchorMark = (node) =>
    node?.type === "text" && Array.isArray(node.marks) && node.marks.some((mark) => mark?.type === "anchor");
  for (const node of content || []) {
    if (!node || typeof node !== "object") continue;
    if (node.type !== "text") {
      out.push(node);
      continue;
    }
    const marks = node.marks || undefined;
    let text = normalizeInlineText(node.text ?? "");
    if (!text) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.type === "text" &&
      hasAnchorMark(last) &&
      hasAnchorMark(node) &&
      !/\s$/.test(last.text || "")
    ) {
      out.push({ type: "text", text: " ", marks: undefined });
    }
    if (last && last.type === "text" && !hasAnchorMark(last) && !hasAnchorMark(node)) {
      const lastText = String(last.text || "");
      if (/\(\s*$/.test(lastText) && /^\s*\(/.test(text)) {
        text = text.replace(/^\s*\(/, "");
      }
      if (/\)\s*$/.test(lastText) && /^\s*\)/.test(text)) {
        text = text.replace(/^\s*\)/, "");
      }
      if (!text) continue;
    }
    if (last && last.type === "text" && JSON.stringify(last.marks || []) === JSON.stringify(marks || [])) {
      const merged = `${last.text || ""}${text}`;
      last.text = normalizeInlineText(merged);
      continue;
    }
    out.push({ type: "text", text, marks });
  }
  // Remove duplicated parentheses across adjacent text nodes (often produced by anchor boundaries).
  for (let i = 1; i < out.length; i += 1) {
    const prev = out[i - 1];
    const curr = out[i];
    if (prev?.type !== "text" || curr?.type !== "text") continue;
    if (hasAnchorMark(prev) || hasAnchorMark(curr)) continue;
    const prevText = String(prev.text || "");
    let currText = String(curr.text || "");
    if (/\(\s*$/.test(prevText) && /^\s*\(/.test(currText)) {
      currText = currText.replace(/^\s*\(/, "");
    }
    if (/\)\s*$/.test(prevText) && /^\s*\)/.test(currText)) {
      currText = currText.replace(/^\s*\)/, "");
    }
    curr.text = currText;
  }
  // If parentheses sit outside a citation anchor, prefer keeping them inside the anchor text.
  for (let i = 1; i < out.length; i += 1) {
    const prev = out[i - 1];
    const curr = out[i];
    if (prev?.type !== "text" || curr?.type !== "text") continue;
    const prevHasAnchor = hasAnchorMark(prev);
    const currHasAnchor = hasAnchorMark(curr);
    const prevText = String(prev.text || "");
    const currText = String(curr.text || "");
    if (!prevHasAnchor && currHasAnchor && /\(\s*$/.test(prevText) && /^\s*\(/.test(currText)) {
      prev.text = prevText.replace(/\(\s*$/, "");
    }
    if (prevHasAnchor && !currHasAnchor && /\)\s*$/.test(prevText) && /^\s*\)/.test(currText)) {
      curr.text = currText.replace(/^\s*\)/, "");
    }
  }
  // Drop any empty text nodes created by stripping duplicates.
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const node = out[i];
    if (node?.type === "text" && !String(node.text || "").trim()) {
      out.splice(i, 1);
    }
  }
  // Trim leading/trailing spaces without removing meaningful content.
  while (out.length && out[0].type === "text" && /^\s*$/.test(out[0].text || "")) {
    out.shift();
  }
  while (out.length && out[out.length - 1].type === "text" && /^\s*$/.test(out[out.length - 1].text || "")) {
    out.pop();
  }
  return out;
};

const inlineFromNodes = (nodes, activeMarks = []) => {
  const out = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = normalizeInlineText(node.data || "");
      const anchorMark = activeMarks.find((mark) => mark?.type === "anchor");
      const hasAnchor = Boolean(anchorMark);
      const isCitationAnchor = Boolean(
        anchorMark &&
          (anchorMark.attrs?.dataQuoteId ||
            anchorMark.attrs?.dataDqid ||
            String(anchorMark.attrs?.href || "").startsWith("dq://"))
      );
      if (text.trim().length === 0) {
        pushTextNode(out, " ", stripAnchorMarks(activeMarks));
        continue;
      }
      if (hasAnchor) {
        const leading = text.match(/^\s+/)?.[0] ?? "";
        const trailing = text.match(/\s+$/)?.[0] ?? "";
        let core = text.trim();
        if (isCitationAnchor && core && !core.startsWith("(") && !core.endsWith(")")) {
          core = `(${core})`;
        }
        if (leading) pushTextNode(out, " ", stripAnchorMarks(activeMarks));
        if (core) pushTextNode(out, core, activeMarks);
        if (trailing) pushTextNode(out, " ", stripAnchorMarks(activeMarks));
      } else {
        pushTextNode(out, text, activeMarks);
      }
      continue;
    }
    const tag = (node.name || "").toLowerCase();
    const attrs = node.attribs || {};
    const nextMarks = [...activeMarks];
    const fontWeight = parseFontWeight(attrs.style);
    if (tag === "strong" || tag === "b" || (fontWeight != null && fontWeight >= 600)) {
      nextMarks.push({ type: "bold" });
    }
    if (tag === "em" || tag === "i" || hasStyle(attrs.style, "font-style")) nextMarks.push({ type: "italic" });
    if (tag === "u" || hasStyle(attrs.style, "text-decoration: underline")) nextMarks.push({ type: "underline" });
    if (tag === "s" || tag === "strike") nextMarks.push({ type: "strikethrough" });
    if (tag === "sup") nextMarks.push({ type: "superscript" });
    if (tag === "sub") nextMarks.push({ type: "subscript" });
    if (tag === "a") {
      const fallbackHref =
        attrs.href ||
        attrs["data-orig-href"] ||
        (attrs["data-dqid"] ? `dq://${attrs["data-dqid"]}` : null) ||
        attrs["data-key"] ||
        null;
      const markAttrs = {
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
    out.push(...inlineFromNodes(node.children || [], nextMarks));
  }
  return out;
};

const blockFromElement = (el) => {
  if (el.type !== "tag") return null;
  const tag = (el.name || "").toLowerCase();
  const inline = () => inlineFromNodes(el.children || []);
  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag.slice(1), 10) || 1;
    const content = normalizeInlineContent(inline());
    if (!inlineHasText(content)) return null;
    return {
      type: "heading",
      attrs: DEFAULT_LINE_HEIGHT ? { level, lineHeight: DEFAULT_LINE_HEIGHT } : { level },
      content
    };
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
    const blocks = [];
    const inlineContent = inline();
    if (inlineContent.length) {
      blocks.push({ type: "paragraph", attrs: paragraphAttrs(), content: inlineContent });
    }
    return { type: "listItem", content: blocks.length ? blocks : [{ type: "paragraph", attrs: paragraphAttrs() }] };
  }
  if (tag === "ul" || tag === "ol") {
    const items = el.children
      .map((child) => blockFromElement(child))
      .filter((n) => n && n.type === "listItem");
    return { type: tag === "ul" ? "bulletList" : "orderedList", content: items };
  }
  const fallback = normalizeInlineContent(inlineFromNodes(el.children || []));
  if (inlineHasText(fallback)) return { type: "paragraph", attrs: paragraphAttrs(), content: fallback };
  return null;
};

const htmlToBlocks = (html) => {
  const sanitized = sanitizeForParsing(html);
  const tree = parseHtmlTree(sanitized);
  const blocks = [];
  let inlineBuffer = [];
  const flushInlineBuffer = () => {
    if (!inlineBuffer.length) return;
    const content = normalizeInlineContent(inlineBuffer);
    inlineBuffer = [];
    if (!inlineHasText(content)) return;
    blocks.push({ type: "paragraph", attrs: paragraphAttrs(), content });
  };
  const walk = (nodes) => {
    for (const n of nodes) {
      if (!n) continue;
      if (n.type === "text") {
        const text = String(n.data || "");
        if (text.trim().length > 0) {
          inlineBuffer.push({ type: "text", text: decodeEntities(text) });
        }
        continue;
      }
      if (n.type === "tag") {
        const tag = (n.name || "").toLowerCase();
        if (tag === "div" || tag === "section" || tag === "article" || tag === "body" || tag === "html") {
          walk(n.children || []);
          continue;
        }
        const block = blockFromElement(n);
        if (block) {
          flushInlineBuffer();
          blocks.push(block);
          continue;
        }
        if (Array.isArray(n.children) && n.children.length > 0) {
          const inline = inlineFromNodes([n]);
          if (inline.length) {
            inlineBuffer.push(...inline);
          } else {
            walk(n.children);
          }
        }
      }
    }
  };
  walk(tree);
  flushInlineBuffer();
  return blocks.length ? blocks : [{ type: "paragraph", attrs: paragraphAttrs(), content: [] }];
};

const readOptionalPackageVersion = () => {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
};

const cmToPx = (cm) => (cm / 2.54) * 96;

const buildDocument = (blocks) => {
  const docAttrs = {
    citationLocale: "en-US",
    citationStyleId: "apa",
    columns: 1,
    columnsMode: "one",
    hyphenation: "none",
    lineNumbering: "none",
    marginsBottomCm: 2.5,
    marginsLeftCm: 2.5,
    marginsRightCm: 2.5,
    marginsTopCm: 2.5,
    orientation: "portrait",
    pageSizeId: "a4"
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

const ensureEmptyDir = (dirPath) => {
  if (fs.existsSync(dirPath)) {
    const st = fs.statSync(dirPath);
    if (st.isFile()) {
      throw new Error(`Target exists and is a file: ${dirPath}`);
    }
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
};

const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
};

const writeText = (filePath, text) => {
  fs.writeFileSync(filePath, text, "utf-8");
};

const writeLedocBundle = ({ targetDir, content, title, created, lastModified }) => {
  ensureEmptyDir(targetDir);
  ensureEmptyDir(path.join(targetDir, LEDOC_BUNDLE_FILES.mediaDir));

  const appVersion = readOptionalPackageVersion();
  const meta = {
    version: LEDOC_BUNDLE_VERSION,
    title: title || "Untitled document",
    authors: [],
    created,
    lastModified,
    appVersion: appVersion || undefined,
    sourceFormat: "bundle"
  };

  const layout = {
    version: LEDOC_BUNDLE_VERSION,
    pageSize: "A4",
    margins: { unit: "cm", top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }
  };

  const registry = {
    version: LEDOC_BUNDLE_VERSION,
    footnoteIdState: { counters: { footnote: 0, endnote: 0 } },
    knownFootnotes: []
  };

  writeText(path.join(targetDir, LEDOC_BUNDLE_FILES.version), `${LEDOC_BUNDLE_VERSION}\n`);
  writeJson(path.join(targetDir, LEDOC_BUNDLE_FILES.content), content);
  writeJson(path.join(targetDir, LEDOC_BUNDLE_FILES.meta), meta);
  writeJson(path.join(targetDir, LEDOC_BUNDLE_FILES.layout), layout);
  writeJson(path.join(targetDir, LEDOC_BUNDLE_FILES.registry), registry);
};

async function main() {
  let sourcePath = path.resolve(process.cwd(), process.argv[2] || "coder_state.json");
  let targetPath = path.resolve(
    process.cwd(),
    process.argv[3] || `${path.basename(sourcePath, path.extname(sourcePath))}.ledoc`
  );

  // If the user passed a directory as the source, look for coder_state.json inside it.
  if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
    const candidate = path.join(sourcePath, "coder_state.json");
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      if (!process.argv[3]) {
        targetPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.ledoc`);
      }
    }
  }

  if (!fs.existsSync(sourcePath)) {
    console.error(`[convert] source not found: ${sourcePath}`);
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(sourcePath, "utf-8");
    const state = JSON.parse(raw);

    const sampleHtml = extractFirstHtml(state);
    DEFAULT_LINE_HEIGHT = extractDefaultLineHeight(sampleHtml);

    const allBlocks = [];
    const title = extractTitle(state, path.basename(sourcePath, path.extname(sourcePath)) || "Document");
    const nodes = Array.isArray(state.nodes) ? state.nodes : [];
    const visited = new Set();

    const visit = (node, depth) => {
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
          attrs: DEFAULT_LINE_HEIGHT ? { level, lineHeight: DEFAULT_LINE_HEIGHT } : { level },
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

    if (allBlocks.length === 0) {
      console.error("[convert] No content blocks found.");
      process.exit(1);
    }

    const document = buildDocument(allBlocks);
    const stamp = new Date().toISOString();
    writeLedocBundle({
      targetDir: targetPath,
      content: document,
      title,
      created: stamp,
      lastModified: stamp
    });
    console.log(`[convert] wrote bundle ${targetPath}`);
  } catch (error) {
    console.error("[convert] failed:", normalizeError(error));
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
