import type { AnalysePageId, AnalyseAction, AnalyseRoundId, AnalyseState, AnalysePageAction, AnalysePageContext } from "./types";
import { renderBatchesPage } from "../pages/analyse/batches";
import { renderPhasesPage } from "../pages/analyse/phases";
import { renderDashboardPage } from "../pages/analyse/dashboard";
import { renderSectionsPage } from "../pages/analyse/sections";
import { renderAudioPage } from "../pages/analyse/audio";

export interface AnalysePageDefinition {
  id: AnalysePageId;
  action: AnalysePageAction;
  label: string;
  description: string;
  render: (container: HTMLElement, state: AnalyseState, ctx: AnalysePageContext) => void;
}

const actionForRound = (roundId: AnalyseRoundId): AnalysePageAction => {
  switch (roundId) {
    case "r1":
      return "analyse/open_sections_r1";
    case "r2":
      return "analyse/open_sections_r2";
    case "r3":
      return "analyse/open_sections_r3";
  }
};

const makeSectionsPage = (roundId: AnalyseRoundId): AnalysePageDefinition => {
  const id = `sections_${roundId}` as AnalysePageId;
  const action = actionForRound(roundId);
  const roundLabel = roundId.toUpperCase();
  return {
    id,
    action,
    label: `Sections ${roundLabel}`,
    description: `Section navigator for ${roundLabel}`,
    render: (container, state, ctx) => {
      renderSectionsPage(container, state, roundId, ctx);
    }
  };
};

export const analysePageRegistry: AnalysePageDefinition[] = [
  {
    id: "corpus",
    action: "analyse/open_corpus",
    label: "Corpus",
    description: "Corpus batches with filters and batch cards",
    render: (container, state, ctx) => renderSectionsPage(container, state, "r1", ctx, { source: "corpus" })
  },
  {
    id: "batches",
    action: "analyse/open_batches",
    label: "Batches",
    description: "Batch card lane with exports",
    render: (container, state, ctx) => renderBatchesPage(container, state, ctx)
  },
  {
    id: "phases",
    action: "analyse/open_phases",
    label: "Phases",
    description: "Three-panel Analyse workflow (filters, cards, sections)",
    render: (container, state, ctx) => renderPhasesPage(container, state, ctx)
  },
  {
    id: "dashboard",
    action: "analyse/open_dashboard",
    label: "Dashboard",
    description: "Run summaries and drill-ins",
    render: (container, state, ctx) => renderDashboardPage(container, state, ctx)
  },
  makeSectionsPage("r1"),
  makeSectionsPage("r2"),
  makeSectionsPage("r3"),
  {
    id: "audio",
    action: "analyse/open_audio",
    label: "Audio",
    description: "Audio settings and playback",
    render: (container, state, ctx) => renderAudioPage(container, state, ctx)
  }
];

export function getPageByAction(action: AnalyseAction): AnalysePageDefinition | undefined {
  return analysePageRegistry.find((page) => page.action === action);
}

export function getPageById(id: AnalysePageId): AnalysePageDefinition | undefined {
  return analysePageRegistry.find((page) => page.id === id);
}
