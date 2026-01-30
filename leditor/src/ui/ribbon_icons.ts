import { createFluentSvgIcon } from "./fluent_svg.ts";

const createSpacingIcon = (variant: "line" | "before" | "after"): HTMLElement => {
  const icon = createFluentSvgIcon("TextLineSpacing20Filled");
  icon.classList.add("leditor-ribbon-icon-spacing", `spacing-${variant}`);
  return icon;
};

const fluentSvg = (name: string): HTMLElement => createFluentSvgIcon(name);

const ICON_CREATORS = {
  style: () => fluentSvg("TextGrammarSettings20Filled"),
  fontFamily: () => fluentSvg("TextFont20Filled"),
  fontSize: () => fluentSvg("TextFontSize20Filled"),
  bold: () => fluentSvg("TextBold20Filled"),
  italic: () => fluentSvg("TextItalic20Filled"),
  underline: () => fluentSvg("TextUnderline20Filled"),
  strikethrough: () => fluentSvg("TextStrikethrough20Filled"),
  superscript: () => fluentSvg("TextSuperscript20Filled"),
  subscript: () => fluentSvg("TextSubscript20Filled"),
  changeCase: () => fluentSvg("TextCaseTitle20Filled"),
  textEffects: () => fluentSvg("TextEffects20Filled"),
  highlight: () => fluentSvg("HighlightAccent20Filled"),
  textColor: () => fluentSvg("ColorLine20Filled"),
  link: () => fluentSvg("Link20Filled"),
  unlink: () => fluentSvg("LinkDismiss20Filled"),
  clear: () => fluentSvg("TextClearFormatting20Filled"),
  coverPage: () => fluentSvg("DocumentPageTopCenter20Filled"),
  blankPage: () => fluentSvg("Document20Filled"),
  sectionBreak: () => fluentSvg("TextIndentIncreaseLtr20Filled"),
  cover: () => fluentSvg("Document20Filled"),
  pageBreak: () => fluentSvg("DocumentPageBreak20Filled"),
  pageSize: () => fluentSvg("DocumentPageTopCenter20Filled"),
  orientation: () => fluentSvg("TextDirectionRotate90Ltr20Filled"),
  margin: () => fluentSvg("PaddingDown20Filled"),
  columns: () => fluentSvg("ColumnTriple20Filled"),
  breaks: () => fluentSvg("Cut20Filled"),
  table: () => fluentSvg("Table20Filled"),
  drawTable: () => fluentSvg("DrawShape20Filled"),
  quickTables: () => fluentSvg("TableSimple20Filled"),
  responsiveTable: () => fluentSvg("TableResizeColumn20Filled"),
  image: () => fluentSvg("Image20Filled"),
  pictures: () => fluentSvg("ImageMultiple20Filled"),
  onlinePictures: () => fluentSvg("Globe20Filled"),
  openPicker: () => fluentSvg("SelectObject20Filled"),
  shape: () => fluentSvg("ShapeIntersect20Filled"),
  shapes: () => fluentSvg("Shapes20Filled"),
  icons: () => fluentSvg("Emoji20Filled"),
  smartArt: () => fluentSvg("BrainCircuit20Filled"),
  chart: () => fluentSvg("ChartMultiple20Filled"),
  screenshot: () => fluentSvg("Camera20Filled"),
  marketplace: () => fluentSvg("StoreMicrosoft20Filled"),
  myAddins: () => fluentSvg("PuzzlePiece20Filled"),
  video: () => fluentSvg("Video20Filled"),
  embed: () => fluentSvg("Code20Filled"),
  audio: () => fluentSvg("MusicNote220Filled"),
  file: () => fluentSvg("Document20Filled"),
  pdf: () => fluentSvg("DocumentPdf20Filled"),
  footnote: () => fluentSvg("NumberCircle120Filled"),
  endnote: () => fluentSvg("NumberCircle220Filled"),
  bookmark: () => fluentSvg("Bookmark20Filled"),
  crossReference: () => fluentSvg("ArrowTurnLeftUp20Filled"),
  header: () => fluentSvg("Hdr20Filled"),
  footer: () => fluentSvg("DocumentFooter20Filled"),
  pageNumber: () => fluentSvg("NumberCircle320Filled"),
  textBox: () => fluentSvg("Textbox20Filled"),
  quickParts: () => fluentSvg("DocumentQueue20Filled"),
  wordArt: () => fluentSvg("TextEffects20Filled"),
  dropCap: () => fluentSvg("TextFontSize20Filled"),
  signature: () => fluentSvg("Signature20Filled"),
  dateTime: () => fluentSvg("Clock20Filled"),
  object: () => fluentSvg("Cube20Filled"),
  placeholder: () => fluentSvg("Shapes20Filled"),
  shortcode: () => fluentSvg("Code20Filled"),
  equation: () => fluentSvg("MathFormula20Filled"),
  symbol: () => fluentSvg("MathFormula20Filled"),
  emoji: () => fluentSvg("Emoji20Filled"),
  toc: () => fluentSvg("TextBulletListLtr20Filled"),
  bibliography: () => fluentSvg("BookOpen20Filled"),
  citation: () => fluentSvg("TextQuote20Filled"),
  footnotePanel: () => fluentSvg("PanelRight20Filled"),
  proofing: () => fluentSvg("CheckmarkCircle20Filled"),
  spell: () => fluentSvg("TextGrammarCheckmark20Filled"),
  thesaurus: () => fluentSvg("BookOpen20Filled"),
  wordCount: () => fluentSvg("NumberSymbol20Filled"),
  readAloud: () => fluentSvg("Speaker220Filled"),
  readMode: () => fluentSvg("Eye20Filled"),
  printLayout: () => fluentSvg("Print20Filled"),
  verticalScroll: () => fluentSvg("WindowMultipleSwap20Filled"),
  horizontalScroll: () => fluentSvg("WindowMultipleSwap20Filled"),
  ruler: () => fluentSvg("Ruler20Filled"),
  gridlines: () => fluentSvg("Grid20Filled"),
  navigation: () => fluentSvg("Navigation20Filled"),
  growFont: () => fluentSvg("Add20Filled"),
  shrinkFont: () => fluentSvg("Subtract20Filled"),
  zoomOut: () => fluentSvg("ZoomOut20Filled"),
  zoomIn: () => fluentSvg("ZoomIn20Filled"),
  zoomReset: () => fluentSvg("ZoomFit20Filled"),
  onePage: () => fluentSvg("PageFit20Filled"),
  twoPage: () => fluentSvg("PageFit20Filled"),
  fitWidth: () => fluentSvg("WindowArrowUp20Filled"),
  preview: () => fluentSvg("Eye20Filled"),
  fullscreen: () => fluentSvg("FullScreenMaximize20Filled"),
  visualBlocks: () => fluentSvg("GridDots20Filled"),
  visualChars: () => fluentSvg("TextParagraphDirectionRight20Filled"),
  directionLTR: () => fluentSvg("TextDirectionHorizontalLtr20Filled"),
  directionRTL: () => fluentSvg("TextDirectionHorizontalRtl20Filled"),
  commentAdd: () => fluentSvg("CommentBadge20Filled"),
  commentsNew: () => fluentSvg("CommentBadge20Filled"),
  commentsDelete: () => fluentSvg("CommentQuote20Filled"),
  commentsPrev: () => fluentSvg("Previous20Filled"),
  commentsNext: () => fluentSvg("Next20Filled"),
  mention: () => fluentSvg("Mention20Filled"),
  trackChanges: () => fluentSvg("Edit20Filled"),
  accept: () => fluentSvg("Checkmark20Filled"),
  reject: () => fluentSvg("Dismiss20Filled"),
  markupAll: () => fluentSvg("CheckboxChecked20Filled"),
  markupNone: () => fluentSvg("CheckboxUnchecked20Filled"),
  markupOriginal: () => fluentSvg("CheckboxIndeterminate20Filled"),
  tocAdd: () => fluentSvg("AddSquare20Filled"),
  refresh: () => fluentSvg("ArrowClockwise20Filled"),
  footnotePrev: () => fluentSvg("Previous20Filled"),
  footnoteNext: () => fluentSvg("Next20Filled"),
  themeLight: () => fluentSvg("WeatherSunny20Filled"),
  themeDark: () => fluentSvg("WeatherMoon20Filled"),
  wordFonts: () => fluentSvg("TextFont20Filled"),
  alignLeft: () => fluentSvg("TextAlignLeft20Filled"),
  alignCenter: () => fluentSvg("TextAlignCenter20Filled"),
  alignRight: () => fluentSvg("TextAlignRight20Filled"),
  alignJustify: () => fluentSvg("TextAlignJustifyLow20Filled"),
  bulletList: () => fluentSvg("TextBulletListLtr20Filled"),
  numberList: () => fluentSvg("TextNumberListLtr20Filled"),
  multiList: () => fluentSvg("TextBulletListTree20Filled"),
  indentDecrease: () => fluentSvg("TextIndentDecreaseLtr20Filled"),
  indentIncrease: () => fluentSvg("TextIndentIncreaseLtr20Filled"),
  lineSpacing: () => fluentSvg("TextLineSpacing20Filled"),
  spacingBefore: () => createSpacingIcon("before"),
  spacingAfter: () => createSpacingIcon("after"),
  sort: () => fluentSvg("ArrowSort20Filled"),
  find: () => fluentSvg("Search20Filled"),
  replace: () => fluentSvg("WindowMultipleSwap20Filled"),
  paste: () => fluentSvg("ClipboardPaste20Filled"),
  copy: () => fluentSvg("Copy20Filled"),
  cut: () => fluentSvg("Cut20Filled"),
  formatPainter: () => fluentSvg("PaintBrush20Filled"),
  select: () => fluentSvg("SelectObject20Filled"),
  regex: () => fluentSvg("SearchSettings20Filled"),
  taskList: () => fluentSvg("TextBulletListSquare20Filled"),
  borders: () => fluentSvg("BorderAll20Filled"),
  blockquote: () => fluentSvg("TextQuote20Filled"),
  horizontalRule: () => fluentSvg("LineHorizontal320Filled"),
  shading: () => fluentSvg("PaintBucket20Filled"),
  styles: () => fluentSvg("TextGrammarSettings20Filled"),
  stylesPane: () => fluentSvg("PanelRightExpand20Filled"),
  manageStyles: () => fluentSvg("Settings20Filled"),
  styleSet: () => fluentSvg("Shapes20Filled"),
  dialogLauncher: () => fluentSvg("MoreHorizontal20Filled"),
  pasteClean: () => fluentSvg("ClipboardCheckmark20Filled"),
  docx: () => fluentSvg("DocumentText20Filled"),
  exportPdf: () => fluentSvg("DocumentPdf20Filled"),
  revisionHistory: () => fluentSvg("History20Filled"),
  aiAssistant: () => fluentSvg("Sparkle20Filled"),
  accessibility: () => fluentSvg("Accessibility20Filled"),
  acceptChange: () => fluentSvg("Checkmark20Filled"),
  addText: () => fluentSvg("TextAdd20Filled"),
  autoMark: () => fluentSvg("CheckboxChecked20Filled"),
  chevronDown: () => fluentSvg("ChevronDown20Filled"),
  chevronUp: () => fluentSvg("ChevronUp20Filled"),
  citationStyle: () => fluentSvg("TextQuote20Filled"),
  citeKey: () => fluentSvg("Key20Filled"),
  cleanPaste: () => fluentSvg("ClipboardCheckmark20Filled"),
  clearFormatting: () => fluentSvg("TextClearFormatting20Filled"),
  commentDelete: () => fluentSvg("CommentQuote20Filled"),
  doi: () => fluentSvg("Link20Filled"),
  export: () => fluentSvg("ArrowExportLtr20Filled"),
  font: () => fluentSvg("TextFont20Filled"),
  goto: () => fluentSvg("ArrowRight20Filled"),
  import: () => fluentSvg("ArrowDownload20Filled"),
  inlineCode: () => fluentSvg("Code20Filled"),
  insertCitation: () => fluentSvg("TextQuote20Filled"),
  insertIndex: () => fluentSvg("TextBulletListLtr20Filled"),
  language: () => fluentSvg("Translate20Filled"),
  library: () => fluentSvg("BookOpen20Filled"),
  manageSources: () => fluentSvg("PeopleSettings20Filled"),
  markCitation: () => fluentSvg("Tag20Filled"),
  markEntry: () => fluentSvg("TagMultiple20Filled"),
  more: () => fluentSvg("MoreHorizontal20Filled"),
  next: () => fluentSvg("ChevronRight20Filled"),
  previous: () => fluentSvg("ChevronLeft20Filled"),
  nextChange: () => fluentSvg("Next20Filled"),
  nextFootnote: () => fluentSvg("Next20Filled"),
  page: () => fluentSvg("DocumentPageTopCenter20Filled"),
  pages: () => fluentSvg("DocumentMultiple20Filled"),
  paragraphStyle: () => fluentSvg("TextParagraph20Filled"),
  previousChange: () => fluentSvg("Previous20Filled"),
  protect: () => fluentSvg("LockClosed20Filled"),
  rejectChange: () => fluentSvg("Dismiss20Filled"),
  remove: () => fluentSvg("Subtract20Filled"),
  showMarkup: () => fluentSvg("CheckboxChecked20Filled"),
  showNotes: () => fluentSvg("Notebook20Filled"),
  smartLookup: () => fluentSvg("SearchSquare20Filled"),
  spellCheck: () => fluentSvg("TextGrammarCheckmark20Filled"),
  tableOfAuthorities: () => fluentSvg("BookOpen20Filled"),
  tocAuto: () => fluentSvg("TextBulletListLtr20Filled"),
  tocCustom: () => fluentSvg("TextBulletListLtr20Filled"),
  translate: () => fluentSvg("Translate20Filled"),
  updateTable: () => fluentSvg("DocumentSync20Filled"),
  updateToc: () => fluentSvg("DocumentSync20Filled"),
  zoom: () => fluentSvg("ZoomIn20Filled"),
  undo: () => fluentSvg("ArrowCounterclockwise20Filled"),
  redo: () => fluentSvg("ArrowClockwise20Filled"),
  code: () => fluentSvg("Code20Filled")
} as const;

type IconCreators = typeof ICON_CREATORS;

export type RibbonIconName = keyof IconCreators;
export type RibbonIconKey = RibbonIconName | `icon.${RibbonIconName}`;

const normalizeIconKey = (key: RibbonIconKey): RibbonIconName => {
  if (key.startsWith("icon.")) {
    return key.slice(5) as RibbonIconName;
  }
  return key as RibbonIconName;
};

export const createRibbonIcon = (key: RibbonIconKey): HTMLElement => {
  const name = normalizeIconKey(key);

  const creator = ICON_CREATORS[name];
  const icon = creator();
  if (!(icon instanceof SVGElement)) {
    throw new Error(`Ribbon icon "${name}" did not render as SVG.`);
  }
  icon.dataset.iconKey = name;
  icon.classList.add("leditor-ribbon-icon");
  return icon;
};

export const assertRibbonIconKeysExist = (keys: readonly string[]): void => {
  for (const raw of keys) {
    const key = raw as RibbonIconKey;
    const name = normalizeIconKey(key);

    const hasCreator = Boolean(ICON_CREATORS[name]);
    if (!hasCreator) {
      throw new Error(`Unknown iconKey: ${raw}`);
    }
  }
};
