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

// --- Tiny HTML -> tree parser (no external deps) ---
const tokenizeHtml = (html) => {
  const tokens = [];
  const tagRe = /<\/?[^>]+?>/g;
  let lastIndex = 0;
  let match;
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
  const root = { type: "element", tag: "root", attrs: {}, children: [] };
  const stack = [root];
  const parseAttrs = (rawAttrs) => {
    const out = {};
    if (!rawAttrs) return out;
    const attrRe = /([^\s=]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(rawAttrs)) !== null) {
      out[m[1]] = m[2];
    }
    return out;
  };
  for (const tok of tokens) {
    if (tok.type === "text") {
      stack[stack.length - 1].children.push({ type: "text", value: tok.raw });
      continue;
    }
    const tag = tok.name || "";
    if (tok.closing) {
      while (stack.length > 1) {
        const popped = stack.pop();
        if (popped && popped.tag === tag) break;
      }
      continue;
    }
    const node = { type: "element", tag, attrs: parseAttrs(tok.attrs), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!tok.selfClosing && tag !== "br") stack.push(node);
  }
  return root.children;
};

const extractFirstHtml = (state) => {
  const pick = (node) => {
    if (!node || typeof node !== "object") return null;
    const html =
      typeof node.edited_html === "string"
        ? node.edited_html
        : typeof node.editedHtml === "string"
          ? node.editedHtml
          : typeof node.payload?.html === "string"
            ? node.payload.html
            : null;
    if (html && html.trim()) return html;
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

const inlineFromNodes = (nodes, activeMarks = []) => {
  const out = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = node.value.replace(/\s+/g, " ");
      if (text.trim().length === 0) continue;
      out.push({ type: "text", text, marks: activeMarks.length ? activeMarks : undefined });
      continue;
    }
    const tag = node.tag.toLowerCase();
    const attrs = node.attrs || {};
    const nextMarks = [...activeMarks];
    if (tag === "strong" || tag === "b" || hasStyle(attrs.style, "font-weight")) nextMarks.push({ type: "bold" });
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
    out.push(...inlineFromNodes(node.children, nextMarks));
  }
  return out;
};

const blockFromElement = (el) => {
  if (el.type !== "element") return null;
  const tag = el.tag.toLowerCase();
  const inline = () => inlineFromNodes(el.children);
  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag.slice(1), 10) || 1;
    return { type: "heading", attrs: { level }, content: inline() };
  }
  if (["p", "div", "section", "article"].includes(tag)) {
    const content = inline();
    return { type: "paragraph", attrs: paragraphAttrs(), content: content.length ? content : undefined };
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
  if (tag === "span") {
    const content = inlineFromNodes([el]);
    if (!content.length) return null;
    return { type: "paragraph", attrs: paragraphAttrs(), content };
  }
  const fallback = inlineFromNodes(el.children);
  if (fallback.length) return { type: "paragraph", attrs: paragraphAttrs(), content: fallback };
  return null;
};

const htmlToBlocks = (html) => {
  const sanitized = sanitizeForParsing(html);
  const tree = tokenizeHtml(sanitized);
  const blocks = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === "text") {
        const text = n.value.trim();
        if (text) {
          blocks.push({ type: "paragraph", attrs: paragraphAttrs(), content: [{ type: "text", text }] });
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

    const allBlocks = [];
    const title = extractTitle(state, path.basename(sourcePath, path.extname(sourcePath)) || "Document");
    const nodes = Array.isArray(state.nodes) ? state.nodes : [];

    const visit = (node, depth) => {
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
