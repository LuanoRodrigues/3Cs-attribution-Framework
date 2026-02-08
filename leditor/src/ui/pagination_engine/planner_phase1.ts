import type { PaginationSnapshot } from "./snapshot.ts";

export type PaginationPlan = {
  pageCount: number;
  reason: string;
};

// Phase 1: overflow-safe layout of main content (no joins/underfill merges).
// TODO: replace legacy pagination logic with a deterministic planner.
export const planPhase1 = (_snapshot: PaginationSnapshot): PaginationPlan | null => {
  return null;
};
