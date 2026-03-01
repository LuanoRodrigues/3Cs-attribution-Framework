from __future__ import annotations

import json
import os
import re
import hashlib
import time
import sqlite3
from typing import Set
from pathlib import Path
from typing import Any

from openai import OpenAI
from openai import APIConnectionError, APITimeoutError, RateLimitError

_STRUCTURED_FUNCTIONS = {"structured_coding_part_a", "structured_coding_part_b"}
_STRUCTURED_PROCESSED_CACHE: dict[str, Set[str]] = {}
_STRUCTURED_PROCESSED_ITEMS_CACHE: dict[str, Set[str]] = {}
LEGACY_MAX_BATCH_BYTES = 209_715_200
LEGACY_MAX_INPUT_BYTES = 10_000_000
DEFAULT_OPENAI_BATCH_MAX_BYTES = 16_000_000


def _file_signature(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(8192), b""):
            h.update(chunk)
    return f"{path.stat().st_size}:{h.hexdigest()}"


def _read_existing_custom_ids(path: Path) -> Set[str]:
    """
    Return existing custom_id values from a batch input JSONL file.
    Used to avoid duplicate custom_id entries when store-only mode is called repeatedly.
    """
    existing: Set[str] = set()
    if not path.is_file():
        return existing
    with path.open("r", encoding="utf-8", errors="ignore") as fh:
        for line_no, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            custom_id = str(rec.get("custom_id") or "").strip()
            if custom_id:
                existing.add(custom_id)
            else:
                payload = json.dumps(rec, sort_keys=True, ensure_ascii=False)
                existing.add(f"legacy_{line_no}_{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:12]}")
    return existing


def _dedupe_jsonl_by_custom_id(path: Path) -> int:
    """
    Remove duplicate custom_id rows from a batch input JSONL file in-place.
    Keeps the first occurrence per custom_id.
    Returns the number of removed rows.
    """
    if not path.is_file() or path.stat().st_size == 0:
        return 0

    kept_lines: list[str] = []
    seen: Set[str] = set()
    removed = 0

    try:
        with path.open("r", encoding="utf-8", errors="ignore") as fh:
            for idx, raw in enumerate(fh, start=1):
                if not raw.strip():
                    continue
                try:
                    rec = json.loads(raw)
                except Exception:
                    continue
                cid = str(rec.get("custom_id") or "").strip()
                if not cid:
                    payload = json.dumps(rec, sort_keys=True, ensure_ascii=False)
                    cid = f"fallback_{idx}_{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:12]}"
                    rec["custom_id"] = cid
                if cid in seen:
                    removed += 1
                    continue
                seen.add(cid)
                kept_lines.append(json.dumps(rec, ensure_ascii=False))

        if removed:
            path.write_text("\n".join(kept_lines) + ("\n" if kept_lines else ""), encoding="utf-8")
        return removed
    except Exception:
        return 0


def safe_name(value: str, maxlen: int = 120) -> str:
    s = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "").strip())
    s = s.strip("_.-") or "untitled"
    return s[:maxlen]


def get_batch_root(app_name: str | None = None, override_root: str | None = None) -> Path:
    env_root = os.getenv("BATCH_ROOT")
    if env_root:
        root = Path(env_root).expanduser().resolve()
    elif override_root:
        root = Path(override_root).expanduser().resolve()
    else:
        app = safe_name(app_name or "annotarium", maxlen=60)
        root = (Path.home() / ".local" / "share" / app / "Batching_files").resolve()
    batches = root / "batches"
    batches.mkdir(parents=True, exist_ok=True)
    return batches


def fetch_pdf_link(*_args: Any, **_kwargs: Any) -> str:
    return ""


def _client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for model/batch operations.")
    return OpenAI(api_key=api_key)


def _response_schema_for(function: str) -> dict:
    # Keep schema strict enough for downstream parsing while allowing enrichment.
    if str(function or "").strip() == "code_pdf_page":
        return {
            "name": "code_pdf_page_result",
            "strict": True,
            "schema": {
                "type": "object",
                "required": ["evidence"],
                "additionalProperties": False,
                "properties": {
                    "evidence": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": [
                                "quote",
                                "paraphrase",
                                "function_summary",
                                "risk_if_missing",
                                "relevance_score",
                                "cluster_match",
                                "illustrative_skills",
                                "page",
                                "section_title",
                            ],
                            "additionalProperties": False,
                            "properties": {
                                "quote": {"type": "string"},
                                "paraphrase": {"type": "string"},
                                "function_summary": {"type": "string"},
                                "risk_if_missing": {"type": "string"},
                                "relevance_score": {"type": "integer"},
                                "cluster_match": {"type": "array", "items": {"type": "string"}},
                                "illustrative_skills": {"type": "array", "items": {"type": "string"}},
                                "page": {"type": ["integer", "null"]},
                                "section_title": {"type": ["string", "null"]},
                            },
                        },
                    }
                },
            },
        }
    return {
        "name": "generic_result",
        "strict": True,
        "schema": {
            "type": "object",
            "required": ["result"],
            "additionalProperties": True,
            "properties": {"result": {"type": "string"}},
        },
    }


def _extract_output_text(response_body: dict) -> str:
    if isinstance(response_body.get("output_text"), str) and response_body["output_text"].strip():
        return response_body["output_text"]
    out: list[str] = []
    for item in response_body.get("output", []) or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for part in item.get("content", []) or []:
            if isinstance(part, dict) and part.get("type") in ("text", "output_text"):
                txt = str(part.get("text") or "").strip()
                if txt:
                    out.append(txt)
    return "\n".join(out).strip()


def _paths(function: str, collection_name: str) -> dict[str, Path]:
    root = get_batch_root()
    fn = safe_name(function or "default")
    section = safe_name(collection_name or "default")
    d = root / fn
    d.mkdir(parents=True, exist_ok=True)
    prefix = f"{section}_{fn}"
    return {
        "dir": d,
        "input": d / f"{prefix}_input.jsonl",
        "output": d / f"{prefix}_output.jsonl",
        "error": d / f"{prefix}_error.jsonl",
        "meta": d / f"{prefix}_batch_metadata.json",
    }


def _batch_caps() -> tuple[int, int]:
    max_batch = int(str(os.getenv("OPENAI_BATCH_MAX_BYTES", DEFAULT_OPENAI_BATCH_MAX_BYTES)).strip() or DEFAULT_OPENAI_BATCH_MAX_BYTES)
    max_input = int(str(os.getenv("OPENAI_BATCH_MAX_INPUT_BYTES", LEGACY_MAX_INPUT_BYTES)).strip() or LEGACY_MAX_INPUT_BYTES)
    return max(1, max_batch), max(1, max_input)


def _record_bytes(obj: dict) -> int:
    return len(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _split_input_jsonl_by_caps(input_path: Path, *, max_batch_bytes: int, max_input_bytes: int) -> tuple[list[Path], dict]:
    """
    Split a batch input JSONL into shard files that satisfy:
      - per-request <= max_input_bytes
      - per-shard total <= max_batch_bytes
    Returns (shard_paths, stats).
    """
    if not input_path.is_file() or input_path.stat().st_size <= 0:
        return [], {"total_lines": 0, "single_too_large": 0, "shards": 0}

    raw_nonempty = 0
    parsed_ok = 0
    lines: list[str] = []
    too_large = 0
    with input_path.open("r", encoding="utf-8", errors="ignore") as fh:
        for raw in fh:
            ln = str(raw or "").strip()
            if not ln:
                continue
            raw_nonempty += 1
            try:
                rec = json.loads(ln)
            except Exception:
                continue
            parsed_ok += 1
            sz = _record_bytes(rec)
            if sz > max_input_bytes:
                too_large += 1
                continue
            lines.append(json.dumps(rec, ensure_ascii=False))

    if too_large > 0:
        raise RuntimeError(
            f"{too_large} request(s) exceed max input bytes cap ({max_input_bytes}). "
            "Reduce section size/chunking before enqueue."
        )
    if not lines:
        return [], {
            "raw_nonempty_lines": raw_nonempty,
            "parsed_lines": parsed_ok,
            "total_lines": 0,
            "single_too_large": too_large,
            "shards": 0,
        }

    # Fast path: original file already under cap.
    if input_path.stat().st_size <= max_batch_bytes:
        return [input_path], {
            "raw_nonempty_lines": raw_nonempty,
            "parsed_lines": parsed_ok,
            "total_lines": len(lines),
            "single_too_large": too_large,
            "shards": 1,
        }

    stem = input_path.name
    if stem.endswith("_input.jsonl"):
        stem = stem[: -len("_input.jsonl")]
    shard_paths: list[Path] = []
    cur: list[str] = []
    cur_bytes = 0
    shard_idx = 1

    def flush() -> None:
        nonlocal cur, cur_bytes, shard_idx
        if not cur:
            return
        p = input_path.parent / f"{stem}__part{shard_idx:04d}_input.jsonl"
        p.write_text("\n".join(cur) + "\n", encoding="utf-8")
        shard_paths.append(p)
        shard_idx += 1
        cur = []
        cur_bytes = 0

    for ln in lines:
        b = len(ln.encode("utf-8")) + 1
        if cur and cur_bytes + b > max_batch_bytes:
            flush()
        cur.append(ln)
        cur_bytes += b
    flush()

    assigned = 0
    for shp in shard_paths:
        with shp.open("r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if str(line or "").strip():
                    assigned += 1
    if assigned != len(lines):
        raise RuntimeError(
            f"Split integrity error: assigned_lines={assigned} expected_lines={len(lines)}."
        )

    return shard_paths, {
        "raw_nonempty_lines": raw_nonempty,
        "parsed_lines": parsed_ok,
        "total_lines": len(lines),
        "assigned_lines": assigned,
        "single_too_large": too_large,
        "shards": len(shard_paths),
    }


def _structured_index_path() -> Path:
    return get_batch_root() / "structured_code_processed_ids.json"


def _structured_registry_db_path() -> Path:
    return get_batch_root() / "structured_code_registry.sqlite"


def _init_structured_registry_db() -> None:
    dbp = _structured_registry_db_path()
    dbp.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(dbp)) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS structured_coding_registry (
                function_name TEXT NOT NULL,
                item_key TEXT NOT NULL,
                custom_id TEXT,
                source_collection TEXT,
                first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (function_name, item_key)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_structured_registry_custom_id "
            "ON structured_coding_registry(function_name, custom_id)"
        )
        conn.commit()


def _registry_fetch_items(function: str) -> Set[str]:
    fn = safe_name(function)
    try:
        _init_structured_registry_db()
        with sqlite3.connect(str(_structured_registry_db_path())) as conn:
            rows = conn.execute(
                "SELECT item_key FROM structured_coding_registry WHERE function_name = ?",
                (fn,),
            ).fetchall()
        return {str(r[0]).strip() for r in rows if str(r[0]).strip()}
    except Exception:
        return set()


def _registry_mark_processed(
        function: str,
        item_keys: Set[str],
        *,
        source_collection: str = "",
        item_to_custom_id: dict[str, str] | None = None,
) -> None:
    if not item_keys:
        return
    fn = safe_name(function)
    item_to_custom_id = item_to_custom_id or {}
    try:
        _init_structured_registry_db()
        with sqlite3.connect(str(_structured_registry_db_path())) as conn:
            for item_key in sorted({str(x).strip() for x in item_keys if str(x).strip()}):
                cid = str(item_to_custom_id.get(item_key) or "").strip() or None
                conn.execute(
                    """
                    INSERT INTO structured_coding_registry
                        (function_name, item_key, custom_id, source_collection, first_seen_at, last_seen_at)
                    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
                    ON CONFLICT(function_name, item_key) DO UPDATE SET
                        custom_id = COALESCE(excluded.custom_id, structured_coding_registry.custom_id),
                        source_collection = CASE
                            WHEN excluded.source_collection IS NOT NULL AND excluded.source_collection <> ''
                            THEN excluded.source_collection
                            ELSE structured_coding_registry.source_collection
                        END,
                        last_seen_at = datetime('now')
                    """,
                    (fn, item_key, cid, str(source_collection or "").strip()),
                )
            conn.commit()
    except Exception:
        return


def _load_structured_index() -> dict[str, Any]:
    p = _structured_index_path()
    if not p.is_file():
        return {"version": 1, "functions": {}}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            funcs = data.get("functions")
            if isinstance(funcs, dict):
                return data
    except Exception:
        pass
    return {"version": 1, "functions": {}}


def _save_structured_index(payload: dict[str, Any]) -> None:
    _structured_index_path().write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _collect_custom_ids_from_output(path: Path) -> Set[str]:
    out: Set[str] = set()
    if not path.is_file() or path.stat().st_size <= 0:
        return out
    with path.open("r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            line = str(line or "").strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            cid = str(rec.get("custom_id") or "").strip()
            if cid:
                out.add(cid)
    return out


def _extract_item_key_from_payload_text(payload_text: str) -> str:
    txt = str(payload_text or "")
    m = re.search(r"\bitem_key\s+([A-Za-z0-9]+)\b", txt)
    return str(m.group(1)).strip() if m else ""


def _extract_item_key_from_request(req: dict[str, Any]) -> str:
    try:
        body = req.get("body") if isinstance(req, dict) else {}
        arr = body.get("input") if isinstance(body, dict) else []
        user = arr[1] if isinstance(arr, list) and len(arr) > 1 and isinstance(arr[1], dict) else {}
        content = user.get("content")
        if isinstance(content, list) and content:
            first = content[0]
            if isinstance(first, dict):
                return _extract_item_key_from_payload_text(str(first.get("text") or ""))
        return _extract_item_key_from_payload_text(str(content or ""))
    except Exception:
        return ""


def _input_custom_id_to_item_key(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file() or path.stat().st_size <= 0:
        return out
    with path.open("r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            line = str(line or "").strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except Exception:
                continue
            cid = str(req.get("custom_id") or "").strip()
            item_key = _extract_item_key_from_request(req)
            if cid and item_key:
                out[cid] = item_key
    return out


def _load_processed_item_keys(function: str) -> Set[str]:
    fn = safe_name(function)
    if fn in _STRUCTURED_PROCESSED_ITEMS_CACHE:
        return _STRUCTURED_PROCESSED_ITEMS_CACHE[fn]
    fn_dir = get_batch_root() / fn
    items: Set[str] = set()
    items.update(_registry_fetch_items(fn))
    if fn_dir.is_dir():
        cid_to_item: dict[str, str] = {}
        for inp in fn_dir.glob("*_input.jsonl"):
            cid_to_item.update(_input_custom_id_to_item_key(inp))
        for outp in fn_dir.glob("*_output.jsonl"):
            for cid in _collect_custom_ids_from_output(outp):
                ik = str(cid_to_item.get(cid) or "").strip()
                if ik:
                    items.add(ik)
        _registry_mark_processed(fn, items)
    _STRUCTURED_PROCESSED_ITEMS_CACHE[fn] = items
    return items


def _mark_processed_item_keys(function: str, item_keys: Set[str]) -> None:
    if not item_keys:
        return
    fn = safe_name(function)
    live = set(_STRUCTURED_PROCESSED_ITEMS_CACHE.get(fn) or set())
    live.update({str(x).strip() for x in item_keys if str(x).strip()})
    _STRUCTURED_PROCESSED_ITEMS_CACHE[fn] = live
    _registry_mark_processed(fn, live)


def _load_processed_custom_ids(function: str) -> Set[str]:
    fn = safe_name(function)
    if fn in _STRUCTURED_PROCESSED_CACHE:
        return _STRUCTURED_PROCESSED_CACHE[fn]

    idx = _load_structured_index()
    funcs = idx.get("functions") if isinstance(idx.get("functions"), dict) else {}
    existing = funcs.get(fn) if isinstance(funcs, dict) else None
    ids = set(existing.get("custom_ids") or []) if isinstance(existing, dict) else set()

    fn_dir = get_batch_root() / fn
    if fn_dir.is_dir():
        for outp in fn_dir.glob("*_output.jsonl"):
            ids.update(_collect_custom_ids_from_output(outp))

    payload = idx if isinstance(idx, dict) else {"version": 1, "functions": {}}
    functions_obj = payload.get("functions")
    if not isinstance(functions_obj, dict):
        functions_obj = {}
    functions_obj[fn] = {"custom_ids": sorted(ids)}
    payload["functions"] = functions_obj
    try:
        _save_structured_index(payload)
    except Exception:
        pass

    _STRUCTURED_PROCESSED_CACHE[fn] = ids
    return ids


def _mark_processed_custom_ids(function: str, custom_ids: Set[str]) -> None:
    if not custom_ids:
        return
    fn = safe_name(function)
    live = set(_STRUCTURED_PROCESSED_CACHE.get(fn) or set())
    live.update({str(x).strip() for x in custom_ids if str(x).strip()})
    _STRUCTURED_PROCESSED_CACHE[fn] = live

    payload = _load_structured_index()
    funcs = payload.get("functions") if isinstance(payload.get("functions"), dict) else {}
    existing = funcs.get(fn) if isinstance(funcs, dict) else {}
    prior = set(existing.get("custom_ids") or []) if isinstance(existing, dict) else set()
    prior.update(live)
    funcs[fn] = {"custom_ids": sorted(prior)}
    payload["functions"] = funcs
    try:
        _save_structured_index(payload)
    except Exception:
        pass


def call_models(
    *,
    text: str,
    function: str,
    custom_id: str = "123",
    collection_name: str = "",
    read: bool = False,
    store_only: bool = False,
    ai: str = "openai",
    model: str | None = None,
    **_kwargs: Any,
):
    if str(ai or "openai").strip().lower() != "openai":
        raise RuntimeError("Only 'openai' provider is supported by this adapter.")

    model_name = str(model or os.getenv("OPENAI_MODEL") or "gpt-5-mini")
    p = _paths(function=function, collection_name=collection_name)
    schema = _response_schema_for(function)
    schema_format = {
        "type": "json_schema",
        "name": str(schema.get("name") or "result"),
        "schema": schema.get("schema") or {"type": "object"},
        "strict": bool(schema.get("strict", True)),
    }
    system_text = (
        "You are an evidence coding assistant. "
        "Return strict JSON matching the provided schema."
    )

    if store_only:
        req = {
            "custom_id": str(custom_id or "cid"),
            "method": "POST",
            "url": "/v1/responses",
            "body": {
                "model": model_name,
                "input": [
                    {
                        "role": "system",
                        "content": [{"type": "input_text", "text": system_text}],
                    },
                    {
                        "role": "user",
                        "content": [{"type": "input_text", "text": str(text or "")}],
                    },
                ],
                "text": {"format": schema_format},
            },
        }
        req_cid = str(req["custom_id"]).strip()
        if not req_cid:
            payload = json.dumps(req.get("body", {}), sort_keys=True, ensure_ascii=False)
            req_cid = f"{function[:8]}_{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:20]}"
            req["custom_id"] = req_cid
        existing_custom_ids = _read_existing_custom_ids(p["input"])
        if req_cid in existing_custom_ids:
            print(
                f"[llm_adapter][call_models][debug] skip_duplicate_store_only "
                f"function={function} collection={collection_name} custom_id={req_cid}"
            )
            return {"status": "enqueued", "custom_id": req_cid, "skipped_duplicate": True}, 0.0
        if str(function or "").strip() in _STRUCTURED_FUNCTIONS:
            processed_ids = _load_processed_custom_ids(str(function or "").strip())
            if req_cid in processed_ids:
                print(
                    f"[llm_adapter][call_models][debug] skip_already_processed "
                    f"function={function} collection={collection_name} custom_id={req_cid}"
                )
                return {
                    "status": "skipped",
                    "reason": "already_processed",
                    "custom_id": req_cid,
                }, 0.0
            req_item_key = _extract_item_key_from_request(req)
            if req_item_key:
                processed_items = _load_processed_item_keys(str(function or "").strip())
                if req_item_key in processed_items:
                    print(
                        f"[llm_adapter][call_models][debug] skip_already_processed_item "
                        f"function={function} collection={collection_name} item_key={req_item_key}"
                    )
                    return {
                        "status": "skipped",
                        "reason": "already_processed_item",
                        "custom_id": req_cid,
                        "item_key": req_item_key,
                    }, 0.0

        with p["input"].open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(req, ensure_ascii=False) + "\n")
        return {"status": "enqueued", "custom_id": req_cid}, 0.0

    if read:
        if not p["output"].is_file():
            if p["error"].is_file():
                with p["error"].open("r", encoding="utf-8", errors="ignore") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        rec = json.loads(line)
                        if str(rec.get("custom_id", "")) != str(custom_id or ""):
                            continue
                        return {"error": rec}, 0.0
            return {"error": "batch_output_not_found", "custom_id": custom_id}, 0.0
        with p["output"].open("r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                if str(rec.get("custom_id", "")) != str(custom_id or ""):
                    continue
                body = (((rec.get("response") or {}).get("body")) or {})
                raw_text = _extract_output_text(body)
                if raw_text:
                    try:
                        return json.loads(raw_text), 0.0
                    except Exception:
                        return {"raw_text": raw_text}, 0.0
                return body, 0.0
        return {"error": "custom_id_not_found", "custom_id": custom_id}, 0.0

    client = _client()
    resp = client.responses.create(
        model=model_name,
        input=[
            {
                "role": "system",
                "content": [{"type": "input_text", "text": system_text}],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": str(text or "")}],
            },
        ],
        text={"format": schema_format},
    )
    raw_text = getattr(resp, "output_text", "") or ""
    if raw_text:
        try:
            return json.loads(raw_text), 0.0
        except Exception:
            return {"raw_text": raw_text}, 0.0
    return {"response": str(resp)}, 0.0


def call_openai_api(*args: Any, **kwargs: Any):
    return call_models(*args, **kwargs)


def call_models_na(*args: Any, **kwargs: Any):
    return call_models(*args, **kwargs)


def _read_file_bytes(client: OpenAI, file_id: str) -> bytes:
    h = client.files.content(file_id)
    read = getattr(h, "read", None)
    if callable(read):
        data = read()
        if isinstance(data, (bytes, bytearray)):
            return bytes(data)
    txt = getattr(h, "text", None)
    if isinstance(txt, str):
        return txt.encode("utf-8")
    content = getattr(h, "content", None)
    if isinstance(content, (bytes, bytearray)):
        return bytes(content)
    raise RuntimeError(f"Unable to read OpenAI file content for file_id={file_id}")


def _process_batch_paths(
        *,
        p: dict[str, Path],
        collection_name: str,
        function: str,
        completion_window: str = "24h",
        poll_interval: int = 30,
) -> bool:
    if not p["input"].is_file() or p["input"].stat().st_size == 0:
        return False

    removed_duplicates = _dedupe_jsonl_by_custom_id(p["input"])
    if removed_duplicates:
        print(
            f"[llm_adapter][_process_batch_for][debug] "
            f"deduped_batch_input function={function} collection={collection_name} "
            f"removed={removed_duplicates}"
        )

    input_signature = _file_signature(p["input"])
    line_count = 0
    with p["input"].open("r", encoding="utf-8", errors="ignore") as fh:
        for line_count, _ in enumerate(fh, start=1):
            pass

    meta = {}
    if p["meta"].is_file():
        try:
            meta = json.loads(p["meta"].read_text(encoding="utf-8"))
        except Exception:
            meta = {}

    stored_signature = str(meta.get("input_signature") or "").strip()
    batch_signature_match = bool(stored_signature and stored_signature == input_signature)
    if not batch_signature_match:
        for stale in [p["output"], p["error"], p["meta"]]:
            if stale.is_file():
                try:
                    stale.unlink()
                except Exception:
                    pass
        meta = {}

    client = _client()
    batch_id = str(meta.get("batch_id") or "").strip()
    if batch_id and p["output"].is_file() and p["output"].stat().st_size > 0 and batch_signature_match:
        return True

    if not batch_id:
        max_upload_attempts = max(1, int(os.getenv("OPENAI_BATCH_UPLOAD_RETRIES", "8")))
        base_backoff = max(1, int(os.getenv("OPENAI_BATCH_UPLOAD_BACKOFF_SECONDS", "5")))
        upload_id = ""
        upload_err = None

        p["meta"].write_text(
            json.dumps(
                {
                    "status": "uploading_input",
                    "input_signature": input_signature,
                    "line_count": int(line_count),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        for attempt in range(1, max_upload_attempts + 1):
            try:
                with p["input"].open("rb") as fh:
                    up = client.files.create(file=fh, purpose="batch")
                upload_id = str(getattr(up, "id", "") or "").strip()
                if not upload_id:
                    raise RuntimeError("files.create returned empty file id")
                upload_err = None
                break
            except (APIConnectionError, APITimeoutError, RateLimitError, OSError, RuntimeError) as exc:
                upload_err = exc
                wait_s = min(120, base_backoff * (2 ** (attempt - 1)))
                print(
                    f"[llm_adapter][_process_batch_for][debug] "
                    f"upload_retry function={function} collection={collection_name} "
                    f"attempt={attempt}/{max_upload_attempts} wait_s={wait_s} "
                    f"err={type(exc).__name__}: {exc}"
                )
                if attempt >= max_upload_attempts:
                    break
                time.sleep(wait_s)

        if upload_err is not None or not upload_id:
            p["meta"].write_text(
                json.dumps(
                    {
                        "status": "upload_failed",
                        "input_signature": input_signature,
                        "line_count": int(line_count),
                        "error_type": type(upload_err).__name__ if upload_err else "UnknownError",
                        "error": str(upload_err) if upload_err else "Upload failed without exception details",
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            return False

        max_create_attempts = max(1, int(os.getenv("OPENAI_BATCH_CREATE_RETRIES", "5")))
        create_backoff = max(1, int(os.getenv("OPENAI_BATCH_CREATE_BACKOFF_SECONDS", "3")))
        create_err = None
        batch_id = ""
        for attempt in range(1, max_create_attempts + 1):
            try:
                batch = client.batches.create(
                    input_file_id=upload_id,
                    endpoint="/v1/responses",
                    completion_window=str(completion_window or "24h"),
                )
                batch_id = str(getattr(batch, "id", "") or "").strip()
                if not batch_id:
                    raise RuntimeError("batches.create returned empty batch id")
                create_err = None
                break
            except (APIConnectionError, APITimeoutError, RateLimitError, OSError, RuntimeError) as exc:
                create_err = exc
                wait_s = min(60, create_backoff * (2 ** (attempt - 1)))
                print(
                    f"[llm_adapter][_process_batch_for][debug] "
                    f"create_retry function={function} collection={collection_name} "
                    f"attempt={attempt}/{max_create_attempts} wait_s={wait_s} "
                    f"err={type(exc).__name__}: {exc}"
                )
                if attempt >= max_create_attempts:
                    break
                time.sleep(wait_s)

        if create_err is not None or not batch_id:
            p["meta"].write_text(
                json.dumps(
                    {
                        "status": "batch_create_failed",
                        "input_file_id": upload_id,
                        "input_signature": input_signature,
                        "line_count": int(line_count),
                        "error_type": type(create_err).__name__ if create_err else "UnknownError",
                        "error": str(create_err) if create_err else "Batch create failed without exception details",
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            return False

        p["meta"].write_text(
            json.dumps(
                {
                    "batch_id": batch_id,
                    "input_file_id": upload_id,
                    "input_signature": input_signature,
                    "line_count": int(line_count),
                    "status": "created",
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        create_only = str(os.getenv("OPENAI_BATCH_CREATE_ONLY", "")).strip().lower() in {"1", "true", "yes", "on"}
        if create_only:
            print(
                f"[llm_adapter][_process_batch_for][debug] "
                f"create_only function={function} collection={collection_name} batch_id={batch_id}"
            )
            return True
    else:
        try:
            batch_state = client.batches.retrieve(batch_id)
        except Exception:
            batch_state = None
        if batch_state is not None:
            status = str(getattr(batch_state, "status", "") or "").strip()
            if status in {"failed", "cancelled", "expired", "cancelling"}:
                for stale in [p["output"], p["error"], p["meta"]]:
                    if stale.is_file():
                        try:
                            stale.unlink()
                        except Exception:
                            pass
                return False
            if status == "completed" and p["output"].is_file() and p["output"].stat().st_size > 0:
                return True

    while True:
        b = client.batches.retrieve(batch_id)
        status = str(getattr(b, "status", "") or "")
        if status == "completed":
            out_id = getattr(b, "output_file_id", None)
            if not out_id:
                err_id = getattr(b, "error_file_id", None)
                if err_id:
                    p["error"].write_bytes(_read_file_bytes(client, err_id))
                return False
            data = _read_file_bytes(client, out_id)
            p["output"].write_bytes(data)
            if str(function or "").strip() in _STRUCTURED_FUNCTIONS:
                _mark_processed_custom_ids(str(function or "").strip(), _collect_custom_ids_from_output(p["output"]))
                in_map = _input_custom_id_to_item_key(p["input"])
                done_ids = _collect_custom_ids_from_output(p["output"])
                done_items = {in_map[cid] for cid in done_ids if cid in in_map}
                _mark_processed_item_keys(str(function or "").strip(), done_items)
                item_to_cid = {
                    str(in_map[cid]).strip(): str(cid).strip()
                    for cid in done_ids
                    if cid in in_map and str(in_map[cid]).strip()
                }
                _registry_mark_processed(
                    str(function or "").strip(),
                    done_items,
                    source_collection=str(collection_name or ""),
                    item_to_custom_id=item_to_cid,
                )
            err_id = getattr(b, "error_file_id", None)
            if err_id:
                p["error"].write_bytes(_read_file_bytes(client, err_id))
            return True
        if status in {"failed", "cancelled", "expired"}:
            err_id = getattr(b, "error_file_id", None)
            if err_id:
                p["error"].write_bytes(_read_file_bytes(client, err_id))
            return False
        time.sleep(max(1, int(poll_interval)))


def _process_batch_for(*, collection_name: str, function: str, completion_window: str = "24h", poll_interval: int = 30, **_kwargs: Any) -> bool:
    p = _paths(function=function, collection_name=collection_name)
    if not p["input"].is_file() or p["input"].stat().st_size == 0:
        return False

    max_batch_bytes, max_input_bytes = _batch_caps()
    try:
        shard_inputs, split_stats = _split_input_jsonl_by_caps(
            p["input"],
            max_batch_bytes=max_batch_bytes,
            max_input_bytes=max_input_bytes,
        )
    except Exception as exc:
        p["meta"].write_text(
            json.dumps(
                {
                    "status": "split_failed",
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "max_batch_bytes": int(max_batch_bytes),
                    "max_input_bytes": int(max_input_bytes),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return False

    if not shard_inputs:
        return False

    # Single-file path keeps legacy naming and behavior.
    if len(shard_inputs) == 1 and shard_inputs[0] == p["input"]:
        return _process_batch_paths(
            p=p,
            collection_name=collection_name,
            function=function,
            completion_window=completion_window,
            poll_interval=poll_interval,
        )

    print(
        f"[llm_adapter][_process_batch_for][debug] sharded_upload "
        f"function={function} collection={collection_name} shards={len(shard_inputs)} "
        f"max_batch_bytes={max_batch_bytes} max_input_bytes={max_input_bytes}"
    )

    # Process shards independently, then merge to canonical output/error files.
    shard_paths: list[dict[str, Path]] = []
    for idx, shard_in in enumerate(shard_inputs, start=1):
        shard_stub = shard_in.name.replace("_input.jsonl", "")
        shard_paths.append({
            "dir": shard_in.parent,
            "input": shard_in,
            "output": shard_in.parent / f"{shard_stub}_output.jsonl",
            "error": shard_in.parent / f"{shard_stub}_error.jsonl",
            "meta": shard_in.parent / f"{shard_stub}_batch_metadata.json",
        })

    ok_all = True
    for sp in shard_paths:
        ok = _process_batch_paths(
            p=sp,
            collection_name=collection_name,
            function=function,
            completion_window=completion_window,
            poll_interval=poll_interval,
        )
        ok_all = ok_all and bool(ok)
        if not ok:
            break

    if not ok_all:
        p["meta"].write_text(
            json.dumps(
                {
                    "status": "sharded_failed",
                    "function": function,
                    "collection": collection_name,
                    "shards": len(shard_paths),
                    "split_stats": split_stats,
                    "max_batch_bytes": int(max_batch_bytes),
                    "max_input_bytes": int(max_input_bytes),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return False

    with p["output"].open("wb") as out_fh:
        for sp in shard_paths:
            op = sp["output"]
            if op.is_file() and op.stat().st_size > 0:
                out_fh.write(op.read_bytes())
    if any(sp["error"].is_file() and sp["error"].stat().st_size > 0 for sp in shard_paths):
        with p["error"].open("wb") as err_fh:
            for sp in shard_paths:
                ep = sp["error"]
                if ep.is_file() and ep.stat().st_size > 0:
                    err_fh.write(ep.read_bytes())

    merged_lines = 0
    if p["output"].is_file():
        with p["output"].open("r", encoding="utf-8", errors="ignore") as fh:
            for merged_lines, _ in enumerate(fh, start=1):
                pass
    p["meta"].write_text(
        json.dumps(
            {
                "status": "completed_sharded",
                "function": function,
                "collection": collection_name,
                "shards": len(shard_paths),
                "split_stats": split_stats,
                "line_count": int(merged_lines),
                "max_batch_bytes": int(max_batch_bytes),
                "max_input_bytes": int(max_input_bytes),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return True


def _process_batches_for(*, collection_name: str, functions: list[str] | tuple[str, ...] | None = None, **kwargs: Any) -> bool:
    fn_list = list(functions or [])
    if not fn_list:
        return False
    ok = True
    for fn in fn_list:
        ok = _process_batch_for(collection_name=collection_name, function=str(fn), **kwargs) and ok
    return ok
