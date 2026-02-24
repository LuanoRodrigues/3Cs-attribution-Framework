#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _err(errors: list[str], msg: str) -> None:
    errors.append(msg)


def _warn(warnings: list[str], msg: str) -> None:
    warnings.append(msg)


def validate_payload(obj: dict[str, Any]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    required_top = [
        "schema_version",
        "agent_version",
        "markdown_path",
        "pdf_path",
        "missing_footnotes_for_seen_intext",
        "missing_inference",
        "recovered_items",
        "structured_references",
        "summary",
    ]
    for k in required_top:
        if k not in obj:
            _err(errors, f"missing top-level key: {k}")

    missing = obj.get("missing_footnotes_for_seen_intext")
    if not isinstance(missing, list):
        _err(errors, "missing_footnotes_for_seen_intext must be a list")
        missing = []
    missing_set = {int(x) for x in missing if str(x).isdigit()}

    inf = obj.get("missing_inference")
    if not isinstance(inf, list):
        _err(errors, "missing_inference must be a list")
        inf = []

    recovered = obj.get("recovered_items")
    if not isinstance(recovered, dict):
        _err(errors, "recovered_items must be an object")
        recovered = {}

    seen_idx: set[int] = set()
    for i, row in enumerate(inf):
        if not isinstance(row, dict):
            _err(errors, f"missing_inference[{i}] must be an object")
            continue
        if "index" not in row:
            _err(errors, f"missing_inference[{i}] missing index")
            continue
        try:
            idx = int(row["index"])
        except Exception:
            _err(errors, f"missing_inference[{i}].index is not int-like")
            continue
        seen_idx.add(idx)
        if idx not in missing_set:
            _warn(warnings, f"missing_inference index {idx} not listed in missing_footnotes_for_seen_intext")

        res = row.get("resolution")
        if not isinstance(res, dict):
            _err(errors, f"missing_inference[{i}].resolution must be object")
            continue

        page0 = res.get("inferred_page_index")
        if not isinstance(page0, int):
            _err(errors, f"missing_inference[{i}].resolution.inferred_page_index must be int")
        if res.get("validated") and str(idx) not in recovered:
            _warn(warnings, f"validated footnote {idx} missing from recovered_items")

    for k in recovered.keys():
        if not str(k).isdigit():
            _err(errors, f"recovered_items key is not numeric: {k}")

    sr = obj.get("structured_references")
    if not isinstance(sr, dict):
        _err(errors, "structured_references must be object")
        sr = {}
    refs = sr.get("references")
    if not isinstance(refs, list):
        _err(errors, "structured_references.references must be list")
        refs = []
    mention_ids: set[str] = set()
    for i, r in enumerate(refs):
        if not isinstance(r, dict):
            _err(errors, f"structured_references.references[{i}] must be object")
            continue
        mid = str(r.get("mention_id") or "")
        if not mid:
            _err(errors, f"structured_references.references[{i}] missing mention_id")
        elif mid in mention_ids:
            _err(errors, f"duplicate mention_id: {mid}")
        mention_ids.add(mid)

        fn = r.get("footnote_number")
        if fn is not None and not isinstance(fn, int):
            _err(errors, f"structured_references.references[{i}].footnote_number must be int or null")
        elif isinstance(fn, int) and fn <= 0:
            _err(errors, f"structured_references.references[{i}].footnote_number must be positive")

        p0 = r.get("page_index_0based")
        p1 = r.get("page_number_1based")
        if isinstance(p0, int) and isinstance(p1, int) and p1 != p0 + 1:
            _err(errors, f"structured_references.references[{i}] page mismatch: {p0} vs {p1}")

        bib = r.get("bibliographic_info")
        if not isinstance(bib, dict):
            _err(errors, f"structured_references.references[{i}].bibliographic_info must be object")
            continue
        for need in ("authors", "year", "title", "url", "doi", "publisher_or_source", "raw_reference"):
            if need not in bib:
                _err(errors, f"structured_references.references[{i}].bibliographic_info missing {need}")
        conf = r.get("confidence")
        if conf is not None:
            try:
                c = float(conf)
                if c < 0 or c > 1:
                    _err(errors, f"structured_references.references[{i}].confidence must be between 0 and 1")
            except Exception:
                _err(errors, f"structured_references.references[{i}].confidence is not numeric")

    summary = obj.get("summary")
    if isinstance(summary, dict):
        missing_count = summary.get("missing_count")
        if isinstance(missing_count, int) and missing_count != len(missing_set):
            _warn(warnings, f"summary.missing_count={missing_count} but missing list has {len(missing_set)}")
    else:
        _err(errors, "summary must be object")

    q = obj.get("quality_gate")
    if isinstance(q, dict):
        if "passed" in q and not isinstance(q.get("passed"), bool):
            _err(errors, "quality_gate.passed must be bool")
    elif q is not None:
        _err(errors, "quality_gate must be object if present")

    for k in ("tables_collected", "images_collected"):
        if k in obj and not isinstance(obj.get(k), list):
            _err(errors, f"{k} must be a list when present")
    if "artifact_extraction" in obj and not isinstance(obj.get("artifact_extraction"), dict):
        _err(errors, "artifact_extraction must be an object when present")

    return errors, warnings


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate infer_missing_footnotes output JSON.")
    ap.add_argument("--json", required=True, help="Path to output json")
    args = ap.parse_args()

    p = Path(args.json).expanduser().resolve()
    if not p.is_file():
        print(f"ERROR: file not found: {p}")
        return 2
    try:
        obj = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"ERROR: invalid JSON: {exc}")
        return 2
    if not isinstance(obj, dict):
        print("ERROR: top-level JSON must be object")
        return 2

    errors, warnings = validate_payload(obj)
    print(f"file={p}")
    print(f"errors={len(errors)} warnings={len(warnings)}")
    for w in warnings:
        print(f"WARN: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
