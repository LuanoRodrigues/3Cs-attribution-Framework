#!/usr/bin/env python3
import json
import math
import random
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PIPELINE_FILES_PATH = ROOT / "threec_electron_viewer" / "pipeline_files.json"
OUT_JSON_PATH = ROOT / "outputs" / "reports" / "portfolio_summary.json"
OUT_MD_PATH = ROOT / "outputs" / "reports" / "portfolio_summary.md"


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def safe_len(v) -> int:
    if isinstance(v, list):
        return len(v)
    return 0


def to_float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / float(len(values))


def sample_std(values: list[float]) -> float:
    n = len(values)
    if n <= 1:
        return 0.0
    m = mean(values)
    var = sum((x - m) ** 2 for x in values) / float(n - 1)
    if var < 0.0:
        return 0.0
    return math.sqrt(var)


def covariance(x: list[float], y: list[float]) -> float:
    n = min(len(x), len(y))
    if n <= 1:
        return 0.0
    xs = x[:n]
    ys = y[:n]
    mx = mean(xs)
    my = mean(ys)
    return sum((xs[i] - mx) * (ys[i] - my) for i in range(n)) / float(n - 1)


def pearson_corr(x: list[float], y: list[float]) -> float:
    cov = covariance(x, y)
    sx = sample_std(x)
    sy = sample_std(y)
    den = sx * sy
    if den == 0.0:
        return 0.0
    return cov / den


def rank_avg_ties(values: list[float]) -> list[float]:
    n = len(values)
    pairs = sorted((v, i) for i, v in enumerate(values))
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and pairs[j + 1][0] == pairs[i][0]:
            j += 1
        avg_rank = (float(i + 1) + float(j + 1)) / 2.0
        for k in range(i, j + 1):
            ranks[pairs[k][1]] = avg_rank
        i = j + 1
    return ranks


def spearman_corr(x: list[float], y: list[float]) -> float:
    n = min(len(x), len(y))
    if n <= 1:
        return 0.0
    rx = rank_avg_ties(x[:n])
    ry = rank_avg_ties(y[:n])
    return pearson_corr(rx, ry)


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    if p <= 0.0:
        return min(values)
    if p >= 1.0:
        return max(values)
    xs = sorted(values)
    idx = (len(xs) - 1) * p
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return xs[lo]
    w = idx - lo
    return xs[lo] * (1.0 - w) + xs[hi] * w


def bootstrap_mean_ci(values: list[float], iterations: int = 3000, seed: int = 42) -> dict:
    if not values:
        return {"mean": 0.0, "ci95_low": 0.0, "ci95_high": 0.0}
    rng = random.Random(seed)
    n = len(values)
    samples = []
    for _ in range(iterations):
        draw = [values[rng.randrange(n)] for _ in range(n)]
        samples.append(mean(draw))
    return {
        "mean": mean(values),
        "ci95_low": percentile(samples, 0.025),
        "ci95_high": percentile(samples, 0.975),
    }


def fbeta(precision: float, recall: float, beta: float = 2.0) -> float:
    p = clamp01(precision)
    r = clamp01(recall)
    if p == 0.0 and r == 0.0:
        return 0.0
    b2 = beta * beta
    den = (b2 * p) + r
    if den == 0.0:
        return 0.0
    return ((1.0 + b2) * p * r) / den


def claim_proxy_metrics(report_obj: dict) -> dict:
    scores = report_obj.get("scores") or {}
    v3 = scores.get("full_icj_v3") if isinstance(scores.get("full_icj_v3"), dict) else {}
    claims = v3.get("claims") if isinstance(v3.get("claims"), list) else []

    if not claims:
        return {
            "claims_count": 0,
            "weighted_coverage_ratio": 0.0,
            "weighted_precision_proxy": 0.0,
            "weighted_recall_proxy": 0.0,
            "weighted_f2_proxy": 0.0,
        }

    total_w = 0.0
    cov_w = 0.0
    p_w = 0.0
    r_w = 0.0
    f2_w = 0.0

    for c in claims:
        gw = to_float(c.get("gravity_weight"))
        if gw <= 0.0:
            gw = 1.0
        s = c.get("scores") or {}
        d = (c.get("score_details") or {}).get("corroboration") or {}

        corr_cal = clamp01(to_float(s.get("corroboration_0_100")) / 100.0)
        precision_proxy = clamp01(to_float(s.get("corroboration_raw_0_100", s.get("corroboration_0_100"))) / 100.0)
        recall_proxy = clamp01(to_float(d.get("claim_coverage_factor")))
        f2_proxy = fbeta(precision_proxy, recall_proxy, beta=2.0)

        total_w += gw
        cov_w += gw * (1.0 if corr_cal > 0.0 else 0.0)
        p_w += gw * precision_proxy
        r_w += gw * recall_proxy
        f2_w += gw * f2_proxy

    if total_w == 0.0:
        total_w = 1.0
    return {
        "claims_count": len(claims),
        "weighted_coverage_ratio": cov_w / total_w,
        "weighted_precision_proxy": p_w / total_w,
        "weighted_recall_proxy": r_w / total_w,
        "weighted_f2_proxy": f2_w / total_w,
    }


def metric_block(report_obj: dict) -> dict:
    raw = report_obj.get("raw_extraction") or {}
    s1 = raw.get("stage1_markdown_parse") or {}
    s2 = raw.get("stage2_claim_extraction") or {}
    gi = s1.get("global_indices") or {}
    enrichment = report_obj.get("enrichment") or {}
    scores = report_obj.get("scores") or {}
    v3 = scores.get("full_icj_v3") if isinstance(scores.get("full_icj_v3"), dict) else {}
    v3_doc = v3.get("document_scores") if isinstance(v3.get("document_scores"), dict) else {}

    page_count = int(s1.get("page_count") or 0)
    claim_count = safe_len(s2.get("attribution_claims"))
    source_count = safe_len(gi.get("sources"))
    artifact_count = safe_len(gi.get("artifacts"))
    table_count = safe_len(enrichment.get("tables"))
    figure_count = safe_len(enrichment.get("figures"))
    image_count = safe_len(enrichment.get("images"))

    custody = to_float(v3_doc.get("custody_avg_0_100")) / 100.0
    credibility_base = to_float(v3_doc.get("credibility_avg_0_100")) / 100.0
    corroboration = to_float(v3_doc.get("corroboration_avg_0_100")) / 100.0
    clarity = to_float(v3_doc.get("clarity_avg_0_100")) / 100.0
    credibility = (credibility_base + corroboration) / 2.0
    proxy = claim_proxy_metrics(report_obj)

    return {
        "pages": page_count,
        "images": image_count,
        "tables": table_count,
        "figures": figure_count,
        "claims": claim_count,
        "sources": source_count,
        "artifacts": artifact_count,
        "scores_0_1": {
            "chain_of_custody": custody,
            "credibility": credibility,
            "credibility_base": credibility_base,
            "corroboration": corroboration,
            "clarity": clarity,
        },
        "proxy_support_metrics": proxy,
    }


def main() -> None:
    pipeline = load_json(PIPELINE_FILES_PATH)
    files = pipeline.get("files") if isinstance(pipeline.get("files"), list) else []

    docs = []
    for item in files:
        report_path_str = item.get("reportPath")
        if not isinstance(report_path_str, str) or report_path_str.strip() == "":
            continue
        report_path = Path(report_path_str)
        if not report_path.exists():
            continue

        report_obj = load_json(report_path)
        metrics = metric_block(report_obj)

        docs.append(
            {
                "id": item.get("id"),
                "label": item.get("label"),
                "pdf_path": item.get("pdfPath"),
                "report_path": report_path_str,
                "status": item.get("lastStatus"),
                "last_run_at": item.get("lastRunAt"),
                "metrics": metrics,
            }
        )

    numeric_fields = ["pages", "images", "tables", "figures", "claims", "sources", "artifacts"]
    totals = {k: 0 for k in numeric_fields}
    for d in docs:
        m = d["metrics"]
        for k in numeric_fields:
            totals[k] += int(m.get(k) or 0)

    doc_count = len(docs)
    averages = {k: (float(totals[k]) / float(doc_count) if doc_count > 0 else 0.0) for k in numeric_fields}

    score_keys = ["chain_of_custody", "credibility", "credibility_base", "corroboration", "clarity"]
    score_means = {}
    for sk in score_keys:
        score_means[sk] = mean([to_float((d["metrics"].get("scores_0_1") or {}).get(sk)) for d in docs])

    proxy_keys = [
        "weighted_coverage_ratio",
        "weighted_precision_proxy",
        "weighted_recall_proxy",
        "weighted_f2_proxy",
    ]
    proxy_means = {}
    for pk in proxy_keys:
        proxy_means[pk] = mean([to_float((d["metrics"].get("proxy_support_metrics") or {}).get(pk)) for d in docs])

    vector_names = [
        "chain_of_custody",
        "credibility",
        "credibility_base",
        "corroboration",
        "clarity",
        "claims",
        "sources",
        "artifacts",
        "weighted_coverage_ratio",
        "weighted_precision_proxy",
        "weighted_recall_proxy",
        "weighted_f2_proxy",
    ]
    vectors = {}
    for name in vector_names:
        if name in {"chain_of_custody", "credibility", "credibility_base", "corroboration", "clarity"}:
            vectors[name] = [to_float((d["metrics"].get("scores_0_1") or {}).get(name)) for d in docs]
        elif name in {"weighted_coverage_ratio", "weighted_precision_proxy", "weighted_recall_proxy", "weighted_f2_proxy"}:
            vectors[name] = [to_float((d["metrics"].get("proxy_support_metrics") or {}).get(name)) for d in docs]
        else:
            vectors[name] = [to_float(d["metrics"].get(name)) for d in docs]

    cov_matrix = {}
    spearman_matrix = {}
    for a in vector_names:
        cov_matrix[a] = {}
        spearman_matrix[a] = {}
        for b in vector_names:
            cov_matrix[a][b] = covariance(vectors[a], vectors[b])
            spearman_matrix[a][b] = spearman_corr(vectors[a], vectors[b])

    cv_scores = {}
    for sk in score_keys:
        vals = vectors[sk]
        m = mean(vals)
        cv_scores[sk] = (sample_std(vals) / m) if m != 0.0 else 0.0

    bootstrap_ci = {
        "scores_0_1": {},
        "proxy_support_metrics": {},
    }
    for sk in score_keys:
        bootstrap_ci["scores_0_1"][sk] = bootstrap_mean_ci(vectors[sk], iterations=3000, seed=42)
    for pk in proxy_keys:
        bootstrap_ci["proxy_support_metrics"][pk] = bootstrap_mean_ci(vectors[pk], iterations=3000, seed=43)

    output = {
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": str(PIPELINE_FILES_PATH),
        "document_count": doc_count,
        "aggregated_totals": totals,
        "aggregated_averages_per_document": averages,
        "average_scores_0_1": score_means,
        "average_proxy_support_metrics": proxy_means,
        "cv_scores_0_1": cv_scores,
        "covariance_matrix": cov_matrix,
        "spearman_matrix": spearman_matrix,
        "bootstrap_95ci": bootstrap_ci,
        "documents": docs,
    }

    OUT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JSON_PATH.open("w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    lines = []
    lines.append("# Portfolio Summary")
    lines.append("")
    lines.append(f"- generated_at_utc: {output['generated_at_utc']}")
    lines.append(f"- document_count: {doc_count}")
    lines.append("")
    lines.append("## Aggregated Totals")
    for k in numeric_fields:
        lines.append(f"- {k}: {totals[k]}")
    lines.append("")
    lines.append("## Aggregated Averages Per Document")
    for k in numeric_fields:
        lines.append(f"- {k}: {averages[k]:.2f}")
    lines.append("")
    lines.append("## Average Scores (0-1)")
    for sk in score_keys:
        lines.append(f"- {sk}: {score_means[sk]:.4f}")
    lines.append("")
    lines.append("## Average Proxy Support Metrics")
    for pk in proxy_keys:
        lines.append(f"- {pk}: {proxy_means[pk]:.4f}")
    lines.append("")
    lines.append("## Coefficient of Variation (Scores 0-1)")
    for sk in score_keys:
        lines.append(f"- {sk}: {cv_scores[sk]:.4f}")
    lines.append("")
    lines.append("## Bootstrap 95% CI (means)")
    for sk in score_keys:
        ci = bootstrap_ci["scores_0_1"][sk]
        lines.append(f"- {sk}: mean={ci['mean']:.4f}, ci95=[{ci['ci95_low']:.4f}, {ci['ci95_high']:.4f}]")
    for pk in proxy_keys:
        ci = bootstrap_ci["proxy_support_metrics"][pk]
        lines.append(f"- {pk}: mean={ci['mean']:.4f}, ci95=[{ci['ci95_low']:.4f}, {ci['ci95_high']:.4f}]")
    lines.append("")
    lines.append("## Documents")
    lines.append("")
    lines.append("| label | status | pages | images | tables | figures | claims | sources | artifacts | weighted_coverage_ratio | weighted_f2_proxy |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for d in docs:
        m = d["metrics"]
        p = m.get("proxy_support_metrics") or {}
        lines.append(
            f"| {d.get('label') or d.get('id')} | {d.get('status') or 'UNKNOWN'} | "
            f"{m.get('pages', 0)} | {m.get('images', 0)} | {m.get('tables', 0)} | {m.get('figures', 0)} | "
            f"{m.get('claims', 0)} | {m.get('sources', 0)} | {m.get('artifacts', 0)} | "
            f"{to_float(p.get('weighted_coverage_ratio')):.4f} | {to_float(p.get('weighted_f2_proxy')):.4f} |"
        )

    OUT_MD_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "ok": True,
                "documents": doc_count,
                "json": str(OUT_JSON_PATH),
                "markdown": str(OUT_MD_PATH),
            }
        )
    )


if __name__ == "__main__":
    main()
