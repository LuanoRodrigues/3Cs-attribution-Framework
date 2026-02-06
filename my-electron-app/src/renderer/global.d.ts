import type {
  AnalyseRun,
  AnalyseDatasets,
  BatchRecord,
  BatchPayload,
  SectionRecord,
  SectionLevel,
  RunMetrics
} from "../analyse/types";
import type { ProjectContext, ProjectInitialization, RecentProjectRecord, SessionData, SessionMenuAction } from "../session/sessionTypes";
import type { RetrievePaperSnapshot } from "../shared/types/retrieve";
import type { RetrieveDataHubState } from "../session/sessionTypes";

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
        loadSectionsPage: (
          runPath: string,
          level: SectionLevel,
          offset: number,
          limit: number
        ) => Promise<{ sections: SectionRecord[]; hasMore: boolean; nextOffset: number }>;
        querySections: (
          runPath: string,
          level: SectionLevel,
          query: unknown,
          offset: number,
          limit: number
        ) => Promise<{
          sections: SectionRecord[];
          totalMatches: number;
          hasMore: boolean;
          nextOffset: number;
          facets: Record<string, Record<string, number>>;
        }>;
        loadBatchPayloadsPage: (
          runPath: string,
          offset: number,
          limit: number
        ) => Promise<{ payloads: BatchPayload[]; hasMore: boolean; nextOffset: number }>;
        getDirectQuotes: (
          runPath: string,
          ids: string[]
        ) => Promise<{ entries: Record<string, unknown>; path: string | null }>;
        loadDqLookup: (runPath: string) => Promise<{ data: Record<string, unknown>; path: string | null }>;
        summariseRun: (runPath: string) => Promise<RunMetrics>;
        getDefaultBaseDir: () => Promise<string>;
        getAudioCacheStatus: (runId: string | undefined, keys: string[]) => Promise<{ cachedKeys: string[] }>;
        addAudioCacheEntries: (runId: string | undefined, entries: unknown[]) => Promise<{ cachedKeys: string[] }>;
        listCachedTables: () => Promise<
          Array<{ fileName: string; filePath: string; mtimeMs: number; rows: number; cols: number }>
        >;
        runAiOnTable: (payload: unknown) => Promise<unknown>;
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
      citationNetwork: {
        fetch: (payload: { record: RetrieveRecord }) => Promise<import("../shared/types/retrieve").RetrieveCitationNetwork>;
      };
      snowball: {
        run: (payload: { record: RetrieveRecord; direction: "references" | "citations" }) => Promise<
          import("../shared/types/retrieve").RetrieveCitationNetwork
        >;
      };
      oa: {
        lookup: (payload: { doi: string }) => Promise<{ status?: string; url?: string; license?: string }>;
      };
      library: {
        save: (payload: { record: RetrieveRecord }) => Promise<{ status: string; message?: string }>;
        export: (payload: { rows: RetrieveRecord[]; format: "csv" | "xlsx" | "ris"; targetPath: string }) => Promise<{
          status: string;
          message?: string;
        }>;
      };
    };
    settingsBridge?: {
      getAll: () => Promise<Record<string, unknown>>;
      getValue: (key: string, defaultValue?: unknown) => Promise<unknown>;
      setValue: (key: string, value: unknown) => Promise<{ status: string }>;
      unlockSecrets: (passphrase: string) => Promise<{ success: boolean }>;
      getSecret: (name: string) => Promise<string | undefined>;
      setSecret: (name: string, value: string) => Promise<{ success: boolean }>;
      getDotEnvStatus: () => Promise<{ found: boolean; paths: string[]; values: Record<string, string> }>;
      exportBundle: (zipPath: string, includeSecrets?: boolean) => Promise<string>;
      importBundle: (zipPath: string) => Promise<{ success: boolean }>;
      getPaths: () => Promise<{ appDataPath: string; configPath: string; settingsFilePath: string; exportPath: string }>;
      openSettingsWindow: (section?: string) => Promise<{ status: string }>;
      clearCache: () => Promise<{ cleared: string[]; failed: string[] }>;
    };
    leditorHost?: {
      exportDOCX: (request: { docJson: object; options?: Record<string, unknown> }) => Promise<unknown>;
      exportPDF: (request: { html: string; options?: { suggestedPath?: string; prompt?: boolean } }) => Promise<unknown>;
      exportLEDOC: (request: { payload: unknown; options?: { targetPath?: string; suggestedPath?: string; prompt?: boolean } }) => Promise<unknown>;
      importDOCX: (request?: { options?: { sourcePath?: string; prompt?: boolean } }) => Promise<unknown>;
      importLEDOC: (request?: { options?: { sourcePath?: string; prompt?: boolean } }) => Promise<unknown>;
      listLedocVersions?: (request: { ledocPath: string }) => Promise<unknown>;
      createLedocVersion?: (request: {
        ledocPath: string;
        reason?: string;
        label?: string;
        note?: string;
        payload?: any;
        throttleMs?: number;
        force?: boolean;
      }) => Promise<unknown>;
      restoreLedocVersion?: (request: { ledocPath: string; versionId: string; mode?: "replace" | "copy" }) => Promise<unknown>;
      deleteLedocVersion?: (request: { ledocPath: string; versionId: string }) => Promise<unknown>;
      pinLedocVersion?: (request: { ledocPath: string; versionId: string; pinned: boolean }) => Promise<unknown>;
      insertImage: () => Promise<unknown>;
      getDefaultLEDOCPath: () => Promise<string>;
      readFile: (request: { sourcePath: string }) => Promise<{ success: boolean; data?: string; error?: string }>;
      writeFile: (request: { targetPath: string; data: string }) => Promise<{ success: boolean; error?: string }>;
      getAiStatus: () => Promise<unknown>;
      registerFootnoteHandlers: (handlers: { open?: () => void; toggle?: () => void; close?: () => void }) => void;
      openFootnotePanel: () => void;
      toggleFootnotePanel: () => void;
      closeFootnotePanel: () => void;
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
    __retrieveDataHubState?: RetrieveDataHubState;
  }
}

export type SettingsBridge = NonNullable<Window["settingsBridge"]>;
