from __future__ import annotations

from pathlib import Path
from typing import Any

from ._common import default_result, ensure_result_shape, normalize_path, parse_last_json_blob, python_bin, repo_root, run_script


DEFAULT_SCHEMA = "annotarium/cyber_attribution_markdown_extraction_v2_schema.json"


def run(
    *,
    markdown_path: str = "",
    output_path: str = "",
    schema_path: str = DEFAULT_SCHEMA,
    report_json_path: str = "annotarium/validation_report.json",
    report_md_path: str = "annotarium/validation_report.md",
    min_score: float = 85.0,
    min_category_score: float = 60.0,
    python_executable: str | None = None,
    state_dir: str = "",
) -> dict[str, Any]:
    result = default_result()
    root = repo_root()
    script = root / "annotarium" / "validate_score_extraction.py"

    if not script.is_file():
        result["errors"].append(f"missing script: {script}")
        return ensure_result_shape(result)
    if not markdown_path:
        result["errors"].append("markdown_path is required")
        return ensure_result_shape(result)
    if not output_path:
        if state_dir:
            output_path = str(Path(state_dir).expanduser().resolve() / "outputs" / "schema_extraction.output.json")
        else:
            result["errors"].append("output_path is required")
            return ensure_result_shape(result)
    if state_dir:
        sdir = Path(state_dir).expanduser().resolve() / "outputs"
        if report_json_path == "annotarium/validation_report.json":
            report_json_path = str(sdir / "validation_report.json")
        if report_md_path == "annotarium/validation_report.md":
            report_md_path = str(sdir / "validation_report.md")

    cmd = [
        python_bin(python_executable),
        str(script),
        "--schema",
        normalize_path(schema_path),
        "--markdown",
        normalize_path(markdown_path),
        "--output",
        normalize_path(output_path),
        "--report-json",
        normalize_path(report_json_path),
        "--report-md",
        normalize_path(report_md_path),
        "--min-score",
        str(float(min_score)),
        "--min-category-score",
        str(float(min_category_score)),
    ]

    proc = run_script(cmd, cwd=root)
    payload = parse_last_json_blob(proc.stdout)

    result["metrics"].update(
        {
            "returncode": proc.returncode,
            "stdout_len": len(proc.stdout or ""),
            "stderr_len": len(proc.stderr or ""),
        }
    )

    for report_path in (report_json_path, report_md_path):
        candidate = Path(report_path).expanduser().resolve()
        if candidate.is_file():
            result["artifacts_written"].append(str(candidate))
        else:
            result["warnings"].append(f"expected report not found: {candidate}")
    result["outputs"] = {
        "report_json_path": str(Path(report_json_path).expanduser().resolve()),
        "report_md_path": str(Path(report_md_path).expanduser().resolve()),
    }
    result["context_updates"] = dict(result["outputs"])

    if payload:
        result["data"]["report"] = payload
        overall = ((payload.get("scores") or {}).get("overall"))
        certified = payload.get("certified")
        if isinstance(overall, (int, float)):
            result["metrics"]["overall_score"] = float(overall)
        if isinstance(certified, bool):
            result["metrics"]["certified"] = certified
            if not certified:
                result["warnings"].append("validation report is not certified")

    if proc.returncode != 0:
        result["errors"].append(f"validation script returned non-zero exit ({proc.returncode})")
    if proc.stderr.strip():
        result["warnings"].append(proc.stderr.strip())
    if payload is None:
        result["warnings"].append("script stdout did not contain a JSON object")

    return ensure_result_shape(result)
