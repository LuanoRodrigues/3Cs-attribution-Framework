#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from collections import Counter


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

from annotarium.agents.runtime_openai import (  # noqa: E402
    OpenAIStructuredStepConfig,
    OpenAIStructuredStepError,
    run_structured_step,
)

try:
    from python_backend_legacy.llms.footnotes_parser import link_citations_to_footnotes  # type: ignore  # noqa: E402
except Exception:
    link_citations_to_footnotes = None  # type: ignore[assignment]


SUP_MAP = str.maketrans("¹²³⁴⁵⁶⁷⁸⁹⁰", "1234567890")
NUM_LINE_RE = re.compile(r"^\s*(\d{1,4})\s*(?:[.)]|[-–—])?\s+(.*\S)\s*$")
SUP_LINE_RE = re.compile(r"^\s*([¹²³⁴⁵⁶⁷⁸⁹⁰]{1,6})\s+(.*\S)\s*$")
ROMAN_LINE_RE = re.compile(r"^\s*([ivxlcdmIVXLCDM]{1,7})\s*(?:[.)]|[-–—])\s+(.*\S)\s*$")
INTEXT_TEX_RE = re.compile(r"\$(?:\s*\{\s*\}\s*)?\^\{\s*(\d{1,4})\s*\}\$|\^\{\s*(\d{1,4})\s*\}")
INTEXT_ROMAN_BRACKET_RE = re.compile(r"\[([ivxlcdm]{1,7})\]", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(19|20)\d{2}[a-z]?\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://[^\s)>\]]+", re.IGNORECASE)
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
MD_PAGE_MARK_RE = re.compile(r"^\s*<!--\s*page:\s*(\d+)\s*-->\s*$", re.IGNORECASE)
MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)")
MD_HTML_IMG_RE = re.compile(r"<img\b[^>]*\bsrc=[\"']([^\"']+)[\"'][^>]*>", re.IGNORECASE)
MD_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*$")
INTEXT_NUM_BRACKET_RE = re.compile(r"\[(\d{1,3})\]")

OUTPUT_SCHEMA_VERSION = "missing_footnote_agent_output.v2"
AGENT_VERSION = "2026.02.17-r5"
DEFAULT_ARTIFACT_TAXONOMY: dict[str, Any] = {
    "AttributionArtifact": {
        "AttackArtifact": {
            "EvidentiaryArtifacts": {
                "IndicatorsOfCompromise": [
                    "IPAddresses",
                    "DomainNames",
                    "EmailAddresses",
                    "CryptographicHashes",
                    "DigitalSignaturesAndCertificates",
                    "URLs",
                ],
                "C&CInfrastructure": [
                    "HostingProviders",
                    "CommunicationProtocols",
                    "EncryptionMethods",
                ],
                "CryptocurrencyTransactions": [
                    "WalletAddresses",
                    "TransactionPatterns",
                ],
            },
            "BehavioralArtifacts": {
                "TTPs": [
                    "InitialAccess",
                    "Execution",
                    "Persistence",
                    "PrivilegeEscalation",
                    "DefenseEvasion",
                    "CredentialAccess",
                    "Discovery",
                    "LateralMovement",
                    "Collection",
                    "Exfiltration",
                    "CommandAndControl",
                    "Impact",
                ],
                "MalwareAndCodeAnalysis": [
                    "StaticAnalysis",
                    "DynamicAnalysis",
                    "HybridAnalysis",
                ],
                "Toolchains": [
                    "ExploitKits",
                    "RemoteAccessToolsRATs",
                    "CustomScripts",
                ],
                "LanguageAndWritingStyles": [
                    "CodeComments",
                    "PhishingEmailText",
                    "RansomNotes",
                ],
            },
        },
        "NonAttackArtifact": {
            "OSINTArtifacts": {
                "PublicClaimsAndHackerForums": [
                    "HackerGroupAnnouncements",
                    "SocialMediaPosts",
                    "DarkMarketplaces",
                ],
                "ThreatIntelligenceDatabases": [
                    "STIX_TAXII_Feeds",
                    "ProprietaryThreatIntelligencePlatforms",
                ],
            },
            "ExternalArtifacts": {
                "Geopolitical": [
                    "NationStateConflicts",
                    "RegionalTensions",
                    "EconomicSanctions",
                ],
                "Victimology": [
                    "TargetedIndustrySectors",
                    "GeographicLocationsOfVictims",
                    "SpecificOrganizationsTargeted",
                ],
                "PostIncidentCommunications": [
                    "RansomDemands",
                    "ExtortionThreats",
                ],
                "TimeZoneAnalysis": [
                    "TimestampsInLogs",
                    "WorkingHoursOfAttackerActivity",
                ],
            },
        },
    }
}


@dataclass
class InferenceHit:
    page_index: int
    score: float
    reason: str


@dataclass
class PageProof:
    found: bool
    page_index: int
    line: str
    text: str
    reason: str


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return obj if isinstance(obj, dict) else {}


def _save_json(path: Path, obj: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _cache_key(prefix: str, payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{prefix}:{h}"


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _flatten_taxonomy_paths(node: Any, prefix: list[str] | None = None) -> list[str]:
    prefix = prefix or []
    out: list[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            out.extend(_flatten_taxonomy_paths(v, prefix + [str(k)]))
    elif isinstance(node, list):
        for it in node:
            if isinstance(it, str):
                out.append(" > ".join(prefix + [it]))
            else:
                out.extend(_flatten_taxonomy_paths(it, prefix))
    elif isinstance(node, str):
        out.append(" > ".join(prefix + [node]))
    return out


def _taxonomy_keyword_map(taxonomy: dict[str, Any]) -> dict[str, str]:
    m: dict[str, str] = {}
    for path in _flatten_taxonomy_paths(taxonomy):
        parts = [p.strip() for p in path.split(">")]
        for p in parts:
            key = _slug(p)
            if key and key not in m:
                m[key] = path
    # common alias boosts
    alias = {
        "ioc": "AttributionArtifact > AttackArtifact > EvidentiaryArtifacts > IndicatorsOfCompromise > URLs",
        "cnc": "AttributionArtifact > AttackArtifact > EvidentiaryArtifacts > C&CInfrastructure > CommunicationProtocols",
        "rat": "AttributionArtifact > AttackArtifact > BehavioralArtifacts > Toolchains > RemoteAccessToolsRATs",
        "phishing": "AttributionArtifact > AttackArtifact > BehavioralArtifacts > LanguageAndWritingStyles > PhishingEmailText",
        "ransom": "AttributionArtifact > NonAttackArtifact > ExternalArtifacts > PostIncidentCommunications > RansomDemands",
    }
    for k, v in alias.items():
        m.setdefault(k, v)
    return m


def _roman_to_int(s: str) -> int | None:
    vals = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    t = (s or "").strip().upper()
    if not t or any(ch not in vals for ch in t):
        return None
    total = 0
    prev = 0
    for ch in reversed(t):
        v = vals[ch]
        if v < prev:
            total -= v
        else:
            total += v
            prev = v
    if total <= 0 or total > 1000:
        return None
    return total


def _resolve_markdown_path(pdf_path: Path, markdown_arg: str) -> Path:
    if markdown_arg:
        p = Path(markdown_arg).expanduser().resolve()
        if not p.is_file():
            raise FileNotFoundError(f"markdown not found: {p}")
        return p
    candidate = pdf_path.with_suffix(".md")
    if candidate.is_file():
        return candidate.resolve()
    raise FileNotFoundError(
        "No markdown provided and no cached sidecar markdown found. "
        f"Expected: {candidate}"
    )


def _extract_pdf_pages(pdf_path: Path) -> list[str]:
    try:
        import fitz  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"fitz/PyMuPDF is required: {exc}") from exc
    pages: list[str] = []
    with fitz.open(str(pdf_path)) as doc:
        for page in doc:
            pages.append(page.get_text("text") or "")
    return pages


def _split_markdown_pages(markdown_text: str) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    cur_lines: list[str] = []
    cur_idx = 0
    saw_markers = False
    for raw in (markdown_text or "").splitlines():
        m = MD_PAGE_MARK_RE.match(raw or "")
        if m:
            saw_markers = True
            if cur_lines:
                pages.append({"page_index": cur_idx, "text": "\n".join(cur_lines)})
                cur_lines = []
            try:
                cur_idx = max(0, int(m.group(1)) - 1)
            except Exception:
                cur_idx = len(pages)
            continue
        cur_lines.append(raw)
    if cur_lines:
        pages.append({"page_index": cur_idx if saw_markers else len(pages), "text": "\n".join(cur_lines)})
    return pages if pages else [{"page_index": 0, "text": markdown_text or ""}]


def _extract_paragraphs_with_lines(page_text: str) -> list[dict[str, Any]]:
    lines = (page_text or "").splitlines()
    paras: list[dict[str, Any]] = []
    buf: list[str] = []
    start = -1
    for idx, raw in enumerate(lines):
        if raw.strip():
            if start < 0:
                start = idx
            buf.append(raw.strip())
            continue
        if buf:
            paras.append(
                {
                    "start_line": start,
                    "end_line": idx - 1,
                    "text": re.sub(r"\s+", " ", " ".join(buf)).strip(),
                }
            )
            buf = []
            start = -1
    if buf:
        paras.append(
            {
                "start_line": start,
                "end_line": len(lines) - 1,
                "text": re.sub(r"\s+", " ", " ".join(buf)).strip(),
            }
        )
    return paras


def _visual_context_for_lines(
    *,
    page_text: str,
    start_line: int | None,
    end_line: int | None,
    max_chars: int = 700,
) -> tuple[str, str]:
    paras = _extract_paragraphs_with_lines(page_text)
    if not paras:
        return "", ""
    if start_line is None or start_line < 0:
        if len(paras) >= 2:
            before = paras[0]["text"]
            after = paras[1]["text"]
            return str(before)[:max_chars], str(after)[:max_chars]
        # Single-paragraph fallback: split by line windows.
        lines = [ln.strip() for ln in (page_text or "").splitlines() if ln.strip()]
        if not lines:
            return "", ""
        cut = min(len(lines), 18)
        before = re.sub(r"\s+", " ", " ".join(lines[:cut])).strip()
        after = re.sub(r"\s+", " ", " ".join(lines[cut : cut * 2])).strip()
        return before[:max_chars], after[:max_chars]

    s = max(0, int(start_line))
    e = max(s, int(end_line if end_line is not None else s))
    cur_idx = -1
    for i, p in enumerate(paras):
        ps = int(p.get("start_line") or 0)
        pe = int(p.get("end_line") or ps)
        if not (pe < s or ps > e):
            cur_idx = i
            break
    if cur_idx < 0:
        # Fallback: nearest paragraph by start line distance.
        cur_idx = min(
            range(len(paras)),
            key=lambda i: abs(int(paras[i].get("start_line") or 0) - s),
        )
    before = str(paras[cur_idx - 1]["text"]) if cur_idx - 1 >= 0 else ""
    after = str(paras[cur_idx + 1]["text"]) if cur_idx + 1 < len(paras) else ""
    return before[:max_chars], after[:max_chars]


def _resolve_env_key(env_name: str) -> str:
    val = (os.getenv(env_name, "") or "").strip()
    if val:
        return val
    env_path = REPO_ROOT / "annotarium" / ".env"
    if env_path.is_file():
        for raw in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == env_name:
                return v.strip().strip('"').strip("'")
    return ""


def _decode_maybe_data_uri_base64(raw: str) -> bytes:
    import base64

    s = (raw or "").strip()
    if "," in s and s.lower().startswith("data:"):
        s = s.split(",", 1)[1]
    return base64.b64decode(s)


def _collect_visuals_from_mistral(
    *,
    pdf_path: Path,
    cache_path: Path,
    images_dir: Path,
    model: str = "mistral-ocr-latest",
    api_key_env: str = "MISTRAL_API_KEY",
    use_cache: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    meta: dict[str, Any] = {"source": "mistral_ocr", "used_cache": False}
    raw: dict[str, Any] = {}
    if use_cache and cache_path.is_file():
        try:
            obj = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(obj, dict):
                raw = obj
                meta["used_cache"] = True
        except Exception:
            raw = {}

    if not raw:
        api_key = _resolve_env_key(api_key_env)
        if not api_key:
            meta["error"] = f"missing {api_key_env}"
            return [], [], meta
        import base64

        b64_pdf = base64.b64encode(pdf_path.read_bytes()).decode("ascii")
        payload = {
            "model": model,
            "document": {
                "type": "document_url",
                "document_url": f"data:application/pdf;base64,{b64_pdf}",
            },
            "include_image_base64": True,
            "table_format": "html",
        }
        req = urllib.request.Request(
            url="https://api.mistral.ai/v1/ocr",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                txt = resp.read().decode("utf-8", errors="replace")
            obj = json.loads(txt)
            raw = obj if isinstance(obj, dict) else {}
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            meta["error"] = f"mistral_ocr_request_failed:{type(exc).__name__}"
            return [], [], meta

    pages = raw.get("pages") if isinstance(raw.get("pages"), list) else []
    tables: list[dict[str, Any]] = []
    images: list[dict[str, Any]] = []
    images_dir.mkdir(parents=True, exist_ok=True)

    for pi, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        pidx = int(page.get("index") if str(page.get("index", "")).isdigit() else pi)
        p_tables = page.get("tables") if isinstance(page.get("tables"), list) else []
        for ti, tab in enumerate(p_tables):
            if not isinstance(tab, dict):
                continue
            html_table = str(tab.get("html") or "")
            rows = _parse_html_table_to_rows(html_table)
            header, body, issues = _normalize_table_rows(rows) if rows else ([], [], ["html_parse_empty"])
            tables.append(
                {
                    "source": "mistral_ocr",
                    "page_index": pidx,
                    "table_id": str(tab.get("id") or f"mistral_tbl_{pidx}_{ti}"),
                    "html": html_table,
                    "row_count": len(body),
                    "col_count": len(header) if header else 0,
                    "headers": header,
                    "rows_sample": body[:8],
                    "issues": issues,
                    "quality_score": _table_quality_score(header, body, issues),
                }
            )
        p_images = page.get("images") if isinstance(page.get("images"), list) else []
        for ii, im in enumerate(p_images):
            if not isinstance(im, dict):
                continue
            image_id = str(im.get("id") or f"mistral_img_{pidx}_{ii}")
            b64 = str(im.get("image_base64") or im.get("imageBase64") or "")
            out_file = ""
            if b64:
                ext = ".png"
                if "." in image_id and len(image_id.rsplit(".", 1)[-1]) <= 5:
                    ext = "." + image_id.rsplit(".", 1)[-1]
                safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", image_id)
                if not safe_name.endswith(ext):
                    safe_name += ext
                fp = images_dir / safe_name
                try:
                    fp.write_bytes(_decode_maybe_data_uri_base64(b64))
                    out_file = str(fp.resolve())
                except Exception:
                    out_file = ""
            images.append(
                {
                    "source": "mistral_ocr",
                    "page_index": pidx,
                    "image_id": image_id,
                    "mime_type": str(im.get("mime_type") or im.get("mimeType") or ""),
                    "file_path": out_file,
                    "has_base64": bool(b64),
                }
            )

    page_markdown_by_index: dict[str, str] = {}
    for pi, page in enumerate(pages):
        if isinstance(page, dict):
            pidx = int(page.get("index") if str(page.get("index", "")).isdigit() else pi)
            pmd = str(page.get("markdown") or "")
            if pmd.strip():
                page_markdown_by_index[str(pidx)] = pmd
    meta["pages_count"] = len(pages)
    meta["tables_count"] = len(tables)
    meta["images_count"] = len(images)
    meta["page_markdown_by_index"] = page_markdown_by_index
    meta["cache_path"] = str(cache_path.resolve())
    meta["images_dir"] = str(images_dir.resolve())
    return tables, images, meta


def _mistral_ocr_single_image_text(
    *,
    image_path: Path,
    model: str,
    api_key_env: str,
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> str:
    ck = _cache_key(
        "mistral_image_ocr",
        {"image_path": str(image_path.resolve()), "size": image_path.stat().st_size, "model": model},
    )
    if use_cache and llm_cache is not None and ck in llm_cache:
        return str(llm_cache.get(ck) or "")

    api_key = _resolve_env_key(api_key_env)
    if not api_key:
        return ""
    import base64

    mime = "image/png"
    sfx = image_path.suffix.lower()
    if sfx in (".jpg", ".jpeg"):
        mime = "image/jpeg"
    elif sfx == ".webp":
        mime = "image/webp"

    b64_img = base64.b64encode(image_path.read_bytes()).decode("ascii")
    payload = {
        "model": model,
        "document": {
            "type": "document_url",
            "document_url": f"data:{mime};base64,{b64_img}",
        },
        "include_image_base64": False,
        "table_format": "html",
    }
    req = urllib.request.Request(
        url="https://api.mistral.ai/v1/ocr",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            obj = json.loads(resp.read().decode("utf-8", errors="replace"))
        pages = obj.get("pages") if isinstance(obj, dict) else []
        txt_parts: list[str] = []
        if isinstance(pages, list):
            for p in pages:
                if isinstance(p, dict):
                    md = str(p.get("markdown") or "")
                    if md.strip():
                        txt_parts.append(md.strip())
        text = "\n".join(txt_parts).strip()
        if llm_cache is not None:
            llm_cache[ck] = text
        return text
    except Exception:
        return ""


def _extract_artifacts_from_image_text(
    *,
    image_id: str,
    page_index: int,
    text: str,
    keyword_map: dict[str, str],
) -> list[dict[str, Any]]:
    t = (text or "").strip()
    if not t:
        return []
    low = _slug(t)
    out: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for key, path in keyword_map.items():
        if key and key in low and path not in seen_paths:
            seen_paths.add(path)
            out.append(
                {
                    "source_type": "image",
                    "source_id": image_id,
                    "page_index": page_index,
                    "category_path": path,
                    "artifact_value": t[:500],
                    "evidence_excerpt": t[:240],
                    "is_artifact": True,
                    "explanation": "Deterministic keyword match in OCR text from image content.",
                    "justification": (
                        "Marked as artifact because OCR text explicitly matches known attribution taxonomy "
                        "signals (deterministic keyword rule)."
                    ),
                    "confidence": 0.66,
                }
            )
    return out


def _extract_image_artifacts_with_gpt(
    *,
    image: dict[str, Any],
    ocr_text: str,
    context_before: str,
    context_after: str,
    taxonomy_paths: list[str],
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    sample = {
        "image_id": image.get("image_id"),
        "page_index": image.get("page_index"),
        "source": image.get("source"),
        "alt_text": image.get("alt_text"),
        "uri": image.get("uri"),
        "title": image.get("title"),
        "ocr_text": (ocr_text or "")[:4000],
        "context_before": context_before,
        "context_after": context_after,
    }
    ck = _cache_key("image_artifacts_gpt_v2", sample)
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache.get(ck)
        return val if isinstance(val, list) else []

    schema_wrapper = {
        "name": "image_artifacts_extraction",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "artifacts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "category_path": {"type": "string"},
                            "artifact_type": {"type": "string"},
                            "artifact_value": {"type": "string"},
                            "evidence_excerpt": {"type": "string"},
                            "is_artifact": {"type": "boolean"},
                            "explanation": {"type": "string"},
                            "justification": {"type": "string"},
                            "confidence": {"type": "number"},
                        },
                        "required": [
                            "category_path",
                            "artifact_type",
                            "artifact_value",
                            "evidence_excerpt",
                            "is_artifact",
                            "explanation",
                            "justification",
                            "confidence",
                        ],
                    },
                }
            },
            "required": ["artifacts"],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Extract cyber attribution artifacts from one image. "
                "Use OCR text and adjacent markdown context (paragraph before/after). "
                "Include artifacts such as location, building, infrastructure, organization, or attacker-linked evidence "
                "when they are explicit in the provided data. "
                "For every returned item set is_artifact=true/false and provide justification: "
                "if true explain why it supports cyber attribution evidence; "
                "if false explain why it is insufficient/ambiguous/non-attribution."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Taxonomy paths:\n- " + "\n- ".join(taxonomy_paths[:200]) + "\n\n"
                f"Image sample JSON:\n{json.dumps(sample, ensure_ascii=False)}"
            ),
        },
    ]
    try:
        out = run_structured_step(
            step=f"extract_image_artifacts_{image.get('image_id')}",
            messages=messages,
            schema_wrapper=schema_wrapper,
            config=OpenAIStructuredStepConfig(
                model="gpt-5-mini",
                fallback_models=["gpt-4o-mini"],
                temperature=0.0,
                max_completion_tokens=1400,
                retries_per_model=2,
            ),
        )
        payload = out.response_json or {}
        artifacts = payload.get("artifacts") if isinstance(payload, dict) else []
        cleaned = [a for a in artifacts if isinstance(a, dict)]
        if llm_cache is not None:
            llm_cache[ck] = cleaned
        return cleaned
    except Exception:
        return []


def _extract_table_artifacts_with_gpt(
    *,
    table: dict[str, Any],
    context_before: str,
    context_after: str,
    taxonomy_paths: list[str],
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    sample = {
        "table_id": table.get("table_id"),
        "page_index": table.get("page_index"),
        "headers": table.get("headers") or [],
        "rows_sample": table.get("rows_sample") or table.get("preview_rows") or [],
        "source": table.get("source"),
        "context_before": context_before,
        "context_after": context_after,
    }
    ck = _cache_key("table_artifacts_gpt_v2", sample)
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache.get(ck)
        return val if isinstance(val, list) else []

    schema_wrapper = {
        "name": "table_artifacts_extraction",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "artifacts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "category_path": {"type": "string"},
                            "artifact_type": {"type": "string"},
                            "artifact_value": {"type": "string"},
                            "evidence_excerpt": {"type": "string"},
                            "is_artifact": {"type": "boolean"},
                            "explanation": {"type": "string"},
                            "justification": {"type": "string"},
                            "confidence": {"type": "number"},
                        },
                        "required": [
                            "category_path",
                            "artifact_type",
                            "artifact_value",
                            "evidence_excerpt",
                            "is_artifact",
                            "explanation",
                            "justification",
                            "confidence",
                        ],
                    },
                }
            },
            "required": ["artifacts"],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Assess cyber attribution evidence from one table sample and neighboring text context. "
                "For each returned item set is_artifact=true/false. "
                "If true, justification must explain why it is valid attribution evidence. "
                "If false, justification must explain why it cannot be used as attribution evidence yet. "
                "Use category_path from provided taxonomy paths."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Taxonomy paths:\n- " + "\n- ".join(taxonomy_paths[:200]) + "\n\n"
                f"Table sample JSON:\n{json.dumps(sample, ensure_ascii=False)}"
            ),
        },
    ]
    try:
        out = run_structured_step(
            step=f"extract_table_artifacts_{table.get('table_id')}",
            messages=messages,
            schema_wrapper=schema_wrapper,
            config=OpenAIStructuredStepConfig(
                model="gpt-5-mini",
                fallback_models=["gpt-4o-mini"],
                temperature=0.0,
                max_completion_tokens=1200,
                retries_per_model=2,
            ),
        )
        payload = out.response_json or {}
        artifacts = payload.get("artifacts") if isinstance(payload, dict) else []
        cleaned = [a for a in artifacts if isinstance(a, dict)]
        if llm_cache is not None:
            llm_cache[ck] = cleaned
        return cleaned
    except Exception:
        return []


def _collect_images_from_markdown(markdown_text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    pages = _split_markdown_pages(markdown_text)
    rid = 0
    for pg in pages:
        text = str(pg.get("text") or "")
        pidx = int(pg.get("page_index") or 0)
        for m in MD_IMAGE_RE.finditer(text):
            rid += 1
            start_line = text[: m.start()].count("\n")
            end_line = text[: m.end()].count("\n")
            out.append(
                {
                    "source": "markdown",
                    "page_index": pidx,
                    "image_id": f"md_img_{rid}",
                    "start_line": start_line,
                    "end_line": end_line,
                    "alt_text": (m.group(1) or "").strip(),
                    "uri": (m.group(2) or "").strip(),
                    "title": (m.group(3) or "").strip(),
                }
            )
        for m in MD_HTML_IMG_RE.finditer(text):
            rid += 1
            start_line = text[: m.start()].count("\n")
            end_line = text[: m.end()].count("\n")
            out.append(
                {
                    "source": "markdown",
                    "page_index": pidx,
                    "image_id": f"md_img_{rid}",
                    "start_line": start_line,
                    "end_line": end_line,
                    "alt_text": "",
                    "uri": (m.group(1) or "").strip(),
                    "title": "",
                }
            )
    return out


def _collect_tables_from_markdown(markdown_text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    pages = _split_markdown_pages(markdown_text)
    tid = 0
    for pg in pages:
        text = str(pg.get("text") or "")
        pidx = int(pg.get("page_index") or 0)
        lines = text.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            if "|" not in line:
                i += 1
                continue
            # Require a markdown table header separator on next line.
            if i + 1 >= len(lines):
                i += 1
                continue
            sep = lines[i + 1].strip()
            if not re.search(r"^\s*\|?[\s:-]+\|[\s|:-]*\|?\s*$", sep):
                i += 1
                continue
            block = [line, lines[i + 1]]
            j = i + 2
            while j < len(lines) and "|" in lines[j] and lines[j].strip():
                block.append(lines[j])
                j += 1
            # Parse rows/cells
            rows: list[list[str]] = []
            for bl in block:
                r = bl.strip().strip("|")
                cells = [c.strip() for c in r.split("|")]
                rows.append(cells)
            tid += 1
            header, body, issues = _normalize_table_rows(rows)
            out.append(
                {
                    "source": "markdown",
                    "page_index": pidx,
                    "table_id": f"md_tbl_{tid}",
                    "start_line": i,
                    "end_line": j - 1,
                    "raw_markdown": "\n".join(block),
                    "row_count": len(body),
                    "col_count": len(header) if header else max((len(r) for r in rows), default=0),
                    "headers": header,
                    "rows_sample": body[:8],
                    "preview_rows": rows[:6],
                    "issues": issues,
                    "quality_score": _table_quality_score(header, body, issues),
                }
            )
            i = j
    return out


class _SimpleHTMLTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_tr = False
        self.in_cell = False
        self.cur_cell = ""
        self.cur_row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = (tag or "").lower()
        if t == "tr":
            self.in_tr = True
            self.cur_row = []
        elif t in ("td", "th") and self.in_tr:
            self.in_cell = True
            self.cur_cell = ""

    def handle_endtag(self, tag: str) -> None:
        t = (tag or "").lower()
        if t in ("td", "th") and self.in_cell:
            self.in_cell = False
            self.cur_row.append(re.sub(r"\s+", " ", self.cur_cell).strip())
            self.cur_cell = ""
        elif t == "tr" and self.in_tr:
            self.in_tr = False
            if self.cur_row:
                self.rows.append(self.cur_row)
            self.cur_row = []

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.cur_cell += data


def _normalize_table_rows(rows: list[list[str]]) -> tuple[list[str], list[list[str]], list[str]]:
    issues: list[str] = []
    if not rows:
        return [], [], ["empty_rows"]
    widths = [len(r) for r in rows if isinstance(r, list)]
    if not widths:
        return [], [], ["invalid_rows"]
    max_cols = max(widths)
    if max_cols == 0:
        return [], [], ["zero_columns"]
    padded: list[list[str]] = []
    for r in rows:
        rr = [re.sub(r"\s+", " ", str(c or "")).strip() for c in r]
        if len(rr) < max_cols:
            rr += [""] * (max_cols - len(rr))
        padded.append(rr[:max_cols])
    header = padded[0]
    body = padded[1:] if len(padded) > 1 else []
    # Drop markdown separator row like --- | --- if it slipped in
    if body:
        sep_like = all(re.fullmatch(r"[:\- ]{3,}", c or "") is not None for c in body[0])
        if sep_like:
            body = body[1:]
            issues.append("dropped_separator_row")
    if len(body) == 0:
        issues.append("no_body_rows")
    if len(set(tuple(r) for r in body[:5])) <= 1 and len(body) > 1:
        issues.append("low_row_diversity")
    return header, body, issues


def _parse_html_table_to_rows(html_str: str) -> list[list[str]]:
    p = _SimpleHTMLTableParser()
    try:
        p.feed(html.unescape(html_str or ""))
        p.close()
    except Exception:
        return []
    return p.rows


def _table_quality_score(header: list[str], body: list[list[str]], issues: list[str]) -> float:
    score = 0.5
    if header:
        score += 0.15
    if len(body) >= 2:
        score += 0.15
    if len(header) >= 2:
        score += 0.1
    if not issues:
        score += 0.1
    score -= min(0.2, 0.05 * len(issues))
    return round(max(0.0, min(1.0, score)), 3)


def _dedupe_tables(tables: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[int, str, str]] = set()
    for t in tables:
        if not isinstance(t, dict):
            continue
        p = int(t.get("page_index") or 0)
        header = "|".join(str(x) for x in (t.get("headers") or [])[:8])
        rows = t.get("rows_sample") if isinstance(t.get("rows_sample"), list) else []
        first = ""
        if rows and isinstance(rows[0], list):
            first = "|".join(str(x) for x in rows[0][:8])
        sig = (p, header, first)
        if sig in seen:
            continue
        seen.add(sig)
        out.append(t)
    return out


def _collect_images_from_pdf(pdf_path: Path) -> list[dict[str, Any]]:
    try:
        import fitz  # type: ignore
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    with fitz.open(str(pdf_path)) as doc:
        for pidx, page in enumerate(doc):
            try:
                imgs = page.get_images(full=True)
            except Exception:
                imgs = []
            for i, img in enumerate(imgs):
                xref = int(img[0]) if len(img) > 0 else -1
                width = int(img[2]) if len(img) > 2 else None
                height = int(img[3]) if len(img) > 3 else None
                bpc = int(img[4]) if len(img) > 4 else None
                colorspace = str(img[5]) if len(img) > 5 else ""
                rects = []
                if xref > 0:
                    try:
                        for r in page.get_image_rects(xref):
                            rects.append([float(r.x0), float(r.y0), float(r.x1), float(r.y1)])
                    except Exception:
                        pass
                out.append(
                    {
                        "page_index": pidx,
                        "image_id": f"p{pidx}_img{i}",
                        "xref": xref,
                        "width": width,
                        "height": height,
                        "bits_per_component": bpc,
                        "colorspace": colorspace,
                        "bbox_rects": rects,
                    }
                )
    return out


def _collect_tables_from_pdf(pdf_path: Path) -> list[dict[str, Any]]:
    try:
        import fitz  # type: ignore
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    with fitz.open(str(pdf_path)) as doc:
        for pidx, page in enumerate(doc):
            try:
                finder = page.find_tables()
                tables = list(getattr(finder, "tables", []) or [])
            except Exception:
                tables = []
            for tidx, table in enumerate(tables):
                try:
                    rows = table.extract() or []
                except Exception:
                    rows = []
                row_count = len(rows)
                col_count = 0
                if row_count:
                    col_count = max(len(r) if isinstance(r, list) else 0 for r in rows)
                norm_rows = [[str(c or "").strip() for c in r] for r in rows if isinstance(r, list)]
                header, body, issues = _normalize_table_rows(norm_rows) if norm_rows else ([], [], ["extract_empty"])
                bbox = None
                try:
                    b = table.bbox
                    bbox = [float(b[0]), float(b[1]), float(b[2]), float(b[3])]
                except Exception:
                    bbox = None
                preview = rows[:5] if isinstance(rows, list) else []
                out.append(
                    {
                        "page_index": pidx,
                        "table_id": f"p{pidx}_tbl{tidx}",
                        "row_count": row_count,
                        "col_count": col_count,
                        "headers": header,
                        "rows_sample": body[:8],
                        "bbox": bbox,
                        "preview_rows": preview,
                        "issues": issues,
                        "quality_score": _table_quality_score(header, body, issues),
                    }
                )
    return out


def _preceding_context(text: str, pos: int, max_chars: int = 220) -> str:
    start = max(0, pos - max_chars)
    window = text[start:pos]
    line = window.splitlines()[-1].strip() if window else ""
    if not line:
        return window.strip()
    return line


def _extract_all_intext_markers(markdown_text: str) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for m in INTEXT_TEX_RE.finditer(markdown_text or ""):
        idx_raw = m.group(1) or m.group(2)
        if not idx_raw or not idx_raw.isdigit():
            continue
        idx = int(idx_raw)
        hits.append(
            {
                "index": idx,
                "intext_citation": m.group(0),
                "preceding_text": _preceding_context(markdown_text, m.start()),
                "start": m.start(),
            }
        )
    return hits


def _extract_roman_intext_markers(markdown_text: str) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for m in INTEXT_ROMAN_BRACKET_RE.finditer(markdown_text or ""):
        idx = _roman_to_int(m.group(1))
        if idx is None:
            continue
        hits.append(
            {
                "index": idx,
                "intext_citation": m.group(0),
                "preceding_text": _preceding_context(markdown_text, m.start()),
                "start": m.start(),
                "citation_style": "roman",
                "citation_type": "in_text",
            }
        )
    return hits


def _collect_intext_hits_from_citations(citations: dict[str, Any], markdown_text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def valid_author_year_candidate(index_raw: Any, intext_raw: str) -> bool:
        idx_s = str(index_raw or "").strip()
        cit = str(intext_raw or "").strip()
        # Must have a plausible 4-digit year either in citation text or index suffix.
        if YEAR_RE.search(cit):
            return True
        if "|" in idx_s:
            tail = idx_s.rsplit("|", 1)[-1].strip()
            if YEAR_RE.fullmatch(tail):
                return True
        return False

    def add_from_bucket(bucket_name: str, style_name: str) -> None:
        bucket = citations.get(bucket_name) if isinstance(citations.get(bucket_name), dict) else {}
        results = bucket.get("results") if isinstance(bucket.get("results"), list) else []
        for r in results:
            if not isinstance(r, dict):
                continue
            idx_raw = r.get("index")
            intext_citation = str(r.get("intext_citation") or "")
            if style_name == "author_year" and not valid_author_year_candidate(idx_raw, intext_citation):
                continue
            idx: int | None = None
            if isinstance(idx_raw, int):
                idx = idx_raw
            elif str(idx_raw).isdigit():
                idx = int(str(idx_raw))
            out.append(
                {
                    "index": idx if idx is not None else str(idx_raw or ""),
                    "intext_citation": intext_citation,
                    "preceding_text": str(r.get("preceding_text") or ""),
                    "start": int(r.get("position") or r.get("start") or -1),
                    "footnote": r.get("footnote"),
                    "citation_style": style_name,
                    "citation_type": "in_text",
                }
            )

    # Existing parser buckets.
    add_from_bucket("tex", "tex_superscript")
    add_from_bucket("numeric", "numeric")
    add_from_bucket("author_year", "author_year")

    # Dedicated footnotes bucket in parser output.
    foot = citations.get("footnotes") if isinstance(citations.get("footnotes"), dict) else {}
    intext = foot.get("intext") if isinstance(foot.get("intext"), list) else []
    for r in intext:
        if not isinstance(r, dict):
            continue
        idx_raw = r.get("index")
        idx = int(idx_raw) if str(idx_raw).isdigit() else str(idx_raw or "")
        out.append(
            {
                "index": idx,
                "intext_citation": str(r.get("intext_citation") or ""),
                "preceding_text": str(r.get("preceding_text") or ""),
                "start": int(r.get("position") or r.get("start") or -1),
                "footnote": r.get("footnote"),
                "citation_style": "footnote",
                "citation_type": "in_text",
            }
        )

    # Fallbacks from markdown scan.
    for h in _extract_all_intext_markers(markdown_text):
        h2 = dict(h)
        h2["citation_style"] = "tex_superscript"
        h2["citation_type"] = "in_text"
        out.append(h2)
    out.extend(_extract_roman_intext_markers(markdown_text))

    # Dedupe light: (style, index, anchor, start)
    seen: set[tuple[str, str, str, int]] = set()
    deduped: list[dict[str, Any]] = []
    for h in out:
        style = str(h.get("citation_style") or "")
        idx = str(h.get("index") or "")
        anchor = str(h.get("intext_citation") or "")
        start = int(h.get("start") or -1)
        key = (style, idx, anchor, start)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(h)
    return deduped


def _line_to_index_and_body(raw: str) -> tuple[int | None, str]:
    m = NUM_LINE_RE.match(raw)
    if m:
        return int(m.group(1)), (m.group(2) or "").strip()
    m2 = SUP_LINE_RE.match(raw)
    if m2:
        idx_raw = m2.group(1).translate(SUP_MAP)
        if idx_raw.isdigit():
            return int(idx_raw), (m2.group(2) or "").strip()
    m3 = ROMAN_LINE_RE.match(raw)
    if m3:
        idx = _roman_to_int(m3.group(1))
        if idx is not None:
            return idx, (m3.group(2) or "").strip()
    return None, ""


def _extract_page_footnote_blocks(page_text: str) -> dict[int, tuple[str, str]]:
    """
    Return idx -> (first_line, merged_text) using multiline block parsing.
    This prevents truncating wrapped footnote lines.
    """
    lines = (page_text or "").splitlines()
    out: dict[int, tuple[str, str]] = {}
    cur_idx: int | None = None
    cur_first_line = ""
    cur_chunks: list[str] = []

    def flush() -> None:
        nonlocal cur_idx, cur_first_line, cur_chunks
        if cur_idx is None:
            return
        merged = re.sub(r"\s+", " ", " ".join(x.strip() for x in cur_chunks if x.strip())).strip()
        if merged:
            prev = out.get(cur_idx)
            # Keep the richer candidate when OCR produces duplicate short/noisy lines.
            if prev is None or len(merged) > len(prev[1]):
                out[cur_idx] = (cur_first_line, merged)
        cur_idx = None
        cur_first_line = ""
        cur_chunks = []

    def is_plausible_new_index(next_idx: int, next_body: str, prev_idx: int | None) -> bool:
        body_l = (next_body or "").strip().lower()
        if body_l.startswith("www.mandiant.com") or body_l == "www.mandiant.com":
            return False
        if next_idx <= 0:
            return False
        # Usually footnote indices are not in the thousands; avoid year/org-number false starts.
        if next_idx >= 1000:
            return False
        if prev_idx is None:
            return True
        if next_idx == prev_idx:
            return False
        # Huge jumps are often OCR artifacts (e.g., "Project 2049 Institute ...").
        if (next_idx - prev_idx) > 10 and next_idx >= 100:
            return False
        if next_idx >= 100 and any(tok in body_l for tok in ("of the", "of ", "ip addresses", "part of", "table ")):
            return False
        # Common continuation cue after a wrapped citation/title break.
        if next_body and next_body[:1].islower():
            return False
        return True

    for raw in lines:
        idx, body = _line_to_index_and_body(raw)
        if idx is not None and is_plausible_new_index(idx, body, cur_idx):
            flush()
            cur_idx = idx
            cur_first_line = raw
            if body:
                cur_chunks.append(body)
            continue
        if cur_idx is not None:
            chunk = raw.strip()
            if chunk:
                cur_chunks.append(chunk)
            elif cur_chunks:
                cur_chunks.append(" ")
    flush()
    return out


def _scan_page_defs(page_text: str) -> dict[int, str]:
    blocks = _extract_page_footnote_blocks(page_text)
    return {idx: text for idx, (_, text) in blocks.items()}


def _find_exact_definition_on_page(page_text: str, idx: int) -> PageProof:
    blocks = _extract_page_footnote_blocks(page_text)
    hit = blocks.get(idx)
    if hit:
        first_line, txt = hit
        if len(txt) >= 20:
            return PageProof(True, -1, first_line, txt, "multiline_block_match")

    # Fallback to single-line matching for edge OCR formats.
    for raw in (page_text or "").splitlines():
        m = NUM_LINE_RE.match(raw)
        if m and int(m.group(1)) == idx:
            txt = (m.group(2) or "").strip()
            if len(txt) >= 20:
                return PageProof(True, -1, raw, txt, "numeric_line_match")
    return PageProof(False, -1, "", "", "no_exact_definition_line")


def _load_or_parse_citations(markdown_text: str, citations_path: Path | None) -> dict[str, Any]:
    if citations_path:
        obj = json.loads(_read_text(citations_path))
        if not isinstance(obj, dict):
            raise ValueError("citations json must be an object")
        return obj
    if link_citations_to_footnotes is None:
        raise RuntimeError("footnotes parser import failed and --citations-json not provided")
    obj = link_citations_to_footnotes(markdown_text, None)
    if not isinstance(obj, dict):
        raise ValueError("footnotes parser returned invalid payload")
    return obj


def _as_int_set(values: Any) -> set[int]:
    out: set[int] = set()
    if not isinstance(values, list):
        return out
    for v in values:
        try:
            out.add(int(v))
        except Exception:
            continue
    return out


def _infer_candidate_pages(
    missing_idx: int,
    page_index_sets: list[set[int]],
    known_index_to_pages: dict[int, list[int]],
) -> list[InferenceHit]:
    hits: dict[int, InferenceHit] = {}

    def add(page: int, score: float, reason: str) -> None:
        if page < 0 or page >= len(page_index_sets):
            return
        cur = hits.get(page)
        if cur is None or score > cur.score:
            hits[page] = InferenceHit(page_index=page, score=score, reason=reason)

    for p, idxs in enumerate(page_index_sets):
        if missing_idx in idxs:
            add(p, 1.0, "exact_index_on_page")
            continue
        if not idxs:
            continue
        lo = min(idxs)
        hi = max(idxs)
        if lo <= missing_idx <= hi:
            width = max(1, hi - lo + 1)
            center = (lo + hi) / 2.0
            dist = abs(missing_idx - center)
            add(p, 0.82 - (dist / width) * 0.2, "in_page_range")
        if missing_idx == lo - 1:
            add(p, 0.65, "edge_before_range")
            add(p - 1, 0.72, "previous_page_for_edge_before")
        if missing_idx == hi + 1:
            add(p, 0.65, "edge_after_range")
            add(p + 1, 0.72, "next_page_for_edge_after")

    for delta, boost in [(-1, 0.2), (1, 0.2), (-2, 0.12), (2, 0.12)]:
        ref = missing_idx + delta
        for p in known_index_to_pages.get(ref, []):
            add(p, 0.74 + boost, f"neighbor_index_{ref}")
            add(p - 1, 0.55 + boost / 2, f"neighbor_index_{ref}_prev")
            add(p + 1, 0.55 + boost / 2, f"neighbor_index_{ref}_next")

    ordered = sorted(hits.values(), key=lambda h: (-h.score, h.page_index))
    return ordered


def _schema_wrapper() -> dict[str, Any]:
    return {
        "name": "missing_footnote_resolution",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "index": {"type": "integer"},
                "found": {"type": "boolean"},
                "inferred_page_index": {"type": "integer"},
                "footnote_text": {"type": "string"},
                "evidence": {"type": "string"},
                "confidence": {"type": "number"},
            },
            "required": [
                "index",
                "found",
                "inferred_page_index",
                "footnote_text",
                "evidence",
                "confidence",
            ],
        },
    }


def _resolve_with_gpt(
    *,
    missing_idx: int,
    candidate_pages: list[InferenceHit],
    pages_text: list[str],
    prev_known: tuple[int, str] | None,
    next_known: tuple[int, str] | None,
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> dict[str, Any]:
    if not candidate_pages:
        return {
            "index": missing_idx,
            "found": False,
            "inferred_page_index": -1,
            "footnote_text": "",
            "evidence": "no candidate pages",
            "confidence": 0.0,
        }

    best = candidate_pages[0]
    p = best.page_index
    context_pages = [x for x in [p - 1, p, p + 1] if 0 <= x < len(pages_text)]
    page_bundle = "\n\n".join(
        f"[PAGE {pi}]\n{pages_text[pi][:12000]}"
        for pi in context_pages
    )
    prev_txt = f"{prev_known[0]}: {prev_known[1]}" if prev_known else "none"
    next_txt = f"{next_known[0]}: {next_known[1]}" if next_known else "none"
    cache_payload = {
        "idx": missing_idx,
        "page": p,
        "candidate_pages": [{"p": c.page_index, "s": round(c.score, 4), "r": c.reason} for c in candidate_pages[:5]],
        "prev": prev_txt,
        "next": next_txt,
        "context_pages": context_pages,
    }
    ck = _cache_key("resolve_missing", cache_payload)
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache[ck]
        if isinstance(val, dict):
            return val

    messages = [
        {
            "role": "system",
            "content": (
                "You extract one specific missing numeric footnote from OCR-like PDF text. "
                "Use only provided page text. Do not hallucinate."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Target missing footnote index: {missing_idx}\n"
                f"Primary inferred page index: {p}\n"
                f"Candidate pages (score,reason): {[{'page':c.page_index,'score':round(c.score,3),'reason':c.reason} for c in candidate_pages[:5]]}\n"
                f"Previous known footnote: {prev_txt}\n"
                f"Next known footnote: {next_txt}\n\n"
                "Find the exact body text for this footnote index. "
                "If not found, return found=false and empty footnote_text.\n\n"
                f"{page_bundle}"
            ),
        },
    ]

    try:
        out = run_structured_step(
            step=f"resolve_missing_footnote_{missing_idx}",
            messages=messages,
            schema_wrapper=_schema_wrapper(),
            config=OpenAIStructuredStepConfig(
                model="gpt-5-mini",
                fallback_models=["gpt-4o-mini"],
                temperature=0.0,
                max_completion_tokens=1800,
                retries_per_model=2,
            ),
        )
    except OpenAIStructuredStepError as exc:
        return {
            "index": missing_idx,
            "found": False,
            "inferred_page_index": p,
            "footnote_text": "",
            "evidence": f"llm_error: {exc}",
            "confidence": 0.0,
        }

    payload = out.response_json or {}
    if not isinstance(payload, dict):
        payload = {}
    payload.setdefault("index", missing_idx)
    payload.setdefault("inferred_page_index", p)
    payload.setdefault("found", False)
    payload.setdefault("footnote_text", "")
    payload.setdefault("evidence", "")
    payload.setdefault("confidence", 0.0)
    if llm_cache is not None:
        llm_cache[ck] = payload
    return payload


def _validate_footnote_with_gpt(
    *,
    idx: int,
    page_index: int,
    extracted_text: str,
    pages_text: list[str],
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> dict[str, Any]:
    if page_index < 0 or page_index >= len(pages_text):
        return {
            "checked": False,
            "accepted": False,
            "confidence": 0.0,
            "reason": "invalid_page_index",
            "corrected_text": "",
        }
    context_pages = [x for x in [page_index - 1, page_index, page_index + 1] if 0 <= x < len(pages_text)]
    ck = _cache_key(
        "validate_footnote",
        {"idx": idx, "page_index": page_index, "text": extracted_text, "context_pages": context_pages},
    )
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache[ck]
        if isinstance(val, dict):
            return val
    page_bundle = "\n\n".join(f"[PAGE {pi}]\n{pages_text[pi][:12000]}" for pi in context_pages)
    schema_wrapper = {
        "name": "footnote_validation",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "index": {"type": "integer"},
                "accepted": {"type": "boolean"},
                "confidence": {"type": "number"},
                "reason": {"type": "string"},
                "corrected_text": {"type": "string"},
            },
            "required": ["index", "accepted", "confidence", "reason", "corrected_text"],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Validate one extracted numeric footnote against provided PDF page text. "
                "Accept only if text matches the target index content. Do not hallucinate."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Target footnote index: {idx}\n"
                f"Target page index: {page_index}\n"
                f"Extracted text to validate:\n{extracted_text}\n\n"
                "If accepted=true, corrected_text should be the best normalized full text. "
                "If rejected, corrected_text should be empty.\n\n"
                f"{page_bundle}"
            ),
        },
    ]
    try:
        out = run_structured_step(
            step=f"validate_footnote_{idx}",
            messages=messages,
            schema_wrapper=schema_wrapper,
            config=OpenAIStructuredStepConfig(
                model="gpt-5-mini",
                fallback_models=["gpt-4o-mini"],
                temperature=0.0,
                max_completion_tokens=1200,
                retries_per_model=2,
            ),
        )
        payload = out.response_json or {}
        if not isinstance(payload, dict):
            payload = {}
        out_obj = {
            "checked": True,
            "accepted": bool(payload.get("accepted")),
            "confidence": float(payload.get("confidence") or 0.0),
            "reason": str(payload.get("reason") or ""),
            "corrected_text": str(payload.get("corrected_text") or ""),
        }
        if llm_cache is not None:
            llm_cache[ck] = out_obj
        return out_obj
    except Exception as exc:
        out_obj = {
            "checked": False,
            "accepted": False,
            "confidence": 0.0,
            "reason": f"llm_validation_error:{type(exc).__name__}",
            "corrected_text": "",
        }
        if llm_cache is not None:
            llm_cache[ck] = out_obj
        return out_obj


def _extract_biblio_from_footnote_with_gpt(
    *,
    idx: int,
    page_index: int,
    footnote_text: str,
    pages_text: list[str],
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> dict[str, Any]:
    if not footnote_text.strip():
        return {"checked": False, "references": [], "reason": "empty_footnote_text"}
    context_pages = [x for x in [page_index - 1, page_index, page_index + 1] if 0 <= x < len(pages_text)]
    ck = _cache_key(
        "extract_biblio",
        {"idx": idx, "page_index": page_index, "text": footnote_text, "context_pages": context_pages},
    )
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache[ck]
        if isinstance(val, dict):
            return val
    page_bundle = "\n\n".join(f"[PAGE {pi}]\n{pages_text[pi][:10000]}" for pi in context_pages)
    schema_wrapper = {
        "name": "footnote_bibliography_extraction",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "index": {"type": "integer"},
                "references": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "authors": {"type": "array", "items": {"type": "string"}},
                            "year": {"type": "string"},
                            "title": {"type": "string"},
                            "url": {"type": "string"},
                            "doi": {"type": "string"},
                            "publisher_or_source": {"type": "string"},
                            "raw_reference": {"type": "string"},
                        },
                        "required": [
                            "authors",
                            "year",
                            "title",
                            "url",
                            "doi",
                            "publisher_or_source",
                            "raw_reference",
                        ],
                    },
                },
            },
            "required": ["index", "references"],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Extract structured bibliography entries from one footnote. "
                "Return one or more references if present. Use ONLY references that appear in the target footnote text. "
                "Do not include neighboring footnotes from page context. "
                "Do not hallucinate fields; use empty strings when unknown."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Footnote index: {idx}\n"
                f"Page index: {page_index}\n"
                f"Footnote text:\n{footnote_text}\n\n"
                "Extract list of references with authors, year, title, url, doi, source.\n"
                "If there are no bibliographic references in this footnote, return an empty list.\n\n"
                f"{page_bundle}"
            ),
        },
    ]
    try:
        out = run_structured_step(
            step=f"extract_biblio_{idx}",
            messages=messages,
            schema_wrapper=schema_wrapper,
            config=OpenAIStructuredStepConfig(
                model="gpt-5-mini",
                fallback_models=["gpt-4o-mini"],
                temperature=0.0,
                max_completion_tokens=1600,
                retries_per_model=2,
            ),
        )
        payload = out.response_json or {}
        if not isinstance(payload, dict):
            payload = {}
        refs = payload.get("references")
        if not isinstance(refs, list):
            refs = []
        cleaned: list[dict[str, Any]] = []
        foot_norm = re.sub(r"\s+", " ", footnote_text or "").strip().lower()
        def _author_token(a: str) -> str:
            parts = [p for p in re.split(r"[\s,]+", (a or "").strip()) if p]
            return parts[-1].lower() if parts else ""
        for r in refs:
            if not isinstance(r, dict):
                continue
            obj = {
                "authors": [str(a).strip() for a in (r.get("authors") or []) if str(a).strip()],
                "year": str(r.get("year") or "").strip(),
                "title": str(r.get("title") or "").strip(),
                "url": str(r.get("url") or "").strip(),
                "doi": str(r.get("doi") or "").strip(),
                "publisher_or_source": str(r.get("publisher_or_source") or "").strip(),
                "raw_reference": str(r.get("raw_reference") or "").strip(),
            }
            # Keep only references grounded in the target footnote text.
            supported = False
            if obj["url"] and obj["url"].lower() in foot_norm:
                supported = True
            if obj["doi"] and obj["doi"].lower() in foot_norm:
                supported = True
            year_ok = bool(obj["year"]) and obj["year"].lower() in foot_norm
            author_hits = 0
            for a in obj["authors"]:
                tok = _author_token(a)
                if tok and tok in foot_norm:
                    author_hits += 1
            if year_ok and author_hits >= 1:
                supported = True
            if obj["raw_reference"] and obj["raw_reference"].strip():
                raw_norm = re.sub(r"\s+", " ", obj["raw_reference"]).strip().lower()
                if raw_norm and raw_norm in foot_norm:
                    supported = True
            if supported:
                cleaned.append(obj)
        out_obj = {"checked": True, "references": cleaned, "reason": "ok"}
        if llm_cache is not None:
            llm_cache[ck] = out_obj
        return out_obj
    except Exception as exc:
        out_obj = {"checked": False, "references": [], "reason": f"llm_biblio_error:{type(exc).__name__}"}
        if llm_cache is not None:
            llm_cache[ck] = out_obj
        return out_obj


def _deterministic_biblio_fallback(footnote_text: str) -> list[dict[str, Any]]:
    txt = (footnote_text or "").strip()
    if not txt:
        return []
    urls = URL_RE.findall(txt)
    dois = DOI_RE.findall(txt.upper())
    year_m = YEAR_RE.search(txt)
    year = year_m.group(0) if year_m else ""
    refs: list[dict[str, Any]] = []
    if urls or dois or year:
        refs.append(
            {
                "authors": [],
                "year": year,
                "title": "",
                "url": urls[0] if urls else "",
                "doi": dois[0] if dois else "",
                "publisher_or_source": "",
                "raw_reference": txt,
            }
        )
    return refs


def _looks_bibliographic_text(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if URL_RE.search(t) or DOI_RE.search(t.upper()):
        return True
    has_year = bool(YEAR_RE.search(t))
    # rough author cue: at least one comma and one capitalized token near start
    has_authorish = bool(re.search(r"\b[A-Z][A-Za-z'’\-]+\b", t[:120])) and ("," in t[:180])
    return has_year and has_authorish


def _is_low_quality_footnote_text(text: str) -> bool:
    s = (text or "").strip()
    if not s:
        return True
    if len(s) < 60:
        return True
    # Common truncated OCR tail.
    if s.endswith(",") or s.endswith(";") or s.endswith(":"):
        return True
    return False


def _compatible_with_direct_anchor(direct_text: str, llm_text: str) -> bool:
    d = re.sub(r"\s+", " ", (direct_text or "").strip()).lower()
    l = re.sub(r"\s+", " ", (llm_text or "").strip()).lower()
    if not d or not l:
        return False
    d_words = d.split()
    if not d_words:
        return False
    anchor = " ".join(d_words[: min(10, len(d_words))])
    if anchor and anchor in l:
        return True
    overlap = set(d_words[:15]).intersection(set(l.split()[:40]))
    return len(overlap) >= 4


def _validate_neighbor_consistency(idx: int, page: int, known_index_to_pages: dict[int, list[int]]) -> tuple[bool, str]:
    dists: list[tuple[int, int]] = []
    for near in (idx - 1, idx + 1):
        near_pages = known_index_to_pages.get(near, [])
        if not near_pages:
            continue
        d = min(abs(page - p) for p in near_pages)
        dists.append((near, d))

    if not dists:
        return True, "no_neighbor_data"

    if any(d <= 1 for _, d in dists):
        return True, "at_least_one_neighbor_close"

    if len(dists) >= 2 and all(d > 1 for _, d in dists):
        details = ",".join(f"{n}:{d}" for n, d in dists)
        return False, f"both_neighbors_far({details})"

    # Single neighbor known but far can happen at section boundaries.
    details = ",".join(f"{n}:{d}" for n, d in dists)
    return True, f"single_neighbor_far_allowed({details})"


def _build_structured_references(
    *,
    missing_inference: list[dict[str, Any]],
    foot_intext: list[dict[str, Any]],
) -> dict[str, Any]:
    by_idx: dict[int, list[dict[str, Any]]] = {}
    for hit in foot_intext:
        if not isinstance(hit, dict):
            continue
        raw_idx = hit.get("index")
        try:
            idx = int(raw_idx)
        except Exception:
            continue
        by_idx.setdefault(idx, []).append(hit)

    rows: list[dict[str, Any]] = []
    mid = 1
    for item in missing_inference:
        if not isinstance(item, dict):
            continue
        idx = item.get("index")
        try:
            idx_i = int(idx)
        except Exception:
            continue
        res = item.get("resolution") if isinstance(item.get("resolution"), dict) else {}
        biblio = res.get("bibliography_extraction") if isinstance(res.get("bibliography_extraction"), dict) else {}
        refs = biblio.get("references") if isinstance(biblio.get("references"), list) else []
        if not refs:
            continue

        hits = by_idx.get(idx_i, [])
        first = hits[0] if hits else {}
        citation_anchor = str(first.get("intext_citation") or idx_i)
        context_preceding = str(first.get("preceding_text") or "").strip()
        raw = str(first.get("intext_citation") or idx_i)
        page0 = int(res.get("inferred_page_index", -1)) if str(res.get("inferred_page_index", "")).lstrip("-").isdigit() else -1
        page1 = page0 + 1 if page0 >= 0 else None

        for ref in refs:
            if not isinstance(ref, dict):
                continue
            rows.append(
                {
                    "mention_id": f"m{mid}",
                    "citation_type": "in_text",
                    "citation_anchor": citation_anchor,
                    "context_preceding": context_preceding,
                    "raw": raw,
                    "footnote_number": idx_i,
                    "page_index_0based": page0,
                    "page_number_1based": page1,
                    "bibliographic_info": {
                        "authors": ref.get("authors") if isinstance(ref.get("authors"), list) else [],
                        "year": str(ref.get("year") or "").strip(),
                        "title": str(ref.get("title") or "").strip(),
                        "url": str(ref.get("url") or "").strip(),
                        "doi": str(ref.get("doi") or "").strip(),
                        "publisher_or_source": str(ref.get("publisher_or_source") or "").strip(),
                        "raw_reference": str(ref.get("raw_reference") or "").strip(),
                    },
                }
            )
            mid += 1

    return {
        "references": rows,
        "stats": {
            "total_structured_references": len(rows),
            "unique_footnote_numbers": len({r["footnote_number"] for r in rows}),
        },
    }


def _merge_full_footnote_items(
    *,
    parser_items: dict[str, Any],
    page_defs: list[dict[int, str]],
    recovered: dict[str, str],
) -> dict[int, str]:
    out: dict[int, str] = {}
    # Deterministic from page parsing (full doc).
    for defs in page_defs:
        for idx, txt in defs.items():
            if not isinstance(idx, int) or idx <= 0:
                continue
            if not isinstance(txt, str) or not txt.strip():
                continue
            cur = out.get(idx, "")
            if len(txt.strip()) > len(cur):
                out[idx] = txt.strip()

    # Parser items (deterministic parser output) override if richer.
    for k, v in parser_items.items():
        if not str(k).isdigit():
            continue
        idx = int(k)
        txt = str(v or "").strip()
        if not txt:
            continue
        cur = out.get(idx, "")
        if len(txt) >= len(cur):
            out[idx] = txt

    # Recovered items override all.
    for k, v in recovered.items():
        if not str(k).isdigit():
            continue
        idx = int(k)
        txt = str(v or "").strip()
        if txt:
            out[idx] = txt
    return out


def _apply_cross_page_continuations(
    full_items: dict[int, str],
    page_for_index: dict[int, int],
    pages_text: list[str],
) -> dict[int, str]:
    out = dict(full_items)
    for idx, text in list(out.items()):
        p = page_for_index.get(idx)
        if p is None or p < 0 or p + 1 >= len(pages_text):
            continue
        t = (text or "").strip()
        if not t:
            continue
        # Likely truncated tail: trailing punctuation or unfinished URL/token.
        tail_trunc = t.endswith((",", ";", ":")) or (t.count("http") > t.count("."))
        if not tail_trunc:
            continue
        next_lines = (pages_text[p + 1] or "").splitlines()[:8]
        chunks: list[str] = []
        for ln in next_lines:
            idx2, body2 = _line_to_index_and_body(ln)
            if idx2 is not None:
                break
            s = ln.strip()
            if s:
                chunks.append(s)
        if chunks:
            merged = re.sub(r"\s+", " ", f"{t} {' '.join(chunks)}").strip()
            if len(merged) > len(t):
                out[idx] = merged
    return out


def _build_structured_references_full(
    *,
    intext_hits: list[dict[str, Any]],
    full_items: dict[int, str],
    biblio_by_index: dict[int, list[dict[str, Any]]],
    page_for_index: dict[int, int],
) -> dict[str, Any]:
    refs: list[dict[str, Any]] = []
    mention_id = 1
    seen_footnotes: set[int] = set()
    for hit in intext_hits:
        if not isinstance(hit, dict):
            continue
        idx_raw = hit.get("index")
        idx: int | None
        try:
            idx = int(idx_raw)
        except Exception:
            idx = None
        anchor = str(hit.get("intext_citation") or idx)
        context = str(hit.get("preceding_text") or "").strip()
        raw = anchor
        style = str(hit.get("citation_style") or "unknown")
        p0 = page_for_index.get(idx, -1) if idx is not None else -1
        p1 = p0 + 1 if p0 >= 0 else None
        foot_text = full_items.get(idx, "") if idx is not None else ""
        if idx is not None:
            seen_footnotes.add(idx)
            bibs = biblio_by_index.get(idx, [])
        else:
            bibs = []
        if not bibs:
            raw_ref = str(hit.get("footnote") or foot_text or "").strip()
            bibs = [
                {
                    "authors": [],
                    "year": "",
                    "title": "",
                    "url": "",
                    "doi": "",
                    "publisher_or_source": "",
                    "raw_reference": raw_ref if _looks_bibliographic_text(raw_ref) else "",
                }
            ]
        for b in bibs:
            refs.append(
                {
                    "mention_id": f"m{mention_id}",
                    "citation_type": str(hit.get("citation_type") or "in_text"),
                    "citation_style": style,
                    "citation_anchor": anchor,
                    "context_preceding": context,
                    "raw": raw,
                    "footnote_number": idx,
                    "page_index_0based": p0,
                    "page_number_1based": p1,
                    "bibliographic_info": {
                        "authors": b.get("authors") if isinstance(b.get("authors"), list) else [],
                        "year": str(b.get("year") or "").strip(),
                        "title": str(b.get("title") or "").strip(),
                        "url": str(b.get("url") or "").strip(),
                        "doi": str(b.get("doi") or "").strip(),
                        "publisher_or_source": str(b.get("publisher_or_source") or "").strip(),
                        "raw_reference": str(b.get("raw_reference") or "").strip(),
                    },
                }
            )
            mention_id += 1

    # Ensure full document coverage: include deterministic/recovered footnotes even without in-text anchor.
    for idx in sorted(full_items.keys()):
        if idx in seen_footnotes:
            continue
        p0 = page_for_index.get(idx, -1)
        p1 = p0 + 1 if p0 >= 0 else None
        foot_text = full_items.get(idx, "")
        bibs = biblio_by_index.get(idx, [])
        if not bibs:
            bibs = [
                {
                    "authors": [],
                    "year": "",
                    "title": "",
                    "url": "",
                    "doi": "",
                    "publisher_or_source": "",
                    "raw_reference": foot_text if _looks_bibliographic_text(foot_text) else "",
                }
            ]
        for b in bibs:
            refs.append(
                {
                    "mention_id": f"m{mention_id}",
                    "citation_type": "footnote",
                    "citation_style": "footnote",
                    "citation_anchor": str(idx),
                    "context_preceding": "",
                    "raw": str(idx),
                    "footnote_number": idx,
                    "page_index_0based": p0,
                    "page_number_1based": p1,
                    "bibliographic_info": {
                        "authors": b.get("authors") if isinstance(b.get("authors"), list) else [],
                        "year": str(b.get("year") or "").strip(),
                        "title": str(b.get("title") or "").strip(),
                        "url": str(b.get("url") or "").strip(),
                        "doi": str(b.get("doi") or "").strip(),
                        "publisher_or_source": str(b.get("publisher_or_source") or "").strip(),
                        "raw_reference": str(b.get("raw_reference") or "").strip(),
                    },
                }
            )
            mention_id += 1

    return {
        "references": refs,
        "stats": {
            "total_structured_references": len(refs),
            "unique_footnote_numbers": len({r["footnote_number"] for r in refs if isinstance(r.get("footnote_number"), int)}),
            "total_intext_mentions": len(intext_hits),
            "footnotes_with_biblio": len([k for k, v in biblio_by_index.items() if v]),
            "footnotes_without_intext_mentions": len(set(full_items.keys()) - seen_footnotes),
            "citation_styles": sorted({str(r.get("citation_style") or "") for r in refs}),
        },
    }


def _compute_sequence_checks(
    *,
    intext_hits: list[dict[str, Any]],
    footnote_items: dict[int, str],
) -> dict[str, Any]:
    numeric = sorted({int(h.get("index")) for h in intext_hits if str(h.get("index", "")).isdigit()})
    roman_hits = [h for h in intext_hits if str(h.get("citation_style") or "") == "roman"]
    rom = sorted({int(h.get("index")) for h in roman_hits if str(h.get("index", "")).isdigit()})
    num_gaps = []
    if numeric:
        expected = set(range(min(numeric), max(numeric) + 1))
        num_gaps = sorted(expected - set(numeric))
    foot = sorted(footnote_items.keys())
    foot_gaps = []
    if foot and foot[0] == 1:
        expected = set(range(1, max(foot) + 1))
        foot_gaps = sorted(expected - set(foot))
    return {
        "numeric_intext": {"count": len(numeric), "gaps": num_gaps[:50]},
        "roman_intext": {"count": len(rom)},
        "footnote_items": {"count": len(foot), "gaps": foot_gaps[:200]},
    }


def _score_structured_reference(row: dict[str, Any], repaired_indices: set[int]) -> float:
    score = 0.45
    ctype = str(row.get("citation_type") or "")
    style = str(row.get("citation_style") or "")
    foot = row.get("footnote_number")
    if ctype == "in_text":
        score += 0.2
    if style in ("tex_superscript", "numeric", "roman"):
        score += 0.1
    if isinstance(foot, int):
        score += 0.1
        if foot in repaired_indices:
            score += 0.05
    bib = row.get("bibliographic_info") if isinstance(row.get("bibliographic_info"), dict) else {}
    if str(bib.get("url") or "").strip() or str(bib.get("doi") or "").strip():
        score += 0.08
    if str(bib.get("raw_reference") or "").strip():
        score += 0.05
    return round(min(1.0, score), 3)


def _split_markdown_sections_by_heading(markdown_text: str) -> list[dict[str, Any]]:
    pages = _split_markdown_pages(markdown_text)
    sections: list[dict[str, Any]] = []
    cur_heading = "Document"
    cur_level = 0
    cur_lines: list[str] = []
    cur_page_start = 0
    cur_page_end = 0
    cur_page_chunks: dict[int, list[str]] = {}

    def flush() -> None:
        nonlocal cur_lines, cur_page_chunks, cur_page_start, cur_page_end
        text = "\n".join(cur_lines).strip()
        if text:
            page_chunks = {
                str(p): "\n".join(lines).strip()
                for p, lines in sorted(cur_page_chunks.items(), key=lambda kv: kv[0])
                if "\n".join(lines).strip()
            }
            sections.append(
                {
                    "heading": cur_heading,
                    "level": cur_level,
                    "page_start_0based": cur_page_start,
                    "page_end_0based": cur_page_end,
                    "page_start_1based": cur_page_start + 1,
                    "page_end_1based": cur_page_end + 1,
                    "text": text,
                    "page_chunks": page_chunks,
                }
            )
        cur_lines = []
        cur_page_chunks = {}

    def looks_like_heading(line: str) -> bool:
        s = (line or "").strip()
        if not s or len(s) < 4 or len(s) > 120:
            return False
        if s.startswith("<!--") or s.startswith("![") or s.startswith("|"):
            return False
        if re.search(r"https?://", s):
            return False
        letters = [ch for ch in s if ch.isalpha()]
        if len(letters) < 3:
            return False
        upper_ratio = sum(1 for ch in letters if ch.isupper()) / max(1, len(letters))
        is_upperish = upper_ratio >= 0.8
        is_titleish = bool(re.fullmatch(r"[A-Z][A-Za-z0-9'’(),:/\- ]{3,}", s)) and s == s.title()
        not_sentence = not s.endswith(".")
        return (is_upperish or is_titleish) and not_sentence

    for pg in pages:
        pidx = int(pg.get("page_index") or 0)
        txt = str(pg.get("text") or "")
        lines = txt.splitlines()
        for line in lines:
            hm = MD_HEADING_RE.match(line or "")
            pseudo = looks_like_heading(line)
            if hm or pseudo:
                flush()
                if hm:
                    cur_heading = hm.group(2).strip()
                    cur_level = len(hm.group(1) or "")
                else:
                    cur_heading = line.strip()
                    cur_level = 1
                cur_page_start = pidx
                cur_page_end = pidx
                continue
            cur_lines.append(line)
            cur_page_end = pidx
            cur_page_chunks.setdefault(pidx, []).append(line)
    flush()
    return sections


def _extract_candidate_footnote_indices(section_text: str, max_index: int) -> list[int]:
    out: set[int] = set()
    for m in INTEXT_TEX_RE.finditer(section_text or ""):
        s = m.group(1) or m.group(2) or ""
        if s.isdigit():
            i = int(s)
            if 1 <= i <= max_index:
                out.add(i)
    for m in re.finditer(r"[¹²³⁴⁵⁶⁷⁸⁹⁰]{1,4}", section_text or ""):
        s = m.group(0).translate(SUP_MAP)
        if s.isdigit():
            i = int(s)
            if 1 <= i <= max_index:
                out.add(i)
    for m in INTEXT_NUM_BRACKET_RE.finditer(section_text or ""):
        s = m.group(1) or ""
        if s.isdigit():
            i = int(s)
            if 1 <= i <= max_index:
                out.add(i)
    return sorted(out)


def _references_map_by_footnote(structured_references: dict[str, Any]) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    rows = structured_references.get("references") if isinstance(structured_references.get("references"), list) else []
    for r in rows:
        if not isinstance(r, dict):
            continue
        fn = r.get("footnote_number")
        if not isinstance(fn, int):
            continue
        bib = r.get("bibliographic_info") if isinstance(r.get("bibliographic_info"), dict) else {}
        raw = str(bib.get("raw_reference") or "").strip()
        title = str(bib.get("title") or "").strip()
        url = str(bib.get("url") or "").strip()
        rendered = raw or title or url
        if rendered:
            out.setdefault(fn, [])
            if rendered not in out[fn]:
                out[fn].append(rendered)
    return out


def _tokenize_for_match(text: str) -> set[str]:
    toks = re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", (text or "").lower())
    stop = {
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "from",
        "into",
        "their",
        "have",
        "has",
        "were",
        "been",
        "about",
        "which",
        "also",
        "they",
        "them",
        "its",
        "our",
        "you",
        "not",
        "are",
        "was",
    }
    return {t for t in toks if t not in stop}


def _rank_claim_support_candidates(
    *,
    claim_statement: str,
    direct_quote: str,
    candidates: list[dict[str, Any]],
    top_k: int = 18,
) -> list[dict[str, Any]]:
    q = _tokenize_for_match(claim_statement) | _tokenize_for_match(direct_quote)
    if not q:
        return candidates[:top_k]

    def score_candidate(c: dict[str, Any]) -> float:
        txt = str(c.get("footnote_text") or "")
        refs = c.get("references") if isinstance(c.get("references"), list) else []
        blob = txt + "\n" + "\n".join(str(r or "") for r in refs[:3])
        t = _tokenize_for_match(blob)
        if not t:
            return 0.0
        inter = len(q.intersection(t))
        return inter / max(1, len(q))

    scored: list[tuple[float, dict[str, Any]]] = []
    for c in candidates:
        score = score_candidate(c)
        if score > 0:
            scored.append((score, c))
    if not scored:
        return candidates[:top_k]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:top_k]]


def _select_claim_support_with_gpt(
    *,
    claim: dict[str, Any],
    support_candidates: list[dict[str, Any]],
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> dict[str, Any]:
    sample = {
        "entity": claim.get("entity"),
        "country": claim.get("country"),
        "claim_statement": claim.get("claim_statement"),
        "direct_quote": claim.get("direct_quote"),
        "page_number_1based": claim.get("page_number_1based"),
        "support_candidates": support_candidates,
    }
    ck = _cache_key("claim_support_link_v1", sample)
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache.get(ck)
        return val if isinstance(val, dict) else {"supported": False, "support_footnote_numbers": [], "support_reasoning": ""}

    schema_wrapper = {
        "name": "claim_support_linking",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "supported": {"type": "boolean"},
                "support_footnote_numbers": {"type": "array", "items": {"type": "integer"}},
                "support_reasoning": {"type": "string"},
            },
            "required": ["supported", "support_footnote_numbers", "support_reasoning"],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Given one attribution claim and candidate global footnotes/references, choose only footnotes that directly support the claim. "
                "Support does not require repeating the exact entity/country words; it can be contextual evidence that substantively validates the claim. "
                "Use supported=false only when evidence is weak, non-probative, or unrelated. "
                "Do not choose footnotes that are merely nearby in text without substantive support. "
                "support_reasoning must reference only the selected support_footnote_numbers."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(sample, ensure_ascii=False),
        },
    ]
    try:
        out = run_structured_step(
            step=f"link_claim_support_{_slug(str(claim.get('entity') or 'claim'))[:32]}",
            messages=messages,
            schema_wrapper=schema_wrapper,
            config=OpenAIStructuredStepConfig(
                model="gpt-5-mini",
                fallback_models=["gpt-4o-mini"],
                temperature=0.0,
                max_completion_tokens=1000,
                retries_per_model=2,
            ),
        )
        payload = out.response_json or {}
        if llm_cache is not None:
            llm_cache[ck] = payload if isinstance(payload, dict) else {}
        return payload if isinstance(payload, dict) else {"supported": False, "support_footnote_numbers": [], "support_reasoning": ""}
    except Exception:
        return {"supported": False, "support_footnote_numbers": [], "support_reasoning": ""}


def _extract_source_candidates_from_structured(
    structured_references: dict[str, Any],
) -> list[dict[str, Any]]:
    rows = (
        structured_references.get("references")
        if isinstance(structured_references.get("references"), list)
        else []
    )
    by_key: dict[str, dict[str, Any]] = {}
    for i, r in enumerate(rows):
        if not isinstance(r, dict):
            continue
        bib = r.get("bibliographic_info") if isinstance(r.get("bibliographic_info"), dict) else {}
        fn = r.get("footnote_number")
        if not isinstance(fn, int):
            continue
        raw_ref = str(bib.get("raw_reference") or "").strip()
        title = str(bib.get("title") or "").strip()
        url = str(bib.get("url") or "").strip()
        doi = str(bib.get("doi") or "").strip()
        year_raw = str(bib.get("year") or "").strip()
        pub = str(bib.get("publisher_or_source") or "").strip()
        authors = bib.get("authors") if isinstance(bib.get("authors"), list) else []
        url_norm = url.strip().rstrip(".,;:)")
        doi_norm = doi.strip().rstrip(".,;:)")
        mention_id = str(r.get("mention_id") or "")
        text_basis = re.sub(r"\s+", " ", (title or raw_ref or "")).strip()
        text_basis_slug = _slug(text_basis[:500]) if text_basis else ""
        if url_norm:
            k = f"url:{url_norm.lower()}"
        elif doi_norm:
            k = f"doi:{doi_norm.lower()}"
        elif text_basis_slug:
            # Hash long text to avoid accidental collisions and preserve distinct refs.
            txt_hash = hashlib.sha256(text_basis.encode("utf-8")).hexdigest()[:16]
            k = f"txt:{text_basis_slug}:{year_raw}:{txt_hash}"
        else:
            # Opaque fallback: do not collapse sparse/empty rows together.
            opaque = f"fn{fn}:m{mention_id or i}"
            k = f"opaque:{opaque}"
        if k not in by_key:
            by_key[k] = {
                "source_key": k,
                "title": title,
                "raw_reference": raw_ref,
                "url": url,
                "doi": doi,
                "publisher_or_source": pub,
                "year": int(year_raw) if year_raw.isdigit() else None,
                "authors": [str(a).strip() for a in authors if str(a).strip()],
                "footnote_numbers": [],
            }
        rec = by_key[k]
        if fn not in rec["footnote_numbers"]:
            rec["footnote_numbers"].append(fn)
    out = list(by_key.values())
    out.sort(key=lambda x: (min(x.get("footnote_numbers") or [99999]), x.get("title") or x.get("raw_reference") or ""))
    for i, s in enumerate(out, start=1):
        s["source_id"] = f"SRC{i:04d}"
    return out


def _web_search_duckduckgo(
    *,
    query: str,
    topn: int = 10,
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []
    ck = _cache_key("ddg_search_v1", {"query": q, "topn": topn})
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache.get(ck)
        return val if isinstance(val, list) else []
    url = "https://duckduckgo.com/html/?q=" + urllib.parse.quote_plus(q)
    req = urllib.request.Request(
        url=url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
            )
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html_txt = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return []

    def clean_text(s: str) -> str:
        s2 = re.sub(r"<[^>]+>", " ", s or "")
        s2 = html.unescape(s2)
        s2 = re.sub(r"\s+", " ", s2).strip()
        return s2

    anchors = re.findall(
        r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        html_txt,
        flags=re.IGNORECASE | re.DOTALL,
    )
    snippets = re.findall(
        r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>|<div[^>]*class="result__snippet"[^>]*>(.*?)</div>',
        html_txt,
        flags=re.IGNORECASE | re.DOTALL,
    )
    out: list[dict[str, Any]] = []
    for i, a in enumerate(anchors[: max(1, topn)]):
        href_raw, title_html = a
        href = html.unescape(href_raw or "").strip()
        if "uddg=" in href:
            try:
                qp = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                href = urllib.parse.unquote(qp.get("uddg", [href])[0])
            except Exception:
                pass
        if href.startswith("//"):
            href = "https:" + href
        elif href.startswith("/"):
            href = "https://duckduckgo.com" + href
        snippet = ""
        if i < len(snippets):
            snippet = clean_text(snippets[i][0] or snippets[i][1] or "")
        out.append(
            {
                "rank": i + 1,
                "title": clean_text(title_html),
                "url": href,
                "snippet": snippet,
            }
        )
    if llm_cache is not None:
        llm_cache[ck] = out
    return out


def _web_search_perplexity(
    *,
    query: str,
    topn: int = 10,
    api_key_env: str = "PERPLEXITY_API_KEY",
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []
    ck = _cache_key("perplexity_search_v1", {"query": q, "topn": topn, "api_key_env": api_key_env})
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache.get(ck)
        return val if isinstance(val, list) else []

    api_key = _resolve_env_key(api_key_env)
    if not api_key:
        return []

    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "title": {"type": "string"},
                        "url": {"type": "string"},
                        "snippet": {"type": "string"},
                    },
                    "required": ["title", "url", "snippet"],
                },
            }
        },
        "required": ["results"],
    }
    payload = {
        "preset": "pro-search",
        "input": f"Find the top {max(1, int(topn))} web results for this source citation query. Return concise title/url/snippet.\nQuery: {q}",
        "response_format": {
            "type": "json_schema",
            "json_schema": {"schema": schema},
        },
    }
    req = urllib.request.Request(
        url="https://api.perplexity.ai/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            obj = json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception:
        return []

    parsed: dict[str, Any] = {}
    if isinstance(obj, dict):
        # SDK exposes output_text; API may return text in output array.
        txt = str(obj.get("output_text") or "").strip()
        if txt:
            try:
                parsed = json.loads(txt)
            except Exception:
                parsed = {}
        if not parsed:
            out_arr = obj.get("output") if isinstance(obj.get("output"), list) else []
            for item in out_arr:
                if not isinstance(item, dict):
                    continue
                content = item.get("content") if isinstance(item.get("content"), list) else []
                for ch in content:
                    if not isinstance(ch, dict):
                        continue
                    t = str(ch.get("text") or "").strip()
                    if not t:
                        continue
                    try:
                        parsed = json.loads(t)
                        break
                    except Exception:
                        continue
                if parsed:
                    break

        # Fallback: extract from output text annotations/citations if JSON didn't parse.
        if not parsed:
            out_arr = obj.get("output") if isinstance(obj.get("output"), list) else []
            ann_rows: list[dict[str, str]] = []
            for item in out_arr:
                if not isinstance(item, dict):
                    continue
                content = item.get("content") if isinstance(item.get("content"), list) else []
                for ch in content:
                    if not isinstance(ch, dict):
                        continue
                    anns = ch.get("annotations") if isinstance(ch.get("annotations"), list) else []
                    for a in anns:
                        if not isinstance(a, dict):
                            continue
                        ann_rows.append(
                            {
                                "title": str(a.get("title") or "").strip(),
                                "url": str(a.get("url") or "").strip(),
                                "snippet": "",
                            }
                        )
            if ann_rows:
                # unique by URL/title
                seen: set[tuple[str, str]] = set()
                uniq: list[dict[str, str]] = []
                for r in ann_rows:
                    k = (r["url"].lower(), r["title"].lower())
                    if k in seen:
                        continue
                    seen.add(k)
                    uniq.append(r)
                parsed = {"results": uniq[: max(1, int(topn))]}

    results = parsed.get("results") if isinstance(parsed, dict) else []
    out: list[dict[str, Any]] = []
    if isinstance(results, list):
        for i, r in enumerate(results[: max(1, int(topn))]):
            if not isinstance(r, dict):
                continue
            out.append(
                {
                    "rank": i + 1,
                    "title": str(r.get("title") or "").strip(),
                    "url": str(r.get("url") or "").strip(),
                    "snippet": str(r.get("snippet") or "").strip(),
                }
            )
    if llm_cache is not None:
        llm_cache[ck] = out
    return out


def _classify_source_with_gpt(
    *,
    source: dict[str, Any],
    search_results: list[dict[str, Any]],
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> dict[str, Any]:
    sample = {
        "source": source,
        "search_results": search_results[:10],
    }
    ck = _cache_key("source_credibility_cls_v1", sample)
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache.get(ck)
        return val if isinstance(val, dict) else {}
    schema_wrapper = {
        "name": "source_credibility_classification",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "source_type": {
                    "type": "string",
                    "enum": [
                        "internal_document_section",
                        "vendor_report",
                        "government",
                        "international_institution",
                        "academic",
                        "ngo",
                        "press_media",
                        "judicial",
                        "other",
                    ],
                },
                "institution_class": {
                    "type": "string",
                    "enum": [
                        "international_institution",
                        "government",
                        "company",
                        "think_tank",
                        "academic",
                        "ngo",
                        "press_media",
                        "judicial",
                        "self_reference",
                        "other_or_unknown",
                    ],
                },
                "entity_name": {"type": "string"},
                "title": {"type": "string"},
                "year": {"type": ["integer", "null"]},
                "publication_or_venue": {"type": "string"},
                "url_or_identifier": {"type": ["string", "null"]},
                "is_self_reference": {"type": "boolean"},
                "credibility_note": {"type": "string"},
                "confidence": {"type": "number"},
            },
            "required": [
                "source_type",
                "institution_class",
                "entity_name",
                "title",
                "year",
                "publication_or_venue",
                "url_or_identifier",
                "is_self_reference",
                "credibility_note",
                "confidence",
            ],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Classify cited source credibility and source type for cyber-attribution analysis. "
                "Use bibliographic text + top web results. "
                "Identify institution class (government, international institution, company, think_tank, self_reference, etc.). "
                "Choose source_type only from provided schema enum."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(sample, ensure_ascii=False),
        },
    ]
    try:
        out = run_structured_step(
            step=f"classify_source_{source.get('source_id')}",
            messages=messages,
            schema_wrapper=schema_wrapper,
            config=OpenAIStructuredStepConfig(
                model="gpt-5-mini",
                fallback_models=["gpt-4o-mini"],
                temperature=0.0,
                max_completion_tokens=1000,
                retries_per_model=2,
            ),
        )
        payload = out.response_json or {}
        if llm_cache is not None:
            llm_cache[ck] = payload if isinstance(payload, dict) else {}
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _build_sixc_credibility(
    *,
    structured_references: dict[str, Any],
    claim_extraction: dict[str, Any],
    full_items: dict[int, str],
    page_for_index: dict[int, int],
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
    max_sources: int = 120,
    search_topn: int = 10,
    search_provider: str = "http",
    perplexity_api_key_env: str = "PERPLEXITY_API_KEY",
) -> dict[str, Any]:
    candidates = _extract_source_candidates_from_structured(structured_references)
    refs_by_footnote = _references_map_by_footnote(structured_references)
    source_index: list[dict[str, Any]] = []
    research: list[dict[str, Any]] = []
    footnote_to_source_ids: dict[int, list[str]] = {}
    for c in candidates[: max(0, int(max_sources))]:
        title = str(c.get("title") or "")
        raw_ref = str(c.get("raw_reference") or "")
        q = (title or raw_ref or str(c.get("url") or "")).strip()
        if search_provider == "perplexity":
            web = _web_search_perplexity(
                query=q[:500],
                topn=max(1, int(search_topn)),
                api_key_env=perplexity_api_key_env,
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
        elif search_provider in ("http", "duckduckgo"):
            web = _web_search_duckduckgo(
                query=q[:300],
                topn=max(1, int(search_topn)),
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
            if not web:
                web = _web_search_perplexity(
                    query=q[:500],
                    topn=max(1, int(search_topn)),
                    api_key_env=perplexity_api_key_env,
                    llm_cache=llm_cache,
                    use_cache=use_cache,
                )
        elif search_provider in ("http_then_perplexity", "auto"):
            web = _web_search_duckduckgo(
                query=q[:300],
                topn=max(1, int(search_topn)),
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
            if not web:
                web = _web_search_perplexity(
                    query=q[:500],
                    topn=max(1, int(search_topn)),
                    api_key_env=perplexity_api_key_env,
                    llm_cache=llm_cache,
                    use_cache=use_cache,
                )
        else:
            web = _web_search_duckduckgo(
                query=q[:300],
                topn=max(1, int(search_topn)),
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
        cls = _classify_source_with_gpt(source=c, search_results=web, llm_cache=llm_cache, use_cache=use_cache)
        src = {
            "source_id": str(c.get("source_id") or ""),
            "source_type": str(cls.get("source_type") or "other"),
            "entity_name": str(cls.get("entity_name") or (c.get("publisher_or_source") or "unknown")),
            "year": cls.get("year") if isinstance(cls.get("year"), int) else c.get("year"),
            "title": str(cls.get("title") or title or raw_ref[:200]),
            "publication_or_venue": str(cls.get("publication_or_venue") or c.get("publisher_or_source") or ""),
            "url_or_identifier": (cls.get("url_or_identifier") if cls.get("url_or_identifier") is not None else (c.get("url") or None)),
            "cited_in_document": [],
            "notes": str(cls.get("credibility_note") or ""),
        }
        fns = c.get("footnote_numbers") if isinstance(c.get("footnote_numbers"), list) else []
        for fn in fns:
            if not isinstance(fn, int):
                continue
            pidx = int(page_for_index.get(fn, 0))
            src["cited_in_document"].append(
                {
                    "page_index": pidx,
                    "page_label": str(pidx + 1),
                    "section_heading": None,
                    "object_id": None,
                }
            )
            footnote_to_source_ids.setdefault(fn, [])
            if src["source_id"] not in footnote_to_source_ids[fn]:
                footnote_to_source_ids[fn].append(src["source_id"])
        source_index.append(src)
        research.append(
            {
                "source_id": src["source_id"],
                "institution_class": str(cls.get("institution_class") or "other_or_unknown"),
                "is_self_reference": bool(cls.get("is_self_reference")),
                "confidence": float(cls.get("confidence") or 0.0),
                "query": q,
                "search_results": web[:10],
            }
        )

    supports: dict[str, dict[str, Any]] = {}
    sections = claim_extraction.get("sections") if isinstance(claim_extraction.get("sections"), list) else []
    claim_counter = 0
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        claims = sec.get("claims") if isinstance(sec.get("claims"), list) else []
        for c in claims:
            if not isinstance(c, dict):
                continue
            claim_counter += 1
            nums = [f.get("footnote_number") for f in (c.get("support", {}).get("footnotes") or []) if isinstance(f, dict)]
            qtxt = str(c.get("direct_quote") or c.get("claim_statement") or "").strip()
            pidx = c.get("page_index_0based")
            pidx_i = int(pidx) if str(pidx).isdigit() else 0
            for fn in nums:
                if not isinstance(fn, int):
                    continue
                for sid in footnote_to_source_ids.get(fn, []):
                    rec = supports.setdefault(
                        sid,
                        {
                            "source_id": sid,
                            "supports_components": [],
                            "supporting_anchors": [],
                            "notes": "Linked from claim support footnotes.",
                        },
                    )
                    if "state_responsibility_claim" not in rec["supports_components"]:
                        rec["supports_components"].append("state_responsibility_claim")
                    aid = f"C{claim_counter:03d}-A{len(rec['supporting_anchors'])+1:03d}"
                    rec["supporting_anchors"].append(
                        {
                            "anchor_id": aid,
                            "extraction_method": "manual_transcription",
                            "verbatim_text": qtxt[:2400],
                            "location": {
                                "page_index": pidx_i,
                                "page_label": str(pidx_i + 1),
                                "section_heading": str(sec.get("heading") or "") or None,
                                "object_id": None,
                            },
                            "notes": f"Claim cites footnote {fn}.",
                        }
                    )

    ext = sum(1 for s in source_index if str(s.get("source_type")) != "internal_document_section")
    internal = len(source_index) - ext
    unique_entities = len({str(s.get("entity_name") or "").strip().lower() for s in source_index if str(s.get("entity_name") or "").strip()})
    credibility_block = {
        "key_questions": [
            "What types of sources support the attribution claim?",
            "Are sources independent, external, and diverse?",
            "Do cited sources substantively support the claim statements?",
        ],
        "quality_checks": {
            "has_verbatim_anchors": bool(sum(len(v.get("supporting_anchors") or []) for v in supports.values()) > 0),
            "has_external_sources": bool(ext > 0),
            "has_quantitative_counts": True,
            "has_explicit_limitations": True,
        },
        "summary": (
            f"Built credibility index from {len(source_index)} unique sources. "
            f"External={ext}, internal={internal}, unique_entities={unique_entities}."
        ),
        "sources_index": source_index,
        "sources_supporting_claim": list(supports.values()),
        "citation_counts": {
            "total_sources": len(source_index),
            "external_sources": ext,
            "internal_sources": internal,
            "unique_source_entities": unique_entities,
        },
    }
    return {
        "credibility_block": credibility_block,
        "source_research": research,
        "mappings": {
            "footnote_to_source_ids": {str(k): v for k, v in sorted(footnote_to_source_ids.items(), key=lambda kv: kv[0])},
        },
    }


def _extract_domain(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    try:
        p = urllib.parse.urlparse(u if "://" in u else f"https://{u}")
        return (p.netloc or "").lower().lstrip("www.")
    except Exception:
        return ""


def _entropy(vals: list[str]) -> float:
    if not vals:
        return 0.0
    c = Counter([v for v in vals if v])
    n = sum(c.values())
    if n == 0:
        return 0.0
    import math

    h = 0.0
    for v in c.values():
        p = v / n
        h -= p * math.log2(p)
    return h


def _stance_from_snippet(claim_text: str, snippet: str) -> str:
    c = _tokenize_for_match(claim_text)
    s = _tokenize_for_match(snippet)
    if not c or not s:
        return "unknown"
    overlap = len(c.intersection(s)) / max(1, len(c))
    sn = (snippet or "").lower()
    contradiction_cues = [
        "no evidence",
        "unfounded",
        "groundless",
        "denied",
        "not responsible",
        "disputed",
        "refuted",
        "false",
    ]
    if any(x in sn for x in contradiction_cues) and overlap >= 0.08:
        return "contradict"
    if overlap >= 0.12:
        return "support"
    return "unknown"


def _stance_with_gpt(
    *,
    claim_text: str,
    snippet: str,
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> dict[str, Any]:
    c = (claim_text or "").strip()
    s = (snippet or "").strip()
    if not c or not s:
        return {"stance": "unknown", "confidence": 0.0, "reason": "empty_input"}
    ck = _cache_key("corroboration_stance_gpt_v1", {"claim": c, "snippet": s})
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache.get(ck)
        if isinstance(val, dict):
            return val
    schema_wrapper = {
        "name": "claim_snippet_stance",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "stance": {"type": "string", "enum": ["support", "contradict", "unknown"]},
                "confidence": {"type": "number"},
                "reason": {"type": "string"},
            },
            "required": ["stance", "confidence", "reason"],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Classify whether evidence snippet supports, contradicts, or is unrelated/insufficient for the claim. "
                "Use conservative judgment: choose unknown unless support/contradiction is substantive."
            ),
        },
        {
            "role": "user",
            "content": json.dumps({"claim": c, "snippet": s}, ensure_ascii=False),
        },
    ]
    try:
        out = run_structured_step(
            step="corroboration_stance_pair",
            messages=messages,
            schema_wrapper=schema_wrapper,
            config=OpenAIStructuredStepConfig(
                model="gpt-5-mini",
                fallback_models=["gpt-4o-mini"],
                temperature=0.0,
                max_completion_tokens=350,
                retries_per_model=2,
            ),
        )
        payload = out.response_json or {}
        result = payload if isinstance(payload, dict) else {"stance": "unknown", "confidence": 0.0, "reason": "bad_payload"}
        if llm_cache is not None:
            llm_cache[ck] = result
        return result
    except Exception:
        return {"stance": "unknown", "confidence": 0.0, "reason": "llm_error"}


def _claim_component_from_row(claim: dict[str, Any]) -> str:
    st = str(claim.get("claim_statement") or "").lower()
    ent = str(claim.get("entity") or "").lower()
    if any(x in st for x in ("state", "government", "military", "pla", "unit 61398")) or any(
        x in ent for x in ("pla", "unit 61398", "government", "state")
    ):
        return "state_responsibility_claim"
    if "campaign" in st:
        return "campaign_attribution"
    if "malware" in st:
        return "malware_family_attribution"
    return "intrusion_set_attribution"


def _build_sixc_corroboration(
    *,
    claim_extraction: dict[str, Any],
    sixc_credibility: dict[str, Any],
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
    use_llm_stance: bool = True,
    max_stance_pairs_per_claim: int = 12,
) -> dict[str, Any]:
    cred_block = sixc_credibility.get("credibility_block") if isinstance(sixc_credibility.get("credibility_block"), dict) else {}
    source_index = cred_block.get("sources_index") if isinstance(cred_block.get("sources_index"), list) else []
    source_research = sixc_credibility.get("source_research") if isinstance(sixc_credibility.get("source_research"), list) else []
    mappings = sixc_credibility.get("mappings") if isinstance(sixc_credibility.get("mappings"), dict) else {}
    f2s_raw = mappings.get("footnote_to_source_ids") if isinstance(mappings.get("footnote_to_source_ids"), dict) else {}
    footnote_to_source_ids: dict[int, list[str]] = {}
    for k, v in f2s_raw.items():
        if str(k).isdigit() and isinstance(v, list):
            footnote_to_source_ids[int(k)] = [str(x) for x in v if str(x)]

    source_by_id = {str(s.get("source_id")): s for s in source_index if isinstance(s, dict) and str(s.get("source_id"))}
    research_by_id = {str(r.get("source_id")): r for r in source_research if isinstance(r, dict) and str(r.get("source_id"))}

    sections = claim_extraction.get("sections") if isinstance(claim_extraction.get("sections"), list) else []
    claim_scores: list[dict[str, Any]] = []
    corroboration_matrix: list[dict[str, Any]] = []
    cid = 0

    for sec in sections:
        if not isinstance(sec, dict):
            continue
        claims = sec.get("claims") if isinstance(sec.get("claims"), list) else []
        for c in claims:
            if not isinstance(c, dict):
                continue
            cid += 1
            claim_id = str(c.get("claim_id") or f"C{cid:03d}")
            claim_statement = str(c.get("claim_statement") or "").strip()
            quote = str(c.get("direct_quote") or "").strip()
            claim_text = f"{claim_statement}\n{quote}".strip()
            comp = _claim_component_from_row(c)
            pidx = int(c.get("page_index_0based") or 0)

            fn_items = c.get("support", {}).get("footnotes") if isinstance(c.get("support"), dict) else []
            footnotes = [int(x.get("footnote_number")) for x in fn_items if isinstance(x, dict) and str(x.get("footnote_number", "")).isdigit()]

            source_ids: list[str] = []
            for fn in footnotes:
                source_ids.extend(footnote_to_source_ids.get(fn, []))
            source_ids = list(dict.fromkeys([s for s in source_ids if s]))

            # T: traceability
            traceable = 0
            for sid in source_ids:
                s = source_by_id.get(sid, {})
                if str(s.get("entity_name") or "").strip() and (
                    str(s.get("url_or_identifier") or "").strip()
                    or str(s.get("title") or "").strip()
                    or str(s.get("publication_or_venue") or "").strip()
                ):
                    traceable += 1
            T = traceable / max(1, len(source_ids)) if source_ids else (0.25 if footnotes else 0.0)

            # E: linkage strength
            evidence_count = len(footnotes)
            E = min(1.0, 0.5 * min(1.0, evidence_count / 3.0) + 0.25 * (1.0 if quote else 0.0) + 0.25 * (1.0 if str(c.get("support", {}).get("reasoning") or "").strip() else 0.0))

            # I: independence/diversity
            domains = [_extract_domain(str((source_by_id.get(sid, {}) or {}).get("url_or_identifier") or "")) for sid in source_ids]
            domains = [d for d in domains if d]
            if len(source_ids) <= 1:
                I = 0.2 if len(source_ids) == 1 else 0.0
            else:
                import math

                H = _entropy(domains if domains else source_ids)
                Hmax = math.log2(max(2, len(set(domains if domains else source_ids))))
                I = max(0.0, min(1.0, H / Hmax if Hmax > 0 else 0.0))

            # A: semantic agreement (support vs contradiction)
            sup = 0
            con = 0
            unk = 0
            pairs_used = 0
            for sid in source_ids:
                rr = research_by_id.get(sid, {})
                results = rr.get("search_results") if isinstance(rr.get("search_results"), list) else []
                for row in results[:5]:
                    if not isinstance(row, dict):
                        continue
                    snippet = str(row.get("snippet") or "")
                    if use_llm_stance and pairs_used < max(1, int(max_stance_pairs_per_claim)):
                        st = _stance_with_gpt(
                            claim_text=claim_text,
                            snippet=snippet,
                            llm_cache=llm_cache,
                            use_cache=use_cache,
                        )
                        stance = str(st.get("stance") or "unknown")
                        pairs_used += 1
                    else:
                        stance = _stance_from_snippet(claim_text, snippet)
                    if stance == "support":
                        sup += 1
                    elif stance == "contradict":
                        con += 1
                    else:
                        unk += 1
            total_stance = sup + con + unk
            if total_stance == 0:
                A = 0.6 if bool(c.get("supported")) else 0.35
            else:
                A = max(0.0, min(1.0, (sup - con + total_stance) / (2.0 * total_stance)))

            # C: credibility-weighted support
            confs = [float((research_by_id.get(sid, {}) or {}).get("confidence") or 0.0) for sid in source_ids]
            C = sum(confs) / len(confs) if confs else 0.35

            # K: penalties (circularity, contradiction, overclaiming)
            contradiction_rate = con / max(1, (sup + con))
            circularity_penalty = 0.0
            if len(domains) > 1:
                top = Counter(domains).most_common(1)[0][1]
                circularity_penalty = max(0.0, (top / len(domains)) - 0.5)
            overclaim_cues = ["proved", "proven", "certainly", "definitive", "undeniable"]
            overclaim = any(x in claim_statement.lower() for x in overclaim_cues) and evidence_count <= 1
            K = max(0.0, min(1.0, 0.45 * contradiction_rate + 0.4 * circularity_penalty + 0.15 * (1.0 if overclaim else 0.0)))

            wT = wE = wI = wA = wC = 0.2
            wK = 0.2
            corr = max(0.0, min(1.0, wT * T + wE * E + wI * I + wA * A + wC * C - wK * K))

            claim_scores.append(
                {
                    "claim_id": claim_id,
                    "section_heading": str(sec.get("heading") or ""),
                    "component": comp,
                    "score": round(corr, 4),
                    "components": {
                        "T_traceability": round(T, 4),
                        "E_linkage": round(E, 4),
                        "I_independence": round(I, 4),
                        "A_agreement": round(A, 4),
                        "C_credibility": round(C, 4),
                        "K_penalty": round(K, 4),
                    },
                    "support_sources": source_ids,
                    "support_footnotes": footnotes,
                    "stance_counts": {"support": sup, "contradict": con, "unknown": unk},
                }
            )

            anchors = []
            if quote:
                anchors.append(
                    {
                        "anchor_id": f"C{cid:03d}-A001",
                        "extraction_method": "manual_transcription",
                        "verbatim_text": quote[:2400],
                        "location": {
                            "page_index": pidx,
                            "page_label": str(pidx + 1),
                            "section_heading": str(sec.get("heading") or "") or None,
                            "object_id": None,
                        },
                        "notes": f"Claim {claim_id} direct quote.",
                    }
                )

            corroboration_matrix.append(
                {
                    "component": comp,
                    "supported_by_source_ids": source_ids,
                    "supporting_anchors": anchors,
                    "source_count": len(source_ids),
                    "unique_source_entity_count": len(
                        {
                            str((source_by_id.get(sid, {}) or {}).get("entity_name") or "").strip().lower()
                            for sid in source_ids
                            if str((source_by_id.get(sid, {}) or {}).get("entity_name") or "").strip()
                        }
                    ),
                    "notes": f"claim_id={claim_id}; corroboration_score={round(corr,4)}",
                }
            )

    scores = [float(x.get("score") or 0.0) for x in claim_scores]
    if scores:
        scores_sorted = sorted(scores)
        n = len(scores_sorted)
        if n % 2 == 1:
            median = scores_sorted[n // 2]
        else:
            median = 0.5 * (scores_sorted[(n // 2) - 1] + scores_sorted[n // 2])
        coverage = sum(1 for s in scores if s >= 0.55) / len(scores)
        doc_score = median * (0.5 + 0.5 * coverage)
    else:
        median = 0.0
        coverage = 0.0
        doc_score = 0.0

    block = {
        "key_questions": [
            "Are claims supported by traceable and relevant evidence?",
            "Are supporting sources independent and non-circular?",
            "Do external snippets support or contradict the claims?",
        ],
        "quality_checks": {
            "has_verbatim_anchors": bool(sum(len(r.get("supporting_anchors") or []) for r in corroboration_matrix) > 0),
            "has_external_sources": bool(sum(len(r.get("supported_by_source_ids") or []) for r in corroboration_matrix) > 0),
            "has_quantitative_counts": True,
            "has_explicit_limitations": True,
        },
        "summary": (
            f"Corroboration scored at claim level with T/E/I/A/C/K components. "
            f"doc_score={round(doc_score,4)}, median={round(median,4)}, coverage={round(coverage,4)}, claims={len(claim_scores)}. "
            "Limitations: lightweight stance heuristics, incomplete bibliographic fields for some footnotes."
        ),
        "corroboration_matrix": corroboration_matrix,
    }
    return {
        "corroboration_block": block,
        "analysis": {
            "doc_corroboration_score": round(doc_score, 4),
            "median_claim_score": round(median, 4),
            "coverage_above_055": round(coverage, 4),
            "claim_scores": claim_scores,
        },
    }


def _extract_section_claims_with_gpt(
    *,
    section: dict[str, Any],
    candidate_support: list[dict[str, Any]],
    llm_cache: dict[str, Any] | None = None,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    sample = {
        "heading": section.get("heading"),
        "level": section.get("level"),
        "page_start_0based": section.get("page_start_0based"),
        "page_end_0based": section.get("page_end_0based"),
        "text": section.get("text"),
        "page_chunks": section.get("page_chunks"),
        "candidate_support": candidate_support,
    }
    ck = _cache_key(
        "section_claims_gpt_v1",
        {
            "heading": sample.get("heading"),
            "pages": [sample.get("page_start_0based"), sample.get("page_end_0based")],
            "text": sample.get("text"),
            "support": candidate_support,
        },
    )
    if use_cache and llm_cache is not None and ck in llm_cache:
        val = llm_cache.get(ck)
        return val if isinstance(val, list) else []

    schema_wrapper = {
        "name": "attribution_claims_by_section",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "claims": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "entity": {"type": "string"},
                            "country": {"type": "string"},
                            "claim_statement": {"type": "string"},
                            "direct_quote": {"type": "string"},
                            "page_number_1based": {"type": "integer"},
                        },
                        "required": [
                            "entity",
                            "country",
                            "claim_statement",
                            "direct_quote",
                            "page_number_1based",
                        ],
                    },
                }
            },
            "required": ["claims"],
        },
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Extract cyber attribution claims from one markdown section. "
                "A valid claim identifies an attributed perpetrator/entity, linked country/state, and how they are linked. "
                "Return concise one-statement claims only. "
                "direct_quote must be verbatim from provided section text and include a page_number_1based from section page range. "
                "Do not decide supporting footnotes in this step."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Section JSON:\n{json.dumps(sample, ensure_ascii=False)}\n\n"
                "Use only this section and candidate support footnotes. "
                "If no attribution claim exists, return claims: []."
            ),
        },
    ]
    try:
        out = run_structured_step(
            step=f"extract_claims_{_slug(str(section.get('heading') or 'section'))[:40]}",
            messages=messages,
            schema_wrapper=schema_wrapper,
            config=OpenAIStructuredStepConfig(
                model="gpt-5-mini",
                fallback_models=["gpt-4o-mini"],
                temperature=0.0,
                max_completion_tokens=1800,
                retries_per_model=2,
            ),
        )
        payload = out.response_json or {}
        claims = payload.get("claims") if isinstance(payload, dict) else []
        cleaned = [c for c in claims if isinstance(c, dict)]
        if llm_cache is not None:
            llm_cache[ck] = cleaned
        return cleaned
    except Exception:
        return []

def _infer_canonical_max(full_items: dict[int, str]) -> int:
    small = sorted(i for i in full_items.keys() if 1 <= i <= 100)
    if not small or small[0] != 1:
        return 0
    max_small = max(small)
    coverage = len(set(small)) / max_small if max_small else 0.0
    # If sequence is dense, allow one tail slot to catch a missed final footnote (e.g., 44).
    if max_small >= 10 and coverage >= 0.9:
        return min(200, max_small + 1)
    return max_small


def _find_exact_definition_anywhere(idx: int, pages_text: list[str]) -> PageProof:
    for p, text in enumerate(pages_text):
        proof = _find_exact_definition_on_page(text, idx)
        if proof.found:
            proof.page_index = p
            return proof
    return PageProof(False, -1, "", "", "not_found_anywhere")


def _search_window_for_exact(idx: int, center_page: int, pages_text: list[str], radius: int = 2) -> PageProof:
    best = PageProof(False, -1, "", "", "not_found_in_window")
    for d in range(0, radius + 1):
        for p in [center_page - d, center_page + d] if d > 0 else [center_page]:
            if p < 0 or p >= len(pages_text):
                continue
            proof = _find_exact_definition_on_page(pages_text[p], idx)
            if proof.found:
                proof.page_index = p
                return proof
    return best


def main() -> int:
    ap = argparse.ArgumentParser(description="Infer and recover missing footnotes by page ranges, then LLM resolve.")
    ap.add_argument("--markdown", default="", help="Markdown path (optional if sidecar .md exists)")
    ap.add_argument("--pdf", required=True, help="PDF path")
    ap.add_argument("--citations-json", default="", help="Optional existing citations JSON")
    ap.add_argument("--output", default="", help="Output JSON path")
    ap.add_argument(
        "--llm-for-all-missing",
        action="store_true",
        help="Call gpt-5-mini for every missing index (not only unresolved deterministic cases).",
    )
    ap.add_argument(
        "--window-radius",
        type=int,
        default=2,
        help="Neighbor-page search radius around inferred page before LLM.",
    )
    ap.add_argument(
        "--validate-each-with-llm",
        action="store_true",
        help="Validate every resolved missing footnote with gpt-5-mini before accepting.",
    )
    ap.add_argument(
        "--fail-on-llm-reject",
        action="store_true",
        help="When --validate-each-with-llm is set, reject the footnote if LLM does not accept it.",
    )
    ap.add_argument(
        "--extract-biblio-with-llm",
        action="store_true",
        help="Extract bibliographic fields (authors, year, url, doi) per resolved footnote with gpt-5-mini.",
    )
    ap.add_argument(
        "--expected-footnotes-max",
        type=int,
        default=0,
        help="If >0, enforce canonical footnote indices 1..N and repair missing via deterministic+LLM.",
    )
    ap.add_argument("--llm-cache-path", default="", help="Optional JSON cache path for LLM calls.")
    ap.add_argument("--no-llm-cache", action="store_true", help="Disable LLM cache usage.")
    ap.add_argument("--biblio-checkpoint-path", default="", help="Optional checkpoint path for full-document bibliography extraction.")
    ap.add_argument("--resume-biblio-checkpoint", action="store_true", help="Resume bibliography extraction from checkpoint when available.")
    ap.add_argument(
        "--quality-min-avg-confidence",
        type=float,
        default=0.0,
        help="If >0, fail run when avg structured reference confidence is below this value.",
    )
    ap.add_argument(
        "--quality-max-unresolved",
        type=int,
        default=-1,
        help="If >=0, fail run when unresolved missing count exceeds this value.",
    )
    ap.add_argument(
        "--collect-visuals-source",
        choices=["markdown", "pdf", "both", "mistral", "markdown+mistral", "all"],
        default="markdown",
        help="Source for table/image collection.",
    )
    ap.add_argument("--mistral-api-key-env", default="MISTRAL_API_KEY", help="Env var name for Mistral API key.")
    ap.add_argument("--mistral-model", default="mistral-ocr-latest", help="Mistral OCR model for visuals collection.")
    ap.add_argument("--mistral-visuals-cache-path", default="", help="Optional cache path for raw Mistral OCR response JSON.")
    ap.add_argument("--extract-artifacts", action="store_true", help="Enable artifact extraction from images and tables.")
    ap.add_argument("--artifact-taxonomy-json", default="", help="Optional taxonomy JSON path for artifact extraction.")
    ap.add_argument("--artifact-max-images", type=int, default=30, help="Max number of images to OCR for artifact extraction.")
    ap.add_argument("--artifact-max-tables", type=int, default=100, help="Max number of tables to send to GPT for artifact extraction.")
    ap.add_argument("--extract-claims", action="store_true", help="Enable attribution claim extraction by markdown section.")
    ap.add_argument("--claims-max-sections", type=int, default=300, help="Max sections to process for claim extraction.")
    ap.add_argument("--claims-max-chars-per-section", type=int, default=12000, help="Max text chars sent per section for claims.")
    ap.add_argument("--extract-sixc-credibility", action="store_true", help="Enable Six-C credibility block extraction with web-backed source typing.")
    ap.add_argument("--credibility-max-sources", type=int, default=120, help="Max unique sources to enrich for credibility.")
    ap.add_argument("--credibility-search-topn", type=int, default=10, help="Top web results to retrieve per source.")
    ap.add_argument(
        "--credibility-search-provider",
        choices=["http", "duckduckgo", "perplexity", "http_then_perplexity", "auto"],
        default="http",
        help="Web search provider for source enrichment. Default http (with Perplexity fallback on empty results).",
    )
    ap.add_argument("--perplexity-api-key-env", default="PERPLEXITY_API_KEY", help="Env var name for Perplexity API key.")
    ap.add_argument("--corroboration-llm-stance", action="store_true", help="Use LLM stance/entailment for corroboration A component.")
    ap.add_argument("--corroboration-max-stance-pairs", type=int, default=12, help="Max claim-snippet pairs per claim for LLM stance.")
    args = ap.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    md_path = _resolve_markdown_path(pdf_path, args.markdown)
    citations_path = Path(args.citations_json).expanduser().resolve() if args.citations_json else None
    out_path = (
        Path(args.output).expanduser().resolve()
        if args.output
        else (md_path.parent / f"{md_path.stem}.missing_footnotes_inference.json").resolve()
    )
    cache_path = (
        Path(args.llm_cache_path).expanduser().resolve()
        if args.llm_cache_path
        else (out_path.parent / ".missing_footnote_agent_llm_cache.json").resolve()
    )
    biblio_checkpoint_path = (
        Path(args.biblio_checkpoint_path).expanduser().resolve()
        if args.biblio_checkpoint_path
        else (out_path.parent / f"{out_path.stem}.biblio_checkpoint.json").resolve()
    )
    use_cache = not bool(args.no_llm_cache)
    llm_cache: dict[str, Any] = _load_json(cache_path) if use_cache else {}
    t_start = time.time()
    timings: dict[str, float] = {}

    markdown_text = _read_text(md_path)
    citations = _load_or_parse_citations(markdown_text, citations_path)
    style_log = {
        "source_style": str(citations.get("style") or ""),
        "buckets_present": [k for k in ("footnotes", "tex", "numeric", "author_year") if isinstance(citations.get(k), dict)],
        "author_year_filter": "require 4-digit year token",
        "visual_collect_source": args.collect_visuals_source,
        "artifact_extraction_enabled": bool(args.extract_artifacts),
        "claim_extraction_enabled": bool(args.extract_claims),
        "sixc_credibility_enabled": bool(args.extract_sixc_credibility),
        "credibility_search_provider": str(args.credibility_search_provider),
        "corroboration_llm_stance": bool(args.corroboration_llm_stance),
    }
    foot = citations.get("footnotes") if isinstance(citations.get("footnotes"), dict) else {}
    stats = foot.get("stats") if isinstance(foot.get("stats"), dict) else {}
    items = foot.get("items") if isinstance(foot.get("items"), dict) else {}
    foot_intext = foot.get("intext") if isinstance(foot.get("intext"), list) else []

    missing_for_seen = sorted(_as_int_set(stats.get("missing_footnotes_for_seen_intext")))
    pages = _extract_pdf_pages(pdf_path)
    page_defs: list[dict[int, str]] = [_scan_page_defs(p) for p in pages]
    page_idx_sets = [set(d.keys()) for d in page_defs]
    all_intext_hits = _collect_intext_hits_from_citations(citations, markdown_text)

    known_index_to_pages: dict[int, list[int]] = {}
    for pi, defs in enumerate(page_defs):
        for idx in defs:
            known_index_to_pages.setdefault(idx, []).append(pi)
    page_for_index: dict[int, int] = {}
    for pi, defs in enumerate(page_defs):
        for idx in defs.keys():
            if idx not in page_for_index:
                page_for_index[idx] = pi

    known_items: dict[int, str] = {}
    for k, v in items.items():
        if str(k).isdigit() and isinstance(v, str) and v.strip():
            known_items[int(k)] = v.strip()
    for defs in page_defs:
        for k, v in defs.items():
            if isinstance(v, str) and v.strip():
                known_items.setdefault(k, v.strip())

    sorted_known = sorted(known_items.keys())

    def neighbor_pair(idx: int) -> tuple[tuple[int, str] | None, tuple[int, str] | None]:
        prev_idx = next((x for x in reversed(sorted_known) if x < idx), None)
        next_idx = next((x for x in sorted_known if x > idx), None)
        prev_v = (prev_idx, known_items[prev_idx]) if prev_idx is not None else None
        next_v = (next_idx, known_items[next_idx]) if next_idx is not None else None
        return prev_v, next_v

    per_missing: list[dict[str, Any]] = []
    recovered: dict[str, str] = {}
    validated_count = 0
    invalidated_count = 0
    for idx in missing_for_seen:
        candidates = _infer_candidate_pages(idx, page_idx_sets, known_index_to_pages)
        direct: dict[str, Any] | None = None
        for c in candidates:
            txt = page_defs[c.page_index].get(idx)
            if txt:
                direct = {
                    "index": idx,
                    "found": True,
                    "inferred_page_index": c.page_index,
                    "footnote_text": txt,
                    "evidence": f"direct_parse:{c.reason}",
                    "confidence": round(min(1.0, c.score + 0.08), 3),
                }
                break
        if direct is None:
            center = candidates[0].page_index if candidates else 0
            proof = _search_window_for_exact(idx, center, pages, radius=max(0, int(args.window_radius)))
            if proof.found:
                direct = {
                    "index": idx,
                    "found": True,
                    "inferred_page_index": proof.page_index,
                    "footnote_text": proof.text,
                    "evidence": f"window_exact:{proof.reason}",
                    "confidence": 0.9,
                }
        deterministic_low_quality = False
        if direct is not None:
            deterministic_low_quality = _is_low_quality_footnote_text(str(direct.get("footnote_text", "")))

        if direct is None or (args.llm_for_all_missing and deterministic_low_quality):
            prev_k, next_k = neighbor_pair(idx)
            llm_out = _resolve_with_gpt(
                missing_idx=idx,
                candidate_pages=candidates,
                pages_text=pages,
                prev_known=prev_k,
                next_known=next_k,
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
            if direct is None:
                direct = llm_out
            elif llm_out.get("found") and str(llm_out.get("footnote_text", "")).strip():
                if _compatible_with_direct_anchor(
                    str(direct.get("footnote_text", "")),
                    str(llm_out.get("footnote_text", "")),
                ):
                    llm_out["evidence"] = f"llm_override_after_{direct.get('evidence','direct')}"
                    direct = llm_out
                else:
                    direct["evidence"] = f"{direct.get('evidence','direct')};llm_rejected_mismatch"

        assert direct is not None
        p = int(direct.get("inferred_page_index", -1))
        hard = PageProof(False, -1, "", "", "invalid_page_index")
        if 0 <= p < len(pages):
            hard = _find_exact_definition_on_page(pages[p], idx)
            hard.page_index = p
        neighbor_ok, neighbor_reason = _validate_neighbor_consistency(idx, p, known_index_to_pages) if p >= 0 else (False, "invalid_page_index")
        validated = bool(
            direct.get("found")
            and hard.found
            and neighbor_ok
            and str(direct.get("footnote_text", "")).strip()
        )
        if not validated and p >= 0:
            proof2 = _search_window_for_exact(idx, p, pages, radius=max(0, int(args.window_radius)))
            if proof2.found:
                p2 = proof2.page_index
                neighbor_ok2, neighbor_reason2 = _validate_neighbor_consistency(idx, p2, known_index_to_pages)
                if neighbor_ok2:
                    direct["inferred_page_index"] = p2
                    direct["footnote_text"] = proof2.text
                    direct["found"] = True
                    direct["evidence"] = f"revalidated_window:{proof2.reason}"
                    hard = proof2
                    neighbor_ok = True
                    neighbor_reason = neighbor_reason2
                    validated = True

        direct["validated"] = validated
        direct["hard_proof"] = {
            "found": hard.found,
            "page_index": hard.page_index,
            "reason": hard.reason,
            "line": hard.line,
        }
        direct["neighbor_check"] = {
            "ok": neighbor_ok,
            "reason": neighbor_reason,
        }

        llm_validation: dict[str, Any] | None = None
        if args.validate_each_with_llm and direct.get("found") and str(direct.get("footnote_text", "")).strip():
            llm_validation = _validate_footnote_with_gpt(
                idx=idx,
                page_index=int(direct.get("inferred_page_index", -1)),
                extracted_text=str(direct.get("footnote_text", "")),
                pages_text=pages,
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
            direct["llm_validation"] = llm_validation
            if llm_validation.get("accepted") and str(llm_validation.get("corrected_text", "")).strip():
                direct["footnote_text"] = str(llm_validation["corrected_text"]).strip()
            if args.fail_on_llm_reject and not llm_validation.get("accepted"):
                direct["validated"] = False

        if args.extract_biblio_with_llm and direct.get("found") and str(direct.get("footnote_text", "")).strip():
            direct["bibliography_extraction"] = _extract_biblio_from_footnote_with_gpt(
                idx=idx,
                page_index=int(direct.get("inferred_page_index", -1)),
                footnote_text=str(direct.get("footnote_text", "")),
                pages_text=pages,
                llm_cache=llm_cache,
                use_cache=use_cache,
            )

        current_validated = bool(direct.get("validated"))
        if current_validated:
            validated_count += 1
        else:
            invalidated_count += 1
        per_missing.append(
            {
                "index": idx,
                "candidates": [
                    {"page_index": c.page_index, "score": round(c.score, 4), "reason": c.reason}
                    for c in candidates[:8]
                ],
                "resolution": direct,
            }
        )
        if direct.get("validated") and direct.get("found") and str(direct.get("footnote_text", "")).strip():
            if args.fail_on_llm_reject and args.validate_each_with_llm:
                v = direct.get("llm_validation") if isinstance(direct.get("llm_validation"), dict) else {}
                if not bool(v.get("accepted")):
                    continue
            recovered[str(idx)] = str(direct["footnote_text"]).strip()

    # After missing recovery: build full deterministic+recovered footnote map for entire document.
    full_items = _merge_full_footnote_items(
        parser_items=items,
        page_defs=page_defs,
        recovered=recovered,
    )

    # Canonical repair pass for full document coverage (deterministic first, LLM fallback).
    canonical_max = int(args.expected_footnotes_max) if int(args.expected_footnotes_max) > 0 else _infer_canonical_max(full_items)
    canonical_repair: dict[str, Any] = {"canonical_max": canonical_max, "repaired_indices": [], "dropped_outliers": []}
    if canonical_max > 0:
        canonical = set(range(1, canonical_max + 1))
        present = set(full_items.keys())
        missing_canonical = sorted(canonical - present)
        for idx in missing_canonical:
            proof = _find_exact_definition_anywhere(idx, pages)
            if proof.found and proof.text.strip():
                full_items[idx] = proof.text.strip()
                page_for_index[idx] = proof.page_index
                canonical_repair["repaired_indices"].append(
                    {"index": idx, "source": "deterministic_any_page", "page_index": proof.page_index}
                )
                continue
            # LLM fallback if deterministic extraction misses it.
            cands = _infer_candidate_pages(idx, page_idx_sets, known_index_to_pages)
            prev_k, next_k = neighbor_pair(idx)
            llm = _resolve_with_gpt(
                missing_idx=idx,
                candidate_pages=cands,
                pages_text=pages,
                prev_known=prev_k,
                next_known=next_k,
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
            if llm.get("found") and str(llm.get("footnote_text", "")).strip():
                p0 = int(llm.get("inferred_page_index", -1))
                full_items[idx] = str(llm["footnote_text"]).strip()
                if p0 >= 0:
                    page_for_index[idx] = p0
                canonical_repair["repaired_indices"].append(
                    {"index": idx, "source": "llm_fallback", "page_index": p0}
                )

        # Drop OCR outliers beyond canonical range unless they are directly cited in-text.
        cited_indices = {int(h.get("index")) for h in all_intext_hits if str(h.get("index", "")).isdigit()}
        for idx in sorted(list(full_items.keys())):
            if idx > canonical_max and idx not in cited_indices:
                canonical_repair["dropped_outliers"].append(idx)
                del full_items[idx]

    full_items = _apply_cross_page_continuations(full_items, page_for_index, pages)
    biblio_by_index: dict[int, list[dict[str, Any]]] = {}
    if args.extract_biblio_with_llm:
        if args.resume_biblio_checkpoint:
            cp = _load_json(biblio_checkpoint_path)
            existing = cp.get("biblio_by_index") if isinstance(cp.get("biblio_by_index"), dict) else {}
            for k, v in existing.items():
                if str(k).isdigit() and isinstance(v, list):
                    biblio_by_index[int(k)] = [r for r in v if isinstance(r, dict)]
        # Extract bibliography for all deterministic+recovered footnotes across the document.
        needed_indices = sorted(full_items.keys())
        for idx in needed_indices:
            if idx in biblio_by_index:
                continue
            txt = full_items.get(idx, "")
            if not txt:
                continue
            p0 = page_for_index.get(idx, -1)
            b = _extract_biblio_from_footnote_with_gpt(
                idx=idx,
                page_index=p0,
                footnote_text=txt,
                pages_text=pages,
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
            refs = b.get("references") if isinstance(b, dict) else []
            if isinstance(refs, list):
                candidate_refs = [r for r in refs if isinstance(r, dict)]
                if not candidate_refs:
                    candidate_refs = _deterministic_biblio_fallback(txt)
                biblio_by_index[idx] = candidate_refs
                _save_json(
                    biblio_checkpoint_path,
                    {
                        "biblio_by_index": {str(k): v for k, v in sorted(biblio_by_index.items(), key=lambda kv: kv[0])},
                        "last_index": idx,
                    },
                )
    else:
        for idx, txt in full_items.items():
            det = _deterministic_biblio_fallback(txt)
            if det:
                biblio_by_index[idx] = det

    footnotes_by_page = []
    for pi, defs in enumerate(page_defs):
        keys = sorted(defs.keys())
        footnotes_by_page.append(
            {
                "page_index": pi,
                "count": len(keys),
                "indices": keys,
                "range": [keys[0], keys[-1]] if keys else [],
            }
        )

    structured = _build_structured_references_full(
        intext_hits=all_intext_hits,
        full_items=full_items,
        biblio_by_index=biblio_by_index,
        page_for_index=page_for_index,
    )
    repaired_set = {
        int(x["index"])
        for x in (canonical_repair.get("repaired_indices") or [])
        if isinstance(x, dict) and str(x.get("index", "")).isdigit()
    }
    for row in structured.get("references", []):
        if isinstance(row, dict):
            row["confidence"] = _score_structured_reference(row, repaired_set)
    confs = [float(r.get("confidence")) for r in structured.get("references", []) if isinstance(r, dict)]
    avg_conf = round(sum(confs) / len(confs), 4) if confs else 0.0
    structured.setdefault("stats", {})["avg_confidence"] = avg_conf
    sequence_checks = _compute_sequence_checks(intext_hits=all_intext_hits, footnote_items=full_items)

    claim_extraction: dict[str, Any] = {"sections": [], "stats": {"sections_count": 0, "claims_count": 0}}
    if args.extract_claims:
        refs_by_footnote = _references_map_by_footnote(structured)
        global_support_pool: list[dict[str, Any]] = []
        for idx in sorted(full_items.keys()):
            global_support_pool.append(
                {
                    "footnote_number": idx,
                    "footnote_text": str(full_items.get(idx) or ""),
                    "references": refs_by_footnote.get(idx, [])[:5],
                }
            )
        max_fn = max(full_items.keys()) if full_items else 0
        sections = _split_markdown_sections_by_heading(markdown_text)
        max_sections = max(0, int(args.claims_max_sections))
        claim_id = 1
        section_rows: list[dict[str, Any]] = []
        for sec in sections[:max_sections]:
            sec_text = str(sec.get("text") or "")
            heading = str(sec.get("heading") or "").strip()
            heading_slug = _slug(heading)
            if heading_slug in ("contents", "table_of_contents", "toc"):
                continue
            if len(sec_text.strip()) < 80:
                continue
            sec_for_llm = dict(sec)
            if len(sec_text) > int(args.claims_max_chars_per_section):
                sec_for_llm["text"] = sec_text[: int(args.claims_max_chars_per_section)]
            cands = _extract_candidate_footnote_indices(sec_text, max_index=max_fn)
            support_rows: list[dict[str, Any]] = []
            for idx in cands[:40]:
                support_rows.append(
                    {
                        "footnote_number": idx,
                        "footnote_text": str(full_items.get(idx) or ""),
                        "references": refs_by_footnote.get(idx, [])[:4],
                    }
                )
            claims_raw = _extract_section_claims_with_gpt(
                section=sec_for_llm,
                candidate_support=support_rows,
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
            claims_out: list[dict[str, Any]] = []
            for c in claims_raw:
                page1 = c.get("page_number_1based")
                page1_i = int(page1) if str(page1).isdigit() else None
                pool_by_idx = {
                    int(x.get("footnote_number")): x
                    for x in global_support_pool
                    if str(x.get("footnote_number", "")).isdigit()
                }
                section_seed = [pool_by_idx[i] for i in cands if i in pool_by_idx][:10]
                ranked = _rank_claim_support_candidates(
                    claim_statement=str(c.get("claim_statement") or ""),
                    direct_quote=str(c.get("direct_quote") or ""),
                    candidates=global_support_pool,
                    top_k=18,
                )
                merged_candidates: list[dict[str, Any]] = []
                seen_support_ids: set[int] = set()
                for cand in section_seed + ranked:
                    fn = cand.get("footnote_number")
                    if not str(fn).isdigit():
                        continue
                    fni = int(fn)
                    if fni in seen_support_ids:
                        continue
                    seen_support_ids.add(fni)
                    merged_candidates.append(cand)
                    if len(merged_candidates) >= 24:
                        break
                sel = _select_claim_support_with_gpt(
                    claim=c,
                    support_candidates=merged_candidates,
                    llm_cache=llm_cache,
                    use_cache=use_cache,
                )
                nums = sel.get("support_footnote_numbers") if isinstance(sel.get("support_footnote_numbers"), list) else []
                cleaned_nums: list[int] = []
                for n in nums:
                    if str(n).isdigit():
                        ni = int(n)
                        if ni in pool_by_idx and ni not in cleaned_nums:
                            cleaned_nums.append(ni)
                nums = cleaned_nums[:3]
                sup_items: list[dict[str, Any]] = []
                for n in nums:
                    if not str(n).isdigit():
                        continue
                    ni = int(n)
                    sup_items.append(
                        {
                            "footnote_number": ni,
                            "footnote_text": str(full_items.get(ni) or ""),
                            "references": refs_by_footnote.get(ni, [])[:4],
                        }
                    )
                claims_out.append(
                    {
                        "claim_id": f"c{claim_id}",
                        "entity": str(c.get("entity") or "").strip(),
                        "country": str(c.get("country") or "").strip(),
                        "claim_statement": str(c.get("claim_statement") or "").strip(),
                        "direct_quote": str(c.get("direct_quote") or "").strip(),
                        "page_number_1based": page1_i,
                        "page_index_0based": (page1_i - 1) if isinstance(page1_i, int) and page1_i > 0 else None,
                        "supported": bool(sel.get("supported")),
                        "support": {
                            "footnotes": sup_items,
                            "reasoning": str(sel.get("support_reasoning") or "").strip(),
                        },
                    }
                )
                claim_id += 1
            section_rows.append(
                {
                    "heading": heading,
                    "level": int(sec.get("level") or 0),
                    "page_start_0based": int(sec.get("page_start_0based") or 0),
                    "page_end_0based": int(sec.get("page_end_0based") or 0),
                    "page_start_1based": int(sec.get("page_start_1based") or 1),
                    "page_end_1based": int(sec.get("page_end_1based") or 1),
                    "claims": claims_out,
                }
            )
        total_claims = sum(len(s.get("claims") or []) for s in section_rows if isinstance(s, dict))
        supported_true = sum(
            1
            for s in section_rows
            for c in (s.get("claims") or [])
            if isinstance(c, dict) and bool(c.get("supported"))
        )
        claim_extraction = {
            "sections": section_rows,
            "stats": {
                "sections_count": len(section_rows),
                "sections_with_claims": sum(1 for s in section_rows if isinstance(s, dict) and len(s.get("claims") or []) > 0),
                "claims_count": total_claims,
                "supported_true_count": supported_true,
                "supported_false_count": max(0, total_claims - supported_true),
            },
        }

    sixc_framework: dict[str, Any] = {}
    if args.extract_sixc_credibility:
        sixc_framework["credibility"] = _build_sixc_credibility(
            structured_references=structured,
            claim_extraction=claim_extraction,
            full_items=full_items,
            page_for_index=page_for_index,
            llm_cache=llm_cache,
            use_cache=use_cache,
            max_sources=max(1, int(args.credibility_max_sources)),
            search_topn=max(1, int(args.credibility_search_topn)),
            search_provider=str(args.credibility_search_provider),
            perplexity_api_key_env=str(args.perplexity_api_key_env),
        )
        sixc_framework["corroboration"] = _build_sixc_corroboration(
            claim_extraction=claim_extraction,
            sixc_credibility=sixc_framework["credibility"],
            llm_cache=llm_cache,
            use_cache=use_cache,
            use_llm_stance=bool(args.corroboration_llm_stance),
            max_stance_pairs_per_claim=max(1, int(args.corroboration_max_stance_pairs)),
        )

    tables_collected: list[dict[str, Any]] = []
    images_collected: list[dict[str, Any]] = []
    visuals_meta: dict[str, Any] = {}
    if args.collect_visuals_source in ("markdown", "both", "markdown+mistral", "all"):
        tables_collected.extend(_collect_tables_from_markdown(markdown_text))
        images_collected.extend(_collect_images_from_markdown(markdown_text))
    if args.collect_visuals_source in ("pdf", "both", "all"):
        tables_collected.extend(_collect_tables_from_pdf(pdf_path))
        images_collected.extend(_collect_images_from_pdf(pdf_path))
    # Mistral collection is primary fix when markdown has no embedded images.
    mistral_needed = args.collect_visuals_source in ("mistral", "markdown+mistral", "all")
    if args.collect_visuals_source == "markdown" and len(images_collected) == 0:
        mistral_needed = True
    if mistral_needed:
        m_cache = (
            Path(args.mistral_visuals_cache_path).expanduser().resolve()
            if args.mistral_visuals_cache_path
            else (out_path.parent / f"{out_path.stem}.mistral_ocr_visuals.json").resolve()
        )
        m_img_dir = (out_path.parent / f"{out_path.stem}.mistral_images").resolve()
        m_tables, m_images, m_meta = _collect_visuals_from_mistral(
            pdf_path=pdf_path,
            cache_path=m_cache,
            images_dir=m_img_dir,
            model=str(args.mistral_model),
            api_key_env=str(args.mistral_api_key_env),
            use_cache=use_cache,
        )
        tables_collected.extend(m_tables)
        images_collected.extend(m_images)
        visuals_meta["mistral"] = m_meta
    tables_collected = _dedupe_tables(tables_collected)
    if tables_collected:
        qvals = [float(t.get("quality_score") or 0.0) for t in tables_collected if isinstance(t, dict)]
        visuals_meta["tables_quality"] = {
            "avg_quality_score": round(sum(qvals) / len(qvals), 4) if qvals else 0.0,
            "low_quality_count": sum(1 for x in qvals if x < 0.55),
        }

    timings["total_seconds"] = round(time.time() - t_start, 3)

    artifact_taxonomy = DEFAULT_ARTIFACT_TAXONOMY
    if args.artifact_taxonomy_json:
        try:
            tax_obj = json.loads(Path(args.artifact_taxonomy_json).expanduser().resolve().read_text(encoding="utf-8"))
            if isinstance(tax_obj, dict):
                artifact_taxonomy = tax_obj
        except Exception:
            pass
    taxonomy_paths = _flatten_taxonomy_paths(artifact_taxonomy)
    keyword_map = _taxonomy_keyword_map(artifact_taxonomy)
    page_text_by_idx: dict[int, str] = {
        int(p.get("page_index") or 0): str(p.get("text") or "")
        for p in _split_markdown_pages(markdown_text)
        if isinstance(p, dict)
    }
    mistral_page_text_by_idx: dict[int, str] = {}
    m_meta = visuals_meta.get("mistral")
    if isinstance(m_meta, dict):
        pmap = m_meta.get("page_markdown_by_index")
        if isinstance(pmap, dict):
            for k, v in pmap.items():
                try:
                    mistral_page_text_by_idx[int(k)] = str(v or "")
                except Exception:
                    continue
    image_artifacts: list[dict[str, Any]] = []
    table_artifacts: list[dict[str, Any]] = []
    if args.extract_artifacts:
        # Images -> Mistral OCR + context -> GPT extraction (deterministic fallback)
        img_limit = max(0, int(args.artifact_max_images))
        for img in images_collected[:img_limit]:
            if not isinstance(img, dict):
                continue
            pidx = int(img.get("page_index") or 0)
            img_source = str(img.get("source") or "")
            if img_source == "mistral_ocr":
                page_text = mistral_page_text_by_idx.get(pidx, page_text_by_idx.get(pidx, page_text_by_idx.get(0, "")))
            else:
                page_text = page_text_by_idx.get(pidx, page_text_by_idx.get(0, ""))
            ctx_before, ctx_after = _visual_context_for_lines(
                page_text=page_text,
                start_line=img.get("start_line") if isinstance(img.get("start_line"), int) else None,
                end_line=img.get("end_line") if isinstance(img.get("end_line"), int) else None,
            )
            fp = str(img.get("file_path") or "")
            txt = ""
            if fp and Path(fp).is_file():
                txt = _mistral_ocr_single_image_text(
                    image_path=Path(fp),
                    model=str(args.mistral_model),
                    api_key_env=str(args.mistral_api_key_env),
                    llm_cache=llm_cache,
                    use_cache=use_cache,
                )
            arts = _extract_image_artifacts_with_gpt(
                image=img,
                ocr_text=txt,
                context_before=ctx_before,
                context_after=ctx_after,
                taxonomy_paths=taxonomy_paths,
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
            if not arts and txt:
                arts = _extract_artifacts_from_image_text(
                    image_id=str(img.get("image_id") or ""),
                    page_index=pidx,
                    text=txt,
                    keyword_map=keyword_map,
                )
            for a in arts:
                a.setdefault("source_type", "image")
                a.setdefault("source_id", str(img.get("image_id") or ""))
                a.setdefault("page_index", pidx)
                a.setdefault("context_before", ctx_before)
                a.setdefault("context_after", ctx_after)
                a.setdefault("is_artifact", True)
                a.setdefault("explanation", "")
                a.setdefault("justification", "")
            image_artifacts.extend(arts)
        # Tables -> GPT-5-mini extraction
        tbl_limit = max(0, int(args.artifact_max_tables))
        for t in tables_collected[:tbl_limit]:
            if not isinstance(t, dict):
                continue
            pidx = int(t.get("page_index") or 0)
            tbl_source = str(t.get("source") or "")
            if tbl_source == "mistral_ocr":
                page_text = mistral_page_text_by_idx.get(pidx, page_text_by_idx.get(pidx, page_text_by_idx.get(0, "")))
            else:
                page_text = page_text_by_idx.get(pidx, page_text_by_idx.get(0, ""))
            ctx_before, ctx_after = _visual_context_for_lines(
                page_text=page_text,
                start_line=t.get("start_line") if isinstance(t.get("start_line"), int) else None,
                end_line=t.get("end_line") if isinstance(t.get("end_line"), int) else None,
            )
            arts = _extract_table_artifacts_with_gpt(
                table=t,
                context_before=ctx_before,
                context_after=ctx_after,
                taxonomy_paths=taxonomy_paths,
                llm_cache=llm_cache,
                use_cache=use_cache,
            )
            for a in arts:
                a.setdefault("source_type", "table")
                a.setdefault("source_id", str(t.get("table_id") or ""))
                a.setdefault("page_index", pidx)
                a.setdefault("context_before", ctx_before)
                a.setdefault("context_after", ctx_after)
                a.setdefault("is_artifact", True)
                a.setdefault("explanation", "")
                a.setdefault("justification", "")
            table_artifacts.extend(arts)
    true_img = sum(1 for a in image_artifacts if isinstance(a, dict) and bool(a.get("is_artifact")))
    false_img = sum(1 for a in image_artifacts if isinstance(a, dict) and not bool(a.get("is_artifact")))
    true_tbl = sum(1 for a in table_artifacts if isinstance(a, dict) and bool(a.get("is_artifact")))
    false_tbl = sum(1 for a in table_artifacts if isinstance(a, dict) and not bool(a.get("is_artifact")))
    artifact_extraction = {
        "taxonomy": artifact_taxonomy,
        "image_artifacts": image_artifacts,
        "table_artifacts": table_artifacts,
        "stats": {
            "image_artifacts_count": len(image_artifacts),
            "table_artifacts_count": len(table_artifacts),
            "total_artifacts_count": len(image_artifacts) + len(table_artifacts),
            "image_artifact_true_count": true_img,
            "image_artifact_false_count": false_img,
            "table_artifact_true_count": true_tbl,
            "table_artifact_false_count": false_tbl,
            "artifact_true_count": true_img + true_tbl,
            "artifact_false_count": false_img + false_tbl,
        },
    }

    out = {
        "schema_version": OUTPUT_SCHEMA_VERSION,
        "agent_version": AGENT_VERSION,
        "markdown_path": str(md_path),
        "pdf_path": str(pdf_path),
        "style_decision_log": style_log,
        "missing_footnotes_for_seen_intext": missing_for_seen,
        "footnotes_by_page": footnotes_by_page,
        "missing_inference": per_missing,
        "recovered_items": recovered,
        "all_intext_citations": all_intext_hits,
        "all_footnote_items": {str(k): v for k, v in sorted(full_items.items(), key=lambda kv: kv[0])},
        "canonical_repair": canonical_repair,
        "structured_references": structured,
        "tables_collected": tables_collected,
        "images_collected": images_collected,
        "artifact_extraction": artifact_extraction,
        "claim_extraction": claim_extraction,
        "sixc_framework": sixc_framework,
        "sequence_checks": sequence_checks,
        "visuals_collection_meta": visuals_meta,
        "timings": timings,
        "summary": {
            "missing_count": len(missing_for_seen),
            "resolved_count": len(recovered),
            "unresolved_count": len(missing_for_seen) - len(recovered),
            "validated_count": validated_count,
            "invalidated_count": invalidated_count,
            "tables_collected_count": len(tables_collected),
            "images_collected_count": len(images_collected),
            "artifacts_extracted_count": len(image_artifacts) + len(table_artifacts),
            "claims_extracted_count": int((claim_extraction.get("stats") or {}).get("claims_count") or 0),
            "sixc_credibility_sources_count": int(
                (
                    (
                        (sixc_framework.get("credibility") or {}).get("credibility_block")
                        if isinstance(sixc_framework.get("credibility"), dict)
                        else {}
                    ).get("citation_counts")
                    or {}
                ).get("total_sources")
                or 0
            ),
            "sixc_corroboration_claims_count": int(
                len(
                    (
                        (
                            (sixc_framework.get("corroboration") or {}).get("analysis")
                            if isinstance(sixc_framework.get("corroboration"), dict)
                            else {}
                        ).get("claim_scores")
                        or []
                    )
                )
            ),
        },
    }
    quality_gate = {
        "passed": True,
        "reasons": [],
        "avg_confidence": avg_conf,
        "unresolved_count": out["summary"]["unresolved_count"],
    }
    if float(args.quality_min_avg_confidence) > 0 and avg_conf < float(args.quality_min_avg_confidence):
        quality_gate["passed"] = False
        quality_gate["reasons"].append(
            f"avg_confidence {avg_conf} < required {float(args.quality_min_avg_confidence)}"
        )
    if int(args.quality_max_unresolved) >= 0 and out["summary"]["unresolved_count"] > int(args.quality_max_unresolved):
        quality_gate["passed"] = False
        quality_gate["reasons"].append(
            f"unresolved_count {out['summary']['unresolved_count']} > allowed {int(args.quality_max_unresolved)}"
        )
    out["quality_gate"] = quality_gate

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    if use_cache:
        _save_json(cache_path, llm_cache)
    print(str(out_path))
    return 0 if quality_gate["passed"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
