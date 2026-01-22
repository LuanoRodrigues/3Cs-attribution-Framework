import type { EditorHandle } from "./leditor";

export type PluginId = string;

export type EditorPlugin = {
  id: PluginId;
  tiptapExtensions?: any[];
  commands?: Record<string, (editorHandle: EditorHandle, args?: any) => void>;
  toolbarItems?: ToolbarItemDef[];
  onInit?: (editorHandle: EditorHandle) => void;
};

export type ToolbarItemDef = {
  type: "button" | "sep";
  id?: string;
};
