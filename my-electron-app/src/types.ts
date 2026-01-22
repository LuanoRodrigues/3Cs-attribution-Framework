import type { RetrieveQuery } from "./shared/types/retrieve";

export interface RibbonCommand {
  phase: string;
  action: string;
  payload?: Record<string, unknown> | RetrieveQuery;
}

export interface RibbonAction {
  id: string;
  label: string;
  hint: string;
  iconId: string;
  command: RibbonCommand;
  group?: string;
  opensPanel?: boolean;
  panel?: {
    title: string;
    description?: string;
  };
}

export interface RibbonTab {
  phase: string;
  label: string;
  description?: string;
  actions: RibbonAction[];
}
