#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path

BAD_RE = re.compile(
    r"(https?://|www\.|\&|\bpp?\.?\s*\d|\bvol\.?\b|\bin\s+proceedings\b|\baccessed\b|\bjournal\s+of\s+strategic\s+studies\s*\.?\s*\w*\s*\(?\d|\bcyber\s+conflict\s*\(cycon\))",
    re.IGNORECASE,
)
YEAR_RE = re.compile(r"\((19|20)\d{2}[a-z]?\)\.?$", re.IGNORECASE)
AUTHOR_RE = re.compile(r"^[A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+)*,?\s+")
PAGES_RE = re.compile(r"^\d+-\d+$")
VOL_RE = re.compile(r"^\d+(?:\([^)]*\))?$")


def t(seq: ET.Element, tag: str) -> str:
    el = seq.find(tag)
    return (el.text or "").strip() if el is not None else ""


def good(seq: ET.Element) -> bool:
    author = t(seq, "author")
    title = t(seq, "title")
    date = t(seq, "date")
    journal = t(seq, "journal")
    volume = t(seq, "volume")
    pages = t(seq, "pages")
    publisher = t(seq, "publisher")
    container = t(seq, "container-title")

    if not author or not title or not date:
        return False
    if not AUTHOR_RE.search(author):
        return False
    if not YEAR_RE.search(date):
        return False
    if len(title) < 15 or len(title) > 220:
        return False

    joined = " ".join([author, title, journal, volume, pages, publisher, container])
    if BAD_RE.search(joined):
        return False

    journal_ok = bool(journal and VOL_RE.match(volume) and PAGES_RE.match(pages))
    book_ok = bool(publisher and not journal and not container)
    if not (journal_ok or book_ok):
        return False

    return True


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--input", type=Path, default=Path(__file__).resolve().parent / "training" / "gold_labels.manual_v3.xml")
    p.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "training" / "gold_labels.manual_v3.pruned.xml")
    p.add_argument("--min", type=int, default=200)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    root = ET.parse(args.input).getroot()
    kept = [s for s in root.findall("sequence") if good(s)]
    if len(kept) < args.min:
        raise SystemExit(f"too few after prune: {len(kept)}")
    out_root = ET.Element("dataset")
    for s in kept:
        out_root.append(s)
    ET.ElementTree(out_root).write(args.output, encoding="utf-8", xml_declaration=True)
    print(f"input={args.input}")
    print(f"kept={len(kept)}")
    print(f"output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
