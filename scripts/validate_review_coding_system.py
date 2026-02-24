#!/usr/bin/env python3
"""Validate coded evidence CSV against unified coding system schema."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def load_schema(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        return (reader.fieldnames or []), rows


def split_pipe(value: str) -> list[str]:
    return [x.strip() for x in str(value or "").split("|") if x.strip()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="Coded evidence CSV path")
    ap.add_argument("--schema", default="Research/review_standards/unified_coding_system_v1.json")
    ap.add_argument("--review-type", choices=["literature", "bibliographic", "systematic"], required=True)
    ap.add_argument("--out", default="", help="Optional JSON report output path")
    args = ap.parse_args()

    csv_path = Path(args.csv)
    schema_path = Path(args.schema)

    schema = load_schema(schema_path)
    header, rows = read_rows(csv_path)

    errors: list[str] = []
    warnings: list[str] = []

    required = list(schema.get("core_required_fields", []))
    profile = schema.get("mode_profiles", {}).get(args.review_type, {})
    required += list(profile.get("required_extra_fields", []))

    for col in required:
        if col not in header:
            errors.append(f"Missing required column: {col}")

    vocab = schema.get("controlled_vocab", {})
    ev_vocab = set(vocab.get("evidence_type", []))
    arg_vocab = set(vocab.get("argument_type", []))
    dir_vocab = set(vocab.get("claim_direction", []))
    excl_vocab = set(vocab.get("exclude_reason", []))

    for i, row in enumerate(rows, start=2):
        for col in schema.get("core_required_fields", []):
            if not str(row.get(col, "")).strip():
                errors.append(f"Row {i}: empty required field '{col}'")

        try:
            rs = int(str(row.get("relevance_score", "")).strip())
            if rs < 1 or rs > 5:
                errors.append(f"Row {i}: relevance_score out of range 1..5")
        except Exception:
            errors.append(f"Row {i}: invalid relevance_score")

        if ev_vocab:
            ev = str(row.get("evidence_type", "")).strip()
            if ev and ev not in ev_vocab:
                warnings.append(f"Row {i}: evidence_type '{ev}' not in controlled vocab")

        if arg_vocab:
            av = str(row.get("argument_type", "")).strip()
            if av and av not in arg_vocab:
                warnings.append(f"Row {i}: argument_type '{av}' not in controlled vocab")

        if dir_vocab:
            dv = str(row.get("claim_direction", "")).strip()
            if dv and dv not in dir_vocab:
                warnings.append(f"Row {i}: claim_direction '{dv}' not in controlled vocab")

        if excl_vocab:
            xv = str(row.get("exclude_reason", "")).strip()
            if xv and xv not in excl_vocab:
                warnings.append(f"Row {i}: exclude_reason '{xv}' not in controlled vocab")

        conf_raw = str(row.get("confidence_score", "")).strip()
        if conf_raw:
            try:
                cs = int(conf_raw)
                if cs < 1 or cs > 5:
                    errors.append(f"Row {i}: confidence_score out of range 1..5")
            except Exception:
                errors.append(f"Row {i}: invalid confidence_score")

        if args.review_type == "literature":
            for multi_col in ["potential_themes", "relevant_rqs"]:
                if not split_pipe(row.get(multi_col, "")):
                    warnings.append(f"Row {i}: '{multi_col}' is empty for literature profile")

    report = {
        "ok": len(errors) == 0,
        "review_type": args.review_type,
        "csv": str(csv_path),
        "schema": str(schema_path),
        "rows": len(rows),
        "errors": errors,
        "warnings": warnings,
    }

    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
