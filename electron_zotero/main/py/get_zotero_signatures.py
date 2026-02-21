#!/usr/bin/env python3
import ast
import json
import sys
from pathlib import Path

FUNCTIONS = [
    "set_eligibility_criteria",
    "open_coding", "code_single_item", "open_coding_policy_cluster", "code_single_item_policy_cluster",
    "Verbatim_Evidence_Coding", "paper_coding", "cluster_notes_codes",
    "keyword_analysis", "keyword_analysis_multi", "keyword_html_first_pass", "consolidate_keyword_batches",
    "consolidate_keyword_batches_html", "run_store_only_then_collect", "build_thematic_section_after_collect",
    "thematic_section_from_consolidated_html", "extract_entity_affiliation", "extract_na", "extract_na_flat",
    "get_item_payload", "screening_articles", "classify_by_title", "_classification_12_features",
    "split_collection_by_status_tag", "parse_extra_justifications", "export_collection_to_csv",
    "download_attach_pdf", "download_pdfs_from_collections", "get_note_by_tag", "_parse_note_html",
    "_append_to_tagged_note", "summary_collection_prisma", "filter_missing_keyword", "compare_collections",
    "getting_duplicates", "get_all_items", "download_attach_pdf"
]

def resolve_zotero_class_path(repo_root: Path) -> Path:
    candidates = [
        repo_root / "zotero_module" / "zotero_class.py",
        repo_root / "my-electron-app" / "shared" / "python_backend" / "retrieve" / "zotero_class.py",
        repo_root / "electron_zotero" / "zotero_module" / "zotero_class.py",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"zotero_class.py not found. Tried: {', '.join(str(p) for p in candidates)}")


def infer_type(default_node):
    if default_node is None:
        return "string"
    if isinstance(default_node, ast.Constant):
        v = default_node.value
        if isinstance(v, bool):
            return "boolean"
        if isinstance(v, (int, float)):
            return "number"
        if isinstance(v, (list, tuple, dict)):
            return "json"
        if v is None:
            return "string"
        return "string"
    if isinstance(default_node, (ast.List, ast.Dict, ast.Tuple)):
        return "json"
    return "string"


def node_to_default(default_node):
    if default_node is None:
        return None
    if isinstance(default_node, ast.Constant):
        return default_node.value
    if isinstance(default_node, ast.List):
        out = []
        for el in default_node.elts:
            if isinstance(el, ast.Constant):
                out.append(el.value)
            else:
                return None
        return out
    if isinstance(default_node, ast.Tuple):
        out = []
        for el in default_node.elts:
            if isinstance(el, ast.Constant):
                out.append(el.value)
            else:
                return None
        return out
    if isinstance(default_node, ast.Dict):
        out = {}
        for k, v in zip(default_node.keys, default_node.values):
            if isinstance(k, ast.Constant) and isinstance(v, ast.Constant):
                out[str(k.value)] = v.value
            else:
                return None
        return out
    return None


def build_signatures(file_path: Path):
    source = file_path.read_text(encoding="utf-8")
    mod = ast.parse(source)
    cls = next((n for n in mod.body if isinstance(n, ast.ClassDef) and n.name == "Zotero"), None)
    if cls is None:
        return {}

    wanted = set(FUNCTIONS)
    out = {}
    for fn in cls.body:
        if not isinstance(fn, ast.FunctionDef):
            continue
        if fn.name not in wanted:
            continue

        args = [a.arg for a in fn.args.args]
        # Drop self
        if args and args[0] == "self":
            args = args[1:]

        defaults = list(fn.args.defaults)
        no_default_count = len(args) - len(defaults)
        arg_rows = []
        for idx, arg_name in enumerate(args):
            default_node = None
            if idx >= no_default_count:
                default_node = defaults[idx - no_default_count]
            required = idx < no_default_count
            inferred = infer_type(default_node)
            default_value = node_to_default(default_node)
            row = {
                "key": arg_name,
                "type": inferred,
                "required": required
            }
            if default_value is not None:
                row["default"] = default_value
            arg_rows.append(row)

        out[fn.name] = {
            "functionName": fn.name,
            "args": arg_rows
        }
    return out


def main():
    try:
        repo_root = Path(__file__).resolve().parents[3]
        zpath = resolve_zotero_class_path(repo_root)
        sig = build_signatures(zpath)
        print(json.dumps({"status": "ok", "signatures": sig}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
