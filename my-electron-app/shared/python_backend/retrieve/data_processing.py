from __future__ import annotations

import importlib.util
import hashlib
import re
import sys
import typing
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache(maxsize=1)
def _retrieve_data_processing_module():
    project_root = Path(__file__).resolve().parents[3]
    shared_dir = project_root / "shared"
    pages_dir = project_root / "src" / "pages"
    for extra in (shared_dir, pages_dir):
        extra_s = str(extra)
        if extra_s not in sys.path:
            sys.path.insert(0, extra_s)

    module_path = project_root / "src" / "pages" / "retrieve" / "data_processing.py"
    if not module_path.is_file():
        raise FileNotFoundError(f"Missing retrieve data_processing module: {module_path}")

    spec = importlib.util.spec_from_file_location("retrieve_data_processing_impl", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module spec: {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    for name in dir(typing):
        if name.startswith("_"):
            continue
        module.__dict__.setdefault(name, getattr(typing, name))
    spec.loader.exec_module(module)
    module.__dict__.setdefault("hashlib", hashlib)
    if not hasattr(module, "link_citations_to_footnotes"):
        legacy_fp = project_root.parent / "python_backend_legacy" / "llms" / "footnotes_parser.py"
        try:
            legacy_spec = importlib.util.spec_from_file_location("legacy_footnotes_parser", legacy_fp)
            if legacy_spec is None or legacy_spec.loader is None:
                raise RuntimeError(f"Could not load module spec from: {legacy_fp}")
            legacy_module = importlib.util.module_from_spec(legacy_spec)
            legacy_spec.loader.exec_module(legacy_module)
            if not hasattr(legacy_module, "link_citations_to_footnotes"):
                raise AttributeError("legacy footnotes_parser has no link_citations_to_footnotes")
            module.__dict__["link_citations_to_footnotes"] = legacy_module.link_citations_to_footnotes
        except Exception:
            def _link_citations_fallback(full_text: str, references=None):
                refs = references if isinstance(references, list) else []
                return {"total": {}, "results": [], "flat_text": full_text or "", "references": refs}

            module.__dict__["link_citations_to_footnotes"] = _link_citations_fallback
    return module


@lru_cache(maxsize=1)
def _annotarium_offline_module():
    project_root = Path(__file__).resolve().parents[3]
    module_path = project_root.parent / "annotarium" / "apply_schema_extraction_offline.py"
    if not module_path.is_file():
        raise FileNotFoundError(f"Missing annotarium parser module: {module_path}")

    spec = importlib.util.spec_from_file_location("annotarium_offline_impl", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module spec: {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _build_annotarium_stage1(full_text: str, references_payload: dict[str, Any] | None = None) -> dict[str, Any]:
    mod = _annotarium_offline_module()
    lines = str(full_text or "").splitlines()
    line_to_page, page_labels, marker_examples_found = mod._detect_pages(lines)
    _headings, heading_by_line, _section_lines = mod._heading_context(lines)
    anchors = mod.AnchorFactory()

    tables, _table_lines = mod._extract_tables(
        lines=lines,
        heading_by_line=heading_by_line,
        line_to_page=line_to_page,
        page_labels=page_labels,
    )
    text_blocks = mod._make_text_blocks(
        lines=lines,
        heading_by_line=heading_by_line,
        line_to_page=line_to_page,
        page_labels=page_labels,
    )
    figures = mod._make_figures(lines, heading_by_line, line_to_page, page_labels)
    sources, citations = mod._extract_sources_and_citations(
        lines=lines,
        heading_by_line=heading_by_line,
        line_to_page=line_to_page,
        page_labels=page_labels,
        anchors=anchors,
        references_payload=references_payload,
    )
    entities = mod._extract_entities(lines, heading_by_line, line_to_page, page_labels)
    artifacts = mod._extract_artifacts(
        lines=lines,
        heading_by_line=heading_by_line,
        line_to_page=line_to_page,
        page_labels=page_labels,
        anchors=anchors,
        max_total=1200,
    )
    artifact_idx = mod._artifact_index(artifacts)

    page_count = (max(line_to_page.values()) + 1) if line_to_page else 1
    pages: list[dict[str, Any]] = []
    for pidx in range(page_count):
        p_label = page_labels.get(pidx)
        p_headings: list[str] = []
        seen_heading: set[str] = set()
        for i, _ln in enumerate(lines):
            if line_to_page.get(i, 0) != pidx:
                continue
            h = heading_by_line.get(i)
            if h and h not in seen_heading:
                p_headings.append(h)
                seen_heading.add(h)
        pages.append(
            {
                "page_index": pidx,
                "page_label": p_label,
                "section_headings": p_headings,
                "text_blocks": [tb for tb in text_blocks if (tb.get("location") or {}).get("page_index") == pidx],
                "tables": [t for t in tables if (t.get("location") or {}).get("page_index") == pidx],
                "figures_images": [f for f in figures if (f.get("location") or {}).get("page_index") == pidx],
                "citations_found": [c for c in citations if ((c.get("anchor") or {}).get("location") or {}).get("page_index") == pidx],
                "artifacts_found": [a for a in artifacts if ((a.get("anchor") or {}).get("location") or {}).get("page_index") == pidx],
                "notes": "Annotarium stage-1 markdown parse.",
            }
        )

    return {
        "page_count": page_count,
        "marker_examples_found": marker_examples_found[:10],
        "pages": pages,
        "global_indices": {
            "sources": sources,
            "entities": entities,
            "artifacts": artifact_idx,
        },
        "tables": tables,
        "figures_images": figures,
        "citations_found": citations,
        "entities": entities,
        "artifacts_found": artifacts,
    }


def _is_bad_section_title(title: str) -> bool:
    t = str(title or "").strip()
    if not t:
        return True
    if len(t) > 180:
        return True
    words = re.findall(r"\w+", t)
    return len(words) > 26


def _clean_sections(sections: dict[str, Any]) -> dict[str, str]:
    if not isinstance(sections, dict):
        return {}
    out: dict[str, str] = {}
    seen_bodies: set[str] = set()
    untitled_idx = 1
    for raw_title, raw_body in sections.items():
        body = str(raw_body or "").strip()
        if not body:
            continue
        body_key = hashlib.sha256(body.encode("utf-8")).hexdigest()
        if body_key in seen_bodies:
            continue
        seen_bodies.add(body_key)
        title = str(raw_title or "").strip()
        if _is_bad_section_title(title):
            title = f"Untitled Section {untitled_idx}"
            untitled_idx += 1
        out[title] = body
    return out


_MD_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*$")
_NUM_HEADING_RE = re.compile(r"^\s*(?:\d{1,2}(?:\.\d{1,3})*|[IVXLC]{1,6})[\)\.\-]?\s+(.+?)\s*$", re.I)
_NUM_PREFIX_RE = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,3})*)[\)\.\-]?\s+(.+?)\s*$")
_DATEY_HEADING_RE = re.compile(r"^(on\s+)?(?:mon|tue|wed|thu|fri|sat|sun)\b.*\+\d{2}:\d{2}$", re.I)
_IP_DATEY_HEADING_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}\s+on\s+(?:mon|tue|wed|thu|fri|sat|sun)\b.*\+\d{2}:\d{2}$", re.I)
_ALPHA_ENUM_RE = re.compile(r"^[A-Z][\)\.\-]\s+(.+?)\s*$")


def _split_sections_from_markdown(full_text: str) -> dict[str, str]:
    lines = str(full_text or "").splitlines()
    spans: list[tuple[int, int, str]] = []  # (line_idx, level, title)

    for i, ln in enumerate(lines):
        m = _MD_HEADING_RE.match(ln)
        title = ""
        level = 0
        if m:
            title = m.group(2).strip()
            level = len(m.group(1))
        else:
            m2 = _NUM_HEADING_RE.match(ln)
            if m2:
                title = m2.group(1).strip()
                p = _NUM_PREFIX_RE.match(ln)
                if p:
                    title = f"{p.group(1)} {p.group(2).strip()}"
                    level = len(p.group(1).split("."))
                else:
                    level = 1
        if not title:
            continue
        if _DATEY_HEADING_RE.match(title):
            continue
        if _IP_DATEY_HEADING_RE.match(title):
            continue
        am = _ALPHA_ENUM_RE.match(title)
        if am:
            tail = am.group(1).strip()
            if len(re.findall(r"\w+", tail)) > 14 or len(tail) > 120:
                continue
        if not re.search(r"[A-Za-z]", title):
            continue
        if _is_bad_section_title(title):
            continue
        spans.append((i, level or 1, title))

    if not spans:
        return {}

    # Markdown heuristic:
    # If there are enough H2s, use H2 as section roots and deeper levels as subsections.
    # Otherwise use the minimum observed level as section root.
    md_levels = [lvl for _i, lvl, _t in spans if lvl >= 1]
    h2_count = sum(1 for _i, lvl, _t in spans if lvl == 2)
    root_level = 2 if h2_count >= 2 else (min(md_levels) if md_levels else 1)

    out: dict[str, str] = {}
    active_path: dict[int, str] = {}
    subsection_idx_by_root: dict[str, int] = {}
    for idx, (start, level, title) in enumerate(spans):
        end = spans[idx + 1][0] if idx + 1 < len(spans) else len(lines)
        body = "\n".join(lines[start + 1 : end]).strip()
        if not body:
            continue

        # reset deeper paths
        for k in list(active_path.keys()):
            if k >= level:
                active_path.pop(k, None)
        active_path[level] = title

        # Build hierarchical key from root_level downward.
        chain = [active_path[l] for l in sorted(active_path.keys()) if l >= root_level]
        if not chain:
            chain = [title]
        key = " > ".join(chain)
        if _is_bad_section_title(key):
            root = chain[0] if chain else "Section"
            n = subsection_idx_by_root.get(root, 0) + 1
            subsection_idx_by_root[root] = n
            key = f"{root} > Subsection {n}"
        if key in out:
            key = f"{key} ({idx + 1})"
        out[key] = body
    return _clean_sections(out)


def _section_quality_needs_fallback(sections: dict[str, str]) -> bool:
    if not sections:
        return True
    rows = list(sections.items())
    total = len(rows)
    bad_titles = sum(1 for k, _v in rows if _is_bad_section_title(k))
    tiny = sum(1 for _k, v in rows if len(re.findall(r"\w+", v or "")) < 40)
    return bad_titles >= max(1, int(total * 0.3)) or tiny >= max(2, int(total * 0.45))


def _fallback_stage1_from_citation_styles(citations_obj: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not isinstance(citations_obj, dict):
        return [], []
    rows: list[str] = []
    for sk in ("footnotes", "numeric", "author_year", "tex"):
        bucket = citations_obj.get(sk)
        if not isinstance(bucket, dict):
            continue
        items = bucket.get("items")
        if isinstance(items, dict):
            for _k, v in items.items():
                sv = str(v or "").strip()
                if sv:
                    rows.append(sv)
        intext = bucket.get("intext")
        if isinstance(intext, list):
            for row in intext:
                if isinstance(row, dict):
                    sv = str(
                        row.get("footnote")
                        or row.get("raw")
                        or row.get("text")
                        or row.get("citation")
                        or row.get("reference")
                        or ""
                    ).strip()
                else:
                    sv = str(row or "").strip()
                if sv:
                    rows.append(sv)
        results = bucket.get("results")
        if isinstance(results, list):
            for row in results:
                if isinstance(row, dict):
                    sv = str(
                        row.get("footnote")
                        or row.get("raw")
                        or row.get("text")
                        or row.get("citation")
                        or row.get("reference")
                        or ""
                    ).strip()
                else:
                    sv = str(row or "").strip()
                if sv:
                    rows.append(sv)
    uniq: list[str] = []
    seen: set[str] = set()
    for r in rows:
        if r in seen:
            continue
        seen.add(r)
        uniq.append(r)
    citations_out: list[dict[str, Any]] = []
    sources_out: list[dict[str, Any]] = []
    for i, txt in enumerate(uniq[:200], start=1):
        sid = f"SRCX{i:04d}"
        cid = f"CITX{i:04d}"
        citations_out.append(
            {
                "citation_id": cid,
                "citation_kind": "bibliographic",
                "raw_citation_text": txt[:1800],
                "raw_identifier": f"style:{i}",
                "normalized_identifier": f"style:{i}",
                "resolved_source_id": sid,
                "anchor": {
                    "anchor_id": f"P000-A{i:03d}",
                    "extraction_method": "style_fallback",
                    "verbatim_text": txt[:1800],
                    "location": {"page_index": 0, "page_label": None, "section_heading": None, "object_id": cid},
                    "notes": "Recovered from citation style buckets.",
                },
                "notes": "Recovered from numeric/author_year/tex/footnotes style buckets.",
            }
        )
        sources_out.append(
            {
                "source_id": sid,
                "source_type": "other",
                "entity_name": "Referenced source",
                "year": None,
                "title": txt[:300],
                "publication_or_venue": "Recovered citation",
                "url_or_identifier": None,
                "cited_in_document": [{"page_index": 0, "page_label": None, "section_heading": None, "object_id": cid}],
                "notes": "Recovered from citation style buckets.",
            }
        )
    return citations_out, sources_out


def extract_intro_conclusion_pdf_text(*args: Any, **kwargs: Any):
    return _retrieve_data_processing_module().extract_intro_conclusion_pdf_text(*args, **kwargs)


def check_keyword_details_pdf(*args: Any, **kwargs: Any):
    return _retrieve_data_processing_module().check_keyword_details_pdf(*args, **kwargs)


def process_pdf(*args: Any, **kwargs: Any):
    base = _retrieve_data_processing_module().process_pdf(*args, **kwargs)
    if not isinstance(base, dict):
        return base

    full_text = str(base.get("full_text") or "")
    if not full_text.strip():
        return base
    base_sections = base.get("sections")
    if isinstance(base_sections, dict):
        cleaned = _clean_sections(base_sections)
        md_split = _split_sections_from_markdown(full_text)
        if _section_quality_needs_fallback(cleaned) and len(md_split) >= 2:
            base["sections"] = md_split
        else:
            base["sections"] = cleaned

    references_payload = None
    citations_obj = base.get("citations")
    references_obj = base.get("references")
    references_list: list[str] = []
    if isinstance(references_obj, list):
        references_list = [str(x).strip() for x in references_obj if str(x).strip()]
    elif isinstance(references_obj, str) and references_obj.strip():
        references_list = [ln.strip() for ln in references_obj.splitlines() if ln.strip()]

    if not references_list and isinstance(citations_obj, dict):
        collected: list[str] = []
        for sk in ("footnotes", "numeric", "author_year", "tex"):
            bucket = citations_obj.get(sk)
            if not isinstance(bucket, dict):
                continue
            items = bucket.get("items")
            if isinstance(items, dict):
                for _k, v in items.items():
                    sv = str(v or "").strip()
                    if sv:
                        collected.append(sv)
            intext = bucket.get("intext")
            if isinstance(intext, list):
                for row in intext:
                    if isinstance(row, dict):
                        sv = str(
                            row.get("footnote")
                            or row.get("raw")
                            or row.get("text")
                            or row.get("citation")
                            or ""
                        ).strip()
                        if sv:
                            collected.append(sv)
                    else:
                        sv = str(row or "").strip()
                        if sv:
                            collected.append(sv)
            results = bucket.get("results")
            if isinstance(results, list):
                for row in results:
                    if isinstance(row, dict):
                        sv = str(
                            row.get("footnote")
                            or row.get("raw")
                            or row.get("text")
                            or row.get("citation")
                            or row.get("reference")
                            or ""
                        ).strip()
                        if sv:
                            collected.append(sv)
        seen: set[str] = set()
        deduped: list[str] = []
        for c in collected:
            if c in seen:
                continue
            seen.add(c)
            deduped.append(c)
        references_list = deduped

    if isinstance(citations_obj, dict):
        foot = citations_obj.get("footnotes")
        if isinstance(foot, dict):
            items = foot.get("items")
            if isinstance(items, dict):
                references_payload = {"all_footnote_items": items}

    if references_list:
        structured_refs = []
        for i, raw_ref in enumerate(references_list, start=1):
            structured_refs.append(
                {
                    "footnote_number": i,
                    "bibliographic_info": {"raw_reference": raw_ref},
                    "confidence": 0.5,
                }
            )
        if references_payload is None:
            references_payload = {}
        references_payload["structured_references"] = {"references": structured_refs}
        all_items = references_payload.get("all_footnote_items")
        if not isinstance(all_items, dict):
            references_payload["all_footnote_items"] = {str(i): r for i, r in enumerate(references_list, start=1)}

    stage1 = _build_annotarium_stage1(full_text, references_payload=references_payload)
    if isinstance(citations_obj, dict) and not (stage1.get("citations_found") or []):
        c_fallback, s_fallback = _fallback_stage1_from_citation_styles(citations_obj)
        if c_fallback:
            stage1["citations_found"] = c_fallback
            gi = stage1.get("global_indices") if isinstance(stage1.get("global_indices"), dict) else {}
            if not gi.get("sources"):
                gi["sources"] = s_fallback
            stage1["global_indices"] = gi
            pages = stage1.get("pages")
            if isinstance(pages, list) and pages:
                p0 = pages[0] if isinstance(pages[0], dict) else {}
                p0["citations_found"] = c_fallback
                pages[0] = p0
                stage1["pages"] = pages
    base["stage1_markdown_parse"] = {
        "page_count": stage1.get("page_count"),
        "marker_examples_found": stage1.get("marker_examples_found"),
        "pages": stage1.get("pages", []),
        "global_indices": stage1.get("global_indices", {}),
    }
    base["tables"] = stage1.get("tables", [])
    base["figures_images"] = stage1.get("figures_images", [])
    base["entities"] = stage1.get("entities", [])
    base["artifacts"] = stage1.get("artifacts_found", [])
    base["source_index"] = (stage1.get("global_indices") or {}).get("sources", [])
    base["citations_stage1"] = stage1.get("citations_found", [])
    base["footnotes"] = ((citations_obj or {}).get("footnotes") if isinstance(citations_obj, dict) else {}) or {}
    base["references_merged"] = references_list
    return base


def extract_content_for_keywords(*args: Any, **kwargs: Any):
    return _retrieve_data_processing_module().extract_content_for_keywords(*args, **kwargs)


def normalise_df_data(df):
    return _retrieve_data_processing_module().normalise_df_data(df)
