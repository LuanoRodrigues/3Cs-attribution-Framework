#!/usr/bin/env python3
"""
Lightweight Data Hub backend for Electron.
Supports:
  - load (zotero/file)
  - list_collections (zotero)
  - export_excel
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import math
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = next((parent for parent in BASE_DIR.parents if (parent / "package.json").is_file()), BASE_DIR.parents[-1])
SHARED_DIR = REPO_ROOT / "shared"
SHARED_PYTHON_ROOT = SHARED_DIR / "python_backend"
for entry in (SHARED_DIR, SHARED_PYTHON_ROOT, REPO_ROOT):
    entry_str = str(entry)
    if entry_str and entry_str not in sys.path:
        sys.path.insert(0, entry_str)


def _write_json_file(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        handle.write(_safe_json(payload))


def _extract_reference_items(table: Dict[str, Any]) -> List[Dict[str, Any]]:
    columns = [str(c) for c in (table.get("columns") or [])]
    rows = table.get("rows") or []
    if not isinstance(rows, list) or not columns:
        return []

    col_index = {str(name).strip().lower(): idx for idx, name in enumerate(columns)}

    def pick(row: List[Any], *names: str) -> Any:
        for name in names:
            idx = col_index.get(name)
            if idx is None:
                continue
            if idx < 0 or idx >= len(row):
                continue
            return row[idx]
        return None

    def to_text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, (list, tuple)):
            parts = [str(v).strip() for v in value if v is not None and str(v).strip()]
            return "; ".join(parts)
        return str(value).strip()

    items_by_key: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, list):
            continue

        # Explicit mapping from the Retrieve dataframe:
        # key -> itemKey, creator_summary -> author, abstract -> note
        item_key = to_text(pick(row, "key", "item_key", "itemkey", "id"))
        if not item_key:
            continue

        title = to_text(pick(row, "title"))
        year = to_text(pick(row, "year"))
        author = to_text(pick(row, "creator_summary", "author", "authors", "author_summary"))
        url = to_text(pick(row, "url", "link"))
        source = to_text(pick(row, "source"))
        doi = to_text(pick(row, "doi"))
        note = to_text(pick(row, "abstract", "note"))
        dqid = to_text(pick(row, "dqid"))

        existing = items_by_key.get(item_key)
        if not existing:
            entry: Dict[str, Any] = {"itemKey": item_key}
            if title:
                entry["title"] = title
            if author:
                entry["author"] = author
            if year:
                entry["year"] = year
            if url:
                entry["url"] = url
            if source:
                entry["source"] = source
            if doi:
                entry["doi"] = doi
            if note:
                entry["note"] = note
            if dqid:
                entry["dqid"] = dqid
            items_by_key[item_key] = entry
        else:
            if title and not existing.get("title"):
                existing["title"] = title
            if author and not existing.get("author"):
                existing["author"] = author
            if year and not existing.get("year"):
                existing["year"] = year
            if url and not existing.get("url"):
                existing["url"] = url
            if source and not existing.get("source"):
                existing["source"] = source
            if doi and not existing.get("doi"):
                existing["doi"] = doi
            if note and not existing.get("note"):
                existing["note"] = note
            if dqid and not existing.get("dqid"):
                existing["dqid"] = dqid

    return list(items_by_key.values())


def _write_references_cache(cache_dir: str, table: Dict[str, Any]) -> None:
    cache_root = Path(cache_dir)
    items = _extract_reference_items(table)
    payload = {
        "updatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "items": items,
    }
    _write_json_file(cache_root / "references.json", payload)
    _write_json_file(cache_root / "references_library.json", payload)

def _write_last_cache_info(cache_dir: str, cache_key: str, source: Dict[str, Any]) -> None:
    try:
        cache_root = Path(cache_dir)
        payload = {
            "updatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "cacheDir": str(cache_root),
            "cacheKey": str(cache_key),
            "cachePath": str(_resolve_cache_path(cache_dir, cache_key)),
            "source": source,
        }
        _write_json_file(cache_root / "last.json", payload)
    except Exception:
        # best-effort only
        return


def _safe_json(obj: Any) -> str:
    def _clean(v: Any) -> Any:
        # Convert numpy scalars (and similar) into Python scalars early.
        try:
            if hasattr(v, "item") and not isinstance(v, (bytes, str)):
                v = v.item()
        except Exception:
            pass

        if v is None or isinstance(v, (str, bool, int)):
            return v

        if isinstance(v, float):
            return v if math.isfinite(v) else None

        if isinstance(v, dict):
            out: Dict[str, Any] = {}
            for k, vv in v.items():
                out[str(k)] = _clean(vv)
            return out

        if isinstance(v, (list, tuple, set)):
            return [_clean(x) for x in v]

        # Last resort: stringify unknown objects to keep the host robust.
        return str(v)

    cleaned = _clean(obj)
    return json.dumps(cleaned, ensure_ascii=True, allow_nan=False)


def _read_payload() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"action": "error", "message": f"invalid_json:{exc}"}


def _snake(s: str) -> str:
    return "_".join("".join(ch if ch.isalnum() else " " for ch in s).split()).lower()


def _default_columns_map() -> Dict[str, str]:
    return {
        "Title": "title",
        "Authors": "authors",
        "Year": "year",
        "Source title": "source",
        "Times Cited": "citations",
        "Document Type": "item_type",
        "Abstract": "abstract",
    }


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _load_retrieve_loader():
    try:
        import importlib

        module = importlib.import_module("python_backend.retrieve.Zotero_loader_to_df")
        return importlib.reload(module)
    except Exception:
        return None


def _python_value(value: Any) -> Any:
    try:
        if hasattr(value, "item") and not isinstance(value, (bytes, str)):
            value = value.item()
    except Exception:
        pass
    if isinstance(value, float):
        if not (value == value) or value in (float("inf"), float("-inf")):
            return None
    if isinstance(value, dict):
        return {str(k): _python_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_python_value(v) for v in value]
    return value


def _coerce_table(df, max_rows: Optional[int] = None) -> Dict[str, Any]:
    raw_columns = [str(c) for c in df.columns]
    keep_indices = [idx for idx, name in enumerate(raw_columns) if not name.strip().lower().startswith("unnamed")]
    columns = [raw_columns[idx] for idx in keep_indices]
    if max_rows is not None and isinstance(max_rows, int) and max_rows > 0:
        df = df.head(max_rows)
    rows = df.where(df.notna(), None).values.tolist()
    # Apply the same column filtering to each row so "unnamed_*" columns never reach the UI.
    if keep_indices and len(keep_indices) != len(raw_columns):
        rows = [[row[idx] for idx in keep_indices] for row in rows]
    rows = [[_python_value(cell) for cell in row] for row in rows]
    return {"columns": columns, "rows": rows}


def _load_from_file(file_path: str, max_rows: Optional[int] = None) -> Tuple[Optional[Dict[str, Any]], str]:
    loader = _load_retrieve_loader()
    if loader and hasattr(loader, "load_data_from_source_for_widget"):
        try:
            df, _items, message = loader.load_data_from_source_for_widget(
                source_type="file",
                file_path=file_path,
                progress_callback=None,
                cache=False,
            )
            if df is None:
                return None, message or "Failed to load file."
            table = _coerce_table(df, max_rows=max_rows)
            return table, message or f"Loaded {len(table.get('rows', []))} rows from {Path(file_path).name}"
        except Exception:
            # fallback to pandas loader below
            pass
    try:
        import pandas as pd
    except Exception as exc:
        return None, f"pandas unavailable: {exc}"

    path = Path(file_path)
    if not path.exists():
        return None, f"File not found: {file_path}"

    na_vals = ["", "#N/A", "NA", "NULL", "NaN", "None"]
    suffix = path.suffix.lower()
    if suffix in (".csv", ".tsv", ".txt"):
        sep = "\t" if suffix == ".tsv" else ","
        df = pd.read_csv(path, na_values=na_vals, keep_default_na=False, sep=sep)
    else:
        df = pd.read_excel(path, na_values=na_vals, keep_default_na=False)

    col_map = _default_columns_map()
    df.rename(columns=lambda c: col_map.get(str(c).strip(), _snake(str(c))), inplace=True)

    # Drop typical CSV index columns (e.g. "Unnamed: 0" -> "unnamed_0") so the UI doesn't show them.
    try:
        unnamed_cols = [c for c in df.columns if str(c).strip().lower().startswith("unnamed")]
        for col in unnamed_cols:
            series = df[col]
            # If it looks like a 0..n-1 index, drop it. Otherwise still drop (user expectation).
            try:
                values = series.where(series.notna(), None).tolist()
                numeric = []
                for v in values:
                    if v is None or v == "":
                        numeric.append(None)
                        continue
                    try:
                        numeric.append(int(float(v)))
                    except Exception:
                        numeric.append(None)
                looks_like_index = (
                    numeric
                    and all((x is None or isinstance(x, int)) for x in numeric)
                    and all((x is None or x >= 0) for x in numeric)
                    and sum(1 for x in numeric if x is not None) >= max(3, min(20, len(numeric) // 4))
                )
                if looks_like_index:
                    df.drop(columns=[col], inplace=True, errors="ignore")
                else:
                    df.drop(columns=[col], inplace=True, errors="ignore")
            except Exception:
                df.drop(columns=[col], inplace=True, errors="ignore")
    except Exception:
        pass
    return _coerce_table(df, max_rows=max_rows), f"Loaded {len(df)} rows from {path.name}"


def _resolve_cache_path(cache_dir: str, cache_key: str) -> Path:
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in cache_key.strip().lower())
    safe = safe.strip("_") or "all_items"
    return Path(cache_dir) / f"{safe}.json"


def _load_cache(cache_dir: str, cache_key: str) -> Optional[Dict[str, Any]]:
    path = _resolve_cache_path(cache_dir, cache_key)
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.loads(handle.read())
    except Exception:
        return None


def _write_cache(cache_dir: str, cache_key: str, payload: Dict[str, Any]) -> None:
    path = _resolve_cache_path(cache_dir, cache_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        # Ensure the cache never contains NaN/Infinity, otherwise subsequent loads break JSON parsing.
        handle.write(_safe_json(payload))

def _sanitize_table_dict(table: Any) -> Any:
    if not isinstance(table, dict):
        return table
    cols = table.get("columns") or []
    rows = table.get("rows") or []
    if not isinstance(cols, list) or not isinstance(rows, list):
        return table
    keep = [idx for idx, name in enumerate(cols) if not str(name).strip().lower().startswith("unnamed")]
    if len(keep) == len(cols):
        return table
    new_cols = [cols[idx] for idx in keep]
    new_rows = []
    for row in rows:
        if not isinstance(row, list):
            continue
        new_rows.append([row[idx] if idx < len(row) else None for idx in keep])
    return {"columns": new_cols, "rows": new_rows}


def _load_zotero(payload: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], str]:
    creds = payload.get("zotero") or {}
    library_id = str(creds.get("libraryId") or "").strip()
    api_key = str(creds.get("apiKey") or "").strip()
    library_type = str(creds.get("libraryType") or "user").strip() or "user"
    if not library_id or not api_key:
        return None, "Zotero credentials missing."

    def _norm_join(s: str) -> str:
        return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in s).split())

    try:
        from pyzotero import zotero
    except Exception as exc:
        return None, f"pyzotero unavailable: {exc}"

    client = zotero.Zotero(library_id, library_type, api_key)
    collection_name = str(payload.get("collectionName") or "").strip()
    items: List[Dict[str, Any]] = []
    limit = payload.get("maxRows")
    try:
        limit = int(limit) if isinstance(limit, (int, float)) and int(limit) > 0 else None
    except Exception:
        limit = None

    try:
        if collection_name:
            collections = client.collections()
            collection_key = None
            available = []
            norm_target = _norm_join(collection_name)
            for coll in collections:
                data = coll.get("data", {})
                key = str(coll.get("key") or "").strip()
                name = str(data.get("name") or "").strip()
                if key:
                    available.append(f"{key}:{name}")
                if (
                    name.lower() == collection_name.lower()
                    or key.lower() == collection_name.lower()
                    or _norm_join(name) == norm_target
                ):
                    collection_key = key
                    break
            if not collection_key:
                # fallback: partial contains match on normalized name
                for coll in collections:
                    data = coll.get("data", {})
                    key = str(coll.get("key") or "").strip()
                    name = str(data.get("name") or "").strip()
                    if norm_target and norm_target in _norm_join(name):
                        collection_key = key
                        break
            sys.stderr.write(f"[datahub_host][zotero] requested='{collection_name}' available_first10={available[:10]}\n")
            if collection_key:
                sys.stderr.write(f"[datahub_host][zotero] using collection key {collection_key}\n")
                items = client.collection_items(collection_key, limit=limit)
            else:
                return None, f"Collection '{collection_name}' not found. Available: {', '.join(available[:10])}"
        else:
            sys.stderr.write("[datahub_host][zotero] no collection specified; fetching all items\n")
            items = client.items(limit=limit)
    except Exception as exc:
        return None, f"Zotero fetch failed: {exc}"

    rows = []
    for item in items:
        data = item.get("data", {})
        creators = data.get("creators") or []
        authors = []
        for creator in creators:
            name = " ".join(str(creator.get(k, "")).strip() for k in ("firstName", "lastName")).strip()
            if name:
                authors.append(name)
        rows.append(
            [
                data.get("key"),
                data.get("title"),
                "; ".join(authors),
                data.get("date"),
                data.get("url"),
                data.get("DOI"),
                data.get("publicationTitle"),
                data.get("abstractNote"),
            ]
        )

    table = {
        "columns": [
            "key",
            "title",
            "authors",
            "date",
            "url",
            "doi",
            "source",
            "abstract",
        ],
        "rows": rows,
    }
    return table, f"Loaded {len(rows)} items from Zotero."


def _list_collections(payload: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
    creds = payload.get("zotero") or {}
    library_id = str(creds.get("libraryId") or "").strip()
    api_key = str(creds.get("apiKey") or "").strip()
    library_type = str(creds.get("libraryType") or "user").strip() or "user"
    if not library_id or not api_key:
        return [], "Zotero credentials missing."

    try:
        from pyzotero import zotero
    except Exception as exc:
        return [], f"pyzotero unavailable: {exc}"

    client = zotero.Zotero(library_id, library_type, api_key)
    collections = []
    try:
        for coll in client.collections():
            data = coll.get("data", {})
            collections.append(
                {
                    "key": coll.get("key"),
                    "name": data.get("name"),
                    "parentKey": data.get("parentCollection"),
                }
            )
    except Exception as exc:
        return [], f"Failed to list collections: {exc}"

    return collections, f"Loaded {len(collections)} collections."


def _export_excel(payload: Dict[str, Any]) -> Dict[str, Any]:
    file_path = payload.get("filePath")
    table = payload.get("table")
    if not file_path or not table:
        return {"status": "error", "message": "filePath and table are required."}

    try:
        import pandas as pd
    except Exception as exc:
        return {"status": "error", "message": f"pandas unavailable: {exc}"}

    try:
        df = pd.DataFrame(table.get("rows", []), columns=table.get("columns", []))
        Path(file_path).parent.mkdir(parents=True, exist_ok=True)
        df.to_excel(file_path, index=False)
        return {"status": "ok", "message": f"Exported {len(df)} rows.", "path": file_path}
    except Exception as exc:
        return {"status": "error", "message": f"Excel export failed: {exc}"}


def main() -> None:
    payload = _read_payload()
    action = payload.get("action")

    if action == "error":
        sys.stdout.write(_safe_json({"status": "error", "message": payload.get("message")}))
        return

    if action == "export_excel":
        sys.stdout.write(_safe_json(_export_excel(payload)))
        return

    if action == "list_collections":
        collections, message = _list_collections(payload)
        sys.stdout.write(_safe_json({"status": "ok", "collections": collections, "message": message}))
        return

    if action == "load":
        cache_dir = str(payload.get("cacheDir") or "").strip()
        cache_key = ""
        source_type = str(payload.get("sourceType") or "").strip()
        max_rows = payload.get("maxRows")
        max_rows = int(max_rows) if isinstance(max_rows, (int, float)) and int(max_rows) > 0 else None

        if source_type == "file":
            file_path = str(payload.get("filePath") or "").strip()
            if not file_path:
                sys.stdout.write(_safe_json({"status": "error", "message": "filePath required."}))
                return
            cache_key = Path(file_path).stem
            if payload.get("cache") and cache_dir:
                cached = _load_cache(cache_dir, cache_key)
                if cached:
                    cached_table = _sanitize_table_dict(cached.get("table"))
                    try:
                        if cached_table:
                            _write_references_cache(cache_dir, cached_table)
                    except Exception:
                        pass
                    _write_last_cache_info(cache_dir, cache_key, {"type": "file", "path": file_path})
                    if max_rows is not None and isinstance(cached_table, dict):
                        cached_table = {
                            "columns": cached_table.get("columns", []),
                            "rows": list(cached_table.get("rows", []))[:max_rows],
                        }
                    sys.stdout.write(_safe_json({
                        "status": "ok",
                        "table": cached_table,
                        "message": "Loaded from cache.",
                        "cached": True,
                        "source": {"type": "file", "path": file_path}
                    }))
                    return
            # Always build references from the full dataset. Apply maxRows only to the table returned to the UI.
            table_full, message = _load_from_file(file_path, max_rows=None)
            table = table_full
            if table is None:
                sys.stdout.write(_safe_json({"status": "error", "message": message}))
                return
            if max_rows is not None:
                table = {"columns": table_full.get("columns", []), "rows": list(table_full.get("rows", []))[:max_rows]}
            response = {
                "status": "ok",
                "table": table,
                "message": message,
                "cached": False,
                "source": {"type": "file", "path": file_path}
            }
            if payload.get("cache") and cache_dir:
                # Cache the full table so subsequent loads can regenerate references even if the UI requests maxRows.
                _write_cache(cache_dir, cache_key, {"table": table_full, "source": {"type": "file", "path": file_path}})
                try:
                    _write_references_cache(cache_dir, table_full)
                except Exception:
                    pass
                _write_last_cache_info(cache_dir, cache_key, {"type": "file", "path": file_path})
            sys.stdout.write(_safe_json(response))
            return

        if source_type == "zotero":
            collection_name = str(payload.get("collectionName") or "").strip() or "all_items"
            cache_key = collection_name
            if payload.get("cache") and cache_dir:
                cached = _load_cache(cache_dir, cache_key)
                if cached:
                    cached_table = _sanitize_table_dict(cached.get("table"))
                    has_rows = bool(cached_table and isinstance(cached_table.get("rows"), list) and len(cached_table.get("rows")) > 0)
                    if has_rows:
                        try:
                            _write_references_cache(cache_dir, cached_table)
                        except Exception:
                            pass
                        _write_last_cache_info(cache_dir, cache_key, {"type": "zotero", "collectionName": collection_name})
                        if max_rows is not None and isinstance(cached_table, dict):
                            cached_table = {
                                "columns": cached_table.get("columns", []),
                                "rows": list(cached_table.get("rows", []))[:max_rows],
                            }
                        sys.stdout.write(_safe_json({
                            "status": "ok",
                            "table": cached_table,
                            "message": "Loaded from cache.",
                            "cached": True,
                            "source": {"type": "zotero", "collectionName": collection_name}
                        }))
                        return
                    else:
                        sys.stderr.write(f"[datahub_host][zotero] cache hit but empty for {collection_name}; refetching.\n")
            # Always fetch the full dataset for caching + references; apply maxRows only to the UI table.
            payload_full = dict(payload)
            if "maxRows" in payload_full:
                payload_full["maxRows"] = None
            table, message = _load_zotero(payload_full)
            if table is None:
                sys.stdout.write(_safe_json({"status": "error", "message": message}))
                return
            table_full = table
            if max_rows is not None:
                table = {"columns": table_full.get("columns", []), "rows": list(table_full.get("rows", []))[:max_rows]}
            response = {
                "status": "ok",
                "table": table,
                "message": message,
                "cached": False,
                "source": {"type": "zotero", "collectionName": collection_name}
            }
            if payload.get("cache") and cache_dir:
                _write_cache(
                    cache_dir,
                    cache_key,
                    {"table": table_full, "source": {"type": "zotero", "collectionName": collection_name}},
                )
                try:
                    _write_references_cache(cache_dir, table_full)
                except Exception:
                    pass
                _write_last_cache_info(cache_dir, cache_key, {"type": "zotero", "collectionName": collection_name})
            sys.stdout.write(_safe_json(response))
            return

        sys.stdout.write(_safe_json({"status": "error", "message": f"Unknown sourceType '{source_type}'."}))
        return

    sys.stdout.write(_safe_json({"status": "error", "message": f"Unknown action '{action}'."}))


if __name__ == "__main__":
    main()
