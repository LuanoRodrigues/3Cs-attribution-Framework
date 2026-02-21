#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

YEAR_RE = re.compile(r"\((19|20)\d{2}[a-z]?\)")
LEAD_AUTHOR_RE = re.compile(r"^\s*([^\(]+?)\s*\((?:19|20)\d{2}[a-z]?\)")


def clean(s: str) -> str:
    t = (s or "").strip()
    t = t.strip('"“”\'`* ')
    t = re.sub(r"\s+", " ", t)
    t = t.replace("'.", ".").replace('".', ".")
    return t.strip(" ,;")


def normalize_date(s: str) -> str:
    m = re.search(r"(19|20)\d{2}[a-z]?", s or "")
    return f"({m.group(0)})." if m else ""


def infer_author(ref: str) -> str:
    m = LEAD_AUTHOR_RE.search(ref or "")
    if m:
        return clean(m.group(1))
    return "Anonymous"


def infer_title(ref: str) -> str:
    s = ref or ""
    y = YEAR_RE.search(s)
    if not y:
        return ""
    tail = s[y.end():].strip()
    if tail.startswith("."):
        tail = tail[1:].strip()
    # title is usually first sentence-like chunk.
    part = tail.split(".", 1)[0].strip()
    return clean(part)


def infer_source(ref: str) -> str:
    # last comma chunk often publisher/source in short references
    parts = [clean(p) for p in (ref or "").split(",") if clean(p)]
    if not parts:
        return ""
    tail = parts[-1]
    if len(tail) <= 80 and not re.search(r"\b\d{4}\b", tail):
        return tail
    return "Unknown Source"


def choose(row: dict[str, str], field: str) -> str:
    return clean(row.get(f"final_{field}") or row.get(f"suggest_{field}") or "")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Auto-refine invalid queue rows with conservative heuristics.")
    p.add_argument("--queue-tsv", type=Path, default=Path(__file__).resolve().parent / "queue.tsv")
    p.add_argument("--only-invalid", action="store_true", default=True)
    p.add_argument("--no-only-invalid", dest="only_invalid", action="store_false")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    q = args.queue_tsv.expanduser().resolve()

    with q.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        headers = reader.fieldnames or []
        rows = list(reader)

    touched = 0
    for r in rows:
        if args.only_invalid and (r.get("validation_status") or "").strip().lower() != "invalid":
            continue

        ref = r.get("reference_text") or ""
        author = choose(r, "author")
        title = choose(r, "title")
        journal = choose(r, "journal")
        container = choose(r, "container_title")
        publisher = choose(r, "publisher")
        date = normalize_date(choose(r, "date") or ref)

        if not author:
            author = infer_author(ref)
        if not title:
            title = infer_title(ref)
        if not (journal or container or publisher):
            if (r.get("reference_type") or "") == "web/report":
                publisher = infer_source(ref)
            else:
                publisher = infer_source(ref)

        # write into final_* so reviewer can inspect overrides.
        r["final_author"] = author
        r["final_title"] = title
        r["final_journal"] = journal
        r["final_container_title"] = container
        r["final_date"] = date
        r["final_publisher"] = publisher

        if (r.get("status") or "").strip().lower() == "todo":
            r["status"] = "approved"
        touched += 1

    with q.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=headers, delimiter="\t")
        w.writeheader()
        w.writerows(rows)

    print(f"queue={q}")
    print(f"rows_touched={touched}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
