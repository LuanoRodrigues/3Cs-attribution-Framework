from __future__ import annotations

from pathlib import Path
from typing import Any

from ._common import default_result, ensure_result_shape, normalize_path, parse_last_json_blob, python_bin, repo_root, run_script


def run(
    *,
    input_path: str = "",
    output_path: str = "",
    icj_score_report_path: str = "",
    consistency_audit_path: str = "",
    icj_profile: str = "balanced",
    python_executable: str | None = None,
    state_dir: str = "",
) -> dict[str, Any]:
    result = default_result()
    root = repo_root()
    script = root / "annotarium" / "score_icj.py"

    if not script.is_file():
        result["errors"].append(f"missing script: {script}")
        return ensure_result_shape(result)

    # In pipeline context, "output_path" usually points to schema extraction JSON.
    if not input_path and output_path:
        input_path = output_path

    if not input_path:
        if state_dir:
            output_guess = Path(state_dir).expanduser().resolve() / "outputs" / "schema_extraction.output.json"
            if output_guess.is_file():
                input_path = str(output_guess)
    if not input_path:
        result["errors"].append("input_path is required (expected extraction output json)")
        return ensure_result_shape(result)

    report_out = icj_score_report_path
    if not report_out:
        if state_dir:
            report_out = str(Path(state_dir).expanduser().resolve() / "outputs" / "icj_score_report.json")
        else:
            report_out = "annotarium/icj_score_report.json"

    cmd = [
        python_bin(python_executable),
        str(script),
        "--input",
        normalize_path(input_path),
        "--output",
        normalize_path(report_out),
        "--profile",
        str(icj_profile or "balanced"),
    ]
    if consistency_audit_path:
        cmd.extend(["--consistency-audit", normalize_path(consistency_audit_path)])

    proc = run_script(cmd, cwd=root)
    payload = parse_last_json_blob(proc.stdout)

    result["metrics"].update(
        {
            "returncode": proc.returncode,
            "stdout_len": len(proc.stdout or ""),
            "stderr_len": len(proc.stderr or ""),
        }
    )

    out_file = Path(report_out).expanduser().resolve()
    if out_file.is_file():
        result["artifacts_written"].append(str(out_file))
        result["metrics"]["output_size_bytes"] = out_file.stat().st_size
        result["outputs"] = {"icj_score_report_path": str(out_file)}
        result["context_updates"] = {"icj_score_report_path": str(out_file)}
    else:
        result["warnings"].append(f"expected score report not found: {out_file}")

    if payload:
        result["data"]["script_payload"] = payload
        claims_scored = payload.get("claims_scored")
        if isinstance(claims_scored, int):
            result["metrics"]["claims_scored"] = claims_scored
        extra_artifacts = payload.get("artifacts_written")
        if isinstance(extra_artifacts, list):
            for item in extra_artifacts:
                if isinstance(item, str) and item:
                    result["artifacts_written"].append(normalize_path(item))

    if proc.returncode != 0:
        result["errors"].append(f"icj scoring failed (exit {proc.returncode})")
    if proc.stderr.strip():
        result["warnings"].append(proc.stderr.strip())
    if payload is None:
        result["warnings"].append("script stdout did not contain a JSON object")

    return ensure_result_shape(result)
