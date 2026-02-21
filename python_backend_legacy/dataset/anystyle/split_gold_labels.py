#!/usr/bin/env python3
from __future__ import annotations

import argparse
import random
import xml.etree.ElementTree as ET
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Split gold labels XML into train/dev XML files.")
    p.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).resolve().parent / "training" / "gold_labels.xml",
        help="Input gold labels XML",
    )
    p.add_argument(
        "--train-out",
        type=Path,
        default=Path(__file__).resolve().parent / "training" / "train.xml",
        help="Output train XML",
    )
    p.add_argument(
        "--dev-out",
        type=Path,
        default=Path(__file__).resolve().parent / "training" / "dev.xml",
        help="Output dev XML",
    )
    p.add_argument("--dev-ratio", type=float, default=0.2, help="Dev split ratio (default 0.2)")
    p.add_argument("--seed", type=int, default=42, help="Random seed")
    return p.parse_args()


def write_dataset(path: Path, sequences: list[ET.Element]) -> None:
    root = ET.Element("dataset")
    for seq in sequences:
        root.append(seq)
    tree = ET.ElementTree(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(path, encoding="utf-8", xml_declaration=True)


def main() -> int:
    args = parse_args()
    inp = args.input.expanduser().resolve()
    train_out = args.train_out.expanduser().resolve()
    dev_out = args.dev_out.expanduser().resolve()

    root = ET.parse(inp).getroot()
    seqs = list(root.findall("sequence"))
    n = len(seqs)
    if n < 10:
        raise SystemExit("Not enough sequences to split.")

    idx = list(range(n))
    rnd = random.Random(args.seed)
    rnd.shuffle(idx)

    dev_n = max(1, int(round(n * args.dev_ratio)))
    dev_idx = set(idx[:dev_n])

    train_seqs = [seqs[i] for i in range(n) if i not in dev_idx]
    dev_seqs = [seqs[i] for i in range(n) if i in dev_idx]

    write_dataset(train_out, train_seqs)
    write_dataset(dev_out, dev_seqs)

    print(f"input={inp}")
    print(f"total={n}")
    print(f"train={len(train_seqs)}")
    print(f"dev={len(dev_seqs)}")
    print(f"train_xml={train_out}")
    print(f"dev_xml={dev_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
