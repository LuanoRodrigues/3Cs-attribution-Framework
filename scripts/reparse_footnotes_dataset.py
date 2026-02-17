#!/usr/bin/env python3
"""
Re-run footnote/reference linking across dataset documents.

Supported dataset inputs:
- Cached `process_pdf` outputs stored as `.md` JSON files (with `full_text` and
  optional `pages_text`, `references`, `citations`).
- Raw OCR payloads stored as `.json` files (Mistral batch shape with page
  markdown).

For each file, this script rebuilds a single markdown document, re-runs
`link_citations_to_footnotes`, and writes a compact before/after report.
"""

from __future__ import annotations

import argparse
import contextlib
import html
import importlib.util
import io
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple


STYLE_TEX = "tex"
STYLE_NUMERIC = "numeric"
STYLE_AUTHOR = "author_year"
STYLE_HYBRID = "hybrid"
STYLE_UNKNOWN = "unknown"

STATS_KEYS = (
    "intext_total",
    "success_occurrences",
    "success_unique",
    "bib_unique_total",
    "occurrence_match_rate",
    "bib_coverage_rate",
    "success_percentage",
    "missing_intext_expected_total",
    "highest_intext_index",
    "missing_footnotes_for_seen_total",
    "uncited_footnote_total",
    "style",
)

# Reused from data_processing.py (clean_hein_header)
PATTERN_HEIN_1 = re.compile(
    r'^\s*(?:\*{2}\s*)?["“”]?\s*DATE\s+DOWNLOADED:.*?PinCite\s+this\s+document\s*',
    re.IGNORECASE | re.DOTALL | re.MULTILINE,
)
PATTERN_HEIN_2 = re.compile(
    r'^\s*(?:#\s*)?Citations:\s*.*?PinCite\s+this\s+document\s*',
    re.IGNORECASE | re.DOTALL | re.MULTILINE,
)
PATTERN_HEIN_3 = re.compile(
    r'^\s*["“”]?\s*DATE\s+DOWNLOADED:.*?(?:^|\n)\s*Copyright\s+Information\b.*?(?:\n|$)',
    re.IGNORECASE | re.DOTALL | re.MULTILINE,
)

# Reused from data_processing.py (reference/endnotes extraction)
REFERENCE_HEADING_RE = re.compile(
    r"""(?mix)
    ^\s*
    \#{1,6}
    [ \t]*
    (?:\d+\.\s*)?
    [_*]*
    \b(?:references|reference|bibliography|works\s+cited|sources|notes|selected\s+bibliography)\b
    [^ \t\n]*
    .*
    """
)
ENDNOTES_HEADING_RE = re.compile(r"(?mi)^\s*#{1,6}\s*endnotes\b")

# Validator signal regexes
SUP_IN_TEXT_RE = re.compile(r"<sup>\s*\d+\s*</sup>|[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]{1,8}")
SUP_DEF_LINE_RE = re.compile(
    r"(?m)^\s*(?:<sup>\s*\d+\s*</sup>|[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]{1,8})\s+\S+"
)
NUMERIC_BRACKET_RE = re.compile(
    r"\[\s*\d+(?:\s*[-–]\s*\d+)?(?:\s*[,;]\s*\d+(?:\s*[-–]\s*\d+)?)*\s*\]"
)
NUMERIC_ENDNOTE_LINE_RE = re.compile(r"(?m)^\s*\d{1,4}\.\s+\S+")
AUTHOR_YEAR_RE = re.compile(r"\([A-Z][A-Za-z'`.-]+(?:\s+et al\.)?,\s*\d{4}[a-z]?\)")
HEADING_RE = re.compile(r"(?m)^\s*(#{1,6})\s+(.+?)\s*$")
HEX_HASH_STEM_RE = re.compile(r"^[0-9a-f]{64}$")

# Metadata extraction regexes
MD_HEADING_LINE_RE = re.compile(r"^\s*#{1,6}\s+(.+?)\s*$")
MD_INLINE_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
MD_INLINE_FMT_RE = re.compile(r"[*_`~]")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b", re.I)
ORCID_RE = re.compile(r"\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b", re.I)
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.I)
ISSN_RE = re.compile(r"\bISSN[:\s]*\d{4}-\d{3}[\dX]\b", re.I)
ISBN_RE = re.compile(r"\bISBN(?:-1[03])?[:\s]*97[89][-\s]?\d[-\s]?\d{2,5}[-\s]?\d{2,7}[-\s]?\d{1,7}[-\s]?[\dX]\b", re.I)
ARXIV_RE = re.compile(r"\barXiv:\s*\d{4}\.\d{4,5}(?:v\d+)?\b", re.I)
PMID_RE = re.compile(r"\bPMID[:\s]*\d+\b", re.I)
PMCID_RE = re.compile(r"\bPMCID[:\s]*PMC\d+\b", re.I)
URL_RE = re.compile(r"\b(?:https?://|www\.)\S+\b", re.I)
YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")

ABSTRACT_HEAD_RE = re.compile(r"(?im)^\s*#{1,6}\s*(?:abstract|summary)\b")
KEYWORDS_HEAD_RE = re.compile(r"(?im)^\s*#{1,6}\s*(?:keywords|key words|index terms)\b")
INTRO_HEAD_RE = re.compile(r"(?im)^\s*#{1,6}\s*(?:\d+(?:\.\d+)*\s*[.)-]?\s*)?introduction\b")

AUTHOR_NAME_RE = re.compile(
    r"^[A-Z][A-Za-z'`.\-]+(?:\s+[A-Z][A-Za-z'`.\-]+){1,5}$"
)

AFFILIATION_HINTS = (
    "university",
    "institute",
    "institution",
    "department",
    "faculty",
    "school",
    "college",
    "academy",
    "laboratory",
    "centre",
    "center",
    "hospital",
    "research group",
    "research center",
    "research centre",
    "ministry",
)

VENUE_HINTS = (
    "journal",
    "proceedings",
    "conference",
    "review",
    "transactions",
    "press",
)

DOC_TYPE_HINTS = {
    "journal_article": ("journal", "review", "letters"),
    "conference_paper": ("conference", "proceedings", "workshop", "symposium"),
    "thesis": ("thesis", "dissertation"),
    "book_chapter": ("chapter", "in:", "edited by"),
    "report": ("report", "white paper", "working paper"),
    "preprint": ("preprint", "arxiv"),
}

BAD_AUTHOR_LINE_HINTS = (
    "volume",
    "number",
    "issue",
    "journal",
    "review",
    "proceedings",
    "conference",
    "copyright",
    "published",
    "doi",
    "available at",
    "http://",
    "https://",
    "www.",
    "country in focus",
)

BAD_AUTHOR_TOKENS = {
    "volume",
    "number",
    "issue",
    "journal",
    "review",
    "studies",
    "article",
    "paper",
    "technical",
    "cyber",
    "neutrality",
    "international",
    "law",
    "army",
    "navy",
    "center",
    "centre",
    "focus",
    "years",
    "after",
    "introduction",
    "conclusion",
    "chapter",
    "contents",
    "table",
    "vol",
    "volume",
    "part",
    "section",
    "appendix",
    "list",
    "figures",
    "article",
    "note",
    "operations",
    "analysis",
    "model",
    "models",
    "state",
    "obligations",
    "internationally",
    "dean",
    "director",
    "resident",
    "programs",
    "advisor",
    "advisor",
    "brigadier",
    "general",
    "papers",
    "staff",
    "college",
    "school",
    "university",
    "lawyer",
    "judge",
    "advocate",
    "author",
    "authors",
    "editor",
    "editors",
    "department",
    "institute",
    "center",
    "centre",
    "manager",
    "officer",
    "command",
    "force",
    "base",
    "publication",
    "publications",
    "specialist",
}

PARTIAL_TITLE_RE = re.compile(
    r"(?i)^\s*(?:table of contents|contents|i\.\s*introduction|introduction|chapter\s+\d+|section\s+\d+)\b"
)
TOC_DOTS_LINE_RE = re.compile(r"(?m)^[^\n]{0,140}\.{3,}\s*\d+\s*$")


def clean_hein_header(text: str) -> str:
    cleaned = text
    if PATTERN_HEIN_3.search(cleaned):
        cleaned = PATTERN_HEIN_3.sub("", cleaned, count=1)
    elif PATTERN_HEIN_1.search(cleaned):
        cleaned = PATTERN_HEIN_1.sub("", cleaned, count=1)
    elif PATTERN_HEIN_2.search(cleaned):
        cleaned = PATTERN_HEIN_2.sub("", cleaned, count=1)
    return re.sub(r"^\s*\n+", "", cleaned, flags=re.MULTILINE)


def strip_markdown_images(text: str) -> str:
    return re.sub(r"!\[.*?\]\(.*?\)", "", text)


def extract_references_from_md(md: str, first_page_end: int = 0) -> Tuple[str, List[str]]:
    refs: List[str] = []
    ref_match = next((m for m in REFERENCE_HEADING_RE.finditer(md) if m.start() > first_page_end), None)
    if ref_match is None:
        ref_match = next((m for m in ENDNOTES_HEADING_RE.finditer(md) if m.start() > first_page_end), None)

    if ref_match is None:
        return md, refs

    refs.append(md[ref_match.start() :].strip())
    return md[: ref_match.start()].rstrip(), refs


def load_linker(repo_root: Path) -> Callable[[str, Any], Dict[str, Any]]:
    parser_path = repo_root / "python_backend_legacy" / "llms" / "footnotes_parser.py"
    if not parser_path.exists():
        raise FileNotFoundError(f"Parser file not found: {parser_path}")

    spec = importlib.util.spec_from_file_location("footnotes_parser_runtime", parser_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load parser module from {parser_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    fn = getattr(module, "link_citations_to_footnotes", None)
    if not callable(fn):
        raise RuntimeError("`link_citations_to_footnotes` not found in footnotes_parser.py")
    return fn


def sorted_files(
    dataset_dir: Path,
    include_md: bool,
    include_json: bool,
    limit: int | None,
    hash_only: bool,
) -> List[Path]:
    files: List[Path] = []
    if include_md:
        files.extend(sorted(dataset_dir.glob("*.md")))
    if include_json:
        files.extend(sorted(dataset_dir.glob("*.json")))
    if hash_only:
        files = [p for p in files if HEX_HASH_STEM_RE.fullmatch(p.stem or "")]
    if limit is not None and limit > 0:
        files = files[:limit]
    return files


def normalize_references(refs: Any) -> List[str]:
    if not isinstance(refs, list):
        return []
    out: List[str] = []
    for item in refs:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
    return out


def text_pages_from_md_cache(obj: Dict[str, Any]) -> List[str]:
    pages = obj.get("pages_text")
    if not isinstance(pages, list):
        return []

    out: List[str] = []
    for i, page in enumerate(pages):
        if isinstance(page, str):
            text = page.strip()
            if text:
                out.append(text)
            continue
        if isinstance(page, dict):
            text = str(page.get("markdown") or page.get("text") or "").strip()
            if text:
                out.append(text)
            continue
        _ = i  # keep loop shape explicit
    return out


def text_pages_from_raw_json(obj: Dict[str, Any]) -> List[str]:
    pages_payload: Any = None

    response = obj.get("response")
    if isinstance(response, dict):
        inner = response.get("response")
        if isinstance(inner, dict):
            body = inner.get("body")
            if isinstance(body, dict):
                pages_payload = body.get("pages")

    if pages_payload is None and isinstance(obj.get("pages"), list):
        pages_payload = obj.get("pages")

    ordered: List[Tuple[int, int, str]] = []
    if isinstance(pages_payload, list):
        for order, page in enumerate(pages_payload):
            if isinstance(page, str):
                text = page.strip()
                if text:
                    ordered.append((order, order, text))
                continue
            if not isinstance(page, dict):
                continue
            text = str(page.get("markdown") or page.get("text") or "").strip()
            if not text:
                continue
            idx = page.get("index")
            page_idx = idx if isinstance(idx, int) else order
            ordered.append((page_idx, order, text))

    if ordered:
        ordered.sort(key=lambda x: (x[0], x[1]))
        return [text for _, _, text in ordered]

    markdown = obj.get("markdown")
    if isinstance(markdown, str) and markdown.strip():
        return [markdown.strip()]

    return []


def rebuild_single_document(pages: List[str]) -> Tuple[str, List[str]]:
    clean_pages = [p.strip() for p in pages if isinstance(p, str) and p.strip()]
    if not clean_pages:
        return "", []

    full_md = "\n\n".join(clean_pages)
    full_md = strip_markdown_images(full_md)
    full_md = clean_hein_header(full_md)
    first_page_end = len(clean_pages[0]) if clean_pages else 0
    return extract_references_from_md(full_md, first_page_end)


def style_to_bucket(style: Any) -> str:
    style_s = str(style or "").strip().lower()
    if style_s == "numeric":
        return STYLE_NUMERIC
    if style_s == "author_year":
        return STYLE_AUTHOR
    if style_s in {"tex_superscript", "hybrid", "superscript", "tex_default", "default", "tex"}:
        return STYLE_TEX
    return STYLE_UNKNOWN


def as_number(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def normalize_stats(stats: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {key: 0 for key in STATS_KEYS if key != "style"}
    out["style"] = None
    if not isinstance(stats, dict):
        return out

    for key in STATS_KEYS:
        if key not in stats:
            continue
        if key == "style":
            out[key] = stats.get(key)
            continue
        out[key] = as_number(stats.get(key))
    return out


def summarize_link_output(link_out: Any) -> Dict[str, Any]:
    if not isinstance(link_out, dict):
        empty = normalize_stats(None)
        return {
            "style": STYLE_UNKNOWN,
            "dominant_bucket": STYLE_UNKNOWN,
            "dominant": empty,
            "buckets": {
                "footnotes": empty,
                STYLE_TEX: empty,
                STYLE_NUMERIC: empty,
                STYLE_AUTHOR: empty,
            },
        }

    footnotes_stats = normalize_stats((link_out.get("footnotes") or {}).get("stats"))
    tex_stats = normalize_stats((link_out.get("tex") or {}).get("total"))
    numeric_stats = normalize_stats((link_out.get("numeric") or {}).get("total"))
    author_stats = normalize_stats((link_out.get("author_year") or {}).get("total"))

    buckets = {
        "footnotes": footnotes_stats,
        STYLE_TEX: tex_stats,
        STYLE_NUMERIC: numeric_stats,
        STYLE_AUTHOR: author_stats,
    }

    style = str(link_out.get("style") or STYLE_UNKNOWN)
    dominant_bucket = style_to_bucket(style)
    if dominant_bucket == STYLE_UNKNOWN:
        ranked = sorted(
            (STYLE_TEX, STYLE_NUMERIC, STYLE_AUTHOR),
            key=lambda k: buckets[k].get("success_occurrences", 0),
            reverse=True,
        )
        dominant_bucket = ranked[0]

    return {
        "style": style,
        "dominant_bucket": dominant_bucket,
        "dominant": buckets.get(dominant_bucket, normalize_stats(None)),
        "buckets": buckets,
    }


def ratio(n: float, d: float) -> float:
    return (n / d) if d else 0.0


def nonempty_text(v: Any) -> bool:
    return isinstance(v, str) and bool(v.strip())


def get_bucket_results(link_out: Any, bucket: str) -> List[Dict[str, Any]]:
    if not isinstance(link_out, dict):
        return []

    if bucket == "footnotes":
        data = (link_out.get("footnotes") or {}).get("intext")
        return [x for x in data if isinstance(x, dict)] if isinstance(data, list) else []

    data = (link_out.get(bucket) or {}).get("results")
    return [x for x in data if isinstance(x, dict)] if isinstance(data, list) else []


def summarize_results_quality(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    total = len(results)
    if total == 0:
        return {
            "intext_total": 0,
            "index_coverage": 0.0,
            "intext_citation_coverage": 0.0,
            "preceding_text_coverage": 0.0,
            "footnote_coverage": 0.0,
            "unique_index_count": 0,
        }

    has_index = 0
    has_citation = 0
    has_preceding = 0
    has_footnote = 0
    unique_indices = set()

    for row in results:
        idx = str(row.get("index", "")).strip()
        if idx:
            has_index += 1
            unique_indices.add(idx)
        if nonempty_text(row.get("intext_citation")):
            has_citation += 1
        if nonempty_text(row.get("preceding_text")):
            has_preceding += 1
        if nonempty_text(row.get("footnote")):
            has_footnote += 1

    return {
        "intext_total": total,
        "index_coverage": ratio(has_index, total),
        "intext_citation_coverage": ratio(has_citation, total),
        "preceding_text_coverage": ratio(has_preceding, total),
        "footnote_coverage": ratio(has_footnote, total),
        "unique_index_count": len(unique_indices),
    }


def detect_style_signals(text: str) -> Dict[str, Any]:
    return {
        "superscript_hits": len(SUP_IN_TEXT_RE.findall(text or "")),
        "superscript_definition_lines": len(SUP_DEF_LINE_RE.findall(text or "")),
        "numeric_bracket_hits": len(NUMERIC_BRACKET_RE.findall(text or "")),
        "numeric_endnote_lines": len(NUMERIC_ENDNOTE_LINE_RE.findall(text or "")),
        "author_year_hits": len(AUTHOR_YEAR_RE.findall(text or "")),
    }


def recommend_style_from_signals(signals: Dict[str, Any], references_count: int) -> str:
    sup_hits = int(signals.get("superscript_hits", 0))
    sup_defs = int(signals.get("superscript_definition_lines", 0))
    num_hits = int(signals.get("numeric_bracket_hits", 0))
    num_defs = int(signals.get("numeric_endnote_lines", 0))
    ay_hits = int(signals.get("author_year_hits", 0))

    if sup_defs >= 3 and sup_hits >= 10:
        return "superscript"
    if num_hits >= 10 and ay_hits >= 10:
        return STYLE_HYBRID
    if num_hits >= 10 and (num_defs >= 5 or references_count > 0):
        return STYLE_NUMERIC
    if ay_hits >= 10:
        return STYLE_AUTHOR
    return STYLE_UNKNOWN


def style_alignment(detected: str, recommended: str) -> bool:
    detected_norm = str(detected or "").strip().lower()
    allowed = {
        "superscript": {"superscript", STYLE_HYBRID, STYLE_TEX, "tex_superscript"},
        STYLE_NUMERIC: {STYLE_NUMERIC, STYLE_HYBRID},
        STYLE_AUTHOR: {STYLE_AUTHOR, STYLE_HYBRID},
        STYLE_HYBRID: {STYLE_HYBRID, STYLE_NUMERIC, STYLE_AUTHOR, "superscript", "tex_superscript"},
        STYLE_UNKNOWN: set(),
    }
    if recommended == STYLE_UNKNOWN:
        return True
    return detected_norm in allowed.get(recommended, {recommended})


def validate_heading_structure(full_text: str, references: List[str]) -> Dict[str, Any]:
    combined = (full_text or "") + ("\n\n" + "\n\n".join(references) if references else "")
    headings = []
    for m in HEADING_RE.finditer(combined):
        level = len(m.group(1))
        title = m.group(2).strip()
        headings.append((level, title))

    level_jump_violations = 0
    prev_level = None
    for level, _ in headings:
        if prev_level is not None and level > prev_level + 1:
            level_jump_violations += 1
        prev_level = level

    numbered = set()
    parent_violations = 0
    for _, title in headings:
        m = re.match(r"^\s*(\d+(?:\.\d+)+)\b", title)
        if not m:
            continue
        token = m.group(1)
        numbered.add(token)

    for tok in sorted(numbered, key=lambda s: (s.count("."), s)):
        parts = tok.split(".")
        for i in range(1, len(parts)):
            parent = ".".join(parts[:i])
            if parent not in numbered:
                parent_violations += 1
                break

    has_reference_heading = bool(REFERENCE_HEADING_RE.search(combined) or ENDNOTES_HEADING_RE.search(combined))
    has_subheadings = any(level > 1 for level, _ in headings) or bool(numbered)

    return {
        "heading_count": len(headings),
        "max_heading_level": max((lvl for lvl, _ in headings), default=0),
        "level_jump_violations": level_jump_violations,
        "numbering_parent_violations": parent_violations,
        "has_reference_heading": has_reference_heading,
        "has_subheadings": has_subheadings,
    }


def clean_md_inline(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    s = text.strip()
    if not s:
        return ""
    s = html.unescape(s)
    s = MD_INLINE_LINK_RE.sub(r"\1", s)
    s = MD_INLINE_FMT_RE.sub("", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def dedupe_keep_order(values: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        v = value.strip()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def dedupe_authors(values: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        v = normalize_name_candidate(value)
        if not v:
            continue
        key = re.sub(r"[^a-z0-9]+", "", v.lower())
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(v)
    return out


def normalize_heading_label(title: str) -> str:
    t = clean_md_inline(title).lower()
    t = re.sub(r"^\d+(?:\.\d+)*\s*[.)-]?\s*", "", t)
    t = re.sub(r"\s+", " ", t).strip(" :.-")
    return t


def strip_superscript_like(text: str) -> str:
    return re.sub(r"[\u00B9\u00B2\u00B3\u2070-\u2079\u2080-\u2089]", "", text or "")


def looks_like_person_name(text: str) -> bool:
    s = clean_md_inline(strip_superscript_like(text))
    if not s:
        return False
    s = re.sub(r"^\s*(?:by|author[s]?)\s+", "", s, flags=re.I)
    s = re.sub(r"[*†‡§¶]+", "", s)
    s = re.sub(r"\b(maj(or)?|capt(ain)?|lt\.?|col(?:onel)?|dr\.?|prof\.?)\s+", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" ,;:-")
    if not s:
        return False
    if AUTHOR_NAME_RE.fullmatch(s):
        return True
    tokens = [t for t in re.split(r"\s+", s) if t]
    if len(tokens) < 2 or len(tokens) > 5:
        return False
    lower_tokens = [re.sub(r"[^a-z]+", "", t.lower()) for t in tokens]
    lower_tokens = [t for t in lower_tokens if t]
    if any(t in BAD_AUTHOR_TOKENS for t in lower_tokens):
        return False
    score = 0
    for tok in tokens:
        core = re.sub(r"[^A-Za-z.']", "", tok)
        if not core:
            continue
        if re.fullmatch(r"[A-Z]\.", core):
            score += 1
            continue
        if core[0].isupper() and core[1:].lower() == core[1:]:
            score += 1
            continue
        if core.isupper() and 2 <= len(core) <= 12:
            score += 1
    return score >= max(2, len(tokens) - 1)


def parse_markdown_sections(md_text: str) -> List[Tuple[int, str, str]]:
    sections: List[Tuple[int, str, str]] = []
    current_level = 0
    current_title = ""
    buf: List[str] = []

    for line in (md_text or "").splitlines():
        m = re.match(r"^\s*(#{1,6})\s+(.+?)\s*$", line)
        if m:
            if current_title:
                sections.append((current_level, current_title, "\n".join(buf).strip()))
            current_level = len(m.group(1))
            current_title = clean_md_inline(m.group(2))
            buf = []
        else:
            if current_title:
                buf.append(line)
    if current_title:
        sections.append((current_level, current_title, "\n".join(buf).strip()))
    return sections


def section_text_by_alias(sections: List[Tuple[int, str, str]], aliases: List[str]) -> str:
    alias_set = {a.strip().lower() for a in aliases if a.strip()}
    for _, title, body in sections:
        norm = normalize_heading_label(title)
        if norm in alias_set:
            return body.strip()
        for alias in alias_set:
            if norm.startswith(alias + " "):
                return body.strip()
    return ""


def front_matter_slice(full_text: str, max_chars: int = 4000) -> str:
    text = full_text or ""
    starts: List[int] = []
    for rgx in (ABSTRACT_HEAD_RE, KEYWORDS_HEAD_RE, INTRO_HEAD_RE):
        m = rgx.search(text)
        if m:
            starts.append(m.start())
    if starts:
        return text[: min(starts)]
    return text[:max_chars]


def normalize_name_candidate(name: str) -> str:
    n = clean_md_inline(strip_superscript_like(name))
    if not n:
        return ""
    if re.search(r"(?i)\b(?:ll\.?\s*m|j\.?\s*d|ph\.?\s*d|m\.?\s*a|b\.?\s*a)\b", n):
        return ""
    n = re.sub(r"^\s*(?:by|author[s]?)\s+", "", n, flags=re.I)
    n = re.sub(r"^\s*[A-Z]{2,4}\.\s+", "", n)
    n = re.sub(r"^\s*(?:maj(?:or)?|capt(?:ain)?|lt\.?|col(?:onel)?|dr\.?|prof\.?)\s+", "", n, flags=re.I)
    n = re.sub(r"[*†‡§¶]+", "", n)
    n = re.sub(r"\(\s*\d+\s*\)", "", n)
    n = re.sub(r"\b\d{1,2}$", "", n).strip(" ,;:-")
    n = re.sub(r"\s+", " ", n).strip()
    if not n:
        return ""
    low = n.lower()
    blocked = (
        "abstract",
        "keywords",
        "journal",
        "copyright",
        "doi",
        "published",
        "university",
        "department",
        "https://",
        "http://",
        "available at",
    )
    if any(tok in low for tok in blocked):
        return ""
    tokens = [re.sub(r"[^A-Za-z]+", "", t).lower() for t in n.split()]
    tokens = [t for t in tokens if t]
    if len(tokens) < 2 or len(tokens) > 5:
        return ""
    if any(t in BAD_AUTHOR_TOKENS for t in tokens):
        return ""
    if all(t.isupper() and len(t) > 1 for t in n.split()) and len(tokens) > 4:
        return ""
    if not AUTHOR_NAME_RE.fullmatch(n):
        if not looks_like_person_name(n):
            return ""
    return n


def extract_authors_from_line(line: str) -> List[str]:
    raw = clean_md_inline(strip_superscript_like(line))
    if not raw or len(raw) > 220:
        return []
    low = raw.lower()
    if "@" in raw or "http" in low or "doi" in low:
        return []
    if any(h in low for h in BAD_AUTHOR_LINE_HINTS):
        return []
    if "..." in raw:
        return []
    if ":" in raw and "by " not in low:
        return []
    if re.search(r"(?i)\b(?:ll\.?\s*m|j\.?\s*d|ph\.?\s*d|b\.?\s*a|m\.?\s*a)\b", raw):
        return []
    if sum(ch.isdigit() for ch in raw) > 2:
        return []
    token_count = len(raw.split())
    if token_count < 2 or token_count > 7:
        return []
    if len(re.findall(r"\b[A-Z][A-Za-z'`.\-]+\b", raw)) < 2 and not looks_like_person_name(raw):
        return []
    if re.search(r"\b(?:introduction|conclusion|contents|chapter|section|table of contents|appendix)\b", low):
        return []

    split_src = re.sub(r"\s+(?:and|&)\s+", ",", raw, flags=re.I)
    parts = [p.strip() for p in re.split(r"[,;/]|(?:\s{2,})", split_src) if p.strip()]
    out: List[str] = []
    for part in parts:
        n = normalize_name_candidate(part)
        if n:
            out.append(n)
    return dedupe_authors(out)


def extract_authors_from_front_matter(front_matter: str, title: str = "") -> List[str]:
    out: List[str] = []
    lines = (front_matter or "").splitlines()
    title_tokens = {_norm_token(x) for x in re.findall(r"[A-Za-z]+", title or "")}
    title_tokens = {x for x in title_tokens if x}
    for line in lines[:40]:
        heading_m = re.match(r"^\s*(#{1,6})\s+(.+?)\s*$", line)
        if heading_m:
            level = len(heading_m.group(1))
            clean_line = clean_md_inline(heading_m.group(2))
            if level == 1 and not looks_like_person_name(clean_line):
                continue
        else:
            clean_line = clean_md_inline(line)
        if not clean_line:
            continue
        low_line = clean_line.lower()
        if any(x in low_line for x in ("table of contents", "contents", "i. introduction", "1. introduction")):
            break
        if TOC_DOTS_LINE_RE.search(clean_line):
            break
        if title:
            line_tokens = {_norm_token(x) for x in re.findall(r"[A-Za-z]+", clean_line)}
            line_tokens = {x for x in line_tokens if x}
            overlap = len(line_tokens & title_tokens)
            if title_tokens and ratio(overlap, len(title_tokens)) >= 0.7:
                continue
        names = extract_authors_from_line(clean_line)
        if names:
            out.extend(names)
            if len(out) >= 8:
                break
            continue
        by_m = re.match(r"(?i)^\s*by\s+(.+?)\s*$", clean_line)
        if by_m:
            names = extract_authors_from_line(by_m.group(1))
            if names:
                out.extend(names)
                if len(out) >= 8:
                    break
    return dedupe_keep_order(out)


def extract_affiliations(front_matter: str) -> List[str]:
    out: List[str] = []
    for line in (front_matter or "").splitlines()[:180]:
        s = clean_md_inline(line)
        if not s or len(s) < 10 or len(s) > 260:
            continue
        low = s.lower()
        if "@" in s:
            continue
        if any(
            x in low
            for x in (
                "http://",
                "https://",
                "available at",
                "quoted in",
                "remarks by",
                "thoughts and opinions",
                "not necessarily",
                "u.s. government",
            )
        ):
            continue
        if any(hint in low for hint in AFFILIATION_HINTS):
            s = re.sub(r"^\s*(?:\d{1,2}|[*†‡]+)[\).:\-]?\s*", "", s)
            out.append(s)
    return dedupe_keep_order(out)


def infer_document_type(front_matter: str, full_text: str) -> str:
    hay = (front_matter + "\n" + full_text[:4000]).lower()
    for doc_type, hints in DOC_TYPE_HINTS.items():
        if any(h in hay for h in hints):
            return doc_type
    return "unknown"


def extract_publication_dates(text: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    head = (text or "")[:12000]
    labels = ("received", "revised", "accepted", "submitted", "published", "online")
    for label in labels:
        pat = re.compile(
            rf"(?i)\b{label}\b[^\n]{{0,80}}?\b("
            r"(?:\d{1,2}\s+[A-Za-z]{3,12}\s+\d{4})|"
            r"(?:[A-Za-z]{3,12}\s+\d{4})|"
            r"(?:\d{4}-\d{2}-\d{2})"
            r")"
        )
        m = pat.search(head)
        if m:
            out[label] = clean_md_inline(m.group(1))
    return out


def estimate_reference_entries(references: List[str]) -> int:
    if not references:
        return 0
    block = "\n\n".join(references)
    lines = [clean_md_inline(x) for x in block.splitlines()]
    lines = [x for x in lines if x]
    count = 0
    for line in lines:
        if re.match(r"^\[?\d{1,4}\]?[.)]?\s+\S+", line):
            count += 1
            continue
        if re.match(r"^[A-Z][A-Za-z'`.\-]+,\s*[A-Z].*\b(?:19|20)\d{2}[a-z]?\b", line):
            count += 1
            continue
    return count


def extract_keywords(keywords_text: str, full_text: str) -> List[str]:
    raw = keywords_text.strip()
    if not raw:
        m = re.search(r"(?im)^\s*(?:keywords|key words|index terms)\s*:\s*(.+)$", full_text[:12000])
        if m:
            raw = m.group(1).strip()
    if not raw:
        return []
    raw = clean_md_inline(raw)
    parts = [p.strip(" .;,:") for p in re.split(r"[;,|•]+", raw) if p.strip()]
    out: List[str] = []
    for part in parts:
        if not re.search(r"[A-Za-z]", part):
            continue
        if len(part) < 2 or len(part) > 80:
            continue
        if len(part.split()) > 8:
            continue
        out.append(part)
    return dedupe_keep_order(out)


def recover_title_from_context(lines: List[str], title_line_index: int, current_title: str) -> str:
    if title_line_index < 0:
        return current_title
    # If title looks like a person name, try a meaningful pre-title line.
    if not looks_like_person_name(current_title):
        return current_title
    for j in range(title_line_index - 1, max(-1, title_line_index - 8), -1):
        cand = clean_md_inline(lines[j])
        if not cand:
            continue
        low = cand.lower()
        if any(tok in low for tok in ("heinonline", "license", "date downloaded", "source:", "citations:")):
            continue
        if re.search(r"\.{3,}\s*\d+\s*$", cand):
            continue
        if PARTIAL_TITLE_RE.match(cand):
            continue
        if looks_like_person_name(cand):
            continue
        if len(cand) < 12 or len(cand) > 220:
            continue
        return cand
    return current_title


def detect_partial_document(
    *,
    title: str,
    full_text: str,
    authors: List[str],
    abstract_text: str,
    identifiers_count: int,
) -> Dict[str, Any]:
    reasons: List[str] = []
    t = clean_md_inline(title)
    if PARTIAL_TITLE_RE.match(t):
        reasons.append("title_is_structural")
    if re.search(r"(?i)\bvolume\b", t) and re.search(r"\b(?:19|20)\d{2}\b", t):
        reasons.append("title_is_volume_header")
    if re.match(r"(?i)^\s*\d+(?:\.\d+)+\s+\S+", t):
        reasons.append("title_is_subsection_token")
    if len(t.split()) >= 14 and not t.endswith((".", "?", "!")):
        reasons.append("title_looks_like_mid_paragraph_sentence")
    toc_lines = len(TOC_DOTS_LINE_RE.findall((full_text or "")[:16000]))
    if toc_lines >= 8:
        reasons.append("toc_dot_lines")
    if not authors:
        reasons.append("no_authors")
    if not abstract_text:
        reasons.append("no_abstract")
    if identifiers_count == 0:
        reasons.append("no_identifier")

    partial = False
    if "title_is_structural" in reasons:
        partial = True
    elif "title_is_volume_header" in reasons and "no_authors" in reasons:
        partial = True
    elif "title_is_subsection_token" in reasons and ("no_authors" in reasons or "toc_dot_lines" in reasons):
        partial = True
    elif "title_looks_like_mid_paragraph_sentence" in reasons and "no_authors" in reasons and "no_identifier" in reasons:
        partial = True
    elif "toc_dot_lines" in reasons and "no_authors" in reasons and "no_abstract" in reasons:
        partial = True
    return {"is_partial_document": partial, "reasons": reasons, "toc_dot_lines": toc_lines}


def extract_document_metadata(
    *,
    full_text: str,
    references: List[str],
    heading_validation: Dict[str, Any],
) -> Dict[str, Any]:
    sections = parse_markdown_sections(full_text)
    front = front_matter_slice(full_text)
    refs_text = "\n\n".join(references)

    title = ""
    subtitle = ""
    lines = (full_text or "").splitlines()
    title_line_index = -1
    for i, line in enumerate(lines[:160]):
        m = re.match(r"^\s*#\s+(.+?)\s*$", line)
        if not m:
            continue
        candidate = clean_md_inline(m.group(1))
        c_norm = candidate.lower()
        if PARTIAL_TITLE_RE.match(candidate):
            continue
        if re.search(r"\.{3,}\s*\d+\s*$", candidate):
            continue
        if re.match(r"(?i)^(?:[ivxlcdm]+|\d+(?:\.\d+)*)\.\s+(?:introduction|background|conclusion)\b", candidate):
            continue
        if any(x in c_norm for x in ("table of contents", "contents", "search text of this pdf", "license agreement")):
            continue
        if candidate:
            title = candidate
            title_line_index = i
            break
    if not title:
        for i, line in enumerate(lines[:40]):
            candidate = clean_md_inline(line)
            if not candidate:
                continue
            low = candidate.lower()
            if any(
                k in low
                for k in (
                    "doi",
                    "http://",
                    "https://",
                    "copyright",
                    "search text of this pdf",
                    "your use of this heinonline",
                    "license agreement",
                    "date downloaded",
                    "source: content downloaded",
                )
            ):
                continue
            if re.search(r"\.{3,}\s*\d+\s*$", candidate):
                continue
            if len(candidate) < 20 or len(candidate) > 240:
                continue
            title = candidate
            title_line_index = i
            break

    title = recover_title_from_context(lines, title_line_index, title)

    if title_line_index >= 0:
        for line in lines[title_line_index + 1 : min(title_line_index + 10, len(lines))]:
            candidate = clean_md_inline(line)
            if not candidate:
                continue
            if extract_authors_from_line(candidate):
                continue
            low = candidate.lower()
            if any(k in low for k in ("abstract", "keywords", "introduction")):
                break
            if len(candidate) <= 180:
                subtitle = candidate
                break

    authors = dedupe_authors(extract_authors_from_front_matter(front, title=title))
    if not authors and looks_like_person_name(title):
        inferred = normalize_name_candidate(title)
        if inferred:
            authors = [inferred]
    affiliations = extract_affiliations(front)

    abstract_text = section_text_by_alias(sections, ["abstract", "summary"])
    if not abstract_text:
        m = re.search(r"(?im)^\s*abstract\s*[:\-]\s*(.+)$", full_text[:12000])
        if m:
            abstract_text = m.group(1).strip()
    if not abstract_text:
        m = re.search(
            r"(?is)\babstract\b\s*[:\-]?\s*(.{60,1600}?)\n\s*(?:#|\d+\.\s*|keywords|key words|index terms|introduction)\b",
            full_text[:20000],
        )
        if m:
            abstract_text = m.group(1).strip()
    abstract_text = clean_md_inline(abstract_text)

    keywords_text = section_text_by_alias(sections, ["keywords", "key words", "index terms"])
    keywords = extract_keywords(keywords_text, full_text)

    emails = dedupe_keep_order(EMAIL_RE.findall(full_text[:20000]))
    orcids = dedupe_keep_order(ORCID_RE.findall(full_text[:20000]))
    dois = dedupe_keep_order([d.rstrip(".,);]") for d in DOI_RE.findall(full_text + "\n" + refs_text)])
    issns = dedupe_keep_order(ISSN_RE.findall(full_text + "\n" + refs_text))
    isbns = dedupe_keep_order(ISBN_RE.findall(full_text + "\n" + refs_text))
    arxiv_ids = dedupe_keep_order(ARXIV_RE.findall(full_text + "\n" + refs_text))
    pmids = dedupe_keep_order(PMID_RE.findall(full_text + "\n" + refs_text))
    pmcids = dedupe_keep_order(PMCID_RE.findall(full_text + "\n" + refs_text))
    urls = dedupe_keep_order([u.rstrip(".,);]") for u in URL_RE.findall(full_text[:30000])])

    corr_line = ""
    m_corr = re.search(r"(?im)^\s*(?:\*+\s*)?(?:corresponding author|correspondence)\b.*$", full_text[:20000])
    if m_corr:
        corr_line = clean_md_inline(m_corr.group(0))

    pub_dates = extract_publication_dates(full_text)
    years = [int(y) for y in YEAR_RE.findall(front[:4000])]
    publication_year = min(years) if years else None

    venue = ""
    for line in front.splitlines()[:40]:
        s = clean_md_inline(line)
        if not s:
            continue
        low = s.lower()
        if any(h in low for h in VENUE_HINTS):
            venue = s
            break

    doc_type = infer_document_type(front, full_text)
    reference_entries_estimated = estimate_reference_entries(references)
    identifiers_count = len(dois) + len(issns) + len(isbns) + len(arxiv_ids) + len(pmids) + len(pmcids)
    partial_doc = detect_partial_document(
        title=title,
        full_text=full_text,
        authors=authors,
        abstract_text=abstract_text,
        identifiers_count=identifiers_count,
    )

    return {
        "title": title,
        "subtitle": subtitle,
        "document_type": doc_type,
        "venue": venue,
        "publication_year": publication_year,
        "authors": authors,
        "affiliations": affiliations,
        "emails": emails,
        "orcids": orcids,
        "corresponding_author_line": corr_line,
        "abstract": abstract_text,
        "keywords": keywords,
        "publication_dates": pub_dates,
        "identifiers": {
            "doi": dois,
            "issn": issns,
            "isbn": isbns,
            "arxiv": arxiv_ids,
            "pmid": pmids,
            "pmcid": pmcids,
            "urls": urls,
        },
        "references_block_count": len(references),
        "references_entries_estimated": reference_entries_estimated,
        "heading_count": int(heading_validation.get("heading_count", 0) or 0),
        "max_heading_level": int(heading_validation.get("max_heading_level", 0) or 0),
        "partial_document": partial_doc,
    }


def _norm_token(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def validate_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    authors = metadata.get("authors") if isinstance(metadata.get("authors"), list) else []
    affiliations = metadata.get("affiliations") if isinstance(metadata.get("affiliations"), list) else []
    emails = metadata.get("emails") if isinstance(metadata.get("emails"), list) else []
    orcids = metadata.get("orcids") if isinstance(metadata.get("orcids"), list) else []
    keywords = metadata.get("keywords") if isinstance(metadata.get("keywords"), list) else []
    identifiers = metadata.get("identifiers") if isinstance(metadata.get("identifiers"), dict) else {}

    doi_count = len(identifiers.get("doi") or [])
    issn_count = len(identifiers.get("issn") or [])
    isbn_count = len(identifiers.get("isbn") or [])
    arxiv_count = len(identifiers.get("arxiv") or [])
    pmid_count = len(identifiers.get("pmid") or [])
    pmcid_count = len(identifiers.get("pmcid") or [])
    url_count = len(identifiers.get("urls") or [])

    has_title = nonempty_text(metadata.get("title"))
    has_authors = len(authors) > 0
    has_affiliations = len(affiliations) > 0
    has_emails = len(emails) > 0
    has_orcids = len(orcids) > 0
    has_abstract = nonempty_text(metadata.get("abstract"))
    has_keywords = len(keywords) > 0
    has_identifier = (doi_count + issn_count + isbn_count + arxiv_count + pmid_count + pmcid_count) > 0
    has_venue = nonempty_text(metadata.get("venue"))
    has_headings = int(metadata.get("heading_count", 0) or 0) >= 2
    has_abstract_or_keywords = has_abstract or has_keywords
    has_contact_or_affiliation = has_emails or has_affiliations
    has_corresponding_line = nonempty_text(metadata.get("corresponding_author_line"))
    partial_info = metadata.get("partial_document") if isinstance(metadata.get("partial_document"), dict) else {}
    is_partial_doc = bool(partial_info.get("is_partial_document"))

    if is_partial_doc:
        # Partial OCR extracts (e.g., TOC/section-only) should be validated with relaxed expectations.
        core_checks = [
            has_title,
            has_headings,
            has_authors or has_venue or has_identifier,
        ]
    else:
        core_checks = [
            has_title,
            has_authors,
            has_abstract_or_keywords,
            has_identifier,
            has_headings,
            has_contact_or_affiliation,
        ]
    core_coverage = ratio(sum(1 for x in core_checks if x), len(core_checks))

    author_surnames = []
    for author in authors:
        parts = [p for p in re.split(r"\s+", str(author).strip()) if p]
        if parts:
            author_surnames.append(_norm_token(parts[-1]))
    author_surnames = [a for a in author_surnames if a]

    email_match = 0
    for email in emails:
        local = _norm_token(str(email).split("@", 1)[0])
        if not local:
            continue
        if any(sur in local or local in sur for sur in author_surnames):
            email_match += 1
    email_author_link_rate = ratio(email_match, len(emails))

    flags: List[str] = []
    if not has_title:
        flags.append("missing_title")
    if not has_authors and not is_partial_doc:
        flags.append("missing_authors")
    if not has_abstract_or_keywords and not is_partial_doc:
        flags.append("missing_abstract_and_keywords")
    if len(authors) >= 2 and not has_affiliations and (has_emails or has_corresponding_line) and not is_partial_doc:
        flags.append("missing_affiliations")
    if has_authors and not has_emails and has_corresponding_line and not is_partial_doc:
        flags.append("missing_contact_email")
    if not has_identifier and not is_partial_doc:
        flags.append("missing_persistent_identifier")
    if not has_headings:
        flags.append("weak_heading_structure")
    if has_corresponding_line and not has_emails:
        flags.append("missing_corresponding_email")
    if has_emails and has_authors and email_author_link_rate < 0.25:
        flags.append("low_email_author_link_rate")
    if core_coverage < 0.5 and not is_partial_doc:
        flags.append("low_metadata_coverage")
    if is_partial_doc:
        flags.append("partial_document")

    return {
        "field_presence": {
            "title": has_title,
            "authors": has_authors,
            "affiliations": has_affiliations,
            "emails": has_emails,
            "orcids": has_orcids,
            "abstract": has_abstract,
            "keywords": has_keywords,
            "venue": has_venue,
            "persistent_identifier": has_identifier,
            "headings": has_headings,
            "partial_document": is_partial_doc,
        },
        "counts": {
            "authors": len(authors),
            "affiliations": len(affiliations),
            "emails": len(emails),
            "orcids": len(orcids),
            "keywords": len(keywords),
            "doi": doi_count,
            "issn": issn_count,
            "isbn": isbn_count,
            "arxiv": arxiv_count,
            "pmid": pmid_count,
            "pmcid": pmcid_count,
            "urls": url_count,
        },
        "coverage": {
            "core_coverage": core_coverage,
            "email_author_link_rate": email_author_link_rate,
        },
        "partial_document": partial_info,
        "flags": [f"meta_{f}" for f in flags],
    }


def build_validations(
    *,
    full_text: str,
    references: List[str],
    link_out: Dict[str, Any],
    current_summary: Dict[str, Any],
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    dominant_bucket = str(current_summary.get("dominant_bucket") or STYLE_UNKNOWN)
    dominant_results = get_bucket_results(link_out, dominant_bucket)
    footnote_results = get_bucket_results(link_out, "footnotes")

    dominant_quality = summarize_results_quality(dominant_results)
    footnote_quality = summarize_results_quality(footnote_results)
    footnote_items = (link_out.get("footnotes") or {}).get("items")
    footnote_items_total = len(footnote_items) if isinstance(footnote_items, dict) else 0

    signals = detect_style_signals(full_text)
    recommended = recommend_style_from_signals(signals, len(references))
    detected_style = str(current_summary.get("style") or STYLE_UNKNOWN)
    aligned = style_alignment(detected_style, recommended)

    heading_validation = validate_heading_structure(full_text, references)
    metadata_validation = validate_metadata(metadata)
    dominant_stats = current_summary.get("dominant", {}) if isinstance(current_summary, dict) else {}
    dominant_bib_total = as_number(dominant_stats.get("bib_unique_total"))
    dominant_bib_cov = as_number(dominant_stats.get("bib_coverage_rate"))
    dominant_link_target = "bibliography" if dominant_bucket == STYLE_AUTHOR else "footnotes"
    unresolved_flag = "unresolved_reference_links" if dominant_bucket == STYLE_AUTHOR else "unresolved_footnote_links"

    flags: List[str] = []
    if dominant_quality["intext_total"] > 0 and dominant_quality["index_coverage"] < 1.0:
        flags.append("missing_index")
    if dominant_quality["intext_total"] > 0 and dominant_quality["intext_citation_coverage"] < 1.0:
        flags.append("missing_intext_citation")
    if dominant_quality["intext_total"] > 0 and dominant_quality["preceding_text_coverage"] < 1.0:
        flags.append("missing_preceding_text")
    if dominant_quality["intext_total"] > 0 and dominant_quality["footnote_coverage"] < 1.0:
        flags.append(unresolved_flag)
    if dominant_quality["intext_total"] > 0 and dominant_bib_total == 0:
        flags.append("no_bibliography_detected")
    if dominant_quality["intext_total"] > 0 and dominant_bib_total > 0 and dominant_bib_cov < 0.5:
        flags.append("low_bib_coverage")
    if footnote_quality["intext_total"] > 0 and footnote_quality["footnote_coverage"] < 1.0:
        flags.append("footnotes_bucket_unresolved")
    if not aligned:
        flags.append("style_signal_mismatch")
    if not heading_validation["has_reference_heading"] and not references:
        flags.append("missing_reference_heading")
    if heading_validation["level_jump_violations"] > 0:
        flags.append("heading_level_jump_violation")
    if heading_validation["numbering_parent_violations"] > 0:
        flags.append("heading_numbering_parent_violation")
    meta_flags = metadata_validation.get("flags")
    if isinstance(meta_flags, list):
        flags.extend(str(f) for f in meta_flags)

    return {
        "dominant_quality": dominant_quality,
        "footnotes_quality": {
            **footnote_quality,
            "items_total": footnote_items_total,
        },
        "style_validation": {
            "detected_style": detected_style,
            "recommended_style": recommended,
            "aligned": aligned,
            "signals": signals,
        },
        "coverage_validation": {
            "dominant_bib_total": dominant_bib_total,
            "dominant_bib_coverage_rate": dominant_bib_cov,
            "dominant_link_target": dominant_link_target,
            "dominant_unresolved_flag": unresolved_flag,
        },
        "heading_validation": heading_validation,
        "metadata_validation": metadata_validation,
        "flags": flags,
    }


def relink_document(
    linker_fn: Callable[[str, Any], Dict[str, Any]],
    full_text: str,
    references: List[str],
    suppress_parser_logs: bool,
) -> Dict[str, Any]:
    if not suppress_parser_logs:
        return linker_fn(full_text, references)

    sink = io.StringIO()
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        return linker_fn(full_text, references)


def compute_delta(before: Dict[str, Any], after: Dict[str, Any]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for key in (
        "intext_total",
        "success_occurrences",
        "success_unique",
        "bib_unique_total",
        "occurrence_match_rate",
        "bib_coverage_rate",
        "success_percentage",
    ):
        out[f"delta_{key}"] = as_number(after.get(key)) - as_number(before.get(key))
    return out


def compute_bucket_deltas(
    before_summary: Dict[str, Any],
    after_summary: Dict[str, Any],
) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    before_buckets = before_summary.get("buckets", {}) if isinstance(before_summary, dict) else {}
    after_buckets = after_summary.get("buckets", {}) if isinstance(after_summary, dict) else {}
    for bucket in ("footnotes", "tex", "numeric", "author_year"):
        before = before_buckets.get(bucket, {}) if isinstance(before_buckets, dict) else {}
        after = after_buckets.get(bucket, {}) if isinstance(after_buckets, dict) else {}
        if not isinstance(before, dict):
            before = {}
        if not isinstance(after, dict):
            after = {}
        out[bucket] = compute_delta(before, after)
    return out


def aggregate(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    source_counts = Counter()
    style_counts = Counter()
    bucket_counts = Counter()

    ok_records = [r for r in records if "error" not in r]
    failed_records = [r for r in records if "error" in r]

    sum_after_success = 0.0
    sum_after_intext = 0.0
    sum_before_success = 0.0
    sum_before_intext = 0.0
    docs_with_baseline = 0
    improved_occ = 0
    regressed_occ = 0
    unchanged_occ = 0
    improved_pct = 0
    regressed_pct = 0
    unchanged_pct = 0
    docs_with_intext = 0
    docs_at_100_pct = 0
    docs_below_100_pct = 0
    docs_with_no_intext = 0
    docs_with_bib = 0
    docs_bib_coverage_100 = 0
    sum_bib_success_unique = 0.0
    sum_bib_total = 0.0
    style_mismatch_docs = 0
    heading_issue_docs = 0
    missing_preceding_docs = 0
    unresolved_link_docs = 0
    flag_counts = Counter()
    metadata_presence_counts = Counter()
    metadata_flag_counts = Counter()
    metadata_docs = 0
    metadata_core_cov_sum = 0.0
    metadata_core_cov_full = 0
    metadata_core_cov_ge_80 = 0
    metadata_core_cov_ge_60 = 0
    metadata_core_cov_lt_60 = 0
    metadata_email_link_sum = 0.0
    metadata_email_link_docs = 0
    metadata_authors_total = 0
    metadata_affiliations_total = 0
    metadata_keywords_total = 0

    for rec in ok_records:
        source_counts.update([rec.get("source_type", "unknown")])
        current = rec.get("current", {})
        style_counts.update([str(current.get("style", STYLE_UNKNOWN))])
        bucket_counts.update([str(current.get("dominant_bucket", STYLE_UNKNOWN))])

        cur_dom = current.get("dominant", {})
        sum_after_success += as_number(cur_dom.get("success_occurrences"))
        sum_after_intext += as_number(cur_dom.get("intext_total"))
        intext_total = as_number(cur_dom.get("intext_total"))
        if intext_total > 0:
            docs_with_intext += 1
            if as_number(cur_dom.get("success_percentage")) == 100.0:
                docs_at_100_pct += 1
            else:
                docs_below_100_pct += 1
        else:
            docs_with_no_intext += 1

        bib_total = as_number(cur_dom.get("bib_unique_total"))
        if bib_total > 0:
            docs_with_bib += 1
            if as_number(cur_dom.get("bib_coverage_rate")) == 1.0:
                docs_bib_coverage_100 += 1
            sum_bib_total += bib_total
            sum_bib_success_unique += as_number(cur_dom.get("success_unique"))

        validation = rec.get("validation", {})
        if isinstance(validation, dict):
            flags = validation.get("flags") or []
            if isinstance(flags, list):
                flag_counts.update(str(f) for f in flags)
                if "missing_preceding_text" in flags:
                    missing_preceding_docs += 1
                if "unresolved_footnote_links" in flags or "unresolved_reference_links" in flags:
                    unresolved_link_docs += 1

            sv = validation.get("style_validation", {})
            if isinstance(sv, dict) and sv.get("aligned") is False:
                style_mismatch_docs += 1

            hv = validation.get("heading_validation", {})
            if isinstance(hv, dict):
                if int(hv.get("level_jump_violations", 0) or 0) > 0 or int(
                    hv.get("numbering_parent_violations", 0) or 0
                ) > 0:
                    heading_issue_docs += 1

            mv = validation.get("metadata_validation", {})
            if isinstance(mv, dict):
                cov = mv.get("coverage", {})
                core_cov = as_number(cov.get("core_coverage")) if isinstance(cov, dict) else 0.0
                metadata_core_cov_sum += core_cov
                if core_cov >= 0.999999:
                    metadata_core_cov_full += 1
                if core_cov >= 0.8:
                    metadata_core_cov_ge_80 += 1
                elif core_cov >= 0.6:
                    metadata_core_cov_ge_60 += 1
                else:
                    metadata_core_cov_lt_60 += 1

                counts = mv.get("counts", {})
                if isinstance(counts, dict):
                    emails_count = int(counts.get("emails", 0) or 0)
                    authors_count = int(counts.get("authors", 0) or 0)
                    if emails_count > 0 and authors_count > 0:
                        metadata_email_link_sum += as_number(cov.get("email_author_link_rate"))
                        metadata_email_link_docs += 1

                mflags = mv.get("flags")
                if isinstance(mflags, list):
                    metadata_flag_counts.update(str(f) for f in mflags)

        metadata = rec.get("metadata", {})
        if isinstance(metadata, dict):
            metadata_docs += 1
            title_ok = nonempty_text(metadata.get("title"))
            abstract_ok = nonempty_text(metadata.get("abstract"))
            venue_ok = nonempty_text(metadata.get("venue"))
            authors = metadata.get("authors") if isinstance(metadata.get("authors"), list) else []
            affiliations = metadata.get("affiliations") if isinstance(metadata.get("affiliations"), list) else []
            emails = metadata.get("emails") if isinstance(metadata.get("emails"), list) else []
            orcids = metadata.get("orcids") if isinstance(metadata.get("orcids"), list) else []
            keywords = metadata.get("keywords") if isinstance(metadata.get("keywords"), list) else []
            identifiers = metadata.get("identifiers") if isinstance(metadata.get("identifiers"), dict) else {}
            has_identifier = (
                len(identifiers.get("doi") or [])
                + len(identifiers.get("issn") or [])
                + len(identifiers.get("isbn") or [])
                + len(identifiers.get("arxiv") or [])
                + len(identifiers.get("pmid") or [])
                + len(identifiers.get("pmcid") or [])
            ) > 0

            metadata_authors_total += len(authors)
            metadata_affiliations_total += len(affiliations)
            metadata_keywords_total += len(keywords)
            metadata_presence_counts.update(
                [
                    "title" if title_ok else "missing_title",
                    "authors" if len(authors) > 0 else "missing_authors",
                    "affiliations" if len(affiliations) > 0 else "missing_affiliations",
                    "emails" if len(emails) > 0 else "missing_emails",
                    "orcids" if len(orcids) > 0 else "missing_orcids",
                    "abstract" if abstract_ok else "missing_abstract",
                    "keywords" if len(keywords) > 0 else "missing_keywords",
                    "venue" if venue_ok else "missing_venue",
                    "identifier" if has_identifier else "missing_identifier",
                ]
            )

        baseline = rec.get("baseline")
        if not isinstance(baseline, dict):
            continue

        docs_with_baseline += 1
        base_dom = baseline.get("dominant", {})
        before_occ = as_number(base_dom.get("success_occurrences"))
        after_occ = as_number(cur_dom.get("success_occurrences"))
        before_pct = as_number(base_dom.get("success_percentage"))
        after_pct = as_number(cur_dom.get("success_percentage"))

        sum_before_success += before_occ
        sum_before_intext += as_number(base_dom.get("intext_total"))

        if after_occ > before_occ:
            improved_occ += 1
        elif after_occ < before_occ:
            regressed_occ += 1
        else:
            unchanged_occ += 1

        if after_pct > before_pct:
            improved_pct += 1
        elif after_pct < before_pct:
            regressed_pct += 1
        else:
            unchanged_pct += 1

    return {
        "documents_total": len(records),
        "documents_ok": len(ok_records),
        "documents_failed": len(failed_records),
        "documents_with_baseline": docs_with_baseline,
        "source_type_counts": dict(source_counts),
        "detected_style_counts": dict(style_counts),
        "dominant_bucket_counts": dict(bucket_counts),
        "weighted_occurrence_match_rate_after": (
            (sum_after_success / sum_after_intext) if sum_after_intext else 0.0
        ),
        "weighted_bib_coverage_rate_after": (
            (sum_bib_success_unique / sum_bib_total) if sum_bib_total else 0.0
        ),
        "docs_with_intext": docs_with_intext,
        "docs_at_100_success_percentage": docs_at_100_pct,
        "docs_below_100_success_percentage": docs_below_100_pct,
        "docs_with_no_intext": docs_with_no_intext,
        "docs_with_bib_entries": docs_with_bib,
        "docs_at_100_bib_coverage": docs_bib_coverage_100,
        "validator_style_mismatch_docs": style_mismatch_docs,
        "validator_heading_issue_docs": heading_issue_docs,
        "validator_missing_preceding_docs": missing_preceding_docs,
        "validator_unresolved_link_docs": unresolved_link_docs,
        "validator_flag_counts": dict(flag_counts),
        "metadata_docs_evaluated": metadata_docs,
        "metadata_presence_rates": {
            "title": ratio(metadata_presence_counts.get("title", 0), metadata_docs),
            "authors": ratio(metadata_presence_counts.get("authors", 0), metadata_docs),
            "affiliations": ratio(metadata_presence_counts.get("affiliations", 0), metadata_docs),
            "emails": ratio(metadata_presence_counts.get("emails", 0), metadata_docs),
            "orcids": ratio(metadata_presence_counts.get("orcids", 0), metadata_docs),
            "abstract": ratio(metadata_presence_counts.get("abstract", 0), metadata_docs),
            "keywords": ratio(metadata_presence_counts.get("keywords", 0), metadata_docs),
            "venue": ratio(metadata_presence_counts.get("venue", 0), metadata_docs),
            "identifier": ratio(metadata_presence_counts.get("identifier", 0), metadata_docs),
        },
        "metadata_avg_authors_per_doc": ratio(metadata_authors_total, metadata_docs),
        "metadata_avg_affiliations_per_doc": ratio(metadata_affiliations_total, metadata_docs),
        "metadata_avg_keywords_per_doc": ratio(metadata_keywords_total, metadata_docs),
        "metadata_avg_core_coverage": ratio(metadata_core_cov_sum, metadata_docs),
        "metadata_avg_email_author_link_rate_docs_with_email": ratio(metadata_email_link_sum, metadata_email_link_docs),
        "metadata_core_coverage_distribution_docs": {
            "full_100": metadata_core_cov_full,
            "ge_80": metadata_core_cov_ge_80,
            "ge_60_lt_80": metadata_core_cov_ge_60,
            "lt_60": metadata_core_cov_lt_60,
        },
        "metadata_validator_flag_counts": dict(metadata_flag_counts),
        "weighted_occurrence_match_rate_before": (
            (sum_before_success / sum_before_intext) if sum_before_intext else 0.0
        ),
        "baseline_delta_by_success_occurrences_docs": {
            "improved": improved_occ,
            "regressed": regressed_occ,
            "unchanged": unchanged_occ,
        },
        "baseline_delta_by_success_percentage_docs": {
            "improved": improved_pct,
            "regressed": regressed_pct,
            "unchanged": unchanged_pct,
        },
        "failed_files": [r.get("file") for r in failed_records],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Reconstitute dataset markdown documents and rerun "
            "link_citations_to_footnotes with current parser logic."
        )
    )
    parser.add_argument(
        "--dataset-dir",
        default="python_backend_legacy/dataset",
        help="Dataset directory containing .md/.json files.",
    )
    parser.add_argument(
        "--types",
        default="both",
        choices=("both", "md", "json"),
        help="Which file types to process.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional max number of files after sorting.",
    )
    parser.add_argument(
        "--output",
        default="python_backend_legacy/dataset/footnotes_reparse_report.json",
        help="Output JSON report path.",
    )
    parser.add_argument(
        "--prefer-pages-text",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "For .md cache files, rebuild from `pages_text` when available instead "
            "of using stored `full_text` directly."
        ),
    )
    parser.add_argument(
        "--write-updated-md",
        action="store_true",
        default=False,
        help=(
            "Persist updated `full_text`/`references`/`citations`/`flat_text` "
            "back into .md cache files."
        ),
    )
    parser.add_argument(
        "--show-progress-every",
        type=int,
        default=25,
        help="Print progress every N files.",
    )
    parser.add_argument(
        "--hash-only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Only process files whose stem is a 64-char lowercase hex hash.",
    )
    parser.add_argument(
        "--no-suppress-parser-logs",
        action="store_true",
        default=False,
        help="Do not suppress verbose prints from footnotes_parser.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    dataset_dir = (repo_root / args.dataset_dir).resolve()
    output_path = (repo_root / args.output).resolve()

    if not dataset_dir.exists():
        raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")

    include_md = args.types in {"both", "md"}
    include_json = args.types in {"both", "json"}
    files = sorted_files(dataset_dir, include_md, include_json, args.limit, args.hash_only)
    if not files:
        raise RuntimeError(f"No files found in {dataset_dir} for types={args.types}")

    linker = load_linker(repo_root)

    records: List[Dict[str, Any]] = []

    for idx, path in enumerate(files, start=1):
        rel_path = str(path.relative_to(repo_root))
        try:
            raw = path.read_text(encoding="utf-8")
            obj = json.loads(raw)
            if not isinstance(obj, dict):
                raise ValueError("Top-level JSON is not an object.")

            baseline_summary = None
            full_text = ""
            references: List[str] = []
            pages_count = 0
            rebuilt_from_pages = False
            source_type = "unknown"

            if path.suffix == ".md":
                source_type = "md_cache"
                baseline_summary = summarize_link_output(obj.get("citations"))

                if args.prefer_pages_text:
                    pages = text_pages_from_md_cache(obj)
                    pages_count = len(pages)
                    if pages:
                        full_text, references = rebuild_single_document(pages)
                        rebuilt_from_pages = bool(full_text)

                if not full_text:
                    full_text = str(obj.get("full_text") or "")
                    references = normalize_references(obj.get("references"))
            else:
                source_type = "raw_json"
                baseline_summary_raw = obj.get("citation_summary")
                if isinstance(baseline_summary_raw, dict) and isinstance(baseline_summary_raw.get("buckets"), dict):
                    baseline_summary = baseline_summary_raw
                else:
                    baseline_summary = summarize_link_output(obj.get("citations"))
                pages = text_pages_from_raw_json(obj)
                pages_count = len(pages)
                full_text, references = rebuild_single_document(pages)
                rebuilt_from_pages = True

            if not full_text.strip():
                raise ValueError("Reconstituted document is empty.")

            link_out = relink_document(
                linker_fn=linker,
                full_text=full_text,
                references=references,
                suppress_parser_logs=not args.no_suppress_parser_logs,
            )
            current_summary = summarize_link_output(link_out)
            heading_validation = validate_heading_structure(full_text, references)
            metadata = extract_document_metadata(
                full_text=full_text,
                references=references,
                heading_validation=heading_validation,
            )
            validation = build_validations(
                full_text=full_text,
                references=references,
                link_out=link_out,
                current_summary=current_summary,
                metadata=metadata,
            )

            record: Dict[str, Any] = {
                "file": rel_path,
                "source_type": source_type,
                "pages_count": pages_count,
                "rebuilt_from_pages": rebuilt_from_pages,
                "text_chars": len(full_text),
                "references_count": len(references),
                "references_chars": sum(len(r) for r in references),
                "baseline": baseline_summary,
                "current": current_summary,
                "metadata": metadata,
                "validation": validation,
            }

            if baseline_summary is not None:
                record["delta"] = compute_delta(
                    baseline_summary.get("dominant", {}),
                    current_summary.get("dominant", {}),
                )
                record["bucket_deltas"] = compute_bucket_deltas(baseline_summary, current_summary)

            records.append(record)

            if args.write_updated_md and path.suffix == ".md":
                obj["full_text"] = full_text
                obj["references"] = references
                obj["citations"] = link_out
                obj["flat_text"] = link_out.get("flat_text", full_text)
                path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

        except Exception as exc:
            records.append(
                {
                    "file": rel_path,
                    "source_type": "md_cache" if path.suffix == ".md" else "raw_json",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )

        if args.show_progress_every > 0 and (idx % args.show_progress_every == 0 or idx == len(files)):
            print(f"[{idx}/{len(files)}] processed")

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_dir": str(dataset_dir),
        "options": {
            "types": args.types,
            "limit": args.limit,
            "hash_only": args.hash_only,
            "prefer_pages_text": args.prefer_pages_text,
            "write_updated_md": args.write_updated_md,
            "suppress_parser_logs": not args.no_suppress_parser_logs,
        },
        "summary": aggregate(records),
        "records": records,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Report written: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
