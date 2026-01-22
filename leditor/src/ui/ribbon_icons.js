"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRibbonIcon = void 0;
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
    clear: () => createInlineIcon("×", "clear"),
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
    alignLeft: () => createAlignIcon("left"),
    alignCenter: () => createAlignIcon("center"),
    alignRight: () => createAlignIcon("right"),
    alignJustify: () => createAlignIcon("justify"),
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
    undo: () => createInlineIcon("↺", "undo"),
    redo: () => createInlineIcon("↻", "redo")
};
const createRibbonIcon = (name) => {
    const creator = ICON_CREATORS[name];
    const icon = creator ? creator() : createPlaceholderIcon();
    icon.classList.add("leditor-ribbon-icon");
    return icon;
};
exports.createRibbonIcon = createRibbonIcon;
