# ICJ‑weighted scoring methodology for cyber attribution claims

## Purpose and scope

This scoring system evaluates **why an audience should believe an attribution claim**, not how to perform attribution.

It is designed for the contested environment of cyber attribution, where:
- technical indicators are often opaque, selectively disclosed, or non‑reproducible;
- public vendor reports may not satisfy the evidentiary expectations of international adjudication;
- persuasion matters: an attribution claim is only strategically useful if it can be **credible, intelligible, and weight‑bearing** for the forum and purpose at hand (technical, strategic, legal).

The scoring produces claim‑level and document‑level metrics that approximate an **ICJ‑consistent evidentiary posture**:
- **burden** sits with the party making the factual assertion;
- the **required level of certainty increases with allegation gravity**;
- the **weight of an item** depends on the source, the process that generated it, and its quality;
- apparent corroboration is discounted when it is **single‑source cascading** (many references, but one origin).

## Data model assumptions

The scorer operates on a dossier JSON that already contains:
- a **source registry** (source_id, title, url, authors, year),
- parsed **text blocks** with stable anchor_id,
- extracted **citations** tied to anchor_id,
- extracted **claims** (claim_id, allegation_gravity, claim_statement).

The scorer intentionally does not “heal” missing structure. Missing required keys should raise.

## From 3Cs to 4Cs (plus grounding)

This system uses four primary variables and one cross‑cutting quality control:

1) **Custody**  
   Evidence handling and authenticity discipline: provenance, preservation, integrity controls, traceability.

2) **Corroboration**  
   Whether the claim is supported by genuinely independent sources and multiple evidentiary modalities.

3) **Confidence**  
   Whether the report expresses uncertainty and confidence in a calibrated way (no unjustified overconfidence).

4) **Clarity**  
   Whether the claim clearly separates **the act** (operation) and **the actor** (perpetrator), and whether it closes the gap between:
   - the operation and the alleged group, and (when relevant)
   - the group and the **state**.

5) **Grounding** (quality gate, cross‑cutting)  
   Whether the claim is actually *anchored* to diverse evidence blocks and citations, rather than self‑referential repetition of the claim statement.

Grounding is explicitly included because a common failure mode in public attribution is “support” that is only narrative restatement.

## Claim‑specific evidence anchoring

### Why anchoring is mandatory
A claim needs **support anchors** that are not the claim statement itself. This is the operational fix for:

- duplicated anchors (support = claim),
- “everything supports everything” source mapping,
- inflated corroboration counts.

### Deterministic anchor selection
For each claim:

1) Tokenise the claim statement into content terms (stopwords removed).
2) Scan all text blocks, excluding the claim block itself.
3) Score each block by:
   - lexical overlap with the claim statement,
   - presence of evidence markers (hashes, IPs/domains, forensics terms, telemetry),
   - minimum length,
   - similarity penalty (exclude near‑duplicates of the claim statement).
4) Select top‑K blocks with a diversity constraint (avoid selecting near‑duplicates of each other).

Output: `evidence_anchor_ids[]` per claim.

## Source‑to‑claim mapping (no over‑broadcast)

A claim’s supporting sources are defined as:

> The set of sources cited **inside the claim’s evidence anchors**.

This prevents a frequent anti‑pattern: every claim inheriting the entire document’s source registry.

The scorer:
- indexes citations by anchor_id,
- unions source_ids found in the selected evidence anchors,
- uses that set to compute corroboration and citation coverage.

## Citation coverage reinforcement

Citation extraction is frequently incomplete, especially for inline URLs.

The scorer therefore reconstructs URL citations by:
- scanning every text block for `http(s)://…`,
- normalising the URL (scheme+domain+path; dropping query/fragment),
- mapping the normalised URL to the source registry.

This increases recall for in‑document URL citations and improves source‑to‑claim mapping precision.

## C‑level scoring

All component scores are on a 0–100 scale.

### Grounding score (0–100)

Grounding is computed from five sub‑signals:

- **Anchor coverage:** number of evidence anchors (target ≈ 6).
- **Non‑duplication:** average (1 – Jaccard similarity) between claim tokens and evidence‑anchor tokens.
- **Evidence marker strength:** prevalence of technical/evidentiary markers.
- **Citation coverage:** citations found inside evidence anchors (target ≈ 6).
- **Source coverage:** distinct sources supporting the claim via citations (target ≈ 4).

Weighted formula:

`grounding = 100 * (0.25*anchor_cov + 0.20*nondup + 0.20*evidence_markers + 0.20*citation_cov + 0.15*source_cov)`

### Custody score (0–100)

Custody is approximated in text by detecting:

- provenance / collection pathway terms,
- integrity controls (hashing, signatures, forensic imaging),
- time anchors and reproducibility cues,
- artifact identifiers (hashes, IPs, domains),
- versioning discipline.

Weighted formula:

`custody = 100 * (0.30*provenance + 0.30*integrity + 0.15*time + 0.15*identifiers + 0.10*versioning)`

### Corroboration score (0–100)

Corroboration is computed from:

- **source quantity**: distinct sources supporting the claim,
- **domain independence**: unique domains / sources,
- **modality diversity**: evidence cues spanning multiple technical modalities,
- **cross‑check language**: explicit verification/consistency language.

Weighted formula:

`corroboration = 100 * (0.35*qty + 0.25*domain_indep + 0.25*modality + 0.15*crosscheck_lang)`

### Confidence score (0–100)

Confidence is treated as a tradecraft quality, not an evidentiary substitute.

Signals:
- explicit confidence language (“high confidence”, etc) or probability terms (“likely”),
- uncertainty transparency (limitations, missing data, alternative explanations),
- calibration penalty for **overconfidence** (stated confidence above supported evidence support).

Weighted formula:

`confidence = 100 * (0.40*explicitness + 0.30*transparency + 0.30*calibration)`

Where:
- `supported` is the computed evidence support level (see below),
- `calibration = 1 - max(0, stated - supported)`.

### Clarity score (0–100)

Clarity operationalises the “act vs actor” distinction:

- **act specificity**: does the claim describe what happened (operation type, method, victim/target cues)?
- **actor specificity**: does it identify the alleged actor (group/unit/institution cues)?
- **link specificity**: does it state the link between act and actor (attributed/linked/sponsored language)?
- **state gap penalty**: if the claim asserts a state actor but the evidence anchors do not supply state‑link cues.

Weighted formula:

`clarity = 100 * (0.35*act + 0.35*actor + 0.30*link) * (1 - state_gap_penalty)`

This is intentionally conservative: state attribution requires a closed explanatory bridge, not rhetorical conflation.

## ICJ‑style belief evaluation

### Gravity‑dependent required threshold

Each claim has an `allegation_gravity` label in:

- low
- medium
- high
- exceptional

These map to a required certainty threshold:

- low → 0.55  
- medium → 0.70  
- high → 0.85  
- exceptional → 0.95

The mapping is a tunable policy choice, but the monotonic structure is the key ICJ‑consistent idea: **more serious allegations demand higher certainty**.

### Evidence weight and evidence support

First compute:

`evidence_weight = 0.35*custody + 0.35*corroboration + 0.30*grounding`

Then compute:

`evidence_support = (evidence_weight/100) * (clarity/100)`

Interpretation:
- custody/corroboration/grounding establish weight,
- clarity gates whether the evidence actually supports the claimed actor‑act relationship.

### Belief score (0–100)

Belief is the comparison of evidence support to the required threshold, transformed by a logistic curve:

`belief = 100 / (1 + exp(-k*(evidence_support - required_threshold)))`

with k ≈ 12.

This yields:
- ~50 at the threshold,
- >85 once evidence support clears the threshold by ~0.15,
- sharp penalties for shortfalls at higher gravity.

## Document‑level score

Document belief is a gravity‑weighted mean of claim belief scores:

- low weight 1.0
- medium weight 1.2
- high weight 1.5
- exceptional weight 2.0

This reflects that a dossier that makes serious claims should be judged primarily on the seriousness‑weighted claims.

## Optional LLM enrichment (gpt‑5‑mini)

Deterministic heuristics cannot reliably:
- separate act/actor/link in complex prose,
- detect subtle act‑actor conflation,
- classify the state attribution pathway.

The scorer includes a placeholder function for optional LLM enrichment. The required output should be a JSON object:

```json
{
  "claim_id": "C001",
  "act": {"summary": "...", "specificity_0_1": 0.0},
  "actor": {"summary": "...", "specificity_0_1": 0.0, "actor_type": "state|state-organ|non-state|unknown"},
  "link": {
    "summary": "...",
    "specificity_0_1": 0.0,
    "attribution_path": "organ|instruction|direction-control|support-only|unknown",
    "conflation_flags": ["..."]
  },
  "gap_assessment": "closed|partially-closed|open",
  "clarity_score_0_100": 0.0,
  "rationale": "..."
}
```

A simple integration policy is:
- compute deterministic clarity,
- replace or blend clarity with LLM clarity when available,
- record both values for auditability.

## What this fixes (relative to common pipeline failures)

- **Grounding failure** (support = claim): fixed by deterministic evidence‑anchor selection and duplication filtering.
- **Over‑broadcast sources** (every claim gets every source): fixed by claim‑specific citation‑derived source mapping.
- **Partial citation recall** (missing inline URLs): improved by URL reconstruction and URL normalisation.
- **Act‑actor conflation**: addressed by the Clarity dimension and state‑gap penalty.


### LLM option for grounding alignment

If deterministic anchor selection is still recall‑heavy, add an LLM step that:
- receives a claim and a candidate anchor pool,
- selects a small ranked subset of anchors that contain distinct supporting facts,
- labels each anchor with evidence kind and which scoring dimensions it supports.

This lets you push precision into:
- grounding (evidence is not claim restatement),
- corroboration (anchors contain cross‑checks, not just citations),
- clarity (anchors explicitly bridge group → state when asserted).

A compatible JSON output shape is documented in `llm_anchor_alignment_placeholder()` in the scorer.
