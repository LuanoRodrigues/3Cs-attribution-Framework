#!/usr/bin/env python3
"""
Apply refreshed citation-linking + metadata enrichment into dataset files.

Behavior:
- `.md` cached files:
  - Replace old citation-related values (`full_text`, `references`, `citations`, `flat_text`)
  - Insert/update `metadata`, `validation`, `citation_summary`, `updated_at_utc`
- Raw `.json` OCR files:
  - Insert an enrichment payload under `--raw-target-key` (default: `reparse_enriched`)
  - Or write those fields at top level with `--raw-top-level`
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import signal
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


def load_reparse_module(repo_root: Path):
    module_path = repo_root / "scripts" / "reparse_footnotes_dataset.py"
    if not module_path.exists():
        raise FileNotFoundError(f"Missing module: {module_path}")
    spec = importlib.util.spec_from_file_location("reparse_footnotes_dataset_runtime", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Rewrite dataset records with latest citations + metadata parsed from "
            "current footnotes parser."
        )
    )
    parser.add_argument(
        "--dataset-dir",
        default="python_backend_legacy/dataset",
        help="Dataset directory containing .md/.json files.",
    )
    parser.add_argument(
        "--types",
        default="both",
        choices=("both", "md", "json"),
        help="Which file types to process.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional max number of files after sorting.",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Optional start offset after sorting (for chunked/resumable runs).",
    )
    parser.add_argument(
        "--hash-only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Only process files whose stem is a 64-char lowercase hex hash.",
    )
    parser.add_argument(
        "--prefer-pages-text",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="For .md cache files, rebuild from pages_text when available.",
    )
    parser.add_argument(
        "--raw-target-key",
        default="reparse_enriched",
        help="Target key for enrichment payload in raw .json files.",
    )
    parser.add_argument(
        "--raw-top-level",
        action="store_true",
        default=False,
        help="Write enrichment payload directly at top-level for raw .json files.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Do not write files; only compute and report.",
    )
    parser.add_argument(
        "--skip-existing",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Skip files that already contain complete replacement/enrichment fields.",
    )
    parser.add_argument(
        "--show-progress-every",
        type=int,
        default=25,
        help="Print progress every N files.",
    )
    parser.add_argument(
        "--report-out",
        default="python_backend_legacy/dataset/reparse_apply_report.json",
        help="Write an apply summary report JSON.",
    )
    parser.add_argument(
        "--per-file-timeout-seconds",
        type=int,
        default=45,
        help="Timeout per file for parser linking/enrichment; <=0 disables timeout.",
    )
    parser.add_argument(
        "--no-suppress-parser-logs",
        action="store_true",
        default=False,
        help="Do not suppress verbose prints from footnotes_parser.",
    )
    return parser.parse_args()


class PerFileTimeoutError(RuntimeError):
    pass


def run_with_timeout(seconds: int, fn, *args, **kwargs):
    if seconds is None or seconds <= 0:
        return fn(*args, **kwargs)

    def _handler(_signum, _frame):
        raise PerFileTimeoutError(f"Timed out after {seconds}s")

    prev = signal.signal(signal.SIGALRM, _handler)
    signal.alarm(seconds)
    try:
        return fn(*args, **kwargs)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, prev)


def build_md_update_payload(
    *,
    base_obj: Dict[str, Any],
    full_text: str,
    references: List[str],
    link_out: Dict[str, Any],
    metadata: Dict[str, Any],
    validation: Dict[str, Any],
    current_summary: Dict[str, Any],
    now_iso: str,
) -> Dict[str, Any]:
    out = dict(base_obj)
    out["full_text"] = full_text
    out["references"] = references
    out["citations"] = link_out
    out["flat_text"] = str(link_out.get("flat_text") or full_text)
    out["metadata"] = metadata
    out["validation"] = validation
    out["citation_summary"] = current_summary
    out["updated_at_utc"] = now_iso
    return out


def build_raw_enrichment_payload(
    *,
    full_text: str,
    references: List[str],
    link_out: Dict[str, Any],
    metadata: Dict[str, Any],
    validation: Dict[str, Any],
    current_summary: Dict[str, Any],
    now_iso: str,
) -> Dict[str, Any]:
    return {
        "full_text": full_text,
        "references": references,
        "flat_text": str(link_out.get("flat_text") or full_text),
        "citations": link_out,
        "citation_summary": current_summary,
        "metadata": metadata,
        "validation": validation,
        "updated_at_utc": now_iso,
    }


MD_REQUIRED_KEYS = (
    "full_text",
    "references",
    "citations",
    "flat_text",
    "metadata",
    "validation",
    "citation_summary",
    "updated_at_utc",
)
RAW_REQUIRED_KEYS = (
    "full_text",
    "references",
    "flat_text",
    "citations",
    "metadata",
    "validation",
    "citation_summary",
    "updated_at_utc",
)


def md_has_complete_replacement(obj: Dict[str, Any]) -> bool:
    return all(k in obj for k in MD_REQUIRED_KEYS)


def raw_has_complete_replacement(obj: Dict[str, Any], raw_top_level: bool, raw_target_key: str) -> bool:
    if raw_top_level:
        return all(k in obj for k in RAW_REQUIRED_KEYS)
    inner = obj.get(raw_target_key)
    if not isinstance(inner, dict):
        return False
    return all(k in inner for k in RAW_REQUIRED_KEYS)


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    dataset_dir = (repo_root / args.dataset_dir).resolve()
    report_path = (repo_root / args.report_out).resolve()

    if not dataset_dir.exists():
        raise FileNotFoundError(f"Dataset directory not found: {dataset_dir}")

    rpd = load_reparse_module(repo_root)
    linker = rpd.load_linker(repo_root)

    include_md = args.types in {"both", "md"}
    include_json = args.types in {"both", "json"}
    files = rpd.sorted_files(dataset_dir, include_md, include_json, None, args.hash_only)
    if args.offset and args.offset > 0:
        files = files[args.offset :]
    if args.limit is not None and args.limit > 0:
        files = files[: args.limit]
    if not files:
        raise RuntimeError(f"No files found in {dataset_dir} for types={args.types}")

    results: List[Dict[str, Any]] = []
    ok_count = 0
    fail_count = 0
    skipped_count = 0

    for idx, path in enumerate(files, start=1):
        rel_path = str(path.relative_to(repo_root))
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(obj, dict):
                raise ValueError("Top-level JSON is not an object.")

            if args.skip_existing:
                if path.suffix == ".md" and md_has_complete_replacement(obj):
                    skipped_count += 1
                    results.append(
                        {
                            "file": rel_path,
                            "source_type": "md_cache",
                            "skipped": True,
                            "reason": "already_complete",
                        }
                    )
                    if args.show_progress_every > 0 and (idx % args.show_progress_every == 0 or idx == len(files)):
                        print(f"[{idx}/{len(files)}] processed")
                    continue
                if path.suffix != ".md" and raw_has_complete_replacement(
                    obj, args.raw_top_level, args.raw_target_key
                ):
                    skipped_count += 1
                    results.append(
                        {
                            "file": rel_path,
                            "source_type": "raw_json",
                            "skipped": True,
                            "reason": "already_complete",
                        }
                    )
                    if args.show_progress_every > 0 and (idx % args.show_progress_every == 0 or idx == len(files)):
                        print(f"[{idx}/{len(files)}] processed")
                    continue

            full_text = ""
            references: List[str] = []
            source_type = "md_cache" if path.suffix == ".md" else "raw_json"
            pages_count = 0

            if path.suffix == ".md":
                if args.prefer_pages_text:
                    pages = rpd.text_pages_from_md_cache(obj)
                    pages_count = len(pages)
                    if pages:
                        full_text, references = rpd.rebuild_single_document(pages)
                if not full_text:
                    full_text = str(obj.get("full_text") or "")
                    references = rpd.normalize_references(obj.get("references"))
            else:
                pages = rpd.text_pages_from_raw_json(obj)
                pages_count = len(pages)
                full_text, references = rpd.rebuild_single_document(pages)

            if not full_text.strip():
                raise ValueError("Reconstituted document is empty.")

            def _compute_enrichment():
                link_out_local = rpd.relink_document(
                    linker_fn=linker,
                    full_text=full_text,
                    references=references,
                    suppress_parser_logs=not args.no_suppress_parser_logs,
                )
                current_summary_local = rpd.summarize_link_output(link_out_local)
                heading_validation_local = rpd.validate_heading_structure(full_text, references)
                metadata_local = rpd.extract_document_metadata(
                    full_text=full_text,
                    references=references,
                    heading_validation=heading_validation_local,
                )
                validation_local = rpd.build_validations(
                    full_text=full_text,
                    references=references,
                    link_out=link_out_local,
                    current_summary=current_summary_local,
                    metadata=metadata_local,
                )
                return link_out_local, current_summary_local, metadata_local, validation_local

            link_out, current_summary, metadata, validation = run_with_timeout(
                args.per_file_timeout_seconds,
                _compute_enrichment,
            )

            if path.suffix == ".md":
                updated_obj = build_md_update_payload(
                    base_obj=obj,
                    full_text=full_text,
                    references=references,
                    link_out=link_out,
                    metadata=metadata,
                    validation=validation,
                    current_summary=current_summary,
                    now_iso=now_iso,
                )
            else:
                enrichment = build_raw_enrichment_payload(
                    full_text=full_text,
                    references=references,
                    link_out=link_out,
                    metadata=metadata,
                    validation=validation,
                    current_summary=current_summary,
                    now_iso=now_iso,
                )
                updated_obj = dict(obj)
                if args.raw_top_level:
                    updated_obj.update(enrichment)
                else:
                    updated_obj[args.raw_target_key] = enrichment

            if not args.dry_run:
                path.write_text(json.dumps(updated_obj, ensure_ascii=False, indent=2), encoding="utf-8")

            ok_count += 1
            results.append(
                {
                    "file": rel_path,
                    "source_type": source_type,
                    "pages_count": pages_count,
                    "text_chars": len(full_text),
                    "references_count": len(references),
                    "style": current_summary.get("style"),
                    "dominant_bucket": current_summary.get("dominant_bucket"),
                    "dry_run": args.dry_run,
                }
            )
        except Exception as exc:
            fail_count += 1
            results.append(
                {
                    "file": rel_path,
                    "source_type": "md_cache" if path.suffix == ".md" else "raw_json",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )

        if args.show_progress_every > 0 and (idx % args.show_progress_every == 0 or idx == len(files)):
            print(f"[{idx}/{len(files)}] processed")

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_dir": str(dataset_dir),
        "options": {
            "types": args.types,
            "limit": args.limit,
            "offset": args.offset,
            "hash_only": args.hash_only,
            "prefer_pages_text": args.prefer_pages_text,
            "raw_target_key": args.raw_target_key,
            "raw_top_level": args.raw_top_level,
            "dry_run": args.dry_run,
            "skip_existing": args.skip_existing,
            "per_file_timeout_seconds": args.per_file_timeout_seconds,
            "suppress_parser_logs": not args.no_suppress_parser_logs,
        },
        "summary": {
            "documents_total": len(files),
            "documents_ok": ok_count,
            "documents_failed": fail_count,
            "documents_skipped": skipped_count,
        },
        "results": results,
    }

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Apply report written: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
