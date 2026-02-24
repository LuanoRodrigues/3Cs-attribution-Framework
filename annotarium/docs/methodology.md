# Methodology

## I. Methodological Position

This study treats cyber-attribution reporting as an evidentiary exercise rather than a narrative exercise. The central claim is that attribution assessments should be evaluated as structured arguments about State responsibility, not as standalone assertions of confidence. In consequence, the method asks, for each proposition advanced in a report, what evidentiary materials are relied upon, how those materials are connected to the proposition, and whether those connections can bear weight under adversarial scrutiny.

The analytical posture is therefore jurisprudential. It draws from recurring ICJ evidentiary practice: differential weighting of heterogeneous materials, caution toward single-origin or litigation-shaped records, and preference for convergent indications over repetition. The objective is not to replicate adjudication procedurally, but to translate judicially legible evidentiary logic into a reproducible scoring framework for cyber-attribution dossiers.

## II. Corpus, Record Formation, and Constraints

The corpus consists of cybersecurity attribution reports in PDF form. Each report is transcribed into markdown and then transformed into a schema-constrained evidentiary record. The schema is strict by design. It separates claims, sources, artifacts, and evidence links into distinct objects and requires explicit anchors for evidentiary references.

This design choice has methodological significance. It prevents retrospective reconstruction of support through implicit model inference and compels the system to preserve an inspectable chain between proposition and proof. The method thus prioritizes evidentiary legibility over extraction breadth.

## III. Procedural Architecture

The workflow proceeds in four phases. First, source documents are transcribed from PDF into markdown. Second, markdown is parsed into structured outputs containing metadata, source inventories, artifact inventories, and claim-level analytic blocks. Third, outputs undergo integrity checks. Fourth, validated outputs are scored under an ICJ-inspired weighting model.

Two procedural commitments govern all phases. The first is determinacy: where possible, deterministic transformations are preferred, and model-assisted components are constrained by schema and post-run verification. The second is persistence: all major intermediate and terminal artifacts are written to disk, so that any score can be reconstructed and contested from the underlying record.

## IV. Integrity Controls as Admissibility Discipline

No score is produced absent structural integrity of the evidentiary record. In practical terms, runs are failed where identifier collisions occur, where artifact anchors are missing, where citation pathways cannot be traced, or where references resolve to nonexistent entities. These controls function analogously to admissibility discipline: they do not determine substantive truth, but they determine whether the record is fit to carry a substantive weighing exercise.

This stage is essential to avoid pseudo-precision. Without strict record integrity, downstream numerical outputs risk expressing parser convenience rather than evidentiary strength.

## V. Evidentiary Weight Model

### A. Item-Level Weight

Each evidence item is evaluated along five bounded dimensions: independence, authentication/provenance, methodological soundness, procedural testing, and contemporaneity. Item-level probative force is computed multiplicatively. The multiplicative form is deliberate: strong performance on one dimension cannot fully compensate for critical weakness on another.

### B. Corroboration and Anti-Circularity

Corroboration is not treated as citation volume. Evidence is clustered by origin, origin-level contribution is aggregated with diminishing returns, and claim-level corroboration is then derived from convergence across origins. This implements an anti-circularity rule: repeated downstream reporting of one upstream source does not become independent support merely by repetition.

### C. Core 3Cs

The principal outputs are the core 3Cs: Chain of Custody, Credibility, and Clarity. Corroboration is preserved as an explicit sub-calculation and audit surface, but it is integrated into the top-level Credibility axis rather than exposed as a separate top-level C.

Chain of Custody is modeled as claim-specific evidentiary handling quality, not as raw artifact quantity. In the current implementation, custody is computed from five normalized variables extracted from evidence text: provenance markers, integrity markers, temporal anchors, artifact identifiers, and versioning/update lineage. These dimensions are weighted and combined linearly, then bounded in `[0,1]`, so that the score remains auditable at claim level and cannot be inflated by a single indicator class.

Credibility is modeled as a composite of source-quality support and corroborative convergence for each claim. The source-quality component is derived from source-type quality, the strongest source attached to the claim, source diversity, and domain independence, with a single-source penalty. Internal/auto sources and newspapers are excluded from credibility support. The model gives maximal weight to international institutions/judicial material and peer-reviewed academic material, intermediate weight to official government and NGO material, and lower weight to think-tank/other material.

In addition, credibility is calibrated at the document level by a weighted claim-coverage factor keyed to high-credibility source support. Let `Cred_raw_i` denote raw credibility for claim `i`, and let `w_i` denote claim gravity weight. Define a credibility-covered claim as one with at least one high-credibility source (`source_quality >= 0.90`). Then:

`credibility_coverage_factor = (Σ w_i over credibility-covered claims) / (Σ w_i over all claims)`

and:

`Cred_i = Cred_raw_i × credibility_coverage_factor`

This ensures credibility is interpreted as weighted coverage across the claim set rather than isolated source quality in a small subset of claims.

Corroboration is modeled as convergence constrained by support relevance. A claim with broad wording but narrow evidentiary support receives lower corroborative strength, even where artifact volume is high. In the current presentation model, corroboration is retained as a dedicated subscore and then merged into top-level credibility:

`Credibility_top = 0.50 × Credibility_source_quality + 0.50 × Corroboration`

Clarity is modeled as legal attribution intelligibility. Operationally, it answers two linked questions: (i) whether attribution of attack `Z` to State `X` is clearly reasoned in the text, and (ii) whether the mode of responsibility is clear under state-responsibility doctrine. The scorer therefore checks not only act–actor–link specificity, but also whether the report clearly indicates one of three legal pathways: attribution through state organs, attribution through non-state actors operating under state direction/control, or state omission/failure of due diligence (knowledge plus failure to prevent within jurisdiction).

In practice, the clarity panel and score details expose explicit question-level outputs:

- “Is attribution to State X given attack Z clear?”
- “Was the state’s responsibility pathway clear: direct conduct by official organs, control/direction of non-state operators, or omission/due diligence failure in its territory?”
- “Is it clear that the state knew of the activity and failed to prevent, investigate, or suppress it (due diligence)?”

In addition, corroboration is calibrated at the document level by a claim-coverage factor so that corroboration is interpreted as proportionate coverage across the claim set, not absolute citation mass in isolated claims. Let `C_raw_i` denote raw corroboration for claim `i`, and let `w_i` denote the claim gravity weight. Define a corroborated claim as one for which `C_raw_i > 0`. Then:

`coverage_factor = (Σ w_i over corroborated claims) / (Σ w_i over all claims)`

and calibrated corroboration is:

`C_i = C_raw_i × coverage_factor`

This yields the intended limiting behavior: if all weighted claims are corroborated, `coverage_factor = 1`; if none are corroborated, `coverage_factor = 0`. The calibration therefore enforces claim-set coherence and prevents isolated corroboration spikes from dominating the document interpretation.

### D. Driver Table and Weights

The scoring model uses stable drivers and fixed weights within each profile. In the balanced profile, the operative structure is as follows.

| Axis | Driver | Weighting logic (balanced profile) | Legal function |
|---|---|---|---|
| C1 Chain of Custody | Provenance markers | `0.30 × provenance` | Captures explicit handling/provenance language in evidence blocks |
| C1 Chain of Custody | Integrity markers | `0.30 × integrity` | Rewards verifiability features (e.g., hashes/checksums/signatures/forensic handling terms) |
| C1 Chain of Custody | Temporal anchors | `0.15 × time_anchors` | Rewards explicit incident-time linkage and temporal traceability |
| C1 Chain of Custody | Artifact identifiers | `0.15 × artifact_identifiers` | Rewards stable technical referents (IPs, domains, hashes, CVEs, paths, etc.) |
| C1 Chain of Custody | Versioning lineage | `0.10 × versioning` | Rewards revision/update lineage and change tracking signals |
| C2 Credibility (source-quality component) | Source quality mean | `0.55 × quality_mean` | Prioritizes consistently strong source classes |
| C2 Credibility (source-quality component) | Top source quality | `0.20 × quality_top` | Rewards the strongest source attached to the claim |
| C2 Credibility (source-quality component) | Source diversity | `0.15 × source_diversity` | Prevents credibility from collapsing to one source pathway |
| C2 Credibility (source-quality component) | Domain independence | `0.10 × domain_independence` | Penalizes same-domain source concentration |
| C2 Credibility (source-quality component) | Single-source penalty | `× 0.85` when only one eligible source | Limits inflation from lone-source claims |
| C2 Credibility (corroboration sub-component) | Origin convergence | Noisy-OR aggregation by independent origin clusters | Enforces anti-circularity (repetition is not independent corroboration) |
| C2 Credibility (corroboration sub-component) | Support relevance | 0.55 base corroboration, 0.45 claim-support coverage | Requires that corroboration actually support asserted components |
| C2 Credibility (corroboration sub-component) | Claim-set coverage calibration | `C_i = C_raw_i × coverage_factor`, where `coverage_factor = Σw(corroborated)/Σw(all claims)` | Binds per-claim corroboration to weighted coverage across the whole claim set |
| C2 Credibility (top-level merge) | Composite merge | `Credibility_top = 0.50 × Credibility_source_quality + 0.50 × Corroboration` | Preserves both independence and convergence in one top-level C axis |
| Clarity | Act specificity | `0.35 × act_specificity` | Rewards precise description of the alleged operation/behavior |
| Clarity | Actor specificity | `0.35 × actor_specificity` | Rewards identifiable actor characterization (unit/group/state organ) |
| Clarity | Link specificity | `0.30 × link_specificity` | Rewards explicit evidentiary rationale connecting actor and act |
| Clarity | Legal pathway max | `0.20 × legal_path_max` | Rewards strongest legally intelligible attribution pathway (organ/control/due diligence) |
| Clarity | Legal pathway coverage | `0.20 × legal_path_coverage` | Rewards breadth of doctrinal support across attribution pathways |
| Clarity | State-actor gap penalty | multiplicative factor `(1 - penalty)` where penalty can be `0.35` | Penalizes state-level claims unsupported by state-link evidence |
| Overall claim score | Data-contribution hierarchy | 0.55 claim-support coverage + 0.45 artifact-proximity hierarchy; multiplier `0.55 + 0.45*score` | Penalizes claims where evidentiary material is not closely tied to the asserted proposition |

### E. Functional Form for Chain of Custody

For each claim, custody is computed directly from the claim’s evidence texts:

- `provenance`: normalized frequency of custody/provenance handling terms;
- `integrity`: normalized frequency of integrity-verification terms;
- `time_anchors`: normalized frequency of explicit temporal markers;
- `artifact_identifiers`: normalized count of stable technical identifiers;
- `versioning`: normalized frequency of revision/update lineage markers.

The operative scoring equation is:

`C1 = 0.30·provenance + 0.30·integrity + 0.15·time_anchors + 0.15·artifact_identifiers + 0.10·versioning`

and reported on a 0–100 scale as:

`C1_score = 100 × C1`

This form is intentionally transparent: each custody variable can be inspected independently, and the final score is the weighted sum of those explicit components.

### F. Functional Form for Credibility

For each claim, raw credibility is computed as:

`Cred_raw = 100 × (0.55·quality_mean + 0.20·quality_top + 0.15·source_diversity + 0.10·domain_independence) × single_source_penalty`

where `single_source_penalty = 0.85` if only one eligible source is present, otherwise `1.0`.

A source is treated as “high-credibility” when its source-quality weight is at least `0.90` (operationally: international institution/judicial or peer-reviewed academic classes).

Document-level credibility is then calibrated by weighted claim coverage:

`credibility_coverage_factor = (Σ w_i over claims with at least one high-credibility source) / (Σ w_i over all claims)`

and:

`Cred_i = Cred_raw_i × credibility_coverage_factor`

This yields the intended limiting behavior: if no claims carry high-credibility sources, calibrated credibility collapses toward zero across the claim set; if all weighted claims carry at least one high-credibility source, no down-scaling is applied.

Corroboration is computed separately and then merged into the displayed top-level credibility:

`Credibility_top = 0.50 × Cred_i + 0.50 × C_i`

### G. Functional Form for Clarity

For each claim, clarity is computed from lexical-syntactic specificity over both the claim statement and linked evidence text, with claim language weighted more heavily than evidence language. Matching uses boundary-aware term detection (word/phrase level), rather than naive substring matching, to avoid inflated counts.

`act_claim = min(hits_precise(claim_text, act_vocab)/3, 1)`

`act_evidence = min(hits_precise(evidence_text, act_vocab)/6, 1)`

`actor_claim = min(hits_precise(claim_text, actor_vocab)/3, 1)`

`actor_evidence = min(hits_precise(evidence_text, actor_vocab)/6, 1)`

`link_claim = min(hits_precise(claim_text, link_vocab)/3, 1)`

`link_evidence = min(hits_precise(evidence_text, link_vocab)/6, 1)`

and:

`act_specificity = 0.65·act_claim + 0.35·act_evidence`

`actor_specificity = 0.65·actor_claim + 0.35·actor_evidence`

`link_specificity = 0.60·link_claim + 0.40·link_evidence`

Raw clarity base is:

`clarity_base = 0.35·act_specificity + 0.35·actor_specificity + 0.30·link_specificity`

In parallel, the method computes doctrine-pathway clarity:

`organ_path_clarity` from state-organ signals + act/link specificity,

`control_path_clarity` from non-state actor signals + state direction/control linkage,

`due_diligence_path_clarity` from knowledge indicators + omission/failure-to-prevent indicators (+ territory/jurisdiction cues).

Let:

`legal_path_max = max(organ_path_clarity, control_path_clarity, due_diligence_path_clarity)`

`legal_path_coverage = (# of pathways >= 0.55) / 3`

The integrated clarity base is then:

`clarity_base_integrated = 0.22·act_specificity + 0.22·actor_specificity + 0.16·link_specificity + 0.20·legal_path_max + 0.20·legal_path_coverage`

If the claim text includes state-level attribution language but the supporting evidence lacks state-link markers (e.g., organ/sponsorship/direction-control cues), a gap penalty is applied:

`state_actor_gap_penalty = 0.35`

An additional legal-pathway penalty is applied where state-level attribution is asserted but no doctrine pathway is sufficiently evidenced:

`legal_path_gap_penalty = 0.20` when `legal_path_max < 0.40` and state-claim language is present.

Final clarity is:

`Clarity = 100 × clarity_base_integrated × (1 - state_actor_gap_penalty - legal_path_gap_penalty)`

This design keeps clarity distinct from credibility and corroboration: a claim may be well-sourced yet still score poorly on clarity if its legal attribution pathway remains ambiguous (for example, where a non-state actor is named but state control is not clearly established, or where due-diligence omission is asserted without knowledge-and-failure evidence).

## VI. Technical Evidence Without Bibliographic Citation

Cyber-attribution records frequently contain technical telemetry and indicators that are evidentially significant despite lacking bibliographic citation. The method therefore does not impose a categorical citation requirement on technical evidence classes. Where bibliographic linkage is absent, provenance and origin can be derived from collection context, sensor lineage, and artifact relationships. Source-based penalties are applied only where source-linked evidence is actually in issue.

This distinction is doctrinally important. Absence of publication metadata is not equivalent to absence of evidentiary pathway.

## VII. Calibration and Thresholding

The model supports strict, balanced, and permissive profiles. Profiles alter weighting intensity, penalty severity, and gate thresholds while leaving the evidentiary graph unchanged. This permits sensitivity analysis as a matter of standard-setting rather than data rewriting. Document-level seriousness gates are applied to prevent weak aggregate records from being represented as robust attribution conclusions.

In the current implementation, a second calibration layer (v4) is also available. This layer does not replace the evidentiary graph or doctrinal variables; it regularizes claim-level estimates where evidence is sparse and quantifies uncertainty at document level. The purpose is inferential discipline, not score inflation.

### VII.A. Reliability Weighting

Each claim receives a reliability factor `R_i` in `[0,1]`, derived from extraction and grounding quality signals rather than substantive outcome:

- grounding strength,
- custody quality (provenance/integrity/time/identifier/versioning profile),
- eligible-source ratio,
- anchor coverage.

Operationally:

`R_i = 0.35·grounding_i + 0.25·custody_quality_i + 0.20·eligibility_ratio_i + 0.20·anchor_coverage_i`

with bounded floor and ceiling for numerical stability. Axis scores are then reliability-weighted before any further adjustment.

### VII.B. Low-Evidence Shrinkage

Claim-level estimates are regularized toward document-level priors when effective evidence count is low. Let `n_i` denote effective evidence mass for claim `i` (anchor and eligible-source weighted), and let `tau` be an axis-specific shrinkage strength. The shrinkage weight is:

`lambda_i = n_i / (n_i + tau)`

and the shrunk score is:

`C_i_shrunk = lambda_i·C_i_weighted + (1 - lambda_i)·C_document_prior`

This reduces extreme volatility from claims supported by minimal evidence while preserving high-information claims.

### VII.C. Nonlinear Saturation for Quantity-Sensitive Terms

For quantity-sensitive channels (notably custody identifiers and corroboration source quantity), v4 applies bounded saturation:

`sat(x) = (1 - exp(-k·x)) / (1 - exp(-k))`

with `x in [0,1]`. This yields diminishing returns and prevents linear quantity accumulation from overwhelming quality constraints. Saturation modifies multiplicative gates, not doctrinal definitions.

### VII.D. Recomputed Belief Under Adjusted Evidence Support

After reliability weighting, shrinkage, and saturation, evidence support is recomputed:

`support_i = ((0.30·C1_i + 0.25·Cred_i + 0.25·Corr_i + 0.20·Ground_i) / 100) · (Clarity_i / 100)`

and transformed through the same gravity-conditioned logistic belief function used in baseline scoring. This preserves the evidentiary burden structure while improving statistical stability.

### VII.E. Uncertainty Quantification

v4 emits bootstrap 95% confidence intervals at document level for belief and principal C axes. Weighted claim resampling is used, with gravity weights preserved in each draw. The methodology therefore reports both point estimates and uncertainty bounds, enabling conservative interpretation (for example, using lower confidence bounds in threshold decisions).

In summary, v4 calibration is an inferential safeguard: it constrains sparse-claim overreach, dampens quantity artifacts, and makes uncertainty explicit without altering the legal-evidentiary logic of the framework.

## VIII. Auditability and Contestability

The methodology is built for contestation. It emits claim-level, evidence-level, and document-level outputs, along with readiness findings and penalty traces. Accordingly, each score can be examined as a traceable function of identified inputs and stated weighting assumptions.

In the dashboard, this principle is operationalized through top-level tabs for Credibility, Chain of Custody, and Clarity. Corroboration is preserved as a dedicated subpanel under Credibility, so source-quality and convergence remain separately auditable while contributing jointly to the top-level credibility axis. The Credibility panel exposes, per claim, raw and calibrated source-quality credibility, corroboration diagnostics, eligibility and counts of linked sources, quality mean/top, high-credibility-source status, and source-level classification with effective weighting. The Clarity panel exposes claim-level decomposition (`act_specificity`, `actor_specificity`, `link_specificity`, claim/evidence splits) together with doctrine-pathway scores (`organ_path_clarity`, `control_path_clarity`, `due_diligence_path_clarity`), legal pathway max/coverage, and gap penalties. The Chain of Custody panel provides a custody radar over `provenance`, `integrity`, `time_anchors`, `artifact_identifiers`, and `versioning`, together with linked evidence-item counts, artifact summaries, and supporting source identifiers. These panels are therefore not merely illustrative: they are the audit surfaces for verifying why each score was assigned.

The methodological claim is therefore modest but concrete: the framework does not adjudicate responsibility; it supplies a disciplined evidentiary weighting apparatus that makes attribution arguments more transparent, comparable, and challengeable under legal-style scrutiny.
