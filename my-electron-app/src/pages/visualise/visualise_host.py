#!/usr/bin/env python3
"""
Visualise host for Electron.
Actions:
  - sections: return schema + section list
  - preview: run selected analyses on a DataFrame table and return slide payload
"""
from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List


def _safe_json(obj: Any) -> str:
    def _clean(v: Any) -> Any:
        try:
            if hasattr(v, "item") and not isinstance(v, (bytes, str)):
                v = v.item()
        except Exception:
            pass
        if v is None or isinstance(v, (str, bool, int)):
            return v
        if isinstance(v, float):
            return v if math.isfinite(v) else None
        if isinstance(v, dict):
            return {str(k): _clean(vv) for k, vv in v.items()}
        if isinstance(v, (list, tuple, set)):
            return [_clean(x) for x in v]
        return str(v)

    cleaned = _clean(obj)
    return json.dumps(cleaned, ensure_ascii=True, allow_nan=False)


def _read_payload() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"action": "error", "message": f"invalid_json:{exc}"}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _load_visual_helpers():
    repo_root = _repo_root()
    candidate = repo_root / "src" / "pages" / "visualise" / "visual_helpers.py"
    if not candidate.exists():
        return None
    spec = importlib.util.spec_from_file_location("visual_helpers", str(candidate))
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


def _coerce_table(table: Dict[str, Any]):
    import pandas as pd

    cols = table.get("columns") if isinstance(table, dict) else None
    rows = table.get("rows") if isinstance(table, dict) else None
    if not isinstance(cols, list) or not isinstance(rows, list):
        return pd.DataFrame()
    return pd.DataFrame(rows, columns=[str(c) for c in cols])


def _schema_and_sections() -> dict:
    schema = [
        {"type": "number", "key": "top_n_authors", "label": "Top N authors", "default": 15, "min": 5, "max": 100},
        {"type": "number", "key": "production_top_n", "label": "Production top N", "default": 10, "min": 3, "max": 50},
        {"type": "number", "key": "top_ngram", "label": "Top n-gram", "default": 20, "min": 5, "max": 200},
        {
            "type": "select",
            "key": "slide_notes",
            "label": "slide_notes",
            "default": "false",
            "options": [{"label": "false", "value": "false"}, {"label": "true", "value": "true"}],
        },
    ]
    sections = [
        {"id": "Data_summary", "label": "Data summary", "hint": "Summary cards and key totals."},
        {"id": "Scope_and_shape", "label": "Scope and shape", "hint": "Volume, years, document types."},
        {"id": "Authors_overview", "label": "Authors overview", "hint": "Top authors and collaboration."},
        {"id": "Citations_overview", "label": "Citations overview", "hint": "Citation distribution and leaders."},
        {"id": "Words_and_topics", "label": "Words and topics", "hint": "Keywords, n-grams, topic signals."},
        {"id": "Affiliations_geo", "label": "Affiliations (geo)", "hint": "Institutions and geography."},
        {"id": "Temporal_analysis", "label": "Temporal analysis", "hint": "Trends over time."},
        {"id": "Research_design", "label": "Research design", "hint": "Design outputs and mix."},
        {"id": "Profiles", "label": "Profiles", "hint": "Feature profiles and summaries."},
        {"id": "Categorical_keywords", "label": "Categorical keywords", "hint": "Categorical keyword outputs."},
    ]
    return {"schema": schema, "sections": sections}


def _normalize_slide(slide: dict) -> dict:
    out = dict(slide)
    fig_json = out.get("fig_json")
    if isinstance(fig_json, str):
        s = fig_json.strip()
        if s.startswith("{") or s.startswith("["):
            try:
                out["fig_json"] = json.loads(s)
            except json.JSONDecodeError:
                out["fig_json"] = None
    return out


def _flatten_slides(payload: Any) -> list[dict]:
    if isinstance(payload, dict) and isinstance(payload.get("slides"), list):
        return [ _normalize_slide(s) for s in payload.get("slides") if isinstance(s, dict) ]
    return []


def _run_preview(df, params: dict, include: list[str], collection_name: str) -> tuple[dict, list[str]]:
    visual = _load_visual_helpers()
    if visual is None:
        return {"slides": [{"title": "Visualise", "bullets": ["visual_helpers.py not found"], "notes": ""}], "index": 0}, [
            "visual_helpers.py not found"
        ]

    from pptx import Presentation

    prs = Presentation()
    slide_notes = str(params.get("slide_notes", "false")).strip().lower() in {"1", "true", "yes", "y", "on"}

    slides: list[dict] = []
    logs: list[str] = []

    def _cb(_msg: str):
        return None

    defaults = {
        "word": {"plot_type": "bar_vertical", "data_source": "controlled_vocabulary_terms"},
        "affiliations": {"plot_type": "world_map_pubs", "top_n": 30},
        "temporal": {"plot_type": "multi_line_trend"},
        "citations": {"plot_type": "top_cited_bar"},
    }

    if not include:
        include = [s["id"] for s in _schema_and_sections().get("sections", []) if isinstance(s, dict) and s.get("id")]

    for sec in include:
        logs.append(f"[visualise][section][start] {sec}")
        if sec == "Data_summary":
            try:
                payload = visual.add_data_summary_slides(
                    prs, df, collection_name=collection_name, slide_notes=slide_notes, return_payload=True, export=False
                )
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Data_summary")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Data_summary: {exc}")
        elif sec == "Scope_and_shape":
            try:
                payload = visual.shape_scope(
                    prs,
                    df,
                    collection_name=collection_name,
                    slide_notes=slide_notes,
                    return_payload=True,
                    export=False,
                    progress_callback=_cb,
                )
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Scope_and_shape")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Scope_and_shape: {exc}")
        elif sec == "Authors_overview":
            try:
                payload = visual.authors_overview(
                    prs, df, collection_name=collection_name, slide_notes=slide_notes, return_payload=True, export=False
                )
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Authors_overview")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Authors_overview: {exc}")
        elif sec == "Citations_overview":
            try:
                p = dict(defaults["citations"], **(params or {}))
                payload = visual.analyze_citations_overview_plotly(df, p, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Citations_overview")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Citations_overview: {exc}")
        elif sec == "Words_and_topics":
            try:
                p = dict(defaults["word"], **(params or {}))
                payload = visual.analyze_wordanalysis_dispatcher(
                    df,
                    p,
                    _cb,
                    slide_notes=slide_notes,
                    return_payload=True,
                    export=False,
                    zotero_client_for_pdf=None,
                    collection_name_for_cache=collection_name,
                )
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Words_and_topics")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Words_and_topics: {exc}")
        elif sec == "Affiliations_geo":
            try:
                p = dict(defaults["affiliations"], **(params or {}))
                payload = visual.analyze_affiliations(df, p, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Affiliations_geo")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Affiliations_geo: {exc}")
        elif sec == "Temporal_analysis":
            try:
                p = dict(defaults["temporal"], **(params or {}))
                payload = visual.analyze_temporal_analysis(df, p, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Temporal_analysis")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Temporal_analysis: {exc}")
        elif sec == "Research_design":
            try:
                payload = visual.analyze_research_design_suite(df, params or {}, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Research_design")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Research_design: {exc}")
        elif sec == "Profiles":
            try:
                payload = visual.analyze_feature_profile(df, params or {}, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Profiles")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Profiles: {exc}")
        elif sec == "Categorical_keywords":
            try:
                payload = visual.analyze_categorical_keywords(df, params or {}, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload))
                logs.append(f"[visualise][section][ok] Categorical_keywords")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Categorical_keywords: {exc}")
        else:
            slides.append({"title": sec.replace("_", " "), "bullets": ["No handler for section."], "notes": ""})
            logs.append(f"[visualise][section][warn] No handler for {sec}")

    if not slides:
        slides = [{"title": "Visualise", "bullets": ["No slides produced."], "notes": ""}]

    return {"slides": slides, "index": 0}, logs


def main() -> None:
    payload = _read_payload()
    action = str(payload.get("action") or "")
    if action == "sections":
        print(_safe_json({"status": "ok", **_schema_and_sections()}))
        return

    if action == "preview":
        table = payload.get("table") or {}
        params = payload.get("params") or {}
        include = payload.get("include") or []
        collection_name = str(payload.get("collectionName") or "Collection")
        df = _coerce_table(table)
        deck, logs = _run_preview(df, params, [str(s) for s in include if str(s).strip()], collection_name)
        print(_safe_json({"status": "ok", "deck": deck, "logs": logs}))
        return

    print(_safe_json({"status": "error", "message": f"unknown_action:{action}"}))


if __name__ == "__main__":
    main()
