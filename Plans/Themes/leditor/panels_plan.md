# Panels Plan (`leditor/`)

## Goal
Make every panel feel cohesive: consistent layout, typography, spacing, and behavior.

## Panels in scope
- Agent sidebar: `leditor/src/ui/agent_sidebar.*`
- Navigation panel: `leditor/src/ui/view_state.ts` (+ styles in `a4_layout.ts`)
- Search/replace: `leditor/src/ui/search_panel.ts`
- Sources panel: `leditor/src/ui/references/sources_panel.ts`
- AI settings: `leditor/src/ui/ai_settings.*`
- Footnotes: `leditor/src/ui/footnote_manager.ts`

## Work items
1) Introduce shared panel primitives (`.ui-panel`, `.ui-panel__header/body/footer`).
2) Refactor injected-style panels to static CSS files imported once.
3) Standardize behavior:
   - ESC closes
   - focus management
   - click-outside rules (floating only)

## Acceptance checklist
- Panels don’t use stray serif/parchment chrome.
- Panels share the same spacing + controls + motion.

