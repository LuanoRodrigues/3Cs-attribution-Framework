#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

YEAR_RE = re.compile(r"\(?\b(?:19|20)\d{2}[a-z]?\b\)?", re.IGNORECASE)
URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)


def choose(row: dict[str, str], field: str) -> str:
    return (row.get(f"final_{field}") or row.get(f"suggest_{field}") or "").strip()


def validate_row(row: dict[str, str]) -> tuple[str, str]:
    status = (row.get("status") or "").strip().lower()
    if status in {"skip", "rejected"}:
        return "skipped", ""

    author = choose(row, "author")
    title = choose(row, "title")
    date = choose(row, "date")
    journal = choose(row, "journal")
    container = choose(row, "container_title")
    publisher = choose(row, "publisher")

    errs: list[str] = []
    if not author:
        errs.append("missing_author")
    if URL_RE.search(author):
        errs.append("author_has_url")
    if not title:
        errs.append("missing_title")
    if URL_RE.search(title):
        errs.append("title_has_url")
    if not date or not YEAR_RE.search(date):
        errs.append("bad_date")
    if not (journal or container or publisher):
        errs.append("missing_container_or_publisher")

    if errs:
        return "invalid", ",".join(errs)
    return "valid", ""


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Validate reviewed queue rows.")
    p.add_argument("--queue-tsv", type=Path, default=Path(__file__).resolve().parent / "queue.tsv")
    p.add_argument("--report-tsv", type=Path, default=Path(__file__).resolve().parent / "validation_report.tsv")
    p.add_argument("--mark-approved-valid", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    qpath = args.queue_tsv.expanduser().resolve()
    rpt = args.report_tsv.expanduser().resolve()

    with qpath.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        headers = reader.fieldnames or []
        rows = list(reader)

    out_rows = []
    valid = invalid = skipped = 0

    for r in rows:
        vstatus, notes = validate_row(r)
        r["validation_status"] = vstatus
        if notes:
            r["validation_notes"] = notes
        if vstatus == "valid":
            valid += 1
            if args.mark_approved_valid and (r.get("status") or "").strip().lower() == "todo":
                r["status"] = "approved"
        elif vstatus == "invalid":
            invalid += 1
        else:
            skipped += 1
        out_rows.append(r)

    with qpath.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=headers, delimiter="\t")
        w.writeheader()
        w.writerows(out_rows)

    rpt.parent.mkdir(parents=True, exist_ok=True)
    with rpt.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(["metric", "value"])
        w.writerow(["valid", valid])
        w.writerow(["invalid", invalid])
        w.writerow(["skipped", skipped])
        w.writerow(["total", len(out_rows)])

    print(f"queue={qpath}")
    print(f"report={rpt}")
    print(f"valid={valid} invalid={invalid} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
