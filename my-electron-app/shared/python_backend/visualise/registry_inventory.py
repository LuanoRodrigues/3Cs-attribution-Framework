#!/usr/bin/env python3
"""
Print a JSON inventory of PowerPoint section handlers available in:
  - python_backend.visualise.create_power_point (registry-driven PPT builder)
and compare them to:
  - python_backend.visualise.visualise_host._schema_and_sections (Visualise UI sections)

This script is diagnostic/dev tooling (safe to run locally).
"""

from __future__ import annotations

import json
import traceback
from typing import Any, Dict, List, Tuple


def _norm(s: str) -> str:
    return (
        (s or "")
        .strip()
        .lower()
        .replace("&", "and")
        .replace("-", "_")
        .replace(" ", "_")
    )


def _safe_name(fn: Any) -> str | None:
    try:
        return getattr(fn, "__name__", None)
    except Exception:
        return None


def main() -> int:
    out: Dict[str, Any] = {"ok": True, "errors": [], "create_power_point": {}, "visualise_host": {}}

    # Visualise host sections (UI/back-end surface)
    try:
        from python_backend.visualise import visualise_host  # type: ignore

        schema = visualise_host._schema_and_sections()  # type: ignore[attr-defined]
        out["visualise_host"]["sections"] = schema.get("sections", [])
        out["visualise_host"]["schema"] = schema.get("schema", [])
        out["visualise_host"]["section_ids"] = [
            str(s.get("id")) for s in schema.get("sections", []) if isinstance(s, dict) and s.get("id")
        ]
    except Exception:
        out["ok"] = False
        out["errors"].append({"where": "visualise_host", "trace": traceback.format_exc()})

    # create_power_point registry
    try:
        from python_backend.visualise import create_power_point  # type: ignore

        reg = create_power_point._get_section_registry()  # type: ignore[attr-defined]
        registry: Dict[str, Any] = {}
        for key, meta in (reg or {}).items():
            if not isinstance(meta, dict):
                continue
            handler = meta.get("handler")
            subsecs = meta.get("subsections") if isinstance(meta.get("subsections"), dict) else {}
            registry[key] = {
                "title": meta.get("title"),
                "handler": _safe_name(handler),
                "handler_available": bool(callable(handler)),
                "aliases": meta.get("aliases", []),
                "subsections": {
                    sk: {
                        "title": sv.get("title") if isinstance(sv, dict) else None,
                        "handler": _safe_name(sv.get("handler") if isinstance(sv, dict) else None),
                        "handler_available": bool(callable((sv or {}).get("handler")) if isinstance(sv, dict) else False),
                    }
                    for sk, sv in (subsecs or {}).items()
                },
            }
        out["create_power_point"]["registry"] = registry
        out["create_power_point"]["keys"] = sorted(registry.keys())
    except Exception:
        out["ok"] = False
        out["errors"].append({"where": "create_power_point", "trace": traceback.format_exc()})

    # Compare: which create_power_point sections are not present in visualise_host ids (rough match)
    vis_ids = set(_norm(x) for x in out.get("visualise_host", {}).get("section_ids", []) if isinstance(x, str))
    cp_keys = out.get("create_power_point", {}).get("keys", [])
    missing_in_visualise: List[str] = []
    for k in cp_keys:
        if _norm(k) not in vis_ids:
            missing_in_visualise.append(k)
    out["compare"] = {
        "missing_in_visualise_host": missing_in_visualise,
        "visualise_only": [x for x in out.get("visualise_host", {}).get("section_ids", []) if _norm(x) not in set(_norm(k) for k in cp_keys)],
    }

    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

