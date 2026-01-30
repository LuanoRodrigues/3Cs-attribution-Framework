# AI Agent (Codex) — Deployment-Grade Implementation Plan (leditor)

This plan assumes:
- The Agent UI lives in leditor’s Ribbon → AI → Agent sidebar.
- The OpenAI key is supplied via `.env` as `OPENAI_API_KEY` (never stored in renderer settings/localStorage).
- All edits flow through TipTap/ProseMirror transactions (no DOM editing).
- Offline-first: core editor works without network; Agent features degrade gracefully.

## 0) Current state (baseline)
Implemented already:
- `.env` loaded by Electron main on startup; key read from `OPENAI_API_KEY`.
- Agent plugin available by default; `agent.sidebar.toggle` works.
- Agent sidebar with scope modes: selection / paragraphs (range) / section / document.
- Review workflow: Agent produces a draft; user Accept/Reject.
- Paragraph numbering gutter (“grid”) available and default-enabled.
- Agent can infer `paragraphs X-Y` and `section N` from the user instruction.

What remains for a deployment-grade system is primarily: (1) deterministic patch schema, (2) inline suggestions UX, (3) long-doc chunking strategy, (4) concurrency/collaboration semantics, and (5) security + validation harness.

---

## 1) Product UX: Windows-like palette sidebar
### 1.1 Sidebar chrome
- Align spacing/typography with Windows editor palette patterns:
  - Header: title + compact status pill + close.
  - Controls: Scope selector row with “context chips”.
  - Bottom composer: single-line input + Send; Ctrl+Enter to send.
- Add “Undock” mode (optional):
  - Sidebar can switch between docked (right) and floating panel.
  - Floating panel remembers size/position.
  - Keyboard accessibility: focus trap inside panel; Escape closes.

### 1.2 Visibility defaults
- Paragraph numbers should be on by default for all docs (not tied to Agent open).
- Add a View toggle (“Paragraph numbers”) in Ribbon View tab (not only Agent sidebar).

---

## 2) Settings: safe, explicit, non-secret
### 2.1 API settings
- Keep renderer-side settings limited to:
  - Model (string)
  - Temperature (number)
  - Optional system prompt overrides (non-secret)
  - Scope defaults
- Explicitly never persist `OPENAI_API_KEY`.
- Display status:
  - “Key detected” vs “missing OPENAI_API_KEY”
  - “Last API call: provider/model/latency/time” (auditable indicator)

### 2.2 Model routing & profiles
- Provide a small set of profiles:
  - “Fast” (small model)
  - “Quality” (bigger model)
  - “Offline” (disabled: uses deterministic local transforms only)
- Each profile maps to model + temperature + max tokens.

---

## 3) Context capture & routing (deterministic)
### 3.1 Canonical context
- Always capture canonical ProseMirror JSON snapshot (for safe targeting and replay).
- For model input:
  - Prefer plain text extraction (selection/paragraph text).
  - Include paragraph numbers and section headings in the prompt header (not body).

### 3.2 Scope extractors
- Selection:
  - If empty selection: expand to nearest textblock.
- Paragraphs:
  - Build a stable paragraph list (exclude tables/footnotes/etc.).
  - Provide paragraph numbering consistent with the UI gutter.
- Section:
  - Define sections by heading boundaries; include heading title + level.
- Document:
  - Large-doc strategy (see section 4).

### 3.3 “User intent” parsing
- Explicit UI scope always wins.
- Instruction parsing is a convenience only; it should never override explicit UI scope unless user selects “Auto”.

---

## 4) Large document handling (chunking) — no context overflow
### 4.1 Chunking strategy
- Chunk by paragraphs, not characters:
  - Target chunk size: N paragraphs or M chars (dual cap), e.g. 15 paragraphs / 12k chars.
  - Preserve paragraph numbering within chunk metadata.
- Process sequentially:
  - Chunk → model → patch → validate → accumulate draft.
  - Support cancel mid-run.

### 4.2 Progress & resumability
- Sidebar should show:
  - “Processing chunk 2/8…”
  - “Estimated time” (optional; can be naive).
- If run is cancelled:
  - Keep partial draft and allow “Continue”.

---

## 5) Output contract: structured JSON Patch (deployment hardening)
### 5.1 Patch schema
Adopt a strict schema (no markdown, no prose), e.g.:
```json
[
  { "op": "replaceText", "target": { "kind": "paragraph", "n": 12 }, "text": "..." },
  { "op": "replaceRange", "target": { "from": 120, "to": 180 }, "text": "..." }
]
```
Rules:
- Targets must be unambiguous:
  - Prefer paragraph-number targeting for paragraph workflows.
  - Use document positions only when necessary (selection-based operations).
- Enforce max operations per call to prevent runaway edits.

### 5.2 Deterministic application
- Convert patch ops → TipTap commands / ProseMirror transactions.
- Validate before applying:
  - Original text match (or stable checksum per paragraph).
  - Schema acceptance.
  - Reject HTML unless explicitly enabled; prefer plain text / markdown and pass through schema-driven paste rules.

### 5.3 Failure handling
- If patch fails:
  - Show “Draft failed validation” with reasons (no document contents).
  - Offer “Regenerate” with same scope + fresh snapshot.

---

## 6) Inline suggestions & review mode (Word-like control)
### 6.1 Suggestion rendering
Two options:
1) Decorations-only diff overlay (non-destructive):
   - Keep document unchanged until Accept.
   - Use decorations to show insertions/deletions (like track changes preview).
2) Track-changes integration:
   - Apply draft into a suggestion layer using existing Track Changes plugin if compatible.

### 6.2 Accept/Reject semantics
- Accept:
  - Apply in a single undoable batch transaction.
- Reject:
  - Clear decorations/draft state with no doc mutation.
- Ensure Ctrl+Z behavior remains intuitive.

---

## 7) Multi-turn conversation & memory
### 7.1 Session memory
- Maintain in-memory conversation (bounded, e.g. last 12 turns).
- Store metadata per turn:
  - scope, targets, model, latency, createdAt

### 7.2 Persistence (optional)
- Persist only non-sensitive conversation summaries (no raw doc text) unless user opts in.
- Store “instruction + scope + operation summary” rather than full content.

---

## 8) Collaboration semantics (real-time editing safety)
If collaboration/CRDT is enabled:
- Draft state must be local-only:
  - Do not broadcast tentative changes.
  - If Track Changes is collaborative, ensure it’s tagged appropriately.
- Accept commits should:
  - Apply as one atomic step.
  - Include metadata (“agent-accepted”) on the transaction if supported.
- If remote changes occur during drafting:
  - Draft must revalidate target text; if mismatched, require rerun.

---

## 9) Security posture
- No remote script loading.
- No `eval` or code execution from the model.
- Sanitization:
  - If HTML insertion is ever enabled, sanitize explicitly and let schema strip unsupported content.
- Never log document contents in debug logs:
  - Only counts/lengths/node types/paragraph numbers.

---

## 10) Validation & regression harness (required for deployment)
### 10.1 Automated validations
- Typecheck/build gates.
- Add a small “agent patch application” unit test harness:
  - Given a ProseMirror JSON fixture + patch ops → resulting doc JSON snapshot.
- Add roundtrip tests for:
  - Paragraph renumbering stability under edits.
  - Section boundary detection for headings.

### 10.2 Manual smoke checks
- With valid `OPENAI_API_KEY`:
  - Selection rewrite: expect API badge updates.
  - Paragraphs 2–4: expect progress + draft + Accept works.
  - Reject: ensure no doc change.
- Without key:
  - Agent shows missing key status and fails gracefully without crash.

---

## 11) Rollout plan
- Feature flag:
  - `aiAgentEnabled` default on for dev, staged for production.
- Telemetry (local-only by default):
  - last-call metadata for debugging (provider/model/latency), no content.
- Documentation:
  - Explain scopes, paragraph numbering references, and Accept/Reject workflow.

