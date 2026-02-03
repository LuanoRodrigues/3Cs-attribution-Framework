# Unified Feedbacks System (AI Edits + Source Checks + Track-Style Review)

Goal: ship a Word-like review workflow in LEditor where AI and verification tools generate **reviewable, deterministic** changes, surfaced in a single **Feedbacks** panel that stays aligned to the A4 layout and supports bulk actions (Apply all / Reject all) with strong safety guarantees (especially around citation anchors).

This plan is designed for deployment: it defines data models, UX, persistence, failure modes, and validation strategy.

---

## 0) Definitions & Constraints (must-haves)

### Canonical content
- Canonical document format: TipTap/ProseMirror JSON.
- AI/verification layers must **not** mutate DOM directly; all edits go through ProseMirror transactions.

### Citation/anchor invariants (hard rule)
- Citation anchors (`<a.leditor-citation-anchor ...>`) must be preserved exactly unless the user explicitly accepts a citation replacement.
- Any edit operation must:
  - keep the anchor node/mark intact
  - keep the anchor text intact
  - keep `href`/`data-*` attrs intact
- Any attempt to change anchor text should be blocked with an explicit error and an instruction to re-run.

### UX posture
- Default: review changes manually.
- Bulk actions exist: “Apply all” / “Reject all” for **the currently selected filter**.
- Visuals must respect A4 clipping: all popovers are either portal-based or constrained within the A4/page bounds.

### Persistence
- “Feedbacks” history persists in `.ledoc` under `payload.history.*`.
- Visibility (which filters are currently shown) is session UI state only.

---

## 1) Architecture Overview

We treat everything as a **Feedback Item** rendered in one right-side panel:

**Feedback Item Types**
1. **AI Draft** (big edits): paragraph-level or range-level replacement suggestion.
2. **AI Micro-edit** (small edits): inline diff-style suggestion (track-style view).
3. **Source Check** (verification): per-anchor verdict + justification + optional “Fix claim” rewrite.
4. (Future) **Citation Replacement**: suggests replacing a citation with another one based on title match.

**Shared Capabilities**
- Click-to-focus: selecting an item scrolls/focuses the corresponding location and highlights it.
- Expand/collapse: show full justification/diff.
- Dismiss (removes from panel, persists dismissal in history).
- Apply/Reject: commits or discards the change, recording outcome in history.

---

## 2) Data Models (persisted)

### 2.1 `sourceChecksThread` (existing)
Stored in `.ledoc -> payload.history.sourceChecksThread`.

Required fields:
- `key` (stable: `P{n}:{href}:{ordinal}`)
- `paragraphN`
- `verdict` = `verified | needs_review`
- `justification`
- `claimRewrite` (optional)
- `fixStatus` = `pending | applied | dismissed`

### 2.2 `aiEditsThread` (new)
Stored in `.ledoc -> payload.history.aiEditsThread`.

Each item:
- `key`: stable UUID-ish id
- `kind`: `draft | micro`
- `action`: `refine | paraphrase | shorten | proofread | substantiate | custom`
- `scope`: `selection | paragraph | paragraphs | section | document`
- `targets`: `{ paragraphNs?: number[], from?: number, to?: number }`
- `originalText` (required)
- `proposedText` (required)
- `status`: `pending | applied | rejected | dismissed`
- `createdAt`, `provider`, `model`, `latencyMs`
- `safety`: `{ anchorsPreserved: boolean, blockedReason?: string }`

Rationale:
- We need to filter by action, persist reviews across sessions, and enable bulk apply/reject.

---

## 3) Rendering & Alignment (A4-aware)

### 3.1 One rail, multiple filters
Single rail container anchored to `.leditor-a4-zoom-content` coordinate space.

Filter Tabs:
- All
- Edits
- Sources

Edits Sub-filters:
- Refine
- Paraphrase
- Shorten
- Proofread
- Substantiate

### 3.2 Layout algorithm
- Use the same page-aware vertical bucketing approach as `source_check_rail`:
  - map each item to an anchor Y (from `coordsAtPos` / DOM rect)
  - bucket by page rect (top/bottom)
  - place cards within page bounds with minimum spacing

### 3.3 Focus behavior
- Click item:
  - scroll editor to the target
  - set selection to the target range
  - flash/highlight the corresponding anchor or range

---

## 4) Applying Changes Safely

### 4.1 Big edits (Draft replacements)
- Prefer replace-with-fragment that preserves citation anchors:
  - If replacement stays within a single textblock: merge original protected nodes (anchors) back in.
  - Otherwise: block unless the model output is proven to preserve anchors.

### 4.2 Small edits (Micro / track-style)
Use inline “track changes” representation:
- Deleted segments: red strikethrough on existing text.
- Inserted segments: green insert widgets (non-editable) at insertion points.
- Hovering the affected word/sentence shows Accept/Reject.

Apply:
- Replace the original range with the proposed text via a single transaction.
Reject:
- Remove decorations + mark item rejected.

### 4.3 Source check fixes (“Fix claim”)
- Only rewrite the claim text **before** the first citation in the sentence.
- Never replace text that contains anchor/citation-like marks.
- Apply at most one rewrite per paragraph/sentence during bulk apply.

---

## 5) Bulk Actions (“Apply all” / “Reject all”)

Rules:
- “Apply all” applies only items visible under current filter.
- Must be deterministic:
  - apply from bottom-to-top when edits can shift positions
  - update thread status after each apply
  - stop & report if anchor safety check fails

---

## 6) UI/UX Details (Windows/Word-like)

### 6.1 Rail header
- Title: “Feedbacks”
- Tabs + subfilters
- Counters: “X edits • Y source checks”
- Buttons: Apply all, Reject all, Clear (contextual)

### 6.2 Cards

Card header:
- Badge: AI / ✓ / !
- Label: action name (Refine/Shorten/etc) or Source check
- Meta: P{n}, timestamp

Card body:
- For edits: compact diff preview (expandable)
- For sources: justification + optional proposed claim rewrite + optional citation replacement suggestion

Card actions:
- Apply / Reject for edits
- Apply fix / Dismiss for sources
- Dismiss item

---

## 7) Command Surface (Ribbon + Slash + Context Menu)

### 7.1 Ribbon
AI → Feedbacks:
- Show Feedbacks panel (toggle)
- Filters submenu
- Apply all (current filter)
- Reject all (current filter)
- Show Source checks (toggle)

### 7.2 Chat slash commands
- `/refine`, `/shorten`, `/paraphrase`, `/proofread`, `/substantiate`
- `/check sources`, `/clear checks`
All commands must live in one auditable JSON prompt config.

### 7.3 Context menu
When selection exists:
- Refine / Shorten / Paraphrase / Proofread / Substantiate
- Synonyms / Antonyms (returns top 5 in-place dropdown)
- Check sources (if anchors exist)

---

## 8) Persistence & Autosave (LEDOC)

On each thread mutation:
- coalesce autosave
- export `.ledoc` silently (no dialogs)

Payload structure:
- `payload.history.sourceChecksThread`
- `payload.history.aiEditsThread`

---

## 9) Validation Checklist (deployment ready)

### Functional
- Toggle panel on/off; no dialogs.
- Apply/Reject works on:
  - a single edit
  - multiple edits in a paragraph
  - multiple pages
- Bulk apply respects filter.
- Clicking any item focuses and highlights correct target.
- No source checks appear unless toggled.

### Safety
- Anchor text never changes on apply.
- Anchor nodes never removed on apply.
- Fix-claim rewrite never touches citation-marked ranges.

### Regression
- Open/save `.ledoc` preserves history and re-renders feedbacks correctly.

---

## 10) Execution Phases (what we implement in order)

Phase A — Unify UI shell
- Create Feedbacks header with filters and counters.
- Make it coordinate-aware and page-aligned.

Phase B — Persist AI edits
- Add `aiEditsThread`, import/export, autosave.

Phase C — Render unified rail list
- Combine items from both threads into one list.
- Implement click-to-focus, expand, dismiss.

Phase D — Apply semantics
- Big edits: keep replacement (existing).
- Small edits: add inline diff plugin + hover accept/reject.
- Source fixes: bulk apply + per-item apply.

Phase E — Bulk actions + filtering
- Apply all / Reject all per filter.

Phase F — QA / polish
- keyboard navigation, ARIA, performance (RAF coalescing)
- remove stale debug logs
