#!/usr/bin/env python3
"""
Generate a per-section inventory for the Visualise backend.

Runs the python host (stdin/stdout JSON) section-by-section using a CSV loaded
as a DataHub-style table payload, then summarizes:
  - slide count
  - valid visual figures (fig_json with non-empty data)
  - tables
  - images
  - common trace types (offline/CSP risk)
  - section errors (from host logs)

Output: a markdown report under Plans/pending/.
"""

from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = REPO_ROOT / "my-electron-app"
HOST = APP_ROOT / "shared" / "python_backend" / "visualise" / "visualise_host.py"


SECTIONS: list[dict[str, str]] = [
    {"id": "Data_summary", "label": "Data summary"},
    {"id": "Scope_and_shape", "label": "Scope and shape"},
    {"id": "Authors_overview", "label": "Authors overview"},
    {"id": "Authorship_institution", "label": "Authorship & institutions"},
    {"id": "Citations_overview", "label": "Citations overview"},
    {"id": "Citations_influence", "label": "Citations & influence"},
    {"id": "Words_and_topics", "label": "Words and topics"},
    {"id": "Ngrams", "label": "N-grams"},
    {"id": "Affiliations_geo", "label": "Affiliations (geo)"},
    {"id": "Temporal_analysis", "label": "Temporal analysis"},
    {"id": "Research_design", "label": "Research design"},
    {"id": "Thematic_method", "label": "Thematic & method"},
    {"id": "Categorical_keywords", "label": "Categorical keywords"},
]


SECTION_TO_BACKEND: dict[str, str] = {
    "Data_summary": "visual.add_data_summary_slides(prs, df, ...)",
    "Scope_and_shape": "visual.shape_scope(prs, df, ...)",
    "Authors_overview": "visual.authors_overview(prs, df, ...)",
    "Authorship_institution": "visual.add_authorship_and_institution_section(prs, df, ...)",
    "Citations_overview": "visual.analyze_citations_overview_plotly(df, ...)",
    "Citations_influence": "visual.add_citations_and_influence_section(prs, df, ...)",
    "Words_and_topics": "visual.analyze_wordanalysis_dispatcher(df, ...)+visual.analyze_ngrams(df, ...)",
    "Ngrams": "visual.analyze_ngrams(df, ...)",
    "Affiliations_geo": "visual.analyze_affiliations(df, ...)",
    "Temporal_analysis": "visual.analyze_temporal_analysis(df, ...)",
    "Research_design": "visual.analyze_research_design_suite(df, ...)",
    "Thematic_method": "visual.add_thematic_and_method_section(prs, df, ...)",
    "Categorical_keywords": "visual.analyze_categorical_keywords(df, ...)",
}


def _split_lines(text: str) -> list[str]:
    return [line.rstrip("\n") for line in (text or "").splitlines() if line.strip()]


def _parse_last_json(stdout: str) -> tuple[dict[str, Any] | None, list[str]]:
    lines = _split_lines(stdout)
    for i in range(len(lines) - 1, -1, -1):
        ln = lines[i].strip()
        if not (ln.startswith("{") and ln.endswith("}")):
            continue
        try:
            return json.loads(ln), lines[:i]
        except Exception:
            continue
    return None, lines


def _coerce_cell(col: str, value: str) -> Any:
    if value == "":
        return None
    if col in {"year", "citations"}:
        try:
            n = int(float(value))
            return n
        except Exception:
            return value
    return value


def load_csv_table(csv_path: Path) -> dict[str, Any]:
    with csv_path.open("r", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f)
        cols = next(reader)
        rows: list[list[Any]] = []
        for r in reader:
            out = []
            for i, cell in enumerate(r):
                col = cols[i] if i < len(cols) else f"col_{i}"
                out.append(_coerce_cell(col, cell))
            rows.append(out)
    return {"columns": cols, "rows": rows}


def run_section(*, section_id: str, table: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "action": "preview",
        "mode": "run_inputs",
        "collectionName": "attribution",
        "include": [section_id],
        "params": params,
        "table": table,
    }
    proc = subprocess.run(
        [sys.executable, str(HOST)],
        input=json.dumps(payload).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(APP_ROOT),
        env={**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONPATH": str(APP_ROOT / "shared")},
    )
    stdout = proc.stdout.decode("utf-8", errors="replace")
    stderr = proc.stderr.decode("utf-8", errors="replace")
    parsed, extra = _parse_last_json(stdout)
    python_logs = [*extra, *_split_lines(stderr)]
    if not parsed:
        return {"status": "error", "message": "no json response", "pythonLogs": python_logs, "raw": stdout[-2000:]}
    parsed["pythonLogs"] = python_logs
    return parsed


def is_valid_fig(fig: Any) -> bool:
    if isinstance(fig, dict):
        data = fig.get("data")
        return isinstance(data, list) and len(data) > 0
    if isinstance(fig, list):
        return len(fig) > 0
    return False


def is_renderable_fig(fig: Any) -> bool:
    if is_valid_fig(fig):
        return True
    if isinstance(fig, dict):
        layout = fig.get("layout")
        if isinstance(layout, dict):
            for k in ("annotations", "shapes", "images"):
                v = layout.get(k)
                if isinstance(v, list) and len(v) > 0:
                    return True
    return False


def fig_trace_types(fig: Any) -> list[str]:
    if isinstance(fig, dict):
        data = fig.get("data")
        if isinstance(data, list):
            out = []
            for t in data:
                if isinstance(t, dict):
                    out.append(str(t.get("type") or "scatter"))
            return out
    return []


def table_present(html: Any) -> bool:
    if not isinstance(html, str):
        return False
    s = html.strip()
    if not s:
        return False
    if s.lower() in {"<div>no table.</div>", "<div>no data available.</div>"}:
        return False
    return True


def classify(slides: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(slides)
    visual = 0
    visual_traces = 0
    visual_layout = 0
    visual_message = 0
    img = 0
    table = 0
    bullets = 0
    fig_empty = 0
    trace_types: list[str] = []
    titles_table_only: list[str] = []
    titles_no_visual: list[str] = []
    for s in slides:
        fig = s.get("fig_json")
        has_fig = fig is not None
        has_img = isinstance(s.get("img"), str) and str(s.get("img") or "").strip() != ""
        if has_img:
            img += 1
            visual += 1
            continue

        valid_trace = is_valid_fig(fig)
        valid_render = is_renderable_fig(fig)
        if valid_trace:
            visual_traces += 1
            visual += 1
            trace_types.extend(fig_trace_types(fig))
        elif valid_render and isinstance(fig, dict):
            layout = fig.get("layout")
            ann = layout.get("annotations") if isinstance(layout, dict) else None
            shapes = layout.get("shapes") if isinstance(layout, dict) else None
            images = layout.get("images") if isinstance(layout, dict) else None
            has_ann = isinstance(ann, list) and len(ann) > 0
            has_shapes = isinstance(shapes, list) and len(shapes) > 0
            has_images = isinstance(images, list) and len(images) > 0
            visual += 1
            if has_ann and not has_shapes and not has_images:
                visual_message += 1
            else:
                visual_layout += 1
        elif has_fig:
            fig_empty += 1

        has_table = table_present(s.get("table_html"))
        if has_table:
            table += 1
        if isinstance(s.get("bullets"), list) and len(s.get("bullets") or []) > 0:
            bullets += 1
        if has_table and not valid_render and not has_img:
            titles_table_only.append(str(s.get("title") or "").strip())
        if not valid_render and not has_img:
            titles_no_visual.append(str(s.get("title") or "").strip())
    trace_counts = Counter([t for t in trace_types if t])
    offline_risky = sorted({t for t in trace_counts if "mapbox" in t or t.startswith("choropleth")})
    return {
        "total": total,
        "visual": visual,
        "visual_traces": visual_traces,
        "visual_layout": visual_layout,
        "visual_message": visual_message,
        "tables": table,
        "imgs": img,
        "bullets": bullets,
        "fig_empty": fig_empty,
        "trace_counts": trace_counts,
        "offline_risky": offline_risky,
        "titles_table_only": [t for t in titles_table_only if t],
        "titles_no_visual": [t for t in titles_no_visual if t],
    }


def main() -> int:
    if not HOST.exists():
        print(f"Missing host: {HOST}", file=sys.stderr)
        return 2
    csv_path = APP_ROOT / "attribution.csv"
    if not csv_path.exists():
        print(f"Missing dataset: {csv_path}", file=sys.stderr)
        return 2

    table = load_csv_table(csv_path)
    params = {"slide_notes": "false"}

    results: list[dict[str, Any]] = []
    for sec in SECTIONS:
        sec_id = sec["id"]
        resp = run_section(section_id=sec_id, table=table, params=params)
        status = str(resp.get("status") or "")
        logs = resp.get("logs")
        log_lines = [l for l in (logs if isinstance(logs, list) else []) if isinstance(l, str)]
        errors = [l for l in log_lines if "[section][error]" in l.lower() or "traceback" in l.lower()]
        deck = resp.get("deck")
        slides = deck.get("slides") if isinstance(deck, dict) else None
        slides_list = [s for s in (slides if isinstance(slides, list) else []) if isinstance(s, dict)]
        stats = classify(slides_list) if status == "ok" else classify([])

        results.append(
            {
                "id": sec_id,
                "label": sec["label"],
                "backend": SECTION_TO_BACKEND.get(sec_id, ""),
                "status": status or "unknown",
                "errors": errors[:80],
                "stats": stats,
            }
        )

    # Sort: sections with problems first (no visuals or errors), then by visual count.
    def score(r: dict[str, Any]) -> tuple[int, int]:
        st = r["stats"]
        has_err = 1 if r["errors"] else 0
        no_visual = 1 if st["visual"] == 0 else 0
        return (has_err + no_visual * 2, -int(st["visual"]))

    results_sorted = sorted(results, key=score, reverse=True)

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    out_path = REPO_ROOT / "Plans" / "pending" / "TEIA_VISUALISE_SECTION_INVENTORY_2026-02-05.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def md_escape(s: str) -> str:
        return s.replace("|", "\\|").replace("\n", " ").strip()

    lines: list[str] = []
    lines.append(f"# TEIA — Visualise Section Inventory (generated {now})")
    lines.append("")
    lines.append(f"Dataset: `my-electron-app/attribution.csv` (rows={len(table['rows'])})")
    lines.append(f"Host: `{HOST.relative_to(REPO_ROOT)}`")
    lines.append("")
    lines.append("## Summary (issues first)")
    lines.append("")
    # Suggested fix order (highest-impact first)
    def prio(r: dict[str, Any]) -> int:
        st = r["stats"]
        p = 0
        if r["errors"]:
            p += 1000
        if st["fig_empty"] > 0:
            p += 400
        # If a section renders only message/layout visuals (no traces), it usually means missing column mapping/params.
        if st["visual_traces"] == 0 and st["visual"] > 0:
            p += 250
        if st["visual"] == 0:
            p += 800
        if st["tables"] > 0 and st["visual"] == 0:
            p += 300
        # lots of table-only slides can be a UX issue
        if len(st.get("titles_table_only") or []) >= 4:
            p += 40
        return p

    fix_sorted = sorted(results, key=prio, reverse=True)
    top_fix = [r for r in fix_sorted if prio(r) > 0][:8]
    lines.append("## Suggested fix order")
    lines.append("")
    if not top_fix:
        lines.append("- No hard failures detected in this dataset; remaining work is quality/UX improvements.")
    else:
        for r in top_fix:
            st = r["stats"]
            why = []
            if r["errors"]:
                why.append("errors")
            if st["fig_empty"] > 0:
                why.append("empty fig_json")
            if st["visual"] == 0:
                why.append("no visuals")
            if st["visual_traces"] == 0 and st["visual"] > 0:
                why.append("no data traces (message/layout only)")
            if len(st.get("titles_table_only") or []) >= 4:
                why.append("many table-only slides")
            w = ", ".join(why) if why else "quality/UX"
            lines.append(f"- `{r['id']}` — {r['label']} ({w})")
    lines.append("")

    lines.append("| Section | Backend | Slides | Visual (traces/layout/msg) | Tables | Fig empty | Offline-risk traces | Status |")
    lines.append("|---|---|---:|---:|---:|---:|---|---|")
    for r in results_sorted:
        st = r["stats"]
        offline = ", ".join(st["offline_risky"]) if st["offline_risky"] else ""
        lines.append(
            "| "
            + " / ".join([md_escape(r["label"]), f"`{r['id']}`"])
            + " | "
            + md_escape(r["backend"])
            + f" | {st['total']} | {st['visual']} ({st['visual_traces']}/{st['visual_layout']}/{st['visual_message']}) | {st['tables']} | {st['fig_empty']} | {md_escape(offline)} | {md_escape(r['status'])} |"
        )
    lines.append("")

    lines.append("## Details (issues first)")
    lines.append("")
    for r in results_sorted:
        st = r["stats"]
        lines.append(f"### {r['label']} (`{r['id']}`)")
        lines.append(f"- Backend: `{r['backend']}`" if r["backend"] else "- Backend: (unknown)")
        lines.append(
            f"- Output: slides={st['total']}, visuals={st['visual']} (traces={st['visual_traces']}, layout={st['visual_layout']}, msg={st['visual_message']}), "
            f"tables={st['tables']}, fig_empty={st['fig_empty']}, imgs={st['imgs']}, bullets={st['bullets']}"
        )

        if r["errors"]:
            lines.append("- Errors:")
            for e in r["errors"][:12]:
                lines.append(f"  - `{md_escape(e)[:280]}`")
        if st["visual"] == 0:
            if st["tables"] > 0:
                lines.append("- Issue: produces tables but **no figures/images** → thumbs/stage show little unless user switches to Table.")
            elif st["bullets"] > 0:
                lines.append("- Issue: produces bullets only (**no figures/images**).")
            else:
                lines.append("- Issue: produces **no renderable output**.")
        if st["visual_message"] > 0 and st["visual_traces"] == 0:
            lines.append("- Issue: only message/callout visuals (no data traces). Likely missing expected columns/params.")
        if st["fig_empty"] > 0:
            lines.append("- Issue: some `fig_json` payloads exist but have empty `data`.")
        if st["offline_risky"]:
            lines.append(f"- Offline/CSP risk trace types: {', '.join(st['offline_risky'])}")
        if st["titles_table_only"]:
            shown = ", ".join([md_escape(t) for t in st["titles_table_only"][:6]])
            extra = f" (+{len(st['titles_table_only']) - 6} more)" if len(st["titles_table_only"]) > 6 else ""
            lines.append(f"- Table-only slide titles: {shown}{extra}")
        # trace type summary (top 8)
        tc = st["trace_counts"]
        if tc:
            top = ", ".join([f"{k}:{v}" for k, v in tc.most_common(8)])
            lines.append(f"- Trace types (top): {top}")
        lines.append("")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
