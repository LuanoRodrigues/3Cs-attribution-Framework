# layout_plan.md — Ribbon Rebuild Layout Plan (Electron)

## Goal
Rebuild a Microsoft Word–fidelity ribbon inside an Electron application using a deterministic, config-driven DOM/CSS architecture that supports:
- Pixel-consistent layout with Word
- Predictable collapse behavior
- Extension for rich-text–editor–specific features (e.g., view source, embeds)
- Long-term maintainability via declarative JSON schemas

---

## Success Criteria
The implementation is considered successful when all of the following are true:

1. **Visual fidelity**
   - Ribbon height, spacing, alignment, and grouping match Microsoft Word at 100% zoom.
   - Group titles, dialog launchers, and control sizes are visually consistent.

2. **Deterministic behavior**
   - Ribbon layout is fully driven by `ribbon.json` and per-tab JSON (e.g., `home.json`, `insert.json`).
   - No heuristic or implicit hiding of controls; all collapse behavior follows explicit config.

3. **Functional completeness**
   - All Home and Insert commands render, collapse, and dispatch correctly.
   - Menus, galleries, and flyouts open without clipping or z-index issues.

4. **Electron compatibility**
   - Works inside the renderer process.
   - No dependency on browser-only APIs unavailable in Electron.

5. **Extensibility**
   - New tabs, groups, or controls can be added without modifying layout code.
   - Rich-text–specific features coexist with Word concepts without breaking layout.

---

## Scope

### In Scope
- Ribbon layout system (TabStrip, Panels, Groups, Clusters)
- Collapse stages A / B / C
- Overflow handling and group flyouts
- Z-index and portal strategy
- Keyboard navigation and focus order (ribbon-level)
- CSS tokens and layout primitives
- Integration points with existing editor command dispatch

### Out of Scope
- Actual editor behavior (formatting logic, document model)
- Command implementation semantics
- Localization / RTL layout
- Touch-optimized ribbon variant
- High-contrast / accessibility theming beyond baseline ARIA

---

## Assumptions
- `ribbon.json` and tab JSON files are valid and complete.
- Missing configuration data is a fatal error (no defensive fallbacks).
- Icons are provided as SVG via a resolver (e.g., Fluent UI System Icons).
- The editor surface already exists and is not reimplemented here.

---

## Implementation Steps

### Step 1 — Layout Skeleton
- Render top-level ribbon containers:
  - `.ribbon`
  - `.ribbon__tabstrip`
  - `.ribbon__panel`
- Bind tabs from `ribbon.json`.
- Activate the initial tab deterministically.

### Step 2 — Group Rendering
- For the active tab:
  - Render groups in priority order.
  - Render GroupBody and GroupFooter (title + dialog launcher).
- Do not yet implement collapse logic.

### Step 3 — Cluster Layouts
- Implement cluster primitives:
  - `row`
  - `column`
  - `grid`
  - `segmented`
  - `gallery`
- Ensure DOM order exactly matches visual order.

### Step 4 — Control Rendering
- Render controls according to type:
  - button, toggleButton, splitButton, dropdown, combobox, gallery
- Bind:
  - `command.id` → dispatcher
  - `state.binding` → reactive state
- Render icons via `resolveIcon(iconKey)`.

### Step 5 — Collapse Stage A
- Enforce full layout only.
- Validate spacing, alignment, and wrapping at large window widths.

### Step 6 — Collapse Stage B
- Apply per-control collapse directives:
  - `iconOnly`
  - `hidden`
  - `inOverflow`
  - `inMenuOf:<id>`
  - `dropdownOnly`
- Insert group-scoped overflow menus where required.

### Step 7 — Collapse Stage C
- Replace groups with group buttons.
- Clicking a group button opens a flyout rendering the full Stage A layout for that group.

### Step 8 — Menus and Portals
- Render menus, galleries, and flyouts into a portal container.
- Anchor positioning to invoker bounding boxes.
- Enforce consistent z-index rules.

### Step 9 — Keyboard and Focus
- Implement TabStrip keyboard navigation.
- Ensure focus returns to invokers after menu close.
- Validate tab order matches visual order.

---

## Validation

### Visual Validation
- Compare against Microsoft Word screenshots at:
  - 1024px
  - 1280px
  - 1440px
  - 1920px
- Confirm:
  - Group titles baseline alignment
  - Correct collapse transitions
  - No jitter during resize

### Functional Validation
- Verify every control dispatches its command.
- Verify toggle and mixed-state rendering.
- Verify overflow menus preserve order and state.

### Structural Validation
- DOM assertions:
  - Exactly one active tab and panel
  - Group count matches config
  - No orphaned controls outside groups

---

## Rollback Plan

If the ribbon implementation causes regressions or instability:

1. **Immediate rollback**
   - Disable new ribbon rendering behind a feature flag.
   - Revert to previous toolbar/ribbon implementation.

2. **Partial rollback**
   - Keep TabStrip and revert Panel rendering to legacy layout.
   - Disable collapse stages B and C.

3. **Config rollback**
   - Revert to last known-good `ribbon.json` and tab JSON files.
   - No code rollback required if schema compatibility is maintained.

---

## Risks and Mitigations

| Risk | Mitigation |
|-----|-----------|
| Visual drift from Word | Strict CSS tokens and screenshot comparisons |
| Layout instability on resize | Deterministic collapse algorithm only |
| Menu clipping | Mandatory portal rendering |
| Over-complex configs | Schema validation in build step |

---

## Deliverables
- `layout_plan.md` (this document)
- CSS layout primitives
- Ribbon renderer (`ribbon.js`)
- Declarative configs (`ribbon.json`, `home.json`, `insert.json`)

## Progress
- Step 1 — Layout Skeleton: PASS
- Step 2 — Group Rendering: PASS
- Step 3 — Cluster Layouts: PASS
- Step 4 — Control Rendering: PASS
- Step 5 — Collapse Stage A: PASS
- Step 6 — Collapse Stage B: PASS
- Step 7 — Collapse Stage C: PASS
- Step 8 — Menus and Portals: PASS
- Step 9 — Keyboard and Focus: PASS

---
