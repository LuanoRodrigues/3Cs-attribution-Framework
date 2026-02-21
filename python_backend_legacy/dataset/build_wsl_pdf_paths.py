#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any

WINDOWS_DRIVE_RE = re.compile(r"^([A-Za-z]):[\\/](.*)$")


def windows_to_wsl_path(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return raw
    if raw.startswith("/mnt/"):
        return raw

    match = WINDOWS_DRIVE_RE.match(raw)
    if not match:
        return raw.replace("\\", "/")

    drive = match.group(1).lower()
    tail = match.group(2).replace("\\", "/")
    return f"/mnt/{drive}/{tail}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Scan dataset JSON files, extract top-level pdf_path, convert Windows paths "
            "to WSL /mnt/<drive>/..., and optionally write changes back."
        )
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Directory containing dataset JSON files (default: python_backend_legacy/dataset).",
    )
    parser.add_argument(
        "--glob",
        default="*.json",
        help="Glob pattern under dataset-dir (default: *.json).",
    )
    parser.add_argument(
        "--out-csv",
        type=Path,
        default=None,
        help="Optional CSV output path for mapping rows.",
    )
    parser.add_argument(
        "--write-json-field",
        default="",
        help=(
            "If set (e.g. pdf_path_wsl), write converted path to this top-level field "
            "for each JSON file that has pdf_path."
        ),
    )
    parser.add_argument(
        "--overwrite-pdf-path",
        action="store_true",
        help="Overwrite top-level pdf_path with converted WSL path.",
    )
    parser.add_argument(
        "--only-existing",
        action="store_true",
        help="When set, mark converted path only if file exists in WSL.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dataset_dir: Path = args.dataset_dir.expanduser().resolve()
    out_csv: Path | None = args.out_csv.expanduser().resolve() if args.out_csv else None

    if not dataset_dir.is_dir():
        raise SystemExit(f"dataset directory not found: {dataset_dir}")

    json_files = sorted(dataset_dir.glob(args.glob))
    rows: list[dict[str, Any]] = []

    processed = 0
    missing_pdf_path = 0
    updated = 0

    for json_path in json_files:
        if not json_path.is_file():
            continue

        try:
            obj = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception as exc:
            rows.append(
                {
                    "json_file": str(json_path),
                    "pdf_path_original": "",
                    "pdf_path_wsl": "",
                    "exists": "",
                    "status": f"json_error:{exc.__class__.__name__}",
                }
            )
            continue

        if not isinstance(obj, dict):
            rows.append(
                {
                    "json_file": str(json_path),
                    "pdf_path_original": "",
                    "pdf_path_wsl": "",
                    "exists": "",
                    "status": "not_object",
                }
            )
            continue

        processed += 1
        original = obj.get("pdf_path")
        if not isinstance(original, str) or not original.strip():
            missing_pdf_path += 1
            rows.append(
                {
                    "json_file": str(json_path),
                    "pdf_path_original": "",
                    "pdf_path_wsl": "",
                    "exists": "",
                    "status": "missing_pdf_path",
                }
            )
            continue

        wsl_path = windows_to_wsl_path(original)
        exists = Path(wsl_path).exists()

        status = "ok"
        if args.only_existing and not exists:
            status = "missing_in_wsl"

        should_write = args.overwrite_pdf_path or bool(args.write_json_field)
        if should_write and (not args.only_existing or exists):
            changed = False
            if args.write_json_field:
                if obj.get(args.write_json_field) != wsl_path:
                    obj[args.write_json_field] = wsl_path
                    changed = True
            if args.overwrite_pdf_path and obj.get("pdf_path") != wsl_path:
                obj["pdf_path"] = wsl_path
                changed = True
            if changed:
                json_path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
                updated += 1

        rows.append(
            {
                "json_file": str(json_path),
                "pdf_path_original": original,
                "pdf_path_wsl": wsl_path,
                "exists": str(exists).lower(),
                "status": status,
            }
        )

    if out_csv:
        out_csv.parent.mkdir(parents=True, exist_ok=True)
        with out_csv.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(
                fh,
                fieldnames=["json_file", "pdf_path_original", "pdf_path_wsl", "exists", "status"],
            )
            writer.writeheader()
            writer.writerows(rows)

    total_with_pdf = sum(1 for r in rows if r.get("status") in {"ok", "missing_in_wsl"})
    existing_count = sum(1 for r in rows if r.get("exists") == "true")

    print(f"dataset_dir={dataset_dir}")
    print(f"json_files_seen={len(json_files)}")
    print(f"json_objects_processed={processed}")
    print(f"with_pdf_path={total_with_pdf}")
    print(f"missing_pdf_path={missing_pdf_path}")
    print(f"wsl_path_exists={existing_count}")
    print(f"json_files_updated={updated}")
    if out_csv:
        print(f"csv_written={out_csv}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
