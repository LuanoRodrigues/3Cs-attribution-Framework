# Systematic Review Pipeline (10 Steps)

This document defines the end-to-end pipeline for producing a systematic review from a coded Zotero collection.

## 1. Lock Protocol and Scope
- Define review type, overarching theme, and research questions (if used).
- Finalize inclusion and exclusion criteria.
- Register the protocol inputs before processing.

## 2. Ingest and Provenance Snapshot
- Freeze the batch run metadata and raw input/output files.
- Keep immutable copies of:
  - batch status
  - batch input JSONL
  - batch output JSONL

## 3. Screening Decisions
- Apply eligibility rules to all records.
- Assign each record one status: Included, Maybe, or Excluded.
- Store a decision file with a justification for each record.

## 4. Two-Stage Coding
- Stage A: section-level open coding (`code_pdf_page`).
- Stage B: intro/conclusion evidence harvesting (`code_intro_conclusion_extract_core_claims`).
- Persist one coded JSON per item and a collection manifest.

## 5. Normalize Evidence Table
- Flatten all included coded outputs into a single analysis table.
- Keep standardized fields for quote/evidence metadata, code labels, and extraction categories.

## 6. Reviewer Workflow and IRR
- Support 1 to 3 reviewers for screening and coding checks.
- Compute inter-rater reliability (IRR):
  - General: `IRR = agreeing_ratings / total_ratings`
  - Two-rater percent agreement: `IRR = (TA / (TR * R)) * 100`
- Store IRR results per stage.

## 7. Synthesis
- Build:
  - inductive/open-code thematic synthesis
  - targeted RQ synthesis (if RQs are present)
- Produce theme-level summaries backed by direct quotes.

## 8. PRISMA Compliance Check
- Validate manuscript coverage against PRISMA checklist items.
- Generate a checklist report showing completed and missing evidence.

## 9. Draft Full Paper
- Render structured review outputs (JSON + HTML).
- Ensure methods, PRISMA flow, synthesis, limitations, and recommendations are all populated.

## 10. Final QA and Release Pack
- Reconcile counts across screening, coding, synthesis, and PRISMA flow.
- Package final artifacts:
  - protocol
  - screening decisions
  - coded evidence
  - IRR report
  - PRISMA coverage report
  - final systematic review paper

