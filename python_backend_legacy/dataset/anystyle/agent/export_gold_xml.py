#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import xml.etree.ElementTree as ET
from pathlib import Path

FIELD_MAP = [
    ("author", "author"),
    ("title", "title"),
    ("journal", "journal"),
    ("container_title", "container-title"),
    ("volume", "volume"),
    ("issue", "issue"),
    ("pages", "pages"),
    ("date", "date"),
    ("publisher", "publisher"),
]


def choose(row: dict[str, str], field: str) -> str:
    return (row.get(f"final_{field}") or row.get(f"suggest_{field}") or "").strip()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export approved+valid queue rows to gold XML.")
    p.add_argument("--queue-tsv", type=Path, default=Path(__file__).resolve().parent / "queue.tsv")
    p.add_argument("--output-xml", type=Path, default=Path(__file__).resolve().parents[1] / "training" / "gold_labels.human.xml")
    p.add_argument("--min-rows", type=int, default=50)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    qpath = args.queue_tsv.expanduser().resolve()
    out = args.output_xml.expanduser().resolve()

    with qpath.open("r", encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))

    root = ET.Element("dataset")
    n = 0
    for r in rows:
        status = (r.get("status") or "").strip().lower()
        vstatus = (r.get("validation_status") or "").strip().lower()
        if status != "approved" or vstatus != "valid":
            continue

        seq = ET.SubElement(root, "sequence")
        for src, tag in FIELD_MAP:
            val = choose(r, src)
            if val:
                el = ET.SubElement(seq, tag)
                el.text = val
        if len(seq):
            n += 1

    if n < args.min_rows:
        raise SystemExit(f"too few approved+valid rows for export: {n}")

    out.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(out, encoding="utf-8", xml_declaration=True)
    print(f"output={out}")
    print(f"rows={n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
