#!/usr/bin/env python

import io, os, re, unicodedata, argparse, logging, itertools
import json
import time
from pathlib import Path
from collections import defaultdict, Counter
from typing import List, Dict, Tuple, Set, Any
from tqdm import tqdm
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


from pathlib import Path



# create the two folders if they don't exist
SCRIPT_DIR  = Path(__file__).resolve().parent
INPUT_DIR   = SCRIPT_DIR / "input_ris_data"
OUTPUT_DIR  = SCRIPT_DIR / "outputs"

# ensure folders exist
INPUT_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# collect every RIS/CSV under input_ris_data
DB_FILES = sorted(str(p) for p in INPUT_DIR.glob("*.ris")) + \
           sorted(str(p) for p in INPUT_DIR.glob("*.csv"))

if not DB_FILES:
    raise FileNotFoundError(
        f"No .ris or .csv files found in {INPUT_DIR}. "
        "Drop your input files there or adjust INPUT_DIR."
    )
# ─── shared Crossref session with retry/backoff ────────────
_crossref_session = requests.Session()
_retries = Retry(
    total=3,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"]
)
_crossref_session.mount("https://", HTTPAdapter(max_retries=_retries))


# --------------------------------------------------------------------- #
# 0.  OPTIONAL HEAVY ENGINES (only imported if selected)                #
# --------------------------------------------------------------------- #
try:
    import dedupe
except ImportError:
    dedupe = None
    logging.info("dedupe library not found. It will not be available as an engine.")
try:
    import recordlinkage as rl
except ImportError:
    rl = None
    logging.info("recordlinkage library not found. It will not be available as an engine.")
try:
    from zotero_duplicates import zotero_dupes
except ImportError:
    zotero_dupes = None
    logging.info("zotero_duplicates library not found. It will not be available as an engine.")

# --------------------------------------------------------------------- #
# 1.  CONFIG & LOW-LEVEL HELPERS                                        #
# --------------------------------------------------------------------- #
# --- TAGS AND CONSTANTS ---

COMMON_TITLE_TAGS = {"TI", "T1", "TT", "T2", "T3"}  #  new tags
URL_TAGS            = {"UR", "L1", "L2"}                  # +L1/L2
YEAR_TAGS           = {"PY", "Y1"}
JOURNAL_TAGS = {"JO", "JF", "T2"}                  # unchanged
ABSTRACT_TAGS       = {"AB", "N2"}
DOI_TAGS            = {"DO"}
ISBN_TAGS           = {"SN"}
AUTHOR_TAGS = {"AU", "A1", "A2"}                  # +A2
KEYWORD_TAGS        = {"KW"}
CITATION_COUNT_TAGS = {"CT"}
CITATION_TAGS       = {"CI"}
_ROMAN = {"M":1000,"CM":900,"D":500,"CD":400,"C":100,"XC":90,"L":50,"XL":40,"X":10,"IX":9,"V":5,"IV":4,"I":1}

# Custom STOPWORDS. Removed the wordcloud import as it's not used.
STOPWORDS = {"the", "a", "an", "and", "of", "in", "for", "on", "at", "to", "with",
             "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
             "do", "does", "did", "will", "would", "shall", "should", "can", "could",
             "may", "might", "must", "as", "by", "from", "into", "through", "above",
             "below", "up", "down", "out", "off", "over", "under", "again", "further",
             "then", "once", "here", "there", "when", "where", "why", "how", "all",
             "any", "both", "each", "few", "more", "most", "other", "some", "such",
             "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
             "s", "t", "can", "will", "just", "don", "should", "now"}

# --- REGULAR EXPRESSIONS (THESE MUST BE DEFINED BEFORE USE) ---
DOI_RE = re.compile(r"10\.\d{4,9}/[\w.;()/:+-]+", re.I)
ISBN13_RE = re.compile(r"97[89]\d{10}")
ISBN10_RE = re.compile(r"\b\d{9}[\dXx]\b")
ABSTRACT_HEADER_RE = re.compile(
    # More robustly matches various citation/venue string formats
    r'.*?(Vol\.|Issue|pp\.|Spring|Summer|Fall|Winter\s+\d{4})',
    re.IGNORECASE
)
_CITED_RE   = re.compile(r"\bcited by\s+(\d{1,6})", re.I)
_PROFILE_RE = re.compile(r"https?://\S+")

LOG = logging.getLogger("dedupe")

# persistent cache to avoid duplicate Crossref calls
CACHE_PATH = "crossref_cache.json"
if os.path.exists(CACHE_PATH):
    with open(CACHE_PATH, "r", encoding="utf-8") as _f:
        _CROSSREF_CACHE = json.load(_f)
    # migrate any string/null entries into dicts
    for k, v in list(_CROSSREF_CACHE.items()):
        if isinstance(v, str) or v is None:
            _CROSSREF_CACHE[k] = {"DOI": v}
else:
    _CROSSREF_CACHE = {}

    # ── Crossref throttle & e-mail rotation ──────────────────────────────
CROSSREF_MAILTO = [
    "luanorodrigues@yahoo.com.br",
    "luanorodriguessilva@gmail.com",
    "ucablrs@ucl.ac.uk",
]
_CALL_COUNT = 0          # global, reset each run

def _next_mailto() -> str:
    """Return one of three mailto addresses, rotate every 500 calls."""
    global _CALL_COUNT
    index = (_CALL_COUNT // 500) % len(CROSSREF_MAILTO)
    return CROSSREF_MAILTO[index]

def fetch_crossref_meta(title: str,
                       year: str | None = None,
                       author: str | None = None) -> dict:
    global _CALL_COUNT
    # build cache key
    key = f"{title}|{year or ''}|{author or ''}"
    # return cached metadata if available
    if key in _CROSSREF_CACHE:
        return _CROSSREF_CACHE[key]

    # prepare params & headers
    # stricter: send full bibliographic string (title + author + year)
    params = {
        "query.title": title,
        "rows": 1,
        "mailto": _next_mailto()
    }
    if author:
        params["query.author"] = author.split(",")[0]
    if year:
        params["filter"] = f"from-pub-date:{year},until-pub-date:{year}"

    headers = {"User-Agent": f"RIS-merge/1.0 ({params['mailto']})"}

    try:
        r = _crossref_session.get(
            "https://api.crossref.org/works",
            params=params, headers=headers, timeout=5
        )
        _CALL_COUNT += 1
        r.raise_for_status()
        items = r.json()["message"]["items"]
        if not items:
            meta = {}
        else:
            candidate = items[0]
            returned = (candidate.get("title") or [""])[0].lower()
            want = title.lower()
            from difflib import SequenceMatcher
            sim = SequenceMatcher(None, want, returned).ratio()
            # require high threshold
            if sim < 0.85:
                LOG.warning(
                    f"Crossref title mismatch (sim={sim:.2f}): "
                    f"“{returned[:60]}…” vs “{want[:60]}…” – dropping"
                )
                meta = {}
            else:
                meta = candidate
    except Exception as exc:
        LOG.warning(f"Crossref look-up failed: {exc}")
        meta = {}

    except Exception as exc:
        LOG.warning(f"Crossref look-up failed: {exc}")
        meta = {}

    # cache and persist full metadata
    _CROSSREF_CACHE[key] = meta
    try:
        with open(CACHE_PATH, "w", encoding="utf-8") as _f:
            json.dump(_CROSSREF_CACHE, _f, indent=2, ensure_ascii=False)
    except Exception as exc:
        LOG.warning(f"Failed to write Crossref cache: {exc}")

    return meta



def _roman_to_int(s:str)->int:
    i=0;n=0
    while i<len(s):
        if i+1<len(s) and s[i:i+2] in _ROMAN:
            n+=_ROMAN[s[i:i+2]];i+=2
        else:
            n+=_ROMAN.get(s[i],0);i+=1
    return n
def _clean_page(tag:str,val:str)->str:
    val = re.sub(r'^[A-Za-z]+', '', val.strip())     # drop leading letters
    val = re.sub(r'[A-Za-z]+$', '', val)             # drop trailing letters
    parts = re.split(r'[,\u2013\u2014\-]+', val)     # split on comma/en-dash/dash
    nums  = [n for seg in parts for n in re.findall(r'\d+', seg)]
    if nums:
        return nums[0] if tag=="SP" else nums[-1]
    roman = re.sub(r'[^IVXLCDM]', '', val.upper())
    return str(_roman_to_int(roman)) if roman else ""
# ------------------------------------------------------------------ #
# 0-bis.  CITATION-PAIR HELPER                                       #
# ------------------------------------------------------------------ #
def _citation_pairs(rec: dict) -> list[tuple[int, str]]:
    """
    Return a list of (count, source) tuples such as
        [(51, 'heinonline'), (10, 'scholar'), …]

    • pulls counts from rec["extra"]["citations_<src>"]
    • filters out junk / non-ints
    • returns them sorted descending by count, then by src name
    """
    pairs: list[tuple[int, str]] = []

    for k, v in (rec.get("extra") or {}).items():
        if not k.startswith("citations_"):
            continue

        src = k[10:].replace("_results", "").lower()  # normalize
        try:
            pairs.append((int(v), src))
        except (TypeError, ValueError):
            continue                                  # silently ignore bad data

    # biggest → smallest, stable on src
    return sorted(pairs, key=lambda t: (-t[0], t[1]))


def _author_profiles(rec: dict) -> list[str]:
    urls = []
    for note in rec.get("notes", []):
        if "authorprofiles" in note.lower():
            urls.extend(_PROFILE_RE.findall(note))
    return _dedupe_preserve_order(urls)

# --- UTILITY FUNCTIONS ---
def ascii_fold(t: str) -> str:
    """Fold Unicode characters to their closest ASCII equivalent."""
    return unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()


def clean_text_for_comparison(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', s.lower())


def clean_title(t: str) -> str:
    """
    Cleans a title for fuzzy matching: lowercase, ASCII fold, remove stopwords,
    and non-alphanumeric characters. More aggressive than `clean_text_for_comparison`.
    """
    t = ascii_fold(t.lower())
    t = re.sub(r"[^a-z0-9]+", " ", t)  # Remove non-alphanumeric, replace with space
    # Remove stopwords, ensuring whole words are matched
    for sw in STOPWORDS:
        t = re.sub(rf"\b{sw}\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()  # Consolidate multiple spaces and strip


from urllib.parse import urlparse, urlunparse, ParseResult, urlencode, parse_qsl


def canonical_url(u: str) -> str:
    """
    Return a stable, comparison-friendly version of *u*.
    • HeinOnline links: keep the entire path *and* query string
      (they encode the page/collection there).
    • Everything else: strip trailing “/” and tracking fragments.
    """
    u = (u or "").strip()
    if not u:
        return u

    try:
        p = urlparse(u)
    except ValueError:
        return u          # malformed URL – leave untouched

    scheme = p.scheme.lower() or "https"
    netloc = p.netloc.lower()

    if netloc.endswith("heinonline.org"):
        # keep full path + query → identify the exact page
        return urlunparse(ParseResult(scheme, netloc, p.path.rstrip("/"),
                                      params="", query=p.query, fragment=""))
    q = parse_qsl(p.query, keep_blank_values=True)
    q = [(k, v) for k, v in q if not k.startswith("utm_") and k != "ref"]
    p = p._replace(query=urlencode(q))
    # generic rule for everything else

    return urlunparse(ParseResult(scheme, netloc, p.path.rstrip("/"), "", urlencode(q), ""))

def normalize_author_name(name: str) -> str:
    """
    Normalizes author names to a consistent format (e.g., 'Lastname, F. M.').
    Handles various input formats like "Last, First Middle", "First Middle Last",
    and initials.
    """
    name = ascii_fold(name).strip()
    if not name or name in {"...", ",", ";"}:
        return ""
    if not name:
        return ""

    if ',' in name:
        parts = [p.strip() for p in name.split(',', 1)]
        last_name = parts[0]
        # Handle cases like "Smith, J. A." or "Smith, John Adam"
        first_part_words = parts[1].split() if len(parts) > 1 else []
        initials = ''.join(w[0].upper() for w in first_part_words if w)
        return f"{last_name}, {initials}" if initials else last_name
    else:
        # Try to parse "First Middle Last"
        words = name.split()
        if len(words) >= 1:
            last_name = words[-1]
            first_initials = ''.join(w[0].upper() for w in words[:-1] if w)
            return f"{last_name}, {first_initials}" if first_initials else last_name
    return name  # Fallback if no clear format is found

RIS_LINE_RE = re.compile(r"""
    ^\s*                # optional leading white-space
    (?P<tag>[A-Z0-9]{2})# two-char RIS tag
    \s*-\s*             # any spaces, hyphen, any spaces
    (?P<value>.*)       # the payload
    """, re.IGNORECASE | re.VERBOSE)

def _split_ris_blocks(text: str) -> list[list[str]]:
    """Return a list of blocks (list-of-lines) split on `ER` terminators."""
    blocks, current = [], []
    for ln in text.splitlines():
        if ln.strip().upper().startswith("ER"):
            if current: blocks.append(current)
            current = []
        else:
            current.append(ln.rstrip("\n"))
    if current: blocks.append(current)
    return blocks

def _parse_block(lines: list[str]) -> dict[str, list[str]]:
    """Parse one RIS record from `lines`."""
    rec: dict[str, list[str]] = defaultdict(list)
    last_tag = None
    for ln in lines:
        m = RIS_LINE_RE.match(ln)
        if m:
            tag, val = m.group("tag").upper(), m.group("value").strip()
            rec[tag].append(val)
            last_tag = tag
        elif last_tag and ':' not in ln[:6]:  # continuation only if no new tag
            rec[last_tag][-1] += " " + ln.strip()
    return dict(rec)
# --------------------------------------------------------------------- #
# 2.  INPUT PARSERS                                                     #
# --------------------------------------------------------------------- #
def read_ris_simple(path: Path) -> list[dict[str, list[str]]]:
    """Read *.ris* file – tolerant to weird spacing."""
    raw = path.read_bytes()
    txt = raw.decode("utf-8", errors="ignore")
    return [ _parse_block(b) for b in _split_ris_blocks(txt) ]

def read_ris_string(text: str) -> list[dict[str, list[str]]]:
    """Same as `read_ris_simple` but from a raw string."""
    return [ _parse_block(b) for b in _split_ris_blocks(text) ]

import csv, io, re, pandas as pd
from typing import List

_AU_SPLIT_RE = re.compile(r"\s*(?:;| and )\s*")   # splits “A Author; B Author” etc.

def _safe(v: str) -> str:
    return str(v).strip()

def _push(lines: List[str], tag: str, value: str):
    if value:
        lines.append(f"{tag}  - {value}")


def convert_csv_to_ris(csv_txt: str) -> str:
    """
    Converts a Taylor & Francis–style CSV into a more complete RIS format,
    capturing article views and publication dates in the notes.
    """
    # This map defines the direct column-to-RIS tag translations
    csv_ris_map = {
        "articletitle": "TI",
        "authors": "AU",
        "journaltitle": "JF",
        "volume": "VL",
        "issue": "IS",
        "pages": "PG",  # Handled manually to split start/end pages
        "volumeyear": "PY",
        "doi": "DO",
        "url": "UR"
        # Note: 'abstract' is not in the source CSV and has been removed from the map.
    }

    # Use pandas to read the CSV data
    df = pd.read_csv(io.StringIO(csv_txt))
    # Clean column names for consistent matching (e.g., "Article title" -> "articletitle")
    df.columns = [re.sub(r'[^a-z0-9]', '', col.lower()) for col in df.columns]
    cleaned_map = {clean_text_for_comparison(k): v for k, v in csv_ris_map.items()}

    output_blocks = []
    for _, row in df.iterrows():
        ris_lines = ["TY  - JOUR"]
        notes = ["Source: Taylor and Francis CSV"]  # Start a list to hold notes

        # 1. Handle directly mapped fields
        for col_clean, tag in cleaned_map.items():
            if col_clean not in df.columns or pd.isna(row[col_clean]):
                continue

            value = str(row[col_clean]).strip()
            if not value:
                continue

            if tag == "AU":
                for author in re.split(r'[;,]', value):
                    if author.strip():
                        ris_lines.append(f"AU  - {normalize_author_name(author.strip())}")
            elif tag == "PG":
                # Split page ranges like "p123 - p456" into SP and EP tags
                parts = re.findall(r'\d+', value)
                if parts:
                    ris_lines.append(f"SP  - {parts[0]}")
                    if len(parts) > 1:
                        ris_lines.append(f"EP  - {parts[1]}")
            else:
                ris_lines.append(f"{tag}  - {value}")

        # 2. Handle fields that will be added to the notes
        if 'publishedonlinedate' in row and pd.notna(row['publishedonlinedate']):
            notes.append(f"Published Online: {row['publishedonlinedate']}")

        # Standardize access to citation and view columns
        citation_col = clean_text_for_comparison("Crossref citations (as of")
        views_col = clean_text_for_comparison("Article views (as of")

        if citation_col in row and pd.notna(row[citation_col]):
            ris_lines.append(f"CT  - {int(row[citation_col])}")

        if views_col in row and pd.notna(row[views_col]):
            notes.append(f"Article Views: {int(row[views_col])}")

        # 3. Write the collected notes to N1 tags
        for note in notes:
            ris_lines.append(f"N1  - {note}")

        ris_lines.append("ER  -")
        output_blocks.append("\n".join(ris_lines))

    return "\n\n".join(output_blocks)


def write_error_ris(bad_recs: List[dict], filename: str = "error_no_author.ris"):
    """Save records that lack an AU field so they can be fixed manually."""
    lines: List[str] = []
    for r in bad_recs:
        lines.append("TY  - GEN")
        if r.get("title"): lines.append(f"TI  - {r['title']}")
        if r.get("year"):  lines.append(f"PY  - {r['year']}")
        for u in r.get("urls", []): lines.append(f"UR  - {u}")
        lines.append("ER  -\n")
    if lines:
        Path(filename).write_text("\n".join(lines), "utf-8")




# --------------------------------------------------------------------- #
# 3.  NORMALISATION                                                     #
# --------------------------------------------------------------------- #
# ------------------------------------------------------------------ #
# 1.  Tighter identifier grabber – strips leading “DOI:” etc.        #
# ------------------------------------------------------------------ #
def extract_id(raw: Dict[str, List[str]]) -> Tuple[str | None, str | None]:
    """Return (“doi”, …) or (“isbn”, …) normalised; else (None, None)."""
    # ---- explicit DO / SN tags first --------------------------------
    if any(t in raw for t in ("DO", "do")):
        for tag in ("DO", "do"):
            if tag in raw and raw[tag]:
                m = DOI_RE.search(raw[tag][0])
                if m:
                    return "doi", m.group(0).lower().rstrip(".;")
        if raw[tag]:
            m = DOI_RE.search(raw[tag][0])
            if m:
                return "doi", m.group(0).lower().rstrip(".;")

    if "SN" in raw and raw["SN"]:
        sn_val = raw["SN"][0].strip()
        if ISBN13_RE.fullmatch(sn_val) or ISBN10_RE.fullmatch(sn_val):
            return "isbn", sn_val

    # ---- fallback: scan whole record --------------------------------
    flat = " ".join(itertools.chain.from_iterable(raw.values()))
    if (m := DOI_RE.search(flat)):
        return "doi", m.group(0).lower().rstrip(".;")
    if (m := ISBN13_RE.search(flat)):
        return "isbn", m.group(0)
    if (m := ISBN10_RE.search(flat)):
        return "isbn", m.group(0)
    return None, None


# --------------------------------------------------------------------- #
# 3-BIS.  REVISED NORMALISER                                            #
# --------------------------------------------------------------------- #
# ----------------------------------------------------------------------
# ------------------------------------------------------------------ #
# 3.  NORMALISER (fully revised)                                     #
# ------------------------------------------------------------------ #
def normalise(raw: dict[str, list[str]]) -> dict[str, any]:
    """
    Convert one raw RIS record into a tidy, comprehensive dict.
    """
    N: dict[str, any] = {"sources": raw.get("sources", []).copy()}

    if raw.get("TY"): N["type"] = raw["TY"][0].strip()
    for tag in ("TI", "T1", "TT"):
        if raw.get(tag) and raw[tag][0].strip():
            N["title"] = raw[tag][0].strip()
            break
    for tag in ("PY", "Y1"):
        if raw.get(tag):
            if m := re.search(r"(\d{4})", raw[tag][0]):
                N["year"] = m.group(1)
                break
    raw_names = itertools.chain.from_iterable(raw.get(t, []) for t in ("AU", "A1", "A2"))
    N["authors"] = [nm for nm in (normalize_author_name(a) for a in raw_names) if nm]

    for tag in ("JF", "JO", "T2"):
        if raw.get(tag):
            jf = raw[tag][0].strip()
            # Strip leading acronym/year slug before colon for proceedings
            if raw.get("TY", [""])[0] == "CPAPER" and ":" in jf and jf.lower().startswith(
                    ("sat-cps", "aamas", "acsac", "acsac", "acm", "ieee")):
                jf = jf.split(":", 1)[1].lstrip()
            # Kill embedded URLs
            if "http" in jf.lower(): jf = jf.split("http", 1)[0].rstrip(",; ")
            if jf: N["journal"] = jf
    if raw.get("VL"): N["volume"] = raw["VL"][0].strip()
    if raw.get("IS"): N["issue"] = raw["IS"][0].strip()
    if raw.get("SP"): N["sp"] = raw["SP"][0].split('-')[0].strip()
    if raw.get("EP"): N["ep"] = raw["EP"][0].split('-')[-1].strip()
    if raw.get("PG"):
        pages = raw["PG"][0].split('-')
        if not N.get("sp"): N["sp"] = pages[0].strip()
        if not N.get("ep") and len(pages) > 1: N["ep"] = pages[-1].strip()

    for tag in ("AB", "N2"):
        if raw.get(tag):
            txt = raw[tag][0].strip()
            if ABSTRACT_HEADER_RE.search(txt):
                N.setdefault("notes", []).append("venueInfo: " + txt)
            else:
                N["abstract"] = txt
            break

    for tag in ("PB", "PU", "DP"):
        if raw.get(tag): N["publisher"] = raw[tag][0].strip()
    for tag in ("CY", "PI", "PP"):
        if raw.get(tag): N["place"] = raw[tag][0].strip()
    if raw.get("C3"):
        N["conference_title"] = raw["C3"][0].strip()
    elif N.get("type") == "CPAPER":
        jf = N.get("journal", "").lower()
        if jf.startswith("proceedings of"):
            N["conference_title"] = re.sub(r"(?i)^proceedings of the?\s*", "", N["journal"]).strip()
        bad_c3 = N.get("conference_title", "").lower()
        if not re.search(r'(conference|workshop|symposium)', bad_c3):
            if jf.startswith("proceedings of"):
                N["conference_title"] = re.sub(r"(?i)^proceedings of the?\s*", "", N["journal"]).strip()
    else:
        conf_keywords = ['proceedings', 'conference', 'symposium', 'workshop']
        for tag in ('T2', 'BT', 'CT'):
            if raw.get(tag):
                val = raw[tag][0].strip()
                if any(kw in val.lower() for kw in conf_keywords):
                    N["conference_title"] = val
                    if N.get("journal") == val: N.pop("journal")
                    break
    N["affiliations"] = [v.strip() for t in ("AD",) for v in raw.get(t, []) if v.strip()]

    idt, idv = extract_id(raw)
    if idt: N[idt] = idv
    N["urls"] = _dedupe_preserve_order([canonical_url(u) for tag in ("UR", "L1", "L2", "L3", "L4") for u in raw.get(tag, []) if u.strip()])
    kws = [kw.strip() for kw in raw.get("KW", []) if kw.strip()]
    seen = set();
    dedup = []
    for kw in kws:
        k = re.sub(r'\W+', '', kw.lower())
        if k not in seen:
            seen.add(k);
            dedup.append(kw)
    N["keywords"] = dedup
    if raw.get("LA"): N["language"] = raw["LA"][0].strip()
    if raw.get("CT"):
        try: N["citations"] = int(re.match(r"(\d+)", raw["CT"][0]).group(1))
        except (AttributeError, ValueError): pass
    if N.get("type") == "RPRT" and N.get("isbn"):
        N["series"] = N.pop("isbn")  # temporary; writer will map → IS

    if N.get("type") == "THES" and re.match(r"proquest", N.get("publisher", ""), re.I):
        if N.get("affiliations"):
            uni = re.split(r",|;", N["affiliations"][0])[0].strip()
            if len(uni.split()) >= 2:  # avoid “Dept.” only strings
                N["publisher"] = uni
    if N.get("type") == "THES" and N.get("publisher", "").lower().startswith("proquest"):
        if N.get("affiliations"):
            maybe_uni = re.split(r'[;,]', N["affiliations"][0])[0].strip()
            if maybe_uni: N["publisher"] = maybe_uni

        # BOOK v CHAP heuristic
    if N.get("type") == "BOOK" and N.get("volume") and N.get("sp") and N.get("ep"):
        doi = N.get("doi", "")
        if re.search(r'(_\d+|/ch(apter)?/|\bchapter\b)', doi, re.I):
            N["type"] = "CHAP"
    return N

# ────────────────────────────────────────────────────────────────────
# 1.  ALIAS BUILDER  (Tier-1 deterministic matching)
# ────────────────────────────────────────────────────────────────────
# ───────────────────────── 1. record_aliases  ──────────────────────────
def record_aliases(rec: Dict) -> Set[str]:
    """
    Deterministic aliases used in Tier-1.

    • DOI  / ISBN  – strong, global identifiers
    • TITLE+YEAR  – only if *both* fields are present
    (No URL aliases – these were the cause of the HeinOnline bleed-through.)
    """
    out: Set[str] = set()

    if rec.get("doi"):
        out.add("doi:" + rec["doi"].lower())

    if rec.get("isbn"):
        out.add("isbn:" + rec["isbn"].lower())

    if rec.get("title") and rec.get("year"):
        out.add("ty:" + clean_title(rec["title"]) + "::" + rec["year"])

    return out

# --------------------------------------------------------------------- #
# 4.  PLUGGABLE SIMILARITY ENGINES                                      #
# --------------------------------------------------------------------- #
# ───────────────────────────────────────────────────────────────
# 2.  TITLE + YEAR RAPIDFUZZ ENGINE  (no URL plots_ts)
# ───────────────────────────────────────────────────────────────
from typing import List, Dict, Tuple
import itertools




from rapidfuzz import fuzz

# ─── helper (already exists in your code base) ──────────────────────────
def clean_title(t: str) -> str:
    """Lower-case, strip punctuation/whitespace – keep identical to the
    version you've been using elsewhere so hashes stay consistent."""
    return re.sub(r'\W+', ' ', t.lower()).strip()

# ─── the new engine itself ──────────────────────────────────────────────
def engine_title_only(records: List[Dict],
                      *,
                      title_threshold: float = 95.0) -> Tuple[
                          List[Dict],
                          Dict[int, List[int]],
                          Dict[int, int]]:
    """
    Group records whose *titles* match at ≥ `title_threshold`
    (RapidFuzz token_set_ratio).  Returns:
        unique_records, pk→indices map, idx→pk map
    """
    cleaned_titles = [clean_title(r.get("title", "")) for r in records]
    groups: List[List[int]] = []

    for i, t_i in enumerate(cleaned_titles):
        for g in groups:
            # compare against the first element of the group
            if (r_i := records[i]).get("year") and \
                    (r_j := records[g[0]]).get("year") and \
                    r_i["year"] == r_j["year"] and \
                    fuzz.token_set_ratio(t_i, cleaned_titles[g[0]]) >= title_threshold:
                g.append(i)
                break
        else:
            groups.append([i])

    unique_records = [records[g[0]] for g in groups]
    pk_map = {pk: idxs for pk, idxs in enumerate(groups)}
    idx2pk = {idx: pk for pk, idxs in pk_map.items() for idx in idxs}
    return unique_records, pk_map, idx2pk


def engine_recordlinkage(records: List[Dict]) -> List[Tuple[int, int]]:
    if rl is None:
        LOG.warning("recordlinkage not installed – falling back to rapidfuzz")
        return engine_rapidfuzz(records)

    # Create DataFrame with relevant columns for recordlinkage
    df = pd.DataFrame({
        "title": [clean_title(r.get("title", "")) for r in records],
        "year": [r.get("year", "") for r in records],
        "authors": [", ".join(r.get("authors", [])) for r in records],  # Combine authors to a string
        "doi": [r.get("doi", "") for r in records],
        "journal": [clean_text_for_comparison(r.get("journal", "")) for r in records],
        "abstract": [clean_text_for_comparison(r.get("abstract", "")) for r in records]  # Added abstract
    })

    # Improved blocking strategy: block on year AND first few chars of title OR DOI OR Journal
    indexer = rl.Index()
    indexer.block("year")
    indexer.block(on="title", start=0, end=4)  # Block on first 4 characters of title
    indexer.block("doi")  # Block on DOI as well
    indexer.block(on="journal", start=0, end=4)  # Block on first 4 characters of journal
    candidate_links = indexer.index(df)
    LOG.info(f"Recordlinkage generated {len(candidate_links)} candidate links after blocking.")

    comp = rl.Compare()
    comp.string("title", "title", method="jarowinkler", threshold=0.9, label="title_similarity")
    comp.exact("year", "year", label="year_exact")
    comp.string("authors", "authors", method="jarowinkler", threshold=0.8, label="author_similarity")
    comp.exact("doi", "doi", label="doi_exact")  # Exact match for DOI
    comp.string("journal", "journal", method="jarowinkler", threshold=0.8, label="journal_similarity")
    comp.string("abstract", "abstract", method="jarowinkler", threshold=0.7,
                label="abstract_similarity")  # Added abstract comparison

    features = comp.compute(candidate_links, df)
    LOG.info(f"Recordlinkage computed features for candidate links.")

    # Stronger matching criteria to reduce false positives:
    potential_matches = features[
        (features['doi_exact'] == 1) |  # Exact DOI match is a strong indicator
        (features['title_similarity'] >= 0.98) |  # Very high title similarity
        (
                (features['title_similarity'] >= 0.95) &  # High title similarity
                (features['author_similarity'] >= 0.85) &  # Very strong author agreement
                (features['year_exact'] == 1) &  # Exact year match
                (features['journal_similarity'] >= 0.85) &  # Strong journal agreement
                (features['abstract_similarity'] >= 0.75)  # Moderate abstract agreement
        )
        ]

    LOG.info(f"Recordlinkage identified {len(potential_matches)} potential matches.")
    return [(i, j) for i, j in potential_matches.index]


def engine_dedupe(records: List[Dict]) -> List[Tuple[int, int]]:
    if dedupe is None:
        LOG.warning("dedupe library not installed – falling back to rapidfuzz")
        return engine_rapidfuzz(records)

    # Prepare data for dedupe
    data = {i: {
        "title": clean_title(r.get("title", "")),
        "year": r.get("year", ""),
        "authors": ", ".join(r.get("authors", [])),  # dedupe prefers string for authors
        "doi": r.get("doi", ""),
        "journal": r.get("journal", ""),
        "abstract": clean_text_for_comparison(r.get("abstract", ""))
    } for i, r in enumerate(records)}

    # Define fields for dedupe.
    # 'String' for general text, 'Exact' for IDs, 'ShortString' for fields like year.
    fields = [
        {'field': 'title', 'type': 'String', 'has_missing': True},
        {'field': 'year', 'type': 'ShortString', 'has_missing': True},  # Year as short string
        {'field': 'authors', 'type': 'String', 'has_missing': True},
        {'field': 'doi', 'type': 'Exact', 'has_missing': True},
        {'field': 'journal', 'type': 'String', 'has_missing': True},
        {'field': 'abstract', 'type': 'Text', 'has_missing': True}  # Use 'Text' for longer fields
    ]

    deduper = dedupe.Dedupe(fields)

    # Sample data for training the dedupe model.
    # For automated scripts without human labeling, this is unsupervised.
    # The larger the sample, the better the model may learn patterns.
    deduper.sample(data, 15000)

    # Train the dedupe model. Without labeled data, it tries to learn from existing data patterns.
    deduper.train()

    # Determine a threshold for clustering.
    # `recall_weight=1.0` prioritizes finding all duplicates (high recall),
    # which might still lead to false positives if the learned model isn't perfect.
    # For higher precision (fewer false positives), you might lower `recall_weight`
    # or manually set a higher threshold after training and inspecting results.
    threshold = deduper.threshold(data, recall_weight=0.8)  # Adjusted for potentially higher precision
    LOG.info(f"dedupe learned threshold: {threshold}. Using this for clustering.")

    # Cluster the data based on the learned model and threshold
    clustered_dupes = deduper.cluster(data, threshold)

    idx_pairs = []
    for cluster_id, cluster in clustered_dupes:
        if len(cluster) > 1:
            # All items in a cluster are considered duplicates. Generate all pairs.
            for i, j in itertools.combinations(cluster, 2):
                idx_pairs.append((i, j))

    LOG.info(f"dedupe engine identified {len(idx_pairs)} duplicate pairs.")
    return idx_pairs


def engine_zotero(records: List[Dict]) -> List[Tuple[int, int]]:
    if zotero_dupes is None:
        LOG.warning("zotero-duplicates not installed – falling back to rapidfuzz")
        return engine_rapidfuzz(records)

    # Map your normalized records to Zotero-like items for the zotero-duplicates library.
    zrecs = []
    for r in records:
        zot_item = {
            "itemType": "journalArticle",  # Defaulting to journalArticle, as it's common
            "title": r.get("title", ""),
            "creators": [{"lastName": a.split(",")[0].strip(), "creatorType": "author"} for a in r.get("authors", []) if
                         a.strip()],
            "date": r.get("year", ""),
            "abstractNote": r.get("abstract", ""),
            "publicationTitle": r.get("journal", ""),
            "DOI": r.get("doi", ""),
            "url": r.get("urls", [])[0] if r.get("urls") else ""
        }
        zrecs.append(zot_item)

    LOG.info("Calling zotero-duplicates find_duplicates...")
    dupes = zotero_dupes.find_duplicates(zrecs)

    idx_pairs = []
    for cluster_id, cluster_indices in dupes.items():
        if len(cluster_indices) > 1:
            for i, j in itertools.combinations(cluster_indices, 2):
                idx_pairs.append((i, j))

    LOG.info(f"zotero-duplicates engine identified {len(idx_pairs)} duplicate pairs.")
    return idx_pairs
def engine_rapidfuzz(
    records: List[Dict],
    title_threshold: float = 95.0,
    year_tolerance: int = 1,
) -> List[Tuple[int, int]]:
    """
    Finds duplicate pairs based on DOI/ISBN or fuzzy title and year matching.
    - Limits title length for performance.
    - Safely handles year comparison.
    """
    import itertools

    # Limit title length to 255 chars to avoid performance issues
    ctitles = [clean_title(r.get("title", ""))[:255] for r in records]
    pairs: List[Tuple[int, int]] = []

    for i, j in itertools.combinations(range(len(records)), 2):
        a, b = records[i], records[j]

        # Tier 1: Exact identifier match
        if a.get("doi") and a.get("doi") == b.get("doi"):
            pairs.append((i, j)); continue
        if a.get("isbn") and a.get("isbn") == b.get("isbn"):
            pairs.append((i, j)); continue

        # Tier 2: Fuzzy title match
        if fuzz.token_set_ratio(ctitles[i], ctitles[j]) < title_threshold:
            continue

        # Tier 3: Year tolerance check
        y1, y2 = a.get("year"), b.get("year")
        if y1 and y2:
            try:
                if abs(int(y1) - int(y2)) > year_tolerance:
                    continue
            except (ValueError, TypeError):
                # Ignore if years are not valid integers
                pass

        # If all checks pass, consider it a match
        pairs.append((i, j))

    return pairs



ENGINE_MAP = {
    "rapidfuzz": engine_rapidfuzz,
    "recordlinkage": engine_recordlinkage,
    "dedupe": engine_dedupe,
    "zotero": engine_zotero,
    "title_only": engine_title_only  # ← NEW
}

# Ensure engines are only mapped if their libraries are available
if dedupe is None:
    ENGINE_MAP.pop("dedupe", None)
if rl is None:
    ENGINE_MAP.pop("recordlinkage", None)
if zotero_dupes is None:
    ENGINE_MAP.pop("zotero", None)


# Disjoint Set Union (DSU) structure for efficient cluster management
class DSU:
    def __init__(self, elements):
        self.parent = {elem: elem for elem in elements}
        self.rank = {elem: 0 for elem in elements}

    def find(self, elem):
        if self.parent[elem] == elem:
            return elem
        self.parent[elem] = self.find(self.parent[elem])  # Path compression
        return self.parent[elem]

    def union(self, elem1, elem2):
        root1 = self.find(elem1)
        root2 = self.find(elem2)
        if root1 != root2:
            # Union by rank to keep tree shallow
            if self.rank[root1] < self.rank[root2]:
                self.parent[root1] = root2
            elif self.rank[root1] > self.rank[root2]:
                self.parent[root2] = root1
            else:
                self.parent[root2] = root1
                self.rank[root1] += 1
            return True
        return False


# ────────────────────────────────────────────────────────────────────
# 3.  TWO-TIER DE-DUPLICATION  (only the alias logic changed)
# ────────────────────────────────────────────────────────────────────
def dedupe_records(records: List[Dict], engine: str = "rapidfuzz") \
        -> Tuple[List[Dict], Dict[str, List[int]], Dict[int, str]]:

    LOG.info("Starting Tier-1 (deterministic, per-source) …")
    master: Dict[str, Dict] = {}
    alias2pk: Dict[str, str] = {}
    orig2pk: Dict[int, str] = {}
    groups: Dict[str, List[int]] = defaultdict(list)
    pk_counter = itertools.count()

    for idx, rec in enumerate(records):
        hit_pk = None
        for al in record_aliases(rec):             # ← uses the NEW scoped aliases
            if al in alias2pk:
                hit_pk = alias2pk[al]
                break

        if hit_pk:
            merge_rec(master[hit_pk], rec)
            orig2pk[idx] = hit_pk
            groups[hit_pk].append(idx)
            for al in record_aliases(rec):
                alias2pk[al] = hit_pk
        else:
            pk = f"rec_{next(pk_counter)}"
            master[pk] = rec.copy()
            orig2pk[idx] = pk
            groups[pk].append(idx)
            for al in record_aliases(rec):
                alias2pk[al] = pk

    LOG.info(f"Tier-1 → {len(master)} distinct records after per-source collapse.")

    # ── Tier-2 : fuzzy cross-source merge via chosen engine ──────────
    pk_list = list(master.keys())
    cand_pairs = ENGINE_MAP[engine]([master[pk] for pk in pk_list])
    LOG.info(f"Tier-2 / {engine}: {len(cand_pairs)} candidate pairs.")

    dsu = DSU(pk_list)
    merged = 0
    for i, j in cand_pairs:
        if dsu.union(pk_list[i], pk_list[j]):
            merged += 1
    LOG.info(f"Tier-2 merged {merged} clusters.")

    # ── rebuild canonical masters ───────────────────────────────────
    final_master: Dict[str, Dict] = {}
    final_groups: Dict[str, List[int]] = defaultdict(list)
    final_orig2pk: Dict[int, str] = {}

    for orig_idx, pk0 in orig2pk.items():
        root = dsu.find(pk0)
        if root not in final_master:
            final_master[root] = master[pk0].copy()
        elif root != pk0:
            merge_rec(final_master[root], master[pk0])
        final_orig2pk[orig_idx] = root
        final_groups[root].append(orig_idx)

    LOG.info(f"Final total unique records: {len(final_master)}")
    return (list(final_master.values()),
            final_groups,
            final_orig2pk)

# --------------------------------------------------------------------- #
# 6.  HIGH-LEVEL PIPELINE                                               #
# --------------------------------------------------------------------- #
# ────────────────────────────────────────────────────────────────────

from collections import Counter, defaultdict
from typing import List

# Ensure read_ris_string is available for parsing RIS from text
# from your RIS utilities import read_ris_simple, read_ris_string, dedupe_records, normalise, engine_rapidfuzz
# ── keyword filter helper ──────────────────────────────
def _text_for_kw(rec: dict) -> str:
    # guarantee we concatenate only strings
    return f"{rec.get('title') or ''} {rec.get('abstract') or ''}".lower()
def engine_rapidfuzz(
    records: List[Dict],
    title_threshold: float = 95.0,
    year_tolerance: int = 1,
) -> List[Tuple[int, int]]:
    """
    Only matches when:
      • token_set_ratio(clean_title) ≥ title_threshold
      • |year1 – year2| ≤ year_tolerance  (if both years present)
      • OR exact DOI/ISBN
    """
    import itertools

    ctitles = [clean_title(r.get("title", ""))[:255] for r in records]
    pairs: List[Tuple[int, int]] = []

    for i, j in itertools.combinations(range(len(records)), 2):
        a, b = records[i], records[j]

        # exact DOI/ISBN
        if a.get("doi") and a["doi"] == b.get("doi"):
            pairs.append((i, j)); continue
        if a.get("isbn") and a["isbn"] == b.get("isbn"):
            pairs.append((i, j)); continue

        # title similarity
        score = fuzz.token_set_ratio(ctitles[i], ctitles[j])
        if score < title_threshold:
            continue

        # year tolerance
        y1, y2 = a.get("year"), b.get("year")
        if y1 and y2:
            try:
                if abs(int(y1) - int(y2)) > year_tolerance:
                    continue
            except ValueError:
                pass

        # passed all hard plots_ts
        pairs.append((i, j))

    return pairs


# ──────────────────────── 4. MERGE HELPER ────────────────────────────
def merge_rec(base: dict[str, any], new: dict[str, any]) -> None:
    """
    Optimized in-place merge of two normalized records.
    """
    for k, v in new.items():
        if not v:
            continue

        if k in ("sources", "keywords", "urls", "authors", "notes", "affiliations"):
            base_list = base.setdefault(k, [])
            seen = set(base_list)
            items_to_add = v if isinstance(v, list) else [v]
            for item in items_to_add:
                if item and item not in seen:
                    base_list.append(item)
                    seen.add(item)

        elif k == "abstract":
            def looks_good(t):
                return t and len(t.split()) > 30 and not ABSTRACT_HEADER_RE.search(t)

            if looks_good(v) and not looks_good(base.get(k)):
                base[k] = v
            elif not looks_good(base.get(k)) or (looks_good(v) and len(v) > len(base.get(k, ""))):
                base[k] = v

        elif k == "extra":
            base.setdefault("extra", {})
            for tag, val in v.items():
                if tag not in base["extra"] or (
                        isinstance(val, str) and len(val) > len(str(base["extra"].get(tag, "")))):
                    base["extra"][tag] = val

        elif isinstance(v, list):
            base.setdefault(k, [])
            seen = set(base[k])
            for x in v:
                if x and x not in seen:
                    base[k].append(x)
                    seen.add(x)
        else:
            if k not in base or (isinstance(v, str) and isinstance(base.get(k), str) and len(v) > len(base.get(k, ""))):
                base[k] = v
# ── tiny helpers ───────────────────────────────────────────
from textwrap import shorten

def _dedupe_preserve_order(seq):
    seen = set()
    out  = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out

def _clip(txt, width=240):
    """UTF-8 safe, adds an ellipsis only if clipped."""
    return shorten(txt, width=width, placeholder="…")


def _promote_from_extra(rec: dict, key_map: dict[str, str]) -> None:
    """
    If `rec["extra"]` contains a human-readable field that Zotero already
    has a proper slot for, copy it there **iff** the slot is empty,
    then remove it from 'extra'.
    """
    if not rec.get("extra"):
        pass

    for human_key, zot_key in key_map.items():
        if human_key in rec["extra"] and not rec.get(zot_key):
            rec[zot_key] = rec["extra"].pop(human_key)


def _build_note(rec: dict[str, any]) -> str:
    """
    Builds an HTML note from a record according to the specified template.
    """

    def build_list(items: list) -> str:
        if not items: return ""
        return f"<ul>{''.join(f'<li>{item}</li>' for item in items if item)}</ul>"

    title = rec.get('title', 'Attribution details')
    citations = {
        "Google Scholar": [rec.get("citations")] if rec.get("citations") else [],
        "ProQuest": [rec.get("extra", {}).get("citations_proquest")] if rec.get("extra", {}).get(
            "citations_proquest") else [],
    }
    affiliations = {
        "Place": [rec.get("place")] if rec.get("place") else [],
        "Country": [],
        "Affiliations": rec.get("affiliations", [])
    }
    urls = {
        "PDF / Primary Link": [rec.get("urls", [])[0]] if len(rec.get("urls", [])) > 0 else [],
        "Related Work": rec.get("urls", [])[1:] if len(rec.get("urls", [])) > 1 else [],
        "Author Profiles": []
    }
    metadata = {
        "Publication": [rec.get("journal") or rec.get("conference_title")],
        "Publisher": [rec.get("publisher")],
        "Source(s)": rec.get("sources", [])
    }

    blocks = [f"<h2>{title}</h2>"]

    def build_category(name: str, data: dict) -> list[str]:
        category_blocks = []
        for key, values in data.items():
            if values:
                list_html = build_list(values)
                if list_html:
                    category_blocks.append(f"<h4>{key}</h4>{list_html}")
        if category_blocks:
            return [f"<h3>{name}</h3>"] + category_blocks
        return []

    blocks.extend(build_category("Citations", citations))
    blocks.extend(build_category("Affiliations", affiliations))
    blocks.extend(build_category("URLs", urls))
    blocks.extend(build_category("Metadata", metadata))

    return "\n".join(blocks).strip()
    # ──────────────────────── 5. SUMMARY & PIPELINE ──────────────────────

def compute_file_metrics(
    path: str,
    engine: str,
    rapidfuzz_title_threshold: float,
    language: str,
) -> dict:
    """
    Runs exactly the same pipeline as summarize_and_merge
    but only on a single file, and returns a dict of counts:
      {
        "raw": int,
        "duplicates_removed": int,
        "language_removed": int,
        "keyword_removed": int,
        "no_author": int,
        "final": int
      }
    """
    from pathlib import Path


    # 1) load
    tag = Path(path).stem.replace(" results", "").replace(" search results", "")
    if path.lower().endswith(".csv"):
        rows = read_ris_string(convert_csv_to_ris(Path(path).read_text("utf-8")))
    else:
        rows = read_ris_simple(Path(path))
    raw_count = len(rows)

    # 2) normalise & dedupe
    norm = [normalise(r) for r in rows]
    masters, groups, idx2pk = dedupe_records(norm, engine=engine)
    # count duplicates = raw_count - number of masters
    duplicates_removed = raw_count - len(masters)

    # 3) rebuild enriched + filter language + filter keywords + authors
    enriched = []
    for pk, idxs in groups.items():
        pivot_idx = max(idxs, key=lambda i: len(norm[i].get("abstract","")))
        pivot = norm[pivot_idx].copy()
        for i in idxs:
            if i != pivot_idx:
                merge_rec(pivot, norm[i])
        pivot["member_idx"] = idxs
        enriched.append(pivot)
    # code for replacement
    from langdetect import detect
    def _is_english(rec):
        tag = str(rec.get("language", "")).lower()
        if tag:
            return tag == language.lower()
        title = rec.get("title", "")
        if not title.strip():
            return False
        try:
            return detect(title) == "en"
        except Exception:
            return False

    lang_ok = [r for r in enriched if _is_english(r)]
    language_removed = len(enriched) - len(lang_ok)

    # keyword and author filters are disabled
    keyword_removed = 0
    no_author = 0
    final = len(lang_ok)

    return {
        "raw": raw_count,
        "duplicates_removed": duplicates_removed,
        "language_removed": language_removed,
        "keyword_removed": keyword_removed,
        "no_author": no_author,
        "final": final
    }

def summarize_and_merge(
    paths: list[str],
    engine: str = "rapidfuzz",
    rapidfuzz_title_threshold: float = 95.0,
    language: str = "English",
    crossref: bool = True

) -> None:
    """
    Final, end-to-end merge pipeline with the most robust filters and
    comprehensive Zotero tag mirroring.
    """
    stats = defaultdict(lambda: Counter({
        "raw": 0,
        "duplicates_removed": 0,
        "language_removed": 0,
        "keyword_removed": 0,
        "no_author_removed": 0,
        "final": 0
    }))
    raw_records: list[dict] = []
    record_file_tag: list[str] = []

    # --- load & tag raw records -------------------------------------
    for p in paths:
        tag = Path(p).stem.replace(" results", "").replace(" search results", "")
        if p.lower().endswith(".csv"):
            text = Path(p).read_text("utf-8")
            rows = read_ris_string(convert_csv_to_ris(text))
        else:
            rows = read_ris_simple(Path(p))
        for r in rows:
            r.setdefault("sources", []).append(tag)
            raw_records.append(r)
            record_file_tag.append(tag)
            stats[tag]["raw"] += 1

    # --- normalize & dedupe ------------------------------------------
    norm = [normalise(r) for r in raw_records]
    masters, groups, idx2pk = dedupe_records(norm, engine=engine)

    # record duplicates per source
    for idxs in groups.values():
        for dup_idx in idxs[1:]:
            stats[record_file_tag[dup_idx]]["duplicates_removed"] += 1

    # --- enrich merged records ---------------------------------------
    enriched = []
    for pk, idxs in groups.items():
        pivot_idx = max(idxs, key=lambda i: len(norm[i].get("abstract", "")))
        pivot = norm[pivot_idx].copy()
        for i in idxs:
            if i != pivot_idx:
                merge_rec(pivot, norm[i])
        pivot["member_idx"] = idxs
        enriched.append(pivot)

    # --- language filter ---------------------------------------------
    from langdetect import detect
    def _is_english(rec):
        tag = str(rec.get("language", "")).lower()
        if tag:
            return tag == language.lower()
        title = rec.get("title", "")
        if not title.strip():
            return False
        try:
            return detect(title) == "en"
        except Exception:
            return False

    lang_ok = [r for r in enriched if _is_english(rec=r)]
    lang_removed_recs = [r for r in enriched if not _is_english(rec=r)]
    for rec in lang_removed_recs:
        for idx in rec["member_idx"]:
            stats[record_file_tag[idx]]["language_removed"] += 1

    final = lang_ok
    good = final

    # --- count final kept --------------------------------------------
    for rec in good:
        for idx in rec["member_idx"]:
            stats[record_file_tag[idx]]["final"] += 1




    if  crossref:
        LOG.info("Enriching missing DOIs via Crossref …")
        missing = [rec for rec in good if not rec.get("doi")]
        for rec in tqdm(missing, desc="Crossref look-ups", unit="rec"):
            title = rec.get("title", "")
            year = rec.get("year")
            auth0 = rec["authors"][0] if rec.get("authors") else None
            # if we have a year, query by title+year only; otherwise include author
            meta = fetch_crossref_meta(
                title,
                year,
                None if year else auth0
            )
            doi = (meta.get("DOI") or "").lower() or None
            print(f"[Crossref] {doi or '—'} | {meta.get('publisher', '?')} "
                  f"← {title[:80]}")
            # always record DOI (even if None)
            rec["doi"] = doi
            # enrich other fields when missing
            if meta.get("publisher") and not rec.get("publisher"):
                rec["publisher"] = meta["publisher"]
            if meta.get("container-title") and not rec.get("journal"):
                rec["journal"] = meta["container-title"][0]
            if meta.get("ISSN") and not rec.get("issn"):
                rec["issn"] = meta["ISSN"][0]
            time.sleep(1.05)
    ris_lines: list[str] = []
    zot_items: list[dict] = []
    # maps RIS TY → Zotero itemType
    _ZOT_TYPE = {
        "JOUR": "journalArticle",
        "CHAP": "bookSection",
        "CPAPER": "conferencePaper",
        "BOOK": "book",
        "THES": "thesis",
        "RPRT": "report",
    }

    def _ris_type(z):
        return {"journalArticle": "JOUR", "bookSection": "CHAP",
                "conferencePaper": "CPAPER", "book": "BOOK",
                "thesis": "THES", "report": "RPRT"}.get(z, "GEN")

    def _zot_authors(names):
        out = []
        for n in names:
            if "," in n:
                last, giv = [p.strip() for p in n.split(",", 1)]
            else:
                *giv, last = n.split();
                giv = " ".join(giv)
            out.append({"creatorType": "author",
                        "firstName": giv, "lastName": last})
        return out

    for r in good:
        # ---------- Zotero-JSON item -----------------------------------------
        ztype = _ZOT_TYPE.get(r.get("type", "JOUR"), "document")
        zitem = {
            "itemType": ztype,
            "title": r.get("title", ""),
            "creators": _zot_authors(r.get("authors", [])),
            "date": r.get("year", ""),
            "publicationTitle": r.get("journal") or r.get("conference_title", ""),
            "publisher": r.get("publisher", ""),
            "volume": r.get("volume", ""),
            "issue": r.get("issue", ""),
            "pages": "–".join(p for p in (r.get("sp"), r.get("ep")) if p),
            "DOI": r.get("doi", ""),
            "ISBN": r.get("isbn", ""),
            "ISSN": r.get("issn", ""),
            "url": r["urls"][0] if r.get("urls") else "",
            "abstractNote": r.get("abstract", ""),
            "language": r.get("language", ""),
            "tags": [{"tag": kw} for kw in r.get("keywords", [])],
            "extra": f"source: {'; '.join(r.get('sources', []))}",
            "note": _build_note(r)  # HTML note
        }
        # prune empties
        zot_items.append({k: v for k, v in zitem.items() if v not in ("", [], None)})

        # ---------- RIS counterpart (unchanged) ------------------------------
        _write_ris_field(ris_lines, "TY", r.get("type", "JOUR"))
        _write_ris_field(ris_lines, "TI", r.get("title"))

        if r.get("authors"):
            for au in _dedupe_preserve_order(r.get("authors", [])):
                _write_ris_field(ris_lines, "AU", au)

        if r.get("affiliations"):
            for aff in _dedupe_preserve_order(r.get("affiliations", [])):
                _write_ris_field(ris_lines, "AD", aff)
                _write_ris_field(ris_lines, "RP", aff)

        _write_ris_field(ris_lines, "PY", r.get("year"))
        _write_ris_field(ris_lines, "VL", r.get("volume"))
        _write_ris_field(ris_lines, "IS", r.get("issue"))
        _write_ris_field(ris_lines, "SP", _clean_page("SP", r.get("sp", "")))
        _write_ris_field(ris_lines, "EP", _clean_page("EP", r.get("ep", "")))

        journal = r.get("journal")
        if journal:
            clean_journal = re.sub(r'[\*\s\u00A0\u2013\u2014-]+', '', journal).lower()
            if clean_journal not in {'new', 'suppl.new'}:
                _write_ris_field(ris_lines, "JF", journal)

        _write_ris_field(ris_lines, "PB", r.get("publisher"))
        _write_ris_field(ris_lines, "CY", r.get("place"))

        if r.get("type") == "CPAPER":
            c3 = r.get("conference_title") or ""
            if not re.search(r'conference|workshop|symposium', c3, re.I):
                c3 = "Unknown conference"
            _write_ris_field(ris_lines, "C3", c3)

        _write_ris_field(ris_lines, "DO", r.get("doi"))

        for aff in r.get("affiliations", []):
            _write_ris_field(ris_lines, "AD", aff)
        for rp in r.get("rp_affiliations", []):
            _write_ris_field(ris_lines, "RP", rp)

        for country in r.get("country", []):
            _write_ris_field(ris_lines, "CY", country)

        if r.get("type") != "RPRT":
            _write_ris_field(ris_lines, "SN", r.get("issn") or r.get("isbn"))

        _write_ris_field(ris_lines, "AB", r.get("abstract"))

        if r.get("keywords"):
            for kw in _trimmed_set(r["keywords"]):
                _write_ris_field(ris_lines, "KW", kw)

        _write_ris_field(ris_lines, "N1", _build_note(r))

        if r.get("urls"):
            urls_to_write = _dedupe_preserve_order(r["urls"])
            if urls_to_write:
                _write_ris_field(ris_lines, "UR", urls_to_write[0])
            if len(urls_to_write) > 1:
                _write_ris_field(ris_lines, "L1", urls_to_write[1])
            if len(urls_to_write) > 2:
                for url in urls_to_write[2:]:
                    _write_ris_field(ris_lines, "M3", f"Related: {url}")

        ris_lines.append("ER  -\n")

    # -------- summary note (HTML) added to Zotero-JSON only ------------------
    rows = [
        f"<tr><td>{tag}</td><td>{c['raw']}</td><td>{c['duplicates_removed']}</td>"
        f"<td>{c['language_removed']}</td><td>{c['final']}</td></tr>"
        for tag, c in sorted(stats.items())
    ]
    summary_html = f"""
    <h2>Merge Summary</h2>
    <table><thead><tr><th>DB</th><th>Raw</th><th>Dup</th>
    <th>Lang-rm</th><th>Final</th></tr></thead>
    <tbody>{''.join(rows)}</tbody></table>
    <ul>
      <li>Raw: {len(raw_records)}</li>
      <li>Dup removed: {sum(len(g) - 1 for g in groups.values())}</li>
      <li>Lang removed: {len(lang_removed_recs)}</li>
      <li>Final: {len(good)}</li>
    </ul>""".strip()

    zot_items.append({
        "itemType": "note",
        "title": "Merge Summary",
        "note": summary_html
    })

    # -------- write both files ----------------------------------------------
    (OUTPUT_DIR / "research_attribution.ris").write_text(
        "\n".join(ris_lines), encoding="utf-8"
    )
    (OUTPUT_DIR / "research_attribution_zotero.json").write_text(
        json.dumps(zot_items, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (OUTPUT_DIR / "research_attribution_csl.json").write_text(
        json.dumps(zot_items, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Exported RIS + JSON files to {OUTPUT_DIR}")

    lang_removed_recs = [r for r in enriched if r not in lang_ok]
    _quick_ris(lang_removed_recs, "non_english.ris")  # all filtered-out languages
    _quick_ris([norm[i] for pk, idxs in groups.items() for i in idxs[1:]],
               "duplicates_removed.ris")

    # --- print per-file breakdown -------------------------------------
    print("\nPer-file breakdown:")
    print(f"{'File':40s} | {'Raw':>4} | {'Dup':>4} | {'Lang':>4} | {'Final':>5}")
    print("-" * 66)
    for tag, c in sorted(stats.items()):
        print(f"{tag:40s} | {c['raw']:4d} | {c['duplicates_removed']:4d} | "
              f"{c['language_removed']:4d} | {c['final']:5d}")
    print("-" * 86)

    # --- print overall summary ----------------------------------------
    print(f"  Raw records ............ {len(raw_records)}")
    print(f"  Duplicates removed ..... {sum(len(idxs) - 1 for idxs in groups.values())}")
    print(f"  Language removed ....... {len(lang_removed_recs)}")
    print(f"  Final records .......... {len(good)}")


def _write_ris_field(lines: list[str], tag: str, value: any):
    """
    Appends a field to the RIS lines list, correctly handling
    multi-line values with the required two-space indent.
    """
    # Ignore empty or whitespace-only values
    if not value or not str(value).strip():
        return

    val_str = str(value).strip()
    # Split the value by lines and join with the RIS continuation format
    # The first line is handled by the initial tag, subsequent lines are indented.
    formatted_val = val_str.replace('\n', '\n  ')
    lines.append(f"{tag}  - {formatted_val}")
def _trimmed_set(seq: list[str]) -> list[str]:
    seen, out = set(), []
    for x in seq:
        k = x.strip().lower()
        if k not in seen:
            seen.add(k)
            out.append(x.strip())
    return out
# ──────────────────────── helper: quick RIS dump ─────────────────────
def _quick_ris(recs: List[Dict], fn: str) -> None:
    """
    Tiny RIS dump for removed records – AU / TI / JF / PY + first URL/abstract.
    """
    if not recs: return

    blocks: List[str] = []
    for r in recs:
        blk: List[str] = ["TY  - JOUR"]
        for a in r.get("authors", []):
            blk.append(f"AU  - {a}")
        if r.get("title"):
            blk.append(f"TI  - {r['title']}")

        jf = r.get("journal", "")
        if jf and "http" in jf.lower():
            jf = jf.split("http", 1)[0].rstrip(",; ")
        if jf:
            blk.append(f"JF  - {jf}")

        if r.get("year"):
            blk.append(f"PY  - {r['year']}")
        if r.get("abstract"):
            blk.append(f"AB  - {_clip(r['abstract'], width=120)}")
        if r.get("urls"):
            blk.append(f"UR  - {r['urls'][0]}")
        blk.append("ER  -")
        blocks.append("\n".join(blk))

    Path(fn).write_text("\n\n".join(blocks), encoding="utf-8")
    print(f"{fn} written.")

#
if __name__ == "__main__":
    # Configure logging for better visibility
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

    ap = argparse.ArgumentParser(
        description="Merge and de-duplicate bibliographic records from RIS/CSV files."
    )
    ap = argparse.ArgumentParser(
        description="Merge and de-duplicate bibliographic records from RIS/CSV files."
    )
    ap.add_argument("--language", default="English",
                    help=("Keep only records whose LA tag matches the given value "
                          "(case-insensitive). Records with no LA tag are kept."))

    ap.add_argument("--engine", choices=list(ENGINE_MAP.keys()), default="rapidfuzz",
                    help=("Deduplication engine to use (default: rapidfuzz). "
                          f"Available: {', '.join(ENGINE_MAP.keys())}"))

    ap.add_argument("--files", nargs="+", default=[],
                    help="List of RIS or CSV files to process.")



    ap.add_argument("--rapidfuzz-title-threshold", type=float, default=97.0,
                    help="Threshold for title token_set_ratio (0–100).")

    ap.add_argument("--rapidfuzz-author-bonus", type=float, default=0.9,
                    help=("Proportion of shared surnames that helps a match; "
                          "never blocks. Maps to `author_bonus` in engine_rapidfuzz."))

    ap.add_argument("--rapidfuzz-journal-threshold", type=float, default=95.0,
                    help="Threshold for journal token_set_ratio (0–100).")
    ap.add_argument("--crossref", action="store_true", default=True,
                                     help = "[default ON] Query Crossref for missing DOIs (slow, ~1 s per record)")


    args = ap.parse_args()

    # Default files and exclude keywords if not provided via command line
    DB_FILES = args.files if args.files else [
        r"C:\Users\luano\PycharmProjects\Back_end_assis\Batching_files\Data_collection_automation\input_ris_data\heinonline_results.ris",
        r"C:\Users\luano\PycharmProjects\Back_end_assis\Batching_files\Data_collection_automation\input_ris_data\SSRN_database_results.ris",
        r"C:\Users\luano\PycharmProjects\Back_end_assis\Batching_files\Data_collection_automation\input_ris_data\Naval_war_results.ris",
        r"C:\Users\luano\PycharmProjects\Back_end_assis\Batching_files\Data_collection_automation\input_ris_data\cambridge_results.ris",
        r"C:\Users\luano\PycharmProjects\Back_end_assis\Batching_files\Data_collection_automation\input_ris_data\ProQuest_results.ris",
        r"C:\Users\luano\PycharmProjects\Back_end_assis\Batching_files\Data_collection_automation\input_ris_data\WoS_results.ris",
        r"C:\Users\luano\PycharmProjects\Back_end_assis\Batching_files\Data_collection_automation\input_ris_data\scholar_results.ris",
        r"C:\Users\luano\PycharmProjects\Back_end_assis\Batching_files\Data_collection_automation\input_ris_data\Taylor and Francis.results.csv"
    ]


        # Ensure the selected engine is actually available
    if args.engine not in ENGINE_MAP:
        LOG.error(
            f"Selected engine '{args.engine}' is not available. Please install the necessary library or choose from: {', '.join(ENGINE_MAP.keys())}"
        )
        exit(1)

    summarize_and_merge(
        DB_FILES,
        crossref=args.crossref,
        engine=args.engine,

        rapidfuzz_title_threshold=args.rapidfuzz_title_threshold,
        # rapidfuzz_author_bonus=args.rapidfuzz_author_bonus,  # ← new name
        # rapidfuzz_journal_threshold=args.rapidfuzz_journal_threshold,  # remove if unused
        language=args.language,
    )

# print(
#     fetch_crossref_meta(title="Sexual conflict in humans: evolutionary consequences of asymmetric parental investment and paternity uncertainty",
#                        year = "2009",
#                        # author  = "O'Connell, ME"
#                         )
# )
"""  Raw records ............ 2639
  Duplicates removed ..... 966
  Language removed ....... 0
  Keyword removed ........ 42
  No-author removed ...... 19
  Final records .......... 1612"""