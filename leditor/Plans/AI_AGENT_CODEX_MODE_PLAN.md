# Codex Agent Mode (Ribbon → AI → Agent) — Comprehensive Implementation Plan

## Goal
Deliver a deployable “Codex Agent” editing workflow inside **leditor** that:
- Uses **Codex models by default** (not GPT-*mini* defaults).
- Edits the document **only via TipTap/ProseMirror transactions**.
- Supports **Selection / Paragraphs / Section / Document** scopes with stable references (e.g. `paragraphs 2–4`, `heading 3.1`, `heading "Methods"`).
- Provides a **review-first** user experience (draft → accept/reject).
- Works safely with **real-time collaboration** (draft stays local; accept is the only broadcast change).

## Non-goals (explicitly out of scope for first deploy)
- Giving the model filesystem access or letting it “edit files directly”.
- Arbitrary code execution, runtime eval, or HTML injection.
- Automatically applying edits without user approval.

---

## A) Current implementation snapshot (what’s already in place)
1) **Agent UI + command**
- Ribbon includes Agent entry; `agent.sidebar.toggle` opens/closes sidebar.

2) **Key management**
- API key loads from `.env` as `OPENAI_API_KEY` in Electron main (renderer never stores it).

3) **Default model**
- Defaults are now set to `codex-mini-latest` when nothing else is configured.
- Optional overrides: `.env` `LEDITOR_AGENT_MODEL` or `OPENAI_MODEL`.

4) **Review workflow**
- Agent generates a draft; user must click **Accept** to apply.

5) **Reference structure**
- Paragraph grid is available (numbers + hierarchical heading numbers), and is enabled only while Agent UI is open.
- Agent can interpret references:
  - `paragraphs 2-4`
  - `section 3.1` / `heading 3.1`
  - `heading "Title"`
  - `paragraph "keyword phrase"`

6) **API proof**
- Sidebar shows provider/model/latency/time for the last call (audit-friendly).

---

## B) Codex-first model policy (deployment default)
### B1) Environment variables (authoritative)
Required:
- `OPENAI_API_KEY=<key>`

Recommended defaults:
- `LEDITOR_AGENT_MODEL=codex-mini-latest`

Optional:
- `LEDITOR_AGENT_TEMPERATURE=0.2` (if you want a global default)
- `LEDITOR_AGENT_MAX_OUTPUT_TOKENS=...` (if/when supported by the integration)

### B2) In-app settings
- The AI Settings panel should offer:
  - **Model** (defaults to `codex-mini-latest`)
  - Temperature
  - Chunk size (paragraph-based chunking in future; see Section E)
  - Default scope

### B3) Routing strategy (Codex Agent button)
When user clicks **Agent**:
- Always route to **Codex model(s)**.
- Do not auto-switch to GPT models.
- If an optional “Explain/Chat” feature exists in the future, that can be a separate button or separate mode with separate routing.

---

## C) Context model & references (how the agent “understands the doc”)
### C1) Canonical document source
Canonical source of truth remains **ProseMirror JSON** in the editor.
The model receives:
- The user instruction
- Scope metadata
- Target reference metadata
- The extracted target text

### C2) Reference vocabulary (what users can say)
Supported:
- `paragraphs 2-4`
- `heading 3.1` / `section 3.1`
- `heading "Methods"`
- `paragraph "logistic regression"`

Next additions (recommended):
- `section 4` (meaning the *top-level* section with heading number `4`)
- `subsection 4.2`
- `under heading 3.1, paragraphs 2-4` (scoped references)

### C3) Stable mapping rules
To keep references stable and deterministic:
- Paragraph numbering counts only “counted textblocks” (exclude tables/footnotes/etc.).
- Heading numbering is hierarchical from heading levels.
- Section boundaries are derived from headings (from heading node → next heading of same-or-higher level).

### C4) Prompt framing (Codex)
Codex should be instructed to:
- Output **STRICT JSON only**
- Provide:
  - `assistantText` (brief, user-visible summary)
  - `applyText` (replacement text for the target)
- Never include markdown wrappers/backticks
- Avoid duplicating headings unless instructed

---

## D) Patch strategy (safe deterministic editing)
### D1) Phase 1 (already working): Replace-by-scope
Applies `applyText`:
- Selection: replace the selection range
- Paragraphs/Section/Document: replace each targeted paragraph (batch replace)

Safety check:
- Before Accept, validate that current paragraph text matches the original snapshot (already implemented).

### D2) Phase 2 (recommended hardening): Structured Patch Ops
Move from “replaceText only” to a constrained patch schema:
```json
[
  { "op": "replaceParagraph", "target": { "n": 12 }, "text": "..." },
  { "op": "replaceHeading", "target": { "number": "3.1" }, "text": "Methods" }
]
```
Rules:
- Targets must be paragraph number or heading number/title.
- No raw ProseMirror node injection from the model.
- Application is still TipTap transactions, but targeting becomes more robust and easier to audit.

---

## E) Large document handling (Codex-friendly, token-safe)
### E1) Chunking by paragraphs (preferred)
Chunk document operations by paragraph groups:
- Cap by paragraph count (e.g. 10–20) AND character length (e.g. 10k–15k).
- Process sequentially with progress and cancel.

### E2) Draft accumulation
For full-document operations:
- Accumulate draft edits as a batch.
- Present “Draft ready: N paragraphs changed”.
- Accept applies all edits in one logical action.

---

## F) Real-time collaboration semantics (no conflicts)
### F1) Drafts must be local-only
While agent is drafting:
- Do NOT broadcast provisional changes.
- Draft exists as:
  - a stored patch + metadata
  - optional decorations/preview overlay (future enhancement)

### F2) Accept is the only commit
When user clicks Accept:
- Apply changes in one grouped transaction if possible.
- Tag the transaction meta (e.g. `{ source: "ai-agent", model, ts }`) if your collaboration stack supports it.

### F3) Concurrency rules
If the document changes while drafting (remote collaborator edits, or local typing):
- Revalidate targets on Accept (already implemented).
- If mismatch: block Accept and require rerun (deterministic).

---

## G) UI/UX polish requirements (Agent button experience)
### G1) Sidebar behavior
- Open → enable paragraph/heading grid (reference UI)
- Close → disable grid
- Always show:
  - Scope selector
  - API status pill (provider/model/latency/time)
  - Draft state (ready/empty)

### G2) Flicker/performance rules
- Progress messages should not cause layout shifts.
- Avoid full DOM rebuild on each progress tick (incremental log append).

---

## H) Observability & auditability
### H1) User-visible proof of Codex usage
- “API OK • provider=openai • model=codex-… • ms=…”
- Sidebar pill shows last call metadata.

### H2) Developer logs (optional)
- Log only metadata: counts, paragraph numbers, heading numbers; never log document text.

---

## I) Validation checklist (required before shipping)
### I1) Build gates
- `npm run typecheck`
- `npm run build`

### I2) Smoke tests (manual)
With `OPENAI_API_KEY` set:
- Selection rewrite → draft → accept
- Paragraphs `2–4` rewrite → accept
- Heading-number targeting (`heading 3.1`) → draft
- Heading-title targeting (`heading "Methods"`) → draft
Verify:
- API pill shows `codex-*` model
- Undo/redo behaves as expected
Without `OPENAI_API_KEY`:
- Agent shows “key missing (OPENAI_API_KEY)” and fails gracefully.

---

## J) Backlog (nice-to-have next)
1) Inline preview (decorations) showing diffs before accept.
2) Streaming responses (progressive draft building) with cancellation.
3) “Auto scope” mode with classifier (still Codex-only for Agent).
4) Persisted conversation summaries (no doc text).

