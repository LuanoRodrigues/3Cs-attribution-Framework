#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


def _load_batch(path: Path) -> list[dict[str, Any]]:
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(obj, list):
        raise ValueError("batch file must be a JSON array")
    out: list[dict[str, Any]] = []
    for it in obj:
        if isinstance(it, str):
            out.append({"pdf": it})
        elif isinstance(it, dict) and "pdf" in it:
            out.append(it)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Batch runner for infer_missing_footnotes.py")
    ap.add_argument("--batch-json", required=True, help="JSON array of {pdf, markdown?, output?, expected_footnotes_max?}")
    ap.add_argument("--summary-json", default="", help="Optional summary output path")
    ap.add_argument("--extra-args", default="", help="Extra args passed to each run")
    args = ap.parse_args()

    batch_path = Path(args.batch_json).expanduser().resolve()
    rows = _load_batch(batch_path)
    script = Path(__file__).resolve().parent / "infer_missing_footnotes.py"
    summary: list[dict[str, Any]] = []
    any_fail = False

    extra = [x for x in args.extra_args.split(" ") if x.strip()]
    for row in rows:
        pdf = str(row.get("pdf", "")).strip()
        if not pdf:
            continue
        cmd = [sys.executable, str(script), "--pdf", pdf]
        if row.get("markdown"):
            cmd += ["--markdown", str(row["markdown"])]
        if row.get("output"):
            cmd += ["--output", str(row["output"])]
        if row.get("expected_footnotes_max"):
            cmd += ["--expected-footnotes-max", str(row["expected_footnotes_max"])]
        cmd += extra
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        out_path = (proc.stdout or "").strip().splitlines()[-1] if (proc.stdout or "").strip() else ""
        summary.append(
            {
                "pdf": pdf,
                "returncode": proc.returncode,
                "output_path": out_path,
                "stderr": (proc.stderr or "").strip()[-1000:],
            }
        )
        if proc.returncode != 0:
            any_fail = True

    if args.summary_json:
        p = Path(args.summary_json).expanduser().resolve()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if any_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
