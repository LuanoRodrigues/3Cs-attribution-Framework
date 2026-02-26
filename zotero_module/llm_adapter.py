from __future__ import annotations

import json
import os
import re
import hashlib
import time
from typing import Set
from pathlib import Path
from typing import Any

from openai import OpenAI


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


def _process_batch_for(*, collection_name: str, function: str, completion_window: str = "24h", poll_interval: int = 30, **_kwargs: Any) -> bool:
    p = _paths(function=function, collection_name=collection_name)
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
        with p["input"].open("rb") as fh:
            up = client.files.create(file=fh, purpose="batch")
        batch = client.batches.create(
            input_file_id=up.id,
            endpoint="/v1/responses",
            completion_window=str(completion_window or "24h"),
        )
        batch_id = batch.id
        p["meta"].write_text(
            json.dumps({
                "batch_id": batch_id,
                "input_file_id": up.id,
                "input_signature": input_signature,
                "line_count": int(line_count),
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
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


def _process_batches_for(*, collection_name: str, functions: list[str] | tuple[str, ...] | None = None, **kwargs: Any) -> bool:
    fn_list = list(functions or [])
    if not fn_list:
        return False
    ok = True
    for fn in fn_list:
        ok = _process_batch_for(collection_name=collection_name, function=str(fn), **kwargs) and ok
    return ok
