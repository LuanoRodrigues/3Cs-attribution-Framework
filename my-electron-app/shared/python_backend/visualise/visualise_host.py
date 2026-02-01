#!/usr/bin/env python3
"""
Visualise host for Electron.
Actions:
  - sections: return schema + section list
  - preview: run selected analyses on a DataFrame table and return slide payload
"""
from __future__ import annotations

import json
import math
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List

BASE_DIR = Path(__file__).resolve().parent
PY_BACKEND_DIR = BASE_DIR.parent
SHARED_DIR = PY_BACKEND_DIR.parent
REPO_ROOT = next((parent for parent in BASE_DIR.parents if (parent / "package.json").is_file()), BASE_DIR.parents[-1])
for entry in (SHARED_DIR, BASE_DIR, REPO_ROOT):
    entry_str = str(entry)
    if entry_str not in sys.path:
        sys.path.insert(0, entry_str)


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
    return REPO_ROOT


def _load_visual_helpers() -> tuple[Any | None, list[str]]:
    try:
        import importlib

        module = importlib.import_module("python_backend.visualise.visual_helpers")
        return importlib.reload(module), []
    except Exception:
        return None, ["[visualise][load][error] failed to import visual_helpers", traceback.format_exc()]


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


def _flatten_slides(payload: Any, *, section: str) -> list[dict]:
    if isinstance(payload, dict) and isinstance(payload.get("slides"), list):
        out: list[dict] = []
        for s in payload.get("slides"):
            if not isinstance(s, dict):
                continue
            slide = _normalize_slide(s)
            if section and "section" not in slide:
                slide["section"] = section
            out.append(slide)
        return out
    return []


def _run_preview(df, params: dict, include: list[str], collection_name: str, *, mode: str = "") -> tuple[dict, list[str]]:
    visual, load_logs = _load_visual_helpers()
    logs: list[str] = []
    logs.extend(load_logs)
    if visual is None:
        return (
            {
                "slides": [
                    {
                        "title": "Visualise",
                        "bullets": ["Visualise backend failed to load. See logs."],
                        "notes": "",
                    }
                ],
                "index": 0,
            },
            logs,
        )

    from pptx import Presentation

    prs = Presentation()
    slide_notes = str(params.get("slide_notes", "false")).strip().lower() in {"1", "true", "yes", "y", "on"}
    is_build = "build" in str(mode or "").lower()
    if is_build:
        try:
            from python_backend.visualise.power_point_export import ppt_ui_warmup

            warm = ppt_ui_warmup()
            logs.append(
                "[visualise][ppt_ui_warmup] "
                + _safe_json(
                    {
                        "res_dir": warm.get("res_dir"),
                        "template_len": warm.get("template_len"),
                        "plotly_js_len": warm.get("plotly_js_len"),
                        "qweb_js_len": warm.get("qweb_js_len"),
                    }
                )
            )
        except Exception as exc:
            logs.append(f"[visualise][ppt_ui_warmup][error] {exc}")
            logs.append(traceback.format_exc())

    slides: list[dict] = []

    def _error_slide(section_id: str, exc: Exception) -> dict:
        return _normalize_slide(
            {
                "title": f"{section_id.replace('_', ' ')} — Error",
                "bullets": [str(exc)],
                "notes": "",
                "section": section_id,
            }
        )

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
                slides.extend(_flatten_slides(payload, section=sec))
                logs.append(f"[visualise][section][ok] Data_summary")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Data_summary: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
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
                slides.extend(_flatten_slides(payload, section=sec))
                logs.append(f"[visualise][section][ok] Scope_and_shape")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Scope_and_shape: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
        elif sec == "Authors_overview":
            try:
                payload = visual.authors_overview(
                    prs, df, collection_name=collection_name, slide_notes=slide_notes, return_payload=True, export=False
                )
                slides.extend(_flatten_slides(payload, section=sec))
                logs.append(f"[visualise][section][ok] Authors_overview")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Authors_overview: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
        elif sec == "Citations_overview":
            try:
                p = dict(defaults["citations"], **(params or {}))
                payload = visual.analyze_citations_overview_plotly(df, p, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload, section=sec))
                logs.append(f"[visualise][section][ok] Citations_overview")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Citations_overview: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
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
                slides.extend(_flatten_slides(payload, section=sec))
                logs.append(f"[visualise][section][ok] Words_and_topics")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Words_and_topics: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
        elif sec == "Affiliations_geo":
            try:
                p = dict(defaults["affiliations"], **(params or {}))
                payload = visual.analyze_affiliations(df, p, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload, section=sec))
                logs.append(f"[visualise][section][ok] Affiliations_geo")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Affiliations_geo: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
        elif sec == "Temporal_analysis":
            try:
                p = dict(defaults["temporal"], **(params or {}))
                payload = visual.analyze_temporal_analysis(
                    df,
                    p,
                    _cb,
                    return_payload=True,
                    export=False,
                    collection_name=collection_name,
                )
                slides.extend(_flatten_slides(payload, section=sec))
                logs.append(f"[visualise][section][ok] Temporal_analysis")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Temporal_analysis: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
        elif sec == "Research_design":
            try:
                payload = visual.analyze_research_design_suite(df, params or {}, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload, section=sec))
                logs.append(f"[visualise][section][ok] Research_design")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Research_design: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
        elif sec == "Profiles":
            try:
                payload = visual.analyze_feature_profile(df, params or {}, _cb, return_payload=True, export=False)
                slides.extend(_flatten_slides(payload, section=sec))
                logs.append(f"[visualise][section][ok] Profiles")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Profiles: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
        elif sec == "Categorical_keywords":
            try:
                results_df, fig = visual.analyze_categorical_keywords(df, params or {}, _cb)
                table_html = "<div>No data available.</div>"
                try:
                    if getattr(results_df, "empty", True):
                        table_html = "<div>No data available.</div>"
                    else:
                        table_html = results_df.head(50).to_html(index=False, escape=True)
                except Exception:
                    table_html = "<div>Unable to render table.</div>"

                fig_json = None
                if fig is not None:
                    try:
                        import json as _json
                        from plotly.utils import PlotlyJSONEncoder

                        fig_json = _json.loads(_json.dumps(fig.to_plotly_json(), cls=PlotlyJSONEncoder))
                    except Exception as exc2:
                        logs.append(f"[visualise][section][warn] Categorical_keywords fig_json failed: {exc2}")

                slides.append(
                    _normalize_slide(
                        {
                            "title": "Categorical keywords",
                            "table_html": table_html,
                            "fig_json": fig_json,
                            "section": sec,
                            "notes": "",
                        }
                    )
                )
                logs.append(f"[visualise][section][ok] Categorical_keywords")
            except Exception as exc:
                logs.append(f"[visualise][section][error] Categorical_keywords: {exc}")
                logs.append(traceback.format_exc())
                slides.append(_error_slide(sec, exc))
        else:
            slides.append({"title": sec.replace("_", " "), "bullets": ["No handler for section."], "notes": "", "section": sec})
            logs.append(f"[visualise][section][warn] No handler for {sec}")

    if is_build:
        try:
            from python_backend.visualise.power_point_export import _print_ui_debug_dump

            def _fig_shape(fig_json: Any) -> str:
                if fig_json is None:
                    return "none"
                if isinstance(fig_json, dict):
                    ok = isinstance(fig_json.get("data"), list) and isinstance(fig_json.get("layout"), dict)
                    return "dict_ok" if ok else "dict_bad"
                if isinstance(fig_json, str):
                    return "string"
                return "other"

            dbg_slides: list[dict] = []
            for i, s in enumerate(slides):
                if not isinstance(s, dict):
                    continue
                fig_json = s.get("fig_json")
                fig_shape = _fig_shape(fig_json)
                dbg_slides.append(
                    {
                        "i": int(i),
                        "title": str(s.get("title") or "")[:120],
                        "keys": sorted(list(s.keys())),
                        "has_fig": bool(fig_json),
                        "has_img": bool(str(s.get("img") or "").strip()),
                        "has_table": bool(str(s.get("table_html") or "").strip()),
                        "has_text": bool(str(s.get("notes") or "").strip()),
                        "fig_shape": fig_shape,
                    }
                )

            _print_ui_debug_dump(
                {
                    "slides": dbg_slides,
                    "slides_len": len(dbg_slides),
                    "index": 0,
                    "title": str((slides[0] or {}).get("title") if slides else "Visualise"),
                }
            )
        except Exception as exc:
            logs.append(f"[visualise][ui_debug_dump][error] {exc}")
            logs.append(traceback.format_exc())

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
        mode = str(payload.get("mode") or "")
        df = _coerce_table(table)
        deck, logs = _run_preview(
            df,
            params,
            [str(s) for s in include if str(s).strip()],
            collection_name,
            mode=mode,
        )
        print(_safe_json({"status": "ok", "deck": deck, "logs": logs}))
        return

    print(_safe_json({"status": "error", "message": f"unknown_action:{action}"}))


if __name__ == "__main__":
    main()
