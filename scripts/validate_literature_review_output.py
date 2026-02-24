#!/usr/bin/env python3
"""
Validate a generated literature review package.

Checks include:
- HTML structure and required section headings
- Placeholder leakage
- Footnote citation link integrity
- Bibliography presence/basic quality
- Cross-checks against context JSON and traceability CSV
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any


PLACEHOLDER_PATTERNS = [
    r"\[Not Specified\]",
    r"\[.*?failed.*?\]",
    r"\[.*?could not be generated.*?\]",
    r"\[No themes generated.*?\]",
    r"\[No content generated.*?\]",
    r"\[No inclusion criteria specified\]",
    r"\[No exclusion criteria specified\]",
]


def add_issue(bucket: list[dict[str, str]], check: str, message: str) -> None:
    bucket.append({"check": check, "message": message})


def find_required_headings(html: str) -> dict[str, bool]:
    checks: dict[str, str] = {
        "abstract": r"<h2>\s*Abstract\s*</h2>",
        "intro": r"<h2>\s*1\.\s*Introduction\s*</h2>",
        "methodology": r"<h2>\s*2\.\s*Methodology\s*</h2>",
        "findings": r"<h2>\s*3\.\s*Literature Review Findings\s*</h2>",
        "conclusion": r"<h2>\s*(?:\d+\.\s*)?Conclusion\s*</h2>",
        "limitations": r"<h2>\s*(?:\d+\.\s*)?Limitations\s*</h2>",
        "notes": r"<h2>\s*Notes\s*</h2>",
        "bibliography": r"<h2>\s*Bibliography\s*</h2>",
    }
    return {name: bool(re.search(pattern, html, flags=re.IGNORECASE)) for name, pattern in checks.items()}


def parse_footnotes(html: str) -> tuple[set[str], set[str], dict[str, str], dict[str, str]]:
    # in-text refs: <sup id="fnref-1"><a href="#fn-1">1</a></sup>
    intext = set(re.findall(r'id="fnref-(\d+)"', html))
    intext_links = dict(re.findall(r'id="fnref-(\d+)".*?href="#fn-(\d+)"', html, flags=re.DOTALL))

    # note list ids/backlinks: <li id="fn-1"> <a href="#fnref-1">
    note_ids = set(re.findall(r'<li\s+id="fn-(\d+)"', html))
    note_backlinks = dict(re.findall(r'<li\s+id="fn-(\d+)".*?href="#fnref-(\d+)"', html, flags=re.DOTALL))
    return intext, note_ids, intext_links, note_backlinks


def parse_bibliography_entries(html: str) -> list[str]:
    match = re.search(r'<div id="references">.*?<ol>(.*?)</ol>', html, flags=re.DOTALL | re.IGNORECASE)
    if not match:
        return []
    body = match.group(1)
    entries = re.findall(r"<li>(.*?)</li>", body, flags=re.DOTALL | re.IGNORECASE)
    return [re.sub(r"\s+", " ", e).strip() for e in entries if re.sub(r"<.*?>", "", e).strip()]


def parse_theme_sections(html: str) -> list[str]:
    findings_match = re.search(
        r"<h2>\s*3\.\s*Literature Review Findings\s*</h2>(.*?)(?:<h2>\s*(?:\d+\.\s*)?Conclusion\s*</h2>)",
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if not findings_match:
        return []
    findings_block = findings_match.group(1)
    return re.findall(r"<h3>\s*\d+\.\s*(.*?)\s*</h3>", findings_block, flags=re.IGNORECASE)


def load_json(path: Path | None) -> dict[str, Any]:
    if not path:
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_trace_footnotes(path: Path | None) -> set[str]:
    ids: set[str] = set()
    if not path or not path.exists():
        return ids
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                fn = str(row.get("footnote_id", "")).strip()
                if fn:
                    ids.add(fn)
    except Exception:
        return set()
    return ids


def validate(
    html_path: Path,
    context_path: Path | None = None,
    traceability_path: Path | None = None,
) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    info: list[dict[str, str]] = []

    if not html_path.exists():
        return {
            "ok": False,
            "errors": [{"check": "file_exists", "message": f"HTML file not found: {html_path}"}],
            "warnings": [],
            "info": [],
            "stats": {},
        }

    html = html_path.read_text(encoding="utf-8", errors="ignore")

    # 1) Required headings
    headings = find_required_headings(html)
    for key, present in headings.items():
        if not present:
            add_issue(errors, "required_heading", f"Missing required section heading: {key}")

    # 2) Placeholder leakage
    for p in PLACEHOLDER_PATTERNS:
        if re.search(p, html, flags=re.IGNORECASE):
            add_issue(errors, "placeholder_leakage", f"Matched placeholder pattern: {p}")

    # 3) Footnote integrity
    intext_ids, note_ids, intext_links, note_backlinks = parse_footnotes(html)

    if not intext_ids:
        add_issue(errors, "footnotes", "No in-text footnote citations found.")
    if not note_ids:
        add_issue(errors, "footnotes", "No note entries found in Notes section.")

    missing_note_targets = sorted(i for i in intext_ids if i not in note_ids)
    if missing_note_targets:
        add_issue(
            errors,
            "footnote_linking",
            f"In-text footnotes missing note entries: {', '.join(missing_note_targets[:20])}",
        )

    orphan_notes = sorted(i for i in note_ids if i not in intext_ids)
    if orphan_notes:
        add_issue(
            warnings,
            "footnote_linking",
            f"Note entries without in-text citation: {', '.join(orphan_notes[:20])}",
        )

    for left, right in intext_links.items():
        if left != right:
            add_issue(errors, "footnote_linking", f'In-text mapping mismatch: fnref-{left} -> fn-{right}')
            break

    for left, right in note_backlinks.items():
        if left != right:
            add_issue(errors, "footnote_linking", f'Note backlink mismatch: fn-{left} -> fnref-{right}')
            break

    # contiguity check
    if intext_ids:
        nums = sorted(int(x) for x in intext_ids if x.isdigit())
        expected = list(range(1, max(nums) + 1))
        if nums != expected:
            add_issue(
                warnings,
                "footnote_sequence",
                "Footnote ids are not contiguous from 1..N.",
            )

    # 4) Bibliography quality
    refs = parse_bibliography_entries(html)
    if not refs:
        add_issue(errors, "bibliography", "No bibliography entries found.")
    else:
        if len(refs) < 3:
            add_issue(warnings, "bibliography", f"Low bibliography count: {len(refs)}")
        for i, ref in enumerate(refs, start=1):
            if len(re.sub(r"<.*?>", "", ref).strip()) < 30:
                add_issue(warnings, "bibliography", f"Very short bibliography entry at position {i}.")
                break

    # 5) Section-level citation density (theme sections)
    theme_titles = parse_theme_sections(html)
    if not theme_titles:
        add_issue(warnings, "themes", "No numbered theme subsections found under findings.")
    for title in theme_titles:
        # take block from this h3 until next h3/h2
        pattern = (
            rf"<h3>\s*\d+\.\s*{re.escape(title)}\s*</h3>(.*?)(?:<h3>\s*\d+\.|<h2>\s*(?:\d+\.\s*)?Conclusion)"
        )
        m = re.search(pattern, html, flags=re.DOTALL | re.IGNORECASE)
        if m:
            block = m.group(1)
            cites = len(re.findall(r'id="fnref-\d+"', block))
            if cites == 0:
                add_issue(warnings, "citation_density", f"Theme section has no citations: {title}")

    # 6) Cross-check with context
    context = load_json(context_path)
    if context:
        ctx_theme_count = len(context.get("generated_themes", []))
        if ctx_theme_count and ctx_theme_count != len(theme_titles):
            add_issue(
                warnings,
                "context_consistency",
                f"Theme count mismatch (context={ctx_theme_count}, html={len(theme_titles)}).",
            )
        ctx_ref_count = len(context.get("references_list", []))
        if ctx_ref_count and ctx_ref_count != len(refs):
            add_issue(
                warnings,
                "context_consistency",
                f"Reference count mismatch (context={ctx_ref_count}, html={len(refs)}).",
            )
        ctx_fn_count = len(context.get("footnote_list_texts", {}))
        if ctx_fn_count and ctx_fn_count != len(note_ids):
            add_issue(
                warnings,
                "context_consistency",
                f"Footnote count mismatch (context={ctx_fn_count}, html={len(note_ids)}).",
            )

    # 7) Cross-check traceability footnotes
    trace_ids = load_trace_footnotes(traceability_path)
    if trace_ids:
        missing_from_html = sorted(x for x in trace_ids if x not in note_ids)
        if missing_from_html:
            add_issue(
                errors,
                "traceability_consistency",
                f"Traceability footnotes missing from html notes: {', '.join(missing_from_html[:20])}",
            )
        missing_from_trace = sorted(x for x in note_ids if x not in trace_ids)
        if missing_from_trace:
            add_issue(
                warnings,
                "traceability_consistency",
                f"HTML note ids not found in traceability csv: {', '.join(missing_from_trace[:20])}",
            )

    stats = {
        "html_path": str(html_path),
        "html_size_bytes": len(html.encode("utf-8")),
        "theme_sections": len(theme_titles),
        "intext_footnotes": len(intext_ids),
        "note_entries": len(note_ids),
        "bibliography_entries": len(refs),
        "errors": len(errors),
        "warnings": len(warnings),
    }
    add_issue(info, "summary", f"Validated {stats['html_path']}")
    add_issue(info, "summary", f"themes={stats['theme_sections']}, footnotes={stats['note_entries']}, refs={stats['bibliography_entries']}")

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "info": info,
        "stats": stats,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate literature review output package.")
    parser.add_argument("--html", required=True, help="Path to final literature review HTML.")
    parser.add_argument("--context", help="Optional context JSON path.")
    parser.add_argument("--traceability", help="Optional traceability CSV path.")
    parser.add_argument("--out", help="Optional output JSON report path.")
    args = parser.parse_args()

    html_path = Path(args.html)
    context_path = Path(args.context) if args.context else None
    traceability_path = Path(args.traceability) if args.traceability else None

    report = validate(html_path=html_path, context_path=context_path, traceability_path=traceability_path)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report.get("ok") else 1)


if __name__ == "__main__":
    main()
