const {
  AlignmentType,
  HeadingLevel,
  PageOrientation,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ExternalHyperlink,
  FootnoteReferenceRun,
  Document,
  UnderlineType
} = require("docx");

const TWIPS_PER_INCH = 1440;
const MILLIMETERS_PER_INCH = 25.4;
const DEFAULT_PAGE_SIZE = { widthMm: 210, heightMm: 297 };
const DEFAULT_MARGINS = { top: "1in", right: "1in", bottom: "1in", left: "1in" };

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

const createExportContext = () => ({
  nextFootnoteId: 1,
  footnotes: [],
  registerFootnote(node, convertFn) {
    const id = this.nextFootnoteId++;
    const children = convertFn(node.content ?? []);
    this.footnotes.push({ id, children });
    return id;
  }
});

const buildParagraphChildren = (content, context, convertNodes) => {
  const runs = [];
  if (!Array.isArray(content)) return runs;
  for (const child of content) {
    if (!child || typeof child !== "object") continue;
    if (child.type === "text") {
      const runOptions = { text: child.text ?? "" };
      applyMarks(runOptions, child.marks);
      const linkMark = child.marks?.find((mark) => mark?.type === "link" && mark?.attrs?.href);
      if (linkMark?.attrs?.href) {
        const href = String(linkMark.attrs.href);
        runs.push(new ExternalHyperlink({ link: href, children: [new TextRun(runOptions)] }));
      } else {
        runs.push(new TextRun(runOptions));
      }
      continue;
    }
    if (child.type === "hardBreak") {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }
    if (child.type === "footnote") {
      const id = context.registerFootnote(child, (nodes) => convertNodes(nodes, context));
      runs.push(new FootnoteReferenceRun(id));
      continue;
    }
    if (Array.isArray(child.content)) {
      runs.push(...buildParagraphChildren(child.content, context, convertNodes));
    }
  }
  return runs;
};

const buildParagraphFromNode = (node, context, convertNodes, extras) => {
  const runs = buildParagraphChildren(Array.isArray(node.content) ? node.content : [], context, convertNodes);
  const paragraphOptions = {
    children: runs.length ? runs : [new TextRun({ text: "" })],
    alignment: ALIGNMENT_MAP[(node.attrs?.textAlign ?? "").toLowerCase()] ?? AlignmentType.LEFT
  };
  if (node.type === "heading") {
    const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
    paragraphOptions.heading = HEADING_MAP[level];
  }
  if (node.type === "blockquote") {
    paragraphOptions.indent = { left: 720 };
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
      case "bulletList":
      case "orderedList":
        result.push(...convertList(node, 0, node.type === "orderedList", context, convertNodes));
        break;
      case "table":
        result.push(...convertTable(node, context, convertNodes));
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
  const normalized = docJson ?? {};
  const context = createExportContext();
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
  return Packer.toBuffer(document);
};

module.exports = {
  buildDocxBuffer
};
