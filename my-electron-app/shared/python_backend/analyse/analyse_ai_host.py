#!/usr/bin/env python3
"""
Electron Analyse AI host.

This is intentionally Electron-centric:
- Reads cached DataHub table JSON from <userData>/data-hub-cache/*.json (provided by Electron).
- Does NOT rely on legacy "app_constants" cache locations.

Input (stdin JSON):
{
  "tablePath": "/abs/path/to/cached_table.json",
  "cacheDir":  "/abs/path/to/userData/data-hub-cache",
  "ai": {
    "dates": "...",
    "prompt": "...",
    "batch_size": 50,
    "batch_overlapping": 10,
    "framework_analysis": true,
    "round2": "paragraphs",
    "data_scope": "All rows"
  },
  "scope": { "rowIndices": [0,1,2] }   # optional; when absent -> all rows
}

Output (stdout JSON):
{ "success": true, "result": {...}, "logs": [...] }
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


def _safe_json(obj: Any) -> str:
    def _clean(v: Any) -> Any:
        try:
            if hasattr(v, "item") and not isinstance(v, (bytes, str)):
                v = v.item()
        except Exception:
            pass
        if v is None or isinstance(v, (str, bool, int)):
            return v
        if isinstance(v, float):
            return v if math.isfinite(v) else None
        if isinstance(v, dict):
            return {str(k): _clean(vv) for k, vv in v.items()}
        if isinstance(v, (list, tuple, set)):
            return [_clean(x) for x in v]
        return str(v)

    return json.dumps(_clean(obj), ensure_ascii=True, allow_nan=False)


def _read_payload() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"error": f"invalid_json:{exc}"}


def _load_table_json(path_value: str) -> Dict[str, Any]:
    p = Path(path_value)
    raw = p.read_text(encoding="utf-8")
    parsed = json.loads(raw)
    table = parsed.get("table") if isinstance(parsed, dict) else None
    if not isinstance(table, dict):
        raise ValueError("Cached table JSON is missing {table: {...}}")
    cols = table.get("columns")
    rows = table.get("rows")
    if not isinstance(cols, list) or not isinstance(rows, list):
        raise ValueError("Cached table JSON has invalid table.columns/table.rows")
    return {"columns": cols, "rows": rows}


def _coerce_dataframe(table: Dict[str, Any]):
    try:
        import pandas as pd  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"pandas unavailable: {exc}")
    cols = [str(c) for c in (table.get("columns") or [])]
    rows = table.get("rows") or []
    return pd.DataFrame(rows, columns=cols)


def _pick_rows(df, indices: Optional[List[int]]) -> Any:
    if not indices:
        return df
    safe: List[int] = []
    n = int(getattr(df, "shape", (0, 0))[0])
    for idx in indices:
        try:
            i = int(idx)
        except Exception:
            continue
        if 0 <= i < n:
            safe.append(i)
    if not safe:
        return df
    return df.iloc[safe].reset_index(drop=True)


def main() -> None:
    logs: List[str] = []
    payload = _read_payload()
    if payload.get("error"):
        sys.stdout.write(_safe_json({"success": False, "error": payload["error"], "logs": logs}))
        return

    table_path = str(payload.get("tablePath") or "").strip()
    cache_dir = str(payload.get("cacheDir") or "").strip()
    if not table_path:
        sys.stdout.write(_safe_json({"success": False, "error": "Missing tablePath", "logs": logs}))
        return

    try:
        table = _load_table_json(table_path)
    except Exception as exc:
        sys.stdout.write(_safe_json({"success": False, "error": f"Failed to load table: {exc}", "logs": logs}))
        return

    logs.append(f"[ai_host] tablePath={table_path}")
    if cache_dir:
        logs.append(f"[ai_host] cacheDir={cache_dir}")

    try:
        df = _coerce_dataframe(table)
    except Exception as exc:
        sys.stdout.write(_safe_json({"success": False, "error": str(exc), "logs": logs}))
        return

    ai = payload.get("ai") if isinstance(payload.get("ai"), dict) else {}
    scope = payload.get("scope") if isinstance(payload.get("scope"), dict) else {}
    indices = scope.get("rowIndices") if isinstance(scope.get("rowIndices"), list) else None
    scoped_df = _pick_rows(df, indices)

    # Minimal "result" for now: Electron wiring + table scope validation.
    # This keeps the feature usable even if the legacy pipeline is unavailable on a machine.
    result = {
        "data_scope": str(ai.get("data_scope") or "All rows"),
        "dates": str(ai.get("dates") or ""),
        "batch_size": int(ai.get("batch_size") or 50),
        "batch_overlapping": int(ai.get("batch_overlapping") or 10),
        "framework_analysis": bool(ai.get("framework_analysis") if "framework_analysis" in ai else True),
        "round2": str(ai.get("round2") or "paragraphs"),
        "prompt": str(ai.get("prompt") or ""),
        "table": {
            "rows_total": int(getattr(df, "shape", (0, 0))[0]),
            "rows_scoped": int(getattr(scoped_df, "shape", (0, 0))[0]),
            "cols": int(getattr(df, "shape", (0, 0))[1]),
            "columns": [str(c) for c in list(getattr(df, "columns", []))[:32]],
        },
        "export_paths": {},
    }

    sys.stdout.write(_safe_json({"success": True, "result": result, "logs": logs}))


if __name__ == "__main__":
    main()

