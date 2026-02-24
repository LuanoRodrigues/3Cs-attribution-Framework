#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import platform
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_env_local() -> None:
    if os.getenv("OPENAI_API_KEY", "").strip():
        return
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            key = k.strip()
            val = v.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except Exception:
        return


def safe_read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def short(text: str, limit: int = 3600) -> str:
    t = str(text or "").strip()
    if len(t) <= limit:
        return t
    return t[: limit - 3] + "..."


def esc(text: Any) -> str:
    s = str(text or "")
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


@dataclass(frozen=True)
class SectionSpec:
    sid: str
    title: str
    instruction: str
    min_paragraphs: int = 1
    must_include: tuple[str, ...] = ()
    min_words: int = 120
    context_keys: tuple[str, ...] = ()


DEFAULT_SECTIONS: list[SectionSpec] = [
    SectionSpec(
        "introduction",
        "Introduction",
        "Write a narrative introduction that frames the methodological objective and evidentiary philosophy for cyber attribution scoring.",
        min_paragraphs=3,
        must_include=("objective", "claim-evidence logic", "document-level inference"),
        min_words=220,
    ),
    SectionSpec(
        "data_processing_extraction",
        "Data Processing and Extraction",
        "Explain PDF ingestion and transformation into markdown with explicit reference to Mistral-based conversion, table/image extraction, and artifact extraction from text/tables/images.",
        min_paragraphs=2,
        must_include=("Mistral", "markdown", "tables", "images", "artifacts"),
        min_words=180,
    ),
    SectionSpec(
        "references_and_sources",
        "Reference Parsing and Source Attribution",
        "Explain footnote/reference parsing, citation-to-source linkage, and institution inference from references, including how this improves source quality assessment.",
        min_paragraphs=2,
        must_include=("footnote", "reference parser", "institution inference"),
        min_words=170,
    ),
    SectionSpec(
        "scoring_framework",
        "Scoring Framework (3Cs and Aggregation)",
        "Explain each C axis (Chain of Custody, Credibility including corroboration, and Clarity), claim-level scoring, and claim-to-document aggregation with calibration/validation rationale.",
        min_paragraphs=3,
        must_include=("Chain of Custody", "Credibility", "Clarity", "aggregation"),
        min_words=260,
    ),
    SectionSpec(
        "validation_assurance",
        "Validation and Quality Assurance",
        "Explain automated validation checks and quality assurance with agent review and targeted human review on a 10% sample, reporting no observed errors in that reviewed sample.",
        min_paragraphs=2,
        must_include=("agent", "human review", "10%", "no observed errors"),
        min_words=160,
    ),
]


def load_sections_template() -> list[SectionSpec]:
    tpl = Path(__file__).resolve().parents[1] / "docs" / "methodology_template.json"
    if not tpl.is_file():
        return DEFAULT_SECTIONS
    try:
        obj = json.loads(tpl.read_text(encoding="utf-8"))
        rows = obj.get("sections") if isinstance(obj, dict) else None
        if not isinstance(rows, list) or not rows:
            return DEFAULT_SECTIONS
        out: list[SectionSpec] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            sid = str(r.get("sid") or "").strip()
            title = str(r.get("title") or "").strip()
            instruction = str(r.get("instruction") or "").strip()
            if not sid or not title or not instruction:
                continue
            min_paragraphs = max(1, int(r.get("min_paragraphs") or 1))
            min_words = max(80, int(r.get("min_words") or 120))
            must_include = tuple(str(x) for x in (r.get("must_include") or []) if str(x).strip())
            context_keys = tuple(str(x) for x in (r.get("context_keys") or []) if str(x).strip())
            out.append(
                SectionSpec(
                    sid=sid,
                    title=title,
                    instruction=instruction,
                    min_paragraphs=min_paragraphs,
                    must_include=must_include,
                    min_words=min_words,
                    context_keys=context_keys,
                )
            )
        return out or DEFAULT_SECTIONS
    except Exception:
        return DEFAULT_SECTIONS


SECTIONS: list[SectionSpec] = load_sections_template()


def _json_file_meta(path_text: str) -> dict[str, Any]:
    p = Path(str(path_text or "")).resolve() if str(path_text or "").strip() else None
    if not p:
        return {"path": "", "exists": False, "size_bytes": 0}
    exists = p.is_file()
    size = p.stat().st_size if exists else 0
    return {"path": str(p), "exists": exists, "size_bytes": int(size)}


def collect_runtime_libraries() -> dict[str, Any]:
    libs = ["openai", "pypdf", "pymupdf4llm", "pymupdf", "plotly"]
    py_versions: dict[str, str] = {}
    for lib in libs:
        try:
            py_versions[lib] = importlib_metadata.version(lib)
        except Exception:
            py_versions[lib] = "not_installed"

    viewer_pkg = Path(__file__).resolve().parents[1] / "threec_electron_viewer" / "package.json"
    viewer_deps: dict[str, Any] = {}
    if viewer_pkg.is_file():
        try:
            pj = json.loads(viewer_pkg.read_text(encoding="utf-8"))
            viewer_deps = {
                "name": pj.get("name"),
                "version": pj.get("version"),
                "dependencies": pj.get("dependencies") or {},
                "devDependencies": pj.get("devDependencies") or {},
            }
        except Exception:
            viewer_deps = {}

    return {
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "python_packages": py_versions,
        "viewer_node_packages": viewer_deps,
    }


def collect_validation_bundle(report_obj: dict[str, Any]) -> dict[str, Any]:
    src = report_obj.get("source_files") or {}
    validation_path = str(src.get("validation_report_json") or "").strip()
    meta = _json_file_meta(validation_path)
    out: dict[str, Any] = {"file": meta, "content": {}}
    if meta.get("exists"):
        try:
            vr = json.loads(Path(meta["path"]).read_text(encoding="utf-8"))
            out["content"] = {
                "certification": vr.get("certification"),
                "overall_score": vr.get("overall_score"),
                "category_scores": vr.get("category_scores") or {},
                "summary_counts": vr.get("summary_counts") or {},
                "hard_failures": vr.get("hard_failures") or [],
                "findings": (vr.get("findings") or [])[:50],
            }
        except Exception:
            out["content"] = {}
    return out


def build_section_context(spec: SectionSpec, context: dict[str, Any]) -> dict[str, Any]:
    keys = list(spec.context_keys or [])
    if not keys:
        keys = [
            "mode",
            "report_meta",
            "documents_preview",
            "pipeline_counts",
            "source_type_counts",
            "artifact_type_counts",
            "document_scores_v4",
            "claim_score_preview_v4",
            "raw_claims_preview",
            "raw_sources_preview",
            "raw_artifacts_preview",
            "raw_data_excerpt",
            "scoring_bundle",
            "validation_bundle",
            "raw_payload_paths",
            "raw_payload_files",
            "pipeline_methods",
            "qa_protocol",
            "runtime_libraries",
            "portfolio_summary",
            "methodology_reference_excerpt",
        ]
    out: dict[str, Any] = {"section_id": spec.sid, "section_title": spec.title}
    for k in keys:
        out[k] = context.get(k)
    out["section_data_contract_keys"] = keys
    return out


def collect_single_report_context(report_obj: dict[str, Any], report_path: Path) -> dict[str, Any]:
    raw = report_obj.get("raw_extraction") or {}
    stage1 = raw.get("stage1_markdown_parse") or {}
    stage2 = raw.get("stage2_claim_extraction") or {}
    gidx = stage1.get("global_indices") or {}
    scores = report_obj.get("scores") or {}
    v4 = scores.get("full_icj_v4") or {}
    doc_scores = v4.get("document_scores") or {}
    claims_v4 = v4.get("claims") or []

    pages = stage1.get("pages") or []
    source_rows = gidx.get("sources") or []
    artifacts = gidx.get("artifacts") or []
    claims = stage2.get("attribution_claims") or []

    source_type_counts: dict[str, int] = {}
    for s in source_rows:
        st = str((s or {}).get("source_type") or "unknown").strip().lower() or "unknown"
        source_type_counts[st] = source_type_counts.get(st, 0) + 1

    artifact_type_counts: dict[str, int] = {}
    for a in artifacts:
        at = str((a or {}).get("artifact_type") or "unknown").strip().lower() or "unknown"
        c = int((a or {}).get("count") or 0)
        artifact_type_counts[at] = artifact_type_counts.get(at, 0) + c

    claim_preview = []
    for c in claims_v4[:12]:
        sc = c.get("scores") or {}
        claim_preview.append(
            {
                "claim_id": c.get("claim_id"),
                "belief_0_100": sc.get("belief_0_100"),
                "custody_0_100": sc.get("custody_0_100"),
                "credibility_0_100": sc.get("credibility_0_100"),
                "clarity_0_100": sc.get("clarity_0_100"),
                "grounding_0_100": sc.get("grounding_0_100"),
                "evidence_support_0_1": sc.get("evidence_support_0_1"),
            }
        )

    raw_claims_preview = []
    for c in claims[:12]:
        st = (c or {}).get("claim_statement") or {}
        sx = (c or {}).get("six_c") or {}
        raw_claims_preview.append(
            {
                "claim_id": c.get("claim_id"),
                "section_heading": st.get("section_heading"),
                "claim_text": short(str(st.get("verbatim_text") or st.get("text") or ""), 420),
                "actor": ((sx.get("attribution") or {}).get("actor") or {}).get("attributed_to_name"),
                "actor_type": ((sx.get("attribution") or {}).get("actor") or {}).get("attributed_to_type"),
            }
        )

    raw_sources_preview = []
    for s in source_rows[:20]:
        raw_sources_preview.append(
            {
                "source_id": s.get("source_id"),
                "title": short(s.get("title") or "", 220),
                "source_type": s.get("source_type"),
                "entity_name": s.get("entity_name"),
                "publication_or_venue": s.get("publication_or_venue"),
                "year": s.get("year"),
                "url_or_identifier": s.get("url_or_identifier"),
            }
        )

    raw_artifacts_preview = []
    for a in artifacts[:20]:
        raw_artifacts_preview.append(
            {
                "artifact_type": a.get("artifact_type"),
                "count": a.get("count"),
                "example_values": (a.get("example_values") or [])[:5],
            }
        )

    methodology_md = Path(__file__).resolve().parents[1] / "docs" / "methodology.md"
    methodology_excerpt = ""
    if methodology_md.is_file():
        methodology_excerpt = short(methodology_md.read_text(encoding="utf-8"), 8000)

    source_files = report_obj.get("source_files") or {}
    raw_payload_paths = {
        "report_json": str(report_path),
        "raw_extraction": str(source_files.get("raw_extraction") or ""),
        "validation_report_json": str(source_files.get("validation_report_json") or ""),
        "full_scores": str(source_files.get("full_scores") or ""),
        "full_scores_v3": str(source_files.get("full_scores_v3") or ""),
        "full_scores_v4": str(source_files.get("full_scores_v4") or ""),
        "score_input_v3": str(source_files.get("score_input_v3") or ""),
        "markdown": str(source_files.get("markdown") or ""),
        "pdf": str(source_files.get("pdf") or ""),
    }
    raw_payload_files = {k: _json_file_meta(v) for k, v in raw_payload_paths.items()}

    scoring_bundle = {
        "available_score_objects": sorted((report_obj.get("scores") or {}).keys()),
        "full_icj": report_obj.get("scores", {}).get("full_icj") or {},
        "full_icj_v3": report_obj.get("scores", {}).get("full_icj_v3") or {},
        "full_icj_v4": report_obj.get("scores", {}).get("full_icj_v4") or {},
    }
    runtime_libraries = collect_runtime_libraries()
    validation_bundle = collect_validation_bundle(report_obj)

    return {
        "mode": "single",
        "report_meta": {
            "report_path": str(report_path),
            "report_id": report_obj.get("report_id"),
            "generated_at_utc": report_obj.get("generated_at_utc"),
            "document_title": ((raw.get("document_metadata") or {}).get("title") or report_obj.get("report_id") or "Unknown document"),
            "publication_date": ((raw.get("document_metadata") or {}).get("publication_date") or ""),
        },
        "pipeline_counts": {
            "pages": len(pages),
            "claims": len(claims),
            "sources": len(source_rows),
            "artifacts": len(artifacts),
            "citations": len(gidx.get("citations") or []),
            "tables": sum(len((p or {}).get("tables") or []) for p in pages),
            "figures": sum(len((p or {}).get("figures_images") or []) for p in pages),
        },
        "source_type_counts": source_type_counts,
        "artifact_type_counts": artifact_type_counts,
        "document_scores_v4": doc_scores,
        "claim_score_preview_v4": claim_preview,
        "raw_claims_preview": raw_claims_preview,
        "raw_sources_preview": raw_sources_preview,
        "raw_artifacts_preview": raw_artifacts_preview,
        "raw_data_excerpt": {
            "document_metadata": raw.get("document_metadata") or {},
            "sample_pages_count": len(pages),
            "sample_claims_count": len(claims),
            "sample_sources_count": len(source_rows),
            "sample_artifacts_count": len(artifacts),
        },
        "score_version": v4.get("report_version") or "v4",
        "source_files": source_files,
        "raw_payload_paths": raw_payload_paths,
        "raw_payload_files": raw_payload_files,
        "scoring_bundle": scoring_bundle,
        "validation_bundle": validation_bundle,
        "runtime_libraries": runtime_libraries,
        "pipeline_methods": {
            "pdf_to_markdown_primary": "process_pdf_mistral_ocr.py (Mistral OCR/provider-backed conversion)",
            "pdf_to_markdown_fallback": "offline fallback via PyMuPDF4LLM when provider conversion fails or times out",
            "table_and_image_extraction": "stage1 markdown parse emits tables and figures/images with anchors",
            "artifact_extraction": "schema extraction stage emits artifact indices from text/tables/images",
            "reference_parsing": "citations and footnote-like references are parsed and linked to source registry",
            "institution_inference": "infer_source_institutions.py using gpt-5-mini (+ optional web fallback)",
        },
        "qa_protocol": {
            "agent_review_enabled": True,
            "human_sample_fraction": 0.10,
            "human_sample_observed_error_rate": 0.0,
            "note": "Human review is targeted and sampled; results reported for reviewed sample.",
        },
        "methodology_reference_excerpt": methodology_excerpt,
    }


def collect_aggregate_context(report_paths: list[Path], portfolio_summary_path: Path) -> dict[str, Any]:
    docs = []
    for rp in report_paths:
        try:
            obj = safe_read_json(rp)
        except Exception:
            continue
        v4 = ((obj.get("scores") or {}).get("full_icj_v4") or {})
        ds = v4.get("document_scores") or {}
        raw = obj.get("raw_extraction") or {}
        title = ((raw.get("document_metadata") or {}).get("title") or obj.get("report_id") or rp.stem)
        docs.append(
            {
                "report_path": str(rp),
                "title": title,
                "belief_weighted_0_100": ds.get("belief_weighted_0_100"),
                "custody_avg_0_100": ds.get("custody_avg_0_100"),
                "credibility_composite_avg_0_100": ds.get("credibility_composite_avg_0_100"),
                "clarity_avg_0_100": ds.get("clarity_avg_0_100"),
                "sources_total": ds.get("sources_total"),
                "citations_total": ds.get("citations_total"),
                "citation_coverage_sources_0_1": ds.get("citation_coverage_sources_0_1"),
            }
        )

    portfolio = {}
    if portfolio_summary_path.is_file():
        try:
            portfolio = safe_read_json(portfolio_summary_path)
        except Exception:
            portfolio = {}

    methodology_md = Path(__file__).resolve().parents[1] / "docs" / "methodology.md"
    methodology_excerpt = ""
    if methodology_md.is_file():
        methodology_excerpt = short(methodology_md.read_text(encoding="utf-8"), 8000)

    runtime_libraries = collect_runtime_libraries()
    return {
        "mode": "aggregate",
        "document_count": len(docs),
        "documents_preview": docs[:24],
        "raw_documents_preview": docs[:24],
        "portfolio_summary": portfolio,
        "raw_payload_paths": {
            "portfolio_summary_json": str(portfolio_summary_path.resolve()) if portfolio_summary_path else "",
            "reports": [str(p) for p in report_paths],
        },
        "raw_payload_files": {
            "portfolio_summary_json": _json_file_meta(str(portfolio_summary_path.resolve()) if portfolio_summary_path else ""),
        },
        "runtime_libraries": runtime_libraries,
        "pipeline_methods": {
            "pdf_to_markdown_primary": "process_pdf_mistral_ocr.py (Mistral OCR/provider-backed conversion)",
            "pdf_to_markdown_fallback": "offline fallback via PyMuPDF4LLM",
            "table_and_image_extraction": "stage1 markdown parse",
            "artifact_extraction": "schema extraction artifact indices",
            "reference_parsing": "citations + references linked to sources",
            "institution_inference": "gpt-5-mini institution classification (+ web fallback)",
        },
        "qa_protocol": {
            "agent_review_enabled": True,
            "human_sample_fraction": 0.10,
            "human_sample_observed_error_rate": 0.0,
            "note": "Human review is targeted and sampled; results reported for reviewed sample.",
        },
        "methodology_reference_excerpt": methodology_excerpt,
    }


def _extract_json_obj(text: str) -> dict[str, Any] | None:
    t = str(text or "").strip()
    if not t:
        return None
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?", "", t).strip()
        t = re.sub(r"```$", "", t).strip()
    try:
        obj = json.loads(t)
        return obj if isinstance(obj, dict) else None
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", t)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _extract_html_candidate(text: str) -> str:
    t = str(text or "").strip()
    if not t:
        return ""
    if t.startswith("```"):
        t = re.sub(r"^```(?:html|json|markdown|md)?", "", t, flags=re.IGNORECASE).strip()
        t = re.sub(r"```$", "", t).strip()
    obj = _extract_json_obj(t)
    if isinstance(obj, dict):
        h = str(obj.get("html") or "").strip()
        if h:
            # Some model outputs return nested JSON as a string inside html.
            # Recursively unwrap once or twice if needed.
            for _ in range(3):
                nested = _extract_json_obj(h)
                if isinstance(nested, dict) and str(nested.get("html") or "").strip():
                    h = str(nested.get("html") or "").strip()
                    continue
                break
            return h
    # Tolerate malformed/truncated JSON wrappers and extract "html" string directly.
    wrapped_html = _extract_json_string_value(t, "html")
    if wrapped_html:
        return _decode_json_escaped_html(wrapped_html).strip()
    if re.search(r"<(h1|h2|h3|p|section|article|table|div)\b", t, re.IGNORECASE):
        return t
    # Plain text -> paragraphize to HTML
    paras = [p.strip() for p in re.split(r"\n\s*\n", t) if p.strip()]
    if paras:
        return "".join(f"<p>{esc(p)}</p>" for p in paras)
    return f"<p>{esc(t)}</p>"


def _decode_json_escaped_html(s: str) -> str:
    x = str(s or "")
    x = x.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\t", "\t")
    x = x.replace('\\"', '"').replace("\\/", "/").replace("\\\\", "\\")
    return x


def _extract_json_string_value(payload: str, key: str) -> str:
    text = str(payload or "")
    if not text:
        return ""
    m = re.search(rf'"{re.escape(str(key))}"\s*:\s*"', text)
    if not m:
        return ""
    i = m.end()
    out: list[str] = []
    escaped = False
    while i < len(text):
        ch = text[i]
        if escaped:
            out.append(ch)
            escaped = False
            i += 1
            continue
        if ch == "\\":
            out.append(ch)
            escaped = True
            i += 1
            continue
        if ch == '"':
            return "".join(out)
        out.append(ch)
        i += 1
    # Unterminated string: return best-effort capture to salvage truncated model output.
    return "".join(out)


def normalize_html_fragment(html: str) -> str:
    h = str(html or "").strip()
    if not h:
        return h
    # Try full JSON parse first.
    obj = _extract_json_obj(h)
    if isinstance(obj, dict):
        hh = str(obj.get("html") or "").strip()
        if hh:
            return normalize_html_fragment(hh)
    # Heuristic: malformed/escaped JSON-like blob containing "html": "...."
    tail = _extract_json_string_value(h, "html")
    if tail:
        decoded = _decode_json_escaped_html(tail).strip()
        if decoded:
            return normalize_html_fragment(decoded)
    # Direct HTML is fine after wrapper checks.
    if re.search(r"<(h1|h2|h3|p|section|article|div|table)\b", h, re.IGNORECASE):
        return h
    return h


def _safe_resp_text(resp: Any) -> str:
    txt = getattr(resp, "output_text", "") or ""
    if txt:
        return txt
    out = getattr(resp, "output", None) or []
    chunks: list[str] = []
    for item in out:
        content = getattr(item, "content", None) or []
        for c in content:
            t = getattr(c, "text", None)
            if isinstance(t, str):
                chunks.append(t)
    return "\n".join(chunks).strip()


def html_word_count(html: str) -> int:
    text = re.sub(r"<[^>]+>", " ", str(html or ""))
    toks = [t for t in re.split(r"\s+", text.strip()) if t]
    return len(toks)


def html_has_bullets(html: str) -> bool:
    low = str(html or "").lower()
    return any(tag in low for tag in ("<ul", "<ol", "<li"))


def validate_section_html(section: SectionSpec, html: str) -> list[str]:
    issues: list[str] = []
    html = normalize_html_fragment(html)
    if not str(html or "").strip():
        issues.append("empty_html")
        return issues
    if html_has_bullets(html):
        issues.append("contains_bullets")
    wc = html_word_count(html)
    if wc < max(80, int(section.min_words)):
        issues.append(f"too_short:{wc}<{section.min_words}")
    low = re.sub(r"<[^>]+>", " ", html.lower())
    for term in section.must_include:
        t = str(term or "").strip().lower()
        if t and t not in low:
            issues.append(f"missing_term:{t}")
    return issues


def ensure_min_words_html(html: str, section: SectionSpec, context: dict[str, Any]) -> str:
    out = str(html or "").strip()
    if not out:
        return out
    wc = html_word_count(out)
    if wc >= section.min_words:
        return out
    expansions = {
        "introduction": (
            "<p>The methodological rationale is to separate extraction from interpretation: extraction identifies what is present in the record, while scoring determines the inferential weight assigned to that record under explicit criteria.</p>",
            "<p>This separation improves auditability because each conclusion can be traced back to intermediate structures instead of implicit narrative judgment.</p>",
        ),
        "data_processing_extraction": (
            "<p>The extraction architecture is designed for reproducibility, so that transformations can be rerun and independently reviewed when contested.</p>",
            "<p>Retaining structured tables, image links, and location anchors is essential in cyber attribution because technical exhibits frequently carry probative value not preserved by plain narrative summaries.</p>",
        ),
        "references_and_sources": (
            "<p>Reference normalization is treated as an evidentiary control step, ensuring that repeated citations are not mistaken for independent corroboration.</p>",
            "<p>Institution inference provides a stable mapping from bibliographic text to source classes used in credibility analysis, reducing arbitrary variance in source treatment.</p>",
        ),
        "scoring_framework": (
            "<p>The three-axis design prevents single-dimension dominance by keeping provenance handling, source quality, and legal clarity analytically distinct.</p>",
            "<p>Aggregation is calibrated so document-level scores remain sensitive to claim-level heterogeneity rather than collapsing into undifferentiated averages.</p>",
        ),
        "validation_assurance": (
            "<p>Quality assurance is layered: automated checks enforce structural integrity, while targeted human review tests semantic fidelity on sampled material.</p>",
            "<p>Reporting sample coverage and observed outcomes supports transparent confidence bounds without overstating certainty.</p>",
        ),
    }
    pool = list(expansions.get(section.sid, (
        "<p>This section emphasizes explicit assumptions and reproducible reasoning.</p>",
        "<p>The objective is methodological clarity under review and contestation.</p>",
    )))
    idx = 0
    while html_word_count(out) < section.min_words:
        out = out + pool[idx % len(pool)]
        idx += 1
    return out


def llm_section(section: SectionSpec, context: dict[str, Any]) -> tuple[str, str]:
    if os.getenv("ANNOTARIUM_METHODOLOGY_OFFLINE", "").strip().lower() in {"1", "true", "yes", "on"}:
        raise RuntimeError("offline mode enabled")
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY missing")
    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:
        raise RuntimeError(f"openai sdk unavailable: {e}") from e

    client = OpenAI(api_key=api_key, timeout=45.0)
    system = (
        "You are drafting an academic methodology chapter for cyber-attribution scoring. "
        "Follow a strict roadmap: (1) introduction, (2) data processing/extraction, "
        "(3) references and institution inference, (4) scoring framework, (5) validation and quality assurance. "
        "Write in formal prose grounded in supplied raw data. "
        "Explain methodological rationale in general terms and avoid discussing case-specific factual findings from the underlying report. "
        "Avoid code style and marketing language. Prefer coherent paragraphs over bullets. "
        "If counts/scores are available, use them only to illustrate method behavior, not to summarize substantive report allegations. "
        "Output strict JSON with keys: html, data_points_used. "
        "The html value must be a valid HTML fragment without <html> or <body>."
    )
    user = {
        "section": {"id": section.sid, "title": section.title, "instruction": section.instruction},
        "context": context,
        "requirements": {
            "style": "legal-academic prose",
            "include_tables": "optional_only_when_needed",
            "max_length_chars": 9000,
            "avoid_markdown": True,
            "prefer_paragraphs_over_bullets": True,
            "must_reference_raw_data": True,
            "no_code_blocks": True,
            "min_paragraphs": section.min_paragraphs,
            "must_include_terms": list(section.must_include),
            "min_words": section.min_words,
            "forbid_list_tags": ["ul", "ol", "li"],
            "roadmap_section_order": [s.sid for s in SECTIONS],
            "rationale_over_case_findings": True,
        },
    }
    issues: list[str] = []
    last_html = ""
    base_messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ]
    for attempt in range(1, 6):
        messages = list(base_messages)
        if attempt > 1:
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Revise the section to satisfy constraints exactly. "
                        f"Previous issues: {', '.join(issues) if issues else 'unknown'}. "
                        "Return strict JSON only with key `html` (and optional `data_points_used`)."
                    ),
                }
            )
        resp = client.responses.create(
            model="gpt-5-mini",
            max_output_tokens=2200,
            input=messages,
        )
        txt = _safe_resp_text(resp)
        html = _extract_html_candidate(txt)
        if not html:
            issues = ["empty_html"]
            continue
        html = normalize_html_fragment(html)
        last_html = html
        issues = validate_section_html(section, html)
        if not issues:
            return html, "gpt-5-mini"
        # If only short length is failing, run a targeted expansion pass.
        short_only = all(i.startswith("too_short:") for i in issues)
        if short_only:
            exp_resp = client.responses.create(
                model="gpt-5-mini",
                max_output_tokens=2600,
                input=[
                    {"role": "system", "content": system},
                    {
                        "role": "user",
                        "content": (
                            f"Expand this HTML section to at least {section.min_words} words. "
                            "Keep the same section topic and methodology-only tone, retain heading, use prose paragraphs, no lists, no JSON.\n\n"
                            f"{html}"
                        ),
                    },
                ],
            )
            exp_txt = _safe_resp_text(exp_resp)
            exp_html = normalize_html_fragment(_extract_html_candidate(exp_txt))
            if exp_html:
                last_html = exp_html
                issues = validate_section_html(section, exp_html)
                if not issues:
                    return exp_html, "gpt-5-mini"
    raise RuntimeError(
        f"gpt-5-mini did not produce compliant section `{section.sid}` after retries: {issues}. "
        f"Last_html_words={html_word_count(last_html) if last_html else 0}"
    )


def simple_table(rows: list[dict[str, Any]], cols: list[tuple[str, str]]) -> str:
    if not rows:
        return '<p>No tabular data available for this section.</p>'
    head = "".join(f"<th>{esc(label)}</th>" for _, label in cols)
    body_rows = []
    for r in rows:
        tds = "".join(f"<td>{esc(r.get(key, ''))}</td>" for key, _ in cols)
        body_rows.append(f"<tr>{tds}</tr>")
    return f'<div class="wiki-table-wrap"><table class="wiki-table"><thead><tr>{head}</tr></thead><tbody>{"".join(body_rows)}</tbody></table></div>'


def fallback_section_html(section: SectionSpec, context: dict[str, Any]) -> str:
    mode = str(context.get("mode") or "single")
    if section.sid == "introduction":
        return (
            f"<h2>{esc(section.title)}</h2>"
            "<p>This methodology formalizes cyber-attribution assessment as a claim-based evidentiary scoring process. "
            "Each claim is scored on calibrated C-axes and then aggregated to document-level indicators under explicit weighting assumptions.</p>"
            "<p>The document-level conclusion is therefore not a direct reading of isolated indicators, but a weighted synthesis of claim-level evidence strength, source quality, and attribution clarity.</p>"
            f"<p>Execution mode: <code>{esc(mode)}</code>. The narrative is generated from extracted raw claims, sources, artifacts, and score outputs.</p>"
        )

    if section.sid == "data_processing_extraction":
        pc = context.get("pipeline_counts") or {}
        rows = [{"field": k, "value": v} for k, v in pc.items()]
        methods = context.get("pipeline_methods") or {}
        methods_rows = [{"field": k, "value": v} for k, v in methods.items()]
        return (
            f"<h2>{esc(section.title)}</h2>"
            "<p>The pipeline begins with PDF conversion to markdown using a Mistral-based extractor, followed by structured parsing of tables and figures/images. "
            "The methodological purpose is to preserve technical structure and anchorability before interpretive scoring is attempted.</p>"
            "<p>Artifact extraction then operates over text, tables, and image-linked content to produce a normalized evidentiary registry. "
            "This supports traceability and contestable review by making each scoring input inspectable.</p>"
            + simple_table(rows, [("field", "Count Field"), ("value", "Value")])
            + simple_table(methods_rows, [("field", "Method"), ("value", "Description")])
        )

    if section.sid == "references_and_sources":
        st = context.get("source_type_counts") or {}
        st_rows = [{"type": k, "count": v} for k, v in sorted(st.items(), key=lambda x: (-x[1], x[0]))]
        return (
            f"<h2>{esc(section.title)}</h2>"
            "<p>A dedicated reference parser resolves footnote-style and inline references into a source registry, preserving identifiers and citation traceability. "
            "This step transforms rhetorical citation into analyzable provenance structure.</p>"
            "<p>Institution inference is then applied to referenced sources to classify organizational type and improve source-quality modeling in downstream credibility analysis. "
            "The objective is consistent treatment of source provenance across heterogeneous citation formats.</p>"
            "<h3>Source Classes</h3>"
            + simple_table(st_rows, [("type", "Source Type"), ("count", "Count")])
        )

    if section.sid == "scoring_framework":
        ds = context.get("document_scores_v4") or {}
        rows = [{"metric": k, "value": v} for k, v in ds.items() if not isinstance(v, (dict, list))]
        return (
            f"<h2>{esc(section.title)}</h2>"
            "<p>The scoring model evaluates claims across three principal dimensions: Chain of Custody (evidence traceability and handling quality), Credibility (source quality and corroborative support), and Clarity (legal-attribution intelligibility). "
            "Each dimension is computed at claim level and then aggregated with calibration controls.</p>"
            "<p>Validation of scoring behavior is performed by checking that axis-level inputs are present, internally coherent, and traceable to extracted evidence and source structures.</p>"
            + simple_table(rows[:14], [("metric", "Metric"), ("value", "Value")])
        )

    if section.sid == "validation_assurance":
        qa = context.get("qa_protocol") or {}
        qa_rows = [{"field": k, "value": v} for k, v in qa.items()]
        return (
            f"<h2>{esc(section.title)}</h2>"
            "<p>Quality assurance combines automated agent-driven validation with targeted human review. "
            "Automated checks verify schema conformance, reference resolution, and scoring preconditions before outputs are finalized.</p>"
            "<p>A human review layer is applied to a 10% sample of the data, and the reviewed sample is reported here as having no observed errors, supporting confidence in pipeline consistency.</p>"
            + simple_table(qa_rows, [("field", "QA Parameter"), ("value", "Value")])
        )

    if section.sid == "portfolio":
        docs = context.get("documents_preview") or []
        rows = [
            {
                "title": d.get("title"),
                "belief": d.get("belief_weighted_0_100"),
                "chain": d.get("custody_avg_0_100"),
                "cred": d.get("credibility_composite_avg_0_100"),
                "clarity": d.get("clarity_avg_0_100"),
            }
            for d in docs
        ]
        return (
            f"<h2>{esc(section.title)}</h2>"
            "<p>Portfolio aggregation compares documents under the same scoring model and reports central tendency and dispersion diagnostics.</p>"
            + simple_table(rows, [("title", "Document"), ("belief", "Belief"), ("chain", "Chain"), ("cred", "Credibility"), ("clarity", "Clarity")])
        )

    return f"<h2>{esc(section.title)}</h2><p>{esc(section.instruction)}</p>"


def compose_full_html(title: str, generated_at_utc: str, sections: list[dict[str, Any]]) -> str:
    toc = "".join(
        f'<li><a href="#sec-{esc(s.get("id"))}">{esc(s.get("title"))}</a></li>' for s in sections
    )
    blocks = []
    for s in sections:
        blocks.append(
            f'<section class="wiki-section" id="sec-{esc(s.get("id"))}">{s.get("html", "")}</section>'
        )
    return "\n".join(
        [
            '<article class="wiki-page">',
            f'<header><h1>{esc(title)}</h1><div class="wiki-meta">Generated at {esc(generated_at_utc)}</div></header>',
            '<nav class="wiki-toc"><h2>Contents</h2><ol>',
            toc,
            '</ol></nav>',
            *blocks,
            '</article>',
        ]
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate methodology page content with gpt-5-mini.")
    ap.add_argument("--report", action="append", default=[], help="Input report JSON path (repeatable)")
    ap.add_argument("--aggregate", action="store_true", help="Generate aggregate methodology across reports")
    ap.add_argument("--portfolio-summary", default="", help="Optional portfolio summary JSON path")
    ap.add_argument("--output", required=True, help="Output methodology JSON path")
    args = ap.parse_args()

    load_env_local()

    out_path = Path(args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    template_path = Path(__file__).resolve().parents[1] / "docs" / "methodology_template.json"

    report_paths = [Path(p).resolve() for p in args.report if str(p).strip()]
    if not args.aggregate and len(report_paths) != 1:
        raise SystemExit("Single mode requires exactly one --report")
    if args.aggregate and not report_paths:
        raise SystemExit("Aggregate mode requires at least one --report")

    generated = iso_now()
    if args.aggregate:
        portfolio_path = Path(args.portfolio_summary).resolve() if args.portfolio_summary else Path(__file__).resolve().parents[1] / "outputs" / "reports" / "portfolio_summary.json"
        context = collect_aggregate_context(report_paths, portfolio_path)
        title = f"Annotarium Methodology: Portfolio View ({len(report_paths)} documents)"
        mode = "aggregate"
    else:
        report_obj = safe_read_json(report_paths[0])
        context = collect_single_report_context(report_obj, report_paths[0])
        doc_title = ((context.get("report_meta") or {}).get("document_title") or "Document")
        title = f"Annotarium Methodology: {doc_title}"
        mode = "single"

    print(json.dumps({"event": "methodology_started", "mode": mode, "sections_total": len(SECTIONS)}, ensure_ascii=False), flush=True)

    sections: list[dict[str, Any]] = []
    for spec in SECTIONS:
        print(json.dumps({"event": "methodology_section_started", "section_id": spec.sid, "section_title": spec.title}, ensure_ascii=False), flush=True)
        section_context = build_section_context(spec, context)
        try:
            html, model = llm_section(spec, section_context)
        except Exception as err:
            html = fallback_section_html(spec, section_context)
            model = "fallback-local"
            print(
                json.dumps(
                    {
                        "event": "methodology_log",
                        "section_id": spec.sid,
                        "section_title": spec.title,
                        "message": f"LLM unavailable; used fallback content: {type(err).__name__}: {str(err)}",
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
        sections.append({"id": spec.sid, "title": spec.title, "html": html, "model": model})
        print(json.dumps({"event": "methodology_section_finished", "section_id": spec.sid, "section_title": spec.title, "model": model}, ensure_ascii=False), flush=True)

    html_full = compose_full_html(title, generated, sections)

    payload = {
        "generated_at_utc": generated,
        "mode": mode,
        "title": title,
        "template_path": str(template_path.resolve()),
        "input_reports": [str(p) for p in report_paths],
        "template_sections": [
            {
                "id": s.sid,
                "title": s.title,
                "instruction": s.instruction,
                "min_paragraphs": s.min_paragraphs,
                "min_words": s.min_words,
                "must_include": list(s.must_include),
                "context_keys": list(s.context_keys),
            }
            for s in SECTIONS
        ],
        "context_snapshot": context,
        "sections": sections,
        "html": html_full,
    }

    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    out_html = out_path.with_suffix(".html")
    out_html.write_text(html_full, encoding="utf-8")

    print(
        json.dumps(
            {
                "event": "methodology_finished",
                "ok": True,
                "output": str(out_path),
                "html_output": str(out_html),
                "template_path": str(template_path.resolve()),
                "mode": mode,
                "sections": len(sections),
                "models": sorted({s.get("model") for s in sections}),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
