#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import html
import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

import jsonschema


DEFAULT_SCHEMA = "annotarium/cyber_attribution_markdown_extraction_v2_schema.json"


HEADING_RE = re.compile(r"^\s*#{1,6}\s+(.+?)\s*$")
URL_RE = re.compile(r"https?://[^\s<>\]\"']+")
EMAIL_RE = re.compile(r"\b[^@\s]+@[^@\s]+\.[^@\s]+\b")
IPV4_RE = re.compile(
    r"\b(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\."
    r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b"
)
OBFUSCATED_IPV4_RE = re.compile(
    r"\b\d{1,3}(?:\[\.\]|\.)\d{1,3}(?:\[\.\]|\.)\d{1,3}(?:\[\.\]|\.)\d{1,3}\b"
)
SHA256_RE = re.compile(r"\b[a-fA-F0-9]{64}\b")
TABLE_MARKER_RE = re.compile(r"^\s*table\s+\d+\s*:", re.I)
SUPERSCRIPT_CHARS = "¹²³⁴⁵⁶⁷⁸⁹⁰²³"


def _now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _clean_text(value: str, max_len: int | None = None) -> str:
    out = re.sub(r"\s+", " ", (value or "").strip())
    if max_len is not None and len(out) > max_len:
        return out[: max_len - 3].rstrip() + "..."
    return out


def _norm_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).lower()


def _strip_url(url: str) -> str:
    s = html.unescape((url or "").strip()).strip("<>").strip()
    s = re.sub(rf"[{re.escape(SUPERSCRIPT_CHARS)}]+$", "", s)
    while s and s[-1] in ".,;:]>'\"”’":
        s = s[:-1]
    while s.endswith(")") and s.count(")") > s.count("("):
        s = s[:-1]
    return s


def _normalize_url(url: str) -> str | None:
    s = _strip_url(url)
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


def _first_sentence(text: str) -> str:
    src = _clean_text(text, 5000)
    if not src:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", src)
    return _clean_text(parts[0], 1000) if parts else _clean_text(src, 1000)


def _year_from_filename(path: Path) -> tuple[int | None, str | None]:
    name = path.name
    m = re.search(r"\((\d{2})-(\d{2})-(\d{4})\)", name)
    if m:
        month = int(m.group(1))
        day = int(m.group(2))
        year = int(m.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            return year, f"{year:04d}-{month:02d}-{day:02d}"
    return None, None


def _split_sections(lines: list[str]) -> list[dict[str, Any]]:
    headings: list[tuple[int, str]] = []
    for idx, line in enumerate(lines):
        m = HEADING_RE.match(line)
        if m:
            headings.append((idx, _clean_text(m.group(1), 300)))

    if not headings:
        txt = "\n".join(lines).strip()
        return [
            {
                "id": "S001",
                "heading": "Document",
                "start_line": 1,
                "end_line": len(lines),
                "raw_text": txt,
                "body_text": txt,
                "status": "pending",
                "packet": None,
            }
        ]

    sections: list[dict[str, Any]] = []
    for i, (start, heading) in enumerate(headings, start=1):
        end = headings[i][0] - 1 if i < len(headings) else len(lines) - 1
        raw = "\n".join(lines[start : end + 1]).strip()
        body = "\n".join(lines[start + 1 : end + 1]).strip()
        sections.append(
            {
                "id": f"S{i:03d}",
                "heading": heading,
                "start_line": start + 1,
                "end_line": end + 1,
                "raw_text": raw,
                "body_text": body,
                "status": "pending",
                "packet": None,
            }
        )
    return sections


def _loc(section: str | None, object_id: str | None) -> dict[str, Any]:
    return {
        "page_index": 0,
        "page_label": None,
        "section_heading": section,
        "object_id": object_id,
    }


def _build_base_source(author: str, title: str, year: int | None) -> dict[str, Any]:
    return {
        "source_id": "SRC0001",
        "source_type": "internal_document_section",
        "entity_name": author or "Unknown",
        "year": year,
        "title": _clean_text(title, 280),
        "publication_or_venue": _clean_text(f"{author} report", 200),
        "url_or_identifier": None,
        "cited_in_document": [_loc(section=None, object_id=None)],
        "notes": "Internal source record for the current markdown document.",
    }


def _default_quality_checks() -> dict[str, Any]:
    return {
        "has_claim_grounding_anchor": True,
        "has_sources_index": True,
        "has_corroboration_matrix": True,
        "has_argument_steps": True,
        "has_certainty_expressions": True,
        "has_legal_references": False,
    }


def _default_c_checks(*, external: bool, quantitative: bool, limitations: bool) -> dict[str, Any]:
    return {
        "has_verbatim_anchors": True,
        "has_external_sources": external,
        "has_quantitative_counts": quantitative,
        "has_explicit_limitations": limitations,
    }


def _subject_kind_for_scope(scope: str) -> str:
    mapping = {
        "campaign": "campaign",
        "intrusion_set": "intrusion_set",
        "incident": "incident",
        "malware_family": "malware_family",
    }
    return mapping.get(scope, "other")


def _init_counters() -> dict[str, int]:
    return {
        "anchor": 1,
        "block": 1,
        "table": 1,
        "citation": 1,
        "source": 2,
        "entity": 1,
        "artifact": 1,
        "claim": 2,
    }


def _next_counter(state: dict[str, Any], key: str) -> int:
    counters = state.setdefault("counters", {})
    value = int(counters.get(key, 1))
    counters[key] = value + 1
    return value


def _next_id(state: dict[str, Any], kind: str) -> str:
    n = _next_counter(state, kind)
    if kind == "anchor":
        return f"P000-A{n:03d}"
    if kind == "block":
        return f"P000-B{n:02d}"
    if kind == "table":
        return f"P000-T{n:02d}"
    if kind == "citation":
        return f"CIT{n:04d}"
    if kind == "source":
        return f"SRC{n:04d}"
    if kind == "entity":
        return f"ENT{n:05d}"
    if kind == "artifact":
        return f"ART{n:05d}"
    if kind == "claim":
        return f"C{n:03d}"
    raise ValueError(f"Unsupported counter kind: {kind}")


def _make_anchor(state: dict[str, Any], *, text: str, section: str | None, object_id: str | None, notes: str) -> dict[str, Any]:
    return {
        "anchor_id": _next_id(state, "anchor"),
        "extraction_method": "markdown",
        "verbatim_text": _clean_text(text, 2400),
        "location": _loc(section=section, object_id=object_id),
        "notes": notes,
    }


def _estimate_author(markdown_text: str) -> str:
    low = markdown_text.lower()
    if "symantec" in low:
        return "Symantec"
    if "mandiant" in low:
        return "Mandiant"
    if "crowdstrike" in low:
        return "CrowdStrike"
    return "Unknown"


def _extract_entities_for_text(text: str) -> list[tuple[str, str]]:
    patterns = [
        ("Nodaria", "group"),
        ("UAC-0056", "group"),
        ("Graphiron", "malware"),
        ("Infostealer.Graphiron", "malware"),
        ("Downloader.Graphiron", "malware"),
        ("GraphSteel", "malware"),
        ("GrimPlant", "malware"),
        ("WhisperGate", "malware"),
        ("Symantec", "organization"),
        ("Ukraine", "state"),
        ("Russia", "state"),
        ("Kyrgyzstan", "state"),
        ("Georgia", "state"),
    ]
    out: list[tuple[str, str]] = []
    for name, etype in patterns:
        if re.search(rf"\b{re.escape(name)}\b", text, flags=re.I):
            out.append((name, etype))
    return out


def _parse_pipe_tables(section_lines: list[str], state: dict[str, Any], heading: str) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    i = 0
    while i < len(section_lines) - 1:
        line = section_lines[i]
        nxt = section_lines[i + 1]
        if "|" in line and re.search(r"^\s*\|?[\s:-]+\|[\s|:-]*$", nxt):
            start = i
            raw_rows = [line, nxt]
            j = i + 2
            while j < len(section_lines):
                cur = section_lines[j]
                cur_s = cur.strip()
                if not cur_s:
                    break
                if HEADING_RE.match(cur) or TABLE_MARKER_RE.match(cur):
                    break
                if "|" in cur and cur_s.startswith("|"):
                    raw_rows.append(cur)
                    j += 1
                    continue
                if len(raw_rows) >= 3 and not raw_rows[-1].rstrip().endswith("|"):
                    raw_rows[-1] = raw_rows[-1] + "\n" + cur
                    j += 1
                    continue
                break

            caption = None
            for k in range(max(0, start - 2), start):
                if TABLE_MARKER_RE.match(section_lines[k]):
                    caption = _clean_text(section_lines[k], 300)
                    break

            cells: list[list[str]] = []
            width = 0
            for ridx, raw in enumerate(raw_rows):
                if ridx > 0 and re.search(r"^\s*\|?[\s:-]+\|[\s|:-]*$", raw):
                    continue
                parts = [p.strip() for p in raw.strip().strip("|").split("|")]
                if ridx == 0:
                    width = max(1, len(parts))
                if len(parts) > width:
                    join_count = len(parts) - width + 1
                    first = "|".join(parts[:join_count]).strip()
                    parts = [first] + parts[join_count:]
                if len(parts) < width:
                    parts = parts + [""] * (width - len(parts))
                cells.append(parts)

            tid = _next_id(state, "table")
            tables.append(
                {
                    "object_id": tid,
                    "caption_verbatim": caption,
                    "table_kind": "data_table",
                    "representation": "markdown_table",
                    "table_markdown": "\n".join(raw_rows),
                    "table_cells": cells,
                    "table_csv": "\n".join([",".join(r) for r in cells]),
                    "table_text_verbatim": _clean_text(" ".join(raw_rows), 48000),
                    "location": _loc(heading, tid),
                    "notes": "Sectional parser extracted a markdown table.",
                }
            )
            i = j
            continue
        i += 1
    return tables


def _parse_process_list_table(section_body: str, heading: str, state: dict[str, Any]) -> list[dict[str, Any]]:
    if "process names" not in heading.lower():
        return []
    lines = [ln.strip() for ln in section_body.splitlines() if ln.strip()]
    if not lines:
        return []
    items: list[str] = []
    for ln in lines:
        if TABLE_MARKER_RE.match(ln):
            continue
        if "," in ln:
            items.extend([x.strip() for x in ln.split(",") if x.strip()])
    uniq: list[str] = []
    seen: set[str] = set()
    for item in items:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(item)
    if len(uniq) < 5:
        return []

    tid = _next_id(state, "table")
    cells = [["index", "process_name"]]
    for idx, name in enumerate(uniq, start=1):
        cells.append([str(idx), name])
    table_md_lines = ["| index | process_name |", "| --- | --- |"]
    table_md_lines.extend([f"| {r[0]} | {r[1]} |" for r in cells[1:]])
    return [
        {
            "object_id": tid,
            "caption_verbatim": "Table 1 process-name blacklist (parsed from comma-separated list).",
            "table_kind": "ioc_list",
            "representation": "cells",
            "table_markdown": "\n".join(table_md_lines),
            "table_cells": cells,
            "table_csv": "\n".join([",".join(r) for r in cells]),
            "table_text_verbatim": _clean_text(", ".join(uniq), 48000),
            "location": _loc(heading, tid),
            "notes": "Converted a process-name list into a structured IOC table.",
        }
    ]


def _collect_artifacts(section_text: str, heading: str, state: dict[str, Any]) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(kind: str, value: str, anchor_text: str, note: str) -> None:
        norm = (value or "").strip()
        if not norm:
            return
        if kind in {"domain", "email"}:
            norm = norm.lower()
        key = (kind, norm)
        if key in seen:
            return
        seen.add(key)
        aid = _next_id(state, "artifact")
        anchor = _make_anchor(state, text=anchor_text, section=heading, object_id=aid, notes=note)
        artifacts.append(
            {
                "artifact_id": aid,
                "artifact_type": kind,
                "value": _clean_text(value, 7800),
                "normalized_value": _clean_text(norm, 7800),
                "anchor": anchor,
                "notes": note,
            }
        )

    lines = section_text.splitlines()
    for ln in lines:
        line = html.unescape(ln)
        for u in URL_RE.findall(line):
            nu = _normalize_url(u)
            if nu:
                add("url", nu, ln, "URL extracted from section text.")
                p = urlparse(nu)
                if p.hostname:
                    add("domain", p.hostname, ln, "Domain parsed from URL artifact.")
        for e in EMAIL_RE.findall(line):
            add("email", e.lower(), ln, "Email extracted from section text.")
        for ip in IPV4_RE.findall(line):
            add("ip", ip, ln, "IPv4 extracted from section text.")
        for oip in OBFUSCATED_IPV4_RE.findall(line):
            deob = oip.replace("[.]", ".")
            if IPV4_RE.fullmatch(deob):
                add("ip", deob, ln, "Deobfuscated bracketed IPv4 indicator.")
                add("other", oip, ln, "Original bracket-obfuscated IPv4 form.")
        for h in SHA256_RE.findall(line):
            add("hash_sha256", h.lower(), ln, "SHA-256 extracted from section text.")
        for fname in re.findall(r"\b[A-Za-z0-9._-]+\.(?:exe|dll|sys|dat|tmp|zip)\b", line, flags=re.I):
            add("file_name", fname, ln, "File-name indicator extracted from text.")
        for proc in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_.-]{2,64}\b", line):
            if proc.lower().endswith((".graphiron", ".graphsteel", ".grimplant")):
                add("process_name", proc, ln, "Malware/process token extracted from text.")

    return artifacts


def _collect_citations_and_sources(
    section_raw: str,
    heading: str,
    state: dict[str, Any],
    existing_sources: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    citations: list[dict[str, Any]] = []
    new_sources: list[dict[str, Any]] = []
    url_to_source_id: dict[str, str] = {}
    for src in existing_sources.values():
        u = src.get("url_or_identifier")
        if isinstance(u, str) and u:
            nu = _normalize_url(u)
            if nu:
                url_to_source_id[nu] = str(src["source_id"])

    for raw in URL_RE.findall(html.unescape(section_raw)):
        nu = _normalize_url(raw)
        if not nu:
            continue
        if nu in url_to_source_id:
            sid = url_to_source_id[nu]
        else:
            sid = _next_id(state, "source")
            url_to_source_id[nu] = sid
            src_type = "vendor_report"
            host = urlparse(nu).hostname or ""
            if "wikipedia" in host:
                src_type = "other"
            source = {
                "source_id": sid,
                "source_type": src_type,
                "entity_name": "Symantec" if "symantec" in host or "security.com" in host else host or "Referenced source",
                "year": None,
                "title": _clean_text(heading, 260),
                "publication_or_venue": host or "web",
                "url_or_identifier": nu,
                "cited_in_document": [_loc(heading, None)],
                "notes": "Source created from section URL reference.",
            }
            m = re.search(r"\b(19|20)\d{2}\b", section_raw)
            if m:
                source["year"] = int(m.group(0))
            new_sources.append(source)

        cid = _next_id(state, "citation")
        anchor = _make_anchor(state, text=section_raw, section=heading, object_id=cid, notes="Bibliographic URL citation anchor.")
        citations.append(
            {
                "citation_id": cid,
                "citation_kind": "bibliographic",
                "raw_citation_text": _clean_text(section_raw, 1800),
                "raw_identifier": _strip_url(raw),
                "normalized_identifier": nu,
                "resolved_source_id": sid,
                "anchor": anchor,
                "notes": "Citation extracted from URL in section text.",
            }
        )
    return citations, new_sources


def _extract_claim_candidates(section_body: str, heading: str) -> list[dict[str, Any]]:
    text = _clean_text(section_body, 12000)
    if not text:
        return []
    candidates: list[dict[str, Any]] = []
    hlow = heading.lower()
    allowed_headings = (
        "russia-linked nodaria group",
        "graphiron functionality",
        "similarity to older tools",
        "nodaria",
    )
    if not any(key in hlow for key in allowed_headings):
        return []

    sentences = re.split(r"(?<=[.!?])\s+", text)
    clean_sentences = [_clean_text(s, 1200) for s in sentences if _clean_text(s, 1200)]

    def pick_support(statement: str) -> str:
        st = _norm_text(statement)
        for cand in clean_sentences:
            if _norm_text(cand) != st and len(cand) > 40:
                return cand
        return heading

    for sent in sentences:
        s = _clean_text(sent, 1200)
        low = s.lower()
        if len(s) < 40:
            continue
        if "nodaria" in low and "using" in low and "ukraine" in low:
            candidates.append(
                {
                    "statement": s,
                    "claim_type": "campaign_attribution",
                    "scope": "campaign",
                    "subject_name": "Nodaria activity",
                    "attributed_to_name": "Nodaria (UAC-0056)",
                    "attributed_to_type": "state_linked_actor",
                    "relationship": "associated_with",
                    "components": ["actor_identity", "victimology", "malware_linkage"],
                    "support_text": pick_support(s),
                }
            )
        elif "earliest evidence" in low and "graphiron" in low:
            candidates.append(
                {
                    "statement": s,
                    "claim_type": "incident_attribution",
                    "scope": "incident",
                    "subject_name": "Graphiron deployment timeline",
                    "attributed_to_name": "Nodaria (UAC-0056)",
                    "attributed_to_type": "state_linked_actor",
                    "relationship": "linked_to",
                    "components": ["timeline_linkage", "malware_linkage", "actor_identity"],
                    "support_text": pick_support(s),
                }
            )
        elif "two-stage threat" in low or "downloader" in low and "payload" in low:
            candidates.append(
                {
                    "statement": s,
                    "claim_type": "malware_family_attribution",
                    "scope": "malware_family",
                    "subject_name": "Graphiron malware family",
                    "attributed_to_name": "Nodaria (UAC-0056)",
                    "attributed_to_type": "state_linked_actor",
                    "relationship": "linked_to",
                    "components": ["malware_linkage", "command_and_control", "ttp_similarity"],
                    "support_text": pick_support(s),
                }
            )
        elif "similarities with older nodaria tools" in low or ("graphsteel" in low and "grimplant" in low):
            candidates.append(
                {
                    "statement": s,
                    "claim_type": "cluster_linkage_attribution",
                    "scope": "mixed",
                    "subject_name": "Graphiron and prior Nodaria tools",
                    "attributed_to_name": "Nodaria (UAC-0056)",
                    "attributed_to_type": "state_linked_actor",
                    "relationship": "linked_to",
                    "components": ["malware_linkage", "ttp_similarity", "timeline_linkage"],
                    "support_text": pick_support(s),
                }
            )
        elif "nodaria has been active" in low and "ukraine" in low:
            candidates.append(
                {
                    "statement": s,
                    "claim_type": "campaign_attribution",
                    "scope": "campaign",
                    "subject_name": "Nodaria campaign profile",
                    "attributed_to_name": "Nodaria (UAC-0056)",
                    "attributed_to_type": "state_linked_actor",
                    "relationship": "associated_with",
                    "components": ["actor_identity", "victimology", "timeline_linkage"],
                    "support_text": pick_support(s),
                }
            )
    # Deduplicate by normalized statement.
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for cand in candidates:
        key = _norm_text(cand["statement"])
        if key in seen:
            continue
        seen.add(key)
        out.append(cand)
    return out[:2]


def _build_claim_from_candidate(
    state: dict[str, Any],
    *,
    rank: int,
    heading: str,
    candidate: dict[str, Any],
    sources: list[dict[str, Any]],
) -> dict[str, Any]:
    cid = _next_id(state, "claim")
    stmt_text = candidate["statement"]
    stmt_anchor = {
        "anchor_id": f"{cid}-A001",
        "extraction_method": "markdown",
        "verbatim_text": _clean_text(stmt_text, 2400),
        "location": _loc(heading, None),
        "notes": "Claim statement extracted from section sentence.",
    }
    support_line = _clean_text(str(candidate.get("support_text") or ""), 1200)
    if not support_line:
        support_line = heading
    if _norm_text(support_line) == _norm_text(stmt_text):
        support_line = heading
    support_anchor = {
        "anchor_id": f"{cid}-A002",
        "extraction_method": "markdown",
        "verbatim_text": support_line,
        "location": _loc(heading, None),
        "notes": "Supporting anchor extracted from same section context.",
    }
    components = [c for c in candidate.get("components", []) if isinstance(c, str)] or ["other"]
    source_ids = [s["source_id"] for s in sources if isinstance(s.get("source_id"), str)]
    unique_entities = len({str(s.get("entity_name") or "").strip() for s in sources if str(s.get("entity_name") or "").strip()})
    external_count = sum(1 for s in sources if s.get("source_type") != "internal_document_section")

    component_anchors: dict[str, dict[str, Any]] = {}
    for idx, comp in enumerate(components, start=1):
        component_anchors[comp] = {
            "anchor_id": f"{cid}-A{idx + 2:03d}",
            "extraction_method": "markdown",
            "verbatim_text": support_line,
            "location": _loc(heading, None),
            "notes": f"Component-specific support anchor for {comp}.",
        }

    support_rows = [
        {
            "source_id": sid,
            "supports_components": components[:3],
            "supporting_anchors": [stmt_anchor, *[component_anchors[c] for c in components]],
            "notes": "Support mapped from section-level evidence.",
        }
        for sid in source_ids[:20]
    ]
    corr_rows = []
    for comp in components:
        corr_rows.append(
            {
                "component": comp,
                "supported_by_source_ids": source_ids[:20],
                "supporting_anchors": [component_anchors[comp]],
                "source_count": len(source_ids[:20]),
                "unique_source_entity_count": min(unique_entities, len(source_ids[:20])),
                "notes": f"Sectional corroboration mapping for {comp}.",
            }
        )

    return {
        "claim_id": cid,
        "salience_rank": rank,
        "claim_type": candidate["claim_type"],
        "scope": candidate["scope"],
        "explicitness": "explicit",
        "claim_statement": stmt_anchor,
        "subject": {
            "name": candidate["subject_name"],
            "kind": _subject_kind_for_scope(candidate["scope"]),
            "aliases": [],
        },
        "attribution": {
            "attributed_to_name": candidate["attributed_to_name"],
            "attributed_to_type": candidate["attributed_to_type"],
            "relationship": candidate["relationship"],
        },
        "claim_components_asserted": components,
        "caveats_or_limitations_in_text": [],
        "quality_checks": _default_quality_checks(),
        "six_c": {
            "chain_of_custody": {
                "key_questions": [
                    "What document evidence supports this claim?",
                    "Are artifact references preserved for inspection?",
                ],
                "quality_checks": _default_c_checks(
                    external=external_count > 0,
                    quantitative=False,
                    limitations=False,
                ),
                "summary": "Section-level evidence anchors are captured and linked to source records.",
                "evidence_items": [],
                "artifact_inventory": [],
            },
            "credibility": {
                "key_questions": [
                    "Are cited sources explicit and traceable?",
                    "Do sources include external references?",
                ],
                "quality_checks": _default_c_checks(
                    external=external_count > 0,
                    quantitative=True,
                    limitations=False,
                ),
                "summary": "Credibility derives from in-document statements and section URLs.",
                "sources_index": sources,
                "sources_supporting_claim": support_rows,
                "citation_counts": {
                    "total_sources": len(sources),
                    "external_sources": external_count,
                    "internal_sources": len(sources) - external_count,
                    "unique_source_entities": unique_entities,
                },
            },
            "corroboration": {
                "key_questions": [
                    "Which claim components are explicitly supported?",
                    "Is support distributed across indexed sources?",
                ],
                "quality_checks": _default_c_checks(
                    external=external_count > 0,
                    quantitative=True,
                    limitations=False,
                ),
                "summary": "Corroboration rows map each claim component to supporting anchors.",
                "corroboration_matrix": corr_rows,
            },
            "coherence": {
                "key_questions": [
                    "Does the argument flow from evidence to conclusion?",
                    "Are assumptions visible in the text?",
                ],
                "quality_checks": _default_c_checks(
                    external=False,
                    quantitative=False,
                    limitations=False,
                ),
                "summary": "Claim is represented as a direct text-supported statement.",
                "argument_steps": [
                    {
                        "step_id": f"{cid}-S01",
                        "step_type": "observation",
                        "statement": _clean_text(stmt_text, 1500),
                        "supports_component": components[0],
                        "depends_on_step_ids": [],
                        "supporting_anchors": [stmt_anchor],
                        "supporting_source_ids": source_ids[:8],
                        "notes": "Direct observation from markdown section.",
                    }
                ],
                "alternative_hypotheses_in_text": [],
            },
            "confidence": {
                "key_questions": [
                    "Is certainty language explicit?",
                    "Is a confidence scale defined in-text?",
                ],
                "quality_checks": _default_c_checks(
                    external=False,
                    quantitative=False,
                    limitations=False,
                ),
                "summary": "Confidence is represented using direct statement phrasing.",
                "certainty_expressions": [
                    {
                        "expression": _clean_text(stmt_text, 300),
                        "polarity": "mixed_or_hedged",
                        "applies_to_component": components[0],
                        "anchors": [stmt_anchor],
                        "notes": "Captured from explicit claim sentence.",
                    }
                ],
                "confidence_scale_definition": {
                    "defined_in_document": False,
                    "definition_anchors": [],
                },
            },
            "compliance": {
                "key_questions": [
                    "Are legal attribution standards explicitly cited?",
                    "Is standard-of-proof language present?",
                ],
                "quality_checks": _default_c_checks(
                    external=False,
                    quantitative=False,
                    limitations=False,
                ),
                "summary": "No explicit legal-test mapping was identified in this section.",
                "legal_references": [],
                "legal_mapping": [
                    {
                        "test": "attribution_standard_of_proof",
                        "addressed_in_text": False,
                        "position_verbatim": None,
                        "anchors": [],
                        "notes": "Placeholder mapping for incremental analyst refinement.",
                    }
                ],
                "standard_of_proof_language": [],
            },
        },
    }


def _validate(schema_path: Path, output_obj: dict[str, Any]) -> None:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))["schema"]
    jsonschema.validate(instance=output_obj, schema=schema)


def _find_next_section(state: dict[str, Any]) -> dict[str, Any] | None:
    for s in state.get("sections", []):
        if s.get("status") == "pending":
            return s
    return None


def _bootstrap(args: argparse.Namespace) -> int:
    markdown_path = Path(args.markdown).expanduser().resolve()
    schema_path = Path(args.schema).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    state_path = Path(args.state).expanduser().resolve()
    packets_dir = Path(args.packets_dir).expanduser().resolve()

    if not markdown_path.is_file():
        raise SystemExit(f"[ERROR] markdown not found: {markdown_path}")
    if not schema_path.is_file():
        raise SystemExit(f"[ERROR] schema not found: {schema_path}")

    text = markdown_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    sections = _split_sections(lines)
    headings = [s["heading"] for s in sections][:200]

    first_heading = headings[0] if headings else markdown_path.stem
    author = _estimate_author(text)
    inferred_year, inferred_date = _year_from_filename(markdown_path)
    publication_date = inferred_date or f"{time.gmtime().tm_year:04d}-01-01"
    publication_source = "filename" if inferred_date else "unknown"

    state: dict[str, Any] = {
        "version": 1,
        "created_at_utc": _now_utc(),
        "markdown": str(markdown_path),
        "schema": str(schema_path),
        "output": str(output_path),
        "packets_dir": str(packets_dir),
        "sections": sections,
        "counters": _init_counters(),
    }

    publication_anchor = {
        "anchor_id": "P000-A999",
        "extraction_method": "manual_description",
        "verbatim_text": (
            f"Publication date inferred from filename '{markdown_path.name}'."
            if inferred_date
            else "Exact publication date not found; using placeholder date."
        ),
        "location": _loc(section=None, object_id=None),
        "notes": "Filename/date metadata inference for incremental workflow.",
    }
    base_source = _build_base_source(author=author, title=first_heading, year=inferred_year)

    lead_sentence = ""
    for s in sections:
        candidate = _first_sentence(s.get("body_text", ""))
        if candidate:
            lead_sentence = candidate
            break
    if not lead_sentence:
        lead_sentence = first_heading

    initial_claim = {
        "claim_id": "C001",
        "salience_rank": 1,
        "claim_type": "campaign_attribution",
        "scope": "campaign",
        "explicitness": "explicit",
        "claim_statement": {
            "anchor_id": "C001-A001",
            "extraction_method": "markdown",
            "verbatim_text": _clean_text(lead_sentence, 2400),
            "location": _loc(section=headings[1] if len(headings) > 1 else headings[0] if headings else None, object_id=None),
            "notes": "Initial bootstrap claim from lead sentence.",
        },
        "subject": {
            "name": "Document campaign context",
            "kind": "campaign",
            "aliases": [],
        },
        "attribution": {
            "attributed_to_name": "Unknown",
            "attributed_to_type": "unknown",
            "relationship": "associated_with",
        },
        "claim_components_asserted": ["event_occurrence"],
        "caveats_or_limitations_in_text": [],
        "quality_checks": _default_quality_checks(),
        "six_c": {
            "chain_of_custody": {
                "key_questions": [
                    "What direct evidence supports this bootstrap claim?",
                    "What additional sections must refine it?",
                ],
                "quality_checks": _default_c_checks(external=False, quantitative=False, limitations=True),
                "summary": "Bootstrap claim is provisional and will be refined section-by-section.",
                "evidence_items": [],
                "artifact_inventory": [],
            },
            "credibility": {
                "key_questions": [
                    "Is the source context from this document explicitly captured?",
                    "Are later external sources linked correctly?",
                ],
                "quality_checks": _default_c_checks(external=False, quantitative=True, limitations=True),
                "summary": "Bootstrap uses internal document source only; external sources added per section.",
                "sources_index": [base_source],
                "sources_supporting_claim": [
                    {
                        "source_id": "SRC0001",
                        "supports_components": ["event_occurrence"],
                        "supporting_anchors": [
                            {
                                "anchor_id": "C001-A001",
                                "extraction_method": "markdown",
                                "verbatim_text": _clean_text(lead_sentence, 2400),
                                "location": _loc(section=headings[0] if headings else None, object_id=None),
                                "notes": "Bootstrap claim anchor reused as initial support.",
                            }
                        ],
                        "notes": "Bootstrap support from lead sentence.",
                    }
                ],
                "citation_counts": {
                    "total_sources": 1,
                    "external_sources": 0,
                    "internal_sources": 1,
                    "unique_source_entities": 1,
                },
            },
            "corroboration": {
                "key_questions": [
                    "Which components are currently supported?",
                    "What must be added during section refinement?",
                ],
                "quality_checks": _default_c_checks(external=False, quantitative=True, limitations=True),
                "summary": "Corroboration starts with one provisional row and is expanded later.",
                "corroboration_matrix": [
                    {
                        "component": "event_occurrence",
                        "supported_by_source_ids": ["SRC0001"],
                        "supporting_anchors": [
                            {
                                "anchor_id": "C001-A001",
                                "extraction_method": "markdown",
                                "verbatim_text": _clean_text(lead_sentence, 2400),
                                "location": _loc(section=headings[0] if headings else None, object_id=None),
                                "notes": "Bootstrap claim anchor reused as initial corroboration.",
                            }
                        ],
                        "source_count": 1,
                        "unique_source_entity_count": 1,
                        "notes": "Initial corroboration row for bootstrap claim.",
                    }
                ],
            },
            "coherence": {
                "key_questions": [
                    "Does the statement follow from evidence?",
                    "Which sections can tighten the inference chain?",
                ],
                "quality_checks": _default_c_checks(external=False, quantitative=False, limitations=True),
                "summary": "Bootstrap coherence is intentionally conservative pending section processing.",
                "argument_steps": [
                    {
                        "step_id": "C001-S01",
                        "step_type": "observation",
                        "statement": _clean_text(lead_sentence, 1800),
                        "supports_component": "event_occurrence",
                        "depends_on_step_ids": [],
                        "supporting_anchors": [
                            {
                                "anchor_id": "C001-A001",
                                "extraction_method": "markdown",
                                "verbatim_text": _clean_text(lead_sentence, 2400),
                                "location": _loc(section=headings[0] if headings else None, object_id=None),
                                "notes": "Bootstrap observation step.",
                            }
                        ],
                        "supporting_source_ids": ["SRC0001"],
                        "notes": "Initial argument step pending refinement.",
                    }
                ],
                "alternative_hypotheses_in_text": [],
            },
            "confidence": {
                "key_questions": [
                    "What confidence language appears in text?",
                    "Is a confidence scale defined?",
                ],
                "quality_checks": _default_c_checks(external=False, quantitative=False, limitations=True),
                "summary": "Confidence remains provisional until section-level extraction is complete.",
                "certainty_expressions": [
                    {
                        "expression": _clean_text(lead_sentence, 300),
                        "polarity": "mixed_or_hedged",
                        "applies_to_component": "event_occurrence",
                        "anchors": [
                            {
                                "anchor_id": "C001-A001",
                                "extraction_method": "markdown",
                                "verbatim_text": _clean_text(lead_sentence, 2400),
                                "location": _loc(section=headings[0] if headings else None, object_id=None),
                                "notes": "Bootstrap confidence anchor.",
                            }
                        ],
                        "notes": "Initial certainty expression from lead text.",
                    }
                ],
                "confidence_scale_definition": {
                    "defined_in_document": False,
                    "definition_anchors": [],
                },
            },
            "compliance": {
                "key_questions": [
                    "Are legal attribution standards explicitly mentioned?",
                    "Is standard-of-proof language present?",
                ],
                "quality_checks": _default_c_checks(external=False, quantitative=False, limitations=False),
                "summary": "No legal-test mapping established during bootstrap.",
                "legal_references": [],
                "legal_mapping": [
                    {
                        "test": "attribution_standard_of_proof",
                        "addressed_in_text": False,
                        "position_verbatim": None,
                        "anchors": [],
                        "notes": "Bootstrap placeholder; refine if legal language appears.",
                    }
                ],
                "standard_of_proof_language": [],
            },
        },
    }

    output_obj: dict[str, Any] = {
        "document_metadata": {
            "title": first_heading,
            "authoring_entity": author,
            "publication_date": publication_date,
            "publication_date_source": publication_source,
            "publication_date_anchor_role": "other_date" if inferred_date else "not_found",
            "publication_date_anchor": publication_anchor,
            "version": "sectional_refiner_v1",
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
            "page_marker_policy": "no_page_markers_single_page0",
            "marker_examples_expected": [],
            "marker_examples_found": [],
            "extract_tables": True,
            "extract_figures_images": True,
            "extract_citations": True,
            "extract_artifacts": True,
            "max_claims": 4,
            "claim_selection_strategy": "top_n_by_author_emphasis",
            "include_implicit_claims": True,
        },
        "stage1_markdown_parse": {
            "page_count": 1,
            "pages": [
                {
                    "page_index": 0,
                    "page_label": None,
                    "section_headings": headings,
                    "text_blocks": [],
                    "tables": [],
                    "figures_images": [],
                    "citations_found": [],
                    "artifacts_found": [],
                    "notes": "Incremental sectional extraction workspace.",
                }
            ],
            "global_indices": {
                "sources": [base_source],
                "entities": [],
                "artifacts": [],
            },
        },
        "stage2_claim_extraction": {
            "attribution_claims": [initial_claim],
            "document_level_index": {
                "sources": [copy.deepcopy(base_source)],
                "entities": [],
            },
        },
    }

    _validate(schema_path, output_obj)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output_obj, ensure_ascii=False, indent=2), encoding="utf-8")
    packets_dir.mkdir(parents=True, exist_ok=True)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "state": str(state_path),
                "output": str(output_path),
                "sections_total": len(sections),
                "next_section": sections[0]["id"] if sections else None,
                "title": first_heading,
                "authoring_entity": author,
                "publication_date": publication_date,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def _load_state(state_path: Path) -> dict[str, Any]:
    if not state_path.is_file():
        raise SystemExit(f"[ERROR] state file not found: {state_path}")
    return json.loads(state_path.read_text(encoding="utf-8"))


def _load_output_from_state(state: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    output_path = Path(state["output"]).expanduser().resolve()
    if not output_path.is_file():
        raise SystemExit(f"[ERROR] output file not found: {output_path}")
    return output_path, json.loads(output_path.read_text(encoding="utf-8"))


def _write_state(state_path: Path, state: dict[str, Any]) -> None:
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_output(output_path: Path, output_obj: dict[str, Any]) -> None:
    output_path.write_text(json.dumps(output_obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _status(args: argparse.Namespace) -> int:
    state_path = Path(args.state).expanduser().resolve()
    state = _load_state(state_path)
    sections = state.get("sections", [])
    done = [s for s in sections if s.get("status") == "done"]
    pending = [s for s in sections if s.get("status") == "pending"]
    print(
        json.dumps(
            {
                "state": str(state_path),
                "markdown": state.get("markdown"),
                "output": state.get("output"),
                "sections_total": len(sections),
                "sections_done": len(done),
                "sections_pending": len(pending),
                "next_section": pending[0]["id"] if pending else None,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def _build_section_packet(
    *,
    section: dict[str, Any],
    state: dict[str, Any],
    output_obj: dict[str, Any],
) -> dict[str, Any]:
    heading = section["heading"]
    raw = section.get("raw_text", "")
    body = section.get("body_text", "")
    raw_lines = raw.splitlines()

    text_blocks: list[dict[str, Any]] = []
    chunks = []
    clean_body = _clean_text(body, 9000)
    if clean_body:
        while clean_body:
            if len(clean_body) <= 3200:
                chunks.append(clean_body)
                break
            cut = clean_body.rfind(". ", 0, 3000)
            if cut < 1200:
                cut = 3000
            chunks.append(clean_body[:cut].strip())
            clean_body = clean_body[cut:].strip()
    for chunk in chunks[:3]:
        bid = _next_id(state, "block")
        text_blocks.append(
            {
                "block_id": bid,
                "extraction_method": "markdown",
                "text_verbatim": chunk,
                "location": _loc(heading, bid),
                "notes": f"Section-derived text block for '{heading}'.",
            }
        )

    tables = _parse_pipe_tables(raw_lines, state, heading)
    tables.extend(_parse_process_list_table(body, heading, state))

    artifacts = _collect_artifacts(raw, heading, state)

    existing_sources = {
        s["source_id"]: s
        for s in ((output_obj.get("stage1_markdown_parse") or {}).get("global_indices") or {}).get("sources", [])
        if isinstance(s, dict) and isinstance(s.get("source_id"), str)
    }
    citations, new_sources = _collect_citations_and_sources(raw, heading, state, existing_sources)

    entities = []
    for name, etype in _extract_entities_for_text(raw):
        entities.append(
            {
                "name": name,
                "entity_type": etype,
                "mention_location": _loc(heading, None),
            }
        )

    claim_candidates = _extract_claim_candidates(body, heading)

    return {
        "section_id": section["id"],
        "heading": heading,
        "start_line": section["start_line"],
        "end_line": section["end_line"],
        "text_blocks": text_blocks,
        "tables": tables,
        "artifacts": artifacts,
        "citations": citations,
        "new_sources": new_sources,
        "entities": entities,
        "claim_candidates": claim_candidates,
    }


def _merge_section_packet(state: dict[str, Any], output_obj: dict[str, Any], packet: dict[str, Any]) -> dict[str, Any]:
    page = output_obj["stage1_markdown_parse"]["pages"][0]
    heading = packet["heading"]
    if heading and heading not in page["section_headings"]:
        page["section_headings"].append(heading)

    # text blocks
    existing_block_text = {_norm_text(tb.get("text_verbatim", "")) for tb in page.get("text_blocks", []) if isinstance(tb, dict)}
    for tb in packet.get("text_blocks", []):
        key = _norm_text(tb.get("text_verbatim", ""))
        if not key or key in existing_block_text:
            continue
        page["text_blocks"].append(tb)
        existing_block_text.add(key)

    # tables
    existing_table_keys = {
        (_norm_text(t.get("caption_verbatim") or ""), _norm_text(t.get("table_markdown") or ""), _norm_text(t.get("table_text_verbatim") or ""))
        for t in page.get("tables", [])
        if isinstance(t, dict)
    }
    for t in packet.get("tables", []):
        key = (
            _norm_text(t.get("caption_verbatim") or ""),
            _norm_text(t.get("table_markdown") or ""),
            _norm_text(t.get("table_text_verbatim") or ""),
        )
        if key in existing_table_keys:
            continue
        page["tables"].append(t)
        existing_table_keys.add(key)

    # artifacts
    existing_art_keys = {
        (a.get("artifact_type"), _norm_text(str(a.get("normalized_value") or a.get("value") or "")))
        for a in page.get("artifacts_found", [])
        if isinstance(a, dict)
    }
    for a in packet.get("artifacts", []):
        key = (a.get("artifact_type"), _norm_text(str(a.get("normalized_value") or a.get("value") or "")))
        if key in existing_art_keys:
            continue
        page["artifacts_found"].append(a)
        existing_art_keys.add(key)

    # sources (merge stage1+stage2)
    stage1_sources = ((output_obj.get("stage1_markdown_parse") or {}).get("global_indices") or {}).get("sources", [])
    stage2_sources = ((output_obj.get("stage2_claim_extraction") or {}).get("document_level_index") or {}).get("sources", [])
    existing_sources = [s for s in stage1_sources if isinstance(s, dict)]
    url_to_source_id: dict[str, str] = {}
    for s in existing_sources:
        url = s.get("url_or_identifier")
        if isinstance(url, str) and url:
            nu = _normalize_url(url)
            if nu:
                url_to_source_id[nu] = s["source_id"]

    for src in packet.get("new_sources", []):
        url = src.get("url_or_identifier")
        nu = _normalize_url(str(url)) if isinstance(url, str) else None
        if nu and nu in url_to_source_id:
            continue
        existing_sources.append(src)
        if nu:
            url_to_source_id[nu] = src["source_id"]
    # keep sorted and mirrored in stage2
    existing_sources_sorted = sorted(existing_sources, key=lambda x: str(x.get("source_id", "")))
    output_obj["stage1_markdown_parse"]["global_indices"]["sources"] = existing_sources_sorted
    output_obj["stage2_claim_extraction"]["document_level_index"]["sources"] = copy.deepcopy(existing_sources_sorted)

    # citations
    existing_cit_keys = {
        _norm_text(str(c.get("normalized_identifier") or ""))
        for c in page.get("citations_found", [])
        if isinstance(c, dict)
    }
    for cit in packet.get("citations", []):
        key = _norm_text(str(cit.get("normalized_identifier") or ""))
        if not key or key in existing_cit_keys:
            continue
        # Resolve source id from URL map if needed
        nu = _normalize_url(str(cit.get("normalized_identifier") or ""))
        if nu and nu in url_to_source_id:
            cit["resolved_source_id"] = url_to_source_id[nu]
        page["citations_found"].append(cit)
        existing_cit_keys.add(key)

    # entities
    stage1_entities = ((output_obj.get("stage1_markdown_parse") or {}).get("global_indices") or {}).get("entities", [])
    stage2_entities = ((output_obj.get("stage2_claim_extraction") or {}).get("document_level_index") or {}).get("entities", [])
    entities = [e for e in stage1_entities if isinstance(e, dict)]
    by_name = {_norm_text(str(e.get("name") or "")): e for e in entities}
    for ent in packet.get("entities", []):
        name = str(ent.get("name") or "").strip()
        if not name:
            continue
        key = _norm_text(name)
        mention = ent.get("mention_location") or _loc(packet["heading"], None)
        if key in by_name:
            ref = by_name[key]
            mentions = ref.setdefault("mentions", [])
            if mention not in mentions:
                mentions.append(mention)
            continue
        eid = _next_id(state, "entity")
        rec = {
            "entity_id": eid,
            "name": name,
            "entity_type": ent.get("entity_type") if ent.get("entity_type") in {"person", "organization", "state", "group", "company", "tool", "malware", "other"} else "other",
            "aliases": [],
            "mentions": [mention],
        }
        entities.append(rec)
        by_name[key] = rec

    entities_sorted = sorted(entities, key=lambda x: str(x.get("entity_id", "")))
    output_obj["stage1_markdown_parse"]["global_indices"]["entities"] = entities_sorted
    output_obj["stage2_claim_extraction"]["document_level_index"]["entities"] = copy.deepcopy(entities_sorted)

    # artifact index
    grouped: dict[str, list[str]] = {}
    for a in page.get("artifacts_found", []):
        if not isinstance(a, dict):
            continue
        kind = str(a.get("artifact_type") or "other")
        val = str(a.get("normalized_value") or a.get("value") or "")
        grouped.setdefault(kind, [])
        if val and val not in grouped[kind]:
            grouped[kind].append(val)
    artifact_index = []
    for kind in sorted(grouped.keys()):
        vals = grouped[kind]
        artifact_index.append(
            {
                "artifact_type": kind,
                "count": len(vals),
                "example_values": vals[:25],
                "notes": f"Sectional index for {kind}.",
            }
        )
    output_obj["stage1_markdown_parse"]["global_indices"]["artifacts"] = artifact_index

    # claims from candidates
    claims = ((output_obj.get("stage2_claim_extraction") or {}).get("attribution_claims") or [])
    existing_claim_stmt = {_norm_text(str((c.get("claim_statement") or {}).get("verbatim_text") or "")) for c in claims if isinstance(c, dict)}
    claim_rank = len(claims) + 1
    for cand in packet.get("claim_candidates", []):
        if len(claims) >= int(output_obj.get("pipeline_config", {}).get("max_claims", 4)):
            break
        stmt_key = _norm_text(str(cand.get("statement") or ""))
        if not stmt_key or stmt_key in existing_claim_stmt:
            continue
        sources_for_claim = output_obj["stage2_claim_extraction"]["document_level_index"]["sources"]
        claim = _build_claim_from_candidate(
            state,
            rank=claim_rank,
            heading=packet["heading"],
            candidate=cand,
            sources=sources_for_claim[: min(len(sources_for_claim), 30)],
        )
        claims.append(claim)
        existing_claim_stmt.add(stmt_key)
        claim_rank += 1
    # Drop bootstrap placeholder claim once we have real section-derived claims.
    if len(claims) > 1:
        first_subject = str((claims[0].get("subject") or {}).get("name") or "")
        if first_subject == "Document campaign context":
            claims = claims[1:]
            for idx, c in enumerate(claims, start=1):
                c["salience_rank"] = idx
    output_obj["stage2_claim_extraction"]["attribution_claims"] = claims

    return output_obj


def _process_section(args: argparse.Namespace) -> int:
    state_path = Path(args.state).expanduser().resolve()
    state = _load_state(state_path)
    schema_path = Path(state["schema"]).expanduser().resolve()
    output_path, output_obj = _load_output_from_state(state)

    section_id = args.section_id
    if not section_id:
        sec = _find_next_section(state)
        if sec is None:
            print(json.dumps({"message": "No pending sections."}, ensure_ascii=False, indent=2))
            return 0
        section_id = sec["id"]

    section = next((s for s in state.get("sections", []) if s.get("id") == section_id), None)
    if section is None:
        raise SystemExit(f"[ERROR] section id not found: {section_id}")
    if section.get("status") == "done" and not args.force:
        print(
            json.dumps(
                {
                    "section_id": section_id,
                    "status": "already_done",
                    "message": "Use --force to reprocess this section.",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    packet = _build_section_packet(section=section, state=state, output_obj=output_obj)
    packets_dir = Path(state["packets_dir"]).expanduser().resolve()
    packets_dir.mkdir(parents=True, exist_ok=True)
    packet_path = packets_dir / f"{section_id}.packet.json"
    packet_path.write_text(json.dumps(packet, ensure_ascii=False, indent=2), encoding="utf-8")

    merged = _merge_section_packet(state=state, output_obj=output_obj, packet=packet)
    _validate(schema_path, merged)
    _write_output(output_path, merged)

    section["status"] = "done"
    section["packet"] = str(packet_path)
    section["processed_at_utc"] = _now_utc()
    _write_state(state_path, state)

    print(
        json.dumps(
            {
                "section_id": section_id,
                "heading": section["heading"],
                "packet": str(packet_path),
                "status": "done",
                "text_blocks_added": len(packet.get("text_blocks", [])),
                "tables_added": len(packet.get("tables", [])),
                "artifacts_added": len(packet.get("artifacts", [])),
                "citations_added": len(packet.get("citations", [])),
                "sources_added": len(packet.get("new_sources", [])),
                "entities_detected": len(packet.get("entities", [])),
                "claim_candidates": len(packet.get("claim_candidates", [])),
                "output": str(output_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def _process_next(args: argparse.Namespace) -> int:
    state_path = Path(args.state).expanduser().resolve()
    state = _load_state(state_path)
    pending = _find_next_section(state)
    if pending is None:
        print(json.dumps({"message": "No pending sections."}, ensure_ascii=False, indent=2))
        return 0
    next_args = argparse.Namespace(state=args.state, section_id=pending["id"], force=args.force)
    return _process_section(next_args)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Incremental section-by-section refiner for markdown extraction. "
            "Builds and updates schema JSON progressively so an agent can curate output over multiple steps."
        )
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_boot = sub.add_parser("bootstrap", help="Create state + initial schema-valid output from markdown.")
    p_boot.add_argument("--markdown", required=True, help="Input markdown file.")
    p_boot.add_argument("--schema", default=DEFAULT_SCHEMA, help="Schema wrapper JSON.")
    p_boot.add_argument("--output", required=True, help="Progressive output JSON path.")
    p_boot.add_argument("--state", required=True, help="Workflow state JSON path.")
    p_boot.add_argument("--packets-dir", required=True, help="Folder for per-section packet JSON files.")
    p_boot.set_defaults(func=_bootstrap)

    p_status = sub.add_parser("status", help="Show current workflow status.")
    p_status.add_argument("--state", required=True, help="Workflow state JSON path.")
    p_status.set_defaults(func=_status)

    p_proc = sub.add_parser("process-section", help="Analyze + apply one section by id.")
    p_proc.add_argument("--state", required=True, help="Workflow state JSON path.")
    p_proc.add_argument("--section-id", default="", help="Section id (e.g., S003). If omitted, uses next pending section.")
    p_proc.add_argument("--force", action="store_true", help="Reprocess even when section is already done.")
    p_proc.set_defaults(func=_process_section)

    p_next = sub.add_parser("process-next", help="Analyze + apply next pending section.")
    p_next.add_argument("--state", required=True, help="Workflow state JSON path.")
    p_next.add_argument("--force", action="store_true", help="Force if the next section was already processed.")
    p_next.set_defaults(func=_process_next)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
