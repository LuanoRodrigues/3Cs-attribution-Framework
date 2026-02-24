#!/usr/bin/env python3
"""
ICJ score v4: statistical calibration layer over v3 claim scores.

This module runs the v3 deterministic scorer first, then applies:
1) reliability weighting,
2) low-evidence shrinkage (empirical-Bayes style),
3) nonlinear saturation on quantity-sensitive axes,
4) bootstrap confidence intervals at document level.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

import score_icj_v2 as v3


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _mean(xs: list[float]) -> float:
    if not xs:
        return 0.0
    return sum(xs) / float(len(xs))


def _safe_div(a: float, b: float) -> float:
    if b == 0.0:
        return 0.0
    return a / b


def _exp_saturation(x01: float, k: float = 1.8) -> float:
    """Monotone, bounded saturation in [0,1]."""
    x = _clamp01(x01)
    den = 1.0 - math.exp(-k)
    if den <= 0.0:
        return x
    return (1.0 - math.exp(-k * x)) / den


def _logistic_belief(evidence_support: float, req: float) -> float:
    k = 12.0
    x = evidence_support - req
    return 100.0 / (1.0 + math.exp(-k * x))


def _evidence_count(claim: dict) -> float:
    d = claim.get("score_details") or {}
    g = d.get("grounding") or {}
    c = d.get("credibility") or {}
    corr = d.get("corroboration") or {}
    anchors = float(g.get("evidence_anchor_count") or 0.0)
    eligible_sources = float(c.get("eligible_source_count") or 0.0)
    corr_sources = float(corr.get("eligible_source_count") or 0.0)
    return max(0.0, (0.50 * anchors) + (0.35 * eligible_sources) + (0.15 * corr_sources))


def _reliability_factor(claim: dict) -> float:
    s = claim.get("scores") or {}
    d = claim.get("score_details") or {}
    g = d.get("grounding") or {}
    c = d.get("credibility") or {}
    cu = d.get("custody") or {}

    grounding = _clamp01(float(s.get("grounding_0_100") or 0.0) / 100.0)
    custody_quality = _mean(
        [
            _clamp01(float(cu.get("provenance") or 0.0)),
            _clamp01(float(cu.get("integrity") or 0.0)),
            _clamp01(float(cu.get("time_anchors") or 0.0)),
            _clamp01(float(cu.get("artifact_identifiers") or 0.0)),
            _clamp01(float(cu.get("versioning") or 0.0)),
        ]
    )
    raw_sources = float(c.get("raw_source_count") or 0.0)
    eligible_sources = float(c.get("eligible_source_count") or 0.0)
    eligibility_ratio = _clamp01(_safe_div(eligible_sources, max(raw_sources, 1.0)))
    anchor_cov = _clamp01(float(g.get("anchor_coverage") or 0.0))

    base = (
        (0.35 * grounding) +
        (0.25 * custody_quality) +
        (0.20 * eligibility_ratio) +
        (0.20 * anchor_cov)
    )
    # Keep floor > 0 to avoid hard nullification from sparse extraction noise.
    return 0.20 + (0.80 * _clamp01(base))


def _weighted_mean_claims(vals: list[float], ws: list[float]) -> float:
    if not vals or not ws:
        return 0.0
    den = sum(ws)
    if den <= 0.0:
        return _mean(vals)
    return sum(v * w for v, w in zip(vals, ws)) / den


def _bootstrap_ci_weighted(vals: list[float], ws: list[float], n_iter: int = 2000, seed: int = 7) -> dict:
    if not vals:
        return {"mean": 0.0, "ci95_low": 0.0, "ci95_high": 0.0}
    rng = random.Random(seed)
    n = len(vals)
    draws = []
    for _ in range(n_iter):
        idxs = [rng.randrange(n) for _ in range(n)]
        v = [vals[i] for i in idxs]
        w = [ws[i] for i in idxs]
        draws.append(_weighted_mean_claims(v, w))
    draws.sort()
    lo = draws[int(0.025 * (len(draws) - 1))]
    hi = draws[int(0.975 * (len(draws) - 1))]
    return {"mean": _weighted_mean_claims(vals, ws), "ci95_low": lo, "ci95_high": hi}


def _calibrate_claims(base_report: dict) -> dict:
    claims = base_report.get("claims") or []
    if not claims:
        return base_report

    raw_chain = []
    raw_cred = []
    raw_corr = []
    raw_clarity = []
    raw_conf = []
    ws = []
    eff_ns = []
    rels = []

    for c in claims:
        s = c.get("scores") or {}
        raw_chain.append(_clamp01(float(s.get("custody_0_100") or 0.0) / 100.0))
        raw_cred.append(_clamp01(float(s.get("credibility_0_100") or 0.0) / 100.0))
        raw_corr.append(_clamp01(float(s.get("corroboration_0_100") or 0.0) / 100.0))
        raw_clarity.append(_clamp01(float(s.get("clarity_0_100") or 0.0) / 100.0))
        raw_conf.append(_clamp01(float(s.get("confidence_0_100") or 0.0) / 100.0))
        ws.append(float(c.get("gravity_weight") or 1.0))
        eff_ns.append(_evidence_count(c))
        rels.append(_reliability_factor(c))

    prior_chain = _weighted_mean_claims(raw_chain, ws)
    prior_cred = _weighted_mean_claims(raw_cred, ws)
    prior_corr = _weighted_mean_claims(raw_corr, ws)
    prior_clarity = _weighted_mean_claims(raw_clarity, ws)
    prior_conf = _weighted_mean_claims(raw_conf, ws)

    # Axis-specific shrinkage strengths (larger tau => stronger pull to prior for sparse claims).
    tau_chain = 2.2
    tau_cred = 2.8
    tau_corr = 3.2
    tau_clarity = 1.8
    tau_conf = 1.8

    calibrated = []
    for i, c in enumerate(claims):
        s = c.get("scores") or {}
        d = c.get("score_details") or {}
        corr_d = d.get("corroboration") or {}
        cred_d = d.get("credibility") or {}
        cu_d = d.get("custody") or {}
        g_d = d.get("grounding") or {}

        r = rels[i]
        n_eff = eff_ns[i]

        chain_rw = raw_chain[i] * (0.55 + (0.45 * r))
        cred_rw = raw_cred[i] * (0.60 + (0.40 * r))
        corr_rw = raw_corr[i] * (0.60 + (0.40 * r))
        clarity_rw = raw_clarity[i] * (0.65 + (0.35 * r))
        conf_rw = raw_conf[i] * (0.65 + (0.35 * r))

        lam_chain = _safe_div(n_eff, n_eff + tau_chain)
        lam_cred = _safe_div(n_eff, n_eff + tau_cred)
        lam_corr = _safe_div(n_eff, n_eff + tau_corr)
        lam_clarity = _safe_div(n_eff, n_eff + tau_clarity)
        lam_conf = _safe_div(n_eff, n_eff + tau_conf)

        chain_shr = (lam_chain * chain_rw) + ((1.0 - lam_chain) * prior_chain)
        cred_shr = (lam_cred * cred_rw) + ((1.0 - lam_cred) * prior_cred)
        corr_shr = (lam_corr * corr_rw) + ((1.0 - lam_corr) * prior_corr)
        clarity_shr = (lam_clarity * clarity_rw) + ((1.0 - lam_clarity) * prior_clarity)
        conf_shr = (lam_conf * conf_rw) + ((1.0 - lam_conf) * prior_conf)

        # Quantity-sensitive saturations:
        source_qty = _clamp01(float(corr_d.get("source_quantity") or 0.0))
        corr_sat = _exp_saturation(source_qty, k=1.6)
        corr_adj = corr_shr * (0.70 + (0.30 * corr_sat))

        artifact_ids = _clamp01(float(cu_d.get("artifact_identifiers") or 0.0))
        anchor_cov = _clamp01(float(g_d.get("anchor_coverage") or 0.0))
        chain_qty = (0.60 * artifact_ids) + (0.40 * anchor_cov)
        chain_sat = _exp_saturation(chain_qty, k=1.4)
        chain_adj = chain_shr * (0.72 + (0.28 * chain_sat))

        quality_mean = _clamp01(float(cred_d.get("quality_mean") or 0.0))
        diversity = _clamp01(float(cred_d.get("source_diversity") or 0.0))
        cred_quality_gate = (0.70 * quality_mean) + (0.30 * diversity)
        cred_adj = cred_shr * (0.75 + (0.25 * cred_quality_gate))

        clarity_adj = clarity_shr
        conf_adj = conf_shr

        chain_adj = _clamp01(chain_adj)
        cred_adj = _clamp01(cred_adj)
        corr_adj = _clamp01(corr_adj)
        clarity_adj = _clamp01(clarity_adj)
        conf_adj = _clamp01(conf_adj)

        grounding = _clamp01(float(s.get("grounding_0_100") or 0.0) / 100.0)
        evidence_weight = (
            (0.30 * chain_adj) +
            (0.25 * cred_adj) +
            (0.25 * corr_adj) +
            (0.20 * grounding)
        )
        evidence_support = evidence_weight * clarity_adj
        req = float(c.get("required_threshold_0_1") or 0.70)
        belief = _clamp01(_logistic_belief(evidence_support, req) / 100.0)

        new_claim = dict(c)
        new_scores = dict(s)
        new_scores_raw_v3 = dict(s)
        new_scores["custody_0_100"] = round(chain_adj * 100.0, 2)
        new_scores["credibility_0_100"] = round(cred_adj * 100.0, 2)
        new_scores["corroboration_0_100"] = round(corr_adj * 100.0, 2)
        new_scores["clarity_0_100"] = round(clarity_adj * 100.0, 2)
        new_scores["confidence_0_100"] = round(conf_adj * 100.0, 2)
        new_scores["evidence_weight_0_100"] = round(evidence_weight * 100.0, 2)
        new_scores["evidence_support_0_1"] = round(evidence_support, 4)
        new_scores["belief_0_100"] = round(belief * 100.0, 2)

        new_claim["scores_raw_v3"] = new_scores_raw_v3
        new_claim["scores"] = new_scores
        new_claim.setdefault("score_details", {})
        new_claim["score_details"]["statistical_calibration_v4"] = {
            "reliability_factor": round(r, 4),
            "effective_evidence_n": round(n_eff, 4),
            "shrinkage_lambda": {
                "custody": round(lam_chain, 4),
                "credibility": round(lam_cred, 4),
                "corroboration": round(lam_corr, 4),
                "clarity": round(lam_clarity, 4),
                "confidence": round(lam_conf, 4),
            },
            "prior_scores_0_1": {
                "custody": round(prior_chain, 4),
                "credibility": round(prior_cred, 4),
                "corroboration": round(prior_corr, 4),
                "clarity": round(prior_clarity, 4),
                "confidence": round(prior_conf, 4),
            },
            "saturation_factors": {
                "chain_quantity_score": round(chain_qty, 4),
                "chain_saturation": round(chain_sat, 4),
                "corroboration_source_quantity": round(source_qty, 4),
                "corroboration_saturation": round(corr_sat, 4),
                "credibility_quality_gate": round(cred_quality_gate, 4),
            },
        }
        calibrated.append(new_claim)

    out = dict(base_report)
    out["report_version"] = "v4"
    out["claims"] = calibrated

    ws2 = [float(c.get("gravity_weight") or 1.0) for c in calibrated]
    belief_vals = [float((c.get("scores") or {}).get("belief_0_100") or 0.0) for c in calibrated]
    chain_vals = [float((c.get("scores") or {}).get("custody_0_100") or 0.0) for c in calibrated]
    cred_vals = [float((c.get("scores") or {}).get("credibility_0_100") or 0.0) for c in calibrated]
    corr_vals = [float((c.get("scores") or {}).get("corroboration_0_100") or 0.0) for c in calibrated]
    conf_vals = [float((c.get("scores") or {}).get("confidence_0_100") or 0.0) for c in calibrated]
    clarity_vals = [float((c.get("scores") or {}).get("clarity_0_100") or 0.0) for c in calibrated]
    grounding_vals = [float((c.get("scores") or {}).get("grounding_0_100") or 0.0) for c in calibrated]

    doc = dict(out.get("document_scores") or {})
    doc["belief_weighted_0_100"] = round(_weighted_mean_claims(belief_vals, ws2), 2)
    doc["grounding_avg_0_100"] = round(_mean(grounding_vals), 2)
    doc["custody_avg_0_100"] = round(_mean(chain_vals), 2)
    doc["credibility_avg_0_100"] = round(_mean(cred_vals), 2)
    doc["corroboration_avg_0_100"] = round(_mean(corr_vals), 2)
    doc["confidence_avg_0_100"] = round(_mean(conf_vals), 2)
    doc["clarity_avg_0_100"] = round(_mean(clarity_vals), 2)
    doc["credibility_composite_avg_0_100"] = round(0.50 * _mean(cred_vals) + 0.50 * _mean(corr_vals), 2)

    doc["bootstrap_95ci"] = {
        "belief_weighted_0_100": {k: round(v * 100.0, 2) for k, v in _bootstrap_ci_weighted([x / 100.0 for x in belief_vals], ws2, n_iter=2500, seed=11).items()},
        "custody_avg_0_100": {k: round(v * 100.0, 2) for k, v in _bootstrap_ci_weighted([x / 100.0 for x in chain_vals], ws2, n_iter=2500, seed=12).items()},
        "credibility_avg_0_100": {k: round(v * 100.0, 2) for k, v in _bootstrap_ci_weighted([x / 100.0 for x in cred_vals], ws2, n_iter=2500, seed=13).items()},
        "corroboration_avg_0_100": {k: round(v * 100.0, 2) for k, v in _bootstrap_ci_weighted([x / 100.0 for x in corr_vals], ws2, n_iter=2500, seed=14).items()},
        "clarity_avg_0_100": {k: round(v * 100.0, 2) for k, v in _bootstrap_ci_weighted([x / 100.0 for x in clarity_vals], ws2, n_iter=2500, seed=15).items()},
    }
    out["document_scores"] = doc
    out["statistical_profile"] = "reliability_shrinkage_saturation_bootstrap"
    return out


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="score input JSON (same contract as score_icj_v2)")
    ap.add_argument("--output", required=True, help="v4 score output JSON")
    args = ap.parse_args(argv)

    root = json.loads(Path(args.input).read_text(encoding="utf-8"))
    base = v3._score_document(root)
    out = _calibrate_claims(base)
    Path(args.output).write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    import sys

    main(sys.argv[1:])
