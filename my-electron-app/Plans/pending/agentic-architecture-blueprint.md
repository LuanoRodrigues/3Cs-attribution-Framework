## Agentic Architecture Blueprint for LEditor

Comprehensive, implementation-oriented plan (keeps the original 15-phase depth, explicit file tree, and detailed guidance).  
Scope: upgrade the current single-call sidebar into a multi-agent, tool-using, provider-pluggable, streaming, persistent, and schema-safe system.

---

### Objectives
- Multi-agent orchestration with tool use (search/code) and streaming.
- Word-like fidelity: anchors/formatting preserved; edits are reviewable, undoable TipTap transactions.
- Provider agility: OpenAI (default), DeepSeek, Mistral, Gemini; offline-friendly fallbacks.
- Determinism & safety: strict JSON/patch schemas; fail-fast on deviation; no raw DOM.
- Persistence: conversations, source checks, model prefs stored in `.ledoc`; reload restores context.

### Role of the Agent in LEditor
- Orchestrates intents from tabs, buttons, slash commands, context menu.
- Produces green-underlined replacements with hover-old-text + Accept/Reject; anchors untouched.
- Verifies citations per anchor; offers claim rewrites; apply/dismiss in Sources tab.
- Runs lexicon (define/synonyms/antonyms/explain) inline near selection without opening the sidebar.
- Surfaces provider/model selection; shows key/availability status; degrades gracefully offline.

### Principles
- **Safety & determinism:** TipTap transactions only; schema validation; fail-fast on bad outputs.
- **Offline-first:** informative fallback when keys/network absent; local/offline provider slots.
- **Observability:** requestId/provider/model/latency/tokens/action/target logged; no doc text in logs.
- **Extensibility:** pluggable providers & tools; minimal UI churn for new actions.

### Feature Map / UX Requirements
- Entry points: Tabs (Chat, Refine, Paraphrase, Shorten, Proofread, Substantiate, Sources), slash commands, + menu, provider/model picker, send/stop.
- Actions:
  - Refine/Paraphrase/Shorten/Proofread/Substantiate → selection/paragraph(s)/section(s)/document; batchReplace/patch; Accept/Reject; Apply-all optional.
  - Check sources → paragraph text + anchors; verdict/justification, claimRewrite, suggestedReplacement; grouped by paragraph in Sources tab; click focuses anchor; persisted; apply/dismiss.
  - Lexicon (define/synonyms/antonyms/explain) → inline dropdown near selection; top-5 options + None; preserves formatting/anchors; clears highlight on dismiss.
  - Clear checks → wipe source-check thread + inline marks.
- Inline rules: show only new text (green underline); hover shows old; anchors verbatim; formatting preserved; undo/redo intact.
- Persistence: conversations, pending/accepted edits, source-check thread, provider/model pref; rehydrate on load; feature-flag rollout path.
- Errors: visible inline status on missing keys/network; tool/model errors never touch the doc; cancel supported.

---

### Architecture Layers
1) **Tools (adapters)**: web search; sandboxed code interpreter; doc fetch (JSON + text + anchors); apply-edit (batchReplace/patch via TipTap with history).
2) **Agent graph**: router + agents (queryRewrite, classify, internalQA, externalFactFinding, generalAssistant; refine/paraphrase/shorten/proofread/substantiate/checkSources/lexicon); optional safety agent.
3) **Orchestration (IPC)**: `agent.runWorkflow` in main/preload; request { actionId, target, textContext, docJson, anchors, userSettings, provider, model }; response { messages?, edits?, sourceChecks?, lexicon?, meta }; streaming + cancel.
4) **Persistence**: `.ledoc` stores conversations, source checks, accepted edits, provider/model prefs; lexicon cache (TTL).
5) **UI/UX**: sidebar chat with tabs/boxes; streaming; accept/reject; sources cards; inline green previews; lexicon dropdown near selection; model picker; + menu/slash; apply-all per tab; future unified “Edits” filter.

---

### 15-Phase Execution Plan (detailed)

**Phase 1 – Setup & Structure**  
Deps: add `@openai/agents`, `zod` (and typings).  
Dirs: create `src/agents/`, `src/agents/providers/`, `src/tools/`, optional `src/agents/promptTemplates.ts`.  
TS config: include new paths. No UI change yet.

**Phase 2 – Orchestrator Framework**  
Create `AgentOrchestrator` (src/agents/orchestrator.ts) to manage sessions, messages, tools, provider selection.  
Define message types (user/assistant/tool), session state, pending edits container.  
Agent interface (src/agents/agent.ts) for future sub-agents; router stub.

**Phase 3 – IPC & Streaming**  
Main: add `ipcMain.handle('agent-run')`, `ipcMain.on('agent-cancel')`; stream via `ipcRenderer.send('agent-stream-update')`.  
Preload: expose `window.agentAPI` { startAgent, cancelAgent, onUpdate }.  
Renderer: wire sidebar to new API; handle partials and done events.

**Phase 4 – Provider Abstraction**  
Interface `AIProvider` (startStream, capabilities).  
Implement OpenAI provider with function-calling + streaming; stubs for DeepSeek/Mistral/Gemini (mark availability by env).  
Provider registry + selection (default OpenAI).

**Phase 5 – Single-Turn Integration (compat mode)**  
Gather context (selection/paragraph/doc) via TipTap; build strict JSON prompt (`assistantText`, `edits` or `edit`).  
Stream assistantText to UI; buffer edits; fail-fast on invalid JSON; store pending suggestion (not applied).

**Phase 6 – Multi-Step Tool Use**  
Add tool schemas to OpenAI functions; implement searchTool (real or stub) + codeInterpreter (sandbox tmp, no net).  
Loop: model → function call → run tool → feed result → continue until final.  
Emit tool-status messages to UI; cap iterations; abort on unknown tool.

**Phase 7 – Sidebar Chat Upgrade**  
agent_sidebar: maintain message list; typing indicator; tool notes; accept/reject buttons bound to pending edits.  
Auto-scroll during streaming; disable input while inflight; send/stop button toggle.  
CSS updates for bubbles, tool notes, statuses.

**Phase 8 – Provider & Settings UI**  
Dropdown for provider/model; disable when key missing; show status.  
Optional temperature/strict toggles (safe defaults).  
Persist choice per session/document (stored in .ledoc meta).

**Phase 9 – Safe TipTap Application**  
Accept → TipTap transaction; reject → discard pending.  
Batch or single transaction; preserve marks/anchors; log sizes not content.  
Undo/redo verified.

**Phase 10 – Persistence**  
Extend `.ledoc` meta: { agentHistory, providerPref, sourceChecksThread, pendingEdits? }.  
Serialize on save; hydrate on load; schema versioning; per-doc orchestrator state.

**Phase 11 – Logging & Debug**  
Structured logs: requestId/provider/model/ms/tokens/action/target; tool invocations; apply results (sizes only).  
No doc text in logs; optional debug panel; rotate if file logging used.

**Phase 12 – Fail-Fast Guards**  
Strict JSON/schema validation (zod) for final + tool calls; reject on mismatch.  
Safety filters for obviously unsafe HTML; unknown tool → abort; provider errors surfaced inline.  
User cancel via AbortController/IPC.

**Phase 13 – Performance & Concurrency**  
Throttle DOM updates for streaming; batch token renders.  
Cancel on sidebar close/doc switch; queue or reject concurrent runs.  
Avoid blocking main; heavy local models in worker/process if added.

**Phase 14 – Structured Edit Schema**  
Move to patch: `{assistantText, edits:[{action:"replace", start, end, text}]}` relative to context.  
Map to TipTap positions; validate bounds/overlaps; fallback to simpler replace if provider lacks support.  
Update prompts + parsers; fail-fast on violations.

**Phase 15 – QA & Release**  
Unit tests: parser, router, provider stub, edit applier.  
Scenarios: offline, bad key, tool use, large selection, schema violation.  
UX polish: messages, warnings, apply-all per tab; doc updates (README/AGENTS).  
Feature flag rollout; remove deprecated code.

---

### Component & File Tree (target state)
```
src/
 ├─ ui/
 │   ├─ agent_sidebar.ts / .css     (chat UI, tabs, streaming, accept/reject, provider picker)
 │   ├─ ribbon_model.ts             (Agent toggle button wiring)
 │   └─ (optional) agent message subviews
 ├─ agents/                         (new)
 │   ├─ orchestrator.ts             (session, routing, streaming, tool loop, validation)
 │   ├─ agent.ts                    (interfaces/types)
 │   ├─ promptTemplates.ts          (prompts + JSON schemas)
 │   └─ providers/
 │        ├─ provider.ts            (interface, capabilities)
 │        ├─ openaiProvider.ts      (function-calling, streaming)
 │        ├─ deepseekProvider.ts    (stub/impl)
 │        ├─ mistralProvider.ts     (stub/impl, offline slot)
 │        └─ geminiProvider.ts      (stub/impl)
 ├─ tools/                          (new)
 │   ├─ searchTool.ts               (web/KB search adapter)
 │   ├─ codeTool.ts                 (sandboxed code interpreter)
 │   └─ index.ts                    (registry)
 ├─ plugins/
 │   ├─ aiAgent.ts                  (context gather, apply edits via commands)
 │   └─ sourceChecksFeedbacks.ts    (source thread, rewrites)
 ├─ editor/
 │   └─ source_check_badges.ts      (anchor highlighting, rewrites)
 ├─ api/
 │   ├─ command_map.ts              (agent/lexicon commands, source check commands)
 │   ├─ leditor.ts / editor_handle.ts (host bridge for apply-edit tool)
 ├─ electron/
 │   ├─ main.ts                     (IPC: agent-run/stream/cancel; key handling)
 │   └─ preload.ts                  (expose agentAPI, stream listener)
 ├─ persistence/                    (new or existing helpers for .ledoc meta)
 ├─ types/global.d.ts               (window.agentAPI typings)
 └─ docs/AGENTS.md, README          (update after delivery)
```

---

### Risks & Mitigations
- **Missing keys/network:** detect early, disable provider, show warning; offline-capable provider slot.  
- **Tool sandbox:** tmp-only, no net (unless explicit), constrained exec.  
- **Large docs:** chunk context; hard limits; instruct user to narrow scope.  
- **Model non-compliance:** strict zod validation; abort + surface error; never apply bad output.  
- **UI regressions:** feature-flag new runner; keep current deterministic path as fallback during rollout.

---

### Notes on Safety & Fidelity
- All edits go through TipTap transactions; no direct DOM.  
- Anchors and formatting preserved; schema-based patching.  
- Accept/Reject required; undo works.  
- Logs omit document text; only lengths/hashes where needed.  
- Offline-first posture: if no provider usable, communicate clearly, do not crash.
