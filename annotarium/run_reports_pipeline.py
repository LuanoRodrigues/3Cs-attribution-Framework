#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_REPORTS_DIR = "annotarium/Reports"
DEFAULT_SCHEMA = "annotarium/cyber_attribution_markdown_extraction_v2_schema.json"


@dataclass
class StepResult:
    ok: bool
    returncode: int
    stdout: str
    stderr: str
    parsed_json: dict[str, Any] | None
    command: list[str]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _find_pdfs(reports_dir: Path, recursive: bool) -> list[Path]:
    if recursive:
        return sorted([p for p in reports_dir.rglob("*.pdf") if p.is_file()])
    return sorted([p for p in reports_dir.glob("*.pdf") if p.is_file()])


def _is_source_markdown(path: Path) -> bool:
    name = path.name.lower()
    if name == "pipeline_summary.md":
        return False
    if name.endswith(".validation_report.md"):
        return False
    return True


def _find_markdowns(reports_dir: Path, recursive: bool) -> list[Path]:
    candidates = reports_dir.rglob("*.md") if recursive else reports_dir.glob("*.md")
    return sorted([p for p in candidates if p.is_file() and _is_source_markdown(p)])


def _display_path(path: Path, repo: Path) -> str:
    try:
        return str(path.relative_to(repo))
    except Exception:
        return str(path)


def _parse_last_json_blob(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    lines = raw.splitlines()
    for i in range(len(lines) - 1, -1, -1):
        if not lines[i].lstrip().startswith("{"):
            continue
        candidate = "\n".join(lines[i:]).strip()
        try:
            obj = json.loads(candidate)
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    return None


def _run_cmd(cmd: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> StepResult:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    parsed = _parse_last_json_blob(proc.stdout)
    return StepResult(
        ok=(proc.returncode == 0),
        returncode=proc.returncode,
        stdout=proc.stdout,
        stderr=proc.stderr,
        parsed_json=parsed,
        command=cmd,
    )


def _render_summary_md(summary: dict[str, Any]) -> str:
    lines: list[str] = []
    input_mode = summary.get("input_mode", "pdf")
    total_inputs = summary.get("totals", {}).get("total_inputs", 0)
    lines.append("# Reports Pipeline Summary")
    lines.append("")
    lines.append(f"- Generated at: `{summary['generated_at_utc']}`")
    lines.append(f"- Reports dir: `{summary['reports_dir']}`")
    lines.append(f"- Input mode: `{input_mode}`")
    lines.append(f"- Total inputs: **{total_inputs}**")
    lines.append(f"- Passed validations: **{summary['totals']['passed']}**")
    lines.append(f"- Failed validations: **{summary['totals']['failed']}**")
    lines.append(f"- Avg overall score: **{summary['totals']['average_overall_score']:.2f}**")
    lines.append("")
    lines.append("## Per File")
    for row in summary["files"]:
        input_ref = row.get("input") or row.get("pdf") or row.get("markdown") or "N/A"
        lines.append(
            f"- `{input_ref}`: certification={row.get('certification','N/A')} "
            f"score={row.get('overall_score','N/A')} "
            f"claims={row.get('counts',{}).get('claims','?')} "
            f"sources={row.get('counts',{}).get('sources','?')} "
            f"tables={row.get('counts',{}).get('tables','?')} "
            f"citations={row.get('counts',{}).get('citations','?')} "
            f"artifacts={row.get('counts',{}).get('artifacts','?')}"
        )
        if row.get("errors"):
            for e in row["errors"]:
                lines.append(f"  - error: {e}")
    lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Batch pipeline: discover PDFs (or markdown files), convert to same-name markdown, "
            "run offline extraction, validate+score, and produce summary."
        )
    )
    parser.add_argument("--reports-dir", default=DEFAULT_REPORTS_DIR, help="Folder containing report files.")
    parser.add_argument("--schema", default=DEFAULT_SCHEMA, help="Schema wrapper JSON path.")
    parser.add_argument("--recursive", action="store_true", help="Recurse into subfolders when discovering input files.")
    parser.add_argument(
        "--md-only",
        action="store_true",
        help="Process existing markdown files directly (no PDF discovery/conversion).",
    )
    parser.add_argument("--skip-conversion", action="store_true", help="Skip PDF->MD conversion and reuse existing .md files.")
    parser.add_argument("--no-cache", action="store_true", help="Force no-cache recompute in process_pdf conversion step.")
    parser.add_argument("--limit", type=int, default=0, help="Optional max number of files to process.")
    parser.add_argument("--min-score", type=float, default=85.0, help="Validation minimum overall score.")
    parser.add_argument("--min-category-score", type=float, default=60.0, help="Validation minimum per-category score.")
    parser.add_argument(
        "--summary-json",
        default="",
        help="Path for summary JSON (default: <reports-dir>/pipeline_summary.json).",
    )
    parser.add_argument(
        "--summary-md",
        default="",
        help="Path for summary markdown (default: <reports-dir>/pipeline_summary.md).",
    )
    args = parser.parse_args()

    repo = _repo_root()
    reports_dir = (repo / args.reports_dir).resolve()
    schema_path = (repo / args.schema).resolve()
    if not reports_dir.is_dir():
        raise SystemExit(f"[ERROR] reports folder not found: {reports_dir}")
    if not schema_path.is_file():
        raise SystemExit(f"[ERROR] schema not found: {schema_path}")

    input_mode = "markdown" if args.md_only else "pdf"
    inputs = (
        _find_markdowns(reports_dir, recursive=bool(args.recursive))
        if args.md_only
        else _find_pdfs(reports_dir, recursive=bool(args.recursive))
    )
    if args.limit and args.limit > 0:
        inputs = inputs[: args.limit]
    if not inputs:
        expected = "*.md (excluding generated reports)" if args.md_only else "*.pdf"
        raise SystemExit(f"[ERROR] no input files found in {reports_dir} for pattern {expected}")

    process_pdf_script = repo / "my-electron-app" / "scripts" / "process_pdf_mistral_ocr.py"
    offline_script = repo / "annotarium" / "apply_schema_extraction_offline.py"
    validator_script = repo / "annotarium" / "validate_score_extraction.py"
    required_scripts = [offline_script, validator_script]
    if not args.md_only:
        required_scripts.insert(0, process_pdf_script)
    for p in required_scripts:
        if not p.is_file():
            raise SystemExit(f"[ERROR] required script missing: {p}")

    summary_json_path = (Path(args.summary_json).expanduser().resolve() if args.summary_json else reports_dir / "pipeline_summary.json")
    summary_md_path = (Path(args.summary_md).expanduser().resolve() if args.summary_md else reports_dir / "pipeline_summary.md")

    base_env = dict(os.environ)
    # Keep Python import resolution stable (user/site packages) while still
    # forcing project-local annotarium cache paths via app_constants.
    base_env.setdefault("ANNOTARIUM_HOME", str((repo / "annotarium").resolve()))

    file_rows: list[dict[str, Any]] = []
    overall_scores: list[float] = []
    passed = 0
    failed = 0

    for idx, input_path in enumerate(inputs, start=1):
        t0 = time.time()
        source_ref = _display_path(input_path, repo)

        if args.md_only:
            md_path = input_path
            out_json_path = md_path.with_suffix(".output.json")
            val_json_path = md_path.with_suffix(".validation_report.json")
            val_md_path = md_path.with_suffix(".validation_report.md")
            row: dict[str, Any] = {
                "input_mode": "markdown",
                "input": source_ref,
                "markdown": _display_path(md_path, repo),
                "output_json": _display_path(out_json_path, repo),
                "validation_report_json": _display_path(val_json_path, repo),
                "validation_report_md": _display_path(val_md_path, repo),
                "errors": [],
                "steps": {},
            }
        else:
            pdf = input_path
            md_path = pdf.with_suffix(".md")
            out_json_path = pdf.with_suffix(".output.json")
            val_json_path = pdf.with_suffix(".validation_report.json")
            val_md_path = pdf.with_suffix(".validation_report.md")
            row = {
                "input_mode": "pdf",
                "input": source_ref,
                "pdf": source_ref,
                "markdown": _display_path(md_path, repo),
                "output_json": _display_path(out_json_path, repo),
                "validation_report_json": _display_path(val_json_path, repo),
                "validation_report_md": _display_path(val_md_path, repo),
                "errors": [],
                "steps": {},
            }

        print(f"[{idx}/{len(inputs)}] Processing {source_ref}")

        # 1) Convert PDF to same-name markdown
        if args.md_only:
            if not md_path.is_file():
                row["errors"].append("input markdown file does not exist.")
            row["steps"]["convert"] = {"skipped": True, "reason": "md-only mode"}
        elif args.skip_conversion:
            if not md_path.is_file():
                row["errors"].append("skip-conversion was set but markdown file does not exist.")
            row["steps"]["convert"] = {"skipped": True}
        else:
            cmd_convert = [
                sys.executable,
                str(process_pdf_script),
                str(input_path),
                "--write-full-text-md",
                str(md_path),
            ]
            if args.no_cache:
                cmd_convert.append("--no-cache")
            convert_res = _run_cmd(cmd_convert, cwd=repo, env=base_env)
            row["steps"]["convert"] = {
                "ok": convert_res.ok,
                "returncode": convert_res.returncode,
            }
            if not convert_res.ok:
                row["errors"].append("conversion failed")
                row["steps"]["convert"]["stderr_tail"] = convert_res.stderr[-1200:]
            if not md_path.is_file():
                row["errors"].append("markdown file was not created by conversion step")

        # 2) Offline extraction
        if not row["errors"]:
            cmd_extract = [
                sys.executable,
                str(offline_script),
                "--schema",
                str(schema_path),
                "--markdown",
                str(md_path),
                "--output",
                str(out_json_path),
            ]
            extract_res = _run_cmd(cmd_extract, cwd=repo, env=base_env)
            row["steps"]["extract"] = {
                "ok": extract_res.ok,
                "returncode": extract_res.returncode,
                "summary": extract_res.parsed_json or {},
            }
            if not extract_res.ok:
                row["errors"].append("offline extraction failed")
                row["steps"]["extract"]["stderr_tail"] = extract_res.stderr[-1200:]
            if not out_json_path.is_file():
                row["errors"].append("offline extraction did not create output json")

        # 3) Validation/scoring
        if not row["errors"]:
            cmd_validate = [
                sys.executable,
                str(validator_script),
                "--schema",
                str(schema_path),
                "--markdown",
                str(md_path),
                "--output",
                str(out_json_path),
                "--report-json",
                str(val_json_path),
                "--report-md",
                str(val_md_path),
                "--min-score",
                str(args.min_score),
                "--min-category-score",
                str(args.min_category_score),
            ]
            validate_res = _run_cmd(cmd_validate, cwd=repo, env=base_env)
            report = validate_res.parsed_json or {}
            row["steps"]["validate"] = {
                "ok": validate_res.ok,
                "returncode": validate_res.returncode,
            }
            if report:
                row["certification"] = report.get("certification")
                row["overall_score"] = report.get("overall_score")
                row["category_scores"] = report.get("category_scores", {})
                row["counts"] = report.get("summary_counts", {})
                if isinstance(report.get("overall_score"), (int, float)):
                    overall_scores.append(float(report["overall_score"]))
            if not val_json_path.is_file():
                row["errors"].append("validation report json was not created")
            if row.get("certification") == "PASS":
                passed += 1
            else:
                failed += 1
                if not row["errors"]:
                    row["errors"].append("validation certification is FAIL")

        if row["errors"] and "certification" not in row:
            row["certification"] = "FAIL"
            failed += 1

        row["duration_seconds"] = round(time.time() - t0, 3)
        file_rows.append(row)

    avg_score = sum(overall_scores) / len(overall_scores) if overall_scores else 0.0
    summary = {
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "reports_dir": _display_path(reports_dir, repo),
        "schema": _display_path(schema_path, repo),
        "input_mode": input_mode,
        "totals": {
            "total_inputs": len(inputs),
            "total_pdfs": len(inputs) if input_mode == "pdf" else 0,
            "total_markdowns": len(inputs) if input_mode == "markdown" else 0,
            "passed": passed,
            "failed": failed,
            "average_overall_score": round(avg_score, 4),
        },
        "files": file_rows,
    }

    summary_json_path.parent.mkdir(parents=True, exist_ok=True)
    summary_json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    summary_md_path.parent.mkdir(parents=True, exist_ok=True)
    summary_md_path.write_text(_render_summary_md(summary), encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
