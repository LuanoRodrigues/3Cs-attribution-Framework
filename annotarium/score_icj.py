#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _mean(values: list[float], default: float = 0.0) -> float:
    if not values:
        return default
    return float(sum(values) / len(values))


def _median(values: list[float], default: float = 0.0) -> float:
    if not values:
        return default
    s = sorted(float(v) for v in values)
    mid = len(s) // 2
    if len(s) % 2:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0


def _parse_date(raw: Any) -> date | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y"):
        try:
            dt = datetime.strptime(text, fmt)
            if fmt == "%Y":
                return date(dt.year, 1, 1)
            return dt.date()
        except ValueError:
            continue
    return None


def _extract_domain(raw_url: str) -> str:
    if not raw_url:
        return ""
    parsed = urlparse(raw_url)
    return (parsed.hostname or "").lower().strip()


def _slug(text: str) -> str:
    return "".join(ch.lower() for ch in text if ch.isalnum() or ch in ("_", "-"))


class ScoringValidationError(RuntimeError):
    pass


PROFILE_CONFIGS: dict[str, dict[str, Any]] = {
    "strict": {
        "source_kind_base": {
            "court": 0.92,
            "academic": 0.84,
            "ngo": 0.72,
            "government": 0.58,
            "vendor": 0.52,
            "media": 0.38,
            "unknown": 0.48,
        },
        "feature_bias": {"I": -0.03, "A": -0.02, "M": -0.02, "P": -0.05, "T": -0.02},
        "penalty_power": 1.12,
        "source_hierarchy_weights": {
            "io": 0.94,
            "international_institution": 0.94,
            "court": 0.92,
            "ngo": 0.82,
            "government": 0.64,
            "academic": 0.66,
            "vendor": 0.54,
            "media": 0.40,
            "newspaper": 0.40,
            "unknown": 0.50,
        },
        "c2_blend": {"source_independence": 0.75, "claim_discipline": 0.25},
        "c3_support_blend": {"base": 0.45, "support": 0.55},
        "claim_nature_factor": {
            "actor_attribution": 1.00,
            "operation_linkage": 1.00,
            "breach_claim": 0.98,
            "legal_responsibility": 0.92,
            "unknown": 0.96,
        },
        "seriousness_thresholds": {
            "overall_claim_score_mean_min": 0.15,
            "credibility_independence_median_min": 0.48,
            "corroboration_convergence_median_min": 0.28,
        },
    },
    "balanced": {
        "source_kind_base": {
            "court": 0.90,
            "academic": 0.82,
            "ngo": 0.74,
            "government": 0.64,
            "vendor": 0.58,
            "media": 0.44,
            "unknown": 0.52,
        },
        "feature_bias": {"I": 0.0, "A": 0.0, "M": 0.0, "P": 0.0, "T": 0.0},
        "penalty_power": 1.0,
        "source_hierarchy_weights": {
            "io": 0.92,
            "international_institution": 0.92,
            "court": 0.90,
            "ngo": 0.82,
            "government": 0.68,
            "academic": 0.66,
            "vendor": 0.58,
            "media": 0.45,
            "newspaper": 0.45,
            "unknown": 0.52,
        },
        "c2_blend": {"source_independence": 0.70, "claim_discipline": 0.30},
        "c3_support_blend": {"base": 0.55, "support": 0.45},
        "claim_nature_factor": {
            "actor_attribution": 1.00,
            "operation_linkage": 1.00,
            "breach_claim": 1.00,
            "legal_responsibility": 0.95,
            "unknown": 0.98,
        },
        "seriousness_thresholds": {
            "overall_claim_score_mean_min": 0.10,
            "credibility_independence_median_min": 0.40,
            "corroboration_convergence_median_min": 0.20,
        },
    },
    "permissive": {
        "source_kind_base": {
            "court": 0.88,
            "academic": 0.80,
            "ngo": 0.74,
            "government": 0.66,
            "vendor": 0.62,
            "media": 0.50,
            "unknown": 0.56,
        },
        "feature_bias": {"I": 0.03, "A": 0.02, "M": 0.02, "P": 0.03, "T": 0.02},
        "penalty_power": 0.90,
        "source_hierarchy_weights": {
            "io": 0.90,
            "international_institution": 0.90,
            "court": 0.88,
            "ngo": 0.82,
            "government": 0.72,
            "academic": 0.70,
            "vendor": 0.62,
            "media": 0.52,
            "newspaper": 0.52,
            "unknown": 0.56,
        },
        "c2_blend": {"source_independence": 0.65, "claim_discipline": 0.35},
        "c3_support_blend": {"base": 0.62, "support": 0.38},
        "claim_nature_factor": {
            "actor_attribution": 1.00,
            "operation_linkage": 1.00,
            "breach_claim": 1.00,
            "legal_responsibility": 0.98,
            "unknown": 1.00,
        },
        "seriousness_thresholds": {
            "overall_claim_score_mean_min": 0.06,
            "credibility_independence_median_min": 0.32,
            "corroboration_convergence_median_min": 0.14,
        },
    },
}


def _profile_config(name: str) -> dict[str, Any]:
    key = str(name or "balanced").strip().lower()
    return PROFILE_CONFIGS.get(key, PROFILE_CONFIGS["balanced"])


TECHNICAL_EVIDENCE_KINDS = {
    "url",
    "domain",
    "ipv4",
    "ipv6",
    "hash_md5",
    "hash_sha1",
    "hash_sha256",
    "file_name",
    "process_name",
    "mutex",
    "registry",
    "filepath",
    "cve",
    "technical_artifact",
    "telemetry",
}


def _is_technical_kind(kind: str) -> bool:
    return str(kind or "").strip().lower() in TECHNICAL_EVIDENCE_KINDS


@dataclass
class SourceNorm:
    source_id: str
    source_kind: str
    title: str
    authors: list[str]
    authoring_org: str
    publisher: str
    date_published: str | None
    url: str
    domain: str
    is_litigation_prepared: int
    is_single_source: int
    has_stated_conflict: int
    has_countervailing_detail: int
    cites: list[str]
    origin_signature: list[str]


def _source_kind(raw: dict[str, Any]) -> str:
    source_type = str(raw.get("source_type") or "").lower()
    entity = str(raw.get("entity_name") or raw.get("publisher") or "").lower()
    text = " ".join([source_type, entity])
    if any(k in text for k in ("court", "tribunal", "judgment", "icj", "legal")):
        return "court"
    if any(k in text for k in ("un", "eu", "government", "ministry", "state", "agency")):
        return "government"
    if any(k in text for k in ("mandiant", "symantec", "crowdstrike", "vendor", "security")):
        return "vendor"
    if any(k in text for k in ("university", "journal", "academic", "research")):
        return "academic"
    if any(k in text for k in ("ngo", "foundation", "watch", "rights")):
        return "ngo"
    if any(k in text for k in ("news", "media", "press", "times", "post")):
        return "media"
    return "unknown"


def _source_flags(raw: dict[str, Any]) -> tuple[int, int]:
    text = " ".join(
        [
            str(raw.get("title") or ""),
            str(raw.get("notes") or ""),
            str(raw.get("entity_name") or ""),
            str(raw.get("publisher") or ""),
        ]
    ).lower()
    conflict_markers = (
        "press release",
        "official statement",
        "commissioned",
        "sponsored",
        "marketing",
        "strategic communication",
    )
    counter_markers = (
        "however",
        "limitations",
        "uncertain",
        "cannot confirm",
        "alternative",
        "caveat",
    )
    has_conflict = 1 if any(m in text for m in conflict_markers) else 0
    has_counter = 1 if any(m in text for m in counter_markers) else 0
    return has_conflict, has_counter


def _collect_source_candidates(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    stage1 = (doc.get("stage1_markdown_parse") or {}).get("global_indices") or {}
    out.extend([s for s in (stage1.get("sources") or []) if isinstance(s, dict)])
    claims = ((doc.get("stage2_claim_extraction") or {}).get("attribution_claims") or [])
    for claim in claims:
        if not isinstance(claim, dict):
            continue
        sixc = claim.get("six_c") or {}
        cred = sixc.get("credibility") or {}
        out.extend([s for s in (cred.get("sources_index") or []) if isinstance(s, dict)])
    return out


def _normalize_sources(doc: dict[str, Any]) -> dict[str, SourceNorm]:
    by_id: dict[str, SourceNorm] = {}
    candidates = _collect_source_candidates(doc)
    fallback_counter = 1

    for src in candidates:
        sid = str(src.get("source_id") or "").strip()
        if not sid:
            sid = f"S-AUTO-{fallback_counter:04d}"
            fallback_counter += 1
        raw_year = src.get("year")
        date_published = None
        if isinstance(raw_year, int) and 1500 <= raw_year <= 2100:
            date_published = f"{raw_year:04d}-01-01"
        if isinstance(src.get("date_published"), str):
            date_published = src.get("date_published")

        url = str(src.get("url_normalized") or src.get("url") or "").strip()
        domain = str(src.get("domain") or _extract_domain(url)).strip().lower()
        authoring_org = str(src.get("entity_name") or src.get("authoring_org") or "").strip()
        publisher = str(src.get("publisher") or authoring_org or domain).strip()
        title = str(src.get("title") or src.get("notes") or "").strip()

        authors: list[str] = []
        if isinstance(src.get("authors"), list):
            authors = [str(a).strip() for a in src.get("authors") if str(a).strip()]
        elif isinstance(src.get("author"), str) and src.get("author").strip():
            authors = [src.get("author").strip()]

        kind = _source_kind(src)
        litig = 1 if kind == "court" else 0
        has_conflict, has_counter = _source_flags(src)
        cites = [str(x).strip() for x in (src.get("cites") or []) if str(x).strip()]
        origin_base = domain if domain else sid
        by_id[sid] = SourceNorm(
            source_id=sid,
            source_kind=kind,
            title=title,
            authors=authors,
            authoring_org=authoring_org,
            publisher=publisher,
            date_published=date_published,
            url=url,
            domain=domain,
            is_litigation_prepared=litig,
            is_single_source=0,
            has_stated_conflict=has_conflict,
            has_countervailing_detail=has_counter,
            cites=cites,
            origin_signature=[origin_base],
        )

    # Optional citation dependency resolution when source.cites is present.
    adjacency: dict[str, list[str]] = {sid: list(s.cites) for sid, s in by_id.items()}

    def terminals(root: str, visiting: set[str] | None = None) -> set[str]:
        visiting = visiting or set()
        if root in visiting:
            return {root}
        children = adjacency.get(root) or []
        if not children:
            return {root}
        out: set[str] = set()
        visiting = set(visiting)
        visiting.add(root)
        for child in children:
            if child in by_id:
                out |= terminals(child, visiting)
            else:
                out.add(child)
        return out or {root}

    for sid, s in list(by_id.items()):
        roots = sorted(terminals(sid))
        signature = []
        for rid in roots:
            rs = by_id.get(rid)
            if rs and rs.domain:
                signature.append(rs.domain)
            else:
                signature.append(rid)
        signature = sorted({_slug(x) for x in signature if _slug(x)})
        if not signature:
            signature = [_slug(s.domain) if s.domain else sid.lower()]
        by_id[sid] = SourceNorm(
            source_id=s.source_id,
            source_kind=s.source_kind,
            title=s.title,
            authors=s.authors,
            authoring_org=s.authoring_org,
            publisher=s.publisher,
            date_published=s.date_published,
            url=s.url,
            domain=s.domain,
            is_litigation_prepared=s.is_litigation_prepared,
            is_single_source=0,
            has_stated_conflict=s.has_stated_conflict,
            has_countervailing_detail=s.has_countervailing_detail,
            cites=s.cites,
            origin_signature=signature,
        )
    return by_id


def _infer_location_kind(anchor: dict[str, Any], notes: str) -> str:
    object_id = str(((anchor.get("location") or {}).get("object_id")) or "").lower()
    low = notes.lower()
    if "table" in low or object_id.startswith("t"):
        return "table"
    if "figure" in low or "image" in low or object_id.startswith("f"):
        return "figure"
    return "text"


def _normalize_artifacts(doc: dict[str, Any]) -> list[dict[str, Any]]:
    pages = ((doc.get("stage1_markdown_parse") or {}).get("pages") or [])
    out: list[dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        for a in (page.get("artifacts_found") or []):
            if not isinstance(a, dict):
                continue
            anchor = a.get("anchor") or {}
            location = anchor.get("location") or {}
            notes = str(a.get("notes") or "")
            kind = _infer_location_kind(anchor, notes)
            extracted_from = "image_ocr" if "ocr" in notes.lower() else ("table" if kind == "table" else "text")
            out.append(
                {
                    "artifact_id": str(a.get("artifact_id") or ""),
                    "artifact_type": str(a.get("artifact_type") or "unknown"),
                    "value": str(a.get("normalized_value") or a.get("value") or ""),
                    "location": {
                        "page": int(location.get("page_index") or 0),
                        "block_id": str(location.get("object_id") or ""),
                        "kind": kind,
                        "table_id": str(location.get("object_id") or "") if kind == "table" else "",
                    },
                    "extracted_from": extracted_from,
                    "confidence": 1.0,
                }
            )
    return out


def _load_json_if_exists(path: str) -> dict[str, Any] | None:
    p = Path(path).expanduser().resolve()
    if not p.is_file():
        return None
    try:
        obj = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
    return obj if isinstance(obj, dict) else None


def _validate_scoring_ready(
    *,
    doc: dict[str, Any],
    sources: dict[str, SourceNorm],
    artifacts: list[dict[str, Any]],
    consistency_audit: dict[str, Any] | None,
) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    fatal: list[str] = []

    source_ids = [s.source_id for s in sources.values()]
    if len(source_ids) != len(set(source_ids)):
        fatal.append("duplicate source_id detected in normalized source registry")

    artifact_ids = [str(a.get("artifact_id") or "") for a in artifacts if str(a.get("artifact_id") or "")]
    if len(artifact_ids) != len(set(artifact_ids)):
        fatal.append("duplicate artifact_id detected in normalized artifact registry")

    missing_anchor_count = 0
    for a in artifacts:
        loc = a.get("location") or {}
        if not isinstance(loc, dict):
            missing_anchor_count += 1
            continue
        if "page" not in loc or "block_id" not in loc:
            missing_anchor_count += 1
    if missing_anchor_count:
        fatal.append(f"{missing_anchor_count} artifacts missing location anchors")

    pages = ((doc.get("stage1_markdown_parse") or {}).get("pages") or [])
    unresolved = 0
    unresolved_missing = 0
    for p in pages:
        if not isinstance(p, dict):
            continue
        for c in (p.get("citations_found") or []):
            if not isinstance(c, dict):
                continue
            rid = c.get("resolved_source_id")
            if rid in (None, "", "null"):
                unresolved += 1
                continue
            if str(rid) not in sources:
                unresolved_missing += 1

    recovered_ok = False
    if consistency_audit:
        after = ((consistency_audit.get("inconsistencies") or {}).get("after") or {})
        recovered_count = int(((consistency_audit.get("inconsistencies") or {}).get("recovered_count") or 0))
        unresolved_after = int(len(after.get("missing_footnotes_for_seen_intext") or []))
        recovered_ok = recovered_count > 0 and unresolved_after == 0

    if unresolved > 0 and not recovered_ok:
        fatal.append(f"{unresolved} citations unresolved and no recovered+traced consistency audit evidence")
    if unresolved_missing > 0:
        fatal.append(f"{unresolved_missing} citations reference source_id not in source registry")

    if fatal:
        raise ScoringValidationError("; ".join(fatal))
    if unresolved > 0:
        findings.append(
            {
                "severity": "warning",
                "message": f"{unresolved} citations unresolved but consistency audit indicates recovered+traced coverage",
            }
        )
    return {"findings": findings}


def _claim_source_ids(claim: dict[str, Any]) -> list[str]:
    sixc = claim.get("six_c") or {}
    cred = sixc.get("credibility") or {}
    corr = sixc.get("corroboration") or {}
    coh = sixc.get("coherence") or {}
    found: list[str] = []

    for row in (cred.get("sources_supporting_claim") or []):
        if isinstance(row, dict) and isinstance(row.get("source_id"), str):
            found.append(row["source_id"])
    for row in (corr.get("corroboration_matrix") or []):
        if isinstance(row, dict):
            found.extend(str(s) for s in (row.get("supported_by_source_ids") or []) if isinstance(s, str))
    for step in (coh.get("argument_steps") or []):
        if isinstance(step, dict):
            found.extend(str(s) for s in (step.get("supporting_source_ids") or []) if isinstance(s, str))

    uniq: list[str] = []
    seen: set[str] = set()
    for sid in found:
        if sid not in seen:
            seen.add(sid)
            uniq.append(sid)
    return uniq


def _source_origins(source_ids: list[str], sources: dict[str, SourceNorm]) -> set[str]:
    origins: set[str] = set()
    for sid in source_ids:
        src = sources.get(sid)
        if not src:
            origins.add(_slug(sid))
            continue
        for o in src.origin_signature:
            origins.add(_slug(o))
    return {o for o in origins if o}


def _source_independence(src: SourceNorm, profile_cfg: dict[str, Any]) -> float:
    kind_base = dict(profile_cfg.get("source_kind_base") or {})
    score = kind_base.get(src.source_kind, 0.52)
    if src.is_litigation_prepared:
        score += 0.04
    if src.has_stated_conflict:
        score -= 0.10
    if src.has_countervailing_detail:
        score += 0.06
    return _clamp01(score)


def _feature_I(
    source_ids: list[str],
    sources: dict[str, SourceNorm],
    profile_cfg: dict[str, Any],
    evidence: dict[str, Any] | None = None,
    technical_no_source: bool = False,
) -> float:
    if not source_ids:
        if technical_no_source:
            score = 0.50
            ev = evidence or {}
            ctx = ev.get("collection_context") if isinstance(ev.get("collection_context"), dict) else {}
            if ctx:
                non_null = sum(
                    1
                    for k in ("collector", "collection_time_window", "collection_environment", "preservation_method")
                    if ctx.get(k)
                )
                score += 0.06 * min(4, non_null)
            if (ev.get("integrity_controls_disclosed") or []):
                score += 0.08
            if len(ev.get("anchors") or []) >= 1:
                score += 0.04
            if len(ev.get("anchors") or []) >= 2:
                score += 0.03
            notes = str(ev.get("notes") or "").lower()
            if any(m in notes for m in ("cross-vendor", "independent review", "joint advisory", "replicated")):
                score += 0.06
            score += float((profile_cfg.get("feature_bias") or {}).get("I") or 0.0)
            return _clamp01(score)
        return _clamp01(0.35 + float((profile_cfg.get("feature_bias") or {}).get("I") or 0.0))
    known = [sources[sid] for sid in source_ids if sid in sources]
    base = _mean([_source_independence(s, profile_cfg) for s in known], default=0.45)
    origins = _source_origins(source_ids, sources)
    kinds = {s.source_kind for s in known}
    score = base + (0.08 * min(2, max(0, len(origins) - 1)))
    if len(kinds) >= 2:
        score += 0.04
    if len(source_ids) == 1:
        score -= 0.15
    if len(origins) == 1 and len(source_ids) > 1:
        score -= 0.12
    score += float((profile_cfg.get("feature_bias") or {}).get("I") or 0.0)
    return _clamp01(score)


def _origin_id_from_sources(source_ids: list[str], sources: dict[str, SourceNorm]) -> str:
    origins = sorted(_source_origins(source_ids, sources))
    if not origins:
        return ""
    return "ORIG:" + "+".join(origins[:4])


def _origin_id_from_evidence(evidence: dict[str, Any], artifact_ids: list[str]) -> str:
    ctx = evidence.get("collection_context") if isinstance(evidence.get("collection_context"), dict) else {}
    collector = _slug(str(ctx.get("collector") or ""))
    env = _slug(str(ctx.get("collection_environment") or ""))
    if collector:
        return f"ORIG:collector:{collector}" + (f":{env}" if env else "")
    if artifact_ids:
        return f"ORIG:artifact:{_slug(str(artifact_ids[0]))}"
    ids = evidence.get("artifact_identifiers") or []
    if isinstance(ids, list) and ids:
        return f"ORIG:artifact:{_slug(str(ids[0]))}"
    return "ORIG:unknown"


def _feature_A(evidence: dict[str, Any], source_ids: list[str], sources: dict[str, SourceNorm], profile_cfg: dict[str, Any]) -> float:
    score = 0.30
    ctx = evidence.get("collection_context") if isinstance(evidence.get("collection_context"), dict) else {}
    if ctx:
        non_null = sum(1 for k in ("collector", "collection_time_window", "collection_environment", "preservation_method") if ctx.get(k))
        score += 0.06 * non_null
    ids = evidence.get("artifact_identifiers") or []
    if isinstance(ids, list) and ids:
        score += 0.10
    if isinstance(ids, list) and len(ids) >= 2:
        score += 0.05
    if (evidence.get("integrity_controls_disclosed") or []):
        score += 0.14
    notes = str(evidence.get("notes") or "").lower()
    if any(m in notes for m in ("decoded", "deobfus", "normalized", "enriched", "transformed", "derived from")):
        score += 0.05
    if any(m in notes for m in ("raw", "primary telemetry", "original sample", "chain of custody")):
        score += 0.06
    if (evidence.get("anchors") or []):
        score += 0.12
    if len(evidence.get("anchors") or []) >= 3:
        score += 0.05
    if (evidence.get("tampering_or_spoofing_risks_noted") or []):
        score += 0.08
    if any((sources.get(sid).source_kind in {"government", "court", "academic"}) for sid in source_ids if sid in sources):
        score += 0.06
    score += float((profile_cfg.get("feature_bias") or {}).get("A") or 0.0)
    return _clamp01(score)


def _feature_M(evidence: dict[str, Any], profile_cfg: dict[str, Any]) -> float:
    kind = str(evidence.get("evidence_kind") or "").lower()
    base_map = {
        "hash_md5": 0.78,
        "hash_sha1": 0.80,
        "hash_sha256": 0.82,
        "ipv4": 0.74,
        "ipv6": 0.74,
        "url": 0.62,
        "domain": 0.65,
        "email": 0.60,
        "file_name": 0.58,
        "process_name": 0.58,
    }
    score = base_map.get(kind, 0.56)
    ids = evidence.get("artifact_identifiers") or []
    if isinstance(ids, list) and len(ids) >= 2:
        score += 0.10
    notes = str(evidence.get("notes") or "")
    low = notes.lower()
    if len(notes) >= 120:
        score += 0.05
    if any(m in low for m in ("method", "pipeline", "procedure", "analysis", "dataset", "tool", "yara", "ioc", "rule")):
        score += 0.10
    if any(m in low for m in ("limitation", "caveat", "uncertain", "false positive", "bias")):
        score += 0.06
    score += float((profile_cfg.get("feature_bias") or {}).get("M") or 0.0)
    return _clamp01(score)


def _feature_P(
    evidence: dict[str, Any],
    source_ids: list[str],
    sources: dict[str, SourceNorm],
    claim: dict[str, Any],
    profile_cfg: dict[str, Any],
) -> float:
    score = 0.30
    if (evidence.get("integrity_controls_disclosed") or []):
        score += 0.18
    if (evidence.get("tampering_or_spoofing_risks_noted") or []):
        score += 0.12
    origins = _source_origins(source_ids, sources)
    if len(origins) >= 2:
        score += 0.20
    kinds = {sources[sid].source_kind for sid in source_ids if sid in sources}
    if len(kinds) >= 2:
        score += 0.10
    if len(evidence.get("anchors") or []) >= 2:
        score += 0.10
    coh = ((claim.get("six_c") or {}).get("coherence") or {})
    alts = coh.get("alternative_hypotheses_in_text") or []
    if isinstance(alts, list) and alts:
        score += 0.10
    notes = str(evidence.get("notes") or "").lower()
    if any(m in notes for m in ("independent review", "cross-vendor", "replicated", "joint advisory", "court exhibit", "sworn")):
        score += 0.10
    score += float((profile_cfg.get("feature_bias") or {}).get("P") or 0.0)
    return _clamp01(score)


def _feature_T(
    source_ids: list[str],
    sources: dict[str, SourceNorm],
    doc_pub_date: date | None,
    claim: dict[str, Any],
    profile_cfg: dict[str, Any],
) -> float:
    source_dates: list[date] = []
    for sid in source_ids:
        src = sources.get(sid)
        if not src:
            continue
        d = _parse_date(src.date_published)
        if d is not None:
            source_dates.append(d)
    if not source_dates:
        return 0.55
    scope = claim.get("scope")
    start = None
    end = None
    if isinstance(scope, dict):
        start = _parse_date(scope.get("time_range_start"))
        end = _parse_date(scope.get("time_range_end"))
    if start and end:
        gap_days = min(
            min(abs((d - start).days), abs((d - end).days))
            for d in source_dates
        )
        if gap_days <= 30:
            return _clamp01(0.96 + float((profile_cfg.get("feature_bias") or {}).get("T") or 0.0))
    primary_bonus = 0.0
    kinds = {sources[sid].source_kind for sid in source_ids if sid in sources}
    if "court" in kinds or "academic" in kinds:
        primary_bonus = 0.03
    if doc_pub_date is None:
        years = [d.year for d in source_dates]
        spread = max(years) - min(years) if years else 0
        return _clamp01((0.82 if spread <= 1 else (0.72 if spread <= 3 else 0.60)) + primary_bonus + float((profile_cfg.get("feature_bias") or {}).get("T") or 0.0))
    min_days = min(abs((d - doc_pub_date).days) for d in source_dates)
    if min_days <= 30:
        return _clamp01(0.95 + primary_bonus + float((profile_cfg.get("feature_bias") or {}).get("T") or 0.0))
    if min_days <= 180:
        return _clamp01(0.86 + primary_bonus + float((profile_cfg.get("feature_bias") or {}).get("T") or 0.0))
    if min_days <= 365:
        return _clamp01(0.78 + primary_bonus + float((profile_cfg.get("feature_bias") or {}).get("T") or 0.0))
    if min_days <= 730:
        return _clamp01(0.68 + primary_bonus + float((profile_cfg.get("feature_bias") or {}).get("T") or 0.0))
    return _clamp01(0.56 + primary_bonus + float((profile_cfg.get("feature_bias") or {}).get("T") or 0.0))


def _coherence_score(claim: dict[str, Any]) -> float:
    coh = ((claim.get("six_c") or {}).get("coherence") or {})
    steps = coh.get("argument_steps") or []
    alts = coh.get("alternative_hypotheses_in_text") or []
    score = 0.38 + (0.05 * min(6, len(steps)))
    if len(alts) > 0:
        score += 0.12
    return _clamp01(score)


def _confidence_discipline_score(claim: dict[str, Any]) -> float:
    conf = ((claim.get("six_c") or {}).get("confidence") or {})
    expressions = conf.get("certainty_expressions") or []
    scale_def = (conf.get("confidence_scale_definition") or {}).get("defined_in_document")
    score = 0.38 + (0.05 * min(4, len(expressions)))
    polarities = {str((e or {}).get("polarity") or "") for e in expressions if isinstance(e, dict)}
    if "uncertainty" in polarities or "mixed_or_hedged" in polarities:
        score += 0.14
    if scale_def is True:
        score += 0.12
    return _clamp01(score)


def _compliance_score(claim: dict[str, Any]) -> float:
    comp = ((claim.get("six_c") or {}).get("compliance") or {})
    mappings = comp.get("legal_mapping") or []
    if not mappings:
        return 0.30
    addressed = sum(1 for m in mappings if isinstance(m, dict) and m.get("addressed_in_text") is True)
    ratio = addressed / max(1, len(mappings))
    return _clamp01(0.30 + (0.70 * ratio))


def _claim_features(claim: dict[str, Any]) -> dict[str, float]:
    return {
        "coherence": _coherence_score(claim),
        "confidence_discipline": _confidence_discipline_score(claim),
        "compliance_mapping": _compliance_score(claim),
    }


def _claim_source_independence_score(
    source_ids: list[str],
    sources: dict[str, SourceNorm],
    profile_cfg: dict[str, Any],
) -> float:
    # Requested ordering for credibility weighting:
    # international institutions > NGO > government > newspaper/media
    kind_weights = dict(profile_cfg.get("source_hierarchy_weights") or {})
    vals: list[float] = []
    for sid in source_ids:
        s = sources.get(sid)
        if not s:
            continue
        base = kind_weights.get(s.source_kind, 0.52)
        if s.is_litigation_prepared:
            base -= 0.08
        if s.has_stated_conflict:
            base -= 0.10
        if s.has_countervailing_detail:
            base += 0.06
        vals.append(_clamp01(base))
    return _mean(vals, default=0.50)


def _claim_support_coverage(claim: dict[str, Any]) -> float:
    asserted = [str(x) for x in (claim.get("claim_components_asserted") or []) if str(x)]
    asserted_set = set(asserted)
    if not asserted_set:
        return 0.50

    sixc = claim.get("six_c") or {}
    cred = sixc.get("credibility") or {}
    corr = sixc.get("corroboration") or {}
    supported: set[str] = set()

    for row in (cred.get("sources_supporting_claim") or []):
        if not isinstance(row, dict):
            continue
        anchors = row.get("supporting_anchors") or []
        if not anchors:
            continue
        for comp in (row.get("supports_components") or []):
            if comp:
                supported.add(str(comp))

    for row in (corr.get("corroboration_matrix") or []):
        if not isinstance(row, dict):
            continue
        if int(row.get("source_count") or 0) <= 0:
            continue
        comp = row.get("component")
        if comp:
            supported.add(str(comp))

    covered = len(asserted_set.intersection(supported))
    return _clamp01(covered / max(1, len(asserted_set)))


def _claim_chain_disclosure_score(claim: dict[str, Any]) -> float:
    chain = ((claim.get("six_c") or {}).get("chain_of_custody") or {})
    qc = chain.get("quality_checks") if isinstance(chain.get("quality_checks"), dict) else {}
    has_verbatim = 1.0 if qc.get("has_verbatim_anchors") is True else 0.0
    has_external = 1.0 if qc.get("has_external_sources") is True else 0.0
    has_quant = 1.0 if qc.get("has_quantitative_counts") is True else 0.0
    has_limits = 1.0 if qc.get("has_explicit_limitations") is True else 0.0
    # Limitations disclosure is weighted higher because it is most probative of evidentiary discipline.
    return _clamp01((0.20 * has_verbatim) + (0.20 * has_external) + (0.20 * has_quant) + (0.40 * has_limits))


def _claim_anchor_alignment_score(claim: dict[str, Any]) -> float:
    chain = ((claim.get("six_c") or {}).get("chain_of_custody") or {})
    evidence_items = chain.get("evidence_items") or []
    if not isinstance(evidence_items, list) or not evidence_items:
        return 0.0

    claim_anchor_ids: set[str] = set()
    for ev in evidence_items:
        if not isinstance(ev, dict):
            continue
        for a in (ev.get("anchors") or []):
            if isinstance(a, dict):
                aid = str(a.get("anchor_id") or "").strip()
                if aid:
                    claim_anchor_ids.add(aid)
    if not claim_anchor_ids:
        return 0.0

    total_refs = 0
    matched_refs = 0
    for ev in evidence_items:
        if not isinstance(ev, dict):
            continue
        for counter in (ev.get("artifact_counters") or []):
            if not isinstance(counter, dict):
                continue
            for sa in (counter.get("supporting_anchors") or []):
                if not isinstance(sa, dict):
                    continue
                total_refs += 1
                sid = str(sa.get("anchor_id") or "").strip()
                if sid and sid in claim_anchor_ids:
                    matched_refs += 1
    if total_refs == 0:
        # No counter-level anchor references: neutral-low, not zero.
        return 0.50
    return _clamp01(matched_refs / total_refs)


def _artifact_proximity_hierarchy_score(claim: dict[str, Any]) -> tuple[float, dict[str, float]]:
    """
    Hierarchical claim-artifact proximity:
    direct anchor match > same section/page > same page > remote/unlinked.
    """
    chain = ((claim.get("six_c") or {}).get("chain_of_custody") or {})
    evidence_items = chain.get("evidence_items") or []
    if not isinstance(evidence_items, list) or not evidence_items:
        return 0.30, {"direct": 0.0, "contextual": 0.0, "local": 0.0, "remote": 1.0}

    claim_anchor_ids: set[str] = set()
    claim_anchor_pages: set[int] = set()
    claim_anchor_sections: set[str] = set()

    for ev in evidence_items:
        if not isinstance(ev, dict):
            continue
        for a in (ev.get("anchors") or []):
            if not isinstance(a, dict):
                continue
            aid = str(a.get("anchor_id") or "").strip()
            if aid:
                claim_anchor_ids.add(aid)
            loc = a.get("location") if isinstance(a.get("location"), dict) else {}
            page_idx = loc.get("page_index")
            if isinstance(page_idx, int):
                claim_anchor_pages.add(page_idx)
            sec = str(loc.get("section_heading") or "").strip().lower()
            if sec:
                claim_anchor_sections.add(sec)

    tier_weights = {"direct": 1.00, "contextual": 0.75, "local": 0.45, "remote": 0.15}
    tier_mass = {"direct": 0.0, "contextual": 0.0, "local": 0.0, "remote": 0.0}
    total_mass = 0.0

    for ev in evidence_items:
        if not isinstance(ev, dict):
            continue
        for counter in (ev.get("artifact_counters") or []):
            if not isinstance(counter, dict):
                continue
            count_raw = counter.get("count")
            try:
                mass = float(count_raw) if count_raw is not None else 1.0
            except (TypeError, ValueError):
                mass = 1.0
            mass = max(1.0, mass)
            anchors = counter.get("supporting_anchors") or []
            if not isinstance(anchors, list) or not anchors:
                tier_mass["remote"] += mass
                total_mass += mass
                continue

            best_tier = "remote"
            for sa in anchors:
                if not isinstance(sa, dict):
                    continue
                sid = str(sa.get("anchor_id") or "").strip()
                loc = sa.get("location") if isinstance(sa.get("location"), dict) else {}
                sec = str(loc.get("section_heading") or "").strip().lower()
                page_idx = loc.get("page_index")

                if sid and sid in claim_anchor_ids:
                    best_tier = "direct"
                    break
                same_page = isinstance(page_idx, int) and page_idx in claim_anchor_pages
                same_section = bool(sec) and sec in claim_anchor_sections
                if same_page and same_section:
                    if best_tier in ("remote", "local"):
                        best_tier = "contextual"
                elif same_page and best_tier == "remote":
                    best_tier = "local"

            tier_mass[best_tier] += mass
            total_mass += mass

    if total_mass <= 0.0:
        return 0.30, {"direct": 0.0, "contextual": 0.0, "local": 0.0, "remote": 1.0}

    tier_share = {k: (v / total_mass) for k, v in tier_mass.items()}
    score = sum(tier_share[k] * tier_weights[k] for k in tier_weights)
    return _clamp01(score), {k: round(v, 6) for k, v in tier_share.items()}


def _to_serializable_source(s: SourceNorm) -> dict[str, Any]:
    return {
        "source_id": s.source_id,
        "source_kind": s.source_kind,
        "title": s.title,
        "authors": s.authors,
        "authoring_org": s.authoring_org,
        "publisher": s.publisher,
        "date_published": s.date_published,
        "url": s.url,
        "domain": s.domain,
        "is_litigation_prepared": s.is_litigation_prepared,
        "is_single_source": s.is_single_source,
        "has_stated_conflict": s.has_stated_conflict,
        "has_countervailing_detail": s.has_countervailing_detail,
        "cites": s.cites,
        "origin_signature": s.origin_signature,
    }


def _build_scores(doc: dict[str, Any], profile: str = "balanced") -> dict[str, Any]:
    profile_norm = str(profile or "balanced").strip().lower()
    profile_cfg = _profile_config(profile_norm)
    sources = _normalize_sources(doc)
    artifacts = _normalize_artifacts(doc)
    consistency_audit = _load_json_if_exists(str(doc.get("_consistency_audit_path") or ""))
    readiness = _validate_scoring_ready(
        doc=doc,
        sources=sources,
        artifacts=artifacts,
        consistency_audit=consistency_audit,
    )
    artifact_ids_by_value: dict[str, list[str]] = {}
    for a in artifacts:
        key = str(a.get("value") or "").strip().lower()
        if not key:
            continue
        artifact_ids_by_value.setdefault(key, []).append(str(a.get("artifact_id") or ""))

    document_pub = _parse_date((doc.get("document_metadata") or {}).get("publication_date"))
    claims = ((doc.get("stage2_claim_extraction") or {}).get("attribution_claims") or [])

    normalized_evidence: list[dict[str, Any]] = []
    normalized_claims: list[dict[str, Any]] = []
    claim_scores: list[dict[str, Any]] = []
    evidence_counter = 1

    for claim in claims:
        if not isinstance(claim, dict):
            continue
        claim_id = str(claim.get("claim_id") or f"C-AUTO-{len(normalized_claims)+1:03d}")
        claim_features = _claim_features(claim)
        source_ids = _claim_source_ids(claim)
        claim_evidence = (((claim.get("six_c") or {}).get("chain_of_custody") or {}).get("evidence_items") or [])
        if not claim_evidence:
            claim_evidence = [{}]

        evidence_ids: list[str] = []
        weight_values: list[float] = []
        factors_a: list[float] = []
        factors_p: list[float] = []
        modalities_all: list[str] = []
        claim_recovered_refs = 0

        for ev in claim_evidence:
            evidence_id = f"E-{evidence_counter:04d}"
            evidence_counter += 1
            evidence_ids.append(evidence_id)
            evidence_kind = str((ev or {}).get("evidence_kind") or "dataset")
            technical_no_source = _is_technical_kind(evidence_kind) and not bool(source_ids)
            ids = (ev or {}).get("artifact_identifiers") or []
            artifact_ids: list[str] = []
            for raw in ids if isinstance(ids, list) else []:
                for aid in artifact_ids_by_value.get(str(raw).strip().lower(), []):
                    if aid and aid not in artifact_ids:
                        artifact_ids.append(aid)
            modality = evidence_kind
            if modality in ("hash_md5", "hash_sha1", "hash_sha256"):
                modality = "malware"
            elif modality in ("ipv4", "ipv6", "url", "domain"):
                modality = "infrastructure"
            elif modality in ("email",):
                modality = "communications"
            modalities = sorted({modality})
            modalities_all.extend(modalities)

            I = _feature_I(
                source_ids,
                sources,
                profile_cfg,
                evidence=(ev if isinstance(ev, dict) else {}),
                technical_no_source=technical_no_source,
            )
            A = _feature_A(ev if isinstance(ev, dict) else {}, source_ids, sources, profile_cfg)
            M = _feature_M(ev if isinstance(ev, dict) else {}, profile_cfg)
            P = _feature_P(ev if isinstance(ev, dict) else {}, source_ids, sources, claim, profile_cfg)
            T = _feature_T(source_ids, sources, document_pub, claim, profile_cfg)
            weight = _clamp01(I * A * M * P * T)

            factors_a.append(A)
            factors_p.append(P)
            weight_values.append(weight)

            source_origin_id = _origin_id_from_sources(source_ids, sources)
            origin_id = source_origin_id or _origin_id_from_evidence((ev if isinstance(ev, dict) else {}), artifact_ids)
            normalized_evidence.append(
                {
                    "evidence_id": evidence_id,
                    "evidence_kind": "technical_artifact" if evidence_kind in {"url", "domain", "ipv4", "ipv6", "hash_md5", "hash_sha1", "hash_sha256"} else "dataset",
                    "source_ids": source_ids,
                    "artifact_ids": artifact_ids,
                    "origin_id": origin_id,
                    "modalities": modalities,
                    "features": {"I": I, "A": A, "M": M, "P": P, "T": T},
                    "anchors": [
                        {
                            "page": int(((a.get("location") or {}).get("page_index") or 0)),
                            "block_id": str(((a.get("location") or {}).get("object_id") or "")),
                        }
                        for a in (ev.get("anchors") or [])
                        if isinstance(a, dict)
                    ],
                    "probative_weight": weight,
                    "claim_id": claim_id,
                }
            )

        recovered_indices: set[int] = set()
        if consistency_audit:
            raw_indices = ((consistency_audit.get("inconsistencies") or {}).get("recovered_indices") or [])
            for v in raw_indices:
                if isinstance(v, int):
                    recovered_indices.add(v)
                elif isinstance(v, str) and v.isdigit():
                    recovered_indices.add(int(v))
        claim_citations = [
            cit
            for page in ((doc.get("stage1_markdown_parse") or {}).get("pages") or [])
            for cit in (page.get("citations_found") or [])
            if isinstance(cit, dict) and str(cit.get("resolved_source_id") or "") in source_ids
        ]
        for cit in claim_citations:
            cid_text = str(cit.get("citation_id") or "")
            digits = "".join(ch for ch in cid_text if ch.isdigit())
            if digits and int(digits) in recovered_indices:
                claim_recovered_refs += 1

        source_unique_origins = _source_origins(source_ids, sources)
        unique_modalities = sorted(set(modalities_all))
        evidence_for_claim = [e for e in normalized_evidence if e.get("claim_id") == claim_id]
        by_origin: dict[str, list[float]] = {}
        for e in evidence_for_claim:
            oid = str(e.get("origin_id") or "ORIG:unknown")
            by_origin.setdefault(oid, []).append(float(e.get("probative_weight") or 0.0))
        origin_weights: dict[str, float] = {}
        for oid, ws in by_origin.items():
            acc = 1.0
            for w in ws:
                acc *= (1.0 - _clamp01(w))
            origin_weights[oid] = _clamp01(1.0 - acc)
        claim_convergence = 1.0
        for w in origin_weights.values():
            claim_convergence *= (1.0 - _clamp01(w))
        claim_convergence = _clamp01(1.0 - claim_convergence)

        credibility = _mean(weight_values, default=0.0)
        corroboration = _clamp01(
            claim_convergence
            + (0.08 * min(3, len(by_origin)))
            + (0.06 * min(3, len(unique_modalities)))
        )
        coherence = claim_features["coherence"]
        confidence_discipline = claim_features["confidence_discipline"]
        compliance_mapping = claim_features["compliance_mapping"]

        support_coverage = _claim_support_coverage(claim)
        artifact_proximity_hierarchy, artifact_proximity_tiers = _artifact_proximity_hierarchy_score(claim)
        data_contribution_score = _clamp01((0.55 * support_coverage) + (0.45 * artifact_proximity_hierarchy))
        data_contribution_multiplier = _clamp01(0.55 + (0.45 * data_contribution_score))
        base_claim_score = _clamp01(claim_convergence * data_contribution_multiplier)

        penalties: list[dict[str, Any]] = []
        if source_ids and len(source_unique_origins) < 2:
            penalties.append({"name": "single_source", "factor": 0.85})
        if len(source_ids) >= 2 and len(source_unique_origins) == 1:
            penalties.append({"name": "circularity_risk", "factor": 0.80})
        if _mean(factors_a, default=0.0) < 0.50:
            penalties.append({"name": "unauthenticated", "factor": 0.85})
        if _mean(factors_p, default=0.0) < 0.50:
            penalties.append({"name": "untested", "factor": 0.90})
        if claim_recovered_refs > 0:
            penalties.append({"name": "recovered_reference", "factor": 0.92})

        penalty_multiplier = 1.0
        penalty_power = float(profile_cfg.get("penalty_power") or 1.0)
        for p in penalties:
            base_factor = float(p["factor"])
            penalty_multiplier *= _clamp01(base_factor**penalty_power)
        final_score = _clamp01(base_claim_score * penalty_multiplier)

        anchors_total = sum(len(e.get("anchors") or []) for e in evidence_for_claim)
        expected_anchor_min = max(1, len(evidence_for_claim))
        anchor_completeness = _clamp01(anchors_total / expected_anchor_min)

        artifact_ref_total = sum(len(e.get("artifact_ids") or []) for e in evidence_for_claim)
        evidence_with_artifacts = sum(1 for e in evidence_for_claim if len(e.get("artifact_ids") or []) > 0)
        unique_artifacts = len({aid for e in evidence_for_claim for aid in (e.get("artifact_ids") or []) if aid})
        artifact_link_rate = _clamp01(evidence_with_artifacts / max(1, len(evidence_for_claim)))
        artifact_uniqueness = _clamp01(unique_artifacts / max(1, artifact_ref_total))
        integrity_signal = _clamp01(
            sum(
                1
                for ev in claim_evidence
                if isinstance(ev, dict) and (ev.get("integrity_controls_disclosed") or [])
            )
            / max(1, len(claim_evidence))
        )

        context_scores: list[float] = []
        lineage_scores: list[float] = []
        report_derived_flags: list[int] = []
        for ev in claim_evidence:
            if not isinstance(ev, dict):
                context_scores.append(0.0)
                lineage_scores.append(0.0)
                report_derived_flags.append(1)
                continue
            ctx = ev.get("collection_context") if isinstance(ev.get("collection_context"), dict) else {}
            def _is_real(v: Any) -> bool:
                if v is None:
                    return False
                s = str(v).strip().lower()
                if not s:
                    return False
                return s not in {"unknown", "n/a", "na", "none", "null", "not available", "unspecified"}
            present = sum(
                1
                for k in ("collector", "collection_time_window", "collection_environment", "preservation_method")
                if _is_real(ctx.get(k))
            )
            context_scores.append(_clamp01(present / 4.0))
            notes = str(ev.get("notes") or "").lower()
            ids = ev.get("artifact_identifiers") or []
            has_lineage = bool(ev.get("derived_from")) or (isinstance(ids, list) and len(ids) >= 2)
            if any(m in notes for m in ("derived", "decoded", "deobfus", "transformed", "enriched")):
                lineage_scores.append(1.0 if has_lineage else 0.0)
            else:
                lineage_scores.append(0.8 if isinstance(ids, list) and ids else 0.5)
            report_derived = 1 if (present <= 1 and not (ev.get("integrity_controls_disclosed") or [])) else 0
            report_derived_flags.append(report_derived)

        context_completeness = _mean(context_scores, default=0.0)
        lineage_quality = _mean(lineage_scores, default=0.0)
        report_derived_ratio = _mean([float(x) for x in report_derived_flags], default=1.0)

        # Chain of custody is computed as a continuous function (no hard caps).
        # It is intentionally separated from credibility: artifact/provenance quality drives C1.
        artifact_traceability = _clamp01((0.70 * artifact_link_rate) + (0.30 * artifact_uniqueness))
        provenance_quality = _clamp01(
            (0.45 * integrity_signal) + (0.35 * context_completeness) + (0.20 * lineage_quality)
        )
        anchor_quality = anchor_completeness
        chain_disclosure_quality = _claim_chain_disclosure_score(claim)
        claim_anchor_alignment = _claim_anchor_alignment_score(claim)

        # Weighted geometric composition: low custody dimensions should constrain the result.
        c1_core = _clamp01(
            (max(1e-6, provenance_quality) ** 0.40)
            * (max(1e-6, artifact_traceability) ** 0.15)
            * (max(1e-6, anchor_quality) ** 0.10)
            * (max(1e-6, chain_disclosure_quality) ** 0.10)
            * (max(1e-6, claim_anchor_alignment) ** 0.10)
            * (max(1e-6, artifact_proximity_hierarchy) ** 0.15)
        )

        # Smooth penalties (continuous) instead of fixed ceilings.
        integrity_penalty = 0.50 + (0.50 * integrity_signal)
        context_penalty = 0.65 + (0.35 * context_completeness)
        lineage_penalty = 0.70 + (0.30 * lineage_quality)
        report_derivation_penalty = 1.0 - (0.45 * report_derived_ratio * (1.0 - (0.60 * integrity_signal)))
        proximity_penalty = 0.45 + (0.55 * artifact_proximity_hierarchy)

        c1_chain = _clamp01(
            c1_core
            * integrity_penalty
            * context_penalty
            * lineage_penalty
            * report_derivation_penalty
            * proximity_penalty
        )

        source_independence = _claim_source_independence_score(source_ids, sources, profile_cfg)
        claim_discipline = _mean(
            [
                claim_features["coherence"],
                claim_features["confidence_discipline"],
                claim_features["compliance_mapping"],
            ],
            default=0.0,
        )
        c2_blend = dict(profile_cfg.get("c2_blend") or {})
        c2_source_w = float(c2_blend.get("source_independence") or 0.70)
        c2_claim_w = float(c2_blend.get("claim_discipline") or 0.30)
        c2_denom = max(1e-6, c2_source_w + c2_claim_w)
        c2_cred = _clamp01(((c2_source_w * source_independence) + (c2_claim_w * claim_discipline)) / c2_denom)
        if source_ids and len(source_unique_origins) <= 1:
            c2_cred = _clamp01(c2_cred * 0.90)

        claim_kind = str(claim.get("claim_type") or "unknown")
        nature_map = dict(profile_cfg.get("claim_nature_factor") or {})
        nature_factor = float(nature_map.get(claim_kind, nature_map.get("unknown", 0.98)))
        c3_blend = dict(profile_cfg.get("c3_support_blend") or {})
        c3_base_w = float(c3_blend.get("base") or 0.55)
        c3_sup_w = float(c3_blend.get("support") or 0.45)
        c3_denom = max(1e-6, c3_base_w + c3_sup_w)
        c3_support_multiplier = ((c3_base_w * 1.0) + (c3_sup_w * support_coverage)) / c3_denom
        c3_corr = _clamp01(corroboration * c3_support_multiplier * nature_factor)

        def to_band5(v: float) -> int:
            return max(0, min(5, int(round(_clamp01(v) * 5))))

        normalized_claims.append(
            {
                "claim_id": claim_id,
                "claim_kind": str(claim.get("claim_type") or "actor_attribution"),
                "claim_text": str(((claim.get("claim_statement") or {}).get("verbatim_text")) or ""),
                "actor": {
                    "name": str(((claim.get("subject") or {}).get("name")) if isinstance(claim.get("subject"), dict) else (claim.get("subject") or "")),
                    "level": str(((claim.get("subject") or {}).get("type")) if isinstance(claim.get("subject"), dict) else "unknown"),
                },
                "object": {
                    "operation": str(((claim.get("scope") or {}).get("operation_name")) if isinstance(claim.get("scope"), dict) else (claim.get("scope") or "")),
                    "time_start": str(((claim.get("scope") or {}).get("time_range_start")) if isinstance(claim.get("scope"), dict) else ""),
                    "time_end": str(((claim.get("scope") or {}).get("time_range_end")) if isinstance(claim.get("scope"), dict) else ""),
                },
                "citations": [
                    {
                        "cite_key": str(cit.get("citation_id") or ""),
                        "source_id": str(cit.get("resolved_source_id") or ""),
                        "anchor": {
                            "page": int((((cit.get("anchor") or {}).get("location") or {}).get("page_index") or 0)),
                            "block_id": str((((cit.get("anchor") or {}).get("location") or {}).get("object_id") or "")),
                        },
                    }
                    for page in ((doc.get("stage1_markdown_parse") or {}).get("pages") or [])
                    for cit in (page.get("citations_found") or [])
                    if isinstance(cit, dict) and str(cit.get("resolved_source_id") or "") in source_ids
                ],
                "evidence_ids": evidence_ids,
                "claim_features": {
                    **claim_features,
                    "allegation_gravity": str((claim.get("attribution") or {}).get("gravity") or "medium"),
                },
            }
        )

        claim_scores.append(
            {
                "claim_id": claim_id,
                "evidence_count": len(weight_values),
                "source_count": len(source_ids),
                "unique_origin_count": len(by_origin),
                "source_unique_origin_count": len(source_unique_origins),
                "evidence_weight_aggregate": _clamp01(base_claim_score),
                "origin_cluster_weights": {k: round(v, 6) for k, v in sorted(origin_weights.items())},
                "penalty_multiplier": round(penalty_multiplier, 6),
                "penalties": penalties,
                "final_score": round(final_score, 6),
                "recovered_reference_count": claim_recovered_refs,
                "data_contribution_score": round(data_contribution_score, 6),
                "data_contribution_multiplier": round(data_contribution_multiplier, 6),
                "core_3c": {
                    "chain_of_custody_provenance": {"score": round(c1_chain, 6), "band_0_5": to_band5(c1_chain)},
                    "credibility_independence": {"score": round(c2_cred, 6), "band_0_5": to_band5(c2_cred)},
                    "corroboration_convergence": {"score": round(c3_corr, 6), "band_0_5": to_band5(c3_corr)},
                },
                "chain_provenance_diagnostics": {
                    "context_completeness": round(context_completeness, 6),
                    "integrity_signal": round(integrity_signal, 6),
                    "lineage_quality": round(lineage_quality, 6),
                    "report_derived_ratio": round(report_derived_ratio, 6),
                    "artifact_traceability": round(artifact_traceability, 6),
                    "provenance_quality": round(provenance_quality, 6),
                    "anchor_quality": round(anchor_quality, 6),
                    "chain_disclosure_quality": round(chain_disclosure_quality, 6),
                    "claim_anchor_alignment": round(claim_anchor_alignment, 6),
                    "artifact_proximity_hierarchy": round(artifact_proximity_hierarchy, 6),
                    "artifact_proximity_tiers": artifact_proximity_tiers,
                },
                "claim_support_coverage": round(support_coverage, 6),
                "six_c_vector": {
                    "credibility": round(credibility, 6),
                    "corroboration": round(corroboration, 6),
                    "coherence": round(coherence, 6),
                    "confidence_discipline": round(confidence_discipline, 6),
                    "compliance_mapping": round(compliance_mapping, 6),
                },
            }
        )

    source_usage: dict[str, set[str]] = {}
    for raw_claim in claims:
        if not isinstance(raw_claim, dict):
            continue
        cid = str(raw_claim.get("claim_id") or "")
        if not cid:
            continue
        for sid in _claim_source_ids(raw_claim):
            source_usage.setdefault(sid, set()).add(cid)
    for sid, src in list(sources.items()):
        seen_claims = source_usage.get(sid, set())
        src.is_single_source = 1 if len(seen_claims) <= 1 else 0
        sources[sid] = src

    vectors = [c["six_c_vector"] for c in claim_scores]
    final_scores = [float(c["final_score"]) for c in claim_scores]
    core_c2 = [float(((c.get("core_3c") or {}).get("credibility_independence") or {}).get("score") or 0.0) for c in claim_scores]
    core_c3 = [float(((c.get("core_3c") or {}).get("corroboration_convergence") or {}).get("score") or 0.0) for c in claim_scores]
    headline = None
    if claim_scores:
        # Prefer salience rank in extraction; fallback to highest score.
        ranks: dict[str, int] = {}
        for claim in claims:
            if not isinstance(claim, dict):
                continue
            cid = str(claim.get("claim_id") or "")
            rank = claim.get("salience_rank")
            if isinstance(rank, int):
                ranks[cid] = rank
        if ranks:
            head_id = sorted(ranks.items(), key=lambda kv: kv[1])[0][0]
            headline = next((c for c in claim_scores if c["claim_id"] == head_id), claim_scores[0])
        else:
            headline = sorted(claim_scores, key=lambda c: c["final_score"], reverse=True)[0]

    overall_mean = _mean(final_scores, default=0.0)
    overall_geom = (math.prod([max(1e-6, s) for s in final_scores]) ** (1.0 / len(final_scores))) if final_scores else 0.0
    thresholds = dict(profile_cfg.get("seriousness_thresholds") or {})
    seriousness_pass = (
        overall_mean >= thresholds["overall_claim_score_mean_min"]
        and _median(core_c2, default=0.0) >= thresholds["credibility_independence_median_min"]
        and _median(core_c3, default=0.0) >= thresholds["corroboration_convergence_median_min"]
    )

    return {
        "icj_scoring_version": "v1",
        "inputs": {
            "document_title": str((doc.get("document_metadata") or {}).get("title") or ""),
            "document_publication_date": str((doc.get("document_metadata") or {}).get("publication_date") or ""),
            "claims_count": len(claim_scores),
            "profile": profile_norm,
        },
        "readiness_validation": readiness,
        "normalized": {
            "sources": [_to_serializable_source(s) for s in sorted(sources.values(), key=lambda x: x.source_id)],
            "artifacts": artifacts,
            "evidence_items": normalized_evidence,
            "claims": normalized_claims,
        },
        "scoring": {
            "claim_scores": claim_scores,
            "document": {
                "profile": profile_norm,
                "headline_claim_id": headline["claim_id"] if headline else None,
                "headline_vector": headline["six_c_vector"] if headline else {},
                "coverage_vector_median": {
                    "credibility": round(_median([v["credibility"] for v in vectors], default=0.0), 6),
                    "corroboration": round(_median([v["corroboration"] for v in vectors], default=0.0), 6),
                    "coherence": round(_median([v["coherence"] for v in vectors], default=0.0), 6),
                    "confidence_discipline": round(_median([v["confidence_discipline"] for v in vectors], default=0.0), 6),
                    "compliance_mapping": round(_median([v["compliance_mapping"] for v in vectors], default=0.0), 6),
                },
                "overall_claim_score_mean": round(overall_mean, 6),
                "overall_claim_score_geometric": round(overall_geom, 6),
                "seriousness_gate": {
                    "passed": bool(seriousness_pass),
                    "thresholds": thresholds,
                    "observed": {
                        "overall_claim_score_mean": round(overall_mean, 6),
                        "credibility_independence_median": round(_median(core_c2, default=0.0), 6),
                        "corroboration_convergence_median": round(_median(core_c3, default=0.0), 6),
                    },
                },
            },
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build ICJ-style deterministic claim scoring from annotarium extraction output."
    )
    parser.add_argument("--input", required=True, help="Path to extraction output JSON (e.g., annotarium/outputs/extraction/output.json).")
    parser.add_argument("--output", default="annotarium/outputs/scoring/icj_score_report.json", help="Where to write scoring JSON.")
    parser.add_argument("--consistency-audit", default="", help="Optional consistency audit JSON for recovered-reference handling.")
    parser.add_argument("--profile", choices=["strict", "balanced", "permissive"], default="balanced", help="Scoring calibration profile.")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    if not input_path.is_file():
        raise SystemExit(f"[ERROR] input JSON not found: {input_path}")

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("[ERROR] input JSON root must be an object.")
    if args.consistency_audit:
        payload["_consistency_audit_path"] = str(Path(args.consistency_audit).expanduser().resolve())

    try:
        scored = _build_scores(payload, profile=args.profile)
    except ScoringValidationError as exc:
        print(json.dumps({"ok": False, "error": "icj_scoring_validation_failed", "message": str(exc)}, ensure_ascii=False, indent=2))
        return 2
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(scored, ensure_ascii=False, indent=2), encoding="utf-8")

    out_dir = output_path.parent
    claim_scores_path = out_dir / "claim_scores.json"
    evidence_weights_path = out_dir / "evidence_weights.json"
    document_scores_path = out_dir / "document_scores.json"
    audit_md_path = out_dir / "audit.md"

    claim_scores_payload = {
        "claim_scores": ((scored.get("scoring") or {}).get("claim_scores") or []),
    }
    evidence_payload = {
        "evidence_weights": [
            {
                "evidence_id": e.get("evidence_id"),
                "claim_id": e.get("claim_id"),
                "I": (e.get("features") or {}).get("I"),
                "A": (e.get("features") or {}).get("A"),
                "M": (e.get("features") or {}).get("M"),
                "P": (e.get("features") or {}).get("P"),
                "T": (e.get("features") or {}).get("T"),
                "w": e.get("probative_weight"),
                "origin_id": e.get("origin_id"),
                "anchors": e.get("anchors") or [],
            }
            for e in (((scored.get("normalized") or {}).get("evidence_items") or []))
        ]
    }
    document_payload = {
        "document_scores": ((scored.get("scoring") or {}).get("document") or {}),
    }
    claim_scores_path.write_text(json.dumps(claim_scores_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    evidence_weights_path.write_text(json.dumps(evidence_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    document_scores_path.write_text(json.dumps(document_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    penalty_counts: dict[str, int] = {}
    for c in (claim_scores_payload.get("claim_scores") or []):
        for p in (c.get("penalties") or []):
            if isinstance(p, dict):
                name = str(p.get("name") or "unknown")
                penalty_counts[name] = penalty_counts.get(name, 0) + 1
    top_penalties = sorted(penalty_counts.items(), key=lambda kv: kv[1], reverse=True)
    readiness_findings = ((scored.get("readiness_validation") or {}).get("findings") or [])
    audit_lines = [
        "# ICJ Scoring Audit",
        "",
        f"- claims_scored: {len(claim_scores_payload['claim_scores'])}",
        f"- headline_claim_id: {((scored.get('scoring') or {}).get('document') or {}).get('headline_claim_id')}",
        "",
        "## Top Penalties",
    ]
    if top_penalties:
        for name, count in top_penalties[:10]:
            audit_lines.append(f"- {name}: {count}")
    else:
        audit_lines.append("- none")
    audit_lines.append("")
    audit_lines.append("## Readiness Findings")
    if readiness_findings:
        for f in readiness_findings:
            audit_lines.append(f"- {f.get('severity', 'info')}: {f.get('message', '')}")
    else:
        audit_lines.append("- none")
    audit_md_path.write_text("\n".join(audit_lines) + "\n", encoding="utf-8")

    artifacts_written = [
        str(output_path),
        str(claim_scores_path),
        str(evidence_weights_path),
        str(document_scores_path),
        str(audit_md_path),
    ]
    print(
        json.dumps(
            {
                "ok": True,
                "output_path": str(output_path),
                "profile": args.profile,
                "claims_scored": len((scored.get("scoring") or {}).get("claim_scores") or []),
                "artifacts_written": artifacts_written,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
