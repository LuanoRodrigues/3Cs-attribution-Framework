import * as lucide from "lucide";

const fluent = (name: string): HTMLElement | null => {
  const registry = (window as any)?.FluentIcons ?? (window as any)?.fluentIcons;
  const entry = registry?.[name];
  if (typeof entry === "function") {
    const maybeSvg = entry();
    if (maybeSvg instanceof SVGElement) {
      return maybeSvg as unknown as HTMLElement;
    }
  }
  if (entry instanceof SVGElement) {
    return entry as unknown as HTMLElement;
  }
  return null;
};

const createTypographyIcon = (text: string, extraClass?: string): HTMLElement => {
  const icon = document.createElement("span");
  icon.className = "leditor-ribbon-icon-typography" + (extraClass ? ` ${extraClass}` : "");
  icon.textContent = text;
  return icon;
};

type AlignVariant = "left" | "center" | "right" | "justify";
const createAlignIcon = (variant: AlignVariant): HTMLElement => {
  const container = document.createElement("span");
  container.className = `leditor-ribbon-icon-align align-${variant}`;
  for (let i = 0; i < 4; i += 1) {
    const bar = document.createElement("span");
    bar.className = "leditor-ribbon-icon-align-bar";
    container.appendChild(bar);
  }
  return container;
};

type ListKind = "bullet" | "number" | "multilevel";
const createListIcon = (kind: ListKind): HTMLElement => {
  const container = document.createElement("span");
  container.className = `leditor-ribbon-icon-list list-${kind}`;
  for (let i = 0; i < 3; i += 1) {
    const row = document.createElement("span");
    row.className = "leditor-ribbon-icon-list-row";
    const marker = document.createElement("span");
    marker.className = "leditor-ribbon-icon-list-marker";
    if (kind === "bullet") {
      marker.classList.add("marker-bullet");
    } else if (kind === "number") {
      marker.textContent = `${i + 1}`;
      marker.classList.add("marker-number");
    } else {
      marker.classList.add("marker-multi");
      if (i % 2 === 0) marker.classList.add("marker-indent");
    }
    const line = document.createElement("span");
    line.className = "leditor-ribbon-icon-list-line";
    row.appendChild(marker);
    row.appendChild(line);
    container.appendChild(row);
  }
  return container;
};

const createSpacingIcon = (variant: "line" | "before" | "after"): HTMLElement => {
  const container = document.createElement("span");
  container.className = `leditor-ribbon-icon-spacing spacing-${variant}`;
  for (let i = 0; i < 3; i += 1) {
    const bar = document.createElement("span");
    bar.className = "leditor-ribbon-icon-spacing-bar";
    container.appendChild(bar);
  }
  const arrow = document.createElement("span");
  arrow.className = `leditor-ribbon-icon-spacing-arrow arrow-${variant}`;
  container.appendChild(arrow);
  return container;
};

const createColorSwatchIcon = (variant: "highlight" | "textColor"): HTMLElement => {
  const container = document.createElement("span");
  container.className = `leditor-ribbon-icon-swatch swatch-${variant}`;
  const block = document.createElement("span");
  block.className = "leditor-ribbon-icon-swatch-block";
  container.appendChild(block);
  return container;
};

const createInlineIcon = (glyph: string, extraClass?: string): HTMLElement => createTypographyIcon(glyph, extraClass);

const createPlaceholderIcon = (): HTMLElement => {
  const el = document.createElement("span");
  el.className = "leditor-ribbon-icon-placeholder";
  return el;
};

const ICON_CREATORS = {
  style: () => createTypographyIcon("¶"),
  fontFamily: () => createTypographyIcon("A"),
  fontSize: () => createTypographyIcon("A", "size"),
  bold: () => createTypographyIcon("B", "bold"),
  italic: () => createTypographyIcon("I", "italic"),
  underline: () => createTypographyIcon("U", "underline"),
  strikethrough: () => createTypographyIcon("S", "strikethrough"),
  superscript: () => createTypographyIcon("x²", "superscript"),
  subscript: () => createTypographyIcon("x₂", "subscript"),
  changeCase: () => createTypographyIcon("Aa", "change-case"),
  highlight: () => createColorSwatchIcon("highlight"),
  textColor: () => createColorSwatchIcon("textColor"),
  link: () => createInlineIcon("∞", "link"),
  unlink: () => createInlineIcon("⛓", "unlink"),
  clear: () => createInlineIcon("×", "clear"),
  coverPage: () => createInlineIcon("⌂", "cover-page"),
  blankPage: () => createInlineIcon("⧉", "blank-page"),
  sectionBreak: () => createInlineIcon("⎚", "section-break"),
  cover: () => createInlineIcon("⌂", "cover"),
  pageBreak: () => createInlineIcon("⎚", "page-break"),
  pageSize: () => createInlineIcon("⧉", "page-size"),
  orientation: () => createInlineIcon("↕", "orientation"),
  margin: () => createInlineIcon("⇔", "margin"),
  columns: () => createInlineIcon("▦", "columns"),
  breaks: () => createInlineIcon("⚀", "breaks"),
  table: () => createInlineIcon("▦", "table"),
  drawTable: () => createInlineIcon("✎", "draw-table"),
  quickTables: () => createInlineIcon("QT", "quick-tables"),
  responsiveTable: () => createInlineIcon("RT", "responsive-table"),
  image: () => createInlineIcon("🖼", "image"),
  pictures: () => createInlineIcon("🖼", "pictures"),
  onlinePictures: () => createInlineIcon("🌐", "online-pictures"),
  shape: () => createInlineIcon("⬢", "shape"),
  shapes: () => createInlineIcon("⬢", "shapes"),
  icons: () => createInlineIcon("✦", "icons"),
  smartArt: () => createInlineIcon("🧠", "smart-art"),
  chart: () => createInlineIcon("📊", "chart"),
  screenshot: () => createInlineIcon("📸", "screenshot"),
  marketplace: () => createInlineIcon("🛒", "marketplace"),
  myAddins: () => createInlineIcon("★", "my-addins"),
  video: () => createInlineIcon("🎞", "video"),
  embed: () => createInlineIcon("</>", "embed"),
  audio: () => createInlineIcon("♪", "audio"),
  file: () => createInlineIcon("📁", "file"),
  pdf: () => createInlineIcon("PDF", "pdf"),
  footnote: () => createInlineIcon("†", "footnote"),
  endnote: () => createInlineIcon("‡", "endnote"),
  bookmark: () => createInlineIcon("🔖", "bookmark"),
  crossReference: () => createInlineIcon("↔", "cross-reference"),
  header: () => createInlineIcon("H", "header"),
  footer: () => createInlineIcon("F", "footer"),
  pageNumber: () => createInlineIcon("№", "page-number"),
  textBox: () => createInlineIcon("TB", "text-box"),
  quickParts: () => createInlineIcon("QP", "quick-parts"),
  wordArt: () => createInlineIcon("WA", "word-art"),
  dropCap: () => createInlineIcon("D", "drop-cap"),
  signature: () => createInlineIcon("✍", "signature"),
  dateTime: () => createInlineIcon("⌚", "date-time"),
  object: () => createInlineIcon("⧈", "object"),
  placeholder: () => createInlineIcon("▯", "placeholder"),
  shortcode: () => createInlineIcon("</>", "shortcode"),
  equation: () => createInlineIcon("Σ", "equation"),
  symbol: () => createInlineIcon("Ω", "symbol"),
  emoji: () => createInlineIcon("😀", "emoji"),
  toc: () => createInlineIcon("≡", "toc"),
  bibliography: () => createInlineIcon("📚", "bibliography"),
  citation: () => createInlineIcon("❛", "citation"),
  footnotePanel: () => createInlineIcon("☰", "footnote-panel"),
  proofing: () => createInlineIcon("P", "proofing"),
  spell: () => createInlineIcon("ABC", "spell"),
  thesaurus: () => createInlineIcon("Th", "thesaurus"),
  wordCount: () => createInlineIcon("WC", "word-count"),
  readAloud: () => createInlineIcon("🔊", "read-aloud"),
  readMode: () => createTypographyIcon("R", "read-mode"),
  printLayout: () => createTypographyIcon("P", "print-layout"),
  verticalScroll: () => createInlineIcon("?", "scroll-vertical"),
  horizontalScroll: () => createInlineIcon("?", "scroll-horizontal"),
  ruler: () => createInlineIcon("=", "ruler"),
  gridlines: () => createInlineIcon("?", "gridlines"),
  navigation: () => createInlineIcon("?", "navigation"),
  zoomOut: () => createInlineIcon("-", "zoom-out"),
  zoomIn: () => createInlineIcon("+", "zoom-in"),
  zoomReset: () => createTypographyIcon("100%", "zoom-reset"),
  onePage: () => createTypographyIcon("1", "one-page"),
  twoPage: () => createTypographyIcon("2", "two-page"),
  fitWidth: () => createInlineIcon("?", "fit-width"),
  preview: () => createInlineIcon("👁", "preview"),
  fullscreen: () => createInlineIcon("⤢", "fullscreen"),
  visualBlocks: () => createInlineIcon("▣", "visual-blocks"),
  visualChars: () => createTypographyIcon("¶", "visual-chars"),
  directionLTR: () => createInlineIcon("→", "direction-ltr"),
  directionRTL: () => createInlineIcon("←", "direction-rtl"),
  commentAdd: () => createInlineIcon("💬", "comment-add"),
  commentsNew: () => createInlineIcon("+", "comment-new"),
  commentsDelete: () => createInlineIcon("−", "comment-delete"),
  commentsPrev: () => createInlineIcon("⇤", "comment-prev"),
  commentsNext: () => createInlineIcon("⇥", "comment-next"),
  mention: () => createInlineIcon("@", "mention"),
  trackChanges: () => createInlineIcon("TC", "track-changes"),
  accept: () => createInlineIcon("✔", "accept"),
  reject: () => createInlineIcon("✘", "reject"),
  markupAll: () => createInlineIcon("≡", "markup-all"),
  markupNone: () => createInlineIcon("Ø", "markup-none"),
  markupOriginal: () => createInlineIcon("Ω", "markup-original"),
  tocAdd: () => createInlineIcon("⊕", "toc-add"),
  refresh: () => createInlineIcon("⟳", "refresh"),
  footnotePrev: () => createInlineIcon("⇠", "footnote-prev"),
  footnoteNext: () => createInlineIcon("⇢", "footnote-next"),
  themeLight: () => createInlineIcon("☀", "theme-light"),
  themeDark: () => createInlineIcon("☾", "theme-dark"),
  wordFonts: () => createTypographyIcon("Aa", "word-fonts"),
  alignLeft: () => fluent("TextAlignLeft20Filled") ?? createAlignIcon("left"),
  alignCenter: () => fluent("TextAlignCenter20Filled") ?? createAlignIcon("center"),
  alignRight: () => fluent("TextAlignRight20Filled") ?? createAlignIcon("right"),
  alignJustify: () => fluent("TextAlignJustifyLow20Filled") ?? createAlignIcon("justify"),
  bulletList: () => createListIcon("bullet"),
  numberList: () => createListIcon("number"),
  multiList: () => createListIcon("multilevel"),
  indentDecrease: () => createInlineIcon("←", "indent"),
  indentIncrease: () => createInlineIcon("→", "indent"),
  lineSpacing: () => createSpacingIcon("line"),
  spacingBefore: () => createSpacingIcon("before"),
  spacingAfter: () => createSpacingIcon("after"),
  find: () => createInlineIcon("🔍", "search"),
  replace: () => createInlineIcon("↔", "replace"),
  paste: () => createInlineIcon("📋", "paste"),
  copy: () => createInlineIcon("📄", "copy"),
  cut: () => createInlineIcon("✂", "cut"),
  formatPainter: () => createInlineIcon("🎨", "format-painter"),
  select: () => createInlineIcon("⯈", "select"),
  regex: () => createInlineIcon(".*", "regex"),
  taskList: () => createListIcon("multilevel"),
  borders: () => createInlineIcon("▭", "borders"),
  shading: () => createInlineIcon("▨", "shading"),
  styles: () => createTypographyIcon("S", "styles"),
  stylesPane: () => createInlineIcon("☰", "styles-pane"),
  manageStyles: () => createInlineIcon("≡", "manage-styles"),
  styleSet: () => createInlineIcon("𝑺", "style-set"),
  dialogLauncher: () => createInlineIcon("⋯", "dialog-launcher"),
  pasteClean: () => createInlineIcon("PC", "paste-clean"),
  docx: () => createInlineIcon("DOCX", "docx"),
  exportPdf: () => createInlineIcon("PDF", "export-pdf"),
  revisionHistory: () => createInlineIcon("RH", "revision-history"),
  aiAssistant: () => createInlineIcon("AI", "ai-assistant"),
  undo: () => createInlineIcon("↺", "undo"),
  redo: () => createInlineIcon("↻", "redo")
} as const;

type IconCreators = typeof ICON_CREATORS;
export type RibbonIconName = keyof IconCreators;

const createLucideIcon = (lucideName: string): HTMLElement | null => {
  const factory = (lucide as Record<string, any>)[lucideName];
  if (typeof factory !== "function") {
    return null;
  }
  const svg = factory({
    width: 18,
    height: 18,
    strokeWidth: 2,
    stroke: "currentColor",
    fill: "none"
  });
  if (!(svg instanceof SVGElement)) {
    return null;
  }
  svg.classList.add("leditor-lucide-icon");
  return svg as unknown as HTMLElement;
};

const LUCIDE_ICON_MAP: Partial<Record<RibbonIconName, string>> = {
  bold: "TypeBold",
  italic: "TypeItalic",
  underline: "Underline",
  strikethrough: "Strikethrough",
  superscript: "Superscript",
  subscript: "Subscript",
  changeCase: "Type",
  highlight: "Highlighter",
  textColor: "TextColor",
  link: "Link2",
  clear: "X",
  pageBreak: "ArrowDown",
  pageSize: "Square",
  orientation: "RotateCw",
  margin: "ArrowsHorizontal",
  columns: "Columns",
  breaks: "Scissors",
  table: "Table",
  image: "Image",
  shape: "Hexagon",
  chart: "BarChart",
  footnote: "BookOpen",
  endnote: "BookOpenCheck",
  bookmark: "Bookmark",
  crossReference: "CornerUpRight",
  header: "LayoutBoardSplit",
  footer: "LayoutBottomPanel",
  toc: "List",
  bibliography: "Books",
  citation: "Quote",
  footnotePanel: "Grid",
  proofing: "CheckCircle",
  spell: "SpellCheck",
  thesaurus: "BookOpenCheck",
  wordCount: "Hash",
  readAloud: "Volume2",
  readMode: "Eye",
  printLayout: "Printer",
  verticalScroll: "ArrowsVertical",
  horizontalScroll: "ArrowsHorizontal",
  ruler: "Ruler",
  gridlines: "Grid",
  navigation: "Compass",
  zoomOut: "ZoomOut",
  zoomIn: "ZoomIn",
  zoomReset: "Loader",
  onePage: "Number1",
  twoPage: "Number2",
  fitWidth: "Maximize2",
  preview: "Eye",
  fullscreen: "Expand",
  visualBlocks: "Squares",
  visualChars: "Type",
  directionLTR: "ArrowRight",
  directionRTL: "ArrowLeft",
  commentsNew: "MessageSquarePlus",
  commentsDelete: "MessageSquareX",
  commentsPrev: "ArrowLeft",
  commentsNext: "ArrowRight",
  trackChanges: "Edit",
  accept: "Check",
  reject: "X",
  markupAll: "FileCheck",
  markupNone: "FileMinus",
  markupOriginal: "FileText",
  tocAdd: "PlusSquare",
  refresh: "RotateCcw",
  footnotePrev: "ArrowLeft",
  footnoteNext: "ArrowRight",
  themeLight: "Sun",
  themeDark: "Moon",
  alignLeft: "AlignLeft",
  alignCenter: "AlignCenter",
  alignRight: "AlignRight",
  alignJustify: "AlignJustify",
  wordFonts: "TextAa",
  style: "Paragraph",
  fontFamily: "Text",
  fontSize: "TextSize",
  bulletList: "List",
  numberList: "ListOrdered",
  multiList: "ListChecks",
  indentDecrease: "Indent",
  indentIncrease: "Outdent",
  lineSpacing: "LineHeight",
  spacingBefore: "ArrowDownToLine",
  spacingAfter: "ArrowUpToLine",
  find: "Search",
  replace: "Repeat",
  paste: "Clipboard",
  copy: "Copy",
  cut: "Scissors",
  undo: "RotateCcw",
  redo: "RotateCw",
  regex: "Regex",
  taskList: "ListChecks",
  borders: "Square",
  shading: "PaintBucket",
  styles: "Paragraph",
  stylesPane: "PanelRightOpen",
  manageStyles: "Settings",
  styleSet: "Shapes",
  dialogLauncher: "EllipsisVertical",
  formatPainter: "Paintbrush",
  select: "MousePointerClick",
  pasteClean: "ClipboardCheck",
  docx: "FileText",
  exportPdf: "FilePdf",
  revisionHistory: "History",
  aiAssistant: "Sparkles"
} as const;

export const createRibbonIcon = (name: RibbonIconName): HTMLElement => {
  const lucideName = LUCIDE_ICON_MAP[name];
  if (lucideName) {
    const lucideIcon = createLucideIcon(lucideName);
    if (lucideIcon) {
      lucideIcon.classList.add("leditor-ribbon-icon");
      return lucideIcon;
    }
  }
  const creator = ICON_CREATORS[name];
  const icon = creator ? creator() : createPlaceholderIcon();
  icon.classList.add("leditor-ribbon-icon");
  return icon;
};
