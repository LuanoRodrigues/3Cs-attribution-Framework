from __future__ import annotations

from pathlib import Path
from typing import Any

from ._common import default_result, ensure_result_shape, normalize_path, parse_last_json_blob, python_bin, repo_root, run_script


def run(
    *,
    pdf_path: str,
    write_full_text_md: str = "",
    mistral_model: str = "mistral-ocr-latest",
    ocr_retry: int = 5,
    no_cache: bool = False,
    no_core_sections: bool = False,
    python_executable: str | None = None,
) -> dict[str, Any]:
    result = default_result()
    root = repo_root()
    script = root / "my-electron-app" / "scripts" / "process_pdf_mistral_ocr.py"

    if not script.is_file():
        result["errors"].append(f"missing script: {script}")
        return ensure_result_shape(result)

    cmd = [
        python_bin(python_executable),
        str(script),
        normalize_path(pdf_path),
        "--mistral-model",
        mistral_model,
        "--ocr-retry",
        str(int(ocr_retry)),
    ]
    if no_cache:
        cmd.append("--no-cache")
    if no_core_sections:
        cmd.append("--no-core-sections")
    if write_full_text_md:
        cmd.extend(["--write-full-text-md", normalize_path(write_full_text_md)])

    proc = run_script(cmd, cwd=root)
    payload = parse_last_json_blob(proc.stdout)

    result["metrics"].update({
        "returncode": proc.returncode,
        "stdout_len": len(proc.stdout or ""),
        "stderr_len": len(proc.stderr or ""),
    })

    if payload:
        result["data"]["script_payload"] = payload
        for key in ("full_text_md_path", "cache_path"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                result["artifacts_written"].append(normalize_path(value))
        md_path = payload.get("full_text_md_path") or ""
        cache_path = payload.get("cache_path") or ""
        outputs: dict[str, Any] = {}
        if isinstance(md_path, str) and md_path:
            outputs["markdown_path"] = normalize_path(md_path)
        if isinstance(cache_path, str) and cache_path:
            outputs["cache_path"] = normalize_path(cache_path)
        if outputs:
            result["outputs"] = outputs
            result["context_updates"] = dict(outputs)

    if proc.returncode != 0:
        result["errors"].append(f"process_pdf script failed (exit {proc.returncode})")
    if proc.stderr.strip():
        result["warnings"].append(proc.stderr.strip())
    if payload is None:
        result["warnings"].append("script stdout did not contain a JSON object")
    if payload is None and write_full_text_md:
        md_guess = Path(write_full_text_md).expanduser().resolve()
        if md_guess.is_file():
            result["artifacts_written"].append(str(md_guess))
            result["outputs"] = {"markdown_path": str(md_guess)}
            result["context_updates"] = {"markdown_path": str(md_guess)}

    return ensure_result_shape(result)
