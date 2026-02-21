#!/usr/bin/env python3
from __future__ import annotations

import argparse
import random
import re
import xml.etree.ElementTree as ET
from pathlib import Path

YEAR_RE = re.compile(r"\((19|20)\d{2}[a-z]?\)\.?$", re.IGNORECASE)
AUTHOR_OK_RE = re.compile(r"^[A-Z][A-Za-z'\-.]+,\s+")
PAGES_OK_RE = re.compile(r"^\d+\s*(?:-|–|—)\s*\d+$")
VOLUME_OK_RE = re.compile(r"^\d+(?:\([^)]*\))?$")
BAD_RE = re.compile(r"(https?://|www\.|&lt;|&gt;|jstor|terms\s*&\s*conditions|cookie|privacy)", re.IGNORECASE)

FIELD_ORDER = [
    "author",
    "title",
    "journal",
    "container-title",
    "volume",
    "pages",
    "date",
    "publisher",
    "location",
    "institution",
]


def clean(s: str) -> str:
    t = (s or "").strip()
    t = re.sub(r"\s+", " ", t)
    t = t.strip(" \t\n\r\"'“”`*")
    t = t.replace("&amp;amp;", "&amp;")
    t = t.replace("'.", ".")
    t = t.replace('".', ".")
    t = t.rstrip(" ,;:")
    return t


def seq_to_map(seq: ET.Element) -> dict[str, str]:
    out: dict[str, str] = {}
    for c in list(seq):
        txt = clean(c.text or "")
        if not txt:
            continue
        if c.tag in out:
            # Prefer first, except title where we append if distinct.
            if c.tag == "title" and txt not in out[c.tag]:
                out[c.tag] = f"{out[c.tag]} {txt}".strip()
            continue
        out[c.tag] = txt
    return out


def is_high_quality(m: dict[str, str]) -> bool:
    a = m.get("author", "")
    d = m.get("date", "")
    t = m.get("title", "")
    j = m.get("journal", "")
    v = m.get("volume", "")
    p = m.get("pages", "")
    pub = m.get("publisher", "")

    if not a or not d or not t:
        return False
    if not AUTHOR_OK_RE.search(a):
        return False
    if not YEAR_RE.search(d):
        return False
    if len(t) < 12 or len(t) > 280:
        return False

    joined = " ".join([a, d, t, j, v, p, pub]).lower()
    if BAD_RE.search(joined):
        return False

    # Require either journal-style record or publisher-style record.
    journal_ok = bool(j and v and p and VOLUME_OK_RE.match(v) and PAGES_OK_RE.match(p))
    book_ok = bool(pub and not j)
    if not (journal_ok or book_ok):
        return False

    return True


def map_to_seq(m: dict[str, str]) -> ET.Element:
    seq = ET.Element("sequence")
    for k in FIELD_ORDER:
        v = m.get(k, "").strip()
        if not v:
            continue
        el = ET.SubElement(seq, k)
        # normalize per-field punctuation
        if k == "pages":
            v = re.sub(r"\s*(?:-|–|—)\s*", "-", v)
        if k == "volume":
            v = v.rstrip(":")
        el.text = v
    return seq


def write_dataset(path: Path, seqs: list[ET.Element]) -> None:
    root = ET.Element("dataset")
    for s in seqs:
        root.append(s)
    tree = ET.ElementTree(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(path, encoding="utf-8", xml_declaration=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build manually curated v3 training subset.")
    p.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).resolve().parent / "training" / "gold_labels.pre_v2.xml",
    )
    p.add_argument(
        "--subset-out",
        type=Path,
        default=Path(__file__).resolve().parent / "training" / "gold_labels.manual_v3.xml",
    )
    p.add_argument(
        "--train-out",
        type=Path,
        default=Path(__file__).resolve().parent / "training" / "train.v3.xml",
    )
    p.add_argument(
        "--dev-out",
        type=Path,
        default=Path(__file__).resolve().parent / "training" / "dev.v3.xml",
    )
    p.add_argument("--target", type=int, default=300)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--dev-ratio", type=float, default=0.2)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    root = ET.parse(args.input.expanduser().resolve()).getroot()

    cleaned: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()

    for seq in root.findall("sequence"):
        m = seq_to_map(seq)
        if not is_high_quality(m):
            continue
        key = (m.get("author", "").lower(), m.get("date", "").lower(), m.get("title", "").lower())
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(m)

    rnd = random.Random(args.seed)
    rnd.shuffle(cleaned)
    cleaned = cleaned[: args.target]

    seqs = [map_to_seq(m) for m in cleaned]
    write_dataset(args.subset_out.expanduser().resolve(), seqs)

    n = len(seqs)
    dev_n = max(1, int(round(n * args.dev_ratio)))
    dev = seqs[:dev_n]
    train = seqs[dev_n:]

    write_dataset(args.train_out.expanduser().resolve(), train)
    write_dataset(args.dev_out.expanduser().resolve(), dev)

    print(f"input={args.input}")
    print(f"high_quality_found={len(cleaned)}")
    print(f"subset={n}")
    print(f"train={len(train)}")
    print(f"dev={len(dev)}")
    print(f"subset_xml={args.subset_out}")
    print(f"train_xml={args.train_out}")
    print(f"dev_xml={args.dev_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
