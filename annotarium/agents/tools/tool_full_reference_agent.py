from __future__ import annotations

from pathlib import Path
from typing import Any
import subprocess

from ._common import (
    default_result,
    ensure_result_shape,
    normalize_path,
    parse_last_json_blob,
    python_bin,
    repo_root,
    run_script,
)


def _as_flag(name: str, value: Any) -> list[str]:
    return [name] if bool(value) else []


def run(
    *,
    pdf_path: str = "",
    markdown_path: str = "",
    output_path: str = "",
    state_dir: str = "",
    expected_footnotes_max: int = 0,
    llm_for_all_missing: bool = True,
    validate_each_with_llm: bool = True,
    fail_on_llm_reject: bool = True,
    extract_biblio_with_llm: bool = True,
    quality_min_avg_confidence: float = 0.5,
    quality_max_unresolved: int = 0,
    llm_cache_path: str = "",
    no_llm_cache: bool = False,
    biblio_checkpoint_path: str = "",
    resume_biblio_checkpoint: bool = True,
    full_reference_timeout_seconds: float = 1800.0,
    collect_visuals_source: str = "markdown",
    mistral_api_key_env: str = "MISTRAL_API_KEY",
    mistral_model: str = "mistral-ocr-latest",
    mistral_visuals_cache_path: str = "",
    extract_artifacts: bool = False,
    artifact_taxonomy_json: str = "",
    artifact_max_images: int = 30,
    artifact_max_tables: int = 100,
    python_executable: str | None = None,
) -> dict[str, Any]:
    result = default_result()
    root = repo_root()
    script = root / "annotarium" / "agents" / "scripts" / "infer_missing_footnotes.py"
    if not script.is_file():
        result["errors"].append(f"missing script: {script}")
        return ensure_result_shape(result)

    if not pdf_path:
        result["errors"].append("pdf_path is required")
        return ensure_result_shape(result)

    out = output_path
    if not out:
        base = Path(state_dir).expanduser().resolve() / "outputs" if state_dir else (root / "annotarium" / "session")
        base.mkdir(parents=True, exist_ok=True)
        stem = Path(pdf_path).stem
        out = str((base / f"{stem}.full_reference_agent.output.json").resolve())

    cmd = [
        python_bin(python_executable),
        str(script),
        "--pdf",
        normalize_path(pdf_path),
        "--output",
        normalize_path(out),
    ]
    if markdown_path:
        cmd.extend(["--markdown", normalize_path(markdown_path)])
    if int(expected_footnotes_max) > 0:
        cmd.extend(["--expected-footnotes-max", str(int(expected_footnotes_max))])

    cmd.extend(_as_flag("--llm-for-all-missing", llm_for_all_missing))
    cmd.extend(_as_flag("--validate-each-with-llm", validate_each_with_llm))
    cmd.extend(_as_flag("--fail-on-llm-reject", fail_on_llm_reject))
    cmd.extend(_as_flag("--extract-biblio-with-llm", extract_biblio_with_llm))
    cmd.extend(_as_flag("--no-llm-cache", no_llm_cache))
    if llm_cache_path:
        cmd.extend(["--llm-cache-path", normalize_path(llm_cache_path)])
    if biblio_checkpoint_path:
        cmd.extend(["--biblio-checkpoint-path", normalize_path(biblio_checkpoint_path)])
    if resume_biblio_checkpoint:
        cmd.append("--resume-biblio-checkpoint")
    cmd.extend(["--quality-min-avg-confidence", str(float(quality_min_avg_confidence))])
    cmd.extend(["--quality-max-unresolved", str(int(quality_max_unresolved))])
    if collect_visuals_source in ("markdown", "pdf", "both", "mistral", "markdown+mistral", "all"):
        cmd.extend(["--collect-visuals-source", collect_visuals_source])
    if mistral_api_key_env:
        cmd.extend(["--mistral-api-key-env", str(mistral_api_key_env)])
    if mistral_model:
        cmd.extend(["--mistral-model", str(mistral_model)])
    if mistral_visuals_cache_path:
        cmd.extend(["--mistral-visuals-cache-path", normalize_path(mistral_visuals_cache_path)])
    cmd.extend(_as_flag("--extract-artifacts", extract_artifacts))
    if artifact_taxonomy_json:
        cmd.extend(["--artifact-taxonomy-json", normalize_path(artifact_taxonomy_json)])
    cmd.extend(["--artifact-max-images", str(int(artifact_max_images))])
    cmd.extend(["--artifact-max-tables", str(int(artifact_max_tables))])

    try:
        proc = run_script(cmd, cwd=root, timeout_seconds=float(full_reference_timeout_seconds))
    except subprocess.TimeoutExpired:
        result["errors"].append(
            f"full reference agent timed out after {float(full_reference_timeout_seconds)}s"
        )
        return ensure_result_shape(result)
    result["metrics"].update(
        {
            "returncode": proc.returncode,
            "stdout_len": len(proc.stdout or ""),
            "stderr_len": len(proc.stderr or ""),
        }
    )
    if proc.stderr.strip():
        result["warnings"].append(proc.stderr.strip())
    if proc.returncode != 0:
        result["errors"].append(f"full reference agent failed (exit {proc.returncode})")

    output_json_path = None
    for line in (proc.stdout or "").strip().splitlines():
        line = line.strip()
        if line.endswith(".json"):
            output_json_path = line
    if output_json_path is None:
        candidate = Path(out).expanduser().resolve()
        if candidate.is_file():
            output_json_path = str(candidate)
    if output_json_path:
        result["artifacts_written"].append(normalize_path(output_json_path))
        result["outputs"]["full_reference_output_path"] = normalize_path(output_json_path)
        result["context_updates"]["full_reference_output_path"] = normalize_path(output_json_path)

        try:
            import json

            payload = json.loads(Path(output_json_path).read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                result["data"]["full_reference_output"] = payload
                if "structured_references" in payload:
                    result["outputs"]["structured_references"] = payload["structured_references"]
                    result["context_updates"]["structured_references"] = payload["structured_references"]
                if "recovered_items" in payload:
                    result["outputs"]["recovered_items"] = payload["recovered_items"]
                    result["context_updates"]["recovered_items"] = payload["recovered_items"]
                q = payload.get("quality_gate")
                if isinstance(q, dict):
                    result["metrics"]["quality_passed"] = bool(q.get("passed"))
        except Exception as exc:
            result["warnings"].append(f"failed to parse output json: {type(exc).__name__}: {exc}")

    # Keep compatibility with helper parsing patterns used elsewhere.
    parse_last_json_blob(proc.stdout or "")
    return ensure_result_shape(result)
