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
    systematicBridge?: {
      composePaper: (payload: { runDir: string; checklistPath: string }) => Promise<{
        status: string;
        message?: string;
      }>;
      prismaAudit: (payload: { runDir: string }) => Promise<{
        status: string;
        message?: string;
        report?: Record<string, unknown>;
      }>;
      prismaRemediate: (payload: { runDir: string }) => Promise<{
        status: string;
        message?: string;
        updated?: number;
      }>;
      adjudicateConflicts: (payload: { runDir: string; resolvedCount?: number }) => Promise<{
        status: string;
        message?: string;
        resolved?: number;
        unresolved?: number;
      }>;
      executeSteps1to15: (payload: { runDir: string; checklistPath: string; reviewerCount?: number }) => Promise<{
        status: string;
        message?: string;
        report?: Record<string, unknown>;
      }>;
      fullRun: (payload: { runDir: string; checklistPath: string; maxIterations?: number; minPassPct?: number; maxFail?: number }) => Promise<{
        status: string;
        message?: string;
        report?: Record<string, unknown>;
        iterations?: number;
      }>;
    };
    commandBridge?: {
      dispatch: (payload: { phase: string; action: string; payload?: unknown }) => Promise<unknown>;
    };
    agentBridge?: {
      run: (payload: { text: string; context?: Record<string, unknown> }) => Promise<{
        status: string;
        reply?: string;
        message?: string;
        action?: { phase: string; action: string; payload?: Record<string, unknown> };
      }>;
      transcribeVoice: (payload: { audioBase64: string; mimeType?: string; language?: string }) => Promise<{
        status: string;
        text?: string;
        message?: string;
      }>;
      nativeAudioStart: () => Promise<{
        status: string;
        backend?: string;
        sampleRate?: number;
        message?: string;
      }>;
      nativeAudioStop: () => Promise<{
        status: string;
        audioBase64?: string;
        mimeType?: string;
        bytes?: number;
        backend?: string;
        sampleRate?: number;
        message?: string;
      }>;
      speakText: (payload: { text: string; voice?: string; speed?: number; format?: string; model?: string }) => Promise<{
        status: string;
        text: string;
        audioBase64?: string;
        mimeType?: string;
        message?: string;
      }>;
      resolveIntent: (payload: { text: string; context?: Record<string, unknown> }) => Promise<{
        status: string;
        message?: string;
        intent?: Record<string, unknown>;
      }>;
      executeIntent: (payload: { intent: Record<string, unknown>; context?: Record<string, unknown>; confirm?: boolean }) => Promise<{
        status: string;
        message?: string;
        result?: Record<string, unknown>;
        function?: string;
      }>;
      dictationStart: () => Promise<{ status: string; sessionId?: number; message?: string }>;
      dictationStop: () => Promise<{ status: string; sessionId?: number; text?: string; message?: string }>;
      dictationAudio: (audio: ArrayBuffer) => void;
      getFeatures: () => Promise<{ status: string; tabs?: unknown[]; message?: string }>;
      refineCodingQuestions: (payload: {
        currentQuestions?: string[];
        feedback?: string;
        contextText?: string;
      }) => Promise<{ status: string; message?: string; questions?: string[] }>;
      generateEligibilityCriteria: (payload: {
        userText?: string;
        collectionName?: string;
        contextText?: string;
        researchQuestions?: string[];
      }) => Promise<{ status: string; message?: string; inclusion_criteria?: string[]; exclusion_criteria?: string[] }>;
      supervisorPlan: (payload: { text?: string; context?: Record<string, unknown> }) => Promise<{
        status: string;
        message?: string;
        source?: string;
        plan?: Record<string, unknown>;
      }>;
      supervisorExecute: (payload: { plan?: Record<string, unknown>; context?: Record<string, unknown> }) => Promise<{
        status: string;
        message?: string;
        result?: Record<string, unknown>;
      }>;
      getIntentStats: () => Promise<{ status: string; stats?: Record<string, unknown>; message?: string }>;
      getWorkflowBatchJobs: () => Promise<{ status: string; jobs?: Record<string, unknown>[]; message?: string }>;
      clearWorkflowBatchJobs: () => Promise<{ status: string; cleared?: number; message?: string }>;
      getFeatureHealthCheck: () => Promise<{ status: string; health?: Record<string, unknown>; message?: string }>;
      getFeatureJobs: () => Promise<{ status: string; jobs?: Record<string, unknown>[]; message?: string }>;
      cancelFeatureJob: (payload: { jobId: string }) => Promise<{ status: string; job?: Record<string, unknown>; message?: string }>;
      getBatchExplorer: () => Promise<{ status: string; batches?: Record<string, unknown>[]; message?: string }>;
      getBatchDetail: (payload: { jobId?: string; batchId?: string }) => Promise<{ status: string; batch?: Record<string, unknown>; message?: string }>;
      deleteBatch: (payload: { jobId?: string; batchId?: string }) => Promise<{ status: string; deleted?: number; message?: string }>;
      logChatMessage: (payload: { role: "user" | "assistant"; text: string; tone?: "error"; at?: number }) => Promise<{ status: string; message?: string }>;
      getChatHistory: () => Promise<{ status: string; messages?: Array<{ role: "user" | "assistant"; text: string; tone?: "error"; at: number }>; message?: string }>;
      clearChatHistory: () => Promise<{ status: string; cleared?: number; message?: string }>;
      openLocalPath: (payload: { path: string }) => Promise<{ status: string; path?: string; message?: string }>;
      onFeatureJobStatus: (callback: (payload: Record<string, unknown>) => void) => () => void;
      onDictationDelta: (callback: (payload: { sessionId?: number; delta?: string; transcript?: string }) => void) => () => void;
      onDictationCompleted: (callback: (payload: { sessionId?: number; text?: string }) => void) => () => void;
      onDictationError: (callback: (payload: { sessionId?: number; message?: string }) => void) => () => void;
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
      listAudioInputs: () => Promise<{
        status: string;
        inputs: Array<{ id: string; label: string; backend: "pulse" | "alsa"; isDefault?: boolean }>;
        message?: string;
      }>;
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
      readBinaryFile?: (request: { sourcePath: string; maxBytes?: number }) => Promise<{
        success: boolean;
        dataBase64?: string;
        bytes?: number;
        filePath?: string;
        error?: string;
      }>;
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
