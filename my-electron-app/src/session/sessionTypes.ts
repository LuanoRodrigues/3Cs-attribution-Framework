import type { LayoutSnapshot } from "../panels/PanelLayoutRoot";
import type { PanelGridState } from "../state/panelGrid";
import type { CodeStateSnapshot } from "../state/codeState";
import type { AnalyseState } from "../analyse/types";
import type { TabId } from "../layout/TabRibbon";
import type { PanelId } from "../layout/panelRegistry";
import type { DataHubTable } from "../shared/types/dataHub";

export interface RetrieveDataHubState {
  sourceType: "file" | "zotero";
  filePath?: string;
  collectionName?: string;
  table?: DataHubTable;
  loadedAt?: string;
}

export interface RetrieveSessionState {
  dataHub?: RetrieveDataHubState;
}

export interface SessionData {
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  layout: LayoutSnapshot;
  panelLayouts?: Record<PanelId, LayoutSnapshot>;
  panelGrid: PanelGridState;
  code: CodeStateSnapshot;
  analyse: AnalyseState;
  activeRibbonTab: TabId;
  activeToolId?: string;
  assets?: Record<string, string>;
  notes?: string;
  retrieve?: RetrieveSessionState;
}

export interface ProjectMetadata {
  projectId: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface ProjectContext {
  metadata: ProjectMetadata;
  session: SessionData;
}

export interface RecentProjectRecord {
  projectId: string;
  name: string;
  path: string;
  lastOpened: string;
}

export interface ProjectInitialization {
  project?: ProjectContext;
  recentProjects: RecentProjectRecord[];
  defaultSaveDirectory: string;
}

export type SessionMenuAction =
  | { type: "show-start-screen"; focus?: "create" | "open" | "recent" }
  | { type: "open-project" }
  | { type: "open-recent"; projectPath: string };
