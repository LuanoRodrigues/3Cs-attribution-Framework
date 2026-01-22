"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSectionMeta = exports.serializeSectionMeta = exports.allocateSectionId = exports.defaultSectionMeta = void 0;
exports.defaultSectionMeta = {
    orientation: "portrait",
    columns: 1,
    mirrored: false
};
let nextSectionId = 0;
const allocateSectionId = () => {
    nextSectionId += 1;
    return `section-${Date.now()}-${nextSectionId}`;
};
exports.allocateSectionId = allocateSectionId;
const serializeSectionMeta = (meta) => JSON.stringify(meta);
exports.serializeSectionMeta = serializeSectionMeta;
const parseSectionMeta = (raw) => {
    if (!raw)
        return { ...exports.defaultSectionMeta };
    try {
        const parsed = JSON.parse(raw);
        return { ...exports.defaultSectionMeta, ...parsed };
    }
    catch (error) {
        console.warn("LEditor: unable to parse section metadata", error);
        return { ...exports.defaultSectionMeta };
    }
};
exports.parseSectionMeta = parseSectionMeta;
