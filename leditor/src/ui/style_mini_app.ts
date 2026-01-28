import type { EditorHandle } from "../api/leditor.ts";

export type StyleTemplate = {
  templateId: string;
  label: string;
  description: string;
};

type StyleMiniAppState = {
  editorHandle: EditorHandle;
};

type StyleMiniAppOptions = {
  mode?: "create" | "modify";
  templateId?: string;
};

const templates: StyleTemplate[] = [
  {
    templateId: "academic-heading",
    label: "Academic Heading",
    description: "Serif heading with modest spacing."
  },
  {
    templateId: "body-text",
    label: "Body Text",
    description: "Readable body style with comfortable leading."
  },
  {
    templateId: "quote",
    label: "Quote",
    description: "Indented block quote styling."
  }
];

export const getStyleTemplates = (): StyleTemplate[] => templates.slice();

export const openStyleMiniApp = (
  _anchor: HTMLElement,
  _state: StyleMiniAppState,
  options: StyleMiniAppOptions = {}
): void => {
  const label = options.mode === "create" ? "Create style" : options.mode === "modify" ? "Modify style" : "Apply style";
  const template = options.templateId ? `Template: ${options.templateId}` : "";
  window.alert(`${label} (style mini app placeholder). ${template}`.trim());
};
