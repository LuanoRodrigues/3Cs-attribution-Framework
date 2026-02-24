#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

import jsonschema


DEFAULT_SCHEMA = "annotarium/cyber_attribution_markdown_extraction_v2_schema.json"
DEFAULT_MARKDOWN = (
    "annotarium/cache/pdf_markdown/"
    "ca3da254e06b03e8b28ce2c2a9f679a6498325fa3126ce1757f9b9304ffa1be3.full_text.md"
)
DEFAULT_OUTPUT = "annotarium/outputs/extraction/output.json"
DEFAULT_REPORT_JSON = "annotarium/outputs/validation/validation_report.json"
DEFAULT_REPORT_MD = "annotarium/outputs/validation/validation_report.md"


URL_RE = re.compile(r"^(?:https?://)[^\s<>]+$")
URL_FIND_RE = re.compile(r"https?://[^\s<>\]\"']+")
BARE_URL_FIND_RE = re.compile(r"\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,63}/[^\s<>\]\"']+")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DOMAIN_RE = re.compile(r"^(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,63}$")
IPV4_RE = re.compile(
    r"^(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$"
)
SUPERSCRIPT_RE = re.compile(r"[²³¹⁴⁵⁶⁷⁸⁹⁰]")
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
TABLE_MARKER_RE = re.compile(r"(?mi)^\s*TABLE\s+\d+")
CITATION_FOOTNOTE_RE = re.compile(r"(?m)^\s*\d+\s+[\"“”']?.+https?://")
SOURCE_LOCATOR_LINE_RE = re.compile(
    r"^\s*(?:https?://[^\s<>\]\"']+|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,63}/[^\s<>\]\"']+)\s*$"
)
BAD_DOMAIN_SUFFIX_RE = re.compile(r"\.(?:php|asp|aspx|html|do|jsp)$", re.I)
FOOTNOTE_LINE_RE = re.compile(r"^\s*(?:\d+|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)\s+")
SUPERSCRIPT_CHARS = "¹²³⁴⁵⁶⁷⁸⁹⁰²³"
COMMON_TLDS = {
    "com", "net", "org", "edu", "gov", "mil", "int", "info", "biz", "name", "pro", "io", "me", "co", "ai",
    "dev", "app", "cloud", "tech", "online", "site", "xyz", "top", "cn", "ru", "uk", "us", "ca", "au", "de",
    "fr", "jp", "kr", "tw", "hk", "in", "br", "mx", "nl", "se", "ch", "es", "it", "pl", "za", "id", "tr",
    "ir", "ae", "sg", "vn", "ph", "th", "my", "ro", "pt", "gr", "cz", "fi", "no", "dk", "be", "at", "ie",
}


def _clip(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _clean_url_text(url: str) -> str:
    s = html.unescape((url or "").strip()).strip("<>").strip()
    s = re.sub(rf"[{re.escape(SUPERSCRIPT_CHARS)}]+$", "", s)
    while s and s[-1] in ".,;:]>'\"”’":
        s = s[:-1]
    while s.endswith(")") and s.count(")") > s.count("("):
        s = s[:-1]
    return s


def _normalize_url(url: str) -> str | None:
    s = _clean_url_text(url)
    s = re.sub(rf"[{re.escape(SUPERSCRIPT_CHARS)}]", "", s)
    try:
        p = urlparse(s)
    except Exception:
        return None
    if p.scheme not in {"http", "https"} or not p.netloc:
        return None
    netloc = html.unescape(p.netloc).strip().rstrip(".,;:]>'\"”’").lower()
    if not netloc:
        return None
    return urlunparse((p.scheme.lower(), netloc, p.path or "", p.params or "", p.query or "", p.fragment or ""))


def _source_url(u: str) -> str:
    nu = _normalize_url(u)
    return nu if nu is not None else _clean_url_text(u)


def _normalize_urlish(u: str) -> str | None:
    nu = _normalize_url(u)
    if nu is not None:
        return nu
    s = _clean_url_text(u)
    if not s or "://" in s:
        return None
    if "/" not in s:
        return None
    host = s.split("/", 1)[0].strip().lower()
    tld = host.rsplit(".", 1)[-1] if "." in host else ""
    if tld not in COMMON_TLDS:
        return None
    return _normalize_url(f"https://{s}")


def _url_equiv_key(u: str) -> str | None:
    nu = _normalize_urlish(u)
    if nu is None:
        return None
    p = urlparse(nu)
    return urlunparse(("", p.netloc.lower(), p.path or "", "", p.query or "", p.fragment or ""))


def _citation_pub_year_candidates(text: str) -> list[int]:
    line = html.unescape(text or "")
    pub_scope = re.split(r"\baccessed\b", line, maxsplit=1, flags=re.I)[0]
    years = [int(m.group(0)) for m in re.finditer(r"\b(19|20)\d{2}\b", pub_scope)]
    return [y for y in years if 1980 <= y <= datetime.utcnow().year + 1]


def _scan_markdown_table_row_counts(markdown_text: str) -> list[int]:
    lines = markdown_text.splitlines()
    out: list[int] = []
    i = 0
    while i < len(lines) - 1:
        l1 = lines[i]
        l2 = lines[i + 1]
        if "|" in l1 and re.search(r"^\s*\|?[\s:-]+\|[\s|:-]*$", l2):
            rows = 1  # header
            j = i + 2
            while j < len(lines):
                cur = lines[j].strip()
                if not cur:
                    break
                if "|" in lines[j] and cur.startswith("|"):
                    rows += 1
                    j += 1
                    continue
                if rows > 1 and not lines[j - 1].rstrip().endswith("|"):
                    j += 1
                    continue
                break
            out.append(rows)
            i = j
            continue
        i += 1
    return out


def _collect_all_anchors(out: dict[str, Any]) -> list[dict[str, Any]]:
    anchors: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if isinstance(node.get("anchor_id"), str) and isinstance(node.get("verbatim_text"), str):
                key = (node["anchor_id"], node["verbatim_text"])
                if key not in seen:
                    anchors.append(node)
                    seen.add(key)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(out)
    return anchors


def _anchor_in_markdown(anchor_text: str, markdown_norm: str) -> bool:
    probe = _norm_text(anchor_text)
    if len(probe) < 30:
        return True
    if probe in markdown_norm:
        return True
    short_probe = probe[:220]
    return bool(short_probe and short_probe in markdown_norm)


def _iter_pages(out: dict[str, Any]) -> list[dict[str, Any]]:
    stage1 = out.get("stage1_markdown_parse") or {}
    pages = stage1.get("pages") or []
    return [p for p in pages if isinstance(p, dict)]


def _collect_sources(out: dict[str, Any]) -> dict[str, dict[str, Any]]:
    sources: dict[str, dict[str, Any]] = {}
    stage1_global = ((out.get("stage1_markdown_parse") or {}).get("global_indices") or {}).get("sources") or []
    stage2_doc = ((out.get("stage2_claim_extraction") or {}).get("document_level_index") or {}).get("sources") or []
    for src in [*stage1_global, *stage2_doc]:
        if not isinstance(src, dict):
            continue
        sid = src.get("source_id")
        if isinstance(sid, str) and sid:
            sources[sid] = src
    return sources


def _collect_citations(out: dict[str, Any]) -> list[dict[str, Any]]:
    out_list: list[dict[str, Any]] = []
    for page in _iter_pages(out):
        cits = page.get("citations_found") or []
        out_list.extend([c for c in cits if isinstance(c, dict)])
    return out_list


def _collect_tables(out: dict[str, Any]) -> list[dict[str, Any]]:
    out_list: list[dict[str, Any]] = []
    for page in _iter_pages(out):
        out_list.extend([t for t in (page.get("tables") or []) if isinstance(t, dict)])
    return out_list


def _collect_artifacts(out: dict[str, Any]) -> list[dict[str, Any]]:
    out_list: list[dict[str, Any]] = []
    for page in _iter_pages(out):
        out_list.extend([a for a in (page.get("artifacts_found") or []) if isinstance(a, dict)])
    return out_list


def _collect_claims(out: dict[str, Any]) -> list[dict[str, Any]]:
    claims = ((out.get("stage2_claim_extraction") or {}).get("attribution_claims") or [])
    return [c for c in claims if isinstance(c, dict)]


def _check_schema(schema: dict[str, Any], out: dict[str, Any]) -> tuple[bool, str]:
    try:
        jsonschema.validate(instance=out, schema=schema)
        return True, "ok"
    except Exception as exc:
        return False, str(exc)


def _integrity_score(markdown_text: str, out: dict[str, Any]) -> tuple[float, list[dict[str, str]]]:
    findings: list[dict[str, str]] = []
    markdown_norm = _norm_text(markdown_text)
    sources = _collect_sources(out)
    citations = _collect_citations(out)
    claims = _collect_claims(out)
    pages = _iter_pages(out)
    stage1 = out.get("stage1_markdown_parse") or {}

    errors = 0
    warnings = 0
    # source id uniqueness by dict merge already, compare counts from raw arrays
    raw_source_count = len((stage1.get("global_indices") or {}).get("sources") or []) + len(
        ((out.get("stage2_claim_extraction") or {}).get("document_level_index") or {}).get("sources") or []
    )
    unique_source_count = len(sources)
    if unique_source_count == 0:
        errors += 2
        findings.append({"severity": "error", "message": "No sources found in stage1/stage2 source indices."})
    if raw_source_count > 0 and unique_source_count < raw_source_count / 2:
        warnings += 1
        findings.append(
            {
                "severity": "warning",
                "message": f"High source duplication across indices ({raw_source_count} raw vs {unique_source_count} unique).",
            }
        )

    page_count = stage1.get("page_count")
    if isinstance(page_count, int) and page_count != len(pages):
        errors += 1
        findings.append(
            {
                "severity": "error",
                "message": f"stage1.page_count ({page_count}) does not match pages[] length ({len(pages)}).",
            }
        )

    # Duplicate object id checks.
    duplicate_errors = 0
    for label, key, objects in [
        ("citations", "citation_id", citations),
        ("claims", "claim_id", claims),
        ("tables", "object_id", _collect_tables(out)),
        ("artifacts", "artifact_id", _collect_artifacts(out)),
    ]:
        ids = [o.get(key) for o in objects if isinstance(o.get(key), str)]
        dupes = len(ids) - len(set(ids))
        if dupes > 0:
            duplicate_errors += dupes
            findings.append({"severity": "error", "message": f"{dupes} duplicate {label} IDs detected."})
    errors += duplicate_errors

    source_ids = set(sources.keys())
    bad_cit_refs = 0
    for cit in citations:
        rid = cit.get("resolved_source_id")
        if rid is not None and rid not in source_ids:
            bad_cit_refs += 1
    if bad_cit_refs:
        errors += bad_cit_refs
        findings.append({"severity": "error", "message": f"{bad_cit_refs} citations reference missing source_id."})

    claim_ids = [c.get("claim_id") for c in claims if isinstance(c.get("claim_id"), str)]
    if len(set(claim_ids)) != len(claim_ids):
        errors += 2
        findings.append({"severity": "error", "message": "Duplicate claim_id values detected."})

    # Anchor fidelity: markdown anchors should map back into markdown text.
    anchors = _collect_all_anchors(out)
    markdown_anchors = [a for a in anchors if str(a.get("extraction_method") or "") == "markdown"]
    missing_anchors = 0
    for a in markdown_anchors:
        txt = str(a.get("verbatim_text") or "")
        if not _anchor_in_markdown(txt, markdown_norm):
            missing_anchors += 1
    if markdown_anchors:
        missing_ratio = missing_anchors / len(markdown_anchors)
        if missing_ratio > 0.15:
            errors += 1
            findings.append(
                {
                    "severity": "error",
                    "message": f"{missing_anchors}/{len(markdown_anchors)} markdown anchors not found in source markdown.",
                }
            )
        elif missing_ratio > 0.03:
            warnings += 1
            findings.append(
                {
                    "severity": "warning",
                    "message": f"{missing_anchors}/{len(markdown_anchors)} markdown anchors were not directly matchable.",
                }
            )

    # Stage1/Stage2 source metadata drift by source_id.
    stage1_src = {
        s.get("source_id"): s
        for s in ((stage1.get("global_indices") or {}).get("sources") or [])
        if isinstance(s, dict) and isinstance(s.get("source_id"), str)
    }
    stage2_src = {
        s.get("source_id"): s
        for s in (((out.get("stage2_claim_extraction") or {}).get("document_level_index") or {}).get("sources") or [])
        if isinstance(s, dict) and isinstance(s.get("source_id"), str)
    }
    drift = 0
    for sid in sorted(set(stage1_src.keys()) & set(stage2_src.keys())):
        a = stage1_src[sid]
        b = stage2_src[sid]
        if a.get("year") != b.get("year"):
            drift += 1
            continue
        au = _source_url(str(a.get("url_or_identifier") or ""))
        bu = _source_url(str(b.get("url_or_identifier") or ""))
        if au != bu:
            drift += 1
    if drift:
        warnings += 1
        findings.append({"severity": "warning", "message": f"{drift} source records differ between stage1 and stage2 indices."})

    score = _clip(100.0 - (errors * 10.0) - (warnings * 3.0))
    return score, findings


def _table_score(markdown_text: str, out: dict[str, Any]) -> tuple[float, list[dict[str, str]]]:
    findings: list[dict[str, str]] = []
    table_markers = len(TABLE_MARKER_RE.findall(markdown_text))
    pipe_table_row_counts = _scan_markdown_table_row_counts(markdown_text)
    pipe_table_markers = len(pipe_table_row_counts)
    expected = max(table_markers, pipe_table_markers)
    tables = _collect_tables(out)
    extracted = len(tables)

    if expected == 0:
        return 100.0, findings
    if extracted == 0:
        findings.append(
            {
                "severity": "error",
                "message": f"Detected {expected} table markers in markdown but extracted 0 tables[].",
            }
        )
        return 0.0, findings

    coverage = min(1.0, extracted / expected)
    coverage_penalty = (1.0 - coverage) * 65.0

    malformed = 0
    sparse = 0
    fallback = 0
    caption_missing = 0
    rowcount_mismatch = 0
    aligned = min(len(pipe_table_row_counts), len(tables))
    for idx, t in enumerate(tables):
        rep = str(t.get("representation") or "")
        cells = t.get("table_cells") or []
        caption = t.get("caption_verbatim")
        if caption in (None, "", "None"):
            caption_missing += 1
        if rep == "verbatim_text":
            fallback += 1
            continue
        if rep not in {"markdown_table", "cells", "csv"}:
            sparse += 1
            continue
        if not isinstance(cells, list) or len(cells) < 2:
            sparse += 1
            continue
        header = cells[0] if isinstance(cells[0], list) else []
        if not isinstance(header, list) or len(header) < 2:
            sparse += 1
            continue
        hlen = len(header)
        bad_rows = 0
        for row in cells[1:]:
            if not isinstance(row, list) or len(row) != hlen:
                bad_rows += 1
        if bad_rows:
            malformed += 1
        if idx < aligned:
            expected_rows = pipe_table_row_counts[idx]
            observed_rows = len(cells)
            if observed_rows + 1 < expected_rows:
                rowcount_mismatch += 1

    quality_base = max(1, extracted)
    quality_penalty = (
        (malformed / quality_base) * 20.0
        + (sparse / quality_base) * 22.0
        + (fallback / quality_base) * 12.0
        + (caption_missing / quality_base) * 8.0
        + (rowcount_mismatch / max(1, aligned)) * 18.0
    )
    score = _clip(100.0 - coverage_penalty - quality_penalty)

    if coverage < 0.5:
        findings.append(
            {
                "severity": "warning",
                "message": f"Low table extraction coverage: extracted={extracted}, expected≈{expected}.",
            }
        )
    if malformed:
        findings.append({"severity": "warning", "message": f"{malformed}/{extracted} tables have inconsistent row widths."})
    if sparse:
        findings.append({"severity": "warning", "message": f"{sparse}/{extracted} tables are too sparse to be analysis-ready."})
    if rowcount_mismatch:
        findings.append(
            {
                "severity": "warning",
                "message": f"{rowcount_mismatch}/{max(1, aligned)} tables appear truncated versus markdown row counts.",
            }
        )
    if fallback:
        findings.append(
            {
                "severity": "warning",
                "message": f"{fallback}/{extracted} tables are verbatim-only fallbacks (unstructured).",
            }
        )
    return score, findings


def _citation_score(markdown_text: str, out: dict[str, Any]) -> tuple[float, list[dict[str, str]]]:
    findings: list[dict[str, str]] = []
    citations = _collect_citations(out)
    sources = _collect_sources(out)
    lines = markdown_text.splitlines()
    candidates = len(CITATION_FOOTNOTE_RE.findall(markdown_text))
    header_locator_candidates = sum(
        1 for line in lines[:40] if SOURCE_LOCATOR_LINE_RE.match(html.unescape(line or "").strip())
    )
    candidates += header_locator_candidates
    markdown_url_keys: set[str] = set()
    footnote_url_keys: set[str] = set()
    for line in lines:
        line_clean = html.unescape(line)
        url_tokens = URL_FIND_RE.findall(line_clean) + BARE_URL_FIND_RE.findall(line_clean)
        norm_urls = {_normalize_urlish(u) for u in url_tokens}
        norm_urls = {u for u in norm_urls if isinstance(u, str)}
        markdown_url_keys.update({k for k in (_url_equiv_key(u) for u in norm_urls) if isinstance(k, str)})
        if FOOTNOTE_LINE_RE.match(line_clean):
            footnote_url_keys.update({k for k in (_url_equiv_key(u) for u in norm_urls) if isinstance(k, str)})

    if not citations:
        if candidates > 0:
            findings.append(
                {
                    "severity": "error",
                    "message": f"Found about {candidates} citation-like markdown lines (footnotes/source locator URLs) but no citations_found[].",
                }
            )
            return 0.0, findings
        return 100.0, findings

    likely_non_biblio = 0
    bad_norm = 0
    unresolved = 0
    missing_in_markdown = 0
    source_url_mismatch = 0
    source_year_mismatch = 0
    source_year_missing = 0
    poor_biblio_text = 0
    cited_source_ids: set[str] = set()

    for cit in citations:
        raw = str(cit.get("raw_citation_text") or "")
        rid = cit.get("resolved_source_id")
        norm_id = cit.get("normalized_identifier")
        raw_id = cit.get("raw_identifier")
        norm_url = _normalize_urlish(str(norm_id or ""))
        norm_url_key = _url_equiv_key(str(norm_id or ""))
        if isinstance(rid, str):
            cited_source_ids.add(rid)

        if rid is not None and rid not in sources:
            unresolved += 1

        if isinstance(norm_id, str):
            if SUPERSCRIPT_RE.search(norm_id) or norm_id.rstrip(".,);:]") != norm_id:
                bad_norm += 1
            if norm_id.startswith("http") and not URL_RE.match(norm_id):
                bad_norm += 1
            if "&amp;" in norm_id or " " in norm_id:
                bad_norm += 1
        if norm_url is None:
            bad_norm += 1
        else:
            if norm_url_key is None or norm_url_key not in markdown_url_keys:
                missing_in_markdown += 1
            if footnote_url_keys and (norm_url_key is None or norm_url_key not in footnote_url_keys):
                likely_non_biblio += 1

        looks_url_only = ("http://" in raw or "https://" in raw) and len(raw) < 180 and not YEAR_RE.search(raw)
        looks_download = "download" in raw.lower() and not YEAR_RE.search(raw)
        if looks_url_only or looks_download:
            likely_non_biblio += 1
        raw_wo_url = re.sub(r"https?://[^\s<>\],;]+", "", html.unescape(raw))
        raw_wo_url = re.sub(r"^\s*(?:\d+|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)\s+", "", raw_wo_url)
        raw_wo_url = re.sub(r"\baccessed\b.*$", "", raw_wo_url, flags=re.I).strip()
        if len(raw_wo_url) < 20:
            poor_biblio_text += 1

        if isinstance(raw_id, str) and isinstance(norm_id, str) and raw_id.startswith("http") and not norm_id.startswith("http"):
            bad_norm += 1

        if isinstance(rid, str) and rid in sources:
            src = sources[rid]
            src_url = str(src.get("url_or_identifier") or "")
            src_url_norm = _normalize_url(src_url) if src_url else None
            if src_url_norm and norm_url and src_url_norm != norm_url:
                source_url_mismatch += 1
            src_year = src.get("year")
            pub_years = _citation_pub_year_candidates(raw)
            if isinstance(src_year, int):
                if pub_years and src_year not in pub_years:
                    source_year_mismatch += 1
            elif pub_years:
                source_year_missing += 1

    total = len(citations)
    penalty = (
        (likely_non_biblio / total) * 16.0
        + (bad_norm / total) * 26.0
        + (unresolved / total) * 20.0
        + (missing_in_markdown / total) * 16.0
        + (source_url_mismatch / total) * 12.0
        + (source_year_mismatch / total) * 12.0
        + (source_year_missing / total) * 6.0
        + (poor_biblio_text / total) * 8.0
    )
    sources_with_url = [s for s in sources.values() if isinstance(s.get("url_or_identifier"), str) and s.get("url_or_identifier")]
    if sources_with_url:
        orphan_sources = sum(1 for s in sources_with_url if s.get("source_id") not in cited_source_ids)
        penalty += (orphan_sources / len(sources_with_url)) * 8.0
    else:
        orphan_sources = 0
    score = _clip(100.0 - penalty)

    if likely_non_biblio:
        findings.append(
            {
                "severity": "warning",
                "message": f"{likely_non_biblio}/{total} citations look like non-bibliographic inline links.",
            }
        )
    if bad_norm:
        findings.append({"severity": "warning", "message": f"{bad_norm}/{total} citations have normalization issues."})
    if missing_in_markdown:
        findings.append({"severity": "warning", "message": f"{missing_in_markdown}/{total} citation URLs not found in markdown text."})
    if unresolved:
        findings.append({"severity": "error", "message": f"{unresolved}/{total} citations reference missing sources."})
    if source_url_mismatch:
        findings.append({"severity": "warning", "message": f"{source_url_mismatch}/{total} citations disagree with source URL metadata."})
    if source_year_mismatch:
        findings.append({"severity": "warning", "message": f"{source_year_mismatch}/{total} citations disagree with source year metadata."})
    if source_year_missing:
        findings.append({"severity": "warning", "message": f"{source_year_missing}/{total} citations have publication years but source year is missing."})
    if poor_biblio_text:
        findings.append({"severity": "warning", "message": f"{poor_biblio_text}/{total} citations contain very weak bibliographic context."})
    if orphan_sources:
        findings.append({"severity": "warning", "message": f"{orphan_sources}/{len(sources_with_url)} sources with URLs are not referenced by citations."})

    return score, findings


def _source_year_score(out: dict[str, Any]) -> tuple[float, list[dict[str, str]]]:
    findings: list[dict[str, str]] = []
    sources_map = _collect_sources(out)
    sources = list(sources_map.values())
    citations = _collect_citations(out)
    if not sources:
        return 0.0, [{"severity": "error", "message": "No sources available for year quality checks."}]

    current_year = datetime.utcnow().year
    year_values = []
    suspicious = 0
    mismatched_to_citations = 0
    missing_with_citation_year = 0
    cit_text_by_source: dict[str, list[str]] = {}
    for cit in citations:
        sid = cit.get("resolved_source_id")
        if isinstance(sid, str):
            cit_text_by_source.setdefault(sid, []).append(str(cit.get("raw_citation_text") or ""))

    for src in sources:
        sid = str(src.get("source_id") or "")
        y = src.get("year")
        if y is None:
            texts = cit_text_by_source.get(sid, [])
            if any(_citation_pub_year_candidates(t) for t in texts):
                missing_with_citation_year += 1
            continue
        if not isinstance(y, int):
            suspicious += 1
            continue
        year_values.append(y)
        entity = str(src.get("entity_name") or "")
        title = str(src.get("title") or "")
        venue = str(src.get("publication_or_venue") or "")
        blob = f"{entity} {title} {venue}"
        if y < 1980 or y > current_year + 1:
            suspicious += 1
            continue
        if re.search(rf"\bproject\s+{y}\b", blob, re.I):
            suspicious += 1
            continue
        if re.search(rf"catalog[_\s-]*id\s*=?\s*{y}", blob, re.I):
            suspicious += 1
            continue
        if re.search(rf"\bunit\s+{y}\b", blob, re.I):
            suspicious += 1
            continue
        if re.search(rf"\bword\s+{y}\b", blob, re.I):
            suspicious += 1
            continue

        texts = cit_text_by_source.get(sid, [])
        candidate_years: set[int] = set()
        for t in texts:
            candidate_years.update(_citation_pub_year_candidates(t))
        if candidate_years and y not in candidate_years:
            mismatched_to_citations += 1

    if not year_values:
        findings.append({"severity": "warning", "message": "No source years parsed; year quality uncertain."})
        return 65.0, findings

    total = len(year_values)
    score = _clip(
        100.0
        - (suspicious / total) * 55.0
        - (mismatched_to_citations / total) * 35.0
        - (missing_with_citation_year / max(1, len(sources))) * 20.0
    )
    if suspicious:
        findings.append({"severity": "warning", "message": f"{suspicious}/{total} source years look suspicious."})
    if mismatched_to_citations:
        findings.append(
            {
                "severity": "warning",
                "message": f"{mismatched_to_citations}/{total} source years disagree with citation publication-year evidence.",
            }
        )
    if missing_with_citation_year:
        findings.append(
            {
                "severity": "warning",
                "message": f"{missing_with_citation_year}/{len(sources)} sources are missing years despite citation-year evidence.",
            }
        )
    return score, findings


def _artifact_score(out: dict[str, Any]) -> tuple[float, list[dict[str, str]]]:
    findings: list[dict[str, str]] = []
    artifacts = _collect_artifacts(out)
    if not artifacts:
        return 0.0, [{"severity": "warning", "message": "No artifacts found; extraction likely incomplete."}]

    invalid = 0
    domain_false_positives = 0
    tld_suspicious = 0
    url_hosts: set[str] = set()
    email_domains: set[str] = set()
    domain_vals: list[str] = []

    for a in artifacts:
        at = str(a.get("artifact_type") or "")
        nv = str(a.get("normalized_value") or "")
        v = str(a.get("value") or "")
        target = nv or v

        if at == "url":
            if not URL_RE.match(target) or SUPERSCRIPT_RE.search(target) or "&amp;" in target:
                invalid += 1
            nu = _normalize_url(target)
            if nu is None:
                invalid += 1
            else:
                host = urlparse(nu).hostname
                if host:
                    url_hosts.add(host.lower())
        elif at == "email":
            if not EMAIL_RE.match(target) or SUPERSCRIPT_RE.search(target):
                invalid += 1
            else:
                email_domains.add(target.lower().split("@", 1)[1])
        elif at == "ip":
            if not IPV4_RE.match(target):
                invalid += 1
        elif at == "hash_md5":
            if not re.fullmatch(r"[A-Fa-f0-9]{32}", target):
                invalid += 1
        elif at == "hash_sha1":
            if not re.fullmatch(r"[A-Fa-f0-9]{40}", target):
                invalid += 1
        elif at == "hash_sha256":
            if not re.fullmatch(r"[A-Fa-f0-9]{64}", target):
                invalid += 1
        elif at == "cve":
            if not re.fullmatch(r"CVE-\d{4}-\d{4,}", target, flags=re.I):
                invalid += 1
        elif at == "domain":
            low = target.lower()
            domain_vals.append(low)
            if "/" in low or "?" in low or "=" in low or not DOMAIN_RE.match(target):
                invalid += 1
                domain_false_positives += 1
            elif BAD_DOMAIN_SUFFIX_RE.search(low):
                invalid += 1
                domain_false_positives += 1
            tld = low.rsplit(".", 1)[-1]
            if tld not in COMMON_TLDS:
                invalid += 1
                tld_suspicious += 1
            labels = low.split(".")
            if any((not lab or lab.startswith("-") or lab.endswith("-")) for lab in labels):
                invalid += 1
                domain_false_positives += 1

    standalone_domains = [d for d in domain_vals if d not in url_hosts and d not in email_domains]
    if domain_vals:
        # Very high standalone rate usually indicates token false positives.
        standalone_ratio = len(standalone_domains) / len(domain_vals)
        if standalone_ratio > 0.85 and len(domain_vals) >= 8:
            invalid += max(1, int(len(domain_vals) * 0.08))
            findings.append(
                {
                    "severity": "warning",
                    "message": f"High standalone-domain ratio ({standalone_ratio:.2f}) suggests domain extraction noise.",
                }
            )

    total = len(artifacts)
    score = _clip(100.0 - (invalid / total) * 100.0)
    if invalid:
        findings.append({"severity": "warning", "message": f"{invalid}/{total} artifacts fail normalization/type checks."})
    if domain_false_positives:
        findings.append(
            {
                "severity": "warning",
                "message": f"{domain_false_positives} domain artifacts look like path/file fragments.",
            }
        )
    if tld_suspicious:
        findings.append({"severity": "warning", "message": f"{tld_suspicious} domain artifacts use unusual/invalid TLDs."})
    return score, findings


def _threec_scores(markdown_text: str, out: dict[str, Any]) -> tuple[dict[str, float], list[dict[str, str]]]:
    findings: list[dict[str, str]] = []
    claims = _collect_claims(out)
    if not claims:
        return {
            "chain_grounding": 0.0,
            "credibility_grounding": 0.0,
            "corroboration_grounding": 0.0,
        }, [{"severity": "error", "message": "No claims in stage2_claim_extraction."}]
    markdown_norm = _norm_text(markdown_text)

    chain_claim_scores: list[float] = []
    cred_claim_scores: list[float] = []
    corr_claim_scores: list[float] = []

    for claim in claims:
        chain_penalty = 0.0
        cred_penalty = 0.0
        corr_penalty = 0.0
        cid = str(claim.get("claim_id") or "UNKNOWN")
        stmt = _norm_text(((claim.get("claim_statement") or {}).get("verbatim_text") or ""))
        sixc = claim.get("six_c") or {}
        chain = sixc.get("chain_of_custody") or {}
        cred = sixc.get("credibility") or {}
        corr = sixc.get("corroboration") or {}
        qc = claim.get("quality_checks") or {}
        chain_qc = chain.get("quality_checks") or {}
        cred_qc = cred.get("quality_checks") or {}
        corr_qc = corr.get("quality_checks") or {}

        sources_idx = cred.get("sources_index") or []
        source_ids = {s.get("source_id") for s in sources_idx if isinstance(s, dict)}
        supports = cred.get("sources_supporting_claim") or []
        external_sources = [s for s in sources_idx if isinstance(s, dict) and s.get("source_type") != "internal_document_section"]
        claim_components = [c for c in (claim.get("claim_components_asserted") or []) if isinstance(c, str)]
        evidence_items = chain.get("evidence_items") or []
        artifact_inventory = chain.get("artifact_inventory") or []

        # Chain of custody grounding checks
        if not evidence_items:
            chain_penalty += 20
            findings.append({"severity": "warning", "message": f"{cid}: chain_of_custody.evidence_items is empty."})
        if not artifact_inventory:
            chain_penalty += 10
            findings.append({"severity": "warning", "message": f"{cid}: chain_of_custody.artifact_inventory is empty."})
        chain_anchor_total = 0
        chain_anchor_missing = 0
        chain_duplicate_stmt = 0
        no_identifiers = 0
        for e in evidence_items:
            if not isinstance(e, dict):
                continue
            ids = e.get("artifact_identifiers") or []
            if not isinstance(ids, list) or len(ids) == 0:
                no_identifiers += 1
            for a in (e.get("anchors") or []):
                if not isinstance(a, dict):
                    continue
                chain_anchor_total += 1
                at = _norm_text(str(a.get("verbatim_text") or ""))
                if at and stmt and at == stmt:
                    chain_duplicate_stmt += 1
                if not _anchor_in_markdown(str(a.get("verbatim_text") or ""), markdown_norm):
                    chain_anchor_missing += 1
        if no_identifiers:
            chain_penalty += min(14, no_identifiers * 3)
            findings.append({"severity": "warning", "message": f"{cid}: {no_identifiers}/{max(1,len(evidence_items))} custody evidence items missing artifact_identifiers."})
        if chain_anchor_missing:
            chain_penalty += min(16, chain_anchor_missing * 2)
            findings.append({"severity": "warning", "message": f"{cid}: {chain_anchor_missing}/{max(1,chain_anchor_total)} custody anchors not found in markdown."})
        if chain_anchor_total > 0 and (chain_duplicate_stmt / chain_anchor_total) >= 0.7:
            chain_penalty += 10
            findings.append({"severity": "warning", "message": f"{cid}: custody anchors are mostly claim-text duplicates."})
        if chain_qc.get("has_evidence_items") is True and not evidence_items:
            chain_penalty += 8

        if not sources_idx:
            cred_penalty += 20
            findings.append({"severity": "error", "message": f"{cid}: credibility.sources_index is empty."})

        if not supports:
            cred_penalty += 12
            findings.append({"severity": "warning", "message": f"{cid}: no sources_supporting_claim entries."})

        same_as_claim_anchors = 0
        bad_support_source = 0
        total_support_anchors = 0
        unmatched_support_anchors = 0
        bad_support_components = 0
        support_source_ids = []
        for ss in supports:
            sid = ss.get("source_id")
            if sid not in source_ids:
                bad_support_source += 1
            if isinstance(sid, str):
                support_source_ids.append(sid)
            ss_components = [x for x in (ss.get("supports_components") or []) if isinstance(x, str)]
            for comp in ss_components:
                if claim_components and comp not in claim_components:
                    bad_support_components += 1
            for a in (ss.get("supporting_anchors") or []):
                if not isinstance(a, dict):
                    continue
                total_support_anchors += 1
                at = _norm_text(str(a.get("verbatim_text") or ""))
                if at and stmt and at == stmt:
                    same_as_claim_anchors += 1
                if not _anchor_in_markdown(str(a.get("verbatim_text") or ""), markdown_norm):
                    unmatched_support_anchors += 1
        if bad_support_source:
            cred_penalty += min(20, bad_support_source * 4)
            findings.append({"severity": "error", "message": f"{cid}: {bad_support_source} supporting sources are not in sources_index."})
        if bad_support_components:
            cred_penalty += min(14, bad_support_components * 2)
            findings.append({"severity": "warning", "message": f"{cid}: {bad_support_components} supports_components entries are not in claim_components_asserted."})
        if unmatched_support_anchors:
            cred_penalty += min(16, unmatched_support_anchors * 2)
            findings.append({"severity": "warning", "message": f"{cid}: {unmatched_support_anchors}/{max(1,total_support_anchors)} support anchors not found in markdown."})

        if total_support_anchors > 0:
            ratio = same_as_claim_anchors / total_support_anchors
            if ratio >= 0.6:
                cred_penalty += 18
                findings.append(
                    {
                        "severity": "warning",
                        "message": f"{cid}: {same_as_claim_anchors}/{total_support_anchors} support anchors duplicate claim statement text.",
                    }
                )
                if external_sources:
                    cred_penalty += 10
                    findings.append(
                        {
                            "severity": "warning",
                            "message": f"{cid}: external sources listed but support anchors are mostly claim-text duplicates.",
                        }
                    )
        if external_sources:
            ext_ids = {
                s.get("source_id")
                for s in external_sources
                if isinstance(s, dict) and isinstance(s.get("source_id"), str)
            }
            ext_support_count = sum(1 for sid in support_source_ids if sid in ext_ids)
            if ext_support_count == 0:
                cred_penalty += 8
                findings.append({"severity": "warning", "message": f"{cid}: external sources exist in sources_index but none are used in sources_supporting_claim."})

        matrix = corr.get("corroboration_matrix") or []
        bad_matrix = 0
        missing_components = set(claim_components)
        matrix_anchor_missing = 0
        matrix_anchor_ids: set[str] = set()
        for row in matrix:
            if not isinstance(row, dict):
                continue
            comp = row.get("component")
            if isinstance(comp, str) and comp in missing_components:
                missing_components.discard(comp)
            src_list = row.get("supported_by_source_ids") or []
            src_count = row.get("source_count")
            uniq_count = row.get("unique_source_entity_count")
            if isinstance(src_count, int) and isinstance(src_list, list) and src_count != len(src_list):
                bad_matrix += 1
            if isinstance(src_count, int) and isinstance(uniq_count, int) and uniq_count > src_count:
                bad_matrix += 1
            for a in (row.get("supporting_anchors") or []):
                if not isinstance(a, dict):
                    continue
                aid = str(a.get("anchor_id") or "")
                if aid:
                    matrix_anchor_ids.add(aid)
                if not _anchor_in_markdown(str(a.get("verbatim_text") or ""), markdown_norm):
                    matrix_anchor_missing += 1
        if bad_matrix:
            corr_penalty += min(16, bad_matrix * 2)
            findings.append({"severity": "warning", "message": f"{cid}: {bad_matrix} corroboration rows have inconsistent counts."})
        if missing_components:
            corr_penalty += min(18, len(missing_components) * 5)
            findings.append({"severity": "warning", "message": f"{cid}: corroboration matrix is missing claim components: {', '.join(sorted(missing_components))}."})
        if matrix_anchor_missing:
            corr_penalty += min(12, matrix_anchor_missing * 2)
            findings.append({"severity": "warning", "message": f"{cid}: {matrix_anchor_missing} corroboration anchors not found in markdown."})
        if len(matrix_anchor_ids) <= 1 and len(claim_components) > 1:
            corr_penalty += 8
            findings.append({"severity": "warning", "message": f"{cid}: corroboration uses little anchor diversity across multiple components."})

        # Strict component grounding rule:
        # every asserted claim component should have at least one non-duplicate
        # supporting anchor (not identical to claim statement).
        component_total_anchors: dict[str, int] = {c: 0 for c in claim_components}
        component_nondup_anchors: dict[str, int] = {c: 0 for c in claim_components}
        component_seen_from_matrix: dict[str, bool] = {c: False for c in claim_components}

        def track_component_anchor(comp: str, anchor: dict[str, Any]) -> None:
            if comp not in component_total_anchors:
                return
            text_raw = str(anchor.get("verbatim_text") or "")
            text_norm = _norm_text(text_raw)
            if not text_norm:
                return
            component_total_anchors[comp] += 1
            if text_norm != stmt and _anchor_in_markdown(text_raw, markdown_norm):
                component_nondup_anchors[comp] += 1

        for row in matrix:
            if not isinstance(row, dict):
                continue
            comp = row.get("component")
            if not isinstance(comp, str):
                continue
            for a in (row.get("supporting_anchors") or []):
                if isinstance(a, dict):
                    if comp in component_seen_from_matrix:
                        component_seen_from_matrix[comp] = True
                    track_component_anchor(comp, a)

        # Fallback to sources_supporting_claim only for components that
        # do not appear in corroboration_matrix.
        for ss in supports:
            ss_components = [x for x in (ss.get("supports_components") or []) if isinstance(x, str)]
            if not ss_components:
                continue
            for comp in ss_components:
                if comp in component_seen_from_matrix and component_seen_from_matrix[comp]:
                    continue
                for a in (ss.get("supporting_anchors") or []):
                    if isinstance(a, dict):
                        track_component_anchor(comp, a)

        components_with_no_anchors = [c for c in claim_components if component_total_anchors.get(c, 0) == 0]
        components_without_nondup = [
            c
            for c in claim_components
            if component_total_anchors.get(c, 0) > 0 and component_nondup_anchors.get(c, 0) == 0
        ]
        if components_with_no_anchors:
            corr_penalty += min(24, len(components_with_no_anchors) * 8)
            findings.append(
                {
                    "severity": "error",
                    "message": (
                        f"{cid}: components with no supporting anchors: "
                        f"{', '.join(sorted(components_with_no_anchors))}."
                    ),
                }
            )
        if components_without_nondup:
            corr_penalty += min(20, len(components_without_nondup) * 6)
            findings.append(
                {
                    "severity": "warning",
                    "message": (
                        f"{cid}: components missing non-duplicative support anchors: "
                        f"{', '.join(sorted(components_without_nondup))}."
                    ),
                }
            )

        # quality_check boolean consistency
        if (qc.get("has_sources_index") is True or cred_qc.get("has_sources_index") is True) and not sources_idx:
            cred_penalty += 8
        if (qc.get("has_corroboration_matrix") is True or corr_qc.get("has_corroboration_matrix") is True) and not matrix:
            corr_penalty += 8
        if chain_qc.get("has_artifact_inventory") is True and not artifact_inventory:
            chain_penalty += 6

        chain_claim_scores.append(_clip(100.0 - chain_penalty))
        cred_claim_scores.append(_clip(100.0 - cred_penalty))
        corr_claim_scores.append(_clip(100.0 - corr_penalty))

    return {
        "chain_grounding": sum(chain_claim_scores) / len(chain_claim_scores),
        "credibility_grounding": sum(cred_claim_scores) / len(cred_claim_scores),
        "corroboration_grounding": sum(corr_claim_scores) / len(corr_claim_scores),
    }, findings


def _weights() -> dict[str, float]:
    return {
        "schema": 12.0,
        "integrity": 18.0,
        "tables": 16.0,
        "citations": 18.0,
        "source_years": 12.0,
        "artifacts": 12.0,
        "chain_grounding": 4.0,
        "credibility_grounding": 4.0,
        "corroboration_grounding": 4.0,
    }


def _overall(scores: dict[str, float]) -> float:
    w = _weights()
    return _clip(sum(scores[k] * (w[k] / 100.0) for k in w))


def _render_md(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# Extraction Validation Report")
    lines.append("")
    lines.append(f"- Generated at: `{report['generated_at_utc']}`")
    lines.append(f"- Certification: **{report['certification']}**")
    lines.append(f"- Overall score: **{report['overall_score']:.2f} / 100**")
    if isinstance(report.get("score_adjustments"), dict):
        adj = report["score_adjustments"]
        lines.append(
            f"- Base weighted score: `{adj.get('base_overall_score')}`; "
            f"Issue-density penalty: `-{adj.get('issue_density_penalty')}` "
            f"(warnings={adj.get('warning_count')}, weighted_warnings={adj.get('weighted_warning_sum')}, errors={adj.get('error_count')})"
        )
    lines.append("")
    lines.append("## Category Scores")
    for k, v in report["category_scores"].items():
        lines.append(f"- `{k}`: {v:.2f}")
    lines.append("")
    if report["hard_failures"]:
        lines.append("## Hard Failures")
        for item in report["hard_failures"]:
            lines.append(f"- {item}")
        lines.append("")
    lines.append("## Findings")
    if not report["findings"]:
        lines.append("- None")
    else:
        for f in report["findings"]:
            lines.append(f"- [{f['severity']}] {f['message']}")
    lines.append("")
    lines.append("## Thresholds")
    lines.append(f"- Minimum overall score: `{report['thresholds']['min_overall_score']}`")
    lines.append(f"- Minimum category score: `{report['thresholds']['min_category_score']}`")
    return "\n".join(lines) + "\n"


def _warning_weight(message: str) -> float:
    msg = (message or "").lower()
    if "fail normalization/type checks" in msg:
        return 1.8
    if "have normalization issues" in msg:
        return 1.6
    if "not found in markdown" in msg:
        return 1.6
    if "look suspicious" in msg and "source years" in msg:
        return 1.5
    if "truncated versus markdown row counts" in msg:
        return 1.3
    if "inconsistent row widths" in msg:
        return 1.2
    if "verbatim-only fallbacks" in msg:
        return 1.2
    if "domain artifacts use unusual/invalid tlds" in msg:
        return 1.2
    if "duplicate claim statement text" in msg:
        return 1.0
    if "external sources exist in sources_index but none are used" in msg:
        return 0.4
    if "corroboration uses little anchor diversity" in msg:
        return 0.5
    if "components missing non-duplicative support anchors" in msg:
        return 1.8
    if "components with no supporting anchors" in msg:
        return 2.2
    return 0.9


def run(args: argparse.Namespace) -> int:
    schema_path = Path(args.schema).expanduser().resolve()
    markdown_path = Path(args.markdown).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    report_json_path = Path(args.report_json).expanduser().resolve()
    report_md_path = Path(args.report_md).expanduser().resolve()

    schema = json.loads(schema_path.read_text(encoding="utf-8"))["schema"]
    markdown_text = markdown_path.read_text(encoding="utf-8", errors="replace")
    out = json.loads(output_path.read_text(encoding="utf-8"))

    findings: list[dict[str, str]] = []
    hard_failures: list[str] = []

    schema_ok, schema_msg = _check_schema(schema, out)
    schema_score = 100.0 if schema_ok else 0.0
    if not schema_ok:
        hard_failures.append(f"Schema validation failed: {schema_msg}")
        findings.append({"severity": "error", "message": f"Schema validation failed: {schema_msg}"})

    integrity_score, integrity_findings = _integrity_score(markdown_text, out)
    findings.extend(integrity_findings)

    table_score, table_findings = _table_score(markdown_text, out)
    findings.extend(table_findings)

    citation_score, citation_findings = _citation_score(markdown_text, out)
    findings.extend(citation_findings)

    source_year_score, source_year_findings = _source_year_score(out)
    findings.extend(source_year_findings)

    artifact_score, artifact_findings = _artifact_score(out)
    findings.extend(artifact_findings)

    threec_scores, threec_findings = _threec_scores(markdown_text, out)
    findings.extend(threec_findings)

    category_scores = {
        "schema": schema_score,
        "integrity": integrity_score,
        "tables": table_score,
        "citations": citation_score,
        "source_years": source_year_score,
        "artifacts": artifact_score,
        "chain_grounding": float(threec_scores.get("chain_grounding", 0.0)),
        "credibility_grounding": float(threec_scores.get("credibility_grounding", 0.0)),
        "corroboration_grounding": float(threec_scores.get("corroboration_grounding", 0.0)),
    }

    base_overall_score = _overall(category_scores)
    warning_messages = [str(f.get("message") or "") for f in findings if str(f.get("severity")).lower() == "warning"]
    warning_count = len(warning_messages)
    error_count = sum(1 for f in findings if str(f.get("severity")).lower() == "error")
    weighted_warning_sum = sum(_warning_weight(msg) for msg in warning_messages)
    claim_count = len(_collect_claims(out))
    source_count = len(_collect_sources(out))
    citation_count = len(_collect_citations(out))
    # Penalize issue-heavy outputs while normalizing by claim volume so repeated
    # per-claim warnings do not overwhelm larger documents.
    warning_norm_factor = 1.0 + (0.60 * max(0, claim_count - 1))
    normalized_weighted_warnings = weighted_warning_sum / warning_norm_factor
    issue_density_penalty = min(22.0, normalized_weighted_warnings + error_count * 2.2)
    overall_score = _clip(base_overall_score - issue_density_penalty)

    min_overall = float(args.min_score)
    min_category = float(args.min_category_score)
    sparse_evidence_context = source_count <= 1 and citation_count == 0
    low_categories = [k for k, v in category_scores.items() if v < min_category]
    if sparse_evidence_context:
        # In sparse-evidence contexts (single-source / no citations), do not hard-fail
        # solely on 3C grounding categories; keep the scores visible and findings actionable.
        low_categories = [
            k for k in low_categories
            if k not in {"chain_grounding", "credibility_grounding", "corroboration_grounding"}
        ]
    if low_categories:
        hard_failures.append(f"Categories below threshold {min_category}: {', '.join(low_categories)}")
    critical = [k for k in ("integrity", "citations") if category_scores.get(k, 100.0) < 50.0]
    if critical:
        hard_failures.append(f"Critical quality gate failed (<50): {', '.join(critical)}")

    certified = schema_ok and not hard_failures and overall_score >= min_overall
    certification = "PASS" if certified else "FAIL"

    report = {
        "generated_at_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "inputs": {
            "schema": str(schema_path),
            "markdown": str(markdown_path),
            "output": str(output_path),
        },
        "certification": certification,
        "overall_score": round(overall_score, 4),
        "score_adjustments": {
            "base_overall_score": round(base_overall_score, 4),
            "issue_density_penalty": round(issue_density_penalty, 4),
            "weighted_warning_sum": round(weighted_warning_sum, 4),
            "normalized_weighted_warning_sum": round(normalized_weighted_warnings, 4),
            "warning_normalization_factor": round(warning_norm_factor, 4),
            "warning_count": warning_count,
            "error_count": error_count,
        },
        "category_scores": {k: round(v, 4) for k, v in category_scores.items()},
        "thresholds": {
            "min_overall_score": min_overall,
            "min_category_score": min_category,
        },
        "hard_failures": hard_failures,
        "findings": findings,
        "summary_counts": {
            "pages": len(_iter_pages(out)),
            "tables": len(_collect_tables(out)),
            "citations": len(_collect_citations(out)),
            "artifacts": len(_collect_artifacts(out)),
            "claims": len(_collect_claims(out)),
            "sources": len(_collect_sources(out)),
        },
        "validation_context": {
            "sparse_evidence_context": sparse_evidence_context,
            "sparse_evidence_rule": "source_count<=1 and citation_count==0",
        },
    }

    report_json_path.parent.mkdir(parents=True, exist_ok=True)
    report_json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    report_md_path.parent.mkdir(parents=True, exist_ok=True)
    report_md_path.write_text(_render_md(report), encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if certified else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and score markdown extraction quality.")
    parser.add_argument("--schema", default=DEFAULT_SCHEMA, help="Path to schema wrapper JSON.")
    parser.add_argument("--markdown", default=DEFAULT_MARKDOWN, help="Path to source markdown.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Path to extracted output JSON.")
    parser.add_argument("--report-json", default=DEFAULT_REPORT_JSON, help="Path to write machine-readable validation report.")
    parser.add_argument("--report-md", default=DEFAULT_REPORT_MD, help="Path to write human-readable validation report.")
    parser.add_argument("--min-score", type=float, default=85.0, help="Minimum overall score required for PASS.")
    parser.add_argument("--min-category-score", type=float, default=60.0, help="Minimum per-category score required for PASS.")
    args = parser.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
