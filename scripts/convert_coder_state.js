#!/usr/bin/env node
/**
 * Convert coder_state.json (version 2) into a LEDOC archive.
 *
 * Usage:
 *   node scripts/convert_coder_state.js [sourcePath] [targetPath]
 *
 * Defaults:
 *   sourcePath: ./coder_state.json
 *   targetPath: ./coder_state.ledoc
 */

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const sanitizeHtml = require("sanitize-html");

const LEDOC_FORMAT_VERSION = "1.0";
const LEDOC_PATHS = {
  document: "document.json",
  footnotes: "footnotes.json",
  meta: "meta.json",
  settings: "settings.json",
  styles: "styles.json",
  history: "history.json",
  mediaDir: "media",
  preview: "preview.png"
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

const extractFirstHtml = (state) => {
  const pick = (node) => {
    if (!node || typeof node !== "object") return null;
    const html =
      typeof node.edited_html === "string"
        ? node.edited_html
        : typeof node.editedHtml === "string"
          ? node.editedHtml
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

const htmlToParagraphs = (html) => {
  const withBreaks = html
    .replace(/<\/(p|div|section|article|h[1-6])>/gi, "</$1>\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(ul|ol|li)>/gi, "</$1>\n");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .split(/\n+/)
    .map((line) => decodeEntities(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);
};

const cmToPx = (cm) => (cm / 2.54) * 96;

const buildDocument = (paragraphs) => {
  const paragraphAttrs = {
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
  };
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
  const pageContent =
    paragraphs.length > 0
      ? paragraphs.map((text) => ({
          type: "paragraph",
          attrs: { ...paragraphAttrs },
          content: [{ type: "text", text }]
        }))
      : [
          {
            type: "paragraph",
            attrs: { ...paragraphAttrs },
            content: []
          }
        ];
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

const packLedocZip = async (payload) => {
  const zip = new JSZip();
  zip.file(LEDOC_PATHS.document, JSON.stringify(payload.document ?? {}, null, 2));
  zip.file(LEDOC_PATHS.meta, JSON.stringify(payload.meta ?? {}, null, 2));
  if (payload.settings) {
    zip.file(LEDOC_PATHS.settings, JSON.stringify(payload.settings, null, 2));
  }
  if (payload.footnotes) {
    zip.file(LEDOC_PATHS.footnotes, JSON.stringify(payload.footnotes, null, 2));
  }
  if (payload.styles !== undefined) {
    zip.file(LEDOC_PATHS.styles, JSON.stringify(payload.styles, null, 2));
  }
  if (payload.history !== undefined) {
    zip.file(LEDOC_PATHS.history, JSON.stringify(payload.history, null, 2));
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer;
};

async function main() {
  const sourcePath = path.resolve(process.cwd(), process.argv[2] || "coder_state.json");
  const targetPath = path.resolve(
    process.cwd(),
    process.argv[3] || `${path.basename(sourcePath, path.extname(sourcePath))}.ledoc`
  );

  if (!fs.existsSync(sourcePath)) {
    console.error(`[convert] source not found: ${sourcePath}`);
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(sourcePath, "utf-8");
    const parsed = JSON.parse(raw);
    const html = extractFirstHtml(parsed);
    if (!html || !html.trim()) {
      console.error("[convert] No edited_html found in coder_state.");
      process.exit(1);
    }
    const title = extractTitle(parsed, path.basename(sourcePath, path.extname(sourcePath)) || "Document");
    const paragraphs = htmlToParagraphs(html);
    const document = buildDocument(paragraphs);
    const stamp = new Date().toISOString();
    const marginsPx = cmToPx(2.5);
    const payload = {
      document,
      meta: {
        version: LEDOC_FORMAT_VERSION,
        title,
        authors: [],
        created: stamp,
        lastModified: stamp
      },
      settings: {
        pageSize: "a4",
        margins: {
          top: marginsPx,
          right: marginsPx,
          bottom: marginsPx,
          left: marginsPx,
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

    const buffer = await packLedocZip(payload);
    fs.writeFileSync(targetPath, buffer);
    console.log(`[convert] wrote ${targetPath} (${buffer.length} bytes)`);
  } catch (error) {
    console.error("[convert] failed:", normalizeError(error));
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
