# ICJ Stage-to-Scoring Dependency Map

This file binds pipeline stages to ICJ-style scoring dependencies and indicates how the current scorer (`annotarium/score_icj.py`) consumes them.

## Stage 1: Extract Sources
- Output dependency: source inventory and citation-resolvable source IDs.
- Scoring use:
- Seeds `sources[]` normalization (`source_id`, kind, publisher/domain/date).
- Enables independence and corroboration calculations through source graph.

## Stage 2: Extract Source Affiliations / Entities
- Output dependency: authoring org / entity-level metadata.
- Scoring use:
- Feeds source typing (`government`, `vendor`, `media`, `academic`, etc.).
- Contributes to `I` (independence/neutrality) and origin de-duplication.

## Stage 3: Extract Artifacts (Text/Tables/Images)
- Output dependency: normalized artifacts + anchors.
- Scoring use:
- Builds `artifacts[]` with location object (`page`, `block_id`, `kind`, `table_id`).
- Supports evidence traceability and `A` (authentication/provenance).

## Stage 4: Parse/Link Footnotes to In-Text Citations
- Output dependency: citation linkage to reference candidates.
- Scoring use:
- Resolvable citation paths to source records.
- Readiness gating checks unresolved citation behavior before scoring.

## Stage 5: Recover Missing Footnotes/References
- Output dependency: deterministic recovery trace in consistency audit.
- Scoring use:
- Optional input `--consistency-audit`.
- Recovered references can add penalty (`recovered_reference`) unless independently corroborated later.

## Stage 6: Structured References + Source-to-Claim Graph
- Output dependency: source graph and claim support mappings.
- Scoring use:
- Generates `origin_signature` to detect single-origin/circularity.
- Powers `single_source` and `circularity_risk` penalties.

## Stage 7: Document Structure Extraction
- Output dependency: section/block/table/figure/page anchors.
- Scoring use:
- Ensures every normalized artifact/evidence link is auditable.
- Readiness gate fails if artifact anchors are missing.

## Stage 8: Extract Claims into Six-C
- Output dependency: claims + chain-of-custody evidence blocks + support mappings.
- Scoring use:
- Builds normalized `claims[]` and `evidence_items[]`.
- Computes `I/A/M/P/T`, evidence weights, and claim/document vectors.

## Stage 9: Validate Schema + Evidence Integrity
- Required fail conditions (implemented in scorer readiness gate):
- duplicate source IDs
- duplicate artifact IDs
- artifact anchors missing
- unresolved citations without recovered+traced consistency evidence
- citations pointing to missing source IDs

## Stage 10: Return Machine-Readable Outputs + Artifacts
- Output dependency: deterministic score report path + reproducible inputs.
- Scoring use:
- Stage `ICJ_SCORING` writes `icj_score_report_path` and pipeline artifact entry.
- Re-runnable from extraction JSON (+ optional consistency audit JSON).

## Current Pipeline Wiring
- New stage: `ICJ_SCORING`.
- Wrapper: `annotarium.agents.tools.tool_icj_score`.
- Script: `annotarium/score_icj.py`.
- Pipeline context key: `icj_score_report_path`.

## Calibration Profiles
- Scorer supports `--profile strict|balanced|permissive`.
- Pipeline supports `--icj-profile strict|balanced|permissive` and forwards it to `ICJ_SCORING`.
- Profiles adjust:
- source-independence baselines,
- factor biases (`I/A/M/P/T`),
- penalty severity,
- seriousness gate thresholds.
