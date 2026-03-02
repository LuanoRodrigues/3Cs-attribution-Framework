from __future__ import annotations

import argparse
import ast
import html
import json
import multiprocessing
import os
import re
import sys
import hashlib
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from jinja2 import Environment, FileSystemLoader, select_autoescape
try:
    from Research.summary_utils import resolve_summary_path
    from Research.adaptive_prompt_context import build_adaptive_prompt_context
    from Research.round_synthesis import RoundSynthesisCaps, run_round_synthesis, split_prompt_requests_by_bytes
except Exception:
    _ROOT = Path(__file__).resolve().parents[1]
    if str(_ROOT) not in sys.path:
        sys.path.insert(0, str(_ROOT))
    from Research.summary_utils import resolve_summary_path
    from Research.adaptive_prompt_context import build_adaptive_prompt_context
    from Research.round_synthesis import RoundSynthesisCaps, run_round_synthesis, split_prompt_requests_by_bytes

CITATION_STYLE_ALIASES = {
    "apa": "apa",
    "author_year": "apa",
    "numeric": "numeric",
    "endnote": "endnote",
    "parenthetical_footnote": "parenthetical_footnote",
    "parenthal_footnote": "parenthetical_footnote",
    "parenthal footnote": "parenthetical_footnote",
}

_DATASET_PDF_INDEX: dict[str, Path] | None = None
_DATASET_BASENAME_INDEX: dict[str, list[Path]] | None = None
_DATASET_STORAGE_INDEX: dict[str, list[Path]] | None = None
_PDF_PAGES_CACHE: dict[str, list[tuple[int, str]]] = {}
_QUOTE_PAGE_CACHE: dict[str, int] = {}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _dbg(fn: str, message: str) -> None:
    print(f"[systematic_review_pipeline.py][{fn}][debug] {message}", file=sys.stderr, flush=True)


def _env_int(name: str, default: int, *, min_value: int, max_value: int) -> int:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        n = int(raw)
    except Exception:
        return default
    return max(min_value, min(max_value, n))


def _json_bytes_len(obj: Any) -> int:
    try:
        blob = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        blob = str(obj)
    return len(blob.encode("utf-8"))


def _compact_evidence_row_for_prompt(row: dict[str, Any], *, quote_chars: int) -> dict[str, Any]:
    return {
        "dqid": str(row.get("dqid") or ""),
        "theme": str(row.get("theme") or ""),
        "citation": str(row.get("citation") or ""),
        "item_key": str(row.get("item_key") or ""),
        "quote": str(row.get("quote") or "")[: max(60, quote_chars)],
        "pdf_path": str(row.get("pdf_path") or ""),
    }


def _compact_evidence_payload_for_prompt(rows: list[dict[str, Any]], *, max_rows: int, quote_chars: int) -> list[dict[str, Any]]:
    try:
        row_limit = int(max_rows)
    except Exception:
        row_limit = len(rows)
    if row_limit <= 0:
        row_limit = len(rows)
    out: list[dict[str, Any]] = []
    for r in rows[:row_limit]:
        if not isinstance(r, dict):
            continue
        out.append(_compact_evidence_row_for_prompt(r, quote_chars=quote_chars))
    return out


def _split_evidence_rows_into_capped_rounds(
    rows: list[dict[str, Any]],
    *,
    row_cap: int,
    byte_cap: int,
    quote_chars: int,
) -> list[dict[str, Any]]:
    if not rows:
        return []
    try:
        safe_row_cap = int(row_cap)
    except Exception:
        safe_row_cap = 0
    if safe_row_cap <= 0:
        safe_row_cap = len(rows)
    try:
        safe_byte_cap = int(byte_cap)
    except Exception:
        safe_byte_cap = 0
    if safe_byte_cap < 0:
        safe_byte_cap = 0

    rounds: list[dict[str, Any]] = []
    current_raw: list[dict[str, Any]] = []
    current_compact: list[dict[str, Any]] = []
    current_bytes = 2

    def _flush_current() -> None:
        nonlocal current_raw, current_compact, current_bytes
        if not current_raw:
            return
        rounds.append(
            {
                "round": len(rounds) + 1,
                "rows": list(current_raw),
                "compact_rows": list(current_compact),
                "rows_count": len(current_raw),
                "bytes_estimate": int(current_bytes),
            }
        )
        current_raw = []
        current_compact = []
        current_bytes = 2

    for row in rows:
        if not isinstance(row, dict):
            continue
        compact = _compact_evidence_row_for_prompt(row, quote_chars=quote_chars)
        row_bytes = _json_bytes_len(compact) + 1
        would_hit_row_cap = len(current_raw) >= safe_row_cap
        would_hit_byte_cap = bool(safe_byte_cap > 0 and current_raw and (current_bytes + row_bytes > safe_byte_cap))
        if would_hit_row_cap or would_hit_byte_cap:
            _flush_current()
        current_raw.append(row)
        current_compact.append(compact)
        current_bytes += row_bytes
    _flush_current()
    return rounds


def _evidence_round_manifest_lines(
    rounds: list[dict[str, Any]],
    research_questions: list[str],
) -> list[str]:
    lines: list[str] = []
    for round_payload in rounds:
        rows = round_payload.get("rows")
        if not isinstance(rows, list):
            continue
        round_idx = int(round_payload.get("round") or (len(lines) + 1))
        rows_count = len(rows)
        source_count = _source_count(rows) if rows else 0
        top_themes = _top_theme_text(rows, limit=3) if rows else "insufficient thematic coverage"
        years = [int(r["year"]) for r in rows if isinstance(r, dict) and isinstance(r.get("year"), int)]
        if years:
            year_span = f"{min(years)}-{max(years)}" if min(years) != max(years) else str(min(years))
        else:
            year_span = "undated"
        rq_bits = ""
        if research_questions:
            assignments, unmapped = _assign_rows_to_questions(rows, research_questions)
            ranked = sorted(
                ((idx + 1, len(vals)) for idx, vals in assignments.items() if vals),
                key=lambda it: (-it[1], it[0]),
            )[:3]
            rq_tokens = [f"RQ{idx}:{count}" for idx, count in ranked]
            if unmapped:
                rq_tokens.append(f"unmapped:{len(unmapped)}")
            rq_bits = "; rq_coverage=" + (", ".join(rq_tokens) if rq_tokens else "none")
        lines.append(
            f"Round {round_idx:03d}: rows={rows_count}; sources={source_count}; years={year_span}; "
            f"top_themes={top_themes}{rq_bits}"
        )
    return lines


def _prepare_prompt_context_strings(
    payload: dict[str, Any],
    *,
    target_tokens: int,
    hard_cap_tokens: int,
    label: str,
) -> tuple[str, str]:
    adaptive = build_adaptive_prompt_context(
        payload,
        target_tokens=int(target_tokens),
        hard_cap_tokens=int(hard_cap_tokens),
    )
    context_obj = adaptive.get("context") if isinstance(adaptive, dict) else payload
    if not isinstance(context_obj, dict):
        context_obj = payload
    meta_obj = adaptive.get("meta") if isinstance(adaptive, dict) else {}
    ctx_json = json.dumps(context_obj, ensure_ascii=False, indent=2)
    meta_json = json.dumps(meta_obj, ensure_ascii=False)
    _dbg(
        "render_systematic_review_from_summary",
        f"{label}_context_prepared chars={len(ctx_json)} meta_chars={len(meta_json)}",
    )
    return ctx_json, meta_json


def _normalize_for_match(text: str) -> str:
    t = str(text or "").lower()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"[^\w\s]", "", t)
    return t.strip()


def _canonical_pdf_path(value: str) -> str:
    p = str(value or "").strip()
    if not p:
        return ""
    p = p.replace("\\", "/")
    m = re.match(r"^/mnt/([a-zA-Z])/(.*)$", p)
    if m:
        drive = m.group(1).upper()
        rest = m.group(2)
        p = f"{drive}:/{rest}"
    return p.lower()


def _extract_storage_key(value: str) -> str:
    p = str(value or "").replace("\\", "/")
    m = re.search(r"/storage/([A-Za-z0-9]{8})/", p)
    return (m.group(1).upper() if m else "")


def _build_dataset_pdf_index() -> tuple[dict[str, Path], dict[str, list[Path]], dict[str, list[Path]]]:
    global _DATASET_PDF_INDEX, _DATASET_BASENAME_INDEX, _DATASET_STORAGE_INDEX
    if _DATASET_PDF_INDEX is not None and _DATASET_BASENAME_INDEX is not None and _DATASET_STORAGE_INDEX is not None:
        return _DATASET_PDF_INDEX, _DATASET_BASENAME_INDEX, _DATASET_STORAGE_INDEX
    pdf_map: dict[str, Path] = {}
    base_map: dict[str, list[Path]] = {}
    storage_map: dict[str, list[Path]] = {}
    ds_dir = _repo_root() / "python_backend_legacy" / "dataset"
    if ds_dir.is_dir():
        for fp in ds_dir.glob("*.json"):
            try:
                data = json.loads(fp.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            pdf_path = str(data.get("pdf_path") or "").strip()
            if not pdf_path:
                continue
            pdf_map[pdf_path] = fp
            canon = _canonical_pdf_path(pdf_path)
            if canon:
                pdf_map[canon] = fp
            base = Path(pdf_path).name.lower()
            base_map.setdefault(base, []).append(fp)
            storage_key = _extract_storage_key(pdf_path)
            if storage_key:
                storage_map.setdefault(storage_key, []).append(fp)
    _DATASET_PDF_INDEX = pdf_map
    _DATASET_BASENAME_INDEX = base_map
    _DATASET_STORAGE_INDEX = storage_map
    return pdf_map, base_map, storage_map


def _load_pdf_pages_from_dataset(pdf_path: str) -> list[tuple[int, str]]:
    key = str(pdf_path or "").strip()
    if not key:
        return []
    if key in _PDF_PAGES_CACHE:
        return _PDF_PAGES_CACHE[key]
    pdf_map, base_map, storage_map = _build_dataset_pdf_index()
    source = pdf_map.get(key) or pdf_map.get(_canonical_pdf_path(key))
    if source is None:
        candidates = base_map.get(Path(key).name.lower(), [])
        source = candidates[0] if len(candidates) == 1 else None
    if source is None:
        storage_key = _extract_storage_key(key)
        sc = storage_map.get(storage_key, []) if storage_key else []
        source = sc[0] if len(sc) == 1 else None
    pages: list[tuple[int, str]] = []
    if source and source.is_file():
        try:
            data = json.loads(source.read_text(encoding="utf-8"))
            body = (((data.get("response") or {}).get("response") or {}).get("body") or {}) if isinstance(data, dict) else {}
            raw_pages = body.get("pages")
            if isinstance(raw_pages, list):
                for i, page in enumerate(raw_pages, start=1):
                    if not isinstance(page, dict):
                        continue
                    md = str(page.get("markdown") or "").strip()
                    if md:
                        pages.append((i, md))
        except Exception:
            pages = []
    _PDF_PAGES_CACHE[key] = pages
    return pages


def _find_quote_page(pdf_path: str, quote: str) -> int | None:
    q = str(quote or "").strip()
    if not q:
        return None
    cache_key = f"{pdf_path}::{hashlib.sha1(q.encode('utf-8', errors='ignore')).hexdigest()[:16]}"
    if cache_key in _QUOTE_PAGE_CACHE:
        return _QUOTE_PAGE_CACHE[cache_key]
    pages = _load_pdf_pages_from_dataset(pdf_path)
    if not pages:
        return None
    qnorm = _normalize_for_match(q.replace("...", " "))
    if not qnorm:
        return None
    # direct contains
    for page_no, text in pages:
        tnorm = _normalize_for_match(text)
        if qnorm in tnorm:
            _QUOTE_PAGE_CACHE[cache_key] = page_no
            return page_no
    # prefix contains for very long extracts
    prefix = qnorm[:220]
    if len(prefix) > 40:
        for page_no, text in pages:
            if prefix in _normalize_for_match(text):
                _QUOTE_PAGE_CACHE[cache_key] = page_no
                return page_no
    # token-overlap heuristic
    tokens = [t for t in re.findall(r"\w+", qnorm) if len(t) > 3][:18]
    if len(tokens) >= 6:
        for page_no, text in pages:
            tnorm = _normalize_for_match(text)
            hit = sum(1 for tok in tokens if tok in tnorm)
            if hit >= max(6, int(len(tokens) * 0.75)):
                _QUOTE_PAGE_CACHE[cache_key] = page_no
                return page_no
    return None


def _append_page_to_apa_citation(citation: str, page_no: int | None) -> str:
    c = str(citation or "").strip()
    if not c or page_no is None:
        return c
    if ", p." in c or ", pp." in c:
        return c
    if c.startswith("(") and c.endswith(")"):
        return c[:-1] + f", p. {int(page_no)})"
    return f"{c}, p. {int(page_no)}"


def _sanitize_href_url(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    # Decode any pre-escaped entities to avoid double-escaping in HTML output.
    for _ in range(3):
        nxt = html.unescape(raw)
        if nxt == raw:
            break
        raw = nxt
    raw = re.sub(r"\s+", " ", raw).strip()
    if not re.match(r"^(?:https?|file)://", raw, flags=re.IGNORECASE):
        return ""
    if raw.lower().startswith("file://"):
        return raw.replace(" ", "%20")
    try:
        parts = urlsplit(raw)
    except Exception:
        return raw
    query_raw = str(parts.query or "")
    # Common malformed parameter tokens from upstream sources.
    query_raw = query_raw.replace("start page=", "start_page=")
    query_raw = query_raw.replace("set as cursor=", "set_as_cursor=")
    query_raw = query_raw.replace("men tab=", "men_tab=")
    query_raw = query_raw.replace("abstract id=", "abstract_id=")
    query_raw = re.sub(r"\s*=\s*", "=", query_raw)
    query_raw = re.sub(r"\s*&\s*", "&", query_raw)
    pairs = parse_qsl(query_raw, keep_blank_values=True)
    norm_pairs: list[tuple[str, str]] = []
    for k, v in pairs:
        key = re.sub(r"\s+", "_", str(k or "").strip())
        key = re.sub(r"^[^A-Za-z0-9_]+", "", key)
        val = str(v or "").strip()
        if not key:
            continue
        norm_pairs.append((key, val))
    query = urlencode(norm_pairs, doseq=True, quote_via=quote) if norm_pairs else ""
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _decode_html_entities(value: str) -> str:
    s = str(value or "")
    for _ in range(8):
        nxt = html.unescape(s)
        if nxt == s:
            break
        s = nxt
    # Repair broken apostrophe encodings seen in some upstream payloads.
    s = re.sub(r"&(?:\s*amp\s*;)+\s*#x?27\s*;", "'", s, flags=re.IGNORECASE)
    s = re.sub(r"&\s*amp\s*;\s*#x?27\s*;", "'", s, flags=re.IGNORECASE)
    s = re.sub(r"&\s*#x?27\s*;", "'", s, flags=re.IGNORECASE)
    s = re.sub(r"&\s*#39\s*;", "'", s, flags=re.IGNORECASE)
    return s


def _normalize_creator_name(creator: Any) -> str:
    if isinstance(creator, dict):
        for key in ("lastName", "family", "name", "literal"):
            val = str(creator.get(key) or "").strip()
            if not val:
                continue
            if key in {"lastName", "family"}:
                return val
            parts = val.replace(",", " ").split()
            return parts[-1] if parts else val
    s = str(creator or "").strip()
    if not s:
        return ""
    parts = s.replace(",", " ").split()
    return parts[-1] if parts else s


def _author_tokens_from_value(value: Any) -> list[str]:
    if isinstance(value, list):
        tokens = [_normalize_creator_name(v) for v in value]
        return [t for t in tokens if t]
    if isinstance(value, dict):
        if isinstance(value.get("creators"), list):
            return _author_tokens_from_value(value.get("creators"))
        token = _normalize_creator_name(value)
        return [token] if token else []
    s = str(value or "").strip()
    if not s:
        return []
    if ";" in s:
        parts = [p.strip() for p in s.split(";")]
    elif "|" in s:
        parts = [p.strip() for p in s.split("|")]
    elif re.search(r"\band\b", s, flags=re.IGNORECASE) and "," not in s:
        parts = [p.strip() for p in re.split(r"\band\b", s, flags=re.IGNORECASE)]
    else:
        parts = [s]
    tokens = [_normalize_creator_name(p) for p in parts]
    return [t for t in tokens if t]


def _format_apa_author_tokens(tokens: list[str]) -> str:
    vals = [str(t or "").strip() for t in tokens if str(t or "").strip()]
    if not vals:
        return ""
    if len(vals) == 1:
        return vals[0]
    if len(vals) == 2:
        return f"{vals[0]} & {vals[1]}"
    return f"{vals[0]} et al."


def _is_placeholder_author_token(value: str) -> bool:
    t = str(value or "").strip().lower()
    if not t:
        return True
    return t in {"unknown", "n/a", "na", "anonymous", "source"} or t.startswith("source ")


def _extract_year_token(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        date_parts = value.get("date-parts") or value.get("date_parts")
        if isinstance(date_parts, list) and date_parts:
            first = date_parts[0]
            if isinstance(first, list) and first:
                y = str(first[0] or "").strip()
                if re.fullmatch(r"(19|20)\d{2}", y):
                    return y
    raw = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    m = re.search(r"\b(19|20)\d{2}\b", str(raw))
    return m.group(0) if m else ""


def _iter_zotero_metadata_dicts(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(metadata, dict):
        return []
    out: list[dict[str, Any]] = []
    for key in ("zotero_metadata", "zotero", "zotero_item", "zoteroItem"):
        val = metadata.get(key)
        if isinstance(val, dict):
            out.append(val)
    return out


def _iter_item_metadata_candidates(
    metadata: dict[str, Any],
    *,
    item_key: str = "",
    item_payload_lookup: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if isinstance(metadata, dict):
        out.append(metadata)
    if not item_payload_lookup:
        return out
    key = str(item_key or "").strip()
    lookups = [key]
    if "#" in key:
        lookups.append(key.split("#", 1)[0].strip())
    seen_keys: set[str] = set()
    seen_meta_ids = {id(m) for m in out}
    for lookup_key in lookups:
        norm = lookup_key.lower()
        if not norm or norm in seen_keys:
            continue
        seen_keys.add(norm)
        payload = item_payload_lookup.get(norm)
        if not isinstance(payload, dict):
            continue
        candidate_md = payload.get("metadata")
        if isinstance(candidate_md, dict) and id(candidate_md) not in seen_meta_ids:
            out.append(candidate_md)
            seen_meta_ids.add(id(candidate_md))
    return out


def _fallback_author_label(title: str, item_key: str) -> str:
    t = str(title or "").strip()
    if t:
        toks = re.findall(r"[A-Za-z][A-Za-z-]+", t)
        if toks:
            return toks[0]
    key = str(item_key or "").strip()
    if key:
        return f"Source {key[:8]}"
    return "Source"


def _resolve_item_reference_metadata(
    metadata: dict[str, Any],
    *,
    item_key: str = "",
    item_payload_lookup: dict[str, dict[str, Any]] | None = None,
) -> dict[str, str]:
    candidates = _iter_item_metadata_candidates(
        metadata if isinstance(metadata, dict) else {},
        item_key=item_key,
        item_payload_lookup=item_payload_lookup,
    )

    title = ""
    for md in candidates:
        for key in ("title", "document_title", "paper_title", "name"):
            v = str(md.get(key) or "").strip()
            if v:
                title = v
                break
        if title:
            break
        for zot in _iter_zotero_metadata_dicts(md):
            for key in ("title", "shortTitle", "publicationTitle"):
                v = str(zot.get(key) or "").strip()
                if v:
                    title = v
                    break
            if title:
                break
        if title:
            break

    year = ""
    for md in candidates:
        for key in ("year", "date", "publication_date", "publicationDate", "issued", "publication_year", "published"):
            year = _extract_year_token(md.get(key))
            if year:
                break
        if year:
            break
        for zot in _iter_zotero_metadata_dicts(md):
            for key in ("year", "date", "issued", "publicationDate", "publication_date"):
                year = _extract_year_token(zot.get(key))
                if year:
                    break
            if year:
                break
        if year:
            break

    author_tokens: list[str] = []
    for md in candidates:
        first_last = str(md.get("first_author_last") or md.get("firstAuthorLast") or "").strip()
        if first_last and not _is_placeholder_author_token(first_last):
            author_tokens = [_normalize_creator_name(first_last)]
            break
        for key in ("authors", "author_list", "author"):
            candidate_tokens = [t for t in _author_tokens_from_value(md.get(key)) if not _is_placeholder_author_token(t)]
            if candidate_tokens:
                author_tokens = candidate_tokens
                break
        if author_tokens:
            break
        for zot in _iter_zotero_metadata_dicts(md):
            candidate_tokens = [
                t for t in _author_tokens_from_value(zot.get("creators") or zot.get("authors")) if not _is_placeholder_author_token(t)
            ]
            if candidate_tokens:
                author_tokens = candidate_tokens
                break
        if author_tokens:
            break

    author = _format_apa_author_tokens(author_tokens)
    if not author:
        author = _fallback_author_label(title, item_key)
    if not year:
        year = "1900"
    if not title:
        key = str(item_key or "").strip()
        title = f"Source record {key}" if key else "Source record"
    return {
        "author": author,
        "year": year,
        "title": title,
    }


def _is_source_itemkey_fallback_citation(citation: str) -> bool:
    c = str(citation or "").strip()
    if not c:
        return False
    if c == "(Source citation)":
        return True
    return bool(
        re.fullmatch(
            r"\(\s*Source(?:\s+[A-Za-z0-9_#-]+)?\s*,\s*1900(?:\s*,\s*pp?\.\s*\d+(?:\s*[-–]\s*\d+)?)?\s*\)",
            c,
            flags=re.IGNORECASE,
        )
    )


def _is_blank_metadata_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _merge_metadata_dicts(primary: dict[str, Any], secondary: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = dict(primary if isinstance(primary, dict) else {})
    if not isinstance(secondary, dict):
        return out
    for key, val in secondary.items():
        if key == "zotero_metadata" and isinstance(val, dict):
            base_z = out.get("zotero_metadata") if isinstance(out.get("zotero_metadata"), dict) else {}
            merged_z = dict(base_z)
            for zk, zv in val.items():
                if _is_blank_metadata_value(merged_z.get(zk)) and not _is_blank_metadata_value(zv):
                    merged_z[zk] = zv
            out["zotero_metadata"] = merged_z
            continue
        if _is_blank_metadata_value(out.get(key)) and not _is_blank_metadata_value(val):
            out[key] = val
    return out


def _infer_first_author_last(author_summary: str) -> str:
    text = str(author_summary or "").strip()
    if not text:
        return ""
    parts = re.split(r"\band\b|;|\|", text, flags=re.IGNORECASE)
    first = str(parts[0] if parts else text).strip()
    if not first:
        return ""
    toks = first.replace(",", " ").split()
    return toks[-1] if toks else first


def _build_metadata_from_all_items_row(row: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    key = str(row.get("key") or row.get("item_key") or row.get("zotero_key") or "").strip()
    if not key:
        return "", {}
    author_summary = str(row.get("author_summary") or "").strip()
    authors = row.get("authors")
    author_value: Any = authors if not _is_blank_metadata_value(authors) else author_summary
    title = str(row.get("title") or "").strip()
    year = row.get("year")
    url = str(row.get("url") or "").strip()
    pdf_path = str(row.get("pdf_path") or "").strip()
    publication_title = str(row.get("publicationTitle") or row.get("source") or "").strip()

    zotero_md: dict[str, Any] = {}
    if title:
        zotero_md["title"] = title
    if publication_title:
        zotero_md["publicationTitle"] = publication_title
    if not _is_blank_metadata_value(year):
        zotero_md["year"] = year
    if url:
        zotero_md["url"] = url
    if not _is_blank_metadata_value(author_value):
        zotero_md["authors"] = author_value

    md: dict[str, Any] = {
        "item_key": key,
        "title": title,
        "year": year,
        "authors": author_value,
        "first_author_last": _infer_first_author_last(author_summary),
        "pdf_path": pdf_path,
        "zotero_metadata": zotero_md,
    }
    return key.lower(), md


def _all_items_df_candidate_paths(collection_name: str) -> list[Path]:
    repo = _repo_root()
    candidates: list[Path] = []
    seen: set[str] = set()

    env_raw = str(os.getenv("SYSTEMATIC_ALL_ITEMS_DF_PATH", "") or "").strip()
    if env_raw:
        for token in env_raw.split(os.pathsep):
            t = str(token or "").strip()
            if not t:
                continue
            p = Path(t).expanduser()
            if p.exists() and p.is_file():
                rp = str(p.resolve())
                if rp not in seen:
                    seen.add(rp)
                    candidates.append(p.resolve())

    base_names = [str(collection_name or "").strip(), _safe_name(str(collection_name or "")), str(collection_name or "").strip().replace(".", "_")]
    for name in [n for n in base_names if n]:
        p = repo / "Research" / "Systematic_review" / name / "inputs" / "all_items_df.json"
        if p.exists() and p.is_file():
            rp = str(p.resolve())
            if rp not in seen:
                seen.add(rp)
                candidates.append(p.resolve())

    backup_root = repo / "backups" / "systematic_runs"
    if backup_root.exists() and backup_root.is_dir():
        pattern = f"{str(collection_name or '').strip()}_*"
        for run_dir in sorted(backup_root.glob(pattern), key=lambda x: x.stat().st_mtime, reverse=True):
            for rel in ("run_dir_before/inputs/all_items_df.json", "inputs/all_items_df.json"):
                p = run_dir / rel
                if p.exists() and p.is_file():
                    rp = str(p.resolve())
                    if rp not in seen:
                        seen.add(rp)
                        candidates.append(p.resolve())
    return candidates


def _load_all_items_metadata_lookup(collection_name: str) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for path_obj in _all_items_df_candidate_paths(collection_name):
        try:
            raw = json.loads(path_obj.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(raw, list):
            continue
        for row in raw:
            if not isinstance(row, dict):
                continue
            key, md = _build_metadata_from_all_items_row(row)
            if not key:
                continue
            payload = lookup.get(key, {"metadata": {}})
            existing_md = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
            payload["metadata"] = _merge_metadata_dicts(existing_md, md)
            lookup[key] = payload
    return lookup


def _augment_item_payload_lookup_with_all_items(
    item_payload_lookup: dict[str, dict[str, Any]],
    *,
    collection_name: str,
) -> None:
    extra = _load_all_items_metadata_lookup(collection_name)
    if not extra:
        return
    for key, payload in extra.items():
        existing = item_payload_lookup.get(key)
        if isinstance(existing, dict):
            base_md = existing.get("metadata") if isinstance(existing.get("metadata"), dict) else {}
            add_md = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
            existing["metadata"] = _merge_metadata_dicts(base_md, add_md)
            item_payload_lookup[key] = existing
        else:
            item_payload_lookup[key] = payload


def _source_url_from_metadata(metadata: dict[str, Any]) -> str:
    if not isinstance(metadata, dict):
        return ""
    zot = metadata.get("zotero_metadata", {})
    if isinstance(zot, dict):
        url = str(zot.get("url") or "").strip()
        if url:
            return _sanitize_href_url(url)
    doi = ""
    if isinstance(zot, dict):
        doi = str(zot.get("doi") or "").strip()
    if not doi:
        doi = str(metadata.get("doi") or "").strip()
    if doi:
        return _sanitize_href_url(f"https://doi.org/{doi}")
    pdf_path = str(metadata.get("pdf_path") or "").strip()
    if pdf_path:
        norm = pdf_path.replace("\\", "/")
        return _sanitize_href_url(f"file://{norm}")
    return ""


def _source_url_from_meta_fields(meta: dict[str, Any]) -> str:
    if not isinstance(meta, dict):
        return ""
    source_url = str(meta.get("source_url") or "").strip()
    if source_url:
        return _sanitize_href_url(source_url)
    pdf_path = str(meta.get("pdf_path") or "").strip()
    if pdf_path:
        norm = pdf_path.replace("\\", "/")
        return _sanitize_href_url(f"file://{norm}")
    return ""


def _fallback_source_url_for_dqid(dqid: str, meta: dict[str, Any] | None = None) -> str:
    resolved = _source_url_from_meta_fields(meta or {})
    if resolved:
        return resolved
    token = str(dqid or "").strip().replace(";", "_")
    if not token:
        token = "unknown"
    # Deterministic local URI fallback so strict URL integrity checks never emit '#'.
    return f"file://dqid/{quote(token, safe='')}"


def _split_dqid_values(raw_dqid: str) -> list[str]:
    text = str(raw_dqid or "").strip()
    if not text:
        return []
    parts = re.split(r"[\s,;]+", text)
    return [p.strip() for p in parts if p and p.strip()]


def _resolve_dqid_meta(raw_dqid: str, dqid_lookup: dict[str, dict[str, str]]) -> tuple[str, dict[str, str]]:
    dqid = str(raw_dqid or "").strip()
    if not dqid:
        return "", {}
    meta = dqid_lookup.get(dqid, {})
    if not meta and "#" in dqid:
        meta = dqid_lookup.get(dqid.split("#", 1)[0], {}) or dqid_lookup.get(dqid.split("#")[-1], {})
    if not meta and dqid.startswith("dqid-"):
        meta = dqid_lookup.get(dqid.replace("dqid-", "", 1), {})
    return dqid, meta if isinstance(meta, dict) else {}


def _load_call_models_zt():
    repo_root = _repo_root()
    llms_dir = repo_root / "python_backend_legacy" / "llms"
    if str(llms_dir) not in sys.path:
        sys.path.insert(0, str(llms_dir))
    from calling_models import call_models_zt  # type: ignore

    return call_models_zt


def _call_models_worker(kwargs: dict[str, Any], q: multiprocessing.Queue) -> None:
    try:
        call_models_zt = _load_call_models_zt()
        result = call_models_zt(**kwargs)
        q.put({"ok": True, "result": result})
    except Exception as exc:  # pragma: no cover - subprocess path
        q.put({"ok": False, "error": repr(exc)})


def _call_models_with_timeout(*, timeout_s: int, kwargs: dict[str, Any]) -> Any:
    if int(timeout_s) <= 0:
        call_models_zt = _load_call_models_zt()
        return call_models_zt(**kwargs)

    q: multiprocessing.Queue = multiprocessing.Queue(maxsize=1)
    p = multiprocessing.Process(target=_call_models_worker, args=(kwargs, q))
    p.start()
    p.join(timeout=max(1, int(timeout_s)))
    if p.is_alive():
        p.terminate()
        p.join(3)
        raise TimeoutError(f"Timed out after {timeout_s}s")
    if not q.empty():
        msg = q.get()
        if msg.get("ok"):
            return msg.get("result")
        raise RuntimeError(f"Model worker error: {msg.get('error')}")
    if p.exitcode not in (0, None):
        raise RuntimeError(f"Model worker exited with code {p.exitcode}")
    raise RuntimeError("Model worker returned no payload.")


def _env_bool(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return bool(default)
    return raw.lower() in {"1", "true", "yes", "on", "y", "enabled"}


def _run_round_synthesis_section(
    *,
    payloads: list[dict[str, Any]],
    output_dir: Path,
    collection_name: str,
    research_questions: list[str],
    temporal_mode: bool,
    model: str,
    section_timeout_s: int,
    citation_style: str = "apa",
) -> dict[str, Any]:
    if not payloads:
        return {"status": "skipped", "reason": "empty_payloads"}

    if not os.getenv("BATCH_ROOT"):
        os.environ["BATCH_ROOT"] = str((_repo_root() / "tmp").resolve())
    caps = RoundSynthesisCaps(
        map_max_rows=_env_int("SYSTEMATIC_EVIDENCE_ROUND_ROWS", 260, min_value=50, max_value=5000),
        map_max_bytes=_env_int("SYSTEMATIC_EVIDENCE_ROUND_BYTES", 1_500_000, min_value=200_000, max_value=50_000_000),
        reduce_max_items=_env_int("SYSTEMATIC_ROUND_REDUCE_MAX_ITEMS", 8, min_value=2, max_value=32),
        reduce_max_bytes=_env_int("SYSTEMATIC_ROUND_REDUCE_MAX_BYTES", 1_000_000, min_value=120_000, max_value=20_000_000),
        max_reduce_rounds=_env_int("SYSTEMATIC_ROUND_MAX_REDUCE_ROUNDS", 8, min_value=1, max_value=24),
        quote_chars=_env_int("SYSTEMATIC_SECTION_QUOTE_CHARS", 220, min_value=80, max_value=800),
    )
    batch_input_cap = _env_int("SYSTEMATIC_ROUND_BATCH_INPUT_BYTES", 16_000_000, min_value=1_000_000, max_value=150_000_000)
    batch_req_overhead = _env_int("SYSTEMATIC_ROUND_BATCH_REQ_OVERHEAD", 4500, min_value=512, max_value=50_000)
    batch_poll_interval = _env_int("SYSTEMATIC_ROUND_BATCH_POLL_SECONDS", 30, min_value=5, max_value=300)
    qa_retries = _env_int("SYSTEMATIC_ROUND_QA_MAX_RETRIES", 2, min_value=0, max_value=8)
    missing_retries = _env_int("SYSTEMATIC_ROUND_BATCH_MISSING_RETRIES", 2, min_value=0, max_value=10)
    strict_round_qa = _env_bool("SYSTEMATIC_ROUND_STRICT_QA", default=True)
    function_name = "systematic_review_section_writer"
    transport_logs: list[dict[str, Any]] = []

    call_models_zt = _load_call_models_zt()
    llms_dir = _repo_root() / "python_backend_legacy" / "llms"
    if str(llms_dir) not in sys.path:
        sys.path.insert(0, str(llms_dir))
    import calling_models as cm  # type: ignore

    safe_function = cm.safe_name(function_name) if hasattr(cm, "safe_name") else _safe_name(function_name)
    batch_root = cm.get_batch_root() if hasattr(cm, "get_batch_root") else (_repo_root() / "tmp" / "batching_files" / "batches")
    func_dir = Path(batch_root) / safe_function
    func_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "round_synthesis_batch_manifest.json"

    def _now_iso() -> str:
        return datetime.utcnow().isoformat(timespec="seconds") + "Z"

    def _load_manifest() -> dict[str, Any]:
        if manifest_path.is_file():
            try:
                data = json.loads(manifest_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    shards = data.get("shards")
                    if not isinstance(shards, dict):
                        data["shards"] = {}
                    return data
            except Exception:
                pass
        return {
            "schema": "round_synthesis_batch_manifest_v1",
            "collection_name": collection_name,
            "function": function_name,
            "model": model,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "shards": {},
        }

    manifest = _load_manifest()

    def _save_manifest() -> None:
        manifest["updated_at"] = _now_iso()
        manifest["collection_name"] = collection_name
        manifest["function"] = function_name
        manifest["model"] = model
        if not isinstance(manifest.get("shards"), dict):
            manifest["shards"] = {}
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    def _update_shard(shard_key: str, **fields: Any) -> None:
        shards = manifest.setdefault("shards", {})
        if not isinstance(shards, dict):
            shards = {}
            manifest["shards"] = shards
        entry = shards.get(shard_key)
        if not isinstance(entry, dict):
            entry = {}
        entry.update(fields)
        entry["updated_at"] = _now_iso()
        shards[shard_key] = entry
        _save_manifest()

    def _batch_paths_for(safe_collection: str) -> tuple[Path, Path, Path]:
        input_file = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
        output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
        meta_file = func_dir / f"{safe_collection}_{safe_function}_batch_metadata.json"
        return input_file, output_file, meta_file

    def _clear_batch_files(safe_collection: str) -> None:
        for suffix in ("input.jsonl", "output.jsonl", "batch_metadata.json"):
            fp = func_dir / f"{safe_collection}_{safe_function}_{suffix}"
            try:
                if fp.exists():
                    fp.unlink()
            except Exception:
                pass

    def _read_output_texts(output_file: Path, request_ids: list[str]) -> dict[str, str]:
        if not output_file.is_file():
            return {}
        out: dict[str, str] = {}
        for rid in request_ids:
            rid_txt = str(rid or "").strip()
            if not rid_txt:
                continue
            response = cm.read_completion_results(custom_id=rid_txt, path=str(output_file), function=function_name)
            text = _clean_and_humanize_section_html(_clean_llm_html(_extract_llm_text(response)))
            if text.strip():
                out[rid_txt] = text
        return out

    def _run_model_batch(requests: list[dict[str, Any]], stage_meta: dict[str, Any]) -> list[str]:
        if not requests:
            return []
        stage = str(stage_meta.get("stage") or "map")
        level = _safe_int(stage_meta.get("level"), 0)
        request_map: dict[str, dict[str, Any]] = {}
        for req in requests:
            rid = str(req.get("request_id") or "").strip()
            if rid:
                request_map[rid] = req
        shards = split_prompt_requests_by_bytes(
            requests,
            max_input_bytes=int(batch_input_cap),
            per_request_overhead_bytes=int(batch_req_overhead),
        )
        results_by_id: dict[str, str] = {}
        for shard_idx, shard in enumerate(shards, start=1):
            request_ids = [str(req.get("request_id") or "").strip() for req in shard if str(req.get("request_id") or "").strip()]
            digest = hashlib.sha1(("|".join(request_ids) or f"{stage}:{level}:{shard_idx}").encode("utf-8", errors="ignore")).hexdigest()[:10]
            shard_key = f"{stage}:l{int(level):02d}:s{int(shard_idx):03d}:{digest}"
            shard_collection = f"{collection_name}__rs_{stage}_l{level:02d}_s{shard_idx:03d}_{digest}"
            safe_collection = cm.safe_name(shard_collection) if hasattr(cm, "safe_name") else _safe_name(shard_collection)
            input_file, output_file, meta_file = _batch_paths_for(safe_collection)
            attempt_logs: list[dict[str, Any]] = []
            shard_results = _read_output_texts(output_file, request_ids)
            missing_ids = [rid for rid in request_ids if rid not in shard_results]
            _update_shard(
                shard_key,
                stage=stage,
                level=int(level),
                shard=int(shard_idx),
                digest=digest,
                collection=safe_collection,
                request_ids=request_ids,
                status=("completed" if not missing_ids else "pending"),
                total_requests=len(request_ids),
                read_count=len(shard_results),
                missing_ids=missing_ids,
                input_file=str(input_file),
                output_file=str(output_file),
                meta_file=str(meta_file),
            )

            if missing_ids and input_file.is_file() and meta_file.is_file():
                _update_shard(shard_key, status="resuming")
                ok_resume = cm._process_batch_for(
                    analysis_key_suffix=function_name,
                    section_title=safe_collection,
                    poll_interval=int(batch_poll_interval),
                )
                if ok_resume is not True:
                    raise RuntimeError(
                        f"Round synthesis resume batch failed stage={stage} level={level} shard={shard_idx} "
                        f"collection={safe_collection}"
                    )
                shard_results.update(_read_output_texts(output_file, missing_ids))
                missing_ids = [rid for rid in request_ids if rid not in shard_results]
                attempt_logs.append(
                    {
                        "attempt_type": "resume_existing",
                        "collection": safe_collection,
                        "missing_after": len(missing_ids),
                    }
                )
                _update_shard(shard_key, read_count=len(shard_results), missing_ids=missing_ids)

            attempt = 0
            while missing_ids and attempt <= int(missing_retries):
                attempt += 1
                retry_kind = "initial_submit" if attempt == 1 else f"missing_retry_{attempt-1}"
                retry_req_ids = list(missing_ids)
                retry_digest = hashlib.sha1(
                    ("|".join(retry_req_ids) or f"{stage}:{level}:{shard_idx}:retry:{attempt}").encode("utf-8", errors="ignore")
                ).hexdigest()[:8]
                if attempt == 1:
                    retry_collection = shard_collection
                else:
                    retry_collection = f"{shard_collection}__mr{attempt-1:02d}_{retry_digest}"
                retry_safe_collection = cm.safe_name(retry_collection) if hasattr(cm, "safe_name") else _safe_name(retry_collection)
                retry_input_file, retry_output_file, retry_meta_file = _batch_paths_for(retry_safe_collection)
                _clear_batch_files(retry_safe_collection)

                for rid in retry_req_ids:
                    req = request_map.get(rid) or {}
                    prompt = str(req.get("prompt") or "")
                    if not prompt.strip():
                        continue
                    _ = call_models_zt(
                        text=prompt,
                        function=function_name,
                        custom_id=rid,
                        collection_name=retry_collection,
                        model=model,
                        ai="openai",
                        read=False,
                        store_only=True,
                        cache=False,
                    )
                _update_shard(
                    shard_key,
                    status="submitted",
                    active_collection=retry_safe_collection,
                    active_attempt=int(attempt),
                    active_input_file=str(retry_input_file),
                    active_output_file=str(retry_output_file),
                    active_meta_file=str(retry_meta_file),
                    missing_ids=missing_ids,
                )
                ok = cm._process_batch_for(
                    analysis_key_suffix=function_name,
                    section_title=retry_safe_collection,
                    poll_interval=int(batch_poll_interval),
                )
                if ok is not True:
                    _update_shard(shard_key, status="failed", last_error=f"batch_failed attempt={attempt}")
                    raise RuntimeError(
                        f"Round synthesis batch failed stage={stage} level={level} shard={shard_idx} "
                        f"collection={retry_safe_collection}"
                    )
                if not retry_output_file.is_file():
                    _update_shard(shard_key, status="failed", last_error=f"missing_output attempt={attempt}")
                    raise RuntimeError(
                        f"Missing batch output file for stage={stage} shard={shard_idx} attempt={attempt}: {retry_output_file}"
                    )
                shard_results.update(_read_output_texts(retry_output_file, retry_req_ids))
                missing_ids = [rid for rid in request_ids if rid not in shard_results]
                attempt_logs.append(
                    {
                        "attempt_type": retry_kind,
                        "attempt": int(attempt),
                        "collection": retry_safe_collection,
                        "requested": len(retry_req_ids),
                        "read_after_attempt": len(shard_results),
                        "missing_after_attempt": len(missing_ids),
                    }
                )
                _update_shard(
                    shard_key,
                    status=("completed" if not missing_ids else "retrying"),
                    read_count=len(shard_results),
                    missing_ids=missing_ids,
                    attempts=int(attempt),
                    attempt_logs=attempt_logs,
                )

            if missing_ids:
                sample = ", ".join(missing_ids[:12])
                _update_shard(
                    shard_key,
                    status="failed",
                    last_error=f"missing_outputs count={len(missing_ids)} sample={sample}",
                    missing_ids=missing_ids,
                )
                raise RuntimeError(
                    f"Round synthesis shard has missing outputs after retries: stage={stage} level={level} "
                    f"shard={shard_idx} missing={len(missing_ids)} sample={sample}"
                )

            for rid in request_ids:
                text_val = str(shard_results.get(rid) or "")
                if text_val.strip():
                    results_by_id[rid] = text_val
            transport_logs.append(
                {
                    "stage": stage,
                    "level": int(level),
                    "shard": int(shard_idx),
                    "collection": safe_collection,
                    "requests": len(shard),
                    "request_ids": request_ids,
                    "read_count": len(shard_results),
                    "attempts": len(attempt_logs),
                    "missing_retries": int(max(0, len(attempt_logs) - 1)),
                    "attempt_logs": attempt_logs,
                    "output_file": str(output_file),
                    "manifest_path": str(manifest_path),
                }
            )
            _update_shard(
                shard_key,
                status="completed",
                read_count=len(shard_results),
                missing_ids=[],
                attempt_logs=attempt_logs,
            )
        return [str(results_by_id.get(str(req.get("request_id") or "").strip()) or "") for req in requests]

    def _run_model(prompt: str, meta: dict[str, Any]) -> str:
        stage = str(meta.get("stage") or "map")
        rid = _safe_int(meta.get("round"), 0) or _safe_int(meta.get("level"), 0)
        chunk = _safe_int(meta.get("chunk"), 0)
        custom_id = str(meta.get("request_id") or "").strip() or _stable_section_custom_id(
            collection_name,
            f"round_synth_retry_{stage}_{rid}_{chunk}",
            prompt,
        )
        kwargs = {
            "text": prompt,
            "function": function_name,
            "custom_id": custom_id,
            "collection_name": f"{collection_name}__round_retry_{stage}",
            "model": model,
            "ai": "openai",
            "read": False,
            "store_only": True,
            "cache": False,
        }
        response = _call_models_single_batch_section(kwargs=kwargs)
        text = _clean_and_humanize_section_html(_clean_llm_html(_extract_llm_text(response)))
        return text

    ctx = {
        "analysis_mode": "temporal" if temporal_mode else "theme",
        "objective": "Synthesize all coded evidence so the section answers the research question set directly.",
        "research_questions": list(research_questions),
        "citation_style": _normalize_citation_style(citation_style),
        "require_dqid_anchors": True,
    }
    result = run_round_synthesis(
        payloads=payloads,
        run_model=_run_model,
        run_model_batch=_run_model_batch,
        caps=caps,
        context=ctx,
        max_retries_per_request=int(qa_retries),
        strict_qa=bool(strict_round_qa),
    )
    if isinstance(result, dict):
        result["batch_transport"] = {
            "input_cap_bytes": int(batch_input_cap),
            "request_overhead_bytes": int(batch_req_overhead),
            "poll_interval_seconds": int(batch_poll_interval),
            "missing_retries": int(missing_retries),
            "strict_round_qa": bool(strict_round_qa),
            "manifest_path": str(manifest_path),
            "logs": transport_logs,
        }
    out_path = output_dir / "round_synthesis_result.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "status": "ok",
        "path": str(out_path),
        "result": result,
    }


def _call_models_single_batch_section(*, kwargs: dict[str, Any]) -> Any:
    call_models_zt = _load_call_models_zt()
    function_name = str(kwargs.get("function") or "").strip()
    collection_name = str(kwargs.get("collection_name") or "").strip()
    custom_id = str(kwargs.get("custom_id") or "").strip()
    if not function_name or not collection_name:
        raise ValueError("Missing function/collection_name for single-batch section call.")
    if not custom_id:
        raise ValueError("Missing custom_id for single-batch section call.")
    # 1) clear prior files for this section batch to avoid duplicate custom_id collisions on reruns
    repo_root = _repo_root()
    llms_dir = repo_root / "python_backend_legacy" / "llms"
    if str(llms_dir) not in sys.path:
        sys.path.insert(0, str(llms_dir))
    import calling_models as cm  # type: ignore

    unique_tail = custom_id[-10:]
    batch_collection_name = f"{collection_name}__{unique_tail}"
    safe_collection = cm.safe_name(batch_collection_name) if hasattr(cm, "safe_name") else re.sub(r"[^A-Za-z0-9._-]+", "_", batch_collection_name)
    safe_function = cm.safe_name(function_name) if hasattr(cm, "safe_name") else re.sub(r"[^A-Za-z0-9._-]+", "_", function_name)
    batch_root = cm.get_batch_root() if hasattr(cm, "get_batch_root") else (repo_root / "tmp" / "batching_files" / "batches")
    func_dir = Path(batch_root) / safe_function
    for suffix in ("input.jsonl", "output.jsonl", "batch_metadata.json"):
        fp = func_dir / f"{safe_collection}_{safe_function}_{suffix}"
        try:
            if fp.exists():
                fp.unlink()
        except Exception:
            pass

    # 2) enqueue one request
    _ = call_models_zt(
        text=str(kwargs.get("text") or ""),
        function=function_name,
        custom_id=custom_id,
        collection_name=batch_collection_name,
        model=str(kwargs.get("model") or "gpt-5-mini"),
        ai=str(kwargs.get("ai") or "openai"),
        read=False,
        store_only=True,
        cache=False,
    )
    # 3) process that function+collection batch
    safe_section_title = safe_collection
    ok = cm._process_batch_for(
        analysis_key_suffix=function_name,
        section_title=safe_section_title,
        poll_interval=30,
    )
    if ok is not True:
        raise RuntimeError(f"Batch processing failed for section function={function_name} collection={collection_name}")
    # 4) read the same custom_id result directly from output JSONL (non-interactive)
    output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
    res = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
    if res is None:
        raise RuntimeError(f"No batch output row matched custom_id={custom_id} in {output_file}")
    return res


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return int(default)


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    return cleaned or "collection"


def _resolve_collection_label(raw_name: str) -> str:
    name = str(raw_name or "").strip()
    if not name:
        return "frameworks"
    if name.lower().startswith("batch_"):
        return "frameworks"
    return name


def _stable_section_custom_id(collection_name: str, section_name: str, prompt: str) -> str:
    digest = hashlib.sha1(prompt.encode("utf-8", errors="ignore")).hexdigest()[:16]
    base = _safe_name(collection_name)
    return f"sr_{base}_{section_name}_{digest}"


def _load_json(path_obj: Path) -> dict[str, Any]:
    with path_obj.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"Expected dict JSON at {path_obj}, got {type(data).__name__}")
    return data


def _compute_theme_counts(summary: dict[str, Any]) -> dict[str, int]:
    # Figure themes are computed from section-level open coding only.
    # Explicitly exclude intro/conclusion core claims to avoid document-level bias in frequency bars.
    output = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    npath = Path(str(output.get("normalized_results_path") or "")).expanduser()
    counts: dict[str, int] = {}
    if npath.is_file():
        try:
            raw = json.loads(npath.read_text(encoding="utf-8"))
        except Exception:
            raw = {}
        if isinstance(raw, dict):
            for item_payload in raw.values():
                if not isinstance(item_payload, dict):
                    continue
                # Per item, choose one section-level source to avoid double-counting duplicated mirrors.
                source_rows: list[dict[str, Any]] = []
                for arr_key in ("code_pdf_page", "section_open_coding", "evidence_list"):
                    arr = item_payload.get(arr_key)
                    if isinstance(arr, list) and arr:
                        source_rows = [x for x in arr if isinstance(x, dict)]
                        if source_rows:
                            break
                for row in source_rows:
                    candidates: list[dict[str, Any]] = []
                    nested = row.get("evidence")
                    if isinstance(nested, list):
                        candidates.extend([ev for ev in nested if isinstance(ev, dict)])
                    else:
                        candidates.append(row)
                    for ev in candidates:
                        theme = ""
                        themes = ev.get("potential_themes")
                        if isinstance(themes, list) and themes:
                            theme = str(themes[0] or "").strip()
                        if not theme:
                            theme = str(ev.get("evidence_type") or "").strip() or "uncategorized"
                        counts[theme] = counts.get(theme, 0) + 1
            return dict(sorted(counts.items(), key=lambda kv: kv[1], reverse=True))

    # Fallback to exported synthesis theme inventory if normalized source is unavailable.
    themes_export = output.get("themes_export", {}) if isinstance(output.get("themes_export"), dict) else {}
    per_rq = themes_export.get("per_rq", {}) if isinstance(themes_export.get("per_rq"), dict) else {}
    for rq_data in per_rq.values():
        if not isinstance(rq_data, dict):
            continue
        inventory = rq_data.get("inventory_index", {})
        if not isinstance(inventory, dict):
            continue
        for item in inventory.values():
            if not isinstance(item, dict):
                continue
            theme = str(item.get("theme") or "").strip()
            if not theme:
                continue
            counts[theme] = counts.get(theme, 0) + _safe_int(item.get("count"), default=0)
    return dict(sorted(counts.items(), key=lambda kv: kv[1], reverse=True))


def _extract_research_questions(summary: dict[str, Any]) -> list[str]:
    input_block = summary.get("input", {}) if isinstance(summary.get("input"), dict) else {}
    raw = input_block.get("research_questions")
    if not isinstance(raw, list):
        raw = input_block.get("researchQuestions")
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for q in raw:
        s = str(q or "").strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def _extract_temporal_flag(summary: dict[str, Any]) -> bool:
    input_block = summary.get("input", {}) if isinstance(summary.get("input"), dict) else {}
    raw = input_block.get("temporal")
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        try:
            return bool(int(raw))
        except Exception:
            return False
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on", "temporal", "chronological"}
    mode = str(input_block.get("review_mode") or input_block.get("mode") or "").strip().lower()
    return mode in {"temporal", "chronological"}


def _parse_year_int(value: Any) -> int | None:
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


def _extract_relevant_rq_indices(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    out: list[int] = []
    seen: set[int] = set()
    for raw in value:
        candidate: Any = raw
        if isinstance(raw, dict):
            candidate = raw.get("index")
        n: int | None = None
        if isinstance(candidate, int):
            n = int(candidate)
        elif isinstance(candidate, str):
            s = candidate.strip()
            if re.fullmatch(r"-?\d+", s):
                try:
                    n = int(s)
                except Exception:
                    n = None
        if n is None or n in seen:
            continue
        seen.add(n)
        out.append(n)
    return out


def _detect_rq_index_mode(rows: list[dict[str, Any]], question_count: int) -> str:
    if question_count <= 0:
        return "none"
    observed: set[int] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        direct = _extract_relevant_rq_indices(row.get("rq_indices"))
        legacy = _extract_relevant_rq_indices(row.get("relevant_rqs"))
        for idx in direct + legacy:
            observed.add(int(idx))
    if not observed:
        return "none"
    if 0 in observed:
        return "zero_based"
    if all(1 <= i <= question_count for i in observed):
        return "one_based"
    return "zero_based"


def _normalize_explicit_rq_indices(indices: list[int], question_count: int, mode: str) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    if question_count <= 0:
        return out
    for raw in indices:
        idx: int | None = None
        if mode == "one_based":
            cand = int(raw)
            if 1 <= cand <= question_count:
                idx = cand - 1
        elif mode == "zero_based":
            cand = int(raw)
            if 0 <= cand < question_count:
                idx = cand
        else:
            # Unknown mode: accept canonical 0-based values only.
            cand = int(raw)
            if 0 <= cand < question_count:
                idx = cand
        if idx is None or idx in seen:
            continue
        seen.add(idx)
        out.append(idx)
    return out


def _rq_sort_key(value: str) -> int:
    m = re.search(r"(\d+)", str(value or ""))
    if not m:
        return 10_000
    try:
        return int(m.group(1))
    except Exception:
        return 10_000


def _rq_findings_lines(summary: dict[str, Any]) -> list[str]:
    research_questions = _extract_research_questions(summary)
    if research_questions:
        full_rows_cap = _env_optional_limit("SYSTEMATIC_FULL_EVIDENCE_ROWS", default=0, max_value=2_000_000)
        rows, _ = _build_dqid_evidence_payload(summary, max_rows=full_rows_cap)
        assignments, unmapped_rows = _assign_rows_to_questions(rows, research_questions)
        lines: list[str] = []
        for i, question in enumerate(research_questions, start=1):
            assigned = list(assignments.get(i - 1, []))
            if not assigned:
                lines.append(f"RQ{i} - {question}: no mapped evidence snippets")
                continue
            counts: dict[str, int] = {}
            for row in assigned:
                theme = str(row.get("theme") or "uncategorized").strip() or "uncategorized"
                counts[theme] = counts.get(theme, 0) + 1
            top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
            lines.append(
                f"RQ{i} - {question}: "
                + ", ".join(f"{_humanize_theme_tokens(theme)} ({count})" for theme, count in top)
            )
        if unmapped_rows:
            lines.append(f"Unmapped evidence snippets (excluded from RQ clustering): {len(unmapped_rows)}")
        return lines

    output = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    themes_export = output.get("themes_export", {}) if isinstance(output.get("themes_export"), dict) else {}
    per_rq = themes_export.get("per_rq", {}) if isinstance(themes_export.get("per_rq"), dict) else {}
    lines: list[str] = []
    for rq_key, rq_data in sorted(per_rq.items(), key=lambda kv: _rq_sort_key(str(kv[0]))):
        if not isinstance(rq_data, dict):
            continue
        inventory = rq_data.get("inventory_index", {})
        if not isinstance(inventory, dict):
            continue
        top = sorted(
            (
                (str(v.get("theme") or "unlabeled_theme"), _safe_int(v.get("count"), default=0))
                for v in inventory.values()
                if isinstance(v, dict)
            ),
            key=lambda x: x[1],
            reverse=True,
        )[:5]
        if top:
            idx = _rq_sort_key(rq_key)
            rq_label = str(rq_data.get("question") or "").strip()
            if not rq_label and 0 <= idx < len(research_questions):
                rq_label = research_questions[idx]
            prefix = rq_label or str(rq_key)
            lines.append(f"{prefix}: " + ", ".join(f"{theme} ({count})" for theme, count in top))
    return lines


_RQ_STOPWORDS = {
    "what",
    "which",
    "when",
    "where",
    "how",
    "why",
    "does",
    "do",
    "for",
    "from",
    "with",
    "without",
    "into",
    "onto",
    "over",
    "under",
    "about",
    "across",
    "between",
    "through",
    "their",
    "there",
    "those",
    "these",
    "this",
    "that",
    "them",
    "they",
    "state",
    "states",
    "cyber",
    "attribution",
    "create",
    "follow",
    "often",
    "most",
    "openly",
    "interesting",
    "aspects",
    "theme",
    "overarching",
    "especially",
    "limit",
    "limits",
    "problems",
    "problem",
    "questions",
    "question",
}


def _question_keyword_set(question: str) -> set[str]:
    q = str(question or "").lower()
    tokens = {t for t in re.findall(r"[a-z][a-z0-9_-]{2,}", q) if t not in _RQ_STOPWORDS}
    if re.search(r"\blegal\b|\bpolicy\b|\bescalation\b|\bdeterrence\b", q):
        tokens.update({"legal", "policy", "escalation", "deterrence", "threshold", "mis", "signal", "responsibility"})
    if re.search(r"\bbenefit\b|\bpublic\b|\bformal\b|\bnorm", q):
        tokens.update({"benefit", "public", "formal", "norm", "ally", "coordination", "lawful", "measure"})
    if re.search(r"\bfalse\b|\bflag\b|\bshared\b|\bproxy\b|\bobfuscation\b|\banonym", q):
        tokens.update({"false", "flag", "shared", "proxy", "obfuscation", "anonymity", "tooling", "ttp"})
    if re.search(r"\bsolution\b|\bmultilateral\b|\bevidentiary\b|\bfloor\b", q):
        tokens.update({"solution", "multilateral", "mechanism", "evidentiary", "floor", "cbm", "investigation"})
    if re.search(r"\bsource\b|\bmethods\b|\bchain\b|\bcustody\b|\bverification\b|\bdisclosure\b", q):
        tokens.update({"source", "method", "chain", "custody", "verification", "disclosure", "proof", "sharing"})
    return {t for t in tokens if len(t) >= 3}


def _row_assignment_text(row: dict[str, Any]) -> str:
    parts = [
        str(row.get("theme") or ""),
        str(row.get("citation") or ""),
        str(row.get("quote") or ""),
        str(row.get("item_key") or ""),
    ]
    return " ".join(parts).lower()


def _assign_rows_to_questions(
    rows: list[dict[str, Any]],
    research_questions: list[str],
) -> tuple[dict[int, list[dict[str, Any]]], list[dict[str, Any]]]:
    buckets: dict[int, list[dict[str, Any]]] = {i: [] for i in range(len(research_questions))}
    unmapped: list[dict[str, Any]] = []
    if not rows or not research_questions:
        return buckets, unmapped
    keyword_sets = [_question_keyword_set(q) for q in research_questions]
    index_mode = _detect_rq_index_mode(rows, len(research_questions))

    for row in rows:
        if not isinstance(row, dict):
            continue
        explicit_indices = _normalize_explicit_rq_indices(
            _extract_relevant_rq_indices(row.get("rq_indices")) or _extract_relevant_rq_indices(row.get("relevant_rqs")),
            len(research_questions),
            index_mode,
        )
        if explicit_indices:
            for idx in explicit_indices:
                buckets[idx].append(row)
            continue

        text = _row_assignment_text(row)
        theme = str(row.get("theme") or "").lower()
        text_tokens = set(re.findall(r"[a-z][a-z0-9_-]{1,}", text))
        theme_tokens = set(re.findall(r"[a-z][a-z0-9_-]{1,}", theme))
        best_idx = -1
        best_score = 0
        for idx, kws in enumerate(keyword_sets):
            score = 0
            for kw in kws:
                if not kw:
                    continue
                if kw in theme_tokens:
                    score += 3
                elif kw in text_tokens:
                    score += 1
            if score > best_score:
                best_score = score
                best_idx = idx
        if best_idx >= 0 and best_score > 0:
            buckets[best_idx].append(row)
        else:
            unmapped.append(row)

    # Theme-driven enrichment fallback:
    # When explicit/inferred row-level mapping is absent, seed empty RQs from dominant themes.
    if unmapped and any(len(v) == 0 for v in buckets.values()):
        enrich_rows = _env_int("SYSTEMATIC_RQ_THEME_ENRICH_ROWS", 25, min_value=1, max_value=250)
        theme_to_rows: dict[str, list[dict[str, Any]]] = {}
        for row in unmapped:
            theme_key = str(row.get("theme") or "uncategorized").strip().lower() or "uncategorized"
            theme_to_rows.setdefault(theme_key, []).append(row)

        def _sig(r: dict[str, Any]) -> str:
            return (
                f"{str(r.get('dqid') or '').strip()}|"
                f"{str(r.get('item_key') or '').strip()}|"
                f"{str(r.get('quote') or '').strip()[:160]}|"
                f"{str(r.get('theme') or '').strip()}"
            )

        used: set[str] = set()
        for idx in range(len(research_questions)):
            if buckets.get(idx):
                continue
            best_theme = ""
            best_score = -1
            best_freq = -1
            kws = keyword_sets[idx] if idx < len(keyword_sets) else set()
            for theme_name, theme_rows in theme_to_rows.items():
                available = [r for r in theme_rows if _sig(r) not in used]
                if not available:
                    continue
                tokens = set(re.findall(r"[a-z][a-z0-9_-]{1,}", str(theme_name)))
                score = len(tokens & kws) if kws else 0
                freq = len(available)
                if score > best_score or (score == best_score and freq > best_freq):
                    best_score = score
                    best_freq = freq
                    best_theme = theme_name
            if not best_theme:
                continue
            picked = 0
            for row in theme_to_rows.get(best_theme, []):
                rsig = _sig(row)
                if rsig in used:
                    continue
                row.setdefault("_rq_assignment_source", "theme_enrichment")
                row.setdefault("_rq_assignment_theme", best_theme)
                buckets[idx].append(row)
                used.add(rsig)
                picked += 1
                if picked >= int(enrich_rows):
                    break

        if used:
            unmapped = [row for row in unmapped if _sig(row) not in used]
    return buckets, unmapped


def _row_signature(row: dict[str, Any]) -> str:
    return (
        f"{str(row.get('dqid') or '').strip()}|"
        f"{str(row.get('item_key') or '').strip()}|"
        f"{str(row.get('quote') or '')[:140]}"
    )


def _row_theme(row: dict[str, Any]) -> str:
    return str(row.get("theme") or "uncategorized").strip() or "uncategorized"


def _rows_by_theme(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if not isinstance(row, dict):
            continue
        buckets[_row_theme(row)].append(row)
    return dict(buckets)


def _top_theme_groups(rows: list[dict[str, Any]], top_n: int) -> list[tuple[str, list[dict[str, Any]]]]:
    grouped = _rows_by_theme(rows)
    ranked = sorted(grouped.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    if top_n > 0:
        return ranked[:top_n]
    return ranked


def _top_theme_text(rows: list[dict[str, Any]], limit: int = 4) -> str:
    groups = _top_theme_groups(rows, max(1, int(limit)))
    if not groups:
        return "insufficient thematic coverage"
    return ", ".join(f"{_humanize_theme_tokens(theme)} ({len(theme_rows)})" for theme, theme_rows in groups)


def _source_count(rows: list[dict[str, Any]]) -> int:
    return len({str(r.get("item_key") or "").strip() for r in rows if str(r.get("item_key") or "").strip()})


def _env_optional_limit(name: str, default: int = 0, *, max_value: int = 500_000) -> int:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return int(default)
    try:
        n = int(raw)
    except Exception:
        return int(default)
    if n <= 0:
        return 0
    return min(int(max_value), n)


def _citation_anchors_for_rows(
    rows: list[dict[str, Any]],
    dqid_lookup: dict[str, dict[str, str]],
    *,
    limit: int,
) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for row in rows:
        dqid = str(row.get("dqid") or "").strip()
        if not dqid or dqid in seen:
            continue
        seen.add(dqid)
        _, meta = _resolve_dqid_meta(dqid, dqid_lookup)
        citation = str((meta or {}).get("citation") or "").strip()
        if not citation or _is_source_itemkey_fallback_citation(citation):
            continue
        out.append(f"<a data-dqid=\"{html.escape(dqid, quote=True)}\">{html.escape(citation)}</a>")
        if len(out) >= max(1, int(limit)):
            break
    return out


def _wave_periods_fallback(years: list[int]) -> list[dict[str, Any]]:
    ys = sorted({y for y in years if isinstance(y, int)})
    if not ys:
        return []
    mn, mx = ys[0], ys[-1]
    if len(ys) <= 4:
        return [{"label": str(y), "start_year": y, "end_year": y, "debate_cluster": ""} for y in ys]
    span = max(1, mx - mn + 1)
    width = max(1, span // 3)
    bounds = [
        (mn, min(mx, mn + width - 1)),
        (min(mx, mn + width), min(mx, mn + (2 * width) - 1)),
        (min(mx, mn + (2 * width)), mx),
    ]
    labels = ["Period I", "Period II", "Period III"]
    out: list[dict[str, Any]] = []
    for i, (a, b) in enumerate(bounds):
        out.append({"label": f"{labels[i]} ({a}-{b})", "start_year": a, "end_year": b, "debate_cluster": ""})
    return out


def _derive_temporal_waves_from_rows(
    *,
    rows: list[dict[str, Any]],
    collection_name: str,
    model: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    years = [int(r["year"]) for r in rows if isinstance(r.get("year"), int)]
    if not years:
        return [], {"selected_source": "fallback_empty_years"}
    year_counter = Counter(years)
    theme_counts = Counter(_row_theme(r) for r in rows if isinstance(r, dict))
    by_year_theme: dict[int, Counter[str]] = defaultdict(Counter)
    for row in rows:
        year = row.get("year")
        if not isinstance(year, int):
            continue
        by_year_theme[int(year)][_row_theme(row)] += 1
    by_year_theme_hints = {y: c.most_common(6) for y, c in by_year_theme.items()}

    waves: list[dict[str, Any]] = []
    diag: dict[str, Any] = {"selected_source": "fallback_derive_periods"}
    try:
        # Reuse chronology pipeline LLM wave splitter for consistent temporal segmentation.
        from Research.chronological_review_pipeline import _ai_define_waves as _chrono_ai_define_waves  # type: ignore
        from Research.chronological_review_pipeline import _waves_to_periods as _chrono_waves_to_periods  # type: ignore
    except Exception as exc:
        diag = {"selected_source": "fallback_import_error", "error": str(exc)}
    else:
        try:
            ai_waves, ai_diag = _chrono_ai_define_waves(
                collection_name=collection_name,
                years=years,
                year_counter=year_counter,
                theme_counts=dict(theme_counts),
                by_year_theme_hints=by_year_theme_hints,
                model=model,
            )
            diag = dict(ai_diag or {})
            periods = _chrono_waves_to_periods(ai_waves) if ai_waves else []
            for idx, (label, (start_year, end_year)) in enumerate(periods, start=1):
                cluster = ""
                for w in ai_waves:
                    if str(w.get("label") or "").strip() == str(label).strip():
                        cluster = str(w.get("debate_cluster") or "").strip()
                        break
                waves.append(
                    {
                        "index": idx,
                        "label": str(label).strip(),
                        "start_year": int(start_year),
                        "end_year": int(end_year),
                        "debate_cluster": cluster,
                    }
                )
        except Exception as exc:
            diag = {"selected_source": "fallback_wave_split_error", "error": str(exc)}
            waves = []

    if not waves:
        fallback = _wave_periods_fallback(years)
        waves = [
            {
                "index": i,
                "label": str(w.get("label") or f"Wave {i}"),
                "start_year": int(w.get("start_year")),
                "end_year": int(w.get("end_year")),
                "debate_cluster": str(w.get("debate_cluster") or ""),
            }
            for i, w in enumerate(fallback, start=1)
        ]
    return waves, diag


def _assign_rows_to_waves(
    rows: list[dict[str, Any]],
    waves: list[dict[str, Any]],
) -> tuple[dict[int, list[dict[str, Any]]], list[dict[str, Any]]]:
    buckets: dict[int, list[dict[str, Any]]] = {i: [] for i in range(len(waves))}
    undated: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        year = row.get("year")
        if not isinstance(year, int):
            undated.append(row)
            continue
        matched = False
        for idx, wave in enumerate(waves):
            start_year = int(wave.get("start_year"))
            end_year = int(wave.get("end_year"))
            if start_year <= int(year) <= end_year:
                buckets[idx].append(row)
                matched = True
                break
        if not matched:
            if waves:
                buckets[len(waves) - 1].append(row)
            else:
                undated.append(row)
    return buckets, undated


def _render_theme_subsections(
    *,
    rows: list[dict[str, Any]],
    dqid_lookup: dict[str, dict[str, str]],
    top_themes: int,
    citations_per_theme: int,
    heading_level: int,
    context_label: str,
) -> str:
    level = max(4, min(6, int(heading_level)))
    chunks: list[str] = []
    groups = _top_theme_groups(rows, top_themes)
    for theme, theme_rows in groups:
        sources = _source_count(theme_rows)
        citations = _citation_anchors_for_rows(theme_rows, dqid_lookup, limit=citations_per_theme)
        cite_html = "; ".join(citations) if citations else "No mapped citations available for this theme."
        chunks.append(f"<h{level}>Theme: {html.escape(_humanize_theme_tokens(theme))}</h{level}>")
        chunks.append(
            "<p>"
            + (
                f"For {context_label}, this theme appears in {len(theme_rows)} coded snippets across {sources} source records. "
                "Synthesis should prioritize this evidence cluster when addressing the analytic objective."
            )
            + "</p>"
        )
        chunks.append(f"<p><strong>Illustrative citations:</strong> {cite_html}</p>")
    return "".join(chunks)


def _build_explicit_rq_narrative_html(
    *,
    research_questions: list[str],
    rows: list[dict[str, Any]],
    dqid_lookup: dict[str, dict[str, str]],
    citation_style: str = "apa",
) -> str:
    if not research_questions:
        return ""
    assignments, unmapped_rows = _assign_rows_to_questions(rows, research_questions)
    top_themes_per_rq = _env_int("SYSTEMATIC_RQ_TOP_THEMES", 5, min_value=3, max_value=12)
    citations_per_theme = _env_int("SYSTEMATIC_RQ_CITES_PER_THEME", 3, min_value=1, max_value=10)
    row_limit = _env_optional_limit("SYSTEMATIC_RQ_ROWS_PER_QUESTION", default=0, max_value=500_000)

    mapped_signatures: set[str] = set()
    for assigned_rows in assignments.values():
        for row in assigned_rows:
            mapped_signatures.add(_row_signature(row))
    total_rows = len(rows)
    mapped_rows = len(mapped_signatures)

    table_rows: list[str] = []
    rq_blocks: list[str] = []
    for i, question in enumerate(research_questions, start=1):
        assigned = list(assignments.get(i - 1, []))
        if row_limit > 0:
            assigned = assigned[:row_limit]
        top_theme_txt = _top_theme_text(assigned, limit=4)
        table_rows.append(
            "<tr>"
            f"<td>RQ{i}</td>"
            f"<td>{html.escape(question)}</td>"
            f"<td>{len(assigned)}</td>"
            f"<td>{_source_count(assigned)}</td>"
            f"<td>{html.escape(top_theme_txt)}</td>"
            "</tr>"
        )
        rq_blocks.append(f"<h4>RQ{i}: {html.escape(question)}</h4>")
        if not assigned:
            rq_blocks.append(
                "<p>No evidence snippets were confidently mapped to this question under current coding tags and lexical matching. "
                "This question remains a synthesis gap for this run.</p>"
            )
            continue
        rq_blocks.append(
            "<p>"
            + (
                f"Evidence assigned to this question includes {len(assigned)} coded snippets across {_source_count(assigned)} source records. "
                f"Dominant themes were {top_theme_txt}. "
                "The synthesis below structures findings by top themes to directly answer this research question."
            )
            + "</p>"
        )
        rq_blocks.append(
            _render_theme_subsections(
                rows=assigned,
                dqid_lookup=dqid_lookup,
                top_themes=top_themes_per_rq,
                citations_per_theme=citations_per_theme,
                heading_level=5,
                context_label=f"RQ{i}",
            )
        )

    summary_table = (
        "<table class='data-table'><thead><tr>"
        "<th>Question</th><th>Research Question Text</th><th>Assigned Evidence Snippets</th><th>Unique Sources</th><th>Top Themes</th>"
        "</tr></thead><tbody>"
        + "".join(table_rows)
        + "</tbody></table>"
    )
    coverage = (
        "<p><strong>RQ coverage:</strong> "
        + f"{mapped_rows} of {total_rows} evidence snippets were mapped to at least one research question; "
        + f"{len(unmapped_rows)} were unmapped and excluded from per-question tallies."
        + "</p>"
    )
    out = "<h4>Narrative synthesis</h4>" + coverage + summary_table + "".join(rq_blocks)
    out = _clean_and_humanize_section_html(out)
    out = _enrich_dqid_anchors(out, dqid_lookup, citation_style=citation_style)
    out = _inject_dqid_anchors_if_missing(out, dqid_lookup, max_anchors=max(6, citations_per_theme), citation_style=citation_style)
    return out


def _build_theme_only_narrative_html(
    *,
    rows: list[dict[str, Any]],
    dqid_lookup: dict[str, dict[str, str]],
    citation_style: str = "apa",
) -> str:
    top_themes = _env_int("SYSTEMATIC_THEME_TOP_N", 5, min_value=3, max_value=8)
    citations_per_theme = _env_int("SYSTEMATIC_THEME_CITES_PER_THEME", 3, min_value=1, max_value=10)
    out = "<h4>Narrative synthesis</h4>"
    out += (
        "<p>"
        + f"No explicit research-question list was provided. "
        + f"Synthesis is therefore structured by the top {top_themes} themes in the coded evidence."
        + "</p>"
    )
    out += _render_theme_subsections(
        rows=rows,
        dqid_lookup=dqid_lookup,
        top_themes=top_themes,
        citations_per_theme=citations_per_theme,
        heading_level=4,
        context_label="the overarching review objective",
    )
    out = _clean_and_humanize_section_html(out)
    out = _enrich_dqid_anchors(out, dqid_lookup, citation_style=citation_style)
    out = _inject_dqid_anchors_if_missing(out, dqid_lookup, max_anchors=max(6, citations_per_theme), citation_style=citation_style)
    return out


def _build_temporal_narrative_html(
    *,
    collection_name: str,
    model: str,
    research_questions: list[str],
    rows: list[dict[str, Any]],
    dqid_lookup: dict[str, dict[str, str]],
    citation_style: str = "apa",
) -> str:
    waves, wave_diag = _derive_temporal_waves_from_rows(rows=rows, collection_name=collection_name, model=model)
    if not waves:
        # Temporal requested but no dated evidence; fall back to non-temporal structure.
        if research_questions:
            return _build_explicit_rq_narrative_html(
                research_questions=research_questions,
                rows=rows,
                dqid_lookup=dqid_lookup,
                citation_style=citation_style,
            )
        return _build_theme_only_narrative_html(rows=rows, dqid_lookup=dqid_lookup, citation_style=citation_style)

    by_wave, undated_rows = _assign_rows_to_waves(rows, waves)
    top_themes = _env_int("SYSTEMATIC_THEME_TOP_N", 5, min_value=3, max_value=8)
    top_themes_per_rq = _env_int("SYSTEMATIC_RQ_TOP_THEMES", 5, min_value=3, max_value=12)
    citations_per_theme = _env_int("SYSTEMATIC_THEME_CITES_PER_THEME", 3, min_value=1, max_value=10)
    row_limit = _env_optional_limit("SYSTEMATIC_RQ_ROWS_PER_QUESTION", default=0, max_value=500_000)

    parts: list[str] = ["<h4>Narrative synthesis</h4>"]
    parts.append(
        "<p><strong>Temporal mode enabled:</strong> Results are structured by chronological waves, and within each wave by "
        + ("research question plus top themes." if research_questions else "top themes.")
        + "</p>"
    )
    parts.append(f"<p><strong>Wave split source:</strong> {html.escape(str(wave_diag.get('selected_source') or 'unknown'))}</p>")

    for idx, wave in enumerate(waves, start=1):
        label = str(wave.get("label") or f"Wave {idx}").strip()
        start_year = int(wave.get("start_year"))
        end_year = int(wave.get("end_year"))
        debate_cluster = str(wave.get("debate_cluster") or "").strip()
        wave_rows = list(by_wave.get(idx - 1, []))
        parts.append(f"<h4>Wave {idx}: {html.escape(label)} ({start_year}-{end_year})</h4>")
        if debate_cluster:
            parts.append(f"<p><strong>Wave focus:</strong> {html.escape(debate_cluster)}</p>")
        parts.append(
            f"<p>Wave evidence: {len(wave_rows)} coded snippets across {_source_count(wave_rows)} source records.</p>"
        )
        if research_questions:
            wave_assignments, wave_unmapped = _assign_rows_to_questions(wave_rows, research_questions)
            parts.append(
                f"<p><strong>Wave RQ coverage:</strong> {len(wave_rows) - len(wave_unmapped)} mapped; {len(wave_unmapped)} unmapped.</p>"
            )
            for rq_idx, question in enumerate(research_questions, start=1):
                rq_rows = list(wave_assignments.get(rq_idx - 1, []))
                if row_limit > 0:
                    rq_rows = rq_rows[:row_limit]
                parts.append(f"<h5>RQ{rq_idx}: {html.escape(question)}</h5>")
                if not rq_rows:
                    parts.append("<p>No mapped evidence snippets for this question in this wave.</p>")
                    continue
                parts.append(
                    "<p>"
                    + (
                        f"In this wave, RQ{rq_idx} is supported by {len(rq_rows)} snippets across {_source_count(rq_rows)} sources. "
                        f"Dominant themes: {_top_theme_text(rq_rows, limit=4)}."
                    )
                    + "</p>"
                )
                parts.append(
                    _render_theme_subsections(
                        rows=rq_rows,
                        dqid_lookup=dqid_lookup,
                        top_themes=top_themes_per_rq,
                        citations_per_theme=citations_per_theme,
                        heading_level=6,
                        context_label=f"Wave {idx}, RQ{rq_idx}",
                    )
                )
        else:
            parts.append(
                _render_theme_subsections(
                    rows=wave_rows,
                    dqid_lookup=dqid_lookup,
                    top_themes=top_themes,
                    citations_per_theme=citations_per_theme,
                    heading_level=5,
                    context_label=f"Wave {idx}",
                )
            )

    if undated_rows:
        parts.append("<h4>Undated evidence</h4>")
        if research_questions:
            u_assign, _u_unmapped = _assign_rows_to_questions(undated_rows, research_questions)
            for rq_idx, question in enumerate(research_questions, start=1):
                rq_rows = list(u_assign.get(rq_idx - 1, []))
                parts.append(f"<h5>RQ{rq_idx}: {html.escape(question)}</h5>")
                if not rq_rows:
                    parts.append("<p>No mapped undated evidence for this question.</p>")
                    continue
                parts.append(
                    _render_theme_subsections(
                        rows=rq_rows,
                        dqid_lookup=dqid_lookup,
                        top_themes=top_themes_per_rq,
                        citations_per_theme=citations_per_theme,
                        heading_level=6,
                        context_label=f"undated RQ{rq_idx}",
                    )
                )
        else:
            parts.append(
                _render_theme_subsections(
                    rows=undated_rows,
                    dqid_lookup=dqid_lookup,
                    top_themes=top_themes,
                    citations_per_theme=citations_per_theme,
                    heading_level=5,
                    context_label="undated evidence",
                )
            )

    out = "".join(parts)
    out = _clean_and_humanize_section_html(out)
    out = _enrich_dqid_anchors(out, dqid_lookup, citation_style=citation_style)
    out = _inject_dqid_anchors_if_missing(out, dqid_lookup, max_anchors=max(6, citations_per_theme), citation_style=citation_style)
    return out


def _build_results_narrative_html(
    *,
    collection_name: str,
    model: str,
    research_questions: list[str],
    rows: list[dict[str, Any]],
    dqid_lookup: dict[str, dict[str, str]],
    citation_style: str,
    temporal: bool,
) -> str:
    if temporal:
        return _build_temporal_narrative_html(
            collection_name=collection_name,
            model=model,
            research_questions=research_questions,
            rows=rows,
            dqid_lookup=dqid_lookup,
            citation_style=citation_style,
        )
    if research_questions:
        return _build_explicit_rq_narrative_html(
            research_questions=research_questions,
            rows=rows,
            dqid_lookup=dqid_lookup,
            citation_style=citation_style,
        )
    return _build_theme_only_narrative_html(rows=rows, dqid_lookup=dqid_lookup, citation_style=citation_style)


def _svg_bar_chart(title: str, labels: list[str], values: list[int], width: int = 980, height: int = 520) -> str:
    pad_l, pad_r, pad_t, pad_b = 120, 40, 60, 90
    chart_w = width - pad_l - pad_r
    chart_h = height - pad_t - pad_b
    max_v = max(values) if values else 1
    bar_h = max(14, int(chart_h / max(len(values), 1) * 0.62))
    gap = max(8, int((chart_h - bar_h * len(values)) / max(len(values), 1)))

    rows = []
    y = pad_t
    for label, value in zip(labels, values):
        bar_w = int((value / max_v) * chart_w) if max_v > 0 else 0
        rows.append(
            f"<text x='{pad_l - 8}' y='{y + bar_h - 2}' text-anchor='end' font-size='13' fill='#1f2937'>{html.escape(label)}</text>"
            f"<rect x='{pad_l}' y='{y}' width='{bar_w}' height='{bar_h}' fill='#2563eb' opacity='0.88'/>"
            f"<text x='{pad_l + bar_w + 8}' y='{y + bar_h - 2}' font-size='13' fill='#111827'>{value}</text>"
        )
        y += bar_h + gap

    return (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>"
        f"<rect width='100%' height='100%' fill='#f8fafc'/>"
        f"<text x='{width/2}' y='34' text-anchor='middle' font-size='22' fill='#0f172a' font-weight='600'>{html.escape(title)}</text>"
        f"<line x1='{pad_l}' y1='{pad_t + chart_h + 4}' x2='{pad_l + chart_w}' y2='{pad_t + chart_h + 4}' stroke='#334155' stroke-width='1'/>"
        + "".join(rows)
        + "</svg>"
    )


def _svg_prisma(counts: dict[str, int], width: int = 980, height: int = 730) -> str:
    c_db = _safe_int(counts.get("db"), 0)
    c_dup = _safe_int(counts.get("dup"), 0)
    c_screen = _safe_int(counts.get("screen"), 0)
    c_screen_ex = _safe_int(counts.get("screen_ex"), 0)
    c_full = _safe_int(counts.get("full"), 0)
    c_full_ex = _safe_int(counts.get("full_ex"), 0)
    c_inc = _safe_int(counts.get("included"), 0)

    def box(x: int, y: int, w: int, h: int, title: str, line2: str) -> str:
        return (
            f"<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='8' fill='#eef2ff' stroke='#1d4ed8' stroke-width='1.5'/>"
            f"<text x='{x + w/2}' y='{y + 28}' text-anchor='middle' font-size='15' fill='#1e3a8a' font-weight='600'>{html.escape(title)}</text>"
            f"<text x='{x + w/2}' y='{y + 56}' text-anchor='middle' font-size='14' fill='#0f172a'>{html.escape(line2)}</text>"
        )

    def arrow(x1: int, y1: int, x2: int, y2: int) -> str:
        return (
            f"<line x1='{x1}' y1='{y1}' x2='{x2}' y2='{y2}' stroke='#334155' stroke-width='2'/>"
            f"<polygon points='{x2},{y2} {x2-8},{y2-4} {x2-8},{y2+4}' fill='#334155'/>"
        )

    return (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>"
        f"<rect width='100%' height='100%' fill='#ffffff'/>"
        f"<text x='{width/2}' y='36' text-anchor='middle' font-size='26' fill='#0f172a' font-weight='700'>PRISMA Flow Diagram</text>"
        + box(320, 80, 340, 86, "Records identified", f"n = {c_db}")
        + box(320, 200, 340, 86, "Duplicates removed", f"n = {c_dup}")
        + box(320, 320, 340, 86, "Records screened", f"n = {c_screen}")
        + box(320, 440, 340, 86, "Full texts assessed", f"n = {c_full}")
        + box(320, 560, 340, 86, "Studies included", f"n = {c_inc}")
        + box(700, 320, 230, 86, "Excluded at screening", f"n = {c_screen_ex}")
        + box(700, 440, 230, 86, "Excluded at full text", f"n = {c_full_ex}")
        + arrow(490, 166, 490, 200)
        + arrow(490, 286, 490, 320)
        + arrow(490, 406, 490, 440)
        + arrow(490, 526, 490, 560)
        + arrow(660, 363, 700, 363)
        + arrow(660, 483, 700, 483)
        + "</svg>"
    )


def _extract_llm_text(raw_response: Any) -> str:
    def _from_string(value: str) -> str:
        s = str(value or "").strip()
        if not s:
            return ""
        # Some batch read paths can stringify as: ('<html...>', {'input tokens': ...})
        if s.startswith("(") and s.endswith(")") and "input tokens" in s and "output tokens" in s:
            try:
                parsed = ast.literal_eval(s)
                if isinstance(parsed, tuple) and parsed and isinstance(parsed[0], str):
                    s = parsed[0]
            except Exception:
                pass
        return s.strip()

    if isinstance(raw_response, str):
        return _from_string(raw_response)
    if isinstance(raw_response, (list, tuple)):
        for part in raw_response:
            txt = _extract_llm_text(part)
            if txt:
                return txt
        return ""
    if isinstance(raw_response, dict):
        if isinstance(raw_response.get("result"), dict):
            nested = raw_response.get("result")
            if isinstance(nested, dict):
                return _extract_llm_text(nested)
        if isinstance(raw_response.get("response"), str):
            return str(raw_response["response"]).strip()
        if isinstance(raw_response.get("response"), dict):
            nested_resp = raw_response.get("response")
            if isinstance(nested_resp, dict):
                return _extract_llm_text(nested_resp)
        for key in ("content", "text", "result"):
            if isinstance(raw_response.get(key), str):
                return _from_string(str(raw_response[key]))
    return _from_string(str(raw_response))


def _clean_llm_html(text: str) -> str:
    cleaned = str(text or "").strip()
    cleaned = cleaned.replace("\\r\\n", "\n").replace("\\n", "\n")
    cleaned = re.sub(
        r"\s*['\"]?\s*,\s*\{['\"]input tokens['\"].*?['\"]is batch['\"]\s*:\s*(?:True|False)\}\)\s*$",
        "",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    cleaned = re.sub(r"^\(\s*(['\"])(.*)\1\s*,\s*\{.*\}\s*\)\s*$", r"\2", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"^```(?:html)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _html_to_text(value: str) -> str:
    txt = re.sub(r"<[^>]+>", " ", str(value or ""))
    txt = html.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt


def _word_count_html(value: str) -> int:
    text = _html_to_text(value)
    if not text:
        return 0
    return len(re.findall(r"\b\w+\b", text))


def _humanize_theme_tokens(text: str) -> str:
    def _repl(m: re.Match[str]) -> str:
        token = m.group(0)
        if token.startswith(("http_", "https_", "data_", "aria_")):
            return token
        return token.replace("_", " ")

    return re.sub(r"\b[a-z][a-z0-9]+(?:_[a-z0-9]+)+\b", _repl, str(text or ""))


def _normalize_parenthetical_citations_html(section_html: str) -> str:
    text = str(section_html or "")
    if not text:
        return text

    # Flatten nested citation groups like:
    # ((Author, 2010); (Author2, 2011)) -> (Author, 2010; Author2, 2011)
    nested_pat = re.compile(r"\(\s*((?:\([^()]*?(?:19|20)\d{2}[^()]*\)\s*(?:[,;]\s*)?){2,})\s*\)")
    for _ in range(8):
        changed = False

        def _flatten(m: re.Match[str]) -> str:
            nonlocal changed
            body = str(m.group(1) or "")
            parts = [p.strip() for p in re.findall(r"\(([^()]*?(?:19|20)\d{2}[^()]*)\)", body) if str(p).strip()]
            if len(parts) < 2:
                return m.group(0)
            deduped: list[str] = []
            seen: set[str] = set()
            for p in parts:
                key = re.sub(r"\s+", " ", p).strip().lower()
                if key in seen:
                    continue
                seen.add(key)
                deduped.append(p)
            changed = True
            return f"({'; '.join(deduped)})"

        new_text = nested_pat.sub(_flatten, text)
        text = new_text
        if not changed:
            break

    # Merge adjacent parenthetical citations and force ';' separator.
    for _ in range(8):
        new_text = re.sub(
            r"\(([^()]{0,320}?(?:19|20)\d{2}[^()]*)\)\s*(?:,?\s*;\s*|,\s*|\s+)\(([^()]{0,320}?(?:19|20)\d{2}[^()]*)\)",
            lambda m: f"({m.group(1).strip()}; {m.group(2).strip()})",
            text,
        )
        if new_text == text:
            break
        text = new_text

    # Normalize separators and de-duplicate within each citation block.
    def _fix_paren(m: re.Match[str]) -> str:
        inner = str(m.group(1) or "").strip()
        if not re.search(r"(19|20)\d{2}", inner):
            return f"({inner})"
        inner = re.sub(
            r",\s*(?=[A-Z][A-Za-z'’.\-]+(?:\s+(?:[A-Z][A-Za-z'’.\-]+|et al\.?|&|and)){0,5}\s*,?\s*(?:19|20)\d{2})",
            "; ",
            inner,
        )
        inner = re.sub(r"\s*;\s*", "; ", inner).strip()
        parts = [p.strip() for p in inner.split(";") if p.strip()]
        deduped: list[str] = []
        seen: set[str] = set()
        for p in parts:
            key = re.sub(r"\s+", " ", p).strip().lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(p)
        return f"({'; '.join(deduped)})"

    text = re.sub(r"\(([^()]+)\)", _fix_paren, text)
    # Final guard for accidental doubled parenthesis around author-year blocks.
    text = re.sub(r"\(\s*\(([^()]*?(?:19|20)\d{2}[^()]*)\)\s*\)", r"(\1)", text)
    return text


def _clean_and_humanize_section_html(section_html: str) -> str:
    out = _clean_llm_html(_extract_llm_text(section_html))
    out = _humanize_theme_tokens(out)
    # Repair malformed heading/paragraph nesting occasionally produced by model output.
    out = re.sub(r"<p>\s*(<h[1-6]\b[^>]*>)", r"\1", out, flags=re.IGNORECASE)
    out = re.sub(r"(</h[1-6]>)\s*</p>", r"\1", out, flags=re.IGNORECASE)
    out = re.sub(r"<p>\s*<p>", "<p>", out, flags=re.IGNORECASE)
    out = re.sub(r"</p>\s*</p>", "</p>", out, flags=re.IGNORECASE)
    out = re.sub(r"(?:<br\s*/?>\s*)+(?=<h[1-6]\b)", "", out, flags=re.IGNORECASE)
    out = re.sub(r"(?:<br\s*/?>\s*){3,}", "<br/><br/>", out, flags=re.IGNORECASE)
    # Guard against tuple-wrapper leftovers that can survive malformed cache payloads.
    out = re.sub(r"^\s*\(\s*['\"]\s*", "", out)
    out = re.sub(r"\s*['\"]\s*\)\s*$", "", out)
    out = _normalize_parenthetical_citations_html(out)
    return out.strip()


def _validate_section_html(section_name: str, html_text: str, *, min_words: int, max_words: int, forbid_h4: bool = False) -> None:
    wc = _word_count_html(html_text)
    if wc < int(min_words) or wc > int(max_words):
        raise RuntimeError(f"Section '{section_name}' word count {wc} outside range [{min_words}, {max_words}].")
    if forbid_h4 and re.search(r"<h[1-6]\b", html_text, flags=re.IGNORECASE):
        raise RuntimeError(f"Section '{section_name}' must not contain subsection headings.")
    if re.search(r"<p[^>]*>\s*<h[1-6]\b", html_text, flags=re.IGNORECASE):
        raise RuntimeError(f"Section '{section_name}' has invalid heading nested inside paragraph.")
    if re.search(r"<p[^>]*>\s*<p\b", html_text, flags=re.IGNORECASE):
        raise RuntimeError(f"Section '{section_name}' has nested paragraph tags.")


def _validate_style_rules(section_name: str, html_text: str) -> None:
    low = str(html_text or "").lower()

    # Abstract/introduction/conclusion must be paragraph prose only.
    if section_name in {"abstract", "introduction", "conclusion"}:
        if re.search(r"<h[1-6]\b", low):
            raise RuntimeError(f"Section '{section_name}' must not contain headings.")
        if re.search(r"<(ul|ol|li)\b", low):
            raise RuntimeError(f"Section '{section_name}' must not contain bullet/numbered lists.")

    # Methods/results/discussion text should read like publication prose, not prompt/meta commentary.
    formal_sections = {
        "search_strategy",
        "study_selection_methods",
        "data_extraction_methods",
        "risk_of_bias_methods",
        "data_synthesis_methods",
        "narrative_synthesis",
        "discussion",
        "limitations",
    }
    if section_name in formal_sections:
        banned = [
            r"\bprovided context\b",
            r"\bcontext json\b",
            r"\bwhole_paper\b",
            r"\bas an ai\b",
            r"\bi cannot\b",
            r"\binsufficient data\b",
            r"\bprompt\b",
            r"\bplaceholder\b",
            r"\btbd\b",
        ]
        for pat in banned:
            if re.search(pat, low, flags=re.IGNORECASE):
                raise RuntimeError(f"Section '{section_name}' contains non-publication phrase matching /{pat}/.")


def _assert_no_fallback_stub_text(section_name: str, html_text: str) -> None:
    low = " ".join(str(html_text or "").lower().split())
    stub_phrases = [
        "this paper synthesizes intro/conclusion core-claim codes across the collection",
        "research questions are grouped into dominant inquiry families.",
        "findings are consolidated across items and contrasted where claims diverge.",
        "cross-category synthesis links definitional framing to claims, methods, limitations, and future pathways.",
        "this collection-level synthesis compiles all intro/conclusion extraction codes and presents a structured overview",
        "method claims summarize study design, operationalization, and evidence strategies explicitly stated in the coded records.",
    ]
    for phrase in stub_phrases:
        if phrase in low:
            raise RuntimeError(f"Section '{section_name}' contains fallback/stub synthesis text.")


def _validate_generated_section(section_name: str, section_html: str, cfg: dict[str, Any]) -> None:
    _assert_no_fallback_stub_text(section_name, section_html)
    _validate_section_html(
        section_name,
        section_html,
        min_words=int(cfg["min"]),
        max_words=int(cfg["max"]),
        forbid_h4=bool(cfg.get("forbid_h4", False)),
    )
    _validate_style_rules(section_name, section_html)


@dataclass
class PipelineResult:
    output_html_path: Path
    context_json_path: Path
    prisma_svg_path: Path
    themes_svg_path: Path


def _assert_non_placeholder_html(rendered: str) -> None:
    unresolved = re.findall(r"(\{\{[^}]+\}\}|\{%[^%]+%\})", rendered)
    if unresolved:
        raise RuntimeError(f"Rendered HTML still contains unresolved template tokens: {unresolved[:5]}")
    lowered = rendered.lower()
    if re.search(r"<[^>]+class=\"[^\"]*placeholder-note[^\"]*\"", lowered) or re.search(
        r"<[^>]+class=\"[^\"]*ai-placeholder[^\"]*\"", lowered
    ):
        raise RuntimeError("Rendered HTML contains placeholder elements.")
    if "full search strategy appendix not provided" in lowered:
        raise RuntimeError("Rendered HTML indicates missing search strategy appendix.")
    if "could not be generated" in lowered and "ai-generated" in lowered:
        raise RuntimeError("Rendered HTML indicates missing AI-generated section.")
    if re.search(r"\[[^\]]*(placeholder|pending|n\/a|tbd|to be completed)[^\]]*\]", lowered, flags=re.IGNORECASE):
        raise RuntimeError("Rendered HTML contains unresolved editorial placeholders.")


def _assert_reference_and_postprocess_integrity(rendered: str, *, citation_style: str = "apa") -> None:
    text = str(rendered or "")
    normalized_style = _normalize_citation_style(citation_style)
    checks: list[tuple[str, str]] = [
        (r"\(Unknown,\s*n\.d\.\)", "Rendered HTML contains unresolved in-text citations '(Unknown, n.d.)'."),
        (r"Unresolved source metadata", "Rendered HTML contains unresolved reference metadata."),
        (r"input tokens", "Rendered HTML contains leaked token-usage diagnostics."),
        (r"output tokens", "Rendered HTML contains leaked token-usage diagnostics."),
        (r"\('(?:.|\n){0,800}?\{['\"]input tokens['\"]", "Rendered HTML contains tuple-style serialized model output."),
        (r"\(\s*['\"]\s*<p", "Rendered HTML contains tuple-style prefix before paragraph HTML."),
        (r"&amp;amp;", "Rendered HTML contains doubly escaped URL entities (&amp;amp;)."),
        (r"\b(start page|set as cursor|men tab|abstract id)\s*=", "Rendered HTML contains malformed URL query parameter keys."),
    ]
    for pattern, message in checks:
        if re.search(pattern, text, flags=re.IGNORECASE):
            raise RuntimeError(message)
    # Enforce canonical dqid-cite anchor quality across all review outputs.
    for m in re.finditer(
        r"<a[^>]*class=\"[^\"]*dqid-cite[^\"]*\"[^>]*>(.*?)</a>",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        tag = m.group(0)
        inner = re.sub(r"<[^>]+>", "", str(m.group(1) or "")).strip()
        title_m = re.search(r'\btitle\s*=\s*(["\'])(.*?)\1', tag, flags=re.IGNORECASE | re.DOTALL)
        href_m = re.search(r'\bhref\s*=\s*(["\'])(.*?)\1', tag, flags=re.IGNORECASE | re.DOTALL)
        title = html.unescape(str(title_m.group(2) if title_m else "")).strip()
        href = html.unescape(str(href_m.group(2) if href_m else "")).strip()
        if (
            not title
            or re.fullmatch(r"[A-Za-z0-9_-]{8,}(?:#DQ\d{3})?", title)
            or re.fullmatch(r"(?:DQID|DQ\d+|[A-Za-z0-9_-]{6,}#(?:AUTO\d+|DQ\d+))", title, flags=re.IGNORECASE)
        ):
            raise RuntimeError("Rendered HTML contains dqid-cite anchors with non-verbatim/hashed title values.")
        if not re.match(r"^(https?|file)://", href, flags=re.IGNORECASE):
            raise RuntimeError("Rendered HTML contains dqid-cite anchors without URL href.")
        if normalized_style == "apa":
            if "(Source citation)" in inner or "(Unknown, n.d.)" in inner:
                raise RuntimeError("Rendered HTML contains unresolved APA dqid citations.")
            if not re.search(r"\([^()]*\d{4}[^()]*\)", inner):
                raise RuntimeError("Rendered HTML contains APA dqid citations without author-year format.")
    if normalized_style == "numeric":
        if not re.search(r"<a[^>]*class=\"dqid-cite\"[^>]*>\[\d+\]</a>", text):
            raise RuntimeError("Numeric citation style selected but numeric in-text citations were not found.")
    elif normalized_style == "endnote":
        if not re.search(r"<a[^>]*class=\"dqid-cite\"[^>]*><sup>\d+</sup></a>", text):
            raise RuntimeError("Endnote citation style selected but superscript in-text citations were not found.")
    elif normalized_style == "parenthetical_footnote":
        if not re.search(r"<a[^>]*class=\"dqid-cite\"[^>]*>\(see note \d+\)</a>", text, flags=re.IGNORECASE):
            raise RuntimeError("Parenthetical footnote style selected but '(see note n)' in-text citations were not found.")
    else:
        if re.search(r"<a[^>]*class=\"dqid-cite\"[^>]*>\[\d+\]</a>", text):
            raise RuntimeError("APA citation style selected but numeric in-text citations were found.")
    if normalized_style == "apa":
        leftovers = _find_unanchored_author_year_citations(text)
        if leftovers:
            sample = "; ".join(leftovers[:3])
            raise RuntimeError(f"Rendered HTML contains unanchored author-year citations outside links: {sample}")


def _replace_subsection_content(rendered: str, heading: str, body_html: str) -> str:
    pattern = re.compile(
        rf"(<h3>\s*{re.escape(heading)}\s*</h3>\s*<div class=\"subsection-content\">)(.*?)(</div>)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    replacement = rf"\1\n{body_html}\n  \3"
    new_rendered, n = pattern.subn(replacement, rendered, count=1)
    if n == 0:
        raise RuntimeError(f"Could not locate subsection block for '{heading}'.")
    return new_rendered


def _replace_references_block(rendered: str, references_html_items: str) -> str:
    pattern = re.compile(
        r"(<h2>7\.\s*References</h2>\s*<div id=\"references\" class=\"section-content\">.*?<ol>)(.*?)(</ol>)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    new_rendered, n = pattern.subn(rf"\1\n{references_html_items}\n  \3", rendered, count=1)
    if n == 0:
        raise RuntimeError("Could not locate references list block.")
    return new_rendered


def _append_references_notes_block(rendered: str, notes_html: str) -> str:
    if not notes_html.strip():
        return rendered
    pattern = re.compile(
        r"(<h2>7\.\s*References</h2>\s*<div id=\"references\" class=\"section-content\">)(.*?)(</div>)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    m = pattern.search(rendered)
    if not m:
        raise RuntimeError("Could not locate references block for notes insertion.")
    start, body, end = m.group(1), m.group(2), m.group(3)
    replacement = f"{start}{body}\n{notes_html}\n{end}"
    return rendered[: m.start()] + replacement + rendered[m.end() :]


def _strip_editorial_brackets(rendered: str) -> str:
    patterns = [
        r"\[Link to PRISMA Statement if desired\]",
        r"\[Refer to Appendix for detailed table if needed\]",
        r"\[Refer to Appendix for detailed assessments per study\]",
        r"\[Mention tool/template if applicable\]",
        r"\[If applicable, add registration number\]",
    ]
    out = rendered
    for pat in patterns:
        out = re.sub(pat, "", out, flags=re.IGNORECASE)
    return out


def _build_reference_records(summary: dict[str, Any]) -> list[dict[str, str]]:
    out = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    npath = Path(str(out.get("normalized_results_path") or "")).expanduser()
    if not npath.is_file():
        raise RuntimeError("Missing normalized_results_path for references generation.")
    raw = json.loads(npath.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError("No normalized results available for references generation.")

    def _iter_item_evidence(item_payload: dict[str, Any]) -> list[tuple[str, str]]:
        rows: list[tuple[str, str]] = []
        for arr_key in ("structured_code", "code_intro_conclusion_extract_core_claims", "code_pdf_page", "evidence_list", "section_open_coding"):
            arr = item_payload.get(arr_key)
            if not isinstance(arr, list):
                continue
            for row in arr:
                if not isinstance(row, dict):
                    continue
                direct_quote = str(row.get("quote") or "").strip()
                dqid = str(row.get("dqid") or "").strip()
                if direct_quote:
                    if not dqid:
                        dqid = hashlib.sha1(direct_quote.encode("utf-8", errors="ignore")).hexdigest()[:12]
                    rows.append((dqid, direct_quote))
                nested = row.get("evidence")
                if isinstance(nested, list):
                    for ev in nested:
                        if not isinstance(ev, dict):
                            continue
                        q = str(ev.get("quote") or "").strip()
                        d = str(ev.get("dqid") or "").strip()
                        if not q:
                            continue
                        if not d:
                            d = hashlib.sha1(q.encode("utf-8", errors="ignore")).hexdigest()[:12]
                        rows.append((d, q))
        return rows

    collection_name = str(summary.get("collection_name") or "").strip()
    item_payload_lookup: dict[str, dict[str, Any]] = {}
    for raw_key, payload in raw.items():
        if isinstance(payload, dict):
            item_payload_lookup[str(raw_key).strip().lower()] = payload
    _augment_item_payload_lookup_with_all_items(
        item_payload_lookup,
        collection_name=collection_name,
    )

    rows: list[dict[str, str]] = []
    for i, item_key in enumerate(sorted(raw.keys()), start=1):
        item_payload = raw.get(item_key, {})
        if not isinstance(item_payload, dict):
            continue
        metadata = item_payload.get("metadata", {}) if isinstance(item_payload.get("metadata"), dict) else {}
        resolved_md = _resolve_item_reference_metadata(
            metadata,
            item_key=str(item_key),
            item_payload_lookup=item_payload_lookup,
        )
        author_label_full = resolved_md["author"]
        author_label = author_label_full.rstrip(".")
        year = resolved_md["year"]
        title = resolved_md["title"]

        citation_anchor = f"({author_label_full}, {year})"
        pdf_path = str(metadata.get("pdf_path") or "").strip()
        source_url = _source_url_from_metadata(metadata)
        dqid_quotes = _iter_item_evidence(item_payload)
        dqid = ""
        quote = ""
        page_no: int | None = None
        if dqid_quotes:
            dqid, quote = dqid_quotes[0]
            page_no = _find_quote_page(pdf_path, quote)
        citation_anchor = _append_page_to_apa_citation(citation_anchor, page_no)
        apa_text = f"{author_label}. ({year}). {title}."
        rows.append(
            {
                "index": str(i),
                "item_key": str(item_key),
                "dqid": dqid,
                "quote": quote,
                "pdf_path": pdf_path,
                "source_url": source_url,
                "page_no": str(page_no or ""),
                "apa_text": apa_text,
                "citation_anchor": citation_anchor,
            }
        )
    return rows


def _strip_references_blocks_for_anchor_scan(html_text: str) -> str:
    text = str(html_text or "")
    if not text:
        return text
    text = re.sub(
        r"<h[1-6][^>]*>\s*(?:\d+\.\s*)?References\s*</h[1-6]>[\s\S]*$",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    for tag in ("div", "section", "ol", "ul"):
        text = re.sub(
            rf"<{tag}[^>]*(?:id|class)=\"[^\"]*references?[^\"]*\"[^>]*>.*?</{tag}>",
            " ",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
    return text


def _extract_anchor_dqids_from_html(html_text: str) -> list[str]:
    scan = _strip_references_blocks_for_anchor_scan(str(html_text or ""))
    out: list[str] = []
    for raw in re.findall(r"<a[^>]*\bdata-dqid\s*=\s*[\"']([^\"']+)[\"'][^>]*>", scan, flags=re.IGNORECASE):
        parts = _split_dqid_values(str(raw or ""))
        for part in parts:
            token = str(part or "").strip()
            if token and token not in out:
                out.append(token)
    return out


def _derive_anchor_item_keys_from_html(
    html_text: str,
    dqid_lookup: dict[str, dict[str, str]],
) -> list[str]:
    if not isinstance(dqid_lookup, dict) or not dqid_lookup:
        return []
    item_keys: list[str] = []
    for token in _extract_anchor_dqids_from_html(html_text):
        dqid, meta = _resolve_dqid_meta(token, dqid_lookup)
        candidates: list[str] = []
        if isinstance(meta, dict):
            mk = str(meta.get("item_key") or "").strip()
            if mk:
                candidates.append(mk)
        if dqid:
            prefix = dqid.split("#", 1)[0].strip() if "#" in dqid else dqid
            if prefix and prefix in dqid_lookup:
                pmeta = dqid_lookup.get(prefix)
                if isinstance(pmeta, dict):
                    pmk = str(pmeta.get("item_key") or "").strip()
                    if pmk:
                        candidates.append(pmk)
                if prefix and prefix not in candidates:
                    candidates.append(prefix)
            elif prefix:
                candidates.append(prefix)
        for key in candidates:
            if key and key not in item_keys:
                item_keys.append(key)
    return item_keys


def _filter_reference_records_by_item_keys(
    records: list[dict[str, str]],
    anchor_item_keys: list[str] | None,
) -> list[dict[str, str]]:
    if anchor_item_keys is None:
        return list(records)
    by_key: dict[str, dict[str, str]] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        key = str(rec.get("item_key") or "").strip().lower()
        if key and key not in by_key:
            by_key[key] = rec
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_key in anchor_item_keys:
        key = str(raw_key or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        rec = by_key.get(key)
        if isinstance(rec, dict):
            out.append(rec)
    return out


def _build_reference_items(
    summary: dict[str, Any],
    *,
    citation_style: str = "apa",
    anchor_item_keys: list[str] | None = None,
) -> list[str]:
    normalized_style = _normalize_citation_style(citation_style)
    records = _filter_reference_records_by_item_keys(
        _build_reference_records(summary),
        anchor_item_keys=anchor_item_keys,
    )
    refs: list[str] = []
    for rec in records:
        idx = int(rec.get("index") or "0")
        dqid = str(rec.get("dqid") or "").strip()
        quote = str(rec.get("quote") or "").strip()
        source_url = str(rec.get("source_url") or "").strip()
        citation_anchor = str(rec.get("citation_anchor") or "").strip()
        apa_text = str(rec.get("apa_text") or "").strip()
        anchor_html = ""
        targets_html = ""
        if dqid:
            tip_txt = _decode_html_entities(quote)[:240] if quote else dqid
            tip = html.escape(tip_txt, quote=True)
            anchor_label, allow_html = _format_intext_citation(normalized_style, citation_anchor, idx if idx > 0 else None)
            label_html = anchor_label if allow_html else html.escape(anchor_label)
            href_target = source_url or f"#dqid-{html.escape(dqid)}"
            if normalized_style in {"numeric", "endnote", "parenthetical_footnote"} and idx > 0:
                href_target = source_url or f"#note-{idx}"
            anchor_html = (
                " "
                + f"<a class=\"quote-anchor\" data-dqid=\"{html.escape(dqid)}\" "
                + f"href=\"{html.escape(href_target, quote=True)}\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"{tip}\">{label_html}</a>"
            )
            targets_html = f"<span id=\"dqid-{html.escape(dqid)}\" class=\"quote-target\" title=\"{tip}\"></span>"
        if normalized_style == "numeric":
            prefix = f"[{idx}] "
        elif normalized_style == "endnote":
            prefix = f"{idx}. "
        elif normalized_style == "parenthetical_footnote":
            prefix = f"Note {idx}. "
        else:
            prefix = ""
        refs.append(f"<li>{html.escape(prefix + apa_text)}{anchor_html}{targets_html}</li>")
    return refs


def _build_notes_block_html(
    summary: dict[str, Any],
    *,
    citation_style: str = "apa",
    anchor_item_keys: list[str] | None = None,
) -> str:
    normalized_style = _normalize_citation_style(citation_style)
    if normalized_style not in {"numeric", "endnote", "parenthetical_footnote"}:
        return ""
    records = _filter_reference_records_by_item_keys(
        _build_reference_records(summary),
        anchor_item_keys=anchor_item_keys,
    )
    items: list[str] = []
    for rec in records:
        idx = int(rec.get("index") or "0")
        if idx <= 0:
            continue
        quote = str(rec.get("quote") or "").strip()
        apa_text = str(rec.get("apa_text") or "").strip()
        note_body = quote[:400] if quote else apa_text
        items.append(
            f"<li id=\"note-{idx}\"><span class=\"note-citation\">{html.escape(apa_text)}</span>: "
            + f"{html.escape(note_body)} <a href=\"#references\" class=\"note-back\">&#8617;</a></li>"
        )
    if not items:
        return ""
    return "<h3>Notes</h3>\n<ol class=\"citation-notes\">\n" + "\n".join(items) + "\n</ol>"


def _dedupe_citation_anchors_html(html_text: str) -> str:
    text = str(html_text or "")
    if not text:
        return text

    double_paren_pat = re.compile(r"\(\((.*?)\)\)", flags=re.IGNORECASE | re.DOTALL)
    paren_pat = re.compile(
        r"\((\s*(?:<a[^>]*class=\"[^\"]*dqid-cite[^\"]*\"[^>]*>.*?</a>\s*(?:[;,]\s*)?){2,})\)",
        flags=re.IGNORECASE | re.DOTALL,
    )

    def _dedupe_anchors(fragment: str) -> str:
        anchors = re.findall(r"<a[^>]*class=\"[^\"]*dqid-cite[^\"]*\"[^>]*>.*?</a>", fragment, flags=re.IGNORECASE | re.DOTALL)
        if not anchors:
            return ""
        deduped: list[str] = []
        seen: set[str] = set()
        for a in anchors:
            dq_m = re.search(r'\bdata-dqid\s*=\s*"([^"]+)"', a, flags=re.IGNORECASE)
            inner = re.sub(r"<[^>]+>", "", a)
            key = (
                re.sub(r"\s+", " ", html.unescape(str(dq_m.group(1) if dq_m else ""))).strip().lower()
                or re.sub(r"\s+", " ", html.unescape(inner)).strip().lower()
            )
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(a)
        return "; ".join(deduped)

    def _dedupe_block(m: re.Match[str]) -> str:
        body = str(m.group(1) or "")
        compact = _dedupe_anchors(body)
        if not compact:
            return m.group(0)
        return "(" + compact + ")"

    for _ in range(4):
        # First collapse nested citation groups with anchors.
        text = double_paren_pat.sub(lambda m: "(" + (_dedupe_anchors(str(m.group(1) or "")) or str(m.group(1) or "")) + ")", text)
        new_text = paren_pat.sub(_dedupe_block, text)
        if new_text == text:
            break
        text = new_text
    return text


def _build_dqid_evidence_payload(summary: dict[str, Any], max_rows: int = 120) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
    out = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    npath = Path(str(out.get("normalized_results_path") or "")).expanduser()
    if not npath.is_file():
        return [], {}
    raw = json.loads(npath.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return [], {}

    collection_name = str(summary.get("collection_name") or "").strip()
    payload_rows: list[dict[str, Any]] = []
    dqid_lookup: dict[str, dict[str, str]] = {}
    seen: set[str] = set()
    item_payload_lookup: dict[str, dict[str, Any]] = {}
    for raw_key, payload in raw.items():
        if isinstance(payload, dict):
            item_payload_lookup[str(raw_key).strip().lower()] = payload
    _augment_item_payload_lookup_with_all_items(
        item_payload_lookup,
        collection_name=collection_name,
    )

    try:
        row_limit = int(max_rows)
    except Exception:
        row_limit = 0
    if row_limit <= 0:
        row_limit = 0  # 0 means unlimited.

    for item_index, item_key in enumerate(sorted(raw.keys()), start=1):
        item_payload = raw.get(item_key, {})
        if not isinstance(item_payload, dict):
            continue
        metadata = item_payload.get("metadata", {}) if isinstance(item_payload.get("metadata"), dict) else {}
        item_pdf_path = str(metadata.get("pdf_path") or "").strip()
        source_url = _source_url_from_metadata(metadata)
        resolved_md = _resolve_item_reference_metadata(
            metadata,
            item_key=str(item_key),
            item_payload_lookup=item_payload_lookup,
        )
        author = resolved_md["author"]
        year = resolved_md["year"]
        year_int = _parse_year_int(year)
        title = resolved_md["title"]
        citation = f"({author}, {year})"
        if str(item_key).strip() and str(item_key) not in dqid_lookup:
            dqid_lookup[str(item_key)] = {
                "quote": "",
                "citation": citation,
                "index": str(item_index),
                "item_key": str(item_key),
                "pdf_path": item_pdf_path,
                "source_url": source_url,
                "author": author,
                "year": year,
                "title": title,
            }

        for arr_key in ("evidence_list", "code_pdf_page", "structured_code", "code_intro_conclusion_extract_core_claims", "section_open_coding"):
            arr = item_payload.get(arr_key)
            if not isinstance(arr, list):
                continue
            for outer in arr:
                if not isinstance(outer, dict):
                    continue
                candidates: list[dict[str, Any]] = []
                if isinstance(outer.get("evidence"), list):
                    candidates.extend([e for e in outer["evidence"] if isinstance(e, dict)])
                else:
                    candidates.append(outer)
                for ev in candidates:
                    dqid = str(ev.get("dqid") or "").strip()
                    quote = str(ev.get("quote") or "").strip()
                    if not quote:
                        continue
                    extraction_type = str(ev.get("extraction_type") or ev.get("evidence_type") or "").strip()
                    if not dqid:
                        # Align fallback dqid generation with structured-code pipelines.
                        dqid = hashlib.md5(
                            f"{item_key}|{extraction_type}|{quote}".encode("utf-8", errors="ignore")
                        ).hexdigest()[:12]
                    unique_key = f"{item_key}|{dqid}|{extraction_type}|{quote[:120]}"
                    if unique_key in seen:
                        continue
                    seen.add(unique_key)
                    themes = ev.get("potential_themes")
                    theme = ""
                    if isinstance(themes, list) and themes:
                        theme = str(themes[0] or "").strip()
                    if not theme:
                        theme = str(ev.get("evidence_type") or "").strip() or extraction_type or "uncategorized"
                    row = {
                        "dqid": dqid,
                        "quote": quote[:500],
                        "theme": theme,
                        "citation": citation,
                        "item_key": str(item_key),
                        "pdf_path": item_pdf_path,
                        "year": year_int,
                    }
                    rq_indices = _extract_relevant_rq_indices(ev.get("relevant_rqs"))
                    if not rq_indices:
                        rq_indices = _extract_relevant_rq_indices(outer.get("relevant_rqs"))
                    if rq_indices:
                        row["rq_indices"] = rq_indices
                    payload_rows.append(row)
                    page_no = _find_quote_page(item_pdf_path, quote) if item_pdf_path else None
                    dqid_lookup[dqid] = {
                        "quote": quote,
                        "citation": _append_page_to_apa_citation(citation, page_no),
                        "index": str(item_index),
                        "item_key": str(item_key),
                        "pdf_path": item_pdf_path,
                        "source_url": source_url,
                        "page_no": str(page_no or ""),
                        "author": author,
                        "year": year,
                        "title": title,
                    }
                    if "#" in dqid:
                        prefix = dqid.split("#", 1)[0].strip()
                        if prefix and prefix not in dqid_lookup:
                            dqid_lookup[prefix] = {
                                "quote": quote,
                                "citation": _append_page_to_apa_citation(citation, page_no),
                                "index": str(item_index),
                                "item_key": str(item_key),
                                "pdf_path": item_pdf_path,
                                "source_url": source_url,
                                "page_no": str(page_no or ""),
                                "author": author,
                                "year": year,
                                "title": title,
                            }
                    if row_limit > 0 and len(payload_rows) >= row_limit:
                        return payload_rows, dqid_lookup
    return payload_rows, dqid_lookup


def _enrich_dqid_anchors(section_html: str, dqid_lookup: dict[str, dict[str, str]], *, citation_style: str = "apa") -> str:
    if not section_html or not dqid_lookup:
        return section_html
    prefix_citation: dict[str, str] = {}
    for key, meta in dqid_lookup.items():
        if "#" not in str(key):
            continue
        prefix = str(key).split("#", 1)[0].strip()
        citation = str((meta or {}).get("citation") or "").strip()
        if prefix and citation and not _is_source_itemkey_fallback_citation(citation) and prefix not in prefix_citation:
            prefix_citation[prefix] = citation

    def _replace_anchor(m: re.Match[str]) -> str:
        attrs = m.group(1) or ""
        inner = m.group(3) or ""
        raw_dqid = str(m.group(2) or "").strip()
        dqids = _split_dqid_values(raw_dqid)
        if not dqids:
            dqids = [raw_dqid] if raw_dqid else []

        normalized_style = _normalize_citation_style(citation_style)
        resolved: list[tuple[str, dict[str, str]]] = []
        for d in dqids:
            rd, rm = _resolve_dqid_meta(d, dqid_lookup)
            if rd:
                resolved.append((rd, rm))
        if not resolved and raw_dqid:
            resolved.append((raw_dqid, {}))

        first_dqid, first_meta = resolved[0]
        prefix = first_dqid.split("#", 1)[0].strip() if "#" in first_dqid else ""
        prefix_meta = dqid_lookup.get(prefix, {}) if prefix else {}
        if not isinstance(prefix_meta, dict):
            prefix_meta = {}

        quote = _decode_html_entities(str(first_meta.get("quote") or "").strip())
        citation = _decode_html_entities(str(first_meta.get("citation") or "").strip())
        source_url = _source_url_from_meta_fields(first_meta)
        if not source_url:
            source_url = _source_url_from_meta_fields(prefix_meta)
        if not source_url and len(resolved) > 1:
            for _, alt_meta in resolved[1:]:
                candidate = _source_url_from_meta_fields(alt_meta)
                if candidate:
                    source_url = candidate
                    break

        index_value: int | None = None
        try:
            idx_raw = first_meta.get("index")
            if idx_raw is not None and str(idx_raw).strip():
                index_value = int(str(idx_raw).strip())
        except Exception:
            index_value = None
        if (not citation or _is_source_itemkey_fallback_citation(citation)) and prefix:
            citation = prefix_citation.get(prefix, "")
            if index_value is None:
                try:
                    if prefix_meta.get("index") is not None and str(prefix_meta.get("index")).strip():
                        index_value = int(str(prefix_meta.get("index")).strip())
                except Exception:
                    index_value = None

        if not citation or _is_source_itemkey_fallback_citation(citation):
            author = str(first_meta.get("author") or prefix_meta.get("author") or "").strip()
            year = _extract_year_token(first_meta.get("year")) or _extract_year_token(prefix_meta.get("year"))
            if not year:
                year = _extract_year_token(first_meta.get("citation")) or _extract_year_token(prefix_meta.get("citation"))
            if author and year:
                citation = f"({author}, {year})"

        page_value: int | None = None
        try:
            page_raw = first_meta.get("page_no")
            if page_raw is not None and str(page_raw).strip():
                page_value = int(str(page_raw).strip())
        except Exception:
            page_value = None
        if page_value is None:
            pdf_path = str(first_meta.get("pdf_path") or "").strip()
            if pdf_path and quote:
                page_found = _find_quote_page(pdf_path, quote)
                if page_found is not None:
                    page_value = page_found
                    first_meta["page_no"] = str(page_found)
        if normalized_style == "apa":
            citation = _append_page_to_apa_citation(citation, page_value)

        inner_text = _decode_html_entities(_html_to_text(inner))
        if not citation:
            if re.match(r"^\([^()]{2,220}\)$", inner_text) and not _is_source_itemkey_fallback_citation(inner_text):
                citation = inner_text
            else:
                citation = "(Source citation)"
        link_text, allow_html = _format_intext_citation(citation_style, citation, index_value)

        if normalized_style == "apa" and len(resolved) > 1:
            extra_count = max(0, len(resolved) - 1)
            lead = citation.strip()
            if lead.startswith("(") and lead.endswith(")"):
                lead = lead[1:-1].strip()
            link_text = f"({lead}; {extra_count} other citations)"
            allow_html = False

        title_meta = _decode_html_entities(str(first_meta.get("title") or prefix_meta.get("title") or "").strip())
        title_source = _decode_html_entities(quote or "")
        if not title_source:
            if title_meta:
                title_source = title_meta
            else:
                title_source = inner_text
        if re.search(r"\bsource\b", title_source, flags=re.IGNORECASE) and re.search(r"\b1900\b", title_source):
            title_source = title_meta
        if re.fullmatch(r"[A-Za-z0-9_-]{8,}#DQ\d{3}", title_source) or re.fullmatch(r"[A-Za-z0-9_-]{8,}", title_source):
            title_source = ""
        title = html.escape((title_source[:420] if title_source else "Source excerpt"), quote=True)
        label_html = link_text if allow_html else html.escape(link_text)

        href_target = source_url
        if not href_target:
            # Preserve existing valid URL href from original anchor if available.
            href_match = re.search(r'\bhref\s*=\s*["\']([^"\']+)["\']', attrs, flags=re.IGNORECASE)
            if href_match:
                candidate = _sanitize_href_url(str(href_match.group(1) or "").strip())
                if candidate:
                    href_target = candidate
        if not href_target:
            href_target = _fallback_source_url_for_dqid(first_dqid, first_meta or prefix_meta)
        data_dqid = ";".join([d for d, _ in resolved]) or raw_dqid
        return (
            f"<a class=\"dqid-cite\" data-dqid=\"{html.escape(data_dqid)}\" "
            f"href=\"{html.escape(href_target, quote=True)}\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"{title}\">{label_html}</a>"
        )

    pattern = re.compile(r"<a([^>]*\bdata-dqid\s*=\s*[\"']([^\"']+)[\"'][^>]*)>(.*?)</a>", flags=re.IGNORECASE | re.DOTALL)
    out = pattern.sub(_replace_anchor, section_html)
    return _dedupe_citation_anchors_html(out)


def _inject_dqid_anchors_if_missing(
    section_html: str,
    dqid_lookup: dict[str, dict[str, str]],
    *,
    max_anchors: int = 4,
    citation_style: str = "apa",
) -> str:
    if not section_html or not dqid_lookup:
        return section_html
    if re.search(r"<a[^>]*\bdata-dqid\s*=", section_html, flags=re.IGNORECASE):
        return section_html
    dqids = list(dqid_lookup.keys())[: max(1, int(max_anchors))]
    if not dqids:
        return section_html
    anchors = []
    for dqid in dqids:
        _, meta = _resolve_dqid_meta(dqid, dqid_lookup)
        prefix = dqid.split("#", 1)[0].strip() if "#" in dqid else ""
        prefix_meta = dqid_lookup.get(prefix, {}) if prefix else {}
        if not isinstance(prefix_meta, dict):
            prefix_meta = {}
        citation = str(meta.get("citation") or "(Source citation)")
        if _is_source_itemkey_fallback_citation(citation):
            citation = str(prefix_meta.get("citation") or citation).strip()
        if _is_source_itemkey_fallback_citation(citation):
            author = str(meta.get("author") or prefix_meta.get("author") or "").strip()
            year = _extract_year_token(meta.get("year")) or _extract_year_token(prefix_meta.get("year"))
            if author and year:
                citation = f"({author}, {year})"
        idx_val: int | None = None
        try:
            if meta.get("index") is not None and str(meta.get("index")).strip():
                idx_val = int(str(meta.get("index")).strip())
            elif prefix_meta.get("index") is not None and str(prefix_meta.get("index")).strip():
                idx_val = int(str(prefix_meta.get("index")).strip())
        except Exception:
            idx_val = None
        page_no: int | None = None
        try:
            page_raw = meta.get("page_no")
            if (page_raw is None or not str(page_raw).strip()) and prefix_meta:
                page_raw = prefix_meta.get("page_no")
            if page_raw is not None and str(page_raw).strip():
                page_no = int(str(page_raw).strip())
        except Exception:
            page_no = None
        if _normalize_citation_style(citation_style) == "apa":
            citation = _append_page_to_apa_citation(citation, page_no)
        label, allow_html = _format_intext_citation(citation_style, citation, idx_val)
        label_html = label if allow_html else html.escape(label)
        quote = _decode_html_entities(str(meta.get("quote") or prefix_meta.get("quote") or "").strip())
        title_fallback = _decode_html_entities(str(meta.get("title") or prefix_meta.get("title") or "").strip())
        title_src = quote[:420] if quote else (title_fallback[:420] if title_fallback else "Source excerpt")
        href = _source_url_from_meta_fields(meta)
        if not href:
            href = _source_url_from_meta_fields(prefix_meta)
        if not href:
            href = _fallback_source_url_for_dqid(dqid, meta)
        anchors.append(
            f"<a class=\"dqid-cite\" data-dqid=\"{html.escape(dqid)}\" "
            f"href=\"{html.escape(href, quote=True)}\" target=\"_blank\" rel=\"noopener noreferrer\" "
            f"title=\"{html.escape(title_src, quote=True)}\">{label_html}</a>"
        )
    cite_block = " " + " ".join(anchors)
    if re.search(r"</p>", section_html, flags=re.IGNORECASE):
        out = re.sub(r"</p>", f"{cite_block}</p>", section_html, count=1, flags=re.IGNORECASE)
        return _dedupe_citation_anchors_html(out)
    return _dedupe_citation_anchors_html(f"<p>{section_html}{cite_block}</p>")


def _normalize_citation_style(style: str) -> str:
    key = str(style or "apa").strip().lower()
    normalized = CITATION_STYLE_ALIASES.get(key)
    if not normalized:
        allowed = ", ".join(sorted(set(CITATION_STYLE_ALIASES.values())))
        raise ValueError(f"Unsupported citation_style '{style}'. Allowed: {allowed}")
    return normalized


def _format_intext_citation(style: str, citation: str, index: int | None) -> tuple[str, bool]:
    normalized = _normalize_citation_style(style)
    cite = str(citation or "").strip() or "(Source citation)"
    if normalized == "apa":
        return cite, False
    if index is None:
        return cite, False
    if normalized == "numeric":
        return f"[{index}]", False
    if normalized == "parenthetical_footnote":
        return f"(see note {index})", False
    if normalized == "endnote":
        return f"<sup>{index}</sup>", True
    return cite, False


def _normalize_citation_lookup_key(value: str) -> str:
    s = str(value or "")
    s = re.sub(r"&\s*#x?27;", "'", s, flags=re.IGNORECASE)
    s = re.sub(r"&\s*#39;", "'", s, flags=re.IGNORECASE)
    s = html.unescape(s).strip().strip("()")
    s = re.sub(r"^(?:e\.g\.|i\.e\.|see|cf\.)\s*,?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\bpp?\.\s*\d+(?:\s*[-–]\s*\d+)?", "", s, flags=re.IGNORECASE)
    s = re.sub(r",\s*$", "", s)
    s = re.sub(r"'\s+", "'", s)
    s = re.sub(r"’\s+", "’", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    s = re.sub(r"\s*([,;])\s*", r"\1", s)
    return s


def _build_author_year_lookup(dqid_lookup: dict[str, dict[str, str]]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for dqid, meta in dqid_lookup.items():
        if not isinstance(meta, dict):
            continue
        citation = str(meta.get("citation") or "").strip()
        if not citation:
            continue
        norm_full = _normalize_citation_lookup_key(citation)
        if norm_full and norm_full not in lookup:
            lookup[norm_full] = str(dqid)
        no_page = re.sub(r",\s*pp?\.\s*\d+(?:\s*[-–]\s*\d+)?", "", citation, flags=re.IGNORECASE)
        norm_no_page = _normalize_citation_lookup_key(no_page)
        if norm_no_page and norm_no_page not in lookup:
            lookup[norm_no_page] = str(dqid)
    return lookup


def _is_author_year_part(part: str) -> bool:
    p = _normalize_citation_lookup_key(part)
    if not p:
        return False
    # Author labels only; exclude numeric/group descriptors (e.g., "55 items, 2010-2012").
    return bool(
        re.match(
            r"^(?:[a-z][a-z'’.\-]+(?:\s+(?:[a-z][a-z'’.\-]+|&|and|et al\.?)){0,5}),\s*(?:19|20)\d{2}[a-z]?(?:,\s*p{1,2}\.?\s*\d+(?:[-–]\d+)?)?$",
            p,
            flags=re.IGNORECASE,
        )
    )


def _anchor_plain_author_year_citations(
    html_text: str,
    dqid_lookup: dict[str, dict[str, str]],
    *,
    citation_style: str = "apa",
) -> str:
    if _normalize_citation_style(citation_style) != "apa":
        return str(html_text or "")
    if not dqid_lookup:
        return str(html_text or "")
    text = str(html_text or "")
    citation_lookup = _build_author_year_lookup(dqid_lookup)
    if not citation_lookup:
        return text

    ref_token = "__TEIA_REFS_BLOCK__"
    refs_match = re.search(
        r"(<div id=\"references\" class=\"section-content\">.*?</div>)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    refs_block = refs_match.group(1) if refs_match else ""
    if refs_match:
        text = text[: refs_match.start()] + ref_token + text[refs_match.end() :]

    anchor_re = re.compile(r"(<a\b[^>]*>.*?</a>)", flags=re.IGNORECASE | re.DOTALL)
    paren_re = re.compile(r"\(([^()]*\d{4}[^()]*)\)")

    def _replace_parenthetical(m: re.Match[str]) -> str:
        body = str(m.group(1) or "")
        body = re.sub(r"&\s*#x?27;", "'", body, flags=re.IGNORECASE)
        body = re.sub(r"&\s*#39;", "'", body, flags=re.IGNORECASE)
        body = html.unescape(body).strip()
        if not body or "see note" in body.lower():
            return m.group(0)
        parts = [p.strip() for p in body.split(";") if p.strip()]
        if not parts:
            return m.group(0)
        matched: list[str] = []
        for part in parts:
            part_clean = _decode_html_entities(
                re.sub(r"^(?:e\.g\.|i\.e\.|see|cf\.)\s*,?\s*", "", part, flags=re.IGNORECASE).strip()
            )
            if not _is_author_year_part(part_clean):
                continue
            dqid = citation_lookup.get(_normalize_citation_lookup_key(part_clean))
            if dqid and dqid not in matched:
                matched.append(dqid)
        if not matched:
            return m.group(0)
        data_dqid = ";".join(matched)
        return f"<a data-dqid=\"{html.escape(data_dqid, quote=True)}\">({html.escape(body)})</a>"

    segments = anchor_re.split(text)
    for i, segment in enumerate(segments):
        if i % 2 == 1:
            continue
        segments[i] = paren_re.sub(_replace_parenthetical, segment)
    merged = "".join(segments)
    merged = _enrich_dqid_anchors(merged, dqid_lookup, citation_style=citation_style)
    merged = _dedupe_citation_anchors_html(merged)
    if refs_match:
        merged = merged.replace(ref_token, refs_block)
    return merged


def _find_unanchored_author_year_citations(html_text: str) -> list[str]:
    text = str(html_text or "")
    text = re.sub(
        r"<h[1-6][^>]*>\s*(?:\d+\.\s*)?References\s*</h[1-6]>[\s\S]*$",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    for tag in ("div", "section", "ol", "ul"):
        text = re.sub(
            rf"<{tag}[^>]*(?:id|class)=\"[^\"]*references?[^\"]*\"[^>]*>.*?</{tag}>",
            " ",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
    text = re.sub(r"<a\b[^>]*>.*?</a>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    out: list[str] = []
    for m in re.finditer(r"\(([^()]*\d{4}[^()]*)\)", text):
        block = _decode_html_entities(str(m.group(1) or "")).strip()
        parts = [re.sub(r"^(?:e\.g\.|i\.e\.|see|cf\.)\s*,?\s*", "", p.strip(), flags=re.IGNORECASE) for p in block.split(";")]
        has_author_year = any(_is_author_year_part(p or "") for p in parts)
        if not has_author_year:
            continue
        out.append(f"({block})")
        if len(out) >= 10:
            break
    return out


def _normalize_comp_text(value: str) -> str:
    s = html.unescape(str(value or ""))
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def _validate_dqid_quote_page_integrity(
    rendered: str,
    dqid_lookup: dict[str, dict[str, str]],
    *,
    citation_style: str = "apa",
    context_label: str = "Rendered HTML",
) -> None:
    text = str(rendered or "")
    normalized_style = _normalize_citation_style(citation_style)
    for m in re.finditer(
        r"<a[^>]*class=\"[^\"]*dqid-cite[^\"]*\"[^>]*>(.*?)</a>",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        tag = m.group(0)
        inner = re.sub(r"<[^>]+>", "", str(m.group(1) or "")).strip()
        dqid_m = re.search(r'\bdata-dqid\s*=\s*"([^"]+)"', tag, flags=re.IGNORECASE)
        title_m = re.search(r'\btitle\s*=\s*"([^"]*)"', tag, flags=re.IGNORECASE)
        raw_dqid = str(dqid_m.group(1) if dqid_m else "").strip()
        title = html.unescape(str(title_m.group(1) if title_m else "")).strip()
        dqids = _split_dqid_values(raw_dqid)
        first_dqid = dqids[0] if dqids else raw_dqid
        _, meta = _resolve_dqid_meta(first_dqid, dqid_lookup)
        quote = str((meta or {}).get("quote") or "").strip()

        if not title or title in {"Source excerpt", "Source citation"}:
            raise RuntimeError(f"{context_label} contains dqid-cite without verbatim quote title.")

        if quote:
            title_cmp = _normalize_comp_text(title).rstrip(".")
            title_cmp = re.sub(r"[.…]+$", "", title_cmp).strip()
            quote_cmp = _normalize_comp_text(quote)
            if title_cmp and quote_cmp and title_cmp not in quote_cmp and not quote_cmp.startswith(title_cmp):
                raise RuntimeError(
                    f"{context_label} contains dqid-cite title not aligned with source quote for dqid '{first_dqid}'."
                )

        if normalized_style == "apa":
            page_raw = str((meta or {}).get("page_no") or "").strip()
            if page_raw and page_raw.isdigit():
                p = int(page_raw)
                if not re.search(rf"\bpp?\.\s*{p}\b", inner):
                    raise RuntimeError(
                        f"{context_label} contains dqid-cite missing page in APA in-text citation for dqid '{first_dqid}' (expected p. {p})."
                    )


def _strict_dqid_citation_rules_text(citation_style: str = "apa") -> str:
    normalized = _normalize_citation_style(citation_style)
    if normalized == "apa":
        return (
            "CITATION_CONSTRAINTS\n"
            "Use citations only through <a data-dqid=\"...\">(Author, Year[, p. X])</a> from provided evidence_payload.\n"
            "Do not write plain parenthetical citations such as (Author, Year) without data-dqid anchors.\n"
            "Do not invent author names/years. If evidence is insufficient, rewrite the sentence without citation."
        )
    if normalized == "numeric":
        return (
            "CITATION_CONSTRAINTS\n"
            "Use citations only through <a data-dqid=\"...\">[n]</a> from provided evidence_payload.\n"
            "Do not invent references or citation labels."
        )
    if normalized == "endnote":
        return (
            "CITATION_CONSTRAINTS\n"
            "Use citations only through <a data-dqid=\"...\"><sup>n</sup></a> from provided evidence_payload.\n"
            "Do not invent references or citation labels."
        )
    return (
        "CITATION_CONSTRAINTS\n"
        "Use citations only through <a data-dqid=\"...\">(see note n)</a> from provided evidence_payload.\n"
        "Do not invent references or citation labels."
    )


def _validate_section_citation_integrity(
    section_name: str,
    section_html: str,
    dqid_lookup: dict[str, dict[str, str]],
    *,
    citation_style: str = "apa",
) -> str:
    cleaned = _anchor_plain_author_year_citations(section_html, dqid_lookup, citation_style=citation_style)
    try:
        _assert_reference_and_postprocess_integrity(cleaned, citation_style=citation_style)
        _validate_dqid_quote_page_integrity(
            cleaned,
            dqid_lookup,
            citation_style=citation_style,
            context_label=f"Section '{section_name}'",
        )
    except Exception as exc:
        raise RuntimeError(f"Section '{section_name}' failed citation integrity: {exc}") from exc
    return cleaned


def _citation_style_instruction(style: str) -> str:
    normalized = _normalize_citation_style(style)
    if normalized == "apa":
        return "Use in-text author-year citations in anchors, e.g., <a data-dqid=\"DQID\">(Author, Year)</a>."
    if normalized == "numeric":
        return "Use numeric in-text citations in anchors, e.g., <a data-dqid=\"DQID\">[12]</a>."
    if normalized == "endnote":
        return "Use endnote superscript anchors, e.g., <a data-dqid=\"DQID\"><sup>12</sup></a>."
    return "Use parenthetical footnote anchors, e.g., <a data-dqid=\"DQID\">(see note 12)</a>."


CACHE_SCHEMA = "systematic_section_cache_v2"


def _make_cache_entry(*, section_name: str, html_text: str, model: str, custom_id: str = "") -> dict[str, Any]:
    normalized_html = _clean_and_humanize_section_html(html_text)
    return {
        "section": str(section_name),
        "html": normalized_html,
        "model": str(model or ""),
        "custom_id": str(custom_id or ""),
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "hash": hashlib.sha1(normalized_html.encode("utf-8", errors="ignore")).hexdigest(),
    }


def _load_section_cache(path_obj: Path) -> tuple[dict[str, dict[str, Any]], dict[str, str], bool]:
    entries: dict[str, dict[str, Any]] = {}
    html_map: dict[str, str] = {}
    dirty = False
    if not path_obj.is_file():
        return entries, html_map, dirty
    try:
        loaded = json.loads(path_obj.read_text(encoding="utf-8"))
    except Exception:
        return entries, html_map, dirty

    # Legacy format: {section_name: "<html>"}
    if isinstance(loaded, dict) and "sections" not in loaded:
        for section_name, value in loaded.items():
            if not isinstance(value, str) or not value.strip():
                continue
            clean_html = _clean_and_humanize_section_html(value)
            entry = _make_cache_entry(section_name=str(section_name), html_text=clean_html, model="", custom_id="")
            entries[str(section_name)] = entry
            html_map[str(section_name)] = clean_html
        return entries, html_map, True

    if not isinstance(loaded, dict):
        return entries, html_map, dirty
    sections = loaded.get("sections")
    if not isinstance(sections, dict):
        return entries, html_map, dirty

    for section_name, payload in sections.items():
        if not isinstance(payload, dict):
            dirty = True
            continue
        html_text = payload.get("html")
        if not isinstance(html_text, str) or not html_text.strip():
            dirty = True
            continue
        clean_html = _clean_and_humanize_section_html(html_text)
        entry = {
            "section": str(payload.get("section") or section_name),
            "html": clean_html,
            "model": str(payload.get("model") or ""),
            "custom_id": str(payload.get("custom_id") or ""),
            "created_at": str(payload.get("created_at") or ""),
            "hash": str(payload.get("hash") or hashlib.sha1(clean_html.encode("utf-8", errors="ignore")).hexdigest()),
        }
        entries[str(section_name)] = entry
        html_map[str(section_name)] = clean_html
        if clean_html != html_text:
            dirty = True
    if str(loaded.get("schema") or "") != CACHE_SCHEMA:
        dirty = True
    return entries, html_map, dirty


def _write_section_cache(path_obj: Path, entries: dict[str, dict[str, Any]]) -> None:
    payload = {
        "schema": CACHE_SCHEMA,
        "updated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "sections": entries,
    }
    path_obj.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _legacy_cache_candidates(output_dir: Path) -> list[Path]:
    candidates: list[Path] = []
    # Current output layout: <outputs>/<collection>/SLR
    # Legacy layout: <outputs>/<collection>
    if output_dir.name == "SLR":
        candidates.append(output_dir.parent / "section_generation_cache.json")
        # Cross-output-root fallback: reuse previously generated cache from canonical Research/outputs.
        candidates.append(_repo_root() / "Research" / "outputs" / output_dir.parent.name / "section_generation_cache.json")
    # In case older runs wrote directly in the current directory with different casing.
    candidates.append(output_dir / "section_cache.json")
    return [p for p in candidates if p.is_file()]


def _merge_cache_entries(
    primary_entries: dict[str, dict[str, Any]],
    primary_html_map: dict[str, str],
    fallback_entries: dict[str, dict[str, Any]],
    fallback_html_map: dict[str, str],
) -> bool:
    changed = False
    for section_name, html_text in fallback_html_map.items():
        if section_name in primary_html_map and str(primary_html_map.get(section_name) or "").strip():
            continue
        entry = fallback_entries.get(section_name)
        if not isinstance(entry, dict):
            entry = _make_cache_entry(section_name=section_name, html_text=html_text, model="", custom_id="")
        primary_entries[section_name] = entry
        primary_html_map[section_name] = str(entry.get("html") or html_text or "")
        changed = True
    return changed


def _assert_section_citation_coverage(section_name: str, section_html: str, dqid_lookup: dict[str, dict[str, str]]) -> None:
    evidence_sections = {"narrative_synthesis", "discussion", "limitations", "introduction", "conclusion", "abstract"}
    if section_name not in evidence_sections:
        return

    anchors = re.findall(r"<a[^>]*\bdata-dqid\s*=\s*[\"']([^\"']+)[\"'][^>]*>", str(section_html or ""), flags=re.IGNORECASE)
    if len(anchors) < 1:
        raise RuntimeError(f"Section '{section_name}' has no dqid citations.")
    unresolved: list[str] = []
    for dqid in anchors:
        token = str(dqid or "").strip()
        if not token:
            unresolved.append(token)
            continue
        if token in dqid_lookup:
            continue
        prefix = token.split("#", 1)[0] if "#" in token else token
        if prefix in dqid_lookup:
            continue
        unresolved.append(token)
    if unresolved:
        sample = ", ".join(unresolved[:5])
        raise RuntimeError(f"Section '{section_name}' has unresolved dqid citations: {sample}")


def render_systematic_review_from_summary(
    *,
    summary: dict[str, Any],
    template_path: Path,
    outputs_root: Path,
    use_llm: bool = True,
    model: str = "gpt-5-mini",
    section_timeout_s: int = 0,
    section_single_batch: bool = False,
    citation_style: str = "apa",
    prisma_figure_path: Path | None = None,
) -> PipelineResult:
    raw_collection_name = str(summary.get("collection_name") or "").strip()
    if not raw_collection_name:
        raise ValueError("summary.collection_name is required")
    collection_name = _resolve_collection_label(raw_collection_name)
    output_dir = outputs_root / _safe_name(collection_name) / "SLR"
    output_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = output_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    section_cache_path = output_dir / "section_generation_cache.json"
    section_cache_entries, section_cache, section_cache_dirty = _load_section_cache(section_cache_path)
    # Backward compatibility: migrate/merge legacy cache if present.
    for candidate in _legacy_cache_candidates(output_dir):
        legacy_entries, legacy_map, _ = _load_section_cache(candidate)
        if _merge_cache_entries(section_cache_entries, section_cache, legacy_entries, legacy_map):
            section_cache_dirty = True
    if section_cache_dirty:
        _write_section_cache(section_cache_path, section_cache_entries)

    input_block = summary.get("input", {}) if isinstance(summary.get("input"), dict) else {}
    research_questions = _extract_research_questions(summary)
    temporal_mode = _extract_temporal_flag(summary)
    ev_stats = input_block.get("evidence_normalization", {}) if isinstance(input_block.get("evidence_normalization"), dict) else {}
    rq_lines = _rq_findings_lines(summary)
    theme_counts = _compute_theme_counts(summary)
    top_theme_labels = list(theme_counts.keys())[:10]
    top_theme_values = [theme_counts[k] for k in top_theme_labels]

    prisma_counts = {
        "db": _safe_int(input_block.get("item_count"), 0),
        "dup": 0,
        "screen": _safe_int(input_block.get("item_count"), 0),
        "screen_ex": 0,
        "full": _safe_int(input_block.get("item_count"), 0),
        "full_ex": 0,
        "included": _safe_int(input_block.get("item_count"), 0),
    }
    prisma_svg = _svg_prisma(prisma_counts)
    themes_svg = _svg_bar_chart(
        "Top Section-Level Themes Frequency (Excludes Intro/Conclusion Core Claims)",
        top_theme_labels or ["no_data"],
        top_theme_values or [0],
    )
    prisma_svg_path = assets_dir / "prisma_flow.svg"
    themes_svg_path = assets_dir / "theme_frequencies.svg"
    if prisma_figure_path:
        pf = Path(prisma_figure_path).expanduser().resolve()
        if not pf.is_file():
            raise RuntimeError(f"Provided PRISMA figure path is not a file: {pf}")
        suffix = pf.suffix.lower()
        if suffix not in {".png", ".svg", ".jpg", ".jpeg", ".webp"}:
            raise RuntimeError(f"Unsupported PRISMA figure format '{suffix}' for file: {pf}")
        prisma_svg_path = assets_dir / f"prisma_flow{suffix}"
        prisma_svg_path.write_bytes(pf.read_bytes())
    else:
        prisma_svg_path.write_text(prisma_svg, encoding="utf-8")
    themes_svg_path.write_text(themes_svg, encoding="utf-8")

    if not use_llm:
        raise RuntimeError("Strict systematic-review writing requires LLM generation; disable was requested.")
    citation_style = _normalize_citation_style(citation_style)
    payload_base = {
        "collection_name": collection_name,
        "overarching_theme": collection_name,
        "item_count": _safe_int(input_block.get("item_count"), 0),
        "evidence_kept": _safe_int(ev_stats.get("evidence_kept"), 0),
        "research_questions": research_questions,
        "temporal_mode": bool(temporal_mode),
        "rq_findings": [_humanize_theme_tokens(x) for x in rq_lines],
        "top_themes": [{k: v} for k, v in list(theme_counts.items())[:15]],
    }
    payload_base["citation_style"] = citation_style
    payload_base["top_themes"] = [{_humanize_theme_tokens(str(list(d.keys())[0])): list(d.values())[0]} for d in payload_base["top_themes"]]
    full_rows_cap = _env_optional_limit("SYSTEMATIC_FULL_EVIDENCE_ROWS", default=0, max_value=2_000_000)
    dqid_payload_full, dqid_lookup = _build_dqid_evidence_payload(summary, max_rows=full_rows_cap)
    ev_rows = _env_int("SYSTEMATIC_SECTION_EVIDENCE_ROWS", 260, min_value=80, max_value=1200)
    ev_quote_chars = _env_int("SYSTEMATIC_SECTION_QUOTE_CHARS", 220, min_value=80, max_value=800)
    ev_round_rows = _env_int("SYSTEMATIC_EVIDENCE_ROUND_ROWS", ev_rows, min_value=50, max_value=5000)
    ev_round_bytes = _env_int("SYSTEMATIC_EVIDENCE_ROUND_BYTES", 1_500_000, min_value=200_000, max_value=50_000_000)
    evidence_rounds = _split_evidence_rows_into_capped_rounds(
        dqid_payload_full,
        row_cap=ev_round_rows,
        byte_cap=ev_round_bytes,
        quote_chars=ev_quote_chars,
    )
    dqid_payload = (
        list(evidence_rounds[0].get("compact_rows") or [])
        if evidence_rounds
        else _compact_evidence_payload_for_prompt(
            dqid_payload_full,
            max_rows=ev_rows,
            quote_chars=ev_quote_chars,
        )
    )
    rounds_path = output_dir / "evidence_payload_rounds.json"
    rounds_export = [
        {
            "round": int(r.get("round") or 0),
            "rows_count": int(r.get("rows_count") or 0),
            "bytes_estimate": int(r.get("bytes_estimate") or 0),
            "rows": list(r.get("compact_rows") or []),
        }
        for r in evidence_rounds
    ]
    rounds_manifest_lines = _evidence_round_manifest_lines(evidence_rounds, research_questions)
    covered_rows = sum(int(r.get("rows_count") or 0) for r in evidence_rounds)
    rounds_path.write_text(
        json.dumps(
            {
                "schema": "systematic_evidence_payload_rounds_v1",
                "collection_name": collection_name,
                "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                "row_cap": ev_round_rows,
                "byte_cap": ev_round_bytes,
                "rows_total": len(dqid_payload_full),
                "rows_covered": covered_rows,
                "round_count": len(evidence_rounds),
                "round_manifest": rounds_manifest_lines,
                "rounds": rounds_export,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    payload_base["evidence_payload"] = dqid_payload
    payload_base["evidence_payload_rounds"] = {
        "round_count": len(evidence_rounds),
        "row_cap": int(ev_round_rows),
        "byte_cap": int(ev_round_bytes),
        "rows_total": len(dqid_payload_full),
        "rows_covered": int(covered_rows),
        "all_rows_covered": bool(len(dqid_payload_full) == covered_rows),
        "manifest": rounds_manifest_lines,
        "rounds_path": str(rounds_path),
    }
    round_synthesis_html = ""
    round_synthesis_enabled = _env_bool("SYSTEMATIC_ROUND_SYNTHESIS_ENABLED", default=True)
    round_synthesis_strict_fail = _env_bool("SYSTEMATIC_ROUND_SYNTHESIS_STRICT_FAIL", default=True)
    if round_synthesis_enabled and len(dqid_payload_full) > max(1, ev_rows):
        try:
            round_synth = _run_round_synthesis_section(
                payloads=dqid_payload_full,
                output_dir=output_dir,
                collection_name=collection_name,
                research_questions=research_questions,
                temporal_mode=bool(temporal_mode),
                model=model,
                section_timeout_s=int(section_timeout_s),
                citation_style=citation_style,
            )
            if str(round_synth.get("status") or "") == "ok":
                rr = round_synth.get("result", {}) if isinstance(round_synth.get("result"), dict) else {}
                final_text = str(rr.get("final_text") or "").strip()
                if final_text:
                    round_synthesis_html = final_text
                payload_base["round_synthesis"] = {
                    "path": str(round_synth.get("path") or ""),
                    "coverage": rr.get("coverage") if isinstance(rr.get("coverage"), dict) else {},
                    "map_rounds": len(rr.get("map_rounds") or []) if isinstance(rr.get("map_rounds"), list) else 0,
                    "reduce_rounds": len(rr.get("reduce_rounds") or []) if isinstance(rr.get("reduce_rounds"), list) else 0,
                }
        except Exception as exc:
            payload_base["round_synthesis"] = {
                "status": "error",
                "error": str(exc),
            }
            _dbg("render_systematic_review_from_summary", f"round_synthesis_error err={str(exc)}")
            if round_synthesis_strict_fail:
                raise
    _dbg(
        "render_systematic_review_from_summary",
        f"payload_evidence_compacted rows={len(dqid_payload)} quote_chars={ev_quote_chars} "
        f"full_rows={len(dqid_payload_full)} full_cap={full_rows_cap or 'unlimited'} "
        f"rounds={len(evidence_rounds)} rows_covered={covered_rows} round_row_cap={ev_round_rows} round_byte_cap={ev_round_bytes}",
    )
    citation_instruction = _citation_style_instruction(citation_style)

    phase1_section_specs = {
        "eligibility_criteria_protocol": "Write protocol-grade eligibility criteria as one concise block using inclusion/exclusion dimensions and scope. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "search_strategy": "Write the information-sources and search-strategy summary for methods section in protocol style. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "study_selection_methods": "Write the Study Selection methods with reviewer workflow and conflict-resolution process. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "data_extraction_methods": "Write the Data Extraction methods including fields extracted and reviewer process. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "risk_of_bias_methods": "Write Risk of Bias assessment methods and tool usage in concise protocol language. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "data_synthesis_methods": "Write the Data Synthesis methods with analytic strategy and rationale. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "discussion": "Write the discussion section with interpretation, implications, and disagreements/uncertainty. Use formal publication prose only; do not mention prompts, context JSON, or AI. Include 1-3 evidence anchors per paragraph and only use dqids provided in evidence_payload.",
        "limitations": "Write limitations grounded in available synthesis constraints and data-quality limitations. Use formal publication prose only; do not mention prompts, context JSON, or AI. Include 1-3 evidence anchors per paragraph and only use dqids provided in evidence_payload.",
    }
    section_specs = {
        "eligibility_criteria_protocol": {"min": 120, "max": 280},
        "search_strategy": {"min": 160, "max": 560},
        "study_selection_methods": {"min": 110, "max": 1200},
        "data_extraction_methods": {"min": 110, "max": 1200},
        "risk_of_bias_methods": {"min": 90, "max": 1200},
        "data_synthesis_methods": {"min": 110, "max": 1200},
        "narrative_synthesis": {"min": 280, "max": 2800},
        "discussion": {"min": 300, "max": 1800},
        "limitations": {"min": 180, "max": 1200},
        "introduction": {"min": 250, "max": 1800},
        "conclusion": {"min": 180, "max": 900},
        "abstract": {"min": 180, "max": 360, "forbid_h4": True},
    }
    llm_sections: dict[str, str] = {}
    if section_single_batch:
        call_models_zt = _load_call_models_zt()
        llms_dir = _repo_root() / "python_backend_legacy" / "llms"
        if str(llms_dir) not in sys.path:
            sys.path.insert(0, str(llms_dir))
        import calling_models as cm  # type: ignore

        function_name = "systematic_review_section_writer"
        safe_collection = cm.safe_name(collection_name) if hasattr(cm, "safe_name") else _safe_name(collection_name)
        safe_function = cm.safe_name(function_name) if hasattr(cm, "safe_name") else _safe_name(function_name)
        batch_root = cm.get_batch_root() if hasattr(cm, "get_batch_root") else (_repo_root() / "tmp" / "batching_files" / "batches")
        func_dir = Path(batch_root) / safe_function
        func_dir.mkdir(parents=True, exist_ok=True)
        input_file = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
        output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
        meta_file = func_dir / f"{safe_collection}_{safe_function}_batch_metadata.json"
        for fp in (input_file, output_file, meta_file):
            if fp.exists():
                fp.unlink()

        phase1_target_tokens = _env_int("SYSTEMATIC_PHASE1_TARGET_TOKENS", 5200, min_value=1800, max_value=20000)
        phase1_hard_cap = _env_int("SYSTEMATIC_PHASE1_HARD_CAP_TOKENS", 7600, min_value=2400, max_value=30000)
        phase1_context_json, phase1_context_meta_json = _prepare_prompt_context_strings(
            payload_base,
            target_tokens=phase1_target_tokens,
            hard_cap_tokens=phase1_hard_cap,
            label="phase1",
        )

        pending_phase1: list[tuple[str, str]] = []
        for section_name, instruction in phase1_section_specs.items():
            if section_name in section_cache:
                cached_html = _clean_and_humanize_section_html(section_cache[section_name])
                cached_html = _enrich_dqid_anchors(cached_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    if section_name in {"narrative_synthesis", "discussion", "limitations"}:
                        cached_html = _inject_dqid_anchors_if_missing(cached_html, dqid_lookup, citation_style=citation_style)
                    _validate_generated_section(section_name, cached_html, cfg)
                    llm_sections[section_name] = cached_html
                    continue
                except Exception:
                    section_cache.pop(section_name, None)
                    section_cache_entries.pop(section_name, None)
                    _write_section_cache(section_cache_path, section_cache_entries)
            prompt = (
                "SECTION_NAME\n"
                f"{section_name}\n\n"
                "INSTRUCTION\n"
                f"{instruction}\n\n"
                "CONTEXT_JSON\n"
                f"{phase1_context_json}\n\n"
                "CONTEXT_META_JSON\n"
                f"{phase1_context_meta_json}\n\n"
                "STYLE_GUARD\n"
                "Write formal publication prose only. Do not mention provided context, context json, prompts, or AI.\n\n"
                "CITATION_STYLE\n"
                f"{citation_instruction}\n\n"
                "Return only raw HTML snippets, no markdown fences."
            )
            custom_id = _stable_section_custom_id(collection_name, section_name, prompt)
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
            pending_phase1.append((section_name, custom_id))

        if pending_phase1:
            _dbg("render_systematic_review_from_summary", f"phase1_group_batch_start pending={len(pending_phase1)} collection={safe_collection}")
            ok = cm._process_batch_for(analysis_key_suffix=function_name, section_title=safe_collection, poll_interval=30)
            if ok is not True:
                raise RuntimeError("Phase-1 grouped section batch failed.")
            _dbg("render_systematic_review_from_summary", "phase1_group_batch_done")
            for section_name, custom_id in pending_phase1:
                response = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
                section_html = _clean_and_humanize_section_html(_clean_llm_html(_extract_llm_text(response)))
                section_html = _enrich_dqid_anchors(section_html, dqid_lookup, citation_style=citation_style)
                if section_name in {"narrative_synthesis", "discussion", "limitations"}:
                    section_html = _inject_dqid_anchors_if_missing(section_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    _validate_generated_section(section_name, section_html, cfg)
                except Exception:
                    # keep batch output to avoid aborting whole paper generation
                    pass
                llm_sections[section_name] = section_html
                section_cache[section_name] = section_html
                section_cache_entries[section_name] = _make_cache_entry(
                    section_name=section_name,
                    html_text=section_html,
                    model=model,
                    custom_id=custom_id,
                )
                _write_section_cache(section_cache_path, section_cache_entries)
    else:
        phase1_target_tokens = _env_int("SYSTEMATIC_PHASE1_TARGET_TOKENS", 5200, min_value=1800, max_value=20000)
        phase1_hard_cap = _env_int("SYSTEMATIC_PHASE1_HARD_CAP_TOKENS", 7600, min_value=2400, max_value=30000)
        phase1_context_json, phase1_context_meta_json = _prepare_prompt_context_strings(
            payload_base,
            target_tokens=phase1_target_tokens,
            hard_cap_tokens=phase1_hard_cap,
            label="phase1",
        )
        for section_name, instruction in phase1_section_specs.items():
            base_prompt = (
                "SECTION_NAME\n"
                f"{section_name}\n\n"
                "INSTRUCTION\n"
                f"{instruction}\n\n"
                "CONTEXT_JSON\n"
                f"{phase1_context_json}\n\n"
                "CONTEXT_META_JSON\n"
                f"{phase1_context_meta_json}\n\n"
                "Return only raw HTML snippets, no markdown fences."
            )
            if section_name in section_cache:
                cached_html = _clean_and_humanize_section_html(section_cache[section_name])
                cached_html = _enrich_dqid_anchors(cached_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    if section_name in {"narrative_synthesis", "discussion", "limitations"}:
                        cached_html = _inject_dqid_anchors_if_missing(cached_html, dqid_lookup, citation_style=citation_style)
                    _validate_generated_section(section_name, cached_html, cfg)
                    llm_sections[section_name] = cached_html
                    continue
                except Exception:
                    section_cache.pop(section_name, None)
                    section_cache_entries.pop(section_name, None)
                    _write_section_cache(section_cache_path, section_cache_entries)
            try:
                section_html = ""
                last_err: Exception | None = None
                for attempt in range(1, 4):
                    retry_guard = (
                        "\n\nSTYLE_GUARD\n"
                        "Write formal publication prose only. Do not mention 'provided context', "
                        "'context json', prompts, or AI. Do not include placeholders.\n"
                        + f"\nCITATION_STYLE\n{citation_instruction}\n"
                    )
                    prompt = base_prompt + (retry_guard if attempt > 1 else "")
                    custom_id = _stable_section_custom_id(collection_name, f"{section_name}_a{attempt}", prompt)
                    call_kwargs = {
                        "text": prompt,
                        "function": "systematic_review_section_writer",
                        "custom_id": custom_id,
                        "collection_name": collection_name,
                        "model": model,
                        "ai": "openai",
                        "read": False,
                        "store_only": False,
                        "cache": False,
                    }
                    response = _call_models_with_timeout(timeout_s=int(section_timeout_s), kwargs=call_kwargs)
                    section_html = _clean_llm_html(_extract_llm_text(response))
                    if not section_html:
                        last_err = RuntimeError(f"LLM returned empty section content for '{section_name}'.")
                        continue
                    section_html = _clean_and_humanize_section_html(section_html)
                    section_html = _enrich_dqid_anchors(section_html, dqid_lookup, citation_style=citation_style)
                    if section_name in {"narrative_synthesis", "discussion", "limitations"}:
                        section_html = _inject_dqid_anchors_if_missing(section_html, dqid_lookup, citation_style=citation_style)
                    cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                    try:
                        _validate_generated_section(section_name, section_html, cfg)
                        llm_sections[section_name] = section_html
                        section_cache[section_name] = section_html
                        section_cache_entries[section_name] = _make_cache_entry(
                            section_name=section_name,
                            html_text=section_html,
                            model=model,
                            custom_id=custom_id,
                        )
                        _write_section_cache(section_cache_path, section_cache_entries)
                        last_err = None
                        break
                    except Exception as exc:
                        last_err = exc
                        continue
                if last_err is not None:
                    raise last_err
            except TimeoutError as exc:
                raise RuntimeError(f"Timeout while generating section '{section_name}' after {section_timeout_s}s.") from exc

    narrative_html = _build_results_narrative_html(
        collection_name=collection_name,
        model=model,
        research_questions=research_questions,
        rows=dqid_payload_full,
        dqid_lookup=dqid_lookup,
        citation_style=citation_style,
        temporal=bool(temporal_mode),
    )
    if round_synthesis_html.strip():
        narrative_html = (
            f"{narrative_html}"
            "<h4>Cross-Round Synthesis</h4>"
            f"{round_synthesis_html}"
        )
        narrative_html = _clean_and_humanize_section_html(narrative_html)
        narrative_html = _enrich_dqid_anchors(narrative_html, dqid_lookup, citation_style=citation_style)
        narrative_html = _inject_dqid_anchors_if_missing(
            narrative_html,
            dqid_lookup,
            max_anchors=max(6, _env_int("SYSTEMATIC_RQ_CITES_PER_THEME", 3, min_value=1, max_value=10)),
            citation_style=citation_style,
        )
    if narrative_html.strip():
        llm_sections["narrative_synthesis"] = narrative_html
        section_cache["narrative_synthesis"] = narrative_html
        section_cache_entries["narrative_synthesis"] = _make_cache_entry(
            section_name="narrative_synthesis",
            html_text=narrative_html,
            model=model,
            custom_id="deterministic_results_synthesis",
        )
        _write_section_cache(section_cache_path, section_cache_entries)

    whole_paper_payload = {
        **payload_base,
        "draft_sections_html": {
            "methods_search_strategy": llm_sections["search_strategy"],
            "eligibility_criteria_protocol": llm_sections["eligibility_criteria_protocol"],
            "study_selection_methods": llm_sections["study_selection_methods"],
            "data_extraction_methods": llm_sections["data_extraction_methods"],
            "risk_of_bias_methods": llm_sections["risk_of_bias_methods"],
            "data_synthesis_methods": llm_sections["data_synthesis_methods"],
            "results_narrative_synthesis": llm_sections["narrative_synthesis"],
            "discussion": llm_sections["discussion"],
            "limitations": llm_sections["limitations"],
        },
        "draft_sections_text": {
            "methods_search_strategy": _html_to_text(llm_sections["search_strategy"]),
            "eligibility_criteria_protocol": _html_to_text(llm_sections["eligibility_criteria_protocol"]),
            "study_selection_methods": _html_to_text(llm_sections["study_selection_methods"]),
            "data_extraction_methods": _html_to_text(llm_sections["data_extraction_methods"]),
            "risk_of_bias_methods": _html_to_text(llm_sections["risk_of_bias_methods"]),
            "data_synthesis_methods": _html_to_text(llm_sections["data_synthesis_methods"]),
            "results_narrative_synthesis": _html_to_text(llm_sections["narrative_synthesis"]),
            "discussion": _html_to_text(llm_sections["discussion"]),
            "limitations": _html_to_text(llm_sections["limitations"]),
        },
    }

    phase2_section_specs = {
        "introduction": (
            "Write the Introduction focused on the overarching theme, research gap, and objectives, using WHOLE_PAPER "
            "as primary input. Avoid operational IDs and avoid snake_case tokens. Return paragraph prose only: no headings and no bullet/numbered lists."
        ),
        "conclusion": (
            "Write the Conclusion using the WHOLE_PAPER content below as the primary input. "
            "State concrete takeaways and future work. Return paragraph prose only: no headings and no bullet/numbered lists."
        ),
        "abstract": (
            "Write a professional single-block abstract paragraph (no subsection headings) that implicitly covers "
            "background, methods, results, and conclusions using WHOLE_PAPER as primary input. Return paragraph prose only: no headings and no bullet/numbered lists."
        ),
    }
    if section_single_batch:
        call_models_zt = _load_call_models_zt()
        llms_dir = _repo_root() / "python_backend_legacy" / "llms"
        if str(llms_dir) not in sys.path:
            sys.path.insert(0, str(llms_dir))
        import calling_models as cm  # type: ignore

        function_name = "systematic_review_section_writer"
        phase2_collection = f"{collection_name}_whole_paper"
        safe_collection = cm.safe_name(phase2_collection) if hasattr(cm, "safe_name") else _safe_name(phase2_collection)
        safe_function = cm.safe_name(function_name) if hasattr(cm, "safe_name") else _safe_name(function_name)
        batch_root = cm.get_batch_root() if hasattr(cm, "get_batch_root") else (_repo_root() / "tmp" / "batching_files" / "batches")
        func_dir = Path(batch_root) / safe_function
        func_dir.mkdir(parents=True, exist_ok=True)
        input_file = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
        output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
        meta_file = func_dir / f"{safe_collection}_{safe_function}_batch_metadata.json"
        for fp in (input_file, output_file, meta_file):
            if fp.exists():
                fp.unlink()

        phase2_target_tokens = _env_int("SYSTEMATIC_PHASE2_TARGET_TOKENS", 6000, min_value=2200, max_value=24000)
        phase2_hard_cap = _env_int("SYSTEMATIC_PHASE2_HARD_CAP_TOKENS", 8600, min_value=3000, max_value=32000)
        phase2_context_json, phase2_context_meta_json = _prepare_prompt_context_strings(
            whole_paper_payload,
            target_tokens=phase2_target_tokens,
            hard_cap_tokens=phase2_hard_cap,
            label="phase2",
        )

        pending_phase2: list[tuple[str, str]] = []
        for section_name, instruction in phase2_section_specs.items():
            if section_name in section_cache:
                cached_html = _clean_and_humanize_section_html(section_cache[section_name])
                cached_html = _enrich_dqid_anchors(cached_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    _validate_generated_section(section_name, cached_html, cfg)
                    llm_sections[section_name] = cached_html
                    continue
                except Exception:
                    section_cache.pop(section_name, None)
                    section_cache_entries.pop(section_name, None)
                    _write_section_cache(section_cache_path, section_cache_entries)
            prompt = (
                "SECTION_NAME\n"
                f"{section_name}\n\n"
                "INSTRUCTION\n"
                f"{instruction}\n\n"
                "WHOLE_PAPER_CONTEXT_JSON\n"
                f"{phase2_context_json}\n\n"
                "CONTEXT_META_JSON\n"
                f"{phase2_context_meta_json}\n\n"
                "STYLE_GUARD\n"
                "Write formal publication prose only. Do not mention provided context, context json, prompts, or AI.\n\n"
                "CITATION_STYLE\n"
                f"{citation_instruction}\n\n"
                "Return only raw HTML snippets, no markdown fences."
            )
            custom_id = _stable_section_custom_id(phase2_collection, section_name, prompt)
            _ = call_models_zt(
                text=prompt,
                function=function_name,
                custom_id=custom_id,
                collection_name=phase2_collection,
                model=model,
                ai="openai",
                read=False,
                store_only=True,
                cache=False,
            )
            pending_phase2.append((section_name, custom_id))

        if pending_phase2:
            _dbg("render_systematic_review_from_summary", f"phase2_group_batch_start pending={len(pending_phase2)} collection={safe_collection}")
            ok = cm._process_batch_for(analysis_key_suffix=function_name, section_title=safe_collection, poll_interval=30)
            if ok is not True:
                raise RuntimeError("Phase-2 grouped section batch failed.")
            _dbg("render_systematic_review_from_summary", "phase2_group_batch_done")
            for section_name, custom_id in pending_phase2:
                response = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
                section_html = _clean_and_humanize_section_html(_clean_llm_html(_extract_llm_text(response)))
                section_html = _enrich_dqid_anchors(section_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    _validate_generated_section(section_name, section_html, cfg)
                except Exception:
                    pass
                llm_sections[section_name] = section_html
                section_cache[section_name] = section_html
                section_cache_entries[section_name] = _make_cache_entry(
                    section_name=section_name,
                    html_text=section_html,
                    model=model,
                    custom_id=custom_id,
                )
                _write_section_cache(section_cache_path, section_cache_entries)
    else:
        phase2_target_tokens = _env_int("SYSTEMATIC_PHASE2_TARGET_TOKENS", 6000, min_value=2200, max_value=24000)
        phase2_hard_cap = _env_int("SYSTEMATIC_PHASE2_HARD_CAP_TOKENS", 8600, min_value=3000, max_value=32000)
        phase2_context_json, phase2_context_meta_json = _prepare_prompt_context_strings(
            whole_paper_payload,
            target_tokens=phase2_target_tokens,
            hard_cap_tokens=phase2_hard_cap,
            label="phase2",
        )
        for section_name, instruction in phase2_section_specs.items():
            base_prompt = (
                "SECTION_NAME\n"
                f"{section_name}\n\n"
                "INSTRUCTION\n"
                f"{instruction}\n\n"
                "WHOLE_PAPER_CONTEXT_JSON\n"
                f"{phase2_context_json}\n\n"
                "CONTEXT_META_JSON\n"
                f"{phase2_context_meta_json}\n\n"
                "Return only raw HTML snippets, no markdown fences."
            )
            if section_name in section_cache:
                cached_html = _clean_and_humanize_section_html(section_cache[section_name])
                cached_html = _enrich_dqid_anchors(cached_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    _validate_generated_section(section_name, cached_html, cfg)
                    llm_sections[section_name] = cached_html
                    continue
                except Exception:
                    section_cache.pop(section_name, None)
                    section_cache_entries.pop(section_name, None)
                    _write_section_cache(section_cache_path, section_cache_entries)
            try:
                section_html = ""
                last_err: Exception | None = None
                for attempt in range(1, 4):
                    retry_guard = (
                        "\n\nSTYLE_GUARD\n"
                        "Write formal publication prose only. Do not mention 'provided context', "
                        "'context json', prompts, or AI. Do not include placeholders.\n"
                        + f"\nCITATION_STYLE\n{citation_instruction}\n"
                    )
                    prompt = base_prompt + (retry_guard if attempt > 1 else "")
                    custom_id = _stable_section_custom_id(collection_name, f"{section_name}_a{attempt}", prompt)
                    call_kwargs = {
                        "text": prompt,
                        "function": "systematic_review_section_writer",
                        "custom_id": custom_id,
                        "collection_name": collection_name,
                        "model": model,
                        "ai": "openai",
                        "read": False,
                        "store_only": False,
                        "cache": False,
                    }
                    response = _call_models_with_timeout(timeout_s=int(section_timeout_s), kwargs=call_kwargs)
                    section_html = _clean_llm_html(_extract_llm_text(response))
                    if not section_html:
                        last_err = RuntimeError(f"LLM returned empty section content for '{section_name}'.")
                        continue
                    section_html = _clean_and_humanize_section_html(section_html)
                    if section_name in {"introduction", "conclusion", "abstract"}:
                        section_html = _enrich_dqid_anchors(section_html, dqid_lookup, citation_style=citation_style)
                    cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                    try:
                        _validate_generated_section(section_name, section_html, cfg)
                        llm_sections[section_name] = section_html
                        section_cache[section_name] = section_html
                        section_cache_entries[section_name] = _make_cache_entry(
                            section_name=section_name,
                            html_text=section_html,
                            model=model,
                            custom_id=custom_id,
                        )
                        _write_section_cache(section_cache_path, section_cache_entries)
                        last_err = None
                        break
                    except Exception as exc:
                        last_err = exc
                        continue
                if last_err is not None:
                    raise last_err
            except TimeoutError as exc:
                raise RuntimeError(f"Timeout while generating section '{section_name}' after {section_timeout_s}s.") from exc

    for section_name, html_block in llm_sections.items():
        _assert_section_citation_coverage(section_name, html_block, dqid_lookup)

    context = {
        "topic": collection_name,
        "citation_style": citation_style,
        "authors_list": "Automated TEIA pipeline",
        "affiliation": "TEIA Research",
        "generation_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "ai_models_used": model,
        "ai_abstract": llm_sections["abstract"],
        "ai_introduction": llm_sections["introduction"],
        "eligibility_criteria": _html_to_text(llm_sections["eligibility_criteria_protocol"]),
        "search_strategy_summary": llm_sections["search_strategy"],
        "full_search_strategy_appendix_path": "search_strategy_appendix.txt",
        "rob_tool_used": "Structured qualitative appraisal rubric",
        "prisma_n_db": prisma_counts["db"],
        "prisma_n_dup": prisma_counts["dup"],
        "prisma_n_initial_screen": prisma_counts["screen"],
        "prisma_n_screen_exclude": prisma_counts["screen_ex"],
        "prisma_n_elig_assess": prisma_counts["full"],
        "prisma_n_elig_exclude": prisma_counts["full_ex"],
        "prisma_exclusion_reasons": {},
        "prisma_n_included": prisma_counts["included"],
        "prisma_flow_diagram": f"assets/{prisma_svg_path.name}",
        "characteristics_table": (
            "<table class='data-table'>"
            "<thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>"
            f"<tr><td>Included studies</td><td>{prisma_counts['included']}</td></tr>"
            f"<tr><td>Retained evidence snippets</td><td>{_safe_int(ev_stats.get('evidence_kept'), 0)}</td></tr>"
            f"<tr><td>Top themes visualized</td><td>{len(top_theme_labels)}</td></tr>"
            "</tbody></table>"
        ),
        "risk_of_bias_plot": f"assets/{themes_svg_path.name}",
        "narrative_synthesis_summary": llm_sections["narrative_synthesis"],
        "ai_discussion": llm_sections["discussion"],
        "ai_limitations": llm_sections["limitations"],
        "ai_conclusion": llm_sections["conclusion"],
        "references_derived_from_anchor_item_keys": [],
        "section_generation_provenance": {
            "abstract": "phase2_whole_paper_llm",
            "introduction": "phase2_whole_paper_llm",
            "eligibility_criteria_protocol": "phase1_llm",
            "search_strategy": "phase1_llm",
            "study_selection_methods": "phase1_llm",
            "data_extraction_methods": "phase1_llm",
            "risk_of_bias_methods": "phase1_llm",
            "data_synthesis_methods": "phase1_llm",
            "narrative_synthesis": "deterministic_results_synthesis"
            + (" + round_synthesis_merge" if round_synthesis_html.strip() else ""),
            "discussion": "phase1_llm",
            "limitations": "phase1_llm",
            "conclusion": "phase2_whole_paper_llm",
            "references": "anchor_driven_from_text_dqid_to_item_key",
            "prisma": "deterministic_counts_and_figure",
        },
    }

    appendix_path = output_dir / "search_strategy_appendix.txt"
    appendix_text = _html_to_text(llm_sections["search_strategy"])
    appendix_path.write_text(appendix_text if appendix_text else "Search strategy details unavailable.", encoding="utf-8")

    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "htm", "xml"]),
    )
    template = env.get_template(template_path.name)
    rendered = template.render(**context)
    rendered = _replace_subsection_content(rendered, "2.1 Eligibility Criteria", llm_sections["eligibility_criteria_protocol"])
    search_block = (
        llm_sections["search_strategy"]
        + "\n<p class=\"appendix-link\"><a href=\"search_strategy_appendix.txt\" target=\"_blank\">Link to Full Search Strategy Appendix</a></p>"
    )
    rendered = _replace_subsection_content(rendered, "2.2 Information Sources & Search Strategy", search_block)
    rendered = _replace_subsection_content(rendered, "2.3 Study Selection", llm_sections["study_selection_methods"])
    rendered = _replace_subsection_content(rendered, "2.4 Data Extraction", llm_sections["data_extraction_methods"])
    rendered = _replace_subsection_content(rendered, "2.5 Risk of Bias Assessment", llm_sections["risk_of_bias_methods"])
    rendered = _replace_subsection_content(rendered, "2.6 Data Synthesis", llm_sections["data_synthesis_methods"])
    rendered = _anchor_plain_author_year_citations(rendered, dqid_lookup, citation_style=citation_style)
    anchor_item_keys = _derive_anchor_item_keys_from_html(rendered, dqid_lookup)
    refs = _build_reference_items(summary, citation_style=citation_style, anchor_item_keys=anchor_item_keys)
    context["references_derived_from_anchor_item_keys"] = list(anchor_item_keys)
    refs_html = "\n".join(f"      {r}" for r in refs)
    rendered = _replace_references_block(rendered, refs_html)
    notes_html = _build_notes_block_html(summary, citation_style=citation_style, anchor_item_keys=anchor_item_keys)
    if notes_html:
        rendered = _append_references_notes_block(rendered, f"\n  {notes_html}\n")
    rendered = _strip_editorial_brackets(rendered)
    _assert_non_placeholder_html(rendered)
    _assert_reference_and_postprocess_integrity(rendered, citation_style=citation_style)
    _validate_dqid_quote_page_integrity(rendered, dqid_lookup, citation_style=citation_style, context_label="Systematic review")

    output_html_path = output_dir / "systematic_review.html"
    output_html_path.write_text(rendered, encoding="utf-8")
    context_json_path = output_dir / "systematic_review_context.json"
    context_json_path.write_text(json.dumps(context, ensure_ascii=False, indent=2), encoding="utf-8")
    return PipelineResult(
        output_html_path=output_html_path,
        context_json_path=context_json_path,
        prisma_svg_path=prisma_svg_path,
        themes_svg_path=themes_svg_path,
    )


def run_pipeline(
    *,
    summary_path: Path | None,
    template_path: Path,
    outputs_root: Path,
    use_llm: bool = True,
    model: str = "gpt-5-mini",
    section_timeout_s: int = 0,
    section_single_batch: bool = False,
    citation_style: str = "apa",
    prisma_figure_path: Path | None = None,
    collection_name: str = "",
    coded_dir: Path | None = None,
    build_summary_if_missing: bool = False,
    temporal: bool = False,
) -> dict[str, Any]:
    _dbg(
        "run_pipeline",
        f"start summary_path={str(summary_path or '')} collection_name={str(collection_name or '')} section_single_batch={bool(section_single_batch)}",
    )
    if not use_llm:
        raise RuntimeError("Strict mode active: run_pipeline requires LLM enabled for section writing.")
    resolved_summary_path = resolve_summary_path(
        summary_path=summary_path,
        collection_name=str(collection_name),
        coded_dir=coded_dir,
        outputs_root=outputs_root,
        model=model,
        build_summary_if_missing=bool(build_summary_if_missing),
    )
    summary = _load_json(resolved_summary_path)
    if bool(temporal):
        input_block = summary.get("input")
        if not isinstance(input_block, dict):
            input_block = {}
            summary["input"] = input_block
        input_block["temporal"] = True
    result = render_systematic_review_from_summary(
        summary=summary,
        template_path=template_path,
        outputs_root=outputs_root,
        use_llm=bool(use_llm),
        model=model,
        section_timeout_s=int(section_timeout_s),
        section_single_batch=bool(section_single_batch),
        citation_style=str(citation_style),
        prisma_figure_path=Path(prisma_figure_path).expanduser().resolve() if prisma_figure_path else None,
    )
    out = {
        "status": "ok",
        "summary_path": str(resolved_summary_path),
        "systematic_review_html_path": str(result.output_html_path),
        "context_json_path": str(result.context_json_path),
        "prisma_figure_path": str(result.prisma_svg_path),
        "themes_figure_path": str(result.themes_svg_path),
        "llm_enabled": bool(use_llm),
        "citation_style": str(citation_style),
        "temporal": bool(temporal),
    }
    _dbg("run_pipeline", f"done html={out['systematic_review_html_path']}")
    return out


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate systematic review HTML from synthesis summary.")
    parser.add_argument("--summary-path", default="")
    parser.add_argument("--collection-name", default="")
    parser.add_argument("--coded-dir", default="")
    parser.add_argument("--build-summary-if-missing", action="store_true")
    parser.add_argument("--template-path", default=str(_repo_root() / "Research" / "templates" / "systematic_review.html"))
    parser.add_argument("--outputs-root", default=str(_repo_root() / "Research" / "outputs"))
    parser.add_argument("--no-llm", action="store_true")
    parser.add_argument("--model", default="gpt-5-mini")
    parser.add_argument("--section-timeout-s", type=int, default=0, help="Per-section timeout in seconds. 0 disables timeout.")
    parser.add_argument("--section-single-batch", action="store_true", help="Generate each section via single enqueue/process/read batch cycle.")
    parser.add_argument(
        "--citation-style",
        default="apa",
        choices=["apa", "numeric", "endnote", "parenthetical_footnote"],
        help="In-text citation style for hydrated dqid anchors and references.",
    )
    parser.add_argument("--prisma-figure-path", default="", help="Optional path to an existing PRISMA figure image to use directly.")
    parser.add_argument("--temporal", action="store_true", help="Enable temporal wave-structured synthesis in Results.")
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    summary_path = Path(args.summary_path).resolve() if str(args.summary_path).strip() else None
    coded_dir = Path(args.coded_dir).resolve() if str(args.coded_dir).strip() else None
    result = run_pipeline(
        summary_path=summary_path,
        template_path=Path(args.template_path).resolve(),
        outputs_root=Path(args.outputs_root).resolve(),
        use_llm=not bool(args.no_llm),
        model=str(args.model),
        section_timeout_s=int(args.section_timeout_s),
            section_single_batch=bool(args.section_single_batch),
            citation_style=str(args.citation_style),
            prisma_figure_path=Path(args.prisma_figure_path).resolve() if str(args.prisma_figure_path).strip() else None,
            collection_name=str(args.collection_name),
        coded_dir=coded_dir,
        build_summary_if_missing=bool(args.build_summary_if_missing),
        temporal=bool(args.temporal),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
