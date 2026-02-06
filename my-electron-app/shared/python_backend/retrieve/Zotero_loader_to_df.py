from typing import Mapping, Sequence, Callable, Set

from python_backend.core.utils.calling_models import *

from datetime import datetime
import datetime
from dateutil import parser as dateutil_parser
from bibliometric_analysis_tool.utils.zotero_class import Zotero

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
from general.app_constants import CORE_COLUMNS, CODEBOOKS, ZOTERO_DF_CACHE_DIR


import pandas as pd
from dotenv import load_dotenv

load_dotenv()  # loads the variables from .env
import os
global count

mistral_key= os.environ.get("MISTRAL_API_KEY")

# CACHE_DIR = Path.home()/".zotkw_phrase_cache"
# CACHE_DIR.mkdir(exist_ok=True)


import subprocess


import json

import random
import tempfile



from typing import  Tuple
from urllib.parse import urlparse

import hashlib

import re, html
from pathlib import Path
from typing import List, Dict, Optional, Any

from dotenv import load_dotenv

# Ensure environment variables are loaded (e.g., from a .env file)
load_dotenv()


from dotenv import load_dotenv

import fitz  # PyMuPDF

load_dotenv()  # loads the variables from .env
import os


api_key = os.getenv("MISTRAL_API_KEY", "")

CACHE_DIR = Path.home() / ".zotkw_phrase_cache"
CACHE_DIR.mkdir(exist_ok=True)

# --- PyMuPDF Configuration ---

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

def _exponential_backoff(retries: int = 5, base: float = 1.5, jitter: float = 0.3):
    """Yield sleep times for exponential back-off."""
    for n in range(retries):
        yield (base ** n) + random.uniform(0, jitter)



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


def _cache_path(pdf_path: str) -> str:
    """Return a deterministic cache filename based on *file contents* SHA‑256."""
    h = hashlib.sha256()
    with open(pdf_path, "rb") as fh:
        while chunk := fh.read(1 << 20):  # 1 MiB chunks
            h.update(chunk)
    return os.path.join(CACHE_DIR, f"{h.hexdigest()}.md")

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
    secs,toc="",""
    # if clean_academic_references:
    #     md = clean_academic_text(md_text)
    # Build (level, title) tuples from real hash-headed markdown lines.
    _MD_HEAD = re.compile(r'^\s*(#{1,6})\s+(?P<title>.+?)\s*$')

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
    # print("log")
    # print(log)
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

    print(f"[LOG] Raw parse created {len(raw_secs)} top-level sections. Cleaning...")


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

    print(f"[LOG] After cleaning, {len(cleaned_sections)} legitimate sections remain.\n")
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





_LATEX_TOKEN = re.compile(
    r"\$\s*\{\s*\}\s*\^\{\s*\d{1,4}\s*\}\s*\$|\^\{\s*\d{1,4}\s*\}",
    re.UNICODE
)

_HEADING_LINE_RE = re.compile(r"^\s*#{1,6}\s+.*$", re.M)

HEADING_RE = re.compile(r"^\s*(#{1,6})\s+(.*)$")


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

def _extract_first_json_object(raw: str) -> str | None:
    """
    ###1. find first top-level JSON object in a possibly noisy file
    """
    start = raw.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    i = start
    length = len(raw)
    while i < length:
        ch = raw[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
        else:
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return raw[start : i + 1]
        i += 1
    return None
def _load_pdf_cache_data(pdf_path: str) -> dict | None:
    """
    ###1. read cache file and parse first JSON object only
    """
    from pathlib import Path as _Path
    import json as _json

    f = _Path(_cache_path(pdf_path))
    if not (f.is_file() and f.stat().st_size > 0):
        return None
    raw = f.read_text(encoding="utf-8")
    if not raw:
        return None
    clipped = _extract_first_json_object(raw)
    if not clipped:
        return None
    obj = _json.loads(clipped)
    return obj if isinstance(obj, dict) else None


def _save_pdf_cache_data(pdf_path: str, data: dict) -> None:
    """
    ###1. atomically write cache JSON
    """
    from pathlib import Path as _Path
    import json as _json, os as _os

    cache_file = _Path(_cache_path(pdf_path))
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache_file.with_suffix(cache_file.suffix + ".tmp")
    txt = _json.dumps(data, ensure_ascii=False, indent=2)
    tmp.write_text(txt, encoding="utf-8")
    from threading import Lock
    _cache_lock = Lock()
    with _cache_lock:
        _os.replace(str(tmp), str(cache_file))

def find_text_page_and_section(
    pdf_path: str,
    *,
    text: str,
    page: bool = True,
    section: bool = True,
    cache: bool = True,
    cache_full: bool = True,
    case_sensitive: bool = False,
) -> dict:
    """
    Locate an excerpt `text` in a PDF and return:
      {
        "page": int|None,
        "section_title": str|None,
        "section_text": str|None,   # HTML (no markdown), highlight via <mark>
        "citations": dict|None,     # whole citations object from process_pdf cache
        "references": list|str|None # whole references value from process_pdf cache
      }

    Paging source of truth:
      - Use the OCR-per-page JSON produced by the Mistral cache (annotarium/cache/mistral/files/<sha>.json).
      - Page numbers come from the per-page "index" ordering; returned page is 1-based (index 0 => page 1).

    Sectioning source:
      - Prefer cached `sections` from process_pdf cache (same cache file used by _load_pdf_cache_data/_cache_path).
      - Return HTML (markdown rendered) with <mark> highlight.
    """
    import os
    import re
    import json
    import hashlib
    from pathlib import Path
    from html import unescape, escape
    import markdown

    QUOTE_CACHE_VERSION = 3

    def _norm(s: str) -> str:
        s = unescape(s or "")
        if not case_sensitive:
            s = s.lower()
        s = s.replace("\u00ad", "")
        s = s.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
        s = re.sub(r"\s+", " ", s)
        return s.strip()

    def _build_search_variants(src_text: str, max_variants: int = 7) -> list[str]:
        base = (src_text or "").strip()
        variants: list[str] = []

        def _add(v: str) -> None:
            n = _norm(v)
            if n and n not in variants:
                variants.append(n)

        if base:
            _add(base)
            _add(base.strip(".,;:-–— "))
            relaxed = re.sub(r"[^\w\s]", " ", base)
            _add(relaxed)

            words = re.findall(r"\w+", base)
            if words:
                if len(words) <= 6:
                    _add(" ".join(words))
                else:
                    _add(" ".join(words[:6]))
                    _add(" ".join(words[-6:]))
                    mid = len(words) // 2
                    span = 6
                    start = mid - (span // 2)
                    if start < 0:
                        start = 0
                    _add(" ".join(words[start:start + span]))

        if len(variants) > max_variants:
            return variants[:max_variants]
        return variants

    def _preprocess_body_for_markdown(body: str) -> str:
        s = body or ""
        s = s.replace("\r\n", "\n").replace("\r", "\n")
        s = re.sub(r"<br\s*/?>", "\n", s)
        s = re.sub(r"</p\s*>", "\n\n", s)
        s = re.sub(r"<\s*p[^>]*>", "", s)
        s = re.sub(r"<\s*/\s*section[^>]*>", "", s)
        s = re.sub(r"<\s*section[^>]*>", "", s)
        s = re.sub(r"<[^>]+>", "", s)
        s = unescape(s)
        return s

    def _clean_title_heading_markers(title: str) -> str:
        cleaned = re.sub(r"^\s*#+\s*", "", title or "")
        return cleaned.strip()

    def _section_to_html_with_highlight(title: str, body: str, needle: str) -> str:
        flags = 0 if case_sensitive else re.IGNORECASE

        def _mark_text(text_src: str, pattern: "re.Pattern") -> tuple[str, bool]:
            parts: list[str] = []
            last = 0
            matched = False
            for m in pattern.finditer(text_src):
                parts.append(text_src[last:m.start()])
                parts.append("<mark>" + m.group(0) + "</mark>")
                last = m.end()
                matched = True
            parts.append(text_src[last:])
            return "".join(parts), matched

        title_clean = _clean_title_heading_markers(title or "")
        body_clean = _preprocess_body_for_markdown(body)

        title_html = escape(title_clean)

        if needle:
            pat_exact = re.compile(re.escape(needle), flags)

            parts: list[str] = []
            last = 0
            for m in pat_exact.finditer(title_clean):
                parts.append(escape(title_clean[last:m.start()]))
                parts.append("<mark>" + escape(m.group(0)) + "</mark>")
                last = m.end()
            parts.append(escape(title_clean[last:]))
            joined = "".join(parts)
            if joined:
                title_html = joined

            body_clean, had_match = _mark_text(body_clean, pat_exact)

            if not had_match:
                words = re.findall(r"\w+", needle)
                if words:
                    loose_pat = re.compile(
                        r"(?:\b" + r"\b[\s\W]+\b".join([re.escape(w) for w in words]) + r"\b)",
                        flags,
                    )
                    body_clean, _ = _mark_text(body_clean, loose_pat)

        body_html = markdown.markdown(body_clean, extensions=["extra", "sane_lists"])
        return f'<section class="pdf-section"><h3>{title_html}</h3>\n{body_html}\n</section>'

    def _mistral_pages_text(pdf_path_resolved: str) -> list[str]:
        """
        Load per-page OCR markdown/text from:
          ~/annotarium/cache/mistral/files/<sha256(path-variant)>.json

        Returns a list where position i corresponds to page (i+1).
        """
        home = Path.home()
        base = home / "annotarium" / "cache" / "mistral" / "files"

        def _hash_key_path(p: str) -> str:
            p2 = os.path.normpath(p)
            p2 = os.path.normcase(p2)
            return p2

        candidates = [
            pdf_path_resolved,
            _hash_key_path(pdf_path_resolved),
            pdf_path_resolved.replace("/", "\\"),
            _hash_key_path(pdf_path_resolved.replace("/", "\\")),
        ]

        mistral_cache_file = None
        for cand in candidates:
            h = hashlib.sha256(cand.encode("utf-8")).hexdigest()
            f = base / (h + ".json")
            if f.is_file():
                mistral_cache_file = f
                break

        if mistral_cache_file is None:
            out = process_pdf(
                pdf_path_resolved,
                cache=False,
                cache_full=False,
                core_sections=True,
            )
            return out["pages_text"]

        data = json.loads(mistral_cache_file.read_text(encoding="utf-8"))
        pages = data["response"]["response"]["body"]["pages"]

        by_index: dict[int, str] = {}
        max_index = -1
        for p in pages:
            idx = p["index"]
            txt = (p.get("markdown") or p.get("text") or "").strip()
            by_index[idx] = txt
            if idx > max_index:
                max_index = idx

        out = [""] * (max_index + 1)
        for i in range(max_index + 1):
            out[i] = by_index.get(i, "")
        return out

    def _ensure_sections(cached: dict | None) -> dict[str, str] | None:
        cached_sections = (cached or {}).get("sections")
        if type(cached_sections) is dict and cached_sections:
            return cached_sections

        flat_cached = (cached or {}).get("flat_text") or (cached or {}).get("full_text") or ""
        if flat_cached:
            pat = re.compile(r"(?m)^(#{1,3})\s+(.+?)\s*$")
            sections_from_md: dict[str, str] = {}
            hits = list(pat.finditer(flat_cached))
            if hits:
                for i, m in enumerate(hits):
                    title = m.group(2).strip()
                    start = m.end()
                    end = hits[i + 1].start() if i + 1 < len(hits) else len(flat_cached)
                    body = flat_cached[start:end].strip()
                    if len(title) > 0 and len(title.split()) <= 40:
                        sections_from_md[title] = body
                if sections_from_md:
                    return sections_from_md

        out = process_pdf(
            pdf_path,
            cache=cache,
            cache_full=cache_full,
            core_sections=True,
        )
        if out and type(out.get("sections")) is dict and out["sections"]:
            return out["sections"]

        flat_full = (out or {}).get("flat_text") or (out or {}).get("full_text") or flat_cached
        if flat_full:
            return {"Document": flat_full}

        return None

    def _cache_store_quote_hit(path: str, key: str, hit: dict) -> None:
        if not cache:
            return
        existing = _load_pdf_cache_data(path) or {}
        qh = existing.get("quote_hits")
        if type(qh) is not dict:
            qh = {}
        qh[key] = {
            "needle": str(hit.get("needle") or ""),
            "page": hit.get("page"),
            "section_title": hit.get("section_title"),
            "section_html": hit.get("section_html"),
            "case_sensitive": bool(hit.get("case_sensitive", case_sensitive)),
            "version": QUOTE_CACHE_VERSION,
        }
        existing["quote_hits"] = qh
        _save_pdf_cache_data(path, existing)

    pdf_path_resolved = str(Path(pdf_path).expanduser().resolve())
    cached = _load_pdf_cache_data(pdf_path_resolved)

    # Pull citations + references from the process_pdf cache (or force build via process_pdf if missing).
    cached_effective = cached
    if cached_effective is None or (cached_effective.get("citations") is None and cached_effective.get("references") is None):
        cached_effective = process_pdf(
            pdf_path_resolved,
            cache=True,
            cache_full=True,
            core_sections=True,
        )

    citations_obj = cached_effective.get("citations")
    references_obj = cached_effective.get("references")

    qkey = f"{_norm(text)}|cs={int(case_sensitive)}"
    qhit = None
    hit_source = "none"

    quote_hits = None
    if cached and type(cached.get("quote_hits")) is dict:
        quote_hits = cached["quote_hits"]
        if qkey in quote_hits:
            candidate = quote_hits[qkey]
            if type(candidate) is dict and candidate.get("version") == QUOTE_CACHE_VERSION:
                qhit = candidate
                hit_source = "key"
        if qhit is None:
            nneedle = _norm(text)
            for v in quote_hits.values():
                if type(v) is not dict:
                    continue
                if v.get("version") != QUOTE_CACHE_VERSION:
                    continue
                needle_stored = str(v.get("needle") or "")
                if _norm(needle_stored) == nneedle and bool(v.get("case_sensitive", False)) == bool(case_sensitive):
                    qhit = v
                    hit_source = "needle"
                    break

    if qhit and os.environ.get("PDF_QUOTE_CACHE_DEBUG") == "1":
        print(f"[PDFCACHE] hit ({hit_source}) for {pdf_path_resolved}: {text[:80]!r}", flush=True)

    page_idx: int | None = None
    sec_title: str | None = None
    sec_html: str | None = None
    if qhit:
        page_idx = qhit.get("page")
        sec_title = qhit.get("section_title")
        sec_html = qhit.get("section_html")

    section_body_for_paging: str | None = None

    if section and sec_html is None:
        sections_map = _ensure_sections(cached_effective)
        if sections_map:
            variants = _build_search_variants(text, max_variants=7)
            words_full = re.findall(r"\w+", text or "")
            if words_full:
                short_phrase = " ".join(words_full[:4])
                n_short = _norm(short_phrase)
                if n_short and n_short not in variants:
                    variants.append(short_phrase)

            best_title = None
            best_body = None
            best_pos = None
            best_variant_for_highlight = ""

            for title, body in sections_map.items():
                nbody = _norm(_preprocess_body_for_markdown(body))
                for v in variants:
                    nv = _norm(v)
                    pos = nbody.find(nv)
                    if pos != -1:
                        if best_title is None:
                            best_title = title
                            best_body = body
                            best_pos = pos
                            best_variant_for_highlight = v
                        else:
                            if pos < best_pos:
                                best_title = title
                                best_body = body
                                best_pos = pos
                                best_variant_for_highlight = v
                            elif pos == best_pos and len(nv) > len(_norm(best_variant_for_highlight)):
                                best_title = title
                                best_body = body
                                best_pos = pos
                                best_variant_for_highlight = v

            if best_title is None:
                text_words_norm = set(re.findall(r"\w+", _norm(text)))
                best_overlap_count = 0
                best_title_ol = None
                best_body_ol = None
                for title, body in sections_map.items():
                    body_words_norm = set(re.findall(r"\w+", _norm(_preprocess_body_for_markdown(body))))
                    overlap_count = len(text_words_norm & body_words_norm)
                    if overlap_count > best_overlap_count:
                        best_overlap_count = overlap_count
                        best_title_ol = title
                        best_body_ol = body
                if best_title_ol is not None and best_overlap_count > 0:
                    best_title = best_title_ol
                    best_body = best_body_ol
                    best_variant_for_highlight = " ".join(words_full[:4]) if words_full else ""

            if best_title is not None:
                sec_title = best_title
                sec_html = _section_to_html_with_highlight(
                    best_title,
                    best_body or "",
                    best_variant_for_highlight or "",
                )
                section_body_for_paging = best_body
    else:
        if section and sec_title:
            sections_map = _ensure_sections(cached_effective)
            if sections_map and sec_title in sections_map:
                section_body_for_paging = sections_map[sec_title]

    # Page finding: OCR-per-page markdown from Mistral cache is the source of truth.
    if page and page_idx is None:
        pages_text = _mistral_pages_text(pdf_path_resolved)
        cached_effective["pages_text"] = pages_text

        snippet_variants = _build_search_variants(text, max_variants=7)
        page_found_local: int | None = None

        for i, raw_page_txt in enumerate(pages_text):
            raw_page_txt = raw_page_txt or ""
            n_page_txt = _norm(raw_page_txt)
            relaxed_page = re.sub(r"[^\w\s]", " ", raw_page_txt)
            n_page_relaxed = _norm(relaxed_page)

            for ndl in snippet_variants:
                ndl_n = _norm(ndl)
                if ndl_n and (n_page_txt.find(ndl_n) != -1 or n_page_relaxed.find(ndl_n) != -1):
                    page_found_local = i + 1
                    break
            if page_found_local is not None:
                break

        if page_found_local is None and sec_title:
            title_variants = _build_search_variants(sec_title, max_variants=7)
            for i, raw_page_txt in enumerate(pages_text):
                raw_page_txt = raw_page_txt or ""
                n_page_txt = _norm(raw_page_txt)
                relaxed_page = re.sub(r"[^\w\s]", " ", raw_page_txt)
                n_page_relaxed = _norm(relaxed_page)

                for ndl in title_variants:
                    ndl_n = _norm(ndl)
                    if ndl_n and (n_page_txt.find(ndl_n) != -1 or n_page_relaxed.find(ndl_n) != -1):
                        page_found_local = i + 1
                        break
                if page_found_local is not None:
                    break

        if page_found_local is None and section_body_for_paging:
            body_sample = section_body_for_paging
            if len(body_sample) > 1200:
                body_sample = body_sample[:1200]
            body_variants = _build_search_variants(_preprocess_body_for_markdown(body_sample), max_variants=7)

            for i, raw_page_txt in enumerate(pages_text):
                raw_page_txt = raw_page_txt or ""
                n_page_txt = _norm(raw_page_txt)
                relaxed_page = re.sub(r"[^\w\s]", " ", raw_page_txt)
                n_page_relaxed = _norm(relaxed_page)

                for ndl in body_variants:
                    ndl_n = _norm(ndl)
                    if ndl_n and (n_page_txt.find(ndl_n) != -1 or n_page_relaxed.find(ndl_n) != -1):
                        page_found_local = i + 1
                        break
                if page_found_local is not None:
                    break

        if page_found_local is None:
            words = re.findall(r"\w+", _norm(text or ""))
            key_words = [w for w in words if len(w) > 3]
            best_page = None
            best_count = 0

            for i, raw_page_txt in enumerate(pages_text):
                raw_page_txt = raw_page_txt or ""
                page_words = re.findall(r"\w+", _norm(raw_page_txt))
                page_set = set(page_words)

                overlap = 0
                for w in key_words:
                    if w in page_set:
                        overlap += 1

                if overlap > best_count:
                    best_count = overlap
                    best_page = i + 1

            if best_page is not None and best_count > 0:
                page_found_local = best_page

        page_idx = page_found_local

    if page_idx is None or (section and sec_title is None):
        print(
            f"[PDFSCAN][MISS] pdf={pdf_path_resolved!r} "
            f"needle={text[:80]!r} "
            f"page_found={page_idx} "
            f"section_title={sec_title!r} "
            f"section_text={(sec_html or '')[:80]!r}",
            flush=True,
        )

    if cache:
        _cache_store_quote_hit(
            pdf_path_resolved,
            qkey,
            {
                "needle": text,
                "page": page_idx,
                "section_title": sec_title,
                "section_html": sec_html,
                "case_sensitive": case_sensitive,
            },
        )

    return {
        "page": page_idx if page else None,
        "section_title": sec_title if section else None,
        "section_text": sec_html if section else None,
        "citations": citations_obj,
        "references": references_obj,
    }


from pydantic import BaseModel, Field

def _cache_path_pdf(src: str, namespace: str = "pdf") -> str:
    from hashlib import sha256
    p = Path(src).resolve()
    root = Path.home() / f".zotkw_{namespace}_cache"
    root.mkdir(parents=True, exist_ok=True)
    h = sha256(str(p).encode("utf-8")).hexdigest()
    return str(root / f"{h}.json")

class QuoteHitModel(BaseModel):
    needle: str = ""
    page: int | None = None
    section_title: str | None = None
    section_html: str | None = None
    case_sensitive: bool = False

class PDFCacheModel(BaseModel):
    kind: str = "pdf_cache_v1"
    version: int = 1
    full_text: str | None = None
    flat_text: str | None = None
    html: str | None = None
    toc: list[tuple[int, str]] | None = None
    sections: dict[str, str] | None = None
    process_log: Dict[str, Any] | None = None
    word_count: int | None = None
    references: List[str] | None = None
    citations: Dict[str, Any] | None = None
    summary: Dict[str, Any] | None = None
    payload: Dict[str, Any] | None = None
    summary_log: Dict[str, Any] | None = None
    quote_hits: Dict[str, QuoteHitModel] = Field(default_factory=dict)

def _atomic_dump_json(path: str, data: Dict[str, Any]) -> None:
    tmp = Path(path).with_suffix(".tmp")
    txt = json.dumps(data, ensure_ascii=False, indent=2)
    tmp.write_text(txt, encoding="utf-8")
    os.replace(str(tmp), str(Path(path)))

def _load_json_if_valid(path: str) -> dict | None:
    f = Path(path)
    if not f.is_file() or f.stat().st_size == 0:
        return None
    raw = f.read_text(encoding="utf-8")
    if not raw or raw[0] != "{" or raw.rfind("}") < 0:
        return None
    clipped = raw[: raw.rfind("}") + 1]
    obj = json.loads(clipped)
    if not isinstance(obj, dict):
        return None
    if obj.get("kind") != "pdf_cache_v1":
        return None
    return obj

def _cache_load(path: str) -> dict | None:
    cache_file = Path(_cache_path(path))
    if not (cache_file.is_file() and cache_file.stat().st_size > 0):
        return None
    raw = cache_file.read_text(encoding="utf-8")
    if not raw or raw[0] != "{" or raw.rfind("}") < 0:
        return None
    clipped = raw[: raw.rfind("}") + 1]
    obj = json.loads(clipped)
    return obj if isinstance(obj, dict) else None
#
#
# def process_pdf(
#         pdf_path: str,
#         cache: bool = False,
#         cache_full: bool = True,
#         mistral_model: str = "mistral-ocr-latest",
#         ocr_retry: int = 5,
#         core_sections: bool = True,
# ) -> Optional[Dict[str, Any]]:
#     """
#     Extract a PDF into markdown and structured sections with intelligent caching.
#     """
#     if not pdf_path.lower().endswith(".pdf"):
#         raise ValueError("Source must be a PDF file.")
#
#     llm4_kwargs = {"page_chunks": True, "write_images": False}
#
#     cache_file = Path(_cache_path(pdf_path))
#     full_md = None
#     logs_md: Dict[str, Any] = {}
#     references: List[str] | str = ""
#
#     import re as _re
#
#     def _word_count(s: str) -> int:
#         return len(_re.findall(r"\w+", s or ""))
#
#     def _count_tokens(text: str, model_name: str = "gpt-4o") -> int:
#         try:
#             import tiktoken
#             try:
#                 enc = tiktoken.encoding_for_model(model_name)
#             except (KeyError, ValueError):
#                 enc = tiktoken.get_encoding(
#                     "o200k_base" if model_name.startswith("gpt-4o") else "cl100k_base"
#                 )
#             return len(enc.encode(text or ""))
#         except Exception:
#             return len((text or "").split())
#
#     def _safe_load_cache(path: Path) -> Optional[Dict[str, Any]]:
#         import json as _json
#
#         raw = path.read_text(encoding="utf-8")
#         if not raw:
#             return None
#         start = raw.find("{")
#         end = raw.rfind("}")
#         if start == -1 or end <= start:
#             return None
#         clipped = raw[start:end + 1]
#         decoder = _json.JSONDecoder()
#         obj, _ = decoder.raw_decode(clipped.lstrip())
#         return obj if isinstance(obj, dict) else None
#
#     cached_data = None
#     if cache_file.is_file() and cache_file.stat().st_size > 0:
#         print(f"[LOG] (cache) Found cache at {cache_file}")
#         loaded = None
#         try:
#             loaded = _safe_load_cache(cache_file)
#         except json.JSONDecodeError:
#             loaded = None
#             print("[WARNING] Cache file is corrupt, ignoring clipped JSON as well.")
#         if isinstance(loaded, dict):
#             cached_data = loaded
#
#         if cached_data and "full_text" in cached_data:
#             if "citations" not in cached_data or "flat_text" not in cached_data:
#                 try:
#                     _cit = link_citations_to_footnotes(
#                         {
#                             "full_text": cached_data.get("full_text", ""),
#                             "references": cached_data.get("references", []),
#                         }
#                     )
#                     cached_data["citations"] = _cit
#                     cached_data["flat_text"] = _cit.get(
#                         "flat_text",
#                         cached_data.get("full_text", ""),
#                     )
#                 except Exception:
#                     cached_data.setdefault(
#                         "citations",
#                         {
#                             "total": {},
#                             "results": [],
#                             "flat_text": cached_data.get("full_text", ""),
#                         },
#                     )
#                     cached_data.setdefault(
#                         "flat_text",
#                         cached_data.get("full_text", ""),
#                     )
#
#             if "summary" not in cached_data:
#                 ft = cached_data.get("full_text", "")
#                 fl = cached_data.get("flat_text", ft)
#                 cached_data["summary"] = {
#                     "full_text": {
#                         "words": _word_count(ft),
#                         "tokens": _count_tokens(ft),
#                     },
#                     "flat_text": {
#                         "words": _word_count(fl),
#                         "tokens": _count_tokens(fl),
#                     },
#                 }
#
#             cache_file.write_text(
#                 json.dumps(cached_data, ensure_ascii=False, indent=2),
#                 encoding="utf-8",
#             )
#
#         if cache and cached_data and cached_data.get("sections"):
#             return cached_data
#
#         if not cache and cache_full and cached_data and cached_data.get("full_text"):
#             full_md = cached_data["full_text"]
#             references = cached_data.get("references", [])
#             print(
#                 "[LOG] Will reuse cached full_text (cache_full=True) and recompute sections/metadata."
#             )
#
#         if not cache and not cache_full:
#             print(
#                 "[LOG] cache=False and cache_full=False → will re-extract/OCR full_text from PDF."
#             )
#
#     if full_md is None:
#         print(f"[LOG] Processing PDF from scratch: {pdf_path}")
#
#         try:
#             doc = fitz.open(pdf_path)
#         except Exception:
#             doc = fitz.open(_repair_pdf(pdf_path))
#
#         page_list = list(range(doc.page_count))
#         doc.close()
#
#         segments = [""] * len(page_list)
#         needs_ocr: List[int] = []
#
#         for pos, pidx in enumerate(page_list):
#             try:
#                 txt = pymupdf4llm.to_markdown(
#                     pdf_path,
#                     pages=[pidx],
#                     **llm4_kwargs,
#                 )
#                 if txt:
#                     segments[pos] = txt.strip()
#                 else:
#                     raise ValueError("No embedded text")
#             except Exception:
#                 needs_ocr.append(pidx)
#
#         if needs_ocr:
#             print(f"[LOG] Found {len(needs_ocr)} pages requiring OCR.")
#
#             pos_map = {p: i for i, p in enumerate(page_list)}
#
#             if len(needs_ocr) > 150:
#                 needs_ocr = needs_ocr[:60] + needs_ocr[-60:]
#             if len(needs_ocr) > 300:
#                 needs_ocr = needs_ocr[:250]
#
#             def split_batches_by_size(
#                 pages: List[int],
#                 max_pages: int = 40,
#             ) -> List[List[int]]:
#                 batches: List[List[int]] = []
#
#                 def build_pdf_bytes(pg_list: List[int]) -> bytes:
#                     s = fitz.open(pdf_path)
#                     d = fitz.open()
#                     try:
#                         for pg in pg_list:
#                             if 0 <= pg < s.page_count:
#                                 try:
#                                     d.insert_pdf(
#                                         s,
#                                         from_page=pg,
#                                         to_page=pg,
#                                         links=False,
#                                         annots=False,
#                                     )
#                                 except Exception as ex:
#                                     print(
#                                         f"[WARNING] insert_pdf failed on page {pg}: {ex}"
#                                     )
#                             else:
#                                 print(
#                                     f"[WARNING] Skipping page {pg} – out of bounds"
#                                 )
#                         if d.page_count == 0:
#                             return b""
#                         return d.tobytes()
#                     finally:
#                         s.close()
#                         d.close()
#
#                 def ensure_under_cap(pg_list: List[int]) -> None:
#                     if not pg_list:
#                         return
#                     pdf_bytes = build_pdf_bytes(pg_list)
#                     if not pdf_bytes:
#                         return
#                     if len(pdf_bytes) <= 47 * 1024 * 1024:
#                         batches.append(pg_list)
#                         return
#                     if len(pg_list) == 1:
#                         batches.append(pg_list)
#                         return
#                     mid = len(pg_list) // 2
#                     ensure_under_cap(pg_list[:mid])
#                     ensure_under_cap(pg_list[mid:])
#
#                 for i in range(0, len(pages), max_pages):
#                     ensure_under_cap(pages[i : i + max_pages])
#                 return batches
#
#             client = Mistral(api_key=api_key)
#             all_batches = split_batches_by_size(needs_ocr, max_pages=40)
#             print(f"[LOG] OCR will run in {len(all_batches)} batch(es).")
#
#             ocr_text_by_page: Dict[int, str] = {}
#
#             for bi, batch in enumerate(all_batches, 1):
#                 src = fitz.open(pdf_path)
#                 dst = fitz.open()
#                 for p in batch:
#                     if 0 <= p < src.page_count:
#                         try:
#                             dst.insert_pdf(
#                                 src,
#                                 from_page=p,
#                                 to_page=p,
#                                 links=False,
#                                 annots=False,
#                             )
#                         except Exception as ex:
#                             print(f"[WARNING] insert_pdf failed on page {p}: {ex}")
#                     else:
#                         print(f"[WARNING] Skipping page {p} – out of bounds")
#                 if dst.page_count == 0:
#                     print(f"[WARNING] Batch {bi} had no valid pages; skipping.")
#                     src.close()
#                     dst.close()
#                     continue
#                 pdf_bytes = dst.tobytes()
#                 src.close()
#                 dst.close()
#
#                 print(
#                     f"[LOG] Uploading OCR batch {bi}/{len(all_batches)} "
#                     f"({len(batch)} pages, {len(pdf_bytes) / 1024 / 1024:.2f} MB)"
#                 )
#
#                 upload = client.files.upload(
#                     file={
#                         "file_name": f"ocr_batch_{bi}.pdf",
#                         "content": pdf_bytes,
#                     },
#                     purpose="ocr",
#                 )
#                 signed = client.files.get_signed_url(file_id=upload.id).url
#
#                 ocr_resp = None
#                 for delay in _exponential_backoff(ocr_retry):
#                     try:
#                         ocr_resp = client.ocr.process(
#                             model=mistral_model,
#                             document={
#                                 "type": "document_url",
#                                 "document_url": signed,
#                             },
#                         )
#                         break
#                     except m_models.SDKError as e:
#                         status = getattr(e, "status", None)
#                         if status == 429:
#                             print(
#                                 f"[WARNING] OCR rate limit hit, sleeping for {delay:.2f}s..."
#                             )
#                             time.sleep(delay)
#                             continue
#                         if status == 400:
#                             if len(batch) > 1:
#                                 print(
#                                     "[WARNING] Batch still too large for OCR; splitting and retrying."
#                                 )
#                                 mid = len(batch) // 2
#                                 all_batches[bi - 1 : bi] = [
#                                     batch[:mid],
#                                     batch[mid:],
#                                 ]
#                                 ocr_resp = None
#                                 break
#                             raise
#                         raise
#
#                 if not ocr_resp:
#                     continue
#
#                 results = ocr_resp.model_dump().get("pages", [])
#                 for i, page_info in enumerate(results):
#                     orig_page = batch[i] if i < len(batch) else batch[-1]
#                     text = (
#                         page_info.get("markdown")
#                         or page_info.get("text", "")
#                     ).strip()
#                     ocr_text_by_page[orig_page] = text
#
#             for orig_page, text in ocr_text_by_page.items():
#                 if text:
#                     segments[pos_map[orig_page]] = text
#
#         full_md = "\n\n".join(segments)
#         full_md = re.sub(r"!\[.*?\]\(.*?\)", "", full_md)
#         full_md = clean_hein_header(full_md)
#
#         def _extract_references_from_md(
#             md: str,
#             first_page_end: int = 0,
#         ) -> Tuple[str, List[str]]:
#             refs: List[str] = []
#             ref_match = next(
#                 (
#                     m
#                     for m in _REFERENCE_HEADING_RE.finditer(md)
#                     if m.start() > first_page_end
#                 ),
#                 None,
#             ) or next(
#                 (
#                     m
#                     for m in _ENDNOTES_HEADING_RE.finditer(md)
#                     if m.start() > first_page_end
#                 ),
#                 None,
#             )
#             if ref_match:
#                 ref_block = md[ref_match.start() :].strip()
#                 refs.append(ref_block)
#                 md = md[: ref_match.start()].rstrip()
#             return md, refs
#
#         first_page_end = len(segments[0]) if "segments" in locals() and segments else 0
#         full_md, references = _extract_references_from_md(
#             full_md,
#             first_page_end,
#         )
#
#     parse_text = full_md
#
#     link_out = link_citations_to_footnotes(full_md, references)
#     flat_text = link_out.get("flat_text", full_md)
#     html_full = convert_citations_to_html(flat_text, link_out)
#
#     toc, sections, logs_md = parse_markdown_to_final_sections(flat_text)
#     print(f"[LOG] Raw parse created {len(sections)} top-level sections. Cleaning...")
#
#     intro_data = extract_intro_conclusion_pdf_text(
#         full_text=parse_text,
#         raw_secs=sections,
#         processing_log=logs_md,
#         core_sections=core_sections,
#     )
#
#     payload = intro_data.get("payload")
#     summary_log = intro_data.get("summary_log")
#     processing_log = intro_data.get("process_log", logs_md)
#
#     cleaned_sections = sections
#
#     full_words = _word_count(full_md)
#     flat_words = _word_count(flat_text)
#     full_tokens = _count_tokens(full_md)
#     flat_tokens = _count_tokens(flat_text)
#     summary = {
#         "full_text": {"words": full_words, "tokens": full_tokens},
#         "flat_text": {"words": flat_words, "tokens": flat_tokens},
#     }
#
#     result_to_cache: Dict[str, Any] = {}
#     if cleaned_sections:
#         result_to_cache.update(
#             {
#                 "full_text": full_md,
#                 "flat_text": flat_text,
#                 "html": html_full,
#                 "toc": [(1, title) for title in cleaned_sections.keys()],
#                 "sections": cleaned_sections,
#                 "process_log": processing_log,
#                 "word_count": flat_words,
#                 "references": references,
#                 "citations": link_out,
#                 "summary": summary,
#                 "payload": payload,
#                 "summary_log": summary_log,
#             }
#         )
#     else:
#         result_to_cache.update(
#             {
#                 "full_text": full_md,
#                 "flat_text": flat_text,
#                 "html": html_full,
#                 "citations": link_out,
#                 "summary": summary,
#                 "payload": payload,
#                 "summary_log": summary_log,
#             }
#         )
#
#     cache_file.parent.mkdir(parents=True, exist_ok=True)
#     cache_file.write_text(
#         json.dumps(result_to_cache, ensure_ascii=False, indent=2),
#         encoding="utf-8",
#     )
#
#     return {
#         "full_text": full_md,
#         "flat_text": result_to_cache.get("flat_text", full_md),
#         "html": result_to_cache.get(
#             "html",
#             convert_citations_to_html(full_md, link_out),
#         ),
#         "toc": result_to_cache.get("toc", []),
#         "sections": result_to_cache.get("sections", {}),
#         "process_log": processing_log,
#         "word_count": full_words,
#         "references": result_to_cache.get("references", []),
#         "citations": result_to_cache.get(
#             "citations",
#             {"total": {}, "results": [], "flat_text": full_md},
#         ),
#         "summary": result_to_cache.get("summary", summary),
#         "payload": payload,
#         "summary_log": summary_log,
#     }
#


def fetch_zotero_items(collection_name: Optional[str] = None) -> List[dict]:
    """
    Fetch raw Zotero items via the client's API.

    Returns:
        A list of item dicts (possibly empty). Non-dict entries are filtered out.
    """


    try:
        items = zotero_client.get_all_items(collection_name=collection_name)
    except Exception as e:
        logging.exception("fetch_zotero_items: API call failed: %s", e)
        return []

    if items is None:
        return []
    if not isinstance(items, list):
        try:
            items = list(items)
        except Exception:
            logging.warning("fetch_zotero_items: could not coerce items to list; returning [].")
            return []

    # Keep only dict-like entries
    items = [it for it in items if isinstance(it, dict)]
    return items



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

def read_zotero_cache(cache_file: Path, expiry_seconds: int) -> Tuple[Optional[pd.DataFrame], Optional[List[dict]]]:
    """
    Read a pickled cache file if it exists and is fresh.

    Args:
        cache_file: Path to the pickle file containing {'dataframe': df, 'raw_items': items}.
        expiry_seconds: Maximum allowed age in seconds. If <= 0, treat as expired.

    Returns:
        (df, items) when cache is valid; otherwise (None, None).
    """
    try:
        if expiry_seconds <= 0:
            return None, None

        if not isinstance(cache_file, Path):
            cache_file = Path(cache_file)

        if not cache_file.exists():
            return None, None

        age = time.time() - cache_file.stat().st_mtime
        if age > expiry_seconds:
            return None, None

        with open(cache_file, "rb") as f:
            data = pickle.load(f)

        df = data.get("dataframe") if isinstance(data, dict) else None
        items = data.get("raw_items") if isinstance(data, dict) else None

        if not isinstance(df, pd.DataFrame):
            df = None
        if items is None:
            items = None
        elif not isinstance(items, list):
            try:
                items = list(items)
            except Exception:
                items = None
        if isinstance(items, list):
            items = [it for it in items if isinstance(it, dict)]

        # If either part is missing, treat as cache miss to be safe
        if df is None or items is None:
            return None, None

        return df, items

    except Exception as e:
        logging.exception("read_zotero_cache: failed to read '%s': %s", cache_file, e)
        return None, None


def write_zotero_cache(cache_file: Path, df: pd.DataFrame, items: List[dict]) -> None:
    """
    Persist a DataFrame and item list to a pickle cache.
    Fire-and-forget: logs on error, no exceptions raised.
    """
    try:
        if not isinstance(cache_file, Path):
            cache_file = Path(cache_file)
        cache_file.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            "dataframe": df if isinstance(df, pd.DataFrame) else pd.DataFrame(),
            "raw_items": [it for it in (items or []) if isinstance(it, dict)],
        }
        with open(cache_file, "wb") as f:
            pickle.dump(payload, f, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception as e:
        logging.warning("write_zotero_cache: could not write '%s': %s", cache_file, e)
def _norm_space(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip())


def _creator_to_display_name(c: dict) -> str:
    """
    Accepts creator dicts with either:
      • {'name': 'Corporate or Already-Formatted Name'}
      • {'firstName': 'E', 'lastName': 'Amanatidou'}
    Returns a compact display token like 'E Amanatidou' or the corporate name as-is.
    """
    if not isinstance(c, dict):
        return ""
    if c.get("name"):
        return _norm_space(c["name"])
    fn = _norm_space(c.get("firstName", ""))
    ln = _norm_space(c.get("lastName", ""))
    if fn and ln:
        return f"{fn} {ln}".strip()
    return (fn or ln)


def _build_creator_summary(author_tokens: List[str]) -> str:
    """
    0 authors → ''
    1–3 authors → 'A; B; C'
    ≥4 authors → '<first> et al.'
    """
    toks = [t for t in (x.strip() for x in author_tokens) if t]
    if not toks:
        return ""
    if len(toks) <= 3:
        return "; ".join(toks)
    return f"{toks[0]} et al."


def _parse_year_from_date(s: str) -> str:
    s = str(s or "").strip()
    if not s:
        return ""
    m = re.search(r"(\d{4})", s)
    return m.group(1) if m else ""


def _hostname_from_url(u: str) -> str:
    try:
        host = urlparse(u).netloc.lower()
        return re.sub(r"^www\.", "", host)
    except Exception:
        return ""


def _digits_to_int(x: Any) -> Optional[int]:
    if x is None:
        return None
    m = re.search(r"-?\d+", str(x))
    if not m:
        return None
    try:
        return int(m.group(0))
    except Exception:
        return None


def parse_creators_authors(item: dict) -> Dict[str, Any]:
    """
    Returns:
      {
        'authors_list': [str, ...],
        'authors_str': 'A; B; C',
        'creator_summary': 'A et al.',
        'year': 'YYYY'
      }
    Logic:
      • Take 'data.creators' with creatorType in {author, editor, presenter, contributor}
      • Build names from 'name' or ('firstName','lastName')
      • Deduplicate case-insensitively, preserve order
      • Fallback to meta.creatorSummary if creators are empty
      • Year from meta.parsedDate else data.date (first 4 digits)
    """
    data = (item or {}).get("data", {}) if isinstance(item, dict) else {}
    meta = (item or {}).get("meta", {}) if isinstance(item, dict) else {}
    creators = data.get("creators") or []

    ok_types = {"author", "editor", "presenter", "contributor"}


    tokens: List[str] = []
    for c in creators:
        if not isinstance(c, dict):
            continue
        ctype = str(c.get("creatorType", "")).lower()
        if ctype in ok_types:
            nm = _creator_to_display_name(c)
            if nm:
                tokens.append(nm)

    # Deduplicate preserving order
    seen: set[str] = set()
    dedup_tokens: List[str] = []
    for t in tokens:
        k = t.casefold()
        if k not in seen:
            seen.add(k)
            dedup_tokens.append(t)

    creator_summary = _norm_space(meta.get("creatorSummary", "")) if isinstance(meta, dict) else ""

    if not dedup_tokens and creator_summary:
        # keep summary as-is; tokenise minimally for authors_str/authors_list
        if "et al." in creator_summary:
            first = creator_summary.replace(" et al.", "").strip()
            toks = [first] if first else []
        else:
            toks = [t.strip() for t in creator_summary.split(";") if t.strip()]
        year = _parse_year_from_date(meta.get("parsedDate") or data.get("date") or "")
        return {
            "authors_list": toks,
            "authors_str": "; ".join(toks),
            "creator_summary": creator_summary,
            "year": year,
        }

    if not creator_summary:
        creator_summary = _build_creator_summary(dedup_tokens)

    year = _parse_year_from_date(meta.get("parsedDate") or data.get("date") or "")

    return {
        "authors_list": dedup_tokens,
        "authors_str": "; ".join(dedup_tokens),
        "creator_summary": creator_summary,
        "year": year,
    }

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


def parse_payload_counts(data_block: dict, payload: dict) -> Dict[str, Optional[int]]:
    """
    Returns:
      {
        'word_count_for_attribution': Optional[int],
        'citations': Optional[int],
      }
    Priority:
      • payload['summary']['payload_note']['counts'] values
      • Fallback citations via parse_citation_count(data_block.get('extra'))
    """
    word_count: Optional[int] = None
    citations: Optional[int] = None

    counts = None
    if isinstance(payload, dict):
        summary = payload.get("summary")
        if isinstance(summary, dict):
            pn = summary.get("payload_note")
            if isinstance(pn, dict):
                counts = pn.get("counts")

    if isinstance(counts, dict):
        word_count = _digits_to_int(counts.get("word_count_for_attribution"))
        citations = _digits_to_int(counts.get("citation_count"))

    # Fallback for citations using existing helper (assumed in caller's module)
    if citations is None:
        try:
            extra = (data_block or {}).get("extra")
            # parse_citation_count is expected to return int|None
            citations = parse_citation_count(extra)  # type: ignore[name-defined]
        except Exception:
            pass

    return {
        "word_count_for_attribution": word_count,
        "citations": citations,
    }

def parse_theme_tags(data_block: dict, *, return_joined: bool = False):
    """
    Extract themes from Zotero tags using the convention: "#theme:{theme_value}"

    Accepts typical Zotero tag shapes:
      - data_block["tags"] == [{"tag": "…"}, {"tag": "…"}]   (preferred)
      - data_block["tags"] == ["…", "…"]                     (fallback)

    Args:
        data_block: Zotero item data dict (must contain "tags" if present).
        return_joined: If True, returns a single '; '-joined string. Otherwise, a list[str].

    Returns:
        list[str] of unique theme values (case-insensitive dedup, preserving first seen form)
        or a '; '-joined string if return_joined=True.
    """
    import re

    tags = (data_block or {}).get("tags", []) or []

    # Normalise to a list of strings
    def _tag_text(t):
        if isinstance(t, dict):
            return str(t.get("tag", "")).strip()
        if isinstance(t, str):
            return t.strip()
        return ""

    # Match "#theme: ..." (case-insensitive, tolerate spaces after '#')
    pat = re.compile(r"^\s*#\s*theme\s*:\s*(.+)$", flags=re.IGNORECASE)

    themes = []
    seen = set()
    for raw in tags:
        s = _tag_text(raw)
        if not s:
            continue
        m = pat.match(s)
        if not m:
            continue
        val = m.group(1).strip()
        if not val:
            continue
        k = val.casefold()
        if k in seen:
            continue
        seen.add(k)
        themes.append(val)

    if return_joined:
        return "; ".join(themes)
    return themes
def parse_payload_affiliation(data_block: dict, payload: dict) -> Dict[str, str]:
    """
    Returns a normalised affiliation dict prioritising Zotero tags, then payload, then item fallbacks:
      {
        "city":        "CityA; CityB",
        "continent":   "Europe; North America",
        "institution": "Org1; Org2",
        "country":     "CountryX; CountryY",
        "department":  "Dept1; Dept2",
      }
    Priority:
      1) data_block['tags'] with prefixes:
           affiliation:institution:..., affiliation:department:..., affiliation:city:...,
           affiliation:country:..., affiliation:continent:...
      2) payload['summary']['payload_note']['affiliation_entities']
         • supports either lists of dicts or separate lists (place/country/affiliations)
      3) Fallbacks from data_block: place → city, country → country
      4) If continent still empty but country present, derive via COUNTRY_TO_CONTINENT
    """
    # helpers
    def _dedup_join(values: list[str]) -> str:
        out, seen = [], set()
        for v in values:
            vv = _norm_space(v)
            if not vv:
                continue
            k = vv.casefold()
            if k not in seen:
                seen.add(k)
                out.append(vv)
        return "; ".join(out)

    # seed from tags (highest priority)
    city_vals: list[str] = []
    continent_vals: list[str] = []
    institution_vals: list[str] = []
    country_vals: list[str] = []
    department_vals: list[str] = []

    # Zotero tags can be [{"tag": "..."}, ...] or ["...", ...]
    tags = (data_block or {}).get("tags", []) or []
    for t in tags:
        raw = t.get("tag") if isinstance(t, dict) else (t if isinstance(t, str) else "")
        s = _norm_space(raw)
        if not s:
            continue
        # expected forms: "affiliation:institution:MIT"
        parts = s.split(":", 2)
        if len(parts) >= 3 and parts[0].lower() == "affiliation":
            kind = parts[1].lower().strip()
            val = _norm_space(parts[2])
            if not val:
                continue
            if kind == "institution":
                institution_vals.append(val)
            elif kind == "department":
                department_vals.append(val)
            elif kind == "city":
                city_vals.append(val)
            elif kind == "country":
                country_vals.append(val)
            elif kind == "continent":
                continent_vals.append(val)

    # payload fallback
    aff = None
    if isinstance(payload, dict):
        summary = payload.get("summary")
        if isinstance(summary, dict):
            pn = summary.get("payload_note")
            if isinstance(pn, dict):
                aff = pn.get("affiliation_entities")

    # payload may be dict with lists or list of dicts
    if isinstance(aff, dict):
        # shape A: explicit lists
        place_list = aff.get("place") or []
        country_list = aff.get("country") or []
        aff_list = aff.get("affiliations") or []
        # try to parse affiliations list that could be strings OR dicts
        if isinstance(aff_list, list):
            for a in aff_list:
                if isinstance(a, dict):
                    dep = _norm_space(a.get("department", ""))
                    inst = _norm_space(a.get("institution", ""))
                    ctry = _norm_space(a.get("country", ""))
                    if dep:
                        department_vals.append(dep)
                    if inst:
                        institution_vals.append(inst)
                    if ctry:
                        country_vals.append(ctry)
                elif isinstance(a, str):
                    inst = _norm_space(a)
                    if inst:
                        institution_vals.append(inst)
        # cities & countries from place/country lists
        if isinstance(place_list, list):
            for x in place_list:
                xx = _norm_space(x)
                if xx:
                    city_vals.append(xx)
        if isinstance(country_list, list):
            for x in country_list:
                xx = _norm_space(x)
                if xx:
                    country_vals.append(xx)

    # final fallbacks from item data
    if not city_vals:
        fallback_city = _norm_space((data_block or {}).get("place", ""))
        if fallback_city:
            city_vals.append(fallback_city)
    if not country_vals:
        fallback_country = _norm_space((data_block or {}).get("country", ""))
        if fallback_country:
            country_vals.append(fallback_country)

    # derive continent if missing but countries exist
    if not continent_vals and country_vals:
        try:
            from general.app_constants import COUNTRY_TO_CONTINENT
            for c in country_vals:
                key = c.strip().casefold()
                cont = COUNTRY_TO_CONTINENT.get(key) or COUNTRY_TO_CONTINENT.get(c.strip())
                if cont:
                    continent_vals.append(_norm_space(cont))
        except Exception:
            pass  # leave continent empty if mapping unavailable

    return {
        "city": _dedup_join(city_vals),
        "continent": _dedup_join(continent_vals),
        "institution": _dedup_join(institution_vals),
        "country": _dedup_join(country_vals),
        "department": _dedup_join(department_vals),
    }

def parse_payload_urls_attachments(payload: dict) -> Dict[str, str]:
    """
    Returns:
      {
        'pdf_primary': str|'',
        'urls_all': str|'',
        'attachment_pdf': str|''
      }
    Priority:
      • payload['summary']['payload_note']['urls'] (pdf_primary, all)
      • First PDF-like attachment with contentType 'application/pdf' and a URL
    """
    pdf_primary = ""
    urls_all = ""
    attachment_pdf = ""

    urls = None
    atts = None

    if isinstance(payload, dict):
        summary = payload.get("summary")
        if isinstance(summary, dict):
            pn = summary.get("payload_note")
            if isinstance(pn, dict):
                urls = pn.get("urls")
                atts = pn.get("attachments")

    if isinstance(urls, dict):
        if urls.get("pdf_primary"):
            pdf_primary = _norm_space(urls["pdf_primary"])
        all_urls = urls.get("all") or []
        if isinstance(all_urls, list) and all_urls:
            # dedupe while preserving order
            seen: set[str] = set()
            kept: List[str] = []
            for u in all_urls:
                su = _norm_space(u)
                if su and su not in seen:
                    seen.add(su)
                    kept.append(su)
            urls_all = "; ".join(kept)

    if isinstance(atts, list) and atts:
        first_pdf = next(
            (
                a
                for a in atts
                if isinstance(a, dict)
                and _norm_space(a.get("contentType", "")).lower() == "application/pdf"
                and _norm_space(a.get("url", "") or a.get("href", ""))
            ),
            None,
        )
        if first_pdf:
            attachment_pdf = _norm_space(first_pdf.get("url") or first_pdf.get("href"))

    return {
        "pdf_primary": pdf_primary,
        "urls_all": urls_all,
        "attachment_pdf": attachment_pdf,
    }

def extract_note_codes(payload: dict, note_keys: Set[str]) -> Dict[str, str]:
    """
    Extract and normalise 'Note_code' fields from a Zotero payload.

    Behaviour:
    • Accepts several payload shapes:
        - payload['summary']['Note_code'] or ['note_code']
        - payload['Note_code'] or ['note_code']
        - (graceful no-op if missing)
    • Returns ONLY the requested keys (note_keys), filling missing ones with "".
    • Normalises incoming keys via snake_case; handles a few common aliases.
    • Coerces values to strings:
        - list -> ", ".join(str(v).strip() for v in list if v not empty)
        - dict -> "k=v" pairs joined by ", " (sorted by key)
        - other -> str(value).strip()

    Args:
        payload: Zotero item payload or 'summary' dict containing Note_code.
        note_keys: expected set of output keys (e.g., {'framework_model','ontology',...})

    Returns:
        dict[str, str]: mapping for the requested keys; defaults to "" when absent.
    """
    def _snake(s: str) -> str:
        s = re.sub(r"[^\w]+", "_", (s or "").strip().lower())
        s = re.sub(r"_+", "_", s).strip("_")
        return s

    # Map of normalised aliases → canonical snake_case target
    alias_map: Mapping[str, str] = {
        "evidence_sources_base": "evidence_source_base",
        "evidence_source": "evidence_source_base",
        "evidence_sources": "evidence_source_base",
        "method": "methods",
        "framework": "framework_model",
        "argument_logic": "argumentation_logic",
        "argument": "argumentation_logic",
        "methodology_type": "method_type",
        "theme": "overarching_theme",
    }

    # Build lookup of the requested keys by their normalised form
    wanted_norm_to_out: Dict[str, str] = {}
    for k in note_keys:
        k_norm = _snake(k)
        wanted_norm_to_out[k_norm] = k  # keep caller's exact key for output

    # Locate a codes dict under a variety of shapes
    codes: dict[str, Any] = {}
    if isinstance(payload, dict):
        # direct
        if isinstance(payload.get("Note_code"), dict):
            codes = payload["Note_code"]  # type: ignore[assignment]
        elif isinstance(payload.get("note_code"), dict):
            codes = payload["note_code"]  # type: ignore[assignment]
        else:
            # nested under summary
            summary = payload.get("summary")
            if isinstance(summary, dict):
                if isinstance(summary.get("Note_code"), dict):
                    codes = summary["Note_code"]  # type: ignore[assignment]
                elif isinstance(summary.get("note_code"), dict):
                    codes = summary["note_code"]  # type: ignore[assignment]

    # Normalise incoming keys and build a temporary map
    extracted_norm: Dict[str, Any] = {}
    if isinstance(codes, dict):
        for raw_k, raw_v in codes.items():
            k_norm = _snake(str(raw_k))
            k_norm = alias_map.get(k_norm, k_norm)
            extracted_norm[k_norm] = raw_v

    def _value_to_str(v: Any) -> str:
        if v is None:
            return ""
        # list → comma-joined (flatten one level if nested lists appear)
        if isinstance(v, (list, tuple)):
            flat: list[str] = []
            for x in v:
                if isinstance(x, (list, tuple)):
                    flat.extend(str(y).strip() for y in x if str(y).strip())
                else:
                    sx = str(x).strip()
                    if sx:
                        flat.append(sx)
            return ", ".join(dict.fromkeys(flat))  # dedupe preserving order
        # dict → 'k=v' pairs
        if isinstance(v, dict):
            pairs: list[str] = []
            for k in sorted(v.keys(), key=lambda s: str(s).lower()):
                sval = str(v[k]).strip()
                if sval:
                    pairs.append(f"{k}={sval}")
            return ", ".join(pairs)
        # scalar
        return str(v).strip()

    # Prepare output with defaults
    out: Dict[str, str] = {wanted_norm_to_out[_snake(k)]: "" for k in note_keys}

    # Fill with available values
    for norm_key, out_key in wanted_norm_to_out.items():
        if norm_key in extracted_norm:
            out[out_key] = _value_to_str(extracted_norm[norm_key])

    return out

def _clean_multivalue(s: str) -> str:
        s = "" if s is None else str(s)
        if re.fullmatch(r"\s*=\s*([;,\|]\s*)+\s*", s):
            s = re.sub(r"^\s*=\s*", "", s)
        s = re.sub(r"[,\|/]", ";", s)
        s = re.sub(r"\s*;\s*", ";", s)
        s = re.sub(r";{2,}", ";", s)
        toks = [t.strip() for t in s.split(";") if t.strip()]
        return "; ".join(toks)
def shape_and_normalise_df(
    df: pd.DataFrame,
    *,
    # Core ordering; if None, try global CORE_COLUMNS, else infer from df
    core_columns: Optional[Sequence[str]] = None,
    # Cleaners; if None, use safe defaults
    multivalue_cleaner: Optional[Callable[[str], str]] = None,
    vocab_cleaner: Optional[Callable[[str], str]] = None,
    split_authors: Optional[Callable[[str], list[str]]] = None,
    # Extra numeric casts (name -> target kind). Defaults handle common ones.
    numeric_cast_cols: Optional[Mapping[str, str]] = None,
    # Optional user-supplied note dicts to merge (e.g., extra codes), keyed by item 'key'
    dynamic_notes: Optional[Mapping[str, Mapping[str, Any]]] = None,
    note_join_key: str = "key",
    # Optionally run an external normaliser at the end
    run_normalise_df_data: Optional[Callable[[pd.DataFrame], pd.DataFrame]] = None,
) -> pd.DataFrame:
    """
    One-pass DataFrame shaping:
    • Expand 'codes_flat' (if present).
    • Merge user 'dynamic_notes' by key (left join).
    • Ensure authors_list (list[str]) and canonical authors (semicolons).
    • Reorder columns (CORE columns first), cast numerics, clean multivalue/vocab cells.
    • Run external 'normalise_df_data' if provided or globally available.

    Returns a NEW DataFrame instance.
    """
    df = df.copy()

    # ---- defaults ----
    def _default_multivalue_cleaner(s: str) -> str:
        s = "" if s is None else str(s)
        # Strip Excel junk '=' when the cell is only delimiters
        if re.fullmatch(r"\s*=\s*([;,\|]\s*)+\s*", s):
            s = re.sub(r"^\s*=\s*", "", s)
        s = re.sub(r"[,\|/]", ";", s)          # unify delimiters to ';'
        s = re.sub(r"\s*;\s*", ";", s)         # collapse spaces around ';'
        s = re.sub(r";{2,}", ";", s)           # no double delimiters
        toks = [t.strip() for t in s.split(";") if t.strip()]
        return "; ".join(toks)

    def _default_vocab_cleaner(raw: Any) -> str:
        if raw is None:
            return ""
        s = raw if isinstance(raw, str) else ";".join(map(str, raw))
        s = re.sub(r"[\r\n]+", ";", s)
        s = re.sub(r"[,\|/]", ";", s)
        out: list[str] = []
        seen: set[str] = set()
        for tok in [t.strip() for t in s.split(";") if t.strip()]:
            m = re.match(r"^\s*#\s*topic\s*:\s*(.+)$", tok, flags=re.I)
            if m:
                val = m.group(1).strip()
                key = val.casefold()
                if val and key not in seen:
                    seen.add(key)
                    out.append(val)
                continue

            key = tok.casefold()
            if key not in seen:
                seen.add(key)
                out.append(tok)
        return "; ".join(out)

    def _default_split_authors(raw: str) -> list[str]:
        s = str(raw or "").strip()
        if not s:
            return []
        parts = re.split(r"\s*;\s*|\s*,\s*", s)
        out: list[str] = []
        seen: set[str] = set()
        for p in (x.strip() for x in parts if x.strip()):
            k = p.casefold()
            if k not in seen:
                seen.add(k)
                out.append(p)
        return out

    multivalue_cleaner = multivalue_cleaner or _default_multivalue_cleaner
    vocab_cleaner = vocab_cleaner or _default_vocab_cleaner
    split_authors = split_authors or _default_split_authors

    # Numeric casting defaults
    default_numeric_cast_cols: dict[str, str] = {
        "year": "Int64",
        "citations": "Int64",
        "word_count_for_attribution": "Int64",
        "attribution_mentions": "Int64",
    }
    if numeric_cast_cols:
        default_numeric_cast_cols.update(dict(numeric_cast_cols))
    numeric_cast_cols = default_numeric_cast_cols

    # ---- expand 'codes_flat' (older format) ----
    if "codes_flat" in df.columns:
        codes_df = df["codes_flat"].apply(
            lambda d: pd.Series(d) if isinstance(d, dict) else pd.Series(dtype="object")
        )
        # Avoid duplicating 'controlled_vocabulary_terms' if it already exists
        if "controlled_vocabulary_terms" in codes_df.columns and "controlled_vocabulary_terms" in df.columns:
            codes_df = codes_df.drop(columns=["controlled_vocabulary_terms"])
        df = pd.concat([df.drop(columns=["codes_flat"]), codes_df], axis=1)

    # ---- merge user dynamic notes by key ----
    if dynamic_notes:
        notes_df = pd.DataFrame.from_dict(dynamic_notes, orient="index")
        notes_df.index.name = note_join_key
        notes_df = notes_df.reset_index()
        if note_join_key in df.columns:
            df = df.merge(notes_df, how="left", on=note_join_key)
        else:
            # If key missing, just attach without join (rare). Safer to skip.
            pass

    # ---- authors_list and canonical authors ----
    if "authors" in df.columns:
        # If authors_list missing or invalid, rebuild from authors string
        if "authors_list" not in df.columns:
            df["authors_list"] = None
        need_build = df["authors_list"].isna() | ~df["authors_list"].apply(
            lambda v: isinstance(v, list) and len(v) > 0
        )
        if need_build.any():
            df.loc[need_build, "authors_list"] = df.loc[need_build, "authors"].map(split_authors)

        # Canonical authors string from list
        df["authors"] = df["authors_list"].apply(lambda L: "; ".join(L) if isinstance(L, list) else "")

    # ---- determine core ordering ----
    if core_columns is None:
        try:
            # use global if available
            core_columns = list(CORE_COLUMNS)  # type: ignore[name-defined]
        except Exception:
            # infer a sensible minimal core if not supplied
            guessed_core = [
                col for col in
                ["key", "title", "authors", "year", "source", "item_type", "abstract", "citations"]
                if col in df.columns
            ]
            core_columns = guessed_core

    # ---- reorder columns: core first, then sorted remainder ----
    core_set = set(core_columns or [])
    dynamic_cols = [c for c in df.columns if c not in core_set]
    ordered_cols = list(core_columns or []) + sorted(dynamic_cols)
    df = df.reindex(columns=ordered_cols, fill_value="")

    # ---- cast numerics ----
    for col, kind in (numeric_cast_cols or {}).items():
        if col in df.columns:
            if kind.lower() == "int64" or kind == "Int64":
                df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
            elif kind.lower() in {"float", "float64"}:
                df[col] = pd.to_numeric(df[col], errors="coerce").astype("float")
            else:
                # fallback: try pandas to_numeric then leave as-is if it fails
                df[col] = pd.to_numeric(df[col], errors="ignore")

    # ---- clean multivalue / vocab cells ----
    # Apply vocab_cleaner to controlled vocab terms if present
    # if "controlled_vocabulary_terms" in df.columns:
    #     df["controlled_vocabulary_terms"] = df["controlled_vocabulary_terms"].apply(vocab_cleaner)

    # Multivalue cleaner for common multivalue text columns
    for col in ["authors", "keywords", "place", "country", "affiliation", "urls_all"]:
        if col in df.columns:
            df[col] = df[col].apply(multivalue_cleaner)

    # Ensure authors_list stays a list (not stringified) after cleaning
    if "authors_list" in df.columns:
        # ensure list type
        df["authors_list"] = df["authors_list"].apply(
            lambda v: v if isinstance(v, list) else [t.strip() for t in str(v or "").split(";") if t.strip()]
        )
        # derive canonical string from the list
        df["authors"] = df["authors_list"].apply(lambda L: "; ".join([t for t in L if t]))
    elif "authors" in df.columns:
        # only if we truly don't have authors_list, derive it from authors
        df["authors"] = df["authors"].fillna("").astype(str).apply(_clean_multivalue)
        df["authors_list"] = df["authors"].apply(lambda s: [t.strip() for t in str(s).split(";") if t.strip()])

    # ---- external normaliser (optional) ----
    if run_normalise_df_data is not None:
        df = run_normalise_df_data(df)
    else:
        # Try a global function if present
        try:
            df = normalise_df_data(df)  # type: ignore[name-defined]
        except Exception:
            pass

    return df

from typing import Any, Dict, List, Optional
import  time
import pandas as pd
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
    tags = [t.get('tag', '').strip() for t in tags_list if t.get('tag')]
    # Increased filtering
    # tags = [t for t in tags if t and t not in ['edited', '#nosource', 'toread', 'important', 'note_complete', 'external-pdf', 'pdf', 'from_scopus', 'from_wos']]
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
def _is_blank(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        return v.strip() == ""
    try:
        # pd.isna(pd.NA) -> True (bool), pd.isna(list) -> array -> raises on bool()
        na = pd.isna(v)
        return bool(na) if isinstance(na, (bool,)) else False
    except Exception:
        return False

def _is_missing_value(v: Any) -> bool:
    if v is None:
        return True
    try:
        # handles pd.NA, np.nan, etc.
        if pd.isna(v):  # type: ignore[arg-type]
            return True
    except Exception:
        pass
    return isinstance(v, str) and v.strip() == ""


def get_note_meta_citation_country_place(item_key: str) -> dict:
    """
    Read all child notes of a Zotero item and extract:
      - citation (int): best available from Google Scholar "Cited by N",
                        Overton "Citations</th><td>N</td>", or WoS "Total Times Cited: N".
      - country (str|None): from Overton "Country</th><td>CountryName</td>" or loose "Country: X".
      - place (str|None): from HTML table cells labelled 'Place' or 'Location' if present.

    Args:
        item_key (str): Zotero parent item key

    Returns:
        dict: {"citation": int|None, "country": str|None, "place": str|None}
    """
    # --- helpers ---
    def _get_children_notes(client, key: str):
        # Try common PyZotero methods in order; fall back to empty list.
        children = None

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

    notes = _get_children_notes(zotero_client.zot, item_key)

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


def _apply_column_order(df_in: pd.DataFrame, cfg: dict | None) -> pd.DataFrame:
    """Return a new DataFrame with columns ordered as CORE + chosen codes + rest."""
    try:
        from general.app_constants import CORE_COLUMNS as APP_CORE
        core = [c for c in APP_CORE if c in df_in.columns]
    except Exception:
        core = [c for c in
                ["key", "title", "year", "authors", "url", "source", "citations", "item_type", "user_decision",
                 "user_notes"] if c in df_in.columns]

    # read selections from cfg (explicit list overrides codebook)
    code_columns: list[str] = []
    if cfg:
        explicit = cfg.get("code_columns") or []
        if isinstance(explicit, (list, tuple)) and explicit:
            code_columns = [c for c in explicit if c in df_in.columns]
        else:
            key = cfg.get("codebook_key")
            # prefer module-level CODEBOOKS if present; else defaults

            if isinstance(CODEBOOKS, dict) and key in CODEBOOKS:
                code_columns = list(CODEBOOKS[key])

                # ensure materialisation of missing requested columns
            for c in code_columns:
                if c not in df_in.columns:
                    df_in[c] = ""
            chosen = set(core) | set(code_columns)

    chosen = set(core) | set(code_columns)
    remainder = [c for c in df_in.columns if c not in chosen]
    ordered = core + code_columns + sorted(remainder)
    return df_in.reindex(columns=ordered)

# === (1) ADD JUST BELOW `_cb` HELPER — NEW HELPERS FOR pdf_path RESOLUTION ===
def _get_pdf_resolver(cache_cfg: Optional[Dict[str, Any]]):
    """
    Return a callable like resolver(item_key)->(str|None) using zotero_client_get_df.
    Looks in cache_config, then globals().
    """
    # Prefer explicit handle on config
    if cache_cfg:
        for k in ("zotero_client_get_df", "get_df", "zotero_get_df"):
            fn = cache_cfg.get(k)  # type: ignore[index]
            if callable(fn):
                return fn
    # Fallback to globals()
    for k in ("zotero_client_get_df", "get_df", "zotero_get_df"):
        fn = globals().get(k, None)
        if callable(fn):
            return fn
    return None

def _ensure_pdf_path_column(
    df_in: "pd.DataFrame",
    raw_items: Optional[List[Any]],
    cache_cfg: Optional[Dict[str, Any]],
) -> "pd.DataFrame":
    """
    Ensure df has a 'pdf_path' column by calling resolver(item_key) if available.
    Accepts DataFrame + raw_items but only needs an item key in df columns.
    """
    import pandas as _pd

    df = df_in.copy()
    if "pdf_path" in df.columns and df["pdf_path"].notna().any():
        return df

    key_col = "key" if "key" in df.columns else ("item_key" if "item_key" in df.columns else None)
    if not key_col:
        df["pdf_path"] = ""
        return df

    resolver = _get_pdf_resolver(cache_cfg)
    if resolver is None:
        df["pdf_path"] = ""
        return df

    _cache: dict[str, str] = {}

    def _fetch_path(k: Any) -> str:
        ks = str(k or "").strip()
        if not ks:
            return ""
        if ks in _cache:
            return _cache[ks]
        try:
            res = resolver(ks)
            # Accept several shapes: DataFrame with pdf_path/path, dict, or raw str
            if isinstance(res, _pd.DataFrame):
                if len(res) > 0:
                    if "pdf_path" in res.columns:
                        v = str(res["pdf_path"].iloc[0] or "")
                    elif "path" in res.columns:
                        v = str(res["path"].iloc[0] or "")
                    else:
                        v = ""
                else:
                    v = ""
            elif isinstance(res, dict):
                v = str(res.get("pdf_path") or res.get("path") or "")
            elif isinstance(res, str):
                v = res
            else:
                v = ""
        except Exception:
            v = ""
        _cache[ks] = v
        return v

    df["pdf_path"] = df[key_col].apply(_fetch_path)
    return df
# NEW HELPER: resolve zotero_client instance from cache_config or globals
def _get_zotero_client_from_config(cache_cfg: Optional[Dict[str, Any]]) -> Any:
    """
    Return a zotero client object, preferring cache_config entries, else globals().
    Expected to expose: et_pdf_path_for_item(item_key: str) -> str | None
    """
    if cache_cfg:
        for k in ("zotero_client", "client"):
            c = cache_cfg.get(k)  # type: ignore[index]
            if c is not None:
                return c
        for fk in ("client_factory", "zotero_client_factory"):
            fac = cache_cfg.get(fk)  # type: ignore[index]
            if callable(fac):
                try:
                    return fac()
                except Exception:
                    pass
    # Fallback to a global handle if present
    return globals().get("zotero_client", None)


# NEW HELPER: ensure df['pdf_path'] exists; fill via zotero_client.et_pdf_path_for_item(item_key)
def _fill_pdf_path_column(
    df_in: "pd.DataFrame",
    zc: Any,
    *,
    key_preference: tuple[str, ...] = ("key", "item_key"),
) -> "pd.DataFrame":
    """
    Ensure DataFrame has a 'pdf_path' column. If a zotero client is available, fill
    missing entries using zc.et_pdf_path_for_item(item_key).
    """
    import pandas as _pd

    df = df_in.copy()

    # Pick the item key column
    key_col = next((k for k in key_preference if k in df.columns), None)
    if "pdf_path" not in df.columns:
        df["pdf_path"] = ""

    if key_col is None or zc is None:
        return df

    # Build a simple cache to avoid repeated lookups
    _cache: dict[str, str] = {}

    def _resolve_item_pdf_path(k: Any) -> str:
        ks = str(k or "").strip()
        if not ks:
            return ""
        if ks in _cache:
            return _cache[ks]
        try:
            val = zc.et_pdf_path_for_item(ks)  # <- REQUIRED CALL
            if isinstance(val, _pd.Series):
                path = str(val.iloc[0] or "")
            elif isinstance(val, _pd.DataFrame):
                if len(val) > 0:
                    if "pdf_path" in val.columns:
                        path = str(val["pdf_path"].iloc[0] or "")
                    elif "path" in val.columns:
                        path = str(val["path"].iloc[0] or "")
                    else:
                        path = ""
                else:
                    path = ""
            elif isinstance(val, dict):
                path = str(val.get("pdf_path") or val.get("path") or "")
            elif isinstance(val, (list, tuple)):
                path = str(val[0] or "") if val else ""
            else:
                path = str(val or "")
        except Exception:
            path = ""
        _cache[ks] = path
        return path

    # Only fill blanks to avoid overwriting any pre-existing paths
    mask_blank = df["pdf_path"].astype(str).str.len().eq(0)
    if mask_blank.any():
        df.loc[mask_blank, "pdf_path"] = df.loc[mask_blank, key_col].apply(_resolve_item_pdf_path)

    return df
from typing import Any, Callable, Dict, List, Optional, Tuple
from pathlib import Path
import pickle
import pandas as pd


def load_data_from_source_for_widget(
    source_type: str = "zotero",
    file_path: Optional[str] = None,
    collection_name: Optional[str] = None,
    progress_callback: Optional[Callable[[str], None]] = None,
    cache_config: Optional[Dict[str, Any]] = None,
    cache: bool = True,
) -> Tuple[Optional[pd.DataFrame], Optional[List[Any]], str]:
    """
    Loads data from Zotero or a file.

    Cache semantics:
      - cache=True  → if a valid cache exists for the resolved collection, return (df, items, msg)
                      immediately with NO further processing or network calls.
      - cache=False → fetch fresh, process, write cache, and return the fresh result.
    """
    logger.info(
        "[Zotero_loader_to_df][debug] load_data_from_source_for_widget called "
        f"source_type={source_type} collection_name={collection_name} file_path={file_path} cache={cache}"
    )
    logger.info(
        "[Zotero_loader_to_df][debug] env LIBRARY_ID=%s LIBRARY_TYPE=%s API_KEY=%s",
        os.environ.get("LIBRARY_ID"),
        os.environ.get("LIBRARY_TYPE"),
        "***" if os.environ.get("API_KEY") else None,
    )
    logger = logging.getLogger("DataLoader")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    def _cb(msg: str) -> None:
        if progress_callback:
            progress_callback(msg)
        logger.info(msg)

    cfg_in: Dict[str, Any] = cache_config or {}

    base_dir = cfg_in.get("dir")
    zotero_cache_root = ZOTERO_DF_CACHE_DIR

    cfg: Dict[str, Any] = {
        "dir": (Path(str(base_dir)).expanduser().resolve() if base_dir else zotero_cache_root),
        "expiry": int(cfg_in.get("expiry", 40_000_400)),
        "use_latest_cache_if_no_collection": bool(cfg_in.get("use_latest_cache_if_no_collection", True)),
        "default_collection_name": (
            str(cfg_in.get("default_collection_name")) if cfg_in.get("default_collection_name") else None
        ),
        "code_columns": list(cfg_in.get("code_columns", [])),
    }

    import numpy as np

    cache_dir_path: Path = Path(cfg["dir"]) / f"numpy{str(np.__version__).split('.')[0]}"
    print("cache zotero path:>>", cache_dir_path)
    cache_dir_path.mkdir(parents=True, exist_ok=True)

    def _apply_order(df_in: pd.DataFrame) -> pd.DataFrame:
        return _apply_column_order(df_in, cfg)

    def _fill_pdf_paths_inplace(df_in: pd.DataFrame, do_lookup: bool) -> pd.DataFrame:
        df0 = df_in.copy()
        if "pdf_path" not in df0.columns:
            df0["pdf_path"] = ""

        key_col = "key" if "key" in df0.columns else ("item_key" if "item_key" in df0.columns else None)
        if key_col is None or not do_lookup:
            logger.info("PDF_PATH hydrate skipped (key_col=%r do_lookup=%s)", key_col, do_lookup)
            return df0

        if zotero_client is None:
            logger.info("PDF_PATH hydrate skipped (zotero_client is None)")
            return df0

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
            res = zotero_client.get_pdf_path_for_item(ks)
            path = _extract_path(res)
            cache_map[ks] = path
            return path

        mask = df0["pdf_path"].astype(str).str.len().eq(0)
        n_missing = int(mask.sum()) if hasattr(mask, "sum") else 0
        logger.info("PDF_PATH hydrate start missing=%d", n_missing)

        if n_missing:
            df0.loc[mask, "pdf_path"] = df0.loc[mask, key_col].apply(_resolve)

        logger.info("PDF_PATH hydrate done")
        return df0

    def _hydrate_cached(df_cached: pd.DataFrame, items_cached: List[Any]) -> pd.DataFrame:
        if "author_summary" not in df_cached.columns or df_cached["author_summary"].isna().all():
            auth = [((it.get("meta") or {}).get("creatorSummary") or "") for it in items_cached]
            n = len(df_cached)
            if len(auth) < n:
                auth += [""] * (n - len(auth))
            elif len(auth) > n:
                auth = auth[:n]
            df_cached["author_summary"] = auth
        drop_cols = ["attribution_mentions", "authors_list", "issue", "journal", "pages", "volume", "word_count_for_attribution"]
        df_cached = df_cached.drop(columns=[c for c in drop_cols if c in df_cached.columns], errors="ignore")
        return _apply_order(df_cached)

    _cb(f"Initiating data loading from '{source_type}'...")

    if source_type == "file":
        if file_path is None:
            return None, None, "File path is required."
        p = Path(file_path)
        if not p.exists():
            return None, None, f"File not found: {file_path}"

        _cb(f"Loading data from file: {p.name}")
        na_vals = ["", "#N/A", "NA", "NULL", "NaN", "None"]
        if p.suffix.lower() == ".csv":
            df_file = pd.read_csv(p, na_values=na_vals, keep_default_na=False)
        else:
            df_file = pd.read_excel(p, na_values=na_vals, keep_default_na=False)

        col_map = {
            "Title": "title", "Authors": "authors", "Year": "year",
            "Source title": "source", "controlled_vocabulary_terms": "controlled_vocabulary_terms",
            "Times Cited": "citations", "Document Type": "item_type",
            "Abstract": "abstract"
        }
        df_file.rename(columns=lambda c: col_map.get(c.strip(), c.strip().lower().replace(" ", "_")), inplace=True)
        df_file = shape_and_normalise_df(df_file, vocab_cleaner=lambda x: x)
        if "pdf_path" not in df_file.columns:
            df_file["pdf_path"] = ""
        drop_cols = ["attribution_mentions", "authors_list", "issue", "journal", "pages", "volume", "word_count_for_attribution"]
        df_file = df_file.drop(columns=[c for c in drop_cols if c in df_file.columns], errors="ignore")
        df_file = _apply_order(df_file)

        logger.info("FILE df shape=%r cols=%r", tuple(df_file.shape), [str(c) for c in df_file.columns[:60]])
        return df_file, None, f"Loaded {len(df_file)} rows from {p.name}"

    if source_type != "zotero":
        msg = f"Unknown source_type: {source_type}"
        _cb(msg)
        return None, None, msg

    cleaned_name = ""
    if isinstance(collection_name, str) and collection_name.strip():
        m = re.search(r"(?:collection\s*)?['\"]?(.*?)['\"]?$", collection_name.strip())
        cleaned_name = m.group(1).strip() if m else collection_name.strip()
    elif cfg["default_collection_name"] and cache:
        cleaned_name = str(cfg["default_collection_name"]).strip()

    cache_file: Path = get_zotero_cache_filepath(cleaned_name, cache_dir_path)

    def _read_cache_no_expiry(p: Path) -> tuple[Optional[pd.DataFrame], Optional[list[Any]]]:
        if not p.exists() or not p.is_file():
            return None, None
        with open(p, "rb") as f:
            blob = pickle.load(f)
        if isinstance(blob, dict):
            df0 = blob.get("dataframe")
            items0 = blob.get("raw_items")
            if isinstance(df0, pd.DataFrame) and isinstance(items0, list):
                return df0, items0
        return None, None

    def _latest_cache_file_in_dir(dir_path: Path) -> Optional[Path]:
        pats = ["*.pkl", "*.pickle"]
        out: list[Path] = []
        for pat in pats:
            out.extend([p for p in dir_path.glob(pat) if p.is_file()])
        if not out:
            return None
        out = sorted(out, key=lambda p: p.stat().st_mtime, reverse=True)
        return out[0]

    if cache:
        df_c: Optional[pd.DataFrame] = None
        items_c: Optional[list[Any]] = None
        used_path: Optional[Path] = None

        if cache_file.exists():
            df_c, items_c = _read_cache_no_expiry(cache_file)
            if df_c is not None and items_c is not None:
                used_path = cache_file

        if used_path is None and not cleaned_name and bool(cfg["use_latest_cache_if_no_collection"]):
            latest = _latest_cache_file_in_dir(cache_dir_path)
            if latest is not None:
                df_c, items_c = _read_cache_no_expiry(latest)
                if df_c is not None and items_c is not None:
                    used_path = latest

        if df_c is not None and items_c is not None and used_path is not None:
            cache_msg = f"Loaded {len(df_c)} records from cache file {used_path.name}."
            print(f"[CACHE] HIT: {cache_msg}", flush=True)
            _cb(cache_msg)

            df_ready = _hydrate_cached(df_c, items_c)

            req_cols: List[str] = []
            if cfg["code_columns"]:
                req_cols = list(dict.fromkeys([str(c) for c in cfg["code_columns"]]))

            core_cols = list(CORE_COLUMNS)
            view_cols = core_cols + [c for c in req_cols if c not in core_cols]
            df_ready = shape_and_normalise_df(df_ready, core_columns=view_cols, vocab_cleaner=lambda x: x)

            return df_ready, items_c, cache_msg

        print(f"[CACHE] MISS: {cache_file.name}", flush=True)

    _cb(f"Fetching from Zotero API: Collection='{cleaned_name or 'All Items'}'...")
    items: List[dict] = fetch_zotero_items(collection_name=cleaned_name or None)
    _cb(f"Retrieved {len(items)} raw items.")
    print(f"[ZOTERO] fetched items={len(items)}", flush=True)

    if not items:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_file, "wb") as f:
            pickle.dump({"dataframe": pd.DataFrame(), "raw_items": []}, f)
        _cb(f"Wrote empty cache file: {cache_file.name}")
        return pd.DataFrame(), [], "No items in Zotero collection."

    debug_items_limit = int(cfg_in.get("debug_items_limit", 0) or 0)
    items_for_build = items[:debug_items_limit] if debug_items_limit > 0 else items
    _cb(f"Build input: items={len(items_for_build)} (limit={debug_items_limit})")
    print(f"[ZOTERO] build_input items={len(items_for_build)} limit={debug_items_limit}", flush=True)

    fast_mode = bool(cfg_in.get("fast_mode", False))
    heartbeat_every = int(cfg_in.get("debug_heartbeat_every", 25) or 25)
    _cb(f"DF builder: {'FAST' if fast_mode else 'FULL'}")
    print(f"[ZOTERO] df_builder={'FAST' if fast_mode else 'FULL'}", flush=True)

    _cb("Building dataframe from raw items…")
    print("[ZOTERO] build_df_from_zotero_items: call", flush=True)

    df = build_df_from_zotero_items(
        items=items_for_build,
        fast_mode=fast_mode,
        heartbeat_every=heartbeat_every,
        progress_callback=_cb,
    )

    print(f"[ZOTERO] build_df_from_zotero_items: return shape={tuple(df.shape)}", flush=True)
    print(f"[ZOTERO] df columns={list(df.columns)[:40]}", flush=True)
    print(f"[ZOTERO] df head(3)={df.head(3).to_dict(orient='records')}", flush=True)

    if "author_summary" not in df.columns or df["author_summary"].isna().all():
        auth_list: List[str] = [((it.get("meta") or {}).get("creatorSummary") or "") for it in items_for_build]
        n = len(df)
        if len(auth_list) < n:
            auth_list += [""] * (n - len(auth_list))
        elif len(auth_list) > n:
            auth_list = auth_list[:n]
        df["author_summary"] = auth_list
    _cb("PDF path hydration: ON")
    print("[ZOTERO] pdf_hydrate=True", flush=True)

    df = _fill_pdf_paths_inplace(df, do_lookup=True)
    print(f"[ZOTERO] after _fill_pdf_paths_inplace shape={tuple(df.shape)}", flush=True)

    def _clean_multivalue(s: str) -> str:
        s = "" if s is None else str(s)
        if re.fullmatch(r"\s*=\s*([;,\|]\s*)+\s*", s):
            s = re.sub(r"^\s*=\s*", "", s)
        s = re.sub(r"[,\|/]", ";", s)
        s = re.sub(r"\s*;\s*", ";", s)
        s = re.sub(r";{2,}", ";", s)
        toks = [t.strip() for t in s.split(";") if t.strip()]
        return "; ".join(toks)

    for col in ["authors", "controlled_vocabulary_terms", "keywords", "place", "country", "affiliation", "urls_all"]:
        if col in df.columns:
            df[col] = df[col].apply(_clean_multivalue)

    drop_cols = [
        "attribution_mentions",
        "authors_list",
        "issue",
        "journal",
        "pages",
        "volume",
        "word_count_for_attribution",
    ]
    df = df.drop(columns=[c for c in drop_cols if c in df.columns], errors="ignore")
    df = _apply_order(df)

    req_cols: List[str] = []
    if cfg["code_columns"]:
        req_cols = list(dict.fromkeys([str(c) for c in cfg["code_columns"]]))

    core_cols = list(CORE_COLUMNS)
    view_cols = core_cols + [c for c in req_cols if c not in core_cols]
    df = shape_and_normalise_df(df, core_columns=view_cols, vocab_cleaner=lambda x: x)

    write_zotero_cache(cache_file, df, items)
    _cb(f"Wrote fresh cache file: {cache_file.name}")

    print(f"[ZOTERO] final df head(3)={df.head(3).to_dict(orient='records')}", flush=True)
    return df, items, f"Loaded {len(df)} records from Zotero."


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

def enrich_pdf_metadata(zotero_client: Any, item_key: str) -> Dict[str, Any]:
    """
    Resolve local PDF path and extract references + in-text citations via process_pdf().

    Uses the passed-in `zotero_client` directly.
    Raises if the client or process_pdf are missing.
    """
    if zotero_client is None or not hasattr(zotero_client, "get_pdf_path_for_item"):
        raise AttributeError("zotero_client.get_pdf_path_for_item is required")
    if "process_pdf" not in globals():
        raise NameError("process_pdf(...) must be defined in scope")

    pdf_path_obj = zotero_client.get_pdf_path_for_item(item_key)
    pdf_path = str(pdf_path_obj) if pdf_path_obj is not None else ""
    if not (isinstance(pdf_path, str) and pdf_path.lower().endswith(".pdf")):
        return {"pdf_path": "", "references": "", "intext_citations": ""}

    parsed = process_pdf(pdf_path=pdf_path)  # may raise; let it bubble up
    if not isinstance(parsed, dict):
        return {"pdf_path": pdf_path, "references": "", "intext_citations": ""}

    refs = parsed.get("references", [])
    intext = parsed.get("citations", "")

    out: Dict[str, Any] = {"pdf_path": pdf_path, "references": "", "intext_citations": ""}
    if isinstance(refs, list):
        out["references"] = refs
    elif isinstance(refs, str):
        out["references"] = refs.strip()
    elif refs is not None:
        out["references"] = str(refs).strip()

    out["intext_citations"] = intext if intext is not None else ""
    return out

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
def process_single_zotero_item_for_df(
    item_data_block: dict,
    fallback_key: str,
    *,
    note_keys: Optional[Set[str]] = None,
) -> dict:
    """
    Definitive per-item row builder (strict + payload-first) that ALSO performs
    the same overwrite/parsing/enrichment logic previously done in the build loop:
      • authors fields are replaced when empty/[] or delimiter-only strings
      • source is filled if blank or placeholder (N/A/NA/None/False)
      • citations are backfilled (payload → Extra → child notes)
      • pdf_path/references/intext_citations via enrich_pdf_metadata()
      • codes from Note_code are merged (when note_keys provided)
      • emits debug prints for authors & source
    """
    import re
    import logging

    # ---------- guards ----------
    if not isinstance(item_data_block, dict) or not item_data_block:
        raise ValueError("process_single_zotero_item_for_df: invalid item_data_block")

    if "zotero_client" not in globals() or zotero_client is None:
        raise AttributeError("process_single_zotero_item_for_df requires a module-level zotero_client")
    if not hasattr(zotero_client, "get_item_payload"):
        raise AttributeError("zotero_client.get_item_payload(...) is required")

    required = [
        "get_note_meta_citation_country_place",
        "parse_zotero_year",
        "get_document_type",
        "get_source_title",
        "parse_citation_count",
        "parse_creators_authors",
        "infer_source",
        "parse_payload_counts",
        "parse_payload_affiliation",
        "parse_payload_urls_attachments",
        "enrich_pdf_metadata",
    ]
    for fn in required:
        if fn not in globals():
            raise NameError(f"{fn}(...) must be defined")

    # ---------- helpers ----------
    def _to_int_safe(x):
        try:
            return int(x)
        except Exception:
            return None

    def _norm_join(values) -> str:
        if isinstance(values, list):
            vals = [str(v).strip() for v in values if str(v).strip()]
            return ", ".join(vals)
        return str(values).strip() if values is not None else ""

    def _is_blank_scalar(v: Any) -> bool:
        if v is None:
            return True
        if isinstance(v, str) and v.strip() == "":
            return True
        try:
            import pandas as _pd
            if _pd.isna(v):
                return True
        except Exception:
            pass
        return False

    def _authors_list_is_effectively_empty(v: Any) -> bool:
        if not isinstance(v, list) or len(v) == 0:
            return True
        return all(str(t).strip() == "" for t in v)

    def _authors_str_is_placeholder(s: Any) -> bool:
        """
        True if authors string is empty OR only delimiters/whitespace.
        Examples that return True: '', '; ; ', ', ,', ' | | '
        """
        if _is_blank_scalar(s):
            return True
        s = str(s)
        if re.sub(r"[;,\|\s]+", "", s) == "":
            return True
        toks = [t.strip() for t in re.split(r"[;,\|]", s)]
        return not any(toks)

    def _needs_citation_backfill(v: Any) -> bool:
        if _is_blank_scalar(v):
            return True
        try:
            return int(v) <= 0
        except Exception:
            return True

    def _source_is_placeholder(v: Any) -> bool:
        if v is False:
            return True
        s = str(v or "").strip().upper()
        return s in {"N/A", "NA", "NONE", "FALSE"}

    # ---------- base bibliographic ----------
    key = item_data_block.get("key", fallback_key)
    rec = {
        "key":   key,
        "title": item_data_block.get("title", "N/A"),
        "year":  parse_zotero_year(item_data_block.get("date", "")),
        "abstract": item_data_block.get("abstractNote", ""),
        "url":      item_data_block.get("url", ""),
        "doi":      item_data_block.get("DOI", ""),
        "item_type": get_document_type(item_data_block.get("itemType", "unknown")),
        "publicationTitle": item_data_block.get("publicationTitle", ""),
        "journal": item_data_block.get("journalAbbreviation", item_data_block.get("publicationTitle", "")),
        "volume": item_data_block.get("volume", ""),
        "issue":  item_data_block.get("issue", ""),
        "pages":  item_data_block.get("pages", ""),
        "source": get_source_title(item_data_block),
    }

    # collections directly from item.data
    colls = item_data_block.get("collections") or []
    if isinstance(colls, list) and colls:
        rec["collections"] = colls

    # ---------- AUTHORS (initial – simple from creators) ----------
    creators = item_data_block.get("creators") or []
    if creators:
        tokens = []
        ok_types = {"author", "editor", "presenter", "contributor"}
        for c in creators:
            if not isinstance(c, dict):
                continue
            ctype = str(c.get("creatorType", "")).lower()
            if ctype and ctype not in ok_types:
                continue
            nm = str(c.get("name", "")).strip()
            if nm:
                tokens.append(nm)
            else:
                first = str(c.get("firstName", "")).strip()
                last  = str(c.get("lastName", "")).strip()
                nm = (f"{first} {last}".strip() if (first or last) else "")
                if nm:
                    tokens.append(nm)
        # dedupe, preserve order
        seen = set()
        authors_list = []
        for t in tokens:
            kcf = t.casefold()
            if kcf not in seen and t:
                seen.add(kcf)
                authors_list.append(t)
        rec["authors_list"] = authors_list
        rec["authors"] = "; ".join(authors_list) if authors_list else ""
    else:
        rec["authors_list"] = []
        rec["authors"] = ""

    # ---------- DEBUG (pre) ----------
    pre_authors_list = rec.get("authors_list", [])
    pre_authors_str = rec.get("authors", "")
    pre_source = rec.get("source", "")
    pre_year = rec.get("year", None)
    pre_creator_summary = rec.get("creator_summary", "")

    #
    # # ---------- Robust overwrite for authors/year/source using parser helpers ----------
    # Wrap item_data for helpers that expect the full item dict
    full_item = {"data": item_data_block}

    auth_info = parse_creators_authors(full_item)

    inferred_source = infer_source(full_item)

    overwrote_authors_list = False
    if _authors_list_is_effectively_empty(rec.get("authors_list")):
        rec["authors_list"] = auth_info["authors_list"]
        overwrote_authors_list = True

    overwrote_authors = False
    if _authors_str_is_placeholder(rec.get("authors")):
        rec["authors"] = auth_info["authors_str"]
        overwrote_authors = True
    elif overwrote_authors_list and _authors_str_is_placeholder(rec.get("authors")):
        rec["authors"] = "; ".join([t for t in rec["authors_list"] if str(t).strip()])
        overwrote_authors = True

    if _is_blank_scalar(rec.get("creator_summary")):
        rec["creator_summary"] = auth_info["creator_summary"]
    if _is_blank_scalar(rec.get("year")):
        rec["year"] = auth_info["year"]

    overwrote_source = False
    if _is_blank_scalar(rec.get("source")) or _source_is_placeholder(rec.get("source")):
        if not _is_blank_scalar(inferred_source) and not _source_is_placeholder(inferred_source):
            rec["source"] = inferred_source
            overwrote_source = True
    #
    # print(f"[post]  key={key} authors_list={rec.get('authors_list')} "
    #       f"authors='{rec.get('authors')}' creator_summary='{rec.get('creator_summary')}' "
    #       f"year={rec.get('year')} source='{rec.get('source')}' "
    #       f"(overwrote_authors_list={overwrote_authors_list} "
    #       f"overwrote_authors={overwrote_authors} overwrote_source={overwrote_source})")

    # ---------- KEYWORDS (from ITEM tags, not children/attachments) ----------
    raw_tags = item_data_block.get("tags") or []
    logging.info("Keywords: item %s has %d raw Zotero tags", key, len(raw_tags) if isinstance(raw_tags, list) else 0)

    keywords_value = ""
    if isinstance(raw_tags, list):
        tag_strs = []
        for t in raw_tags:
            if isinstance(t, dict) and t.get("tag"):
                tag_strs.append(str(t["tag"]).strip())
            elif isinstance(t, str):
                tag_strs.append(t.strip())

        exclude_substrings = [
            # "core", "included", "note", "keyword", "inclusion", "test",
            # "abs", "added", "origin", "records", "0", "min", "max",
            # "edited", "#nosource", "toread", "important", "note_complete",
            # "external-pdf", "pdf", "from_scopus", "from_wos", "_tablet", "unread"
        ]

        clean = []
        seen_tags = set()
        for tag in tag_strs:
            low = tag.lower()
            if not tag:
                continue
            if low not in seen_tags:
                seen_tags.add(low)
                clean.append(low)

        if clean:
            keywords_value = "; ".join(clean)

        logging.info(
            "Keywords: item %s -> kept %d/%d tags after filtering%s",
            key, len(clean), len(tag_strs),
            f" (example: {', '.join(clean[:5])})" if clean else ""
        )

    rec["controlled_vocabulary_terms"] = keywords_value

    # ---------- payload (STRICT) ----------
    payload = zotero_client.get_item_payload(key)
    if not isinstance(payload, dict):
        raise ValueError(f"get_item_payload returned invalid type for key={key}: {type(payload)}")

    summary = payload.get("summary")
    if not isinstance(summary, dict):
        raise ValueError(f"payload.summary missing/invalid for key={key}")

    payload_note = summary.get("payload_note")
    if not isinstance(payload_note, dict):
        payload_note = {}

    # ---------- counts ----------
    counts = parse_payload_counts(item_data_block, payload or {})
    for k, v in counts.items():
        if _is_blank_scalar(rec.get(k)) and v is not None:
            rec[k] = v
    if _is_blank_scalar(rec.get("citations")):
        # Extra fallback if counts didn't fill it
        rec["citations"] = parse_citation_count(item_data_block.get("extra"))

    # ---------- places / countries / affiliations ----------
    affbits = parse_payload_affiliation(item_data_block, payload or {})
    for k, v in affbits.items():
        if _is_blank_scalar(rec.get(k)) and v:
            rec[k] = v

    try:
        themes_joined = parse_theme_tags(item_data_block, return_joined=True)  # "#theme:..." only
        if _is_blank_scalar(rec.get("theme")) and themes_joined:
            rec["theme"] = themes_joined
    except Exception as _e:
        logging.debug("parse_theme_tags warning: %s", _e)

    # ---------- urls + attachments ----------
    urlbits = parse_payload_urls_attachments(payload or {})
    for k, v in urlbits.items():
        if _is_blank_scalar(rec.get(k)) and v:
            rec[k] = v

    # ---------- requested codes from Note_code ----------
    if note_keys:
        # expects helper extract_note_codes(payload, note_keys) present in module
        if "extract_note_codes" in globals():
            codes_map = extract_note_codes(payload or {}, note_keys)  # type: ignore[name-defined]
            for k, v in codes_map.items():
                if _is_blank_scalar(rec.get(k)) and str(v).strip():
                    rec[k] = v

    # ---------- FINAL FALLBACK: child notes for citations/country/place ----------
    note_meta = get_note_meta_citation_country_place(key)
    if _needs_citation_backfill(rec.get("citations")) and isinstance(note_meta.get("citation"), int):
        rec["citations"] = note_meta["citation"]
    if _is_blank_scalar(rec.get("country")) and note_meta.get("country"):
        rec["country"] = note_meta["country"]
    if _is_blank_scalar(rec.get("place")) and note_meta.get("place"):
        rec["place"] = note_meta["place"]
    #
    # # ---------- PDF enrichment ----------
    # try:
    #     pdfbits = enrich_pdf_metadata(zotero_client, key)
    #     if _is_blank_scalar(rec.get("pdf_path")) and pdfbits.get("pdf_path"):
    #         rec["pdf_path"] = pdfbits["pdf_path"]
    #     if _is_blank_scalar(rec.get("references")) and pdfbits.get("references") not in (None, ""):
    #         rec["references"] = pdfbits["references"]
    #     if _is_blank_scalar(rec.get("intext_citations")) and pdfbits.get("intext_citations") not in (None, ""):
    #         rec["intext_citations"] = pdfbits["intext_citations"]
    # except Exception as e:
    #     print(f"[pdf   ] key={key} enrich_pdf_metadata error: {e}")
    #     # keep building the row; do not raise

    # ---------- attribution_mentions ----------
    if "attribution_mentions" not in rec:
        import re as _re
        text = f"{rec.get('title','')} {rec.get('abstract','')}"
        rec["attribution_mentions"] = len(_re.findall(r"\battribution\b", str(text), flags=_re.IGNORECASE))

    # ---------- drop unwanted columns if they slipped in ----------
    for k in ("language", "raw_extra", "funding", "author_list"):
        if k in rec:
            rec.pop(k, None)

    return rec
# ---------- tiny utils ----------
def _is_blank_scalar(v: Any) -> bool:
    """True for None / '' / whitespace / NaN / pd.NA."""
    if v is None:
        return True
    # pandas-aware NA
    try:
        if pd.isna(v):
            return True
    except Exception:
        pass
    # plain string empties
    if isinstance(v, str) and v.strip() == "":
        return True
    # float NaN
    if isinstance(v, float) and math.isnan(v):
        return True
    return False


def backfill_note_meta_fields(df: pd.DataFrame, zotero_client: Any) -> pd.DataFrame:
    """
    If any of ['citations','country','place'] are empty for a row,
    call get_note_meta_citation_country_place(zotero_client, key) and fill them.

    Hard-fails if helper function is missing.
    """
    if "get_note_meta_citation_country_place" not in globals():
        raise NameError("get_note_meta_citation_country_place(...) must be defined")

    # Ensure the required columns exist so we can safely assign into them
    for col in ("citations", "country", "place"):
        if col not in df.columns:
            df[col] = pd.Series([pd.NA] * len(df), index=df.index)

    # Iterate only rows that actually need backfill
    for idx, row in df.iterrows():
        need_cit = _is_blank_scalar(row.get("citations"))
        need_cty = _is_blank_scalar(row.get("country"))
        need_pla = _is_blank_scalar(row.get("place"))
        if not (need_cit or need_cty or need_pla):
            continue

        item_key = row.get("key")
        if _is_blank_scalar(item_key):
            continue  # nothing we can do without a key

        meta = get_note_meta_citation_country_place( str(item_key))

        if need_cit and isinstance(meta.get("citation"), int):
            df.at[idx, "citations"] = meta["citation"]

        if need_cty and isinstance(meta.get("country"), str) and meta["country"].strip():
            df.at[idx, "country"] = meta["country"].strip()

        if need_pla and isinstance(meta.get("place"), str) and meta["place"].strip():
            df.at[idx, "place"] = meta["place"].strip()

    return df
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Set, Tuple
import logging, math, re
import pandas as pd
def build_df_from_zotero_items(
    items: List[dict],
    *,
    core_columns: Optional[Sequence[str]] = None,
    dynamic_notes: Optional[Mapping[str, Mapping[str, Any]]] = None,
    note_keys: Optional[Set[str]] = None,
    run_normalise_df_data: Optional[Callable[[pd.DataFrame], pd.DataFrame]] = None,
    fast_mode: bool = True,
    heartbeat_every: int = 25,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> pd.DataFrame:
    """
    ###1. fast_mode=True builds from item['data'] + item['meta'] only (no per-item network calls)
    ###2. fast_mode=False delegates to process_single_zotero_item_for_df (may call Zotero API per item)
    ###3. always returns a shaped/normalised DataFrame
    """
    def _cb(msg: str) -> None:
        if progress_callback:
            progress_callback(msg)

    def _safe_str(v: Any) -> str:
        return "" if v is None else str(v)

    def _year_from_data(d: dict) -> Any:
        v = d.get("year")
        if v is not None and str(v).strip():
            return v
        date = _safe_str(d.get("date") or "")
        m = re.search(r"\b(\d{4})\b", date)
        return int(m.group(1)) if m else None

    def _source_from_data(d: dict) -> str:
        return _safe_str(
            d.get("publicationTitle")
            or d.get("journalAbbreviation")
            or d.get("conferenceName")
            or d.get("proceedingsTitle")
            or d.get("bookTitle")
            or d.get("publisher")
            or ""
        )

    def _row_fast(item: dict, i: int) -> dict:
        d = (item or {}).get("data") or {}
        m = (item or {}).get("meta") or {}

        key = _safe_str(item.get("key") or d.get("key") or f"row_{i}")
        item_type = _safe_str(d.get("itemType") or "")
        title = _safe_str(d.get("title") or "")
        author_summary = _safe_str(m.get("creatorSummary") or "")
        abstract = _safe_str(d.get("abstractNote") or "")
        doi = _safe_str(d.get("DOI") or "")
        url = _safe_str(d.get("url") or "")
        year = _year_from_data(d)
        source = _source_from_data(d)

        colls = d.get("collections") or []
        if not isinstance(colls, list):
            colls = []

        return {
            "key": key,
            "item_type": item_type,
            "title": title,
            "year": year,
            "source": source,
            "authors": author_summary,
            "author_summary": author_summary,
            "abstract": abstract,
            "doi": doi,
            "url": url,
            "collections": colls,
        }

    records: List[dict] = []
    total = len(items or [])
    _cb(f"build_df_from_zotero_items: start items={total} fast_mode={bool(fast_mode)} heartbeat_every={int(heartbeat_every)}")

    if fast_mode:
        for i, item in enumerate(items or [], start=1):
            if heartbeat_every > 0 and (i == 1 or i % heartbeat_every == 0 or i == total):
                d = (item or {}).get("data") or {}
                _cb(f"build_df progress {i}/{total} key={repr(str(item.get('key') or d.get('key') or ''))} title={repr(str(d.get('title') or '')[:80])}")
            records.append(_row_fast(item, i))
    else:
        if "process_single_zotero_item_for_df" not in globals():
            raise NameError("process_single_zotero_item_for_df(...) must be defined")

        for i, item in enumerate(items or [], start=1):
            data_block = (item or {}).get("data", {}) if isinstance(item, dict) else {}
            if heartbeat_every > 0 and (i == 1 or i % heartbeat_every == 0 or i == total):
                _cb(f"build_df progress {i}/{total} key={repr(str((item or {}).get('key') or data_block.get('key') or ''))} title={repr(str(data_block.get('title') or '')[:80])}")
            records.append(process_single_zotero_item_for_df(data_block, f"fb_{i}", note_keys=note_keys))

    df = pd.DataFrame(records)

    df = shape_and_normalise_df(
        df,
        core_columns=core_columns,
        dynamic_notes=dynamic_notes,
        run_normalise_df_data=run_normalise_df_data,
        vocab_cleaner=lambda x: x,
    )

    if "print_missing_coding_keys" in globals():
        print_missing_coding_keys(df, key_col="key")

    _cb(f"build_df_from_zotero_items: done rows={int(df.shape[0])} cols={int(df.shape[1])}")
    return df

#
# df,a,aa=load_data_from_source_for_widget(collection_name="0.13_cyber_attribution_corpus_records_total_included",cache=False)
# print(df.keys())
def debug_pdf_quote_hits() -> None:
    """
    Build a fixed test set from logged [PDFSCAN][MISS] lines, call
    find_text_page_and_section(**params) for each, and print a summary
    of page, section_title and section_text hit rates.
    """
    params = [
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\8HHILB7U\Brown and Fazal - 2021 - #SorryNotSorry why states neither confirm nor deny responsibility for cyber operations.pdf",
            "text": "even if a covert cyber operation is exposed and the victim accuses the perpetrat",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\BRV2AQNH\Grotto - 2020 - Deconstructing cyber attribution a proposed framework and lexicon.pdf",
            "text": "a victim's willingness to cooperate with authorities or other third parties is a",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\QLZR6EEJ\Tanyildizi - 2017 - State responsibility in cyberspace the problem of attribution of cyberattacks conducted by non-stat.pdf",
            "text": "i formulate, without any substantial modification, the principles of attribution",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\I8FCUR9B\YC8AZ2N5.pdf",
            "text": "therefore, if a cyber attack reaches a threshold that threatens security and pea",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\BSWYT548\Whyte - 2025 - The subversion aversion paradox juxtaposing the tactical and strategic utility of cyber-enabled inf.pdf",
            "text": "cyber attacks that attempt to aid a broader influence campaign via direct attack",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\9P8GFMK2\Chircop - 2018 - A DUE DILIGENCE STANDARD OF ATTRIBUTION IN CYBERSPACE.pdf",
            "text": "there is a 'three-level problem of attribution in cyberspace' which inhibits bac",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\3DAQIG8K\23738871.2024.2436591.pdf",
            "text": "allow both states to claim plausible deniability for proxy actions and exploit t",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\I8FCUR9B\YC8AZ2N5.pdf",
            "text": "the unwillingness of states, as well as non-state actors, to have their behavior",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\QLZR6EEJ\Tanyildizi - 2017 - State responsibility in cyberspace the problem of attribution of cyberattacks conducted by non-stat.pdf",
            "text": "attribution constitutes a question of law before being a question of fact... [i]",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Downloads\Cyber threat attribution, trust and confidence, and the contestability of national security policy_25_11_16_12_54_43.pdf",
            "text": "attribution for wannacry was formally announced by the white house in december 2",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\A6AQT75H\Alweqyan - 2024 - Cyberattacks in the context of international law enforcement.pdf",
            "text": "acknowledging any state's responsibility for a cyber intrusion has proven to be ",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\2SKNXIKR\(S Haataja, 2020).pdf",
            "text": "as such, they emphasise the importance of the right to take urgent countermeasur",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\I8FCUR9B\YC8AZ2N5.pdf",
            "text": "despite the fact that the un charter was adopted in 1945 when the idea of cybers",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
        {
            "pdf_path": r"C:\Users\luano\Zotero\storage\QLZR6EEJ\Tanyildizi - 2017 - State responsibility in cyberspace the problem of attribution of cyberattacks conducted by non-stat.pdf",
            "text": "attribution of cyber attacks remains one of the most difficult tasks in identify",
            "page": True,
            "section": True,
            "cache": False,
            "cache_full": False,
            "case_sensitive": False,
        },
    ]

    total = len(params)
    pages_found = 0
    section_titles_found = 0
    section_texts_found = 0

    for param in params:
        hit = find_text_page_and_section(**param)
        page_val = hit.get("page")
        title_val = hit.get("section_title")
        text_val = hit.get("section_text")
        if page_val is not None:
            pages_found = pages_found + 1
        if title_val:
            section_titles_found = section_titles_found + 1
        if text_val:
            section_texts_found = section_texts_found + 1

        # print("PDF:", param["pdf_path"])
        # input("cont")
        #
        # print("TEXT:", param["text"])
        # input("cont")


        print("HIT:", hit)
        input("cont")

        print("-" * 40)

    print("DEBUG SUMMARY")
    print("Total cases:", total)
    input("cont")

    print("Pages found:", pages_found, "of", total)
    input("cont")

    print("Section titles found:", section_titles_found, "of", total)
    input("cont")

    print("Section texts found:", section_texts_found, "of", total)

pdf=r"C:\Users\luano\Zotero\storage\Q6XC4J4X\Welburn et al. - 2023 - Cyber deterrence with imperfect attribution and unverifiable signaling.pdf"


# print(process_pdf(pdf_path=pdf))
# debug_pdf_quote_hits()
