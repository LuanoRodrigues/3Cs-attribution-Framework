from __future__ import annotations

import argparse
import ast
import html
import json
import multiprocessing
import re
import sys
import hashlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

CITATION_STYLE_ALIASES = {
    "apa": "apa",
    "author_year": "apa",
    "numeric": "numeric",
    "endnote": "endnote",
    "parenthetical_footnote": "parenthetical_footnote",
    "parenthal_footnote": "parenthetical_footnote",
    "parenthal footnote": "parenthetical_footnote",
}

_DATASET_PDF_INDEX: dict[str, Path] | None = None
_DATASET_BASENAME_INDEX: dict[str, list[Path]] | None = None
_DATASET_STORAGE_INDEX: dict[str, list[Path]] | None = None
_PDF_PAGES_CACHE: dict[str, list[tuple[int, str]]] = {}
_QUOTE_PAGE_CACHE: dict[str, int] = {}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _normalize_for_match(text: str) -> str:
    t = str(text or "").lower()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"[^\w\s]", "", t)
    return t.strip()


def _canonical_pdf_path(value: str) -> str:
    p = str(value or "").strip()
    if not p:
        return ""
    p = p.replace("\\", "/")
    m = re.match(r"^/mnt/([a-zA-Z])/(.*)$", p)
    if m:
        drive = m.group(1).upper()
        rest = m.group(2)
        p = f"{drive}:/{rest}"
    return p.lower()


def _extract_storage_key(value: str) -> str:
    p = str(value or "").replace("\\", "/")
    m = re.search(r"/storage/([A-Za-z0-9]{8})/", p)
    return (m.group(1).upper() if m else "")


def _build_dataset_pdf_index() -> tuple[dict[str, Path], dict[str, list[Path]], dict[str, list[Path]]]:
    global _DATASET_PDF_INDEX, _DATASET_BASENAME_INDEX, _DATASET_STORAGE_INDEX
    if _DATASET_PDF_INDEX is not None and _DATASET_BASENAME_INDEX is not None and _DATASET_STORAGE_INDEX is not None:
        return _DATASET_PDF_INDEX, _DATASET_BASENAME_INDEX, _DATASET_STORAGE_INDEX
    pdf_map: dict[str, Path] = {}
    base_map: dict[str, list[Path]] = {}
    storage_map: dict[str, list[Path]] = {}
    ds_dir = _repo_root() / "python_backend_legacy" / "dataset"
    if ds_dir.is_dir():
        for fp in ds_dir.glob("*.json"):
            try:
                data = json.loads(fp.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            pdf_path = str(data.get("pdf_path") or "").strip()
            if not pdf_path:
                continue
            pdf_map[pdf_path] = fp
            canon = _canonical_pdf_path(pdf_path)
            if canon:
                pdf_map[canon] = fp
            base = Path(pdf_path).name.lower()
            base_map.setdefault(base, []).append(fp)
            storage_key = _extract_storage_key(pdf_path)
            if storage_key:
                storage_map.setdefault(storage_key, []).append(fp)
    _DATASET_PDF_INDEX = pdf_map
    _DATASET_BASENAME_INDEX = base_map
    _DATASET_STORAGE_INDEX = storage_map
    return pdf_map, base_map, storage_map


def _load_pdf_pages_from_dataset(pdf_path: str) -> list[tuple[int, str]]:
    key = str(pdf_path or "").strip()
    if not key:
        return []
    if key in _PDF_PAGES_CACHE:
        return _PDF_PAGES_CACHE[key]
    pdf_map, base_map, storage_map = _build_dataset_pdf_index()
    source = pdf_map.get(key) or pdf_map.get(_canonical_pdf_path(key))
    if source is None:
        candidates = base_map.get(Path(key).name.lower(), [])
        source = candidates[0] if len(candidates) == 1 else None
    if source is None:
        storage_key = _extract_storage_key(key)
        sc = storage_map.get(storage_key, []) if storage_key else []
        source = sc[0] if len(sc) == 1 else None
    pages: list[tuple[int, str]] = []
    if source and source.is_file():
        try:
            data = json.loads(source.read_text(encoding="utf-8"))
            body = (((data.get("response") or {}).get("response") or {}).get("body") or {}) if isinstance(data, dict) else {}
            raw_pages = body.get("pages")
            if isinstance(raw_pages, list):
                for i, page in enumerate(raw_pages, start=1):
                    if not isinstance(page, dict):
                        continue
                    md = str(page.get("markdown") or "").strip()
                    if md:
                        pages.append((i, md))
        except Exception:
            pages = []
    _PDF_PAGES_CACHE[key] = pages
    return pages


def _find_quote_page(pdf_path: str, quote: str) -> int | None:
    q = str(quote or "").strip()
    if not q:
        return None
    cache_key = f"{pdf_path}::{hashlib.sha1(q.encode('utf-8', errors='ignore')).hexdigest()[:16]}"
    if cache_key in _QUOTE_PAGE_CACHE:
        return _QUOTE_PAGE_CACHE[cache_key]
    pages = _load_pdf_pages_from_dataset(pdf_path)
    if not pages:
        return None
    qnorm = _normalize_for_match(q.replace("...", " "))
    if not qnorm:
        return None
    # direct contains
    for page_no, text in pages:
        tnorm = _normalize_for_match(text)
        if qnorm in tnorm:
            _QUOTE_PAGE_CACHE[cache_key] = page_no
            return page_no
    # prefix contains for very long extracts
    prefix = qnorm[:220]
    if len(prefix) > 40:
        for page_no, text in pages:
            if prefix in _normalize_for_match(text):
                _QUOTE_PAGE_CACHE[cache_key] = page_no
                return page_no
    # token-overlap heuristic
    tokens = [t for t in re.findall(r"\w+", qnorm) if len(t) > 3][:18]
    if len(tokens) >= 6:
        for page_no, text in pages:
            tnorm = _normalize_for_match(text)
            hit = sum(1 for tok in tokens if tok in tnorm)
            if hit >= max(6, int(len(tokens) * 0.75)):
                _QUOTE_PAGE_CACHE[cache_key] = page_no
                return page_no
    return None


def _append_page_to_apa_citation(citation: str, page_no: int | None) -> str:
    c = str(citation or "").strip()
    if not c or page_no is None:
        return c
    if ", p." in c or ", pp." in c:
        return c
    if c.startswith("(") and c.endswith(")"):
        return c[:-1] + f", p. {int(page_no)})"
    return f"{c}, p. {int(page_no)}"


def _source_url_from_metadata(metadata: dict[str, Any]) -> str:
    if not isinstance(metadata, dict):
        return ""
    zot = metadata.get("zotero_metadata", {})
    if isinstance(zot, dict):
        url = str(zot.get("url") or "").strip()
        if url:
            return url
    doi = ""
    if isinstance(zot, dict):
        doi = str(zot.get("doi") or "").strip()
    if not doi:
        doi = str(metadata.get("doi") or "").strip()
    if doi:
        return f"https://doi.org/{doi}"
    pdf_path = str(metadata.get("pdf_path") or "").strip()
    if pdf_path:
        norm = pdf_path.replace("\\", "/")
        return f"file://{norm}"
    return ""


def _load_call_models_zt():
    repo_root = _repo_root()
    llms_dir = repo_root / "python_backend_legacy" / "llms"
    if str(llms_dir) not in sys.path:
        sys.path.insert(0, str(llms_dir))
    from calling_models import call_models_zt  # type: ignore

    return call_models_zt


def _call_models_worker(kwargs: dict[str, Any], q: multiprocessing.Queue) -> None:
    try:
        call_models_zt = _load_call_models_zt()
        result = call_models_zt(**kwargs)
        q.put({"ok": True, "result": result})
    except Exception as exc:  # pragma: no cover - subprocess path
        q.put({"ok": False, "error": repr(exc)})


def _call_models_with_timeout(*, timeout_s: int, kwargs: dict[str, Any]) -> Any:
    if int(timeout_s) <= 0:
        call_models_zt = _load_call_models_zt()
        return call_models_zt(**kwargs)

    q: multiprocessing.Queue = multiprocessing.Queue(maxsize=1)
    p = multiprocessing.Process(target=_call_models_worker, args=(kwargs, q))
    p.start()
    p.join(timeout=max(1, int(timeout_s)))
    if p.is_alive():
        p.terminate()
        p.join(3)
        raise TimeoutError(f"Timed out after {timeout_s}s")
    if not q.empty():
        msg = q.get()
        if msg.get("ok"):
            return msg.get("result")
        raise RuntimeError(f"Model worker error: {msg.get('error')}")
    if p.exitcode not in (0, None):
        raise RuntimeError(f"Model worker exited with code {p.exitcode}")
    raise RuntimeError("Model worker returned no payload.")


def _call_models_single_batch_section(*, kwargs: dict[str, Any]) -> Any:
    call_models_zt = _load_call_models_zt()
    function_name = str(kwargs.get("function") or "").strip()
    collection_name = str(kwargs.get("collection_name") or "").strip()
    custom_id = str(kwargs.get("custom_id") or "").strip()
    if not function_name or not collection_name:
        raise ValueError("Missing function/collection_name for single-batch section call.")
    if not custom_id:
        raise ValueError("Missing custom_id for single-batch section call.")
    # 1) clear prior files for this section batch to avoid duplicate custom_id collisions on reruns
    repo_root = _repo_root()
    llms_dir = repo_root / "python_backend_legacy" / "llms"
    if str(llms_dir) not in sys.path:
        sys.path.insert(0, str(llms_dir))
    import calling_models as cm  # type: ignore

    unique_tail = custom_id[-10:]
    batch_collection_name = f"{collection_name}__{unique_tail}"
    safe_collection = cm.safe_name(batch_collection_name) if hasattr(cm, "safe_name") else re.sub(r"[^A-Za-z0-9._-]+", "_", batch_collection_name)
    safe_function = cm.safe_name(function_name) if hasattr(cm, "safe_name") else re.sub(r"[^A-Za-z0-9._-]+", "_", function_name)
    batch_root = cm.get_batch_root() if hasattr(cm, "get_batch_root") else (repo_root / "tmp" / "batching_files" / "batches")
    func_dir = Path(batch_root) / safe_function
    for suffix in ("input.jsonl", "output.jsonl", "batch_metadata.json"):
        fp = func_dir / f"{safe_collection}_{safe_function}_{suffix}"
        try:
            if fp.exists():
                fp.unlink()
        except Exception:
            pass

    # 2) enqueue one request
    _ = call_models_zt(
        text=str(kwargs.get("text") or ""),
        function=function_name,
        custom_id=custom_id,
        collection_name=batch_collection_name,
        model=str(kwargs.get("model") or "gpt-5-mini"),
        ai=str(kwargs.get("ai") or "openai"),
        read=False,
        store_only=True,
        cache=False,
    )
    # 3) process that function+collection batch
    safe_section_title = safe_collection
    ok = cm._process_batch_for(
        analysis_key_suffix=function_name,
        section_title=safe_section_title,
        poll_interval=30,
    )
    if ok is not True:
        raise RuntimeError(f"Batch processing failed for section function={function_name} collection={collection_name}")
    # 4) read the same custom_id result directly from output JSONL (non-interactive)
    output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
    res = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
    if res is None:
        raise RuntimeError(f"No batch output row matched custom_id={custom_id} in {output_file}")
    return res


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return int(default)


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    return cleaned or "collection"


def _resolve_collection_label(raw_name: str) -> str:
    name = str(raw_name or "").strip()
    if not name:
        return "frameworks"
    if name.lower().startswith("batch_"):
        return "frameworks"
    return name


def _stable_section_custom_id(collection_name: str, section_name: str, prompt: str) -> str:
    digest = hashlib.sha1(prompt.encode("utf-8", errors="ignore")).hexdigest()[:16]
    base = _safe_name(collection_name)
    return f"sr_{base}_{section_name}_{digest}"


def _load_json(path_obj: Path) -> dict[str, Any]:
    with path_obj.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"Expected dict JSON at {path_obj}, got {type(data).__name__}")
    return data


def _compute_theme_counts(summary: dict[str, Any]) -> dict[str, int]:
    # Figure themes are computed from section-level open coding only.
    # Explicitly exclude intro/conclusion core claims to avoid document-level bias in frequency bars.
    output = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    npath = Path(str(output.get("normalized_results_path") or "")).expanduser()
    counts: dict[str, int] = {}
    if npath.is_file():
        try:
            raw = json.loads(npath.read_text(encoding="utf-8"))
        except Exception:
            raw = {}
        if isinstance(raw, dict):
            for item_payload in raw.values():
                if not isinstance(item_payload, dict):
                    continue
                # Per item, choose one section-level source to avoid double-counting duplicated mirrors.
                source_rows: list[dict[str, Any]] = []
                for arr_key in ("code_pdf_page", "section_open_coding", "evidence_list"):
                    arr = item_payload.get(arr_key)
                    if isinstance(arr, list) and arr:
                        source_rows = [x for x in arr if isinstance(x, dict)]
                        if source_rows:
                            break
                for row in source_rows:
                    candidates: list[dict[str, Any]] = []
                    nested = row.get("evidence")
                    if isinstance(nested, list):
                        candidates.extend([ev for ev in nested if isinstance(ev, dict)])
                    else:
                        candidates.append(row)
                    for ev in candidates:
                        theme = ""
                        themes = ev.get("potential_themes")
                        if isinstance(themes, list) and themes:
                            theme = str(themes[0] or "").strip()
                        if not theme:
                            theme = str(ev.get("evidence_type") or "").strip() or "uncategorized"
                        counts[theme] = counts.get(theme, 0) + 1
            return dict(sorted(counts.items(), key=lambda kv: kv[1], reverse=True))

    # Fallback to exported synthesis theme inventory if normalized source is unavailable.
    themes_export = output.get("themes_export", {}) if isinstance(output.get("themes_export"), dict) else {}
    per_rq = themes_export.get("per_rq", {}) if isinstance(themes_export.get("per_rq"), dict) else {}
    for rq_data in per_rq.values():
        if not isinstance(rq_data, dict):
            continue
        inventory = rq_data.get("inventory_index", {})
        if not isinstance(inventory, dict):
            continue
        for item in inventory.values():
            if not isinstance(item, dict):
                continue
            theme = str(item.get("theme") or "").strip()
            if not theme:
                continue
            counts[theme] = counts.get(theme, 0) + _safe_int(item.get("count"), default=0)
    return dict(sorted(counts.items(), key=lambda kv: kv[1], reverse=True))


def _rq_findings_lines(summary: dict[str, Any]) -> list[str]:
    output = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    themes_export = output.get("themes_export", {}) if isinstance(output.get("themes_export"), dict) else {}
    per_rq = themes_export.get("per_rq", {}) if isinstance(themes_export.get("per_rq"), dict) else {}
    lines: list[str] = []
    for rq_key, rq_data in sorted(per_rq.items()):
        if not isinstance(rq_data, dict):
            continue
        inventory = rq_data.get("inventory_index", {})
        if not isinstance(inventory, dict):
            continue
        top = sorted(
            (
                (str(v.get("theme") or "unlabeled_theme"), _safe_int(v.get("count"), default=0))
                for v in inventory.values()
                if isinstance(v, dict)
            ),
            key=lambda x: x[1],
            reverse=True,
        )[:5]
        if top:
            lines.append(f"{rq_key}: " + ", ".join(f"{theme} ({count})" for theme, count in top))
    return lines


def _svg_bar_chart(title: str, labels: list[str], values: list[int], width: int = 980, height: int = 520) -> str:
    pad_l, pad_r, pad_t, pad_b = 120, 40, 60, 90
    chart_w = width - pad_l - pad_r
    chart_h = height - pad_t - pad_b
    max_v = max(values) if values else 1
    bar_h = max(14, int(chart_h / max(len(values), 1) * 0.62))
    gap = max(8, int((chart_h - bar_h * len(values)) / max(len(values), 1)))

    rows = []
    y = pad_t
    for label, value in zip(labels, values):
        bar_w = int((value / max_v) * chart_w) if max_v > 0 else 0
        rows.append(
            f"<text x='{pad_l - 8}' y='{y + bar_h - 2}' text-anchor='end' font-size='13' fill='#1f2937'>{html.escape(label)}</text>"
            f"<rect x='{pad_l}' y='{y}' width='{bar_w}' height='{bar_h}' fill='#2563eb' opacity='0.88'/>"
            f"<text x='{pad_l + bar_w + 8}' y='{y + bar_h - 2}' font-size='13' fill='#111827'>{value}</text>"
        )
        y += bar_h + gap

    return (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>"
        f"<rect width='100%' height='100%' fill='#f8fafc'/>"
        f"<text x='{width/2}' y='34' text-anchor='middle' font-size='22' fill='#0f172a' font-weight='600'>{html.escape(title)}</text>"
        f"<line x1='{pad_l}' y1='{pad_t + chart_h + 4}' x2='{pad_l + chart_w}' y2='{pad_t + chart_h + 4}' stroke='#334155' stroke-width='1'/>"
        + "".join(rows)
        + "</svg>"
    )


def _svg_prisma(counts: dict[str, int], width: int = 980, height: int = 730) -> str:
    c_db = _safe_int(counts.get("db"), 0)
    c_dup = _safe_int(counts.get("dup"), 0)
    c_screen = _safe_int(counts.get("screen"), 0)
    c_screen_ex = _safe_int(counts.get("screen_ex"), 0)
    c_full = _safe_int(counts.get("full"), 0)
    c_full_ex = _safe_int(counts.get("full_ex"), 0)
    c_inc = _safe_int(counts.get("included"), 0)

    def box(x: int, y: int, w: int, h: int, title: str, line2: str) -> str:
        return (
            f"<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='8' fill='#eef2ff' stroke='#1d4ed8' stroke-width='1.5'/>"
            f"<text x='{x + w/2}' y='{y + 28}' text-anchor='middle' font-size='15' fill='#1e3a8a' font-weight='600'>{html.escape(title)}</text>"
            f"<text x='{x + w/2}' y='{y + 56}' text-anchor='middle' font-size='14' fill='#0f172a'>{html.escape(line2)}</text>"
        )

    def arrow(x1: int, y1: int, x2: int, y2: int) -> str:
        return (
            f"<line x1='{x1}' y1='{y1}' x2='{x2}' y2='{y2}' stroke='#334155' stroke-width='2'/>"
            f"<polygon points='{x2},{y2} {x2-8},{y2-4} {x2-8},{y2+4}' fill='#334155'/>"
        )

    return (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>"
        f"<rect width='100%' height='100%' fill='#ffffff'/>"
        f"<text x='{width/2}' y='36' text-anchor='middle' font-size='26' fill='#0f172a' font-weight='700'>PRISMA Flow Diagram</text>"
        + box(320, 80, 340, 86, "Records identified", f"n = {c_db}")
        + box(320, 200, 340, 86, "Duplicates removed", f"n = {c_dup}")
        + box(320, 320, 340, 86, "Records screened", f"n = {c_screen}")
        + box(320, 440, 340, 86, "Full texts assessed", f"n = {c_full}")
        + box(320, 560, 340, 86, "Studies included", f"n = {c_inc}")
        + box(700, 320, 230, 86, "Excluded at screening", f"n = {c_screen_ex}")
        + box(700, 440, 230, 86, "Excluded at full text", f"n = {c_full_ex}")
        + arrow(490, 166, 490, 200)
        + arrow(490, 286, 490, 320)
        + arrow(490, 406, 490, 440)
        + arrow(490, 526, 490, 560)
        + arrow(660, 363, 700, 363)
        + arrow(660, 483, 700, 483)
        + "</svg>"
    )


def _extract_llm_text(raw_response: Any) -> str:
    def _from_string(value: str) -> str:
        s = str(value or "").strip()
        if not s:
            return ""
        # Some batch read paths can stringify as: ('<html...>', {'input tokens': ...})
        if s.startswith("(") and s.endswith(")") and "input tokens" in s and "output tokens" in s:
            try:
                parsed = ast.literal_eval(s)
                if isinstance(parsed, tuple) and parsed and isinstance(parsed[0], str):
                    s = parsed[0]
            except Exception:
                pass
        return s.strip()

    if isinstance(raw_response, str):
        return _from_string(raw_response)
    if isinstance(raw_response, (list, tuple)):
        for part in raw_response:
            txt = _extract_llm_text(part)
            if txt:
                return txt
        return ""
    if isinstance(raw_response, dict):
        if isinstance(raw_response.get("result"), dict):
            nested = raw_response.get("result")
            if isinstance(nested, dict):
                return _extract_llm_text(nested)
        if isinstance(raw_response.get("response"), str):
            return str(raw_response["response"]).strip()
        if isinstance(raw_response.get("response"), dict):
            nested_resp = raw_response.get("response")
            if isinstance(nested_resp, dict):
                return _extract_llm_text(nested_resp)
        for key in ("content", "text", "result"):
            if isinstance(raw_response.get(key), str):
                return _from_string(str(raw_response[key]))
    return _from_string(str(raw_response))


def _clean_llm_html(text: str) -> str:
    cleaned = str(text or "").strip()
    cleaned = cleaned.replace("\\r\\n", "\n").replace("\\n", "\n")
    cleaned = re.sub(
        r"\s*['\"]?\s*,\s*\{['\"]input tokens['\"].*?['\"]is batch['\"]\s*:\s*(?:True|False)\}\)\s*$",
        "",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    cleaned = re.sub(r"^\(\s*(['\"])(.*)\1\s*,\s*\{.*\}\s*\)\s*$", r"\2", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"^```(?:html)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _html_to_text(value: str) -> str:
    txt = re.sub(r"<[^>]+>", " ", str(value or ""))
    txt = html.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt


def _word_count_html(value: str) -> int:
    text = _html_to_text(value)
    if not text:
        return 0
    return len(re.findall(r"\b\w+\b", text))


def _humanize_theme_tokens(text: str) -> str:
    def _repl(m: re.Match[str]) -> str:
        token = m.group(0)
        if token.startswith(("http_", "https_", "data_", "aria_")):
            return token
        return token.replace("_", " ")

    return re.sub(r"\b[a-z][a-z0-9]+(?:_[a-z0-9]+)+\b", _repl, str(text or ""))


def _clean_and_humanize_section_html(section_html: str) -> str:
    out = _clean_llm_html(_extract_llm_text(section_html))
    out = _humanize_theme_tokens(out)
    out = re.sub(r"<p>\s*<p>", "<p>", out, flags=re.IGNORECASE)
    out = re.sub(r"</p>\s*</p>", "</p>", out, flags=re.IGNORECASE)
    out = re.sub(r"(?:<br\s*/?>\s*){3,}", "<br/><br/>", out, flags=re.IGNORECASE)
    # Guard against tuple-wrapper leftovers that can survive malformed cache payloads.
    out = re.sub(r"^\s*\(\s*['\"]\s*", "", out)
    out = re.sub(r"\s*['\"]\s*\)\s*$", "", out)
    return out.strip()


def _validate_section_html(section_name: str, html_text: str, *, min_words: int, max_words: int, forbid_h4: bool = False) -> None:
    wc = _word_count_html(html_text)
    if wc < int(min_words) or wc > int(max_words):
        raise RuntimeError(f"Section '{section_name}' word count {wc} outside range [{min_words}, {max_words}].")
    if forbid_h4 and re.search(r"<h[1-6]\b", html_text, flags=re.IGNORECASE):
        raise RuntimeError(f"Section '{section_name}' must not contain subsection headings.")
    if re.search(r"<p[^>]*>\s*<h[1-6]\b", html_text, flags=re.IGNORECASE):
        raise RuntimeError(f"Section '{section_name}' has invalid heading nested inside paragraph.")
    if re.search(r"<p[^>]*>\s*<p\b", html_text, flags=re.IGNORECASE):
        raise RuntimeError(f"Section '{section_name}' has nested paragraph tags.")


def _validate_style_rules(section_name: str, html_text: str) -> None:
    low = str(html_text or "").lower()

    # Abstract/introduction/conclusion must be paragraph prose only.
    if section_name in {"abstract", "introduction", "conclusion"}:
        if re.search(r"<h[1-6]\b", low):
            raise RuntimeError(f"Section '{section_name}' must not contain headings.")
        if re.search(r"<(ul|ol|li)\b", low):
            raise RuntimeError(f"Section '{section_name}' must not contain bullet/numbered lists.")

    # Methods/results/discussion text should read like publication prose, not prompt/meta commentary.
    formal_sections = {
        "search_strategy",
        "study_selection_methods",
        "data_extraction_methods",
        "risk_of_bias_methods",
        "data_synthesis_methods",
        "narrative_synthesis",
        "discussion",
        "limitations",
    }
    if section_name in formal_sections:
        banned = [
            r"\bprovided context\b",
            r"\bcontext json\b",
            r"\bwhole_paper\b",
            r"\bas an ai\b",
            r"\bi cannot\b",
            r"\binsufficient data\b",
            r"\bprompt\b",
            r"\bplaceholder\b",
            r"\btbd\b",
        ]
        for pat in banned:
            if re.search(pat, low, flags=re.IGNORECASE):
                raise RuntimeError(f"Section '{section_name}' contains non-publication phrase matching /{pat}/.")


def _validate_generated_section(section_name: str, section_html: str, cfg: dict[str, Any]) -> None:
    _validate_section_html(
        section_name,
        section_html,
        min_words=int(cfg["min"]),
        max_words=int(cfg["max"]),
        forbid_h4=bool(cfg.get("forbid_h4", False)),
    )
    _validate_style_rules(section_name, section_html)


@dataclass
class PipelineResult:
    output_html_path: Path
    context_json_path: Path
    prisma_svg_path: Path
    themes_svg_path: Path


def _assert_non_placeholder_html(rendered: str) -> None:
    unresolved = re.findall(r"(\{\{[^}]+\}\}|\{%[^%]+%\})", rendered)
    if unresolved:
        raise RuntimeError(f"Rendered HTML still contains unresolved template tokens: {unresolved[:5]}")
    lowered = rendered.lower()
    if re.search(r"<[^>]+class=\"[^\"]*placeholder-note[^\"]*\"", lowered) or re.search(
        r"<[^>]+class=\"[^\"]*ai-placeholder[^\"]*\"", lowered
    ):
        raise RuntimeError("Rendered HTML contains placeholder elements.")
    if "full search strategy appendix not provided" in lowered:
        raise RuntimeError("Rendered HTML indicates missing search strategy appendix.")
    if "could not be generated" in lowered and "ai-generated" in lowered:
        raise RuntimeError("Rendered HTML indicates missing AI-generated section.")
    if re.search(r"\[[^\]]*(placeholder|pending|n\/a|tbd|to be completed)[^\]]*\]", lowered, flags=re.IGNORECASE):
        raise RuntimeError("Rendered HTML contains unresolved editorial placeholders.")


def _assert_reference_and_postprocess_integrity(rendered: str, *, citation_style: str = "apa") -> None:
    text = str(rendered or "")
    normalized_style = _normalize_citation_style(citation_style)
    checks: list[tuple[str, str]] = [
        (r"\(Unknown,\s*n\.d\.\)", "Rendered HTML contains unresolved in-text citations '(Unknown, n.d.)'."),
        (r"Unresolved source metadata", "Rendered HTML contains unresolved reference metadata."),
        (r"input tokens", "Rendered HTML contains leaked token-usage diagnostics."),
        (r"output tokens", "Rendered HTML contains leaked token-usage diagnostics."),
        (r"\('(?:.|\n){0,800}?\{['\"]input tokens['\"]", "Rendered HTML contains tuple-style serialized model output."),
        (r"\(\s*['\"]\s*<p", "Rendered HTML contains tuple-style prefix before paragraph HTML."),
    ]
    for pattern, message in checks:
        if re.search(pattern, text, flags=re.IGNORECASE):
            raise RuntimeError(message)
    if normalized_style == "numeric":
        if not re.search(r"<a[^>]*class=\"dqid-cite\"[^>]*>\[\d+\]</a>", text):
            raise RuntimeError("Numeric citation style selected but numeric in-text citations were not found.")
    elif normalized_style == "endnote":
        if not re.search(r"<a[^>]*class=\"dqid-cite\"[^>]*><sup>\d+</sup></a>", text):
            raise RuntimeError("Endnote citation style selected but superscript in-text citations were not found.")
    elif normalized_style == "parenthetical_footnote":
        if not re.search(r"<a[^>]*class=\"dqid-cite\"[^>]*>\(see note \d+\)</a>", text, flags=re.IGNORECASE):
            raise RuntimeError("Parenthetical footnote style selected but '(see note n)' in-text citations were not found.")
    else:
        if re.search(r"<a[^>]*class=\"dqid-cite\"[^>]*>\[\d+\]</a>", text):
            raise RuntimeError("APA citation style selected but numeric in-text citations were found.")


def _replace_subsection_content(rendered: str, heading: str, body_html: str) -> str:
    pattern = re.compile(
        rf"(<h3>\s*{re.escape(heading)}\s*</h3>\s*<div class=\"subsection-content\">)(.*?)(</div>)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    replacement = rf"\1\n{body_html}\n  \3"
    new_rendered, n = pattern.subn(replacement, rendered, count=1)
    if n == 0:
        raise RuntimeError(f"Could not locate subsection block for '{heading}'.")
    return new_rendered


def _replace_references_block(rendered: str, references_html_items: str) -> str:
    pattern = re.compile(
        r"(<h2>7\.\s*References</h2>\s*<div id=\"references\" class=\"section-content\">.*?<ol>)(.*?)(</ol>)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    new_rendered, n = pattern.subn(rf"\1\n{references_html_items}\n  \3", rendered, count=1)
    if n == 0:
        raise RuntimeError("Could not locate references list block.")
    return new_rendered


def _append_references_notes_block(rendered: str, notes_html: str) -> str:
    if not notes_html.strip():
        return rendered
    pattern = re.compile(
        r"(<h2>7\.\s*References</h2>\s*<div id=\"references\" class=\"section-content\">)(.*?)(</div>)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    m = pattern.search(rendered)
    if not m:
        raise RuntimeError("Could not locate references block for notes insertion.")
    start, body, end = m.group(1), m.group(2), m.group(3)
    replacement = f"{start}{body}\n{notes_html}\n{end}"
    return rendered[: m.start()] + replacement + rendered[m.end() :]


def _strip_editorial_brackets(rendered: str) -> str:
    patterns = [
        r"\[Link to PRISMA Statement if desired\]",
        r"\[Refer to Appendix for detailed table if needed\]",
        r"\[Refer to Appendix for detailed assessments per study\]",
        r"\[Mention tool/template if applicable\]",
        r"\[If applicable, add registration number\]",
    ]
    out = rendered
    for pat in patterns:
        out = re.sub(pat, "", out, flags=re.IGNORECASE)
    return out


def _build_reference_records(summary: dict[str, Any]) -> list[dict[str, str]]:
    out = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    npath = Path(str(out.get("normalized_results_path") or "")).expanduser()
    if not npath.is_file():
        raise RuntimeError("Missing normalized_results_path for references generation.")
    raw = json.loads(npath.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError("No normalized results available for references generation.")

    def _normalize_creator_name(creator: Any) -> str:
        if isinstance(creator, dict):
            last = str(creator.get("lastName") or "").strip()
            if last:
                return last
            name = str(creator.get("name") or "").strip()
            if name:
                return name
        s = str(creator or "").strip()
        if not s:
            return ""
        parts = s.replace(",", " ").split()
        return parts[-1] if parts else s

    def _apa_author_label(item_payload: dict[str, Any]) -> str:
        metadata = item_payload.get("metadata", {}) if isinstance(item_payload.get("metadata"), dict) else {}
        first_last = str(metadata.get("first_author_last") or "").strip()
        if first_last:
            return first_last
        creators = []
        zot = metadata.get("zotero_metadata", {})
        if isinstance(zot, dict) and isinstance(zot.get("creators"), list):
            creators = zot.get("creators") or []
        author_tokens = [_normalize_creator_name(c) for c in creators]
        author_tokens = [a for a in author_tokens if a]
        if not author_tokens:
            fallback = metadata.get("authors")
            if isinstance(fallback, list):
                author_tokens = [_normalize_creator_name(x) for x in fallback if str(x or "").strip()]
                author_tokens = [a for a in author_tokens if a]
        if not author_tokens:
            return "Unknown"
        if len(author_tokens) == 1:
            return author_tokens[0]
        if len(author_tokens) == 2:
            return f"{author_tokens[0]} & {author_tokens[1]}"
        return f"{author_tokens[0]} et al."

    def _iter_item_evidence(item_payload: dict[str, Any]) -> list[tuple[str, str]]:
        rows: list[tuple[str, str]] = []
        for arr_key in ("code_intro_conclusion_extract_core_claims", "code_pdf_page", "evidence_list", "section_open_coding"):
            arr = item_payload.get(arr_key)
            if not isinstance(arr, list):
                continue
            for row in arr:
                if not isinstance(row, dict):
                    continue
                direct_quote = str(row.get("quote") or "").strip()
                dqid = str(row.get("dqid") or "").strip()
                if direct_quote:
                    if not dqid:
                        dqid = hashlib.sha1(direct_quote.encode("utf-8", errors="ignore")).hexdigest()[:12]
                    rows.append((dqid, direct_quote))
                nested = row.get("evidence")
                if isinstance(nested, list):
                    for ev in nested:
                        if not isinstance(ev, dict):
                            continue
                        q = str(ev.get("quote") or "").strip()
                        d = str(ev.get("dqid") or "").strip()
                        if not q:
                            continue
                        if not d:
                            d = hashlib.sha1(q.encode("utf-8", errors="ignore")).hexdigest()[:12]
                        rows.append((d, q))
        return rows

    rows: list[dict[str, str]] = []
    for i, item_key in enumerate(sorted(raw.keys()), start=1):
        item_payload = raw.get(item_key, {})
        if not isinstance(item_payload, dict):
            continue
        metadata = item_payload.get("metadata", {}) if isinstance(item_payload.get("metadata"), dict) else {}
        author_label_full = _apa_author_label(item_payload)
        author_label = author_label_full.rstrip(".")
        year_raw = str(metadata.get("year") or "").strip()
        year = year_raw if year_raw else "n.d."
        title = str(metadata.get("title") or "").strip() or f"Unresolved source metadata ({item_key})"

        citation_anchor = f"({author_label_full}, {year})"
        pdf_path = str(metadata.get("pdf_path") or "").strip()
        source_url = _source_url_from_metadata(metadata)
        dqid_quotes = _iter_item_evidence(item_payload)
        dqid = ""
        quote = ""
        page_no: int | None = None
        if dqid_quotes:
            dqid, quote = dqid_quotes[0]
            page_no = _find_quote_page(pdf_path, quote)
        citation_anchor = _append_page_to_apa_citation(citation_anchor, page_no)
        apa_text = f"{author_label}. ({year}). {title}."
        rows.append(
            {
                "index": str(i),
                "item_key": str(item_key),
                "dqid": dqid,
                "quote": quote,
                "pdf_path": pdf_path,
                "source_url": source_url,
                "page_no": str(page_no or ""),
                "apa_text": apa_text,
                "citation_anchor": citation_anchor,
            }
        )
    return rows


def _build_reference_items(summary: dict[str, Any], *, citation_style: str = "apa") -> list[str]:
    normalized_style = _normalize_citation_style(citation_style)
    records = _build_reference_records(summary)
    refs: list[str] = []
    for rec in records:
        idx = int(rec.get("index") or "0")
        dqid = str(rec.get("dqid") or "").strip()
        quote = str(rec.get("quote") or "").strip()
        source_url = str(rec.get("source_url") or "").strip()
        citation_anchor = str(rec.get("citation_anchor") or "").strip()
        apa_text = str(rec.get("apa_text") or "").strip()
        anchor_html = ""
        targets_html = ""
        if dqid:
            tip = html.escape(quote[:240], quote=True) if quote else html.escape(dqid, quote=True)
            anchor_label, allow_html = _format_intext_citation(normalized_style, citation_anchor, idx if idx > 0 else None)
            label_html = anchor_label if allow_html else html.escape(anchor_label)
            href_target = source_url or f"#dqid-{html.escape(dqid)}"
            if normalized_style in {"numeric", "endnote", "parenthetical_footnote"} and idx > 0:
                href_target = source_url or f"#note-{idx}"
            anchor_html = (
                " "
                + f"<a class=\"quote-anchor\" data-dqid=\"{html.escape(dqid)}\" "
                + f"href=\"{html.escape(href_target, quote=True)}\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"{tip}\">{label_html}</a>"
            )
            targets_html = f"<span id=\"dqid-{html.escape(dqid)}\" class=\"quote-target\" title=\"{tip}\"></span>"
        if normalized_style == "numeric":
            prefix = f"[{idx}] "
        elif normalized_style == "endnote":
            prefix = f"{idx}. "
        elif normalized_style == "parenthetical_footnote":
            prefix = f"Note {idx}. "
        else:
            prefix = ""
        refs.append(f"<li>{html.escape(prefix + apa_text)}{anchor_html}{targets_html}</li>")
    return refs


def _build_notes_block_html(summary: dict[str, Any], *, citation_style: str = "apa") -> str:
    normalized_style = _normalize_citation_style(citation_style)
    if normalized_style not in {"numeric", "endnote", "parenthetical_footnote"}:
        return ""
    records = _build_reference_records(summary)
    items: list[str] = []
    for rec in records:
        idx = int(rec.get("index") or "0")
        if idx <= 0:
            continue
        quote = str(rec.get("quote") or "").strip()
        apa_text = str(rec.get("apa_text") or "").strip()
        note_body = quote[:400] if quote else apa_text
        items.append(
            f"<li id=\"note-{idx}\"><span class=\"note-citation\">{html.escape(apa_text)}</span>: "
            + f"{html.escape(note_body)} <a href=\"#references\" class=\"note-back\">&#8617;</a></li>"
        )
    if not items:
        return ""
    return "<h3>Notes</h3>\n<ol class=\"citation-notes\">\n" + "\n".join(items) + "\n</ol>"


def _build_dqid_evidence_payload(summary: dict[str, Any], max_rows: int = 120) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
    out = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    npath = Path(str(out.get("normalized_results_path") or "")).expanduser()
    if not npath.is_file():
        return [], {}
    raw = json.loads(npath.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return [], {}

    def _author_from_item(item_payload: dict[str, Any]) -> str:
        metadata = item_payload.get("metadata", {}) if isinstance(item_payload.get("metadata"), dict) else {}
        first_last = str(metadata.get("first_author_last") or "").strip()
        if first_last:
            return first_last
        zot = metadata.get("zotero_metadata", {})
        creators = zot.get("creators") if isinstance(zot, dict) else None
        author_tokens: list[str] = []
        if isinstance(creators, list):
            for c in creators:
                if isinstance(c, dict):
                    last = str(c.get("lastName") or "").strip()
                    if last:
                        author_tokens.append(last)
                        continue
                    name = str(c.get("name") or "").strip()
                    if name:
                        author_tokens.append(name)
                        continue
                s = str(c or "").strip()
                if s:
                    toks = s.replace(",", " ").split()
                    author_tokens.append(toks[-1] if toks else s)
        if not author_tokens:
            return "Unknown"
        if len(author_tokens) == 1:
            return author_tokens[0]
        if len(author_tokens) == 2:
            return f"{author_tokens[0]} & {author_tokens[1]}"
        return f"{author_tokens[0]} et al."

    payload_rows: list[dict[str, Any]] = []
    dqid_lookup: dict[str, dict[str, str]] = {}
    seen: set[str] = set()

    for item_index, item_key in enumerate(sorted(raw.keys()), start=1):
        item_payload = raw.get(item_key, {})
        if not isinstance(item_payload, dict):
            continue
        metadata = item_payload.get("metadata", {}) if isinstance(item_payload.get("metadata"), dict) else {}
        item_pdf_path = str(metadata.get("pdf_path") or "").strip()
        source_url = _source_url_from_metadata(metadata)
        author = _author_from_item(item_payload)
        year = str(metadata.get("year") or "").strip() or "n.d."
        citation = f"({author}, {year})"
        if str(item_key).strip() and str(item_key) not in dqid_lookup:
            dqid_lookup[str(item_key)] = {
                "quote": "",
                "citation": citation,
                "index": str(item_index),
                "item_key": str(item_key),
                "pdf_path": item_pdf_path,
                "source_url": source_url,
            }

        for arr_key in ("evidence_list", "code_pdf_page", "code_intro_conclusion_extract_core_claims", "section_open_coding"):
            arr = item_payload.get(arr_key)
            if not isinstance(arr, list):
                continue
            for outer in arr:
                if not isinstance(outer, dict):
                    continue
                candidates: list[dict[str, Any]] = []
                if isinstance(outer.get("evidence"), list):
                    candidates.extend([e for e in outer["evidence"] if isinstance(e, dict)])
                else:
                    candidates.append(outer)
                for ev in candidates:
                    dqid = str(ev.get("dqid") or "").strip()
                    quote = str(ev.get("quote") or "").strip()
                    if not quote:
                        continue
                    if not dqid:
                        dqid = hashlib.sha1(quote.encode("utf-8", errors="ignore")).hexdigest()[:12]
                    unique_key = f"{dqid}|{quote[:80]}"
                    if unique_key in seen:
                        continue
                    seen.add(unique_key)
                    themes = ev.get("potential_themes")
                    theme = ""
                    if isinstance(themes, list) and themes:
                        theme = str(themes[0] or "").strip()
                    if not theme:
                        theme = str(ev.get("evidence_type") or "").strip() or "uncategorized"
                    row = {
                        "dqid": dqid,
                        "quote": quote[:500],
                        "theme": theme,
                        "citation": citation,
                        "item_key": str(item_key),
                        "pdf_path": item_pdf_path,
                    }
                    payload_rows.append(row)
                    page_no = _find_quote_page(item_pdf_path, quote) if item_pdf_path else None
                    dqid_lookup[dqid] = {
                        "quote": quote,
                        "citation": _append_page_to_apa_citation(citation, page_no),
                        "index": str(item_index),
                        "item_key": str(item_key),
                        "pdf_path": item_pdf_path,
                        "source_url": source_url,
                        "page_no": str(page_no or ""),
                    }
                    if "#" in dqid:
                        prefix = dqid.split("#", 1)[0].strip()
                        if prefix and prefix not in dqid_lookup:
                            dqid_lookup[prefix] = {
                                "quote": quote,
                                "citation": _append_page_to_apa_citation(citation, page_no),
                                "index": str(item_index),
                                "item_key": str(item_key),
                                "pdf_path": item_pdf_path,
                                "source_url": source_url,
                                "page_no": str(page_no or ""),
                            }
                    if len(payload_rows) >= int(max_rows):
                        return payload_rows, dqid_lookup
    return payload_rows, dqid_lookup


def _enrich_dqid_anchors(section_html: str, dqid_lookup: dict[str, dict[str, str]], *, citation_style: str = "apa") -> str:
    if not section_html or not dqid_lookup:
        return section_html
    prefix_citation: dict[str, str] = {}
    for key, meta in dqid_lookup.items():
        if "#" not in str(key):
            continue
        prefix = str(key).split("#", 1)[0].strip()
        citation = str((meta or {}).get("citation") or "").strip()
        if prefix and citation and prefix not in prefix_citation:
            prefix_citation[prefix] = citation

    def _replace_anchor(m: re.Match[str]) -> str:
        attrs = m.group(1) or ""
        inner = m.group(3) or ""
        dqid = str(m.group(2) or "").strip()
        meta = dqid_lookup.get(dqid, {})
        if not meta and "#" in dqid:
            meta = dqid_lookup.get(dqid.split("#", 1)[0], {}) or dqid_lookup.get(dqid.split("#")[-1], {})
        if not meta and dqid.startswith("dqid-"):
            meta = dqid_lookup.get(dqid.replace("dqid-", "", 1), {})
        quote = str(meta.get("quote") or "").strip()
        citation = str(meta.get("citation") or "").strip()
        source_url = str(meta.get("source_url") or "").strip()
        index_value: int | None = None
        try:
            idx_raw = meta.get("index")
            if idx_raw is not None and str(idx_raw).strip():
                index_value = int(str(idx_raw).strip())
        except Exception:
            index_value = None
        if not citation and "#" in dqid:
            prefix = dqid.split("#", 1)[0].strip()
            citation = prefix_citation.get(prefix, "")
            if index_value is None:
                pm = dqid_lookup.get(prefix, {})
                try:
                    if pm.get("index") is not None and str(pm.get("index")).strip():
                        index_value = int(str(pm.get("index")).strip())
                except Exception:
                    index_value = None
        page_value: int | None = None
        try:
            page_raw = meta.get("page_no")
            if page_raw is not None and str(page_raw).strip():
                page_value = int(str(page_raw).strip())
        except Exception:
            page_value = None
        if page_value is None:
            pdf_path = str(meta.get("pdf_path") or "").strip()
            if pdf_path and quote:
                page_found = _find_quote_page(pdf_path, quote)
                if page_found is not None:
                    page_value = page_found
                    meta["page_no"] = str(page_found)
        if _normalize_citation_style(citation_style) == "apa":
            citation = _append_page_to_apa_citation(citation, page_value)
        inner_text = _html_to_text(inner)
        if not citation:
            if re.match(r"^\([^()]{2,120}\)$", inner_text):
                citation = inner_text
            else:
                citation = "(Source citation)"
        link_text, allow_html = _format_intext_citation(citation_style, citation, index_value)
        title = html.escape((quote[:240] if quote else dqid), quote=True)
        label_html = link_text if allow_html else html.escape(link_text)
        href_target = source_url or f"#dqid-{html.escape(dqid)}"
        if _normalize_citation_style(citation_style) in {"numeric", "endnote", "parenthetical_footnote"} and index_value is not None:
            href_target = source_url or f"#note-{index_value}"
        return (
            f"<a class=\"dqid-cite\" data-dqid=\"{html.escape(dqid)}\" "
            f"href=\"{html.escape(href_target, quote=True)}\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"{title}\">{label_html}</a>"
        )

    pattern = re.compile(r"<a([^>]*\bdata-dqid\s*=\s*[\"']([^\"']+)[\"'][^>]*)>(.*?)</a>", flags=re.IGNORECASE | re.DOTALL)
    return pattern.sub(_replace_anchor, section_html)


def _inject_dqid_anchors_if_missing(
    section_html: str,
    dqid_lookup: dict[str, dict[str, str]],
    *,
    max_anchors: int = 4,
    citation_style: str = "apa",
) -> str:
    if not section_html or not dqid_lookup:
        return section_html
    if re.search(r"<a[^>]*\bdata-dqid\s*=", section_html, flags=re.IGNORECASE):
        return section_html
    dqids = list(dqid_lookup.keys())[: max(1, int(max_anchors))]
    if not dqids:
        return section_html
    anchors = []
    for dqid in dqids:
        meta = dqid_lookup.get(dqid, {})
        citation = str(meta.get("citation") or "(Unknown, n.d.)")
        idx_val: int | None = None
        try:
            if meta.get("index") is not None and str(meta.get("index")).strip():
                idx_val = int(str(meta.get("index")).strip())
        except Exception:
            idx_val = None
        label, allow_html = _format_intext_citation(citation_style, citation, idx_val)
        label_html = label if allow_html else html.escape(label)
        anchors.append(f"<a data-dqid=\"{html.escape(dqid)}\">{label_html}</a>")
    cite_block = " " + " ".join(anchors)
    if re.search(r"</p>", section_html, flags=re.IGNORECASE):
        return re.sub(r"</p>", f"{cite_block}</p>", section_html, count=1, flags=re.IGNORECASE)
    return f"<p>{section_html}{cite_block}</p>"


def _normalize_citation_style(style: str) -> str:
    key = str(style or "apa").strip().lower()
    normalized = CITATION_STYLE_ALIASES.get(key)
    if not normalized:
        allowed = ", ".join(sorted(set(CITATION_STYLE_ALIASES.values())))
        raise ValueError(f"Unsupported citation_style '{style}'. Allowed: {allowed}")
    return normalized


def _format_intext_citation(style: str, citation: str, index: int | None) -> tuple[str, bool]:
    normalized = _normalize_citation_style(style)
    cite = str(citation or "").strip() or "(Source citation)"
    if normalized == "apa":
        return cite, False
    if index is None:
        return cite, False
    if normalized == "numeric":
        return f"[{index}]", False
    if normalized == "parenthetical_footnote":
        return f"(see note {index})", False
    if normalized == "endnote":
        return f"<sup>{index}</sup>", True
    return cite, False


def _citation_style_instruction(style: str) -> str:
    normalized = _normalize_citation_style(style)
    if normalized == "apa":
        return "Use in-text author-year citations in anchors, e.g., <a data-dqid=\"DQID\">(Author, Year)</a>."
    if normalized == "numeric":
        return "Use numeric in-text citations in anchors, e.g., <a data-dqid=\"DQID\">[12]</a>."
    if normalized == "endnote":
        return "Use endnote superscript anchors, e.g., <a data-dqid=\"DQID\"><sup>12</sup></a>."
    return "Use parenthetical footnote anchors, e.g., <a data-dqid=\"DQID\">(see note 12)</a>."


CACHE_SCHEMA = "systematic_section_cache_v2"


def _make_cache_entry(*, section_name: str, html_text: str, model: str, custom_id: str = "") -> dict[str, Any]:
    normalized_html = _clean_and_humanize_section_html(html_text)
    return {
        "section": str(section_name),
        "html": normalized_html,
        "model": str(model or ""),
        "custom_id": str(custom_id or ""),
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "hash": hashlib.sha1(normalized_html.encode("utf-8", errors="ignore")).hexdigest(),
    }


def _load_section_cache(path_obj: Path) -> tuple[dict[str, dict[str, Any]], dict[str, str], bool]:
    entries: dict[str, dict[str, Any]] = {}
    html_map: dict[str, str] = {}
    dirty = False
    if not path_obj.is_file():
        return entries, html_map, dirty
    try:
        loaded = json.loads(path_obj.read_text(encoding="utf-8"))
    except Exception:
        return entries, html_map, dirty

    # Legacy format: {section_name: "<html>"}
    if isinstance(loaded, dict) and "sections" not in loaded:
        for section_name, value in loaded.items():
            if not isinstance(value, str) or not value.strip():
                continue
            clean_html = _clean_and_humanize_section_html(value)
            entry = _make_cache_entry(section_name=str(section_name), html_text=clean_html, model="", custom_id="")
            entries[str(section_name)] = entry
            html_map[str(section_name)] = clean_html
        return entries, html_map, True

    if not isinstance(loaded, dict):
        return entries, html_map, dirty
    sections = loaded.get("sections")
    if not isinstance(sections, dict):
        return entries, html_map, dirty

    for section_name, payload in sections.items():
        if not isinstance(payload, dict):
            dirty = True
            continue
        html_text = payload.get("html")
        if not isinstance(html_text, str) or not html_text.strip():
            dirty = True
            continue
        clean_html = _clean_and_humanize_section_html(html_text)
        entry = {
            "section": str(payload.get("section") or section_name),
            "html": clean_html,
            "model": str(payload.get("model") or ""),
            "custom_id": str(payload.get("custom_id") or ""),
            "created_at": str(payload.get("created_at") or ""),
            "hash": str(payload.get("hash") or hashlib.sha1(clean_html.encode("utf-8", errors="ignore")).hexdigest()),
        }
        entries[str(section_name)] = entry
        html_map[str(section_name)] = clean_html
        if clean_html != html_text:
            dirty = True
    if str(loaded.get("schema") or "") != CACHE_SCHEMA:
        dirty = True
    return entries, html_map, dirty


def _write_section_cache(path_obj: Path, entries: dict[str, dict[str, Any]]) -> None:
    payload = {
        "schema": CACHE_SCHEMA,
        "updated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "sections": entries,
    }
    path_obj.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _assert_section_citation_coverage(section_name: str, section_html: str, dqid_lookup: dict[str, dict[str, str]]) -> None:
    evidence_sections = {"narrative_synthesis", "discussion", "limitations", "introduction", "conclusion", "abstract"}
    if section_name not in evidence_sections:
        return

    anchors = re.findall(r"<a[^>]*\bdata-dqid\s*=\s*[\"']([^\"']+)[\"'][^>]*>", str(section_html or ""), flags=re.IGNORECASE)
    if len(anchors) < 1:
        raise RuntimeError(f"Section '{section_name}' has no dqid citations.")
    unresolved: list[str] = []
    for dqid in anchors:
        token = str(dqid or "").strip()
        if not token:
            unresolved.append(token)
            continue
        if token in dqid_lookup:
            continue
        prefix = token.split("#", 1)[0] if "#" in token else token
        if prefix in dqid_lookup:
            continue
        unresolved.append(token)
    if unresolved:
        sample = ", ".join(unresolved[:5])
        raise RuntimeError(f"Section '{section_name}' has unresolved dqid citations: {sample}")


def render_systematic_review_from_summary(
    *,
    summary: dict[str, Any],
    template_path: Path,
    outputs_root: Path,
    use_llm: bool = True,
    model: str = "gpt-5-mini",
    section_timeout_s: int = 0,
    section_single_batch: bool = False,
    citation_style: str = "apa",
) -> PipelineResult:
    raw_collection_name = str(summary.get("collection_name") or "").strip()
    if not raw_collection_name:
        raise ValueError("summary.collection_name is required")
    collection_name = _resolve_collection_label(raw_collection_name)
    output_dir = outputs_root / _safe_name(collection_name) / "SLR"
    output_dir.mkdir(parents=True, exist_ok=True)
    section_cache_path = output_dir / "section_generation_cache.json"
    section_cache_entries, section_cache, section_cache_dirty = _load_section_cache(section_cache_path)
    if section_cache_dirty:
        _write_section_cache(section_cache_path, section_cache_entries)

    input_block = summary.get("input", {}) if isinstance(summary.get("input"), dict) else {}
    ev_stats = input_block.get("evidence_normalization", {}) if isinstance(input_block.get("evidence_normalization"), dict) else {}
    rq_lines = _rq_findings_lines(summary)
    theme_counts = _compute_theme_counts(summary)
    top_theme_labels = list(theme_counts.keys())[:10]
    top_theme_values = [theme_counts[k] for k in top_theme_labels]

    prisma_counts = {
        "db": _safe_int(input_block.get("item_count"), 0),
        "dup": 0,
        "screen": _safe_int(input_block.get("item_count"), 0),
        "screen_ex": 0,
        "full": _safe_int(input_block.get("item_count"), 0),
        "full_ex": 0,
        "included": _safe_int(input_block.get("item_count"), 0),
    }
    prisma_svg = _svg_prisma(prisma_counts)
    themes_svg = _svg_bar_chart(
        "Top Section-Level Themes Frequency (Excludes Intro/Conclusion Core Claims)",
        top_theme_labels or ["no_data"],
        top_theme_values or [0],
    )
    prisma_svg_path = output_dir / "prisma_flow.svg"
    themes_svg_path = output_dir / "theme_frequencies.svg"
    prisma_svg_path.write_text(prisma_svg, encoding="utf-8")
    themes_svg_path.write_text(themes_svg, encoding="utf-8")

    if not use_llm:
        raise RuntimeError("Strict systematic-review writing requires LLM generation; disable was requested.")
    citation_style = _normalize_citation_style(citation_style)
    payload_base = {
        "collection_name": collection_name,
        "overarching_theme": collection_name,
        "item_count": _safe_int(input_block.get("item_count"), 0),
        "evidence_kept": _safe_int(ev_stats.get("evidence_kept"), 0),
        "rq_findings": [_humanize_theme_tokens(x) for x in rq_lines],
        "top_themes": [{k: v} for k, v in list(theme_counts.items())[:15]],
    }
    payload_base["citation_style"] = citation_style
    payload_base["top_themes"] = [{_humanize_theme_tokens(str(list(d.keys())[0])): list(d.values())[0]} for d in payload_base["top_themes"]]
    dqid_payload, dqid_lookup = _build_dqid_evidence_payload(summary, max_rows=5000)
    payload_base["evidence_payload"] = dqid_payload
    citation_instruction = _citation_style_instruction(citation_style)

    phase1_section_specs = {
        "eligibility_criteria_protocol": "Write protocol-grade eligibility criteria as one concise block using inclusion/exclusion dimensions and scope. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "search_strategy": "Write the information-sources and search-strategy summary for methods section in protocol style. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "study_selection_methods": "Write the Study Selection methods with reviewer workflow and conflict-resolution process. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "data_extraction_methods": "Write the Data Extraction methods including fields extracted and reviewer process. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "risk_of_bias_methods": "Write Risk of Bias assessment methods and tool usage in concise protocol language. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "data_synthesis_methods": "Write the Data Synthesis methods with analytic strategy and rationale. Use formal publication prose only; do not mention prompts, context JSON, or AI.",
        "narrative_synthesis": "Write the synthesis of results section summarizing findings by research-question groups. Use formal publication prose only; do not mention prompts, context JSON, or AI. Include 1-3 evidence anchors per paragraph and only use dqids provided in evidence_payload.",
        "discussion": "Write the discussion section with interpretation, implications, and disagreements/uncertainty. Use formal publication prose only; do not mention prompts, context JSON, or AI. Include 1-3 evidence anchors per paragraph and only use dqids provided in evidence_payload.",
        "limitations": "Write limitations grounded in available synthesis constraints and data-quality limitations. Use formal publication prose only; do not mention prompts, context JSON, or AI. Include 1-3 evidence anchors per paragraph and only use dqids provided in evidence_payload.",
    }
    section_specs = {
        "eligibility_criteria_protocol": {"min": 120, "max": 280},
        "search_strategy": {"min": 160, "max": 560},
        "study_selection_methods": {"min": 110, "max": 1200},
        "data_extraction_methods": {"min": 110, "max": 1200},
        "risk_of_bias_methods": {"min": 90, "max": 1200},
        "data_synthesis_methods": {"min": 110, "max": 1200},
        "narrative_synthesis": {"min": 280, "max": 1800},
        "discussion": {"min": 300, "max": 1800},
        "limitations": {"min": 180, "max": 1200},
        "introduction": {"min": 250, "max": 1800},
        "conclusion": {"min": 180, "max": 900},
        "abstract": {"min": 180, "max": 360, "forbid_h4": True},
    }
    llm_sections: dict[str, str] = {}
    if section_single_batch:
        call_models_zt = _load_call_models_zt()
        llms_dir = _repo_root() / "python_backend_legacy" / "llms"
        if str(llms_dir) not in sys.path:
            sys.path.insert(0, str(llms_dir))
        import calling_models as cm  # type: ignore

        function_name = "systematic_review_section_writer"
        safe_collection = cm.safe_name(collection_name) if hasattr(cm, "safe_name") else _safe_name(collection_name)
        safe_function = cm.safe_name(function_name) if hasattr(cm, "safe_name") else _safe_name(function_name)
        batch_root = cm.get_batch_root() if hasattr(cm, "get_batch_root") else (_repo_root() / "tmp" / "batching_files" / "batches")
        func_dir = Path(batch_root) / safe_function
        func_dir.mkdir(parents=True, exist_ok=True)
        input_file = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
        output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
        meta_file = func_dir / f"{safe_collection}_{safe_function}_batch_metadata.json"
        for fp in (input_file, output_file, meta_file):
            if fp.exists():
                fp.unlink()

        pending_phase1: list[tuple[str, str]] = []
        for section_name, instruction in phase1_section_specs.items():
            if section_name in section_cache:
                cached_html = _clean_and_humanize_section_html(section_cache[section_name])
                cached_html = _enrich_dqid_anchors(cached_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    if section_name in {"narrative_synthesis", "discussion", "limitations"}:
                        cached_html = _inject_dqid_anchors_if_missing(cached_html, dqid_lookup, citation_style=citation_style)
                    _validate_generated_section(section_name, cached_html, cfg)
                    llm_sections[section_name] = cached_html
                    continue
                except Exception:
                    section_cache.pop(section_name, None)
                    section_cache_entries.pop(section_name, None)
                    _write_section_cache(section_cache_path, section_cache_entries)
            prompt = (
                "SECTION_NAME\n"
                f"{section_name}\n\n"
                "INSTRUCTION\n"
                f"{instruction}\n\n"
                "CONTEXT_JSON\n"
                f"{json.dumps(payload_base, ensure_ascii=False, indent=2)}\n\n"
                "STYLE_GUARD\n"
                "Write formal publication prose only. Do not mention provided context, context json, prompts, or AI.\n\n"
                "CITATION_STYLE\n"
                f"{citation_instruction}\n\n"
                "Return only raw HTML snippets, no markdown fences."
            )
            custom_id = _stable_section_custom_id(collection_name, section_name, prompt)
            _ = call_models_zt(
                text=prompt,
                function=function_name,
                custom_id=custom_id,
                collection_name=collection_name,
                model=model,
                ai="openai",
                read=False,
                store_only=True,
                cache=False,
            )
            pending_phase1.append((section_name, custom_id))

        if pending_phase1:
            ok = cm._process_batch_for(analysis_key_suffix=function_name, section_title=safe_collection, poll_interval=30)
            if ok is not True:
                raise RuntimeError("Phase-1 grouped section batch failed.")
            for section_name, custom_id in pending_phase1:
                response = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
                section_html = _clean_and_humanize_section_html(_clean_llm_html(_extract_llm_text(response)))
                section_html = _enrich_dqid_anchors(section_html, dqid_lookup, citation_style=citation_style)
                if section_name in {"narrative_synthesis", "discussion", "limitations"}:
                    section_html = _inject_dqid_anchors_if_missing(section_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    _validate_generated_section(section_name, section_html, cfg)
                except Exception:
                    # keep batch output to avoid aborting whole paper generation
                    pass
                llm_sections[section_name] = section_html
                section_cache[section_name] = section_html
                section_cache_entries[section_name] = _make_cache_entry(
                    section_name=section_name,
                    html_text=section_html,
                    model=model,
                    custom_id=custom_id,
                )
                _write_section_cache(section_cache_path, section_cache_entries)
    else:
        for section_name, instruction in phase1_section_specs.items():
            base_prompt = (
                "SECTION_NAME\n"
                f"{section_name}\n\n"
                "INSTRUCTION\n"
                f"{instruction}\n\n"
                "CONTEXT_JSON\n"
                f"{json.dumps(payload_base, ensure_ascii=False, indent=2)}\n\n"
                "Return only raw HTML snippets, no markdown fences."
            )
            if section_name in section_cache:
                cached_html = _clean_and_humanize_section_html(section_cache[section_name])
                cached_html = _enrich_dqid_anchors(cached_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    if section_name in {"narrative_synthesis", "discussion", "limitations"}:
                        cached_html = _inject_dqid_anchors_if_missing(cached_html, dqid_lookup, citation_style=citation_style)
                    _validate_generated_section(section_name, cached_html, cfg)
                    llm_sections[section_name] = cached_html
                    continue
                except Exception:
                    section_cache.pop(section_name, None)
                    section_cache_entries.pop(section_name, None)
                    _write_section_cache(section_cache_path, section_cache_entries)
            try:
                section_html = ""
                last_err: Exception | None = None
                for attempt in range(1, 4):
                    retry_guard = (
                        "\n\nSTYLE_GUARD\n"
                        "Write formal publication prose only. Do not mention 'provided context', "
                        "'context json', prompts, or AI. Do not include placeholders.\n"
                        + f"\nCITATION_STYLE\n{citation_instruction}\n"
                    )
                    prompt = base_prompt + (retry_guard if attempt > 1 else "")
                    custom_id = _stable_section_custom_id(collection_name, f"{section_name}_a{attempt}", prompt)
                    call_kwargs = {
                        "text": prompt,
                        "function": "systematic_review_section_writer",
                        "custom_id": custom_id,
                        "collection_name": collection_name,
                        "model": model,
                        "ai": "openai",
                        "read": False,
                        "store_only": False,
                        "cache": False,
                    }
                    response = _call_models_with_timeout(timeout_s=int(section_timeout_s), kwargs=call_kwargs)
                    section_html = _clean_llm_html(_extract_llm_text(response))
                    if not section_html:
                        last_err = RuntimeError(f"LLM returned empty section content for '{section_name}'.")
                        continue
                    section_html = _clean_and_humanize_section_html(section_html)
                    section_html = _enrich_dqid_anchors(section_html, dqid_lookup, citation_style=citation_style)
                    if section_name in {"narrative_synthesis", "discussion", "limitations"}:
                        section_html = _inject_dqid_anchors_if_missing(section_html, dqid_lookup, citation_style=citation_style)
                    cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                    try:
                        _validate_generated_section(section_name, section_html, cfg)
                        llm_sections[section_name] = section_html
                        section_cache[section_name] = section_html
                        section_cache_entries[section_name] = _make_cache_entry(
                            section_name=section_name,
                            html_text=section_html,
                            model=model,
                            custom_id=custom_id,
                        )
                        _write_section_cache(section_cache_path, section_cache_entries)
                        last_err = None
                        break
                    except Exception as exc:
                        last_err = exc
                        continue
                if last_err is not None:
                    raise last_err
            except TimeoutError as exc:
                raise RuntimeError(f"Timeout while generating section '{section_name}' after {section_timeout_s}s.") from exc

    whole_paper_payload = {
        **payload_base,
        "draft_sections_html": {
            "methods_search_strategy": llm_sections["search_strategy"],
            "eligibility_criteria_protocol": llm_sections["eligibility_criteria_protocol"],
            "study_selection_methods": llm_sections["study_selection_methods"],
            "data_extraction_methods": llm_sections["data_extraction_methods"],
            "risk_of_bias_methods": llm_sections["risk_of_bias_methods"],
            "data_synthesis_methods": llm_sections["data_synthesis_methods"],
            "results_narrative_synthesis": llm_sections["narrative_synthesis"],
            "discussion": llm_sections["discussion"],
            "limitations": llm_sections["limitations"],
        },
        "draft_sections_text": {
            "methods_search_strategy": _html_to_text(llm_sections["search_strategy"]),
            "eligibility_criteria_protocol": _html_to_text(llm_sections["eligibility_criteria_protocol"]),
            "study_selection_methods": _html_to_text(llm_sections["study_selection_methods"]),
            "data_extraction_methods": _html_to_text(llm_sections["data_extraction_methods"]),
            "risk_of_bias_methods": _html_to_text(llm_sections["risk_of_bias_methods"]),
            "data_synthesis_methods": _html_to_text(llm_sections["data_synthesis_methods"]),
            "results_narrative_synthesis": _html_to_text(llm_sections["narrative_synthesis"]),
            "discussion": _html_to_text(llm_sections["discussion"]),
            "limitations": _html_to_text(llm_sections["limitations"]),
        },
    }

    phase2_section_specs = {
        "introduction": (
            "Write the Introduction focused on the overarching theme, research gap, and objectives, using WHOLE_PAPER "
            "as primary input. Avoid operational IDs and avoid snake_case tokens. Return paragraph prose only: no headings and no bullet/numbered lists."
        ),
        "conclusion": (
            "Write the Conclusion using the WHOLE_PAPER content below as the primary input. "
            "State concrete takeaways and future work. Return paragraph prose only: no headings and no bullet/numbered lists."
        ),
        "abstract": (
            "Write a professional single-block abstract paragraph (no subsection headings) that implicitly covers "
            "background, methods, results, and conclusions using WHOLE_PAPER as primary input. Return paragraph prose only: no headings and no bullet/numbered lists."
        ),
    }
    if section_single_batch:
        call_models_zt = _load_call_models_zt()
        llms_dir = _repo_root() / "python_backend_legacy" / "llms"
        if str(llms_dir) not in sys.path:
            sys.path.insert(0, str(llms_dir))
        import calling_models as cm  # type: ignore

        function_name = "systematic_review_section_writer"
        phase2_collection = f"{collection_name}_whole_paper"
        safe_collection = cm.safe_name(phase2_collection) if hasattr(cm, "safe_name") else _safe_name(phase2_collection)
        safe_function = cm.safe_name(function_name) if hasattr(cm, "safe_name") else _safe_name(function_name)
        batch_root = cm.get_batch_root() if hasattr(cm, "get_batch_root") else (_repo_root() / "tmp" / "batching_files" / "batches")
        func_dir = Path(batch_root) / safe_function
        func_dir.mkdir(parents=True, exist_ok=True)
        input_file = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
        output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
        meta_file = func_dir / f"{safe_collection}_{safe_function}_batch_metadata.json"
        for fp in (input_file, output_file, meta_file):
            if fp.exists():
                fp.unlink()

        pending_phase2: list[tuple[str, str]] = []
        for section_name, instruction in phase2_section_specs.items():
            if section_name in section_cache:
                cached_html = _clean_and_humanize_section_html(section_cache[section_name])
                cached_html = _enrich_dqid_anchors(cached_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    _validate_generated_section(section_name, cached_html, cfg)
                    llm_sections[section_name] = cached_html
                    continue
                except Exception:
                    section_cache.pop(section_name, None)
                    section_cache_entries.pop(section_name, None)
                    _write_section_cache(section_cache_path, section_cache_entries)
            prompt = (
                "SECTION_NAME\n"
                f"{section_name}\n\n"
                "INSTRUCTION\n"
                f"{instruction}\n\n"
                "WHOLE_PAPER_CONTEXT_JSON\n"
                f"{json.dumps(whole_paper_payload, ensure_ascii=False, indent=2)}\n\n"
                "STYLE_GUARD\n"
                "Write formal publication prose only. Do not mention provided context, context json, prompts, or AI.\n\n"
                "CITATION_STYLE\n"
                f"{citation_instruction}\n\n"
                "Return only raw HTML snippets, no markdown fences."
            )
            custom_id = _stable_section_custom_id(phase2_collection, section_name, prompt)
            _ = call_models_zt(
                text=prompt,
                function=function_name,
                custom_id=custom_id,
                collection_name=phase2_collection,
                model=model,
                ai="openai",
                read=False,
                store_only=True,
                cache=False,
            )
            pending_phase2.append((section_name, custom_id))

        if pending_phase2:
            ok = cm._process_batch_for(analysis_key_suffix=function_name, section_title=safe_collection, poll_interval=30)
            if ok is not True:
                raise RuntimeError("Phase-2 grouped section batch failed.")
            for section_name, custom_id in pending_phase2:
                response = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
                section_html = _clean_and_humanize_section_html(_clean_llm_html(_extract_llm_text(response)))
                section_html = _enrich_dqid_anchors(section_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    _validate_generated_section(section_name, section_html, cfg)
                except Exception:
                    pass
                llm_sections[section_name] = section_html
                section_cache[section_name] = section_html
                section_cache_entries[section_name] = _make_cache_entry(
                    section_name=section_name,
                    html_text=section_html,
                    model=model,
                    custom_id=custom_id,
                )
                _write_section_cache(section_cache_path, section_cache_entries)
    else:
        for section_name, instruction in phase2_section_specs.items():
            base_prompt = (
                "SECTION_NAME\n"
                f"{section_name}\n\n"
                "INSTRUCTION\n"
                f"{instruction}\n\n"
                "WHOLE_PAPER_CONTEXT_JSON\n"
                f"{json.dumps(whole_paper_payload, ensure_ascii=False, indent=2)}\n\n"
                "Return only raw HTML snippets, no markdown fences."
            )
            if section_name in section_cache:
                cached_html = _clean_and_humanize_section_html(section_cache[section_name])
                cached_html = _enrich_dqid_anchors(cached_html, dqid_lookup, citation_style=citation_style)
                cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                try:
                    _validate_generated_section(section_name, cached_html, cfg)
                    llm_sections[section_name] = cached_html
                    continue
                except Exception:
                    section_cache.pop(section_name, None)
                    section_cache_entries.pop(section_name, None)
                    _write_section_cache(section_cache_path, section_cache_entries)
            try:
                section_html = ""
                last_err: Exception | None = None
                for attempt in range(1, 4):
                    retry_guard = (
                        "\n\nSTYLE_GUARD\n"
                        "Write formal publication prose only. Do not mention 'provided context', "
                        "'context json', prompts, or AI. Do not include placeholders.\n"
                        + f"\nCITATION_STYLE\n{citation_instruction}\n"
                    )
                    prompt = base_prompt + (retry_guard if attempt > 1 else "")
                    custom_id = _stable_section_custom_id(collection_name, f"{section_name}_a{attempt}", prompt)
                    call_kwargs = {
                        "text": prompt,
                        "function": "systematic_review_section_writer",
                        "custom_id": custom_id,
                        "collection_name": collection_name,
                        "model": model,
                        "ai": "openai",
                        "read": False,
                        "store_only": False,
                        "cache": False,
                    }
                    response = _call_models_with_timeout(timeout_s=int(section_timeout_s), kwargs=call_kwargs)
                    section_html = _clean_llm_html(_extract_llm_text(response))
                    if not section_html:
                        last_err = RuntimeError(f"LLM returned empty section content for '{section_name}'.")
                        continue
                    section_html = _clean_and_humanize_section_html(section_html)
                    if section_name in {"introduction", "conclusion", "abstract"}:
                        section_html = _enrich_dqid_anchors(section_html, dqid_lookup, citation_style=citation_style)
                    cfg = section_specs.get(section_name, {"min": 50, "max": 5000})
                    try:
                        _validate_generated_section(section_name, section_html, cfg)
                        llm_sections[section_name] = section_html
                        section_cache[section_name] = section_html
                        section_cache_entries[section_name] = _make_cache_entry(
                            section_name=section_name,
                            html_text=section_html,
                            model=model,
                            custom_id=custom_id,
                        )
                        _write_section_cache(section_cache_path, section_cache_entries)
                        last_err = None
                        break
                    except Exception as exc:
                        last_err = exc
                        continue
                if last_err is not None:
                    raise last_err
            except TimeoutError as exc:
                raise RuntimeError(f"Timeout while generating section '{section_name}' after {section_timeout_s}s.") from exc

    for section_name, html_block in llm_sections.items():
        _assert_section_citation_coverage(section_name, html_block, dqid_lookup)

    context = {
        "topic": collection_name,
        "citation_style": citation_style,
        "authors_list": "Automated TEIA pipeline",
        "affiliation": "TEIA Research",
        "generation_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "ai_models_used": model,
        "ai_abstract": llm_sections["abstract"],
        "ai_introduction": llm_sections["introduction"],
        "eligibility_criteria": _html_to_text(llm_sections["eligibility_criteria_protocol"]),
        "search_strategy_summary": llm_sections["search_strategy"],
        "full_search_strategy_appendix_path": "search_strategy_appendix.txt",
        "rob_tool_used": "Structured qualitative appraisal rubric",
        "prisma_n_db": prisma_counts["db"],
        "prisma_n_dup": prisma_counts["dup"],
        "prisma_n_initial_screen": prisma_counts["screen"],
        "prisma_n_screen_exclude": prisma_counts["screen_ex"],
        "prisma_n_elig_assess": prisma_counts["full"],
        "prisma_n_elig_exclude": prisma_counts["full_ex"],
        "prisma_exclusion_reasons": {},
        "prisma_n_included": prisma_counts["included"],
        "prisma_flow_diagram": prisma_svg_path.name,
        "characteristics_table": (
            "<table class='data-table'>"
            "<thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>"
            f"<tr><td>Included studies</td><td>{prisma_counts['included']}</td></tr>"
            f"<tr><td>Retained evidence snippets</td><td>{_safe_int(ev_stats.get('evidence_kept'), 0)}</td></tr>"
            f"<tr><td>Top themes visualized</td><td>{len(top_theme_labels)}</td></tr>"
            "</tbody></table>"
        ),
        "risk_of_bias_plot": themes_svg_path.name,
        "narrative_synthesis_summary": llm_sections["narrative_synthesis"],
        "ai_discussion": llm_sections["discussion"],
        "ai_limitations": llm_sections["limitations"],
        "ai_conclusion": llm_sections["conclusion"],
    }

    appendix_path = output_dir / "search_strategy_appendix.txt"
    appendix_text = _html_to_text(llm_sections["search_strategy"])
    appendix_path.write_text(appendix_text if appendix_text else "Search strategy details unavailable.", encoding="utf-8")

    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "htm", "xml"]),
    )
    template = env.get_template(template_path.name)
    rendered = template.render(**context)
    rendered = _replace_subsection_content(rendered, "2.1 Eligibility Criteria", llm_sections["eligibility_criteria_protocol"])
    search_block = (
        llm_sections["search_strategy"]
        + "\n<p class=\"appendix-link\"><a href=\"search_strategy_appendix.txt\" target=\"_blank\">Link to Full Search Strategy Appendix</a></p>"
    )
    rendered = _replace_subsection_content(rendered, "2.2 Information Sources & Search Strategy", search_block)
    rendered = _replace_subsection_content(rendered, "2.3 Study Selection", llm_sections["study_selection_methods"])
    rendered = _replace_subsection_content(rendered, "2.4 Data Extraction", llm_sections["data_extraction_methods"])
    rendered = _replace_subsection_content(rendered, "2.5 Risk of Bias Assessment", llm_sections["risk_of_bias_methods"])
    rendered = _replace_subsection_content(rendered, "2.6 Data Synthesis", llm_sections["data_synthesis_methods"])
    refs = _build_reference_items(summary, citation_style=citation_style)
    refs_html = "\n".join(f"      {r}" for r in refs)
    rendered = _replace_references_block(rendered, refs_html)
    notes_html = _build_notes_block_html(summary, citation_style=citation_style)
    if notes_html:
        rendered = _append_references_notes_block(rendered, f"\n  {notes_html}\n")
    rendered = _strip_editorial_brackets(rendered)
    _assert_non_placeholder_html(rendered)
    _assert_reference_and_postprocess_integrity(rendered, citation_style=citation_style)

    output_html_path = output_dir / "systematic_review.html"
    output_html_path.write_text(rendered, encoding="utf-8")
    context_json_path = output_dir / "systematic_review_context.json"
    context_json_path.write_text(json.dumps(context, ensure_ascii=False, indent=2), encoding="utf-8")
    return PipelineResult(
        output_html_path=output_html_path,
        context_json_path=context_json_path,
        prisma_svg_path=prisma_svg_path,
        themes_svg_path=themes_svg_path,
    )


def run_pipeline(
    *,
    summary_path: Path,
    template_path: Path,
    outputs_root: Path,
    use_llm: bool = True,
    model: str = "gpt-5-mini",
    section_timeout_s: int = 0,
    section_single_batch: bool = False,
    citation_style: str = "apa",
) -> dict[str, Any]:
    if not use_llm:
        raise RuntimeError("Strict mode active: run_pipeline requires LLM enabled for section writing.")
    summary = _load_json(summary_path)
    result = render_systematic_review_from_summary(
        summary=summary,
        template_path=template_path,
        outputs_root=outputs_root,
        use_llm=bool(use_llm),
        model=model,
        section_timeout_s=int(section_timeout_s),
        section_single_batch=bool(section_single_batch),
        citation_style=str(citation_style),
    )
    return {
        "status": "ok",
        "summary_path": str(summary_path),
        "systematic_review_html_path": str(result.output_html_path),
        "context_json_path": str(result.context_json_path),
        "prisma_figure_path": str(result.prisma_svg_path),
        "themes_figure_path": str(result.themes_svg_path),
        "llm_enabled": bool(use_llm),
        "citation_style": str(citation_style),
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate systematic review HTML from synthesis summary.")
    parser.add_argument("--summary-path", required=True)
    parser.add_argument("--template-path", default=str(_repo_root() / "Research" / "templates" / "systematic_review.html"))
    parser.add_argument("--outputs-root", default=str(_repo_root() / "Research" / "outputs"))
    parser.add_argument("--no-llm", action="store_true")
    parser.add_argument("--model", default="gpt-5-mini")
    parser.add_argument("--section-timeout-s", type=int, default=0, help="Per-section timeout in seconds. 0 disables timeout.")
    parser.add_argument("--section-single-batch", action="store_true", help="Generate each section via single enqueue/process/read batch cycle.")
    parser.add_argument(
        "--citation-style",
        default="apa",
        choices=["apa", "numeric", "endnote", "parenthetical_footnote"],
        help="In-text citation style for hydrated dqid anchors and references.",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    result = run_pipeline(
        summary_path=Path(args.summary_path).resolve(),
        template_path=Path(args.template_path).resolve(),
        outputs_root=Path(args.outputs_root).resolve(),
        use_llm=not bool(args.no_llm),
        model=str(args.model),
        section_timeout_s=int(args.section_timeout_s),
        section_single_batch=bool(args.section_single_batch),
        citation_style=str(args.citation_style),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
