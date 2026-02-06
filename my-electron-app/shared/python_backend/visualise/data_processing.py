from __future__ import annotations

# src/core/utils/data_processing.py

import pathlib
import sys
from html import escape as _escape
from pathlib import Path
from typing import Generator, Callable, Tuple

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = next((parent for parent in BASE_DIR.parents if (parent / "package.json").is_file()), BASE_DIR.parents[-1])
for entry in (BASE_DIR, REPO_ROOT):
    entry_str = str(entry)
    if entry_str not in sys.path:
        sys.path.insert(0, entry_str)


from python_backend.core.utils.calling_models import _process_batch_for, _get_prompt_details


def _get_en_english():
    import spacy

    return spacy.blank("en")


from python_backend.core.utils.calling_models import *

# library_id = os.environ.get("LIBRARY_ID")
# api_key = os.environ.get("API_KEY")
# library_type = os.environ.get("LIBRARY_TYPE")
# token = os.environ.get("TOKEN")
# # chat_name= "summary"
# chat_name= "summary"
#
# chat_args = {
#     # "session_token":token,
#     # "conversation_id":'208296a2-adb8-4dc0-87f2-b23e23c0fc79',
#     # "chat_id": chat_name,
#     "os":"win",
# "library_id":library_id,
#     "api_key":api_key
# }
# zotero_client =Zotero(**chat_args)

import requests
from dotenv import load_dotenv
import traceback


# Import constants from within the same 'utils' package
from general.app_constants import ZOTERO_CACHE_DIR_NAME, MISTRAL_API_KEY_ENV_VAR, \
    COUNTRY_SYNONYM_MAP, INSTITUTION_SYNONYM_MAP, PUBLISHER_SYNONYM_MAP, FUNDER_SYNONYM_MAP, ITEMTYPE_SYNONYM_MAP, \
    COUNTRY_TO_CONTINENT, ZOTKW_CACHE_DIR, TOP_N_DEFAULT, PDF_MARKDOWN_CACHE_DIR, CORE_COLUMNS

# from bibliometric_analysis_tool.utils.zotero_class import Zotero
#
#
# CORE_COLUMNS = [
#     'key', 'title', 'year', 'authors', 'publicationTitle', 'url', 'source',
#     'controlled_vocabulary_terms', 'citations', 'item_type', 'abstract',
#     'institution', 'country', 'place', 'affiliation',
#     'word_count_for_attribution', 'attribution_mentions',
#     'department', 'user_decision', 'user_notes'
# ]
# APP_NAME = "annotarium"
#
# APP_HOME_DIR = Path.home() / APP_NAME
# APP_HOME_DIR.mkdir(parents=True, exist_ok=True)
#
# APP_CACHE_DIR = APP_HOME_DIR / "cache"
# APP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
#
# ZOTERO_CACHE_DIR = APP_CACHE_DIR / "zotero"
# ZOTERO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
#
# ZOTERO_DF_CACHE_DIR = ZOTERO_CACHE_DIR / "dataframes"
# ZOTERO_DF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
#
# MISTRAL_CACHE_DIR = APP_CACHE_DIR / "mistral"
# MISTRAL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
#
# MAIN_APP_CACHE_DIR = APP_CACHE_DIR
#
# PDF_MARKDOWN_CACHE_DIR = APP_CACHE_DIR / "pdf_markdown"
# PDF_MARKDOWN_CACHE_DIR.mkdir(parents=True, exist_ok=True)
#
# CACHE_DIR_PATH = ZOTERO_DF_CACHE_DIR

from datetime import datetime
import datetime
from dateutil import parser as dateutil_parser

from python_backend.core.pdf_processor import referenced_paragraph, _exponential_backoff, _cache_path
import nltk


from nltk.stem import WordNetLemmatizer
from bs4 import BeautifulSoup  # For robust HTML stripping

from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter

# ──────────────────────────────────────────────────────────────────────────────
#  Setup a global geocoder & rate‐limiter
# ──────────────────────────────────────────────────────────────────────────────
_geolocator = Nominatim(user_agent="bibliometric_analysis")
_geocode = RateLimiter(_geolocator.geocode, min_delay_seconds=1, error_wait_seconds=5.0)
_GEOCACHE_FILE = pathlib.Path.home() / ".annotarium_inst_geo_cache.json"
_USER_AGENT    = "Annotarium/1.2  (contact: youremail@example.org)"




from pathlib import Path

import plotly.graph_objects as go

import logging


import nltk
from nltk.tokenize import word_tokenize
from nltk.corpus import stopwords
from nltk.stem import PorterStemmer  # Optional: for stemming

import string
import pandas as pd
# Zotero Setup
load_dotenv()
ZOTERO_CLASS_AVAILABLE = False
zot = None  # This will be the usable Zotero instance for this module
# Cache Directory Setup for this module
UTILS_MODULE_DIR = Path(__file__).resolve().parent
CACHE_DIR_PATH = UTILS_MODULE_DIR / ZOTERO_CACHE_DIR_NAME
CACHE_DIR_PATH.mkdir(parents=True, exist_ok=True)
# from bibliometric_analysis_tool.utils.zotero_class import Zotero


import re, html as _html

ALLOWED_BLOCK_TAG = re.compile(
    r"^\s*<\s*/?\s*(?:p|h[1-6]|div|span|ul|ol|li|blockquote|table|thead|tbody|tr|td|th|pre|code|br|hr|em|strong|a)(\s|>|/)",
    re.I,
)

def _clean_angle_bracket_urls(s: str) -> str:
    # Turn <http(s)://...> and <www....> into plain text to avoid bogus tags
    s = re.sub(r"<\s*(https?://[^>\s]+)\s*>", r"\1", s)
    s = re.sub(r"<\s*(www\.[^>\s]+)\s*>", r"\1", s)
    return s

APP_CACHE_DIR = Path(".") / ".bibliometric_tool_dp_cache"  # Fallback
try:
    APP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
except Exception as e_mkdir:
    logging.error(f"Failed to create fallback cache dir: {e_mkdir}")

if 'MISTRAL_API_KEY_ENV_VAR' not in globals(): MISTRAL_API_KEY_ENV_VAR = "MISTRAL_API_KEY"

if 'STOP_WORDS' not in globals(): STOP_WORDS = set(["the", "a", "is", "of", "and"])  # Minimal
if 'PUNCTUATION_TABLE' not in globals(): PUNCTUATION_TABLE = str.maketrans('', '', string.punctuation + '“”—‘’')

_FALLBACK_STOP_WORDS = {
    "a",
    "about",
    "above",
    "after",
    "again",
    "against",
    "all",
    "am",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "because",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "doing",
    "down",
    "during",
    "each",
    "few",
    "for",
    "from",
    "further",
    "had",
    "has",
    "have",
    "having",
    "he",
    "her",
    "here",
    "hers",
    "herself",
    "him",
    "himself",
    "his",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "itself",
    "just",
    "me",
    "more",
    "most",
    "my",
    "myself",
    "no",
    "nor",
    "not",
    "now",
    "of",
    "off",
    "on",
    "once",
    "only",
    "or",
    "other",
    "our",
    "ours",
    "ourselves",
    "out",
    "over",
    "own",
    "same",
    "she",
    "should",
    "so",
    "some",
    "such",
    "than",
    "that",
    "the",
    "their",
    "theirs",
    "them",
    "themselves",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "to",
    "too",
    "under",
    "until",
    "up",
    "very",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "whom",
    "why",
    "will",
    "with",
    "you",
    "your",
    "yours",
    "yourself",
    "yourselves",
}


def _safe_stopwords_english() -> set[str]:
    try:
        return set(stopwords.words("english"))
    except LookupError as exc:
        logging.warning("NLTK stopwords not found; using fallback list. %s", exc)
        return set(_FALLBACK_STOP_WORDS)
    except Exception as exc:
        logging.warning("Failed to load NLTK stopwords; using fallback list. %s", exc)
        return set(_FALLBACK_STOP_WORDS)


if 'preprocess_text' not in globals():  # General preprocessor
    def preprocess_text(text, use_stemming=False):  # STUB
        if not text or not isinstance(text, str): return []
        tokens = nltk.word_tokenize(text.lower().translate(PUNCTUATION_TABLE))
        return [w for w in tokens if len(w) > 2 and w.isalpha() and w not in STOP_WORDS]
# --- Global NLP Setup (ensure these are defined robustly) ---
# (STOP_WORDS, CUSTOM_STOP_WORDS, PUNCTUATION_TABLE as before, but PUNCTUATION_TABLE might be less used with regex tokenizers)

STOP_WORDS = _safe_stopwords_english()
CUSTOM_STOP_WORDS = {  # Add more specific or domain-irrelevant words
    "et", "al", "eg", "ie", "cf", "etc", "ibid", "op", "cit",
    "fig", "figure", "figures", "table", "tables", "appendix", "chapter",
    "january", "february", "march", "april", "may", "june", "july",
    "august", "september", "october", "november", "december", "mon", "tue", "wed", "thu", "fri", "sat", "sun",
    "article", "paper", "study", "research", "report", "analysis", "section", "introduction", "conclusion",
    "abstract", "controlled_vocabulary_terms", "references", "author", "authors", "editor", "editors",
    "university", "department", "journal", "conference", "proceedings", "press",
    "vol", "pp", "no", "doi", "isbn", "issn", "http", "https", "www", "com", "org", "pdf",
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",  # Numbers as words
    "first", "second", "third", "fourth", "fifth",
    "also", "however", "therefore", "thus", "hence", "furthermore", "moreover", "namely",
    "could", "would", "should", "might", "must", "may", "can", "will", "shall",
    "data", "results", "methods", "discussion", "findings", "implications", "limitations",
    "acknowledgments", "declaration", "competing", "interests", "funding",
    "published", "elsevier", "springer", "ieee", "wiley", "taylor", "francis",
    "available", "accessed", "retrieved", "note", "notes", "see", "cf",
    "copyright", "permission", "reserved", "rights", "licence", "license",
    "page", "pages", "vol", "issue", "number"
}
STOP_WORDS.update(CUSTOM_STOP_WORDS)


LEMMATIZER = WordNetLemmatizer()

# For POS tagging, NLTK's default tagger needs this resource
try:
    nltk.data.find('taggers/averaged_perceptron_tagger')
except LookupError:
    logging.warning("NLTK resource missing: averaged_perceptron_tagger (POS tagging disabled).")
try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    logging.warning("NLTK resource missing: wordnet (lemmatization may be limited).")
try:
    nltk.data.find('corpora/omw-1.4')
except LookupError:
    logging.warning("NLTK resource missing: omw-1.4 (lemmatization may be limited).")


def get_wordnet_pos(treebank_tag):
    """Converts treebank POS tags to WordNet POS tags for lemmatization."""
    if treebank_tag.startswith('J'):
        return nltk.corpus.wordnet.ADJ
    elif treebank_tag.startswith('V'):
        return nltk.corpus.wordnet.VERB
    elif treebank_tag.startswith('N'):
        return nltk.corpus.wordnet.NOUN
    elif treebank_tag.startswith('R'):
        return nltk.corpus.wordnet.ADV
    else:
        return nltk.corpus.wordnet.NOUN  # Default to noun


# --- Add this NEW standalone helper function in data_processing.py ---
def reconstruct_extra_field(original_extra_text: str, updates: dict) -> str:
    """
    Reconstructs the 'extra' field string by updating it with new values.
    Preserves the order and any un-editable lines from the original text.
    """
    display_key_map = {
        'citations': 'Citations',

        'department': 'Department', 'institution': 'Institution', 'country': 'Country',
        'ontology': 'ontology', 'argumentation_logic': 'Argumentation Logic',
        'evidence_source_base': 'Evidence Source Base', 'methodology': 'Methodology',
        'methods': 'Methods', 'framework_model': 'Framework/Model',
        'contribution_type': 'Contribution Type', 'attribution_lens_focus': 'Attribution Lens Focus',
        'controlled_vocabulary_terms': 'Topic Phrases',
        # Add a key for user notes from the screener
        'user_notes': 'Screening Notes'
    }

    # Reverse map for quick lookup from line key to standard key
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
                new_value = updates.get(standard_key, value_part.strip())
                # Use the canonical display key from the map to maintain consistent casing
                display_key = display_key_map[standard_key]
                new_lines.append(f"{display_key}: {new_value}")
                updated_keys.add(standard_key)
            else:
                new_lines.append(line)  # Preserve unmanaged lines
        else:
            new_lines.append(line)  # Preserve lines without a colon

    # Add any new keys from 'updates' that were not in the original text
    for key, value in updates.items():
        if key not in updated_keys and value and str(value).strip():
            if key in display_key_map:
                display_key = display_key_map[key]
                new_lines.append(f"{display_key}: {value}")

    return "\n".join(new_lines)


def advanced_preprocess_text(
        text: str,
        lemmatize: bool = True,
        remove_stopwords: bool = True,
        min_token_len: int = 2,
        keep_alphanumeric_only: bool = True
        # If true, removes tokens that are purely punctuation after initial cleaning
) -> list[str]:
    """
    Advanced text preprocessing: HTML stripping, normalization, tokenization,
    POS tagging, lemmatization, stopword removal, and final filtering.
    """
    if not text or not isinstance(text, str):
        return []

    # 1. Strip HTML and normalize basic issues
    try:
        soup = BeautifulSoup(html.unescape(text), "html.parser")
        for script_or_style in soup(["script", "style", "sup", "table", "figure"]):  # Remove irrelevant tags
            script_or_style.decompose()
        cleaned_text = soup.get_text(separator=" ", strip=True)
    except Exception as e_bs:
        logging.warning(f"BeautifulSoup parsing error: {e_bs}. Falling back to regex for HTML stripping.")
        temp_text = html.unescape(text)
        temp_text = re.sub(r'<sup>.*?</sup>', '', temp_text, flags=re.IGNORECASE | re.DOTALL)
        temp_text = re.sub(r'<style.*?</style>', ' ', temp_text, flags=re.IGNORECASE | re.DOTALL)
        temp_text = re.sub(r'<script.*?</script>', ' ', temp_text, flags=re.IGNORECASE | re.DOTALL)
        temp_text = re.sub(r'<[^>]+>', ' ', temp_text)
        cleaned_text = temp_text

    cleaned_text = cleaned_text.lower()
    # Normalize common contractions (simple examples, can be expanded)
    cleaned_text = re.sub(r"won't", "will not", cleaned_text)
    cleaned_text = re.sub(r"can\'t", "can not", cleaned_text)
    cleaned_text = re.sub(r"n\'t", " not", cleaned_text)
    cleaned_text = re.sub(r"\'re", " are", cleaned_text)
    cleaned_text = re.sub(r"\'s", " is", cleaned_text)  # Be careful with possessives vs. "is"
    cleaned_text = re.sub(r"\'d", " would", cleaned_text)
    cleaned_text = re.sub(r"\'ll", " will", cleaned_text)
    cleaned_text = re.sub(r"\'ve", " have", cleaned_text)
    cleaned_text = re.sub(r"\'m", " am", cleaned_text)

    # Remove non-alphanumeric characters except spaces and hyphens (if desired for multi-word terms)
    # cleaned_text = re.sub(r'[^\w\s-]', '', cleaned_text) # Keeps hyphens
    cleaned_text = re.sub(r'[^a-z0-9\s]', ' ', cleaned_text)  # Keeps only alphanumeric and spaces
    cleaned_text = re.sub(r'\s+', ' ', cleaned_text).strip()  # Consolidate whitespace

    if not cleaned_text:
        return []

    # 2. Tokenization (NLTK's word_tokenize is generally good)
    tokens = word_tokenize(cleaned_text)

    # 3. POS Tagging (Needed for accurate lemmatization)
    pos_tags = nltk.pos_tag(tokens)

    processed_tokens = []
    for word, tag in pos_tags:
        # 4. Lemmatization
        if lemmatize:
            wordnet_pos = get_wordnet_pos(tag)
            lemma = LEMMATIZER.lemmatize(word, wordnet_pos)
        else:
            lemma = word  # Use original token if not lemmatizing

        # 5. Stop Word Removal (applied on lemmas or original words)
        if remove_stopwords and lemma in STOP_WORDS:
            continue

        # 6. Further Filtering (length, pure numeric, pure punctuation after lemmatization)
        if len(lemma) < min_token_len:
            continue
        if lemma.isdigit():  # Remove if it's purely numbers
            continue
        if keep_alphanumeric_only and not lemma.isalnum():  # Remove if not alphanumeric (e.g. just leftover punct)
            # A stricter check could be lemma.isalpha() if numbers should be excluded
            if not re.fullmatch(r'[\w-]+', lemma):  # Allow hyphens in what's considered "alnum"
                continue

        processed_tokens.append(lemma)

    return processed_tokens



# --- Helper Functions for your process_pdf ---
def _cache_path(pdf_file: str) -> Path:
    """Deterministic cache file path for a PDF (SHA256 hash of PDF path)."""
    # Uses the PDF_MARKDOWN_CACHE_DIR defined globally in this module
    h = hashlib.sha256(pdf_file.encode()).hexdigest()
    return PDF_MARKDOWN_CACHE_DIR / f"{h}.md"


def _exponential_backoff(retries: int, base_delay: float = 1.0, max_delay: float = 60.0) -> Generator[
    float, None, None]:
    """Generator for exponential backoff delays."""
    for i in range(retries):
        delay = min(base_delay * (2 ** i) + (np.random.rand() * base_delay), max_delay)
        yield delay
# Adjust this import path based on your Zotero class location
#
# # Use the constants for environment variable names
# library_id = os.getenv(ZOTERO_LIBRARY_ID_ENV_VAR)
# api_key = os.getenv(ZOTERO_API_KEY_ENV_VAR)
# library_type = os.getenv(ZOTERO_LIBRARY_TYPE_ENV_VAR)
#
# if library_id and api_key and library_type:
#     try:
#         zot = Zotero(library_id=library_id, api_key=api_key, library_type=library_type)
#         ZOTERO_CLASS_AVAILABLE = True
#         logging.info("Zotero class loaded and instance created successfully in data_processing.")
#     except Exception as e_zot_init:
#         logging.error(f"Failed to initialize Zotero class in data_processing: {e_zot_init}")
#         zot = None


# zot=Zotero(
# library_id = library_id,
#     api_key=api_key,
#     library_type =library_type,
#
#     chat_args=chat_args,
#     os="win",
#     sleep=71*3
#
#
# )

def _normalize_text_for_ocr_check(text: str) -> str:
    """Basic normalization to help decide if text is 'empty' enough for OCR."""
    if not text: return ""
    # Remove common PDF artifacts or very short non-alphanumeric lines
    lines = text.splitlines()
    meaningful_lines = [
        line.strip() for line in lines
        if len(line.strip()) > 10 and any(c.isalpha() for c in line)
    ]
    return "\n".join(meaningful_lines)

def parse_zotero_year(date_str: str | None) -> int | None:
    if not date_str or not isinstance(date_str, str):
        return None
    current_year = datetime.datetime.now().year
    min_year = 1800
    max_year = current_year + 5  # Allow for a bit of future dating

    numeric_years_found = []
    # Regex to find 4-digit numbers that look like years
    # \b ensures it's a whole word/number
    for match in re.finditer(r'\b(\d{4})\b', date_str):
        try:
            year = int(match.group(1))
            if min_year <= year <= max_year:
                numeric_years_found.append(year)
        except ValueError:
            continue
    if numeric_years_found:
        return max(numeric_years_found)  # Return the latest plausible year

    # Fallback: Try dateutil.parser for more complex date strings
    try:
        # fuzzy=False is stricter, default is a non-sensical date to catch if only month/day is parsed
        parsed_date = dateutil_parser.parse(date_str, fuzzy=False, default=datetime.datetime(1, 1, 1))
        year = parsed_date.year
        if min_year <= year <= max_year:
            return year
    except (ValueError, OverflowError, TypeError, dateutil_parser.ParserError):  # Catch specific parser errors
        pass  # Parsing failed
    except Exception as e:  # Catch any other unexpected errors from dateutil
        logging.warning(f"Unexpected error using dateutil.parser on '{date_str}': {e}")
        pass
    return None

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
# In data_processing.py

def clear_cache_for_collection(collection_name: str, cache_dir: Path) -> tuple[bool, str]:
    """
    Deletes the specific cache file associated with a given collection name.
    """
    if not cache_dir.exists():
        return False, "Cache directory does not exist."

    # Use the SINGLE SOURCE OF TRUTH to find the exact file to delete
    file_to_delete = get_zotero_cache_filepath(collection_name, cache_dir)
    logging.info(f"Attempting to clear cache file: {file_to_delete}")

    if not file_to_delete.exists():
        return False, f"No cache file found for collection '{collection_name or 'All Items'}'.\nExpected at: {file_to_delete}"

    try:
        file_to_delete.unlink()
        message = f"Successfully deleted cache file for collection '{collection_name or 'All Items'}'."
        logging.info(message)
        return True, message
    except Exception as e:
        error_message = f"An error occurred while deleting cache file: {e}"
        logging.error(error_message, exc_info=True)
        return False, error_message
def format_authors_list(creators_list: list | None) -> list[str]:
    authors = []
    if not creators_list: return authors
    for c in creators_list:
        if isinstance(c, dict) and c.get('creatorType') == 'author':
            last = c.get('lastName', '').strip()
            first = c.get('firstName', '').strip()
            if last and first:
                authors.append(f"{last}, {first[0]}.")  # "LastName, F."
            elif last:
                authors.append(last)
            elif first:
                authors.append(first)  # Less common but handle
    return authors


def format_authors_short(creators_list: list | None) -> str:
    if not creators_list: return "N/A"
    authors_std = format_authors_list(creators_list)  # Get standardized list
    if not authors_std: return "N/A"
    return authors_std[0] if len(authors_std) == 1 else f"{authors_std[0]} et al."


def format_authors_html(creators_list: list | None) -> str:  # For display
    if not creators_list: return "N/A"
    authors_fmt = []
    for c in creators_list:
        if isinstance(c, dict) and c.get('creatorType') in ['author', 'editor']:
            last = c.get('lastName', '').strip()
            first = c.get('firstName', '').strip()
            name = f"{last}, {first}" if last and first else last or first
            if name: authors_fmt.append(html.escape(name))  # Escape for HTML
    return "; ".join(authors_fmt) if authors_fmt else "N/A"

def get_tags(tags_list):
    if not tags_list: return []
    tags = [t.get('tag', '').strip().lower() for t in tags_list if t.get('tag')]
    # Increased filtering
    tags = [t for t in tags if t and t not in ['edited', '#nosource', 'toread', 'important', 'note_complete', 'external-pdf', 'pdf', 'from_scopus', 'from_wos']]
    return tags

def get_source_title(data):
    return (data.get('publicationTitle') or data.get('conferenceName') or
            data.get('bookTitle') or data.get('university') or data.get('publisher') or "N/A")

def get_document_type(item_type):
    mapping = {'journalArticle': 'Journal Article', 'conferencePaper': 'Conference Paper', 'report': 'Report', 'thesis': 'Thesis', 'bookSection': 'Book Section', 'book': 'Book', 'note': 'Note', 'attachment': 'Attachment', 'webpage': 'Web Page', 'blogPost': 'Blog Post'}
    return mapping.get(item_type, str(item_type).capitalize())

def parse_country(place_str):
    if not place_str or not isinstance(place_str, str): return None
    common_countries = {'usa', 'uk', 'united states', 'united kingdom', 'germany', 'france', 'china', 'japan', 'india', 'canada', 'australia', 'netherlands', 'switzerland', 'sweden', 'norway', 'denmark', 'italy', 'spain', 'brazil', 'russia', 'estonia', 'ukraine'}
    common_us_states = {'ny', 'ca', 'ma', 'il', 'tx', 'pa', 'fl', 'dc', 'wa', 'ga'}
    parts = [p.strip() for p in place_str.split(',')]
    for i in range(len(parts) - 1, -1, -1):
        potential_country = parts[i]; potential_country_lower = potential_country.lower()
        if potential_country_lower in common_us_states or potential_country_lower in ['city', 'town']: continue
        if potential_country_lower in common_countries: return potential_country.capitalize()
        if len(potential_country) > 3 and not any(char.isdigit() for char in potential_country):
             if 'press' not in potential_country_lower and 'verlag' not in potential_country_lower: return potential_country
    if len(parts) == 1:
         potential_country = parts[0]; potential_country_lower = potential_country.lower()
         if potential_country_lower in common_countries: return potential_country.capitalize()
         if len(potential_country) > 3 and not any(char.isdigit() for char in potential_country) and potential_country_lower not in common_us_states:
              if 'press' not in potential_country_lower and 'verlag' not in potential_country_lower: return potential_country
    return None

def parse_affiliation(data):
    affiliation = data.get('institution')
    if affiliation and isinstance(affiliation, str) and affiliation.strip(): return affiliation.strip()
    publisher = data.get('publisher')
    if publisher and isinstance(publisher, str):
        pub_lower = publisher.lower()
        academic_keywords = ['university', 'institute', 'polytechnic', 'college', 'ecole', 'universidad', 'universitat', 'hochschule', 'cern', 'nato', 'rand']
        if any(keyword in pub_lower for keyword in academic_keywords): return publisher.strip()
    university = data.get('university')
    if university and isinstance(university, str) and university.strip(): return university.strip()
    return None

def parse_funding(data):
    # Basic placeholder - requires specific regex for your 'extra' field format
    extra_str = data.get('extra', '')
    if extra_str and isinstance(extra_str, str):
        # Look for patterns like "Funding: Sponsor Name", "Funded by Sponsor", etc.
        match = re.search(r'(?:Funding|Funded by|Grant from|Sponsored by)\s*:?\s*([A-Z][A-Za-z\s&\-]+(?:Foundation|Institute|Council|Agency|Department|Ministry|University|Corporation|Center)?)\b', extra_str)
        if match:
            sponsor = match.group(1).strip()
            # Avoid matching overly generic terms if possible
            if sponsor.lower() not in ['the author', 'internal funds', 'university', 'institute']:
                 # Limit length
                 return sponsor[:70] + ('...' if len(sponsor) > 70 else '')
    return None



def process_zotero_data(items, target_language="en"):
    """
    Processes a list of Zotero items, filtering for specific types and valid years,
    extracting relevant metadata, and calculating preliminary statistics.
    Prints reasons for items filtered *within this function*.

    Args:
        items (list): List of Zotero item dictionaries.
        target_language (str): Target language (currently used only for lang counts).

    Returns:
        tuple: (pd.DataFrame, dict)
               - DataFrame containing processed records for analysis.
               - Dictionary containing preliminary results (counts, distributions).
    """
    processed_records = []
    doc_type_counts = Counter()
    language_counts = Counter()
    total_docs_found = 0
    analyzed_keys = set() # Track keys processed in this run to avoid duplicates if input has them

    print("Processing Zotero items (filter messages may appear below):") # Info message

    for item in items:
        total_docs_found += 1 # Count every item passed in
        data = item.get('data', {})
        if not data: # Skip if data block is missing entirely
            print(f"  [Filter] Skipping Item (No Key Available): Missing 'data' block.")
            continue

        item_key = data.get('key', 'N/A') # Get key early for logging
        item_type = data.get('itemType')

        # --- Preliminary Counts (done for all items) ---
        doc_type_counts[get_document_type(item_type) or 'Unknown'] += 1 # Use helper, handle None
        lang_code = str(data.get('language', '')).lower()[:2] if data.get('language') else 'unknown'
        lang_display = data.get('language', 'Unknown').capitalize() if len(data.get('language', '')) > 3 else lang_code.upper() if lang_code != 'unknown' else 'Unknown'
        language_counts[lang_display] += 1

        # --- Filters for Detailed Analysis ---

        # 1. Filter by Item Type
        # *** ADDED 'preprint' to the list ***
        analysis_item_types = ['journalArticle', 'conferencePaper', 'report', 'thesis', 'book', 'bookSection', 'preprint']
        if item_type not in analysis_item_types:
            # *** PRINTING excluded item type ***
            print(f"  [Filter] Skipping Item Key={item_key}: Type '{item_type}' not in analysis types ({analysis_item_types}).")
            continue # Skip to next item

        # 2. Filter by Parsable Year
        original_date_str = data.get('date', 'N/A') # Get original date for logging
        year = parse_zotero_year(original_date_str)
        if year is None:
            # *** PRINTING excluded item due to year ***
            print(f"  [Filter] Skipping Item Key={item_key}: Could not parse valid year from date '{original_date_str}'.")
            continue # Skip to next item

        # 3. Filter for Duplicate Keys (within this processing run)
        if item_key in analyzed_keys:
            # *** PRINTING excluded item due to being duplicate in this run ***
            print(f"  [Filter] Skipping Item Key={item_key}: Already analyzed in this batch.")
            continue # Skip to next item
        if item_key != 'N/A': # Only add valid keys
             analyzed_keys.add(item_key)

        # --- Item Passed Filters - Proceed with detailed extraction ---
        citations = parse_citation_count(data.get('extra'))
        creators = data.get('creators', [])
        authors_short = format_authors_short(creators)
        authors_list = format_authors_list(creators) # Standardized names for network/counts
        authors_html = format_authors_html(creators) # Full names for display
        tags = get_tags(data.get('tags'))
        source_title = get_source_title(data)
        title = data.get('title', 'N/A')
        doi = data.get('DOI', '')
        url = data.get('url', '')
        abstract = data.get('abstractNote', '')
        country = parse_country(data.get('place'))
        affiliation = parse_affiliation(data) # Assuming this function exists
        funding_sponsor = parse_funding(data) # Assuming this function exists

        # Extract other potentially useful fields
        volume = data.get('volume', '')
        issue = data.get('issue', '')
        pages = data.get('pages', '')
        publisher = data.get('publisher', '')
        place = data.get('place', '') # Can be different from country (e.g., city)
        book_title = data.get('bookTitle', '') # Relevant for bookSection

        # Combine title and abstract for text analysis
        title_abstract_text = f"{title or ''} {abstract or ''}".strip()

        processed_records.append({
            'key': item_key,
            'title': title,
            'year': year,
            'authors_short': authors_short,
            'authors_list': authors_list,
            'authors_html': authors_html,
            'source': source_title,
            'controlled_vocabulary_terms': tags,
            'doi': doi,
            'url': url,
            'citations': citations,
            'item_type': item_type,
            'doc_type_readable': get_document_type(item_type), # Assuming helper exists
            'abstract': abstract,
            'country': country,
            'affiliation': affiliation,
            'funding_sponsor': funding_sponsor,
            'title_abstract_text': title_abstract_text,
            'volume': volume,
            'issue': issue,
            'pages': pages,
            'publisher': publisher,
            'place': place, # Specific place/city
            'bookTitle': book_title, # For book chapters
        })
    # --- End of Loop ---

    # Create DataFrame from records that passed filters
    df = pd.DataFrame(processed_records)
    if not df.empty:
        # Ensure year is integer type if possible
        try:
            df['year'] = df['year'].astype(int)
        except ValueError:
             logging.warning("Could not convert 'year' column to integer.")


    # Prepare preliminary stats DataFrames
    prelim_doc_types_df = pd.DataFrame(doc_type_counts.items(), columns=['Document Type', 'Count']).sort_values('Count', ascending=False).reset_index(drop=True)
    prelim_lang_df = pd.DataFrame(language_counts.items(), columns=['Language', 'Count']).sort_values('Count', ascending=False).reset_index(drop=True)

    # Prepare results dictionary
    preliminary_results = {
        "total_docs_found": total_docs_found,          # Total items passed INTO this function
        "analyzed_docs_count": len(df),                # Count of items that PASSED filters and are in the DF
        "doc_type_distribution": prelim_doc_types_df,  # Based on ALL items passed in
        "language_distribution": prelim_lang_df        # Based on ALL items passed in
    }
    return df, preliminary_results


def filter_zotero_for_prompt(df, limit=3, sort_by='year_citations'):
    """
    Filters DataFrame to get key, title, abstract for prompt context.
    Sorts by 'year_citations' (recent, then cited) or 'citations'.
    Returns as string.
    """
    if df.empty:
        return "No item data available."

    sample_df = df.copy()
    # Ensure necessary columns exist
    if 'year' not in sample_df.columns: sample_df['year'] = 0
    if 'citations' not in sample_df.columns: sample_df['citations'] = 0

    # Sort based on request
    if sort_by == 'citations':
        sample_df = sample_df.sort_values('citations', ascending=False)
    else: # Default to 'year_citations'
        sample_df = sample_df.sort_values(['year', 'citations'], ascending=[False, False])

    sample_df = sample_df.head(limit)

    output_lines = ["Sample Item Data (Key | Title | Abstract Snippet):"]
    for _, row in sample_df.iterrows():
        title = row.get('title', 'N/A')
        abstract = row.get('abstract', '')
        key = row.get('key', 'N/A')
        abstract_snippet = (abstract[:150] + '...') if abstract and len(abstract) > 150 else abstract or '[No Abstract]'
        # Clean title/abstract snippets slightly
        title_snippet = title.replace('\n', ' ').strip()[:80] + ('...' if len(title)>80 else '')
        abstract_snippet = abstract_snippet.replace('\n', ' ').strip()
        output_lines.append(f"- {key} | {title_snippet} | {abstract_snippet}")

    return "\n".join(output_lines)



def format_reference_html(row):
    """ Formats a DataFrame row into a standard bibliographic HTML string (APA-like). """
    try:
        ref_parts = []

        # Authors (Last, F. M.; Last2, F. ...)
        authors_html = row.get('authors_html', 'N/A')
        ref_parts.append(f"<strong>{authors_html}</strong>")

        # Year
        year = int(row.get('year', 0))
        ref_parts.append(f"({year}).") if year else ref_parts.append("(n.d.).")

        # Title (Sentence case for articles/chapters, Title Case for Books/Reports)
        title = row.get('title', '')
        item_type = row.get('item_type', '')
        if title:
            if item_type in ['book', 'report', 'thesis']:
                # Keep title case for standalone works
                ref_parts.append(f"<em>{title}.</em>")
            else:
                # Sentence case (approximate - keeps original casing but ends with period)
                ref_parts.append(f"{title.strip().rstrip('.')}.")

        # Source Information
        source = row.get('source', '')
        volume = row.get('volume', '')
        issue = row.get('issue', '')
        pages = row.get('pages', '')
        publisher = row.get('publisher', '')
        place = row.get('place', '') # Use sparingly, often just publisher is needed
        book_title = row.get('bookTitle', '')

        source_info = ""
        if item_type == 'journalArticle' and source != 'N/A':
            source_info = f"<em>{source}</em>"
            if volume: source_info += f", <em>{volume}</em>"
            if issue: source_info += f"({issue})"
            if pages: source_info += f", {pages}"
            source_info += "."
        elif item_type == 'conferencePaper' and source != 'N/A':
            # Format: Paper presented at the Conference Name, Location.
            source_info = f"Paper presented at the <em>{source}</em>"
            if place: source_info += f", {place}"
            source_info += "."
        elif item_type == 'bookSection':
            # Format: In Editor, A. A. (Ed.), *Book title* (pp. pages). Publisher.
            # Simplified: In *Book Title* (pp. pages). Publisher.
            editor_html = format_authors_html(row.get('editors', [])) # Assumes editors might be parsed
            book_title_to_use = book_title or source # Use bookTitle if available, else source
            if book_title_to_use != 'N/A':
                 source_info = "In "
                 # Add editors if available (requires parsing editors into creators list with type 'editor')
                 # if editor_html != 'N/A': source_info += f"{editor_html} (Ed.), "
                 source_info += f"<em>{book_title_to_use}</em>"
                 if pages: source_info += f" (pp. {pages})"
                 source_info += "."
            if publisher: source_info += f" {publisher}."

        elif item_type in ['book', 'report', 'thesis'] and source != 'N/A':
             # Title already added. Add publisher.
             if publisher and publisher != source: # Avoid repeating if publisher is in source title
                 source_info = f"{publisher}."
             elif not publisher and source != title: # Use source only if different from title and no publisher
                 source_info = f"{source}."

        # Append source info if generated
        if source_info:
             ref_parts.append(source_info)

        # DOI/URL
        doi = row.get('doi', '')
        url = row.get('url', '')
        if doi:
            ref_parts.append(f'<a href="https://doi.org/{doi}" target="_blank">https://doi.org/{doi}</a>')
        elif url:
             ref_parts.append(f'Retrieved from <a href="{url}" target="_blank">{url}</a>')

        # Citation count note (Optional, maybe remove for formal look)
        citations = row.get('citations', 0)
        # if citations and pd.notna(citations) and int(citations) > 0:
        #      ref_parts.append(f"(Cited approx. {int(citations)} times in source db)")

        return " ".join(filter(None, ref_parts)) # Join non-empty parts

    except Exception as e:
        print(f"Error formatting reference for key {row.get('key', 'N/A')}: {e}")
        return f"<strong>{row.get('authors_html', 'N/A')}</strong> ({int(row.get('year', 0))}). <em>{row.get('title', '[Title N/A]')}</em>. [Formatting Error]"
# --- HTML Table Generation ---
def create_html_table(df, title="", index_label="#", add_rank_col=True):
    if isinstance(df, pd.Series):
        df = df.reset_index()
        if len(df.columns) == 2: df.columns = ['Item', 'Count']
        else: df.columns = [f'Col_{i}' for i in range(len(df.columns))]
    if df.empty: return f"<p><i>No data available for {title}.</i></p>"
    df_display = df.copy()
    if add_rank_col and index_label not in df_display.columns:
        df_display.insert(0, index_label, range(1, len(df_display) + 1))
    if index_label in df_display.columns: df_display = df_display.set_index(index_label)
    for col in df_display.columns:
        # Check if column exists before processing
        if col not in df_display.columns: continue
        if df_display[col].dtype == 'object' or pd.api.types.is_string_dtype(df_display[col]):
             if col == 'doi':
                 df_display[col] = df_display[col].apply(lambda x: f'<a href="https://doi.org/{x}" target="_blank">{x}</a>' if pd.notna(x) and x else '')
             elif col in ['title', 'source', 'Item', 'authors_short', 'Document Type', 'Language']: # Adjusted col names
                 df_display[col] = df_display[col].astype(str).str.slice(0, 80) + '...'
    html = df_display.to_html(escape=False, classes='data-table', border=0)
    table_title_html = f"<h4>{title}</h4>" if title else ""
    return f"{table_title_html}{html}"
# --- Helper Function to Get AI Response Text ---
def get_ai_response_text(response_dict, section_name):
    """ Safely extracts and formats AI response text or returns error message. """
    if isinstance(response_dict, dict) and "response" in response_dict:
        text = response_dict["response"]
        text = text.replace('\n\n', '<br><br>').replace('\n', '<br>')
        text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text) # Bold
        text = re.sub(r'^\s*[\*-]\s+', '<br>• ', text, flags=re.MULTILINE) # Lists
        return text.strip()
    else:
        error = response_dict.get('error', 'Unknown error') if isinstance(response_dict, dict) else 'Invalid response format'
        print(f"Warning: Failed to generate AI content for {section_name}: {error}")
        return f"<p><i>[AI content generation failed for {section_name}: {error}]</i></p>"




def _parse_custom_fields_from_extra(extra_string: str) -> dict:
    """Parses specific custom fields from a Zotero 'extra' field string."""

    # Initialize with default empty values
    custom_data = {
        'framework_model': '',
        'contribution_type': '',
        'methodology': '',
        'methods': '',
        'controlled_vocabulary_terms': ''
    }

    if not isinstance(extra_string, str):
        return custom_data

    # A simple parser that looks for key:value pairs
    for line in extra_string.split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            key = key.strip().lower()
            value = value.strip()

            if key == 'framework model':
                custom_data['framework_model'] = value
            elif key == 'contribution type':
                custom_data['contribution_type'] = value
            elif key == 'methodology':
                custom_data['methodology'] = value
            elif key == 'methods':
                custom_data['methods'] = value
            elif key == 'topic phrases':
                custom_data['controlled_vocabulary_terms'] = value

    return custom_data
#
#
# def get_tags(tags_list: list | None) -> list[str]:
#     if not tags_list: return []
#     processed_tags = []
#     excluded_tags = {'edited', '#nosource', 'toread', 'important', 'note_complete',
#                      'external-pdf', 'pdf', 'from_scopus', 'from_wos', '_tablet', 'unread'}
#     for t_entry in tags_list:
#         if isinstance(t_entry, dict) and 'tag' in t_entry and isinstance(t_entry['tag'], str):
#             tag_val = t_entry['tag'].strip().lower()
#             if tag_val and tag_val not in excluded_tags:
#                 processed_tags.append(tag_val)
#     return list(set(processed_tags))  # Return unique tags
#
#
# def get_source_title(data: dict | None) -> str:
#     if not data: return "N/A"
#     return (data.get('publicationTitle') or
#             data.get('conferenceName') or
#             data.get('bookTitle') or
#             data.get('university') or
#             data.get('publisher') or "N/A")
#
#
# def get_document_type(item_type: str | None) -> str:
#     if not item_type: return "Unknown"
#     mapping = {
#         'journalArticle': 'Journal Article', 'conferencePaper': 'Conference Paper',
#         'report': 'Report', 'thesis': 'Thesis', 'bookSection': 'Book Section',
#         'book': 'Book', 'preprint': 'Preprint', 'webpage': 'Web Page',
#         'manuscript': 'Manuscript', 'patent': 'Patent', 'note': 'Note',
#         'attachment': 'Attachment', 'blogPost': 'Blog Post',
#         'presentation': 'Presentation', 'map': 'Map', 'interview': 'Interview',
#         'film': 'Film', 'artwork': 'Artwork', 'letter': 'Letter',
#         'computerProgram': 'Software'
#     }
#     return mapping.get(item_type, str(item_type).replace('_', ' ').title())
def _parse_extra_field(extra_string: str) -> dict:
    """
    Parses a Zotero 'extra' field string into a dictionary of key-value pairs,
    creating a key for every field in the defined map.
    """
    # Define a complete mapping from all expected keys (lowercase) to standardized column names
    key_map = {
        'institution': 'institution',
        'country': 'country',
        'funding': 'funding',
        'theoretical orientation': 'framework_model',
        'level of analysis': 'level_of_analysis',
        'argumentation logic': 'argumentation_logic',
        'evidence source base': 'evidence_source_base',
        'methodology': 'methodology',
        'methods': 'methods',
        'framework model': 'framework_model',
        'contribution type': 'contribution_type',
        'attribution lens focus': 'attribution_lens_focus',
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

def normalise_country_cell(cell) -> str:
    """
    ➜ Input  : any type (string/list/None)
    ➜ Output : canonical names joined with ‘; ’
               (e.g.  'United States; United Kingdom')
    """
    if pd.isna(cell) or (isinstance(cell, str) and not cell.strip()):
        return ""

    parts = cell if isinstance(cell, list) else re.split(r"\s*[;,]\s*", str(cell))
    seen, result = set(), []
    for raw in parts:
        if not isinstance(raw, str) or not raw.strip():
            continue
        key = re.sub(r"\s+", " ", raw.strip().lower())
        canon = COUNTRY_SYNONYM_MAP.get(key, raw.strip().title())
        if canon not in seen:
            seen.add(canon)
            result.append(canon)

    return "; ".join(result)

def continents_from_cell(cell) -> str:
    """
    Accepts the raw “country” cell (string / list / NaN) → returns
    a canonical, deduplicated ‘; ’-separated string of continents.
    """
    from_country = normalise_country_cell(cell)  # <-- uses the function you already added
    if not from_country:
        return ""

    continents_seen, out = set(), []
    for ctry in from_country.split(";"):
        c = ctry.strip()
        cont = COUNTRY_TO_CONTINENT.get(c)
        if cont and cont not in continents_seen:
            continents_seen.add(cont)
            out.append(cont)

    return "; ".join(out)

# ---------------------------------------------------------------------------
# 4.  Apply to your dataframe
# ---------------------------------------------------------------------------
def apply_continent_column(df: pd.DataFrame,
                           country_col: str = "country",
                           new_col: str = "continent") -> pd.DataFrame:
    """
    Adds df[new_col] containing the normalised continent list.
    Keeps the dataframe copy-safe.
    """
    if country_col in df.columns:
        df = df.copy()
        df[new_col] = df[country_col].apply(continents_from_cell)
    return df


# ─────────────────────────────────────────────────────────────────────────────
# 1.  Canonical dictionaries  (extend freely)
# ─────────────────────────────────────────────────────────────────────────────
     # ← or keep them in this file


# ---------------------------------------------------------------------------
def _normalise_cell(raw_value: any, mapping: dict[str, str]) -> str:
    """
    • Accepts single values or `;` / `,` delimited strings.
    • Returns the **canonical** value (for single items) *or*
      a `; `-joined list of unique canonical values (for multi-items).
    """
    if pd.isna(raw_value):
        return ""

    # Produce a list of candidate tokens
    if isinstance(raw_value, list):
        tokens = raw_value
    else:
        tokens = re.split(r"\s*[;,]\s*", str(raw_value))

    canon_set = {
        mapping.get(tok.strip().lower(), tok.strip().title())
        for tok in tokens if tok and str(tok).strip()
    }
    return "; ".join(sorted(canon_set))


# ---------------------------------------------------------------------------
def normalise_df_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    *Single entry-point* to standardise:
        • country   → COUNTRY_SYNONYM_MAP ➜ adds 'continent'
        • institution, publisher, funding, item_type
    It mutates the dataframe **in-place** and returns it for chaining.
    """
    if df.empty:
        return df

    # 1) COUNTRY -------------------------------------------------------------
    if "country" in df.columns:
        df["country"] = df["country"].apply(
            lambda x: _normalise_cell(x, COUNTRY_SYNONYM_MAP)
        )

        # Add / overwrite CONTINENT column
        def _cell_to_continent(cell: str) -> str:
            return "; ".join(sorted({
                COUNTRY_TO_CONTINENT.get(c.strip(), "Other")
                for c in re.split(r"\s*;\s*", cell) if c
            }))
        df["continent"] = df["country"].apply(_cell_to_continent)

    # 2) INSTITUTION ---------------------------------------------------------
    if "institution" in df.columns:
        df["institution"] = df["institution"].apply(
            lambda x: _normalise_cell(x, INSTITUTION_SYNONYM_MAP)
        )

    # 3) PUBLISHER -----------------------------------------------------------
    if "publisher" in df.columns:
        df["publisher"] = df["publisher"].apply(
            lambda x: _normalise_cell(x, PUBLISHER_SYNONYM_MAP)
        )

    # 4) FUNDING -------------------------------------------------------------
    if "funding" in df.columns:
        df["funding"] = df["funding"].apply(
            lambda x: _normalise_cell(x, FUNDER_SYNONYM_MAP)
        )

    # 5) ITEM-TYPE -----------------------------------------------------------
    if "item_type" in df.columns:
        df["item_type"] = df["item_type"].apply(
            lambda x: _normalise_cell(x, ITEMTYPE_SYNONYM_MAP)
        )

    return df

# ---------------------------------------------------------------------------
# 3.  Convenience helper for data-frames
# ---------------------------------------------------------------------------
def apply_country_normalisation(df: pd.DataFrame, col: str = "country") -> pd.DataFrame:
    if col in df:
        df = df.copy()
        df[col] = df[col].apply(normalise_country_cell)
    return df


def get_zotero_cache_filepath(collection_name: str, cache_dir: Path) -> Path:
    """
    Generates the consistent, versioned cache filepath for a Zotero collection.
    This is the single source of truth for cache filenames.
    """
    safe_collection_name = re.sub(r'[^\w\-]+', '_', collection_name) if collection_name else "_all_items_"

    # This version string MUST be kept in sync. If you change data processing,
    # increment this version to invalidate old caches.
    cache_version = "v5"  # As per your log file
    cache_filename = f"zotero_data_rich_{cache_version}_{safe_collection_name}.pkl"

    return cache_dir / cache_filename




def generate_themes_from_items(
    df: pd.DataFrame,
    *,
    ai_provider_key: Optional[str] = None,
    model_api_name: Optional[str] = None,
    batch_size: int = 40,
    use_cache: bool = False,
    progress_callback: Optional[Callable[[str], None]] = None,
    results_so_far: Optional[dict] = None,
) -> pd.DataFrame:
    """
    Generate thematic labels for items in a DataFrame using an LLM in a two-phase batch flow:
    Phase A: enqueue requests (store_only=True, read=False)
    Phase B: read results (read=True) or inline fallback if batch fails

    Requirements:
      - df must contain at least: key, title, abstract, item_type, authors, year
      - Adds/updates columns: 'themes' (semicolon-joined), 'primary_theme' (single label)

    Returns:
      Updated DataFrame (never None; fail-soft with empty columns on errors).
    """
    import hashlib

    import json

    import os

    from typing import List, Tuple, Dict, Any

    # ─────────────────────────────────────────────────────────────────────────

    STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS = "AI:GeneralKeywordThemes"

    # ─────────────────────────────────────────────────────────────────────────
    # Local helpers
    # ─────────────────────────────────────────────────────────────────────────
    def _cb(msg: str) -> None:
        if progress_callback:
            try:
                progress_callback(msg)
            except Exception:
                pass
        logging.info(msg)

    def _safe_str(v) -> str:
        try:
            if v is None or (isinstance(v, float) and pd.isna(v)):
                return ""
            return str(v)
        except Exception:
            return ""

    def _display_doc_type(s: str) -> str:
        t = (_safe_str(s) or "").strip()
        return t.title() if t else "Document"

    def _row_to_item(r) -> str:
        import html as _html
        authors_val = r.get("authors")
        if isinstance(authors_val, list):
            authors_str = "; ".join([_safe_str(a) for a in authors_val if _safe_str(a)])
        else:
            authors_str = _safe_str(authors_val)
        first_author_raw = (authors_str.split(";")[0].strip() if authors_str else "")
        if "," in first_author_raw:
            surname = first_author_raw.split(",")[0].strip()
        else:
            toks = first_author_raw.split()
            surname = toks[-1].strip() if toks else "N.d."
        year_safe = _safe_str(r.get("year")).strip() or "n.d."
        intext_cite = f"({surname}, {year_safe})"
        key = _safe_str(r.get("key"))
        title = _safe_str(r.get("title"))
        doc_type = _display_doc_type(_safe_str(r.get("item_type")))
        abstract = _safe_str(r.get("abstract"))
        anchor = (
            f'<a href="{_html.escape(key)}" '
            f'data-key="{_html.escape(key)}" '
            f'data-bib="{_html.escape(intext_cite)}" '
            f'data-title="{_html.escape(title)}" '
            f'data-doc="{_html.escape(doc_type)}">{_html.escape(intext_cite)}</a>'
        )
        return f"<p>{_html.escape(abstract)} {anchor}</p>"

    def _needs_themes_column(_df: pd.DataFrame) -> bool:
        if "themes" not in _df.columns:
            return True
        if _df["themes"].empty:
            return True
        try:
            non_empty = _df["themes"].apply(lambda x: bool(_safe_str(x).strip())).sum()
            return non_empty == 0
        except Exception:
            return True

    # ─────────────────────────────────────────────────────────────────────────
    # Guards and setup
    # ─────────────────────────────────────────────────────────────────────────
    if df is None or df.empty:
        return df if df is not None else pd.DataFrame()

    if "themes" not in df.columns:
        df["themes"] = ""
    if "primary_theme" not in df.columns:
        df["primary_theme"] = ""

    # Only process rows lacking themes
    mask = ~df.get("themes", pd.Series([""] * len(df))).astype(str).str.strip().astype(bool)
    pending_df = df[mask].copy()
    if pending_df.empty:
        _cb("[themes] No items require theme generation.")
        return df

    # Model defaults
    ai_provider_key = ai_provider_key or os.getenv("AI_PROVIDER_KEY", "openai")
    model_api_name = model_api_name or os.getenv("MODEL_API_NAME", "gpt-5-nano")
    analysis_key_suffix = "generate_themes"
    section_title = STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS
    cons_max_t = 6000
    cons_effort = "high"

    # Build items (key, html)
    items: List[Tuple[str, str]] = []
    for _, row in pending_df.iterrows():
        k = _safe_str(row.get("key"))
        if not k:
            continue
        items.append((k, _row_to_item(row)))

    if not items:
        _cb("[themes] No valid items with keys.")
        return df

    # Chunk
    def _chunks(seq, n):
        for i in range(0, len(seq), n):
            yield seq[i:i + n]

    batches = list(_chunks(items, max(1, int(batch_size))))
    _cb(f"[themes] Prepared {len(batches)} batches (size≈{batch_size}).")

    # JSON schema for LLM output
    json_schema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string"},
                        "primary_theme": {"type": "string"},
                        "themes": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 1,
                            "maxItems": 5
                        }
                    },
                    "required": ["key", "primary_theme", "themes"]
                }
            }
        },
        "required": ["results"],
        "additionalProperties": False,
        "description": "Return thematic labels for each item."
    }

    def _make_prompt(batch_pairs: List[Tuple[str, str]]) -> str:
        intro = (
            "Task: Assign concise thematic labels to each item using title/abstract.\n"
            "Return ONLY JSON matching the schema provided. Do not include prose.\n"
            "Guidelines:\n"
            "• Provide 1–5 short themes per item and a single primary_theme.\n"
            "• Use stable IR/cyber-policy labels (e.g., 'state responsibility', 'deterrence', 'APT campaigns', 'critical infrastructure protection', 'zero-knowledge proofs', 'evidentiary standards').\n"
            "• No author names, venues, or years in the theme text.\n\n"
            "Input items (HTML with anchors):\n"
        )
        parts = []
        for key, html_item in batch_pairs:
            parts.append(f"---\nKEY={key}\n{html_item}\n")
        return intro + "\n".join(parts)

    # Phase A: enqueue all batches
    for idx, batch in enumerate(batches, start=1):
        prompt_text = _make_prompt(batch)
        h = hashlib.md5((prompt_text + str(idx)).encode("utf-8")).hexdigest()[:10]
        custom_id = f"gen_themes:{idx}:{h}"
        _ = call_models(
            ai_provider_key=ai_provider_key,
            model_api_name=model_api_name,
            prompt_text=prompt_text,
            analysis_key_suffix=analysis_key_suffix,
            max_tokens=cons_max_t,
            base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir") if results_so_far else None,
            use_cache=use_cache,
            store_only=True,
            read=False,
            section_title=section_title,
            custom_id=custom_id,
            results_so_far=None,
            effort=cons_effort,
        )

    # Submit and poll the batch once for this section/analysis
    ok = False
    try:
        _cb("[themes] Submitting and polling batch…")
        ok = bool(_process_batch_for(
            analysis_key_suffix=analysis_key_suffix,
            section_title=section_title,
            completion_window="24h",
            poll_interval=15,
        ))
    except Exception as e_proc:
        _cb(f"[themes] WARNING: batch processing failed: {e_proc}")

    # Phase B: read each batch (or inline fallback)
    theme_map: Dict[str, Dict[str, Any]] = {}
    for idx, batch in enumerate(batches, start=1):
        prompt_text = _make_prompt(batch)
        h = hashlib.md5((prompt_text + str(idx)).encode("utf-8")).hexdigest()[:10]
        custom_id = f"gen_themes:{idx}:{h}"
        pkg = call_models(
            ai_provider_key=ai_provider_key,
            model_api_name=model_api_name,
            prompt_text=prompt_text,
            analysis_key_suffix=analysis_key_suffix,
            max_tokens=cons_max_t,
            base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir") if results_so_far else None,
            use_cache=use_cache,
            store_only=False,
            read=True if ok else False,
            section_title=section_title,
            custom_id=custom_id,
            results_so_far=results_so_far,
            effort=cons_effort,
        )
        raw = (pkg or {}).get("raw_text") or ""
        try:
            obj = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            obj = None

        results = (obj or {}).get("results") if isinstance(obj, dict) else None
        if isinstance(results, list):
            for entry in results:
                try:
                    k = _safe_str(entry.get("key"))
                    pr = _safe_str(entry.get("primary_theme"))
                    th = entry.get("themes") if isinstance(entry.get("themes"), list) else []
                    th = [t.strip() for t in th if _safe_str(t).strip()]
                    if k:
                        theme_map[k] = {
                            "primary_theme": pr if pr else (th[0] if th else ""),
                            "themes": th
                        }
                except Exception:
                    continue

    # Attach to DataFrame
    if theme_map:
        def _join_themes(k: str) -> str:
            rec = theme_map.get(_safe_str(k)) or {}
            lst = rec.get("themes") or []
            return "; ".join(lst) if lst else ""

        def _primary(k: str) -> str:
            rec = theme_map.get(_safe_str(k)) or {}
            return _safe_str(rec.get("primary_theme"))

        df.loc[pending_df.index, "themes"] = pending_df.get("key", "").map(_join_themes).values
        df.loc[pending_df.index, "primary_theme"] = pending_df.get("key", "").map(_primary).values
    else:
        _cb("[themes] No LLM results parsed; leaving themes empty.")

    return df
#


def analyze_authors_detailed_plotly(df, progress_callback=None,
                                    top_n_authors_to_plot: int = 15,
                                    plot_type: str = "bar_vertical"):  # Default plot type
    def _callback(msg):
        if progress_callback: progress_callback(msg)
        logging.info(msg)

    _callback(
        f"Starting author productivity analysis for top {top_n_authors_to_plot} authors (plot: {plot_type})...")

    # Ensure 'authors' column exists and contains semicolon-separated strings
    if df is None or df.empty or "authors" not in df.columns or df["authors"].isnull().all():
        _callback("Author data (semicolon-separated string list) not found or empty.")
        return pd.DataFrame(columns=["Author", "Count"]), None

    author_list_flat = []
    authors_series = df["authors"].dropna().astype(str)  # Ensure string type
    for authors_str_entry in authors_series:
        # Split by semicolon and strip whitespace
        authors_in_entry = [a.strip() for a in authors_str_entry.split(";") if a.strip()]
        author_list_flat.extend(authors_in_entry)

    if not author_list_flat:
        _callback("No authors found after parsing semicolon-separated strings.")
        return pd.DataFrame(columns=["Author", "Count"]), None

    author_counts = Counter(author_list_flat)
    # Create DataFrame of all authors and their counts
    results_df = pd.DataFrame(author_counts.items(), columns=["Author", "Count"]).sort_values(
        by=["Count", "Author"], ascending=[False, True]  # Sort by count, then author name for tie-breaking
    ).reset_index(drop=True)

    if results_df.empty:
        _callback("Author analysis (all authors) resulted in an empty data frame.")
        return results_df, None  # Return the empty full results

    if not results_df.empty:
        _callback(
            f"Top author overall: {results_df.iloc[0]['Author']} with {results_df.iloc[0]['Count']} publications.")

    # Data for the plot: top N authors
    plot_df = results_df.head(top_n_authors_to_plot)

    if plot_df.empty:
        _callback(f"No data to plot for top {top_n_authors_to_plot} authors after filtering.")
        # Create a placeholder figure if plot_df is empty but results_df is not
        fig_placeholder = go.Figure()
        fig_placeholder.add_annotation(text=f"No authors meet criteria for top {top_n_authors_to_plot} plot.",
                                       xref="paper", yref="paper", showarrow=False, font=dict(size=14))
        fig_placeholder.update_layout(xaxis_visible=False, yaxis_visible=False)
        return results_df, fig_placeholder  # Return full results and placeholder plot

    _callback(
        f"Generating author productivity chart type '{plot_type}' for top {len(plot_df)} authors...")

    fig = None
    try:
        if plot_type == "bar_vertical":
            fig = px.bar(plot_df, x='Author', y='Count',
                         title=f'Top {len(plot_df)} Most Productive Authors',
                         labels={'Author': 'Author', 'Count': 'Number of Publications'},
                         text_auto=True,  # Show values on bars
                         color='Count', color_continuous_scale=px.colors.sequential.Teal)
            fig.update_traces(textposition='outside')
            fig.update_xaxes(categoryorder='total descending')

        elif plot_type == "bar_horizontal":
            # For horizontal bar, it's often better to have y as Author and x as Count
            fig = px.bar(plot_df.sort_values('Count', ascending=True),  # Sort ascending for horizontal
                         y='Author', x='Count', orientation='h',
                         title=f'Top {len(plot_df)} Most Productive Authors',
                         labels={'Author': 'Author', 'Count': 'Number of Publications'},
                         text_auto=True,
                         color='Count', color_continuous_scale=px.colors.sequential.Mint)
            fig.update_layout(yaxis_categoryorder='total ascending')  # Match sort

        elif plot_type == "pie_chart":
            fig = px.pie(plot_df, names='Author', values='Count',
                         title=f'Publication Share of Top {len(plot_df)} Authors',
                         hole=0.3)  # Donut chart
            fig.update_traces(textposition='inside', textinfo='percent+label',
                              pull=[0.05] * len(plot_df))  # Explode slices slightly

        elif plot_type == "treemap":
            fig = px.treemap(plot_df, path=[px.Constant(f"Top {len(plot_df)} Authors"), 'Author'], values='Count',
                             title=f'Productivity Treemap of Top {len(plot_df)} Authors',
                             color='Count', color_continuous_scale='Blues',
                             hover_data={'Count': ':.0f'})  # Custom hover format
            fig.update_layout(margin=dict(t=60, l=25, r=25, b=25))
            fig.data[0].textinfo = 'label+value+percent parent'

        # Common figure updates (theming will be applied by AnalysisSubPageWidget)
        if fig:
            _callback(f"Successfully generated '{plot_type}' chart for authors.")
        else:
            _callback(f"Plot type '{plot_type}' not recognized or failed to generate for authors.")
            fig = go.Figure()  # Create a blank figure
            fig.add_annotation(text=f"Plot type '{plot_type}' could not be generated.",
                               xref="paper", yref="paper", showarrow=False, font=dict(size=14))
            fig.update_layout(xaxis_visible=False, yaxis_visible=False)


    except Exception as e:
        _callback(f"Error creating Plotly '{plot_type}' chart for authors: {e}")
        logging.error(f"Plotly author chart error ({plot_type})", exc_info=True)
        fig = go.Figure()  # Create a blank figure on error
        fig.add_annotation(text=f"Error generating plot: {e}",
                           xref="paper", yref="paper", showarrow=False, font=dict(size=14))
        fig.update_layout(xaxis_visible=False, yaxis_visible=False)

    _callback(f"Author productivity analysis ({plot_type}) complete.")
    # Return the full results_df (all authors and their counts) and the generated figure
    return results_df, fig


def analyze_keywords_detailed_plotly(df, progress_callback=None, top_n_to_plot: int = 20):  # Added param
    def _callback(msg):
        if progress_callback: progress_callback(msg)
        logging.info(msg)

    _callback("Starting keyword analysis...")
    if df is None or df.empty or "controlled_vocabulary_terms" not in df.columns or df["controlled_vocabulary_terms"].isnull().all():
        _callback("Keyword data not found or empty.")
        return pd.DataFrame(columns=["Keyword", "Count"]), None

    keyword_list_flat = []
    # The 'controlled_vocabulary_terms' column should now be a list of strings per row
    # or a semicolon-separated string for older data formats.

    # Drop rows where 'controlled_vocabulary_terms' is NaN or an empty list/string BEFORE iterating
    keywords_series = df["controlled_vocabulary_terms"].dropna()
    keywords_series = keywords_series[keywords_series.apply(lambda x: bool(x))]  # Filter out empty lists/strings

    for keywords_entry in keywords_series:
        if isinstance(keywords_entry, list):
            keyword_list_flat.extend([k.strip().lower() for k in keywords_entry if isinstance(k, str) and k.strip()])
        elif isinstance(keywords_entry, str):  # Fallback for semicolon-separated strings
            keyword_list_flat.extend([k.strip().lower() for k in keywords_entry.split(";") if k.strip()])
        # else: ignore other types

    if not keyword_list_flat:
        _callback("No keywords found after parsing.")
        return pd.DataFrame(columns=["Keyword", "Count"]), None

    _callback(f"Counting occurrences for {len(set(keyword_list_flat))} unique keywords...")
    keyword_counts = Counter(keyword_list_flat)
    results_df = pd.DataFrame(keyword_counts.items(), columns=["Keyword", "Count"]).sort_values(
        by="Count", ascending=False
    ).reset_index(drop=True)

    if results_df.empty:
        _callback("Keyword analysis resulted in empty data frame.")
        return results_df, None

    _callback(f"Top keyword: '{results_df.iloc[0]['Keyword']}' with {results_df.iloc[0]['Count']} occurrences.")

    fig_df = results_df.head(top_n_to_plot)
    _callback(f"Generating keyword frequency chart for top {len(fig_df)} keywords (Plotly)...")
    fig = None
    if not fig_df.empty:
        try:
            fig = px.bar(fig_df, x='Keyword', y='Count',
                         title=f'Top {len(fig_df)} Most Frequent Keywords',
                         labels={'Keyword': 'Keyword', 'Count': 'Frequency'},
                         color='Count',
                         color_continuous_scale=px.colors.sequential.Oranges)
            # Theming will be applied by AnalysisSubPageWidget
        except Exception as e:
            _callback(f"Error creating Plotly chart for keywords: {e}")
            logging.error("Plotly keyword chart error", exc_info=True)
            fig = None
    else:
        _callback(f"No data to plot for top {top_n_to_plot} keywords.")

    _callback("Keyword analysis complete.")
    return results_df, fig


def analyze_citations_data_plotly(df, progress_callback=None):
    def _callback(msg):
        if progress_callback: progress_callback(msg)

    _callback("Starting citation analysis...");
    citation_field_name = 'citations';
    fig = None
    results_df = pd.DataFrame(columns=["Title", "Authors", "Year", "Citation Count"]);
    df_to_use = df.copy()  # Start with a copy

    if citation_field_name not in df_to_use.columns or df_to_use[citation_field_name].isnull().all():
        _callback(f"'{citation_field_name}' column not found or all values are null. Trying 'extra' field parse.")
        if 'extra' in df_to_use.columns and df_to_use['extra'].notna().any():
            # df_temp = df.copy() # Not needed if df_to_use is already a copy
            df_to_use['parsed_citations_temp'] = df_to_use['extra'].astype(str).str.extract(
                r'(?:Cited by|Citations):\s*(\d+)', flags=re.IGNORECASE).iloc[:, 0]
            df_to_use['parsed_citations_temp'] = pd.to_numeric(df_to_use['parsed_citations_temp'], errors='coerce')

            if df_to_use['parsed_citations_temp'].notna().any():
                citation_field_name = 'parsed_citations_temp'
                _callback("Using parsed citations from 'extra' field.")
            else:
                _callback("Could not parse numeric citation counts from 'extra' field.");
                return results_df, fig
        else:
            _callback("No usable citation data field found ('citations' or 'extra').");
            return results_df, fig
    else:
        df_to_use[citation_field_name] = pd.to_numeric(df_to_use[citation_field_name], errors='coerce')
        if df_to_use[citation_field_name].isnull().all():
            _callback(f"All values in '{citation_field_name}' column are non-numeric after conversion.");
            return results_df, fig

    cited_docs = df_to_use[df_to_use[citation_field_name].notna() & (df_to_use[citation_field_name] > 0)].copy()
    if not cited_docs.empty:
        cited_docs.loc[:, citation_field_name] = cited_docs[citation_field_name].astype(int)
        cited_docs = cited_docs.sort_values(by=citation_field_name, ascending=False)
        required_cols = ['title', 'authors', 'year', citation_field_name]
        for r_col in required_cols:  # Ensure columns exist before selection
            if r_col not in cited_docs.columns: cited_docs[r_col] = "N/A" if r_col != citation_field_name else 0
        results_df = cited_docs[required_cols].rename(columns={citation_field_name: 'Citation Count'}).head(20)

    if results_df.empty: _callback("No documents with positive citation counts found."); return results_df, fig

    _callback(f"Identified {len(results_df)} highly cited documents.");
    _callback("Generating citation distribution chart (Plotly)...")
    if not results_df.empty:
        try:
            fig = px.bar(results_df, x='title', y='Citation Count', title='Top Cited Documents',
                         hover_data=['authors', 'year'],
                         labels={'title': 'Document Title', 'Citation Count': 'Citations'}, color='Citation Count',
                         color_continuous_scale=px.colors.sequential.Viridis);
            fig.update_xaxes(categoryorder="total descending", tickangle=-30, automargin=True, title_standoff=25,
                             showgrid=False);
            fig.update_yaxes(showgrid=True, gridwidth=0.5, gridcolor='rgba(128,128,128,0.5)');
            fig.update_layout(showlegend=False, title_x=0.5, height=max(500, 35 * len(results_df)),
                              paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)', font=dict(color='#E0E0E0'));
            fig.update_traces(texttemplate='%{y}', textposition='outside')
        except Exception as e:
            _callback(f"Error creating Plotly chart for citations: {e}"); fig = None
    _callback("Citation analysis complete.");
    return results_df, fig


def generate_network_graph_detailed_plotly(df, type="authors", progress_callback=None,
                                           results_so_far=None):  # Added results_so_far for potential future use, though not used in current logic
    def _callback(msg):
        if progress_callback: progress_callback(msg)
        logging.info(msg)  # Ensure logging for this function

    _callback(f"Generating {type} network graph (Plotly)...")

    # Prepare the return structure
    return_package = {"figure": None, "keyword_clusters_data": None}

    if df is None or df.empty:
        _callback("DataFrame is empty for network graph.")
        return return_package

    G = nx.Graph()
    nodes_added_count = 0
    edges_added_count = 0

    # Helper to add nodes and edges
    def _add_to_graph(item1, item2):
        nonlocal nodes_added_count, edges_added_count
        # Ensure items are strings for graph nodes
        item1_str = str(item1)
        item2_str = str(item2)
        if item1_str not in G: G.add_node(item1_str); nodes_added_count += 1
        if item2_str not in G: G.add_node(item2_str); nodes_added_count += 1
        if G.has_edge(item1_str, item2_str):
            G[item1_str][item2_str]['weight'] += 1
        else:
            G.add_edge(item1_str, item2_str, weight=1);
            edges_added_count += 1

    if type == "authors":
        if "authors" not in df.columns or df["authors"].notna().sum() == 0:
            _callback("No 'authors' data for co-authorship network.");
            return return_package
        _callback("Processing co-authorship links...");
        time.sleep(0.1)
        for authors_str in df["authors"].dropna().astype(str):
            authors = [a.strip() for a in authors_str.split(";") if a.strip() and len(a) > 1]
            if len(authors) >= 2:
                for author1, author2 in itertools.combinations(authors, 2): _add_to_graph(author1, author2)
        _callback(f"Processed {nodes_added_count} author nodes and {edges_added_count} co-authorship links.")

    elif type == "controlled_vocabulary_terms":
        if "controlled_vocabulary_terms" not in df.columns or df["controlled_vocabulary_terms"].notna().sum() == 0:
            _callback("No 'controlled_vocabulary_terms' data for co-occurrence network.");
            return return_package
        _callback("Processing keyword co-occurrence links...");
        time.sleep(0.1)
        for keywords_str in df["controlled_vocabulary_terms"].dropna().astype(str):
            keywords = [k.strip().lower() for k in keywords_str.split(";") if k.strip() and len(k) > 1]
            if len(keywords) >= 2:
                for keyword1, keyword2 in itertools.combinations(keywords, 2): _add_to_graph(keyword1, keyword2)
        _callback(f"Processed {nodes_added_count} keyword nodes and {edges_added_count} co-occurrence links.")

        # --- Community Detection for Keywords ---
        current_keyword_clusters_data = {"clusters": [],
                                         "summary_text": "No distinct keyword clusters identified or graph too small."}
        if G.number_of_nodes() > 5 and G.number_of_edges() > 0:
            try:
                # Using label propagation as it doesn't require external libraries and is relatively fast.
                # Louvain (`nx.community.louvain_communities`) might yield better results but needs `python-louvain`.
                communities_generator = nx.community.label_propagation_communities(G)
                communities = [list(c) for c in communities_generator]
                _callback(f"Identified {len(communities)} keyword communities using Label Propagation.")

                cluster_details_list = []
                summary_text_parts = ["Key Keyword Clusters Identified:"]

                communities.sort(key=len, reverse=True)  # Sort by size
                num_clusters_to_detail = min(len(communities), 7)  # Detail top 7 largest

                for i, community_nodes in enumerate(communities[:num_clusters_to_detail]):
                    if len(community_nodes) >= 3:
                        community_keywords_degrees = {node: G.degree(node, weight='weight') for node in community_nodes}
                        sorted_community_keywords = sorted(community_keywords_degrees.items(), key=lambda item: item[1],
                                                           reverse=True)
                        top_keywords_in_cluster = [kw[0] for kw in sorted_community_keywords[:5]]

                        cluster_name = f"Cluster {i + 1}"
                        cluster_details_list.append({
                            "name": cluster_name,
                            "controlled_vocabulary_terms": top_keywords_in_cluster,
                            "all_nodes_in_community": list(community_nodes),
                            "size": len(community_nodes)
                        })
                        summary_text_parts.append(
                            f"- {cluster_name} (Size: {len(community_nodes)}): {', '.join(top_keywords_in_cluster)}")

                if cluster_details_list:
                    current_keyword_clusters_data["clusters"] = cluster_details_list
                    current_keyword_clusters_data["summary_text"] = "\n".join(summary_text_parts)
                else:
                    _callback("No significant keyword clusters meeting criteria were identified after sorting.")
                return_package["keyword_clusters_data"] = current_keyword_clusters_data  # Store it
            except Exception as e:
                _callback(f"Error during keyword community detection: {e}")
                logging.error(f"Keyword community detection error: {e}\n{traceback.format_exc()}")
        # --- End of Community Detection ---

    elif type == "citations":
        _callback("Conceptual citation network - not directly built.");
        return return_package
    else:
        _callback(f"Invalid network type '{type}' or missing required column.");
        return return_package

    if G.number_of_nodes() == 0:
        _callback(f"No nodes found for {type} network. Cannot generate graph.")
        return return_package

    _callback(f"Visualizing {type} network: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges...");
    time.sleep(0.2)

    MAX_NODES_PLOTLY = 75
    G_viz = G
    if G.number_of_nodes() > MAX_NODES_PLOTLY:
        _callback(
            f"Network large ({G.number_of_nodes()} nodes), filtering to top {MAX_NODES_PLOTLY} by degree for visualization.")
        top_nodes_by_degree = sorted(G.degree(weight='weight'), key=lambda x: x[1], reverse=True)[:MAX_NODES_PLOTLY]
        G_viz = G.subgraph([n[0] for n in top_nodes_by_degree]).copy()  # Use .copy()
        G_viz.remove_nodes_from(list(nx.isolates(G_viz)))
        if G_viz.number_of_nodes() == 0:
            _callback("No nodes left after filtering for network display.")
            return_package["figure"] = None  # Explicitly set fig to None
            return return_package

    if G_viz.number_of_nodes() > 0:
        try:
            # Check for connectivity before Kamada-Kawai
            is_connected_for_layout = G_viz.number_of_nodes() <= 1 or nx.is_connected(G_viz)
            if G_viz.number_of_nodes() < 150 and is_connected_for_layout:
                pos = nx.kamada_kawai_layout(G_viz)
            else:
                if not is_connected_for_layout and G_viz.number_of_nodes() < 150:
                    _callback("Graph for Kamada-Kawai not connected, using Spring layout.")
                pos = nx.spring_layout(G_viz,
                                       k=0.8 / ((G_viz.number_of_nodes()) ** 0.5 if G_viz.number_of_nodes() > 0 else 1),
                                       iterations=35, seed=42)

            edge_x, edge_y = [], [];
            for edge in G_viz.edges(): x0, y0 = pos[edge[0]]; x1, y1 = pos[edge[1]]; edge_x.extend(
                [x0, x1, None]); edge_y.extend([y0, y1, None])
            edge_trace = go.Scatter(x=edge_x, y=edge_y, line=dict(width=0.7, color='#666'), hoverinfo='none',
                                    mode='lines');

            node_x, node_y, node_text, node_size_data, node_hover_text, node_color_data = [], [], [], [], [], []
            degrees = dict(G_viz.degree(weight='weight'))

            degree_values = sorted([d for n, d in degrees.items()], reverse=True)
            label_degree_threshold = 0
            if len(degree_values) > 10:
                label_degree_threshold = degree_values[min(9, len(degree_values) - 1)]
            elif len(degree_values) > 0:
                label_degree_threshold = degree_values[-1]  # Show all if few nodes

            for node in G_viz.nodes():
                x, y = pos[node];
                node_x.append(x);
                node_y.append(y)
                node_label = str(node);
                node_degree = degrees.get(node, 0)
                node_hover_text.append(f"{html.escape(node_label)}<br>Degree: {node_degree}")  # Escape hover text
                if node_degree >= label_degree_threshold or G_viz.number_of_nodes() <= 20:
                    node_text.append(html.escape(node_label))
                else:
                    node_text.append('')
                node_size_data.append(6 + node_degree * 1.5)
                node_color_data.append(node_degree)

            node_trace = go.Scatter(x=node_x, y=node_y, mode='markers+text', hoverinfo='text', text=node_text,
                                    hovertext=node_hover_text, textposition="top center",
                                    marker=dict(showscale=True, colorscale='YlGnBu', reversescale=False,
                                                color=node_color_data, size=node_size_data,
                                                colorbar=dict(thickness=10, title='Node Degree (Weighted)',
                                                              xanchor='left'),
                                                line_width=0.8, line_color="#bbb"))

            fig = go.Figure(data=[edge_trace, node_trace], layout=go.Layout(
                title=f'<br>{type.capitalize()} Network ({G_viz.number_of_nodes()} Nodes, {G_viz.number_of_edges()} Edges Shown)',
                showlegend=False, hovermode='closest',
                margin=dict(b=10, l=5, r=5, t=40), xaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
                yaxis=dict(showgrid=False, zeroline=False, showticklabels=False), paper_bgcolor='rgba(0,0,0,0)',
                plot_bgcolor='rgba(0,0,0,0)', font=dict(color='#E0E0E0')))
            _callback(f"{type.capitalize()} network graph (Plotly) generated for visualization.")
            return_package["figure"] = fig  # Assign to the return package
        except Exception as e:
            _callback(f"Error creating Plotly network for {type}: {e}");
            logging.error(f"Plotly network error for {type}", exc_info=True)
            return_package["figure"] = None
    else:
        _callback(f"No nodes remaining for {type} network visualization after filtering.")
        return_package["figure"] = None

    return return_package

# ── ai_services.py ─────────────────────────────────────────────
def _summarise_doc_types(df: pd.DataFrame) -> str:
    """
    Return a short, human-readable multi-line string such as
        Articles: 21  (61.8%)
        Conference Papers: 8  (23.5%)
        Book Chapters: 3  (8.8%)
        Other: 2  (5.9%)
    """
    if df.empty or 'item_type' not in df.columns:
        return "Distribution of document types unavailable."

    counts = df['item_type'].fillna("Unknown").value_counts()
    total  = counts.sum()
    lines  = [
        f"{it.title().replace('_', ' ')}: {cnt}  ({cnt/total:.1%})"
        for it, cnt in counts.items()
    ]
    return "\n".join(lines)

def _plot_doc_types_bar(df: pd.DataFrame, cb):
    """Simple per-type count bar chart when 'doc types' is checked in Document Structure."""
    import plotly.express as px
    if not isinstance(df, pd.DataFrame) or df.empty:
        cb("No data for Document Types plot.")
        return None
    # Accept either 'item_type' or a few common alternates
    for col in ("item_type", "document_type", "doc_type", "type"):
        if col in df.columns:
            counts = (df[col].astype(str).str.strip().replace({"": pd.NA})
                      .dropna().value_counts().reset_index())
            counts.columns = ["Document Type", "Count"]
            if counts.empty:
                cb("No non-empty values for document types.")
                return None
            fig = px.bar(counts, x="Document Type", y="Count", title="Document Types Distribution")
            fig.update_layout(margin=dict(l=10, r=10, t=40, b=10), height=420)
            return fig
    cb("No document-type column found (expected one of: item_type, document_type, doc_type, type).")
    return None
# def generate_timeline_detailed_plotly(df, progress_callback=None):
#     def _callback(msg):
#         if progress_callback: progress_callback(msg)
#
#     _callback("Generating publication timeline (Plotly)...");
#     if df is None or "year" not in df.columns or df.empty: _callback(
#         "Year data not found or DataFrame empty."); return None
#     fig = None
#     try:
#         time.sleep(0.1);
#         df_copy = df.copy();
#         df_copy['year_numeric'] = pd.to_numeric(df_copy["year"], errors='coerce');
#         years_series = df_copy['year_numeric'].dropna().astype(int)
#         if years_series.empty: _callback("No valid numeric year data found."); return None
#         year_counts = years_series.value_counts().sort_index();
#         if not year_counts.empty:
#             _callback(f"Found publications across {len(year_counts)} years.")
#         else:
#             _callback("No year counts to plot."); return None
#         time.sleep(0.2)
#         fig = px.bar(year_counts, x=year_counts.index, y=year_counts.values, title='Publications by Year',
#                      labels={'x': 'Year', 'index': 'Year', 'y': 'Number of Publications',
#                              'value': 'Number of Publications'}, color=year_counts.values,
#                      color_continuous_scale=px.colors.sequential.Mint);
#         fig.update_layout(xaxis_type='category', title_x=0.5, paper_bgcolor='rgba(0,0,0,0)',
#                           plot_bgcolor='rgba(0,0,0,0)', font=dict(color='#E0E0E0'));
#         fig.update_xaxes(showgrid=False);
#         fig.update_yaxes(showgrid=True, gridwidth=0.5, gridcolor='rgba(128,128,128,0.5)')
#         _callback("Publication timeline (Plotly) generated.")
#     except Exception as e:
#         _callback(f"Error generating Plotly timeline: {e}"); logging.error("Plotly timeline error",
#                                                                            exc_info=True); fig = None
#     return fig



def generate_timeline_detailed_plotly(df, progress_callback=None):
    """
    Build a visible, dark-theme bar chart of publications per year.

    Input expectation:
      • df is a pandas.DataFrame with a 'year' column (any dtype).
        Non-numeric values are coerced to NaN, then dropped.

    Returns:
      • plotly.graph_objs.Figure on success
      • None only when 'year' exists but contains no usable numeric values

    Failure policy:
      • Invalid inputs (None, not a DataFrame, missing 'year') raise loudly.
      • No try/except. If something else fails, let it break.
    """
    import time
    import pandas as pd
    import plotly.graph_objects as go

    def _cb(msg: str) -> None:
        if progress_callback:
            progress_callback(msg)

    _cb("Generating publication timeline (Plotly)…")

    # --- Hard guards (fail fast) ---
    if df is None:
        raise ValueError("generate_timeline_detailed_plotly: df is None")
    if not hasattr(df, "columns"):
        raise TypeError("generate_timeline_detailed_plotly: df is not a pandas DataFrame-like object")
    if "year" not in df.columns:
        raise KeyError("generate_timeline_detailed_plotly: column 'year' not found in DataFrame")
    if df.empty:
        raise ValueError("generate_timeline_detailed_plotly: DataFrame is empty")

    # --- Normalise year ---
    time.sleep(0.05)  # tiny UX breathing room for progress messages
    df_copy = df.copy()
    df_copy["year_numeric"] = pd.to_numeric(df_copy["year"], errors="coerce")
    years = df_copy["year_numeric"].dropna().astype(int)

    if years.empty:
        _cb("No valid numeric year data found in 'year'.")
        return None

    # --- Counts per year (sorted) ---
    year_counts = years.value_counts().sort_index()
    if year_counts.empty:
        _cb("No year counts to plot.")
        return None

    _cb(f"Found publications across {len(year_counts)} years.")

    # Fill gaps so missing years render as zero-height bars
    idx_min = int(year_counts.index.min())
    idx_max = int(year_counts.index.max())
    full_index = list(range(idx_min, idx_max + 1))
    counts_aligned = [int(year_counts.get(y, 0)) for y in full_index]

    time.sleep(0.05)

    # --- Build figure (explicit go.Bar; robust in embedded WebEngine) ---
    fig = go.Figure()
    fig.add_bar(
        x=full_index,
        y=counts_aligned,
        name="Publications",
        marker=dict(color="#4e79a7"),  # visible on dark background
        hovertemplate="Year=%{x}<br>Publications=%{y}<extra></extra>",
    )
    fig.update_layout(
        title=dict(text="Publications by Year", x=0.02, xanchor="left"),
        margin=dict(l=56, r=24, t=36, b=48),
        paper_bgcolor="#1e1e1e",
        plot_bgcolor="#1e1e1e",
        font=dict(color="#E0E0E0"),
        showlegend=False,
        bargap=0.15,
    )
    # Force categorical x so every year shows as a bar; grid lines readable on dark
    fig.update_xaxes(title="Year", gridcolor="#333", tickmode="auto", type="category")
    fig.update_yaxes(title="Number of Publications", gridcolor="#333", rangemode="tozero")

    _cb("Publication timeline (Plotly) generated.")
    return fig

def analyze_publication_trends(df_processed: pd.DataFrame) -> pd.Series:
    if df_processed.empty or 'year' not in df_processed.columns: return pd.Series(dtype=int)
    # Ensure 'year' is numeric and integer, handling potential errors
    years_numeric = pd.to_numeric(df_processed['year'], errors='coerce').dropna().astype(int)
    return years_numeric.value_counts().sort_index()


def analyze_top_list(df: pd.DataFrame, column_name: str, top_n: int = TOP_N_DEFAULT,
                     is_list_column: bool = False) -> pd.Series:
    if df.empty or column_name not in df.columns or df[column_name].isnull().all():
        return pd.Series(dtype=object)  # Return empty series of object type if no data

    if is_list_column:  # e.g. 'authors_list' or 'controlled_vocabulary_terms' if it's a list of strings per row
        # Explode the list column to count individual items
        all_items = df.explode(column_name).dropna(subset=[column_name])
        # Filter out empty strings or NaN equivalents after explode
        all_items = all_items[all_items[column_name].apply(lambda x: isinstance(x, str) and x.strip() != '')]
        if all_items.empty: return pd.Series(dtype=object)
        return all_items[column_name].value_counts().head(top_n)
    else:  # For simple columns
        # Ensure values are strings before dropna/value_counts if it's an object column
        if df[column_name].dtype == 'object':
            counts_series = df[column_name].astype(str).str.strip().dropna()
            counts_series = counts_series[counts_series != ''].value_counts()  # Filter out empty strings
        else:  # For numeric or other types that don't need string conversion first
            counts_series = df[column_name].dropna().value_counts()
        return counts_series.head(top_n)


def analyze_most_cited_authors_plotly(df: pd.DataFrame, params: dict, progress_callback=None):
    def _callback(msg):
        if progress_callback: progress_callback(msg)
        logging.info(msg)

    _callback("Starting Most Cited Authors analysis...")

    # Ensure 'authors' is the semicolon-separated string here
    required_cols = ['authors', 'citations', 'year', 'title']
    if df is None or df.empty or not all(col in df.columns for col in required_cols):
        missing = [col for col in required_cols if col not in df.columns]
        _callback(f"DataFrame is empty or missing required columns for Most Cited Authors: {missing}")
        return pd.DataFrame(), None

    df_analysis = df.copy()
    df_analysis['citations'] = pd.to_numeric(df_analysis['citations'], errors='coerce').fillna(0).astype(int)
    df_analysis['year'] = pd.to_numeric(df_analysis['year'], errors='coerce').astype('Int64')  # Allow NA for year

    # --- Calculate metrics per author ---
    author_total_citations = defaultdict(int)
    author_publication_counts = defaultdict(int)
    # Store detailed info: list of (citations, year) tuples for each paper by an author
    author_papers_citation_year = defaultdict(list)

    for _, row in df_analysis.iterrows():
        # Ensure row['authors'] is a string before splitting
        authors_in_doc = [a.strip() for a in str(row.get('authors', '')).split(';') if a.strip()]
        citations_for_doc = row['citations']
        doc_year = row['year']  # This is pd.Int64Dtype, can be pd.NA
        doc_title = str(row.get('title', 'N/A'))

        for author in authors_in_doc:
            author_total_citations[author] += citations_for_doc
            author_publication_counts[author] += 1
            if pd.notna(doc_year):  # Only include if year is known for time-based plots
                author_papers_citation_year[author].append({
                    'citations': citations_for_doc,
                    'year': int(doc_year),  # Convert to int for calculations
                    'title': doc_title
                })

    authors_summary_list = []
    for author, total_cites in author_total_citations.items():
        num_pubs = author_publication_counts[author]
        avg_cites = total_cites / num_pubs if num_pubs > 0 else 0

        # Get top cited document info for this author
        top_doc_title = "N/A"
        top_doc_citations = 0
        if author_papers_citation_year[author]:  # If there are papers with year info
            sorted_papers = sorted(author_papers_citation_year[author], key=lambda x: x['citations'], reverse=True)
            if sorted_papers:
                top_doc_title = sorted_papers[0]['title']
                top_doc_citations = sorted_papers[0]['citations']

        authors_summary_list.append({
            "Author": author,
            "TotalCitations": total_cites,
            "Publications": num_pubs,
            "AvgCitationsPerPub": round(avg_cites, 2),
            "TopCitedDocTitle": top_doc_title,  # From papers with known year
            "TopCitedDocCitations": top_doc_citations
        })

    if not authors_summary_list:
        _callback("No authors found or no citations to analyze.")
        return pd.DataFrame(columns=["Author", "TotalCitations", "Publications", "AvgCitationsPerPub"]), None

    results_df = pd.DataFrame(authors_summary_list)
    results_df = results_df.sort_values(by="TotalCitations", ascending=False).reset_index(drop=True)

    # --- Plotting ---
    plot_type = params.get("plot_type", "total_citations_bar")
    top_n_plot = params.get("top_n_for_plot", 10)

    plot_data_df_authors = results_df.head(top_n_plot)  # Top N authors for most plots
    fig = None
    _callback(f"Generating plot: {plot_type} for top {len(plot_data_df_authors)} authors.")

    if plot_data_df_authors.empty and plot_type not in [
        "author_citation_trajectory"]:  # Trajectory might pick one author
        _callback(f"No data to plot for top {top_n_plot} cited authors.")
        fig_placeholder = go.Figure()
        fig_placeholder.add_annotation(text=f"No authors meet criteria for top {top_n_plot} plot.",
                                       xref="paper", yref="paper", showarrow=False, font=dict(size=14))
        return results_df, fig_placeholder

    if plot_type == "total_citations_bar":
        fig = px.bar(plot_data_df_authors, x="Author", y="TotalCitations",
                     title=f"Top {len(plot_data_df_authors)} Authors by Total Citations",
                     labels={"TotalCitations": "Total Citations"},
                     hover_data=["Publications", "AvgCitationsPerPub"],
                     color="TotalCitations", color_continuous_scale=px.colors.sequential.Plasma,
                     text_auto=True)
        fig.update_traces(textposition='outside')
        fig.update_xaxes(categoryorder="total descending")

    elif plot_type == "avg_citations_bar":
        plot_data_avg = plot_data_df_authors.sort_values(by="AvgCitationsPerPub", ascending=False)
        fig = px.bar(plot_data_avg, x="Author", y="AvgCitationsPerPub",
                     title=f"Top {len(plot_data_avg)} Authors by Avg. Citations per Publication",
                     labels={"AvgCitationsPerPub": "Avg. Citations / Publication"},
                     hover_data=["TotalCitations", "Publications"],
                     color="AvgCitationsPerPub", color_continuous_scale=px.colors.sequential.Viridis,
                     text_auto=".2f")
        fig.update_traces(textposition='outside')
        fig.update_xaxes(categoryorder="total descending")
    elif plot_type == "citations_vs_pubs_scatter":
        fig = px.scatter(plot_data_df_authors, x="Publications", y="TotalCitations",
                         size="AvgCitationsPerPub", color="Author",
                         hover_name="Author",
                         hover_data={"Author": False, "Publications": True, "TotalCitations": True,
                                     "AvgCitationsPerPub": ':.2f'},
                         title=f"Citation Impact vs. Productivity (Top {len(plot_data_df_authors)} Authors)",
                         labels={"Publications": "Number of Publications", "TotalCitations": "Total Citations"},
                         marginal_y="box", marginal_x="box",
                         text="Author")  # Text will be available for the scatter trace points

        # Apply textposition and textfont_size ONLY to scatter traces
        fig.update_traces(
            selector=dict(type='scatter'),  # Selects only scatter traces
            textposition="top right",
            textfont_size=9
        )

    elif plot_type == "author_pub_citation_boxplot":
        # Show distribution of citations for each paper of the top N authors
        boxplot_data = []
        for author_name in plot_data_df_authors["Author"]:
            papers = author_papers_citation_year.get(author_name, [])
            for paper_info in papers:
                boxplot_data.append({"Author": author_name, "PaperCitations": paper_info['citations']})

        if boxplot_data:
            df_boxplot = pd.DataFrame(boxplot_data)
            # Order authors by their total citations for the box plot
            df_boxplot['Author'] = pd.Categorical(df_boxplot['Author'], categories=plot_data_df_authors["Author"],
                                                  ordered=True)
            df_boxplot.sort_values("Author", inplace=True)

            fig = px.box(df_boxplot, x="Author", y="PaperCitations",
                         title=f"Citation Distribution of Publications for Top {len(plot_data_df_authors)} Authors",
                         labels={"PaperCitations": "Citations per Publication"},
                         color="Author", points="outliers",
                         notched=False)  # Notched can be True if comparing medians
            fig.update_xaxes(tickangle=-25)  # Improve label readability
        else:
            _callback("Not enough paper citation data for author boxplot.")


    elif plot_type == "author_citation_trajectory":
        # For a specific author (e.g., the top one, or one selected via params if UI supports it)
        author_to_plot = params.get("trajectory_author_name",
                                    results_df["Author"].iloc[0] if not results_df.empty else None)

        if author_to_plot and author_papers_citation_year.get(author_to_plot):
            papers_of_author = author_papers_citation_year[author_to_plot]
            if papers_of_author:
                df_author_papers = pd.DataFrame(papers_of_author)
                df_author_papers = df_author_papers.sort_values(by="year")

                # Calculate cumulative citations based on publication year
                # This is a simplified view: sum of citations of papers published up to year X
                min_year_author = df_author_papers['year'].min()
                max_year_author = df_author_papers['year'].max()

                trajectory_data = []
                current_cumulative_citations = 0
                # Create a full year range for this author to have a continuous line
                if pd.notna(min_year_author) and pd.notna(max_year_author):
                    for year_point in range(int(min_year_author), int(max_year_author) + 1):
                        # Sum citations from all papers published in or before this year_point by this author
                        # This interpretation is "cumulative sum of citations FROM papers published up to this year"
                        # A different interpretation could be "cumulative sum of citations RECEIVED by this year for all their papers" - much harder

                        # Simpler: yearly sum of citations from papers published that year
                        # papers_in_year = df_author_papers[df_author_papers['year'] == year_point]
                        # citations_in_year = papers_in_year['citations'].sum()
                        # trajectory_data.append({'year': year_point, 'citations_gained_that_year': citations_in_year})

                        # Cumulative sum of publications and their citations by year of pub
                        current_pubs_df = df_author_papers[df_author_papers['year'] <= year_point]
                        cumulative_citations_by_pub_year = current_pubs_df['citations'].sum()
                        cumulative_pubs_by_pub_year = len(current_pubs_df)

                        trajectory_data.append({
                            'year': year_point,
                            'cumulative_citations_from_pubs_up_to_year': cumulative_citations_by_pub_year,
                            'cumulative_publications': cumulative_pubs_by_pub_year
                        })

                    if trajectory_data:
                        df_trajectory = pd.DataFrame(trajectory_data)
                        fig = px.line(df_trajectory, x="year", y="cumulative_citations_from_pubs_up_to_year",
                                      title=f"Citation Trajectory for {author_to_plot} (Based on Pub. Year)",
                                      labels={"cumulative_citations_from_pubs_up_to_year": "Cumulative Citations"},
                                      markers=True)
                        # Optional: Add secondary y-axis for cumulative publications
                        # fig.add_trace(go.Scatter(x=df_trajectory["year"], y=df_trajectory["cumulative_publications"],
                        #                          name="Cumulative Publications", yaxis="y2", mode="lines+markers"))
                        # fig.update_layout(yaxis2=dict(title="Cumulative Publications", overlaying="y", side="right"))
                        fig.update_layout(xaxis_type='category')

            else:
                _callback(f"No papers with citation/year data for author {author_to_plot} for trajectory.")
        else:
            _callback(f"Author '{author_to_plot}' not found or no data for trajectory.")

    if not fig:
        _callback(f"Plot type '{plot_type}' not implemented or failed for Most Cited Authors.")
        fig = go.Figure()
        fig.add_annotation(text=f"Plot type '{plot_type}' could not be generated for Most Cited Authors.",
                           xref="paper", yref="paper", showarrow=False, font=dict(size=12))
        fig.update_layout(xaxis_visible=False, yaxis_visible=False)  # Clean placeholder

    _callback("Most Cited Authors analysis complete.")
    return results_df, fig
def analyze_most_cited(df: pd.DataFrame, top_n: int = TOP_N_DEFAULT) -> pd.DataFrame:
    cols_expected = ['title', 'authors_short', 'year', 'source', 'citations', 'doi', 'key']
    if df.empty or 'citations' not in df.columns:
        return pd.DataFrame(columns=cols_expected)  # Return empty DataFrame with expected columns

    df_cited = df.copy()
    df_cited['citations'] = pd.to_numeric(df_cited['citations'], errors='coerce').fillna(0).astype(int)

    # Ensure all expected columns exist, add them with None if not, before sorting
    for col in cols_expected:
        if col not in df_cited.columns:
            df_cited[col] = None

    most_cited_df = df_cited.sort_values(by=['citations', 'year'], ascending=[False, False]).head(top_n)
    return most_cited_df[cols_expected]  # Select in defined order


# In data_processing.py
# Ensure pandas as pd and logging are imported.

def describe_trend_data(trends_series: pd.Series) -> str:
    if trends_series is None or trends_series.empty:
        return "No publication trend data available to describe."

    try:
        # Ensure index is sorted (years) and values are numeric
        trends_series = trends_series.sort_index()
        trends_series = pd.to_numeric(trends_series, errors='coerce')

        # Filter out NaN values that might result from coercion if input wasn't clean
        # and years where publications are zero, for certain stats (like active years)
        active_trends_series = trends_series[trends_series > 0].dropna()

        if active_trends_series.empty:
            return "No years with publication activity found in the provided trend data."

        # Overall statistics
        min_data_year = int(trends_series.index.min())
        max_data_year = int(trends_series.index.max())
        data_span_years = max_data_year - min_data_year + 1

        min_active_year = int(active_trends_series.index.min())
        max_active_year = int(active_trends_series.index.max())
        active_period_span_years = max_active_year - min_active_year + 1

        count_years_with_pubs = len(active_trends_series)
        total_pubs = int(trends_series.sum())  # Sum over all years, including zeros if they are part of the series

        avg_pubs_active = active_trends_series.mean() if count_years_with_pubs > 0 else 0
        median_pubs_active = int(active_trends_series.median()) if count_years_with_pubs > 0 else 0
        min_pubs_in_active_year = int(active_trends_series.min()) if count_years_with_pubs > 0 else 0
        max_pubs_in_active_year = int(active_trends_series.max()) if count_years_with_pubs > 0 else 0

        std_dev_pubs_active = active_trends_series.std() if count_years_with_pubs > 1 else 0  # Std dev needs >1 point

        peak_years_list = active_trends_series[active_trends_series == max_pubs_in_active_year].index.astype(
            str).tolist() if max_pubs_in_active_year > 0 else []
        peak_years_str = ', '.join(peak_years_list) if peak_years_list else "N/A"
        num_peak_years = len(peak_years_list)

        summary = [
            f"Overall Publication Timeline Analysis (Data Range: {min_data_year}-{max_data_year}, Active Range: {min_active_year}-{max_active_year}):",
            f"- The dataset spans {data_span_years} years, with publications recorded in {count_years_with_pubs} of these years.",
            f"- The primary period of publication activity is from {min_active_year} to {max_active_year} (a {active_period_span_years}-year span).",
            f"- Total Publications Recorded: {total_pubs}.",
            f"- For years with publications: Average Pubs/Year: {avg_pubs_active:.2f}, Median Pubs/Year: {median_pubs_active}.",
            f"- Publication counts in active years ranged from {min_pubs_in_active_year} to a maximum of {max_pubs_in_active_year} in a single year.",
            f"- Peak Activity: {max_pubs_in_active_year} publications in year(s) {peak_years_str} ({num_peak_years} distinct peak year(s)).",
            f"- Standard Deviation of publications in active years: {std_dev_pubs_active:.2f}, indicating {'low' if std_dev_pubs_active < avg_pubs_active * 0.3 else 'moderate' if std_dev_pubs_active < avg_pubs_active * 0.7 else 'high'} year-to-year variability."
        ]

        # First and Last Publication Details
        first_pub_year_val = min_active_year
        pubs_in_first_year = int(
            trends_series.loc[first_pub_year_val]) if first_pub_year_val in trends_series else "N/A"
        summary.append(
            f"- Initial Activity: First recorded publication in {first_pub_year_val} with {pubs_in_first_year} item(s).")

        last_pub_year_val = max_active_year
        pubs_in_last_year = int(trends_series.loc[last_pub_year_val]) if last_pub_year_val in trends_series else "N/A"
        summary.append(
            f"- Most Recent Activity: Last recorded publication in {last_pub_year_val} with {pubs_in_last_year} item(s).")

        # Overall Trend Direction (Simple Start vs. End Comparison within active range)
        if count_years_with_pubs > 1:
            initial_avg = active_trends_series.iloc[
                          :min(3, len(active_trends_series))].mean()  # Avg of first 1-3 active years
            recent_avg = active_trends_series.iloc[
                         -min(3, len(active_trends_series)):].mean()  # Avg of last 1-3 active years
            if pd.notna(initial_avg) and pd.notna(recent_avg):
                if recent_avg > initial_avg * 1.2:  # More than 20% higher
                    overall_trend_qualitative = "general upward trend"
                elif initial_avg > recent_avg * 1.2:  # More than 20% lower
                    overall_trend_qualitative = "general downward trend"
                else:
                    overall_trend_qualitative = "relatively stable or mixed trend overall"
                summary.append(
                    f"- Overall Trajectory: The timeline suggests a {overall_trend_qualitative} from early ({initial_avg:.2f} avg pubs) to recent ({recent_avg:.2f} avg pubs) active years.")

        # Year-over-year changes
        diff_series = trends_series.diff().dropna()  # Differences from one year to the next
        if not diff_series.empty:
            max_increase_year = diff_series.idxmax()
            max_increase_value = diff_series.max()
            if pd.notna(max_increase_year) and pd.notna(max_increase_value) and max_increase_value > 0:
                summary.append(
                    f"- Largest Single-Year Increase: +{int(max_increase_value)} publications in {int(max_increase_year)} (compared to previous year).")

            min_increase_year = diff_series.idxmin()  # This is actually largest decrease or smallest increase
            min_increase_value = diff_series.min()
            if pd.notna(min_increase_year) and pd.notna(min_increase_value):
                if min_increase_value < 0:
                    summary.append(
                        f"- Largest Single-Year Decrease: {int(min_increase_value)} publications in {int(min_increase_year)} (compared to previous year).")
                elif min_increase_value == 0 and len(
                        diff_series[diff_series == 0]) > 0:  # if there was any year with no change
                    summary.append(
                        f"- At least one year showed no change in publication count from the previous year (e.g., {int(min_increase_year)}).")

        # Gaps/Lulls
        years_in_active_span = set(range(min_active_year, max_active_year + 1))
        active_years_set = set(active_trends_series.index)
        gap_years = sorted(list(years_in_active_span - active_years_set))
        if gap_years:
            summary.append(
                f"- Potential Gaps/Lulls: Years with zero publications within the active span ({min_active_year}-{max_active_year}) include: {', '.join(map(str, gap_years))}.")
        else:
            summary.append(
                f"- No years with zero publications were found within the primary activity span ({min_active_year}-{max_active_year}).")

        # Identify broad trend periods (heuristic)
        # This is a simplified segmentation. A more robust one is complex.
        # We can describe activity in quartiles or halves of the active period.
        if active_period_span_years >= 4:  # Only if span is reasonably long
            num_segments = min(max(2, active_period_span_years // 5), 4)  # 2 to 4 segments
            segment_len = active_period_span_years // num_segments
            segment_texts = []
            for i in range(num_segments):
                seg_start_year = min_active_year + i * segment_len
                seg_end_year = min_active_year + (i + 1) * segment_len - 1
                if i == num_segments - 1:  # Last segment takes the remainder
                    seg_end_year = max_active_year

                segment_data = active_trends_series.loc[
                               seg_start_year: seg_end_year] if seg_start_year <= seg_end_year else pd.Series(
                    dtype='float64')
                if not segment_data.empty:
                    avg_pubs_segment = segment_data.mean()
                    total_pubs_segment = segment_data.sum()
                    desc_qual = "N/A"
                    if len(segment_data) > 1:
                        if segment_data.iloc[-1] > segment_data.iloc[0]:
                            desc_qual = "overall increasing"
                        elif segment_data.iloc[-1] < segment_data.iloc[0]:
                            desc_qual = "overall decreasing"
                        else:
                            desc_qual = "relatively stable"
                    elif len(segment_data) == 1:
                        desc_qual = "single year of activity"

                    segment_texts.append(
                        f"  - Segment {seg_start_year}-{seg_end_year}: {desc_qual}, avg {avg_pubs_segment:.2f} pubs/yr, total {int(total_pubs_segment)} items."
                    )
            if segment_texts:
                summary.append("\nBroad Activity Segments within Active Period:")
                summary.extend(segment_texts)
        return "\n".join(summary)
    except Exception as e:
        logging.error(f"Error generating detailed trend description: {e}\n{traceback.format_exc()}")
        return "Error generating comprehensive trend summary."


def describe_series_data(data_series: pd.Series, description_label: str = "Items", top_n: int = 5) -> str:
    if data_series is None or data_series.empty: return f"No data available for {description_label}."
    total_items = int(data_series.sum());
    num_unique = len(data_series)
    top_items_str = ", ".join(
        [f"{idx} ({int(val)})" for idx, val in data_series.head(top_n).items()])  # Ensure val is int for display
    summary = [f"{description_label} Summary:", f"- Total Count: {total_items}",
               f"- Unique {description_label}: {num_unique}", f"- Top {min(top_n, num_unique)}: {top_items_str}"]
    return "\n".join(summary)

def analyze_lotkas_law(df: pd.DataFrame, params: dict, progress_callback=None):
    """
    Analyzes author productivity based on Lotka's Law.
    params: {} (currently no specific params from UI for this, but can be added)
    Returns: (results_dataframe_with_lotka_distribution, plotly_figure_object)
    """

    def _callback(msg):
        if progress_callback: progress_callback(msg)
        logging.info(msg)

    _callback("Starting Lotka's Law analysis...")
    if df is None or df.empty or 'authors' not in df.columns:
        _callback("Missing 'authors' column or DataFrame is empty for Lotka's Law.")
        return pd.DataFrame(columns=['Num_Publications', 'Num_Authors_Observed', 'Prop_Authors_Observed']), None

    all_authors_flat = [author.strip() for author_list_str in df['authors'].dropna().astype(str)
                        for author in author_list_str.split(';') if author.strip()]
    if not all_authors_flat:
        _callback("No author data found after parsing.")
        return pd.DataFrame(columns=['Num_Publications', 'Num_Authors_Observed', 'Prop_Authors_Observed']), None

    author_publication_counts = Counter(all_authors_flat)

    # Count how many authors published X number of papers
    # productivity_counts: {1: 100, 2: 30, 3:10} means 100 authors published 1 paper, 30 published 2, etc.
    productivity_distribution = Counter(author_publication_counts.values())

    results_df = pd.DataFrame(list(productivity_distribution.items()),
                              columns=['Num_Publications', 'Num_Authors_Observed'])
    results_df = results_df.sort_values(by='Num_Publications').reset_index(drop=True)

    total_unique_authors = results_df['Num_Authors_Observed'].sum()
    results_df['Prop_Authors_Observed'] = results_df['Num_Authors_Observed'] / total_unique_authors

    _callback("Lotka's Law distribution table generated. Creating Plotly figure...")
    fig = go.Figure()
    if not results_df.empty:
        fig.add_trace(go.Scatter(
            x=results_df['Num_Publications'],
            y=results_df['Prop_Authors_Observed'],
            mode='lines+markers',
            name="Observed Proportion of Authors",
            hovertemplate="Publications: %{x}<br>Proportion of Authors: %{y:.3f}<br>(%{customdata[0]} authors)<extra></extra>",
            customdata=results_df[['Num_Authors_Observed']]
        ))

        # Attempt to fit Lotka's Law: F(n) = C / n^alpha
        # This is a simplification. Real fitting involves regression on log-log data.
        # For alpha=2 (common assumption), F(n) is proportional to 1/n^2
        # We can scale C such that the sum of proportions is 1 (or close for the observed range)
        if len(results_df['Num_Publications']) > 1:
            try:
                # Basic estimation of C (constant of proportionality) and alpha
                # Fit log(Prop_Authors) = log(C) - alpha * log(Num_Publications)
                log_n = np.log(results_df['Num_Publications'])
                log_f_n = np.log(results_df['Prop_Authors_Observed'])

                # Remove -inf from log_f_n if Prop_Authors_Observed can be 0 for some n (after reindex or if gaps exist)
                # However, results_df comes from value_counts, so Num_Authors_Observed should be > 0.
                # np.isfinite check is safer
                valid_fit_indices = np.isfinite(log_n) & np.isfinite(log_f_n)
                if np.sum(valid_fit_indices) > 1:  # Need at least 2 points to fit a line
                    log_n_fit = log_n[valid_fit_indices]
                    log_f_n_fit = log_f_n[valid_fit_indices]

                    # Linear regression: log_f_n = m * log_n + b
                    # where m = -alpha, b = log(C)
                    m, b = np.polyfit(log_n_fit, log_f_n_fit, 1)
                    alpha_estimated = -m
                    c_estimated = np.exp(b)

                    results_df['Lotka_Predicted_Prop (alpha~2)'] = (1 / results_df['Num_Publications'] ** 2) / \
                                                                   sum(1 / k ** 2 for k in
                                                                       results_df['Num_Publications'])
                    results_df[f'Lotka_Predicted_Prop (alpha={alpha_estimated:.2f})'] = \
                        (c_estimated / results_df['Num_Publications'] ** alpha_estimated)

                    fig.add_trace(go.Scatter(
                        x=results_df['Num_Publications'],
                        y=results_df['Lotka_Predicted_Prop (alpha~2)'],
                        mode='lines', name="Lotka's Law (alpha=2)",
                        line=dict(dash='dash')
                    ))
                    fig.add_trace(go.Scatter(
                        x=results_df['Num_Publications'],
                        y=results_df[f'Lotka_Predicted_Prop (alpha={alpha_estimated:.2f})'],
                        mode='lines', name=f"Lotka's Law (Fitted alpha={alpha_estimated:.2f})",
                        line=dict(dash='dot')
                    ))
                    _callback(f"Lotka's Law: Estimated alpha = {alpha_estimated:.2f}, C = {c_estimated:.3f}")

            except Exception as e_lotka_fit:
                _callback(f"Could not fit Lotka's Law parameters: {e_lotka_fit}")

        fig.update_layout(
            title="Lotka's Law: Author Productivity Distribution",
            xaxis_title="Number of Publications (n)",
            yaxis_title="Proportion of Authors Publishing n Papers",
            xaxis_type="log",
            yaxis_type="log",
            legend_title_text="Distribution"
        )
    else:
        _callback("No data for Lotka's Law plot.")

    _callback("Lotka's Law analysis complete.")
    return results_df, fig





load_dotenv()  # loads the variables from .env
import os
global count

mistral_key= os.environ.get("MISTRAL_API_KEY")
from pathlib import Path

CACHE_DIR = Path(ZOTKW_CACHE_DIR) / "phrase"
try:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
except Exception as exc:
    logging.warning("Failed to create CACHE_DIR=%s: %s", str(CACHE_DIR), exc)


import subprocess
import  io

from typing import OrderedDict, Set

import tempfile

import pymupdf4llm


from mistralai import  models as m_models

from pathlib import Path

from dotenv import load_dotenv


load_dotenv()  # loads the variables from .env
import os
# count = 0
# mistral_key= os.environ.get("MISTRAL_API_KEY")
CACHE_DIR = Path(ZOTKW_CACHE_DIR) / "phrase"
try:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
except Exception as exc:
    logging.warning("Failed to create CACHE_DIR=%s: %s", str(CACHE_DIR), exc)

import re, time, html
from pathlib import Path
from typing import List, Dict, Optional, Any

from dotenv import load_dotenv
from mistralai import Mistral

# Ensure environment variables are loaded (e.g., from a .env file)
load_dotenv()

# --- Globals and Configuration ---
# count = 0
# mistral_key = os.environ.get("MISTRAL_API_KEY")
api_key = os.getenv("MISTRAL_API_KEY", "")


CACHE_DIR = ZOTKW_CACHE_DIR / "phrase"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# --- PyMuPDF Configuration ---
import fitz  # PyMuPDF

fitz.TOOLS.mupdf_display_errors(False)  # hide “invalid ICC colorspace”
fitz.TOOLS.mupdf_display_warnings(False)  # hide other MuPDF warnings
_PUA_ZERO  = 0xF643                                   # 
_PUA_DIGIT = {chr(_PUA_ZERO + i): str(i) for i in range(10)}
SOFT_HYPH  = "\u00AD"                                 # discretionary hyphen

# Regex to catch the first References/Bibliography heading
_REFERENCE_HEADING_RE = re.compile(
    r'''(?mix)           # multi-line, ignore case, verbose
    ^\s*                 # start of line
    \#{1,6}              # 1–6 Markdown '#' heading markers
    [ \t]*               # optional space/tabs
    (?:\d+\.\s*)?        # optional numeric prefix (e.g. "6. ")
    [_*]*                # optional bold/italic markers
    \b(?:                # word-boundary + one of:
       references
       | reference
       | bibliography
       | works\s+cited
       | sources
       | notes
       | selected\s+bibliography
    )\b                  # end of our keywords
    [^ \t\n]*            # optional trailing modifiers
    .*                   # rest of the heading line
    '''
)
# ═════════════════════════════════════════════════════════════════════════════
# SECTION ALIASES & REGEX (No changes from original)
# ═════════════════════════════════════════════════════════════════════════════
_SECTION_ALIASES: Dict[str, set[str]] = {
    "abstract": {"abstract", "summary", "résumé", "resume", "resumen", "аннотация", "zusammenfassung"},
    "keywords": {"keywords", "key words", "key-terms", "palabras clave", "mots clés", "schlüsselwörter",
                 "ключевые слова"},
    "introduction": {"introduction", "introductory remarks", "background", "introducción", "einleitung", "введение"},
    "methodology": {"methodology",  "materials & methods", "study design", "research design", "методология",
                    "методы", "metodología"},
    "methods":{"methods", "materials & methods"},
    "literature": {"literature review", "related work", "state of the art", "survey of literature",
                   "литературный обзор", "revisión de la literatura"},
    "results": {"results", "findings", "key findings", "analysis and results", "observations", "outcomes", "результаты",
                "resultados"},
    "discussion": {"discussion", "analysis", "debates", "interpretation", "обсуждение", "discusión"},
    "limitations": {"limitations", "scope and limitations", "research constraints", "challenges", "ограничения",
                    "limitaciones"},
    "implications": {"implications", "policy implications", "practical implications", "future research", "выводы",
                     "implicaciones"},
    "conclusion": {"conclusion", "conclusions", "concluding", "final remarks", "summary and conclusion",
                   "заключение", "fazit", "conclusión"},
    "recommendations": {"recommendations", "policy recommendations", "suggestions for future work"},

    "acknowledgments": {"acknowledgments", "acknowledgements", "danksagung", "agradecimientos", "благодарности"},
    "references": {"references", "reference","bibliography", "works cited", "sources", "selected bibliography", "literature cited",
                   "referencias", "bibliographie", "литература", "библиография"},
    "appendix": {"appendix", "appendices", "annex", "annexes", "приложение", "apéndice"},
    "notes": {"notes", "endnotes", "footnotes", "примечания", "notas"},
}



# Explicit shortcuts for later use in the parsers




REFS_RE = re.compile(r"(?im)^[\s#>*_\-]*(?:%s)\b" % "|".join(map(re.escape, _SECTION_ALIASES["references"])))

ALLCAPS_HEADING_RE = re.compile(r'^(?=.{3,}$)(?!.*[a-z])(?P<title>[A-Z0-9\s&\-]+)$')
alias_terms = {alias.lower() for aliases in _SECTION_ALIASES.values() for alias in aliases}


# ═════════════════════════════════════════════════════════════════════════════
# HELPER AND PARSING FUNCTIONS (Largely unchanged, but with fixes)
# ═════════════════════════════════════════════════════════════════════════════

# def _exponential_backoff(retries: int = 5, base: float = 1.5, jitter: float = 0.3):
#     """Yield sleep times for exponential back-off."""
#     for n in range(retries):
#         yield (base ** n) + random.uniform(0, jitter)
#
#

# ----------------------------------------------------------------------
#  CLEANER
# ----------------------------------------------------------------------
# Regex patterns

pattern1 = re.compile(
    r'^\s*(?:\*{2}\s*)?["“”]?\s*DATE\s+DOWNLOADED:.*?PinCite\s+this\s+document\s*',
    re.IGNORECASE | re.DOTALL | re.MULTILINE
)
pattern2 = re.compile(
    r'^\s*(?:#\s*)?Citations:\s*.*?PinCite\s+this\s+document\s*',
    re.IGNORECASE | re.DOTALL | re.MULTILINE
)
pattern3 = re.compile(
    r'^\s*["“”]?\s*DATE\s+DOWNLOADED:.*?(?:^|\n)\s*Copyright\s+Information\b.*?(?:\n|$)',
    re.IGNORECASE | re.DOTALL | re.MULTILINE
)

def clean_hein_header(text: str) -> str:
    """
    Remove HeinOnline boilerplate.
    Priority:
      1) DATE DOWNLOADED … up to (and including) the 'Copyright Information' line.
      2) Bold/quoted 'DATE DOWNLOADED … PinCite this document' variant.
      3) 'Citations: … PinCite this document' variant.
    Never drop body content; trim leading blank lines after removal.
    """
    cleaned = text
    if pattern3.search(cleaned):
        cleaned = pattern3.sub('', cleaned, count=1)
    elif pattern1.search(cleaned):
        cleaned = pattern1.sub('', cleaned, count=1)
    elif pattern2.search(cleaned):
        cleaned = pattern2.sub('', cleaned, count=1)

    # collapse any leading blank lines created by removal
    cleaned = re.sub(r'^\s*\n+', '', cleaned, flags=re.MULTILINE)
    return cleaned

def _repair_pdf(orig: str) -> str:
    """Attempt to repair *orig* via Ghostscript, then MuTool.
    Returns path to repaired file (may still be *orig* if both fail)."""
    fixed = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf").name

    # ── try Ghostscript ─────────────────────────────────────────────────────────
    gs_cmd = [
        "gs", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
        "-sOUTPUTFILE=" + fixed, orig,
    ]
    try:
        subprocess.run(gs_cmd, check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
        if Path(fixed).stat().st_size > 0:
            return fixed
    except Exception:
        pass

    # ── try MuTool clean ───────────────────────────────────────────────────────
    mu_cmd = ["mutool", "clean", orig, fixed]
    try:
        subprocess.run(mu_cmd, check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
        if Path(fixed).stat().st_size > 0:
            return fixed
    except Exception:
        pass

    # fall‑back: give up repairing
    return orig


_NUM_RE = re.compile(r"""
    ^\s*                             # leading space
    \#{1,}                           # one or more ‘#’
    [\s\-–—]*                        # optional spaces or dashes
    (?P<n>\d{1,2}(?:\.\d{1,3})*)     # 1–2 digits, optionally .subsections
    [\.\)\s-]                        # delimiter: ., ), space or dash
    """, re.VERBOSE)


def _calculate_tokens(text: str) -> int:
    """
    Estimates the token count of a string using a common heuristic
    (avg. 4 characters per token).
    """
    if not isinstance(text, str):
        return 0
    return len(text) // 4

# ------------ REGEXES ------------
# ------------ REGEXES ------------
MD_HEADING_RE = re.compile(r'^\s*(?P<h>#{1,6})\s*(?P<title>.+)$')

BOLD_HEADING_RE    = re.compile(r'^\s*\*\*(?P<title>[^*]+)\*\*\s*$')
FIG_CAPTION_RE     = re.compile(r'^\s*(figure|fig\.?|table)\s*\d+', re.IGNORECASE)
_FAKE_HDR_RX       = re.compile(
    r'^\s*#{0,6}\s*(recorded\s+sophisticated\s+cyber\s+incidents|figure\s+\d+|table\s+\d+)\b',
    re.IGNORECASE
)
_NUM_RX            = re.compile(r'^(?:#{1,6}\s*)?(?P<num>\d+(?:\.\d+)*)\.?\s+(?P<title>.+)$')
CITE_LEAD_RE    = re.compile(r'^(see|ibid\.?|cf\.?|supra|infra)\b', re.I)
LEADER_DOTS_RE  = re.compile(r'\.{2,}\s*\d+\s*$')
ROM_HEADING_RE  = re.compile(
    r'^\s*(?:#{0,6}\s*)?(?P<rom>[IVXLCDM]+)\s*(?:[.)-]|\s+)(?P<title>.+?)\s*$',
    re.I
)
# --- drop any trailing “Endnotes” heading + everything after it ---
_ENDNOTES_HEADING_RE = re.compile(r'(?mi)^\s*#{1,6}\s*endnotes\b')

INTRO_CONC_RE = re.compile(r'^(introduction|conclusion)\b', re.I)
NUM_HEADING_RE  = re.compile(r'^\s*(?:#{0,6}\s*)?(?P<num>\d+(?:\.\d+)*)[.)\s:-]+\s*(?P<title>.+)$')
LET_HEADING_RE  = re.compile(r'^\s*(?:#{0,6}\s*)?(?P<let>[A-Z])[.)\s:-]+\s*(?P<title>.+)$')
DROP_ALIASES    = {"acknowledgments","acknowledgement","references","bibliography","reference"
                   "notes","appendix","appendices","disclosure statement","endnotes"}
WORD_RX         = re.compile(r'\w+')
ROM_MAX_VAL   = 30          # tweak as needed
ROM_MIN_RUN   = 3           # need at least I, II, III…
ROM_TOKEN_RE   = re.compile(r'^[IVXLCDM]{1,6}$')
ROMAN_MAP = {
    'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000
}


_ROMAN_MAX_LEN = 6
_ROMAN_VALS = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}

def roman_to_int(s: str) -> int:
    if not s or not isinstance(s, str):
        return 0
    if not ROM_TOKEN_RE.match(s):
        return 0
    total = 0
    prev  = 0
    for ch in s.upper():
        val = _ROMAN_VALS.get(ch, 0)
        if val > prev:
            total += val - 2*prev
        else:
            total += val
        prev = val
    return total



# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
def _enough_words(txt: str, n: int = 5) -> bool:
    return len(WORD_RX.findall(txt)) >= n

def _is_caption(title: str) -> bool:
    return FIG_CAPTION_RE.match(title.lower()) is not None

def _get_heading(line: str):
    """
    Return (level, raw_with_number, pure_title, kind, primary_tag)
      kind ∈ {'num','rom','let','md','bold'}
      primary_tag = '3' for 3., 'II' for roman, 'A' for letter, else None
    """
    if line is None:
        return None
    s = line.strip()

    m = NUM_HEADING_RE.match(s)
    if m:
        num = m.group('num')
        title = LEADER_DOTS_RE.sub('', m.group('title').strip())
        if CITE_LEAD_RE.match(title):
            return None
        lvl = num.count('.') + 1
        raw = f"{num}. {title}"
        return lvl, raw, title, 'num', num.split('.')[0]

    m = ROM_HEADING_RE.match(s)
    if m:
        rom = m.group('rom').upper()
        title = LEADER_DOTS_RE.sub('', m.group('title').strip())
        if CITE_LEAD_RE.match(title):
            return None
        raw = f"{rom}. {title}"
        return 1, raw, title, 'rom', rom

    m = LET_HEADING_RE.match(s)
    if m:
        let = m.group('let')
        raw = f"{let}. {m.group('title').strip()}"
        return 2, raw, m.group('title').strip(), 'let', let

    m = MD_HEADING_RE.match(s)
    if m:
        t = m.group('title')
        if not t:  # None
            return None
        if _is_caption(t):
            return None
        title = t.strip()
        lvl = len(m.group('h') if 'h' in m.re.groupindex else m.group(1))

        return lvl, t, t, 'md', None

    m = BOLD_HEADING_RE.match(s)
    if m and m.group('title'):
        t = m.group('title').strip()
        if _is_caption(t):
            return None
        return 1, t, t, 'bold', None

    return None


def _quick_scan(md_text: str):
    """Return list of (raw, kind, tag, full_num_tuple|None, roman_int|None)."""
    out = []
    for ln in md_text.splitlines():
        h = _get_heading(ln)
        if not h:
            continue
        _, raw, _, kind, tag = h
        num_tuple = None
        rom_int   = None
        if kind == 'num':
            nums = re.match(r'^(\d+(?:\.\d+)*)', raw).group(1)
            num_tuple = tuple(int(x) for x in nums.split('.'))
        elif kind == 'rom':
            rom_int = roman_to_int(tag)
        out.append((raw, kind, tag, num_tuple, rom_int))
    return out

# ─────────────────────────────────────────────────────────────
NUM_RE = re.compile(
    r"""
    ^\s*                # optional leading whitespace
    (?:\#{1,6}\s*)?     # optional markdown heading '#'
    (?P<n>\d{1,2})      # capture ONLY the top integer (1–2 digits)
    [\.\)\s-]           # delimiter after number
    """,
    re.VERBOSE,
)
# Backwards‑compat for other helpers that reference _NUM_RE


HEAD_NUM_LINE_RE = re.compile(
    r"""
    ^\s*
    (?P<hash>\#{1,6})\s*   # real markdown heading
    (?P<num>\d{1,2})       # top number only
    [\.\)\s-]+             # delimiter
    (?P<title>.*)$
    """,
    re.VERBOSE,
)

# ─────────────────────────────────────────────────────────────
# Numeric-outline parser (robust, keeps all existing safeguards)
# ─────────────────────────────────────────────────────────────
def numbering_parser(md_text: str) -> Tuple[List[Tuple[int, str]], Dict[str, str]]:
    """
    Numeric-outline parser with two safeguards:
      1) Count numeric headings ONLY if they appear on lines that begin with '#'
         (e.g., '# 1. …', '## 2 …'). Plain numeric lines without '#' are ignored.
      2) Track the expected top index. If current top is k, only accept k or k+1
         as a new top-level section. Otherwise, merge that block into the current
         section to avoid spurious splits (e.g., inline years/dates).

    Subsections 'k.x' are folded into their parent 'k'.
    """
    import re
    from collections import OrderedDict

    HASH_NUM_RE = re.compile(r'^\s*#{1,6}\s*(?P<num>\d+(?:\.\d+)*)[.)\s-]+')
    NUM_HEADING_RE = re.compile(
        r'^\s*#{1,6}\s*'
        r'(?P<num>\d+(?:\.\d+)*)[.)\s-]+'
        r'(?P<title>.*\S)'
    )

    # 0) Record which *top* numbers exist on hash-prefixed numeric headings
    allowed_tops: set[int] = set()
    for line in md_text.splitlines():
        m = HASH_NUM_RE.match(line)
        if not m:
            continue
        try:
            allowed_tops.add(int(m.group('num').split('.')[0]))
        except ValueError:
            pass

    # 1) Build headings → content map via existing utilities
    forest = _make_nodes(md_text)
    rolled = _roll_forest(forest)

    grouped: "OrderedDict[str, str]" = OrderedDict()
    current_parent: str | None = None
    current_top: int | None = None

    for raw_title, content in rolled.items():
        title_line = raw_title.strip()
        m = NUM_HEADING_RE.match(title_line)

        if m:
            full_num = m.group('num')
            top_str = full_num.split('.')[0]
            try:
                top_num = int(top_str)
            except ValueError:
                top_num = None

            # Accept only if this top number was seen on a real hash-heading
            ok_numeric = top_num in allowed_tops if top_num is not None else False

            # Skip citation-like leads even if numeric
            section_title = m.group('title').strip()
            if CITE_LEAD_RE.match(section_title):
                ok_numeric = False

            if ok_numeric:
                depth = full_num.count('.') + 1
                if depth == 1:
                    # New top-level section: accept k or k+1
                    if (current_top is None) or (top_num in (current_top, current_top + 1)):
                        current_parent = title_line
                        current_top = top_num
                        grouped[current_parent] = content
                        continue
                else:
                    # Subsection: only fold if same top as current
                    if (current_parent is not None) and (current_top == top_num):
                        grouped[current_parent] += "\n\n" + content
                        continue

        # Fallback: merge into current section or preface
        if current_parent:
            grouped[current_parent] += "\n\n" + content
        else:
            grouped.setdefault("_PREFACE_", "")
            grouped["_PREFACE_"] += (("\n\n" if grouped["_PREFACE_"] else "") + content)

    # 2) Final filter and TOC
    final: "OrderedDict[str, str]" = OrderedDict()
    toc: List[Tuple[int, str]] = []
    for title, body in grouped.items():
        if title == "_PREFACE_":
            if _enough_words(body):
                final["Preface"] = body
                toc.append((1, "Preface"))
            continue
        lt = title.lower()
        if any(alias in lt for alias in DROP_ALIASES) or _is_caption(lt):
            continue
        if not _enough_words(body):
            continue
        final[title] = body
        toc.append((1, title))

    return toc, final


# ─────────────────────────────────────────────────────────────
# Cheap detector using heading tuples
# ─────────────────────────────────────────────────────────────
def detect_numbering_scheme(
    headings: List[Any],
    *,
    min_run: int = 4,
    max_val: int = 50,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Decide whether a document follows a simple decimal outline (1. / 2. / 3. …).

    • Only consider tuples (level:int, title:str) from real markdown headings.
    • Only the *top* integer is counted (no subsections).
    • Require at least `min_run` consecutive numbers. We prefer sequences starting
      at 1, but any forward consecutive run ≥ min_run is accepted.
    """
    raw: List[int] = []
    for h in headings:
        if not (isinstance(h, tuple) and len(h) == 2):
            continue
        lvl, title = h
        if not isinstance(lvl, int) or lvl < 1:
            continue
        m = NUM_RE.match(title)
        if not m:
            continue
        n = int(m.group("n"))
        if n <= max_val:
            raw.append(n)

    info: Dict[str, Any] = {
        "first_num": raw[0] if raw else None,
        "raw_count": len(raw),
        "raw_examples": raw[:8],
        "filtered_count": 0,
        "filtered_examples": [],
        "seq_score": 0.0,
    }

    if not raw:
        return False, info

    nums = [n for n in raw if n <= max_val]
    info["filtered_count"] = len(nums)
    info["filtered_examples"] = nums[:8]
    if len(nums) < min_run:
        return False, info

    # Prefer a run that starts at 1
    best = run = 1
    saw_one = 1 in nums
    if saw_one:
        # build indices where each number first appears
        first_pos: Dict[int, int] = {}
        for i, n in enumerate(nums):
            if n not in first_pos:
                first_pos[n] = i
        k = 1
        while (k in first_pos) and ((k + 1) in first_pos) and (first_pos[k] < first_pos[k + 1]):
            k += 1
        best = max(best, k)

    # Also compute generic longest +1 run anywhere
    run = 1
    for a, b in zip(nums, nums[1:]):
        if b == a + 1:
            run += 1
            best = max(best, run)
        elif b > a:
            run = 1
        else:
            run = 1

    info["seq_score"] = best / max(1, len(nums))
    return best >= min_run, info


# ─────────────────────────────────────────────────────────────
# Line-scan numeric hint and splitter (for stubborn cases)
# ─────────────────────────────────────────────────────────────
def detect_numbering_by_lines(
    md_text: str,
    *,
    min_run: int = 4,
    want_until: int = 9,
    max_val: int = 50,
) -> Tuple[bool, Dict[str, Any], List[Tuple[int, int, str]]]:
    """
    Look directly at raw lines for '# 1. …', '## 2) …' headings.
    Returns (ok, info, anchors) with anchors = [(line_index, number, line), ...].

    info fields:
      - raw_count:   total matched anchors (with duplicates for subsections)
      - count:       unique top numbers in first-occurrence order
      - examples:    unique top numbers (no duplicates)
      - best_run:    longest +1 run over the unique stream, preferring 1..k
    """
    anchors: List[Tuple[int, int, str]] = []
    lines = md_text.splitlines()
    for i, ln in enumerate(lines):
        m = HEAD_NUM_LINE_RE.match(ln)
        if not m:
            continue
        n = int(m.group("num"))
        if 1 <= n <= max_val:
            anchors.append((i, n, ln.rstrip()))

    nums_raw = [n for _, n, _ in anchors]

    # unique top numbers in first-occurrence order
    seen: set[int] = set()
    nums_unique: List[int] = []
    first_pos: Dict[int, int] = {}
    for idx, n, _ in anchors:
        if n not in seen:
            seen.add(n)
            nums_unique.append(n)
            first_pos[n] = idx

    info: Dict[str, Any] = {
        "raw_count": len(nums_raw),
        "count": len(nums_unique),
        "min": (min(nums_unique) if nums_unique else None),
        "examples": nums_unique[:10],
        "best_run": 0,
    }
    if not nums_unique:
        return False, info, anchors

    # Prefer contiguous run starting at 1: 1..k with increasing first positions
    k = 0
    while (k + 1) in first_pos and (k + 2) in first_pos and first_pos[k + 1] < first_pos[k + 2]:
        k += 1
    # If we saw a single "1" only, k will be 0; account for initial 1 present
    if 1 in first_pos:
        k = max(k, 1)
        while (k + 1) in first_pos and first_pos[k] < first_pos[k + 1]:
            k += 1
    best_pref_1 = (k if 1 in first_pos else 0)

    # Generic longest +1 run over the unique stream (order of appearance)
    best = run = 1
    for a, b in zip(nums_unique, nums_unique[1:]):
        if b == a + 1:
            run += 1
            best = max(best, run)
        else:
            run = 1

    info["best_run"] = max(best_pref_1, best)

    ok = info["best_run"] >= min_run
    return ok, info, anchors



def split_by_numeric_anchors(
    md_text: str,
    anchors: List[Tuple[int, int, str]],
    *,
    min_run_accept: int = 3,
) -> Tuple[List[Tuple[int, str]], Dict[str, str]]:
    """
    Split the markdown at the first occurrence of each number in the best run.
    Only true heading lines ('# ...') are anchors. Plain numeric lines are ignored.
    """
    if not anchors:
        return [], {}

    # first occurrence per number
    first_for_num: Dict[int, Tuple[int, int, str]] = {}
    for idx, n, line in anchors:
        if n not in first_for_num:
            first_for_num[n] = (idx, n, line)

    # prefer 1..k run
    run_nums: List[int] = []
    k = 1
    while k in first_for_num:
        run_nums.append(k)
        k += 1

    if len(run_nums) < min_run_accept:
        # longest consecutive run anywhere
        sorted_nums = sorted(first_for_num.keys())
        best_start = best_len = 0
        cur_start = 0
        for i in range(1, len(sorted_nums)):
            if sorted_nums[i] != sorted_nums[i - 1] + 1:
                cur_len = i - cur_start
                if cur_len > best_len:
                    best_len = cur_len
                    best_start = cur_start
                cur_start = i
        cur_len = len(sorted_nums) - cur_start
        if cur_len > best_len:
            best_len = cur_len
            best_start = cur_start
        run_nums = sorted_nums[best_start: best_start + best_len]

    cuts = sorted(first_for_num[n][0] for n in run_nums if n in first_for_num)
    if len(cuts) < min_run_accept:
        return [], {}

    lines = md_text.splitlines()
    sections: Dict[str, str] = {}
    toc: List[Tuple[int, str]] = []

    for i, start in enumerate(cuts):
        end = cuts[i + 1] if i + 1 < len(cuts) else len(lines)
        heading_line = lines[start].rstrip()
        m = HEAD_NUM_LINE_RE.match(heading_line)
        title = (m.group("title").strip() if m else heading_line.strip())
        key = heading_line  # preserve original

        body = "\n".join(lines[start + 1:end]).strip()
        if body:
            sections[key] = body
            toc.append((1, key))

    return toc, sections



from typing import Any, Dict, Iterable, List, Tuple


def clean_text_of_footnotes(text: str) -> str:
    """
    Remove common footnote and citation formats from academic text.

    Targets:
      - Markdown footnote definitions:    [^1]: ...
      - Indented footnote blocks:          lines starting with 4+ spaces or a tab + ${…}$
      - LaTeX‐style side references:       ${1}$
      - Bracketed numeric citations:       [1], [12]
      - Parenthetical numeric citations:   (1), (23)
      - Superscript numerals:              ¹, ², ³, …, ¹⁰, etc.
      - Full‐bracketed author‐year tags:   [Smith et al., 2020]

    Args:
        text: Raw document string.

    Returns:
        Text w/out footnotes/citations.
    """
    cleaned = text

    # 1) Remove indented footnote blocks that start with ${…}$
    cleaned = re.sub(
        r'(?m)^(?: {4,}|\t)\$\{\d+\}\$\s*.*(?:\n(?: {4,}|\t).*)*',
        '',
        cleaned
    )

    # 2) Remove Markdown footnote definitions: [^1]: Blah...
    cleaned = re.sub(
        r'(?m)^\[\^\d+\]:.*(?:\n(?!\s*$).*)*',
        '',
        cleaned
    )

    # 3) Strip inline ${1}$, ${12}$, etc.
    cleaned = re.sub(r'\$\{\d+\}\$', ' ', cleaned)

    # 4) Strip bracketed numeric citations [1], [12], [1–3]
    cleaned = re.sub(r'\[\s*\d+(?:[-–]\d+)?\s*\]', ' ', cleaned)

    # 5) Strip parenthetical numeric citations (1), (12), (1–3)
    cleaned = re.sub(r'\(\s*\d+(?:[-–]\d+)?\s*\)', ' ', cleaned)

    # 6) Strip author‐year citations in square brackets, e.g. [Smith et al., 2020]
    cleaned = re.sub(r'\[[A-Za-z][^\]]+?\d{4}[^\]]*?\]', ' ', cleaned)

    # 7) Remove superscript footnote numbers (¹, ², …)
    #    Unicode range U+00B9, U+00B2–U+00B3, U+2070–U+209F
    cleaned = re.sub(r'[\u00B9\u00B2\u00B3\u2070-\u209F]+', '', cleaned)

    # 8) Collapse multiple blank lines to two
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)

    # 9) Trim leading/trailing whitespace
    return cleaned.strip()

def _roman_number_patterns():
    """
    One source of truth for heading patterns used by both detection and parsing.

    Conventions:
    - Arabic headings are only accepted when hash-prefixed (## 1. …).
    - Roman headings may be hash-prefixed OR plain-line, but plain-line use
      is for parser only (the detector uses the 'OPT_HASH' form).
    - List-item filters are identical for detector and parser.
    """
    ROMAN_TOKEN = (
        r"M{0,3}(?:CM|CD|D?C{0,3})"
        r"(?:XC|XL|L?X{0,3})"
        r"(?:IX|IV|V?I{1,3})"
    )

    patterns = {
        # Detector: tolerate optional hashes to match what _quick_scan emits
        "ROMAN_RE_OPT_HASH": re.compile(
            rf"^\s*(?:#{{1,6}}\s*)?(?P<rom>{ROMAN_TOKEN})\s*[\.)-]\s+(?P<title>.+?)\s*$",
            re.I,
        ),
        # Parser: accept ## ... ###### and require Arabic only under hashes
        "ROMAN_HASH_RE": re.compile(
            rf"^\s{{0,3}}#{{1,6}}\s*(?P<rom>{ROMAN_TOKEN})[\.\)\-]\s+(?P<title>.+?)\s*$",
            re.I
        ),
        # Identical list-item filters (avoid A. …, 1. …, i. …)
        "LETTER_LIST_RE": re.compile(r'^\s*(?:#{1,6}\s*)?(?![IVXLCDM]\.)[A-Z]\.\s', re.I),
        "DECIMAL_LIST_RE": re.compile(r'^\s*(?:#{1,6}\s*)?\d+\.\s'),
        "LOWER_ROMAN_LIST_RE": re.compile(r'^\s*(?:#{1,6}\s*)?[ivxlcdm]+\.\s'),
    }
    return patterns

def detect_roman_scheme(
        heads: Iterable[Any],
        *,
        min_run: int | None = None,
) -> Tuple[bool, Dict[str, Any]]:
    """
    Decide whether the heading list `heads` follows a genuine Roman outline:
    I, II, III, ... in order, starting at I.

    Detector rules (strict & Roman-only):
    • Works ONLY on Roman numerals; numeric or lettered headings are ignored.
    • Accept headings with or without leading hashes (tuples are synthesized to '#'*level + ' ' + title).
    • Allow any heading level (1–6) and spaces around '#' and numerals.
    • Roman delimiter optional and repeatable: 'I Title' / 'I. Title' / 'II) Title' / 'IV- Title' all valid.
    • Accept upper/lower Romans (normalized to UPPER internally).
    • Titles may be short (>= 3 chars, >= 1 word).
    • Returns True only if a contiguous run starting at I has length ≥ min_run (default 3).
    """
    # thresholds
    ROM_MIN_RUN = 3
    MIN_TITLE_CHARS = 3
    MIN_TITLE_WORDS = 1
    if min_run is None:
        min_run = ROM_MIN_RUN

    # coerce any heading node → a text line for regex consumption
    def _text(node: Any) -> str:
        if isinstance(node, tuple) and len(node) >= 2 and isinstance(node[0], int):
            level, title = node[0], node[1]
            try:
                level = int(level)
            except Exception:
                level = 1
            level = 1 if level < 1 else (6 if level > 6 else level)
            return "#" * level + " " + str(title)
        if isinstance(node, str):
            return node
        if hasattr(node, "raw"):
            return str(getattr(node, "raw"))
        if isinstance(node, tuple):
            for part in node:
                if isinstance(part, str):
                    return part
        return str(node)

    # shared Roman patterns (aligned with parser expectations)
    ROMAN_TOKEN = (
        r"M{0,3}(?:CM|CD|D?C{0,3})"
        r"(?:XC|XL|L?X{0,3})"
        r"(?:IX|IV|V?I{1,3})"
    )
    # optional hashes; spaces OK; punctuation optional; require 1+ space before title
    ROMAN_RE = re.compile(
        rf"^\s*(?:#{{1,6}}\s*)?(?P<rom>{ROMAN_TOKEN})\s*[\.\)\-]*\s+(?P<title>.+?)\s*$",
        re.IGNORECASE,
    )
    # Guards for *plain* list items (do not exclude plain Roman headings like 'I. Title')
    letter_list_re = re.compile(r'^\s*(?!#)(?![IVXLCDM][\.\)\-]\s?)[A-Z][\.\)\-]\s+', re.I)
    decimal_list_re = re.compile(r'^\s*(?!#)\d+[\.\)\-]\s+')
    lower_roman_list_re = re.compile(r'^\s*(?!#)[ivxlcdm]+[\.\)\-]\s+')

    # skip lower-roman list items

    # roman value helper
    def _rval(s: str) -> int:
        vals = {"I":1,"V":5,"X":10,"L":50,"C":100,"D":500,"M":1000}
        total, prev = 0, 0
        for ch in s:
            v = vals[ch]
            total += v - 2*prev if prev and v > prev else v
            prev = v
        return total

    # gather Roman candidates only
    cands: List[Tuple[int, int, str, str]] = []  # (roman_value, position, token, title)
    for pos, hd in enumerate(heads):
        txt = _text(hd)

        # ignore obvious letter/decimal *plain* list items
        if letter_list_re.match(txt) or decimal_list_re.match(txt) or lower_roman_list_re.match(txt):
            continue

        m = ROMAN_RE.match(txt)
        if not m:
            continue

        title = (m.group("title") or "").strip()
        if len(title) < MIN_TITLE_CHARS or len(title.split()) < MIN_TITLE_WORDS:
            continue

        rom_tok = m.group("rom").upper()
        cands.append((_rval(rom_tok), pos, rom_tok, title))

    detail: Dict[str, Any] = {
        "raw_count": len(cands),
        "count": 0,
        "min": None,
        "examples": [],
        "best_run": 0,
        "seq_score": 0.0,
        "requires_from_I": True,
    }
    if not cands:
        return False, detail

    # reduce to first occurrence per Roman value (document order)
    first_pos: Dict[int, int] = {}
    ordered_vals: List[int] = []
    for val, pos, *_ in cands:
        if val not in first_pos:
            first_pos[val] = pos
            ordered_vals.append(val)

    detail["count"] = len(ordered_vals)
    detail["min"] = min(ordered_vals)
    detail["examples"] = ordered_vals[:10]

    # REQUIRE a contiguous run starting at I (1..k)
    best_from_I = 0
    if 1 in first_pos:
        k = 1
        while (k + 1) in first_pos and first_pos[k] < first_pos[k + 1]:
            k += 1
        best_from_I = k

    detail["best_run"] = best_from_I
    detail["seq_score"] = best_from_I / max(1, len(ordered_vals))

    ok = best_from_I >= min_run
    return ok, detail
def romans_parser(md_text: str):
    """
    Roman splitter & slicer (lenient, hash-strict).

    ✔ Any heading level allowed: '#', '##', … '######'
    ✔ Spaces allowed before/after hashes and numerals: '  ##   I   )   Title'
    ✔ Romans may have no dot: '# I Title' is valid (also 'I.', 'I..', 'II) Title', 'IV- Title')
    ✔ Accept upper/lower Romans; normalized to UPPER in keys
    ✔ Intro/Conclusion honored ONLY if hash-headed; if already Roman (e.g., 'I. Introduction'),
      keep the exact Roman key (do not replace with plain 'Introduction'/'Conclusion')
    ✔ Short titles allowed (min 3 chars)
    """
    # ───────────────────────── shared Roman patterns ───────────────────────
    def _roman_shared():
        roman_token = (
            r"M{0,3}(?:CM|CD|D?C{0,3})"
            r"(?:XC|XL|L?X{0,3})"
            r"(?:IX|IV|V?I{1,3})"
        )
        # Require 1–6 hashes; allow spaces after '#'; allow 0+ punctuation; require 1+ space before title
        roman_re = re.compile(
            rf"^\s*#{{1,6}}\s*(?P<rom>{roman_token})\s*[\.\)\-]*\s+(?P<title>.+?)\s*$",
            re.I,
        )
        # Conservative list-item guards (most excluded by '#', but keep symmetry with detector)
        letter_list_re      = re.compile(r'^\s*(?:#{1,6}\s*)?(?![IVXLCDM]\.)[A-Z]\.\s', re.I)
        decimal_list_re     = re.compile(r'^\s*(?:#{1,6}\s*)?\d+\.\s')
        lower_roman_list_re = re.compile(r'^\s*(?:#{1,6}\s*)?[ivxlcdm]+\.\s')
        return roman_re, letter_list_re, decimal_list_re, lower_roman_list_re

    ROMAN_RE, LETTER_LIST_RE, DECIMAL_LIST_RE, LOWER_ROMAN_LIST_RE = _roman_shared()

    MIN_TITLE_CHARS = 3
    MIN_TITLE_WORDS = 1
    toc_dots_re = re.compile(r"\.{2,}\s*\d+\s*$")  # “… 23” → likely a TOC line

    def _ok_title(t: str) -> bool:
        t = (t or "").strip()
        if len(t) < MIN_TITLE_CHARS:
            return False
        if toc_dots_re.search(t):
            return False
        if re.match(r'^(figure|fig\.?|table|chart|graph|box)\b', t, re.I):
            return False
        if re.search(r'\b(doi|issn|license|heinonline)\b', t, re.I):
            return False
        return len(t.split()) >= MIN_TITLE_WORDS

    def _roman_val(s: str) -> int:
        vals = {"I":1,"V":5,"X":10,"L":50,"C":100,"D":500,"M":1000}
        total, prev = 0, 0
        for ch in s:
            v = vals[ch]
            total += v - 2*prev if prev and v > prev else v
            prev = v
        return total

    # Only treat Intro/Conclusion when they are **hash-headed**
    INTRO_HASH_RE = re.compile(
        r'^\s*#{1,6}\s*(?:[IVXLCDM]+|[1-9]\d{0,2})?\s*[\.\)\-]*\s*(introduction|background)\b.*$',
        re.I | re.M
    )
    CONCL_HASH_RE = re.compile(
        r'^\s*#{1,6}\s*(?:[IVXLCDM]+|[1-9]\d{0,2})?\s*[\.\)\-]*\s*(conclusion|conclusions|final\s+remarks)\b.*$',
        re.I | re.M
    )

    # ─────────────────────────── collect anchors ───────────────────────────
    lines = md_text.splitlines()
    anchors: List[Tuple[int, int, str, int, int]] = []
    pos = 0
    for i, ln in enumerate(lines):
        start_abs = pos
        end_abs = start_abs + len(ln) + 1
        pos = end_abs

        if LETTER_LIST_RE.match(ln) or DECIMAL_LIST_RE.match(ln) or LOWER_ROMAN_LIST_RE.match(ln):
            continue

        m = ROMAN_RE.match(ln)
        if not m:
            continue

        title = (m.group("title") or "").strip()
        if not _ok_title(title):
            continue

        rom_tok_up = m.group("rom").upper()
        val = _roman_val(rom_tok_up)
        key = f"{rom_tok_up}. {title}"
        anchors.append((i, val, key, start_abs, end_abs))

    # ─────────────── pick best sequence (prefer I..k else longest +1) ──────
    if anchors:
        first_for: Dict[int, Tuple[int, int, str, int, int]] = {}
        ordered_vals: List[int] = []
        for tup in anchors:
            _, v, *_ = tup
            if v not in first_for:
                first_for[v] = tup
                ordered_vals.append(v)

        run_vals: List[int] = []
        if 1 in first_for:
            k = 1
            run_vals = [1]
            while (k + 1) in first_for and first_for[k][0] < first_for[k + 1][0]:
                k += 1
                run_vals.append(k)

        if len(run_vals) < 3 and ordered_vals:
            best, cur = [], [ordered_vals[0]]
            for a, b in zip(ordered_vals, ordered_vals[1:]):
                if b == a + 1:
                    cur.append(b)
                else:
                    if len(cur) > len(best):
                        best = cur
                    cur = [b]
            if len(cur) > len(best):
                best = cur
            run_vals = best

        heads: List[Tuple[str, int, int]] = []
        for v in run_vals:
            if v in first_for:
                _i, _v, key, s_abs, e_abs = first_for[v]
                heads.append((key, s_abs, e_abs))
    else:
        heads = []

    # If Roman Intro/Conclusion already present, keep them; else fence hash-headed ones
    INTRO_WORD_RE = re.compile(r'\b(introduction|background)\b', re.I)
    CONCL_WORD_RE = re.compile(r'\b(conclusion|conclusions|final\s+remarks)\b', re.I)
    has_roman_intro = any(INTRO_WORD_RE.search(k.split('. ', 1)[-1]) for k, *_ in heads)
    has_roman_concl = any(CONCL_WORD_RE.search(k.split('. ', 1)[-1]) for k, *_ in heads)

    def _mk_key(label: str, at: int) -> Tuple[str, int, int]:
        pre = md_text[:at]
        line_start = pre.rfind("\n") + 1
        line_end = md_text.find("\n", at)
        if line_end == -1:
            line_end = len(md_text)
        return (label, line_start, line_end + 1)

    intro_match = None if has_roman_intro else INTRO_HASH_RE.search(md_text)
    concl_match = None if has_roman_concl else CONCL_HASH_RE.search(md_text)

    specials: List[Tuple[str, int, int]] = []
    if intro_match:
        specials.append(_mk_key("Introduction", intro_match.start()))
    if concl_match:
        specials.append(_mk_key("Conclusion", concl_match.start()))

    all_heads = {(s, a, b): (s, a, b) for (s, a, b) in heads}
    for h in specials:
        all_heads[h] = h
    heads = sorted(all_heads.values(), key=lambda t: t[1])

    # ─────────────────────────────── slice ─────────────────────────────────
    sections = OrderedDict()

    if heads:
        front = md_text[:heads[0][1]].strip()
        if front:
            sections["__preamble__"] = front
    else:
        body = md_text.strip()
        sections["Body"] = body
        toc = [(1, h) for h in sections]
        return toc, sections

    for idx, (key, h_start, h_end) in enumerate(heads):
        start = h_end
        end = heads[idx + 1][1] if idx + 1 < len(heads) else len(md_text)
        body = md_text[start:end].rstrip()
        sections[key] = body

    # Always capture any tail after the last head
    last_end = heads[-1][2]
    tail = md_text[last_end:].strip()
    if tail:
        sections["__postscript__"] = tail

    toc = [(1, k) for k in sections.keys() if not k.startswith("__")]
    if not toc and "__preamble__" in sections:
        toc = [(1, "__preamble__")]

    return toc, sections



# ───── nodes & rendering ─────
class _Node:
    __slots__ = ("lvl","raw","txt","kind","tag","kids")
    def __init__(self,lvl,raw,txt,kind,tag):
        self.lvl, self.raw, self.txt, self.kind, self.tag = lvl, raw, txt, kind, tag
        self.kids: List["_Node"] = []

def _make_nodes(md_text: str) -> List[_Node]:
    # remove empty headers
    lines = md_text.splitlines()
    cleaned = []
    i = 0
    while i < len(lines):
        h = _get_heading(lines[i])
        if h:
            lvl = h[0]
            j = i + 1
            has_txt = False
            has_child = False
            while j < len(lines):
                nh = _get_heading(lines[j])
                if nh:
                    if nh[0] > lvl:
                        has_child = True
                    break
                if lines[j].strip():
                    has_txt = True
                j += 1
            if not has_txt and not has_child:
                i = j
                continue
        cleaned.append(lines[i])
        i += 1
    md_text = "\n".join(cleaned)

    nodes = []
    buf: List[str] = []
    cur = None

    def flush():
        nonlocal buf, cur, nodes
        if cur:
            lvl, raw, pure, kind, tag = cur
            nodes.append(_Node(lvl, raw, "\n".join(buf).strip(), kind, tag))
        buf.clear()

    for ln in md_text.splitlines():
        h = _get_heading(ln)
        if h:
            flush()
            cur = h
        else:
            if buf and buf[-1].endswith('-') and buf[-1][:-1].strip():
                buf[-1] = buf[-1][:-1] + ln.lstrip()
            else:
                buf.append(ln)
    flush()

    forest: List[_Node] = []
    stack: List[_Node] = []
    for n in nodes:
        while stack and stack[-1].lvl >= n.lvl:
            stack.pop()
        if stack:
            stack[-1].kids.append(n)
        else:
            forest.append(n)
        stack.append(n)
    return forest

def _render(node: _Node, md_level: int) -> str:
    parts = []
    if node.raw != "_PREFACE_":
        parts.append(f"{'#'*md_level} {node.raw}")
    if node.txt:
        parts.append(node.txt)
    for c in node.kids:
        parts.append(_render(c, md_level + 1))
    return "\n\n".join(p for p in parts if p.strip())

def _roll_forest(forest: List[_Node]) -> "OrderedDict[str,str]":
    rolled = OrderedDict()
    for top in forest:
        md = _render(top, 2).strip()
        if md:
            rolled[top.raw] = md
    return rolled



def _roman_candidates(heads):
    """Yield (roman_str, value, raw_heading) filtered for real headings."""
    out = []
    for raw, kind, tag, _, rom_val in heads:
        raw = raw or ""

        if kind != 'rom' or not tag or rom_val is None:
            continue
        # tag must be a valid roman token and not absurdly large
        if not ROM_TOKEN_RE.match(tag):      # sanity
            continue
        if rom_val <= 0 or rom_val > ROM_MAX_VAL:
            continue
        # require heading-looking text
        if not _looks_like_heading(raw):
            continue
        out.append((tag, rom_val, raw))
    return out
def _looks_like_heading(txt: str) -> bool:
    if not isinstance(txt, str):
        return False
    # at least 2 words after the numeral, no “….. 481” leader dots, etc.
    w = txt.strip().split()
    return len(w) >= 2 and '.....' not in txt and not FIG_CAPTION_RE.match(txt.lower())

# --- 1. Sophisticated Footnote Skipping ---
def _skip_footnotes(text: str) -> str:
    """
    Intelligently removes footnote markers and definition blocks before parsing.
    """
    # Remove inline markers like ${1}, replacing with a space.
    text = re.sub(r'\s*\$\{\d+\}\s*', ' ', text)
    # Remove definition blocks like [^0]: ...
    text = re.sub(r'(?m)^\s*\[\^.*?\]:.*$\n?', '', text)
    return text
import re
from collections import OrderedDict

# ------------- regexes -----------------------------------------------------
# skip TOC‐style lines like “I. Title …… 1”
_TOC_DOTS_RE = re.compile(r'\.{2,}\s*\d+\s*$', re.ASCII)

# now only one “label” group, backed by two distinct named alternatives
_ROMAN_TOKEN = (
    r"M{0,3}(?:CM|CD|D?C{0,3})"
    r"(?:XC|XL|L|L?X{1,3})"
    r"(?:IX|IV|V|V?I{1,3})"
)
_MAIN_HEADING_RE = re.compile(
    rf"""
    ^\s*                    # start of line + opt. whitespace
    \#{{1,6}}\s*            # optional markdown heading
    (?:
      (?P<rom>{_ROMAN_TOKEN})    # Roman numerals
      |
      (?P<num>\d+)               # or Arabic digits
    )
    \s*[\.\)\-]\s+           # delimiter (. ) or - then space
    (?P<title>.+?)           # the heading text
    \s*$                     # trailing space to EOL
    """,
    re.I | re.X | re.MULTILINE
)





def detect_preamble_intro_conclusion_postscript(md_text: str) -> dict:
    """
    Detect Introduction & Conclusion ONLY if they are Markdown hash headings,
    and collect heading indices for later lossless slicing.

    Returns:
      {
        "intro_idx": int|None,
        "intro_heading": str|None,   # full line including hashes (e.g. "# Introduction")
        "concl_idx": int|None,
        "concl_heading": str|None,   # full line including hashes
        "any_hash_heads": List[int], # indices of ANY '#' heading (H1..H6)
        "h1_heads": List[Tuple[int,str]],  # (line_idx, full_heading_line)
        "h2_heads": List[Tuple[int,str]],
        "h_any":    List[Tuple[int,str]],
        "lines": List[str],
      }
    """
    import re

    text = (md_text or "").replace("\u00A0", " ")
    lines = text.splitlines()

    # ---------- Hash-based headings (up to 3 leading spaces allowed) ----------
    # Capture both the inner title and keep the full line for preservation
    H1_RX   = re.compile(r'^\s{0,3}\#\s+(?P<title>.*\S)\s*$')
    H2_RX   = re.compile(r'^\s{0,3}\#\#\s+(?P<title>.*\S)\s*$')
    H_ANYRX = re.compile(r'^\s{0,3}\#{1,6}\s+(?P<title>.*\S)\s*$')

    h1_full, h2_full, h_any_full = [], [], []
    any_hash_heads = []
    # Also cache parsed inner titles for alias matching
    inner_titles_by_idx: dict[int, str] = {}

    for i, ln in enumerate(lines):
        ma = H_ANYRX.match(ln)
        if ma:
            t = ma.group("title").strip()
            h_any_full.append((i, ln.rstrip()))
            any_hash_heads.append(i)
            inner_titles_by_idx[i] = t

        m1 = H1_RX.match(ln)
        if m1:
            h1_full.append((i, ln.rstrip()))
        m2 = H2_RX.match(ln)
        if m2:
            h2_full.append((i, ln.rstrip()))

    # ---------- Lenient alias checks INSIDE a hash heading ----------
    # We now REQUIRE a hash heading; we no longer accept plain lines as Intro/Conclusion.
    # Within the heading text we accept optional numeric/roman prefix then the alias.
    def _compile_alias_prefix_regex(aliases: set[str]) -> re.Pattern:
        import re as _re
        alt = "|".join(_re.escape(a) for a in sorted(aliases, key=len, reverse=True)) if aliases else r'(?!x)x'
        # optional numeric/roman prefix then one of the aliases, case-insensitive, bounded token
        return _re.compile(
            rf'^\s*(?:(?:\d{{1,3}}|[IVXLCDM]{{1,8}})[.)]\s+)?(?P<alias>(?:{alt}))\b',
            _re.IGNORECASE
        )

    intro_aliases = _SECTION_ALIASES.get("introduction", set())
    concl_aliases = _SECTION_ALIASES.get("conclusion", set())
    INTRO_INNER_RE = _compile_alias_prefix_regex(intro_aliases)
    CONCL_INNER_RE = _compile_alias_prefix_regex(concl_aliases)

    def _first_head_match(heads_list: list[tuple[int, str]], inner_re: re.Pattern):
        for idx, full_line in heads_list:
            inner = inner_titles_by_idx.get(idx, "")
            if inner and inner_re.search(inner):
                return idx, full_line
        return None, None

    # Try H1 first for intro/concl, then any hash heading
    intro_idx, intro_full = _first_head_match(h1_full, INTRO_INNER_RE)
    if intro_idx is None:
        intro_idx, intro_full = _first_head_match(h_any_full, INTRO_INNER_RE)

    concl_idx, concl_full = _first_head_match(h1_full, CONCL_INNER_RE)
    if concl_idx is None:
        concl_idx, concl_full = _first_head_match(h_any_full, CONCL_INNER_RE)

    return {
        "intro_idx": intro_idx,
        "intro_heading": intro_full,
        "concl_idx": concl_idx,
        "concl_heading": concl_full,
        "any_hash_heads": any_hash_heads,
        "h1_heads": h1_full,    # keep full heading lines
        "h2_heads": h2_full,
        "h_any":    h_any_full,
        "lines": lines,
    }

def markdown_parser(md_text: str) -> Tuple[List[Tuple[int, str]], Dict[str, str]]:
    """
    Markdown splitter with strict requirements you requested:
      • Introduction/Conclusion are detected ONLY if they are real hash headings.
      • All headings are preserved verbatim (including '#' level markers) as dict keys and in the TOC.
      • Lossless splitting with your priority on # levels:
          1) ≥4 H1 → split on H1
          2) else ≥4 H2 → split on H2
          3) else (H1+H2) ≥ 4 → split on union(H1∪H2) in order
          4) else → split on ANY hash heading (H1..H6) if present
      • Always returns __preamble__ (before Intro if any else before first heading)
        and __postscript__ (after Conclusion body if any else after last section).
    """
    from collections import OrderedDict
    import re

    md_text = (md_text or "").replace("\u00A0", " ")

    anchors = detect_preamble_intro_conclusion_postscript(md_text)

    lines         = anchors["lines"]
    h1_heads      = anchors["h1_heads"]     # [(idx, full_heading_line)]
    h2_heads      = anchors["h2_heads"]
    h_any         = anchors["h_any"]
    any_hash_idx  = anchors["any_hash_heads"]

    intro_idx     = anchors["intro_idx"]
    intro_heading = anchors["intro_heading"]      # full heading line w/ hashes
    concl_idx     = anchors["concl_idx"]
    concl_heading = anchors["concl_heading"]      # full heading line w/ hashes

    # -------------------------- Noise title detector --------------------------
    SKIP_HEAD_RE = re.compile(
        r'^(dates?|issn|journal homepage|to cite this article|to link to this article|'
        r'published online|submit your article|article views|view related articles|'
        r'view crossmark data|citing articles)\b',
        re.IGNORECASE
    )

    def _is_junk_title(full_heading_line: str) -> bool:
        """
        Treat the 'title' part of the heading for skip checks while still preserving the line.
        We must NOT drop data; this only influences a potential future filter, but we still keep it.
        """
        # Extract inner title for checking; keep original line as key regardless.
        m = re.match(r'^\s{0,3}\#{1,6}\s+(?P<title>.*\S)\s*$', full_heading_line or "")
        inner = (m.group("title") if m else full_heading_line) or ""
        return SKIP_HEAD_RE.match(inner.strip()) or _is_caption(inner.strip())

    # -------------------------- Window boundaries --------------------------
    # Preamble ends at Intro if present; else at first heading (if any)
    if intro_idx is not None:
        pre_end = intro_idx
    else:
        pre_end = any_hash_idx[0] if any_hash_idx else 0

    # Postscript starts right after the conclusion block if present; else after last section
    if concl_idx is not None:
        nxt_after_concl = next((i for i in any_hash_idx if i > concl_idx), len(lines))
        post_start = nxt_after_concl
    else:
        post_start = len(lines)

    # Body window is text strictly between Intro and Conclusion lines (if present)
    left_bound  = (intro_idx if intro_idx is not None else (any_hash_idx[0] if any_hash_idx else 0))
    right_bound = (concl_idx if concl_idx is not None else len(lines))

    # --------------------- Choose splitting heads per rules ---------------------
    def merge_in_order(a: list[tuple[int,str]], b: list[tuple[int,str]]) -> list[tuple[int,str]]:
        seen, out = set(), []
        for lst in (a, b):
            for idx, full_line in lst:
                if idx in seen:
                    continue
                seen.add(idx)
                out.append((idx, full_line))
        out.sort(key=lambda t: t[0])
        return out

    if len(h1_heads) >= 4:
        split_heads = h1_heads
    elif len(h2_heads) >= 4:
        split_heads = h2_heads
    elif (len(h1_heads) + len(h2_heads)) >= 4:
        split_heads = merge_in_order(h1_heads, h2_heads)
    else:
        split_heads = h_any[:] if h_any else []

    # ------------------------ Lossless slicer on chosen heads ------------------------
    def slice_between_heads(heads: list[tuple[int, str]]) -> "OrderedDict[str, str]":
        d = OrderedDict()
        if not heads:
            return d

        # keep only heads in the body window (strictly between intro and concl if any)
        win_heads: list[tuple[int, str]] = []
        for idx, full in sorted(heads, key=lambda t: t[0]):
            if intro_idx is not None and idx <= intro_idx:
                continue
            if concl_idx is not None and idx >= concl_idx:
                continue
            win_heads.append((idx, full))

        if not win_heads:
            return d

        idxs = [idx for idx, _ in win_heads]
        idxs.append(right_bound if right_bound is not None else len(lines))

        for i, (cur_idx, full_head) in enumerate(win_heads):
            nxt_idx = idxs[i + 1]
            body = "\n".join(lines[cur_idx + 1:nxt_idx]).rstrip()
            # Never discard data; even if title looks like chrome, we preserve it as-is.
            d[full_head] = body
        return d

    body_sections = slice_between_heads(split_heads)

    # ------------------------ Assemble final structure ------------------------
    out = OrderedDict()

    # __preamble__
    if pre_end > 0:
        pre_text = "\n".join(lines[:pre_end]).rstrip()
        if pre_text:
            out["__preamble__"] = pre_text

    # Introduction (only if detected as a hash heading)
    if intro_idx is not None and intro_heading:
        next_after_intro = next((i for i in anchors["any_hash_heads"] if i > intro_idx),
                                (concl_idx if concl_idx is not None else len(lines)))
        intro_body = "\n".join(lines[intro_idx + 1: next_after_intro]).rstrip()
        out[intro_heading] = intro_body

    # Body sections (bounded)
    for full_head, body in body_sections.items():
        out[full_head] = body

    # Conclusion (only if detected as a hash heading)
    if concl_idx is not None and concl_heading:
        next_after_concl = next((i for i in anchors["any_hash_heads"] if i > concl_idx), len(lines))
        concl_body = "\n".join(lines[concl_idx + 1: next_after_concl]).rstrip()
        out[concl_heading] = concl_body

    # __postscript__
    if post_start < len(lines):
        post_text = "\n".join(lines[post_start:]).rstrip()
        if post_text:
            out["__postscript__"] = post_text

    # TOC depth=1, include headings as-is (with hashes); omit meta keys
    toc = [(1, k) for k in out.keys() if not k.startswith("__")]
    return toc, out

def extract_preamble_text(
    full_text: str,
    first_section_title: str,
    raw_sections: dict[str, str] | None = None,
    cleaner= None
) -> str:
    """
    Return everything in `full_text` that appears *before* the first section
    whose title is `first_section_title`.
    """

    # 0) If no title provided, return everything before the first markdown heading
    if not first_section_title:
        m2 = re.search(r'(?m)^#{1,6}\s+', full_text)
        return full_text[:m2.start()].strip() if m2 else full_text.strip()

    def _clean(s: str) -> str:
        return cleaner(s) if callable(cleaner) else s

    # 1) Try to anchor via raw_sections (most reliable)
    if raw_sections and first_section_title in raw_sections:
        block = raw_sections[first_section_title].strip()
        if block:
            anchor = block[:200]
            idx = full_text.find(anchor)
            if idx > 0:
                return _clean(full_text[:idx].strip())

    # 2) Regex fallback: find heading line that contains the title
    title_esc = re.escape(first_section_title.strip())
    heading_rx = re.compile(
        rf'(?m)^\s*(?:#{1,6}\s+)?(?:\d+(?:\.\d+)*|[IVXLCDM]+|\w+)?[.)\s-]*\s*{title_esc}\b.*$',
        re.IGNORECASE
    )
    m = heading_rx.search(full_text)
    if m:
        return _clean(full_text[:m.start()].strip())

    # 3) Last resort: everything before first markdown heading
    m2 = re.search(r'(?m)^#{1,6}\s+', full_text)
    if m2:
        return _clean(full_text[:m2.start()].strip())

    # Nothing to cut
    return _clean(full_text.strip())



# ─────────────────────────────────────────────────────────────
# Router with log
# ─────────────────────────────────────────────────────────────
def parse_markdown_to_final_sections(
    md_text: str,clean_academic_references=True,
) -> Tuple[List[Tuple[int, str]], Dict[str, str], Dict[str, Any]]:

    md = clean_hein_header(md_text)

    # if clean_academic_references:
    #     md = clean_academic_text(md_text)
    # Build (level, title) tuples from real hash-headed markdown lines.
    _MD_HEAD = re.compile(r'^\s*(#{1,6})\s+(?P<title>.+?)\s*$')
    secs,toc= "",""
    def _scan_md_heads(s: str) -> list[tuple[int, str]]:
        out = []
        for ln in s.splitlines():
            m = _MD_HEAD.match(ln)
            if m:
                out.append((len(m.group(1)), m.group('title')))
        return out

    heads = _scan_md_heads(md)

    # (Optional) If you still want to nuke plain lettered list items, keep it plain-only & Roman-safe.
    # This does nothing to our (level, title) tuples, so we omit it by default.

    is_num, num_info = detect_numbering_scheme(heads, min_run=4)
    is_rom, rom_info = detect_roman_scheme(heads)

    log: Dict[str, Any] = {
        "scheme": None,
        "numeric_check": num_info,
        "roman_check": rom_info,
    }

    # prefer numeric unless weak and roman is strong
    if is_num and is_rom:
        if rom_info.get("best_run", 0) >= 3:
            is_num = False
        weak = (num_info.get("seq_score", 0.0) < 0.50) or ((num_info.get("first_num") or 0) > 3)
        if weak:
            is_num = False

    if is_num:
        toc, secs = numbering_parser(md)
        log["scheme"] = "numeric"
        if len(secs) < 2:
            toc, secs = markdown_parser(md)
            log["scheme"] = "markdown_from_numeric"
            is_num = False

    if not is_num and is_rom:
        toc, secs = romans_parser(md)
        log["scheme"] = "roman"
        if len(secs) < 2:
            # Keep Romans authoritative if detection was strong; only change the splitter.
            if rom_info.get("best_run", 0) >= 3:
                toc, secs = markdown_parser(md)
                log["scheme"] = "roman_weak_split"
                # crucially: do NOT flip is_rom to False
            else:
                toc, secs = markdown_parser(md)
                log["scheme"] = "markdown_from_roman"
                is_rom = False

    def _numeric_keys_stats(keys: List[str]) -> Dict[str, Any]:
        nums: List[int] = []
        for k in keys:
            m = _NUM_RE.match(k or "")
            if m:
                try:
                    nums.append(int(m.group("n")))
                except ValueError:
                    continue
        best = run = 1
        for a, b in zip(nums, nums[1:]):
            if b == a + 1:
                run += 1
                best = max(best, run)
            else:
                run = 1
        return {
            "count": len(nums),
            "min": min(nums) if nums else None,
            "examples": nums[:8],
            "best_run": best if nums else 0,
        }

    if not is_num and not is_rom:
        # Try the robust numeric parser anyway
        toc_num, secs_num = numbering_parser(md)
        stats = _numeric_keys_stats(list(secs_num.keys()))
        smallest = stats["min"] if stats["min"] is not None else 0
        best_run = stats["best_run"]

        if len(secs_num) >= 2 and smallest <= 10 and best_run >= 2:
            toc, secs = toc_num, secs_num
            log["scheme"] = "numeric_fallback"
            log["numeric_check"] = {
                "first_num": smallest,
                "count": stats["count"],
                "examples": stats["examples"],
                "seq_score": best_run / max(1, stats["count"]),
            }
        else:
            # NEW: line‑scan hint for '# 1.', '# 2.' … when heading tuples miss them
            hint_ok, hint_info, anchors = detect_numbering_by_lines(md, min_run=4, want_until=9)
            log["markdown_numeric_hint"] = hint_info

            if hint_ok:
                toc_hint, secs_hint = split_by_numeric_anchors(md, anchors, min_run_accept=3)
                if len(secs_hint) >= 2:
                    toc, secs = toc_hint, secs_hint
                    log["scheme"] = "numeric_hint"
                else:
                    toc, secs = markdown_parser(md)
                    log["scheme"] = "markdown"
            else:
                toc, secs = markdown_parser(md)
                log["scheme"] = "markdown"

    log["toc_count"] = len(toc)
    log["section_count"] = len(secs)

    return toc, secs, log
def _render_stats_html(self, stats: dict) -> str:
    def pct(x):
        try: return f"{float(x)*100:.1f}%"
        except: return "0.0%"
    s = stats or {}
    keys = [
        ("style", s.get("style","—")),
        ("intext_total", s.get("intext_total",0)),
        ("success_occurrences", s.get("success_occurrences",0)),
        ("success_unique", s.get("success_unique",0)),
        ("bib_unique_total", s.get("bib_unique_total",0)),
        ("occurrence_match_rate", pct(s.get("occurrence_match_rate",0))),
        ("bib_coverage_rate", pct(s.get("bib_coverage_rate",0))),
        ("success_percentage", f"{s.get('success_percentage',0):.2f}%"),
        ("highest_intext_index", s.get("highest_intext_index","—")),
        ("missing_intext_expected_total", s.get("missing_intext_expected_total",0)),
        ("missing_footnotes_for_seen_total", s.get("missing_footnotes_for_seen_total",0)),
        ("uncited_footnote_total", s.get("uncited_footnote_total",0)),
    ]
    cards = "".join(
        f"""
        <div style="flex:1; min-width:180px; background:#1e1e1e; border:1px solid #2a2a2a; 
                    border-radius:12px; padding:12px; margin:6px;">
          <div style="font-size:11px; color:#9aa0a6; text-transform:uppercase; letter-spacing:.06em;">{html.escape(k)}</div>
          <div style="font-size:18px; color:#e6e6e6; margin-top:4px;">{html.escape(str(v))}</div>
        </div>
        """ for k, v in keys
    )
    return f"""
    <div style="display:flex; flex-wrap:wrap; gap:6px; margin:4px 0 10px 0;">{cards}</div>
    """

# ═════════════════════════════════════════════════════════════════════════════
# extract_intro_conclusion_pdf_text
# ═════════════════════════════════════════════════════════════════════════════
def extract_intro_conclusion_pdf_text(
         raw_secs, processing_log,full_text,
        *,
        core_sections: bool = True,

) -> Optional[Dict[str, Any]]:
    """
    Build a payload with this order:
      0. Header (raw preamble text before first heading, if any)
      1. Header sections (Abstract, Keywords)
      2. Core Introduction  (or first legit section fallback)
      3. "Key Sections"     (>=2 predefined body sections; pad with others if needed)
      4. Core Conclusion    (or last legit section fallback)

    Enforce a token limit of 6500 by dropping extra sections
    (those beyond the predefined ones) in ascending order of their size.
    """
    import logging
    import re
    logger = logging.getLogger(__name__)
    #
    # pdf_data = process_pdf(str(pdf_path))
    # if not pdf_data:
    #     return None
    #
    # full_text   = pdf_data.get("flat_text", "")


    # toc, raw_secs, processing_log = parse_markdown_to_final_sections(full_text )

    # print(f"[LOG] Raw parse created {len(raw_secs)} top-level sections. Cleaning...")


    cleaned_sections = {}
    JUNK_HEADING_KEYWORDS = {
        'citations', 'bluebook', 'alwd', 'apa', 'chicago', 'mcgill',
        'aglc', 'mla', 'oscola', 'note', 'downloaded', 'source',
        'your use of this heinonline pdf', 'license agreement'
    }

    for title, content in raw_secs.items():
        tl = title.lower().strip()

        # 1) Exact‑match junk headings only
        if tl in JUNK_HEADING_KEYWORDS:
            continue

        # 2) Guaranteed numeric/numbered sections (e.g. "2. Remedies…")
        #    → keep no matter what
        if re.match(r'^\d+(\.\d+)*\.?\s+', title):
            if re.match(r'^\d+(?:\.\d+)*\.\s+', title):
                cleaned_sections[title] = content
                continue

        # 3) Skip entirely empty sections
        if not content.strip():
            continue

        # 4) Otherwise keep it
        cleaned_sections[title] = content

    # print(f"[LOG] After cleaning, {len(cleaned_sections)} legitimate sections remain.\n")
    sections = cleaned_sections
    toc = [(1, title) for title in sections.keys()]

    for title, txt in list(sections.items()):
        for canon, aliases_set in _SECTION_ALIASES.items():
            if title.lower() in aliases_set:
                sections.setdefault(canon, txt)
                break

    secs =  cleaned_sections
    order   = [k for _, k in toc if k in secs]
    pos_map = {k: i for i, k in enumerate(order)}

    ALIASES          = _SECTION_ALIASES
    HEADER_GROUPS    = ("abstract", "keywords")
    CORE_INTRO       = "introduction"
    CORE_CONCL       = "conclusion"
    PREDEFINED_BODY  = ("methodology","methods","literature","results","discussion","limitations","implications","recommendations")
    BLOCKED          = ("acknowledgments","references","appendix","notes","reference")
    MIN_MIDDLE       = 2

    def title_matches_any(key: str, group: str) -> bool:
        lk = re.sub(r'^\d+(\.\d+)*\.?\s*','', key.lower()).strip()
        return any(alias in lk for alias in ALIASES.get(group, ()))

    def is_legit(k: str) -> bool:
        txt = secs[k]
        return len(re.findall(r'\w+', txt)) >= 50 or "### " in txt

    def get_body(md: str) -> str:
        return re.sub(r'(?m)^#{1,6}\s*.*?\n','', md.strip(), count=1).strip()

    header_keys, body_keys = [], []
    intro_key, concl_key = None, None
    used = set()

    # classify
    for k in order:
        if k in used or not is_legit(k): continue
        if any(title_matches_any(k,g) for g in BLOCKED):
            used.add(k); continue
        if any(title_matches_any(k,g) for g in HEADER_GROUPS):
            header_keys.append(k); used.add(k); continue
        if not intro_key and title_matches_any(k,CORE_INTRO):
            intro_key = k; used.add(k); continue
        if any(title_matches_any(k,g) for g in PREDEFINED_BODY):
            body_keys.append(k); used.add(k); continue

    for k in reversed(order):
        if k in used or not is_legit(k): continue
        if title_matches_any(k,CORE_CONCL):
            concl_key = k; used.add(k); break

    legit_pool = [
        k for k in order
        if is_legit(k)
           and k not in used
           and not any(title_matches_any(k,g) for g in BLOCKED)
    ]
    if not intro_key and legit_pool:
        intro_key = legit_pool.pop(0); used.add(intro_key)
    if not concl_key and legit_pool:
        concl_key = legit_pool.pop(-1); used.add(concl_key)

    predefined_found = [k for k in body_keys if k not in {intro_key, concl_key}]
    extra_added = []

    # choose fallback middle sections
    def pick_between(i_k, c_k, pool):
        if not i_k or not c_k: return []
        i, j = pos_map[i_k], pos_map[c_k]
        between = [x for x in order[i+1:j] if x in pool]
        picks = []
        if between: picks.append(between[0])
        if len(between)>1: picks.append(between[-1])
        return picks

    remaining = [k for k in legit_pool if k not in used]
    needed = max(0, MIN_MIDDLE - len(predefined_found))
    if needed:
        picks = pick_between(intro_key, concl_key, remaining)
        picks = [p for p in picks if p not in predefined_found][:needed]
        body_keys.extend(picks)
        extra_added.extend(picks)
        used.update(picks)
        needed -= len(picks)
    if needed > 0:
        pad = [p for p in remaining if p not in body_keys][:needed]
        body_keys.extend(pad)
        extra_added.extend(pad)
        used.update(pad)

    # ensure at least 1 intro + 2 middles + 1 concl
    total = (1 if intro_key else 0) + len(body_keys) + (1 if concl_key else 0)
    if total < 4:
        more = [p for p in remaining if p not in body_keys][:4-total]
        body_keys.extend(more)
        extra_added.extend(more)
        used.update(more)

    # build parts
    parts = []
    preamble = extract_preamble_text(full_text, intro_key, raw_secs)

    if preamble:
        parts.append(f"## Header\n\n{preamble}")
    for k in header_keys:
        parts.append(f"## {k}\n\n{get_body(secs[k])}")
    if intro_key:
        parts.append(f"## {intro_key}\n\n{get_body(secs[intro_key])}")
    if body_keys:
        def bump(md): return re.sub(r'(?m)^(#{1,5})', lambda m:'#'*(len(m.group(1))+1), md)
        blocks = [f"### {k}\n\n{bump(get_body(secs[k]))}" for k in body_keys if k in secs]
        parts.append("## Key Sections\n\n"+"\n\n---\n\n".join(blocks))
    if concl_key:
        parts.append(f"## {concl_key}\n\n{get_body(secs[concl_key])}")
    payload = "\n\n---\n\n".join(parts).strip()

    # enforce token limits

    MIN_TOKENS = 5000
    MAX_TOKENS = 10000
    TARGET_MAX = MAX_TOKENS  # single bound we actually enforce
    MIN_MIDDLE = 1  # keep at least this many body sections

    import tiktoken
    # pick the right encoding for your model;
    def count_tokens(text: str, model_name: str = "gpt-4o") -> int:
        """
        Return the number of tokens in `text` for a given OpenAI model.
        Falls back to known encodings if the model name is unregistered.
        """
        try:
            # Automatically resolves to the correct encoding for the model
            encoding = tiktoken.encoding_for_model(model_name)
        except (KeyError, ValueError):
            # Explicit fallback: GPT-4o variants → o200k_base; others → cl100k_base
            if model_name.startswith("gpt-4o"):
                encoding = tiktoken.get_encoding("o200k_base")
            else:
                encoding = tiktoken.get_encoding("cl100k_base")
        # Count tokens by encoding
        return len(encoding.encode(text))

    def build_payload():
        import re
        # bump headings helper
        def bump(md: str) -> str:
            return re.sub(r'(?m)^(#{1,5})', lambda m: '#' * (len(m.group(1)) + 1), md)

        parts_local = []
        if preamble:
            parts_local.append(f"## Header\n\n{preamble}")
        for k in header_keys:
            parts_local.append(f"## {k}\n\n{get_body(secs[k])}")
        if intro_key:
            parts_local.append(f"## {intro_key}\n\n{get_body(secs[intro_key])}")
        if body_keys:
            bumped = [
                f"### {k}\n\n{bump(get_body(secs[k]))}"
                for k in body_keys if k in secs
            ]
            parts_local.append("## Key Sections\n\n" + "\n\n---\n\n".join(bumped))
        if concl_key:
            parts_local.append(f"## {concl_key}\n\n{get_body(secs[concl_key])}")
        return "\n\n---\n\n".join(parts_local).strip()

    def rebuild_and_count():
        p = build_payload()
        return p, count_tokens(p)

    payload = build_payload()
    token_count = count_tokens(payload)
    initial_token_count = token_count
    dropped_smallest_section = None
    added_smallest_section = None

    # ---------- hard trim loop (drop smallest sections until <= TARGET_MAX) ----------
    must_keep: set[str] = set()
    if intro_key: must_keep.add(intro_key)
    if concl_key: must_keep.add(concl_key)

    def droppable_pool() -> list[str]:
        # Prefer extras first
        pool = [k for k in extra_added if k in body_keys]
        if pool:
            return pool
        # Fallback: any body section not in must_keep, while respecting MIN_MIDDLE
        current_body = [k for k in body_keys if k not in must_keep]
        if len(current_body) > MIN_MIDDLE:
            return current_body
        return []

    while token_count > TARGET_MAX:
        pool = droppable_pool()
        if not pool:
            break
        sizes = {k: count_tokens(secs.get(k, "")) for k in pool}
        smallest = min(sizes, key=sizes.get)
        if smallest in body_keys:
            body_keys.remove(smallest)
        if smallest in extra_added:
            extra_added.remove(smallest)
        used.discard(smallest)
        dropped_smallest_section = smallest
        payload, token_count = rebuild_and_count()

    # ---------- pad loop (add smallest remaining while staying <= TARGET_MAX) ----------
    while token_count < MIN_TOKENS:
        remaining = [k for k in secs if k not in used and k not in must_keep]
        if not remaining:
            break
        sizes = {k: count_tokens(secs[k]) for k in remaining}
        smallest = min(sizes, key=sizes.get)
        # tentative add
        body_keys.append(smallest)
        extra_added.append(smallest)
        used.add(smallest)
        payload_tmp, tmp_tokens = rebuild_and_count()
        if tmp_tokens > TARGET_MAX:
            # revert and stop padding
            body_keys.pop()
            extra_added.pop()
            used.discard(smallest)
            break
        payload, token_count = payload_tmp, tmp_tokens
        added_smallest_section = smallest

    # ---------- final guard: if still above TARGET_MAX, trim more (fallback over any body) ----------
    while token_count > TARGET_MAX:
        pool = [k for k in body_keys if k not in must_keep]
        if len(pool) <= MIN_MIDDLE:
            break
        sizes = {k: count_tokens(secs.get(k, "")) for k in pool}
        smallest = min(sizes, key=sizes.get)
        body_keys.remove(smallest)
        if smallest in extra_added:
            extra_added.remove(smallest)
        used.discard(smallest)
        dropped_smallest_section = smallest
        payload, token_count = rebuild_and_count()

    # Summary log
    log = {
        "intro": bool(intro_key),
        "conclusion": bool(concl_key),
        "predefined": predefined_found,
        "extra": extra_added,
        "sections_raw": len(raw_secs),
        "sections_clean": len(secs),
        "payload_tokens_before": initial_token_count,
        "payload_tokens_after": token_count,
        "dropped_section": dropped_smallest_section or "None",
        "added_section": added_smallest_section or "None",
    }

    if log["intro"] and log["conclusion"] and len(body_keys) >= MIN_MIDDLE:
        log["doc_status"] = "SUCCESS"
    elif log["intro"] and log["conclusion"]:
        log["doc_status"] = "PARTIAL_BODY"
    elif log["intro"]:
        log["doc_status"] = "MISSING_CONCLUSION"
    elif log["conclusion"]:
        log["doc_status"] = "MISSING_INTRODUCTION"
    else:
        log["doc_status"] = "NO_CORE_SECTIONS"
    # ── if core_sections: keep only intro & conclusion ────────────────
    if core_sections:
        core_payload_parts = []
        if intro_key:
            core_payload_parts.append(f"## {intro_key}\n\n{get_body(secs[intro_key])}")
        if concl_key:
            core_payload_parts.append(f"## {concl_key}\n\n{get_body(secs[concl_key])}")
        payload = "\n\n---\n\n".join(core_payload_parts).strip()
        token_count = count_tokens(payload)
        secs = {k: secs[k] for k in (intro_key, concl_key) if k}
        header_keys = []
        body_keys = []
        extra_added = []

    # ────────────────────────────────────────────────────────────────

    summary_log = (
        "---LOG_SUMMARY_START---\n"
        f"doc_status:{log['doc_status']}\n"
        f"sections_raw:{log['sections_raw']}\n"
        f"sections_clean:{log['sections_clean']}\n"
        f"intro:{'FOUND' if log['intro'] else 'MISSING'}\n"
        f"conclusion:{'FOUND' if log['conclusion'] else 'MISSING'}\n"
        f"predefined_sections:{'|'.join(log['predefined']) or 'None'}\n"
        f"extra_sections:{'|'.join(log['extra']) or 'None'}\n"
        f"payload_tokens_before:{log['payload_tokens_before']}\n"
        f"payload_tokens_after:{log['payload_tokens_after']}\n"
        f"dropped_section:{log['dropped_section']}\n"
        f"added_section:{log['added_section']}\n"
        "---LOG_SUMMARY_END---"
    )
    logger.info(summary_log)

    return {
        "toc": toc,
        "secs": secs,
        "full_text": full_text,
        "flat_text": full_text,
        "payload": payload,
        "process_log": processing_log,
        "summary_log": summary_log
    }




# code for replacement
def _unwrap_softwraps(md: str) -> str:
    md = md.replace("\r\n", "\n").replace("\r", "\n")

    # ① de-hyphenate PDF wraps like "conduct-\n ing" → "conducting"
    md = re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', md)

    lines = md.split("\n")
    out: list[str] = []
    in_code = False
    fence_re = re.compile(r'^\s*```')

    def is_structural(s: str) -> bool:
        s_stripped = s.lstrip()
        return (
            s_stripped.startswith(("#", ">", "```")) or
            re.match(r'^\s*[-*]\s+\S', s) is not None or               # bullets
            re.match(r'^\s*\d+\.\s+\S', s) is not None or              # ordered lists
            s_stripped.startswith("|") or                               # tables
            re.match(r'^\s*:?-{3,}:?\s*$', s_stripped) is not None or   # hr / table aligns
            s_stripped == ""                                            # blank line
        )

    for line in lines:
        if fence_re.match(line):
            in_code = not in_code
            out.append(line)
            continue
        if in_code:
            out.append(line)
            continue

        if not out:
            out.append(line)
            continue

        prev = out[-1]

        # keep structure and hard line breaks
        if is_structural(line) or prev.endswith("  "):
            out.append(line)
            continue

        # join soft-wrapped paragraph lines
        if prev.strip() and line.strip():
            out[-1] = prev.rstrip() + " " + line.strip()
        else:
            out.append(line)

    return "\n".join(out)

# --- Main PDF Processing Function ---


def process_pdf(
        pdf_path: str,
        cache: bool = False,
        cache_full: bool = True,
        mistral_model: str = "mistral-ocr-latest",
        ocr_retry: int = 5,
        core_sections: bool = True,
) -> Optional[Dict[str, Any]]:
    """
    Extract a PDF into markdown and structured sections with intelligent caching.

    Caching rules
    -------------
    - cache=True  → if a full cached result (with sections) exists, return it immediately.
    - cache=False → ignore cached sections/metadata, but:
        • if cache_full=True  and we have cached full_text → reuse that full_text,
          recompute everything else (citations, sections, payload, etc.).
        • if cache_full=False → ignore even full_text and re-extract/OCR from PDF.

    We still persist the new result back to the same cache file at the end.
    """
    if not pdf_path.lower().endswith(".pdf"):
        raise ValueError("Source must be a PDF file.")

    llm4_kwargs = {"page_chunks": True, "write_images": False}

    cache_file = Path(_cache_path(pdf_path))
    full_md = None
    logs_md: Dict[str, Any] = {}  # parser diagnostics (dict)
    references: List[str] | str = ""

    # ------------ helpers ------------
    import re as _re
    def _word_count(s: str) -> int:
        return len(_re.findall(r"\w+", s or ""))

    def _count_tokens(text: str, model_name: str = "gpt-4o") -> int:
        try:
            import tiktoken
            try:
                enc = tiktoken.encoding_for_model(model_name)
            except (KeyError, ValueError):
                enc = tiktoken.get_encoding("o200k_base" if model_name.startswith("gpt-4o") else "cl100k_base")
            return len(enc.encode(text or ""))
        except Exception:
            return len((text or "").split())

    # --- 1) Cache lookup ---
    cached_data = None
    if cache_file.is_file() and cache_file.stat().st_size > 0:
        print(f"[LOG] (cache) Found cache at {cache_file}")
        try:
            cached_data = json.loads(cache_file.read_text(encoding="utf-8"))

            # backfill older caches with flat_text/citations/summary if missing
            if "full_text" in cached_data:
                if "citations" not in cached_data or "flat_text" not in cached_data:
                    try:
                        _cit = link_citations_to_footnotes({
                            "full_text": cached_data.get("full_text", ""),
                            "references": cached_data.get("references", []),
                        })
                        cached_data["citations"] = _cit
                        cached_data["flat_text"] = _cit.get("flat_text", cached_data.get("full_text", ""))
                    except Exception:
                        cached_data.setdefault("citations", {"total": {}, "results": [], "flat_text": cached_data.get("full_text", "")})
                        cached_data.setdefault("flat_text", cached_data.get("full_text", ""))

                if "summary" not in cached_data:
                    ft = cached_data.get("full_text", "")
                    fl = cached_data.get("flat_text", ft)
                    cached_data["summary"] = {
                        "full_text": {"words": _word_count(ft), "tokens": _count_tokens(ft)},
                        "flat_text": {"words": _word_count(fl), "tokens": _count_tokens(fl)},
                    }

                # Always keep cache file tidy
                cache_file.write_text(json.dumps(cached_data, ensure_ascii=False, indent=2), encoding="utf-8")

            # Fast return: full cached object allowed?
            if cache and cached_data and cached_data.get("sections"):
                return cached_data

            # Otherwise we will recompute – decide what to do with full_text.
            if not cache and cache_full and cached_data and cached_data.get("full_text"):
                full_md = cached_data["full_text"]
                references = cached_data.get("references", [])
                print("[LOG] Will reuse cached full_text (cache_full=True) and recompute sections/metadata.")

            if not cache and not cache_full:
                print("[LOG] cache=False and cache_full=False → will re-extract/OCR full_text from PDF.")

        except json.JSONDecodeError:
            print("[WARNING] Cache file is corrupt, ignoring.")

    # --- 2) PDF Extraction & OCR (only if we didn't reuse cached full_text) ---
    if full_md is None:
        print(f"[LOG] Processing PDF from scratch: {pdf_path}")

        try:
            doc = fitz.open(pdf_path)
        except Exception:
            doc = fitz.open(_repair_pdf(pdf_path))

        page_list = list(range(doc.page_count))
        doc.close()

        segments = [""] * len(page_list)
        needs_ocr: List[int] = []

        for pos, pidx in enumerate(page_list):
            try:
                txt = pymupdf4llm.to_markdown(pdf_path, pages=[pidx], **llm4_kwargs)
                if txt:
                    segments[pos] = txt.strip()
                else:
                    raise ValueError("No embedded text")
            except Exception:
                needs_ocr.append(pidx)

        if needs_ocr:
            print(f"[LOG] Found {len(needs_ocr)} pages requiring OCR.")

            # Map original page index -> position in segments
            pos_map = {p: i for i, p in enumerate(page_list)}

            # throttle large sets first
            if len(needs_ocr) > 150:
                needs_ocr = needs_ocr[:60] + needs_ocr[-60:]
            if len(needs_ocr) > 300:
                needs_ocr = needs_ocr[:250]

            def split_batches_by_size(pages: list[int], max_pages: int = 40) -> list[list[int]]:
                batches: list[list[int]] = []

                def build_pdf_bytes(pg_list: list[int]) -> bytes:
                    s, d = fitz.open(pdf_path), fitz.open()
                    try:
                        for pg in pg_list:
                            if 0 <= pg < s.page_count:
                                try:
                                    d.insert_pdf(s, from_page=pg, to_page=pg, links=False, annots=False)
                                except Exception as ex:
                                    print(f"[WARNING] insert_pdf failed on page {pg}: {ex}")
                            else:
                                print(f"[WARNING] Skipping page {pg} – out of bounds")
                        if d.page_count == 0:
                            return b""
                        return d.tobytes()
                    finally:
                        s.close(); d.close()

                def ensure_under_cap(pg_list: list[int]):
                    if not pg_list:
                        return
                    pdf_bytes = build_pdf_bytes(pg_list)
                    if not pdf_bytes:
                        return
                    if len(pdf_bytes) <= 47 * 1024 * 1024:
                        batches.append(pg_list); return
                    if len(pg_list) == 1:
                        batches.append(pg_list); return
                    mid = len(pg_list) // 2
                    ensure_under_cap(pg_list[:mid]); ensure_under_cap(pg_list[mid:])

                for i in range(0, len(pages), max_pages):
                    ensure_under_cap(pages[i:i + max_pages])
                return batches

            client = Mistral(api_key=api_key)
            all_batches = split_batches_by_size(needs_ocr, max_pages=40)
            print(f"[LOG] OCR will run in {len(all_batches)} batch(es).")

            ocr_text_by_page: dict[int, str] = {}

            for bi, batch in enumerate(all_batches, 1):
                src, dst = fitz.open(pdf_path), fitz.open()
                for p in batch:
                    if 0 <= p < src.page_count:
                        try:
                            dst.insert_pdf(src, from_page=p, to_page=p, links=False, annots=False)
                        except Exception as ex:
                            print(f"[WARNING] insert_pdf failed on page {p}: {ex}")
                    else:
                        print(f"[WARNING] Skipping page {p} – out of bounds")
                if dst.page_count == 0:
                    print(f"[WARNING] Batch {bi} had no valid pages; skipping.")
                    src.close(); dst.close(); continue
                pdf_bytes = dst.tobytes()
                src.close(); dst.close()

                print(f"[LOG] Uploading OCR batch {bi}/{len(all_batches)} "
                      f"({len(batch)} pages, {len(pdf_bytes) / 1024 / 1024:.2f} MB)")

                upload = client.files.upload(
                    file={"file_name": f"ocr_batch_{bi}.pdf", "content": pdf_bytes},
                    purpose="ocr"
                )
                signed = client.files.get_signed_url(file_id=upload.id).url

                ocr_resp = None
                for delay in _exponential_backoff(ocr_retry):
                    try:
                        ocr_resp = client.ocr.process(
                            model=mistral_model,
                            document={"type": "document_url", "document_url": signed}
                        )
                        break
                    except m_models.SDKError as e:
                        status = getattr(e, "status", None)
                        if status == 429:
                            print(f"[WARNING] OCR rate limit hit, sleeping for {delay:.2f}s...")
                            time.sleep(delay); continue
                        elif status == 400:
                            if len(batch) > 1:
                                print("[WARNING] Batch still too large for OCR; splitting and retrying.")
                                mid = len(batch) // 2
                                all_batches[bi - 1:bi] = [batch[:mid], batch[mid:]]
                                ocr_resp = None
                                break
                            else:
                                raise
                        else:
                            raise

                if not ocr_resp:
                    continue

                results = ocr_resp.model_dump().get("pages", [])
                for i, page_info in enumerate(results):
                    orig_page = batch[i] if i < len(batch) else batch[-1]
                    text = (page_info.get("markdown") or page_info.get("text", "")).strip()
                    ocr_text_by_page[orig_page] = text

            for orig_page, text in ocr_text_by_page.items():
                if text:
                    segments[pos_map[orig_page]] = text

        full_md = "\n\n".join(segments)
        # drop images
        full_md = re.sub(r'!\[.*?\]\(.*?\)', '', full_md)
        # vendor preamble cleaner
        full_md = clean_hein_header(full_md)

        # Pull off References block (kept separately)
        def _extract_references_from_md(md: str, first_page_end: int = 0) -> Tuple[str, List[str]]:
            refs: List[str] = []
            ref_match = next((m for m in _REFERENCE_HEADING_RE.finditer(md) if m.start() > first_page_end), None) or \
                        next((m for m in _ENDNOTES_HEADING_RE.finditer(md) if m.start() > first_page_end), None)
            if ref_match:
                ref_block = md[ref_match.start():].strip()
                refs.append(ref_block)
                md = md[:ref_match.start()].rstrip()
            return md, refs

        first_page_end = len(segments[0]) if 'segments' in locals() and segments else 0
        full_md, references = _extract_references_from_md(full_md, first_page_end)

    # Optional: strip footnotes/citations from parsing text only
    parse_text = full_md

    # Link citations to footnotes (uses original, un-stripped text for flat view)
    link_out = link_citations_to_footnotes(full_md, references)
    flat_text = link_out.get("flat_text", full_md)
    html_full = convert_citations_to_html(flat_text, link_out)

    # --- 4) Parsing & Section Cleaning (from parse_text, not flat) ---
    toc, sections, logs_md = parse_markdown_to_final_sections(flat_text)
    print(f"[LOG] Raw parse created {len(sections)} top-level sections. Cleaning...")

    intro_data = extract_intro_conclusion_pdf_text(
        full_text=parse_text, raw_secs=sections, processing_log=logs_md, core_sections=core_sections
    )

    payload = intro_data.get("payload")
    summary_log = intro_data.get("summary_log")
    processing_log = intro_data.get("process_log", logs_md)

    cleaned_sections = sections
    JUNK_HEADING_KEYWORDS = {
        'citations', 'bluebook', 'alwd', 'apa', 'chicago', 'mcgill',
        'aglc', 'mla', 'oscola', 'note', 'downloaded', 'source',
        'your use of this heinonline pdf', 'license agreement'
    }
    # for title, content in sections.items():
    #     title_lower = title.lower()
    #     if len(title.split()) > 20 or any(kw in title_lower for kw in JUNK_HEADING_KEYWORDS):
    #         continue
    #     if is_content_legitimate(content):
    #         cleaned_sections[title] = content

    # print(f"[LOG] After cleaning, {len(cleaned_sections)} legitimate sections remain.")

    # --- 5) Summary counts (words + tokens for both full and flat) ---
    full_words = _word_count(full_md)
    flat_words = _word_count(flat_text)
    full_tokens = _count_tokens(full_md)
    flat_tokens = _count_tokens(flat_text)
    summary = {
        "full_text": {"words": full_words, "tokens": full_tokens},
        "flat_text": {"words": flat_words, "tokens": flat_tokens},
    }

    # --- 6) Persist cache and return ---
    result_to_cache: Dict[str, Any] = {}
    if cleaned_sections:
        result_to_cache.update({
            "full_text": full_md,
            "flat_text": flat_text,
            "html": html_full,
            "toc": [(1, title) for title in cleaned_sections.keys()],
            "sections": cleaned_sections,
            "process_log": processing_log,
            "word_count": flat_words,
            "references": references,
            "citations": link_out,
            "summary": summary,
            "payload": payload,
            "summary_log": summary_log
        })

    else:
        result_to_cache.update({
            "full_text": full_md,
            "flat_text": flat_text,
            "html": html_full,
            "citations": link_out,
            "summary": summary,
            "payload": payload,
            "summary_log": summary_log
        })

    # Always re-write cache with the latest recomputation (even when cache=False)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(result_to_cache, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "full_text": full_md,
        "flat_text": result_to_cache.get("flat_text", full_md),
        "html": result_to_cache.get("html", convert_citations_to_html(full_md, link_out)),
        "toc": result_to_cache.get("toc", []),
        "sections": result_to_cache.get("sections", {}),
        "process_log": processing_log,
        "word_count": full_words,
        "references": result_to_cache.get("references", []),
        "citations": result_to_cache.get("citations", {"total": {}, "results": [], "flat_text": full_md}),
        "summary": result_to_cache.get("summary", summary),
        "payload": payload,
        "summary_log": summary_log
    }

    """
    Append *markdown* to <project_root>/<filename>.
    Creates the file and its parent folder if needed.
    """
    # location: one level *above* the current .py file  →  project root
    project_root = Path(__file__).resolve().parent
    toc_path = project_root / filename          # e.g.  .../TOC.md

    toc_path.parent.mkdir(parents=True, exist_ok=True)  # safe: no error if exists

    with toc_path.open("a", encoding="utf-8") as f:     # 'a' → append, no overwrite
        f.write(markdown)
        if not markdown.endswith("\n"):
            f.write("\n")

def append_toc(markdown: str, filename: str = "TOC.md") -> None:
    """
    Append *markdown* to <project_root>/<filename>.
    Creates the file and its parent folder if needed.
    """
    # location: one level *above* the current .py file  →  project root
    project_root = Path(__file__).resolve().parent
    toc_path = project_root / filename  # e.g.  .../TOC.md

    toc_path.parent.mkdir(parents=True, exist_ok=True)  # safe: no error if exists

    with toc_path.open("a", encoding="utf-8") as f:  # 'a' → append, no overwrite
        f.write(markdown)
        if not markdown.endswith("\n"):
            f.write("\n")


                     # final newline (optional)
def _normalise(text: str) -> str:
    """• map PUA digits → 0-9   • remove soft hyphen   • de-hyphenate line-breaks"""
    # PUA → ASCII digits + remove soft hyphen
    txt = "".join(_PUA_DIGIT.get(ch, ch) for ch in text).replace(SOFT_HYPH, "")
    # de-hyphenate words split at EOL:  opera-\n tion  →  operation
    return re.sub(r"-\s*\n\s*(\w)", r"\1", txt)


def check_keyword_details_pdf(
    pdf_path: Union[str, Path],
    keywords: Union[str, List[str]],
    html: bool = False,
) -> Optional[Dict[str, Union[int, List[Dict[str, Any]]]]]:
    """Scan *pdf_path* (or an HTML file if `html=True`) for *keywords*; return total
    hits and per-paragraph matches.

    Parsing:
      - Loads HTML (via `process_pdf(...).get("html")` or directly from file if `html=True`).
      - Builds sections by walking h1–h6; paragraphs are text from <p>/<li>.
      - **Only text nodes** are used (`.get_text()`), so attributes like `title=""`
        are ignored.

    Matching:
      - Exact-word boundaries, case-insensitive.
      - Allows soft hyphen (U+00AD), '-' or whitespace between letters to survive PDF artifacts.

    Output (for each match):
      - "keyword": the matched keyword
      - "paragraph": a single <p>…</p> with the **keyword occurrences** wrapped in <mark>.
      - "section": the full section as HTML (a sequence of <p>…</p>), where the **entire
        paragraph containing the hit** is wrapped in <mark>…</mark> (the whole paragraph is highlighted).
      - "total": total number of keyword occurrences found across the document.
    """
    pdf = Path(str(pdf_path))
    if not pdf.exists():
        logging.error("File not found: %s", pdf)
        return None

    # Normalize keywords → list of non-empty strings
    kw_list = [keywords] if isinstance(keywords, str) else list(keywords or [])
    kw_list = [kw.strip() for kw in kw_list if isinstance(kw, str) and kw.strip()]
    if not kw_list:
        return {"total": 0, "matches": []}

    # ── Load HTML ────────────────────────────────────────────────────────────────
    def _load_html_text() -> str:
        if html:
            try:
                return pdf.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                return pdf.read_bytes().decode("utf-8", errors="ignore")
        # Expect `process_pdf` (provided elsewhere) that returns dict with "html"
        try:
            md_dict = process_pdf(pdf_path=str(pdf))  # type: ignore[name-defined]
        except NameError as e:
            raise RuntimeError(
                "process_pdf(...) is not defined; set html=True to pass an HTML file directly."
            ) from e
        html_text = (md_dict or {}).get("html")
        if not html_text:
            raise RuntimeError("No HTML produced by process_pdf(...)")
        return html_text

    html_text = _load_html_text()

    # ── Parse sections from HTML using Soup; TEXT NODES ONLY ────────────────────
    HEADING_NAMES = {f"h{i}" for i in range(1, 7)}
    PARA_LIKE = {"p", "li"}

    def _is_footnoteish(tag) -> bool:
        """Skip typical footnote/reference containers (crude heuristic)."""
        for anc in tag.parents:
            if not getattr(anc, "get", None):
                continue
            cid = (anc.get("id") or "").lower()
            cls = " ".join(anc.get("class") or []).lower()
            nm = (anc.name or "").lower()
            blob = f"{cid} {cls} {nm}"
            if any(k in blob for k in ("footnote", "footnotes", "references", "bibliograph")):
                return True
        return False

    soup = BeautifulSoup(html_text, "html.parser")
    root = soup.body or soup

    sections_text: List[Tuple[str, List[str]]] = []  # [(section_title, [para_texts])]
    current_title = "Document"
    current_paras: List[str] = []

    def _finalize_section():
        nonlocal current_title, current_paras
        sections_text.append((current_title, current_paras))
        current_paras = []

    def _normalize_para_text(t: str) -> str:
        t = t.replace("\u00ad", "")              # strip soft hyphen
        t = re.sub(r"[ \t\r\f\v]+", " ", t)     # normalize spaces
        t = re.sub(r"\s*\n\s*", " ", t)         # collapse newlines
        return t.strip()

    for el in root.find_all(True, recursive=True):
        if _is_footnoteish(el):
            continue

        name = (el.name or "").lower()
        if name in HEADING_NAMES:
            # Close previous section (if it has any paragraphs)
            if current_paras:
                _finalize_section()
            current_title = el.get_text(" ", strip=True) or current_title
            continue

        if name in PARA_LIKE:
            txt = el.get_text(" ", strip=True)  # TEXT ONLY: attributes ignored
            txt = _normalize_para_text(txt)
            if txt:
                current_paras.append(txt)

    # finalize last section
    if current_paras:
        _finalize_section()
    if not sections_text:
        sections_text.append(("Document", []))

    # ── Exact-normalized keyword regex ──────────────────────────────────────────
    def _kw_pat(word: str) -> re.Pattern:
        """
        Match the word with optional separators between letters:
        whitespace / soft hyphen (U+00AD) / '-' ; case-insensitive; word boundaries.
        """
        word = (word or "").strip()
        if not word:
            return re.compile(r"$^")
        parts = [re.escape(word[0])]
        for ch in word[1:]:
            parts.append(r"(?:[\s\u00ad-]+)?" + re.escape(ch))
        return re.compile(r"\b" + "".join(parts) + r"\b", re.I | re.UNICODE)

    kw_regex: Dict[str, re.Pattern] = {kw: _kw_pat(kw) for kw in kw_list}

    # ── Safe highlighters (escape + insert <mark>) ──────────────────────────────
    def _mark_text_html(text: str, pat: re.Pattern) -> str:
        """Escape text safely and wrap each match in <mark>…</mark>."""
        # Find match spans on the raw text
        spans = [(m.start(), m.end()) for m in pat.finditer(text)]
        if not spans:
            return "<p>" + _escape(text) + "</p>"

        # Rebuild with escaping per segment
        out_parts: List[str] = []
        last = 0
        for s, e in spans:
            if s > last:
                out_parts.append(_escape(text[last:s]))
            out_parts.append("<mark>" + _escape(text[s:e]) + "</mark>")
            last = e
        if last < len(text):
            out_parts.append(_escape(text[last:]))
        return "<p>" + "".join(out_parts) + "</p>"

    def _render_section_with_para_highlight(paras: List[str], target_idx: int) -> str:
        """Render entire section as HTML; wrap the ENTIRE target paragraph in <mark>."""
        html_chunks: List[str] = []
        for i, ptxt in enumerate(paras):
            escaped = _escape(ptxt)
            if i == target_idx:
                html_chunks.append(f"<p><mark>{escaped}</mark></p>")
            else:
                html_chunks.append(f"<p>{escaped}</p>")
        return "".join(html_chunks)

    # ── Scan and collect results ────────────────────────────────────────────────
    matches_out: List[Dict[str, Any]] = []
    total = 0
    seen: Set[Tuple[int, int, str]] = set()  # (section_index, para_index, keyword)

    for s_idx, (_title, paras) in enumerate(sections_text):
        for p_idx, para in enumerate(paras):
            for kw, pat in kw_regex.items():
                hits = list(pat.finditer(para))
                if not hits:
                    continue

                total += len(hits)

                # De-dupe per (section, paragraph, keyword)
                key = (s_idx, p_idx, kw)
                if key in seen:
                    continue
                seen.add(key)

                para_html = _mark_text_html(para, pat)
                section_html = _render_section_with_para_highlight(paras, p_idx)

                matches_out.append({
                    "keyword": kw,
                    "paragraph": para_html,     # <p>… with <mark> on the keyword(s)
                    "section": section_html,    # full section; ENTIRE paragraph wrapped in <mark>
                })

    return {"total": total, "matches": matches_out}

def _encode_max_items_for_signature(mi):
    """
    For cache signatures ONLY.
    - None → "all" (explicitly unlimited)
    - 0    → "all" (treat zero as unlimited for signature stability)
    - int  → that integer
    """
    try:
        if mi is None or int(mi) == 0:
            return "all"
        return int(mi)
    except Exception:
        return "all"
def extract_content_for_keywords(
        full_df: pd.DataFrame,
        items_to_code_with_keywords_map: dict,
        zotero_client_instance,
        globally_suggested_keywords: list = None,
        progress_callback=None,
        max_items=21,
        cache: bool = True,
) -> dict:
    """
    Extract content snippets from PDFs based on item-specific or global keywords.

    Refinement:
      • Adds a *keyword-first* cache key (digest of all provided keywords) that is checked immediately.
      • Retains the existing LIGHT signature cache (df+map+globals) for precision.
      • Never touches Zotero on cache reads.
    """

    def _stable_json(obj) -> str:
        return json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str)

    def _hash_df_signature(df: pd.DataFrame) -> dict:
        cols = list(df.columns)
        try:
            if "key" in df.columns:
                key_series = df["key"].astype(str).fillna("").tolist()
                h = hashlib.sha256("\n".join(key_series).encode("utf-8")).hexdigest()
                return {"rows": int(df.shape[0]), "cols": cols, "key_hash": h, "mode": "key_only"}
            csv_bytes = df.to_csv(index=False).encode("utf-8", errors="ignore")
            h = hashlib.sha256(csv_bytes).hexdigest()
            return {"rows": int(df.shape[0]), "cols": cols, "csv_hash": h, "mode": "csv_full"}
        except Exception as _e:
            return {"rows": int(df.shape[0]), "cols": cols, "error": str(_e), "mode": "error"}

    def _collect_target_item_keys(df: pd.DataFrame,
                                  items_map: dict,
                                  globals_list: list | None,
                                  max_items: int) -> list[str]:
        tgt = set()
        if isinstance(items_map, dict) and items_map:
            tgt.update(items_map.keys())
        elif globals_list:
            if "key" in df.columns:
                tgt.update(df["key"].dropna().astype(str).tolist())
        ordered = sorted(str(k) for k in tgt)
        # Respect "no limit" when max_items is None or 0
        if max_items is None or (isinstance(max_items, int) and max_items <= 0):
            return ordered
        return ordered[: int(max_items)]

    def _norm_kw_map(d: dict) -> dict:
        out = {}
        for k, v in (d or {}).items():
            if isinstance(v, (list, tuple, set)):
                vals = sorted(str(x).strip() for x in v if str(x).strip())
            else:
                vals = [str(v).strip()] if (v is not None and str(v).strip()) else []
            out[str(k)] = vals
        return dict(sorted(out.items(), key=lambda kv: kv[0]))

    # --------- KEYWORD-FIRST CACHE READ (no Zotero calls here) ---------
    # Build a digest over the *keywords input* only (per-item + global), independent of data source.
    try:
        _norm_map = _norm_kw_map(items_to_code_with_keywords_map)
        _glob_kws = sorted(str(x).strip() for x in (globally_suggested_keywords or []) if str(x).strip())
        # Flatten all unique keywords across mapping + globals
        _all_kw = sorted({kw for kws in _norm_map.values() for kw in kws} | set(_glob_kws))
        _kw_digest = hashlib.sha256("\n".join(_all_kw).encode("utf-8")).hexdigest() if _all_kw else None

        if cache and _kw_digest:
            _kw_cache_file = Path(CACHE_DIR) / f"extract_content_kw_{_kw_digest}.json"
            if _kw_cache_file.is_file() and _kw_cache_file.stat().st_size > 0:
                try:
                    return json.loads(_kw_cache_file.read_text(encoding="utf-8"))
                except Exception as _e:
                    logging.warning(f"[cache/kw] read failed ({_kw_cache_file}): {_e}")
    except Exception as _kw_cache_err:
        logging.warning(f"[cache/kw] digest build failed: {_kw_cache_err}")

    # --------- LIGHT SIGNATURE CACHE READ (no Zotero calls here) ---------
    try:
        # Note: we recompute here to be explicit (no side-effects before execution)
        _glob_kws = sorted(str(x).strip() for x in (globally_suggested_keywords or []) if str(x).strip())
        _df_sig = _hash_df_signature(full_df)
        _sig_payload = {
            "fn": "extract_content_for_keywords",
            "version": 4,
            "df": _df_sig,
            "items_to_code_with_keywords_map": _norm_kw_map(items_to_code_with_keywords_map),
            "globally_suggested_keywords": _glob_kws,
            "max_items": _encode_max_items_for_signature(max_items),  # None→"all"
            "zotero_client_class": type(zotero_client_instance).__name__ if zotero_client_instance else None,
        }
        _sig_hash = hashlib.sha256(_stable_json(_sig_payload).encode("utf-8")).hexdigest()
        _cache_file_path = Path(CACHE_DIR) / f"extract_content_{_sig_hash}.json"

        if cache and _cache_file_path.is_file() and _cache_file_path.stat().st_size > 0:
            try:
                return json.loads(_cache_file_path.read_text(encoding="utf-8"))
            except Exception as _e:
                logging.warning(f"[cache/light] read failed ({_cache_file_path}): {_e}")
    except Exception as _cache_build_err:
        logging.warning(f"[cache/light] signature build failed: {_cache_build_err}")

    # --------- EXECUTION ---------
    def _callback(msg):
        if progress_callback:
            progress_callback(msg)
        logging.info(msg)

    _callback("Initiating PDF content extraction based on keywords...")

    all_coded_notes = []
    items_processed_count = 0

    if "key" not in full_df.columns:
        _callback("CRITICAL ERROR: 'key' column missing in DataFrame. Cannot map items for PDF extraction.")
        return {"type": "error", "data": "'key' column missing in input DataFrame.",
                "description": "PDF Content Extraction Error"}

    target_item_keys = set()
    if isinstance(items_to_code_with_keywords_map, dict):
        target_item_keys.update(items_to_code_with_keywords_map.keys())

    if not target_item_keys and globally_suggested_keywords:
        _callback("No specific items targeted; applying global keywords to all items in DataFrame.")
        target_item_keys.update(full_df["key"].dropna().tolist())
    elif not target_item_keys and not globally_suggested_keywords:
        _callback("No items targeted and no global keywords provided. Nothing to scan.")
        return {"type": "coded_notes_list", "data": [], "description": "No items/keywords specified for PDF scan."}

    total_items_to_scan = len(target_item_keys)
    _callback(f"Identified {total_items_to_scan} unique items for potential PDF scanning.")

    df_indexed = full_df.set_index("key", drop=False)
    target_item_keys = sorted(target_item_keys)

    for n, item_key in enumerate(target_item_keys):
        if isinstance(max_items, int) and max_items > 0 and n >= max_items:
            break

        if item_key not in df_indexed.index:
            _callback(f"Warning: Item key '{item_key}' not found in DataFrame. Skipping.")
            continue

        row = df_indexed.loc[item_key]

        # Build keyword list
        current_keywords_for_item = []
        if isinstance(items_to_code_with_keywords_map, dict) and item_key in items_to_code_with_keywords_map:
            current_keywords_for_item.extend(str(kw) for kw in items_to_code_with_keywords_map[item_key] if kw)
        if globally_suggested_keywords:
            gk = [str(kw) for kw in globally_suggested_keywords if kw]
            current_keywords_for_item.extend(kw for kw in gk if kw not in current_keywords_for_item)
        current_keywords_for_item = sorted(set(kw.strip() for kw in current_keywords_for_item if kw and kw.strip()))
        if not current_keywords_for_item:
            _callback(f"No valid keywords for item {item_key}. Skipping.")
            continue

        # Resolve PDF path: prefer DataFrame's 'pdf_path' first
        pdf_path = None
        row_pdf_path = str(row.get("pdf_path", "") or "").strip() if isinstance(row, pd.Series) else ""
        if row_pdf_path:
            p = Path(row_pdf_path)
            if p.exists():
                pdf_path = str(p)

        # Fallback to Zotero only if no usable path AND a client is provided
        if not pdf_path and zotero_client_instance is not None:
            try:

                candidate = zotero_client_instance.get_pdf_path_for_item(item_key)
                if candidate and Path(candidate).exists():
                                    pdf_path = str(candidate)
            except Exception as e:
                _callback(f"Error retrieving children for item {item_key}: {e}")

        if not pdf_path:
            _callback(f"No readable PDF path for item {item_key}. Skipping scan.")
            continue

        # Scan
        items_processed_count += 1
        _callback(f"Scanning PDF {items_processed_count}/{total_items_to_scan}: {Path(pdf_path).name}")
        pdf_scan_res = check_keyword_details_pdf(pdf_path, current_keywords_for_item)
        if pdf_scan_res.get("error"):
            _callback(f"Error scanning PDF for item {item_key} ('{Path(pdf_path).name}'): {pdf_scan_res['error']}")
            continue

        if pdf_scan_res and pdf_scan_res.get("matches"):
            for hit in pdf_scan_res["matches"]:
                authors = row.get("authors", "N/A")
                year = str(row.get("year", "N/A"))
                title = row.get("title", Path(pdf_path).name)
                page_num = hit.get("page")

                para_linked_context = referenced_paragraph(
                    paragraph_html=hit.get("paragraph", ""),
                    author=authors,
                    year=year,
                    item=item_key,
                    page=page_num if page_num is not None else "?",
                )
                section_html = hit.get("section", "") or ""

                all_coded_notes.append({
                    "paragraph_context": para_linked_context,
                    "original_paragraph": hit.get("paragraph", ""),
                    "section_html": section_html,
                    "keyword_found": hit.get("keyword", ""),
                    "page_number": page_num if page_num is not None else None,
                    "source_item_key": item_key,
                    "source_pdf_path": pdf_path,
                    "source_bib_header": f"{authors} ({year})",
                    "source_title": title,
                })

    _callback(f"PDF content extraction complete. Found {len(all_coded_notes)} snippets from {items_processed_count} PDFs considered.")

    result = {
        "type": "coded_notes_list",
        "data": all_coded_notes,
        "description": "Extracted PDF Content Snippets",
    }

    # --------- CACHE WRITE (both keyword-first and LIGHT signature; no Zotero calls) ---------
    try:
        # Keyword-first
        _norm_map_w = _norm_kw_map(items_to_code_with_keywords_map)
        _glob_kws_w = sorted(str(x).strip() for x in (globally_suggested_keywords or []) if str(x).strip())
        _all_kw_w = sorted({kw for kws in _norm_map_w.values() for kw in kws} | set(_glob_kws_w))
        if _all_kw_w:
            _kw_digest_w = hashlib.sha256("\n".join(_all_kw_w).encode("utf-8")).hexdigest()
            _kw_cache_file = Path(CACHE_DIR) / f"extract_content_kw_{_kw_digest_w}.json"
            _kw_cache_file.parent.mkdir(parents=True, exist_ok=True)
            _kw_cache_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

        # LIGHT signature (original)
        _df_sig_w = _hash_df_signature(full_df)
        _sig_payload_w = {
            "fn": "extract_content_for_keywords",
            "version": 4,
            "df": _df_sig_w,
            "items_to_code_with_keywords_map": _norm_map_w,
            "globally_suggested_keywords": _glob_kws_w,
            "max_items": int(max_items),
            "zotero_client_class": type(zotero_client_instance).__name__ if zotero_client_instance else None,
        }
        _sig_hash_w = hashlib.sha256(_stable_json(_sig_payload_w).encode("utf-8")).hexdigest()
        _cache_file_path_w = Path(CACHE_DIR) / f"extract_content_{_sig_hash_w}.json"
        _cache_file_path_w.parent.mkdir(parents=True, exist_ok=True)
        _cache_file_path_w.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as _cache_write_err:
        _callback(f"[cache] write failed: {_cache_write_err}")

    return result
# ---------------------------------------------------------------------------
# Keyword‑in‑context extraction with footnotes
# ---------------------------------------------------------------------------

# Initialize NLTK resources (consider doing this once globally if possible)
STOP_WORDS = _safe_stopwords_english()
# Add custom stop words if needed
CUSTOM_STOP_WORDS = {"et", "al", "fig", "figure", "table", "data", "study",
                     "research", "paper", "article", "method", "result",
                     "conclusion", "discussion", "introduction", "abstract",
                     "keyword", "controlled_vocabulary_terms", "reference", "references", "author", "authors",
                     "university", "journal", "conference", "chapter", "section",
                     "january", "february", "march", "april", "may", "june", "july",
                     "august", "september", "october", "november", "december",
                     "also", "however", "therefore", "thus", "hence", "could", "would",
                     "should", "might", "must", "one", "two", "three", "first", "second",
                     "copyright", "permission", "published", "elsevier", "springer", "ieee",
                     "www", "http", "https", "doi", "org"}  # Add domain-specific or common words
STOP_WORDS.update(CUSTOM_STOP_WORDS)

PUNCTUATION_TABLE = str.maketrans('', '', string.punctuation)
STEMMER = PorterStemmer()  # Optional


# LEMMATIZER = WordNetLemmatizer() # Optional

def preprocess_text(text: str, use_stemming: bool = False, use_lemmatization: bool = False) -> list[str]:
    """
    Normalises text to tokens for *corpus* use (bag-of-words).
    Policy (P1): prefer lemmatisation; remove stopwords/digits/short tokens.
    - spaCy lemmata if available (en_core_web_sm; parser/ner disabled)
    - fallback to NLTK WordNet lemmatiser (with POS if available; else noun)
    - fallback to PorterStemmer if requested
    - final fallback: regex tokenise + simple filtering
    """
    import re,unicodedata, hashlib
    if not isinstance(text, str) or not text.strip():
        return []

    # ----- resources: stopwords & hash -----
    stop_set = globals().get("STOP_WORDS")
    if not isinstance(stop_set, set):
        try:
            from nltk.corpus import stopwords as _sw
            stop_set = set(w.lower() for w in _sw.words("english"))
        except Exception:
            stop_set = set()
    stop_hash = hashlib.sha256("\n".join(sorted(stop_set)).encode("utf-8")).hexdigest()[:12]

    # ----- normalise -----
    s = unicodedata.normalize("NFKC", text).lower()
    try:
        # Keep your punctuation policy if defined; else light regex strip
        punct_tbl = globals().get("PUNCTUATION_TABLE")
        s = s.translate(punct_tbl) if punct_tbl else re.sub(r"[^\w\s\-']", " ", s)
    except Exception:
        s = re.sub(r"[^\w\s\-']", " ", s)

    # ----- attempt spaCy lemmatisation -----
    nlp = None
    spacy_ver = None
    if use_lemmatization and not use_stemming:
        try:
            import spacy
            spacy_ver = getattr(spacy, "__version__", "unknown")
            # cache model in globals to avoid reloads
            if "_SPACY_LEMMA_NLP" not in globals() or globals().get("_SPACY_LEMMA_NLP") is None:
                try:
                    globals()["_SPACY_LEMMA_NLP"] = spacy.load("en_core_web_sm", disable=["parser", "ner", "textcat"])
                except Exception:
                    # fallback: blank pipeline with lemmatizer if available
                    globals()["_SPACY_LEMMA_NLP"] = spacy.blank("en")
                    if "lemmatizer" not in globals()["_SPACY_LEMMA_NLP"].pipe_names:
                        try:
                            globals()["_SPACY_LEMMA_NLP"] = English()
                            # If there's no lemmatiser, spaCy path will be equivalent to lowercasing.
                        except Exception:
                            pass
            nlp = globals().get("_SPACY_LEMMA_NLP")
        except Exception:
            nlp = None

    tokens: list[str] = []
    if nlp:
        try:
            doc = nlp(s)
            # prefer lemma_ when present; else lower text
            raw = [t.lemma_.lower() if getattr(t, "lemma_", None) else t.text.lower() for t in doc]
            tokens = [w for w in raw if w and w.isascii()]
        except Exception:
            tokens = []

    # ----- fallback: NLTK or regex -----
    if not tokens:
        try:
            from nltk import word_tokenize
            raw = word_tokenize(s)
        except Exception:
            raw = re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", s)

        if use_lemmatization and not use_stemming:
            try:
                from nltk.stem import WordNetLemmatizer
                from nltk import pos_tag
                _wnl = WordNetLemmatizer()

                def _map_pos(tag: str) -> str:
                    # map PTB -> WordNet POS
                    if not tag: return "n"
                    c = tag[0].upper()
                    return {"J": "a", "V": "v", "N": "n", "R": "r"}.get(c, "n")

                try:
                    tagged = pos_tag(raw)
                    raw = [_wnl.lemmatize(w, _map_pos(p)) for w, p in tagged]
                except Exception:
                    raw = [_wnl.lemmatize(w, "n") for w in raw]
            except Exception:
                # lemmatisation not available, keep raw
                pass

        if use_stemming and not use_lemmatization:
            try:
                from nltk.stem import PorterStemmer
                _stem = PorterStemmer()
                raw = [_stem.stem(w) for w in raw]
            except Exception:
                pass

        tokens = [w.lower() for w in raw if isinstance(w, str)]

    # ----- filter: stopwords, digits-only, short tokens -----
    out = [w for w in tokens if w not in stop_set and len(w) > 2 and not w.isdigit()]

    # ----- record manifest for the run (available to callers) -----
    manifest = {
        "tokenizer": "spacy_lemma" if nlp else ("nltk_lemma" if use_lemmatization else ("nltk_stem" if use_stemming else "regex_or_nltk")),
        "spacy_version": spacy_ver,
        "stopwords_hash": stop_hash,
    }
    globals()["_LAST_PREPROCESS_MANIFEST"] = manifest
    return out

def get_text_corpus_from_df(
        df: pd.DataFrame,
        source_type: str,                                    # 'controlled_vocabulary_terms', 'abstract', 'title', 'title_abstract', or 'fulltext'
        collection_name_for_cache: str = "default_collection",
        zotero_client=None,
        progress_callback=None,
        *,
        # ── P3: unified cache switch ─────────────────────────────────────────────────────────────
        cache_mode: str = "read",                            # "off" | "read" | "refresh"
        preserve_item_cache: bool = False,                   # if cache_mode="refresh" and False → purge per-item flat_text cache
        # manifest + guardrails handled inside
        # ── P4: perf & I/O knobs ────────────────────────────────────────────────────────────────
        max_workers: int = 6,                                # threadpool for PDF I/O
        rate_limit_per_sec: float = 0.0,                     # simple global sleep between PDF fetches (0 = off)
        # ── P5: text hygiene & domain stoplist ─────────────────────────────────────────────────
        domain_stoplist_enabled: bool = False,
        domain_stoplist_path: str | None = None,             # YAML (list of tokens) or a text file (one per line)
        corpus_hyphen_policy: str = "underscore",            # "underscore" | "keep"
        # ── returns & diagnostics ───────────────────────────────────────────────────────────────
        return_mode: str = "iterator",                       # "iterator" | "flat" | "both"
        include_summary: bool = True,
        diag_focus_terms: list[str] | None = None            # optional, for focus hit counts in diagnostics
):
    """
    P3–P6: Reproducible, fast, and hygienic corpus builder with manifest caching, concurrency, and diagnostics.

    Cache modes:
      - "off"     : never read/write cache (always rebuild).
      - "read"    : load cache if manifest matches; otherwise rebuild and write cache.
      - "refresh" : delete collection cache (and per-item cache unless preserve_item_cache=True), rebuild, write cache.

    Manifest (JSON next to pickle) fields:
      {collection, source_type, tokenizer, stoplist_hash, hyphen_policy, domain_stoplist_enabled, domain_stoplist_path, ts}

    Performance:
      - Concurrent PDF extraction via ThreadPoolExecutor
      - Memoises item keys that failed PDF extraction (skips on next runs)
      - Chunked emission: only builds a flat list if requested by return_mode

    Hygiene:
      - Unicode NFKC normalisation
      - Optional domain stoplist (YAML or newline-delimited)
      - Hyphen policy for corpus counts: "underscore" joins compounds (state_of_the_art)

    Diagnostics (summary):
      docs, total_tokens, unique_tokens, type_token_ratio, avg_tokens_per_doc,
      token_length_histogram, stopwords_hash, cache files used/written, config echo.
      If diag_focus_terms provided: simple per-term token counts.
    """
    import re, json, pickle, time, logging, unicodedata, hashlib
    from pathlib import Path
    from concurrent.futures import ThreadPoolExecutor, as_completed

    # ---------- helpers ----------
    def _cb(msg: str):
        if progress_callback:
            try: progress_callback(f"CorpusGen: {msg}")
            except Exception: pass
        logging.debug(f"CorpusGen: {msg}")

    def _load_per_item_flattext_tokens(key: str):
        """Return tokens from per-item cache if present, else None.
           Accepts several cache shapes: dict{'tokens'|'text'}, list[str], or raw text files.
        """
        import pickle
        from pathlib import Path
        cp = per_item_cache / f"flattext_{key}.pkl"
        try:
            if cp.exists():
                with open(cp, "rb") as f:
                    obj = pickle.load(f)
                if isinstance(obj, dict):
                    if isinstance(obj.get("tokens"), list):
                        return [str(t).lower() for t in obj["tokens"]]
                    if isinstance(obj.get("text"), str):
                        return _apply_domain_stop(_tok_fn_corpus(obj["text"]))
                if isinstance(obj, list):
                    return [str(t).lower() for t in obj]
                if isinstance(obj, str):
                    return _apply_domain_stop(_tok_fn_corpus(obj))
        except Exception as e:
            _cb(f"Per-item cache load failed for {key}: {e}")

        # permissive fallbacks
        cp_txt = per_item_cache / f"flattext_{key}.txt"
        if cp_txt.exists():
            try:
                return _apply_domain_stop(_tok_fn_corpus(cp_txt.read_text(encoding="utf-8", errors="ignore")))
            except Exception as e:
                _cb(f"Per-item .txt load failed for {key}: {e}")

        return None
    def _normalise_source(s: str) -> str:
        t = (str(s or "").lower().strip()).replace(" ", "").replace("-", "_")
        if t in {"full_text", "fulltext", "full"}:
            return "fulltext"
        if t in {"title+abstract", "title_abstract"}:
            return "title_abstract"
        if t in {"titles", "titletext"}:
            return "title"
        if t in {"abstracts"}:
            return "abstract"
        if t in {"controlled_vocabulary_terms", "controlled_vocabulary",
                 "controlledvocabularyterms", "keywords", "keyword", "cv"}:
            return "controlled_vocabulary_terms"
        return t

    # Prefer upgraded preprocess_text with lemmatisation for corpus
    def _tok_fn_corpus(s: str) -> list[str]:
        # hygiene pre-step here (NFKC + lowercase)
        s_norm = unicodedata.normalize("NFKC", s or "").lower()
        fn = globals().get("advanced_preprocess_text") or globals().get("preprocess_text")
        if callable(fn):
            try:
                toks = list(fn(s_norm, use_lemmatization=True))
            except TypeError:
                try:
                    toks = list(fn(s_norm))
                except Exception:
                    toks = []
            except Exception:
                toks = []
        else:
            toks = re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", s_norm)

        # hyphen policy applied at corpus level (n-gram path keeps hyphens elsewhere)
        if corpus_hyphen_policy == "underscore":
            toks = [t.replace("-", "_") for t in toks]
        return toks

    # stopwords (for diagnostics & CV filtering)
    stop_set = globals().get("STOP_WORDS")
    if not isinstance(stop_set, set):
        try:
            from nltk.corpus import stopwords as _sw
            stop_set = set(w.lower() for w in _sw.words("english"))
        except Exception:
            stop_set = set()
    stop_hash = hashlib.sha256("\n".join(sorted(stop_set)).encode("utf-8")).hexdigest()[:12]

    # optional domain stoplist
    domain_stop: set[str] = set()
    if domain_stoplist_enabled:
        try:
            if domain_stoplist_path and Path(domain_stoplist_path).exists():
                p = Path(domain_stoplist_path)
                if p.suffix.lower() in {".yml", ".yaml"}:
                    try:
                        import yaml
                        with open(p, "r", encoding="utf-8") as f:
                            data = yaml.safe_load(f) or []
                        domain_stop = {str(x).strip().lower() for x in (data if isinstance(data, list) else []) if str(x).strip()}
                    except Exception:
                        # fallback: treat YAML as plain lines if yaml not available
                        with open(p, "r", encoding="utf-8") as f:
                            domain_stop = {line.strip().lower() for line in f if line.strip()}
                else:
                    with open(p, "r", encoding="utf-8") as f:
                        domain_stop = {line.strip().lower() for line in f if line.strip()}
            _cb(f"Domain stoplist enabled with {len(domain_stop)} entries.")
        except Exception as e:
            _cb(f"Domain stoplist load error: {e}. Continuing without it.")
            domain_stop = set()

    def _apply_domain_stop(toks: list[str]) -> list[str]:
        if not domain_stop:
            return toks
        return [t for t in toks if t not in domain_stop]

    # ---------- normalise source_type ----------
    t = _normalise_source(source_type)

    # ---------- ensure cache base exists ----------
    corpus_cache_root = ZOTKW_CACHE_DIR / "corpus"
    corpus_cache_root.mkdir(parents=True, exist_ok=True)

    # ---------- cache & manifest paths ----------
    safe_coll = re.sub(
        r"[^\w\-.]+",
        "_",
        (collection_name_for_cache or "unknown_collection").strip() or "unknown_collection",
    )

    cache_ver = "v3.0_iter_lemma_manifest"

    cache_file = corpus_cache_root / f"corpus_fulltext_tokens_{safe_coll}_{cache_ver}.pkl"
    manifest_file = corpus_cache_root / f"corpus_fulltext_tokens_{safe_coll}_{cache_ver}.json"

    per_item_cache = corpus_cache_root / "flat_text_per_item"
    fail_memo_file = corpus_cache_root / f"failed_items_{safe_coll}.json"

    # ---------- cache guardrails ----------
    cache_mode = (cache_mode or "read").lower()
    if cache_mode not in {"off", "read", "refresh"}:
        cache_mode = "read"
    _cb(f"Cache mode = {cache_mode}")

    if t == "fulltext":
        per_item_cache.mkdir(parents=True, exist_ok=True)
        if cache_mode == "refresh":
            # nuke collection cache
            for p in (cache_file, manifest_file):
                try:
                    if p.exists():
                        p.unlink()
                        _cb(f"Removed cache file: {p.name}")
                except Exception as e:
                    _cb(f"Could not remove cache file {p.name}: {e}")
            # optionally purge per-item cache
            if not preserve_item_cache and per_item_cache.exists():
                try:
                    import shutil
                    shutil.rmtree(per_item_cache, ignore_errors=True)
                    per_item_cache.mkdir(parents=True, exist_ok=True)
                    _cb("Purged per-item flat_text cache directory.")
                except Exception as e:
                    _cb(f"Failed to purge per-item cache: {e}")

    # ---------- emission containers ----------
    build_flat = return_mode in {"flat", "both"}
    flat_tokens: list[str] = [] if build_flat else None
    per_doc: list[tuple[str, list[str]]] = []   # (doc_id, tokens)
    docs = 0

    def _emit(doc_id: str, text: str):
        nonlocal docs, flat_tokens
        s = unicodedata.normalize("NFKC", str(text or ""))
        toks = _apply_domain_stop(_tok_fn_corpus(s)) if s.strip() else []
        per_doc.append((doc_id, toks))
        if build_flat:
            flat_tokens.extend(toks)
        docs += 1

    # ---------- try load cache for fulltext ----------
    loaded_from_cache = False
    manifest_ctx = {
        "collection": safe_coll,
        "source_type": t,
        "tokenizer": getattr((globals().get("advanced_preprocess_text") or globals().get("preprocess_text")),
                             "__name__", "regex_tokenizer"),
        "stoplist_hash": stop_hash,
        "hyphen_policy": corpus_hyphen_policy,
        "domain_stoplist_enabled": bool(domain_stoplist_enabled),
        "domain_stoplist_path": str(domain_stoplist_path or ""),
    }

    def _manifest_matches(m: dict) -> bool:
        try:
            keys = ("collection", "source_type", "tokenizer", "stoplist_hash", "hyphen_policy",
                    "domain_stoplist_enabled", "domain_stoplist_path")
            return all(str(m.get(k)) == str(manifest_ctx.get(k)) for k in keys)
        except Exception:
            return False

    if t == "fulltext" and cache_mode == "read" and cache_file.exists() and manifest_file.exists():
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                man = json.load(f)
            if _manifest_matches(man):
                with open(cache_file, "rb") as f:
                    cached_doc_tokens = pickle.load(f)
                if isinstance(cached_doc_tokens, list) and cached_doc_tokens and isinstance(cached_doc_tokens[0], tuple):
                    per_doc = cached_doc_tokens
                    if build_flat:
                        flat_tokens = []
                        for _, toks in per_doc:
                            flat_tokens.extend(toks)
                    docs = len(per_doc)
                    loaded_from_cache = True
                    _cb(f"Loaded fulltext corpus from cache. Docs: {docs}, Tokens: {len(flat_tokens) if build_flat else 'n/a'}")
            else:
                _cb("Manifest mismatch → ignoring cache; will rebuild.")
        except Exception as e:
            _cb(f"Cache load failed → {e}; will rebuild.")

    # ---------- modes: non-fulltext (no collection cache) ----------
    if not loaded_from_cache and t in {"title", "abstract", "title_abstract", "controlled_vocabulary_terms"}:
        if t == "title":
            if "title" not in df.columns:
                _cb("Warning: 'title' column not found.")
            else:
                for i, row in df.reset_index(drop=True).iterrows():
                    doc_id = str(row.get("key") or f"row_{i}")
                    _emit(doc_id, str(row.get("title", "") or ""))
            _cb(f"Finished 'title' corpus. Docs: {docs}, Tokens: {len(flat_tokens) if build_flat else 'n/a'}")

        elif t == "abstract":
            if "abstract" not in df.columns:
                _cb("Warning: 'abstract' column not found.")
            else:
                for i, row in df.reset_index(drop=True).iterrows():
                    doc_id = str(row.get("key") or f"row_{i}")
                    _emit(doc_id, str(row.get("abstract", "") or ""))
            _cb(f"Finished 'abstract' corpus. Docs: {docs}, Tokens: {len(flat_tokens) if build_flat else 'n/a'}")

        elif t == "title_abstract":
            tcol = df["title"].fillna("").astype(str) if "title" in df.columns else pd.Series([""] * len(df), index=df.index)
            acol = df["abstract"].fillna("").astype(str) if "abstract" in df.columns else pd.Series([""] * len(df), index=df.index)
            both = (tcol + " " + acol).str.strip()
            for i, (idx, txt) in enumerate(both.items()):
                key = df.iloc[i].get("key") if "key" in df.columns else None
                doc_id = str(key) if key else f"row_{i}"
                _emit(doc_id, txt)
            _cb(f"Finished 'title+abstract' corpus. Docs: {docs}, Tokens: {len(flat_tokens) if build_flat else 'n/a'}")

        elif t == "controlled_vocabulary_terms":
            if "controlled_vocabulary_terms" not in df.columns:
                _cb("Warning: 'controlled_vocabulary_terms' column not found.")
            else:
                for i, row in df.reset_index(drop=True).iterrows():
                    key = row.get("key")
                    doc_id = str(key) if key else f"row_{i}"
                    entry = row.get("controlled_vocabulary_terms")
                    kws: list[str] = []
                    if isinstance(entry, list):
                        kws = [str(kw).strip().lower() for kw in entry if isinstance(kw, str) and kw.strip() and ":" not in kw]
                    elif isinstance(entry, str):
                        kws = [kw.strip().lower() for kw in entry.split(';') if kw.strip() and ":" not in kw]
                    toks = [kw for kw in kws if len(kw) > 1 and not kw.isdigit() and kw not in stop_set]
                    toks = _apply_domain_stop(toks)
                    per_doc.append((doc_id, toks))
                    if build_flat:
                        flat_tokens.extend(toks)
                    docs += 1
            _cb(f"Finished 'controlled_vocabulary_terms'. Docs: {docs}, Tokens: {len(flat_tokens) if build_flat else 'n/a'}")

    # ---------- fulltext: build (with concurrency, memoised failures) ----------
    if t == "fulltext" and not loaded_from_cache:
        if zotero_client is None:
            _cb("ERROR: zotero_client is required for 'fulltext'.")
        else:
            # load memoised failures; wipe on refresh to allow recovery
            failed_keys: set[str] = set()
            try:
                if cache_mode == "refresh" and fail_memo_file.exists():
                    fail_memo_file.unlink()
                elif fail_memo_file.exists():
                    with open(fail_memo_file, "r", encoding="utf-8") as f:
                        failed_keys = set(json.load(f) or [])
            except Exception:
                failed_keys = set()

            # build list of keys to process
            rows = list(df.reset_index(drop=True).iterrows())
            items = []
            for i, row in rows:
                key = str(row.get("key") or "").strip()
                doc_id = key if key else f"row_{i}"
                # skip memoised failures quickly
                # honour fail memo only in READ mode; on REFRESH we must try again
                if cache_mode == "read" and key and key in failed_keys:
                    per_doc.append((doc_id, []))
                    docs += 1
                else:
                    items.append((i, doc_id, key))

            # rate limiter (simple: global sleep between task submissions)
            def _submit_with_rate(executor, fn, *args, **kwargs):
                fut = executor.submit(fn, *args, **kwargs)
                if rate_limit_per_sec and rate_limit_per_sec > 0:
                    time.sleep(1.0 / rate_limit_per_sec)
                return fut

            def _fetch_and_tokenize(doc_id: str, key: str):
                """Obey cache_mode strictly:
                   - READ: never hit Zotero; use per-item cache if present, else mark miss.
                   - REFRESH: if preserve_item_cache and per-item cache exists, use it;
                              otherwise call Zotero and update per-item cache.
                """
                # 1) Prefer per-item cache whenever allowed
                if cache_mode in {"read", "refresh"}:
                    toks_cached = _load_per_item_flattext_tokens(key)
                    if toks_cached is not None:
                        _cb(f"[{cache_mode.upper()}] per-item cache HIT for {key} (no Zotero call).")
                        return (doc_id, toks_cached, key, True)

                # 2) READ mode: never call Zotero
                if cache_mode == "read":
                    _cb(f"[READ] per-item cache MISS for {key}; skipping Zotero/network.")
                    failed_keys.add(key)
                    return (doc_id, [], key, False)

                # 3) REFRESH (or OFF): fetch via Zotero only when needed
                txt = None
                try:
                    if key:
                        _cb(f"[REFRESH] fetching via Zotero for {key} …")
                        txt = _get_text_from_pdf_via_zotero(
                            key=str(key),
                            zotero_client=zotero_client,
                            cache_dir=per_item_cache,  # let the helper write/update per-item cache if it can
                            progress_cb=progress_callback,
                        )
                except Exception as e:
                    _cb(f"Zotero fetch failed for {key}: {e}")
                    txt = None

                if not txt:
                    failed_keys.add(key)
                    return (doc_id, [], key, False)

                # tokenize and also persist a friendly per-item cache format
                s = unicodedata.normalize("NFKC", txt)
                toks = _apply_domain_stop(_tok_fn_corpus(s))
                try:
                    import pickle
                    with open(per_item_cache / f"flattext_{key}.pkl", "wb") as f:
                        pickle.dump({"text": txt, "tokens": toks}, f)
                    _cb(f"Updated per-item cache for {key}.")
                except Exception as e:
                    _cb(f"Could not write per-item cache for {key}: {e}")
                return (doc_id, toks, key, True)

            processed = 0
            total = len(items)
            # threaded fetch
            with ThreadPoolExecutor(max_workers=max_workers) as ex:
                futures = [_submit_with_rate(ex, _fetch_and_tokenize, doc_id, key) for (_, doc_id, key) in items]
                for fut in as_completed(futures):
                    doc_id, toks, key, ok = fut.result()
                    per_doc.append((doc_id, toks))
                    if build_flat and toks:
                        flat_tokens.extend(toks)
                    if not ok and key:
                        failed_keys.add(key)
                    docs += 1
                    processed += 1
                    if processed % 10 == 0 or processed == total:
                        _cb(f"Fulltext progress: {processed}/{total}. Tokens so far: {len(flat_tokens) if build_flat else 'n/a'}")

            # persist failure memo only when we actually attempted network fetches
            if cache_mode == "refresh":
                try:
                    with open(fail_memo_file, "w", encoding="utf-8") as f:
                        json.dump(sorted(list(failed_keys)), f, ensure_ascii=False, indent=2)
                except Exception:
                    pass

            # write cache when cache_mode != "off"
            if cache_mode == "refresh" or (cache_mode == "read" and any(toks for _, toks in per_doc)):
                try:
                    with open(cache_file, "wb") as f:
                        pickle.dump(per_doc, f)
                    manifest_ctx_out = dict(manifest_ctx)
                    manifest_ctx_out["ts"] = int(time.time())
                    with open(manifest_file, "w", encoding="utf-8") as f:
                        json.dump(manifest_ctx_out, f, ensure_ascii=False, indent=2)
                    _cb(f"Saved fulltext cache + manifest: {cache_file.name}, {manifest_file.name}")
                except Exception as e:
                    _cb(f"Failed to save cache/manifest: {e}")

    # ---------- diagnostics ----------
    def _histogram_token_lengths(tokens: list[str]) -> dict:
        if not tokens:
            return {}
        hist: dict[str, int] = {}
        for w in tokens:
            L = len(w)
            bucket = "1" if L <= 1 else "2" if L == 2 else "3-5" if L <= 5 else "6-8" if L <= 8 else "9-12" if L <= 12 else "13+"
            hist[bucket] = hist.get(bucket, 0) + 1
        return hist

    total_tokens = sum(len(toks) for _, toks in per_doc)
    unique_tokens = len({w for _, toks in per_doc for w in toks})
    ttr = (unique_tokens / total_tokens) if total_tokens else 0.0
    avg_per_doc = (total_tokens / docs) if docs else 0.0
    sample_for_hist = (flat_tokens if build_flat else [w for _, toks in per_doc for w in toks])
    length_hist = _histogram_token_lengths(sample_for_hist)

    # optional focus hits (simple token counts)
    focus_counts = {}
    if diag_focus_terms:
        for term in diag_focus_terms:
            if not isinstance(term, str) or not term.strip():
                continue
            t0 = term.strip().lower()
            focus_counts[t0] = sum(toks.count(t0) for _, toks in per_doc)

    manifest_pre = globals().get("_LAST_PREPROCESS_MANIFEST") or {}
    summary = {
        "source_type": t,
        "docs": int(docs),
        "total_tokens": int(total_tokens),
        "unique_tokens": int(unique_tokens),
        "type_token_ratio": float(ttr),
        "avg_tokens_per_doc": float(avg_per_doc),
        "token_length_histogram": length_hist,
        "tokenizer": manifest_pre.get("tokenizer", "unknown"),
        "spacy_version": manifest_pre.get("spacy_version"),
        "stopwords_hash": manifest_pre.get("stopwords_hash", stop_hash),
        "cache_mode": cache_mode,
        "cache_file": str(cache_file) if t == "fulltext" and cache_mode != "off" else None,
        "manifest_file": str(manifest_file) if t == "fulltext" and cache_mode != "off" else None,
        "per_item_cache_dir": str(per_item_cache) if t == "fulltext" else None,
        "preserve_item_cache": bool(preserve_item_cache),
        "domain_stoplist_enabled": bool(domain_stoplist_enabled),
        "domain_stoplist_path": str(domain_stoplist_path or ""),
        "corpus_hyphen_policy": corpus_hyphen_policy,
        "diag_focus_counts": focus_counts or None,
    }
    globals()["_LAST_CORPUS_SUMMARY"] = summary
    globals()["_LAST_CORPUS_DOC_BOUNDARIES"] = [(doc_id, 0, len(toks)) for doc_id, toks in per_doc]

    logging.info("Corpus summary: %s", summary)

    # ---------- returns ----------
    iterator = ((doc_id, toks) for (doc_id, toks) in per_doc)
    if return_mode == "iterator":
        return (iterator, summary) if include_summary else iterator
    if return_mode == "flat":
        return (sample_for_hist, summary) if include_summary else sample_for_hist
    if return_mode == "both":
        return (iterator, sample_for_hist, summary) if include_summary else (iterator, sample_for_hist)
    # explicit per_doc support
    if return_mode == "per_doc":
        return (per_doc, summary) if include_summary else per_doc
    return (iterator, summary) if include_summary else iterator


def _normalise_and_strip_html(html_text: str) -> str:
    if not html_text or not isinstance(html_text, str): return ""
    text = html.unescape(html_text)
    # Remove <sup> tags and their content first
    text = re.sub(r'<sup>.*?</sup>', '', text, flags=re.IGNORECASE | re.DOTALL)
    # Extract text from <mark> tags
    text = re.sub(r'<mark>(.*?)</mark>', r'\1', text, flags=re.IGNORECASE)
    # Strip all other HTML tags, replacing with a space
    text = re.sub(r'<[^>]+>', ' ', text)
    # Normalize multiple spaces/newlines to a single space
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def tokenize_for_ngram_context_refined(text: str,
                                       *,
                                       lowercase: bool = True,
                                       preserve_hyphens: bool = True) -> list[str]:
    """
    N-gram-oriented tokenizer:
      - Keeps stopwords.
      - Preserves hyphenated compounds as single tokens (configurable).
      - Strips punctuation tokens entirely.

    This is intentionally different from the corpus tokenizer used in bag-of-words.
    """
    import string, unicodedata
    from nltk.tokenize import RegexpTokenizer

    if not isinstance(text, str) or not text.strip():
        return []

    s = unicodedata.normalize("NFKC", text)
    if lowercase:
        s = s.lower()

    if preserve_hyphens:
        pattern = r"\w+(?:-\w+)*|[^\w\s]"
    else:
        pattern = r"\w+|[^\w\s]"

    tokenizer = RegexpTokenizer(pattern)
    raw_tokens = tokenizer.tokenize(s)

    punct_set = set(string.punctuation) | set("“”‘’—–…")
    final = []
    for tok in raw_tokens:
        if tok and not all(ch in punct_set for ch in tok):
            final.append(tok.strip())
    return final
def filter_contextual_ngrams(
        ngram_list: list[tuple[str, ...]],
        focus_keyword: str,
        *,
        min_meaningful_words: int = 1,
        focus_variants: list[str] | None = None,
        use_pos_gate: bool = False,
        allowed_pos_prefixes: tuple[str, ...] = ("N", "J"),  # keep Nouns/Adjectives by default
        # --- new: needed to *adjust* windows instead of dropping them ---
        tokens: list[str] | None = None,
        positions_by_ngram: dict[tuple[str, ...], list[int]] | None = None,
) -> dict[tuple[str, ...], list[int]]:
    """
    Adjust n-grams around the focus instead of discarding them.

    Behaviour:
      - Removes non-meaningful tokens (stopwords, 1-char, digits) *within each window*,
        but preserves the focus token.
      - Refills the window to its original length by pulling the next meaningful tokens
        from the right first, then from the left, keeping sequence order.
      - Optionally applies a coarse POS gate on the *non-focus* tokens.
      - Returns a mapping: {adjusted_ngram_tuple -> [start_positions]} suitable for counting.

    Requirements:
      - `tokens` (full token stream) and `positions_by_ngram` (start indices per original n-gram)
        must be provided so we can refill windows beyond the original start..start+n slice.
    """
    import nltk

    if not focus_keyword:
        return {ng: positions_by_ngram.get(ng, []) if positions_by_ngram else [] for ng in ngram_list}

    # stopwords fallback
    stop_set = globals().get("STOP_WORDS")
    if not isinstance(stop_set, set):
        try:
            from nltk.corpus import stopwords as _sw
            stop_set = set(w.lower() for w in _sw.words("english"))
        except Exception:
            stop_set = set()

    # focus variants (normalised lower)
    focus_set = {focus_keyword.lower()}
    if focus_variants:
        focus_set |= {str(x).lower() for x in focus_variants if isinstance(x, str) and x.strip()}

    def _is_meaningful(w: str) -> bool:
        return isinstance(w, str) and len(w) > 1 and (w.lower() in focus_set or (w.lower() not in stop_set and not w.isdigit()))

    def _coarse_ok(tag: str) -> bool:
        return bool(tag) and tag[0].upper() in {p.upper() for p in allowed_pos_prefixes}

    if tokens is None or positions_by_ngram is None:
        # No context: fall back to classic filter (keep or drop). Here we just keep those
        # that meet min_meaningful_words without adjustment.
        out_simple: dict[tuple[str, ...], list[int]] = {}
        for ng in ngram_list:
            others = [w for w in ng if w.lower() not in focus_set]
            m = sum(1 for w in others if w.lower() not in stop_set and len(w) > 1)
            if m >= max(0, min_meaningful_words):
                out_simple[ng] = []
        return out_simple

    L = len(tokens)
    adjusted: dict[tuple[str, ...], list[int]] = {}

    for ng in ngram_list:
        starts = positions_by_ngram.get(ng, [])
        n = len(ng)
        for s in starts:
            # original window
            window_idx = list(range(s, min(s + n, L)))
            # keep all meaningful tokens in-window; always keep focus
            kept_idx = [i for i in window_idx if _is_meaningful(tokens[i])]
            # ensure focus presence
            # If focus isn't caught by _is_meaningful for some reason, force-keep nearest focus index
            if not any(tokens[i].lower() in focus_set for i in kept_idx):
                # try to find focus inside original window
                for i in window_idx:
                    if tokens[i].lower() in focus_set:
                        kept_idx.append(i)
                        break

            # refill to length n: prefer right extension, then left
            r = s + n
            l = s - 1
            seen = set(kept_idx)
            while len(kept_idx) < n and (r < L or l >= 0):
                if r < L:
                    if _is_meaningful(tokens[r]) and r not in seen:
                        kept_idx.append(r)
                        seen.add(r)
                    r += 1
                if len(kept_idx) >= n:
                    break
                if l >= 0:
                    if _is_meaningful(tokens[l]) and l not in seen:
                        kept_idx.insert(0, l)  # keep order left→right
                        seen.add(l)
                    l -= 1

            # if still shorter than n, proceed with whatever we've got
            kept_idx_sorted = sorted(kept_idx)[:n]
            ng_adjusted = tuple(tokens[i] for i in kept_idx_sorted)

            # enforce min_meaningful_words (excluding focus tokens)
            others = [w for w in ng_adjusted if w.lower() not in focus_set]
            m = sum(1 for w in others if w.lower() not in stop_set and len(w) > 1)
            if m < max(0, min_meaningful_words):
                continue

            # POS gate if requested
            if use_pos_gate and others:
                try:
                    tags = nltk.pos_tag(list(ng_adjusted))
                    tags_others = [t for w, t in tags if w.lower() not in focus_set]
                    if tags_others and not all(_coarse_ok(t) for t in tags_others):
                        continue
                except Exception:
                    # if POS fails, keep it to avoid losing context silently
                    pass

            adjusted.setdefault(ng_adjusted, []).append(s)

    return adjusted
def compile_ngram_context(text: str,
                          focus: str | list[str],
                          *,
                          n_values: tuple[int, ...] = (2, 3, 4),
                          emission: str = "all",         # "all" | "one"
                          min_meaningful_words: int = 1,
                          use_pos_gate: bool = False,
                          allowed_pos_prefixes: tuple[str, ...] = ("N", "J"),
                          include_scores: tuple[str, ...] = ("pmi", "t_score"),
                          max_positions_per_ngram: int = 5) -> dict:
    """
    Contextual n-gram builder with adjustment:
      - Emits windows that contain the focus (policy via `emission`).
      - Removes non-meaningful items from each window and refills to size n by
        pulling next meaningful tokens (right first, then left).
      - Optionally applies PMI / t-score (for contiguous bigrams/trigrams).
    """
    from collections import Counter, defaultdict
    import math

    tokens = tokenize_for_ngram_context_refined(text or "")
    if not tokens or not focus:
        return {"n": {}, "meta": {"focus_set": [], "tokens": len(tokens), "emission": emission, "scoring": list(include_scores)}}

    # --- normalise focus set (lemmatised) ---
    def _lemmatise_list(words: list[str]) -> list[str]:
        out = []
        try:
            from nltk.stem import WordNetLemmatizer
            from nltk import pos_tag
            wnl = WordNetLemmatizer()
            tags = pos_tag(words)
            def mp(tag):
                return {"J": "a", "V": "v", "N": "n", "R": "r"}.get(tag[:1].upper(), "n")
            for w, t in tags:
                out.append(wnl.lemmatize(w.lower(), mp(t)))
        except Exception:
            out = [str(w).lower() for w in words]
        return out

    focus_list = [focus] if isinstance(focus, str) else [str(x) for x in focus if isinstance(x, str) and x.strip()]
    focus_set = set(_lemmatise_list(focus_list))

    # lemma stream for matching
    try:
        lem_stream = _lemmatise_list(tokens)
    except Exception:
        lem_stream = [t.lower() for t in tokens]

    # indices where focus occurs
    focus_idxs = [i for i, l in enumerate(lem_stream) if l in focus_set]
    if not focus_idxs:
        return {"n": {}, "meta": {"focus_set": sorted(focus_set), "tokens": len(tokens), "emission": emission, "scoring": list(include_scores)}}

    # window start generator
    def _emit_windows_for_index(i: int, n: int):
        L = len(tokens)
        if emission == "all":
            start_min = max(0, i - (n - 1))
            start_max = min(i, L - n)
            for s in range(start_min, start_max + 1):
                yield s
        else:
            left = (n - 1) // 2
            s = max(0, min(i - left, L - n))
            yield s

    # collect raw candidates and positions
    positions_by_ngram: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for i in focus_idxs:
        for n in n_values:
            if n < 1 or n > len(tokens):
                continue
            for s in _emit_windows_for_index(i, n):
                ng = tuple(tokens[s:s + n])
                positions_by_ngram[ng].append(s)

    # adjust windows via filter_contextual_ngrams (now returns adjusted mapping)
    candidates = list(positions_by_ngram.keys())
    adjusted_map = filter_contextual_ngrams(
        candidates,
        focus_keyword=next(iter(focus_set)),
        min_meaningful_words=min_meaningful_words,
        focus_variants=list(focus_set),
        use_pos_gate=use_pos_gate,
        allowed_pos_prefixes=allowed_pos_prefixes,
        tokens=tokens,
        positions_by_ngram=positions_by_ngram,
    )

    # counts by n and sorted result
    counts_by_n: dict[int, Counter] = defaultdict(Counter)
    for ng, pos in adjusted_map.items():
        counts_by_n[len(ng)][ng] += len(pos)

    # background contiguous counts for PMI / t-score
    unig = Counter(tokens)
    big = Counter(zip(tokens, tokens[1:])) if len(tokens) >= 2 else Counter()
    tri = Counter(zip(tokens, tokens[1:], tokens[2:])) if len(tokens) >= 3 else Counter()
    N_bi = sum(big.values()) if big else 0
    N_tri = sum(tri.values()) if tri else 0

    def _pmi_bigram(b):
        if N_bi == 0: return None
        w1, w2 = b
        f = big.get(b, 0)
        if f == 0: return None
        denom = unig.get(w1, 0) * unig.get(w2, 0)
        if denom == 0: return None
        return math.log2((f * N_bi) / denom)

    def _tscore_bigram(b):
        if N_bi == 0: return None
        w1, w2 = b
        f = big.get(b, 0)
        if f == 0: return None
        expected = (unig.get(w1, 0) * unig.get(w2, 0)) / max(N_bi, 1)
        return (f - expected) / math.sqrt(f) if f > 0 else None

    def _pmi_trigram(tg):
        if N_tri == 0: return None
        w1, w2, w3 = tg
        f = tri.get(tg, 0)
        if f == 0: return None
        denom = big.get((w1, w2), 0) * big.get((w2, w3), 0)
        if denom == 0: return None
        return math.log2((f * N_tri) / denom)

    def _tscore_trigram(tg):
        if N_tri == 0: return None
        w1, w2, w3 = tg
        f = tri.get(tg, 0)
        if f == 0: return None
        expected = (big.get((w1, w2), 0) * big.get((w2, w3), 0)) / max(N_tri, 1)
        return (f - expected) / math.sqrt(f) if f > 0 else None

    result_by_n: dict[int, list[dict]] = {}
    for n, counter in counts_by_n.items():
        rows = []
        for ng, cnt in counter.most_common():
            pos = adjusted_map.get(ng, [])
            rec = {
                "ngram": ng,
                "count": int(cnt),
                "positions": pos[:max_positions_per_ngram],
            }
            if "pmi" in include_scores and n == 2:
                rec["pmi"] = _pmi_bigram(ng)
            if "t_score" in include_scores and n == 2:
                rec["t_score"] = _tscore_bigram(ng)
            if "pmi" in include_scores and n == 3:
                rec["pmi"] = _pmi_trigram(ng)
            if "t_score" in include_scores and n == 3:
                rec["t_score"] = _tscore_trigram(ng)
            rows.append(rec)
        result_by_n[n] = rows

    return {
        "n": result_by_n,
        "meta": {
            "focus_set": sorted(focus_set),
            "tokens": len(tokens),
            "emission": emission,
            "scoring": list(include_scores),
        }
    }


def _get_text_from_pdf_via_zotero(key: str,
                                  zotero_client,
                                  *,
                                  mistral_api_key: str | None = None,
                                  cache_dir: Path | None = None,
                                  progress_cb=None) -> str | None:
    """
    Fetch *flat_text* for a Zotero item key using any available route:

      1) Per-item cache (cache_dir/flattext_{key}.pkl) if present.
      2) zotero_client.get_pdf(key) → process if not already flat_text.
      3) Iterate zotero_client.zot.children(key) to locate PDF:
           • zotero_client.get_pdf_path_for_item(attachment_id)
           • zotero_client.download_attachment(attachment_id)
           • zotero_client.zot.file(attachment_key)
         Then process via process_pdf(pdf_path=...).

    Always returns a plain string or None.
    """
    import pickle, logging, tempfile, os
    from pathlib import Path as _Path

    def _cb(msg: str):
        if progress_cb:
            try: progress_cb(msg)
            except Exception: pass
        logging.info(f"PDFScan: {msg}")

    def _as_text(res) -> str | None:
        if isinstance(res, dict):
            t = res.get("flat_text") or res.get("full_text") or res.get("markdown")
            return str(t).strip() if t else None
        if isinstance(res, str):
            return res.strip() or None
        return None

    def _process_any(obj) -> str | None:
        # Accepts: dict with flat_text, path-like, bytes/file-like
        try:
            if isinstance(obj, dict):
                t = obj.get("flat_text")
                if isinstance(t, str) and t.strip():
                    return t
                # If only markdown/full_text present, accept as fallback
                t = obj.get("full_text") or obj.get("markdown")
                return str(t).strip() if t else None

            if isinstance(obj, (str, _Path)):
                res = process_pdf(pdf_path=str(obj))
                return _as_text(res)

            if hasattr(obj, "read") or isinstance(obj, (bytes, bytearray)):
                data = obj.read() if hasattr(obj, "read") else obj
                if not isinstance(data, (bytes, bytearray)):
                    return None
                tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
                try:
                    tmp.write(data)
                    tmp.flush()
                    tmp.close()
                    res = process_pdf(pdf_path=tmp.name)
                    return _as_text(res)
                finally:
                    try: os.unlink(tmp.name)
                    except Exception: pass
        except Exception as e:
            _cb(f"process_pdf failed for {key}: {e}")
        return None

    # 1) Per-item cache
    if cache_dir:
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            cp = cache_dir / f"flattext_{key}.pkl"
            if cp.exists():
                with open(cp, "rb") as f:
                    txt = pickle.load(f)
                if isinstance(txt, str) and txt.strip():
                    _cb(f"flat_text loaded from per-item cache for {key}")
                    return txt
        except Exception:
            pass

    # 2) Direct high-level helper
    if hasattr(zotero_client, "get_pdf"):
        try:
            _cb(f"calling zotero_client.get_pdf for {key}")
            pdf_obj = zotero_client.get_pdf(key)
            txt = _process_any(pdf_obj)
            if txt and cache_dir:
                with open(cache_dir / f"flattext_{key}.pkl", "wb") as f:
                    pickle.dump(txt, f)
            if txt:
                return txt
        except Exception as e:
            _cb(f"get_pdf failed for {key}: {e}")



    # Path
    if hasattr(zotero_client, "get_pdf_path_for_item"):

        p = zotero_client.get_pdf_path_for_item(key)
        if p and _Path(p).exists():
            txt = _process_any(p)
            if txt and cache_dir:
                with open(cache_dir / f"flattext_{key}.pkl", "wb") as f:
                    pickle.dump(txt, f)
            if txt:
                return txt


    _cb(f"No PDF available for key {key}")
    return None

def _scan_text_for_keywords(text: str,
                            keywords: list[str],
                            *,
                            window: int = 120) -> list[dict]:
    """
    Deterministic, de-duplicated keyword scanner around 'flat_text'.

    Returns a list of dicts:
      { 'keyword_found', 'snippet', 'start_idx', 'end_idx' }

    Features:
      - Case-insensitive, word-boundary matching (tolerant of punctuation).
      - De-duplicates identical (keyword_lower, snippet) pairs.
      - Stable ordering by first-match position per keyword.
    """
    import re as _re

    out: list[dict] = []
    if not isinstance(text, str) or not text.strip() or not keywords:
        return out

    # Build compiled patterns with boundaries
    pats: dict[str, any] = {}
    for kw in keywords:
        if not isinstance(kw, str) or not kw.strip():
            continue
        pats[kw] = _re.compile(rf"(?iu)(?P<pre>.{{0,{window}}})\b({_re.escape(kw)})\b(?P<post>.{{0,{window}}})")

    seen: set[tuple[str, str]] = set()
    # Iterate in declared keyword order for determinism
    for kw, pat in pats.items():
        for m in pat.finditer(text):
            pre = m.group("pre") or ""
            hit = m.group(2)
            post = m.group("post") or ""
            snippet = (pre + hit + post).replace("\n", " ").strip()
            keypair = (kw.lower(), snippet)
            if keypair in seen:
                continue
            seen.add(keypair)
            start = max(0, m.start() - len(pre))
            end = m.end() + len(post)
            out.append({
                "keyword_found": hit,
                "snippet": snippet,
                "start_idx": int(start),
                "end_idx": int(end),
            })

    # Sort by start index for readability
    out.sort(key=lambda d: (d["start_idx"], d["keyword_found"].lower()))
    return out
def _choose_corpus_text(row: pd.Series,
                        corpus: str,
                        zotero_client=None,
                        mistral_api_key: str | None = None,
                        per_item_cache_dir: Path | None = None,
                        progress_cb=None) -> str | None:
    """
    Selects text for scanning by corpus mode:

      • 'full_text'       → per-PDF flat_text via _get_text_from_pdf_via_zotero(...)
      • 'title'           → title only
      • 'abstract'        → abstract only
      • 'title_abstract'  → title + abstract

    Returns a *string* (not tokens). Caller can then run keyword scanning on it.
    """
    c = (corpus or "full_text").lower().strip()

    if c == "title":
        return str(row.get("title", "") or "").strip() or None

    if c == "abstract":
        return str(row.get("abstract", "") or "").strip() or None

    if c == "title_abstract":
        title = str(row.get("title", "") or "").strip()
        abstract = str(row.get("abstract", "") or "").strip()
        combined = f"{title} {abstract}".strip()
        return combined or None

    # default: full_text
    if zotero_client is None:
        return None
    key = row.get("key")
    if not key:
        return None

    return _get_text_from_pdf_via_zotero(
        key=str(key),
        zotero_client=zotero_client,
        cache_dir=per_item_cache_dir,
        progress_cb=progress_cb
    )
def analyze_pdf_keywords_and_trends(
        df: pd.DataFrame,
        params: dict,
        progress_callback=None,
        zotero_client=None
):
    """
    Keyword scanner over selectable corpus:
      - corpus_source: 'full_text' | 'title' | 'abstract' | 'title_abstract'
      - keywords_to_scan_in_pdf: list[str]
      - plot_type: 'snippets_only' | 'overall_hits_trend' | 'single_keyword_focus_ngrams'
      - focus_keyword_for_details: str (optional for ngrams)
      - ngram_n_for_focus_kw: int (default 2)
      - min_freq_for_focus_kw_ngrams: int (default 2)
      - top_n_ngrams_for_focus_kw_plot: int (default 15)

    Caching:
      • per-collection pickle (same style you used before)
      • tiny per-item cache for flat_text extraction
    """
    import hashlib, pickle, re
    from collections import defaultdict, Counter

    def _cb(msg: str):
        if progress_callback:
            try:
                progress_callback(msg)
            except Exception:
                pass
        logging.info(f"PDFScan: {msg}")

    # --- params / setup ---
    user_keywords = [k.lower().strip() for k in params.get("keywords_to_scan_in_pdf", []) if str(k).strip()]
    plot_type = params.get("plot_type", "snippets_only")
    corpus_source = params.get("corpus_source", "full_text").strip().lower()
    collection_name = params.get("collection_name_for_cache", "unknown_coll_pdfscan")
    safe_collection = re.sub(r'[^\w\-.]+', '_', collection_name)

    # focus keyword (for n-grams view)
    focus_kw = None
    if plot_type == "single_keyword_focus_ngrams":
        raw_focus = params.get("focus_keyword_for_details", "")
        if raw_focus and isinstance(raw_focus, str) and raw_focus.strip():
            focus_kw = raw_focus.lower().strip()
        elif user_keywords:
            focus_kw = user_keywords[0]
        if not focus_kw:
            _cb("No focus keyword for N-grams. Defaulting to snippet view.")
            plot_type = "snippets_only"

    _cb(f"PDF Scan for: {user_keywords[:3]}… on '{safe_collection}' • corpus='{corpus_source}' • view='{plot_type}'")

    if not user_keywords:
        return pd.DataFrame(), {"type": "message", "content": "No keywords provided to scan."}
    if df.empty or 'key' not in df.columns:
        return pd.DataFrame(), {"type": "message", "content": "'key' column missing or data empty."}
    if corpus_source == "full_text" and zotero_client is None:
        return pd.DataFrame(), {"type": "message", "content": "Zotero client not configured for full-text scan."}

    # --- main cache (collection+keyword set) ---
    sorted_kw = tuple(sorted(set(user_keywords)))
    kw_hash = hashlib.md5(str(sorted_kw).encode('utf-8')).hexdigest()[:8]
    cache_version = "v1.5_pdfscan_data"
    cache_filename = f"pdfscan_{safe_collection}_kw{kw_hash}_{corpus_source}_{cache_version}.pkl"
    cache_file = MAIN_APP_CACHE_DIR / cache_filename

    # data holders
    all_snippets: list[dict] = []
    hits_per_year: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    docs_mentioning: dict[str, list] = defaultdict(list)

    # --- try cache load ---
    if cache_file.exists():
        _cb(f"Attempting to load from cache: {cache_file.name}")
        try:
            with open(cache_file, "rb") as f:
                cached = pickle.load(f)
            all_snippets = cached.get("all_snippets", [])
            loaded_hits = cached.get("hits_per_year_detailed", {})
            for yr, kwc in loaded_hits.items():
                hits_per_year[int(yr)] = defaultdict(int, kwc)
            loaded_docs = cached.get("docs_mentioning_keyword", {})
            for kw, docs in loaded_docs.items():
                docs_mentioning[kw].extend(docs)
            if all_snippets or hits_per_year or docs_mentioning:
                _cb(f"SUCCESS: Loaded from cache. Snippets={len(all_snippets)}")
        except Exception as e:
            _cb(f"Cache load error: {e}. Re-processing…")
            all_snippets, hits_per_year, docs_mentioning = [], defaultdict(lambda: defaultdict(int)), defaultdict(list)

    # --- compute (cache miss or empty) ---
    if not all_snippets and not hits_per_year and not docs_mentioning:
        _cb("Processing corpus (cache miss)…")
        df_work = df.copy()
        if 'year' in df_work.columns:
            df_work['year_numeric'] = pd.to_numeric(df_work['year'], errors='coerce')
        else:
            df_work['year_numeric'] = pd.NA
            _cb("Warning: 'year' column missing.")

        # tiny per-item flat-text cache
        per_item_cache = MAIN_APP_CACHE_DIR / ".pdfscan_flat_text"
        per_item_cache.mkdir(parents=True, exist_ok=True)

        total = len(df_work)
        for i, (_idx, row) in enumerate(df_work.iterrows(), 1):
            key = row.get('key')
            year_val = row.get('year_numeric')
            year_int = int(year_val) if pd.notna(year_val) else None
            title = str(row.get('title', f"Item_{key}" if key else "Unknown Title"))
            authors = str(row.get('authors', 'N/A'))

            # 1) choose text
            text = _choose_corpus_text(
                row, corpus_source,
                zotero_client=zotero_client,
                mistral_api_key=os.environ.get("MISTRAL_API_KEY"),
                per_item_cache_dir=per_item_cache,
                progress_cb=_cb
            )
            if (i % 20 == 0) or (i == total):
                _cb(f"Processed corpus text {i}/{total} items.")

            if not text:
                continue

            # 2) scan
            matches = _scan_text_for_keywords(text, user_keywords, window=160)
            if not matches:
                continue

            # 3) record
            per_doc_kw = defaultdict(lambda: {
                "hits": 0, "plain_text_snippets": [], "rich_snippets": []
            })

            for m in matches:
                kw_found = str(m.get("keyword_found", "")).lower().strip()
                snippet_plain = m.get("snippet", "").strip()

                # Normalise to the expected downstream schema
                snippet_rich = {
                    "paragraph_context": snippet_plain,
                    "original_paragraph": snippet_plain,
                    "keyword_found": m.get("keyword_found", ""),
                    "page_number": None,                  # plain text path has no pages
                    "source_item_key": key,
                    "source_pdf_path": None,              # unknown here
                    "source_bib_header": f"{authors} ({year_int if year_int is not None else 'N/A'})",
                    "source_title": title
                }
                all_snippets.append(snippet_rich)

                if year_int is not None:
                    hits_per_year[year_int]["_overall_"] += 1
                    hits_per_year[year_int][kw_found] += 1

                per_doc_kw[kw_found]["hits"] += 1
                if snippet_plain:
                    per_doc_kw[kw_found]["plain_text_snippets"].append(snippet_plain)
                per_doc_kw[kw_found]["rich_snippets"].append(snippet_rich)

            for kw_norm, dval in per_doc_kw.items():
                docs_mentioning[kw_norm].append({
                    "key": key,
                    "title": title,
                    "authors": authors,
                    "year": year_int,
                    "hits_in_this_doc": dval["hits"],
                    "plain_text_snippets": dval["plain_text_snippets"],
                    "rich_snippets": dval["rich_snippets"],
                })

        # 4) write cache
        if all_snippets or hits_per_year or docs_mentioning:
            try:
                with open(cache_file, "wb") as f:
                    pickle.dump({
                        "all_snippets": all_snippets,
                        "hits_per_year_detailed": {yr: dict(kwc) for yr, kwc in hits_per_year.items()},
                        "docs_mentioning_keyword": {k: v for k, v in docs_mentioning.items()}
                    }, f)
                _cb(f"SUCCESS: Saved scan data to cache: {cache_file.name}")
            except Exception as e:
                _cb(f"ERROR saving cache: {e}")
    # --- prepare outputs ---
    df_result = pd.DataFrame(all_snippets) if all_snippets else pd.DataFrame()
    visual = {"type": "message", "content": "Select display or no visual."}

    # 1) Overall trend
    if plot_type == "overall_hits_trend":
        oy = {year: d.get("_overall_", 0) for year, d in hits_per_year.items() if d.get("_overall_", 0) > 0}
        if oy and 'year' in df.columns and df['year'].notna().any():
            pub_trend = pd.to_numeric(df['year'], errors='coerce').dropna().astype(int).value_counts().sort_index()
            hit_trend = pd.Series(oy).sort_index()
            if not pub_trend.empty and not hit_trend.empty:
                fig = go.Figure()
                fig.add_trace(go.Scatter(x=pub_trend.index.astype(str), y=pub_trend.values,
                                         name="Publications", mode='lines+markers'))
                fig.add_trace(go.Scatter(x=hit_trend.index.astype(str), y=hit_trend.values,
                                         name="Total Scan Keyword Hits", mode='lines+markers', yaxis="y2"))
                fig.update_layout(
                    title_text=f"Publications vs. Total Keyword Hits ({corpus_source})",
                    xaxis_title="Year",
                    yaxis_title="Pubs Count",
                    yaxis2=dict(title="Keyword Hits", overlaying='y', side='right', showgrid=False, zeroline=False),
                    xaxis_type='category', legend_title_text="Metric"
                )
                visual = fig
            else:
                visual = {"type": "message", "content": "Not enough data for overall trend."}
        else:
            visual = {"type": "message", "content": "No yearly keyword hits for trend."}

    # 2) Focus KW n-grams (from stored plain_text_snippets)
    elif plot_type == "single_keyword_focus_ngrams" and focus_kw:
        def _contains_phrase_in_ngram(ngram_tuple: tuple[str, ...], phrase_tokens: list[str]) -> bool:
            L = len(phrase_tokens)
            if L == 0:
                return False
            if L == 1:
                return phrase_tokens[0] in ngram_tuple
            N = len(ngram_tuple)
            for j in range(0, N - L + 1):
                if list(ngram_tuple[j:j + L]) == phrase_tokens:
                    return True
            return False

        # try direct lookup (works when the exact key exists in docs_mentioning)
        docs_data = docs_mentioning.get(focus_kw, [])

        # fallback for phrases: mine cached snippets by substring if dict is empty
        if not docs_data and " " in focus_kw and all_snippets:
            phrase = focus_kw.lower().strip()
            grouped = defaultdict(lambda: {
                "key": None, "title": "", "authors": "", "year": None,
                "hits_in_this_doc": 0, "plain_text_snippets": [], "rich_snippets": [],
            })
            for snip in all_snippets:
                para_plain = (snip.get("original_paragraph")
                              or _normalise_and_strip_html(snip.get("paragraph_context") or "")
                              or "")
                if phrase in para_plain.lower():
                    dkey = snip.get("source_item_key") or snip.get("key") or snip.get("source_pdf_path")
                    g = grouped[dkey]
                    g["key"] = dkey
                    g["title"] = snip.get("source_title", "")
                    g["authors"] = snip.get("source_bib_header", "")
                    g["year"] = snip.get("year")
                    g["plain_text_snippets"].append(para_plain)
                    g["rich_snippets"].append(snip)
                    g["hits_in_this_doc"] += 1
            docs_data = list(grouped.values())

        if not docs_data:
            visual = {"type": "message", "content": f"Focus keyword '{focus_kw}' not found in snippets."}
        else:
            from nltk import ngrams
            n = int(params.get("ngram_n_for_focus_kw", 2))
            min_freq = int(params.get("min_freq_for_focus_kw_ngrams", 2))
            top_n = int(params.get("top_n_ngrams_for_focus_kw_plot", 15))

            phrase_tokens = tokenize_for_ngram_context_refined(focus_kw)
            if not phrase_tokens:
                phrase_tokens = [t for t in focus_kw.lower().split() if t]

            n_for_gen = max(n, len(phrase_tokens))  # ensure n-gram can contain the whole phrase contiguously

            ngram_list: list[str] = []
            for doc in docs_data:
                for plain in doc.get("plain_text_snippets", []):
                    tokens = tokenize_for_ngram_context_refined(plain)
                    if len(tokens) < n_for_gen:
                        continue
                    for tup in ngrams(tokens, n_for_gen):
                        if _contains_phrase_in_ngram(tup, phrase_tokens):
                            ngram_list.append(" ".join(tup))

            cnt = Counter(ngram_list)
            df_ngrams = (pd.DataFrame([(k, v) for k, v in cnt.items() if v >= min_freq],
                                      columns=["Ngram", "Frequency"])
                         .sort_values("Frequency", ascending=False)
                         .head(top_n)
                         .reset_index(drop=True))

            if not df_ngrams.empty:
                fig = px.bar(df_ngrams, x="Ngram", y="Frequency",
                             title=f"Top contextual {n_for_gen}-grams containing '{focus_kw}' ({corpus_source})",
                             text_auto=True)
                fig.update_traces(textposition='outside')
                fig.update_xaxes(categoryorder="total descending", tickangle=-45)
                visual = fig
                df_result = df_ngrams
            else:
                visual = {"type": "message", "content": f"No frequent n-grams containing '{focus_kw}'."}
    # 3) Default: snippets-only (rich list for UI)
    elif all_snippets:
        visual = all_snippets
    else:
        visual = {"type": "message", "content": "No keyword snippets found."}

    _cb(f"analyze_pdf_keywords_and_trends returning. Visual type: {type(visual)}, Table rows: {len(df_result)}")
    return df_result, visual



# --- N-GRAM ANALYSIS FUNCTIONS ---

def _get_ngrams_from_text(text_content: str, ngram_n: int) -> list[str]:
    """Helper to extract n-grams from a single text string."""
    if not text_content.strip() or ngram_n < 1:
        return []
    tokens = tokenize_for_ngram_context_refined(text_content) # Keeps stopwords
    if len(tokens) >= ngram_n:
        return [" ".join(ngram_tuple) for ngram_tuple in nltk.ngrams(tokens, ngram_n)]
    return []

def _get_ngram_data_by_year(df: pd.DataFrame, data_source_param: str, ngram_n_size: int,
                            zotero_client_for_pdf=None, effective_collection_name_for_pdf_cache=None,
                            progress_callback=None) -> Dict[int, List[str]]:
    """
    Extracts n-grams from documents and groups them by year.
    Returns a dictionary: {year: [list_of_ngram_strings_for_that_year]}
    """
    def _local_callback(msg): # Nested callback for this specific helper
        if progress_callback: progress_callback(f"NgramByYear: {msg}")
        logging.debug(f"NgramByYear: {msg}")

    ngrams_by_year_dict = defaultdict(list)
    mistral_api_key_val = os.getenv(MISTRAL_API_KEY_ENV_VAR, "")

    if 'year' not in df.columns:
        _local_callback("Error: 'year' column missing in DataFrame for N-gram by year analysis.")
        return ngrams_by_year_dict

    df_analysis = df.copy()
    df_analysis['year_numeric'] = pd.to_numeric(df_analysis['year'], errors='coerce')
    df_analysis = df_analysis.dropna(subset=['year_numeric']) # Remove rows with unparsable years
    df_analysis['year_numeric'] = df_analysis['year_numeric'].astype(int)

    num_docs_total = len(df_analysis)
    docs_processed_count = 0

    for index, row in df_analysis.iterrows():
        text_content_for_doc = ""
        item_key_for_log = row.get('key', f"index_{index}")
        doc_year = row['year_numeric']

        # --- Text Extraction Logic (same as in analyze_ngrams main part) ---
        if data_source_param == "fulltext":
            raw_text_from_source = None
            if 'full_text' in row and pd.notna(row['full_text']) and str(row['full_text']).strip():
                raw_text_from_source = str(row['full_text'])
            elif zotero_client_for_pdf and 'key' in row and pd.notna(row['key']):
                item_key = row['key']; pdf_path_str = None
                try:
                    if hasattr(zotero_client_for_pdf, 'zot') and hasattr(zotero_client_for_pdf.zot, 'children'):
                        children = zotero_client_for_pdf.zot.children(item_key)
                        for child in children:
                            child_data = child.get('data', {});
                            if child_data.get('itemType') == 'attachment' and \
                               (child_data.get('contentType') == 'application/pdf' or child_data.get('filename', '').lower().endswith('.pdf')) and \
                               child_data.get('linkMode') not in ['linked_file', 'linked_url']:
                                temp_path = zotero_client_for_pdf.get_pdf_path_for_item(item_key_for_log)
                                if temp_path and Path(temp_path).exists(): pdf_path_str = temp_path; break
                except Exception as e_zot: _local_callback(f"Warn: Zotero PDF path error for {item_key_for_log}: {e_zot}")
                if pdf_path_str:
                    try:
                        markdown_content = process_pdf(pdf_path_str)
                        if markdown_content and not markdown_content.startswith("[Error") and not markdown_content.startswith("[Warning"): raw_text_from_source = markdown_content
                    except Exception as e_pdf_proc: _local_callback(f"Warn: PDF process error for {item_key_for_log}: {e_pdf_proc}")
            if raw_text_from_source: text_content_for_doc = _normalise_and_strip_html(raw_text_from_source)
            elif 'abstract' in row and pd.notna(row.get('abstract')): text_content_for_doc = _normalise_and_strip_html(str(row.get('abstract', "")))
        elif data_source_param == "abstract":
            if 'abstract' in df.columns and pd.notna(row.get('abstract')): text_content_for_doc = _normalise_and_strip_html(str(row.get('abstract', "")))
        elif data_source_param == "title":
            if 'title' in df.columns and pd.notna(row.get('title')): text_content_for_doc = _normalise_and_strip_html(str(row.get('title', "")))
        elif data_source_param == "controlled_vocabulary_terms":
            entry = row.get('controlled_vocabulary_terms'); temp_kws = []
            if isinstance(entry, list): temp_kws = [str(kw).strip().lower() for kw in entry if isinstance(kw, str) and kw.strip() and ":" not in kw]
            elif isinstance(entry, str): temp_kws = [kw.strip().lower() for kw in entry.split(';') if kw.strip() and ":" not in kw]
            text_content_for_doc = " ".join(k for k in temp_kws if k)
        # --- End of Text Extraction ---

        if text_content_for_doc.strip():
            doc_ngrams = _get_ngrams_from_text(text_content_for_doc, ngram_n_size)
            ngrams_by_year_dict[doc_year].extend(doc_ngrams)

        docs_processed_count += 1
        if docs_processed_count % 100 == 0 or docs_processed_count == num_docs_total:
            _local_callback(f"Aggregated N-grams for {docs_processed_count}/{num_docs_total} docs by year.")

    return ngrams_by_year_dict


# In data_processing.py


def _plot_ngram_evolution(
    ngrams_by_year: dict[int, list[str]],
    results_df: pd.DataFrame,
    ngram_n_size: int,
    top_n: int
) -> tuple[pd.DataFrame, go.Figure]:
    """Reusable evolution time series for top N-grams over years."""
    # 1) pick the top-N global n-grams
    top_ngrams = results_df.head(top_n)["Ngram"].tolist()
    # 2) build a list of records year → ngram → count
    records = []
    for year in sorted(ngrams_by_year):
        year_counts = Counter(ngrams_by_year[year])
        for ng in top_ngrams:
            records.append({
                "Year": int(year),
                "Ngram": ng,
                "Frequency": year_counts.get(ng, 0)
            })
    df_evo = pd.DataFrame(records)

    # 3) handle empty
    if df_evo.empty:
        fig = go.Figure().add_annotation(
            text="No evolution data to plot.",
            showarrow=False
        )
        return df_evo, fig

    # 4) pivot (so that even missing years show up as zero)
    df_pivot = (
        df_evo
        .pivot(index="Year", columns="Ngram", values="Frequency")
        .fillna(0)
        .sort_index()
    )

    # 5) build the figure trace by trace
    fig = go.Figure()
    for ng in df_pivot.columns:
        fig.add_trace(go.Scatter(
            x=df_pivot.index,
            y=df_pivot[ng],
            mode="lines+markers",
            name=ng,
            line=dict(shape="linear", width=2),
            marker=dict(size=6),
            hovertemplate=f"<b>{ng}</b><br>Year: %{{x}}<br>Count: %{{y}}<extra></extra>"
        ))

    # 6) layout polish
    fig.update_layout(
        template="plotly_white",
        title=dict(
            text=f"Evolution of Top {len(top_ngrams)} {ngram_n_size}-grams Over Time",
            x=0.5, font=dict(size=20, family="Arial", color="#1f77b4")
        ),
        xaxis=dict(
            title="Year",
            type="category",
            showgrid=False,
            linecolor="#1f77b4",
            tickfont=dict(size=12, family="Arial", color="#333"),
        ),
        yaxis=dict(
            title="Frequency",
            showgrid=True,
            gridcolor="#cfe3f3",
            zeroline=False,
            linecolor="#1f77b4",
            tickfont=dict(size=12, family="Arial", color="#333"),
        ),
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="center",
            x=0.5,
            font=dict(size=12, family="Arial")
        ),
        margin=dict(l=40, r=40, t=80, b=50),
    )

    return df_pivot.reset_index().melt(
        id_vars="Year", var_name="Ngram", value_name="Frequency"
    ), fig


from itertools import combinations
import pandas as pd
import plotly.graph_objects as go

AUTHORS_SECTION= ""


def _plot_author_collaboration_map(df: pd.DataFrame, params: dict, collaboration_type: str) -> tuple[
    pd.DataFrame, go.Figure]:
    """
    Creates a collaboration map for a specific author vs. countries or institutions.
    collaboration_type: 'country' or 'institution'
    """
    author_counts = Counter(author for authors_str in df['authors'].dropna() for author in authors_str.split(';'))
    default_author = author_counts.most_common(1)[0][0] if author_counts else None
    author_to_plot = params.get("author_name", default_author)

    if not author_to_plot:
        return pd.DataFrame(), go.Figure().add_annotation(text="No author to analyze.", showarrow=False)

    # Find all collaborations for the target author
    author_df = df[df['authors'].str.contains(re.escape(author_to_plot), na=False)].copy()

    collab_counts = Counter()
    for _, row in author_df.iterrows():
        # All other authors on the paper are collaborators
        collaborators = [a.strip() for a in row.get('authors', '').split(';') if
                         a.strip() and a.strip() != author_to_plot]
        if not collaborators:
            continue

        # Find the entities (countries/institutions) of these collaborators
        collaborator_df = df[df['authors'].apply(lambda x: any(c in str(x) for c in collaborators))]

        if collaboration_type == 'country':
            entities = collaborator_df['country'].explode().dropna().unique()
        elif collaboration_type == 'institution':
            entities = collaborator_df['institution'].dropna().unique()
        else:
            entities = []

        collab_counts.update(entities)

    if not collab_counts:
        msg = f"No {collaboration_type} collaborations found for {author_to_plot}."
        return pd.DataFrame(), go.Figure().add_annotation(text=msg, showarrow=False)

    results_df = pd.DataFrame(collab_counts.items(), columns=[collaboration_type.capitalize(), 'CollaborationCount'])
    results_df = results_df.sort_values('CollaborationCount', ascending=False)

    # Geocoding for the map
    if collaboration_type == 'country':
        # This requires a helper _centroid function you might have
        results_df[['lat', 'lon']] = results_df[collaboration_type.capitalize()].apply(
            lambda c: pd.Series(_centroid(c)))
    else:  # institution
        # This requires a helper get_institution_latlon function
        results_df[['lat', 'lon']] = results_df[collaboration_type.capitalize()].apply(
            lambda i: pd.Series(get_institution_latlon(i)))

    results_df.dropna(subset=['lat', 'lon'], inplace=True)

    fig = go.Figure(go.Scattergeo(
        lat=results_df['lat'], lon=results_df['lon'],
        text=results_df[collaboration_type.capitalize()] + "<br>Collaborations: " + results_df[
            'CollaborationCount'].astype(str),
        marker=dict(size=results_df['CollaborationCount'], sizemin=4, sizemode='area',
                    color=results_df['CollaborationCount'], colorscale='Viridis', showscale=True,
                    colorbar_title='Collaboration Count'),
        hovertemplate="%{text}<extra></extra>"
    ))
    fig.update_layout(title=f"Collaboration Map for {author_to_plot} by {collaboration_type.capitalize()}",
                      geo_scope='world')

    return results_df, fig


AUTHOR_START =""
# In your data_processing.py file

# Make sure these imports are at the top of your file
import pandas as pd
import plotly.graph_objects as go
from collections import Counter


# =========================================================================
# === 1. CORE HELPER: CALCULATE ALL AUTHOR STATISTICS (The Single Source of Truth)
# =========================================================================

def _calculate_h_index(citations: list[int]) -> int:
    """Helper function to calculate the h-index from a list of citation counts."""
    if not citations:
        return 0
    sorted_citations = sorted(citations, reverse=True)
    h = 0
    for i, count in enumerate(sorted_citations):
        if count >= (i + 1):
            h = i + 1
        else:
            break
    return h


def _calculate_all_author_stats(df: pd.DataFrame) -> pd.DataFrame:
    """
    A single, powerful function to calculate all key author metrics with
    STANDARDIZED column names.
    """
    if df is None or df.empty or "authors" not in df.columns or "citations" not in df.columns:
        logging.warning(
            "Author statistics calculation skipped: DataFrame is empty or missing 'authors'/'citations' columns.")
        return pd.DataFrame()

    df_analysis = df.copy()
    df_analysis['citations'] = pd.to_numeric(df_analysis['citations'], errors='coerce').fillna(0).astype(int)

    author_papers_citations = defaultdict(list)
    for _, row in df_analysis.iterrows():
        author_str = row.get('authors', '')
        if not isinstance(author_str, str): continue
        authors_in_doc = [author.strip() for author in author_str.split(';') if author.strip()]
        for author in authors_in_doc:
            author_papers_citations[author].append(row['citations'])

    if not author_papers_citations:
        logging.warning("No authors found after parsing the 'authors' column.")
        return pd.DataFrame()

    summary_list = []
    for author, citations_list in author_papers_citations.items():
        total_cites = sum(citations_list)
        pub_count = len(citations_list)
        h_index = _calculate_h_index(citations_list)
        avg_cites = total_cites / pub_count if pub_count > 0 else 0

        summary_list.append({
            'Author': author,
            'TotalPublications': pub_count,
            'TotalCitations': total_cites,
            'AvgCitationsPerPub': round(avg_cites, 2),
            'H-Index': h_index
        })

    return pd.DataFrame(summary_list)



# --- Trends & Evolution Plots ---


def _plot_author_career_trajectory(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, go.Figure]:
    """
    Creates a dual-axis career trajectory plot for a single author, showing
    their yearly publication count and average citation impact.
    """
    # Use the helper to get the most productive author if none is specified in params
    author_to_plot = params.get("author_name") or _get_top_author(df)

    if not author_to_plot:
        return pd.DataFrame(), go.Figure().add_annotation(text="No author available to analyze trajectory.",
                                                          showarrow=False)

    # Filter the main dataframe to get only the papers by the focus author
    author_df = df[df['authors'].str.contains(re.escape(author_to_plot), na=False)].copy()

    # Ensure 'year' and 'citations' are numeric and clean
    author_df['year'] = pd.to_numeric(author_df['year'], errors='coerce')
    author_df['citations'] = pd.to_numeric(author_df['citations'], errors='coerce').fillna(0)
    author_df.dropna(subset=['year'], inplace=True)
    author_df['year'] = author_df['year'].astype(int)

    if author_df.empty:
        return pd.DataFrame(), go.Figure().add_annotation(
            text=f"No valid publication data found for author: {author_to_plot}", showarrow=False)

    # Aggregate the data by year to get publication counts and average citations
    trajectory_df = author_df.groupby('year').agg(
        Publications=('title', 'count'),
        AvgCitations=('citations', 'mean')
    ).reset_index()

    # Ensure a continuous time series by reindexing to the full year range for this author
    full_year_range = range(trajectory_df['year'].min(), trajectory_df['year'].max() + 1)
    trajectory_df = trajectory_df.set_index('year').reindex(full_year_range, fill_value=0).reset_index()

    trajectory_df['AvgCitations'] = trajectory_df['AvgCitations'].round(2)

    # --- Create the Plot using Plotly Graph Objects for dual-axis control ---
    fig = go.Figure()

    # Add the Bar chart for Publications on the primary y-axis
    fig.add_trace(go.Bar(
        x=trajectory_df['year'],
        y=trajectory_df['Publications'],
        name='Publications',
        marker_color='cornflowerblue',
        hovertemplate="Year: %{x}<br>Publications: %{y}<extra></extra>"
    ))

    # Add the Line chart for Average Citations on the secondary y-axis
    fig.add_trace(go.Scatter(
        x=trajectory_df['year'],
        y=trajectory_df['AvgCitations'],
        name='Avg. Citations',
        mode='lines+markers',
        yaxis='y2',  # Assign this trace to the secondary y-axis
        marker=dict(color='darkorange', size=8),
        line=dict(width=3),
        hovertemplate="Year: %{x}<br>Avg. Citations: %{y:.2f}<extra></extra>"
    ))

    # --- Update the layout for a professional dual-axis chart ---
    fig.update_layout(
        title_text=f"Career Trajectory: <b>{author_to_plot}</b>",
        xaxis_title="Year",
        yaxis=dict(
            title="<b>Publications</b>",
            # titlefont=dict(color="cornflowerblue"),
            tickfont=dict(color="cornflowerblue"),
        ),
        yaxis2=dict(
            title="<b>Average Citations per Paper</b>",
            # titlefont=dict(color="darkorange"),
            tickfont=dict(color="darkorange"),
            anchor="x",
            overlaying="y",
            side="right"
        ),
        legend=dict(x=0.01, y=0.99, xanchor='left', yanchor='top'),
        barmode='group'
    )

    # Return the aggregated data for the table view and the final figure
    return trajectory_df, fig



AUTHOR_END=""


PROFILES_START=""
# === MASTER DISPATCHER FUNCTION FOR PROFILES ===
# =========================================================================

PROFILES_END=""
#####################################################################
### BEGIN AFFILIATIONS  (2025-06-09)  ################################
#####################################################################
AFFILIATION_BEGIN=""
import functools, logging, re
import pandas as pd
import plotly.graph_objects as go

# ──────────────────────────────────────────────────────────────────
#  0.  Country synonyms  (add more as needed)
# ──────────────────────────────────────────────────────────────────
# _COUNTRY_FIX = {
#     # simple spelling / abbreviations
#     "USA": "United States", "US": "United States",
#     "United States of America": "United States",
#     "UK": "United Kingdom", "U.K.": "United Kingdom",
#     "Czechia": "Czech Republic",
#     "Russian Federation": "Russia",
#     "Korea": "South Korea", "Republic of Korea": "South Korea",
#     "The Netherlands": "Netherlands", "the Netherlands": "Netherlands",
#     # ISO-2 that sometimes sneak in
#     "IR": "Iran", "IN": "India",
# }
#
# # fallback lat/lon for names *after* synonym fix
_COUNTRY_CENTROIDS: dict[str, tuple[float, float]] = {
    "United States":  (37.0902, -95.7129),
    "United Kingdom": (55.3781,  -3.4360),
    "Russia":         (61.5240, 105.3188),
    "Czech Republic": (49.8175,  15.4730),
    "Netherlands":    (52.1326,   5.2913),
}

_SPLIT_RE = re.compile(r"\s*[;,]\s*")       # split on ';' **or** ','
#
# # ──────────────────────────────────────────────────────────────────
# def _split_and_clean(raw: str) -> list[str]:
#     """
#     • split on ; / ,
#     • strip blanks
#     • drop “None specified”, “International”, “European Union” …
#     • apply synonym map
#     """
#     if not isinstance(raw, str):
#         return []
#     cleaned: list[str] = []
#     for part in _SPLIT_RE.split(raw):
#         p = part.strip()
#         if not p:
#             continue
#         p = COUNTRY_SYNONYM_MAP.get(p, p)          # synonym → canonical
#         if p.lower() in {"none specified", "international",
#                          "european union"}:
#             continue
#         cleaned.append(p)
#     return cleaned

# ──────────────────────────────────────────────────────────────────
def _clean(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    df2 = df.copy()
    for c in cols:
        if c not in df2.columns:
            raise ValueError(f"Column '{c}' missing in dataframe.")
        df2[c] = df2[c].astype(str).str.strip().replace({"": pd.NA})
    # must have at least country
    return df2.dropna(subset=[cols[0]])

# ──────────────────────────────────────────────────────────────────
def _country_counts(df: pd.DataFrame, *, by_authors: bool = False) -> pd.DataFrame:
    """
    Return dataframe: country | count
    """
    work = df.explode("country")                 # ← list → rows
    if by_authors and "authors" in work.columns:
        work = work.explode("authors")
    counts = (
        work["country"]
        .dropna()
        .value_counts()
        .reset_index(name="count")
        .rename(columns={"index": "country"})
    )
    return counts



# ──────────────────────────────────────────────────────────────────
@functools.lru_cache(maxsize=512)
def _centroid(country: str) -> tuple[float | None, float | None]:
    if country in _COUNTRY_CENTROIDS:
        return _COUNTRY_CENTROIDS[country]


    import geopandas as gpd, pycountry
    world = gpd.read_file(gpd.datasets.get_path("naturalearth_lowres"))
    row   = world[world["name"] == country]
    if row.empty:
        try:
            iso3 = pycountry.countries.lookup(country).alpha_3
            row   = world[world["iso_a3"] == iso3]
        except LookupError:
            pass
    if not row.empty:
        geom = row.iloc[0].geometry.centroid
        return round(geom.y, 4), round(geom.x, 4)


    # warn once
    printed = getattr(_centroid, "_warned", set())
    if country not in printed:
        logging.warning(f"[Geo] No centroid for “{country}” – will be skipped.")
        printed.add(country)
        _centroid._warned = printed
    return None, None

# 1 ─────────  animated maps  ─────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════
#  Choropleth  — world-map of publications / authors
# ═══════════════════════════════════════════════════════════════════
def _make_world_map(df: pd.DataFrame, *, by_authors: bool = False) -> go.Figure:
    """
    World map helper used by the renderer.

    NOTE: Plotly choropleth world maps require loading external topojson (often blocked by CSP/offline).
    We default to an offline-safe scattergeo bubble-map instead.
    """
    return _make_bubble_map(df, by_authors=by_authors)




def _make_bubble_map(df: pd.DataFrame, *, by_authors: bool = False) -> go.Figure:
    cc = _country_counts(df, by_authors=by_authors)
    if cc.empty:
        return go.Figure().add_annotation(text="No country data.", showarrow=False)

    # attach centroids
    cc[["lat", "lon"]] = cc["country"].apply(
        lambda c: pd.Series(_centroid(c)))
    cc = cc.dropna(subset=["lat", "lon"])
    if cc.empty:
        return go.Figure().add_annotation(text="No coordinates.", showarrow=False)

    scale = max(cc["count"].max() / 60, 1)
    fig = go.Figure(go.Scattergeo(
        lat=cc["lat"], lon=cc["lon"],
        text=cc["country"] + "<br>" + cc["count"].astype(str),
        marker=dict(size=cc["count"] / scale,
                    color=cc["count"],
                    colorscale="Plasma",
                    colorbar_title="Count",
                    line_width=0.4),
        hovertemplate="%{text}<extra></extra>"
    ))
    fig.update_layout(title=("Author" if by_authors else "Publication") +
                             " Bubble-map",
                      margin=dict(l=0, r=0, t=60, b=0),
                      geo=dict(showland=True, landcolor="#E5E5E5",
                               showcountries=True, countrycolor="white"))
    return fig


# 2 ─────────  scatter institutions  – add tiny jitter  ───────────
import numpy as _np


# 3 ─────────  toy collaboration network (country level)  ─────────
# ──────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
#  Country ⇄ Country collaboration network  (robust – no “pair” KeyError)
# ─────────────────────────────────────────────────────────────────────────────
#
# ──────────────────────────────────────────────────────────────────

#
# # ──────────────────────────────────────────────────────────────────
# # ──────────────────────────────────────────────────────────────────
# # 1)  Bubble-map helper  (rename kwarg → by_authors)
# # ──────────────────────────────────────────────────────────────────
# def _make_bubble_map(df: pd.DataFrame, *, by_authors: bool = False) -> go.Figure:
#     """
#     Scatter-geo with bubble size ∝ publication (or author) count.
#     """
#     cc = _country_counts(df, by_authors=by_authors)
#     if cc.empty:
#         return go.Figure().add_annotation(text="No country data.", showarrow=False)
#
#     # attach lat/lon
#     cc[["lat", "lon"]] = cc["country"].apply(lambda c: pd.Series(_centroid(c)))
#     cc = cc.dropna(subset=["lat", "lon"])
#     if cc.empty:
#         return go.Figure().add_annotation(
#             text="Coordinates missing for all countries.", showarrow=False)
#
#     scale = max(cc["count"].max() / 60, 1)
#     fig = go.Figure(go.Scattergeo(
#         lat=cc["lat"],
#         lon=cc["lon"],
#         text=cc["country"] + "<br>" + cc["count"].astype(str),
#         marker=dict(size=cc["count"] / scale,
#                     color=cc["count"],
#                     colorscale="Viridis",
#                     sizemode="area",
#                     line_width=0.5),
#         hovertemplate="%{text} items<extra></extra>"
#     ))
#     fig.update_layout(
#         title="Author bubble-map" if by_authors else "Publication bubble-map",
#         geo=dict(showland=True, landcolor="#E5E5E5",
#                  showcountries=True, countrycolor="white"),
#         margin=dict(l=0, r=0, t=50, b=0))
#     return fig

# ──────────────────────────────────────────────────────────────────
def _make_country_bar(df: pd.DataFrame, top_n: int) -> go.Figure:
    cc = _country_counts(df).nlargest(top_n, "count")
    fig = px.bar(cc, x="country", y="count",
                 title=f"Top {top_n} publishing countries")
    fig.update_layout(xaxis_tickangle=-45, yaxis_title="Publications",
                      margin=dict(t=60))
    return fig

# ──────────────────────────────────────────────────────────────────
def _make_institution_bar(df: pd.DataFrame, top_n: int) -> go.Figure:
    inst = (df["institution"].dropna()
            .astype(str).str.strip()
            .loc[lambda s: s != ""]
            .value_counts()
            .head(top_n)
            .reset_index()
            .rename(columns={"index": "institution", 0: "count"}))
    fig = px.bar(inst, x="institution", y="count",
                 title=f"Top {top_n} institutions")
    fig.update_layout(xaxis_tickangle=-45, yaxis_title="Publications",
                      margin=dict(t=60))
    return fig

# ──────────────────────────────────────────────────────────────────
# ──────────────────────────────────────────────────────────────────
def _make_department_sunburst(df: pd.DataFrame,
                              *,
                              include_authors: bool = False) -> go.Figure:
    """
    Build  Country → Institution → Department (→ Author)  sunburst.
    Works with the new list-of-countries column.
    """
    cols = ["country", "institution", "department"]

    base = (
        df.explode("country")          # <<<  key line: list → rows
          .dropna(subset=["country", "institution"])
          .assign(department=lambda d: d["department"].fillna("—"))
    )

    if include_authors and "authors" in base.columns:
        base = base.explode("authors")
        cols.append("authors")

    # Plotly requires that all internal nodes have at least one child
    def _row_ok(r):
        # if a parent level is NA while a child is not → reject
        for i in range(len(cols) - 1):
            if pd.isna(r[cols[i]]) and pd.notna(r[cols[i + 1]]):
                return False
        return True

    base = base.loc[base.apply(_row_ok, axis=1)]
    if base.empty:
        return go.Figure().add_annotation(
            text="No rows form a complete hierarchy.", showarrow=False)

    base["value"] = 1
    fig = px.sunburst(base, path=cols, values="value",
                      title=" → ".join(c.title() for c in cols))
    fig.update_layout(margin=dict(l=0, r=0, t=60, b=0))
    return fig

import re
import pandas as pd
from typing import List

# ─────────────────────────────────────────────────────────────────────────────
#  1.  A comprehensive country‐synonym map (all keys lowercased)
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────
#  master lookup  (all keys MUST be lower-case & stripped)
# ─────────────────────────────────────────────────────────────
#
#
# def normalize_country(name: str) -> str:
#     """Trim, lowercase, map synonyms, then title-case fallback."""
#     n = name.strip()
#     key = n.lower()
#     if key in COUNTRY_SYNONYMS:
#         return COUNTRY_SYNONYMS[key]
#     # if it isn’t in our map, just title-case it
#     return n.title()

# ─────────────────────────────────────────────────────────────────────────────
#  2.  Helper: split & clean each raw-cell into a list of strings
# ─────────────────────────────────────────────────────────────────────────────
def _split_clean(cell: object) -> List[str]:
    """
    - Splits on semicolons or commas
    - Strips whitespace
    - Drops blank or “None specified”
    """
    if pd.isna(cell):
        return []
    parts = re.split(r"[;,]", str(cell))
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if p.lower() == "none specified":
            continue
        out.append(p)
    return out

# ─────────────────────────────────────────────────────────────────────────────
#  3.  Master cleaner / exploder
# ─────────────────────────────────────────────────────────────────────────────
# ────────────────────────────────────────────────────────────────
#  Minimal but extendable country-name harmoniser
#  -- all keys MUST be lower-case, values are the canonical names
# ────────────────────────────────────────────────────────────────
# COUNTRY_NORMALISER: dict[str, str] = {
#     # --- United States -----------------------------------------------------
#     "usa": "United States", "us": "United States", "u.s.": "United States",
#     "u.s.a.": "United States", "united states": "United States",
#     "united states of america": "United States", "america": "United States",
#     "the united states": "United States",
#     "us; us": "United States", "usa; usa": "United States",
#     # many “USA; USA; …”  (7–11 times) – unify by catching the prefix
#     **{f'usa; {"usa; " * n}usa'.strip(): "United States" for n in range(1, 11)},
#     "united states; united states": "United States",
#
#     # --- United Kingdom ----------------------------------------------------
#     "uk": "United Kingdom", "u.k.": "United Kingdom",
#     "great britain": "United Kingdom", "britain": "United Kingdom",
#     "united kingdom": "United Kingdom",
#     # common compound tokens
#     "uk; uk": "United Kingdom", "uk; usa": "United Kingdom",
#     "uk; us": "United Kingdom",
#
#     # --- Russia ------------------------------------------------------------
#     "russia": "Russian Federation", "russian federation": "Russian Federation",
#     "russia; russia": "Russian Federation",
#
#     # --- Czech Republic ----------------------------------------------------
#     "czechia": "Czech Republic", "czech republic": "Czech Republic",
#     "czech republic; czech republic": "Czech Republic",
#
#     # --- Netherlands -------------------------------------------------------
#     "the netherlands": "Netherlands", "netherlands": "Netherlands",
#     "holland": "Netherlands",
#     "netherlands; netherlands": "Netherlands",
#     "netherlands; netherlands; france": "Netherlands",
#
#     # --- Korea -------------------------------------------------------------
#     "korea": "South Korea", "south korea": "South Korea",
#     "north korea": "North Korea",
#
#     # --- Macedonia ---------------------------------------------------------
#     "republic of macedonia": "North Macedonia",
#     "north macedonia": "North Macedonia",
#
#     # --- Misc single-country tokens (simply map to title-case) -------------
#     "philippines": "Philippines", "switzerland": "Switzerland",
#     "australia": "Australia", "romania": "Romania", "canada": "Canada",
#     "germany": "Germany", "estonia": "Estonia", "sweden": "Sweden",
#     "china": "China", "chile": "Chile", "nigeria": "Nigeria",
#     "india": "India", "japan": "Japan", "new zealand": "New Zealand",
#     "kenya": "Kenya", "austria": "Austria", "spain": "Spain",
#     "iran": "Iran", "malaysia": "Malaysia", "slovakia": "Slovakia",
#     "georgia": "Georgia", "ukraine": "Ukraine", "northern cyprus": "Cyprus",
#     "finland": "Finland", "singapore": "Singapore", "kuwait": "Kuwait",
#     "ireland": "Ireland", "norway": "Norway", "italy": "Italy",
#     "greece": "Greece", "pakistan": "Pakistan", "israel": "Israel",
#     "egypt": "Egypt", "poland": "Poland", "brazil": "Brazil",
#     "belgium": "Belgium", "denmark": "Denmark", "lithuania": "Lithuania",
#     "south africa": "South Africa", "taiwan": "Taiwan",
#
#     # --- European Union ----------------------------------------------------
#     "eu": "European Union", "e.u.": "European Union",
#     "european union": "European Union",
#
#     # --- special placeholders ---------------------------------------------
#     "none specified": pd.NA, "": pd.NA,
# }

# ────────────────────────────────────────────────────────────────────
# ───────────────────────────────────────────────────────────────────
# _COUNTRY_LOOKUP = {alias: canon
#                    for canon, aliases in COUNTRY_SYNONYMS.items()
#                    for alias in aliases}

# ------------------------------------------------------------------
# def normalise_countries(raw_col: pd.Series,
#                         *,
#                         return_list: bool | None = None,
#                         to_list: bool | None = None) -> pd.Series:
#     """
#     Clean + map synonyms → canonical names.
#
#     Parameters
#     ----------
#     raw_col     : Series with the original strings
#     return_list : True  → each cell becomes a list      (preferred kw-name)
#     to_list     : deprecated alias kept for backward-compatibility
#     """
#     # honour whichever keyword the caller used
#     as_list = bool(return_list if return_list is not None else to_list)
#
#     def _map_cell(raw):
#         if pd.isna(raw):
#             return pd.NA
#         toks = [t.strip().lower() for t in str(raw).split(";")]
#         mapped = [_COUNTRY_LOOKUP.get(t, t.title())
#                   for t in toks if t and t != "none specified"]
#         seen, out = set(), []
#         for m in mapped:
#             if m not in seen:
#                 out.append(m)
#                 seen.add(m)
#         if not out:
#             return pd.NA
#         return out if as_list else "; ".join(out)
#
#     return raw_col.map(_map_cell)
#
# def clean_affiliation_geography(df: pd.DataFrame) -> pd.DataFrame:
#     df2 = df.copy()
#
#     if "country" not in df2.columns:
#         raise ValueError("'country' column missing in dataframe.")
#
#     # always store the canonical list form
#     df2["country"] = normalise_countries(df2["country"], return_list=True)
#
#     for col in ("institution", "department"):
#         if col in df2.columns:
#             df2[col] = (df2[col]
#                          .astype(str)
#                          .str.strip()
#                          .replace({"": pd.NA, "None specified": pd.NA}))
#
#     return df2.dropna(subset=["country"])



def _add_inst_coordinates(df: pd.DataFrame) -> pd.DataFrame:
    """
    For scatter / bubble maps: append lat / lon columns on demand.
    """
    dfc = df.copy()
    dfc[["lat", "lon"]] = dfc["institution"].apply(
        lambda inst: pd.Series(lookup_inst_centroid(inst)))
    return dfc.dropna(subset=["lat", "lon"])
# ─────────────────────────────────────────────────────────────────────────────
#  Split an “institution” cell into a clean list[str]
# ─────────────────────────────────────────────────────────────────────────────
def _split_institutions(cell: str | float) -> list[str]:
    """
    Handles   • NaN / empty
              • cells that already are lists (after earlier explode)
              • 'A; B; C'  →  ['A','B','C']   (whitespace trimmed)
    """
    if pd.isna(cell):
        return []
    if isinstance(cell, list):
        return [s.strip() for s in cell if s and s.strip()]
    return [s.strip() for s in str(cell).split(";") if s and s.strip()]

# ──────────────────────────────────────────────────────────────────
# ──────────────────────────────────────────────────────────────────


# ──────────────────────────────────────────────────────────────────
def _scatter_institutions(df: pd.DataFrame) -> go.Figure:
    tmp = df.copy()
    tmp[["lat", "lon"]] = tmp["country"].apply(
        lambda c: pd.Series(_centroid(c)))
    tmp = tmp.dropna(subset=["lat", "lon"])
    if tmp.empty:
        return go.Figure().add_annotation(text="No coordinates.", showarrow=False)

    # add ±0.25° jitter so overlapping dots become visible
    rng = _np.random.default_rng(0)
    tmp["lat"] += rng.uniform(-.25, .25, len(tmp))
    tmp["lon"] += rng.uniform(-.25, .25, len(tmp))

    fig = px.scatter_geo(tmp, lat="lat", lon="lon",
                         hover_name="institution",
                         color="country",
                         title=f"{len(tmp):,} Institutions (country centroids)")
    fig.update_layout(margin=dict(l=0, r=0, t=60, b=0))
    return fig

# ---------------------------------------------------------------------
def _load_geocache() -> dict[str, Tuple[float, float]]:
    if _GEOCACHE_FILE.exists():
        try:
            with _GEOCACHE_FILE.open("r", encoding="utf-8") as fh:
                raw = json.load(fh)
            return {k: tuple(v) for k, v in raw.items()}
        except Exception as e:
            logging.warning(f"[Geo] Could not read cache – starting fresh: {e}")
    return {}

def _save_geocache(cache: dict[str, Tuple[float, float]]) -> None:
    try:
        with _GEOCACHE_FILE.open("w", encoding="utf-8") as fh:
            json.dump(cache, fh)
    except Exception as e:
        logging.warning(f"[Geo] Could not write cache: {e}")

_inst_cache: dict[str, Tuple[float, float]] = _load_geocache()
@functools.lru_cache(maxsize=2048)
def lookup_inst_centroid(inst_raw: str,
                         *,
                         timeout: float = 5.0,
                         retries: int = 2) -> Tuple[Optional[float], Optional[float]]:
    """
    Return (lat, lon) for an institution, using OpenStreetMap’s Nominatim.
    Implements local caching, polite user-agent, exponential back-off and
    *very* lightweight normalisation of the query.

    If nothing can be resolved ⇒ (None, None)
    """
    # ---- 0.  Cached? -----------------------------------------------
    inst_key = inst_raw.strip()
    if inst_key in _inst_cache:
        return _inst_cache[inst_key]

    # ---- 1.  Minimal cleaning for better hit-rate -------------------
    #       • take only the first institution when they’re separated by “;”
    q = inst_key.split(";")[0].strip()
    #       • compress internal whitespace
    q = re.sub(r"\s+", " ", q)

    # Some institutions include the department after a comma – that can hurt
    # geocoding if the department isn’t known to OSM.
    if "," in q and not q.lower().startswith("university"):
        q = q.split(",")[0]

    # ---- 2.  Query Nominatim ---------------------------------------
    url = "https://nominatim.openstreetmap.org/search"
    params = {"q": f"{q} University",       # appending “University” helps a lot
              "format": "json",
              "limit": 1}

    backoff = 1.0
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url,
                                params=params,
                                headers={"User-Agent": _USER_AGENT},
                                timeout=timeout)
            resp.raise_for_status()
            data = resp.json()
            if data:
                lat, lon = float(data[0]["lat"]), float(data[0]["lon"])
                _inst_cache[inst_key] = (lat, lon)
                _save_geocache(_inst_cache)       # fire-and-forget
                return lat, lon
            break                                # no result → don’t retry
        except requests.exceptions.Timeout:
            logging.warning(f"[Geo] TIMEOUT for “{q}” (try {attempt+1}/{retries})")
        except Exception as e:
            logging.warning(f"[Geo] Geocoding error for “{q}”: {e}")
            break

        time.sleep(backoff)                      # polite exponential back-off
        backoff *= 2

    # ---- 3.  Fail gracefully ---------------------------------------
    _inst_cache[inst_key] = (None, None)
    return None, None
# ──────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────
# def analyze_affiliations(df: pd.DataFrame,
#                          params: dict,
#                          progress_callback=None) -> tuple[pd.DataFrame, go.Figure]:
#
#     _cb  = (lambda m: progress_callback(f"AFFIL: {m}")
#             if progress_callback else (lambda *_: None))
#
#     PLOT     = params.get("plot_type",   "world_map_pubs")
#     TOPN     = int(params.get("top_n",   20))
#     MIN_EDGE = int(params.get("min_collaborations", 2))
#
#     # 1  clean / normalise
#     df_clean = df
#
#     # ── WORLD MAPS ───────────────────────────────────────────────────────────
#     if PLOT == "world_map_pubs":
#         cc = _country_counts(df_clean, by_authors=False)
#         return cc, _make_world_map(df_clean, by_authors=False)
#
#     if PLOT == "world_map_authors":
#         cc = _country_counts(df_clean, by_authors=True)
#         return cc, _make_world_map(df_clean, by_authors=True)
#
#     # ── BUBBLE MAPS ──────────────────────────────────────────────────────────
#     if PLOT == "bubble_map_pubs":
#         cc = _country_counts(df_clean, by_authors=False)
#         return cc, _make_bubble_map(df_clean, by_authors=False)
#
#     if PLOT == "bubble_map_authors":
#         cc = _country_counts(df_clean, by_authors=True)
#         return cc, _make_bubble_map(df_clean, by_authors=True)
#
#     # ── GEO-SCATTER (institutions) ──────────────────────────────────────────
#     if PLOT == "geo_scatter_institutions":
#         return _make_scatter_institutions(df_clean)   # returns (df, fig)
#
#     # ── TOP-N COUNTRY BARS / PIE ────────────────────────────────────────────
#     if PLOT == "country_bar":
#         cc = _country_counts(df_clean).nlargest(TOPN, "count")
#         fig = px.bar(cc, x="country", y="count",
#                      title=f"Top {TOPN} Countries",
#                      color="count", color_continuous_scale="Viridis")
#         fig.update_layout(xaxis_tickangle=-45, margin=dict(t=60))
#         return cc, fig
#
#     if PLOT == "country_pie":
#         cc = _country_counts(df_clean).nlargest(TOPN, "count")
#         return cc, _make_country_pie(cc, TOPN)
#
#     if PLOT == "institution_bar":
#         inst = (df_clean["institution"]
#                 .value_counts()
#                 .head(TOPN)
#                 .reset_index(name="count")
#                 .rename(columns={"index": "institution"}))
#         fig = px.bar(inst, x="institution", y="count",
#                      title=f"Top {TOPN} Institutions",
#                      color="count", color_continuous_scale="Viridis")
#         fig.update_layout(xaxis_tickangle=-45, margin=dict(t=60))
#         return inst, fig
#
#     # ── SUNBURST ────────────────────────────────────────────────────────────
#     if PLOT == "department_sunburst":
#         fig = _make_department_sunburst(
#             df_clean,
#             include_authors=params.get("with_authors", False)
#         )
#         return pd.DataFrame(), fig
#
#     # ── COLLAB / CHORD VISUALS ──────────────────────────────────────────────
#     if PLOT == "collab_network_country":
#         fig = _make_collab_network_country(df_clean, MIN_EDGE, TOPN)
#         return pd.DataFrame(), fig
#
#     if PLOT == "collab_network_institution":
#         fig = _make_collab_network_institution(df_clean, MIN_EDGE, TOPN)
#         return pd.DataFrame(), fig
#
#     if PLOT == "chord_inst_country":
#         fig = _make_chord_inst_country(df_clean, TOPN)
#         return pd.DataFrame(), fig
#
#     # ── FALLBACK ────────────────────────────────────────────────────────────
#     return pd.DataFrame(), go.Figure().add_annotation(
#         text=f"Unknown plot_type “{PLOT}”.", showarrow=False)
# ─────────────────────────────────────────────────────────────────────────────
#  Institution ⇄ Institution collaboration network
# ─────────────────────────────────────────────────────────────────────────────
AFFILIATIONS_END=""
#####################################################################
### END AFFILIATIONS ################################################
#####################################################################
TEMPORAL_START=""


import pandas as pd
import plotly.graph_objects as go
from typing import Tuple


def analyze_comparative_crosstab(df: pd.DataFrame, params: dict, callback) -> Tuple[pd.DataFrame, go.Figure]:
    """Creates a crosstabulation heatmap between two categorical features."""
    feature1 = params.get("feature1")
    feature2 = params.get("feature2")

    if not all([feature1, feature2]) or feature1 not in df.columns or feature2 not in df.columns:
        return pd.DataFrame(), go.Figure().add_annotation(text="Invalid features selected for comparison.")

    # Explode both columns if they are list-like
    df_c = df[[feature1, feature2]].copy().dropna()
    for col in [feature1, feature2]:
        if df_c[col].dtype == 'object' and df_c[col].dropna().apply(lambda x: isinstance(x, list)).any():
            df_c = df_c.explode(col)

    df_c.dropna(inplace=True)

    # Create the contingency table
    crosstab_df = pd.crosstab(df_c[feature1], df_c[feature2])

    fig = px.imshow(
        crosstab_df,
        text_auto=True,  # Display counts on cells
        aspect="auto",
        labels=dict(x=feature2.replace("_", " ").title(), y=feature1.replace("_", " ").title(), color="Count"),
        title=f"Comparison: {feature1.replace('_', ' ').title()} vs. {feature2.replace('_', ' ').title()}"
    )
    fig.update_xaxes(side="top")

    return crosstab_df.reset_index(), fig


def _create_temporal_trend_plot(df: pd.DataFrame, params: dict, callback) -> Tuple[pd.DataFrame, go.Figure]:
    """
    A dedicated 'private' function that ONLY handles the creation of the 9
    different trend-over-time visualizations, including a sophisticated
    animated line race.
    """
    chart_type = params.get("chart_type", "multi_line_trend")
    feature_col = params.get("feature", "publications")

    feature_col_for_plot = feature_col if feature_col != "publications" else 'feature'

    title_feature = feature_col.replace('_', ' ').title()
    title_chart = chart_type.replace('_', ' ').title()
    full_title = f"Evolution of {title_feature}: {title_chart}"

    agg_df = df
    color_scheme = px.colors.qualitative.Vivid

    # =======================================================================
    # === SOPHISTICATED ANIMATED LINE RACE IMPLEMENTATION ===
    # =======================================================================
    if chart_type == "animated_line_race":
        callback("Constructing sophisticated line race animation...")
        fig = go.Figure()

        categories = agg_df[feature_col_for_plot].unique()
        years = sorted(agg_df['year'].unique())
        colors = color_scheme * (len(categories) // len(color_scheme) + 1)

        # 1. Add one empty, styled trace for each category to build the legend
        for i, category in enumerate(categories):
            fig.add_trace(go.Scatter(
                x=[], y=[],
                name=category,
                mode='lines',
                line=dict(color=colors[i], width=3)
            ))

        # 2. Create a frame for each year of the animation
        frames = []
        for year in years:
            frame_data = []
            # In each frame, we add the data for each category *up to that year*
            for i, category in enumerate(categories):
                trace_df = agg_df[(agg_df[feature_col_for_plot] == category) & (agg_df['year'] <= year)]
                frame_data.append(go.Scatter(x=trace_df['year'], y=trace_df['Count']))

            frames.append(go.Frame(data=frame_data, name=str(year)))

        fig.frames = frames

        # 3. Define the animation player buttons and slider
        def frame_args(duration):
            return {"frame": {"duration": duration, "redraw": True},
                    "transition": {"duration": 0, "easing": "linear"}}

        sliders = [{"pad": {"b": 10, "t": 50}, "len": 0.9, "x": 0.1, "y": 0,
                    "steps": [
                        {"args": [[f.name], frame_args(50)],  # 50ms per frame
                         "label": f.name, "method": "animate"}
                        for f in fig.frames
                    ]}]

        # 4. Update the layout with the animation controls and styling
        fig.update_layout(
            title=full_title,
            xaxis=dict(range=[min(years) - 1, max(years) + 1], autorange=False, title="Year"),
            yaxis=dict(range=[0, agg_df['Count'].max() * 1.15], autorange=False, title="Count"),
            updatemenus=[{
                "buttons": [
                    {"args": [None, frame_args(50)], "label": "▶ Play", "method": "animate"},
                    {"args": [[None], frame_args(0)], "label": "❚❚ Pause", "method": "animate"}
                ],
                "direction": "left", "pad": {"r": 10, "t": 60}, "type": "buttons", "x": 0.1, "y": 0
            }],
            sliders=sliders,
            legend_title_text=title_feature,
            colorway=colors
        )

        # The function returns here for this specific chart type
        return agg_df, fig

    # --- The rest of the plotting logic remains the same ---

    elif chart_type == "multi_line_trend":
        fig = px.line(agg_df, x='year', y='Count', color=feature_col_for_plot, markers=True,
                      title=full_title, color_discrete_sequence=color_scheme)
        fig.update_layout(legend_title_text=title_feature)

    # ... (paste all the other elif blocks for bar, area, animated_bar, etc. here)
    elif chart_type == "bar":
        fig = px.bar(agg_df, x='year', y='Count', color=feature_col_for_plot,
                     title=full_title, barmode='stack', color_discrete_sequence=color_scheme)
        fig.update_layout(legend_title_text=title_feature)

    elif chart_type == "area":
        fig = px.area(agg_df, x='year', y='Count', color=feature_col_for_plot,
                      title=full_title, color_discrete_sequence=color_scheme)
        fig.update_layout(legend_title_text=title_feature)

    elif chart_type == "cumulative_area":
        agg_df['Cumulative Count'] = agg_df.groupby(feature_col_for_plot)['Count'].cumsum()
        fig = px.area(agg_df, x='year', y='Cumulative Count', color=feature_col_for_plot,
                      title=f"Cumulative Growth of {title_feature}", color_discrete_sequence=color_scheme)
        fig.update_layout(legend_title_text=title_feature, yaxis_title="Cumulative Count")

    elif chart_type == "bubble":
        bubble_df = agg_df.groupby(feature_col_for_plot)['Count'].sum().reset_index()
        fig = px.scatter(bubble_df, x=feature_col_for_plot, y='Count', size='Count', color=feature_col_for_plot,
                         title=f"Overall Contribution of Top {params.get('top_n')} {title_feature}",
                         hover_name=feature_col_for_plot, color_discrete_sequence=color_scheme)
        fig.update_traces(marker=dict(sizemin=5, line_width=1, line_color='black'))
        fig.update_layout(xaxis_title=title_feature, yaxis_title="Total Count")

    elif chart_type == "heat":
        pivot_df = agg_df.pivot_table(index=feature_col_for_plot, columns='year', values='Count', fill_value=0)
        fig = px.imshow(pivot_df, text_auto=".0f", aspect='auto',
                        title=f"Activity Heatmap: {title_feature} Over Time",
                        color_continuous_scale="YlGnBu")
        fig.update_layout(xaxis_title="Year", yaxis_title=title_feature)
        return pivot_df.reset_index(), fig

    elif chart_type == "animated_bar":
        anim_df = agg_df.pivot_table(index='year', columns=feature_col_for_plot, values='Count').fillna(
            0).stack().reset_index(name='Count')
        anim_df.sort_values(['year', 'Count'], ascending=[True, False], inplace=True)
        fig = px.bar(anim_df, x=feature_col_for_plot, y='Count', color=feature_col_for_plot,
                     animation_frame='year', animation_group=feature_col_for_plot,
                     range_y=[0, agg_df['Count'].max() * 1.15],
                     title=f"Animated Ranking: {title_feature}",
                     labels={'y': 'Count', feature_col_for_plot: title_feature},
                     color_discrete_sequence=color_scheme)
        fig.layout.updatemenus[0].buttons[0].args[1]['frame']['duration'] = 200
        fig.layout.updatemenus[0].buttons[0].args[1]['transition']['duration'] = 50

    elif chart_type == "animated_scatter":
        all_years = sorted(agg_df['year'].unique())
        all_cats = agg_df[feature_col_for_plot].unique()
        template_df = pd.MultiIndex.from_product([all_years, all_cats], names=['year', feature_col_for_plot]).to_frame(
            index=False)
        anim_df = pd.merge(template_df, agg_df, on=['year', feature_col_for_plot], how='left').fillna(0)
        fig = px.scatter(anim_df, x='year', y=feature_col_for_plot, size='Count', color=feature_col_for_plot,
                         animation_frame='year', animation_group=feature_col_for_plot,
                         range_x=[agg_df['year'].min() - 1, agg_df['year'].max() + 1],
                         title=f"Evolution of {title_feature}",
                         labels={'y': title_feature, 'size': 'Count'},
                         color_discrete_sequence=color_scheme)
        fig.update_traces(marker=dict(sizemin=3, line_width=1, line_color='black'))

    else:
        fig = px.line(agg_df, x='year', y='Count', color=feature_col_for_plot, markers=True,
                      title=f"Default Trend for {title_feature}", color_discrete_sequence=color_scheme)
        fig.update_layout(legend_title_text=title_feature)

    # General layout updates
    if 'year' in agg_df.columns and agg_df['year'].nunique() < 25:
        fig.update_xaxes(dtick=1)

    return agg_df, fig



import pandas as pd
import plotly.graph_objects as go
#
#
# def analyze_temporal_analysis(
#         df: pd.DataFrame,
#         params: dict,
#         progress_callback=lambda m: None
# ) -> Tuple[pd.DataFrame, go.Figure]:
#     """
#     A robust, single-function implementation for all temporal and comparative analyses.
#     It internally routes to the correct logic path based on the chosen chart type.
#     """
#
#
#     chart_type = params.get("plot_type")
#     if not chart_type:  # This catches both None and empty strings
#         chart_type = "multi_line_trend"  # Default to a standard plot
#     # ===============================================
#     color_scheme = px.colors.qualitative.Plotly
#
#     _cb = progress_callback or (lambda *_: None)
#
#     _cb(f"Temporal Analysis: Received request for '{chart_type}'.")
#     # =================================================================
#     # === PATH 1: COMPARATIVE CROSSTAB ANALYSIS ===
#     # =================================================================
#     if chart_type == "crosstab_heatmap":
#         feature1 = params.get("feature1")
#         feature2 = params.get("feature2")
#
#         _cb(f"Running Crosstab analysis for '{feature1}' vs '{feature2}'...")
#
#         if not all([feature1, feature2]) or feature1 not in df.columns or feature2 not in df.columns:
#             return pd.DataFrame(), go.Figure().add_annotation(text="Invalid features selected for comparison.")
#
#         df_c = df[[feature1, feature2]].copy().dropna()
#         for col in [feature1, feature2]:
#             if df_c[col].dtype == 'object' and df_c[col].dropna().apply(isinstance, args=(list,)).any():
#                 df_c = df_c.explode(col)
#         df_c.dropna(inplace=True)
#
#         if df_c.empty:
#             return pd.DataFrame(), go.Figure().add_annotation(text="No overlapping data for selected features.")
#
#         crosstab_df = pd.crosstab(df_c[feature1], df_c[feature2])
#
#         fig = px.imshow(
#             crosstab_df, text_auto=True, aspect="auto",
#             labels=dict(x=feature2.replace("_", " ").title(), y=feature1.replace("_", " ").title(), color="Count"),
#             title=f"Comparison: {feature1.replace('_', ' ').title()} vs. {feature2.replace('_', ' ').title()}"
#         )
#         fig.update_xaxes(side="top")
#
#         # This path finishes and returns here.
#         return crosstab_df.reset_index(), fig
#
#     # =================================================================
#     # === PATH 2: ALL TREND-OVER-TIME ANALYSES ===
#     # =================================================================
#
#     # --- Data Preparation for Trends ---
#     feature_col = params.get("feature", "publications")
#     top_n = params.get("top_n", 10)
#     year_from = params.get("year_from")
#     year_to = params.get("year_to")
#
#     _cb(f"Preparing trend data for '{feature_col}'...")
#
#     if 'year' not in df.columns:
#         return pd.DataFrame(), go.Figure().add_annotation(text="Error: 'year' column not found.")
#
#     d = df.copy()
#     d['year'] = pd.to_numeric(d['year'], errors='coerce')
#     d.dropna(subset=['year'], inplace=True)
#     d['year'] = d['year'].astype(int)
#
#     if year_from: d = d[d['year'] >= year_from]
#     if year_to: d = d[d['year'] <= year_to]
#
#     if d.empty: return pd.DataFrame(), go.Figure().add_annotation(text="No data in selected year range.")
#
#     # --- Data Aggregation for Trends ---
#     agg_df = pd.DataFrame()
#     feature_col_for_plot = feature_col if feature_col != "publications" else 'feature'
#     if feature_col == "publications":
#         agg_df = d.groupby('year').size().reset_index(name='Count')
#         agg_df[feature_col_for_plot] = 'Publications'
#     else:
#         if feature_col not in d.columns:
#             return pd.DataFrame(), go.Figure().add_annotation(text=f"Error: Feature '{feature_col}' not found.")
#         if d[feature_col].dtype == 'object' and d[feature_col].dropna().apply(isinstance, args=(list,)).any():
#             d = d.explode(feature_col)
#         d.dropna(subset=[feature_col], inplace=True)
#         if d.empty: return pd.DataFrame(), go.Figure().add_annotation(text=f"No data for '{feature_col}'.")
#         top_categories = d[feature_col].value_counts().nlargest(top_n).index
#         d_filtered = d[d[feature_col].isin(top_categories)]
#         agg_df = d_filtered.groupby(['year', feature_col_for_plot]).size().reset_index(name='Count')
#
#     if agg_df.empty:
#         return pd.DataFrame(), go.Figure().add_annotation(text=f"No data to plot for '{feature_col}'.")
#
#     agg_df.sort_values('year', inplace=True)
#
#     # --- Plotting Dispatcher for Trends ---
#     _cb(f"Creating '{chart_type}' chart for '{feature_col}'...")
#     title_feature = feature_col.replace('_', ' ').title()
#     title_chart = chart_type.replace('_', ' ').title()
#     full_title = f"{title_feature} Trend: {title_chart}"
#
#     if chart_type == "multi_line_trend":
#         fig = px.line(agg_df, x='year', y='Count', color=feature_col_for_plot, markers=True,
#                       title=full_title, color_discrete_sequence=color_scheme)
#         fig.update_layout(legend_title_text=title_feature)
#
#     elif chart_type == "bar":
#         fig = px.bar(agg_df, x='year', y='Count', color=feature_col_for_plot,
#                      title=full_title, barmode='stack', color_discrete_sequence=color_scheme)
#         fig.update_layout(legend_title_text=title_feature)
#
#     elif chart_type == "area":
#         fig = px.area(agg_df, x='year', y='Count', color=feature_col_for_plot,
#                       title=full_title, color_discrete_sequence=color_scheme)
#         fig.update_layout(legend_title_text=title_feature)
#
#     elif chart_type == "cumulative_area":
#         agg_df['Cumulative Count'] = agg_df.groupby(feature_col_for_plot)['Count'].cumsum()
#         fig = px.area(agg_df, x='year', y='Cumulative Count', color=feature_col_for_plot,
#                       title=f"Cumulative Growth of {title_feature}", color_discrete_sequence=color_scheme)
#         fig.update_layout(legend_title_text=title_feature, yaxis_title="Cumulative Count")
#
#     elif chart_type == "bubble":
#         bubble_df = agg_df.groupby(feature_col_for_plot)['Count'].sum().reset_index()
#         fig = px.scatter(bubble_df, x=feature_col_for_plot, y='Count', size='Count', color=feature_col_for_plot,
#                          title=f"Overall Contribution of Top {params.get('top_n')} {title_feature}",
#                          hover_name=feature_col_for_plot, color_discrete_sequence=color_scheme)
#         fig.update_traces(marker=dict(sizemin=5, line_width=1, line_color='black'))
#         fig.update_layout(xaxis_title=title_feature, yaxis_title="Total Count")
#
#     elif chart_type == "heat":
#         pivot_df = agg_df.pivot_table(index=feature_col_for_plot, columns='year', values='Count', fill_value=0)
#         fig = px.imshow(pivot_df, text_auto=".0f", aspect='auto',
#                         title=f"Activity Heatmap: {title_feature} Over Time",
#                         color_continuous_scale="YlGnBu")  # A nice blue-green-yellow scale
#         fig.update_layout(xaxis_title="Year", yaxis_title=title_feature)
#         return pivot_df.reset_index(), fig  # Heatmap is special, returns its pivoted data
#
#     elif chart_type == "animated_bar":
#         # Ensure every category has an entry for every year for a smooth race
#         anim_df = agg_df.pivot_table(index='year', columns=feature_col_for_plot, values='Count').fillna(
#             0).stack().reset_index(name='Count')
#         anim_df.sort_values(['year', 'Count'], ascending=[True, False], inplace=True)
#
#         fig = px.bar(anim_df, x=feature_col_for_plot, y='Count', color=feature_col_for_plot,
#                      animation_frame='year', animation_group=feature_col_for_plot,
#                      range_y=[0, agg_df['Count'].max() * 1.15],
#                      title=f"Animated Ranking: {title_feature}",
#                      labels={'y': 'Count', feature_col_for_plot: title_feature},
#                      color_discrete_sequence=color_scheme)
#         # Improve animation smoothness
#         fig.layout.updatemenus[0].buttons[0].args[1]['frame']['duration'] = 200
#         fig.layout.updatemenus[0].buttons[0].args[1]['transition']['duration'] = 50
#
#     elif chart_type == "animated_scatter":
#         # Create a full grid for a clean appearance/disappearance effect
#         all_years = sorted(agg_df['year'].unique())
#         all_cats = agg_df[feature_col_for_plot].unique()
#         template_df = pd.MultiIndex.from_product([all_years, all_cats], names=['year', feature_col_for_plot]).to_frame(
#             index=False)
#         anim_df = pd.merge(template_df, agg_df, on=['year', feature_col_for_plot], how='left').fillna(0)
#
#         fig = px.scatter(anim_df, x='year', y=feature_col_for_plot, size='Count', color=feature_col_for_plot,
#                          animation_frame='year', animation_group=feature_col_for_plot,
#                          range_x=[d['year'].min() - 1, d['year'].max() + 1],
#                          title=f"Evolution of {title_feature}",
#                          labels={'y': title_feature, 'size': 'Count'},
#                          color_discrete_sequence=color_scheme)
#         fig.update_traces(marker=dict(sizemin=3, line_width=1, line_color='black'))
#
#     elif chart_type == "animated_line_race":
#         # This is the fully sophisticated implementation
#         fig = go.Figure()
#
#         # Get unique categories and assign colors
#         categories = agg_df[feature_col_for_plot].unique()
#         colors = color_scheme * (len(categories) // len(color_scheme) + 1)
#
#         # Add one trace for each category, initially empty
#         for i, category in enumerate(categories):
#             fig.add_trace(go.Scatter(x=[], y=[], name=category, mode='lines', line=dict(color=colors[i], width=2)))
#
#         # Define the animation frames
#         frames = []
#         for year in sorted(agg_df['year'].unique()):
#             frame_data = []
#             for i, category in enumerate(categories):
#                 # Get data for this category up to the current year
#                 trace_df = agg_df[(agg_df[feature_col_for_plot] == category) & (agg_df['year'] <= year)]
#                 frame_data.append(go.Scatter(x=trace_df['year'], y=trace_df['Count']))
#
#             frames.append(go.Frame(data=frame_data, name=str(year)))
#
#         fig.frames = frames
#
#         # Define the animation settings and slider
#         def frame_args(duration):
#             return {"frame": {"duration": duration, "redraw": True},
#                     "transition": {"duration": 0, "easing": "linear"}}
#
#         sliders = [{"pad": {"b": 10, "t": 60}, "len": 0.9, "x": 0.1, "y": 0,
#                     "steps": [
#                         {"args": [[f.name], frame_args(0)],
#                          "label": f.name, "method": "animate"}
#                         for f in fig.frames
#                     ]}]
#
#         fig.update_layout(
#             title=f"Animated Trend Race: {title_feature}",
#             xaxis=dict(range=[agg_df['year'].min(), agg_df['year'].max()], autorange=False, title="Year"),
#             yaxis=dict(range=[0, agg_df['Count'].max() * 1.1], autorange=False, title="Count"),
#             updatemenus=[{
#                 "buttons": [
#                     {"args": [None, frame_args(200)], "label": "Play", "method": "animate"},
#                     {"args": [[None], frame_args(0)], "label": "Pause", "method": "animate"}
#                 ],
#                 "direction": "left", "pad": {"r": 10, "t": 70}, "type": "buttons", "x": 0.1, "y": 0
#             }],
#             sliders=sliders,
#             legend_title_text=title_feature,
#             colorway=colors
#         )
#     else:  # Fallback for any unknown trend type
#         fig = px.line(agg_df, x='year', y='Count', color=feature_col_for_plot, markers=True,
#                       title=f"Default Trend for {title_feature}")
#
#     # Final common layout updates and return
#     if 'year' in agg_df.columns and agg_df['year'].nunique() < 25:
#         fig.update_xaxes(dtick=1)
#
#     return agg_df, fig
RESEARCH_START =("")


# ==============================================================================
# == NEW RESEARCH DESIGN ANALYSIS SUITE
# ==============================================================================





def _plot_topic_phrase_network(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, go.Figure]:
    """Creates a co-occurrence network of topic phrases."""
    col = 'controlled_vocabulary_terms'
    if col not in df.columns:
        return pd.DataFrame(), go.Figure().add_annotation(text=f"Missing '{col}' column.", showarrow=False)

    df_analysis = df.dropna(subset=[col])
    # Handle both strings and lists
    if not df_analysis.empty and isinstance(df_analysis[col].iloc[0], str):
        df_analysis[col] = df_analysis[col].str.split(';')

    edge_list = defaultdict(int)
    for phrases in df_analysis[col]:
        if not isinstance(phrases, list): continue
        phrases = sorted(list(set(p.strip() for p in phrases if p.strip())))
        if len(phrases) >= 2:
            for p1, p2 in itertools.combinations(phrases, 2):
                edge_list[(p1, p2)] += 1

    if not edge_list:
        return pd.DataFrame(), go.Figure().add_annotation(text="No co-occurring topic phrases found.", showarrow=False)

    edges_df = pd.DataFrame([{'Source': k[0], 'Target': k[1], 'Weight': v} for k, v in edge_list.items()])
    G = nx.from_pandas_edgelist(edges_df, 'Source', 'Target', edge_attr='Weight')
    pos = nx.spring_layout(G, k=1.5 / np.sqrt(G.number_of_nodes()) if G.number_of_nodes() > 0 else 1, iterations=50,
                           seed=42)

    edge_x, edge_y = [], [];
    [edge_x.extend([pos[e[0]][0], pos[e[1]][0], None]) or edge_y.extend([pos[e[0]][1], pos[e[1]][1], None]) for e in
     G.edges()]
    node_x, node_y, node_text = [], [], [];
    [node_x.append(pos[n][0]) or node_y.append(pos[n][1]) or node_text.append(f'{n}<br>Degree: {G.degree[n]}') for n in
     G.nodes()]
    edge_trace = go.Scatter(x=edge_x, y=edge_y, line=dict(width=0.5, color='#888'), hoverinfo='none', mode='lines')
    node_trace = go.Scatter(x=node_x, y=node_y, mode='markers', hoverinfo='text', text=[n for n in G.nodes()],
                            textposition="top center",
                            marker=dict(size=10, color=list(range(len(G.nodes()))), colorscale='Viridis'))
    fig = go.Figure(data=[edge_trace, node_trace],
                    layout=go.Layout(title='Topic Phrase Co-occurrence Network', showlegend=False,
                                     xaxis=dict(visible=False), yaxis=dict(visible=False)))
    return edges_df, fig


def _plot_concept_evolution(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, go.Figure]:
    """Plots the evolution of a chosen concept over the years."""
    concept_col = params.get("concept_to_track", "methodology")
    if concept_col not in df.columns or 'year' not in df.columns:
        return pd.DataFrame(), go.Figure().add_annotation(text=f"Missing '{concept_col}' or 'year' column.",
                                                          showarrow=False)

    df_analysis = df.dropna(subset=['year', concept_col]).copy()
    df_analysis['year'] = pd.to_numeric(df_analysis['year'], errors='coerce').dropna().astype(int)

    if df_analysis.empty:
        return pd.DataFrame(), go.Figure().add_annotation(text=f"No valid data for {concept_col} evolution.",
                                                          showarrow=False)

    if isinstance(df_analysis[concept_col].iloc[0], list):
        df_analysis = df_analysis.explode(concept_col)

    df_analysis = df_analysis[df_analysis[concept_col].astype(str).str.strip() != '']

    counts_df = df_analysis.groupby(['year', concept_col]).size().reset_index(name='Count')

    fig = px.line(counts_df, x='year', y='Count', color=concept_col, markers=True,
                  title=f"Evolution of {concept_col.replace('_', ' ').title()} Over Time")
    return counts_df, fig


# =============================================================================
#  NEW RESEARCH-DESIGN ANALYSIS SUITE  (drop-in replacement)
# =============================================================================
import itertools, numpy as np, pandas as pd, networkx as nx
from collections import defaultdict
import plotly.express as px, plotly.graph_objects as go
from typing import Tuple, List

# ───────────────────────────── helper plots ──────────────────────────────
def _heatmap_crosstab(df: pd.DataFrame, p: dict) -> Tuple[pd.DataFrame, go.Figure]:
    x, y = p.get("dimension1"), p.get("dimension2")
    if x not in df.columns or y not in df.columns:
        return pd.DataFrame(), go.Figure().add_annotation(text=f"Missing {x} or {y}", showarrow=False)
    ctab = pd.crosstab(df[y].dropna(), df[x].dropna())
    fig = px.imshow(ctab, text_auto=True, aspect="auto",
                    title=f"{y.replace('_',' ').title()} × {x.replace('_',' ').title()}",
                    labels={"x":x,"y":y,"color":"Count"})
    return ctab.reset_index(), fig

def _sunburst_keywords(df: pd.DataFrame, p: dict) -> Tuple[pd.DataFrame, go.Figure]:
    path = p.get("path", ["methodology","contribution_type"])
    if "controlled_vocabulary_terms" not in df.columns or not all(c in df.columns for c in path):
        txt="Missing columns for sunburst"; return pd.DataFrame(), go.Figure().add_annotation(text=txt, showarrow=False)
    df2 = df.dropna(subset=path+["controlled_vocabulary_terms"]).copy()
    df2["controlled_vocabulary_terms"] = df2["controlled_vocabulary_terms"].astype(str).str.split(';')
    df2 = df2.explode("controlled_vocabulary_terms").assign(keywords=lambda d:d["controlled_vocabulary_terms"].str.strip())
    df2 = df2[df2["controlled_vocabulary_terms"]!=""]
    fig = px.sunburst(df2, path=path+["controlled_vocabulary_terms"], title="Hierarchy + Keywords")
    tbl = df2[path+["controlled_vocabulary_terms"]].value_counts().reset_index(name="count")
    return tbl, fig

def _funnel_argument_logic(df: pd.DataFrame, _:dict) -> Tuple[pd.DataFrame, go.Figure]:
    col="argumentation_logic"
    cnt=df[col].dropna().value_counts()
    if cnt.empty: return pd.DataFrame(), go.Figure().add_annotation(text="No data", showarrow=False)
    fdf = cnt.reset_index().rename(columns={"index": col, 0: "count"})
    fig = px.funnel(fdf, x="count", y=col,
                    title="Argumentation Logic Distribution",
                    labels={"count": "Count"})
    return fdf, fig

def _network_controlled_vocabulary_terms(df: pd.DataFrame, _:dict) -> Tuple[pd.DataFrame, go.Figure]:
    kw="controlled_vocabulary_terms"
    if kw not in df.columns: return pd.DataFrame(),go.Figure().add_annotation(text="No controlled_vocabulary_terms",showarrow=False)
    edges=defaultdict(int)
    for lst in df[kw].dropna().astype(str).str.split(';'):
        toks=sorted({t.strip() for t in lst if t.strip()})
        for a,b in itertools.combinations(toks,2): edges[(a,b)]+=1
    if not edges:
        return pd.DataFrame(), go.Figure().add_annotation(text="No co-occurring phrases", showarrow=False)
    edf=pd.DataFrame([{'src':a,'dst':b,'w':w} for (a,b),w in edges.items()])
    G=nx.from_pandas_edgelist(edf,'src','dst','w'); pos=nx.spring_layout(G,seed=42)
    ex,ey=[],[]; [ex.extend([pos[u][0],pos[v][0],None]) or ey.extend([pos[u][1],pos[v][1],None]) for u,v in G.edges()]
    edge_trace=go.Scatter(x=ex,y=ey,mode='lines',line=dict(width=0.5,color='#888'),hoverinfo='none')
    nx_x,nx_y=[],[]
    for n in G.nodes(): nx_x.append(pos[n][0]); nx_y.append(pos[n][1])
    node_trace=go.Scatter(x=nx_x,y=nx_y,mode='markers+text',text=list(G.nodes()),
                          marker=dict(size=10,color='cornflowerblue'))
    fig=go.Figure([edge_trace,node_trace]); fig.update_layout(title="Topic-Phrase Network",
        xaxis=dict(visible=False),yaxis=dict(visible=False))
    return edf, fig




def analyze_conceptual_framing(df: pd.DataFrame,
                               params: dict,
                               progress_callback=None) -> tuple[pd.DataFrame, go.Figure]:
    """
    Simple word-cloud-like bar chart for Topic Phrases frequency.
    Required col: 'controlled_vocabulary_terms'  (semicolon-separated string or list)
    """
    if 'controlled_vocabulary_terms' not in df.columns:
        return pd.DataFrame(), go.Figure().add_annotation(text="No 'controlled_vocabulary_terms' column", showarrow=False)

    phrases = []
    for cell in df['controlled_vocabulary_terms'].dropna():
        if isinstance(cell, list):
            phrases.extend(cell)
        else:
            phrases.extend([p.strip() for p in str(cell).split(';') if p.strip()])

    counts = Counter(phrases)
    top_n = params.get('top_n_phrases', 25)
    top_df = (pd.DataFrame(counts.items(), columns=['phrase', 'count'])
                .sort_values('count', ascending=False)
                .head(top_n))

    fig = px.bar(top_df,
                 x='phrase',
                 y='count',
                 title=f'Top {top_n} Topic Phrases',
                 text_auto=True)
    fig.update_layout(xaxis_tickangle=-45, template='plotly_white')
    fig.update_traces(textposition='outside')
    return top_df, fig
def analyze_funding(df: pd.DataFrame,
                    params: dict,
                    progress_callback=None) -> tuple[pd.DataFrame, go.Figure]:
    """
    Pie chart of funding agencies.
    Column: 'funding' – string with ';'-separated funder names or list
    """
    if 'funding' not in df.columns:
        return pd.DataFrame(), go.Figure().add_annotation(text="No 'funding' column", showarrow=False)

    names = []
    for cell in df['funding'].dropna():
        if isinstance(cell, list):
            names.extend(cell)
        else:
            names.extend([n.strip() for n in str(cell).split(';') if n.strip()])

    counts = Counter(names)
    fund_df = (pd.DataFrame(counts.items(), columns=['funder', 'count'])
                 .sort_values('count', ascending=False))

    fig = px.pie(fund_df,
                 names='funder',
                 values='count',
                 title='Funding Sources',
                 hole=.35)   # donut style
    fig.update_traces(textposition='inside', textinfo='percent+label')
    return fund_df, fig


def find_missing_coding_keys(df, key_col: str = "key", core_columns: list | None = None) -> dict:
    """
    Return {coding_column: [item_keys_missing_it, ...], ...}.
    Treat both NaN and empty "" as missing.
    Coding columns are inferred dynamically as df.columns - CORE_COLUMNS.
    """

    if df is None or df.empty:
        return {}

    # Use the module-level CORE_COLUMNS if not provided
    core_cols = list(core_columns) if core_columns else list(CORE_COLUMNS) if "CORE_COLUMNS" in globals() else []

    # Anything not in CORE columns is considered a candidate coding column
    candidate_code_cols = [c for c in df.columns if c not in set(core_cols)]

    # Build missing map
    missing_map: dict[str, list[str]] = {}
    for col in candidate_code_cols:
        # Safeguard: skip the key column itself if present in candidates
        if col == key_col:
            continue
        series = df[col]
        # Consider NaN OR empty string as missing
        is_missing = series.isna() | (series.astype(str).str.strip() == "")
        if bool(is_missing.any()):
            keys = df.loc[is_missing, key_col].astype(str).tolist()
            # Only record if we actually have missing *and* this looks like a coding column (mostly text)
            if keys:
                missing_map[col] = keys
    return missing_map


def print_missing_coding_keys(df, key_col: str = "key", core_columns: list | None = None) -> dict:
    """
    Convenience wrapper that prints a readable report and returns the dict.
    """
    miss = find_missing_coding_keys(df, key_col=key_col, core_columns=core_columns)
    if not miss:
        print("No missing coding values found.")
        return miss

    print("Missing coding values by column:")
    for col, keys in sorted(miss.items(), key=lambda kv: (-len(kv[1]), kv[0].lower())):
        print(f"  {col}: {len(keys)} items → {', '.join(keys)}")
    return miss


_LATEX_TOKEN = re.compile(
    r"\$\s*\{\s*\}\s*\^\{\s*\d{1,4}\s*\}\s*\$|\^\{\s*\d{1,4}\s*\}",
    re.UNICODE
)

_HEADING_LINE_RE = re.compile(r"^\s*#{1,6}\s+.*$", re.M)

HEADING_RE = re.compile(r"^\s*(#{1,6})\s+(.*)$")

def _md_to_html_basic(md: str) -> str:
    """
    Minimal Markdown-ish to HTML:
      - # / ## / ... ###### headings -> <hN>
      - blank-line separated paragraphs -> <p>
      - passes through allowed block HTML (incl. our <span> inserts)
    """
    lines = md.splitlines()
    html_lines, buf = [], []

    def flush():
        nonlocal buf
        if not buf:
            return
        txt = " ".join(buf).strip()
        if txt:
            txt = _clean_angle_bracket_urls(txt)
            html_lines.append(f"<p>{txt}</p>")
        buf = []

    for ln in lines:
        m = HEADING_RE.match(ln)
        if m:
            flush()
            lvl = len(m.group(1))
            content = m.group(2).strip()
            html_lines.append(f"<h{lvl}>{_html.escape(content)}</h{lvl}>")
            continue

        if not ln.strip():
            flush()
            continue

        raw = ln.lstrip()
        if raw.startswith("<") and ALLOWED_BLOCK_TAG.match(raw):
            flush()
            html_lines.append(ln)
            continue

        buf.append(ln.strip())

    flush()
    return "\n".join(html_lines)

def _sanitize_title(tip: str | None) -> str:
    if not tip:
        return ""
    # strip angle-bracketed URLs inside title, then escape
    tip = _clean_angle_bracket_urls(tip.strip())
    tip = re.sub(r"\s{2,}", " ", tip)
    return _html.escape(tip, quote=True)

def _mk_span(idx: str, tip: str | None) -> str:
    sidx = str(idx).lstrip("0") or "0"
    title_attr = _sanitize_title(tip)
    title_attr = f' title="{title_attr}"' if title_attr else ""
    return f'<span class="bib-cite" data-index="{sidx}"><sup><a href="#fn-{sidx}"{title_attr}>{sidx}</a></sup></span>'

def _is_in_heading(md_text: str, pos: int) -> bool:
    """
    Return True if `pos` is on a line that is a Markdown ATX heading.
    """
    line_start = md_text.rfind("\n", 0, pos) + 1
    line_end = md_text.find("\n", pos)
    if line_end == -1:
        line_end = len(md_text)
    line = md_text[line_start:line_end]
    return bool(re.match(r"^\s*#{1,6}\s+", line))

def _refine_preceding_literal(raw: str) -> str:
    """
    Make `preceding_text` align with the *flat* text:
      - drop LaTeX tokens and [^n] marks
      - collapse whitespace (but respect paragraph breaks)
      - prefer the LAST paragraph segment
      - trim quotes
      - cap to a reasonable tail so it stays close to the citation
    """
    s = raw or ""

    # Strip in-text tokens and footnote markers the flat text doesn't have
    s = _LATEX_TOKEN.sub(" ", s)
    s = re.sub(r"\[\^\d+\]\s*:?", " ", s)

    # Normalize whitespace while preserving paragraph breaks
    s = s.replace("\u00A0", " ")
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\r\n?", "\n", s).strip()

    # Prefer the last paragraph segment (after the last blank line)
    parts = re.split(r"\n\s*\n", s)
    seg = parts[-1] if parts else s

    seg = seg.strip(" '\"“”‘’\t\r\n")

    # Keep the *end* close to the citation; avoid runaways
    MAX = 240
    if len(seg) > MAX:
        seg = seg[-MAX:]
        # avoid starting mid-word
        seg = re.sub(r"^\S+\s", "", seg, count=1).strip()

    return seg

def _literal_to_fullmatch_regex(literal: str) -> re.Pattern | None:
    """
    Build a regex that matches `literal` exactly, but with flexible whitespace.
    Returns a compiled pattern whose group(1) is the whole literal.
    """
    lit = _refine_preceding_literal(literal)
    if not lit:
        return None

    # Split by whitespace, escape each token (incl. punctuation),
    # then join back with \s+ to allow newlines/spaces in the flat text.
    tokens = [t for t in re.split(r"\s+", lit) if t]
    if not tokens:
        return None

    pat = r"(" + r"\s+".join(re.escape(t) for t in tokens) + r")"
    try:
        return re.compile(pat, flags=re.UNICODE)
    except re.error:
        return None


def _entries(link_out: dict) -> list[dict]:
    out = []
    if not isinstance(link_out, dict):
        return out
    for key in ("tex", "footnotes", "results"):
        v = link_out.get(key)
        if isinstance(v, dict):
            out.extend(v.get("results", []) or [])
        elif isinstance(v, list):
            out.extend(v)
    return out

def _strip_intext_noise(s: str) -> str:
    # remove LaTeX-ish tokens and normalize whitespace/quotes padding
    s = _LATEX_TOKEN.sub(" ", s or "")
    s = re.sub(r"\s+", " ", s)
    return s.strip(" \"'“”‘’ \t\r\n")

def _escape_piece_with_quote_dash_classes(piece: str) -> str:
    """
    Build a regex-safe piece from literal, but allow straight/curly quotes and hyphen/en-dash/em-dash
    to match interchangeably.
    """
    out = []
    for ch in piece:
        if ch in ("'", "’", "‘"):
            out.append(r"['’‘]")
        elif ch in ('"', "“", "”"):
            out.append(r'["“”]')
        elif ch in ("-", "–", "—"):
            out.append(r"[-–—]")
        elif ch.isspace():
            out.append(r"\s+")
        else:
            out.append(re.escape(ch))
    return "".join(out)


def convert_citations_to_html(md_text: str, link_out: dict) -> str:
    """
    Insert <span class="bib-cite">…</span> ONLY when `preceding_text` is non-empty:
      - refine the ENTIRE `preceding_text` to match flat text semantics
      - find the last occurrence of that literal in the markdown/flat text
      - append the span right after that occurrence (skip if inside a heading)
    Then convert the resulting text to HTML.
    """
    # collect optional tooltips
    note_map: dict[str, str] = {}

    def _harvest(results):
        for r in results or []:
            idx = str(r.get("index", "")).strip()
            tip = (r.get("footnote") or "").strip()
            if idx and tip and idx not in note_map:
                note_map[idx] = tip

    if isinstance(link_out, dict):
        for key in ("tex", "footnotes"):
            part = link_out.get(key) or {}
            _harvest(part.get("results"))
        _harvest(link_out.get("results"))

    text = md_text
    edits: list[tuple[int, int, str]] = []

    for e in _entries(link_out or {}):
        idx = str(e.get("index", "")).strip()
        pre = str(e.get("preceding_text") or "")
        if not idx or not pre.strip():
            # STRICT: skip if no preceding_text
            continue

        pat = _literal_to_fullmatch_regex(pre)
        if not pat:
            continue

        matches = list(pat.finditer(text))
        if not matches:
            # no full match — do nothing (no fallback)
            continue

        m = matches[-1]
        s, epos = m.start(1), m.end(1)

        # Don’t place citation inside headings
        if _is_in_heading(text, epos):
            continue

        span = _mk_span(idx, note_map.get(idx))
        replacement = text[s:epos] + span
        edits.append((s, epos, replacement))

    # Sort and drop only *true* overlaps (to preserve close/adjacent citations).
    # Overlaps typically mean a bad preceding_text that swallowed the next anchor.
    edits.sort(key=lambda t: (t[0], t[1]))
    filtered: list[tuple[int, int, str]] = []
    last_end = -1
    for s, epos, rep in edits:
        if s >= last_end:
            filtered.append((s, epos, rep))
            last_end = epos
        else:
            # If we overlapped, skip this one (the fix is to correct/refine preceding_text).
            # With the refined literal, this should rarely happen.
            continue

    # Apply right-to-left so indices remain valid
    out_md = text
    for s, epos, rep in reversed(filtered):
        out_md = out_md[:s] + rep + out_md[epos:]

    # Convert to HTML
    return _md_to_html_basic(out_md)

























import re



# ----------------------------- parsing helpers -----------------------------

_TAG_SPLIT_RE = re.compile(r"[;|,\n]+")

def _is_nan(x) -> bool:
    try:
        import pandas as _pd
        return _pd.isna(x)
    except Exception:
        return x is None

def _canon_term(s: str) -> str:
    """Normalise a theme string, stripping the '#theme:' prefix and tidying spaces."""
    s = str(s or "").strip()
    if not s:
        return ""
    # strip "#theme:" (lenient)
    s = re.sub(r"^\s*#?\s*theme\s*:\s*", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def _prefixed_theme(s: str) -> str:
    """Return canonical '#theme:<term>' form."""
    s = _canon_term(s)
    return f"#theme:{s}" if s else ""


def _extract_theme_list(cell, separators: str = r"[;|,\n]+") -> List[str]:
    """Extract a clean list of '#theme:...' tokens from a cell (str | list)."""
    if _is_nan(cell):
        return []
    parts: List[str] = []
    if isinstance(cell, list):
        for v in cell:
            if _is_nan(v):
                continue
            parts.extend(re.split(separators, str(v)))
    else:
        parts = re.split(separators, str(cell))

    out: List[str] = []
    for raw in parts:
        raw = str(raw or "").strip()
        if not raw:
            continue
        if re.match(r"^\s*#?\s*theme\s*:", raw, flags=re.I):
            t = _prefixed_theme(raw)
            if t:
                out.append(t)
    return out


def _render_prompt_with_vars(template: str, vars: Dict[str, Any]) -> str:
    """
    Danger-free templating: only replaces exact tokens like {batch_index},
    {merge_hints_json}, {items_json}. It ignores all other braces so the
    JSON Schema inside the prompt remains intact.

    NOTE: Callers must pre-json.dumps any complex values (we already do).
    """
    if not template:
        return template
    out = template
    for k, v in (vars or {}).items():
        token = "{" + str(k) + "}"
        out = out.replace(token, str(v))
    return out
import json
from typing import Any, Dict, List, Tuple

def _compact_theme_blocks_for_prompt(
    batch_payloads: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], List[Tuple[str, str]], List[str], Dict[str, List[str]]]:
    """
    Input: pass-1 theme blocks: [{"title": str, "members": {canonical: [synonyms...]}}]
    Output:
      - compact_blocks: [{"title": str, "members": [canonical, ...]}]   # NO empty [] anywhere
      - synonym_pairs:  [(synonym, canonical), ...]  # only where non-empty synonyms exist
      - all_titles:     [title, ...] (deduped, original order)
      - full_members_by_title: {title: [canonical, ...]}  # for local reattachment later
    """
    seen_titles: set = set()
    all_titles: List[str] = []
    compact_blocks: List[Dict[str, Any]] = []
    synonym_pairs: List[Tuple[str, str]] = []
    full_members_by_title: Dict[str, List[str]] = {}

    for block in batch_payloads or []:
        if not isinstance(block, dict):
            continue
        title = str(block.get("title") or "").strip()
        members = block.get("members") or {}
        if not title or not isinstance(members, dict) or not members:
            continue

        canonicals = sorted([str(k).strip() for k in members.keys() if str(k).strip()], key=str.lower)
        if not canonicals:
            continue

        # collect only non-empty synonyms
        for canon, syns in members.items():
            if not syns:
                continue
            for s in syns:
                s = str(s or "").strip()
                if s and s != canon:
                    synonym_pairs.append((s, str(canon)))

        # record outputs
        compact_blocks.append({"title": title, "members": canonicals})
        full_members_by_title[title] = canonicals

        if title not in seen_titles:
            seen_titles.add(title)
            all_titles.append(title)

    return compact_blocks, synonym_pairs, all_titles, full_members_by_title

def _prepare_theme_catalog(
    batch_payloads: List[Dict[str, Any]]
) -> Tuple[Dict[str, Dict[str, List[str]]], List[str], Dict[str, str]]:
    theme_catalog: Dict[str, Dict[str, List[str]]] = {}
    synonym_map: Dict[str, str] = {}
    theme_titles: List[str] = []

    for p in batch_payloads or []:
        for th in (p.get("themes") or []):
            title = (th.get("title") or "").strip()
            members = th.get("members") or {}
            if not title or not isinstance(members, dict):
                continue
            canonical_keys = sorted([str(k) for k in members.keys()], key=str.lower)
            if not canonical_keys:
                continue
            theme_catalog[title] = {"members": canonical_keys}
            theme_titles.append(title)
            for k, syns in members.items():
                for s in (syns or []):
                    s = str(s).strip()
                    if s and s != k:
                        synonym_map[s] = str(k)

    # stable de-dup
    seen = set()
    deduped = []
    for t in theme_titles:
        if t not in seen:
            seen.add(t)
            deduped.append(t)
    return theme_catalog, deduped, synonym_map


def _extract_json_object(text: str) -> dict:
    if text is None:
        raise RuntimeError("[regrouping_themes] Empty response (None).")
    s = str(text).strip().lstrip("\ufeff")
    if s.startswith("```"):
        s = s.strip("`").strip()
        if s.lower().startswith("json"):
            s = s[4:].strip()
    if not s:
        raise RuntimeError("[regrouping_themes] Empty response (after trimming).")
    try:
        return json.loads(s)
    except Exception:
        pass
    start = s.find("{"); end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = s[start:end+1]
        return json.loads(candidate)
    raise RuntimeError(f"[regrouping_themes] Response is not valid JSON. Head: {s[:200]!r}")

def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s)).strip().casefold()

def extract_keywords_from_regrouped(regrouped: Dict[str, Any]) -> OrderedDict:
    """
    Input: regrouped output like the one you posted.
    Output: OrderedDict({ "<theme title>": ["kw1","kw2",...], ... })
    - Uses subtheme.members *keys* only (drops [] arrays).
    - Preserves the overarching theme order as given.
    """
    themes = OrderedDict()
    for g in (regrouped.get("overarching") or []):
        g_title = g.get("title", "").strip()
        if not g_title:
            continue
        kws: List[str] = []
        for st in (g.get("subthemes") or []):
            members = st.get("members")
            if isinstance(members, dict):
                # members like {"mission board": [], ...}
                kws.extend([k for k in members.keys() if k and k.strip()])
            elif isinstance(members, list):
                # members like ["mission board", ...]
                kws.extend([m for m in members if m and str(m).strip()])
            # else: ignore
        # dedupe but keep stable order
        seen = set()
        uniq = []
        for k in kws:
            if k not in seen:
                seen.add(k)
                uniq.append(k)
        themes[g_title] = uniq
    return themes

def build_token_counts(
    df,
    *,
    theme_col: str = "controlled_vocabulary_terms",
    separators: str = r"[;|,\n]+",
    min_len: int = 2,
    synonym_map: Optional[Dict[str, str]] = None,
) -> Counter:
    """
    Re-count tokens in df[theme_col] exactly the way your ingest did:
    - split by separators, trim, drop < min_len, case-insensitive.
    - if synonym_map provided, map tokens -> canonical before counting.
    Returns Counter({canonical: count, ...})
    """
    if theme_col not in df.columns:
        raise KeyError(f"Column {theme_col!r} not found in DataFrame.")
    syn = { _norm(k): _norm(v) for k, v in (synonym_map or {}).items() }
    counter = Counter()
    splitter = re.compile(separators)
    for raw in df[theme_col].fillna(""):
        for tok in splitter.split(str(raw)):
            t = tok.strip()
            if len(t) < min_len:
                continue
            nt = _norm(t)
            nt = syn.get(nt, nt)  # fold to canonical if synonym_map is present
            counter[nt] += 1
    return counter

def flatteningthemes(
    regrouped: Dict[str, Any],
    df,
    *,
    theme_col: str = "controlled_vocabulary_terms",
    separators: str = r"[;|,\n]+",
    min_len: int = 2,
    synonym_map: Optional[Dict[str, str]] = None,
    top_n: Optional[int] = None,
) -> Tuple[OrderedDict, Dict[str, int]]:
    """
    Returns:
      flat_for_plot: OrderedDict({
        "theme 1 - <Title>": [{"keyword": "<exact>", "count": N}, ...sorted desc...],
        ...
      })
      totals_by_theme: { "theme 1 - <Title>": total_count, ... }
    Notes:
    - Counts are exact from df, case-insensitive, split by `separators`.
    - If a keyword never appears in df, its count is 0 (still included).
    - Set top_n to keep only the top-K keywords per theme.
    """
    # 1) Extract keywords per overarching theme
    by_theme = extract_keywords_from_regrouped(regrouped)

    # 2) Build corpus counts
    # Prefer regrouped's own synonym_map if present
    smap = synonym_map or regrouped.get("synonym_map") or {}
    token_counts = build_token_counts(
        df,
        theme_col=theme_col,
        separators=separators,
        min_len=min_len,
        synonym_map=smap,
    )

    # 3) Assemble flat dict for plotting
    flat = OrderedDict()
    totals = {}
    for idx, (title, kw_list) in enumerate(by_theme.items(), start=1):
        label = f"theme {idx} - {title}"
        rows = []
        total = 0
        for kw in kw_list:
            cnt = token_counts.get(_norm(kw), 0)
            rows.append({"keyword": kw, "count": int(cnt)})
            total += cnt
        rows.sort(key=lambda r: (-r["count"], r["keyword"]))
        if top_n is not None:
            rows = rows[:top_n]
        flat[label] = rows
        totals[label] = int(total)

    return flat, totals

def build_mindmap_plot(
    regrouped: Dict[str, Any],
    *,
    root_title: str = "Thematic Map",
    include_leftovers: bool = False,
    engine: str = "sunburst",  # "sunburst" or "treemap"
    min_node_value: int = 1,   # guard to keep empty branches visible
) -> Tuple[Dict[str, Any], go.Figure]:
    """
    Convert grouped thematic output into a mind-map–ready node list and a Plotly figure.

    INPUT SHAPE (example):
    {
      "overarching": [
        {
          "title": "Missions & mission innovation",
          "subthemes": [
            {"title": "Mission-oriented policies & missions", "members": {"mission board": []}},
            {"title": "Mission design", "members": {"mission implementation": []}},
            ...
          ]
        },
        ...
      ],
      "leftovers": [...],         # optional
      "synonym_map": {...}        # optional
    }

    RETURNS:
      (mindmap_data, fig)

      mindmap_data = {
        "root_id": "root",
        "nodes": [
          {"id": "...", "label": "Missions & mission innovation", "parent": "root",
           "value": 7, "note": "", "level": "Overarching", "path": ["Thematic Map", "..."]},
          {"id": "...", "label": "Mission design", "parent": "...", "value": 1,
           "note": "", "level": "Subtheme", "path": ["Thematic Map", "...", "Mission design"]},
          {"id": "...", "label": "mission implementation", "parent": "...", "value": 1,
           "note": "Synonyms: (none)", "level": "Keyword", "path": [...]},
          ...
        ]
      }

      fig = Plotly Figure (sunburst or treemap) with hover notes.
    """
    def _slug(s: str) -> str:
        s = s.strip().lower()
        s = re.sub(r"[^a-z0-9]+", "-", s)
        return re.sub(r"-{2,}", "-", s).strip("-") or "n"

    def _node(
        _id: str,
        label: str,
        parent: Optional[str],
        value: int,
        note: str,
        level: str,
        path: List[str]
    ) -> Dict[str, Any]:
        return {
            "id": _id,
            "label": label,
            "parent": parent,
            "value": max(int(value), min_node_value),
            "note": note,
            "level": level,
            "path": path
        }

    if not regrouped or "overarching" not in regrouped:
        raise ValueError("Expected dict with key 'overarching'.")

    labels: List[str] = []
    parents: List[str] = []
    values: List[int] = []
    ids: List[str] = []
    customdata: List[List[str]] = []  # [level, note] per node

    nodes: List[Dict[str, Any]] = []

    # ROOT
    root_id = "root"
    root_path = [root_title]
    # We'll compute the root value as sum of top-level values after building
    root_node = _node(root_id, root_title, "", 0, "", "Root", root_path)
    nodes.append(root_node)

    # Build hierarchy
    total_root_value = 0
    for og in regrouped.get("overarching", []):
        og_title = str(og.get("title", "")).strip()
        if not og_title:
            continue
        og_id = f"o:{_slug(og_title)}"
        og_path = [root_title, og_title]

        # Sum values from subthemes
        og_value = 0
        og_children = []

        for st in (og.get("subthemes") or []):
            st_title = str(st.get("title", "")).strip()
            if not st_title:
                continue
            st_id = f"s:{_slug(og_title)}:{_slug(st_title)}"
            st_path = [root_title, og_title, st_title]

            members_map = st.get("members") or {}
            # members_map can be {canonical: [synonyms...]}; ignore [] noise but keep canonical.
            # Each keyword gets value = 1 + len(synonyms) (≥ 1)
            keyword_value_total = 0
            st_children = []

            for canonical, syns in members_map.items():
                canonical = str(canonical).strip()
                if not canonical:
                    continue
                synonyms = list(syns) if isinstance(syns, (list, tuple)) else []
                note = (
                    "Synonyms: " + (", ".join(synonyms) if synonyms else "(none)")
                )

                kw_id = f"k:{_slug(og_title)}:{_slug(st_title)}:{_slug(canonical)}"
                kw_path = [root_title, og_title, st_title, canonical]
                kw_value = max(1, 1 + len(synonyms))

                st_children.append(
                    _node(kw_id, canonical, st_id, kw_value, note, "Keyword", kw_path)
                )
                keyword_value_total += kw_value

            # Add subtheme node (even if empty → min_node_value keeps it visible)
            st_value = keyword_value_total if keyword_value_total > 0 else min_node_value
            og_value += st_value
            og_children.append(
                _node(st_id, st_title, og_id, st_value, "", "Subtheme", st_path)
            )
            nodes.extend(st_children)

        # Overarching node
        og_value = og_value if og_value > 0 else min_node_value
        total_root_value += og_value
        nodes.append(_node(og_id, og_title, root_id, og_value, "", "Overarching", og_path))
        nodes.extend(og_children)

    # Optional: add leftovers as a sibling branch (disabled by default)
    if include_leftovers and regrouped.get("leftovers"):
        lo_title = "Leftovers"
        lo_id = f"o:{_slug(lo_title)}"
        lo_path = [root_title, lo_title]
        lo_items = [str(x).strip() for x in regrouped["leftovers"] if str(x).strip()]
        lo_value = max(len(lo_items), min_node_value)

        nodes.append(_node(lo_id, lo_title, root_id, lo_value, "", "Overarching", lo_path))
        total_root_value += lo_value

        for item in lo_items:
            kw_id = f"k:{_slug(lo_title)}:{_slug(item)}"
            kw_path = [root_title, lo_title, item]
            nodes.append(_node(kw_id, item, lo_id, 1, "(from leftovers)", "Keyword", kw_path))

    # Update root value now that we have totals
    nodes[0]["value"] = max(total_root_value, min_node_value)

    # Build Plotly vectors
    for n in nodes:
        labels.append(n["label"])
        parents.append(n["parent"] if n["parent"] is not None else "")
        values.append(n["value"])
        ids.append(n["id"])
        customdata.append([n["level"], n["note"]])

    # Choose engine
    if engine == "treemap":
        trace = go.Treemap(
            labels=labels,
            parents=parents,
            values=values,
            ids=ids,
            branchvalues="total",
            hovertemplate="<b>%{label}</b><br>%{customdata[0]} · Items: %{value}"
                          "<br>%{customdata[1]}<extra></extra>",
            customdata=customdata,
            root_color="lightgrey"
        )
    else:  # sunburst (default)
        trace = go.Sunburst(
            labels=labels,
            parents=parents,
            values=values,
            ids=ids,
            branchvalues="total",
            hovertemplate="<b>%{label}</b><br>%{customdata[0]} · Items: %{value}"
                          "<br>%{customdata[1]}<extra></extra>",
            customdata=customdata
        )

    fig = go.Figure(trace)
    fig.update_layout(
        title={'text': root_title, 'x': 0.5, 'xanchor': 'center'},
        margin=dict(t=40, l=10, r=10, b=10)
    )

    # Also return a clean node list for other mind-map libs
    mindmap_data = {
        "root_id": root_id,
        "nodes": nodes
    }
    return mindmap_data, fig
def regrouping_themes(
    batch_payloads: List[Dict[str, Any]],
    *,
    section_title: str,
    ai_provider_key: str = "openai",
    model_api_name: str = "gpt-5",
    analysis_key_suffix: str = "thematic_regroup_v1",   # prompts.json key for pass-2
    cons_model: Optional[str] = None,
    cons_max_t: int = 120000,
    merge_hints: Optional[List[Dict[str, str]]] = None,
    results_so_far: Optional[Dict[str, Any]] = None,
    use_cache: bool = True,
    effort: str = "medium",
) -> Dict[str, Any]:
    """
    Consolidate pass-1 *theme blocks* into a global hierarchy suitable for mind-mapping.

    Input (pass-1 normalized blocks):
      batch_payloads == [
        { "title": str, "members": { canonical_keyword: [synonyms...] } },
        ...
      ]

    Output (hierarchy with MEMBERS AS LISTS OF CANONICALS, no empty [] alongside keys):
      {
        "overarching": [
          {
            "title": "<overarching title from all_theme_titles>",
            "subthemes": [
              {
                "title": "<exact subtheme title from all_theme_titles>",
                "members": ["canonical1", "canonical2", ...]   # NO {key: []} shape
              },
              ...
            ]
          },
          ...
        ],
        "leftovers": [ "<unassigned subtheme title>", ... ],
        "merges": [ {"from": "...", "into": "...", "reason": "..."}, ... ],
        "synonym_map": { "<synonym>": "<canonical>", ... },
        "stats": {
          "n_input_titles": int,
          "n_overarching": int,
          "n_subthemes": int,
          "n_canonicals": int,
          "n_synonyms": int,
          "notes": str
        }
      }
    """
    merge_hints = merge_hints or []

    # ---------- Normalize & merge pass-1 blocks; build title lists and synonym map ----------
    theme_blocks: List[Dict[str, Any]] = []         # [{title, members{canon:[syns]}}]
    title_to_idx: Dict[str, int] = {}
    all_titles: List[str] = []
    synonym_map: Dict[str, str] = {}

    def _norm_members(members_in: Dict[str, Any]) -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {}
        if not isinstance(members_in, dict):
            return out
        for k_raw, syns_raw in members_in.items():
            k = str(k_raw or "").strip()
            if not k:
                continue
            syns_list = syns_raw if isinstance(syns_raw, list) else [syns_raw]
            syns_clean: List[str] = []
            for s in syns_list:
                s = str(s or "").strip()
                if s and s != k:
                    syns_clean.append(s)
            if syns_clean:
                syns_clean = sorted(set(syns_clean), key=str.lower)
            out[k] = syns_clean
        return out

    for th in batch_payloads or []:
        if not isinstance(th, dict):
            continue
        title = str(th.get("title") or "").strip()
        members_in = th.get("members") or {}
        if not title or not isinstance(members_in, dict) or not members_in:
            continue

        mem_norm = _norm_members(members_in)

        # Build global synonym map (synonym -> canonical)
        for canon, syns in mem_norm.items():
            for s in syns or []:
                synonym_map[str(s)] = str(canon)

        # Merge duplicate titles (accumulate canonicals + synonyms)
        if title in title_to_idx:
            idx = title_to_idx[title]
            cur = theme_blocks[idx]["members"]
            for canon, syns in mem_norm.items():
                if canon in cur:
                    cur[canon] = sorted(set((cur[canon] or []) + (syns or [])), key=str.lower)
                else:
                    cur[canon] = list(syns or [])
        else:
            title_to_idx[title] = len(theme_blocks)
            theme_blocks.append({"title": title, "members": mem_norm})
            all_titles.append(title)

    if not theme_blocks:
        raise RuntimeError("[regrouping_themes] No theme blocks available from pass-1.")

    # Map: title -> LIST of canonical keywords (for mind map members)
    members_list_by_title: Dict[str, List[str]] = {
        tb["title"]: sorted(list(tb["members"].keys()), key=str.lower) for tb in theme_blocks
    }

    # ---------- Prepare prompt variables expected by the regrouping prompt ----------
    # ---- Step 1b: compact for prompt to strip {}:[] noise ----
    compact_blocks, synonym_pairs, all_titles, members_list_by_title = _compact_theme_blocks_for_prompt(batch_payloads)

    template_vars = {
        "merge_hints_json": json.dumps(merge_hints or [], ensure_ascii=False),
        "all_titles_json": json.dumps(all_titles, ensure_ascii=False),
        # 👇 send the compact version: members are just canonicals (lists), no [] synonyms
        "theme_blocks_json": json.dumps(compact_blocks, ensure_ascii=False),
        # optional but useful for true near-duplicate merges:
        "synonym_pairs_json": json.dumps(synonym_pairs, ensure_ascii=False),
    }

    # Pull prompt and render tokens
    prompt_text, chosen_model, max_toks_cfg, _json_schema, effort_cfg = _get_prompt_details(
        prompt_key=analysis_key_suffix,
        ai_provider_key=ai_provider_key,
        default_model_override=None,
        template_vars=template_vars,   # for logs/traceability
        results_so_far=results_so_far,
        section_id=section_title,
    )

    try:
        # Prefer using the shared renderer if present
        prompt_text = _render_prompt_with_vars(prompt_text, template_vars)  # type: ignore
    except Exception:
        # Minimal local fallback renderer
        for k, v in template_vars.items():
            prompt_text = prompt_text.replace("{" + str(k) + "}", str(v))

    # Guard against silent token misses
    for token in ("{all_titles_json}", "{theme_blocks_json}", "{merge_hints_json}"):
        if token in prompt_text:
            raise RuntimeError(f"[regrouping_themes] Prompt rendering failed: {token} still present.")

    # ---------- Call model ----------
    model_to_use = cons_model or chosen_model or model_api_name
    max_tokens_to_use = min(int(cons_max_t), int(max_toks_cfg or cons_max_t))

    res = call_models(
        ai_provider_key=ai_provider_key,
        model_api_name="o3",
        prompt_text=prompt_text,
        analysis_key_suffix=analysis_key_suffix,
        max_tokens=120000,
        base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir") if results_so_far else None,
        use_cache=use_cache,
        store_only=False,
        read=False,
        section_title=section_title,
        custom_id=f"thematic_regroup:{section_title}",
        results_so_far=results_so_far,
        effort=effort or (effort_cfg or "medium"),
    )

    raw_text = (res or {}).get("raw_text", "")
    if not raw_text or not raw_text.strip():
        prov = (res or {}).get("provider")
        mdl = (res or {}).get("model_used")
        err = (res or {}).get("error")
        raise RuntimeError(f"[regrouping_themes] Empty response from provider={prov} model={mdl}. error={err!r}")

    regroup = _extract_json_object(raw_text)

    if not isinstance(regroup, dict) or "overarching" not in regroup:
        raise RuntimeError("[regrouping_themes] Missing 'overarching' in response.")

    # ---------- Reattach MEMBERS AS LISTS OF CANONICALS (no {key: []}) ----------
    assigned_titles: set = set()
    final_overarching: List[Dict[str, Any]] = []

    for grp in (regroup.get("overarching") or []):
        g_title = str(grp.get("title", "")).strip()
        if not g_title:
            continue

        subthemes_out: List[Dict[str, Any]] = []
        for st in (grp.get("subthemes") or []):
            st_title = str(st.get("title", "")).strip()
            if not st_title:
                continue

            # Only attach if we have that title and haven't used it already
            if st_title in members_list_by_title and st_title not in assigned_titles:
                canon_list = [m for m in members_list_by_title[st_title] if m]  # canonical-only
                if canon_list:
                    subthemes_out.append({
                        "title": st_title,
                        "members": canon_list
                    })
                    assigned_titles.add(st_title)

        if subthemes_out:
            final_overarching.append({"title": g_title, "subthemes": subthemes_out})

    # ---------- Compute leftovers (unassigned subtheme titles) ----------
    leftovers = [t for t in all_titles if t not in assigned_titles]

    # Preserve merges if the model returned them (optional)
    merges = regroup.get("merges") if isinstance(regroup.get("merges"), list) else []

    # ---------- Stats ----------
    n_overarching = len(final_overarching)
    n_subthemes = sum(len(g["subthemes"]) for g in final_overarching)
    n_canonicals = sum(len(st["members"]) for g in final_overarching for st in g["subthemes"])
    # Count synonyms from pass-1 material (not surfaced in members lists)
    n_synonyms = 0
    for tb in theme_blocks:
        for _k, syns in (tb.get("members") or {}).items():
            n_synonyms += len(syns or [])

    consolidated: Dict[str, Any] = {
        "overarching": final_overarching,
        "leftovers": leftovers,
        "merges": merges,
        "synonym_map": synonym_map,
        "stats": {
            "n_input_titles": len(all_titles),
            "n_overarching": n_overarching,
            "n_subthemes": n_subthemes,
            "n_canonicals": n_canonicals,
            "n_synonyms": n_synonyms,
            "notes": "Members emitted as canonical-only lists for mind-mapping; synonyms preserved separately in synonym_map."
        }
    }

    # ---------- Fallback: if nothing grouped, create a single bucket deterministically ----------
    if not consolidated["overarching"]:
        # Use the first title as the overarching bucket label (valid, from all_titles)
        first_title = all_titles[0]
        subthemes = []
        for t in all_titles:
            lst = members_list_by_title.get(t) or []
            if lst:
                subthemes.append({"title": t, "members": lst})
        consolidated = {
            "overarching": [{
                "title": first_title,
                "subthemes": subthemes
            }],
            "leftovers": [],
            "merges": [],
            "synonym_map": synonym_map,
            "stats": {
                "n_input_titles": len(all_titles),
                "n_overarching": 1,
                "n_subthemes": len(subthemes),
                "n_canonicals": sum(len(st["members"]) for st in subthemes),
                "n_synonyms": n_synonyms,
                "notes": "LLM regrouping failed; produced deterministic single-bucket fallback. Members are canonical-only lists."
            }
        }

    return consolidated

def process_themes_batches(
    batches: List[List[Dict[str, Any]]],
    *,
    section_title: str,
    ai_provider_key: str = "openai",
    model_api_name: str = "gpt-5",
    cons_model: Optional[str] = None,     # optional override
    cons_max_t: int = 1800,
    use_cache: bool = True,
    results_so_far: Optional[Dict[str, Any]] = None,
    effort: str = "medium",
    completion_window: str = "24h",
    poll_interval: int = 20,
    analysis_key_suffix: str = "thematic_batches_v1",
    revision: str = "r1",
    verbose: bool = False,
    merge_hints: Optional[List[Dict[str, str]]] = None,  # gentle nudges for merges
) -> Dict[str, Any]:
    """
    PHASE A: enqueue one LLM request per batch (store_only=True, read=False)
    PHASE B: submit and poll the provider batch; then read & normalize all results
    PHASE C: regroup normalized per-batch themes into a consolidated hierarchy

    Each batch is formatted with the prompts.json entry named by `analysis_key_suffix`
    (default: "thematic_batches_v1") and expects template vars:
        {batch_index}, {merge_hints_json}, {items_json}
    """
    import re, json, hashlib

    def _cb(msg: str):
        if verbose:
            print(msg)

    # ---------------------- helpers (local, robust) -----------------------
    if not merge_hints:
        merge_hints = [
            {"a": "mission-oriented policy", "b": "mission-oriented innovation"},
            {"a": "public-private partnership", "b": "stakeholder engagement"},
        ]

    def _strip_theme_prefix(s: str) -> str:
        return re.sub(r"^\s*#?\s*theme\s*:\s*", "", s or "", flags=re.I).strip()

    def _normalize_items(items: List[Any]) -> List[Dict[str, Any]]:
        """
        Accepts a batch list with entries like:
          - {"tag": "#theme:mission-oriented innovation", "term": "mission-oriented innovation", "count": 7}
          - {"tag": "#theme:public-private partnership", "count": 3}
          - "#theme:stakeholder engagement"
        Returns a consistent structure: [{"tag": "...", "term": "...", "count": int}, ...]
        """
        norm: List[Dict[str, Any]] = []
        for it in items:
            if isinstance(it, dict):
                tag = str(it.get("tag") or it.get("term") or "")
                if not tag:
                    for k in ("name", "label", "text"):
                        if it.get(k):
                            tag = str(it[k]); break
                if not tag:
                    continue
                term = _strip_theme_prefix(str(it.get("term") or tag))
                cnt = it.get("count", 1)
                try:
                    cnt = int(cnt)
                except Exception:
                    cnt = 1
                norm.append({"tag": tag, "term": term, "count": cnt})
            else:
                tag = str(it)
                if not tag:
                    continue
                term = _strip_theme_prefix(tag)
                norm.append({"tag": tag, "term": term, "count": 1})
        return norm

    def _collect_allowed_terms_from_batches(
        all_batches: List[List[Dict[str, Any]]]
    ) -> set[str]:
        allowed = set()
        for items in all_batches:
            for it in items:
                if isinstance(it, dict):
                    term = _strip_theme_prefix(str(it.get("term") or it.get("tag") or it.get("name") or ""))
                else:
                    term = _strip_theme_prefix(str(it))
                if term:
                    allowed.add(term)
        return allowed

    _ALT_TITLE_KEYS = ("title", "theme", "name", "topic")

    def _normalize_theme_block_from_pass1(
        raw_block: Dict[str, Any],
        *,
        allowed_terms: set[str]
    ) -> Optional[Dict[str, Any]]:
        # title: accept multiple keys, fallback later
        title = None
        for k in _ALT_TITLE_KEYS:
            v = raw_block.get(k)
            if isinstance(v, str) and v.strip():
                title = v.strip()
                break

        members_in = raw_block.get("members")
        if not isinstance(members_in, dict) or not members_in:
            return None

        members_out: Dict[str, List[str]] = {}
        for canon_raw, syns in members_in.items():
            canon = str(canon_raw or "").strip()
            if not canon or canon not in allowed_terms:
                continue
            syn_list = syns if isinstance(syns, list) else [syns]
            syn_clean: List[str] = []
            for s in syn_list:
                s = str(s or "").strip()
                if not s:
                    continue
                if s == canon:
                    continue  # drop self
                if s in allowed_terms:
                    syn_clean.append(s)
            # de-dup & sort
            if syn_clean:
                syn_clean = sorted(set(syn_clean), key=str.lower)
            members_out[canon] = syn_clean

        if not members_out:
            return None

        # fallback title = first canonical
        if not title:
            title = sorted(members_out.keys(), key=str.lower)[0]

        return {"title": title, "members": members_out}

    # ------------------------------ PHASE A -------------------------------
    batch_custom_ids: List[str] = []
    model_to_use: str = model_api_name
    max_tokens_to_use: int = int(cons_max_t)

    for idx, items in enumerate(batches, start=1):
        normalized_items = _normalize_items(items)

        template_vars = {
            "batch_index": idx,
            "merge_hints_json": json.dumps(merge_hints, ensure_ascii=False),
            "items_json": json.dumps(
                [{"tag": it["tag"], "term": it["term"], "count": it["count"]} for it in normalized_items],
                ensure_ascii=False
            ),
        }
        prompt_text, chosen_model, max_toks_cfg, json_schema, effort_cfg = _get_prompt_details(
            prompt_key=analysis_key_suffix,
            ai_provider_key=ai_provider_key,
            default_model_override=None,
            template_vars=template_vars,  # _get_prompt_details may ignore these; we render locally.
            results_so_far=results_so_far,
            section_id=section_title
        )

        # 🔧 Ensure tokens are actually injected (and only those tokens).
        prompt_text = _render_prompt_with_vars(prompt_text, template_vars)

        # Optional safety checks (great for catching silent failures early)
        if "{items_json}" in prompt_text:
            raise RuntimeError("Prompt rendering failed: {items_json} still present.")
        if "• items:" in prompt_text and '"themes"' not in prompt_text and '"leftovers"' not in prompt_text:
            # Not required, but this gives you a quick look that data got embedded.
            pass

        # print(prompt_text)
        # input("prompt")

        # Stable custom_id
        h = hashlib.md5((revision + section_title + str(idx)).encode("utf-8")).hexdigest()[:10]
        cid = f"thematic_batch:{idx}:{h}"
        batch_custom_ids.append(cid)

        model_to_use = cons_model or chosen_model or model_api_name
        max_tokens_to_use = min(int(cons_max_t), int(max_toks_cfg or cons_max_t))

        _ = call_models(
            ai_provider_key=ai_provider_key,
            model_api_name=model_to_use,
            prompt_text=prompt_text,
            analysis_key_suffix=analysis_key_suffix,
            max_tokens=max_tokens_to_use,
            base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir") if results_so_far else None,
            use_cache=use_cache,
            store_only=True,
            read=False,
            section_title=section_title,
            custom_id=cid,
            results_so_far=results_so_far,
            effort=effort or (effort_cfg or "medium"),
        )
        _cb(f"[enqueue] batch {idx:02d}/{len(batches)} → {cid}")

    # ------------------------------ PHASE B -------------------------------
    ok = False
    batch_payloads_raw: List[Dict[str, Any]] = []
    batch_payloads_norm: List[Dict[str, Any]] = []

    allowed_terms = _collect_allowed_terms_from_batches(batches)

    try:
        _cb("[batch] Submitting and polling for completion…")
        ok = _process_batch_for(
            analysis_key_suffix=analysis_key_suffix,
            section_title=section_title,
            completion_window=completion_window,
            poll_interval=poll_interval,
        )


        if ok:
            _cb(f"[batch] All {len(batches)} batch(es) processed successfully.")

            for cid in batch_custom_ids:
                # READ previously enqueued result (prompt_text ignored here)
                res = call_models(
                    ai_provider_key=ai_provider_key,
                    model_api_name=model_to_use,
                    prompt_text="",
                    analysis_key_suffix=analysis_key_suffix,
                    max_tokens=max_tokens_to_use,
                    base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir") if results_so_far else None,
                    use_cache=use_cache,
                    store_only=False,
                    read=True,
                    section_title=section_title,
                    custom_id=cid,
                    results_so_far=results_so_far,
                    effort=effort,
                )
                if verbose:
                    print(res["raw_text"])

                try:

                    resp_text = (res or {}).get("raw_text", "") if isinstance(res, dict) else ""

                    if not resp_text:
                        _cb(f"[read] {cid} -> empty raw_text; skipped")
                        continue
                    try:
                        payload = json.loads(resp_text)
                    except Exception as je:
                        _cb(f"[read] {cid} -> JSON parse error: {je!r}")
                        continue

                    if isinstance(payload, dict):
                        batch_payloads_raw.append(payload)
                        # normalize all theme blocks within this payload
                        for th in (payload.get("themes") or []):
                            nb = _normalize_theme_block_from_pass1(th, allowed_terms=allowed_terms)
                            if nb:
                                batch_payloads_norm.append(nb)
                        _cb(f"[read+norm] {cid} ✓")
                    else:
                        _cb(f"[read] {cid} -> non-dict; skipped")
                except Exception as e:
                    _cb(f"[read] WARNING for {cid}: {e!r}")

    except Exception as _e_proc:
        _cb(f"[batch] WARNING: _process_batch_for failed: {_e_proc!r}")
        ok = False

    # ------------------------------ PHASE C -------------------------------
    regrouped: Optional[Dict[str, Any]] = None
    if ok and batch_payloads_norm:
        try:
            regrouped = regrouping_themes(
                batch_payloads=batch_payloads_norm,  # normalized blocks only
                section_title=section_title,
                ai_provider_key=ai_provider_key,
                model_api_name=model_api_name,
                analysis_key_suffix="thematic_regroup_v1",
                cons_model=cons_model,
                cons_max_t=5000,
                merge_hints=merge_hints,
                results_so_far=results_so_far,
                use_cache=use_cache,
                effort=effort,
            )
            _cb("[regroup] Consolidation ✓")
        except Exception as e:
            _cb(f"[regroup] WARNING: {e!r}")
            # deterministic fallback → single overarching bucket
            try:
                titles = sorted({b["title"] for b in batch_payloads_norm if "title" in b})
                merged_members: Dict[str, List[str]] = {}
                for b in batch_payloads_norm:
                    for k, syns in b["members"].items():
                        if k not in merged_members:
                            merged_members[k] = list(syns)
                        else:
                            merged_members[k] = sorted(list(set(merged_members[k] + syns)), key=str.lower)
                regrouped = {
                    "overarching": [{
                        "title": titles[0] if titles else section_title,
                        "subthemes": [{
                            "title": titles[0] if titles else section_title,
                            "members": merged_members
                        }]
                    }],
                    "leftovers": [],
                    "merges": [],
                    "synonym_map": {s: k for k, syns in merged_members.items() for s in syns},
                    "stats": {
                        "n_input_titles": len(titles),
                        "n_overarching": 1,
                        "n_subthemes": 1,
                        "n_canonicals": len(merged_members),
                        "n_synonyms": sum(len(v) for v in merged_members.values()),
                        "notes": "LLM regrouping failed; produced deterministic single-bucket fallback."
                    }
                }
            except Exception:
                pass

    # ------------------------------ RETURN -------------------------------
    return {
        "ok": bool(ok),
        "custom_ids": batch_custom_ids,
        "section_title": section_title,
        "analysis_key_suffix": analysis_key_suffix,
        "n_batches": len(batches),
        "batch_outputs_raw": batch_payloads_raw,   # as returned by the LLM
        "batch_outputs": batch_payloads_norm,      # normalized theme blocks
        "regrouped": regrouped
    }


# ------------------------------ orchestration ------------------------------
def _collect_allowed_terms_from_batches(
    batches: List[List[Dict[str, Any]]],
    _strip=lambda s: re.sub(r"^\s*#?\s*theme\s*:\s*", "", s or "", flags=re.I).strip()
) -> set[str]:
    allowed = set()
    for items in batches:
        for it in items:
            if isinstance(it, dict):
                term = _strip(str(it.get("term") or it.get("tag") or it.get("name") or ""))
            else:
                term = _strip(str(it))
            if term:
                allowed.add(term)
    return allowed

_ALT_TITLE_KEYS = ("title", "theme", "name", "topic")

def _normalize_theme_block_from_pass1(
    raw_block: Dict[str, Any],
    *,
    allowed_terms: set[str]
) -> dict | None:
    # 1) title
    title = None
    for k in _ALT_TITLE_KEYS:
        if k in raw_block and str(raw_block[k]).strip():
            title = str(raw_block[k]).strip()
            break

    members_in = raw_block.get("members")
    if not isinstance(members_in, dict) or not members_in:
        return None

    members_out: Dict[str, List[str]] = {}
    for canon_raw, syns in members_in.items():
        canon = str(canon_raw or "").strip()
        if not canon or canon not in allowed_terms:
            continue
        # synonyms: ensure list + filter to allowed + drop self
        syn_list = syns if isinstance(syns, list) else [syns]
        syn_clean = []
        for s in syn_list:
            s = str(s or "").strip()
            if not s:
                continue
            if s == canon:
                continue
            if s in allowed_terms:
                syn_clean.append(s)
        # de-dup
        syn_clean = sorted(set(syn_clean), key=str.lower)
        members_out[canon] = syn_clean

    if not members_out:
        return None

    # fallback title if missing
    if not title:
        title = sorted(members_out.keys(), key=str.lower)[0]

    return {"title": title, "members": members_out}
from typing import Dict, Any, Optional, List

import plotly.graph_objects as go

def _compute_term_counts_from_df(
    df,
    *,
    theme_col: str,
    separators: str,
    min_len: int
) -> Dict[str, int]:
    """
    Build a case-insensitive frequency map from the dataframe column.
    - Splits by separators
    - Strips '#theme:' (lenient)
    - Lowercases & trims
    """
    rx = re.compile(separators)
    counts = Counter()

    def _strip_prefix(s: str) -> str:
        s = re.sub(r"^\s*#?\s*theme\s*:\s*", "", s, flags=re.I)  # <<< remove prefix
        s = re.sub(r"\s+", " ", s).strip().lower()
        return s

    for raw in df[theme_col].dropna().astype(str):
        for tok in rx.split(raw):
            t = _strip_prefix(tok)
            if len(t) >= min_len:
                counts[t] += 1
    return dict(counts)


def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip()).lower()


def _merge_theme_blocks_across_batches(batch_outputs_raw: List[Dict[str, Any]]) -> Dict[str, Dict[str, List[str]]]:
    """
    Build a merged {theme_title -> {canonical_keyword -> [unique synonyms...]}} across all batches.
    """
    merged: Dict[str, Dict[str, set]] = {}
    for batch in (batch_outputs_raw or []):
        for th in batch.get("themes", []):
            t_title = str(th.get("title", "")).strip()
            if not t_title:
                continue
            merged.setdefault(t_title, {})
            for canon, syns in (th.get("members") or {}).items():
                canon_s = str(canon).strip()
                if not canon_s:
                    continue
                merged[t_title].setdefault(canon_s, set())
                if isinstance(syns, (list, tuple)):
                    for s in syns:
                        s_s = str(s).strip()
                        if s_s:
                            merged[t_title][canon_s].add(s_s)
    # cast sets -> lists
    return {t: {k: sorted(list(v)) for k, v in members.items()} for t, members in merged.items()}


def _ensure_regrouped_structure(out: Dict[str, Any]) -> Dict[str, Any]:
    """
    Prefer a true regrouped/consolidated structure if present; otherwise synthesize a
    2-level hierarchy from the batched 'themes' (Overarching=theme title; one Subtheme with the same title).
    """
    # Prefer keys likely produced by your regroup step
    for key in ("regrouped", "consolidated", "regroup_titles_only"):
        if key in out and isinstance(out[key], dict) and "overarching" in out[key]:
            return out[key]

    # Fall back: synthesize from batches
    blocks = _merge_theme_blocks_across_batches(out.get("batch_outputs_raw", []))
    synthesized = {
        "overarching": [
            {"title": t, "subthemes": [{"title": t, "members": blocks.get(t, {})}]}
            for t in sorted(blocks.keys())
        ],
        "leftovers": [],
        "synonym_map": {},
        "stats": {"note": "synthesized regroup (no clustering step available)"}
    }
    return synthesized

def _build_bar_fig(structural: Dict[str, Any], title: str = "Keywords per Overarching Theme") -> go.Figure:
    og_names = list(structural["overarching"].keys())
    og_vals = [structural["overarching"][k] for k in og_names]
    # If all zeros (e.g., no matches yet), give minimal 1s to show something
    show_vals = [v if v > 0 else 1 for v in og_vals]

    bar = go.Bar(x=og_names, y=show_vals, hovertemplate="<b>%{x}</b><br>Total keyword hits: %{customdata}<extra></extra>",
                 customdata=og_vals)
    fig = go.Figure(bar)
    fig.update_layout(
        title={'text': title, 'x': 0.5, 'xanchor': 'center'},
        xaxis_title="Overarching theme",
        yaxis_title="Total occurrences in corpus",
        margin=dict(t=60, l=40, r=20, b=80)
    )
    return fig


from typing import List, Dict, Any, Tuple
import plotly.graph_objects as go
def _build_mindmap_fig(
    regrouped: Dict[str, Any],
    structural: Dict[str, Any],
    *,
    root_title: str = "Thematic Map",
    engine: str = "sunburst"  # or "treemap"
) -> Tuple[Dict[str, Any], go.Figure]:
    """
    Build a large, readable sunburst/treemap using exact counts from `structural`.
    """
    def sid(*bits) -> str:
        return ":".join(["n", *[re.sub(r"[^a-z0-9]+", "-", str(b).lower()).strip("-") or "n" for b in bits]])

    def _iter_members(members):
        # dict: {canonical: [synonyms...]}; list: ["canonical1", ...]; string: "canonical"
        if not members:
            return
        if isinstance(members, dict):
            for k in members.keys():
                k = str(k).strip()
                if k:
                    yield k
        elif isinstance(members, (list, tuple, set)):
            for it in members:
                s = str(it).strip()
                if s:
                    yield s
        elif isinstance(members, str):
            s = members.strip()
            if s:
                yield s

    labels: List[str] = []
    parents: List[str] = []
    values: List[int] = []
    ids: List[str] = []
    customdata: List[List[str]] = []  # [level]

    # Root
    root_id = sid(root_title)
    labels.append(root_title)
    parents.append("")
    ids.append(root_id)
    root_val = sum(structural.get("overarching", {}).values())
    values.append(max(root_val, 1))
    customdata.append(["Root"])

    # Overarching -> Subtheme -> Keyword
    for og in (regrouped or {}).get("overarching", []):
        og_title = str(og.get("title", "")).strip()
        if not og_title:
            continue
        og_id = sid(root_title, og_title)
        labels.append(og_title)
        parents.append(root_id)
        ids.append(og_id)
        og_val = int(structural["overarching"].get(og_title, 0))
        values.append(max(og_val, 1))
        customdata.append(["Overarching"])

        for st in (og.get("subthemes") or []):
            st_title = str(st.get("title", "")).strip()
            if not st_title:
                continue
            st_id = sid(root_title, og_title, st_title)
            labels.append(st_title)
            parents.append(og_id)
            ids.append(st_id)
            st_val = int(structural["subthemes"].get((og_title, st_title), 0))
            values.append(max(st_val, 1))
            customdata.append(["Subtheme"])

            for kw in _iter_members(st.get("members")):
                kw_id = sid(root_title, og_title, st_title, kw)
                labels.append(kw)
                parents.append(st_id)
                ids.append(kw_id)
                kw_val = int(structural["keywords"].get((og_title, st_title, kw), 0))
                values.append(max(kw_val, 1))
                customdata.append(["Keyword"])

    if engine == "treemap":
        trace = go.Treemap(
            labels=labels, parents=parents, values=values, ids=ids,
            branchvalues="total",
            hovertemplate="<b>%{label}</b><br>%{customdata[0]} · occurrences: %{value}<extra></extra>",
            customdata=customdata
        )
    else:
        trace = go.Sunburst(
            labels=labels, parents=parents, values=values, ids=ids,
            branchvalues="total",
            hovertemplate="<b>%{label}</b><br>%{customdata[0]} · occurrences: %{value}<extra></extra>",
            customdata=customdata
        )

    fig = go.Figure(trace)
    # make it big and readable
    fig.update_layout(
        title={'text': root_title, 'x': 0.5, 'xanchor': 'center'},
        template="plotly_white",
        width=1800,
        height=1100,
        margin=dict(t=70, l=40, r=40, b=40),
        uniformtext=dict(minsize=12, mode="hide")  # hide tiny labels instead of overlapping
    )

    mindmap_data = {
        "root_id": root_id,
        "nodes": [
            {"id": i, "label": l, "parent": p, "value": v, "level": cd[0]}
            for i, l, p, v, cd in zip(ids, labels, parents, values, customdata)
        ]
    }
    return mindmap_data, fig
from plotly.subplots import make_subplots
import plotly.graph_objects as go
def _build_top5_bars_from_flat(flat_themes: Dict[str, List[Dict[str, Any]]],
                               *,
                               title: str = "Top 5 terms per Overarching theme") -> go.Figure:
    """
    2×3 grid of horizontal bar charts (Top-5 per theme) with deliberate gaps between panels.
    - Keeps biggest bars at the top of each subplot.
    - Uses generous width/height and larger inter-subplot spacing to create visible gaps.
    """
    # determine layout: up to 6 panels, 2x3; if fewer themes, shrink nicely
    themes = list(flat_themes.keys())
    if not themes:
        return go.Figure().add_annotation(text="No theme data.", showarrow=False)

    # order by total counts desc so the busiest themes appear first
    themes = sorted(themes, key=lambda t: sum(int(r.get("count", 0)) for r in flat_themes[t]), reverse=True)
    themes6 = themes[:6]
    rows, cols = (2, 3) if len(themes6) > 3 else (1, len(themes6))

    # larger spacing → visible "gaps" between subplots
    horizontal_spacing = 0.14  # figure — gap — figure — gap — figure
    vertical_spacing = 0.22    # top row — big gap — bottom row

    fig = make_subplots(
        rows=rows,
        cols=cols,
        specs=[[{"type": "bar"}] * cols for _ in range(rows)],
        subplot_titles=themes6 + [""] * (rows * cols - len(themes6)),
        horizontal_spacing=horizontal_spacing,
        vertical_spacing=vertical_spacing,
    )

    positions = [(r, c) for r in range(1, rows + 1) for c in range(1, cols + 1)]
    for (r, c), og in zip(positions, themes6):
        rows_ = sorted(flat_themes[og], key=lambda d: (-int(d.get("count", 0)), d["term"]))[:5]
        # pad to 5 bars for consistent height
        while len(rows_) < 5:
            rows_.append({"term": "—", "count": 0})
        terms = [x["term"] for x in rows_][::-1]   # biggest on top
        counts = [int(x["count"]) for x in rows_][::-1]

        fig.add_trace(
            go.Bar(
                x=counts,
                y=terms,
                orientation="h",
                text=[c if c > 0 else "" for c in counts],
                textposition="outside",
                hovertemplate="%{y}: %{x}<extra></extra>",
                cliponaxis=False,
            ),
            row=r, col=c
        )
        fig.update_yaxes(title_text="", row=r, col=c, categoryorder="array", categoryarray=terms)
        fig.update_xaxes(title_text="Count" if r == rows else "", row=r, col=c)

    # bigger canvas + clean look
    fig.update_layout(
        template="plotly_white",
        height=1050 if rows == 2 else 600,
        width=1800 if cols == 3 else 1400,
        title=dict(text=title, x=0.02, xanchor="left"),
        margin=dict(l=70, r=50, t=90, b=70),
        showlegend=False,
        uniformtext=dict(minsize=10, mode="hide"),
        font=dict(family="Calibri", size=12, color="#2A2E33"),
        bargap=0.35,     # gap between bars within each subplot
        bargroupgap=0.10 # if multiple series existed per subplot
    )
    return fig

def _iter_members(members):
    """
    Yield (canonical, synonyms_list) from many possible 'members' shapes:
      - dict: {canonical: [synonyms...]}, {canonical: "syn"}, {canonical: None}
      - list/tuple/set of strings: ["term1", "term2", ...]
      - list/tuple/set of dicts: [{"term": "x", "synonyms": [...]}, ...]
      - string: "single term"
    """
    if not members:
        return
    # dict case
    if isinstance(members, dict):
        for k, syns in members.items():
            canon = str(k).strip()
            if not canon:
                continue
            if isinstance(syns, (list, tuple, set)):
                syn_list = [str(s).strip() for s in syns if str(s).strip()]
            elif isinstance(syns, str):
                syn_list = [syns.strip()] if syns.strip() else []
            else:
                syn_list = []
            yield canon, syn_list
        return
    # list/tuple/set case
    if isinstance(members, (list, tuple, set)):
        for item in members:
            if isinstance(item, str):
                canon = item.strip()
                if canon:
                    yield canon, []
            elif isinstance(item, dict):
                canon = str(item.get("term", "")).strip() or str(item.get("title", "")).strip()
                syns = item.get("synonyms") or []
                syn_list = [str(s).strip() for s in syns if str(s).strip()]
                if canon:
                    yield canon, syn_list
        return
    # string case
    if isinstance(members, str):
        canon = members.strip()
        if canon:
            yield canon, []
from typing import Dict, Any, List, Tuple

def _build_flat_structures(
    regrouped: Dict[str, Any],
    df_counts: Dict[str, int]
) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Any]]:
    """
    Returns:
      flat_themes: { Overarching -> [ {term, count, subtheme, synonyms}, ... ] }
      structural_themes: hierarchical rollups:
         - "overarching": { OG -> total_count }
         - "subthemes":  { (OG, ST) -> total_count }
         - "keywords":   { (OG, ST, KW) -> count }
    """
    # Fallback normalizer in case _normalize isn't in scope
    def _norm(s: str) -> str:
        try:
            return _normalize(s)  # type: ignore[name-defined]
        except Exception:
            return str(s).strip().lower()

    flat: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    structural = {
        "overarching": {},
        "subthemes": {},
        "keywords": {}
    }

    for og in (regrouped or {}).get("overarching", []):
        og_title = str(og.get("title", "")).strip()
        if not og_title:
            continue

        og_total = 0
        for st in (og.get("subthemes") or []):
            st_title = str(st.get("title", "")).strip()
            st_total = 0

            # <-- the only change: iterate members safely
            for canonical, synonyms in _iter_members(st.get("members")):
                # Sum canonical + synonyms using df_counts (already normalized keys)
                count = df_counts.get(_norm(canonical), 0)
                for s in synonyms:
                    count += df_counts.get(_norm(s), 0)

                flat[og_title].append({
                    "term": canonical,
                    "count": int(count),
                    "subtheme": st_title,
                    "synonyms": list(synonyms) if isinstance(synonyms, (list, tuple, set)) else []
                })
                structural["keywords"][(og_title, st_title, canonical)] = int(count)
                st_total += count

            structural["subthemes"][(og_title, st_title)] = int(st_total)
            og_total += st_total

        structural["overarching"][og_title] = int(og_total)

    # Sort for nicer bar charts
    for og_title, items in flat.items():
        items.sort(key=lambda d: d["count"], reverse=True)

    return dict(flat), structural

def thematic_analysis(
    df,
    *,
    theme_col: str = "controlled_vocabulary_terms",
    batch_size: int = 60,
    section_title: str = "thematic_batches_v1",
    ai_provider_key: str = "openai",
    model_api_name: str = "gpt-5",
    cons_model: Optional[str] = None,
    cons_max_t: int = 1800,
    separators: str = r"[;|,\n]+",
    min_len: int = 2,
    use_cache: bool = True,
    results_so_far: Optional[Dict[str, Any]] = None,
    effort: str = "medium",
    completion_window: str = "24h",
    poll_interval: int = 20,
    analysis_key_suffix: str = "thematic_batches_v1",
    revision: str = "r1",
    verbose: bool = True,
) -> Dict[str, Any]:
    """
    High-level convenience: parse -> batch -> queue -> process -> plot.

    Returns:
      {
        "data": {
           "flat_themes": { Overarching -> [ {term, count, subtheme, synonyms?}, ... ] },
           "structural_themes": {
               "overarching": {OG -> total},
               "subthemes": {(OG, ST) -> total},
               "keywords": {(OG, ST, KW) -> count}
           },
           "regrouped": <consolidated hierarchy (members may be dict or list)>
        },
        "plots": {
           "bar_fig": <plotly Figure: Top 5 per Overarching>,
           "mind_map_fig": <plotly Figure: sunburst mind-map>
        },
        "batches_preview": [ [first 5 terms from batch 1], [first 5 from batch 2], ... ]
      }
    """
    # -------------------------- Build batches --------------------------
    batches = creating_batch_tags(
        df,
        theme_col=theme_col,
        size=batch_size,
        separators=separators,
        min_len=min_len,
        sort_by_freq=True,
    )
    if verbose:
        total_terms = sum(len(b) for b in batches)
        print(f"[parse] extracted {total_terms} unique #theme tokens "
              f"into {len(batches)} batch(es) (target size≈{batch_size}).")

    # Small preview for sanity
    def _term_of(item):
        if isinstance(item, dict):
            for k in ("term", "tag", "name", "label", "text"):
                if item.get(k):
                    return str(item[k])
        return str(item)
    batches_preview = [[_term_of(it) for it in batch[:5]] for batch in batches]

    # -------------------------- Queue + process --------------------------
    out = process_themes_batches(
        batches=batches,
        section_title=section_title,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        cons_model=cons_model,
        cons_max_t=cons_max_t,
        use_cache=use_cache,
        results_so_far=results_so_far,
        effort=effort,
        completion_window=completion_window,
        poll_interval=poll_interval,
        analysis_key_suffix=analysis_key_suffix,
        revision=revision,
        verbose=verbose,
    )

    if verbose:
        print(f"[batch] ok={out.get('ok')} · n_batches={out.get('n_batches')} · "
              f"raw_payloads={len(out.get('batch_outputs_raw', []))}")

    # Prefer provider's consolidated hierarchy; else synthesize a safe fallback
    regrouped = _ensure_regrouped_structure(out)

    if verbose:
        n_og = len(regrouped.get("overarching", []))
        n_st = sum(len(g.get("subthemes") or []) for g in regrouped.get("overarching", []))
        print(f"[regroup] overarching={n_og} · subthemes={n_st}")
        if n_og:
            print("         overarching titles:",
                  ", ".join(g["title"] for g in regrouped["overarching"] if g.get("title")))

    # -------------------------- Re-count corpus tokens --------------------------
    # IMPORTANT: this strips '#theme:' before counting so direct matches work.
    df_counts = _compute_term_counts_from_df(
        df,
        theme_col=theme_col,
        separators=separators,
        min_len=min_len
    )

    if verbose and df_counts:
        top10 = sorted(df_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        print("[count] top tokens (after stripping '#theme:'):", ", ".join(f"{k}:{v}" for k, v in top10))

    # -------------------------- Build flat + structural views --------------------------
    flat_themes, structural_themes = _build_flat_structures(regrouped, df_counts)

    if verbose:
        print("[rollup] totals by overarching theme:")
        for og, tot in structural_themes.get("overarching", {}).items():
            print(f"         - {og}: {tot}")
        print("[preview] top 5 terms per overarching:")
        for og, rows in flat_themes.items():
            top5 = sorted(rows, key=lambda r: (-int(r.get('count', 0)), r['term']))[:5]
            as_text = ", ".join(f"{r['term']}({int(r['count'])})" for r in top5) if top5 else "—"
            print(f"         · {og}: {as_text}")

    # -------------------------- Build plots --------------------------
    bar_fig = _build_top5_bars_from_flat(
        flat_themes,
        title="Top 5 keyword occurrences per Overarching theme"
    )

    mindmap_data, mind_map_fig = _build_mindmap_fig(
        regrouped=regrouped,
        structural=structural_themes,
        root_title="Thematic Map",
        engine="sunburst"
    )

    if verbose:
        print("[plots] figures built: bar_fig (Top-5 grid), mind_map_fig (sunburst).")

    # -------------------------- Return --------------------------
    return {
        "data": {
            "flat_themes": flat_themes,
            "structural_themes": structural_themes,
            "regrouped": regrouped
        },
        "plots": {
            "bar_fig": bar_fig,
            "mind_map_fig": mind_map_fig
        },
        "batches_preview": batches_preview
    }

from typing import List, Dict, Any
import re
from collections import Counter, defaultdict

def creating_batch_tags(
    df,
    theme_col: str = "controlled_vocabulary_terms",
    size: int = 50,
    separators: str = r"[;|,\n]+",
    min_len: int = 2,
    sort_by_freq: bool = True,
) -> List[List[Dict[str, Any]]]:
    """
    Parse '#theme:' tags from df[theme_col], dedupe by *document frequency*,
    and return batches of up to `size` items. Each item is:
      {"tag": "mission-oriented policy", "term": "mission-oriented policy", "count": 18}

    IMPORTANT CHANGE:
    - Both `tag` and `term` are returned WITHOUT the '#theme:' prefix (cleaned).
    - Lowercased, whitespace-normalized terms are used for counting and output.

    Notes
    -----
    • Document frequency: if a tag appears multiple times in one row, it counts once.
    • `separators` is a regex used to split multi-valued cells (strings or lists).
    • `min_len` drops very short terms (after normalization).
    • `sort_by_freq=True` sorts items by descending count, then term, before batching.
    """
    if theme_col not in df.columns:
        raise ValueError(f"DataFrame lacks column '{theme_col}'")

    def _is_nan(x) -> bool:
        try:
            import pandas as _pd
            return _pd.isna(x)
        except Exception:
            return x is None

    def _canon_term(s: str) -> str:
        """
        Clean a raw token:
        - remove any leading '#theme:' or 'theme:' (case/space tolerant)
        - collapse internal whitespace
        - lowercase
        """
        s = str(s or "").strip()
        if not s:
            return ""
        s = re.sub(r"^\s*#?\s*theme\s*:\s*", "", s, flags=re.I)
        s = re.sub(r"\s+", " ", s).strip()
        return s.lower()

    def _extract_theme_list(cell, *, separators: str) -> List[str]:
        """
        From a cell (string or list), extract all tokens that look like #theme:*,
        return as *cleaned terms without the '#theme:' prefix* (lowercased).
        """
        if _is_nan(cell):
            return []
        parts: List[str] = []
        if isinstance(cell, list):
            for v in cell:
                if _is_nan(v):
                    continue
                parts.extend(re.split(separators, str(v)))
        else:
            parts = re.split(separators, str(cell))

        out: List[str] = []
        for raw in parts:
            raw = str(raw or "").strip()
            if not raw:
                continue
            # accept both '#theme:' and 'theme:' (case/space tolerant)
            if re.match(r"^\s*#?\s*theme\s*:", raw, flags=re.I):
                term = _canon_term(raw)
                if term and len(term) >= min_len:
                    out.append(term)  # <-- cleaned (no '#theme:')
        return out

    # Collect per-row unique term sets to compute document frequency
    per_row_sets: List[List[str]] = []
    variants: defaultdict[str, Counter] = defaultdict(Counter)  # term -> Counter of raw variants
    for _, row in df.iterrows():
        cell = row.get(theme_col)
        if _is_nan(cell):
            per_row_sets.append([])
            continue

        # capture raw tokens to record variants
        raw_parts: List[str] = []
        if isinstance(cell, list):
            for v in cell:
                if _is_nan(v):
                    continue
                raw_parts.extend(re.split(separators, str(v)))
        else:
            raw_parts = re.split(separators, str(cell))

        cleaned_terms: List[str] = []
        for raw in raw_parts:
            raw = str(raw or "").strip()
            if not raw:
                continue
            if re.match(r"^\s*#?\s*theme\s*:", raw, flags=re.I):
                term = _canon_term(raw)
                if term and len(term) >= min_len:
                    cleaned_terms.append(term)
                    variants[term][raw] += 1

        per_row_sets.append(sorted(set(cleaned_terms)))

    # Document frequency over cleaned terms
    term_df = Counter()
    for s in per_row_sets:
        term_df.update(s)

    # Build items with cleaned fields (no '#theme:' anywhere)
    items: List[Dict[str, Any]] = []
    for term, cnt in term_df.items():
        if term and len(term) >= min_len:
            items.append({"tag": term, "term": term, "count": int(cnt)})

    if not items:
        return []

    # Sort for better downstream quality/consistency
    if sort_by_freq:
        items.sort(key=lambda x: (-x["count"], x["term"]))
    else:
        items.sort(key=lambda x: x["term"])

    # Chunk into batches of up to `size`
    size = max(1, int(size))
    batches: List[List[Dict[str, Any]]] = []
    for i in range(0, len(items), size):
        batches.append(items[i : i + size])

    return batches
# powerpoint

def _set_notes(slide, text: str, title: str = "") -> None:
    """
    ###1. write slide notes as plain text
    """
    text = "" if text is None else str(text)
    title = "" if title is None else str(title)

    notes_slide = slide.notes_slide
    tf = notes_slide.notes_text_frame
    tf.clear()

    if title.strip():
        tf.text = title.strip()
        if text.strip():
            p = tf.add_paragraph()
            p.text = text.strip()
    else:
        tf.text = text.strip()
