#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def run(cmd: list[str], cwd: Path | None = None) -> None:
    proc = subprocess.run(cmd, cwd=str(cwd) if cwd else None, text=True, capture_output=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    print(f"$ {' '.join(cmd)}")
    print(out.strip())
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def parse_args() -> argparse.Namespace:
    base = Path(__file__).resolve().parent
    ws = base.parents[0]
    teia = ws.parents[2]
    p = argparse.ArgumentParser(description="Run one human-in-the-loop labeling cycle.")
    p.add_argument("--queue-tsv", type=Path, default=base / "queue.tsv")
    p.add_argument("--input-tsv", type=Path, default=ws / "exports" / "references_with_source.tsv")
    p.add_argument("--anystyle-cmd", type=Path, default=teia / "annotarium" / "scripts" / "anystyle.sh")
    p.add_argument("--max-rows", type=int, default=800)
    p.add_argument("--suggest-limit", type=int, default=300)
    p.add_argument("--approve-auto", action="store_true", help="Mark todo rows as approved when valid (bootstrapping mode)")
    p.add_argument("--export-min-rows", type=int, default=50)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    base = Path(__file__).resolve().parent

    run([
        "python3", str(base / "build_queue.py"),
        "--input-tsv", str(args.input_tsv),
        "--output-tsv", str(args.queue_tsv),
        "--max-rows", str(args.max_rows),
    ])

    run([
        "python3", str(base / "suggest_labels.py"),
        "--queue-tsv", str(args.queue_tsv),
        "--anystyle-cmd", str(args.anystyle_cmd),
        "--limit", str(args.suggest_limit),
    ])

    validate_cmd = [
        "python3", str(base / "validate_queue.py"),
        "--queue-tsv", str(args.queue_tsv),
        "--report-tsv", str(base / "validation_report.tsv"),
    ]
    if args.approve_auto:
        validate_cmd.append("--mark-approved-valid")
    run(validate_cmd)

    run([
        "python3", str(base / "export_gold_xml.py"),
        "--queue-tsv", str(args.queue_tsv),
        "--output-xml", str(base.parents[0] / "training" / "gold_labels.human.xml"),
        "--min-rows", str(args.export_min_rows),
    ])

    print("cycle_status=ok")
    print(f"queue={args.queue_tsv}")
    print(f"review_next=edit status/final_* columns in {args.queue_tsv}")
    print(f"exported_xml={base.parents[0] / 'training' / 'gold_labels.human.xml'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
