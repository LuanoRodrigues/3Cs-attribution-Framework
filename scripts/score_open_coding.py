#!/usr/bin/env python3
"""Score coded document outputs from open_coding runs.

Usage:
  python3 scripts/score_open_coding.py --input logs/open_coding_runs/<run>.json --item J766INPV
  python3 scripts/score_open_coding.py --input ... --item all
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import mean


def _to_float(value) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def _coerce_str(value) -> str:
    return str(value or "").strip()


def _is_valid_score(value) -> bool:
    return isinstance(value, (int, float)) and 1 <= value <= 5


def _evidence_points(entry) -> list[dict]:
    if isinstance(entry, list):
        points: list[dict] = []
        for item in entry:
            points.extend(_evidence_points(item))
        return points

    if not isinstance(entry, dict):
        return []

    # Newer payload: section payloads wrapped as {"section_key": "...", "evidence": [...]}
    # Older payloads / model outputs: direct point dictionaries.
    ev = entry.get("evidence")
    if isinstance(ev, list):
        return [e for e in ev if isinstance(e, dict)]

    # Heuristic: treat as point when it has known point fields.
    if (
        "dqid" in entry
        or "quote" in entry
        or "extraction_category" in entry
        or "section_key" in entry
    ):
        return [entry]
    return []


def score_open_coding_payload(item_key: str, payload: dict) -> dict:
    code_sections = payload.get("code_pdf_page")
    if not isinstance(code_sections, list):
        code_sections = []

    harvest_sections = payload.get("code_intro_conclusion_extract_core_claims")
    if not isinstance(harvest_sections, list):
        harvest_sections = []
    elif len(harvest_sections) == 0:
        fallback_harvest = payload.get("evidence_harvesting")
        harvest_sections = fallback_harvest if isinstance(fallback_harvest, list) else []

    open_points = []
    for sec in code_sections:
        open_points.extend(_evidence_points(sec))

    if not open_points and not code_sections and isinstance(payload.get("evidence_list"), list):
        open_points = _evidence_points(payload.get("evidence_list"))

    harvest_points = []
    for sec in harvest_sections:
        harvest_points.extend(_evidence_points(sec))

    if not harvest_points and not harvest_sections:
        fallback_harvest = payload.get("evidence_harvesting")
        if isinstance(fallback_harvest, list):
            harvest_points.extend(_evidence_points(fallback_harvest))

    all_points = list(open_points) + list(harvest_points)
    section_keys = []
    for sec in code_sections:
        if isinstance(sec, dict):
            if isinstance(sec.get("evidence"), list):
                section_keys.append(sec.get("section_key"))
    section_keys.extend(
        [p.get("section_key") for p in open_points if isinstance(p, dict)]
    )
    section_keys = [k for k in section_keys if _coerce_str(k)]
    section_coverage = len(set(section_keys))
    harvest_categories = [
        p.get("extraction_category", "")
        for p in harvest_points
        if isinstance(p, dict)
    ]

    required_harvest = [
        "definitions",
        "main_findings",
        "method_claims",
        "stated_limitations",
        "recommendations_future_work",
    ]

    required_hit = {c for c in required_harvest if c in set(harvest_categories)}

    # Section-level openness: 10 points per coded section, capped at 30.
    score_sections = min(section_coverage * 10, 30)

    # Intro/conclusion category coverage: 4 points per required category, up to 20.
    score_harvest_categories = len(required_hit) * 4

    # Evidence_type diversity: 7 buckets max => 15 points
    evidence_types = {
        _coerce_str(p.get("evidence_type")).lower()
        for p in all_points
        if _coerce_str(p.get("evidence_type")).strip()
    }
    score_diversity = min(len(evidence_types), 7) / 7 * 15

    # Relevance score quality: average of valid relevance scores, mapped to 15.
    rel_vals = [_to_float(p.get("relevance_score")) for p in all_points]
    rel_vals = [v for v in rel_vals if v is not None and _is_valid_score(v)]
    score_relevance = (mean(rel_vals) / 5 * 15) if rel_vals else 0.0

    # Required field completeness for points: up to 15.
    required_fields = [
        "quote",
        "paraphrase",
        "researcher_comment",
        "evidence_type",
        "argument_type",
        "claim_direction",
        "dqid",
        "relevance_score",
    ]
    if all_points:
        completeness = 0
        for p in all_points:
            item_score = 0
            for f in required_fields:
                v = p.get(f)
                if f == "relevance_score":
                    rv = _to_float(v)
                    if rv is not None and _is_valid_score(rv):
                        item_score += 1
                else:
                    if _coerce_str(v):
                        item_score += 1
            completeness += item_score / len(required_fields)
        score_completeness = min(completeness / len(all_points), 1.0) * 15
    else:
        score_completeness = 0.0

    # Evidence volume: points count (open + harvest), capped at 10.
    score_volume = min(len(all_points), 10)

    total_score = (
        score_sections
        + score_harvest_categories
        + score_diversity
        + score_relevance
        + score_completeness
        + score_volume
    )
    total_score = round(total_score, 2)

    warnings: list[str] = []
    if section_coverage == 0:
        warnings.append("No sections coded.")
    if len(required_hit) < len(required_harvest):
        missing = sorted(set(required_harvest) - required_hit)
        warnings.append(f"Missing intro/conclusion categories: {', '.join(missing)}")
    if len(all_points) < 5:
        warnings.append("Low evidence volume.")
    if not all(_is_valid_score(_to_float(p.get("relevance_score")) or 0) for p in all_points if isinstance(p, dict)):
        warnings.append("Some points are missing/invalid relevance_score.")

    return {
        "item_key": item_key,
        "metadata": {
            "item_key": payload.get("metadata", {}).get("item_key", item_key),
            "title": payload.get("metadata", {}).get("title", ""),
            "authors": payload.get("metadata", {}).get("authors", []),
            "year": payload.get("metadata", {}).get("year", ""),
            "collection": payload.get("metadata", {}).get("collection", ""),
            "pdf_path": payload.get("metadata", {}).get("pdf_path", ""),
            "prompt_key": payload.get("metadata", {}).get("prompt_key", ""),
            "intro_conclusion_prompt_key": payload.get("metadata", {}).get("intro_conclusion_prompt_key", ""),
            "overarching_theme": payload.get("metadata", {}).get("overarching_theme", ""),
        },
        "score_100": round(total_score, 2),
        "components": {
            "section_coverage_score": round(score_sections, 2),
            "harvest_categories_score": round(score_harvest_categories, 2),
            "diversity_score": round(score_diversity, 2),
            "relevance_score": round(score_relevance, 2),
            "completeness_score": round(score_completeness, 2),
            "volume_score": round(score_volume, 2),
        },
        "meta": {
            "sections_coded": section_coverage,
            "open_points": len(open_points),
            "harvest_points": len(harvest_points),
            "total_points": len(all_points),
            "harvest_required_categories_present": sorted(required_hit),
            "missing_harvest_categories": sorted(set(required_harvest) - required_hit),
            "evidence_type_count": len(evidence_types),
            "avg_relevance_score": round(mean(rel_vals), 2) if rel_vals else None,
        },
        "warnings": warnings,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Score coded output from coding pipeline runs")
    ap.add_argument("--input", required=True, help="Path to open_coding run JSON")
    ap.add_argument("--item", default="all", help="Item key to score, or 'all' for all items in run")
    ap.add_argument("--out", default="", help="Optional output JSON path")
    args = ap.parse_args()

    inp = Path(args.input)
    if not inp.exists():
        print(f"Input not found: {inp}")
        return 2

    payload = json.loads(inp.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        print("Input payload must be a dict keyed by item_key.")
        return 2

    scores = []
    if args.item.lower() == "all":
        items = payload.items()
    else:
        if args.item not in payload:
            print(f"Item not found in run: {args.item}")
            return 2
        items = [(args.item, payload[args.item])]

    for item_key, item_payload in items:
        if not isinstance(item_payload, dict):
            continue
        scores.append(score_open_coding_payload(item_key=item_key, payload=item_payload))

    if not scores:
        print("No scoreable items found.")
        return 1

    out = {
        "input": str(inp),
        "scores": scores,
    }
    out["overall_summary"] = {
        "items_scored": len(scores),
        "avg_score_100": round(sum(s["score_100"] for s in scores) / len(scores), 2),
    }

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote {out_path}")

    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
