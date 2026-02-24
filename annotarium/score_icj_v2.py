#!/usr/bin/env python3
"""
ICJ-weighted scoring for cyber attribution dossiers.

Input JSON contract (required keys):
- source_registry: list[dict] OR dict with key "sources" -> list[dict]
  Each source dict must include:
    - source_id: str
    - url: str
    - title: str
    - authors: list[str]
    - year: int

- stage1_markdown_parse:
    - pages: list[dict]
      Each page dict must include:
        - text_blocks: list[dict] with keys: anchor_id, content
        - citations_found: list[dict] with keys: intext_anchor_id, raw_identifier, resolved_source_id

- stage2_claim_extraction:
    - attribution_claims: list[dict]
      Each claim dict must include:
        - claim_id: str
        - allegation_gravity: str in {"low","medium","high","exceptional"}
        - claim_statement: dict with keys: anchor_id, text

This scorer is deliberately strict about missing fields: missing keys should raise.
"""

import argparse
import json
import math
import re
from urllib.parse import urlsplit, urlunsplit


_STOP = {
    "the","a","an","and","or","to","of","in","on","for","with","as","by","at","from","is","are","was","were",
    "be","been","being","that","this","these","those","it","its","their","they","them","we","our","you","your",
    "can","may","might","will","would","should","could","not","no","yes"
}

_EVIDENCE_WORDS = {
    "md5","sha1","sha-1","sha256","sha-256","hash","checksum","signature","signed",
    "ip","ipv4","domain","dns","whois","asn","certificate","tls","pcap","packet","telemetry",
    "sinkhole","log","logs","forensic","image","write","blocker","immutable","archive","archived",
    "c2","command","control","infrastructure","malware","sample","ioc","indicator","tactic","technique",
    "timestamp","utc","timeline","victim","target","campaign","observed","confirmed","consistent","verified"
}

_CUSTODY_WORDS = {
    "collected","acquired","obtained","captured","received","provided","preserved","preservation",
    "forensic","image","write","blocker","hash","checksum","signature","archived","immutable","integrity",
    "timestamp","utc","version","revision","changelog","chain","custody","provenance"
}

_CORROBORATION_WORDS = {
    "confirmed","consistent","corroborated","independently","verified","cross-checked","crosschecked",
    "multiple","several","various","triangulated","supported","in addition","also","separately"
}

_ACT_WORDS = {
    "attack","intrusion","compromise","breach","espionage","operation","campaign","phishing","malware","exfiltration",
    "lateral","movement","persistence","c2","command","control","ddos","ransomware"
}

_ACTOR_WORDS = {
    "apt","unit","group","operator","operators","actor","actors","threat","cluster","intrusion set",
    "government","state","military","intelligence","ministry","service","pla","gru","svr","irgc"
}

_LINK_WORDS = {
    "attributed","attribute","linked","link","associated","association","conducted","carried","responsible",
    "sponsored","sponsor","directed","controlled","on behalf","on-behalf","on behalf of","tied","connected"
}

_STATE_WORDS = {
    "state","government","ministry","military","intelligence","republic","kingdom","federation",
    "china","russia","iran","north korea","dprk","turkey","israel","france","uk","united kingdom",
    "united states","usa","germany","netherlands","japan","australia","india"
}

_STATE_ORGAN_WORDS = {
    "state organ","organ of the state","government","ministry","agency","intelligence service",
    "armed forces","military unit","official unit","public authority","state institution","pla","unit"
}

_NONSTATE_ACTOR_WORDS = {
    "non-state","non state","proxy","proxies","contractor","contractors","private group","front company",
    "affiliate","affiliates","cybercriminal","criminal group","cyberpatriot","hacktivist","patriotic hacker"
}

_CONTROL_LINK_WORDS = {
    "directed","controlled","under control","instruction","instructed","ordered","on behalf","tasked",
    "command and control by","effective control","overall control","sponsored","state-backed","state backed"
}

_KNOWLEDGE_WORDS = {
    "knew","knowledge","aware","awareness","notice","notified","foreseeable","should have known","known activity"
}

_DUE_DILIGENCE_WORDS = {
    "failed to prevent","failure to prevent","did not prevent","failed to stop","did not stop",
    "failed to investigate","failed to prosecute","safe haven","harboring","allowed operations",
    "permitted operations","omission","inaction","lack of enforcement","due diligence"
}

_TERRITORY_WORDS = {
    "territory","within its territory","from its territory","jurisdiction","infrastructure in","hosting in"
}

_GRAVITY_THRESHOLD = {
    "low": 0.55,
    "medium": 0.70,
    "high": 0.85,
    "exceptional": 0.95
}

_GRAVITY_WEIGHT = {
    "low": 1.0,
    "medium": 1.2,
    "high": 1.5,
    "exceptional": 2.0
}


def _norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _tokenize(s: str) -> list[str]:
    s2 = re.sub(r"[^A-Za-z0-9]+", " ", s.lower())
    toks = [t for t in s2.split() if t and t not in _STOP]
    return toks


def _jaccard(a: set[str], b: set[str]) -> float:
    inter = len(a & b)
    uni = len(a | b)
    return inter / uni


def _extract_urls(s: str) -> list[str]:
    return re.findall(r"https?://[^\s\)\]\}<>\"']+", s)


def _norm_url(u: str) -> str:
    cleaned = (u or "").strip().rstrip(".,;:")
    p = urlsplit(cleaned)
    scheme = p.scheme.lower()
    netloc = p.netloc.lower()
    path = p.path
    path = path.rstrip("/")
    return urlunsplit((scheme, netloc, path, "", ""))


def _domain(u: str) -> str:
    p = urlsplit(u)
    return p.netloc.lower()


def _source_corroboration_profile(source: dict) -> tuple[str, float, bool]:
    source_type = str(source.get("source_type") or "").strip().lower()
    url = str(source.get("url") or "").strip().lower()
    title = str(source.get("title") or "").strip().lower()
    dom = _domain(url) if url else ""

    if source_type in {"internal_document_section"}:
        return "auto_source_or_internal", 0.0, False
    if source_type in {"press_media"}:
        return "newspaper", 0.0, False
    if source_type in {"international_institution", "judicial"}:
        return "international_institution", 1.0, True
    if source_type in {"government"}:
        return "official_government", 0.75, True
    if source_type in {"ngo"}:
        return "ngo", 0.6, True
    if source_type in {"academic"}:
        if any(x in dom for x in {"rand.org", "csis.org", "brookings.edu", "carnegie.org", "project2049.net"}) or any(
            x in title for x in {"think tank", "institute", "policy center", "research center"}
        ):
            return "think_tank", 0.5, True
        return "peer_reviewed_academic", 1.0, True

    if not url:
        return "auto_source_or_internal", 0.0, False

    newspaper_domains = {
        "washingtonpost.com", "nytimes.com", "theguardian.com", "bbc.com", "cnn.com", "reuters.com", "apnews.com",
        "wsj.com", "ft.com", "bloomberg.com",
    }
    if any(d in dom for d in newspaper_domains):
        return "newspaper", 0.0, False

    if any(x in dom for x in {"un.org", "nato.int", "europa.eu", "osce.org", "oecd.org"}) or any(
        x in title for x in {"united nations", "nato", "european union", "osce", "oecd", "international court"}
    ):
        return "international_institution", 1.0, True

    if any(x in dom for x in {"house.gov", ".gov", ".mil"}) or any(
        x in title for x in {"government", "ministry", "department", "intelligence", "committee", "hearing", "parliament", "congress"}
    ):
        return "official_government", 0.75, True

    if any(x in dom for x in {"rand.org", "csis.org", "brookings.edu", "carnegie.org", "project2049.net"}) or any(
        x in title for x in {"think tank", "institute", "policy center", "research center"}
    ):
        return "think_tank", 0.5, True

    if any(x in dom for x in {".edu", "ac.", "springer.com", "ieeexplore", "sciencedirect.com", "nature.com"}) or any(
        x in title for x in {"journal", "proceedings", "doi", "peer review", "peer-reviewed"}
    ):
        return "peer_reviewed_academic", 1.0, True

    return "other_source", 0.4, True


def _source_credibility_profile(source: dict) -> tuple[str, float, bool]:
    source_type = str(source.get("source_type") or "").strip().lower()
    url = str(source.get("url") or "").strip().lower()
    title = str(source.get("title") or "").strip().lower()
    dom = _domain(url) if url else ""

    if source_type in {"internal_document_section"}:
        return "auto_source_or_internal", 0.0, False
    if source_type in {"press_media"}:
        return "newspaper", 0.0, False
    if source_type in {"international_institution", "judicial"}:
        return "international_institution", 1.0, True
    if source_type in {"academic"}:
        return "peer_reviewed_academic", 1.0, True
    if source_type in {"government"}:
        return "official_government", 0.75, True
    if source_type in {"ngo"}:
        return "ngo", 0.65, True

    if not url:
        return "auto_source_or_internal", 0.0, False

    if any(x in dom for x in {"un.org", "nato.int", "europa.eu", "osce.org", "oecd.org"}) or any(
        x in title for x in {"united nations", "nato", "european union", "osce", "oecd", "international court"}
    ):
        return "international_institution", 1.0, True

    if any(x in dom for x in {".edu", "ac.", "springer.com", "ieeexplore", "sciencedirect.com", "nature.com"}) or any(
        x in title for x in {"journal", "proceedings", "doi", "peer review", "peer-reviewed"}
    ):
        return "peer_reviewed_academic", 1.0, True

    if any(x in dom for x in {"rand.org", "csis.org", "brookings.edu", "carnegie.org", "project2049.net"}) or any(
        x in title for x in {"think tank", "institute", "policy center", "research center"}
    ):
        return "think_tank", 0.7, True

    newspaper_domains = {
        "washingtonpost.com", "nytimes.com", "theguardian.com", "bbc.com", "cnn.com", "reuters.com", "apnews.com",
        "wsj.com", "ft.com", "bloomberg.com",
    }
    if any(d in dom for d in newspaper_domains):
        return "newspaper", 0.0, False

    if any(x in dom for x in {"house.gov", ".gov", ".mil"}) or any(
        x in title for x in {"government", "ministry", "department", "intelligence", "committee", "hearing", "parliament", "congress"}
    ):
        return "official_government", 0.75, True

    return "other_source", 0.45, True


def _build_sources(root: dict) -> list[dict]:
    sources = root["source_registry"]
    if "sources" in sources:
        sources = sources["sources"]
    return sources


def _index_sources(sources: list[dict]) -> tuple[dict, dict]:
    by_id = {}
    by_url = {}
    for s in sources:
        sid = s["source_id"]
        by_id[sid] = s
        by_url[_norm_url(s["url"])] = sid
    return by_id, by_url


def _blocks(root: dict) -> dict:
    pages = root["stage1_markdown_parse"]["pages"]
    m = {}
    for p in pages:
        for b in p["text_blocks"]:
            m[b["anchor_id"]] = b["content"]
    return m


def _citations_found(root: dict) -> list[dict]:
    pages = root["stage1_markdown_parse"]["pages"]
    out = []
    for p in pages:
        out.extend(p["citations_found"])
    return out


def _citations_by_anchor(citations: list[dict]) -> dict:
    m = {}
    for c in citations:
        aid = c["intext_anchor_id"]
        if aid not in m:
            m[aid] = []
        m[aid].append(c)
    return m


def _reconstruct_url_citations(blocks_map: dict, source_id_by_norm_url: dict) -> list[dict]:
    out = []
    seen = set()
    auto_i = 0
    for aid, txt in blocks_map.items():
        urls = _extract_urls(txt)
        for u in urls:
            nu = _norm_url(u)
            k = (aid, nu)
            if k in seen:
                continue
            seen.add(k)
            auto_i += 1
            sid = source_id_by_norm_url.get(nu)
            if not sid:
                continue
            out.append({
                "citation_id": f"AUTOURL{auto_i:04d}",
                "intext_anchor_id": aid,
                "raw_identifier": u,
                "resolved_source_id": sid
            })
    return out


def _count_hits(txt: str, vocab: set[str]) -> int:
    tl = txt.lower()
    c = 0
    for w in vocab:
        if w in tl:
            c += 1
    return c


def _contains_term(txt: str, term: str) -> bool:
    t = str(term or "").strip().lower()
    if not t:
        return False
    if " " in t:
        pattern = r"(?<![a-z0-9])" + re.escape(t).replace(r"\ ", r"\s+") + r"(?![a-z0-9])"
    else:
        pattern = r"\b" + re.escape(t) + r"\b"
    return re.search(pattern, txt.lower()) is not None


def _count_hits_precise(txt: str, vocab: set[str]) -> int:
    c = 0
    for w in vocab:
        if _contains_term(txt, w):
            c += 1
    return c


def _count_identifiers(txt: str) -> int:
    c = 0
    c += len(re.findall(r"\b[a-f0-9]{32}\b", txt.lower()))
    c += len(re.findall(r"\b[a-f0-9]{40}\b", txt.lower()))
    c += len(re.findall(r"\b[a-f0-9]{64}\b", txt.lower()))
    c += len(re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", txt))
    c += len(re.findall(r"\b[a-z0-9.-]+\.[a-z]{2,}\b", txt.lower()))
    return c


def _select_evidence_anchors(claim_text: str, claim_anchor_id: str, blocks_map: dict, k: int) -> list[str]:
    claim_toks = set(_tokenize(claim_text))
    cand = []
    for aid, txt in blocks_map.items():
        if aid == claim_anchor_id:
            continue
        btoks = set(_tokenize(txt))
        if len(btoks) < 12:
            continue
        ov = len(claim_toks & btoks)
        if ov < 3:
            continue
        sim = _jaccard(claim_toks, btoks)
        if sim > 0.75:
            continue
        ev = _count_hits(txt, _EVIDENCE_WORDS)
        score = (2.0 * ov) + (1.5 * ev) + min(len(btoks) / 80.0, 1.0)
        cand.append((score, aid, sim))
    cand.sort(reverse=True)
    out = []
    out_toks = []
    for score, aid, sim in cand:
        btoks = set(_tokenize(blocks_map[aid]))
        ok = 1
        for st in out_toks:
            if _jaccard(btoks, st) > 0.85:
                ok = 0
        if ok == 1:
            out.append(aid)
            out_toks.append(btoks)
        if len(out) >= k:
            break
    return out


def _grounding_score(claim_text: str, evidence_texts: list[str], claim_anchor_id: str, evidence_anchor_ids: list[str], citations_index: dict) -> tuple[float, dict]:
    claim_toks = set(_tokenize(claim_text))

    anchor_cov = min(len(evidence_anchor_ids) / 6.0, 1.0)

    nondup_vals = []
    ev_vals = []
    cit_count = 0
    src = set()

    for aid in evidence_anchor_ids:
        txt = evidence_texts[evidence_anchor_ids.index(aid)]
        btoks = set(_tokenize(txt))
        nondup_vals.append(1.0 - _jaccard(claim_toks, btoks))
        ev_vals.append(min(_count_hits(txt, _EVIDENCE_WORDS) / 8.0, 1.0))
        if aid in citations_index:
            for c in citations_index[aid]:
                cit_count += 1
                src.add(c["resolved_source_id"])

    nondup = sum(nondup_vals) / len(nondup_vals)
    ev = sum(ev_vals) / len(ev_vals)
    cit_cov = min(cit_count / 6.0, 1.0)
    src_cov = min(len(src) / 4.0, 1.0)

    score = 100.0 * (
        (0.25 * anchor_cov) +
        (0.20 * nondup) +
        (0.20 * ev) +
        (0.20 * cit_cov) +
        (0.15 * src_cov)
    )

    details = {
        "evidence_anchor_count": len(evidence_anchor_ids),
        "evidence_citation_count": cit_count,
        "evidence_source_count": len(src),
        "anchor_coverage": round(anchor_cov, 4),
        "nondup": round(nondup, 4),
        "evidence_marker_strength": round(ev, 4),
        "citation_coverage": round(cit_cov, 4),
        "source_coverage": round(src_cov, 4)
    }
    return score, details


def _custody_score(evidence_texts: list[str]) -> tuple[float, dict]:
    custody_hits = 0
    integrity_hits = 0
    time_hits = 0
    version_hits = 0
    id_hits = 0
    for t in evidence_texts:
        custody_hits += _count_hits(t, _CUSTODY_WORDS)
        integrity_hits += _count_hits(t, {"md5","sha1","sha-1","sha256","sha-256","hash","checksum","signature","write blocker","forensic image","immutable"})
        time_hits += _count_hits(t, {"utc","timestamp","time","date","first seen","last seen","between"})
        version_hits += _count_hits(t, {"version","revision","updated","update","changelog"})
        id_hits += _count_identifiers(t)

    provenance = min(custody_hits / 10.0, 1.0)
    integrity = min(integrity_hits / 6.0, 1.0)
    timea = min(time_hits / 6.0, 1.0)
    ids = min(id_hits / 10.0, 1.0)
    versioning = min(version_hits / 4.0, 1.0)

    score = 100.0 * (
        (0.30 * provenance) +
        (0.30 * integrity) +
        (0.15 * timea) +
        (0.15 * ids) +
        (0.10 * versioning)
    )

    details = {
        "provenance": round(provenance, 4),
        "integrity": round(integrity, 4),
        "time_anchors": round(timea, 4),
        "artifact_identifiers": round(ids, 4),
        "versioning": round(versioning, 4)
    }
    return score, details


def _corroboration_score(claim_sources: list[str], sources_by_id: dict, evidence_texts: list[str]) -> tuple[float, dict]:
    src = set(claim_sources)
    n_raw = len(src)
    if n_raw == 0:
        return 0.0, {
            "raw_source_count": 0,
            "eligible_source_count": 0,
            "excluded_sources_count": 0,
            "source_weight_sum": 0.0,
            "excluded_source_ids": [],
            "source_type_counts": {},
            "source_count": 0,
            "unique_domain_count": 0,
            "domain_independence": 0.0,
            "multi_source_factor": 0.0,
            "domain_independence_effective": 0.0,
            "source_quantity": 0.0,
            "source_domain_independence": 0.0,
            "modality_diversity": 0.0,
            "modality_diversity_effective": 0.0,
            "crosscheck_language": 0.0,
            "crosscheck_language_effective": 0.0,
            "corroboration_method": 0.0,
        }

    eligible_sids: list[str] = []
    excluded_sids: list[str] = []
    source_weight_sum = 0.0
    source_type_counts: dict[str, int] = {}
    for sid in sorted(src):
        s = sources_by_id.get(sid) or {}
        label, weight, eligible = _source_corroboration_profile(s)
        source_type_counts[label] = source_type_counts.get(label, 0) + 1
        if eligible:
            eligible_sids.append(sid)
            source_weight_sum += weight
        else:
            excluded_sids.append(sid)

    n = len(eligible_sids)
    if n == 0:
        return 0.0, {
            "raw_source_count": n_raw,
            "eligible_source_count": 0,
            "excluded_sources_count": len(excluded_sids),
            "source_weight_sum": 0.0,
            "excluded_source_ids": excluded_sids,
            "source_type_counts": source_type_counts,
            "source_count": 0,
            "unique_domain_count": 0,
            "domain_independence": 0.0,
            "multi_source_factor": 0.0,
            "domain_independence_effective": 0.0,
            "source_quantity": 0.0,
            "source_domain_independence": 0.0,
            "modality_diversity": 0.0,
            "modality_diversity_effective": 0.0,
            "crosscheck_language": 0.0,
            "crosscheck_language_effective": 0.0,
            "corroboration_method": 0.0,
        }

    domains = set()
    for sid in eligible_sids:
        s = sources_by_id.get(sid) or {}
        u = str(s.get("url") or "")
        if u:
            domains.add(_domain(u))
    domain_indep = len(domains) / n

    qty = min(max((source_weight_sum - 1.0) / 3.0, 0.0), 1.0)

    modality_vocab = {
        "malware": {"malware","reverse engineering","decompile","sample","payload"},
        "net": {"pcap","packet","dns","whois","asn","sinkhole","telemetry","ip","domain"},
        "victim": {"victim","target","targets","incident","compromise","breach","intrusion"},
        "geo": {"geolocation","geo","location","pudong","shanghai","beijing","moscow","tehran","pyongyang"},
        "human": {"human","operator","operators","persona","email","phone","social","linkedin"}
    }
    mods = set()
    joined = " ".join([t.lower() for t in evidence_texts])
    for m, ws in modality_vocab.items():
        hit = 0
        for w in ws:
            if w in joined:
                hit = 1
        if hit == 1:
            mods.add(m)
    modality = min(len(mods) / 4.0, 1.0)

    method_hits = 0
    for t in evidence_texts:
        method_hits += _count_hits(t, _CORROBORATION_WORDS)
    method = min(method_hits / 6.0, 1.0)

    # Corroboration is primarily a multi-source property:
    # single-source claims should not spike from modality/method language alone.
    multi_source_factor = min(max((source_weight_sum - 1.0) / 1.5, 0.0), 1.0)
    domain_effective = domain_indep * (0.25 + 0.75 * multi_source_factor)
    modality_effective = modality * multi_source_factor
    method_effective = method * multi_source_factor

    score = 100.0 * (
        (0.50 * qty) +
        (0.30 * domain_effective) +
        (0.10 * modality_effective) +
        (0.10 * method_effective)
    )

    details = {
        "raw_source_count": n_raw,
        "eligible_source_count": n,
        "excluded_sources_count": len(excluded_sids),
        "source_weight_sum": round(source_weight_sum, 4),
        "excluded_source_ids": excluded_sids,
        "source_type_counts": source_type_counts,
        "source_count": n,
        "unique_domain_count": len(domains),
        "domain_independence": round(domain_indep, 4),
        "multi_source_factor": round(multi_source_factor, 4),
        "domain_independence_effective": round(domain_effective, 4),
        "source_quantity": round(qty, 4),
        "modality_diversity": round(modality, 4),
        "modality_diversity_effective": round(modality_effective, 4),
        "crosscheck_language": round(method, 4)
        ,
        "crosscheck_language_effective": round(method_effective, 4)
    }
    return score, details


def _credibility_score(claim_sources: list[str], sources_by_id: dict) -> tuple[float, dict]:
    src = set(claim_sources)
    n_raw = len(src)
    if n_raw == 0:
        return 0.0, {
            "raw_source_count": 0,
            "eligible_source_count": 0,
            "excluded_sources_count": 0,
            "source_type_counts": {},
            "quality_mean": 0.0,
            "quality_top": 0.0,
            "source_diversity": 0.0,
            "domain_independence": 0.0,
            "single_source_penalty": 1.0,
            "has_high_cred_source": 0,
            "high_cred_threshold": 0.9,
        }

    eligible_sids: list[str] = []
    excluded_sids: list[str] = []
    source_type_counts: dict[str, int] = {}
    quality_vals: list[float] = []

    for sid in sorted(src):
        s = sources_by_id.get(sid) or {}
        label, weight, eligible = _source_credibility_profile(s)
        source_type_counts[label] = source_type_counts.get(label, 0) + 1
        if eligible:
            eligible_sids.append(sid)
            quality_vals.append(float(weight))
        else:
            excluded_sids.append(sid)

    n = len(eligible_sids)
    if n == 0:
        return 0.0, {
            "raw_source_count": n_raw,
            "eligible_source_count": 0,
            "excluded_sources_count": len(excluded_sids),
            "source_type_counts": source_type_counts,
            "quality_mean": 0.0,
            "quality_top": 0.0,
            "source_diversity": 0.0,
            "domain_independence": 0.0,
            "single_source_penalty": 1.0,
            "has_high_cred_source": 0,
            "high_cred_threshold": 0.9,
        }

    domains = set()
    for sid in eligible_sids:
        s = sources_by_id.get(sid) or {}
        u = str(s.get("url") or "")
        if u:
            domains.add(_domain(u))

    quality_mean = sum(quality_vals) / len(quality_vals)
    quality_top = max(quality_vals)
    source_diversity = min(n / 3.0, 1.0)
    domain_indep = len(domains) / max(1, n)
    high_cred_threshold = 0.9
    has_high_cred_source = 1 if quality_top >= high_cred_threshold else 0
    single_source_penalty = 0.85 if n == 1 else 1.0

    score = 100.0 * (
        (0.55 * quality_mean) +
        (0.20 * quality_top) +
        (0.15 * source_diversity) +
        (0.10 * domain_indep)
    ) * single_source_penalty

    details = {
        "raw_source_count": n_raw,
        "eligible_source_count": n,
        "excluded_sources_count": len(excluded_sids),
        "source_type_counts": source_type_counts,
        "quality_mean": round(quality_mean, 4),
        "quality_top": round(quality_top, 4),
        "source_diversity": round(source_diversity, 4),
        "domain_independence": round(domain_indep, 4),
        "single_source_penalty": round(single_source_penalty, 4),
        "has_high_cred_source": has_high_cred_source,
        "high_cred_threshold": high_cred_threshold,
    }
    return score, details


def _stated_confidence_value(txt: str) -> float:
    tl = txt.lower()
    v = 0.0
    if "high confidence" in tl:
        v = max(v, 0.90)
    if "moderate confidence" in tl:
        v = max(v, 0.70)
    if "low confidence" in tl:
        v = max(v, 0.50)
    if "very likely" in tl:
        v = max(v, 0.80)
    if "likely" in tl:
        v = max(v, 0.65)
    if "possible" in tl:
        v = max(v, 0.40)
    if "may" in tl:
        v = max(v, 0.35)
    return v


def _confidence_score(claim_text: str, evidence_texts: list[str], supported: float) -> tuple[float, dict]:
    joined = " ".join([claim_text] + evidence_texts)
    tl = joined.lower()

    explicit = 0.0
    if "confidence" in tl:
        explicit = 1.0
    if explicit == 0.0:
        if "likely" in tl or "very likely" in tl or "possible" in tl:
            explicit = 0.5

    lim_hits = 0
    lim_hits += _count_hits(joined, {"we assess","we judge","we estimate","uncertain","uncertainty","limited","unknown","cannot","could be","may be","incomplete","partial","we did not"})
    trans = min(lim_hits / 4.0, 1.0)

    stated = _stated_confidence_value(joined)
    over = max(0.0, stated - supported)
    calib = 1.0 - over
    calib = max(0.0, calib)

    score = 100.0 * (
        (0.40 * explicit) +
        (0.30 * trans) +
        (0.30 * calib)
    )

    details = {
        "explicitness": round(explicit, 4),
        "uncertainty_transparency": round(trans, 4),
        "stated_confidence": round(stated, 4),
        "calibration": round(calib, 4)
    }
    return score, details


def _clarity_score(claim_text: str, evidence_texts: list[str]) -> tuple[float, dict]:
    evidence_joined = " ".join(evidence_texts)

    act_claim = min(_count_hits_precise(claim_text, _ACT_WORDS) / 3.0, 1.0)
    actor_claim = min(_count_hits_precise(claim_text, _ACTOR_WORDS) / 3.0, 1.0)
    link_claim = min(_count_hits_precise(claim_text, _LINK_WORDS) / 3.0, 1.0)

    act_evidence = min(_count_hits_precise(evidence_joined, _ACT_WORDS) / 6.0, 1.0)
    actor_evidence = min(_count_hits_precise(evidence_joined, _ACTOR_WORDS) / 6.0, 1.0)
    link_evidence = min(_count_hits_precise(evidence_joined, _LINK_WORDS) / 6.0, 1.0)

    act = (0.65 * act_claim) + (0.35 * act_evidence)
    actor = (0.65 * actor_claim) + (0.35 * actor_evidence)
    link = (0.60 * link_claim) + (0.40 * link_evidence)

    state_actor_claim = min(_count_hits_precise(claim_text, _STATE_WORDS | _STATE_ORGAN_WORDS) / 4.0, 1.0)
    state_actor_evidence = min(_count_hits_precise(evidence_joined, _STATE_WORDS | _STATE_ORGAN_WORDS) / 6.0, 1.0)
    state_actor_signal = (0.60 * state_actor_claim) + (0.40 * state_actor_evidence)

    organ_path = (0.40 * state_actor_signal) + (0.30 * link) + (0.30 * act)

    nonstate_claim = min(_count_hits_precise(claim_text, _NONSTATE_ACTOR_WORDS) / 3.0, 1.0)
    nonstate_evidence = min(_count_hits_precise(evidence_joined, _NONSTATE_ACTOR_WORDS) / 5.0, 1.0)
    nonstate_signal = (0.60 * nonstate_claim) + (0.40 * nonstate_evidence)
    control_claim = min(_count_hits_precise(claim_text, _CONTROL_LINK_WORDS) / 3.0, 1.0)
    control_evidence = min(_count_hits_precise(evidence_joined, _CONTROL_LINK_WORDS) / 5.0, 1.0)
    control_signal = (0.55 * control_claim) + (0.45 * control_evidence)
    control_path = (0.35 * nonstate_signal) + (0.40 * control_signal) + (0.25 * state_actor_signal)

    knowledge_claim = min(_count_hits_precise(claim_text, _KNOWLEDGE_WORDS) / 3.0, 1.0)
    knowledge_evidence = min(_count_hits_precise(evidence_joined, _KNOWLEDGE_WORDS) / 5.0, 1.0)
    knowledge_signal = (0.55 * knowledge_claim) + (0.45 * knowledge_evidence)
    omission_claim = min(_count_hits_precise(claim_text, _DUE_DILIGENCE_WORDS) / 3.0, 1.0)
    omission_evidence = min(_count_hits_precise(evidence_joined, _DUE_DILIGENCE_WORDS) / 5.0, 1.0)
    omission_signal = (0.55 * omission_claim) + (0.45 * omission_evidence)
    territory_signal = min(_count_hits_precise(claim_text + " " + evidence_joined, _TERRITORY_WORDS) / 3.0, 1.0)
    due_diligence_path = (0.45 * knowledge_signal) + (0.45 * omission_signal) + (0.10 * territory_signal)

    legal_path_max = max(organ_path, control_path, due_diligence_path)
    legal_path_coverage = (
        (1 if organ_path >= 0.55 else 0) +
        (1 if control_path >= 0.55 else 0) +
        (1 if due_diligence_path >= 0.55 else 0)
    ) / 3.0

    claim_has_state = 1 if any(_contains_term(claim_text, w) for w in _STATE_WORDS) else 0
    state_link_terms = {"unit","ministry","government","state","military","intelligence","sponsored","on behalf","directed","controlled"}
    evidence_has_state_link = 1 if any(_contains_term(evidence_joined, w) for w in state_link_terms) else 0

    gap_pen = 0.0
    if claim_has_state == 1 and evidence_has_state_link == 0:
        gap_pen = 0.35
    legal_gap_pen = 0.0
    if claim_has_state == 1 and legal_path_max < 0.40:
        legal_gap_pen = 0.20

    base = (
        (0.22 * act) +
        (0.22 * actor) +
        (0.16 * link) +
        (0.20 * legal_path_max) +
        (0.20 * legal_path_coverage)
    )
    score = 100.0 * base * max(0.0, (1.0 - gap_pen - legal_gap_pen))

    def _answer_label(v: float, hi: float = 0.67, mid: float = 0.45) -> str:
        if v >= hi:
            return "yes"
        if v >= mid:
            return "partial"
        return "no"

    attribution_core = max(0.0, ((0.40 * act) + (0.30 * actor) + (0.30 * link)) * (1.0 - gap_pen - legal_gap_pen))
    responsibility_mode_core = legal_path_max
    due_diligence_core = due_diligence_path

    q_attribution = {
        "question": "Is attribution to State X for attack Z clear?",
        "score_0_1": round(attribution_core, 4),
        "answer": _answer_label(attribution_core),
    }
    q_responsibility_mode = {
        "question": "Is the state-responsibility mode clear (organ, control, or due diligence)?",
        "score_0_1": round(responsibility_mode_core, 4),
        "answer": _answer_label(responsibility_mode_core, hi=0.60, mid=0.40),
    }
    q_due_diligence = {
        "question": "Is state knowledge plus failure to prevent (due diligence) clear?",
        "score_0_1": round(due_diligence_core, 4),
        "answer": _answer_label(due_diligence_core, hi=0.60, mid=0.35),
    }

    mode_scores = {
        "conducted_by_state_organs": {
            "score_0_1": round(organ_path, 4),
            "answer": _answer_label(organ_path, hi=0.60, mid=0.40),
        },
        "non_state_actors_under_state_control": {
            "score_0_1": round(control_path, 4),
            "answer": _answer_label(control_path, hi=0.60, mid=0.40),
        },
        "state_due_diligence_failure": {
            "score_0_1": round(due_diligence_path, 4),
            "answer": _answer_label(due_diligence_path, hi=0.60, mid=0.35),
        },
    }

    details = {
        "act_specificity": round(act, 4),
        "actor_specificity": round(actor, 4),
        "link_specificity": round(link, 4),
        "act_claim": round(act_claim, 4),
        "act_evidence": round(act_evidence, 4),
        "actor_claim": round(actor_claim, 4),
        "actor_evidence": round(actor_evidence, 4),
        "link_claim": round(link_claim, 4),
        "link_evidence": round(link_evidence, 4),
        "state_actor_signal": round(state_actor_signal, 4),
        "organ_path_clarity": round(organ_path, 4),
        "control_path_clarity": round(control_path, 4),
        "due_diligence_path_clarity": round(due_diligence_path, 4),
        "legal_path_max": round(legal_path_max, 4),
        "legal_path_coverage": round(legal_path_coverage, 4),
        "state_claim_flag": int(claim_has_state),
        "state_link_evidence_flag": int(evidence_has_state_link),
        "state_actor_gap_penalty": round(gap_pen, 4),
        "legal_path_gap_penalty": round(legal_gap_pen, 4),
        "questions": {
            "attribution_clarity": q_attribution,
            "responsibility_mode_clarity": q_responsibility_mode,
            "due_diligence_clarity": q_due_diligence,
        },
        "responsibility_modes": mode_scores,
    }
    return score, details


def _belief_score(evidence_support: float, req: float) -> float:
    k = 12.0
    x = evidence_support - req
    return 100.0 / (1.0 + math.exp(-k * x))


def llm_clarity_enrichment_placeholder() -> dict:
    """
    Placeholder for optional LLM enrichment (gpt-5-mini).

    Goal: produce higher-resolution act/actor/link parsing and flag act-actor conflation.

    Prompt template (inputs):
    - claim_id (string)
    - claim_statement (string)
    - evidence_anchors: list of {anchor_id, text}
    - claim_sources: list of {source_id, title, url}

    Prompt requirements:
    - Extract act description and actor description as distinct fields.
    - Determine actor_type in {"state","state-organ","non-state","unknown"}.
    - If actor_type is state, determine attribution_path in {"organ","instruction","direction-control","support-only","unknown"}.
    - Output a clarity_score_0_100 and a short rationale (max 80 words).
    - Output gap_assessment in {"closed","partially-closed","open"}.

    Output JSON object shape:
    {
      "claim_id": "...",
      "act": {"summary": "...", "specificity_0_1": 0.0},
      "actor": {"summary": "...", "specificity_0_1": 0.0, "actor_type": "..."},
      "link": {
        "summary": "...",
        "specificity_0_1": 0.0,
        "attribution_path": "...",
        "conflation_flags": ["..."]
      },
      "gap_assessment": "...",
      "clarity_score_0_100": 0.0,
      "rationale": "..."
    }
    """
    return {}


def llm_anchor_alignment_placeholder() -> dict:
    """
    Placeholder for optional LLM enrichment (gpt-5-mini) to improve claim grounding precision.

    Goal: given one claim and a pool of candidate anchors, select the best anchors that contain
    distinct supporting facts (not claim restatement) and label what each anchor supports.

    Prompt template (inputs):
    - claim_id (string)
    - claim_statement (string)
    - candidate_anchors: list of {anchor_id, text}
    - citations_in_candidate_anchors: list of {anchor_id, source_id, url, title}

    Prompt requirements:
    - Output selected_anchor_ids (ranked).
    - For each selected anchor, output:
        - relevance_0_1
        - supports: subset of {"custody","corroboration","confidence","clarity","grounding"}
        - evidence_kind: short label such as "network-telemetry", "malware-analysis", "victim-log",
          "infra-registration", "human-source", "legal-reference", "policy-assertion"
        - key_facts: list of short strings (max 6)

    Output JSON object shape:
    {
      "claim_id": "...",
      "selected_anchor_ids": ["A001","A002"],
      "anchors": [
        {
          "anchor_id": "A001",
          "relevance_0_1": 0.0,
          "supports": ["corroboration","grounding"],
          "evidence_kind": "...",
          "key_facts": ["..."]
        }
      ],
      "notes": "..."
    }
    """
    return {}



def _score_claim(claim: dict, blocks_map: dict, citations_index: dict, sources_by_id: dict) -> dict:
    cid = claim["claim_id"]
    gravity = claim["allegation_gravity"]
    req = _GRAVITY_THRESHOLD[gravity]
    w = _GRAVITY_WEIGHT[gravity]

    claim_anchor = claim["claim_statement"]["anchor_id"]
    claim_text = _norm_space(claim["claim_statement"]["text"])

    evidence_anchor_ids = _select_evidence_anchors(claim_text, claim_anchor, blocks_map, 8)
    evidence_texts = [blocks_map[aid] for aid in evidence_anchor_ids]

    grounding, grounding_details = _grounding_score(claim_text, evidence_texts, claim_anchor, evidence_anchor_ids, citations_index)

    claim_sources = set()
    for aid in evidence_anchor_ids:
        if aid in citations_index:
            for c in citations_index[aid]:
                claim_sources.add(c["resolved_source_id"])
    claim_sources = sorted(list(claim_sources))

    custody, custody_details = _custody_score(evidence_texts)
    credibility, credibility_details = _credibility_score(claim_sources, sources_by_id)
    corroboration, corroboration_details = _corroboration_score(claim_sources, sources_by_id, evidence_texts)

    evidence_weight = (
        (0.30 * custody) +
        (0.25 * credibility) +
        (0.25 * corroboration) +
        (0.20 * grounding)
    )

    clarity, clarity_details = _clarity_score(claim_text, evidence_texts)
    evidence_support = (evidence_weight / 100.0) * (clarity / 100.0)

    confidence, confidence_details = _confidence_score(claim_text, evidence_texts, evidence_support)

    belief = _belief_score(evidence_support, req)

    out = {
        "claim_id": cid,
        "allegation_gravity": gravity,
        "required_threshold_0_1": req,
        "gravity_weight": w,
        "claim_statement": {
            "anchor_id": claim_anchor,
            "text": claim_text
        },
        "evidence": {
            "evidence_anchor_ids": evidence_anchor_ids,
            "claim_sources": claim_sources
        },
        "support_anchor_ids": evidence_anchor_ids,
        "sources_supporting_claim": claim_sources,
        "scores": {
            "grounding_0_100": round(grounding, 2),
            "custody_0_100": round(custody, 2),
            "credibility_0_100": round(credibility, 2),
            "corroboration_0_100": round(corroboration, 2),
            "confidence_0_100": round(confidence, 2),
            "clarity_0_100": round(clarity, 2),
            "evidence_weight_0_100": round(evidence_weight, 2),
            "evidence_support_0_1": round(evidence_support, 4),
            "belief_0_100": round(belief, 2)
        },
        "score_details": {
            "grounding": grounding_details,
            "custody": custody_details,
            "credibility": credibility_details,
            "corroboration": corroboration_details,
            "confidence": confidence_details,
            "clarity": clarity_details
        }
    }
    return out


def _score_document(root: dict) -> dict:
    sources = _build_sources(root)
    sources_by_id, source_id_by_norm_url = _index_sources(sources)

    blocks_map = _blocks(root)
    citations0 = _citations_found(root)
    citations1 = _reconstruct_url_citations(blocks_map, source_id_by_norm_url)
    citations = citations0 + citations1
    citations_index = _citations_by_anchor(citations)

    claims = root["stage2_claim_extraction"]["attribution_claims"]
    scored = [_score_claim(c, blocks_map, citations_index, sources_by_id) for c in claims]

    # Document-level credibility and corroboration calibration:
    # both axes are interpreted as claim-set coverage properties, not absolute local counts.
    if len(scored) > 0:
        total_claims = len(scored)
        total_w_cov = sum(float(c.get("gravity_weight", 0.0) or 0.0) for c in scored)
        credible_claims_n = sum(
            1
            for c in scored
            if int((((c.get("score_details") or {}).get("credibility") or {}).get("has_high_cred_source") or 0)) == 1
        )
        credible_w = sum(
            float(c.get("gravity_weight", 0.0) or 0.0)
            for c in scored
            if int((((c.get("score_details") or {}).get("credibility") or {}).get("has_high_cred_source") or 0)) == 1
        )
        corroborated_claims_n = sum(
            1 for c in scored if float((c.get("scores") or {}).get("corroboration_0_100", 0.0) or 0.0) > 0.0
        )
        corroborated_w = sum(
            float(c.get("gravity_weight", 0.0) or 0.0)
            for c in scored
            if float((c.get("scores") or {}).get("corroboration_0_100", 0.0) or 0.0) > 0.0
        )
        if total_w_cov > 0:
            credibility_claim_coverage_factor = credible_w / total_w_cov
            claim_coverage_factor = corroborated_w / total_w_cov
        else:
            credibility_claim_coverage_factor = 0.0
            claim_coverage_factor = 0.0

        for c in scored:
            s = c["scores"]
            raw_cred = float(s.get("credibility_0_100", 0.0) or 0.0)
            calibrated_cred = raw_cred * credibility_claim_coverage_factor
            s["credibility_raw_0_100"] = round(raw_cred, 2)
            s["credibility_0_100"] = round(calibrated_cred, 2)

            raw_corr = float(s.get("corroboration_0_100", 0.0) or 0.0)
            calibrated_corr = raw_corr * claim_coverage_factor
            s["corroboration_raw_0_100"] = round(raw_corr, 2)
            s["corroboration_0_100"] = round(calibrated_corr, 2)

            grounding = float(s.get("grounding_0_100", 0.0) or 0.0)
            custody = float(s.get("custody_0_100", 0.0) or 0.0)
            clarity = float(s.get("clarity_0_100", 0.0) or 0.0)
            evidence_weight = (0.30 * custody) + (0.25 * calibrated_cred) + (0.25 * calibrated_corr) + (0.20 * grounding)
            evidence_support = (evidence_weight / 100.0) * (clarity / 100.0)
            req = float(c.get("required_threshold_0_1", 0.7) or 0.7)
            belief = _belief_score(evidence_support, req)

            s["evidence_weight_0_100"] = round(evidence_weight, 2)
            s["evidence_support_0_1"] = round(evidence_support, 4)
            s["belief_0_100"] = round(belief, 2)

            c.setdefault("score_details", {}).setdefault("corroboration", {})
            c.setdefault("score_details", {}).setdefault("credibility", {})
            c["score_details"]["credibility"]["claim_coverage_factor"] = round(credibility_claim_coverage_factor, 4)
            c["score_details"]["credibility"]["credible_claims_count"] = credible_claims_n
            c["score_details"]["credibility"]["claims_total"] = total_claims
            c["score_details"]["credibility"]["credible_claims_ratio"] = round(
                credible_claims_n / float(total_claims), 4
            )
            c["score_details"]["credibility"]["credible_claims_weighted_ratio"] = round(
                credibility_claim_coverage_factor, 4
            )
            c["score_details"]["corroboration"]["claim_coverage_factor"] = round(claim_coverage_factor, 4)
            c["score_details"]["corroboration"]["corroborated_claims_count"] = corroborated_claims_n
            c["score_details"]["corroboration"]["claims_total"] = total_claims
            c["score_details"]["corroboration"]["corroborated_claims_ratio"] = round(
                corroborated_claims_n / float(total_claims), 4
            )
            c["score_details"]["corroboration"]["corroborated_claims_weighted_ratio"] = round(
                claim_coverage_factor, 4
            )

    tot_w = 0.0
    acc = 0.0
    for c in scored:
        w = c["gravity_weight"]
        tot_w += w
        acc += w * c["scores"]["belief_0_100"]
    doc_score = acc / tot_w

    g = sum([c["scores"]["grounding_0_100"] for c in scored]) / len(scored)
    cu = sum([c["scores"]["custody_0_100"] for c in scored]) / len(scored)
    cr = sum([c["scores"]["credibility_0_100"] for c in scored]) / len(scored)
    co = sum([c["scores"]["corroboration_0_100"] for c in scored]) / len(scored)
    cf = sum([c["scores"]["confidence_0_100"] for c in scored]) / len(scored)
    cl = sum([c["scores"]["clarity_0_100"] for c in scored]) / len(scored)

    cited_sources = set()
    for c in citations:
        cited_sources.add(c["resolved_source_id"])
    citation_coverage = len(cited_sources) / len(sources)

    out = {
        "report_type": "icj_score_report",
        "report_version": "v3",
        "document_scores": {
            "belief_weighted_0_100": round(doc_score, 2),
            "grounding_avg_0_100": round(g, 2),
            "custody_avg_0_100": round(cu, 2),
            "credibility_avg_0_100": round(cr, 2),
            "corroboration_avg_0_100": round(co, 2),
            "confidence_avg_0_100": round(cf, 2),
            "clarity_avg_0_100": round(cl, 2),
            "citation_coverage_sources_0_1": round(citation_coverage, 4),
            "sources_total": len(sources),
            "citations_total": len(citations)
        },
        "claims": scored
    }
    return out


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args(argv)

    root = json.loads(Path(args.input).read_text(encoding="utf-8"))
    report = _score_document(root)
    Path(args.output).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    import sys
    from pathlib import Path
    main(sys.argv[1:])
