import { DEFAULT_COLLECTION_NAME } from "./constants";

export type AnalyseRoundId = "r1" | "r2" | "r3";

export interface AnalyseRun {
  id: string;
  label: string;
  path: string;
  hasBatches: boolean;
  hasSections: boolean;
  hasL2: boolean;
  hasL3?: boolean;
}


export type SectionLevel = "r1" | "r2" | "r3";

export interface BatchPayload {
  id: string;
  text: string;
  page?: number;
  [key: string]: unknown;
}

export interface BatchRecord {
  id: string;
  theme?: string;
  potentialTheme?: string;
  evidenceType?: string;
  size?: number;
  payloads: BatchPayload[];
  prompt?: string;
  rqQuestion?: string;
}

export interface SectionRecord {
  id: string;
  html: string;
  meta: Record<string, unknown>;
  route?: string;
  title: string;
  rq?: string;
  goldTheme?: string;
  evidenceType?: string;
  routeValue?: string;
  potentialTheme?: string;
  potentialTokens?: string[];
  tags?: string[];
  paraphrase?: string;
  directQuote?: string;
  researcherComment?: string;
  firstAuthorLast?: string;
  authorSummary?: string;
  author?: string;
  year?: string;
  source?: string;
  titleText?: string;
  url?: string;
  itemKey?: string;
  page?: number;
}

export interface RunMetrics {
  batches: number;
  sectionsR1: number;
  sectionsR2: number;
  sectionsR3: number;
}

export interface AnalyseDatasets {
  batches?: string;
  sectionsR1?: string;
  sectionsR2?: string;
  sectionsR3?: string;
  audio?: string;
}

export interface AudioSettings {
  provider: string;
  voice: string;
  rate: number;
  volume: number;
}

export type AnalysePageId =
  | "corpus"
  | "batches"
  | "phases"
  | "sections_r1"
  | "sections_r2"
  | "sections_r3"
  | "dashboard"
  | "audio";

export type AnalysePageAction =
  | "analyse/open_corpus"
  | "analyse/open_batches"
  | "analyse/open_phases"
  | "analyse/open_sections_r1"
  | "analyse/open_sections_r2"
  | "analyse/open_sections_r3"
  | "analyse/open_dashboard"
  | "analyse/open_audio";

export type AnalyseToolAction =
  | "analyse/open_coder"
  | "analyse/open_pdf_viewer"
  | "analyse/open_preview";

export type AnalyseUtilityAction =
  | "analyse/run_pipeline"
  | "analyse/reload_index"
  | "analyse/set_effective_dir"
  | "analyse/export_html_page"
  | "analyse/export_html_selection"
  | "analyse/copy_html_page"
  | "analyse/copy_html_selection"
  | "analyse/audio_read_current"
  | "analyse/audio_stop"
  | "analyse/audio_cache_status"
  | "analyse/ai_open"
  | "analyse/ai_run_selection"
  | "analyse/ai_run_batch";

export type AnalyseAction = AnalysePageAction | AnalyseToolAction | AnalyseUtilityAction;

export interface AnalysePageContext {
  updateState: (patch: Partial<AnalyseState>) => void;
  dispatch: (action: AnalyseAction, payload?: Record<string, unknown>) => void;
}

export interface AnalyseState {
  activePageId: AnalysePageId;
  activeRound?: AnalyseRoundId;
  activeRunId?: string;
  activeRunPath?: string;
  themesDir?: string;
  datasetPath?: string;
  baseDir?: string;
  collection?: string;
  sectionsRoot?: string;
  datasets?: AnalyseDatasets;
  runs: AnalyseRun[];
  indexLoaded?: boolean;
  stats?: Record<string, unknown>;
  audio?: AudioSettings;
  lastAction?: AnalyseAction;
  lastPayload?: unknown;
}

export function createAnalyseState(): AnalyseState {
  return {
    activePageId: "corpus",
    activeRound: "r1",
    runs: [],
    indexLoaded: false,
    stats: {},
    audio: { provider: "system", voice: "default", rate: 1, volume: 1 }
  };
}



