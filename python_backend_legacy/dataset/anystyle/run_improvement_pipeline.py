#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import re
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
import xml.etree.ElementTree as ET

CHECK_RE = re.compile(r"(?P<seq>\d+)\s+seq\s+(?P<seq_pct>[0-9.]+)%\s+(?P<tok>\d+)\s+tok\s+(?P<tok_pct>[0-9.]+)%")


@dataclass
class CheckResult:
    seq_errors: int
    seq_error_pct: float
    tok_errors: int
    tok_error_pct: float
    raw: str


class PipelineError(RuntimeError):
    pass


def run_cmd(cmd: list[str], cwd: Path | None = None) -> str:
    proc = subprocess.run(cmd, cwd=str(cwd) if cwd else None, text=True, capture_output=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        raise PipelineError(f"command failed: {' '.join(shlex.quote(c) for c in cmd)}\n{out}")
    return out


def parse_check_output(text: str) -> CheckResult:
    m = CHECK_RE.search(text)
    if m:
        return CheckResult(
            seq_errors=int(m.group("seq")),
            seq_error_pct=float(m.group("seq_pct")),
            tok_errors=int(m.group("tok")),
            tok_error_pct=float(m.group("tok_pct")),
            raw=text.strip(),
        )
    if "Checking" in text and "✓" in text:
        return CheckResult(seq_errors=0, seq_error_pct=0.0, tok_errors=0, tok_error_pct=0.0, raw=text.strip())
    raise PipelineError(f"could not parse anystyle check output:\n{text}")


def score(result: CheckResult) -> tuple[float, float, int, int]:
    # Lower is better; prioritize token error, then sequence error.
    return (result.tok_error_pct, result.seq_error_pct, result.tok_errors, result.seq_errors)


def write_dataset_xml(path: Path, seqs: list[ET.Element]) -> None:
    root = ET.Element("dataset")
    for seq in seqs:
        root.append(seq)
    tree = ET.ElementTree(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(path, encoding="utf-8", xml_declaration=True)


def avg_results(results: list[CheckResult]) -> CheckResult:
    if not results:
        raise PipelineError("no results to average")
    n = len(results)
    seq_err = sum(r.seq_errors for r in results) / n
    seq_pct = sum(r.seq_error_pct for r in results) / n
    tok_err = sum(r.tok_errors for r in results) / n
    tok_pct = sum(r.tok_error_pct for r in results) / n
    return CheckResult(
        seq_errors=int(round(seq_err)),
        seq_error_pct=seq_pct,
        tok_errors=int(round(tok_err)),
        tok_error_pct=tok_pct,
        raw=f"kfold_avg_over_{n}",
    )


def parse_args() -> argparse.Namespace:
    ws = Path(__file__).resolve().parent
    teia = ws.parents[2]
    annotarium = teia / "annotarium"

    p = argparse.ArgumentParser(description="Run AnyStyle improvement pipeline and compare candidate vs baseline.")
    p.add_argument("--workspace", type=Path, default=ws)
    p.add_argument("--dataset-dir", type=Path, default=teia / "python_backend_legacy" / "dataset")
    p.add_argument("--anystyle-cmd", type=Path, default=annotarium / "scripts" / "anystyle.sh")
    p.add_argument("--baseline-model", type=Path, default=ws / "models" / "custom_v2.mod")
    p.add_argument("--candidate-name", default="custom_auto")
    p.add_argument("--max-seed-refs", type=int, default=2500)
    p.add_argument("--dev-ratio", type=float, default=0.2)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--kfold", type=int, default=1, help="Number of folds for cross-validation (default 1 = disabled)")
    p.add_argument("--prefer-human-gold", dest="prefer_human_gold", action="store_true", default=True, help="Prefer training/gold_labels.human.xml when available")
    p.add_argument("--no-prefer-human-gold", dest="prefer_human_gold", action="store_false", help="Disable human-gold preference")
    p.add_argument("--human-gold-path", type=Path, default=ws / "training" / "gold_labels.human.xml")
    p.add_argument("--min-human-gold", type=int, default=50, help="Minimum sequence count to accept human gold")
    p.add_argument(
        "--min-human-gold-for-promotion",
        type=int,
        default=300,
        help="Minimum human-gold sequence count required to allow model promotion",
    )
    p.add_argument("--promote", action="store_true", help="If candidate beats baseline, copy to models/custom_best.mod")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    ws = args.workspace.expanduser().resolve()
    dataset_dir = args.dataset_dir.expanduser().resolve()
    anystyle_cmd = args.anystyle_cmd.expanduser().resolve()

    training = ws / "training"
    models = ws / "models"
    reports = ws / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    models.mkdir(parents=True, exist_ok=True)

    timestamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    candidate_model = models / f"{args.candidate_name}_{timestamp}.mod"
    baseline_model = args.baseline_model.expanduser().resolve()

    log: dict[str, object] = {
        "timestamp_utc": timestamp,
        "workspace": str(ws),
        "dataset_dir": str(dataset_dir),
        "baseline_model": str(baseline_model),
        "candidate_model": str(candidate_model),
        "steps": [],
    }

    def step(name: str, cmd: list[str], cwd: Path | None = None) -> str:
        out = run_cmd(cmd, cwd=cwd)
        log["steps"].append({"name": name, "cmd": cmd, "cwd": str(cwd) if cwd else None, "output": out})
        return out

    # 1) Determine source gold dataset.
    curated_xml = training / "gold_labels.pipeline.xml"
    human_gold = args.human_gold_path.expanduser().resolve()
    use_human = False
    human_count = 0
    if args.prefer_human_gold and human_gold.is_file():
        try:
            human_count = len(ET.parse(human_gold).getroot().findall("sequence"))
            use_human = human_count >= args.min_human_gold
        except Exception:
            use_human = False
            human_count = 0

    if use_human:
        curated_xml = human_gold
        log["steps"].append(
            {
                "name": "use_human_gold",
                "cmd": [],
                "cwd": None,
                "output": f"using {human_gold} with sequences={human_count}",
            }
        )
    else:
        # 2) Build raw refs + draft xml from dataset JSON.
        step(
            "build_training_data",
            [
                "python3",
                str(ws / "build_training_data.py"),
                "--dataset-dir",
                str(dataset_dir),
                "--workspace-dir",
                str(ws),
                "--anystyle-cmd",
                str(anystyle_cmd),
                "--build-draft-xml",
            ],
            cwd=ws.parents[2],
        )

        # 3) Build seed gold labels.
        step(
            "create_gold_labels",
            [
                "python3",
                str(ws / "create_gold_labels.py"),
                "--workspace-dir",
                str(ws),
                "--anystyle-cmd",
                str(anystyle_cmd),
                "--max-refs",
                str(args.max_seed_refs),
            ],
            cwd=ws.parents[2],
        )

        # 4) Curate seed gold labels.
        step(
            "curate_gold_labels",
            [
                "python3",
                str(ws / "curate_gold_labels.py"),
                "--input",
                str(training / "gold_labels.xml"),
                "--output",
                str(curated_xml),
            ],
            cwd=ws.parents[2],
        )

    # 5) Split curated train/dev.
    train_xml = training / "train.pipeline.xml"
    dev_xml = training / "dev.pipeline.xml"
    step(
        "split_gold_labels",
        [
            "python3",
            str(ws / "split_gold_labels.py"),
            "--input",
            str(curated_xml),
            "--train-out",
            str(train_xml),
            "--dev-out",
            str(dev_xml),
            "--dev-ratio",
            str(args.dev_ratio),
            "--seed",
            str(args.seed),
        ],
        cwd=ws.parents[2],
    )

    # 5) Train candidate.
    step(
        "train_candidate",
        [
            str(anystyle_cmd),
            "train",
            str(train_xml),
            str(candidate_model),
        ],
        cwd=anystyle_cmd.parent.parent,
    )

    # 6) Evaluate candidate on pipeline dev.
    cand_dev_out = step(
        "check_candidate_on_dev_pipeline",
        [
            str(anystyle_cmd),
            "-P",
            str(candidate_model),
            "check",
            str(dev_xml),
        ],
        cwd=anystyle_cmd.parent.parent,
    )
    cand_dev = parse_check_output(cand_dev_out)

    # 7) Choose benchmark split: prefer dev.v3.xml if it exists, else use pipeline dev.
    benchmark_dev = training / "dev.v3.xml"
    if not benchmark_dev.is_file():
        benchmark_dev = dev_xml

    cand_bench_out = step(
        "check_candidate_on_benchmark",
        [
            str(anystyle_cmd),
            "-P",
            str(candidate_model),
            "check",
            str(benchmark_dev),
        ],
        cwd=anystyle_cmd.parent.parent,
    )
    cand_bench = parse_check_output(cand_bench_out)

    baseline_exists = baseline_model.is_file()
    baseline_bench = None
    if baseline_exists:
        base_out = step(
            "check_baseline_on_benchmark",
            [
                str(anystyle_cmd),
                "-P",
                str(baseline_model),
                "check",
                str(benchmark_dev),
            ],
            cwd=anystyle_cmd.parent.parent,
        )
        baseline_bench = parse_check_output(base_out)

    kfold_summary = None
    if args.kfold >= 2:
        curated_root = ET.parse(curated_xml).getroot()
        all_seqs = list(curated_root.findall("sequence"))
        if len(all_seqs) < args.kfold * 4:
            raise PipelineError(f"not enough sequences ({len(all_seqs)}) for kfold={args.kfold}")

        rnd = random.Random(args.seed)
        idx = list(range(len(all_seqs)))
        rnd.shuffle(idx)

        fold_size = len(idx) // args.kfold
        folds: list[list[int]] = []
        start = 0
        for i in range(args.kfold):
            end = start + fold_size + (1 if i < (len(idx) % args.kfold) else 0)
            folds.append(idx[start:end])
            start = end

        kfold_dir = ws / "tmp" / f"kfold_{timestamp}"
        kfold_dir.mkdir(parents=True, exist_ok=True)

        cand_fold_results: list[CheckResult] = []
        base_fold_results: list[CheckResult] = []

        for fi, test_idx in enumerate(folds, start=1):
            test_set = set(test_idx)
            train_seqs = [all_seqs[i] for i in range(len(all_seqs)) if i not in test_set]
            test_seqs = [all_seqs[i] for i in range(len(all_seqs)) if i in test_set]

            fold_train = kfold_dir / f"train_fold{fi}.xml"
            fold_test = kfold_dir / f"test_fold{fi}.xml"
            fold_model = kfold_dir / f"candidate_fold{fi}.mod"

            write_dataset_xml(fold_train, train_seqs)
            write_dataset_xml(fold_test, test_seqs)

            step(
                f"kfold_train_fold_{fi}",
                [str(anystyle_cmd), "train", str(fold_train), str(fold_model)],
                cwd=anystyle_cmd.parent.parent,
            )
            cand_fold_out = step(
                f"kfold_check_candidate_fold_{fi}",
                [str(anystyle_cmd), "-P", str(fold_model), "check", str(fold_test)],
                cwd=anystyle_cmd.parent.parent,
            )
            cand_fold_results.append(parse_check_output(cand_fold_out))

            if baseline_exists:
                base_fold_out = step(
                    f"kfold_check_baseline_fold_{fi}",
                    [str(anystyle_cmd), "-P", str(baseline_model), "check", str(fold_test)],
                    cwd=anystyle_cmd.parent.parent,
                )
                base_fold_results.append(parse_check_output(base_fold_out))

        cand_kfold_avg = avg_results(cand_fold_results)
        base_kfold_avg = avg_results(base_fold_results) if base_fold_results else None
        kfold_summary = {
            "folds": args.kfold,
            "candidate_folds": [r.__dict__ for r in cand_fold_results],
            "baseline_folds": [r.__dict__ for r in base_fold_results],
            "candidate_avg": cand_kfold_avg.__dict__,
            "baseline_avg": base_kfold_avg.__dict__ if base_kfold_avg else None,
            "kfold_dir": str(kfold_dir),
        }

    decision = "candidate_only"
    decision_reasons: list[str] = []
    if kfold_summary and kfold_summary.get("baseline_avg") and baseline_bench is not None:
        cand_avg = CheckResult(**kfold_summary["candidate_avg"])
        base_avg = CheckResult(**kfold_summary["baseline_avg"])
        kfold_better = score(cand_avg) < score(base_avg)
        benchmark_non_regression = score(cand_bench) <= score(baseline_bench)
        if kfold_better:
            decision_reasons.append("kfold_better")
        else:
            decision_reasons.append("kfold_not_better")
        if benchmark_non_regression:
            decision_reasons.append("benchmark_non_regression")
        else:
            decision_reasons.append("benchmark_regression")
        decision = "promote_candidate" if (kfold_better and benchmark_non_regression) else "keep_baseline"
    elif baseline_bench is not None:
        benchmark_non_regression = score(cand_bench) <= score(baseline_bench)
        decision_reasons.append("benchmark_non_regression" if benchmark_non_regression else "benchmark_regression")
        decision = "promote_candidate" if benchmark_non_regression else "keep_baseline"

    promotion_blocked = False
    promotion_block_reason = ""
    if decision == "promote_candidate":
        if use_human and human_count < args.min_human_gold_for_promotion:
            promotion_blocked = True
            promotion_block_reason = (
                f"human_gold_too_small:{human_count}<{args.min_human_gold_for_promotion}"
            )
            decision = "keep_baseline"

    promoted_path = None
    if args.promote and decision == "promote_candidate" and not promotion_blocked:
        promoted_path = models / "custom_best.mod"
        promoted_path.write_bytes(candidate_model.read_bytes())

    summary = {
        "benchmark_dev": str(benchmark_dev),
        "candidate_dev": cand_dev.__dict__,
        "candidate_benchmark": cand_bench.__dict__,
        "baseline_benchmark": baseline_bench.__dict__ if baseline_bench else None,
        "kfold": kfold_summary,
        "decision": decision,
        "decision_reasons": decision_reasons,
        "promotion_blocked": promotion_blocked,
        "promotion_block_reason": promotion_block_reason,
        "human_gold_used": use_human,
        "human_gold_count": human_count,
        "promoted_path": str(promoted_path) if promoted_path else None,
    }
    log["summary"] = summary

    report_json = reports / f"improvement_report_{timestamp}.json"
    report_md = reports / f"improvement_report_{timestamp}.md"
    report_json.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")

    md_lines = [
        f"# AnyStyle Improvement Report ({timestamp})",
        "",
        f"- Benchmark dev: `{benchmark_dev}`",
        f"- Candidate model: `{candidate_model}`",
        f"- Baseline model: `{baseline_model}`",
        f"- Decision: `{decision}`",
        f"- Decision reasons: `{', '.join(decision_reasons) if decision_reasons else 'n/a'}`",
        "",
        "## Metrics",
        f"- Candidate on pipeline dev: seq `{cand_dev.seq_error_pct:.2f}%` ({cand_dev.seq_errors}), tok `{cand_dev.tok_error_pct:.2f}%` ({cand_dev.tok_errors})",
        f"- Candidate on benchmark: seq `{cand_bench.seq_error_pct:.2f}%` ({cand_bench.seq_errors}), tok `{cand_bench.tok_error_pct:.2f}%` ({cand_bench.tok_errors})",
    ]
    if baseline_bench:
        md_lines.append(
            f"- Baseline on benchmark: seq `{baseline_bench.seq_error_pct:.2f}%` ({baseline_bench.seq_errors}), tok `{baseline_bench.tok_error_pct:.2f}%` ({baseline_bench.tok_errors})"
        )
    md_lines.extend(
        [
            "",
            "## Promotion Guard",
            f"- Human gold used: `{use_human}`",
            f"- Human gold count: `{human_count}`",
            f"- Min human gold for promotion: `{args.min_human_gold_for_promotion}`",
            f"- Promotion blocked: `{promotion_blocked}`",
        ]
    )
    if promotion_block_reason:
        md_lines.append(f"- Promotion block reason: `{promotion_block_reason}`")
    if kfold_summary:
        cand_avg = kfold_summary["candidate_avg"]
        base_avg = kfold_summary.get("baseline_avg")
        md_lines.extend(
            [
                "",
                "## K-Fold",
                f"- Folds: `{kfold_summary['folds']}`",
                f"- Candidate k-fold avg: seq `{cand_avg['seq_error_pct']:.2f}%` ({cand_avg['seq_errors']}), tok `{cand_avg['tok_error_pct']:.2f}%` ({cand_avg['tok_errors']})",
            ]
        )
        if base_avg:
            md_lines.append(
                f"- Baseline k-fold avg: seq `{base_avg['seq_error_pct']:.2f}%` ({base_avg['seq_errors']}), tok `{base_avg['tok_error_pct']:.2f}%` ({base_avg['tok_errors']})"
            )
    if promoted_path:
        md_lines.append(f"- Promoted model: `{promoted_path}`")

    report_md.write_text("\n".join(md_lines) + "\n", encoding="utf-8")

    print(f"report_json={report_json}")
    print(f"report_md={report_md}")
    print(f"decision={decision}")
    print(f"candidate_model={candidate_model}")
    if promoted_path:
        print(f"promoted_path={promoted_path}")

    return 0


if __name__ == "__main__":
    # Keep pipeline deterministic across runs.
    os.environ.setdefault("PYTHONHASHSEED", "0")
    raise SystemExit(main())
