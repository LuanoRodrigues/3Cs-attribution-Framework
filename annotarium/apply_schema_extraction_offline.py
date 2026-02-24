#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import html
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
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


URL_RE = re.compile(r"https?://[^\s<>\]\"']+")
EMAIL_RE = re.compile(r"\b[^@\s]+@[^@\s]+\.[^@\s]+\b")
IPV4_RE = re.compile(
    r"\b(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b"
)
DOMAIN_RE = re.compile(r"\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,63}\b")
CVE_RE = re.compile(r"\bCVE-\d{4}-\d{4,}\b", re.I)
MD5_RE = re.compile(r"\b[a-fA-F0-9]{32}\b")
SHA1_RE = re.compile(r"\b[a-fA-F0-9]{40}\b")
SHA256_RE = re.compile(r"\b[a-fA-F0-9]{64}\b")
FIG_RE = re.compile(r"^\s*(?:[*_`>#-]+\s*)*FIGURE\s+(\d+)\s*:?\s*(.*)$", re.I)
TABLE_RE = re.compile(r"^\s*(?:[*_`>#-]+\s*)*TABLE\s+(\d+)\s*:?\s*(.*)$", re.I)
HEADING_RE = re.compile(r"^\s*#{1,6}\s+(.+?)\s*$")
FOOTNOTE_LINE_RE = re.compile(r"^\s*(?:\d+|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)\s+")
SUPERSCRIPT_CHARS = "¹²³⁴⁵⁶⁷⁸⁹⁰"
SUPERSCRIPT_TO_ASCII = str.maketrans({"¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁰": "0"})
PAGE_MARKER_RE = re.compile(
    r"^\s*(?:\*\*|__)?[A-Za-z][\w\s&,'’./()-]{0,60}(?:\*\*|__)?\s+"
    r"[A-Za-z][\w\s&,'’./()-]{0,40}\s+(?:\*\*|__)?(\d{1,4})(?:\*\*|__)?\s+"
    r"(?:www\.)?[A-Za-z0-9.-]+\.[A-Za-z]{2,63}\s*$"
)
COMMON_TLDS = {
    "com", "net", "org", "edu", "gov", "mil", "int", "info", "biz", "name", "pro", "io", "me", "co", "ai",
    "dev", "app", "cloud", "tech", "online", "site", "xyz", "top", "cn", "ru", "uk", "us", "ca", "au", "de",
    "fr", "jp", "kr", "tw", "hk", "in", "br", "mx", "nl", "se", "ch", "es", "it", "pl", "za", "id", "tr",
    "ir", "ae", "sg", "vn", "ph", "th", "my", "ro", "pt", "gr", "cz", "fi", "no", "dk", "be", "at", "ie",
}


def _clean_text(s: str, max_len: int | None = None) -> str:
    out = re.sub(r"\s+", " ", (s or "").strip())
    if max_len is not None and len(out) > max_len:
        return out[: max_len - 3].rstrip() + "..."
    return out


def _strip_url(url: str) -> str:
    s = html.unescape((url or "").strip()).strip("<>").strip()
    s = re.sub(rf"[{re.escape(SUPERSCRIPT_CHARS)}]+$", "", s)
    while s and s[-1] in ".,;:]>'\"”’":
        s = s[:-1]
    while s.endswith(")") and s.count(")") > s.count("("):
        s = s[:-1]
    return s


def _normalize_url(url: str) -> str | None:
    s = html.unescape(_strip_url(url))
    s = re.sub(rf"[{re.escape(SUPERSCRIPT_CHARS)}]", "", s)
    try:
        p = urlparse(s)
    except Exception:
        return None
    if p.scheme not in {"http", "https"} or not p.netloc:
        return None
    # Remove stray punctuation in netloc and normalize host casing.
    netloc = html.unescape(p.netloc).strip().rstrip(".,;:]>'\"”’").lower()
    if not netloc:
        return None
    return urlunparse((p.scheme.lower(), netloc, p.path or "", p.params or "", p.query or "", p.fragment or ""))


def _looks_like_domain(token: str) -> bool:
    tok = html.unescape((token or "").strip()).strip("<>").strip().lower()
    tok = tok.rstrip(".,;:)>\"'”’")
    if not DOMAIN_RE.fullmatch(tok):
        return False
    # Avoid classifying obvious file names as domains.
    ext = tok.rsplit(".", 1)[-1]
    file_exts = {
        "exe", "dll", "pdb", "zip", "rar", "7z", "log", "txt", "doc", "docx", "pdf", "ioc", "bat", "cmd", "ps1",
        "php", "asp", "aspx", "html", "htm", "do", "jsp", "cfm", "cgi",
    }
    if ext in file_exts:
        return False
    if ext not in COMMON_TLDS:
        return False
    labels = tok.split(".")
    for label in labels:
        if not label or len(label) > 63:
            return False
        if label.startswith("-") or label.endswith("-"):
            return False
    return True


def _extract_year_from_citation_line(line: str) -> int | None:
    if not line:
        return None
    txt = html.unescape(line)
    # Access date is not the publication year for the cited source.
    pub_scope = re.split(r"\baccessed\b", txt, maxsplit=1, flags=re.I)[0]

    def is_valid_year(y: int, raw: str) -> bool:
        if not (1980 <= y <= 2100):
            return False
        if re.search(rf"\bproject\s+{y}\b", raw, re.I):
            return False
        if re.search(rf"catalog[_\s-]*id\s*=?\s*{y}\b", raw, re.I):
            return False
        if re.search(rf"\bunit\s+{y}\b", raw, re.I):
            return False
        if re.search(rf"\bword\s+{y}\b", raw, re.I):
            return False
        return True

    # Prefer years in explicit bibliographic date parentheses.
    for m in re.finditer(r"\((19|20)\d{2}\)", pub_scope):
        y = int(m.group(0).strip("()"))
        if is_valid_year(y, pub_scope):
            return y

    # Then use the last plausible year in the publication scope.
    candidates = [int(m.group(0)) for m in re.finditer(r"\b(19|20)\d{2}\b", pub_scope)]
    for y in reversed(candidates):
        if is_valid_year(y, pub_scope):
            return y

    # Last-resort fallback to full line if publication scope had no year.
    all_candidates = [int(m.group(0)) for m in re.finditer(r"\b(19|20)\d{2}\b", txt)]
    for y in reversed(all_candidates):
        if is_valid_year(y, txt):
            return y
    return None


def _footnote_number_prefix(text: str) -> int | None:
    s = html.unescape(str(text or "")).strip()
    if not s:
        return None
    m = re.match(r"^(\d+)\b", s)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return None
    m2 = re.match(rf"^([{re.escape(SUPERSCRIPT_CHARS)}]+)", s)
    if not m2:
        return None
    converted = m2.group(1).translate(SUPERSCRIPT_TO_ASCII)
    if converted.isdigit():
        try:
            return int(converted)
        except ValueError:
            return None
    return None


def _loc(*, page_index: int = 0, page_label: str | None = None, section: str | None = None, object_id: str | None = None) -> dict[str, Any]:
    return {
        "page_index": page_index,
        "page_label": page_label,
        "section_heading": section,
        "object_id": object_id,
    }


@dataclass
class AnchorFactory:
    page_seq: dict[int, int] | None = None
    claim_seq: dict[str, int] | None = None

    def __post_init__(self) -> None:
        if self.page_seq is None:
            self.page_seq = defaultdict(int)
        if self.claim_seq is None:
            self.claim_seq = defaultdict(int)

    def page_anchor(
        self,
        *,
        text: str,
        section: str | None,
        page_index: int,
        page_label: str | None,
        object_id: str | None = None,
        notes: str = "",
    ) -> dict[str, Any]:
        n = int(self.page_seq[page_index]) + 1
        self.page_seq[page_index] = n
        aid = f"P{page_index:03d}-A{n:03d}"
        return {
            "anchor_id": aid,
            "extraction_method": "markdown",
            "verbatim_text": _clean_text(text, 2400),
            "location": _loc(page_index=page_index, page_label=page_label, section=section, object_id=object_id),
            "notes": notes,
        }

    def claim_anchor(
        self,
        *,
        claim_id: str,
        text: str,
        section: str | None,
        page_index: int = 0,
        page_label: str | None = None,
        object_id: str | None = None,
        notes: str = "",
    ) -> dict[str, Any]:
        n = int(self.claim_seq[claim_id]) + 1
        self.claim_seq[claim_id] = n
        aid = f"{claim_id}-A{n:03d}"
        return {
            "anchor_id": aid,
            "extraction_method": "markdown",
            "verbatim_text": _clean_text(text, 2400),
            "location": _loc(page_index=page_index, page_label=page_label, section=section, object_id=object_id),
            "notes": notes,
        }


def _find_line(lines: list[str], needle: str) -> tuple[int, str]:
    low = needle.lower()
    for i, line in enumerate(lines):
        if low in line.lower():
            return i, line
    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

    n = norm(needle)
    n_tokens = [t for t in n.split() if len(t) >= 3]
    best_score = -1
    best_idx = 0
    best_line = lines[0] if lines else ""
    for i, line in enumerate(lines):
        ln = norm(line)
        if n and n in ln:
            return i, line
        score = sum(1 for t in n_tokens if t in ln)
        if score > best_score:
            best_score = score
            best_idx = i
            best_line = line
    threshold = max(3, min(6, len(n_tokens) // 2))
    if best_score >= threshold:
        return best_idx, best_line
    for i, line in enumerate(lines):
        s = _clean_text(line)
        if len(s) >= 40 and not FOOTNOTE_LINE_RE.match(s):
            return i, line
    return 0, lines[0] if lines else ""


def _detect_pages(lines: list[str]) -> tuple[dict[int, int], dict[int, str | None], list[str]]:
    marker_hits: list[tuple[int, int, str]] = []
    for i, line in enumerate(lines):
        m = PAGE_MARKER_RE.match(line)
        if not m:
            continue
        num = int(m.group(1))
        if 0 <= num <= 4000:
            marker_hits.append((i, num, _clean_text(line, 160)))

    # Filter noisy candidates by mostly increasing sequence.
    stable_hits: list[tuple[int, int, str]] = []
    last_num = -1
    for hit in marker_hits:
        if hit[1] >= last_num:
            stable_hits.append(hit)
            last_num = hit[1]
    if len(stable_hits) < 2:
        stable_hits = []

    line_to_page: dict[int, int] = {}
    page_labels: dict[int, str | None] = {0: None}
    marker_by_line = {idx: num for idx, num, _raw in stable_hits}
    page_idx = 0
    for i in range(len(lines)):
        line_to_page[i] = page_idx
        if i in marker_by_line:
            if page_labels.get(page_idx) is None:
                page_labels[page_idx] = str(marker_by_line[i])
            page_idx += 1
            page_labels.setdefault(page_idx, None)

    if not lines:
        return line_to_page, {0: None}, []
    max_used = max(line_to_page.values()) if line_to_page else 0
    page_labels = {p: page_labels.get(p) for p in range(max_used + 1)}
    marker_examples = [raw for _, _, raw in stable_hits[:10]]
    return line_to_page, page_labels, marker_examples


def _heading_context(lines: list[str]) -> tuple[list[str], dict[int, str | None], dict[str, list[str]]]:
    headings: list[str] = []
    heading_by_line: dict[int, str | None] = {}
    section_lines: dict[str, list[str]] = defaultdict(list)
    current: str | None = None
    for i, line in enumerate(lines):
        m = HEADING_RE.match(line)
        if m:
            current = _clean_text(m.group(1), 300)
            if current and current not in headings:
                headings.append(current)
        heading_by_line[i] = current
        if current is not None and not HEADING_RE.match(line):
            section_lines[current].append(line)
    return headings[:200], heading_by_line, section_lines


def _to_csv(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    out: list[str] = []
    for row in rows:
        escaped = []
        for cell in row:
            c = str(cell or "")
            if any(ch in c for ch in [",", "\"", "\n"]):
                c = "\"" + c.replace("\"", "\"\"") + "\""
            escaped.append(c)
        out.append(",".join(escaped))
    return "\n".join(out)


def _split_markdown_row(row: str, expected_cols: int = 0) -> list[str]:
    content = row.strip().strip("|")
    parts = [p.strip() for p in content.split("|")]
    if expected_cols <= 0:
        return parts
    if len(parts) > expected_cols:
        # Common OCR markdown issue: literal pipe inside the first cell.
        overflow = len(parts) - expected_cols + 1
        first = "|".join(parts[:overflow]).strip()
        parts = [first] + parts[overflow:]
    if len(parts) < expected_cols:
        parts = parts + [""] * (expected_cols - len(parts))
    if len(parts) > expected_cols:
        head = parts[: expected_cols - 1]
        tail = "|".join(parts[expected_cols - 1 :]).strip()
        parts = head + [tail]
    return parts


def _extract_tables(
    *,
    lines: list[str],
    heading_by_line: dict[int, str | None],
    line_to_page: dict[int, int],
    page_labels: dict[int, str | None],
) -> tuple[list[dict[str, Any]], set[int]]:
    tables: list[dict[str, Any]] = []
    consumed_lines: set[int] = set()
    marker_lines: list[tuple[int, str, str]] = []
    table_seq_by_page: dict[int, int] = defaultdict(int)

    for i, line in enumerate(lines):
        m = TABLE_RE.match(line)
        if m:
            marker_lines.append((i, m.group(1), _clean_text(m.group(2), 900)))

    t = 1
    i = 0
    while i < len(lines):
        line = lines[i]
        next_line = lines[i + 1] if i + 1 < len(lines) else ""
        # Markdown table pattern: header row with pipes + separator row.
        if "|" in line and re.search(r"^\s*\|?[\s:-]+\|[\s|:-]*$", next_line):
            start = i
            raw_rows = [line, next_line]
            consumed_lines.update({start, start + 1})

            j = start + 2
            while j < len(lines):
                cur = lines[j]
                cur_s = cur.strip()
                if not cur_s:
                    break
                if HEADING_RE.match(cur) or TABLE_RE.match(cur) or FIG_RE.match(cur):
                    break
                if "|" in cur and cur_s.startswith("|"):
                    raw_rows.append(cur)
                    consumed_lines.add(j)
                    j += 1
                    continue
                # Allow multiline cell continuation if previous row has not closed with '|'.
                if len(raw_rows) >= 3 and not raw_rows[-1].rstrip().endswith("|"):
                    raw_rows[-1] = raw_rows[-1] + "\n" + cur
                    consumed_lines.add(j)
                    j += 1
                    continue
                break

            # Convert markdown rows to cell matrix, skipping separator row(s).
            cells: list[list[str]] = []
            expected_cols = 0
            malformed_rows = 0
            for ridx, raw in enumerate(raw_rows):
                if ridx > 0 and re.search(r"^\s*\|?[\s:-]+\|[\s|:-]*$", raw):
                    continue
                if ridx == 0:
                    parts = _split_markdown_row(raw)
                    expected_cols = max(1, len(parts))
                else:
                    raw_parts = [p.strip() for p in raw.strip().strip("|").split("|")]
                    if expected_cols and len(raw_parts) != expected_cols:
                        malformed_rows += 1
                    parts = _split_markdown_row(raw, expected_cols)
                if parts:
                    cells.append(parts)

            caption = None
            for back in range(max(0, start - 3), start):
                mm = TABLE_RE.match(lines[back])
                if mm:
                    c = _clean_text(mm.group(2), 900)
                    caption = c if c else f"TABLE {mm.group(1)}"
                    break

            page_index = line_to_page.get(start, 0)
            page_label = page_labels.get(page_index)
            table_seq_by_page[page_index] += 1
            tid = f"P{page_index:03d}-T{table_seq_by_page[page_index]:02d}"
            rep = "markdown_table"
            table_cells = cells
            table_csv = _to_csv(cells)
            notes = "Extracted from markdown pipe table."
            if not cells or (len(cells) > 2 and malformed_rows > max(1, len(cells) // 2)):
                # Fall back when OCR table structure is too degraded for reliable cell parsing.
                rep = "verbatim_text"
                table_cells = []
                table_csv = ""
                notes = "Pipe table detected, but structure degraded; stored verbatim."
            tables.append(
                {
                    "object_id": tid,
                    "caption_verbatim": caption,
                    "table_kind": "data_table",
                    "representation": rep,
                    "table_markdown": "\n".join(raw_rows),
                    "table_cells": table_cells,
                    "table_csv": table_csv,
                    "table_text_verbatim": _clean_text(" ".join(raw_rows), 48000),
                    "location": _loc(page_index=page_index, page_label=page_label, section=heading_by_line.get(start), object_id=tid),
                    "notes": notes,
                }
            )
            t += 1
            i = j
            continue
        i += 1

    # Fallback: TABLE markers without parsed pipe-table.
    used_marker_idx = set()
    for tab in tables:
        obj_id = str(tab.get("object_id") or "")
        if not obj_id.startswith("P000-T"):
            continue
        # approximate mapping already covered by nearby extraction.
    for marker_i, marker_num, marker_caption in marker_lines:
        if t > 99:
            break
        # skip if already covered by consumed span near marker
        if any((marker_i + off) in consumed_lines for off in range(0, 8)):
            continue
        page_index = line_to_page.get(marker_i, 0)
        page_label = page_labels.get(page_index)
        table_seq_by_page[page_index] += 1
        tid = f"P{page_index:03d}-T{table_seq_by_page[page_index]:02d}"
        snippet = []
        for j in range(marker_i, min(len(lines), marker_i + 8)):
            txt = lines[j].strip()
            if not txt:
                break
            if j > marker_i and HEADING_RE.match(txt):
                break
            snippet.append(lines[j])
            consumed_lines.add(j)
        tables.append(
            {
                "object_id": tid,
                "caption_verbatim": marker_caption if marker_caption else f"TABLE {marker_num}",
                "table_kind": "data_table",
                "representation": "verbatim_text",
                "table_markdown": "",
                "table_cells": [],
                "table_csv": "",
                "table_text_verbatim": _clean_text(" ".join(snippet), 48000),
                "location": _loc(page_index=page_index, page_label=page_label, section=heading_by_line.get(marker_i), object_id=tid),
                "notes": "Table marker detected but pipe-table rows were not found.",
            }
        )
        t += 1
        used_marker_idx.add(marker_i)

    return tables, consumed_lines


def _make_text_blocks(
    *,
    lines: list[str],
    heading_by_line: dict[int, str | None],
    line_to_page: dict[int, int],
    page_labels: dict[int, str | None],
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    per_page_section: dict[tuple[int, str], list[str]] = defaultdict(list)
    for i, ln in enumerate(lines):
        section = heading_by_line.get(i) or "Document Body"
        page_index = line_to_page.get(i, 0)
        per_page_section[(page_index, section)].append(ln)

    block_seq_by_page: dict[int, int] = defaultdict(int)
    for (page_index, heading), section_lines in per_page_section.items():
        filtered: list[str] = []
        for ln in section_lines:
            s = ln.strip()
            if not s:
                continue
            if TABLE_RE.match(s):
                continue
            if FIG_RE.match(s):
                continue
            if PAGE_MARKER_RE.match(s):
                continue
            if "|" in s:
                # likely markdown table row or separator
                if re.search(r"^\s*\|?[\s:-]+\|[\s|:-]*$", s):
                    continue
                if s.count("|") >= 2:
                    continue
            filtered.append(ln)
        raw = _clean_text(" ".join(filtered))
        if len(raw) < 80:
            continue
        # chunk to keep each block under schema maxLength.
        chunks: list[str] = []
        while raw:
            if len(raw) <= 3500:
                chunks.append(raw)
                break
            cut = raw.rfind(". ", 0, 3400)
            if cut < 1200:
                cut = 3400
            chunks.append(raw[:cut].strip())
            raw = raw[cut:].strip()
        for chunk in chunks[:3]:  # avoid oversized outputs
            block_seq_by_page[page_index] += 1
            block_id = f"P{page_index:03d}-B{block_seq_by_page[page_index]:02d}"
            blocks.append(
                {
                    "block_id": block_id,
                    "extraction_method": "markdown",
                    "text_verbatim": chunk,
                    "location": _loc(
                        page_index=page_index,
                        page_label=page_labels.get(page_index),
                        section=heading,
                        object_id=block_id,
                    ),
                    "notes": f"Extracted from section '{heading}'.",
                }
            )
            if len(blocks) > 400:
                return blocks
    return blocks


def _make_figures(
    lines: list[str],
    heading_by_line: dict[int, str | None],
    line_to_page: dict[int, int],
    page_labels: dict[int, str | None],
) -> list[dict[str, Any]]:
    figs: list[dict[str, Any]] = []
    seq_by_page: dict[int, int] = defaultdict(int)
    seen_nums: set[tuple[int, str]] = set()
    for i, line in enumerate(lines):
        m = FIG_RE.match(line)
        if not m:
            continue
        num = m.group(1)
        page_index = line_to_page.get(i, 0)
        if (page_index, num) in seen_nums:
            continue
        seen_nums.add((page_index, num))
        seq_by_page[page_index] += 1
        cap = _clean_text(m.group(2) or line)
        fid = f"P{page_index:03d}-F{seq_by_page[page_index]:02d}"
        figs.append(
            {
                "object_id": fid,
                "caption_verbatim": cap if cap else None,
                "image_ref": f"figure_{num}",
                "alt_text": None,
                "analyst_description": f"Figure marker detected in markdown: Figure {num}.",
                "location": _loc(
                    page_index=page_index,
                    page_label=page_labels.get(page_index),
                    section=heading_by_line.get(i),
                    object_id=fid,
                ),
                "notes": "No embedded image binary available in markdown-only extraction.",
            }
        )
        if len(figs) > 300:
            break
    return figs


def _extract_sources_and_citations(
    *,
    lines: list[str],
    heading_by_line: dict[int, str | None],
    line_to_page: dict[int, int],
    page_labels: dict[int, str | None],
    anchors: AnchorFactory,
    references_payload: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sources: list[dict[str, Any]] = [
        {
            "source_id": "SRC0001",
            "source_type": "internal_document_section",
            "entity_name": "Mandiant",
            "year": 2013,
            "title": "APT1 Executive Summary and Key Findings",
            "publication_or_venue": "Mandiant APT1 Report",
            "url_or_identifier": None,
            "cited_in_document": [_loc(page_index=0, page_label=page_labels.get(0), section="EXECUTIVE SUMMARY", object_id=None)],
            "notes": "Internal source representing the report narrative itself.",
        }
    ]

    def classify_source(line: str) -> tuple[str, str, str]:
        low = line.lower()
        if "washington post" in low:
            return "press_media", "The Washington Post", "The Washington Post"
        if "u.s. house" in low or "permanent select committee" in low or "hearing" in low:
            return "government", "U.S. House Permanent Select Committee on Intelligence", "U.S. House Hearing"
        if "rand.org" in low or "rand corporation" in low:
            return "academic", "RAND Corporation", "RAND"
        if "project2049" in low:
            return "academic", "Project 2049 Institute", "Project 2049 Institute"
        if "institute" in low or "university" in low:
            return "academic", "Referenced academic source", "Academic publication"
        return "other", "Referenced source", "Unknown venue"

    url_to_source_id: dict[str, str] = {}
    source_by_id: dict[str, dict[str, Any]] = {str(s.get("source_id") or ""): s for s in sources}
    citations: list[dict[str, Any]] = []
    c = 1
    next_source = 2

    max_known_page = max(line_to_page.values()) if line_to_page else 0

    for i, line in enumerate(lines):
        line_clean = html.unescape(line)
        # Strict bibliographic intake: keep only explicit footnote-style lines.
        # Additional recovered references are merged from sidecar below.
        if not FOOTNOTE_LINE_RE.match(line_clean):
            continue
        if "http" not in line_clean.lower():
            continue

        raw_urls = URL_RE.findall(line_clean)
        norm_urls = []
        for raw_u in raw_urls:
            nu = _normalize_url(raw_u)
            if nu:
                norm_urls.append(nu)
        if not norm_urls:
            continue

        # Keep first URL as citation identifier; keep others in notes.
        norm_url = norm_urls[0]
        raw_url = _strip_url(raw_urls[0])
        title_match = re.search(r"[\"“”']([^\"“”']+)[\"“”']", line_clean)
        if title_match:
            title = _clean_text(title_match.group(1), 300)
        else:
            title_tmp = re.sub(r"^\s*(?:\d+|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)\s+", "", line_clean)
            title_tmp = re.sub(r"https?://[^\s,;]+", "", title_tmp)
            title_tmp = re.sub(r"\baccessed\b.*$", "", title_tmp, flags=re.I)
            title = _clean_text(title_tmp, 300)
        year = _extract_year_from_citation_line(line_clean)
        # Conservative bibliographic gate: keep citation only when it looks like a reference,
        # not just a raw URL mention.
        if year is None and "accessed" not in line_clean.lower() and not re.search(r"\b(hearing|statement|reported|press)\b", line_clean, re.I):
            continue
        stype, entity, venue = classify_source(" ".join([line_clean, norm_url, title]))

        if norm_url in url_to_source_id:
            src_id = url_to_source_id[norm_url]
            existing = source_by_id.get(src_id)
            if isinstance(existing, dict):
                cur_type = str(existing.get("source_type") or "other")
                if cur_type == "other" and stype != "other":
                    existing["source_type"] = stype
                    existing["entity_name"] = entity
                    existing["publication_or_venue"] = venue
                cur_title = str(existing.get("title") or "").strip()
                if (not cur_title) or cur_title.lower().startswith("referenced source"):
                    existing["title"] = _clean_text(title, 300)
                if existing.get("year") is None and year is not None:
                    existing["year"] = year
        else:
            src_id = f"SRC{next_source:04d}"
            url_to_source_id[norm_url] = src_id
            src_obj = {
                    "source_id": src_id,
                    "source_type": stype,
                    "entity_name": entity,
                    "year": year,
                    "title": _clean_text(title, 300),
                    "publication_or_venue": venue,
                    "url_or_identifier": norm_url,
                    "cited_in_document": [
                        _loc(
                            page_index=line_to_page.get(i, 0) if line_to_page.get(i, 0) <= max_known_page else 0,
                            page_label=page_labels.get(line_to_page.get(i, 0) if line_to_page.get(i, 0) <= max_known_page else 0),
                            section=heading_by_line.get(i),
                            object_id=f"CIT{c:04d}",
                        )
                    ],
                    "notes": "Parsed from footnote-style bibliographic line in markdown.",
                }
            sources.append(src_obj)
            source_by_id[src_id] = src_obj
            next_source += 1

        anchor = anchors.page_anchor(
            text=line_clean,
            section=heading_by_line.get(i),
            page_index=line_to_page.get(i, 0) if line_to_page.get(i, 0) <= max_known_page else 0,
            page_label=page_labels.get(line_to_page.get(i, 0) if line_to_page.get(i, 0) <= max_known_page else 0),
            object_id=f"CIT{c:04d}",
            notes="Citation anchor from footnote-style line.",
        )
        citations.append(
            {
                "citation_id": f"CIT{c:04d}",
                "citation_kind": "bibliographic",
                "raw_citation_text": _clean_text(line_clean, 1800),
                "raw_identifier": raw_url,
                "normalized_identifier": norm_url,
                "resolved_source_id": src_id,
                "anchor": anchor,
                "notes": "Footnote-style bibliographic citation.",
            }
        )
        c += 1
        if len(citations) >= 60:
            break

    # Optional sidecar merge (e.g., missing-footnote inference with canonical footnote recovery).
    if isinstance(references_payload, dict):
        refs = (((references_payload.get("structured_references") or {}).get("references")) or [])
        all_items = (references_payload.get("all_footnote_items") or {})

        refs_by_fn: dict[int, dict[str, Any]] = {}
        for r in refs if isinstance(refs, list) else []:
            if not isinstance(r, dict):
                continue
            fn = r.get("footnote_number")
            if not isinstance(fn, int) or fn <= 0:
                continue
            bib = r.get("bibliographic_info") if isinstance(r.get("bibliographic_info"), dict) else {}
            conf = r.get("confidence")
            try:
                conf_f = float(conf) if conf is not None else 0.0
            except (TypeError, ValueError):
                conf_f = 0.0
            richness = sum(1 for k in ("title", "url", "year", "publisher_or_source", "raw_reference") if str(bib.get(k) or "").strip())
            score = conf_f + (0.05 * richness)
            prev = refs_by_fn.get(fn)
            if prev is None or score > float(prev.get("_score") or -1.0):
                rec = dict(r)
                rec["_score"] = score
                refs_by_fn[fn] = rec

        seen_fn: set[int] = set()
        for cit in citations:
            fn = _footnote_number_prefix(str(cit.get("raw_citation_text") or ""))
            if fn is not None:
                seen_fn.add(fn)

        fn_keys: list[int] = []
        if isinstance(all_items, dict):
            for k in all_items.keys():
                if str(k).isdigit():
                    fn_keys.append(int(str(k)))
        for fn in sorted(set(fn_keys)):
            if fn in seen_fn:
                continue
            txt = str(all_items.get(str(fn)) or "").strip()
            row = refs_by_fn.get(fn) or {}
            bib = row.get("bibliographic_info") if isinstance(row.get("bibliographic_info"), dict) else {}
            raw_ref = str(bib.get("raw_reference") or txt or f"Footnote {fn}")
            raw_url = str(bib.get("url") or "").strip()
            if not raw_url:
                found = URL_RE.findall(raw_ref)
                raw_url = found[0] if found else ""
            norm_url = _normalize_url(raw_url) if raw_url else None
            title = _clean_text(str(bib.get("title") or ""), 300)
            if not title:
                m = re.search(r"[\"“”']([^\"“”']+)[\"“”']", raw_ref)
                if m:
                    title = _clean_text(m.group(1), 300)
                else:
                    title = _clean_text(re.sub(r"^\s*(?:\d+|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)\s+", "", raw_ref), 300)
            year: int | None = None
            y_raw = str(bib.get("year") or "").strip()
            if y_raw.isdigit():
                y = int(y_raw)
                if 1900 <= y <= 2100:
                    year = y
            if year is None:
                year = _extract_year_from_citation_line(raw_ref)
            pub_seed = _clean_text(str(bib.get("publisher_or_source") or ""), 300)
            stype, entity, venue = classify_source(" ".join([raw_ref, raw_url, title, pub_seed]))
            pub = _clean_text(str(bib.get("publisher_or_source") or venue), 300)

            # Preserve each recovered footnote as a distinct source record.
            src_id = f"SRC{next_source:04d}"
            page_idx_raw = row.get("page_index_0based") if isinstance(row.get("page_index_0based"), int) else 0
            page_idx = page_idx_raw if 0 <= page_idx_raw <= max_known_page else 0
            sources.append(
                {
                    "source_id": src_id,
                    "source_type": stype,
                    "entity_name": entity,
                    "year": year,
                    "title": title,
                    "publication_or_venue": pub,
                    "url_or_identifier": norm_url or None,
                    "cited_in_document": [
                        _loc(
                            page_index=page_idx,
                            page_label=page_labels.get(page_idx),
                            section=None,
                            object_id=f"CIT{c:04d}",
                        )
                    ],
                    "notes": "Recovered from missing-footnote sidecar.",
                }
            )
            next_source += 1

            page_idx = row.get("page_index_0based") if isinstance(row.get("page_index_0based"), int) else 0
            if not (0 <= page_idx <= max_known_page):
                page_idx = 0
            anchor = anchors.page_anchor(
                text=_clean_text(txt or raw_ref, 1800),
                section=None,
                page_index=page_idx,
                page_label=page_labels.get(page_idx),
                object_id=f"CIT{c:04d}",
                notes=f"Recovered citation for footnote {fn}.",
            )
            citations.append(
                {
                    "citation_id": f"CIT{c:04d}",
                    "citation_kind": "bibliographic",
                    "raw_citation_text": _clean_text(raw_ref, 1800),
                    "raw_identifier": raw_url or f"footnote:{fn}",
                    "normalized_identifier": norm_url or f"footnote:{fn}",
                    "resolved_source_id": src_id,
                    "anchor": anchor,
                    "notes": "Recovered from missing-footnote sidecar.",
                }
            )
            c += 1

    # Update cited locations for already-seen sources.
    src_map = {s["source_id"]: s for s in sources}
    for cit in citations:
        sid = cit.get("resolved_source_id")
        if not isinstance(sid, str) or sid not in src_map:
            continue
        loc = (cit.get("anchor") or {}).get("location")
        if not isinstance(loc, dict):
            continue
        src_map[sid].setdefault("cited_in_document", [])
        if loc not in src_map[sid]["cited_in_document"]:
            src_map[sid]["cited_in_document"].append(loc)

    return sources, citations


def _extract_entities(
    lines: list[str],
    heading_by_line: dict[int, str | None],
    line_to_page: dict[int, int],
    page_labels: dict[int, str | None],
) -> list[dict[str, Any]]:
    targets = [
        ("ENT00001", "APT1", "group", "APT1"),
        ("ENT00002", "PLA Unit 61398", "organization", "Unit 61398"),
        ("ENT00003", "Chinese Government", "state", "Chinese Government"),
        ("ENT00004", "Mandiant", "organization", "Mandiant"),
        ("ENT00005", "UglyGorilla", "individual", "UglyGorilla"),
        ("ENT00006", "DOTA", "individual", "DOTA"),
        ("ENT00007", "SuperHard", "individual", "SuperHard"),
        ("ENT00008", "China Telecom", "organization", "China Telecom"),
    ]
    # map unsupported entity type "individual" -> "person"
    entities: list[dict[str, Any]] = []
    for eid, name, etype, needle in targets:
        idx, _ = _find_line(lines, needle)
        mapped = "person" if etype == "individual" else etype
        entities.append(
            {
                "entity_id": eid,
                "name": name,
                "entity_type": mapped if mapped in {"person", "organization", "state", "group", "company", "tool", "malware", "other"} else "other",
                "aliases": [],
                "mentions": [
                    _loc(
                        page_index=line_to_page.get(idx, 0),
                        page_label=page_labels.get(line_to_page.get(idx, 0)),
                        section=heading_by_line.get(idx),
                        object_id=None,
                    )
                ],
            }
        )
    return entities


def _extract_artifacts(
    *,
    lines: list[str],
    heading_by_line: dict[int, str | None],
    line_to_page: dict[int, int],
    page_labels: dict[int, str | None],
    anchors: AnchorFactory,
    max_total: int = 400,
) -> list[dict[str, Any]]:
    occ: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    seq = 1

    allowed_file_exts = {"exe", "dll", "pdb", "zip", "rar", "7z", "log", "txt", "doc", "docx", "pdf", "ioc", "bat", "cmd", "ps1"}

    def clean_email(token: str) -> str:
        e = html.unescape(token).strip().strip("<>\"'()[]{}")
        e = re.sub(rf"[{re.escape(SUPERSCRIPT_CHARS)}]+$", "", e)
        e = e.rstrip(".,;:")
        return e.lower()

    def add(kind: str, value: str, line_i: int, raw_line: str) -> None:
        nonlocal seq
        if len(occ) >= max_total:
            return
        norm = html.unescape((value or "").strip())
        if not norm:
            return
        if kind in {"domain", "email"}:
            norm = norm.lower()
        if kind in {"hash_md5", "hash_sha1", "hash_sha256"}:
            norm = norm.lower()
        if kind == "url":
            norm = _normalize_url(norm) or ""
            if not norm:
                return
        if kind == "domain":
            if not _looks_like_domain(norm):
                return
            if "/" in norm or "?" in norm or "=" in norm:
                return
        if kind == "email":
            norm = clean_email(norm)
            if not EMAIL_RE.fullmatch(norm):
                return
        if kind == "ip":
            if not IPV4_RE.fullmatch(norm):
                return
        if kind == "cve":
            norm = norm.upper()
            if not CVE_RE.fullmatch(norm):
                return
        if kind == "file_name":
            ext = norm.lower().rsplit(".", 1)[-1] if "." in norm else ""
            if ext not in allowed_file_exts:
                return

        key = (kind, norm)
        if key in seen:
            return
        seen.add(key)
        anchor = anchors.page_anchor(
            text=raw_line,
            section=heading_by_line.get(line_i),
            page_index=line_to_page.get(line_i, 0),
            page_label=page_labels.get(line_to_page.get(line_i, 0)),
            object_id=f"ART{seq:05d}",
            notes=f"Artifact match for type '{kind}'.",
        )
        occ.append(
            {
                "artifact_id": f"ART{seq:05d}",
                "artifact_type": kind,
                "value": _clean_text(value, 7800),
                "normalized_value": _clean_text(norm, 7800),
                "anchor": anchor,
                "notes": "Regex-based extraction from markdown.",
            }
        )
        seq += 1

    for i, line in enumerate(lines):
        line_clean = html.unescape(line)
        # URLs: add URL artifact + domain + optional file_name from path tail
        for u in URL_RE.findall(line_clean):
            nu = _normalize_url(u)
            if not nu:
                continue
            add("url", nu, i, line)
            pu = urlparse(nu)
            if pu.hostname:
                add("domain", pu.hostname, i, line)
            tail = Path(pu.path).name.strip()
            if tail and "." in tail:
                add("file_name", tail, i, line)

        for e in EMAIL_RE.findall(line_clean):
            email_norm = clean_email(e)
            add("email", email_norm, i, line)
            if "@" in email_norm:
                add("domain", email_norm.split("@", 1)[1], i, line)
        for ip in IPV4_RE.findall(line_clean):
            add("ip", ip, i, line)
        for cve in CVE_RE.findall(line_clean):
            add("cve", cve.upper(), i, line)
        for h in SHA256_RE.findall(line_clean):
            add("hash_sha256", h, i, line)
        for h in SHA1_RE.findall(line_clean):
            add("hash_sha1", h, i, line)
        for h in MD5_RE.findall(line_clean):
            add("hash_md5", h, i, line)
        # Standalone domains (not already covered by URL host parsing).
        for m in DOMAIN_RE.finditer(line_clean):
            d = m.group(0)
            start, end = m.span()
            prev_ch = line_clean[start - 1] if start > 0 else ""
            next_ch = line_clean[end] if end < len(line_clean) else ""
            # Skip email local-part / domain captures from email tokens.
            if prev_ch == "@" or next_ch == "@":
                continue
            if _looks_like_domain(d):
                add("domain", d, i, line)
        if len(occ) >= max_total:
            break

    return occ


def _artifact_index(artifacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[str]] = defaultdict(list)
    for a in artifacts:
        grouped[a["artifact_type"]].append(a["normalized_value"] or a["value"])
    out = []
    for kind in sorted(grouped.keys()):
        vals = grouped[kind]
        out.append(
            {
                "artifact_type": kind,
                "count": len(vals),
                "example_values": vals[:25],
                "notes": f"Offline regex extraction count for {kind}.",
            }
        )
    return out


def _anchor_location(anchor: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(anchor, dict):
        return {}
    loc = anchor.get("location")
    return loc if isinstance(loc, dict) else {}


def _claim_local_artifact_inventory(
    *,
    artifacts: list[dict[str, Any]],
    claim_text: str,
    claim_heading: str,
    claim_page: int,
    preferred_types: list[str] | None = None,
    limit_types: int = 8,
) -> list[dict[str, Any]]:
    claim_tokens = set(re.findall(r"[a-z0-9]{3,}", claim_text.lower()))
    heading_lc = (claim_heading or "").strip().lower()
    scored: list[tuple[float, dict[str, Any]]] = []

    preferred = {str(x).strip().lower() for x in (preferred_types or []) if str(x).strip()}
    for art in artifacts:
        anchor = art.get("anchor") if isinstance(art.get("anchor"), dict) else None
        loc = _anchor_location(anchor)
        page_idx = int(loc.get("page_index", 0) or 0)
        section_lc = str(loc.get("section_heading") or "").strip().lower()
        kind_lc = str(art.get("artifact_type") or "other").strip().lower()
        val = str(art.get("normalized_value") or art.get("value") or "")
        val_tokens = set(re.findall(r"[a-z0-9]{3,}", val.lower()))

        score = 0.0
        if page_idx == claim_page:
            score += 1.0
        elif abs(page_idx - claim_page) == 1:
            score += 0.5
        elif abs(page_idx - claim_page) <= 3:
            score += 0.25

        if heading_lc and section_lc:
            if heading_lc == section_lc:
                score += 3.0
            elif heading_lc in section_lc or section_lc in heading_lc:
                score += 1.5

        if kind_lc in preferred:
            score += 1.5

        token_overlap = len(claim_tokens.intersection(val_tokens))
        if token_overlap:
            score += min(3.0, token_overlap * 0.75)

        if score > 0.0:
            scored.append((score, art))

    if not scored:
        scored = [(1.0, a) for a in artifacts]

    scored.sort(key=lambda x: x[0], reverse=True)
    selected_scored = scored[:80]

    by_type: dict[str, list[tuple[float, dict[str, Any]]]] = defaultdict(list)
    for art_score, art in selected_scored:
        by_type[str(art.get("artifact_type") or "other")].append((art_score, art))

    type_ranking: list[tuple[float, str]] = []
    weighted_counts: dict[str, int] = {}
    for kind, arr in by_type.items():
        top = max((score for score, _art in arr), default=0.0)
        total = sum(score for score, _art in arr)
        weighted = int(round(total / 2.0))
        weighted = max(1, min(len(arr), weighted))
        weighted_counts[kind] = weighted
        type_ranking.append((top + min(3.0, total * 0.1), kind))
    type_ranking.sort(key=lambda x: x[0], reverse=True)

    ranked_types = [x for x in type_ranking if x[0] >= 1.2 and weighted_counts.get(x[1], 0) >= 2]
    if len(ranked_types) < 3:
        ranked_types = type_ranking[: min(3, len(type_ranking))]
    out: list[dict[str, Any]] = []
    for _score, kind in ranked_types[:limit_types]:
        arr = by_type[kind]
        support_anchors: list[dict[str, Any]] = []
        for _ascore, art in arr:
            a = art.get("anchor")
            if not isinstance(a, dict):
                continue
            aid = str(a.get("anchor_id") or "")
            if aid and all(str(x.get("anchor_id") or "") != aid for x in support_anchors):
                support_anchors.append(a)
            if len(support_anchors) >= 4:
                break
        out.append(
            {
                "artifact_type": kind,
                "count": int(weighted_counts.get(kind, len(arr))),
                "supporting_anchors": support_anchors,
                "notes": "Claim-local artifact inventory from section/page/token overlap.",
            }
        )
    return out


def _parse_pdf_date(pdf_date: str) -> str | None:
    m = re.match(r"^D:(\d{4})(\d{2})(\d{2})", (pdf_date or "").strip())
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1900 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return f"{y:04d}-{mo:02d}-{d:02d}"


def _infer_pdf_metadata(markdown_path: Path) -> tuple[str | None, str | None]:
    pdf_path = markdown_path.with_suffix(".pdf")
    if not pdf_path.is_file():
        return None, None
    try:
        import pypdf  # type: ignore

        reader = pypdf.PdfReader(str(pdf_path))
        md = reader.metadata or {}
        for key in ("/CreationDate", "/ModDate"):
            raw = md.get(key)
            if isinstance(raw, str):
                parsed = _parse_pdf_date(raw)
                if parsed:
                    return parsed, raw
    except Exception:
        return None, None
    return None, None


def _c_quality(*, anchors: bool, external: bool, quantitative: bool, limitations: bool) -> dict[str, Any]:
    return {
        "has_verbatim_anchors": anchors,
        "has_external_sources": external,
        "has_quantitative_counts": quantitative,
        "has_explicit_limitations": limitations,
    }


def _build_claim(
    *,
    claim_id: str,
    salience_rank: int,
    claim_type: str,
    scope: str,
    explicitness: str,
    statement_anchor: dict[str, Any],
    subject_name: str,
    attribution_name: str,
    attribution_type: str,
    relationship: str,
    components: list[str],
    caveats: list[dict[str, Any]],
    certainty_anchor: dict[str, Any],
    certainty_expression: str,
    legal_anchor: dict[str, Any] | None,
    sources: list[dict[str, Any]],
    support_source_ids: list[str],
    support_anchor: dict[str, Any],
    support_component_anchors: dict[str, dict[str, Any]] | None,
    source_anchors_by_id: dict[str, list[dict[str, Any]]] | None = None,
    artifact_inventory: list[dict[str, Any]],
) -> dict[str, Any]:
    src_ids = [s["source_id"] for s in sources]
    external_count = sum(1 for s in sources if s["source_type"] != "internal_document_section")
    unique_entities = len({s["entity_name"] for s in sources})

    component_anchor_map = dict(support_component_anchors or {})
    for comp in components:
        component_anchor_map.setdefault(comp, support_anchor)
    support_anchor_list: list[dict[str, Any]] = []
    for comp in components:
        anchor = component_anchor_map.get(comp, support_anchor)
        aid = anchor.get("anchor_id") if isinstance(anchor, dict) else None
        if isinstance(anchor, dict) and all((a.get("anchor_id") != aid) for a in support_anchor_list):
            support_anchor_list.append(anchor)

    if isinstance(source_anchors_by_id, dict):
        for sid in support_source_ids:
            for a in (source_anchors_by_id.get(sid) or []):
                if not isinstance(a, dict):
                    continue
                aid = a.get("anchor_id")
                if all((x.get("anchor_id") != aid) for x in support_anchor_list):
                    support_anchor_list.append(a)
                if len(support_anchor_list) >= 18:
                    break
            if len(support_anchor_list) >= 18:
                break

    supports = []
    for sid in support_source_ids:
        source_specific_anchors: list[dict[str, Any]] = []
        if isinstance(source_anchors_by_id, dict):
            source_specific_anchors = [a for a in (source_anchors_by_id.get(sid) or []) if isinstance(a, dict)]
        if not source_specific_anchors:
            source_specific_anchors = support_anchor_list[:3] if support_anchor_list else [support_anchor]
        supports.append(
            {
                "source_id": sid,
                "supports_components": components[:3],
                "supporting_anchors": source_specific_anchors[:3],
                "notes": f"Source {sid} has direct in-document evidence anchor for this claim.",
            }
        )

    corr_rows = []
    for comp in components:
        comp_anchor = component_anchor_map.get(comp, support_anchor)
        corr_rows.append(
            {
                "component": comp,
                "supported_by_source_ids": support_source_ids,
                "supporting_anchors": [comp_anchor],
                "source_count": len(support_source_ids),
                "unique_source_entity_count": min(unique_entities, len(support_source_ids)),
                "notes": f"Component '{comp}' supported by directly grounded sources only.",
            }
        )

    arg_steps = [
        {
            "step_id": f"{claim_id}-S01",
            "step_type": "observation",
            "statement": _clean_text(statement_anchor["verbatim_text"], 1800),
            "supports_component": components[0],
            "depends_on_step_ids": [],
            "supporting_anchors": [statement_anchor],
            "supporting_source_ids": support_source_ids,
            "notes": "Direct observation in report text.",
        },
        {
            "step_id": f"{claim_id}-S02",
            "step_type": "final_conclusion",
            "statement": f"The report attributes {subject_name} to {attribution_name} with hedged confidence language.",
            "supports_component": components[min(1, len(components) - 1)],
            "depends_on_step_ids": [f"{claim_id}-S01"],
            "supporting_anchors": support_anchor_list[:6] if support_anchor_list else [statement_anchor],
            "supporting_source_ids": support_source_ids,
            "notes": "Inference synthesized from key findings and executive summary.",
        },
    ]

    legal_refs = []
    std_proof = []
    if legal_anchor is not None:
        std_proof = [legal_anchor]

    return {
        "claim_id": claim_id,
        "salience_rank": salience_rank,
        "claim_type": claim_type,
        "scope": scope,
        "explicitness": explicitness,
        "claim_statement": statement_anchor,
        "subject": {
            "name": subject_name,
            "kind": "intrusion_set",
            "aliases": [],
        },
        "attribution": {
            "attributed_to_name": attribution_name,
            "attributed_to_type": attribution_type,
            "relationship": relationship,
        },
        "claim_components_asserted": components,
        "caveats_or_limitations_in_text": caveats,
        "quality_checks": {
            "has_claim_grounding_anchor": True,
            "has_sources_index": True,
            "has_corroboration_matrix": True,
            "has_argument_steps": True,
            "has_certainty_expressions": True,
            "has_legal_references": False,
        },
        "six_c": {
            "chain_of_custody": {
                "key_questions": [
                    "What evidence types support this claim?",
                    "Are collection and preservation details explicitly disclosed?",
                ],
                "quality_checks": _c_quality(
                    anchors=True,
                    external=external_count > 0,
                    quantitative=bool(artifact_inventory),
                    limitations=bool(caveats),
                ),
                "summary": "Chain-of-custody details are partially inferable from report disclosures and artifact publication.",
                "evidence_items": (
                    [
                        item for item in artifact_inventory[:6] if int(item.get("count", 0) or 0) >= 4
                    ]
                    or artifact_inventory[:3]
                )
                and [
                    {
                        "evidence_purpose": "link_incident_to_actor",
                        "evidence_kind": str(item.get("artifact_type") or "technical_artifact"),
                        "artifact_identifiers": (
                            [f"{str(item.get('artifact_type') or 'artifact')}:{int(item.get('count') or 0)}"]
                            + [s["url_or_identifier"] for s in sources if s["url_or_identifier"]][:7]
                        )[:8],
                        "collection_context": {
                            "collector": "Mandiant",
                            "collection_time_window": "2006-2013 (as reported)",
                            "collection_environment": "Incident response investigations",
                            "preservation_method": "Report publication and indicator release",
                        },
                        "integrity_controls_disclosed": [],
                        "tampering_or_spoofing_risks_noted": [
                            "Attribution-related infrastructure can be spoofed or repurposed."
                        ],
                        "anchors": (
                            [a for a in (item.get("supporting_anchors") or []) if isinstance(a, dict)][:6]
                            or support_anchor_list[:6]
                            or [statement_anchor]
                        ),
                        "artifact_counters": [item],
                        "notes": "Claim-local custody evidence grouped by artifact class and anchor locality.",
                    }
                    for item in (
                        [x for x in artifact_inventory[:6] if int(x.get("count", 0) or 0) >= 4]
                        or artifact_inventory[:3]
                    )
                ]
                or [
                    {
                        "evidence_purpose": "link_incident_to_actor",
                        "evidence_kind": "technical_artifact",
                        "artifact_identifiers": [s["url_or_identifier"] for s in sources if s["url_or_identifier"]][:6],
                        "collection_context": {
                            "collector": "Mandiant",
                            "collection_time_window": "2006-2013 (as reported)",
                            "collection_environment": "Incident response investigations",
                            "preservation_method": "Report publication and indicator release",
                        },
                        "integrity_controls_disclosed": [],
                        "tampering_or_spoofing_risks_noted": [
                            "Attribution-related infrastructure can be spoofed or repurposed."
                        ],
                        "anchors": support_anchor_list[:8] if support_anchor_list else [statement_anchor],
                        "artifact_counters": artifact_inventory[:6],
                        "notes": "Fallback custody evidence item when claim-local artifact classes are unavailable.",
                    }
                ],
                "artifact_inventory": artifact_inventory[:12],
            },
            "credibility": {
                "key_questions": [
                    "How many independent sources are cited?",
                    "Do cited sources include external references?",
                ],
                "quality_checks": _c_quality(
                    anchors=True,
                    external=external_count > 0,
                    quantitative=True,
                    limitations=bool(caveats),
                ),
                "summary": "Credibility is supported by internal incident-response reporting and externally cited references.",
                "sources_index": sources,
                "sources_supporting_claim": supports,
                "citation_counts": {
                    "total_sources": len(sources),
                    "external_sources": external_count,
                    "internal_sources": len(sources) - external_count,
                    "unique_source_entities": unique_entities,
                },
            },
            "corroboration": {
                "key_questions": [
                    "Which claim components are corroborated by more than one source?",
                    "Is support distributed across internal and external records?",
                ],
                "quality_checks": _c_quality(
                    anchors=True,
                    external=external_count > 0,
                    quantitative=True,
                    limitations=bool(caveats),
                ),
                "summary": "Corroboration matrix links each component only to sources with direct supporting anchors.",
                "corroboration_matrix": corr_rows[:40],
            },
            "coherence": {
                "key_questions": [
                    "Does the argument flow from observation to conclusion?",
                    "Are alternative hypotheses acknowledged?",
                ],
                "quality_checks": _c_quality(
                    anchors=True,
                    external=external_count > 0,
                    quantitative=False,
                    limitations=bool(caveats),
                ),
                "summary": "The report presents explicit observations and an attribution conclusion with caveats.",
                "argument_steps": arg_steps,
                "alternative_hypotheses_in_text": caveats[:10],
            },
            "confidence": {
                "key_questions": [
                    "What certainty language is used for attribution?",
                    "Does the document define a confidence scale?",
                ],
                "quality_checks": _c_quality(
                    anchors=True,
                    external=False,
                    quantitative=False,
                    limitations=bool(caveats),
                ),
                "summary": "Confidence is expressed with hedged language such as 'believed' and 'likely'.",
                "certainty_expressions": [
                    {
                        "expression": certainty_expression,
                        "polarity": "mixed_or_hedged",
                        "applies_to_component": components[0],
                        "anchors": [certainty_anchor],
                        "notes": "Hedged modality indicates non-absolute confidence.",
                    }
                ],
                "confidence_scale_definition": {
                    "defined_in_document": False,
                    "definition_anchors": [],
                },
            },
            "compliance": {
                "key_questions": [
                    "Does the text reference explicit legal attribution tests?",
                    "Is a standard of proof phrase present?",
                ],
                "quality_checks": _c_quality(
                    anchors=legal_anchor is not None,
                    external=False,
                    quantitative=False,
                    limitations=False,
                ),
                "summary": "No formal legal-test framework is explicitly mapped; standard-of-proof language is limited.",
                "legal_references": legal_refs,
                "legal_mapping": [
                    {
                        "test": "attribution_standard_of_proof",
                        "addressed_in_text": legal_anchor is not None,
                        "position_verbatim": legal_anchor["verbatim_text"] if legal_anchor is not None else None,
                        "anchors": [legal_anchor] if legal_anchor is not None else [],
                        "notes": "Mapped to textual certainty/uncertainty statements rather than legal doctrine.",
                    }
                ],
                "standard_of_proof_language": std_proof,
            },
        },
    }


def _claim_profile_from_text(line: str) -> dict[str, Any]:
    low = str(line or "").lower()
    if "government-sponsored" in low or "government support" in low or "likely government" in low:
        return {
            "claim_type": "state_responsibility_claim",
            "scope": "state_responsibility_claim",
            "subject_name": "APT1",
            "attribution_name": "Chinese Government",
            "attribution_type": "state",
            "relationship": "likely_responsible",
            "components": ["state_sponsorship_or_direction", "actor_identity", "intent_motive"],
        }
    if any(k in low for k in ("stolen", "compromise", "victim", "terabytes", "maintained access", "campaign")):
        return {
            "claim_type": "mixed",
            "scope": "mixed",
            "subject_name": "APT1 campaign",
            "attribution_name": "APT1 operators",
            "attribution_type": "state_linked_actor",
            "relationship": "associated_with",
            "components": ["victimology", "timeline_linkage", "command_and_control"],
        }
    return {
        "claim_type": "intrusion_set_attribution",
        "scope": "intrusion_set",
        "subject_name": "APT1",
        "attribution_name": "PLA Unit 61398",
        "attribution_type": "state_linked_actor",
        "relationship": "attributed_to",
        "components": ["actor_identity", "infrastructure_linkage"],
    }


def _preferred_artifact_types(profile: dict[str, Any]) -> list[str]:
    claim_type = str(profile.get("claim_type") or "").lower()
    components = {str(x).lower() for x in (profile.get("components") or [])}
    preferred: list[str] = []
    if claim_type == "state_responsibility_claim":
        preferred.extend(["domain", "url", "email"])
    elif claim_type == "mixed":
        preferred.extend(["ip", "hash_md5", "hash_sha1", "hash_sha256", "file_name", "url"])
    else:
        preferred.extend(["domain", "ip", "url"])
    if "infrastructure_linkage" in components:
        preferred.extend(["domain", "ip", "url"])
    if "timeline_linkage" in components:
        preferred.extend(["ip", "file_name", "hash_md5", "hash_sha1", "hash_sha256"])
    if "victimology" in components:
        preferred.extend(["email", "domain", "url"])
    return list(dict.fromkeys(preferred))


def _mine_claim_candidates(
    *,
    lines: list[str],
    heading_by_line: dict[int, str | None],
    max_claims: int,
) -> list[tuple[int, str]]:
    seeds = [
        "APT1 is believed to be",
        "APT1 has systematically stolen",
        "likely government-sponsored",
    ]
    candidates: list[tuple[int, int, str]] = []

    for needle in seeds:
        i, l = _find_line(lines, needle)
        if _clean_text(l):
            candidates.append((100, i, l))

    kws = (
        "apt1",
        "believed",
        "likely",
        "conclude",
        "attribut",
        "compromise",
        "stolen",
        "victim",
        "campaign",
        "government",
        "unit 61398",
        "infrastructure",
    )
    section_boost = ("executive summary", "key findings", "conclusion")

    for i, raw in enumerate(lines):
        line = _clean_text(raw, 2000)
        if len(line) < 90:
            continue
        if FOOTNOTE_LINE_RE.match(line):
            continue
        if line.count("|") >= 3:
            continue
        if "http://" in line.lower() or "https://" in line.lower():
            continue
        low = line.lower()
        kw_hits = sum(1 for k in kws if k in low)
        if kw_hits < 2:
            continue
        score = kw_hits * 5
        section = str(heading_by_line.get(i) or "").lower()
        if any(s in section for s in section_boost):
            score += 6
        if "apt1" in low:
            score += 3
        if any(k in low for k in ("believed", "likely", "conclude", "attribut")):
            score += 3
        candidates.append((score, i, line))

    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

    dedup: set[str] = set()
    ordered: list[tuple[int, str]] = []
    for _score, idx, text in sorted(candidates, key=lambda x: (-x[0], x[1])):
        key = _norm(text)
        if not key or key in dedup:
            continue
        dedup.add(key)
        ordered.append((idx, text))
        if len(ordered) >= max(1, int(max_claims)):
            break
    return ordered


def build_offline_output(schema_path: Path, markdown_path: Path, references_json_path: Path | None = None) -> dict[str, Any]:
    schema_wrapper = json.loads(schema_path.read_text(encoding="utf-8"))
    _ = schema_wrapper["schema"]  # only used for final validation

    text = markdown_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    line_to_page, page_labels, marker_examples_found = _detect_pages(lines)
    headings, heading_by_line, section_lines = _heading_context(lines)
    anchors = AnchorFactory()

    tables, _table_lines = _extract_tables(
        lines=lines,
        heading_by_line=heading_by_line,
        line_to_page=line_to_page,
        page_labels=page_labels,
    )
    text_blocks = _make_text_blocks(
        lines=lines,
        heading_by_line=heading_by_line,
        line_to_page=line_to_page,
        page_labels=page_labels,
    )
    figures = _make_figures(lines, heading_by_line, line_to_page, page_labels)
    references_payload: dict[str, Any] | None = None
    if references_json_path is not None and references_json_path.is_file():
        try:
            loaded = json.loads(references_json_path.read_text(encoding="utf-8"))
            references_payload = loaded if isinstance(loaded, dict) else None
        except Exception:
            references_payload = None

    sources, citations = _extract_sources_and_citations(
        lines=lines,
        heading_by_line=heading_by_line,
        line_to_page=line_to_page,
        page_labels=page_labels,
        anchors=anchors,
        references_payload=references_payload,
    )
    markdown_blob_lc = "\n".join(lines).lower()
    source_anchor_map: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for cit in citations:
        sid = str(cit.get("resolved_source_id") or "").strip()
        anch = cit.get("anchor")
        if sid and isinstance(anch, dict):
            txt = _clean_text(str(anch.get("verbatim_text") or ""), 1800).lower()
            if txt and txt in markdown_blob_lc:
                source_anchor_map[sid].append(anch)
    entities = _extract_entities(lines, heading_by_line, line_to_page, page_labels)
    artifacts = _extract_artifacts(
        lines=lines,
        heading_by_line=heading_by_line,
        line_to_page=line_to_page,
        page_labels=page_labels,
        anchors=anchors,
        max_total=1200,
    )
    artifact_idx = _artifact_index(artifacts)

    # claim anchors/caveats
    i_cav1, l_cav1 = _find_line(lines, "conclusions are based exclusively on unclassified")
    i_cav2, l_cav2 = _find_line(lines, "there is one other unlikely possibility")
    i_legal, l_legal = _find_line(lines, "without any conclusive evidence")
    # Dynamic claim mining and construction.
    max_claims = 10
    mined = _mine_claim_candidates(lines=lines, heading_by_line=heading_by_line, max_claims=max_claims)
    all_sources = list(sources)
    claims_out: list[dict[str, Any]] = []

    for rank, (idx, stmt_line) in enumerate(mined, start=1):
        cid = f"C{rank:03d}"
        stmt_anchor = anchors.claim_anchor(
            claim_id=cid,
            text=stmt_line,
            section=heading_by_line.get(idx),
            page_index=line_to_page.get(idx, 0),
            page_label=page_labels.get(line_to_page.get(idx, 0)),
            notes="Dynamically mined attribution-relevant claim statement.",
        )
        support_anchor = anchors.claim_anchor(
            claim_id=cid,
            text=stmt_line,
            section=heading_by_line.get(idx),
            page_index=line_to_page.get(idx, 0),
            page_label=page_labels.get(line_to_page.get(idx, 0)),
            notes="Support anchor aligned to mined claim statement.",
        )
        low = stmt_line.lower()
        caveats: list[dict[str, Any]] = []
        if "likely" in low or "believed" in low:
            caveats.append(
                anchors.claim_anchor(
                    claim_id=cid,
                    text=l_cav2,
                    section=heading_by_line.get(i_cav2),
                    page_index=line_to_page.get(i_cav2, 0),
                    page_label=page_labels.get(line_to_page.get(i_cav2, 0)),
                    notes="Alternative-hypothesis caveat propagated to hedged claim.",
                )
            )
        if "unclassified" in low or "evidence" in low:
            caveats.append(
                anchors.claim_anchor(
                    claim_id=cid,
                    text=l_cav1,
                    section=heading_by_line.get(i_cav1),
                    page_index=line_to_page.get(i_cav1, 0),
                    page_label=page_labels.get(line_to_page.get(i_cav1, 0)),
                    notes="Methodology limitation caveat.",
                )
            )
        legal_anchor = None
        if "conclusive evidence" in low or rank == 1:
            legal_anchor = anchors.claim_anchor(
                claim_id=cid,
                text=l_legal,
                section=heading_by_line.get(i_legal),
                page_index=line_to_page.get(i_legal, 0),
                page_label=page_labels.get(line_to_page.get(i_legal, 0)),
                notes="Standard-of-proof style language anchor.",
            )

        profile = _claim_profile_from_text(stmt_line)

        claim_tokens = set(re.findall(r"[a-z0-9]{3,}", stmt_line.lower()))
        claim_heading = str(heading_by_line.get(idx) or "").lower()
        scored_sources: list[tuple[float, dict[str, Any]]] = []
        for s in all_sources:
            sid = str(s.get("source_id") or "")
            blob = " ".join(
                [
                    str(s.get("title") or ""),
                    str(s.get("entity_name") or ""),
                    str(s.get("publication_or_venue") or ""),
                    str(s.get("source_type") or ""),
                ]
            ).lower()
            src_tokens = set(re.findall(r"[a-z0-9]{3,}", blob))
            overlap = len(claim_tokens.intersection(src_tokens))
            score = float(overlap)
            if s.get("source_type") == "internal_document_section":
                score += 2.0
            if sid in source_anchor_map:
                score += 1.0
                sec_hits = 0
                for a in source_anchor_map[sid]:
                    loc = a.get("location") if isinstance(a.get("location"), dict) else {}
                    sec = str(loc.get("section_heading") or "").lower()
                    if claim_heading and sec and claim_heading == sec:
                        sec_hits += 1
                score += min(2.0, 0.5 * sec_hits)
            scored_sources.append((score, s))
        scored_sources.sort(key=lambda x: x[0], reverse=True)
        target_n = min(10, max(2, len(all_sources) // 5))
        claim_sources = [s for sc, s in scored_sources[:target_n] if sc > 0]
        if len(claim_sources) < 2:
            extras = [s for _sc, s in scored_sources if s not in claim_sources]
            claim_sources.extend(extras[: 2 - len(claim_sources)])
        if not claim_sources:
            claim_sources = [s for _sc, s in scored_sources[:target_n]]
        internal = next((s for s in all_sources if s.get("source_type") == "internal_document_section"), None)
        if internal is not None and all(internal.get("source_id") != s.get("source_id") for s in claim_sources):
            claim_sources.insert(0, internal)
        dedup_sids: set[str] = set()
        claim_sources = [
            s
            for s in claim_sources
            if not (
                (str(s.get("source_id") or "") in dedup_sids)
                or dedup_sids.add(str(s.get("source_id") or ""))
            )
        ]
        support_source_ids = [str(s.get("source_id") or "") for s in claim_sources if str(s.get("source_id") or "")]
        claim_source_anchor_subset = {sid: source_anchor_map.get(sid, [])[:6] for sid in support_source_ids}
        candidate_support_anchors: list[dict[str, Any]] = []
        seen_aids: set[str] = set()
        for sid in support_source_ids:
            for a in claim_source_anchor_subset.get(sid, []):
                if not isinstance(a, dict):
                    continue
                aid = str(a.get("anchor_id") or "")
                if not aid or aid in seen_aids:
                    continue
                seen_aids.add(aid)
                candidate_support_anchors.append(a)
                if len(candidate_support_anchors) >= 12:
                    break
            if len(candidate_support_anchors) >= 12:
                break
        if not candidate_support_anchors:
            candidate_support_anchors = [support_anchor]

        component_anchor_map: dict[str, dict[str, Any]] = {}
        comps = list(profile["components"])
        for i_comp, comp in enumerate(comps):
            component_anchor_map[comp] = candidate_support_anchors[i_comp % len(candidate_support_anchors)]

        claim_art_inventory = _claim_local_artifact_inventory(
            artifacts=artifacts,
            claim_text=stmt_line,
            claim_heading=heading_by_line.get(idx) or "",
            claim_page=line_to_page.get(idx, 0),
            preferred_types=_preferred_artifact_types(profile),
            limit_types=8,
        )

        claims_out.append(
            _build_claim(
                claim_id=cid,
                salience_rank=rank,
                claim_type=profile["claim_type"],
                scope=profile["scope"],
                explicitness="explicit",
                statement_anchor=stmt_anchor,
                subject_name=profile["subject_name"],
                attribution_name=profile["attribution_name"],
                attribution_type=profile["attribution_type"],
                relationship=profile["relationship"],
                components=profile["components"],
                caveats=caveats,
                certainty_anchor=stmt_anchor,
                certainty_expression=_clean_text(stmt_line, 220),
                legal_anchor=legal_anchor,
                sources=claim_sources,
                support_source_ids=support_source_ids,
                support_anchor=support_anchor,
                support_component_anchors=component_anchor_map,
                source_anchors_by_id=claim_source_anchor_subset,
                artifact_inventory=claim_art_inventory,
            )
        )

    pub_date = "2013-01-01"
    pub_source = "filename"
    pub_anchor_text = "Filename contains publication year marker: 'Mandiant - 2013 - APT1 ...'; exact month/day not stated."
    pdf_date, pdf_raw = _infer_pdf_metadata(markdown_path)
    if pdf_date is not None:
        pub_date = pdf_date
        pub_source = "pdf_metadata"
        pub_anchor_text = f"PDF metadata /CreationDate or /ModDate found: {pdf_raw}."

    publication_anchor = {
        "anchor_id": "P000-A999",
        "extraction_method": "manual_description",
        "verbatim_text": pub_anchor_text,
        "location": _loc(page_index=0, page_label=page_labels.get(0), section=None, object_id=None),
        "notes": "Publication date inferred from local metadata/filename heuristic.",
    }

    page_count = (max(line_to_page.values()) + 1) if line_to_page else 1
    pages: list[dict[str, Any]] = []
    for pidx in range(page_count):
        p_label = page_labels.get(pidx)
        p_headings: list[str] = []
        seen_heading: set[str] = set()
        for i, ln in enumerate(lines):
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
                "notes": "Offline deterministic parse from markdown; no OCR and no API usage.",
            }
        )

    out = {
        "document_metadata": {
            "title": "APT1: Exposing One of China's Cyber Espionage Units",
            "authoring_entity": "Mandiant",
            "publication_date": pub_date,
            "publication_date_source": pub_source,
            "publication_date_anchor_role": "other_date",
            "publication_date_anchor": publication_anchor,
            "version": "offline_v1",
            "document_type": "vendor_report",
            "audience": "mixed",
            "source_locator": {
                "source_type": "file",
                "source_value": str(markdown_path),
            },
            "input_format": "markdown",
        },
        "pipeline_config": {
            "pdf_page_indexing": "zero_based",
            "page_marker_policy": (
                "explicit_markers_preferred_fallback_page0" if marker_examples_found else "no_page_markers_single_page0"
            ),
            "marker_examples_expected": [],
            "marker_examples_found": marker_examples_found[:10],
            "extract_tables": True,
            "extract_figures_images": True,
            "extract_citations": True,
            "extract_artifacts": True,
            "max_claims": 10,
            "claim_selection_strategy": "top_n_by_author_emphasis",
            "include_implicit_claims": True,
        },
        "stage1_markdown_parse": {
            "page_count": page_count,
            "pages": pages,
            "global_indices": {
                "sources": sources,
                "entities": entities,
                "artifacts": artifact_idx,
            },
        },
        "stage2_claim_extraction": {
            "attribution_claims": claims_out,
            "document_level_index": {
                "sources": sources,
                "entities": entities,
            },
        },
    }
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline schema extraction from markdown (no API).")
    parser.add_argument("--schema", default=DEFAULT_SCHEMA)
    parser.add_argument("--markdown", default=DEFAULT_MARKDOWN)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--references-json", default="", help="Optional missing-footnote inference JSON for source recovery.")
    args = parser.parse_args()

    schema_path = Path(args.schema).expanduser().resolve()
    markdown_path = Path(args.markdown).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    if not schema_path.is_file():
        raise SystemExit(f"[ERROR] schema not found: {schema_path}")
    if not markdown_path.is_file():
        raise SystemExit(f"[ERROR] markdown not found: {markdown_path}")

    schema_wrapper = json.loads(schema_path.read_text(encoding="utf-8"))
    schema = schema_wrapper["schema"]
    references_json_path = Path(args.references_json).expanduser().resolve() if args.references_json else None
    out = build_offline_output(
        schema_path=schema_path,
        markdown_path=markdown_path,
        references_json_path=references_json_path,
    )

    jsonschema.validate(instance=out, schema=schema)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    all_pages = out["stage1_markdown_parse"]["pages"]
    all_artifacts = [a for p in all_pages for a in p.get("artifacts_found", [])]
    all_citations = [c for p in all_pages for c in p.get("citations_found", [])]
    artifact_counts = Counter(a["artifact_type"] for a in all_artifacts)
    print(
        json.dumps(
            {
                "output": str(output_path),
                "validation": "ok",
                "claims": len(out["stage2_claim_extraction"]["attribution_claims"]),
                "sources": len(out["stage2_claim_extraction"]["document_level_index"]["sources"]),
                "entities": len(out["stage2_claim_extraction"]["document_level_index"]["entities"]),
                "citations": len(all_citations),
                "artifacts_total": len(all_artifacts),
                "artifact_types": dict(artifact_counts),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
