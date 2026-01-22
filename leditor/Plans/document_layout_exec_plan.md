# document_layout_exec_plan.md — Apply Document Layout Spec + True Pagination

## Goal
Implement the full `Plans/document_layout.json` spec and `Plans/Document_layout.md` plan to deliver Word‑like structural pagination, layout tab wiring, and deterministic page geometry in the Electron renderer.

## Success criteria
1. Content flows into real page containers with deterministic block pagination and manual breaks.
2. Layout tab controls update a single DocumentLayoutState store and trigger repagination.
3. Page geometry (size, margins, gutter, header/footer distances) is derived from spec and applied via CSS tokens.
4. Selection/caret stability is preserved across repagination.
5. Incremental pagination and composition deferral are in place.

## Constraints
- Must follow the declarative spec in `Plans/document_layout.json` as source of truth.
- Maintain schema-based editor architecture (TipTap/ProseMirror).
- No heuristic hiding; deterministic rules only.
- Electron renderer only; no network dependencies.

## Scope
- `Plans/document_layout.json`
- `src/ui/feature_flags.ts`
- `src/ui/pagination/*` (new module family)
- `src/ui/a4_layout.ts`
- `src/ui/layout_engine.ts`
- `src/ui/layout_context.ts`
- `src/ui/renderer.ts`
- `src/ui/ribbon_layout.ts` and layout tab JSON wiring
- `src/api/command_map.ts`

## Steps
1. **Phase 0 — Scaffolding + state store**  
   Add pagination feature flags and a `DocumentLayoutState` store reading `document_layout.json`, with CSS token application utilities.
2. **Phase 1 — Structural pages + block pagination MVP**  
   Implement page host DOM and block pagination (manual page breaks, page size/margins applied via padding).
3. **Phase 2 — Incremental pagination + dirty tracking**  
   Mutation observer + repaginate‑from‑dirty block logic with RAF scheduler.
4. **Phase 3 — Inline split for overfull blocks**  
   Range‑based inline splitting for eligible blocks.
5. **Phase 4 — Section settings + odd/even parity**  
   Section break handling and per‑section metrics.
6. **Phase 5 — Layout tab wiring + tokens**  
   Wire layout commands to state store and trigger repagination; expose UI feedback.

## Risk notes
- Selection stability across DOM moves can regress without robust bookmarks.
- Incorrect spec → px conversion can cause off‑by‑one pagination loops.
- Incremental repagination may invalidate earlier pages if dirty‑tracker mapping is wrong.

## Validation
- `npm start` with manual checks:
  - typing across page boundary
  - page break insertion
  - layout tab margin/orientation updates
  - selection stability

## Rollback
1. `git checkout -- src/ui/feature_flags.ts src/ui/a4_layout.ts src/ui/layout_engine.ts src/ui/layout_context.ts src/ui/renderer.ts src/api/command_map.ts`
2. `git checkout -- src/ui/pagination`
3. `git checkout -- Plans/document_layout_exec_plan.md`

## Progress
- Phase 0 — Scaffolding + state store: NOT STARTED
- Phase 1 — Structural pages + block pagination MVP: NOT STARTED
- Phase 2 — Incremental pagination + dirty tracking: NOT STARTED
- Phase 3 — Inline split for overfull blocks: NOT STARTED
- Phase 4 — Section settings + odd/even parity: NOT STARTED
- Phase 5 — Layout tab wiring + tokens: NOT STARTED
