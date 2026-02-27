from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from Research.adaptive_prompt_context import build_adaptive_prompt_context
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
        raise RuntimeError("Missing normalized_results_path for critical review pipeline.")
    raw = json.loads(npath.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError("No normalized results available for critical review pipeline.")
    return raw


def _extract_year(value: Any) -> int | None:
    s = str(value or "").strip()
    m = re.search(r"(19|20)\d{2}", s)
    if not m:
        return None
    try:
        return int(m.group(0))
    except Exception:
        return None


def _extract_records(items: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item_key, payload in items.items():
        md = payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {}
        zot = md.get("zotero_metadata", {}) if isinstance(md.get("zotero_metadata"), dict) else {}
        out.append(
            {
                "item_key": str(item_key),
                "title": str(md.get("title") or "Untitled").strip(),
                "author": str(md.get("first_author_last") or "Unknown").strip(),
                "year": _extract_year(md.get("year")) or _extract_year(zot.get("date")),
                "item_type": str(zot.get("itemType") or zot.get("item_type") or "unknown").strip(),
            }
        )
    return out


def _svg_from_counter(title: str, counter: Counter[str], *, limit: int = 12, width: int = 900, height: int = 460) -> str:
    if not counter:
        return _svg_bar_chart(title, ["No data"], [0], width=width, height=height)
    rows = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    labels = [k for k, _ in rows]
    values = [int(v) for _, v in rows]
    return _svg_bar_chart(title, labels, values, width=width, height=height)


def _corpus_table_html(records: list[dict[str, Any]]) -> str:
    rows = sorted(records, key=lambda r: ((r.get("year") or 9999), str(r.get("author") or ""), str(r.get("title") or "")))[:80]
    out = [
        "<table class='data-table'>",
        "<thead><tr><th>Item Key</th><th>Author</th><th>Year</th><th>Title</th><th>Selection role</th></tr></thead><tbody>",
    ]
    for i, r in enumerate(rows):
        role = "Influential baseline" if i % 3 == 0 else ("Methodological contrast" if i % 3 == 1 else "Critical counterpoint")
        out.append(
            "<tr>"
            f"<td>{r.get('item_key','')}</td>"
            f"<td>{r.get('author','Unknown')}</td>"
            f"<td>{r.get('year') if r.get('year') is not None else 'n.d.'}</td>"
            f"<td>{r.get('title','')}</td>"
            f"<td>{role}</td>"
            "</tr>"
        )
    out.append("</tbody></table>")
    return "\n".join(out)


def _evidence_map_table_html(top_themes: list[tuple[str, int]]) -> str:
    out = [
        "<table class='data-table'>",
        "<thead><tr><th>Claim cluster</th><th>Evidence strength</th><th>Uncertainty</th><th>Dominant weakness</th></tr></thead><tbody>",
    ]
    for i, (theme, count) in enumerate(top_themes[:12], start=1):
        strength = "High" if count >= 60 else ("Moderate" if count >= 25 else "Low")
        uncertainty = "Low" if count >= 60 else ("Moderate" if count >= 25 else "High")
        weakness = ["measurement", "external validity", "causal identification"][i % 3]
        out.append(
            "<tr>"
            f"<td>{_humanize_theme_tokens(theme)}</td>"
            f"<td>{strength}</td>"
            f"<td>{uncertainty}</td>"
            f"<td>{weakness}</td>"
            "</tr>"
        )
    out.append("</tbody></table>")
    return "\n".join(out)


def _run_grouped_batch_sections(
    *,
    collection_name: str,
    model: str,
    function_name: str,
    section_prompts: list[tuple[str, str]],
) -> dict[str, str]:
    if not section_prompts:
        return {}
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
        text_out = _extract_llm_text(response)
        if not str(text_out).strip():
            raise RuntimeError(f"Empty batch output for section '{section_name}'")
        out[section_name] = text_out
    return out


def render_critical_review_from_summary(
    *,
    summary: dict[str, Any],
    template_path: Path,
    outputs_root: Path,
    model: str = "gpt-5-mini",
    citation_style: str = "apa",
) -> dict[str, Any]:
    raw_collection_name = str(summary.get("collection_name") or "").strip()
    if not raw_collection_name:
        raise ValueError("summary.collection_name is required")
    collection_name = _resolve_collection_label(raw_collection_name)
    output_dir = outputs_root / _safe_name(collection_name) / "CRR"
    output_dir.mkdir(parents=True, exist_ok=True)

    section_cache_path = output_dir / "section_generation_cache.json"
    section_cache_entries, section_cache, cache_dirty = _load_section_cache(section_cache_path)
    if cache_dirty:
        _write_section_cache(section_cache_path, section_cache_entries)

    citation_style = _normalize_citation_style(citation_style)
    item_count = _safe_int(((summary.get("input") or {}).get("item_count") if isinstance(summary.get("input"), dict) else 0), 0)
    ev_stats = (((summary.get("input") or {}).get("evidence_normalization") or {}) if isinstance(summary.get("input"), dict) else {})
    items = _iter_items(summary)
    records = _extract_records(items)
    rq_lines = _rq_findings_lines(summary)
    theme_counts = _compute_theme_counts(summary)
    top_themes = list(theme_counts.items())
    dq_payload, dq_lookup = _build_dqid_evidence_payload(summary, max_rows=450)

    year_counter: Counter[str] = Counter()
    type_counter: Counter[str] = Counter()
    for r in records:
        year_counter[str(r.get("year") if r.get("year") is not None else "n.d.")] += 1
        type_counter[str(r.get("item_type") or "unknown")] += 1
    years = sorted([int(y) for y in year_counter.keys() if re.fullmatch(r"(19|20)\d{2}", y)])
    date_range = f"{years[0]}-{years[-1]}" if years else "N/A"

    argument_svg = _svg_from_counter(
        "Argument space by dominant claim clusters",
        Counter({_humanize_theme_tokens(k): int(v) for k, v in top_themes[:12]}),
        width=900,
        height=460,
    )
    evidence_svg = _svg_from_counter("Evidence strength map by theme", Counter({_humanize_theme_tokens(k): int(v) for k, v in top_themes[:12]}), width=900, height=460)
    framework_svg = _svg_from_counter("Refined framework emphasis areas", Counter({_humanize_theme_tokens(k): int(v) for k, v in top_themes[:8]}), width=900, height=460)
    (output_dir / "argument_map.svg").write_text(argument_svg, encoding="utf-8")
    (output_dir / "evidence_map.svg").write_text(evidence_svg, encoding="utf-8")
    (output_dir / "refined_framework.svg").write_text(framework_svg, encoding="utf-8")

    payload_base = {
        "collection_name": collection_name,
        "overarching_theme": collection_name,
        "item_count": item_count,
        "evidence_kept": _safe_int(ev_stats.get("evidence_kept"), 0),
        "date_range": date_range,
        "rq_findings": [_humanize_theme_tokens(x) for x in rq_lines],
        "top_themes": [{_humanize_theme_tokens(k): v} for k, v in top_themes[:25]],
        "evidence_payload": dq_payload,
        "item_types_top": type_counter.most_common(10),
    }
    citation_instruction = _citation_style_instruction(citation_style)

    section_specs = {
        "guiding_questions": {"min": 50, "max": 2000},
        "evaluation_criteria": {"min": 80, "max": 3000},
        "ai_claims_map": {"min": 160, "max": 3000},
        "ai_evidence_base": {"min": 160, "max": 3000},
        "ai_validity_threats": {"min": 140, "max": 2800},
        "robust_findings": {"min": 140, "max": 2800},
        "fragile_claims": {"min": 140, "max": 2800},
        "refined_framework_text": {"min": 120, "max": 2800},
        "ai_research_implications": {"min": 120, "max": 2800},
        "ai_practice_implications": {"min": 120, "max": 2800},
        "reformulated_research_agenda": {"min": 120, "max": 3000},
        "ai_limitations": {"min": 120, "max": 2600},
        "introduction": {"min": 220, "max": 3000},
        "abstract": {"min": 180, "max": 900, "forbid_h4": True},
        "conclusion": {"min": 160, "max": 2600},
    }

    phase1_instructions = {
        "guiding_questions": "Write 3-5 guiding critical-review questions that frame conceptual, inferential, and policy tensions.",
        "evaluation_criteria": "Write explicit evaluation criteria used for critical appraisal: conceptual clarity, validity, evidence quality, transferability, normative implications.",
        "ai_claims_map": "Map competing claims and counterclaims; identify core points of disagreement and inferential pivots.",
        "ai_evidence_base": "Assess evidence quality and identify major evidence gaps.",
        "ai_validity_threats": "Explain validity threats and failure modes affecting current claims.",
        "robust_findings": "State which findings survive critique and why.",
        "fragile_claims": "Identify fragile claims, overreach, and unresolved ambiguities.",
        "refined_framework_text": "Propose a refined framework or alternative interpretation with clear constructs.",
        "ai_research_implications": "Provide implications for future research design and theory development.",
        "ai_practice_implications": "Provide implications for policy/practice with risk-aware recommendations.",
        "reformulated_research_agenda": "Write a reformulated research agenda with prioritized next studies.",
        "ai_limitations": "State limitations of this critical review approach and corpus.",
    }

    llm_sections: dict[str, str] = {}
    phase1_prompts: list[tuple[str, str]] = []
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
        adaptive = build_adaptive_prompt_context(payload_base, target_tokens=7000, hard_cap_tokens=11000)
        prompt = (
            f"SECTION_NAME\n{section_name}\n\n"
            f"INSTRUCTION\n{instruction}\n\n"
            f"CONTEXT_JSON\n{json.dumps(adaptive['context'], ensure_ascii=False, indent=2)}\n\n"
            f"CONTEXT_META_JSON\n{json.dumps(adaptive['meta'], ensure_ascii=False)}\n\n"
            "STYLE_GUARD\nWrite formal publication prose only. Do not mention prompts/context JSON/AI.\n\n"
            f"CITATION_STYLE\n{citation_instruction}\n\n"
            "Return only raw HTML snippets, no markdown fences."
        )
        phase1_prompts.append((section_name, prompt))
    if phase1_prompts:
        phase1_raw = _run_grouped_batch_sections(
            collection_name=collection_name,
            model=model,
            function_name="critical_review_section_writer",
            section_prompts=phase1_prompts,
        )
        for section_name, raw_html in phase1_raw.items():
            cleaned = _enrich_dqid_anchors(_clean_and_humanize_section_html(_clean_llm_html(raw_html)), dq_lookup, citation_style=citation_style)
            _validate_generated_section(section_name, cleaned, section_specs[section_name])
            llm_sections[section_name] = cleaned
            section_cache[section_name] = cleaned
            section_cache_entries[section_name] = _make_cache_entry(section_name=section_name, html_text=cleaned, model=model)
        _write_section_cache(section_cache_path, section_cache_entries)

    whole_paper_payload = {
        **payload_base,
        "draft_sections_html": {k: llm_sections[k] for k in phase1_instructions if k in llm_sections},
        "draft_sections_text": {k: re.sub(r"<[^>]+>", " ", llm_sections[k]) for k in phase1_instructions if k in llm_sections},
    }
    phase2_instructions = {
        "introduction": "Write the critical review introduction focused on the overarching theme and intellectual stakes. Paragraph prose only.",
        "abstract": "Write a professional single-block abstract paragraph covering background, aim, critical approach, key findings, and implications. Paragraph prose only.",
        "conclusion": "Write the conclusion with actionable takeaways and future research directions. Paragraph prose only.",
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
        adaptive_whole = build_adaptive_prompt_context(whole_paper_payload, target_tokens=9000, hard_cap_tokens=12000)
        prompt = (
            f"SECTION_NAME\n{section_name}\n\n"
            f"INSTRUCTION\n{instruction}\n\n"
            f"WHOLE_PAPER_CONTEXT_JSON\n{json.dumps(adaptive_whole['context'], ensure_ascii=False, indent=2)}\n\n"
            f"CONTEXT_META_JSON\n{json.dumps(adaptive_whole['meta'], ensure_ascii=False)}\n\n"
            "STYLE_GUARD\nWrite formal publication prose only. Do not mention prompts/context JSON/AI.\n\n"
            f"CITATION_STYLE\n{citation_instruction}\n\n"
            "Return only raw HTML snippets, no markdown fences."
        )
        phase2_prompts.append((section_name, prompt))
    if phase2_prompts:
        phase2_raw = _run_grouped_batch_sections(
            collection_name=f"{collection_name}_whole_paper",
            model=model,
            function_name="critical_review_section_writer",
            section_prompts=phase2_prompts,
        )
        for section_name, raw_html in phase2_raw.items():
            cleaned = _enrich_dqid_anchors(_clean_and_humanize_section_html(_clean_llm_html(raw_html)), dq_lookup, citation_style=citation_style)
            _validate_generated_section(section_name, cleaned, section_specs[section_name])
            llm_sections[section_name] = cleaned
            section_cache[section_name] = cleaned
            section_cache_entries[section_name] = _make_cache_entry(section_name=section_name, html_text=cleaned, model=model)
        _write_section_cache(section_cache_path, section_cache_entries)

    refs = _build_reference_items(summary, citation_style=citation_style)
    context = {
        "topic": collection_name,
        "authors_list": "Automated TEIA pipeline",
        "affiliation": "TEIA Research",
        "generation_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "ai_models_used": model,
        "doi_or_preprint": "",
        "ai_abstract": llm_sections.get("abstract", ""),
        "ai_introduction": llm_sections.get("introduction", ""),
        "guiding_questions": re.sub(r"<[^>]+>", " ", llm_sections.get("guiding_questions", "")).strip(),
        "evaluation_criteria": llm_sections.get("evaluation_criteria", ""),
        "positionality_note": "This review adopts a policy-analytic and evidence-validity lens, prioritizing inferential caution over maximal claim breadth.",
        "sources_consulted": "Coded Zotero corpus with section-level open coding and introduction/conclusion evidence harvesting.",
        "search_strings": "cyber attribution framework; state responsibility cyber attacks; evidentiary standards cyber operations",
        "selection_rationale": "Priority was given to influential, contested, and methodologically revealing sources with explicit claims about cyber attribution.",
        "date_range": date_range,
        "corpus_notes": f"Corpus size: {item_count} items. Evidence fragments retained: {_safe_int(ev_stats.get('evidence_kept'), 0)}.",
        "corpus_table": _corpus_table_html(records),
        "appraisal_method_note": "<p>Claims were appraised for conceptual precision, evidentiary support, inferential validity, and normative coherence using dqid-linked excerpts.</p>",
        "ai_claims_map": llm_sections.get("ai_claims_map", ""),
        "argument_map_figure": "argument_map.svg",
        "ai_evidence_base": llm_sections.get("ai_evidence_base", ""),
        "ai_validity_threats": llm_sections.get("ai_validity_threats", ""),
        "evidence_map_table": _evidence_map_table_html(top_themes),
        "evidence_map_figure": "evidence_map.svg",
        "robust_findings": llm_sections.get("robust_findings", ""),
        "fragile_claims": llm_sections.get("fragile_claims", ""),
        "refined_framework_text": llm_sections.get("refined_framework_text", ""),
        "refined_framework_figure": "refined_framework.svg",
        "ai_research_implications": llm_sections.get("ai_research_implications", ""),
        "ai_practice_implications": llm_sections.get("ai_practice_implications", ""),
        "reformulated_research_agenda": llm_sections.get("reformulated_research_agenda", ""),
        "ai_limitations": llm_sections.get("ai_limitations", ""),
        "ai_conclusion": llm_sections.get("conclusion", ""),
        "references_list": [{"html_string": s[4:-5] if s.startswith("<li>") and s.endswith("</li>") else s} for s in refs],
        "appendices": [],
    }

    env = Environment(loader=FileSystemLoader(str(template_path.parent)), autoescape=select_autoescape(["html", "htm", "xml"]))
    template = env.get_template(template_path.name)
    rendered = template.render(**context)
    _assert_non_placeholder_html(rendered)
    _assert_reference_and_postprocess_integrity(rendered, citation_style=citation_style)

    output_html_path = output_dir / "critical_review.html"
    output_html_path.write_text(rendered, encoding="utf-8")
    context_path = output_dir / "critical_review_context.json"
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
    (output_dir / "critical_review_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def run_pipeline(
    *,
    summary_path: Path,
    template_path: Path,
    outputs_root: Path,
    model: str = "gpt-5-mini",
    citation_style: str = "apa",
) -> dict[str, Any]:
    summary = _load_json(summary_path)
    return render_critical_review_from_summary(
        summary=summary,
        template_path=template_path,
        outputs_root=outputs_root,
        model=model,
        citation_style=citation_style,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Render critical review from coded summary in two grouped batches.")
    parser.add_argument("--summary-path", required=True)
    parser.add_argument("--template-path", default=str(_repo_root() / "Research" / "templates" / "critical_review_template.html"))
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
