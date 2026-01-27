export type CoderStatus = "Included" | "Maybe" | "Excluded";

export type CoderPayload = Record<string, unknown> & {
  title?: string;
  text?: string;
  html?: string;
  section_html?: string;
  anchor_meta?: Record<string, Record<string, string>>;
};

export interface BaseNode {
  id: string;
  name: string;
  note?: string;
  editedHtml?: string;
  updatedUtc?: string;
}

export interface FolderNode extends BaseNode {
  type: "folder";
  children: CoderNode[];
}

export interface ItemNode extends BaseNode {
  type: "item";
  status: CoderStatus;
  payload: CoderPayload;
}

export type CoderNode = FolderNode | ItemNode;

export interface CoderState {
  version: number;
  nodes: CoderNode[];
  collapsedIds?: string[];
}

export interface PersistentCoderState {
  state: CoderState;
  baseDir: string;
  statePath: string;
}

export interface MoveSpec {
  nodeId: string;
  targetParentId: string | null;
  targetIndex?: number;
}

export interface NodePath {
  parent: FolderNode | null;
  index: number;
  node: CoderNode;
}

export interface ExportOptions {
  onlyStatus?: Set<CoderStatus>;
}

export const CODER_STATUSES: CoderStatus[] = ["Included", "Maybe", "Excluded"];
export const CODER_STORAGE_KEY = "annotarium-coder-state";
export const CODER_MIME = "application/annotarium-payload";

export const CODER_SCOPE_SEPARATOR = "::";
export const CODER_SCOPE_DEFAULT = "global";

export type CoderScopeId = string;
