from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any
from types import SimpleNamespace

from jinja2 import Environment, FileSystemLoader, select_autoescape

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from Research.adaptive_prompt_context import build_adaptive_prompt_context
from Research.systematic_review_pipeline import (
    _assert_non_placeholder_html,
    _assert_reference_and_postprocess_integrity,
    _build_dqid_evidence_payload,
    _build_reference_items,
    _citation_style_instruction,
    _clean_and_humanize_section_html,
    _clean_llm_html,
    _enrich_dqid_anchors,
    _extract_llm_text,
    _humanize_theme_tokens,
    _load_call_models_zt,
    _load_json,
    _load_section_cache,
    _make_cache_entry,
    _normalize_citation_style,
    _repo_root,
    _resolve_collection_label,
    _safe_name,
    _stable_section_custom_id,
    _validate_generated_section,
    _write_section_cache,
)

# -------------------------
# IO
# -------------------------

def _load_json_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))

def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _ensure_mapping_config(cfg: dict[str, Any]) -> dict[str, Any]:
    out = dict(cfg or {})
    out.setdefault("report", {})
    out.setdefault("llm", {})
    out.setdefault("scope", {})
    out.setdefault("corpus", {})
    out.setdefault("matrix_view", {})
    out.setdefault("figures", {})
    out.setdefault("limits", {})
    out.setdefault("dimensions", [])
    out.setdefault("priority_gaps", [])

    out["report"].setdefault("authors_list", "Automated TEIA pipeline")
    out["report"].setdefault("affiliation", "TEIA Research")
    out["report"].setdefault("version_tag", "v0.1")
    out["llm"].setdefault("function_name", "evidence_mapping_section_writer")

    out["scope"].setdefault("in", "")
    out["scope"].setdefault("out", "")
    out["scope"].setdefault("boundary_conditions", "")
    out["corpus"].setdefault("sources_consulted", "")
    out["corpus"].setdefault("selection_logic", "")
    out["corpus"].setdefault("search_strings", "")
    out["corpus"].setdefault("provenance_note", "")

    if not out["dimensions"]:
        out["dimensions"] = [
            {"name": "theme", "definition": "Top-level claim family.", "values": "Derived from dqid theme field."},
            {"name": "year_bin", "definition": "Publication year grouped into bins.", "values": "Computed from year/bin_size."},
        ]

    out["matrix_view"].setdefault("year_bin_size", 5)
    out["figures"].setdefault("heatmap_title", "Evidence density (theme x year bin)")
    out["figures"].setdefault("network_title", "Theme co-occurrence network (within item)")
    out["figures"].setdefault("timeline_title", "Temporal evidence volume")
    out["figures"].setdefault("bubble_title", "Evidence density vs recency")

    out["limits"].setdefault("max_evidence_rows", 600)
    out["limits"].setdefault("top_themes", 12)
    out["limits"].setdefault("max_year_bins", 10)
    out["limits"].setdefault("timeline_years", 18)
    out["limits"].setdefault("meta_k_min", 3)
    return out


def _to_namespace(value: Any) -> Any:
    if isinstance(value, dict):
        return SimpleNamespace(**{k: _to_namespace(v) for k, v in value.items()})
    if isinstance(value, list):
        return [_to_namespace(v) for v in value]
    return value

# -------------------------
# Corpus parsing
# -------------------------

def _extract_year(value: Any) -> int | None:
    s = str(value).strip()
    m = re.search(r"(19|20)\d{2}", s)
    if not m:
        return None
    return int(m.group(0))

def _load_items(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    npath = Path(summary["output"]["normalized_results_path"]).expanduser()
    if not npath.is_file():
        raise RuntimeError("Missing normalized_results_path for evidence mapping pipeline.")
    raw = json.loads(npath.read_text(encoding="utf-8"))
    if not raw:
        raise RuntimeError("No normalized results for evidence mapping pipeline.")
    return raw

def _build_item_records(items: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item_key, payload in items.items():
        md = payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {}
        zot = md.get("zotero_metadata", {}) if isinstance(md.get("zotero_metadata"), dict) else {}
        year = _extract_year(md.get("year"))
        if year is None:
            year = _extract_year(zot.get("date"))
        rows.append(
            {
                "item_key": item_key,
                "title": str(md.get("title") or "Untitled").strip(),
                "first_author_last": str(md.get("first_author_last") or "Unknown").strip(),
                "year": year,
                "url": str(md.get("url") or "").strip(),
            }
        )
    return rows

def _characteristics_table_html(item_records: list[dict[str, Any]], limit: int = 120) -> str:
    rows = sorted(
        item_records,
        key=lambda r: ((r["year"] if r["year"] is not None else 9999), r["first_author_last"], r["title"]),
    )[:limit]
    out = [
        "<table class='data-table'>",
        "<thead><tr><th>Item Key</th><th>Year</th><th>Author</th><th>Title</th></tr></thead>",
        "<tbody>",
    ]
    for r in rows:
        y = r["year"] if r["year"] is not None else "n.d."
        out.append(f"<tr><td>{r['item_key']}</td><td>{y}</td><td>{r['first_author_last']}</td><td>{r['title']}</td></tr>")
    out.append("</tbody></table>")
    return "\n".join(out)

def _year_histogram(item_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: Counter[int] = Counter()
    for r in item_records:
        y = r["year"]
        if y is not None:
            counts[y] += 1
    return [{"year": y, "count": counts[y]} for y in sorted(counts.keys())]

def _year_bin(year: int, bin_size: int) -> str:
    start = (year // bin_size) * bin_size
    end = start + bin_size - 1
    return f"{start}-{end}"

# -------------------------
# Evidence matrix + network
# -------------------------

def _top_k_labels(counts: dict[str, int], k: int) -> list[str]:
    return [k for k, _ in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:k]]

def _theme_counts_from_dq(dq_payload: list[dict[str, Any]]) -> dict[str, int]:
    c: Counter[str] = Counter()
    for r in dq_payload:
        theme = str(r["theme"]).strip()
        if theme:
            c[theme] += 1
    return dict(c)

def _build_evidence_matrix_theme_x_yearbin(
    *,
    dq_payload: list[dict[str, Any]],
    item_year_by_key: dict[str, int],
    item_url_by_key: dict[str, str],
    top_themes: list[str],
    year_bin_size: int,
    max_year_bins: int,
) -> dict[str, Any]:
    year_bins_counts: Counter[str] = Counter()
    for r in dq_payload:
        item_key = str(r.get("item_key") or "")
        y = item_year_by_key.get(item_key)
        if y is None:
            continue
        year_bins_counts[_year_bin(y, year_bin_size)] += 1
    col_bins = [b for b, _ in year_bins_counts.most_common(max_year_bins)]
    col_bins = sorted(col_bins)

    cell_counts: dict[tuple[str, str], Counter[str]] = {}
    for r in dq_payload:
        theme = str(r["theme"]).strip()
        if theme not in top_themes:
            continue
        item_key = str(r["item_key"])
        y = item_year_by_key.get(item_key)
        if y is None:
            continue
        b = _year_bin(y, year_bin_size)
        if b not in col_bins:
            continue
        key = (theme, b)
        if key not in cell_counts:
            cell_counts[key] = Counter()
        cell_counts[key][item_key] += 1

    rows = []
    for theme in top_themes:
        cells = []
        for b in col_bins:
            items_counter = cell_counts[(theme, b)] if (theme, b) in cell_counts else Counter()
            items = []
            for item_key, _n in items_counter.most_common(8):
                url = item_url_by_key.get(item_key, "")
                if url:
                    items.append({"id": item_key, "url": url})
                else:
                    items.append({"id": item_key, "url": ""})
            cells.append(
                {
                    "n": int(sum(items_counter.values())),
                    "quality": "",
                    "notes": "",
                    "items": items,
                }
            )
        rows.append({"label": _humanize_theme_tokens(theme), "cells": cells})

    return {
        "row_label": "Theme",
        "cols": [{"label": b} for b in col_bins],
        "rows": rows,
    }


def _item_has_quant_signal(items: dict[str, dict[str, Any]], item_key: str) -> bool:
    payload = items.get(item_key, {})
    if not isinstance(payload, dict):
        return False
    def _row_has_quant_signal(row: dict[str, Any]) -> bool:
        txt = " ".join(
            [
                str(row.get("quote") or ""),
                str(row.get("paraphrase") or ""),
                str(row.get("researcher_comment") or ""),
            ]
        )
        if re.search(r"\d", txt):
            return True
        et = str(row.get("evidence_type") or "").lower()
        if et in {"quantitative", "mixed"}:
            return True
        themes = row.get("potential_themes")
        if isinstance(themes, list):
            joined = " ".join(str(t or "").lower() for t in themes)
            if any(tok in joined for tok in ["effect", "estimate", "odds", "ratio", "confidence", "sample", "dataset"]):
                return True
        return False

    for arr_key in ("code_pdf_page", "code_intro_conclusion_extract_core_claims", "evidence_list", "section_open_coding"):
        arr = payload.get(arr_key)
        if not isinstance(arr, list):
            continue
        for ev in arr:
            if not isinstance(ev, dict):
                continue
            if _row_has_quant_signal(ev):
                return True
            nested = ev.get("evidence")
            if isinstance(nested, list):
                for inner in nested:
                    if isinstance(inner, dict) and _row_has_quant_signal(inner):
                        return True
    return False


def _build_meta_candidates(
    *,
    evidence_matrix: dict[str, Any],
    k_min: int,
    items: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cols = [str(c.get("label") or "").strip() for c in evidence_matrix.get("cols", []) if isinstance(c, dict)]
    for row in evidence_matrix.get("rows", []):
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or "").strip()
        cells = row.get("cells") if isinstance(row.get("cells"), list) else []
        for idx, cell in enumerate(cells):
            if not isinstance(cell, dict):
                continue
            year_bin = cols[idx] if idx < len(cols) else f"bin_{idx+1}"
            item_keys = []
            for it in (cell.get("items") if isinstance(cell.get("items"), list) else []):
                if isinstance(it, dict):
                    k = str(it.get("id") or "").strip()
                    if k:
                        item_keys.append(k)
            uniq = sorted(set(item_keys))
            if len(uniq) < int(k_min):
                continue
            if not any(_item_has_quant_signal(items, k) for k in uniq):
                continue
            out.append(
                {
                    "label": f"Theme={label}, YearBin={year_bin}",
                    "item_keys": uniq,
                    "n_studies": len(uniq),
                    "eligible_for_meta": True,
                    "reason": f"dense_cell_with_n_studies>={int(k_min)}_and_quant_signal_present",
                }
            )
    return out

def _theme_cooccurrence_edges(
    *,
    dq_payload: list[dict[str, Any]],
    top_themes: list[str],
) -> tuple[dict[str, int], dict[tuple[str, str], int]]:
    per_item: dict[str, set[str]] = {}
    theme_freq: Counter[str] = Counter()
    for r in dq_payload:
        item_key = str(r["item_key"])
        theme = str(r["theme"]).strip()
        if theme not in top_themes:
            continue
        if item_key not in per_item:
            per_item[item_key] = set()
        per_item[item_key].add(theme)
        theme_freq[theme] += 1

    edges: Counter[tuple[str, str]] = Counter()
    for _item_key, themes in per_item.items():
        tlist = sorted(themes)
        for i in range(0, len(tlist)):
            for j in range(i + 1, len(tlist)):
                a = tlist[i]
                b = tlist[j]
                edges[(a, b)] += 1

    return dict(theme_freq), dict(edges)

# -------------------------
# SVG figures
# -------------------------

def _svg_heatmap(
    *,
    title: str,
    row_labels: list[str],
    col_labels: list[str],
    values: list[list[int]],
    width: int = 920,
    height: int = 520,
) -> str:
    margin_left = 180
    margin_right = 30
    margin_top = 60
    margin_bottom = 120
    plot_w = width - margin_left - margin_right
    plot_h = height - margin_top - margin_bottom

    n_rows = max(1, len(row_labels))
    n_cols = max(1, len(col_labels))
    cell_w = plot_w / n_cols
    cell_h = plot_h / n_rows

    vmax = 1
    for r in values:
        for v in r:
            vmax = max(vmax, int(v))

    def _shade(v: int) -> str:
        t = v / vmax
        base = 230
        delta = int(150 * t)
        r = base - delta
        g = base - int(delta * 0.6)
        b = 255
        return f"rgb({r},{g},{b})"

    out = []
    out.append(f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' role='img' aria-label='{title}'>")
    out.append("<rect x='0' y='0' width='100%' height='100%' fill='#FAFCFF'/>")
    out.append(f"<text x='{width/2:.1f}' y='30' text-anchor='middle' font-size='16' font-weight='600' fill='#1A237E'>{title}</text>")

    for i, lab in enumerate(row_labels):
        y = margin_top + (i + 0.5) * cell_h
        out.append(f"<text x='{margin_left - 10}' y='{y:.1f}' text-anchor='end' font-size='10' fill='#455A64'>{lab}</text>")

    for j, lab in enumerate(col_labels):
        x = margin_left + (j + 0.5) * cell_w
        y = margin_top + plot_h + 18
        short_lab = str(lab)[:18] + ("..." if len(str(lab)) > 18 else "")
        out.append(f"<text x='{x:.1f}' y='{y:.1f}' text-anchor='end' font-size='10' fill='#455A64' transform='rotate(-35 {x:.1f},{y:.1f})'>{short_lab}</text>")

    for i in range(0, n_rows):
        for j in range(0, n_cols):
            v = int(values[i][j])
            x = margin_left + j * cell_w
            y = margin_top + i * cell_h
            out.append(f"<rect x='{x:.1f}' y='{y:.1f}' width='{cell_w:.1f}' height='{cell_h:.1f}' fill='{_shade(v)}' stroke='#E5ECF3'/>")
            out.append(f"<text x='{x + cell_w/2:.1f}' y='{y + cell_h/2 + 4:.1f}' text-anchor='middle' font-size='10' fill='#263238'>{v}</text>")

    out.append("</svg>")
    return "".join(out)

def _svg_timeline_bar(
    *,
    title: str,
    labels: list[str],
    values: list[int],
    width: int = 920,
    height: int = 420,
) -> str:
    labels = labels if labels else ["No data"]
    values = values if values else [0]

    max_v = max(1, max(values))
    margin_left = 70
    margin_right = 30
    margin_top = 60
    margin_bottom = 110
    plot_w = width - margin_left - margin_right
    plot_h = height - margin_top - margin_bottom
    step = plot_w / max(1, len(labels))
    bw = max(10.0, step * 0.65)

    out = []
    out.append(f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' role='img' aria-label='{title}'>")
    out.append("<rect x='0' y='0' width='100%' height='100%' fill='#FAFCFF'/>")
    out.append(f"<text x='{width/2:.1f}' y='30' text-anchor='middle' font-size='16' font-weight='600' fill='#1A237E'>{title}</text>")

    out.append(f"<line x1='{margin_left}' y1='{margin_top + plot_h}' x2='{margin_left + plot_w}' y2='{margin_top + plot_h}' stroke='#90A4AE' stroke-width='1.2'/>")
    out.append(f"<line x1='{margin_left}' y1='{margin_top}' x2='{margin_left}' y2='{margin_top + plot_h}' stroke='#90A4AE' stroke-width='1.2'/>")

    for idx, (lab, val) in enumerate(zip(labels, values)):
        x_mid = margin_left + step * idx + step / 2
        bh = (val / max_v) * plot_h
        x = x_mid - bw / 2
        y = margin_top + plot_h - bh
        out.append(f"<rect x='{x:.1f}' y='{y:.1f}' width='{bw:.1f}' height='{bh:.1f}' rx='3' fill='#1E88E5'/>")
        out.append(f"<text x='{x_mid:.1f}' y='{y - 6:.1f}' text-anchor='middle' font-size='10' fill='#263238'>{int(val)}</text>")
        out.append(f"<text x='{x_mid:.1f}' y='{margin_top + plot_h + 18:.1f}' text-anchor='end' font-size='10' fill='#455A64' transform='rotate(-35 {x_mid:.1f},{margin_top + plot_h + 18:.1f})'>{lab}</text>")

    out.append("</svg>")
    return "".join(out)

def _svg_circular_network(
    *,
    title: str,
    node_weights: dict[str, int],
    edges: dict[tuple[str, str], int],
    width: int = 920,
    height: int = 520,
) -> str:
    nodes = sorted(node_weights.keys(), key=lambda k: node_weights[k], reverse=True)
    n = max(1, len(nodes))
    cx = width / 2
    cy = height / 2 + 20
    radius = min(width, height) * 0.32

    max_w = max(1, max(node_weights.values()))
    max_e = 1
    for v in edges.values():
        max_e = max(max_e, int(v))

    pos: dict[str, tuple[float, float]] = {}
    for i, name in enumerate(nodes):
        ang = (2.0 * 3.1415926535) * (i / n)
        x = cx + radius * (0.92 * __import__("math").cos(ang))
        y = cy + radius * (0.92 * __import__("math").sin(ang))
        pos[name] = (x, y)

    out = []
    out.append(f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' role='img' aria-label='{title}'>")
    out.append("<rect x='0' y='0' width='100%' height='100%' fill='#FAFCFF'/>")
    out.append(f"<text x='{width/2:.1f}' y='30' text-anchor='middle' font-size='16' font-weight='600' fill='#1A237E'>{title}</text>")

    for (a, b), w in sorted(edges.items(), key=lambda kv: kv[1], reverse=True)[:70]:
        ax, ay = pos[a]
        bx, by = pos[b]
        sw = 1.0 + 4.0 * (w / max_e)
        out.append(f"<line x1='{ax:.1f}' y1='{ay:.1f}' x2='{bx:.1f}' y2='{by:.1f}' stroke='#90CAF9' stroke-width='{sw:.2f}' opacity='0.65'/>")

    for name in nodes:
        x, y = pos[name]
        r = 6.0 + 10.0 * (node_weights[name] / max_w)
        out.append(f"<circle cx='{x:.1f}' cy='{y:.1f}' r='{r:.1f}' fill='#0D47A1' opacity='0.92'/>")
        lab = _humanize_theme_tokens(name)
        lab = lab[:22] + ("..." if len(lab) > 22 else "")
        out.append(f"<text x='{x:.1f}' y='{y + r + 12:.1f}' text-anchor='middle' font-size='10' fill='#263238'>{lab}</text>")

    out.append("</svg>")
    return "".join(out)

# -------------------------
# LLM batching (single-batch writer)
# -------------------------

def _run_grouped_batch_sections(
    *,
    collection_name: str,
    model: str,
    function_name: str,
    section_prompts: list[tuple[str, str]],
) -> dict[str, Any]:
    if not section_prompts:
        raise RuntimeError("Grouped batch called with empty section_prompts")
    if not os.getenv("BATCH_ROOT"):
        os.environ["BATCH_ROOT"] = str((_repo_root() / "tmp").resolve())

    call_models_zt = _load_call_models_zt()
    llms_dir = _repo_root() / "python_backend_legacy" / "llms"
    if str(llms_dir) not in sys.path:
        sys.path.insert(0, str(llms_dir))
    import calling_models as cm  # type: ignore

    safe_collection = cm.safe_name(collection_name)
    safe_function = cm.safe_name(function_name)
    batch_root = Path(cm.get_batch_root())
    func_dir = batch_root / safe_function
    func_dir.mkdir(parents=True, exist_ok=True)

    input_file = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
    output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
    meta_file = func_dir / f"{safe_collection}_{safe_function}_batch_metadata.json"
    sig_file = func_dir / f"{safe_collection}_{safe_function}_request_signature.json"

    expected_jobs: list[tuple[str, str, str]] = []
    for section_name, prompt in section_prompts:
        custom_id = _stable_section_custom_id(collection_name, section_name, prompt)
        expected_jobs.append((section_name, prompt, custom_id))

    sig_payload = {"custom_ids": [cid for _, _, cid in expected_jobs]}
    sig_hash = hashlib.sha256(json.dumps(sig_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    reuse_existing = False
    if input_file.exists() and meta_file.exists() and sig_file.exists():
        old_sig = json.loads(sig_file.read_text(encoding="utf-8"))
        if str(old_sig["signature"]) == sig_hash:
            reuse_existing = True

    if not reuse_existing:
        for fp in (input_file, output_file, meta_file, sig_file):
            if fp.exists():
                fp.unlink()
        sig_file.write_text(json.dumps({"signature": sig_hash, **sig_payload}, ensure_ascii=False, indent=2), encoding="utf-8")

    pending: list[tuple[str, str]] = []
    for section_name, prompt, custom_id in expected_jobs:
        pending.append((section_name, custom_id))
        if reuse_existing:
            continue
        call_models_zt(
            text=prompt,
            function=function_name,
            custom_id=custom_id,
            collection_name=collection_name,
            model=model,
            ai="openai",
            read=False,
            store_only=True,
            cache=False,
        )

    ok = cm._process_batch_for(analysis_key_suffix=function_name, section_title=safe_collection, poll_interval=30)
    if ok is not True:
        raise RuntimeError(f"Grouped batch failed for collection={collection_name}, function={function_name}")

    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    batch_id = str(meta["batch_id"]).strip()
    if not batch_id:
        raise RuntimeError(f"Batch metadata missing batch_id: {meta_file}")

    out: dict[str, str] = {}
    for section_name, custom_id in pending:
        response = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
        text_out = _extract_llm_text(response)
        if not str(text_out).strip():
            raise RuntimeError(f"Empty batch output for section '{section_name}' custom_id='{custom_id}'")
        out[section_name] = text_out

    return {
        "outputs": out,
        "batch_id": batch_id,
        "request_count": len(section_prompts),
        "input_file": str(input_file),
        "output_file": str(output_file),
        "meta_file": str(meta_file),
    }

# -------------------------
# Main renderer
# -------------------------

def render_evidence_map_from_summary(
    *,
    summary: dict[str, Any],
    mapping_config: dict[str, Any],
    template_path: Path,
    outputs_root: Path,
    model: str,
    citation_style: str,
) -> dict[str, Any]:
    mapping_config = _ensure_mapping_config(mapping_config)
    raw_collection_name = str(summary.get("collection_name") or "").strip()
    collection_name = _resolve_collection_label(raw_collection_name)
    output_dir = outputs_root / _safe_name(collection_name) / "EVIDMAP"
    output_dir.mkdir(parents=True, exist_ok=True)

    section_cache_path = output_dir / "section_generation_cache.json"
    section_cache_entries, section_cache, cache_dirty = _load_section_cache(section_cache_path)
    if cache_dirty:
        _write_section_cache(section_cache_path, section_cache_entries)

    citation_style = _normalize_citation_style(citation_style)
    citation_instruction = _citation_style_instruction(citation_style)

    items = _load_items(summary)
    item_records = _build_item_records(items)
    item_year_by_key = {r["item_key"]: r["year"] for r in item_records if r["year"] is not None}
    item_url_by_key = {r["item_key"]: r["url"] for r in item_records}

    dq_payload, dqid_lookup = _build_dqid_evidence_payload(summary, max_rows=int(mapping_config["limits"]["max_evidence_rows"]))

    theme_counts = _theme_counts_from_dq(dq_payload)
    top_themes = _top_k_labels(theme_counts, int(mapping_config["limits"]["top_themes"]))

    year_bin_size = int(mapping_config["matrix_view"]["year_bin_size"])
    max_year_bins = int(mapping_config["limits"]["max_year_bins"])

    evidence_matrix = _build_evidence_matrix_theme_x_yearbin(
        dq_payload=dq_payload,
        item_year_by_key=item_year_by_key,
        item_url_by_key=item_url_by_key,
        top_themes=top_themes,
        year_bin_size=year_bin_size,
        max_year_bins=max_year_bins,
    )

    row_labels = [r["label"] for r in evidence_matrix["rows"]]
    col_labels = [c["label"] for c in evidence_matrix["cols"]]
    values = [[cell["n"] for cell in r["cells"]] for r in evidence_matrix["rows"]]

    heatmap_svg = _svg_heatmap(
        title=mapping_config["figures"]["heatmap_title"],
        row_labels=row_labels,
        col_labels=col_labels,
        values=values,
    )
    gap_map_path = output_dir / "gap_map.svg"
    gap_map_path.write_text(heatmap_svg, encoding="utf-8")

    node_w, edges = _theme_cooccurrence_edges(dq_payload=dq_payload, top_themes=top_themes)
    network_svg = _svg_circular_network(
        title=mapping_config["figures"]["network_title"],
        node_weights=node_w,
        edges=edges,
    )
    network_path = output_dir / "evidence_network.svg"
    network_path.write_text(network_svg, encoding="utf-8")

    years_hist = _year_histogram(item_records)
    t_labels = [str(x["year"]) for x in years_hist][-int(mapping_config["limits"]["timeline_years"]):]
    t_values = [int(x["count"]) for x in years_hist][-int(mapping_config["limits"]["timeline_years"]):]
    timeline_svg = _svg_timeline_bar(
        title=mapping_config["figures"]["timeline_title"],
        labels=t_labels,
        values=t_values,
    )
    timeline_path = output_dir / "timeline.svg"
    timeline_path.write_text(timeline_svg, encoding="utf-8")

    bubble_labels = [str(r["year"]) for r in years_hist if isinstance(r.get("year"), int)]
    bubble_values = [int(r["count"]) for r in years_hist if isinstance(r.get("year"), int)]
    bubble_svg = _svg_timeline_bar(
        title=str(mapping_config["figures"]["bubble_title"]),
        labels=bubble_labels[-10:] if bubble_labels else ["No data"],
        values=bubble_values[-10:] if bubble_values else [0],
    )
    bubble_path = output_dir / "bubble_plot.svg"
    bubble_path.write_text(bubble_svg, encoding="utf-8")

    summary_stats = [
        {"label": "Items in corpus", "value": str(len(item_records))},
        {"label": "Evidence units (dqid rows)", "value": str(len(dq_payload))},
        {"label": "Top themes mapped", "value": str(len(top_themes))},
        {"label": f"Year-bin size", "value": str(year_bin_size)},
    ]

    payload_base = {
        "topic": collection_name,
        "map_dimensions": mapping_config["dimensions"],
        "summary_stats": summary_stats,
        "evidence_matrix": _to_namespace(evidence_matrix),
        "top_themes": [{"theme": _humanize_theme_tokens(t), "count": int(theme_counts[t])} for t in top_themes],
        "network_edges_count": len(edges),
        "citation_style": citation_style,
        "meta_rule": {
            "k_min": int(mapping_config["limits"]["meta_k_min"]),
            "requires_quant_signal": True,
        },
    }

    section_specs = {
        "ai_abstract": {"min": 160, "max": 520, "forbid_h4": True},
        "ai_purpose": {"min": 120, "max": 800},
        "mapping_questions": {"min": 80, "max": 520},
        "distribution_notes": {"min": 80, "max": 800},
        "network_notes": {"min": 80, "max": 800},
        "ai_gaps_and_opportunities": {"min": 160, "max": 1200},
        "ai_limitations": {"min": 120, "max": 900},
    }

    section_instructions = {
        "ai_abstract": "Write a single-block abstract for an evidence map: Purpose, Corpus, Mapping dimensions, Key concentrations, Key gaps, Use cases.",
        "ai_purpose": "State the purpose of the evidence map and what decisions it supports (triage, prioritization, meta-analysis feasibility).",
        "mapping_questions": "Write 3-6 concrete mapping questions that fit the corpus and dimensions. Use bullet list HTML.",
        "distribution_notes": "Summarize distributional patterns in the map (where evidence is concentrated vs sparse) without overclaiming causality.",
        "network_notes": "Interpret the evidence network cautiously: hubs, isolated nodes, and what co-occurrence does/does not imply.",
        "ai_gaps_and_opportunities": "Identify the highest-value gaps with rationale and suggest minimal designs to fill them. Be explicit about scope conditions.",
        "ai_limitations": "List limitations of the evidence map: coverage, coding error, construct drift, publication ecology, and interpretive constraints.",
    }

    llm_sections: dict[str, str] = {}
    prompts: list[tuple[str, str]] = []
    for section_name, instruction in section_instructions.items():
        cached = section_cache_entries[section_name]["html"] if section_name in section_cache_entries else ""
        if cached:
            llm_sections[section_name] = _enrich_dqid_anchors(cached, dqid_lookup, citation_style=citation_style)
            continue
        adaptive = build_adaptive_prompt_context(payload_base, target_tokens=7000, hard_cap_tokens=11000)
        prompt = (
            f"SECTION_NAME\n{section_name}\n\n"
            f"INSTRUCTION\n{instruction}\n\n"
            f"CONTEXT_JSON\n{json.dumps(adaptive['context'], ensure_ascii=False, indent=2)}\n\n"
            f"CONTEXT_META_JSON\n{json.dumps(adaptive['meta'], ensure_ascii=False)}\n\n"
            "STYLE_GUARD\nWrite formal publication prose only. Do not mention prompts/context JSON/AI.\n\n"
            f"CITATION_STYLE\n{citation_instruction}\n\n"
            "Return only raw HTML snippets, no markdown fences."
        )
        prompts.append((section_name, prompt))

    batch = {"batch_id": "", "request_count": 0}
    if prompts:
        batch = _run_grouped_batch_sections(
            collection_name=collection_name,
            model=model,
            function_name=str(mapping_config["llm"]["function_name"]),
            section_prompts=prompts,
        )
        for section_name, raw_html in batch["outputs"].items():
            cleaned = _clean_and_humanize_section_html(_clean_llm_html(raw_html))
            cleaned = _enrich_dqid_anchors(cleaned, dqid_lookup, citation_style=citation_style)
            _validate_generated_section(section_name, cleaned, section_specs[section_name])
            llm_sections[section_name] = cleaned
            section_cache[section_name] = cleaned
            section_cache_entries[section_name] = _make_cache_entry(section_name=section_name, html_text=cleaned, model=model)
        _write_section_cache(section_cache_path, section_cache_entries)

    meta_candidates = _build_meta_candidates(
        evidence_matrix=evidence_matrix,
        k_min=int(mapping_config["limits"]["meta_k_min"]),
        items=items,
    )
    timeline_table_html = ""
    if years_hist:
        timeline_table_html = "<table class='data-table'><thead><tr><th>Year</th><th>Count</th></tr></thead><tbody>"
        for row in years_hist[-int(mapping_config["limits"]["timeline_years"]):]:
            timeline_table_html += f"<tr><td>{row['year']}</td><td>{row['count']}</td></tr>"
        timeline_table_html += "</tbody></table>"

    refs_html = _build_reference_items(summary, citation_style=citation_style)
    evidence_matrix_render = _to_namespace(evidence_matrix)
    context = {
        "topic": collection_name,
        "authors_list": mapping_config["report"]["authors_list"],
        "affiliation": mapping_config["report"]["affiliation"],
        "generation_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "ai_models_used": model,
        "version_tag": mapping_config["report"]["version_tag"],

        "ai_abstract": llm_sections["ai_abstract"],
        "ai_purpose": llm_sections["ai_purpose"],
        "mapping_questions": llm_sections["mapping_questions"],

        "scope_in": mapping_config["scope"]["in"],
        "scope_out": mapping_config["scope"]["out"],
        "boundary_conditions": mapping_config["scope"]["boundary_conditions"],

        "sources_consulted": mapping_config["corpus"]["sources_consulted"],
        "selection_logic": mapping_config["corpus"]["selection_logic"],
        "search_strings": mapping_config["corpus"]["search_strings"],
        "provenance_note": mapping_config["corpus"]["provenance_note"],

        "map_dimensions": mapping_config["dimensions"],
        "corpus_table": _characteristics_table_html(item_records),

        "summary_stats": summary_stats,
        "distribution_notes": llm_sections["distribution_notes"],

        "evidence_matrix": evidence_matrix_render,
        "gap_map_figure": gap_map_path.name,

        "evidence_network_figure": network_path.name,
        "network_notes": llm_sections["network_notes"],

        "timeline_figure": timeline_path.name,
        "timeline_table": timeline_table_html,

        "bubble_plot_figure": bubble_path.name,
        "bubble_notes": "<p>Bubble proxy highlights where evidence volume and recency overlap; interpret as prioritization signal, not effect-size evidence.</p>",

        "ai_gaps_and_opportunities": llm_sections["ai_gaps_and_opportunities"],
        "priority_gaps": mapping_config["priority_gaps"],
        "meta_candidates": meta_candidates,

        "ai_limitations": llm_sections["ai_limitations"],

        "references_list": [{"html_string": s[4:-5] if s.startswith("<li>") and s.endswith("</li>") else s} for s in refs_html],
        "appendices": [],
    }

    env = Environment(loader=FileSystemLoader(str(template_path.parent)), autoescape=select_autoescape(["html", "htm", "xml"]))
    template = env.get_template(template_path.name)
    rendered = template.render(**context)
    _assert_non_placeholder_html(rendered)
    _assert_reference_and_postprocess_integrity(rendered, citation_style=citation_style)

    out_html = output_dir / "evidence_map.html"
    out_ctx = output_dir / "evidence_map_context.json"
    out_html.write_text(rendered, encoding="utf-8")
    context_json = dict(context)
    context_json["evidence_matrix"] = evidence_matrix
    _write_json(out_ctx, context_json)

    manifest = {
        "status": "ok",
        "collection_name": collection_name,
        "output_html_path": str(out_html),
        "context_json_path": str(out_ctx),
        "batch_contract": {
            "writer_function": str(mapping_config["llm"]["function_name"]),
            "batch_id": str(batch["batch_id"]),
            "request_count": int(batch["request_count"]),
            "sections": list(section_instructions.keys()),
        },
        "artifacts": {
            "gap_map_figure": str(gap_map_path),
            "evidence_network_figure": str(network_path),
            "timeline_figure": str(timeline_path),
            "bubble_plot_figure": str(bubble_path),
        },
        "meta_candidates_path": str(output_dir / "meta_candidates.json"),
        "meta_candidates_count": len(meta_candidates),
    }
    _write_json(output_dir / "meta_candidates.json", {"meta_candidates": meta_candidates})
    _write_json(output_dir / "evidence_map_manifest.json", manifest)
    return manifest

def run_pipeline(
    *,
    summary_path: Path,
    mapping_config_path: Path,
    template_path: Path,
    outputs_root: Path,
    model: str,
    citation_style: str,
) -> dict[str, Any]:
    summary = _load_json(summary_path)
    mapping_config = _load_json_file(mapping_config_path)
    return render_evidence_map_from_summary(
        summary=summary,
        mapping_config=mapping_config,
        template_path=template_path,
        outputs_root=outputs_root,
        model=model,
        citation_style=citation_style,
    )

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Generate an evidence map HTML report from coded summary + mapping config.")
    p.add_argument("--summary-path", required=True)
    p.add_argument("--mapping-config-path", required=True)
    p.add_argument("--template-path", required=True)
    p.add_argument("--outputs-root", default=str(_repo_root() / "Research" / "outputs"))
    p.add_argument("--model", default="gpt-5-mini")
    p.add_argument("--citation-style", default="apa")
    return p

def main() -> int:
    args = _build_parser().parse_args()
    result = run_pipeline(
        summary_path=Path(args.summary_path).resolve(),
        mapping_config_path=Path(args.mapping_config_path).resolve(),
        template_path=Path(args.template_path).resolve(),
        outputs_root=Path(args.outputs_root).resolve(),
        model=str(args.model),
        citation_style=str(args.citation_style),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
