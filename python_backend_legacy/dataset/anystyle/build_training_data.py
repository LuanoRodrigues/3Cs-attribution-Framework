#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
from pathlib import Path
from typing import Any

REF_HEADING_RE = re.compile(
    r"(?im)^\s{0,3}(?:#{1,6}\s*)?(references?|bibliography|works\s+cited|sources|literature\s+cited)\s*$"
)
NEXT_HEADING_RE = re.compile(r"(?m)^\s{0,3}#{1,6}\s+\S")
NUMERIC_START_RE = re.compile(r"^\s*(?:\[\d+\]|\d+[.)])\s+")
AUTHOR_START_RE = re.compile(r"^\s*[A-Z][A-Za-z'`\-\.]+\s*,\s+")
TITLE_QUOTE_START_RE = re.compile(r"^\s*[\"“][^\"]+")
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}[a-z]?\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
IP_TIMESTAMP_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}\s+on\s+\w{3},", re.IGNORECASE)


def _get_pages_from_json(obj: dict[str, Any]) -> list[dict[str, Any]]:
    response = obj.get("response")
    if not isinstance(response, dict):
        return []
    nested = response.get("response")
    if not isinstance(nested, dict):
        return []
    body = nested.get("body")
    if not isinstance(body, dict):
        return []
    pages = body.get("pages")
    if not isinstance(pages, list):
        return []
    return [p for p in pages if isinstance(p, dict)]


def _extract_bibliography_tail(markdown: str) -> str:
    matches = list(REF_HEADING_RE.finditer(markdown or ""))
    if not matches:
        return ""
    last = matches[-1]
    tail = (markdown or "")[last.end() :]

    # Stop at the next markdown heading if it appears shortly after references.
    next_head = NEXT_HEADING_RE.search(tail)
    if next_head and next_head.start() > 0:
        tail = tail[: next_head.start()]

    return tail


def _clean_line(line: str) -> str:
    s = (line or "").strip()
    if not s:
        return ""
    s = re.sub(r"^[-*•]+\s+", "", s)
    s = re.sub(r"^\[\^?\d+\]:\s*", "", s)
    s = re.sub(r"^\d+[.)]\s+", "", s)
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _looks_like_new_reference(line: str, current_len: int) -> bool:
    if NUMERIC_START_RE.match(line):
        return True
    if AUTHOR_START_RE.match(line):
        return True
    if TITLE_QUOTE_START_RE.match(line):
        return True
    if current_len > 260 and YEAR_RE.search(line):
        return True
    return False


def _split_references(tail: str) -> list[str]:
    refs: list[str] = []
    cur: list[str] = []

    for raw in (tail or "").splitlines():
        line = _clean_line(raw)

        if not line:
            if cur:
                refs.append(" ".join(cur).strip())
                cur = []
            continue

        # Skip obvious non-reference noise lines.
        low = line.lower()
        if (
            low.startswith("electronic copy available")
            or low.startswith("ssrn working paper series")
            or "terms & conditions of use" in low
            or "all use subject to" in low
            or "linked references are available on jstor" in low
        ):
            continue
        if IP_TIMESTAMP_RE.match(line):
            continue

        if cur and _looks_like_new_reference(line, len(" ".join(cur))):
            refs.append(" ".join(cur).strip())
            cur = [line]
        else:
            cur.append(line)

    if cur:
        refs.append(" ".join(cur).strip())

    cleaned: list[str] = []
    for ref in refs:
        r = re.sub(r"\s+", " ", ref).strip(" -")
        if len(r) < 20:
            continue
        r_low = r.lower()
        if URL_RE.fullmatch(r):
            continue
        if "jstor archive indicates your acceptance" in r_low:
            continue
        if "about.jstor.org/terms" in r_low:
            continue
        if "jstor.org/stable/10.2307" in r_low:
            continue
        # Keep likely bibliographic lines.
        if not (YEAR_RE.search(r) or URL_RE.search(r) or ":" in r):
            continue
        cleaned.append(r)
    return cleaned


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build AnyStyle training inputs from dataset JSON files."
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Dataset directory containing JSON files (default: python_backend_legacy/dataset).",
    )
    parser.add_argument(
        "--json-glob",
        default="*.json",
        help="Glob for dataset JSON files (default: *.json).",
    )
    parser.add_argument(
        "--workspace-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="AnyStyle workspace directory (default: this script's directory).",
    )
    parser.add_argument(
        "--max-refs",
        type=int,
        default=0,
        help="Limit number of exported references (0 = no limit).",
    )
    parser.add_argument(
        "--build-draft-xml",
        action="store_true",
        help="Generate draft XML using AnyStyle parse.",
    )
    parser.add_argument(
        "--anystyle-cmd",
        default="/home/pantera/projects/TEIA/annotarium/scripts/anystyle.sh",
        help="Command path for anystyle CLI wrapper.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dataset_dir = args.dataset_dir.expanduser().resolve()
    workspace_dir = args.workspace_dir.expanduser().resolve()

    exports_dir = workspace_dir / "exports"
    training_dir = workspace_dir / "training"
    exports_dir.mkdir(parents=True, exist_ok=True)
    training_dir.mkdir(parents=True, exist_ok=True)

    refs_txt = exports_dir / "references_raw.txt"
    refs_tsv = exports_dir / "references_with_source.tsv"
    xml_out = training_dir / "training-data.draft.xml"

    json_files = sorted(p for p in dataset_dir.glob(args.json_glob) if p.is_file())

    rows: list[tuple[str, str, int, str]] = []
    docs_with_refs = 0

    for p in json_files:
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue

        pages = _get_pages_from_json(obj)
        if not pages:
            continue

        full_md_parts: list[str] = []
        for pg in pages:
            md = pg.get("markdown")
            if isinstance(md, str) and md.strip():
                full_md_parts.append(md)
        if not full_md_parts:
            continue

        tail = _extract_bibliography_tail("\n\n".join(full_md_parts))
        if not tail:
            continue

        refs = _split_references(tail)
        if not refs:
            continue

        docs_with_refs += 1
        pdf_path = str(obj.get("pdf_path") or "")
        for i, ref in enumerate(refs, start=1):
            rows.append((str(p), pdf_path, i, ref))

    if args.max_refs > 0:
        rows = rows[: args.max_refs]

    refs_txt.write_text("\n".join(r[3] for r in rows) + ("\n" if rows else ""), encoding="utf-8")

    with refs_tsv.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(["json_file", "pdf_path", "reference_index", "reference_text"])
        w.writerows(rows)

    print(f"dataset_dir={dataset_dir}")
    print(f"json_files_scanned={len(json_files)}")
    print(f"docs_with_extracted_refs={docs_with_refs}")
    print(f"references_exported={len(rows)}")
    print(f"references_txt={refs_txt}")
    print(f"references_tsv={refs_tsv}")

    if args.build_draft_xml:
        cmd = [args.anystyle_cmd, "--stdout", "-f", "xml", "parse", str(refs_txt)]
        proc = subprocess.run(cmd, text=True, capture_output=True)
        if proc.returncode != 0:
            print("draft_xml_status=failed")
            print(proc.stderr.strip())
            return proc.returncode
        xml_out.write_text(proc.stdout, encoding="utf-8")
        print(f"draft_xml_status=ok")
        print(f"draft_xml={xml_out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
