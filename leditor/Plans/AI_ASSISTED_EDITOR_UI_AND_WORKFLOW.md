# AI-Assisted Editor UI and Workflow

## Goal
Add an “Agent” tool in the Review ribbon that opens a right-sidebar chat, letting users issue natural-language commands that apply edits to the TipTap/ProseMirror document via transactions.

## Success criteria
- Review tab shows a button labeled “Agent”.
- Clicking “Agent” toggles a right sidebar chat panel.
- Submitting a prompt sends editor context (selection or document) to an AI provider and applies the returned edits via TipTap commands/transactions.
- Works offline by default (feature is usable; AI calls fail gracefully if no API key).
- No raw HTML injection or model-generated code execution.

## Constraints
- Canonical document format remains TipTap/ProseMirror JSON (HTML/Markdown are derived only).
- All edits must occur through TipTap/ProseMirror commands/transactions (no DOM mutation editing).
- AI output must be treated as untrusted: accept only strict structured output; never eval or run model code.

## Scope (files)
- `src/ui/ribbon_model.ts` (Review ribbon: add Agent button)
- `src/ui/agent_sidebar.ts` + `src/ui/agent_sidebar.css` (sidebar UI)
- `src/plugins/aiAgent.ts` (editor integration + selection/document context handling)
- `src/electron/main.ts` + `src/electron/preload.ts` (IPC + OpenAI call)
- `src/types/global.d.ts` (bridge typings)

## Steps
1. Add Review ribbon “Agent” button wired to `agent.sidebar.toggle`.
2. Implement a right sidebar UI with chat history, scope picker, and a composer.
3. Implement an editor-side plugin to:
   - toggle the sidebar
   - capture selection/document context
   - apply edits via TipTap commands (replace range / set document)
4. Add an Electron IPC endpoint that:
   - calls OpenAI with a strict JSON-only response contract
   - returns `{ assistantText, applyText }` to the renderer
5. Validate build and typecheck.

## Risk notes
- Full-document “applyText” as plain text may lose formatting/structure; consider moving to a structured patch schema targeting ProseMirror positions/nodes.
- Large documents require chunking and/or a diff/patch strategy to avoid context limits.
- Collaboration (if enabled later) needs local-only draft suggestions until explicit accept.

## Validation
- `npm run typecheck`
- `npm run build`

## Rollback
- `git checkout -- src/ui/ribbon_model.ts src/ui/agent_sidebar.ts src/ui/agent_sidebar.css src/plugins/aiAgent.ts src/electron/main.ts src/electron/preload.ts src/types/global.d.ts`
- `git rm Plans/AI_ASSISTED_EDITOR_UI_AND_WORKFLOW.md`

## Progress
1. PASS
2. PASS
3. PASS
4. PASS
5. PASS

