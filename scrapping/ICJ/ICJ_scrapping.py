# #!/usr/bin/env python3
# """
# ICJ Case Scraper – robust version (May 2025)
#
# Scrapes ICJ advanced-search result pages and exports the data
# to both RIS and Excel, with simple on-disk JSON caching so you can
# resume a previous run without re-processing the same rows.
#
# Dependencies: requests, beautifulsoup4, pandas, python-dotenv (optional), openpyxl
# """
# import os
# import re
# import json
# import logging
# from math import ceil
# from urllib.parse import urljoin, urlparse, parse_qs, urlencode
#
# import requests
# import pandas as pd
# import rispy
# from bs4 import BeautifulSoup, NavigableString, Tag
# from dotenv import load_dotenv
#
# # --- Logging ---
# # To see debug messages, set level to logging.DEBUG
# # For example: logging.basicConfig(level=logging.DEBUG, format="%(levelname)s: %(filename)s:%(lineno)d - %(message)s")
# logging.basicConfig(level=logging.INFO,
#                     format="%(levelname)s: %(message)s")
# log = logging.getLogger(__name__)
#
#
# # --- Helpers ---
# def parse_filename(pdf_url: str) -> dict:
#     """
#     Pull the usual case-metadata that ICJ encodes in its PDF filenames.
#
#     Example: 187-20240813-wri-01-00-en.pdf →
#       {'case_num_from_filename':'187', 'date_from_filename':'2024-08-13', 'doccode':'wri', ...}
#     """
#     fname = os.path.basename(urlparse(pdf_url).path)
#     stem, _ = os.path.splitext(fname)
#     parts = stem.split('-')
#     keys = ["case_num_from_filename", "date_packed", "doccode", "seq1", "seq2", "lang_from_filename"]
#     meta = dict(zip(keys, parts + [""] * (len(keys) - len(parts))))
#
#     dp = meta.get("date_packed", "")
#     if dp.isdigit() and len(dp) == 8:
#         meta["date_from_filename"] = f"{dp[:4]}-{dp[4:6]}-{dp[6:]}"
#     else:
#         meta["date_from_filename"] = None
#
#     meta["sequence_from_filename"] = f"{meta.get('seq1', '')}-{meta.get('seq2', '')} ".strip(
#         '-')  # Ensure space is stripped if seq2 is empty
#
#     for temp_key in ["date_packed", "seq1", "seq2"]:
#         if temp_key in meta:
#             del meta[temp_key]
#
#     return meta
#
#
# # --- Scraper core ---
# def _clean_label(tag):
#     """Cleans the text of a tag to be used as a label."""
#     if not tag:
#         return ""
#     return (tag.get_text(strip=True)
#             .replace('\xa0', ' ')
#             .rstrip(':')
#             .strip())
#
#
# def fetch_icj_page(page_url: str):
#     """
#     Fetches and parses a single ICJ search result page.
#     Returns a tuple: (list_of_entries, next_page_url, items_per_page).
#     """
#     log.info(f"Fetching page: {page_url}")
#     try:
#         r = requests.get(page_url, timeout=30)
#         r.raise_for_status()
#     except requests.exceptions.RequestException as e:
#         log.error(f"Request failed for {page_url}: {e}")
#         return [], None, 100
#
#     soup = BeautifulSoup(r.text, "html.parser")
#
#     try:
#         ipp = int(parse_qs(urlparse(page_url).query).get("items_per_page", ["100"])[0])
#     except ValueError:
#         log.warning("Could not parse items_per_page, defaulting to 100.")
#         ipp = 100
#
#     entries, seen_on_page = [], set()
#
#     for i, row in enumerate(soup.select("div.view-content.row > div.views-row")):
#         a_pdf = row.select_one("h4 a[href$='.pdf']")
#         if not a_pdf:
#             log.debug(f"Row #{i + 1}: no PDF link found in h4, skipping row.")
#             continue
#
#         pdf_url = urljoin(page_url, a_pdf["href"])
#         title = a_pdf.get_text(strip=True)
#         lang = a_pdf.get("hreflang", "en")
#
#         a_case = None
#         inner_title_div_for_case_link = row.select_one("div.inner_title")
#         if inner_title_div_for_case_link:
#             a_case = inner_title_div_for_case_link.select_one("a[href*='/case/']")
#
#         if not a_case:
#             log.info(
#                 f"Row #{i + 1}: Case link not found via 'div.inner_title a[href*=/case/]' for '{title}'. Trying broader search based on '<b>Case:</b>' label.")
#             b_case_elements = row.find_all('b')
#             found_via_fallback = False
#             for b_tag in b_case_elements:
#                 if _clean_label(b_tag) == "Case":
#                     current_element = b_tag
#                     while current_element and current_element.next_sibling:
#                         current_element = current_element.next_sibling
#                         if current_element.name == 'a' and current_element.get(
#                                 'href') and '/case/' in current_element.get('href'):
#                             a_case = current_element
#                             found_via_fallback = True
#                             break
#                     if found_via_fallback:
#                         log.info(f"Row #{i + 1}: Found case link via '<b>Case:</b>' sibling fallback for '{title}'.")
#                         break
#                     if not found_via_fallback and b_tag.parent and b_tag.parent.name == 'p':
#                         link_in_p = b_tag.parent.find('a', href=re.compile(r'/case/\d+'))
#                         if link_in_p:
#                             a_case = link_in_p
#                             found_via_fallback = True
#                             log.info(
#                                 f"Row #{i + 1}: Found case link via '<b>Case:</b>' parent <p> fallback for '{title}'.")
#                             break
#             if not found_via_fallback:
#                 log.warning(
#                     f"Row #{i + 1}: Fallback attempt for '{title}' also failed to find case link via '<b>Case:</b>' label.")
#
#         if not a_case:
#             log.error(f"Row #{i + 1}: Still no case <a> found for '{title}' after all attempts.")
#             # log.debug(f"HTML for row #{i+1} where case link was not found:\n{row.prettify()}\n------------------")
#             continue
#
#         case_url = urljoin(page_url, a_case["href"])
#         case_id_match = re.search(r'/case/(\d+)', a_case["href"])
#         if not case_id_match:
#             log.error(f"Row #{i + 1}: Could not parse case_id from URL '{a_case['href']}' for title '{title}'.")
#             # log.debug(f"HTML for row #{i+1} where case_id parsing failed:\n{row.prettify()}\n------------------")
#             continue
#         case_id = case_id_match.group(1)
#         case_name_text = a_case.get_text(strip=True)
#         case_name = case_name_text if case_name_text else a_case.get('title', f"Case {case_id}")
#
#         doc_type = None
#         doc_date = None
#         target_p_text_for_type_date = None
#
#         # Search for the <p> tag containing Type and Date information
#         # This <p> tag is usually a sibling of the <h4> or within the same div.inner_title
#         # We look for a <p> that contains both "Type:" and "Date:"
#
#         # First, try within div.inner_title if it exists
#         p_tags_source_list = []
#         if inner_title_div_for_case_link:  # Use the one found for case link
#             p_tags_source_list = inner_title_div_for_case_link.find_all('p')
#
#         if not p_tags_source_list:  # If not found in inner_title, or inner_title was not found
#             p_tags_source_list = row.find_all('p')  # Search all p tags in the row
#             log.debug(
#                 f"Row #{i + 1} ('{title[:30]}...'): 'div.inner_title' (or its <p>s) not found or empty. Searching all {len(p_tags_source_list)} <p> tags in row.")
#         else:
#             log.debug(
#                 f"Row #{i + 1} ('{title[:30]}...'): Found {len(p_tags_source_list)} <p> tags in 'div.inner_title' for Type/Date search.")
#
#         for p_candidate in p_tags_source_list:
#             p_text_content = p_candidate.get_text(separator=" ", strip=True)
#             log.debug(f"Row #{i + 1}: Checking <p> text for Type/Date: '{p_text_content[:100]}'")
#
#             if re.search(r"Type\s*:", p_text_content, re.IGNORECASE) and \
#                     re.search(r"Date\s*:", p_text_content, re.IGNORECASE):
#                 target_p_text_for_type_date = p_text_content
#                 log.info(f"Row #{i + 1}: Found target <p> for Type/Date. Text: '{target_p_text_for_type_date}'")
#                 break
#
#         if target_p_text_for_type_date:
#             # Using DOTALL because the value for Type might span newlines if not stripped properly by get_text
#             type_match = re.search(r"Type:\s*([^|]+?)(?:\s*\||\s*$)", target_p_text_for_type_date,
#                                    re.IGNORECASE | re.DOTALL)
#             if type_match:
#                 doc_type_candidate = type_match.group(1).strip()
#                 # Further clean up: if "Date:" is part of this capture, remove it.
#                 if "Date:" in doc_type_candidate:
#                     doc_type = doc_type_candidate.split("Date:")[0].strip()
#                 else:
#                     doc_type = doc_type_candidate
#                 log.info(f"Row #{i + 1}: Regex successfully extracted Type: '{doc_type}'")
#
#             date_match = re.search(r"Date:\s*(\d{4}-\d{2}-\d{2})", target_p_text_for_type_date, re.IGNORECASE)
#             if date_match:
#                 doc_date = date_match.group(1).strip()
#                 log.info(f"Row #{i + 1}: Regex successfully extracted Date: '{doc_date}'")
#         else:
#             log.warning(f"Row #{i + 1}: No <p> tag containing both 'Type:' and 'Date:' found for '{title}'.")
#             # log.debug(f"HTML for row #{i+1} where Type/Date <p> was not found:\n{row.prettify()}\n------------------")
#
#         if not doc_type:
#             log.warning(f"Row #{i + 1}: Document type not extracted for '{title}' (Case ID: {case_id}).")
#             doc_type = "Unknown Type"
#         if not doc_date:
#             log.warning(f"Row #{i + 1}: Document date not extracted for '{title}' (Case ID: {case_id}).")
#             doc_date = "Unknown Date"
#
#         entry = {
#             "title": title, "type_ris": "RPRT", "case_name": case_name, "case_url": case_url,
#             "case_id": case_id, "doc_type": doc_type, "date": doc_date,
#             "year": doc_date.split("-")[
#                 0] if doc_date and '-' in doc_date and doc_date != "Unknown Date" else "Unknown Year",
#             "pdf_url": pdf_url, "url": pdf_url, "place_of_publication": "International Court of Justice",
#             # More specific than The Hague
#             "language": lang, **parse_filename(pdf_url),
#         }
#
#         page_key = (case_id, title, doc_date)
#         if page_key not in seen_on_page:
#             entries.append(entry)
#             seen_on_page.add(page_key)
#
#     next_page_tag = soup.select_one("ul.pagination li.page-item a[rel='next']")
#     next_page_url = urljoin(page_url, next_page_tag["href"]) if next_page_tag else None
#
#     return entries, next_page_url, ipp
#
#
# # --- Lightweight JSON cache ---
# CACHE_FILE = "icj_scraper_cache.json"
#
#
# def load_cache():
#     if os.path.exists(CACHE_FILE):
#         try:
#             with open(CACHE_FILE, "r", encoding="utf-8") as fh:
#                 return json.load(fh)
#         except json.JSONDecodeError:
#             log.error(f"Error decoding JSON from {CACHE_FILE}. Starting with an empty cache.")
#             return {}
#     return {}
#
#
# def save_cache(cache: dict):
#     with open(CACHE_FILE, "w", encoding="utf-8") as fh:
#         json.dump(cache, fh, indent=2, ensure_ascii=False)
#
#
# # --- Writers ---
# def write_ris(entries, out_filename="icj_cases.ris"):
#     if not entries:
#         log.info("No new entries to write to RIS file.")
#         return
#     with open(out_filename, "a", encoding="utf-8") as fh:
#         for e in entries:
#             fh.write(f"TY  - {e.get('type_ris', 'RPRT')}\n")
#             fh.write(f"TI  - {e.get('title', 'N/A')}\n")
#             if e.get('date') and e.get('date') != "Unknown Date":
#                 fh.write(f"PY  - {e['date']}\n");
#                 fh.write(f"Y1  - {e['date']}\n")
#             if e.get('year') and e.get('year') != "Unknown Year":
#                 fh.write(f"DA  - {e['year']}\n")
#             fh.write(f"UR  - {e.get('pdf_url', 'N/A')}\n")
#             fh.write(f"PB  - {e.get('place_of_publication', 'International Court of Justice')}\n")
#             fh.write(f"CY  - The Hague\n")  # City of Publication
#             if e.get('doc_type') and e.get('doc_type') != "Unknown Type":
#                 fh.write(f"AB  - Document Type: {e['doc_type']}\n")
#             fh.write(f"KW  - {e.get('case_name', 'N/A')}\n")
#             if e.get("language"): fh.write(f"LA  - {e['language']}\n")
#             fh.write("ER  - \n\n")
#     log.info(f"Appended {len(entries)} new entries to RIS file: {out_filename}")
#
#
# def write_excel(all_cached_entries, out_filename="icj_cases.xlsx"):
#     if not all_cached_entries:
#         log.info("Cache is empty. No Excel file to write.")
#         return
#     df = pd.DataFrame(list(all_cached_entries.values()))
#     column_order = [
#         "case_id", "case_name", "title", "doc_type", "date", "year",
#         "pdf_url", "case_url", "language", "type_ris", "place_of_publication",
#         "case_num_from_filename", "date_from_filename", "doccode",
#         "sequence_from_filename", "lang_from_filename"
#     ]
#     df = df.reindex(columns=column_order)
#     try:
#         df.to_excel(out_filename, index=False, engine='openpyxl')
#         log.info(f"Wrote {len(df)} total entries to Excel workbook: {out_filename}")
#     except Exception as e:
#         log.error(f"Failed to write Excel file: {e}")
#
#
# # --- Main ---
# if __name__ == "__main__":
#     load_dotenv()
#
#     # --- Zotero Configuration (User needs to set this up) ---
#     ZOTERO_API_KEY = os.getenv("ZOTERO_API_KEY")
#     ZOTERO_USER_ID = os.getenv("ZOTERO_USER_ID")
#     ZOTERO_TOP_COLLECTION_NAME = "ICJ Scraper Cases"  # Or get from env
#     PDF_DOWNLOAD_DIR = "temp_icj_pdfs"
#
#     zot_client = None
#     # if ZOTERO_API_KEY and ZOTERO_USER_ID:
#     #     try:
#     #         # Example for Pyzotero:
#     #         # zot_client = zotero.Zotero(ZOTERO_USER_ID, 'user', ZOTERO_API_KEY)
#     #         # zot_client.key_info() # Test connection
#     #         log.info("Zotero client initialized (placeholder - actual initialization needed).")
#     #         # Replace the above with your actual Zotero client initialization
#     #         pass # Placeholder for actual Zotero client setup
#     #     except Exception as e: # Catch specific Zotero errors
#     #         log.error(f"Failed to initialize Zotero client: {e}. Zotero integration will be disabled.")
#     #         zot_client = None
#     # else:
#     #     log.info("Zotero API key or User ID not found in environment. Zotero integration will be disabled.")
#     # For testing without full Zotero setup, you can mock the client:
#     # class MockZotero:
#     #     def collections(self, **kwargs): return []
#     #     def create_collections(self, data): log.info(f"Mock create_collections: {data}"); return [{'key': 'mock_coll_key'}]
#     #     def items(self, **kwargs): log.info(f"Mock items search: {kwargs}"); return []
#     #     def item_template(self, item_type): log.info(f"Mock item_template for {item_type}"); return {}
#     #     def create_items(self, items_data): log.info(f"Mock create_items: {items_data}"); return {'successful': {'0': {'key': 'mock_item_key', 'version': 1}}}
#     #     def attachment_simple(self, files, parentid): log.info(f"Mock attach_simple: {files} to {parentid}"); return "mock_attachment_id"
#     #     def everything(self, items_iterator): return list(items_iterator) # Simplified for mock
#     # if not zot_client: # If actual init failed or was skipped
#     #    zot_client = MockZotero()
#     #    log.info("Using MockZotero client for demonstration purposes.")
#
#     # --- Scraper Parameters ---
#     params = {
#         "search_api_fulltext": (
#             '("probative weight" OR substantiat* OR corroborat* OR admissib* OR credibility OR "burden of proof" OR preponderance)'),
#         "search_api_fulltext_1": "", "search_api_fulltext_2": "", "case_selection": "1",
#         "field_document_group_type": "486", "field_doc_incidental_proceedings": "All",
#         "field_date_of_the_document[min]": "", "field_date_of_the_document[max]": "",
#         "items_per_page": "100", "sort_order": "DESC",
#     }
#     BASE_URL = "https://www.icj-cij.org/advanced-search"
#     first_page_url = f"{BASE_URL}?{urlencode(params, safe='()*:')}"
#
#     total_results, estimated_pages = 0, 0
#     try:
#         r_initial = requests.get(first_page_url, timeout=30);
#         r_initial.raise_for_status()
#         soup_initial = BeautifulSoup(r_initial.text, "html.parser")
#         header_text_tag = soup_initial.select_one("div.view-header")
#         if header_text_tag:
#             header_text = header_text_tag.get_text(strip=True)
#             total_results_match = re.search(r"About\s+(\d+)\s+results", header_text, re.IGNORECASE)
#             if total_results_match:
#                 total_results = int(total_results_match.group(1))
#                 items_per_page_val = int(params["items_per_page"])
#                 if items_per_page_val > 0: estimated_pages = ceil(total_results / items_per_page_val)
#                 log.info(f"Total results found: {total_results}, estimated pages: {estimated_pages}")
#             else:
#                 log.warning("Could not parse total results from header.")
#         else:
#             log.warning("View header not found on the first page.")
#     except requests.exceptions.RequestException as e:
#         log.error(f"Initial request to get total results failed: {e}")
#     except Exception as e:
#         log.error(f"Error processing initial page for total results: {e}")
#
#     current_page_url, page_num = first_page_url, 1
#     cache = load_cache()
#     processed_keys = set(cache.keys())
#     newly_added_entries_this_run = []
#
#     # --- Zotero Collection Setup ---
#     # top_collection_key = None
#     # if zot_client:
#     #     top_collection_key = find_or_create_collection(zot_client, ZOTERO_TOP_COLLECTION_NAME)
#     #     if not top_collection_key:
#     #         log.error(f"Failed to find or create Zotero top collection: '{ZOTERO_TOP_COLLECTION_NAME}'. Zotero processing will be skipped.")
#     #         zot_client = None # Disable further Zotero ops
#
#     while current_page_url:
#         log.info(f"Processing page {page_num}{f'/{estimated_pages}' if estimated_pages else ''}...")
#         page_entries, next_page_url, _ = fetch_icj_page(current_page_url)
#
#         if not page_entries and page_num == 1 and total_results > 0:
#             log.warning(
#                 "No entries parsed from the first page, though results were expected. Check selectors or page structure.")
#
#         for entry in page_entries:
#             entry_key = f"{entry['case_id']}|{entry['title']}|{entry['date']}"
#             if entry_key not in processed_keys:
#                 cache[entry_key] = entry
#                 newly_added_entries_this_run.append(entry)
#                 processed_keys.add(entry_key)
#
#                 # --- Process for Zotero ---
#                 # if zot_client and top_collection_key:
#                 #     log.info(f"Processing new entry for Zotero: {entry['title']}")
#                 #     normalized_case_name = normalize_collection_name(entry['case_name'])
#                 #     sub_collection_key = find_or_create_collection(zot_client, normalized_case_name, parent_id=top_collection_key)
#
#                 #     if sub_collection_key:
#                 #         if not check_item_exists_in_zotero(zot_client, entry['title'], entry['pdf_url'], sub_collection_key):
#                 #             pdf_local_path = download_pdf(entry['pdf_url'], PDF_DOWNLOAD_DIR)
#                 #             if pdf_local_path:
#                 #                 create_zotero_item_from_entry(zot_client, entry, sub_collection_key, pdf_local_path)
#                 #                 try:
#                 #                     pdf_local_path.unlink() # Clean up downloaded PDF
#                 #                     log.debug(f"Cleaned up temporary PDF: {pdf_local_path}")
#                 #                 except OSError as e:
#                 #                     log.error(f"Error deleting temporary PDF {pdf_local_path}: {e}")
#                 #             else:
#                 #                 log.warning(f"Skipping Zotero item creation for '{entry['title']}' due to PDF download failure.")
#                 #         else:
#                 #             log.info(f"Item '{entry['title']}' already exists in Zotero subcollection '{normalized_case_name}'. Skipping.")
#                 #     else:
#                 #         log.warning(f"Failed to create/find subcollection for '{normalized_case_name}'. Skipping Zotero for this item.")
#                 # --- End Zotero Processing ---
#
#         current_page_url = next_page_url
#         page_num += 1
#         if newly_added_entries_this_run and (page_num - 1) % 1 == 0:
#             log.info(
#                 f"Saving cache after page {page_num - 1} ({len(newly_added_entries_this_run)} new entries so far this run)")
#             save_cache(cache)
#
#     save_cache(cache)
#
#     if newly_added_entries_this_run:
#         write_ris(newly_added_entries_this_run)
#         write_excel(cache)
#         log.info(f"Successfully processed {len(newly_added_entries_this_run)} new entries.")
#     else:
#         log.info("No new entries found in this run. RIS file not updated. Excel file reflects current cache (if any).")
#         if cache:
#             write_excel(cache)
#
#     # Clean up PDF download directory if it's empty or if desired
#     # if Path(PDF_DOWNLOAD_DIR).exists():
#     #     try:
#     #         if not any(Path(PDF_DOWNLOAD_DIR).iterdir()): # Check if empty
#     #             Path(PDF_DOWNLOAD_DIR).rmdir()
#     #             log.info(f"Cleaned up empty PDF download directory: {PDF_DOWNLOAD_DIR}")
#     #         # else: # Or force delete if you want to clear it always (be careful)
#     #         #    shutil.rmtree(PDF_DOWNLOAD_DIR)
#     #         #    log.info(f"Forcefully cleaned up PDF download directory: {PDF_DOWNLOAD_DIR}")
#     #     except OSError as e:
#     #         log.error(f"Error cleaning up PDF download directory {PDF_DOWNLOAD_DIR}: {e}")
#
#     log.info("Scraping process finished.")
# !/usr/bin/env python3
"""
ICJ RIS to Zotero Processor

Reads entries from an RIS file, downloads associated PDFs (if URLs are present)
using Selenium and PyAutoGUI to handle potential download issues and "Save As" dialogs,
and adds them to a Zotero library, organizing them into collections.

Dependencies: requests, beautifulsoup4 (minimal use for Tag/NavigableString type check if _text_after is ever reused),
              pandas (for Excel output, can be removed if not needed),
              python-dotenv, openpyxl (for Excel), rispy, hashlib,
              undetected-chromedriver, selenium, pyautogui.
Requires the user's Zotero class and appropriate Zotero API credentials.
"""
import os
import re
import json
import logging
from urllib.parse import urlparse
from pathlib import Path
import shutil
import time
import hashlib

import requests
import rispy
from bs4 import NavigableString, Tag
from dotenv import load_dotenv

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException
import pyautogui

# --- User's Zotero Class Import ---
load_dotenv()
from zotero_module.zotero_class import Zotero

ZOTERO_LIBRARY_ID = os.getenv("LIBRARY_ID")
ZOTERO_API_KEY = os.getenv("API_KEY")
ZOTERO_LIBRARY_TYPE = os.getenv("LIBRARY_TYPE", "user")

# --- Logging ---
logging.basicConfig(level=logging.INFO,
                    format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


# --- Helper Functions ---
def parse_filename(pdf_url: str) -> dict:
    if not pdf_url: return {}
    fname = os.path.basename(urlparse(pdf_url).path)
    stem, _ = os.path.splitext(fname)
    parts = stem.split('-')
    if len(parts) < 3: return {}
    keys = ["case_num_from_filename", "date_packed", "doccode", "seq1", "seq2", "lang_from_filename"]
    meta = dict(zip(keys, parts + [""] * (len(keys) - len(parts))))
    dp = meta.get("date_packed", "")
    meta["date_from_filename"] = f"{dp[:4]}-{dp[4:6]}-{dp[6:]}" if dp.isdigit() and len(dp) == 8 else None
    meta["sequence_from_filename"] = f"{meta.get('seq1', '')}-{meta.get('seq2', '')} ".strip('-')
    final_meta = {k: v for k, v in meta.items() if v and k not in ["date_packed", "seq1", "seq2"]}
    return final_meta


def normalize_collection_name(name: str, max_length: int = 100) -> str:
    if not name: return "Unknown_Case_Collection"
    name = re.sub(r'[\\/:*?"<>|]', '_', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name[:max_length]


# ----- replacement -----------------------------------------------------------
import cloudscraper, requests, shutil, os, time, logging as log
from pathlib import Path
from urllib.parse import urlparse
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException
# ---------------- code to be replaced -------------------------------------------------
# def download_file(url: str, save_path_str: str) -> Path | None:
#     (whole previous implementation)

# ---------------- replacement ---------------------------------------------------------
import os, re, subprocess, time, shutil, logging as log


import shutil, logging as log
from pathlib import Path
from urllib.parse import urlparse
import cloudscraper, requests, undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException


# ──────────────────────────────────────────────────────────────────────────────
# 1.  ALWAYS-VISIBLE Chrome (no headless) ──────────────────────────────────────
def _chrome_major() -> int | None:
    """Return locally-installed Chrome’s major version (best-effort)."""
    import re, subprocess, os
    try:
        if os.name == "nt":
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"SOFTWARE\Google\Chrome\BLBeacon") as k:
                ver, _ = winreg.QueryValueEx(k, "version")
        else:
            ver = subprocess.check_output(["google-chrome", "--version"],
                                          text=True)
        return int(re.search(r"(\d+)\.", ver).group(1))
    except Exception:
        return None


def _launch_driver() -> uc.Chrome:
    """Undetected-chromedriver with sane defaults – **always visible**."""
    opts = uc.ChromeOptions()
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    return uc.Chrome(options=opts, headless=False, version_main=_chrome_major())


# ──────────────────────────────────────────────────────────────────────────────
# 2.  Main downloader ──────────────────────────────────────────────────────────
def download_file_icj(url: str, save_path_str: str) -> Path | None:
    """
    Fetch `url` (ICJ PDF) into `save_path_str`, bypassing Cloudflare Turnstile.
    Order of battle:
        a) cloudscraper GET
        b) if 403+Turnstile  → steal signed token URL  → GET (browser headers)
        c) if still 403      → POST token URL         → follow 302
        d) if all fails      → Selenium (visible)
    """
    save_path = Path(save_path_str).expanduser().resolve()
    save_path.parent.mkdir(parents=True, exist_ok=True)


    # a) cloudscraper baseline -------------------------------------------------
    try:
        sc = cloudscraper.create_scraper(browser={
            "browser": "chrome", "platform": "windows", "mobile": False
        })
        r = sc.get(url, timeout=60, stream=True, allow_redirects=True)

        if r.status_code in (200, 206) and "application/pdf" in r.headers.get("content-type", ""):
            with open(save_path, "wb") as fh:
                shutil.copyfileobj(r.raw, fh)
            log.info("Download succeeded on first GET → %s", save_path)
            return save_path

        # b) Turnstile page?  Mine the token URL --------------------------------
        html = r.text.lower()
        if r.status_code == 403 and "_cf_chl_opt" in html:
            import re
            tm = re.search(r'cUPMDTk\s*:\s*"([^"]+)"', html) \
                 or re.search(r'fa\s*:\s*"([^"]+)"',  html)
            if tm:
                token_path = tm.group(1).replace(r"\/", "/")
                origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
                token_url = origin + token_path
                log.info("Cloudflare token detected → retrying %s", token_url)

                common_hdrs = {                       # browser-like headers
                    "Referer": url,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,"
                              "image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Cache-Control": "no-cache"
                }

                #  b-1) token GET ------------------------------------------------
                r2 = sc.get(token_url, headers=common_hdrs,
                            timeout=60, stream=True, allow_redirects=True)

                if r2.status_code in (200, 206) and "application/pdf" in r2.headers.get("content-type", ""):
                    with open(save_path, "wb") as fh:
                        shutil.copyfileobj(r2.raw, fh)
                    log.info("Download succeeded via token GET → %s", save_path)
                    return save_path

                #  b-2) token POST  (CF sometimes wants POST) -------------------
                r3 = sc.post(token_url, headers=common_hdrs,
                             timeout=60, stream=True, allow_redirects=True)
                if r3.status_code in (200, 206) and "application/pdf" in r3.headers.get("content-type", ""):
                    with open(save_path, "wb") as fh:
                        shutil.copyfileobj(r3.raw, fh)
                    log.info("Download succeeded via token POST → %s", save_path)
                    return save_path

        # c) fall back: POST original URL (handles 302 dance) -------------------
        if r.status_code in (302, 403, 405):
            log.info("Retrying original URL as POST after HTTP %s …", r.status_code)
            r4 = sc.post(url, timeout=60, stream=True, allow_redirects=True)
            if r4.status_code in (200, 206) and "application/pdf" in r4.headers.get("content-type", ""):
                with open(save_path, "wb") as fh:
                    shutil.copyfileobj(r4.raw, fh)
                log.info("PDF fetched via original POST → %s", save_path)
                return save_path

        log.warning("cloudscraper branch failed (HTTP %s); switching to Selenium.", r.status_code)
    except Exception as e:
        log.warning("cloudscraper error: %s", e)

    # d) Selenium – visible browser, once -------------------------------------
    driver = None
    try:
        driver = _launch_driver()
        driver.get(url)

        WebDriverWait(driver, 45).until(
            lambda d: not any(tag in d.title.lower()
                              for tag in ("cloudflare", "just a moment", "verification"))
        )

        sess = requests.Session()
        sess.headers.update({"User-Agent": driver.execute_script("return navigator.userAgent;")})
        for c in driver.get_cookies():
            sess.cookies.set(c["name"], c["value"])

        r = sess.get(url, timeout=60, stream=True)
        if r.status_code in (200, 206) and "application/pdf" in r.headers.get("content-type", ""):
            with open(save_path, "wb") as fh:
                shutil.copyfileobj(r.raw, fh)
            log.info("PDF fetched via Selenium cookies → %s", save_path)
            return save_path

        log.error("Selenium phase still blocked (HTTP %s).", r.status_code)

    except (TimeoutException, WebDriverException) as e:
        log.error("Selenium WebDriver error: %s", e)
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass

    return None


def map_ris_to_entry_dict(ris_dict: dict) -> dict:
    entry = {}
    entry['title'] = ris_dict.get('title') or ris_dict.get('primary_title') or ris_dict.get('TI') or ris_dict.get(
        'T1') or "Unknown Title"
    entry['pdf_url'] = ris_dict.get('url') or ris_dict.get('UR') or ris_dict.get('L1')
    if not entry['pdf_url'] and isinstance(ris_dict.get('urls'), list) and ris_dict['urls']:
        entry['pdf_url'] = ris_dict['urls'][0]
    entry_date_raw = ris_dict.get('year') or ris_dict.get('publication_year') or ris_dict.get('PY') or ris_dict.get(
        'Y1')
    if entry_date_raw:
        date_str = str(entry_date_raw);
        date_match_full = re.match(r'(\d{4}-\d{2}-\d{2})', date_str);
        date_match_year = re.match(r'(\d{4})', date_str)
        if date_match_full:
            entry['date'] = date_match_full.group(1); entry['year'] = entry['date'][:4]
        elif date_match_year:
            entry['date'] = date_match_year.group(1); entry['year'] = entry['date']
        else:
            entry['year'] = "Unknown Year"; entry['date'] = "Unknown Date"
    else:
        entry['date'] = "Unknown Date"; entry['year'] = "Unknown Year"
    entry['doc_type'] = "Unknown Type"
    if ris_dict.get('abstract'):
        type_match = re.search(r"Document Type:\s*(.+)", ris_dict['abstract'])
        if type_match: entry['doc_type'] = type_match.group(1).strip()
    if entry['doc_type'] == "Unknown Type" and ris_dict.get('type_of_reference'):
        ty_map = {"RPRT": "Report", "CASE": "Case", "JUDG": "Judgment"};
        entry['doc_type'] = ty_map.get(ris_dict['type_of_reference'], ris_dict['type_of_reference'])
    entry['case_name'] = "Unknown Case";
    entry['language'] = "en"
    keywords = ris_dict.get('keywords', [])
    if isinstance(keywords, str): keywords = [keywords]
    if keywords:
        potential_case_names = sorted([kw for kw in keywords if
                                       len(kw) > 5 and kw.lower() not in ["judgment", "judgments", "report", "order",
                                                                          "en", "fr"]], key=len, reverse=True)
        if potential_case_names:
            entry['case_name'] = potential_case_names[0]
        elif keywords:
            entry['case_name'] = keywords[0]
        for kw in keywords:
            if len(kw) == 2 and kw.isalpha(): entry['language'] = kw.lower()
    if entry['case_name'] == "Unknown Case" and '(' in entry['title'] and ')' in entry['title']:
        match_in_title = re.search(r'\(([^)]+)\)', entry['title'])
        if match_in_title and len(match_in_title.group(1)) > 5: entry['case_name'] = match_in_title.group(1)

    entry['case_id'] = "N/A"
    entry['file_id_from_filename'] = None  # Initialize
    if entry['pdf_url']:
        pdf_meta = parse_filename(entry['pdf_url'])
        if pdf_meta.get('case_num_from_filename'): entry['case_id'] = pdf_meta['case_num_from_filename']
        if pdf_meta.get('date_from_filename') and entry['date'] == "Unknown Date":
            entry['date'] = pdf_meta['date_from_filename']
            if entry['date']: entry['year'] = entry['date'][:4]
        if pdf_meta.get('lang_from_filename'): entry['language'] = pdf_meta['lang_from_filename']
        if pdf_meta.get('doccode') and entry['doc_type'] == "Unknown Type": entry[
            'doc_type'] = f"ICJ Doc ({pdf_meta['doccode']})"
        if pdf_meta.get('date_packed'): entry['file_id_from_filename'] = pdf_meta['date_packed']  # e.g., 20250519

    entry['place_of_publication'] = ris_dict.get('place_published') or ris_dict.get(
        'CY') or "International Court of Justice"
    return entry



def check_item_exists_in_zotero_direct(zot_api_client, item_doc_title_to_check: str, item_url_to_check: str, collection_key: str) -> bool:
    """
    Checks if an item with the given document title OR URL already exists in the specified Zotero collection.
    For 'case' items, it checks 'shortTitle'. For others, it checks 'title'.
    """
    log.debug(f"Direct Zotero check: Item doc title '{item_doc_title_to_check}' or URL '{item_url_to_check}' in collection '{collection_key}'")
    try:
        # Search by the document's specific title using Zotero's 'q' parameter
        items_search_results = zot_api_client.items(collectionID=collection_key, q=item_doc_title_to_check, itemType='-attachment', limit=25)
        for item_data in items_search_results:
            data_fields = item_data.get('data', {})
            # Check shortTitle first (where specific document title for 'case' items is stored)
            if data_fields.get('shortTitle', '').strip().lower() == item_doc_title_to_check.strip().lower():
                log.info(f"Item with matching shortTitle '{item_doc_title_to_check}' found in collection '{collection_key}'. Assuming it exists.")
                return True
            # Then check main title (for non-case items or if shortTitle wasn't a match)
            zot_main_title = data_fields.get('title', '')
            if zot_main_title and zot_main_title.strip().lower() == item_doc_title_to_check.strip().lower():
                log.info(f"Item with matching title '{item_doc_title_to_check}' found in collection '{collection_key}'. Assuming it exists.")
                return True
            # URL check
            if item_url_to_check and data_fields.get('url', '') == item_url_to_check:
                log.info(f"Item with matching URL '{item_url_to_check}' found in collection '{collection_key}'. Assuming it exists.")
                return True
        log.debug(f"No exact match found by title/shortTitle query for '{item_doc_title_to_check}' or URL '{item_url_to_check}' in collection '{collection_key}' initial search.")
    except Exception as e:
        log.error(f"Error checking for existing item '{item_doc_title_to_check}' in collection '{collection_key}' via direct API: {e}")
    return False


def create_zotero_item_from_entry(zot_user_class_instance, entry: dict, target_collection_key: str,
                                  pdf_local_path: Path | None) -> str | None:
    zot_api_client = zot_user_class_instance.zot
    log.info(
        f"Preparing to create Zotero item for document: '{entry['title']}' (Case: '{entry['case_name']}') in collection {target_collection_key}")

    doc_type_lower = entry.get('doc_type', "Unknown Type").lower()
    type_map = {"judgments": "case", "judgment": "case", "order": "case", "report": "report", "rprt": "report"}
    zot_item_type = type_map.get(doc_type_lower, "document")
    if "judgment" in doc_type_lower or "order" in doc_type_lower or "memorial" in doc_type_lower or "counter-memorial" in doc_type_lower or "application" in doc_type_lower or "pleadings" in doc_type_lower:
        zot_item_type = "case"
    log.debug(f"Mapping to Zotero item type: '{zot_item_type}' based on doc_type '{entry.get('doc_type')}'")

    try:
        item_template = zot_api_client.item_template(zot_item_type)
    except AttributeError:
        log.error(
            f"The Zotero API client (accessed via zt.zot) does not have method 'item_template'. Cannot create item for '{entry['title']}'.")
        return None
    except Exception as e:
        log.error(f"Error getting Zotero item template for type '{zot_item_type}': {e}")
        return None

    item_template['collections'] = [target_collection_key]

    # Field Mapping
    if zot_item_type == "case":
        item_template['caseName'] = entry['case_name']
        item_template['shortTitle'] = entry['title']  # Specific document title
        item_template['court'] = entry.get('place_of_publication', "International Court of Justice")
        if entry['date'] != "Unknown Date": item_template['dateDecided'] = entry['date']
        item_template['reporter'] = "ICJ Reports"
        item_template['url'] = entry.get('pdf_url', '')
        item_template['language'] = entry.get('language', 'en')
        item_template[
            'abstractNote'] = f"Document: {entry['title']}\nDocument Type (ICJ): {entry['doc_type']}\nCase ID (ICJ): {entry.get('case_id', 'N/A')}\nFile ID (from filename): {entry.get('file_id_from_filename', 'N/A')}"
        item_template.pop('archive', None)
    elif zot_item_type == "report":
        item_template['title'] = entry['title']
        item_template['institution'] = entry.get('place_of_publication', "International Court of Justice")
        if entry['date'] != "Unknown Date": item_template['date'] = entry['date']
        item_template['url'] = entry.get('pdf_url', '')
        item_template['language'] = entry.get('language', 'en')
        item_template[
            'abstractNote'] = f"Original Document Type: {entry['doc_type']}\nCase: {entry['case_name']} (ICJ Case ID: {entry.get('case_id', 'N/A')})\nFile ID (from filename): {entry.get('file_id_from_filename', 'N/A')}"
    else:
        item_template['title'] = entry['title']
        if entry['date'] != "Unknown Date": item_template['date'] = entry['date']
        item_template['url'] = entry.get('pdf_url', '')
        item_template['language'] = entry.get('language', 'en')
        item_template[
            'abstractNote'] = f"Document Type (ICJ): {entry['doc_type']}\nCase: {entry['case_name']} (ICJ Case ID: {entry.get('case_id', 'N/A')})\nFile ID (from filename): {entry.get('file_id_from_filename', 'N/A')}"
        item_template['publisher'] = entry.get('place_of_publication', "International Court of Justice")

    tags = ["ICJ"]
    if entry.get('doc_type') and entry['doc_type'] != "Unknown Type":
        tags.append(entry['doc_type'].replace(" ", "_").replace(":", ""))
    if entry.get('year') and entry['year'] != "Unknown Year":
        tags.append(entry['year'])
    if entry.get('case_name') and entry['case_name'] != "Unknown Case":
        case_name_parts = normalize_collection_name(entry['case_name'], 200).split('_')
        tags.extend(part for part in case_name_parts if len(part) > 3)
    if entry.get('file_id_from_filename'):
        tags.append(f"fileid_{entry['file_id_from_filename']}")
    item_template['tags'] = [{'tag': t} for t in list(set(tags))]

    log.debug(f"Zotero item template prepared: {json.dumps(item_template, indent=2)}")

    try:
        resp = zot_api_client.create_items([item_template])
        if resp and 'successful' in resp and '0' in resp['successful'] and 'key' in resp['successful']['0']:
            item_key = resp['successful']['0']['key']
            log.info(
                f"Successfully created Zotero item for '{entry['title']}' (Case: '{entry['case_name']}') with key {item_key}.")

            if pdf_local_path and pdf_local_path.exists():
                log.info(f"Attaching PDF: {pdf_local_path} to item {item_key}")
                attach_resp = zot_api_client.attachment_simple([str(pdf_local_path)], parentid=item_key)
                log.debug(f"Attachment response: {attach_resp}")
                if attach_resp:
                    log.info(f"Successfully attached PDF '{pdf_local_path.name}' to Zotero item {item_key}.")
                else:
                    log.warning(f"PDF attachment to Zotero item {item_key} may have failed. Response: {attach_resp}")
            elif entry.get('pdf_url'):
                log.warning(
                    f"PDF for item {item_key} was not downloaded or path was invalid ({pdf_local_path}). URL: {entry['pdf_url']}")
            return item_key
        else:
            log.error(f"Failed to create Zotero item for '{entry['title']}'. Response: {json.dumps(resp, indent=2)}")
            return None
    except AttributeError as ae:
        log.error(
            f"The Zotero API client (accessed via zt.zot) is missing a required method (e.g. create_items, attachment_simple): {ae}. Error for '{entry['title']}'.")
        return None
    except Exception as e:
        log.error(f"Zotero API error while creating item or attaching PDF for '{entry['title']}': {e}")
        return None


# --- Main ---
if __name__ == "__main__":
        PDF_DOWNLOAD_DIR = "temp_icj_pdfs"
        RIS_FILE_PATH = r"C:\Users\luano\PycharmProjects\Back_end_assis\scrapping\ICJ\icj_cases.ris"
        ZOTERO_TOP_COLLECTION_NAME = "auto_ICJ_Cases"

        zt_instance = None
        try:
            if ZOTERO_LIBRARY_ID and ZOTERO_API_KEY:
                zt_instance = Zotero(
                    library_id=ZOTERO_LIBRARY_ID,
                    api_key=ZOTERO_API_KEY,
                    library_type=ZOTERO_LIBRARY_TYPE,
                )
                log.info(f"User's Zotero class initialized for library ID {ZOTERO_LIBRARY_ID}.")
                if not (hasattr(zt_instance, 'zot') and hasattr(zt_instance.zot, 'items') and callable(
                        zt_instance.zot.items)):
                    log.error(
                        "The 'zt_instance.zot' attribute is not a valid Zotero API client or is missing critical methods like 'items'. Zotero processing will fail.")
                    zt_instance = None
            else:
                log.warning("Zotero Library ID or API Key not found in environment. Zotero processing disabled.")
        except ImportError:
            log.error("Failed to import 'Zotero' class from 'zotero_module.zotero_class'. Zotero processing disabled.")
        except Exception as e:
            log.error(f"Error initializing user's Zotero class: {e}. Zotero processing disabled.")
            zt_instance = None

        if not Path(RIS_FILE_PATH).exists():
            log.error(f"RIS file not found at: {RIS_FILE_PATH}. Cannot proceed.")
            exit()

        if not zt_instance:
            log.error("Zotero client (user's class instance) not initialized. Exiting.")
            exit()

        top_collection_key = None
        try:
            top_collection_key = zt_instance.find_or_create_top_collection(name=ZOTERO_TOP_COLLECTION_NAME)
            if not top_collection_key:
                log.error(f"Failed to find or create Zotero top collection: '{ZOTERO_TOP_COLLECTION_NAME}'. Aborting.")
                exit()
        except AttributeError:
            log.error(
                f"Your Zotero class instance (zt_instance) does not have the method 'find_or_create_top_collection'. Aborting.")
            exit()
        except Exception as e:
            log.error(f"An error occurred with Zotero top collection setup: {e}. Aborting.")
            exit()

        with open(RIS_FILE_PATH, 'r', encoding='utf-8') as ris_file_handle:
            ris_entries_from_file = rispy.load(ris_file_handle)

        log.info(f"Loaded {len(ris_entries_from_file)} entries from RIS file: {RIS_FILE_PATH}")

        processed_count = 0
        created_count = 0

        for i, ris_data in enumerate(ris_entries_from_file):
            log.info(
                f"Processing RIS entry {i + 1}/{len(ris_entries_from_file)}: {ris_data.get('title', ris_data.get('primary_title', 'N/A'))[:70]}...")
            entry = map_ris_to_entry_dict(ris_data)

            if not entry.get('title') or entry['title'] == "Unknown Title":
                log.warning(f"Skipping RIS entry {i + 1} due to missing or unknown title.")
                continue
            if not entry.get('case_name') or entry['case_name'] == "Unknown Case":
                log.warning(f"Skipping RIS entry {i + 1} ('{entry['title']}') due to missing or unknown case name.")
                continue

            normalized_case_name = normalize_collection_name(entry['case_name'])



            item_exists = False
            try:
                if hasattr(zt_instance, 'zot') and callable(getattr(zt_instance.zot, 'items', None)):
                    # Check based on the specific document title
                    item_exists = check_item_exists_in_zotero_direct(zt_instance.zot, entry['title'],
                                                                     entry.get('pdf_url'), top_collection_key)
                else:
                    log.error(
                        "zt_instance.zot is not a valid Zotero API client or 'items' method is missing. Assuming item does not exist.")
            except Exception as e:
                log.error(
                    f"Error checking Zotero for existing item '{entry['title']}': {e}. Assuming it does not exist.")

            if not item_exists:
                pdf_local_path = None
                if entry.get('pdf_url'):
                    Path(PDF_DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)  # Ensure download dir exists
                    pdf_filename_base = Path(urlparse(entry['pdf_url']).path).name
                    if not pdf_filename_base: pdf_filename_base = hashlib.md5(entry['pdf_url'].encode()).hexdigest()
                    safe_filename = "".join(
                        c if c.isalnum() or c in ['.', '-', '_'] else '_' for c in pdf_filename_base)
                    if not safe_filename.lower().endswith(".pdf"): safe_filename += ".pdf"
                    target_pdf_save_path = Path(PDF_DOWNLOAD_DIR) / safe_filename

                    if target_pdf_save_path.exists() and target_pdf_save_path.stat().st_size > 0:
                        log.info(f"PDF already exists locally, using: {target_pdf_save_path}")
                        pdf_local_path = target_pdf_save_path
                    else:
                        pdf_local_path = download_file_icj(entry['pdf_url'], str(target_pdf_save_path))
                else:
                    log.warning(f"No PDF URL found in RIS entry for '{entry['title']}'. Cannot download PDF.")

                item_key = create_zotero_item_from_entry(zt_instance, entry, top_collection_key, pdf_local_path)
                if item_key:
                    created_count += 1

                # If download_file saves directly to target_pdf_save_path, no further action needed here for the file itself.
                # Cleanup of PDF_DOWNLOAD_DIR can happen at the end if desired.

            else:
                log.info(
                    f"Item '{entry['title']}' (or its URL) likely already exists in Zotero subcollection '{normalized_case_name}'. Skipping.")

            processed_count += 1

        log.info(
            f"Finished processing RIS file. Total entries: {len(ris_entries_from_file)}. Entries processed: {processed_count}. New Zotero items created: {created_count}.")

        if Path(PDF_DOWNLOAD_DIR).exists():
            try:
                if not any(Path(PDF_DOWNLOAD_DIR).iterdir()):
                    Path(PDF_DOWNLOAD_DIR).rmdir()
                    log.info(f"Cleaned up empty PDF download directory: {PDF_DOWNLOAD_DIR}")
                else:
                    log.info(
                        f"PDF download directory {PDF_DOWNLOAD_DIR} is not empty. Manual cleanup may be required if files are no longer needed.")
            except OSError as e:
                log.error(f"Error cleaning up PDF download directory {PDF_DOWNLOAD_DIR}: {e}")

        log.info("Zotero processing from RIS file finished.")

# download_file(url="https://www.icj-cij.org/sites/default/files/case-related/180/180-20241112-jud-01-00-en.pdf",save_path_str="180-20241112-jud-01-00-en.pdf")