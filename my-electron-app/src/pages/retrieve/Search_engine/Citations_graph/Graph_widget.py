import base64
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from PyQt6.QtWebChannel import QWebChannel

# ------------------------------------------------------------------
# WebEngine stability bootstrap (MUST run before any PyQt6 import)
# ------------------------------------------------------------------
is_windows = sys.platform.startswith("win")

def _clean_flags(s: str) -> str:
    s = (s or "").strip()
    # normalise whitespace
    s = " ".join(s.split())
    return s

def _remove_flag(s: str, flag: str) -> str:
    parts = s.split()
    out = [p for p in parts if p != flag]
    return " ".join(out)
force_software = (os.environ.get("GRAPH_FORCE_SOFTWARE_GL") or "").strip().lower() in ("1", "true", "yes")
chromium_flags = (os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS") or "").strip()

def _flagset(s: str) -> set[str]:
    return set((s or "").split())

def _add_flags(s: str, add: list[str]) -> str:
    parts = (s or "").split()
    have = set(parts)
    for f in add:
        if f not in have:
            parts.append(f)
    return " ".join(parts).strip()

def _remove_flags(s: str, remove: list[str]) -> str:
    parts = [p for p in (s or "").split() if p not in set(remove)]
    return " ".join(parts).strip()

if force_software:
    # Remove conflicting variants
    chromium_flags = _remove_flags(chromium_flags, ["--disable-gpu", "--use-gl=swiftshader", "--use-gl=desktop", "--use-gl=egl"])
    # Use ANGLE software rasterisers instead
    chromium_flags = _add_flags(chromium_flags, ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu-compositing"])

os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = chromium_flags
flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
if "--use-gl=swiftshader" in flags:
    print("[PRE][WARN] Prefer ANGLE SwiftShader: --use-gl=angle --use-angle=swiftshader")
    if "--use-gl=swiftshader" in flags:
        raise RuntimeError("Unsupported on this Windows WebEngine build. Use: --use-gl=angle --use-angle=swiftshader")

# Linux-only sandbox knob
if not is_windows:
    os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")

import requests

from PyQt6.QtCore import QUrl, QTimer, pyqtSignal, pyqtSlot, QObject
from PyQt6.QtGui import QIcon


from PyQt6.QtWidgets import (
    QApplication,
    QDialog,
    QMessageBox, QVBoxLayout, QFileDialog,
)

from PyQt6.QtWebEngineCore import QWebEnginePage
from PyQt6.QtWebEngineWidgets import QWebEngineView


def _now():
    return time.time()


def _jaccard(a, b):
    a = set(a or [])
    b = set(b or [])
    if not a and not b:
        return 0.0
    inter = len(a & b)
    uni = len(a | b)
    return inter / uni if uni else 0.0


def _safe_int(x, d=0):
    if x is None:
        return d
    if isinstance(x, int):
        return x
    if isinstance(x, str) and x.strip().lstrip("-").isdigit():
        return int(x.strip())
    return d


def _normalize_doi(s):
    s = (s or "").strip()
    s = s.replace("https://doi.org/", "").replace("http://doi.org/", "")
    s = s.replace("https://dx.doi.org/", "").replace("http://dx.doi.org/", "")
    return s.strip()


def _semantic_headers():
    api_key = (
        os.environ.get("SEMANTIC_API")
        or os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
        or ""
    ).strip()
    h = {"Accept": "application/json", "User-Agent": "graph_widget/1.0"}
    if api_key:
        h["x-api-key"] = api_key
    return h


def _get_json(url, params=None, timeout=20):
    r = requests.get(url, params=params or {}, headers=_semantic_headers(), timeout=timeout)
    if r.status_code != 200:
        return None, r.status_code, r.text[:500]
    return r.json(), 200, ""


def _post_json(url: str, payload: dict, *, timeout: float = 18.0, headers: dict | None = None):
    """
    POST helper for batch endpoints (Semantic Scholar graph batch).
    Mirrors _get_json return shape: (data, status_code, err_str).
    """
    import json
    import requests

    h = {}
    if headers:
        h.update(headers)
    h.setdefault("Content-Type", "application/json")

    try:
        r = requests.post(url, data=json.dumps(payload), headers=h, timeout=timeout)
        if r.status_code >= 400:
            return None, r.status_code, (r.text[:500] if r.text else f"HTTP {r.status_code}")
        return r.json(), r.status_code, ""
    except Exception as e:
        return None, 0, str(e)

def semantic_fetch_paper_min_batch(paper_ids: list[str]) -> dict[str, dict]:
    """
    Dummy-only batch fetch.
    Returns: {paperId: paper_min_dict}, using the local dummy store.
    """
    if not paper_ids:
        return {}

    store = dummy_semantic_record_store()
    out: dict[str, dict] = {}

    for pid in paper_ids:
        pid = (pid or "").strip()
        if not pid:
            continue
        rec = store.get(pid)
        if not isinstance(rec, dict) or not rec:
            continue

        # return only the "min" fields you expect downstream
        out[pid] = {
            "paperId": rec.get("paperId", pid),
            "title": rec.get("title", ""),
            "year": rec.get("year", 0),
            "authors": rec.get("authors", []),
            "url": rec.get("url", ""),
            "venue": rec.get("venue", ""),
            "citationCount": rec.get("citationCount", 0),
            "referenceCount": rec.get("referenceCount", 0),
            "externalIds": rec.get("externalIds", {}),
            "references": rec.get("references", []),
            "citations": rec.get("citations", []),
            "abstract": rec.get("abstract", ""),
        }

    return out


def semantic_search_title_to_paperid(title):
    title = (title or "").strip()
    if not title:
        return None
    url = "https://api.semanticscholar.org/graph/v1/paper/search"
    params = {"query": title, "limit": 1, "fields": "paperId,title,year"}
    data, status, err = _get_json(url, params=params, timeout=25)
    if not data or status != 200:
        return None
    items = data.get("data") or []
    if not items:
        return None
    return items[0].get("paperId")


def semantic_fetch_paper(pid_or_doi):
    pid_or_doi = (pid_or_doi or "").strip()
    if not pid_or_doi:
        return None

    pid = pid_or_doi
    if pid.lower().startswith("doi:"):
        pid = "DOI:" + _normalize_doi(pid.split(":", 1)[1])
    elif pid.startswith("10."):
        pid = "DOI:" + _normalize_doi(pid)

    url = f"https://api.semanticscholar.org/graph/v1/paper/{pid}"
    fields = (
        "title,year,authors,citationCount,referenceCount,url,externalIds,abstract,venue,"
        "references.paperId,references.title,references.year,references.authors,references.citationCount,"
        "citations.paperId,citations.title,citations.year,citations.authors,citations.citationCount"
    )
    data, status, err = _get_json(url, params={"fields": fields}, timeout=25)
    if not data or status != 200:
        return None
    return data


def semantic_fetch_paper_min(pid):
    pid = (pid or "").strip()
    if not pid:
        return None
    url = f"https://api.semanticscholar.org/graph/v1/paper/{pid}"
    fields = (
        "title,year,authors,citationCount,referenceCount,url,externalIds,abstract,venue,"
        "references.paperId,citations.paperId"
    )
    data, status, err = _get_json(url, params={"fields": fields}, timeout=25)
    if not data or status != 200:
        return None
    return data


def _paper_id_from_payload(p):
    return p.get("paperId") or ""


def _paper_label(p):
    t = (p.get("title") or "").strip()
    y = p.get("year")
    if t and y:
        return f"{t} ({y})"
    return t or _paper_id_from_payload(p) or "Unknown"


def _authors_str(p):
    a = p.get("authors") or []
    if not isinstance(a, list):
        return ""
    names = []
    for it in a:
        if isinstance(it, dict):
            nm = (it.get("name") or "").strip()
            if nm:
                names.append(nm)
    return ", ".join(names[:20])


@dataclass
class GraphBuildConfig:
    max_candidates: int = 60
    max_edges: int = 160
    neighbor_fetch_budget: int = 45
    min_sim: float = 0.08


def connectedpapers_like_build(seed_payload, cfg):
    """
    ###1. collect candidates from seed refs+cits
    ###2. fetch minimal neighbor sets for subset of candidates
    ###3. compute similarity: Jaccard(refs) + Jaccard(cits)
    ###4. build similarity edges among top nodes
    ###5. compute prior/derivative lists
    """
    seed_id = _paper_id_from_payload(seed_payload) or "SEED"
    seed_refs = [r.get("paperId") for r in (seed_payload.get("references") or []) if isinstance(r, dict) and r.get("paperId")]
    seed_cits = [c.get("paperId") for c in (seed_payload.get("citations") or []) if isinstance(c, dict) and c.get("paperId")]

    candidate_ids = []
    for x in seed_refs[: cfg.max_candidates]:
        candidate_ids.append(x)
    for x in seed_cits[: cfg.max_candidates]:
        if x not in candidate_ids:
            candidate_ids.append(x)

    candidates = {}
    candidates[seed_id] = seed_payload

    budget = min(cfg.neighbor_fetch_budget, len(candidate_ids))
    t0 = _now()
    batch_ids = list(dict.fromkeys(candidate_ids[:budget]))  # stable order, dedupe
    paper_min_cache = semantic_fetch_paper_min_batch(batch_ids)

    def refs_of(p):
        return [x.get("paperId") for x in (p.get("references") or []) if isinstance(x, dict) and x.get("paperId")]

    def cits_of(p):
        return [x.get("paperId") for x in (p.get("citations") or []) if isinstance(x, dict) and x.get("paperId")]

    for pid, p in list(candidates.items()):
        if pid == seed_id:
            continue
        if "references" not in p:
            continue

    scored = []
    for pid, p in candidates.items():
        if pid == seed_id:
            continue
        sim = 0.6 * _jaccard(seed_refs, refs_of(p)) + 0.4 * _jaccard(seed_cits, cits_of(p))
        scored.append((sim, pid))

    scored.sort(reverse=True, key=lambda x: x[0])
    keep_ids = [seed_id] + [pid for sim, pid in scored if sim >= cfg.min_sim][: cfg.max_candidates]
    keep = {pid: candidates[pid] for pid in keep_ids if pid in candidates}

    ids = list(keep.keys())

    pair_edges = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a = keep[ids[i]]
            b = keep[ids[j]]
            sim = 0.6 * _jaccard(refs_of(a), refs_of(b)) + 0.4 * _jaccard(cits_of(a), cits_of(b))
            if sim >= cfg.min_sim:
                pair_edges.append((sim, ids[i], ids[j]))

    pair_edges.sort(reverse=True, key=lambda x: x[0])
    pair_edges = pair_edges[: cfg.max_edges]

    years = [_safe_int(keep[pid].get("year"), 0) for pid in keep]
    years = [y for y in years if y > 0]
    y_min = min(years) if years else 2000
    y_max = max(years) if years else 2025
    if y_max == y_min:
        y_max = y_min + 1

    def year_to_color(y):
        y = _safe_int(y, 0)
        t = (y - y_min) / (y_max - y_min)
        t = 0.0 if t < 0 else 1.0 if t > 1 else t
        a = int(240 - 160 * t)
        b = int(240 - 80 * t)
        c = int(255 - 180 * t)
        return f"rgb({a},{b},{c})"

    nodes = []
    for pid, p in keep.items():
        nodes.append(
            {
                "data": {
                    "id": pid,
                    "label": (p.get("title") or pid),
                    "year": _safe_int(p.get("year"), 0),
                    "citations": _safe_int(p.get("citationCount"), 0),
                    "authors": _authors_str(p),
                    "venue": (p.get("venue") or ""),
                    "url": (p.get("url") or ""),
                    "abstract": (p.get("abstract") or ""),
                    "color": year_to_color(p.get("year")),
                    "isSeed": (pid == seed_id),
                }
            }
        )

    edges = []
    for sim, a, b in pair_edges:
        edges.append(
            {
                "data": {
                    "id": f"{a}--{b}",
                    "source": a,
                    "target": b,
                    "weight": float(sim),
                }
            }
        )

    ref_counts = {}
    cit_counts = {}
    for pid, p in keep.items():
        for r in refs_of(p):
            ref_counts[r] = ref_counts.get(r, 0) + 1
        for c in cits_of(p):
            cit_counts[c] = cit_counts.get(c, 0) + 1

    prior = sorted(ref_counts.items(), key=lambda x: (-x[1], x[0]))[:20]
    deriv = sorted(cit_counts.items(), key=lambda x: (-x[1], x[0]))[:20]

    return {
        "seedId": seed_id,
        "nodes": nodes,
        "edges": edges,
        "priorIds": [pid for pid, _ in prior],
        "derivativeIds": [pid for pid, _ in deriv],
        "build_ms": int((_now() - t0) * 1000),
    }
def dummy_semantic_record_store():
    """
    ###1. return an in-memory "Semantic Scholar-like" store keyed by paperId
    ###2. include venue/url/abstract/citationCount so HTML can populate list + details panels
    """
    def a(name, aid):
        return {"name": name, "authorId": aid}

    def ref(pid, title, year, authors):
        return {"paperId": pid, "title": title, "year": year, "authors": authors}

    store = {}

    store["SS:D0"] = {
        "paperId": "SS:D0",
        "title": "Cyber Attribution with Bayesian Models",
        "year": 2021,
        "venue": "DummyConf",
        "url": "https://www.semanticscholar.org/",
        "abstract": "Offline dummy seed abstract. Replace with Semantic Scholar payload at runtime.",
        "citationCount": 420,
        "authors": [a("A. Example", "A1"), a("B. Example", "B1")],
        "references": [
            ref("SS:R1", "A Survey of Cyber Attribution Methods", 2018, [a("D. Analyst", "D1"), a("E. Analyst", "E1")]),
            ref("SS:R2", "Measuring Similarity in Citation Networks", 2016, [a("H. Network", "H1")]),
            ref("SS:R3", "Attribution Under Uncertainty: Evidence Fusion", 2017, [a("G. Fusion", "G1")]),
            ref("SS:R4", "Tracing Infrastructure Reuse Across Campaigns", 2015, [a("K. Infra", "K1")]),
        ],
        "citations": [
            ref("SS:C1", "Operationalizing Attribution for Policy Decisions", 2022, [a("I. Policy", "I1")]),
            ref("SS:C2", "Benchmarking Attribution Pipelines", 2022, [a("N. Bench", "N1")]),
            ref("SS:C3", "Zero-Knowledge Proofs for Evidence Disclosure", 2023, [a("J. Crypto", "J1")]),
        ],
    }

    store["SS:R1"] = {
        "paperId": "SS:R1",
        "title": "A Survey of Cyber Attribution Methods",
        "year": 2018,
        "venue": "Survey Journal",
        "url": "",
        "abstract": "Dummy abstract: survey framing and taxonomy for attribution.",
        "citationCount": 980,
        "authors": [a("D. Analyst", "D1"), a("E. Analyst", "E1")],
        "references": [
            ref("SS:R5", "Human Factors in Analyst Judgments", 2014, [a("L. Human", "L1")]),
            ref("SS:R2", "Measuring Similarity in Citation Networks", 2016, [a("H. Network", "H1")]),
        ],
        "citations": [],
    }

    store["SS:R2"] = {
        "paperId": "SS:R2",
        "title": "Measuring Similarity in Citation Networks",
        "year": 2016,
        "venue": "NetSci",
        "url": "",
        "abstract": "Dummy abstract: similarity metrics for citation graphs.",
        "citationCount": 660,
        "authors": [a("H. Network", "H1")],
        "references": [
            ref("SS:R6", "Foundations of Bibliographic Coupling", 1963, [a("M. Kessler", "KESS")]),
            ref("SS:R7", "Co-citation and Scientific Specialty", 1973, [a("H. Small", "SMALL")]),
        ],
        "citations": [],
    }

    store["SS:R3"] = {
        "paperId": "SS:R3",
        "title": "Attribution Under Uncertainty: Evidence Fusion",
        "year": 2017,
        "venue": "IR+Cyber",
        "url": "",
        "abstract": "Dummy abstract: evidence fusion under uncertainty.",
        "citationCount": 150,
        "authors": [a("G. Fusion", "G1")],
        "references": [ref("SS:R5", "Human Factors in Analyst Judgments", 2014, [a("L. Human", "L1")])],
        "citations": [],
    }

    store["SS:R4"] = {
        "paperId": "SS:R4",
        "title": "Tracing Infrastructure Reuse Across Campaigns",
        "year": 2015,
        "venue": "Forensics",
        "url": "",
        "abstract": "Dummy abstract: infrastructure reuse and linkage.",
        "citationCount": 740,
        "authors": [a("K. Infra", "K1")],
        "references": [],
        "citations": [],
    }

    store["SS:R5"] = {
        "paperId": "SS:R5",
        "title": "Human Factors in Analyst Judgments",
        "year": 2014,
        "venue": "HCI-Sec",
        "url": "",
        "abstract": "Dummy abstract: analyst judgment and bias.",
        "citationCount": 520,
        "authors": [a("L. Human", "L1")],
        "references": [],
        "citations": [],
    }

    store["SS:R6"] = {
        "paperId": "SS:R6",
        "title": "Foundations of Bibliographic Coupling",
        "year": 1963,
        "venue": "Classic",
        "url": "",
        "abstract": "Dummy abstract: bibliographic coupling foundations.",
        "citationCount": 1200,
        "authors": [a("M. Kessler", "KESS")],
        "references": [],
        "citations": [],
    }

    store["SS:R7"] = {
        "paperId": "SS:R7",
        "title": "Co-citation and Scientific Specialty",
        "year": 1973,
        "venue": "Classic",
        "url": "",
        "abstract": "Dummy abstract: co-citation and specialty structure.",
        "citationCount": 1400,
        "authors": [a("H. Small", "SMALL")],
        "references": [],
        "citations": [],
    }

    store["SS:C1"] = {
        "paperId": "SS:C1",
        "title": "Operationalizing Attribution for Policy Decisions",
        "year": 2022,
        "venue": "PolicySec",
        "url": "",
        "abstract": "Dummy abstract: operational constraints and policy use.",
        "citationCount": 88,
        "authors": [a("I. Policy", "I1")],
        "references": [ref("SS:D0", "Cyber Attribution with Bayesian Models", 2021, [a("A. Example", "A1"), a("B. Example", "B1")])],
        "citations": [],
    }

    store["SS:C2"] = {
        "paperId": "SS:C2",
        "title": "Benchmarking Attribution Pipelines",
        "year": 2022,
        "venue": "EvalSec",
        "url": "",
        "abstract": "Dummy abstract: benchmarking attribution pipelines.",
        "citationCount": 64,
        "authors": [a("N. Bench", "N1")],
        "references": [ref("SS:D0", "Cyber Attribution with Bayesian Models", 2021, [a("A. Example", "A1"), a("B. Example", "B1")])],
        "citations": [],
    }

    store["SS:C3"] = {
        "paperId": "SS:C3",
        "title": "Zero-Knowledge Proofs for Evidence Disclosure",
        "year": 2023,
        "venue": "CryptoSys",
        "url": "",
        "abstract": "Dummy abstract: ZK proofs for selective evidence disclosure.",
        "citationCount": 55,
        "authors": [a("J. Crypto", "J1")],
        "references": [ref("SS:D0", "Cyber Attribution with Bayesian Models", 2021, [a("A. Example", "A1"), a("B. Example", "B1")])],
        "citations": [],
    }

    return store



def _dummy_fetch_semantic(pid, store):
    """
    ###1. fetch from dummy store
    """
    return store.get(pid) or {}
def dummy_individual_paper_payload(paper_data, depth=1):
    """
    ###1. expand refs/cits for a single seed paper
    ###2. keep schema: seedId/nodes/edges/priorIds/derivativeIds/build_ms
    ###3. include venue/url/abstract/citationCount so HTML can populate list + details
    """
    store = dummy_semantic_record_store()

    seed = (paper_data or {}).get("external_id") or "SS:D0"
    seed = seed if seed.startswith("SS:") else "SS:D0"

    nodes = {}
    edges = []
    prior_ids = set()
    deriv_ids = set()

    def add_node(pid, rec, is_seed=False):
        if pid in nodes:
            if is_seed:
                nodes[pid]["data"]["isSeed"] = True
            return

        title = (rec.get("title") or pid).strip()
        year = _safe_int(rec.get("year"), 0)
        venue = (rec.get("venue") or "").strip()
        url = (rec.get("url") or "").strip()
        abstract = (rec.get("abstract") or "").strip()
        cites = _safe_int(rec.get("citationCount"), 0)

        authors = rec.get("authors") or []
        author_str = ", ".join(
            [(a.get("name") or "").strip() for a in authors if isinstance(a, dict) and a.get("name")][:20]
        )

        nodes[pid] = {
            "data": {
                "id": pid,
                "label": title,
                "year": year,
                "citations": cites,
                "authors": author_str,
                "venue": venue,
                "url": url,
                "abstract": abstract,
                "isSeed": bool(is_seed),
            }
        }

    def add_edge(a, b, w):
        edges.append({"data": {"id": f"{a}--{b}", "source": a, "target": b, "weight": float(w)}})

    frontier = [(seed, 0)]
    seen = set()

    while frontier:
        pid, d = frontier.pop(0)
        if pid in seen:
            continue
        seen.add(pid)

        rec = _dummy_fetch_semantic(pid, store)
        if not rec:
            continue

        add_node(pid, rec, is_seed=(pid == seed))

        if d >= depth:
            continue

        refs = rec.get("references") or []
        cits = rec.get("citations") or []

        # heavier weight for direct relationships; scale slightly by (log) citations
        seed_c = _safe_int(store.get(seed, {}).get("citationCount"), 0)

        for r in refs:
            rid = (r or {}).get("paperId")
            if not rid:
                continue
            rrec = _dummy_fetch_semantic(rid, store) or r
            add_node(rid, rrec, is_seed=False)

            rc = _safe_int(rrec.get("citationCount"), 0)
            w = 0.55 + 0.10 * min(1.0, (rc + 1) / float(seed_c + 1))
            add_edge(pid, rid, w)

            prior_ids.add(rid)
            frontier.append((rid, d + 1))

        for c in cits:
            cid = (c or {}).get("paperId")
            if not cid:
                continue
            crec = _dummy_fetch_semantic(cid, store) or c
            add_node(cid, crec, is_seed=False)

            cc = _safe_int(crec.get("citationCount"), 0)
            w = 0.55 + 0.10 * min(1.0, (cc + 1) / float(seed_c + 1))
            add_edge(cid, pid, w)

            deriv_ids.add(cid)
            frontier.append((cid, d + 1))

    return {
        "seedId": seed,
        "nodes": list(nodes.values()),
        "edges": edges,
        "priorIds": sorted(prior_ids),
        "derivativeIds": sorted(deriv_ids),
        "build_ms": 3,
    }

class WebEnginePage(QWebEnginePage):
    console_message = pyqtSignal(int, str, int, str)

    def javaScriptConsoleMessage(self, level, message, line_number, source_id):
        # Qt6 passes an enum; normalise safely
        try:
            lvl = int(level)  # may fail on some enum types
        except TypeError:
            try:
                lvl = int(level.value)  # common enum pattern
            except Exception:
                lvl = 0

        msg = str(message)
        ln = int(line_number)
        src = str(source_id)

        self.console_message.emit(lvl, msg, ln, src)
        print(f"[JS:{lvl}] {src}:{ln} {msg}")

        # Call base implementation (keep original enum object for Qt)
        super().javaScriptConsoleMessage(level, message, line_number, source_id)
class _GraphBuildWorker(QObject):
    """
    Build a Cytoscape payload for graph_view.html.

    Key change:
      - Accept a full seed_node (Cytoscape node wrapper: {"data": {...}})
      - Do NOT rely on "SS:D0" dummy IDs
      - Build at least a single-node graph from the seed, so the UI always displays something.
    """
    finished = pyqtSignal(dict, dict)   # payload, seed_data
    failed   = pyqtSignal(str)

    def __init__(
        self,
        *,
        seed_node: dict | None = None,
        seed_title: str = "",
        budget: int = 0,
        seed_paper_id: str | None = None,
    ):
        super().__init__()
        self.seed_node = seed_node if isinstance(seed_node, dict) else None
        self.seed_title = (seed_title or "").strip()
        self.budget = int(budget or 0)
        self.seed_paper_id = (seed_paper_id or "").strip() or None

    def run(self):
        try:
            # ---------- 1) Resolve seed record ----------
            seed_data = {}
            if self.seed_node and isinstance(self.seed_node.get("data"), dict):
                seed_data = dict(self.seed_node["data"])
            else:
                # fallback: build a minimal seed from title/id
                t = self.seed_title.strip()
                if not t and not self.seed_paper_id:
                    raise RuntimeError("Missing seed.")
                seed_data = {
                    "id": self.seed_paper_id or t,
                    "label": t or self.seed_paper_id or "Seed",
                    "title": t or "",
                    "authors": [],          # keep compatibility if your UI expects list
                    "authors_str": "",
                    "year": None,
                    "venue": "",
                    "doi": "",
                    "url": "",
                    "abstract": "",
                    "citations": 0,
                    "isSeed": True,
                }

            seed_id = (seed_data.get("id") or seed_data.get("paperId") or seed_data.get("external_id") or "").strip()
            if not seed_id:
                seed_id = (seed_data.get("url") or seed_data.get("title") or "seed").strip()
                seed_data["id"] = seed_id

            # ---------- 2) Normalise fields to what graph_view.html typically uses ----------
            title = (seed_data.get("title") or seed_data.get("label") or seed_id).strip()
            year = seed_data.get("year")
            venue = (seed_data.get("venue") or "").strip()
            url = (seed_data.get("url") or "").strip()
            abstract = (seed_data.get("abstract") or "").strip()

            # graph_view.html (and your dummy builder) uses "authors" as a STRING
            authors_str = (seed_data.get("authors_str") or "").strip()
            if not authors_str:
                # accept list-of-dicts or list-of-strings
                a = seed_data.get("authors")
                if isinstance(a, str):
                    authors_str = a.strip()
                elif isinstance(a, list):
                    names = []
                    for it in a:
                        if isinstance(it, str) and it.strip():
                            names.append(it.strip())
                        elif isinstance(it, dict):
                            nm = (it.get("name") or "").strip()
                            if nm:
                                names.append(nm)
                    authors_str = ", ".join(names)

            citations = 0
            try:
                citations = int(seed_data.get("citations") or seed_data.get("citationCount") or 0)
            except Exception:
                citations = 0

            # ---------- 3) Build payload (always at least seed node) ----------
            nodes = {
                seed_id: {
                    "data": {
                        "id": seed_id,
                        "label": title,
                        "year": year or 0,
                        "citations": citations,
                        "authors": authors_str,     # STRING (important)
                        "authors_str": authors_str, # keep both
                        "venue": venue,
                        "url": url,
                        "abstract": abstract,
                        "isSeed": True,
                    }
                }
            }
            edges = []

            # Optional: if you already have references/citations in the seed_data, include them
            # (This does not fetch remotely; it just uses what is present.)
            def _add_node(pid: str, rec: dict, is_seed: bool = False):
                if not pid:
                    return
                if pid in nodes:
                    if is_seed:
                        nodes[pid]["data"]["isSeed"] = True
                    return
                ttl = (rec.get("title") or rec.get("label") or pid).strip()
                yr = rec.get("year") or 0
                ven = (rec.get("venue") or "").strip()
                u = (rec.get("url") or "").strip()
                ab = (rec.get("abstract") or "").strip()
                a_str = (rec.get("authors_str") or rec.get("authors") or "").strip()
                nodes[pid] = {
                    "data": {
                        "id": pid,
                        "label": ttl,
                        "year": int(yr or 0),
                        "citations": int(rec.get("citations") or rec.get("citationCount") or 0),
                        "authors": a_str,
                        "authors_str": a_str,
                        "venue": ven,
                        "url": u,
                        "abstract": ab,
                        "isSeed": bool(is_seed),
                    }
                }

            def _add_edge(a: str, b: str, w: float = 1.0):
                if not a or not b:
                    return
                edges.append({"data": {"id": f"{a}--{b}", "source": a, "target": b, "weight": float(w)}})

            for rel_key in ("references", "citations"):
                rel = seed_data.get(rel_key)
                if isinstance(rel, list):
                    for it in rel:
                        if not isinstance(it, dict):
                            continue
                        pid = (it.get("paperId") or it.get("id") or it.get("external_id") or it.get("url") or "").strip()
                        if not pid:
                            continue
                        _add_node(pid, it, is_seed=False)
                        _add_edge(seed_id, pid, 1.0 if rel_key == "references" else 0.9)

            gp = {
                "nodes": list(nodes.values()),
                "edges": edges,
            }

            # Seed_data is sent alongside payload; keep it consistent with graph_view consumers
            self.finished.emit(gp, {"paperId": seed_id, "title": title, "authors": authors_str, "year": year})
        except Exception as e:
            self.failed.emit(str(e))



def webengine_preflight():
    """
    Preflight checks for common Windows WebEngine crash causes.
    Prints environment + versions + paths to help diagnose 0xC0000409.
    """
    import os, sys, platform
    from pathlib import Path

    print("\n[PRE] Python:", sys.version.replace("\n", " "))
    print("[PRE] Platform:", platform.platform())
    print("[PRE] Executable:", sys.executable)
    print("[PRE] CWD:", os.getcwd())
    print("[PRE] QTWEBENGINE_CHROMIUM_FLAGS:", os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", ""))

    try:
        import PyQt6
        from PyQt6.QtCore import qVersion, QLibraryInfo
        print("[PRE] PyQt6:", getattr(PyQt6, "__version__", "unknown"))
        print("[PRE] Qt:", qVersion())
        print("[PRE] Qt Prefix:", QLibraryInfo.path(QLibraryInfo.LibraryPath.PrefixPath))
        print("[PRE] Qt Plugins:", QLibraryInfo.path(QLibraryInfo.LibraryPath.PluginsPath))
    except Exception as e:
        print("[PRE][WARN] Qt introspection failed:", e)

    # Sanity check: HTML + vendor folder resolved where you think it is
    here = Path(__file__).resolve().parent
    html = here / "graph_view.html"
    vendor = here / "vendor"
    print("[PRE] __file__ dir:", here)
    print("[PRE] graph_view.html exists:", html.exists(), str(html))
    print("[PRE] vendor exists:", vendor.exists(), str(vendor))
    if vendor.exists():
        expected = [
            "cytoscape.min.js",
            "cola.min.js",
            "cytoscape-cola.min.js",
            "layout-base.js",
            "cose-base.js",
            "cytoscape-fcose.js",
        ]
        for fn in expected:
            p = vendor / fn
            print(f"[PRE] vendor/{fn}:", p.exists(), (p.stat().st_size if p.exists() else 0))

    print("[PRE] Done.\n")
class ConnectedPapersLikeGraph(QDialog):
    """
    HTML-only graph widget (embedded-first):
      - Loads graph_view.html (local file)
      - Sends updateGraph/setMode/selectNode messages to the page via window.postMessage
      - Provides a QWebChannel bridge object "qtBridge" for PNG export (savePngDataUrl)
      - No Qt left/right panels, no splitter, no wrapper UI
    """

    def __init__(self, seed_input, parent=None):
        super().__init__(parent)

        from PyQt6.QtCore import Qt

        self.setWindowTitle("Connected Papers–style Graph")
        if hasattr(Qt.WindowType, "Widget"):
            self.setWindowFlags(Qt.WindowType.Widget)
        self.resize(1000, 700)

        self.seed_input = (seed_input or "").strip()
        self.graph_payload = None
        self._pending_download = None
        self._build_thread = None
        self._seed_node = None
        self._all_records = []
        self._provider_id = ""
        self._provider_name = ""
        self._headers = {}
        self._semantic_api_key = ""

        self._budget = 80
        self._mode = "all"
        self._graph_scope = "local"

        self._page_loaded = False
        self._pending_build = False

        class _QtBridge(QObject):
            def __init__(self, owner):
                super().__init__(owner)
                self._owner = owner

            @pyqtSlot(str)
            def savePngDataUrl(self, data_url: str):
                s = str(data_url or "")
                if not s.startswith("data:image/png;base64,"):
                    return

                b64 = s.split(",", 1)[1]
                raw = base64.b64decode(b64)

                suggested = "graph.png"
                fname, _ = QFileDialog.getSaveFileName(
                    self._owner, "Save Graph Image", suggested, "PNG Files (*.png)"
                )
                if not fname:
                    return
                if not fname.lower().endswith(".png"):
                    fname += ".png"

                Path(fname).write_bytes(raw)

        self.web = QWebEngineView()

        page = WebEnginePage(self.web)
        if hasattr(page, "renderProcessTerminated") and hasattr(self, "_on_render_terminated"):
            page.renderProcessTerminated.connect(self._on_render_terminated)
        if hasattr(page, "console_message") and hasattr(self, "_on_js_console"):
            page.console_message.connect(self._on_js_console)

        self.web.setPage(page)

        prof = self.web.page().profile()
        if hasattr(prof, "downloadRequested"):
            prof.downloadRequested.connect(self._on_download_requested)

        self._channel = QWebChannel(self.web.page())
        self._bridge = _QtBridge(self)
        self._channel.registerObject("qtBridge", self._bridge)
        self.web.page().setWebChannel(self._channel)

        s = self.web.settings()
        s.setAttribute(s.WebAttribute.JavascriptEnabled, True)
        s.setAttribute(s.WebAttribute.LocalContentCanAccessFileUrls, True)
        s.setAttribute(s.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        if hasattr(s.WebAttribute, "AllowRunningInsecureContent"):
            s.setAttribute(s.WebAttribute.AllowRunningInsecureContent, True)

        disable_gpu = (os.environ.get("GRAPH_DISABLE_GPU") or "").strip().lower() in ("1", "true", "yes")
        if hasattr(s.WebAttribute, "WebGLEnabled"):
            s.setAttribute(s.WebAttribute.WebGLEnabled, not disable_gpu)
        if hasattr(s.WebAttribute, "Accelerated2dCanvasEnabled"):
            s.setAttribute(s.WebAttribute.Accelerated2dCanvasEnabled, not disable_gpu)

        root = QVBoxLayout()
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self.web, 1)
        self.setLayout(root)

        self._html_path = Path(__file__).resolve().parent / "graph_view.html"
        if not self._html_path.exists():
            QMessageBox.critical(self, "Missing file", f"Missing:\n{self._html_path}")
            return

        self.web.loadFinished.connect(self._on_loaded_html)
        self.web.setUrl(QUrl.fromLocalFile(str(self._html_path)))

    def request_build(self) -> None:
        from PyQt6.QtCore import QTimer

        if self._page_loaded:
            QTimer.singleShot(0, self.build)
            return

        self._pending_build = True

    def set_records(self, rows: list) -> None:
        self._all_records = rows if isinstance(rows, list) else []

    def set_provider_context(self, *, provider_id: str, provider_name: str = "", headers: dict | None = None,
                             semantic_api_key: str = "") -> None:
        self._provider_id = (provider_id or "").strip()
        self._provider_name = (provider_name or "").strip()
        self._headers = headers or {}
        self._semantic_api_key = (semantic_api_key or "").strip()

    def set_seed_node(self, seed_node: dict) -> None:
        """
        Accept a Cytoscape-style node wrapper: {"data": {...}}.
        Build only when HTML is ready.
        """
        if not isinstance(seed_node, dict) or not isinstance(seed_node.get("data"), dict):
            return

        self._seed_node = seed_node

        d = seed_node["data"]
        seed_txt = (d.get("id") or d.get("paperId") or d.get("external_id") or d.get("title") or "").strip()
        if seed_txt:
            self.seed_input = seed_txt

        self.request_build()

    # ----------------------------
    # Render termination
    # ----------------------------
    def _on_render_terminated(self, termination_status, exit_code):
        # This prevents silent death. You can also auto-reload once if desired.
        print(f"[WEBENGINE] renderProcessTerminated status={termination_status} exit_code={exit_code}", flush=True)

    # ----------------------------
    # Downloads
    # ----------------------------
    def _on_download_requested(self, download):
        # If JS triggers a browser download (fallback path), handle it safely.
        from PyQt6.QtCore import QTimer
        from PyQt6.QtWidgets import QFileDialog
        from pathlib import Path

        self._pending_download = download
        suggested = download.suggestedFileName() or "graph.png"

        def ask_save():
            fname, _ = QFileDialog.getSaveFileName(self, "Save Graph Image", suggested, "PNG Files (*.png)")
            if not fname:
                try:
                    download.cancel()
                except Exception:
                    pass
                self._pending_download = None
                return

            if not fname.lower().endswith(".png"):
                fname += ".png"
            p = Path(fname)

            methods = set(dir(download))
            try:
                if "setDownloadDirectory" in methods and "setDownloadFileName" in methods:
                    download.setDownloadDirectory(str(p.parent))
                    download.setDownloadFileName(p.name)
                elif "setPath" in methods:
                    download.setPath(str(p))
                download.accept()
            except Exception:
                try:
                    download.cancel()
                except Exception:
                    pass

            self._pending_download = None

        QTimer.singleShot(0, ask_save)

    # ----------------------------
    # HTML loaded
    # ----------------------------
    def _on_loaded_html(self, ok: bool):
        from PyQt6.QtCore import QTimer

        if not ok:
            print(f"[GRAPH] Failed to load HTML: {self._html_path}", flush=True)
            return

        self._page_loaded = True
        if getattr(self, "_pending_build", False):
            self._pending_build = False
            QTimer.singleShot(0, self.build)

    # ----------------------------
    # JS messaging helpers
    # ----------------------------
    def _post_message(self, msg: dict):
        import json
        from PyQt6.QtCore import QTimer

        try:
            payload = json.dumps(msg, ensure_ascii=False)
        except Exception:
            payload = "{}"

        script = f"window.postMessage({payload}, '*');"
        QTimer.singleShot(0, lambda: self.web.page().runJavaScript(script))

    def send_graph(self, graph_payload: dict):
        self.graph_payload = graph_payload
        self._post_message({"type": "updateGraph", "payload": graph_payload or {}})

        # Ensure mode is applied after a graph update
        self.set_mode(self._mode)

    def set_mode(self, mode: str):
        m = (mode or "").strip().lower()
        if m not in ("all", "prior", "derivative"):
            m = "all"
        self._mode = m
        self._post_message({"type": "setMode", "payload": {"mode": m}})

    def select_node(self, node_id: str):
        nid = (node_id or "").strip()
        if not nid:
            return
        self._post_message({"type": "selectNode", "payload": {"id": nid}})

    # ----------------------------
    # Build trigger (wire this to your real graph builder)
    # ----------------------------
    def build(self):
        """
        Build a graph payload from:
          - self._seed_node (selected paper)
          - self._all_records (FULL current results list)

        Provider-aware enrichment:
          - semantic_scholar: Graph API batch fetch + references/citations
          - openalex: use referenced_works + optional cited_by via filter
          - crossref: use 'reference' list when present

        Fallback:
          - local similarity edges (author overlap + title token overlap)
        """
        import re
        import time
        import requests

        t0 = time.time()

        seed_node = getattr(self, "_seed_node", None)
        rows = getattr(self, "_all_records", None)

        if not isinstance(seed_node, dict) or not isinstance(seed_node.get("data"), dict):
            print("[GRAPH] Missing seed_node; cannot build.", flush=True)
            return

        if not isinstance(rows, list) or not rows:
            print("[GRAPH] Missing record list; cannot build.", flush=True)
            return

        provider_id = (getattr(self, "_provider_id", "") or "").strip()
        headers = getattr(self, "_headers", {}) or {}
        semantic_key = (getattr(self, "_semantic_api_key", "") or "").strip()
        budget = int(getattr(self, "_budget", 80) or 80)

        scope = (getattr(self, "_graph_scope", "local") or "local").strip().lower()
        scope = scope if scope in ("local", "global") else "local"
        expand_neighbors = (scope == "global")

        if budget < 10:
            budget = 10

        def _norm(s: str) -> str:
            return re.sub(r"\s+", " ", (s or "").strip())

        def _tokenise_title(s: str) -> set:
            s = _norm(s).lower()
            s = re.sub(r"[^a-z0-9 ]+", " ", s)
            toks = [t for t in s.split(" ") if len(t) >= 4]
            return set(toks[:40])

        def _authors_set(auths: str) -> set:
            s = _norm(auths).lower()
            parts = [p.strip() for p in s.split(",") if p.strip()]
            out = set()
            for p in parts[:20]:
                p = re.sub(r"[^a-z ]+", "", p).strip()
                if p:
                    out.add(p)
            return out

        def _row_node_id(r: dict) -> str:
            ext = (r.get("external_id") or "").strip()
            doi = (r.get("doi") or "").strip()
            url = (r.get("url") or "").strip()
            if ext:
                return ext
            if doi:
                return "DOI:" + doi
            if url:
                return url
            return (r.get("title") or "paper").strip()

        def _row_to_node(r: dict) -> dict:
            nid = _row_node_id(r)
            title = _norm(r.get("title") or "") or nid
            authors_str = _norm(r.get("authors") or "")
            venue = _norm(r.get("venue") or "")
            abstract = _norm(r.get("abstract") or "")
            year = r.get("year")
            try:
                year = int(year) if year is not None and str(year).strip() != "" else None
            except Exception:
                year = None

            data = {
                "id": str(nid),
                "label": title,
                "title": title,

                "authors": authors_str,
                "authors_list": [{"name": a.strip()} for a in authors_str.split(",") if a.strip()],
                "authors_str": authors_str,

                "venue": venue,
                "url": _norm(r.get("url") or ""),
                "abstract": abstract,
                "year": year,
                "citations": int(r.get("citations") or 0),
                "doi": _norm(r.get("doi") or ""),
                "external_id": _norm(r.get("external_id") or ""),
                "isSeed": False,
            }

            return {"data": data}

        seed_id = str(seed_node["data"].get("id") or seed_node["data"].get("title") or "SEED")
        seed_year = seed_node["data"].get("year")
        try:
            seed_year = int(seed_year) if seed_year is not None and str(seed_year).strip() != "" else None
        except Exception:
            seed_year = None

        nodes_map = {}
        for r in rows:
            if not isinstance(r, dict):
                continue
            n = _row_to_node(r)
            nodes_map[n["data"]["id"]] = n

        seed_node2 = {"data": dict(seed_node["data"])}
        seed_node2["data"]["isSeed"] = True
        nodes_map[str(seed_id)] = seed_node2

        def _sort_key(item):
            nid, node = item
            y = node["data"].get("year")
            try:
                y = int(y) if y is not None else None
            except Exception:
                y = None
            dy = abs((y or seed_year or 0) - (seed_year or 0)) if seed_year else 9999
            return (0 if nid == seed_id else 1, dy, node["data"].get("title") or "")

        items = sorted(nodes_map.items(), key=_sort_key)
        if len(items) > budget:
            items = items[:budget]
        nodes_map = dict(items)
        node_ids = set(nodes_map.keys())

        edges = []
        seen_edges = set()

        def _add_edge(a: str, b: str, w: float, eid_prefix: str = "e"):
            if a == b:
                return
            if a not in node_ids or b not in node_ids:
                return
            key = (a, b) if a < b else (b, a)
            if key in seen_edges:
                return
            seen_edges.add(key)
            edges.append({"data": {"id": f"{eid_prefix}:{key[0]}->{key[1]}", "source": key[0], "target": key[1],
                                   "weight": float(w)}})

        # --- Semantic Scholar enrichment ---
        # --- Semantic Scholar enrichment (local vs global) ---
        if provider_id in ("semantic_scholar", "semantic_scholar_bulk"):
            batch_url = "https://api.semanticscholar.org/graph/v1/paper/batch"
            hdrs = {"Accept": "application/json"}
            if semantic_key:
                hdrs["x-api-key"] = semantic_key

            paper_ids = list(node_ids)[:budget]
            params = {"fields": "paperId,references.paperId,citations.paperId"}

            try:
                r = requests.post(batch_url, params=params, headers=hdrs, json={"ids": paper_ids}, timeout=25)
                if r.status_code not in (200, 201):
                    print(f"[GRAPH] Semantic batch failed http={r.status_code}", flush=True)
                else:
                    arr = r.json() if r.text else []
                    if not isinstance(arr, list):
                        arr = []

                    if expand_neighbors:
                        extra = []
                        for rec in arr:
                            pid = (rec.get("paperId") or "").strip()
                            if not pid:
                                continue

                            for ref in rec.get("references") or []:
                                rid = (ref.get("paperId") or "").strip()
                                if rid and rid not in node_ids:
                                    extra.append(rid)

                            for cit in rec.get("citations") or []:
                                cid = (cit.get("paperId") or "").strip()
                                if cid and cid not in node_ids:
                                    extra.append(cid)

                        seen = set()
                        extra2 = []
                        for x in extra:
                            if x in seen:
                                continue
                            seen.add(x)
                            extra2.append(x)

                        room = max(0, budget - len(node_ids))
                        extra2 = extra2[:room]

                        if extra2:
                            params2 = {
                                "fields": "paperId,title,year,venue,url,abstract,authors,externalIds,citationCount"}
                            r2 = requests.post(batch_url, params=params2, headers=hdrs, json={"ids": extra2},
                                               timeout=25)
                            if r2.status_code in (200, 201):
                                arr2 = r2.json() if r2.text else []
                                if isinstance(arr2, list):
                                    for rec2 in arr2:
                                        pid2 = (rec2.get("paperId") or "").strip()
                                        if not pid2 or pid2 in nodes_map:
                                            continue

                                        title2 = _norm(rec2.get("title") or "") or pid2
                                        year2 = rec2.get("year")
                                        try:
                                            year2 = int(year2) if year2 is not None and str(
                                                year2).strip() != "" else None
                                        except Exception:
                                            year2 = None

                                        auths2 = rec2.get("authors") or []
                                        if not isinstance(auths2, list):
                                            auths2 = []
                                        authors_str2 = ", ".join(
                                            [(_norm(a.get("name") or "") if isinstance(a, dict) else "") for a in
                                             auths2]
                                        ).strip()
                                        authors_str2 = _norm(authors_str2)

                                        ext2 = rec2.get("externalIds") or {}
                                        doi2 = _norm((ext2.get("DOI") or "")) if isinstance(ext2, dict) else ""

                                        nodes_map[pid2] = {
                                            "data": {
                                                "id": pid2,
                                                "label": title2,
                                                "title": title2,
                                                "authors": [{"name": a.strip()} for a in authors_str2.split(",") if
                                                            a.strip()],
                                                "authors_str": authors_str2,
                                                "venue": _norm(rec2.get("venue") or ""),
                                                "url": _norm(rec2.get("url") or ""),
                                                "abstract": _norm(rec2.get("abstract") or ""),
                                                "year": year2,
                                                "citations": int(rec2.get("citationCount") or 0),
                                                "doi": doi2,
                                                "external_id": pid2,
                                                "isSeed": False,
                                            }
                                        }

                            node_ids = set(nodes_map.keys())

                    for rec in arr:
                        pid = (rec.get("paperId") or "").strip()
                        if not pid:
                            continue

                        for ref in rec.get("references") or []:
                            rid = (ref.get("paperId") or "").strip()
                            if rid in node_ids:
                                _add_edge(pid, rid, 0.8, "ss_ref")

                        for cit in rec.get("citations") or []:
                            cid = (cit.get("paperId") or "").strip()
                            if cid in node_ids:
                                _add_edge(cid, pid, 0.8, "ss_cit")

            except Exception as e:
                print(f"[GRAPH] Semantic Scholar exception: {e}", flush=True)

        # --- OpenAlex enrichment (outgoing refs + incoming via filter) ---
        if provider_id == "openalex":
            import requests
            extra_ids = []
            for nid in list(node_ids):
                base = str(nid or "").strip()
                if not base: continue
                try:
                    # outgoing references
                    r = requests.get(f"https://api.openalex.org/works/{base}", timeout=20)
                    if r.status_code == 200:
                        obj = r.json()
                        for ref in obj.get("referenced_works") or []:
                            rid = (str(ref) or "").strip()
                            if rid in node_ids:
                                _add_edge(nid, rid, 0.6, "oax_ref")
                            elif expand_neighbors:
                                extra_ids.append(rid)
                    # incoming citations
                    if expand_neighbors:
                        # filter=cites:... returns works citing 'base'
                        rr2 = requests.get(
                            f"https://api.openalex.org/works?filter=cites:{base}",
                            timeout=20)
                        if rr2.status_code == 200:
                            res2 = rr2.json()
                            for w in res2.get("results") or []:
                                cid = (w.get("id") or "").strip()
                                if cid in node_ids:
                                    _add_edge(cid, nid, 0.6, "oax_cit")
                                elif expand_neighbors:
                                    extra_ids.append(cid)
                except Exception:
                    pass

            # When global, fetch metadata for extra OpenAlex IDs
            if expand_neighbors and extra_ids:
                unique_ids = list(set(extra_ids))
                for oid in unique_ids:
                    try:
                        rr = requests.get(f"https://api.openalex.org/works/{oid}", timeout=20)
                        if rr.status_code == 200:
                            obj = rr.json()
                            pid2 = obj.get("id", "").strip()
                            if not pid2 or pid2 in nodes_map: continue
                            title = _norm(obj.get("title") or "") or pid2
                            authors_str2 = ", ".join(
                                [(a.get("author_position", "") or "") + " "
                                 + (a.get("display_name") or "")
                                 for a in obj.get("authorships") or []]
                            ).strip()
                            year2 = obj.get("publication_year")
                            nodes_map[pid2] = {
                                "data": {
                                    "id": pid2,
                                    "label": title,
                                    "title": title,
                                    "authors_str": authors_str2,
                                    "venue": _norm(obj.get("primary_location", {}).get("source", {}).get("name") or ""),
                                    "year": year2,
                                    "citations": int(obj.get("cited_by_count") or 0),
                                    "doi": _norm((obj.get("ids") or {}).get("doi") or ""),
                                    "external_id": pid2,
                                    "isSeed": False,
                                }
                            }
                    except Exception:
                        pass

        # --- Crossref enrichment (best effort via REST references) ---
        if provider_id == "crossref":
            import requests

            def _doi_from_nid(nid):
                s = str(nid or "")
                if s.startswith("DOI:"): return s[4:].strip()
                if "/" in s and " " not in s: return s
                return ""

            # Identify extra DOIs outside current search results when global
            extra_dois = []
            for nid in list(node_ids):
                doi = _doi_from_nid(nid)
                if not doi: continue
                try:
                    meta_url = f"https://api.crossref.org/works/{doi}"
                    r = requests.get(meta_url, timeout=20)
                    if r.status_code == 200:
                        obj = r.json().get("message", {})
                        for ref in obj.get("reference") or []:
                            rdoi = (ref.get("DOI") or ref.get("doi") or "").strip().lower()
                            if not rdoi: continue
                            rid = f"DOI:{rdoi}"
                            if rid in node_ids:
                                _add_edge(nid, rid, 0.5, "cr_ref")
                            elif expand_neighbors:
                                # collect extra nodes if in global mode
                                extra_dois.append(rdoi)
                except Exception:
                    pass

            # When global, fetch metadata for the extra DOIs and add them as nodes
            if expand_neighbors and extra_dois:
                unique_dois = list(set(extra_dois))
                for doi in unique_dois:
                    try:
                        url = f"https://api.crossref.org/works/{doi}"
                        rr = requests.get(url, timeout=20)
                        if rr.status_code == 200:
                            msg = rr.json().get("message", {})
                            pid2 = f"DOI:{doi}"
                            if pid2 in nodes_map: continue
                            title = _norm(msg.get("title") or "") or pid2
                            # populate other fields (authors, year, venue, etc.)
                            authors_str2 = ", ".join(
                                [(_norm(a.get("given") + " " + a.get("family"))).strip()
                                 for a in msg.get("author") or [] if isinstance(a, dict)]
                            ).strip()
                            year2 = msg.get("issued", {}).get("date-parts", [[None]])[0][0]
                            year2 = int(year2) if year2 else None
                            nodes_map[pid2] = {
                                "data": {
                                    "id": pid2,
                                    "label": title,
                                    "title": title,
                                    "authors_str": authors_str2,
                                    "venue": _norm(msg.get("container-title") or ""),
                                    "year": year2,
                                    "citations": int(msg.get("is-referenced-by-count") or 0),
                                    "doi": doi,
                                    "external_id": pid2,
                                    "isSeed": False,
                                }
                            }
                    except Exception:
                        pass

        # --- Fallback similarity ---
        ids_list = list(node_ids)
        seed_toks = _tokenise_title(nodes_map[seed_id]["data"].get("title"))
        seed_auths = _authors_set(nodes_map[seed_id]["data"].get("authors_str"))
        for nid in ids_list:
            if nid == seed_id:
                continue
            n = nodes_map.get(nid)
            if not n:
                continue
            t2 = _tokenise_title(n["data"].get("title") or "")
            a2 = _authors_set(n["data"].get("authors_str") or "")
            j_title = (len(seed_toks & t2) / max(1, len(seed_toks | t2))) if (seed_toks or t2) else 0.0
            j_auth = (len(seed_auths & a2) / max(1, len(seed_auths | a2))) if (seed_auths or a2) else 0.0
            w = 0.0
            if j_auth >= 0.20:
                w = max(w, 0.65)
            if j_title >= 0.12:
                w = max(w, 0.45)
            if w > 0:
                _add_edge(seed_id, nid, w, "sim")

        connected_ids = set()
        for e in edges:
            d = e.get("data") or {}
            s = (d.get("source") or "").strip()
            t = (d.get("target") or "").strip()
            if s:
                connected_ids.add(s)
            if t:
                connected_ids.add(t)

        connected_ids.add(seed_id)

        nodes_map = {nid: n for nid, n in nodes_map.items() if nid in connected_ids}
        node_ids = set(nodes_map.keys())

        edges = [
            e for e in edges
            if ((e.get("data") or {}).get("source") in node_ids and (e.get("data") or {}).get("target") in node_ids)
        ]

        prior_ids = []
        deriv_ids = []
        if seed_year:
            for nid, n in nodes_map.items():
                if nid == seed_id:
                    continue
                y = n["data"].get("year")
                try:
                    y = int(y) if y is not None else None
                except Exception:
                    y = None
                if y is None:
                    continue
                if y < seed_year:
                    prior_ids.append(nid)
                elif y > seed_year:
                    deriv_ids.append(nid)

        gp = {
            "seedId": seed_id,
            "priorIds": prior_ids,
            "derivativeIds": deriv_ids,
            "scope": scope,
            "build_ms": int((time.time() - t0) * 1000),
            "nodes": list(nodes_map.values()),
            "edges": edges,
        }

        print(
            f"[GRAPH] provider_id={provider_id} nodes={len(gp['nodes'])} edges={len(gp['edges'])} build_ms={gp['build_ms']}",
            flush=True,
        )
        self.send_graph(gp)

    # ----------------------------
    # JS console hook (safe logging only)
    # ----------------------------
    def _on_js_console(self, level, message, line, source):
        msg = str(message or "")
        if not msg:
            return

        if "Uncaught" in msg or "ReferenceError" in msg:
            print(f"[JS] {msg} (line={line} src={source})", flush=True)
            return

        if msg.startswith("SCOPE_SET:"):
            scope = msg.split("SCOPE_SET:", 1)[1].strip().lower()
            scope = scope if scope in ("local", "global") else "local"
            self._graph_scope = scope
            print(f"[GRAPH] scope set: {scope}", flush=True)
            try:
                from PyQt6.QtCore import QTimer
                QTimer.singleShot(0, self.build)
            except Exception:
                pass
            return

        if msg.startswith("NODE_CLICK:"):
            pid = msg.split("NODE_CLICK:", 1)[1].strip()
            if pid:
                print(f"[GRAPH] node clicked: {pid}", flush=True)
            return


def webengine_self_test():
    """
    ###1. create a minimal QWebEngineView
    ###2. load trivial HTML (no external JS)
    ###3. close after loadFinished
    """
    w = QWebEngineView()
    ok_box = {"ok": False, "_w": w}

    def done(ok):
        ok_box["ok"] = bool(ok)
        QTimer.singleShot(50, w.close)

    w.loadFinished.connect(done)
    w.setHtml("<html><body><h3>WebEngine OK</h3></body></html>", baseUrl=QUrl("file:///"))
    w.show()
    return ok_box
def webengine_smoke_test_or_die(app):
    """
    Create a tiny QWebEngineView and load a blank page.
    If this crashes, it is a QtWebEngine runtime issue (GPU/DLL/conflict).
    """
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    from PyQt6.QtCore import QUrl, QTimer

    w = QWebEngineView()
    w.resize(420, 240)
    w.setWindowTitle("WebEngine smoke test")
    w.loadFinished.connect(lambda ok: print("[SMOKE] loadFinished:", ok))
    w.setUrl(QUrl("about:blank"))
    w.show()

    # Close quickly after init
    QTimer.singleShot(800, w.close)
    QTimer.singleShot(900, lambda: print("[SMOKE] finished\n"))

def main(paper_data=None):
    """
    ###1. launch with an offline-safe default seed
    ###2. allow caller to pass paper_data, but do not require network
    """
    webengine_preflight()

    app = QApplication(sys.argv)
    # Set application icon
    icon_path = str(Path(__file__).resolve().parent / "app_icon.png")
    app.setWindowIcon(QIcon(icon_path))

    app.setApplicationName("Connected Papers Graph")
    html_path = Path(__file__).resolve().parent / "graph_view.html"
    if not html_path.exists():
        QMessageBox.critical(None, "Configuration Error", f"Missing UI file:\n{html_path}")
        return

    if isinstance(paper_data, dict):
        ext = (paper_data.get("external_id") or "").strip()
        doi = (paper_data.get("doi") or "").strip()
        title = (paper_data.get("title") or "").strip()

        if ext:
            seed = ext
        elif doi:
            seed = "DOI:" + _normalize_doi(doi)
        else:
            seed = "title:" + (title if title else "cyber attribution bayesian")
    else:
        seed = (os.environ.get("SEED") or "").strip() or "dummy"

    win = ConnectedPapersLikeGraph(seed)
    win.show()
    sys.exit(app.exec())


#
# if __name__ == "__main__":
#     if "QTWEBENGINE_CHROMIUM_FLAGS" in os.environ:
#         os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = os.environ["QTWEBENGINE_CHROMIUM_FLAGS"].replace(
#             "--enable-logging --v=1", ""
#         )
#     main()

