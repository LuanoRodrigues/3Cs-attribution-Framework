import { templateDefinitions } from "./generated_templates.ts";
import type { TemplateDefinition } from "./types.ts";

export const getTemplateById = (id: string) => templateDefinitions.find((template) => template.id === id);

export const getTemplates = () => templateDefinitions;
export type { TemplateDefinition };
