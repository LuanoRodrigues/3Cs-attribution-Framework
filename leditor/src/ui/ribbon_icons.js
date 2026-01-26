"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRibbonIcon = void 0;
const fluent_svg_js_1 = require("./fluent_svg.js");
const fluent = (name) => {
    const registry = typeof window !== "undefined" ? window.FluentIcons ?? window.fluentIcons : undefined;
    const entry = registry?.[name];
    if (typeof entry === "function") {
        const maybeSvg = entry();
        if (maybeSvg instanceof SVGElement) {
            return maybeSvg;
        }
    }
    if (entry instanceof SVGElement) {
        return entry;
    }
    return null;
};
const createTypographyIcon = (text, extraClass) => {
    const icon = document.createElement("span");
    icon.className = "leditor-ribbon-icon-typography" + (extraClass ? ` ${extraClass}` : "");
    icon.textContent = text;
    return icon;
};
const createAlignIcon = (variant) => {
    const container = document.createElement("span");
    container.className = `leditor-ribbon-icon-align align-${variant}`;
    for (let i = 0; i < 4; i += 1) {
        const bar = document.createElement("span");
        bar.className = "leditor-ribbon-icon-align-bar";
        container.appendChild(bar);
    }
    return container;
};
const createListIcon = (kind) => {
    const container = document.createElement("span");
    container.className = `leditor-ribbon-icon-list list-${kind}`;
    for (let i = 0; i < 3; i += 1) {
        const row = document.createElement("span");
        row.className = "leditor-ribbon-icon-list-row";
        const marker = document.createElement("span");
        marker.className = "leditor-ribbon-icon-list-marker";
        if (kind === "bullet") {
            marker.classList.add("marker-bullet");
        }
        else if (kind === "number") {
            marker.textContent = `${i + 1}`;
            marker.classList.add("marker-number");
        }
        else {
            marker.classList.add("marker-multi");
            if (i % 2 === 0)
                marker.classList.add("marker-indent");
        }
        const line = document.createElement("span");
        line.className = "leditor-ribbon-icon-list-line";
        row.appendChild(marker);
        row.appendChild(line);
        container.appendChild(row);
    }
    return container;
};
const createSpacingIcon = (variant) => {
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
const createColorSwatchIcon = (variant) => {
    const container = document.createElement("span");
    container.className = `leditor-ribbon-icon-swatch swatch-${variant}`;
    const block = document.createElement("span");
    block.className = "leditor-ribbon-icon-swatch-block";
    container.appendChild(block);
    return container;
};
const createInlineIcon = (glyph, extraClass) => createTypographyIcon(glyph, extraClass);
const createPlaceholderIcon = () => {
    const el = document.createElement("span");
    el.className = "leditor-ribbon-icon-placeholder";
    return el;
};
const fluentSvg = (name) => (0, fluent_svg_js_1.createFluentSvgIcon)(name) ?? fluent(name);
const ICON_CREATORS = {
    style: () => fluentSvg("TextGrammarSettings20Filled") ?? createTypographyIcon("¶"),
    fontFamily: () => fluentSvg("TextFont20Filled") ?? createTypographyIcon("A"),
    fontSize: () => fluentSvg("TextFontSize20Filled") ?? createTypographyIcon("A", "size"),
    bold: () => fluentSvg("TextBold20Filled") ?? createTypographyIcon("B", "bold"),
    italic: () => fluentSvg("TextItalic20Filled") ?? createTypographyIcon("I", "italic"),
    underline: () => fluentSvg("TextUnderline20Filled") ?? createTypographyIcon("U", "underline"),
    strikethrough: () => fluentSvg("TextStrikethrough20Filled") ?? createTypographyIcon("S", "strikethrough"),
    superscript: () => fluentSvg("TextSuperscript20Filled") ?? createTypographyIcon("x²", "superscript"),
    subscript: () => fluentSvg("TextSubscript20Filled") ?? createTypographyIcon("x₂", "subscript"),
    changeCase: () => fluentSvg("TextCaseTitle20Filled") ?? createTypographyIcon("Aa", "change-case"),
    highlight: () => fluentSvg("HighlightAccent20Filled") ?? createColorSwatchIcon("highlight"),
    textColor: () => fluentSvg("TextColor20Filled") ?? createColorSwatchIcon("textColor"),
    link: () => createInlineIcon("∞", "link"),
    clear: () => fluentSvg("TextClearFormatting20Filled") ?? createInlineIcon("×", "clear"),
    cover: () => createInlineIcon("⌂", "cover"),
    pageBreak: () => createInlineIcon("⎚", "page-break"),
    pageSize: () => createInlineIcon("⧉", "page-size"),
    orientation: () => createInlineIcon("↕", "orientation"),
    table: () => createInlineIcon("▦", "table"),
    image: () => createInlineIcon("🖼", "image"),
    shape: () => createInlineIcon("⬢", "shape"),
    chart: () => createInlineIcon("📊", "chart"),
    footnote: () => createInlineIcon("†", "footnote"),
    endnote: () => createInlineIcon("‡", "endnote"),
    bookmark: () => createInlineIcon("🔖", "bookmark"),
    crossReference: () => createInlineIcon("↔", "cross-reference"),
    header: () => createInlineIcon("H", "header"),
    footer: () => createInlineIcon("F", "footer"),
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
    growFont: () => fluentSvg("Add20Filled") ?? createInlineIcon("+", "grow-font"),
    shrinkFont: () => fluentSvg("Subtract20Filled") ?? createInlineIcon("−", "shrink-font"),
    zoomOut: () => createInlineIcon("-", "zoom-out"),
    zoomIn: () => createInlineIcon("+", "zoom-in"),
    zoomReset: () => createTypographyIcon("100%", "zoom-reset"),
    onePage: () => createTypographyIcon("1", "one-page"),
    twoPage: () => createTypographyIcon("2", "two-page"),
    fitWidth: () => createInlineIcon("?", "fit-width"),
    commentsNew: () => createInlineIcon("+", "comment-new"),
    commentsDelete: () => createInlineIcon("−", "comment-delete"),
    commentsPrev: () => createInlineIcon("⇤", "comment-prev"),
    commentsNext: () => createInlineIcon("⇥", "comment-next"),
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
    alignLeft: () => fluentSvg("TextAlignLeft20Filled") ?? createAlignIcon("left"),
    alignCenter: () => fluentSvg("TextAlignCenter20Filled") ?? createAlignIcon("center"),
    alignRight: () => fluentSvg("TextAlignRight20Filled") ?? createAlignIcon("right"),
    alignJustify: () => fluentSvg("TextAlignJustifyLow20Filled") ?? createAlignIcon("justify"),
    bulletList: () => fluentSvg("TextBulletListLtr20Filled") ?? createListIcon("bullet"),
    numberList: () => fluentSvg("TextNumberListLtr20Filled") ?? createListIcon("number"),
    multiList: () => fluentSvg("TextBulletListTree20Filled") ?? createListIcon("multilevel"),
    indentDecrease: () => fluentSvg("TextIndentDecreaseLtr20Filled") ?? createInlineIcon("←", "indent"),
    indentIncrease: () => fluentSvg("TextIndentIncreaseLtr20Filled") ?? createInlineIcon("→", "indent"),
    lineSpacing: () => fluentSvg("TextLineSpacing20Filled") ?? createSpacingIcon("line"),
    spacingBefore: () => createSpacingIcon("before"),
    spacingAfter: () => createSpacingIcon("after"),
    sort: () => fluentSvg("ArrowSort20Filled") ?? createInlineIcon("⇅", "sort"),
    find: () => fluentSvg("Search20Filled") ?? createInlineIcon("🔍", "search"),
    replace: () => fluentSvg("ArrowSwap20Filled") ?? createInlineIcon("↔", "replace"),
    paste: () => fluentSvg("ClipboardPaste20Filled") ?? createInlineIcon("📋", "paste"),
    copy: () => fluentSvg("Copy20Filled") ?? createInlineIcon("📄", "copy"),
    cut: () => fluentSvg("Cut20Filled") ?? createInlineIcon("✂", "cut"),
    formatPainter: () => fluentSvg("PaintBrush20Filled") ?? createInlineIcon("🎨", "format-painter"),
    select: () => fluentSvg("SelectObject20Filled") ?? createInlineIcon("⯈", "select"),
    regex: () => fluentSvg("SearchSettings20Filled") ?? createInlineIcon(".*", "regex"),
    undo: () => fluentSvg("ArrowUndo20Filled") ?? createInlineIcon("↺", "undo"),
    redo: () => fluentSvg("ArrowRedo20Filled") ?? createInlineIcon("↻", "redo"),
    taskList: () => fluentSvg("TextBulletListSquare20Filled") ?? createListIcon("multilevel"),
    visualChars: () => fluentSvg("TextParagraphDirectionRight20Filled") ?? createTypographyIcon("¶", "visual-chars"),
    borders: () => fluentSvg("BorderAll20Filled") ?? createInlineIcon("▭", "borders"),
    shading: () => fluentSvg("PaintBucket20Filled") ?? createInlineIcon("▨", "shading"),
    blockquote: () => fluentSvg("TextQuote20Filled") ?? createInlineIcon("❝", "blockquote"),
    horizontalRule: () => fluentSvg("LineHorizontal320Filled") ?? createInlineIcon("―", "horizontal-rule"),
    textEffects: () => fluentSvg("TextEffects20Filled") ?? createInlineIcon("Fx", "text-effects"),
    code: () => fluentSvg("Code20Filled") ?? createInlineIcon("{}", "code")
};
const createRibbonIcon = (name) => {
    const creator = ICON_CREATORS[name];
    const icon = creator ? creator() : createPlaceholderIcon();
    icon.classList.add("leditor-ribbon-icon");
    return icon;
};
exports.createRibbonIcon = createRibbonIcon;
