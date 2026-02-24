from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._common import default_result, ensure_result_shape, normalize_path
from .tool_footnotes import run as run_footnotes


def _to_sorted_reference_list(items: dict[str, Any]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for key, value in items.items():
        idx = int(key) if str(key).isdigit() else None
        refs.append({"index": idx, "id": str(key), "text": str(value)})
    refs.sort(key=lambda r: (r["index"] is None, r["index"] if r["index"] is not None else r["id"]))
    return refs


def run(
    *,
    text: str = "",
    markdown_path: str = "",
    references: Any = None,
    references_path: str = "",
    output_path: str = "",
) -> dict[str, Any]:
    base = run_footnotes(
        text=text,
        markdown_path=markdown_path,
        references=references,
        references_path=references_path,
    )
    result = default_result()
    result["errors"].extend(base.get("errors") or [])
    result["warnings"].extend(base.get("warnings") or [])

    if base.get("status") != "ok":
        result["data"]["footnotes_result"] = base
        return ensure_result_shape(result)

    linked = ((base.get("data") or {}).get("linked") or {})
    foot = (linked.get("footnotes") or {}) if isinstance(linked, dict) else {}
    items = (foot.get("items") or {}) if isinstance(foot, dict) else {}
    refs = _to_sorted_reference_list(items if isinstance(items, dict) else {})

    result["metrics"].update(
        {
            "references_count": len(refs),
            "style": linked.get("style") if isinstance(linked, dict) else None,
        }
    )
    result["data"] = {
        "references": refs,
    }
    result["outputs"] = {"references": refs}
    result["context_updates"] = {"references": refs}

    if output_path:
        out = Path(output_path).expanduser().resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"references": refs}, ensure_ascii=False, indent=2), encoding="utf-8")
        result["artifacts_written"].append(normalize_path(out))
        result["outputs"]["references_path"] = normalize_path(out)
        result["context_updates"]["references_path"] = normalize_path(out)

    return ensure_result_shape(result)
