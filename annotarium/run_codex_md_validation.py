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


DEFAULT_SCHEMA = "annotarium/cyber_attribution_markdown_extraction_v2_schema.json"
DEFAULT_OUTPUT = "annotarium/outputs/extraction/output.json"
DEFAULT_REPORT_JSON = "annotarium/outputs/validation/validation_report.json"
DEFAULT_REPORT_MD = "annotarium/outputs/validation/validation_report.md"
DEFAULT_MODELS = "gpt-4o,gpt-4o-mini"


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


def _resolve_path(raw: str, *, base: Path) -> Path:
    path = Path(raw).expanduser()
    return (base / path).resolve() if not path.is_absolute() else path.resolve()


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


def _run_cmd(cmd: list[str], *, cwd: Path, env: dict[str, str]) -> StepResult:
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


def _step_payload(step: StepResult) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": step.ok,
        "returncode": step.returncode,
        "command": step.command,
    }
    if step.parsed_json:
        payload["summary"] = step.parsed_json
    if step.stderr.strip():
        payload["stderr_tail"] = step.stderr[-1200:]
    return payload


def _load_json_if_exists(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            return loaded
    except Exception:
        return None
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Single-file pipeline: optional PDF->MD with Mistral OCR, "
            "schema extraction (agent or offline), and verification validation."
        )
    )
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--pdf", default="", help="Input PDF path.")
    input_group.add_argument("--markdown", default="", help="Input markdown path.")

    parser.add_argument("--markdown-out", default="", help="When --pdf is used, where to write markdown output.")
    parser.add_argument("--schema", default=DEFAULT_SCHEMA, help="Schema wrapper JSON path.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Extraction JSON output path.")
    parser.add_argument("--report-json", default=DEFAULT_REPORT_JSON, help="Validation report JSON output path.")
    parser.add_argument("--report-md", default=DEFAULT_REPORT_MD, help="Validation report markdown output path.")
    parser.add_argument(
        "--extractor",
        choices=["agent", "offline", "codex"],
        default="agent",
        help=(
            "Extraction mode: agent uses LLM extraction, offline uses deterministic extraction. "
            "The value 'codex' is accepted as a legacy alias for 'agent'."
        ),
    )
    parser.add_argument("--models", default=DEFAULT_MODELS, help="Models list for agent extractor.")
    parser.add_argument("--max-completion-tokens", type=int, default=16000, help="Max completion tokens for agent extractor.")
    parser.add_argument("--repair-attempts", type=int, default=2, help="Repair attempts when agent output fails schema.")
    parser.add_argument("--mistral-model", default="mistral-ocr-latest", help="OCR model for PDF conversion.")
    parser.add_argument("--ocr-retry", type=int, default=5, help="OCR retry count for PDF conversion.")
    parser.add_argument("--no-cache", action="store_true", help="Disable cache during PDF conversion.")
    parser.add_argument("--min-score", type=float, default=85.0, help="Minimum validation overall score.")
    parser.add_argument("--min-category-score", type=float, default=60.0, help="Minimum validation category score.")
    parser.add_argument("--allow-fail", action="store_true", help="Exit 0 even if certification is FAIL.")
    args = parser.parse_args()

    repo = _repo_root()
    base_env = dict(os.environ)
    base_env.setdefault("ANNOTARIUM_HOME", str((repo / "annotarium").resolve()))

    schema_path = _resolve_path(args.schema, base=repo)
    output_path = _resolve_path(args.output, base=repo)
    report_json_path = _resolve_path(args.report_json, base=repo)
    report_md_path = _resolve_path(args.report_md, base=repo)
    if not schema_path.is_file():
        raise SystemExit(f"[ERROR] schema file not found: {schema_path}")

    process_pdf_script = repo / "my-electron-app" / "scripts" / "process_pdf_mistral_ocr.py"
    codex_extract_script = repo / "annotarium" / "apply_schema_extraction.py"
    offline_extract_script = repo / "annotarium" / "apply_schema_extraction_offline.py"
    validator_script = repo / "annotarium" / "validate_score_extraction.py"

    for required in [validator_script, codex_extract_script, offline_extract_script]:
        if not required.is_file():
            raise SystemExit(f"[ERROR] required script not found: {required}")

    markdown_path: Path
    steps: dict[str, Any] = {}
    source_pdf: Path | None = None

    if args.pdf:
        if not process_pdf_script.is_file():
            raise SystemExit(f"[ERROR] required OCR script not found: {process_pdf_script}")
        source_pdf = _resolve_path(args.pdf, base=repo)
        if not source_pdf.is_file():
            raise SystemExit(f"[ERROR] PDF input not found: {source_pdf}")
        markdown_path = (
            _resolve_path(args.markdown_out, base=repo)
            if args.markdown_out
            else source_pdf.with_suffix(".md")
        )
        cmd_convert = [
            sys.executable,
            str(process_pdf_script),
            str(source_pdf),
            "--write-full-text-md",
            str(markdown_path),
            "--mistral-model",
            str(args.mistral_model),
            "--ocr-retry",
            str(args.ocr_retry),
        ]
        if args.no_cache:
            cmd_convert.append("--no-cache")
        convert_res = _run_cmd(cmd_convert, cwd=repo, env=base_env)
        steps["convert_pdf_to_markdown"] = _step_payload(convert_res)
        if not convert_res.ok:
            print(json.dumps({"error": "PDF->MD conversion failed", "step": steps["convert_pdf_to_markdown"]}, ensure_ascii=False, indent=2), file=sys.stderr)
            return 2
        if not markdown_path.is_file():
            print(json.dumps({"error": "Conversion completed but markdown output not found", "expected_markdown": str(markdown_path)}, ensure_ascii=False, indent=2), file=sys.stderr)
            return 2
    else:
        markdown_path = _resolve_path(args.markdown, base=repo)
        if not markdown_path.is_file():
            raise SystemExit(f"[ERROR] markdown input not found: {markdown_path}")
        steps["convert_pdf_to_markdown"] = {"skipped": True, "reason": "markdown input provided"}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    report_json_path.parent.mkdir(parents=True, exist_ok=True)
    report_md_path.parent.mkdir(parents=True, exist_ok=True)

    extractor = "agent" if args.extractor == "codex" else args.extractor

    if extractor == "agent":
        cmd_extract = [
            sys.executable,
            str(codex_extract_script),
            "--schema",
            str(schema_path),
            "--markdown",
            str(markdown_path),
            "--output",
            str(output_path),
            "--models",
            str(args.models),
            "--max-completion-tokens",
            str(args.max_completion_tokens),
            "--repair-attempts",
            str(args.repair_attempts),
        ]
    else:
        cmd_extract = [
            sys.executable,
            str(offline_extract_script),
            "--schema",
            str(schema_path),
            "--markdown",
            str(markdown_path),
            "--output",
            str(output_path),
        ]
    extract_res = _run_cmd(cmd_extract, cwd=repo, env=base_env)
    steps["extract_to_schema_json"] = _step_payload(extract_res)
    if not extract_res.ok or not output_path.is_file():
        print(json.dumps({"error": "Extraction step failed", "step": steps["extract_to_schema_json"]}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 2

    cmd_validate = [
        sys.executable,
        str(validator_script),
        "--schema",
        str(schema_path),
        "--markdown",
        str(markdown_path),
        "--output",
        str(output_path),
        "--report-json",
        str(report_json_path),
        "--report-md",
        str(report_md_path),
        "--min-score",
        str(args.min_score),
        "--min-category-score",
        str(args.min_category_score),
    ]
    validate_res = _run_cmd(cmd_validate, cwd=repo, env=base_env)
    steps["verify_and_validate"] = _step_payload(validate_res)

    report = validate_res.parsed_json or _load_json_if_exists(report_json_path)
    if report is None:
        print(
            json.dumps(
                {
                    "error": "Validation step did not produce a readable JSON report",
                    "step": steps["verify_and_validate"],
                    "expected_report": str(report_json_path),
                },
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return 2

    certification = str(report.get("certification", "UNKNOWN"))
    overall_score = report.get("overall_score")
    category_scores = report.get("category_scores", {})

    summary: dict[str, Any] = {
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "extractor": extractor,
        "inputs": {
            "pdf": _display_path(source_pdf, repo) if source_pdf else None,
            "markdown": _display_path(markdown_path, repo),
            "schema": _display_path(schema_path, repo),
        },
        "outputs": {
            "extraction_json": _display_path(output_path, repo),
            "validation_json": _display_path(report_json_path, repo),
            "validation_markdown": _display_path(report_md_path, repo),
        },
        "result": {
            "certification": certification,
            "overall_score": overall_score,
            "category_scores": category_scores,
        },
        "steps": steps,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if certification != "PASS" and not args.allow_fail:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
