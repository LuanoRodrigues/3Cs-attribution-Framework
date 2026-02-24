#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
RESULT_FILE_NAME = "results_aggregated.json"
READ_ME_TEXT = """# Annotarium aggregated results

This folder stores a single-file result package for the latest `annotarium/outputs` run.

## Output file

- `results_aggregated.json`

It contains a single JSON object with:
- `artifacts.extraction`
- `artifacts.adapters`
- `artifacts.methodology`
- `artifacts.scoring`
- `artifacts.reports`
- `artifacts.validation`
- optional `artifacts.root` (pipeline summaries when enabled)

Each file entry includes:
- `file_name`
- `file_path`
- `size_bytes`
- `sha256`
- `content` (parsed JSON when possible, otherwise plain text)

Use this when you want one portable file instead of per-folder copies.
"""


@dataclass
class FileMeta:
    category: str
    file_path: str
    size_bytes: int
    sha256: str


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_payload(path: Path) -> Any:
    """Prefer JSON parsing for .json, otherwise plain UTF-8 text; fallback to hex on read error."""
    try:
        if path.suffix.lower() == ".json":
            return json.loads(path.read_text(encoding="utf-8"))
        return path.read_text(encoding="utf-8")
    except Exception:
        return {
            "encoding": "hex",
            "data": path.read_bytes().hex(),
        }


def collect_dir_files(source_dir: Path, exts: set[str] | None = None) -> list[Path]:
    if not source_dir.is_dir():
        return []
    files = [p for p in source_dir.iterdir() if p.is_file()]
    if exts is None:
        return sorted(files)
    return sorted([p for p in files if p.suffix.lower() in exts])


def build_category_payload(category: str, source_dir: Path, exts: set[str] | None = None) -> tuple[dict[str, Any], list[FileMeta]]:
    files_meta: list[FileMeta] = []
    entries: list[dict[str, Any]] = []

    for path in collect_dir_files(source_dir, exts=exts):
        digest = file_sha256(path)
        size_bytes = path.stat().st_size
        data = load_payload(path)

        file_payload = {
            "file_name": path.name,
            "file_path": str(path),
            "size_bytes": size_bytes,
            "sha256": digest,
            "content": data,
        }
        entries.append(file_payload)
        files_meta.append(
            FileMeta(
                category=category,
                file_path=str(path),
                size_bytes=size_bytes,
                sha256=digest,
            )
        )

    return {
        "source_dir": str(source_dir),
        "file_count": len(entries),
        "files": entries,
    }, files_meta


def build_payload(outputs_root: Path, include_pipeline_summary: bool) -> tuple[dict[str, Any], list[FileMeta]]:
    payload: dict[str, Any] = {
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_outputs_root": str(outputs_root),
        "artifacts": {},
    }

    manifest: list[FileMeta] = []
    categories = [
        ("extraction", None),
        ("adapters", None),
        ("methodology", {".json", ".html", ".md"}),
        ("scoring", None),
        ("reports", None),
        ("validation", None),
    ]

    for category, exts in categories:
        category_payload, files_meta = build_category_payload(category, outputs_root / category, exts=exts)
        payload["artifacts"][category] = category_payload
        manifest.extend(files_meta)

    if include_pipeline_summary:
        root_files: list[dict[str, Any]] = []
        root_dir = outputs_root
        for path in sorted([p for p in root_dir.glob("pipeline_summary.*") if p.is_file()]):
            digest = file_sha256(path)
            size_bytes = path.stat().st_size
            root_files.append(
                {
                    "file_name": path.name,
                    "file_path": str(path),
                    "size_bytes": size_bytes,
                    "sha256": digest,
                    "content": load_payload(path),
                }
            )
            manifest.append(
                FileMeta(
                    category="root",
                    file_path=str(path),
                    size_bytes=size_bytes,
                    sha256=digest,
                )
            )
        payload["artifacts"]["root"] = {
            "source_dir": str(root_dir),
            "file_count": len(root_files),
            "files": root_files,
        }

    payload["manifest"] = {
        "total_files": len(manifest),
        "total_bytes": sum(m.size_bytes for m in manifest),
        "files": [
            {
                "category": m.category,
                "file_path": m.file_path,
                "size_bytes": m.size_bytes,
                "sha256": m.sha256,
            }
            for m in manifest
        ],
    }
    return payload, manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a single-file aggregated results bundle from annotarium/outputs."
    )
    parser.add_argument(
        "--outputs-root",
        default=str(ROOT / "outputs"),
        help="Source folder with pipeline outputs.",
    )
    parser.add_argument(
        "--results-root",
        default=str(ROOT / "outputs" / "results"),
        help="Root folder to place the aggregated JSON.",
    )
    parser.add_argument(
        "--result-file",
        default=RESULT_FILE_NAME,
        help="Filename/path (relative to --results-root) for aggregated JSON.",
    )
    parser.add_argument(
        "--include-pipeline-summary",
        action="store_true",
        help="Include root-level pipeline_summary.* files.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    outputs_root = Path(args.outputs_root).resolve()
    results_root = Path(args.results_root).resolve()
    result_file_name = args.result_file
    result_file = (
        result_file_name
        if Path(result_file_name).is_absolute()
        else results_root / result_file_name
    )

    payload, manifest = build_payload(outputs_root, args.include_pipeline_summary)
    results_root.mkdir(parents=True, exist_ok=True)
    result_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    readme_path = results_root / "README.md"
    readme_path.write_text(READ_ME_TEXT, encoding="utf-8")

    print(
        f"[result-template] wrote {len(manifest)} files to {result_file}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
