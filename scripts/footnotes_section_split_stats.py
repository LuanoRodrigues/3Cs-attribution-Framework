#!/usr/bin/env python3
"""
Measure section-splitting quality for `python_backend_legacy` markdown-in-JSON files.

This script is intentionally focused on section splitting metrics only.
It does not mutate references/footnotes payloads.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


SECTION_CUE_RE = re.compile(
    r"(?i)\b("
    r"abstract|introduction|background|method(?:s|ology)?|results|discussion|"
    r"conclusion|concluding remarks|references|bibliography|appendix|acknowledg(?:e)?ments?"
    r")\b"
)
HASH_STEM_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass
class SectionStats:
    lines_nonempty: int
    candidate_heading_lines: int
    standalone_heading_lines: int
    glued_heading_lines: int
    heading_split_score: float

    def as_dict(self) -> Dict[str, Any]:
        return {
            "lines_nonempty": self.lines_nonempty,
            "candidate_heading_lines": self.candidate_heading_lines,
            "standalone_heading_lines": self.standalone_heading_lines,
            "glued_heading_lines": self.glued_heading_lines,
            "heading_split_score": self.heading_split_score,
        }


def load_parser_module(repo_root: Path):
    parser_path = repo_root / "python_backend_legacy" / "llms" / "footnotes_parser.py"
    spec = importlib.util.spec_from_file_location("footnotes_parser_live", parser_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to import parser at {parser_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def is_hash_named(path: Path) -> bool:
    return bool(HASH_STEM_RE.fullmatch(path.stem))


def iter_json_files(dataset_dir: Path, hash_only: bool, limit: int | None) -> List[Path]:
    files = sorted(p for p in dataset_dir.glob("*.json") if p.is_file())
    if hash_only:
        files = [p for p in files if is_hash_named(p)]
    if limit is not None:
        files = files[: max(0, limit)]
    return files


def extract_full_text(obj: Dict[str, Any]) -> str:
    full_text = obj.get("full_text")
    if isinstance(full_text, str) and full_text.strip():
        return full_text
    markdown = obj.get("markdown")
    if isinstance(markdown, str) and markdown.strip():
        return markdown
    pages = obj.get("pages_text")
    if isinstance(pages, list):
        parts: List[str] = []
        for page in pages:
            if not isinstance(page, dict):
                continue
            txt = page.get("markdown")
            if not isinstance(txt, str):
                txt = page.get("text")
            if isinstance(txt, str) and txt.strip():
                parts.append(txt.strip())
        if parts:
            return "\n\n".join(parts)
    return ""


def _is_glued_heading_line(line: str, looks_like_section_title) -> bool:
    s = line.strip()
    if not s:
        return False
    if looks_like_section_title(s):
        return False
    if len(s.split()) < 12:
        return False
    if not SECTION_CUE_RE.search(s):
        return False
    # Common false-positive reduction: avoid pure TOC lines.
    if re.search(r"\.{3,}\s*\d+\s*$", s):
        return False
    return True


def compute_stats(text: str, looks_like_section_title) -> SectionStats:
    lines = [ln.rstrip() for ln in (text or "").splitlines()]
    nonempty = [ln for ln in lines if ln.strip()]
    candidate = 0
    standalone = 0
    glued = 0
    for ln in nonempty:
        if SECTION_CUE_RE.search(ln) or looks_like_section_title(ln):
            candidate += 1
        if looks_like_section_title(ln):
            standalone += 1
        elif _is_glued_heading_line(ln, looks_like_section_title):
            glued += 1
    denom = standalone + glued
    score = (standalone / denom) if denom else 1.0
    return SectionStats(
        lines_nonempty=len(nonempty),
        candidate_heading_lines=candidate,
        standalone_heading_lines=standalone,
        glued_heading_lines=glued,
        heading_split_score=score,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compute section split stats for dataset JSON files.")
    parser.add_argument(
        "--dataset-dir",
        default="python_backend_legacy/dataset",
        help="Dataset directory containing JSON docs.",
    )
    parser.add_argument(
        "--output",
        default="python_backend_legacy/dataset/section_split_stats.json",
        help="Output report path.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional limit of files.",
    )
    parser.add_argument(
        "--hash-only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Only include files whose stem is a 64-char lowercase hash.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    dataset_dir = (repo_root / args.dataset_dir).resolve()
    output_path = (repo_root / args.output).resolve()

    if not dataset_dir.exists():
        raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")

    module = load_parser_module(repo_root)
    detect_citation_style = getattr(module, "detect_citation_style")
    make_flat_text = getattr(module, "make_flat_text")
    looks_like_section_title = getattr(module, "looks_like_section_title")

    files = iter_json_files(dataset_dir, hash_only=args.hash_only, limit=args.limit)
    if not files:
        raise RuntimeError(f"No JSON files found in {dataset_dir}")

    records: List[Dict[str, Any]] = []
    ok = 0
    for idx, path in enumerate(files, start=1):
        rel = str(path.relative_to(repo_root))
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(obj, dict):
                raise ValueError("Top-level JSON is not an object.")
            full_text = extract_full_text(obj)
            if not full_text.strip():
                raise ValueError("No markdown/full_text available.")
            style = detect_citation_style(full_text)
            flat_text = make_flat_text(full_text, style)

            full_stats = compute_stats(full_text, looks_like_section_title)
            flat_stats = compute_stats(flat_text, looks_like_section_title)
            records.append(
                {
                    "file": rel,
                    "style": style,
                    "text_chars": len(full_text),
                    "flat_text_chars": len(flat_text),
                    "full_text_stats": full_stats.as_dict(),
                    "flat_text_stats": flat_stats.as_dict(),
                    "delta_flat_minus_full": {
                        "standalone_heading_lines": (
                            flat_stats.standalone_heading_lines - full_stats.standalone_heading_lines
                        ),
                        "glued_heading_lines": (
                            flat_stats.glued_heading_lines - full_stats.glued_heading_lines
                        ),
                        "heading_split_score": (
                            flat_stats.heading_split_score - full_stats.heading_split_score
                        ),
                    },
                }
            )
            ok += 1
        except Exception as exc:
            records.append({"file": rel, "error": f"{type(exc).__name__}: {exc}"})

        if idx % 50 == 0 or idx == len(files):
            print(f"[{idx}/{len(files)}] processed")

    ok_records = [r for r in records if "error" not in r]
    sum_flat_standalone = sum(r["flat_text_stats"]["standalone_heading_lines"] for r in ok_records)
    sum_flat_glued = sum(r["flat_text_stats"]["glued_heading_lines"] for r in ok_records)
    denom = sum_flat_standalone + sum_flat_glued
    weighted_score = (sum_flat_standalone / denom) if denom else 1.0

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_dir": str(dataset_dir),
        "options": {
            "hash_only": args.hash_only,
            "limit": args.limit,
        },
        "summary": {
            "documents_total": len(records),
            "documents_ok": ok,
            "documents_failed": len(records) - ok,
            "weighted_flat_heading_split_score": weighted_score,
            "flat_standalone_heading_lines_total": sum_flat_standalone,
            "flat_glued_heading_lines_total": sum_flat_glued,
        },
        "records": records,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Report written: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
