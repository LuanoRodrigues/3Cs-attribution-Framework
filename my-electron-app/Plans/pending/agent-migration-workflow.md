## Goal
Bridge the existing LEditor agent sidebar to a real multi-agent workflow built on `@openai/agents`, including tool-driven web search and code execution, while keeping TipTap transactions safe and deterministic.

## Constraints
- Keep offline-first: fall back gracefully when keys or network are absent.
- Preserve current command IDs (`refine`, `shorten`, `sources`, lexicon) as entry points; avoid UI breakage.
- Never bypass TipTap schema; all edits must stay transactional and undoable.

## Workstream A — Foundation
- [ ] Add dependency: `@openai/agents` (and `zod` if not already bundled).
- [ ] Create backend runner module (Electron main or preload) that hosts `Runner` and agent graph; expose IPC bridge `agent.runWorkflow`.
- [ ] Define tool adapters for:
  - Web search (OpenAI webSearchTool) — respect approximate location only.
  - Code interpreter (sandboxed, no file system writes beyond tmp).
  - TipTap document fetch: JSON snapshot + selection text.
- [ ] Centralize provider/model selection; map env keys (`OPENAI_API_KEY`, `DEEP_SEEK_API_KEY`, `MISTRAL_API_KEY`, `LU_GEMINI_API_KEY`) to agent configs.

## Workstream B — Workflow Graph
- [ ] Implement reusable agents per sample: `queryRewrite`, `classify`, `internalQA`, `externalFactFinding`, fallback `agent`.
- [ ] Add guardrails: max tokens, temperature defaults, tracing metadata, and structured outputs via `zod`.
- [ ] Compose main `runWorkflow(input_text, docContext)` that:
  - rewrites query
  - classifies (Q&A vs fact-finding vs other)
  - routes to internal QA (web search only) or external fact finding (web + code) or fallback assistant.
- [ ] Return normalized payload: `{text, citations?, actions?, meta}` plus structured change proposals.

## Workstream C — UI & Wiring
- [ ] In `agent_sidebar`, swap `runAgent` stub with IPC call to `agent.runWorkflow`; keep optimistic UI.
- [ ] Map command verbs:
  - `refine/paraphrase/shorten/proofread/substantiate` -> workflow with document selection injected as `input_text`.
  - `check_sources` -> specialized run that emits `sourceChecksThread` items.
  - Lexicon (define/synonyms/antonyms/explain) -> lightweight workflow; do not open panel.
- [ ] Surface provider/model picker from workflow state; show run metadata (provider, model, ms).
- [ ] Maintain tabs and boxes; accept/reject should apply TipTap transactions with history batching.

## Workstream D — Persistence & Safety
- [ ] Persist conversation + source checks into `.ledoc` (existing persistence hook); include workflow metadata for replay.
- [ ] Add retries/backoff and clear error toasts for missing keys or unsupported models.
- [ ] Logging: `[agent][runWorkflow][debug]` with requestId, provider, model, ms, tokens.

## Workstream E — Validation
- [ ] Typecheck + build.
- [ ] Smoke test verbose debug run with mock keys; verify:
  - commands execute without exceptions
  - source checks render and persist
  - undo/redo works after accept/reject
- [ ] Add minimal unit for workflow router (classification routing) if test harness allows.

## Out-of-scope (for now)
- Full collaborative CRDT broadcasting of provisional AI edits.
- PDF agent output or DOCX ingestion changes.
