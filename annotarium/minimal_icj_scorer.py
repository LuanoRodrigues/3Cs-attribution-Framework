#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json


def avg(values):
    if not values:
        return 0.0
    return sum(values) / len(values)


def load_json(path):
    """Load JSON from a file path."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def noisy_or(weights):
    """Diminishing-returns aggregation: 1 - Π(1-w)."""
    p = 1.0
    for w in weights:
        p *= (1.0 - w)
    return 1.0 - p


def evidence_weight(evidence_item):
    """ICJ-style probative weight w = I * A * M * P * T."""
    f = evidence_item["features"]
    return f["I"] * f["A"] * f["M"] * f["P"] * f["T"]


def custody_metric(evidence_items):
    """
    Quality-weighted Chain of Custody.
    - Quantity signal: noisy_or(A*T) over evidence items.
    - Quality signal: average(A*T) over evidence items.
    - Process signal: average(M*P) to avoid high custody from sheer item count.
    """
    weights = []
    quality_terms = []
    process_terms = []
    for e in evidence_items:
        f = e["features"]
        at = f["A"] * f["T"]
        mp = f["M"] * f["P"]
        weights.append(at)
        quality_terms.append(at)
        process_terms.append(mp)

    quantity_signal = noisy_or(weights)
    quality_signal = avg(quality_terms)
    process_signal = avg(process_terms)

    # Weighted blend: quantity alone cannot dominate.
    return (
        0.45 * quantity_signal
        + 0.35 * quality_signal
        + 0.20 * process_signal
    )


def credibility_metric(evidence_items):
    """Proxy for source credibility: independence * methodology * procedural testing."""
    weights = []
    for e in evidence_items:
        f = e["features"]
        weights.append(f["I"] * f["M"] * f["P"])
    return noisy_or(weights)


def corroboration_metric(evidence_items):
    """
    Corroboration = independent origins + modality diversity.
    - Cluster evidence by origin_id to avoid circular citation inflation.
    - Aggregate by origins with diminishing returns.
    - Multiply by a modality diversity factor (0..1).
    """
    by_origin = {}
    for e in evidence_items:
        origin = e["origin_id"]
        by_origin.setdefault(origin, []).append(e)

    origin_weights = []
    for origin in by_origin:
        evs = by_origin[origin]
        origin_weights.append(noisy_or([evidence_weight(x) for x in evs]))

    base = noisy_or(origin_weights)

    modalities = set()
    for e in evidence_items:
        for m in e["modalities"]:
            modalities.add(m)

    diversity = len(modalities) / 3.0
    if diversity > 1.0:
        diversity = 1.0

    return base * diversity


def discretize_0_5(x):
    """Map [0,1] -> {0..5}."""
    if x == 0.0:
        return 0
    if x < 0.10:
        return 1
    if x < 0.25:
        return 2
    if x < 0.50:
        return 3
    if x < 0.75:
        return 4
    return 5


def score_claim(claim, evidence_index):
    """Return core-3C scores plus claim-level Cs if present."""
    evs = [evidence_index[eid] for eid in claim["evidence_ids"]]

    c_custody = custody_metric(evs)
    c_cred = credibility_metric(evs)
    c_corr = corroboration_metric(evs)

    # Balance penalty: if credibility/corroboration are weak, custody cannot remain maximal.
    # This prevents "many artifacts" from implying perfect chain-of-custody quality.
    support_balance = (c_cred + c_corr) / 2.0
    c_custody = c_custody * (0.55 + 0.45 * support_balance)

    out = {
        "claim_id": claim["claim_id"],
        "core_3cs": {
            "chain_of_custody": discretize_0_5(c_custody),
            "credibility": discretize_0_5(c_cred),
            "corroboration": discretize_0_5(c_corr),
        },
        "core_3cs_metrics": {
            "chain_of_custody": c_custody,
            "credibility": c_cred,
            "corroboration": c_corr,
        },
    }

    cf = claim["claim_features"]
    out["six_c_extension"] = {
        "coherence": discretize_0_5(cf["coherence"]),
        "confidence": discretize_0_5(cf["confidence_discipline"]),
        "compliance": discretize_0_5(cf["compliance_mapping"]),
    }

    out["allegation_gravity"] = cf["allegation_gravity"]
    return out


def score_document(run_json):
    """Score all claims; return per-claim scores and headline vectors."""
    evidence_index = {}
    for e in run_json["evidence_items"]:
        evidence_index[e["evidence_id"]] = e

    claim_scores = []
    for c in run_json["claims"]:
        claim_scores.append(score_claim(c, evidence_index))

    return {"doc_id": run_json["doc_id"], "claim_scores": claim_scores}


def main():
    parser = argparse.ArgumentParser(
        description="Minimal brittle ICJ scorer for score-ready Stage-8 JSON."
    )
    parser.add_argument("--input", required=True, help="Input score-ready JSON path.")
    parser.add_argument("--output", default="", help="Optional output path. Defaults to stdout.")
    args = parser.parse_args()

    payload = load_json(args.input)
    scored = score_document(payload)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(scored, f, ensure_ascii=False, indent=2)
        print(json.dumps({"ok": True, "output_path": args.output}, ensure_ascii=False))
    else:
        print(json.dumps(scored, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
