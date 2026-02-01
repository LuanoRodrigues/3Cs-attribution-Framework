"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unpackLedocZip = exports.packLedocZip = void 0;
const jszip_1 = __importDefault(require("jszip"));
const format_ts_1 = require("./format.ts");
const normalizeError = (error) => (error instanceof Error ? error.message : String(error));
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const assertLedocVersion = (value) => {
    if (value !== format_ts_1.LEDOC_FORMAT_VERSION) {
        throw new Error(`Unsupported format version: ${String(value ?? "") || "unknown"}`);
    }
};
const assertString = (value, label) => {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Invalid ${label}`);
    }
};
const assertStringArray = (value, label) => {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
        throw new Error(`Invalid ${label}`);
    }
};
const assertNumber = (value, label) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Invalid ${label}`);
    }
};
const parseJsonObject = (raw, label) => {
    try {
        const parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) {
            throw new Error(`${label} must be a JSON object`);
        }
        return parsed;
    }
    catch (error) {
        throw new Error(`${label} parse failed: ${normalizeError(error)}`);
    }
};
const readTextFileOptional = async (zip, archivePath) => {
    const entry = zip.file(archivePath);
    if (!entry)
        return null;
    return entry.async("string");
};
const readJsonObjectOptional = async (zip, archivePath, label) => {
    const raw = await readTextFileOptional(zip, archivePath);
    if (raw == null)
        return null;
    return parseJsonObject(raw, label);
};
const requireJsonObject = async (zip, archivePath, label) => {
    const parsed = await readJsonObjectOptional(zip, archivePath, label);
    if (!parsed) {
        throw new Error(`Archive missing required file: ${archivePath}`);
    }
    return parsed;
};
const assertMetaFile = (value) => {
    assertLedocVersion(value.version);
    assertString(value.title, "meta.title");
    assertStringArray(value.authors, "meta.authors");
    assertString(value.created, "meta.created");
    assertString(value.lastModified, "meta.lastModified");
    if (value.appVersion !== undefined && value.appVersion !== null) {
        if (typeof value.appVersion !== "string") {
            throw new Error("Invalid meta.appVersion");
        }
    }
    return value;
};
const assertSettingsFile = (value) => {
    assertString(value.pageSize, "settings.pageSize");
    if (!isPlainObject(value.margins)) {
        throw new Error("Invalid settings.margins");
    }
    const margins = value.margins;
    assertNumber(margins.top, "settings.margins.top");
    assertNumber(margins.bottom, "settings.margins.bottom");
    assertNumber(margins.left, "settings.margins.left");
    assertNumber(margins.right, "settings.margins.right");
    if (value.footnoteOffset !== undefined && value.footnoteOffset !== null) {
        assertNumber(value.footnoteOffset, "settings.footnoteOffset");
    }
    if (value.fontFamily !== undefined && value.fontFamily !== null) {
        if (typeof value.fontFamily !== "string") {
            throw new Error("Invalid settings.fontFamily");
        }
    }
    if (value.fontSize !== undefined && value.fontSize !== null) {
        assertNumber(value.fontSize, "settings.fontSize");
    }
    return value;
};
const assertFootnotesFile = (value) => {
    assertLedocVersion(value.version);
    if (!Array.isArray(value.footnotes)) {
        throw new Error("Invalid footnotes.footnotes");
    }
    const ids = new Set();
    const indexes = new Set();
    for (const entry of value.footnotes) {
        if (!isPlainObject(entry)) {
            throw new Error("Invalid footnotes entry");
        }
        const rec = entry;
        assertString(rec.id, "footnotes[].id");
        assertString(rec.text ?? "", "footnotes[].text");
        assertNumber(rec.index, "footnotes[].index");
        if (ids.has(rec.id)) {
            throw new Error(`Duplicate footnote id: ${rec.id}`);
        }
        if (indexes.has(rec.index)) {
            throw new Error(`Duplicate footnote index: ${rec.index}`);
        }
        ids.add(rec.id);
        indexes.add(rec.index);
    }
    return value;
};
const packLedocZip = async (payload) => {
    const zip = new jszip_1.default();
    zip.file(format_ts_1.LEDOC_PATHS.document, JSON.stringify(payload.document ?? {}, null, 2));
    zip.file(format_ts_1.LEDOC_PATHS.meta, JSON.stringify(payload.meta ?? {}, null, 2));
    if (payload.settings) {
        zip.file(format_ts_1.LEDOC_PATHS.settings, JSON.stringify(payload.settings, null, 2));
    }
    if (payload.footnotes) {
        zip.file(format_ts_1.LEDOC_PATHS.footnotes, JSON.stringify(payload.footnotes, null, 2));
    }
    if (payload.styles !== undefined) {
        zip.file(format_ts_1.LEDOC_PATHS.styles, JSON.stringify(payload.styles, null, 2));
    }
    if (payload.history !== undefined) {
        zip.file(format_ts_1.LEDOC_PATHS.history, JSON.stringify(payload.history, null, 2));
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    return buffer;
};
exports.packLedocZip = packLedocZip;
const unpackLedocZip = async (buffer) => {
    const warnings = [];
    const zip = await jszip_1.default.loadAsync(buffer);
    const document = await requireJsonObject(zip, format_ts_1.LEDOC_PATHS.document, "document.json");
    const metaRaw = await requireJsonObject(zip, format_ts_1.LEDOC_PATHS.meta, "meta.json");
    const meta = assertMetaFile(metaRaw);
    const settingsRaw = await readJsonObjectOptional(zip, format_ts_1.LEDOC_PATHS.settings, "settings.json");
    const settings = settingsRaw ? assertSettingsFile(settingsRaw) : undefined;
    if (!settingsRaw)
        warnings.push("settings.json missing; using editor defaults.");
    const footnotesRaw = await readJsonObjectOptional(zip, format_ts_1.LEDOC_PATHS.footnotes, "footnotes.json");
    const footnotes = footnotesRaw ? assertFootnotesFile(footnotesRaw) : undefined;
    if (!footnotesRaw)
        warnings.push("footnotes.json missing; loaded content only.");
    if (footnotes && footnotes.version !== meta.version) {
        throw new Error(`Unsupported format version: ${footnotes.version}`);
    }
    return { payload: { document, meta, settings, footnotes }, warnings };
};
exports.unpackLedocZip = unpackLedocZip;
