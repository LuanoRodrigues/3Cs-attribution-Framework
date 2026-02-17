
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QTextCursor, QTextCharFormat, QColor
from PyQt6.QtWidgets import (
    QApplication, QWidget, QHBoxLayout, QVBoxLayout, QPushButton,
    QTextEdit, QSplitter, QLabel,
     QMessageBox, QLineEdit, QTreeWidget, QTreeWidgetItem,
     QStackedWidget, QTextBrowser, QComboBox
)

from markdown_it import MarkdownIt

from pathlib import Path

from dotenv import load_dotenv

from python_backend_legacy.llms.footnotes_parser import link_citations_to_footnotes

load_dotenv()  # loads the variables from .env
import os
global count
count = 0
mistral_key= os.environ.get("MISTRAL_API_KEY")
# print(mistral_key)
CACHE_DIR = Path.home() / "annotarium" / "cache" / "mistral" / "files"
CACHE_DIR.mkdir(exist_ok=True)


import subprocess
import sys,contextlib

from typing import  OrderedDict, Set



import random
import tempfile

import logging




from mistralai import  models as m_models



from typing import  Union, Tuple


import hashlib

import re, time, html
from pathlib import Path
from typing import List, Dict, Optional, Any

from dotenv import load_dotenv
from mistralai import Mistral

# Ensure environment variables are loaded (e.g., from a .env file)
load_dotenv()

# --- Globals and Configuration ---
count = 0

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
MD_HEADING_RE      = re.compile(r'^\s*(#{1,6})\s*(?P<title>.+)$')
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
        if not t:
            return None
        if _is_caption(t):
            return None
        title = t.strip()
        lvl = len(m.group(1))  # group(1) is the leading #{1,6}
        return lvl, title, title, 'md', None

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
_NUM_RE = NUM_RE

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








# def markdown_parser(md_text: str) -> Tuple[List[Tuple[int, str]], Dict[str, str]]:
#     from collections import OrderedDict
#     import re
#
#     md_text = md_text.replace("\u00A0", " ")
#     lines = md_text.splitlines()
#
#     SKIP_HEAD_RE = re.compile(
#         r'^(dates?|issn|journal homepage|to cite this article|to link to this article|'
#         r'published online|submit your article|article views|view related articles|'
#         r'view crossmark data|citing articles)\b',
#         re.IGNORECASE
#     )
#     HEADING_RX = re.compile(r'^(?P<hashes>#{1,6})\s+(?P<title>.+?)\s*$', re.MULTILINE)
#
#     def clean_title(t: str) -> str:
#         return t.strip().rstrip(":-–—·")
#
#     def is_junk(t: str) -> bool:
#         return SKIP_HEAD_RE.match(t) or _is_caption(t)
#
#     def word_count(s: str) -> int:
#         return len(re.findall(r'\w+', s))
#
#     def gather(level: int) -> List[Tuple[int,str]]:
#         out = []
#         for i, ln in enumerate(lines):
#             m = re.match(r'^' + r'#'*level + r'\s+(.*\S)', ln)
#             if m:
#                 title = clean_title(m.group(1))
#                 if title:
#                     out.append((i, title))
#         return out
#
#     def split_on(heads: List[Tuple[int,str]], min_words: int) -> OrderedDict[str,str]:
#         d = OrderedDict()
#         for idx, title in heads:
#             start = idx + 1
#             # next heading
#             nxt = next((j for j,t in heads if j>idx), len(lines))
#             body = "\n".join(lines[start:nxt]).strip()
#             if is_junk(title):
#                 continue
#             if word_count(body) < min_words:
#                 continue
#             d[title] = body
#         return d
#
#     # --- NEW: level-1 priority if at least 4 sections ---
#     lvl1 = gather(1)
#     if len(lvl1) >= 4:
#         grouped = split_on(lvl1, min_words=1)
#         return _finish(grouped)
#
#     # --- else try level-2 if at least 4 sections ---
#     lvl2 = gather(2)
#     if len(lvl2) >= 4:
#         grouped = split_on(lvl2, min_words=1)
#         return _finish(grouped)
#
#     # --- FALL BACK to your existing mixed-level logic ---
#     # (this is exactly your previous code, unchanged)
#     def _filter_group(g: OrderedDict[str,str]) -> OrderedDict[str,str]:
#         out = OrderedDict()
#         for title, body in g.items():
#             t = title.strip()
#             if SKIP_HEAD_RE.match(t) or _is_caption(t):
#                 continue
#             if _enough_words(body):
#                 out[title] = body
#         return out
#
#     # build full tree
#     forest = _make_nodes(md_text)
#     rolled = _roll_forest(forest)
#     grouped = _filter_group(rolled)
#
#     # if too many sections, fall back to level‑1
#     if len(grouped) > 15:
#         grouped = split_on(lvl1, min_words=1)
#
#     return _finish(grouped)

def extract_preamble_text(
    full_text: str,
    first_section_title: str,
    raw_sections: dict[str, str] | None = None,
    cleaner = None
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

def make_footnotes_tab(self, citations: dict) -> QWidget:
    w = QWidget(); layout = QVBoxLayout(w); layout.setContentsMargins(8,8,8,8)
    stats_html = self._render_stats_html((citations or {}).get("total", {}))
    stats_view = QTextEdit(readOnly=True); stats_view.setHtml(stats_html)
    layout.addWidget(QLabel("Footnote Linking – Statistics"))
    layout.addWidget(stats_view, 1)

    results = (citations or {}).get("results", [])
    # Build a simple HTML table (index, in-text, preceding, footnote)
    rows = []
    for r in results[:2000]:  # safety cap
        idx = html.escape(str(r.get("index","")))
        cit = html.escape(r.get("intext_citation",""))
        pre = html.escape(r.get("preceding_text",""))
        foot = html.escape((r.get("footnote") or "")[:2000])
        rows.append(f"<tr><td style='vertical-align:top'>{idx}</td><td style='vertical-align:top'>{cit}</td><td style='vertical-align:top'>{pre}</td><td style='vertical-align:top'>{foot}</td></tr>")
    table_html = """
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr style="text-align:left">
          <th style="border-bottom:1px solid #333;">Index</th>
          <th style="border-bottom:1px solid #333;">In-text</th>
          <th style="border-bottom:1px solid #333;">Preceding</th>
          <th style="border-bottom:1px solid #333;">Matched Footnote</th>
        </tr>
      </thead>
      <tbody>
        {rows}
      </tbody>
    </table>
    """.format(rows="\n".join(rows))
    table_view = QTextEdit(readOnly=True); table_view.setHtml(table_html)
    layout.addWidget(QLabel("Resolved Mappings"))
    layout.addWidget(table_view, 3)

    return w
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
    MAX_TOKENS = 6000
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

def append_toc(markdown: str, filename: str = "TOC.md") -> None:
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
def aggregate_subsections(sections_list: List[Tuple[int, str, str]]) -> Dict[str, str]:
    """
    "Rolls up" content from subsections into their parent section.
    """
    if not sections_list: return {}

    rolled_up_sections = {}
    i = 0
    while i < len(sections_list):
        parent_level, parent_title, parent_content = sections_list[i]
        full_content_parts = [parent_content]

        j = i + 1
        while j < len(sections_list):
            child_level, child_title, child_content = sections_list[j]
            if child_level > parent_level:
                formatted_subsection = f"### {child_title}\n\n{child_content}"
                full_content_parts.append(formatted_subsection)
                j += 1
            else:
                break

        final_content = "\n\n".join(part for part in full_content_parts if part).strip()

        if parent_title and final_content:
            rolled_up_sections[parent_title] = final_content
        i = j
    return rolled_up_sections
def _bump_md_headings(md: str, bump_by: int = 1) -> str:
    """Increase every markdown heading level by `bump_by` (cap at ######)."""
    def repl(m):
        hashes = m.group(1)
        new_level = min(len(hashes) + bump_by, 6)
        return "#" * new_level
    return re.sub(r'(?m)^(#{1,6})', repl, md)
def _format_with_subsections(title: str, content: str) -> str:
    """
    Ensure the parent predefined section appears as ### and any inner ###/####...
    become one level deeper (#### / #####...). Returns a ready-to-append block.
    """
    # Split off the parent body before the first subsection (### …) if present
    sub_iter = list(re.finditer(r'(?m)^#{3,6}\s+.+$', content))
    if not sub_iter:
        # No explicit subsections - just dump the content
        return f"### {title}\n\n{content}"
    first_start = sub_iter[0].start()
    parent_body = content[:first_start].strip()
    subs_md = content[first_start:].strip()
    subs_md = _bump_md_headings(subs_md, bump_by=1)  # push subs one level deeper
    block_parts = [f"### {title}"]
    if parent_body:
        block_parts.append(parent_body)
    block_parts.append(subs_md)
    return "\n\n".join(block_parts)


_REPARSE_PIPELINE_UTILS: Dict[str, Any] | None = None
_REPARSE_PIPELINE_UTILS_LOAD_ERR: str | None = None


def _style_to_bucket_for_pdf(style: Any) -> str:
    s = str(style or "").strip().lower()
    if s == "numeric":
        return "numeric"
    if s == "author_year":
        return "author_year"
    if s in {"tex_superscript", "hybrid", "superscript", "tex_default", "default", "tex"}:
        return "tex"
    return "unknown"


def _normalize_bucket_stats_for_pdf(stats: Any) -> Dict[str, Any]:
    if not isinstance(stats, dict):
        return {
            "intext_total": 0.0,
            "success_occurrences": 0.0,
            "success_unique": 0.0,
            "bib_unique_total": 0.0,
            "occurrence_match_rate": 0.0,
            "bib_coverage_rate": 0.0,
            "success_percentage": 0.0,
            "style": None,
        }
    out = {}
    for key in (
        "intext_total",
        "success_occurrences",
        "success_unique",
        "bib_unique_total",
        "occurrence_match_rate",
        "bib_coverage_rate",
        "success_percentage",
    ):
        v = stats.get(key)
        out[key] = float(v) if isinstance(v, (int, float)) else 0.0
    out["style"] = stats.get("style")
    return out


def _fallback_citation_summary(link_out: Any) -> Dict[str, Any]:
    if not isinstance(link_out, dict):
        empty = _normalize_bucket_stats_for_pdf(None)
        return {
            "style": "unknown",
            "dominant_bucket": "unknown",
            "dominant": empty,
            "buckets": {"footnotes": empty, "tex": empty, "numeric": empty, "author_year": empty},
        }

    foot = _normalize_bucket_stats_for_pdf((link_out.get("footnotes") or {}).get("stats"))
    tex = _normalize_bucket_stats_for_pdf((link_out.get("tex") or {}).get("total"))
    num = _normalize_bucket_stats_for_pdf((link_out.get("numeric") or {}).get("total"))
    ay = _normalize_bucket_stats_for_pdf((link_out.get("author_year") or {}).get("total"))
    buckets = {"footnotes": foot, "tex": tex, "numeric": num, "author_year": ay}

    style = str(link_out.get("style") or "unknown")
    dominant_bucket = _style_to_bucket_for_pdf(style)
    if dominant_bucket == "unknown":
        ranked = sorted(
            ("footnotes", "tex", "numeric", "author_year"),
            key=lambda k: buckets[k].get("success_occurrences", 0.0),
            reverse=True,
        )
        dominant_bucket = ranked[0]

    return {
        "style": style,
        "dominant_bucket": dominant_bucket,
        "dominant": buckets.get(dominant_bucket, _normalize_bucket_stats_for_pdf(None)),
        "buckets": buckets,
    }


def _load_reparse_pipeline_utils() -> Dict[str, Any]:
    global _REPARSE_PIPELINE_UTILS, _REPARSE_PIPELINE_UTILS_LOAD_ERR
    if _REPARSE_PIPELINE_UTILS is not None:
        return _REPARSE_PIPELINE_UTILS
    if _REPARSE_PIPELINE_UTILS_LOAD_ERR:
        return {}

    try:
        import importlib.util as _importlib_util

        here = Path(__file__).resolve()
        module_path = None
        for parent in [here.parent, *list(here.parents)]:
            candidate = parent / "scripts" / "reparse_footnotes_dataset.py"
            if candidate.exists():
                module_path = candidate
                break

        if module_path is None:
            _REPARSE_PIPELINE_UTILS_LOAD_ERR = "reparse_footnotes_dataset.py not found"
            return {}

        spec = _importlib_util.spec_from_file_location("reparse_pipeline_utils_runtime", module_path)
        if spec is None or spec.loader is None:
            _REPARSE_PIPELINE_UTILS_LOAD_ERR = f"unable to import from {module_path}"
            return {}

        module = _importlib_util.module_from_spec(spec)
        spec.loader.exec_module(module)

        required = (
            "summarize_link_output",
            "validate_heading_structure",
            "extract_document_metadata",
            "build_validations",
        )
        funcs: Dict[str, Any] = {}
        for name in required:
            fn = getattr(module, name, None)
            if not callable(fn):
                _REPARSE_PIPELINE_UTILS_LOAD_ERR = f"missing callable: {name}"
                return {}
            funcs[name] = fn

        _REPARSE_PIPELINE_UTILS = funcs
        return funcs
    except Exception as exc:
        _REPARSE_PIPELINE_UTILS_LOAD_ERR = f"{type(exc).__name__}: {exc}"
        return {}


def _normalize_refs_list(refs: Any) -> List[str]:
    if isinstance(refs, list):
        out: List[str] = []
        for item in refs:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
        return out
    if isinstance(refs, str) and refs.strip():
        return [refs.strip()]
    return []


def _compute_citation_metadata_validation(
    *,
    full_text: str,
    references: Any,
    link_out: Any,
) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    refs_list = _normalize_refs_list(references)
    summary = _fallback_citation_summary(link_out)
    metadata: Dict[str, Any] = {}
    validation: Dict[str, Any] = {}

    if not isinstance(link_out, dict):
        return summary, metadata, validation

    utils = _load_reparse_pipeline_utils()
    if not utils:
        return summary, metadata, validation

    try:
        summary = utils["summarize_link_output"](link_out)
    except Exception:
        summary = _fallback_citation_summary(link_out)

    try:
        heading_validation = utils["validate_heading_structure"](full_text, refs_list)
        metadata = utils["extract_document_metadata"](
            full_text=full_text,
            references=refs_list,
            heading_validation=heading_validation,
        )
        validation = utils["build_validations"](
            full_text=full_text,
            references=refs_list,
            link_out=link_out,
            current_summary=summary,
            metadata=metadata,
        )
    except Exception as exc:
        validation = {"metadata_validation_error": f"{type(exc).__name__}: {exc}"}

    return summary, metadata, validation

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

    # --- Mistral OCR Cache Lookup ---
    # Set the Mistral cache directory to match submit_mistral_ocr3_batch
    from pathlib import Path
    home = Path.home()
    base = home / "annotarium" / "cache" / "mistral"
    files_dir = base / "files"
    mistral_cache_base = files_dir

    from pathlib import Path

    pdf_path = str(Path(pdf_path).expanduser().resolve())
    if not pdf_path.lower().endswith(".pdf"):
        raise ValueError("Source must be a PDF file.")

    llm4_kwargs = {"page_chunks": True, "write_images": False}

    cache_file = Path(_cache_path(pdf_path))

    full_md = None
    segments = []
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
        import json
        try:
            cached_data = json.loads(cache_file.read_text(encoding="utf-8"))

            # backfill older caches with flat_text/citations/summary if missing
            if "full_text" in cached_data:
                cached_full_text = cached_data.get("full_text", "")
                cached_references = cached_data.get("references", [])

                if "citations" not in cached_data or "flat_text" not in cached_data:
                    try:
                        _cit = link_citations_to_footnotes(cached_full_text, cached_references)
                        cached_data["citations"] = _cit
                        cached_data["flat_text"] = _cit.get("flat_text", cached_full_text)
                    except Exception:
                        cached_data.setdefault("citations", {"total": {}, "results": [], "flat_text": cached_full_text})
                        cached_data.setdefault("flat_text", cached_full_text)

                if "summary" not in cached_data:
                    ft = cached_full_text
                    fl = cached_data.get("flat_text", ft)
                    cached_data["summary"] = {
                        "full_text": {"words": _word_count(ft), "tokens": _count_tokens(ft)},
                        "flat_text": {"words": _word_count(fl), "tokens": _count_tokens(fl)},
                    }

                if (
                    "citation_summary" not in cached_data
                    or "metadata" not in cached_data
                    or "validation" not in cached_data
                ):
                    _citation_summary, _metadata, _validation = _compute_citation_metadata_validation(
                        full_text=cached_full_text,
                        references=cached_references,
                        link_out=cached_data.get("citations", {}),
                    )
                    if "citation_summary" not in cached_data:
                        cached_data["citation_summary"] = _citation_summary
                    if "metadata" not in cached_data:
                        cached_data["metadata"] = _metadata
                    if "validation" not in cached_data:
                        cached_data["validation"] = _validation

                # Always keep cache file tidy
                cache_file.write_text(json.dumps(cached_data, ensure_ascii=False, indent=2), encoding="utf-8")

            # Fast return: full cached object allowed?
            if cache and cached_data and cached_data.get("sections") and cached_data.get("pages_text"):
                return cached_data

            # Otherwise we will recompute – decide what to do with full_text.
            if not cache and cache_full and cached_data and cached_data.get("full_text") and cached_data.get(
                    "pages_text"):
                full_md = cached_data["full_text"]
                segments = cached_data["pages_text"]
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
        pos_map = {p: i for i, p in enumerate(page_list)}

        needs_ocr = list(page_list)
        print(f"[LOG] OCR-first mode: attempting OCR for {len(needs_ocr)} pages.")

        from pathlib import Path
        import hashlib
        import json

        home = Path.home()
        base = home / "annotarium" / "cache" / "mistral"
        files_dir = base / "files"
        mistral_cache_base = files_dir

        ocr_text_by_page = {}

        def _hash_key_path(p: str) -> str:
            p2 = os.path.normpath(p)
            p2 = os.path.normcase(p2)
            return p2

        hash_candidates = [
            pdf_path,
            _hash_key_path(pdf_path),
            pdf_path.replace("/", "\\"),
            _hash_key_path(pdf_path.replace("/", "\\")),
        ]

        mistral_cache_file = None
        for cand in hash_candidates:
            h = hashlib.sha256(cand.encode("utf-8")).hexdigest()
            f = mistral_cache_base / f"{h}.json"
            if f.is_file():
                mistral_cache_file = f
                break

        cached_pages = None
        if mistral_cache_file and mistral_cache_file.is_file():
            cached = json.loads(mistral_cache_file.read_text(encoding="utf-8"))

            cached_pages = (
                cached
                .get("response", {})
                .get("response", {})
                .get("body", {})
                .get("pages", [])
            )

            if cached_pages:
                print(f"[LOG] Found Mistral per-file cache with {len(cached_pages)} pages: {mistral_cache_file}")
            else:
                print(f"[WARNING] Mistral cache found but contains no pages: {mistral_cache_file}")

        if cached_pages:
            by_index = {p.get("index"): p for p in cached_pages if isinstance(p, dict)}
            for orig_page in needs_ocr:
                page_info = by_index.get(orig_page)
                if not page_info:
                    continue
                text = (page_info.get("markdown") or page_info.get("text") or "").strip()
                if text:
                    ocr_text_by_page[orig_page] = text
                    segments[pos_map[orig_page]] = text
            print(f"[LOG] Reused Mistral OCR cache for {len(ocr_text_by_page)} pages.")

        still_needs_ocr = [p for p in needs_ocr if p not in ocr_text_by_page]

        if still_needs_ocr:
            print(f"[LOG] {len(still_needs_ocr)} pages still require OCR (not in Mistral cache).")

            if len(still_needs_ocr) > 150:
                still_needs_ocr = still_needs_ocr[:60] + still_needs_ocr[-60:]
            if len(still_needs_ocr) > 300:
                still_needs_ocr = still_needs_ocr[:250]

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
                        s.close()
                        d.close()

                def ensure_under_cap(pg_list: list[int]):
                    if not pg_list:
                        return
                    pdf_bytes = build_pdf_bytes(pg_list)
                    if not pdf_bytes:
                        return
                    if len(pdf_bytes) <= 25 * 1024 * 1024:
                        batches.append(pg_list)
                        return

                    if len(pg_list) == 1:
                        batches.append(pg_list)
                        return
                    mid = len(pg_list) // 2
                    ensure_under_cap(pg_list[:mid])
                    ensure_under_cap(pg_list[mid:])

                for i in range(0, len(pages), max_pages):
                    ensure_under_cap(pages[i:i + max_pages])

                return batches

            import httpx
            from mistralai import Mistral
            from mistralai.utils import BackoffStrategy, RetryConfig

            http_client = httpx.Client(
                timeout=httpx.Timeout(180.0, connect=30.0),
                limits=httpx.Limits(max_connections=5, max_keepalive_connections=0),
            )

            client = Mistral(
                api_key=mistral_key,
                client=http_client,
                retry_config=RetryConfig("backoff", BackoffStrategy(1, 50, 1.1, 100), False),
            )
            all_batches = split_batches_by_size(still_needs_ocr, max_pages=20)
            print(f"[LOG] OCR will run in {len(all_batches)} batch(es) for {len(still_needs_ocr)} pages.")

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
                    src.close()
                    dst.close()
                    continue

                pdf_bytes = dst.tobytes()
                src.close()
                dst.close()

                print(
                    f"[LOG] Uploading OCR batch {bi}/{len(all_batches)} ({len(batch)} pages, {len(pdf_bytes) / 1024 / 1024:.2f} MB)")

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
                            time.sleep(delay)
                            continue
                        if status == 400 and len(batch) > 1:
                            print("[WARNING] Batch too large for OCR; splitting.")
                            mid = len(batch) // 2
                            all_batches[bi - 1:bi] = [batch[:mid], batch[mid:]]
                            ocr_resp = None
                            break
                        raise

                if not ocr_resp:
                    continue

                results = ocr_resp.model_dump().get("pages", [])
                for i, page_info in enumerate(results):
                    orig_page = batch[i] if i < len(batch) else batch[-1]
                    text = (page_info.get("markdown") or page_info.get("text") or "").strip()
                    if text:
                        ocr_text_by_page[orig_page] = text
                        segments[pos_map[orig_page]] = text

        missing_after_ocr = [p for p in page_list if not (segments[pos_map[p]] or "").strip()]
        if missing_after_ocr:
            print(
                f"[WARNING] OCR is failing/incomplete for {len(missing_after_ocr)} pages; using llm4 fallback (embedded extraction).")



            for pidx in missing_after_ocr:
                # page = fitz.open(pdf_path)[pidx]
                # text = pymupdf_layout.get_page_text(page, output="markdown")
                # if (text or "").strip():
                #     segments[pos_map[pidx]] = text.strip()
                # else:
                    print(f"[WARNING] llm4 fallback produced no text on page {pidx}.")

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
    t0 = time.perf_counter()
    print("[LOG] Stage: link citations/footnotes")
    link_out = link_citations_to_footnotes(full_md, references)
    flat_text = link_out.get("flat_text", full_md)
    citation_summary, metadata, validation = _compute_citation_metadata_validation(
        full_text=full_md,
        references=references,
        link_out=link_out,
    )
    t1 = time.perf_counter()
    print(f"[LOG] Stage complete: link citations/footnotes ({t1 - t0:.2f}s)")

    print("[LOG] Stage: parse markdown into sections")
    t2 = time.perf_counter()
    toc, sections, logs_md = parse_markdown_to_final_sections(flat_text)
    t3 = time.perf_counter()
    print(f"[LOG] Stage complete: parse markdown ({t3 - t2:.2f}s)")
    print(f"[LOG] Raw parse created {len(sections)} top-level sections. Cleaning.")

    print("[LOG] Stage: extract intro/conclusion + payload")
    t4 = time.perf_counter()
    intro_data = extract_intro_conclusion_pdf_text(
        full_text=parse_text, raw_secs=sections, processing_log=logs_md, core_sections=core_sections
    )
    t5 = time.perf_counter()
    print(f"[LOG] Stage complete: extract intro/conclusion ({t5 - t4:.2f}s)")

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
            "toc": [(1, title) for title in cleaned_sections.keys()],
            "sections": cleaned_sections,
            "process_log": processing_log,
            "word_count": flat_words,
            "references": references,
            "citations": link_out,
            "citation_summary": citation_summary,
            "metadata": metadata,
            "validation": validation,
            "summary": summary,
            "payload": payload,
            "summary_log": summary_log,
            "pages_text": segments,
        })


    else:

        result_to_cache.update({

            "full_text": full_md,

            "flat_text": flat_text,

            "references": references,
            "citations": link_out,
            "citation_summary": citation_summary,
            "metadata": metadata,
            "validation": validation,

            "summary": summary,

            "payload": payload,

            "summary_log": summary_log,

            "pages_text": segments,

        })

    # Always re-write cache with the latest recomputation (even when cache=False)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(result_to_cache, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "full_text": full_md,
        "flat_text": result_to_cache.get("flat_text", full_md),
        "toc": result_to_cache.get("toc", []),
        "sections": result_to_cache.get("sections", {}),
        "process_log": processing_log,
        "word_count": full_words,
        "references": result_to_cache.get("references", []),
        "citations": result_to_cache.get("citations", {"total": {}, "results": [], "flat_text": full_md}),
        "citation_summary": result_to_cache.get("citation_summary", citation_summary),
        "metadata": result_to_cache.get("metadata", metadata),
        "validation": result_to_cache.get("validation", validation),
        "summary": result_to_cache.get("summary", summary),
        "payload": payload,
        "summary_log": summary_log,
        "pages_text": result_to_cache["pages_text"],
    }


def _normalise(text: str) -> str:
    """• map PUA digits → 0-9   • remove soft hyphen   • de-hyphenate line-breaks"""
    # PUA → ASCII digits + remove soft hyphen
    txt = "".join(_PUA_DIGIT.get(ch, ch) for ch in text).replace(SOFT_HYPH, "")
    # de-hyphenate words split at EOL:  opera-\n tion  →  operation
    return re.sub(r"-\s*\n\s*(\w)", r"\1", txt)
def check_keyword_details_pdf(
    pdf_path: Union[str, Path],
    keywords: Union[str, List[str]],
) -> Optional[Dict[str, Union[int, List[Dict[str, Any]]]]]:
    """Scan *pdf_path* for *keywords*; returns total hits + per‑paragraph matches.

    Uses `process_pdf` for robust text extraction (embedded or OCR) and foot‑note
    parsing for law‑review style documents, grouping by section instead of page.
    """

    pdf = Path(pdf_path)
    if not pdf.exists():
        logging.error("File not found: %s", pdf)
        return None

    kw_list = [keywords] if isinstance(keywords, str) else list(keywords)
    if not kw_list:
        return {"total": 0, "matches": []}

    def _kw_pat(word: str) -> re.Pattern:
        """
        Build a pattern that matches the word even when the PDF has inserted
        a soft-hyphen (U+00AD), a normal ‘-’, or any whitespace between letters.
        """
        if not word:
            return re.compile(r"$^")  # never matches
        chunks = [re.escape(word[0])]
        for ch in word[1:]:
            chunks.append(r"(?:[\s\u00ad-]+)?" + re.escape(ch))
        return re.compile(r"\b" + "".join(chunks) + r"\b", re.I)

    kw_regex = {kw: _kw_pat(kw) for kw in kw_list}
    footnotes: Dict[int, str] = {}

    # ─── Extract Markdown with sections ─────────────────────────────────
    md_dict = process_pdf(pdf_path=str(pdf))
    append_toc("\n".join(h for _lvl, h in md_dict.get('toc', [])))
    md = _unwrap_softwraps(md_dict.get("flat_text", md_dict.get("full_text", "")))
    toc, sections, logs_md = parse_markdown_to_final_sections(md)
    # print("sections")
    # print(sections)

    # collect footnotes across all sections
    def collect_footnotes(text: str):
        notes_src = ''
        # split off dashed rule
        body, notes_src = (re.split(r"\n-{3,}\n", text, maxsplit=1) + [''])[:2]
        # fallback numbered lines
        if not notes_src.strip():
            m = re.search(r"\n\s*\d{1,3}\s+.+", text)
            if m:
                idx = m.start()
                notes_src = text[idx:]
        for m in re.finditer(
            r"^\s*(\d{1,3})\s+(.+?)(?=^\s*\d{1,3}\s+|\Z)", notes_src, flags=re.M | re.S
        ):
            num = int(m.group(1))
            note = " ".join(l.strip() for l in m.group(2).splitlines()).strip()
            if note and num not in footnotes:
                footnotes[num] = note

    for sec_text in sections.values():
        collect_footnotes(_normalise(sec_text))

    def linkify(txt: str) -> str:
        def repl(m):
            n = int(m.group(1))
            note = html.escape(footnotes.get(n, "note missing"), quote=True)
            return f'<sup><a href="#" title="{note}">[{n}]</a></sup>'

        return re.sub(r"\[(\d{1,3})\]", repl, txt)

    def _strip_tags(t: str) -> str:
        return re.sub(r"<[^>]+>", "", t)

    def _word_count(t: str) -> int:
        return len(re.findall(r"\w+", _strip_tags(t)))

    def _split_sentences(t: str) -> List[str]:
        # lightweight sentence splitter; avoids dependencies
        t = t.strip()
        if not t:
            return []
        return [s.strip() for s in re.split(r'(?<=[.!?])\s+(?=[A-Z0-9"“(])', t) if s.strip()]

    def _sentences_before_after(idx: int, paras: List[str]) -> Tuple[List[str], List[str]]:
        """Collect sentences before and after the paragraph at *idx* across neighbors."""
        # current
        cur_sents = _split_sentences(paras[idx])
        # previous
        left: List[str] = list(reversed(_split_sentences(paras[idx])[:]))  # placeholder
        left = []
        for j in range(idx, -1, -1):
            sents = _split_sentences(paras[j])
            if j == idx:
                left.extend(reversed(sents))  # will trim later around hit
            else:
                left.extend(reversed(sents))
        # next
        right: List[str] = []
        for j in range(idx, len(paras)):
            if j == idx:
                continue  # will trim later around hit
            right.extend(_split_sentences(paras[j]))
        return left, right

    def _excerpt_around_first_match(
            idx: int,
            paras: List[str],
            pat: re.Pattern,
            min_words: int = 100,
            prefer_words: int = 150,
            max_words: int = 400,
    ) -> str:
        """
        Build an excerpt by centering on the FIRST sentence containing the match, then
        alternately add sentences before/after until length constraints are met.
        """
        this_para = paras[idx]
        this_sents = _split_sentences(this_para)
        if not this_sents:
            return this_para

        # locate first sentence with a hit
        hit_si = 0
        for si, s in enumerate(this_sents):
            if pat.search(s):
                hit_si = si
                break

        # build pools left/right starting from the hit boundaries
        left_pool = list(reversed(this_sents[:hit_si]))  # sentences before hit, nearest first
        right_pool = this_sents[hit_si + 1:]  # sentences after hit, nearest first

        # extend pools with neighbor paragraphs
        # previous paragraphs (nearest first)
        for j in range(idx - 1, -1, -1):
            left_pool.extend(reversed(_split_sentences(paras[j])))
        # next paragraphs (nearest first)
        for j in range(idx + 1, len(paras)):
            right_pool.extend(_split_sentences(paras[j]))

        excerpt_sents = [this_sents[hit_si]]
        wc = _word_count(" ".join(excerpt_sents))

        # prefer ~150 words; ensure >=100; cap at 400; keep hit roughly centered
        toggle = True  # True: pull from left, False: right
        while (wc < min_words or wc < prefer_words) and (left_pool or right_pool):
            picked = None
            if toggle and left_pool:
                cand = left_pool.pop(0)  # nearest-left
                if _word_count(" ".join([cand] + excerpt_sents)) <= max_words:
                    excerpt_sents.insert(0, cand)
                    picked = cand
            if not picked and right_pool:
                cand = right_pool.pop(0)  # nearest-right
                if _word_count(" ".join(excerpt_sents + [cand])) <= max_words:
                    excerpt_sents.append(cand)
                    picked = cand
            if not picked and left_pool:
                # try opposite side if the first choice overflowed max
                cand = left_pool.pop(0)
                if _word_count(" ".join([cand] + excerpt_sents)) <= max_words:
                    excerpt_sents.insert(0, cand)
                    picked = cand
            if not picked:
                break  # cannot add more without exceeding max
            wc = _word_count(" ".join(excerpt_sents))
            toggle = not toggle

        return " ".join(excerpt_sents)

    matches: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, str, str]] = set()  # (section, kw, excerpt_hash)
    total = 0

    # ─── Scan each section; build context-aware excerpts ───────────────────
    for section, text in sections.items():
        # normalise and de-hyphenate PDF artifacts
        txt = _normalise(
            text.replace("\u00ad", "")  # strip soft hyphens
            .replace("-\n", "")  # join words split by hyphen + newline
        )

        # split section into paragraphs
        paras = [p.strip() for p in re.split(r"\n{2,}", txt) if p.strip()]
        if not paras:
            continue

        for i, para in enumerate(paras):
            raw = para  # work on raw first; linkify later (to avoid tag noise)
            for kw, pat in kw_regex.items():
                if not pat.search(raw):
                    continue

                # build excerpt centered on the first match, expanding to meet length range
                excerpt_raw = _excerpt_around_first_match(i, paras, pat)

                # linkify citations and then highlight all occurrences
                excerpt_linked = linkify(excerpt_raw)
                highlighted = pat.sub(lambda m: f"<mark>{m.group(0)}</mark>", excerpt_linked)

                # de-duplicate identical excerpts for the same keyword+section
                excerpt_key = (section, kw, hashlib.md5(highlighted.encode("utf-8")).hexdigest())
                if excerpt_key in seen:
                    continue
                seen.add(excerpt_key)

                # count occurrences inside the FINAL excerpt
                total += len(pat.findall(excerpt_linked))

                matches.append({
                    "keyword": kw,
                    "paragraph": highlighted,
                    "section": section
                })

    return {"total": total, "matches": matches}

def _classify_scheme(md_text: str) -> str:
    """
    Return one of: markdown, roman, numeric, markdown_from_numeric,
                   roman_weak_split, markdown_from_roman
    """
    text = md_text or ""

    # quick presence tests
    has_hash_roman = any(re.match(r'^\s{0,3}#{1,6}\s*[IVXLCDM]+[.)\-\s]', ln) for ln in text.splitlines())
    has_hash_numeric = any(re.match(r'^\s{0,3}#{1,6}\s*\d+[.)\-\s]', ln) for ln in text.splitlines())

    # 1) plain markdown heads with non-numeric titles
    toc_m, sec_m = markdown_parser(text)
    if len(sec_m) >= 3 and not has_hash_numeric and not has_hash_roman:
        return "markdown"

    # 2) strict numeric headings (markdown hashes)
    toc_n, sec_n = numbering_parser(text)
    if len(sec_n) >= 3 and has_hash_numeric:
        return "numeric"

    # 3) numeric anchors from lines → synthetic split
    ok_num, _info, anchors = detect_numbering_by_lines(text)
    if ok_num:
        toc_ln, sec_ln = split_by_numeric_anchors(text, anchors)
        if len(sec_ln) >= 3:
            return "markdown_from_numeric"

    # 4) roman hashed vs plain
    heads = _quick_scan(text)
    ok_rom, detail = detect_roman_scheme(heads)
    toc_r, sec_r = romans_parser(text)
    if ok_rom and has_hash_roman and len(sec_r) >= 3:
        return "roman"
    if len(sec_r) >= 3:
        return "markdown_from_roman" if ok_rom else "roman_weak_split"

    # 5) fallback as markdown
    return "markdown"


# --------------------------------------------------------------------------
# 1) NEW: Function to provide the list of PDFs
# --------------------------------------------------------------------------
def get_pdf_list() -> List[str]:
    """Returns the hardcoded list of PDF file paths."""
    # Note: Using forward slashes for cross-platform compatibility.
    # Python on Windows handles them correctly.
    pdfs =['C:\\Users\\luano\\Zotero\\storage\\5MYV4X6F\\Williamson - 2024 - Do Proxies Provide Plausible Deniability Evidence from Experiments on Three Surveys.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\65PGBJV6\\23UXFS4N.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PNLVDV2K\\Du and Li - 2024 - Legal challenges of attributing malicious cyber activities against space activities.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PDWGVEBM\\Olovson - 2020 - Hacking for the state the use of private persons in cyber attacks and state responsibility.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LYLFQZS4\\Ciglic and and Hering - 2021 - A multi-stakeholder foundation for peace in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\HX67UX9A\\[Indian Journal of International Law 2020-aug 17] Aravindakshan, Sharngan - Cyberattacks_ a look at evidentiary thresholds in International Law (2020) [10.1007_s40901-020-00113-0] - libgen.li.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FN7M6IDE\\2CLCXLGC.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\359HAXBP\\Lu and Zhang - 2022 - A chinese perspective on public cyber attribution.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\U4YV8KXZ\\Burton - 2015 - NATO's cyber defence strategic challenges and institutional adaptation.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\76NGPBX8\\2U24UV2X.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\76ZRR68W\\2UQEJDV9.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ANQ4USFU\\2Y6P7WB3.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FEJ9RTEX\\Cheng and Li - 2025 - State responsibility in the context of cyberwarfare dilemma identification and path reconstruction.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\B5WMEVBH\\34VMJIMJ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QM7G8VDZ\\Vostoupal - 2024 - Stuxnet vs WannaCry and Albania cyber - attribution on trial.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QCCZ9WP3\\36HIVBBV.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4FT28KIJ\\Leal - 2025 - Blame games in cyberspace how foreign cues shape public opinion on cyber attribution and retributio.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\D47ADE3K\\Carter - Mapping a Path to Cyber Attribution Consensus.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\V3BS47AK\\3JMNTC3D.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\A59ACXZX\\Harrison Dinniss - 2012 - Armed attack and response in the digital age.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DTQ7AHV8\\3LZES3GD.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TXQ4LMGV\\Eoyang and Keitner - 2021 - Cybercrime vs. Cyberwar paradigms for addressing malicious cyber activity.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QW6FM6CG\\3MNHW66L.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BXBAM6UW\\Shackelford et al. - 2011 - State responsibility for cyber attacks competing standards for a growing problem.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4Y4UAPYJ\\Saltzman - 2013 - Cyber posturing and the offense-defense balance.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AAUAG97F\\viewcontent.cgi.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\E9I4IG8V\\ssrn_id1651905_code500200.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\F92R2GEY\\(Matthew Hoisington, 2009).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LXV445HW\\Hinck and Maurer - 2020 - Persistent enforcement criminal charges as a response to nation-state malicious cyber activity.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4W65GHM8\\Egloff and Cavelty - 2021 - Attribution and knowledge creation assemblages in cybersecurity politics.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BC2DBEUN\\4I36KRQK.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AI39U8GB\\Henriksen - 2015 - Lawful State Responses to Low-Level Cyber-Attacks.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\W7GV8M7B\\ssrn_id3986297_code3671000.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4PBTDMEU\\the-question-of-evidence-from-technical-to-legal-attribution.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Y4IKMXJ8\\Ross - 2024 - Going nuclear the development of american strategic conceptions about cyber conflict.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8BKPMUKJ\\4UJBH88S.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PC77HX8N\\(Marco Roscini, Marco Roscini, 2015).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\X4V4C2VU\\Brantly - 2020 - Entanglement in cyberspace minding the deterrence gap.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RW9T288J\\522FKXG7.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\BA4VC85N\\Siemion - 2023 - Rethinking US Concepts and Actions in Cyberspace Building a Better Foundation for Deterring China's.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\PSWSBSS9\\Schmitt - 2018 - Virtual Disenfranchisement Cyber Election Meddling in the Grey Zones of International Law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\JZFR537G\\5AYIJM8U.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9EGP9PBM\\Nye - 2016 - Deterrence and dissuasion in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\5WQ4PCB2\\Finnemore and Hollis - 2018 - Naming without shaming Accuzations and international law in global cybersecurity.”.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PGNDKI3W\\ssrn_id1928870_code427934.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\G8S42VK6\\Baram - 2025 - When intelligence agencies publicly attribute offensive cyber operations illustrative examples from.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\R9JY8KKM\\Blagden - 2020 - Deterring cyber coercion the exaggerated problem of attribution.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Z94797ZI\\Goodman - 2010 - Cyber Deterrence Tougher in Theory than in Practice.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Q3WFRPH5\\Guitton and and Korzak - 2013 - The Sophistication Criterion for Attribution Identifying the Perpetrators of Cyber-Attacks.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\UXZPWG8S\\5XACV5PG.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\S5HPWAXC\\64J5DBZX.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ADTTSCQG\\64L88YW3.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7AXA7CYV\\Brantly - 2016 - Defining the Role of Intelligence in Cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\WP7V88GH\\68PI67HF.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3J4FVPJK\\div-class-title-cyber-intelligence-and-influence-in-defense-of-cyber-manipulation-operations-to-parry-atrocities-div.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Y2WGZPCI\\Whyte - 2020 - Cyber conflict or democracy “hacked” How cyber operations enhance information warfare.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3ET6JDXT\\Moulin - 2020 - Reviving the principle of non-intervention in cyberspace the path forward.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EF6QKQFP\\InstitutionalisingCyberAttribution.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\275MULYI\\(K Hartmannet al, 2019).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RSX658HA\\Ogurlu - 2023 - International law in cyberspace an evaluation of the Tallinn manuals.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IKX9U9B5\\Bradshaw et al. - 2015 - Rule making for state conduct in the attribution of cyber attacks.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\U6CWP57T\\Smedes - 2025 - The increasing prevalence of cyber operations and the inadequacy of international law to address the.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Z3V6VFXW\\6MEA6HTW.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ADV4SJXL\\Baram and Sommer - 2019 - Covert or not covert national strategies during cyber conflict.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QHDPS6HV\\Leal and Musgrave - 2022 - Cheerleading in cyberspace how the american public judges attribution claims for cyberattacks.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8IUG8AT9\\Ottis - 2010 - From pitchforks to laptops volunteers in cyber conflicts.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NACYNRR7\\(AG Hill, 2019).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7ZU7W79K\\Iasiello - 2014 - Is cyber deterrence an illusory course of action.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\EKHVCESF\\O'Connell - 2012 - Cyber security without cyber war.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\USKK4VLD\\Davis et al. - 2017 - Stateless attribution toward international accountability in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AZN6P3JU\\(T Rid, B Buchanan, 2015).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DVACIX65\\7KNDEV8F.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\H6K5BDZ9\\7LRDA3NY.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BNI8RHDX\\Baram - 2023 - Public secrets the dynamics of publicity and secrecy in offensive cyber operations.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\J8E7A5YR\\Kastelic - Non-Escalatory Attribution of International Cyber Incidents.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4H5TNBPL\\Egloff and Egloff - 2020 - Public attribution of cyber intrusions.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\X7WN2JJI\\Tehrani - 2019 - Cyber Resilience Strategy and Attribution in the Context of International law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QA54EXSD\\ssrn_id2593868_code1689451.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\GNED8YH6\\(A Bendiek, T Metzger, 2015).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\D23R4N82\\Lonergan and Montgomery - 2021 - What is the future of cyber deterrence.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NZ5B2NJN\\875523XM.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\B8MXM59U\\5214241.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\2ID4R3MN\\Yang - 2023 - Pointing with boneless finger and getting away with it the ill-substantiation problem in cyber publ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\U8PKQ284\\(Annegret Bendiek, Matthias Schulze, 2021).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\M5CEIUFH\\8BLRFXCZ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DF6QEH39\\8BS9QPCG.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\M4XM7GFA\\8FYM5N5E.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\XWSBLFDE\\Wilner - 2020 - US cyber deterrence practice guiding theory.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EASXCJRP\\8JP7SKHR.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CBSMQQXB\\Kessler and Werner - 2013 - Expertise, uncertainty, and international law a study of the Tallinn manual on cyberwarfare.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EESGXCKM\\8MJW96I5.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DGB6E7FX\\div-class-title-state-sponsored-cyber-attacks-and-co-movements-in-stock-market-returns-evidence-from-us-cybersecurity-defense-contractors-div.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9ZK4P5JF\\Bannelier et al. - 2019 - MULTIPLE MOONS Cyber sanctions and the role of the private sector.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8AZDPJ4D\\8TTNI4DR.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\WRCBD672\\Khalil et al. - 2024 - A new era of armed conflict the role of state and non-state actors in cyber warfare with special re.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\D47IU3M6\\Romanosky and Boudreaux - 2021 - Private-sector attribution of cyber incidents benefits and risks to the U.S. government.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\JIJJWW8D\\8XPLITQJ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4GDFI6WK\\Jensen and Watts - Due diligence and defend forward.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NCG25JSN\\10.1080_14799855.2021.1896495.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IX34V37I\\Michaelsen and Thumfart - 2023 - Drawing a line Digital transnational repression a.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NEYPIJWM\\(Karine Bannelieret al, 2019).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Z68WF37I\\5259369.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7Y8JFCM6\\Dinstein - Computer Network Attacks and Self-Defense.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KZRI5IJ9\\9EESWTEB.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RJHJU8VR\\9FYZBM4S.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\ULJHDCHC\\Jiang - 2021 - Decoding china's perspectives on cyber warfare.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\7ZV9RGQV\\9IVGVKRB.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DA2MX2V3\\9IWF6BG2.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IDH6HB9V\\9QK9L72S.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VTAZDCKQ\\9RB38IT6.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\852FVSDP\\Stockburger - 2017 - The control & capabilities test How a new legal regime is shaping attribution in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KAPVLLSB\\Dong et al. - 2025 - Spatiotemporal characteristics and drivers of global cyber conflicts.pdf',
     # 'C:\\Users\\luano\\Zotero\\storage\\Q6XC4J4X\\Welburn et al. - 2023 - Cyber deterrence with imperfect attribution and unverifiable signaling.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\G922R75D\\Lehto - 2023 - Finland's views on international law and cyberspace introduction.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\X836CZ24\\9YA6QDCU.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IXF3AS6F\\unacknowledged-operations.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RPMI77E8\\Prescott - 2011 - War by analogy US cyberspace strategy and international humanitarian law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\S78F4MIY\\Trahan - 2021 - The criminalization of cyber-operations under the rome statute.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\B38J9B2F\\ABLDRC5D.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CX5G7XNC\\Moyakine - 2022 - Pulling the strings in cyberspace legal attribution of cyber operations based on state control.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\82IX52XI\\ACC7HMIK.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZBADK7KG\\AETR2JUT.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BTWTATHA\\ssrn_id2734419_code2091508.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PCAIN4XQ\\0067205X231166697.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KM2FN3Q2\\Hedling and Oerden - 2025 - Disinformation, deterrence and the politics of attribution.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7ZP8LCLW\\Kalpokiene and Kalpokas - 2020 - Contemplating a cyber weapons convention an exploration of good practice and necessary precondition.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9XQCHID6\\Hoem and Kristiansen - 2022 - Small players in a limitless domain cyber deterrence as small state strategy.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\MXUSKKIT\\(Thomas Reinholdet al, 2018).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EN9HGKWC\\viewcontent.cgi.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8UKU4YH5\\Geiss and Lahmann - 2021 - Protecting societies anchoring a new protection dimension In international law In times of increase.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PL98EQNV\\Ying and Shi - 2025 - The chinese restrictive approach to the law on the use of force and its application in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\HZPEBAWX\\Watts - Cyber Norm Development and the United States Law of War Manual.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\J2PN87QK\\AX3R73NM.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SFZJZQB4\\B5FFDB4Q.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7FURVU3H\\B6DD3S6A.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\J7NXUN7T\\Gomez - 2019 - Sound the alarm! Updating beliefs and degradative .pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QKSUU3TM\\BAH5P8W3.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\GGYR4BLG\\Shrivastava_Lakra_2022_Revisiting due diligence in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\E3IYCJGT\\2016_MSFT_Cybersecurity_Norms_vFinal.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NDPMN2K9\\Schmitt et al. - 2016 - Beyond state-centrism international law and non-state actors in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PACZ2MRR\\Stephens - 2025 - Small actors, big disruptions the chaos of shadow strikes in asymmetric cyber warfare.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ML6ZPXYS\\Brunnee and Meshel - 2015 - Teaching an old law new tricks international environmental law lessons for cyberspace governance.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NGN8S6DA\\BKVEKFS8.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\JZFBBHEQ\\BQKGXE9S.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\C7K4QR9R\\Spacil - 2024 - Retorsion An Underrated Retaliatory Measure against Malign Cyber Operations.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CQTVKBSM\\BT4AUHVK.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AFX5T7NL\\Simmons - 2014 - A Brave New World Applying International Law of War to Cyber-Attacks.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RMNSN53Z\\Tsagourias and Farrell - 2020 - Cyber attribution technical and legal approaches and challenges.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CUHK3TGA\\Sander - 2019 - Democracy Under The Influence Paradigms of State Responsibility for Cyber Influence Operations on E.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3MJ69JXG\\C2TPMBBF.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\E56TWVW7\\Burton - Cyber Deterrence A Comprehensive Approach.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8YRK5RZF\\Tolga - Principles of Cyber Deterrence and the Challenges in Developing a Credible Cyber Deterrence Posture.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\JPWG6PVT\\CN5FKS4Z.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DZTB5GIF\\Burt - 2023 - President Obama and China Cyber Diplomacy and Strategy for a New Era.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\V6W25S7P\\d'Aspremont - 2016 - Cyber Operations and International Law An Interventionist Legal Thought.pdf",
     "C:\\Users\\luano\\Zotero\\storage\\T4IRCWJV\\Coco and Dias - 2021 - 'Cyber Due Diligence' A Patchwork of Protective Obligations in International Law.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\2UKPB5HR\\Sun et al. - 2022 - Back to the roots the laws of neutrality and the future of due diligence in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZXSCN3PR\\Bace et al. - 2024 - Law in orbit international legal perspectives on cyberattacks targeting space systems.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\G25T89CM\\D6NK3C6C.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\P9XULYTS\\(Constantine Antonopoulos, Constantine Antonopoulos, 2015).pdf',
     "C:\\Users\\luano\\Zotero\\storage\\JS5JGNEN\\Lumiste - 2023 - There and Back Again Russia's Quest for Regulating War in Cyberspace.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\26C44MM8\\Poli and Sommario - 2023 - The rationale and the perils of failing to invoke state responsibility for cyber-attacks the case o.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VJ94NRGG\\fact-finding-and-cyber-attribution.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PHF2BP4S\\DBQU9R27.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\HA7AW48H\\ssrn_id2312039_code2107120.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8W63CDGK\\DFTYL7ZR.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9LUVSGM7\\Delerue - 2020 - Cyber operations and the principle of due diligence.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\9HN4CEIG\\Musus - 2023 - Norway's position paper on international law and cyberspace introduction.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\L2DV9X5S\\Liebetrau - 2022 - Cyber conflict short of war a european strategic vacuum.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\E4JSM9VC\\DN2JVA53.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\STSZBP76\\DNLJ4CZY.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\M6X4PUTB\\Lin - 2012 - Cyber conflict and international humanitarian law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PJU948YM\\Knake - 2010 - Untangling attribution moving to accountability in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4ZS3E8NG\\main.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3RKB6HUX\\DSMZEC52.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\N9P3C34F\\(Priyanka R. Dev, 2015).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\R4NXUTUH\\E572CT4J.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TLDPQXCR\\Brecher - 2012 - Cyberattacks and the Covert Action Statute Toward a Domestic Legal Framework for Offensive Cyberope.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BZKGKLR6\\(Ian Yuying Liu, Ian Yuying Liu, 2017).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VIEBJQX5\\EDRBZPWK.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KNBMWHJ2\\Delerue - 2019 - Attribution to State of Cyber Operations Conducted by Non-State Actors.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZI8UCZ3J\\EIPXQPAX.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\N663BFIA\\(Michael N Schmitt, ).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\JA3THCZQ\\(W Banks, 2021).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\D4EPUSTX\\F59PP7IQ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BNAUUU7U\\F96BBUH2.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\H3SS44SI\\FGS2JBMB.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\27STTT38\\FI45IHWH.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AQKNCN8E\\Nyabuto - 2018 - A game of code challenges of cyberspace as a domain of warfare.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8KBJI8DG\\FL7BQXNA.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RSKMD4PI\\FLF7MXN7.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8F44G63I\\Eichensehr - 2021 - Cyberattack attribution as empowerment and constraint.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8F66RMG9\\FNLMK9YC.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\G9TGPERZ\\10.1093_ejil_chy071.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DGTMNX8X\\FRXPAZU5.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\U7GP34TV\\FUL8EHLY.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\C9E5CPGH\\contributing-to-cyber-peace-by-maximizing-the-potential-for-deterrence.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FLSX9PCP\\Bowman - Securing the precipitous heights U.S. lawfare as a means to confront china at sea, in space, and cy.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Q95G65KK\\G2JMAAXE.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QZ6DZN5R\\G3GIESNY.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\2XSQ2RHD\\G3XGGFGV.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PMBW5QQ7\\G3Y2E42Y.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\2SKNXIKR\\(S Haataja, 2020).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TXITK3CD\\commentary-on-the-law-of-cyber-operations-and-the-dod-law-of-war-manual.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IAR9KP2Y\\Milanovic and Schmitt - 2020 - Cyber attacks and cyber (mis)information operations during a pandemic.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4VEK67R2\\GB643C9M.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9JIKZ8JK\\Buchanan and Cunningham - 2023 - Preparing the Cyber Battlefield Assessing a Novel Escalation Risk in a Sino-American Crisis.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\2U96QSAU\\Libicki - 2010 - Pulling Punches in Cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\C3W3M3R4\\GJN5PHZN.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9ELZFVCT\\Shackelford and Russell - 2015 - Operationalizing Cybersecurity Due Diligence A Tr.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7FW8PUIJ\\GNTEAFVK.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SEHUMHM5\\(, 2023).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\JKGWZZA7\\prohibition_of_annexations_and_the_foundations_of_modern_international_law.pdf.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AKCWQN2P\\GS8TNTUF.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\B7AJQRMK\\Jardine et al. - 2024 - Cyberattacks and public opinion - The effect of uncertainty in guiding preferences.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\99VRUZAP\\Jones - 2025 - Food security and cyber warfare vulnerabilities, implications and resilience-building.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\A4KMJT42\\5249574.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TVQR8CB9\\GZMIHZSQ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4CQS3SJI\\H4LCQ9GF.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\84PWNVHA\\Coco et al. - 2022 - Illegal the SolarWinds hack under international law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EK2HFFX7\\H5YJTMV4.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4ZCFHXZR\\H8HADWAZ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\5G8TDHJW\\HA6R6G3S.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3WLSSXXM\\Mueller et al. - 2019 - Cyber attribution can a new institution achieve transnational credibility.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8FZNCNRT\\HKUI3UUL.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\JNIUXSRB\\Moynihan - 2021 - The vital role of international law in the framework for responsible state behaviour in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\A5FNA7M6\\ssrn_id2809223_code2291099.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\6TTMF4HB\\ssrn_id2809828_code2291099.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\M9FS39VV\\(Y Shany, T Mimran, 2021).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\5RZPSEMP\\Egloff - 2020 - Contested public attributions of cyber incidents and the role of academia.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CYV8L5WV\\Royakkers - 2024 - Bytes and battles pathways to de-escalation in the cyber conflict arena.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9LFQBMNT\\(Terry D. Gill, Paul AL Ducheine, 2013).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\5J2E9THG\\Clark DD - 2010 - Untangling attribution..pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8IJNH37U\\I2RU2RL3.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FZUGF74D\\Karim - 2021 - Cybersecurity and cyber diplomacy at the crossroad an appraisal of evolving international legal dev.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\MMXYI7VJ\\Eichensehr - 2021 - United states joins with allies, including nato, to attribute malicious cyber activities to China.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KT5YPVK4\\Turner - 2023 - Network tango examining state dispositions toward attribution in international cyber conflict.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3TDBCI5N\\van Niekerk and Ramluckan - 2019 - Economic Information Warfare Feasibility and Lega.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\G23L96FG\\Broeders et al. - 2020 - Three tales of attribution in cyberspace criminal law, international law and policy debates.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\6DJWEN97\\I8XAL7B7.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TABB22B4\\(Major Patrick Leblanc, 2019).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ALSS2443\\Johnson and Schmitt - 2021 - Responding to proxy cyber operations under international law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8PTWUENN\\IGBQNFQD.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\B8HXL78Y\\ProQuestDocuments-2025-07-08.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VS2BDFTH\\Harrison Dinniss - 2012 - Computer network attacks as a use of force in international law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SFRTBDAR\\ILHEA8XF.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Q37ICKIY\\Mares and Packa - 2023 - Achieving cyber power through integrated government capability factors jeopardizing civil-military.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VC3J6RSK\\IVE6FH53.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9224LCF2\\Krishnamurthy - 2020 - Cyber-attacks in outer space a study.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8WZUBPIP\\03071847.2014.895264.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\UQHS5WB9\\J6RVYGY5.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\K56NV2CZ\\J6V79T5P.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\34RLRYKB\\Geiss and Lahmann - 2014 - Freedom and security in cyberspace shifting the focus away from military responses towards non-forc.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IS55CM5L\\Akoto - 2022 - Accountability and cyber conflict examining institutional constraints on the use of cyber proxies.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TBBTDB7I\\Dederer and Singer - 2019 - Adverse Cyber Operations Causality, Attribution, .pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FS6PF4KE\\Nihreieva - 2025 - State responsibility for cyberattacks as a use of force in the context of the 2022 russian invasion.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\W2U3WHU9\\J9G2U8UR.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RWBTGEGA\\ssrn_id3770816_code3850815.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BHBX48LE\\Lefebvre - 2018 - Cracking attribution  moving international norms forward.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZZDQ9NNC\\JJF7D6TB.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RHWMFZIE\\JL2UHGBX.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DX43THX4\\Devanny et al. - 2022 - Strategy in an Uncertain Domain Threat and Response in Cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AYMCTD6W\\Costea - 2023 - Private-public partnerships in cyber space as deterrence tools. The trans-atlantic view.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9GWBWECJ\\Mejia and Framework - 2014 - Act and actor attribution in cyberspace a proposed analytic framework.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\2SCRSVZP\\JVRG9M6B.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SJ7TGYWN\\Kouloufakos - 2024 - International law attempts to protect critical infrastructures against malicious cyber operations.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\U75ELNXY\\Rahman and Das - 2024 - Countering cyberattacks gaps in international law and prospects for overcoming them.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PLFJFG5R\\Kostyuk and Zhukov - 2019 - Invisible digital front can cyber attacks shape battlefield events.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\432YQMES\\Sopilko - 2024 - Strengthening cybersecurity in Ukraine legal frameworks and technical strategies for ensuring cyber.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TMV6IRC5\\Merriman - 2025 - Cyber warfare and state responsibility  exploring accountability in international law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Z73E4XRG\\(MA Gomez, 2019).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7U93KB98\\(W Banks, 2018).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\UBCLI25S\\Nadibaidze - 2022 - Great power identity in Russia’s position on auton.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ITA9T458\\(Hidemi Suganamiet al, 2017).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\UF2B5MAX\\KBF7RF2X.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\29KYPV6Y\\Gill - 2020 - The changing role of multilateral forums in regulating armed conflict in the digital age.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\59Q74PU4\\ssrn_id2351590_code2153015.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\X9YWAL6Y\\Waxman - Self-Defensive Force Against Cyber Attacks Legal, Strategic and Political Dimensions.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3INRP733\\KM8DK8IC.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\79SCFQ9Z\\Healey et al. - 2014 - Confidence-building measures in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SM27LBGY\\Taillat - 2019 - Disrupt and restraint the evolution of cyber conflict and the implications for collective security.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RSJUKS7S\\Geopolitics+and+Cyber+Power_3A+Why+Geography+Still+Matters.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\G5D68DQZ\\O'Grady - 2023 - International law and the regulation of cyberoperations below the jus ad bellum threshold. An irish.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\37FP3RNZ\\div-class-title-the-final-frontier-of-cyberspace-the-seabed-beyond-national-jurisdiction-and-the-protection-of-submarine-cables-div.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\GD4JEXDK\\KTLCNE2P.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CF82VE3Z\\state-responsibility-and-the-consequences-of-an-internationally-wrongful-cyber-operation.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EUATRQXD\\4999418.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\JCKBBC7S\\KU7SNJPJ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IYHJ3EYD\\Schmitt - THE LAW OF CYBER WARFARE.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FV7UQ84S\\Lilli - 2021 - Redefining deterrence in cyberspace private sector contribution to national strategies of cyber det.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\WE3BQFRH\\KZLR9EC7.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\S5EV8ZHQ\\L4PXZS27.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QJMRDUNP\\2WuhanUIntlLRev59.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\HBBNEZ27\\Done - 2022 - Applicability of international law in cyberspace positions by Estonia and Latvia.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BQWJWAXP\\Tsagourias - 2012 - Cyber attacks, self-defence and the problem of attribution.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BWEMFB5Z\\LFMAW5LQ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\5WN99HMI\\Shackelford et al. - 2015 - Unpacking the International Law on Cybersecurity Due Diligence Lessons from the Public and Private.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KXAP4LW3\\Yannakogeorgos e Mattice - 2011 - Essential Questions for Cyber Policy Strategically Using Global Norms to Resolve the Cyber Attribut.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9IJ8FIYV\\Bentley - 2020 - The inadequacy of international law to address cyber-attacks in the age of election-meddling.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7ZCU665W\\Shandler - 5187 - Cyber conflict & domestic audience costs.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZVZK7G36\\LQD6HMYI.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\MWISD73X\\LQZFZW63.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Q9AVTAXC\\Gunatileka - 2024 - “big data breaches”, sovereignty of states and the challenges in attribution.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QVWL78W7\\Brantly - 2016 - The most governed ungoverned space legal and policy constraints on military operations in cyberspac.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\6JPPM9SY\\Roscini - 2010 - World wide warfare - jus ad bellum and the use of cyber force.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\39A88DZJ\\Goel - 2020 - How improved attribution in cyber warfare can help de-escalate cyber arms race.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\WK2NNZRQ\\M4HUQ5E9.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EMN5XI8H\\MCKGE6GE.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\87P7H55I\\MDKDA8HZ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8CPFBC2H\\MFRGQXGQ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TDS8BHD5\\MN8W6UW5.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IS5BTM5C\\MNK78483.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\C8EGEG9W\\(Jakub Spáčil, 2022).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Q55X6C7V\\(Yoram Dinstein, Fania Domb, Laurie R. Blank, 2013).pdf',
     "C:\\Users\\luano\\Zotero\\storage\\5UGG387F\\Kolodii - 2024 - Unpacking russia's cyber-incident response.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\KXCAVVDI\\Franzese - 2009 - Sovereignty in cyberspace can it exist.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LEFUBTPE\\Braw and Brown - 2020 - Personalised deterrence of cyber aggression.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\55UG3WK4\\N4DB92C3.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Q6N2HWHB\\N4N4HUIT.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZX43QZLK\\Iasiello - 2013 - Cyber attack a dull tool to shape foreign policy.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3A8G854U\\24JKoreanL83.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IVYACB5R\\Mendes - 2020 - The problem of cyber - attribution and how it matters for international law and global security.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IW2VLL2E\\Waxman - 2011 - Cyber-attacks and the use of force back to the future of article 2(4).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Y43F6E7G\\Joyner and Lotrionte - 2001 - Information warfare as international coercion elements of a legal framework.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\44HR5X9Z\\viewcontent.cgi.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LJJ6ILJJ\\(V Greiman, 2021).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4TNW8W6J\\Banks.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BSWYT548\\Whyte - 2025 - The subversion aversion paradox juxtaposing the tactical and strategic utility of cyber-enabled inf.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3R2MZGXM\\(Yael Ronen, 2020).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SLSYCYY5\\(CD Westphal, 2021).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NHVMK66E\\13600834.2021.2018760.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LB6B2D2F\\Maurer - 2016 - Proxies and cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\X68C5LSU\\Lucas - 2014 - Ethics and cyber conflict a response to JME 121 (2013).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\P3DV26AN\\Thumfart - 2020 - Public and private just wars distributed cyber deterrence based on vitoria and grotius.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4ALCTATC\\Kostyuk - 2021 - Deterrence in the cyber realm public versus private cyber capacity.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7U4V7G3B\\Efrony - 2024 - Enhancing accountability in cyberspace through a three-tiered international governance regime.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9VZXJUSU\\NTUET9XJ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\2DFBFQRI\\Mikanagi and Macak - 2020 - Attribution of cyber operations an  international law perspective on the park jin hyok case.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\6AC8UNWK\\NZV97JVD.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PGYYX6V4\\Kulaga - 2024 - Mapping the Position of States on the Application of Sovereignty in Cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4ADWMUSC\\P8MZ2SLR.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3RHKVEKR\\Kuerbis et al. - 2022 - Understanding transnational cyber attribution moving from whodunit to who did it.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SL28SMWM\\Kargar and and Rid - 2024 - Attributing digital covert action the curious case of WikiSaudiLeaks.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AGRGSX9P\\PDPIGILK.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DH4CXZJQ\\PETZPV7M.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BQW6GGJG\\Baram - 2024 - Cyber diplomacy through official public attribution paving the way for global norms.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VW4TVFBF\\Schulzke - 2018 - The politics of attributing blame for cyberattacks and the costs of uncertainty.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\449MZF4Z\\00396338.2020.1715071.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\D6BRXXJW\\PLBY6MLI.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VU54JZQ2\\Finnemore et al. - 2020 - Beyond naming and shaming accusations and international law in cybersecurity.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CKXV9IG3\\PNN272MD.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7QIBK7WR\\PNUMBPFN.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BSB6AKSX\\Valeriano and Maness - 2014 - The dynamics of cyber conflict between rival antagonists, 2001-11.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4R2DQ4FK\\Hedgecock - 2021 - Strategic Attribution Target State Communications in Response to Cyber Operations.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\UPUSZZRX\\Neilsen and Pontbriand - 5187 - hands off the keyboard NATO's cyber-defense of civilian critical infrastructure.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\GZDNRNAV\\Verhelst - 2019 - Cybersecurity and international law  a closer look at recent UN and EU initiatives.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4PPV5ZIE\\PXUUQSYY.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AZEMZSHR\\PZVALH97.pdf', 'C:\\Users\\luano\\Zotero\\storage\\DK4AQT5B\\_.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EGZM233Z\\Q9T5XCPB.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\YY68V4RS\\Jimoh - 2023 - Critiquing the U.S. characterization, attribution and retaliation laws and policies for cyberattacks.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\MG4GMXEG\\QBKF5JHF.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Y556PFU7\\Bobrowski - 2021 - Conventional attack vs digital attack in the light of international law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\UF4NBHET\\QDZRQNQR.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\5F79G29F\\(Vera Rusinova, Ekaterina Martynova, 2024).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9C6G84ZM\\QNXUQSEG.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CC3F7I57\\Eichensehr - 2022 - Not illegal the solarwinds incident and international law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FT8GB4DF\\Buchan - 2016 - Cyberspace, non-state actors and the obligation to prevent transboundary harm.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KKZ6E7ZU\\ssrn_id3712264_code1687971.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\2H8H9DLZ\\Libicki - 2020 - Cyberwar is What States Make of It.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZNEMUVB7\\Leiss - Jus contra bellum in cyberspace and the sound of silence.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\WBTIVM4E\\viewcontent.cgi.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FVPKRRVP\\Grote - 2023 - Best of both world The interplay between international human rights and the law of armed conflict i.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IIG2Q384\\div-class-title-data-warfare-and-creating-a-global-legal-and-regulatory-landscape-challenges-and-solutions-div.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SFJ6BQI8\\Rowe - 2010 - The ethics of cyberweapons in warfare.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ERR65JSK\\QWWWJG7F.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DESLNL49\\Stockburger - 2016 - KNOWN UNKNOWNS STATE CYBER OPERATIONS, CYBER WARF.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AURGCWN3\\election-interference-is-not-cyber-war.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\GH2JRNA6\\Roscini - 2014 - Cyber operations as nuclear counterproliferation measures.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\V4EQSF55\\(Herbert Lin, 2016).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\II782S4S\\Egloff et al. - 2023 - Publicly attributing cyber attacks a framework.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\C6SG966A\\RCFHU8Y8.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\R55RNBDG\\RCWTG8Q4.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\D49TVXJN\\Earl Boebert - A Survey of Challenges in Attribution.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QRV3ITUS\\RD9BVGFE.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EH99IMFV\\RGSGEU4F.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9HWAH2DG\\Poetranto et al. - 2021 - Look south challenges and opportunities for the ‘rules of the road’ for cyberspace in ASEAN and the.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SGPTJQAG\\RL7CIYPG.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\5PRSJFN4\\RMPS5TEA.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8NEPBGXJ\\ssrn_id3962163_code1636539.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TN3I49T8\\RPGYA5D6.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FDGD7JGH\\Abramson and Baram - 2024 - Saving face in the cyberspace responses to public cyber intrusions in the gulf.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\V8US5VD4\\(Nikhil D'Souza, Nikhil D'Souza, 2011).pdf",
     'C:\\Users\\luano\\Zotero\\storage\\8Z5LNACI\\Hunter et al. - 2024 - When democracies attack examining the offensive strategies of democracies in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NTSKPQZC\\S4V5WX2Z.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RMLNAJQX\\Bronk and Watling - 2021 - I. The slow and imprecise art of cyber warfare.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4IF2RM9S\\ssrn_id1800924_code1349730.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\I7Y3IZ5N\\Osula et al. - 2022 - EU common position on international law and cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4QEWRNRI\\SBM8MRLC.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ELEJRCYW\\(Aaron Franklin Brantly, William W. Keller, Scott A. Jones, 2016).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\G7UZ644H\\SDCNTLIS.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LF6XANQ9\\Huang and Ying - 2020 - The application of the principle of distinction in the cyber context a chinese perspective.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\WQ49XKB4\\4976241.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\A93SXJXF\\10.4337_9781782547396.00018.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LGC8NTBN\\Gomez and Winger - 5187 - Answering the call why aid allies in cyber conflict.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VXDSME4L\\Arimatsu et al. - 2021 - The plea of necessity an oft overlooked response option for hostile cyber operations.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4FFALA24\\Haataja - 2022 - Cyber operations against critical infrastructure u.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\B8N5UIHR\\0163660X.2022.2054123.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QUTGADTW\\viewcontent.cgi.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9ZA6HYTV\\(Isabella Brunner, 2022).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VITJ5DDH\\10.23919_cycon.2019.8757141.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Y5799FTK\\Schmitt and Vihul - 2014 - The nature of international law cyber norms.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BTURKZNN\\Aravindakshan - 2021 - Reflections on information influence operations as illegal intervention.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ICAKJ5L5\\Kodar - 2009 - Computer network attacks in the grey areas of jus ad bellum and jus in bello.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\X93ASRNE\\SXEQP8DX.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\XB5VK994\\SZX5ZFZR.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\HWJKV38N\\T5LE96UX.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\X5JBVTTF\\Kittichaisaree - 2017 - Future prospects of public international law of cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DGL5UXA3\\(Sean Kanuck, 2009).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\VN7ML3EU\\Castel - 2012 - International and canadian law rules applicable to cyber attacks by state and non-state actors.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\MSTP3MJK\\TD5PT97Q.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TIQN8PFG\\23738871.2019.1701693.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BQGEFM7E\\TI3B6KUX.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7VQWMTEI\\TL8H845Y.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\B5XE6HJV\\Hansel - 2023 - Great power narratives on the challenges of cyber norm building.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\HI3IFGAM\\TMANA99R.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9ITFF92E\\Tallinn_Papers_Attribution_18082021.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\R95ICDVC\\Broeders et al. - 2022 - Revisiting past cyber operations in light of new cyber norms and interpretations of international la.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SV47ZT67\\TTB7D3FI.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\MSKUASKA\\Hedgecock and Sukin - 2023 - Responding to uncertainty the importance of covertness in support for retaliation to cyber and kine.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\2P8WTWEJ\\TTWFXCVM.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4GMLJQWW\\Schmitt_2015_In Defense of Due Diligence in Cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\99BZ6RLH\\Rivera - 2015 - Achieving cyberdeterrence and the ability of small states to hold large states at risk.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\UXFM9FEG\\Maurer - 2020 - A dose of realism the contestation and politics of cyber norms.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\6SHW8NFQ\\Douzet and and Gery - 2021 - Cyberspace is used, first and foremost, to wage wars proliferation, security and stability in cyber.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7JVHAEGI\\Taddeo - 2018 - The limits of deterrence theory in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4PNPTXKH\\U6DF4B74.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\F5EFI333\\Spacil - 2022 - Plea of necessity legal key to protection against unattributable cyber operations.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\24NZ6WBN\\Johnson - 2014 - Anti-social networking crowdsourcing and the cyber defence of national critical infrastructures.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IXRGJPF9\\UE52YCCT.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\T2USX8B8\\UEELS534.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\XHEFXPZG\\book-part-9781035308514-14.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NC8QFI9F\\2010 - .pdf',
     'C:\\Users\\luano\\Zotero\\storage\\G5NCEDZR\\Dwan et al. - 2022 - Pirates of the cyber seas are state-sponsored hackers modern-day privateers.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NFP8IX79\\Orji - 2021 - Interrogating african positions on state sponsored cyber operations a review of regional and nation.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9M797C2J\\Davis - 2022 - Developing Applicable Standards of Proof for Peacetime Cyber Attribution.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\PE3E8HRP\\UNSVBH4H.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8Y329NED\\(Herbert S. Lin, 2010).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\XTHLGU23\\(Graham H. Todd, 2009).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BHJKRERB\\UY34U6AF.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LMACY3DS\\Buchan - 2012 - Cyber attacks unlawful uses of force or prohibited interventions.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\FRE3DRUN\\V2DDH444.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9CV93KFD\\V388FEEB.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\M34Z4A4M\\ssrn_id3256666_code2418133.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\47P68ECQ\\V4MDI2UW.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\HB7772FV\\V4PCGAXE.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\AJM7LAB6\\(A Lupovici, 2016).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CJEQWCLW\\Stevens - 2012 - A Cyberwar of Ideas Deterrence and Norms in Cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9QP7MU7H\\article-p3.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8EGTFAN3\\Kavaliauskas - 2022 - Can the concept of due diligence contribute to solving the problem of attribution with respect to cy.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\HHLYGW2V\\Styple - 2021 - Institutional doxing and attribution  searching for solutions to a law-free zone.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\5THJWTDG\\Giovannelli - 2024 - Handling cyberspace's state of intermediacy through existing international law.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\WPHNAFZS\\10.1080_19445571.2011.636956.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\GAQX5LSP\\(Katharine C Hinkle, 2011).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\MQQ6BME5\\VCP74I7C.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8MYLAPTM\\Tran - 2018 - The Law of Attribution Rules for Attribution the Source of a Cyber-Attack Note.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DZJWKF4X\\(Metodi Hadji-Janev, 2023).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\D6FHJXM4\\(Thomas Payne, 2016).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KIEVHD6A\\Kryvoi - 2023 - Responding to public and private cyberattacks jurisdiction, self-defence, and countermeasures.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\8HHILB7U\\Brown and Fazal - 2021 - #SorryNotSorry why states neither confirm nor deny responsibility for cyber operations.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BMZBMTIR\\VLCM76NL.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZN2WUE4K\\W3C25H39.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\EGZ3TNAS\\(Christian Payne, Lorraine Finlay, 2017).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZKJ2FQJ6\\QV47NQ33.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QZLCBYMY\\STRATEGU OF RESPONSE.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DD9WHB96\\Hunter et al. - 2021 - Factors That Motivate State-Sponsored Cyberattacks.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QEZVAE7A\\WFR2Y7FX.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\G45WYA5E\\jmae005.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZITNK5HV\\WGC5LU23.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QH6BZ5WG\\WIJUSXWQ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\GMJ49DID\\(Justin Key Canfil, 2020).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\9R5XDITV\\WNYMAT97.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\MU2LZIIG\\Fidler et al. - 2013 - NATO, cyber defense, and international law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ST25QSJZ\\(Taís Fernanda Blauth, Dr Oskar J Gstrein, 2021).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\USBCBC6G\\van der Meer - 2015 - Enhancing international cyber security.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\IYSM4QS5\\Maness et al. - 2023 - Expanding the dyadic cyber incident and campaign dataset (DCID) cyber conflict from 2000 to 2020.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\USCR66RW\\WWB8FYLM.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4TDKV3MS\\WYZ9DEUV.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\848TDD2N\\Schmitt - 2011 - Cyber operations and the jus in bello key issues.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\67VR4UJ5\\(B Kuerbiset al, 2018).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\2RTCIZNG\\Schmitt and Vihul - 2014 - Proxy wars in cyberspace the evolving international law of attribution policy.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\QLZR6EEJ\\Tanyildizi - 2017 - State responsibility in cyberspace the problem of attribution of cyberattacks conducted by non-stat.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KTQSP4IL\\Reich et al. - 2010 - Cyber warfare a review of theories, law, policies, actual incidents -- and the dilemma of anonymity.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\P9J6F97F\\XFPCE7YP.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\TIBMM59C\\Lopez - 2024 - Self-help measures against cyber threats in international law special reference to the possible ado.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CPJLL28H\\(Peter Z. Stockburger, Peter Z. Stockburger, 2017).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\DNCGZP5A\\WBIJQYQJ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\MRV366MP\\ssrn_id3793013_code3640433.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LZWDBFQX\\(Jason Healey, 2012).pdf',
     'C:\\Users\\luano\\Zotero\\storage\\KGBB4K7W\\XUBKQ3AX.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3DAQIG8K\\23738871.2024.2436591.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4KQ2BT2W\\XVFULTHJ.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\Z7V8F68H\\XVSZPADD.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BRV2AQNH\\Grotto - 2020 - Deconstructing cyber attribution a proposed framework and lexicon.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\YT8YRPLC\\Canfil and Canfil - 2022 - The illogic of plausible deniability why proxy conflict in cyberspace may no longer pay.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\ZMLR9BT7\\Lindsay - 2021 - Cyber conflict vs. Cyber command hidden dangers in the american military solution to a large-scale.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\L7VV4N63\\Cook - 2018 - Cross-border data access and active cyber defense Assessing legislative options for a new internati.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\5II3ZVWR\\Y8F4CS6U.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\BVKDVM6A\\5216954.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NCG9RMS8\\Hollis and Sander - 2022 - International law and cyberspace what does state silence say.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RFFBZ5IZ\\Harnisch and Zettl-Schabath - 2023 - Secrecy and norm emergence in cyber-space. The US, china and Russia interaction and the governance o.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\I8FCUR9B\\YC8AZ2N5.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3LLK7K2Q\\Hoverd - 2021 - Cyber threat attribution, trust and confidence, and the contestability of national security policy.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\CHDMIBPR\\YGWXNVBX.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\NGXDZG5T\\YHVAWNQ2.pdf',
     "C:\\Users\\luano\\Zotero\\storage\\FQ8YINWB\\Prieto - 2021 - Virtually defenseless america's struggle to defend itself in cyberspace and what can Be done about.pdf",
     "C:\\Users\\luano\\Zotero\\storage\\U3KGJY93\\Serscikov - 2025 - The role of strategic culture in shaping iran's cyber defense policy.pdf",
     'C:\\Users\\luano\\Zotero\\storage\\VCRDXKUD\\Whyte - 2020 - Beyond tit-for-tat in cyberspace political warfare and lateral sources of escalation online.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\5GPG5C4R\\YPZ7C3CB.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\V7U5TQMS\\Yau - 2020 - Evolving toward a balanced cyber strategy in east Asia cyber deterrence or cooperation.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\62CSLXMS\\Lee - 2023 - Public attribution in the US government implications for diplomacy and norms in cyberspace.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RYKJ4KWM\\Lindsay - 2015 - Tipping the scales the attribution problem and the feasibility of deterrence against cyberattack.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\SRSXF7CA\\Lotrionte - 2018 - Reconsidering the Consequences for State-Sponsored Hostile Cyber Operations Under International Law.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\RSAT6ITF\\Schmitt - 2011 - Cyber operations and the jud ad bellum revisited.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\7VF2939S\\Soesanto and Smeets - 2021 - Cyber Deterrence The Past, Present, and Future.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\3RVAPNPA\\Bergwik - 2020 - Due diligence in cyberspace an assessment of rule 6 in the Tallinn manual 2.0.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\A6AQT75H\\Alweqyan - 2024 - Cyberattacks in the context of international law enforcement.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\4MBEJXU3\\Flor - 2023 - Using international law to deter russian proxy hackers.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\LGB85JTH\\Nguyen - 2013 - Navigating Jus Ad Bellum in the Age of Cyber Warfare.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\24CLLSPP\\Sigholm - 2013 - Non-state actors in cyberspace operations.pdf',
     'C:\\Users\\luano\\Zotero\\storage\\XSHAZYVI\\Baradaran and Habibi - 2017 - Cyber Warfare and Self - Defense from the Perspective of International Law.pdf',
     # 'C:\\Users\\luano\\Zotero\\storage\\L2LXU8SZ\\Hare - 2012 - The signifi cance of attribution to cyberspace coercion A political perspective.pdf'
           ]

    return pdfs



# =========================================================================
# 1. STYLESHEET (As provided by you)
# =========================================================================
DARK_STYLESHEET = """
QWidget { background-color: #2b2b2b; color: #bbbbbb; font-size: 13px; }
QTextEdit, QListView, QLineEdit { background-color: #313335; border: 1px solid #555555; border-radius: 4px; padding: 5px; }
QTextEdit#log-pane { font-family: Consolas, monospace; font-size: 12px; padding: 10px; border: 1px solid #444; }
QLabel#title-label { font-size: 14px; font-weight: bold; color: #a9b7c6; }
QPushButton { background-color: #4a4d50; border: 1px solid #646464; padding: 8px; min-height: 20px; border-radius: 4px; }
QPushButton:hover { background-color: #5a5d60; }
QPushButton:pressed { background-color: #3e3e3e; }
QPushButton:disabled { background-color: #3a3d40; color: #777777; }
QPushButton#nav-button { background-color: #3c3f41; border: 1px solid #555; font-size: 16px; font-weight: bold; min-width: 40px; max-width: 40px; margin: 0 4px; }
QPushButton#nav-button:hover { background-color: #4a4d50; }
QPushButton#nav-button:disabled { background-color: #2b2b2b; color: #555; }
QSplitter::handle { background-color: #3c3f41; }
QSplitter::handle:horizontal { width: 6px; }
QSplitter::handle:hover { background-color: #555; }
QTabWidget::pane { border-top: 2px solid #555; }
QTabBar::tab { background: #3c3f41; border: 1px solid #555; border-bottom-color: #3c3f41; padding: 6px 12px; border-top-left-radius: 4px; border-top-right-radius: 4px; margin-right: 4px; }
QTabBar::tab:selected { background: #4a4d50; border-color: #646464; border-bottom-color: #4a4d50; }
QTabBar::tab:!selected:hover { background: #4e5154; }
QScrollBar:vertical, QScrollBar:horizontal { border: none; background: #313335; width: 10px; margin: 0; }
QScrollBar::handle { background: #555; min-height: 20px; border-radius: 4px; }
QScrollBar::handle:hover { background: #666; }
.success { color: #6a8759; }
.warning { color: #eda561; }
.failure { color: #ff7b7b; }
"""
# ── Dark theme (ChatGPT/PyCharm-ish) ─────────────────────────────────────────
DARK_QSS = """
QWidget { background: #202123; color: #e5e7eb; }
QSplitter::handle { background: #2a2b32; }
QLineEdit, QTextEdit, QTextBrowser, QTableWidget, QTreeWidget {
  background: #202123; color: #e5e7eb; selection-background-color: #10a37f; border: 1px solid #2a2b32;
}
QTreeWidget::item:selected { background: #10a37f; color: #0b0c10; }
QTreeWidget { outline: 0; }
QTableWidget::item:selected { background: #10a37f; color: #0b0c10; }
QPushButton { background: #2d2f39; border: 1px solid #363947; padding: 6px 10px; border-radius: 6px; }
QPushButton:hover { background: #343541; }
QPushButton:disabled { color: #8b8ea1; border-color: #2f3140; }
QLabel#title-label { font-weight: 700; color: #f3f4f6; }
QTextEdit#log-pane, QTextEdit#stats-pane { background: #1f2128; border: 1px solid #2a2b32; }
"""

# HTML/CSS for Markdown panes (QTextBrowser.setHtml)
MD_HTML_WRAPPER = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root{
    --bg:#202123; --panel:#1f2128; --ink:#e5e7eb; --muted:#a1a1aa; --accent:#10a37f;
    --rule:#3a3b46; --codebg:#0f172a; --table:#2a2b32;
  }
  html,body{background:var(--bg); color:var(--ink); margin:0; padding:16px; font: 14px/1.6 "Inter",system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial;}
  h1,h2,h3,h4,h5,h6{margin:1.2em 0 .4em; line-height:1.25; color:#f3f4f6; font-weight:800}
  h1{font-size:1.8rem} h2{font-size:1.5rem} h3{font-size:1.25rem} h4{font-size:1.1rem}
  p{margin:.6em 0; text-align:justify}
  a{color:var(--accent); text-decoration:none} a:hover{text-decoration:underline}
  hr{border:0; border-top:1px solid var(--rule); opacity:.5; margin:1.25rem 0}
  blockquote{border-left:3px solid var(--rule); margin:.8em 0; padding:.2em .8em; color:var(--muted)}
  code, pre{font: 12px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
  pre{background:var(--codebg); border:1px solid var(--table); border-radius:8px; padding:10px; overflow:auto}
  code{background:var(--codebg); border:1px solid var(--table); border-radius:6px; padding:2px 4px}
  ul,ol{padding-left:1.4rem}
  table{border-collapse:collapse; margin:.8rem 0; width:100%; background:var(--panel)}
  th,td{border:1px solid var(--table); padding:.5rem; text-align:left}
  th{background:#262833}
  .foot-item{margin:1rem 0 1.4rem}
  .foot-item h2{margin:.2rem 0 .4rem}
  .foot-item p{margin:0 0 .5rem; text-align:justify}
  .foot-item ol{margin:.25rem 0 0 1.25rem}
</style>
</head>
<body>__CONTENT__</body>
</html>"""
NAV_ROLE = Qt.ItemDataRole.UserRole + 1  # store dict payloads on QTreeWidgetItem

class FullTextOnlyWindow(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Full Text Only")
        self.editor = QTextEdit(readOnly=True)
        lay = QVBoxLayout(self); lay.addWidget(self.editor)

    def set_text(self, txt: str):
        self.editor.setPlainText(txt)
class _QtLogWriter:
    def __init__(self, emit_fn):
        self._emit = emit_fn
        self._buf = ""

    def write(self, s: str):
        if not s:
            return
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            if line:
                self._emit(line)

    def flush(self):
        if self._buf:
            self._emit(self._buf)
            self._buf = ""


class PdfWorker(QThread):
    log_signal = pyqtSignal(str)
    result_signal = pyqtSignal(str, object)
    error_signal = pyqtSignal(str, str)

    def __init__(self, pdf_path: str, parent=None) -> None:
        super().__init__(parent)
        self.pdf_path = pdf_path
        self.md_dict = {}

    def run(self) -> None:
        w = _QtLogWriter(self.log_signal.emit)
        with contextlib.redirect_stdout(w), contextlib.redirect_stderr(w):
            print(f"processing pdf: \n{self.pdf_path}")

            data = process_pdf(
                str(self.pdf_path),
                cache=getattr(self, "opt_cache", False),
                cache_full=getattr(self, "opt_cache_full", True),
                core_sections=getattr(self, "opt_core_sections", True),
            )
            if data is None:
                raise ValueError("Processing returned None (processing failure).")
            self.result_signal.emit(self.pdf_path, data)
            w.flush()


def _gather_pdfs_from_argv_or_cwd() -> list[str]:
    """Return a list of .pdf paths. Use argv if given, else scan CWD."""
    paths = [p for p in sys.argv[1:] if p.lower().endswith(".pdf")]
    if paths:
        return paths
    here = Path.cwd()
    return [str(p) for p in sorted(here.glob("*.pdf"))]

class MetaScanWorker(QThread):
    """
    Background pass over all PDFs:
      1) Calls process_pdf(path) to compute & (re)write cache.
      2) Emits per-item metadata so the UI can update flags/filters.

    Signals
    -------
    progress(str, int, int): ('Scanning …', done, total)
    item(str, dict):          (path, process_pdf result dict)
    finished():               when all paths are processed
    """
    progress = pyqtSignal(str, int, int)
    item = pyqtSignal(str, dict)
    finished = pyqtSignal()

    def __init__(self, paths: list[str], parent=None):
        super().__init__(parent)
        self.paths = list(paths)

    def run(self):
        total = len(self.paths)
        done = 0
        for p in self.paths:
            try:
                # Always use the fresh output; your process_pdf writes/refreshes cache itself.
                data = process_pdf(p)  # must return the dict shape you pasted earlier
            except Exception as e:
                data = {"error": str(e)}

            self.item.emit(p, data or {})
            done += 1
            self.progress.emit("Scanning PDFs…", done, total)

        self.finished.emit()

# ─────────────────────────────────────────────────────────────────────────────
# SINGLE, DOUBLE-PAGE MAIN WINDOW  (keep one MainWindow in the file)
# ─────────────────────────────────────────────────────────────────────────────
class MainWindow(QWidget):
    def __init__(self, pdfs: list[str]) -> None:
        super().__init__()
        self.setWindowTitle("PDF Section Extractor — Double Page")
        self.pdfs = pdfs
        self.idx = 0
        self.worker = None
        self._meta_worker = None

        self._full_pane_saved = 400
        self._full_pane_collapsed = False
        self._full_pane_maximized = False
        self._setup_ui()

        if self.pdfs:
            self.start_meta_scan()  # background pre-scan for filters/schemes
            self.start_processing()  # open the first file
        else:
            self._update_title_label()

    # ── UI BUILD ────────────────────────────────────────────────────────────
    def _setup_ui(self) -> None:
        # Right side: logs (top) + stats (bottom)
        self.log_view = QTextEdit(readOnly=True);   self.log_view.setObjectName("log-pane")
        self.stats_view = QTextEdit(readOnly=True); self.stats_view.setObjectName("stats-pane")

        # Left nav (NO "Full Text" here; that lives in the left page)
        self.left_nav = QTreeWidget()
        self.left_nav.setHeaderHidden(True)
        self.root_flat      = QTreeWidgetItem(["Flat Text"])
        self.root_sections  = QTreeWidgetItem(["Sections"])
        self.root_footnotes = QTreeWidgetItem(["Footnotes"])
        self.left_nav.addTopLevelItem(self.root_flat)

        self.root_files = QTreeWidgetItem(["Files"])
        # put it just after Flat Text
        self.left_nav.addTopLevelItem(self.root_files)

        self.left_nav.addTopLevelItem(self.root_sections)
        self.left_nav.addTopLevelItem(self.root_footnotes)
        self.left_nav.expandItem(self.root_sections)



        # Content stack (right page): 0=flat, 1=section, 2=footnotes
        self.content_stack   = QStackedWidget()
        self.view_flat_text = QTextBrowser()
        self.view_section = QTextBrowser()
        self.view_footnotes = QTextBrowser()  # already was QTextBrowser before
        self.content_stack.addWidget(self.view_flat_text)
        self.content_stack.addWidget(self.view_section)
        self.content_stack.addWidget(self.view_footnotes)


        # Left “page” (Full Text) with a mini header bar containing a minimize toggle
        left_page = QWidget()
        left_v = QVBoxLayout(left_page); left_v.setContentsMargins(6, 6, 6, 6)
        # in the Full Text page header, add a Maximize button
        self.min_full_btn = QPushButton("🗕")
        self.min_full_btn.setToolTip("Minimize Full Text pane")
        self.min_full_btn.clicked.connect(self._toggle_full_minimize)

        self.max_full_btn = QPushButton("🗖")
        self.max_full_btn.setToolTip("Maximize Full Text pane")
        self.max_full_btn.clicked.connect(self._toggle_full_maximize)

        header = QHBoxLayout()

        lbl = QLabel("Full Text"); lbl.setObjectName("title-label")
        lbl.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        header.addWidget(lbl)
        header.addStretch(1)
        header.addWidget(self.min_full_btn)
        header.addWidget(self.max_full_btn)

        # and change the Full Text reader to QTextBrowser too:
        self.view_full_text = QTextBrowser()
        self.view_full_text = QTextEdit()
        left_v.addLayout(header)
        left_v.addWidget(self.view_full_text, 1)

        # Logs + Stats column
        right_column = QWidget()
        right_v = QVBoxLayout(right_column)
        right_v.setContentsMargins(6, 6, 6, 6)
        right_v.addWidget(self.log_view, 2)
        right_v.addWidget(self.stats_view, 1)

        # Center (double page): Full Text | Stacked
        self.center_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.center_splitter.addWidget(left_page)        # Full text
        self.center_splitter.addWidget(self.content_stack)  # Flat/Section/Footnotes
        self.center_splitter.setStretchFactor(0, 1)
        self.center_splitter.setStretchFactor(1, 1)

        # OUTER splitter: Nav | (Full | Stack) | Logs+Stats
        self.outer_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.outer_splitter.addWidget(self.left_nav)         # leftmost
        self.outer_splitter.addWidget(self.center_splitter)  # middle double page
        self.outer_splitter.addWidget(right_column)          # right column
        self.outer_splitter.setStretchFactor(0, 0)
        self.outer_splitter.setStretchFactor(1, 2)
        self.outer_splitter.setStretchFactor(2, 1)

        # Top bar (file nav + title + search)
        self.prev_btn = QPushButton("◀"); self.prev_btn.setObjectName("nav-button")
        self.next_btn = QPushButton("▶"); self.next_btn.setObjectName("nav-button")
        self.file_title_label = QLabel(); self.file_title_label.setObjectName("title-label")
        self.file_title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.search_input = QLineEdit(); self.search_input.setPlaceholderText("Search Full Text and press Enter…")

        self.filter_combo = QComboBox()
        self.filter_combo.setObjectName("filter-combo")
        self.filter_combo.addItems([
            "All files",
            "Only PASS (log)",
            "Only FAIL (log)",
            "Only PASS (stats)",
            "Only FAIL (stats)",
        ])

        # fixed scheme set requested
        self.scheme_combo = QComboBox()
        self.scheme_combo.setObjectName("scheme-combo")
        self.scheme_combo.addItems([
            "All schemes",
            "markdown",
            "roman",
            "numeric",
            "markdown_from_numeric",
            "roman_weak_split",
            "markdown_from_roman",
        ])

        from PyQt6.QtWidgets import QSpinBox
        self.min_rate_spin = QSpinBox()
        self.min_rate_spin.setRange(0, 100)
        self.min_rate_spin.setSuffix("%")
        self.min_rate_spin.setValue(0)

        self.max_rate_spin = QSpinBox()
        self.max_rate_spin.setRange(0, 100)
        self.max_rate_spin.setSuffix("%")
        self.max_rate_spin.setValue(100)

        # core state
        self.file_flags: dict[str, dict] = {}
        self.file_meta: dict[str, dict] = {}

        # universe & view-slice
        self.all_pdfs = list(self.pdfs)  # original universe
        self.view_indices = list(range(len(self.all_pdfs)))  # indices into all_pdfs
        self.view_pos = 0  # pointer inside view_indices

        top_bar = QHBoxLayout()
        top_bar.addWidget(self.prev_btn)
        top_bar.addWidget(self.file_title_label, 1)
        top_bar.addWidget(self.next_btn)

        top_bar.addWidget(self.search_input)
        top_bar.addWidget(self.filter_combo)
        top_bar.addWidget(QLabel("Scheme:"))
        top_bar.addWidget(self.scheme_combo)
        top_bar.addWidget(QLabel("Success:"))
        top_bar.addWidget(self.min_rate_spin)
        top_bar.addWidget(self.max_rate_spin)

        root = QVBoxLayout(self)
        root.addLayout(top_bar)
        root.addWidget(self.outer_splitter, 1)

        self.filter_combo.currentIndexChanged.connect(self._apply_filter)
        self.scheme_combo.currentIndexChanged.connect(self._apply_filter)
        self.min_rate_spin.valueChanged.connect(self._apply_filter)
        self.max_rate_spin.valueChanged.connect(self._apply_filter)

        # wiring
        self.left_nav.itemClicked.connect(self._on_left_nav_clicked)
        self.prev_btn.clicked.connect(self.show_prev)
        self.next_btn.clicked.connect(self.show_next)
        self.search_input.returnPressed.connect(self.perform_search)

        # internal
        self.section_map = {}
        self.left_nav.setCurrentItem(self.root_flat)
        self.content_stack.setCurrentIndex(0)

    # ── Behaviors ──────────────────────────────────────────────────────────
    def _toggle_full_minimize(self):
        sizes = self.center_splitter.sizes()
        total = max(1, sum(sizes))
        if not self._full_pane_collapsed:
            # save current left width (if visible)
            if sizes[0] > 0:
                self._full_pane_saved = sizes[0]
            self.center_splitter.setSizes([0, total])
            self._full_pane_collapsed = True
            self._full_pane_maximized = False
            self.min_full_btn.setToolTip("Restore Full Text pane")
        else:
            left = min(self._full_pane_saved or total // 2, total - 100)
            self.center_splitter.setSizes([left, total - left])
            self._full_pane_collapsed = False
            self.min_full_btn.setToolTip("Minimize Full Text pane")

    def _toggle_full_maximize(self):
        sizes = self.center_splitter.sizes()
        total = max(1, sum(sizes))
        if not self._full_pane_maximized:
            # store current left size for restore (if not collapsed)
            if sizes[0] > 0:
                self._full_pane_saved = sizes[0]
            self.center_splitter.setSizes([total, 0])
            self._full_pane_maximized = True
            self._full_pane_collapsed = False
            self.max_full_btn.setToolTip("Restore Full Text pane")
        else:
            left = min(self._full_pane_saved or total // 2, total - 100)
            self.center_splitter.setSizes([left, total - left])
            self._full_pane_maximized = False
            self.max_full_btn.setToolTip("Maximize Full Text pane")

    def _md_to_html(self, md_text: str) -> str:
        """
        Render Markdown to HTML and add stable id= anchors to headings (h1..h6)
        so in-page links like #introduction or footnote jumps can work.
        """
        try:
            # robust markdown rendering (tables, strikethrough, autolinks)
            md = MarkdownIt("commonmark").enable("table").enable("strikethrough").enable("linkify")
            rendered = md.render(md_text or "")

            # ----- helpers (scoped) -----
            import re, unicodedata, html as _html

            def _slugify(text: str) -> str:
                # make a URL/fragment-safe id from heading text
                text = unicodedata.normalize("NFKD", text)
                text = re.sub(r"<[^>]+>", "", text)  # strip tags
                text = _html.unescape(text)  # unescape entities
                text = re.sub(r"[^\w\-\. ]+", "", text, flags=re.ASCII)  # keep ascii word chars, dash, dot, space
                text = re.sub(r"\s+", "-", text).strip("-").lower()
                return text or "sec"

            def _add_heading_ids(html: str) -> str:
                # add id="" to any h1..h6 that doesn't already have one
                pat = re.compile(r"<h([1-6])([^>]*)>(.*?)</h\1>", re.IGNORECASE | re.DOTALL)

                def repl(m):
                    level = m.group(1)
                    attrs = m.group(2) or ""
                    inner = m.group(3) or ""
                    # if an id already exists, keep as-is
                    if re.search(r"\bid\s*=\s*['\"]", attrs):
                        return m.group(0)
                    # derive slug from visible text
                    visible = re.sub(r"<[^>]+>", "", inner)
                    slug = _slugify(visible)
                    new_attrs = (attrs + f' id="{slug}"').rstrip()
                    return f"<h{level}{new_attrs}>{inner}</h{level}>"

                return pat.sub(repl, html)

            # inject ids for internal navigation
            rendered = _add_heading_ids(rendered)

        except Exception:
            # if markdown-it ever chokes, fall back to plain-escaped text
            import html as _html
            rendered = "<pre>" + _html.escape(md_text or "") + "</pre>"

        return MD_HTML_WRAPPER.replace("__CONTENT__", rendered)

    def _on_left_nav_clicked(self, item: QTreeWidgetItem, column: int = 0):
        payload = item.data(0, Qt.ItemDataRole.UserRole)

        # Root clicks → just switch pages
        if item is self.root_flat:
            self.content_stack.setCurrentIndex(0)
            return
        if item is self.root_sections:
            self.content_stack.setCurrentIndex(1)
            return
        if item is self.root_footnotes:
            self.content_stack.setCurrentIndex(2)
            return

        # Typed payloads
        if isinstance(payload, dict):
            kind = payload.get("kind")

            if kind == "file":
                path = payload.get("path")
                if path and path in self.all_pdfs:
                    # jump to that file and re-run processing
                    self.idx = self.all_pdfs.index(path)
                    self.view_pos = next((i for i, gi in enumerate(self.view_indices) if gi == self.idx), 0)
                    self._goto_view_pos(self.view_pos)
                return

            if kind == "flat":
                self.content_stack.setCurrentIndex(0)
                return

            if kind == "section":
                body = payload.get("body") or ""
                self.view_section.setHtml(self._md_to_html(body))
                self.content_stack.setCurrentIndex(1)
                return

            if kind == "footnote":
                r = payload.get("result") or {}
                self.view_footnotes.setHtml(self._render_single_footnote_block(r))
                self.content_stack.setCurrentIndex(2)
                return

    def _render_single_footnote_block(self, r: dict) -> str:
        import html as _html
        idx = r.get("index") or r.get("n") or r.get("id") or "?"
        intext = r.get("intext_citation") or r.get("intext") or ""
        prev = r.get("preceding_text") or ""
        primary_fields = ["footnote", "match", "bib", "resolved", "target", "reference_text", "entry", "tex",
                          "candidate", "normalized"]
        detail = next((r.get(k) for k in primary_fields if r.get(k)), "")
        if detail and not isinstance(detail, str):
            detail = str(detail)
        detail_html = (
            f"<ol class='fn-list'><li>{_html.escape(str(idx))}. {_html.escape(detail)}</li></ol>"
            if detail else "<div class='muted'>No linked target</div>"
        )
        css = """
        <style>
          .foot-wrap{margin:10px 0 16px 0;padding:12px;border:1px solid #333;border-radius:10px;}
          .foot-wrap h2{margin:0 0 6px 0;font-size:18px;font-weight:800;}
          .foot-wrap h3{margin:0 0 10px 0;font-size:14px;color:#7c8799;font-weight:600;}
          .foot-wrap p{line-height:1.55;margin:0 0 6px 0;}
          .fn-list{margin:0 0 0 20px;padding-left:18px;}
          .muted{color:#8892a6;font-size:12px;margin-top:8px;}
        </style>
        """
        return css + (
            "<div class='foot-wrap'>"
            f"<h2>Footnote {_html.escape(str(idx))}</h2>"
            f"<h3>{_html.escape(str(intext))}</h3>"
            f"<p>{_html.escape(str(prev))}</p>"
            f"{detail_html}"
            "</div>"
        )

    def _build_left_nav(self, flat_md: str, secs: dict, citations_payload: dict):
        import os

        # Tag roots for routing and clear children
        self.root_flat.setData(0, Qt.ItemDataRole.UserRole, {"kind": "flat"})
        self.root_sections.setData(0, Qt.ItemDataRole.UserRole, {"kind": "sections_root"})
        self.root_footnotes.setData(0, Qt.ItemDataRole.UserRole, {"kind": "footnotes_root"})

        self.root_flat.takeChildren()
        self.root_files.takeChildren()
        self.root_sections.takeChildren()
        self.root_footnotes.takeChildren()

        # ---- Files (jump to any PDF) ----
        for p in (self.all_pdfs or []):
            it = QTreeWidgetItem([os.path.basename(p)])
            it.setToolTip(0, p)
            it.setData(0, Qt.ItemDataRole.UserRole, {"kind": "file", "path": p})
            self.root_files.addChild(it)

        # ---- Flat Text: no children (clicking the header switches to page 0) ----
        # nothing to add

        # ---- Sections (each item switches Window 2 / page 1) ----
        if isinstance(secs, dict):
            for title, body in secs.items():
                it = QTreeWidgetItem([title])
                it.setToolTip(0, f"{len((body or '').split())} words")
                it.setData(0, Qt.ItemDataRole.UserRole, {"kind": "section", "title": title, "body": body or ""})
                self.root_sections.addChild(it)

        # ---- Footnotes (each item shows a single footnote in page 2) ----
        # Flatten results from any available parser
        results = []
        if isinstance(citations_payload, dict):
            for key in ("footnotes", "author_year", "numeric", "tex"):
                sub = citations_payload.get(key) or {}
                rs = sub.get("results") or []
                results.extend(rs)

        if results:
            for r in results:
                label = f"Footnote {r.get('index') or r.get('n') or r.get('id') or '?'}"
                it = QTreeWidgetItem([label])
                it.setData(0, Qt.ItemDataRole.UserRole, {"kind": "footnote", "result": r})
                self.root_footnotes.addChild(it)
        else:
            none_it = QTreeWidgetItem(["(none)"])
            flags = none_it.flags()
            flags &= ~Qt.ItemFlag.ItemIsSelectable  # <- PyQt6 enum
            none_it.setFlags(flags)

        # Default selection = Flat Text
        self.left_nav.setCurrentItem(self.root_flat)
        self.content_stack.setCurrentIndex(0)

    def _append_raw_log(self, line: str):
        # Append streaming logs to the pane (kept simple + monospace)
        self.log_view.append(f'<p style="color:#A0A0A0;font-family:Consolas,monospace;margin:0;">{html.escape(line)}</p>')

    def _update_title_label(self) -> None:
        if not self.pdfs:
            self.file_title_label.setText("No PDF files loaded."); return
        full_path = self.pdfs[self.idx]
        self.file_title_label.setText(
            f"<div style='text-align:center;'>"
            f"<p style='font-size:11px;color:#888;margin:0;'>File {self.idx+1} of {len(self.pdfs)}</p>"
            f"<p style='font-size:14px;color:#a9b7c6;font-weight:bold;margin-top:5px;'>{html.escape(full_path)}</p>"
            f"</div>"
        )

    def show_prev(self):
        if not self.view_indices:
            return
        self.view_pos = (self.view_pos - 1) % len(self.view_indices)
        self._goto_view_pos(self.view_pos)

    def show_next(self):
        if not self.view_indices:
            return
        self.view_pos = (self.view_pos + 1) % len(self.view_indices)
        self._goto_view_pos(self.view_pos)

    def _goto_view_pos(self, pos: int) -> None:
        if not self.view_indices:
            return
        self.view_pos = max(0, min(pos, len(self.view_indices) - 1))
        self.idx = self.view_indices[self.view_pos]  # absolute index in all_pdfs
        self._refresh_left_nav()
        self.start_processing()

    def _refresh_left_nav(self) -> None:
        """
        Rebuild left tree with ONLY files in current view slice, preserve selection.
        """
        try:
            root = self.root_flat
        except Exception:
            return
        root.takeChildren()
        for gi in self.view_indices:
            p = self.all_pdfs[gi]
            leaf = QTreeWidgetItem([os.path.basename(p)])
            leaf.setData(0, Qt.ItemDataRole.UserRole, p)
            root.addChild(leaf)
        self.left_nav.expandItem(root)
        # set selected item to current path
        cur = self.all_pdfs[self.idx]
        it = self._find_item_by_path(cur)
        if it:
            self.left_nav.setCurrentItem(it)

    def _find_item_by_path(self, path: str):
        root = self.root_flat
        for i in range(root.childCount()):
            it = root.child(i)
            if it.data(0, Qt.ItemDataRole.UserRole) == path:
                return it
        return None

    def _rebuild_view(self) -> None:
        """
        Recompute view_indices from all_pdfs under active predicates.
        """
        self.view_indices = []
        for i, p in enumerate(self.all_pdfs):
            if self._matches_filter(p):
                self.view_indices.append(i)
        # clamp view_pos
        if self.view_indices:
            self.view_pos = max(0, min(self.view_pos, len(self.view_indices) - 1))
        else:
            self.view_pos = 0
        self._refresh_left_nav()

    def perform_search(self):
        term = self.search_input.text().strip()
        ed = self.view_full_text
        ed.setExtraSelections([])
        if not term:
            return
        fmt = QTextCharFormat(); fmt.setBackground(QColor("yellow")); fmt.setForeground(QColor("black"))
        sels = []
        cur = QTextCursor(ed.document())
        while True:
            cur = ed.document().find(term, cur)
            if cur.isNull(): break
            sel = QTextEdit.ExtraSelection(); sel.format = fmt; sel.cursor = cur; sels.append(sel)
        ed.setExtraSelections(sels)
        self._append_raw_log(f"Highlighted {len(sels)} instance(s) of '{term}' in Full Text.")

    # ── Worker lifecycle ───────────────────────────────────────────────────
    def start_processing(self) -> None:
        if getattr(self, "worker", None) and self.worker.isRunning():
            self.worker.quit(); self.worker.wait()

        self.search_input.clear()
        self._update_title_label()
        self.prev_btn.setEnabled(self.idx > 0)
        self.next_btn.setEnabled(self.idx < len(self.pdfs) - 1)

        # reset views
        self.view_full_text.setPlainText("Processing…")
        self.view_flat_text.clear()
        self.view_section.clear()
        self.view_footnotes.clear()
        self.log_view.clear()
        self.stats_view.clear()

        # clear section children
        self.root_sections.takeChildren()
        self.section_map.clear()

        # set default right page to Flat Text
        self.left_nav.setCurrentItem(self.root_flat)
        self.content_stack.setCurrentIndex(0)

        # start worker
        self.worker = PdfWorker(self.pdfs[self.idx], self)
        self.worker.log_signal.connect(self._append_raw_log)
        self.worker.result_signal.connect(self.display_result)
        self.worker.error_signal.connect(self.handle_error)
        self.worker.start()

    def display_result(self, path: str, data: dict):
        if path != self.pdfs[self.idx]:
            return

        # ---------- helpers ----------
        def _safe_tokens(txt: str) -> int:
            try:
                return _calculate_tokens(txt)
            except Exception:
                return len((txt or "").split())

        def _kv_table(d: dict, title: str = None) -> str:
            if not isinstance(d, dict):
                return ""
            rows = []
            for k, v in d.items():
                label = html.escape(str(k).replace("_", " ").title())
                if isinstance(v, dict):
                    rows.append(
                        f"<tr><td colspan='2' style='padding:6px 8px; font-weight:700; opacity:.8;'>{label}</td></tr>"
                    )
                    for kk, vv in v.items():
                        rows.append(
                            f"<tr><td style='padding:4px 8px; opacity:.75;'>{html.escape(str(kk).replace('_', ' '))}</td>"
                            f"<td style='padding:4px 8px;'>{html.escape(str(vv))}</td></tr>"
                        )
                else:
                    rows.append(
                        f"<tr><td style='padding:4px 8px; opacity:.75;'>{label}</td>"
                        f"<td style='padding:4px 8px;'>{html.escape(str(v))}</td></tr>"
                    )
            caption = f"<div style='font-weight:700;margin-bottom:6px'>{html.escape(title)}</div>" if title else ""
            return (
                f"<div style='margin-top:10px'>"
                f"{caption}"
                f"<table style='width:100%;border-collapse:collapse;font-size:13px'>{''.join(rows)}</table>"
                f"</div>"
            )

        def _totals_card(title: str, totals: dict) -> tuple[str, float]:
            ordered_keys = [
                "intext_total", "success_occurrences", "success_unique", "bib_unique_total",
                "occurrence_match_rate", "bib_coverage_rate", "success_percentage",
            ]
            t_rows = "".join(
                f"<tr>"
                f"<td style='padding:4px 8px;opacity:.75'><b>{html.escape(k.replace('_', ' ').title())}</b></td>"
                f"<td style='padding:4px 8px'>{html.escape(str(totals.get(k, '—')))}</td>"
                f"</tr>"
                for k in ordered_keys
            )
            try:
                pct = float(totals.get("success_percentage") or 0.0)
            except Exception:
                pct = 0.0
            status_lbl = "PASS" if pct >= 90.0 else "FAIL"
            status_color = "#22c55e" if pct >= 90.0 else "#ef4444"
            card = (
                f"<div style='flex:1;min-width:260px;margin:0 8px 12px 0;padding:12px;border:1px solid #374151;"
                f"border-radius:10px;background:#0b1220'>"
                f"<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:10px'>"
                f"<div style='font-size:16px;font-weight:700;opacity:.9'>{html.escape(title)}</div>"
                f"<div style='font-size:18px;font-weight:800;color:{status_color}'>{status_lbl}</div>"
                f"</div>"
                f"<table style='width:100%;border-collapse:collapse;font-size:14px'>{t_rows}</table>"
                f"</div>"
            )
            return card, pct

        # ---------- PRECOMPUTE: citations & best stats pct ----------
        citations = data.get("citations") or {}
        citation_summary = data.get("citation_summary") or {}
        pdf_metadata = data.get("metadata") or {}
        validation = data.get("validation") or {}
        # legacy shape: a flat dict with 'total'
        legacy_totals = citations.get("total") if isinstance(citations, dict) else None

        # multi-parser shape: citations has subdicts 'footnotes' / 'author_year' / 'numeric' / 'tex'
        parser_keys = [("footnotes", "Footnotes"), ("author_year", "Author–Year"), ("numeric", "Numeric"), ("tex", "TeX")]
        per_parser_totals: dict[str, dict] = {}
        for key, _label in parser_keys:
            block = citations.get(key) if isinstance(citations, dict) else None
            if isinstance(block, dict):
                if key == "footnotes":
                    per_parser_totals[key] = (block.get("stats") or block.get("total") or {})
                else:
                    per_parser_totals[key] = (block.get("total") or {})
            else:
                per_parser_totals[key] = {}

        # compute best success pct across any available totals
        pcts = []
        if isinstance(legacy_totals, dict):
            try:
                pcts.append(float(legacy_totals.get("success_percentage") or 0.0))
            except Exception:
                pcts.append(0.0)
        for key in ("footnotes", "author_year", "numeric", "tex"):
            try:
                pcts.append(float(per_parser_totals.get(key, {}).get("success_percentage") or 0.0))
            except Exception:
                pcts.append(0.0)
        if not pcts and isinstance(citation_summary, dict):
            try:
                pcts.append(float((citation_summary.get("dominant") or {}).get("success_percentage") or 0.0))
            except Exception:
                pass
        best_stats_pct = max(pcts or [0.0])

        # ---------- 1) Build LOG pane (pretty) ----------
        proc = data.get("process_log") or {}

        # PASS if sections > 3; else FAIL
        sec_count = 0
        if isinstance(proc, dict):
            sec_count = int(proc.get("section_count") or 0)
        elif isinstance(proc, str):
            m = re.search(r'section_count\D+(\d+)', proc, flags=re.I)
            sec_count = int(m.group(1)) if m else 0

        log_pass = (sec_count > 3)
        stats_pass = (best_stats_pct >= 90.0)

        # ensure file_flags exists
        # ensure file_flags/meta exist
        if not hasattr(self, "file_flags"):
            self.file_flags = {}
        if not hasattr(self, "file_meta"):
            self.file_meta = {}

        self.file_flags[path] = {"log_pass": log_pass, "stats_pass": stats_pass}

        # stash per-file meta for filtering/grouping
        scheme_val = None
        if isinstance(proc, dict):
            scheme_val = proc.get("scheme")
        self.file_meta[path] = {
            "scheme": scheme_val or "unknown",
            "best_success_pct": best_stats_pct,
        }

        # keep scheme filter options in sync
        def _update_scheme_options():
            if not hasattr(self, "scheme_combo"):
                return
            seen = {"All schemes"}
            for meta in getattr(self, "file_meta", {}).values():
                s = str(meta.get("scheme") or "unknown").strip()
                if s:
                    seen.add(s)
            # update without resetting current selection where possible
            current = self.scheme_combo.currentText() if self.scheme_combo.count() else "All schemes"
            self.scheme_combo.blockSignals(True)
            self.scheme_combo.clear()
            self.scheme_combo.addItems(sorted(seen, key=lambda x: (x != "All schemes", x.lower())))
            # restore selection if still present
            idx = self.scheme_combo.findText(current)
            if idx >= 0:
                self.scheme_combo.setCurrentIndex(idx)
            self.scheme_combo.blockSignals(False)

        _update_scheme_options()

        pass_fail = "PASS" if log_pass else "FAIL"
        pass_color = "#22c55e" if log_pass else "#ef4444"

        # PASS/FAIL header with clear spacing after (forces visible "newline")
        log_html_parts = [
            f"<div style='font-size:28px;font-weight:800;color:{pass_color};margin:0 0 12px 0'>{pass_fail}</div>"
        ]

        # Top-level quick fields if present
        top_keys = ("scheme", "toc_count", "section_count")
        top_dict = {k: proc.get(k) for k in top_keys if isinstance(proc, dict) and k in proc}
        if top_dict:
            log_html_parts.append(_kv_table(top_dict, "Detector Summary"))

        # Nested diagnostics if present
        for key in ("numeric_check", "roman_check", "markdown_numeric_hint"):
            if isinstance(proc, dict) and isinstance(proc.get(key), dict):
                log_html_parts.append(_kv_table(proc[key], key.replace("_", " ").title()))

        # Raw logs captured
        if isinstance(data.get("raw_log"), str) and data["raw_log"].strip():
            log_html_parts.append(
                "<div style='margin-top:12px;font-weight:700'>Runtime Log</div>"
                f"<pre style='white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;"
                f"font-size:12px;line-height:1.45;background:#111827;border:1px solid #374151;border-radius:8px;"
                f"padding:10px;margin-top:6px'>{html.escape(data['raw_log'])}</pre>"
            )

        if isinstance(data.get("pipe_log"), str) and data["pipe_log"].strip():
            log_html_parts.append(
                "<div style='margin-top:12px;font-weight:700'>Worker Output</div>"
                f"<pre style='white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;"
                f"font-size:12px;line-height:1.45;background:#111827;border:1px solid #374151;border-radius:8px;"
                f"padding:10px;margin-top:6px'>{html.escape(data['pipe_log'])}</pre>"
            )

        self.log_view.setHtml("".join(log_html_parts))

        def _clean_flat_text(s: str) -> str:
            import re
            # drop obvious path lines like "PDF: /.../file.pdf" or "Source: C:\...\paper.pdf"
            s = re.sub(r'(?im)^\s*(?:pdf|file|source|path)\s*:\s*\S+\.pdf\s*$', '', s)
            # remove loose subsection headers that slipped in (Markdown #… at start of line)
            s = re.sub(r'(?m)^\s*#{1,6}\s+.*$', '', s)
            # collapse extra blank lines
            s = re.sub(r'\n{3,}', '\n\n', s)
            return s.strip()
        # ---------- 2) Center panes: Full / Flat / Sections / Footnotes ----------
        full_md = (data.get("full_text") or "") or ""
        flat_md = data.get("flat_text") or ""
        flat_md = _clean_flat_text(flat_md)

        # Markdown → HTML
        self.view_full_text.setHtml(self._md_to_html(full_md))
        self.view_flat_text.setHtml(self._md_to_html(flat_md))

        # Sections tree population; show first section in the right page
        secs = data.get("sections") or data.get("secs") or {}
        self.root_sections.takeChildren()
        self.section_map.clear()

        if isinstance(secs, dict) and secs:
            for title, body in secs.items():
                words = len(re.findall(r"\w+", body or "")) if body else 0
                node = QTreeWidgetItem(self.root_sections, [title])
                node.setToolTip(0, f"{words} words")
                node.setData(0, Qt.ItemDataRole.UserRole, body or "")
            self.left_nav.expandItem(self.root_sections)
            first_title, first_body = next(iter(secs.items()))
            self.view_section.setHtml(self._md_to_html(first_body or ""))
        else:
            self.view_section.setHtml(self._md_to_html(""))

        # Footnotes (pick parser by style, else best)
        style_choice = (citations.get("style") or "").strip().lower() if isinstance(citations, dict) else ""
        dominant_bucket = ""
        if isinstance(citation_summary, dict):
            dominant_bucket = str(citation_summary.get("dominant_bucket") or "").strip().lower()
        valid_choices = {k for k, _ in parser_keys}
        chosen = dominant_bucket if dominant_bucket in valid_choices else None
        if not chosen:
            style_bucket = _style_to_bucket_for_pdf(style_choice)
            chosen = style_bucket if style_bucket in valid_choices else None
        if not chosen:
            chosen = style_choice if style_choice in valid_choices else None
        if not chosen:
            # choose parser with most success_occurrences
            best_key = None
            best_occ = -1
            for k, _label in parser_keys:
                t = per_parser_totals.get(k, {})
                occ = int((t.get("success_occurrences") or 0) or 0)
                if occ > best_occ:
                    best_occ, best_key = occ, k
            chosen = best_key or "author_year"
        if chosen in ("__all__", None):
            # Show *all* available parsers
            payload = citations if isinstance(citations, dict) else {}
        else:
            # Show only the selected parser
            sub = (citations.get(chosen, {}) if isinstance(citations, dict) else {}) or {}
            payload = {chosen: sub} if sub else {}

        # Legacy fallback: old caches that only have top-level "results"/"total"
        if not payload and isinstance(citations, dict) and citations.get("results"):
            payload = {"footnotes": {"results": citations["results"], "total": citations.get("total", {})}}

        self.view_footnotes.setHtml(self._render_footnotes_html(payload))
        self._build_left_nav(flat_md, secs, payload)

        # ---------- 3) Right STATS pane ----------
        # Overall header (best-of parsers)
        overall_lbl = "PASS" if best_stats_pct >= 90.0 else "FAIL"
        overall_color = "#22c55e" if best_stats_pct >= 90.0 else "#ef4444"
        overall_head = (
            f"<div style='margin:0 0 8px 0;padding:10px 12px;border:1px solid #374151;border-radius:10px;background:#0b1220'>"
            f"<div style='display:flex;align-items:center;justify-content:space-between'>"
            f"<div style='font-size:18px;font-weight:800;opacity:.9'>Citations</div>"
            f"<div style='font-size:20px;font-weight:800;color:{overall_color}'>Overall: {overall_lbl}</div>"
            f"</div>"
            f"</div>"
        )

        # Per-parser cards
        cards_html = []
        for key, label in parser_keys:
            totals = per_parser_totals.get(key, {}) or {}
            card, _pct = _totals_card(label, totals)
            cards_html.append(card)

        # If legacy top-level totals also exist and none of the parser blocks had numbers,
        # keep a single legacy card (helps with mixed old caches).
        if isinstance(legacy_totals, dict) and any(v not in (None, "—") for v in legacy_totals.values()):
            # show it as “Aggregate”
            agg_card, _ = _totals_card("Aggregate", legacy_totals)
            cards_html.insert(0, agg_card)

        cards_row = (
            f"<div style='display:flex;flex-wrap:wrap;align-items:stretch'>{''.join(cards_html)}</div>"
        )

        # Word/Token summary (Full & Flat)
        full_words = len(re.findall(r"\w+", full_md))
        flat_words = len(re.findall(r"\w+", flat_md))
        full_tokens = _safe_tokens(full_md)
        flat_tokens = _safe_tokens(flat_md)

        summary_rows = (
            f"<tr><td style='padding:4px 8px;opacity:.75'><b>Full Text Words</b></td>"
            f"<td style='padding:4px 8px'>{full_words}</td></tr>"
            f"<tr><td style='padding:4px 8px;opacity:.75'><b>Full Text Tokens</b></td>"
            f"<td style='padding:4px 8px'>{full_tokens}</td></tr>"
            f"<tr><td style='padding:4px 8px;opacity:.75'><b>Flat Text Words</b></td>"
            f"<td style='padding:4px 8px'>{flat_words}</td></tr>"
            f"<tr><td style='padding:4px 8px;opacity:.75'><b>Flat Text Tokens</b></td>"
            f"<td style='padding:4px 8px'>{flat_tokens}</td></tr>"
        )
        summary_card = (
            f"<div style='padding:12px;border:1px solid #374151;border-radius:10px;background:#0b1220'>"
            f"<div style='font-size:16px;font-weight:700;margin-bottom:8px'>Text Summary</div>"
            f"<table style='width:100%;border-collapse:collapse;font-size:14px'>{summary_rows}</table>"
            f"</div>"
        )

        extra_cards = []
        if isinstance(citation_summary, dict) and citation_summary:
            extra_cards.append(_kv_table(citation_summary, "Citation Summary"))
        if isinstance(pdf_metadata, dict) and pdf_metadata:
            extra_cards.append(_kv_table(pdf_metadata, "PDF Metadata"))
        if isinstance(validation, dict) and validation:
            extra_cards.append(_kv_table(validation, "Validation"))

        refs_obj = data.get("references")
        if isinstance(refs_obj, list):
            refs_count = len(refs_obj)
        elif isinstance(refs_obj, str):
            refs_count = 1 if refs_obj.strip() else 0
        else:
            refs_count = 0
        refs_card = (
            f"<div style='padding:12px;border:1px solid #374151;border-radius:10px;background:#0b1220;margin-top:10px'>"
            f"<div style='font-size:16px;font-weight:700;margin-bottom:8px'>References</div>"
            f"<div style='font-size:14px;opacity:.9'>Count: <b>{refs_count}</b></div>"
            f"</div>"
        )

        self.stats_view.setHtml(overall_head + cards_row + summary_card + refs_card + "".join(extra_cards))

        # ---------- sensible initial page on the right side ----------
        self.content_stack.setCurrentIndex(0)  # Flat Text page by default

        # ---------- title + nav ----------
        self._update_title_label()
        # show scheme + success badge in the title if known
        meta = getattr(self, "file_meta", {}).get(self.pdfs[self.idx], {})
        scheme_lbl = meta.get("scheme") or "unknown"
        best_pct = meta.get("best_success_pct")
        badge = f"<span style='font-size:11px;color:#8aa; margin-left:8px;'>[{scheme_lbl}]</span>"
        if best_pct is not None:
            badge += f" <span style='font-size:11px;color:#8aa;'>({best_pct:.0f}%)</span>"
        self.file_title_label.setText(
            f"<div style='text-align:center;'>"
            f"<p style='font-size:11px;color:#888;margin:0;'>File {self.idx + 1} of {len(self.pdfs)}</p>"
            f"<p style='font-size:14px;color:#a9b7c6;font-weight:bold;margin-top:5px;'>{html.escape(self.pdfs[self.idx])}{badge}</p>"
            f"</div>"
        )
        self.prev_btn.setEnabled(True)
        self.next_btn.setEnabled(True)

    def _matches_filter(self, path: str) -> bool:
        """
        Path-level predicate:
          • PASS/FAIL selector
          • fixed scheme set
          • success-rate interval
        """
        mode = self.filter_combo.currentIndex() if hasattr(self, "filter_combo") else 0
        flags = self.file_flags.get(path)
        meta = self.file_meta.get(path, {})

        # 1) PASS/FAIL
        if mode != 0:
            if not flags:
                return False
            if mode == 1 and flags.get("log_pass") is not True:
                return False
            if mode == 2 and flags.get("log_pass") is not False:
                return False
            if mode == 3 and flags.get("stats_pass") is not True:
                return False
            if mode == 4 and flags.get("stats_pass") is not False:
                return False

        # 2) Scheme
        sel = self.scheme_combo.currentText().strip() if hasattr(self, "scheme_combo") else "All schemes"
        if sel != "All schemes":
            if not meta or meta.get("scheme") != sel:
                return False

        # 3) Success-rate range
        min_r = int(self.min_rate_spin.value()) if hasattr(self, "min_rate_spin") else 0
        max_r = int(self.max_rate_spin.value()) if hasattr(self, "max_rate_spin") else 100
        best = meta.get("best_success_pct")
        if (min_r > 0 or max_r < 100):
            if best is None:
                return False
            try:
                v = float(best)
            except Exception:
                return False
            if not (min_r <= v <= max_r):
                return False

        return True

    def _first_match_index(self) -> int | None:
        """Index in all_pdfs of first item in current view slice."""
        return self.view_indices[0] if getattr(self, "view_indices", None) else None

    def _apply_filter(self) -> None:
        """
        Rebuild the active view slice, update left-nav list, and move to view_pos.
        This fixes the 'stuck on same document' behaviour.
        """
        if not getattr(self, "all_pdfs", None):
            return
        self._rebuild_view()
        if not self.view_indices:
            QMessageBox.information(self, "No matches", "No files match the current filters.")
            # soft reset success window only
            if hasattr(self, "min_rate_spin") and hasattr(self, "max_rate_spin"):
                self.min_rate_spin.blockSignals(True)
                self.max_rate_spin.blockSignals(True)
                self.min_rate_spin.setValue(0)
                self.max_rate_spin.setValue(100)
                self.min_rate_spin.blockSignals(False)
                self.max_rate_spin.blockSignals(False)
            self._rebuild_view()
            if not self.view_indices:
                return
        # keep current if still in view; otherwise jump to first
        cur_path = self.all_pdfs[self.idx] if hasattr(self, "idx") and 0 <= self.idx < len(self.all_pdfs) else None
        if cur_path and any(self.all_pdfs[i] == cur_path for i in self.view_indices):
            self.view_pos = next(i for i, gi in enumerate(self.view_indices) if self.all_pdfs[gi] == cur_path)
        else:
            self.view_pos = 0
        self._goto_view_pos(self.view_pos)

    def handle_error(self, path: str, message: str):
        QMessageBox.critical(self, "Processing error", f"{path}\n\n{message}")

    # ── RENDER HELPERS ─────────────────────────────────────────────────────
    def _render_totals_card(self, totals: dict) -> str:
        if not totals:
            return "<div style='opacity:.7'>No citation totals.</div>"
        ordered_keys = [
            "intext_total", "success_occurrences", "success_unique", "bib_unique_total",
            "occurrence_match_rate", "bib_coverage_rate", "success_percentage", "style",
        ]
        rows = "".join(
            f"<tr><td style='padding:4px 8px;'><b>{html.escape(k.replace('_',' '))}</b></td>"
            f"<td style='padding:4px 8px;'>{html.escape(str(totals.get(k, '—')))}</td></tr>"
            for k in ordered_keys
        )
        success_pct = float(totals.get("success_percentage", 0.0) or 0.0)
        status = "PASS" if success_pct >= 95.0 else "FAIL"
        color = "#22c55e" if status == "PASS" else "#ef4444"
        return (
            f"<div style='margin-top:12px;padding:12px;border:1px solid #333;border-radius:10px;'>"
            f"<div style='font-size:22px;font-weight:800;color:{color};margin-bottom:8px;'>{status}</div>"
            f"<table style='width:100%;border-collapse:collapse;font-size:14px;'>{rows}</table>"
            f"</div>"
        )

    def _render_data_processing_log(self, data: dict) -> str:
        """
        Pretty “Processing” card:
        - Expand dicts like scheme/numeric_check/roman_check/…
        - PASS if sections > 3 (from sections/secs or toc_count/section_count)
        """
        # derive sections_count from multiple possible places
        secs = (data or {}).get("sections") or (data or {}).get("secs")
        if isinstance(secs, dict):
            sec_count = len(secs)
        else:
            sec_count = None
        # fallback: try summary hints
        if sec_count is None:
            meta = (data or {}).get("process_log") or data or {}
            # look for numeric/roman/toc counts in either 'process_log' or top-level
            sec_count = (
                meta.get("toc_count")
                or meta.get("section_count")
                or 0
            )

        status = "PASS" if (sec_count or 0) > 3 else "FAIL"
        color  = "#22c55e" if status == "PASS" else "#ef4444"

        # We accept logs in different shapes: `process_log` dict, plain strings, lists…
        proc = (data or {}).get("process_log", data or {})  # be liberal

        def block_for_dict(d: dict) -> str:
            # Flatten top-level keys, and show nested objects (like numeric_check) as sub-tables
            rows = []
            simple = {}
            nested = {}
            for k, v in (d or {}).items():
                if isinstance(v, dict):
                    nested[k] = v
                elif isinstance(v, (list, tuple)):
                    simple[k] = ", ".join(map(str, v[:6])) + ("…" if len(v) > 6 else "")
                else:
                    simple[k] = v
            # simple rows
            for k, v in simple.items():
                rows.append(
                    f"<tr><td style='padding:4px 8px;'><b>{html.escape(str(k))}</b></td>"
                    f"<td style='padding:4px 8px;'>{html.escape(str(v))}</td></tr>"
                )
            # nested sections
            nested_html = ""
            for k, sub in nested.items():
                sub_rows = "".join(
                    f"<tr><td style='padding:2px 6px;'><b>{html.escape(str(sk))}</b></td>"
                    f"<td style='padding:2px 6px;'>{html.escape(str(sv))}</td></tr>"
                    for sk, sv in sub.items()
                )
                nested_html += (
                    f"<div style='margin-top:8px;'>"
                    f"<div style='font-weight:700;margin-bottom:4px'>{html.escape(str(k))}</div>"
                    f"<table style='width:100%;border-collapse:collapse;font-size:12px'>{sub_rows}</table>"
                    f"</div>"
                )
            table_html = f"<table style='width:100%;border-collapse:collapse;font-size:13px'>{''.join(rows)}</table>"
            return table_html + nested_html

        if isinstance(proc, dict):
            body = block_for_dict(proc)
        elif isinstance(proc, (list, tuple)):
            body = "".join(f"<p style='margin:.25em 0;'>{html.escape(str(x))}</p>" for x in proc)
        else:
            body = f"<p>{html.escape(str(proc))}</p>"

        return (
            f"<div style='margin:6px 0 10px 0;padding:12px;border:1px solid #333;border-radius:10px;'>"
            f"<div style='display:flex;align-items:center;gap:12px;margin-bottom:6px;'>"
            f"<span style='font-size:22px;font-weight:800;color:{color}'>{status}</span>"
            f"<span style='opacity:.75'>Sections detected: {int(sec_count or 0)}</span>"
            f"</div>"
            f"{body}"
            f"</div>"
        )

    def _render_summary_log(self, data: dict) -> str:
        summary = (data or {}).get("summary_log")
        if not summary:
            return ""
        if isinstance(summary, dict):
            rows = "".join(
                f"<tr><td style='padding:4px 8px;'><b>{html.escape(str(k))}</b></td>"
                f"<td style='padding:4px 8px;'>{html.escape(str(v))}</td></tr>"
                for k, v in summary.items()
            )
            return (
                f"<div style='margin:6px 0 10px 0;padding:12px;border:1px solid #333;border-radius:10px;'>"
                f"<div style='font-size:16px;font-weight:700;margin-bottom:6px;'>Summary</div>"
                f"<table style='width:100%;border-collapse:collapse;font-size:13px'>{rows}</table>"
                f"</div>"
            )
        return f"<div style='opacity:.8'>{html.escape(str(summary))}</div>"

    def _render_footnotes_html(self, citations_or_results) -> str:
        """
        Render citation successes in the 'Footnotes' pane.

        Supports both old and new shapes:
          • OLD: a list[dict] of footnote matches    -> one section ("Footnotes")
          • NEW: a dict with keys: footnotes/author_year/numeric/tex (each with results/total)
        """
        import html as _html

        def _section_header(label: str, total: dict | None) -> str:
            # Small totals summary if present (non-intrusive)
            stats = ""
            if isinstance(total, dict) and total:
                succ = total.get("success_occurrences", "—")
                itxt = total.get("intext_total", "—")
                rate = total.get("success_percentage", "—")
                stats = (
                    f"<div class='substat'>success: <b>{_html.escape(str(succ))}</b> / "
                    f"in-text: <b>{_html.escape(str(itxt))}</b> "
                    f"(<b>{_html.escape(str(rate))}%</b>)</div>"
                )
            return (
                f"<div class='sect-hd'>"
                f"<span class='pill'>{_html.escape(label)}</span>"
                f"{stats}"
                f"</div>"
            )

        def _result_block(r: dict) -> str:
            idx = r.get("index", "")
            intext = r.get("intext_citation") or r.get("intext") or ""
            prev = r.get("preceding_text") or ""
            # Show a primary “resolution” value if available, else fall back across common fields.
            primary_fields = [
                "footnote", "match", "bib", "resolved", "target", "reference_text",
                "entry", "tex", "candidate", "normalized"
            ]
            detail = next((r.get(k) for k in primary_fields if r.get(k) not in (None, "")), "")
            detail_html = (
                f"<ol class='fn-list'><li>{_html.escape(str(idx))}. {_html.escape(str(detail))}</li></ol>"
                if detail not in (None, "")
                else "<div class='muted'>No linked target</div>"
            )
            return (
                "<div class='foot-wrap'>"
                f"<h2>{_html.escape(str(idx))}</h2>"
                f"<h3>{_html.escape(str(intext))}</h3>"
                f"<p>{_html.escape(str(prev))}</p>"
                f"{detail_html}"
                "</div>"
            )

        # CSS once
        css = """
        <style>
          body { font-family:-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
          .sect-hd { display:flex; align-items:center; gap:10px; margin: 14px 0 6px 0; }
          .pill { display:inline-block; padding:4px 8px; border:1px solid #333; border-radius:999px;
                  font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.02em; }
          .substat { color:#9aa4b2; font-size:12px; }
          .foot-wrap { margin: 10px 0 16px 0; padding: 12px; border: 1px solid #333; border-radius: 10px; }
          .foot-wrap h2 { margin: 0 0 6px 0; font-size: 18px; font-weight: 800; }
          .foot-wrap h3 { margin: 0 0 10px 0; font-size: 14px; color: #7c8799; font-weight: 600; }
          .foot-wrap p  { text-align: justify; line-height: 1.55; margin: 0 0 6px 0; }
          .fn-list { margin:0 0 0 20px; padding-left: 18px; }
          .muted { color:#8892a6; font-size:12px; margin-top: 8px; }
        </style>
        """

        # OLD SHAPE: list[dict]
        if isinstance(citations_or_results, list):
            blocks = [_result_block(r) for r in citations_or_results]
            if not blocks:
                return css + "<div class='muted'>No footnotes detected.</div>"
            return css + _section_header("Footnotes", None) + "".join(blocks)

        # NEW SHAPE: dict with per-parser sections
        cits = citations_or_results or {}
        sections_spec = [
            ("footnotes", "Footnotes"),
            ("author_year", "Author–Year"),
            ("numeric", "Numeric"),
            ("tex", "TeX"),
        ]

        parts: list[str] = [css]
        any_rendered = False
        for key, label in sections_spec:
            sub = cits.get(key) or {}
            # Support older structure where results lived at top-level
            results = sub.get("results")
            if results is None and key == "footnotes":
                results = cits.get("results")  # graceful fallback for legacy caches
            if not results:
                continue

            totals = sub.get("total") or {}
            if key == "footnotes":
                totals = sub.get("stats") or totals
            parts.append(_section_header(label, totals or {}))
            parts.extend(_result_block(r) for r in results)
            any_rendered = True

        if not any_rendered:
            return css + "<div class='muted'>No citation successes detected.</div>"

        return "".join(parts)

    def start_meta_scan(self):
        """Kick off a background pass to prefill flags/meta for filters."""
        if not getattr(self, "all_pdfs", None):
            self.all_pdfs = list(self.pdfs)
        if not self.all_pdfs:
            return

        # Avoid multiple concurrent scans
        if getattr(self, "_meta_worker", None) and self._meta_worker.isRunning():
            return

        self._meta_worker = MetaScanWorker(self.all_pdfs, self)
        self._meta_worker.progress.connect(self._on_meta_progress)
        self._meta_worker.item.connect(self._on_meta_item)
        self._meta_worker.finished.connect(self._on_meta_finished)
        self._meta_worker.start()

    def _on_meta_progress(self, msg: str, done: int, total: int):
        self._append_raw_log(f"{msg} {done}/{total}")

    def _on_meta_item(self, path: str, data: dict):
        """
        Update self.file_flags / self.file_meta so filters & scheme selector work
        before the user opens each file.
        Mirrors the logic inside display_result (but light-weight).
        """
        # --- compute best success pct across available totals ---
        citations = data.get("citations") or {}
        citation_summary = data.get("citation_summary") or {}
        pcts = []

        # legacy totals
        tot_legacy = citations.get("total") if isinstance(citations, dict) else None
        if isinstance(tot_legacy, dict):
            try:
                pcts.append(float(tot_legacy.get("success_percentage") or 0.0))
            except Exception:
                pass

        # per-parser totals
        for key in ("footnotes", "author_year", "numeric", "tex"):
            try:
                block = citations.get(key) if isinstance(citations, dict) else None
                if isinstance(block, dict):
                    if key == "footnotes":
                        tot = (block.get("stats") or block.get("total") or {})
                    else:
                        tot = (block.get("total") or {})
                else:
                    tot = {}
                pcts.append(float(tot.get("success_percentage") or 0.0))
            except Exception:
                pass

        if not pcts and isinstance(citation_summary, dict):
            try:
                pcts.append(float((citation_summary.get("dominant") or {}).get("success_percentage") or 0.0))
            except Exception:
                pass

        best_stats_pct = max(pcts or [0.0])

        # --- section count / scheme from process_log ---
        proc = data.get("process_log") or {}
        sec_count = 0
        if isinstance(proc, dict):
            sec_count = int(proc.get("section_count") or 0)
        elif isinstance(proc, str):
            m = re.search(r'section_count\D+(\d+)', proc, flags=re.I)
            sec_count = int(m.group(1)) if m else 0

        log_pass = (sec_count > 3)
        stats_pass = (best_stats_pct >= 90.0)

        if not hasattr(self, "file_flags"):
            self.file_flags = {}
        if not hasattr(self, "file_meta"):
            self.file_meta = {}

        # normalize scheme like in display_result
        scheme_val = None
        if isinstance(proc, dict):
            scheme_val = proc.get("scheme")
        scheme = (scheme_val or "unknown") or "unknown"

        self.file_flags[path] = {"log_pass": log_pass, "stats_pass": stats_pass}
        self.file_meta[path]  = {"scheme": scheme, "best_success_pct": best_stats_pct}

    def _on_meta_finished(self):
        self._append_raw_log("Meta scan complete.")
        # Rebuild the view once everything is known (optional)
        if hasattr(self, "_apply_filter"):
            self._apply_filter()

def main():
    app = QApplication(sys.argv)
    app.setStyleSheet(DARK_QSS)  # keep your existing stylesheet var
    pdfs = get_pdf_list()               # keep the working helper you already have
    win = MainWindow(pdfs)              # ONE window that contains both panes
    win.resize(1400, 900)
    win.show()
    sys.exit(app.exec())



if __name__ == "__main__":
    main()
    # dd = process_pdf(
    #     pdf_path=r"C:\Users\luano\Zotero\storage\5MYV4X6F\Williamson - 2024 - Do Proxies Provide Plausible Deniability Evidence from Experiments on Three Surveys.pdf"
    #     ,
    #     # cache=False
    # )
    # #
    # print(dd["sections"])
    # toc, raw_secs, processing_log = parse_markdown_to_final_sections(dd["full_text"])
    #
    # print(raw_secs.keys())
