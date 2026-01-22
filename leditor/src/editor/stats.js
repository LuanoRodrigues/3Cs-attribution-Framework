"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeStats = void 0;
const blockBoundaryTypes = new Set([
    "paragraph",
    "heading",
    "list_item",
    "table_cell",
    "table_header",
    "blockquote",
    "code_block"
]);
const computeStats = (docJson) => {
    let words = 0;
    let charsWithSpaces = 0;
    let charsNoSpaces = 0;
    let prevWasNonSpace = false;
    const consumeText = (text) => {
        for (let i = 0; i < text.length; i += 1) {
            const ch = text[i];
            const isSpace = /\s/.test(ch);
            charsWithSpaces += 1;
            if (!isSpace) {
                charsNoSpaces += 1;
                if (!prevWasNonSpace)
                    words += 1;
                prevWasNonSpace = true;
            }
            else {
                prevWasNonSpace = false;
            }
        }
    };
    const walk = (node) => {
        if (!node)
            return;
        if (node.type === "text" && typeof node.text === "string") {
            consumeText(node.text);
            return;
        }
        if (node.type === "hardBreak") {
            prevWasNonSpace = false;
            return;
        }
        if (node.type && blockBoundaryTypes.has(node.type)) {
            prevWasNonSpace = false;
        }
        if (node.content) {
            for (const child of node.content) {
                walk(child);
            }
        }
        if (node.type && blockBoundaryTypes.has(node.type)) {
            prevWasNonSpace = false;
        }
    };
    walk(docJson);
    return { words, charsWithSpaces, charsNoSpaces };
};
exports.computeStats = computeStats;
