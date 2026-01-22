"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const parsePx = (value) => {
    if (!value)
        return 0;
    const match = value.match(/^([0-9.]+)px$/);
    if (!match)
        return 0;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : 0;
};
const SpacingExtension = core_1.Extension.create({
    name: "spacing",
    addGlobalAttributes() {
        return [
            {
                types: ["paragraph", "heading"],
                attributes: {
                    lineHeight: {
                        default: null,
                        parseHTML: (element) => {
                            const value = element.style.lineHeight;
                            return value || null;
                        },
                        renderHTML: (attrs) => {
                            if (!attrs.lineHeight)
                                return {};
                            return { style: `line-height: ${attrs.lineHeight}` };
                        }
                    },
                    spaceBefore: {
                        default: 0,
                        parseHTML: (element) => parsePx(element.style.marginTop),
                        renderHTML: (attrs) => {
                            const value = Number(attrs.spaceBefore ?? 0);
                            if (!value)
                                return {};
                            return { style: `margin-top: ${value}px` };
                        }
                    },
                    spaceAfter: {
                        default: 0,
                        parseHTML: (element) => parsePx(element.style.marginBottom),
                        renderHTML: (attrs) => {
                            const value = Number(attrs.spaceAfter ?? 0);
                            if (!value)
                                return {};
                            return { style: `margin-bottom: ${value}px` };
                        }
                    }
                }
            }
        ];
    },
    addCommands() {
        return {
            setLineHeight: (value) => ({ chain }) => chain.updateAttributes("paragraph", { lineHeight: value }).updateAttributes("heading", { lineHeight: value }).run(),
            setSpaceBefore: (valuePx) => ({ chain }) => chain.updateAttributes("paragraph", { spaceBefore: valuePx }).updateAttributes("heading", { spaceBefore: valuePx }).run(),
            setSpaceAfter: (valuePx) => ({ chain }) => chain.updateAttributes("paragraph", { spaceAfter: valuePx }).updateAttributes("heading", { spaceAfter: valuePx }).run()
        };
    }
});
exports.default = SpacingExtension;
