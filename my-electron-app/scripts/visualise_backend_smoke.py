#!/usr/bin/env python3
"""
Smoke-test the Visualise python host in isolation.

Runs the same stdin/stdout JSON protocol as Electron and prints:
  - python stdout/stderr (non-JSON lines)
  - parsed `logs` returned by the host
  - basic deck summary (slides + first slide keys)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        if (parent / "package.json").is_file() and (parent / "src").is_dir():
            return parent
    return here.parents[1]


def _split_lines(text: str) -> list[str]:
    return [line.rstrip("\n") for line in (text or "").splitlines() if line.strip()]


def _parse_python_json(stdout: str) -> tuple[dict, list[str]]:
    raw = (stdout or "").strip()
    if not raw:
        return {}, []
    try:
        return json.loads(raw), []
    except Exception:
        lines = _split_lines(raw)
        for i in range(len(lines) - 1, -1, -1):
            candidate = lines[i].strip()
            if not (candidate.startswith("{") and candidate.endswith("}")):
                continue
            try:
                return json.loads(candidate), lines[:i]
            except Exception:
                continue
    return {}, _split_lines(raw)


def main() -> int:
    repo = _repo_root()
    host = repo / "shared" / "python_backend" / "visualise" / "visualise_host.py"
    if not host.exists():
        print(f"Missing host: {host}", file=sys.stderr)
        return 2

    payload = {
        "action": "preview",
        "mode": "build_deck",
        "collectionName": "SmokeTest",
        "include": ["Data_summary"],
        "params": {"slide_notes": "false"},
        "table": {
            "columns": ["key", "title", "year", "authors", "citations", "item_type", "abstract"],
            "rows": [
                ["TESTKEY", "Test title", 2025, "Alice; Bob", 3, "Journal Article", "Some abstract text."]
            ],
        },
    }

    proc = subprocess.run(
        [sys.executable, str(host)],
        input=json.dumps(payload).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(repo),
        env={**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONPATH": str(repo / "shared")},
    )

    stdout_text = proc.stdout.decode("utf-8", errors="replace")
    stderr_text = proc.stderr.decode("utf-8", errors="replace")

    parsed, extra_stdout_logs = _parse_python_json(stdout_text)
    python_logs = [*extra_stdout_logs, *_split_lines(stderr_text)]

    print("=== pythonLogs (stdout/stderr) ===")
    for line in python_logs:
        print(line)

    print("\n=== parsed.status ===")
    print(parsed.get("status"))

    logs = parsed.get("logs")
    if isinstance(logs, list) and logs:
        print("\n=== parsed.logs ===")
        for line in logs:
            if isinstance(line, str) and line.strip():
                print(line)

    deck = (parsed.get("deck") or {}).get("slides") if isinstance(parsed.get("deck"), dict) else None
    if isinstance(deck, list):
        first = deck[0] if deck else None
        first_keys = sorted(list(first.keys())) if isinstance(first, dict) else []
        print("\n=== deck ===")
        print(f"slides={len(deck)} firstSlideKeys={first_keys}")

    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
