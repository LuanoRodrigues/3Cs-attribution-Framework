#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import re
import xml.etree.ElementTree as ET
from pathlib import Path

FIELD_ORDER = [
    "citation-number",
    "author",
    "title",
    "container-title",
    "journal",
    "booktitle",
    "volume",
    "issue",
    "pages",
    "date",
    "publisher",
    "location",
    "institution",
    "genre",
    "url",
    "doi",
    "note",
]

LEAD_QUOTE_RE = re.compile(r'^["“”\']+')
TAIL_QUOTE_RE = re.compile(r'["“”\']+$')
WS_RE = re.compile(r'\s+')
URL_EXTRACT_RE = re.compile(r'https?://\S+', re.IGNORECASE)


def clean_text(s: str, field: str) -> str:
    t = (s or "").strip()
    t = html.unescape(t)
    t = t.replace("*", "")
    t = WS_RE.sub(" ", t).strip()

    # Remove markdown-ish or OCR quote wrappers around title-like fields.
    if field in {"title", "journal", "container-title", "publisher", "location"}:
        t = LEAD_QUOTE_RE.sub("", t)
        t = TAIL_QUOTE_RE.sub("", t)
        t = t.replace("'.", ".")
        t = t.replace('".', ".")
        t = re.sub(r"'(?=[:.,;])", "", t)

    # Normalize trailing punctuation by field.
    if field in {"title", "publisher", "journal", "container-title", "location", "genre", "institution"}:
        t = t.rstrip(" ,;")
        if t.endswith(":") and field in {"publisher", "journal", "container-title", "location"}:
            t = t[:-1].rstrip()

    if field == "volume":
        t = t.rstrip(" :;")
    if field == "pages":
        t = t.rstrip(" .;")
    if field == "url":
        # OCR often introduces spaces/newlines in URLs; compact and keep first URL only.
        t = re.sub(r"\s+", "", t)
        t = t.strip("<>.,;")
        m = URL_EXTRACT_RE.search(t)
        t = m.group(0) if m else t
        if t.count("http://") + t.count("https://") > 1:
            first = t.find("http")
            second = t.find("http", first + 4)
            if second > first:
                t = t[first:second].rstrip(" ,;")

    return t.strip()


def reorder_sequence(seq: ET.Element) -> None:
    children = list(seq)
    for c in children:
        seq.remove(c)

    grouped: dict[str, list[ET.Element]] = {}
    extra: list[ET.Element] = []
    for c in children:
        if c.tag in FIELD_ORDER:
            grouped.setdefault(c.tag, []).append(c)
        else:
            extra.append(c)

    for tag in FIELD_ORDER:
        for c in grouped.get(tag, []):
            seq.append(c)
    for c in extra:
        seq.append(c)


def try_fix_split_title(seq: ET.Element) -> int:
    """Fix obvious split like title='Liberation vs.' journal='Control: ...'."""
    changed = 0
    title_el = seq.find("title")
    journal_el = seq.find("journal")
    if title_el is None or journal_el is None:
        return 0

    title = (title_el.text or "").strip()
    journal = (journal_el.text or "").strip()
    if title.endswith("vs.") and journal.lower().startswith("control:"):
        title_el.text = f"{title} {journal}".strip()
        seq.remove(journal_el)
        changed += 1
    return changed


def is_noisy_sequence(seq: ET.Element) -> bool:
    texts = {c.tag: (c.text or "").strip() for c in list(seq)}
    joined = " ".join(v.lower() for v in texts.values() if v)

    author = texts.get("author", "").lower()
    title = texts.get("title", "").lower()
    url = texts.get("url", "").lower()
    dates = [c for c in list(seq) if c.tag == "date"]
    has_citation_number = seq.find("citation-number") is not None

    # Common bad extractions from citation/footnote blobs.
    bad_author_prefixes = (
        "quoting ",
        "see, ",
        "see also",
        "cited in ",
        "www.",
        "http",
        "attacks',",
        "of canada.",
        "say uk,",
    )
    if author.startswith(bad_author_prefixes):
        return True
    if author and author[0].islower() and "," not in author and " " in author:
        return True
    if "http" in author or "www." in author:
        return True

    if "<" in joined or ">" in joined or "&lt;" in joined or "&gt;" in joined:
        return True
    if "accessed " in joined and bool(url):
        return True
    if "terms & conditions" in joined or "cookie" in joined or "privacy watchdog" in joined:
        return True
    if has_citation_number and len(dates) > 1:
        return True
    if url and (" " in url or not url.startswith(("http://", "https://"))):
        return True
    if not title and not texts.get("journal") and not texts.get("container-title"):
        return True

    return False


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Curate AnyStyle gold labels XML.")
    p.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).resolve().parent / "training" / "gold_labels.xml",
        help="Input gold labels XML.",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent / "training" / "gold_labels.v1.xml",
        help="Output curated XML.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    src = args.input.expanduser().resolve()
    dst = args.output.expanduser().resolve()

    tree = ET.parse(src)
    root = tree.getroot()

    cleaned_fields = 0
    dropped_empty = 0
    split_fixes = 0
    noisy_dropped = 0

    for seq in list(root.findall("sequence")):
        split_fixes += try_fix_split_title(seq)

        for child in list(seq):
            before = child.text or ""
            after = clean_text(before, child.tag)
            if after != before:
                cleaned_fields += 1
            if not after:
                seq.remove(child)
                dropped_empty += 1
            else:
                child.text = after

        reorder_sequence(seq)
        if is_noisy_sequence(seq):
            root.remove(seq)
            noisy_dropped += 1

    dst.parent.mkdir(parents=True, exist_ok=True)
    tree.write(dst, encoding="utf-8", xml_declaration=True)

    print(f"input={src}")
    print(f"output={dst}")
    print(f"sequences={len(root.findall('sequence'))}")
    print(f"fields_cleaned={cleaned_fields}")
    print(f"empty_fields_dropped={dropped_empty}")
    print(f"split_title_fixes={split_fixes}")
    print(f"noisy_sequences_dropped={noisy_dropped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
