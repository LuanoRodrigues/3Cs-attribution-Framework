# Rollout Roadmap (`my-electron-app/`)

## Phase 0 — Baseline capture
- Screenshot:
  - ribbon (Retrieve + Analyse)
  - panel grid (4 panels) with splitters visible
  - a floating panel (undocked)
  - Write (LEditor embedded)
  - Settings window
  - PDF viewer

## Phase 1 — System contract
- Lock in token + primitive class design system.
- Decide “V2 is default” posture and reduce duplicated styling paths.

## Phase 2 — Convert inline-styled pages
- Visualiser page: move inline styles to CSS.
- Analyse pages: reduce `element.style.*` to class-based styling.

## Phase 3 — Panel polish
- Tool tabs (tab strip) styling and drag/drop affordances.
- Unified menus (ribbon + panel + coder).

## Phase 4 — Write integration polish
- Theme mapping + “double ribbon” decision.
- Loading/error UX.

## Phase 5 — Cross-window parity
- Settings window themed via the same appearance system.
- PDF viewer theme injection.

## Definition of Done
- A user can’t find a “different design system” anywhere.
- Resizing/dragging/switching tools feels stable and fast.

