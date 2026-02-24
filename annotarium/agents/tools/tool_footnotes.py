from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._common import default_result, ensure_result_shape, normalize_path


try:
    from python_backend_legacy.llms.footnotes_parser import link_citations_to_footnotes
except Exception as exc:  # pragma: no cover
    link_citations_to_footnotes = None  # type: ignore[assignment]
    _IMPORT_ERR = f"{type(exc).__name__}: {exc}"
else:
    _IMPORT_ERR = ""


def _load_text(markdown_path: str) -> str:
    return Path(markdown_path).expanduser().resolve().read_text(encoding="utf-8", errors="replace")


def _load_refs(references_path: str) -> Any:
    raw = Path(references_path).expanduser().resolve().read_text(encoding="utf-8")
    return json.loads(raw)


def run(
    *,
    text: str = "",
    markdown_path: str = "",
    references: Any = None,
    references_path: str = "",
    output_path: str = "",
) -> dict[str, Any]:
    result = default_result()

    if link_citations_to_footnotes is None:
        result["errors"].append(f"failed to import footnotes parser: {_IMPORT_ERR}")
        return ensure_result_shape(result)

    if not text and not markdown_path:
        result["errors"].append("provide either text or markdown_path")
        return ensure_result_shape(result)

    source_text = text if text else _load_text(markdown_path)

    refs_raw = references
    if references_path:
        refs_raw = _load_refs(references_path)

    try:
        linked = link_citations_to_footnotes(source_text, refs_raw)
    except Exception as exc:
        result["errors"].append(f"footnotes parsing failed: {type(exc).__name__}: {exc}")
        return ensure_result_shape(result)

    foot = (linked.get("footnotes") or {}) if isinstance(linked, dict) else {}
    items = (foot.get("items") or {}) if isinstance(foot, dict) else {}
    intext = (foot.get("intext") or []) if isinstance(foot, dict) else []
    stats = (foot.get("stats") or {}) if isinstance(foot, dict) else {}

    result["metrics"].update(
        {
            "style": linked.get("style") if isinstance(linked, dict) else None,
            "footnote_items": len(items) if isinstance(items, dict) else 0,
            "footnote_intext": len(intext) if isinstance(intext, list) else 0,
            "success_occurrences": int((stats.get("success_occurrences") or 0) if isinstance(stats, dict) else 0),
        }
    )
    result["data"] = {"linked": linked}
    result["outputs"] = {"citations": linked}
    result["context_updates"] = {"citations": linked}

    if output_path:
        out = Path(output_path).expanduser().resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(linked, ensure_ascii=False, indent=2), encoding="utf-8")
        result["artifacts_written"].append(normalize_path(out))
        result["outputs"]["citations_path"] = normalize_path(out)
        result["context_updates"]["citations_path"] = normalize_path(out)

    return ensure_result_shape(result)
