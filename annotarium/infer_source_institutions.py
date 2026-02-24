#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
from pathlib import Path
from typing import Any


ALLOWED_SOURCE_TYPES = {
    "internal_document_section",
    "vendor_report",
    "government",
    "international_institution",
    "academic",
    "ngo",
    "press_media",
    "judicial",
    "other",
}


def _load_env_file() -> None:
    # Prefer local annotarium/.env when process env is missing.
    if os.getenv("OPENAI_API_KEY", "").strip():
        return
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.is_file():
        return
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            key = k.strip()
            val = v.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except Exception:
        return


def _infer_type_from_text(text: str) -> tuple[str, str, str]:
    low = text.lower()
    # Domain-specific rules first.
    if any(x in low for x in ("czzbb.net", "biao", "contract award", "procurement", "tender")):
        return "government", "Government Procurement / Administrative Source", "Government"
    if any(x in low for x in ("lw23.com", "ecice06.com", "paper.edu.cn", "journal", "quantization evaluation", "overlay file system")):
        return "academic", "Academic Publication / Repository", "Academic"
    if any(x in low for x in ("hbsh.org", "chamber of commerce")):
        return "ngo", "Business/Trade Association", "NGO / Association"

    if any(
        x in low
        for x in (
            "washington post", "washingtonpost.com",
            "nytimes", "nytimes.com",
            "the guardian", "theguardian.com",
            "reuters", "reuters.com",
            "apnews", "apnews.com",
            "bbc", "bbc.com",
            "cnn", "cnn.com",
            "wsj.com", "ft.com", "bloomberg.com",
        )
    ):
        return "press_media", "Press/Media", "Press/Media"
    if any(x in low for x in ("house.gov", ".gov", ".mil", "ministry", "department", "parliament", "congress", "government")):
        return "government", "Government Institution", "Government"
    if any(x in low for x in ("un.org", "nato.int", "europa.eu", "osce.org", "oecd.org", "international court")):
        return "international_institution", "International Institution", "International Institution"
    if any(x in low for x in ("rand.org", "rand corporation", "project2049", "brookings", "csis.org", "carnegie")):
        return "academic", "Think Tank / Policy Institute", "Think Tank / Policy Institute"
    if any(x in low for x in (".edu", "university", "journal", "proceedings", "doi", "springer", "ieee", "sciencedirect", "nature.com")):
        return "academic", "Academic Institution / Publication", "Academic"
    if any(x in low for x in ("court", "tribunal", "judgment", "judicial")):
        return "judicial", "Judicial Body", "Judicial"
    if any(x in low for x in ("ngo", "non-governmental", "human rights watch", "amnesty")):
        return "ngo", "Non-Governmental Organization", "NGO"
    return "other", "Referenced source", "Unknown venue"


def _build_prompt(source: dict[str, Any]) -> str:
    return (
        "Classify this citation source for cyber-attribution evidence quality.\n"
        "Return strict JSON with keys: source_type, entity_name, publication_or_venue, confidence_0_1, rationale_short.\n"
        "Allowed source_type values: "
        "internal_document_section, vendor_report, government, international_institution, academic, ngo, press_media, judicial, other.\n"
        f"source_id: {source.get('source_id','')}\n"
        f"title: {source.get('title','')}\n"
        f"url: {source.get('url_or_identifier','')}\n"
        f"entity_name: {source.get('entity_name','')}\n"
        f"publication_or_venue: {source.get('publication_or_venue','')}\n"
    )


def _parse_json_text(s: str) -> dict[str, Any] | None:
    text = (s or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _safe_response_text(resp: Any) -> str:
    txt = ""
    try:
        txt = getattr(resp, "output_text", "") or ""
    except Exception:
        txt = ""
    if txt:
        return txt
    # Fallback best-effort for SDK variants.
    try:
        out = getattr(resp, "output", None) or []
        chunks: list[str] = []
        for item in out:
            content = getattr(item, "content", None) or []
            for c in content:
                t = getattr(c, "text", None)
                if isinstance(t, str):
                    chunks.append(t)
        return "\n".join(chunks).strip()
    except Exception:
        return ""


def _infer_with_openai(source: dict[str, Any], use_web: bool) -> dict[str, Any] | None:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return None

    client = OpenAI(api_key=api_key)
    kwargs: dict[str, Any] = {
        "model": "gpt-5-mini",
        "input": _build_prompt(source),
    }
    if use_web:
        kwargs["tools"] = [{"type": "web_search_preview"}]
    try:
        resp = client.responses.create(**kwargs)
    except Exception:
        return None
    parsed = _parse_json_text(_safe_response_text(resp))
    return parsed


def _normalize_result(raw: dict[str, Any] | None, fallback_text: str) -> tuple[str, str, str, float]:
    if not isinstance(raw, dict):
        st, en, pv = _infer_type_from_text(fallback_text)
        return st, en, pv, 0.35
    st = str(raw.get("source_type", "")).strip().lower()
    if st not in ALLOWED_SOURCE_TYPES:
        st = "other"
    en = str(raw.get("entity_name", "")).strip() or "Referenced source"
    pv = str(raw.get("publication_or_venue", "")).strip() or "Unknown venue"
    try:
        conf = float(raw.get("confidence_0_1", 0.0))
    except Exception:
        conf = 0.0
    if conf < 0.0:
        conf = 0.0
    if conf > 1.0:
        conf = 1.0
    return st, en, pv, conf


def _needs_retry(st: str, conf: float) -> bool:
    return st in {"other", ""} or conf < 0.75


def _infer_source(source: dict[str, Any]) -> tuple[str, str, str, str]:
    text = " ".join(
        [
            str(source.get("title") or ""),
            str(source.get("url_or_identifier") or ""),
            str(source.get("entity_name") or ""),
            str(source.get("publication_or_venue") or ""),
        ]
    )

    # First pass: model only.
    first = _infer_with_openai(source, use_web=False)
    st, en, pv, conf = _normalize_result(first, text)
    strategy = "gpt-5-mini"

    # Retry with web tool when confidence/type is weak.
    if _needs_retry(st, conf):
        second = _infer_with_openai(source, use_web=True)
        st2, en2, pv2, conf2 = _normalize_result(second, text)
        if conf2 >= conf or (st == "other" and st2 != "other"):
            st, en, pv, conf = st2, en2, pv2, conf2
        strategy = "gpt-5-mini+web_search_fallback"

    if st not in ALLOWED_SOURCE_TYPES:
        st = "other"
    return st, en, pv, strategy


def _run_inference_on_extraction(extraction: dict[str, Any]) -> dict[str, Any]:
    stage1 = extraction.get("stage1_markdown_parse") or {}
    stage2 = extraction.get("stage2_claim_extraction") or {}
    globals_idx = stage1.get("global_indices") or {}
    sources = globals_idx.get("sources") or []
    if not isinstance(sources, list):
        return extraction

    changed = 0
    candidates: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for s in sources:
        if not isinstance(s, dict):
            continue
        sid = str(s.get("source_id") or "").strip()
        if not sid:
            continue
        by_id[sid] = s
        if str(s.get("source_type") or "") == "internal_document_section":
            continue
        cur_type = str(s.get("source_type") or "").strip()
        cur_entity = str(s.get("entity_name") or "").strip().lower()
        cur_venue = str(s.get("publication_or_venue") or "").strip().lower()
        needs_inference = (
            cur_type in {"", "other"}
            or cur_entity in {"", "referenced source"}
            or cur_venue in {"", "unknown venue"}
        )
        if not needs_inference:
            continue
        candidates.append(s)

    batch_mode = str(os.getenv("ANNOTARIUM_OPENAI_BATCH", "")).strip().lower() in {"1", "true", "yes", "on"}
    max_workers = 4
    try:
        max_workers = max(1, int(os.getenv("ANNOTARIUM_OPENAI_BATCH_WORKERS", "4")))
    except Exception:
        max_workers = 4

    def apply_inference(s: dict[str, Any]) -> tuple[str, str, str, str]:
        return _infer_source(s)

    if batch_mode and len(candidates) > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(max_workers, len(candidates))) as ex:
            future_map = {ex.submit(apply_inference, s): s for s in candidates}
            for fut in concurrent.futures.as_completed(future_map):
                s = future_map[fut]
                st, en, pv, strategy = fut.result()
                if st != str(s.get("source_type") or "") or en != str(s.get("entity_name") or "") or pv != str(s.get("publication_or_venue") or ""):
                    changed += 1
                s["source_type"] = st
                s["entity_name"] = en
                s["publication_or_venue"] = pv
                notes = str(s.get("notes") or "")
                marker = f"[institution_inference:{strategy}]"
                s["notes"] = notes if marker in notes else ((notes + " " if notes else "") + marker)
    else:
        for s in candidates:
            st, en, pv, strategy = apply_inference(s)
            if st != str(s.get("source_type") or "") or en != str(s.get("entity_name") or "") or pv != str(s.get("publication_or_venue") or ""):
                changed += 1
            s["source_type"] = st
            s["entity_name"] = en
            s["publication_or_venue"] = pv
            notes = str(s.get("notes") or "")
            marker = f"[institution_inference:{strategy}]"
            s["notes"] = notes if marker in notes else ((notes + " " if notes else "") + marker)

    # Keep stage2 document-level sources synchronized.
    dli = stage2.get("document_level_index") or {}
    dli_sources = dli.get("sources")
    if isinstance(dli_sources, list):
        for s in dli_sources:
            if not isinstance(s, dict):
                continue
            sid = str(s.get("source_id") or "").strip()
            if sid and sid in by_id:
                master = by_id[sid]
                s["source_type"] = master.get("source_type")
                s["entity_name"] = master.get("entity_name")
                s["publication_or_venue"] = master.get("publication_or_venue")
                s["notes"] = master.get("notes")

    extraction.setdefault("pipeline_config", {})
    extraction["pipeline_config"]["institution_inference"] = {
        "enabled": True,
        "model": "gpt-5-mini",
        "web_fallback": True,
        "batch_mode": bool(batch_mode),
        "batch_workers": int(max_workers),
        "sources_changed": changed,
    }
    return extraction


def main() -> int:
    _load_env_file()
    ap = argparse.ArgumentParser(description="Infer institution/source class with gpt-5-mini (+ web fallback).")
    ap.add_argument("--input", required=True, help="Extraction JSON path (in-place if --output omitted).")
    ap.add_argument("--output", default="", help="Optional output path. Defaults to in-place overwrite.")
    args = ap.parse_args()

    in_path = Path(args.input).expanduser().resolve()
    out_path = Path(args.output).expanduser().resolve() if args.output else in_path

    root = json.loads(in_path.read_text(encoding="utf-8"))
    updated = _run_inference_on_extraction(root)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "input": str(in_path), "output": str(out_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
