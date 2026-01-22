"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTemplates = exports.getTemplateById = exports.templateDefinitions = void 0;
const academic_report_json_1 = __importDefault(require("./academic_report.json"));
const conference_note_json_1 = __importDefault(require("./conference_note.json"));
exports.templateDefinitions = [
    {
        id: "academic_report",
        label: "Academic Report Outline",
        description: "A formal cover page with placeholders for author and department.",
        document: academic_report_json_1.default
    },
    {
        id: "conference_note",
        label: "Conference Summary",
        description: "Quick summary layout with merge points for date and details.",
        document: conference_note_json_1.default
    }
];
const getTemplateById = (id) => exports.templateDefinitions.find((template) => template.id === id);
exports.getTemplateById = getTemplateById;
const getTemplates = () => exports.templateDefinitions;
exports.getTemplates = getTemplates;
