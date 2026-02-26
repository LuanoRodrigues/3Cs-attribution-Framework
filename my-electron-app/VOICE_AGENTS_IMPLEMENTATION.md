# OpenAI Agents SDK + Realtime Voice Implementation (Annotarium)

Status: Implemented in `my-electron-app/src/renderer/index.ts`.

## 1) What this doc is for

This document defines how the app implements OpenAI Agents patterns for voice control and maps spoken phrases to UI actions across Retrieve/Zotero and the rest of the app.

## 2) Core agent model used in this app

This app uses Realtime Agents:

- `buildVoiceAgents()` builds:
  - `triageAgent` (primary)
  - `retrieveSpecialist`
  - `codingSpecialist`
- `buildVoiceActionTool()` exposes one command tool:
  - `execute_voice_command(command)`
- `buildRealtimeSession()` creates a `RealtimeSession` with:
  - server VAD
  - transcribe model (settings-driven)
  - TTS model

Current references:
- `my-electron-app/src/renderer/index.ts:458` (`buildVoiceActionTool`)
- `my-electron-app/src/renderer/index.ts:476` (`buildVoiceAgents`)
- `my-electron-app/src/renderer/index.ts:508` (`buildRealtimeSession`)

## 3) Why this architecture

- **Single point of command validation**: all recognized voice text is normalized and parsed in `runAgentChatCommand()` → `parseVoiceAction()` → `runMappedVoiceAction()`.
- **Routing by specialization**: triage keeps high-level steering; retrieval and coding flow is delegated to specialists.
- **Direct control mapping**: button control matching and action fallback support for existing app commands.

## 4) Recommended agent primitives used

### 4.1 Basic agent configuration

Use configuration object with:
- `name`
- `instructions`
- `voice` (realtime path)
- `tools` (for triage and specialists)
- `handoffs` (triage only)

### 4.2 Context design

In this app, the most important context for every run is:
- active route (`activeRouteId`)
- current command mode/state (`agentChatState`)
- current retrieval defaults and route state (`writeRetrieveQueryDefaults`, `applyRoute`)
- UI bridge capabilities (`window.agentBridge`)

Use context payload helpers to pass deterministic metadata when invoking internal intents.

## 5) Composition pattern in this app

This app uses **handoffs** (not “agent-as-tools” for cross-domain control), with one command tool shared across specialists.

- `triageAgent` handles intent classification and defers specialist domain work.
- `retrieveSpecialist` and `codingSpecialist` inherit voice instructions and command tool.
- If no specialist path is needed, regular mapped actions handle legacy ribbon/navigation flows.

## 6) Implementation details (current + required)

### 6.1 Input parsing and mapping

Parsing path:
1. `runAgentChatCommand(text, options)`
2. `parseVoiceAction(text)`
3. route to:
   - `runMappedVoiceAction()` for structured intents (`agent_voice_*` / retrieve commands)
   - button mapping fallback via `resolveVoiceButtonAction()`

References:
- `my-electron-app/src/renderer/index.ts:3000` (`runAgentChatCommand`)
- `my-electron-app/src/renderer/index.ts:3020` (`runMappedVoiceAction`)
- `my-electron-app/src/renderer/index.ts:2639` (`resolveVoiceButtonAction`)

### 6.2 Retrieval controls coverage

Commands are parsed with dedicated parsers:
- provider
- sort
- year range
- limit

and mapped to shared query defaults/state.

### 6.3 Voice inventory/coverage (newly implemented)

Added `agent_voice_inventory` action for control discovery and diagnostics.

- request phrase parsing in voice intent layer
- scanned candidate metadata includes route/action/tab/group
- scoped outputs by `visible` or `all`
- optional JSON response format for non-TTS mode

References:
- `my-electron-app/src/renderer/index.ts:1424` (`parseVoiceInventoryIntent`)
- `my-electron-app/src/renderer/index.ts:1447` (`buildVoiceButtonInventory`)
- `my-electron-app/src/renderer/index.ts:2630` (`runMappedVoiceAction` handling)

## 7) Improvements to implement now

1. Add explicit `agent_start/agent_end/tool_*` lifecycle telemetry hooks for command-level debug.
2. Add typed run context object per run (Route + session + permissions + safety flags), instead of reading mostly from globals.
3. Add lightweight input/output validation (guardrails-style checks) before/after command execution.
4. Add explicit ambiguity handling branch for low-confidence matches (prompt user for clarification instead of best-effort action).
5. Add per-agent failure counters and backoff for repeated tool failures.
6. Add route-aware intent templates in a central file (`VOICE_INTENT_MAP`) for reproducibility.

## 8) Suggested test matrix

### Voice command behavior
- open query builder
- set provider (semantic_scholar/crossref/openalex)
- set year range (single/between/before/after)
- set sort and limit
- retrieve search + graph + zotero route jumps

### Control mapping
- action button by exact label
- action by alias phrase
- route-scoped button command
- dynamic controls with short tokens

### Edge cases
- unknown intent
- ambiguous intent
- command requires route context but route differs
- tool execution failure
- session interruption (audio interrupted or stop)

## 9) Failure and fallback matrix

| Scenario | Expected | Recovery |
|---|---|---|
| No intent match | Ask for repeat/clarity | `parseVoiceAction` + `resolveVoiceButtonAction` fallback |
| Ambiguous control | Ask for specific phrase | `agent_voice_ambiguous` feedback |
| Tool execution fails | Surface error tone | `agent_chat` error feedback + clear remediation text |
| Route mismatch | Route-directed command | explicit route suggestion + optional route switch |

## 10) Recommended policy and safety notes

- Keep command scope deterministic (whitelist supported actions).
- Never execute actions with unbounded generic aliases.
- Keep model output concise for real-time voice UX.
- Keep detailed logs local and debug-tagged.

