#!/usr/bin/env python3
"""
Autonomous section-split improvement loop.

Each iteration:
1) runs reparse_footnotes_dataset.py (JSON corpus),
2) computes section split score deltas,
3) mines grouped residual issue patterns from worst-scoring docs,
4) writes machine + markdown iteration artifacts.

This script does not edit parser code directly. It provides a repeatable loop
for hypothesis-driven improvement cycles.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any, Dict, List, Tuple


@dataclass
class IterSummary:
    iteration: int
    report_path: Path
    docs_ok: int
    weighted_score: float
    standalone_total: float
    glued_total: float
    issue_groups: Dict[str, int]


STRICT_PATTERNS: Dict[str, re.Pattern[str]] = {
    "plain_heading_runon": re.compile(
        r"^(?:#{1,6}\s*)?(?:"
        r"ABSTRACT\s+(?!OF\b)\S.{24,}"
        r"|(?:INTRODUCTION|BACKGROUND|METHODS?|METHODOLOGY|RESULTS|DISCUSSION|"
        r"CONCLUSION|REFERENCES|BIBLIOGRAPHY|APPENDIX)\s*[:.\-]\s+\S.{20,}"
        r")",
        re.I,
    ),
    "header_then_abstract_runon": re.compile(
        r"(?i)\b(issn|e-issn|doi|journal|vol\.?|volume|issue|published by|copyright)\b"
        r".{0,180}\babstract\b(?!\s*=)\s*[:.\-\"“”]"
    ),
    "toc_inline_navigation": re.compile(
        r"(?i)\b(previous article|next article|view issue table of contents|table of contents)\b"
    ),
    "numbered_heading_runon": re.compile(
        r"^(?:#{1,6}\s*)?(?:[IVXLCDM]+|\d+(?:\.\d+)*)\s*[.)-]?\s*"
        r"(?:INTRODUCTION|ABSTRACT|BACKGROUND|METHODS?|METHODOLOGY|RESULTS|DISCUSSION|"
        r"CONCLUSION|REFERENCES|BIBLIOGRAPHY|APPENDIX)\b.*(?:\.{2,}\s*\d+\s+\S|\s{2,}\S.{8,})",
        re.I,
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run iterative section-split diagnostics loop.")
    parser.add_argument("--iterations", type=int, default=3, help="Max loop iterations.")
    parser.add_argument(
        "--dataset-dir",
        default="python_backend_legacy/dataset",
        help="Dataset dir used by reparse_footnotes_dataset.py",
    )
    parser.add_argument(
        "--work-dir",
        default="python_backend_legacy/dataset/section_split_loop",
        help="Directory for loop artifacts.",
    )
    parser.add_argument(
        "--worst-docs",
        type=int,
        default=120,
        help="How many worst docs to inspect for grouped residual issues.",
    )
    parser.add_argument(
        "--min-improvement",
        type=float,
        default=1e-4,
        help="Minimum weighted score gain to consider an iteration as improved.",
    )
    parser.add_argument(
        "--stop-after-stagnant",
        type=int,
        default=2,
        help="Stop after this many non-improving iterations.",
    )
    parser.add_argument(
        "--types",
        default="json",
        choices=("json", "both"),
        help="Pass-through to reparse script.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional doc limit per iteration.",
    )
    return parser.parse_args()


def load_parser(repo_root: Path):
    parser_path = repo_root / "python_backend_legacy" / "llms" / "footnotes_parser.py"
    spec = importlib.util.spec_from_file_location("section_loop_parser", parser_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load parser module: {parser_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_reparse(
    repo_root: Path,
    dataset_dir: str,
    output_path: Path,
    types: str,
    limit: int | None,
) -> None:
    cmd: List[str] = [
        "python3",
        "scripts/reparse_footnotes_dataset.py",
        "--dataset-dir",
        dataset_dir,
        "--types",
        types,
        "--hash-only",
        "--output",
        str(output_path.relative_to(repo_root)),
        "--show-progress-every",
        "100",
    ]
    if limit is not None:
        cmd.extend(["--limit", str(limit)])
    subprocess.run(cmd, cwd=repo_root, check=True)


def get_weighted_score(report: Dict[str, Any]) -> Tuple[float, float, float, int]:
    summary = report.get("summary") if isinstance(report, dict) else {}
    ss = (summary or {}).get("section_split_stats") if isinstance(summary, dict) else {}
    docs_ok = int((summary or {}).get("documents_ok") or 0)
    return (
        float((ss or {}).get("weighted_heading_split_score_current_flat_text") or 0.0),
        float((ss or {}).get("current_flat_standalone_heading_lines_total") or 0.0),
        float((ss or {}).get("current_flat_glued_heading_lines_total") or 0.0),
        docs_ok,
    )


def mine_issue_groups(
    repo_root: Path,
    report: Dict[str, Any],
    parser_mod: Any,
    worst_docs: int,
) -> Tuple[Dict[str, int], Dict[str, List[Tuple[str, str]]]]:
    records = [r for r in (report.get("records") or []) if isinstance(r, dict) and "error" not in r]
    scored: List[Tuple[float, str]] = []
    for r in records:
        s = ((r.get("section_split_stats") or {}).get("flat_text_current") or {})
        score = float(s.get("heading_split_score") or 1.0)
        scored.append((score, str(r.get("file") or "")))
    scored.sort(key=lambda x: x[0])
    selected = [Path(f).name for _, f in scored[: max(1, worst_docs)] if f]

    counts: Dict[str, int] = {k: 0 for k in STRICT_PATTERNS.keys()}
    examples: Dict[str, List[Tuple[str, str]]] = {k: [] for k in STRICT_PATTERNS.keys()}
    dataset_dir = repo_root / "python_backend_legacy" / "dataset"

    for name in selected:
        path = dataset_dir / name
        if not path.exists():
            continue
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        full = str(obj.get("full_text") or "")
        if not full.strip():
            continue
        style = parser_mod.detect_citation_style(full)
        flat = parser_mod.make_flat_text(full, style)
        for line in flat.splitlines():
            s = line.strip()
            if not s:
                continue
            for key, pat in STRICT_PATTERNS.items():
                if pat.search(s):
                    counts[key] += 1
                    if len(examples[key]) < 8:
                        examples[key].append((name, s[:240]))
                    break
    return counts, examples


def write_iteration_markdown(
    out_path: Path,
    summary: IterSummary,
    delta: float,
    examples: Dict[str, List[Tuple[str, str]]],
) -> None:
    lines: List[str] = []
    lines.append(f"# Iteration {summary.iteration}")
    lines.append("")
    lines.append(f"- report: `{summary.report_path}`")
    lines.append(f"- docs_ok: {summary.docs_ok}")
    lines.append(f"- weighted_heading_split_score: {summary.weighted_score:.6f}")
    lines.append(f"- delta_from_previous: {delta:+.6f}")
    lines.append(f"- standalone_total: {summary.standalone_total:.0f}")
    lines.append(f"- glued_total: {summary.glued_total:.0f}")
    lines.append("")
    lines.append("## Residual Issue Groups")
    for k, v in sorted(summary.issue_groups.items(), key=lambda x: x[1], reverse=True):
        lines.append(f"- {k}: {v}")
    lines.append("")
    lines.append("## Examples")
    for k, vals in sorted(examples.items(), key=lambda kv: summary.issue_groups.get(kv[0], 0), reverse=True):
        if not vals:
            continue
        lines.append(f"### {k}")
        for name, sample in vals[:5]:
            lines.append(f"- `{name}`: {sample}")
        lines.append("")
    out_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    work_dir = (repo_root / args.work_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)

    parser_mod = load_parser(repo_root)
    history: List[IterSummary] = []
    stagnant = 0
    prev_score: float | None = None

    for i in range(1, args.iterations + 1):
        iter_dir = work_dir / f"iter_{i:02d}"
        iter_dir.mkdir(parents=True, exist_ok=True)
        report_path = iter_dir / "report.json"

        run_reparse(
            repo_root=repo_root,
            dataset_dir=args.dataset_dir,
            output_path=report_path,
            types=args.types,
            limit=args.limit,
        )
        report = json.loads(report_path.read_text(encoding="utf-8"))
        weighted, stand, glued, docs_ok = get_weighted_score(report)
        groups, examples = mine_issue_groups(repo_root, report, parser_mod, args.worst_docs)

        delta = 0.0 if prev_score is None else (weighted - prev_score)
        summary = IterSummary(
            iteration=i,
            report_path=report_path,
            docs_ok=docs_ok,
            weighted_score=weighted,
            standalone_total=stand,
            glued_total=glued,
            issue_groups=groups,
        )
        history.append(summary)

        (iter_dir / "analysis.json").write_text(
            json.dumps(
                {
                    "generated_at_utc": datetime.now(timezone.utc).isoformat(),
                    "iteration": i,
                    "weighted_heading_split_score": weighted,
                    "delta_from_previous": delta,
                    "standalone_total": stand,
                    "glued_total": glued,
                    "docs_ok": docs_ok,
                    "issue_groups": groups,
                    "examples": examples,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        write_iteration_markdown(iter_dir / "analysis.md", summary, delta, examples)

        if prev_score is not None and delta <= args.min_improvement:
            stagnant += 1
        else:
            stagnant = 0
        prev_score = weighted

        if stagnant >= args.stop_after_stagnant:
            break

    history_json = [
        {
            "iteration": h.iteration,
            "report_path": str(h.report_path),
            "docs_ok": h.docs_ok,
            "weighted_heading_split_score": h.weighted_score,
            "standalone_total": h.standalone_total,
            "glued_total": h.glued_total,
            "issue_groups": h.issue_groups,
        }
        for h in history
    ]
    (work_dir / "history.json").write_text(
        json.dumps(
            {
                "generated_at_utc": datetime.now(timezone.utc).isoformat(),
                "iterations_requested": args.iterations,
                "iterations_executed": len(history),
                "history": history_json,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Loop artifacts written to: {work_dir}")
    if history:
        print(f"Last weighted_heading_split_score: {history[-1].weighted_score:.6f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
