## Goal
Bridge the current LEditor sidebar to a real multi-agent workflow built on `@openai/agents`, with tool use (search/code), streaming IPC, strict schemas, and TipTap-safe edits.

## Constraints
- Offline-first: graceful fallback when keys/network absent.
- Keep existing command IDs (`refine`, `shorten`, `sources`, lexicon) stable.
- All edits via TipTap transactions; undoable; no DOM mutations.

## Workstream A — Foundation
- [ ] Add deps: `@openai/agents`, `zod`.
- [ ] Backend runner (Electron main/preload) hosting `Runner` + agent graph; expose IPC `agent.runWorkflow`.
- [ ] Tool adapters:
  - Web search (OpenAI `webSearchTool`), approx location only.
  - Code interpreter (sandboxed tmp; no fs writes beyond tmp).
  - TipTap doc fetch (JSON snapshot + selection text).
- [ ] Centralize provider/model selection; map env keys (`OPENAI_API_KEY`, `DEEP_SEEK_API_KEY`, `MISTRAL_API_KEY`, `LU_GEMINI_API_KEY`).

## Workstream B — Workflow Graph
- [ ] Agents: `queryRewrite`, `classify`, `internalQA`, `externalFactFinding`, fallback `agent`.
- [ ] Guardrails: token caps, temperature defaults, tracing metadata, zod-validated outputs.
- [ ] `runWorkflow(input_text, docContext)` pipeline:
  - rewrite → classify (Q&A vs fact-finding vs other)
  - route: internal QA (search only) / external fact finding (search + code) / fallback assistant
  - return normalized payload `{text, citations?, actions?, meta}` + structured edit proposals.

## Workstream C — UI & Wiring
- [ ] agent_sidebar uses IPC `agent.runWorkflow` instead of local stub; keep optimistic streaming UI.
- [ ] Command mapping:
  - refine/paraphrase/shorten/proofread/substantiate → workflow with injected selection text.
  - check_sources → emits `sourceChecksThread` items.
  - lexicon (define/synonyms/antonyms/explain) → lightweight run; no sidebar open.
- [ ] Provider/model picker surfaced; show run metadata (provider, model, ms).
- [ ] Tabs/boxes preserved; Accept/Reject applies TipTap transactions (batch history).

## Workstream D — Persistence & Safety
- [ ] Persist conversation + source checks into `.ledoc` with workflow metadata for replay.
- [ ] Retries/backoff; clear toasts for missing/invalid keys or unsupported models.
- [ ] Logging: `[agent][runWorkflow][debug]` requestId/provider/model/ms/tokens; no document text.

## Workstream E — Validation
- [ ] Typecheck + build.
- [ ] Verbose debug smoke run with mock keys: commands run; source checks render/persist; undo/redo after accept/reject.
- [ ] Minimal unit for router/classifier if feasible.

## Out-of-scope (now)
- Collaborative CRDT broadcast of provisional AI edits.
- PDF agent output or DOCX ingestion changes.
