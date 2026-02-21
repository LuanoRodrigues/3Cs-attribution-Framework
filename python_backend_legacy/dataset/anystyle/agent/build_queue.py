#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

YEAR_RE = re.compile(r"\b(?:19|20)\d{2}[a-z]?\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def infer_type(ref: str) -> str:
    s = ref.lower()
    if URL_RE.search(ref) and "http" in s and not re.search(r"\b\d+\s*\(\d+\)", ref):
        return "web/report"
    if re.search(r"\b\d+\s*\(\d+\)\b", ref) and re.search(r"\b\d+\s*[-–—]\s*\d+\b", ref):
        return "journal"
    if "in " in s and ":" in ref:
        return "chapter/conf"
    if YEAR_RE.search(ref) and ("press" in s or "publisher" in s):
        return "book"
    return "other"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build review queue TSV for human labeling.")
    p.add_argument("--input-tsv", type=Path, default=Path(__file__).resolve().parents[1] / "exports" / "references_with_source.tsv")
    p.add_argument("--output-tsv", type=Path, default=Path(__file__).resolve().parent / "queue.tsv")
    p.add_argument("--max-rows", type=int, default=1500)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    inp = args.input_tsv.expanduser().resolve()
    out = args.output_tsv.expanduser().resolve()
    if not inp.is_file():
        raise SystemExit(f"input not found: {inp}")

    seen: set[str] = set()
    rows: list[list[str]] = []

    with inp.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for r in reader:
            ref = (r.get("reference_text") or "").strip()
            if len(ref) < 20:
                continue
            key = re.sub(r"\s+", " ", ref.lower())
            if key in seen:
                continue
            seen.add(key)
            rtype = infer_type(ref)
            rows.append([
                "todo",  # status
                "",      # validation_status
                "",      # validation_notes
                r.get("json_file") or "",
                r.get("pdf_path") or "",
                r.get("reference_index") or "",
                rtype,
                ref,
                "", "", "", "", "", "", "", "", "",  # suggest_* fields
                "", "", "", "", "", "", "", "", "",  # final_* fields
                "",  # reviewer_notes
            ])
            if args.max_rows > 0 and len(rows) >= args.max_rows:
                break

    headers = [
        "status", "validation_status", "validation_notes", "json_file", "pdf_path", "reference_index", "reference_type", "reference_text",
        "suggest_author", "suggest_title", "suggest_journal", "suggest_container_title", "suggest_volume", "suggest_issue", "suggest_pages", "suggest_date", "suggest_publisher",
        "final_author", "final_title", "final_journal", "final_container_title", "final_volume", "final_issue", "final_pages", "final_date", "final_publisher",
        "reviewer_notes",
    ]

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(headers)
        w.writerows(rows)

    print(f"input={inp}")
    print(f"output={out}")
    print(f"rows={len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
