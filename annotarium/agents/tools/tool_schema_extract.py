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
    mode: str = "offline",
    models: str = "gpt-4o,gpt-4o-mini",
    max_completion_tokens: int = 16000,
    repair_attempts: int = 2,
    python_executable: str | None = None,
    state_dir: str = "",
) -> dict[str, Any]:
    result = default_result()
    root = repo_root()

    mode_norm = (mode or "offline").strip().lower()
    if mode_norm not in {"offline", "agent"}:
        result["errors"].append("mode must be 'offline' or 'agent'")
        return ensure_result_shape(result)
    if not markdown_path:
        result["errors"].append("markdown_path is required")
        return ensure_result_shape(result)
    if not output_path:
        if state_dir:
            output_path = str(Path(state_dir).expanduser().resolve() / "outputs" / "schema_extraction.output.json")
        else:
            output_path = "annotarium/output.json"

    script = (
        root / "annotarium" / "apply_schema_extraction_offline.py"
        if mode_norm == "offline"
        else root / "annotarium" / "apply_schema_extraction.py"
    )
    if not script.is_file():
        result["errors"].append(f"missing script: {script}")
        return ensure_result_shape(result)

    cmd = [
        python_bin(python_executable),
        str(script),
        "--schema",
        normalize_path(schema_path),
        "--markdown",
        normalize_path(markdown_path),
        "--output",
        normalize_path(output_path),
    ]
    if mode_norm == "agent":
        cmd.extend(
            [
                "--models",
                models,
                "--max-completion-tokens",
                str(int(max_completion_tokens)),
                "--repair-attempts",
                str(int(repair_attempts)),
            ]
        )

    proc = run_script(cmd, cwd=root)
    payload = parse_last_json_blob(proc.stdout)

    result["metrics"].update(
        {
            "mode": mode_norm,
            "returncode": proc.returncode,
            "stdout_len": len(proc.stdout or ""),
            "stderr_len": len(proc.stderr or ""),
        }
    )

    out_file = Path(output_path).expanduser().resolve()
    if out_file.is_file():
        result["artifacts_written"].append(str(out_file))
        result["metrics"]["output_size_bytes"] = out_file.stat().st_size
        result["outputs"] = {"output_path": str(out_file)}
        result["context_updates"] = {"output_path": str(out_file)}
    else:
        result["warnings"].append(f"expected output not found: {out_file}")

    if payload:
        result["data"]["script_payload"] = payload

    if proc.returncode != 0:
        result["errors"].append(f"schema extraction failed (exit {proc.returncode})")
    if proc.stderr.strip():
        result["warnings"].append(proc.stderr.strip())
    if payload is None:
        result["warnings"].append("script stdout did not contain a JSON object")

    return ensure_result_shape(result)
