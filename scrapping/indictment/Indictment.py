# #!/usr/bin/env python3
# """
# scrape_cyber_indictments.py
# Scrape DOJ press-releases / PDFs announcing cyber-related indictments of
# foreign-state actors (top-10 countries) from **both** the live site
# (`affiliate=justice`) *and* the historical archive
# (`affiliate=justice-archive`) — without using Search.gov’s JSON API.
#
# Needs:  requests  beautifulsoup4  pandas   (pip install …)
# Tested with Python 3.12
# """
# import ast
# import os
# import re, time, random, html, itertools, sys
# from datetime import datetime
# from typing  import List, Dict
#
# import requests
# from bs4      import BeautifulSoup
# import pandas as pd
#
# from gpt_api import call_models
#
# # ----------------------------------------------------------------------
# AFFILIATES = [
#     ("current",  "justice"),          # live site
#     ("archive",  "justice-archive"),  # 1990-Jan 2025 snapshot
# ]
#
# # top-10 countries most often named in cyber-indictments
# COUNTRY_GROUPS = {
#     "China"       : ["China", "Chinese", "PRC"],
#     "Russia"      : ["Russia", "Russian"],
#     "Iran"        : ["Iran", "Iranian", "IRGC"],
#     "North Korea" : ['"North Korea"', "North-Korean", "NorthKorean", "DPRK"],
#
# }
# charges_groups = {
# "Cyber Campaign": ["campaign", "Hacking campaign" ],
# "Cyber Espionage": ["Espionage", ],
# "Cyber Theft": ["Theft", ],
#
# }
#
# charges = {
#     "China": ["Computer Hacking", "Theft of Trade Secrets", "Wire Fraud"],
#     "Russia": ["Computer Hacking", "Wire Fraud", "Identity Theft"],
#     "Iran": ["Computer Hacking", "Wire Fraud", "Identity Theft"],
#     }
# BASE_TERMS = ["indictment", "cyber", "indicted",
#                "charge", "charged", "unsealed"]
#
# POS_PAT = re.compile(
#     r"(?is)\b(indict(?:ed|ment|ments)?|charge(?:d|s)?|unseal(?:ed)?)"
#     r".{0,100}"
#     r"\b(cyber|hack|computer|intrusion|malware|ransomware)\b"
# )
# NEG_PAT = re.compile(
#     r"(?is)\b("
#     r"foia|library|oip|hotline|complaint|memo|calendar|journal|budget|report|summary"
#     r"|resume|transcript|hearing|bulletin|presentation|manual|statistics"
#     r")\b"
# )
#
# HEADERS_commons = {
#     "User-Agent":
#       "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
#     "Accept":
#       "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
#     "Accept-Language": "en-US,en;q=0.9",
#     "Referer": "https://search.justice.gov/",
#     "Connection": "keep-alive",
# }
# SEARCH_ROOT = "https://search.justice.gov/search"
#
# # ----------------------------------------------------------------------
# def build_queries(max_len: int = 200) -> List[tuple[str, str]]:
#     """Yield (country, query_string)."""
#     for country, aliases in COUNTRY_GROUPS.items():
#         parts = [f"+{t}" for t in BASE_TERMS]
#         parts.append("+(" + " OR ".join(aliases) + ")")
#         q = " ".join(parts)
#         if len(q) > max_len:
#             raise ValueError(f"Query for {country} exceeds Search.gov limit")
#         yield country, q
#
# # ----------------------------------------------------------------------
# def fetch_results(affiliate: str, query: str, page: int,
#                   session: requests.Session) -> str | None:
#     """Return HTML for one result page, retrying with back-off."""
#     params = {"affiliate": affiliate, "query": query, "page": page}
#     for attempt in range(6):
#         r = session.get(SEARCH_ROOT, params=params,
#                         headers=HEADERS_commons, timeout=20)
#         if r.status_code == 200:
#             time.sleep(random.uniform(2.5, 4.0))            # politeness
#             return r.text
#         wait = (2 ** attempt) + random.uniform(0.5, 1.5)
#         print(f"    ↻ HTTP {r.status_code}; retry {wait:.1f}s", file=sys.stderr)
#         time.sleep(wait)
#     return None
#
# def no_results_page(html_doc: str) -> bool:
#     """Detect Search.gov's ‘Sorry, no results’ block."""
#     return ('id="no-results"' in html_doc or
#             "Sorry, no results found for" in html_doc)
#
# # ----------------------------------------------------------------------
# def parse_results(html_doc: str, country: str, query: str,
#                   affiliate_label: str) -> List[Dict[str, str]]:
#     soup  = BeautifulSoup(html_doc, "lxml")
#     hits: List[Dict[str, str]] = []
#
#     for blk in soup.select("div.content-block-item.result"):
#         a_tag = blk.select_one("h4.title a")
#         url_el, snip = blk.select_one("span.url"), blk.select_one("span.description")
#         if not (a_tag and url_el and snip):
#             continue
#
#         title   = html.unescape(a_tag.get_text(" ", strip=True))
#         url     = html.unescape(url_el.text.strip())
#         snippet = html.unescape(snip.get_text(" ", strip=True))
#         blob    = f"{title} {snippet}"
#
#         if NEG_PAT.search(blob) or not POS_PAT.search(blob):
#             continue
#         if not any(re.search(rf"(?i)\b{re.escape(k.strip('\"'))}\b", blob)
#                    for k in COUNTRY_GROUPS[country]):
#             continue
#
#         hits.append({
#             "affiliate" : affiliate_label,   # current / archive
#             "country"   : country,
#             "query"     : query,
#             "title"     : title,
#             "url"       : url,
#             "snippet"   : snippet,
#         })
#     return hits
#
# # ----------------------------------------------------------------------
# def crawl(max_pages: int = 500, max_empty_pages: int = 1) -> List[Dict[str, str]]:
#     session   = requests.Session()
#     seen_urls = set()
#     all_rows: List[Dict[str, str]] = []
#
#     for affiliate_label, affiliate in AFFILIATES:
#         print(f"\n################ {affiliate_label.upper()} COLLECTION ###############")
#         for country, q in build_queries():
#             pages_fetched, empty_streak = 0, 0
#             print(f"\n== {country.upper()}  ::  {q}")
#             for page in itertools.count(start=0):
#                 if page >= max_pages:
#                     print("  • reached page hard-cap")
#                     break
#
#                 html_doc = fetch_results(affiliate, q, page, session)
#                 if html_doc is None:
#                     print("  • gave up (repeated 403/5xx)")
#                     break
#                 if no_results_page(html_doc):
#                     print("  • ‘no results’ block ⇒ stop paging")
#                     break
#
#                 hits = parse_results(html_doc, country, q, affiliate_label)
#                 pages_fetched += 1
#                 print(f"  page {page:>3}: {len(hits):2} hits "
#                       f"(running total {len(all_rows)+len(hits)})")
#
#                 for h in hits:
#                     key = h["url"].lower()
#                     if key not in seen_urls:
#                         seen_urls.add(key)
#                         all_rows.append(h)
#
#                 empty_streak = 0 if hits else empty_streak + 1
#                 if empty_streak > max_empty_pages:
#                     print("  • consecutive empty pages > limit ⇒ stop")
#                     break
#
#             print(f"→ {pages_fetched} pages fetched, "
#                   f"{len(all_rows)} unique rows so far.")
#             time.sleep(random.uniform(5, 8))        # long pause per country
#     return all_rows
#
# # ----------------------------------------------------------------------
# def save_outputs(rows: List[Dict[str, str]]):
#     df = pd.DataFrame(rows)
#     df.to_csv("cyber_indictments.csv", index=False)
#     df.to_excel("cyber_indictments.xlsx", index=False)
#     print(f"\n✓ saved {len(df)} unique records "
#           f"→ cyber_indictments.csv  &  cyber_indictments.xlsx")
#
# # ----------------------------------------------------------------------
# # if __name__ == "__main__":
# #     rows = crawl()
# #     save_outputs(rows)
#
# import requests
# from bs4 import BeautifulSoup, NavigableString
# from urllib.parse import urljoin, urlparse
# import re
# import copy
# import pandas as pd
# import json
# import time
# import os
# from datetime import datetime  # For date parsing
#
#
# # --- [ Keep your existing clean_html_content function here ] ---
# def clean_html_content(soup_tag, base_url):
#     """
#     Cleans the HTML content of a BeautifulSoup tag.
#     - Removes script, style, and svg tags.
#     - Removes unwanted attributes (class, id, style, etc.) but keeps essential ones (href, src, title, alt, target, rel).
#     - Converts relative URLs in href and src to absolute.
#     """
#     if not soup_tag:
#         return ""
#
#     for s in soup_tag.find_all(['script', 'style', 'svg']):
#         s.decompose()
#
#     allowed_attrs = {
#         'a': ['href', 'title', 'target', 'rel'],
#         'img': ['src', 'alt', 'title', 'width', 'height'],
#     }
#     default_allowed_attrs = []
#
#     for tag in soup_tag.find_all(True):
#         current_allowed = allowed_attrs.get(tag.name, default_allowed_attrs)
#         attrs = dict(tag.attrs)
#         for attr_name, attr_value in attrs.items():
#             if attr_name not in current_allowed:
#                 del tag[attr_name]
#             else:
#                 if attr_name in ['href', 'src']:
#                     tag[attr_name] = urljoin(base_url, attr_value)
#     return str(soup_tag)
#
#
# def extract_year_from_date_string(date_str):
#     """
#     Extracts the year from various date string formats.
#     Tries to parse ISO format first, then looks for a 4-digit year.
#     """
#     if not date_str or not isinstance(date_str, str):
#         return None
#     try:
#         # Try parsing ISO 8601 format (e.g., "2025-03-05T12:00:00Z")
#         dt_obj = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
#         return str(dt_obj.year)
#     except ValueError:
#         # Fallback: Try to find a 4-digit year pattern
#         match = re.search(r'\b(\d{4})\b', date_str)
#         if match:
#             year = int(match.group(1))
#             # Basic sanity check for year (e.g., between 1900 and current year + a bit)
#             if 1900 <= year <= datetime.now().year + 5:
#                 return str(year)
#     return None  # Return None if year cannot be extracted
#
#
# def extract_press_release_data_from(url):
#     """
#     Extracts detailed information from a Justice Department press release URL,
#     with year-only dates and specific related content extraction.
#     """
#     headers = {
#         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
#     }
#     print(f"   Fetching data for URL: {url}")
#     try:
#         response = requests.get(url, headers=headers, timeout=20)
#         response.raise_for_status()
#         html_content = response.content
#     except requests.exceptions.RequestException as e:
#         print(f"   Error fetching URL {url}: {e}")
#         return None
#
#     soup = BeautifulSoup(html_content, 'html.parser')
#
#     data = {
#         "input_url": url,
#         "title": None,
#         "description_html": None,
#         "date_year": None,  # Changed to store only year
#         "updated_date_year": None,  # Changed to store only year
#         "attachments": [],
#         "topics": [],
#         "components": [],
#         "related_content": [],  # Will now be populated
#         "press_release_number": None,
#         "intext_links": []
#     }
#
#     parsed_url_obj = urlparse(url)
#     base_url = f"{parsed_url_obj.scheme}://{parsed_url_obj.netloc}"
#
#     title_tag = soup.find('h1', class_='page-title')
#     if title_tag:
#         span_tag = title_tag.find('span', class_='field-formatter--string')
#         data['title'] = span_tag.get_text(strip=True) if span_tag else title_tag.get_text(strip=True)
#
#     # --- Date (extract year) ---
#     date_div = soup.find('div', class_='node-date')
#     if date_div:
#         time_tag = date_div.find('time')
#         if time_tag:
#             original_date_str = time_tag.get('datetime') or time_tag.get_text(strip=True)
#             data['date_year'] = extract_year_from_date_string(original_date_str)
#
#     # --- Updated Date (extract year) ---
#     updated_date_tag = soup.find('div', class_='node-updated-date')
#     if updated_date_tag:
#         original_updated_date_str = updated_date_tag.get_text(strip=True).replace('Updated ', '').strip()
#         data['updated_date_year'] = extract_year_from_date_string(original_updated_date_str)
#
#     description_container_div = soup.find('div', class_='field_body')
#     if not description_container_div:
#         node_body_div = soup.find('div', class_='node-body')
#         if node_body_div:
#             specific_field_body = node_body_div.find('div', class_=lambda x: x and 'field_body' in x.split())
#             description_container_div = specific_field_body if specific_field_body else node_body_div.find('div',
#                                                                                                            class_='text-formatted')
#
#     if description_container_div:
#         desc_copy_for_links = copy.deepcopy(description_container_div)
#         for link_tag in desc_copy_for_links.find_all('a', href=True):
#             href = link_tag.get('href')
#             if href and not href.startswith(('mailto:', 'javascript:')):
#                 temp_link_for_text = copy.deepcopy(link_tag)
#                 for svg_el in temp_link_for_text.find_all('svg'):
#                     svg_el.decompose()
#                 text = temp_link_for_text.get_text(strip=True)
#                 absolute_href = urljoin(base_url, href)
#                 data['intext_links'].append({"text": text, "href": absolute_href})
#         desc_copy_for_cleaning = copy.deepcopy(description_container_div)
#         data['description_html'] = clean_html_content(desc_copy_for_cleaning, base_url)
#
#     attachments_section = soup.find('div', class_='node-attachments')
#     if attachments_section:
#         for link_tag in attachments_section.find_all('a', class_='downloadable-src', href=True):
#             href = link_tag['href']
#             text = link_tag.get_text(strip=True)
#             absolute_href = urljoin(base_url, href)
#             if not any(att['href'] == absolute_href for att in data['attachments']):
#                 data['attachments'].append({"text": text, "href": absolute_href})
#
#     if description_container_div:
#         for media_doc_div in description_container_div.find_all('div', class_=lambda x: x and 'media--document' in x):
#             link_tag = media_doc_div.find('a', href=True)
#             if link_tag:
#                 href = link_tag['href']
#                 text = link_tag.get_text(strip=True)
#                 if href and ('/dl' in href or href.lower().endswith(('.pdf', '.doc', '.docx', '.zip', '.txt'))):
#                     absolute_href = urljoin(base_url, href)
#                     if not any(att['href'] == absolute_href for att in data['attachments']):
#                         data['attachments'].append({"text": text, "href": absolute_href})
#         note_p = description_container_div.find('p', string=lambda t: t and 'Note' in t and (
#                     'indictment' in t.lower() or 'document' in t.lower()))
#         attachment_links_source = note_p if note_p else description_container_div
#         for link_tag in attachment_links_source.find_all('a', href=True):
#             href = link_tag['href']
#             text = link_tag.get_text(strip=True)
#             if href and ('/dl' in href or href.lower().endswith(('.pdf', '.doc', '.docx', '.zip', '.txt'))):
#                 if not href.startswith(('mailto:', 'javascript:')):
#                     absolute_href = urljoin(base_url, href)
#                     if not any(att['href'] == absolute_href for att in data['attachments']):
#                         data['attachments'].append({"text": text, "href": absolute_href})
#     if not data['attachments'] and data['intext_links']:
#         for link_info in data['intext_links']:
#             href = link_info['href']
#             if '/dl' in href or href.lower().endswith(('.pdf', '.doc', '.docx', '.zip', '.txt')):
#                 if not any(att['href'] == href for att in data['attachments']):
#                     data['attachments'].append(link_info)
#
#     topics_div = soup.find('div', class_='node-topics')
#     if topics_div:
#         items_container = topics_div.find('div', class_='field__items')
#         if not items_container: items_container = topics_div
#         if items_container:
#             for topic_item in items_container.find_all('div', class_='field__item'):
#                 text = topic_item.get_text(strip=True)
#                 if text and text not in data['topics']:
#                     data['topics'].append(text)
#
#     components_div = soup.find('div', class_='node-component')
#     if components_div:
#         for item in components_div.find_all('div', class_='field__item'):
#             link_tag = item.find('a', href=True)
#             if link_tag:
#                 text = link_tag.get_text(strip=True)
#                 href = urljoin(base_url, link_tag['href'])
#                 if not any(comp['href'] == href for comp in data['components']):
#                     data['components'].append({"text": text, "href": href})
#
#     pr_num_span_label = soup.find('span', string=lambda text: text and "Press Release Number:" in text)
#     if pr_num_span_label:
#         pr_number_text = pr_num_span_label.next_sibling
#         if pr_number_text and isinstance(pr_number_text, str):
#             data['press_release_number'] = pr_number_text.strip()
#     if not data['press_release_number']:
#         article_tag = soup.find('article', class_='grid-row')
#         if article_tag:
#             article_text = article_tag.get_text(separator=" ")
#             match = re.search(r"Press Release Number:\s*([\w.-]+)", article_text)
#             if match:
#                 data['press_release_number'] = match.group(1).strip()
#
#     # --- Related Content Extraction ---
#     related_content_block = soup.find('div', id='block-views-block-related-content-related-content-block')
#     if not related_content_block:  # Fallback for slightly different class name structures sometimes seen
#         related_content_block = soup.find('div', class_=lambda x: x and 'block-views-blockrelated-content' in x)
#
#     if related_content_block:
#         # Find all items within the grid or list of related content
#         # The example uses 'views-row', but it could also be 'views-col' directly under a 'views-view-grid'
#         # or items in a 'related-content-display'
#         items_container = related_content_block.find('div', class_='views-view-grid')
#         if not items_container:
#             items_container = related_content_block.find('div', class_='related-content-display')  # broader fallback
#
#         if items_container:
#             # Look for individual 'views-row' or 'views-col' that contain the content pieces
#             content_items = items_container.find_all('div', class_='views-row', recursive=False)  # Direct children
#             if not content_items:  # If no 'views-row', try 'views-col' as direct children of the grid
#                 content_items = items_container.find_all('div', class_='views-col', recursive=False)
#
#             for item_div in content_items:
#                 # If we picked 'views-row', we might need to iterate its 'views-col' children
#                 actual_content_holders = []
#                 if 'views-row' in item_div.get('class', []):
#                     actual_content_holders.extend(item_div.find_all('div', class_='views-col', recursive=False))
#                 else:  # It's already a 'views-col' or similar single item container
#                     actual_content_holders.append(item_div)
#
#                 for content_holder in actual_content_holders:
#                     title_span = content_holder.find('div', class_='views-field-title')
#                     link_tag = title_span.find('a', href=True) if title_span else None
#
#                     # Teaser/description (optional)
#                     teaser_span = content_holder.find('div', class_='views-field-field-teaser')
#                     teaser_text = teaser_span.get_text(strip=True) if teaser_span else None
#
#                     # Date (optional, for context if needed, not for main data field)
#                     date_span = content_holder.find('div', class_='views-field-field-date')
#                     related_item_date_str = None
#                     if date_span:
#                         time_tag_related = date_span.find('time')
#                         if time_tag_related:
#                             related_item_date_str = time_tag_related.get('datetime') or time_tag_related.get_text(
#                                 strip=True)
#
#                     if link_tag and link_tag.get_text(strip=True):
#                         related_item = {
#                             "text": link_tag.get_text(strip=True),
#                             "href": urljoin(base_url, link_tag['href']),
#                             "teaser": teaser_text,
#                             "date_string": related_item_date_str  # Original date string of related item
#                         }
#                         data['related_content'].append(related_item)
#     return data
#
# def process_excel_and_scrape(input_excel_path, output_excel_path):
#     """
#     Reads URLs and countries from an input Excel, scrapes data for each URL,
#     adds the country, and saves all data to a new Excel file.
#     """
#     try:
#         input_df = pd.read_excel(input_excel_path, engine='openpyxl')
#         print(f"Successfully read {len(input_df)} rows from '{input_excel_path}'.")
#     except FileNotFoundError:
#         print(f"Error: Input file not found at '{input_excel_path}'")
#         return
#     except Exception as e:
#         print(f"Error reading Excel file '{input_excel_path}': {e}")
#         return
#
#     all_scraped_data = []
#     required_columns = ['url', 'country']
#
#     for col in required_columns:
#         if col not in input_df.columns:
#             print(f"Error: Missing required column '{col}' in the input Excel file.")
#             print(f"Available columns are: {input_df.columns.tolist()}")
#             return
#
#     print(f"Iterating through URLs. Expect columns: {input_df.columns.tolist()}")
#
#     for index, row in input_df.iterrows():
#         target_url = row.get('url')
#         country = row.get('country', None)
#
#         print(f"\nProcessing row {index + 1}:")
#         print(f"  Country: {country}")
#         print(f"  URL: {target_url}")
#
#         if pd.isna(target_url) or not isinstance(target_url, str) or not target_url.startswith('http'):
#             print(f"  Skipping row {index + 1} due to invalid or missing URL: '{target_url}'")
#             continue
#
#         extracted_data = extract_press_release_data_from(target_url)
#
#         if extracted_data:
#             extracted_data['country_from_input'] = country
#             all_scraped_data.append(extracted_data)
#             print(f"   Successfully scraped data for: {target_url}")
#         else:
#             print(f"   Failed to scrape data for: {target_url}. Adding placeholder.")
#             placeholder_data = {
#                 "input_url": target_url,
#                 "country_from_input": country,
#                 "title": "SCRAPING FAILED",
#                 "description_html": None, "date_year": None, "updated_date_year": None,  # Adjusted placeholder
#                 "attachments": [], "topics": [], "components": [], "related_content": [],
#                 "press_release_number": None, "intext_links": []
#             }
#             all_scraped_data.append(placeholder_data)
#
#         time.sleep(1)
#
#     if not all_scraped_data:
#         print("No data was successfully scraped or processed. Output Excel file will not be created.")
#         return
#
#     output_columns_order = [
#         "country_from_input", "input_url", "title", "description_html",
#         "date_year", "updated_date_year",  # Adjusted column names
#         "attachments", "topics", "components",
#         "related_content", "press_release_number", "intext_links"
#     ]
#
#     output_df = pd.DataFrame(all_scraped_data)
#     final_columns = [col for col in output_columns_order if col in output_df.columns]
#     for col in output_df.columns:
#         if col not in final_columns:
#             final_columns.append(col)
#     output_df = output_df[final_columns]
#
#     print("\n--- Preview of Scraped Data (First 5 rows) ---")
#     with pd.option_context('display.max_colwidth', 50,
#                            'display.max_rows', 5,
#                            'display.max_columns', None,
#                            'display.width', 1000):
#         print(output_df.head())
#
#     try:
#         output_df.to_excel(output_excel_path, index=False, engine='openpyxl')
#         print(f"\nAll processed data successfully saved to '{output_excel_path}'")
#     except Exception as e:
#         print(f"\nError saving data to output Excel file '{output_excel_path}': {e}")
#         print("Make sure you have 'openpyxl' installed in your project environment.")
#
#
# def analyze_titles_and_add_charges(input_excel_path, output_excel_path_with_charges):
#     """
#     Reads a previously scraped Excel file, analyzes titles using llmcall,
#     adds a 'charges' column, and saves to a new Excel file.
#     """
#     try:
#         df = pd.read_excel(input_excel_path, engine='openpyxl')
#         print(f"\nSuccessfully read {len(df)} rows from '{input_excel_path}' for charge analysis.")
#     except FileNotFoundError:
#         print(f"Error: Input file not found at '{input_excel_path}' for charge analysis.")
#         return
#     except Exception as e:
#         print(f"Error reading Excel file '{input_excel_path}' for charge analysis: {e}")
#         return
#
#     if 'title' not in df.columns:
#         print(f"Error: 'title' column not found in '{input_excel_path}'. Cannot analyze charges.")
#         print(f"Available columns are: {df.columns.tolist()}")
#         return
#
#     charges_list = []
#     print("Analyzing titles to determine charges...")
#
#     for index, row in df.iterrows():
#         title = row.get('title')
#         print(f"  Analyzing row {index + 1} - Title: {str(title)[:70]}...")  # Print a snippet of title
#
#         if pd.isna(title) or not isinstance(title, str) or title == "SCRAPING FAILED" or not title.strip():
#             print(f"      Skipping LLM call for invalid or missing title.")
#             charges_list.append("N/A - Invalid Title")
#             continue
#
#         prompt = f"analyse this title and extract the charges.  title={title}\n the return should be the main charge with max 3 words"
#
#         try:
#             # --- THIS IS WHERE YOU CALL YOUR ACTUAL LLM FUNCTION ---
#             response_api = call_models(text=prompt)["response"]
#
#             # ---
#             #
#
#             charges_list.append(response_api)
#             print(f"      LLM Response: {response_api}")
#         except Exception as e:
#             print(f"      Error during llmcall for title '{title}': {e}")
#             charges_list.append("Error in LLM call")
#
#         # Optional: Add a small delay if your llmcall involves an API that might have rate limits
#         # time.sleep(0.5) # e.g., 0.5 seconds
#
#     df['charges_from_llm'] = charges_list  # Add the new column
#
#     print("\n--- DataFrame with new 'charges_from_llm' column (First 5 rows) ---")
#     with pd.option_context('display.max_colwidth', 50,
#                            'display.max_rows', 5,
#                            'display.max_columns', None,
#                            'display.width', 1000):
#         print(df[['title', 'charges_from_llm']].head())  # Show relevant columns
#
#     try:
#         df.to_excel(output_excel_path_with_charges, index=False, engine='openpyxl')
#         print(f"\nDataFrame with charges successfully saved to '{output_excel_path_with_charges}'")
#     except Exception as e:
#         print(f"\nError saving DataFrame with charges to Excel: {e}")
# if __name__ == '__main__':
#     # t='Chinese Nationals with Ties to the PRC Government and “APT27” Charged in a Computer Hacking Campaign for Profit, Targeting Numerous U.S. Companies, Institutions, and Municipalities'
#     # prompt = f"analyse this title and extract the charges.  title={t}\n the return should be the main charge with max 3 words"
#     # response_api = call_models(text=prompt)
#     # # response_api="{'provider': 'openai', 'response': 'Computer Hacking'}"
#     #
#     # print(response_api)
#     # print(response_api["response"])
#     #
#     # print(response_api)
#     # input("Press Enter to continue...")  # Pause for user to see the response c
#     analyze_titles_and_add_charges(input_excel_path=r"C:\Users\luano\PycharmProjects\Back_end_assis\scrapping\scraped_cyber_indictments_output_20250520_221755.xlsx",output_excel_path_with_charges="indictments_output_with_charges.xlsx")
#     # --- You can also test a single URL with the updated extractor: ---
#     # test_url_for_related_content = "https://www.justice.gov/usao-dc/pr/leader-proud-boys-sentenced-17-years-prison-seditious-conspiracy-and-other-charges" # Replace with a URL that HAS related content
#     # if test_url_for_related_content:
#     #     print(f"\n--- Testing single URL for related content: {test_url_for_related_content} ---")
#     #     single_data = extract_press_release_data_from(test_url_for_related_content)
#     #     if single_data:
#     #         print(json.dumps(single_data, indent=2, ensure_ascii=False))
#     #     else:
#     #         print("Failed to get data for single URL test.")

