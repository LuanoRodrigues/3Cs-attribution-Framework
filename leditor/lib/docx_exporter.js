const {
  AlignmentType,
  HeadingLevel,
  LineRuleType,
  PageOrientation,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Bookmark,
  InternalHyperlink,
  ExternalHyperlink,
  FootnoteReferenceRun,
  Document,
  UnderlineType
} = require("docx");
const JSZip = require("jszip");

const TWIPS_PER_INCH = 1440;
const MILLIMETERS_PER_INCH = 25.4;
const TWIPS_PER_POINT = 20;
const DEFAULT_PAGE_SIZE = { widthMm: 210, heightMm: 297 };
const DEFAULT_MARGINS = { top: "1in", right: "1in", bottom: "1in", left: "1in" };
const DEFAULT_PARAGRAPH_LINE_HEIGHT = 1.5;
const DEFAULT_PARAGRAPH_SPACE_AFTER_PT = 12;

const parseLengthToTwips = (value, fallbackInches = 1) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^([\d.]+)\s*(mm|cm|in|pt|px)?$/i);
    if (match) {
      const numeric = Number(match[1]);
      if (Number.isFinite(numeric)) {
        const unit = (match[2] || "mm").toLowerCase();
        switch (unit) {
          case "mm":
            return Math.round((numeric / MILLIMETERS_PER_INCH) * TWIPS_PER_INCH);
          case "cm":
            return Math.round(((numeric * 10) / MILLIMETERS_PER_INCH) * TWIPS_PER_INCH);
          case "in":
            return Math.round(numeric * TWIPS_PER_INCH);
          case "pt":
            return Math.round((numeric / 72) * TWIPS_PER_INCH);
          case "px":
            return Math.round((numeric / 96) * TWIPS_PER_INCH);
          default:
        }
      }
    }
  }
  return Math.round(fallbackInches * TWIPS_PER_INCH);
};

const mmToTwips = (millimeters) => Math.round((millimeters / MILLIMETERS_PER_INCH) * TWIPS_PER_INCH);
const cmToTwips = (centimeters) => Math.round((centimeters / 2.54) * TWIPS_PER_INCH);
const ptToTwips = (points) => Math.round(points * TWIPS_PER_POINT);
const pxToTwips = (pixels) => Math.round((pixels / 96) * TWIPS_PER_INCH);

const ALIGNMENT_MAP = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED
};

const HEADING_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6
};

const normalizeColor = (value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.replace("#", "").trim() || undefined;
};

const parseFontSize = (value) => {
  if (!value) {
    return undefined;
  }
  const raw = String(value).trim();
  const numeric = Number(raw.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  let points = numeric;
  if (raw.endsWith("px")) {
    points = numeric * 0.75;
  } else if (raw.endsWith("pt")) {
    points = numeric;
  }
  return Math.round(points * 2);
};

const sanitizeBookmarkId = (raw) => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  let safe = trimmed.replace(/[^A-Za-z0-9_]+/g, "_");
  if (!/^[A-Za-z]/.test(safe)) {
    safe = `bm_${safe}`;
  }
  return safe.slice(0, 64);
};

const parseLineHeight = (value) => {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === "single") return { line: 240, lineRule: LineRuleType.AUTO };
  if (raw === "double") return { line: 480, lineRule: LineRuleType.AUTO };
  const numeric = Number(raw.replace(/[^\d.]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) {
    if (/(px|pt|cm|mm|in)$/.test(raw)) {
      const twips = parseLengthToTwips(raw, 0);
      return twips > 0 ? { line: twips, lineRule: LineRuleType.EXACT } : null;
    }
    return { line: Math.round(240 * numeric), lineRule: LineRuleType.AUTO };
  }
  return null;
};

const escapeXmlAttr = (value) =>
  String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

const parseRelationshipTargets = (relsXml) => {
  const rels = new Map();
  if (typeof relsXml !== "string") return rels;
  const tagRe = /<Relationship\b[^>]*\/>/g;
  let match;
  while ((match = tagRe.exec(relsXml))) {
    const tag = match[0];
    const attrs = {};
    tag.replace(/([A-Za-z0-9:]+)="([^"]*)"/g, (_m, key, value) => {
      attrs[key] = value;
      return "";
    });
    if (!attrs.Id || !attrs.Target) continue;
    if (!String(attrs.Type || "").includes("/hyperlink")) continue;
    rels.set(String(attrs.Id), {
      target: String(attrs.Target),
      mode: String(attrs.TargetMode || "")
    });
  }
  return rels;
};

const extractLeditorMetaFromHref = (href) => {
  if (!href || typeof href !== "string") return null;
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0) return null;
  const fragment = href.slice(hashIndex + 1);
  if (!fragment) return null;
  const parts = fragment.split("&").filter(Boolean);
  const metaPart = parts.find((part) => part.startsWith("leditor="));
  if (!metaPart) return null;
  const encoded = metaPart.slice("leditor=".length);
  if (!encoded) return null;
  try {
    const decoded = decodeURIComponent(encoded);
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return null;
  }
  return null;
};

const buildTooltipText = (meta) => {
  if (!meta || typeof meta !== "object") return "";
  const raw = meta.title || meta.dataQuoteText || "";
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  return text;
};

const applyHyperlinkTooltips = async (buffer) => {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const relsFile = zip.file("word/_rels/document.xml.rels");
    const docFile = zip.file("word/document.xml");
    if (!relsFile || !docFile) return buffer;
    const [relsXml, docXml] = await Promise.all([relsFile.async("string"), docFile.async("string")]);
    const rels = parseRelationshipTargets(relsXml);
    if (rels.size === 0) return buffer;
    let changed = false;
    const updatedDocXml = docXml.replace(/<w:hyperlink\b[^>]*>/g, (tag) => {
      if (tag.includes("w:tooltip=")) return tag;
      const idMatch = tag.match(/r:id="([^"]+)"/);
      if (!idMatch) return tag;
      const rel = rels.get(idMatch[1]);
      if (!rel || !rel.target) return tag;
      const meta = extractLeditorMetaFromHref(rel.target);
      const tooltip = buildTooltipText(meta);
      if (!tooltip) return tag;
      changed = true;
      return tag.replace(/<w:hyperlink\b/, `<w:hyperlink w:tooltip="${escapeXmlAttr(tooltip)}"`);
    });
    if (!changed) return buffer;
    zip.file("word/document.xml", updatedDocXml);
    return await zip.generateAsync({ type: "nodebuffer" });
  } catch {
    return buffer;
  }
};

const resolveParagraphSpacing = (attrs) => {
  const spacing = {};
  const beforePt = Number(attrs?.spaceBeforePt);
  const afterPt = Number(attrs?.spaceAfterPt);
  const beforePx = Number(attrs?.spaceBefore);
  const afterPx = Number(attrs?.spaceAfter);
  let hasBeforeAfter = false;
  if (Number.isFinite(beforePt) && beforePt > 0) {
    spacing.before = ptToTwips(beforePt);
    hasBeforeAfter = true;
  } else if (Number.isFinite(beforePx) && beforePx > 0) {
    spacing.before = pxToTwips(beforePx);
    hasBeforeAfter = true;
  }
  if (Number.isFinite(afterPt) && afterPt > 0) {
    spacing.after = ptToTwips(afterPt);
    hasBeforeAfter = true;
  } else if (Number.isFinite(afterPx) && afterPx > 0) {
    spacing.after = pxToTwips(afterPx);
    hasBeforeAfter = true;
  }
  const line = parseLineHeight(attrs?.lineHeight);
  if (line) {
    spacing.line = line.line;
    spacing.lineRule = line.lineRule;
  } else if (Number.isFinite(DEFAULT_PARAGRAPH_LINE_HEIGHT) && DEFAULT_PARAGRAPH_LINE_HEIGHT > 0) {
    spacing.line = Math.round(240 * DEFAULT_PARAGRAPH_LINE_HEIGHT);
    spacing.lineRule = LineRuleType.AUTO;
  }
  if (!hasBeforeAfter && Number.isFinite(DEFAULT_PARAGRAPH_SPACE_AFTER_PT) && DEFAULT_PARAGRAPH_SPACE_AFTER_PT > 0) {
    spacing.after = ptToTwips(DEFAULT_PARAGRAPH_SPACE_AFTER_PT);
  }
  return Object.keys(spacing).length > 0 ? spacing : null;
};

const resolveParagraphIndent = (attrs) => {
  const leftCm = Number(attrs?.indentLeftCm);
  const rightCm = Number(attrs?.indentRightCm);
  const indent = {};
  if (Number.isFinite(leftCm) && leftCm !== 0) indent.left = cmToTwips(leftCm);
  if (Number.isFinite(rightCm) && rightCm !== 0) indent.right = cmToTwips(rightCm);
  return Object.keys(indent).length > 0 ? indent : null;
};

const firstNonWhitespaceChar = (content) => {
  for (const child of content || []) {
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    const match = text.match(/[^\s\u00A0\u2000-\u200B]/);
    if (match) return match[0];
  }
  return null;
};

const lastNonWhitespaceChar = (content) => {
  for (let i = (content || []).length - 1; i >= 0; i -= 1) {
    const child = content[i];
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    const match = text.match(/[^\s\u00A0\u2000-\u200B](?!.*[^\s\u00A0\u2000-\u200B])/);
    if (match) return match[0];
  }
  return null;
};

const startsWithWhitespace = (content) => {
  for (const child of content || []) {
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    return /^[\s\u00A0\u2000-\u200B]/.test(text);
  }
  return false;
};

const endsWithSpace = (content) => {
  for (let i = (content || []).length - 1; i >= 0; i -= 1) {
    const child = content[i];
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    if (!text) continue;
    return /\s$/.test(text);
  }
  return false;
};

const trimLeadingWhitespace = (content) => {
  const out = [...(content || [])];
  for (let i = 0; i < out.length; i += 1) {
    const child = out[i];
    if (child?.type !== "text") continue;
    const text = String(child.text ?? "");
    const trimmed = text.replace(/^[\s\u00A0\u2000-\u200B]+/, "");
    if (!trimmed) {
      out.splice(i, 1);
      i -= 1;
      continue;
    }
    if (trimmed !== text) {
      out[i] = { ...child, text: trimmed };
    }
    break;
  }
  return out;
};

const isEmptyParagraphBlock = (block) => {
  if (!block || block.type !== "paragraph") return false;
  const content = Array.isArray(block.content) ? block.content : [];
  if (content.length === 0) return true;
  for (const child of content) {
    if (!child) continue;
    if (child.type === "text") {
      if (String(child.text ?? "").trim().length > 0) return false;
      continue;
    }
    if (child.type === "anchorMarker") continue;
    return false;
  }
  return true;
};

const normalizeContinuationParagraphs = (doc) => {
  if (!doc || typeof doc !== "object") return doc;
  if (!Array.isArray(doc.content)) return doc;
  let changed = false;
  for (const node of doc.content) {
    if (!node || node.type !== "page" || !Array.isArray(node.content)) continue;
    const merged = [];
    let pendingEmpty = [];
    for (const block of node.content) {
      if (block?.type === "paragraph" && isEmptyParagraphBlock(block)) {
        pendingEmpty.push(block);
        continue;
      }
      if (block?.type === "paragraph" && merged.length) {
        const prev = merged[merged.length - 1];
        if (prev?.type === "paragraph") {
          const prevContent = Array.isArray(prev.content) ? prev.content : [];
          const currContent = Array.isArray(block.content) ? block.content : [];
          const first = firstNonWhitespaceChar(currContent);
          const last = lastNonWhitespaceChar(prevContent);
          const startsLower = typeof first === "string" && /[a-z]/.test(first);
          const startsPunct = typeof first === "string" && /[),.;:!?\]]/.test(first);
          const startsSpace = startsWithWhitespace(currContent);
          const prevTerminal = typeof last === "string" && /[.!?]/.test(last);
          if (!prevTerminal && (startsSpace || startsLower || startsPunct)) {
            let nextContent = currContent;
            if (endsWithSpace(prevContent)) {
              nextContent = trimLeadingWhitespace(currContent);
            } else if (!startsPunct && !startsSpace) {
              prevContent.push({ type: "text", text: " " });
            }
            prev.content = [...prevContent, ...nextContent];
            changed = true;
            pendingEmpty = [];
            continue;
          }
        }
      }
      if (pendingEmpty.length) {
        merged.push(...pendingEmpty);
        pendingEmpty = [];
      }
      merged.push(block);
    }
    if (pendingEmpty.length) {
      merged.push(...pendingEmpty);
      pendingEmpty = [];
    }
    if (merged.length !== node.content.length) {
      node.content = merged;
    }
  }
  return changed ? doc : doc;
};

const collectFootnoteBodies = (doc) => {
  const bodies = new Map();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "footnoteBody") {
      const id = typeof node.attrs?.footnoteId === "string" ? String(node.attrs.footnoteId).trim() : "";
      if (id && !bodies.has(id) && Array.isArray(node.content)) {
        bodies.set(id, node.content);
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(doc);
  return bodies;
};

const applyMarks = (runOptions, marks) => {
  if (!Array.isArray(marks)) return;
  for (const mark of marks) {
    if (!mark || typeof mark.type !== "string") continue;
    switch (mark.type) {
      case "bold":
        runOptions.bold = true;
        break;
      case "italic":
        runOptions.italics = true;
        break;
      case "underline":
        runOptions.underline = { type: UnderlineType.SINGLE };
        break;
      case "strikethrough":
        runOptions.strike = true;
        break;
      case "superscript":
        runOptions.superScript = true;
        break;
      case "subscript":
        runOptions.subScript = true;
        break;
      case "textColor":
        if (mark.attrs?.color) {
          const color = normalizeColor(mark.attrs.color);
          if (color) runOptions.color = color;
        }
        break;
      case "fontSize":
        if (mark.attrs?.value) {
          const size = parseFontSize(mark.attrs.value);
          if (size) runOptions.size = size;
        }
        break;
      case "fontFamily":
        if (mark.attrs?.value) runOptions.font = mark.attrs.value;
        break;
      default:
    }
  }
};

const createExportContext = (footnoteBodies) => ({
  nextFootnoteId: 1,
  footnotes: [],
  footnoteBodies: footnoteBodies || new Map(),
  registerFootnote(node, convertFn) {
    const id = this.nextFootnoteId++;
    const footnoteId = typeof node?.attrs?.footnoteId === "string" ? String(node.attrs.footnoteId).trim() : "";
    let contentNodes = null;
    if (footnoteId && this.footnoteBodies.has(footnoteId)) {
      contentNodes = this.footnoteBodies.get(footnoteId);
    } else if (Array.isArray(node.content) && node.content.length) {
      contentNodes = node.content;
    } else if (typeof node?.attrs?.text === "string" && node.attrs.text.trim().length > 0) {
      contentNodes = [{ type: "paragraph", content: [{ type: "text", text: String(node.attrs.text) }] }];
    } else {
      contentNodes = [{ type: "paragraph", content: [{ type: "text", text: "" }] }];
    }
    const children = convertFn(contentNodes ?? []);
    this.footnotes.push({ id, children });
    return id;
  }
});

const buildParagraphChildren = (content, context, convertNodes) => {
  const runs = [];
  let pendingBookmarkId = null;
  const flushPendingBookmark = () => {
    if (!pendingBookmarkId) return;
    runs.push(new Bookmark({ id: pendingBookmarkId, children: [new TextRun({ text: "" })] }));
    pendingBookmarkId = null;
  };
  const appendChild = (child, wrapBookmarkId) => {
    flushPendingBookmark();
    if (wrapBookmarkId) {
      runs.push(new Bookmark({ id: wrapBookmarkId, children: [child] }));
    } else {
      runs.push(child);
    }
  };
  const resolveLinkMark = (marks) => {
    if (!Array.isArray(marks)) return null;
    return marks.find((mark) => mark?.type === "link" || mark?.type === "anchor") || null;
  };
  const normalizeAnchorAttrs = (attrs) => {
    const raw = attrs || {};
    const hrefRaw = typeof raw.href === "string" ? raw.href.trim() : "";
    const dataKey =
      (typeof raw.dataKey === "string" && raw.dataKey.trim()) ||
      (typeof raw.itemKey === "string" && raw.itemKey.trim()) ||
      (typeof raw.dataItemKey === "string" && raw.dataItemKey.trim()) ||
      "";
    const dataDqid = typeof raw.dataDqid === "string" ? raw.dataDqid.trim() : "";
    const dataQuoteId = typeof raw.dataQuoteId === "string" ? raw.dataQuoteId.trim() : "";
    const dataQuoteText = typeof raw.dataQuoteText === "string" ? raw.dataQuoteText : "";
    const titleRaw = typeof raw.title === "string" ? raw.title : "";
    const title = titleRaw || dataQuoteText || "";
    const dataOrigHref = typeof raw.dataOrigHref === "string" ? raw.dataOrigHref : "";
    const itemKey = typeof raw.itemKey === "string" ? raw.itemKey : "";
    const dataItemKey = typeof raw.dataItemKey === "string" ? raw.dataItemKey : "";
    let href = hrefRaw;
    if (!href && dataDqid) {
      href = `dq://${dataDqid}`;
    }
    if (!href && dataQuoteId) {
      href = `dq://${dataQuoteId}`;
    }
    if (!href && dataKey) {
      href = `dq://${dataKey}`;
    }
    let resolvedDqid = dataDqid;
    if (!resolvedDqid && href && href.startsWith("dq://")) {
      resolvedDqid = href.slice("dq://".length).split("#")[0].trim();
    }
    return {
      href,
      meta: {
        dataKey: dataKey || undefined,
        dataOrigHref: dataOrigHref || undefined,
        dataQuoteId: dataQuoteId || undefined,
        dataDqid: resolvedDqid || undefined,
        dataQuoteText: dataQuoteText || undefined,
        itemKey: itemKey || undefined,
        dataItemKey: dataItemKey || undefined,
        title: title || undefined
      }
    };
  };
  const stripExistingMetaFromHref = (href) => {
    if (!href) return href;
    const hashIndex = href.indexOf("#");
    if (hashIndex < 0) return href;
    const base = href.slice(0, hashIndex);
    const fragment = href.slice(hashIndex + 1);
    if (!fragment) return href;
    const kept = fragment
      .split("&")
      .filter(Boolean)
      .filter((part) => !part.startsWith("leditor="));
    return kept.length ? `${base}#${kept.join("&")}` : base;
  };
  const resolveLinkTarget = (mark) => {
    if (!mark || typeof mark !== "object") return { href: "", bookmarkId: null, internalTarget: null };
    const attrs = mark.attrs || {};
    const normalized = normalizeAnchorAttrs(attrs);
    let href = normalized.href || "";
    const meta = normalized.meta || {};
    const bookmarkId = sanitizeBookmarkId(attrs.id || attrs.name);
    if (href.startsWith("#")) {
      const internalTarget = sanitizeBookmarkId(href.slice(1));
      return { href: "", bookmarkId, internalTarget };
    }
    href = stripExistingMetaFromHref(href);
    const metaEntries = Object.entries(meta).filter(([, value]) => typeof value === "string" && value.trim().length > 0);
    if (href && metaEntries.length > 0) {
      const encoded = encodeURIComponent(
        JSON.stringify(
          Object.fromEntries(metaEntries.map(([key, value]) => [key, String(value).trim()]))
        )
      );
      const hashIndex = href.indexOf("#");
      if (hashIndex >= 0) {
        const base = href.slice(0, hashIndex);
        const fragment = href.slice(hashIndex + 1);
        const sep = fragment.length > 0 ? "&" : "";
        href = `${base}#${fragment}${sep}leditor=${encoded}`;
      } else {
        href = `${href}#leditor=${encoded}`;
      }
    }
    return { href, bookmarkId, internalTarget: null };
  };
  if (!Array.isArray(content)) return runs;
  for (const child of content) {
    if (!child || typeof child !== "object") continue;
    if (child.type === "anchorMarker") {
      const markerId = sanitizeBookmarkId(child.attrs?.id || child.attrs?.name);
      if (markerId) {
        flushPendingBookmark();
        pendingBookmarkId = markerId;
      }
      continue;
    }
    if (child.type === "text") {
      const runOptions = { text: child.text ?? "" };
      applyMarks(runOptions, child.marks);
      const linkMark = resolveLinkMark(child.marks);
      const { href, bookmarkId, internalTarget } = resolveLinkTarget(linkMark);
      if (internalTarget) {
        appendChild(new InternalHyperlink({ anchor: internalTarget, children: [new TextRun(runOptions)] }));
      } else if (href) {
        appendChild(new ExternalHyperlink({ link: href, children: [new TextRun(runOptions)] }));
      } else if (bookmarkId) {
        appendChild(new TextRun(runOptions), bookmarkId);
      } else {
        appendChild(new TextRun(runOptions));
      }
      continue;
    }
    if (child.type === "hardBreak") {
      appendChild(new TextRun({ break: 1 }));
      continue;
    }
    if (child.type === "footnote") {
      const id = context.registerFootnote(child, (nodes) => convertNodes(nodes, context));
      appendChild(new FootnoteReferenceRun(id));
      continue;
    }
    if (Array.isArray(child.content)) {
      runs.push(...buildParagraphChildren(child.content, context, convertNodes));
    }
  }
  flushPendingBookmark();
  return runs;
};

const buildParagraphFromNode = (node, context, convertNodes, extras) => {
  const runs = buildParagraphChildren(Array.isArray(node.content) ? node.content : [], context, convertNodes);
  const paragraphOptions = {
    children: runs.length ? runs : [new TextRun({ text: "" })],
    alignment: ALIGNMENT_MAP[(node.attrs?.textAlign ?? "").toLowerCase()] ?? AlignmentType.LEFT
  };
  const spacing = resolveParagraphSpacing(node.attrs);
  if (spacing) {
    paragraphOptions.spacing = spacing;
  }
  const indent = resolveParagraphIndent(node.attrs);
  if (indent) {
    paragraphOptions.indent = indent;
  }
  if (node.type === "heading") {
    const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
    paragraphOptions.heading = HEADING_MAP[level];
  }
  if (node.type === "blockquote") {
    paragraphOptions.indent = paragraphOptions.indent ?? {};
    paragraphOptions.indent.left = (paragraphOptions.indent.left ?? 0) + 720;
  }
  if (node.type === "codeBlock") {
    paragraphOptions.children.forEach((run) => {
      if (typeof run?.font === "undefined") {
        run.font = "Courier New";
      }
    });
  }
  if (extras?.indent) {
    paragraphOptions.indent = paragraphOptions.indent ?? {};
    paragraphOptions.indent.left = (paragraphOptions.indent.left ?? 0) + extras.indent;
  }
  const paragraph = new Paragraph(paragraphOptions);
  if (extras?.prefix) {
    const firstRun = paragraph.children[0];
    if (firstRun && typeof firstRun.text === "string") {
      firstRun.text = `${extras.prefix}${firstRun.text}`;
    } else {
      paragraph.children.unshift(new TextRun({ text: extras.prefix }));
    }
  }
  return paragraph;
};

const convertTable = (node, context, convertNodes) => {
  const rows = [];
  if (!Array.isArray(node.content)) return rows;
  for (const row of node.content) {
    if (!row || !Array.isArray(row.content)) continue;
    const cells = row.content
      .filter((cell) => cell?.type === "tableCell")
      .map(
        (cell) =>
          new TableCell({
            children: convertNodes(cell.content ?? [], context)
          })
      );
    if (cells.length) {
      rows.push(new TableRow({ children: cells }));
    }
  }
  if (!rows.length) return [];
  return [
    new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE }
    })
  ];
};

const convertList = (node, depth, ordered, context, convertNodes) => {
  const items = [];
  if (!Array.isArray(node.content)) return items;
  node.content.forEach((child, index) => {
    if (child?.type !== "listItem") return;
    const paragraphs = [];
    let prefixAdded = false;
    (Array.isArray(child.content) ? child.content : []).forEach((listChild) => {
      if (!listChild) return;
      if (listChild.type === "paragraph" || listChild.type === "heading") {
        const paragraph = buildParagraphFromNode(listChild, context, convertNodes, {
          indent: depth * 720
        });
        if (!prefixAdded) {
          const prefix = ordered ? `${index + 1}. ` : "• ";
          const firstRun = paragraph.children[0];
          if (firstRun && typeof firstRun.text === "string") {
            firstRun.text = `${prefix}${firstRun.text}`;
          } else {
            paragraph.children.unshift(new TextRun({ text: prefix }));
          }
          prefixAdded = true;
        }
        paragraphs.push(paragraph);
      } else if (listChild.type === "bulletList" || listChild.type === "orderedList") {
        paragraphs.push(...convertList(listChild, depth + 1, listChild.type === "orderedList", context, convertNodes));
      }
    });
    if (!paragraphs.length) {
      const fallback = new Paragraph({
        children: [new TextRun({ text: ordered ? `${index + 1}.` : "•" })],
        indent: { left: depth * 720 }
      });
      paragraphs.push(fallback);
    }
    items.push(...paragraphs);
  });
  return items;
};

const convertNodes = (nodes, context) => {
  const result = [];
  if (!Array.isArray(nodes)) return result;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    switch (node.type) {
      case "paragraph":
      case "heading":
      case "blockquote":
      case "codeBlock":
        result.push(buildParagraphFromNode(node, context, convertNodes));
        break;
      case "page":
        result.push(...convertNodes(node.content ?? [], context));
        break;
      case "bulletList":
      case "orderedList":
        result.push(...convertList(node, 0, node.type === "orderedList", context, convertNodes));
        break;
      case "table":
        result.push(...convertTable(node, context, convertNodes));
        break;
      case "footnotesContainer":
      case "footnoteBody":
        break;
      default:
        if (Array.isArray(node.content)) {
          result.push(...convertNodes(node.content, context));
        }
        break;
    }
  }
  if (!result.length) {
    result.push(
      new Paragraph({
        children: [new TextRun({ text: "" })]
      })
    );
  }
  return result;
};

const buildDocxBuffer = async (docJson, options) => {
  const cloned = JSON.parse(JSON.stringify(docJson ?? {}));
  const normalized = normalizeContinuationParagraphs(cloned);
  const footnoteBodies = collectFootnoteBodies(normalized);
  const context = createExportContext(footnoteBodies);
  const sectionPageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const widthTwips = mmToTwips(sectionPageSize.widthMm ?? DEFAULT_PAGE_SIZE.widthMm);
  const heightTwips = mmToTwips(sectionPageSize.heightMm ?? DEFAULT_PAGE_SIZE.heightMm);
  const orientation =
    sectionPageSize.orientation === "landscape" || widthTwips > heightTwips
      ? PageOrientation.LANDSCAPE
      : PageOrientation.PORTRAIT;
  const margins = {
    ...DEFAULT_MARGINS,
    ...(options?.pageMargins ?? {})
  };
  const sectionMeta = options?.section ?? {};
  const section = {
    properties: {
      page: {
        size: {
          width: widthTwips,
          height: heightTwips,
          orientation
        },
        margin: {
          top: parseLengthToTwips(margins.top, 1),
          right: parseLengthToTwips(margins.right, 1),
          bottom: parseLengthToTwips(margins.bottom, 1),
          left: parseLengthToTwips(margins.left, 1)
        }
      },
      titlePage: false,
      pageNumberStart: Number.isFinite(sectionMeta.pageNumberStart) ? sectionMeta.pageNumberStart : undefined,
      headers: sectionMeta.headerHtml
        ? {
            default: {
              children: convertNodes([{ type: "paragraph", content: [{ type: "text", text: sectionMeta.headerHtml }] }], context)
            }
          }
        : undefined,
      footers: sectionMeta.footerHtml
        ? {
            default: {
              children: convertNodes([{ type: "paragraph", content: [{ type: "text", text: sectionMeta.footerHtml }] }], context)
            }
          }
        : undefined
    },
    children: convertNodes(normalized.content ?? [], context)
  };
  const footnotes =
    context.footnotes.length > 0
      ? Object.fromEntries(context.footnotes.map((fn) => [fn.id, { children: fn.children }]))
      : undefined;
  const document = new Document({
    sections: [section],
    footnotes
  });
  const buffer = await Packer.toBuffer(document);
  return applyHyperlinkTooltips(buffer);
};

module.exports = {
  buildDocxBuffer
};
