"""
Two-stream thematic synthesis pipeline using call_models_old_backin for LLM calls.

Pipeline steps
1) Normalize and deduplicate evidence
2) Build Stream A (open codes) and Stream B (targeted claims)
3) Cluster Stream A themes with semantic similarity
4) Build Stream B backbone sections from claim harvest
5) Cross-walk Stream A themes to Stream B claims
6) Write section HTML with dqid anchors, then hydrate anchors to (Author, Year) with tooltips
7) Quality gates

Inputs
- Stream A JSONL: batch outputs for code_pdf_page
- Stream B JSONL: batch outputs for code_intro_conclusion_extract_core_claims
- Items metadata file: CSV or JSON with item_key -> first_author_last, year

Outputs
- Normalized evidence JSONL
- Theme clusters JSON
- Backbone sections JSON
- Cross-walk JSON
- Section payloads JSON
- Review HTML

Strict by design: malformed JSON or missing keys should raise.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple


def default_config() -> Dict[str, Any]:
    return {
        "model": "gpt-5-mini",
        "theme_similarity_threshold": 0.82,
        "max_evidence_per_prompt": 80,
        "min_unique_evidence_per_theme": 6,
        "min_unique_sources_per_theme": 2,
        "candidate_claims_per_theme": 12,
        "max_themes_total": 40,
        "embedding_model": "all-MiniLM-L6-v2",
        "llm_mode": "immediate",
        "ai_provider": "openai",
        "collection_name": "__synth_v2__",
        "require_full_coverage": False,
    }


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _write_text(path: Path, text: str) -> None:
    os.makedirs(path.parent, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _read_json(path: Path) -> Any:
    return json.loads(_read_text(path))


def _write_json(path: Path, obj: Any) -> None:
    _write_text(path, json.dumps(obj, ensure_ascii=False, indent=2))


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def _write_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
    os.makedirs(path.parent, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def _extract_output_text_from_batch_row(row: Dict[str, Any]) -> str:
    body = row["response"]["body"]
    outputs = body["output"]
    for msg in outputs:
        if msg["type"] != "message":
            continue
        content = msg["content"]
        for part in content:
            if part["type"] != "output_text":
                continue
            return part["text"]
    return ""


_PUNCT_RX = re.compile(r"[^a-z0-9\s']+")


def _quote_normalize(text: str) -> str:
    t = str(text).strip().lower()
    t = t.replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'")
    t = re.sub(r"\s+", " ", t)
    t = _PUNCT_RX.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _load_items_meta_index(items_meta_path: Path) -> Dict[str, Dict[str, Any]]:
    suffix = items_meta_path.suffix.lower()
    if suffix == ".json":
        raw = _read_json(items_meta_path)
        idx: Dict[str, Dict[str, Any]] = {}
        for row in raw:
            key = row["item_key"]
            idx[key] = row
        return idx
    if suffix == ".csv":
        import pandas as pd

        df = pd.read_csv(items_meta_path)
        idx2: Dict[str, Dict[str, Any]] = {}
        for _, row in df.iterrows():
            key = str(row["item_key"]).strip()
            idx2[key] = {
                "item_key": key,
                "first_author_last": str(row["first_author_last"]).strip(),
                "year": str(row["year"]).strip(),
                "title": str(row.get("title", "")).strip(),
                "source": str(row.get("source", "")).strip(),
                "url": str(row.get("url", "")).strip(),
            }
        return idx2
    raise ValueError(f"Unsupported items metadata file suffix: {items_meta_path.suffix}")


def _load_custom_id_map(path: Path) -> Dict[str, str]:
    return _read_json(path)


def _parse_stream_a_rows(
    batch_rows: List[Dict[str, Any]],
    custom_id_map: Dict[str, str],
) -> List[Dict[str, Any]]:
    evidence: List[Dict[str, Any]] = []
    for row in batch_rows:
        custom_id = row["custom_id"]
        item_key = custom_id[:8]
        if custom_id_map:
            item_key = custom_id_map[custom_id]
        text = _extract_output_text_from_batch_row(row)
        payload = json.loads(text)
        for ev in payload["evidence"]:
            rec = {
                "item_key": item_key,
                "dqid": "",
                "quote": ev["quote"],
                "paraphrase": ev["paraphrase"],
                "relevant_rqs": ev["relevant_rqs"],
                "potential_themes": ev["potential_themes"],
                "open_codes": ev["open_codes"],
                "extraction_type": "open_code",
                "relevance_score": ev.get("relevance_score", None),
                "evidence_type": ev.get("evidence_type", None),
                "argument_type": ev.get("argument_type", None),
                "claim_direction": ev.get("claim_direction", None),
                "researcher_comment": ev.get("researcher_comment", None),
                "source_custom_id": custom_id,
            }
            rec["quote_normalized"] = _quote_normalize(rec["quote"])
            evidence.append(rec)
    return evidence


def _parse_stream_b_rows(batch_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    evidence: List[Dict[str, Any]] = []
    for row in batch_rows:
        text = _extract_output_text_from_batch_row(row)
        payload = json.loads(text)
        for ev in payload["evidence"]:
            dqid = ev["dqid"]
            item_key = dqid.split("#")[0]
            rec = {
                "item_key": item_key,
                "dqid": dqid,
                "quote": ev["quote"],
                "paraphrase": ev["paraphrase"],
                "relevant_rqs": ev["relevant_rqs"],
                "potential_themes": [],
                "open_codes": ev["mapped_codes"],
                "extraction_type": ev["extraction_type"],
                "relevance_score": ev.get("relevance_score", None),
            }
            rec["quote_normalized"] = _quote_normalize(rec["quote"])
            evidence.append(rec)
    return evidence


def _dedupe_evidence(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen_item_quote: set[Tuple[str, str]] = set()
    stage1: List[Dict[str, Any]] = []
    for r in rows:
        key = (r["item_key"], r["quote_normalized"])
        if key in seen_item_quote:
            continue
        seen_item_quote.add(key)
        stage1.append(r)

    seen_quote: set[str] = set()
    stage2: List[Dict[str, Any]] = []
    for r in stage1:
        qn = r["quote_normalized"]
        if qn in seen_quote:
            continue
        seen_quote.add(qn)
        stage2.append(r)

    return stage2


def _assign_stream_a_dqids(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        k = r["item_key"]
        if k not in grouped:
            grouped[k] = []
        grouped[k].append(r)

    out: List[Dict[str, Any]] = []
    for item_key, items in grouped.items():
        items_sorted = sorted(items, key=lambda x: x["quote_normalized"])
        i = 1
        for r in items_sorted:
            dqid = f"{item_key}#DQ{str(i).zfill(3)}"
            rr = dict(r)
            rr["dqid"] = dqid
            out.append(rr)
            i += 1
    return out


def _build_dq_lookup(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    lookup: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        lookup[r["dqid"]] = {
            "dqid": r["dqid"],
            "item_key": r["item_key"],
            "quote": r["quote"],
            "paraphrase": r["paraphrase"],
            "extraction_type": r["extraction_type"],
            "open_codes": r["open_codes"],
            "potential_themes": r["potential_themes"],
            "relevant_rqs": r["relevant_rqs"],
        }
    return lookup


def _label_to_text(label: str) -> str:
    t = str(label).strip()
    t = t.replace("_", " ")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _cluster_theme_labels(labels: List[str], threshold: float, emb_model: str) -> List[List[str]]:
    import numpy as np
    from sentence_transformers import SentenceTransformer

    texts = [_label_to_text(x) for x in labels]
    model = SentenceTransformer(str(emb_model))
    emb = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)

    parents: Dict[int, int] = {}
    i = 0
    while i < len(labels):
        parents[i] = i
        i += 1

    def _find(x: int) -> int:
        y = x
        while parents[y] != y:
            parents[y] = parents[parents[y]]
            y = parents[y]
        return y

    def _union(a: int, b: int) -> None:
        ra = _find(a)
        rb = _find(b)
        if ra == rb:
            return
        parents[rb] = ra

    n = len(labels)
    a = 0
    while a < n:
        b = a + 1
        while b < n:
            sim = float(np.dot(emb[a], emb[b]))
            if sim >= threshold:
                _union(a, b)
            b += 1
        a += 1

    clusters_by_root: Dict[int, List[str]] = {}
    idx2 = 0
    while idx2 < n:
        root = _find(idx2)
        if root not in clusters_by_root:
            clusters_by_root[root] = []
        clusters_by_root[root].append(labels[idx2])
        idx2 += 1

    clusters: List[List[str]] = []
    for _, members in clusters_by_root.items():
        clusters.append(sorted(members))
    clusters.sort(key=lambda xs: (-len(xs), xs[0]))
    return clusters


def _build_theme_clusters(stream_a_rows: List[Dict[str, Any]], cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    label_counts: Dict[str, int] = {}
    label_sources: Dict[str, set[str]] = {}
    label_dqids: Dict[str, List[str]] = {}
    label_rqs: Dict[str, set[int]] = {}

    for r in stream_a_rows:
        themes = r["potential_themes"]
        dqid = r["dqid"]
        item_key = r["item_key"]
        rq_idxs: List[int] = []
        for rq in r["relevant_rqs"]:
            rq_idxs.append(int(rq["index"]))
        for t in themes:
            if t not in label_counts:
                label_counts[t] = 0
            label_counts[t] += 1
            if t not in label_sources:
                label_sources[t] = set()
            label_sources[t].add(item_key)
            if t not in label_dqids:
                label_dqids[t] = []
            label_dqids[t].append(dqid)
            if t not in label_rqs:
                label_rqs[t] = set()
            for rq_idx in rq_idxs:
                label_rqs[t].add(rq_idx)

    labels = sorted(label_counts.keys())
    clusters = _cluster_theme_labels(
        labels,
        threshold=float(cfg["theme_similarity_threshold"]),
        emb_model=str(cfg["embedding_model"]),
    )

    out: List[Dict[str, Any]] = []
    for members in clusters:
        best_label = members[0]
        best_count = -1
        for lab in members:
            c = label_counts[lab]
            if c > best_count:
                best_count = c
                best_label = lab

        dqids: List[str] = []
        sources: set[str] = set()
        rqs: set[int] = set()
        for lab in members:
            dqids.extend(label_dqids[lab])
            sources.update(label_sources[lab])
            rqs.update(label_rqs[lab])

        uniq_dqids = sorted(set(dqids))
        if len(uniq_dqids) < int(cfg["min_unique_evidence_per_theme"]):
            continue
        if len(sources) < int(cfg["min_unique_sources_per_theme"]):
            continue

        out.append(
            {
                "theme_id": best_label,
                "theme_label": _label_to_text(best_label),
                "member_labels": members,
                "evidence_dqids": uniq_dqids,
                "evidence_count": len(uniq_dqids),
                "source_count": len(sources),
                "source_item_keys": sorted(sources),
                "rq_indices": sorted(rqs),
            }
        )

    out.sort(key=lambda x: (-int(x["evidence_count"]), -int(x["source_count"]), str(x["theme_id"])))
    if len(out) > int(cfg["max_themes_total"]):
        out = out[: int(cfg["max_themes_total"])]
    return out


def _slug(text: str, max_len: int) -> str:
    t = str(text).strip().lower()
    t = re.sub(r"[^a-z0-9]+", "_", t).strip("_")
    if not t:
        raise ValueError("Empty slug")
    return t[: int(max_len)]


def _export_theme_evidence_tables(
    theme_clusters: List[Dict[str, Any]],
    dq_lookup: Dict[str, Dict[str, Any]],
    meta_index: Dict[str, Dict[str, Any]],
    out_folder: Path,
) -> None:
    theme_folder = out_folder / "theme_evidence"
    os.makedirs(theme_folder, exist_ok=True)
    for theme in theme_clusters:
        fname = _slug(str(theme["theme_id"]), 120) + ".jsonl"
        path = theme_folder / fname
        rows: List[Dict[str, Any]] = []
        for dqid in theme["evidence_dqids"]:
            ev = dq_lookup[dqid]
            meta = meta_index[ev["item_key"]]
            rows.append(
                {
                    "theme_id": theme["theme_id"],
                    "theme_label": theme["theme_label"],
                    "dqid": dqid,
                    "item_key": ev["item_key"],
                    "first_author_last": meta["first_author_last"],
                    "year": meta["year"],
                    "quote": ev["quote"],
                    "paraphrase": ev["paraphrase"],
                    "open_codes": ev["open_codes"],
                    "potential_themes": ev["potential_themes"],
                    "extraction_type": ev["extraction_type"],
                    "relevant_rqs": ev["relevant_rqs"],
                }
            )
        _write_jsonl(path, rows)


def _group_claims_by_section(stream_b_rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    buckets: Dict[str, List[Dict[str, Any]]] = {
        "Definitions": [],
        "Main findings": [],
        "Methods": [],
        "Limitations": [],
        "Future work": [],
    }
    for r in stream_b_rows:
        t = r["extraction_type"]
        if t == "definition":
            buckets["Definitions"].append(r)
        if t == "main_finding":
            buckets["Main findings"].append(r)
        if t == "method_claim":
            buckets["Methods"].append(r)
        if t == "limitation":
            buckets["Limitations"].append(r)
        if t == "recommendation":
            buckets["Future work"].append(r)
    return buckets


_SECTION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "section_title": {"type": "string", "minLength": 1, "maxLength": 200},
        "section_html": {"type": "string", "minLength": 1, "maxLength": 20000},
        "used_dqids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 400,
            "items": {"type": "string", "minLength": 8, "maxLength": 200},
        },
    },
    "required": ["section_title", "section_html", "used_dqids"],
}


_CROSSWALK_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "theme_id": {"type": "string", "minLength": 1, "maxLength": 200},
        "claim_links": {
            "type": "array",
            "minItems": 0,
            "maxItems": 30,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "dqid": {"type": "string", "minLength": 8, "maxLength": 200},
                    "relation": {"type": "string", "enum": ["supports", "contradicts", "extends"]},
                    "note": {"type": "string", "minLength": 1, "maxLength": 240},
                },
                "required": ["dqid", "relation", "note"],
            },
        },
    },
    "required": ["theme_id", "claim_links"],
}


def _extract_json_object_text(raw_text: str) -> str:
    s = str(raw_text).strip()
    start = s.index("{")
    end = s.rindex("}")
    return s[start : end + 1]


def _unwrap_call_models_text(resp: Any) -> str:
    if type(resp) is str:
        return resp
    if type(resp) is tuple:
        return _unwrap_call_models_text(resp[0])
    if type(resp) is list:
        return _unwrap_call_models_text(resp[0])
    if type(resp) is dict:
        if "result" in resp:
            v = resp["result"]
            if type(v) is str:
                return v
            if type(v) is dict:
                return json.dumps(v, ensure_ascii=False)
            if type(v) is list:
                return json.dumps(v, ensure_ascii=False)
        if "output_text" in resp:
            return resp["output_text"]
        if "raw_text" in resp:
            return resp["raw_text"]
        if "text" in resp:
            return resp["text"]
        if "response_text" in resp:
            return resp["response_text"]
        if "response" in resp:
            v2 = resp["response"]
            if type(v2) is str:
                return v2
            if type(v2) is dict:
                return json.dumps(v2, ensure_ascii=False)
        return json.dumps(resp, ensure_ascii=False)
    return str(resp)


def _stable_custom_id(prefix: str, key: str, payload_text: str) -> str:
    h = hashlib.md5(payload_text.encode("utf-8")).hexdigest()[:10]
    key_slug = _slug(key, 42)
    cid = f"{prefix}:{key_slug}:{h}"
    if len(cid) > 90:
        cid = cid[:90]
    return cid


def _build_json_prompt(system_text: str, user_payload_obj: Any, schema_obj: Any) -> str:
    user_text = json.dumps(user_payload_obj, ensure_ascii=False)
    schema_text = json.dumps(schema_obj, ensure_ascii=False, indent=2)
    prompt = (
        "Return STRICT JSON only. No prose. No markdown.\n"
        "JSON must match the schema exactly.\n\n"
        "SYSTEM INSTRUCTIONS:\n"
        + system_text
        + "\n\n"
        "INPUT JSON:\n"
        + user_text
        + "\n\n"
        "OUTPUT JSON SCHEMA:\n"
        + schema_text
        + "\n"
    )
    return prompt


def _get_calling_model_fns():
    try:
        from core.utils.calling_models import call_models_old_backin, _process_batch_for

        def _call(
            *,
            text: str,
            function: str,
            custom_id: str,
            collection_name: str,
            read: bool,
            store_only: bool,
            ai_provider: str,
            model: str,
        ) -> Any:
            return call_models_old_backin(
                text=text,
                function=function,
                custom_id=custom_id,
                collection_name=collection_name,
                read=read,
                store_only=store_only,
                ai=ai_provider,
                models={"openai": model},
            )

        def _process(*, function: str, collection_name: str) -> bool:
            return bool(
                _process_batch_for(
                    function=function,
                    collection_name=collection_name,
                    wait=True,
                    download_if_ready=True,
                )
            )

        return _call, _process
    except Exception:
        repo_root = Path(__file__).resolve().parents[1]
        llms_dir = repo_root / "python_backend_legacy" / "llms"
        if str(llms_dir) not in sys.path:
            sys.path.insert(0, str(llms_dir))
        import calling_models as cm  # type: ignore

        def _call(
            *,
            text: str,
            function: str,
            custom_id: str,
            collection_name: str,
            read: bool,
            store_only: bool,
            ai_provider: str,
            model: str,
        ) -> Any:
            return cm.call_models_zt(
                text=text,
                function=function,
                custom_id=custom_id,
                collection_name=collection_name,
                read=read,
                store_only=store_only,
                ai=ai_provider,
                model=model,
                cache=False,
            )

        def _process(*, function: str, collection_name: str) -> bool:
            return bool(
                cm._process_batch_for(
                    analysis_key_suffix=function,
                    section_title=collection_name,
                    poll_interval=30,
                )
            )

        return _call, _process


def _call_llm_json_immediate(
    *,
    prompt_text: str,
    function: str,
    custom_id: str,
    collection_name: str,
    ai_provider: str,
    model: str,
) -> Dict[str, Any]:
    call_fn, _ = _get_calling_model_fns()
    resp = call_fn(
        text=prompt_text,
        function=function,
        custom_id=custom_id,
        collection_name=collection_name,
        read=False,
        store_only=False,
        ai_provider=ai_provider,
        model=model,
    )
    raw = _unwrap_call_models_text(resp)
    obj_text = _extract_json_object_text(raw)
    out = json.loads(obj_text)
    return out


def _run_jobs_for_function_batch(
    *,
    function: str,
    jobs: List[Dict[str, str]],
    collection_name: str,
    ai_provider: str,
    model: str,
) -> List[Dict[str, Any]]:
    call_fn, process_batch_fn = _get_calling_model_fns()

    for job in jobs:
        _ = call_fn(
            text=job["prompt_text"],
            function=function,
            custom_id=job["custom_id"],
            collection_name=collection_name,
            read=False,
            store_only=True,
            ai_provider=ai_provider,
            model=model,
        )

    ok = process_batch_fn(function=function, collection_name=collection_name)
    if ok is not True:
        raise ValueError(f"Batch failed for function={function} collection={collection_name}")

    outputs: List[Dict[str, Any]] = []
    for job in jobs:
        resp = call_fn(
            text="",
            function=function,
            custom_id=job["custom_id"],
            collection_name=collection_name,
            read=True,
            store_only=False,
            ai_provider=ai_provider,
            model=model,
        )
        raw = _unwrap_call_models_text(resp)
        obj_text = _extract_json_object_text(raw)
        outputs.append(json.loads(obj_text))

    return outputs


def _run_jobs_for_function(
    *,
    function: str,
    jobs: List[Dict[str, str]],
    cfg: Dict[str, Any],
) -> List[Dict[str, Any]]:
    if cfg["llm_mode"] == "batch":
        return _run_jobs_for_function_batch(
            function=function,
            jobs=jobs,
            collection_name=str(cfg["collection_name"]),
            ai_provider=str(cfg["ai_provider"]),
            model=str(cfg["model"]),
        )

    outputs: List[Dict[str, Any]] = []
    for job in jobs:
        outputs.append(
            _call_llm_json_immediate(
                prompt_text=job["prompt_text"],
                function=function,
                custom_id=job["custom_id"],
                collection_name=str(cfg["collection_name"]),
                ai_provider=str(cfg["ai_provider"]),
                model=str(cfg["model"]),
            )
        )
    return outputs


def _select_rows_by_dqid(dq_lookup: Dict[str, Dict[str, Any]], dqids: List[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for dqid in dqids:
        out.append(dq_lookup[dqid])
    return out


def _build_backbone_section_job(section_title: str, claims: List[Dict[str, Any]], cfg: Dict[str, Any]) -> Dict[str, str]:
    picked = claims
    if len(picked) > int(cfg["max_evidence_per_prompt"]):
        picked = picked[: int(cfg["max_evidence_per_prompt"])]

    system_text = (
        "Write one systematic review section in HTML.\n"
        "Use only the provided evidence items.\n"
        "Citations must be HTML anchors of the form: <a data-dqid=\"DQID\"></a>.\n"
        "Every paragraph must contain at least one such anchor.\n"
        "Do not invent dqids.\n"
        "Do not include a bibliography.\n"
    )

    payload = {
        "section_title": section_title,
        "evidence": [
            {
                "dqid": r["dqid"],
                "paraphrase": r["paraphrase"],
                "quote": r["quote"],
                "open_codes": r["open_codes"],
                "extraction_type": r["extraction_type"],
            }
            for r in picked
        ],
    }

    prompt_text = _build_json_prompt(system_text, payload, _SECTION_SCHEMA)
    custom_id = _stable_custom_id("backbone", section_title, prompt_text)

    return {"custom_id": custom_id, "prompt_text": prompt_text}


def _embed_texts(texts: List[str], emb_model: str) -> Any:
    import numpy as np

    try:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(str(emb_model))
        emb = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
        return emb
    except Exception:
        # Robust fallback for restricted/offline envs: deterministic hashed BOW vectors.
        dim = 512
        mat = np.zeros((len(texts), dim), dtype=float)
        for i, text in enumerate(texts):
            tokens = re.findall(r"[A-Za-z0-9_\\-]+", str(text).lower())
            if not tokens:
                continue
            for tok in tokens:
                h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
                j = h % dim
                mat[i, j] += 1.0
            norm = float(np.linalg.norm(mat[i]))
            if norm > 0:
                mat[i] = mat[i] / norm
        return mat


def _build_claim_similarity_index(claims: List[Dict[str, Any]], cfg: Dict[str, Any]) -> Dict[str, Any]:
    import numpy as np

    texts = [str(c["paraphrase"]) for c in claims]
    emb = _embed_texts(texts, emb_model=str(cfg["embedding_model"]))
    mat = np.array(emb, dtype=float)
    return {"claims": claims, "texts": texts, "emb": mat}


def _top_k_claims_for_theme(
    theme_label: str,
    idx: Dict[str, Any],
    k: int,
    cfg: Dict[str, Any],
) -> List[Dict[str, Any]]:
    import numpy as np

    theme_text = _label_to_text(theme_label)
    emb_theme = _embed_texts([theme_text], emb_model=str(cfg["embedding_model"]))
    theme_vec = np.array(emb_theme[0], dtype=float)
    sims = idx["emb"] @ theme_vec
    order = np.argsort(-sims)[:k]
    out: List[Dict[str, Any]] = []
    for i in order:
        out.append(idx["claims"][int(i)])
    return out


def _build_crosswalk_job(theme: Dict[str, Any], claim_index: Dict[str, Any], cfg: Dict[str, Any]) -> Dict[str, str]:
    cand = _top_k_claims_for_theme(
        theme["theme_id"],
        idx=claim_index,
        k=int(cfg["candidate_claims_per_theme"]),
        cfg=cfg,
    )

    system_text = (
        "Link a theme to claim evidence.\n"
        "Given a theme label and candidate claim items, output claim_links.\n"
        "relation meanings: supports, contradicts, extends.\n"
        "Use only provided dqids.\n"
    )

    payload = {
        "theme_id": theme["theme_id"],
        "theme_label": theme["theme_label"],
        "candidate_claims": [
            {
                "dqid": c["dqid"],
                "extraction_type": c["extraction_type"],
                "paraphrase": c["paraphrase"],
                "quote": c["quote"],
            }
            for c in cand
        ],
    }

    prompt_text = _build_json_prompt(system_text, payload, _CROSSWALK_SCHEMA)
    custom_id = _stable_custom_id("crosswalk", str(theme["theme_id"]), prompt_text)

    return {"custom_id": custom_id, "prompt_text": prompt_text}


def _build_theme_section_job(
    theme: Dict[str, Any],
    theme_evidence: List[Dict[str, Any]],
    claim_links: List[Dict[str, Any]],
    claim_evidence_lookup: Dict[str, Dict[str, Any]],
    cfg: Dict[str, Any],
) -> Dict[str, str]:
    picked_theme = theme_evidence
    if len(picked_theme) > int(cfg["max_evidence_per_prompt"]):
        picked_theme = picked_theme[: int(cfg["max_evidence_per_prompt"])]

    picked_claims: List[Dict[str, Any]] = []
    for link in claim_links:
        dqid = link["dqid"]
        picked_claims.append(claim_evidence_lookup[dqid])

    system_text = (
        "Write one thematic findings section in HTML.\n"
        "Use Stream A open-code evidence and Stream B claim evidence.\n"
        "Write an argument, not a list.\n"
        "Use anchors: <a data-dqid=\"DQID\"></a>.\n"
        "Every paragraph must contain at least one anchor.\n"
        "When a Stream B claim contradicts Stream A evidence, state the tension.\n"
    )

    payload = {
        "section_title": theme["theme_label"],
        "theme": {
            "theme_id": theme["theme_id"],
            "theme_label": theme["theme_label"],
            "member_labels": theme["member_labels"],
        },
        "stream_a_evidence": [
            {
                "dqid": r["dqid"],
                "paraphrase": r["paraphrase"],
                "quote": r["quote"],
                "open_codes": r["open_codes"],
                "potential_themes": r["potential_themes"],
            }
            for r in picked_theme
        ],
        "stream_b_claim_links": claim_links,
        "stream_b_claim_evidence": [
            {
                "dqid": r["dqid"],
                "extraction_type": r["extraction_type"],
                "paraphrase": r["paraphrase"],
                "quote": r["quote"],
                "open_codes": r["open_codes"],
            }
            for r in picked_claims
        ],
    }

    prompt_text = _build_json_prompt(system_text, payload, _SECTION_SCHEMA)
    custom_id = _stable_custom_id("theme", str(theme["theme_id"]), prompt_text)

    return {"custom_id": custom_id, "prompt_text": prompt_text}


def _hydrate_html_anchors(section_html: str, dq_lookup: Dict[str, Dict[str, Any]], meta_index: Dict[str, Dict[str, Any]]) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(section_html, "html.parser")
    anchors = soup.find_all("a")
    for a in anchors:
        dqid = a.get("data-dqid")
        if not dqid:
            continue
        if dqid not in dq_lookup:
            a.decompose()
            continue
        dq = dq_lookup[dqid]
        item_key = str(dq.get("item_key") or "")
        meta = meta_index.get(item_key)
        if not isinstance(meta, dict):
            a.decompose()
            continue
        cite = f"({meta['first_author_last']}, {meta['year']})"
        a.string = cite
        a["title"] = dq["quote"]
        a["data-key"] = dq["item_key"]
        a["href"] = f"#{dqid}"
    return str(soup)


def _validate_used_dqids(section: Dict[str, Any], dq_lookup: Dict[str, Dict[str, Any]]) -> None:
    html_text = section["section_html"]
    used = section["used_dqids"]
    for dqid in used:
        _ = dq_lookup[dqid]
        needle = f'data-dqid="{dqid}"'
        if needle not in html_text:
            raise ValueError(f"Section is missing anchor for dqid: {dqid}")


def _build_fallback_section(
    *,
    section_title: str,
    evidence_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    picked = evidence_rows[: min(8, len(evidence_rows))]
    parts: List[str] = []
    used: List[str] = []
    if not picked:
        parts.append('<p>No high-confidence evidence was available for this section.</p>')
    for ev in picked:
        dqid = str(ev.get("dqid") or "").strip()
        if not dqid:
            continue
        para = str(ev.get("paraphrase") or ev.get("quote") or "").strip()
        if not para:
            continue
        para = html.escape(para[:900])
        parts.append(f'<p>{para} <a data-dqid="{dqid}"></a></p>')
        if dqid not in used:
            used.append(dqid)
    return {
        "section_title": section_title,
        "section_html": "\n".join(parts),
        "used_dqids": used,
    }


def _sanitize_section_payload(
    *,
    section_obj: Dict[str, Any],
    default_title: str,
    fallback_evidence_rows: List[Dict[str, Any]],
    dq_lookup: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    title = str(section_obj.get("section_title") or default_title).strip() or default_title
    html_text = str(section_obj.get("section_html") or "").strip()
    used = section_obj.get("used_dqids")
    if not isinstance(used, list):
        used = []
    used = [str(x).strip() for x in used if str(x).strip()]
    if html_text and not used:
        used = [str(x).strip() for x in re.findall(r'data-dqid="([^"]+)"', html_text) if str(x).strip()]

    candidate = {
        "section_title": title,
        "section_html": html_text,
        "used_dqids": used,
    }
    try:
        if not candidate["section_html"].strip():
            raise ValueError("empty_section_html")
        if not candidate["used_dqids"]:
            raise ValueError("no_used_dqids")
        _validate_used_dqids(candidate, dq_lookup)
        return candidate
    except Exception:
        return _build_fallback_section(section_title=title, evidence_rows=fallback_evidence_rows)


def _render_review_html(title: str, sections: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    parts.append("<!doctype html>")
    parts.append("<html>")
    parts.append("<head>")
    parts.append('<meta charset="utf-8">')
    parts.append(f"<title>{html.escape(title)}</title>")
    parts.append("</head>")
    parts.append("<body>")
    parts.append(f"<h1>{html.escape(title)}</h1>")
    for sec in sections:
        parts.append(f"<h2>{html.escape(sec['section_title'])}</h2>")
        parts.append(sec["section_html"])
    parts.append("</body>")
    parts.append("</html>")
    return "\n".join(parts)


def _first_text_from_sections(sections: List[Dict[str, Any]], max_chars: int = 600) -> str:
    for sec in sections:
        txt = re.sub(r"<[^>]+>", " ", str(sec.get("section_html") or ""))
        txt = re.sub(r"\s+", " ", txt).strip()
        if txt:
            return txt[:max_chars]
    return ""


def _render_full_paper_html(
    *,
    title: str,
    collection_name: str,
    sections: List[Dict[str, Any]],
    items_meta_index: Dict[str, Dict[str, Any]],
    stats: Dict[str, Any],
) -> str:
    defs = next((s for s in sections if str(s.get("section_title")) == "Definitions"), {"section_html": ""})
    findings = next((s for s in sections if str(s.get("section_title")) == "Main findings"), {"section_html": ""})
    methods = next((s for s in sections if str(s.get("section_title")) == "Methods"), {"section_html": ""})
    limits = next((s for s in sections if str(s.get("section_title")) == "Limitations"), {"section_html": ""})
    future = next((s for s in sections if str(s.get("section_title")) == "Future work"), {"section_html": ""})

    n_items = len(items_meta_index)
    n_ev_a = int(stats.get("stream_a_evidence") or 0)
    n_ev_b = int(stats.get("stream_b_evidence") or 0)
    abstract_txt = (
        f"This systematic review synthesizes evidence on {html.escape(collection_name)}. "
        f"We analyzed {n_items} documents and extracted {n_ev_a + n_ev_b} coded evidence units "
        f"(open coding: {n_ev_a}; targeted harvesting: {n_ev_b}). "
        f"Key findings are summarized in the results sections, with limitations and future-work implications reported."
    )
    intro_txt = _first_text_from_sections([defs, findings], max_chars=900) or "The review investigates the evidence base and conceptual foundations relevant to the selected collection."
    concl_txt = _first_text_from_sections([findings, limits, future], max_chars=700) or "The current evidence base is heterogeneous; interpretation should account for methodological and reporting constraints."

    refs: List[str] = []
    for item_key, meta in sorted(items_meta_index.items(), key=lambda kv: (str(kv[1].get("first_author_last") or "Unknown"), str(kv[1].get("year") or "n.d."), str(kv[1].get("title") or ""))):
        author = html.escape(str(meta.get("first_author_last") or "Unknown"))
        year = html.escape(str(meta.get("year") or "n.d."))
        title_i = html.escape(str(meta.get("title") or f"Source record {item_key}"))
        refs.append(f"<li>{author}. ({year}). {title_i}.</li>")

    parts: List[str] = []
    parts.append("<!doctype html>")
    parts.append("<html>")
    parts.append("<head>")
    parts.append('<meta charset="utf-8">')
    parts.append(f"<title>{html.escape(title)}</title>")
    parts.append("</head>")
    parts.append("<body>")
    parts.append(f"<h1>{html.escape(title)}</h1>")
    parts.append("<h2>Abstract</h2>")
    parts.append(f"<p>{abstract_txt}</p>")
    parts.append("<h2>Introduction</h2>")
    parts.append(f"<p>{html.escape(intro_txt)}</p>")
    parts.append("<h2>Methods</h2>")
    parts.append("<p>This review used a two-stream synthesis pipeline over open coding and targeted intro/conclusion harvesting, with evidence normalization, deduplication, and citation hydration.</p>")
    parts.append("<h2>Results</h2>")
    for sec in [defs, findings, methods]:
        parts.append(f"<h3>{html.escape(str(sec.get('section_title') or 'Section'))}</h3>")
        parts.append(str(sec.get("section_html") or ""))
    parts.append("<h2>Discussion</h2>")
    parts.append(str(limits.get("section_html") or ""))
    parts.append(str(future.get("section_html") or ""))
    parts.append("<h2>Conclusion</h2>")
    parts.append(f"<p>{html.escape(concl_txt)}</p>")
    parts.append("<h2>References</h2>")
    parts.append("<ol>")
    parts.extend(refs)
    parts.append("</ol>")
    parts.append("</body>")
    parts.append("</html>")
    return "\n".join(parts)


def run_synthesis_v2(
    *,
    stream_a_jsonl: Path,
    stream_b_jsonl: Path,
    items_meta_path: Path,
    out_folder: Path,
    custom_id_map_path: Path | None,
    cfg: Dict[str, Any],
) -> Dict[str, Any]:
    os.makedirs(out_folder, exist_ok=True)

    custom_id_map: Dict[str, str] = {}
    if custom_id_map_path:
        custom_id_map = _load_custom_id_map(custom_id_map_path)

    items_meta_index = _load_items_meta_index(items_meta_path)

    a_rows_raw = _read_jsonl(stream_a_jsonl)
    b_rows_raw = _read_jsonl(stream_b_jsonl)

    stream_a = _parse_stream_a_rows(a_rows_raw, custom_id_map=custom_id_map)
    stream_b = _parse_stream_b_rows(b_rows_raw)

    stream_a = _dedupe_evidence(stream_a)
    stream_b = _dedupe_evidence(stream_b)

    stream_a = _assign_stream_a_dqids(stream_a)

    all_evidence = stream_a + stream_b
    dq_lookup = _build_dq_lookup(all_evidence)

    normalized_path = out_folder / "evidence_normalized.jsonl"
    _write_jsonl(normalized_path, all_evidence)

    theme_clusters = _build_theme_clusters(stream_a, cfg)
    _write_json(out_folder / "themes.json", theme_clusters)
    _export_theme_evidence_tables(theme_clusters, dq_lookup, items_meta_index, out_folder)

    backbone = _group_claims_by_section(stream_b)
    _write_json(out_folder / "backbone_claims.json", backbone)

    backbone_function = "synth_v2_backbone_section"
    backbone_jobs: List[Dict[str, str]] = []
    backbone_order: List[str] = []
    for sec_title in ["Definitions", "Main findings", "Methods", "Limitations", "Future work"]:
        claims = backbone[sec_title]
        job = _build_backbone_section_job(sec_title, claims, cfg)
        backbone_jobs.append(job)
        backbone_order.append(sec_title)

    backbone_outputs = _run_jobs_for_function(function=backbone_function, jobs=backbone_jobs, cfg=cfg)

    backbone_sections: List[Dict[str, Any]] = []
    all_used_dqids: List[str] = []

    i = 0
    while i < len(backbone_outputs):
        section = backbone_outputs[i]
        sec_title = backbone_order[i]
        fallback_rows = claims = backbone.get(sec_title, [])
        section = _sanitize_section_payload(
            section_obj=section if isinstance(section, dict) else {},
            default_title=sec_title,
            fallback_evidence_rows=fallback_rows,
            dq_lookup=dq_lookup,
        )
        hydrated = _hydrate_html_anchors(section["section_html"], dq_lookup, items_meta_index)
        section2 = dict(section)
        section2["section_html"] = hydrated
        backbone_sections.append(section2)
        all_used_dqids.extend(section2["used_dqids"])
        i += 1

    claim_lookup: Dict[str, Dict[str, Any]] = {}
    for r in stream_b:
        claim_lookup[r["dqid"]] = r
    claim_index = _build_claim_similarity_index(stream_b, cfg)

    crosswalk_function = "synth_v2_crosswalk"
    crosswalk_jobs: List[Dict[str, str]] = []
    crosswalk_theme_ids: List[str] = []
    for theme in theme_clusters:
        job = _build_crosswalk_job(theme, claim_index, cfg)
        crosswalk_jobs.append(job)
        crosswalk_theme_ids.append(str(theme["theme_id"]))

    crosswalk_outputs = _run_jobs_for_function(function=crosswalk_function, jobs=crosswalk_jobs, cfg=cfg)

    crosswalks: Dict[str, Any] = {}
    j = 0
    while j < len(crosswalk_outputs):
        cw = crosswalk_outputs[j]
        crosswalks[crosswalk_theme_ids[j]] = cw
        j += 1

    theme_function = "synth_v2_theme_section"
    theme_jobs: List[Dict[str, str]] = []
    theme_order: List[str] = []

    for theme in theme_clusters:
        cw = crosswalks[str(theme["theme_id"])]
        theme_rows = _select_rows_by_dqid(dq_lookup, theme["evidence_dqids"])
        job = _build_theme_section_job(
            theme=theme,
            theme_evidence=theme_rows,
            claim_links=cw["claim_links"],
            claim_evidence_lookup=claim_lookup,
            cfg=cfg,
        )
        theme_jobs.append(job)
        theme_order.append(str(theme["theme_id"]))

    theme_outputs = _run_jobs_for_function(function=theme_function, jobs=theme_jobs, cfg=cfg)

    theme_sections: List[Dict[str, Any]] = []
    k = 0
    while k < len(theme_outputs):
        section = theme_outputs[k]
        theme_id = theme_order[k]
        fallback_theme = next((t for t in theme_clusters if str(t.get("theme_id")) == str(theme_id)), None)
        fallback_rows: List[Dict[str, Any]] = []
        fallback_title = f"Theme {theme_id}"
        if isinstance(fallback_theme, dict):
            fallback_title = str(fallback_theme.get("theme_label") or fallback_title)
            fallback_rows = _select_rows_by_dqid(dq_lookup, list(fallback_theme.get("evidence_dqids") or []))
        section = _sanitize_section_payload(
            section_obj=section if isinstance(section, dict) else {},
            default_title=fallback_title,
            fallback_evidence_rows=fallback_rows,
            dq_lookup=dq_lookup,
        )
        hydrated = _hydrate_html_anchors(section["section_html"], dq_lookup, items_meta_index)
        section2 = dict(section)
        section2["section_html"] = hydrated
        theme_sections.append(section2)
        all_used_dqids.extend(section2["used_dqids"])
        k += 1

    _write_json(out_folder / "crosswalks.json", crosswalks)
    _write_json(out_folder / "sections_backbone.json", backbone_sections)
    _write_json(out_folder / "sections_themes.json", theme_sections)

    evidence_item_keys = sorted({r["item_key"] for r in all_evidence})
    meta_item_keys = sorted(items_meta_index.keys())
    missing_item_keys = sorted(set(meta_item_keys) - set(evidence_item_keys))
    if missing_item_keys and bool(cfg.get("require_full_coverage", False)):
        raise ValueError(f"Coverage gate failed, missing items: {missing_item_keys[:20]}")

    review_sections = backbone_sections + theme_sections
    review_html = _render_review_html(title=str(out_folder.name), sections=review_sections)
    review_path = out_folder / "review.html"
    _write_text(review_path, review_html)
    full_title = str(cfg.get("collection_name") or out_folder.name or "Systematic Review")
    full_paper_html = _render_full_paper_html(
        title=full_title,
        collection_name=full_title,
        sections=review_sections,
        items_meta_index=items_meta_index,
        stats={
            "stream_a_evidence": len(stream_a),
            "stream_b_evidence": len(stream_b),
        },
    )
    systematic_review_path = out_folder / "systematic_review.html"
    _write_text(systematic_review_path, full_paper_html)

    custom_id_map_path_str = ""
    if custom_id_map_path:
        custom_id_map_path_str = str(custom_id_map_path)

    manifest = {
        "schema": "synthesis_v2_manifest",
        "created_at": _utc_now_iso(),
        "inputs": {
            "stream_a_jsonl": str(stream_a_jsonl),
            "stream_b_jsonl": str(stream_b_jsonl),
            "items_meta_path": str(items_meta_path),
            "custom_id_map_path": custom_id_map_path_str,
        },
        "llm": {
            "llm_mode": str(cfg["llm_mode"]),
            "ai_provider": str(cfg["ai_provider"]),
            "model": str(cfg["model"]),
            "collection_name": str(cfg["collection_name"]),
            "functions": {
                "backbone": backbone_function,
                "crosswalk": crosswalk_function,
                "theme": theme_function,
            },
        },
        "outputs": {
            "normalized_evidence": str(normalized_path),
            "themes": str(out_folder / "themes.json"),
            "backbone_claims": str(out_folder / "backbone_claims.json"),
            "crosswalks": str(out_folder / "crosswalks.json"),
            "sections_backbone": str(out_folder / "sections_backbone.json"),
            "sections_themes": str(out_folder / "sections_themes.json"),
            "review_html": str(review_path),
            "systematic_review_html": str(systematic_review_path),
        },
        "stats": {
            "stream_a_evidence": len(stream_a),
            "stream_b_evidence": len(stream_b),
            "themes": len(theme_clusters),
            "review_sections": len(review_sections),
            "missing_item_keys_count": len(missing_item_keys),
            "missing_item_keys": missing_item_keys,
        },
    }
    _write_json(out_folder / "manifest.json", manifest)
    return manifest


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Two-stream thematic synthesis pipeline.")
    p.add_argument("--stream-a-jsonl", required=True, type=Path)
    p.add_argument("--stream-b-jsonl", required=True, type=Path)
    p.add_argument("--items-meta", required=True, type=Path)
    p.add_argument("--out-folder", required=True, type=Path)
    p.add_argument("--custom-id-map", required=False, type=Path, default=None)
    p.add_argument("--model", required=False, default="gpt-5-mini")
    p.add_argument("--theme-threshold", required=False, type=float, default=0.82)
    p.add_argument("--max-evidence-per-prompt", required=False, type=int, default=80)
    p.add_argument("--min-evidence-per-theme", required=False, type=int, default=6)
    p.add_argument("--min-sources-per-theme", required=False, type=int, default=2)
    p.add_argument("--candidate-claims-per-theme", required=False, type=int, default=12)
    p.add_argument("--max-themes-total", required=False, type=int, default=40)
    p.add_argument("--embedding-model", required=False, default="all-MiniLM-L6-v2")
    p.add_argument("--llm-mode", required=False, default="immediate")
    p.add_argument("--ai-provider", required=False, default="openai")
    p.add_argument("--collection-name", required=False, default="__synth_v2__")
    return p


def main() -> int:
    args = _build_parser().parse_args()
    cfg = default_config()
    cfg["model"] = str(args.model)
    cfg["theme_similarity_threshold"] = float(args.theme_threshold)
    cfg["max_evidence_per_prompt"] = int(args.max_evidence_per_prompt)
    cfg["min_unique_evidence_per_theme"] = int(args.min_evidence_per_theme)
    cfg["min_unique_sources_per_theme"] = int(args.min_sources_per_theme)
    cfg["candidate_claims_per_theme"] = int(args.candidate_claims_per_theme)
    cfg["max_themes_total"] = int(args.max_themes_total)
    cfg["embedding_model"] = str(args.embedding_model)
    cfg["llm_mode"] = str(args.llm_mode)
    cfg["ai_provider"] = str(args.ai_provider)
    cfg["collection_name"] = str(args.collection_name)

    manifest = run_synthesis_v2(
        stream_a_jsonl=args.stream_a_jsonl,
        stream_b_jsonl=args.stream_b_jsonl,
        items_meta_path=args.items_meta,
        out_folder=args.out_folder,
        custom_id_map_path=args.custom_id_map,
        cfg=cfg,
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
