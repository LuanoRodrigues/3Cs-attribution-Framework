# Unified Codebook Template (v1.1)

## Scope
- Review type: `literature | bibliographic | systematic`
- Topic:
- Research question(s):

## Coding Rules
1. Extract evidence at claim-level granularity (not full paragraph dump).
2. Preserve source traceability using `item_key` and `evidence_row_id`.
3. Prefer direct quote + concise paraphrase + coder interpretation.
4. Assign `relevance_score` (1-5) and `confidence_score` (1-5) for each evidence row.
5. Use controlled vocab for `evidence_type`, `argument_type`, `claim_direction`, and `exclude_reason` when present.
6. Keep each evidence row atomic: one claim, one evidential statement.

## Stable IDs
- `item_key`:
  - If DOI exists: `doi:<doi_value>` (example: `doi:10.1145/1234.5678`)
  - Else fallback: `fa:<FirstAuthorLastName>_<Year>_<ShortTitleToken>`
- `evidence_row_id`:
  - `<item_key>#001`, `<item_key>#002`, ...
  - Never recycle IDs after adjudication; mark deprecated rows in notes if replaced.

## Core Fields
- `evidence_row_id`
- `item_key`
- `title`
- `year`
- `collection`
- `evidence_type`
- `relevance_score`
- `direct_quote`
- `paraphrase`
- `researcher_comment`

## Provenance Fields (Recommended)
- `llm_assisted` (`yes|no`)
- `llm_model`
- `prompt_template_id`
- `codebook_version_used`

## Mode-Specific Required Fields
### Literature
- `potential_themes`
- `relevant_rqs`

### Bibliographic
- `doi`
- `venue`

### Systematic
- `study_design`
- `risk_of_bias`
- `quality_grade`

## Argument Type Guidance
- `definition`: conceptual boundary or term definition
- `descriptive_claim`: states what is observed without causal inference
- `causal_claim`: cause-effect assertion
- `correlational_claim`: explicit non-causal association
- `comparative_claim`: compares methods/frameworks/outcomes
- `assumption`: explicit prerequisite
- `scope_condition`: boundary condition for claim validity
- `normative_claim`: recommends what should be done
- `methodological_claim`: claims about method/design validity
- `limitation`: explicit caveat or weakness
- `threat_to_validity`: threat that may bias interpretation
- `recommendation`: future step/proposal
- `replication_claim`: confirms/contrasts prior results through replication

## Evidence Type Controlled Vocabulary (Baseline)
- `definition_conceptual`
- `theory_model`
- `formal_proof`
- `empirical_quantitative`
- `empirical_qualitative`
- `mixed_methods`
- `measurement_study`
- `experiment`
- `case_study`
- `simulation_benchmark`
- `dataset_resource`
- `tool_system`
- `review_secondary`
- `position_normative`
- `policy_standard`

## Claim Direction Controlled Vocabulary
- `supports`
- `contradicts`
- `mixed`
- `null_no_effect`
- `unclear`

## Exclude Reason Controlled Vocabulary (Screening)
- `out_of_scope_topic`
- `wrong_population_context`
- `wrong_outcome`
- `wrong_study_type`
- `insufficient_information`
- `duplicate`
- `not_academic_source`
- `language`
- `full_text_unavailable`

## Scoring Rubrics
### `relevance_score` (1-5)
- `5`: Directly answers an RQ or is central evidence for a key theme/mechanism.
- `4`: Strongly related; provides major support/contrast but not core answer.
- `3`: Related background or partial evidence; useful for context/discussion.
- `2`: Tangential mention; low synthesis value.
- `1`: Barely connected; typically discardable at evidence-row level.

### `confidence_score` (1-5)
- `5`: Precise, well-scoped, method/data-supported, limitations addressed.
- `4`: Mostly solid with minor ambiguity or narrow generality.
- `3`: Some uncertainty (weak evaluation, unclear assumptions, limited reporting).
- `2`: Substantial uncertainty (speculative, poorly supported, unclear design).
- `1`: Opinion-level or unsupported assertion.
- For systematic reviews, calibrate confidence with risk-of-bias and certainty frameworks where applicable.

## Open Coding Workflow (Scalable)
1. Protocol-lite: lock scope, RQs, inclusion criteria, and target outputs.
2. Facet schema first: define 2-4 primary facets before broad coding.
3. Pilot 5-10 papers and freeze `v0.1` codebook definitions.
4. Two-pass extraction per paper:
   - Pass A: harvest atomic evidence rows (definitions/findings/method/limitations/recommendations).
   - Pass B: assign codes (`evidence_type`, `argument_type`, `claim_direction`) and memo.
5. Open -> axial transition after ~20-30% corpus: cluster recurring open codes into named themes/mechanisms.
6. Add explicit cross-source synthesis rows early (cite >=2 `evidence_row_id`s).
7. Keep appraisal as separate track for systematic depth (risk-of-bias/quality tools by study design).
8. Reliability and adjudication: double-code 10-20%, resolve disagreements via code definition updates or decision rules.

## Quality Bar
- Avoid vague extracts with no analytic value.
- Avoid duplicated claims unless they support cross-source triangulation.
- For each section in writing phase, ensure at least one cross-source comparison claim.
- Ensure each synthesis claim traces back to concrete `evidence_row_id` values.
- Treat LLM outputs as assistive drafts: every retained claim must remain quote-anchored and source-verifiable.
