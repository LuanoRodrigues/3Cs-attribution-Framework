from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any


_RESULT_KEYS = (
    "status",
    "errors",
    "warnings",
    "metrics",
    "artifacts_written",
    "data",
    "outputs",
    "context_updates",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def default_result() -> dict[str, Any]:
    return {
        "status": "ok",
        "errors": [],
        "warnings": [],
        "metrics": {},
        "artifacts_written": [],
        "data": {},
        "outputs": {},
        "context_updates": {},
    }


def ensure_result_shape(result: dict[str, Any]) -> dict[str, Any]:
    shaped = {k: result.get(k) for k in _RESULT_KEYS}
    shaped["errors"] = list(shaped.get("errors") or [])
    shaped["warnings"] = list(shaped.get("warnings") or [])
    shaped["metrics"] = dict(shaped.get("metrics") or {})
    shaped["artifacts_written"] = sorted({str(p) for p in (shaped.get("artifacts_written") or [])})
    shaped["data"] = dict(shaped.get("data") or {})
    shaped["outputs"] = dict(shaped.get("outputs") or {})
    shaped["context_updates"] = dict(shaped.get("context_updates") or {})
    shaped["status"] = "ok" if shaped.get("status") == "ok" and not shaped["errors"] else "error"
    return shaped


def python_bin(explicit: str | None = None) -> str:
    return explicit or sys.executable


def parse_last_json_blob(stdout: str) -> dict[str, Any] | None:
    text = (stdout or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass

    start = text.rfind("\n{")
    if start != -1:
        candidate = text[start + 1 :].strip()
    else:
        brace = text.find("{")
        candidate = text[brace:].strip() if brace != -1 else ""

    if not candidate:
        return None

    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def run_script(
    cmd: list[str],
    cwd: Path | None = None,
    timeout_seconds: float | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd is not None else None,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout_seconds,
    )


def normalize_path(path_like: str | Path) -> str:
    return str(Path(path_like).expanduser().resolve())
