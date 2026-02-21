#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import subprocess
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fill suggest_* columns in queue.tsv using AnyStyle parse output.")
    p.add_argument("--queue-tsv", type=Path, default=Path(__file__).resolve().parent / "queue.tsv")
    p.add_argument("--anystyle-cmd", type=Path, default=Path(__file__).resolve().parents[4] / "annotarium" / "scripts" / "anystyle.sh")
    p.add_argument("--limit", type=int, default=0, help="Max todo rows to suggest (0=all)")
    return p.parse_args()


def join_list(obj: dict, key: str) -> str:
    vals = obj.get(key)
    if not isinstance(vals, list):
        return ""
    if key == "author":
        out = []
        for a in vals:
            if isinstance(a, dict):
                fam = str(a.get("family") or "").strip()
                giv = str(a.get("given") or "").strip()
                out.append(", ".join([p for p in [fam, giv] if p]))
            else:
                out.append(str(a))
        return "; ".join([s for s in out if s])
    return " ".join(str(v).strip() for v in vals if str(v).strip())


def main() -> int:
    args = parse_args()
    qpath = args.queue_tsv.expanduser().resolve()
    anystyle = args.anystyle_cmd.expanduser().resolve()

    rows = []
    with qpath.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        headers = reader.fieldnames or []
        for r in reader:
            rows.append(r)

    todo_idx = [i for i, r in enumerate(rows) if (r.get("status") or "").strip().lower() == "todo"]
    if args.limit > 0:
        todo_idx = todo_idx[: args.limit]

    refs = [rows[i].get("reference_text", "") for i in todo_idx]
    tmp_txt = qpath.parent / ".tmp_refs_for_suggest.txt"
    tmp_txt.write_text("\n".join(refs) + ("\n" if refs else ""), encoding="utf-8")

    cmd = [str(anystyle), "--stdout", "-f", "json", "parse", str(tmp_txt)]
    proc = subprocess.run(cmd, text=True, capture_output=True)
    if proc.returncode != 0:
        raise SystemExit(f"anystyle parse failed:\n{proc.stderr}")

    parsed = json.loads(proc.stdout)
    if not isinstance(parsed, list):
        raise SystemExit("unexpected parse output")

    for k, row_i in enumerate(todo_idx):
        p = parsed[k] if k < len(parsed) and isinstance(parsed[k], dict) else {}
        rows[row_i]["suggest_author"] = join_list(p, "author")
        rows[row_i]["suggest_title"] = join_list(p, "title")
        rows[row_i]["suggest_journal"] = join_list(p, "journal")
        rows[row_i]["suggest_container_title"] = join_list(p, "container-title")
        rows[row_i]["suggest_volume"] = join_list(p, "volume")
        rows[row_i]["suggest_issue"] = join_list(p, "issue")
        rows[row_i]["suggest_pages"] = join_list(p, "pages")
        rows[row_i]["suggest_date"] = join_list(p, "date")
        rows[row_i]["suggest_publisher"] = join_list(p, "publisher")

    with qpath.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=headers, delimiter="\t")
        w.writeheader()
        w.writerows(rows)

    try:
        tmp_txt.unlink(missing_ok=True)
    except Exception:
        pass

    print(f"queue={qpath}")
    print(f"todo_rows={len(todo_idx)}")
    print("status=suggestions_written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
