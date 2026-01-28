import hashlib
import json
from html.parser import HTMLParser
import html
import fitz
import logging

from pathlib import Path
import math
from typing import Optional, Dict, Any, Tuple, List, Union

import os
import time
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import pyautogui

import tkinter as tk
from tkinter import ttk
import ast

import requests

from extract_pdf_ui import process_pdf
from bs4 import BeautifulSoup

from pyzotero import zotero, zotero_errors


from datetime import datetime, timezone

from src.core.utils.calling_models import call_models_na, _process_batch_for, call_models_old_backin



def reconstruct_extra_field(original_extra_text: str, updates: dict) -> str:
    """
    Reconstructs the 'extra' field string by updating it with new values.
    Preserves the order and any un-editable lines from the original text.
    """
    # --- FIX: Removed trailing colons from keys ---
    display_key_map = {
        'department': 'Department', 'institution': 'Institution', 'country': 'Country',
        'funding': 'Funding', 'theoretical_orientation': 'Theoretical Orientation',
        'level_of_analysis': 'Level of Analysis', 'argumentation_logic': 'Argumentation Logic',
        'evidence_source_base': 'Evidence Source Base', # No colon
        'methodology': 'Methodology',
        'methods': 'Methods', # No colon
        'framework_model': 'Framework/Model', # No colon
        'contribution_type': 'Contribution Type', 'attribution_lens_focus': 'Attribution Lens Focus',
        'topic_phrases': 'Topic Phrases',
        'user_notes': 'Screening Notes'
    }
    key_lookup = {v.lower(): k for k, v in display_key_map.items()}

    lines = original_extra_text.strip().split('\n') if original_extra_text else []
    new_lines = []
    updated_keys = set()

    for line in lines:
        if ':' in line:
            key_part, value_part = line.split(':', 1)
            key_lower = key_part.strip().lower()
            standard_key = key_lookup.get(key_lower)

            if standard_key and standard_key in updates:
                new_value_from_ui = updates.get(standard_key, value_part.strip())
                new_lines.append(f"{display_key_map[standard_key]}: {new_value_from_ui}")
                updated_keys.add(standard_key)
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)

    for key, value in updates.items():
        if key not in updated_keys and value and str(value).strip():
            if key in display_key_map:
                new_lines.append(f"{display_key_map[key]}: {value}")

    return "\n".join(new_lines)
#
def _parse_extra_field(extra_string: str) -> dict:
    """
    Parses a Zotero 'extra' field string into a dictionary of key-value pairs,
    creating a key for every field in the defined map.
    """
    # Define a complete mapping from all expected keys (lowercase) to standardized column names
    key_map = {
        'institution': 'institution',
        'country': 'country',
        # 'funding': 'funding',
        'theoretical orientation': 'theoretical_orientation',
        'ontology': 'ontology',
        "epistemology":"epistemology",
        'argumentation logic': 'argumentation_logic',
        'evidence source base': 'evidence_source_base',
        'methodology': 'methodology',
        'methods': 'methods',
        'framework model': 'framework_model',
        'contribution type': 'contribution_type',
        'attribution lens focus': 'attribution_lens_focus',
        "research_question_purpose":              "research_question_purpose"
,

        'topic phrases': 'controlled_vocabulary_terms',
        # Adding 'department' in case it appears, as requested previously
        'department': 'department'
    }

    # Initialize a dictionary with all possible columns set to a default empty string.
    # This ensures the DataFrame will always have these columns.
    parsed_data = {col_name: "" for col_name in key_map.values()}

    if not isinstance(extra_string, str) or not extra_string.strip():
        return parsed_data

    # Simpler, more robust parsing loop
    for line in extra_string.split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            clean_key = key.strip().lower()

            # If the key from the file is in our map, save the value
            if clean_key in key_map:
                column_name = key_map[clean_key]
                parsed_data[column_name] = value.strip()

    return parsed_data
#
# # --- Add this NEW standalone helper function in data_processing.py ---
# def reconstruct_extra_field(original_extra_text: str, updates: dict) -> str:
#     """
#     Reconstructs the 'extra' field string by updating it with new values.
#     Preserves the order and any un-editable lines from the original text.
#     """
#     display_key_map = {
#         'citations': 'Citations',
#
#         'department': 'Department', 'institution': 'Institution', 'country': 'Country',
#         'funding': 'Funding', 'theoretical_orientation': 'Theoretical Orientation',
#         'level_of_analysis': 'Level of Analysis', 'argumentation_logic': 'Argumentation Logic',
#         'evidence_source_base': 'Evidence Source Base', 'methodology': 'Methodology',
#         'methods': 'Methods', 'framework_model': 'Framework/Model',
#         'contribution_type': 'Contribution Type', 'attribution_lens_focus': 'Attribution Lens Focus',
#         'topic_phrases': 'Topic Phrases',
#         # Add a key for user notes from the screener
#         'user_notes': 'Screening Notes'
#     }
#
#     # Reverse map for quick lookup from line key to standard key
#     key_lookup = {v.lower(): k for k, v in display_key_map.items()}
#
#     lines = original_extra_text.strip().split('\n') if original_extra_text else []
#     new_lines = []
#     updated_keys = set()
#
#     for line in lines:
#         if ':' in line:
#             key_part, value_part = line.split(':', 1)
#             key_lower = key_part.strip().lower()
#             standard_key = key_lookup.get(key_lower)
#
#             if standard_key and standard_key in updates:
#                 new_value = updates.get(standard_key, value_part.strip())
#                 # Use the canonical display key from the map to maintain consistent casing
#                 display_key = display_key_map[standard_key]
#                 new_lines.append(f"{display_key}: {new_value}")
#                 updated_keys.add(standard_key)
#             else:
#                 new_lines.append(line)  # Preserve unmanaged lines
#         else:
#             new_lines.append(line)  # Preserve lines without a colon
#
#     # Add any new keys from 'updates' that were not in the original text
#     for key, value in updates.items():
#         if key not in updated_keys and value and str(value).strip():
#             if key in display_key_map:
#                 display_key = display_key_map[key]
#                 new_lines.append(f"{display_key}: {value}")
#
#     return "\n".join(new_lines)
#
#
# from bs4 import BeautifulSoup
# from urllib.parse import urljoin
# import time
#
# import json
# import os
#

initial=0
topic_sentence_count, keywords_count=initial,initial

import re
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

# Configure basic logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

def clean_html_for_merge(html_content):
    """Removes surrounding <p> tags for cleaner merging."""
    if not isinstance(html_content, str):
        return "" # Handle potential non-string input gracefully
    # Remove leading <p...> tag, handling potential attributes
    cleaned = re.sub(r'^\s*<p[^>]*>', '', html_content.strip(), count=1)
    # Remove trailing </p> tag
    cleaned = re.sub(r'</p>\s*$', '', cleaned, count=1)
    return cleaned.strip()


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
         return True # Treat as ignorable if text extraction fails

    if not text_content: # Handle cases where stripping tags leaves nothing
        logging.debug(f"Ignoring paragraph (no text content after stripping tags): {para_html[:50]}...")
        return True

    # --- Specific Patterns for Exclusion ---
    # Figure/Table Captions (often start with Fig./Table and are short)
    b_tag = None
    try: # Use try-except as BeautifulSoup operations can sometimes fail on weird input
         soup_p = BeautifulSoup(para_html, 'html.parser').find('p')
         if soup_p:
             b_tag = soup_p.find('b')
    except Exception:
         pass # Ignore parsing errors for this specific check

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
        logging.debug(f"Ignoring paragraph (text length {len(text_content)} < {min_text_length}): {text_content[:50]}...")
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

    logging.info(f"--- Starting Automatic Paragraph Processing ({n} paragraphs, Min Final Length: {min_final_length}) ---")

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
             logging.warning(f"Skipping paragraph {i+1} due to empty HTML.")
             i += 1
             continue

        current_len = len(para_html)
        logging.debug(f"Processing Original Paragraph {i+1}/{n} (Length: {current_len})")

        # Determine initial state based *only* on length for merging rules
        is_short_initial = current_len < 300 # Use 300 for the *initial* short check
        is_medium = 300 <= current_len < 500

        # Check ignorable status for initial filtering
        ignorable = is_paragraph_ignorable(para_html, min_ignore_length)

        # Rule 1: Automatically exclude ignorable paragraphs upfront
        if ignorable:
            logging.info(f"-> Excluding paragraph {i+1} (len {current_len}, initially ignorable content).")
            i += 1
            # Keep last_item_was_merged_into status as it was
            continue

        # Rule 2 & 3: Attempt merging for medium paragraphs OR non-ignorable short paragraphs
        if is_medium or is_short_initial: # Use is_short_initial here
            # Check if the paragraph is short even if not initially ignorable
            # This logging differentiates the two cases for clarity
            if is_short_initial:
                 log_msg_type = "short, non-ignorable"
            else: # is_medium
                 log_msg_type = "medium"
            logging.info(f"-> Paragraph {i+1} (len {current_len}) is {log_msg_type}. Attempting merge...")

            merged = False
            # --- Try merging backward ---
            if processed_list and not last_item_was_merged_into:
                logging.debug(f"   Attempting backward merge for paragraph {i+1}...")
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
                    logging.info(f"   Merged paragraph {i+1} BACKWARD into previous. New length {len(merged_html)} >= {min_final_length}. Keeping.")
                    last_item_was_merged_into = True
                    merged = True
                    i += 1
                else:
                    logging.info(f"   Backward merge result for {i+1} is too short (len {len(merged_html)} < {min_final_length}). Cannot merge backward.")
                    # Keep trying forward merge or exclusion

            # --- Try merging forward ---
            if not merged and i + 1 < n: # Only try forward if backward failed or wasn't possible
                 logging.debug(f"   Cannot merge backward (or result too short). Attempting forward merge for paragraph {i+1}...")
                 # Check if the *next* paragraph is valid for merging
                 next_text_temp, next_html_temp = paragraphs[i+1]
                 next_len = len(next_html_temp)
                 next_is_ignorable = is_paragraph_ignorable(next_html_temp, min_ignore_length)

                 if next_is_ignorable:
                      logging.info(f"   Cannot merge paragraph {i+1} forward, next paragraph {i+2} is ignorable.")
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
                        logging.info(f"   Merged paragraph {i+1} (len {current_len}) FORWARD with {i+2} (len {next_len}). New length {merged_len} >= {min_final_length}. Keeping.")
                        consumed_by_merge_forward.add(i + 1)
                        last_item_was_merged_into = True
                        merged = True
                        i += 2 # Skip both original paragraphs
                    else:
                        logging.info(f"   Forward merge result for {i+1} and {i+2} is too short (len {merged_len} < {min_final_length}). Cannot merge forward.")
                        # Fall through to the 'if not merged:' block

            # --- Cannot merge OR merge result too short ---
            if not merged:
                # Apply the strict exclusion: if it's short *now* and couldn't be successfully merged, exclude it.
                # Note: A medium paragraph that failed merging would NOT be short here.
                if current_len < min_final_length: # Check against the required final length
                    logging.info(f"   Cannot merge paragraph {i+1} successfully to meet min length {min_final_length}. Excluding.")
                    # Do NOT append to processed_list
                else:
                    # This case covers medium paragraphs that failed merging - they are already >= 300 but < 500
                    logging.info(f"   Cannot merge paragraph {i+1} (medium). Keeping as is.")
                    processed_list.append({'text': para_text, 'html': para_html, 'merged': False})
                    last_item_was_merged_into = False

                i += 1 # Move past the current paragraph

        # Rule 4: Keep long paragraphs (which are >= 500, thus >= min_final_length) as is
        elif current_len >= 500:
            logging.info(f"-> Paragraph {i+1} (len {current_len}) is long enough. Keeping as is.")
            processed_list.append({'text': para_text, 'html': para_html, 'merged': False})
            last_item_was_merged_into = False
            i += 1

        # Safety net
        else:
             logging.warning(f"-> UNEXPECTED STATE for paragraph {i+1} (len {current_len}). Keeping as is (will be excluded if < {min_final_length}).")
             if current_len >= min_final_length:
                 processed_list.append({'text': para_text, 'html': para_html, 'merged': False})
                 last_item_was_merged_into = False
             else:
                 logging.info(f"   Excluding unexpected state paragraph {i+1} because len {current_len} < {min_final_length}.")
             i += 1


    logging.info("--- Automatic Paragraph Processing Complete ---")
    # Final check: Although the logic *should* prevent it, we can add a final filter pass
    # to be absolutely sure no paragraph < min_final_length remains.
    final_checked_paragraphs = []
    for item in processed_list:
        if len(item['html']) >= min_final_length:
            final_checked_paragraphs.append((item['text'], item['html']))
        else:
            logging.warning(f"Post-processing filter: Excluding paragraph because len {len(item['html'])} < {min_final_length}. Text: {item['text'][:60]}...")

    # return [(item['text'], item['html']) for item in processed_list] # Original return
    return final_checked_paragraphs # Return the double-checked list
def group_by_publication_title(items,feature="url"):
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

        if feature=="pub":


        # print(item["data"]["url"].split("/")[2])

            #
            publisher=item["data"].get("publisher", None)
            proceedingsTitle_title=item["data"].get("proceedingsTitle", None)
            publication_title=item["data"].get("publicationTitle", None)
            #
            # # Extract the publicationTitle; default to an empty string if missing
            pub_title =  publisher or publication_title or proceedingsTitle_title or "No feature"
            pub_title=pub_title.lower().strip()


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
        download_dir = os.path.expanduser(r"C:\Users\luano\Downloads")  # Adjust if necessary
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


#
# def create_one_note(self, content="", item_id="", collection_id="", tag="", beginning=False
#                     ):
#     new_note = ''
#
#     cabecalho = generate_cabecalho(zot=self.zot, item_id=item_id)
#
#     new_content = f'<html><head><title>{tag.strip()}</title><style>body{{font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;background-color:#f0f2f5;color:#333;margin:0;padding:20px;}}.container{{max-width:800px;margin:0 auto;background-color:#fff;padding:30px;border-radius:10px;box-shadow:0 4px 8px rgba(0,0,0,0.1);line-height:1.6;}}h1{{font-size:28px;color:#2c3e50;margin-bottom:20px;border-bottom:2px solid #e67e22;padding-bottom:10px;}}.cabecalho{{font-size:16px;font-weight:bold;color:#555;margin-bottom:20px;padding:10px;background-color:#f9f9f9;border-left:4px solid #3498db;}}.content{{font-size:16px;color:#444;margin-top:20px;line-height:1.8;}}.content p{{margin-bottom:15px;}}.content ul{{list-style-type:disc;margin-left:20px;}}.content li{{margin-bottom:10px;}}.footer{{margin-top:30px;font-size:14px;color:#777;text-align:center;border-top:1px solid #e1e1e1;padding-top:10px;}}</style></head><body><div class="container"><h1>{tag}</h1><div class="cabecalho">{cabecalho}</div><div class="content">{content}</div></div></body></html>' if beginning == False else content
#
#     # Create the new note
#     if item_id:
#         new_note = self.zot.create_items([{
#             "itemType": "note",
#             'parentItem': item_id,
#             "note": new_content,
#             'tags': [{"tag": tag}]
#
#         }])
#     if collection_id:
#         new_note = self.zot.create_items([{
#             "itemType": "note",
#             'collections': [collection_id],
#             "note": content,
#             'tags': [{"tag": tag}]
#
#         }])
#     print(new_note)
#     new_note_id = new_note['successful']['0']['data']['key']
#     if new_note_id:
#         note = self.zot.item(new_note_id)
#         note_content = note['data']['note']
#
#         # Update the note content with the new note ID
#         updated_content = note_content.replace(f'<em>@{item_id}</em><br>',
#                                                f'<em>@{item_id}</em><br><em>Note ID: {new_note_id}</em><br>')
#
#         updated_note = {
#             'key': note['data']['key'],
#             'version': note['data']['version'],
#             'itemType': note['data']['itemType'],
#             'note': updated_content,
#             'tags': [{"tag": "summary_note"}]
#         }
#         time.sleep(15)
#         try:
#             # Attempt to update the note in Zotero
#             response = self.zot.update_item(updated_note)
#             if response:
#                 print("Note updated successfully.")
#                 return new_note_id
#             else:
#                 print("Failed to update the note.")
#         except Exception as e:
#             print(f"An error occurred during the update: {e}")

def update_note_zotero(note,tags,content,zot):
    global response
    updated_note = {
        'key': note['data']['key'],
        'version': note['data']['version'],
        'itemType': note['data']['itemType'],
        'note': content,
        'tags': tags
    }

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
                 library_id="",
                 library_type='user',
                 api_key="<API KEY>",
                 chat_args = { "chat_id": "pdf"},
                 os = "mac",
                 sleep =10
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
        self.pdf_path_cache = {} # Initialize as an empty dictionary
        import platform
        current_os = platform.system().lower()

        self.persistent_cache_dir = Path(
            r"C:\Users\luano\PycharmProjects\all tests\Cache\Zotero")  # Example path for file cache
        self.persistent_cache_dir.mkdir(parents=True, exist_ok=True)  # Ensure it exists
        if "windows" in current_os:
            # Use raw string or double backslashes
            default_storage = r"C:\Users\luano\Zotero\storage"
        self.zotero_storage_base = Path(default_storage).expanduser().resolve()  # Use expanduser for '~'
        self.library_id = library_id
        self.library_type = library_type
        self.api_key = api_key
        self.zot = self.connect()
        self.sleep = sleep

        self.chat_args = chat_args
        self.zotero_directory = "/Users/pantera/Zotero/storage/" if os=="mac" else "C:\\Users\\luano\\Zotero\\storage\\"
        self.schema = ""

    def connect(self):
        """
           Establishes and returns a connection to the Zotero API using the Zotero library credentials stored in the instance.

           Returns:
           - An instance of the Zotero object configured with the specified library ID, library type, and API key. This object can be used to perform various operations with the Zotero API.
           """

        return zotero.Zotero(self.library_id, self.library_type, self.api_key)


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


    def update_note(self, note,content,tag=None):
        if tag is None:tag=note['data'].get('tags', [])
        updated_note = {
            'key': note['data']['key'],
            'version': note['data']['version'],
            'itemType': note['data']['itemType'],
            'note': content,
            'tags': tag
        }
        response=None
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


    # def _check_global_name_existence(self, name_lower):
    #     """
    #     Checks the *entire* library for collections matching the name (case-insensitive),
    #     handling API pagination.
    #     (Assumes this is a method of a class with self.zot)
    #
    #     Args:
    #         name_lower (str): The lowercase name to search for.
    #
    #     Returns:
    #         tuple: (list_of_all_matches, list_of_non_deleted_matches, list_of_deleted_matches)
    #                Returns (None, None, None) if the API call fails.
    #     """
    #     all_matches = []
    #     non_deleted_matches = []
    #     deleted_matches = []
    #     logging.debug(f"Starting global check for collection name containing: '{name_lower}'")
    #     try:
    #         # *** Ensure this uses zot.everything() ***
    #         all_colls_response = self.zot.everything(self.zot.collections())
    #         logging.debug(f"Fetched {len(all_colls_response)} total collections from library for global check.")
    #
    #         if not isinstance(all_colls_response, list):
    #             logging.error(
    #                 f"[_check_global_name_existence] Failed to fetch collections correctly, expected list, received type: {type(all_colls_response)}")
    #             return None, None, None
    #
    #         for coll in all_colls_response:
    #             data = coll.get('data', {})
    #             coll_name = data.get('name')
    #
    #             if coll_name and coll_name.lower() == name_lower:
    #                 all_matches.append(coll)
    #                 is_deleted = coll.get('deleted', False) or data.get('deleted', False)
    #                 if is_deleted:
    #                     deleted_matches.append(coll)
    #                 else:
    #                     non_deleted_matches.append(coll)
    #
    #         logging.debug(f"Global check results for exact name '{name_lower}': "
    #                       f"Total Matches={len(all_matches)}, "
    #                       f"Non-Deleted={len(non_deleted_matches)}, "
    #                       f"Deleted={len(deleted_matches)}")
    #         return all_matches, non_deleted_matches, deleted_matches
    #
    #     except Exception as e:
    #         logging.error(
    #             f"[_check_global_name_existence] Error during 'everything' fetch or processing for '{name_lower}': {e}",
    #             exc_info=True)
    #         return None, None, None

    # ----- UNIFIED FIND/CREATE LOGIC WRAPPER (with indexed interactive deletion) -----
    def _find_or_create_collection_logic(self, name, parent_key=None):
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

                # Break the input loop if we reached here via a valid action path
                # (Though return statements above already exit the function)
                # break # Technically redundant due to returns

        # Case 3: Only deleted collections exist globally
        elif num_non_deleted_globally == 0 and num_deleted_globally > 0:
            keys_found = [c.get('key', 'N/A') for c in deleted_matches]
            logging.warning(
                f"Cannot proceed with collection '{name}'. Found only deleted instances globally (Keys: {keys_found}). Will not create automatically.")
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
        if not subcoll_name:
            logging.error("(find_or_create_subcollection) Subcollection name cannot be empty after trimming.")
            return None
        if not parent_key:
            logging.error("(find_or_create_subcollection) Parent key cannot be empty.")
            return None
        return self._find_or_create_collection_logic(name=subcoll_name, parent_key=parent_key)

    #
    # def attach_file_to_items(self,collection_name,cache=True):
    #
    #     collection_key = self.find_or_create_top_collection(collection_name)
    #     fail_key= self.find_or_create_top_collection(collection_name+"_fail")
    #     folder=r"C:\Users\luano\Downloads\cyber deterrence\heinonline"
    #
    #     items= self.get_all_items(collection_name,cache=cache)
    #     driver= initiate_browser()
    #     for item in items:
    #         data=item["data"]
    #         url= data["url"]
    #         key =item["key"]
    #         full_pdf_path = os.path.abspath(os.path.join(folder, key))+".pdf"
    #
    #         success= click_and_save_via_dialog(driver=driver,page_url=url,output_folder=r"C:\Users\luano\Downloads\cyber deterrence\heinonline",pdf_filename=key)
    #         if success:
    #             self.attach_file_to_item(parent_item_id=key,file_path=full_pdf_path)
    #             self.remove_items_from_collection(collection_key=collection_key,items_keys=key)
    #         else:
    #             self.attach_file_to_item(parent_item_id=key, file_path=full_pdf_path)
    #             self.add_items_to_collection(collection_key=fail_key, items_keys=key)
    #
    #     driver.quit()
    def attach_file_to_item(self, parent_item_id, file_path,tag_name="automatic_attach"):
        """
        Attaches a file to an existing Zotero item and prints the attachment's ID.

        Args:
            parent_item_id (str): The ID of the item to attach the file to.
            file_path (str): The path to the file to attach.

        Returns:
            None
        """
        # attch= self._get_md_attachment(item_id=parent_item_id)
        attch=False
        if not attch:
            file_name = os.path.basename(file_path)
            file_title, file_ext = os.path.splitext(file_name)

            # Only proceed if the file is a Word or PDF document
            try:
                # Attach the file to the specified item and capture the response
                response = self.zot.attachment_simple([file_path], parentid=parent_item_id)

                # Check if the attachment was successful or unchanged but still present
                attachment_key = None
                if 'successful' in response and len(response['successful']) > 0:
                    attachment_key = next(iter(response['successful'].values()))['key']
                    print(f"File {file_name} attached successfully. Attachment ID: {attachment_key}")
                elif 'unchanged' in response and len(response['unchanged']) > 0:
                    attachment_key = response['unchanged'][0]['key']
                    print(f"File {file_name} was already attached. Attachment ID: {attachment_key}")

                if attachment_key:
                    # Fetch the existing attachment item
                    attachment_item = self.zot.item(attachment_key)
                    # Append or update the tag
                    existing_tags = {tag['tag'] for tag in attachment_item['data']['tags']}
                    if tag_name not in existing_tags:
                        attachment_item['data']['tags'].append({'tag': tag_name})
                        self.zot.update_item(attachment_item)
                        print(f"Tag '{tag_name}' added to attachment ID: {attachment_key}")
                    else:
                        print(f"Tag '{tag_name}' already exists for this attachment.")

            except zotero_errors.HTTPError as e:
                print(f"Error uploading attachment or adding tag for file '{file_name}': {e}")
            except Exception as e:
                print(f"Unexpected error for file '{file_name}': {e}")
        else:
            print(f"Skipped non-document file: {parent_item_id}")



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


    def update_items_conditioned(self, collection_name: str | None = None, keyword: str | None = None,
                                 condition: str = "check_keyword", item: dict | None = None):
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
                processed_coll_suffix = "_keyword_not_found" if condition == "check_keyword" else "_abstract_added"
                processed_coll_name = f"{base_collection_name}{processed_coll_suffix}"

                # Find/Create the target collection (needs a parent)
                # Use source_coll_key as parent if available (collection mode)
                # Otherwise, maybe use the base_collection_name's key if it exists?
                parent_key_for_processed = source_coll_key  # Default to source key if it exists
                if not parent_key_for_processed:
                    # Attempt to find the top collection key even if not processing the whole collection, just for parenting the target
                    try:
                        temp_parent_key = self.find_or_create_top_collection(base_collection_name)  # Or just find?
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

        # --- Nested Processing Function ---
        def _process_item(item_to_process):
            """
            Processes a single Zotero item (finds attachment, performs action).
            Handles item_to_process being either a parent or an attachment.
            Uses variables from outer scope: condition, keyword, source_coll_key, processed_coll_key.
            """
            nonlocal processed_parent_keys_for_abstract  # Allow modification

            item_key = item_to_process.get('key')
            data = item_to_process.get('data', {})
            item_type = data.get('itemType')

            parent_key = None
            attachment_item = None

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
            if not attachment_item:
                logging.error(
                    f"Internal error: No attachment_item identified for parent {parent_key}. Cannot get path.")
                return False

            pdf_path = None
            att_filename = attachment_item.get('data', {}).get('filename', 'N/A')
            try:
                pdf_path = self.get_pdf_path_for_item(attachment_item=attachment_item)
                if not pdf_path or not os.path.exists(pdf_path):
                    logging.warning(
                        f"PDF path not found or invalid for attachment '{att_filename}' (Parent: {parent_key}). Path: '{pdf_path}'. Skipping.")
                    return False
            except Exception as e_path:
                logging.error(f"Error getting PDF path for '{att_filename}' (Parent: {parent_key}): {e_path}")
                return False

            # --- Step 4: Perform Action based on Condition ---
            action_success = False
            if condition == "check_keyword":
                logging.debug(f"Checking keyword '{keyword}' in '{att_filename}' (Parent: {parent_key})")
                count = check_keyword_count_pdf(pdf_path=pdf_path, keyword=keyword)

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
                            self.remove_items_from_collection(collection_key=source_coll_key, items_keys=[parent_key])
                            self.add_items_to_collection(collection_key=processed_coll_key, items_keys=[parent_key])
                            logging.debug(f"Moved parent {parent_key} from {source_coll_key} to {processed_coll_key}.")
                        except Exception as e_move:
                            logging.error(f"Failed to move parent item {parent_key} from {source_coll_key}: {e_move}")
                            # Note: action_success remains True because the *check* was successful
                    elif not item:  # Only warn about missing keys if in collection mode where moving is expected
                        logging.warning(
                            f"Cannot move parent item {parent_key}, source ({source_coll_key}) or target ({processed_coll_key}) collection key missing/invalid.")
                else:
                    logging.info(
                        f"Keyword '{keyword}' found {count} times in '{os.path.basename(pdf_path)}'. Parent item {parent_key} remains.")
                    action_success = True  # Keyword check successful (found > 0)

            elif condition == "add_abstract":
                logging.info(f"Generating abstract for parent {parent_key} using '{att_filename}'")
                try:
                    # 1. Extract Text
                    text = extract_intro_conclusion_pdf_text(pdf_path=pdf_path)
                    if not text:
                        logging.warning(
                            f"No text extracted for abstract from '{att_filename}' (Parent: {parent_key}). Skipping abstract generation.")
                        return False  # Cannot generate abstract without text

                    prompt = f"""*Prompt*:
                                          1. Read through the entire academic paper thoroughly.
                                          2. In your reading, identify the following key components:
                                             - Stud*Prompt*:

                                          1. *Thoroughly Review the Provided Paper*: Ignore all special formatting (such as  callout boxes, footnotes, or references) and focus solely on the paper’s main content. Do not add or invent details not present in the document.

                                          2. *Extract Key Components*: Identify only from the paper’s content:
                                             - *Study Objectives*: The main aims or goals of the research.
                                             - *Research Problem*: The central issue or challenge addressed.
                                             - *Research Questions*: The primary inquiries guiding the study.
                                             - *Methodology*: How the research was carried out, including data sources or analytical approaches.
                                             - *Key Findings*: The most significant results or insights derived from the study.
                                             - *Limitations*: Any constraints, weaknesses, or factors that might affect the study’s conclusions.
                                             - *Future Research Directions*: Proposed avenues or suggestions for continuing investigation.

                                          3. *Create a Single-Paragraph Abstract (250–300 Words)*: Summarize these elements into a coherent and self-contained paragraph without:
                                             - Adding information not explicitly stated in the paper.
                                             - Using direct quotations.
                                             - Including references or in-text citations.
                                             - Exceeding 300 words or dropping below 250 words.

                                          4. *Maintain Clarity and Academic Tone*: Present the abstract in plain, concise language that reflects standard academic writing. The final output must be:
                                             - Strictly derived from the paper’s content.
                                             - Free of any special formatting (headings, bullet points, bold, italics).
                                             maintain the author writing style and lexical
                                          *Desired Output*:
                                          A self-contained, single-paragraph abstract (300–350 words) accurately summarizing the paper’s content, based solely on the information given in the text, without added details or external knowledge. note:do not return any additional text(title,comments, new line...), just the paragraph text strictly following the instructions above
                                             text=[[{text}]]"""
                    ai_parameter = "deepseek"
                    models_dict = {
                        "openai": "gpt-4o",
                        "gemini": "gemini-2.5-pro-exp-03-25",  # default for gemini
                        "deepseek": "deepseek-chat"  # default for deepseek; can be changed to 'deepseek-reasoner'
                    }

                    generated_abstract = call_models(ai=ai_parameter, models=models_dict, prompt=prompt)

                    # Basic validation of AI response
                    if not generated_abstract or not isinstance(generated_abstract, str):
                        logging.error(
                            f"AI did not return a valid abstract string for parent {parent_key}. Response: {generated_abstract}")
                        return False

                    logging.debug(f"Generated abstract for parent {parent_key}.")

                    # 4. Update Zotero Item
                    parent_item_for_update = self.zot.item(parent_key)  # Fetch parent item data
                    self.update_zotero_item_feature(item=parent_item_for_update, updates="abstractNote",
                                                    new_content=generated_abstract.strip(), append=False)
                    self.append_tag_to_item(item_id=parent_key, new_tag="Abstract_auto")
                    logging.info(f"Updated abstract and added tag for parent {parent_key}.")
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
                    elif not item:  # Only warn if in collection mode
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
            item_data = item.get('../../data', {})
            item_type = item_data.get('itemType')
            if item_type == 'attachment':
                logging.error(
                    "Single item mode requires the PARENT item, not the attachment. Please provide the parent item dictionary.")
                # Or alternatively, try to find the parent from the attachment?
                # parent_key_from_att = item_data.get('parentItem')
                # if parent_key_from_att:
                #     logging.warning(f"Provided item is an attachment. Processing its parent {parent_key_from_att} instead.")
                #     try:
                #        parent_item_dict = self.zot.item(parent_key_from_att)
                #        _process_item(parent_item_dict)
                #     except Exception as e_fetch:
                #        logging.error(f"Could not fetch parent item {parent_key_from_att}: {e_fetch}")
                # else:
                #     logging.error("Provided attachment item has no parent key.")
                return  # Stop execution if wrong item type provided

            # Process the single parent item provided
            logging.info(f"Processing single parent item: {item.get('key')} ('{item_data.get('title', 'N/A')}')")
            return _process_item(item)

        elif collection_name and source_coll_key:
            # --- Collection Mode ---
            logging.info(f"Starting processing for collection '{collection_name}' (Key: {source_coll_key})")
            start = 0
            limit = 50  # Adjust batch size
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

                for loop_item in items_batch:
                    total_items_processed_in_loop += 1
                    batch_processed_count += 1
                    # The loop_item could be a parent or an attachment. _process_item handles both.
                    success = _process_item(loop_item)
                    if success:
                        batch_succeeded_count += 1

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

        else:
            # Should be caught earlier, but safeguard
            logging.error("Processing stopped due to configuration error (missing collection_name or item).")



    def _create_df_update_from_raw_item(self, raw_item: dict) -> dict:
        """
        Helper to create a dictionary suitable for updating the local DataFrame
        after a successful Zotero update.
        """

        update_dict = {}
        data = raw_item.get('../../data', {})

        # Direct fields
        update_dict['abstract'] = data.get('abstractNote', '')

        # Parse the 'extra' field to update all related columns in the DataFrame
        extra_string = data.get('extra', '')
        parsed_extra = _parse_extra_field(extra_string)
        update_dict.update(parsed_extra)

        # You could also update tags or other fields if they are stored in the DataFrame
        # For now, this covers the most critical fields from the screener.

        return update_dict
    def download_pdfs_from_collections(self, output_folder: str, Z_collections: list) -> None:
        """
        Iterate through each Zotero collection (by key or name) in Z_collections,
        download all PDF attachments, and store them in a subfolder (named after
        the collection) within the specified output_folder.
        """

        def sanitize(name: str) -> str:
            return re.sub(r'[\\/*?:"<>|]', "_", name)

        os.makedirs(output_folder, exist_ok=True)

        # Build lookup of all existing collections (key ↔ name)
        all_coll = []
        start = 0
        while True:
            batch = self.zot.collections(limit=100, start=start)
            if not batch:
                break
            all_coll.extend(batch)
            start += len(batch)

        key_to_name = {c['data']['key']: c['data']['name'] for c in all_coll}
        name_to_key = {c['data']['name'].lower(): c['data']['key'] for c in all_coll}

        for identifier in Z_collections:
            coll_key = identifier if identifier in key_to_name else name_to_key.get(identifier.lower())
            if not coll_key:
                print(f"[ERROR] Collection not found: {identifier}")
                continue

            coll_name = key_to_name.get(coll_key, identifier)
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

                    fname = data["parentItem"] +"_"+data.get('filename', "")
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

    def update_zotero_item_feature(self,
                                   item: dict,
                                   updates: Union[Dict[str, Any], str],
                                   new_content: Optional[Any] = None,
                                   append: bool = False) -> bool:
        """
        Updates one or more features (fields) of a Zotero item in a single API call.

        Can be called in two ways:
        1. Single Feature Update:
           update_zotero_item_feature(item, feature_name, new_value, append=True/False)
        2. Multiple Feature Update:
           update_zotero_item_feature(item, {'feature1': value1, 'feature2': value2, ...})
           (In multi-update mode, 'new_content' and 'append' arguments are ignored).

        Args:
            item: The Zotero item dictionary (as retrieved from the API).
                  This dictionary will be modified in place before updating.
                  Must contain 'key', 'version', and 'data' keys.
            updates: EITHER a string specifying the single feature name to update,
                     OR a dictionary where keys are feature names (str) and
                     values are the new content for those features.
            new_content: The new value for the feature. Required if 'updates' is a string.
                         Ignored if 'updates' is a dictionary.
            append: If True and updating a single feature (string) whose existing
                    and new values are strings, appends 'new_content' to the
                    existing content with a newline separator. Defaults to False.
                    Ignored if 'updates' is a dictionary.

        Returns:
            True if the Zotero API update call was successful, False otherwise.

        Raises:
            KeyError: If the input 'item' dictionary is missing 'key', 'version', or 'data'.
            ValueError: If called in single-feature mode ('updates' is str) but 'new_content' is None.
            TypeError: If 'updates' is not a string or a dictionary.
            zotero.ZoteroError (or subclasses): If the PyZotero API call fails.
            # Single update (overwrite)
            # zt.update_zotero_item_feature(current_item, 'title', 'A New Title For This Item')
            # Multiple updates (overwrite)
            # updates_dict = {
            #     'tags': [{'tag': 'Screened-Accepted'}, {'tag': 'Relevant'}], # Replace existing tags
            #     'extra': 'Screening Result: Accepted\nReviewer: LMN', # Replace existing extra
            #     'shortTitle': 'Screened Item' # Add or replace short title
            # }
            # zt.update_zotero_item_feature(current_item, updates_dict)
        """
        # --- Input Validation ---
        if not all(k in item for k in ['key', 'version', 'data']):
            missing_keys = [k for k in ['key', 'version', 'data'] if k not in item]
            err_msg = f"Item dictionary (key: {item.get('key', 'N/A')}) is missing required keys: {missing_keys}. Cannot update."
            logging.error(err_msg)
            raise KeyError(err_msg)

        item_key = item['key']
        features_to_update = []
        modification_applied = False  # Flag to track if any changes were actually made

        # ---- local helpers (normalise + merge zotero tags) ----
        def _normalise_tag_list(raw):
            out = []
            if isinstance(raw, dict) and "tag" in raw:
                raw = [raw]
            for t in (raw or []):
                if isinstance(t, str):
                    v = t.strip()
                    if v:
                        out.append({"tag": v})
                elif isinstance(t, dict):
                    v = str(t.get("tag", "")).strip()
                    if v:
                        d = {"tag": v}
                        for k, val in t.items():
                            if k != "tag":
                                d[k] = val
                        out.append(d)
            # de-dup by casefolded tag, keep first occurrence (preserve any existing metadata)
            seen = set()
            dedup = []
            for d in out:
                k = d["tag"].casefold()
                if k not in seen:
                    seen.add(k)
                    dedup.append(d)
            return dedup

        def _merge_tags(old_list, new_list):
            old = _normalise_tag_list(old_list)
            new = _normalise_tag_list(new_list)
            seen = {d["tag"].casefold() for d in old}
            merged = list(old)
            for d in new:
                k = d["tag"].casefold()
                if k not in seen:
                    seen.add(k)
                    merged.append(d)
            return merged

        # --- Apply Updates to Local Item Dictionary ---
        if isinstance(updates, str):
            # Single feature update mode
            feature = updates
            if new_content is None:
                err_msg = f"ValueError: 'new_content' must be provided when 'updates' is a string (feature='{feature}')."
                logging.error(f"{err_msg} for item key: {item_key}")
                raise ValueError(err_msg)

            features_to_update.append(feature)
            if append:
                if feature == "tags":
                    old_tags = item["data"].get("tags", [])
                    item["data"]["tags"] = _merge_tags(old_tags, new_content)
                    modification_applied = True
                else:
                    old_content = item["data"].get(feature)
                    if isinstance(old_content, str) and isinstance(new_content, (str, int, float)):
                        item["data"][feature] = (old_content or "") + "\n" + str(new_content)
                        modification_applied = True
                    else:
                        item["data"][feature] = new_content
                        modification_applied = True
            else:
                # Overwrite mode
                item['data'][feature] = new_content
                modification_applied = True


        elif isinstance(updates, dict):

            # Multiple feature update mode

            if not updates:
                logging.warning(f"Received empty 'updates' dictionary for item key: {item_key}. No changes applied.")

                return True

            for feature, content in updates.items():

                if not isinstance(feature, str):
                    logging.warning(f"Skipping update for non-string feature key: {feature} on item {item_key}")

                    continue

                features_to_update.append(feature)

                if feature == "tags" and append:

                    existing = item["data"].get("tags", [])

                    item["data"]["tags"] = _merge_tags(existing, content)

                else:

                    item["data"][feature] = content

                modification_applied = True

        else:
            # Invalid input type for 'updates'
            err_msg = f"TypeError: 'updates' argument must be a string (single feature name) or a dictionary (multiple features), not {type(updates).__name__}."
            logging.error(f"{err_msg} for item key: {item_key}")
            raise TypeError(err_msg)

        # --- Perform Zotero API Update ---
        if not modification_applied:
            logging.info(f"No modifications were applied locally for item key: {item_key}. Skipping Zotero API call.")
            return True  # No change needed, consider it done.

        feature_str = ", ".join(features_to_update)
        logging.info(f"Attempting to update item key: {item_key}, features: '{feature_str}'")

        try:
            # Use the updated 'item' dictionary directly
            self.zot.update_item(item)
            # Note: successful update increments item['version']
            logging.info(
                f"Successfully updated features '{feature_str}' for item key: {item_key}. New version: {item['version']}")
            return True
        except Exception as e:
            # Catching a broad exception, but pyzotero raises specific ones
            logging.error(f"Failed to update features '{feature_str}' for item key: {item_key}. Error: {e}",
                          exc_info=True)
            # Optionally re-raise if the caller needs to handle it
            # raise e
            return False

    # --- Add this NEW standalone helper function in data_processing.py ---

    def update_zotero_item_from_screener(self, item_key: str, screener_updates: dict) -> tuple[bool, dict | None]:
        """
        Fetches the latest version of a Zotero item, intelligently updates it
        with data from the screener widget, and pushes the changes back to Zotero.

        This is the main function for handling updates originating from the DataScreenerWidget.

        Args:
            item_key (str): The key of the Zotero item to update.
            screener_updates (dict): A dictionary of changes from the screener UI.
                                     This can contain direct Zotero fields (like 'abstractNote', 'tags')
                                     and special keys for the 'extra' field (like 'institution', 'user_notes').

        Returns:
            tuple[bool, dict | None]: A tuple containing:
                - bool: True if the update was successful, False otherwise.
                - dict | None: The fully updated Zotero item dictionary if successful, otherwise None.
        """
        if not item_key:
            logging.error("update_zotero_item_from_screener called with no item_key.")
            return False, None

        logging.info(f"Starting update process for Zotero item: {item_key}")

        try:
            # 1. Fetch the LATEST version of the item from Zotero to avoid conflicts
            zotero_item = self.zot.item(item_key)
            if not zotero_item or 'data' not in zotero_item:
                logging.error(f"Could not fetch item {item_key} from Zotero.")
                return False, None

            logging.debug(f"Fetched item {item_key}, version {zotero_item.get('version')}")

            # 2. Prepare the final payload for the Zotero API update
            final_zotero_payload = {}
            extra_field_changes = {}

            # Separate direct updates from 'extra' field updates
            for key, value in screener_updates.items():
                if key in ['abstractNote', 'tags']:  # Direct Zotero fields
                    final_zotero_payload[key] = value
                else:  # Fields destined for the 'extra' string
                    extra_field_changes[key] = value

            # 3. Intelligently reconstruct the 'extra' field
            if extra_field_changes:
                original_extra = zotero_item['data'].get('extra', '')
                # Use the existing helper function
                new_extra = reconstruct_extra_field(original_extra, extra_field_changes)

                # Only add 'extra' to the payload if it has actually changed
                if new_extra != original_extra:
                    final_zotero_payload['extra'] = new_extra
                    logging.info(f"Reconstructed 'extra' field for item {item_key}.")

            # 4. Check if there are any changes to push
            if not final_zotero_payload:
                logging.info(f"No effective changes to push for Zotero item {item_key}. Update skipped.")
                return True, zotero_item  # Considered a success, return the fetched item

            # 5. Push the update using the existing generic update function
            # The update_zotero_item_feature method modifies 'zotero_item' in place
            success = self.update_zotero_item_feature(item=zotero_item, updates=final_zotero_payload)

            if success:
                # The 'zotero_item' dict now contains the new version number
                return True, zotero_item
            else:
                return False, None

        except Exception as e:
            logging.error(f"An unexpected error occurred in update_zotero_item_from_screener for key {item_key}: {e}",
                          exc_info=True)
            return False, None
    def classify_by_title(self, collection_name,delete=False,store=False):

        items = [{"title": item["data"]["title"], "key": item["key"], "abstract": item["data"].get("abstractNote", "")} for
                 item in self.get_all_items( collection_name=collection_name)]


        data_gpt = get_multiline_input()
        if data_gpt:
            try:
                data_gpt = ast.literal_eval(data_gpt)

            except Exception as e:
                print("Error parsing dataset:", e)
        else:
            print("No data provided.")

        # apicall
        parent_key = self.find_or_create_top_collection("Auto__" + collection_name)
        if delete:
            d_col=self.zot.collection(parent_key)
            self.zot.delete_collection(d_col)
            parent_key = self.find_or_create_top_collection("Auto__" + collection_name)

        for collections in data_gpt:

            for name, items in collections.items():
                child_key = self.find_or_create_subcollection(subcoll_name=name, parent_key=parent_key)

                self.add_items_to_collection( collection_key=child_key, items_keys=items)



    def classify_items_by_feature(self, collection_name=None, all=None,feature="url"):
        print("initiating classification")
        groups = group_by_publication_title(self.get_all_items(all=all,collection_name=collection_name if not all else None),feature=feature)


        parent_key = self.find_or_create_top_collection("Auto_url_" + collection_name)
        for subcoll_name, items in groups.items():
            print("processing collection:", subcoll_name)
            # Check if child collection exists under parent
            child_key = self.find_or_create_subcollection(subcoll_name=subcoll_name, parent_key=parent_key)

            print(f"Classifying item '{subcoll_name}'")
            item_keys = [i["key"] for i in items]

            self.add_items_to_collection(collection_key=child_key, items_keys=item_keys)

    def get_all_items(self, collection_name=None, cache=True, all=False, cache_path='zotero_items_cache.json'):
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
        if cache and os.path.exists(cache_path):
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    cache_data = json.load(f)
            except Exception as e:
                logging.warning(f"Failed to load or parse cache file {cache_path}: {e}. Ignoring cache.");
                cache_data = {}

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
                    # (... rest of empty collection deletion prompt - unchanged ...)
                    print("-" * 30)
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
                                    logging.error(f"Could not get current data for {target_coll_key}"); print(
                                        "Error: cannot delete.")
                            except Exception as e:
                                logging.error(f"Failed delete {target_coll_key}: {e}", exc_info=True); print(
                                    f"Error deleting: {e}")
                            break
                        elif confirm_delete == 'no':
                            logging.info(f"User kept empty collection: {target_coll_key}"); print(
                                "Keeping empty collection."); break
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
        if cache:
            cache_data[cache_key] = filtered_items
            try:
                with open(cache_path, 'w', encoding='utf-8') as f:
                    json.dump(cache_data, f, ensure_ascii=False, indent=2)
                logging.info(f"Cached {len(filtered_items)} Zotero items under key '{cache_key}' to {cache_path}")
            except Exception as e:
                logging.error(f"Failed to write cache file to {cache_path}: {e}")

        return filtered_items

    def add_items_to_collection(self, collection_key, items_keys):
        """
        Robustly add items (by key or iterable of keys) to a Zotero collection.

        Strategy:
          1) Resolve each key to a *top-level* item (promote child attachments/notes to parent).
          2) Mutate the item's data.collections locally (idempotent), then call update_item(item).
          3) Re-fetch once to verify the collection was added.
        Returns: dict with counters for diagnostics.
        """
        import time
        import warnings

        # normalise list of keys, preserve order, drop empties
        if isinstance(items_keys, (list, tuple, set)):
            keys = [str(k).strip() for k in items_keys if k]
        else:
            keys = [str(items_keys).strip()] if items_keys else []
        keys = [k for k in dict.fromkeys(keys) if k]
        if not keys:
            return {"requested": 0, "resolved": 0, "updated": 0, "skipped_already_member": 0, "failed": 0}

        # sanity: collection exists?
        try:
            _ = self.zot.collection(collection_key)
        except Exception as e:
            if hasattr(self, "logger"):
                self.logger.error(f"[zotero] collection not found/inaccessible: {collection_key} ({e})")
            return {"requested": len(keys), "resolved": 0, "updated": 0, "skipped_already_member": 0,
                    "failed": len(keys)}

        stats = {"requested": len(keys), "resolved": 0, "updated": 0, "skipped_already_member": 0, "failed": 0}

        for key in keys:
            try:
                item = self.zot.item(key)
            except Exception as e:
                if hasattr(self, "logger"):
                    self.logger.warning(f"[zotero] missing/forbidden item key={key}: {e}")
                stats["failed"] += 1
                continue

            # Promote child (attachment/note) to parent top-level item
            data = item.get("data", {}) if isinstance(item, dict) else {}
            parent_key = data.get("parentItem")
            if parent_key:
                try:
                    item = self.zot.item(parent_key)
                    data = item.get("data", {})
                except Exception as e:
                    if hasattr(self, "logger"):
                        self.logger.warning(f"[zotero] parent fetch failed parentKey={parent_key}: {e}")
                    stats["failed"] += 1
                    continue

            stats["resolved"] += 1

            # Idempotent add to collections
            collections = list(data.get("collections", []) or [])
            if collection_key in collections:
                stats["skipped_already_member"] += 1
                continue
            collections.append(collection_key)
            data["collections"] = collections
            item["data"] = data

            # Update the item on the server
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", DeprecationWarning)
                    self.zot.update_item(item)
            except Exception as e:
                if hasattr(self, "logger"):
                    self.logger.error(f"[zotero] update_item failed key={data.get('key')}: {e}")
                stats["failed"] += 1
                continue

            # Verify (cheap re-fetch)
            try:
                verify = self.zot.item(data.get("key"))
                vcols = (verify.get("data", {}) or {}).get("collections", []) or []
                if collection_key in vcols:
                    stats["updated"] += 1
                else:
                    # fall back: try addto_collection once, in case of edge-case version header issues
                    try:
                        self.zot.addto_collection(collection=collection_key, item=verify)
                        stats["updated"] += 1
                    except Exception as ee:
                        if hasattr(self, "logger"):
                            self.logger.error(f"[zotero] verification add failed key={data.get('key')}: {ee}")
                        stats["failed"] += 1
                        continue
            except Exception:
                # If verification fails but update didn't raise, count as updated (conservative)
                stats["updated"] += 1

            # gentle pacing
            time.sleep(0.15)

        if hasattr(self, "logger"):
            self.logger.info(f"[zotero] add_items_to_collection stats: {stats} (collection={collection_key})")
        return stats

    def remove_items_from_collection(self, collection_key, items_keys):
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
                success = self.zot.deletefrom_collection(collection=collection_key,payload=item_data)
                results[item_key] = success  # Store the result

                if success:
                    print(f"Successfully removed item {item_key} from collection {collection_key}.")
                else:
                    # API returning False could mean item wasn't in the collection, or another non-exception failure.
                    print(f"Failed to remove item {item_key} from collection {collection_key} (API returned False).")

                # Step 3: Add delay if processing multiple items to avoid rate limiting
                # We need this because each item requires at least two API calls (fetch + delete)
                if len(keys_to_process) > 1:
                    print("Waiting for 3 seconds before next operation...")
                    time.sleep(3)

            except Exception as e:
                # Catch potential errors during item fetching or deletion API calls
                print(f"An error occurred while processing item {item_key} for collection {collection_key}: {e}")
                results[item_key] = False  # Record failure
                # Optional: Add sleep here too in case the error was rate-limiting related
                if len(keys_to_process) > 1:
                    print("Waiting for 3 seconds after error...")
                    time.sleep(3)

        print(f"Finished processing removal requests. Results: {results}")

    def get_collection_items_with_children(
            self,
            collection_name: str
    ) -> Optional[Dict[str, Dict[str, Any]]]:

        """
        Fetches all top-level items in a Zotero collection and their direct children,
        categorized by child item type.

        Args:
            self : zot_instance An authenticated instance of the pyzotero.Zotero client.
            collection_name: The unique key (ID) of the Zotero collection.

        Returns:
            A dictionary where keys are the item keys of the top-level items
            in the collection. Each value is a dictionary containing:
                - 'item_data': The full data dictionary of the top-level item.
                - 'children': A dictionary where keys are child item types (e.g., 'note',
                              'attachment') and values are lists of the corresponding
                              child item keys.
            Returns None if the collection is not found or an error occurs during
            API interaction. Returns an empty dictionary if the collection exists but is empty.

        Example Output Structure:
            {
               'ITEM_KEY_1': {
                   'item_data': { ... data for item 1 ... },
                   'children': {
                       'note': ['NOTE_KEY_A', 'NOTE_KEY_B'],
                       'attachment': ['ATTACHMENT_KEY_C']
                   }
               },
               'ITEM_KEY_2': {
                   'item_data': { ... data for item 2 ... },
                   'children': {
                       'attachment': ['ATTACHMENT_KEY_D', 'ATTACHMENT_KEY_E']
                   }
               },
               # ... more items
            }
        """
        collection_key= self.find_or_create_top_collection(collection_name)
        collection_data: Dict[str, Dict[str, Any]] = {}

        # 1. Get all top-level items directly in the specified collection.
        #    pyzotero handles pagination automatically by default to retrieve all items.
        #    If you anticipate *extremely* large collections and need fine-grained control,
        #    you might explore manual pagination using 'limit' and 'start'.
        print(f"Fetching items for collection: {collection_key}")
        undesired_types = {'note', 'attachment', 'linkAttachment', 'fileAttachment', 'annotation'}

        theitems= self.zot.everything(self.zot.collection_items(collection_key))
        top_level_items = [
            item for item in theitems
            if item['data'].get('itemType') not in undesired_types
        ]
        if not top_level_items:
            print(f"Collection '{collection_key}' is empty or contains no accessible items.")
            return {}  # Return an empty dict for an empty collection

        print(f"Found {len(top_level_items)} top-level items. Fetching children...")

        # 2. Iterate through each top-level item
        for i, item in enumerate(top_level_items):
            item_key: str = item['key']
            item_data: Dict[str, Any] = item.get('data', {})  # Safely get item data


            print(f"  Processing item {i + 1}/{len(top_level_items)} (Key: {item_key})...")

            structured_children: Dict[str, List[str]] = {}

            # 3. Get direct children of the current item
            #    Again, pyzotero handles pagination automatically.

            child_items: List[Dict[str, Any]] = self.zot.children(item_key)

            # 4. Categorize children by item type
            for child in child_items:
                child_key: str = child['key']
                child_data: Dict[str, Any] = child.get('data', {})
                # Use 'itemType' to categorize (e.g., 'note', 'attachment')
                child_type: str = child_data.get('itemType', 'unknown_type')
                if child_type == 'note':
                    if child_key:
                        print("child",child_key)

                        print(f"deleting {item_data['title']}")
                        note= self.zot.item(child_key)

                        self.zot.delete_item(note)



                if child_type not in structured_children:
                    structured_children[child_type] = []
                structured_children[child_type].append(child_key)

            # 5. Store the item data and its structured children in the main dictionary
            collection_data[item_key] = {
                'item_data': item_data,
                'children': structured_children
            }

        print(f"Finished processing collection {collection_key}.")
        return collection_data
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

    #
    # def keyword_analysis_multi(
    #         self,
    #         collection_name: str,
    #         keywords: list[str],
    #         *,
    #         read: bool = False,
    #         store_only: bool = False,
    #         cache: bool = True,
    #         batch_size: int = 10,
    # ) -> str:
    #     """
    #     Multi-keyword pipeline:
    #       1) Build a DataFrame for the collection.
    #       2) For each keyword:
    #          - Split item keys into batches of `batch_size`.
    #          - For each batch, call `extract_content_for_keywords` with items_map={key:[keyword]}.
    #          - Send batch snippets to the LLM (function: 'thematic_analaysis_keywords').
    #          - Consolidate batch results per keyword (function: 'thematic_analaysis_keywords_consolidation').
    #       3) Return a single HTML report with one <section> per keyword.
    #
    #     Returns:
    #       HTML string for the whole report.
    #     """
    #     import json, math, re, html as _html
    #
    #     df = self._build_df_for_collection(collection_name=collection_name, cache=cache)
    #
    #     def _chunked(seq, n):
    #         for i in range(0, len(seq), n):
    #             yield seq[i:i + n]
    #
    #     def _slug(s: str) -> str:
    #         s = re.sub(r"[^A-Za-z0-9_.:-]+", "-", (s or "")).strip("-")
    #         return s.lower()[:60] or "x"
    #
    #     def _render_keyword_clusters(data: dict) -> str:
    #         clusters = (data or {}).get("keyword_analysis")
    #         if not clusters:
    #             return "<p>No keyword instances found.</p>"
    #         if isinstance(clusters, dict):
    #             clusters = [clusters]
    #         elif not isinstance(clusters, list):
    #             return "<p>Invalid structure for keyword_analysis.</p>"
    #
    #         parts = []
    #         for cluster in clusters:
    #             theme = cluster.get("theme", "Untitled Theme")
    #             discussion = cluster.get("discussion", "")
    #             support = cluster.get("support", "")
    #             critique = cluster.get("critique", "")
    #             parts.append(
    #                 f"""
    # <section class="keyword-cluster" style="margin-bottom:2em;">
    #   <h3 class="theme" style="font-size:1.15em; margin-bottom:0.5em;">{_html.escape(theme)}</h3>
    #   <div class="discussion" style="margin-bottom:1em;">
    #     <strong>Discussion:</strong>
    #     <p>{discussion}</p>
    #   </div>
    #   <div class="support" style="margin-bottom:1em; padding-left:1em; border-left:3px solid #ccc;">
    #     <strong>Support:</strong>
    #     <blockquote>{support}</blockquote>
    #   </div>
    #   <div class="critique">
    #     <strong>Critique:</strong>
    #     <p>{critique}</p>
    #   </div>
    # </section>
    # """.strip()
    #             )
    #         return "\n".join(parts)
    #
    #     # Generate a master list of item keys for batching
    #     item_keys = [k for k in (df.get("key") if hasattr(df, "get") else df["key"]) if k]
    #     final_sections = []
    #     total_keywords = len(keywords)
    #
    #     for kw_index, kw in enumerate(keywords, start=1):
    #         kw_str = str(kw).strip()
    #         if not kw_str:
    #             continue
    #
    #         batch_responses = []  # model responses per batch (structured)
    #         batch_payload_records = []  # raw snippet payloads (for consolidation prompt)
    #
    #         # Split into batches of keys
    #         for batch_no, keys_batch in enumerate(_chunked(item_keys, max(1, int(batch_size))), start=1):
    #             items_map = {str(k): [kw_str] for k in keys_batch}
    #             res = extract_content_for_keywords(
    #                 full_df=df,
    #                 items_to_code_with_keywords_map=items_map,
    #                 zotero_client_instance=self,
    #                 globally_suggested_keywords=None,
    #                 progress_callback=None,
    #                 max_items=len(keys_batch),
    #                 cache=cache,
    #             )
    #
    #             snippets = (res or {}).get("data", [])
    #             if not snippets:
    #                 continue
    #
    #             # Build a compact, explicit payload for the LLM (one batch)
    #             lines = [f"# Keyword: {kw_str}", f"# Batch: {batch_no}", ""]
    #             for i, sn in enumerate(snippets, start=1):
    #                 src = f"{sn.get('source_bib_header', 'N/A')}: {sn.get('source_title', '')}"
    #                 page = sn.get("page_number")
    #                 kfound = sn.get("keyword_found", "")
    #                 para_ctx = sn.get("paragraph_context", "")
    #                 lines.append(f"## Snippet {i}")
    #                 lines.append(f"Source: {src}")
    #                 lines.append(f"Page: {page}")
    #                 lines.append(f"Matched keyword: {kfound}")
    #                 lines.append("Context:")
    #                 lines.append(para_ctx)
    #                 lines.append("")
    #
    #             batch_payload = "\n".join(lines)
    #             batch_payload_records.append(batch_payload)
    #
    #             # Call the batch analysis function
    #             response, _v = call_models(
    #                 read=read,
    #                 store_only=store_only,
    #                 text=batch_payload,
    #                 function="thematic_analaysis_keywords",
    #                 collection_name=collection_name,
    #                 custom_id=f"{kw_str}::batch::{batch_no}",
    #             )
    #             if not store_only:
    #                 # Expecting a structured dict the renderer can handle; fallback to empty dict if None
    #                 batch_responses.append(response or {})
    #
    #         # If we only queued store_only calls, try the same trick used elsewhere
    #         if store_only:
    #             _process_batch_for(collection_name=collection_name, function="thematic_analaysis_keywords")
    #
    #         # Consolidate per keyword (only if we have material)
    #         if not store_only and batch_responses:
    #             # Consolidation payload: keep it explicit and small
    #             consolidated_seed = {
    #                 "keyword": kw_str,
    #                 "batches": [{"index": i + 1, "raw_notes": batch_payload_records[i]} for i in
    #                             range(len(batch_payload_records))]
    #             }
    #             consolidation_payload = json.dumps(consolidated_seed, ensure_ascii=False, indent=2)
    #
    #             final_resp, _v = call_models(
    #                 read=read,
    #                 store_only=False,  # consolidation needs immediate output to render
    #                 text=consolidation_payload,
    #                 function="thematic_analaysis_keywords_consolidation",
    #                 collection_name=collection_name,
    #                 custom_id=f"{kw_str}::consolidation",
    #             )
    #
    #             section_html_core = _render_keyword_clusters(final_resp or {})
    #         else:
    #             # If no immediate responses (e.g., store_only mode), render a minimal placeholder
    #             section_html_core = "<p>No analysable content found or results stored for later processing.</p>"
    #
    #         # Wrap as a section
    #         sec_id = f"kw-{_slug(kw_str)}"
    #         section_html = f"""
    # <section id="{sec_id}" class="keyword-section" style="margin:1.5em 0;">
    #   <h2 style="font-size:1.35em;">Keyword: {kw_str}</h2>
    #   {section_html_core}
    # </section>
    # """.strip()
    #         final_sections.append(section_html)
    #
    #     # Final HTML document with a mini-TOC
    #     if not final_sections:
    #         return "<article><p>No sections produced.</p></article>"
    #
    #     toc_items = []
    #     for kw in keywords:
    #         if not str(kw).strip():
    #             continue
    #         toc_items.append(f'<li><a href="#kw-{_slug(str(kw))}">{_html.escape(str(kw))}</a></li>')
    #     toc_html = f"""
    # <nav class="mini-toc" style="margin:1em 0;">
    #   <strong>Contents:</strong>
    #   <ul>
    #     {''.join(toc_items)}
    #   </ul>
    # </nav>
    # """.strip()
    #
    #     final_html = f"""
    # <article class="keyword-report" style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;">
    #   <header>
    #     <h1 style="font-size:1.6em; margin:0.2em 0;">Keyword Thematic Analysis</h1>
    #     <p style="color:#666; margin:0.2em 0;">{len(keywords)} keywords • batch size {batch_size}</p>
    #   </header>
    #   {toc_html}
    #   {'\n'.join(final_sections)}
    # </article>
    # """.strip()
    #
    #     return final_html
    # # if "controlled_vocabulary_terms" in properties:
    # #     print("response")
    # #     terms = response["controlled_vocabulary_terms"]
    # #     new_tags = [{"tag": t} for t in terms if isinstance(t, str) and t.strip()]
    # #     print(new_tags)
    # #     print(item_key)
    # #     input("jjj")
    # #     continue
    # # continue

    def process_append_controlled_vocabulary_terms(self, item: dict, response: dict) -> None:
        """
        Normalise and persist controlled vocabulary terms as Zotero tags:
          • Input can be list[str] or a single string with ';', ',', '|' or newlines.
          • Output tags follow the format: '#theme:<term>'.
          • De-duplicates case-insensitively.
        """
        try:
            import re
            raw = response.get("controlled_vocabulary_terms", [])
            terms: list[str] = []

            if isinstance(raw, str):
                parts = re.split(r"[;\|,\n]+", raw)
                terms = [p.strip() for p in parts if isinstance(p, str) and p.strip()]
            elif isinstance(raw, list):
                terms = [t.strip() for t in raw if isinstance(t, str) and t.strip()]
            else:
                terms = []

            # de-dup case-insensitively on the *term value* (before prefixing)
            seen: set[str] = set()
            normed: list[str] = []
            for t in terms:
                # if user already provided something like '#theme:foo', strip the prefix
                t_clean = re.sub(r"^\s*#?\s*theme\s*:\s*", "", t, flags=re.I).strip()
                k = t_clean.casefold()
                if k and k not in seen:
                    seen.add(k)
                    normed.append(t_clean)

            if not normed:
                return

            new_tags = [{"tag": f"#theme:{t}"} for t in normed]
            self.update_zotero_item_feature(
                updates={"tags": new_tags},
                item=item,
                append=True,
            )

        except Exception as e:
            import traceback
            tb = e.__traceback__
            while tb and tb.tb_next:
                tb = tb.tb_next
            if tb:
                fn = tb.tb_frame.f_code.co_filename
                ln = tb.tb_lineno
                fnc = tb.tb_frame.f_code.co_name
                print(f"[process_append_controlled_vocabulary_terms] failed at {fn}:{ln} in {fnc}: {e}")
            else:
                print(f"[process_append_controlled_vocabulary_terms] failed: {e}")
            traceback.print_exception(type(e), e, e.__traceback__)
    def generate_metadata(self, item_key, cabecalho=None):
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
        date = ""
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
                # 'journal': publication_title,
                'title': title,
                'abstract': abstract,
                # 'doi': doi,
                # "item_type": item_type,
                # "url": item['data'].get('url'),
                # "conferenceName": item['data'].get('conferenceName'),
                # "pages": item['data'].get('pages'),
                # "short_title": item['data'].get('shortTitle'),
                # 'item_id': key,
                # 'citation_key': citation_key,
                # 'attachment': attachment_info
                }


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
    def _get_flat_subcollections(self, parent_key: str) -> list:
        """
        Fetch all descendant sub-collections of the given collection key,
        as a flat list (excluding the root itself).
        """
        # Retrieve the root + all nested collections
        flat = self.zot.everything(self.zot.all_collections(parent_key))
        # Exclude the parent collection entry and return only descendants
        return [c for c in flat if c["data"]["key"] != parent_key]


    def extract_na(
            self,
            collection_name: str,
            read: bool = False,
            store_only: bool = True,
            cache: bool = False,
            properties=[]
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
        print("processing batch")

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
                pdf_path = self.get_pdf_path_for_item(item_key)
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
                        item=item,  # refetches latest version inside helper
                        append=True
                    )

                    # e2) abstract
                    if "abstract" in properties:
                        abstr = response.get("abstract")
                        print(f"processing {item_key}  and updating abs:{abstr}")
                        if isinstance(abstr, str) and abstr.strip():
                            self.update_zotero_item_feature(
                                updates={"abstractNote": abstr},
                                item=item,  # refetch again
                                append=True
                            )

                    # e3) controlled vocabulary → Zotero tags
                    if "controlled_vocabulary_terms" in properties:
                        terms = response.get("controlled_vocabulary_terms") or []
                        if isinstance(terms, list) and terms:
                            new_tags = [{"tag": "#theme:"+t.strip()} for t in terms if isinstance(t, str) and t.strip()]
                            print(f"processing {item_key}  and updating tags:{new_tags}")
                            if new_tags:
                                self.update_zotero_item_feature(
                                    updates={"tags": new_tags},
                                    item=item,  # refetch again
                                    append=True
                                )
                    if "affiliations" in property:
                        self.process_append_affiliations(item=item, response=response)

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
                if _process_batch_for(section_title=collection_name,analysis_key_suffix=function):
                    # downstream step per your pipeline (reads completed batch results)
                    self.extract_na(collection_name=collection_name, store_only=False, read=True,properties=properties)
            except Exception as e:
                print(f"[extract_na] batch follow-up failed: {e}")

        return True

    def extract_na_flat(
            self,
            collection_name: str,
            read: bool = False,
            store_only: bool = True,
            cache: bool = False,
            property: list[str] = None,
            item_keys: str = None,
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


        function = "extract_NA"
        parent_key = self.find_or_create_top_collection(collection_name)
        collection_name_cache=str(property)+"_"+collection_name
        errs_key = self.find_or_create_subcollection(subcoll_name=collection_name+"_err_Na",parent_key=parent_key)
        if _process_batch_for(section_title=collection_name_cache,
                              analysis_key_suffix=function,
            store_only=store_only
                              ):
            store_only=False;read=True

        print("processing batch:",store_only,read)

        if not parent_key:
            print(f"[extract_na_flat] Could not resolve collection: {collection_name}")
            return False

        if not property:
            print("[extract_na_flat] No property provided, aborting.")
            return False
        items=None
        if item_keys:
            items= [self.zot.item(k) for k in item_keys ]
        else:
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
            text = ""

            if not read:
                # a) PDF path
                pdf_path = self.get_pdf_path_for_item(item_key)
                if not pdf_path and not abstract:

                    continue

                # b) Extract text (unless read=True)
                if not read and pdf_path:
                    pdf_payload = (process_pdf(pdf_path, core_sections=True) or {}).get("payload") or ""
                    text = f"abstract:{abstract}\n\nTEXT:\n{pdf_payload}"
                    # try:
                    #
                    #     if len(property) == 1 and "controlled_vocabulary_terms" in property:
                    #         text =f"abstract:{abstract}\n\nTEXT:\n"+ (process_pdf(pdf_path, core_sections=True) or {}).get("payload", "")
                    #
                    #     else:
                    #         text =f"abstract:{abstract}\n\nTEXT:\n"+ (process_pdf(pdf_path, core_sections=True) or {}).get("payload", "")
                    # except Exception as e:
                    #     print(f"[extract_na_flat] PDF parse error: {e}")
                    #     continue
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
                collection_name=collection_name_cache,
                function=function
            )


            if store_only:
                continue
            print("extract na flat response\n",response)

            # e) Update Zotero fields
            # try:
            #     mini = {k: response.get(k) for k in property if k in response}
            #     extra_line = f"NA_extract::{json.dumps(mini, ensure_ascii=False)}"
            #     self.update_zotero_item_feature(
            #         updates={"extra": extra_line},
            #         item=item_key,
            #         append=True,
            #     )

            if "abstract" in property:
                abstr = response.get("abstract")
                if isinstance(abstr, str) and abstr.strip():
                    self.update_zotero_item_feature(
                        updates={"abstractNote": abstr},
                        item=item_key,
                        append=True,
                    )

            if "controlled_vocabulary_terms" in property:
                self.process_append_controlled_vocabulary_terms(item=item, response=response)

            if "affiliations" in property:
                print("affiliations uses")
                self.process_append_affiliations(item=item, response=response)
            # except Exception as e:
            #     print(f"[extract_na_flat] Update failed: {e}")

            # # f) Human-readable HTML note
            # try:
            #     code_evidence = {
            #         p: response.get(p)
            #         for p in property
            #         if isinstance(response.get(p), dict)
            #     }
            #     if code_evidence:
            #         snippet_html = generate_html({"code_evidence": code_evidence})
            #     else:
            #         snippet_html = f"<pre>{json.dumps(response, ensure_ascii=False, indent=2)}</pre>"
            #     header = f"<h3>NA Extract — {collection_name}</h3>"
            #     self.append_info_note_log(item_key=item_key, snippet=header + "\n" + snippet_html)
            # except Exception as e:
            #     self.append_info_note_log(
            #         item_key=item_key,
            #         snippet=f"<p><strong>extract_na_flat</strong>: failed to render HTML snippet: {e}</p>",
            #     )

        # Batch follow-up
        if store_only:
            try:
                completed = bool(_process_batch_for(
                    section_title=collection_name_cache,
                    analysis_key_suffix=function
                ))
                if completed:
                    self.extract_na_flat(
                        property=property,
                        collection_name=collection_name,
                        store_only=False,
                        read=True,
                    )
                else:
                    raise FileNotFoundError(f"Missing batch input")
            except Exception as e:
                import traceback
                tb = e.__traceback__
                while tb and tb.tb_next:
                    tb = tb.tb_next
                if tb:
                    fn = tb.tb_frame.f_code.co_filename
                    ln = tb.tb_lineno
                    fnc = tb.tb_frame.f_code.co_name
                    print(f"[extract_na_flat] batch follow-up failed at {fn}:{ln} in {fnc}: {e}")
                else:
                    print(f"[extract_na_flat] batch follow-up failed: {e}")
                traceback.print_exception(type(e), e, e.__traceback__)

        return True

    def process_append_affiliations(self, item: dict, response: dict) -> None:
        """
        Normalise and persist affiliations:
          • Tags: affiliation:institution:<val>, affiliation:department:<val>, affiliation:city:<val>,
                   affiliation:country:<val>, affiliation:continent:<val>
          • HTML note: 'Affiliation: Department=…, Institution=…, City=…, Country=…, Continent=…'
        """
        try:
            raw = response.get("affiliations") or []

            if isinstance(raw, dict):
                raw = [raw]

            affiliations: list[dict] = []

            def _norm(v):
                if v is None:
                    return ""
                if not isinstance(v, str):
                    v = str(v)
                s = v.strip()
                return "" if s.casefold() in {"", "none", "null", "n/a", "na", "-"} else s

            for a in raw:
                if isinstance(a, dict):
                    dept = _norm(a.get("department"))
                    inst = _norm(a.get("institution"))
                    city = _norm(a.get("city"))
                    country = _norm(a.get("country"))
                    continent = _norm(a.get("continent"))
                    if any([dept, inst, city, country, continent]):
                        affiliations.append({
                            "department": dept,
                            "institution": inst,
                            "city": city,
                            "country": country,
                            "continent": continent,
                        })
                elif isinstance(a, str):
                    inst = _norm(a)
                    if inst:
                        affiliations.append({
                            "department": "",
                            "institution": inst,
                            "city": "",
                            "country": "",
                            "continent": "",
                        })

            if not affiliations:
                return

            # --- Build and append tags (dedup within this call) ---
            tag_prefix = {
                "institution": "affiliation:institution",
                "department": "affiliation:department",
                "city": "affiliation:city",
                "country": "affiliation:country",
                "continent": "affiliation:continent",
            }
            seen: set[str] = set()
            new_tags: list[dict] = []
            for aff in affiliations:
                for field, prefix in tag_prefix.items():
                    val = aff.get(field, "")
                    if not val:
                        continue
                    tag = f"{prefix}:{val}"
                    k = tag.casefold().strip()
                    if k not in seen:
                        seen.add(k)
                        new_tags.append({"tag": tag})

            if new_tags:
                self.update_zotero_item_feature(
                    updates={"tags": new_tags},
                    item=item,
                    append=True,
                )

            # --- Human-readable HTML note ---
            lines: list[str] = []
            for aff in affiliations:
                parts: list[str] = []
                if aff.get("department"):
                    parts.append(f"Department={aff['department']}")
                if aff.get("institution"):
                    parts.append(f"Institution={aff['institution']}")
                if aff.get("city"):
                    parts.append(f"City={aff['city']}")
                if aff.get("country"):
                    parts.append(f"Country={aff['country']}")
                if aff.get("continent"):
                    parts.append(f"Continent={aff['continent']}")
                line = "Affiliation: " + ", ".join(parts) if parts else "Affiliation: "
                lines.append(line)

            html_snippet = "<h3>Affiliations</h3>\n" + "\n".join(f"<p>{line}</p>" for line in lines)
            self.append_info_note_log(snippet=html_snippet, item_key=item["key"])

        except Exception as e:
            import traceback
            tb = e.__traceback__
            while tb and tb.tb_next:
                tb = tb.tb_next
            if tb:
                fn = tb.tb_frame.f_code.co_filename
                ln = tb.tb_lineno
                fnc = tb.tb_frame.f_code.co_name
                print(f"[process_append_affiliations] failed at {fn}:{ln} in {fnc}: {e}")
            else:
                print(f"[process_append_affiliations] failed: {e}")
            traceback.print_exception(type(e), e, e.__traceback__)
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
            if not pdf:
                print(item)
                input("sssss")
            if not read:
                text = process_pdf(pdf)["payload"]


            response, v = call_models_old_backin(
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

            if _process_batch_for(section_title=collection_name,
                                  analysis_key_suffix=function,
                                  ):
                self.extract_entity_affiliation(collection_name=collection_name, store_only=False, read=True)
        return True


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

    def open_coding(
            self,
            research_question: str | list[str],
            collection_name: str,
            store_only: bool = False,
            read: bool = False,
            cache: bool = False,
            core_sections: bool = True,
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

        prompt_key = "code_pdf_page"

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

def check_keyword_count_pdf(keyword: str, pdf_path: str) -> int | None:
    """
    Opens a PDF, extracts its text content, and counts the occurrences
    of a specific keyword (case-insensitive, whole word).

    Args:
        keyword (str): The keyword to search for.
        pdf_path (str): The file path to the PDF document.

    Returns:
        int | None: The number of times the keyword appears in the PDF text,
                    or None if the PDF could not be processed (e.g., encrypted,
                    corrupted, permission denied, file not found).
                    Returns 0 if the keyword is not found or the PDF has no text.
    """
    base_filename = os.path.basename(pdf_path) # Get filename for logging

    # --- Basic File Check ---
    if not os.path.exists(pdf_path):
        logging.error(f"File not found: '{pdf_path}'")
        return None
    if not pdf_path.lower().endswith(".pdf"):
        logging.warning(f"File is not a PDF (by extension): '{base_filename}'")
        # Decide if you want to attempt processing anyway or return
        # return None # Option: return if not PDF extension

    doc = None # Initialize doc to ensure it's closable in finally block
    try:
        # --- Open PDF ---
        doc = fitz.open(pdf_path)

        # --- Encryption Check ---
        if doc.is_encrypted:
            # Try to authenticate with an empty password (for some PDFs)
            if not doc.authenticate(""):
                logging.warning(f"PDF is encrypted and password protected: '{base_filename}'")
                return None # Cannot process encrypted files without password
            else:
                logging.info(f"PDF was encrypted but opened with empty password: '{base_filename}'")
                # Proceed with extraction if authentication succeeded

        # --- Permissions Check (Implicit) ---
        # PyMuPDF's get_text will often fail or return empty if permissions
        # are restricted. We rely on the extraction try-except block below.
        # You could check doc.permissions if needed, but get_text is the real test.
        # if not (doc.permissions & fitz.PDF_PERM_EXTRACT):
        #     logging.warning(f"PDF extraction permission flag not set for: '{base_filename}'. Attempting anyway.")

        # --- Extract Text ---
        doc_text_list = []
        for page_num in range(len(doc)): # len(doc) is page count
            try:
                page = doc.load_page(page_num)
                page_text = page.get_text("text", sort=True).strip()
                if page_text:
                    doc_text_list.append(page_text)
            except Exception as e_page:
                # Log error for specific page but continue if possible
                logging.warning(f"Could not extract text from page {page_num + 1} in '{base_filename}'. Error: {e_page}")
                continue # Skip this page

        doc_text = "\n".join(doc_text_list)

        # --- Check if any text was extracted ---
        if not doc_text:
            logging.info(f"No text successfully extracted from '{base_filename}'. Keyword count is 0.")
            return 0

        # --- Count Keyword Occurrences ---
        # Use word boundaries (\b) to match whole words only
        # Use re.escape to handle potential special characters in the keyword
        # Use re.IGNORECASE for case-insensitive matching
        try:
            pattern = r'\b' + re.escape(keyword) + r'\b'
            matches = re.findall(pattern, doc_text, re.IGNORECASE)
            count = len(matches)
            logging.info(f"Found '{keyword}' {count} times in '{base_filename}'.")
            return count
        except re.error as e_re:
            logging.error(f"Regex error for keyword '{keyword}' in '{base_filename}': {e_re}")
            return None # Indicate an error during regex processing

    except fitz.FileNotFoundError:
        # This exception type might not exist directly in older fitz,
        # os.path.exists check handles it earlier mostly.
        logging.error(f"File not found (fitz internal): '{pdf_path}'")
        return None
    except Exception as e_general:
        # Catch other potential errors during opening or processing
        logging.error(f"Failed to process PDF '{base_filename}'. Error: {e_general}")
        return None
    finally:
        # --- Ensure Document Closure ---
        if doc:
            doc.close()
            # logging.debug(f"Closed PDF: '{base_filename}'") # Debug logging

def extract_intro_conclusion_pdf_text(
    pdf_path: str,
    min_pages_each_end: int = 3, # Constraint for the calculation
    max_pages_each_end: int = 8  # Constraint for the calculation
) -> str | None: # Return string (text content) or None on error
    """
    Extracts text content from the head and tail pages of a PDF,
    determined by complex rules, using PyMuPDF (Fitz).

    The function calculates total pages, determines which head/tail pages
    to process based on N, and returns their combined text content.

    Rule for calculating N (pages from each end):
    1. N = ceil(total_pages / 4)
    2. N = max(N, min_pages_each_end)
    3. N = min(N, max_pages_each_end)

    Args:
        pdf_path: Path to the input PDF document.
        min_pages_each_end: The minimum number of pages rule for N calculation.
        max_pages_each_end: The maximum number of pages rule for N calculation.

    Returns:
        A string containing the combined text from the selected head/tail pages,
        or None if an error occurred or no text could be extracted.
    """
    if not os.path.exists(pdf_path):
        print(f"Error: Input PDF file not found at '{pdf_path}'")
        return None

    if min_pages_each_end < 1 or max_pages_each_end < min_pages_each_end:
        print(f"Error: Invalid min/max page settings ({min_pages_each_end=}, {max_pages_each_end=})")
        return None

    doc = None
    try:
        doc = fitz.open(pdf_path)
        total_pages = doc.page_count
        print(f"Processing '{pdf_path}' which has {total_pages} pages (calculated internally).")

        if total_pages == 0:
            print("Error: PDF file has 0 pages.")
            return None

        # --- Calculate N (same logic as before) ---
        base_n = total_pages / 4.0
        n_candidate = math.ceil(base_n)
        n_limited_min = max(n_candidate, min_pages_each_end)
        n_final = int(min(n_limited_min, max_pages_each_end))

        print(f"Internal Calculation: total={total_pages}, base=ceil({base_n:.2f})={n_candidate}, "
              f"limited=max({n_candidate},{min_pages_each_end})={n_limited_min}, "
              f"final N=min({n_limited_min},{max_pages_each_end})={n_final}")

        # --- Determine actual page indices to process (same logic) ---
        actual_n_each_end = min(n_final, total_pages)

        if actual_n_each_end == 0:
             print("Warning: Calculated 0 pages to extract from each end.")
             return None # Or return "" if empty string is preferred for zero pages

        head_indices = list(range(actual_n_each_end))
        tail_start_index = max(0, total_pages - actual_n_each_end)
        tail_indices = list(range(tail_start_index, total_pages))
        pages_to_process_indices = sorted(list(set(head_indices + tail_indices)))
        num_selected = len(pages_to_process_indices)

        print(f"Identified {actual_n_each_end} pages from head (Indices: {head_indices})")
        print(f"Identified {actual_n_each_end} pages from tail (Indices: {tail_indices})")
        print(f"Total unique pages to process: {num_selected} (Indices: {pages_to_process_indices})")

        if not pages_to_process_indices:
             print("Error: No page indices were selected for text extraction.")
             return None

        # --- Perform Text Extraction ---
        # No doc.select() needed, just iterate through indices
        extracted_text_parts = []
        print(f"Extracting text from {num_selected} selected pages...")
        page_extract_count = 0
        for page_index in pages_to_process_indices:
            try:
                # Load the specific page
                page = doc.load_page(page_index) # 0-based index
                # Extract text from the page
                text = page.get_text("text") # Use "text" for plain text
                if text: # Append only if text is extracted
                     extracted_text_parts.append(text)
                     # Add a separator for clarity (optional)
                     separator = f"\n\n--- End of Page {page_index + 1} ---\n\n"
                     extracted_text_parts.append(separator)
                     page_extract_count += 1
                # else: # Optional: Log pages with no text
                #     print(f"Note: No text found on page index {page_index}.")
            except Exception as page_e:
                # Log error and continue to next page if possible
                print(f"Warning: Could not load or extract text from page index {page_index}: {page_e}")

        if not extracted_text_parts:
             print("Warning: No text could be extracted from any of the selected pages.")
             # Return None if absolutely no text was found
             return None

        print(f"Successfully extracted text from {page_extract_count} pages.")
        # Combine the extracted text parts into a single string
        final_text = "".join(extracted_text_parts)

        # --- Return the extracted text ---
        return final_text # Return the string

    # --- Error Handling ---
    except fitz.FileNotFoundError:
        print(f"Error: PyMuPDF could not find the file at '{pdf_path}'")
        return None # Return None on error
    except Exception as e:
        print(f"An error occurred processing '{pdf_path}': {e}")
        return None # Return None on error
    finally:
        # --- Ensure document is closed ---
        if doc:
            doc.close()

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

from typing import Dict, Any
def merge_sections_min_words(
    sections_map: Dict[str, Any] | None,
    min_words: int = 500,
    max_words: int | None = None,
) -> Dict[str, str]:
    """
    ###1. Normalise input to ordered key->text
    ###2. If any single section exceeds max_words, return unmerged (no truncation/splitting)
    ###3. Otherwise merge to satisfy min_words while never creating chunks > max_words
    """

    def _text(val: Any) -> str:
        if isinstance(val, dict):
            return (val.get("text") or val.get("content") or val.get("raw") or "").strip()
        return str(val or "").strip()

    def _wc(s: str) -> int:
        return len(s.split())

    if not isinstance(sections_map, dict) or not sections_map:
        return {}

    cleaned: list[tuple[str, str]] = []
    for k, v in sections_map.items():
        s = _text(v)
        if s:
            cleaned.append((str(k), s))

    if not cleaned:
        return {}

    if max_words is not None:
        if max_words < 1:
            return dict(cleaned)
        for _, s in cleaned:
            if _wc(s) > max_words:
                return dict(cleaned)

    merged_pairs: list[tuple[str, str]] = []
    buf_keys: list[str] = []
    buf_texts: list[str] = []
    buf_words = 0

    def _flush_buf_as_chunk() -> None:
        nonlocal buf_keys, buf_texts, buf_words, merged_pairs
        if not buf_texts:
            return
        merged_pairs.append((" + ".join(buf_keys), "\n\n".join(buf_texts).strip()))
        buf_keys, buf_texts, buf_words = [], [], 0

    def _merge_buf_into_last_if_fits() -> bool:
        nonlocal buf_keys, buf_texts, buf_words, merged_pairs

        if not buf_texts or not merged_pairs:
            return False

        joined_buf = "\n\n".join(buf_texts).strip()
        if not joined_buf:
            buf_keys, buf_texts, buf_words = [], [], 0
            return True

        if max_words is None:
            prev_k, prev_s = merged_pairs.pop()
            new_k = f"{prev_k} + {' + '.join(buf_keys)}"
            new_s = f"{prev_s}\n\n{joined_buf}".strip()
            merged_pairs.append((new_k, new_s))
            buf_keys, buf_texts, buf_words = [], [], 0
            return True

        prev_k, prev_s = merged_pairs[-1]
        if _wc(prev_s) + buf_words <= max_words:
            merged_pairs.pop()
            new_k = f"{prev_k} + {' + '.join(buf_keys)}"
            new_s = f"{prev_s}\n\n{joined_buf}".strip()
            merged_pairs.append((new_k, new_s))
            buf_keys, buf_texts, buf_words = [], [], 0
            return True

        return False

    for k, s in cleaned:
        w = _wc(s)

        if w >= min_words:
            if not buf_texts:
                merged_pairs.append((k, s))
                continue

            if max_words is not None and buf_words + w > max_words:
                if buf_words >= min_words:
                    _flush_buf_as_chunk()
                    merged_pairs.append((k, s))
                else:
                    if not _merge_buf_into_last_if_fits():
                        _flush_buf_as_chunk()
                    merged_pairs.append((k, s))
                continue

            if buf_words >= min_words:
                _flush_buf_as_chunk()
                merged_pairs.append((k, s))
            else:
                glued_key = " + ".join(buf_keys + [k])
                glued_text = ("\n\n".join(buf_texts + [s])).strip()
                merged_pairs.append((glued_key, glued_text))
                buf_keys, buf_texts, buf_words = [], [], 0
            continue

        if max_words is not None and buf_words and buf_words + w > max_words:
            if buf_words >= min_words:
                _flush_buf_as_chunk()
            else:
                if not _merge_buf_into_last_if_fits():
                    _flush_buf_as_chunk()

        buf_keys.append(k)
        buf_texts.append(s)
        buf_words += w

        if buf_words >= min_words:
            _flush_buf_as_chunk()

    if buf_texts:
        if not _merge_buf_into_last_if_fits():
            joined_buf = "\n\n".join(buf_texts).strip()
            if merged_pairs and joined_buf:
                if max_words is None:
                    prev_k, prev_s = merged_pairs.pop()
                    new_k = f"{prev_k} + {' + '.join(buf_keys)}"
                    new_s = f"{prev_s}\n\n{joined_buf}".strip()
                    merged_pairs.append((new_k, new_s))
                    buf_keys, buf_texts, buf_words = [], [], 0
                else:
                    prev_k, prev_s = merged_pairs[-1]
                    if _wc(prev_s) + buf_words <= max_words:
                        merged_pairs.pop()
                        new_k = f"{prev_k} + {' + '.join(buf_keys)}"
                        new_s = f"{prev_s}\n\n{joined_buf}".strip()
                        merged_pairs.append((new_k, new_s))
                        buf_keys, buf_texts, buf_words = [], [], 0
                    else:
                        _flush_buf_as_chunk()
            else:
                _flush_buf_as_chunk()

    return dict(merged_pairs)

def _safe_collection_name(name: str) -> str:
    """
    Windows/Unix-safe slug for folder/filenames.
    - strips/normalizes control & reserved chars: \\ / : * ? " < > |
    - collapses whitespace to '_'
    - keeps only [A-Za-z0-9._-]
    - trims to a reasonable length
    """
    if not isinstance(name, str):
        name = str(name or "")
    s = name.strip()
    s = re.sub(r'[\\/:*?"<>|]+', '_', s)   # reserved on Windows
    s = re.sub(r'\s+', '_', s)







library_id = os.environ.get("LIBRARY_ID")
api_key = os.environ.get("API_KEY")
library_type = os.environ.get("LIBRARY_TYPE")
token = os.environ.get("TOKEN")
# chat_name= "summary"
chat_name= "summary"

chat_args = {
    # "session_token":token,
    # "conversation_id":'208296a2-adb8-4dc0-87f2-b23e23c0fc79',
    # "chat_id": chat_name,
    "os":"win",
"library_id":library_id,
    "api_key":api_key
}
zotero_client =Zotero(**chat_args)

