import hashlib
import html



COPIED_COOKIE_STRING = """_ga=GA1.1.1617136709.1731465315; nmstat=d1d9f1a8-af6d-bcbe-9bba-8199a2699e23; __utmc=121613075; __utmz=121613075.1747845726.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); _ga_JNVXX5VRKF=GS2.1.s1747845767$o1$g0$t1747846924$j0$l0$h0; __utma=121613075.1617136709.1731465315.1747845726.1747851963.2; _ga_67X1G0DGL9=GS2.1.s1747861668$o3$g0$t1747861668$j0$l0$h0; _ga_ZC7E8DWE3S=GS2.1.s1747861668$o3$g1$t1747861683$j0$l0$h0; _ga_DKBJ584YLP=GS2.1.s1747861668$o3$g1$t1747861697$j0$l0$h0; ak_bmsc=0592AE56087EF888989F434E1D171093~000000000000000000000000000000~YAAQNu1lX3ClPfSWAQAA9rqv9Bsdvu4DgkQEfJSKCfwB32F1ub9hD2nteXO/6fI5UPy4K5eucrymNlPHC5tdEDw8hqr0iMAdqqrEfCLQ87li+pmeiv1jiGvK4VS/7Ti/XMHn1fLI2c4YvzAqulXvhAMDgMgc50w6CjAfuQdqjMCbZEYz4zY+0SYGKBT0+41SsNZqp93dYRi0ZO/esVvil7SLraVJ87XyyD6J+N4WbOrOIiFKp5HtBIy1WV3N8y9u2gPPNoml5ug+U7d/8RmTIzTDMZMnhSSoH5tpUyNRxM5TAds7YUP54+2kRnAcNxXmP28PEGgjPJ/db+MMcz6h88EBd2diKM3Gn/1DcENRQOdCs1Olv4zgtpgDWfWXZbKGDtWRnfLFXx+uzQ==; _ga_CSLL4ZEK4L=GS2.1.s1747861668$o25$g1$t1747862921$j0$l0$h0"""
function_key_for_screening = "doj_cyber_indictment_screening"

# Define HEADERS_commons globally
BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",  # Often important
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",  # Common browser header
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",  # Can be 'none', 'same-origin', or 'cross-site'
    "Sec-Fetch-User": "?1",
    # Add more sec-ch-ua headers if you see them in your browser and want to be thorough
    # "Sec-CH-UA": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    # "Sec-CH-UA-Mobile": "?0",
    # "Sec-CH-UA-Platform": '"Windows"',
    "Referer": "https://www.justice.gov/archives/press-releases-archive"
}

if COPIED_COOKIE_STRING:
    CURRENT_HEADERS = {**BASE_HEADERS, "Cookie": COPIED_COOKIE_STRING}
else:
    CURRENT_HEADERS = {**BASE_HEADERS}
# !/usr/bin/env python3
"""
doj_cyber_indictment_scraper_v3.py

This script scrapes and analyzes press releases from the U.S. Department of Justice (DOJ)
website to identify cyber-related indictments. It operates in three main parts:

Part 1: Fetches initial search results from the live DOJ press release section for USAO-NDCA
        (/usao-ndca/pr) and the DOJ press release archive. It uses a fixed base
        keyword (e.g., "indictment") combined with user-provided keywords.
        Results are de-duplicated and cached.

Part 2: For each unique press release URL obtained in Part 1, this part scrapes
        the detailed metadata from the actual press release page using a comprehensive
        extraction logic. Detailed data is cached.

Part 3: The detailed press releases are then processed by a Language Model (LLM)
        (via a local `gpt_api.py` module) to screen them based on specific
        inclusion/exclusion criteria relevant to nation-state cyber activity.
        LLM-screened data is cached.

The script prompts the user before starting each part, allowing them to proceed
or use existing cached data from a previous run.
"""

import os
import re
import time
import random
import itertools
import sys
import json
import copy  # For deepcopy in Part 2's extractor
from datetime import datetime
from typing import List, Dict, Tuple, Optional, Union
from urllib.parse import urljoin, urlparse, quote

import requests
from bs4 import BeautifulSoup
import pandas as pd

# Attempt to import the custom LLM API module
try:
    from gpt_api import call_models, _process_batch_for
except ImportError:
    print("ERROR: gpt_api.py not found or call_models function is missing.", file=sys.stderr)
    print("Part 3 (LLM Screening) will not function without it.", file=sys.stderr)



# --- Global Constants and Configuration ---
COPIED_COOKIE_STRING = None

BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive", "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin", "Sec-Fetch-User": "?1",
}
CURRENT_HEADERS = {**BASE_HEADERS}  # Referer will be added dynamically
if COPIED_COOKIE_STRING:
    CURRENT_HEADERS["Cookie"] = COPIED_COOKIE_STRING.strip()

DOJ_BASE_SITE_URL = "https://www.justice.gov"

FIXED_BASE_KEYWORDS = ["indictment"]
SEARCH_TARGET_CONFIGS = [
    {"name": "USAO-NDCA Press Releases", "base_url": f"{DOJ_BASE_SITE_URL}/usao-ndca/pr"},
    {"name": "Archive Press Releases", "base_url": f"{DOJ_BASE_SITE_URL}/archives/press-releases-archive"}
]

PART1_CACHE_FILE = "part1_initial_combined_search_results.json"
PART2_CACHE_FILE = "part2_detailed_metadata.json"
PART3_CACHE_FILE = "part3_llm_screened_data.json"

# LLM_JSON_SCHEMA = {
#     "type": "object",
#     "properties": {
#         "charges_identified": {
#             "type": "array", "items": {"type": "string"},
#             "description": "Specific legal charges related to cyber activities."
#         },
#         "accused_country_affiliation": {
#             "type": "string",
#             "description": "Primary nation-state link of the accused."
#         },
#         "accused_entities_or_groups": {
#             "type": "array", "items": {"type": "string"},
#             "description": "Names of accused individuals, APT groups, etc."
#         },
#         "screening_status": {
#             "type": "string", "enum": ["Include", "Exclude"],
#             "description": "Decision based on criteria."
#         },
#         "state_link_evidence": {
#             "type": "array", "items": {"type": "string"},
#             "description": "Direct quotes or paraphrases showing state link."
#         },
#         "exclusion_reason": {
#             "type": "string",
#             "description": "Reason for exclusion, if applicable."
#         }
#     },
#     "required": [
#         "charges_identified", "accused_country_affiliation",
#         "accused_entities_or_groups", "screening_status",
#         "state_link_evidence", "exclusion_reason"
#     ],
#     "additionalProperties": False  # <<< ADD THIS LINE
# }
# LLM_SCREENING_PROMPT_TEMPLATE = f"""
# Analyze the provided DOJ press release content...
# JSON Schema:
# {json.dumps(LLM_JSON_SCHEMA, indent=2)}
# """  # Keep full template as before


# --- Helper Functions ---
def extract_year_from_date_string(date_str: Optional[str]) -> Optional[str]:
    """
    Extracts the year from various date string formats.
    """
    if not date_str or not isinstance(date_str, str): return None
    try:
        cleaned_date_str = date_str.replace('Z', '+00:00')
        dt_obj = datetime.fromisoformat(cleaned_date_str)
        return str(dt_obj.year)
    except ValueError:
        try:
            dt_obj = datetime.strptime(date_str, '%B %d, %Y')
            return str(dt_obj.year)
        except ValueError:
            match = re.search(r'\b(\d{4})\b', date_str)
            if match:
                year = int(match.group(1))
                if 1900 <= year <= datetime.now().year + 5: return str(year)
    return None


# This clean_html_content is used by the comprehensive extract_press_release_data_from
def clean_html_content_for_detail_extractor(soup_tag: BeautifulSoup, base_url: str) -> str:
    """
    Cleans the HTML content of a BeautifulSoup tag for the detailed extractor.
    - Removes script, style, and svg tags.
    - Removes unwanted attributes but keeps essential ones (href, src, title, alt, target, rel).
    - Converts relative URLs in href and src to absolute.
    (This is taken from your provided snippet for Part 2)
    """
    if not soup_tag: return ""
    for s in soup_tag.find_all(['script', 'style', 'svg']): s.decompose()
    allowed_attrs = {
        'a': ['href', 'title', 'target', 'rel'],
        'img': ['src', 'alt', 'title', 'width', 'height'],
    }
    default_allowed_attrs = []  # No attributes allowed by default for other tags
    for tag in soup_tag.find_all(True):
        current_allowed = allowed_attrs.get(tag.name, default_allowed_attrs)
        attrs = dict(tag.attrs)  # Iterate over a copy
        for attr_name, attr_value in attrs.items():
            if attr_name not in current_allowed:
                del tag[attr_name]
            else:
                if attr_name in ['href', 'src'] and isinstance(attr_value, str):
                    tag[attr_name] = urljoin(base_url, attr_value)
    return str(soup_tag)


def get_cleaned_text_for_llm(html_str: Optional[str], max_length: int = 15000) -> str:
    """Converts HTML to plain text for LLM, removing boilerplate and truncating."""
    # ... (Keep this function as in the previous response) ...
    if not html_str: return "N/A (No description HTML provided)"
    try:
        soup = BeautifulSoup(html_str, "html.parser")
        end_phrases = ["An indictment is merely an allegation", "The investigation is ongoing.",
                       "Assistant U.S. Attorney", "This case is being investigated by",
                       "The charges contained in the indictment are merely accusations",
                       "The charges in the indictment are merely accusations",
                       "A complaint is merely an allegation and the defendant is presumed innocent",
                       "A criminal complaint is merely an accusation", "The charges in this case are allegations",
                       "Justice Department's Office of Public Affairs"]
        text_content = soup.get_text(separator="\n", strip=True)
        truncate_at = len(text_content)
        for phrase in end_phrases:
            idx = text_content.lower().rfind(phrase.lower())
            if idx != -1 and idx < truncate_at and idx > len(text_content) * 0.70: truncate_at = idx
        cleaned_text = text_content[:truncate_at].strip()
        cleaned_text = re.sub(r'\n\s*\n', '\n\n', cleaned_text);
        cleaned_text = re.sub(r' +', ' ', cleaned_text)
        return cleaned_text[:max_length] + ("..." if len(cleaned_text) > max_length else "")
    except Exception as e:
        print(f"Error cleaning HTML for LLM: {e}", file=sys.stderr);
        return "N/A (Error processing description HTML)"


# --- Part 1: Fetching Initial Search Results ---
def fetch_paginated_results_from_search_api(
        session: requests.Session,
        search_api_base_url: str,
        query_params_for_search: dict,
        search_source_name: str,
        max_pages_hard_limit: int = 30
) -> List[Dict]:
    """
    Fetches and parses results for a single query from a DOJ Search API endpoint, handling pagination.
    """
    print(f"  Initiating search on '{search_source_name}' (Base URL: {search_api_base_url})")
    print(f"  Query Parameters: {query_params_for_search}")

    single_query_results = []
    total_results_reported_by_site: Optional[int] = None
    first_page_processed = False
    consecutive_empty_pages = 0

    for page_num in itertools.count(start=0):
        if page_num >= max_pages_hard_limit:
            print(
                f"    Reached hard page limit ({max_pages_hard_limit}) for '{search_source_name}'. Stopping this query.")
            break

        current_page_params = {**query_params_for_search, "page": str(page_num)}
        dynamic_headers = {**CURRENT_HEADERS, "Referer": search_api_base_url}

        try:
            time.sleep(random.uniform(1.8, 3.2))
            response = session.get(search_api_base_url, params=current_page_params, headers=dynamic_headers, timeout=30)
            prepared_request_url = response.url
            print(f"    Fetching page {page_num} ({search_source_name}): {prepared_request_url}")
            print(f"      Response status: {response.status_code}")
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"      Error fetching page {page_num} for '{search_source_name}': {e}", file=sys.stderr)
            if hasattr(e, 'response') and e.response is not None:
                if e.response.status_code == 403:
                    print("      Received 403 Forbidden.", file=sys.stderr)
                elif e.response.status_code == 404:
                    print(f"      404 Not Found.", file=sys.stderr)
            break

        soup = BeautifulSoup(response.content, 'html.parser')

        if not first_page_processed:
            count_div = soup.find('div', class_='results-count')
            if count_div:
                count_text = count_div.get_text(strip=True);
                match = re.search(r"(\d+)", count_text)
                if match: total_results_reported_by_site = int(match.group(1))
                print(
                    f"      Site reports {total_results_reported_by_site if total_results_reported_by_site is not None else 'N/A'} total results for this query from '{search_source_name}'.")
            else:
                print(f"      Could not find 'results-count' div on first page of '{search_source_name}'.")
            first_page_processed = True

        no_results_tag = soup.find('div', class_='view-empty')
        if no_results_tag and "no results" in no_results_tag.get_text(strip=True, separator=" ").lower():
            print(f"      'No results found' message on page {page_num} for '{search_source_name}'. Stopping.")
            break

        page_results_tags = soup.select(
            'div.view-content div.views-row, div.rows-wrapper div.views-row, article.news-content-listing')
        if not page_results_tags: page_results_tags = soup.select(
            'div.item-list ul li article, div.search-results ol li article')

        if not page_results_tags:
            if page_num == 0 and (total_results_reported_by_site == 0 or total_results_reported_by_site is None):
                print(
                    f"      No result items on page 0 for '{search_source_name}' (reported: {total_results_reported_by_site}).")
            elif page_num == 0:
                print(
                    f"      No result items on page 0 for '{search_source_name}' (reported: {total_results_reported_by_site}). Check structure.")
            else:
                print(f"      No result items on page {page_num} for '{search_source_name}'. Assuming end.")
            break

        found_on_page_count = 0
        for item_tag in page_results_tags:
            article_content_tag = item_tag.find('article',
                                                class_=re.compile(r'node-press-release|news-content-listing', re.I))
            if not article_content_tag: article_content_tag = item_tag if 'article' in item_tag.name else None
            if not article_content_tag: continue
            title_tag = article_content_tag.find(['h2', 'h3'], class_=re.compile(r'title|news-title', re.I))
            link_tag = title_tag.find('a', href=True) if title_tag else article_content_tag.find('a', href=True,
                                                                                                 title=True)
            if not link_tag: continue
            title_text_raw = link_tag.get_text(" ", strip=True)
            title_span_inside = link_tag.find('span', class_=re.compile(r'field-formatter--string', re.I))
            title_text = html.unescape(
                title_span_inside.get_text(" ", strip=True) if title_span_inside else title_text_raw)
            absolute_url = urljoin(DOJ_BASE_SITE_URL, link_tag['href'])
            snippet_text_raw = ""
            teaser_selectors = ['.field-formatter--smart-trim p', '.field_teaser p',
                                '.views-field-field-body-summary p', '.search-snippet', 'div.text-formatted p']
            for sel in teaser_selectors:
                teaser_p = article_content_tag.select_one(sel)
                if teaser_p: snippet_text_raw = teaser_p.get_text(" ", strip=True); break
            if not snippet_text_raw:
                for sel in ['.field-formatter--smart-trim', '.field_teaser']:
                    teaser_div = article_content_tag.select_one(sel)
                    if teaser_div: snippet_text_raw = teaser_div.get_text(" ", strip=True); break
            date_text_raw = None
            date_selectors_time = ['.node-date time', '.field--name-field-date time', '.submitted time',
                                   'time[itemprop="datePublished"]']
            for sel_time in date_selectors_time:
                time_tag = article_content_tag.select_one(sel_time)
                if time_tag: date_text_raw = time_tag.get('datetime') if time_tag.has_attr(
                    'datetime') else time_tag.get_text(strip=True); break
            if not date_text_raw:
                date_selectors_span = ['.node-date', '.field--name-field-date', '.date-display-single',
                                       '.field--name-changed span', '.date']
                for sel_span in date_selectors_span:
                    date_span = article_content_tag.select_one(sel_span)
                    if date_span: date_text_raw = date_span.get_text(strip=True); break

            single_query_results.append({
                "search_source_name": search_source_name,
                "full_query_keywords": query_params_for_search.get("search_api_fulltext", "N/A"),
                "reported_total_for_query_source": total_results_reported_by_site,
                "title": title_text, "url": absolute_url, "snippet": html.unescape(snippet_text_raw),
                "date_string": date_text_raw, "source_page_num": page_num
            })
            found_on_page_count += 1

        print(
            f"      Page {page_num}: Found {found_on_page_count} results. Total for this specific query source: {len(single_query_results)}")

        if total_results_reported_by_site is not None and len(single_query_results) >= total_results_reported_by_site:
            if total_results_reported_by_site > 0: print(
                f"      Collected {len(single_query_results)} items, meeting/exceeding {total_results_reported_by_site} reported. Stopping.")
            break
        if found_on_page_count == 0:
            consecutive_empty_pages += 1
            if consecutive_empty_pages >= 2: print(
                f"      No new results for {consecutive_empty_pages} consecutive pages. Assuming end."); break
        else:
            consecutive_empty_pages = 0

    return single_query_results


def run_part1_fetch_search_data(
        user_keywords: List[str],
        target_site_configs: List[Dict] = SEARCH_TARGET_CONFIGS,
        facet_param_str: Optional[str] = None,
        start_date: str = "", end_date: str = "", sort_by: str = "field_date",
        max_pages_per_query_source: int = 30,
        output_cache_file: str = PART1_CACHE_FILE
) -> Optional[str]:
    """Part 1: Fetches initial search data from DOJ search endpoints."""
    print("\n--- Starting Part 1: Fetching Initial Search Data ---")

    all_results_combined = []
    overall_seen_urls = set()
    total_items_processed_across_all_queries = 0

    session = requests.Session()
    try:
        print(f"  Warming up session with a visit to: {DOJ_BASE_SITE_URL}")
        session.get(DOJ_BASE_SITE_URL, headers=CURRENT_HEADERS, timeout=20)
        print(f"  Session warm-up complete. Session cookies: {session.cookies.get_dict()}")
    except requests.exceptions.RequestException as e_warmup:
        print(f"  Warning: Session warm-up request failed: {e_warmup}", file=sys.stderr)

    for user_kw in user_keywords:
        # User keyword is taken as is. If it contains spaces, it will be treated as multiple terms
        # by the Search API if it defaults to AND logic for spaces.
        # If the user *wants* an exact phrase, they should input it with quotes: e.g., "\"exact phrase\""
        current_user_keyword_part = user_kw.strip()

        # Combine FIXED_BASE_KEYWORDS (list) with the current user keyword part
        full_keyword_search_string_parts = FIXED_BASE_KEYWORDS + [current_user_keyword_part]
        full_keyword_search_string = " ".join(part.strip() for part in full_keyword_search_string_parts if part.strip())
        # Example: if FIXED_BASE_KEYWORDS is ["indictment", "charge"] and user_kw is "hacking campaign",
        # full_keyword_search_string will be "indictment charge hacking campaign"
        # which becomes ...search_api_fulltext=indictment+charge+hacking+campaign

        print(f"\nProcessing User Keyword Combo: '{full_keyword_search_string}'")
        items_added_for_this_user_kw = 0

        for site_config in target_site_configs:
            current_query_params = {
                "search_api_fulltext": full_keyword_search_string,
                "start_date": start_date, "end_date": end_date, "sort_by": sort_by
            }
            if facet_param_str:
                if '=' in facet_param_str:
                    facet_key, facet_value = facet_param_str.split('=', 1)
                    current_query_params[facet_key] = facet_value
                else:
                    print(f"Warning: Facet param '{facet_param_str}' malformed. Ignoring.", file=sys.stderr)

            results_from_source = fetch_paginated_results_from_search_api(
                session=session, search_api_base_url=site_config["base_url"],
                query_params_for_search=current_query_params, search_source_name=site_config["name"],
                max_pages_hard_limit=max_pages_per_query_source
            )

            newly_added_this_batch = 0
            for item in results_from_source:
                total_items_processed_across_all_queries += 1
                item_url_lower = item['url'].lower()
                if item_url_lower not in overall_seen_urls:
                    item['original_user_keyword'] = user_kw
                    all_results_combined.append(item)
                    overall_seen_urls.add(item_url_lower)
                    newly_added_this_batch += 1

            print(
                f"  Results from {site_config['name']} for '{full_keyword_search_string}': Collected {len(results_from_source)} raw items, added {newly_added_this_batch} new unique items.")
            items_added_for_this_user_kw += newly_added_this_batch
            if len(target_site_configs) > 1: time.sleep(random.uniform(2, 4))

        print(
            f"  Completed searches for user keyword '{user_kw}'. Added {items_added_for_this_user_kw} new unique items from all sources for this keyword.")
        if len(user_keywords) > 1: time.sleep(random.uniform(4, 7))

    if not all_results_combined:
        print("Part 1: No initial search results found. Nothing to save.");
        return None

    duplicates_found = total_items_processed_across_all_queries - len(all_results_combined)
    print(f"\nPart 1 Summary:")
    print(f"  Total items processed across all queries and sources: {total_items_processed_across_all_queries}")
    print(f"  Total unique items collected: {len(all_results_combined)}")
    print(f"  Total duplicates found and skipped: {duplicates_found}")

    print(f"Saving {len(all_results_combined)} combined de-duplicated results to {output_cache_file}")
    with open(output_cache_file, 'w', encoding='utf-8') as f:
        json.dump(all_results_combined, f, indent=2)
    df = pd.DataFrame(all_results_combined)
    cols_order = ['search_source_name', 'original_user_keyword', 'full_query_keywords',
                  'reported_total_for_query_source', 'title', 'url', 'snippet', 'date_string', 'source_page_num']
    df = df.reindex(columns=[c for c in cols_order if c in df.columns] + [c for c in df.columns if c not in cols_order])
    excel_path = output_cache_file.replace(".json", ".xlsx")
    try:
        df.to_excel(excel_path, index=False, engine='openpyxl'); print(f"Part 1: Also saved to Excel: {excel_path}")
    except Exception as e:
        print(f"Error saving Part 1 Excel: {e}", file=sys.stderr)
    print("--- Part 1 Complete ---")
    return output_cache_file


# --- PART 2: Extracting Detailed Press Release Metadata ---
def extract_press_release_data_from_page(url: str, session: requests.Session) -> Optional[Dict]:
    """
    Extracts detailed information from a single Justice Department press release URL.
    This is the comprehensive version based on your provided snippet.
    """
    # Uses CURRENT_HEADERS which might include the COPIED_COOKIE_STRING
    # For detail pages, a fresh Referer from the URL's own domain is often better.
    dynamic_detail_headers = {**CURRENT_HEADERS, "Referer": urlparse(url).scheme + "://" + urlparse(url).netloc}

    print(f"   Fetching details for URL: {url}")
    try:
        time.sleep(random.uniform(0.8, 1.5))  # Politeness delay
        response = session.get(url, headers=dynamic_detail_headers, timeout=20)
        response.raise_for_status()
        html_content = response.content
    except requests.exceptions.RequestException as e:
        print(f"   Error fetching URL {url}: {e}", file=sys.stderr)
        return None

    soup = BeautifulSoup(html_content, 'html.parser')
    data = {"input_url": url, "title_detail": None, "description_html": None, "date_year_detail": None,
            "updated_date_year_detail": None, "attachments": [], "topics": [], "components": [],
            "related_content": [], "press_release_number": None, "intext_links": []}
    parsed_url_obj = urlparse(url)
    base_url = f"{parsed_url_obj.scheme}://{parsed_url_obj.netloc}"

    # Title
    title_tag = soup.find('h1', class_=re.compile(r'page-title|node__title', re.I))  # More flexible title search
    if title_tag:
        span_tag = title_tag.find('span', class_=re.compile(r'field-formatter--string|node__title__field', re.I))
        data['title_detail'] = html.unescape(
            span_tag.get_text(strip=True) if span_tag else title_tag.get_text(strip=True))

    # Date
    date_div = soup.find('div', class_=re.compile(r'node-date|field--name-field-date', re.I))
    if date_div:
        time_tag = date_div.find('time')
        if time_tag:
            original_date_str = time_tag.get('datetime') or time_tag.get_text(strip=True)
            data['date_year_detail'] = extract_year_from_date_string(original_date_str)
    # Updated Date
    updated_date_tag = soup.find('div', class_=re.compile(r'node-updated-date|field--name-field-updated-date', re.I))
    if updated_date_tag:
        original_updated_date_str = updated_date_tag.get_text(strip=True).replace('Updated ', '').strip()
        data['updated_date_year_detail'] = extract_year_from_date_string(original_updated_date_str)

    # Description / Body
    desc_selectors = [
        ('div', {'class': 'field_body'}),  # Original
        ('div', {'class': lambda x: x and 'field_body' in x.split()}),  # More flexible for field_body_X
        ('div', {'class': 'text-formatted'}),  # Often inside a node-body
        ('div', {'class': 'node-body'}),  # Broader
        ('div', {'property': 'content:encoded'}),  # Common in some RSS/feed driven pages
        ('article', {}),  # Fallback to main article tag
        ('div', {'itemprop': 'articleBody'})
    ]
    description_container_div = None
    for tag_name, attrs in desc_selectors:
        candidate_div = soup.find(tag_name, attrs)
        if candidate_div and len(candidate_div.get_text(" ", strip=True)) > 100:  # Basic check for content
            description_container_div = candidate_div
            break

    if description_container_div:
        desc_copy_for_links = copy.deepcopy(description_container_div)  # Requires 'import copy'
        for link_tag_desc in desc_copy_for_links.find_all('a', href=True):
            href_desc = link_tag_desc.get('href')
            if href_desc and not href_desc.startswith(('mailto:', 'javascript:')):
                temp_link_for_text_desc = copy.deepcopy(link_tag_desc)
                for svg_el_desc in temp_link_for_text_desc.find_all('svg'): svg_el_desc.decompose()
                text_desc = temp_link_for_text_desc.get_text(strip=True)
                absolute_href_desc = urljoin(base_url, href_desc)
                data['intext_links'].append({"text": text_desc, "href": absolute_href_desc})
        desc_copy_for_cleaning = copy.deepcopy(description_container_div)
        data['description_html'] = clean_html_content_for_detail_extractor(desc_copy_for_cleaning, base_url)

    # Attachments
    unique_attachment_hrefs = set()
    attachment_sources = [soup.find('div', class_='node-attachments')]  # Primary
    if description_container_div:  # Also check within description
        attachment_sources.append(description_container_div)

    for source_element in filter(None, attachment_sources):
        # Check for media--document divs
        for media_doc_div in source_element.find_all('div', class_=lambda
                x: x and 'media--type-document' in x.split()):  # More specific Drupal 9/10 media
            link_tag_media = media_doc_div.find('a', href=True)
            if link_tag_media:
                href_media = link_tag_media['href']
                text_media = link_tag_media.get_text(strip=True) or os.path.basename(urlparse(href_media).path)
                if href_media and (href_media.lower().endswith(('.pdf', '.doc', '.docx', '.zip',
                                                                '.txt')) or '/file/download' in href_media or '/document/download' in href_media):
                    absolute_href_media = urljoin(base_url, href_media)
                    if absolute_href_media not in unique_attachment_hrefs:
                        data['attachments'].append({"text": text_media, "href": absolute_href_media})
                        unique_attachment_hrefs.add(absolute_href_media)
        # Check for direct links with download classes or file extensions
        for link_tag_att in source_element.find_all('a', href=True):
            href_att = link_tag_att['href']
            text_att = link_tag_att.get_text(strip=True) or os.path.basename(urlparse(href_att).path)
            if href_att and (href_att.lower().endswith(('.pdf', '.doc', '.docx', '.zip',
                                                        '.txt')) or '/dl' in href_att or 'downloadable-src' in link_tag_att.get(
                    'class', [])):
                if not href_att.startswith(('mailto:', 'javascript:')):
                    absolute_href_att = urljoin(base_url, href_att)
                    if absolute_href_att not in unique_attachment_hrefs:
                        data['attachments'].append({"text": text_att, "href": absolute_href_att})
                        unique_attachment_hrefs.add(absolute_href_att)
    # Fallback: If no attachments found, check in-text links more broadly
    if not data['attachments'] and data['intext_links']:
        for link_info in data['intext_links']:
            href_intext = link_info['href']
            if href_intext.lower().endswith(
                    ('.pdf', '.doc', '.docx', '.zip', '.txt')) and href_intext not in unique_attachment_hrefs:
                data['attachments'].append(link_info)
                unique_attachment_hrefs.add(href_intext)

    # Topics
    topics_div = soup.find('div', class_=re.compile(r'node-topics|field--name-field-topic', re.I))
    if topics_div:
        items_container_topic = topics_div.find(['div', 'ul'],
                                                class_=re.compile(r'field__items|item-list__items', re.I)) or topics_div
        for topic_item in items_container_topic.find_all(['div', 'li'], class_=re.compile(r'field__item|topic-name',
                                                                                          re.I)):  # Common item classes
            text_topic = topic_item.get_text(strip=True)
            if text_topic and text_topic not in data['topics']: data['topics'].append(text_topic)
    # Components
    components_div = soup.find('div', class_=re.compile(r'node-component|field--name-field-page-agency',
                                                        re.I))  # field-page-agency is common too
    if components_div:
        items_container_comp = components_div.find(['div', 'ul'], class_=re.compile(r'field__items|item-list__items',
                                                                                    re.I)) or components_div
        for item_comp in items_container_comp.find_all(['div', 'li'], class_=re.compile(r'field__item', re.I)):
            link_tag_comp = item_comp.find('a', href=True)
            if link_tag_comp:
                text_comp = link_tag_comp.get_text(strip=True)
                href_comp = urljoin(base_url, link_tag_comp['href'])
                if not any(c['href'] == href_comp for c in data['components']):
                    data['components'].append({"text": text_comp, "href": href_comp})
            elif item_comp.get_text(strip=True) and not any(
                    c['text'] == item_comp.get_text(strip=True) for c in data['components']):  # If no link, take text
                data['components'].append({"text": item_comp.get_text(strip=True), "href": None})

    # Press Release Number
    pr_num_patterns = [
        re.compile(r"Press Release Number[:\s]*([\w.-]+)", re.I),
        re.compile(r"FOR IMMEDIATE RELEASE\s*([\w.-]+)", re.I)  # Common alternative phrasing
    ]
    article_text_for_pr = soup.get_text(" ", strip=True)  # Search whole page text
    for pattern in pr_num_patterns:
        match_pr = pattern.search(article_text_for_pr)
        if match_pr: data['press_release_number'] = match_pr.group(1).strip(); break

    # Related Content (using your provided logic, slightly adapted)
    related_content_block = soup.find('div', id='block-views-block-related-content-related-content-block')
    if not related_content_block: related_content_block = soup.find('div', class_=lambda
        x: x and 'block-views-blockrelated-content' in x)
    if not related_content_block: related_content_block = soup.find('aside',
                                                                    class_=re.compile(r'related-content|sidebar-second',
                                                                                      re.I))  # General sidebar

    if related_content_block:
        items_container_related = related_content_block.find(['div', 'ul'], class_=re.compile(
            r'views-view-grid|item-list|related-content-display', re.I)) or related_content_block
        content_items_related = items_container_related.find_all(['div', 'li'],
                                                                 class_=re.compile(r'views-row|views-col|related-item',
                                                                                   re.I),
                                                                 recursive=False)  # Direct children usually
        if not content_items_related: content_items_related = items_container_related.find_all(['div', 'li'],
                                                                                               recursive=True)[
                                                              :5]  # Fallback, limit to 5

        for item_div_related in content_items_related:
            link_tag_related = item_div_related.find('a', href=True)
            if link_tag_related and link_tag_related.get_text(strip=True):
                related_title = link_tag_related.get_text(strip=True)
                # Teaser for related
                teaser_tag_related = item_div_related.find(['p', 'div'],
                                                           class_=re.compile(r'teaser|summary|description', re.I))
                teaser_text_related = teaser_tag_related.get_text(strip=True) if teaser_tag_related else None
                # Date for related
                date_tag_related = item_div_related.find(['time', 'span'], class_=re.compile(r'date', re.I))
                date_str_related = None
                if date_tag_related: date_str_related = date_tag_related.get('datetime') or date_tag_related.get_text(
                    strip=True)

                data['related_content'].append({
                    "text": related_title, "href": urljoin(base_url, link_tag_related['href']),
                    "teaser": teaser_text_related, "date_string": date_str_related
                })
    return data


def run_part2_extract_detailed_metadata(
        input_cache_file: str = PART1_CACHE_FILE,
        output_cache_file: str = PART2_CACHE_FILE
) -> Optional[str]:
    """Part 2: Scrapes detailed information for each press release URL using the comprehensive extractor."""
    print("\n--- Starting Part 2: Extracting Detailed Press Release Metadata ---")
    if not os.path.exists(input_cache_file):
        print(f"Error: Input cache file '{input_cache_file}' not found.", file=sys.stderr);
        return None
    with open(input_cache_file, 'r', encoding='utf-8') as f:
        initial_results = json.load(f)
    if not initial_results: print("Part 2: No initial results to process."); return None

    print(f"Part 2: Processing {len(initial_results)} items for detailed metadata extraction.")
    all_detailed_data = []
    session = requests.Session()

    for i, item_from_part1 in enumerate(initial_results):
        print(f"Processing item {i + 1}/{len(initial_results)}: {item_from_part1.get('url', 'NO URL')[:100]}")
        if not item_from_part1.get('url') or not item_from_part1['url'].startswith('http'):
            print(f"  Skipping item due to invalid URL: {item_from_part1.get('url')}")
            detailed_info_obj = {"description_html": "SKIPPED - Invalid URL",
                                 "date_year_detail": extract_year_from_date_string(item_from_part1.get('date_string')),
                                 "title_detail": item_from_part1.get('title')}
        else:
            detailed_info_obj = extract_press_release_data_from_page(item_from_part1['url'], session)
            if not detailed_info_obj:  # If extraction failed for some reason
                detailed_info_obj = {"description_html": "ERROR: Detail extraction failed.",
                                     "date_year_detail": extract_year_from_date_string(
                                         item_from_part1.get('date_string')),
                                     "title_detail": item_from_part1.get('title')}

        # Merge, prioritizing fields from detailed_info_obj if they exist
        combined_item = {**item_from_part1, **detailed_info_obj}
        # Ensure critical fields from Part 1 are not overwritten by None from Part 2 if Part 2 failed to find them
        if 'title_detail' not in detailed_info_obj or detailed_info_obj['title_detail'] is None:
            combined_item['title_detail'] = item_from_part1.get('title')
        if 'date_year_detail' not in detailed_info_obj or detailed_info_obj['date_year_detail'] is None:
            combined_item['date_year_detail'] = extract_year_from_date_string(item_from_part1.get('date_string'))

        all_detailed_data.append(combined_item)

    if not all_detailed_data: print("Part 2: No detailed data extracted."); return None
    print(f"Part 2: Saving {len(all_detailed_data)} items with detailed metadata to {output_cache_file}")
    with open(output_cache_file, 'w', encoding='utf-8') as f:
        json.dump(all_detailed_data, f, indent=2)
    df_detailed = pd.DataFrame(all_detailed_data)
    excel_path_detailed = output_cache_file.replace(".json", ".xlsx")
    # Define column order for Excel, ensuring all expected fields from the comprehensive extractor are listed
    part2_excel_cols = [
        'search_source_name', 'original_user_keyword', 'full_query_keywords', 'reported_total_for_query_source',
        'title', 'url', 'snippet', 'date_string',
        'title_detail', 'date_year_detail', 'updated_date_year_detail',
        'press_release_number', 'description_html',
        'attachments', 'topics', 'components', 'related_content', 'intext_links'
    ]
    df_detailed = df_detailed.reindex(columns=[c for c in part2_excel_cols if c in df_detailed.columns] +
                                              [c for c in df_detailed.columns if c not in part2_excel_cols])
    try:
        df_detailed.to_excel(excel_path_detailed, index=False, engine='openpyxl');
        print(f"Part 2: Also saved to Excel: {excel_path_detailed}")
    except Exception as e:
        print(f"Error saving Part 2 Excel: {e}", file=sys.stderr)
    print("--- Part 2 Complete ---")
    return output_cache_file


# --- Part 3: Screening with LLM Model ---
def run_part3_llm_screening(
        input_cache_file: str = PART2_CACHE_FILE,
        output_cache_file: str = PART3_CACHE_FILE,  # Renamed for clarity
        store_only: bool = False
) -> Optional[str]:
    """
    Part 3: Processes detailed press releases using the LLM.

    For each item, it prepares a dictionary of data to be formatted into the
    prompt template defined in the external prompts.json file. It then calls
    the `call_models` function which handles the prompt loading, formatting,
    and either making a direct API call or preparing a batch request.
    """
    print(f"\n--- Starting Part 3: LLM Screening (store_only={store_only}) ---")

    # This key tells call_models which prompt configuration to load and use

    if not os.path.exists(input_cache_file):
        print(f"Error: Input cache file '{input_cache_file}' not found.", file=sys.stderr)
        return None
    with open(input_cache_file, 'r', encoding='utf-8') as f:
        detailed_data = json.load(f)
    if not detailed_data:
        print("Part 3: No detailed data to process.")
        return None

    print(f"Part 3: Processing {len(detailed_data)} items using function_key '{function_key_for_screening}'.")
    llm_screened_results = []  # Will store results if not store_only and read is successful

    for i, item in enumerate(detailed_data):
        # 1. Prepare the dictionary of data for the placeholders in the prompt template
        title_for_llm = item.get('title_detail', item.get('title', 'N/A'))
        snippet_for_llm = item.get('snippet', 'N/A')
        # date_year_for_llm = item.get('date_year_detail', item.get('date_year', "Unknown"))
        # description_html_for_llm = get_cleaned_text_for_llm(item.get('description_html'))

        # This is the dictionary that will be passed as the 'text' argument to call_models.
        # The keys here MUST match the placeholders in your prompts.json template.
        prompt_data_dict = {
            "title": title_for_llm,
            "snippet": snippet_for_llm,
            # "date_year": date_year_for_llm,
            # "description_html_cleaned_for_llm": description_html_for_llm
        }

        if store_only:
            print(f"  Preparing batch request {i + 1}/{len(detailed_data)} for: {title_for_llm[:70]}...")
        else:  # Processing mode (reading results)
            print(f"  Attempting to read/process result {i + 1}/{len(detailed_data)} for: {title_for_llm[:70]}...")

        try:
            custom_id_for_item = hashlib.sha256(str(prompt_data_dict).encode('utf-8')).hexdigest()
            print(prompt_data_dict)
            # 2. Call `call_models` with the data dictionary as the `text` argument
            llm_response_dict = call_models(
                text=str(prompt_data_dict),  # Pass the dictionary of placeholder values
                function_key=function_key_for_screening,
                custom_id=custom_id_for_item,
                store_only=store_only,
                read=not store_only
            )


            if store_only:
                if i == len(detailed_data) - 1:  # After the last item is processed
                    print(f"  All {len(detailed_data)} requests have been prepared for batch file.")
                continue  # Continue to the next item in the loop

            # --- Processing the response if not store_only ---
            if llm_response_dict is None:
                print(
                    f"    Warning: No result found for custom_id {custom_id_for_item}. Item might not be processed yet.")
                llm_analysis = {"error": "Result not found or processing error in batch system."}
            elif isinstance(llm_response_dict, dict) and llm_response_dict.get(
                    "error"):  # Case 1: call_models signals an error
                print(
                    f"    Error from call_models for custom_id {custom_id_for_item}: {llm_response_dict.get('error')}")
                llm_analysis = {"error": llm_response_dict.get("error")}
            elif isinstance(llm_response_dict,
                            dict) and "response" in llm_response_dict:  # Case 2: Expected structure (wrapper dict)
                llm_analysis_candidate = llm_response_dict.get("response")
                if isinstance(llm_analysis_candidate, dict):
                    llm_analysis = llm_analysis_candidate
                elif isinstance(llm_analysis_candidate,
                                str):  # Handle if "response" contains a JSON string (as per dummy)
                    try:
                        llm_analysis = json.loads(llm_analysis_candidate)
                        if not isinstance(llm_analysis, dict):  # if after parsing it's still not a dict
                            llm_analysis = {"error": f"Parsed response content is not a dict: {type(llm_analysis)}",
                                            "raw_content": llm_analysis_candidate}
                    except json.JSONDecodeError as e_json:
                        llm_analysis = {"error": f"Failed to parse JSON string in response field: {e_json}",
                                        "raw_content": llm_analysis_candidate}
                else:  # if "response" field is neither dict nor string.
                    llm_analysis = {
                        "error": f"Unexpected content type in 'response' field: {type(llm_analysis_candidate)}",
                        "raw_content": str(llm_analysis_candidate)}
            elif isinstance(llm_response_dict,
                            dict):  # Case 3: Actual structure (direct LLM output dict, as per logs)
                # This case assumes if it's a dictionary and not an error/wrapped_response, it's the direct LLM data.
                print(f"    Interpreting call_models output as direct LLM response for {custom_id_for_item}.")
                llm_analysis = llm_response_dict
            else:  # Case 4: Truly unexpected structure (not None, not dict)
                print(
                    f"    Truly unexpected response structure from call_models ({type(llm_response_dict)}) for {custom_id_for_item}.")
                llm_analysis = {"error": "Malformed response from call_models (neither None nor dict).",
                                "raw_content": str(llm_response_dict)}

        except Exception as e:  # Catch any other exceptions
            print(f"    General Error processing item {custom_id_for_item}: {e}", file=sys.stderr)
            llm_analysis = {"error": f"Exception during item processing: {e}"}

        if not store_only:
            llm_screened_results.append({**item, "llm_analysis": llm_analysis})
    if store_only:

        if _process_batch_for(
                              function=function_key_for_screening,
                              ):
            run_part3_llm_screening(

                store_only=False,

            )
    if not llm_screened_results: print("Part 3: No items screened by LLM."); return None
    print(f"Part 3: Saving {len(llm_screened_results)} LLM-screened items to {output_cache_file}")
    with open(output_cache_file, 'w', encoding='utf-8') as f:
        json.dump(llm_screened_results, f, indent=2)

    df_llm = pd.DataFrame(llm_screened_results)
    if 'llm_analysis' in df_llm.columns:
        valid_llm_entries = [entry if isinstance(entry, dict) else {"error": "Malformed LLM Analysis"} for entry in
                             df_llm['llm_analysis']]
        if any(isinstance(entry, dict) for entry in valid_llm_entries):
            llm_normalized_df = pd.json_normalize(valid_llm_entries, max_level=0).add_prefix('llm_')
            df_llm = pd.concat([df_llm.drop(columns=['llm_analysis']), llm_normalized_df], axis=1)

    excel_path_llm = output_cache_file.replace(".json", ".xlsx")
    excel_cols_base = ['search_source_name', 'original_user_keyword', 'title_detail', 'url', 'date_year_detail']
    excel_llm_cols = sorted([c for c in df_llm.columns if c.startswith('llm_')])
    df_llm_excel_export = df_llm.copy()
    if 'description_html' in df_llm_excel_export.columns:  # Handle potential absence of this column
        df_llm_excel_export['description_html_excel_safe'] = df_llm_excel_export['description_html'].astype(str).str[
                                                             :32700]
        excel_cols_other = ['snippet', 'description_html_excel_safe', 'full_query_keywords',
                            'reported_total_for_query_source']
        df_llm_excel_export = df_llm_excel_export.drop(columns=['description_html'], errors='ignore')
    else:
        excel_cols_other = ['snippet', 'full_query_keywords', 'reported_total_for_query_source']

    final_excel_cols = excel_cols_base + excel_llm_cols + excel_cols_other
    df_llm_excel_export = df_llm_excel_export.reindex(
        columns=[c for c in final_excel_cols if c in df_llm_excel_export.columns] +
                [c for c in df_llm_excel_export.columns if c not in final_excel_cols])
    try:
        df_llm_excel_export.to_excel(excel_path_llm, index=False, engine='openpyxl');
        print(f"Part 3: Also saved to Excel: {excel_path_llm}")
    except Exception as e:
        print(f"Error saving Part 3 Excel: {e}", file=sys.stderr)
    print("--- Part 3 Complete ---")
    return output_cache_file


# --- Main Orchestration ---
def main(
        user_keywords: List[str] = ["cyber"],
        target_facet_param: Optional[str] = None,
        search_start_date: str = "", search_end_date: str = "",
        search_sort_by: str = "field_date",
        max_pages_to_crawl_per_source: int = 20,
        store_only=True
):
    """Main function to orchestrate the scraping and analysis pipeline."""
    total_start_time = time.time()

    # --- Part 1 ---
    part1_output_file = None
    print("--- DOJ Cyber Indictment Scraper ---")
    print(f"Part 1 Configuration:")
    print(f"  Base keyword (fixed): '{FIXED_BASE_KEYWORDS}'")  # Corrected print
    print(f"  User keywords (input param): {user_keywords}")
    print(f"  Target search URLs: {[sc['base_url'] for sc in SEARCH_TARGET_CONFIGS]}")
    print(f"  Target facet (input param): {target_facet_param if target_facet_param else 'None'}")
    print(f"  Date range: '{search_start_date}' to '{search_end_date}', Sort by: '{search_sort_by}'")

    proceed_part1 = input(
        f"Run Part 1 (Fetch Initial Data)? (y/n, or 's' to skip if '{PART1_CACHE_FILE}' exists): ").lower()
    if proceed_part1 == 'y':
        part1_output_file = run_part1_fetch_search_data(
            user_keywords=user_keywords,
            target_site_configs=SEARCH_TARGET_CONFIGS,  # Pass the corrected list
            facet_param_str=target_facet_param,
            start_date=search_start_date,
            end_date=search_end_date,
            sort_by=search_sort_by,
            max_pages_per_query_source=max_pages_to_crawl_per_source,
            output_cache_file=PART1_CACHE_FILE
        )
    elif proceed_part1 == 's' and os.path.exists(PART1_CACHE_FILE):
        part1_output_file = PART1_CACHE_FILE;
        print(f"Skipping Part 1, using existing cache: {part1_output_file}")
    else:
        print("Part 1 skipped or cache not found.")

    # --- Part 2 ---
    part2_output_file = None
    if part1_output_file or (proceed_part1 != 'y' and os.path.exists(PART1_CACHE_FILE)):
        input_for_part2 = part1_output_file if part1_output_file else PART1_CACHE_FILE
        if not os.path.exists(input_for_part2):
            print(f"Error: Input file for Part 2 ({input_for_part2}) missing.", file=sys.stderr)
        else:
            proceed_part2 = input(
                f"Run Part 2 (Extract Detailed Metadata from '{input_for_part2}')? (y/n, or 's' to skip if '{PART2_CACHE_FILE}' exists): ").lower()
            if proceed_part2 == 'y':
                part2_output_file = run_part2_extract_detailed_metadata(input_cache_file=input_for_part2)
            elif proceed_part2 == 's' and os.path.exists(PART2_CACHE_FILE):
                part2_output_file = PART2_CACHE_FILE;
                print(f"Skipping Part 2, using cache: {part2_output_file}")
            else:
                print("Part 2 skipped or cache not found.")
    else:
        print("Cannot proceed to Part 2: Part 1 had no output or was skipped.")

    part3_output_file = None
    if part2_output_file or (proceed_part2 != 'y' and os.path.exists(PART2_CACHE_FILE)):
        input_for_part3 = part2_output_file if part2_output_file else PART2_CACHE_FILE
        if not os.path.exists(input_for_part3):
            print(f"Error: Input file for Part 3 ({input_for_part3}) missing.", file=sys.stderr)
        else:
            proceed_part3 = input(
                f"Run Part 3 (LLM Screening on '{input_for_part3}')? (y/n, or 's' to skip if '{PART3_CACHE_FILE}' exists): ").lower()
            if proceed_part3 == 'y':
                part3_output_file = run_part3_llm_screening(input_cache_file=input_for_part3, store_only=store_only)
            elif proceed_part3 == 's' and os.path.exists(PART3_CACHE_FILE):
                part3_output_file = PART3_CACHE_FILE;
                print(f"Skipping Part 3, using cache: {part3_output_file}")
            else:
                print("Part 3 skipped or cache not found.")
    else:
        print("Cannot proceed to Part 3: Part 2 had no output or was skipped.")

    total_end_time = time.time()
    print(f"\nPipeline finished. Total execution time: {total_end_time - total_start_time:.2f} seconds.")
    final_cache_file = part3_output_file or part2_output_file or part1_output_file
    if final_cache_file and os.path.exists(final_cache_file):
        print(f"Most recent results are in: {final_cache_file} (and corresponding .xlsx)")
    else:
        print("No parts were run to completion or produced cache files.")


if __name__ == "__main__":
    main(
        user_keywords=["cyber", "computer crime", "hacking campaign"],  # Example
        max_pages_to_crawl_per_source=30,  # For testing, keep this low. Increase for full runs.
        store_only=True
    )






















































#
# title_for_llm = item.get('title_detail', item.get('title', 'N/A'))
# snippet_for_llm = item.get('snippet', 'N/A')
# date_year_for_llm = item.get('date_year_detail', item.get('date_year', "Unknown"))
# description_html_for_llm = get_cleaned_text_for_llm(item.get('description_html'))
#
# # This is the dictionary that will be passed as the 'text' argument to call_models.
# # The keys here MUST match the placeholders in your prompts.json template.
# prompt_data_dict = {
#     "title": title_for_llm,
#     "snippet": snippet_for_llm,
#     "date_year": date_year_for_llm,
#     "description_html_cleaned_for_llm": description_html_for_llm
# }
#
# if store_only:
#     print(f"  Preparing batch request {i + 1}/{len(detailed_data)} for: {title_for_llm[:70]}...")
# else:  # Processing mode (reading results)
#     print(f"  Attempting to read/process result {i + 1}/{len(detailed_data)} for: {title_for_llm[:70]}...")
#
# try:
#     item_url = item.get('url', f"item_index_{i}")
#     custom_id_for_item = hashlib.sha256(item_url.encode('utf-8')).hexdigest()
# prompt_data_dict=    {'title': 'Justice Department Disrupts Russian Intelligence Spear-Phishing Efforts',
#  'snippet': 'WASHINGTON – The Justice Department announced today the unsealing of a warrant authorizing the seizure of 41 internet domains used by Russian intelligence agents and their proxies to commit computer fraud and abuse in the United States. As an example of the Department’s commitment to public-private operational collaboration to disrupt such adversaries’ malicious cyber activities, as set forth in the National Cybersecurity Strategy, the Department acted concurrently with a Microsoft civil action to restrain 66 internet domains used by the same actors.',
#  'date_year': '2024',
#  'description_html_cleaned_for_llm': 'WASHINGTON – The Justice Department announced today the unsealing of a warrant authorizing the seizure of 41 internet domains used by Russian intelligence agents and their proxies to commit computer fraud and abuse in the United States. As an example of the Department’s commitment to public-private operational collaboration to disrupt such adversaries’ malicious cyber activities, as set forth in the National Cybersecurity Strategy, the Department acted concurrently with a Microsoft civil action to restrain 66 internet domains used by the same actors.\n“Today’s seizure of 41 internet domains reflects the Justice Department’s cyber strategy in action – using all tools to disrupt and deter malicious, state-sponsored cyber actors,” said Deputy Attorney General Lisa Monaco. “The Russian government ran this scheme to steal Americans’ sensitive information, using seemingly legitimate email accounts to trick victims into revealing account credentials. With the continued support of our private sector partners, we will be relentless in exposing Russian actors and cybercriminals and depriving them of the tools of their illicit trade.”\n“This seizure is part of a coordinated response with our private sector partners to dismantle the infrastructure that cyber espionage actors use to attack U.S. and international targets,” said U.S. Attorney Ismail J. Ramsey for the Northern District of California. “We thank all of our private-sector partners for their diligence in analyzing, publicizing, and combating the threat posed by these illicit state-coordinated actions in the Northern District of California, across the United States, and around the world.”\n“This disruption exemplifies our ongoing efforts to expel Russian intelligence agents from the online infrastructure they have used to target individuals, businesses, and governments around the world,” said Assistant Attorney General Matthew G. Olsen of the Justice Department’s National Security Division. “Working closely with private-sector partners such as Microsoft, the National Security Division uses the full reach of our authorities to confront the cyber-enabled threats of tomorrow from Russia and other adversaries.”\n“Working in close collaboration with public and private sector partners—in this case through the execution of domain seizures — we remain in prime position to counter and defeat a broad range of cyber threats posed by adversaries,” said FBI Deputy Director Paul Abbate. “Our efforts to prevent the theft of information by state-sponsored criminal actors are relentless, and we will continue our work in this arena with partners who share our common goals.”\n“This case underscores the importance of the FBI’s enduring partnerships with private sector companies, which allow for rapid information sharing and coordinated action. With these seizures, we’ve disrupted a sophisticated cyber threat aimed at compromising sensitive government intelligence and stealing valuable information,” said FBI Special Agent in Charge Robert Tripp. “Today’s success highlights the power of collaboration in safeguarding the United States against state-sponsored cybercrime.”\nAccording to the partially unsealed affidavit filed in support of the government’s seizure warrant, the seized domains were used by hackers belonging to, or criminal proxies working for, the “Callisto Group,” an operational unit within Center 18 of the Russian Federal Security Service (the FSB), to commit violations of unauthorized access to a computer to obtain information from a department or agency of the United States, unauthorized access to a computer to obtain information from a protected computer, and causing damage to a protected computer. Callisto Group hackers used the seized domains in an ongoing and sophisticated spear-phishing campaign with the goal of gaining unauthorized access to, and steal valuable information from, the computers and email accounts of U.S. government and other victims.\nIn conjunction, Microsoft\nannounced\nthe filing of a civil action to seize 66 internet domains also used by Callisto Group actors. Microsoft Threat Intelligence tracks this group as “Star Blizzard” (formerly SEABORGIUM, also known as COLDRIVER). Between January 2023 and August 2024, Microsoft observed Star Blizzard target over 30 civil society entities and organizations – journalists, think tanks, and nongovernmental organizations (NGOs) – by deploying spear-phishing campaigns to exfiltrate sensitive information and interfere in their activities.\nThe government’s affidavit alleges the Callisto Group actors targeted, among others, United States-based companies, former employees of the United States Intelligence Community, former and current Department of Defense and Department of State employees, United States military defense contractors, and staff at the Department of Energy. In December 2023, the Department\nannounced charges\nagainst two Callisto-affiliated actors, Ruslan Aleksandrovich Peretyatko (Перетятько Руслан Александрович), an officer in FSB Center 18, and Andrey Stanislavovich Korinets (Коринец Андрей Станиславович). The indictment charged the defendants with a campaign to hack into computer networks in the United States, the United Kingdom, other North Atlantic Treaty Organization member countries, and Ukraine, all on behalf of the Russian government.\nThe FBI San Francisco Field Office is investigating the case.\nThe U.S. Attorney’s Office for the Northern District of California and the Justice Department’s National Security Cyber Section of the National Security Division are prosecuting the case.\nThe case is docketed at\nApplication by the United States for a Seizure Warrant for 41 Domain Names For Investigation of 18 U.S.C. § 1956(a)(2)(A) and Other Offenses\n, No. 4-24-71375 (N.D. Cal. Sept. 16, 2024).\nAn affidavit in support of a seizure warrant and an indictment are merely allegations. All defendants are presumed innocent until proven guilty beyond a reasonable doubt in a court of law.'}
# # 2. Call `call_models` with the data dictionary as the `text` argument
# custom_id_for_item = hashlib.sha256(str(prompt_data_dict).encode('utf-8')).hexdigest()
# store_only=True
# llm_response_dict = call_models(
#     text=str(prompt_data_dict),  # Pass the dictionary of placeholder values
#     function_key=function_key_for_screening,
#     custom_id=custom_id_for_item,
#     store_only=store_only,
#     read=not store_only
# )
# print(llm_response_dict)
#
#
# if _process_batch_for(
#         function=function_key_for_screening,
# ):
#     run_part3_llm_screening(
#
#         store_only=False,
#
#     )