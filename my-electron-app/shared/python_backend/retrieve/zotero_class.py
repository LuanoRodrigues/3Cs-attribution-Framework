
import hashlib
import itertools
import string
import tempfile
import sys
from pathlib import Path

from html.parser import HTMLParser

from rich.progress import (
    Progress,
    BarColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
    MofNCompleteColumn,
)

import tkinter as tk
from tkinter import ttk

import requests

from rich.progress import TextColumn


from selenium.common import TimeoutException
from selenium.webdriver.support.wait import WebDriverWait

try:
    from PDF_parsing.PDF_papers_parser import extract_intro_conclusion_pdf_text, check_keyword_details_pdf, process_pdf, \
        extract_content_for_keywords, _notes_to_lines, find_text_page_and_section
except Exception:
    from retrieve.data_processing import extract_intro_conclusion_pdf_text, check_keyword_details_pdf, process_pdf, \
        extract_content_for_keywords

    def find_text_page_and_section(*_args, **_kwargs):
        return {}

    def _notes_to_lines(notes):
        if notes is None:
            return []
        if isinstance(notes, str):
            return [ln.strip() for ln in notes.splitlines() if ln.strip()]
        if isinstance(notes, list):
            return [str(x).strip() for x in notes if str(x).strip()]
        return [str(notes).strip()] if str(notes).strip() else []

try:
    from zotero_module.llm_adapter import (
        call_models,
        call_openai_api,
        _process_batch_for,
        fetch_pdf_link,
        _process_batches_for,
        call_models_na,
        get_batch_root,
        safe_name,
    )
except Exception:
    def call_models(*_args, **_kwargs):
        return {}

    def call_openai_api(*_args, **_kwargs):
        return {}

    def _process_batch_for(*_args, **_kwargs):
        return False

    def call_models_na(*_args, **_kwargs):
        return {}

    def get_batch_root(*_args, **_kwargs):
        return Path.cwd() / "state" / "manual_batches"

    def safe_name(value, maxlen: int = 120):
        s = str(value or "").strip().replace("/", "_").replace("\\", "_")
        return (s[:maxlen] or "untitled")

    def fetch_pdf_link(*_args, **_kwargs):
        return ""

    def _process_batches_for(*args, **kwargs):
        return _process_batch_for(*args, **kwargs)


from pyzotero import zotero, zotero_errors

from tqdm import tqdm
from datetime import datetime, timezone

from bs4 import BeautifulSoup

import time

import json
import os
import pandas as pd
from pydantic import Field, BaseModel
from tabulate import tabulate

import undetected_chromedriver as uc

from selenium.webdriver.common.by import By

from selenium.webdriver.support import expected_conditions as EC

import logging

try:
    from PDF_parsing.thematic_functions import process_rq_theme_claims, \
        extract_themes_and_hierarchy_by_rq, regroup_all_rqs_from_manifest
except Exception:
    def process_rq_theme_claims(*_args, **_kwargs):
        return {"status": "unavailable", "message": "thematic_functions backend unavailable"}

    def extract_themes_and_hierarchy_by_rq(*_args, **_kwargs):
        return {"manifest": {"path": None}}

    def regroup_all_rqs_from_manifest(*_args, **_kwargs):
        return {}
try:
    from scrapping.Data_collection_automation.crawler_downloaders import digital_commons_download_pdf, \
        download_cambridge_pdf, downloading_metadata, download_elgar_pdf, \
        download_jstor_pdf, ssrn_downloader, heinonline_download_pdf, \
        download_ieee_pdf, download_proquest_pdf, scrape_sage_article_to_pdf, scrape_tand_article, download_brill, \
        scrape_oup_article
    from scrapping.Data_collection_automation.helpers import initiate_browser
except Exception:
    def _missing_scrape_backend(*_args, **_kwargs):
        raise RuntimeError("scrapping backend is unavailable in this runtime.")

    digital_commons_download_pdf = _missing_scrape_backend
    download_cambridge_pdf = _missing_scrape_backend
    downloading_metadata = _missing_scrape_backend
    download_elgar_pdf = _missing_scrape_backend
    download_jstor_pdf = _missing_scrape_backend
    ssrn_downloader = _missing_scrape_backend
    heinonline_download_pdf = _missing_scrape_backend
    download_ieee_pdf = _missing_scrape_backend
    download_proquest_pdf = _missing_scrape_backend
    scrape_sage_article_to_pdf = _missing_scrape_backend
    scrape_tand_article = _missing_scrape_backend
    download_brill = _missing_scrape_backend
    scrape_oup_article = _missing_scrape_backend
    initiate_browser = _missing_scrape_backend

try:
    from tests_dirs.data_loader_widget import process_single_zotero_item_for_df, \
        get_zotero_cache_filepath, MAIN_APP_CACHE_DIR, normalise_df_data
except Exception:
    MAIN_APP_CACHE_DIR = Path.cwd() / "cache"
    MAIN_APP_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def process_single_zotero_item_for_df(item_data_block, item_key, **_kwargs):
        data = item_data_block or {}
        return {
            "key": str(data.get("key") or item_key or ""),
            "title": str(data.get("title") or ""),
            "year": str(data.get("date") or ""),
            "authors": "",
            "publicationTitle": str(data.get("publicationTitle") or ""),
            "url": str(data.get("url") or ""),
            "source": "",
            "controlled_vocabulary_terms": [],
            "citations": 0,
            "item_type": str(data.get("itemType") or ""),
            "abstract": str(data.get("abstractNote") or ""),
            "institution": "",
            "country": "",
            "place": "",
            "affiliation": "",
            "word_count_for_attribution": 0,
            "attribution_mentions": 0,
            "department": "",
            "user_decision": "",
            "user_notes": "",
        }

    def get_zotero_cache_filepath(collection_name, cache_dir):
        safe = str(collection_name or "collection").replace("/", "_")
        return Path(cache_dir) / f"{safe}.pkl"

    def normalise_df_data(df):
        return df

logging.basicConfig(level=logging.INFO,
                    format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

import logging
import pickle

from pathlib import Path

from typing import Optional, Dict, Any, Tuple, List, Union, Callable, Set
import textwrap


class PolicyClusterMatch(BaseModel):
    quote: str = Field(min_length=6, max_length=600)
    paraphrase: str = Field(min_length=6, max_length=300)
    cluster_match: List[str] = Field(min_items=1, max_items=3)
    function_summary: str = Field(min_length=6, max_length=200)
    risk_if_missing: str = Field(min_length=6, max_length=200)
    illustrative_skills: List[str] = Field(min_items=1, max_items=3)
    researcher_comment: str = Field(min_length=6, max_length=600)
    relevance_score: int = Field(ge=1, le=5)


class PolicyClusterItemResult(BaseModel):
    metadata: Dict[str, Any]
    matches_list: List[PolicyClusterMatch]


def _norm_space(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip())

def _safe_collection_name(name: str) -> str:
    """
    Windows/Unix-safe slug for folder/filenames.
    - strips/normalizes control & reserved chars: \ / : * ? " < > |
    - collapses whitespace to '_'
    - keeps only [A-Za-z0-9._-]
    - trims to a reasonable length
    """
    if not isinstance(name, str):
        name = str(name or "")
    s = name.strip()
    s = re.sub(r'[\\/:*?"<>|]+', '_', s)   # reserved on Windows
    s = re.sub(r'\s+', '_', s)             # collapse spaces
    s = re.sub(r'[^A-Za-z0-9._-]+', '_', s)
    return s.strip('_')[:120] or "collection"

def get_note_meta_citation_country_place(zot,item_key: str) -> dict:
    """
    Read all child notes of a Zotero item and extract:
      - citation (int): best available from Google Scholar "Cited by N",
                        Overton "Citations</th><td>N</td>", or WoS "Total Times Cited: N".
      - country (str|None): from Overton "Country</th><td>CountryName</td>" or loose "Country: X".
      - place (str|None): from HTML table cells labelled 'Place' or 'Location' if present.

    Args:
        zotero_client: a PyZotero-like client with .item_children(item_key) or .children(item_key)
        item_key (str): Zotero parent item key

    Returns:
        dict: {"citation": int|None, "country": str|None, "place": str|None}
    """
    import re

    # --- helpers ---
    def _get_children_notes(client, key: str):
        # Try common PyZotero methods in order; fall back to empty list.
        for meth in ("item_children", "children", "items"):
            fn = getattr(client, meth, None)
            if callable(fn):
                try:
                    children = fn(key) if meth != "items" else fn()
                    break
                except Exception:
                    continue
        else:
            return []

        notes = []
        for it in children or []:
            data = it.get("data") or {}
            if data.get("itemType") == "note":
                notes.append(data)
        return notes

    def _strip_html(s: str) -> str:
        s = re.sub(r"(?is)<br\s*/?>", "\n", s)
        s = re.sub(r"(?is)<hr\s*/?>", "\n", s)
        s = re.sub(r"(?is)<[^>]+>", " ", s)
        return re.sub(r"\s+", " ", s).strip()

    def _to_int(maybe_num: str):
        try:
            return int(re.sub(r"[^\d]", "", maybe_num))
        except Exception:
            return None

    # Regexes (compiled once)
    rx_google = re.compile(r"(?i)\bCited\s*by\s*([0-9][0-9,]*)")
    rx_overton_citations_html = re.compile(r"(?is)>Citations</th>\s*<td>\s*([0-9][0-9,]*)\s*<")
    rx_overton_country_html = re.compile(r"(?is)>Country</th>\s*<td>\s*([^<]+?)\s*<")
    rx_place_html = re.compile(r"(?is)>(?:Place|Location)</th>\s*<td>\s*([^<]+?)\s*<")
    rx_wos_total = re.compile(r"(?is)\bTotal\s*Times\s*Cited\s*[:&nbsp;]*\s*([0-9][0-9,]*)")
    rx_wos_core = re.compile(r"(?is)\bTimes\s*Cited\s*in\s*Web\s*of\s*Science\s*Core\s*Collection\s*[:&nbsp;]*\s*([0-9][0-9,]*)")
    rx_country_loose = re.compile(r"(?i)\bCountry\s*[:\-]\s*([A-Za-z .'\-()]+)")

    notes = _get_children_notes(zot, item_key)

    best_citation = None
    country = None
    place = None

    for note in notes:
        raw = note.get("note", "") or ""
        text = _strip_html(raw)

        # ---- Google Scholar style ----
        m = rx_google.search(text)
        if m:
            val = _to_int(m.group(1))
            if val is not None:
                best_citation = max(best_citation or 0, val)

        # ---- Overton style (HTML table) ----
        m = rx_overton_citations_html.search(raw)
        if m:
            val = _to_int(m.group(1))
            if val is not None:
                best_citation = max(best_citation or 0, val)
        m = rx_overton_country_html.search(raw)
        if m and not country:
            country = m.group(1).strip()
        m = rx_place_html.search(raw)
        if m and not place:
            place = m.group(1).strip()

        # Loose country if still missing
        if not country:
            m = rx_country_loose.search(text)
            if m:
                country = m.group(1).strip()

        # ---- WoS style ----
        # Prefer Total Times Cited, else fall back to Core Collection.
        m_total = rx_wos_total.search(raw) or rx_wos_total.search(text)
        if m_total:
            val = _to_int(m_total.group(1))
            if val is not None:
                best_citation = max(best_citation or 0, val)
        else:
            m_core = rx_wos_core.search(raw) or rx_wos_core.search(text)
            if m_core:
                val = _to_int(m_core.group(1))
                if val is not None:
                    best_citation = max(best_citation or 0, val)




    return {
        "citation": best_citation,
        "country": country,
        "place": place,
    }


def parse_citation_count(extra_str: str | None) -> int:
    """
    Extracts and returns the highest citation count found in a string.
    Supports numbers with comma separators and labels such as:
      - "123 citations"
      - "Cited by: 1,234"
      - "56 (WoS)" or "789 citations (Google Scholar)"
    If nothing valid is found, returns 0.
    """
    if not isinstance(extra_str, str):
        return 0

    # Regex patterns from most‐generic to most‐specific
    patterns = [
        # e.g. "1,234 citations" or "57 citations"
        r'([\d,]+)\s+citations?\b',
        # e.g. "Cited by: 256" or "Cited by: 1,000"
        r'Cited\s+by\s*:\s*([\d,]+)',
        # e.g. "289 (WoS)" or "447 citations (Semantic Scholar)"
        r'([\d,]+)\s*\(\s*(?:Scopus|WoS|Web of Science|Crossref|Semantic Scholar|Google Scholar|PubMed|DOI|ESCI|SSCI|AHCI|SCI)\s*\)'
    ]

    for pat in patterns:
        try:
            raw_matches = re.findall(pat, extra_str, flags=re.IGNORECASE)  # :contentReference[oaicite:0]{index=0}
        except re.error as err:
            logging.debug(f"Invalid regex '{pat}': {err}")
            continue

        if raw_matches:
            # Clean out commas and convert to ints
            counts = []
            for m in raw_matches:
                num = m.replace(',', '')
                if num.isdigit():
                    counts.append(int(num))
            if counts:
                return max(counts)

    return 0
# NEW: add this helper just above or inside your Zotero class file (module-level is fine)
def infer_source(item: dict) -> str:
    """
    Type-aware source unifier with robust fallbacks.
    Priority (generic fallback order): publicationTitle → publisher → institution → university → seriesTitle → proceedings/meeting/conference → repository → website/blog → hostname(url).
    Adds explicit handling for 'preprint' (prefer repository, or infer from URL).
    """
    # --- helpers ---
    def _get(d: dict, *keys: str) -> str:
        for k in keys:
            v = d.get(k, "")
            s = _norm_space(v)
            if s:
                return s
        return ""

    def _hostname_from_url(u: str) -> str:
        try:
            from urllib.parse import urlparse
            host = _norm_space(u)
            if not host:
                return ""
            netloc = urlparse(host).netloc or urlparse("http://" + host).netloc
            netloc = netloc.lower().strip()
            if not netloc:
                return ""
            # prettify common repositories
            pretties = {
                "arxiv.org": "arXiv",
                "biorxiv.org": "bioRxiv",
                "medrxiv.org": "medRxiv",
                "osf.io": "OSF",
                "papers.ssrn.com": "SSRN",
                "ssrn.com": "SSRN",
                "zenodo.org": "Zenodo",
                "researchgate.net": "ResearchGate",
                "hal.science": "HAL",
                "openreview.net": "OpenReview",
                "ceur-ws.org": "CEUR-WS",
                "figshare.com": "Figshare",
                "ieeexplore.ieee.org": "IEEE Xplore",
                "acm.org": "ACM",
                "link.springer.com": "Springer",
                "doi.org": "DOI",
            }
            for k, v in pretties.items():
                if netloc.endswith(k):
                    return v
            # fallback to bare hostname without www
            return netloc[4:] if netloc.startswith("www.") else netloc
        except Exception:
            return ""

    # --- extract data ---
    data = (item or {}).get("data", {}) if isinstance(item, dict) else (item or {})
    itype = str(data.get("itemType", "")).lower()

    # Zotero field variants / synonyms
    publicationTitle = _get(data, "publicationTitle")
    publisher = _get(data, "publisher", "distributor", "institutionPublisher", "placePublisher")
    institution = _get(data, "institution", "authority", "organisation", "organization")
    university = _get(data, "university")
    seriesTitle = _get(data, "seriesTitle", "series")
    proceedingsTitle = _get(data, "proceedingsTitle")
    meetingName = _get(data, "meetingName")
    conferenceName = _get(data, "conferenceName")
    journalAbbrev = _get(data, "journalAbbreviation")
    # bookTitle = _get(data, "bookTitle")
    # blogTitle = _get(data, "blogTitle", "websiteTitle", "websiteType")
    repository = _get(data, "repository")
    url = _get(data, "url")

    # --- type-specific priority ---
    def _choose(*cands: str) -> str:
        for c in cands:
            if c:
                return c
        return ""

    if itype in {"journalarticle", "magazinearticle", "newspaperarticle"}:
        cand = _choose(publicationTitle, journalAbbrev, publisher, seriesTitle)
        if cand:
            return cand

    elif itype in {"conferencepaper", "paperconference"}:
        cand = _choose(proceedingsTitle, conferenceName, meetingName, publicationTitle, publisher, institution, university, seriesTitle)
        if cand:
            return cand

    elif itype in {"presentation"}:
        cand = _choose(meetingName, proceedingsTitle, institution, publisher, publicationTitle)
        if cand:
            return cand

    elif itype in {"thesis"}:
        cand = _choose(university, institution, publisher, seriesTitle)
        if cand:
            return cand

    elif itype in {"report"}:
        # Some exports bury 'institution'; ensure it wins here.
        cand = _choose(publicationTitle, publisher, institution, university, seriesTitle)
        if cand:
            return cand

    elif itype in {"booksection"}:
        cand = _choose(
            # bookTitle,
                       publicationTitle, seriesTitle, publisher)
        if cand:
            return cand

    elif itype in {"webpage", "blogpost"}:
        cand = _choose(
            # blogTitle,
            publisher)
        if cand:
            return cand

    elif itype in {"preprint"}:
        # Prefer repository; if missing, infer from URL; otherwise fall back generically.
        repo = repository or _hostname_from_url(url)
        cand = _choose(repo, publicationTitle, publisher, institution, university, seriesTitle)
        if cand:
            return cand

    # --- generic fallback order (per your requested priority) ---
    cand = _choose(
        publicationTitle,
        publisher,
        institution,
        university,
        seriesTitle,
        proceedingsTitle,
        meetingName,
        conferenceName,
        repository or "",
        # blogTitle,
    )
    if cand:
        return cand

    # final fallback: hostname from URL (if any)
    host = _hostname_from_url(url)
    if host:
        return host

    return False
def _extract_affiliations_entities_block(html: str, require_h3: bool = True) -> tuple[str | None, str]:
    """
    Extract the block starting at <h2>Affiliations & Entities</h2> up to (but not including) the next <h2>.
    If `require_h3` is True (default), only extract when an <h3> immediately under that section exists
    (e.g., <h3>Entities Mentioned</h3>). If such an <h3> is not found, return (None, original_html) and ignore.

    Returns:
        (block_html, remaining_html)
        block_html is None if the anchor h2 is absent OR (require_h3 and no qualifying h3 exists).
    """
    if not html:
        return None, html or ""

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")

    # 1) Locate the anchor <h2>
    anchor = None
    for h2 in soup.find_all("h2"):
        if h2.get_text(" ", strip=True).casefold() == "affiliations & entities":
            anchor = h2
            break
    if anchor is None:
        return None, html  # no section -> ignore

    # 2) Scan siblings until next <h2>, check for a qualifying <h3>
    collected = [anchor]
    saw_h3 = False
    for sib in anchor.find_next_siblings():
        name = (getattr(sib, "name", "") or "").lower()
        if name == "h2":
            break
        if name == "h3":
            # Require an <h3> under this section (e.g., "Entities Mentioned").
            # We accept any <h3> if require_h3=True; tighten if you want exact label matching.
            saw_h3 = True
        collected.append(sib)

    # 3) If require_h3 and none was found, ignore this section
    if require_h3 and not saw_h3:
        return None, html

    # 4) Build extracted HTML and remove from original
    block_html = "".join(str(n) for n in collected)
    for n in collected:
        try:
            n.decompose()
        except Exception:
            pass

    remaining_html = str(soup)
    return block_html, remaining_html
# Add this **method** inside your Zotero class
def move_affiliations_entities_to_payload(self,
                                          collection_name: str,
                                          tag_source: str = "keyword_analysis:attribution",
                                          tag_target: str = "payload_note",
                                          dry_run: bool = False) -> dict:
    """
    For every item in `collection_name`, locate its child note tagged `tag_source`,
    extract the <h2>Affiliations & Entities</h2> block, append it verbatim to the
    note tagged `tag_target` (creating one if absent), then remove that block from
    the source note and update it.

    Args:
        collection_name: Zotero collection to process.
        tag_source: the source note tag (default 'keyword_analysis:attribution').
        tag_target: the target note tag (default 'payload_note').
        dry_run: if True, do not write any changes; only report what would happen.

    Returns:
        dict summary with counts and per-item results.
    """
    from bs4 import BeautifulSoup  # ensure available alongside other class methods
    results = []
    touched = 0
    created_targets = 0
    skipped_no_source = 0
    skipped_no_block = 0
    append_dedup_skips = 0

    items = self.get_all_items(collection_name=collection_name)  # :contentReference[oaicite:0]{index=0}
    for it in items:
        item_key = it.get("key")
        try:
            children = self.zot.children(item_key)
        except Exception as e:
            results.append({"item_key": item_key, "error": f"children fetch failed: {e}"})
            continue

        # locate the first source note with tag_source
        src_notes = [
            ch for ch in children
            if ch.get("data", {}).get("itemType") == "note"
            and any(t.get("tag") == tag_source for t in ch.get("data", {}).get("tags", []))
        ]
        if not src_notes:
            skipped_no_source += 1
            results.append({"item_key": item_key, "action": "skip", "reason": "no source note"})
            continue

        src = src_notes[0]
        src_html = src["data"].get("note", "") or ""

        # extract the block
        block_html, remaining_html = _extract_affiliations_entities_block(src_html)
        if not block_html:
            skipped_no_block += 1
            results.append({"item_key": item_key, "action": "skip", "reason": "no <h2>Affiliations & Entities</h2> block"})
            continue

        # append to payload_note (create if absent)
        appended = False
        created_now = False
        if not dry_run:
            # append_info_note_log handles creation and dedup internally.  :contentReference[oaicite:1]{index=1}
            before_children = len([c for c in children if c.get("data", {}).get("itemType") == "note"])
            appended = self.append_info_note_log(item_key=item_key, snippet=block_html)
            after_children = len([c for c in self.zot.children(item_key) if c.get("data", {}).get("itemType") == "note"])
            created_now = (after_children > before_children)
        else:
            # simulate success; cannot detect dedup without reading payload note HTML
            appended = True

        if appended:
            # update the source note by removing the extracted block
            if not dry_run:
                tags = src["data"].get("tags", []) or []
                # keep source tag, just update content
                update_note_zotero(src, tags, remaining_html, self.zot)  # :contentReference[oaicite:2]{index=2}
                touched += 1
                if created_now:
                    created_targets += 1
            results.append({"item_key": item_key, "action": "moved", "created_payload_note": created_now})
        else:
            append_dedup_skips += 1
            results.append({"item_key": item_key, "action": "skip", "reason": "payload_note dedup (already contained block)"})

    summary = {
        "collection": collection_name,
        "processed_items": len(items),
        "moved_blocks": touched,
        "created_payload_notes": created_targets,
        "skipped_no_source_note": skipped_no_source,
        "skipped_no_affiliations_block": skipped_no_block,
        "skipped_dedup_payload": append_dedup_skips,
        "details": results,
    }
    return summary

def merge_code_evidence(*responses):
    """
    Merge multiple response dicts (each like {'code_evidence': {...}})
    into a single dict with a unified 'code_evidence'.
    Later responses override earlier ones on key collisions.
    """
    merged = {"code_evidence": {}}
    for r in responses:
        if not r:
            continue
        # If response came back as a JSON string, parse it
        if isinstance(r, str):
            try:
                r = json.loads(r)
            except Exception:
                continue
        ce = r.get("code_evidence") or r.get("data", {}).get("code_evidence")
        if isinstance(ce, dict):
            merged["code_evidence"].update(ce)
    return merged

def replace_note_section(
    zt,
    item_key: str,
    replacement_html: str,
    tag_filter: str = "Note_Codes",
    create_if_missing: bool = True,
    root_title: str = "Codes",
) -> str:
    """
    Replace by <h2> match; append any non-matching replacements.
    Works when the note uses <article> wrappers or plain <h2> blocks.
    If the note has no <h2> at all, append the entire replacement_html.
    If no tagged note exists, create one from scratch with an <h1> title and the provided tag.

    Args:
        zt: object with `.zot` (pyzotero.Zotero) client
        item_key: Zotero parent item key
        replacement_html: HTML containing one or more <article>…</article> or <h2>… blocks
        tag_filter: note tag to target/create (default "Note_Codes")
        create_if_missing: create a new tagged note if none exists (default True)
        root_title: <h1> text when creating a new note (default "Codes")
    """
    import re
    from html import unescape, escape as _esc

    ARTICLE_RE = re.compile(r"(?is)(<article\b[^>]*>.*?</article>)")
    H2_RE = re.compile(r"(?is)<h2\b[^>]*>(.*?)</h2>")
    H2_BLOCK_RE = re.compile(r"(?is)(<h2\b[^>]*>.*?</h2>.*?)(?=(?:<h2\b[^>]*>|\Z))")

    def _strip_tags(s: str) -> str:
        return re.sub(r"(?is)<.*?>", "", s or "")

    def _norm_h2_text(html_block: str) -> str:
        m = H2_RE.search(html_block)
        if not m:
            return ""
        return unescape(_strip_tags(m.group(1))).strip().lower()

    def _wrap_with_root_if_missing(html_fragment: str, title: str) -> str:
        """Ensure a codes-root wrapper with <h1> and <section> exists."""
        if re.search(r'class\s*=\s*["\']codes-root["\']', html_fragment, re.I):
            return html_fragment
        return (
            '<div class="codes-root" style="font-family:system-ui,Segoe UI,Arial,sans-serif;">'
            f'<h1 style="margin:0 0 .75rem 0;font-size:1.4rem;">{_esc(title)}</h1>'
            f'<section>{html_fragment}</section></div>'
        )

    def _append_inside_root(doc_html: str, blocks_html: str) -> str:
        """
        Append blocks just before the closing </section></div> if present,
        otherwise concatenate at the end.
        """
        m = re.search(r"(?is)</section>\s*</div>\s*$", doc_html)
        if m:
            return re.sub(r"(?is)</section>\s*</div>\s*$", blocks_html + "</section></div>", doc_html, count=1)
        return doc_html + blocks_html

    # find or create the tagged note
    children = zt.zot.children(item_key)
    note_child = next(
        (
            c for c in children
            if c["data"].get("itemType") == "note"
            and any(t.get("tag") == tag_filter for t in c["data"].get("tags", []))
        ),
        None,
    )

    # if no tagged note, create from scratch with <h1> and tag
    if note_child is None:
        if not create_if_missing:
            raise ValueError(f"No note with tag '{tag_filter}' under item {item_key}.")
        wrapped = _wrap_with_root_if_missing(replacement_html, root_title)
        payload = {
            "itemType": "note",
            "parentItem": item_key,
            "note": wrapped,
            "tags": [{"tag": tag_filter}],
        }
        created = zt.zot.create_items([{"data": payload}])
        if isinstance(created, dict) and "successful" in created and created["successful"]:
            new_key = next(iter(created["successful"].values()))["key"]
        else:
            new_key = created[0]["key"]
        note_child = zt.zot.item(new_key)
        return note_child["data"]["note"]

    old_html = note_child["data"].get("note", "") or ""

    # parse replacements: prefer <article>, fallback to <h2> blocks
    repl_articles = ARTICLE_RE.findall(replacement_html)
    if repl_articles:
        repl_blocks = []
        for art in repl_articles:
            h = _norm_h2_text(art)
            if h:
                repl_blocks.append((h, art))
    else:
        repl_h2_blocks = H2_BLOCK_RE.findall(replacement_html)
        if not repl_h2_blocks:
            # nothing structured; just append raw replacement_html
            new_html = _append_inside_root(old_html, replacement_html)
            note_child["data"]["note"] = new_html
            tags = note_child["data"].get("tags", [])
            if not any(t.get("tag") == tag_filter for t in tags):
                tags.append({"tag": tag_filter})
            note_child["data"]["tags"] = tags
            updated = zt.zot.update_item(note_child)
            if isinstance(updated, dict) and "data" in updated and "note" in updated["data"]:
                return updated["data"]["note"]
            return new_html
        repl_blocks = []
        for blk in repl_h2_blocks:
            h = _norm_h2_text(blk)
            if h:
                repl_blocks.append((h, blk))

    if not repl_blocks:
        # fallback: append raw
        new_html = _append_inside_root(old_html, replacement_html)
        note_child["data"]["note"] = new_html
        tags = note_child["data"].get("tags", [])
        if not any(t.get("tag") == tag_filter for t in tags):
            tags.append({"tag": tag_filter})
        note_child["data"]["tags"] = tags
        updated = zt.zot.update_item(note_child)
        if isinstance(updated, dict) and "data" in updated and "note" in updated["data"]:
            return updated["data"]["note"]
        return new_html

    # CASE A: note has <article> wrappers
    note_articles = ARTICLE_RE.findall(old_html)
    if note_articles:
        heading_to_index = {}
        for i, art in enumerate(note_articles):
            h = _norm_h2_text(art)
            if h and h not in heading_to_index:
                heading_to_index[h] = i

        replace_plan = {}
        to_append = []
        for h, new_block in repl_blocks:
            idx = heading_to_index.get(h)
            if idx is not None:
                replace_plan[idx] = new_block
            else:
                to_append.append(new_block)

        parts = ARTICLE_RE.split(old_html)
        rebuilt = []
        art_counter = -1
        for chunk in parts:
            if ARTICLE_RE.match(chunk or ""):
                art_counter += 1
                rebuilt.append(replace_plan.get(art_counter, chunk))
            else:
                rebuilt.append(chunk)
        new_html = "".join(rebuilt)

        if to_append:
            new_html = _append_inside_root(new_html, "".join(to_append))

    else:
        # CASE B: plain <h2> blocks or no <h2> at all
        note_h2_blocks = H2_BLOCK_RE.findall(old_html)
        if not note_h2_blocks:
            # no <h2> in note → append entire replacement_html
            new_html = _append_inside_root(old_html, replacement_html)
        else:
            heading_to_index = {}
            for i, blk in enumerate(note_h2_blocks):
                h = _norm_h2_text(blk)
                if h and h not in heading_to_index:
                    heading_to_index[h] = i

            replace_plan = {}
            to_append = []
            for h, new_block in repl_blocks:
                idx = heading_to_index.get(h)
                if idx is not None:
                    replace_plan[idx] = new_block
                else:
                    to_append.append(new_block)

            parts = H2_BLOCK_RE.split(old_html)
            rebuilt = []
            block_counter = -1
            for chunk in parts:
                if chunk and H2_RE.search(chunk) and chunk.startswith("<h2"):
                    block_counter += 1
                    rebuilt.append(replace_plan.get(block_counter, chunk))
                else:
                    rebuilt.append(chunk)
            new_html = "".join(rebuilt)

            if to_append:
                new_html = _append_inside_root(new_html, "".join(to_append))

    # update Zotero
    note_child["data"]["note"] = new_html
    tags = note_child["data"].get("tags", [])
    if not any(t.get("tag") == tag_filter for t in tags):
        tags.append({"tag": tag_filter})
    note_child["data"]["tags"] = tags

    updated = zt.zot.update_item(note_child)
    if isinstance(updated, dict) and "data" in updated and "note" in updated["data"]:
        return updated["data"]["note"]
    return new_html
def generate_html_na(data: dict) -> str:
    """
    Transform code-metadata dictionaries into a sequence of <article> blocks.
    No outer <div>, no <h1>, no <section>. Only the <article> cards with <h2>, <h3>, and optional sections.

    Accepts either shape:
      A) {"code_evidence": {"argumentation_logic": {...}, "epistemology": {...}, ...}}
      B) {"argumentation_logic": {...}, "epistemology": {...}, ...}

    Fields recognised per code:
      - value: str | list | None      -> rendered in <h3> as 'value: ...'
      - discussion: str               -> rendered in <p> after a 'Discussion' <h4>
      - support: str                  -> rendered in <blockquote> after a 'Support' <h4>
      - critique: str                 -> rendered in <p> after a 'Critique' <h4>

    Returns:
      Concatenated HTML string of <article>…</article> blocks.
      If no codes present, returns "".
    """
    import html as _html

    # Normalise input
    if isinstance(data, dict) and isinstance(data.get("code_evidence"), dict):
        codes = data["code_evidence"]
    elif isinstance(data, dict):
        codes = data
    else:
        return ""

    if not isinstance(codes, dict) or not codes:
        return ""

    parts: list[str] = []

    # Preserve insertion order from the provided dict
    for code_key, fields in codes.items():
        parts.append(
            '<article style="margin:0 0 1.25rem 0;padding:0.75rem;'
            'border:1px solid #eee;border-radius:10px;">'
        )
        parts.append(
            f'<h2 style="margin:.1rem 0 .5rem 0;font-size:1.1rem;">{_html.escape(str(code_key))}</h2>'
        )

        if isinstance(fields, dict):
            val = fields.get("value", None)
            if isinstance(val, list):
                safe_val = "; ".join(_html.escape(str(x)) for x in val)
            elif val is None:
                safe_val = "NA"
            else:
                safe_val = _html.escape(str(val))
            parts.append(
                f'<h3 style="margin:.25rem 0 .5rem 0;font-size:1rem;">value: {safe_val}</h3>'
            )

            disc = fields.get("discussion")
            if disc:
                parts.append('<h4 style="margin:.25rem 0 0 0;font-size:.95rem;">Discussion</h4>')
                parts.append(f'<p style="margin:.25rem 0 0 0;">{_html.escape(str(disc))}</p>')

            supp = fields.get("support")
            if supp:
                parts.append('<h4 style="margin:.5rem 0 0 0;font-size:.95rem;">Support</h4>')
                parts.append(
                    '<blockquote style="margin:.25rem 0 0 0;padding:.5rem;'
                    'border-left:3px solid #ccc;background:#fafafa;">'
                    f'{_html.escape(str(supp))}</blockquote>'
                )

            crit = fields.get("critique")
            if crit:
                parts.append('<h4 style="margin:.5rem 0 0 0;font-size:.95rem;">Critique</h4>')
                parts.append(f'<p style="margin:.25rem 0 0 0;">{_html.escape(str(crit))}</p>')

        parts.append("</article>")

    return "".join(parts)
def generate_html(data: dict) -> str:
    """
    Render {'code_evidence': {...}} into tidy HTML.
    Shows only the final value (h3: 'value: ...') and
    uses h4 for Discussion, Support, and Critique.
    """
    parts = []
    parts.append('<div class="codes-root" style="font-family:system-ui,Segoe UI,Arial,sans-serif;">')
    parts.append('<h1 style="margin:0 0 .75rem 0;font-size:1.4rem;">Codes</h1>')

    code_evidence = data.get("code_evidence", {})
    if not isinstance(code_evidence, dict) or not code_evidence:
        parts.append("<p>No code evidence.</p>")
        parts.append("</div>")
        return "".join(parts)

    parts.append('<section>')
    for code_key, fields in code_evidence.items():
        parts.append(
            '<article style="margin:0 0 1.25rem 0;padding:0.75rem;'
            'border:1px solid #eee;border-radius:10px;">'
        )
        parts.append(
            f'<h2 style="margin:.1rem 0 .5rem 0;font-size:1.1rem;">'
            f'{html.escape(code_key)}</h2>'
        )

        if isinstance(fields, dict):
            # Show ONLY the final 'value' (already corrected if needed)
            val = fields.get("value")
            if isinstance(val, list):
                safe_val = ", ".join(html.escape(str(x)) for x in val)
            else:
                safe_val = html.escape(str(val)) if val is not None else "NA"
            parts.append(
                f'<h3 style="margin:.25rem 0 .5rem 0;font-size:1rem;">value: {safe_val}</h3>'
            )

            # Discussion
            disc = fields.get("discussion")
            if disc:
                parts.append('<h4 style="margin:.25rem 0 0 0;font-size:.95rem;">Discussion</h4>')
                parts.append(f'<p style="margin:.25rem 0 0 0;">{html.escape(disc)}</p>')

            # Support
            supp = fields.get("support")
            if supp:
                parts.append('<h4 style="margin:.5rem 0 0 0;font-size:.95rem;">Support</h4>')
                parts.append(
                    f'<blockquote style="margin:.25rem 0 0 0;padding:.5rem;'
                    f'border-left:3px solid #ccc;background:#fafafa;">{html.escape(supp)}</blockquote>'
                )

            # Critique
            crit = fields.get("critique")
            if crit:
                parts.append('<h4 style="margin:.5rem 0 0 0;font-size:.95rem;">Critique</h4>')
                parts.append(f'<p style="margin:.25rem 0 0 0;">{html.escape(crit)}</p>')

        parts.append('</article>')
    parts.append('</section>')
    parts.append('</div>')
    return "".join(parts)

def _norm_title(t):
    """Lower-case, strip quotes, kill leading numerals and collapse whitespace."""
    import re, unicodedata
    if not t:
        return ''
    t = unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode()  # de-accent
    t = t.lower().strip()
    t = re.sub(r'^[\'"“”‘’]+|[\'"“”‘’]+$', '', t)        # surrounding quotes
    t = re.sub(r'^\s*\d+\s*[-–.:]\s*', '', t)            # leading “6 – ”, “4. ”, etc.
    t = re.sub(r'\s+', ' ', t)                           # collapse whitespace
    return t


initial = 0
topic_sentence_count, keywords_count = initial, initial


CACHE_DIR = Path.home()/".zotkw_phrase_cache"
CACHE_DIR.mkdir(exist_ok=True)
# your CSS stays largely the same


def parse_citation_count_line(extra_str: str | None) -> str:
    """
    Extracts and returns the full citation substring for the highest count found.
    Supports formats like:
      - "123 citations"
      - "Cited by: 1,234"
      - "789 citations (Google Scholar)"

    If nothing valid is found, returns "0 citations (default)".
    """
    if not isinstance(extra_str, str):
        return "0 citations (default)"

    best_count = 0
    best_line = "0 citations (default)"

    for line in extra_str.splitlines():
        if "citation" not in line.lower():
            continue
        nums = re.findall(r'[\d,]+', line)
        if not nums:
            continue
        num_str = nums[-1].replace(",", "")
        if not num_str.isdigit():
            continue
        count = int(num_str)
        if count > best_count:
            best_count = count
            best_line = line.strip()

    return best_line

def _index_to_alias(idx: int) -> str:
    """
    Convert a zero‑based index to letters:
      0 → 'A', 1 → 'B', …, 25 → 'Z', 26 → 'AA', 27 → 'AB', …
    """
    alias = []
    while idx >= 0:
        idx, rem = divmod(idx, 26)
        alias.append(string.ascii_uppercase[rem])
        idx -= 1
    return "".join(reversed(alias))

def flatten_ai_response(ai_response: dict) -> dict:
    """
    Takes a nested AI response dictionary and flattens it into a single-level dictionary.

    It specifically unnests the 'keywords' object and aggregates the 'affiliation'
    list into semicolon-separated strings for department, institution, and country.

    Args:
        ai_response (dict): The nested dictionary from the AI, containing 'abstract'
                            and a 'keywords' object.

    Returns:
        dict: A flat dictionary containing all specified fields.
    """
    if not isinstance(ai_response, dict):
        return {}

    # Initialize the flat dictionary that will hold the final result
    flat_record = {}

    # 1. Extract the top-level 'abstract'
    flat_record['abstract'] = ai_response.get('abstract', '')

    # 2. Safely get the nested 'keywords' dictionary
    kw = ai_response.get('keywords', {})

    # 3. Handle the 'affiliation' list flattening
    affiliations_list = kw.get('affiliation', [])
    departments = []
    institutions = []
    countries = []

    if affiliations_list:
        for affiliation in affiliations_list:
            # Safely get each part, converting None to an empty string
            dept = affiliation.get('department')
            inst = affiliation.get('institution')
            ctry = affiliation.get('country')

            if dept: departments.append(str(dept))
            if inst: institutions.append(str(inst))
            if ctry: countries.append(str(ctry))

    # Join the collected values into semicolon-separated strings
    flat_record['department'] = "; ".join(departments)
    flat_record['institution'] = "; ".join(institutions)
    flat_record['country'] = "; ".join(countries)

    # 4. Extract all other fields from the 'keywords' dictionary
    flat_record['funding'] = kw.get('funding', '')
    flat_record['theoretical_orientation'] = kw.get('theoretical_orientation', '')
    flat_record['level_of_analysis'] = kw.get('level_of_analysis', '')
    flat_record['argumentation_logic'] = kw.get('argumentation_logic', '')

    # For list-based fields, join them into a single string
    flat_record['evidence_source_base'] = "; ".join(kw.get('evidence_source_base', []))

    flat_record['methodology'] = kw.get('methodology', '')

    flat_record['methods'] = "; ".join(kw.get('methods', []))

    flat_record['framework_model'] = kw.get('framework_model', '')
    flat_record['contribution_type'] = kw.get('contribution_type', '')
    flat_record['attribution_lens_focus'] = kw.get('attribution_lens_focus', '')

    flat_record['controlled_vocabulary_terms'] = "; ".join(kw.get('controlled_vocabulary_terms', []))
    flat_record['topic_phrases'] = "; ".join(kw.get('topic_phrases', []))

    return flat_record
def _cache_path(collection:str, digest:str)->Path:
    h = hashlib.sha1((collection+digest).encode()).hexdigest()[:10]
    return CACHE_DIR / f"{h}.pkl"

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

# Configure basic logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

def list_chrome_profiles(user_data_dir):
    """
    Returns a dict: { folder_name: display_name }, e.g.
      { "Default": "Person 1", "Profile 1": "Work", ... }
    """
    local_state = os.path.join(user_data_dir, "Local State")
    if not os.path.isfile(local_state):
        raise FileNotFoundError(f"Local State not found at {local_state}")
    with open(local_state, "r", encoding="utf-8") as f:
        data = json.load(f)

    info = data.get("profile", {}).get("info_cache", {})
    return { folder: details.get("name", folder)
             for folder, details in info.items() }
def clean_html_for_merge(html_content):
    """Removes surrounding <p> tags for cleaner merging."""
    if not isinstance(html_content, str):
        return ""  # Handle potential non-string input gracefully
    # Remove leading <p...> tag, handling potential attributes
    cleaned = re.sub(r'^\s*<p[^>]*>', '', html_content.strip(), count=1)
    # Remove trailing </p> tag
    cleaned = re.sub(r'</p>\s*$', '', cleaned, count=1)
    return cleaned.strip()

def get_metadata_from_item(self, data):
    """
    Pull all bibliographic fields **plus** the absolute on-disk path to the
    first embedded PDF attachment.

    Returns
    -------
    dict with keys:
        authors, date, title, journal, abstract, doi, item_type, url,
        conferenceName, pages, short_title, item_id, citation_key, pdf_path
    """
    # ---------------- basic bibliographic fields -------------------------
    item_data   = data["data"]
    key         = data["key"]

    # authors
    try:
        authors = ", ".join([
            (f"{a['firstName']} {a['lastName']}"
             if "firstName" in a and "lastName" in a else a["name"])
            for a in item_data.get("creators", [])
        ])
    except Exception as exc:
        logging.warning("author parse failed for %s → %s", key, exc)
        authors = "Unknown-author"

    # year
    raw_date = item_data.get("date") or ""
    m = re.search(r"\b(\d{4})\b", raw_date)
    year = m.group(1) if m else "n.d."

    # citation-key (from Extra)
    citation_key = None
    extra = item_data.get("extra", "")
    for line in extra.splitlines():
        if line.lower().startswith("citation key"):
            citation_key = line.split(":",1)[1].strip()
            break

    # ---------------- attachment → pdf_path -----------------------------
    pdf_path = None
    try:
        for child in self.zot.children(key):
            cdata = child.get("data", {})
            if cdata.get("itemType") != "attachment":
                continue
            # skip pure links that aren’t PDFs
            if cdata.get("contentType") != "application/pdf" and \
                    not cdata.get("filename", "").lower().endswith(".pdf"):
                continue

            linkmode = cdata.get("linkMode")
            if linkmode == "imported_url":
                # download from the enclosure link
                url = child["links"]["enclosure"]["href"]
                resp = requests.get(url, stream=True, timeout=10)
                if resp.status_code == 200:
                    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
                    for chunk in resp.iter_content(1024 * 64):
                        tmp.write(chunk)
                    tmp.close()
                    pdf_path = tmp.name
                    break
                else:
                    continue

            # otherwise let Zotero give you its local path
            try:
                candidate = self.get_pdf_path(attachment_id=cdata["key"])
            except Exception:
                candidate = None
            if candidate and os.path.exists(candidate):
                pdf_path = candidate
                break
    except Exception as exc:
        logging.error("attachment lookup failed for %s → %s", key, exc)

    return {
        "authors"      : authors,
        "date"         : year,
        "title"        : item_data.get("title"),
        # "journal"      : item_data.get("publicationTitle"),
        "abstract"     : item_data.get("abstractNote"),
        # "doi"          : item_data.get("DOI"),
        "item_type"    : item_data.get("itemType"),
        # "url"          : item_data.get("url"),
        # "conferenceName": item_data.get("conferenceName"),
        # "pages"        : item_data.get("pages"),
        # "short_title"  : item_data.get("shortTitle"),
        # "item_id"      : key,
        # "citation_key" : citation_key,
        # "pdf_path"     : pdf_path,
    }

def is_paragraph_ignorable(para_html, min_text_length=25):
    """
    Checks if a paragraph is likely ignorable (empty, only tags, very short text,
    or common non-prose elements like figure/table captions).

    Args:
        para_html (str): The HTML content of the paragraph.
        min_text_length (int): The minimum number of non-whitespace characters
                               (after stripping HTML tags) required for a paragraph
                               to be considered non-ignorable, *unless* it matches
                               a specific non-prose pattern.

    Returns:
        bool: True if the paragraph is ignorable, False otherwise.
    """
    if not para_html:
        return True

    # Check for essentially empty <p> tags first (fastest check)
    if re.fullmatch(r'\s*<p[^>]*>\s*</p>\s*', para_html, re.IGNORECASE):
        logging.debug(f"Ignoring paragraph (empty tag): {para_html[:50]}...")
        return True

    # Extract text content by removing HTML tags
    try:
        text_content = re.sub(r'<[^>]+>', '', para_html).strip()
    except TypeError:
        logging.warning(f"Could not extract text from non-string HTML: {type(para_html)}")
        return True  # Treat as ignorable if text extraction fails

    if not text_content:  # Handle cases where stripping tags leaves nothing
        logging.debug(f"Ignoring paragraph (no text content after stripping tags): {para_html[:50]}...")
        return True

    # --- Specific Patterns for Exclusion ---
    # Figure/Table Captions (often start with Fig./Table and are short)
    b_tag = None
    try:  # Use try-except as BeautifulSoup operations can sometimes fail on weird input
        soup_p = BeautifulSoup(para_html, 'html.parser').find('p')
        if soup_p:
            b_tag = soup_p.find('b')
    except Exception:
        pass  # Ignore parsing errors for this specific check

    if b_tag and re.match(r'^(Fig|Table)\s*\.?\s*\d+', b_tag.get_text(strip=True), re.IGNORECASE):
        # Check if the remaining text in the paragraph is short
        remaining_text = text_content.replace(b_tag.get_text(" ", strip=True), "").strip()
        if len(remaining_text) < 150:
            logging.debug(f"Ignoring paragraph (figure/table caption pattern): {text_content[:80]}...")
            return True

    # Very short list items (e.g., "<p>a)</p>", "<p>1.</p>")
    if re.fullmatch(r'^[a-zA-Z0-9][.)]?$', text_content):
        logging.debug(f"Ignoring paragraph (likely short list item): {text_content}")
        return True

    # References section header
    if re.fullmatch(r'References', text_content, re.IGNORECASE):
        logging.debug(f"Ignoring paragraph (References header pattern).")
        return True

    # --- General Length Check (if no specific pattern matched) ---
    if len(text_content) < min_text_length:
        logging.debug(
            f"Ignoring paragraph (text length {len(text_content)} < {min_text_length}): {text_content[:50]}...")
        return True

    return False


def process_paragraphs_auto(paragraphs, min_ignore_length=25, min_final_length=300):
    """
    Processes paragraphs automatically based on HTML length rules, ensuring
    no final paragraph has len < min_final_length.

    Args:
        paragraphs (list): A list of tuples (para_text, para_html).
        min_ignore_length (int): Min text length to initially consider a short paragraph non-ignorable.
        min_final_length (int): The minimum HTML length required for a paragraph
                                to be included in the final output.

    Returns:
        list: Processed list of tuples (para_text, para_html).
    """
    if not paragraphs:
        return []

    processed_list = []
    i = 0
    n = len(paragraphs)
    consumed_by_merge_forward = set()
    last_item_was_merged_into = False

    logging.info(
        f"--- Starting Automatic Paragraph Processing ({n} paragraphs, Min Final Length: {min_final_length}) ---")

    while i < n:
        if i in consumed_by_merge_forward:
            logging.debug(f"Skipping index {i} as it was merged forward.")
            i += 1
            continue

        if not isinstance(paragraphs[i], (tuple, list)) or len(paragraphs[i]) != 2:
            logging.warning(f"Skipping invalid item at index {i}: {paragraphs[i]}")
            i += 1
            continue

        para_text, para_html = paragraphs[i]

        if not para_html:
            logging.warning(f"Skipping paragraph {i + 1} due to empty HTML.")
            i += 1
            continue

        current_len = len(para_html)
        logging.debug(f"Processing Original Paragraph {i + 1}/{n} (Length: {current_len})")

        # Determine initial state based *only* on length for merging rules
        is_short_initial = current_len < 300  # Use 300 for the *initial* short check
        is_medium = 300 <= current_len < 500

        # Check ignorable status for initial filtering
        ignorable = is_paragraph_ignorable(para_html, min_ignore_length)

        # Rule 1: Automatically exclude ignorable paragraphs upfront
        if ignorable:
            logging.info(f"-> Excluding paragraph {i + 1} (len {current_len}, initially ignorable content).")
            i += 1
            # Keep last_item_was_merged_into status as it was
            continue

        # Rule 2 & 3: Attempt merging for medium paragraphs OR non-ignorable short paragraphs
        if is_medium or is_short_initial:  # Use is_short_initial here
            # Check if the paragraph is short even if not initially ignorable
            # This logging differentiates the two cases for clarity
            if is_short_initial:
                log_msg_type = "short, non-ignorable"
            else:  # is_medium
                log_msg_type = "medium"
            logging.info(f"-> Paragraph {i + 1} (len {current_len}) is {log_msg_type}. Attempting merge...")

            merged = False
            # --- Try merging backward ---
            if processed_list and not last_item_was_merged_into:
                logging.debug(f"   Attempting backward merge for paragraph {i + 1}...")
                last_item = processed_list[-1]
                prev_cleaned = clean_html_for_merge(last_item['html'])
                curr_cleaned = clean_html_for_merge(para_html)
                separator = " " if prev_cleaned and curr_cleaned else ""
                merged_html = f"<p>{prev_cleaned}{separator}{curr_cleaned}</p>"
                merged_text = f"{last_item['text']}{separator}{para_text}"

                # *** Check length AFTER potential merge ***
                if len(merged_html) >= min_final_length:
                    last_item['text'] = merged_text
                    last_item['html'] = merged_html
                    last_item['merged'] = True
                    logging.info(
                        f"   Merged paragraph {i + 1} BACKWARD into previous. New length {len(merged_html)} >= {min_final_length}. Keeping.")
                    last_item_was_merged_into = True
                    merged = True
                    i += 1
                else:
                    logging.info(
                        f"   Backward merge result for {i + 1} is too short (len {len(merged_html)} < {min_final_length}). Cannot merge backward.")
                    # Keep trying forward merge or exclusion

            # --- Try merging forward ---
            if not merged and i + 1 < n:  # Only try forward if backward failed or wasn't possible
                logging.debug(
                    f"   Cannot merge backward (or result too short). Attempting forward merge for paragraph {i + 1}...")
                # Check if the *next* paragraph is valid for merging
                next_text_temp, next_html_temp = paragraphs[i + 1]
                next_len = len(next_html_temp)
                next_is_ignorable = is_paragraph_ignorable(next_html_temp, min_ignore_length)

                if next_is_ignorable:
                    logging.info(f"   Cannot merge paragraph {i + 1} forward, next paragraph {i + 2} is ignorable.")
                    # Fall through to the 'if not merged:' block
                else:
                    # Perform potential forward merge
                    curr_cleaned = clean_html_for_merge(para_html)
                    next_cleaned = clean_html_for_merge(next_html_temp)
                    separator = " " if curr_cleaned and next_cleaned else ""
                    merged_html = f"<p>{curr_cleaned}{separator}{next_cleaned}</p>"
                    merged_text = f"{para_text}{separator}{next_text_temp}"
                    merged_len = len(merged_html)

                    # *** Check length AFTER potential merge ***
                    if merged_len >= min_final_length:
                        processed_list.append({'text': merged_text, 'html': merged_html, 'merged': True})
                        logging.info(
                            f"   Merged paragraph {i + 1} (len {current_len}) FORWARD with {i + 2} (len {next_len}). New length {merged_len} >= {min_final_length}. Keeping.")
                        consumed_by_merge_forward.add(i + 1)
                        last_item_was_merged_into = True
                        merged = True
                        i += 2  # Skip both original paragraphs
                    else:
                        logging.info(
                            f"   Forward merge result for {i + 1} and {i + 2} is too short (len {merged_len} < {min_final_length}). Cannot merge forward.")
                        # Fall through to the 'if not merged:' block

            # --- Cannot merge OR merge result too short ---
            if not merged:
                # Apply the strict exclusion: if it's short *now* and couldn't be successfully merged, exclude it.
                # Note: A medium paragraph that failed merging would NOT be short here.
                if current_len < min_final_length:  # Check against the required final length
                    logging.info(
                        f"   Cannot merge paragraph {i + 1} successfully to meet min length {min_final_length}. Excluding.")
                    # Do NOT append to processed_list
                else:
                    # This case covers medium paragraphs that failed merging - they are already >= 300 but < 500
                    logging.info(f"   Cannot merge paragraph {i + 1} (medium). Keeping as is.")
                    processed_list.append({'text': para_text, 'html': para_html, 'merged': False})
                    last_item_was_merged_into = False

                i += 1  # Move past the current paragraph

        # Rule 4: Keep long paragraphs (which are >= 500, thus >= min_final_length) as is
        elif current_len >= 500:
            logging.info(f"-> Paragraph {i + 1} (len {current_len}) is long enough. Keeping as is.")
            processed_list.append({'text': para_text, 'html': para_html, 'merged': False})
            last_item_was_merged_into = False
            i += 1

        # Safety net
        else:
            logging.warning(
                f"-> UNEXPECTED STATE for paragraph {i + 1} (len {current_len}). Keeping as is (will be excluded if < {min_final_length}).")
            if current_len >= min_final_length:
                processed_list.append({'text': para_text, 'html': para_html, 'merged': False})
                last_item_was_merged_into = False
            else:
                logging.info(
                    f"   Excluding unexpected state paragraph {i + 1} because len {current_len} < {min_final_length}.")
            i += 1

    logging.info("--- Automatic Paragraph Processing Complete ---")
    # Final check: Although the logic *should* prevent it, we can add a final filter pass
    # to be absolutely sure no paragraph < min_final_length remains.
    final_checked_paragraphs = []
    for item in processed_list:
        if len(item['html']) >= min_final_length:
            final_checked_paragraphs.append((item['text'], item['html']))
        else:
            logging.warning(
                f"Post-processing filter: Excluding paragraph because len {len(item['html'])} < {min_final_length}. Text: {item['text'][:60]}...")

    # return [(item['text'], item['html']) for item in processed_list] # Original return
    return final_checked_paragraphs  # Return the double-checked list


def group_by_publication_title(items, feature="url"):
    """
    Groups items by their 'publicationTitle'. If no 'publicationTitle' is found or it's empty,
    the item is placed under the key 'nofeature'.

    Args:
        items (list): A list of dicts, each at least containing {'publicationTitle': ..., 'key': ...}.

    Returns:
        dict: A dictionary mapping publication titles (or 'nofeature') to a list of item dicts.
    """
    grouped = {}

    for item in items:

        if feature == "url":
            url = item["data"][feature]
            try:
                if url:
                    url = url.split("/")[2]
            except Exception as e:
                print(url)

            feature = url if url else "none"
            if feature not in grouped:
                grouped[feature] = []
            grouped[feature].append(item)

        if feature == "pub":

            # print(item["data"]["url"].split("/")[2])

            #
            publisher = item["data"].get("publisher", None)
            proceedingsTitle_title = item["data"].get("proceedingsTitle", None)
            publication_title = item["data"].get("publicationTitle", None)
            #
            # # Extract the publicationTitle; default to an empty string if missing
            pub_title = publisher or publication_title or proceedingsTitle_title or "No feature"
            pub_title = pub_title.lower().strip()

            # Insert into grouping dictionary
            if pub_title not in grouped:
                grouped[pub_title] = []
            grouped[pub_title].append(item)

    cleaned_data = {
        key: value_list
        for key, value_list in grouped.items()
        if isinstance(value_list, list) and len(value_list) >= 3
    }

    return cleaned_data


def get_multiline_input(title="Dataset Input", prompt="Enter your dataset (multiline supported):"):
    root = tk.Tk()
    root.title(title)
    root.geometry("700x500")
    root.configure(bg="#f7f7f7")

    # Use ttk's modern 'clam' theme and configure fonts/colors
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure("TLabel", font=("Segoe UI", 12), background="#f7f7f7", foreground="#333333")
    style.configure("TButton", font=("Segoe UI", 11), padding=6)
    style.configure("TFrame", background="#f7f7f7")
    style.configure("Header.TLabel", font=("Segoe UI", 14, "bold"), background="#f7f7f7")

    # Center the window on the screen.
    root.update_idletasks()
    width = 700
    height = 500
    x = (root.winfo_screenwidth() // 2) - (width // 2)
    y = (root.winfo_screenheight() // 2) - (height // 2)
    root.geometry(f"{width}x{height}+{x}+{y}")

    # Main frame container
    main_frame = ttk.Frame(root, padding=20)
    main_frame.pack(expand=True, fill="both")

    # Header label with prompt text
    header = ttk.Label(main_frame, text=prompt, style="Header.TLabel")
    header.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 10))

    # Text widget container with scrollbar
    text_frame = ttk.Frame(main_frame)
    text_frame.grid(row=1, column=0, columnspan=2, sticky="nsew")
    main_frame.rowconfigure(1, weight=1)
    main_frame.columnconfigure(0, weight=1)

    text_widget = tk.Text(text_frame, wrap="word", font=("Consolas", 11), relief="flat", borderwidth=2)
    text_widget.grid(row=0, column=0, sticky="nsew")
    text_frame.rowconfigure(0, weight=1)
    text_frame.columnconfigure(0, weight=1)

    scrollbar = ttk.Scrollbar(text_frame, orient="vertical", command=text_widget.yview)
    scrollbar.grid(row=0, column=1, sticky="ns")
    text_widget.configure(yscrollcommand=scrollbar.set)

    # Button frame for Submit and Cancel buttons
    button_frame = ttk.Frame(main_frame)
    button_frame.grid(row=2, column=0, columnspan=2, pady=(10, 0), sticky="e")

    result = {"data": None}

    def submit():
        result["data"] = text_widget.get("1.0", tk.END).strip()
        root.destroy()

    def cancel():
        result["data"] = None
        root.destroy()

    submit_button = ttk.Button(button_frame, text="Submit", command=submit)
    submit_button.grid(row=0, column=0, padx=5)

    cancel_button = ttk.Button(button_frame, text="Cancel", command=cancel)
    cancel_button.grid(row=0, column=1, padx=5)

    root.mainloop()
    return result["data"]


def clean_title(title):
    """
    Cleans a title string by:
      - Removing any leading numbering groups (digits or Roman numerals) from each segment.
      - Dropping any segment that (after cleaning) is exactly one of the generic titles:
          {"conclusion", "concluding remarks", "conclusions"} (case-insensitive).
      - Preserving the colon (":") structure of compound titles.

    If the resulting title is empty, returns None.

    Examples:
      "1 Evidence and International Justice: Short Introductory Remarks"
         → "Evidence and International Justice: Short Introductory Remarks"
      "1 Introduction"
         → "Introduction"   (and if you want to drop a segment that is exactly generic, you can adjust the generic set)
      "CONCLUDING REMARKS"
         → None
    """
    if not title:
        return None

    title = title.strip()
    if title.lower() in {"no title", "n/a"}:
        return None

    # Define generic titles that should cause the segment to be dropped.
    generic_set = {"conclusion", "concluding remarks", "conclusions"}

    # Pattern to remove one or more leading numbering groups (digits or Roman numerals)
    # followed by punctuation (dot, dash, or whitespace)
    numbering_pattern = r'^(?:(?:\d+|[IVXLCDM]+)[\.\-\s]+)+'

    # Split title into segments by colon
    segments = [seg.strip() for seg in title.split(":")]

    cleaned_segments = []
    for seg in segments:
        # Remove any leading numbering groups
        seg_clean = re.sub(numbering_pattern, '', seg, flags=re.IGNORECASE).strip()
        # If the cleaned segment (case-insensitive) is exactly one of the generic titles, skip it.
        if seg_clean.lower() in generic_set:
            continue
        cleaned_segments.append(seg_clean)

    if not cleaned_segments:
        return None

    # Rejoin segments with ": " to preserve structure.
    result = ": ".join(cleaned_segments)
    return result


def download_file(url, save_path):
    import os
    import time
    import undetected_chromedriver as uc
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    import pyautogui

    options = uc.ChromeOptions()

    # Replace with your actual paths
    options.add_argument("--user-data-dir=C:\\Users\\luano\\AppData\\Local\\Google\\Chrome\\User Data")
    options.add_argument("--profile-directory=Profile 2")

    options.add_argument("--disable-extensions")
    options.add_argument("--disable-application-cache")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-setuid-sandbox")
    options.add_argument("--disable-dev-shm-usage")

    # Block notifications and pop-ups
    options.add_experimental_option("prefs", {
        "profile.default_content_setting_values.notifications": 2,
        "profile.default_content_setting_values.popups": 2,
    })

    driver = uc.Chrome(options=options)

    try:
        print(f"Opening browser to download: {url}")
        driver.get(url)

        # Wait for the Cloudflare challenge to complete by checking for a specific element
        WebDriverWait(driver, 60).until(
            EC.presence_of_element_located((By.TAG_NAME, "body"))
        )

        print("Cloudflare challenge passed. Page fully loaded.")

        # Additional sleep to ensure the page is fully ready
        time.sleep(5)

        # Bring the browser window to the front
        driver.maximize_window()
        driver.switch_to.window(driver.current_window_handle)

        # Simulate Ctrl+S
        print("Simulating Ctrl+S to open 'Save As' dialog.")
        pyautogui.hotkey('ctrl', 's')

        # Wait for the 'Save As' dialog to appear
        time.sleep(2)

        # Press 'Enter' to confirm save
        print("Pressing 'Enter' to confirm save.")
        pyautogui.press('enter')

        # Determine the download directory
        download_dir = os.path.expanduser("~\\Downloads")  # Adjust if necessary
        file_name = os.path.basename(save_path)
        downloaded_file_path = os.path.join(download_dir, file_name)

        # Wait for the file to appear in the download directory
        end_time = time.time() + 60  # Timeout after 60 seconds

        while True:
            if time.time() > end_time:
                print("Download timed out.")
                break
            if os.path.exists(downloaded_file_path):
                print(f"File downloaded successfully and saved to {downloaded_file_path}")

                # Move the file to the desired save_path
                os.rename(downloaded_file_path, save_path)
                return save_path  # Return the path to the saved file

            else:
                time.sleep(1)

    except Exception as e:
        print(f"An error occurred: {e}")

    finally:
        driver.quit()


def update_note_zotero(note, tags, content, zot):
    updated_note = {
        'key': note['data']['key'],
        'version': note['data']['version'],
        'itemType': note['data']['itemType'],
        'note': content,
        'tags': tags
    }
    response=False
    # Update the note in Zotero
    try:
        response = zot.update_item(updated_note)
        if response:
            print("Note updated successfully.")
        else:
            print("Failed to update the note.")
    except Exception as e:
        print(f"An error occurred during the update: {e}")
    return response


class Zotero:
    def __init__(self,
                 library_id="<Library ID>",
                 library_type='user',
                 api_key="<API KEY>",
                 chat_args={"chat_id": "pdf"},
                 os_name="mac",
                 sleep=10
                 ):
        """
            Initialize a new instance of the class, setting up the necessary configurations for accessing and interacting with a Zotero library.

            Parameters:
            - library_id (str): The ID of the Zotero library to connect to.
            - library_type (str): The type of the Zotero library (e.g., 'user' or 'group').
            - api_key (str): The API key used for authenticating with the Zotero API.
            - chat_args: Additional arguments or configurations related to chat functionalities (the exact type and structure need to be specified based on usage).

            This method also establishes a connection to the Zotero library, sets the directory path for Zotero storage based on the operating system, and initializes a schema attribute.
            """
        global default_storage
        self.pdf_path_cache = {}  # Initialize as an empty dictionary
        import platform
        current_os = platform.system().lower()

        self.persistent_cache_dir = Path(
            r"C:\Users\luano\PycharmProjects\all tests\Cache\Zotero")  # Example path for file cache
        self.persistent_cache_dir.mkdir(parents=True, exist_ok=True)  # Ensure it exists
        if "windows" in current_os:
            # Use raw string or double backslashes
            default_storage = r"C:\Users\luano\Zotero\storage\\"
        else:
            default_storage = os.getenv("ZOTERO_STORAGE_DIR", str(Path.home() / "Zotero" / "storage"))
        self.zotero_storage_base = Path(default_storage).expanduser().resolve()  # Use expanduser for '~'
        self.library_id = library_id
        self.library_type = library_type
        self.api_key = api_key
        self.zot = self.connect()
        self.sleep = sleep

        self.chat_args = chat_args
        self.zotero_directory = "/Users/pantera/Zotero/storage/" if os_name == "mac" else "C:\\Users\\luano\\Zotero\\storage\\"
        self.schema = ""

    def connect(self):
        """
           Establishes and returns a connection to the Zotero API using the Zotero library credentials stored in the instance.

           Returns:
           - An instance of the Zotero object configured with the specified library ID, library type, and API key. This object can be used to perform various operations with the Zotero API.
           """

        return zotero.Zotero(self.library_id, self.library_type, self.api_key)


    def enrich_metadata(self, record: dict, doc_type: str="report") -> None:
        """
        In-place enrich `record` by querying CrossRef for any missing fields.
        Only applies to report, journal, conferencepaper.
        """
        key = doc_type.lower()
        if key not in {"report", "journal", "conferencepaper"}:
            return  # nothing to do for 'case' or unknown

        title = record.get("Title")
        if not title:
            return  # need at least a title to search

        try:
            resp = requests.get(
                "https://api.crossref.org/works",
                params={"query.title": title, "rows": 1},
                timeout=5
            )
            resp.raise_for_status()
            items = resp.json().get("message", {}).get("items", [])
            if not items:
                return
            cr = items[0]

            # DOI
            record.setdefault("DOI", cr.get("DOI"))

            # Publication container (journal/conference)
            ctitle = cr.get("container-title") or cr.get("short-container-title")
            if ctitle:
                # crossref gives list
                container = ctitle[0] if isinstance(ctitle, list) else ctitle
                if key == "journal":
                    record.setdefault("JournalName", container)
                else:
                    record.setdefault("ConferenceTitle", container)

            # Volume, issue
            record.setdefault("Volume", cr.get("volume"))
            record.setdefault("Issue", cr.get("issue"))

            # Pages
            page = cr.get("page")
            if page:
                if "-" in page:
                    start, end = page.split("-", 1)
                    record.setdefault("StartPage", start)
                    record.setdefault("EndPage", end)
                else:
                    record.setdefault("StartPage", page)

            # Authors
            authors = cr.get("author")
            if authors:
                record.setdefault(
                    "Authors",
                    [f"{a.get('family', '')}, {a.get('given', '')}".strip(", ")
                     for a in authors]
                )

            # Dates
            dp = cr.get("published-print", cr.get("published-online", {})) \
                .get("date-parts", [])
            if dp and dp[0]:
                parts = dp[0]
                record.setdefault("Year", str(parts[0]))
                record.setdefault("Date", "-".join(map(str, parts)))

        except Exception:
            # silently fail; leave record as-is
            pass

    # ——————————————————————————————
    # 2) Create Zotero item & attach PDF
    # ——————————————————————————————
    def ris_from_dict(self, record: dict, doc_type: str = "report") -> str:
        """
        Build a minimal RIS entry from record,
        only emitting fields present in record.
        """
        # lowercase keys for uniform access
        rec = {k.lower(): v for k, v in record.items()}

        # map doc_type → RIS TY code
        ty_map = {
            "case": "CASE",
            "report": "RPRT",
            "journal": "JOUR",
            "conferencepaper": "CPAPER",
        }
        ris_ty = ty_map.get(doc_type.lower(), "RPRT")

        lines = [f"TY  - {ris_ty}"]

        # Title
        if title := rec.get("title"):
            lines.append(f"TI  - {title}")

        # Author(s)
        if auth := rec.get("author") or rec.get("authors"):
            if isinstance(auth, (list, tuple)):
                for a in auth:
                    lines.append(f"AU  - {a}")
            else:
                lines.append(f"AU  - {auth}")

        # Date or Year
        if date := rec.get("date"):
            lines.append(f"DA  - {date.replace('/', '-')}")
        elif year := rec.get("year"):
            lines.append(f"PY  - {year}")

        # Institution / Publisher
        if inst := rec.get("institution") or rec.get("publisher"):
            lines.append(f"PB  - {inst}")

        # URL (Link)
        if url := rec.get("link") or rec.get("url"):
            lines.append(f"UR  - {url}")

        # DOI
        if doi := rec.get("doi"):
            lines.append(f"DO  - {doi}")

        # SHA-1 note
        if sha := rec.get("sha-1") or rec.get("sha1"):
            lines.append(f"N1  - SHA1: {sha}")

        # Keyword / Source
        if kw := rec.get("source") or rec.get("kw"):
            lines.append(f"KW  - {kw}")

        lines.append("ER  -")
        return "\n".join(lines)


    def create_one_note(self,content="", item_id="", collection_id="", tag="",beginning=False,update=False,
                        ):
        print("creating note")
        new_note=''
        new_content=""

        if content.endswith(".html"):
            # new_content= annotate_html_paragraphs(content)
            with open(content, "r", encoding="utf-8") as f:
                new_content=f.read()
        if content:
            new_content=content
        else:
            new_content =  f'<html><head><title>{tag.strip()}</title><style>body{{font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;background-color:#f0f2f5;color:#333;margin:0;padding:20px;}}.container{{max-width:800px;margin:0 auto;background-color:#fff;padding:30px;border-radius:10px;box-shadow:0 4px 8px rgba(0,0,0,0.1);line-height:1.6;}}h1{{font-size:28px;color:#2c3e50;margin-bottom:20px;border-bottom:2px solid #e67e22;padding-bottom:10px;}}.cabecalho{{font-size:16px;font-weight:bold;color:#555;margin-bottom:20px;padding:10px;background-color:#f9f9f9;border-left:4px solid #3498db;}}.content{{font-size:16px;color:#444;margin-top:20px;line-height:1.8;}}.content p{{margin-bottom:15px;}}.content ul{{list-style-type:disc;margin-left:20px;}}.content li{{margin-bottom:10px;}}.footer{{margin-top:30px;font-size:14px;color:#777;text-align:center;border-top:1px solid #e1e1e1;padding-top:10px;}}</style></head><body><div class="container"><h1>{tag}</h1><div class="content">{content}</div></div></body></html>' if beginning==False else content

        # Create the new note
        if item_id:
            new_note = self.zot.create_items([{
                "itemType": "note",
                'parentItem': item_id,
                "note": new_content,
                'tags': [ {"tag": tag}]

            }])
        if collection_id:
            new_note = self.zot.create_items([{
                "itemType": "note",
                'collections': [collection_id],
                "note": content,
                'tags': [ {"tag": tag}]

            }])
        self.append_tag_to_item(item_id=item_id,new_tag=tag)
        if content.endswith(">"):
            return "note successfully created"
        if update:
            new_note_id = new_note['successful']['0']['data']['key']

            if new_note_id:
                note = self.zot.item(new_note_id)
                note_content = note['data']['note']

                # Update the note content with the new note ID
                updated_content = note_content.replace(f'<em>@{item_id}</em><br>',
                                                       f'<em>@{item_id}</em><br><em>Note ID: {new_note_id}</em><br>')

                updated_note = {
                    'key': note['data']['key'],
                    'version': note['data']['version'],
                    'itemType': note['data']['itemType'],
                    'note': updated_content,
                    'tags': [{"tag": "summary_note"}]
                }
                time.sleep(15)
                try:
                    # Attempt to update the note in Zotero
                    response = self.zot.update_item(updated_note)
                    if response:
                        print("Note updated successfully.")
                        return new_note_id
                    else:
                        print("Failed to update the note.")
                except Exception as e:
                    print(f"An error occurred during the update: {e}")

        return False

    def create_items_from_ris(
            self,
            ris_str: str | list[str],
            collection_key: str,
            zot=None,
            pdf_paths: dict[str, str] | None = None,
    ) -> list[str]:
        """
        Create Zotero items from RIS and attach PDFs (if provided).

        Focus: clean, correct field management — especially AUTHORS.
          • Strip any '{{…}}' artifacts from RIS, split accidental glued authors like '}},{{'.
          • Corporate authors become one-field creators: {"name": "..."}.
          • Personal authors become two-field creators with sane splitting and initials when long.
          • Restrict item types to a safe set: report, journalArticle, conferencePaper, preprint, case, book, bookSection.
          • Strict type-specific fields (no 'publisher' on journalArticle; report uses 'institution'; report DOI in Extra).
          • DOI enrichment scrubs invalid fields and never injects container fields into reports.
          • Retry note creation once on transient 5xx.

        Returns a list of created Zotero item keys.
        """
        from pathlib import Path
        import time
        import rispy
        import requests
        import re

        z = zot or self.zot
        created_keys: list[str] = []
        pdf_paths = pdf_paths or {}

        # ---------------------------
        # Helpers
        # ---------------------------
        def _norm(s: str | None) -> str:
            return (s or "").strip()

        def _lower(s: str | None) -> str:
            return _norm(s).lower()

        def _normalize_doi(raw: str) -> str:
            s = _lower(raw)
            s = s.replace("https://doi.org/", "").replace("http://doi.org/", "")
            if s.startswith("doi:"):
                s = s[4:]
            return s.strip().strip("/")

        # Allowed Zotero types
        _ALLOWED_TYPES = {"report", "journalArticle", "conferencePaper", "preprint", "case", "book", "bookSection"}

        def _decide_type(entry: dict) -> str:
            """
            Decide initial Zotero item type from RIS dict using a restricted set.
            We DO NOT auto-promote reports to journalArticle just because they have a DOI.
            """
            key_src = _lower(entry.get("type_of_reference") or "report").replace("-", " ").replace("_", " ")

            report_aliases = {
                "report", "rprt", "policy document", "policy", "white paper", "whitepaper",
                "brief", "policy brief", "technical report", "tech report", "techreport",
                "discussion paper", "green paper", "consultation paper", "guidance",
                "strategy", "roadmap", "recommendation", "memorandum", "press release",
                "issue brief", "research report", "government report"
            }
            working_paper_aliases = {"working paper", "workingpaper", "wp", "preprint", "unpb"}
            conference_aliases = {"conferencepaper", "conference paper", "conference proceeding", "proceeding"}
            book_aliases = {"book", "monograph"}
            chapter_aliases = {"chapter", "book chapter", "chapter in book"}

            if key_src in working_paper_aliases:
                return "preprint"
            if key_src in conference_aliases:
                return "conferencePaper"
            if key_src in {"case", "legal case"}:
                return "case"
            if key_src in {"journal", "journal article", "article"}:
                return "journalArticle"
            if key_src in book_aliases:
                return "book"
            if key_src in chapter_aliases:
                return "bookSection"
            if key_src in report_aliases or True:
                return "report"

        # ---------------------------
        # Author / creator handling
        # ---------------------------
        ORG_KEYWORDS = (
            "directorate-general", "directorate general", "european commission", "joint research centre",
            "committee", "council", "parliament", "ministry", "department", "office", "authority", "agency",
            "united nations", "oecd", "world bank", "imf", "government", "treasury", "cabinet",
            "university", "institute", "observatory", "secretariat", "services", "commission",
            "government office", "prime minister", "assembly", "state of", "te kawa mataaho", "eprs", "stoa"
        )

        def _is_corporate(name: str) -> bool:
            s = _norm(name)
            if not s:
                return False
            ls = s.lower()
            if "(" in s or ")" in s or "&" in s or any(ch.isdigit() for ch in s):
                return True
            if any(k in ls for k in ORG_KEYWORDS):
                return True
            if "," in s and re.search(r"\b(ministry|department|office|commission|council|committee|authority|agency)\b",
                                      ls):
                return True
            if re.search(r"\b(of|for|and|in|on|de|du|del|der)\b", ls) and len(s.split()) >= 3:
                return True
            if len(s) >= 80 or len(s.split()) >= 9:
                return True
            return False

        def _strip_literal_braces(s: str) -> str:
            """
            Remove surrounding '{{' '}}' if present and clean stray brace seams.
            """
            t = _norm(s)
            if t.startswith("{{") and t.endswith("}}"):
                t = t[2:-2]
            return t.strip()

        def _explode_glued_authors(seq: list[str]) -> list[str]:
            """
            If a single author string accidentally contains multiple authors glued with '}},{{'
            or similar seams, split them, then strip braces.
            """
            out: list[str] = []
            for raw in seq or []:
                s = _norm(raw)
                if not s:
                    continue
                # Split on seams like '}} , {{' or '}},{{' or '}};{{'
                parts = re.split(r"\}\}\s*[,;]?\s*\{\{", s)
                if len(parts) > 1:
                    for p in parts:
                        out.append(_strip_literal_braces(p))
                else:
                    out.append(_strip_literal_braces(s))
            return [p for p in (x.strip() for x in out) if p]

        def _smart_title(s: str) -> str:
            """Title-case with minimal damage (keep ALLCAPS acronyms)."""
            if not s:
                return s
            if s.isupper() and len(s) <= 4:
                return s  # acronym
            return " ".join([w if w.isupper() and len(w) <= 4 else w.capitalize() for w in s.split()])

        def _split_person(name: str) -> tuple[str, str]:
            """
            Split a personal name into (last, first).
            Handles:
              - 'Last, First'
              - 'SURNAME First Middle'
              - 'First Middle Last'
            """
            n = _norm(name)
            if "," in n:
                last, first = [p.strip() for p in n.split(",", 1)]
                return (last, first)

            toks = n.split()
            if len(toks) == 1:
                return (toks[0], "")

            # Pattern: SURNAME First (first token all caps)
            if toks[0].isupper() and len(toks) >= 2:
                last = _smart_title(toks[0].lower())
                first = " ".join(toks[1:])
                return (last, first)

            # Default: First ... Last
            last = toks[-1]
            first = " ".join(toks[:-1])
            return (last, first)

        def _initials(given: str) -> str:
            parts = [p for p in re.split(r"\s+", _norm(given)) if p]
            if len(parts) > 2 or len(given) > 20:
                return " ".join(f"{p[0]}." if re.match(r"[A-Za-zÀ-ÖØ-öø-ÿ]", p) else p for p in parts)
            return given

        def _creators_from_authors(authors_field) -> list[dict]:
            """
            Convert RIS 'authors' (possibly containing '{{...}}' or glued seams) into Zotero creators.
              - Corporate → {"name": "...", "creatorType": "author"}  (one-field)
              - Person    → {"firstName": "...", "lastName": "...", "creatorType": "author"}
            """
            # rispy gives a list; be defensive for str
            if isinstance(authors_field, str):
                candidate_list = [authors_field]
            else:
                candidate_list = list(authors_field or [])

            # 1) split glued seams and strip braces
            flat = _explode_glued_authors(candidate_list)

            # 2) final creators
            creators: list[dict] = []
            for s in flat:
                if not s:
                    continue
                if _is_corporate(s):
                    creators.append({"creatorType": "author", "name": s})
                else:
                    last, first = _split_person(s)
                    creators.append({"creatorType": "author", "firstName": _initials(first), "lastName": last})
            return creators

        # ---------------------------
        # Attachment helper
        # ---------------------------
        def _attach_pdf_if_available(parent_key: str, entry: dict):
            for k in (_norm(entry.get("doi")), _norm(entry.get("url")), _norm(entry.get("title"))):
                if not k:
                    continue
                path = (pdf_paths or {}).get(k)
                if not path:
                    continue
                p = Path(path)
                if p.is_file() and p.suffix.lower() == ".pdf":
                    try:
                        z.attachment_simple([str(p)], parentid=parent_key)
                        print(f"✔ Attached '{p.name}' to {parent_key}")
                    except Exception as e:
                        print(f"Warning: created item {parent_key} but failed to attach PDF '{p}': {e}")
                else:
                    print(f"Info: pdf_paths matched '{k}' → '{path}', but not a readable .pdf; skipping.")
                break

        # ---------------------------
        # DOI enrichment helpers
        # ---------------------------
        def _supports_doi(item_type: str) -> bool:
            """Only these Zotero types accept a DOI field reliably."""
            return item_type in {"journalArticle", "conferencePaper", "preprint"}

        def _extra_add_line(data: dict, line: str):
            extra = _norm(data.get("extra"))
            data["extra"] = (extra + ("\n" if extra else "") + line).strip()

        def _move_doi_to_extra(data: dict):
            doi_val = _norm(data.get("DOI"))
            if not doi_val:
                return
            if "DOI:" not in _norm(data.get("extra")):
                _extra_add_line(data, f"DOI: {doi_val}")
            data.pop("DOI", None)

        def _fetch_doi_metadata(doi: str) -> dict | None:
            headers = {"User-Agent": "ZoteroEnricher/1.0 (mailto:you@example.com)"}
            d = _normalize_doi(doi)

            # Crossref
            try:
                r = requests.get(f"https://api.crossref.org/works/{d}", headers=headers, timeout=15)
                if r.status_code == 200:
                    m = r.json().get("message", {})
                    return {
                        "cr_type": m.get("type", ""),  # e.g., journal-article, report, posted-content, book
                        "title": (m.get("title") or [""])[0],
                        "container": (m.get("container-title") or [""])[0],
                        "volume": m.get("volume") or "",
                        "issue": m.get("issue") or "",
                        "pages": m.get("page") or "",
                        "date": "-".join(str(x) for x in (m.get("issued", {}).get("date-parts", [[None]])[0]) if x),
                        "publisher": m.get("publisher") or "",
                        "url": (m.get("URL") or ""),
                        "language": (m.get("language") or ""),
                        "authors": [
                            {
                                "firstName": a.get("given", "") or "",
                                "lastName": a.get("family", "") or (a.get("name", "") or "")
                            }
                            for a in (m.get("author") or []) if isinstance(a, dict)
                        ],
                    }
            except Exception:
                pass

            # DataCite
            try:
                r = requests.get(f"https://api.datacite.org/dois/{d}", headers=headers, timeout=15)
                if r.status_code == 200:
                    m = r.json().get("data", {}).get("attributes", {})
                    titles = m.get("titles") or []
                    title = titles[0].get("title", "") if isinstance(titles, list) and titles else ""
                    cont = m.get("containerTitles") or []
                    container = cont[0] if cont else ""
                    issued = m.get("published") or m.get("publicationYear")
                    creators = []
                    for a in (m.get("creators") or []):
                        if not isinstance(a, dict):
                            continue
                        given = a.get("givenName", "") or ""
                        family = a.get("familyName", "") or a.get("name", "") or ""
                        creators.append({"firstName": given, "lastName": family})
                    return {
                        "cr_type": (m.get("types", {}).get("resourceTypeGeneral", "") or "").lower(),
                        "title": title,
                        "container": container,
                        "volume": "",
                        "issue": "",
                        "pages": "",
                        "date": str(issued) if issued else "",
                        "publisher": m.get("publisher") or "",
                        "url": (m.get("url") or m.get("identifier", "")) or "",
                        "language": "",
                        "authors": creators,
                    }
            except Exception:
                pass
            return None

        def _map_crossref_type_to_zotero(cr_type: str) -> str | None:
            t = (cr_type or "").lower()
            return {
                "journal-article": "journalArticle",
                "proceedings-article": "conferencePaper",
                "book-chapter": "bookSection",
                "book": "book",
                "posted-content": "preprint",
                "report": "report",
                "journalarticle": "journalArticle",  # DataCite variant
                "preprint": "preprint",
                "text": None,
            }.get(t, None)

        def _scrub_invalid_fields_for_type(data: dict):
            """
            Remove or relocate fields invalid for the target Zotero type to avoid 400s on PATCH.
            """
            t = data.get("itemType")

            # DOI: keep only for supported types; otherwise move to Extra
            if not _supports_doi(t) and _norm(data.get("DOI")):
                _move_doi_to_extra(data)

            # Container-only fields
            if t != "journalArticle":
                data.pop("publicationTitle", None)
                data.pop("volume", None)
                data.pop("issue", None)
            if t != "conferencePaper":
                data.pop("proceedingsTitle", None)

            # Journal articles don't support 'publisher'
            if t == "journalArticle":
                data.pop("publisher", None)

            # Report specifics: use 'institution'; drop 'publisher'
            if t == "report":
                data.pop("publisher", None)

            # Most types don't support 'institution' except report/thesis
            if t not in {"report", "thesis"}:
                data.pop("institution", None)

        def _apply_doi_metadata(zot_item: dict, meta: dict, allow_retype: bool = True,
                                overwrite_blank_only: bool = True):
            """
            Merge DOI metadata into an existing Zotero item dict safely.
            """
            data = zot_item["data"]
            current_type = data.get("itemType")
            target_type = _map_crossref_type_to_zotero(meta.get("cr_type")) or current_type

            has_container = bool(_norm(meta.get("container")))
            if allow_retype and current_type == "report" and has_container:
                target_type = "journalArticle"

            if allow_retype and target_type and target_type != current_type:
                data["itemType"] = target_type

            final_type = data.get("itemType")

            def setf(field, value):
                if value is None:
                    return
                v = _norm(str(value))
                if not v:
                    return
                if overwrite_blank_only and _norm(data.get(field)):
                    return
                data[field] = v

            # Title, date, url, language
            setf("title", meta.get("title"))
            setf("date", meta.get("date"))
            setf("url", meta.get("url"))
            setf("language", meta.get("language"))

            # Publisher vs Institution
            if final_type == "report":
                setf("institution", meta.get("publisher"))
            elif final_type in {"book", "bookSection"}:
                setf("publisher", meta.get("publisher"))

            # Container mapping
            if final_type == "journalArticle":
                setf("publicationTitle", meta.get("container"))
                setf("volume", meta.get("volume"))
                setf("issue", meta.get("issue"))
                setf("pages", meta.get("pages"))
            elif final_type == "conferencePaper":
                setf("proceedingsTitle", meta.get("container"))
                setf("pages", meta.get("pages"))

            # Authors (only if empty or overwrite)
            if meta.get("authors"):
                if not overwrite_blank_only or not data.get("creators"):
                    data["creators"] = [
                        {"creatorType": "author", "firstName": a.get("firstName", ""),
                         "lastName": a.get("lastName", "")}
                        for a in meta["authors"]
                    ]

            # Final safety scrub (handles DOI relocation for non-supported types like 'book')
            _scrub_invalid_fields_for_type(data)
            return zot_item

        # ---------------------------
        # Parse RIS input
        # ---------------------------
        if isinstance(ris_str, list):
            entries = []
            for chunk in ris_str:
                entries.extend(rispy.loads(chunk))
        else:
            entries = rispy.loads(ris_str)

        # ---------------------------
        # Create items
        # ---------------------------
        for idx, entry in enumerate(entries):
            try:
                zot_type = _decide_type(entry)
                if zot_type not in _ALLOWED_TYPES:
                    zot_type = "report"

                item = z.item_template(zot_type)
                item["collections"] = [collection_key]

                # Title
                if entry.get("title"):
                    item["title"] = entry["title"]

                # Creators from RIS authors (strip '{{}}', split glued seams, handle corporate/person correctly)
                if entry.get("authors"):
                    item["creators"] = _creators_from_authors(entry.get("authors"))

                # Date
                if entry.get("date"):
                    item["date"] = entry["date"]

                # URL
                urls = entry.get("urls")
                if urls and isinstance(urls, list) and urls:
                    item["url"] = urls[0]
                elif entry.get("url"):
                    item["url"] = entry["url"]

                # Abstract
                if entry.get("abstract"):
                    item["abstractNote"] = entry["abstract"]

                # Tags
                kw = entry.get("keywords") or []
                if isinstance(kw, str):
                    kw = [k.strip() for k in kw.split(";") if k.strip()]
                if kw:
                    item["tags"] = [{"tag": k} for k in kw]

                # Type-specific fields
                if zot_type == "report":
                    if entry.get("publisher"):
                        item["institution"] = entry["publisher"]
                    elif entry.get("institution"):
                        item["institution"] = entry["institution"]
                    if entry.get("doi"):
                        # report: DOI → Extra
                        _extra_add_line(item, f"DOI: {entry['doi']}")

                elif zot_type == "journalArticle":
                    if entry.get("journal_name"):
                        item["publicationTitle"] = entry["journal_name"]
                    if entry.get("volume"):
                        item["volume"] = entry["volume"]
                    if entry.get("issue"):
                        item["issue"] = entry["issue"]
                    if entry.get("pages"):
                        item["pages"] = entry["pages"]
                    else:
                        sp = _norm(entry.get("start_page"))
                        ep = _norm(entry.get("end_page"))
                        if sp or ep:
                            item["pages"] = f"{sp}-{ep}".strip("-")
                    if entry.get("doi"):
                        item["DOI"] = entry["doi"]

                elif zot_type == "conferencePaper":
                    if entry.get("conference_title"):
                        item["proceedingsTitle"] = entry["conference_title"]
                    if entry.get("conference_location"):
                        item["place"] = entry["conference_location"]
                    if entry.get("doi"):
                        item["DOI"] = entry["doi"]

                elif zot_type in {"book", "bookSection"}:
                    if entry.get("publisher"):
                        item["publisher"] = entry["publisher"]
                    if entry.get("pages"):
                        item["pages"] = entry["pages"]
                    # books/sections: DOI → Extra (not a valid field)
                    if entry.get("doi"):
                        _extra_add_line(item, f"DOI: {entry['doi']}")

                elif zot_type == "preprint":
                    if entry.get("doi"):
                        item["DOI"] = entry["doi"]

                # Create parent in Zotero
                resp = z.create_items([item])
                if not ("successful" in resp and "0" in resp["successful"]):
                    raise RuntimeError(f"create_items failed: {resp}")
                zid = resp["successful"]["0"]["key"]
                created_keys.append(zid)

                # DOI enrichment — safe for all types; also relocates DOI when retyping to non-supported types (book)
                doi_raw = entry.get("doi")
                if doi_raw:
                    meta = _fetch_doi_metadata(doi_raw)
                    if meta:
                        current = z.item(zid)
                        patched = _apply_doi_metadata(current, meta, allow_retype=True, overwrite_blank_only=True)
                        try:
                            z.update_item(patched)
                            time.sleep(0.2)
                            print(f"✓ DOI-enriched {zid}")
                        except Exception as e:
                            print(f"Note: enrichment failed for {zid}: {e}")

                # Notes from RIS (N1) as child note — retry once on 5xx
                ris_notes = entry.get("notes") or []
                if isinstance(ris_notes, str):
                    ris_notes = [ris_notes]
                if ris_notes:
                    note_item = z.item_template("note")
                    note_item["note"] = "<hr/>".join(ris_notes)
                    note_item["parentItem"] = zid
                    try:
                        z.create_items([note_item])
                    except Exception as e:
                        msg = str(e)
                        if "502" in msg or "503" in msg or "504" in msg:
                            time.sleep(1.0)
                            try:
                                z.create_items([note_item])
                            except Exception as e2:
                                print(f"Warning: item {zid} note creation failed after retry: {e2}")
                        else:
                            print(f"Warning: item {zid} note creation failed: {e}")

                # Optional PDF attachment
                _attach_pdf_if_available(zid, entry)

                print(f"✔ Created {zot_type} → key={zid} (idx={idx})")

            except Exception as e:
                print(f"✖ Failed to create item at index {idx}: {e}")

        return created_keys

    def check_item_exists_in_zotero(self, title: str, pdf_url: str, collection_key: str) -> bool:
        """
        Checks if an item with the given title OR URL already exists in the specified Zotero collection.
        Returns True if exists, False otherwise.
        This function needs to be implemented using your specific Zotero library.
        """
        # Placeholder implementation - replace with your Zotero library calls
        logging.log.debug(f"Checking if item '{title}' or URL '{pdf_url}' exists in collection '{collection_key}'")
        try:
            # Search by title in the collection
            items_by_title = self.items(collection_id=collection_key, q=title, itemType='-attachment', limit=5)
            if items_by_title:
                logging.log.info(f"Item with title '{title}' found in collection '{collection_key}'. Assuming it exists.")
                return True

            # Search by URL (more reliable for uniqueness if title is generic)
            # This might require iterating through all items in the collection if direct URL search isn't efficient
            items_in_collection = self.zot.everything(
                self.zot.items(collection_id=collection_key, itemType='-attachment'))
            for item in items_in_collection:
                if item.get('data', {}).get('url') == pdf_url:
                    logging.log.info(f"Item with URL '{pdf_url}' found in collection '{collection_key}'. Assuming it exists.")
                    return True

        except Exception as e:  # Replace with specific Zotero library errors
            logging.error(f"Error checking for existing item '{title}' in collection '{collection_key}': {e}")
        return False

    def create_zotero_item_from_entry(self, entry: dict, target_collection_key: str,
                                      pdf_local_path: Path) -> str | None:
        """
        Creates a Zotero item from a scraped entry dictionary, places it in the target collection,
        and attaches the downloaded PDF.
        """
        log.info(f"Preparing to create Zotero item for: '{entry['title']}' in collection {target_collection_key}")

        # Determine Zotero item type
        # "Judgments" from ICJ are typically "case" type in Zotero.
        doc_type_lower = entry.get('doc_type', "Unknown Type").lower()
        zot_item_type = "case"  # Default for ICJ Judgments
        if "report" in doc_type_lower:  # Example, adjust as needed
            zot_item_type = "report"

        log.debug(f"Mapping to Zotero item type: '{zot_item_type}' based on doc_type '{entry.get('doc_type')}'")

        item_template = self.zot.item_template(zot_item_type)
        item_template['collections'] = [target_collection_key]
        item_template['title'] = entry['title']  # Document title, e.g., "Judgment of 19 May 2025"

        # Field mapping based on Zotero item type
        if zot_item_type == "case":
            item_template['caseName'] = entry['case_name']  # e.g., "Land and Maritime Delimitation..."
            item_template['court'] = entry.get('place_of_publication', "International Court of Justice")
            if entry['date'] != "Unknown Date":
                item_template['dateDecided'] = entry['date']
            item_template['reporter'] = "ICJ Reports"  # Or similar, if applicable
            item_template['url'] = entry['pdf_url']
            item_template['archive'] = "ICJ Website"
            item_template['language'] = entry.get('language', 'en')
            item_template[
                'abstractNote'] = f"Document Type (ICJ): {entry['doc_type']}\nCase ID (ICJ): {entry['case_id']}"
            # Add shortTitle if desired, could be same as title or a more concise version
            # item_template['shortTitle'] = entry['title']
        elif zot_item_type == "report":
            item_template['institution'] = "International Court of Justice"
            if entry['date'] != "Unknown Date":
                item_template['date'] = entry['date']
            item_template['url'] = entry['pdf_url']
            item_template['language'] = entry.get('language', 'en')
            item_template[
                'abstractNote'] = f"Original Document Type: {entry['doc_type']}\nCase: {entry['case_name']} (ICJ Case ID: {entry['case_id']})"
        else:  # Generic mapping for other types if you expand
            if entry['date'] != "Unknown Date":
                item_template['date'] = entry['date']
            item_template['url'] = entry['pdf_url']
            item_template[
                'abstractNote'] = f"Document Type (ICJ): {entry['doc_type']}\nCase: {entry['case_name']} (ICJ Case ID: {entry['case_id']})"

        # Tags
        tags = ["ICJ", entry.get('doc_type', "Document").replace(" ", "_")]
        if entry.get('year') != "Unknown Year":
            tags.append(entry['year'])
        item_template['tags'] = [{'tag': t} for t in tags]

        log.debug(f"Zotero item template prepared: {json.dumps(item_template, indent=2)}")

        try:
            resp = self.zot.create_items([item_template])
            if resp and 'successful' in resp and '0' in resp['successful'] and 'key' in resp['successful']['0']:
                item_key = resp['successful']['0']['key']
                item_version = resp['successful']['0']['version']
                log.info(f"Successfully created Zotero item '{entry['title']}' with key {item_key}")

                # Attach PDF
                if pdf_local_path and pdf_local_path.exists():
                    log.info(f"Attaching PDF: {pdf_local_path} to item {item_key}")
                    # Pyzotero's attachment_simple expects a list of file paths
                    attach_resp = self.zot.attachment_simple([str(pdf_local_path)], parentid=item_key)
                    log.debug(f"Attachment response: {attach_resp}")
                    if attach_resp:  # Pyzotero returns the ID of the attachment item on success.
                        log.info(f"Successfully attached PDF '{pdf_local_path.name}' to item {item_key}.")
                    else:
                        log.warning(f"PDF attachment may have failed for item {item_key}. Response: {attach_resp}")
                else:
                    log.warning(
                        f"PDF path {pdf_local_path} not found or invalid. Skipping attachment for item {item_key}.")
                return item_key
            else:
                log.error(f"Failed to create Zotero item for '{entry['title']}'. Response: {resp}")
                return None
        except Exception as e:  # Replace with specific Zotero library errors e.g. zotero_errors.HTTPError
            log.error(f"Zotero API error while creating item or attaching PDF for '{entry['title']}': {e}")
            return None


    def get_pdf_path_for_item(self, parent_key):
        """
        Return the first on-disk PDF file path for any Zotero attachment under `parent_key`.
        Looks in Zotero’s storage folder for each child attachment key and grabs the first *.pdf.
        """
        import logging
        from pathlib import Path

        base = self.zotero_storage_base
        if not isinstance(base, Path) or not base.is_dir():
            logging.error(f"Invalid zotero_storage_base: {base}")
            return None

        try:
            children = self.zot.children(parent_key)
        except Exception as exc:
            logging.error(f"Failed to fetch children for {parent_key}: {exc}")
            return None

        for child in children:
            data = child.get("data", {})
            # only attachments that look like PDFs
            if data.get("itemType") != "attachment":
                continue
            fn = data.get("filename", "").lower()
            ct = data.get("contentType", "")
            if "pdf" not in ct and not fn.endswith(".pdf"):
                continue

            att_key = data.get("key")
            storage_dir = base / att_key
            if not storage_dir.is_dir():
                continue

            # return the first .pdf in that directory
            try:
                for f in storage_dir.iterdir():
                    if f.is_file() and f.suffix.lower() == ".pdf":
                        return str(f.resolve())
            except Exception as exc:
                logging.warning(f"Error iterating {storage_dir}: {exc}")
                continue

        return None

    def get_pdf_path(self, attachment_id):
        """
        Finds the full local path to the PDF file associated with a Zotero attachment key.
        Uses an in-memory cache to avoid repeated searches.

        Args:
            attachment_id (str): The unique key of the Zotero attachment item.

        Returns:
            str | None: The absolute path to the PDF file if found, otherwise None.
        """

        if not attachment_id or not isinstance(attachment_id, str):
            # print(f"DEBUG: get_pdf_path called with invalid attachment_id: {attachment_id}")
            return None

        # 1. --- Check Cache ---
        if attachment_id in self.pdf_path_cache:
            # Retrieve from cache - could be a path string or None (if previously failed)
            cached_path = self.pdf_path_cache[attachment_id]

            # return cached_path  # Return cached result directly

        # print(f"DEBUG: Cache miss for {attachment_id}. Searching filesystem...")

        # 2. --- Validate Storage Base and Construct Search Directory ---
        # Crucial check: Ensure the base storage path is valid before proceeding
        if self.zotero_storage_base is None or not isinstance(self.zotero_storage_base, Path):
            print(
                f"ERROR get_pdf_path: self.zotero_storage_base is not a valid Path object ({self.zotero_storage_base}). Cannot search for {attachment_id}.")
            self.pdf_path_cache[attachment_id] = None  # Cache failure
            return None
        if not self.zotero_storage_base.is_dir():
            print(
                f"ERROR get_pdf_path: self.zotero_storage_base directory does not exist or is not a directory ({self.zotero_storage_base}). Cannot search for {attachment_id}.")
            self.pdf_path_cache[attachment_id] = None  # Cache failure
            return None

        try:
            # The directory containing the attachment is usually named after the attachment key
            potential_dir = self.zotero_storage_base / attachment_id
        except TypeError:
            # This can happen if attachment_id is not a string/path-compatible
            print(
                f"ERROR: TypeError constructing potential_dir for {attachment_id} with base {self.zotero_storage_base}.")
            self.pdf_path_cache[attachment_id] = None  # Cache failure
            return None

        # print(f"DEBUG: Searching in directory: {potential_dir}")

        if not potential_dir.is_dir():
            # print(f"DEBUG: Attachment directory not found: {potential_dir}")
            self.pdf_path_cache[attachment_id] = None  # Cache the fact that it's not found
            return None

        # 3. --- Search for PDF using Path.rglob ---
        found_pdf_path = None
        try:
            # Using Path.rglob is generally robust and concise
            pdf_files = list(potential_dir.rglob('*.pdf'))  # Recursively search for .pdf files
            if pdf_files:
                # Simple approach: take the first PDF found.
                # More complex logic could be added here if multiple PDFs might exist
                # (e.g., check for original filename match from Zotero metadata if available)
                found_pdf_path = str(pdf_files[0].resolve())  # Get absolute path as string
                # print(f"DEBUG: Found PDF for {attachment_id}: {found_pdf_path}")
            # else:
            # print(f"DEBUG: No PDF file found inside {potential_dir} for {attachment_id}")

        except TypeError as te:
            # Catch the specific error if potential_dir was somehow invalid for rglob
            print(f"ERROR: TypeError during PDF search (rglob) for {attachment_id} in {potential_dir}: {te}")
            # This path should ideally be caught by earlier checks, but included for safety
        except Exception as e:
            print(f"ERROR: Unexpected exception during PDF search for {attachment_id} in {potential_dir}: {e}")
            # found_pdf_path remains None

        # 4. --- Store in Cache & Return ---
        # Store the result (either the path string or None) in the in-memory cache
        self.pdf_path_cache[attachment_id] = found_pdf_path
        # print(f"DEBUG: Caching result for {attachment_id}: {found_pdf_path}")
        return found_pdf_path

    def update_note(self, note, content, tag=None):
        if tag is None: tag = note['data'].get('tags', [])
        updated_note = {
            'key': note['data']['key'],
            'version': note['data']['version'],
            'itemType': note['data']['itemType'],
            'note': content,
            'tags': tag
        }
        response = None
        # Update the note in Zotero
        try:
            response = self.zot.update_item(updated_note)
            if response:
                print("Note updated successfully.")
            else:
                print("Failed to update the note.")
        except Exception as e:
            print(f"An error occurred during the update: {e}")
        return response

    def _check_global_name_existence(self, name_lower):
        """
        Checks the *entire* library for collections matching the name (case-insensitive),
        handling API pagination.
        (Assumes this is a method of a class with self.zot)

        Args:
            name_lower (str): The lowercase name to search for.

        Returns:
            tuple: (list_of_all_matches, list_of_non_deleted_matches, list_of_deleted_matches)
                   Returns (None, None, None) if the API call fails.
        """
        all_matches = []
        non_deleted_matches = []
        deleted_matches = []
        logging.debug(f"Starting global check for collection name containing: '{name_lower}'")
        try:
            # *** KEY CHANGE: Use zot.everything() to fetch ALL pages of collections ***
            all_colls_response = self.zot.everything(self.zot.collections())
            # Log how many were actually fetched after pagination
            logging.debug(f"Fetched {len(all_colls_response)} total collections from library for global check.")

            if not isinstance(all_colls_response, list):
                # This check might be less relevant now that everything() should ensure a list, but keep for safety
                logging.error(
                    f"[_check_global_name_existence] Failed to fetch collections correctly, expected list, received type: {type(all_colls_response)}")
                return None, None, None  # Signal API error/unexpected response

            # Iterate through all fetched collections
            for coll in all_colls_response:
                data = coll.get('data', {})
                coll_name = data.get('name')

                # Check if the name matches (case-insensitive)
                if coll_name and coll_name.lower() == name_lower:
                    all_matches.append(coll)
                    # Check deleted status
                    is_deleted = coll.get('deleted', False) or data.get('deleted', False)
                    if is_deleted:
                        deleted_matches.append(coll)
                    else:
                        non_deleted_matches.append(coll)

            # Log detailed findings before returning
            logging.debug(f"Global check results for exact name '{name_lower}': "
                          f"Total Matches={len(all_matches)}, "
                          f"Non-Deleted={len(non_deleted_matches)}, "
                          f"Deleted={len(deleted_matches)}")
            return all_matches, non_deleted_matches, deleted_matches

        except Exception as e:
            logging.error(
                f"[_check_global_name_existence] Error during 'everything' fetch or processing for '{name_lower}': {e}",
                exc_info=True)
            return None, None, None  # Signal error

    # # ----- UNIFIED FIND/CREATE LOGIC WRAPPER (with indexed interactive deletion) -----
    def _find_or_create_collection_logic(self, name, parent_key=None, trash=False):
        """
        Internal logic: Finds globally unique non-deleted collection by name,
        handles duplicates interactively (allowing indexed deletion), or creates it.

        Args:
            name (str): The collection name (already trimmed).
            parent_key (str, optional): The parent key if creating a subcollection.

        Returns:
            str: The collection key if found uniquely, resolved via deletion, or newly created.
            None: If duplicates persist after user interaction, only deleted exists, API/creation fails.
        """
        name_lower = name.lower()
        location_desc = f"under parent '{parent_key}'" if parent_key else "as top-level"

        # --- GLOBAL Check ---
        all_matches, non_deleted_matches, deleted_matches = self._check_global_name_existence(name_lower)

        if all_matches is None:
            logging.error(f"Global existence check failed for '{name}'. Cannot proceed.")
            return None

        total_found_globally = len(all_matches)
        num_non_deleted_globally = len(non_deleted_matches)
        num_deleted_globally = len(deleted_matches)

        logging.debug(
            f"Global check for '{name}': Found={total_found_globally}, Non-Deleted={num_non_deleted_globally}, Deleted={num_deleted_globally}")

        # --- Decision Logic ---

        # Case 1: Exactly ONE non-deleted collection exists globally
        if num_non_deleted_globally == 1:
            found_coll = non_deleted_matches[0]
            key = found_coll.get('key')
            coll_data = found_coll.get('data', {})
            parent = coll_data.get('parentCollection')
            found_location = "as top-level" if not parent else f"under parent '{parent}'"
            logging.info(
                f"Found unique existing non-deleted collection '{name}' with key '{key}' (located {found_location}). Returning key.")
            return key
        # Case 1b: Exactly ONE non-deleted collection exists globally



        # Case 2: Multiple non-deleted collections exist globally (Interactive Resolution)
        elif num_non_deleted_globally > 1:
            print("-" * 40)
            print(f"[CONFLICT] Found {num_non_deleted_globally} non-deleted collections named '{name}'.")
            print("Please choose which one(s) to DELETE.")
            print("-" * 40)

            # Prepare data with dates for sorting and display
            collections_with_dates = []
            for coll in non_deleted_matches:
                date_str = coll['meta'].get('dateAdded', coll['meta'].get('createdDate'))
                parsed_date = datetime.now(timezone.utc)
                location = "Top-Level" if not coll.get('data', {}).get(
                    'parentCollection') else f"Sub of '{coll.get('data', {}).get('parentCollection')}'"
                if date_str:
                    try:
                        if date_str.endswith('Z'): date_str = date_str[:-1] + '+00:00'
                        parsed_date = datetime.fromisoformat(date_str)
                        if parsed_date.tzinfo is None: parsed_date = parsed_date.replace(tzinfo=timezone.utc)
                    except ValueError:
                        logging.warning(
                            f"Could not parse date '{date_str}' for coll key {coll['key']}. Treating as newest.")
                else:
                    logging.warning(f"Missing dateAdded/createdDate for coll key {coll['key']}. Treating as newest.")
                collections_with_dates.append({'data': coll, 'date': parsed_date, 'location': location})

            # Sort by date, oldest first
            collections_with_dates.sort(key=lambda x: x['date'])
            oldest_coll_info = collections_with_dates[0]  # Index 0 in sorted list is oldest
            oldest_display_index = 1  # The oldest will always be displayed as option 1

            print("Non-Deleted Collections Found (Select number(s) to DELETE):")
            valid_indices_for_deletion = set()
            for i, coll_info in enumerate(collections_with_dates):
                display_index = i + 1
                is_oldest_marker = "(Oldest - Cannot Delete)" if i == 0 else ""
                print(f"  {display_index}. Key: {coll_info['data']['key']}, "
                      f"Location: {coll_info['location']}, "
                      f"Added: {coll_info['date'].strftime('%Y-%m-%d %H:%M:%S %Z')} {is_oldest_marker}")
                # Add index to valid deletion set only if NOT the oldest
                valid_indices_for_deletion.add(display_index)

            none_option_index = len(collections_with_dates) + 1
            print(f"  {none_option_index}. Delete NONE (Abort)")
            print("-" * 40)

            while True:
                raw_input = input(
                    f"Enter number(s) to DELETE, separated by commas (e.g., 2,3), or {none_option_index} to abort: ").strip()
                if not raw_input:
                    print("No input provided. Please enter selection.")
                    continue

                selected_indices_to_delete = set()
                input_parts = [part.strip() for part in raw_input.split(',')]
                valid_input = True
                try:
                    for part in input_parts:
                        index = int(part)
                        # Check if the input is the "None" option
                        if index == none_option_index:
                            if len(input_parts) > 1:
                                print(
                                    f"Error: Cannot select '{none_option_index}' (Delete None) along with other indices.")
                                valid_input = False
                                break  # Exit inner loop
                            # Valid "None" selection
                            selected_indices_to_delete.add(none_option_index)
                            break  # Exit inner loop as action is determined

                        # Check if the input is a valid index for deletion
                        elif index in valid_indices_for_deletion:
                            selected_indices_to_delete.add(index)
                        elif index == oldest_display_index:
                            print(f"Error: Cannot select index {oldest_display_index} (the oldest collection).")
                            valid_input = False
                            break
                        else:
                            print(
                                f"Error: Invalid index '{index}'. Please choose from {sorted(list(valid_indices_for_deletion))} or {none_option_index}.")
                            valid_input = False
                            break  # Exit inner loop
                    if not valid_input:
                        continue  # Re-prompt outer loop

                except ValueError:
                    print("Error: Input must be numbers separated by commas.")
                    continue  # Re-prompt outer loop

                # --- Process Valid Selection ---
                if none_option_index in selected_indices_to_delete:
                    logging.warning(f"User chose not to resolve duplicate collections for '{name}'. Ambiguity remains.")
                    print("Delete None selected. No action taken. Ambiguity requires manual resolution in Zotero.")
                    print("none valid selection")
                    return None  # Return None as ambiguity wasn't resolved

                elif selected_indices_to_delete:  # User selected one or more valid indices to delete
                    collections_to_delete_dicts = []
                    for index_to_delete in selected_indices_to_delete:
                        # Map display index (1-based) back to list index (0-based)
                        list_index = index_to_delete - 1
                        collections_to_delete_dicts.append(collections_with_dates[list_index]['data'])

                    logging.warning(
                        f"User confirmed deletion of {len(collections_to_delete_dicts)} collections for '{name}'.")
                    deleted_count = 0
                    errors = []
                    print("-" * 40)
                    print("Attempting deletions...")
                    for coll_to_delete in collections_to_delete_dicts:
                        key_to_delete = coll_to_delete['key']
                        version_to_delete = coll_to_delete['version']
                        logging.warning(
                            f"Attempting to delete collection key: {key_to_delete} (Version: {version_to_delete})")
                        try:
                            self.zot.delete_collection(coll_to_delete)
                            logging.info(f"Successfully deleted collection key: {key_to_delete}")
                            print(f"- Deleted: Key={key_to_delete}")
                            deleted_count += 1
                        except Exception as e:
                            error_msg = f"Failed to delete collection key {key_to_delete}: {e}"
                            logging.error(error_msg, exc_info=True)
                            print(f"- FAILED to delete Key={key_to_delete}: {e}")
                            errors.append(error_msg)

                    print("-" * 40)
                    if errors:
                        print("[DELETION ERRORS ENCOUNTERED]")
                        # Errors were already printed above
                        print("Proceeding with the oldest collection despite deletion errors.")
                    else:
                        print(f"Successfully deleted {deleted_count} selected collection(s).")

                    # Return the key of the oldest collection that was kept
                    oldest_key = oldest_coll_info['data']['key']
                    logging.info(f"Proceeding with oldest collection key: {oldest_key}")
                    return oldest_key

                else:
                    # Should not happen if validation is correct, but handle defensively
                    print("No valid deletion indices were selected. Please try again.")
                    continue  # Re-prompt outer loop

            # --- Case 3: Only deleted collections exist globally ---
        if num_non_deleted_globally == 0 and num_deleted_globally > 0:
            keys_found = [c['key'] for c in deleted_matches]
            logging.warning(
                f"Only trashed instances of '{name}' found (Keys: {keys_found}). "
                "Purging them and creating anew."
            )

            # Permanently delete trashed collections
            for key in keys_found:


                try:
                    while True:
                        r= input("delete trash collection key? (y/n): ")
                        if r == "y":

                            self.zot.delete_collection(key)
                            break
                        if r == "n":
                            break
                        logging.info(f"Permanently deleted trashed collection key: {key}")
                except Exception as e:
                    logging.error(f"Failed to delete trashed collection {key}: {e}", exc_info=True)

            # Now proceed to create a fresh collection
            logging.info(f"Creating new collection '{name}' {location_desc}…")
            new_coll = {'name': name}
            if parent_key:
                new_coll['parentCollection'] = parent_key

            try:
                resp = self.zot.create_collections([new_coll])
                # success case
                if resp.get('success', {}).get('0'):
                    new_key = resp['success']['0']
                    logging.info(
                        f"Created new collection '{name}' {location_desc} with key '{new_key}'."
                    )
                    return new_key
                # failure path
                err = resp.get('failed', {}).get('0', {})
                logging.error(
                    f"Failed to create collection '{name}'. Code={err.get('code')} "
                    f"Msg={err.get('message')}"
                )
                return None
            except Exception as e:
                logging.error(f"Exception during creation of '{name}': {e}", exc_info=True)
                return None

        # Case 4: Name does NOT exist anywhere globally (Safe to create)
        elif total_found_globally == 0:
            # --- Creation logic remains the same as previous version ---
            logging.info(f"Name '{name}' is globally unique. Creating new collection {location_desc}...")
            new_coll_data = {'name': name}
            if parent_key:
                new_coll_data['parentCollection'] = parent_key
            try:
                if parent_key:
                    parent_info = self.zot.collection(parent_key)
                    if not parent_info:
                        logging.error(
                            f"Parent collection with key '{parent_key}' not found. Cannot create subcollection '{name}'.")
                        return None

                resp = self.zot.create_collections([new_coll_data])
                if resp and isinstance(resp, dict) and resp.get('success') and isinstance(resp['success'],
                                                                                          dict) and '0' in resp[
                    'success']:
                    new_key = resp['success']['0']
                    logging.info(
                        f"Successfully created new collection '{name}' ({location_desc}) with key '{new_key}'.")
                    return new_key
                elif resp and isinstance(resp, dict) and resp.get('failed'):
                    error_details = resp['failed'].get('0', {})
                    if parent_key and 'parentCollection' in error_details.get('message', '').lower():
                        logging.error(
                            f"Failed to create subcollection '{name}'. Parent collection '{parent_key}' may not exist or became invalid. API Response: {resp}")
                    else:
                        logging.error(
                            f"Failed to create collection '{name}' ({location_desc}). Code: {error_details.get('code')}, Message: {error_details.get('message')}. API Response: {resp}")
                    return None
                else:
                    logging.error(
                        f"Failed to create collection '{name}' ({location_desc}). Unexpected API response format: {resp}")
                    return None
            except Exception as e:
                logging.error(f"Exception during collection creation for '{name}' ({location_desc}): {e}",
                              exc_info=True)
                return None
        else:
            logging.error(
                f"Unexpected state for '{name}'. Total={total_found_globally}, Non-Deleted={num_non_deleted_globally}, Deleted={num_deleted_globally}.")
            return None

    # ----- PUBLIC FACING FUNCTIONS (Unchanged) -----
    # These remain wrappers around the core logic above

    def find_or_create_top_collection(self, name):
        """
        Finds a unique non-deleted collection by name anywhere in the library,
        handles duplicates interactively (allowing indexed deletion), or creates a
        new TOP-LEVEL collection if the name is globally unique.

        Args:
            name (str): The desired name of the collection (whitespace trimmed).

        Returns:
            str: The collection key if found/resolved uniquely or newly created.
            None: If ambiguous duplicates persist, only deleted instances exist,
                  API/creation fails, or name is empty.
        """
        if not name:
            logging.error("(find_or_create_top_collection) Collection name cannot be empty.")
            return None
        name = name.strip()
        if not name:
            logging.error("(find_or_create_top_collection) Collection name cannot be empty after trimming.")
            return None
        return self._find_or_create_collection_logic(name=name, parent_key=None)

    def find_or_create_subcollection(self, subcoll_name, parent_key):
        """
        Finds a unique non-deleted collection by name anywhere in the library,
        handles duplicates interactively (allowing indexed deletion), or creates a
        new SUBCOLLECTION under parent if the name is globally unique.

        Args:
            subcoll_name (str): Desired name of subcollection (whitespace trimmed).
            parent_key (str): Key of the parent collection.

        Returns:
            str: The collection key if found/resolved uniquely or newly created.
            None: If ambiguous duplicates persist, only deleted instances exist,
                  parent invalid, API/creation fails, or names empty.
        """
        if not subcoll_name:
            logging.error("(find_or_create_subcollection) Subcollection name cannot be empty.")
            return None
        subcoll_name = subcoll_name.strip()
        # if not subcoll_name:
        #     logging.error("(find_or_create_subcollection) Subcollection name cannot be empty after trimming.")
        #     return None
        # if not parent_key:
        #     logging.error("(find_or_create_subcollection) Parent key cannot be empty.")
        #     return None
        return self._find_or_create_collection_logic(name=subcoll_name, parent_key=parent_key)


    def attach_file_to_item(self, parent_item_id, file_path, tag_name="automatic_attach"):
        """
        Attaches a file to an existing Zotero item, but only if that exact
        filename isn’t already attached. Prints the attachment’s ID or skips.

        Args:
            parent_item_id (str): The ID of the item to attach the file to.
            file_path (str): The full path to the file to attach.
            tag_name (str): A tag to add to new attachments.

        Returns:
            str: The attachment’s item key (new or existing), or None if skipped.
        """
        file_name = os.path.basename(file_path)
        # 1) Fetch all child attachments of this item
        try:
            children = self.zot.children(parent_item_id)
        except Exception as e:
            print(f"[!] Could not list existing attachments: {e}")
            children = []

        # 2) Look for an imported_file child with the same filename
        for child in children:
            data = child.get("data", {})
            if data.get("linkMode") == "imported_file" and data.get("filename") == file_name:
                attachment_key = child["key"]
                print(f"[*] File '{file_name}' is already attached (key={attachment_key}); skipping upload.")
                return attachment_key

        # 3) If we reach here, no matching attachment exists — upload it
        try:
            resp = self.zot.attachment_simple([file_path], parentid=parent_item_id)
        except zotero_errors.HTTPError as e:
            print(f"[!] Error uploading '{file_name}': {e}")
            return None

        # 4) Inspect response to find the new key
        attachment_key = None
        if "successful" in resp and resp["successful"]:
            attachment_key = next(iter(resp["successful"].values()))["key"]
        elif "success" in resp and resp["success"]:
            # some versions of the API return 'success' instead of 'successful'
            attachment_key = resp["success"][0]["key"]
        elif "unchanged" in resp and resp["unchanged"]:
            attachment_key = resp["unchanged"][0]["key"]
        else:
            print(f"[!] Unexpected response from attachment_simple: {resp}")
            return None

        print(f"[+] Attached file as ID: {attachment_key}")

        # 5) Add tag if requested
        try:
            attachment_item = self.zot.item(attachment_key)
            existing_tags = {t["tag"] for t in attachment_item["data"].get("tags", [])}
            if tag_name and tag_name not in existing_tags:
                attachment_item["data"].setdefault("tags", []).append({"tag": tag_name})
                self.zot.update_item(attachment_item)
                print(f"[+] Tag '{tag_name}' added to attachment ID: {attachment_key}")
        except Exception as e:
            print(f"[!] Failed to add tag to attachment {attachment_key}: {e}")

        return attachment_key

    def create_item_with_attachment(self, file_path, collection_key):
        """
        Creates a Zotero item with an attachment and adds it to a collection.

        Args:
            file_path (str): The path to the file to attach.
            collection_key (str): The key of the collection to add the item to.

        Returns:
            None
        """
        # Get file name and extension
        file_name = os.path.basename(file_path)
        file_title, file_ext = os.path.splitext(file_name)

        # Only proceed if the file is a Word or PDF document
        if file_ext.lower() in ['.pdf', '.doc', '.docx']:
            # Create a basic item (e.g., document)
            item_template = self.zot.item_template('document')
            item_template['title'] = file_title
            item_template['creators'] = [{'creatorType': 'author', 'firstName': 'Anonymous', 'lastName': ''}]
            item_template['tags'] = [{'tag': 'attachment'}]  # You can customize tags if needed
            item_template['collections'] = [collection_key]

            try:
                # Add the item to Zotero
                created_item = self.zot.create_items([item_template])
                print(f"Created item response: {created_item}")

                if 'successful' in created_item and '0' in created_item['successful']:
                    item_id = created_item['successful']['0']['key']
                    # Attach the file to the item
                    self.zot.attachment_simple([file_path], parentid=item_id)
                    print(f"Item with attachment created: {file_name} and added to collection {collection_key}")
                else:
                    print(f"Failed to create item for file '{file_name}': {created_item}")
            except zotero_errors.HTTPError as e:
                print(f"Error uploading attachment for file '{file_name}': {e}")
            except Exception as e:
                print(f"Unexpected error for file '{file_name}': {e}")
        else:
            print(f"Skipped non-document file: {file_name}")

    def process_files_in_directory(self, directory_path, collection_name):
        """
        Processes files in a directory, creating Zotero items with attachments
        and adding them to a specified collection.

        Args:
            directory_path (str): The path to the directory containing files.
            collection_name (str): The name of the collection to add items to.

        Returns:
            None
        """
        try:
            collection_key = self.find_or_create_top_collection(collection_name)

            for root, dirs, files in os.walk(directory_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    self.create_item_with_attachment(file_path, collection_key)
        except Exception as e:
            print(f"Failed to process directory '{directory_path}': {e}")

    def append_tag_to_item(self, item_id, new_tag):
        """
        Appends a new tag to a Zotero item and updates it in Zotero.

        Args:
            item_id (str): The Zotero item key (e.g., '3654M8FV').
            new_tag (str): The tag to append to the item.

        Returns:
            bool: True if the tag was appended successfully, False otherwise.
        """

        try:
            # Fetch the item from Zotero
            item = self.zot.item(item_id)
            if not item:
                print(f"Item with ID '{item_id}' not found.")
                return False

            # Extract existing tags
            existing_tags = [tag_obj['tag'] for tag_obj in item.get('data', {}).get('tags', [])]

            # Check if the tag already exists (case-insensitive)
            if new_tag.lower() in (tag.lower() for tag in existing_tags):
                print(f"The tag '{new_tag}' already exists for item '{item_id}'.")
                return False

            # Append the new tag
            item['data'].setdefault('tags', []).append({'tag': new_tag, 'type': 1})  # type 1 is the default

            # Update the item in Zotero
            updated_item = self.zot.update_item(item)

            if updated_item:
                print(f"Successfully appended tag '{new_tag}' to item '{item_id}'.")
                return True
            else:
                print(f"Failed to update item '{item_id}' with the new tag.")
                return False

        except Exception as e:
            print(f"An error occurred while appending the tag: {e}")
            return False

            # --- Nested Processing Function ---

    def _classification_12_features(self,collection_name,read=False, store_only=False):
        """
        Processes a single Zotero item (finds attachment, performs action).
        Handles item_to_process being either a parent or an attachment.
        Uses variables from outer scope: condition, keyword, source_coll_key, processed_coll_key.
        """
        attachment_id = None
        parent_key = None
        attachment_item = None
        pdf_path = None
        function="paper_analysis_and_extraction"
        items = self.get_all_items(collection_name=collection_name,cache=False)
        loop=True

        # index1=1
        for index,item_to_process in enumerate(items):
            print("index",index)

            item_key = item_to_process.get('key')
            # if index==index1:
            #     loop=True
            if loop:

                pdf_path =self.get_pdf_path_for_item(item_key)
                # 1. Extract Text
                text = ""
                extra = ""

                if not read:
                    text = extract_intro_conclusion_pdf_text(pdf_path=pdf_path)["payload"]
                custom_id = hashlib.sha256("|".join([item_key, function]).encode('utf-8')).hexdigest()

                response,cost = call_models(text=text,
                                           models={"openai":"o3-mini"},
                                           function=function,
                                           store_only=store_only,
                                           read=read,
                                           collection_name=collection_name,
                                       custom_id=custom_id,
                                       by_index=index
                                           )


                if store_only:
                    continue
                try:
                    # --- 1. Get AI response and perform basic validation ---

                    kw = response.get("keywords", {})
                    if not kw:
                        logging.warning(f"AI response for {parent_key} was missing the 'keywords' object.")

                    # --- 3. Dynamically build the new 'extra' field content ---
                    new_extra_lines = []

                    # --- 1. Normalize scalar fields that sometimes come back as single‐element lists ---
                    for scalar_key in [
                        "theoretical_orientation",
                        "ontology",
                        "epistemology",
                        "argumentation_logic",
                        "framework_model",
                        "contribution_type",
                        "method_type",
                        "research_question_purpose"
                    ]:
                        v = kw.get(scalar_key)
                        if isinstance(v, list):
                            # collapse ['Foo'] → 'Foo', leave [] as None
                            kw[scalar_key] = v[0] if v else None

                    # --- 2. Build 'extra' lines and HTML snippet ---
                    new_extra_lines = []

                    # Handle the special 'affiliation' flattening first
                    affiliations_list = kw.get('affiliation', [])
                    if affiliations_list:
                        departments = "; ".join(filter(None, [aff.get('department') for aff in affiliations_list]))
                        institutions = "; ".join(filter(None, [aff.get('institution') for aff in affiliations_list]))
                        countries = "; ".join(filter(None, [aff.get('country') for aff in affiliations_list]))

                        if departments:
                            extra += f"Department: {departments}\n"
                        if institutions:
                            extra += f"Institution: {institutions}\n"
                        if countries:
                            extra += f"Country: {countries}\n"


                    # Map of display name → keyword key (note: 'methodology' removed per spec)
                    fields_to_add = {
                        "Theoretical Orientation": "theoretical_orientation",
                        "Ontology": "ontology",
                        "Epistemology": "epistemology",
                        "Argumentation Logic": "argumentation_logic",
                        "Evidence Source Base": "evidence_source_base",
                        "Methods": "methods",
                        "Method Type": "method_type",
                        "Framework Model": "framework_model",
                        "Contribution Type": "contribution_type",
                        "Attribution Lens Focus": "attribution_lens_focus",
                        "Research Question/Purpose": "research_question_purpose"
                    }

                    variable_snippet = ['<h2>Coding</h2>']
                    extra= parse_citation_count_line(extra)

                    for display_name, key_in_kw in fields_to_add.items():
                        value = kw.get(key_in_kw)

                        # only proceed if there’s a real, non-None value
                        if not value or value == "None":
                            continue

                        # flatten lists vs scalars
                        if isinstance(value, list):
                            clean_items = [str(v) for v in value if v and v != "None"]
                            if not clean_items:
                                continue
                            value_str = "; ".join(clean_items)
                            items = clean_items
                        else:
                            value_str = str(value)
                            items = [value_str]

                        # 1) append to extra text
                        extra += f"\n{display_name}: {value_str}\n"

                        # 2) append to HTML snippet
                        variable_snippet.append(f"<h3>{display_name}</h3>")
                        variable_snippet.append("<ul>")
                        for v in items:
                            variable_snippet.append(f"  <li>{v}</li>")
                        variable_snippet.append("</ul>")

                    # join HTML snippet
                    html_snippet = "\n".join(variable_snippet)

                    self.append_info_note_log(snippet=html_snippet, item_key=item_key)

                    # --- 3. Combine pinned key & new content into Zotero 'extra' ---
                    final_extra_content = []

                    self.update_zotero_item_feature(
                        updates={"extra": extra },
                        item=self.zot.item(item_key),
                    )

                    logging.info(f"Successfully updated Zotero item {parent_key} with abstract and flattened metadata.")
                except Exception as h:
                    print(h)
        if store_only:

            if _process_batch_for(collection_name=collection_name,
                                  function=function,
                                  ):
                self._classification_12_features(collection_name=collection_name,store_only=False,read=True)
        return True

    def update_items_conditioned(self, collection_name: str | List | None = None, keyword: str | None = None,
                                 condition: str = "check_keyword", item: dict | None = None, item_command="add",store_only=False):
        """
        Processes Zotero items based on condition (check keyword in PDF or add AI abstract).
        Can operate on a whole collection or a single parent item.

        Args:
            collection_name (str | None): Name of the Zotero collection. Needed for collection
                                          processing and determining target collection for moving.
            keyword (str | None): The word to search for (if condition="check_keyword").
            condition (str): Action: "check_keyword" or "add_abstract".
            item (dict | None): A single Zotero *parent* item dictionary to process.
                                If provided, only this item (and its attachment) is processed.
        """
        # collection_key = self.find_or_create_top_collection("auto_"+keyword) if condition =="create collection from keyword" else None
        found_pdf = False
        if not collection_name and not item:
            logging.error("Must provide 'collection_name' (for collection mode) or 'item' (for single item mode).")
            return
        if condition == "check_keyword" and not keyword:
            logging.error("Keyword must be provided for 'check_keyword' condition.")
            return
        if item and not isinstance(item, dict):
            logging.error("'item' must be a dictionary representing a Zotero item.")
            return

        source_coll_key = None
        processed_coll_key = None  # Target collection key (e.g., _abstract_added)

        # --- Setup Collections (Needs a base name) ---
        base_collection_name = collection_name if collection_name else None
        # Try to infer base name from the single item's collections if not provided? (Complex, skip for now)
        if not base_collection_name and item:
            logging.warning(
                "Processing single item without 'collection_name'. Cannot determine target collection for moving.")
        elif not base_collection_name and not item:
            # This case is already caught by the initial check, but defense-in-depth
            logging.error("Internal Error: collection_name is required for collection mode.")
            return

        if base_collection_name:
            try:
                # Find the source collection key *if* we are in collection mode (item is None)
                if not item:
                    source_coll_key = self.find_or_create_top_collection(base_collection_name)
                    if not source_coll_key:
                        logging.error(
                            f"Could not find or create source collection '{base_collection_name}'. Aborting collection processing.")
                        return
                    logging.info(f"Source collection: '{base_collection_name}' (Key: {source_coll_key})")

                # Determine suffix for the target collection
                processed_coll_name = f"{base_collection_name}_{condition}"


                parent_key_for_processed = source_coll_key  # Default to source key if it exists
                if not parent_key_for_processed:
                    # Attempt to find the top collection key even if not processing the whole collection, just for parenting the target
                    try:
                        temp_parent_key = self.find_or_create_top_collection(base_collection_name)
                        parent_key_for_processed = temp_parent_key
                        logging.info(
                            f"Using collection '{base_collection_name}' (Key: {parent_key_for_processed}) as parent for target collection.")
                    except Exception:
                        logging.warning(
                            f"Could not find collection '{base_collection_name}' to use as parent for target. Target will be top-level or fail.")
                        parent_key_for_processed = None  # Create as top-level or let find_or_create_subcollection handle None parent

                # Create the processed collection (as subcollection if parent found, else top-level?)
                # Adjust find_or_create_subcollection to handle parent_key=None if needed, or use find_or_create_top_collection
                if parent_key_for_processed:
                    processed_coll_key = self.find_or_create_subcollection(subcoll_name=processed_coll_name,
                                                                           parent_key=parent_key_for_processed)
                else:
                    # Fallback: Try creating as top-level (adjust method name if necessary)
                    logging.warning(f"Creating target collection '{processed_coll_name}' as top-level.")
                    processed_coll_key = self.find_or_create_top_collection(processed_coll_name)  # Assuming this works

                if not processed_coll_key:
                    logging.error(
                        f"Failed to find or create target collection '{processed_coll_name}'. Moving will be disabled.")
                else:
                    logging.info(
                        f"Target collection for processed items: '{processed_coll_name}' (Key: {processed_coll_key})")

            except Exception as e:
                logging.error(f"Error setting up collections based on '{base_collection_name}': {e}")
                # Decide whether to proceed without moving
                processed_coll_key = None  # Disable moving
        function = "paper_analysis_and_extraction"

        # --- Nested Processing Function ---
        def _process_item(item_to_process,store_only):
            """
            Processes a single Zotero item (finds attachment, performs action).
            Handles item_to_process being either a parent or an attachment.
            Uses variables from outer scope: condition, keyword, source_coll_key, processed_coll_key.
            """
            nonlocal processed_parent_keys_for_abstract  # Allow modification

            item_key = item_to_process.get('key')
            data = item_to_process.get('data', {})
            item_type = data.get('itemType')
            attachment_id=None
            parent_key = None
            attachment_item = None
            pdf_path=None
            # --- Step 1: Identify Parent Key and Find PDF Attachment ---
            if item_type == 'attachment':
                # This function was called with an attachment (likely from collection loop)
                logging.debug(f"Processing item {item_key} identified as attachment.")
                parent_key = data.get('parentItem')
                if not parent_key:
                    logging.warning(
                        f"Attachment {item_key} ('{data.get('filename', 'N/A')}') has no parentItem. Skipping.")
                    return False  # Cannot proceed without parent

                # Check if this attachment is a PDF
                fname = data.get('filename', "")
                ctype = data.get('contentType', "")
                if not (ctype == 'application/pdf' or fname.lower().endswith('.pdf')):
                    logging.debug(f"Attachment {item_key} is not a PDF ({ctype}, '{fname}'). Skipping.")
                    return False  # Not a PDF attachment

                attachment_item = item_to_process  # This is the PDF attachment

            else:
                # Assume item_to_process is the parent item (e.g., journalArticle)
                logging.debug(f"Processing item {item_key} ('{data.get('title', 'N/A')}') identified as parent.")
                parent_key = item_key  # The item itself is the parent

                # Find its children (attachments)
                try:
                    children = self.zot.children(parent_key)

                    found_pdf = False
                    for child in children:
                        child_data = child.get('data', {})
                        child_type = child_data.get('itemType')
                        if child_type == 'attachment':

                            fname = child_data.get('filename', "")
                            ctype = child_data.get('contentType', "")
                            link_mode = child_data.get('linkMode')  # Avoid linked files unless handled
                            if (ctype == 'application/pdf' or fname.lower().endswith('.pdf')) and link_mode not in [
                                'linked_file', 'linked_url']:
                                attachment_item = child  # Found the first suitable PDF attachment
                                attachment_id=child_data.get('key')
                                logging.debug(f"Found PDF attachment {child.get('key')} for parent {parent_key}.")
                                found_pdf = True
                                break  # Use the first one found


                    if not found_pdf:
                        logging.warning(f"No suitable PDF attachment found for parent item {parent_key}. Skipping.")

                        return False
                except Exception as e_child:
                    logging.error(f"Error retrieving children for parent {parent_key}: {e_child}")
                    return False

            # --- Step 2: Check if Parent already processed (for Abstract) ---
            if condition == "add_abstract" and parent_key in processed_parent_keys_for_abstract:
                logging.debug(f"Parent {parent_key} already processed for abstract in this run. Skipping.")
                return True  # Considered "success" in the sense that it's handled

            # --- Step 3: Get PDF Path ---
            if not attachment_id:
                logging.error(
                    f"Internal error: No attachment_item identified for parent {parent_key}. Cannot get path.")






            att_filename = attachment_item.get('data', {}).get('filename', 'N/A')
            try:
                pdf_path = self.get_pdf_path(attachment_id=attachment_id)

                if not pdf_path or not os.path.exists(pdf_path):

                    logging.warning(
                        f"PDF path not found or invalid for attachment '{att_filename}' (Parent: {parent_key}). Path: '{pdf_path}'. Skipping.")
                    return False
            except Exception as e_path:
                logging.error(f"Error getting PDF path for '{att_filename}' (Parent: {parent_key}): {e_path}")

                input("no pdf path found, press enter to continue")
                raise Exception

            # --- Step 4: Perform Action based on Condition ---
            action_success = False
            if condition == "check_keyword" or condition == "create collection from keyword":
                logging.debug(f"Checking keyword '{keyword}' in '{att_filename}' (Parent: {parent_key})")
                count = check_keyword_details_pdf(pdf_path=pdf_path, keywords=keyword)

                if count is None:
                    logging.error(
                        f"Failed to process PDF for keyword check: '{os.path.basename(pdf_path)}' (Parent: {parent_key}).")
                    action_success = False  # PDF processing error
                elif count == 0:
                    logging.info(
                        f"Keyword '{keyword}' NOT found in '{os.path.basename(pdf_path)}'. Moving parent item {parent_key}.")
                    action_success = True  # Keyword check successful (found 0)
                    # Move parent item (only if source and target keys are valid)
                    if source_coll_key and processed_coll_key:
                        try:
                            # if item_command =="add":
                            #     self.add_items_to_collection(collection_key=processed_coll_key, items_keys=[parent_key])
                            # if item_command =="remove":
                            #     self.remove_items_from_collection(collection_key=source_coll_key, items_keys=[parent_key])
                            # if item_command =="move":
                            #     self.add_items_to_collection(collection_key=processed_coll_key, items_keys=[parent_key])
                            #     self.remove_items_from_collection(collection_key=source_coll_key, items_keys=[parent_key])

                                logging.debug(f"Moved parent {parent_key} from {source_coll_key} to {processed_coll_key}.")
                        except Exception as e_move:
                            logging.error(f"Failed to move parent item {parent_key} from {source_coll_key}: {e_move}")
                            # Note: action_success remains True because the *check* was successful
                    elif not item:  # Only warn about missing keys if in collection mode where moving is expected
                        logging.warning(
                            f"Cannot move parent item {parent_key}, source ({source_coll_key}) or target ({processed_coll_key}) collection key missing/invalid.")
                if count > 2:
                    try:

                        if item_command == "add":
                            self.add_items_to_collection(collection_key=processed_coll_key, items_keys=[parent_key])
                        if item_command == "remove":
                            self.remove_items_from_collection(collection_key=source_coll_key, items_keys=[parent_key])
                        if item_command == "move":
                            self.add_items_to_collection(collection_key=processed_coll_key, items_keys=[parent_key])
                            self.remove_items_from_collection(collection_key=source_coll_key, items_keys=[parent_key])

                            logging.debug(f"Moved parent {parent_key} from {source_coll_key} to {processed_coll_key}.")
                    except Exception as e_move:
                        logging.error(f"Failed to move parent item {parent_key} from {source_coll_key}: {e_move}")
                        # Note: action_success remains True because the *check* was successful
                    logging.info(
                        f"Keyword '{keyword}' found {count} times in '{os.path.basename(pdf_path)}'. Parent item {parent_key} remains.")
                    action_success = True  # Keyword check successful (found > 0)

            elif condition == "add_abstract":
                if not pdf_path:
                    input("no pdf path found, press enter to continue")
                logging.info(f"Generating abstract for parent {parent_key} using '{att_filename}'")
                try:
                    # 1. Extract Text
                    text = extract_intro_conclusion_pdf_text(pdf_path=pdf_path)
                    if not text:
                        logging.warning(
                            f"No text extracted for abstract from '{att_filename}' (Parent: {parent_key}). Skipping abstract generation.")
                        return False  # Cannot generate abstract without text
                    response, _cost = call_models(text=text,
                                           # models={"openai":"o3-mini"},
                                           function=function,
                                           store_only=store_only,
                                           read=not store_only,
                                           collection_name=collection_name
                                           )

                    if store_only:
                        return
                    generated_abstract = response.get("abstract", "")
                    if not generated_abstract or not isinstance(generated_abstract, str):
                        logging.error(f"AI did not return a valid abstract string for parent {parent_key}. Aborting.")
                        return False

                    kw = response.get("keywords", {})
                    if not kw:
                        logging.warning(f"AI response for {parent_key} was missing the 'keywords' object.")

                    framework_model = kw.get('framework_model', 'N/A')
                    contribution_type = kw.get('contribution_type', 'N/A')
                    methodology = kw.get('methodology', 'N/A')
                    methods = ", ".join(kw.get('methods', [])) or 'N/A'
                    topic_phrases_list = kw.get('topic_phrases', [])

                    extra_lines = [
                        f"Framework Model: {framework_model}",
                        f"Contribution Type: {contribution_type}",
                        f"Methodology: {methodology}",
                        f"Methods: {methods}",
                    ]

                    if topic_phrases_list:
                        extra_lines.append("\nTopic Phrases:")
                        extra_lines.extend([f"- {phrase}" for phrase in topic_phrases_list])

                    extra = "\n".join(extra_lines)

                    controlled_vocab_terms = kw.get("controlled_vocabulary_terms", [])
                    tags_to_add = [{'tag': term} for term in controlled_vocab_terms]
                    tags_to_add.append({'tag': 'Abstract_auto'})

                    parent_item_for_update = self.zot.item(parent_key)

                    updates_payload = {
                        'abstract': generated_abstract,
                        'extra': extra,
                        'tags': tags_to_add
                    }


                    parent_item_for_update['data'].update(updates_payload)
                    self.zot.update_item(parent_item_for_update)



                    self.append_tag_to_item(item_id=parent_key, new_tag="Abstract_auto")
                    valid_lists = [k + ":" + v for k, v in kw.items()]
                    flat_list = list(itertools.chain.from_iterable(valid_lists))
                    tags = [{'tag': item} for item in flat_list]

                    self.update_zotero_item_feature(updates={"tags": tags, "extra": extra,"abstractNote":generated_abstract}, item=parent_item_for_update, append=False)


                    action_success = True
                    processed_parent_keys_for_abstract.add(parent_key)  # Mark as done for abstract

                    # Move parent item after successful abstract update
                    if source_coll_key and processed_coll_key:
                        try:
                            self.remove_items_from_collection(collection_key=source_coll_key, items_keys=[parent_key])
                            self.add_items_to_collection(collection_key=processed_coll_key, items_keys=[parent_key])
                            logging.debug(f"Moved parent {parent_key} from {source_coll_key} to {processed_coll_key}.")
                        except Exception as e_move:
                            logging.error(f"Failed to move parent item {parent_key} after abstract update: {e_move}")
                    else:  # Only warn if in collection mode
                        logging.warning(
                            f"Cannot move parent item {parent_key} after abstract update, source ({source_coll_key}) or target ({processed_coll_key}) collection key missing/invalid.")
                    return generated_abstract
                except Exception as e_abstract_process:
                    logging.error(
                        f"Error during abstract generation/update for parent {parent_key}: {e_abstract_process}",
                        exc_info=True)
                    action_success = False
                    # Optionally mark parent as processed even on failure to avoid retries?
                    # processed_parent_keys_for_abstract.add(parent_key)

            return action_success

        # --- End of _process_item nested function ---

        # --- Main Execution Logic ---
        processed_parent_keys_for_abstract = set()  # Track parents processed for abstract in this run

        if item:
            # --- Single Item Mode ---
            # Ensure the provided item is treated as a parent
            item_data = item.get('data', {})
            item_type = item_data.get('itemType')
            if item_type == 'attachment':
                logging.error(
                    "Single item mode requires the PARENT item, not the attachment. Please provide the parent item dictionary.")

                return  # Stop execution if wrong item type provided

            # Process the single parent item provided
            logging.info(f"Processing single parent item: {item.get('key')} ('{item_data.get('title', 'N/A')}')")
            return _process_item(item)

        elif collection_name and source_coll_key:
            # --- Collection Mode ---
            logging.info(f"Starting processing for collection '{collection_name}' (Key: {source_coll_key})")
            start = 0
            limit = 100# Adjust batch size
            total_items_processed_in_loop = 0
            total_items_succeeded = 0

            while True:
                logging.info(f"Fetching items from collection '{collection_name}', starting at index {start}...")
                try:
                    items_batch = self.zot.collection_items(source_coll_key, limit=limit, start=start)
                except Exception as e:
                    logging.error(
                        f"Error retrieving items from Zotero collection {source_coll_key} (start={start}): {e}")
                    break

                if not items_batch:
                    logging.info("No more items found in the collection.")
                    break

                logging.info(f"Processing batch of {len(items_batch)} items...")
                batch_processed_count = 0
                batch_succeeded_count = 0
                added_item=[]
                for loop_item in items_batch:
                    if loop_item.get('key') in added_item:
                        continue
                    added_item.append(loop_item.get('key'))
                    total_items_processed_in_loop += 1
                    batch_processed_count += 1

                    # The loop_item could be a parent or an attachment. _process_item handles both.
                    success = _process_item(loop_item,store_only=store_only)

                    if success:
                        batch_succeeded_count += 1

                        if condition =="create collection from keyword":
                            self.add_items_to_collection(items_keys=loop_item.get('key'),collection_key=processed_coll_key)



                total_items_succeeded += batch_succeeded_count
                logging.info(
                    f"Batch finished. Items processed in batch: {batch_processed_count}, Succeeded: {batch_succeeded_count}")

                if len(items_batch) < limit:
                    break

                else:
                    start += limit

            logging.info(f"Finished processing collection '{collection_name}'.")
            logging.info(f"Total items processed from loop: {total_items_processed_in_loop}")
            # Note: Succeeded count depends on the definition within _process_item
            logging.info(f"Total successful operations (based on _process_item return): {total_items_succeeded}")
            if condition == "add_abstract":
                logging.info(
                    f"Total unique parents updated/processed for abstract: {len(processed_parent_keys_for_abstract)}")
            # if store_only:
                # if _process_batch_for(collection_name=collection_name,
                #                       function=function,
                #                       ):
                #     self.update_items_conditioned(collection_name=collection_name,store_only=False)
        else:
            # Should be caught earlier, but safeguard
            logging.error("Processing stopped due to configuration error (missing collection_name or item).")

    # def download_pdfs_from_collections(self, output_folder: str, Z_collections: list) -> None:
    def delete_items_no_pdf_from_library(self) -> None:
        """
        Iterate through all non-attachment items in the library:
          – If an item has PDF attachments, download them into a subfolder.
          – If an item has NO PDF attachments, delete that item from Zotero.
        """
        import os, re, requests

        def sanitize(name: str) -> str:
            return re.sub(r'[\\/*?:"<>|]', "_", name)


        # Fetch every item in the library (including attachments and notes)
        all_items = self.zot.everything(self.zot.items())

        for item in all_items:
            data = item.get('data', {})
            itype = data.get('itemType')
            extra= data.get('extra', '')
            if "justification" in extra:
                print("Skipping item with justification in extra field")
                continue
            # Skip attachments, notes, links, annotations...
            if itype in ('attachment', 'note', 'linkAttachment', 'fileAttachment', 'annotation'):
                continue

            key = data.get('key')
            title = data.get('title', key)
            if not self.get_pdf_path_for_item(key):

                try:
                    print(f"Deleting item without PDF: {key} – {title}")

                    self.zot.delete_item(item)
                    print(f"✔ Deleted item without PDF: {key} – {title}")
                except Exception as e:
                    print(f"[ERROR] Could not delete {key}: {e}")
                continue


    def download_pdfs_from_collections(self, output_folder: str, Z_collections: list) -> None:
        """
        Iterate through each Zotero collection (by key or name) in Z_collections,
        download all PDF attachments, and store them in a subfolder (named after
        the collection) within the specified output_folder.
        """

        def sanitize(name: str) -> str:
            return re.sub(r'[\\/*?:"<>|]', "_", name)

        def normalize(name: str) -> str:
            return (name or "").strip().lower()

        os.makedirs(output_folder, exist_ok=True)

        # Build lookup of all existing collections (including nested subcollections).
        all_coll = []
        start = 0
        while True:
            batch = self.zot.collections(limit=100, start=start)
            if not batch:
                break
            all_coll.extend(batch)
            if len(batch) < 100:
                break
            start += 100

        key_to_coll = {c["data"]["key"]: c["data"] for c in all_coll}

        # Resolve full path: "Parent/Subcollection/Child".
        path_cache = {}

        def build_path(coll_key: str) -> str:
            if coll_key in path_cache:
                return path_cache[coll_key]
            data = key_to_coll.get(coll_key, {})
            name = data.get("name", coll_key)
            parent = data.get("parentCollection")
            if parent and parent in key_to_coll:
                full = f"{build_path(parent)}/{name}"
            else:
                full = name
            path_cache[coll_key] = full
            return full

        key_to_name = {}
        key_to_path = {}
        name_to_keys = {}
        path_to_key = {}

        for coll_key, data in key_to_coll.items():
            name = data.get("name", coll_key)
            path = build_path(coll_key)
            key_to_name[coll_key] = name
            key_to_path[coll_key] = path
            name_to_keys.setdefault(normalize(name), []).append(coll_key)
            path_to_key[normalize(path)] = coll_key

        print("Available Zotero collections (including subcollections):")
        for coll_key, path in sorted(key_to_path.items(), key=lambda kv: kv[1].lower()):
            print(f" - {path} [{coll_key}]")

        for identifier in Z_collections:
            ident_norm = normalize(identifier)
            coll_key = None

            # 1) Direct key
            if identifier in key_to_name:
                coll_key = identifier
            # 2) Exact full-path match (e.g., "Root/frameworks")
            elif ident_norm in path_to_key:
                coll_key = path_to_key[ident_norm]
            # 3) Exact name match (possibly ambiguous)
            elif ident_norm in name_to_keys:
                matches = name_to_keys[ident_norm]
                if len(matches) > 1:
                    print(
                        f"[WARN] Ambiguous collection name '{identifier}'. "
                        f"Using first match: {key_to_path[matches[0]]} [{matches[0]}]"
                    )
                coll_key = matches[0]
            # 4) Unique tail-path match (identifier equals last segment in one path)
            else:
                tail_matches = [
                    k for k, p in key_to_path.items()
                    if normalize(p.split("/")[-1]) == ident_norm
                ]
                if len(tail_matches) == 1:
                    coll_key = tail_matches[0]
                elif len(tail_matches) > 1:
                    print(
                        f"[WARN] Ambiguous subcollection tail '{identifier}'. "
                        "Use full path for clarity."
                    )

            if not coll_key:
                print(f"[ERROR] Collection not found: {identifier}")
                continue

            coll_name = key_to_path.get(coll_key, key_to_name.get(coll_key, identifier))
            folder = os.path.join(output_folder, sanitize(coll_name))
            os.makedirs(folder, exist_ok=True)

            start = 0
            while True:
                items = self.zot.collection_items(coll_key, limit=100, start=start)
                if not items:
                    break

                for item in items:
                    data = item.get('data', {})
                    if data.get('itemType') != 'attachment':
                        continue

                    fname = data["parentItem"] + "_" + data.get('filename', "")
                    ctype = data.get('contentType', "")
                    if ctype == 'application/pdf' or fname.lower().endswith('.pdf'):
                        # print(data.keys())
                        dest = os.path.join(folder, sanitize(fname))

                        if os.path.exists(dest):
                            continue

                        try:
                            attachment_key = data['key']
                            result = self.zot.file(attachment_key)

                            if isinstance(result, dict):
                                url = result.get('url')
                                if not url:
                                    raise ValueError("No URL for linked attachment")
                                resp = requests.get(url)
                                resp.raise_for_status()
                                file_bytes = resp.content
                            else:
                                file_bytes = result

                            with open(dest, 'wb') as f:
                                f.write(file_bytes)
                            print(f"✔ Downloaded {fname} → {folder}")

                        except Exception as e:
                            print(f"[ERROR] Failed to download {fname}: {e}")

                start += len(items)

    def import_json_to_zotero_collection(self, json_path: str, batch_size: int = 25) -> dict:
        """
        Create (or reuse) a Zotero collection named after the JSON filename (sans extension),
        then import all CSL-JSON items from the file into that collection—skipping the
        final summary note. Returns {"collection_key": str, "items_added": int}.
        """
        import os
        import json
        import itertools
        import logging
        from pathlib import Path

        # 1) Resolve or create the target collection
        if not os.path.isfile(json_path):
            raise FileNotFoundError(f"No such file: {json_path}")
        coll_name = Path(json_path).stem
        coll_key = self.find_or_create_top_collection(coll_name)
        if not coll_key:
            raise RuntimeError(f"Could not create or locate collection “{coll_name}”")

        # 2) Load and filter out the summary entry
        with open(json_path, encoding="utf-8") as fh:
            csl_items = json.load(fh)
        if not isinstance(csl_items, list):
            raise ValueError("JSON must be an array of CSL-JSON records")
        # Drop any record whose type/title indicate it's the summary note
        to_import = [
            r for r in csl_items
            if not (r.get("type") in ("entry", "note") and r.get("title", "").lower().startswith("merge summary"))
        ]

        # 3) Prepare Zotero templates (one GET per unique type, cached)
        type_map = {
            "article-journal": "journalArticle",
            "chapter": "bookSection",
            "paper-conference": "conferencePaper",
            "book": "book",
            "thesis": "thesis",
            "report": "report",
            "note": "note",
        }
        # Determine which Zotero itemTypes we need
        zot_types = {type_map.get(r.get("type", ""), "document") for r in to_import}
        templates = {}
        for zt in zot_types:
            try:
                templates[zt] = self.zot.item_template(zt)
            except Exception as e:
                logging.warning(f"Could not fetch template for {zt!r}: {e}; falling back to 'note'")
                templates[zt] = self.zot.item_template("note")

        # 4) CSL → Zotero-JSON conversion
        def _csl_to_zot(csl: dict) -> dict:
            zt = type_map.get(csl.get("type", ""), "note")
            zitem = templates[zt].copy()
            # Core fields
            zitem["title"] = csl.get("title", "")
            zitem["creators"] = [
                {
                    "creatorType": "author",
                    "firstName": a.get("given", ""),
                    "lastName": a.get("family", ""),
                }
                for a in csl.get("author", [])
            ]
            if date_parts := csl.get("issued", {}).get("date-parts"):
                zitem["date"] = str(date_parts[0][0])
            zitem["abstractNote"] = csl.get("abstract", "")
            zitem["language"] = csl.get("language", "")
            zitem["DOI"] = csl.get("DOI", "")
            zitem["ISBN"] = csl.get("ISBN", "")
            zitem["ISSN"] = csl.get("ISSN", "")
            zitem["url"] = csl.get("URL", "")
            zitem["volume"] = csl.get("volume", "")
            zitem["issue"] = csl.get("issue", "")
            zitem["pages"] = csl.get("page", "")
            zitem["publicationTitle"] = csl.get("container-title", "")
            zitem["publisher"] = csl.get("publisher", "")
            # Tags from keywords
            zitem["tags"] = [{"tag": kw} for kw in csl.get("keyword", [])]
            # Directly place in the collection
            zitem["collections"] = [coll_key]
            # Provenance note
            if src := csl.get("source"):
                zitem["extra"] = f"Source: {src}"
            return zitem

        zot_items = [_csl_to_zot(rec) for rec in to_import]

        # 5) Upload in batches
        def _chunks(seq, n):
            it = iter(seq)
            while (chunk := list(itertools.islice(it, n))):
                yield chunk

        total_added = 0
        for batch in _chunks(zot_items, batch_size):
            try:
                resp = self.zot.create_items(batch)
            except Exception as exc:
                logging.error(f"Upload batch failed: {exc}")
                continue

            added = list(resp.get("successful", {}).values())
            total_added += len(added)
            if resp.get("failed"):
                logging.warning(f"{len(resp['failed'])} items failed validation")

        logging.info(f"Imported {total_added} items into collection “{coll_name}” ({coll_key})")
        return {"collection_key": coll_key, "items_added": total_added}

    def update_zotero_item_feature(self,
                                   item: dict,
                                   updates: Union[Dict[str, Any], str],
                                   new_content: Optional[Any] = None,
                                   append: bool = False) -> bool:
        """
        Updates one or more features (fields) of a Zotero item in a single API call.

        Enhanced behavior for tags:
          • When appending tag lists, if a NEW tag starts with a keyed prefix like '#country_focus_value:',
            any EXISTING tag whose 'tag' starts with the same prefix will be REPLACED (removed) before
            adding the new tag. Other tags remain untouched.

        See original docstring for full usage.
        """
        # --- Input Validation ---
        if isinstance(updates, str):
            if new_content is None:
                raise ValueError("Single-feature update requires 'new_content'.")
            updates = {updates: new_content}
        elif not isinstance(updates, dict) or not updates:
            return {"status": "noop", "reason": "no updates provided"}

        # Fetch a full, updateable item payload (with etag/version) if needed
        itm = item if isinstance(item, dict) else self.zot.item(item)
        data = itm.get("data", itm)

        def _tag_prefix(s: str) -> Optional[str]:
            """
            Return the replacement prefix like '#country_focus_value:' from a tag string.
            Only matches patterns starting with '#' and containing the first ':'.
            """
            if not isinstance(s, str):
                return None
            s = s.strip()
            if not s.startswith("#"):
                return None
            if ":" not in s:
                return None
            # Keep everything up to and including the first colon
            head, _ = s.split(":", 1)
            return f"{head}:"

        def _merge_tags_with_prefix_replacement(old: list, new: list) -> list:
            """
            Merge two Zotero tag lists of dicts, replacing old tags that share the same '#key:' prefix
            with any new tags bearing that prefix. Dedup exact matches, preserve order (old that
            survive first, then new).
            """
            # Build set of prefixes present in the incoming tags
            prefixes = set()
            for d in new:
                if isinstance(d, dict) and "tag" in d and isinstance(d["tag"], str):
                    p = _tag_prefix(d["tag"])
                    if p:
                        prefixes.add(p)

            # Filter out old tags that should be replaced by prefix
            filtered_old = []
            for d in old:
                t = d.get("tag") if isinstance(d, dict) else None
                keep = True
                if isinstance(t, str):
                    # Compare heads (everything up to the first ':') for exact equality
                    t_head = f"{t.split(':', 1)[0]}:" if ':' in t else None
                    for p in prefixes:
                        if t_head == p:
                            keep = False
                            break
                if keep:
                    filtered_old.append(d)

            # Now order-preserving dedupe: existing that survive + new (skip exact duplicates)
            seen = set()
            merged = []
            for d in filtered_old + new:
                if isinstance(d, dict) and "tag" in d:
                    key = ("dict", d.get("tag"))
                else:
                    key = ("other", str(d))
                if key in seen:
                    continue
                seen.add(key)
                merged.append(d)
            return merged

        def _append_field(old, new):
            # Nothing to append to or nothing new—return the other
            if old in (None, ""):
                return new
            if new in (None, ""):
                return old

            # String append with tidy newline handling
            if isinstance(old, str) and isinstance(new, str):
                sep = "\n" if old.endswith("\n") else "\n\n"
                return f"{old}{sep}{new}"

            # List append with special handling for Zotero tags
            if isinstance(old, list) and isinstance(new, list):
                # If these look like Zotero tag dicts, use prefix-replacement logic
                old_is_tag_dicts = old and isinstance(old[0], dict) and "tag" in old[0]
                new_is_tag_dicts = new and isinstance(new[0], dict) and "tag" in new[0]
                if old_is_tag_dicts and new_is_tag_dicts:
                    return _merge_tags_with_prefix_replacement(old, new)

                # Otherwise: simple order-preserving dedupe
                return list(dict.fromkeys([*old, *new]))

            # Dict deep-merge (append recursively where possible)
            if isinstance(old, dict) and isinstance(new, dict):
                merged = dict(old)
                for k, v in new.items():
                    if k in merged:
                        merged[k] = _append_field(merged[k], v)
                    else:
                        merged[k] = v
                return merged

            # Fallback: stringify and newline-append
            old_s = old if isinstance(old, str) else str(old)
            new_s = new if isinstance(new, str) else str(new)
            sep = "\n" if old_s.endswith("\n") else "\n\n"
            return f"{old_s}{sep}{new_s}"

        # Apply updates, respecting append flag
        for field, new_val in updates.items():
            if append and field in data:
                data[field] = _append_field(data.get(field), new_val)
            else:
                data[field] = new_val

        if "data" in itm:
            itm["data"] = data

        # Persist
        return self.zot.update_item(itm)

    def screening_articles(self, collection_name, custom_criteria=False, store=False, read=False, cache=False,
                           mode="simple",From=None, function=None,force_abstract=False, use_saved_criteria: bool = True ):
        parent_key = self.find_or_create_top_collection(collection_name)
        criteria_key=  {
        }
        if function == "classify_vendor_reports":
            criteria_key = {
                dim: self.find_or_create_subcollection(subcoll_name=f"{collection_name}_{dim}", parent_key=parent_key)
                for dim in ["include", "exclude"]
            }
        classification_dims = [
            "primary_domain",
            "methodology",
            "framework_model",
            "research_question_purpose",
            "theoretical_orientation",
            "level_of_analysis",
            "argumentation_logic",
            "empirical_scope",
            "temporal_orientation",
            "evidence_source_base",
            "policy_engagement_intensity",
            "contribution_type",
            "attribution_lens_focus",
        ]
        scores = ["high", "medium", "low"]
        parent_cols = scores if mode == "simple" else classification_dims
        # create once per run
        parent_col_keys ={}
        if function =="classify_by_abs":
            parent_col_keys = {
                dim: self.find_or_create_subcollection(subcoll_name=f"{collection_name}_{dim}", parent_key=parent_key)
                for dim in parent_cols
            }

        items = [{"title": item["data"]["title"], "key": item["key"], "abstract": item["data"].get("abstractNote", "")}
                 for
                 item in self.get_all_items(collection_name=collection_name, cache=cache)]

        """
            Generates a prompt for classifying academic abstracts based on cyber conflict,
            attribution, and policy/legal links, allowing for dynamic inclusion/exclusion criteria.

            Args:
                custom_criteria (dict, optional): A dictionary with keys 'inclusion' and 'exclusion',
                                                 each containing a list of strings representing the
                                                 respective criteria. If None or invalid, uses default criteria.
                                                 Defaults to None.

            Returns:
                str: The formatted prompt string ready for use with a language model.
            """

        # --- Default Criteria ---
        default_inclusion_criteria = [
            "Cyber Conflict Context: Primarily addresses cyber activities within one of subjects: international relations, state-level conflict, geopolitical tensions, or actions by significant non-state actors impacting states.",
            "Substantive Discussion of Attribution: Engages with the concept of attributing cyber operations (process, challenges, political/strategic/legal implications, actors involved – beyond purely technical details).",
            "Link to Policy or Law, or Strategy: Explicitly connects the cyber conflict discussion to one or more of: Policy Responses, Deterrence, International Law, State Responsibility, Jus ad Bellum/Jus in Bello, Norms Development, International Relations/Diplomacy."
        ]

        default_exclusion_criteria = [
            "Purely Technical Focus: Solely focuses on technical methods (forensics, malware analysis, traffic analysis) without substantial linkage to policy/legal/strategic implications.",
            "Criminology Focus: Centers on domestic cybercrime law enforcement unless explicitly framed within state-sponsored activity and international policy/law.",
            "General Cybersecurity: Covers general practices, vulnerabilities, defense tech without the specific state-level conflict.",
        ]
        # --- Determine which criteria to use ---
        inclusion_list = default_inclusion_criteria
        exclusion_list = default_exclusion_criteria
        if use_saved_criteria:
            try:
                cfg_path = Path(getattr(self, "logs_dir", Path.cwd() / "logs")) / "open_coding_eligibility" / f"{_safe_collection_name(str(collection_name or 'collection'))}_criteria.json"
                if cfg_path.is_file():
                    with cfg_path.open("r", encoding="utf-8") as fh:
                        cfg = json.load(fh)
                    inc = cfg.get("inclusion_criteria")
                    exc = cfg.get("exclusion_criteria")
                    if isinstance(inc, list) and isinstance(exc, list) and inc and exc:
                        inclusion_list = [str(x).strip() for x in inc if str(x).strip()]
                        exclusion_list = [str(x).strip() for x in exc if str(x).strip()]
            except Exception as e:
                print(f"[screening_articles] WARN could not load saved eligibility criteria: {e}")
        if (custom_criteria and
                isinstance(custom_criteria, dict) and
                'inclusion' in custom_criteria and
                'exclusion' in custom_criteria and
                isinstance(custom_criteria['inclusion'], list) and
                isinstance(custom_criteria['exclusion'], list)):
            # Use custom criteria if provided and valid format
            inclusion_list = custom_criteria['inclusion']
            exclusion_list = custom_criteria['exclusion']
        else:
            if custom_criteria:
                print("Warning: Invalid format for custom_criteria, reverting to defaults.")
        progress_columns = [
            TextColumn("[bold cyan]{task.description}", justify="right"),
            BarColumn(bar_width=None),  # Auto-adjust width
            "[progress.percentage]{task.percentage:>3.0f}%",
            MofNCompleteColumn(),  # Shows "n/total"
            TextColumn("•"),
            TimeElapsedColumn(),
            TextColumn("<"),
            TimeRemainingColumn(),
        ]
        # --- Format criteria lists for the prompt ---
        formatted_inclusion = "\n".join([f"{i + 1}. {item}" for i, item in enumerate(inclusion_list)])
        formatted_exclusion = "\n".join([f"{i + 1}. {item}" for i, item in enumerate(exclusion_list)])
        # Use Progress context manager
        with Progress(*progress_columns, transient=False) as progress:  # transient=False keeps bar after completion
            # Add a task (the overall loop progress)
            task_id = progress.add_task("[cyan]Classifying Abstracts", total=len(items))

            for n, item in enumerate(items):
                title = item["title"]
                abstract = item["abstract"]
                # Skip if item key is missing
                if not item :
                    # Use progress.print to print messages without breaking the bar
                    progress.print(f"[yellow]Warning:[/yellow] Skipping item without key: {title}")
                    progress.update(task_id, advance=1)  # Still advance progress
                    continue

                abstract = self.update_items_conditioned(collection_name=collection_name, condition="add_abstract",
                                                         item=item) if abstract == ""  and force_abstract else abstract

                # --- Construct the prompt ---
                prompt = f"""

                        **Inclusion Criteria:**

                        {textwrap.indent(formatted_inclusion, ' ' * 4)}
                        ---
                        **Exclusion Criteria:**

                        {textwrap.indent(formatted_exclusion, ' ' * 4)}
                        ---
                        title={title}
                        abstract={abstract}

                """ if mode == "simple" else f"""  title={title}
                                                 abstract={abstract}"""
                item_key = item["key"]
                # functions:"classify_by_abs" if mode == "simple" else "comprehensive_classification"

                response = call_openai_api(data=prompt,
                                           store_only=store,
                                           custom_id=item_key,
                                           function=function,
                                           collection_name=collection_name,
                                           eval=True,
                                           read=item_key if read else read

                                           )

                if response:
                    if store:
                        continue
                    if function=="classify_vendor_reports":

                        classification = response["classification"].lower()

                        justification = response["justification"].lower()
                        keywords = response["keywords"]
                        extra = classification+ "::" + justification
                        tags = [{'tag': item} for item in keywords]
                        # new_collection_key = self.find_or_create_subcollection(parent_key=parent_key,subcoll_name=coll_name)
                        # collection_key= self.find_or_create_subcollection(subcoll_name=coll_name,parent_key=score[response["relevance_score"].lower()])
                        self.add_items_to_collection(
                            collection_key=criteria_key[classification], items_keys=item_key)

                        # self.remove_items_from_collection(collection_key=parent_key, items_keys=item_key)
                        current_item = self.zot.item(item_key)
                        self.update_zotero_item_feature(updates={"tags": tags, "extra": extra}, item=current_item)

                    elif function == "comprehensive_classification":

                        details = response["details"]
                        # coll_name= collection_name+"_"+details["main_focus_summary"]

                        keys_to_check = ['law_aspects', 'policy_aspects', 'other_focus']

                        # 1 & 2: Get the non-empty lists for the specified keys
                        valid_lists = []
                        for key in keys_to_check:
                            value = details.get(key)  # Use .get() for safety
                            if isinstance(value, (list, tuple)) and value:  # Check type and emptiness
                                valid_lists.append(value)
                        flat_list = list(itertools.chain.from_iterable(valid_lists))

                        # 4: Convert to tag dictionaries
                        tags = [{'tag': item} for item in flat_list]
                        keys_to_check = ['law_aspects', 'policy_aspects', 'other_focus']

                        for key in keys_to_check:
                            value = details.get(key)  # Use .get() for safety
                            if isinstance(value, (list, tuple)) and value:  # Check type and emptiness
                                valid_lists.append(value)
                        extra = response["classification"] + ":" + response["justification"]

                        # new_collection_key = self.find_or_create_subcollection(parent_key=parent_key,subcoll_name=coll_name)
                        # collection_key= self.find_or_create_subcollection(subcoll_name=coll_name,parent_key=score[response["relevance_score"].lower()])
                        self.add_items_to_collection(
                            collection_key=parent_col_keys[response["relevance_score"].lower()], items_keys=item_key)
                        self.remove_items_from_collection(collection_key=parent_key, items_keys=item_key)
                        current_item = self.zot.item(item_key)
                        self.update_zotero_item_feature(updates={"tags": tags, "extra": extra}, item=current_item)
                        # Advance the progress bar for this item
                    else:

                        tags = []
                        for dim in classification_dims:
                            val = response.get(dim)
                            if not val:
                                continue
                            # normalize to list
                            values = (val if isinstance(val, (list, tuple)) else [val])
                            parent_key = parent_col_keys[dim]
                            for v in values:
                                # 1) sub‑collection for this value
                                sub_key = self.find_or_create_subcollection(
                                    subcoll_name=f"{collection_name}_{dim}_{v}",
                                    parent_key=parent_key
                                )
                                self.add_items_to_collection(
                                    collection_key=sub_key,
                                    items_keys=[item["key"]]
                                )
                                # 2) tag it
                                tags.append({"tag": f"{dim}:{v}"})

                        # 3) build the extra field (justification + novelty, or just justification)
                        extra = f"novelty:{response.get('novelty')} justification:{response.get('justification')}"

                        # 4) update Zotero item
                        current_item = self.zot.item(item["key"])
                        self.update_zotero_item_feature(
                            updates={"tags": tags, "extra": extra},
                            item=current_item,
                            append=True
                        )

                        # 5) remove from the original parent if desired
                        self.remove_items_from_collection(
                            collection_key=parent_key,  # whatever you called your root
                            items_keys=[item["key"]]
                        )

                progress.update(task_id, advance=1)
        if store:
            if _process_batch_for(collection_name=collection_name,
                                  function=function,
                                  ):
                self.screening_articles(
                    collection_name=collection_name,
                    function=function,
                    store=False,
                    read=True
                )

    # def paper_screener_abs(self, collection_name, store_only=False, read=False,cache=None,screener=None):
    #     """
    #     Screen every item in `collection_name` by generating an abstract
    #     from its PDF.  Items with screening_status “include” or “exclude”
    #     get moved into subcollections
    #     "<collection_name>_include" or "<collection_name>_exclude".
    #     The parent item’s abstractNote, extra field, and tags are updated
    #     with the model’s output.
    #
    #     Params:
    #       collection_name (str): top-level Zotero collection
    #       store_only     (bool): if True, only store model calls; don’t update or move
    #       read           (bool): if True, read from store; ignored if store_only
    #       cache          (dict): optional cache mapping item_key→page_count or text
    #
    #     Returns:
    #       False if extraction fails on any PDF; otherwise None.
    #     """
    #
    #     # function= "paper_screener_abs"
    #     function= "paper_screener_abs_policy"
    #
    #
    #
    #     # 1. Collections
    #     screen_collection_tree = None
    #     screen_title_collections_tree =None
    #
    #     if screener is not None:
    #         abs_collections_tree = self.create_add_collection(parent_collection_name=collection_name,
    #                                                                           screener="abs",
    #                                                                           )
    #         screen_title_collections_tree = self.create_add_collection(parent_collection_name=collection_name,
    #                                                              screener="title",
    #                                                              )
    #     else:
    #         abs_collections_tree = self.create_zotero_screener_collections(parent_collection_name=collection_name,
    #                                                                       screener="abs",
    #                                                                       target_collection=None)
    #         screen_title_collections_tree = self.create_zotero_screener_collections(parent_collection_name=collection_name,
    #                                                                           screener="abs",
    #                                                                           target_collection=None)
    #
    #     # summary_collections_tree = self.create_zotero_summary_collections(parent_collection_name=collection_name,
    #     #                                                                    target_collection=None)
    #     temp_name = next(
    #         (entry["included_temporary"] for entry in  screen_title_collections_tree if "included_temporary" in entry),
    #         None)["collection_name"]
    #     # total_name_screen =  next(
    #     #     (entry["total"] for entry in abs_collections_tree if "total" in entry),
    #     #     None)["collection_name"]
    #
    #     # items= self.get_all_items(total_name_screen)
    #     items= self.get_all_items(collection_name=temp_name,
    #                               cache=cache
    #                               )
    #
    #
    #     print("processing collection:",temp_name)
    #     collection_nmae_errs_key= self.find_or_create_subcollection(subcoll_name=collection_name+"_n_abs_n_pdfs",parent_key=self.find_or_create_top_collection(collection_name))
    #
    #     # 3. Process each PDF
    #     for index,item in enumerate(tqdm(items, desc="Screening abstracts", unit="item")):
    #         item_key = item["key"]
    #         item_title = item["data"]["title"]
    #         # if index <48:
    #         #     continue
    #         abstract =  item["data"].get("abstractNote", "")
    #         pdf_path = self.get_pdf_path_for_item(item_key)
    #         text=""
    #         if not read:
    #             meta = self.generate_metadata(item_key=item_key)
    #
    #             # 3b. Extract text
    #             if pdf_path:
    #                 full_text = process_pdf(pdf_path=pdf_path)["payload"]
    #                 text = f"metadata: {meta}\n\n{full_text}"
    #             else:
    #                 text = f"metadata: {meta}\n\n{abstract}"
    #
    #
    #         if not pdf_path and not abstract:
    #             print("fail processing item:", item)
    #             print(pdf_path)
    #
    #             self.add_items_to_collection(collection_nmae_errs_key)
    #             continue
    #
    #         att_filename = os.path.basename(pdf_path)
    #         logging.info(f"Generating abstract for item {item_key} using '{att_filename}'")
    #
    #
    #
    #
    #
    #         # 1. normalize whitespace so only real text changes matter
    #         normalized = " ".join(text.split())
    #
    #         # 2. build a small payload
    #         payload = {
    #             "item_key": item_key,
    #             "function": function,
    #         }
    #
    #         custom_id = hashlib.sha256("|".join([item_title, function]).encode('utf-8')).hexdigest()
    #         # 3. canonicalize & hash
    #         # canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    #         # custom_id = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    #         # 3c. Call the model
    #         response,cost = call_models(
    #             text=text,
    #             function=function,
    #             store_only=store_only,
    #             read=read,
    #             collection_name=collection_name,
    #
    #             # collection_name=temp_name,
    #             custom_id=custom_id,
    #             # by_index=index
    #
    #         )
    #
    #         if store_only:
    #             print("processing")
    #             continue
    #
    #         # 3d. Pull out results
    #         # generated_abstract = response.get("abstract", "")
    #         justification = response.get("justification")
    #         status = response.get("screening_status")
    #         # keywords = response.get("controlled_vocabulary_terms")
    #         extra = (
    #             f"\njustification for {status}: {justification}"
    #             if justification else "\njustification: None"
    #         )
    #         # print(extra)
    #         # input("extra")
    #         # 4. Update the parent item in Zotero
    #
    #         parent_item = self.zot.item(item_key)
    #         #
    #         # tags = [{'tag': item} for item in keywords] if keywords else []
    #         # tags.append({"tag": f"{status}_abs:{justification}"})
    #         payload ={
    #
    #             "extra": extra,
    #             # "tags": tags
    #             }
    #         # if generated_abstract:
    #         #     payload.update({"abstractNote": generated_abstract})
    #         # also update via your helper (no append to existing extra/abstract)
    #         self.update_zotero_item_feature(
    #             updates=payload,
    #             item=parent_item,
    #             append=True
    #         )
    #
    #
    #         # total_name_screen
    #         # 5. Move into include/exclude
    #
    #         status =status.lower()
    #         if status.lower() in ["included", "excluded"]:
    #             collection_suffixes = ["temporary", "final", "original"]
    #             for suffix in collection_suffixes:
    #
    #                 collection_name_status = f"{status}_{suffix}"
    #                 print(collection_name_status)
    #                 name= next(
    #                     (entry[collection_name_status] for entry in abs_collections_tree if
    #                      collection_name_status in entry),
    #                     None)["collection_name"]
    #
    #
    #                 key = next(
    #                     (entry[collection_name_status] for entry in abs_collections_tree if
    #                      collection_name_status in entry),
    #                     None)["collection_key"]
    #                 self.add_items_to_collection(collection_key=key, items_keys=item_key,tag=f"# LLM> {status}:{justification}")
    #
    #
    #         else:
    #             criteria_key_screen = next(
    #                 (entry[status.lower()] for entry in abs_collections_tree if status.lower() in entry),
    #                 None)["collection_key"]
    #             criteria_name_screen = next(
    #                 (entry[status.lower()] for entry in abs_collections_tree if status.lower() in entry),
    #                 None)["collection_name"]
    #             print("no add collection: ",criteria_name_screen)
    #
    #
    #
    #             criteria_key_sum = next(
    #                 (entry[status.lower()] for entry in abs_collections_tree if status.lower() in entry),
    #                 None)["collection_key"]
    #             self.add_items_to_collection(collection_key=criteria_key_sum, items_keys=item_key)
    #
    #             self.add_items_to_collection(collection_key=criteria_key_screen, items_keys=item_key,tag=f" #LLM> {status}:{justification}")
    #
    #
    #
    #     if store_only:
    #
    #
    #         if _process_batch_for(collection_name=collection_name,
    #                               function=function,
    #                               ):
    #             self.paper_screener_abs(
    #                 collection_name=collection_name,
    #                 store_only=False,
    #                 read=True,
    #                 screener=screener,
    #             )
    #     return True
    def paper_screener_abs(self, collection_name, store_only=False, read=False, cache=None, screener=None,included_tag="#0_1_included_ine",excluded_tag="#0_1_excluded_ine",        function = "paper_screener_abs_policy"
):

        """
            Screen every item in `collection_name` by generating an abstract
            from its PDF.  Items with screening_status “include” or “exclude”
            get moved into subcollections
            "<collection_name>_include" or "<collection_name>_exclude".
            The parent item’s abstractNote, extra field, and tags are updated
            with the model’s output.

            Params:
              collection_name (str): top-level Zotero collection
              store_only     (bool): if True, only store model calls; don’t update or move
              read           (bool): if True, read from store; ignored if store_only
              cache          (dict): optional cache mapping item_key→page_count or text

            Returns:
              False if extraction fails on any PDF; otherwise None.
            """


        # 1) Resolve the root collection and build a flat results tree under it
        parent_key = self.find_or_create_top_collection(collection_name)
        if not parent_key:
            print(f"[paper_screener_abs] Could not resolve top collection: {collection_name}")
            return False

        results_root_name = f"{collection_name}_results"
        results_root_key = self.find_or_create_subcollection(subcoll_name=results_root_name, parent_key=parent_key)

        # helper to create the 3-phase buckets (temporary/final/original) for a status
        def _mk_bucket(status: str) -> list[dict]:
            out = []
            for phase in ("temporary", "final"):
                name = f"{status}_{phase}"
                coll_key = self.find_or_create_subcollection(subcoll_name=name, parent_key=results_root_key)
                out.append({name: {"collection_key": coll_key, "collection_name": name}})
            return out

        # Build destinations used later by the moving logic
        abs_collections_tree = []
        abs_collections_tree += _mk_bucket("included")
        abs_collections_tree += _mk_bucket("excluded")
        abs_collections_tree += _mk_bucket("maybe")

        # 2) Pull items directly from the user-specified collection (no multi-collection tree)
        items = self.get_all_items(collection_name=collection_name, cache=cache)
        print("processing collection:", collection_name)
        keys = {i:self.find_or_create_subcollection(subcoll_name=collection_name+i,parent_key=parent_key) for i in ["included", "excluded","maybe"]}
        # 3) Error bucket for items with no PDF and no abstract
        collection_nmae_errs_key = self.find_or_create_subcollection(
            subcoll_name=f"{collection_name}_n_abs_n_pdfs",
            parent_key=parent_key
        )

        def _to_substrings(x):
            if isinstance(x, (list, tuple, set)):
                return {str(v).lower() for v in x if v is not None and str(v) != ""}
            if x is None or x == "":
                return set()
            return {str(x).lower()}

        def _item_has_key(item, substrings):
            if not substrings:
                return False
            for t in item.get('data', {}).get('tags', []):
                s = str(t.get('tag', '')).lower()
                if any(sub in s for sub in substrings):
                    return True
            return False

        def _select_llm_tag(tags):
            original_tags = [str(t.get('tag', '')) for t in tags]
            pairs = [(orig, orig.strip().lower()) for orig in original_tags]
            # keep tags that contain "llm" but NOT "llm:maybe"
            kept = [orig for orig, low in pairs if ('llm' in low) and ('llm:maybe' not in low)]
            if not kept:
                return None
            # prefer those that start with "llm:" and, within that, prefer "llm:included:"
            starts_llm = [t for t in kept if t.strip().lower().startswith('llm:')]
            if starts_llm:
                preferred = [t for t in starts_llm if t.strip().lower().startswith('llm:included:')]
                return preferred[0] if preferred else starts_llm[0]
            return kept[0]
        full_text=""

        inc_subs = _to_substrings(included_tag)
        exc_subs = _to_substrings(excluded_tag)

        included_items = [
                             ("title: " + str(item.get('data', {}).get('title', "")),
                              "tag: " + llm_tag)
                             for item in items
                             if _item_has_key(item, inc_subs)
                             for llm_tag in [_select_llm_tag(item.get('data', {}).get('tags', []))]
                             if llm_tag
                         ][:25]

        excluded_items = [
                             ("title: " + str(item.get('data', {}).get('title', "")),
                              "tag: " + llm_tag)
                             for item in items
                             if _item_has_key(item, exc_subs)
                             for llm_tag in [_select_llm_tag(item.get('data', {}).get('tags', []))]
                             if llm_tag
                         ][:25]

        def _fmt_examples(pairs, label, k=8):
            out = []
            for title_str, tag_str in pairs[:k]:
                # strip the "title: " / "tag: " prefixes if present
                title = title_str.split("title: ", 1)[1] if "title: " in title_str else str(title_str)
                tag = tag_str.split("tag: ", 1)[1] if "tag: " in tag_str else str(tag_str)
                out.append(f"- {title} || {tag.replace('LLM:', '').strip()}")
            body = "\n".join(out) if out else "- (none)"
            return f"{label}:\n{body}"

        examples_block = (
                "GUIDANCE_EXAMPLES\n"
                "Use these prior, LLM-labelled examples to calibrate include vs exclude decisions.\n"
                + _fmt_examples(included_items, "INCLUDED examples")
                + "\n"
                + _fmt_examples(excluded_items, "EXCLUDED examples")
                + "\n\n"
        )
        full_text += examples_block


        items = [item for item in items if not any(tag['tag'] in [included_tag,excluded_tag] for tag in item['data'].get('tags', []))]

        print(f"Found {len(items)} items to process after filtering by tags.")
        if not items:
            print("No items to process after filtering. Exiting.")

        # 3. Process each PDF
        for index, item in enumerate(tqdm(items, desc="Screening abstracts", unit="item")):

            if included_tag==903:
                self.add_items_to_collection(collection_key=collection_nmae_errs_key, items_keys=item["key"],tag=["#LLM> Not processed"])
            if index == 903:
                continue
            item_key = item["key"]
            creates= item.get('data', {}).get("creators", [])

            print("creators=",creates)



            if not read:
                pdf_path = self.get_pdf_path_for_item(item_key)

                full_text = f"TEXT:{process_pdf(pdf_path=pdf_path)['payload']}\n\n\n" if pdf_path else ""

                meta = self.generate_metadata(item_key=item_key)
                full_text += f"METADATA {meta}\n\n{full_text}"


            # 3c. Call the model
            response, cost = call_models(
                text=full_text,
                function=function,
                store_only=store_only,
                read=read,
                collection_name=collection_name,

                # collection_name=temp_name,
                custom_id=item_key,
                # by_index=index

            )


            if store_only:
                continue

            # 3d. Pull out results
            generated_abstract = response.get("abstract", "")
            if not response:
                continue
            justification = response.get("justification")
            status = response.get("screening_status")
            # keywords = response.get("controlled_vocabulary_terms")
            extra = (
                f"\njustification for {status}: {justification}"
                if justification else "\njustification: None"
            )


            parent_item = self.zot.item(item_key)
            #
            # tags = [{'tag': item} for item in keywords] if keywords else []
            # tags.append({"tag": f"{status}_abs:{justification}"})
            payload = {

                "extra": extra,
                # "tags": tags
            }
            if generated_abstract:
                payload.update({"abstractNote": generated_abstract})
            # also update via your helper (no append to existing extra/abstract)
            self.update_zotero_item_feature(
                updates=payload,
                item=parent_item,
                append=True
            )

            # total_name_screen
            # 5. Move into include/exclude

            status = status.lower()
            from html import unescape as _unesc
            import re as _re
            MAX_TAG_LEN = 250
            _status_key = (status or "").strip().lower()
            _prefix = f"LLM_status:{_status_key}:"
            _just = _re.sub(r"\s+", " ", _unesc(str(justification or ""))).strip()
            _room = max(0, MAX_TAG_LEN - len(_prefix))
            _snippet = _just[:_room] + ("..." if len(_just) > _room else "")
            tags =[_prefix,f"{status}:{_snippet}"]

            self.add_items_to_collection(collection_key=keys[status], items_keys=item_key,tag=tags)


        if store_only:

            if _process_batch_for(collection_name=collection_name,
                                  function=function,
                                  ):
                self.paper_screener_abs(
                    collection_name=collection_name ,
                    store_only=False,
                    read=True,
                    screener=screener,
                    function=function

                )
        return True

    def export_status_match_table(
            self,
            collection_name: str,
            excel_path: str | None = None,
            cache: bool = True,
            verbose: bool = True,
    ) -> dict:
        """
        Build a table: title, authors, llm, human, match.
        Filter rows to ONLY those where a human status was detected.
        Robust export: use xlsxwriter if available; else openpyxl; else CSV.
        """
        import os
        import re
        import importlib.util as _iu
        import pandas as pd

        def _engine_available(name: str) -> bool:
            return _iu.find_spec(name) is not None

        def _norm_status(s: str | None) -> str | None:
            if not s:
                return None
            s = s.strip().lower()
            if s.startswith("inc"):
                return "Included"
            if s.startswith("exc"):
                return "Excluded"
            if s.startswith("may"):
                return "Maybe"
            return None

        # Flexible separators: colon, greater-than, hyphen, en/em dash, or spaces
        _SEP = r"(?:\s*[:>\-\u2013\u2014]\s*|\s+)"
        _STATUS = r"(?:included|excluded|maybe)\b"

        # LLM tags: immediate status or trailing form, anywhere in tag
        pat_llm_head = re.compile(rf"\bllm{_SEP}(?P<status>{_STATUS})", re.IGNORECASE)
        pat_llm_trail = re.compile(rf"\bllm{_SEP}.*?\b(?P<status>{_STATUS})", re.IGNORECASE)

        # Human tags:
        #   "#Status: Included" / "Status: Excluded"  → strict colon form
        pat_human_colon = re.compile(rf"\bstatus\s*:\s*(?P<status>{_STATUS})", re.IGNORECASE)
        #   "Status - Included" / "Status Included"   → other separators
        pat_human_sep = re.compile(rf"\bstatus{_SEP}(?P<status>{_STATUS})", re.IGNORECASE)
        #   "status:comments: Included …"
        pat_human_comments = re.compile(rf"\bstatus:comments\s*:\s*(?P<status>{_STATUS})", re.IGNORECASE)

        def _extract_llm_status(tags_list) -> str | None:
            for t in tags_list or []:
                s = str((t.get("tag") if isinstance(t, dict) else t) or "")
                m = pat_llm_head.search(s)
                if m:
                    return _norm_status(m.group("status"))
            for t in tags_list or []:
                s = str((t.get("tag") if isinstance(t, dict) else t) or "")
                m = pat_llm_trail.search(s)
                if m:
                    return _norm_status(m.group("status"))
            return None

        def _extract_human_status(tags_list) -> str | None:
            for t in tags_list or []:
                s = str((t.get("tag") if isinstance(t, dict) else t) or "")
                m = pat_human_colon.search(s)
                if m:
                    return _norm_status(m.group("status"))
            for t in tags_list or []:
                s = str((t.get("tag") if isinstance(t, dict) else t) or "")
                m = pat_human_sep.search(s)
                if m:
                    return _norm_status(m.group("status"))
            for t in tags_list or []:
                s = str((t.get("tag") if isinstance(t, dict) else t) or "")
                m = pat_human_comments.search(s)
                if m:
                    return _norm_status(m.group("status"))
            return None

        def _format_authors(creators: list | None) -> str:
            if not creators:
                return ""
            out = []
            for c in creators:
                if not isinstance(c, dict):
                    continue
                last = c.get("lastName", "") or ""
                first = c.get("firstName", "") or ""
                corp = c.get("name", "") or ""
                if last or first:
                    out.append(f"{last}, {first}".strip(", "))
                elif corp:
                    out.append(corp)
            return "; ".join([a for a in out if a])

        def _default_excel_path(name: str) -> str:
            safe = re.sub(r"[^A-Za-z0-9._-]+", "_", (name or "collection").strip())
            return os.path.join(os.getcwd(), f"{safe}_llm_vs_human_status.xlsx")

        items = self.get_all_items(collection_name=collection_name, cache=cache)

        rows = []
        for it in items:
            data = it.get("data", {}) or {}
            title = data.get("title", "") or ""
            creators = data.get("creators", []) or []
            tags = data.get("tags", []) or []

            llm_status = _extract_llm_status(tags)
            human_status = _extract_human_status(tags)
            match = "yes" if (llm_status and human_status and llm_status == human_status) else "no"

            rows.append({
                "title": title,
                "authors": _format_authors(creators),
                "llm": llm_status or "",
                "human": human_status or "",
                "match": match,
            })

        df = pd.DataFrame(rows, columns=["title", "authors", "llm", "human", "match"])
        df = df[df["human"].astype(str).str.len() > 0].reset_index(drop=True)

        path = excel_path or _default_excel_path(collection_name)
        out_dir = os.path.dirname(path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)

        engine = None
        if _engine_available("xlsxwriter"):
            engine = "xlsxwriter"
        elif _engine_available("openpyxl"):
            engine = "openpyxl"

        wrote = False
        used_format = None
        errors = []

        if engine == "xlsxwriter":
            try:
                with pd.ExcelWriter(path, engine="xlsxwriter") as writer:
                    df.to_excel(writer, sheet_name="status", index=False)
                    ws = writer.sheets["status"]
                    ws.set_column(0, 0, 60)
                    ws.set_column(1, 1, 35)
                    ws.set_column(2, 4, 12)
                wrote = True
                used_format = "xlsx:xlsxwriter"
            except Exception as e:
                errors.append(f"xlsxwriter:{e}")

        if (engine == "openpyxl" or not wrote) and _engine_available("openpyxl"):
            try:
                with pd.ExcelWriter(path, engine="openpyxl") as writer:
                    df.to_excel(writer, sheet_name="status", index=False)
                    try:
                        from openpyxl.utils import get_column_letter
                        ws = writer.sheets["status"]
                        widths = {1: 60, 2: 35, 3: 12, 4: 12, 5: 12}
                        for idx, w in widths.items():
                            ws.column_dimensions[get_column_letter(idx)].width = w
                    except Exception:
                        pass
                wrote = True
                used_format = "xlsx:openpyxl"
            except Exception as e:
                errors.append(f"openpyxl:{e}")

        if not wrote:
            try:
                base, _ = os.path.splitext(path)
                path = base + ".csv"
                df.to_csv(path, index=False, encoding="utf-8")
                wrote = True
                used_format = "csv"
            except Exception as e:
                errors.append(f"csv:{e}")

        if verbose:
            print(f"[export] filtered_rows={len(df)} (human-detected only)")
            print(f"[export] path='{path}' format='{used_format}' wrote={wrote}")
            if errors:
                print(f"[export] notes: {' | '.join(errors)}")

        return {
            "excel_path": path,
            "rows": int(len(df)),
            "collection": collection_name,
            "format": used_format,
            "errors": errors,
            "wrote": wrote,
        }

    def split_collection_by_status_tag(
            self,
            collection_name: str,
            *,
            with_suffix: str = "with_tags",
            without_suffix: str = "no_tags",
            cache: bool = True,
            verbose: bool = True,
    ) -> dict:
        """
        Split <collection_name> into two subcollections:

          • <collection_name>_<with_suffix>   → items that HAVE at least one *marker* tag
          • <collection_name>_<without_suffix>→ items that have NO TAGS at all

        Marker tag detection (case-insensitive, robust to punctuation and Unicode colons/dashes):
          - Tag starts with '#'
          - Tag contains a standalone 'LLM' (e.g., 'LLM:maybe', 'llm — excluded')
          - Tag contains a standalone 'Status' (e.g., 'Status: Included', 'status - excluded')

        Important:
          - Items with tags that are not markers are left in the source collection (not added to either subcollection).
          - To avoid false "no_tags" due to cached items missing tag arrays, this function
            will try a one-shot fresh fetch for items whose cached tags are empty.
        """
        import re

        # Standalone word detection for 'llm' and 'status' (not inside other words like 'Williams')
        _LLM_WORD = re.compile(r"(?<![A-Za-z0-9])llm(?![A-Za-z0-9])", re.IGNORECASE)
        _STATUS_WORD = re.compile(r"(?<![A-Za-z0-9])status(?![A-Za-z0-9])", re.IGNORECASE)
        _LEADS_HASH = re.compile(r"^\s*#")

        def _extract_tags_safe(item_data: dict, key: str):
            """
            Return a reliable list of tags for an item.
            If cache returned empty, attempt a live fetch once.
            """
            tags = item_data.get("tags", [])
            if tags:
                return tags

            # try a one-shot refresh if tags appear empty
            try:
                # pyzotero single-item fetch; ignore if not available
                fresh = None
                if hasattr(self, "zot") and hasattr(self.zot, "item"):
                    fresh = self.zot.item(key)
                elif hasattr(self, "get_item_by_key"):
                    fresh = self.get_item_by_key(key)  # user-defined helper, if present
                if isinstance(fresh, dict):
                    return fresh.get("data", {}).get("tags", []) or []
            except Exception:
                pass
            return tags or []

        def _has_marker_tag(tags_list) -> bool:
            if not tags_list:
                return False
            for t in tags_list:
                raw = (t.get("tag") if isinstance(t, dict) else t) or ""
                s = str(raw).strip()
                if not s:
                    continue
                # 1) starts with '#'
                if _LEADS_HASH.search(s):
                    return True
                # 2) contains standalone 'llm'
                if _LLM_WORD.search(s):
                    return True
                # 3) contains standalone 'status'
                if _STATUS_WORD.search(s):
                    return True
            return False

        parent_key = self.find_or_create_top_collection(collection_name)
        items = self.get_all_items(collection_name=collection_name, cache=cache)

        with_keys: list[str] = []
        no_tag_keys: list[str] = []

        for it in items:
            data = it.get("data", {}) or {}
            key = data.get("key", "")
            tags = _extract_tags_safe(data, key)

            if not tags:
                no_tag_keys.append(key)
            elif _has_marker_tag(tags):
                with_keys.append(key)
            # else: has tags but none are markers → leave in source

        # Create/find target subcollections
        coll_with_name = f"{collection_name}_{with_suffix}"
        coll_without_name = f"{collection_name}_{without_suffix}"
        coll_with_key = self.find_or_create_subcollection(subcoll_name=coll_with_name, parent_key=parent_key)
        coll_without_key = self.find_or_create_subcollection(subcoll_name=coll_without_name, parent_key=parent_key)

        # Order-preserving dedupe
        with_keys = list(dict.fromkeys(with_keys))
        no_tag_keys = list(dict.fromkeys(no_tag_keys))

        # Apply
        if with_keys:
            self.add_items_to_collection(collection_key=coll_with_key, items_keys=with_keys)
        if no_tag_keys:
            self.add_items_to_collection(collection_key=coll_without_key, items_keys=no_tag_keys)

        if verbose:
            print(f"[split_by_status_tag] scanned={len(items)}  with={len(with_keys)}  no_tags={len(no_tag_keys)}")
            print(f"[split_by_status_tag] with → {coll_with_name} ({coll_with_key})")
            print(f"[split_by_status_tag] no_tags → {coll_without_name} ({coll_without_key})")

        return {
            "source_collection": collection_name,
            "with_tags_collection": coll_with_name,
            "with_tags_key": coll_with_key,
            "without_tags_collection": coll_without_name,
            "without_tags_key": coll_without_key,
            "total_items_scanned": len(items),
            "items_with_markers": len(with_keys),
            "items_no_tags": len(no_tag_keys),
        }

    def parse_extra_justifications(self, collection_name: str, cache: bool = True) -> list[dict]:
        """
        For each item in a given collection, parse the 'extra' field to extract
        justification information in the format:
           "justification for <Status>: <reason text>"

        Returns a list of dicts with:
           {
             'key': <itemKey>,
             'title': <item title>,
             'status': <Included|Excluded|Maybe|None>,
             'justification': <reason text or None>
           }
        """
        import re
        col_key = self.find_or_create_top_collection(collection_name)


        results = []
        items = self.get_all_items(collection_name=collection_name, cache=cache)

        for index,it in enumerate(items):
            print(f"processing index{index} / {len(items)}")
            if index>69:
                continue
            data = it.get("data", {})
            extra = data.get("extra", "") or ""
            title = data.get("title", "")
            key = data.get("key", "")

            status, justification = None, None

            for line in extra.splitlines():
                line = line.strip()
                m = re.match(r"^justification for\s+(\w+)\s*:\s*(.+)$", line, re.I)
                if m:
                    status = m.group(1).capitalize()  # normalise Included/Excluded/Maybe
                    justification = m.group(2).strip()[:250]  # limit length
                    break

            if justification:
                folder = self.find_or_create_subcollection(subcoll_name=status+"_"+justification,parent_key=col_key)
                self.add_items_to_collection(collection_key=folder,items_keys=key)
            print({
                "key": key,
                "title": title,
                "status": status,
                "justification": justification,
            })
            results.append({
                "key": key,
                "title": title,
                "status": status,
                "justification": justification,
            })

        return results

    def filter_by_tag(self, summary_collections_tree ,screen_collections_tree,items,tags=["Purely technical","Non English"],cache=True,):
        tags = [tag.replace(" ","_") for tag in tags]

        # included + its temporary/final
        included_entry_screen = next((e for e in screen_collections_tree if "included" in e), {})
        included_coll_screen = included_entry_screen.get("included", {})

        included_entry_sum = next((e for e in summary_collections_tree if "included" in e), {})
        included_coll_sum = included_entry_screen.get("included", {})
        included_name_sum = included_coll_screen.get("collection_name")
        included_key_sum = included_coll_screen.get("collection_key")

        included_temp = included_entry_screen.get("temporary", {})
        temp_name = included_temp.get("collection_name")
        temp_key = included_temp.get("collection_key")

        # excluded + its temporary/final
        excluded_entry = next((e for e in screen_collections_tree if "excluded" in e), {})
        excluded_coll = excluded_entry.get("excluded", {})
        excluded_name = excluded_coll.get("collection_name")
        excluded_key = excluded_coll.get("collection_key")

        excluded_temp = excluded_entry.get("temporary", {})
        ex_temp_name = excluded_temp.get("collection_name")
        ex_temp_key = excluded_temp.get("collection_key")

        # 1) default fix
        if tags is None:
            tags = []

        # 2) normalizer
        def normalize_tag(s: str) -> str:
            s = s.strip().lower()
            s = re.sub(r'^[^:]+:', '', s)  # drop "prefix:"
            return re.sub(r'[\s\-]+', ' ', s)  # collapse hyphens/spaces

        # 3) normalized lookup set
        norm_search = {normalize_tag(t) for t in tags}

        # 4) build clusters
        clusters = {t: [] for t in norm_search}
        for item in items:
            item_norm = {
                normalize_tag(d.get("tag", ""))
                for d in item.get("data", {}).get("tags", [])
                if isinstance(d, dict)
            }
            for t in norm_search:
                if t in item_norm:
                    clusters[t].append(item["key"])

        # 6) create per-tag subcollections and move items
        for tag, item_keys in clusters.items():
            if not item_keys:
                continue  # skip empty buckets
            tag_coll_screen = included_entry_screen.get(tag, {})
            tag_key_screen = tag_coll_screen.get("collection_key")

            tag_coll_sum = included_entry_sum .get(tag, {})
            tag_key_sum = tag_coll_sum.get("collection_key")
            # nest under new_collection

            self.moving_items_from_collection(
                old_collection_key=temp_key,
                new_collection_key=tag_key_screen,
                items_keys=item_keys
            )

            self.add_items_to_collection(collection_key=tag_key_sum ,items_keys=item_keys)
    def classify_by_title(self, collection_name, store=False, items=None,cache=False, read=False,screener="add"):
        """
        Screen every item in `collection_name` in batches of 10.
         - If store=True: write batch requests, then re-call with store=False.
         - If store=False: read back each batch's responses and update Zotero.
         - If store=None: pass read=None through to call_models.
        """
        screen_collections_tree = self.create_zotero_screener_collections(
            parent_collection_name=collection_name,
            screener="abs",
            target_collection=None)
        print(screen_collections_tree)

        add_collections_tree =self.create_add_collection(parent_collection_name=collection_name, screener="title")

        print(add_collections_tree)
        # summary_collections_tree = self.create_zotero_summary_collections(
        #     parent_collection_name=collection_name,
        #     target_collection=None)


        function = "title_screening"

        add_name_screen = next(
            (entry["add"] for entry in screen_collections_tree if "add" in entry),
            None)["collection_name"]
        add_key_sum = next(
            (entry["add"] for entry in screen_collections_tree if "add" in entry),
            None)["collection_key"]


        print("add_name",add_name_screen)
        input("continue to items")
        move= False
        index=0
        # 1️⃣ Fetch items and build a list of payload dicts
        items = [
            {
                "item_key": item["key"],
                "title": item["data"].get("title", ""),
                "abstract": item["data"].get("abstractNote", "")
            }
            for item in self.get_all_items(collection_name=add_name_screen, cache=cache)
        ] if items==None else items

        # 2️⃣ Chunk into batches of ≤10
        batches = [
            items[i: i + 10]
            for i in range(0, len(items), 10)
        ]

        # 3️⃣ Determine flags for call_models
        store_only_flag = store
        read_flag = None if store is None else not bool(store)



        # 5️⃣ If in STORE mode, write out all batches, then re-invoke and return
        if store:
            for batch in batches:
                payload = {"records": batch}
                batch_keys = sorted(item["title"] for item in batch)
                custom_id = hashlib.sha256("|".join(batch_keys).encode('utf-8')).hexdigest()
                try:
                    call_models(
                        function=function,
                        text=json.dumps(payload),
                        store_only=store_only_flag,
                        read=read,
                        collection_name=collection_name,
                        custom_id=custom_id

                    )
                except Exception as e:
                    print(f"[ERROR] Failed to store batch of {len(batch)} items: {e}")
            # after storing, signal external batch processor, then re-run in read-mode
            if _process_batch_for(collection_name=collection_name, function=function):
                # now read back and apply
                self.classify_by_title(collection_name=collection_name, store=False,items=items)
            return

        # 6️⃣ Otherwise (store=False or store=None), read back each batch and process
        all_responses = []
        for batch in batches:
            # print(index)

            # if index<6:continue

            payload = {"records": batch}
            batch_keys = sorted(item["item_key"] for item in batch)
            custom_id = hashlib.sha256("|".join(batch_keys).encode("utf-8")).hexdigest()

            try:
                resp,cost = call_models(
                    function=function,
                    text=json.dumps(payload),
                    store_only=store_only_flag,
                    read=read_flag,
                    collection_name=collection_name,
                    custom_id=custom_id,
                    by_index= index,
                )
            except Exception as e:
                print(f"[ERROR] Screening failed for batch starting with '{batch[0]['item_key']}': {e}")
                continue
            index += 1
            # ‼️ Normalise and validate response shape
            if isinstance(resp, dict) and "results" in resp:
                records = resp["results"]
            elif isinstance(resp, list):
                records = resp
            else:
                raise RuntimeError(f"Unexpected response format: {resp!r}")



            # 7️⃣ Map each result back to its original item via positional zip
            for idx, record in enumerate(records):
                # try the model’s key, otherwise fall back to the batch key at the same index
                item_key = record.get("item_key") or batch[idx]["item_key"]

                status = record.get("screening_status", "").lower().replace("clude","cluded")

                just = record.get("justification", "").strip()
                kws = record.get("keywords_matched", [])
                tags = [{"tag": kw} for kw in kws] + [{"tag": f"{status}:{just}"}]
                snippet = (
                    '<div class="screening-snippet">\n'
                    '<h3>Title Screening</h3>\n<ul>\n'
                    f'<li>{status.title()}: {just}</li>\n'
                    '</ul>'
                )

                # always use the fallback key if append_info_note_log fails
                try:
                    self.append_info_note_log(item_key=item_key, snippet=snippet)
                except Exception:
                    fallback_key = batch[idx]["item_key"]

                    logging.error(f"Bad key '{item_key}', using fallback '{fallback_key}'")
                    item_key = fallback_key
                    self.append_info_note_log(item_key=item_key, snippet=snippet)

                # 1. Collections

                print("status:",status)
                # 5. Move into include/exclude
                if status=="included":
                    included = "included_temporary"
                    included_temporary_key_screen = next(
                        (entry[status.lower()] for entry in add_collections_tree if status.lower() in entry),
                        None)["collection_key"]

                if screener=="add":
                    if status in ["included", "excluded"]:
                        collection_suffixes = ["temporary", "final", "original"]
                        for suffix in collection_suffixes:
                            collection_name = f"{status}_{suffix}"
                            key = next(
                                (entry[collection_name] for entry in add_collections_tree if
                                 collection_name in entry),
                                None)["collection_key"]
                            self.add_items_to_collection(collection_key=key, items_keys=item_key)

                    criteria_key_screen = next(
                        (entry[status.lower()] for entry in  add_collections_tree if status.lower() in entry),
                        None)["collection_key"]
                    criteria_key_sum = next(
                        (entry[status.lower()] for entry in  add_collections_tree if status.lower() in entry),
                        None)["collection_key"]
                    self.add_items_to_collection(collection_key=criteria_key_sum, items_keys=item_key)

                    self.add_items_to_collection(collection_key=criteria_key_screen, items_keys=item_key)
                else:
                    if status in ["included","excluded"]:
                        collection_suffixes = [ "temporary","final","original"]
                        for suffix in collection_suffixes:
                            collection_name = f"{status}_{suffix}"
                            key = next(
                                (entry[collection_name] for entry in screen_collections_tree  if  collection_name in entry),
                                None)["collection_key"]
                            self.add_items_to_collection(collection_key=key, items_keys=item_key)



                    criteria_key_screen = next(
                        (entry[status.lower()] for entry in screen_collections_tree if status.lower() in entry),
                        None)["collection_key"]
                    criteria_key_sum = next(
                        (entry[status.lower()] for entry in screen_collections_tree  if status.lower() in entry),
                        None)["collection_key"]
                    self.add_items_to_collection(collection_key=criteria_key_sum, items_keys=item_key)

                    self.add_items_to_collection(collection_key=criteria_key_screen, items_keys=item_key)


                zot_item = self.zot.item(item_key)
                self.update_zotero_item_feature(
                    updates={"extra": just, "tags": tags},
                    item=zot_item,
                )

    def append_info_note_log(self, item_key, snippet):
        """
        Append `snippet` to an existing child note that has tag=='payload_note'.
        If none exists, create a new child note with that tag and `snippet` as content.
        Deduplicates by checking if `snippet` is already present in the note HTML.
        """
        if not isinstance(snippet, str) or not snippet.strip():
            return False

        children = self.zot.children(item_key)

        # filter only notes that already carry the 'payload_note' tag
        payload_notes = [
            c for c in children
            if c.get("data", {}).get("itemType") == "note"
               and any(t.get("tag") == "payload_note" for t in c.get("data", {}).get("tags", []))
        ]

        if payload_notes:
            note_child = payload_notes[0]
            old_html = note_child["data"].get("note", "") or ""
            if snippet in old_html:
                return False

            tags = note_child["data"].get("tags", []) or []
            # ensure tag is present (should already be, but keep idempotent)
            if not any(t.get("tag") == "payload_note" for t in tags):
                tags.append({"tag": "payload_note"})

            new_content = old_html + snippet
            update_note_zotero(note_child, tags, new_content, self.zot)
            return True

        # no existing payload_note: create a new child note attached to the item
        note_item = {
            "itemType": "note",
            "parentItem": item_key,
            "note": snippet,
            "tags": [{"tag": "payload_note"}],
        }
        try:
            # pyzotero accepts a list of item dicts
            self.zot.create_items([note_item])
            return True
        except Exception:
            return False
    def classify_items_by_feature(self, collection_name=None, all=None, feature="url"):
        print("initiating classification")
        groups = group_by_publication_title(
            self.get_all_items(all=all, collection_name=collection_name if not all else None), feature=feature)

        parent_key = self.find_or_create_top_collection("Auto_url_" + collection_name)
        for subcoll_name, items in groups.items():
            print("processing collection:", subcoll_name)
            # Check if child collection exists under parent
            child_key = self.find_or_create_subcollection(subcoll_name=subcoll_name, parent_key=parent_key)

            print(f"Classifying item '{subcoll_name}'")
            item_keys = [i["key"] for i in items]

            self.add_items_to_collection(collection_key=child_key, items_keys=item_keys)

    def get_all_items(self, collection_name=None, cache=False, all=False, cache_path='zotero_items_cache.json'):
        """
        Retrieves items *directly within* a specific collection by name,
        excluding items in subcollections. Handles duplicates interactively and
        prompts to delete empty collections. Filters non-research types.

        Args:
            collection_name (str, optional): Name of the collection. If None or all=True, fetch entire library.
            cache (bool): Use local cache file.
            all (bool): If True, ignore collection_name and fetch entire library.
            cache_path (str): Path to the JSON cache file.

        Returns:
            list: Filtered Zotero items (dictionaries) from the specified collection level.
                  Returns empty list on critical errors or if an empty collection was deleted.
        """
        # 1) Load cache (same as before)
        cache_data = {}
        cache_path = os.path.abspath(cache_path)

        if os.path.exists(cache_path):
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    # cache_data = json.load(f)
                    loaded = json.load(f)
                    if isinstance(loaded, dict):
                        cache_data = loaded
                    else:
                        logging.warning("Cache file malformed; resetting cache_data")
            except Exception as e:
                logging.warning(f"Could not parse cache at {cache_path}: {e}. Starting fresh.")

        # 2) Determine cache key (same as before)
        cache_key = "all_library" if (all or not collection_name) else collection_name

        # 3) Check cache (same as before)
        if cache and cache_key in cache_data:
            logging.info(f"Loading Zotero items from cache under key '{cache_key}' in {cache_path}");
            return cache_data[cache_key]

        # --- Collection Resolution & Item Fetching ---
        all_items_from_api = []
        target_coll_key = None
        resolved_collection_data = None

        if collection_name and not all:
            logging.info(f"Resolving collection name: '{collection_name}' using find_or_create_top_collection...")
            # Use the robust find/create function
            target_coll_key = self.find_or_create_top_collection(collection_name)  # Or subcollection if needed

            if not target_coll_key:
                logging.error(
                    f"Could not resolve or create a unique collection for '{collection_name}'. Aborting item fetch.")
                return []

            logging.info(f"Successfully resolved collection '{collection_name}' to key: {target_coll_key}")
            try:
                resolved_collection_data = self.zot.collection(target_coll_key)
            except Exception as e:
                logging.warning(f"Could not fetch data for resolved collection key {target_coll_key}: {e}")
                resolved_collection_data = None

            # --- Fetch items using the resolved key ---
            logging.info(f"Fetching items DIRECTLY WITHIN collection key: {target_coll_key} (handling pagination)")
            try:
                # *** KEY CHANGE: Revert back to zot.collection_items(...) ***
                all_items_from_api = self.zot.everything(self.zot.collection_items(target_coll_key))
                # ************************************************************

                logging.info(
                    f"API (using /collections/../items) returned {len(all_items_from_api)} total items/entries for collection {target_coll_key}.")

                # *** ENHANCED DEBUGGING: Log item types AND collections list BEFORE filtering ***
                if all_items_from_api:
                    logging.debug(f"Item details returned by API for collection {target_coll_key} (before filtering):")
                    for idx, item_api in enumerate(all_items_from_api):


                        item_data_debug = item_api.get('data', {})
                        item_type = item_data_debug.get('itemType', 'N/A')
                        item_key_api = item_api.get('key', 'N/A')
                        item_title = item_data_debug.get('title', 'N/A')
                        item_collections = item_data_debug.get('collections', [])  # Get the collections list
                        logging.debug(
                            f"  - Item {idx + 1}: Key={item_key_api}, Type='{item_type}', Title='{item_title[:50]}...', Collections={item_collections}")
                        # Optionally pretty-print the whole item data for deep debug:
                        # logging.debug(f"    Full Data: {pprint.pformat(item_api)}")
                else:
                    logging.debug(f"API returned 0 items for collection {target_coll_key} using collection_items.")
                # *** END ENHANCED DEBUGGING ***

                # --- Empty Collection Check (logic remains the same) ---
                if not all_items_from_api and resolved_collection_data:
                    coll_display_name = resolved_collection_data.get('data', {}).get('name', collection_name)
                    logging.warning(
                        f"Collection '{coll_display_name}' (Key: {target_coll_key}) contains 0 items according to API.")
                    if not sys.stdin or not sys.stdin.isatty():
                        logging.info(
                            f"Non-interactive mode: skipping delete prompt for empty collection {target_coll_key}."
                        )
                        return []
                    while True:
                        confirm_delete = input(
                            f"The collection '{coll_display_name}' (Key: {target_coll_key}) is empty. Delete it? (yes/no): ").lower().strip()
                        if confirm_delete == 'yes':
                            logging.info(f"User confirmed deletion of empty collection: {target_coll_key}")
                            try:
                                current_collection_data = self.zot.collection(target_coll_key)
                                if current_collection_data:
                                    logging.warning(
                                        f"Attempting delete: {target_coll_key} V:{current_collection_data['version']}")
                                    self.zot.delete_collection(current_collection_data)
                                    logging.info(f"Deleted empty collection: {target_coll_key}")
                                    print(f"Empty collection '{coll_display_name}' deleted.")
                                    return []
                                else:
                                    logging.error(f"Could not get current data for {target_coll_key}");
                                    print(
                                        "Error: cannot delete.")
                            except Exception as e:
                                logging.error(f"Failed delete {target_coll_key}: {e}", exc_info=True);
                                print(
                                    f"Error deleting: {e}")
                            break
                        elif confirm_delete == 'no':
                            logging.info(f"User kept empty collection: {target_coll_key}");
                            print(
                                "Keeping empty collection.");
                            break
                        else:
                            print("Invalid input.");
                    print("-" * 30)

            except Exception as e:
                # Handle errors during item fetching for the specific collection
                logging.error(f"Error fetching items using collection_items for {target_coll_key}: {e}", exc_info=True)
                print(f"An error occurred fetching items for {collection_name}: {e}")
                return []

        else:
            # Fetch the entire library (logic remains the same)
            logging.info("Fetching ALL items (handling pagination) from the entire library.")
            try:
                all_items_from_api = self.zot.everything(self.zot.items())
                logging.info(f"API returned {len(all_items_from_api)} total items/entries from the library.")
            except Exception as e:
                logging.error(f"An unexpected error occurred fetching all library items: {e}", exc_info=True)
                print(f"An unexpected error occurred fetching all items: {e}")
                return []

        # 5) Filter out undesired item types (logic remains the same)
        undesired_types = {'note', 'attachment', 'annotation'}
        filtered_items = []
        logging.debug(f"Filtering {len(all_items_from_api)} items fetched from API. Excluding types: {undesired_types}")
        for item in all_items_from_api:
            item_data = item.get('data', {})
            item_type = item_data.get('itemType')
            item_key_filter = item.get('key', 'N/A')
            if item_type not in undesired_types:
                filtered_items.append(item)
            else:
                logging.debug(f"  - Filtering out Key={item_key_filter}, Type='{item_type}'")

        logging.info(
            f"API returned {len(all_items_from_api)} items, filtered down to {len(filtered_items)} relevant items for '{cache_key}'.")

        # 6) Update cache if enabled (logic remains the same)


        cache_data[cache_key] = filtered_items

        # os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        dir_path = os.path.dirname(cache_path)
        if dir_path:
            os.makedirs(dir_path, exist_ok=True)

        # with open(cache_path, 'w', encoding='utf-8') as f:
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(cache_data, f, ensure_ascii=False, indent=2)
            logging.info(f"Cached {len(filtered_items)} items under '{cache_key}' → {cache_path}")

        sorted_items = sorted(filtered_items, key=lambda item: item.get('key', ''))
        return sorted_items

    def add_items_to_collection(self, collection_key, items_keys,tag=None):
        if isinstance(items_keys, str):
            latest_item = self.zot.item(items_keys)
            add = self.zot.addto_collection(collection=collection_key, payload=latest_item)
            if tag:

                item = self.zot.item(items_keys)
                if isinstance(tag,str):
                    self.zot.add_tags(item, tag)
                if isinstance(tag,list):
                    self.zot.add_tags(item, *tag)


        else:
            for item_key in items_keys:
                latest_item = self.zot.item(item_key)

                add = self.zot.addto_collection(collection=collection_key, payload=latest_item)
                if tag:
                    item = self.zot.item(item_key)
                    self.zot.add_tags(item, tag)

                time.sleep(1)

    def remove_items_from_collection(self, collection_key, items_keys,tag=None):
        """
        Removes one or more items (specified by key) from a Zotero collection.

        Uses self.zot.item() to fetch the item data dictionary, then calls
        self.zot.deletefrom_collection() for each item, as required by the
        deletefrom_collection method signature.

        Args:
            collection_key (str): The key of the collection from which to remove items.
            items_keys (str or list/tuple): A single item key (str) or an iterable
                                             (list, tuple) of item keys to remove.
        """
        keys_to_process = []
        if isinstance(items_keys, str):
            keys_to_process.append(items_keys)
        elif isinstance(items_keys, (list, tuple)):
            keys_to_process.extend(items_keys)
        else:
            print(f"Error: items_keys must be a string or a list/tuple, received {type(items_keys)}")
            # Consider raising an error: raise TypeError("items_keys must be str or list/tuple")
            return

        if not keys_to_process:
            print("No valid item keys provided for removal.")
            return

        results = {}  # Dictionary to store results {item_key: success_boolean}

        for item_key in keys_to_process:
            try:
                # Step 1: Fetch the item data dictionary using the item key
                # This is necessary because deletefrom_collection requires the item dict, not just the key.
                print(f"Fetching item data for key: {item_key}...")
                item_data = self.zot.item(item_key)

                # Check if item data was retrieved successfully
                if not item_data:
                    print(f"Warning: Could not fetch item data for key {item_key}. Skipping removal.")
                    results[item_key] = False
                    continue  # Skip to the next item key

                # Step 2: Call deletefrom_collection with the collection key and the fetched item data dict
                print(f"Attempting to remove item {item_key} from collection {collection_key}...")
                # According to docs, deletefrom_collection returns a boolean
                success = self.zot.deletefrom_collection(collection=collection_key, payload=item_data)
                results[item_key] = success  # Store the result

                if success:
                    print(f"Successfully removed item {item_key} from collection {collection_key}.")
                    if tag:

                        item = self.zot.item(items_keys)
                        if isinstance(tag, str):
                            self.zot.add_tags(item, tag)
                        if isinstance(tag, list):
                            self.zot.add_tags(item, *tag)
                else:
                    # API returning False could mean item wasn't in the collection, or another non-exception failure.
                    print(f"Failed to remove item {item_key} from collection {collection_key} (API returned False).")


            except Exception as e:
                # Catch potential errors during item fetching or deletion API calls
                print(f"An error occurred while processing item {item_key} for collection {collection_key}: {e}")
                results[item_key] = False  # Record failure
                # Optional: Add sleep here too in case the error was rate-limiting related
                if len(keys_to_process) > 1:
                    print("Waiting for 3 seconds after error...")
                    time.sleep(1)

        print(f"Finished processing removal requests. Results: {results}")


    def create_item_with_attachment_from_scrapping(self,
                                                   ris_entries,
                                                   download_dir=r"C:\Users\luano\Downloads",collection_key=None):
        """
        Downloads via download_file(), then creates a Zotero item
        in the appropriate collection.
        """
        # opts = ChromeOptions()
        #
        # opts.add_argument("--headless=new")
        driver = uc.Chrome(
            # options=opts,
            # version_main=136
        )
        to_push = ris_entries
        total = len(to_push)
        for n, ris_entry in enumerate(
                tqdm(to_push, desc="Zotero push", unit="item"),
                start=1
        ):
            # 1) pick Zotero collection
            case_type = ris_entry.get("doc_type") or ris_entry.get("type_") or "default"
            case_key = self.find_or_create_subcollection(subcoll_name=case_type,parent_key=collection_key)
            if not collection_key:
                print(f"No collection for case_type='{case_type}', skipping.")
                return

            # 2) prepare download path
            os.makedirs(download_dir, exist_ok=True)
            pdf_url = ris_entry.get("pdf_url")

            filename = ris_entry.get("url").split("/")[-1]
            if not pdf_url:
                print("No pdf_url provided; skipping.")
                return

            # filename = os.path.basename(urlparse(pdf_url).path)
            save_path = os.path.join(download_dir, filename)
            profiles = list_chrome_profiles(
                r"C:\Users\luano\AppData\Local\Google\Chrome\User Data"
            )
            print(profiles)
            # Pick your default or last-used profile
            # 3) download & bypass CF

            if not os.path.exists(save_path):
                print(f"Downloading {pdf_url} → {save_path}")
                # options = uc.ChromeOptions()
                #
                # options.add_argument(fr"--user-data-dir= C:\Users\luano\AppData\Local\Google\Chrome\User Data")
                #
                # options.add_argument(f"--profile-directory= Profile 1")

                driver.get(pdf_url)
                # --- 3. Wait for Page/PDF to Load (Crucial Step) ---
                # Wait until the body is present, indicating HTML page loaded OR
                # the PDF viewer might be embedded. This is a basic check.
                print("Waiting for page body/content to be present...")
                try:
                    WebDriverWait(driver, 300).until(
                        EC.presence_of_element_located((By.TAG_NAME, "body"))
                    )
                    print("Body tag found. Assuming page/PDF viewer loaded.")
                    # Check for common error indicators if possible
                    page_title = driver.title.lower()
                    page_source_sample = driver.page_source[:500].lower()
                    if "403 forbidden" in page_title or "403 forbidden" in page_source_sample:
                        print("ERROR: Detected '403 Forbidden' on the page. Cannot proceed with save.")
                        raise RuntimeError("Page loaded with 403 Forbidden error.")
                    if "cloudflare" in page_title and "verification" in page_source_sample:
                        print("ERROR: Still on a Cloudflare page after wait. Cannot proceed.")
                        raise RuntimeError("Stuck on Cloudflare page.")

                except TimeoutException:
                    print("Warning: Timed out waiting for body tag. Page might not have loaded correctly.")
                    # Attempt save anyway, but it will likely fail
                except RuntimeError as e:
                    # Re-raise specific runtime errors detected above
                    raise e


                saved = download_file(
                    url=pdf_url,
                    save_path=save_path,
                    driver=driver

                )
                if not saved:
                    print("Download failed; aborting.")
                    return
            else:
                print(f"Already have {filename}; skipping download.")

            # 4) build Zotero item
            _, ext = os.path.splitext(filename)
            if ext.lower() not in [".pdf", ".doc", ".docx"]:
                print(f"Unsupported ext '{ext}'; skipping attachment.")
                return

            zot_type = ris_entry.get("type", "document")
            item = self.zot.item_template(zot_type)
            item["collections"] = [case_key]

            # map metadata
            if zot_type == "case":
                item["caseName"] = ris_entry.get("case_name", filename)
                item["dateDecided"] = ris_entry.get("date")
                item["court"] = ris_entry.get("loc")
                item["url"] = ris_entry.get("case_url")
            else:
                item["title"] = ris_entry.get("title", filename)
                item["date"] = ris_entry.get("date")
                item["place"] = ris_entry.get("loc")
                item["url"] = ris_entry.get("url")

            # tags
            tags = [{"tag": zot_type}]
            if dt := ris_entry.get("doc_type"):
                tags.append({"tag": dt})
            item["tags"] = tags

            # 5) upload to Zotero
            try:
                resp = self.zot.create_items([item])
                if "successful" in resp and "0" in resp["successful"]:
                    zid = resp["successful"]["0"]["key"]
                    self.zot.attachment_simple([save_path], parentid=zid)
                    print(f"✔ Uploaded '{filename}' to collection {collection_key}")
                else:
                    print("❌ Zotero create_items failed:", resp)
            except zotero_errors.HTTPError as e:
                print("Zotero HTTPError:", e)
            except Exception as e:
                print("Unexpected error:", e)
                # compute how many remain
            missing = total - n
            # log remaining + last‐processed ID
            tqdm.write(f"Remaining: {missing}  |  Last: {ris_entry['case_id']}")

    def ris_from_report(self,report: dict) -> str:
        """
        Convert the `report` record from APTnotes into an RIS string.
        """
        # Minimal set of RIS tags – expand as needed
        ris_lines = [
            "TY  - RPRT",
            f"TI  - {report['Title']}",
            f"DA  - {report['Date'].replace('/', '-')}",  # 2024-07-24
            f"PY  - {report['Year']}",
            f"UR  - {report['Link']}",
            f"N1  - SHA1: {report['SHA-1']}",
            f"KW  - {report['Source']}",  # tag it with the feed name
            "ER  -"
        ]
        return "\n".join(ris_lines)


    def create_zotero_summary_collections(self,

            parent_collection_name: str,
            tags: List[str] = ["pure_technical", "non_english"],
            keyword: str = "attribution",
            target_collection: Optional[str] = "raw_total"
    ) -> Union[List[Dict[str, Dict[str, str]]], Dict[str, Dict[str, str]]]:
        """
        • parent_collection_name: name of the top‑level collection
        • tags: extra suffixes to generate
        • keyword: last suffix
        • target_collection: if provided, only emit that one payload
        Returns either a single payload dict (if target_collection) or
        a list of payload dicts mapping each suffix → {collection_name, collection_key}.
        """
        tags = [tag.replace(" ","_") for tag in tags]
        # 1) base suffixes
        collection_suffixes = ["raw_total", "total_screened", "excluded",
                               "included", "non_available", "max_page", "min_page","errors"]
        # 2) extend with tags and keyword
        collection_suffixes.extend(tags)
        collection_suffixes.append(keyword)

        # 3) find or create top & summary collections
        parent_key = self.find_or_create_top_collection(parent_collection_name)
        summary_name = f"5.{parent_collection_name}_summary"
        summary_key = self.find_or_create_subcollection(summary_name, parent_key)

        # 4) build payloads
        payloads = []
        for idx, suffix in enumerate(collection_suffixes):
            print(f"creating collection {suffix} inside {summary_name}")
            alias = _index_to_alias(idx)
            coll_name = f"{alias}.{parent_collection_name}_sum_{suffix}"
            coll_key = self.find_or_create_subcollection(coll_name, summary_key)
            entry = {
                suffix: {
                    "collection_name": coll_name,
                    "collection_key": coll_key
                }
            }
            if target_collection:
                if suffix == target_collection:
                    return entry
            else:
                payloads.append(entry)

        return payloads

    def create_zotero_PDFs_processing(
            self,
            parent_collection_name: str,
            target_collection: Optional[str] = None
    ) -> Union[List[Dict[str, Dict[str, str]]], Dict[str, Dict[str, str]]]:
        """
        • parent_collection_name: name of the top‑level collection
        • target_collection: if provided, only emit that one payload
        Returns either a single payload dict (if target_collection) or
        a list of payload dicts mapping each suffix → {collection_name, collection_key}.
        """
        # 1) find or create top & PDF‑processing collection
        parent_key = self.find_or_create_top_collection(parent_collection_name)
        pdf_coll_name = f"3.{parent_collection_name}_pdf_processing"
        pdf_coll_key = self.find_or_create_subcollection(pdf_coll_name, parent_key)

        # 2) base suffixes
        collection_suffixes = ["missing", "errors", "domains"]
        # 3) subsections under errors & domains only
        sub_collections = [
            "proq", "hein", "ieee", "camb", "spring", "rand", "commons",
            "ssrn", "sage", "elga", "tand", "brill", "oup", "taylor",
            "jstor", "torrossa", "direct", "other"
        ]

        payloads = []
        for idx, suffix in enumerate(collection_suffixes):
            alias = _index_to_alias(idx)
            coll_name = f"{alias}.{parent_collection_name}_pdf_{suffix}"
            coll_key = self.find_or_create_subcollection(coll_name, pdf_coll_key)

            entry = {
                suffix: {
                    "collection_name": coll_name,
                    "collection_key": coll_key
                }
            }

            # only errors and domains get subsections
            if suffix in ("errors", "domains"):
                for jdx, sub in enumerate(sub_collections):
                    sub_alias = _index_to_alias(jdx)
                    sub_coll_name = f"{sub_alias}.{parent_collection_name}_pdf_{suffix}_{sub}"
                    sub_coll_key = self.find_or_create_subcollection(sub_coll_name, coll_key)
                    entry[sub] = {
                        "collection_name": sub_coll_name,
                        "collection_key": sub_coll_key
                    }

            if target_collection:
                if suffix == target_collection:
                    return entry
            else:
                payloads.append(entry)

        return payloads

    def create_add_collection (self,
        parent_collection_name: str,
        screener: str,
        tags: List[str] = ["pure_technical", "non_english"],
        target_suffix: Optional[str] = None
    ) -> Union[Dict[str, Dict[str, str]], List[Dict[str, Dict[str, str]]]]:
        """
        Creates under `parent_collection_name`:
          └── 7.{parent}_add
               └── {parent}_add_{screener}
                    ├── total
                    ├── excluded
                    │    ├── excluded_original
                    │    ├── excluded_temporary
                    │    └── excluded_final
                    ├── included
                    │    ├── included_original
                    │    ├── included_temporary
                    │    └── included_final
                    ├── non_available
                    ├── max_page
                    ├── min_page
                    ├── maybe
                    └── (if screener=="title": tags...)
        """
        # 1) find/create parent
        parent_key = self.find_or_create_top_collection(parent_collection_name)
        # 2) create the "add" node under parent
        add_name = f"7.{parent_collection_name}_add"
        add_key  = self.find_or_create_subcollection(add_name, parent_key)
        # 3) create the screener node under add
        screener_name = f"{parent_collection_name}_add_{screener}"
        screener_key  = self.find_or_create_subcollection(screener_name, add_key)
        # 4) suffix list
        suffixes = ["total", "excluded", "included", "non_available", "max_page", "min_page", "maybe"]
        if screener == "title":
            suffixes.extend(tags)
        elif screener == "abs":
            suffixes.append("add")

        # 5) for included/excluded, also create subsections
        subsections = ["original", "temporary", "final"]

        payloads: List[Dict[str, Dict[str, str]]] = []
        for suffix in suffixes:
            # name under screener
            coll_name = f"{parent_collection_name}_add_{screener}_{suffix}"
            coll_key  = self.find_or_create_subcollection(coll_name, screener_key)

            entry: Dict[str, Dict[str, str]] = {}
            if suffix in ("included", "excluded"):
                # main entry
                entry[suffix] = {"collection_name": coll_name, "collection_key": coll_key}
                # create its subsections
                for sub in subsections:
                    sub_name = f"{parent_collection_name}_add_{screener}_{suffix}_{sub}"
                    sub_key  = self.find_or_create_subcollection(sub_name, coll_key)
                    entry[f"{suffix}_{sub}"] = {
                        "collection_name": sub_name,
                        "collection_key": sub_key
                    }
            else:
                entry[suffix] = {"collection_name": coll_name, "collection_key": coll_key}

            if target_suffix:
                if suffix == target_suffix:
                    return entry
            else:
                payloads.append(entry)

        return payloads

    def create_zotero_screener_collections(
            self,
            parent_collection_name: str,
            screener: str,
            tags: List[str] = ["pure_technical", "non_english"],
            target_collection: Optional[str] =None
    ) -> Union[List[Dict[str, Dict[str, str]]], Dict[str, Dict[str, str]]]:
        """
        • parent_collection_name: name of the top‑level collection
        • screener: either "title" or another screening step
        • tags: extra suffixes to generate
        • target_collection: if provided, only emit that one payload
        Returns either a single payload dict (if target_collection) or
        a list of payload dicts mapping each suffix → {collection_name, collection_key}.
        """
        # 1) base suffixes
        collection_suffixes = ["total", "excluded", "included", "non_available", "max_page", "min_page", "maybe"]
        # 2) extend with tags
        if screener =="title":
            collection_suffixes.extend(tags)
        if screener == "abs":
            collection_suffixes.append("add")



        index_section_options= {"title":"2.","abs":"4.","add":"7"}
        index_section = index_section_options[screener]

        # 3) find or create top & screener collections
        parent_key = self.find_or_create_top_collection(parent_collection_name)
        screener_name = f"{index_section}{parent_collection_name}_{screener}"
        screener_key = self.find_or_create_subcollection(screener_name, parent_key)


        # subsections for included/excluded
        subsections = ["original", "temporary", "final"]
        entry=None
        # 4) build payloads
        payloads = []
        for idx, suffix in enumerate(collection_suffixes):
            if suffix in ["non_available", "max_page", "min_page"] and screener_key in ["abs","add"]:
                idx -=1
                continue

            alias = _index_to_alias(idx)
            coll_name = f"{alias}.{parent_collection_name}_{screener}_{suffix}"
            coll_key = self.find_or_create_subcollection(coll_name, screener_key)

            if suffix in ("included", "excluded"):
                entry = {
                    suffix: {
                        "collection_name": coll_name,
                        "collection_key": coll_key
                    }
                }
                for suffix_sub in subsections:
                    sub_coll_name = f"{alias}.{parent_collection_name}_{screener}_{suffix}_{suffix_sub}"
                    sub_coll_key = self.find_or_create_subcollection(sub_coll_name, coll_key)
                    entry[f"{suffix}_{suffix_sub}"] = {
                        "collection_name": sub_coll_name,
                        "collection_key": sub_coll_key
                    }
            if suffix not in ("included", "excluded"):
                entry = {
                    suffix: {
                        "collection_name": coll_name,
                        "collection_key": coll_key
                    }
                }

            if target_collection:
                if suffix == target_collection:
                    return entry
            else:
                payloads.append(entry)

        return payloads
    def preprocessing_items(self, collection_name: str, cache: bool = True):


        items = self.get_all_items(collection_name=collection_name, cache=cache) or []

        # Duplicates

        self.getting_duplicates(collection_name=collection_name,items=items)

        # Page size
        ################################################################################
        self.filter_by_page_size(collection_name=collection_name,items=items,min_pages=10,max_pages=300)

    ################################################################################

    def filter_by_page_size( self,
            collection_name: str,
                             items,
            *,
            min_pages: int = 10,
            max_pages: int = 300,
            tag_short: str | None = None,
            tag_long: str | None = None,
            also_tag_count: bool = True,
    ) -> dict:
        """
        Scan all items in `collection_name`, open their PDFs with PyMuPDF (fitz),
        count pages, and tag items as short or long when outside thresholds.

        Tags:
          - tag_short (default: f"pages:short(<{min_pages})")
          - tag_long  (default: f"pages:long(>{max_pages})")
          - optionally also "pages:{N}" with the exact page count when also_tag_count=True

        Returns a small summary dict with counters.
        """
        from pathlib import Path
        from tqdm import tqdm
        import fitz  # PyMuPDF

        short_tag = tag_short or f"pages:short(<{min_pages})"
        long_tag = tag_long or f"pages:long(>{max_pages})"
        col_key = self.find_or_create_top_collection(collection_name)
        min_pages_key = self.find_or_create_subcollection(f"min_pages_{collection_name}", parent_key=col_key)
        max_pages_key = self.find_or_create_subcollection(f"max_pages_{collection_name}", parent_key=col_key)

        summary = {"checked": 0, "short": 0, "long": 0, "no_pdf": 0, "tag_updates": 0}

        for item in tqdm(items, desc="Checking page counts", unit="item"):
            data = item.get("data", {})
            item_key = data.get("key")
            title = data.get("title", "")

            pdf_path = self.get_pdf_path_for_item(item_key)
            if not pdf_path or not Path(pdf_path).is_file():
                summary["no_pdf"] += 1
                continue

            try:
                with fitz.open(pdf_path) as doc:
                    pages = doc.page_count
            except Exception as e:
                print(f"[filter_by_page_size] Failed to open PDF for {item_key} — {title}: {e}")
                continue

            summary["checked"] += 1

            tags_to_add = []
            if pages < min_pages:
                self.add_items_to_collection(collection_key=min_pages_key, items_keys=item_key, tag=short_tag)

                summary["short"] += 1
            elif pages > max_pages:
                self.add_items_to_collection(collection_key=max_pages_key, items_keys=item_key, tag=long_tag)

                summary["long"] += 1

            if also_tag_count:
                tags_to_add.append({"tag": f"pages:{pages}"})

        return summary
    def getting_duplicates(self, collection_name,items) -> dict:
        """
        Identify duplicate items in `collection_name` by normalised title, with a secondary
        discriminator of 4-digit year when available. For each duplicate group, keep ONE item
        in the original collection and move the rest to a '<collection_name>_duplicates'
        subcollection, tagging moved items with '0_1_llm:duplicates'.

        Steps:
          1) Find/create top collection and a '<name>_duplicates' subcollection.
          2) Load all items; group by (norm_title, year_or_None).
          3) For each group with size >= 2:
               - Select ONE keeper (stable sort).
               - Mark the others as duplicates_to_move.
          4) Add duplicates_to_move to the duplicates subcollection with tag.
          5) Remove duplicates_to_move from the original collection.

        Returns:
          {
            "parent_collection_key": str,
            "duplicates_collection_key": str,
            "groups_total": int,
            "groups_with_duplicates": int,
            "moved_count": int,
            "kept_count": int,
            "detail": [
              {
                "norm_title": str,
                "year": str|None,
                "keeper": str,              # item key kept in original
                "moved": [str, ...]         # item keys moved & tagged
              }, ...
            ]
          }
        """
        import re
        from datetime import datetime

        TAG = "0_1_llm:duplicates"

        def _extract_year(val) -> str | None:
            """
            Try to pull a 4-digit year from common date fields.
            Accepts a full date string or int-like year.
            """
            if not val:
                return None
            s = str(val)
            m = re.search(r"\b(19|20)\d{2}\b", s)
            return m.group(0) if m else None

        def _stable_item_sort_key(item: dict):
            """
            Produce a stable ordering to choose one 'keeper'.
            Prefer earliest dateAdded; fallback to key.
            """
            d = item.get("data", {})
            date_added = d.get("dateAdded") or ""
            # Normalise to sortable tuple (year, full string) for stability
            try:
                dt = datetime.fromisoformat(date_added.replace("Z", "+00:00"))
                ts = (dt.year, date_added)
            except Exception:
                ts = (9999, date_added or "")
            key = item.get("key") or d.get("key") or ""
            return (ts, key)

        # 1) Ensure collections
        col_key = self.find_or_create_top_collection(collection_name)
        duplicates_key = self.find_or_create_subcollection(
            f"{collection_name}_duplicates",
            parent_key=col_key
        )

        # 2) Fetch items

        # 3) Group by (norm_title, year?)
        groups: dict[tuple[str, str | None], list[dict]] = {}
        for n,it in enumerate(items):

            print(f"processing {n+1}/{len(items)}")
            d = it.get("data", {}) or {}
            title = d.get("title") or ""
            ntitle = _norm_title(title)
            if not ntitle:
                continue
            # Prefer explicit 'year' field; fall back to 'date'
            year = _extract_year(d.get("year") or d.get("date"))
            k = (ntitle, year)
            groups.setdefault(k, []).append(it)

        # 4) For each group, pick keeper and mark the rest for move
        to_move_keys_set = set()
        kept_keys = []
        detail = []
        groups_with_dups = 0

        for (norm_title, year), bucket in groups.items():
            if len(bucket) < 2:
                continue
            groups_with_dups += 1
            bucket_sorted = sorted(bucket, key=_stable_item_sort_key)
            keeper = bucket_sorted[0]
            keeper_key = keeper.get("key") or keeper.get("data", {}).get("key")
            moved_keys = []

            for it in bucket_sorted[1:]:
                k = it.get("key") or it.get("data", {}).get("key")
                if not k:
                    continue
                if k not in to_move_keys_set:
                    to_move_keys_set.add(k)
                    moved_keys.append(k)

            if keeper_key:
                kept_keys.append(keeper_key)

            detail.append({
                "norm_title": norm_title,
                "year": year,
                "keeper": keeper_key,
                "moved": moved_keys
            })

        duplicates_list_keys = sorted(to_move_keys_set)

        # 5) Apply moves: add to dup subcollection + tag, then remove from original
        if duplicates_list_keys:
            self.add_items_to_collection(
                collection_key=duplicates_key,
                items_keys=duplicates_list_keys,
                tag=TAG
            )
            self.remove_items_from_collection(
                collection_key=col_key,
                items_keys=duplicates_list_keys,
            )

        return {
            "parent_collection_key": col_key,
            "duplicates_collection_key": duplicates_key,
            "groups_total": len(groups),
            "groups_with_duplicates": groups_with_dups,
            "moved_count": len(duplicates_list_keys),
            "kept_count": len(kept_keys),
            "detail": detail,
        }

    def filter_coll_a_from_coll_b(self,collection_total,collection_substraction,target_collection):
        """
        collection_total - substraction_collection = target_collection
        """
        coll_target_key = self.find_or_create_top_collection(target_collection)

        items_total = [
            item["key"]

            for item in self.get_all_items(
                collection_name=collection_total,

            )
        ]
        items_substraction = [
            item["key"]

            for item in self.get_all_items(
                collection_name=collection_substraction,

            )
        ]
        items_target = [ key for key in items_total if key not in items_substraction]
        self.add_items_to_collection(coll_target_key,items_target)

    def compare_collections(self, coll_a, coll_b, cache=False, verbose=True,per_item_key=False):
        comparison_collection_name = f"{coll_a}x_{coll_b}"
        col_key = self.find_or_create_top_collection(f"A_comparison_{comparison_collection_name}")
        duplicates_key = self.find_or_create_subcollection(f"{comparison_collection_name}_duplicates",
                                                           parent_key=col_key)
        coll_a_unique_key = self.find_or_create_subcollection(f"{comparison_collection_name}_unique_to_{coll_a}",
                                                              parent_key=col_key)
        coll_b_unique_key = self.find_or_create_subcollection(f"{comparison_collection_name}_unique_to_{coll_b}",
                                                              parent_key=col_key)
        coll_a_not_unique_key = self.find_or_create_subcollection(
            f"{comparison_collection_name}_not_unique_to_{coll_a}", parent_key=col_key)
        coll_b_not_unique_key = self.find_or_create_subcollection(
            f"{comparison_collection_name}_not_unique_to_{coll_b}", parent_key=col_key)

        # 1. Pull items once per collection
        items_a = self.get_all_items(collection_name=coll_a, cache=cache)
        items_b = self.get_all_items(collection_name=coll_b, cache=cache)

        map_a_ty = {}
        map_a_key = {}
        for it in items_a:
            norm_title = _norm_title(it['data'].get('title', ''))
            year = (it['data'].get('date', '') or '')[:4]
            ty = f"{norm_title}|{year}"
            map_a_ty.setdefault(ty, []).append(it)
            map_a_key.setdefault(it["key"], []).append(it)


        map_b_ty = {}
        map_b_key = {}
        set_a = None
        set_b = None
        for it in items_b:
            norm_title = _norm_title(it['data'].get('title', ''))
            year = (it['data'].get('date', '') or '')[:4]
            ty = f"{norm_title}|{year}"
            map_b_ty.setdefault(ty, []).append(it)
            map_b_key.setdefault(it["key"], []).append(it)
        if per_item_key:
            set_a = set(map_a_key)
            set_b = set(map_b_key)
        else:
            set_a = set(map_a_ty)
            set_b = set(map_b_ty)

        both = set_a & set_b
        only_a = set_a - set_b
        only_b = set_b - set_a
        not_uni_a = both
        not_uni_b = both

        def _list(keys, mapping):
            if per_item_key:
                return [
                    {'title': it['data'].get('title', '(no title)'), 'item_key': it['key']}
                    for ty in sorted(keys)
                    for it in mapping[it['key']]
                ]
            return [
                {'title': it['data'].get('title', '(no title)'), 'item_key': it['key']}
                for ty in sorted(keys)
                for it in mapping[ty]
            ]

        summary = {
            'total_in_a': len(set_a),
            'total_in_b': len(set_b),
            'intersection': len(both),
            'unique_to_a': len(only_a),
            'unique_to_b': len(only_b),
            'not_unique_to_a': len(not_uni_a),
            'not_unique_to_b': len(not_uni_b),
              'items_in_both': _list(both, map_a_ty),
            'items_only_a': _list(only_a, map_a_ty),
            'items_only_b': _list(only_b, map_b_ty),
            'items_not_unique_to_a': _list(not_uni_a, map_a_ty),
            'items_not_unique_to_b': _list(not_uni_b, map_b_ty),
        }
        # 2. Populate your subcollections exactly as before, plus the two “not unique” ones
        self.add_items_to_collection(duplicates_key, [it['item_key'] for it in summary['items_in_both']])
        self.add_items_to_collection(coll_a_unique_key, [it['item_key'] for it in summary['items_only_a']])
        self.add_items_to_collection(coll_b_unique_key, [it['item_key'] for it in summary['items_only_b']])
        self.add_items_to_collection(coll_a_not_unique_key, [it['item_key'] for it in summary['items_not_unique_to_a']])
        self.add_items_to_collection(coll_b_not_unique_key, [it['item_key'] for it in summary['items_not_unique_to_b']])

        # 3. Verbose report showing all four perspectives
        if verbose:
            print(f"\n↦  Comparison: “{coll_a}” vs “{coll_b}”")
            print(f"    • items in A           : {summary['total_in_a']}")
            print(f"    • items in B           : {summary['total_in_b']}")
            print(f"    • in both (intersection): {summary['intersection']}")
            print(f"    • only in A (A \\ B)    : {summary['unique_to_a']}")
            print(f"    • only in B (B \\ A)    : {summary['unique_to_b']}")
            print(f"    • A items in B         : {summary['not_unique_to_a']}")
            print(f"    • B items in A         : {summary['not_unique_to_b']}\n")

            def _dump(label, items):
                print(f"  {label} [{len(items)}]")
                for i, rec in enumerate(items, 1):
                    print(f"    {i:>3}. {rec['title'][:70]} — {rec['item_key']}")
                if not items:
                    print("      — none —")

            _dump("∩ Intersection", summary['items_in_both'])
            _dump(f"⊂ Unique to {coll_a}", summary['items_only_a'])
            _dump(f"⊂ Unique to {coll_b}", summary['items_only_b'])
            _dump(f"Δ A in B (not unique to A)", summary['items_not_unique_to_a'])
            _dump(f"Δ B in A (not unique to B)", summary['items_not_unique_to_b'])

        return summary

    #  ──────────────────────────────────────────────────────────────────────────────
#  put this **inside** your Zotero-wrapper class
#  ──────────────────────────────────────────────────────────────────────────────
    def getting_url_direct(self,collection_name):
        items= self.get_all_items(collection_name=collection_name)
        for item in items:
            key = item["key"]
            data = item["data"]
            title = data.get("title", "")
            url = data.get("url", "")
            doi = data.get("DOI") or data.get("doi")
            year = data.get("date") or data.get("year")
            author = (data.get("creators") or [{}])[0].get("lastName")

            url = fetch_pdf_link(
                model="o3",
                title=f"title={title}\nyear={year}\nauthor={author}\nnote:search on:digital commons,academic.oup,elga, sage,tand/taylor,SSNR, jstor, cambridge core, brill"
            )

            if not url:
                return None
            item = self.zot.item(key)
            self.update_zotero_item_feature(
                updates={"url": url},
                item=item,
                append=False
            )
            print("path:", url)
        return True

    def moving_items_from_collection(self,old_collection_key,new_collection_key, items_keys,tag=None):
        self.add_items_to_collection(collection_key=new_collection_key, items_keys=items_keys,tag=tag)
        self.remove_items_from_collection(collection_key=old_collection_key, items_keys=items_keys,tag=tag)

    def download_attach_pdf(
            self,
            collection_name: str,
            output_folder=r"C:\Users\luano\PycharmProjects\Back_end_assis\zotero_module",
            zot_attach_tag: str = "automatic_attach",
            direct_link=False,
            single=True,

        cache: bool =False
    ) -> None:
        """
        1.  Sort & cluster items in *collection_name*
        2.  Process buckets largest→smallest, printing a header for each
            • commons | rand | ssrn handled by download_direct_pdf
            • springer items stored in a “springer” sub-folder and moved in bulk to a
              dedicated sub-collection
        3.  Any still-missing items → LLM search → direct download
        """

        domain_list = ["proq", "hein", "ieee", "camb", "spring", "rand", "commons", "ssrn", "sage", "elga", "tand",
                       "brill", "oup", "taylor","jstor","torrossa","direct","other"]
        def _sanitize(name: str) -> str:
            return re.sub(r'[\\/*?:"<>|]', "_", name)

        def _has_pdf(item) -> bool:
            return any(
                att["data"]["itemType"] == "attachment"
                and att["data"].get("filename", "").lower().endswith(".pdf")
                for att in self.zot.children(item["key"])
            )
        top_collection_name= None
        pdf_missing_key=None
        top_coll_key =None
        pdf_missing_name = None
        current_collection_name = None
        err_collection_name =None

        def _derive_pdf_stem(name: str) -> str:
            n = name.strip()

            # If already top "<stem>_PDFs" → recover "<stem>_pdf"
            if n.endswith("_PDFs"):
                return n[:-5] + "_pdf"

            # Strip specific tails to reach "<stem>_pdf"
            patterns = [
                r"_pdf_missing$",
                r"_pdf_errors(?:_[A-Za-z0-9]+)?$",
                r"_pdf_domains(?:_[A-Za-z0-9]+)?$",
                r"_pdf_errors$",
                r"_pdf_domains$",
            ]
            for pat in patterns:
                if re.search(pat, n):
                    return re.sub(pat, "_pdf", n)

            # If it already contains "_pdf" somewhere, keep up to that token.
            m = re.search(r"(.*?_pdf)", n)
            if m:
                return m.group(1)

            # Raw base; create a new stem by appending "_pdf"
            return f"{n}_pdf"

        # Detect whether caller passed an errors collection; keep current for bucketing
        err_collection_name = collection_name if ("errors" in collection_name.lower()) else None

        # If caller passed a raw base, ensure scaffold exists
        # (idempotent: safe if already created)
        if not any(s in collection_name.lower() for s in ("_pdf_missing", "_pdf_errors", "_pdf_domains", "_pdfs")):
            try:
                new_data = self.create_zotero_PDFs_processing(parent_collection_name=collection_name)
            except Exception as _e:
                print("[WARN] create_zotero_PDFs_processing failed or already present:", _e)

        # Compute canonical names
        parent_collection_name = _derive_pdf_stem(collection_name)           # "<base>_pdf"
        top_collection_name    = parent_collection_name.replace("_pdf", "_PDFs")
        pdf_missing_name       = f"{parent_collection_name}_missing"         # "<base>_pdf_missing"

        # Materialise collections (top → missing → [optional errors current])
        top_coll_key = self.find_or_create_top_collection(top_collection_name)

        pdf_missing_key = self.find_or_create_subcollection(
            subcoll_name=pdf_missing_name,
            parent_key=top_coll_key
        )

        err_key = None
        if err_collection_name:
            err_key = self.find_or_create_subcollection(
                subcoll_name=err_collection_name,
                parent_key=pdf_missing_key
            )

        # Summary tree stays anchored on the same parent stem
        summary_collection_name = f"5.{parent_collection_name}_summary"
        summary_collection_key  = self.find_or_create_top_collection(summary_collection_name)
        summary_non_avaialble   = self.find_or_create_subcollection(
            f"{parent_collection_name}_non_available",
            parent_key=summary_collection_key
        )



        # ── 1) fetch & sort ──────────────────────────────────────────────────────

        items = sorted(
                self.get_all_items(collection_name, cache=cache),
                key=lambda it: it["data"].get("title", "").lower()
            )

        # cluster buckets
        already, need = [], []

        no_url, direct, hein, ieee, proq, camb, spring, rand, ssrn, commons,elga, sage, tand,bril,oup, jstor,taylor, torrossa, other = \
            ([] for _ in range(19))

        for it in items:
            if _has_pdf(it):
                already.append(it)
                continue
            url = (it["data"].get("url") or "").strip()
            if not url:
                no_url.append(it)
                continue
            need.append(it)
            L = url.lower()
            if L.endswith(".pdf"):
                direct.append(it)
            elif "heinonline.org" in L:
                hein.append(it)
            elif "ieeexplore.ieee.org" in L:
                ieee.append(it)
            elif "/docview/" in L or "proquest.com" in L:
                proq.append(it)
            elif "cambridge.org" in L:
                camb.append(it)
            elif "springer" in L:
                spring.append(it)
            elif "rand.org" in L:
                rand.append(it)
            elif "ssrn.com" in L:
                ssrn.append(it)
            elif "commons" in L:
                commons.append(it)
            elif "elga" in L:
                elga.append(it)
            elif "sage" in L:
                sage.append(it)
            elif "brill" in L:
                bril.append(it)
            elif "oup" in L:
                oup.append(it)
            elif "jstor" in L:
                jstor.append(it)
            elif "torrossa" in L:
                torrossa.append(it)
            elif "taylor" in L:
                taylor.append(it)


            elif "tand" in L or "https://doi.org/" in L:
                tand.append(it)
            else:
                other.append(it)

        # ── quick note on springer count ─────────────────────────────────────────
        print(f"[INFO] Detected {len(spring)} Springer items.")

        # ── 2) survey table ──────────────────────────────────────────────────────
        def row(label, bucket):
            return [label, len(bucket)]

        print(f"\n=== Collection survey — “{collection_name}” ===")
        print(tabulate([
            row("Total items", items),
            row("Have PDF already", already),
            row("Need PDF (have URL)", need),
            ["────────", 0],
            row("⋅ direct .pdf link", direct),
            row("⋅ HeinOnline", hein),
            row("⋅ IEEE Xplore", ieee),
            row("⋅ ProQuest", proq),
            row("⋅ Cambridge Core", camb),
            row("⋅ Springer", spring),
            row("⋅ RAND", rand),
            row("⋅ Digital Commons", commons),
            row("⋅ SSRN", ssrn),
            row("⋅ elga", elga),
            row("⋅ sage", sage),
            row("⋅ tand", tand),
            row("⋅ brill", bril),
            row("⋅ oup", oup),
            row("⋅ taylor", taylor),
            row("⋅ jstor", jstor),
            row("⋅ torrossa", torrossa),

            row("⋅ other / unknown", other),
            row("No URL at all", no_url),
        ], headers=["Bucket", "# items"], tablefmt="github"))

        if other:
            print("\nOther URLs (need a custom handler):")
            for it in other:
                print("  •", it["data"].get("url"))

        # ── 3) folders & browser ────────────────────────────────────────────────
        out_dir = Path(output_folder) / _sanitize(collection_name)
        out_dir.mkdir(parents=True, exist_ok=True)
        spring_dir = out_dir / "springer"
        spring_dir.mkdir(exist_ok=True)


        # ── 4) dispatcher ───────────────────────────────────────────────────────
        def _dispatch(it, direct_link=False):
            key = it["key"]
            data = it["data"]
            title = data.get("title", "")
            url = data.get("url", "")
            doi = data.get("DOI") or data.get("doi")
            year = data.get("date") or data.get("year")
            author = (data.get("creators") or [{}])[0].get("lastName")

            # LLM fallback request
            if direct_link:
                return None
                # url = fetch_pdf_link(
                #     model="gpt5-mini",
                #     title=f"title={title}\nyear={year}\nauthor={author}\nnote:search on:digital commons,academic.oup,elga, sage,tand/taylor,SSNR, jstor, cambridge core, brill"
                # )
                # if not url:
                #     return None
                # item=self.zot.item(key)
                # self.update_zotero_item_feature(
                #     updates={"url": url},
                #     item=item,
                #     append=False
                # )
                # print("path:", url)
            lower = url.lower()

            dest_dir = spring_dir if "springer" in lower else out_dir

            # commons | rand | ssrn

            try:
                if any(domain in lower for domain in ("rand.org","commons")):


                    return digital_commons_download_pdf(url, str(dest_dir))
                    # return download_direct_pdf(browser, url, save_dir=str(dest_dir))

                if "heinonline.org" in lower:
                    print("starting heinonline")
                    path = heinonline_download_pdf(
                        driver=browser,
                        page_url=url,
                        output_folder=str(dest_dir),
                        pdf_filename=key,
                    )
                    if "https" in str(path):
                        item = self.zot.item(key)
                        self.update_zotero_item_feature(
                            updates={"url": path},
                            item=item,
                            append=False
                        )
                        return None
                    if path:
                        return path
                    else:
                        return None

                if "tand" in lower or "doi.org" in lower:

                    return scrape_tand_article(url, out_dir=str(dest_dir), browser=browser)
                if "torrossa" in lower:
                    return "no available"

                if "jstor" in lower:
                    return download_jstor_pdf(page_url=url,out_dir=str(dest_dir),browser=browser)

                if "sage" in lower:
                    return scrape_sage_article_to_pdf(url, out_dir=str(dest_dir), browser=browser)

                if "ieeexplore.ieee.org" in lower:
                    return download_ieee_pdf(url, str(dest_dir), key, browser=browser)
                if "proquest.com" in lower or "/docview/" in url:
                    return download_proquest_pdf(url, str(dest_dir), key, browser=browser)
                if "cambridge" in lower:
                    print("cambridge working")
                    return download_cambridge_pdf(url=url,  browser=browser)

                if "academic.oup" in lower:
                    return scrape_oup_article(url=url, out_dir=str(dest_dir), browser=browser)
                if "elga" in lower:
                    return download_elgar_pdf(url=url, out_dir=str(dest_dir),  browser=browser)
                if "brill" in lower:
                    return download_brill(url=url, out_dir=str(dest_dir),  browser=browser,out_name=key)
                if "ssrn" in lower:
                    try:
                        path,meta = ssrn_downloader(url=url, save_dir=str(dest_dir), browser=browser)
                        meta_html = "".join(
                            f"<h4>{k.replace('_', ' ').title()}</h4>\n<p>{v}</p>\n"
                            for k, v in meta.items()
                            if v
                        )
                        snippet = f"""
                        <h3>SSRN Data</h3>
                        {meta_html}"""
                        first_time_sending =self.append_info_note_log(snippet=snippet, item_key=key)
                        if first_time_sending:
                            item = self.zot.item(key)

                            self.update_zotero_item_feature(

                                    updates={
                                        "title": meta["title"],
                                        "date": meta["date"],

                                    },
                                    item=item,
                                    append=False
                                ),




                        return path
                    except Exception as e:
                        print("SSRN download failed:", e)
                        return None
            except Exception as e:
                print("error in dispatch: ",e)
                return None
                # if "commons" in lower:
            #     from scrapping.scraping_helpers import digital_commons_download_pdf
            #     print("Downloading from Digital Commons:", url)
            #     return digital_commons_download_pdf(url, str(dest_dir))

            # # direct-PDF links
            # if lower.endswith(".pdf"):
            #     return download_direct_pdf(browser, url, save_dir=str(dest_dir))
            if label =="other":
            # generic metadata downloader
                info = downloading_metadata(
                    browser=browser,
                    url=url, doi=doi, title=title, author=author, year=year,
                    save_dir=str(dest_dir), want_ris=False
                )
                meta_html = "".join(
                    f"<h4>{k.replace('_', ' ').title()}</h4>\n<p>{v}</p>\n"
                    for k, v in info["metadata"].items()
                    if v
                )
                snippet = f"""
                                   <h3>CrossRef</h3>
                                   {meta_html}"""
                if info["metadata"].get("title"):
                    first_time_sending = self.append_info_note_log(snippet=snippet, item_key=key)
                    if first_time_sending:
                        if info.get("pdf_path") and info["pdf_path"][1]:
                            item= self.zot.item(it["key"])
                            self.update_zotero_item_feature(
                                updates={"url": info["pdf_path"][0],"title": info["metadata"]["title"]},
                                item=item,
                                append=True
                            )

                        return info["pdf_path"][0] if info["pdf_path"] else None


            return None

        # ── 5) bucket processing (largest→smallest) ─────────────────────────────
        bucket_queue = [
            ("proq", proq),  # ensure ProQuest first if counts equal
            ("hein", hein),
            ("ieee", ieee),
            ("direct", direct),
            ("camb", camb),
            ("spring", spring),
            ("rand", rand),
            ("commons", commons),
            ("ssrn", ssrn),
            ("elga", elga),
            ("sage", sage),
            ("tand", tand),
            ("brill", bril),
            ("oup", oup),
            ("jstor", jstor),
            ("taylor", taylor),
            ("torrossa", torrossa),

            ("other", other),
        ]


        errs = {k: self.find_or_create_subcollection(subcoll_name=f"{pdf_missing_name}_{k}_errors",
                                                         parent_key=pdf_missing_key) for k in
                   domain_list}


        bucket_queue.sort(key=lambda tup: len(tup[1]), reverse=True)

        browser = initiate_browser()
        succeeded = set()
        for label, bucket in bucket_queue:
            summary_research_domains = self.find_or_create_subcollection(subcoll_name=f"{pdf_missing_name}_{label}",parent_key=pdf_missing_key)
            item_keys= [item["key"] for item in bucket]
            self.add_items_to_collection(collection_key =summary_research_domains,items_keys=item_keys)
            if label in ["other",
                            "proq",
                "taylor"
                         # "camb","hein"
                         ]:
                # skip these for now, handled in the generic "other" bucket
                continue
            if not bucket:
                continue
            print(f"\n--- Processing «{label}» bucket ({len(bucket)} items) ---")
            bucket.sort(key=lambda it: it["data"].get("title", "").lower())
            for it in bucket:
                key = it["key"]
                title = it["data"].get("title", "(no title)")
                # cached = (out_dir / key).with_suffix(".pdf")
                if self.get_pdf_path_for_item(key):

                    self.remove_items_from_collection(pdf_missing_key, key)
                    self.remove_items_from_collection(top_coll_key, key)
                    if err_key:
                        self.remove_items_from_collection(err_key, key)




                    continue
                    # print(f"  • {title} (cached)")
                    # self.attach_file_to_item(key, str(cached), tag_name=zot_attach_tag)
                    # succeeded.add(key)
                    # continue

                path = _dispatch(it,direct_link=direct_link)
                print("path: ",path)
                if isinstance(path, str):
                    if "available" in str(path):
                        available = self.find_or_create_subcollection(f"{top_collection_name}_not_available",
                                                                      parent_key=top_coll_key)
                        self.moving_items_from_collection(old_collection_key=pdf_missing_key,
                                                          new_collection_key=available,
                                                          items_keys=key)
                        self.add_items_to_collection(collection_key =available, items_keys=key)
                        self.add_items_to_collection(collection_key =summary_collection_key, items_keys=key)


                        self.remove_items_from_collection(top_coll_key,key)
                        if err_key:
                            self.remove_items_from_collection(err_key, key)

                        continue
                    try:

                        print(f"  ✓ {title}")
                        self.attach_file_to_item(key, path, tag_name=zot_attach_tag)
                        succeeded.add(key)

                        self.remove_items_from_collection(collection_key=top_coll_key, items_keys=key)
                        self.remove_items_from_collection(collection_key=pdf_missing_key, items_keys=key)
                        if err_key:
                            self.remove_items_from_collection(err_key, key)

                    except Exception as e:
                        # self.add_items_to_collection(collection_key=pdf_missing_key,items_keys=key)
                        print(f"  ✗ {title} (attach failed: {e})")

                if not path:
                    print(f"  ✗ {title} (missing)")
                    self.moving_items_from_collection(old_collection_key=pdf_missing_key,new_collection_key=errs[label], items_keys=key)
                    self.remove_items_from_collection(top_coll_key,key)
                    if err_key:
                        self.remove_items_from_collection(err_key, key)
                    continue



        # ── 6) LLM/direct fallback for remaining ────────────────────────────────
        remaining = [it for it in need if it["key"] not in succeeded]
        if remaining:
            print(f"\n--- LLM fallback: {len(remaining)} items ---")
        for it in remaining:

            path = _dispatch(it, direct_link=True)

            title = it["data"].get("title", "(no title)")
            if isinstance(path, str):
                self.attach_file_to_item(it["key"], path, tag_name=zot_attach_tag)
                succeeded.add(it["key"])
                self.remove_items_from_collection(pdf_missing_key, it["key"])
                self.remove_items_from_collection(top_coll_key, it["key"])
                if err_key:
                    self.remove_items_from_collection(err_key, key)

                print(f"  ✓ {title} (LLM)")
            else:
                print(f"  ✗ {title} (still missing)")

        # ── 7) final report ─────────────────────────────────────────────────────
        missing = [it for it in need if it["key"] not in succeeded]
        if missing:
            print("\n=== Still missing PDFs ===")
            print(tabulate([
                [it["data"].get("title", "—")[:70], it["data"].get("url", "")]
                for it in missing
            ], headers=["Title", "URL"], tablefmt="github"))
        else:
            print("\nAll resolvable PDFs have been downloaded and attached.")
    def filtering_collection_by_size_tags_keywords_tag(self,collection_name,screener,size=False,tags=[],min_page=8, max_page=100,keyword="attribution",tag=False):
        screen_collections_tree =None
        if screener =="add":
            screen_collections_tree =self.create_add_collection(parent_collection_name=collection_name,screener="title")
        else:
            screen_collections_tree= self.create_zotero_screener_collections(parent_collection_name=collection_name, screener=screener, tags=tags, target_collection=None)
        summary_collections_tree = self.create_zotero_summary_collections(parent_collection_name=collection_name, tags=tags, target_collection=None)
        included_name =  next(
    (entry["included"] for entry in screen_collections_tree if "included" in entry),
    None )["collection_name"]

        temp_name = next(
            (entry["included_temporary"] for entry in screen_collections_tree if "included_temporary" in entry),
            None)["collection_name"]
        items = self.get_all_items( temp_name,
                                    # cache=True
                                    )

        if size:
            self.filter_short_pdfs(min_page=min_page, max_page=max_page, items=items, screen_collections_tree=screen_collections_tree,summary_collections_tree=summary_collections_tree)

        if keyword:
            self.filter_missing_keyword(screen_collections_tree=screen_collections_tree, items=items, keyword=keyword,summary_collections_tree=summary_collections_tree)

        if tag:

            self.filter_by_tag(items=items, tags=tags, screen_collections_tree=screen_collections_tree,summary_collections_tree=summary_collections_tree)

    def filter_short_pdfs(
            self,
            items=None,
            screen_collections_tree=None,
            summary_collections_tree=None,
            default_collection_name=None,
            min_words: int = 3500,
            max_words: int = 24000,
    ):
        """
        Move every PDF with fewer than `min_page` pages or more than `max_page` pages
        into the appropriate Zotero collections (screen & summary), and record errors.
        If `cache` is True, load/save page counts from/to cache/page_count_cache.json.
        """
        inc_entry,temp_key, temp_name,screen_min_key,screen_max_key, screen_errors_key, summary_min_key,summary_max_key,summary_errors_key =[
            {} for _ in range(9)]
        if items is not None:
            # ── Unpack "included" (with subsections) ────────────────────────────────
            inc_entry = next((e for e in screen_collections_tree if "included" in e), {})

            temp_key = inc_entry.get("included_temporary", {}).get("collection_key")
            temp_name = inc_entry.get("included_temporary", {}).get("collection_name")

            # ── Unpack min/max/errors keys ───────────────────────────────────────────
            screen_min_key = next((e["min_page"]["collection_key"] for e in screen_collections_tree if "min_page" in e),
                                  None)
            screen_max_key = next((e["max_page"]["collection_key"] for e in screen_collections_tree if "max_page" in e),
                                  None)
            screen_errors_key = next((e["errors"]["collection_key"] for e in screen_collections_tree if "errors" in e),
                                     None)

            summary_min_key = next((e["min_page"]["collection_key"] for e in summary_collections_tree if "min_page" in e),
                                   None)
            summary_max_key = next((e["max_page"]["collection_key"] for e in summary_collections_tree if "max_page" in e),
                                   None)
            summary_errors_key = next((e["errors"]["collection_key"] for e in summary_collections_tree if "errors" in e),
                                      None)
        if not items and default_collection_name:
            items = self.get_all_items(collection_name=default_collection_name,cache=False)

        min_keys_items = []
        max_keys_items = []
        errors_keys_items = []

        # ── Scan each PDF ────────────────────────────────────────────────────────
        for item in tqdm(items, desc="Scanning PDFs", unit="item"):
            item_key = item["data"]["key"]
            title =item["data"]["title"]
            pdf_path = self.get_pdf_path_for_item(item_key)
            if not pdf_path or not Path(pdf_path).is_file():
                input(f"PDF path for {item_key}\ntitle:{title} not found; press Enter to continue…")
                continue
            page_count = 0
            try:
                page_count = process_pdf(pdf_path=pdf_path)["summary"]["flat_text"]["words"]
            except:
                page_count = process_pdf(pdf_path=pdf_path,cache=False)["summary"]["flat_text"]["words"]

            # # Append page count to note
            # snippet = f"\n<h3>Page Count</h3>\n<ul><li>{page_count}</li></ul>"
            # self.append_info_note_log(item_key=item_key, snippet=snippet)

            # Threshold checks
            if page_count < min_words:
                min_keys_items.append(item_key)
            elif page_count > max_words:
                max_keys_items.append(item_key)

        # ── Batch-move items ────────────────────────────────────────────────────
        if screen_collections_tree and summary_collections_tree:
            name= temp_name.replace("_included_temporary","").split("_")[-1]
            if min_keys_items:
                self.add_items_to_collection(collection_key=summary_min_key, items_keys=min_keys_items,tag=f"{name}_min_page")
                self.moving_items_from_collection(
                    old_collection_key=temp_key,
                    new_collection_key=screen_min_key,
                    items_keys=min_keys_items
                )

            if max_keys_items:
                self.add_items_to_collection(collection_key=summary_max_key, items_keys=max_keys_items,tag=f"{name}_max_page")
                self.add_items_to_collection(
                    collection_key=screen_max_key,
                    items_keys=max_keys_items
                )

            if errors_keys_items:
                self.add_items_to_collection(collection_key=summary_errors_key, items_keys=errors_keys_items,tag=f"{name}_errors")
                self.moving_items_from_collection(
                    old_collection_key=temp_key,
                    new_collection_key=screen_errors_key,
                    items_keys=errors_keys_items
                )
        else:
            parent_key = self.find_or_create_top_collection(default_collection_name)
            min_words_key = self.find_or_create_subcollection(subcoll_name=f"min_words{default_collection_name}",parent_key=parent_key)
            max_words_key = self.find_or_create_subcollection(subcoll_name=f"max_words{default_collection_name}",parent_key=parent_key)
            self.add_items_to_collection(collection_key=max_words_key, items_keys=max_keys_items)
            self.add_items_to_collection(collection_key=min_words_key, items_keys=min_keys_items)



    def filter_missing_keyword(self, screen_collections_tree,summary_collections_tree,items, keyword):
        """
        Scan every PDF in `collection_name`; if `keyword` is never found,
        append a zero-count snippet to its child note (tagged 'payload_note'),
        then move that item into a subcollection called
        "<collection_name><keyword>Missing".

        Params:
          collection_name (str): top-level collection name
          keyword         (str): term to search in each PDF
        Returns:
          List of item-keys that lacked the keyword.
        """

        # included + its temporary/final
        total_entry_screen = next((e for e in screen_collections_tree if "total" in e), {})
        included_coll_screen = total_entry_screen.get("total", {})
        total_name_screen = included_coll_screen.get("collection_name")

        # cyber_attribution_corpus_title > 2.cyber_attribution_corpus_title > A.cyber_attribution_corpus_title_total

        # cyber_attribution_corpus_title
        missing_parent_name_screen = total_name_screen.replace("_total","").replace("A","2")
        missing_parent_key_screen= self.find_or_create_top_collection(missing_parent_name_screen)
        print("creating missing_parent:",missing_parent_name_screen)

        # A.cyber_attribution_corpus_title_total>  L.cyber_attribution_corpus_title_missing...

        missing_name_screen = total_name_screen.replace("total",f"missing_{keyword}").replace("A","L")
        missing_key_name_screen = self.find_or_create_subcollection(subcoll_name=missing_name_screen, parent_key=missing_parent_key_screen)

        missing_name_screen_errors = total_name_screen.replace("total",f"missing_{keyword}_errors")
        missing_key_screen_errors = self.find_or_create_subcollection(subcoll_name=missing_name_screen_errors,
                                                                    parent_key=missing_key_name_screen)

        included_entry_sum = next((e for e in summary_collections_tree if "included" in e), {})
        included_coll_sum= included_entry_sum.get("included", {})
        included_name_sum = included_coll_screen.get("collection_name")
        included_key_sum = included_coll_screen.get("collection_key")
        missing_parent_name_sum = included_name_sum.replace("_included", "").replace("D", "5")
        missing_parent_key_sum = self.find_or_create_top_collection(missing_parent_name_sum)

        missing_key_name_sum = missing_parent_name_screen.replace("5.","L.")+f"missing_{keyword}"
        missing_key_name_sum= self.find_or_create_subcollection(missing_key_name_sum,missing_parent_key_sum)



        missing_errors_name =missing_key_name_sum+"_errors"
        missing_key_name_errors= self.find_or_create_subcollection(subcoll_name=missing_errors_name,parent_key=missing_parent_key_sum)






        included_temp = included_entry_sum.get("included_temporary", {})
        temp_name = next(
            (entry["included_temporary"] for entry in screen_collections_tree if "included_temporary" in entry),
            None)["collection_name"]
        temp_key = next(
            (entry["included_temporary"] for entry in screen_collections_tree if "included_temporary" in entry),
            None)["collection_key"]
        # excluded + its temporary/final
        excluded_entry = next((e for e in screen_collections_tree if "excluded" in e), {})
        excluded_coll = excluded_entry.get("excluded", {})
        excluded_name = excluded_coll.get("collection_name")
        excluded_key = excluded_coll.get("collection_key")

        excluded_temp = excluded_entry.get("temporary", {})
        ex_temp_name = excluded_temp.get("collection_name")
        ex_temp_key = excluded_temp.get("collection_key")



        # 2. Get all itms in that collection
        missing_keys = []
        index= 0
        # 3. Check each PDF for the keyword
        for item in tqdm(items, desc=f"Checking for “{keyword}”", unit="item"):
            # index +=1
            # if index<1112:
            #     continue
            item_key = item['data']['key']
            title= item['data']['title']
            pdf_path = self.get_pdf_path_for_item(item_key)
            if not pdf_path or not os.path.isfile(pdf_path):
                print('no pdf in title:', title)

                input("error")
                self.moving_items_from_collection(
                    old_collection_key=temp_key,
                    new_collection_key= missing_key_screen_errors,
                    items_keys=item_key
                )
                continue

            # 4. How many times does `keyword` occur?
            count = check_keyword_details_pdf(
                pdf_path=pdf_path,
                keywords=keyword
            )["total"]
            # 4. Append page_count to the payload note
            snippet = f"\n<h3>Word count for {keyword}</h3>\n<ul><li>{count}</li></ul>"
            self.append_info_note_log(item_key=item_key, snippet=snippet)

            # 5. If it’s never found, update its note then queue for moving
            if int(count) == 0:
                print("count:")
                print(count)

                self.add_items_to_collection(collection_key=missing_key_name_sum, items_keys=item_key,
                                             tag=f"title:missing_{keyword}"
                                             )
                self.moving_items_from_collection(
                    old_collection_key=temp_key,
                    new_collection_key=missing_key_name_screen,
                    items_keys=item_key,
                    tag=f"title:missing_{keyword}"
                )
                self.add_items_to_collection(collection_key=missing_key_name_sum, items_keys=missing_keys)



        return True

    def _get_flat_subcollections(self, parent_key: str) -> list:
        """
        Fetch all descendant sub-collections of the given collection key,
        as a flat list (excluding the root itself).
        """
        # Retrieve the root + all nested collections
        flat = self.zot.everything(self.zot.all_collections(parent_key))
        # Exclude the parent collection entry and return only descendants
        return [c for c in flat if c["data"]["key"] != parent_key]
    def summary_collection_prisma(    self,
        collection_name: str,
        verbose: bool = True):
        """
          Summarize sub-collections of `collection_name` by category
          (min_page, include, exclude, errors), showing for each sub-
          collection its name and true item-count (via get_all_items),
          then list all non-English items (title, collection, key, abstract).
          """
        # 1) resolve top collection key
        parent_key = self.find_or_create_top_collection(collection_name)
        inclusion = self.find_or_create_subcollection(subcoll_name=f"{collection_name}_abstract_inclusion",parent_key=parent_key)

        if not parent_key:
            raise ValueError(f"Collection “{collection_name}” not found.")

        # 2) get the full flat tree of sub-collections
        sub_colls = self._get_flat_subcollections(parent_key)

        # 3) bucket into our four name-based categories
        categories = {"min_page": [], "include": [], "exclude": [], "errors": []}
        for c in sub_colls:
            name_l = c["data"]["name"].lower()
            if "min_page" in name_l:            categories["min_page"].append(c)
            if name_l.endswith("include"):      categories["include"].append(c)
            if name_l.endswith("exclude"):      categories["exclude"].append(c)
            if name_l.endswith("errors"):       categories["errors"].append(c)

        # 4) for each category, call get_all_items() to count real items
        stats = {}
        for cat, coll_list in categories.items():
            coll_counts = []
            for c in coll_list:
                cn = c["data"]["name"]
                items = self.get_all_items(collection_name=cn, cache=False, all=False)
                coll_counts.append((cn, len(items)))
            total = sum(cnt for _, cnt in coll_counts)
            stats[cat] = {
                "collections": coll_counts,
                "col_count": len(coll_list),
                "item_count": total
            }

        # 5) detect non-English items (and capture title, collection, key, abstract)
        try:
            from langdetect import detect
        except ImportError:
            def detect(_: str) -> str:
                return "xx"

        def is_eng(txt: str) -> bool:
            if not txt.strip(): return True
            try:
                return detect(txt)[:2].lower() == "en"
            except:
                return False

        non_eng = []
        for c in sub_colls:
            cn = c["data"]["name"]
            items = self.get_all_items(collection_name=cn, cache=False, all=False)
            for it in items:
                data = it["data"]
                title = data.get("title", "(no title)")
                abstract = data.get("abstractNote", "")
                extra= data.get("extra", "")
                if "inclusion" in extra.lower():
                    self.add_items_to_collection(collection_name=inclusion, items_keys=[it["key"]])
                text = f"{title} {abstract}".strip()
                if text and not is_eng(text):
                    non_eng.append({
                        "title": title,
                        "collection": cn,
                        "key": data.get("key", ""),
                        "abstract": abstract.replace("\n", " ")
                    })

        # 6) if verbose, print GitHub-style tables of each category + non-English items
        if verbose:
            from tabulate import tabulate

            for cat in ("min_page", "include", "exclude", "errors"):
                s = stats[cat]
                rows = [[n, c] for n, c in s["collections"]]
                rows.append(["**Total**", s["item_count"]])
                print(f"\n--- {cat.replace('_', ' ').title()} ({s['col_count']} cols) ---")
                print(tabulate(rows, headers=["Collection", "# items"], tablefmt="github"))

            print(f"\n--- Non-English Items ({len(non_eng)}) ---")
            ne_rows = [[i["title"], i["collection"], i["key"], i["abstract"]] for i in non_eng]
            ne_rows.append(["**Total**", "", "", len(non_eng)])
            print(tabulate(ne_rows,
                           headers=["Title", "Collection", "Key", "Abstract"],
                           tablefmt="github"))

        return {
            "categories": stats,
            "non_english": non_eng
        }

    class _NoteHTMLParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.current_h2: Optional[str] = None
            self.current_h3: Optional[str] = None
            self.current_h4: Optional[str] = None
            self.title: Optional[str] = None
            self._buf = ""
            self._collect = False
            self.map: Dict[Tuple[Optional[str], Optional[str]], List[str]] = {}

        def handle_starttag(self, tag, attrs):
            if tag in ("h2", "h3", "h4", "li"):
                self._collect = True
                self._buf = ""

        def handle_endtag(self, tag):
            if tag in ("h2", "h3", "h4", "li"):
                text = self._buf.strip()
                if tag == "h2" and text:
                    if self.title is None:
                        self.title = text
                    self.current_h2 = text
                    self.current_h3 = None
                    self.current_h4 = None
                elif tag == "h3" and text:
                    self.current_h3 = text
                    self.current_h4 = None
                elif tag == "h4" and text:
                    self.current_h4 = text
                elif tag == "li" and text:
                    key = (self.current_h3, self.current_h4)
                    self.map.setdefault(key, []).append(text)
                self._collect = False
                self._buf = ""

        def handle_data(self, data):
            if self._collect:
                self._buf += data

    def _dedup(self, seq: List[Any]) -> List[Any]:
        seen = set()
        out = []
        for x in seq:
            if x not in seen:
                out.append(x)
                seen.add(x)
        return out

    def _parse_note_html(self, note_html: str) -> Dict[str, Any]:
        p = self._NoteHTMLParser()
        p.feed(note_html)
        m = p.map
        cit_match = re.search(r'Cited by\s*(\d+)', note_html)
        citation_count = int(cit_match.group(1)) if cit_match else None

        def grab(h3: str, h4: Optional[str] = None) -> List[str]:
            return m.get((h3, h4), [])

        def ints(values: List[str]) -> List[int]:
            out = []
            for v in values:
                try:
                    out.append(int(v))
                except Exception:
                    pass
            return out

        place = grab("Affiliations", "Place")
        affiliations = grab("Affiliations", "Affiliations")
        pdf_links = grab("URLs", "PDF / Primary Link")
        publication = grab("Metadata", "Publication")
        publisher = grab("Metadata", "Publisher")
        sources = grab("Metadata", "Source(s)")
        page_count = (ints(grab("Page Count")) or [None])[0]
        word_attr = (ints(grab("Word count for attribution")) or [None])[0]

        coding_labels = [
            "Ontology",
            "Epistemology",
            "Argumentation Logic",
            "Evidence Source Base",
            "Methods",
            "Method Type",
            "Framework Model",
            "Contribution Type",
            "Attribution Lens Focus",
            "research_question_purpose",
            "Research Question/Purpose",
        ]
        coding: Dict[str, List[str]] = {}
        for lbl in coding_labels:
            vals = m.get((lbl, None), [])
            if vals:
                coding[lbl] = self._dedup(vals)

        rq = self._dedup(coding.get("research_question_purpose", []) + coding.get("Research Question/Purpose", []))
        if rq:
            coding["Research Question/Purpose"] = rq
        coding.pop("research_question_purpose", None)

        return {
            "title": p.title,
            "place": self._dedup(place),
            "affiliations": self._dedup(affiliations),
            "urls": {
                "pdf_primary": pdf_links[0] if pdf_links else None,
                "all": self._dedup(pdf_links),
            },
            "metadata": {
                "publication": publication[0] if publication else None,
                "publisher": publisher[0] if publisher else None,
                "sources": self._dedup(sources),
                "page_count": page_count,
                "word_count_for_attribution": word_attr,
                "citation_count": citation_count,
            },
            "coding": coding,
        }

    def _merge_notes(self, parsed_notes: List[Dict[str, Any]]) -> Dict[str, Any]:
        merged: Dict[str, Any] = {
            "title": None,
            "place": [],
            "affiliations": [],
            "urls": {"pdf_primary": None, "all": []},
            "metadata": {
                "publication": None,
                "publisher": None,
                "sources": [],
                "page_count": None,
                "word_count_for_attribution": None,
                "citation_count": None,
            },
            "coding": {},
        }
        for d in parsed_notes:
            if not merged["title"] and d.get("title"):
                merged["title"] = d["title"]
            merged["place"].extend(d.get("place", []))
            merged["affiliations"].extend(d.get("affiliations", []))
            merged["urls"]["all"].extend(d.get("urls", {}).get("all", []))
            if not merged["urls"]["pdf_primary"] and d.get("urls", {}).get("pdf_primary"):
                merged["urls"]["pdf_primary"] = d["urls"]["pdf_primary"]

            md = d.get("metadata", {})
            for k in ("publication", "publisher"):
                if not merged["metadata"][k] and md.get(k):
                    merged["metadata"][k] = md[k]
            merged["metadata"]["sources"].extend(md.get("sources", []))

            for nk in ("page_count", "word_count_for_attribution"):
                val = md.get(nk)
                if val is not None:
                    if merged["metadata"][nk] is None:
                        merged["metadata"][nk] = val
                    else:
                        merged["metadata"][nk] = max(merged["metadata"][nk], val)

            cc = md.get("citation_count")
            if cc is not None:
                if merged["metadata"]["citation_count"] is None:
                    merged["metadata"]["citation_count"] = cc
                else:
                    merged["metadata"]["citation_count"] = max(merged["metadata"]["citation_count"], cc)

            for label, vals in d.get("coding", {}).items():
                merged["coding"].setdefault(label, []).extend(vals)

        merged["place"] = self._dedup(merged["place"])
        merged["affiliations"] = self._dedup(merged["affiliations"])
        merged["urls"]["all"] = self._dedup(merged["urls"]["all"])
        merged["metadata"]["sources"] = self._dedup(merged["metadata"]["sources"])
        for label in list(merged["coding"].keys()):
            merged["coding"][label] = self._dedup(merged["coding"][label])

        return merged

    def _attachments_from_children(self, children: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        atts = []
        for ch in children:
            data = ch.get("data", {})
            if data.get("itemType") == "attachment":
                atts.append({
                    "title": data.get("title"),
                    "filename": data.get("filename"),
                    "md5": data.get("md5"),
                    "url": data.get("url"),
                    "contentType": data.get("contentType"),
                    "key": data.get("key"),
                })
        return atts

    # put this inside your Zotero class (e.g. below update_note)

    def get_note_by_tag(
            self,
            tag: str = "Note_Codes",
            collection_name: str = "coding_leftovers",
            delete: bool = False,
            saving: bool = True,
            year_periods: list | None = None,
    ):
        """
        Export Zotero notes with *tag* into Markdown.

        Format per note:
        # Author(s). YEAR. Title. Journal
        abstract: Abstract text

        ## note
        <note content converted from HTML to Markdown>

        If *year_periods* is provided (e.g., ["2001-2015", "2016-2017"]), the output is split
        by inclusive year ranges. Returns a list of outputs (file paths if saving=True,
        otherwise Markdown strings). If *year_periods* is None, returns a single output
        (path or string). No notes are dropped; items outside all ranges go to an "others" bucket.
        """
        from pathlib import Path
        import re
        from bs4 import BeautifulSoup, NavigableString, Tag

        # ---------- helpers ----------
        def _safe_filename(name: str) -> str:
            return re.sub(r'[\\/*?:"<>|]', "_", name).strip() or "notes"

        def _extract_year(val) -> int | None:
            if val is None:
                return None
            s = str(val)
            m = re.search(r"(19|20)\d{2}", s)
            return int(m.group()) if m else None

        def _parse_periods(periods: list[str]) -> list[tuple[str, int | None, int | None]]:
            """
            Returns list of tuples: (label, start_year, end_year), inclusive.
            Accepts "YYYY-YYYY" or single "YYYY". None if bound is open (not used here).
            """
            parsed = []
            for p in periods:
                p = str(p).strip()
                if "-" in p:
                    a, b = [x.strip() for x in p.split("-", 1)]
                    sy = _extract_year(a)
                    ey = _extract_year(b)
                    if sy or ey:
                        parsed.append((f"{sy or ''}-{ey or ''}", sy, ey))
                else:
                    y = _extract_year(p)
                    if y:
                        parsed.append((str(y), y, y))
            return parsed

        def _which_bucket(year: int | None, buckets: list[tuple[str, int | None, int | None]]) -> str:
            if not buckets:
                return "all"
            if year is None:
                return "others"
            for label, sy, ey in buckets:
                if (sy is None or year >= sy) and (ey is None or year <= ey):
                    return label
            return "others"

        def _authors_to_text(authors) -> str:
            if authors is None:
                return ""
            if isinstance(authors, str):
                return authors.strip()
            if isinstance(authors, (list, tuple, set)):
                parts = []
                for a in authors:
                    if a is None:
                        continue
                    s = str(a).strip()
                    if not s:
                        continue
                    parts.append(s)
                return "; ".join(parts)
            if isinstance(authors, dict):
                # try common keys
                for k in ("full", "name", "label", "creator", "author"):
                    if k in authors and authors[k]:
                        return str(authors[k]).strip()
            return str(authors).strip()

        def _format_inline_header(meta: dict) -> str:
            """
            # Author(s). YEAR. Title. Journal
            Skip empty parts cleanly.
            """
            authors = _authors_to_text(meta.get("authors"))
            year = _extract_year(meta.get("date"))
            title = (meta.get("title") or "").strip()
            journal = (meta.get("journal") or meta.get("publication", "") or "").strip()

            parts = []
            if authors:
                parts.append(authors.rstrip("."))
            if year:
                parts.append(str(year))
            if title:
                parts.append(title.rstrip("."))
            if journal:
                parts.append(journal.rstrip("."))

            line = ". ".join(parts)
            return f"# {line}".strip() if line else "# "

        def _abstract_block(meta: dict) -> str:
            ab = meta.get("abstract") or meta.get("abstractNote") or ""
            ab = str(ab).strip()
            return f"abstract: {ab}" if ab else "abstract: "

        def _inline_md(el: Tag) -> str:
            out = []
            for child in el.children:
                if isinstance(child, NavigableString):
                    out.append(str(child))
                elif isinstance(child, Tag):
                    name = child.name.lower()
                    if name == "a":
                        text = child.get_text(strip=True)
                        href = child.get("href") or ""
                        out.append(f"[{text}]({href})" if text else "")
                    elif name in ("strong", "b"):
                        out.append(f"**{child.get_text()}**")
                    elif name in ("em", "i"):
                        out.append(f"*{child.get_text()}*")
                    elif name in ("code", "tt", "kbd", "samp"):
                        out.append(f"`{child.get_text()}`")
                    else:
                        out.append(child.get_text())
            return "".join(out).strip()

        def _element_to_md(el: Tag, depth: int = 0) -> list[str]:
            """
            Recursive HTML -> Markdown. More permissive than the previous version:
            it walks the full tree, so nested wrappers won't drop content.
            """
            lines: list[str] = []
            name = (el.name or "").lower()

            if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
                lvl = int(name[1])
                text = _inline_md(el)
                if name == "h2":
                    text = f"Theme:{text}"
                lines.append(f'{"#" * lvl} {text}')
                lines.append("")
                return lines

            if name == "p":
                txt = _inline_md(el)
                if txt:
                    lines.append(txt)
                    lines.append("")
                return lines

            if name in {"ul", "ol"}:
                if name == "ul":
                    for li in el.find_all("li", recursive=False):
                        lines.append(f"* {_inline_md(li)}")
                else:
                    for i, li in enumerate(el.find_all("li", recursive=False), start=1):
                        lines.append(f"{i}. {_inline_md(li)}")
                lines.append("")
                return lines

            if name == "blockquote":
                txt = _inline_md(el)
                if txt:
                    lines.append(f"> {txt}")
                    lines.append("")
                return lines

            if name in {"pre"}:
                code_text = el.get_text()
                lines.append("```")
                lines.append(code_text.rstrip("\n"))
                lines.append("```")
                lines.append("")
                return lines

            # Generic container: recurse
            for child in el.children:
                if isinstance(child, NavigableString):
                    txt = str(child).strip()
                    if txt:
                        lines.append(txt)
                elif isinstance(child, Tag):
                    lines.extend(_element_to_md(child, depth + 1))
            if lines and lines[-1] != "":
                lines.append("")
            return lines

        def _html_to_markdown(html: str) -> str:
            soup = BeautifulSoup(html or "", "html.parser")
            for h in soup.find_all("h3"):
                if h.get_text(" ", strip=True).casefold() == "page count":
                    sib = h.next_sibling
                    while sib and not (getattr(sib, "name", None) in {"h1", "h2", "h3"}):
                        nxt = sib.next_sibling
                        if hasattr(sib, "decompose"):
                            sib.decompose()
                        sib = nxt
                    h.decompose()
            body = soup.body if soup.body else soup
            # If body has no element children but has text, return text
            el_children = [c for c in body.children if isinstance(c, Tag)]
            if not el_children:
                txt = body.get_text("\n", strip=True)
                return txt if txt else ""
            lines: list[str] = []
            for el in el_children:
                lines.extend(_element_to_md(el))
            md = "\n".join(lines).strip()
            if not md:
                # final fallback to plain text
                md = body.get_text("\n", strip=True)
            return md

        # ---------- setup ----------
        self.find_or_create_top_collection(collection_name)

        notes = self.zot.everything(self.zot.items(itemType="note", tag=tag))
        if not notes:
            return [] if year_periods else False

        # Prepare buckets
        periods = _parse_periods(year_periods) if year_periods else []
        bucket_buffers: dict[str, list[str]] = {}

        def _ensure_bucket(label: str):
            if label not in bucket_buffers:
                bucket_buffers[label] = [f"# {tag} — {label}\n"]

        # ---------- iterate notes ----------
        wrote_any = False
        for note in notes:
            key = note["data"]["key"]
            html = note["data"].get("note", "") or ""
            parent_item_key = note["data"].get("parentItem")

            if delete:
                self.zot.delete_item(note)
                continue

            # Metadata via local call
            meta = self.generate_metadata(item_key=parent_item_key) or {}
            year = _extract_year(meta.get("date"))

            # Choose bucket
            label = _which_bucket(year, periods) if periods else "all"
            _ensure_bucket(label)

            # Compose required blocks
            header = _format_inline_header(meta)
            abstract = _abstract_block(meta)
            content_md = _html_to_markdown(html)

            # If the note content conversion produced nothing, at least include plain text fallback
            if not content_md:
                # Try raw text
                content_md = BeautifulSoup(html or "", "html.parser").get_text("\n", strip=True)

            # Build the section
            section_lines = [
                header,
                "",
                abstract,
                "",
                "## note",
                "",
            ]

            # Ensure we actually include the note content, not just the key
            if content_md:
                section_lines.append(content_md)
                section_lines.append("")
                wrote_any = True
            else:
                # still record the key so nothing is lost
                section_lines.append(f"_No note content available (key {key})._")
                section_lines.append("")

            bucket_buffers[label].append("\n".join(section_lines))

        # ---------- produce outputs ----------
        outputs: list[str] = []
        if not year_periods:
            # Single output
            content = "\n".join(bucket_buffers.get("all", [f"# {tag}\n"]))
            if saving:
                out_path = Path(f"{_safe_filename(tag)}.md")
                out_path.write_text(content, encoding="utf-8", newline="\n")
                return str(out_path) if wrote_any else False
            return content if wrote_any else False

        # Multiple period outputs
        # Ensure 'others' bucket exists if we had periods and any note landed there
        if "others" in bucket_buffers and bucket_buffers["others"]:
            pass

        outputs_contents: list[tuple[str, str]] = []
        for label, buf in bucket_buffers.items():
            content = "\n\n".join(buf).rstrip() + "\n"
            outputs_contents.append((label, content))

        if saving:
            paths: list[str] = []
            base = _safe_filename(tag)
            for label, content in outputs_contents:
                fname = f"{base}__{_safe_filename(label)}.md"
                Path(fname).write_text(content, encoding="utf-8", newline="\n")
                paths.append(str(Path(fname)))
            return paths

        return [content for _, content in outputs_contents]

    def generate_metadata(self, item_key,cabecalho=None):
        """
            Creates a Zotero note for a given item ID, incorporating various item details and external data sources to enrich the note content.

            Parameters:
            - item_id (str): The unique identifier of the Zotero item for which to create a note.
            - path (str): The path where the note or related resources might be stored or used in processing.

            This method performs multiple steps:
            1. Retrieves the Zotero item by its ID.
            2. Extracts and formats item details such as authors, title, publication year, and DOI.
            3. Constructs a query for external data sources to enrich the note with citations, references, and related articles.
            4. Creates and updates the Zotero note with the retrieved information and additional links.

            Note:
            - The function handles items of specific types differently and might return early for types like attachments or links.
            """

        link1 = ""
        link2 = ""
        title = ""
        new_date = ""
        citation_key = None
        authors = None
        # Fetch the item by ID
        item = self.zot.item(item_key)
        date=""
        data = item
        # Access the attachment details directly
        attachment_info = data['links'].get('attachment')

        if item["data"]["itemType"] == "case":
            title = data['data']['caseName']
            date = data['data']['dateDecided']
            citation_key = data['data']['extra'].split(":")[-1]
            authors = title

        elif item["data"]["itemType"] != "case":

            try:
                # Iterate through each author in the data.
                # Check if both 'firstName' and 'lastName' keys exist, and join them if they do.
                # If they don't exist, use the 'name' key directly.
                authors = ", ".join([
                    f"{author['firstName']} {author['lastName']}" if 'firstName' in author and 'lastName' in author
                    else author['name']
                    for author in data['data'].get('creators', [])
                ])
            except Exception as e:
                # If there is an error, print out the error and the format that caused it.
                # Ensure authors is set to None or an empty list if there is an error
                print(f"Error when parsing authors: {e}")
            title = data['data'].get('title')
            date = data['data'].get('date')

            year_match = re.search(r'\b\d{4}\b', date)
            if year_match:
                date = year_match.group(0)
            if date:
                new_date = f'PY=("{date}")'

            else:
                new_date = ""
        key = data.get('key')
        item_type = data['data'].get('itemType')
        title = data['data'].get('title')
        abstract = data['data'].get('abstractNote')
        publication_title = data['data'].get('publicationTitle')
        if item['data']['itemType'] in ['note', 'attachment', 'linkAttachment', 'fileAttachment']:
            return  # Exit the function as we cannot proceed

        extra_data = data['data'].get('extra')

        if extra_data:
            for line in extra_data.split('\n'):
                if 'Citation Key' in line:
                    citation_key = line.split(': ')[1]

        doi = data['data'].get('DOI')


        if cabecalho:
            now = datetime.now().strftime("%d-%m-%Y at %H:%M")
            metadata = f"""<em>@{key}</em><br>
                  <em>Note date: {now}</em><br>
                  <h1>{title}</h1>
                  <hr>
                  <hr>
                  <h1>Metadata</h1>
                  <ul>
                  <li><strong>Title</strong>: {title}</li>
                  <li><strong>Authors</strong>: {authors}</li>
                  <li><strong>Publication date</strong>: {date}</li>
                  <li><strong>Item type</strong>: {item_type}</li>
                  <li><strong>Publication Title</strong>: {publication_title}</li>
                  <li><strong>DOI</strong>: {doi}</li>
                  <li><strong>Identifier</strong>: <a href="{item['data'].get('url')}">Online</a></li>
                  {link1}
                  {link2}
              </ul>
              <hr>
              <hr>
              <h1>Abstract:</h1>
              <p>"{abstract}"</p>
                  """
            return metadata.strip()

        return {'authors': authors,
                    'date': date,
                    'journal': publication_title,
                    'title': title,
                    'abstract': abstract,
                    'doi': doi,
                    "item_type": item_type,
                    "url": item['data'].get('url'),
                    "conferenceName": item['data'].get('conferenceName'),
                    # "pages": item['data'].get('pages'),
                    "short_title": item['data'].get('shortTitle'),
                    # 'item_id': key,
                    # 'citation_key': citation_key,
                    # 'attachment': attachment_info
        }

    def cluster_notes_codes(self, tag="Note_Codes", heading="Theoretical Orientation"):
        """
        Retrieve notes by tag, then for each <h3> matching `heading`,
        use the first <p> after it as the cluster key, collect the rest
        of the paragraphs until the next <h3>, attach metadata, and return
        a dict of clusters keyed by that first paragraph.
        """
        # 1) Fetch notes by tag via Pyzotero
        notes = self.zot.items(itemType='note', tag=tag)
        if not notes:
            return False

        clusters = []
        for note in notes:
            key = note['data']['key']
            html = note['data'].get('note', '')
            parent_item_key = note['data']['parentItem']

            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, 'html.parser')

            for h3 in soup.find_all('h3'):
                if h3.get_text(strip=True) != heading:
                    continue

                # 1) Find the very first <p> after this <h3>
                first_p = h3.find_next_sibling('p')
                print(first_p)

                if not first_p:
                    continue  # no paragraphs under this heading

                first_para = first_p.get_text(strip=True)

                # 2) Collect all subsequent <p> until the next <h3>
                paragraphs = []
                sib = first_p
                while True:
                    sib = sib.next_sibling
                    if sib is None or getattr(sib, 'name', None) == 'h3':
                        break
                    if getattr(sib, 'name', None) == 'p':
                        paragraphs.append(sib.get_text(strip=True))

                # metadata = ""
                metadata = self.generate_metadata(parent_item_key)
                cluster = {first_para: [metadata] + paragraphs}
                clusters.append(cluster)

        # code to be replaced
        # return clusters

        # replacement
        from collections import defaultdict
        grouped = defaultdict(list)
        for c in clusters:
            for first_para, items in c.items():
                grouped[first_para].append(items)

        return dict(grouped)

    def thematic_section_from_consolidated(
            self,
            collection_name: str,
            consolidated_results,
            *,
            read: bool = False,
            store_only: bool = True,  # default: queue/batch
            cache: bool = True,
            write_cache: bool = True,
            section_title: str = "Thematic analysis",
    ) -> dict | str:
        """
        Build a single *thematic section* from multiple per-keyword consolidated JSONs
        (each shaped like {'keyword_analysis': {...}}), using ONE model call.

        Inputs:
          • consolidated_results: list[dict] OR {keyword: dict}. Each dict must include 'keyword_analysis'.
          • store_only=True by default for batch queuing.
          • read=True & store_only=False to synchronously return the section.

        Output:
          • If store_only=True → {'status':'enqueued', 'custom_id':...}
          • Else returns the model JSON (dict) and also renders a minimal HTML string if needed.
        """
        import json, hashlib, re, html as _html
        from pathlib import Path

        def _slug(s: str) -> str:
            return re.sub(r"[^A-Za-z0-9_.:-]+", "-", (s or "")).strip("-").lower()[:60] or "x"

        def _h(s: str) -> str:
            return hashlib.sha256((s or "").encode("utf-8")).hexdigest()

        def _normalise(consol):
            # Accept list[{'keyword':..., 'keyword_analysis':{...}}] OR mapping {kw: {'keyword_analysis':...}}
            out = []
            if isinstance(consol, dict):
                for k, v in consol.items():
                    if isinstance(v, dict) and "keyword_analysis" in v:
                        out.append({"keyword": str(k), "keyword_analysis": v["keyword_analysis"]})
            elif isinstance(consol, (list, tuple)):
                for item in consol:
                    if isinstance(item, dict):
                        ka = item.get("keyword_analysis")
                        kw = item.get("keyword") or item.get("kw") or item.get("term")
                        if ka and isinstance(ka, dict):
                            out.append({"keyword": str(kw or "UNKNOWN"), "keyword_analysis": ka})
            return out

        def _cache_path_for(keywords_sorted: list[str]) -> Path:
            root = Path(CACHE_DIR)
            h = _h("|".join(keywords_sorted).lower())
            return root / f"thematic_section__{h}.json"

        def _render_thematic_html(section_json: dict) -> str:
            sec = (section_json or {}).get("thematic_section") or {}
            title = _html.escape(sec.get("title") or section_title)
            overview = sec.get("summary") or sec.get("overview") or ""
            points = sec.get("key_arguments") or sec.get("bullets") or []
            evidence = sec.get("evidence_sentence") or ""
            limits = sec.get("limitations") or ""

            li = "\n".join(f"<li>{p}</li>" for p in points) if isinstance(points, (list, tuple)) else ""
            ev = f'<blockquote style="margin:.6em 0 0 0;">{evidence}</blockquote>' if evidence else ""
            lim = f"<p>{limits}</p>" if limits else ""

            return f"""
    <section id="thematic-analysis" style="margin:1.5em 0;">
      <h2 style="font-size:1.35em;">{title}</h2>
      <div class="overview"><p>{overview}</p></div>
      <div class="arguments">
        <ul>
          {li}
        </ul>
      </div>
      <div class="evidence">
        <strong>Representative evidence:</strong>
        {ev}
      </div>
      <div class="limitations">
        <strong>Limitations:</strong>
        {lim}
      </div>
    </section>
    """.strip()

        # ---- normalise consolidated inputs ----
        norm = _normalise(consolidated_results)
        if not norm:
            if store_only:
                return {"status": "enqueued", "custom_id": None, "note": "no consolidated inputs"}
            return {"error": "no consolidated inputs"}

        keywords_sorted = sorted({(item.get("keyword") or "").strip() for item in norm if item.get("keyword")})
        cache_fp = _cache_path_for(keywords_sorted)

        # ---- build payload for the model ----
        seed = {
            "section_title": section_title,
            "keywords": [{"keyword": it["keyword"], "keyword_analysis": it["keyword_analysis"]} for it in norm],
        }
        payload = json.dumps(seed, ensure_ascii=False, indent=2)

        # Stable custom_id for queueing and retrieval
        cid = f"coding_keyword_thematic_section::{_h(payload)[:12]}"

        # ---- dispatch model call ----
        response, _v = call_models(
            read=read,
            store_only=store_only,
            text=payload,
            function="coding_keyword_thematic_section",
            collection_name=collection_name,
            custom_id=cid,
        )

        # ---- cache write (only when we have immediate response) ----
        if not store_only and write_cache:
            try:
                cache_fp.parent.mkdir(parents=True, exist_ok=True)
                cache_fp.write_text(json.dumps(response or {}, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass

        # ---- return according to mode ----
        if store_only:
            return {"status": "enqueued", "custom_id": cid, "keywords": keywords_sorted}

        # response is expected to be a dict with 'thematic_section'
        html = _render_thematic_html(response or {})
        return {"json": response or {}, "html": html, "custom_id": cid}

    def thematic_section_from_consolidated_html(
            self,
            collection_name: str,
            consolidated_by_keyword_html: dict[str, str] | list[dict],
            *,
            overall_research_question: str,
            section_title: str = "Thematic analysis",
            store_only: bool = True,
            read: bool = False,
    ) -> str:
        """
        Phase 3 (HTML): merge consolidated keyword HTML into ONE section answering the research question.
        Enqueue → process → read. Output MUST be ONLY <p>…</p> blocks with anchors preserved.
        """
        import hashlib

        # Normalise inputs
        if isinstance(consolidated_by_keyword_html, dict):
            pairs = [(k, v) for k, v in consolidated_by_keyword_html.items() if str(k).strip() and str(v).strip()]
        else:
            pairs = []
            for obj in (consolidated_by_keyword_html or []):
                k = (obj or {}).get("keyword")
                v = (obj or {}).get("html") or (obj or {}).get("content") or ""
                if str(k).strip() and str(v).strip():
                    pairs.append((k, v))

        if not pairs:
            return ""

        # Deterministic ordering & payload with explicit research question
        pairs = sorted(pairs, key=lambda kv: kv[0].lower())
        payload_parts = [
            f"<!-- section_title: {section_title} -->",
            f"<!-- research_question: {overall_research_question} -->",
        ]
        for k, html_block in pairs:
            payload_parts.append(f'<!-- keyword: {k} -->')
            payload_parts.append(html_block.strip())
        payload = "\n".join(payload_parts)

        # Stable custom_id
        cid_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
        cid = f"coding_keyword_thematic_section_html::{cid_hash}"

        def _processor(fn: str) -> bool:
            proc = getattr(self, "_process_batch_for", None)
            return bool(proc(collection_name=collection_name, function=fn)) if callable(proc) \
                else bool(_process_batch_for(collection_name=collection_name, function=fn))

        # ENQUEUE → PROCESS → READ
        _resp, _v = call_models(
            read=False,
            store_only=True if store_only else False,
            text=payload,
            function="coding_keyword_thematic_section_html",
            collection_name=collection_name,
            custom_id=cid,
        )
        if not _processor("coding_keyword_thematic_section_html"):
            return ""

        resp, _v = call_models(
            read=True,
            store_only=False,
            text=payload,
            function="coding_keyword_thematic_section_html",
            collection_name=collection_name,
            custom_id=cid,
        )
        return str(resp or "")

    def build_thematic_section_after_collect_html(
            self,
            collection_name: str,
            keywords: list[str],
            *,
            overall_research_question: str,
            section_title: str = "Thematic analysis",
            cache: bool = True,
            lines_per_batch: int = 60,
    ) -> str:
        """
        Full HTML pipeline:
          1) extract_content_for_keywords per keyword → notes
          2) Phase 1: keyword_html_first_pass (enqueue → process → read) → batch HTML
          3) Phase 2: consolidate_keyword_batches_html (enqueue → process → read) → per-keyword HTML
          4) Phase 3: thematic_section_from_consolidated_html (enqueue → process → read) → final HTML
        """
        df = self._build_df_for_collection(collection_name=collection_name, cache=cache)

        consolidated_map: dict[str, str] = {}
        for kw in (keywords or []):
            kw = (kw or "").strip()
            if not kw:
                continue

            ex = extract_content_for_keywords(
                full_df=df,
                items_to_code_with_keywords_map={},  # global mode
                zotero_client_instance=self,
                globally_suggested_keywords=[kw],
                progress_callback=None,
                max_items=df.shape[0],
                cache=cache,
            )
            notes = (ex or {}).get("data", [])
            if not notes:
                continue

            batch_html = self.keyword_html_first_pass(
                collection_name=collection_name,
                keyword=kw,
                notes=notes,
                overall_research_question=overall_research_question,
                lines_per_batch=lines_per_batch,
                store_only=True,
            )
            if not batch_html:
                continue

            consolidated_html = self.consolidate_keyword_batches_html(
                collection_name=collection_name,
                keyword=kw,
                batch_html_list=batch_html,
                overall_research_question=overall_research_question,
                store_only=True,
            )
            if consolidated_html.strip():
                consolidated_map[kw] = consolidated_html

        # Final cross-keyword thematic section
        return self.thematic_section_from_consolidated_html(
            collection_name=collection_name,
            consolidated_by_keyword_html=consolidated_map,
            overall_research_question=overall_research_question,
            section_title=section_title,
            store_only=True,
            read=False,
        )
    def run_store_only_then_collect(
            self,
            collection_name: str,
            keyword: str,
            *,
            batch_size: int = 10,
            cache: bool = True,
    ) -> list[dict]:
        """
        Phase 1: per-item coding jobs
          • enqueue (store_only=True)
          • process (_process_batch_for → 'coding_keyword')
          • read (store_only=False) with SAME payload/custom_id
        Returns list of {'custom_id','item_key','title','response'}.
        """
        import json, hashlib
        from collections import defaultdict
        from pathlib import Path

        def _processor(function_key: str) -> bool:
            # Works whether the processor is a method or a free function
            proc = getattr(self, "_process_batch_for", None)
            if callable(proc):
                return bool(proc(collection_name=collection_name, function=function_key))
            return bool(_process_batch_for(collection_name=collection_name, function=function_key))

        kw = (keyword or "").strip()
        if not kw:
            return []

        # 1) ENQUEUE per-item jobs via keyword_analysis (store_only=True)
        _ = self.keyword_analysis(
            collection_name=collection_name,
            keyword=keyword,
            store_only=True,  # enqueue only
            read=False
        )

        # 2) process → collect → consolidate → build section (all stages handled inside)
        out = self.build_thematic_section_after_collect(
            collection_name=collection_name,
            keywords=[keyword],
            section_title="Thematic analysis",
            cache=True,
        )

        # 3) use the output
        if isinstance(out, dict):
            print("Section custom_id:", out.get("custom_id"))
            print("HTML:\n", out.get("html", ""))

        # 3) READ the stored outputs using identical payloads/custom_ids
        df = self._build_df_for_collection(collection_name=collection_name, cache=cache)
        extract_res = extract_content_for_keywords(
            full_df=df,
            items_to_code_with_keywords_map={},  # global run
            zotero_client_instance=self,
            globally_suggested_keywords=[kw],
            progress_callback=None,
            max_items=df.shape[0],
            cache=cache,
        )
        snippets = (extract_res or {}).get("data", [])
        if not snippets:
            return []

        by_item = defaultdict(list)
        for sn in snippets:
            ik = sn.get("source_item_key")
            ctx = sn.get("original_paragraph") or sn.get("paragraph_context") or ""
            if ik and ctx:
                by_item[ik].append(ctx)

        df_idx = df.set_index("key", drop=False) if "key" in df.columns else None
        collected = []
        norm_kw = kw.strip().lower()
        for item_key, contexts in by_item.items():
            paper_abs = ""
            paper_title = ""
            if df_idx is not None and item_key in df_idx.index:
                row = df_idx.loc[item_key]
                paper_abs = (row.get("abstract") or "").strip()
                paper_title = (row.get("title") or "").strip()

            payload = (
                "Abstract:\n\n"
                f"{paper_abs}\n\n"
                "Keyword:\n\n"
                f"{kw}\n\n"
                "Contexts:\n\n"
                f"{json.dumps(contexts, ensure_ascii=False, indent=2)}\n\n"
                "Return exactly one JSON object."
            )
            # MUST match the queued custom_id
            cid = f"coding_keyword::{hashlib.sha256(norm_kw.encode('utf-8')).hexdigest()[:10]}::{item_key}"

            response, _v = call_models(
                read=True,
                store_only=False,
                text=payload,
                function="coding_keyword",
                collection_name=collection_name,
                custom_id=cid,
            )
            collected.append({"custom_id": cid, "item_key": item_key, "title": paper_title, "response": response})

        # Optional: cache the read bundle
        try:
            h = hashlib.sha256(kw.encode("utf-8")).hexdigest()
            fp = Path(CACHE_DIR) / f"kw_batches__{h}.json"
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(
                json.dumps({"section": kw, "kw_hash": h, "results": collected}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass

        return collected

    def consolidate_keyword_batches(
            self,
            keyword: str,
            per_item_results: list[dict],
            *,
            collection_name: str,
            read: bool = True,
            store_only: bool = False,
            cache_path: str | None = None,
    ) -> dict:
        """
        Phase 2: per-keyword consolidation
          • if store_only=True → enqueue then process then read
          • else → direct read
        Returns {'keyword_analysis': {...}} or {}.
        """
        import json, hashlib
        from pathlib import Path

        def _processor(function_key: str) -> bool:
            proc = getattr(self, "_process_batch_for", None)
            if callable(proc):
                return bool(proc(collection_name=collection_name, function=function_key))
            return bool(_process_batch_for(collection_name=collection_name, function=function_key))

        # Filter valid item-level JSONs
        analyses = []
        for r in per_item_results or []:
            obj = r.get("response") or {}
            if isinstance(obj, dict) and "keyword_analysis" in obj:
                analyses.append({
                    "item_key": r.get("item_key"),
                    "title": r.get("title"),
                    "keyword_analysis": obj.get("keyword_analysis"),
                })

        seed = {"keyword": keyword, "analyses": analyses}
        payload = json.dumps(seed, ensure_ascii=False, indent=2)
        kw_norm = (keyword or "").strip().lower()
        cid = f"coding_keyword_consolidation::{kw_norm}"

        if store_only:
            # ENQUEUE
            _resp, _v = call_models(
                read=False,
                store_only=True,
                text=payload,
                function="coding_keyword_consolidation",
                collection_name=collection_name,
                custom_id=cid,
            )
            # PROCESS
            if not _processor("coding_keyword_consolidation"):
                return {}
            # READ
            response, _v = call_models(
                read=True,
                store_only=False,
                text=payload,
                function="coding_keyword_consolidation",
                collection_name=collection_name,
                custom_id=cid,
            )
        else:
            # Direct read path
            response, _v = call_models(
                read=read,
                store_only=False,
                text=payload,
                function="coding_keyword_consolidation",
                collection_name=collection_name,
                custom_id=cid,
            )

        if cache_path:
            try:
                p = Path(cache_path)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(response or {}, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass

        return response or {}
    def keyword_analysis(
            self,
            collection_name: str,
            keyword: str | None = None,
            *,
            keywords: list[str] | None = None,
            read: bool = False,
            store_only: bool = True,
            cache: bool = True,
            batch_size: int = 10,
            write_cache: bool = True,
    ) -> str | dict:
        """
        Unified keyword thematic pipeline (single or multi).

        Rules:
          • Do NOT use `check_keyword_details_pdf`. We only use `extract_content_for_keywords`.
          • If `keyword` is a single string and `keywords` is None, analyse that one term across the DF.
          • If `keywords` is a list, iterate keywords and produce one HTML <section> per keyword.
          • Default behaviour queues calls to the LLM (store_only=True). Use `run_store_only_then_collect(...)`
            to process and collect later, or call this with store_only=False, read=True for immediate results.

        Returns:
          • If store_only=True → returns a small dict describing enqueued tasks.
          • If store_only=False and read=True → returns an HTML report string.
        """
        import json, hashlib, re, html as _html
        from pathlib import Path

        # ---- helpers ----
        def _slug(s: str) -> str:
            return re.sub(r"[^A-Za-z0-9_.:-]+", "-", (s or "")).strip("-").lower()[:60] or "x"

        def _h(s: str) -> str:
            return hashlib.sha256((s or "").strip().lower().encode("utf-8")).hexdigest()

        def _cache_paths(kw: str):
            kw_hash = _h(kw)
            root = Path(CACHE_DIR)
            return {
                "batches": root / f"kw_batches__{kw_hash}.json",
                "consolidation": root / f"kw_consolidation__{kw_hash}.json",
                "kw_hash": kw_hash,
            }

        def _render_keyword_clusters(obj: dict) -> str:
            clusters = (obj or {}).get("keyword_analysis")
            if not clusters:
                return "<p>No analysable content.</p>"
            if isinstance(clusters, dict):
                clusters = [clusters]
            parts = []
            for c in clusters:
                theme = _html.escape(c.get("theme", "NA"))
                discussion = c.get("discussion", "NA")
                support = c.get("support", "NA")
                critique = c.get("critique", "NA")
                parts.append(
                    f"""
    <section class="keyword-cluster" style="margin-bottom:1.25em;">
      <h3 style="font-size:1.1em; margin:0 0 .4em 0;">{theme}</h3>
      <div style="margin-bottom:.6em;"><strong>Discussion:</strong><p>{discussion}</p></div>
      <div style="margin-bottom:.6em; padding-left:1em; border-left:3px solid #ccc;"><strong>Support:</strong><blockquote>{support}</blockquote></div>
      <div><strong>Critique:</strong><p>{critique}</p></div>
    </section>""".strip()
                )
            return "\n".join(parts)

        def _render_section(keyword_str: str, consolidated_json: dict) -> str:
            sec_id = f"kw-{_slug(keyword_str)}"
            core = _render_keyword_clusters(consolidated_json or {})
            return f"""
    <section id="{sec_id}" class="keyword-section" style="margin:1.5em 0;">
      <h2 style="font-size:1.35em;">Keyword: {_html.escape(keyword_str)}</h2>
      {core}
    </section>
    """.strip()

        # ---- normalise inputs ----
        if keywords is None:
            if isinstance(keyword, str) and keyword.strip():
                keywords = [keyword.strip()]
            else:
                return "<article><p>No keyword provided.</p></article>"

        # ---- build DF (key, title, year, authors, abstract, pdf_path) ----
        df = self._build_df_for_collection(collection_name=collection_name, cache=cache)

        # ---- iterate each keyword: extract → batch per-item prompts → consolidate → render ----
        all_sections_html = []
        enqueued = []

        for kw in keywords:
            kw = str(kw or "").strip()
            if not kw:
                continue

            # 1) Extract snippets across ALL items using global keyword (no per-item map).
            extract_res = extract_content_for_keywords(
                full_df=df,
                items_to_code_with_keywords_map={},  # empty → use globals
                zotero_client_instance=self,
                globally_suggested_keywords=[kw],
                progress_callback=None,
                max_items=df.shape[0],
                cache=cache,
            )
            snippets = (extract_res or {}).get("data", [])
            if not snippets:
                if store_only:
                    enqueued.append({"keyword": kw, "queued_items": 0, "note": "no snippets"})
                    continue
                else:
                    all_sections_html.append(_render_section(kw, {
                        "keyword_analysis": {"theme": "NA", "discussion": "NA", "support": "NA", "critique": "NA"}}))
                    continue

            # 2) Group snippets by item to build per-paper payloads for function "coding_keyword".
            #    Each per-paper payload: Abstract, Keyword, Contexts (array of sentences/paras).
            #    We also batch these per-paper tasks to control throughput.
            from collections import defaultdict
            by_item = defaultdict(list)
            for sn in snippets:
                key = sn.get("source_item_key")
                ctx = sn.get("original_paragraph") or sn.get("paragraph_context") or ""
                if key and ctx:
                    by_item[key].append(ctx)

            # Assemble per-item tasks
            tasks = []
            df_idx = df.set_index("key", drop=False) if "key" in df.columns else None
            for item_key, contexts in by_item.items():
                paper_abs = ""
                paper_title = ""
                if df_idx is not None and item_key in df_idx.index:
                    row = df_idx.loc[item_key]
                    paper_abs = (row.get("abstract") or "").strip()
                    paper_title = (row.get("title") or "").strip()

                payload = (
                    "Abstract:\n\n"
                    f"{paper_abs}\n\n"
                    "Keyword:\n\n"
                    f"{kw}\n\n"
                    "Contexts:\n\n"
                    f"{json.dumps(contexts, ensure_ascii=False, indent=2)}\n\n"
                    "Return exactly one JSON object."
                )

                # Function key derivation (stable but does not require a PROMPTS_CONFIG entry per-hash)
                # We keep function='coding_keyword' for prompt lookup; we use hashed custom_id for queueing and cache keys.
                func_key = "coding_keyword"
                cid = f"{func_key}::{_h(kw)[:10]}::{item_key}"
                tasks.append({
                    "function": func_key,
                    "custom_id": cid,
                    "payload": payload,
                    "item_key": item_key,
                    "title": paper_title,
                })

            # 3) Dispatch in batches
            per_item_results = []
            for i in range(0, len(tasks), max(1, int(batch_size))):
                batch = tasks[i:i + batch_size]
                for t in batch:
                    response, _v = call_models(
                        read=read,
                        store_only=store_only,
                        text=t["payload"],
                        function=t["function"],
                        collection_name=collection_name,
                        custom_id=t["custom_id"],
                    )
                    if not store_only:
                        per_item_results.append(
                            {"custom_id": t["custom_id"], "item_key": t["item_key"], "title": t["title"],
                             "response": response})

            # 4) Cache batch-level results per keyword (hash-named files).
            cp = _cache_paths(kw)
            if write_cache:
                try:
                    cp["batches"].parent.mkdir(parents=True, exist_ok=True)
                    to_write = {
                        "section": kw,
                        "kw_hash": cp["kw_hash"],
                        "function": "coding_keyword",
                        "total_items": len(tasks),
                        "store_only": bool(store_only),
                        "read": bool(read),
                        "results": per_item_results if not store_only else [],
                    }
                    cp["batches"].write_text(json.dumps(to_write, ensure_ascii=False, indent=2), encoding="utf-8")
                except Exception as _e:
                    pass

            # 5) If queue-only mode, do not consolidate/render now.
            if store_only:
                enqueued.append({"keyword": kw, "queued_items": len(tasks)})
                continue

            # 6) Consolidate the per-item JSONs into one keyword-level JSON using a dedicated prompt.
            consolidated = self.consolidate_keyword_batches(
                keyword=kw,
                per_item_results=per_item_results,
                collection_name=collection_name,
                read=True,
                store_only=True,  # enqueue → process → read to mirror Phase 2
                cache_path=cp.get("consolidation"),
            )

            # 7) Render HTML section
            all_sections_html.append(_render_section(kw, consolidated or {}))

        # Final outputs
        if store_only:
            return {"status": "enqueued", "collection": collection_name, "keywords": enqueued}

        if not all_sections_html:
            return "<article><p>No sections produced.</p></article>"

        toc = "\n".join(
            f'<li><a href="#kw-{_slug(k)}">{_html.escape(k)}</a></li>'
            for k in keywords if str(k).strip()
        )
        sections_html = "\n".join(all_sections_html)
        return f"""
    <article class="keyword-report" style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;">
      <header>
        <h1 style="font-size:1.6em; margin:.2em 0;">Keyword Thematic Analysis</h1>
        <p style="color:#666; margin:.2em 0;">{len([k for k in keywords if str(k).strip()])} keywords</p>
      </header>
      <nav class="mini-toc" style="margin:1em 0;">
        <strong>Contents:</strong>
        <ul>
          {toc}
        </ul>
      </nav>
      {sections_html}
    </article>
    """.strip()

    def collect_after_enqueue(
            self,
            collection_name: str,
            keyword: str,
            *,
            cache: bool = True,
    ) -> list[dict]:
        """
        Use this when you've ALREADY enqueued 'coding_keyword' jobs (store_only=True).
        1) Processes the queued jobs with _process_batch_for.
        2) Reconstructs the exact per-item payloads and calls read=True/store_only=False,
           so call_models returns the stored outputs.
        Returns: [{'custom_id','item_key','title','response'}, ...]
        """
        import json, hashlib
        from collections import defaultdict
        from pathlib import Path

        kw = (keyword or "").strip()
        if not kw:
            return []

        # 1) Process queued jobs for 'coding_keyword'
        ok = _process_batch_for(collection_name="b.included", function="coding_keyword")
        if not ok:
            raise RuntimeError("Batch processor returned False for function='coding_keyword'")

        results = self.collect_after_enqueue(collection_name="b.included", keyword="agility", cache=True)

        # 2) Rebuild payloads to READ stored outputs
        df = self._build_df_for_collection(collection_name=collection_name, cache=cache)
        extract_res = extract_content_for_keywords(
            full_df=df,
            items_to_code_with_keywords_map={},  # global run
            zotero_client_instance=self,
            globally_suggested_keywords=[kw],
            progress_callback=None,
            max_items=df.shape[0],
            cache=cache,
        )
        snippets = (extract_res or {}).get("data", [])
        if not snippets:
            return []

        by_item = defaultdict(list)
        for sn in snippets:
            key = sn.get("source_item_key")
            ctx = sn.get("original_paragraph") or sn.get("paragraph_context") or ""
            if key and ctx:
                by_item[key].append(ctx)

        df_idx = df.set_index("key", drop=False) if "key" in df.columns else None
        collected = []
        for item_key, contexts in by_item.items():
            paper_abs = ""
            paper_title = ""
            if df_idx is not None and item_key in df_idx.index:
                row = df_idx.loc[item_key]
                paper_abs = (row.get("abstract") or "").strip()
                paper_title = (row.get("title") or "").strip()

            payload = (
                "Abstract:\n\n"
                f"{paper_abs}\n\n"
                "Keyword:\n\n"
                f"{kw}\n\n"
                "Contexts:\n\n"
                f"{json.dumps(contexts, ensure_ascii=False, indent=2)}\n\n"
                "Return exactly one JSON object."
            )
            # MUST match the custom_id used when queuing
            norm_kw = (kw or "").strip().lower()
            cid = f"coding_keyword::{hashlib.sha256(norm_kw.encode('utf-8')).hexdigest()[:10]}::{item_key}"
            response, _v = call_models(
                read=True,
                store_only=False,
                text=payload,
                function="coding_keyword",
                collection_name=collection_name,
                custom_id=cid,
            )
            collected.append({"custom_id": cid, "item_key": item_key, "title": paper_title, "response": response})

        # lightweight cache
        try:
            h = hashlib.sha256(kw.encode("utf-8")).hexdigest()
            fp = Path(CACHE_DIR) / f"kw_batches__{h}.json"
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(json.dumps({"section": kw, "kw_hash": h, "results": collected}, ensure_ascii=False, indent=2),
                          encoding="utf-8")
        except Exception:
            pass

        return collected

    def keyword_html_first_pass(
            self,
            collection_name: str,
            keyword: str,
            notes: list[dict],
            *,
            overall_research_question: str,
            lines_per_batch: int = 60,
            store_only: bool = True,
    ) -> list[str]:
        """
        Phase 1 (HTML): notes → <p>…</p> with anchors per BATCH.
        • Builds batches from extractor notes.
        • ENQUEUE → PROCESS → READ for each batch using function 'coding_keyword_batch_html'.
        Returns list of batch HTML strings (order-preserved).
        """
        import hashlib

        def _processor(fn: str) -> bool:
            proc = getattr(self, "_process_batch_for", None)
            return bool(proc(collection_name=collection_name, function=fn)) if callable(proc) \
                else bool(_process_batch_for(collection_name=collection_name, function=fn))

        lines = _notes_to_lines(notes)
        if not lines:
            return []

        batches = ["\n".join(lines[i:i + max(1, int(lines_per_batch))])
                   for i in range(0, len(lines), max(1, int(lines_per_batch)))]

        kw_norm = (keyword or "").strip().lower()
        rq_norm = (overall_research_question or "").strip().lower()
        key_hash = hashlib.sha256(f"{kw_norm}|{rq_norm}".encode("utf-8")).hexdigest()[:10]

        # ENQUEUE all batches
        for bi, html_payload in enumerate(batches, start=1):
            payload = (
                f"<!-- keyword: {keyword} -->\n"
                f"<!-- research_question: {overall_research_question} -->\n"
                f"{html_payload}"
            )
            cid = f"coding_keyword_batch_html::{key_hash}::b{bi:03d}"
            _resp, _v = call_models(
                read=False,
                store_only=True if store_only else False,
                text=payload,
                function="coding_keyword_batch_html",
                collection_name=collection_name,
                custom_id=cid,
            )

        # PROCESS once
        if not _processor("coding_keyword_batch_html"):
            return []

        # READ in deterministic order
        out: list[str] = []
        for bi, html_payload in enumerate(batches, start=1):
            payload = (
                f"<!-- keyword: {keyword} -->\n"
                f"<!-- research_question: {overall_research_question} -->\n"
                f"{html_payload}"
            )
            cid = f"coding_keyword_batch_html::{key_hash}::b{bi:03d}"
            resp, _v = call_models(
                read=True,
                store_only=False,
                text=payload,
                function="coding_keyword_batch_html",
                collection_name=collection_name,
                custom_id=cid,
            )
            out.append(str(resp or ""))
        return out

    def build_thematic_section_after_collect(
            self,
            collection_name: str,
            keywords: list[str],
            *,
            cache: bool = True,
            section_title: str = "Thematic analysis",
    ) -> dict | str:
        """
        Phase 3: cross-keyword thematic section (JSON lane)
          1) For each keyword:
             • collect per-item results (Phase 1)
             • enqueue + process + read consolidation (Phase 2)
          2) Enqueue + process + read thematic section (Phase 3)
        Returns {'json':..., 'html':..., 'custom_id':...}
        """

        def _processor(function_key: str) -> bool:
            proc = getattr(self, "_process_batch_for", None)
            if callable(proc):
                return bool(proc(collection_name=collection_name, function=function_key))
            return bool(_process_batch_for(collection_name=collection_name, function=function_key))

        # --- per-keyword consolidation with explicit queue/process/read ---
        consolidated_bundle = []
        for kw in keywords or []:
            kw = (kw or "").strip()
            if not kw:
                continue

            per_item = self.collect_after_enqueue(collection_name=collection_name, keyword=kw, cache=cache)
            if not per_item:
                continue

            consolidated = self.consolidate_keyword_batches(
                keyword=kw,
                per_item_results=per_item,
                collection_name=collection_name,
                read=True,
                store_only=True,  # enqueue first
                cache_path=None,
            )
            if isinstance(consolidated, dict) and "keyword_analysis" in consolidated:
                consolidated_bundle.append({"keyword": kw, "keyword_analysis": consolidated["keyword_analysis"]})

        # Stable ordering for deterministic payload/custom_id
        consolidated_bundle = sorted(consolidated_bundle, key=lambda x: (x.get("keyword") or "").lower())

        # --- thematic section: enqueue, process, read ---
        # ENQUEUE
        enq = self.thematic_section_from_consolidated(
            collection_name=collection_name,
            consolidated_results=consolidated_bundle,
            read=False,
            store_only=True,
            cache=cache,
            write_cache=False,
            section_title=section_title,
        )
        # PROCESS
        if not _processor("coding_keyword_thematic_section"):
            return {"error": "processing thematic section failed", "enqueued": enq}

        # READ
        out = self.thematic_section_from_consolidated(
            collection_name=collection_name,
            consolidated_results=consolidated_bundle,  # same order → same payload/custom_id
            read=True,
            store_only=False,
            cache=cache,
            write_cache=True,
            section_title=section_title,
        )
        return out

    def consolidate_keyword_batches_html(
            self,
            collection_name: str,
            keyword: str,
            batch_html_list: list[str],
            *,
            overall_research_question: str,
            store_only: bool = True,
    ) -> str:
        """
        Phase 2 (HTML): merge batch HTML paragraphs for ONE keyword into ONE HTML block.
        ENQUEUE → PROCESS → READ using 'coding_keyword_consolidation_html'.
        """
        import hashlib

        def _processor(fn: str) -> bool:
            proc = getattr(self, "_process_batch_for", None)
            return bool(proc(collection_name=collection_name, function=fn)) if callable(proc) \
                else bool(_process_batch_for(collection_name=collection_name, function=fn))

        batch_html_list = [s for s in (batch_html_list or []) if str(s).strip()]
        if not batch_html_list:
            return ""

        # Deterministic payload
        parts = [
            f"<!-- keyword: {keyword} -->",
            f"<!-- research_question: {overall_research_question} -->",
        ]
        for i, blk in enumerate(batch_html_list, start=1):
            parts.append(f"<!-- batch: {i} -->")
            parts.append(blk.strip())
        payload = "\n".join(parts)

        cid_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
        cid = f"coding_keyword_consolidation_html::{cid_hash}"

        # ENQUEUE → PROCESS → READ
        _resp, _v = call_models(
            read=False,
            store_only=True if store_only else False,
            text=payload,
            function="coding_keyword_consolidation_html",
            collection_name=collection_name,
            custom_id=cid,
        )
        if not _processor("coding_keyword_consolidation_html"):
            return ""

        resp, _v = call_models(
            read=True,
            store_only=False,
            text=payload,
            function="coding_keyword_consolidation_html",
            collection_name=collection_name,
            custom_id=cid,
        )
        return str(resp or "")
    def _build_df_for_collection(self, collection_name: str, cache: bool = True):
        """
        Build a DataFrame for items in `collection_name` with fields used by extract_content_for_keywords:
          - key, title, year, authors, abstract, pdf_path
        Prefers direct local PDF path via `self.get_pdf_path_for_item(key)`.
        """

        rows = []
        items = self.get_all_items(collection_name=collection_name, cache=cache) or []
        for it in items:
            data = (it or {}).get("data", {})
            key = (it or {}).get("key")
            title = data.get("title", "")
            date_val = data.get("date") or data.get("year") or ""
            year = str(date_val)[:4] if date_val else ""
            creators = data.get("creators", []) or []
            authors = []
            for c in creators:
                if isinstance(c, dict):
                    if c.get("lastName") or c.get("firstName"):
                        last = (c.get("lastName") or "").strip()
                        first = (c.get("firstName") or "").strip()
                        if last and first:
                            authors.append(f"{last}, {first}")
                        else:
                            authors.append((last or first))
                    elif c.get("name"):
                        authors.append(str(c.get("name")))
            try:
                pdf_path = self.get_pdf_path_for_item(key)
            except Exception:
                pdf_path = None

            rows.append({
                "key": key,
                "title": title,
                "year": year,
                "authors": "; ".join(a for a in authors if a),
                "abstract": (data.get("abstractNote") or "").strip(),
                "pdf_path": pdf_path or "",
            })

        import pandas as pd
        return pd.DataFrame(rows, columns=["key", "title", "year", "authors", "abstract", "pdf_path"])

    def keyword_analysis_multi(
            self,
            collection_name: str,
            keywords: list[str],
            *,
            read: bool = False,
            store_only: bool = False,
            cache: bool = True,
            batch_size: int = 10,
    ) -> str:
        """
        Multi-keyword pipeline:
          1) Build a DataFrame for the collection.
          2) For each keyword:
             - Split item keys into batches of `batch_size`.
             - For each batch, call `extract_content_for_keywords` with items_map={key:[keyword]}.
             - Send batch snippets to the LLM (function: 'thematic_analaysis_keywords').
             - Consolidate batch results per keyword (function: 'thematic_analaysis_keywords_consolidation').
          3) Return a single HTML report with one <section> per keyword.

        Returns:
          HTML string for the whole report.
        """
        import  html as _html

        df = self._build_df_for_collection(collection_name=collection_name, cache=cache)

        def _chunked(seq, n):
            for i in range(0, len(seq), n):
                yield seq[i:i + n]

        def _slug(s: str) -> str:
            s = re.sub(r"[^A-Za-z0-9_.:-]+", "-", (s or "")).strip("-")
            return s.lower()[:60] or "x"

        def _render_keyword_clusters(data: dict) -> str:
            clusters = (data or {}).get("keyword_analysis")
            if not clusters:
                return "<p>No keyword instances found.</p>"
            if isinstance(clusters, dict):
                clusters = [clusters]
            elif not isinstance(clusters, list):
                return "<p>Invalid structure for keyword_analysis.</p>"

            parts = []
            for cluster in clusters:
                theme = cluster.get("theme", "Untitled Theme")
                discussion = cluster.get("discussion", "")
                support = cluster.get("support", "")
                critique = cluster.get("critique", "")
                parts.append(
                    f"""
    <section class="keyword-cluster" style="margin-bottom:2em;">
      <h3 class="theme" style="font-size:1.15em; margin-bottom:0.5em;">{_html.escape(theme)}</h3>
      <div class="discussion" style="margin-bottom:1em;">
        <strong>Discussion:</strong>
        <p>{discussion}</p>
      </div>
      <div class="support" style="margin-bottom:1em; padding-left:1em; border-left:3px solid #ccc;">
        <strong>Support:</strong>
        <blockquote>{support}</blockquote>
      </div>
      <div class="critique">
        <strong>Critique:</strong>
        <p>{critique}</p>
      </div>
    </section>
    """.strip()
                )
            return "\n".join(parts)

        # Generate a master list of item keys for batching
        item_keys = [k for k in (df.get("key") if hasattr(df, "get") else df["key"]) if k]
        final_sections = []
        total_keywords = len(keywords)

        for kw_index, kw in enumerate(keywords, start=1):
            kw_str = str(kw).strip()
            if not kw_str:
                continue

            batch_responses = []  # model responses per batch (structured)
            batch_payload_records = []  # raw snippet payloads (for consolidation prompt)

            # Split into batches of keys
            for batch_no, keys_batch in enumerate(_chunked(item_keys, max(1, int(batch_size))), start=1):
                items_map = {str(k): [kw_str] for k in keys_batch}
                res = extract_content_for_keywords(
                    full_df=df,
                    items_to_code_with_keywords_map=items_map,
                    zotero_client_instance=self,
                    globally_suggested_keywords=None,
                    progress_callback=None,
                    max_items=len(keys_batch),
                    cache=cache,
                )

                snippets = (res or {}).get("data", [])
                if not snippets:
                    continue

                # Build a compact, explicit payload for the LLM (one batch)
                lines = [f"# Keyword: {kw_str}", f"# Batch: {batch_no}", ""]
                for i, sn in enumerate(snippets, start=1):
                    src = f"{sn.get('source_bib_header', 'N/A')}: {sn.get('source_title', '')}"
                    page = sn.get("page_number")
                    kfound = sn.get("keyword_found", "")
                    para_ctx = sn.get("paragraph_context", "")
                    lines.append(f"## Snippet {i}")
                    lines.append(f"Source: {src}")
                    lines.append(f"Page: {page}")
                    lines.append(f"Matched keyword: {kfound}")
                    lines.append("Context:")
                    lines.append(para_ctx)
                    lines.append("")

                batch_payload = "\n".join(lines)
                batch_payload_records.append(batch_payload)

                # Call the batch analysis function
                response, _v = call_models(
                    read=read,
                    store_only=store_only,
                    text=batch_payload,
                    function="thematic_analaysis_keywords",
                    collection_name=collection_name,
                    custom_id=f"{kw_str}::batch::{batch_no}",
                )
                if not store_only:
                    # Expecting a structured dict the renderer can handle; fallback to empty dict if None
                    batch_responses.append(response or {})

            # If we only queued store_only calls, try the same trick used elsewhere
            if store_only:
                _process_batch_for(collection_name=collection_name, function="thematic_analaysis_keywords")

            # Consolidate per keyword (only if we have material)
            if not store_only and batch_responses:
                # Consolidation payload: keep it explicit and small
                consolidated_seed = {
                    "keyword": kw_str,
                    "batches": [{"index": i + 1, "raw_notes": batch_payload_records[i]} for i in
                                range(len(batch_payload_records))]
                }
                consolidation_payload = json.dumps(consolidated_seed, ensure_ascii=False, indent=2)

                final_resp, _v = call_models(
                    read=read,
                    store_only=False,  # consolidation needs immediate output to render
                    text=consolidation_payload,
                    function="thematic_analaysis_keywords_consolidation",
                    collection_name=collection_name,
                    custom_id=f"{kw_str}::consolidation",
                )

                section_html_core = _render_keyword_clusters(final_resp or {})
            else:
                # If no immediate responses (e.g., store_only mode), render a minimal placeholder
                section_html_core = "<p>No analysable content found or results stored for later processing.</p>"

            # Wrap as a section
            sec_id = f"kw-{_slug(kw_str)}"
            section_html = f"""
    <section id="{sec_id}" class="keyword-section" style="margin:1.5em 0;">
      <h2 style="font-size:1.35em;">Keyword: {kw_str}</h2>
      {section_html_core}
    </section>
    """.strip()
            final_sections.append(section_html)

        # Final HTML document with a mini-TOC
        if not final_sections:
            return "<article><p>No sections produced.</p></article>"

        toc_items = []
        for kw in keywords:
            if not str(kw).strip():
                continue
            toc_items.append(f'<li><a href="#kw-{_slug(str(kw))}">{_html.escape(str(kw))}</a></li>')
        toc_html = f"""
    <nav class="mini-toc" style="margin:1em 0;">
      <strong>Contents:</strong>
      <ul>
        {''.join(toc_items)}
      </ul>
    </nav>
    """.strip()
        sections_html = "\n".join(final_sections)

        final_html = f"""
    <article class="keyword-report" style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;">
      <header>
        <h1 style="font-size:1.6em; margin:0.2em 0;">Keyword Thematic Analysis</h1>
        <p style="color:#666; margin:0.2em 0;">{len(keywords)} keywords • batch size {batch_size}</p>
      </header>
      {toc_html}
      {sections_html}
    </article>
    """.strip()

        return final_html
    # if "controlled_vocabulary_terms" in properties:
    #     print("response")
    #     terms = response["controlled_vocabulary_terms"]
    #     new_tags = [{"tag": t} for t in terms if isinstance(t, str) and t.strip()]
    #     print(new_tags)
    #     print(item_key)
    #     input("jjj")
    #     continue
    # continue

    def extract_na(
            self,
            collection_name: str,
            read: bool = False,
            store_only: bool = False,
            cache: bool = False,
    ) -> bool:
        """
        For a given top-level `collection_name`:
          1) Iterate all descendant subcollections.
          2) Derive `properties` from each subcollection's name via `split("__")`.
          3) For each item in that subcollection, obtain PDF → text (unless `read=True`),
             call `call_models_na` with those `properties`, then:
             • append compact JSON into the item's `extra`
             • if 'abstract' in properties → append to `abstractNote`
             • if 'controlled_vocabulary_terms' in properties → add as Zotero tags
             • write an HTML note snippet summarising results.

        Notes:
        - Subcollection traversal uses `_get_flat_subcollections` under the top collection key.
        - Items are fetched with `get_all_items(subcollection_name, cache=...)`.
        - PDF path resolution via `get_pdf_path_for_item`.
        - Notes/updates use `append_info_note_log` and `update_zotero_item_feature`.

        Returns:
            True on completion (or after batch-queuing when `store_only=True`).
        """
        import json
        import hashlib

        from PDF_parsing.PDF_papers_parser import process_pdf  # already used elsewhere in this class

        function = "extract_NA"

        # 1) Resolve top collection key and descend through all subcollections
        parent_key = self.find_or_create_top_collection(collection_name)
        err= self.find_or_create_subcollection("err_Na",parent_key=parent_key)
        if not parent_key:
            print(f"[extract_na] Could not resolve top collection: {collection_name}")
            return False

        sub_colls = self._get_flat_subcollections(
            parent_key)
        if not sub_colls:
            print(f"[extract_na] No subcollections found under: {collection_name}")
            return False
        index =0
        # 2) Walk each subcollection
        for num,sub in enumerate(sub_colls):

            print("processing:",num)
            # if num <index:
            #     continue
            sub_name = sub["data"]["name"]

            # properties are encoded in the subcollection name, joined by "__"
            properties = [p for p in sub_name.split("__") if p.strip()]

            if not properties:
                continue  # nothing to extract for this subcollection

            # 3) Fetch items within the specific subcollection by name
            items = self.get_all_items(collection_name=sub_name, cache=cache)
            if not items:
                continue

            print(f"[extract_na] Subcollection: {sub_name} → {len(items)} items; properties={properties}")

            # 4) Process each item in this subcollection
            for idx, item in enumerate(items):
                data = item.get("data", {})
                item_key = item.get("key") or data.get("key")
                title = (data.get("title") or "").strip()
                # if sub_name=="framework_model" and idx <94:continue
                print(f"  • processing {idx + 1}/{len(items)} | {title[:80]} | key={item_key}")

                # a) pull local PDF path
                pdf_path = self.get_pdf_path_for_item(item_key)  # :contentReference[oaicite:6]{index=6}
                if not pdf_path:
                    # self.append_info_note_log(  # :contentReference[oaicite:7]{index=7}
                    #     item_key=item_key,
                    #     snippet=f"<p><strong>extract_na</strong>: no PDF found for subcollection «{sub_name}».</p>"
                    # )
                    continue

                # b) build plain text (skip when read=True; batch will be read later)
                text = ""
                if not read:
                    try:
                        if len(properties)==1 and "controlled_vocabulary_terms" in properties:
                            text = (process_pdf(pdf_path,core_sections=True) or {}).get("payload", "")
                        else:
                            text = (process_pdf(pdf_path) or {}).get("payload", "")
                    except Exception as e:
                        input("errr")
                        # self.append_info_note_log(
                        #     item_key=item_key,
                        #     snippet=f"<p><strong>extract_na</strong>: PDF parse error: {e}</p>"
                        # )
                        continue

                # c) deterministic custom_id
                seed = f"{item_key}|{sub_name}|{'__'.join(properties)}".encode("utf-8")
                custom_id = hashlib.sha256(seed).hexdigest()

                # d) LLM call (batch or live)

                response, _ = call_models_na(
                        text=text,
                        properties=properties,
                        read=read,
                        store_only=store_only,
                        custom_id=custom_id,
                        collection_name=collection_name,
                    )

                # try:
                #     replacement=generate_html_na(response)
                #     replace_note_section(zt=self,item_key=item_key,replacement_html=replacement)
                #
                #
                # except Exception as e:
                #
                #     print(e)
                #     replacement=generate_html_na(response)
                #     print(replacement)
                #
                #
                #
                #     input("err")
                #     # self.append_info_note_log(
                #     #     item_key=item_key,
                #     #     snippet=f"<p><strong>extract_na</strong>: LLM call failed: {e}</p>"
                #     # )
                #     continue

                # For batch-queuing mode, we don't mutate the Zotero item now
                if store_only:
                    continue

                # e) Update Zotero item: extra, abstract, tags
                try:
                    mini = {k: response.get(k) for k in properties if k in response}
                    extra_line = f"NA_extract::{json.dumps(mini, ensure_ascii=False)}"
                    self.update_zotero_item_feature(
                        updates={"extra": extra_line},
                        item=item_key,  # refetches latest version inside helper
                        append=True
                    )

                    # e2) abstract
                    if "abstract" in properties:
                        abstr = response.get("abstract")
                        print(f"processing {item_key}  and updating abs:{abstr}")
                        if isinstance(abstr, str) and abstr.strip():
                            self.update_zotero_item_feature(
                                updates={"abstractNote": abstr},
                                item=item_key,  # refetch again
                                append=True
                            )

                    # e3) controlled vocabulary → Zotero tags
                    if "controlled_vocabulary_terms" in properties:
                        terms = response.get("controlled_vocabulary_terms") or []
                        if isinstance(terms, list) and terms:
                            new_tags = [{"tag": t.strip()} for t in terms if isinstance(t, str) and t.strip()]
                            print(f"processing {item_key}  and updating tags:{new_tags}")
                            if new_tags:
                                self.update_zotero_item_feature(
                                    updates={"tags": new_tags},
                                    item=item_key,  # refetch again
                                    append=True
                                )


                except Exception as e:
                    print("error,",e)
                    input("extra_na")
                    # self.append_info_note_log(
                    #     item_key=item_key,
                    #     snippet=f"<p><strong>extract_na</strong>: failed to update item fields: {e}</p>"
                    # )

                # f) Create a human-readable HTML note
                try:
                    # If the schema uses {value, discussion, support, critique}, format via generate_html
                    # Expected shape: {prop: {"value":..., "discussion":..., "support":..., "critique":...}, ...}
                    code_evidence = {
                        p: response.get(p)
                        for p in properties
                        if isinstance(response.get(p), dict)  # only include rich objects
                    }
                    if code_evidence:
                        snippet_html = generate_html({"code_evidence": code_evidence})
                    else:
                        snippet_html = f"<pre>{json.dumps(response, ensure_ascii=False, indent=2)}</pre>"

                    header = f"<h3>NA Extract — {sub_name}</h3>"
                    self.append_info_note_log(item_key=item_key, snippet=header + "\n" + snippet_html)
                except Exception as e:
                    self.append_info_note_log(
                        item_key=item_key,
                        snippet=f"<p><strong>extract_na</strong>: failed to render HTML snippet: {e}</p>"
                    )

        # 7) If we only queued requests, trigger batch processing + follow-up
        if store_only:
            try:
                if _process_batch_for(collection_name=collection_name, function=function):
                    # downstream step per your pipeline (reads completed batch results)
                    self.extract_entity_affiliation(collection_name=collection_name, store_only=False, read=True)
            except Exception as e:
                print(f"[extract_na] batch follow-up failed: {e}")

        return True

    def extract_na_flat(
            self,
            collection_name: str,
            read: bool = False,
            store_only: bool = False,
            cache: bool = False,
            property: list[str] = None,
    ) -> bool:
        """
        Variant of extract_na that skips subcollection traversal.
        Instead, the user supplies the `property` list directly.

        Steps:
          1) Fetch all items in the given `collection_name`.
          2) For each item, obtain PDF → text (unless `read=True`).
          3) Call `call_models_na` with the given `property`.
          4) Update Zotero item (extra, abstract, tags).
          5) Append HTML note summarising results.

        Returns:
            True on completion (or after queuing when store_only=True).
        """
        import json, hashlib
        from PDF_parsing.PDF_papers_parser import process_pdf

        function = "extract_NA"
        parent_key = self.find_or_create_top_collection(collection_name)
        errs_key = self.find_or_create_subcollection(subcoll_name=collection_name+"_err_Na",parent_key=parent_key)

        if not parent_key:
            print(f"[extract_na_flat] Could not resolve collection: {collection_name}")
            return False

        if not property:
            print("[extract_na_flat] No property provided, aborting.")
            return False

        # 1) Get all items in the top collection
        items = self.get_all_items(collection_name=collection_name, cache=cache)
        if not items:
            print(f"[extract_na_flat] No items found in {collection_name}")
            return False

        for idx, item in enumerate(items):
            data = item.get("data", {})
            item_key = item.get("key") or data.get("key")
            abstract = data.get("abstractNote", "")

            title = (data.get("title") or "").strip()
            print(f"  • processing {idx + 1}/{len(items)} | {title[:80]} | key={item_key}")

            # a) PDF path
            pdf_path = self.get_pdf_path_for_item(item_key)
            if not pdf_path and not abstract:

                continue

            # b) Extract text (unless read=True)
            text = ""
            if not read and pdf_path:
                try:

                    if len(property) == 1 and "controlled_vocabulary_terms" in property:
                        text =f"abstract:{abstract}\n\nTEXT:\n"+ (process_pdf(pdf_path, core_sections=True) or {}).get("payload", "")

                    else:
                        text =f"abstract:{abstract}\n\nTEXT:\n"+ (process_pdf(pdf_path, core_sections=True) or {}).get("payload", "")
                except Exception as e:
                    print(f"[extract_na_flat] PDF parse error: {e}")
                    continue
            else:
                text = f"abstract:{abstract}\n\nmetadata:{self.generate_metadata(item_key=item_key)}"

            # c) Deterministic custom_id
            seed = f"{item_key}|{collection_name}|{'__'.join(property)}".encode("utf-8")
            custom_id = hashlib.sha256(seed).hexdigest()

            # d) LLM call
            response, _ = call_models_na(
                text=text,
                properties=property,
                read=read,
                store_only=store_only,
                custom_id=custom_id,
                collection_name=collection_name,
            )

            if store_only:
                continue

            # e) Update Zotero fields
            try:
                mini = {k: response.get(k) for k in property if k in response}
                extra_line = f"NA_extract::{json.dumps(mini, ensure_ascii=False)}"
                self.update_zotero_item_feature(
                    updates={"extra": extra_line},
                    item=item_key,
                    append=True,
                )

                if "abstract" in property:
                    abstr = response.get("abstract")
                    if isinstance(abstr, str) and abstr.strip():
                        self.update_zotero_item_feature(
                            updates={"abstractNote": abstr},
                            item=item_key,
                            append=True,
                        )

                if "controlled_vocabulary_terms" in property:
                    terms = response.get("controlled_vocabulary_terms") or []
                    if isinstance(terms, list) and terms:
                        new_tags = [{"tag": t.strip()} for t in terms if isinstance(t, str) and t.strip()]
                        if new_tags:
                            self.update_zotero_item_feature(
                                updates={"tags": new_tags},
                                item=item_key,
                                append=True,
                            )
            except Exception as e:
                print(f"[extract_na_flat] Update failed: {e}")

            # f) Human-readable HTML note
            try:
                code_evidence = {
                    p: response.get(p)
                    for p in property
                    if isinstance(response.get(p), dict)
                }
                if code_evidence:
                    snippet_html = generate_html({"code_evidence": code_evidence})
                else:
                    snippet_html = f"<pre>{json.dumps(response, ensure_ascii=False, indent=2)}</pre>"
                header = f"<h3>NA Extract — {collection_name}</h3>"
                self.append_info_note_log(item_key=item_key, snippet=header + "\n" + snippet_html)
            except Exception as e:
                self.append_info_note_log(
                    item_key=item_key,
                    snippet=f"<p><strong>extract_na_flat</strong>: failed to render HTML snippet: {e}</p>",
                )

        # Batch follow-up
        if store_only:
            try:
                if _process_batch_for(collection_name=collection_name, function=function):
                    self.extract_entity_affiliation(collection_name=collection_name, store_only=False, read=True)
            except Exception as e:
                print(f"[extract_na_flat] batch follow-up failed: {e}")

        return True
    def extract_entity_affiliation(self,collection_name,read=False,store_only=False, cache=False):

        function = "paper_affiliation_and_entities"
        loop =False

        items = self.get_all_items(collection_name, cache=cache)
        for index, item in enumerate(items):
            data = item.get("data")
            print("processing index:",index)
            item_key = item.get("key")

            pdf = self.get_pdf_path_for_item(item_key)
            text=""


            if not read:
                text = process_pdf(pdf)["payload"]


            response, v = call_models(
                read=read, store_only=store_only,
                text=text, function=function, collection_name=collection_name, custom_id=item_key)


            if store_only:
                continue
            import json
            from html import escape

            # Ensure dict
            if isinstance(response, str):
                try:
                    response = json.loads(response)
                except json.JSONDecodeError:
                    response = {}

            ae = (response or {}).get("affiliation_and_entities") or {}
            affiliations_raw = ae.get("affiliation") or []
            entities_raw = ae.get("entities_mentioned") or []

            # Normalise affiliations: accept only dicts with the three keys; coerce missing to ""
            affiliations = []
            for a in affiliations_raw:
                if isinstance(a, dict):
                    dept = (a.get("department") or "").strip()
                    inst = (a.get("institution") or "").strip()
                    country = (a.get("country") or "").strip()
                    # keep only if at least institution is present (schema requires all; tolerate blanks)
                    affiliations.append({
                        "department": dept,
                        "institution": inst,
                        "country": country
                    })
                elif isinstance(a, str) and a.strip():
                    # very rare with your schema; fallback: place into institution
                    affiliations.append({
                        "department": "",
                        "institution": a.strip(),
                        "country": ""
                    })

            # Dedupe entities by literal text (case-insensitive), preserve first occurrence
            seen = set()
            entities = []
            for e in entities_raw:
                if not isinstance(e, dict):
                    continue
                text_val = (e.get("text") or "").strip()
                type_val = (e.get("type") or "").strip()
                if not text_val:
                    continue
                key = text_val.lower()
                if key in seen:
                    continue
                seen.add(key)
                entities.append({"text": text_val, "type": type_val})

            # Build plain-text "extra" (key=value per line)
            lines = []

            if affiliations:
                for aff in affiliations:
                    dept = aff.get("department", "")
                    inst = aff.get("institution", "")
                    country = aff.get("country", "")
                    parts = []
                    if dept:
                        parts.append(f"Department={dept}")
                    if inst:
                        parts.append(f"Institution={inst}")
                    if country:
                        parts.append(f"Country={country}")
                    line = "Affiliation: " + ", ".join(parts) if parts else "Affiliation: "
                    lines.append(line)
            else:
                lines.append("Affiliation: None")

            if entities:
                for ent in entities:
                    lines.append(f"Entity: {ent['text']} – {ent['type']}")
            else:
                lines.append("Entities: None")

            extra = "\n".join(lines)

            # Build Markdown snippet (your preferred format)
            md_lines = []
            md_lines.append("## Affiliations & Entities")
            md_lines.append("")
            md_lines.append("### Affiliation")
            md_lines.append("")
            if affiliations:
                for aff in affiliations:
                    fields = [x for x in [aff["department"], aff["institution"], aff["country"]] if x]
                    md_lines.append(f"- {' – '.join(fields) if fields else 'None'}")
                    md_lines.append("")
            else:
                md_lines.append("- None")
                md_lines.append("")

            md_lines.append("### Entities Mentioned")
            md_lines.append("")
            if entities:
                for ent in entities:
                    md_lines.append(f"- {ent['text']} – {ent['type']}")
                    md_lines.append("")
            else:
                md_lines.append("- None")
                md_lines.append("")

            markdown_snippet = "\n".join(md_lines).strip()

            # Build HTML snippet for Zotero notes
            variable_snippet = ["<h2>Affiliations &amp; Entities</h2>"]

            variable_snippet.append("<h3>Affiliation</h3>")
            variable_snippet.append("<ul>")
            if affiliations:
                for aff in affiliations:
                    parts = [p for p in [aff["department"], aff["institution"], aff["country"]] if p]
                    variable_snippet.append(f"<li>{escape(' – '.join(parts) if parts else 'None')}</li>")
            else:
                variable_snippet.append("<li>None</li>")
            variable_snippet.append("</ul>")

            variable_snippet.append("<h3>Entities Mentioned</h3>")
            variable_snippet.append("<ul>")
            if entities:
                for ent in entities:
                    variable_snippet.append(f"<li>{escape(ent['text'])} – {escape(ent['type'])}</li>")
            else:
                variable_snippet.append("<li>None</li>")
            variable_snippet.append("</ul>")

            html_snippet = "\n".join(variable_snippet)
            self.append_info_note_log(snippet=html_snippet, item_key=item_key)

            # self.update_zotero_item_feature(
            #     updates={"extra": extra},append=False,
            #     item=self.zot.item(item_key),
            # )

        if store_only:

            if _process_batch_for(collection_name=collection_name,
                                  function=function,
                                  ):
                self.extract_entity_affiliation(collection_name=collection_name, store_only=False, read=True)
        return True

    def _parse_codes_note_html(self, html_content: str) -> Dict[str, Any]:
        """Extracts key/value/discussion/support/critique from a Note_Codes note HTML."""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_content or "", "html.parser")
        code_evidence = {}
        for article in soup.find_all("article"):
            code_name_tag = article.find("h2")
            if not code_name_tag:
                continue
            code_name = code_name_tag.get_text(strip=True)
            code_data = {}
            # value
            val_tag = article.find("h3")
            if val_tag:
                code_data["value"] = val_tag.get_text(strip=True).replace("value: ", "")
            # discussion
            disc_tag = article.find("h4", string=lambda s: s and s.lower() == "discussion")
            if disc_tag:
                p = disc_tag.find_next_sibling("p")
                if p:
                    code_data["discussion"] = p.get_text(strip=True)
            # support
            supp_tag = article.find("h4", string=lambda s: s and s.lower() == "support")
            if supp_tag:
                bq = supp_tag.find_next_sibling("blockquote")
                if bq:
                    code_data["support"] = bq.get_text(strip=True)
            # critique
            crit_tag = article.find("h4", string=lambda s: s and s.lower() == "critique")
            if crit_tag:
                p = crit_tag.find_next_sibling("p")
                if p:
                    code_data["critique"] = p.get_text(strip=True)
            code_evidence[code_name] = code_data
        return code_evidence

    # code to be replaced
    # def get_item_payload(self, item_key: str) -> Dict[str, Any]:
    #     ...
    #     return {...}
    def get_item_payload(self, item_key: str) -> Dict[str, Any]:
        """
        STRICT parsing with explicit sources + missing-values accounting.

        Rules:
          • Tags come from the *item* (not attachments/children).
          • Coding/Evidence comes ONLY from notes tagged 'Note_Codes' (ignore any <h2>Coding</h2> inside payload notes).
          • 'summary' has THREE main keys:
              - 'payload_note':   data parsed from non-code notes (counts, affiliation_entities, urls, related_work, attachments)
              - 'Note_code':      flat coding dict from Note_Codes ('key': 'v1, v2')
              - 'missing_values': {'count': int, 'values': [..]} over the required keys listed below
          • 'codes' (top-level) is a snake_case dict of full evidence per code:
              { value, discussion, support, critique } — rebuilt from Note_Codes only.

        Extra behavior:
          • If citation_count is missing in payload notes, parse the item's .data.extra with parse_citation_count() and take the highest.
          • For counts (page_count, word_count_for_attribution, citation_count), keep the highest seen across notes/fallbacks.
          • If payload places are empty, try item-level fields (place/eventPlace/publisherPlace).
          • Derive 'country' from entities containing ' - Country' or ' – Country' suffix.
        """
        import re
        from typing import Dict, Any

        try:
            from bs4 import BeautifulSoup
        except Exception as e:
            raise RuntimeError("BeautifulSoup4 is required to parse Zotero notes.") from e

        # Try to import the shared citation parser; fallback to a local one if import fails
        try:
            from .data_processing import parse_citation_count  # type: ignore
        except Exception:
            def parse_citation_count(extra_str: str | None) -> int:
                if not isinstance(extra_str, str):
                    return 0
                patterns = [
                    r'([\d,]+)\s+citations?\b',
                    r'Cited\s+by\s*:\s*([\d,]+)',
                    r'([\d,]+)\s*\(\s*(?:Scopus|WoS|Web of Science|Crossref|Semantic Scholar|Google Scholar|PubMed|DOI|ESCI|SSCI|AHCI|SCI)\s*\)',
                ]
                for pat in patterns:
                    try:
                        raw_matches = re.findall(pat, extra_str, flags=re.IGNORECASE)
                    except re.error:
                        continue
                    if raw_matches:
                        vals = []
                        for m in raw_matches:
                            num = m.replace(",", "")
                            if num.isdigit():
                                vals.append(int(num))
                        if vals:
                            return max(vals)
                return 0

        # ------------------------- helpers -------------------------
        def _merge_lists_unique(dst: list, src: list) -> list:
            seen = {str(x).strip().lower() for x in dst}
            for v in src or []:
                sv = str(v).strip()
                if sv and sv.lower() not in seen:
                    dst.append(sv)
                    seen.add(sv.lower())
            return dst

        def _to_int_safe(x):
            try:
                return int(re.findall(r"\d+", str(x))[0])
            except Exception:
                return None

        def _snake(s: str) -> str:
            s = (s or "").replace("/", " ").replace("-", " ")
            return "_".join([w for w in s.strip().lower().split() if w])

        def _parse_payload_note_html(html: str) -> Dict[str, Any]:
            """
            Extract non-code fields from a payload note. Ignore any <h2>Coding</h2> blocks.
            Returns:
              {
                'place': [..],
                'affiliations': [..],
                'entities': [..],
                'related_work': [..],
                'urls': {'pdf_primary': str|None, 'all': [..]},
                'metadata': {'sources':[...], 'page_count': int|None,
                             'word_count_for_attribution': int|None, 'citation_count': int|None}
              }
            """
            soup = BeautifulSoup(html or "", "html.parser")
            out = {
                "place": [],
                "affiliations": [],
                "entities": [],
                "related_work": [],
                "urls": {"pdf_primary": None, "all": []},
                "metadata": {
                    "sources": [],
                    "page_count": None,
                    "word_count_for_attribution": None,
                    "citation_count": None,
                },
            }

            def _collect_list_text(node):
                vals = []
                if node is None:
                    return vals
                for li in node.find_all("li"):
                    t = li.get_text(" ", strip=True)
                    if t:
                        vals.append(t)
                for p in node.find_all("p", recursive=False):
                    t = p.get_text(" ", strip=True)
                    if t:
                        vals.append(t)
                return vals

            # Walk through <h3> sections (skipping any named "Coding")
            for h3 in soup.find_all("h3"):
                name = (h3.get_text(strip=True) or "").lower()
                if name == "coding":
                    continue

                if name == "urls":
                    for h4 in h3.find_all_next("h4"):
                        if any(getattr(s, "name", None) == "h3" for s in h4.previous_siblings):
                            break
                        h4name = (h4.get_text(strip=True) or "").lower()
                        items = _collect_list_text(h4.find_next_sibling() or h4.parent)
                        if "pdf / primary link" in h4name and items:
                            out["urls"]["pdf_primary"] = items[0]
                        out["urls"]["all"] = _merge_lists_unique(out["urls"]["all"], items)
                    continue

                if name == "metadata":
                    for h4 in h3.find_all_next("h4"):
                        if any(getattr(s, "name", None) == "h3" for s in h4.previous_siblings):
                            break
                        h4name = (h4.get_text(strip=True) or "").lower()
                        items = _collect_list_text(h4.find_next_sibling() or h4.parent)
                        if "source" in h4name:
                            out["metadata"]["sources"] = _merge_lists_unique(out["metadata"]["sources"], items)
                    continue

                if "page count" in name:
                    vals = _collect_list_text(h3.find_next_sibling() or h3.parent)
                    pc = _to_int_safe(vals[0]) if vals else None
                    if pc is not None:
                        out["metadata"]["page_count"] = pc
                    continue

                if "word count for attribution" in name:
                    vals = _collect_list_text(h3.find_next_sibling() or h3.parent)
                    wca = _to_int_safe(vals[0]) if vals else None
                    if wca is not None:
                        out["metadata"]["word_count_for_attribution"] = wca
                    continue

                if "citation" in name:
                    vals = _collect_list_text(h3.find_next_sibling() or h3.parent)
                    cc = _to_int_safe(vals[0]) if vals else None
                    if cc is not None:
                        out["metadata"]["citation_count"] = cc
                    continue

                if "affiliations & entities" in name or "affiliations &amp; entities" in name:
                    for h4 in h3.find_all_next("h4"):
                        if any(getattr(s, "name", None) == "h3" for s in h4.previous_siblings):
                            break
                        h4name = (h4.get_text(strip=True) or "").lower()
                        items = _collect_list_text(h4.find_next_sibling() or h4.parent)
                        if "affiliation" in h4name:
                            out["affiliations"] = _merge_lists_unique(out["affiliations"], items)
                        elif "entities mentioned" in h4name:
                            out["entities"] = _merge_lists_unique(out["entities"], items)
                    continue

                if name == "affiliations":
                    items = _collect_list_text(h3.find_next_sibling() or h3.parent)
                    out["affiliations"] = _merge_lists_unique(out["affiliations"], items)
                    continue

                if name == "place":
                    items = _collect_list_text(h3.find_next_sibling() or h3.parent)
                    out["place"] = _merge_lists_unique(out["place"], items)
                    continue

                if "related" in name:
                    items = _collect_list_text(h3.find_next_sibling() or h3.parent)
                    out["related_work"] = _merge_lists_unique(out["related_work"], items)
                    continue

            # Also accept <h4>Place/Affiliation> variants
            for h4 in soup.find_all("h4"):
                nm = (h4.get_text(strip=True) or "").lower()
                items = _collect_list_text(h4.find_next_sibling() or h4.parent)
                if "place" in nm:
                    out["place"] = _merge_lists_unique(out["place"], items)
                elif "affiliation" in nm:
                    out["affiliations"] = _merge_lists_unique(out["affiliations"], items)

            return out

        # ------------------------- collect notes -------------------------
        children = self.zot.children(item_key) or []
        code_notes_html = []  # ONLY notes tagged 'Note_Codes'
        payload_notes_html = []  # other notes (payload)
        child_keys = []

        for ch in children:
            child_keys.append(ch.get("key"))
            data = ch.get("data", {}) or {}
            if data.get("itemType") != "note":
                continue
            html = data.get("note", "") or ""
            note_tags = [t.get("tag") for t in (data.get("tags") or []) if isinstance(t, dict)]
            if "Note_Codes" in note_tags:
                code_notes_html.append(html)
            else:
                payload_notes_html.append(html)

        # ------------------------- parse Note_Codes -------------------------
        # Full evidence dict (snake_case): { value, discussion, support, critique }
        evidence_by_code: Dict[str, Dict[str, str]] = {}
        # Flat coding (snake_case -> "v1, v2")
        coding_flat: Dict[str, str] = {}

        for html in code_notes_html:
            try:
                block = self._parse_codes_note_html(html) or {}
            except Exception as e:
                logging.debug("Note_Codes parse failed for %s: %s", item_key, e)
                block = {}
            for code_name, evid in block.items():
                if not code_name:
                    continue
                snake = _snake(code_name)

                # merge evidence
                merged = dict(evidence_by_code.get(snake, {}))
                for k in ("value", "discussion", "support", "critique"):
                    v = (evid or {}).get(k)
                    if v:
                        merged[k] = v
                evidence_by_code[snake] = merged

                # value -> flat string
                val = (evid or {}).get("value", "")
                if isinstance(val, list):
                    val_str = ", ".join([s.strip() for s in val if str(s).strip()])
                elif isinstance(val, str):
                    parts = [p.strip() for p in re.split(r"[;\n,]", val) if p and p.strip()]
                    val_str = ", ".join(parts) if parts else ""
                else:
                    val_str = ""
                if val_str:
                    coding_flat[snake] = val_str

        # ------------------------- parse payload notes -------------------------
        # Aggregate across all payload notes (keep highest counts)
        payload_place: list[str] = []
        payload_affiliations: list[str] = []
        payload_entities: list[str] = []
        payload_related: list[str] = []
        payload_urls_all: list[str] = []
        payload_pdf_primary: str | None = None
        agg_page_count: int | None = None
        agg_wca: int | None = None
        agg_citations: int | None = None

        for html in payload_notes_html:
            try:
                p = _parse_payload_note_html(html)
            except Exception as e:
                logging.debug("Payload note parse failed for %s: %s", item_key, e)
                continue

            payload_place = _merge_lists_unique(payload_place, p.get("place", []))
            payload_affiliations = _merge_lists_unique(payload_affiliations, p.get("affiliations", []))
            payload_entities = _merge_lists_unique(payload_entities, p.get("entities", []))
            payload_related = _merge_lists_unique(payload_related, p.get("related_work", []))

            urls = p.get("urls", {}) or {}
            if urls.get("pdf_primary") and not payload_pdf_primary:
                payload_pdf_primary = urls["pdf_primary"]
            payload_urls_all = _merge_lists_unique(payload_urls_all, urls.get("all", []))

            md = p.get("metadata", {}) or {}
            pc = md.get("page_count")
            if isinstance(pc, int):
                agg_page_count = max(agg_page_count, pc) if isinstance(agg_page_count, int) else pc
            wca = md.get("word_count_for_attribution")
            if isinstance(wca, int):
                agg_wca = max(agg_wca, wca) if isinstance(agg_wca, int) else wca
            cc = md.get("citation_count")
            if isinstance(cc, int):
                agg_citations = max(agg_citations, cc) if isinstance(agg_citations, int) else cc

        # Fallback: if no citations from notes, parse the item's extra and take the highest
        try:
            item_obj = self.zot.item(item_key) or {}
            item_data = item_obj.get("data", {}) or {}
        except Exception:
            item_data = {}

        if not isinstance(agg_citations, int):
            extra_str = item_data.get("extra", "")
            parsed_cites = parse_citation_count(extra_str)
            if parsed_cites > 0:
                agg_citations = parsed_cites

        # Fallback for place from item-level fields
        if not payload_place:
            fallback_places = []
            for k in ("place", "eventPlace", "publisherPlace"):
                v = item_data.get(k)
                if isinstance(v, list):
                    fallback_places.extend([str(x).strip() for x in v if str(x).strip()])
                elif v and str(v).strip():
                    fallback_places.append(str(v).strip())
            payload_place = _merge_lists_unique(payload_place, fallback_places)

        # Derive countries from entities that end with " - Country"/" – Country"
        payload_countries: list[str] = []
        for ent in payload_entities:
            s = str(ent)
            if s.endswith(" - Country") or s.endswith(" – Country"):
                name = s.rsplit(" - ", 1)[0].rsplit(" – ", 1)[0]
                nm = name.strip()
                if nm:
                    payload_countries = _merge_lists_unique(payload_countries, [nm])

        # ------------------------- attachments -------------------------
        attachments = self._attachments_from_children(children)

        # ------------------------- tags from item only -------------------------
        item_tags = [t.get("tag") for t in (item_data.get("tags") or []) if isinstance(t, dict) and t.get("tag")]
        filter_tags = ["core", "included", "note", "keyword", "inclusion", "test", "abs", "added", "origin", "records"]
        clean_tags = [
            tag.lower() for tag in item_tags
            if tag and not any(sub.lower() in tag.lower() for sub in filter_tags)
        ]

        # ------------------------- build summary -------------------------
        summary: Dict[str, Any] = {
            "payload_note": {
                "counts": {
                    "page_count": agg_page_count,
                    "word_count_for_attribution": agg_wca,
                    "citation_count": agg_citations,
                },
                "affiliation_entities": {
                    "place": payload_place,
                    "country": payload_countries,
                    "affiliations": payload_affiliations,
                    "entities": payload_entities,
                },
                "urls": {
                    "pdf_primary": payload_pdf_primary,
                    "all": payload_urls_all,
                },
                "related_work": payload_related,
                "attachments": attachments,  # include here for convenience
            },
            "Note_code": coding_flat,  # snake_case -> "v1, v2"
            "missing_values": {  # filled below
                "count": 0,
                "values": [],
            },
        }

        # ------------------------- missing-values audit -------------------------
        # Required keys to check. 'affiliation' is checked from payload_note.affiliation_entities.affiliations.
        required_keys = [
            "affiliation",
            "theoretical_orientation",
            "ontology",
            "epistemology",
            "argumentation_logic",
            "evidence_source_base",
            "methods",
            "method_type",
            "framework_model",
            "contribution_type",
            "attribution_lens_focus",
            "research_question_purpose",
        ]

        missing_list: list[str] = []

        # 1) affiliation from payload
        affs = summary["payload_note"]["affiliation_entities"].get("affiliations") or []
        if not any(str(a).strip() for a in affs):
            missing_list.append("affiliation")

        # 2) coding keys from Note_code
        for key in required_keys:
            if key == "affiliation":
                continue
            val = summary["Note_code"].get(key, "")
            if not isinstance(val, str) or not val.strip():
                missing_list.append(key)

        # Deduplicate and finalize
        if missing_list:
            # preserve given order while deduping
            seen = set()
            unique = []
            for m in missing_list:
                if m not in seen:
                    unique.append(m)
                    seen.add(m)
            summary["missing_values"]["values"] = unique
            summary["missing_values"]["count"] = len(unique)

        # ------------------------- return payload -------------------------
        return {
            "summary": summary,
            "attachments": attachments,  # also returned at top-level for backward compatibility
            "tags": sorted(clean_tags),
            "child_keys": child_keys,
            "codes": evidence_by_code or None,
        }

    def paper_coding(self, collection_name=None, read=False, store_only=False,items_keys=None):
        base_function = "paper_coding"
        function1 = base_function + "1"
        function2 = base_function + "2"
        items=[]
        if items_keys:
            collection_name = "_".join(items_keys)
            for key in items_keys:
               items.append(self.zot.item(key))
        else:
            items = self.get_all_items(collection_name, cache=True)
        for index, item in enumerate(items):
            data = item.get("data", {})
            item_key = item.get("key")
            pdf = self.get_pdf_path_for_item(item_key)

            extra_core = data.get("extra", "") or ""
            extra = extra_core.replace(parse_citation_count_line(extra_core), "")

            text = ""
            if not read:
                try:
                    text =process_pdf(pdf_path=pdf,core_sections=False)["payload"]
                except Exception:
                    text = ""
            print(text)
            author = [
                (f"{a['firstName']} {a['lastName']}" if 'firstName' in a and 'lastName' in a else a.get('name',
                                                                                                        '')).strip()
                for a in data.get('creators', [])
            ]
            author = [a for a in author if a]

            payload = f"\npaper_text:\n{text}\n\ncodes_list:\n{extra}\n\nauthor:{author}"

            # queue both batches
            resp1, _ = call_models(
                read=read, store_only=store_only,
                text=payload, function=function1,
                collection_name=collection_name, custom_id=item_key
            )
            resp2, _ = call_models(
                read=read, store_only=store_only,
                text=payload, function=function2,
                collection_name=collection_name, custom_id=item_key
            )

            if store_only:
                continue

            # READ path → fetch both and merge
            r1 =resp1
            r2 = resp2
            merged = merge_code_evidence(r1, r2)
            if not merged.get("code_evidence"):
                continue

            html = generate_html(merged)
            try:
                self.create_one_note(content=html, item_id=item_key, tag="Note_Codes")
            except Exception as e:
                print(f"[paper_coding] Failed to create note for {item_key}: {e}")
        if store_only:
            # wait for BOTH to complete, then do a read pass
            if _process_batches_for(
                    functions=[function1, function2],
                    collection_name=collection_name,
                    completion_window="24h",
                    poll_interval=30
            ):
                # on completion, re-run to read outputs and write the note
                self.paper_coding(collection_name=collection_name, store_only=False, read=True)
        return True

    def _append_to_tagged_note(self, item_key: str, snippet: str, tag: str) -> bool:
        """
        Append `snippet` to a child note tagged `tag`.
        If none exists, create it. Deduplicate by substring match.
        Returns True if content was written or created; False if skipped (duplicate or error).
        """
        if not isinstance(snippet, str) or not snippet.strip():
            return False

        try:
            children = self.zot.children(item_key)
        except Exception:
            return False

        # find an existing note carrying the desired tag
        tagged_notes = [
            c for c in children
            if c.get("data", {}).get("itemType") == "note"
               and any(t.get("tag") == tag for t in c.get("data", {}).get("tags", []))
        ]

        if tagged_notes:
            note_child = tagged_notes[0]
            old_html = note_child["data"].get("note", "") or ""
            if snippet in old_html:
                return False  # dedup
            tags = note_child["data"].get("tags", []) or []
            if not any(t.get("tag") == tag for t in tags):
                tags.append({"tag": tag})
            new_content = old_html + snippet
            update_note_zotero(note_child, tags, new_content, self.zot)
            return True

        # create a new note with the specified tag
        note_item = {
            "itemType": "note",
            "parentItem": item_key,
            "note": snippet,
            "tags": [{"tag": tag}],
        }
        try:
            self.zot.create_items([note_item])
            return True
        except Exception:
            return False

    def move_affiliations_entities_to_payload(self,
                                              collection_name: str,
                                              tag_source: str = "keyword_analysis:attribution",
                                              tag_target: str = "payload_note",
                                              dry_run: bool = False) -> dict:
        """
        For each item in `collection_name`, locate the child note tagged `tag_source`,
        extract the block starting at <h2>Affiliations & Entities</h2> (inclusive) up to
        the next <h2> or end-of-note, append that block verbatim to the note tagged
        `tag_target` (creating one if absent), then remove the block from the source note.

        Returns a dict summary.
        """
        from bs4 import BeautifulSoup

        def _extract_affiliations_entities_block(html: str, require_h3: bool = True) -> tuple[str | None, str]:
            """
            Extract the block starting at <h2>Affiliations & Entities</h2> up to (but not including) the next <h2>.
            If `require_h3` is True (default), only extract when an <h3> immediately under that section exists
            (e.g., <h3>Entities Mentioned</h3>). If such an <h3> is not found, return (None, original_html) and ignore.

            Returns:
                (block_html, remaining_html)
                block_html is None if the anchor h2 is absent OR (require_h3 and no qualifying h3 exists).
            """
            if not html:
                return None, html or ""

            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "html.parser")

            # 1) Locate the anchor <h2>
            anchor = None
            for h2 in soup.find_all("h2"):
                if h2.get_text(" ", strip=True).casefold() == "affiliations & entities":
                    anchor = h2
                    break
            if anchor is None:
                return None, html  # no section -> ignore

            # 2) Scan siblings until next <h2>, check for a qualifying <h3>
            collected = [anchor]
            saw_h3 = False
            for sib in anchor.find_next_siblings():
                name = (getattr(sib, "name", "") or "").lower()
                if name == "h2":
                    break
                if name == "h3":
                    # Require an <h3> under this section (e.g., "Entities Mentioned").
                    # We accept any <h3> if require_h3=True; tighten if you want exact label matching.
                    saw_h3 = True
                collected.append(sib)

            # 3) If require_h3 and none was found, ignore this section
            if require_h3 and not saw_h3:
                return None, html

            # 4) Build extracted HTML and remove from original
            block_html = "".join(str(n) for n in collected)
            for n in collected:
                try:
                    n.decompose()
                except Exception:
                    pass

            remaining_html = str(soup)
            return block_html, remaining_html

        results = []
        touched = 0
        created_targets = 0
        skipped_no_source = 0
        skipped_no_block = 0
        append_dedup_skips = 0

        items = self.get_all_items(collection_name=collection_name)  # direct children of this collection
        for it in items:
            item_key = it.get("key")
            try:
                children = self.zot.children(item_key)
            except Exception as e:
                results.append({"item_key": item_key, "error": f"children fetch failed: {e}"})
                continue

            # locate first source note with tag_source
            src_notes = [
                ch for ch in children
                if ch.get("data", {}).get("itemType") == "note"
                   and any(t.get("tag") == tag_source for t in ch.get("data", {}).get("tags", []))
            ]
            if not src_notes:
                skipped_no_source += 1
                results.append({"item_key": item_key, "action": "skip", "reason": "no source note"})
                continue

            src = src_notes[0]
            src_html = src["data"].get("note", "") or ""

            block_html, remaining_html = _extract_affiliations_entities_block(src_html)
            if not block_html:
                skipped_no_block += 1
                results.append(
                    {"item_key": item_key, "action": "skip", "reason": "no <h2>Affiliations & Entities</h2> block"})
                continue

            appended = True
            created_now = False
            if not dry_run:
                # use tag_target here (was previously ignored)
                before_notes = len([c for c in children if c.get("data", {}).get("itemType") == "note"])
                appended = self._append_to_tagged_note(item_key=item_key, snippet=block_html, tag=tag_target) \
                    if hasattr(self, "_append_to_tagged_note") else None
                after_notes = len(
                    [c for c in self.zot.children(item_key) if c.get("data", {}).get("itemType") == "note"])
                created_now = (after_notes > before_notes)
            else:
                appended = True  # simulate

            if appended:
                if not dry_run:
                    tags = src["data"].get("tags", []) or []
                    update_note_zotero(src, tags, remaining_html, self.zot)
                    touched += 1
                    if created_now:
                        created_targets += 1
                results.append({"item_key": item_key, "action": "moved", "created_target_note": created_now,
                                "target_tag": tag_target})
            else:
                append_dedup_skips += 1
                results.append(
                    {"item_key": item_key, "action": "skip", "reason": "deduplication or create_items failed"})

        summary = {
            "collection": collection_name,
            "processed_items": len(items),
            "moved_blocks": touched,
            "created_target_notes": created_targets,
            "skipped_no_source_note": skipped_no_source,
            "skipped_no_affiliations_block": skipped_no_block,
            "skipped_dedup_or_create_fail": append_dedup_skips,
            "details": results,
        }
        return summary

    def export_collection_to_csv(self, collection_name: str, cols_list: list[str], csv_path: str) -> str:
        """
        Export items from a Zotero collection to CSV with fixed columns plus tag-derived dynamic columns.

        Parameters:
            collection_name: Name of the Zotero collection to export.
            cols_list: Dynamic columns to derive from tags, e.g., ["theme", "affiliation", "phase_focus_value"].
                       Matching rule: any tag that, after stripping leading '#', starts with "<col>:" will be captured.
                       The cell value is a comma-separated list of matched tag values. For nested tags like
                       "affiliation:country:United Kingdom", the captured value is the last segment ("United Kingdom").
            csv_path: Output CSV file path.

        Returns:
            csv_path
        """
        import csv
        import re
        from typing import Any

        # --- helpers ---
        def _norm_space(s: Any) -> str:
            return re.sub(r"\s+", " ", str(s or "")).strip()

        def _year_from_item(it: dict) -> str:
            data = it.get("data", {})
            # Prefer meta.parsedDate if present; fall back to data.date or data.accessDate
            candidates = [
                (it.get("meta", {}) or {}).get("parsedDate", ""),
                data.get("date", ""),
                data.get("accessDate", ""),
            ]
            for cand in candidates:
                m = re.search(r"(\d{4})", str(cand or ""))
                if m:
                    return m.group(1)
            return ""

        def _authors_from_creators(creators: list[dict]) -> str:
            names = []
            for c in creators or []:
                if "name" in c and c.get("name"):
                    names.append(_norm_space(c.get("name")))
                else:
                    fn = _norm_space(c.get("firstName"))
                    ln = _norm_space(c.get("lastName"))
                    names.append(_norm_space(f"{fn} {ln}").strip())
            # remove empties
            names = [n for n in names if n]
            return ", ".join(names)

        def _attachment_path(it: dict) -> str:
            """
            Try to surface a useful full_text path/URL.
            Priority: links.attachment.href → data.url → links.alternate.href
            """
            links = it.get("links", {}) or {}
            att = links.get("attachment", {}) or {}
            href = _norm_space(att.get("href"))
            if href:
                return href
            data = it.get("data", {}) or {}
            url = _norm_space(data.get("url"))
            if url:
                return url
            alt = links.get("alternate", {}) or {}
            ahref = _norm_space(alt.get("href"))
            if ahref:
                return ahref
            return ""

        def _citations_from_item(it: dict) -> str:
            """
            Robust citation extractor:
              1) Try to parse a number from data.extra using parse_citation_count(...)
              2) If 0 / missing, fallback to child notes via get_note_meta_citation_country_place(item_key)
            Returns a stringified integer or "" if nothing could be determined.
            """

            data = (it.get("data", {}) or {})
            extra_str = data.get("extra", "") or ""

            # 1) Parse from 'extra'
            try:
                count = parse_citation_count(extra_str)
            except Exception:
                count = 0

            # 2) Fallback to notes (Google Scholar / Overton / WoS in child notes)
            if not count:
                try:
                    item_key = it.get("key") or data.get("key") or ""
                    if item_key:
                        meta = get_note_meta_citation_country_place(self.zot,item_key) or {}
                        note_count = meta.get("citation")
                        if isinstance(note_count, int) and note_count > 0:
                            count = note_count
                except Exception:
                    # If anything goes wrong, keep count as 0
                    pass

            return str(int(count)) if count else ""

        def _tag_values_for_col(it: dict, col: str) -> str:
            """
            Gather values for a given dynamic column by scanning item['data']['tags'].

            We accept any of these prefixes (case-insensitive), followed by ":":
              - <base>                      (e.g., "publisher_type")
              - <base>_value               (e.g., "publisher_type_value")
              - <base>_values              (e.g., "publisher_type_values")
              - <original>                 (exact column, lowercased)
              - <original-with-spaces>     (underscores → spaces)

            For nested tags like "affiliation:country:United Kingdom", we take the LAST segment.
            De-duplicate case-insensitively, preserve first-seen order.
            """
            import re

            tags = ((it.get("data", {}) or {}).get("tags", []) or [])
            raw_col = str(col).strip().lower()
            base = re.sub(r"(_values?|_value)$", "", raw_col)

            # candidate prefixes to try (lowercased, no leading '#')
            candidates = {
                base,
                f"{base}_value",
                f"{base}_values",
                raw_col,
                raw_col.replace("_", " "),
            }

            out, seen = [], set()

            for t in tags:
                raw = str((t or {}).get("tag", "")).strip()
                if not raw:
                    continue

                s = raw.lstrip("#").strip()
                s_lower = s.lower()

                # quick reject if no candidate matches start-of-string
                if not any(s_lower.startswith(f"{cand}:") for cand in candidates):
                    continue

                parts = s.split(":")
                if len(parts) >= 2:
                    val = re.sub(r"\s+", " ", parts[-1]).strip()
                    if val and val.lower() not in seen:
                        out.append(val)
                        seen.add(val.lower())

            return ", ".join(out)

        # --- fetch items ---
        items = self.get_all_items(collection_name) or []

        # --- build header ---
        fixed_cols = [
            "record_id",
            "authors",
            "title",
            "publication_year",
            "publication_outlet",
            "citations",
            "abstract",
            "full_text",
            "notes",
            "validation_status",
        ]
        dynamic_cols = [str(c).strip() for c in (cols_list or []) if str(c).strip()]
        header = fixed_cols + dynamic_cols

        # --- rows ---
        rows = []
        pad_width = max(3, len(str(len(items))))
        for idx, it in enumerate(items, start=1):
            data = it.get("data", {}) or {}

            record_id = f"M{str(idx).zfill(pad_width)}"
            authors = _authors_from_creators(data.get("creators", []) or [])
            title = _norm_space(data.get("title"))
            publication_year = _year_from_item(it)

            # publication_outlet via helper, tolerate absence
            publication_outlet = ""
            if callable(infer_source):
                try:
                    cand = infer_source(it)
                    publication_outlet = _norm_space(cand) if cand else ""
                except Exception:
                    publication_outlet = ""

            citations = _citations_from_item(it)
            abstract = _norm_space(data.get("abstractNote"))
            full_text = _attachment_path(it)
            # Notes: leave blank for now; users can populate later
            notes = ""
            validation_status = ""

            row = {
                "record_id": record_id,
                "authors": authors,
                "title": title,
                "publication_year": publication_year,
                "publication_outlet": publication_outlet,
                "citations": citations,
                "abstract": abstract,
                "full_text": full_text,
                "notes": notes,
                "validation_status": validation_status,
            }

            # dynamic columns from tags
            for col in dynamic_cols:
                row[col] = _tag_values_for_col(it, col)

            rows.append(row)

        # --- write CSV ---
        # Ensure stable column order even if dynamic columns are empty
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow(r)

        return csv_path

    def coding_for_policy(
            self,
            collection_name,
            cache: bool = False,
            properties: list | None = None,
    ) -> bool:
        """
        Batch-extract policy_codes for one or more Zotero collections and tag items.

        Behaviour (fast + asynchronous):
          • Optional `properties` selects which schemas to compute; if omitted, uses defaults.
          • Properties are split into groups of size 3–4, with a minimal last group of 2 when unavoidable.
            Examples: 5 → [3,2]; 7 → [3,4]; 10 → [3,3,4]; 12 → [3,3,3,3].
          • Each properties-group is assigned its OWN filesystem-safe namespace -> separate OpenAI batch.
          • Phase 1: enqueue per ITEM × per GROUP concurrently (same text, different properties group).
          • Phase 1.5: submit all batches per group NON-BLOCKING (wait=False).
          • Phase 1.6: poll EACH group concurrently (wait=True); as soon as a group finishes,
                       read its results for all items and incrementally tag/update notes.
          • Tagging includes `value`, `value_normalised` (when present), and `location`.
          • Extensive logs to trace concurrency and progress.

        Returns:
          True if at least one collection was processed (best-effort).
        """
        import re
        import json
        import time
        import hashlib
        import concurrent.futures
        from collections import defaultdict

        function = "policy_codes"
        default_properties = [
            "document_type",
            "focus_type",
            "publisher_type",
            "phase_focus",
            "sector_focus",
            "country_focus",
            "methodology",
            "evaluates_tests",
            "empirical_theoretical",
            "affiliation",

        ]

        # choose property set
        prop_list = list(properties) if properties else list(default_properties)
        if not prop_list:
            print("[coding_for_policy] No properties requested; nothing to do.")
            return False

        def _safe_ns(text: str, maxlen: int = 96) -> str:
            """
            Make a string safe for Windows/macOS/Linux filenames.
            - Replace '::' with '__'
            - Replace any char not in [A-Za-z0-9._-] with '_'
            - Collapse repeats and trim length
            """
            s = text.replace("::", "__")
            s = re.sub(r"[^A-Za-z0-9._-]", "_", s)
            s = re.sub(r"_+", "_", s).strip("_.-")
            return s[:maxlen] if maxlen else s

        def _group_ns(base_collection: str, group: list[str]) -> str:
            """
            Stable, short, filesystem-safe namespace per properties-group.
            """
            digest = hashlib.sha1((",".join(group)).encode("utf-8")).hexdigest()[:10]
            base = _safe_ns(base_collection) or "collection"
            return _safe_ns(f"{base}_pcg_{digest}")

        def split_props_3_4(seq: list[str]) -> list[list[str]]:
            """
            Split into groups of size 3 or 4; allow a trailing 2 only when unavoidable (e.g., 5 -> [3,2]).
            Guarantees: max size 4, min size 2 (only the final bucket may be 2).
            """
            n = len(seq)
            if n <= 4:
                return [seq[:]] if n >= 2 else [seq[:]]  # if n==1, still return [1]
            groups: list[list[str]] = []
            i = 0
            while i < n:
                remaining = n - i
                if remaining == 2:  # force a final 2
                    groups.append(seq[i:i + 2]);
                    i += 2
                elif remaining in (3, 4):  # perfect end-fit
                    groups.append(seq[i:i + remaining]);
                    i += remaining
                else:
                    # prefer 3 until we can end with 3/4 cleanly
                    # if taking 3 would leave a final 1, take 4 here
                    after_take3 = remaining - 3
                    if after_take3 == 1:
                        take = 4
                    else:
                        take = 3
                    groups.append(seq[i:i + take]);
                    i += take
            return groups

        groups = split_props_3_4(prop_list)
        print(f"[coding_for_policy] properties={prop_list} -> groups={groups}")

        parent_key = self.find_or_create_top_collection(collection_name)
        if not parent_key:
            print(f"[coding_for_policy] Could not resolve collection: {collection_name}")
            return False

        items = self.get_all_items(collection_name=collection_name, cache=cache)
        if not items:
            print(f"[coding_for_policy] No items found in {collection_name}")
            return False

        processed_any = False

        # Build per-item texts once (avoid recomputation during read-back)
        item_texts: dict[str, dict] = {}

        # ----------------
        # Phase 1: queue (store_only=True) — multithread per item across property groups
        # ----------------
        for idx, item in enumerate(items):
            data = item.get("data", {}) or {}
            item_key = item.get("key") or data.get("key")
            title = (data.get("title") or "").strip()
            print(f"  • queue {idx + 1}/{len(items)} | {title[:80]} | key={item_key}")

            # Collect inputs: metadata + abstract + introduction/conclusion
            try:
                metadata = self.generate_metadata(item_key=item_key) or ""
            except Exception as e:
                print(f"[coding_for_policy] metadata generation failed ({item_key}): {e}")
                metadata = ""

            abstract = data.get("abstractNote", "") or ""
            intro_conclu = ""

            pdf_path = self.get_pdf_path_for_item(item_key)
            if pdf_path:
                try:
                    parsed = process_pdf(pdf_path, core_sections=True) or {}
                    intro_conclu = parsed.get("payload", "") or ""
                except Exception as e:
                    print(f"[coding_for_policy] PDF parse error ({item_key}): {e}")

            full_text = (
                f"metadata:\n{metadata}\n\n"
                f"abstract:\n{abstract}\n\n"
                f"intro/conclu:\n{intro_conclu}\n\n"
            )
            item_texts[item_key] = {
                "full_text": full_text,
                "read_text": f"metadata:\n{metadata}\n\nabstract:\n{abstract}",
                "title": title,
            }

            base_custom_id = hashlib.sha256(f"{item_key}|{collection_name}|{function}".encode("utf-8")).hexdigest()

            # Enqueue one job per properties group concurrently
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(groups))) as exe:
                futures = []
                for gi, group in enumerate(groups):
                    ns = _group_ns(collection_name, group)
                    custom_id = f"{base_custom_id}:{gi}"
                    futures.append(
                        exe.submit(
                            call_models_na,
                            text=full_text,
                            properties=group,
                            read=False,
                            store_only=True,
                            custom_id=custom_id,
                            collection_name=ns,  # unique per group → unique batch namespace
                            function=function,
                        )
                    )
                for fut in concurrent.futures.as_completed(futures):
                    try:
                        fut.result()
                        processed_any = True
                    except Exception as e:
                        print(f"[coding_for_policy] enqueue failed ({item_key}): {e}")

        if not processed_any:
            print("[coding_for_policy] No jobs enqueued; exiting.")
            return False

        # ----------------
        # Phase 1.5: submit all groups NON-BLOCKING
        # ----------------
        group_namespaces = [_group_ns(collection_name, group) for group in groups]

        def _submit_only(ns: str):
            print(f"[coding_for_policy] submit ns={ns} (non-blocking)")
            # wait=False: submit and return immediately
            return _process_batch_for(collection_name=ns, function=function, wait=False)

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(group_namespaces))) as exe:
            list(concurrent.futures.as_completed([exe.submit(_submit_only, ns) for ns in group_namespaces]))

        # ----------------
        # Phase 1.6: poll EACH group concurrently; when a group completes, READ that group immediately
        # ----------------
        # We'll collect per-item merged responses incrementally as groups finish
        merged_by_item: dict[str, dict] = defaultdict(dict)

        def _poll_and_read_group(ns: str, gi: int):
            t0 = time.time()
            print(f"[coding_for_policy] polling ns={ns} | group={gi}")
            # Wait for completion and download output now
            _process_batch_for(collection_name=ns, function=function, wait=True, download_if_ready=True)
            dt = time.time() - t0
            print(f"[coding_for_policy] completed ns={ns} in {dt:.1f}s; reading results...")

            # Read back results for this group for EVERY item
            group_results: dict[str, dict] = {}
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as exe:
                fut_map = {}
                for item in items:
                    data = item.get("data", {}) or {}
                    item_key = item.get("key") or data.get("key")
                    base_custom_id = hashlib.sha256(
                        f"{item_key}|{collection_name}|{function}".encode("utf-8")).hexdigest()
                    fut = exe.submit(
                        call_models_na,
                        text=item_texts[item_key]["read_text"],
                        properties=groups[gi],
                        read=True,
                        store_only=False,
                        custom_id=f"{base_custom_id}:{gi}",
                        collection_name=ns,
                        function=function,
                    )
                    fut_map[fut] = item_key
                for fut in concurrent.futures.as_completed(fut_map):
                    item_key = fut_map[fut]
                    try:
                        resp, _meta = fut.result()
                        if isinstance(resp, dict):
                            group_results[item_key] = resp
                    except Exception as e:
                        print(f"[coding_for_policy] read group {gi} failed ({item_key}): {e}")
            return gi, ns, group_results

        # Launch poll+read per group
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(group_namespaces))) as exe:
            fut_to_ns = {
                exe.submit(_poll_and_read_group, ns, gi): (ns, gi)
                for gi, ns in enumerate(group_namespaces)
            }
            for fut in concurrent.futures.as_completed(fut_to_ns):
                ns, gi = fut_to_ns[fut]
                try:
                    gi_done, ns_done, group_results = fut.result()
                    # Merge and tag incrementally as each group completes
                    for item in items:
                        data = item.get("data", {}) or {}
                        item_key = item.get("key") or data.get("key")
                        if item_key in group_results and isinstance(group_results[item_key], dict):
                            merged_by_item[item_key].update(group_results[item_key])

                            # Build tags for JUST the keys in this group
                            new_tags = []
                            new_tags = []

                            def _norm_tag_value(v, maxlen: int = 180) -> str:
                                if isinstance(v, float):
                                    s = f"{v:.3f}"
                                elif isinstance(v, int):
                                    s = str(v)
                                elif isinstance(v, dict):
                                    ident = (
                                            v.get("org_name_normalised")
                                            or v.get("country_iso3")
                                            or v.get("code")
                                            or v.get("label")
                                            or v.get("id")
                                            or v.get("name")
                                    )
                                    s = str(ident) if ident else json.dumps(v, ensure_ascii=False,
                                                                            separators=(",", ":"))
                                else:
                                    s = str(v)
                                s = re.sub(r"\s+", " ", s).strip()
                                return s[:maxlen]

                            def _emit_tag(prop_key: str, field: str, value) -> list[dict]:
                                out = []
                                if value is None:
                                    return out
                                if isinstance(value, list):
                                    for elem in value:
                                        out.extend(_emit_tag(prop_key, field, elem))
                                    return out
                                s = _norm_tag_value(value)
                                if not s:
                                    return out
                                safe_prop = re.sub(r"[^A-Za-z0-9._-]", "_", prop_key)
                                safe_field = re.sub(r"[^A-Za-z0-9._-]", "_", field)
                                out.append({"tag": f"#{safe_prop}_{safe_field}:{s}"})
                                return out

                            for prop_key in groups[gi_done]:
                                block = group_results[item_key].get(prop_key)
                                if not isinstance(block, dict):
                                    continue
                                for field, value in block.items():
                                    new_tags.extend(_emit_tag(prop_key, field, value))

                            # Deduplicate and append tags
                            if new_tags:
                                dedup, seen = [], set()
                                for t in new_tags:
                                    tag_str = t.get("tag")
                                    if tag_str and tag_str not in seen:
                                        seen.add(tag_str)
                                        dedup.append({"tag": tag_str})
                                try:
                                    self.update_zotero_item_feature(
                                        updates={"tags": dedup},
                                        item=item_key,
                                        append=True,
                                    )
                                except Exception as e:
                                    print(f"[coding_for_policy] tag update failed ({item_key}): {e}")

                    print(f"[coding_for_policy] merged + tagged results for group {gi_done} (ns={ns_done})")
                except Exception as e:
                    print(f"[coding_for_policy] poll/read failed for ns={ns} (group {gi}): {e}")

        # ----------------
        # Final note append (one merged JSON per item)
        # ----------------
        for idx, item in enumerate(items):
            data = item.get("data", {}) or {}
            item_key = item.get("key") or data.get("key")
            title = (data.get("title") or "").strip()

            try:
                subset = {k: merged_by_item[item_key].get(k) for k in prop_list if k in merged_by_item[item_key]}
                if subset:
                    html = "<h3>policy_codes</h3><pre>" + json.dumps(subset, ensure_ascii=False, indent=2) + "</pre>"
                    self._append_to_tagged_note(item_key=item_key, snippet=html, tag="policy_codes")
            except Exception as e:
                print(f"[coding_for_policy] note append failed ({item_key}): {e}")

            print(f"  • updated {idx + 1}/{len(items)} | {title[:80]} | key={item_key}")

        return True

    def load_data_from_source_for_widget(
            self,
            collection_name: Optional[str] = None,
            progress_callback: Optional[Callable[[str], None]] = None,
            cache_config: Optional[Dict[str, Any]] = None,
            cache=True
    ) -> Tuple[Optional[pd.DataFrame], Optional[List[Any]], str]:
        """
        Loads and processes data from Zotero or a file, with manifest-based caching for Zotero.

        Returns:
            df: DataFrame of processed records (or None on error)
            raw_items: list of raw Zotero items (or None for file source or on error)
            message: status message
        """

        def _cb(msg: str):
            if progress_callback:
                progress_callback(msg)
            logging.info(f"DataLoader: {msg}")

        FINAL_COLUMNS = [
            'key', 'title', 'year', 'authors', 'author_summary', 'publicationTitle', 'url', 'pdf_path', 'source',
            'keywords', 'citations', 'item_type', 'abstract', 'publisher', 'institution',
            'country', 'funding', 'theoretical_orientation', 'level_of_analysis',
            'argumentation_logic', 'evidence_source_base', 'methodology', 'methods',
            'framework_model', 'contribution_type', 'attribution_lens_focus',
            'topic_phrases', 'department', 'user_decision', 'user_notes'
        ]

        _DROP_COLS = [
            'attribution_mentions', 'authors_list', 'issue', 'journal', 'pages', 'volume', 'word_count_for_attribution'
        ]

        def _fill_pdf_paths_inplace(df_in: "pd.DataFrame") -> "pd.DataFrame":
            df = df_in.copy()
            if "pdf_path" not in df.columns:
                df["pdf_path"] = ""
            key_col = "key" if "key" in df.columns else ("item_key" if "item_key" in df.columns else None)
            if key_col is None:
                return df

            cache_map: Dict[str, str] = {}

            def _extract_path(val: Any) -> str:
                if isinstance(val, pd.Series):
                    return str(val.iloc[0] or "") if len(val) else ""
                if isinstance(val, pd.DataFrame):
                    if val.empty:
                        return ""
                    if "pdf_path" in val.columns:
                        return str(val["pdf_path"].iloc[0] or "")
                    if "path" in val.columns:
                        return str(val["path"].iloc[0] or "")
                    return ""
                if isinstance(val, dict):
                    return str(val.get("pdf_path") or val.get("path") or "")
                if isinstance(val, (list, tuple)):
                    return str(val[0] or "") if val else ""
                return str(val or "")

            def _resolve(item_key: Any) -> str:
                ks = str(item_key or "").strip()
                if not ks:
                    return ""
                if ks in cache_map:
                    return cache_map[ks]
                v = self.get_pdf_path_for_item(ks)
                path = _extract_path(v)
                cache_map[ks] = path
                return path

            mask = df["pdf_path"].astype(str).str.len().eq(0)
            if mask.any():
                df.loc[mask, "pdf_path"] = df.loc[mask, key_col].apply(_resolve)
            return df

        clean_collection_name = ""
        if isinstance(collection_name, str) and collection_name.strip():
            m = re.search(r"(?:collection\s*)?['\"]?(.*?)['\"]?$", collection_name.strip())
            clean_collection_name = m.group(1).strip() if m else collection_name.strip()

        cache_dir = cache_config.get("dir") if cache_config else MAIN_APP_CACHE_DIR
        expiry_seconds = cache_config.get("expiry", 806400) if cache_config else 806400

        cache_file = get_zotero_cache_filepath(clean_collection_name, cache_dir)

        if cache_file.exists() and cache:
            cache_age = time.time() - cache_file.stat().st_mtime
            if cache_age < expiry_seconds:
                _cb(f"Loading Zotero data from valid cache: {cache_file.name}")
                with open(cache_file, "rb") as f:
                    data = pickle.load(f)
                df, raw_items = data.get("dataframe"), data.get("raw_items")

                if df is not None and raw_items is not None:
                    if "author_summary" not in df.columns or df["author_summary"].isna().all():
                        auth = [((it.get("meta") or {}).get("creatorSummary") or "") for it in raw_items]
                        n = len(df)
                        m = len(auth)
                        if m < n:
                            auth += [""] * (n - m)
                        elif m > n:
                            auth = auth[:n]
                        df["author_summary"] = auth
                    df = _fill_pdf_paths_inplace(df)
                    df = df.drop(columns=[c for c in _DROP_COLS if c in df.columns], errors="ignore")
                    df = df.reindex(columns=FINAL_COLUMNS, fill_value="")
                    return df, raw_items, f"Loaded {len(df)} records from cache."
            else:
                _cb("Cache expired. Fetching fresh data.")

        _cb(f"Fetching from Zotero API: Collection='{clean_collection_name or 'All Items'}'…")
        raw_items = self.get_all_items(collection_name=(clean_collection_name or None))
        _cb(f"Retrieved {len(raw_items)} raw items.")
        if not raw_items:
            return pd.DataFrame(), [], "No items in Zotero collection."

        filtered_items = [item for item in raw_items if item.get("data")]
        records = [
            process_single_zotero_item_for_df(item["data"], f"fb_{i}")
            for i, item in enumerate(filtered_items)
        ]
        df = pd.DataFrame(records)

        auth2 = [((it.get("meta") or {}).get("creatorSummary") or "") for it in filtered_items]
        n2 = len(df)
        m2 = len(auth2)
        if m2 < n2:
            auth2 += [""] * (n2 - m2)
        elif m2 > n2:
            auth2 = auth2[:n2]
        df["author_summary"] = auth2

        df = _fill_pdf_paths_inplace(df)

        if not df.empty:
            df = df.drop(columns=[c for c in _DROP_COLS if c in df.columns], errors="ignore")
            df = df.reindex(columns=FINAL_COLUMNS, fill_value="")
            if "year" in df.columns:
                df["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")
            if "citations" in df.columns:
                df["citations"] = pd.to_numeric(df["citations"], errors='coerce').fillna(0).astype("Int64")
            df = normalise_df_data(df)

        cache_dir.mkdir(parents=True, exist_ok=True)
        with open(cache_file, "wb") as f:
            pickle.dump({"dataframe": df, "raw_items": raw_items}, f)
        _cb(f"Saved fresh cache to: {cache_file.name}")

        return df, raw_items, f"Loaded {len(df)} records from Zotero."

    def Verbatim_Evidence_Coding(self, dir_base,collection_name,research_questions,prompt_key="code_pdf_page", context: str = ""):
        original_name = collection_name

        safe_name = _safe_collection_name(collection_name)

        if safe_name != original_name:
            print(f"[info] Using filesystem-safe collection name: {safe_name}  (from {original_name!r})")


        results_by_item =self.open_coding(
            collection_name=collection_name,
            research_question=research_questions,store_only=True,
            cache= True,
            prompt_key=prompt_key,
            context=context,

        )

        with open("extract.json", "w", encoding="utf-8") as f:
            f.write(json.dumps(results_by_item, indent=2, ensure_ascii=False))
        print(results_by_item)
        if not isinstance(results_by_item, dict):
            return {
                "status": "error",
                "message": "open_coding returned non-dict result",
                "result": results_by_item,
            }
        if results_by_item.get("status") in {"queued", "error"}:
            return results_by_item

        from pathlib import Path
        from typing import Any, Dict, List, Optional,Tuple, Set
        from concurrent.futures import ThreadPoolExecutor, as_completed
        from pydantic import BaseModel, Field
        import csv

        class _CsvRow(BaseModel):
            item_key: str
            title: Optional[str] = Field(default="NA", min_length=1)
            year: Optional[str] = Field(default="NA")
            first_author_last: Optional[str] = Field(default="Anon")
            collection: Optional[str] = Field(default="NA")
            rq_sig: Optional[str] = Field(default="NA")
            cluster_match: Optional[str] = Field(default="[unspecified]")
            quote: str
            paraphrase: str
            function_summary: str
            risk_if_missing: str
            illustrative_skills: Optional[str] = Field(default="[unspecified]")
            relevance_score: int
            page: Optional[int] = None
            section_title: Optional[str] = None

        class QuoteHit(BaseModel):
            page: Optional[int] = None
            section_title: Optional[str] = None
            section_html: Optional[str] = None

        def _norm_title(s: Optional[str]) -> str:
            t = (s or "").strip()
            return t if len(t) > 0 else "NA"

        def _collect_item_quotes(results: Dict[str, Dict[str, Any]]) -> Dict[str, Set[str]]:
            grouped: Dict[str, Set[str]] = {}
            for item_key, bundle in results.items():
                evlist = bundle.get("evidence_list", [])
                bucket = grouped.get(item_key) or set()
                for ev in evlist:
                    q = str(ev.get("quote") or "").strip()
                    if len(q) > 0:
                        bucket.add(q)
                grouped[item_key] = bucket
            return grouped

        def _verify_quote(pdf_path: str, quote: str) -> Tuple[Optional[int], Optional[str]]:
            res = find_text_page_and_section(
                pdf_path=pdf_path,
                text=quote,
                page=True,
                section=True,
                cache=True,
                cache_full=True,
                case_sensitive=False,
            )
            pg = res.get("page") if isinstance(res, dict) else None
            st = res.get("section_title") if isinstance(res, dict) else None
            page_num: Optional[int] = pg if isinstance(pg, int) else (
                int(pg) if isinstance(pg, str) and pg.isdigit() else None)
            section_name: Optional[str] = str(st) if isinstance(st, str) and str(st).strip() else None
            return page_num, section_name

        def _build_hits_map_grouped(
                results: Dict[str, Dict[str, Any]],
                pdf_lookup: Dict[str, str],
                threads: int = 16
        ) -> Dict[str, Dict[str, QuoteHit]]:
            quotes_by_item = _collect_item_quotes(results)

            for ik, quotes in quotes_by_item.items():
                p = pdf_lookup.get(ik, "")
                if p:
                    _ = process_pdf(p, cache=True, cache_full=True, core_sections=True)

            out: Dict[str, Dict[str, QuoteHit]] = {}
            items: List[Tuple[str, List[str]]] = [(ik, list(quotes)) for ik, quotes in quotes_by_item.items()]

            def _worker(item_key: str, quotes: List[str]) -> Tuple[str, Dict[str, QuoteHit]]:
                pdf_path = pdf_lookup.get(item_key, "")
                res_local: Dict[str, QuoteHit] = {}
                if pdf_path:
                    for q in quotes:
                        pg, sec = _verify_quote(pdf_path, q)
                        res_local[q] = QuoteHit(page=pg, section_title=sec, section_html=None)
                return (item_key, res_local)

            with ThreadPoolExecutor(max_workers=max(1, int(threads))) as exe:
                futures = [exe.submit(_worker, ik, qs) for ik, qs in items]
                for fut in as_completed(futures):
                    ik_res, hits = fut.result()
                    out[ik_res] = hits

            return out

        def _flatten_rows_with_hits(
                results: Dict[str, Dict[str, Any]],
                hits_map: Dict[str, Dict[str, QuoteHit]]
        ) -> List[_CsvRow]:
            rows: List[_CsvRow] = []
            for item_key, bundle in results.items():
                meta: Dict[str, Any] = bundle.get("metadata", {})
                evlist: List[Dict[str, Any]] = bundle.get("evidence_list", [])

                base = {
                    "item_key": str(meta.get("item_key") or item_key),
                    "title": _norm_title(meta.get("title")),
                    "year": str(meta.get("year") or "NA"),
                    "first_author_last": str(meta.get("first_author_last") or "Anon"),
                    "collection": str(meta.get("collection") or "NA"),
                    "rq_sig": str(meta.get("rq_sig") or "NA"),
                }

                hit_bucket = hits_map.get(item_key, {})

                for ev in evlist:
                    clusters = ev.get("cluster_match") if isinstance(ev.get("cluster_match"), list) else []
                    skills = ev.get("illustrative_skills") if isinstance(ev.get("illustrative_skills"), list) else []
                    quote_txt = str(ev.get("quote") or "NA")

                    hit = hit_bucket.get(quote_txt, QuoteHit())
                    row = _CsvRow(
                        **base,
                        cluster_match="; ".join([str(x) for x in clusters]) if clusters else "[unspecified]",
                        quote=quote_txt,
                        paraphrase=str(ev.get("paraphrase") or "NA"),
                        function_summary=str(ev.get("function_summary") or "NA"),
                        risk_if_missing=str(ev.get("risk_if_missing") or "NA"),
                        illustrative_skills="; ".join([str(x) for x in skills]) if skills else "[unspecified]",
                        relevance_score=int(ev.get("relevance_score") or 0),
                        page=hit.page,
                        section_title=hit.section_title,
                    )
                    rows.append(row)
            return rows

        def export_evidence_csv_grouped(
                results: Dict[str, Dict[str, Any]],
                base_dir: str,
                collection_name: str,
                threads: int = 16
        ) -> str:
            safe_coll = _safe_collection_name(collection_name)
            out_dir = Path(base_dir) / "open_coding_exports"
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / f"{safe_coll}__evidence.csv"

            pdf_lookup_dict: Dict[str, str] = {}
            for item_key in results.keys():
                pdf_lookup_dict[item_key] = self.get_pdf_path_for_item(str(item_key))

            hits_map = _build_hits_map_grouped(results, pdf_lookup=pdf_lookup_dict, threads=threads)
            rows = _flatten_rows_with_hits(results, hits_map)
            fieldnames = list(_CsvRow.model_fields.keys())

            with out_path.open("w", encoding="utf-8", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=fieldnames)
                writer.writeheader()
                for r in rows:
                    writer.writerow(r.model_dump())

            print(f"[export] evidence CSV rows={len(rows)} → {out_path}")
            return str(out_path)

        csv_path = export_evidence_csv_grouped(
            results=results_by_item,
            base_dir=dir_base,
            collection_name=collection_name,
            threads=16
        )

        print(dir_base)
        export_themes = extract_themes_and_hierarchy_by_rq(
            collection_name=collection_name,
            dir_path=dir_base,
            results_by_item=results_by_item,
            batch_size=50,
        )

        # --- NEW: regroup across all RQs using the manifest we just wrote ---
        manifest_path = (export_themes or {}).get("manifest", {}).get("path")
        if manifest_path:
            # This helper must exist in your codebase (see earlier patch I gave you).
            grouped_by_rq = regroup_all_rqs_from_manifest(
                manifest_path=manifest_path,
                top_n_per_score=50,  # tweak or set to None
                score_key_format="int",  # or "label"
            )
        else:
            grouped_by_rq = {}

        df, data, a = self.load_data_from_source_for_widget(cache=True,
                                                           collection_name=collection_name,

                                                           )


        final = process_rq_theme_claims(df=df,dir_base=dir_base,collection_name=collection_name,    manifest_path=manifest_path,   # <— pass the manifest you just wrote
)
        return {
            "status": "ok",
            "csv_path": csv_path,
            "manifest_path": manifest_path,
            "theme_result": final,
        }


    def set_eligibility_criteria(
            self,
            collection_name: str,
            inclusion_criteria: str,
            exclusion_criteria: str,
            eligibility_prompt_key: str = "paper_screener_abs_policy",
            schema_json: dict | None = None,
            context: str = "",
            research_questions: list[str] | None = None,
            agent_generate: bool = True,
            model: str = "gpt-5-mini",
            max_items_for_agent: int = 40,
            store_only: bool = False,
            read: bool = False,
    ) -> dict:
        """
        Persist inclusion/exclusion criteria and a normalized schema for open-coding eligibility runs.

        Dynamic mode:
        - If criteria are missing/placeholder and `agent_generate=True`, this function asks an LLM agent
          to synthesize inclusion/exclusion criteria from collection metadata (title+abstract sample),
          then stores the generated criteria and schema locally.
        - It first attempts the same adapter path used by screening/batch flows (`call_openai_api`),
          then falls back to a direct OpenAI structured-output call if needed.
        """
        from pathlib import Path
        from datetime import datetime
        import json
        import re

        def _split_lines(text: str) -> list[str]:
            raw = str(text or "").replace(";", "\n")
            lines = [re.sub(r"\s+", " ", ln).strip(" -\t") for ln in raw.splitlines()]
            return [ln for ln in lines if ln]

        base_log_dir = Path(getattr(self, "logs_dir", Path.cwd() / "logs"))
        out_dir = base_log_dir / "open_coding_eligibility"
        out_dir.mkdir(parents=True, exist_ok=True)
        cfg_path = out_dir / f"{_safe_collection_name(str(collection_name or 'collection'))}_criteria.json"

        include_lines = _split_lines(inclusion_criteria)
        exclude_lines = _split_lines(exclusion_criteria)
        rq_lines = [str(x or "").strip() for x in (research_questions or []) if str(x or "").strip()]
        dynamic_meta: dict = {
            "generated": False,
            "generator": "",
            "generator_model": "",
            "notes": "",
        }

        def _is_placeholder(lines: list[str]) -> bool:
            if not lines:
                return True
            joined = " ".join(lines).lower()
            bad = [
                "auto draft unavailable",
                "missing",
                "n/a",
                "na",
                "none",
                "todo",
                "tbd",
            ]
            return any(token in joined for token in bad)

        def _json_parse_maybe(value: Any) -> dict:
            if isinstance(value, dict):
                return value
            if isinstance(value, str):
                s = value.strip()
                if not s:
                    return {}
                try:
                    parsed = json.loads(s)
                    return parsed if isinstance(parsed, dict) else {}
                except Exception:
                    return {}
            return {}

        def _normalize_agent_payload(payload: dict) -> tuple[list[str], list[str], dict | None]:
            if not isinstance(payload, dict):
                return [], [], None
            inc = payload.get("inclusion_criteria")
            exc = payload.get("exclusion_criteria")
            sch = payload.get("schema") if isinstance(payload.get("schema"), dict) else None
            inc_lines = [str(x).strip() for x in (inc if isinstance(inc, list) else []) if str(x).strip()]
            exc_lines = [str(x).strip() for x in (exc if isinstance(exc, list) else []) if str(x).strip()]
            return inc_lines, exc_lines, sch

        def _build_agent_input() -> dict:
            try:
                items_raw = self.get_all_items(collection_name=collection_name, cache=True) or []
            except Exception:
                items_raw = []
            records = []
            for it in items_raw:
                d = it.get("data", {}) if isinstance(it, dict) else {}
                title = str(d.get("title") or "").strip()
                abstract = str(d.get("abstractNote") or "").strip()
                if not title and not abstract:
                    continue
                records.append(
                    {
                        "item_key": str(it.get("key") or ""),
                        "title": title[:400],
                        "abstract": abstract[:2400],
                    }
                )
                if len(records) >= max(1, int(max_items_for_agent)):
                    break
            return {
                "task": "Create dynamic inclusion and exclusion criteria for collection screening.",
                "collection_name": str(collection_name or ""),
                "context": str(context or ""),
                "research_questions": rq_lines,
                "current_inclusion_criteria": include_lines,
                "current_exclusion_criteria": exclude_lines,
                "records": records,
                "output_contract": {
                    "inclusion_criteria": "array of strings (>=3 preferred)",
                    "exclusion_criteria": "array of strings (>=3 preferred)",
                    "schema": "optional JSON schema object for screening output"
                }
            }

        def _generate_with_adapter(agent_input: dict) -> tuple[list[str], list[str], dict | None]:
            """
            Try llm_adapter path first so criteria generation uses the same routing stack
            as screening/batch model calls.
            """
            fn_candidates = [
                "eligibility_criteria_builder_v1",
                "eligibility_schema_builder",
                "set_eligibility_criteria",
            ]
            payload_txt = json.dumps(agent_input, ensure_ascii=False)
            for fn in fn_candidates:
                try:
                    resp = call_openai_api(
                        data=payload_txt,
                        function=fn,
                        model=model,
                        collection_name=collection_name,
                        store_only=store_only,
                        read=read,
                        custom_id=f"eligibility::{_safe_collection_name(str(collection_name or 'collection'))}"
                    )
                    parsed = _json_parse_maybe(resp)
                    inc, exc, sch = _normalize_agent_payload(parsed)
                    if inc and exc:
                        dynamic_meta["generated"] = True
                        dynamic_meta["generator"] = "llm_adapter.call_openai_api"
                        dynamic_meta["generator_model"] = str(model or "")
                        dynamic_meta["notes"] = f"function={fn}"
                        return inc, exc, sch
                except Exception:
                    continue
            return [], [], None

        def _generate_direct_openai(agent_input: dict) -> tuple[list[str], list[str], dict | None]:
            api_key = str(os.getenv("OPENAI_API_KEY") or "").strip()
            if not api_key:
                return [], [], None
            try:
                from openai import OpenAI
                client = OpenAI(api_key=api_key)
                schema_spec = {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["inclusion_criteria", "exclusion_criteria", "rationale"],
                    "properties": {
                        "inclusion_criteria": {"type": "array", "items": {"type": "string"}, "minItems": 3, "maxItems": 10},
                        "exclusion_criteria": {"type": "array", "items": {"type": "string"}, "minItems": 3, "maxItems": 10},
                        "rationale": {"type": "string"},
                        "schema": {"type": "object", "additionalProperties": True},
                    }
                }
                system_prompt = (
                    "You create screening eligibility criteria for literature review pipelines. "
                    "Return concise, non-overlapping inclusion/exclusion criteria that match the collection sample and context."
                )
                resp = client.responses.create(
                    model=str(model or "gpt-5-mini"),
                    input=[
                        {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                        {"role": "user", "content": [{"type": "input_text", "text": json.dumps(agent_input, ensure_ascii=False)}]},
                    ],
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": "eligibility_criteria_builder",
                            "schema": schema_spec,
                            "strict": True,
                        }
                    },
                )
                out_text = str(getattr(resp, "output_text", "") or "").strip()
                parsed = _json_parse_maybe(out_text)
                inc, exc, sch = _normalize_agent_payload(parsed)
                if inc and exc:
                    dynamic_meta["generated"] = True
                    dynamic_meta["generator"] = "openai.responses"
                    dynamic_meta["generator_model"] = str(model or "gpt-5-mini")
                    dynamic_meta["notes"] = "structured_json_schema"
                    return inc, exc, sch
            except Exception:
                return [], [], None
            return [], [], None

        should_generate = bool(agent_generate) and (_is_placeholder(include_lines) or _is_placeholder(exclude_lines))
        generated_schema = None
        if should_generate:
            agent_input = _build_agent_input()
            g_inc, g_exc, g_schema = _generate_with_adapter(agent_input)
            if not g_inc or not g_exc:
                g_inc, g_exc, g_schema = _generate_direct_openai(agent_input)
            if g_inc and g_exc:
                include_lines, exclude_lines = g_inc, g_exc
                generated_schema = g_schema

        if not include_lines and not exclude_lines:
            raise ValueError("At least one inclusion or exclusion criterion is required.")

        schema = schema_json if isinstance(schema_json, dict) else (generated_schema if isinstance(generated_schema, dict) else {
            "type": "object",
            "additionalProperties": False,
            "required": ["status", "justification", "inclusion_hits", "exclusion_hits", "eligibility_criteria", "coder_prompt"],
            "properties": {
                "status": {"type": "string", "enum": ["include", "exclude", "maybe"]},
                "justification": {"type": "string"},
                "inclusion_hits": {"type": "array", "items": {"type": "string"}},
                "exclusion_hits": {"type": "array", "items": {"type": "string"}},
                "eligibility_criteria": {
                    "type": "object",
                    "required": ["inclusion", "exclusion"],
                    "properties": {
                        "inclusion": {"type": "array", "items": {"type": "string"}},
                        "exclusion": {"type": "array", "items": {"type": "string"}},
                    },
                },
                "coder_prompt": {
                    "type": "string",
                    "const": "You are a rigorous screening coder. Apply inclusion and exclusion criteria exactly. Return valid JSON only.",
                },
            },
        })

        payload = {
            "collection_name": collection_name,
            "eligibility_prompt_key": str(eligibility_prompt_key or "paper_screener_abs_policy"),
            "inclusion_criteria": include_lines,
            "exclusion_criteria": exclude_lines,
            "schema": schema,
            "context": str(context or ""),
            "research_questions": rq_lines,
            "dynamic_generation": dynamic_meta,
            "updated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        }
        with cfg_path.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)

        return {
            "status": "ok",
            "collection_name": collection_name,
            "criteria_path": str(cfg_path),
            "schema": schema,
            "inclusion_count": len(include_lines),
            "exclusion_count": len(exclude_lines),
            "dynamic_generation": dynamic_meta,
        }


    def open_coding(
            self,
            research_question: str | list[str],
            collection_name: str,
            store_only: bool = False,
            read: bool = False,
            cache: bool = False,
            core_sections: bool = True,
            prompt_key: str = "code_pdf_page",
            context: str = "",
    ) -> dict:
        """
        Open coding pipeline for a collection using prompt_key='code_pdf_page'.

        Behaviour:
          - Fetch items in `collection_name`.
          - For each item, run process_pdf(...) to get sections.
          - For each section (chunked if long), inject vars into the 'code_pdf_page' prompt
            and call call_models(...) either to store batch or to read results.
          - If store=True (enqueue-only), trigger _process_batch_for(...) and immediately
            re-run in read-mode to return decoded results.
          - NEW: Persist a single run-level JSON file named with <rq-hash>__<collection>.json
                 that maps item_key -> { metadata, evidence_list }. If the file already exists
                 and cache=True, return its contents immediately.

        Returns:
          dict[item_key] = {"metadata": {...}, "evidence_list": [...]}   (read-mode, also persisted)
          {}                                                             (store-mode)
        """
        from pathlib import Path
        import hashlib, json, re, time
        from datetime import datetime

        prompt_key = str(prompt_key or "code_pdf_page").strip() or "code_pdf_page"

        # ---------------------------
        # utils
        # ---------------------------
        def _strip_index_prefix(s: str) -> str:
            return re.sub(r'^\s*\d+\s*:\s*', '', s or '').strip()

        def _slug(s: str, max_len: int = 64) -> str:
            s = re.sub(r'[^\w\-]+', '_', s.strip())
            s = re.sub(r'_{2,}', '_', s).strip('_')
            return (s[:max_len] or "untitled")

        def _rq_to_lines(rq: str | list[str]) -> tuple[list[str], str]:
            # normalize to lines "i: question"
            if isinstance(rq, list):
                rq_clean = [_strip_index_prefix(str(x)) for x in rq if str(x).strip()]
            else:
                rq_clean = [_strip_index_prefix(str(rq))] if str(rq).strip() else []
            lines = [f"{i}: {q}" for i, q in enumerate(rq_clean)] if rq_clean else ["0: [RQ missing]"]
            return lines, "\n".join(lines)

        def _rq_hash(rq_lines: list[str]) -> str:
            return hashlib.sha256("\n".join(rq_lines).encode("utf-8")).hexdigest()[:10]

        def _safe_get_year(item_data: dict) -> str:
            year = "-"
            try:
                d = str(item_data.get("date", "")).strip()
                m = re.search(r"(\d{4})", d) if d else None
                if m:
                    year = m.group(1)
            except Exception:
                pass
            return year

        def _first_author_last(item_data: dict) -> str:
            try:
                creators = item_data.get("creators") or []
                return (creators[0].get("lastName") or creators[0].get("name")) if creators else "Anon"
            except Exception:
                return "Anon"

        def _extract_evidence(resp_obj) -> list:
            """
            Normalize whatever call_models returned into a list of evidence dicts.
            Accepts:
              - dict with 'evidence' key
              - tuple (dict, ...), etc.
            """
            try:
                # unwrap tuple from call_models (e.g., (result, False))
                if isinstance(resp_obj, tuple) and resp_obj:
                    resp_obj = resp_obj[0]

                if isinstance(resp_obj, dict):
                    if "evidence" in resp_obj and isinstance(resp_obj["evidence"], list):
                        return resp_obj["evidence"]
                    # sometimes code_single_item wraps response as {"item_key","section_key","response": {...}}
                    if "response" in resp_obj:
                        return _extract_evidence(resp_obj["response"])  # recursive unwrap
            except Exception:
                pass
            return []

        # ---------------------------
        # setup & run-level cache file
        # ---------------------------
        ai_provider_key = getattr(self, "ai_provider_key", "openai")
        base_log_dir = Path(getattr(self, "logs_dir", Path.cwd() / "logs"))
        base_log_dir.mkdir(parents=True, exist_ok=True)

        rq_lines, research_questions_formatted = _rq_to_lines(research_question)
        rq_sig = _rq_hash(rq_lines)

        # Directory to store consolidated outputs across items for this run
        run_out_dir = base_log_dir / "open_coding_runs"
        run_out_dir.mkdir(parents=True, exist_ok=True)

        # Use a short slug of the first RQ line to be human-readable + hash for stability
        first_rq_slug = _slug(rq_lines[0]) if rq_lines else "rq_missing"
        coll_slug = _slug(collection_name or "collection")
        run_filename = f"{first_rq_slug}__{rq_sig}__{coll_slug}.json"
        run_file = run_out_dir / run_filename

        # Fast path: if persisted JSON exists and cache=True, return it immediately
        if cache and run_file.is_file():
            try:
                with run_file.open("r", encoding="utf-8") as fh:
                    persisted = json.load(fh)
                return persisted if isinstance(persisted, dict) else {}
            except Exception:
                # fall through to recompute if corrupted
                pass

        results_by_item: dict[str, dict] = {}

        # ---------------------------
        # resolve items
        # ---------------------------
        items = self.get_all_items(collection_name=collection_name, cache=cache)
        # items = [self.zot.item("7CJPMXT8")]  # keep your current single-item testing
        if not items:
            print(f"[open_coding] No items found under collection='{collection_name}'.")
            # persist empty (so subsequent calls short-circuit)
            try:
                with run_file.open("w", encoding="utf-8") as fh:
                    json.dump({}, fh, ensure_ascii=False, indent=2)
            except Exception:
                pass
            return {}

        # ---------------------------
        # iterate items
        # ---------------------------
        for item in items:
            item_key = item.get("key")
            if not item_key:
                continue

            # Let code_single_item handle per-item sectioning / model calls (and its own per-item cache)
            per_item_section_results = self.code_single_item(
                item=item,
                research_question=research_questions_formatted,
                core_sections=core_sections,
                prompt_key=prompt_key,
                read=read,
                store_only=store_only,
                cache=cache,
                collection_name=collection_name,
            )

            # When store_only, do not aggregate (no responses yet)
            if store_only:
                continue

            # Aggregate evidence across sections for this item
            evidence_accum: list = []
            for entry in (per_item_section_results or []):
                # entry shape: {"item_key","section_key","response": <dict|tuple|...>}
                ev = _extract_evidence(entry)  # handles nested/tuple/dict
                if isinstance(ev, list) and ev:
                    evidence_accum.extend(ev)

            # metadata for the item
            item_data = item.get("data", {}) if isinstance(item.get("data"), dict) else item
            meta = {
                "item_key": item_key,
                "title": item_data.get("title"),
                "authors": item_data.get("creators", []),
                "year": _safe_get_year(item_data),
                "first_author_last": _first_author_last(item_data),
                "collection": collection_name,
                "prompt_key": prompt_key,
                "rq_lines": rq_lines,
                "rq_sig": rq_sig,
                "timestamp": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            }

            results_by_item[item_key] = {
                "metadata": meta,
                "evidence_list": evidence_accum,
            }

            # tiny throttle to be gentle
            time.sleep(0.03)

        # If store_only, optionally trigger batch execution and bounce to read-mode
        if store_only and not read:
            if _process_batch_for(collection_name=collection_name, function=prompt_key):
                return self.open_coding(
                    research_question=research_question,
                    collection_name=collection_name,
                    store_only=False,
                    read=True,
                    cache=cache,
                    core_sections=core_sections,
                )
            return {}

        # ---------------------------
        # persist run-level JSON and return
        # ---------------------------
        try:
            with run_file.open("w", encoding="utf-8") as fh:
                json.dump(results_by_item, fh, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[open_coding] WARN: could not write run file '{run_file}': {e}")

        return results_by_item

    def code_single_item(self,
                         item: dict,
                         read: bool,
                         store_only: bool,
                         research_question: str | list[str],
                         collection_name: str,
                         cache: bool = False,
                         core_sections: bool = True,
                         prompt_key: str = "code_pdf_page") -> list[dict]:
        """
        Codes a single Zotero `item` against research_question(s) using prompt_key='code_pdf_page'.
        Uses local functions directly: process_pdf, call_models.
        Caching:
          - If read=True and a valid cache exists → return it.
          - After successful read=True → persist results to cache.

        Returns: list of {"item_key","section_key","response"} in read-mode,
                 [] for enqueue-only or on failure.
        """
        from pathlib import Path
        import hashlib, json, re, time

        results: list[dict] = []

        # --- setup ---
        ai_provider_key = getattr(self, "ai_provider_key", "openai")
        base_log_dir = Path(getattr(self, "logs_dir", Path.cwd() / "logs"))
        base_log_dir.mkdir(parents=True, exist_ok=True)

        # --- normalize/format RQs (avoid double "0:" like '0: 0: ...') ---
        def _strip_index_prefix(s: str) -> str:
            # remove any leading "N:" someone might have pre-injected
            return re.sub(r'^\s*\d+\s*:\s*', '', s or '').strip()

        if isinstance(research_question, list):
            rq_list = [_strip_index_prefix(str(x)) for x in research_question if str(x).strip()]
        else:
            rq_list = [_strip_index_prefix(str(research_question))] if str(research_question).strip() else []

        research_questions_formatted = "\n".join(
            f"{i}: {q}" for i, q in enumerate(rq_list)) if rq_list else "0: [RQ missing]"

        # --- per-item cache path ---
        item_key = item.get("key")
        if not item_key:
            return results

        rq_sig = hashlib.sha256(research_questions_formatted.encode("utf-8")).hexdigest()[:10]
        cache_file = (base_log_dir / "open_coding_cache" / f"{item_key}_{prompt_key}_{rq_sig}.json")
        cache_file.parent.mkdir(parents=True, exist_ok=True)

        if read and cache and cache_file.is_file():
            try:
                with cache_file.open("r", encoding="utf-8") as fh:
                    cached = json.load(fh)
                if isinstance(cached, list):
                    return cached
            except Exception:
                pass  # recompute

        # --- resolve PDF ---
        pdf_path = None
        try:
            pdf_path = self.get_pdf_path_for_item(item_key)
        except Exception as e:
            print(f"[open_coding] get_pdf_path_for_item error for {item_key}: {e}")
        if not pdf_path:
            print(f"[open_coding] No PDF found for item {item_key} — skipping.")
            return results

        # --- parse PDF → sections ---
        try:
            parsed = process_pdf(
                pdf_path=pdf_path,
                cache=cache,
                cache_full=True,
                mistral_model="mistral-ocr-latest",
                ocr_retry=5,
                core_sections=core_sections,
            ) or {}

        except Exception as e:
            print(f"[open_coding] process_pdf failed for {item_key}: {e}")
            return results

        sections_map = merge_sections_min_words(parsed.get("sections") , min_words=500)

        if not isinstance(sections_map, dict) or not sections_map:
            print(f"[open_coding] No usable text for item {item_key}.")
            return results

        # --- derive minimal author/year (not injected in prompt string here) ---
        data = item.get("data", {}) if isinstance(item.get("data"), dict) else item
        year = "-"
        try:
            d = str(data.get("date", "")).strip()
            m = re.search(r"(\d{4})", d) if d else None
            if m:
                year = m.group(1)
        except Exception:
            pass
        try:
            creators = data.get("creators") or []
            author_last = (creators[0].get("lastName") or creators[0].get("name")) if creators else "Anon"
        except Exception:
            author_last = "Anon"
        _author_year_info = f"{author_last}, {year}"  # kept for potential future use

        # --- merge-adjacent small sections (<500 words) ---
        def _sec_text_of(val):
            return (val.get("text") or val.get("content") or val.get("raw") or "").strip() \
                if isinstance(val, dict) else str(val or "").strip()

        merged_sections: list[tuple[str, str]] = []
        buf_keys, buf_texts, buf_words = [], [], 0

        for k, v in sections_map.items():
            s = _sec_text_of(v)
            if not s:
                continue
            w = len(s.split())

            if w >= 500:
                if buf_texts:
                    merged_sections.append((" + ".join(buf_keys), "\n\n".join(buf_texts).strip()))
                    buf_keys, buf_texts, buf_words = [], [], 0
                merged_sections.append((str(k), s))
                continue

            buf_keys.append(str(k))
            buf_texts.append(s)
            buf_words += w

            if buf_words >= 500:
                merged_sections.append((" + ".join(buf_keys), "\n\n".join(buf_texts).strip()))
                buf_keys, buf_texts, buf_words = [], [], 0

        if buf_texts:
            merged_sections.append((" + ".join(buf_keys), "\n\n".join(buf_texts).strip()))

        # --- iterate merged sections (keep your prints/inputs) ---
        for sec_key, sec_text in merged_sections:
            if not sec_text:
                continue

            custom_id = hashlib.sha256(
                f"{item_key}|{sec_key}|{rq_sig}|{prompt_key}".encode("utf-8")
            ).hexdigest()

            # keep exact logging/IO format; only fix duplicate "0:" by using cleaned research_questions_formatted
            text = f"research question = {research_questions_formatted}\n\n\nSECTION\n{sec_key}\n\n{sec_text}"


            resp = call_models(
                text=text,
                function=prompt_key,
                custom_id=custom_id,
                collection_name=collection_name,
                read=read,
                store_only=store_only,
                ai=(ai_provider_key if ai_provider_key in ("openai", "mistral", "gemini", "deepseek") else "openai"),
            )




            if store_only:
                continue

            results.append({
                "item_key": item_key,
                "section_key": str(sec_key),
                "response": resp
            })

            time.sleep(0.03)

        if read and results and cache:
            try:
                with cache_file.open("w", encoding="utf-8") as fh:
                    json.dump(results, fh, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"[open_coding] WARN: could not write cache for {item_key}: {e}")

        return results

    def code_single_item_from_abstract(self,
                                       item: dict,
                                       prompt_key: str,
                                       read: bool,
                                       store_only: bool,
                                       research_question: str | list[str],
                                       collection_name: str,
                                       cache: bool = False) -> list[dict]:
        """
        Lightweight single-item coding from Zotero metadata only (abstract/title).
        Designed for topic/subfolder membership classification requests.

        Returns: list[dict] in read-mode, [] in store_only mode or on missing input.
        """
        import hashlib
        import json
        import re

        results: list[dict] = []
        ai_provider_key = getattr(self, "ai_provider_key", "openai")

        item_key = (item or {}).get("key")
        if not item_key:
            return results

        data = item.get("data", {}) if isinstance(item.get("data"), dict) else item
        abstract = str((data or {}).get("abstractNote") or "").strip()
        title = str((data or {}).get("title") or "").strip()

        if isinstance(research_question, list):
            rq = " | ".join(
                re.sub(r'^\s*\d+\s*:\s*', '', str(x or '')).strip()
                for x in research_question
                if str(x or "").strip()
            ).strip()
        else:
            rq = re.sub(r'^\s*\d+\s*:\s*', '', str(research_question or "")).strip()

        if not rq:
            rq = "general relevance"

        if not abstract:
            return results

        custom_id = hashlib.sha256(
            f"{item_key}|{prompt_key}|{rq}".encode("utf-8")
        ).hexdigest()

        payload = {
            "item_key": item_key,
            "title": title,
            "topic_query": rq,
            "abstract": abstract,
        }

        resp, _cost = call_models(
            text=json.dumps(payload, ensure_ascii=False),
            function=prompt_key,
            custom_id=custom_id,
            collection_name=collection_name,
            read=read,
            by_index=0,
            store_only=store_only,
            cache=cache,
            ai=(ai_provider_key if ai_provider_key in ("openai", "mistral", "gemini", "deepseek") else "openai"),
        )

        if store_only:
            return results

        results.append({
            "item_key": item_key,
            "title": title,
            "topic_query": rq,
            "response": resp,
        })
        return results

    def _topic_query_signature(self, topic_query: str) -> str:
        import hashlib
        q = str(topic_query or "").strip().lower()
        return hashlib.sha1(q.encode("utf-8")).hexdigest()[:12]

    def _topic_batch_paths(self, collection_name: str, prompt_key: str):
        safe_collection = safe_name(collection_name)
        safe_function = safe_name(prompt_key)
        func_dir = get_batch_root() / safe_function
        func_dir.mkdir(parents=True, exist_ok=True)
        input_path = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
        output_path = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
        return func_dir, input_path, output_path

    def _topic_ledger_path(self, collection_name: str, prompt_key: str, topic_query: str):
        sig = self._topic_query_signature(topic_query)
        func_dir, _input_path, _output_path = self._topic_batch_paths(collection_name=collection_name, prompt_key=prompt_key)
        return func_dir / f"{sig}_query_ledger.json"

    def _load_topic_ledger(self, collection_name: str, prompt_key: str, topic_query: str) -> dict:
        p = self._topic_ledger_path(collection_name=collection_name, prompt_key=prompt_key, topic_query=topic_query)
        if p.is_file():
            try:
                with p.open("r", encoding="utf-8") as fh:
                    d = json.load(fh)
                if isinstance(d, dict):
                    return d
            except Exception:
                pass
        return {"query": str(topic_query or ""), "items": {}}

    def _save_topic_ledger(self, collection_name: str, prompt_key: str, topic_query: str, ledger: dict) -> None:
        p = self._topic_ledger_path(collection_name=collection_name, prompt_key=prompt_key, topic_query=topic_query)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", encoding="utf-8") as fh:
            json.dump(ledger, fh, ensure_ascii=False, indent=2)

    def enqueue_topic_classification_for_collection(self,
                                                    collection_name: str,
                                                    topic_query: str,
                                                    prompt_key: str = "classify_abstract_topic_membership_v1",
                                                    limit: int | None = None) -> dict:
        """
        Enqueue abstract-topic classification for items not previously processed for this query.
        Idempotency guard uses both:
          - item tag: '#topic_processed:<query_sig>'
          - local ledger: Batching_files/<prompt_key>/<query_sig>_query_ledger.json
        """
        query_sig = self._topic_query_signature(topic_query)
        processed_tag = f"#topic_processed:{query_sig}"
        ledger = self._load_topic_ledger(collection_name=collection_name, prompt_key=prompt_key, topic_query=topic_query)
        done_keys = set((ledger.get("items") or {}).keys())

        items = self.get_all_items(collection_name=collection_name, cache=False) or []
        if limit is not None:
            items = items[:max(0, int(limit))]

        queued = 0
        skipped_by_tag = 0
        skipped_by_ledger = 0
        skipped_no_abstract = 0

        for it in items:
            item_key = (it or {}).get("key")
            if not item_key:
                continue
            data = (it or {}).get("data", {}) if isinstance((it or {}).get("data"), dict) else {}
            existing_tags = [str((t or {}).get("tag") or "") for t in (data.get("tags") or [])]
            if processed_tag in existing_tags:
                skipped_by_tag += 1
                continue
            if item_key in done_keys:
                skipped_by_ledger += 1
                continue
            abstract = str(data.get("abstractNote") or "").strip()
            if not abstract:
                skipped_no_abstract += 1
                continue
            self.code_single_item_from_abstract(
                item=it,
                prompt_key=prompt_key,
                read=False,
                store_only=True,
                research_question=topic_query,
                collection_name=collection_name,
                cache=False,
            )
            queued += 1

        return {
            "collection_name": collection_name,
            "prompt_key": prompt_key,
            "topic_query": topic_query,
            "query_sig": query_sig,
            "queued": queued,
            "skipped_by_tag": skipped_by_tag,
            "skipped_by_ledger": skipped_by_ledger,
            "skipped_no_abstract": skipped_no_abstract,
        }

    def apply_topic_batch_results(self,
                                  collection_name: str,
                                  topic_query: str,
                                  subfolder_name: str | None = None,
                                  prompt_key: str = "classify_abstract_topic_membership_v1",
                                  min_confidence: float = 0.5) -> dict:
        """
        Applies completed batch output to Zotero:
          - creates/gets subcollection under `collection_name`
          - adds matched items to subcollection
          - adds query tags + suggested tags
          - writes/updates per-query ledger for idempotent re-runs
        """
        import re
        from datetime import datetime, timezone

        query = str(topic_query or "").strip()
        if not query:
            raise ValueError("topic_query cannot be empty")

        subfolder = (subfolder_name or query).strip()
        query_sig = self._topic_query_signature(query)
        processed_tag = f"#topic_processed:{query_sig}"
        match_tag = f"#topic_match:{query_sig}"
        query_tag = f"#topic_query:{query}"

        _func_dir, input_path, output_path = self._topic_batch_paths(collection_name=collection_name, prompt_key=prompt_key)
        if not input_path.is_file() or not output_path.is_file():
            raise FileNotFoundError(f"Missing batch files. input='{input_path}' output='{output_path}'")

        # Map custom_id -> item_key from input JSONL.
        id_to_item: dict[str, str] = {}
        for ln in input_path.read_text(encoding="utf-8").splitlines():
            if not ln.strip():
                continue
            try:
                obj = json.loads(ln)
                cid = str(obj.get("custom_id") or "")
                body = obj.get("body") or {}
                input_arr = body.get("input") or []
                user_content = ""
                if len(input_arr) > 1 and isinstance(input_arr[1], dict):
                    user_content = str(input_arr[1].get("content") or "")
                m = re.search(r"\n\n(\{[\s\S]*\})\s*$", user_content)
                if not m:
                    continue
                payload = json.loads(m.group(1))
                item_key = str(payload.get("item_key") or "")
                if cid and item_key:
                    id_to_item[cid] = item_key
            except Exception:
                continue

        parent_key = self.find_or_create_top_collection(collection_name)
        if not parent_key:
            raise RuntimeError(f"Could not resolve parent collection '{collection_name}'")
        sub_key = self.find_or_create_subcollection(subcoll_name=subfolder, parent_key=parent_key)
        if not sub_key:
            raise RuntimeError(f"Could not resolve/create subcollection '{subfolder}'")

        ledger = self._load_topic_ledger(collection_name=collection_name, prompt_key=prompt_key, topic_query=query)
        ledger.setdefault("query", query)
        ledger_items = ledger.setdefault("items", {})
        now = datetime.now(timezone.utc).isoformat()

        total = 0
        matched = 0
        updated = 0
        added_to_subfolder = 0
        already_processed = 0
        parse_errors = 0

        for ln in output_path.read_text(encoding="utf-8").splitlines():
            if not ln.strip():
                continue
            total += 1
            try:
                row = json.loads(ln)
                cid = str(row.get("custom_id") or "")
                item_key = id_to_item.get(cid)
                if not item_key:
                    parse_errors += 1
                    continue

                if item_key in ledger_items and (ledger_items[item_key] or {}).get("processed") is True:
                    already_processed += 1
                    continue

                body = ((row.get("response") or {}).get("body") or {})
                out = body.get("output") or []
                output_text = ""
                for block in out:
                    if block.get("type") == "message":
                        for c in block.get("content") or []:
                            if c.get("type") == "output_text":
                                output_text = str(c.get("text") or "")
                                break
                    if output_text:
                        break
                parsed = json.loads(output_text) if output_text else {}
                is_match = bool(parsed.get("is_match") is True)
                conf = float(parsed.get("confidence") or 0.0)
                should_add = bool(is_match and conf >= float(min_confidence))
                if should_add:
                    matched += 1

                item = self.zot.item(item_key)
                existing_tags = [str((t or {}).get("tag") or "") for t in ((item.get("data") or {}).get("tags") or [])]
                tags_to_add = [processed_tag, query_tag]
                if should_add:
                    tags_to_add.append(match_tag)
                for t in (parsed.get("suggested_tags") or []):
                    tt = str(t or "").strip()
                    if tt:
                        tags_to_add.append(tt)
                merged = existing_tags[:]
                for t in tags_to_add:
                    if t not in merged:
                        merged.append(t)
                self.update_zotero_item_feature(item=item, updates={"tags": [{"tag": t} for t in merged]}, append=False)
                updated += 1

                if should_add:
                    self.add_items_to_collection(collection_key=sub_key, items_keys=item_key)
                    added_to_subfolder += 1

                ledger_items[item_key] = {
                    "processed": True,
                    "processed_at": now,
                    "custom_id": cid,
                    "is_match": is_match,
                    "confidence": conf,
                    "added_to_subfolder": should_add,
                }
            except Exception:
                parse_errors += 1
                continue

        self._save_topic_ledger(collection_name=collection_name, prompt_key=prompt_key, topic_query=query, ledger=ledger)
        return {
            "collection_name": collection_name,
            "subfolder_name": subfolder,
            "subfolder_key": sub_key,
            "prompt_key": prompt_key,
            "query_sig": query_sig,
            "total_output_rows": total,
            "matched_rows": matched,
            "items_updated": updated,
            "items_added_to_subfolder": added_to_subfolder,
            "already_processed_skipped": already_processed,
            "parse_errors": parse_errors,
            "ledger_path": str(self._topic_ledger_path(collection_name=collection_name, prompt_key=prompt_key, topic_query=query)),
        }

    def import_json_folder(self, folder_path: str) -> list[str]:
        from pathlib import Path
        from tqdm import tqdm
        import logging
        import json
        import time
        import os

        def _resolve_folder_and_json(p: Path) -> tuple[Path, Path]:
            if p.is_file() and p.suffix.lower() == ".json":
                return p.parent, p
            json_files = sorted(p.glob("*.json"))
            return p, (json_files[0] if len(json_files) > 0 else Path(""))

        def _choose_created_key(resp: dict) -> str:
            if isinstance(resp, dict) and "successful" in resp and "0" in resp["successful"]:
                return resp["successful"]["0"]["key"]
            if isinstance(resp, dict) and "success" in resp and len(resp["success"]) > 0:
                return resp["success"][0]["key"]
            return ""

        def _attachment_key_from_response(resp: dict) -> str:
            if isinstance(resp, dict) and "successful" in resp and resp["successful"]:
                return next(iter(resp["successful"].values())).get("key", "")
            if isinstance(resp, dict) and "success" in resp and resp["success"]:
                return resp["success"][0].get("key", "")
            if isinstance(resp, dict) and "unchanged" in resp and resp["unchanged"]:
                if isinstance(resp["unchanged"], list):
                    return resp["unchanged"][0].get("key", "")
                return next(iter(resp["unchanged"].values())).get("key", "")
            return ""

        def _norm(s: str | None) -> str:
            return (s or "").strip()

        def _fix_creators(creators_in) -> list[dict]:
            fixed: list[dict] = []
            for c in list(creators_in or []):
                if "name" in c and _norm(c.get("name")) != "":
                    fixed.append({"creatorType": c.get("creatorType") or "author", "name": _norm(c["name"])})
                else:
                    fixed.append({
                        "creatorType": c.get("creatorType") or "author",
                        "firstName": _norm(c.get("firstName")),
                        "lastName": _norm(c.get("lastName")),
                    })
            return fixed

        def _fix_tags(tags_in) -> list[dict]:
            out: list[dict] = []
            for t in list(tags_in or []):
                if isinstance(t, dict) and _norm(t.get("tag")) != "":
                    out.append({"tag": _norm(t["tag"])})
                elif isinstance(t, str) and _norm(t) != "":
                    out.append({"tag": _norm(t)})
            return out

        def _abs_pdf_path(raw: str) -> Path:
            # normalise and ensure absolute Windows path like C:\Users\...\file.pdf
            p = Path(raw).expanduser()
            if not p.is_absolute():
                p = p.resolve()
            return p

        def _has_child_with_filename(parent_key: str, filename: str) -> bool:
            # list children and check imported_file with filename match
            children = self.zot.children(parent_key)
            target = os.path.basename(filename)
            for ch in children:
                data = ch.get("data", {})
                if data.get("linkMode") == "imported_file" and data.get("filename") == target:
                    return True
            return False

        base = Path(folder_path).expanduser().resolve()
        folder, json_path = _resolve_folder_and_json(base)

        logging.info(f"[JSON import] folder={folder}")
        logging.info(f"[JSON import] json file={json_path}")

        collection_name = folder.name
        coll_key = self.find_or_create_top_collection(collection_name)
        logging.info(f"[JSON import] collection '{collection_name}' key={coll_key}")

        raw = json_path.read_text(encoding="utf-8")
        payload = json.loads(raw)

        entries = payload["items"] if isinstance(payload, dict) and "items" in payload else payload
        if not isinstance(entries, list):
            raise ValueError("JSON must be a list of item entries or an object containing an 'items' list")

        created_keys: list[str] = []
        bar = tqdm(entries, desc="Importing JSON items", unit="item")

        for idx, entry in enumerate(bar):
            data = entry.get("data") if isinstance(entry, dict) else None
            if not isinstance(data, dict):
                raise ValueError(f"Entry at index {idx} has no 'data' object")

            item_type = _norm(data.get("itemType")) or "report"
            tmpl = self.zot.item_template(item_type)
            allowed = set(tmpl.keys())

            # force our target collection only; drop foreign collection keys to avoid 409
            if "collections" in data:
                data = {k: v for k, v in data.items() if k != "collections"}

            # creators and tags
            if "creators" in data:
                tmpl["creators"] = _fix_creators(data.get("creators"))
            if "tags" in data:
                tmpl["tags"] = _fix_tags(data.get("tags"))

            # copy allowed scalar fields
            for k, v in data.items():
                if k in ("creators", "tags"):
                    continue
                if k in allowed:
                    tmpl[k] = v

            tmpl["collections"] = [coll_key]

            # create parent
            resp = self.zot.create_items([tmpl])
            zid = _choose_created_key(resp)
            if zid == "":
                title_dbg = _norm(tmpl.get("title"))[:80]
                raise RuntimeError(
                    f"[JSON import] create_items returned no key at index {idx}; title='{title_dbg}'; resp={resp}"
                )

            created_keys.append(zid)
            bar.set_postfix_str(_norm(tmpl.get("title"))[:40])
            logging.info(f"[JSON import] created '{tmpl.get('title', 'Untitled')}' key={zid}")

            # optional PDF attach with strong verification and TF32-noise-safe delay for eventual consistency
            pdf_path = entry.get("pdf_path") if isinstance(entry, dict) else None
            if isinstance(pdf_path, str) and pdf_path.strip() != "":
                p = _abs_pdf_path(pdf_path)
                if not (p.is_file() and p.suffix.lower() == ".pdf"):
                    raise FileNotFoundError(f"[JSON import] PDF not found or not a .pdf: {p}")

                # if already attached (re-run safe), skip upload
                if not _has_child_with_filename(zid, str(p)):
                    # brief delay to avoid immediate 502 on fresh parent (observed on groups)
                    time.sleep(0.35)
                    up = self.zot.attachment_simple([str(p)], parentid=zid)
                    att_key = _attachment_key_from_response(up)

                    # if server returned 'unchanged' (common when upload actually succeeded), validate by listing children
                    if att_key == "":
                        time.sleep(0.35)
                        if not _has_child_with_filename(zid, str(p)):
                            raise RuntimeError(
                                f"[JSON import] attachment_simple failed for '{p.name}' → item {zid}; resp={up}"
                            )
                        else:
                            logging.info(f"[JSON import] attached (validated via children) '{p.name}' -> {zid}")
                    else:
                        logging.info(f"[JSON import] attached '{p.name}' -> {zid} (attachment key={att_key})")
                else:
                    logging.info(f"[JSON import] '{p.name}' already attached to {zid}; skipping upload")

            # optional notes
            notes = entry.get("notes") if isinstance(entry, dict) else None
            if isinstance(notes, list) and len(notes) > 0:
                for n in notes:
                    if isinstance(n, str) and _norm(n) != "":
                        note_item = {"itemType": "note", "parentItem": zid, "note": n, "tags": []}
                        self.zot.create_items([note_item])
                    elif isinstance(n, dict) and _norm(n.get("note")) != "":
                        note_item = {"itemType": "note", "parentItem": zid, "note": n["note"],
                                     "tags": (n.get("tags") or [])}
                        self.zot.create_items([note_item])

        logging.info(f"[JSON import] done: created={len(created_keys)} items in collection '{collection_name}'")
        return created_keys

    def export_json(self, collection_name: str, path: str = r"C:\Users\luano\Downloads", cache: bool = False) -> "Path":
        from pathlib import Path
        from typing import List, Dict, Any
        from tqdm import tqdm
        import logging
        import json
        import datetime

        out_dir: Path = Path(path).expanduser().resolve()
        ts: str = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        safe_name: str = "".join(ch if ch.isalnum() or ch in ("_", "-", ".") else "_" for ch in collection_name).strip(
            "_")
        outfile: Path = out_dir / f"{safe_name}_export_{ts}.json"

        logging.info(f"[export_json] collection='{collection_name}' → {outfile}")
        items: List[Dict[str, Any]] = self.get_all_items(collection_name=collection_name, cache=cache)
        logging.info(f"[export_json] total items fetched: {len(items)}")

        export_list: List[Dict[str, Any]] = []
        pbar = tqdm(items, desc=f"Exporting '{collection_name}'", unit="item")

        for it in pbar:
            # Normalize shape to always have top-level keys similar to Zotero API
            # Prefer to preserve the full object if already in API format
            has_meta: bool = isinstance(it, dict) and "data" in it and "key" in it.get("data", {})
            item_obj: Dict[str, Any] = it if has_meta else {"data": it}

            data: Dict[str, Any] = item_obj.get("data", {})
            item_key: str = data.get("key", "")

            pdf_path: str = ""
            if item_key:
                # User-provided helper in zotero_class should return a filesystem path or ""
                pdf_path = self.get_pdf_path_for_item(item_key)

            enriched: Dict[str, Any] = {
                "key": item_obj.get("key", data.get("key", "")),
                "version": item_obj.get("version", data.get("version", 0)),
                "library": item_obj.get("library", {}),
                "links": item_obj.get("links", {}),
                "meta": item_obj.get("meta", {}),
                "data": data,
                "collection_name": collection_name,
                "pdf_path": pdf_path,
            }

            export_list.append(enriched)
            title_for_bar: str = data.get("title", "") or data.get("shortTitle", "") or item_key
            if title_for_bar:
                pbar.set_postfix_str(title_for_bar[:40])

        outfile.parent.mkdir(parents=True, exist_ok=True)
        with outfile.open("w", encoding="utf-8") as f:
            json.dump(export_list, f, ensure_ascii=False, indent=2)

        logging.info(f"[export_json] saved {len(export_list)} records → {outfile}")
        return outfile

    def import_rdf_folder(self, folder_path: str) -> None:
            from pathlib import Path
            from xml.etree import ElementTree as ET
            from tqdm import tqdm
            import logging

            def _text(node, default=""):
                return (node.text or "").strip() if node is not None and node.text is not None else default

            def _find_first_rdf_file(folder: Path) -> Path:
                rdf_files = sorted(folder.glob("*.rdf"))
                return rdf_files[0] if len(rdf_files) > 0 else Path("")

            def _ns():
                return {
                    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
                    "dc": "http://purl.org/dc/elements/1.1/",
                    "dcterms": "http://purl.org/dc/terms/",
                    "bib": "http://purl.org/net/biblio#",
                    "z": "http://www.zotero.org/namespaces/export#",
                    "link": "http://purl.org/rss/1.0/modules/link/",
                    "foaf": "http://xmlns.com/foaf/0.1/",
                    "prism": "http://prismstandard.org/namespaces/1.2/basic/",
                    "vcard": "http://nwalsh.com/rdf/vCard#",
                }

            def _itemtype_map(tag_name: str) -> str:
                t = tag_name.lower()
                if t == "article":
                    return "journalArticle"
                if t == "report":
                    return "report"
                if t == "book":
                    return "book"
                if t == "chapter":
                    return "bookSection"
                if t == "thesis":
                    return "thesis"
                return "report"

            def _creators(item_elem, nsmap):
                out = []
                for creator in item_elem.findall(".//bib:authors//rdf:Seq//rdf:li", nsmap):
                    name = _text(creator)
                    if name != "":
                        out.append({"creatorType": "author", "name": name})
                for ed in item_elem.findall(".//bib:editors//rdf:Seq//rdf:li", nsmap):
                    name = _text(ed)
                    if name != "":
                        out.append({"creatorType": "editor", "name": name})
                return out

            def _collect_tags(item_elem, nsmap):
                tags = []
                for subj in item_elem.findall(".//dc:subject", nsmap):
                    tag_val = _text(subj)
                    if tag_val != "":
                        tags.append({"tag": tag_val})
                return tags

            def _identifier_url(item_elem, nsmap):
                uri_val = item_elem.find(".//dc:identifier//dcterms:URI//rdf:value", nsmap)
                if uri_val is not None and _text(uri_val) != "":
                    return _text(uri_val)
                plain = item_elem.find(".//dc:identifier", nsmap)
                return _text(plain)

            folder = Path(folder_path).expanduser().resolve()
            collection_name = folder.name
            logging.info(f"[RDF import] folder={folder}")
            coll_key = self.find_or_create_top_collection(collection_name)
            logging.info(f"[RDF import] collection key={coll_key} for '{collection_name}'")

            rdf_file = _find_first_rdf_file(folder)
            logging.info(f"[RDF import] rdf file={rdf_file}")

            nsmap = _ns()
            tree = ET.parse(str(rdf_file))
            root = tree.getroot()

            # 1) create parent items (Article/Report/Book/Chapter/Thesis), keep a map from rdf:about -> zotero key
            parent_xpath = [
                ".//bib:Article",
                ".//bib:Report",
                ".//bib:Book",
                ".//bib:Chapter",
                ".//bib:Thesis",
            ]
            all_parent_elems = []
            for xp in parent_xpath:
                found = root.findall(xp, nsmap)
                if len(found) > 0:
                    all_parent_elems.extend(found)

            created_map = {}  # rdf_about -> zot_item_key

            pbar_items = tqdm(all_parent_elems, desc="Creating items", unit="item")
            for elem in pbar_items:
                about = elem.attrib.get(f"{{{nsmap['rdf']}}}about", "")
                tag_name = elem.tag.split("}")[1]
                zot_type = _itemtype_map(tag_name)

                title = _text(elem.find(".//dc:title", nsmap))
                date_str = _text(elem.find(".//dc:date", nsmap))
                url_str = _identifier_url(elem, nsmap)
                creators = _creators(elem, nsmap)
                tags = _collect_tags(elem, nsmap)

                tmpl = self.zot.item_template(zot_type)
                tmpl["collections"] = [coll_key] if coll_key else []
                tmpl["title"] = title if title != "" else "Untitled"
                if date_str != "":
                    if zot_type in ("case",):
                        tmpl["dateDecided"] = date_str
                    else:
                        tmpl["date"] = date_str
                if url_str != "":
                    tmpl["url"] = url_str
                if len(creators) > 0:
                    tmpl["creators"] = creators
                if len(tags) > 0:
                    tmpl["tags"] = tags

                resp = self.zot.create_items([tmpl])
                # pyzotero returns a dict with 'successful' or 'success'
                if isinstance(resp, dict) and "successful" in resp and "0" in resp["successful"]:
                    item_key = resp["successful"]["0"]["key"]
                elif isinstance(resp, dict) and "success" in resp and len(resp["success"]) > 0:
                    item_key = resp["success"][0]["key"]
                else:
                    item_key = ""

                if item_key != "":
                    created_map[about] = item_key
                    if coll_key:
                        self.add_items_to_collection(collection_key=coll_key, items_keys=[item_key])
                    logging.info(f"[RDF import] created item '{title}' key={item_key} from {about}")
                pbar_items.set_postfix_str(f"{title[:40]}")

            # 2) attach PDFs: <rdf:Description> having <z:itemType>attachment</z:itemType> + <link:link rdf:resource="...pdf">
            att_elems = root.findall(".//rdf:Description[z:itemType='attachment']", nsmap)
            pbar_atts = tqdm(att_elems, desc="Attaching PDFs", unit="file")
            for att in pbar_atts:
                parent_ref_node = att.find(".//dcterms:isPartOf", nsmap)
                parent_ref = parent_ref_node.attrib.get(f"{{{nsmap['rdf']}}}resource",
                                                        "") if parent_ref_node is not None else ""
                link = att.find(".//link:link", nsmap)
                pdf_rel = link.attrib.get(f"{{{nsmap['rdf']}}}resource", "") if link is not None else ""
                if parent_ref in created_map and pdf_rel.endswith(".pdf"):
                    full_pdf = folder / pdf_rel
                    item_key = created_map[parent_ref]
                    if full_pdf.is_file():
                        self.attach_file_to_item(parent_item_id=item_key, file_path=str(full_pdf))
                        logging.info(f"[RDF import] attached '{full_pdf.name}' -> {item_key}")
                    else:
                        logging.info(f"[RDF import] missing '{full_pdf}' for parent {item_key}")
                if link is not None:
                    pbar_atts.set_postfix_str(Path(pdf_rel).name if pdf_rel != "" else "")

            # 3) add notes: <rdf:Description><z:itemType>note</z:itemType><dcterms:isPartOf .../><z:note>HTML</z:note>
            note_elems = root.findall(".//rdf:Description[z:itemType='note']", nsmap)
            pbar_notes = tqdm(note_elems, desc="Adding notes", unit="note")
            for note in pbar_notes:
                parent_ref_node = note.find(".//dcterms:isPartOf", nsmap)
                parent_ref = parent_ref_node.attrib.get(f"{{{nsmap['rdf']}}}resource",
                                                        "") if parent_ref_node is not None else ""
                html_node = note.find(".//z:note", nsmap)
                html = _text(html_node)
                if parent_ref in created_map and html != "":
                    note_item = {
                        "itemType": "note",
                        "parentItem": created_map[parent_ref],
                        "note": html,
                        "tags": [],
                    }
                    self.zot.create_items([note_item])
                    logging.info(f"[RDF import] note added to {created_map[parent_ref]} (len={len(html)})")

            # 4) final log summary
            logging.info(
                f"[RDF import] done: parents={len(created_map)} attachments={len(att_elems)} notes={len(note_elems)}")




import re, html, logging, importlib
from pathlib  import Path




# ═════════════════════════════════════════════════════════════════════════════
# helpers ─────────────────────────────────────────────────────────────────────
# ═════════════════════════════════════════════════════════════════════════════
_PUA_ZERO  = 0xF643                                   # 
_PUA_DIGIT = {chr(_PUA_ZERO + i): str(i) for i in range(10)}
SOFT_HYPH  = "\u00AD"                                 # discretionary hyphen

def _normalise(text: str) -> str:
    """• map PUA digits → 0-9   • remove soft hyphen   • de-hyphenate line-breaks"""
    # PUA → ASCII digits + remove soft hyphen
    txt = "".join(_PUA_DIGIT.get(ch, ch) for ch in text).replace(SOFT_HYPH, "")
    # de-hyphenate words split at EOL:  opera-\n tion  →  operation
    return re.sub(r"-\s*\n\s*(\w)", r"\1", txt)


def _markdown(text: str) -> str:
    """optional markdown→HTML if the `markdown` module is installed"""
    if importlib.util.find_spec("markdown"):
        md = importlib.import_module("markdown")
        return md.markdown(text)
    return html.escape(text, quote=False)
#
#
# # ═════════════════════════════════════════════════════════════════════════════
# # core extraction ─────────────────────────────────────────────────────────────
# # ═════════════════════════════════════════════════════════════════════════════
# def check_keyword_details_pdf(
#     pdf_path : Union[str, Path],
#     keywords : Union[str, List[str]],
# ) -> Optional[Dict[str, Union[int, List[Dict[str, Any]]]]]:
#     """
#     Same signature as before, but the foot-note extraction works for:
#       • dashed-rule pages               (---- separator)
#       • pages with ‘n note text’ lines  (no separator)
#     """
#
#     pdf = Path(pdf_path)
#     if not pdf.exists():
#         logging.error("File not found: %s", pdf)
#         return None
#
#     kw_list = [keywords] if isinstance(keywords, str) else list(keywords)
#     if not kw_list:
#         return {"total": 0, "matches": []}
#
#     kw_regex = {kw: re.compile(rf"\b{re.escape(kw)}\b", re.I) for kw in kw_list}
#     footnotes: Dict[int, str]         = {}
#     body_pages: Dict[int, str]        = {}
#
#     # ─────────────  PDF → markdown  ──────────────
#     pages = pymupdf4llm.to_markdown(str(pdf), page_chunks=True, write_images=False)
#     print(pages)
#     for page_num, page in enumerate(pages, start=1):
#         txt = _normalise(page.get("text", ""))
#         print("test")# digits, soft-hyphens, de-hyphenation
#         print(txt)
#         # 1) try “-----” rule first – works for many law reviews
#         split = re.split(r"\n-{3,}\n", txt, maxsplit=1)
#         body, notes_src = (split + [""])[:2]
#
#         # 2) if no dashed rule and we STILL have no notes,
#         #    look for   “  78 something …”
#         if not notes_src.strip():
#             m = re.search(r"\n\s*\d{1,3}\s+.+", txt)
#             if m:
#                 idx = m.start()
#                 body, notes_src = txt[:idx], txt[idx:]
#
#         body_pages[page_num] = body
#
#         # ---- collect notes in notes_src ------------------------------------
#         for m in re.finditer(
#                 r"^\s*(\d{1,3})\s+(.+?)"
#                 r"(?=^\s*\d{1,3}\s+|\Z)",           # until next “n …” or end
#                 notes_src, flags=re.M | re.S):
#             num  = int(m.group(1))
#             note = " ".join(l.strip() for l in m.group(2).splitlines()).strip()
#             if note and num not in footnotes:       # first occurrence wins
#                 footnotes[num] = note
#
#     # ─────────────  replace citations & highlight  ──────────────
#     def linkify(txt: str) -> str:
#         def repl(m):
#             n  = int(m.group(1))
#             note = html.escape(footnotes.get(n, "note missing"), quote=True)
#             return f'<sup><a href="#" title="{note}">[{n}]</a></sup>'
#         return re.sub(r"\[(\d{1,3})\]", repl, txt)
#
#     matches, seen, total = [], set(), 0
#     for pg, body in body_pages.items():
#         for para in re.split(r"\n{2,}", body):
#             para = para.strip()
#             if not para:
#                 continue
#             linked = linkify(para)
#             for kw, pat in kw_regex.items():
#                 if not pat.search(linked):
#                     continue
#                 highlighted = pat.sub(lambda m: f"<mark>{m.group(0)}</mark>", linked)
#                 k = (highlighted, pg, kw)
#                 if k in seen:
#                     continue
#                 seen.add(k)
#                 total += len(pat.findall(linked))
#                 matches.append({"keyword": kw,
#                                 "paragraph": highlighted,
#                                 "page": pg})
#
#     return {"total": total, "matches": matches}
from collections import OrderedDict
from typing import Dict, Any, List, Tuple


def merge_sections_min_words(sections_map: Dict[str, Any] | None, min_words: int = 500) -> Dict[str, str]:
    """
    Merge adjacent sections so that no emitted section has fewer than `min_words`
    words (unless the entire document is shorter). Returns an ordered dict-like
    (insertion order preserved) mapping merged_key -> merged_text.

    Rules:
      - Short runs (< min_words) are accumulated.
      - If the next section is BIG (>= min_words) and the buffer is still SHORT,
        the buffer is merged INTO that big section (so the short one never stays alone).
      - If the buffer itself reaches >= min_words, it is emitted on its own.
      - Any trailing short buffer at EOF is merged into the last emitted chunk; if
        none exists, it is emitted as-is (document shorter than threshold).
    """

    def _text(val: Any) -> str:
        if isinstance(val, dict):
            return (val.get("text") or val.get("content") or val.get("raw") or "").strip()
        return str(val or "").strip()

    if not isinstance(sections_map, dict) or not sections_map:
        return {}

    merged_pairs: list[tuple[str, str]] = []
    buf_keys: list[str] = []
    buf_texts: list[str] = []
    buf_words = 0

    for k, v in sections_map.items():  # relies on insertion order (Py3.7+)
        s = _text(v)
        if not s:
            continue
        w = len(s.split())

        if w >= min_words:
            if buf_texts:
                # If buffer already big, flush it first; else glue buffer into this big section
                if buf_words >= min_words:
                    merged_pairs.append((" + ".join(buf_keys), "\n\n".join(buf_texts).strip()))
                    buf_keys, buf_texts, buf_words = [], [], 0
                    # now emit the big one alone
                    merged_pairs.append((str(k), s))
                else:
                    # glue short buffer + big into one chunk
                    glued_key = " + ".join(buf_keys + [str(k)])
                    glued_text = ("\n\n".join(buf_texts + [s])).strip()
                    merged_pairs.append((glued_key, glued_text))
                    buf_keys, buf_texts, buf_words = [], [], 0
            else:
                # no buffer; big stands alone
                merged_pairs.append((str(k), s))
        else:
            # accumulate short section
            buf_keys.append(str(k))
            buf_texts.append(s)
            buf_words += w
            # if buffer now big enough, flush it
            if buf_words >= min_words:
                merged_pairs.append((" + ".join(buf_keys), "\n\n".join(buf_texts).strip()))
                buf_keys, buf_texts, buf_words = [], [], 0

    # Handle trailing short buffer
    if buf_texts:
        if merged_pairs:
            # merge tail into last emitted chunk
            prev_k, prev_s = merged_pairs.pop()
            new_k = f"{prev_k} + {' + '.join(buf_keys)}"
            tail_text = "\n\n".join(buf_texts).strip()
            new_s = f"{prev_s}\n\n{tail_text}".strip()
            merged_pairs.append((new_k, new_s))
        else:
            # whole doc is short; emit as-is
            merged_pairs.append((" + ".join(buf_keys), "\n\n".join(buf_texts).strip()))

    return dict(merged_pairs)
