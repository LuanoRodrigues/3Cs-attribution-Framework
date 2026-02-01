import hashlib
import re
from typing import List, Any, Dict, Union, Optional, Tuple

from Search_engine.Citations_graph.Graph_widget import ConnectedPapersLikeGraph
from bibliometric_analysis_tool.utils.Zotero_loader_to_df import load_data_from_source_for_widget
from bibliometric_analysis_tool.utils.zotero_class import merge_sections_min_words
from extract_pdf_ui import process_pdf
from src.core.utils.calling_models import ocr_single_pdf_structured, submit_mistral_ocr3_batch, mistral_batch_references

collection_name=("0.13_cyber_attribution_corpus_records_total_included")
def references_to_graph(
    structured_references: Dict[str, Any],
    source_doc_id: str,
    source_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    ###1. normalize references payload into a list (tolerate wrappers / nesting)
    ###2. index full footnotes so short refs can be resolved ((n X) or footnote markers)
    ###3. build stable work nodes (dedupe)
    ###4. return widget-ready Cytoscape payload (nodes/edges are {"data": ...})
    """
    def _extract_refs(obj: Any, depth: int = 0) -> List[Dict[str, Any]]:
        if depth > 6:
            return []
        if isinstance(obj, list):
            return [x for x in obj if isinstance(x, dict)]
        if not isinstance(obj, dict):
            return []
        for k in ("references", "refs", "citations"):
            if k in obj:
                r = _extract_refs(obj.get(k), depth + 1)
                if r:
                    return r
        if len(obj) == 1:
            v = next(iter(obj.values()))
            r = _extract_refs(v, depth + 1)
            if r:
                return r
        for v in obj.values():
            r = _extract_refs(v, depth + 1)
            if r:
                return r
        return []

    refs = _extract_refs(structured_references)

    def _slug(s: str) -> str:
        s = (s or "").strip().lower()
        s = re.sub(r"\s+", " ", s)
        s = re.sub(r"[^a-z0-9]+", "-", s)
        return s.strip("-")

    def _hash(s: str) -> str:
        return hashlib.sha1((s or "").encode("utf-8")).hexdigest()[:12]

    def _to_int_or_none(x: Any) -> Optional[int]:
        if x is None:
            return None
        s = str(x).strip()
        if s.isdigit():
            return int(s)
        return None

    def _year_int(y: Any) -> int:
        s = "" if y is None else str(y).strip()
        digits = "".join([c for c in s if c.isdigit()])
        return int(digits) if digits else 0

    def _is_empty_str(x: Any) -> bool:
        return (not isinstance(x, str)) or (not x.strip())

    def _looks_like_short_ref(s: str) -> bool:
        return bool(re.search(r"\(n\s*\d+\)", s or ""))

    def _extract_n(s: str) -> Optional[int]:
        m = re.search(r"\(n\s*(\d+)\)", s or "")
        return int(m.group(1)) if m else None

    def _get_context(r: Dict[str, Any]) -> str:
        if isinstance(r.get("context_preceding"), str) and r.get("context_preceding").strip():
            return r.get("context_preceding").strip()
        if isinstance(r.get("context"), str) and r.get("context").strip():
            return r.get("context").strip()
        return ""

    def _get_anchor(r: Dict[str, Any]) -> str:
        a = r.get("citation_anchor")
        if isinstance(a, str) and a.strip():
            return a.strip()
        raw = r.get("raw")
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
        return ""

    def _get_raw_for_node(r: Dict[str, Any]) -> str:
        raw = r.get("raw")
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
        return _get_anchor(r)

    def _is_anchor_only(raw_s: str, author: str, year: str) -> bool:
        if _is_empty_str(raw_s):
            return True
        a = (author or "").strip()
        y = (year or "").strip()
        if not a or not y:
            return False
        pat = r"^\(\s*" + re.escape(a) + r"\s+" + re.escape(y) + r"\s*\)$"
        return bool(re.match(pat, raw_s.strip(), flags=re.IGNORECASE))

    def _work_id(author: str, year: str, raw_s: str) -> str:
        a = (author or "").strip()
        y = str(year or "").strip()
        y_norm = str(_year_int(y)) if y else ""
        if a and y_norm and y_norm != "0":
            return "work:" + ":".join([_slug(a), y_norm])
        return "work:" + _hash(raw_s)

    def _pick_nonempty(existing: str, candidate: Any) -> str:
        e = (existing or "").strip()
        c = (candidate or "")
        c = c.strip() if isinstance(c, str) else ""
        if e:
            return e
        return c

    def _source_node_data() -> Dict[str, Any]:
        m = source_meta or {}
        if not isinstance(m, dict):
            m = {}

        title = (m.get("title") or m.get("label") or "").strip() if isinstance(m.get("title") or m.get("label"),
                                                                               str) else ""
        authors = (
            (m.get("authors") or m.get("authors_str") or m.get("author") or "").strip()
            if isinstance(m.get("authors") or m.get("authors_str") or m.get("author") or "", str)
            else ""
        )
        venue = (m.get("venue") or "").strip() if isinstance(m.get("venue") or "", str) else ""
        url = (m.get("url") or "").strip() if isinstance(m.get("url") or "", str) else ""
        abstract = (m.get("abstract") or "").strip() if isinstance(m.get("abstract") or "", str) else ""
        doi = (m.get("doi") or "").strip() if isinstance(m.get("doi") or "", str) else ""
        year = _year_int(m.get("year")) if m.get("year") is not None else 0

        if not title:
            title = source_doc_id

        return {
            "id": source_doc_id,
            "label": title,
            "title": title,
            "authors": authors,
            "authors_str": authors,
            "venue": venue,
            "url": url,
            "abstract": abstract,
            "year": year,
            "citations": 0,
            "doi": doi,
            "external_id": source_doc_id,
            "isSeed": True,
        }

    footnote_full: Dict[int, Dict[str, Any]] = {}
    for r in refs:
        fn = _to_int_or_none(r.get("footnote_number"))
        raw_s = _get_raw_for_node(r)
        if fn and fn > 0 and (not _is_empty_str(raw_s)) and (not _looks_like_short_ref(raw_s)):
            footnote_full[fn] = r

    nodes_by_id: Dict[str, Dict[str, Any]] = {
        source_doc_id: {"data": _source_node_data()}
    }

    edges_out: List[Dict[str, Any]] = []
    seen_edge_keys = set()

    def _ensure_work_node(work_ref: Dict[str, Any]) -> str:
        author = work_ref.get("author") or ""
        year = work_ref.get("year") or ""
        raw_s = _get_raw_for_node(work_ref)
        wid = _work_id(str(author), str(year), raw_s)

        a = author.strip() if isinstance(author, str) else ""
        y = str(year).strip() if year is not None else ""
        url = (work_ref.get("url") or "").strip() if isinstance(work_ref.get("url"), str) else ""
        doi = (work_ref.get("doi") or "").strip() if isinstance(work_ref.get("doi"), str) else ""
        venue = (work_ref.get("venue") or "").strip() if isinstance(work_ref.get("venue"), str) else ""
        abstract = (work_ref.get("abstract") or "").strip() if isinstance(work_ref.get("abstract"), str) else ""

        if a and y and _is_anchor_only(raw_s, a, y):
            title = f"{a} ({y})"
        else:
            title = raw_s.strip() if isinstance(raw_s, str) else ""
        if not title:
            title = f"{a} ({y})".strip() or wid

        if wid not in nodes_by_id:
            nodes_by_id[wid] = {
                "data": {
                    "id": wid,
                    "label": title,
                    "title": title,
                    "authors": a,
                    "authors_str": a,
                    "venue": venue,
                    "url": url,
                    "abstract": abstract,
                    "year": _year_int(year),
                    "citations": 0,
                    "doi": doi,
                    "external_id": wid,
                    "isSeed": False,
                }
            }
        else:
            d = nodes_by_id[wid].get("data") or {}
            d["venue"] = _pick_nonempty(d.get("venue") or "", venue)
            d["url"] = _pick_nonempty(d.get("url") or "", url)
            d["doi"] = _pick_nonempty(d.get("doi") or "", doi)
            d["abstract"] = _pick_nonempty(d.get("abstract") or "", abstract)

        return wid

    edge_i = 0
    for r in refs:
        raw_s = _get_raw_for_node(r)
        if _is_empty_str(raw_s):
            continue

        target = r
        anchor = _get_anchor(r)

        if _looks_like_short_ref(raw_s) or _looks_like_short_ref(anchor):
            n = _extract_n(raw_s) or _extract_n(anchor)
            if n is not None and n in footnote_full:
                target = footnote_full[n]

        target_raw = _get_raw_for_node(target)
        if _is_empty_str(target_raw):
            continue

        wid = _ensure_work_node(target)

        fn = _to_int_or_none(r.get("footnote_number"))
        page_i = r.get("page_index")
        page_idx = page_i if isinstance(page_i, int) else None

        edge_key = (source_doc_id, wid, anchor, fn, page_idx, raw_s)
        if edge_key in seen_edge_keys:
            continue
        seen_edge_keys.add(edge_key)

        edge_i += 1
        edges_out.append(
            {
                "data": {
                    "id": f"edge:cites:{edge_i}",
                    "source": source_doc_id,
                    "target": wid,
                    "weight": 1.0,
                    "context": _get_context(r),
                    "citation_anchor": anchor,
                    "raw": raw_s,
                    "citation_type": r.get("citation_type") or "unknown",
                    "footnote_number": fn,
                    "page_index": page_idx,
                }
            }
        )

    cite_counts: Dict[str, int] = {}
    for e in edges_out:
        d = e.get("data") or {}
        wid = (d.get("target") or "").strip()
        if wid:
            cite_counts[wid] = cite_counts.get(wid, 0) + 1

    for wid, node in nodes_by_id.items():
        if wid == source_doc_id:
            continue
        d = node.get("data") or {}
        d["citations"] = int(cite_counts.get(wid, 0))

    return {
        "seedId": source_doc_id,
        "priorIds": [],
        "derivativeIds": [],
        "scope": "local",
        "build_ms": 0,
        "nodes": list(nodes_by_id.values()),
        "edges": edges_out,
    }

def global_references_graph(
    local_graphs: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    ###1. collect all paper (seed) nodes from local graphs
    ###2. build global work ids so the same work is shared across papers
    ###3. create edges paper->work (one per paper/work pair)
    ###4. set citations = number of distinct papers citing the work
    """
    def _slug(s: str) -> str:
        s = (s or "").strip().lower()
        s = re.sub(r"\s+", " ", s)
        s = re.sub(r"[^a-z0-9]+", "-", s)
        return s.strip("-")

    def _hash(s: str) -> str:
        return hashlib.sha1((s or "").encode("utf-8")).hexdigest()[:12]

    def _year_int(y: Any) -> int:
        s = "" if y is None else str(y).strip()
        digits = "".join([c for c in s if c.isdigit()])
        return int(digits) if digits else 0

    def _extract_author_year_from_text(t: str) -> Tuple[str, int]:
        s = (t or "").strip()
        m = re.search(r"^\s*([^()]{1,200}?)\s*\(\s*(\d{4})\s*\)\s*$", s)
        if not m:
            return "", 0
        a = m.group(1).strip().strip(",")
        y = _year_int(m.group(2))
        return a, y

    def _author_year(node_data: Dict[str, Any]) -> Tuple[str, int]:
        a = (node_data.get("authors") or node_data.get("authors_str") or "").strip()
        y = _year_int(node_data.get("year"))
        if a and y:
            return a, y
        t = (node_data.get("title") or node_data.get("label") or "").strip()
        a2, y2 = _extract_author_year_from_text(t)
        if a2 and y2:
            return a2, y2
        ext = str(node_data.get("external_id") or "").strip()
        a3, y3 = _extract_author_year_from_text(ext)
        if a3 and y3:
            return a3, y3
        return a, y

    def _global_work_id(node_data: Dict[str, Any]) -> str:
        a, y = _author_year(node_data)
        if a and y:
            return "gwork:" + ":".join([_slug(a), str(int(y))])

        raw = (node_data.get("doi") or "").strip()
        if raw:
            return "gwork:doi:" + _slug(raw)

        raw2 = (node_data.get("url") or "").strip()
        if raw2:
            return "gwork:url:" + _hash(raw2)

        t = (node_data.get("title") or node_data.get("label") or "").strip()
        if t:
            return "gwork:title:" + _hash(t)

        raw3 = str(node_data.get("external_id") or node_data.get("id") or "")
        return "gwork:" + _hash(raw3)

    def _pick_title(existing: str, candidate: str, fallback: str) -> str:
        e = (existing or "").strip()
        c = (candidate or "").strip()
        if e and c:
            return e if len(e) <= len(c) else c
        if e:
            return e
        if c:
            return c
        return fallback

    nodes_by_id: Dict[str, Dict[str, Any]] = {}
    edges_out: List[Dict[str, Any]] = []
    seen_edge_keys = set()

    seed_ids: List[str] = []
    for g in local_graphs:
        sid = (g.get("seedId") or "").strip()
        if sid:
            seed_ids.append(sid)
    seed_ids = sorted(set(seed_ids))

    for sid in seed_ids:
        nodes_by_id[sid] = {
            "data": {
                "id": sid,
                "label": "source",
                "title": "source",
                "authors": "",
                "authors_str": "",
                "venue": "",
                "url": "",
                "abstract": "",
                "year": 0,
                "citations": 0,
                "doi": "",
                "external_id": sid,
                "isSeed": True,
            }
        }

    global_work_nodes: Dict[str, Dict[str, Any]] = {}
    work_to_seeds: Dict[str, set] = {}

    edge_i = 0
    for g in local_graphs:
        sid = (g.get("seedId") or "").strip()
        if not sid:
            continue

        local_nodes = g.get("nodes") or []
        local_edges = g.get("edges") or []

        local_node_by_id: Dict[str, Dict[str, Any]] = {}
        for n in local_nodes:
            d = n.get("data") or {}
            nid = (d.get("id") or "").strip()
            if nid:
                local_node_by_id[nid] = d

        for e in local_edges:
            ed = e.get("data") or {}
            tgt = (ed.get("target") or "").strip()
            if not tgt or tgt == sid:
                continue

            tgt_d = local_node_by_id.get(tgt) or {}
            gwid = _global_work_id(tgt_d)

            a, y = _author_year(tgt_d)
            title_cand = (tgt_d.get("title") or tgt_d.get("label") or "").strip()
            if not title_cand and a and y:
                title_cand = f"{a} ({int(y)})"

            if gwid not in global_work_nodes:
                title = title_cand or gwid
                authors = a.strip()
                year_val = int(y) if y else _year_int(tgt_d.get("year"))
                global_work_nodes[gwid] = {
                    "data": {
                        "id": gwid,
                        "label": title,
                        "title": title,
                        "authors": authors,
                        "authors_str": authors,
                        "venue": (tgt_d.get("venue") or "").strip(),
                        "url": (tgt_d.get("url") or "").strip(),
                        "abstract": (tgt_d.get("abstract") or "").strip(),
                        "year": int(year_val) if year_val else 0,
                        "citations": 0,
                        "doi": (tgt_d.get("doi") or "").strip(),
                        "external_id": gwid,
                        "isSeed": False,
                    }
                }
            else:
                cur = global_work_nodes[gwid]["data"]
                cur["title"] = _pick_title(cur.get("title") or "", title_cand, gwid)
                cur["label"] = cur["title"]
                if not (cur.get("authors") or "").strip() and authors:
                    cur["authors"] = authors
                    cur["authors_str"] = authors
                if not int(cur.get("year") or 0) and y:
                    cur["year"] = int(y)

            if gwid not in work_to_seeds:
                work_to_seeds[gwid] = set()
            work_to_seeds[gwid].add(sid)

            edge_key = (sid, gwid)
            if edge_key in seen_edge_keys:
                continue
            seen_edge_keys.add(edge_key)

            edge_i += 1
            edges_out.append(
                {
                    "data": {
                        "id": f"edge:global:cites:{edge_i}",
                        "source": sid,
                        "target": gwid,
                        "weight": 1.0,
                        "context": "",
                        "citation_anchor": "",
                        "raw": "",
                        "citation_type": "aggregated",
                        "footnote_number": None,
                        "page_index": None,
                    }
                }
            )

    for gwid, node in global_work_nodes.items():
        cited_by = work_to_seeds.get(gwid) or set()
        node["data"]["citations"] = int(len(cited_by))

    for gwid, node in global_work_nodes.items():
        nodes_by_id[gwid] = node

    return {
        "seedId": "global",
        "priorIds": [],
        "derivativeIds": [],
        "scope": "global",
        "build_ms": 0,
        "nodes": list(nodes_by_id.values()),
        "edges": edges_out,
    }
def references_local_global_graph(
    structured_payloads: Union[Dict[str, Any], List[Dict[str, Any]]],
    source_meta_by_pdf_path: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    ###1. normalize input payloads into a list (accept batch wrapper keys like processed/items)
    ###2. extract structured references (prefer structured_references -> references)
    ###3. fetch source metadata via payload/meta or pdf_path lookup
    ###4. if still missing, infer source metadata from repeated in-text self-citation entries
    ###5. build local graphs, then global graph, then provenance
    """
    def _hash(s: str) -> str:
        return hashlib.sha1((s or "").encode("utf-8")).hexdigest()[:12]

    def _payloads_to_list(x: Any) -> List[Any]:
        if isinstance(x, list):
            return x
        if isinstance(x, dict):
            for k in ("processed", "items", "results", "payloads"):
                v = x.get(k)
                if isinstance(v, list):
                    return v
            return [x]
        return []

    def _extract_structured_refs(obj: Any, depth: int = 0) -> Dict[str, Any]:
        if depth > 8:
            return {"references": []}

        if isinstance(obj, dict):
            if "structured_references" in obj and isinstance(obj.get("structured_references"), dict):
                return _extract_structured_refs(obj.get("structured_references"), depth + 1)

            if "references" in obj and isinstance(obj.get("references"), list):
                return {"references": [r for r in obj.get("references") if isinstance(r, dict)]}

            for k in ("refs", "citations"):
                if k in obj and isinstance(obj.get(k), list):
                    return {"references": [r for r in obj.get(k) if isinstance(r, dict)]}

            for v in obj.values():
                if isinstance(v, (dict, list)):
                    out = _extract_structured_refs(v, depth + 1)
                    if isinstance(out, dict) and isinstance(out.get("references"), list) and out["references"]:
                        return out

            return {"references": []}

        if isinstance(obj, list):
            return {"references": [r for r in obj if isinstance(r, dict)]}

        return {"references": []}

    def _doc_id_for_payload(payload: Any, idx: int) -> str:
        if isinstance(payload, dict):
            pdf_path = payload.get("pdf_path")
            if isinstance(pdf_path, str) and pdf_path.strip():
                return "doc:" + _hash(pdf_path.strip())
        return f"doc:{idx + 1}"

    def _infer_source_meta_from_refs(structured: Dict[str, Any]) -> Dict[str, Any]:
        refs = structured.get("references") or []
        if not isinstance(refs, list):
            return {}

        best: Dict[str, Any] = {}
        best_score = -1

        for r in refs:
            if not isinstance(r, dict):
                continue
            if (r.get("citation_type") or "") != "in_text":
                continue

            title = (r.get("title") or "").strip() if isinstance(r.get("title"), str) else ""
            author = (r.get("author") or "").strip() if isinstance(r.get("author"), str) else ""
            year = (r.get("year") or "").strip() if r.get("year") is not None else ""
            url = (r.get("url") or "").strip() if isinstance(r.get("url"), str) else ""
            doi = (r.get("doi") or "").strip() if isinstance(r.get("doi"), str) else ""

            if not title or not author or not year:
                continue

            score = 0
            score += 3 if title else 0
            score += 3 if author else 0
            score += 2 if year else 0
            score += 2 if url else 0
            score += 2 if doi else 0

            if score > best_score:
                best_score = score
                best = {
                    "title": title,
                    "authors": author,
                    "authors_str": author,
                    "year": year,
                    "url": url,
                    "doi": doi,
                    "venue": (r.get("venue") or "").strip() if isinstance(r.get("venue"), str) else "",
                    "abstract": (r.get("abstract") or "").strip() if isinstance(r.get("abstract"), str) else "",
                }

        return best

    def _source_meta_for_payload(payload: Any, structured: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return _infer_source_meta_from_refs(structured)

        for k in ("source_meta", "meta", "metadata"):
            v = payload.get(k)
            if isinstance(v, dict) and v:
                return v

        pdf_path = payload.get("pdf_path")
        if isinstance(pdf_path, str) and pdf_path.strip():
            lut = source_meta_by_pdf_path or {}
            m = lut.get(pdf_path.strip())
            if isinstance(m, dict) and m:
                return m

        out: Dict[str, Any] = {}
        for k in ("title", "authors", "authors_str", "venue", "url", "abstract", "year", "doi"):
            v = payload.get(k)
            if v is not None:
                out[k] = v

        has_title = isinstance(out.get("title"), str) and out["title"].strip()
        if has_title:
            return out

        inferred = _infer_source_meta_from_refs(structured)
        return inferred if inferred else out

    payload_list = _payloads_to_list(structured_payloads)

    local_graphs: List[Dict[str, Any]] = []
    for i, payload in enumerate(payload_list):
        structured = _extract_structured_refs(payload)
        doc_id = _doc_id_for_payload(payload, i)
        source_meta = _source_meta_for_payload(payload, structured)
        local_graphs.append(references_to_graph(structured, doc_id, source_meta=source_meta))

    global_graph = global_references_graph(local_graphs)
    out = {"local": local_graphs, "global": global_graph}
    return populate_prior_derivative(out)




def print_item_pdf(df, idx=0):
    """
    ###1. select item (row)
    ###2. extract metadata
    ###3. print pdf path
    """
    df, raw, _ = load_data_from_source_for_widget(collection_name=collection_name, )

    item = df.iloc[idx]

    metadata = {
        "title": item["title"],
        "authors": item["authors"],
        "year": item["year"],
        "url": item["url"],
        "source": item["source"],
        "item_type": item["item_type"],
        "abstract": item["abstract"],
        "doi": item["doi"],
        "pdf_path": item["pdf_path"],
    }

    print(metadata["pdf_path"])
def EXTRACT_METADATA_REFERENCES(references, call_models, max_items_per_payload=12, max_chars_per_item=2000):
    """
    ###1. validate and cap evidence items
    ###2. chunk into payloads
    ###3. call LLM per payload with a strict prompt
    ###4. collect parsed metadata outputs
    """
    def _is_dict(x):
        return isinstance(x, dict)

    def _safe_str(x, limit):
        s = "" if x is None else str(x)
        s = s.strip()
        if not s:
            return ""
        if len(s) > limit:
            return s[:limit]
        return s

    def _to_int_or_none(x):
        if x is None:
            return None
        s = str(x).strip()
        if not s:
            return None
        if s.isdigit():
            return int(s)
        return None

    def _cap_item(item):
        out = {}
        out["mention_id"] = _safe_str(item.get("mention_id"), 24) or ""
        out["citation_type"] = _safe_str(item.get("citation_type"), 32) or "unknown"
        out["citation_anchor"] = _safe_str(item.get("citation_anchor"), 160)
        out["context_preceding"] = _safe_str(item.get("context_preceding"), 80)
        out["raw"] = _safe_str(item.get("raw"), max_chars_per_item)
        out["footnote_number"] = _to_int_or_none(item.get("footnote_number"))
        return out

    def _chunk(xs, n):
        if n < 1:
            n = 1
        return [xs[i : i + n] for i in range(0, len(xs), n)]

    prompt = (
        "You are a citation parser/extractor.\n"
        "You will receive a PAYLOAD that contains citation evidence items.\n"
        "Each item may be an in-text citation or a footnote/endnote string.\n\n"
        "Task:\n"
        "For EACH item, return structured metadata.\n\n"
        "Rules:\n"
        "1) Do not invent. Use only what is present in the payload.\n"
        "2) If a DOI is present, return ONLY the DOI for that item and set all other fields empty.\n"
        "3) If no DOI is present, extract: authors, year, url, item_type.\n"
        "4) authors: list of author/institution names as printed (best-effort).\n"
        "5) year: 4-digit year if present, else empty string.\n"
        "6) url: a printed URL if present, else empty string.\n"
        "7) item_type: one of: journal_article, book, book_chapter, report, case_law, statute, webpage, other.\n"
        "8) Output MUST be valid JSON with this shape:\n"
        "{\n"
        '  "items": [\n'
        "    {\n"
        '      "mention_id": "m1",\n'
        '      "doi": "",\n'
        '      "authors": [],\n'
        '      "year": "",\n'
        '      "url": "",\n'
        '      "item_type": "other"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "9) Preserve mention_id from input. One output object per input item.\n"
        "10) If an input item is empty or unparseable, return empty fields.\n"
    )

    if references is None:
        return []

    items = []
    if isinstance(references, dict):
        maybe = references.get("references")
        if isinstance(maybe, list):
            items = maybe
        elif isinstance(references.get("items"), list):
            items = references.get("items")
        else:
            items = []
    elif isinstance(references, list):
        items = references
    else:
        items = []

    capped = []
    for it in items:
        if not _is_dict(it):
            continue
        c = _cap_item(it)
        if c["mention_id"] and (c["raw"] or c["citation_anchor"]):
            capped.append(c)

    payloads = _chunk(capped, max_items_per_payload)

    outputs = []
    for payload in payloads:
        text = f"{prompt}\n\nPAYLOAD:{payload}\n\n"
        out = call_models(text)
        outputs.append(out)

    return outputs

# print(df)
a =process_pdf(
    pdf_path='C:\\Users\\luano\\Zotero\\storage\\2DFBFQRI\\Mikanagi and Macak - 2020 - Attribution of cyber operations an  international law perspective on the park jin hyok case.pdf')
sections_map = merge_sections_min_words(a["sections"], min_words=500)
for k, v in sections_map.items():
    read=False
    store_only=False
    # resp = call_models_old_backin(
    #     text=k+"\n\n"+v,
    #     function="citations",
    #     custom_id=123,
    #     collection_name=collection_name,
    #     read=read,
    #     by_index=1,
    #     store_only=store_only,
    #     ai="openai",
    # )
    prompt="""{
  "system_prompt": "You are a deterministic citation extractor for academic legal documents.\n\nYour task is lossless enumeration, normalization, and conservative parsing of citation mentions from noisy legal text.\n\nYou do NOT interpret, summarise, analyse, enrich, or infer.\nYou do NOT guess missing information.\nYou behave like a hybrid of GROBID, CERMINE, and a careful human proof-reader.\n\nYour overriding objective is complete citation coverage with conservative accuracy.\n\n===============================\nMANDATORY EXECUTION ORDER\n===============================\n\nYou MUST execute the task in two strict phases, in order. Failure to follow this order invalidates the output.\n\n----------------------\nPhase 1 — Marker Enumeration\n----------------------\n\nScan the ENTIRE document from start to end.\n\nIdentify EVERY citation marker, in strict order of appearance.\n\nCitation markers include (non-exhaustive):\n- Footnotes (¹, ², ³… or 1, 2, 3…)\n- In-text citations (e.g. (Rid and Buchanan 2014), (ibid), (n 11), (para 205))\n- Case citations (e.g. ICJ Rep, RIAA, ILR)\n\nRules for Phase 1:\n- Do NOT extract citation text.\n- Do NOT extract metadata.\n- Do NOT normalize beyond trivial whitespace.\n- Do NOT merge markers.\n- Do NOT stop early.\n\nThe sole purpose of Phase 1 is exhaustive marker enumeration.\n\n----------------------\nPhase 2 — Citation Extraction\n----------------------\n\nFor EACH marker identified in Phase 1, in order:\n- Extract the corresponding citation text.\n- Clean obvious noise.\n- Split multiple distinct works if present.\n\nIf extraction is uncertain, partial, or degraded, you MUST still emit an entry using the best available cleaned text.\n\nMetadata completeness is secondary. Missing metadata MUST NOT block emitting an entry.\n\n===============================\nSCOPE OF EXTRACTION\n===============================\n\nExtract ALL citation mentions, including:\n- Footnotes (numeric or symbolic)\n- In-text citations (author–year, short forms, case references)\n- Embedded citations inside explanatory footnotes\n\nYou MUST NOT:\n- Infer missing citations\n- Merge distinct works\n- Deduplicate repeated citations\n- Suppress ambiguous or partial citations\n\n===============================\nNOISE HANDLING (AFTER EXTRACTION ONLY)\n===============================\n\nThe source text may contain:\n- Broken or partial HTML\n- Line breaks inside URLs\n- Repeated headers or footers\n- OCR artefacts\n- Split or duplicated footnotes\n\nCleaning rules:\n- Remove HTML tags and fragments entirely.\n- Reconstruct URLs only when clearly broken across lines.\n- Join split footnotes only when they clearly share the same marker.\n- Remove repeated headers/footers unless part of the citation.\n- Normalize whitespace.\n- Preserve original wording, punctuation, and order.\n\n===============================\nRAW FIELD DEFINITION\n===============================\n\nFor each citation entry:\nraw = the full cleaned citation text for that specific work, as it would appear in a readable law journal.\n\nIt MUST be complete, noise-free, grammatically intact, faithful to the source, and suitable for downstream parsing.\n\n===============================\nMETADATA EXTRACTION (STRICT)\n===============================\n\nExtract metadata ONLY if explicitly present in the cleaned citation text.\n\nAllowed fields:\n- title\n- authors (last names only, preserve order)\n- doi\n- url\n- date\n\nRules:\n- Do NOT normalize spelling, punctuation, or capitalization.\n- Do NOT infer missing data.\n- If multiple works are present, split them.\n- If a field is not explicitly present, set it to null.\n\n===============================\nSPLITTING RULE (CRITICAL)\n===============================\n\nIf a single marker contains multiple distinct bibliographic works:\n- Split into multiple output entries.\n- Each entry MUST have a unique mention_id.\n- Split entries MUST share the same citation_anchor and footnote_number.\n\n===============================\nCOVERAGE GUARANTEE\n===============================\n\nEvery citation marker found in Phase 1 MUST appear in at least one output entry.\n\nIf extracted entries are fewer than markers found, the output is INVALID and must be regenerated internally.\n\n===============================\nPROHIBITIONS\n===============================\n\n- No commentary\n- No summaries\n- No assumptions\n- No bibliographic completion\n- No guessing missing metadata\n\nOutput JSON only.",
  "json_schema": {
    "name": "citation_extraction_v1",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "references": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "mention_id": {
                "type": "string",
                "description": "Sequential identifier (m1, m2, …)"
              },
              "citation_type": {
                "type": "string",
                "enum": ["footnote", "in_text", "unknown"]
              },
              "citation_anchor": {
                "type": "string",
                "description": "Exact citation marker as printed"
              },
              "context_preceding": {
                "type": "string",
                "description": "Up to 80 characters immediately preceding the anchor"
              },
              "raw": {
                "type": "string",
                "description": "Full cleaned citation text for this specific work"
              },
              "footnote_number": {
                "type": ["integer", "null"]
              },
              "function": {
                "type": "string",
                "enum": ["biblio", "comment", "abbr"]
              },
            
              }
            },
            "required": [
              "mention_id",
              "citation_type",
              "citation_anchor",
              "context_preceding",
              "raw",
              "footnote_number",
              "function",
            ],
            "additionalProperties": false
          }
        }
      },
      "required": ["references"],
      "additionalProperties": false
    }
  }
}

"""
    print(prompt+"\n\n")
    print(k,v,sep="\n\n")
    input("Press enter to continue...")

def populate_prior_derivative(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    ###1. treat each local graph as an input artifact
    ###2. treat the global graph as derived from all locals
    ###3. preserve any pre-existing provenance; only fill missing fields
    """
    local_graphs = payload.get("local") or []
    global_graph = payload.get("global") or {}

    seed_ids: List[str] = []
    for g in local_graphs:
        sid = (g.get("seedId") or "").strip()
        if sid:
            seed_ids.append(sid)

    seed_ids = sorted(set(seed_ids))
    global_id = (global_graph.get("seedId") or "global").strip() or "global"
    global_graph["seedId"] = global_id

    existing_priors = global_graph.get("priorIds")
    if not isinstance(existing_priors, list) or not existing_priors:
        global_graph["priorIds"] = seed_ids
    else:
        global_graph["priorIds"] = sorted(set([str(x).strip() for x in existing_priors if str(x).strip()] + seed_ids))

    if not isinstance(global_graph.get("derivativeIds"), list):
        global_graph["derivativeIds"] = []

    for g in local_graphs:
        if not isinstance(g.get("priorIds"), list):
            g["priorIds"] = []
        if not isinstance(g.get("derivativeIds"), list):
            g["derivativeIds"] = []
        g["derivativeIds"] = sorted(set([str(x).strip() for x in g["derivativeIds"] if str(x).strip()] + [global_id]))

    payload["local"] = local_graphs
    payload["global"] = global_graph
    return payload


def launch_graph(data: dict) -> None:
    """
    ###1. ensure a Qt application exists
    ###2. accept either a single graph payload or {"local":[...], "global":{...}}
    ###3. load the HTML, then send the chosen graph (default: global else first local)
    """
    import sys
    from PyQt6.QtWidgets import QApplication

    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)

    payload = data if isinstance(data, dict) else {}

    local_graphs = payload.get("local")
    global_graph = payload.get("global")

    has_bundle = isinstance(local_graphs, list) or isinstance(global_graph, dict)

    if isinstance(global_graph, dict):
        initial_graph = global_graph
    elif isinstance(local_graphs, list) and local_graphs and isinstance(local_graphs[0], dict):
        initial_graph = local_graphs[0]
    else:
        initial_graph = payload

    seed_input = str((initial_graph or {}).get("seedId") or "seed")
    w = ConnectedPapersLikeGraph(seed_input=seed_input)

    w._local_graphs = local_graphs if isinstance(local_graphs, list) else []
    w._global_graph = global_graph if isinstance(global_graph, dict) else {}

    def _on_loaded(ok: bool) -> None:
        if not ok:
            return
        w.send_graph(initial_graph or {})

    w.web.loadFinished.connect(_on_loaded)
    w.show()

    if QApplication.instance() is app:
        app.exec()


# data={'local': [{'seedId': 'doc:1', 'priorIds': [], 'derivativeIds': [], 'scope': 'local', 'build_ms': 0, 'nodes': [{'data': {'id': 'doc:1', 'label': 'source', 'title': 'source', 'authors': '', 'authors_str': '', 'venue': '', 'url': '', 'abstract': '', 'year': 0, 'citations': 0, 'doi': '', 'external_id': 'doc:1', 'isSeed': True}}, {'data': {'id': 'work:smith:2022', 'label': 'Smith (2022)', 'title': 'Smith (2022)', 'authors': 'Smith', 'authors_str': 'Smith', 'venue': '', 'url': '', 'abstract': '', 'year': 2022, 'citations': 1, 'doi': '', 'external_id': 'work:smith:2022', 'isSeed': False}}, {'data': {'id': 'work:ronen:2020', 'label': 'Ronen (2020)', 'title': 'Ronen (2020)', 'authors': 'Ronen', 'authors_str': 'Ronen', 'venue': '', 'url': '', 'abstract': '', 'year': 2020, 'citations': 1, 'doi': '', 'external_id': 'work:ronen:2020', 'isSeed': False}}, {'data': {'id': 'work:kinsch:2009', 'label': 'Kinsch (2009)', 'title': 'Kinsch (2009)', 'authors': 'Kinsch', 'authors_str': 'Kinsch', 'venue': '', 'url': '', 'abstract': '', 'year': 2009, 'citations': 1, 'doi': '', 'external_id': 'work:kinsch:2009', 'isSeed': False}}, {'data': {'id': 'work:devaney:2016', 'label': 'Devaney (2016)', 'title': 'Devaney (2016)', 'authors': 'Devaney', 'authors_str': 'Devaney', 'venue': '', 'url': '', 'abstract': '', 'year': 2016, 'citations': 1, 'doi': '', 'external_id': 'work:devaney:2016', 'isSeed': False}}, {'data': {'id': 'work:chittaranjan-f-amerasinghe:2005:f2eac2d5cdf3', 'label': 'Chittaranjan F Amerasinghe, Evidence in International Litigation (Martinus Nijhoff 2005) 96-97.', 'title': 'Chittaranjan F Amerasinghe, Evidence in International Litigation (Martinus Nijhoff 2005) 96-97.', 'authors': 'Chittaranjan F Amerasinghe', 'authors_str': 'Chittaranjan F Amerasinghe', 'venue': '', 'url': '', 'abstract': '', 'year': 2005, 'citations': 1, 'doi': '', 'external_id': 'work:chittaranjan-f-amerasinghe:2005:f2eac2d5cdf3', 'isSeed': False}}, {'data': {'id': 'work:pulp-mills:2010:32166fd5e007', 'label': 'Pulp Mills (n 16), [163].', 'title': 'Pulp Mills (n 16), [163].', 'authors': 'Pulp Mills', 'authors_str': 'Pulp Mills', 'venue': '', 'url': '', 'abstract': '', 'year': 2010, 'citations': 1, 'doi': '', 'external_id': 'work:pulp-mills:2010:32166fd5e007', 'isSeed': False}}, {'data': {'id': 'work:dederer-and-singer:2019:82cc305c31ff', 'label': "Hans-Georg Dederer and Tassilo Singer, 'Adverse Cyber Operations: Causality, Attribution, Evidence, and Due Diligence' (2019) 95 International Law Studies 430, 459.", 'title': "Hans-Georg Dederer and Tassilo Singer, 'Adverse Cyber Operations: Causality, Attribution, Evidence, and Due Diligence' (2019) 95 International Law Studies 430, 459.", 'authors': 'Dederer and Singer', 'authors_str': 'Dederer and Singer', 'venue': '', 'url': '', 'abstract': '', 'year': 2019, 'citations': 1, 'doi': '', 'external_id': 'work:dederer-and-singer:2019:82cc305c31ff', 'isSeed': False}}, {'data': {'id': 'work:icj:1949:6eacec40e92b', 'label': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'title': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'authors': 'ICJ', 'authors_str': 'ICJ', 'venue': '', 'url': '', 'abstract': '', 'year': 1949, 'citations': 2, 'doi': '', 'external_id': 'work:icj:1949:6eacec40e92b', 'isSeed': False}}, {'data': {'id': 'work:smith:2022:76a1eb39506b', 'label': 'Smith (n 1) 44-47.', 'title': 'Smith (n 1) 44-47.', 'authors': 'Smith', 'authors_str': 'Smith', 'venue': '', 'url': '', 'abstract': '', 'year': 2022, 'citations': 1, 'doi': '', 'external_id': 'work:smith:2022:76a1eb39506b', 'isSeed': False}}], 'edges': [{'data': {'id': 'edge:cites:1', 'source': 'doc:1', 'target': 'work:smith:2022', 'weight': 1.0, 'context': 'This paper frames evidentiary thresholds for attribution decisions.', 'citation_anchor': '(Smith 2022)', 'raw': '(Smith 2022)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 1}}, {'data': {'id': 'edge:cites:2', 'source': 'doc:1', 'target': 'work:ronen:2020', 'weight': 1.0, 'context': 'It adopts a research programme on feasibility and advisability of evidentiary standards.', 'citation_anchor': '(Ronen 2020)', 'raw': '(Ronen 2020)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 2}}, {'data': {'id': 'edge:cites:3', 'source': 'doc:1', 'target': 'work:kinsch:2009', 'weight': 1.0, 'context': 'A comparative examination finds no uniform standard of proof.', 'citation_anchor': '(Kinsch 2009)', 'raw': '(Kinsch 2009)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 3}}, {'data': {'id': 'edge:cites:4', 'source': 'doc:1', 'target': 'work:devaney:2016', 'weight': 1.0, 'context': 'International law’s approach to procedure and evidence is flexible.', 'citation_anchor': '(Devaney 2016)', 'raw': '(Devaney 2016)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 3}}, {'data': {'id': 'edge:cites:5', 'source': 'doc:1', 'target': 'work:chittaranjan-f-amerasinghe:2005:f2eac2d5cdf3', 'weight': 1.0, 'context': '33', 'citation_anchor': '33', 'raw': 'Chittaranjan F Amerasinghe, Evidence in International Litigation (Martinus Nijhoff 2005) 96-97.', 'citation_type': 'footnote', 'footnote_number': 33, 'page_index': 4}}, {'data': {'id': 'edge:cites:6', 'source': 'doc:1', 'target': 'work:pulp-mills:2010:32166fd5e007', 'weight': 1.0, 'context': '34', 'citation_anchor': '34', 'raw': 'Pulp Mills (n 16), [163].', 'citation_type': 'footnote', 'footnote_number': 34, 'page_index': 4}}, {'data': {'id': 'edge:cites:7', 'source': 'doc:1', 'target': 'work:dederer-and-singer:2019:82cc305c31ff', 'weight': 1.0, 'context': '39', 'citation_anchor': '39', 'raw': "Hans-Georg Dederer and Tassilo Singer, 'Adverse Cyber Operations: Causality, Attribution, Evidence, and Due Diligence' (2019) 95 International Law Studies 430, 459.", 'citation_type': 'footnote', 'footnote_number': 39, 'page_index': 5}}, {'data': {'id': 'edge:cites:8', 'source': 'doc:1', 'target': 'work:icj:1949:6eacec40e92b', 'weight': 1.0, 'context': '40', 'citation_anchor': '40', 'raw': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'citation_type': 'footnote', 'footnote_number': 40, 'page_index': 5}}, {'data': {'id': 'edge:cites:9', 'source': 'doc:1', 'target': 'work:smith:2022:76a1eb39506b', 'weight': 1.0, 'context': '51', 'citation_anchor': '51', 'raw': 'Smith (n 1) 44-47.', 'citation_type': 'footnote', 'footnote_number': 51, 'page_index': 6}}, {'data': {'id': 'edge:cites:10', 'source': 'doc:1', 'target': 'work:icj:1949:6eacec40e92b', 'weight': 1.0, 'context': '56', 'citation_anchor': '56', 'raw': 'Corfu (n 40), 17.', 'citation_type': 'footnote', 'footnote_number': 56, 'page_index': 6}}]}, {'seedId': 'doc:2', 'priorIds': [], 'derivativeIds': [], 'scope': 'local', 'build_ms': 0, 'nodes': [{'data': {'id': 'doc:2', 'label': 'source', 'title': 'source', 'authors': '', 'authors_str': '', 'venue': '', 'url': '', 'abstract': '', 'year': 0, 'citations': 0, 'doi': '', 'external_id': 'doc:2', 'isSeed': True}}, {'data': {'id': 'work:smith:2022', 'label': 'Smith (2022)', 'title': 'Smith (2022)', 'authors': 'Smith', 'authors_str': 'Smith', 'venue': '', 'url': '', 'abstract': '', 'year': 2022, 'citations': 1, 'doi': '', 'external_id': 'work:smith:2022', 'isSeed': False}}, {'data': {'id': 'work:foster:2010', 'label': 'Foster (2010)', 'title': 'Foster (2010)', 'authors': 'Foster', 'authors_str': 'Foster', 'venue': '', 'url': '', 'abstract': '', 'year': 2010, 'citations': 1, 'doi': '', 'external_id': 'work:foster:2010', 'isSeed': False}}, {'data': {'id': 'work:devaney:2016', 'label': 'Devaney (2016)', 'title': 'Devaney (2016)', 'authors': 'Devaney', 'authors_str': 'Devaney', 'venue': '', 'url': '', 'abstract': '', 'year': 2016, 'citations': 1, 'doi': '', 'external_id': 'work:devaney:2016', 'isSeed': False}}, {'data': {'id': 'work:ronen:2020', 'label': 'Ronen (2020)', 'title': 'Ronen (2020)', 'authors': 'Ronen', 'authors_str': 'Ronen', 'venue': '', 'url': '', 'abstract': '', 'year': 2020, 'citations': 1, 'doi': '', 'external_id': 'work:ronen:2020', 'isSeed': False}}, {'data': {'id': 'work:icj:1949:6eacec40e92b', 'label': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'title': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'authors': 'ICJ', 'authors_str': 'ICJ', 'venue': '', 'url': '', 'abstract': '', 'year': 1949, 'citations': 2, 'doi': '', 'external_id': 'work:icj:1949:6eacec40e92b', 'isSeed': False}}, {'data': {'id': 'work:dederer-and-singer:2019:be9a4e30829d', 'label': 'Dederer and Singer (n 20), 444-445.', 'title': 'Dederer and Singer (n 20), 444-445.', 'authors': 'Dederer and Singer', 'authors_str': 'Dederer and Singer', 'venue': '', 'url': '', 'abstract': '', 'year': 2019, 'citations': 1, 'doi': '', 'external_id': 'work:dederer-and-singer:2019:be9a4e30829d', 'isSeed': False}}, {'data': {'id': 'work:chittaranjan-f-amerasinghe:2005:aebebc6c7335', 'label': 'Amerasinghe (n 21) 234.', 'title': 'Amerasinghe (n 21) 234.', 'authors': 'Chittaranjan F Amerasinghe', 'authors_str': 'Chittaranjan F Amerasinghe', 'venue': '', 'url': '', 'abstract': '', 'year': 2005, 'citations': 1, 'doi': '', 'external_id': 'work:chittaranjan-f-amerasinghe:2005:aebebc6c7335', 'isSeed': False}}, {'data': {'id': 'work:kinsch:2009:1bd4df242627', 'label': 'Kinsch (2009) 436.', 'title': 'Kinsch (2009) 436.', 'authors': 'Kinsch', 'authors_str': 'Kinsch', 'venue': '', 'url': '', 'abstract': '', 'year': 2009, 'citations': 1, 'doi': '', 'external_id': 'work:kinsch:2009:1bd4df242627', 'isSeed': False}}, {'data': {'id': 'work:smith:2022:05ef9e0b2e70', 'label': 'Smith, Evidentiary Thresholds in Cyber Attribution (2022) 77-81.', 'title': 'Smith, Evidentiary Thresholds in Cyber Attribution (2022) 77-81.', 'authors': 'Smith', 'authors_str': 'Smith', 'venue': '', 'url': '', 'abstract': '', 'year': 2022, 'citations': 1, 'doi': '', 'external_id': 'work:smith:2022:05ef9e0b2e70', 'isSeed': False}}], 'edges': [{'data': {'id': 'edge:cites:1', 'source': 'doc:2', 'target': 'work:smith:2022', 'weight': 1.0, 'context': 'The analysis uses Smith’s policy-sensitive evidentiary framework.', 'citation_anchor': '(Smith 2022)', 'raw': '(Smith 2022)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 1}}, {'data': {'id': 'edge:cites:2', 'source': 'doc:2', 'target': 'work:foster:2010', 'weight': 1.0, 'context': 'Burden and standard of proof interact with admissibility and presumptions.', 'citation_anchor': '(Foster 2010)', 'raw': '(Foster 2010)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 2}}, {'data': {'id': 'edge:cites:3', 'source': 'doc:2', 'target': 'work:devaney:2016', 'weight': 1.0, 'context': 'The doctrinal approach treats evidentiary rules as context-dependent.', 'citation_anchor': '(Devaney 2016)', 'raw': '(Devaney 2016)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 2}}, {'data': {'id': 'edge:cites:4', 'source': 'doc:2', 'target': 'work:ronen:2020', 'weight': 1.0, 'context': 'It aligns with Ronen’s account of evidentiary practice across regimes.', 'citation_anchor': '(Ronen 2020)', 'raw': '(Ronen 2020)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 3}}, {'data': {'id': 'edge:cites:5', 'source': 'doc:2', 'target': 'work:icj:1949:6eacec40e92b', 'weight': 1.0, 'context': '12', 'citation_anchor': '12', 'raw': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'citation_type': 'footnote', 'footnote_number': 12, 'page_index': 4}}, {'data': {'id': 'edge:cites:6', 'source': 'doc:2', 'target': 'work:icj:1949:6eacec40e92b', 'weight': 1.0, 'context': '13', 'citation_anchor': '13', 'raw': 'Corfu (n 12), 16.', 'citation_type': 'footnote', 'footnote_number': 13, 'page_index': 4}}, {'data': {'id': 'edge:cites:7', 'source': 'doc:2', 'target': 'work:dederer-and-singer:2019:be9a4e30829d', 'weight': 1.0, 'context': '20', 'citation_anchor': '20', 'raw': 'Dederer and Singer (n 20), 444-445.', 'citation_type': 'footnote', 'footnote_number': 20, 'page_index': 5}}, {'data': {'id': 'edge:cites:8', 'source': 'doc:2', 'target': 'work:chittaranjan-f-amerasinghe:2005:aebebc6c7335', 'weight': 1.0, 'context': '21', 'citation_anchor': '21', 'raw': 'Amerasinghe (n 21) 234.', 'citation_type': 'footnote', 'footnote_number': 21, 'page_index': 5}}, {'data': {'id': 'edge:cites:9', 'source': 'doc:2', 'target': 'work:kinsch:2009:1bd4df242627', 'weight': 1.0, 'context': '22', 'citation_anchor': '22', 'raw': 'Kinsch (2009) 436.', 'citation_type': 'footnote', 'footnote_number': 22, 'page_index': 6}}, {'data': {'id': 'edge:cites:10', 'source': 'doc:2', 'target': 'work:smith:2022:05ef9e0b2e70', 'weight': 1.0, 'context': '23', 'citation_anchor': '23', 'raw': 'Smith, Evidentiary Thresholds in Cyber Attribution (2022) 77-81.', 'citation_type': 'footnote', 'footnote_number': 23, 'page_index': 6}}]}, {'seedId': 'doc:3', 'priorIds': [], 'derivativeIds': [], 'scope': 'local', 'build_ms': 0, 'nodes': [{'data': {'id': 'doc:3', 'label': 'source', 'title': 'source', 'authors': '', 'authors_str': '', 'venue': '', 'url': '', 'abstract': '', 'year': 0, 'citations': 0, 'doi': '', 'external_id': 'doc:3', 'isSeed': True}}, {'data': {'id': 'work:smith:2022', 'label': 'Smith (2022)', 'title': 'Smith (2022)', 'authors': 'Smith', 'authors_str': 'Smith', 'venue': '', 'url': '', 'abstract': '', 'year': 2022, 'citations': 1, 'doi': '', 'external_id': 'work:smith:2022', 'isSeed': False}}, {'data': {'id': 'work:shelton:1988', 'label': 'Shelton (1988)', 'title': 'Shelton (1988)', 'authors': 'Shelton', 'authors_str': 'Shelton', 'venue': '', 'url': '', 'abstract': '', 'year': 1988, 'citations': 1, 'doi': '', 'external_id': 'work:shelton:1988', 'isSeed': False}}, {'data': {'id': 'work:varnava-and-others-v-turkey:2009', 'label': 'Varnava and Others v Turkey (2009)', 'title': 'Varnava and Others v Turkey (2009)', 'authors': 'Varnava and Others v Turkey', 'authors_str': 'Varnava and Others v Turkey', 'venue': '', 'url': '', 'abstract': '', 'year': 2009, 'citations': 1, 'doi': '', 'external_id': 'work:varnava-and-others-v-turkey:2009', 'isSeed': False}}, {'data': {'id': 'work:benzing:2019', 'label': 'Benzing (2019)', 'title': 'Benzing (2019)', 'authors': 'Benzing', 'authors_str': 'Benzing', 'venue': '', 'url': '', 'abstract': '', 'year': 2019, 'citations': 1, 'doi': '', 'external_id': 'work:benzing:2019', 'isSeed': False}}, {'data': {'id': 'work:ecthr:1978:ce592f2c13fb', 'label': 'ECtHR, Ireland v United Kingdom (Application No. 5310/71), Judgement, para 161.', 'title': 'ECtHR, Ireland v United Kingdom (Application No. 5310/71), Judgement, para 161.', 'authors': 'ECtHR', 'authors_str': 'ECtHR', 'venue': '', 'url': '', 'abstract': '', 'year': 1978, 'citations': 1, 'doi': '', 'external_id': 'work:ecthr:1978:ce592f2c13fb', 'isSeed': False}}, {'data': {'id': 'work:varnava:2009:c682d3cc4a56', 'label': 'Varnava (n 29) para 182.', 'title': 'Varnava (n 29) para 182.', 'authors': 'Varnava', 'authors_str': 'Varnava', 'venue': '', 'url': '', 'abstract': '', 'year': 2009, 'citations': 1, 'doi': '', 'external_id': 'work:varnava:2009:c682d3cc4a56', 'isSeed': False}}, {'data': {'id': 'work:kinsch:2009:1bd4df242627', 'label': 'Kinsch (2009) 436.', 'title': 'Kinsch (2009) 436.', 'authors': 'Kinsch', 'authors_str': 'Kinsch', 'venue': '', 'url': '', 'abstract': '', 'year': 2009, 'citations': 1, 'doi': '', 'external_id': 'work:kinsch:2009:1bd4df242627', 'isSeed': False}}, {'data': {'id': 'work:ronen:2020:469bc43e84ca', 'label': 'Ronen (2020) 12-15.', 'title': 'Ronen (2020) 12-15.', 'authors': 'Ronen', 'authors_str': 'Ronen', 'venue': '', 'url': '', 'abstract': '', 'year': 2020, 'citations': 1, 'doi': '', 'external_id': 'work:ronen:2020:469bc43e84ca', 'isSeed': False}}, {'data': {'id': 'work:smith:2022:76a1eb39506b', 'label': 'Smith (n 1) 44-47.', 'title': 'Smith (n 1) 44-47.', 'authors': 'Smith', 'authors_str': 'Smith', 'venue': '', 'url': '', 'abstract': '', 'year': 2022, 'citations': 1, 'doi': '', 'external_id': 'work:smith:2022:76a1eb39506b', 'isSeed': False}}, {'data': {'id': 'work:chittaranjan-f-amerasinghe:2005:3f61533341ef', 'label': 'Amerasinghe, Evidence in International Litigation (2005) 96-97.', 'title': 'Amerasinghe, Evidence in International Litigation (2005) 96-97.', 'authors': 'Chittaranjan F Amerasinghe', 'authors_str': 'Chittaranjan F Amerasinghe', 'venue': '', 'url': '', 'abstract': '', 'year': 2005, 'citations': 1, 'doi': '', 'external_id': 'work:chittaranjan-f-amerasinghe:2005:3f61533341ef', 'isSeed': False}}], 'edges': [{'data': {'id': 'edge:cites:1', 'source': 'doc:3', 'target': 'work:smith:2022', 'weight': 1.0, 'context': 'This paper uses Smith to motivate a burden-shifting model under information asymmetry.', 'citation_anchor': '(Smith 2022)', 'raw': '(Smith 2022)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 1}}, {'data': {'id': 'edge:cites:2', 'source': 'doc:3', 'target': 'work:shelton:1988', 'weight': 1.0, 'context': 'Burden allocation can vary within the same proceedings.', 'citation_anchor': '(Shelton 1988)', 'raw': '(Shelton 1988)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 2}}, {'data': {'id': 'edge:cites:3', 'source': 'doc:3', 'target': 'work:varnava-and-others-v-turkey:2009', 'weight': 1.0, 'context': 'The ECtHR discussed burden shift where facts lie within exclusive control.', 'citation_anchor': '(Varnava and Others v Turkey 2009)', 'raw': '(Varnava and Others v Turkey 2009)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 3}}, {'data': {'id': 'edge:cites:4', 'source': 'doc:3', 'target': 'work:benzing:2019', 'weight': 1.0, 'context': 'A duty to cooperate is used to limit the effect of informational monopolies.', 'citation_anchor': '(Benzing 2019)', 'raw': '(Benzing 2019)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 3}}, {'data': {'id': 'edge:cites:5', 'source': 'doc:3', 'target': 'work:ecthr:1978:ce592f2c13fb', 'weight': 1.0, 'context': '7', 'citation_anchor': '7', 'raw': 'ECtHR, Ireland v United Kingdom (Application No. 5310/71), Judgement, para 161.', 'citation_type': 'footnote', 'footnote_number': 7, 'page_index': 4}}, {'data': {'id': 'edge:cites:6', 'source': 'doc:3', 'target': 'work:varnava:2009:c682d3cc4a56', 'weight': 1.0, 'context': '8', 'citation_anchor': '8', 'raw': 'Varnava (n 29) para 182.', 'citation_type': 'footnote', 'footnote_number': 8, 'page_index': 4}}, {'data': {'id': 'edge:cites:7', 'source': 'doc:3', 'target': 'work:kinsch:2009:1bd4df242627', 'weight': 1.0, 'context': '9', 'citation_anchor': '9', 'raw': 'Kinsch (2009) 436.', 'citation_type': 'footnote', 'footnote_number': 9, 'page_index': 5}}, {'data': {'id': 'edge:cites:8', 'source': 'doc:3', 'target': 'work:ronen:2020:469bc43e84ca', 'weight': 1.0, 'context': '10', 'citation_anchor': '10', 'raw': 'Ronen (2020) 12-15.', 'citation_type': 'footnote', 'footnote_number': 10, 'page_index': 5}}, {'data': {'id': 'edge:cites:9', 'source': 'doc:3', 'target': 'work:smith:2022:76a1eb39506b', 'weight': 1.0, 'context': '11', 'citation_anchor': '11', 'raw': 'Smith (n 1) 44-47.', 'citation_type': 'footnote', 'footnote_number': 11, 'page_index': 6}}, {'data': {'id': 'edge:cites:10', 'source': 'doc:3', 'target': 'work:chittaranjan-f-amerasinghe:2005:3f61533341ef', 'weight': 1.0, 'context': '12', 'citation_anchor': '12', 'raw': 'Amerasinghe, Evidence in International Litigation (2005) 96-97.', 'citation_type': 'footnote', 'footnote_number': 12, 'page_index': 6}}]}, {'seedId': 'doc:4', 'priorIds': [], 'derivativeIds': [], 'scope': 'local', 'build_ms': 0, 'nodes': [{'data': {'id': 'doc:4', 'label': 'source', 'title': 'source', 'authors': '', 'authors_str': '', 'venue': '', 'url': '', 'abstract': '', 'year': 0, 'citations': 0, 'doi': '', 'external_id': 'doc:4', 'isSeed': True}}, {'data': {'id': 'work:smith:2022', 'label': 'Smith (2022)', 'title': 'Smith (2022)', 'authors': 'Smith', 'authors_str': 'Smith', 'venue': '', 'url': '', 'abstract': '', 'year': 2022, 'citations': 1, 'doi': '', 'external_id': 'work:smith:2022', 'isSeed': False}}, {'data': {'id': 'work:ronen:2020', 'label': 'Ronen (2020)', 'title': 'Ronen (2020)', 'authors': 'Ronen', 'authors_str': 'Ronen', 'venue': '', 'url': '', 'abstract': '', 'year': 2020, 'citations': 1, 'doi': '', 'external_id': 'work:ronen:2020', 'isSeed': False}}, {'data': {'id': 'work:benzing:2019', 'label': 'Benzing (2019)', 'title': 'Benzing (2019)', 'authors': 'Benzing', 'authors_str': 'Benzing', 'venue': '', 'url': '', 'abstract': '', 'year': 2019, 'citations': 1, 'doi': '', 'external_id': 'work:benzing:2019', 'isSeed': False}}, {'data': {'id': 'work:dederer-and-singer:2019', 'label': 'Dederer and Singer (2019)', 'title': 'Dederer and Singer (2019)', 'authors': 'Dederer and Singer', 'authors_str': 'Dederer and Singer', 'venue': '', 'url': '', 'abstract': '', 'year': 2019, 'citations': 1, 'doi': '', 'external_id': 'work:dederer-and-singer:2019', 'isSeed': False}}, {'data': {'id': 'work:eritrea-ethiopia-claims-commission:2003:b228fd629536', 'label': 'Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia’s Claim 4 XXVI RIAA 73 (1 July 2003) para 38.', 'title': 'Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia’s Claim 4 XXVI RIAA 73 (1 July 2003) para 38.', 'authors': 'Eritrea-Ethiopia Claims Commission', 'authors_str': 'Eritrea-Ethiopia Claims Commission', 'venue': '', 'url': '', 'abstract': '', 'year': 2003, 'citations': 1, 'doi': '', 'external_id': 'work:eritrea-ethiopia-claims-commission:2003:b228fd629536', 'isSeed': False}}, {'data': {'id': 'work:icj:2005:69fcfde8bc04', 'label': 'Case concerning Armed Activities on the Territory of the Congo (DRC v Uganda), Judgment, ICJ [2005] Reports, [62].', 'title': 'Case concerning Armed Activities on the Territory of the Congo (DRC v Uganda), Judgment, ICJ [2005] Reports, [62].', 'authors': 'ICJ', 'authors_str': 'ICJ', 'venue': '', 'url': '', 'abstract': '', 'year': 2005, 'citations': 1, 'doi': '', 'external_id': 'work:icj:2005:69fcfde8bc04', 'isSeed': False}}, {'data': {'id': 'work:icj:1949:6eacec40e92b', 'label': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'title': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'authors': 'ICJ', 'authors_str': 'ICJ', 'venue': '', 'url': '', 'abstract': '', 'year': 1949, 'citations': 2, 'doi': '', 'external_id': 'work:icj:1949:6eacec40e92b', 'isSeed': False}}, {'data': {'id': 'work:kinsch:2009:1bd4df242627', 'label': 'Kinsch (2009) 436.', 'title': 'Kinsch (2009) 436.', 'authors': 'Kinsch', 'authors_str': 'Kinsch', 'venue': '', 'url': '', 'abstract': '', 'year': 2009, 'citations': 1, 'doi': '', 'external_id': 'work:kinsch:2009:1bd4df242627', 'isSeed': False}}, {'data': {'id': 'work:smith:2022:05ef9e0b2e70', 'label': 'Smith, Evidentiary Thresholds in Cyber Attribution (2022) 77-81.', 'title': 'Smith, Evidentiary Thresholds in Cyber Attribution (2022) 77-81.', 'authors': 'Smith', 'authors_str': 'Smith', 'venue': '', 'url': '', 'abstract': '', 'year': 2022, 'citations': 1, 'doi': '', 'external_id': 'work:smith:2022:05ef9e0b2e70', 'isSeed': False}}], 'edges': [{'data': {'id': 'edge:cites:1', 'source': 'doc:4', 'target': 'work:smith:2022', 'weight': 1.0, 'context': 'This paper treats Smith as the baseline for evidentiary confidence across documents.', 'citation_anchor': '(Smith 2022)', 'raw': '(Smith 2022)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 1}}, {'data': {'id': 'edge:cites:2', 'source': 'doc:4', 'target': 'work:ronen:2020', 'weight': 1.0, 'context': 'It also cites Ronen’s overview of attribution standards.', 'citation_anchor': '(Ronen 2020)', 'raw': '(Ronen 2020)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 2}}, {'data': {'id': 'edge:cites:3', 'source': 'doc:4', 'target': 'work:benzing:2019', 'weight': 1.0, 'context': 'Cooperation duties are discussed as a mitigation technique.', 'citation_anchor': '(Benzing 2019)', 'raw': '(Benzing 2019)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 2}}, {'data': {'id': 'edge:cites:4', 'source': 'doc:4', 'target': 'work:dederer-and-singer:2019', 'weight': 1.0, 'context': 'It borrows a causality and due diligence lens for cyber operations.', 'citation_anchor': '(Dederer and Singer 2019)', 'raw': '(Dederer and Singer 2019)', 'citation_type': 'in_text', 'footnote_number': None, 'page_index': 3}}, {'data': {'id': 'edge:cites:5', 'source': 'doc:4', 'target': 'work:eritrea-ethiopia-claims-commission:2003:b228fd629536', 'weight': 1.0, 'context': '42', 'citation_anchor': '42', 'raw': 'Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia’s Claim 4 XXVI RIAA 73 (1 July 2003) para 38.', 'citation_type': 'footnote', 'footnote_number': 42, 'page_index': 4}}, {'data': {'id': 'edge:cites:6', 'source': 'doc:4', 'target': 'work:icj:2005:69fcfde8bc04', 'weight': 1.0, 'context': '43', 'citation_anchor': '43', 'raw': 'Case concerning Armed Activities on the Territory of the Congo (DRC v Uganda), Judgment, ICJ [2005] Reports, [62].', 'citation_type': 'footnote', 'footnote_number': 43, 'page_index': 4}}, {'data': {'id': 'edge:cites:7', 'source': 'doc:4', 'target': 'work:icj:1949:6eacec40e92b', 'weight': 1.0, 'context': '44', 'citation_anchor': '44', 'raw': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'citation_type': 'footnote', 'footnote_number': 44, 'page_index': 5}}, {'data': {'id': 'edge:cites:8', 'source': 'doc:4', 'target': 'work:icj:1949:6eacec40e92b', 'weight': 1.0, 'context': '45', 'citation_anchor': '45', 'raw': 'Corfu (n 44), 17.', 'citation_type': 'footnote', 'footnote_number': 45, 'page_index': 5}}, {'data': {'id': 'edge:cites:9', 'source': 'doc:4', 'target': 'work:kinsch:2009:1bd4df242627', 'weight': 1.0, 'context': '46', 'citation_anchor': '46', 'raw': 'Kinsch (2009) 436.', 'citation_type': 'footnote', 'footnote_number': 46, 'page_index': 6}}, {'data': {'id': 'edge:cites:10', 'source': 'doc:4', 'target': 'work:smith:2022:05ef9e0b2e70', 'weight': 1.0, 'context': '47', 'citation_anchor': '47', 'raw': 'Smith, Evidentiary Thresholds in Cyber Attribution (2022) 77-81.', 'citation_type': 'footnote', 'footnote_number': 47, 'page_index': 6}}]}], 'global': {'seedId': 'global', 'priorIds': [], 'derivativeIds': [], 'scope': 'global', 'build_ms': 0, 'nodes': [{'data': {'id': 'doc:1', 'label': 'source', 'title': 'source', 'authors': '', 'authors_str': '', 'venue': '', 'url': '', 'abstract': '', 'year': 0, 'citations': 0, 'doi': '', 'external_id': 'doc:1', 'isSeed': True}}, {'data': {'id': 'doc:2', 'label': 'source', 'title': 'source', 'authors': '', 'authors_str': '', 'venue': '', 'url': '', 'abstract': '', 'year': 0, 'citations': 0, 'doi': '', 'external_id': 'doc:2', 'isSeed': True}}, {'data': {'id': 'doc:3', 'label': 'source', 'title': 'source', 'authors': '', 'authors_str': '', 'venue': '', 'url': '', 'abstract': '', 'year': 0, 'citations': 0, 'doi': '', 'external_id': 'doc:3', 'isSeed': True}}, {'data': {'id': 'doc:4', 'label': 'source', 'title': 'source', 'authors': '', 'authors_str': '', 'venue': '', 'url': '', 'abstract': '', 'year': 0, 'citations': 0, 'doi': '', 'external_id': 'doc:4', 'isSeed': True}}, {'data': {'id': 'gwork:smith:2022', 'label': 'Smith (2022)', 'title': 'Smith (2022)', 'authors': 'Smith', 'authors_str': 'Smith', 'venue': '', 'url': '', 'abstract': '', 'year': 2022, 'citations': 4, 'doi': '', 'external_id': 'gwork:smith:2022', 'isSeed': False}}, {'data': {'id': 'gwork:ronen:2020', 'label': 'Ronen (2020)', 'title': 'Ronen (2020)', 'authors': 'Ronen', 'authors_str': 'Ronen', 'venue': '', 'url': '', 'abstract': '', 'year': 2020, 'citations': 4, 'doi': '', 'external_id': 'gwork:ronen:2020', 'isSeed': False}}, {'data': {'id': 'gwork:kinsch:2009', 'label': 'Kinsch (2009)', 'title': 'Kinsch (2009)', 'authors': 'Kinsch', 'authors_str': 'Kinsch', 'venue': '', 'url': '', 'abstract': '', 'year': 2009, 'citations': 4, 'doi': '', 'external_id': 'gwork:kinsch:2009', 'isSeed': False}}, {'data': {'id': 'gwork:devaney:2016', 'label': 'Devaney (2016)', 'title': 'Devaney (2016)', 'authors': 'Devaney', 'authors_str': 'Devaney', 'venue': '', 'url': '', 'abstract': '', 'year': 2016, 'citations': 2, 'doi': '', 'external_id': 'gwork:devaney:2016', 'isSeed': False}}, {'data': {'id': 'gwork:chittaranjan-f-amerasinghe:2005', 'label': 'Chittaranjan F Amerasinghe, Evidence in International Litigation (Martinus Nijhoff 2005) 96-97.', 'title': 'Chittaranjan F Amerasinghe, Evidence in International Litigation (Martinus Nijhoff 2005) 96-97.', 'authors': 'Chittaranjan F Amerasinghe', 'authors_str': 'Chittaranjan F Amerasinghe', 'venue': '', 'url': '', 'abstract': '', 'year': 2005, 'citations': 3, 'doi': '', 'external_id': 'gwork:chittaranjan-f-amerasinghe:2005', 'isSeed': False}}, {'data': {'id': 'gwork:pulp-mills:2010', 'label': 'Pulp Mills (n 16), [163].', 'title': 'Pulp Mills (n 16), [163].', 'authors': 'Pulp Mills', 'authors_str': 'Pulp Mills', 'venue': '', 'url': '', 'abstract': '', 'year': 2010, 'citations': 1, 'doi': '', 'external_id': 'gwork:pulp-mills:2010', 'isSeed': False}}, {'data': {'id': 'gwork:dederer-and-singer:2019', 'label': "Hans-Georg Dederer and Tassilo Singer, 'Adverse Cyber Operations: Causality, Attribution, Evidence, and Due Diligence' (2019) 95 International Law Studies 430, 459.", 'title': "Hans-Georg Dederer and Tassilo Singer, 'Adverse Cyber Operations: Causality, Attribution, Evidence, and Due Diligence' (2019) 95 International Law Studies 430, 459.", 'authors': 'Dederer and Singer', 'authors_str': 'Dederer and Singer', 'venue': '', 'url': '', 'abstract': '', 'year': 2019, 'citations': 3, 'doi': '', 'external_id': 'gwork:dederer-and-singer:2019', 'isSeed': False}}, {'data': {'id': 'gwork:icj:1949', 'label': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'title': 'ICJ, Corfu Channel, Judgment of April 9th, 1949 (Merits) [1949] ICJ Rep 4, 17.', 'authors': 'ICJ', 'authors_str': 'ICJ', 'venue': '', 'url': '', 'abstract': '', 'year': 1949, 'citations': 3, 'doi': '', 'external_id': 'gwork:icj:1949', 'isSeed': False}}, {'data': {'id': 'gwork:foster:2010', 'label': 'Foster (2010)', 'title': 'Foster (2010)', 'authors': 'Foster', 'authors_str': 'Foster', 'venue': '', 'url': '', 'abstract': '', 'year': 2010, 'citations': 1, 'doi': '', 'external_id': 'gwork:foster:2010', 'isSeed': False}}, {'data': {'id': 'gwork:shelton:1988', 'label': 'Shelton (1988)', 'title': 'Shelton (1988)', 'authors': 'Shelton', 'authors_str': 'Shelton', 'venue': '', 'url': '', 'abstract': '', 'year': 1988, 'citations': 1, 'doi': '', 'external_id': 'gwork:shelton:1988', 'isSeed': False}}, {'data': {'id': 'gwork:varnava-and-others-v-turkey:2009', 'label': 'Varnava and Others v Turkey (2009)', 'title': 'Varnava and Others v Turkey (2009)', 'authors': 'Varnava and Others v Turkey', 'authors_str': 'Varnava and Others v Turkey', 'venue': '', 'url': '', 'abstract': '', 'year': 2009, 'citations': 1, 'doi': '', 'external_id': 'gwork:varnava-and-others-v-turkey:2009', 'isSeed': False}}, {'data': {'id': 'gwork:benzing:2019', 'label': 'Benzing (2019)', 'title': 'Benzing (2019)', 'authors': 'Benzing', 'authors_str': 'Benzing', 'venue': '', 'url': '', 'abstract': '', 'year': 2019, 'citations': 2, 'doi': '', 'external_id': 'gwork:benzing:2019', 'isSeed': False}}, {'data': {'id': 'gwork:ecthr:1978', 'label': 'ECtHR, Ireland v United Kingdom (Application No. 5310/71), Judgement, para 161.', 'title': 'ECtHR, Ireland v United Kingdom (Application No. 5310/71), Judgement, para 161.', 'authors': 'ECtHR', 'authors_str': 'ECtHR', 'venue': '', 'url': '', 'abstract': '', 'year': 1978, 'citations': 1, 'doi': '', 'external_id': 'gwork:ecthr:1978', 'isSeed': False}}, {'data': {'id': 'gwork:varnava:2009', 'label': 'Varnava (n 29) para 182.', 'title': 'Varnava (n 29) para 182.', 'authors': 'Varnava', 'authors_str': 'Varnava', 'venue': '', 'url': '', 'abstract': '', 'year': 2009, 'citations': 1, 'doi': '', 'external_id': 'gwork:varnava:2009', 'isSeed': False}}, {'data': {'id': 'gwork:eritrea-ethiopia-claims-commission:2003', 'label': 'Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia’s Claim 4 XXVI RIAA 73 (1 July 2003) para 38.', 'title': 'Eritrea-Ethiopia Claims Commission, Partial Award: Prisoners of War - Ethiopia’s Claim 4 XXVI RIAA 73 (1 July 2003) para 38.', 'authors': 'Eritrea-Ethiopia Claims Commission', 'authors_str': 'Eritrea-Ethiopia Claims Commission', 'venue': '', 'url': '', 'abstract': '', 'year': 2003, 'citations': 1, 'doi': '', 'external_id': 'gwork:eritrea-ethiopia-claims-commission:2003', 'isSeed': False}}, {'data': {'id': 'gwork:icj:2005', 'label': 'Case concerning Armed Activities on the Territory of the Congo (DRC v Uganda), Judgment, ICJ [2005] Reports, [62].', 'title': 'Case concerning Armed Activities on the Territory of the Congo (DRC v Uganda), Judgment, ICJ [2005] Reports, [62].', 'authors': 'ICJ', 'authors_str': 'ICJ', 'venue': '', 'url': '', 'abstract': '', 'year': 2005, 'citations': 1, 'doi': '', 'external_id': 'gwork:icj:2005', 'isSeed': False}}], 'edges': [{'data': {'id': 'edge:global:cites:1', 'source': 'doc:1', 'target': 'gwork:smith:2022', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:2', 'source': 'doc:1', 'target': 'gwork:ronen:2020', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:3', 'source': 'doc:1', 'target': 'gwork:kinsch:2009', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:4', 'source': 'doc:1', 'target': 'gwork:devaney:2016', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:5', 'source': 'doc:1', 'target': 'gwork:chittaranjan-f-amerasinghe:2005', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:6', 'source': 'doc:1', 'target': 'gwork:pulp-mills:2010', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:7', 'source': 'doc:1', 'target': 'gwork:dederer-and-singer:2019', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:8', 'source': 'doc:1', 'target': 'gwork:icj:1949', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:9', 'source': 'doc:2', 'target': 'gwork:smith:2022', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:10', 'source': 'doc:2', 'target': 'gwork:foster:2010', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:11', 'source': 'doc:2', 'target': 'gwork:devaney:2016', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:12', 'source': 'doc:2', 'target': 'gwork:ronen:2020', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:13', 'source': 'doc:2', 'target': 'gwork:icj:1949', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:14', 'source': 'doc:2', 'target': 'gwork:dederer-and-singer:2019', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:15', 'source': 'doc:2', 'target': 'gwork:chittaranjan-f-amerasinghe:2005', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:16', 'source': 'doc:2', 'target': 'gwork:kinsch:2009', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:17', 'source': 'doc:3', 'target': 'gwork:smith:2022', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:18', 'source': 'doc:3', 'target': 'gwork:shelton:1988', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:19', 'source': 'doc:3', 'target': 'gwork:varnava-and-others-v-turkey:2009', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:20', 'source': 'doc:3', 'target': 'gwork:benzing:2019', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:21', 'source': 'doc:3', 'target': 'gwork:ecthr:1978', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:22', 'source': 'doc:3', 'target': 'gwork:varnava:2009', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:23', 'source': 'doc:3', 'target': 'gwork:kinsch:2009', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:24', 'source': 'doc:3', 'target': 'gwork:ronen:2020', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:25', 'source': 'doc:3', 'target': 'gwork:chittaranjan-f-amerasinghe:2005', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:26', 'source': 'doc:4', 'target': 'gwork:smith:2022', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:27', 'source': 'doc:4', 'target': 'gwork:ronen:2020', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:28', 'source': 'doc:4', 'target': 'gwork:benzing:2019', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:29', 'source': 'doc:4', 'target': 'gwork:dederer-and-singer:2019', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:30', 'source': 'doc:4', 'target': 'gwork:eritrea-ethiopia-claims-commission:2003', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:31', 'source': 'doc:4', 'target': 'gwork:icj:2005', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:32', 'source': 'doc:4', 'target': 'gwork:icj:1949', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}, {'data': {'id': 'edge:global:cites:33', 'source': 'doc:4', 'target': 'gwork:kinsch:2009', 'weight': 1.0, 'context': '', 'citation_anchor': '', 'raw': '', 'citation_type': 'aggregated', 'footnote_number': None, 'page_index': None}}]}}


# result =mistral_batch_references(pdf_paths=dd)
# print(result)

# outputs= ocr_single_pdf_structured(
#     pdf_path='C:\\Users\\luano\\Zotero\\storage\\2DFBFQRI\\Mikanagi and Macak - 2020 - Attribution of cyber operations an  international law perspective on the park jin hyok case.pdf'
#   )
# #
# print(outputs)

# data=references_to_graph(structured_references=outputs,source_doc_id="a3467")

# data =references_local_global_graph(result)
#
# launch_graph(data)
#
#
def inspect_structured_references(processed, cap=12):
    """
    ###1. accept processed as list of dicts
    ###2. extract structured_references.references
    ###3. cap references into payloads and print
    """
    if not isinstance(processed, list) or not processed:
        print("No processed entries.")
        input("wait to check")
        return []

    all_payloads = []

    for i, item in enumerate(processed):
        if not isinstance(item, dict):
            continue

        sr = item.get("structured_references") or {}
        refs = sr.get("references") or []
        if not refs:
            continue

        batch = []
        for ref in refs:
            batch.append(ref)
            if len(batch) >= int(cap):
                all_payloads.append({
                    "processed_index": i,
                    "count": len(batch),
                    "references": batch,
                })
                batch = []

        if batch:
            all_payloads.append({
                "processed_index": i,
                "count": len(batch),
                "references": batch,
            })

    for j, payload in enumerate(all_payloads, start=1):
        print(
            f"\nPAYLOAD {j}/{len(all_payloads)} "
            f"| processed_index={payload['processed_index']} "
            f"| count={payload['count']}"
        )
        for k, ref in enumerate(payload["references"], start=1):
            print(
                f"  {k:02d}. "
                f"{ref.get('citation_type')} | "
                f"{ref.get('citation_anchor')} | "
                f"{ref.get('author')} ({ref.get('year')}) | "
                f"p={ref.get('page_index')} | "
                f"{ref.get('title')}"
            )

    input("wait to check")
    return all_payloads

df, raw, _ = load_data_from_source_for_widget(collection_name=collection_name,
                                              # cache=False
                                              )
df_test = df.head(1).copy()
print(df_test["pdf_path"])

d=process_pdf(df_test["pdf_path"][0])


# result = mistral_batch_references(df_test)
# outputs= ocr_single_pdf_structured(
#     pdf_path=df_test["pdf_path"][0]
#   )
# print(outputs)

# inspect_structured_references(result['processed'])

# print(result['processed'][0]["structured_references"])

# print(result['processed'])
# data =references_local_global_graph(result)
# print(data)
# #
# launch_graph(data)