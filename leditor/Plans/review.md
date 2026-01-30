# LEditor review (phased)

This file is appended in phases to keep the investigation structured. Each phase lists concrete, actionable findings with pointers to the relevant files/areas.

---

## Phase 1 — Ribbon flicker + reliability (highest impact)

### 1) Likely collapse-stage oscillation / feedback loop (primary flicker suspect)
- **Where:** `leditor/src/ui/ribbon_layout.ts` (`ResizeObserver` calling `activeTab.collapse()`; `applyCollapseStages()`), plus `leditor/src/ui/ribbon.css` (`.leditor-ribbon-groups { overflow-x: auto; }` under fixed-height).
- **Why it can flicker:** `applyCollapseStages()` uses `strip.clientWidth` as “available width” and compares it to a “total width” computed from `offsetWidth`. Because the strip has `overflow-x: auto`, the appearance/disappearance of a horizontal scrollbar can *change `clientWidth`*, which can flip the stage decision near the boundary: Stage A → overflow scrollbar appears → `clientWidth` shrinks → Stage B/C needed; Stage B/C reduces width → scrollbar disappears → `clientWidth` grows → Stage A becomes viable again. With a `ResizeObserver` firing on size changes (including those caused by the collapse itself), this can oscillate and present as **buttons/groups “flickering”** or jumping between overflow/visible states.
- **Evidence pointers:**
  - `renderRibbonLayout()` creates `const ro = new ResizeObserver(() => { if (activeTab) activeTab.collapse(); });` and observes `t.panel` for every tab.
  - `applyCollapseStages()` resets groups each time and recomputes stage from scratch using `clientWidth` and `offsetWidth`.
  - CSS sets overflow on `.leditor-ribbon-groups`, which directly affects `clientWidth` when scrollbars appear.
- **What to change / verify:**
  - Add hysteresis (don’t immediately switch stages on tiny width changes), and/or debounce collapses (rAF + ignore re-entrant triggers).
  - Base “available width” on a stable measure (e.g., `getBoundingClientRect().width` of a wrapper that doesn’t gain/lose scrollbars, or force a stable scrollbar via `overflow-x: scroll`).
  - Observe only width changes of a stable container (or use a `ResizeObserver` on the host) instead of observing each panel whose layout the collapse function mutates.

### 2) Ribbon state updates can be “always changed”, causing constant DOM writes
- **Where:** `leditor/src/ui/ribbon_state.ts` (`RibbonStateBus.hasStateChanged`, `selectionContext` selector).
- **Why it matters:** `hasStateChanged()` uses referential equality (`!==`). Some selectors return new objects every time (notably `selectionContext: () => ({ ... })`). That guarantees “changed” on every update, which drives repeated UI updates even when nothing meaningful changed. This is a classic source of UI jitter and poor responsiveness (and can amplify the collapse oscillation above by making layout work happen more often).
- **What to change / verify:**
  - Make selectors return primitives or stable references, or implement shallow/deep comparisons for known object-valued keys.
  - Consider splitting “fast selection toggles” from “heavy binding sync” to avoid repainting the ribbon for every editor transaction.

### 3) `syncBindings()` does expensive DOM queries + unconditional input writes on every state tick
- **Where:** `leditor/src/ui/ribbon_layout.ts` (the `stateBus.subscribe(syncBindings)` block at the end of `renderRibbonLayout()`).
- **Why it can feel unreliable/flickery:**
  - It runs `host.querySelectorAll("[data-state-binding]")` on *every* state update.
  - It sets `input.value = ...` even when unchanged; if the user is typing in a combobox/spinner, this can reset caret/selection and feel “glitchy”.
  - It updates dropdown menu selection by querying and toggling classes every tick.
- **What to change / verify:**
  - Cache the binding target list once (or maintain a registry while building controls).
  - Only write to DOM when the value actually changed, and avoid overwriting `input.value` when the input is focused (or when the user is actively editing).

### 4) Missing disposal → duplicated listeners and lingering observers across remounts
- **Where:**
  - `leditor/src/ui/ribbon.ts` adds a global `document.addEventListener("keydown", ...)` but never removes it.
  - `leditor/src/ui/ribbon_state.ts` subscribes to editor events in the constructor and has no `dispose()`/`off()` cleanup.
  - `leditor/src/ui/ribbon.ts` calls `watchRibbonSelectionState(...)` but does not store/use the returned unsubscribe function.
  - `leditor/src/ui/ribbon_layout.ts` only disconnects its internal `ResizeObserver` on a custom `"ribbon-dispose"` event or `beforeunload`, but app teardown doesn’t dispatch `"ribbon-dispose"`.
  - `leditor/src/ui/renderer.ts`’s `destroyLeditorApp()` removes DOM but does not explicitly dispose the ribbon layout/state watchers.
- **Why it matters:** If the app is mounted/destroyed multiple times in the same page/session (common in Electron reloads or SPA routing), listeners accumulate and can cause duplicate command dispatches, repeated state updates, and inconsistent UI behavior.
- **What to change / verify:**
  - Ensure teardown dispatches `"ribbon-dispose"` on the ribbon host, and/or make `renderRibbon()` return a disposer that `destroyLeditorApp()` calls.
  - Add `dispose()` to `RibbonStateBus` to unsubscribe from editor events and cancel pending rAF.

### 5) Stage-C group flyout can leak a global `document` listener
- **Where:** `leditor/src/ui/ribbon_layout.ts` inside `collapseToStageC()` (`document.addEventListener("mousedown", close, true)`).
- **Why it matters:** The close listener is removed only when the user clicks outside the flyout. If the tab changes, the ribbon is re-rendered, or the app is destroyed while a flyout is open, the capture listener may remain and keep referencing detached DOM.
- **What to change / verify:**
  - Track active flyouts and remove the listener on tab switch and on `"ribbon-dispose"`.

### 6) Conflicting/duplicate ribbon “roots” and collapse systems (maintenance + behavior risk)
- **Where:** `leditor/src/ui/ribbon_primitives.ts` (`RibbonRoot` + `RibbonCollapseManager`) vs `leditor/src/ui/ribbon_layout.ts` (its own collapse/stage logic); also `leditor/src/ui/ribbon_placeholder.ts`.
- **Why it matters:** There are two separate ribbon implementations that both talk about “stages” and apply different mechanisms (`classList` stage classes vs `data-*` stage attributes). This increases the risk of CSS/behavior drifting (e.g., `ribbon.css` stage styling depends on `leditor-ribbon-stage-*` classes, but `renderRibbonLayout()` doesn’t apply them).
- **What to change / verify:**
  - Decide on a single collapse/stage source of truth and delete or clearly isolate the other.
  - Align CSS selectors to the chosen mechanism (`data-*` vs stage classes).

### 7) Duplicate helper logic that can silently diverge
- **Where:** `collectNestedControls` exists in both `leditor/src/ui/ribbon_layout.ts` and `leditor/src/ui/ribbon_config.ts`.
- **Why it matters:** When control structures evolve, one copy can lag behind and break icon propagation, collapse behavior, or validation in only one path.
- **What to change / verify:** Export/import one shared implementation.

### 8) Repo hygiene issues that can break builds/packaging across environments
- **Where:**
  - A suspicious path-like file: `leditor/\\wsl$\\Ubuntu-20.04\\home\\pantera\\annotarium\\...\\coder_state.json` (contains backslashes in the filename).
  - `leditor/node_modules` checked in (or at least present under the project tree), plus `.npm-cache`/`.npm-logs` under `leditor/`.
- **Why it matters:** These can break tooling (packagers, globbing, watchers) on Windows/macOS, cause very slow builds, and create nondeterministic behavior.
- **What to change / verify:** Add/strengthen `.gitignore` and remove non-source artifacts from the repo and build inputs.

### 9) Template duplication and case-variance (cross-platform correctness risk)
- **Where:** `leditor/templates/*` and `leditor/src/templates/*` contain similar template sets with different casing (e.g., `Cyber_Policy.json` vs `cyber_policy.json`, `International_affairs.json` vs `international_affairs.json`).
- **Why it matters:** On case-insensitive file systems (Windows/macOS default), these can conflict, fail checkouts, or cause unexpected “which template wins” behavior in bundlers.
- **What to change / verify:** Normalize template locations and filename casing; ensure the build imports a single canonical path.

### 10) Stray compiled artifact inside `src/`
- **Where:** `leditor/src/types/ai.js` alongside `leditor/src/types/ai.ts`.
- **Why it matters:** Mixed source/artifact files inside `src/` can confuse bundlers and reviewers, and can lead to accidental runtime imports of the wrong file depending on resolution rules.
- **What to change / verify:** Remove compiled artifacts from `src/` (and/or ensure build tooling ignores them).

---

## Next phases (planned)
- Phase 2: Search for duplicated command wiring, conflicting CSS selectors between ribbon/quick-toolbar/pagination overlays, and heavy synchronous layout work during typing.
- Phase 3: Broader reliability scan (event listener lifecycles, memory leaks, async race conditions in renderer/layout/pagination).

