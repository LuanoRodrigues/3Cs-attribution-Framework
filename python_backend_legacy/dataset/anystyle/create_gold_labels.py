#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import subprocess
from pathlib import Path

YEAR_RE = re.compile(r"\b(?:19|20)\d{2}[a-z]?\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
DOI_RE = re.compile(r"\b10\.\d{4,9}/\S+", re.IGNORECASE)
AUTHOR_LEAD_RE = re.compile(r"^[A-Z][A-Za-z'`\-\.]+\s*,\s+")
NOISE_PATTERNS = [
    r"jstor\.org/stable",
    r"about\.jstor\.org/terms",
    r"terms\s*&\s*conditions",
    r"all\s+use\s+subject\s+to",
    r"electronic\s+copy\s+available",
    r"ssrn\s+working\s+paper\s+series",
    r"downloaded\s+from\s+",
]
NOISE_RE = re.compile("|".join(NOISE_PATTERNS), re.IGNORECASE)


def likely_reference(line: str) -> bool:
    s = line.strip()
    if len(s) < 30:
        return False
    if NOISE_RE.search(s):
        return False
    if URL_RE.fullmatch(s):
        return False

    has_year = bool(YEAR_RE.search(s))
    has_author = bool(AUTHOR_LEAD_RE.match(s))
    has_title_punct = "." in s or ":" in s
    has_locator = bool(URL_RE.search(s) or DOI_RE.search(s))

    # Strong bibliographic evidence.
    if has_author and has_year and has_title_punct:
        return True
    if has_year and has_locator and len(s) > 45:
        return True
    if has_author and len(s) > 45 and has_title_punct:
        return True
    return False


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Create AnyStyle gold-label seed + review pack.")
    p.add_argument(
        "--workspace-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="AnyStyle workspace directory (default: python_backend_legacy/dataset/anystyle).",
    )
    p.add_argument(
        "--input-tsv",
        type=Path,
        default=None,
        help="Input TSV from build_training_data.py (default: exports/references_with_source.tsv).",
    )
    p.add_argument(
        "--anystyle-cmd",
        default="/home/pantera/projects/TEIA/annotarium/scripts/anystyle.sh",
        help="AnyStyle command wrapper.",
    )
    p.add_argument(
        "--max-refs",
        type=int,
        default=2500,
        help="Max cleaned references to keep for seed gold labels.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    ws = args.workspace_dir.expanduser().resolve()
    input_tsv = args.input_tsv.expanduser().resolve() if args.input_tsv else ws / "exports" / "references_with_source.tsv"

    if not input_tsv.is_file():
        raise SystemExit(f"input TSV not found: {input_tsv}")

    training_dir = ws / "training"
    training_dir.mkdir(parents=True, exist_ok=True)

    refs_txt = training_dir / "gold_labels.seed.txt"
    review_tsv = training_dir / "gold_labels.review.tsv"
    seed_xml = training_dir / "gold_labels.seed.xml"
    final_xml = training_dir / "gold_labels.xml"

    kept: list[tuple[str, str, str, str]] = []
    seen: set[str] = set()

    with input_tsv.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            ref = (row.get("reference_text") or "").strip()
            if not ref:
                continue
            if not likely_reference(ref):
                continue
            key = re.sub(r"\s+", " ", ref.lower()).strip()
            if key in seen:
                continue
            seen.add(key)
            kept.append(
                (
                    row.get("json_file") or "",
                    row.get("pdf_path") or "",
                    row.get("reference_index") or "",
                    ref,
                )
            )
            if args.max_refs > 0 and len(kept) >= args.max_refs:
                break

    refs_txt.write_text("\n".join(r[3] for r in kept) + ("\n" if kept else ""), encoding="utf-8")

    with review_tsv.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(["review_status", "json_file", "pdf_path", "reference_index", "reference_text"])
        for row in kept:
            w.writerow(["todo", row[0], row[1], row[2], row[3]])

    cmd = [args.anystyle_cmd, "--stdout", "-f", "xml", "parse", str(refs_txt)]
    proc = subprocess.run(cmd, text=True, capture_output=True)
    if proc.returncode != 0:
        raise SystemExit(f"anystyle parse failed:\n{proc.stderr}")

    seed_xml.write_text(proc.stdout, encoding="utf-8")
    final_xml.write_text(proc.stdout, encoding="utf-8")

    print(f"input_tsv={input_tsv}")
    print(f"references_kept={len(kept)}")
    print(f"seed_txt={refs_txt}")
    print(f"review_tsv={review_tsv}")
    print(f"seed_xml={seed_xml}")
    print(f"gold_xml={final_xml}")
    print("note=gold_labels.xml is an auto-labeled seed; finalize by reviewing gold_labels.review.tsv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
