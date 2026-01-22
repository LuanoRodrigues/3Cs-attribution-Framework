import academicReport from "./academic_report.json";
import conferenceNote from "./conference_note.json";

export type TemplateDefinition = {
  id: string;
  label: string;
  description: string;
  document: Record<string, unknown>;
};

export const templateDefinitions: TemplateDefinition[] = [
  {
    id: "academic_report",
    label: "Academic Report Outline",
    description: "A formal cover page with placeholders for author and department.",
    document: academicReport as Record<string, unknown>
  },
  {
    id: "conference_note",
    label: "Conference Summary",
    description: "Quick summary layout with merge points for date and details.",
    document: conferenceNote as Record<string, unknown>
  }
];

export const getTemplateById = (id: string) => templateDefinitions.find((template) => template.id === id);

export const getTemplates = () => templateDefinitions;
