from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ._common import default_result, ensure_result_shape, normalize_path
from .tool_footnotes import run as run_footnotes


_SUP_MAP = {
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
    "⁰": "0",
}
_SUP_RE = re.compile(r"[¹²³⁴⁵⁶⁷⁸⁹⁰]{1,6}")
_TEX_RE = re.compile(r"\$(?:\s*\{\s*\}\s*)?\^\{\s*(\d{1,4})\s*\}\$")
_BARE_TEX_RE = re.compile(r"\^\{\s*(\d{1,4})\s*\}")
_NUM_LINE_RE = re.compile(r"^\s*(\d{1,4})\s*(?:[.)]|[-–—])?\s+(.*\S)\s*$")
_SUP_LINE_RE = re.compile(r"^\s*([¹²³⁴⁵⁶⁷⁸⁹⁰]{1,6})\s+(.*\S)\s*$")
_MD_PAGE_MARK_RE = re.compile(r"^\s*<!--\s*page:\s*(\d+)\s*-->\s*$", re.IGNORECASE)


def _sup_to_int(s: str) -> int | None:
    raw = "".join(_SUP_MAP.get(ch, ch) for ch in (s or ""))
    if raw.isdigit():
        return int(raw)
    return None


def _read_pages_from_cache(cache_path: str) -> list[str]:
    p = Path(cache_path).expanduser().resolve()
    if not p.is_file():
        return []
    try:
        obj = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []
    pages = obj.get("pages_text")
    if not isinstance(pages, list):
        return []
    out: list[str] = []
    for page in pages:
        if isinstance(page, str):
            out.append(page)
    return out


def _split_markdown_pages(md_text: str) -> list[str]:
    lines = (md_text or "").splitlines()
    chunks: list[list[str]] = []
    current: list[str] = []
    saw_marker = False

    for line in lines:
        if _MD_PAGE_MARK_RE.match(line):
            saw_marker = True
            if current:
                chunks.append(current)
                current = []
            continue
        current.append(line)
    if current:
        chunks.append(current)

    if saw_marker and chunks:
        return ["\n".join(chunk).strip() for chunk in chunks]
    return [md_text]


def _scan_page_markers(page_text: str) -> list[int]:
    found: list[int] = []
    for m in _SUP_RE.finditer(page_text or ""):
        idx = _sup_to_int(m.group(0))
        if idx is not None:
            found.append(idx)
    for m in _TEX_RE.finditer(page_text or ""):
        found.append(int(m.group(1)))
    for m in _BARE_TEX_RE.finditer(page_text or ""):
        found.append(int(m.group(1)))
    return found


def _scan_page_defs(page_text: str) -> dict[int, str]:
    items: dict[int, str] = {}
    for line in (page_text or "").splitlines():
        m = _NUM_LINE_RE.match(line)
        if m:
            items[int(m.group(1))] = m.group(2).strip()
            continue
        m2 = _SUP_LINE_RE.match(line)
        if m2:
            idx = _sup_to_int(m2.group(1))
            if idx is not None:
                items[idx] = m2.group(2).strip()
    return items


def _fitz_extract_page_texts(pdf_path: str) -> list[str]:
    try:
        import fitz  # type: ignore
    except Exception:
        return []
    p = Path(pdf_path).expanduser().resolve()
    if not p.is_file():
        return []
    out: list[str] = []
    try:
        doc = fitz.open(str(p))
    except Exception:
        return []
    for page in doc:
        try:
            out.append(page.get_text("text") or "")
        except Exception:
            out.append("")
    return out


def _as_int_list(x: Any) -> list[int]:
    out: list[int] = []
    if not isinstance(x, list):
        return out
    for v in x:
        try:
            out.append(int(v))
        except Exception:
            continue
    return sorted(set(out))


def _build_page_report(pages: list[str], missing_for_seen: set[int]) -> list[dict[str, Any]]:
    report: list[dict[str, Any]] = []
    for i, txt in enumerate(pages):
        markers = _scan_page_markers(txt)
        defs = _scan_page_defs(txt)
        marker_set = set(markers)
        report.append(
            {
                "page_index": i,
                "intext_markers_count": len(markers),
                "unique_intext_indices": sorted(marker_set),
                "footnote_defs_count": len(defs),
                "footnote_def_indices": sorted(defs.keys()),
                "missing_for_seen_present_on_page": sorted(marker_set.intersection(missing_for_seen)),
            }
        )
    return report


def _recover_missing(
    missing_indices: list[int],
    pages_md: list[str],
    pages_pdf: list[str],
) -> tuple[dict[int, str], list[dict[str, Any]]]:
    recovered: dict[int, str] = {}
    traces: list[dict[str, Any]] = []
    md_defs_by_page = [_scan_page_defs(p) for p in pages_md]
    pdf_defs_by_page = [_scan_page_defs(p) for p in pages_pdf]

    for idx in missing_indices:
        hit = None
        for page_i, defs in enumerate(md_defs_by_page):
            if idx in defs and defs[idx].strip():
                hit = ("markdown", page_i, defs[idx].strip())
                break
        if hit is None:
            for page_i, defs in enumerate(pdf_defs_by_page):
                if idx in defs and defs[idx].strip():
                    hit = ("pdf_text", page_i, defs[idx].strip())
                    break
        if hit is not None:
            src, page_i, text = hit
            recovered[idx] = text
            traces.append(
                {
                    "index": idx,
                    "source": src,
                    "page_index": page_i,
                    "text_preview": text[:240],
                }
            )
    return recovered, traces


def _recompute_stats(items: dict[str, Any], intext: list[dict[str, Any]], style: str = "footnotes") -> dict[str, Any]:
    seen = []
    success_occ = 0
    success_unique = set()
    for r in intext:
        idx_raw = str(r.get("index") or "").strip()
        if not idx_raw.isdigit():
            continue
        idx = int(idx_raw)
        seen.append(idx)
        foot = r.get("footnote")
        if isinstance(foot, str) and foot.strip():
            success_occ += 1
            success_unique.add(idx)
        elif isinstance(foot, dict) and foot:
            success_occ += 1
            success_unique.add(idx)
    seen_set = set(seen)
    max_seen = max(seen_set) if seen_set else 0
    expected = set(range(1, max_seen)) if max_seen > 1 else set()
    item_keys = {int(k) for k in items.keys() if str(k).isdigit()}
    missing_intext_indices = sorted(expected - seen_set)
    missing_foot_for_seen = sorted(x for x in seen_set if x not in item_keys)
    uncited = sorted(x for x in item_keys if x not in seen_set)
    intext_total = len(intext)
    bib_total = len(item_keys)
    occ_rate = (success_occ / intext_total) if intext_total else 0.0
    bib_cov = (len(success_unique) / bib_total) if bib_total else 0.0
    return {
        "intext_total": intext_total,
        "success_occurrences": success_occ,
        "success_unique": len(success_unique),
        "bib_unique_total": bib_total,
        "occurrence_match_rate": occ_rate,
        "bib_coverage_rate": bib_cov,
        "success_percentage": round(occ_rate * 100.0, 2),
        "missing_intext_expected_total": len(missing_intext_indices),
        "missing_intext_indices": missing_intext_indices,
        "highest_intext_index": max_seen,
        "missing_footnotes_for_seen_total": len(missing_foot_for_seen),
        "missing_footnotes_for_seen_intext": missing_foot_for_seen,
        "uncited_footnote_total": len(uncited),
        "uncited_footnote_indices": uncited,
        "style": style,
    }


def run(
    *,
    markdown_path: str = "",
    pdf_path: str = "",
    cache_path: str = "",
    citations: Any = None,
    state_dir: str = "",
) -> dict[str, Any]:
    result = default_result()
    if not markdown_path:
        result["errors"].append("markdown_path is required")
        return ensure_result_shape(result)

    md_path = Path(markdown_path).expanduser().resolve()
    if not md_path.is_file():
        result["errors"].append(f"markdown file not found: {md_path}")
        return ensure_result_shape(result)
    md_text = md_path.read_text(encoding="utf-8", errors="replace")

    linked = citations if isinstance(citations, dict) else None
    if linked is None:
        r = run_footnotes(markdown_path=str(md_path))
        if r.get("status") != "ok":
            result["errors"].extend(r.get("errors") or ["footnotes parsing failed"])
            return ensure_result_shape(result)
        linked = ((r.get("data") or {}).get("linked") or {})
    if not isinstance(linked, dict):
        result["errors"].append("citations payload is not an object")
        return ensure_result_shape(result)

    foot = linked.get("footnotes") if isinstance(linked.get("footnotes"), dict) else {}
    items = foot.get("items") if isinstance(foot.get("items"), dict) else {}
    intext = foot.get("intext") if isinstance(foot.get("intext"), list) else []
    stats = foot.get("stats") if isinstance(foot.get("stats"), dict) else {}

    missing_for_seen = set(_as_int_list(stats.get("missing_footnotes_for_seen_intext")))
    missing_intext = set(_as_int_list(stats.get("missing_intext_indices")))

    pages_md = _read_pages_from_cache(cache_path) if cache_path else []
    if not pages_md:
        pages_md = _split_markdown_pages(md_text)
    pages_pdf = _fitz_extract_page_texts(pdf_path) if pdf_path else []

    page_source = "markdown"
    page_inputs = pages_md
    if len(page_inputs) <= 1 and pages_pdf:
        page_source = "pdf_text"
        page_inputs = pages_pdf
    page_report = _build_page_report(page_inputs, missing_for_seen)
    for item in page_report:
        item["source"] = page_source
    recover_targets = sorted(missing_for_seen)
    recovered_items, recover_trace = _recover_missing(recover_targets, pages_md, pages_pdf)

    patched_items = dict(items)
    for k, v in recovered_items.items():
        patched_items[str(k)] = v

    patched_intext: list[dict[str, Any]] = []
    for r in intext:
        if not isinstance(r, dict):
            continue
        rr = dict(r)
        idx = str(rr.get("index") or "").strip()
        if idx.isdigit() and idx in patched_items and not rr.get("footnote"):
            rr["footnote"] = patched_items[idx]
        patched_intext.append(rr)

    patched_stats = _recompute_stats(patched_items, patched_intext, style=str(stats.get("style") or "footnotes"))
    patched_foot = dict(foot)
    patched_foot["items"] = dict(sorted(patched_items.items(), key=lambda kv: int(kv[0]) if str(kv[0]).isdigit() else 999999))
    patched_foot["intext"] = patched_intext
    patched_foot["stats"] = patched_stats
    patched_linked = dict(linked)
    patched_linked["footnotes"] = patched_foot

    unresolved_after = _as_int_list(patched_stats.get("missing_footnotes_for_seen_intext"))
    missing_intext_after = _as_int_list(patched_stats.get("missing_intext_indices"))

    inconsistencies = {
        "before": {
            "missing_footnotes_for_seen_intext": sorted(missing_for_seen),
            "missing_intext_indices": sorted(missing_intext),
            "footnotes_items_count": len(items),
            "footnotes_intext_count": len(intext),
            "success_percentage": float(stats.get("success_percentage") or 0.0),
        },
        "after": {
            "missing_footnotes_for_seen_intext": unresolved_after,
            "missing_intext_indices": missing_intext_after,
            "footnotes_items_count": len(patched_items),
            "footnotes_intext_count": len(patched_intext),
            "success_percentage": float(patched_stats.get("success_percentage") or 0.0),
        },
        "recovered_indices": sorted(recovered_items.keys()),
        "recovered_count": len(recovered_items),
    }

    audit = {
        "markdown_path": str(md_path),
        "pdf_path": normalize_path(pdf_path) if pdf_path else "",
        "cache_path": normalize_path(cache_path) if cache_path else "",
        "inconsistencies": inconsistencies,
        "page_validation": page_report,
        "page_validation_source": page_source,
        "recovery_trace": recover_trace,
        "notes": [
            "Deterministic page-level audit of footnotes and in-text citations.",
            "Recovered values are sourced from markdown pages first, then raw PDF page text extraction.",
        ],
    }

    out_dir = Path(state_dir).expanduser().resolve() / "outputs" if state_dir else md_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    audit_path = out_dir / f"{md_path.stem}.consistency_audit.json"
    patched_citations_path = out_dir / f"{md_path.stem}.citations.patched.json"
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    patched_citations_path.write_text(json.dumps(patched_linked, ensure_ascii=False, indent=2), encoding="utf-8")

    result["metrics"] = {
        "recovered_indices_count": len(recovered_items),
        "missing_footnotes_before": len(missing_for_seen),
        "missing_footnotes_after": len(unresolved_after),
        "missing_intext_before": len(missing_intext),
        "missing_intext_after": len(missing_intext_after),
        "success_percentage_before": float(stats.get("success_percentage") or 0.0),
        "success_percentage_after": float(patched_stats.get("success_percentage") or 0.0),
    }
    result["artifacts_written"] = [str(audit_path), str(patched_citations_path)]
    result["data"] = {"audit": audit, "patched_citations": patched_linked}
    result["outputs"] = {
        "consistency_audit_path": str(audit_path),
        "citations": patched_linked,
        "citations_path": str(patched_citations_path),
    }
    result["context_updates"] = dict(result["outputs"])

    if len(unresolved_after) > 0:
        result["warnings"].append(
            f"{len(unresolved_after)} unresolved in-text indices remain after deterministic recovery."
        )
    return ensure_result_shape(result)
