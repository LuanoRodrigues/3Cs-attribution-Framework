#!/usr/bin/env python3
import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path


def _bootstrap(repo_root: Path) -> None:
    candidates = [
        repo_root,
        repo_root / "my-electron-app",
        repo_root / "my-electron-app" / "shared",
        repo_root / "my-electron-app" / "shared" / "python_backend",
        repo_root / "my-electron-app" / "shared" / "python_backend" / "retrieve",
    ]
    for candidate in candidates:
        s = str(candidate)
        if candidate.exists() and s not in sys.path:
            sys.path.insert(0, s)


def _load_env(env_path: Path) -> None:
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        s = line.strip().strip("\r")
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _load_module(repo_root: Path):
    zpath = repo_root / "my-electron-app" / "shared" / "python_backend" / "retrieve" / "zotero_class.py"
    spec = importlib.util.spec_from_file_location("zotero_class_probe", str(zpath))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load module: {zpath}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe open-coding path up to PDF parsing.")
    parser.add_argument("--collection-name", required=True)
    parser.add_argument("--collection-key", default="")
    parser.add_argument("--research-question", required=True)
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--prompt-key", default="code_pdf_page")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    _bootstrap(repo_root)
    _load_env(repo_root / "my-electron-app" / ".env")
    zc = _load_module(repo_root)

    # Avoid model calls during probe; we only test item->PDF->process_pdf path.
    zc.call_models = lambda **_kwargs: {"evidence": []}

    library_id = str(os.getenv("ZOTERO_LIBRARY_ID") or os.getenv("LIBRARY_ID") or "").strip()
    library_type = str(os.getenv("ZOTERO_LIBRARY_TYPE") or os.getenv("LIBRARY_TYPE") or "user").strip() or "user"
    api_key = str(os.getenv("ZOTERO_API_KEY") or os.getenv("API_KEY") or os.getenv("ZOTERO_KEY") or "").strip()
    if not library_id or not api_key:
        raise RuntimeError("Missing Zotero credentials in .env")

    client = zc.Zotero(library_id=library_id, library_type=library_type, api_key=api_key)
    items = client.get_all_items(
        collection_name=str(args.collection_name or "").strip() or None,
        collection_key=str(args.collection_key or "").strip() or None,
        cache=False,
    )
    items = list(items or [])[: max(1, int(args.limit))]

    report = {
        "collection_name": args.collection_name,
        "collection_key": args.collection_key,
        "limit": args.limit,
        "checked_items": 0,
        "failures": [],
        "results": [],
    }

    rq = str(args.research_question or "").strip()
    rq_lines = "\n".join([f"0: {rq}"]) if rq else "0: [RQ missing]"

    for item in items:
        item_key = str(item.get("key") or "").strip()
        row = {
            "item_key": item_key,
            "pdf_path": "",
            "has_pdf_path": False,
            "process_pdf_ok": False,
            "sections_count": 0,
            "process_pdf_error": "",
            "code_single_item_results": 0,
            "fails": [],
        }
        report["checked_items"] += 1

        if not item_key:
            row["fails"].append("missing_item_key")
            report["results"].append(row)
            report["failures"].append({"item_key": "", "reason": "missing_item_key"})
            continue

        try:
            pdf_path = str(client.get_pdf_path_for_item(item_key) or "").strip()
        except Exception as exc:
            pdf_path = ""
            row["fails"].append(f"get_pdf_path_error:{type(exc).__name__}")
        row["pdf_path"] = pdf_path
        row["has_pdf_path"] = bool(pdf_path)
        if not pdf_path:
            row["fails"].append("no_pdf_path")
            report["results"].append(row)
            report["failures"].append({"item_key": item_key, "reason": "no_pdf_path"})
            continue

        try:
            parsed = zc.process_pdf(
                pdf_path=pdf_path,
                cache=False,
                cache_full=True,
                mistral_model="mistral-ocr-latest",
                ocr_retry=5,
                core_sections=True,
            ) or {}
            sections = parsed.get("sections") if isinstance(parsed, dict) else {}
            row["sections_count"] = len(sections) if isinstance(sections, dict) else 0
            row["process_pdf_ok"] = row["sections_count"] > 0
            if not row["process_pdf_ok"]:
                row["fails"].append("process_pdf_empty_sections")
        except Exception as exc:
            row["process_pdf_error"] = type(exc).__name__
            row["fails"].append(f"process_pdf_error:{type(exc).__name__}")

        try:
            per_item = client.code_single_item(
                item=item,
                research_question=rq_lines,
                core_sections=True,
                prompt_key=args.prompt_key,
                read=False,
                store_only=False,
                cache=False,
                collection_name=str(args.collection_name),
            ) or []
            row["code_single_item_results"] = len(per_item)
            if len(per_item) == 0:
                row["fails"].append("code_single_item_empty")
        except Exception as exc:
            row["fails"].append(f"code_single_item_error:{type(exc).__name__}")

        if row["fails"]:
            report["failures"].append({"item_key": item_key, "reason": ";".join(row["fails"])})
        report["results"].append(row)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
