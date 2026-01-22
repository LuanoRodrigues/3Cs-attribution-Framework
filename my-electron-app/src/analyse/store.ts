import type { AnalyseDatasets, AnalyseRun, AnalyseState } from "./types";
import { ANALYSE_ACTIVE_RUN_PATH_KEY } from "./constants";
import { createAnalyseState } from "./types";

export type AnalyseListener = (state: AnalyseState) => void;

export class AnalyseStore {
  private state: AnalyseState;
  private listeners: AnalyseListener[] = [];

  constructor(initial?: AnalyseState) {
    this.state = initial ? { ...initial } : createAnalyseState();
  }

  getState(): AnalyseState {
    return this.state;
  }

  subscribe(listener: AnalyseListener): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== listener);
    };
  }

  update(patch: Partial<AnalyseState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  setRuns(runs: AnalyseRun[], sectionsRoot?: string): void {
    this.update({ runs, sectionsRoot });
  }

  setActiveRun(run: AnalyseRun | null, datasets?: AnalyseDatasets): void {
    try {
      if (run?.path) {
        window.localStorage.setItem(ANALYSE_ACTIVE_RUN_PATH_KEY, run.path);
      }
    } catch {
      // ignore storage failures
    }
    this.update({
      activeRunId: run?.id,
      activeRunPath: run?.path,
      themesDir: run?.path,
      datasets
    });
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn(this.state));
  }
}
