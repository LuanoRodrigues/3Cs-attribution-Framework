from __future__ import annotations

import argparse
import json
import os
import re
import sys
import hashlib
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from Research.systematic_review_pipeline import (
    _assert_non_placeholder_html,
    _assert_reference_and_postprocess_integrity,
    _build_dqid_evidence_payload,
    _build_reference_items,
    _citation_style_instruction,
    _clean_and_humanize_section_html,
    _clean_llm_html,
    _compute_theme_counts,
    _enrich_dqid_anchors,
    _extract_llm_text,
    _humanize_theme_tokens,
    _load_call_models_zt,
    _load_json,
    _load_section_cache,
    _make_cache_entry,
    _normalize_citation_style,
    _repo_root,
    _resolve_collection_label,
    _safe_name,
    _stable_section_custom_id,
    _svg_bar_chart,
    _validate_generated_section,
    _write_section_cache,
)


def _extract_year(value: Any) -> int | None:
    s = str(value or "").strip()
    if not s:
        return None
    m = re.search(r"(19|20)\d{2}", s)
    if not m:
        return None
    try:
        return int(m.group(0))
    except Exception:
        return None


def _load_items(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    npath = Path(str(out.get("normalized_results_path") or "")).expanduser()
    if not npath.is_file():
        raise RuntimeError("Missing normalized_results_path for chronological pipeline.")
    raw = json.loads(npath.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError("No normalized results for chronological pipeline.")
    return raw


def _build_item_records(items: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item_key, payload in items.items():
        md = payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {}
        zot = md.get("zotero_metadata", {}) if isinstance(md.get("zotero_metadata"), dict) else {}
        year = _extract_year(md.get("year")) or _extract_year(zot.get("date"))
        rows.append(
            {
                "item_key": item_key,
                "title": str(md.get("title") or "Untitled").strip(),
                "year": year,
                "first_author_last": str(md.get("first_author_last") or "Unknown").strip(),
            }
        )
    return rows


def _derive_periods(years: list[int]) -> list[tuple[str, tuple[int, int]]]:
    ys = sorted({y for y in years if isinstance(y, int)})
    if not ys:
        return [("Undated corpus", (0, 0))]
    mn, mx = ys[0], ys[-1]
    if len(ys) <= 4:
        return [(str(y), (y, y)) for y in ys]
    span = max(1, mx - mn + 1)
    width = max(1, span // 3)
    bounds = [
        (mn, min(mx, mn + width - 1)),
        (min(mx, mn + width), min(mx, mn + (2 * width) - 1)),
        (min(mx, mn + (2 * width)), mx),
    ]
    labels = ["Period I", "Period II", "Period III"]
    return [(f"{labels[i]} ({a}-{b})", (a, b)) for i, (a, b) in enumerate(bounds)]


def _period_for_year(year: int | None, periods: list[tuple[str, tuple[int, int]]]) -> str:
    if year is None:
        return "Undated corpus"
    for label, (a, b) in periods:
        if a <= year <= b:
            return label
    return periods[-1][0] if periods else "Undated corpus"


def _collect_evidence_by_period(
    items: dict[str, dict[str, Any]],
    item_records: list[dict[str, Any]],
    periods: list[tuple[str, tuple[int, int]]],
) -> dict[str, list[dict[str, Any]]]:
    year_by_item = {r["item_key"]: r["year"] for r in item_records}
    by_period: dict[str, list[dict[str, Any]]] = defaultdict(list)
    seen: set[str] = set()
    for item_key, payload in items.items():
        label = _period_for_year(year_by_item.get(item_key), periods)
        for arr_key in ("code_pdf_page", "code_intro_conclusion_extract_core_claims", "evidence_list", "section_open_coding"):
            arr = payload.get(arr_key)
            if not isinstance(arr, list):
                continue
            for row in arr:
                if not isinstance(row, dict):
                    continue
                cands = row.get("evidence") if isinstance(row.get("evidence"), list) else [row]
                for ev in cands:
                    if not isinstance(ev, dict):
                        continue
                    quote = str(ev.get("quote") or "").strip()
                    if not quote:
                        continue
                    dqid = str(ev.get("dqid") or "").strip() or f"{item_key}#AUTO{len(by_period[label])+1:04d}"
                    k = f"{dqid}|{quote[:80]}"
                    if k in seen:
                        continue
                    seen.add(k)
                    by_period[label].append(
                        {
                            "dqid": dqid,
                            "quote": quote[:500],
                            "theme": str((ev.get("potential_themes") or [""])[0] if isinstance(ev.get("potential_themes"), list) else ev.get("evidence_type") or "uncategorized"),
                            "item_key": item_key,
                        }
                    )
    return by_period


def _timeline_table_html(item_records: list[dict[str, Any]]) -> str:
    rows = sorted([r for r in item_records if r.get("year") is not None], key=lambda x: (x["year"], x["first_author_last"], x["title"]))[:120]
    if not rows:
        return ""
    out = [
        "<table class='data-table'>",
        "<thead><tr><th>Year</th><th>Author</th><th>Title</th></tr></thead><tbody>",
    ]
    for r in rows:
        out.append(f"<tr><td>{r['year']}</td><td>{r['first_author_last']}</td><td>{r['title']}</td></tr>")
    out.append("</tbody></table>")
    return "\n".join(out)


def _period_definitions_html(periods: list[tuple[str, tuple[int, int]]], period_counter: Counter[str]) -> str:
    lines = ["<ul>"]
    for label, (a, b) in periods:
        lines.append(f"<li><strong>{label}</strong>: years {a}-{b}; items={int(period_counter.get(label, 0))}</li>")
    lines.append("</ul>")
    return "\n".join(lines)


def _period_summary_table_html(periods: list[tuple[str, tuple[int, int]]], by_period: dict[str, list[dict[str, Any]]]) -> str:
    rows = ["<table class='data-table'>", "<thead><tr><th>Period</th><th>Years</th><th>Evidence units</th><th>Top theme</th></tr></thead><tbody>"]
    for label, (a, b) in periods:
        evs = by_period.get(label, [])
        cnt = Counter(str(r.get("theme") or "uncategorized") for r in evs)
        top_theme = _humanize_theme_tokens(cnt.most_common(1)[0][0]) if cnt else "N/A"
        rows.append(f"<tr><td>{label}</td><td>{a}-{b}</td><td>{len(evs)}</td><td>{top_theme}</td></tr>")
    rows.append("</tbody></table>")
    return "\n".join(rows)


def _theme_shift_svg(by_period: dict[str, list[dict[str, Any]]], output_dir: Path) -> str:
    labels: list[str] = []
    values: list[int] = []
    for period_label, rows in by_period.items():
        c = Counter(str(r.get("theme") or "uncategorized") for r in rows)
        top_theme, top_count = (c.most_common(1)[0] if c else ("uncategorized", 0))
        labels.append(f"{period_label}: {_humanize_theme_tokens(top_theme)}")
        values.append(int(top_count))
    svg = _svg_bar_chart("Dominant coded theme count by period", labels or ["No data"], values or [0], width=960, height=520)
    out = output_dir / "theme_shift_by_period.svg"
    out.write_text(svg, encoding="utf-8")
    return out.name


def _validate_context_required(context: dict[str, Any], required: list[str]) -> None:
    missing = [k for k in required if k not in context]
    if missing:
        raise RuntimeError(f"Chronological template context missing required keys: {missing}")


def _run_grouped_batch_sections(
    *,
    collection_name: str,
    model: str,
    function_name: str,
    section_prompts: list[tuple[str, str]],
) -> dict[str, Any]:
    if not section_prompts:
        raise RuntimeError("Grouped batch called with empty section_prompts")
    if not os.getenv("BATCH_ROOT"):
        os.environ["BATCH_ROOT"] = str((_repo_root() / "tmp").resolve())
    call_models_zt = _load_call_models_zt()
    llms_dir = _repo_root() / "python_backend_legacy" / "llms"
    if str(llms_dir) not in sys.path:
        sys.path.insert(0, str(llms_dir))
    import calling_models as cm  # type: ignore

    safe_collection = cm.safe_name(collection_name) if hasattr(cm, "safe_name") else _safe_name(collection_name)
    safe_function = cm.safe_name(function_name) if hasattr(cm, "safe_name") else _safe_name(function_name)
    batch_root = cm.get_batch_root() if hasattr(cm, "get_batch_root") else (_repo_root() / "tmp" / "batching_files" / "batches")
    func_dir = Path(batch_root) / safe_function
    func_dir.mkdir(parents=True, exist_ok=True)
    input_file = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
    output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
    meta_file = func_dir / f"{safe_collection}_{safe_function}_batch_metadata.json"
    sig_file = func_dir / f"{safe_collection}_{safe_function}_request_signature.json"

    expected_jobs: list[tuple[str, str, str]] = []
    seen_custom_ids: set[str] = set()
    for section_name, prompt in section_prompts:
        custom_id = _stable_section_custom_id(collection_name, section_name, prompt)
        if custom_id in seen_custom_ids:
            raise RuntimeError(f"Duplicate custom_id in grouped batch: {custom_id}")
        seen_custom_ids.add(custom_id)
        expected_jobs.append((section_name, prompt, custom_id))

    sig_payload = {"custom_ids": [cid for _, _, cid in expected_jobs]}
    sig_hash = hashlib.sha256(json.dumps(sig_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    reuse_existing = False
    if input_file.exists() and meta_file.exists() and sig_file.exists():
        try:
            old_sig = json.loads(sig_file.read_text(encoding="utf-8"))
            if str(old_sig.get("signature") or "") == sig_hash:
                reuse_existing = True
        except Exception:
            reuse_existing = False
    if not reuse_existing:
        for fp in (input_file, output_file, meta_file, sig_file):
            if fp.exists():
                fp.unlink()
        sig_file.write_text(json.dumps({"signature": sig_hash, **sig_payload}, ensure_ascii=False, indent=2), encoding="utf-8")

    pending: list[tuple[str, str]] = []
    for section_name, prompt, custom_id in expected_jobs:
        pending.append((section_name, custom_id))
        if reuse_existing:
            continue
        _ = call_models_zt(
            text=prompt,
            function=function_name,
            custom_id=custom_id,
            collection_name=collection_name,
            model=model,
            ai="openai",
            read=False,
            store_only=True,
            cache=False,
        )

    ok = cm._process_batch_for(analysis_key_suffix=function_name, section_title=safe_collection, poll_interval=30)
    if ok is not True:
        raise RuntimeError(f"Grouped batch failed for collection={collection_name}, function={function_name}")

    if not meta_file.is_file():
        raise RuntimeError(f"Missing batch metadata file after processing: {meta_file}")
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    batch_id = str(meta.get("batch_id") or "").strip()
    if not batch_id:
        raise RuntimeError(f"Batch metadata missing batch_id: {meta_file}")

    out: dict[str, str] = {}
    for section_name, custom_id in pending:
        response = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
        text_out = _extract_llm_text(response)
        if not str(text_out).strip():
            raise RuntimeError(f"Empty batch output for section '{section_name}' custom_id='{custom_id}'")
        out[section_name] = text_out

    if len(out) != len(section_prompts):
        raise RuntimeError(f"Batch output count mismatch: expected={len(section_prompts)} got={len(out)}")

    return {
        "outputs": out,
        "batch_id": batch_id,
        "request_count": len(section_prompts),
        "input_file": str(input_file),
        "output_file": str(output_file),
        "meta_file": str(meta_file),
    }


def render_chronological_review_from_summary(
    *,
    summary: dict[str, Any],
    template_path: Path,
    outputs_root: Path,
    model: str = "gpt-5-mini",
    citation_style: str = "apa",
) -> dict[str, str]:
    raw_collection_name = str(summary.get("collection_name") or "").strip()
    if not raw_collection_name:
        raise ValueError("summary.collection_name is required")

    collection_name = _resolve_collection_label(raw_collection_name)
    output_dir = outputs_root / _safe_name(collection_name) / "CLR"
    output_dir.mkdir(parents=True, exist_ok=True)

    section_cache_path = output_dir / "section_generation_cache.json"
    section_cache_entries, section_cache, cache_dirty = _load_section_cache(section_cache_path)
    if cache_dirty:
        _write_section_cache(section_cache_path, section_cache_entries)

    citation_style = _normalize_citation_style(citation_style)
    items = _load_items(summary)
    item_records = _build_item_records(items)
    years = [r["year"] for r in item_records if isinstance(r.get("year"), int)]
    periods = _derive_periods(years)
    by_period = _collect_evidence_by_period(items, item_records, periods)
    theme_counts = _compute_theme_counts(summary)
    dq_payload, dqid_lookup = _build_dqid_evidence_payload(summary, max_rows=320)

    year_counter = Counter(r["year"] for r in item_records if isinstance(r.get("year"), int))
    year_labels = [str(y) for y, _ in sorted(year_counter.items())]
    year_values = [int(v) for _, v in sorted(year_counter.items())]
    timeline_svg = _svg_bar_chart("Publication output over time", year_labels or ["No data"], year_values or [0], width=980, height=520)
    timeline_path = output_dir / "timeline_figure.svg"
    timeline_path.write_text(timeline_svg, encoding="utf-8")

    period_counter = Counter(_period_for_year(r.get("year"), periods) for r in item_records)
    period_svg = _svg_bar_chart(
        "Publication volume by period",
        list(period_counter.keys()) or ["No data"],
        [int(v) for v in period_counter.values()] or [0],
        width=960,
        height=500,
    )
    period_path = output_dir / "period_volume_figure.svg"
    period_path.write_text(period_svg, encoding="utf-8")
    theme_shift_name = _theme_shift_svg(by_period, output_dir)
    period_table_html = _period_summary_table_html(periods, by_period)

    wave_artifact = {
        "schema": "chronological_wave_splits_v1",
        "collection_name": collection_name,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "date_range": f"{min(years)}-{max(years)}" if years else "N/A",
        "periods": [
            {
                "label": label,
                "start_year": a,
                "end_year": b,
                "item_count": int(period_counter.get(label, 0)),
                "evidence_count": len(by_period.get(label, [])),
            }
            for label, (a, b) in periods
        ],
    }
    (output_dir / "wave_splits.json").write_text(json.dumps(wave_artifact, ensure_ascii=False, indent=2), encoding="utf-8")

    def _period_payload(limit: int = 20) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for p_label, rows in by_period.items():
            for r in rows[:limit]:
                out.append({"period": p_label, "dqid": r["dqid"], "quote": r["quote"], "theme": r["theme"]})
        return out

    payload_base = {
        "collection_name": collection_name,
        "item_count": len(item_records),
        "date_range": f"{min(years)}-{max(years)}" if years else "N/A",
        "periods": [{"label": p, "range": {"start": a, "end": b}} for p, (a, b) in periods],
        "period_evidence": _period_payload(40),
        "top_themes": [{_humanize_theme_tokens(k): v} for k, v in list(theme_counts.items())[:20]],
        "evidence_payload": dq_payload,
        "wave_description": wave_artifact,
    }
    citation_instruction = _citation_style_instruction(citation_style)

    section_specs: dict[str, dict[str, Any]] = {
        "chronological_rationale": {"min": 120, "max": 700},
        "concept_evolution": {"min": 140, "max": 900},
        "methods_evolution": {"min": 140, "max": 900},
        "turning_points": {"min": 140, "max": 900},
        "persistent_debates": {"min": 120, "max": 900},
        "ai_period_volume_analysis": {"min": 80, "max": 500},
        "ai_theme_shift_analysis": {"min": 80, "max": 500},
        "ai_discussion": {"min": 180, "max": 1000},
        "ai_limitations": {"min": 120, "max": 800},
        "ai_research_implications": {"min": 120, "max": 800},
        "ai_practice_implications": {"min": 120, "max": 800},
        "future_phase_hypotheses": {"min": 120, "max": 900},
        "ai_introduction": {"min": 200, "max": 1200},
        "ai_abstract": {"min": 180, "max": 420, "forbid_h4": True},
        "ai_conclusion": {"min": 160, "max": 900},
    }

    phase1 = {
        "chronological_rationale": "Explain why chronological periodization is analytically justified for this corpus.",
        "concept_evolution": "Summarize how core concepts evolved across periods, citing evidence anchors where relevant.",
        "methods_evolution": "Summarize methodological shifts across periods, with concrete comparisons.",
        "turning_points": "Identify major turning points and why they changed trajectory.",
        "persistent_debates": "Identify recurrent debates that persist across periods and causes of persistence.",
        "ai_period_volume_analysis": "Interpret period volume figure in one concise analytical block.",
        "ai_theme_shift_analysis": "Interpret theme-shift figure in one concise analytical block.",
        "ai_discussion": "Provide a critical discussion of overall trajectory, advances, and unresolved tensions.",
        "ai_limitations": "State limitations of this chronological synthesis and dataset constraints.",
        "ai_research_implications": "Provide implications for future research design and evidence building.",
        "ai_practice_implications": "Provide implications for policy/practice decisions.",
        "future_phase_hypotheses": "Propose cautious next-phase hypotheses for the field trajectory.",
    }
    for label, _ in periods:
        period_key = f"period_{_safe_name(label)}"
        phase1[period_key] = f"Write the narrative summary for {label}. Cover dominant questions, methods pattern, and representative evidence."
        section_specs[period_key] = {"min": 120, "max": 900}

    llm_sections: dict[str, str] = {}

    phase1_prompts: list[tuple[str, str]] = []
    period_label_by_key: dict[str, str] = {f"period_{_safe_name(label)}": label for label, _ in periods}
    for section_name, instruction in phase1.items():
        section_payload = dict(payload_base)
        if section_name in period_label_by_key:
            period_label = period_label_by_key[section_name]
            section_payload["period_focus"] = period_label
            section_payload["period_evidence"] = [r for r in payload_base.get("period_evidence", []) if str(r.get("period")) == period_label][:24]
            section_payload["evidence_payload"] = []
        elif section_name in {"ai_period_volume_analysis", "ai_theme_shift_analysis"}:
            section_payload["period_evidence"] = []
            section_payload["evidence_payload"] = []
        prompt = (
            f"SECTION_NAME\n{section_name}\n\n"
            f"INSTRUCTION\n{instruction}\n\n"
            f"CONTEXT_JSON\n{json.dumps(section_payload, ensure_ascii=False, indent=2)}\n\n"
            "STYLE_GUARD\nWrite formal publication prose only. Do not mention prompts/context JSON/AI.\n\n"
            f"CITATION_STYLE\n{citation_instruction}\n\n"
            "Return only raw HTML snippets, no markdown fences."
        )
        phase1_prompts.append((section_name, prompt))
    if not phase1_prompts:
        raise RuntimeError("Phase-1 body prompt set is empty; cannot enforce two-batch contract.")

    phase1_batch = _run_grouped_batch_sections(
        collection_name=collection_name,
        model=model,
        function_name="chronological_review_section_writer",
        section_prompts=phase1_prompts,
    )
    for section_name, raw_html in phase1_batch["outputs"].items():
        cleaned = _clean_and_humanize_section_html(_clean_llm_html(raw_html))
        cleaned = _enrich_dqid_anchors(cleaned, dqid_lookup, citation_style=citation_style)
        _validate_generated_section(section_name, cleaned, section_specs[section_name])
        llm_sections[section_name] = cleaned
        section_cache[section_name] = cleaned
        section_cache_entries[section_name] = _make_cache_entry(section_name=section_name, html_text=cleaned, model=model)
    _write_section_cache(section_cache_path, section_cache_entries)

    whole_payload = {
        **payload_base,
        "draft_sections_html": llm_sections,
        "timeline_table_preview": _timeline_table_html(item_records)[:4000],
    }
    phase2 = {
        "ai_introduction": "Write the chronological review introduction with scope, trajectory framing, and objective.",
        "ai_abstract": "Write a single-block professional abstract covering background, approach, key periodized findings, and conclusion.",
        "ai_conclusion": "Write a conclusion emphasizing chronology-informed insights and next steps.",
    }

    phase2_prompts: list[tuple[str, str]] = []
    for section_name, instruction in phase2.items():
        prompt = (
            f"SECTION_NAME\n{section_name}\n\n"
            f"INSTRUCTION\n{instruction}\n\n"
            f"WHOLE_PAPER_CONTEXT_JSON\n{json.dumps(whole_payload, ensure_ascii=False, indent=2)}\n\n"
            "STYLE_GUARD\nWrite formal publication prose only. Do not mention prompts/context JSON/AI.\n\n"
            f"CITATION_STYLE\n{citation_instruction}\n\n"
            "Return only raw HTML snippets, no markdown fences."
        )
        phase2_prompts.append((section_name, prompt))
    if sorted(k for k, _ in phase2_prompts) != ["ai_abstract", "ai_conclusion", "ai_introduction"]:
        raise RuntimeError("Phase-2 prompt set must contain exactly ai_introduction, ai_abstract, ai_conclusion.")

    phase2_batch = _run_grouped_batch_sections(
        collection_name=f"{collection_name}_whole_paper",
        model=model,
        function_name="chronological_review_section_writer",
        section_prompts=phase2_prompts,
    )
    for section_name, raw_html in phase2_batch["outputs"].items():
        cleaned = _clean_and_humanize_section_html(_clean_llm_html(raw_html))
        cleaned = _enrich_dqid_anchors(cleaned, dqid_lookup, citation_style=citation_style)
        _validate_generated_section(section_name, cleaned, section_specs[section_name])
        llm_sections[section_name] = cleaned
        section_cache[section_name] = cleaned
        section_cache_entries[section_name] = _make_cache_entry(section_name=section_name, html_text=cleaned, model=model)
    _write_section_cache(section_cache_path, section_cache_entries)

    period_objects: list[dict[str, Any]] = []
    for label, _rng in periods:
        period_key = f"period_{_safe_name(label)}"
        rows = by_period.get(label, [])
        c = Counter(str(r.get("theme") or "uncategorized") for r in rows)
        top_themes = ", ".join(_humanize_theme_tokens(k) for k, _ in c.most_common(5))
        top_works: list[str] = []
        for r in item_records:
            if _period_for_year(r.get("year"), periods) == label:
                top_works.append(f"{r['first_author_last']} ({r['year'] if r['year'] else 'n.d.'})")
            if len(top_works) >= 6:
                break
        period_objects.append(
            {
                "label": label,
                "summary": llm_sections.get(period_key, f"<p>{label} synthesized from {len(rows)} coded entries.</p>"),
                "dominant_themes": top_themes or "No dominant themes identified.",
                "methods_pattern": "Mixed methods and doctrinal/qualitative evidence are represented.",
                "representative_works": "; ".join(top_works),
                "open_questions": "How to improve operational and comparative validation across periods.",
            }
        )

    refs = _build_reference_items(summary, citation_style=citation_style)
    years_sorted = sorted([y for y in years if isinstance(y, int)])
    date_range = f"{years_sorted[0]}-{years_sorted[-1]}" if years_sorted else "N/A"

    context = {
        "topic": collection_name,
        "authors_list": "Automated TEIA pipeline",
        "affiliation": "TEIA Research",
        "generation_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "ai_models_used": model,
        "doi_or_preprint": "",
        "ai_abstract": llm_sections.get("ai_abstract", ""),
        "ai_introduction": llm_sections.get("ai_introduction", ""),
        "guiding_questions": "How did concepts, methods, and evidence evolve over time?\nWhat turning points altered field trajectory?",
        "chronological_rationale": llm_sections.get("chronological_rationale", ""),
        "sources_consulted": "Zotero coded collection and parsed full-text excerpts.",
        "search_strings": "",
        "selection_rationale": "Representative and high-signal coded items were prioritized for period mapping.",
        "date_range": date_range,
        "corpus_notes": f"Items analyzed: {len(item_records)}",
        "full_search_strategy_appendix_path": "",
        "corpus_table": "",
        "period_definitions": _period_definitions_html(periods, period_counter),
        "coding_framework": "Open coding + intro/conclusion evidence harvesting with dqid-linked quotes.",
        "quality_appraisal_note": "",
        "timeline_figure": timeline_path.name,
        "period_volume_figure": period_path.name,
        "ai_period_volume_analysis": llm_sections.get("ai_period_volume_analysis", ""),
        "timeline_table": _timeline_table_html(item_records),
        "periods": period_objects,
        "concept_evolution": llm_sections.get("concept_evolution", ""),
        "methods_evolution": llm_sections.get("methods_evolution", ""),
        "theme_shift_figure": theme_shift_name,
        "ai_theme_shift_analysis": llm_sections.get("ai_theme_shift_analysis", ""),
        "turning_points": llm_sections.get("turning_points", ""),
        "turning_points_table": "",
        "persistent_debates": llm_sections.get("persistent_debates", ""),
        "synthesis_table": period_table_html,
        "ai_discussion": llm_sections.get("ai_discussion", ""),
        "ai_research_implications": llm_sections.get("ai_research_implications", ""),
        "ai_practice_implications": llm_sections.get("ai_practice_implications", ""),
        "future_phase_hypotheses": llm_sections.get("future_phase_hypotheses", ""),
        "ai_limitations": llm_sections.get("ai_limitations", ""),
        "ai_conclusion": llm_sections.get("ai_conclusion", ""),
        "references_list": [{"html_string": s[4:-5] if s.startswith("<li>") and s.endswith("</li>") else s} for s in refs],
        "appendices": [],
    }
    _validate_context_required(
        context,
        [
            "topic",
            "ai_abstract",
            "ai_introduction",
            "chronological_rationale",
            "timeline_figure",
            "period_volume_figure",
            "theme_shift_figure",
            "periods",
            "ai_conclusion",
            "references_list",
        ],
    )

    env = Environment(loader=FileSystemLoader(str(template_path.parent)), autoescape=select_autoescape(["html", "htm", "xml"]))
    template = env.get_template(template_path.name)
    rendered = template.render(**context)
    _assert_non_placeholder_html(rendered)
    _assert_reference_and_postprocess_integrity(rendered, citation_style=citation_style)

    out_html = output_dir / "chronological_review.html"
    out_ctx = output_dir / "chronological_review_context.json"
    out_html.write_text(rendered, encoding="utf-8")
    out_ctx.write_text(json.dumps(context, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest = {
        "status": "ok",
        "collection_name": collection_name,
        "output_html_path": str(out_html),
        "context_json_path": str(out_ctx),
        "phase_batches": 2,
        "batch_contract": {
            "writer_function": "chronological_review_section_writer",
            "phase1_batch_id": str(phase1_batch.get("batch_id") or ""),
            "phase1_request_count": int(phase1_batch.get("request_count") or 0),
            "phase2_batch_id": str(phase2_batch.get("batch_id") or ""),
            "phase2_request_count": int(phase2_batch.get("request_count") or 0),
            "phase1_sections": [k for k, _ in phase1_prompts],
            "phase2_sections": [k for k, _ in phase2_prompts],
            "enforced_exactly_two_batches": True,
        },
        "artifacts": {
            "timeline_figure": str(timeline_path),
            "period_volume_figure": str(period_path),
            "theme_shift_figure": str(output_dir / theme_shift_name),
            "wave_splits_json": str(output_dir / "wave_splits.json"),
        },
    }
    (output_dir / "chronological_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def run_pipeline(
    *,
    summary_path: Path,
    template_path: Path,
    outputs_root: Path,
    model: str = "gpt-5-mini",
    citation_style: str = "apa",
) -> dict[str, str]:
    summary = _load_json(summary_path)
    return render_chronological_review_from_summary(
        summary=summary,
        template_path=template_path,
        outputs_root=outputs_root,
        model=model,
        citation_style=citation_style,
    )


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Generate chronological review from coded summary.")
    p.add_argument("--summary-path", required=True)
    p.add_argument("--template-path", default=str(_repo_root() / "Research" / "templates" / "chronological_review_template.html"))
    p.add_argument("--outputs-root", default=str(_repo_root() / "Research" / "outputs"))
    p.add_argument("--model", default="gpt-5-mini")
    p.add_argument("--citation-style", default="apa")
    return p


def main() -> int:
    args = _build_parser().parse_args()
    result = run_pipeline(
        summary_path=Path(args.summary_path).resolve(),
        template_path=Path(args.template_path).resolve(),
        outputs_root=Path(args.outputs_root).resolve(),
        model=str(args.model),
        citation_style=str(args.citation_style),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
