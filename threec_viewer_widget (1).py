import argparse
import json
import sys
from pathlib import Path

import plotly.graph_objects as go
import plotly.io as pio
from plotly.subplots import make_subplots


THREEC_AXIS_LABELS = [
    "chain_of_custody",
    "credibility",
    "corroboration",
]


def composite_credibility_score(credibility: float, corroboration: float) -> float:
    return (0.5 * float(credibility)) + (0.5 * float(corroboration))

VERBATIM_TEXT_KEYS = [
    "verbatim_quote",
    "verbatim_text",
    "text_verbatim",
    "table_text_verbatim",
    "table_markdown",
]


def close_ring(values: list[float]) -> list[float]:
    return values + [values[0]]


def close_ring_labels(labels: list[str]) -> list[str]:
    return labels + [labels[0]]


def base_layout(fig: go.Figure, title: str) -> go.Figure:
    fig.update_layout(
        title=title,
        template="plotly_dark",
        font=dict(size=14),
        margin=dict(l=80, r=60, t=90, b=90),
        width=1200,
        height=780,
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
    )
    return fig


def fix_verbatim_quotes_flexible(raw: str) -> str:
    patterns = [f'"{k}"' for k in VERBATIM_TEXT_KEYS]
    out = []
    i = 0
    n = len(raw)
    in_verbatim = False
    escape = False

    def skip_ws(j: int) -> int:
        while j < n and raw[j] in " \t\r\n":
            j += 1
        return j

    while i < n:
        if in_verbatim is False:
            matched = ""
            for pat in patterns:
                if raw.startswith(pat, i):
                    matched = pat
                    break

            if matched != "":
                out.append(matched)
                i += len(matched)

                j = i
                while j < n:
                    ch = raw[j]
                    out.append(ch)
                    if ch == ":":
                        j += 1
                        break
                    j += 1

                while j < n:
                    ch = raw[j]
                    out.append(ch)
                    if ch == '"':
                        j += 1
                        in_verbatim = True
                        escape = False
                        break
                    j += 1

                i = j
                continue

            out.append(raw[i])
            i += 1
            continue

        if escape:
            out.append(raw[i])
            escape = False
            i += 1
            continue

        ch = raw[i]

        if ch == "\\":
            out.append(ch)
            escape = True
            i += 1
            continue

        if ch == '"':
            j = skip_ws(i + 1)
            if j < n and (raw[j] == "," or raw[j] == "}"):
                out.append('"')
                in_verbatim = False
                i += 1
                continue

            out.append('\\"')
            i += 1
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def parse_json_path(p: Path) -> dict | list:
    raw = p.read_text(encoding="utf-8")
    if raw.strip() == "":
        raise ValueError(f"Empty JSON file: {p}")

    try:
        return json.loads(raw, strict=False)
    except json.JSONDecodeError:
        raw2 = fix_verbatim_quotes_flexible(raw)
        return json.loads(raw2, strict=False)


def report_title(report: dict) -> str:
    return report["raw_extraction"]["document_metadata"]["title"]


def report_date(report: dict) -> str:
    return report["raw_extraction"]["document_metadata"]["publication_date"]


def preferred_icj_score_key(report: dict) -> str:
    scores = report.get("scores", {})
    for key in ("full_icj_v4", "full_icj_v3", "full_icj", "full_icj_v2"):
        if key in scores and isinstance(scores[key], dict):
            return key
    return ""


def preferred_icj_claims(report: dict) -> list[dict]:
    scores = report.get("scores", {})
    key = preferred_icj_score_key(report)
    if key:
        claims = scores[key].get("claims")
        if isinstance(claims, list):
            return claims
    return []


def preferred_icj_document_scores(report: dict) -> dict:
    scores = report.get("scores", {})
    key = preferred_icj_score_key(report)
    if key:
        doc = scores[key].get("document_scores")
        if isinstance(doc, dict):
            return doc
    return {}


def report_claim_scores(report: dict) -> list[dict]:
    scores = report.get("scores", {})
    key = preferred_icj_score_key(report)
    if key in {"full_icj_v4", "full_icj_v3"} and key in scores and isinstance(scores[key], dict):
        claims_vx = scores[key].get("claims")
        if isinstance(claims_vx, list):
            out: list[dict] = []
            for c in claims_vx:
                cid = str(c.get("claim_id") or "")
                s = c.get("scores") or {}
                chain = float(s.get("custody_0_100") or 0.0) / 100.0
                cred = float(s.get("credibility_0_100", s.get("grounding_0_100") or 0.0)) / 100.0
                corr = float(s.get("corroboration_0_100") or 0.0) / 100.0
                final_score = float(s.get("belief_0_100") or 0.0) / 100.0
                evidence = float(s.get("evidence_weight_0_100") or 0.0) / 100.0
                out.append(
                    {
                        "claim_id": cid,
                        "core_3c": {
                            "chain_of_custody_provenance": {"score": chain, "band_0_5": chain * 5.0},
                            "credibility_independence": {"score": cred, "band_0_5": cred * 5.0},
                            "corroboration_convergence": {"score": corr, "band_0_5": corr * 5.0},
                        },
                        "final_score": final_score,
                        "evidence_weight_aggregate": evidence,
                        "penalty_multiplier": 1.0,
                        "penalties": [],
                    }
                )
            return out
    if "full_icj" in scores:
        return scores["full_icj"]["scoring"]["claim_scores"]
    if "full_icj_v2" in scores:
        return scores["full_icj_v2"]["scoring"]["claim_scores"]
    for k, v in scores.items():
        if k.startswith("full_icj") and isinstance(v, dict):
            scoring = v.get("scoring", {})
            claim_scores = scoring.get("claim_scores")
            if isinstance(claim_scores, list):
                return claim_scores
    if "minimal_icj" in scores and isinstance(scores["minimal_icj"], dict):
        claim_scores = scores["minimal_icj"].get("claim_scores")
        if isinstance(claim_scores, list):
            return claim_scores
    raise KeyError("No supported scoring.claim_scores block found in report['scores']")


def report_claims_raw(report: dict) -> list[dict]:
    return report["raw_extraction"]["stage2_claim_extraction"]["attribution_claims"]


def report_evidence_items(report: dict) -> list[dict]:
    scores = report.get("scores", {})
    for key in ("full_icj_v4", "full_icj_v3", "full_icj", "full_icj_v2"):
        if key in scores and isinstance(scores[key], dict):
            normalized = scores[key].get("normalized", {})
            evidence_items = normalized.get("evidence_items")
            if isinstance(evidence_items, list):
                return evidence_items
    return []


def report_sources_normalized(report: dict) -> list[dict]:
    scores = report.get("scores", {})
    for key in ("full_icj_v4", "full_icj_v3", "full_icj", "full_icj_v2"):
        if key in scores and isinstance(scores[key], dict):
            normalized = scores[key].get("normalized", {})
            sources = normalized.get("sources")
            if isinstance(sources, list):
                return sources
    return []


def report_artifact_index(report: dict) -> list[dict]:
    return report["raw_extraction"]["stage1_markdown_parse"]["global_indices"]["artifacts"]


def report_sources_index(report: dict) -> list[dict]:
    return report["raw_extraction"]["stage1_markdown_parse"]["global_indices"]["sources"]


def report_headline_claim_id(report: dict) -> str:
    scores = report.get("scores", {})
    key = preferred_icj_score_key(report)
    if key in {"full_icj_v4", "full_icj_v3"} and key in scores and isinstance(scores[key], dict):
        claims = scores[key].get("claims")
        if isinstance(claims, list) and len(claims) > 0:
            ranked = sorted(
                claims,
                key=lambda c: float(((c.get("scores") or {}).get("belief_0_100") or 0.0)),
                reverse=True,
            )
            cid = str(ranked[0].get("claim_id") or "")
            if cid:
                return cid
    for key in ("full_icj", "full_icj_v2"):
        if key in scores and isinstance(scores[key], dict):
            scoring = scores[key].get("scoring", {})
            doc = scoring.get("document", {})
            headline = doc.get("headline_claim_id")
            if isinstance(headline, str) and headline != "":
                return headline
    claim_scores = report_claim_scores(report)
    if len(claim_scores) > 0:
        fallback = claim_scores[0].get("claim_id")
        if isinstance(fallback, str) and fallback != "":
            return fallback
    raise KeyError("No headline_claim_id and no claim_scores fallback found")


def report_document_scoring(report: dict) -> dict:
    scores = report.get("scores", {})
    key = preferred_icj_score_key(report)
    if key in {"full_icj_v4", "full_icj_v3"} and key in scores and isinstance(scores[key], dict):
        doc = scores[key].get("document_scores")
        if isinstance(doc, dict):
            mean_claim_score = float(doc.get("belief_weighted_0_100") or 0.0) / 100.0
            return {
                "seriousness_gate": {
                    "thresholds": {"overall_claim_score_mean_min": 0.70},
                    "observed": {"overall_claim_score_mean": mean_claim_score},
                }
            }
    for key in ("full_icj", "full_icj_v2"):
        if key in scores and isinstance(scores[key], dict):
            scoring = scores[key].get("scoring", {})
            doc = scoring.get("document")
            if isinstance(doc, dict):
                return doc
    return {
        "seriousness_gate": {
            "thresholds": {"overall_claim_score_mean_min": 0.0},
            "observed": {"overall_claim_score_mean": 0.0},
        }
    }


def document_c_values_0_to_1(report: dict) -> dict:
    doc = preferred_icj_document_scores(report)
    if isinstance(doc, dict) and len(doc) > 0:
        chain = float(doc.get("custody_avg_0_100") or 0.0) / 100.0
        cred = float(doc.get("credibility_avg_0_100") or 0.0) / 100.0
        corr = float(doc.get("corroboration_avg_0_100") or 0.0) / 100.0
        clarity = float(doc.get("clarity_avg_0_100") or 0.0) / 100.0
        return {
            "chain_of_custody": chain,
            "credibility_base": cred,
            "corroboration": corr,
            "credibility": composite_credibility_score(cred, corr),
            "clarity": clarity,
        }

    claim_scores = report_claim_scores(report)
    cids = [str(c.get("claim_id") or "") for c in claim_scores]
    chain = []
    cred = []
    corr = []
    for cs in claim_scores:
        s01 = claim_threec_scores_0_to_1(cs)
        chain.append(float(s01[0]))
        cred.append(float(s01[1]))
        corr.append(float(s01[2]))

    clarity_by_claim = {}
    claims_vx = preferred_icj_claims(report)
    if isinstance(claims_vx, list):
        for c in claims_vx:
            cid = str(c.get("claim_id") or "")
            s = c.get("scores") or {}
            clarity_by_claim[cid] = float(s.get("clarity_0_100") or 0.0) / 100.0
    clarity = [float(clarity_by_claim.get(cid, 0.0)) for cid in cids]

    cred_base = _safe_mean(cred)
    corr_base = _safe_mean(corr)
    return {
        "chain_of_custody": _safe_mean(chain),
        "credibility_base": cred_base,
        "corroboration": corr_base,
        "credibility": composite_credibility_score(cred_base, corr_base),
        "clarity": _safe_mean(clarity),
    }


def claim_scores_by_id(report: dict) -> dict:
    m = {}
    for cs in report_claim_scores(report):
        m[cs["claim_id"]] = cs
    return m


def claim_threec_scores_0_to_5(claim_score: dict) -> list[float]:
    c3 = claim_score["core_3c"]
    return [
        float(c3["chain_of_custody_provenance"]["band_0_5"]),
        float(c3["credibility_independence"]["band_0_5"]),
        float(c3["corroboration_convergence"]["band_0_5"]),
    ]


def claim_threec_scores_0_to_1(claim_score: dict) -> list[float]:
    c3 = claim_score["core_3c"]
    return [
        float(c3["chain_of_custody_provenance"]["score"]),
        float(c3["credibility_independence"]["score"]),
        float(c3["corroboration_convergence"]["score"]),
    ]


def make_spider_figure(scores_0_to_5: list[float], axis_labels: list[str], title: str, trace_name: str) -> go.Figure:
    theta = [str(x) for x in axis_labels]
    r = [float(x) for x in scores_0_to_5]

    fig = go.Figure()
    fig.add_trace(
        go.Scatterpolar(
            r=r,
            theta=theta,
            mode="lines",
            fill="toself",
            name=trace_name,
            opacity=0.25,
        )
    )
    fig.update_layout(
        polar=dict(
            radialaxis=dict(
                range=[0, 5],
                tickmode="array",
                tickvals=[0, 1, 2, 3, 4, 5],
                showticklabels=False,
                ticks="",
                showline=False,
            ),
            angularaxis=dict(direction="clockwise"),
        ),
        showlegend=True,
    )
    return base_layout(fig, title)


def make_claims_threec_heatmap(report: dict, title: str, normalized_0_to_1: bool = False) -> go.Figure:
    claim_scores = report_claim_scores(report)

    y_labels = []
    z = []
    hover = []

    for cs in claim_scores:
        cid = cs["claim_id"]
        scores_0_to_5 = claim_threec_scores_0_to_5(cs)
        scores_0_to_1 = claim_threec_scores_0_to_1(cs)
        scores = scores_0_to_1 if normalized_0_to_1 else scores_0_to_5
        y_labels.append(cid)
        z.append(scores)
        hover.append(
            [
                f"claim={cid}<br>axis={THREEC_AXIS_LABELS[j]}<br>score_0_to_5={scores_0_to_5[j]:.2f}<br>score_0_to_1={scores_0_to_1[j]:.4f}"
                for j in range(len(THREEC_AXIS_LABELS))
            ]
        )

    fig = go.Figure(
        data=go.Heatmap(
            z=z,
            x=THREEC_AXIS_LABELS,
            y=y_labels,
            text=hover,
            hoverinfo="text",
            zmin=0,
            zmax=1 if normalized_0_to_1 else 5,
            showscale=True,
        )
    )
    return base_layout(fig, title)


def _safe_mean(values: list[float]) -> float:
    if len(values) == 0:
        return 0.0
    return float(sum(values)) / float(len(values))


def _claim_evidence_profile(report: dict) -> list[dict]:
    claims_raw = report_claims_raw(report)
    by_score = claim_scores_by_id(report)
    enrichment = report.get("enrichment") or {}
    all_tables = enrichment.get("tables") or []
    all_figs = enrichment.get("figures") or []

    out = []
    for c in claims_raw:
        cid = c["claim_id"]
        cs = by_score.get(cid) or {}
        stmt = c.get("claim_statement") or {}
        loc = stmt.get("location") or {}
        heading = str(loc.get("section_heading") or "")

        cred = (((c.get("six_c") or {}).get("credibility") or {}))
        chain = (((c.get("six_c") or {}).get("chain_of_custody") or {}))

        src_count = len(cred.get("sources_supporting_claim") or cred.get("sources_index") or [])
        artifact_inventory = chain.get("artifact_inventory") or []
        artifact_types = len(artifact_inventory)
        artifact_total = sum(int(x.get("count") or 0) for x in artifact_inventory)
        evidence_items = len(chain.get("evidence_items") or [])
        components = len(c.get("claim_components_asserted") or [])
        corroboration_rows = (((c.get("six_c") or {}).get("corroboration") or {}).get("corroboration_matrix") or [])
        supported_components = 0
        for row in corroboration_rows:
            if int(row.get("source_count") or 0) > 0:
                supported_components += 1
        support_ratio = 0.0
        if components > 0:
            support_ratio = min(1.0, float(supported_components) / float(components))

        table_count = 0
        image_count = 0
        if heading != "":
            for t in all_tables:
                if str(t.get("section_heading") or "") == heading:
                    table_count += 1
            for f in all_figs:
                if str(f.get("section_heading") or "") == heading and str(f.get("resolved_image_path") or "") != "":
                    image_count += 1

        final_score = float(cs.get("final_score") or 0.0)
        c3 = cs.get("core_3c") or {}
        chain_score = float(((c3.get("chain_of_custody_provenance") or {}).get("score")) or 0.0)
        cred_score = float(((c3.get("credibility_independence") or {}).get("score")) or 0.0)
        corr_score = float(((c3.get("corroboration_convergence") or {}).get("score")) or 0.0)
        weighted_sources = float(src_count) * cred_score
        weighted_evidence = float(evidence_items) * ((chain_score + corr_score) / 2.0)
        weighted_artifacts = float(artifact_total) * chain_score
        weighted_exhibits = float(table_count + image_count) * chain_score

        out.append(
            {
                "claim_id": cid,
                "heading": heading,
                "source_count": src_count,
                "artifact_types": artifact_types,
                "artifact_total": artifact_total,
                "evidence_items": evidence_items,
                "components": components,
                "supported_components": supported_components,
                "support_ratio": support_ratio,
                "table_count": table_count,
                "image_count": image_count,
                "final_score": final_score,
                "chain_score": chain_score,
                "cred_score": cred_score,
                "corr_score": corr_score,
                "weighted_sources": weighted_sources,
                "weighted_evidence": weighted_evidence,
                "weighted_artifacts": weighted_artifacts,
                "weighted_exhibits": weighted_exhibits,
            }
        )
    return out


def make_general_overview_subplots(report: dict, title: str) -> go.Figure:
    cvals = document_c_values_0_to_1(report)
    axis_labels = ["chain_of_custody", "credibility", "clarity"]
    axis_vals = [
        float(cvals.get("chain_of_custody") or 0.0),
        float(cvals.get("credibility") or 0.0),
        float(cvals.get("clarity") or 0.0),
    ]

    fig = go.Figure()
    fig.add_trace(
        go.Scatterpolar(
            r=axis_vals,
            theta=axis_labels,
            mode="lines",
            fill="toself",
            name="document_score",
            opacity=0.35,
            hovertemplate="axis=%{theta}<br>score_0_1=%{r:.4f}<extra></extra>",
        )
    )
    fig.update_layout(
        title=title,
        template="plotly_dark",
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
        height=760,
        width=1280,
        margin=dict(l=60, r=40, t=90, b=70),
        polar=dict(
            radialaxis=dict(
                range=[0, 1],
                showticklabels=False,
                ticks="",
                showline=False,
            ),
            angularaxis=dict(direction="clockwise"),
        ),
    )
    return fig


def make_claim_evidence_subplots(report: dict, title: str) -> go.Figure:
    prof = _claim_evidence_profile(report)
    claim_ids = [p["claim_id"] for p in prof]
    src_counts = [p["source_count"] for p in prof]
    table_counts = [p["table_count"] for p in prof]
    image_counts = [p["image_count"] for p in prof]
    artifact_types = [p["artifact_types"] for p in prof]
    artifact_totals = [p["artifact_total"] for p in prof]
    weighted_sources = [p["weighted_sources"] for p in prof]
    weighted_evidence = [p["weighted_evidence"] for p in prof]
    weighted_artifacts = [p["weighted_artifacts"] for p in prof]
    weighted_exhibits = [p["weighted_exhibits"] for p in prof]
    support_ratio = [p["support_ratio"] for p in prof]

    fig = make_subplots(
        rows=2,
        cols=2,
        subplot_titles=(
            "Raw Claim Support Inputs",
            "Weighted Claim Support Inputs",
            "Raw Artifacts / Exhibits",
            "Weighted Artifacts / Exhibits",
        ),
        horizontal_spacing=0.12,
        vertical_spacing=0.18,
    )

    fig.add_trace(go.Bar(x=claim_ids, y=src_counts, name="sources_raw"), row=1, col=1)
    fig.add_trace(go.Bar(x=claim_ids, y=[p["evidence_items"] for p in prof], name="evidence_raw"), row=1, col=1)

    fig.add_trace(go.Bar(x=claim_ids, y=weighted_sources, name="sources_weighted"), row=1, col=2)
    fig.add_trace(go.Bar(x=claim_ids, y=weighted_evidence, name="evidence_weighted"), row=1, col=2)

    fig.add_trace(go.Bar(x=claim_ids, y=artifact_totals, name="artifacts_raw_total"), row=2, col=1)
    fig.add_trace(go.Bar(x=claim_ids, y=artifact_types, name="artifact_types_raw"), row=2, col=1)
    fig.add_trace(go.Bar(x=claim_ids, y=table_counts, name="tables_raw"), row=2, col=1)
    fig.add_trace(go.Bar(x=claim_ids, y=image_counts, name="images_raw"), row=2, col=1)

    fig.add_trace(go.Bar(x=claim_ids, y=weighted_artifacts, name="artifacts_weighted"), row=2, col=2)
    fig.add_trace(go.Bar(x=claim_ids, y=weighted_exhibits, name="exhibits_weighted"), row=2, col=2)
    fig.add_trace(go.Scatter(x=claim_ids, y=support_ratio, mode="lines+markers", name="component_support_ratio"), row=2, col=2)

    fig.update_layout(
        title=title,
        template="plotly_dark",
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
        barmode="group",
        height=900,
        width=1280,
        margin=dict(l=60, r=40, t=90, b=90),
    )
    return fig


def make_axis_subplots(report: dict, axis: str, title: str) -> go.Figure:
    claim_scores = report_claim_scores(report)
    claim_ids = [c["claim_id"] for c in claim_scores]

    if axis in {"chain", "credibility", "corroboration"}:
        idx = {"chain": 0, "credibility": 1, "corroboration": 2}[axis]
        vals = [claim_threec_scores_0_to_1(c)[idx] for c in claim_scores]
    else:
        claims_vx = preferred_icj_claims(report)
        map_0100 = {
            "clarity": "clarity_0_100",
            "confidence": "confidence_0_100",
            "grounding": "grounding_0_100",
            "belief": "belief_0_100",
        }
        key = map_0100.get(axis, "")
        v3_by_id = {}
        if isinstance(claims_vx, list) and key:
            for c in claims_vx:
                cid = str(c.get("claim_id") or "")
                s = c.get("scores") or {}
                v3_by_id[cid] = float(s.get(key) or 0.0) / 100.0
        vals = [float(v3_by_id.get(cid, 0.0)) for cid in claim_ids]

    means = [_safe_mean(vals)] * len(vals)

    fig = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=(f"{axis} score by claim (0–1)", f"{axis} score distribution"),
        horizontal_spacing=0.14,
    )
    fig.add_trace(go.Bar(x=claim_ids, y=vals, name=axis), row=1, col=1)
    fig.add_trace(go.Scatter(x=claim_ids, y=means, mode="lines", name="mean"), row=1, col=1)
    fig.add_trace(go.Histogram(x=vals, nbinsx=12, name="hist"), row=1, col=2)

    fig.update_yaxes(range=[0, 1], row=1, col=1, title_text="score_0_1")
    fig.update_xaxes(title_text="claim_id", row=1, col=1)
    fig.update_xaxes(title_text="score_0_1", row=1, col=2)
    fig.update_yaxes(title_text="count", row=1, col=2)
    fig.update_layout(
        title=title,
        template="plotly_dark",
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
        height=780,
        width=1280,
        margin=dict(l=60, r=40, t=90, b=70),
    )
    return fig


def _corroboration_claim_profile(report: dict) -> list[dict]:
    claims = preferred_icj_claims(report)
    if not isinstance(claims, list):
        return []

    out = []
    for c in claims:
        cid = str(c.get("claim_id") or "")
        s = c.get("scores") or {}
        d = ((c.get("score_details") or {}).get("corroboration") or {})
        raw = float(s.get("corroboration_raw_0_100", s.get("corroboration_0_100", 0.0))) / 100.0
        cal = float(s.get("corroboration_0_100", 0.0)) / 100.0
        raw_sources = int(d.get("raw_source_count", 0) or 0)
        eligible_sources = int(d.get("eligible_source_count", raw_sources) or 0)
        coverage = float(d.get("claim_coverage_factor", 0.0) or 0.0)
        stc = d.get("source_type_counts") if isinstance(d.get("source_type_counts"), dict) else {}
        out.append(
            {
                "claim_id": cid,
                "raw": raw,
                "calibrated": cal,
                "raw_sources": raw_sources,
                "eligible_sources": eligible_sources,
                "coverage": coverage,
                "source_type_counts": {str(k): int(v or 0) for k, v in stc.items()},
            }
        )
    return out


def make_corroboration_subplots(report: dict, title: str) -> go.Figure:
    prof = _corroboration_claim_profile(report)
    if len(prof) == 0:
        return make_axis_subplots(report, axis="corroboration", title=title)

    claim_ids = [p["claim_id"] for p in prof]
    raw = [p["raw"] for p in prof]
    cal = [p["calibrated"] for p in prof]
    raw_src = [p["raw_sources"] for p in prof]
    elig_src = [p["eligible_sources"] for p in prof]
    coverage = [p["coverage"] for p in prof]
    corroborated_flag = [1 if x > 0 else 0 for x in cal]

    all_types = sorted({k for p in prof for k in p["source_type_counts"].keys()})
    fig = make_subplots(
        rows=2,
        cols=2,
        subplot_titles=(
            "Corroboration by Claim (raw vs calibrated)",
            "Corroboration Source Counts (raw vs eligible)",
            "Corroboration Source-Type Mix by Claim",
            "Coverage Factor and Corroborated Claim Flag",
        ),
        horizontal_spacing=0.12,
        vertical_spacing=0.18,
    )

    fig.add_trace(go.Bar(x=claim_ids, y=raw, name="raw"), row=1, col=1)
    fig.add_trace(go.Bar(x=claim_ids, y=cal, name="calibrated"), row=1, col=1)

    fig.add_trace(go.Bar(x=claim_ids, y=raw_src, name="raw_sources"), row=1, col=2)
    fig.add_trace(go.Bar(x=claim_ids, y=elig_src, name="eligible_sources"), row=1, col=2)

    for st in all_types:
        vals = [p["source_type_counts"].get(st, 0) for p in prof]
        fig.add_trace(go.Bar(x=claim_ids, y=vals, name=f"type:{st}"), row=2, col=1)

    fig.add_trace(go.Scatter(x=claim_ids, y=coverage, mode="lines+markers", name="coverage_factor"), row=2, col=2)
    fig.add_trace(go.Bar(x=claim_ids, y=corroborated_flag, name="corroborated_flag"), row=2, col=2)

    fig.update_yaxes(range=[0, 1], row=1, col=1, title_text="score_0_1")
    fig.update_yaxes(title_text="count", row=1, col=2)
    fig.update_yaxes(title_text="source_count", row=2, col=1)
    fig.update_yaxes(range=[0, 1], row=2, col=2, title_text="ratio/flag")
    fig.update_layout(
        title=title,
        template="plotly_dark",
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
        barmode="group",
        height=900,
        width=1280,
        margin=dict(l=60, r=40, t=90, b=90),
        legend=dict(orientation="h"),
    )
    return fig


def threec_payload_json(report: dict) -> str:
    payload = []
    for cs in report_claim_scores(report):
        s05 = claim_threec_scores_0_to_5(cs)
        s01 = claim_threec_scores_0_to_1(cs)
        payload.append(
            {
                "claim_id": cs["claim_id"],
                "scores_0_to_5": {
                    "chain_of_custody": s05[0],
                    "credibility": s05[1],
                    "corroboration": s05[2],
                },
                "scores_0_to_1": {
                    "chain_of_custody": s01[0],
                    "credibility": s01[1],
                    "corroboration": s01[2],
                },
            }
        )
    return html_escape(json.dumps(payload, ensure_ascii=False, indent=2))


def make_claim_final_score_bar(report: dict, title: str) -> go.Figure:
    claim_scores = report_claim_scores(report)
    doc = report_document_scoring(report)
    gate = doc["seriousness_gate"]

    x = []
    y = []
    hover = []
    for cs in claim_scores:
        cid = cs["claim_id"]
        s = cs["final_score"]
        x.append(cid)
        y.append(s)
        hover.append(f"claim={cid}<br>final_score_0_to_1={s:.6f}")

    fig = go.Figure()
    fig.add_trace(go.Bar(x=x, y=y, text=hover, hoverinfo="text", name="final_score"))

    thr = gate["thresholds"]["overall_claim_score_mean_min"]
    fig.add_trace(
        go.Scatter(
            x=x,
            y=[thr] * len(x),
            mode="lines",
            name=f"seriousness_gate.mean_min={thr}",
        )
    )

    obs_mean = gate["observed"]["overall_claim_score_mean"]
    fig.add_trace(
        go.Scatter(
            x=x,
            y=[obs_mean] * len(x),
            mode="lines",
            name=f"observed.mean={obs_mean}",
        )
    )

    fig.update_layout(
        xaxis_title="Claim ID",
        yaxis_title="Claim score (0–1)",
        yaxis=dict(range=[0, 1]),
        barmode="group",
    )
    return base_layout(fig, title)


def make_headline_score_waterfall(report: dict, title: str) -> go.Figure:
    cid = report_headline_claim_id(report)
    cs = claim_scores_by_id(report)[cid]

    evidence = float(cs["evidence_weight_aggregate"])
    final_score = float(cs["final_score"])
    penalty_effect = final_score - evidence

    labels = ["evidence_weight_aggregate", "penalties (net)", "final_score"]
    measures = ["relative", "relative", "total"]
    values = [evidence, penalty_effect, final_score]

    penalty_notes = []
    for p in cs["penalties"]:
        penalty_notes.append(f"{p['name']}×{p['factor']}")

    hover = [
        f"claim={cid}<br>evidence_weight_aggregate={evidence:.6f}",
        f"claim={cid}<br>penalty_multiplier={cs['penalty_multiplier']}<br>penalties={', '.join(penalty_notes)}<br>delta={penalty_effect:.6f}",
        f"claim={cid}<br>final_score={final_score:.6f}",
    ]

    fig = go.Figure(
        go.Waterfall(
            name=cid,
            orientation="v",
            measure=measures,
            x=labels,
            y=values,
            text=hover,
            hoverinfo="text",
            connector=dict(line=dict()),
        )
    )
    fig.update_layout(
        xaxis_title="Component",
        yaxis_title="Score contribution",
        yaxis=dict(range=[0, max(0.25, evidence * 1.35)]),
        showlegend=False,
    )
    return base_layout(fig, title)


def make_evidence_factor_parallel_coords(report: dict, title: str) -> go.Figure:
    evidence_items = report_evidence_items(report)
    claim_ids = sorted({e["claim_id"] for e in evidence_items})
    claim_id_to_int = {cid: i for i, cid in enumerate(claim_ids)}
    color = [claim_id_to_int[e["claim_id"]] for e in evidence_items]

    dims = [
        dict(range=[0, 1], label="I (independence)", values=[e["features"]["I"] for e in evidence_items]),
        dict(range=[0, 1], label="A (authentication)", values=[e["features"]["A"] for e in evidence_items]),
        dict(range=[0, 1], label="M (method)", values=[e["features"]["M"] for e in evidence_items]),
        dict(range=[0, 1], label="P (procedural)", values=[e["features"]["P"] for e in evidence_items]),
        dict(range=[0, 1], label="T (time)", values=[e["features"]["T"] for e in evidence_items]),
        dict(range=[0, 1], label="w (probative)", values=[e["probative_weight"] for e in evidence_items]),
    ]

    fig = go.Figure(
        data=
        go.Parcoords(
            line=dict(color=color),
            dimensions=dims,
        )
    )
    return base_layout(fig, title)


def make_source_claim_modality_sankey(report: dict, title: str) -> go.Figure:
    evidence_items = report_evidence_items(report)
    sources = report_sources_normalized(report)

    source_kind_by_id = {s["source_id"]: s["source_kind"] for s in sources}

    links_1 = {}
    links_2 = {}

    for e in evidence_items:
        w = float(e["probative_weight"])
        claim_id = e["claim_id"]

        for sid in e["source_ids"]:
            sk = source_kind_by_id[sid]
            key = (sk, claim_id)
            links_1[key] = links_1.get(key, 0.0) + (w / float(len(e["source_ids"])))

        for m in e["modalities"]:
            key = (claim_id, m)
            links_2[key] = links_2.get(key, 0.0) + (w / float(len(e["modalities"])))

    source_kinds = sorted({k[0] for k in links_1})
    claim_ids = sorted({k[1] for k in links_1} | {k[0] for k in links_2})
    modalities = sorted({k[1] for k in links_2})

    labels = source_kinds + claim_ids + modalities
    idx = {lab: i for i, lab in enumerate(labels)}

    src = []
    tgt = []
    val = []

    for (sk, cid), w in links_1.items():
        src.append(idx[sk])
        tgt.append(idx[cid])
        val.append(w)

    for (cid, m), w in links_2.items():
        src.append(idx[cid])
        tgt.append(idx[m])
        val.append(w)

    fig = go.Figure(
        data=[
            go.Sankey(
                node=dict(label=labels, pad=15, thickness=18),
                link=dict(source=src, target=tgt, value=val),
            )
        ]
    )
    return base_layout(fig, title)


def make_artifact_treemap(report: dict, title: str) -> go.Figure:
    artifact_index = report_artifact_index(report)
    total = 0
    for a in artifact_index:
        total += int(a["count"])

    labels = ["artifacts"] + [a["artifact_type"] for a in artifact_index]
    parents = [""] + ["artifacts"] * len(artifact_index)
    values = [total] + [int(a["count"]) for a in artifact_index]

    fig = go.Figure(go.Treemap(labels=labels, parents=parents, values=values))
    return base_layout(fig, title)


def make_artifact_overview_subplots(report: dict, title: str) -> go.Figure:
    artifact_index = report_artifact_index(report)
    prof = _claim_evidence_profile(report)

    sorted_artifacts = sorted(artifact_index, key=lambda x: int(x.get("count") or 0), reverse=True)
    top = sorted_artifacts[:12]
    total = sum(int(a.get("count") or 0) for a in sorted_artifacts)

    type_x = [str(a.get("artifact_type") or "unknown") for a in top]
    type_y = [int(a.get("count") or 0) for a in top]
    type_share = [((v / total) if total > 0 else 0.0) for v in type_y]

    pie_labels = [str(a.get("artifact_type") or "unknown") for a in sorted_artifacts[:8]]
    pie_values = [int(a.get("count") or 0) for a in sorted_artifacts[:8]]
    tail = sum(int(a.get("count") or 0) for a in sorted_artifacts[8:])
    if tail > 0:
        pie_labels.append("other")
        pie_values.append(tail)

    claim_ids = [p["claim_id"] for p in prof]
    artifact_raw = [p["artifact_total"] for p in prof]
    artifact_weighted = [p["weighted_artifacts"] for p in prof]
    exhibits_raw = [int(p["table_count"]) + int(p["image_count"]) for p in prof]
    exhibits_weighted = [p["weighted_exhibits"] for p in prof]

    fig = make_subplots(
        rows=2,
        cols=2,
        specs=[[{"type": "xy"}, {"type": "domain"}], [{"type": "xy"}, {"type": "xy"}]],
        subplot_titles=(
            "Top Artifact Types (count + share)",
            "Artifact Type Composition",
            "Artifacts per Claim (raw vs chain-weighted)",
            "Exhibits per Claim (tables+images raw vs chain-weighted)",
        ),
        horizontal_spacing=0.12,
        vertical_spacing=0.2,
    )

    fig.add_trace(go.Bar(x=type_x, y=type_y, name="artifact_count"), row=1, col=1)
    fig.add_trace(go.Scatter(x=type_x, y=type_share, mode="lines+markers", name="type_share"), row=1, col=1)

    fig.add_trace(go.Pie(labels=pie_labels, values=pie_values, name="artifact_mix", hole=0.35), row=1, col=2)

    fig.add_trace(go.Bar(x=claim_ids, y=artifact_raw, name="artifacts_raw"), row=2, col=1)
    fig.add_trace(go.Bar(x=claim_ids, y=artifact_weighted, name="artifacts_weighted"), row=2, col=1)

    fig.add_trace(go.Bar(x=claim_ids, y=exhibits_raw, name="exhibits_raw"), row=2, col=2)
    fig.add_trace(go.Bar(x=claim_ids, y=exhibits_weighted, name="exhibits_weighted"), row=2, col=2)

    fig.update_yaxes(title_text="count", row=1, col=1)
    fig.update_yaxes(title_text="count", row=2, col=1)
    fig.update_yaxes(title_text="count", row=2, col=2)
    fig.update_xaxes(title_text="artifact_type", row=1, col=1)
    fig.update_xaxes(title_text="claim_id", row=2, col=1)
    fig.update_xaxes(title_text="claim_id", row=2, col=2)
    fig.update_layout(
        title=title,
        template="plotly_dark",
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
        barmode="group",
        height=980,
        width=1280,
        margin=dict(l=60, r=40, t=90, b=90),
        legend=dict(orientation="h"),
    )
    return fig


def make_artifact_claim_heatmap(report: dict, title: str) -> go.Figure:
    claims = report_claims_raw(report)
    by_claim = {}
    all_types = {}

    for c in claims:
        cid = str(c.get("claim_id") or "")
        chain = (((c.get("six_c") or {}).get("chain_of_custody") or {}))
        inv = chain.get("artifact_inventory") or []
        row = {}
        for a in inv:
            t = str(a.get("artifact_type") or "unknown")
            cnt = int(a.get("count") or 0)
            row[t] = row.get(t, 0) + cnt
            all_types[t] = all_types.get(t, 0) + cnt
        by_claim[cid] = row

    claim_ids = [str(c.get("claim_id") or "") for c in claims]
    top_types = [t for t, _ in sorted(all_types.items(), key=lambda kv: kv[1], reverse=True)[:12]]
    if len(top_types) == 0:
        top_types = ["none"]

    z = []
    hover = []
    for cid in claim_ids:
        row = by_claim.get(cid, {})
        vals = []
        hov_row = []
        for t in top_types:
            v = int(row.get(t, 0))
            vals.append(v)
            hov_row.append(f"claim={cid}<br>artifact_type={t}<br>count={v}")
        z.append(vals)
        hover.append(hov_row)

    fig = go.Figure(
        data=go.Heatmap(
            z=z,
            x=top_types,
            y=claim_ids,
            text=hover,
            hoverinfo="text",
            colorscale="Viridis",
            showscale=True,
        )
    )
    fig.update_layout(
        title=title,
        template="plotly_dark",
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
        height=840,
        width=1280,
        margin=dict(l=80, r=40, t=90, b=120),
        xaxis_title="artifact_type (top by global count)",
        yaxis_title="claim_id",
    )
    return fig


def make_source_type_bar(report: dict, title: str) -> go.Figure:
    sources = report_sources_index(report)
    counts = {}
    for s in sources:
        k = s["source_type"]
        counts[k] = counts.get(k, 0) + 1

    x = sorted(counts.keys())
    y = [counts[k] for k in x]
    hover = [f"source_type={x[i]}<br>count={y[i]}" for i in range(len(x))]

    fig = go.Figure(data=go.Bar(x=x, y=y, text=hover, hoverinfo="text", name="sources"))
    fig.update_layout(
        xaxis_title="source_type",
        yaxis_title="count",
        margin=dict(l=80, r=60, t=90, b=220),
        width=1200,
        height=780,
        template="plotly_dark",
        font=dict(size=14),
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
    )
    fig.update_layout(title=title)
    return fig


def html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )


def sources_table_html(report: dict) -> str:
    rows = []
    for s in report_sources_index(report):
        url = s["url_or_identifier"]
        url_cell = ""
        if url is None:
            url_cell = ""
        if url is not None:
            url_cell = f"<a href=\"{html_escape(str(url))}\" target=\"_blank\" rel=\"noopener noreferrer\">{html_escape(str(url))}</a>"
        rows.append(
            "<tr>"
            f"<td>{html_escape(str(s['source_id']))}</td>"
            f"<td>{html_escape(str(s['source_type']))}</td>"
            f"<td>{html_escape(str(s['entity_name']))}</td>"
            f"<td>{html_escape(str(s['year']))}</td>"
            f"<td>{html_escape(str(s['title']))}</td>"
            f"<td>{url_cell}</td>"
            "</tr>"
        )

    return "\n".join(
        [
            "<table class=\"tbl\">",
            "<thead><tr><th>source_id</th><th>source_type</th><th>entity</th><th>year</th><th>title</th><th>url</th></tr></thead>",
            "<tbody>",
            *rows,
            "</tbody>",
            "</table>",
        ]
    )


def artifacts_table_html(report: dict) -> str:
    rows = []
    for a in report_artifact_index(report):
        examples = ", ".join([html_escape(str(x)) for x in a["example_values"]])
        rows.append(
            "<tr>"
            f"<td>{html_escape(str(a['artifact_type']))}</td>"
            f"<td>{html_escape(str(a['count']))}</td>"
            f"<td>{examples}</td>"
            "</tr>"
        )

    return "\n".join(
        [
            "<table class=\"tbl\">",
            "<thead><tr><th>artifact_type</th><th>count</th><th>examples</th></tr></thead>",
            "<tbody>",
            *rows,
            "</tbody>",
            "</table>",
        ]
    )


def claims_table_html(report: dict) -> str:
    rows = []
    for c in report_claims_raw(report):
        rows.append(
            "<tr>"
            f"<td>{html_escape(str(c['claim_id']))}</td>"
            f"<td>{html_escape(str(c['claim_type']))}</td>"
            f"<td>{html_escape(str(c['claim_statement']))}</td>"
            "</tr>"
        )

    return "\n".join(
        [
            "<table class=\"tbl\">",
            "<thead><tr><th>claim_id</th><th>claim_type</th><th>claim_statement</th></tr></thead>",
            "<tbody>",
            *rows,
            "</tbody>",
            "</table>",
        ]
    )


def figure_div(fig: go.Figure, include_js: bool) -> str:
    return pio.to_html(fig, include_plotlyjs=include_js, full_html=False)


def build_viewer_html(report: dict) -> str:
    title = report_title(report)
    date = report_date(report)
    headline_id = report_headline_claim_id(report)
    fig_general = make_general_overview_subplots(report, title=f"General Overview — {title} ({date})")
    fig_heatmap_01 = make_claims_threec_heatmap(report, title=f"Three-C Heatmap (Claims, 0–1 raw scores) — {title}", normalized_0_to_1=True)
    fig_claim_mix = make_claim_evidence_subplots(report, title=f"Claims Evidence Mix — {title}")
    fig_chain = make_axis_subplots(report, axis="chain", title=f"Chain of Custody Focus — {title}")
    fig_cred = make_axis_subplots(report, axis="credibility", title=f"Credibility Focus — {title}")
    fig_clarity = make_axis_subplots(report, axis="clarity", title=f"Clarity Focus — {title}")
    fig_corr = make_corroboration_subplots(report, title=f"Corroboration Focus — {title}")
    fig_waterfall = make_headline_score_waterfall(report, title=f"Headline Claim Score Waterfall — {headline_id} — {title}")
    fig_parcoords = make_evidence_factor_parallel_coords(report, title=f"Evidence Item Factors (Parallel Coordinates) — {title}")
    fig_sankey = make_source_claim_modality_sankey(report, title=f"Evidence Flow Sankey (Source → Claim → Modality) — {title}")
    fig_artifacts = make_artifact_treemap(report, title=f"Artifact Type Treemap — {title}")
    fig_artifacts_overview = make_artifact_overview_subplots(report, title=f"Artifact Diagnostics — {title}")
    fig_artifacts_claim_heatmap = make_artifact_claim_heatmap(report, title=f"Claim × Artifact-Type Heatmap — {title}")
    fig_sources = make_source_type_bar(report, title=f"Source Type Distribution — {title}")

    groups = [
        (
            "General",
            [
                ("General Overview", figure_div(fig_general, include_js=True)),
                ("Heatmap 0–1", figure_div(fig_heatmap_01, include_js=False)),
                ("Claims Evidence", figure_div(fig_claim_mix, include_js=False)),
                ("Evidence Factors", figure_div(fig_parcoords, include_js=False)),
                ("Evidence Flow", figure_div(fig_sankey, include_js=False)),
                ("Sources", figure_div(fig_sources, include_js=False)),
                ("Headline Waterfall", figure_div(fig_waterfall, include_js=False)),
            ],
        ),
        (
            "Chain of Custody",
            [
                ("Chain Focus", figure_div(fig_chain, include_js=False)),
                ("Artifacts", figure_div(fig_artifacts, include_js=False)),
                ("Artifacts Diagnostics", figure_div(fig_artifacts_overview, include_js=False)),
                ("Artifacts by Claim", figure_div(fig_artifacts_claim_heatmap, include_js=False)),
            ],
        ),
        (
            "Credibility",
            [
                ("Credibility Focus", figure_div(fig_cred, include_js=False)),
                ("Corroboration Focus", figure_div(fig_corr, include_js=False)),
            ],
        ),
        ("Clarity", [("Clarity Focus", figure_div(fig_clarity, include_js=False))]),
    ]

    top_buttons = []
    top_panels = []
    for gi, (group_label, subplots) in enumerate(groups, start=1):
        gid = f"group{gi:02d}"
        g_active = " active" if gi == 1 else ""
        top_buttons.append(f'<button class="top-tab-btn{g_active}" data-group-target="{gid}">{html_escape(group_label)}</button>')

        sub_btns = []
        sub_panels = []
        for si, (sub_label, sub_div) in enumerate(subplots, start=1):
            sid = f"{gid}_sub{si:02d}"
            s_active = " active" if si == 1 else ""
            sub_btns.append(f'<button class="sub-tab-btn{s_active}" data-sub-target="{sid}">{html_escape(sub_label)}</button>')
            sub_panels.append(f'<section id="{sid}" class="sub-fig-panel{s_active}"><h2>{html_escape(sub_label)}</h2>{sub_div}</section>')

        top_panels.append(
            "\n".join(
                [
                    f'<section id="{gid}" class="top-panel{g_active}">',
                    '  <div class="top-panel-grid">',
                    '    <div class="sub-panels">',
                    *sub_panels,
                    "    </div>",
                    '    <div class="sub-tabbar">',
                    *sub_btns,
                    "    </div>",
                    "  </div>",
                    "</section>",
                ]
            )
        )

    return "\n".join(
        [
            "<!doctype html>",
            "<html>",
            "<head>",
            "  <meta charset=\"utf-8\">",
            f"  <title>{html_escape(title)} — Three-C Viewer</title>",
            "  <style>",
            "    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; background:#02050b; color:#dbe6f3; }",
            "    h1 { margin: 0 0 8px 0; }",
            "    .meta { color: #94a3b8; margin-bottom: 18px; }",
            "    .top-tabbar { display:flex; flex-wrap:wrap; gap:8px; margin: 14px 0 14px; }",
            "    .top-tab-btn { border:1px solid #334155; background:#060a12; color:#cbd5e1; border-radius:8px; padding:8px 10px; cursor:pointer; font-size:12px; }",
            "    .top-tab-btn.active { border-color:#14b8a6; color:#ecfeff; background:#0b1220; }",
            "    .top-panel-grid { display:grid; grid-template-columns: minmax(0, 1fr) max-content; gap:14px; align-items:start; }",
            "    .sub-panels { min-width:0; }",
            "    .sub-tabbar { display:flex; flex-direction:column; gap:8px; margin: 0; position: sticky; top: 16px; width: fit-content; justify-self: end; }",
            "    .sub-tab-btn { border:1px solid #334155; background:#08101a; color:#cbd5e1; border-radius:8px; padding:6px 8px; cursor:pointer; font-size:12px; text-align:left; width: fit-content; min-width: 0; white-space: nowrap; }",
            "    .sub-tab-btn.active { border-color:#38bdf8; color:#e0f2fe; background:#0b1220; }",
            "    a { color:#7dd3fc; }",
            "    .top-panel { display:none; margin-bottom: 24px; }",
            "    .top-panel.active { display:block; }",
            "    .sub-fig-panel { display:none; margin-bottom: 34px; }",
            "    .sub-fig-panel.active { display:block; }",
            "    @media (max-width: 1200px) { .top-panel-grid { grid-template-columns: 1fr; } .sub-tabbar { position: static; flex-direction: row; flex-wrap: wrap; } .sub-tab-btn { width: auto; } }",
            "    .tbl { border-collapse: collapse; width: 100%; font-size: 13px; background:#060a12; }",
            "    .tbl th, .tbl td { border: 1px solid #1e293b; padding: 8px; vertical-align: top; color:#dbe6f3; }",
            "    .tbl th { background: #0b1220; }",
            "    pre { background:#060a12; color:#dbe6f3; border:1px solid #1e293b !important; }",
            "  </style>",
            "</head>",
            "<body>",
            f"  <h1>{html_escape(title)}</h1>",
            f"  <div class=\"meta\">Publication date: {html_escape(date)} &nbsp; | &nbsp; Headline claim: {html_escape(headline_id)}</div>",
            "  <div class=\"top-tabbar\">",
            *top_buttons,
            "  </div>",
            "  <main>",
            *top_panels,
            "  </main>",
            "  <script>",
            "    (function(){",
            "      const topBtns = Array.from(document.querySelectorAll('.top-tab-btn'));",
            "      const topPanels = Array.from(document.querySelectorAll('.top-panel'));",
            "      const activateTop = (gid) => {",
            "        for (const b of topBtns) b.classList.toggle('active', b.dataset.groupTarget === gid);",
            "        for (const p of topPanels) p.classList.toggle('active', p.id === gid);",
            "      };",
            "      const activateSub = (panel, sid) => {",
            "        const btns = Array.from(panel.querySelectorAll('.sub-tab-btn'));",
            "        const panels = Array.from(panel.querySelectorAll('.sub-fig-panel'));",
            "        for (const b of btns) b.classList.toggle('active', b.dataset.subTarget === sid);",
            "        for (const p of panels) p.classList.toggle('active', p.id === sid);",
            "      };",
            "      for (const tp of topPanels) {",
            "        const sBtns = Array.from(tp.querySelectorAll('.sub-tab-btn'));",
            "        for (const b of sBtns) b.addEventListener('click', () => activateSub(tp, b.dataset.subTarget));",
            "        if (sBtns.length > 0) activateSub(tp, sBtns[0].dataset.subTarget);",
            "      }",
            "      for (const b of topBtns) b.addEventListener('click', () => activateTop(b.dataset.groupTarget));",
            "      if (topBtns.length > 0) activateTop(topBtns[0].dataset.groupTarget);",
            "    })();",
            "  </script>",
            "</body>",
            "</html>",
        ]
    )


def _report_axis_means_0_to_1(report: dict) -> dict:
    claim_count = len(report_claim_scores(report))
    cvals = document_c_values_0_to_1(report)
    return {
        "chain_of_custody": float(cvals.get("chain_of_custody") or 0.0),
        "credibility_base": float(cvals.get("credibility_base") or 0.0),
        "corroboration": float(cvals.get("corroboration") or 0.0),
        "credibility": float(cvals.get("credibility") or 0.0),
        "clarity": float(cvals.get("clarity") or 0.0),
        "claim_count": claim_count,
    }


def _report_label(report: dict) -> str:
    src = report.get("source_files") if isinstance(report.get("source_files"), dict) else {}
    pdf_path = str(src.get("pdf") or "").strip()
    if pdf_path:
        stem = Path(pdf_path).stem.strip()
        if stem:
            return stem
    report_id = str(report.get("report_id") or report.get("id") or "").strip()
    if report_id:
        return report_id
    try:
        t = report_title(report)
        if isinstance(t, str) and t.strip():
            return t.strip()
    except Exception:
        pass
    return "report"


def make_aggregate_general_figure(reports: list[dict], labels: list[str], title: str) -> go.Figure:
    axis_labels = ["chain_of_custody", "credibility", "clarity"]
    means = [_report_axis_means_0_to_1(r) for r in reports]
    fig = go.Figure()
    palette = [
        "rgba(56, 189, 248, 0.82)",
        "rgba(20, 184, 166, 0.82)",
        "rgba(251, 191, 36, 0.82)",
        "rgba(244, 114, 182, 0.82)",
        "rgba(163, 230, 53, 0.82)",
        "rgba(99, 102, 241, 0.82)",
        "rgba(251, 146, 60, 0.82)",
        "rgba(248, 113, 113, 0.82)",
    ]

    for i, m in enumerate(means):
        vals = [float(m.get(a, 0.0)) for a in axis_labels]
        c = palette[i % len(palette)]
        fig.add_trace(
            go.Scatterpolar(
                r=vals,
                theta=axis_labels,
                mode="lines",
                fill="toself",
                fillcolor=c,
                line=dict(color=c, width=2),
                name=labels[i],
                hovertemplate=f"document={labels[i]}<br>axis=%{{theta}}<br>score_0_1=%{{r:.4f}}<extra></extra>",
            )
        )

    overall = []
    for a in axis_labels:
        overall.append(_safe_mean([float(m.get(a, 0.0)) for m in means]))
    fig.add_trace(
        go.Scatterpolar(
            r=overall,
            theta=axis_labels,
            mode="lines+markers",
            fill="toself",
            fillcolor="rgba(255, 255, 255, 0.72)",
            name="ALL_DOCS_MEAN",
            line=dict(width=4, color="rgba(255,255,255,1.0)"),
            marker=dict(size=6, color="rgba(255,255,255,1.0)"),
            hovertemplate="document=ALL_DOCS_MEAN<br>axis=%{theta}<br>score_0_1=%{r:.4f}<extra></extra>",
        )
    )

    fig.update_layout(
        title=title,
        template="plotly_dark",
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
        height=760,
        width=1280,
        margin=dict(l=60, r=220, t=90, b=70),
        legend=dict(
            orientation="v",
            x=1.02,
            y=1.0,
            xanchor="left",
            yanchor="top",
            bgcolor="rgba(2,5,11,0.85)",
            bordercolor="#334155",
            borderwidth=1,
        ),
        polar=dict(
            radialaxis=dict(
                range=[0, 1],
                showticklabels=False,
                ticks="",
                showline=False,
            ),
            angularaxis=dict(direction="clockwise"),
        ),
    )
    return fig


def make_aggregate_axis_figure(reports: list[dict], labels: list[str], axis: str, title: str) -> go.Figure:
    means = [_report_axis_means_0_to_1(r) for r in reports]
    vals = [float(m.get(axis, 0.0)) for m in means]
    claim_counts = [int(m.get("claim_count", 0)) for m in means]
    overall = _safe_mean(vals)
    fig = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=(f"{axis} mean by document", "Axis mean vs claim volume"),
        horizontal_spacing=0.12,
    )
    fig.add_trace(go.Bar(x=labels, y=vals, name=f"{axis}_mean"), row=1, col=1)
    fig.add_trace(go.Scatter(x=labels, y=[overall] * len(labels), mode="lines", name="ALL_DOCS_MEAN"), row=1, col=1)
    fig.add_trace(
        go.Scatter(
            x=claim_counts,
            y=vals,
            mode="markers+text",
            text=labels,
            textposition="top center",
            name="docs",
        ),
        row=1,
        col=2,
    )
    fig.update_yaxes(range=[0, 1], row=1, col=1, title_text="score_0_1")
    fig.update_xaxes(title_text="document", row=1, col=1)
    fig.update_yaxes(range=[0, 1], row=1, col=2, title_text="score_0_1")
    fig.update_xaxes(title_text="claim_count", row=1, col=2)
    fig.update_layout(
        title=title,
        template="plotly_dark",
        paper_bgcolor="#02050b",
        plot_bgcolor="#060a12",
        height=760,
        width=1320,
        margin=dict(l=60, r=40, t=90, b=90),
        legend=dict(orientation="h"),
    )
    return fig


def build_aggregate_viewer_html(reports: list[dict]) -> str:
    labels = []
    for r in reports:
        lbl = _report_label(r)
        labels.append(lbl if len(lbl) <= 70 else f"{lbl[:67]}...")
    title = f"Aggregated Dashboard ({len(reports)} reports)"

    fig_general = make_aggregate_general_figure(reports, labels, title=f"General — {title}")
    fig_chain = make_aggregate_axis_figure(reports, labels, axis="chain_of_custody", title=f"Chain of Custody — {title}")
    fig_cred = make_aggregate_axis_figure(reports, labels, axis="credibility", title=f"Credibility — {title}")
    fig_corr = make_aggregate_axis_figure(reports, labels, axis="corroboration", title=f"Corroboration — {title}")
    fig_clarity = make_aggregate_axis_figure(reports, labels, axis="clarity", title=f"Clarity — {title}")

    groups = [
        ("General", [("General Overview", figure_div(fig_general, include_js=True))]),
        ("Chain of Custody", [("Chain Focus", figure_div(fig_chain, include_js=False))]),
        (
            "Credibility",
            [
                ("Credibility Focus", figure_div(fig_cred, include_js=False)),
                ("Corroboration Focus", figure_div(fig_corr, include_js=False)),
            ],
        ),
        ("Clarity", [("Clarity Focus", figure_div(fig_clarity, include_js=False))]),
    ]

    top_buttons = []
    top_panels = []
    for gi, (group_label, subplots) in enumerate(groups, start=1):
        gid = f"group{gi:02d}"
        g_active = " active" if gi == 1 else ""
        top_buttons.append(f'<button class="top-tab-btn{g_active}" data-group-target="{gid}">{html_escape(group_label)}</button>')
        sub_btns = []
        sub_panels = []
        for si, (sub_label, sub_div) in enumerate(subplots, start=1):
            sid = f"{gid}_sub{si:02d}"
            s_active = " active" if si == 1 else ""
            sub_btns.append(f'<button class="sub-tab-btn{s_active}" data-sub-target="{sid}">{html_escape(sub_label)}</button>')
            sub_panels.append(f'<section id="{sid}" class="sub-fig-panel{s_active}"><h2>{html_escape(sub_label)}</h2>{sub_div}</section>')
        top_panels.append(
            "\n".join(
                [
                    f'<section id="{gid}" class="top-panel{g_active}">',
                    '  <div class="top-panel-grid">',
                    '    <div class="sub-panels">',
                    *sub_panels,
                    "    </div>",
                    '    <div class="sub-tabbar">',
                    *sub_btns,
                    "    </div>",
                    "  </div>",
                    "</section>",
                ]
            )
        )

    return "\n".join(
        [
            "<!doctype html>",
            "<html>",
            "<head>",
            "  <meta charset=\"utf-8\">",
            f"  <title>{html_escape(title)} — Three-C Viewer</title>",
            "  <style>",
            "    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; background:#02050b; color:#dbe6f3; }",
            "    h1 { margin: 0 0 8px 0; }",
            "    .meta { color: #94a3b8; margin-bottom: 18px; }",
            "    .top-tabbar { display:flex; flex-wrap:wrap; gap:8px; margin: 14px 0 14px; }",
            "    .top-tab-btn { border:1px solid #334155; background:#060a12; color:#cbd5e1; border-radius:8px; padding:8px 10px; cursor:pointer; font-size:12px; }",
            "    .top-tab-btn.active { border-color:#14b8a6; color:#ecfeff; background:#0b1220; }",
            "    .top-panel-grid { display:grid; grid-template-columns: minmax(0, 1fr) max-content; gap:14px; align-items:start; }",
            "    .sub-panels { min-width:0; }",
            "    .sub-tabbar { display:flex; flex-direction:column; gap:8px; margin: 0; position: sticky; top: 16px; width: fit-content; justify-self: end; }",
            "    .sub-tab-btn { border:1px solid #334155; background:#08101a; color:#cbd5e1; border-radius:8px; padding:6px 8px; cursor:pointer; font-size:12px; text-align:left; width: fit-content; min-width: 0; white-space: nowrap; }",
            "    .sub-tab-btn.active { border-color:#38bdf8; color:#e0f2fe; background:#0b1220; }",
            "    .top-panel { display:none; margin-bottom: 24px; }",
            "    .top-panel.active { display:block; }",
            "    .sub-fig-panel { display:none; margin-bottom: 34px; }",
            "    .sub-fig-panel.active { display:block; }",
            "    @media (max-width: 1200px) { .top-panel-grid { grid-template-columns: 1fr; } .sub-tabbar { position: static; flex-direction: row; flex-wrap: wrap; } .sub-tab-btn { width: auto; } }",
            "  </style>",
            "</head>",
            "<body>",
            f"  <h1>{html_escape(title)}</h1>",
            f"  <div class=\"meta\">Documents aggregated: {len(reports)}</div>",
            "  <div class=\"top-tabbar\">",
            *top_buttons,
            "  </div>",
            "  <main>",
            *top_panels,
            "  </main>",
            "  <script>",
            "    (function(){",
            "      const topBtns = Array.from(document.querySelectorAll('.top-tab-btn'));",
            "      const topPanels = Array.from(document.querySelectorAll('.top-panel'));",
            "      const activateTop = (gid) => {",
            "        for (const b of topBtns) b.classList.toggle('active', b.dataset.groupTarget === gid);",
            "        for (const p of topPanels) p.classList.toggle('active', p.id === gid);",
            "      };",
            "      const activateSub = (panel, sid) => {",
            "        const btns = Array.from(panel.querySelectorAll('.sub-tab-btn'));",
            "        const panels = Array.from(panel.querySelectorAll('.sub-fig-panel'));",
            "        for (const b of btns) b.classList.toggle('active', b.dataset.subTarget === sid);",
            "        for (const p of panels) p.classList.toggle('active', p.id === sid);",
            "      };",
            "      for (const tp of topPanels) {",
            "        const sBtns = Array.from(tp.querySelectorAll('.sub-tab-btn'));",
            "        for (const b of sBtns) b.addEventListener('click', () => activateSub(tp, b.dataset.subTarget));",
            "        if (sBtns.length > 0) activateSub(tp, sBtns[0].dataset.subTarget);",
            "      }",
            "      for (const b of topBtns) b.addEventListener('click', () => activateTop(b.dataset.groupTarget));",
            "      if (topBtns.length > 0) activateTop(topBtns[0].dataset.groupTarget);",
            "    })();",
            "  </script>",
            "</body>",
            "</html>",
        ]
    )


def cli() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Single-file Three-C viewer (writes a self-contained HTML dashboard).")
    p.add_argument(
        "--input",
        default="plots_ts/apt1_exposing_one_of_china_s_cyber_espionage_units_report.json",
        help="Path to a scored report JSON file.",
    )
    p.add_argument(
        "--input_multi",
        nargs="*",
        default=[],
        help="Optional list of multiple report JSON files to build an aggregated dashboard.",
    )
    p.add_argument(
        "--out_html",
        default="plots_ts/reports_results/apt1_threec_viewer.html",
        help="Output HTML path.",
    )
    p.add_argument("--no_gui", action="store_true", help="Only write HTML and exit (do not launch PyQt viewer).")
    return p.parse_args()


def run_pyqt_viewer(html: str, title: str, out_html: Path) -> None:
    try:
        from PyQt6.QtWidgets import QApplication, QMainWindow
        from PyQt6.QtWebEngineWidgets import QWebEngineView

        app = QApplication(sys.argv)
        window = QMainWindow()
        window.setWindowTitle(title)
        window.resize(1400, 900)

        view = QWebEngineView()
        view.setHtml(html)
        window.setCentralWidget(view)
        window.show()
        sys.exit(app.exec())
    except ModuleNotFoundError:
        try:
            from PyQt5.QtWidgets import QApplication, QMainWindow
            from PyQt5.QtWebEngineWidgets import QWebEngineView

            app = QApplication(sys.argv)
            window = QMainWindow()
            window.setWindowTitle(title)
            window.resize(1400, 900)

            view = QWebEngineView()
            view.setHtml(html)
            window.setCentralWidget(view)
            window.show()
            sys.exit(app.exec_())
        except ModuleNotFoundError:
            from PyQt6.QtWidgets import QApplication, QMainWindow, QTextBrowser

            html_uri = out_html.resolve().as_uri()

            app = QApplication(sys.argv)
            window = QMainWindow()
            window.setWindowTitle(title)
            window.resize(1000, 700)
            note = QTextBrowser()
            note.setReadOnly(True)
            note.setOpenExternalLinks(True)
            note.setHtml(
                "<h2>PyQt6 Viewer</h2>"
                "<p>Qt WebEngine is not installed, so interactive charts are unavailable in-app.</p>"
                f"<p>Generated dashboard: <a href=\"{html_uri}\">{out_html.resolve()}</a></p>"
                "<p>Open that file manually in a browser available on your system.</p>"
                "<p>Install <code>PyQt6-WebEngine</code> to render Plotly inside the app window.</p>"
            )
            window.setCentralWidget(note)
            window.show()
            sys.exit(app.exec())


def main() -> None:
    args = cli()
    out_html = Path(args.out_html)
    html = ""
    window_title = "Three-C Viewer"

    multi_paths = [Path(p) for p in (args.input_multi or []) if str(p).strip() != ""]
    if len(multi_paths) > 0:
        reports = []
        for rp in multi_paths:
            obj = parse_json_path(rp)
            if type(obj) is list:
                if len(obj) == 0:
                    continue
                obj = obj[0]
            if isinstance(obj, dict):
                reports.append(obj)
        if len(reports) == 0:
            raise ValueError("No valid reports provided in --input_multi")
        html = build_aggregate_viewer_html(reports)
        window_title = "Three-C Viewer — Aggregated"
    else:
        report_path = Path(args.input)
        report = parse_json_path(report_path)
        if type(report) is list:
            report = report[0]
        html = build_viewer_html(report)
        window_title = f"Three-C Viewer — {report_title(report)}"

    out_html.parent.mkdir(parents=True, exist_ok=True)
    out_html.write_text(html, encoding="utf-8")

    if args.no_gui is False:
        run_pyqt_viewer(html, title=window_title, out_html=out_html)


if __name__ == "__main__":
    main()
