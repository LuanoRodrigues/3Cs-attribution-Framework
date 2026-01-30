# Plan: Move AI Agent Runtime From Host → leditor

## Goal
Make the AI Agent system fully owned by **leditor** (UI + provider calls + apply/review flow), while ensuring the embedding Electron host (`my-electron-app`) contains **no “agent” code paths**.

## Success Criteria (verifiable)
1) In leditor, the Ribbon AI/Agent button successfully opens/closes the Agent sidebar (no “command not implemented”).
2) Agent can run in:
   - Selection scope (default)
   - Document scope (with chunking)
   - Paragraph range scope (e.g., 12–18)
3) Agent proposes changes and requires explicit Accept/Reject (review mode).
4) `my-electron-app` contains no references to “agent” (code identifiers, IPC channels, UI labels, files).
5) Builds pass:
   - `../leditor`: `npm run build` (and one additional validation)
   - `my-electron-app`: `npm run build`

## Constraints
- Canonical document format is TipTap/ProseMirror JSON. All edits via transactions/commands.
- No secrets committed. `.env` is local only.
- Avoid logging document content; log sizes/counts only.

## Scope (files)
**leditor**
- `src/plugins/aiAgent.ts`
- `src/ui/agent_sidebar.ts`
- `src/ui/agent_sidebar.css` (or equivalent stylesheet)
- `src/electron/main.ts` (host contract env injection)
- (optional) `src/ui/ai_settings.ts` (remove API key storage if applicable)

**my-electron-app**
- Remove prior host-side agent IPC/UI wiring and any “agent” references.
- Optionally pass `OPENAI_API_KEY` through existing `--leditor-host=` contract as `env.OPENAI_API_KEY` (no agent-specific naming).

## Steps
1) leditor: Update `aiAgent` plugin to call OpenAI directly (browser) using the `openai` package with `dangerouslyAllowBrowser: true`.
2) leditor: Extend Agent sidebar to support:
   - paragraph range mode
   - “show paragraph numbers” toggle
   - Accept/Reject workflow (snapshot + apply on accept)
3) leditor: Ensure agent plugin is registered in the runtime bundle used by the ribbon.
4) Host contract: include `env.OPENAI_API_KEY` inside `--leditor-host=` payload in leditor Electron main, and (optionally) in `my-electron-app` main.
5) my-electron-app: remove all agent references:
   - IPC channels
   - preload bridge methods
   - ribbon actions
   - sidebar components
   - plan/docs that mention “agent” in this repo
6) Validation:
   - `../leditor`: `npm run build`, `npm run typecheck`
   - `my-electron-app`: `npm run build`
   - Quick smoke: run leditor `npm run start --loglevel verbose` (confirm sidebar toggle works)

## Risks / Notes
- Direct OpenAI calls from renderer expose the API key to the renderer context. This is a deployment risk; mitigations (main-process proxy) can be added later, but would reintroduce host-side logic.
- Paragraph numbering via CSS counters is approximate for nested structures (lists/tables); for full fidelity, we’ll need a ProseMirror view plugin that assigns stable IDs.

## Rollback
- `git checkout -- ../leditor/src/plugins/aiAgent.ts ../leditor/src/ui/agent_sidebar.ts ../leditor/src/electron/main.ts`
- `git checkout -- src/main.ts src/preload.ts src/ribbon/WriteTab.ts src/renderer/index.ts src/pages/WritePage.tsx`

## Progress
1) OpenAI-in-leditor agent runtime: NOT STARTED
2) Agent sidebar scopes + review mode: NOT STARTED
3) Host contract env injection: NOT STARTED
4) Host repo agent scrub: NOT STARTED
5) Validation: NOT STARTED

