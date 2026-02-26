from __future__ import annotations

import argparse
import json
import os
import re
import sys
import hashlib
from collections import Counter
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
    _rq_findings_lines,
    _safe_int,
    _safe_name,
    _stable_section_custom_id,
    _svg_bar_chart,
    _validate_generated_section,
    _write_section_cache,
)


def _iter_items(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    npath = Path(str(out.get("normalized_results_path") or "")).expanduser()
    if not npath.is_file():
        raise RuntimeError("Missing normalized_results_path for bibliographic pipeline.")
    raw = json.loads(npath.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError("No normalized results available for bibliographic pipeline.")
    return raw


def _year_key(value: str) -> str:
    s = str(value or "").strip()
    if not s:
        return "Unknown"
    m = re.search(r"(19|20)\d{2}", s)
    return m.group(0) if m else s


def _extract_counters(items: dict[str, dict[str, Any]]) -> dict[str, Counter[str]]:
    years: Counter[str] = Counter()
    item_types: Counter[str] = Counter()
    authors: Counter[str] = Counter()
    affiliations: Counter[str] = Counter()
    for payload in items.values():
        md = payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {}
        zot = md.get("zotero_metadata", {}) if isinstance(md.get("zotero_metadata"), dict) else {}
        years[_year_key(str(md.get("year") or zot.get("date") or ""))] += 1
        item_types[str(zot.get("item_type") or "unknown").strip().lower() or "unknown"] += 1
        first_author = str(md.get("first_author_last") or "").strip()
        if first_author:
            authors[first_author] += 1
        else:
            creators = zot.get("creators")
            if isinstance(creators, list) and creators:
                c0 = creators[0]
                if isinstance(c0, dict):
                    last = str(c0.get("lastName") or c0.get("name") or "").strip()
                    if last:
                        authors[last] += 1
        for k in ("affiliations", "affiliation"):
            vals = md.get(k)
            if isinstance(vals, list):
                for v in vals:
                    sv = str(v).strip()
                    if sv:
                        affiliations[sv] += 1
            elif isinstance(vals, str):
                sv = vals.strip()
                if sv:
                    affiliations[sv] += 1
    return {
        "years": years,
        "item_types": item_types,
        "authors": authors,
        "affiliations": affiliations,
    }


def _svg_html_from_counter(title: str, data: Counter[str], limit: int = 12) -> str:
    if not data:
        return _svg_bar_chart(title, ["No data"], [0], width=900, height=440)
    rows = sorted(data.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    labels = [k for k, _ in rows]
    values = [int(v) for _, v in rows]
    return _svg_bar_chart(title, labels, values, width=900, height=440)


def _run_grouped_batch_sections(
    *,
    collection_name: str,
    model: str,
    function_name: str,
    section_prompts: list[tuple[str, str]],
) -> dict[str, str]:
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
    expected_ids: list[str] = []
    for section_name, prompt in section_prompts:
        cid = _stable_section_custom_id(collection_name, section_name, prompt)
        expected_jobs.append((section_name, prompt, cid))
        expected_ids.append(cid)
    sig_payload = {"custom_ids": expected_ids}
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

    out: dict[str, str] = {}
    for section_name, custom_id in pending:
        response = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
        out[section_name] = _extract_llm_text(response)
    return out


def render_bibliographic_review_from_summary(
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
    output_dir = outputs_root / _safe_name(collection_name) / "BLR"
    output_dir.mkdir(parents=True, exist_ok=True)
    section_cache_path = output_dir / "section_generation_cache.json"
    section_cache_entries, section_cache, cache_dirty = _load_section_cache(section_cache_path)
    if cache_dirty:
        _write_section_cache(section_cache_path, section_cache_entries)

    citation_style = _normalize_citation_style(citation_style)
    ev_stats = (((summary.get("input") or {}).get("evidence_normalization") or {}) if isinstance(summary.get("input"), dict) else {})
    item_count = _safe_int(((summary.get("input") or {}).get("item_count") if isinstance(summary.get("input"), dict) else 0), 0)
    rq_lines = _rq_findings_lines(summary)
    theme_counts = _compute_theme_counts(summary)
    dq_payload, dq_lookup = _build_dqid_evidence_payload(summary, max_rows=350)
    items = _iter_items(summary)
    counters = _extract_counters(items)

    year_labels = [y for y in counters["years"].keys() if re.fullmatch(r"(19|20)\d{2}", y)]
    years_sorted = sorted(year_labels)
    date_range = f"{years_sorted[0]}-{years_sorted[-1]}" if years_sorted else "N/A"

    year_svg = _svg_html_from_counter("Annual publication output", counters["years"], limit=20)
    doc_svg = _svg_html_from_counter("Document type distribution", counters["item_types"], limit=12)
    author_svg = _svg_html_from_counter("Top authors", counters["authors"], limit=12)
    aff_svg = _svg_html_from_counter("Top affiliations", counters["affiliations"], limit=12)
    (output_dir / "figure_year_trends.svg").write_text(year_svg, encoding="utf-8")
    (output_dir / "figure_doc_types.svg").write_text(doc_svg, encoding="utf-8")
    (output_dir / "figure_top_authors.svg").write_text(author_svg, encoding="utf-8")
    (output_dir / "figure_top_affiliations.svg").write_text(aff_svg, encoding="utf-8")

    payload_base = {
        "collection_name": collection_name,
        "overarching_theme": collection_name,
        "item_count": item_count,
        "evidence_kept": _safe_int(ev_stats.get("evidence_kept"), 0),
        "rq_findings": [_humanize_theme_tokens(x) for x in rq_lines],
        "top_themes": [{_humanize_theme_tokens(k): v} for k, v in list(theme_counts.items())[:20]],
        "citation_style": citation_style,
        "evidence_payload": dq_payload,
        "figures": {
            "years_top": counters["years"].most_common(10),
            "item_types_top": counters["item_types"].most_common(10),
            "authors_top": counters["authors"].most_common(10),
            "affiliations_top": counters["affiliations"].most_common(10),
        },
    }
    citation_instruction = _citation_style_instruction(citation_style)

    section_specs = {
        "methodology_review": {"min": 160, "max": 900},
        "results_overview": {"min": 200, "max": 1200},
        "discussion": {"min": 220, "max": 1200},
        "limitations": {"min": 140, "max": 900},
        "ai_timeline_analysis": {"min": 80, "max": 500},
        "ai_analyzed_doc_types_analysis": {"min": 80, "max": 500},
        "ai_author_graph_analysis": {"min": 80, "max": 500},
        "ai_top_affiliations_analysis": {"min": 80, "max": 500},
        "introduction": {"min": 200, "max": 1200},
        "conclusion": {"min": 180, "max": 900},
        "abstract": {"min": 180, "max": 360, "forbid_h4": True},
    }

    phase1_instructions = {
        "methodology_review": "Write bibliographic methodology prose covering dataset origin, coding basis, and how figures summarize the coded corpus. Formal publication prose only.",
        "results_overview": "Write a results overview integrating trends, document types, and author/institution concentration from coded metadata. Use 1-3 evidence anchors per paragraph.",
        "discussion": "Write discussion interpreting bibliographic patterns and implications for the theme. Use 1-3 evidence anchors per paragraph.",
        "limitations": "Write limitations tied to metadata quality, coverage, and coding constraints. Use 1-2 evidence anchors per paragraph.",
        "ai_timeline_analysis": "Write a short interpretation of temporal publication trend figure. Use concise paragraph prose.",
        "ai_analyzed_doc_types_analysis": "Write a short interpretation of document type distribution figure. Use concise paragraph prose.",
        "ai_author_graph_analysis": "Write a short interpretation of author concentration figure. Use concise paragraph prose.",
        "ai_top_affiliations_analysis": "Write a short interpretation of affiliation concentration figure. Use concise paragraph prose.",
    }

    llm_sections: dict[str, str] = {}
    phase1_prompts: list[tuple[str, str]] = []
    evidence_heavy_sections = {"methodology_review", "results_overview", "discussion", "limitations"}
    for section_name, instruction in phase1_instructions.items():
        if section_name in section_cache:
            cached = _enrich_dqid_anchors(_clean_and_humanize_section_html(section_cache[section_name]), dq_lookup, citation_style=citation_style)
            try:
                _validate_generated_section(section_name, cached, section_specs[section_name])
                llm_sections[section_name] = cached
                continue
            except Exception:
                section_cache.pop(section_name, None)
                section_cache_entries.pop(section_name, None)
        section_payload = dict(payload_base)
        if section_name not in evidence_heavy_sections:
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
    if phase1_prompts:
        phase1_raw = _run_grouped_batch_sections(
            collection_name=collection_name,
            model=model,
            function_name="bibliographic_review_section_writer",
            section_prompts=phase1_prompts,
        )
        for section_name, raw_html in phase1_raw.items():
            cleaned = _enrich_dqid_anchors(_clean_and_humanize_section_html(_clean_llm_html(raw_html)), dq_lookup, citation_style=citation_style)
            _validate_generated_section(section_name, cleaned, section_specs[section_name])
            llm_sections[section_name] = cleaned
            section_cache[section_name] = cleaned
            section_cache_entries[section_name] = _make_cache_entry(
                section_name=section_name,
                html_text=cleaned,
                model=model,
            )
        _write_section_cache(section_cache_path, section_cache_entries)

    whole_paper_payload = {
        **payload_base,
        "draft_sections_html": {k: llm_sections[k] for k in phase1_instructions if k in llm_sections},
        "draft_sections_text": {k: re.sub(r"<[^>]+>", " ", llm_sections[k]) for k in phase1_instructions if k in llm_sections},
    }
    phase2_instructions = {
        "introduction": "Write the bibliographic introduction focused on the overarching theme and why bibliographic mapping is needed. Paragraph prose only.",
        "conclusion": "Write the bibliographic conclusion with concrete takeaways and next-step implications. Paragraph prose only.",
        "abstract": "Write a professional single-block abstract paragraph covering background, methods, results, and conclusions. Paragraph prose only.",
    }
    phase2_prompts: list[tuple[str, str]] = []
    for section_name, instruction in phase2_instructions.items():
        if section_name in section_cache:
            cached = _enrich_dqid_anchors(_clean_and_humanize_section_html(section_cache[section_name]), dq_lookup, citation_style=citation_style)
            try:
                _validate_generated_section(section_name, cached, section_specs[section_name])
                llm_sections[section_name] = cached
                continue
            except Exception:
                section_cache.pop(section_name, None)
                section_cache_entries.pop(section_name, None)
        prompt = (
            f"SECTION_NAME\n{section_name}\n\n"
            f"INSTRUCTION\n{instruction}\n\n"
            f"WHOLE_PAPER_CONTEXT_JSON\n{json.dumps(whole_paper_payload, ensure_ascii=False, indent=2)}\n\n"
            "STYLE_GUARD\nWrite formal publication prose only. Do not mention prompts/context JSON/AI.\n\n"
            f"CITATION_STYLE\n{citation_instruction}\n\n"
            "Return only raw HTML snippets, no markdown fences."
        )
        phase2_prompts.append((section_name, prompt))
    if phase2_prompts:
        phase2_raw = _run_grouped_batch_sections(
            collection_name=f"{collection_name}_whole_paper",
            model=model,
            function_name="bibliographic_review_section_writer",
            section_prompts=phase2_prompts,
        )
        for section_name, raw_html in phase2_raw.items():
            cleaned = _enrich_dqid_anchors(_clean_and_humanize_section_html(_clean_llm_html(raw_html)), dq_lookup, citation_style=citation_style)
            _validate_generated_section(section_name, cleaned, section_specs[section_name])
            llm_sections[section_name] = cleaned
            section_cache[section_name] = cleaned
            section_cache_entries[section_name] = _make_cache_entry(
                section_name=section_name,
                html_text=cleaned,
                model=model,
            )
        _write_section_cache(section_cache_path, section_cache_entries)

    refs_html = _build_reference_items(summary, citation_style=citation_style)
    context = {
        "topic": collection_name,
        "authors_list": "Automated TEIA pipeline",
        "affiliation": "TEIA Research",
        "generation_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "data_source_name": "Zotero coded corpus",
        "date_range": date_range,
        "analyzed_docs_count": item_count,
        "total_docs_found": item_count,
        "ai_models_used": model,
        "top_keywords_list_str": ", ".join([_humanize_theme_tokens(k) for k in list(theme_counts.keys())[:12]]),
        "ai_abstract": llm_sections.get("abstract", ""),
        "ai_introduction": llm_sections.get("introduction", ""),
        "ai_methodology_review": llm_sections.get("methodology_review", ""),
        "ai_discussion": llm_sections.get("discussion", ""),
        "ai_conclusion": llm_sections.get("conclusion", ""),
        "ai_limitations": llm_sections.get("limitations", ""),
        "year_trends_plot_html": year_svg,
        "analyzed_doc_types_plot_html": doc_svg,
        "top_authors_plot_html": author_svg,
        "top_affiliations_plot_html": aff_svg,
        "ai_timeline_analysis": llm_sections.get("ai_timeline_analysis", ""),
        "ai_analyzed_doc_types_analysis": llm_sections.get("ai_analyzed_doc_types_analysis", ""),
        "ai_author_graph_analysis": llm_sections.get("ai_author_graph_analysis", ""),
        "ai_top_affiliations_analysis": llm_sections.get("ai_top_affiliations_analysis", ""),
        "references_list": [{"html_string": s[4:-5] if s.startswith("<li>") and s.endswith("</li>") else s} for s in refs_html],
        "REFERENCE_LIMIT": 200,
    }

    env = Environment(loader=FileSystemLoader(str(template_path.parent)), autoescape=select_autoescape(["html", "htm", "xml"]))
    template = env.get_template(template_path.name)
    rendered = template.render(**context)
    _assert_non_placeholder_html(rendered)
    _assert_reference_and_postprocess_integrity(rendered, citation_style=citation_style)

    output_html_path = output_dir / "bibliographic_review.html"
    output_html_path.write_text(rendered, encoding="utf-8")
    context_path = output_dir / "bibliographic_review_context.json"
    context_path.write_text(json.dumps(context, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "status": "ok",
        "collection_name": collection_name,
        "output_html_path": str(output_html_path),
        "context_json_path": str(context_path),
        "phase_batches": 2,
        "phase1_sections": list(phase1_instructions.keys()),
        "phase2_sections": list(phase2_instructions.keys()),
    }
    (output_dir / "bibliographic_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
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
    return render_bibliographic_review_from_summary(
        summary=summary,
        template_path=template_path,
        outputs_root=outputs_root,
        model=model,
        citation_style=citation_style,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Render bibliographic review from coded summary in two grouped batches.")
    parser.add_argument("--summary-path", required=True)
    parser.add_argument("--template-path", default=str(_repo_root() / "Research" / "templates" / "bibliographic.html"))
    parser.add_argument("--outputs-root", default=str(_repo_root() / "Research" / "outputs"))
    parser.add_argument("--model", default="gpt-5-mini")
    parser.add_argument("--citation-style", default="apa")
    return parser


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
