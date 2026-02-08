import type { PaginationSnapshot } from "./snapshot.ts";
import type { PaginationPlan } from "./planner_phase1.ts";

// Phase 2: underfill optimization (joins/pullups) once stable.
// TODO: replace legacy pagination logic with a deterministic planner.
export const planPhase2 = (_snapshot: PaginationSnapshot, _basePlan?: PaginationPlan | null): PaginationPlan | null => {
  return null;
};
