#!/usr/bin/env python3
import json
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path

from openai import OpenAI


DEFAULT_MODEL = "gpt-5-mini"
DEFAULT_TIMEOUT_SEC = 0
DEFAULT_POLL_SEC = 5
DEFAULT_STORE_ONLY = False
DEFAULT_LIVE_MODE = False


def _default_topic_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["included", "maybe", "excluded"]},
            "confidence": {"type": "number"},
            "justification": {"type": "string"},
        },
        "required": ["status", "confidence", "justification"]
    }


def _load_prompt_template(payload):
    prompt_spec = payload.get("promptSpec") if isinstance(payload.get("promptSpec"), dict) else None
    if prompt_spec:
        system_msg = str(prompt_spec.get("system") or "").strip() or "You are a precise academic classifier. Return only valid JSON."
        template = str(prompt_spec.get("template") or "").strip()
        schema = prompt_spec.get("schema") if isinstance(prompt_spec.get("schema"), dict) else _default_topic_schema()
        if template:
            return system_msg, template, schema

    prompt_path = payload.get("promptPath")
    if prompt_path:
        candidate = Path(prompt_path)
    else:
        candidate = Path(__file__).resolve().parents[3] / "Prompts" / "api_prompts.json"

    fallback = (
        "You are a strict research screening classifier.\n"
        "Classify topical membership using ONLY title and abstract.\n"
        "Return STRICT JSON only matching the schema.\n\n"
        "Decision policy:\n"
        "- status='included' only if title+abstract show the topic is the PRIMARY objective/contribution.\n"
        "- status='maybe' if topic appears but is secondary/peripheral/contextual/ambiguous.\n"
        "- status='excluded' if topic is absent or only broad-domain overlap is present.\n"
        "- Do NOT mark included for keyword mentions alone.\n\n"
        "Output EXACTLY: status, confidence, justification.\n\n"
        "TOPIC: {topic}\n"
        "INPUT JSON:\n"
        "{\"title\":\"{title}\",\"abstract\":\"{abstract}\"}"
    )
    system = "You are a precise academic classifier. Return only valid JSON."

    try:
        if not candidate.exists():
            return system, fallback, _default_topic_schema()
        content = json.loads(candidate.read_text(encoding="utf-8"))
        node = content.get("classify_abstract_topic_membership_v1") or {}
        if not node and isinstance(content, dict):
            for _k, _v in content.items():
                if not isinstance(_v, dict):
                    continue
                prop = _v.get("property")
                if isinstance(prop, dict) and str(prop.get("name") or "").strip() == "classify_abstract_topic_membership_v1":
                    node = _v
                    break
        template = node.get("text") or node.get("prompt") or fallback
        system_msg = node.get("content") or system
        schema = (
            ((node.get("json_schema") or {}).get("schema") or {}).get("parameters")
            if isinstance(node, dict)
            else None
        )
        if not isinstance(schema, dict):
            schema = _default_topic_schema()
        return str(system_msg), str(template), schema
    except Exception:
        return system, fallback, _default_topic_schema()


def _build_user_prompt(template, topic, title, abstract, item_key):
    data = {
        "topic": str(topic or "").strip(),
        "title": str(title or "").strip(),
        "abstract": str(abstract or "").strip(),
        "item_key": str(item_key or "").strip()
    }
    safe = {k: v.replace("{", "{{").replace("}", "}}") for k, v in data.items()}
    try:
        return template.format(**safe)
    except Exception:
        return f"TOPIC: {safe['topic']}\nTITLE: {safe['title']}\nABSTRACT: {safe['abstract']}\nITEM_KEY: {safe['item_key']}"


def _batch_line(model, system_content, user_content, custom_id, schema):
    schema_obj = schema if isinstance(schema, dict) else _default_topic_schema()
    body = {
        "model": model,
        "input": [
            {"type": "message", "role": "system", "content": system_content},
            {"type": "message", "role": "user", "content": user_content}
        ],
        "instructions": None,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "topic_match_result",
                "strict": True,
                "schema": schema_obj
            }
        }
    }
    if not str(model or "").lower().startswith("gpt-4"):
        body["reasoning"] = {"effort": "low"}
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/responses",
        "body": body
    }


def _extract_response_text(body):
    output_text = body.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    output = body.get("output") or []
    text_chunks = []
    for item in output:
        for chunk in (item or {}).get("content") or []:
            text = chunk.get("text")
            if isinstance(text, str) and text.strip():
                text_chunks.append(text.strip())
    return "".join(text_chunks).strip()


def _coerce_response_obj(resp):
    if resp is None:
        return {}
    if isinstance(resp, dict):
        return resp
    if hasattr(resp, "model_dump"):
        try:
            dumped = resp.model_dump()
            if isinstance(dumped, dict):
                return dumped
        except Exception:
            pass
    if hasattr(resp, "model_dump_json"):
        try:
            dumped = json.loads(resp.model_dump_json())
            if isinstance(dumped, dict):
                return dumped
        except Exception:
            pass
    return {}


def _parse_output_line(line_obj):
    custom_id = line_obj.get("custom_id", "")
    if line_obj.get("error"):
        return custom_id, {
            "status": "excluded",
            "confidence": 0,
            "justification": str((line_obj.get("error") or {}).get("message") or "Batch line error."),
        }

    body = ((line_obj.get("response") or {}).get("body") or {})
    content = _extract_response_text(body)
    if not content:
        return custom_id, {"status": "excluded", "confidence": 0, "justification": "No model choices."}

    try:
        parsed = json.loads(content)
    except Exception:
        return custom_id, {"status": "excluded", "confidence": 0, "justification": "Non-JSON model response."}

    status = str(parsed.get("status") or "").strip().lower()
    if status not in {"included", "maybe", "excluded"}:
        status = "excluded"

    return custom_id, {
        "status": status,
        "confidence": float(parsed.get("confidence", 0) or 0),
        "justification": str(parsed.get("justification") or parsed.get("reason") or ""),
    }


def _parse_single_response(response_obj):
    body = _coerce_response_obj(response_obj)
    err_obj = body.get("error")
    if isinstance(err_obj, dict) and err_obj:
        return {
            "status": "excluded",
            "confidence": 0,
            "justification": str(err_obj.get("message") or "Model response error."),
        }

    content = _extract_response_text(body)
    if not content:
        return {
            "status": "excluded",
            "confidence": 0,
            "justification": "No model choices.",
        }

    try:
        parsed = json.loads(content)
    except Exception:
        return {
            "status": "excluded",
            "confidence": 0,
            "justification": "Non-JSON model response.",
        }

    status = str(parsed.get("status") or "").strip().lower()
    if status not in {"included", "maybe", "excluded"}:
        status = "excluded"

    return {
        "status": status,
        "confidence": float(parsed.get("confidence", 0) or 0),
        "justification": str(parsed.get("justification") or parsed.get("reason") or ""),
    }


def _parse_old_backin_response(raw_obj):
    if isinstance(raw_obj, dict):
        if "status" in raw_obj:
            return {
                "status": str(raw_obj.get("status") or "excluded").strip().lower(),
                "confidence": float(raw_obj.get("confidence", 0) or 0),
                "justification": str(raw_obj.get("justification") or raw_obj.get("reason") or ""),
            }
        nested = raw_obj.get("response")
        if isinstance(nested, dict):
            return _parse_old_backin_response(nested)
        raw_text = raw_obj.get("raw_text")
        if isinstance(raw_text, str) and raw_text.strip():
            try:
                return _parse_old_backin_response(json.loads(raw_text))
            except Exception:
                return None
    elif isinstance(raw_obj, str):
        txt = raw_obj.strip()
        if txt:
            try:
                return _parse_old_backin_response(json.loads(txt))
            except Exception:
                return None
    return None


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw or "{}")
        items = payload.get("items") or []
        topic = str(payload.get("topic") or "").strip()
        if not topic:
            print(json.dumps({"status": "error", "message": "topic is required"}))
            return 2
        if not items:
            print(json.dumps({"status": "ok", "topic": topic, "results": [], "meta": {"scanned": 0}}))
            return 0

        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            print(json.dumps({"status": "error", "message": "OPENAI_API_KEY is missing"}))
            return 3

        model = str(payload.get("model") or DEFAULT_MODEL)
        timeout_sec = int(payload.get("timeoutSec") or DEFAULT_TIMEOUT_SEC)
        poll_sec = int(payload.get("pollSec") or DEFAULT_POLL_SEC)
        store_only = bool(payload.get("storeOnly", DEFAULT_STORE_ONLY))
        live_mode = bool(payload.get("liveMode", DEFAULT_LIVE_MODE))
        system_content, template, schema = _load_prompt_template(payload)
        prompt_spec_used = {
            "promptKey": str((payload.get("promptSpec") or {}).get("promptKey") or "classify_abstract_topic_membership_v1"),
            "system": str(system_content or ""),
            "template": str(template or ""),
            "schema": schema if isinstance(schema, dict) else _default_topic_schema()
        }
        client = OpenAI(api_key=api_key)

        if live_mode:
            project_root = Path(__file__).resolve().parents[3]
            os.environ.setdefault("BATCH_ROOT", str((project_root / "Batching_files").resolve()))
            os.environ.setdefault("ANNOTARIUM_CACHE_DIR", str((project_root / ".annotarium_llm_cache").resolve()))
            if str(project_root) not in sys.path:
                sys.path.insert(0, str(project_root))
            from zotero_module.llm_adapter import call_models as llm_call_models

            results = []
            for item in items:
                key = str(item.get("key") or "")
                title = str(item.get("title") or "")
                abstract = str(item.get("abstract") or "")
                user_prompt = _build_user_prompt(template, topic, title, abstract, key)

                try:
                    fn_key = "classify_abstract_topic_membership_v1"
                    custom_id = f"topic_live_{key or 'unknown'}"
                    normalized, _ = llm_call_models(
                        text=user_prompt,
                        function=fn_key,
                        custom_id=custom_id,
                        model=model,
                        collection_name=str(payload.get("collectionKey") or "electron_zotero_topic_live"),
                        read=False,
                        store_only=False,
                        ai="openai",
                        cache=False,
                    )
                    parsed = _parse_old_backin_response(normalized)
                    if not parsed:
                        err_txt = ""
                        if isinstance(normalized, dict):
                            err_txt = str(
                                normalized.get("error")
                                or (normalized.get("response") or {}).get("error")
                                or normalized.get("raw_text")
                                or ""
                            ).strip()
                        parsed = {
                            "status": "excluded",
                            "confidence": 0,
                            "justification": err_txt or "No parsable call_models_old_backin output.",
                        }
                except Exception as exc:
                    parsed = {
                        "status": "excluded",
                        "confidence": 0,
                        "justification": str(exc),
                    }

                results.append(
                    {
                        "key": key,
                        "title": title,
                        "status": str(parsed.get("status") or "excluded"),
                        "is_match": str(parsed.get("status") or "excluded").strip().lower() == "included",
                        "confidence": float(parsed.get("confidence", 0) or 0),
                        "themes": [],
                        "subject": "",
                        "reason": str(parsed.get("justification") or ""),
                        "suggested_tags": []
                    }
                )

            print(
                json.dumps(
                    {
                        "status": "ok",
                        "topic": topic,
                        "results": results,
                        "meta": {
                            "model": model,
                            "mode": "live",
                            "scanned": len(items),
                            "prompt_spec_used": prompt_spec_used
                        }
                    },
                    ensure_ascii=False
                )
            )
            return 0

        with tempfile.TemporaryDirectory(prefix="ez_topic_batch_") as td:
            td_path = Path(td)
            in_path = td_path / "input.jsonl"
            out_path = td_path / "output.jsonl"
            req_map = {}

            with in_path.open("w", encoding="utf-8") as f:
                for idx, item in enumerate(items):
                    item_key = str(item.get("key") or "").strip()
                    custom_id = f"topic_{idx}_{item_key or 'unknown'}"
                    req_map[custom_id] = {
                        "key": item_key,
                        "title": str(item.get("title") or ""),
                        "abstract": str(item.get("abstract") or "")
                    }
                    user_prompt = _build_user_prompt(
                        template,
                        topic,
                        item.get("title"),
                        item.get("abstract"),
                        item_key
                    )
                    line = _batch_line(
                        model=model,
                        system_content=system_content,
                        user_content=user_prompt,
                        custom_id=custom_id,
                        schema=schema
                    )
                    f.write(json.dumps(line, ensure_ascii=False) + "\n")

            upload = client.files.create(file=open(in_path, "rb"), purpose="batch")
            batch = client.batches.create(
                input_file_id=upload.id,
                endpoint="/v1/responses",
                completion_window="24h",
                metadata={
                    "source": "electron_zotero_topic_classifier",
                    "topic": str(topic or "")[:120],
                    "collection_key": str(payload.get("collectionKey") or "")[:64],
                    "workflow_job_id": str(payload.get("workflowJobId") or "")[:64]
                }
            )

            if store_only:
                print(
                    json.dumps(
                        {
                            "status": "ok",
                            "topic": topic,
                            "results": [],
                            "meta": {
                                "model": model,
                                "batch_id": batch.id,
                                "input_file_id": upload.id,
                                "status": str(getattr(batch, "status", "") or "validating"),
                                "submitted": True,
                                "scanned": len(items),
                                "prompt_spec_used": prompt_spec_used
                            }
                        },
                        ensure_ascii=False
                    )
                )
                return 0

            started = time.time()
            output_file_id = None
            last_status = ""
            while True:
                now_batch = client.batches.retrieve(batch.id)
                status = str(getattr(now_batch, "status", "") or "")
                if status != last_status:
                    last_status = status
                if status == "completed":
                    output_file_id = getattr(now_batch, "output_file_id", None)
                    if output_file_id:
                        break
                if status in {"failed", "cancelled", "expired"}:
                    print(json.dumps({"status": "error", "message": f"Batch ended with status '{status}'"}))
                    return 4
                if timeout_sec > 0 and (time.time() - started > timeout_sec):
                    print(json.dumps({"status": "error", "message": f"Batch timeout after {timeout_sec}s"}))
                    return 5
                time.sleep(max(1, poll_sec))

            api_resp = client.files.with_raw_response.retrieve_content(file_id=output_file_id)
            out_path.write_bytes(api_resp.content)

            parsed_by_key = {}
            with out_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    custom_id, parsed = _parse_output_line(obj)
                    item_meta = req_map.get(custom_id, {})
                    key = item_meta.get("key", "")
                    if not key:
                        continue
                    parsed_by_key[key] = parsed

            results = []
            for item in items:
                key = str(item.get("key") or "")
                parsed = parsed_by_key.get(
                    key,
                    {
                        "status": "excluded",
                        "confidence": 0,
                        "justification": "No batch output for item.",
                    }
                )
                results.append(
                    {
                        "key": key,
                        "title": str(item.get("title") or ""),
                        "status": str(parsed.get("status") or "excluded"),
                        "is_match": str(parsed.get("status") or "excluded").strip().lower() == "included",
                        "confidence": float(parsed.get("confidence", 0) or 0),
                        "themes": [],
                        "subject": "",
                        "reason": str(parsed.get("justification") or ""),
                        "suggested_tags": []
                    }
                )

            print(
                json.dumps(
                    {
                        "status": "ok",
                        "topic": topic,
                        "results": results,
                        "meta": {
                            "model": model,
                            "batch_id": batch.id,
                            "scanned": len(items),
                            "prompt_spec_used": prompt_spec_used
                        }
                    },
                    ensure_ascii=False
                )
            )
            return 0
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "error",
                    "message": str(exc),
                    "trace": traceback.format_exc(limit=8)
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
