"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const IndentExtension = core_1.Extension.create({
    name: "indent",
    addGlobalAttributes() {
        return [
            {
                types: ["paragraph", "heading"],
                attributes: {
                    indentLevel: {
                        default: 0,
                        parseHTML: (element) => {
                            const value = element.style.marginLeft;
                            if (!value)
                                return 0;
                            const match = value.match(/^([0-9.]+)em$/);
                            if (!match)
                                return 0;
                            const level = Number(match[1]);
                            return Number.isFinite(level) ? level : 0;
                        },
                        renderHTML: (attrs) => {
                            const styles = [];
                            const level = attrs.indentLevel;
                            if (level && level > 0) {
                                styles.push(`margin-left: ${level}em`);
                            }
                            const right = Number(attrs.indentRight ?? 0);
                            if (right && right > 0) {
                                styles.push(`margin-right: ${right}px`);
                            }
                            if (styles.length === 0)
                                return {};
                            return { style: styles.join("; ") };
                        }
                    },
                    indentRight: {
                        default: 0,
                        parseHTML: (element) => {
                            const value = element.style.marginRight;
                            if (!value)
                                return 0;
                            const match = value.match(/^([0-9.]+)px$/);
                            if (!match)
                                return 0;
                            const amount = Number(match[1]);
                            return Number.isFinite(amount) ? amount : 0;
                        }
                    }
                }
            }
        ];
    }
});
exports.default = IndentExtension;
