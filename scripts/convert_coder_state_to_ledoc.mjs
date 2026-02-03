#!/usr/bin/env node
// Converts a coder_state.json (Annotarium) export into a minimal LEDOC v2 bundle directory (`*.ledoc/`).
// Usage: node scripts/convert_coder_state_to_ledoc.mjs <path-to-coder_state.json> [output.ledoc]

import fs from "fs";
import path from "path";

const inputPath = process.argv[2] || "coder_state.json";
const outputPath =
  process.argv[3] ||
  path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}.ledoc`
  );

if (!fs.existsSync(inputPath)) {
  console.error(`[convert_coder_state_to_ledoc] Input not found: ${inputPath}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
if (!nodes.length || typeof nodes[0]?.edited_html !== "string") {
  console.error("[convert_coder_state_to_ledoc] No edited_html found in nodes[0]");
  process.exit(1);
}

const title = nodes[0]?.name || "Imported coder_state";
const updated = nodes[0]?.updated_utc || new Date().toISOString();
const html = nodes[0].edited_html;

const LEDOC_BUNDLE_VERSION = "2.0";

// Very lightweight HTML → text for inclusion. We keep links’ visible text.
const textFromHtml = (markup) => {
  // replace <br> with newline
  let s = markup.replace(/<br\s*\/?>/gi, "\n");
  // strip tags but keep inner text
  s = s.replace(/<[^>]+>/g, " ");
  // decode a few basic entities
  const entities = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  Object.entries(entities).forEach(([k, v]) => {
    s = s.split(k).join(v);
  });
  // collapse whitespace
  return s.replace(/\s+/g, " ").trim();
};

const text = textFromHtml(html) || "(empty document)";

const paragraph = {
  type: "paragraph",
  attrs: {
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
  },
  content: [{ type: "text", text }]
};

const page = { type: "page", content: [paragraph] };

const documentJson = {
  type: "doc",
  attrs: {
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
  },
  content: [page]
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

ensureEmptyDir(outputPath);
ensureEmptyDir(path.join(outputPath, "media"));

const meta = {
  version: LEDOC_BUNDLE_VERSION,
  title,
  authors: [],
  created: updated,
  lastModified: updated,
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

fs.writeFileSync(path.join(outputPath, "version.txt"), `${LEDOC_BUNDLE_VERSION}\n`, "utf-8");
writeJson(path.join(outputPath, "content.json"), documentJson);
writeJson(path.join(outputPath, "meta.json"), meta);
writeJson(path.join(outputPath, "layout.json"), layout);
writeJson(path.join(outputPath, "registry.json"), registry);

console.log(`[convert_coder_state_to_ledoc] wrote bundle ${outputPath}`);
console.log(`Title: ${title}`);
