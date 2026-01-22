import type {
  AnalyseRun,
  AnalyseDatasets,
  BatchRecord,
  SectionRecord,
  SectionLevel,
  RunMetrics
} from "../analyse/types";
import type { ProjectContext, ProjectInitialization, RecentProjectRecord, SessionData, SessionMenuAction } from "../session/sessionTypes";
import type { RetrievePaperSnapshot } from "../shared/types/retrieve";

export {};

declare global {
  interface Window {
    currentProjectPath?: string;
    analyseBridge?: {
      dispatch: (payload: { phase: string; action: string; payload?: unknown }) => Promise<unknown>;
      data: {
        discoverRuns: (baseDir?: string) => Promise<{ runs: AnalyseRun[]; sectionsRoot: string | null }>;
        buildDatasetHandles: (runPath: string) => Promise<AnalyseDatasets>;
        loadBatches: (runPath: string) => Promise<BatchRecord[]>;
        loadSections: (runPath: string, level: SectionLevel) => Promise<SectionRecord[]>;
        summariseRun: (runPath: string) => Promise<RunMetrics>;
        getDefaultBaseDir: () => Promise<string>;
      };
    };
    commandBridge?: {
      dispatch: (payload: { phase: string; action: string; payload?: unknown }) => Promise<unknown>;
    };
    appBridge?: {
      ping: () => string;
    };
    retrieveBridge?: {
      tags: {
        list: (paperId: string) => Promise<string[]>;
        add: (payload: { paper: RetrievePaperSnapshot; tag: string }) => Promise<string[]>;
        remove: (payload: { paperId: string; tag: string }) => Promise<string[]>;
      };
    };
    settingsBridge?: {
      getAll: () => Promise<Record<string, unknown>>;
      getValue: (key: string, defaultValue?: unknown) => Promise<unknown>;
      setValue: (key: string, value: unknown) => Promise<{ status: string }>;
      unlockSecrets: (passphrase: string) => Promise<{ success: boolean }>;
      getSecret: (name: string) => Promise<string | undefined>;
      setSecret: (name: string, value: string) => Promise<{ success: boolean }>;
      exportBundle: (zipPath: string, includeSecrets?: boolean) => Promise<string>;
      importBundle: (zipPath: string) => Promise<{ success: boolean }>;
      getPaths: () => Promise<{ appDataPath: string; configPath: string; settingsFilePath: string; exportPath: string }>;
      openSettingsWindow: (section?: string) => Promise<{ status: string }>;
    };
    sessionBridge?: {
      onMenuAction: (callback: (action: SessionMenuAction) => void) => () => void;
    };
    projectBridge?: {
      initialize: () => Promise<ProjectInitialization>;
      createProject: (payload: { directory: string; name: string; useParent?: boolean }) => Promise<ProjectContext>;
      openProject: (projectPath: string) => Promise<ProjectContext>;
      saveSession: (payload: { projectPath: string; session: SessionData }) => Promise<{ status: string }>;
      exportProject: (payload: { projectPath: string; destination?: string }) => Promise<{ path: string }>;
      importProject: (payload: { archivePath: string; destination: string }) => Promise<ProjectContext>;
      pickArchive: () => Promise<string | null>;
      pickDirectory: (options?: { defaultPath?: string }) => Promise<string | null>;
      getDefaultDirectory: () => Promise<string>;
      listRecentProjects: () => Promise<RecentProjectRecord[]>;
    };
  }
}

export type SettingsBridge = NonNullable<Window["settingsBridge"]>;
