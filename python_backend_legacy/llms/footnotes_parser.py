import re
from typing import Dict, List, Tuple, Any, Optional

import unicodedata
from difflib import SequenceMatcher


# =========================
# 0) OCR normalization (unchanged)
# =========================
def normalize_ocr(md_text: str) -> str:
    # join hyphenated line breaks inside words: "cooper-\n ation" -> "cooperation"
    text = re.sub(r'(?<=\w)-\s*\n\s*(?=\w)', '', md_text)
    # collapse runs of spaces/tabs BUT NOT at line starts (preserve indentation)
    text = re.sub(r'(?<!\n)[ \t]{2,}', ' ', text)
    # tame excessive blank lines
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text


import re


def _norm(s: str) -> str:
    """Case/space/diacritic/quote normalized string for substring checks."""
    if not s:
        return ''
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')  # strip accents
    s = (s.replace('’', "'").replace('‘', "'")
         .replace('–', '-').replace('—', '-'))
    s = re.sub(r'\s+', ' ', s).strip().lower()
    return s


# =========================
# 1) Common helpers
# =========================
def _preceding_context(s: str, pos: int, max_chars: int = 200) -> str:
    """Last sentence fragment or, failing that, previous non-empty line; strip stray cite tokens."""
    start = max(0, pos - max_chars)
    window = s[start:pos]
    m = re.search(r'[\.!?]\s+([^\n]{0,200})$', window)
    frag = (m.group(1) if m else window.split('\n')[-1]).strip()
    # remove any leading leftover ${ }^{k}$ from the snippet
    frag = re.sub(r'^\s*\$(?:\s*\{\s*\})?\s*\^\{\s*\d+\s*\}\s*\$\s*', '', frag)
    frag = re.sub(r'^\s*\^\{\s*\d+\s*\}\s*', '', frag)
    return frag


def _inside_any(pos: int, spans: List[Tuple[int, int]]) -> bool:
    return any(a <= pos < b for (a, b) in spans)


def first_footnote_block_span(txt):
    """Return (start,end) char offsets of the very first [^0]: … block
       or (0,0) if none is present."""
    m = re.search(r'^\[\^\d+\]:', txt, re.MULTILINE)
    if not m:
        return (0, 0)
    # advance to the end of that block (empty line or EOF)
    end = re.search(r'\n\s*\n', txt[m.end():])
    end_pos = m.end() + (end.start() if end else len(txt))
    return (m.start(), end_pos)


# Accept: ${ }^{108}$, ${}^{108}$, $^{108}$, and bare ^{108}
INTEXT_TEX_RE = re.compile(
    r"""
    (?:
        \$\s*\{\s*\}\s*\^\s*\{(?P<idx1>\d{1,4})\}\s*\$      # ${ }^{n}$
      | \$\s*\^\s*\{(?P<idx2>\d{1,4})\}\s*\$                # $^{n}$
      | \^\s*\{(?P<idx3>\d{1,4})\}                          # ^{n}
    )
    """,
    re.VERBOSE
)
ENTRY_NUM_FLEX = re.compile(r"""
    ^\s*                                   # any leading indentation
    (?:[-*•]\s*)?                          # optional list bullet
    (?:\$\{\s*\}\^\{\d+\}\$\s*)?           # OPTIONAL TeX superscript that crept in
    (?P<num>\d{1,4})                       # the footnote number we need
    \s*(?:[.)]|[–—-])?\s+                  # ., ), -, —, etc., then at least one space
    (?P<text>.*\S.*)                       # the footnote body (greedy to EOL, non-blank)
    $                                      # end of line
""", re.VERBOSE | re.MULTILINE)

ENTRY_NUM_PLAIN = re.compile(r"""
    ^\s*                                   # any leading indentation
    (?:[-*•]\s*)?                          # optional list bullet
    (?:\$\{\s*\}\^\{\d+\}\$\s*)?           # OPTIONAL TeX superscript that crept in
    (?P<num>\d{1,4})                       # the footnote number we need
    \s*(?:[.)]|[–—-])?\s+                  # ., ), -, —, etc., then at least one space
    (?P<text>.*\S.*)                       # the footnote body (greedy to EOL, non-blank)
    $                                      # end of line
""", re.VERBOSE | re.MULTILINE)
ENTRY_NUM_TEX = re.compile(r'^\s*\$\s*(?:\{\s*\}\s*)?\^\s*\{(\d{1,4})\}[^$]*\$\s*(.*\S.*?)?\s*$')


def _iter_footnote_blocks(text: str):
    lines = text.splitlines()
    i, n = 0, len(lines)
    while i < n:
        # enter a block only on a [^0]: line
        if lines[i].lstrip().startswith("[^0]:"):
            i += 1
            start = i
            # consume until a line that is clearly outside the footnote list
            while i < n:
                line = lines[i]
                if not line.strip():  # blank is ok if followed by a continuation/entry
                    nxt = lines[i + 1] if i + 1 < n else ""
                    if not (ENTRY_NUM_PLAIN.match(nxt) or ENTRY_NUM_TEX.match(nxt) or nxt.startswith(" ")):
                        break
                else:
                    if not (ENTRY_NUM_PLAIN.match(line) or ENTRY_NUM_TEX.match(line) or line.startswith(" ")):
                        break
                i += 1
            yield "\n".join(lines[start:i])
        i += 1


def extract_footnote_items_tex_default_no_dots(text: str):
    items = {}
    for block in _iter_footnote_blocks(text):
        cur_idx, buf = None, []
        for line in block.splitlines():
            m = ENTRY_NUM_PLAIN.match(line) or ENTRY_NUM_TEX.match(line)
            if m:
                # flush previous
                if cur_idx is not None and buf:
                    items[cur_idx] = " ".join(s.strip() for s in buf).strip()
                cur_idx = m.group(1)
                rest = m.group(2) or ""
                buf = [rest]
            else:
                if cur_idx is not None:
                    buf.append(line)
        if cur_idx is not None and buf:
            items[cur_idx] = " ".join(s.strip() for s in buf).strip()
    return items


# Matches ${ }^{n} ...$ OR $^{n} ...$ (allows extra TeX before the final $)
INTEXT_TEX_IN_MATH = re.compile(
    r'\$\s*(?:\{\s*\}\s*)?\^\s*\{(?P<idx>\d{1,4})\}[^$]*\$'
)

# Matches bare ^{n} outside $...$ (common OCR/LaTeX mishaps in the sample)
INTEXT_TEX_BARE = re.compile(
    r'(?<!\$)\^\s*\{(?P<idx>\d{1,4})\}(?![^$]*\$)'
)


def extract_intext_citations_tex(text: str) -> List[Dict[str, str]]:
    hits: List[Dict[str, str]] = []
    for m in INTEXT_TEX_IN_MATH.finditer(text):
        idx = m.group('idx')
        hits.append({
            "index": idx,
            "intext_citation": m.group(0),
            "preceding_text": text[:m.start()].rsplit('.', 1)[-1].strip(),
        })
    for m in INTEXT_TEX_BARE.finditer(text):
        idx = m.group('idx')
        hits.append({
            "index": idx,
            "intext_citation": m.group(0),
            "preceding_text": text[:m.start()].rsplit('.', 1)[-1].strip(),
        })
    return hits


# =========================
# 2) Case detection
# =========================

PARENS_META_NOISE = re.compile(
    r'\b(received|accepted|revised|submitted|published|online|doi|issn|copyright|final version)\b',
    re.IGNORECASE
)

# Very permissive author token (handles corporate authors too)
AUTHOR_TOKEN = r"(?:[A-Z][A-Za-z'’\-]+|[A-Z]{2,}(?:\s+[A-Z]{2,})*|European Commission|National Security Council|NATO|Anonymous|Anon)"

# (Author … Year[letter]) with optional 'et al.' and pages
INTEXT_RE = re.compile(
    rf'\((?P<auths>{AUTHOR_TOKEN}(?:\s+et al\.)?(?:\s+(?:and|&)\s+{AUTHOR_TOKEN})?)\s*,?\s*(?P<year>\d{{4}}[a-z]?)'
    r'(?:[^)]*?)\)', re.UNICODE)

# ---------------------------
# DEFAULT (TeX-superscript) detection
# ---------------------------
TEX_SUP_INLINE_RE = re.compile(r'\$\s*\{\s*\}\s*\^\{\d+\}\s*')
TEX_SUP_BARE_RE = re.compile(r'\^\{\s*\d+\s*\}')
TEX_SUP_INDEX_RE = re.compile(
    r'\$\s*\{\s*\}\s*\^\{\s*(?P<n1>\d+)\s*\}\s*\$'
    r'|\^\{\s*(?P<n2>\d+)\s*\}'
)
BIB_CHUNK_SPLIT_RE = re.compile(
    r'(?m)(?:^\s*$\n?){2,}|\n\s*-\s+|(?=^[^,\n]+,\s*\(?\d{4}[a-z]?\)?)'
)

# [n], [n-m], [n,m,k], $[n, m]$ etc., but not [^n] and not footnote defs "[n]:"
CITE_NUMERIC_RE = re.compile(
    r'(?<!\^)\['  # opening [, not preceded by ^
    r'('
    r'\s*\d+(?:\s*[–-]\s*\d+)?'  # n or n–m / n-m
    r'(?:\s*[,;]\s*\d+(?:\s*[–-]\s*\d+)?)*'  # ,k or ,k–l …
    r')\s*'
    r'\](?!\s*:)'  # closing ] not followed by :
)

BIB_START_RE = re.compile(r'(?im)^(##+\s*References?\b|References?\s*$|##+\s*Reference\b)')
BIB_ENTRY_NUM_RE = re.compile(r'(?m)^\s*\d+\.\s+')  # "12. ..."
PAREN_YEAR_RE = re.compile(r'\((?=[^)]*\d{4})[^)]*\)')  # any (...) that contains a year
# Months / date-like parentheticals we should NOT count as AY
MONTH_RE = re.compile(
    r'\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
    r'Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b',
    re.IGNORECASE
)
DAY_COMMA_YEAR_RE = re.compile(r'\b\d{1,2}\s*,\s*(19|20)\d{2}\b')  # e.g., "12, 2014"
MONTH_DAY_YEAR_RE = re.compile(
    r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+(19|20)\d{2}\b', re.IGNORECASE)

# Common "legal-ish" noise inside parens we should ignore for AY scoring
LEGAL_PARENS_NOISE_RE = re.compile(
    r'\b(?:Id\.?|supra|infra|http[s]?://|www\.|U\.S\.|I\.C\.J\.|F\.\s?Supp\.|L\.Ed\.|S\.Ct\.)\b'
)

# Parenthetical groups that *might* hold AY cites (still need item-level matching)
# allow arbitrarily‐long parentheticals
AY_GROUP_RE = re.compile(
    r'\((?P<body>[^)]*?(?:19|20)\d{2}[a-z]?.*?)\)'
)

# A single author–year item: "Smith 2012", "Lan and Xin 2010", "NATO 2013", "Anon 2012", "Lewis 2012a"
AY_ITEM_RE = re.compile(r'''
    (?<!\.)                         # avoid "U.S."-style initials
    \b(
        # Typical surnames or multi-part names (allow hyphens/apostrophes)
        (?:[A-Z][A-Za-z’'\-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z’'\-]+)?(?:\s+et\s+al\.)?)
        |
        # All-caps/org tokens like NATO, OECD, UN, Reuters, etc.
        (?:[A-Z]{3,}[A-Za-z]*)
        |
        # Anon variants
        Anon(?:\.|ymous)?
    )
    \s*,?\s*
    (19|20)\d{2}[a-z]?
    (?:\s*,?\s*p\.\s*\d+)?          # optional page pin (p. 44)
    \b
''', re.VERBOSE)


def count_default_unique_indices(md_text: str) -> int:
    """Count unique indices in ${ }^{n}$ or ^{n} occurrences."""
    uniq = set()
    for m in TEX_SUP_INDEX_RE.finditer(md_text):
        n = m.group('n1') or m.group('n2')
        if n:
            uniq.add(n)
    return len(uniq)


def _paren_likely_author_year(body: str) -> bool:
    # only require that there’s a four-digit year inside
    return bool(re.search(r'\b(19|20)\d{2}[a-z]?\b', body))


def score_author_year(md_text: str) -> int:
    # Remove TeX superscripts so they don’t inflate AY
    cleaned = TEX_SUP_INLINE_RE.sub('', md_text)
    cleaned = TEX_SUP_BARE_RE.sub('', cleaned)

    ay_hits = 0
    for g in AY_GROUP_RE.finditer(cleaned):
        body = g.group('body')
        if not _paren_likely_author_year(body):
            continue
        ay_hits += len(list(AY_ITEM_RE.finditer(body)))

    inline_pool = re.sub(r'\([^)]*\)', ' ', cleaned)  # avoid double count
    for m in AY_ITEM_RE.finditer(inline_pool):
        token = m.group(0)
        if MONTH_RE.search(token):
            continue
        ay_hits += 1
    return ay_hits


CITE_GROUP_RE = re.compile(
    r'\$?\[\s*'
    r'(?P<body>\d+(?:\s*[–-]\s*\d+)?'
    r'(?:\s*[,;]\s*\d+(?:\s*[–-]\s*\d+)?)*?)'
    r'\s*\]\$?'
)


def score_numeric(md_text: str) -> int:
    """
    Count *each* numeric citation in groups like:
      [1]      → 1
      [1,2]    → 2
      [4-6]    → 3
      [3,5-7;9]→ 4
    Ignores [^n]:… definitions and inline footnote refs.
    """
    # 1) Strip any TeX superscripts
    cleaned = TEX_SUP_INLINE_RE.sub('', md_text)
    cleaned = TEX_SUP_BARE_RE.sub('', cleaned)

    # 2) Remove footnote‐definition blocks ([^0]: …) and any inline [^n]
    cleaned = re.sub(r'^\[\^\d+\]:.*?(?=^\[\^\d+\]:|\Z)', '', cleaned,
                     flags=re.M | re.S)
    cleaned = re.sub(r'\[\^\d+\]', '', cleaned)

    # 3) Regex for citation groups [n], [n,m], [n–m], [n; m–p], optionally wrapped in $
    cite_re = re.compile(
        r'\$?\['
        r'\s*(?P<body>\d+(?:\s*[–-]\s*\d+)?'
        r'(?:\s*[,;]\s*\d+(?:\s*[–-]\s*\d+)?)*?)'
        r'\s*\]\$?'
    )

    def _expand_token(tok: str) -> List[int]:
        tok = tok.strip()
        if not tok:
            return []
        # range "a-b" or "a–b"
        if re.search(r'[–-]', tok):
            a, b = re.split(r'[–-]', tok, maxsplit=1)
            a, b = int(a), int(b)
            step = 1 if a <= b else -1
            return list(range(a, b + step, step))
        return [int(tok)]

    def _expand_group(body: str) -> List[int]:
        nums = []
        for part in re.split(r'[;,]', body):
            nums.extend(_expand_token(part))
        # dedupe while preserving order
        seen, out = set(), []
        for n in nums:
            if n not in seen:
                seen.add(n)
                out.append(n)
        return out

    # 4) Sum up all expanded indices
    total = 0
    for m in cite_re.finditer(cleaned):
        total += len(_expand_group(m.group('body')))

    return total


def score_hybrid(md_text: str) -> int:
    # for hybrid, count _both_ numeric and author_year hits
    n = score_numeric(md_text)
    a = score_author_year(md_text)
    # you can tweak this formula; here it’s the sum
    return n + a


SUP_CITE_RE = re.compile(r'<sup>\s*(\d+)\s*</sup>')
SUP_UNICODE_SEQ_RE = re.compile(r'(?<!\w)([\u00B9\u00B2\u00B3\u2070\u2074-\u2079]{1,8})(?!\w)')
SUP_DEF_LINE_RE = re.compile(
    r'(?m)^\s*(?:<sup>\s*\d+\s*</sup>|[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]{1,8})\s+\S+'
)


def score_sup(md_text: str) -> int:
    """
    Count superscript-style citations in the markdown.
    Supports both HTML (<sup>n</sup>) and Unicode superscript digits.
    """
    # strip TeX superscripts as before
    cleaned = TEX_SUP_INLINE_RE.sub('', md_text)
    cleaned = TEX_SUP_BARE_RE.sub('', cleaned)
    # remove any [^n]: footnote definitions
    cleaned = re.sub(r'^\[\^\d+\]:.*?(?=^\[\^\d+\]:|\Z)', '',
                     cleaned, flags=re.M | re.S)
    # count all superscript citations
    return len(SUP_CITE_RE.findall(cleaned)) + len(SUP_UNICODE_SEQ_RE.findall(cleaned))


# ---------------------------
# Style detector (with default-first rule)
# ---------------------------
DEFAULT_MIN_UNIQUE = 3
TEX_SUP_INLINE_RE = re.compile(r'\$\s*\{\s*\}\s*\^\{\s*\d+\s*\}\$')
TEX_SUP_BARE_RE = re.compile(r'\$\^\{\s*\d+\s*\}\$')
CITE_NUMERIC_RE = re.compile(r'\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\]')
INTEXT_AY_RE = re.compile(r'\([A-Z][a-zA-Z]+,\s*\d{4}\)')

STYLE_TEX = "tex_superscript"
STYLE_NUMERIC = "numeric"
STYLE_AUTHOR = "author_year"
STYLE_HYBRID = "hybrid"
STYLE_SUP = "superscript"


def score_tex(md_text: str) -> int:
    t = TEX_SUP_INLINE_RE.sub('', md_text)
    t = TEX_SUP_BARE_RE.sub('', t)
    return len(TEX_SUP_INLINE_RE.findall(md_text)) + len(TEX_SUP_BARE_RE.findall(md_text))


def detect_citation_style(md_text: str) -> str:
    tex_count = score_tex(md_text)
    num_count = score_numeric(md_text)
    ay_count = score_author_year(md_text)
    hy_count = score_hybrid(md_text)

    sup_count = score_sup(md_text)
    sup_def_count = len(SUP_DEF_LINE_RE.findall(md_text))
    # print("num_count>", sup_count)
    if (
        (sup_count > 10 or (sup_count >= 5 and sup_count >= max(tex_count, num_count, ay_count)))
        and sup_def_count >= 3
    ):
        return STYLE_SUP
    # hybrid if combined numeric+AY is clearly dominant
    if hy_count > max(tex_count, num_count, ay_count, 20) and num_count >= 5 and ay_count >= 5:
        return STYLE_HYBRID
    # prefer numeric when both numeric and TeX-like signals are present
    if num_count > 10 and num_count >= tex_count:
        return STYLE_NUMERIC
    # TeX superscripts when clearly stronger than numeric
    if tex_count > 10 and tex_count > num_count:
        return STYLE_TEX

    # author–year if AY count is strong
    if ay_count > max(tex_count, num_count, 10):
        return STYLE_AUTHOR

    return "unknown"


# =========================
# 3) TEX-SUPERSCRIPT case (your original “default”)
# =========================
NUM_LIST_ITEM_IN_BLOCK_RE = re.compile(
    r'^[ \t]*(?P<num>\d+)\.[ \t]+(?P<body>.*?)'
    r'(?=^[ \t]*\d+\.[ \t]+|\Z)',
    re.MULTILINE | re.DOTALL
)
FOOTNOTE_BLOCK_RE = re.compile(
    r'^[ \t]{0,3}\[\^[^\]\n]+\]:[ \t]*.*(?:\n(?:[ \t]{4,}.*|[ \t]*$))*',
    re.MULTILINE
)
TEX_FOOTNOTE_ENTRY_RE = re.compile(
    r'^[ \t]*(?:\$\s*\{\s*\}\s*\^\{\s*(?P<num1>\d+)\s*\}\s*\$|\^\{\s*(?P<num2>\d+)\s*\})[ \t]*(?P<body>.*?)'
    r'(?=^[ \t]*(?:\$\s*\{\s*\}\s*\^\{\s*\d+\s*\}\s*\$|\^\{\s*\d+\s*\})|\Z)',
    re.MULTILINE | re.DOTALL
)
NUM_LIST_FOOTNOTE_RE = re.compile(
    r'^\s*(?P<num>\d+)\.\s+(?P<body>.*?)(?=\n\s*\d+\.\s+|\Z)',
    re.MULTILINE | re.DOTALL
)
TEX_SUP_RE = re.compile(r'\$\s*\{\s*\}\s*\^\{(?P<num>\d+)\}')
HEADER_BOUNDARY_RE = re.compile(
    r'(?im)^(####?\s+Abstract\b|##\s+\d+|Received\b|\*Correspondence|Key words?:)'
)
IN_TEXT_CITATION_RE = re.compile(
    r'(?P<full>'
    r'\$(?:\s*\{\s*\})?\s*\^\{\s*(?P<num>\d+)\s*\}\s*\$'  # ${ }^{n}$ or ${}^{n}$
    r'|\^\{\s*(?P<num2>\d+)\s*\}'  # ^{n}
    r')'
)


def _footnote_block_spans(md_text: str) -> List[Tuple[int, int]]:
    return [(m.start(), m.end()) for m in FOOTNOTE_BLOCK_RE.finditer(md_text)]


def _split_inline_tex_run(run: str) -> Dict[str, str]:
    out = {}
    for m in TEX_SUP_RE.finditer(run):
        n = m.group('num')
        body_start = m.end()
        nxt = TEX_SUP_RE.search(run, body_start)
        body_end = nxt.start() if nxt else len(run)
        body = run[body_start:body_end]
        body = re.sub(r'^[\s;,:-]+|[\s;,:-]+$', '', body).strip()
        if n and body:
            out.setdefault(n, re.sub(r'\s+', ' ', body))
    return out


def extract_footnote_items_tex(md_text: str) -> Dict[str, str]:
    raw = md_text
    items = {}

    # [^...] blocks
    for blk in FOOTNOTE_BLOCK_RE.finditer(raw):
        body = blk.group(0)
        for m in TEX_FOOTNOTE_ENTRY_RE.finditer(body):
            n = (m.group('num1') or m.group('num2')).strip()
            ref = " ".join(line.strip() for line in m.group('body').strip().splitlines())
            if n and ref:
                items.setdefault(n, ref)
        for m in NUM_LIST_ITEM_IN_BLOCK_RE.finditer(body):
            n = m.group('num').strip()
            ref = " ".join(line.strip() for line in m.group('body').strip().splitlines())
            if n and ref:
                items.setdefault(n, ref)

    # Inline TeX run in front-matter (author block, etc.)
    hb = HEADER_BOUNDARY_RE.search(raw)
    header_text = raw[:hb.start()] if hb else raw[:2000]  # safety cap
    for m in re.finditer(r'(?m)^[ \t]*\$\s*\{\s*\}\s*\^\{\d+\}', header_text):
        segment = header_text[m.start(): hb.start() if hb else len(header_text)]
        bl = re.search(r'\n\s*\n', segment)
        if bl:
            segment = bl.string[:bl.start()]
        for k, v in _split_inline_tex_run(segment).items():
            items.setdefault(k, v)
        break

    # Fallback: numeric list near EOF with a refs header
    if not items:
        # 1) locate the Notes section header
        hdr = re.search(r'(?im)^##\s*Notes\b', raw)
        if hdr:
            # 2) take everything until the next "##" or end of file
            start = hdr.end()
            end_m = re.search(r'(?m)^##\s+', raw[start:])
            section = raw[start:start + end_m.start()] if end_m else raw[start:]
            # 3) pull out lines like "  1. Some note text"
            for m in re.finditer(r'^\s*(?P<num>\d+)\.\s+(?P<body>.*\S)', section, re.MULTILINE):
                items.setdefault(m.group('num'),
                                 m.group('body').strip())

    return items


# =========================
# 4) NUMERIC case ([n] …)
# =========================
# Ignore TeX superscripts anywhere for numeric flow
def strip_tex_superscripts(text: str) -> str:
    text = TEX_SUP_INLINE_RE.sub('', text)  # ${ }^{n}$
    text = TEX_SUP_BARE_RE.sub('', text)  # ^{n}
    return text


def _strip_inline_math(s: str) -> str:
    return re.sub(r'\$(.*?)\$', r'\1', s)


BIB_ENTRY_RE = re.compile(r'(?m)^\s*(\d+)\.\s+')  # "40. Author …"


def _expand_cite_token(tok: str) -> List[int]:
    tok = tok.strip()
    if not tok:
        return []
    if re.search(r'[–-]', tok):
        a, b = re.split(r'[–-]', tok, maxsplit=1)
        a, b = int(a.strip()), int(b.strip())
        return list(range(a, b + 1)) if a <= b else list(range(a, b - 1, -1))
    return [int(tok)]


def expand_citation_group(group_text: str) -> List[int]:
    nums = []
    for tok in re.split(r'[;,]', group_text):
        nums.extend(_expand_cite_token(tok))
    seen, out = set(), []
    for n in nums:
        if n not in seen:
            seen.add(n);
            out.append(n)
    return out


def find_intext_numeric_citations(md_text: str, bib_start: int) -> List[Tuple[str, List[int], int, int]]:
    """Return list of (raw_match, [nums], start_pos, end_pos) BEFORE the bibliography."""
    search_text = md_text[:bib_start] if bib_start != -1 else md_text
    cites = []
    for m in CITE_NUMERIC_RE.finditer(search_text):
        nums = expand_citation_group(m.group(1))
        if nums:
            cites.append((m.group(0), nums, m.start(), m.end()))
    return cites


# =========================
# 5) AUTHOR–YEAR case
# =========================
# (a) in-text extractor
# capture things like: (Giles 2010), (Republic of South Africa 2010), (UN Information Officer, 2010), (Markoff, 2010; ISO 2008)
AY_GROUP_RE = re.compile(r'\((?P<body>[^)]*\d{4}[a-z]?[^)]*)\)')
AY_ITEM_RE = re.compile(
    r'(?P<author>[A-Z][A-Za-z&.\- /]+?|[A-Z]{2,}[A-Za-z0-9\-]*)'  # author or org/acronym
    r'(?:\s+et al\.)?'  # optional et al.
    r'(?:\s*(?:,|and))?\s*'  # optional comma/and
    r'(?P<year>\d{4}[a-z]?)'  # 2010 or 2010a
)

AY_NOISE_TOKEN_RE = re.compile(
    r'\b(?:issn|isbn|doi|vol(?:ume)?|issue|pp?|no\.?|strategy|retrieved|available|copyright)\b',
    re.IGNORECASE,
)
AY_YEAR_RANGE_RE = re.compile(r'\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b')


def _is_noise_ay_citation(raw: str) -> bool:
    if not raw:
        return True
    s = raw.strip()
    if AY_NOISE_TOKEN_RE.search(s):
        return True
    if AY_YEAR_RANGE_RE.search(s):
        return True
    return False


def _extract_ay_candidates(raw: str) -> List[Tuple[str, str]]:
    s = (raw or "").strip()
    if not s:
        return []
    if s.startswith("(") and s.endswith(")"):
        s = s[1:-1].strip()
    out: List[Tuple[str, str]] = []
    for m in AY_ITEM_RE.finditer(s):
        a = (m.group("author") or "").strip()
        y = (m.group("year") or "").strip().lower()
        if not a or not y:
            continue
        if _is_dateish_author_token(a):
            continue
        out.append((a, y))
    return out


def clean_intext_for_lookup(s: str) -> tuple[str, str] | None:
    """
    Return (author_norm, year) from an in-text citation string like:
    '(2000 cited Weimann 2004, p. 4)' or '(Sanger et al. 2014)'.
    """
    s = s.strip().strip('()')

    # If format is "2000 cited Weimann 2004 ...", pull the rightmost "Author Year"
    m = re.search(r'([A-Z][A-Za-z’\'\- ]+?)\s+(\d{4}[a-z]?)\b', s)
    if not m:
        return None
    author = re.sub(r'\s+et al\.?$', '', m.group(1), flags=re.I)
    author = re.split(r'\s+(?:and|&)\s+', author)[0]
    year = m.group(2).lower()
    na = normalize_author(author)

    return na, year


def build_ay_bib_map(refs_text: str) -> dict[str, str]:
    """
    Build a map "author|year" -> entry using the output of
    parse_bibliography_author_year_from_block, which returns
    {(normalized_author, year): entry}.
    """
    parsed = parse_bibliography_author_year_from_block(refs_text)
    ay = {}
    for (author_norm, year), entry in parsed.items():
        # author_norm is already normalized/lowercased by normalize_author_key
        ay[f"{author_norm}|{year}"] = entry
    return ay


# --------------------------------------------------
# 2. stronger normalisers – drop these over the old
# --------------------------------------------------
def normalize_author(a: str) -> str:
    a = unicodedata.normalize('NFKD', a).encode('ascii', 'ignore').decode()
    a = re.sub(r'[^A-Za-z0-9 &/\-]+', ' ', a)  # keep letters, numbers, &, /, -
    a = re.sub(r'\s+et\s+al\.?$', '', a, flags=re.I)
    a = re.sub(r'\s+(and|&)\s+.*$', '', a, flags=re.I)
    a = re.sub(r'\banon(?:ymous)?\b', 'anon', a, flags=re.I)
    a = re.sub(r'\s+', ' ', a).strip().lower()
    return a


def _norm_key(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', normalize_author(s))


def normalize_author_key(s: str) -> str:
    s = s.strip()
    s = re.sub(r'\bet al\.\b', '', s, flags=re.I)
    s = re.sub(r'[^A-Za-z0-9&/\- ]+', '', s)
    s = re.sub(r'\s+', ' ', s)
    return s.lower()


def find_intext_author_year(md_text: str, bib_start: int) -> List[Tuple[str, List[Tuple[str, str]], int, int]]:
    """Return [(raw_group, [(author, year), ...], start, end], ...] before bibliography."""
    if bib_start != -1:
        search_text = md_text[:bib_start]
    else:
        inferred_start = _infer_reference_tail_start(md_text)
        search_text = md_text[:inferred_start] if inferred_start != -1 else md_text
    out = []
    for m in AY_GROUP_RE.finditer(search_text):
        body = m.group('body')
        # Reject date/meta parentheticals
        if not _paren_likely_author_year(body):
            continue
        if PARENS_META_NOISE.search(body):
            continue

        items = []
        for im in AY_ITEM_RE.finditer(body):
            a = im.group('author').strip()
            y = im.group('year').strip()

            items.append((a, y))

        if items:
            out.append((m.group(0), items, m.start(), m.end()))
    return out


def _find_references_block(refs_list: List[str]) -> str:
    for chunk in refs_list:
        if re.search(r'(?im)^##+\s*References?\b', chunk):
            return chunk
    # fallback: join them all
    return "\n\n".join(refs_list)


_DATEISH_AUTHOR_TOKENS = {
    "jan",
    "january",
    "feb",
    "february",
    "mar",
    "march",
    "apr",
    "april",
    "may",
    "jun",
    "june",
    "jul",
    "july",
    "aug",
    "august",
    "sep",
    "sept",
    "september",
    "oct",
    "october",
    "nov",
    "november",
    "dec",
    "december",
    "spring",
    "summer",
    "fall",
    "autumn",
    "winter",
}


def _is_dateish_author_token(token: str) -> bool:
    t = normalize_author_key(token or "")
    t = t.replace(".", "").replace(",", "").strip().lower()
    return t in _DATEISH_AUTHOR_TOKENS


def parse_intext_authors_year(intext: str) -> Tuple[List[str], str | None]:
    """
    Returns (authors:list[str], year:str|None) for a single citation fragment.
    Rules:
      - If multiple cites are grouped by ';', this returns the first fragment.
      - Commas inside the author list are treated like 'and', except the comma
        immediately before the year, which is ignored by trimming.
      - 'et al.' reduces to the first author.
    """
    if not intext:
        return [], None

    s = intext.strip()
    # unwrap "( ... )"
    if s.startswith('(') and s.endswith(')'):
        s = s[1:-1].strip()

    # if grouped (A; B), take the first fragment here; caller can loop per fragment
    if ';' in s:
        s = s.split(';', 1)[0].strip()

    # find the rightmost year (2010 or 2010a)
    year_m = None
    for m in re.finditer(r'\b(?:19|20)\d{2}[a-z]?\b', s, flags=re.I):
        year_m = m
    if not year_m:
        return [], None
    year = year_m.group(0).lower()

    # author part is everything before the year; strip trailing separators (incl. the comma before year)
    names_part = s[:year_m.start()].rstrip()
    names_part = re.sub(r'[\s,.:;]+$', '', names_part)

    # drop trailing 'et al.' marker but remember we should keep the first author
    etal = bool(re.search(r'\bet\s+al\.?$', names_part, flags=re.I))
    names_part = re.sub(r'\bet\s+al\.?$', '', names_part, flags=re.I).strip()

    # split on 'and' / '&' / commas (commas are author separators here)
    pieces = re.split(r'\s+(?:and|&)\s+|,', names_part)
    cleaned = []
    for p in pieces:
        p = p.strip().rstrip('.')
        if not p:
            continue
        # discard tokens that are just initials like "E." or "M."
        if re.fullmatch(r'[A-Z](?:\.)?', p):
            continue
        cleaned.append(p)

    # if it was "X et al." and we lost everything, salvage first token of names_part
    if not cleaned and etal:
        first = names_part.split()[0] if names_part else ''
        cleaned = [first] if first else []

    # take surname/org token as the last token of each part
    authors = [re.split(r'\s+', p)[-1] for p in cleaned]
    authors = [a for a in authors if not _is_dateish_author_token(a)]
    return authors, year


def parse_bibliography_author_year_from_block(block: str) -> Dict[Tuple[str, str], str]:
    """
    Build a mapping {(normalized_surname_or_org, year) -> full reference line}.
    - Supports multiple 'Authors ... (Year)' occurrences per line.
    - Indexes *each* author surname for that year to improve multi-author matching.
    - Falls back to line-wise scanning: if a year appears on a line, any surname-like
      tokens before that year are indexed to that line as well.
    """
    block = (block or '').strip()
    if not block:
        return {}

    # If there's a "## References" header, keep only what follows it
    m = BIB_START_RE.search(block)
    if m:
        block = block[m.end():].strip()

    refs: Dict[Tuple[str, str], str] = {}

    # Helper: normalize author key (existing util)
    def _k(s: str) -> str:
        return normalize_author_key(s)

    # Helper: extract surnames from an authors blob like "Hutchins, E., Cloppert, M. and Amin, R."
    def _surnames_from_blob(blob: str) -> List[str]:
        b = blob.strip()
        # 1) canonicalize "and" to comma to simplify splitting
        b = re.sub(r'\s+(and|&)\s+', ', ', b, flags=re.I)
        # 2) pull surname tokens that precede a comma  →  "Hutchins,"  "Cloppert,"  "Amin,"
        sn = re.findall(r'\b([A-Z][A-Za-z’\'\-]+)\s*,', b)
        # 3) corporate/one-piece author fallback (DARPA., Symantec., Wikileaks., ODNI.)
        if not sn:
            m = re.match(r'^\s*([A-Z][A-Za-z0-9’\'\-]+)', b)
            if m:
                sn = [m.group(1)]
        return sn

    # Pass 1: robust pairwise matches anywhere in the block
    PAIR = re.compile(r'(?P<auth>[A-Z][^()\n]{0,200}?)\s*\(\s*(?P<year>(?:19|20)\d{2}[a-z]?)\s*\)')
    for mm in PAIR.finditer(block):
        authors_blob = mm.group('auth').strip()
        year = mm.group('year').lower()

        # full line that contains this match (useful to return a complete entry)
        line_start = block.rfind('\n', 0, mm.start()) + 1
        line_end = block.find('\n', mm.end())
        if line_end == -1:
            line_end = len(block)
        entry_text = block[line_start:line_end].strip()

        for sur in _surnames_from_blob(authors_blob):
            key = (_k(sur), year)
            if key not in refs:
                refs[key] = entry_text

    # Pass 2 (safety net): scan each line for *any* year and index surnames that appear before it
    for line in block.splitlines():
        txt = line.strip()
        if not txt:
            continue
        # collect all years on the line
        years = [y.lower() for y in re.findall(r'\b(?:19|20)\d{2}[a-z]?\b', txt)]
        if not years:
            continue
        # take the substring before the *first* year to mine author tokens
        first_year_pos = re.search(r'\b(?:19|20)\d{2}[a-z]?\b', txt).start()
        left = txt[:first_year_pos]
        for sur in _surnames_from_blob(left):
            for y in years:
                key = (_k(sur), y)
                refs.setdefault(key, txt)

    return refs


def find_entry_by_presence(authors, year, refs_text: str):
    """
    Scan the *raw* references text line-by-line and return the first line that
    mentions **every** author surname (normalised) *and* the year.  This is a
    lot more forgiving when the bibliography wasn’t split cleanly into entries.
    """
    if not (authors and year):
        return None

    year_lc = year.lower()
    author_keys = [normalize_author_key(a) for a in authors if a]

    for line in refs_text.split('\n'):
        ln = re.sub(r'\s+', ' ', line).lower()
        if year_lc not in ln:
            continue
        if all(ak in ln for ak in author_keys):
            return line.strip()

    return None


def find_entry_by_presence_relaxed(authors, year, refs_text: str):
    """
    OCR-tolerant fallback matcher:
    - same year required (letter suffix ignored)
    - author can match by exact containment, strong prefix, or high token similarity
    """
    if not (authors and year and refs_text):
        return None

    year_lc = (year or "").lower()
    year_plain = _year_plain(year_lc)
    author_keys = [normalize_author_key(a) for a in authors if a]
    author_keys = [a for a in author_keys if a and not _is_dateish_author_token(a)]
    if not author_keys:
        return None

    best_line = None
    best_score = 0.0
    token_re = re.compile(r"[A-Za-z][A-Za-z’'\-]{2,}")

    for line in refs_text.split("\n"):
        raw = line.strip()
        if not raw:
            continue
        lo = raw.lower()
        if year_lc not in lo and year_plain not in lo:
            continue

        norm_line = normalize_author_key(raw)
        tok_keys = [normalize_author_key(t) for t in token_re.findall(raw)]

        score = 0.0
        matched = 0
        for ak in author_keys:
            if ak in norm_line:
                score += 2.0
                matched += 1
                continue

            best_tok = 0.0
            for tk in tok_keys:
                if len(tk) < 3:
                    continue
                if len(ak) >= 4 and (tk.startswith(ak[:4]) or ak.startswith(tk[:4])):
                    best_tok = max(best_tok, 1.25)
                else:
                    ratio = SequenceMatcher(None, ak, tk).ratio()
                    if ratio >= 0.84:
                        best_tok = max(best_tok, ratio)

            if best_tok >= 1.0:
                score += best_tok
                matched += 1

        if matched == 0:
            continue
        if score > best_score:
            best_score = score
            best_line = raw

    min_score = 1.2 if len(author_keys) == 1 else 1.8
    if best_line and best_score >= min_score:
        return best_line
    return None


def _as_references_text(refs_any) -> str:
    """
    Accepts a references payload in multiple shapes and returns a single text block.
    - None/empty -> ''
    - str -> as-is
    - list/tuple of strings -> joined with blank lines
    - dict with a 'content' or 'text' key -> that value
    """
    if not refs_any:
        return ''
    if isinstance(refs_any, str):
        return refs_any
    if isinstance(refs_any, (list, tuple)):
        return '\n\n'.join(str(x) for x in refs_any if x)
    if isinstance(refs_any, dict):
        for k in ('content', 'text'):
            if k in refs_any and isinstance(refs_any[k], str):
                return refs_any[k]
    return str(refs_any)


def parse_bibliography_author_year(md_text: str) -> Tuple[Dict[Tuple[str, str], str], int]:
    m = BIB_START_RE.search(md_text)
    if m:
        start = m.end()
        nxt = re.search(r'(?m)^\s*##\s+\S', md_text[start:])
        end = start + nxt.start() if nxt else len(md_text)
        block = md_text[start:end].strip()
        return parse_bibliography_author_year_from_block(block), start

    # Fallback: infer a bibliography/endnotes tail if no explicit heading exists.
    s, e = _infer_reference_tail_span(md_text)
    if s < 0 or e <= s:
        return {}, -1
    block = md_text[s:e].strip()
    return parse_bibliography_author_year_from_block(block), s


def _build_author_index(ay_bib_map: Dict[Tuple[str, str], str]) -> Dict[str, List[Tuple[Tuple[str, str], str]]]:
    idx = {}
    for (auth, yr), entry in ay_bib_map.items():
        idx.setdefault(auth, []).append(((auth, yr), entry))
    return idx


def _year_plain(y: str) -> str:
    return re.sub(r'[a-z]$', '', (y or '').lower())


_TAIL_REF_ENUM_RE = re.compile(
    r'^\s*(?:\[\d{1,4}\]|\d{1,4}[.)]|<sup>\s*\d+\s*</sup>|[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]{1,8}[.)]?)\s+\S'
)
_TAIL_REF_AY_RE = re.compile(
    r'^\s*(?:[-*•]\s*)?(?:\d{1,4}[.)]\s+)?[A-Z][^\n]{0,200}\((?:19|20)\d{2}[a-z]?\)'
)
_TAIL_REF_YEAR_RE = re.compile(r'\b(?:19|20)\d{2}[a-z]?\b')
_TAIL_REF_URL_DOI_RE = re.compile(r'https?://|www\.|\b10\.\d{4,9}/', re.I)


def _tail_reference_line_score(line: str) -> int:
    s = line.strip()
    if not s:
        return 0
    score = 0
    if _TAIL_REF_ENUM_RE.match(s):
        score += 2
    if _TAIL_REF_AY_RE.match(s):
        score += 2
    if _TAIL_REF_YEAR_RE.search(s):
        score += 1
    if _TAIL_REF_URL_DOI_RE.search(s):
        score += 1
    return score


def _infer_reference_tail_span(text: str) -> Tuple[int, int]:
    """
    Infer a bibliography/endnotes tail span when explicit headings are missing.
    Returns (-1, -1) if no reliable tail-like run is found.
    """
    if not text:
        return -1, -1
    lines = text.splitlines(keepends=True)
    n = len(lines)
    if n < 20:
        return -1, -1

    offsets = [0]
    for ln in lines:
        offsets.append(offsets[-1] + len(ln))

    start_scan = max(0, int(n * 0.45))
    best: Optional[Tuple[int, int]] = None

    i = start_scan
    while i < n:
        if _tail_reference_line_score(lines[i]) < 2:
            i += 1
            continue

        j = i
        strong = 0
        year_lines = 0
        nonblank = 0
        weak_streak = 0

        while j < n:
            s = lines[j].strip()
            if not s:
                weak_streak += 1
                if weak_streak > 3:
                    break
                j += 1
                continue

            nonblank += 1
            score = _tail_reference_line_score(lines[j])
            if score >= 2:
                strong += 1
                weak_streak = 0
            else:
                weak_streak += 1
                if weak_streak > 2 and nonblank > 8:
                    break

            if _TAIL_REF_YEAR_RE.search(s):
                year_lines += 1
            j += 1

        if nonblank >= 8 and strong >= 6 and year_lines >= 4:
            s_char = offsets[i]
            e_char = offsets[j]
            if best is None or (e_char - s_char) > (best[1] - best[0]):
                best = (s_char, e_char)

        i = max(i + 1, j)

    if best is None:
        return -1, -1

    # Backtrack start to include earlier reference lines that are part of the same tail.
    s_char, e_char = best
    start_line = 0
    end_line = n
    for i in range(n):
        if offsets[i] <= s_char < offsets[i + 1]:
            start_line = i
            break
    for i in range(start_line, n):
        if offsets[i] >= e_char:
            end_line = i
            break

    i = start_line
    weak = 0
    step = 0
    while i > 0 and step < 140:
        prev = lines[i - 1].strip()
        if not prev:
            i -= 1
            step += 1
            continue
        if _tail_reference_line_score(lines[i - 1]) >= 1:
            i -= 1
            weak = 0
            step += 1
            continue
        weak += 1
        if weak > 2:
            break
        i -= 1
        step += 1

    return offsets[i], offsets[end_line]


def _infer_reference_tail_start(text: str) -> int:
    s, _ = _infer_reference_tail_span(text)
    return s


def _infer_reference_tail_block(text: str) -> str:
    s, e = _infer_reference_tail_span(text)
    if s < 0 or e <= s:
        return ""
    return text[s:e].strip()


REFS_HDR_RE = re.compile(r'(?im)^##\s*References?\b')


def pick_references_block(refs):
    """
    refs can be a list[str] or a single str.
    Returns only the text under '## References' (until the next '##' header or end).
    """
    if isinstance(refs, list):
        joined = "\n\n".join(refs)
    else:
        joined = refs

    # Grab only the References section
    m = re.search(r'^(?:# References|## References)\b(.+?)(?=\n#{1,2}\s|\Z)', joined)
    if m:
        return m.group(1).strip()
    # Fallback: if someone stripped headers earlier, just return everything
    return joined.strip()


def intext_key(match: re.Match) -> str | None:
    """
    Given a regex.Match of an (Author Year) citation,
    return the normalized key "author|year", or None if it's a month/false-positive.
    """
    auths = match.group('auths')  # from your INTEXT_RE
    year = match.group('year').lower()
    # pick first author (drop "et al." and any trailing "and X")
    first = re.split(r'\s+(?:and|&)\s+', auths)[0]
    first = re.sub(r'\s+et al\.?$', '', first, flags=re.I)
    if _is_dateish_author_token(first) or MONTH_RE.search(first):
        return None
    na = normalize_author(first)
    if _is_dateish_author_token(na):
        return None
    # filter out months like "(February 2015)"

    return f"{na}|{year}"


CITATION_TEX_RE = re.compile(r'\$\s*\{\s*\}\s*\^\{\s*\d+\s*\}[^$]*\$', re.MULTILINE)
CITATION_NUMERIC_RE = re.compile(
    r'\$?\[\s*\d+(?:\s*[–-]\s*\d+)?(?:\s*[,;]\s*\d+(?:\s*[–-]\s*\d+)?)*\s*\]\$?',
    re.MULTILINE
)
FOOTNOTE_BLOCK_ENTRY_RE = re.compile(r'^\[\^\d+\]:[^\n]*?(?:\n(?!\s*\n).*)*', re.MULTILINE)

# tolerant "outside-the-block" single-line footnote pattern
SECOND_PASS_RE = re.compile(r"""
       ^\s*                                   # indentation
       (?:[-*•]\s*)?                          # optional bullet
       (?:\$\s*\{\s*\}\s*\^\{\d+\}\s*\$\s*)?  # optional pasted TeX superscript
       (?P<idx>\d{1,4})                       # number
       \s*(?:[.)]|[–—-])?\s+                  # delimiter
       (?P<body>.+?)\s*$                      # entry body
    """, re.VERBOSE | re.MULTILINE)


def first_footnote_block_span(txt):
    """
    Returns a (start, end) span that covers the main markdown footnote block(s).
    Uses _footnote_block_spans(txt) if available; otherwise finds the first block.
    """
    try:
        spans = _footnote_block_spans(txt)  # existing util in your module
        if spans:
            # cover from first block start to last block end
            return spans[0][0], spans[-1][1]
        return (0, 0)
    except NameError:
        m = re.search(r'^\[\^\d+\]:', txt, re.MULTILINE)
        if not m:
            return (0, 0)
        tail = txt[m.start():]
        end_m = re.search(r'\n\s*\n', tail)
        end = m.start() + (end_m.start() if end_m else len(tail))
        return (m.start(), end)


def _remove_with_single_newline_guard(text_, pattern):
    guard = re.compile('(?:' + pattern.pattern + r')(?:\n(?!\n))?', pattern.flags)
    return guard.sub('', text_)


def _remove_intext_citations(text_, style_):
    if style_ in ('tex_superscript', 'tex_default', 'default', 'STYLE_DEFAULT_LABEL'):
        return _remove_with_single_newline_guard(text_, CITATION_TEX_RE)
    elif style_ == 'numeric':
        return _remove_with_single_newline_guard(text_, CITATION_NUMERIC_RE)
    else:  # author_year
        return _remove_with_single_newline_guard(text_, INTEXT_RE)  # uses your existing regex


def _remove_footnotes_everywhere(text_):
    # 1) remove canonical [^n]: entries (each entry up to the next blank line)
    t = _remove_with_single_newline_guard(text_, FOOTNOTE_BLOCK_ENTRY_RE)

    # 2) guard the main block span (if any), then remove stray outside lines
    b0, b1 = first_footnote_block_span(t)
    if b1 > b0:
        guarded = t[:b0] + ("\uFFFF" * (b1 - b0)) + t[b1:]
    else:
        guarded = t
    removed_outside = SECOND_PASS_RE.sub(lambda m: '', guarded)

    # 3) unguard and normalize spacing
    removed = removed_outside.replace('\uFFFF', '')
    removed = re.sub(r'[ \t]+$', '', removed, flags=re.MULTILINE)
    removed = re.sub(r'\n{3,}', '\n\n', removed)
    return removed.strip()


import re

# ---------- detectors ----------
HEADING_HASH_RE = re.compile(r'^\s{0,3}#{1,6}\s')  # keep # headings intact

URL_RE = re.compile(r'https?://|www\.', re.I)
EMAIL_RE = re.compile(r'\b\S+@\S+\.\S+\b')
DOI_RE = re.compile(r'\b10\.\d{4,9}/\S+\b', re.I)

# Tables / figure captions
TABLE_ROW_RE = re.compile(r'^\s*\|.*\|\s*$')
TABLE_SEP_RE = re.compile(r'^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+$')
FIGTAB_RE = re.compile(r'^\s*(?:Table|Figure)\s+(?:\d+|[IVXLCDM]+)\s*[.: ]', re.I)

# TeX-only superscript line variants: ${ }^{n}$, ${}^{n}$, ^{n}
TEX_SUP_LINE_RE = re.compile(
    r'^\s*(?:\$\s*\{\s*\}\s*\^\{?\d+\}?\s*\$|\$\s*\^\{?\d+\}?\s*\$|\^\{?\d+\}?\s*)\s*$'
)

# Footnote definitions and lone markers
FOOTNOTE_DEF_RE = re.compile(r'^\s*\[\^\d+\]\s*:\s*')  # [^12]: text
FOOTNOTE_BARE_RE = re.compile(r'^\s*\[\^\d+\]\s*$')  # bare [^12] line

# True paragraph enders (NOT colon/semicolon)
PARA_END_RE = re.compile(r'[.!?…]["”\')\]]*\s*$')

SMALLWORDS = {"and", "or", "of", "the", "in", "on", "for", "to", "by", "with", "vs", "vs.", "a", "an"}


def looks_like_section_title(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if HEADING_HASH_RE.match(s):
        return True
    if len(s) > 80:
        return False
    if s.endswith(('.', '?', '!', ':', ';')):
        return False
    if URL_RE.search(s) or DOI_RE.search(s) or EMAIL_RE.search(s):
        return False
    toks = re.split(r'\s+', s)
    if not (1 <= len(toks) <= 10):
        return False
    good = 0
    total = 0
    for t in toks:
        u = t.strip("–—-:,()[]{}'\"")
        if not u:
            continue
        total += 1
        if u.lower() in SMALLWORDS:
            good += 1
        elif len(u) >= 2 and u.isupper():
            good += 1
        elif u[0].isupper():
            good += 1
    return total > 0 and (good / total) >= 0.7


def is_structural_line(line: str) -> bool:
    return bool(TABLE_ROW_RE.match(line) or TABLE_SEP_RE.match(line) or FIGTAB_RE.match(line))


def is_structural_block(block: str) -> bool:
    return any(is_structural_line(ln) for ln in block.splitlines())


def is_heading_block(block: str) -> bool:
    lines = [ln for ln in block.splitlines() if ln.strip()]
    if not lines:
        return False
    if len(lines) == 1 and looks_like_section_title(lines[0]):
        return True
    return bool(HEADING_HASH_RE.match(lines[0]))


# ---------- cleaning helpers ----------
SOFT_HYPH = "\u00AD"

# remove TeX superscripts in ANY position:
TEX_SUP_INLINE_RE = re.compile(
    r'(?:\$\s*\{\s*\}\s*\^\{?\d+\}?\s*\$)'  # ${ }^{n}$
    r'|(?:\$\s*\^\{?\d+\}?\s*\$)'  # ${}^{n}$
    r'|(?:\^\{?\d+\}?)'  # ^{n}
)


def strip_tex_superscripts(s: str) -> str:
    return TEX_SUP_INLINE_RE.sub('', s)


def clean_inline_spaces(s: str) -> str:
    s = strip_tex_superscripts(s)
    s = s.replace(SOFT_HYPH, '').replace("\u00A0", " ").replace("\u202F", " ")
    s = re.sub(r'\s+([,.;:!?%])', r'\1', s)  # "word ." -> "word."
    s = re.sub(r'([A-Za-z0-9])(?=["“])', r'\1 ', s)  # the"word -> the "word
    s = re.sub(r'(?<=["“])\s+', '', s)  # trim inside open quote
    s = re.sub(r'\s+(?=["”])', '', s)  # trim before close quote
    s = re.sub(r' {2,}', ' ', s)
    return s


def smart_join(prev: str, cur: str) -> str:
    prev = prev.rstrip()
    cur = cur.lstrip()

    if TEX_SUP_LINE_RE.match(cur):
        join = ''  # (will be removed by cleaner anyway)
    elif re.search(r'(?:-|–|—)\s*$', prev) and re.match(r'^[a-z]', cur):
        prev = re.sub(r'(?:-|–|—)\s*$', '', prev)  # unwrap hyphenation
        join = ''
    elif re.match(r'^[\.,;:\)\]\}\!\?%]', cur):
        join = ''  # no space before leading punctuation
    else:
        join = ' '

    return clean_inline_spaces(prev + join + cur)


def ends_paragraph_text(txt: str) -> bool:
    t = txt.rstrip()
    if not t.strip():
        return True
    # also ignore trailing TeX superscripts when deciding completeness
    t = strip_tex_superscripts(t).rstrip()
    return bool(PARA_END_RE.search(t))


def reflow_lines_within_block(block: str) -> str:
    lines = block.splitlines()
    out = ''
    for raw in lines:
        ln = clean_inline_spaces(raw.strip())
        if not ln:
            if not out.endswith('\n'):
                out += '\n'
            continue
        if not out:
            out = ln
            continue
        last = out.rstrip('\n').rstrip()
        if PARA_END_RE.search(last):
            out = out + '\n' + ln
        else:
            out = smart_join(last, ln)
    return out


def drop_bare_footnote_markers(block: str) -> str:
    lines = block.splitlines()
    kept = [ln for ln in lines if not FOOTNOTE_BARE_RE.match(ln)]
    return '\n'.join(kept)


def normalize_footnote_defs(block: str) -> str:
    lines = block.splitlines()
    for i, ln in enumerate(lines):
        if FOOTNOTE_DEF_RE.match(ln):
            key, rest = ln.split(':', 1)
            key = re.sub(r'\s+', '', key)
            rest = clean_inline_spaces(rest.strip())
            lines[i] = f"{key}: {rest}"
    return '\n'.join(lines)


# ---------- main ----------
def reflow_md(text: str) -> str:
    raw_blocks = re.split(r'\n{2,}', text.strip('\n'))
    blocks = [blk.strip('\n') for blk in raw_blocks]

    prepped = []
    for blk in blocks:
        if not blk.strip():
            prepped.append(blk);
            continue
        if is_heading_block(blk) or is_structural_block(blk):
            prepped.append(blk)
        else:
            blk = drop_bare_footnote_markers(blk)
            blk = reflow_lines_within_block(blk)
            prepped.append(blk)

    out = []
    i = 0
    n = len(prepped)
    while i < n:
        cur = prepped[i]
        if not cur.strip() or is_heading_block(cur) or is_structural_block(cur):
            out.append(cur);
            i += 1;
            continue

        acc = cur
        j = i
        while not ends_paragraph_text(acc):
            k = j + 1
            while k < n and not prepped[k].strip():
                k += 1
            if k >= n:
                break
            nxt = prepped[k]
            if is_heading_block(nxt) or is_structural_block(nxt):
                break
            acc = smart_join(acc, nxt)
            j = k

        if ends_paragraph_text(acc):
            acc = normalize_footnote_defs(acc)

        out.append(acc)
        i = j + 1

    final = []
    for blk in out:
        if final and blk.strip():
            final.append('')
        final.append(blk)

    return '\n'.join(final).rstrip('\n')


def make_flat_text(text_, style_):
    t = _remove_intext_citations(text_, style_)
    t = _remove_footnotes_everywhere(t)
    t = reflow_md(t)

    return t


import re


# --- Optional normalization helpers you already reference elsewhere ---
# Expect STYLE_DEFAULT_LABEL and make_flat_text() to be defined in your environment.

def _collect_numbered_endnotes_runs(t: str) -> Dict[str, str]:
    """
    Collect plain numbered endnote blocks like:
      95. ...
      96. ...
    (possibly multi-line bodies).

    Heuristic guardrails avoid treating regular section numbering as endnotes:
    - minimum run size
    - sufficiently large maximum index
    - mostly in the latter part of the document
    """
    entry_re = re.compile(
        r'(?ms)^\s*(?P<idx>\d{1,4})\.\s+(?P<body>.+?)(?=^\s*\d{1,4}\.\s+|\Z)'
    )
    matches = list(entry_re.finditer(t))
    if len(matches) < 5:
        return {}

    idx_vals = [int(m.group("idx")) for m in matches]
    if max(idx_vals, default=0) < 8:
        return {}

    cutoff = int(len(t) * 0.30)
    late_ratio = sum(1 for m in matches if m.start() >= cutoff) / max(1, len(matches))
    if late_ratio < 0.60:
        return {}

    rich_ratio = sum(
        1
        for m in matches
        if len(re.findall(r"\w+", m.group("body") or "")) >= 4
    ) / max(1, len(matches))
    if rich_ratio < 0.60:
        return {}

    out: Dict[str, str] = {}
    for m in matches:
        idx = m.group("idx")
        body = " ".join(line.strip() for line in m.group("body").splitlines())
        body = re.sub(r"\s+", " ", body).strip()
        if body:
            out.setdefault(idx, body)
    return out


def parse_footnotes_globally(text):
    """
    Collect broad footnote/endnote definitions into a dict index -> body.
    This is a safety net that scans the whole document.
    """
    items: Dict[str, str] = {}

    # Normalize common OCR non-breaking spaces so \s catches them.
    t = text.replace('\u00A0', ' ').replace('\u202F', ' ')

    # 1) TeX-superscript style inside indented lines:
    #    matches: "    ${ }^{12}$ body...", "    ${}^{12}$ body...", "    $^{12}$ body..."
    for m in re.finditer(
            r'^[ \t]{2,}\$\s*(?:\{\s*\})?\s*\^\{(?P<idx>\d{1,4})\}\$\s*(?P<body>.+)',
            t, re.M
    ):
        idx, body = m.group('idx'), m.group('body').rstrip()
        items.setdefault(idx, body)

    # 2) Bare-number style in indented lines:
    #    matches: "    12 body...", "    12. body...", "    12) body...", "    12– body..."
    for m in re.finditer(
            r'^[ \t]{2,}(?P<idx>\d{1,4})\s*(?:[.)]|[–—-])?\s*(?P<body>.+)',
            t, re.M
    ):
        idx, body = m.group('idx'), m.group('body').rstrip()
        items.setdefault(idx, body)

    # 3) Unindented numbered endnote runs (common in OCR legal PDFs)
    items.update({k: v for k, v in _collect_numbered_endnotes_runs(t).items() if k not in items})

    return items


def tex_parser(text, references):
    import re

    # ----------------------------
    # Helpers: detect and extract footnote blocks
    # ----------------------------
    def _is_block_line(line: str) -> bool:
        if not line.strip():
            return False
        if re.match(r'^\s*(?:\$\s*(?:\{\s*\})?\s*\^\{\d{1,4}\}\$|\d{1,4}\s*(?:[.)]|[–—-])?)\s+', line):
            return True
        return bool(re.match(r'^(?:\t| {2,})', line))

    def footnote_block_spans_all(t: str):
        _BLOCK_HDR_RE = re.compile(r'(?m)^(?P<hdr>[ \t]*)\[\^0\]\s*:?\s*(?:\r?\n|$)')
        spans = []
        for m in _BLOCK_HDR_RE.finditer(t):
            start = m.start()
            pos = m.end()
            end = pos
            while True:
                nl = t.find('\n', pos)
                if nl == -1:
                    end = len(t)
                    break
                line = t[pos:nl + 1]
                if _is_block_line(line):
                    end = nl + 1
                    pos = nl + 1
                    continue
                end = pos
                break
            spans.append((start, end))
        return spans

    def collect_items_from_span(t: str, span):
        # Accept TeX (${ }^{n}$ | ${}^{n}$ | $^{n}$) OR bare "n" with optional delimiter; body spans to next item.
        _ITEM_RE = re.compile(r'''
            ^\s*
            (?:
                \$\s*(?:\{\s*\})?\s*\^\{(?P<n1>\d{1,4})\}\$      # TeX opener variants
              |
                (?P<n2>\d{1,4})\s*(?:[.)]|[–—-])?\s*             # bare number, OCR-tolerant spacing
            )
            (?P<body>.*?)
            (?=
                ^\s*(?:\$\s*(?:\{\s*\})?\s*\^\{\d{1,4}\}\$|\d{1,4}\s*(?:[.)]|[–—-])?)\s+  # next item
              | \Z
            )
        ''', re.M | re.S | re.X)
        s, e = span
        block = t[s:e]
        items = {}
        for m in _ITEM_RE.finditer(block):
            idx = m.group('n1') or m.group('n2')
            body = (m.group('body') or '').strip()
            if idx and body and idx not in items:
                items[idx] = body
        return items

    # ----------------------------
    # Build primary items map from provided references or from text blocks
    # ----------------------------
    items_primary = {}

    if references:
        lines = references[0].splitlines()

        # (A) TeX-style lines:  ${ }^{n}$  Body...
        for line in lines:
            m = re.match(r'^\s*(\$\s*(?:\{\s*\})?\s*\^\{\s*(\d{1,4})\s*\}\$)\s*(.*\S)', line)
            if m:
                token, idx, body = m.group(1), m.group(2), m.group(3).strip()
                items_primary.setdefault(token, body)
                items_primary.setdefault(idx, body)

        # (B) Ordinal lines with delimiter:  "n. Body" | "n) Body" | "n– Body"
        for line in lines:
            m = re.match(r'^\s*(\d{1,4})\s*(?:[.)]|[–—-])\s*(.*\S)', line)
            if m:
                idx, body = m.group(1), m.group(2).strip()
                token = '${ }^{' + idx + '}$'
                items_primary.setdefault(idx, body)
                items_primary.setdefault(token, body)

        # (C) "Squeezed" index + body (e.g., "1444 U.S.C. ..." meaning index 14, body "44 U.S.C. ...";
        #     also "9910 U.S.C. ..." meaning index 99, body "10 U.S.C. ...")
        #     Heuristic: capture 1–3 leading digits as the index when immediately followed by ≥2 more digits.
        for line in lines:
            m = re.match(r'^\s*(\d{1,3})(?=\d{2,})', line)
            if m:
                idx = m.group(1)
                body = line[m.end():].strip()
                if body:
                    token = '${ }^{' + idx + '}$'
                    items_primary.setdefault(idx, body)
                    items_primary.setdefault(token, body)

        # (D) Space-only separator: "n Body" (conservative: letter/punct after at least one space)
        for line in lines:
            m = re.match(r'^\s*(\d{1,4})\s+(.*\S)', line)
            if m:
                idx, body = m.group(1), m.group(2).strip()
                token = '${ }^{' + idx + '}$'
                # Do not overwrite earlier, stricter matches:
                items_primary.setdefault(idx, body)
                items_primary.setdefault(token, body)

    else:
        # Parse from footnote block(s) in the text
        spans = footnote_block_spans_all(text)
        for sp in spans:
            for idx, body in collect_items_from_span(text, sp).items():
                idx = str(idx)
                token_canon = '${ }^{' + idx + '}$'
                items_primary.setdefault(idx, body)
                items_primary.setdefault(token_canon, body)

        # Supplemental: single-line bare-number captures across the raw text
        bib_re = re.compile(r'(?m)^[ \t]{2,}(?P<idx>\d{1,4})\s*(?:[.)]|[–—-])?\s*(?P<body>.+?)\s*$')
        for m in bib_re.finditer(text):
            idx, body = m.group('idx'), m.group('body').strip()
            token_canon = '${ }^{' + idx + '}$'
            items_primary.setdefault(idx, body)
            items_primary.setdefault(token_canon, body)

    # --- pre-normalize spacing so \s catches OCR NBSPs ---
    text = text.replace('\u00A0', ' ').replace('\u202F', ' ')
    text = re.sub(r'(?m)^(?P<h>\[\^0\]\s*:?)\s*(?=\S)', r'\g<h>\n    ', text)

    # ----------------------------
    # In-text scanner (TeX superscripts)
    # ----------------------------
    _INTEXT_RE = re.compile(r'\$\s*(?:\{\s*\})?\s*\^\{\s*(?P<idx>\d{1,4})\s*\}\s*\$')

    def inside_any(pos: int, spans):
        return any(s <= pos < e for s, e in spans)

    def guard_text_outside_blocks(t: str, spans):
        pieces, last = [], 0
        for s, e in spans:
            pieces.append(t[last:s])
            pieces.append('\uFFFF' * (e - s))  # mask block to avoid second-pass matches
            last = e
        pieces.append(t[last:])
        return ''.join(pieces)

    # Preceding-text fallback with header/block skipping and a short-window rescue.
    def preceding_context_fallback(t: str, pos: int, spans):
        prefix = t[:pos]
        lines = prefix.splitlines()
        i = len(lines) - 1
        while i >= 0:
            ln = lines[i].strip()
            if (not ln
                    or re.match(r'^(#{1,6}\s+|={2,}\s*$|-{2,}\s*$)', ln)
                    or re.match(r'^\[\^0\]\s*:?\s*$', ln)):
                i -= 1
                continue
            window = '\n'.join(lines[:i + 1])[-600:]
            dbl = window.rfind('\n\n')
            if dbl != -1:
                cand = window[dbl:].strip()
            else:
                m = re.search(r'(?s).*([.?!](?:["\')\]]+)?)(?!.*[.?!](?:["\')\]]+)?).*$', window)
                cand = (m.group(0) if m else window).strip()
            cand = re.sub(r'\s+', ' ', cand).strip()
            if cand:
                return cand[-280:]
            break
        j = len(lines) - 1
        while j >= 0 and not lines[j].strip():
            j -= 1
        return (lines[j].strip() if j >= 0 else '')[-80:]

    def find_intext_hits(t: str, spans):
        tail_cutoff = _infer_reference_tail_start(t)
        hits = []
        for m in _INTEXT_RE.finditer(t):
            pos = m.start()
            if tail_cutoff != -1 and pos >= tail_cutoff:
                continue
            if inside_any(pos, spans):
                continue

            idx = m.group('idx')
            token = '${ }^{' + idx + '}$'
            ctx = preceding_context_fallback(t, pos, spans)
            hits.append({"index": idx, "intext_citation": token, "preceding_text": ctx, "start": pos})
        return hits

    # ----------------------------
    # 1) Parse blocks from text (for guarding) and collect any items from text
    # ----------------------------
    spans = footnote_block_spans_all(text)

    items_from_text = {}
    for sp in spans:
        for k, v in collect_items_from_span(text, sp).items():
            k = str(k)
            token_canon = '${ }^{' + k + '}$'
            items_from_text[k] = v
            items_from_text[token_canon] = v

    # Supplemental: single-line bare-number captures across the raw text
    bib_re = re.compile(r'(?m)^[ \t]{2,}(?P<idx>\d{1,4})\s*(?:[.)]|[–—-])?\s*(?P<body>.+?)\s*$')
    tex_line_re = re.compile(r'(?m)^\s*\$\s*(?:\{\s*\})?\s*\^\{(?P<idx>\d{1,4})\}\$\s+(?P<body>.+\S)\s*$')
    for m in tex_line_re.finditer(text):
        idx, body = m.group('idx'), m.group('body').strip()
        items_from_text.setdefault(idx, body)

    # ----------------------------
    # 2) In-text hits (normalized) outside blocks
    # ----------------------------
    intexts = find_intext_hits(text, spans)
    # ----------------------------
    # Fallback to numeric-style if we have references but no TeX-style hits
    # ----------------------------
    if references and not intexts:
        numeric_data = parse_numeric_intext_and_link(text, references=references)
        return {
            "total": numeric_data["total"],
            "results": numeric_data["results"],
            "flat_text": numeric_data["flat_text"]
        }
    # ----------------------------
    # 3) Second-pass fallback lines (outside guarded blocks)
    # ----------------------------
    _SECOND_PASS_RE = re.compile(r'''(?mx)
        ^\s*(?:[-*•]\s*)?                         # optional bullet
        (?:\$(?:\{\s*\})?\^\{\s*\d{1,4}\s*\}\$\s*)?
        (?P<idx>\d{1,4})\s*(?:[.)]|[–—-])?\s*     # OCR-tolerant spacing after index
        (?P<body>.+?)\s*$                         # body
    ''')
    missing_for_seen = {h["index"] for h in intexts} - set(items_primary)
    guarded = guard_text_outside_blocks(text, spans)
    fallback_map = {}
    for m in _SECOND_PASS_RE.finditer(guarded):
        idx = m.group('idx')
        if idx in missing_for_seen and idx not in fallback_map:
            fallback_map[idx] = m.group('body').strip()

    # Merge: priority = primary (from references) > items_from_text > fallback_map
    items = {**fallback_map, **items_from_text, **items_primary}

    # ----------------------------
    # 4) Build results (try token match, then index match)
    # ----------------------------
    global_items = parse_footnotes_globally(text)  # existing helper in your codebase
    known_numeric = {k for k in (set(items.keys()) | set(global_items.keys())) if str(k).isdigit()}
    results = []
    for it in intexts:
        idx = it["index"]
        if known_numeric and idx not in known_numeric:
            continue
        token = it["intext_citation"]
        # IMPORTANT: ensure we try index lookup if token lookup fails (covers references case).
        foot = (items.get(token)
                or items.get(idx)
                or global_items.get(token)
                or global_items.get(idx))
        results.append({
            "index": idx,
            "intext_citation": token,
            "preceding_text": it["preceding_text"],
            "footnote": foot
        })

    # ----------------------------
    # 5) Stats
    # ----------------------------
    intext_total = len(results)
    success_occurrences = sum(1 for r in results if r["footnote"])
    success_unique = len({r["index"] for r in results if r["footnote"]})

    union_keys = set(items.keys()) | set(global_items.keys())
    footnotes_total = len(union_keys)

    seen_idxs = {int(r["index"]) for r in results}
    seen_strs = {str(i) for i in seen_idxs}
    numeric_union = {k for k in union_keys if re.fullmatch(r"\d+", k)}

    missing_foot_for_seen = sorted(int(k) for k in seen_strs - numeric_union)
    uncited_footnotes = sorted(int(k) for k in numeric_union - seen_strs)

    max_seen = max(seen_idxs) if seen_idxs else 0
    expected = set(range(1, max_seen)) if max_seen > 1 else set()
    missing_intext_seq = sorted(expected - seen_idxs)

    stats = {
        "intext_total": intext_total,
        "success_occurrences": success_occurrences,
        "success_unique": success_unique,
        "bib_unique_total": footnotes_total,
        "occurrence_match_rate": success_occurrences / intext_total if intext_total else 0.0,
        "bib_coverage_rate": success_unique / footnotes_total if footnotes_total else 0.0,
        "success_percentage": round((success_occurrences / intext_total * 100) if intext_total else 0.0, 2),
        "missing_intext_expected_total": len(missing_intext_seq),
        "missing_intext_indices": missing_intext_seq,
        "highest_intext_index": max_seen,
        "missing_footnotes_for_seen_total": len(missing_foot_for_seen),
        "missing_footnotes_for_seen_intext": missing_foot_for_seen,
        "uncited_footnote_total": len(uncited_footnotes),
        "uncited_footnote_indices": uncited_footnotes,
        "style": STYLE_TEX,
    }

    flat_text = make_flat_text(text, STYLE_TEX)  # existing helper in your codebase
    return {"total": stats, "results": results, "flat_text": flat_text}


import re
import unicodedata
from typing import List


def _build_author_year_map_from_endnotes(items: Dict[str, str]) -> Dict[str, str]:
    if not items:
        return {}
    rows = []
    for k, v in items.items():
        if not isinstance(v, str) or not v.strip():
            continue
        rows.append((int(k), v.strip()) if str(k).isdigit() else (10**9, v.strip()))
    if not rows:
        return {}
    rows.sort(key=lambda x: x[0])
    block = "\n".join(v for _, v in rows)
    pairs = parse_bibliography_author_year_from_block(block)
    return {f"{a}|{y}": entry for (a, y), entry in pairs.items()}


def author_year_parser(text: str, references: List[str] = None):
    season_tokens = {"spring", "summer", "fall", "autumn", "winter"}
    dateish_tokens = season_tokens | _DATEISH_AUTHOR_TOKENS

    raw_refs_text = _as_references_text(references)
    refs_text = pick_references_block(references or [""])
    inferred_tail = _infer_reference_tail_block(text)
    text_bib_pairs, bib_start = parse_bibliography_author_year(text)

    refs_candidates = []
    if isinstance(raw_refs_text, str) and raw_refs_text.strip():
        refs_candidates.append(raw_refs_text.strip())
    if isinstance(refs_text, str) and refs_text.strip():
        if refs_text.strip() not in refs_candidates:
            refs_candidates.append(refs_text.strip())
    if inferred_tail and (not refs_candidates or inferred_tail not in refs_candidates[0]):
        refs_candidates.append(inferred_tail)
    merged_refs_text = "\n\n".join(x for x in refs_candidates if x)

    ay_pairs: Dict[Tuple[str, str], str] = {}
    if merged_refs_text:
        ay_pairs.update(parse_bibliography_author_year_from_block(merged_refs_text))
    if (not refs_text.strip()) and inferred_tail and len(ay_pairs) < 120:
        trailing_block = text[int(len(text) * 0.55):]
        trailing_pairs = parse_bibliography_author_year_from_block(trailing_block)
        for k, v in trailing_pairs.items():
            ay_pairs.setdefault(k, v)
    for k, v in text_bib_pairs.items():
        ay_pairs.setdefault(k, v)

    bib = {f"{a}|{y}": entry for (a, y), entry in ay_pairs.items()}

    global_items = parse_footnotes_globally(text)
    endnote_bib = _build_author_year_map_from_endnotes(global_items)
    endnote_text = "\n".join(v for v in global_items.values() if isinstance(v, str))
    lookup_text = "\n\n".join(x for x in (merged_refs_text, raw_refs_text, endnote_text) if x)

    search_cutoff = len(text)
    if bib_start != -1:
        search_cutoff = min(search_cutoff, bib_start)
    else:
        inferred_start = _infer_reference_tail_start(text)
        if inferred_start != -1:
            search_cutoff = min(search_cutoff, inferred_start)

    results = []
    block_spans = _footnote_block_spans(text)
    for m in INTEXT_RE.finditer(text[:search_cutoff]):
        if _inside_any(m.start(), block_spans):
            continue

        raw_cit = m.group(0)
        if _is_noise_ay_citation(raw_cit):
            continue

        candidate_triples: List[Tuple[str, str, List[str]]] = []

        key = intext_key(m)
        if key and "|" in key:
            ak, yk = key.split("|", 1)
            if ak and yk and ak not in dateish_tokens:
                candidate_triples.append((ak, yk, [ak]))

        authors, year = parse_intext_authors_year(raw_cit)
        if authors and year:
            a0 = normalize_author_key(authors[0])
            if a0 and a0 not in dateish_tokens:
                candidate_triples.append((a0, year, authors))

        for a_raw, y in _extract_ay_candidates(raw_cit):
            ak = normalize_author_key(a_raw)
            if not ak or ak in dateish_tokens:
                continue
            candidate_triples.append((ak, y, [a_raw]))

        dedup = []
        seen = set()
        for ak, y, auth_list in candidate_triples:
            key2 = (ak, y)
            if key2 in seen:
                continue
            seen.add(key2)
            dedup.append((ak, y, auth_list))
        candidate_triples = dedup

        if not candidate_triples:
            continue

        foot = None
        idx = f"{candidate_triples[0][0]}|{candidate_triples[0][1]}"
        for ak, y, auth_list in candidate_triples:
            idx_try = f"{ak}|{y}"
            idx = idx_try
            foot = bib.get(idx_try) or endnote_bib.get(idx_try)
            if foot:
                break

            # strict text presence first, then relaxed OCR-tolerant fallback
            foot = find_entry_by_presence(auth_list, y, lookup_text)
            if not foot:
                foot = find_entry_by_presence_relaxed(auth_list[:1] or auth_list, y, lookup_text)
            if foot:
                break

        results.append(
            {
                "index": idx,
                "intext_citation": raw_cit,
                "preceding_text": _preceding_context(text, m.start(), max_chars=260),
                "footnote": foot,
            }
        )

    total = len(results)
    success = sum(1 for r in results if r["footnote"])
    unique_success = len({r["index"] for r in results if r["footnote"]})
    stats = {
        "intext_total": total,
        "success_occurrences": success,
        "success_unique": unique_success,
        "bib_unique_total": len(bib) if bib else len(endnote_bib),
        "occurrence_match_rate": success / total if total else 0.0,
        "bib_coverage_rate": unique_success / (len(bib) if bib else len(endnote_bib))
        if (bib or endnote_bib)
        else 0.0,
        "success_percentage": round((success / total * 100) if total else 0.0, 2),
        "style": "author_year",
    }

    flat_text = make_flat_text(text, "author_year")
    return {"total": stats, "results": results, "flat_text": flat_text}


# --- HYBRID PARSER (TeX + Numeric families) ----------------------------------

_WORD_DOT_NUMBER_RE = re.compile(
    r"""
    (?<!\w)                # not preceded by word char
    (?P<word>[A-Za-z]{2,}) # a word (≥2 letters)
    \.(?P<idx>\d{1,4})\b   # .<number>
    (?![\w.])              # not followed by another word/dot (avoid 3.14 etc.)
    """, re.X
)

# Tight word+number like Foo12 but not codes like US10K
_WORD_TIGHT_NUM_RE = re.compile(
    r"""
    (?<![\w./])
    (?![A-Z]{2}\d+\b)      # avoid obvious code-like tokens (US10, etc.)
    (?P<word>[A-Za-z]{2,})
    (?P<idx>\d{1,4})\b
    (?![\w./])
    """, re.X
)

# word,"12   word,"[12]   ),[12]   1999,[12]
_NUMBER_BRACKETS_RE = re.compile(
    r"""
    (?:
        [A-Za-z]+\.?["']?\[\s*(?P<idx1>\d{1,4})\s*\]   # word.["12]
      | [A-Za-z]+,\[\s*(?P<idx2>\d{1,4})\s*\]          # word,[12]
      | \d{4},\[\s*(?P<idx3>\d{1,4})\s*\]              # 1999,[12]
      | \),\[\s*(?P<idx4>\d{1,4})\s*\]                 # ),[12]
    )
    """, re.X
)

# word,"12   word," '12   ),12   1999,12
_NUMBER_PLAIN_PUNCT_RE = re.compile(
    r"""
    (?:
        [A-Za-z]+\.?["']?(?P<idx1>\d{1,4})\b            # word."12  word'12  word.12
      | [A-Za-z]+,(?P<idx2>\d{1,4})\b                   # word,12
      | \d{4},(?P<idx3>\d{1,4})\b                       # 1999,12
      | \),(?P<idx4>\d{1,4})\b                          # ),12
    )
    """, re.X
)

# word.(12)  word;"(12)  ),(12)  1999,(12)
_DOT_PAREN_RE = re.compile(
    r"""
    (?:
        [A-Za-z]+\.?\(\s*(?P<idx1>\d{1,4})\s*\)         # word.(12)
      | [A-Za-z]+;\(\s*(?P<idx2>\d{1,4})\s*\)           # word;(12)
      | \),\(\s*(?P<idx3>\d{1,4})\s*\)                  # ),(12)
      | \d{4},\(\s*(?P<idx4>\d{1,4})\s*\)               # 1999,(12)
    )
    """, re.X
)


def find_word_dot_number(text: str):
    """Return a list of {'word','index','span'} for patterns like Foo.12"""
    out = []
    for m in _WORD_DOT_NUMBER_RE.finditer(text):
        out.append({
            "word": m.group("word"),
            "index": m.group("idx"),
            "span": (m.start(), m.end())
        })
    return out


def _hybrid_collect_numeric_hits(text: str, spans):
    """Find numeric in-text hits outside masked footnote blocks."""

    def _idx(m):
        for g in ("idx", "idx1", "idx2", "idx3", "idx4"):
            if g in m.groupdict() and m.group(g):
                return m.group(g)
        return None
        # Itemization inside blocks
        # ----------------------------

    # Accept TeX (${ }^{n}$ | ${}^{n}$ | $^{n}$) OR bare "n" with optional delimiter; body spans to next item.
    _ITEM_RE = re.compile(r'''
        ^\s*
        (?:
            \$\s*(?:\{\s*\})?\s*\^\{(?P<n1>\d{1,4})\}\$      # TeX opener variants
          |
            (?P<n2>\d{1,4})\s*(?:[.)]|[–—-])?\s*             # bare number, OCR-tolerant spacing
        )
        (?P<body>.*?)
        (?=
            ^\s*(?:\$\s*(?:\{\s*\})?\s*\^\{\d{1,4}\}\$|\d{1,4}\s*(?:[.)]|[–—-])?)\s+  # next item
          | \Z
        )
    ''', re.M | re.S | re.X)

    def collect_items_from_span(t: str, span):
        s, e = span
        block = t[s:e]
        items = {}
        for m in _ITEM_RE.finditer(block):
            idx = m.group('n1') or m.group('n2')
            body = (m.group('body') or '').strip()
            if idx and body and idx not in items:
                items[idx] = body
        return items

    # ----------------------------
    # In-text scanner (TeX superscripts)
    # ----------------------------
    _INTEXT_RE = re.compile(r"""
        \$\s*                            # opening $
        (?:\\?[^{\$]|\{[^}]*\})*?        # any junk before the superscript
        \^\{\s*(?P<idx>\d{1,4})\s*\}     # allow spaces inside the braces
        (?:                              # trailing macros or punctuation
          (?:\\[A-Za-z]+\{[^}]*\})
          | [^\$]
        )*?
        \$                                # closing $
    """, re.X)

    def inside_any(pos: int, spans):
        return any(s <= pos < e for s, e in spans)

    def guard_text_outside_blocks(t: str, spans):
        pieces, last = [], 0
        for s, e in spans:
            pieces.append(t[last:s])
            pieces.append('\uFFFF' * (e - s))  # mask block to avoid second-pass matches
            last = e
        pieces.append(t[last:])
        return ''.join(pieces)

    # Preceding-text fallback with header/block skipping and a short-window rescue.
    def preceding_context_fallback(t: str, pos: int, spans):
        prefix = t[:pos]
        lines = prefix.splitlines()
        i = len(lines) - 1
        while i >= 0:
            ln = lines[i].strip()
            if (not ln
                    or re.match(r'^(#{1,6}\s+|={2,}\s*$|-{2,}\s*$)', ln)
                    or re.match(r'^\[\^0\]\s*:?\s*$', ln)):
                i -= 1
                continue
            window = '\n'.join(lines[:i + 1])[-600:]
            dbl = window.rfind('\n\n')
            if dbl != -1:
                cand = window[dbl:].strip()
            else:
                m = re.search(r'(?s)(?:.*[.?!](?:["\')\]]+)?\s+)?(?P<tail>.*)\Z', window)
                cand = (m.group('tail') if m else window).strip()
            cand = re.sub(r'\s+', ' ', cand).strip()
            if cand:
                return cand[-280:]
            break
        j = len(lines) - 1
        while j >= 0 and not lines[j].strip():
            j -= 1
        return (lines[j].strip() if j >= 0 else '')[-80:]

    def find_intext_hits(t: str, spans):
        hits = []
        for m in _INTEXT_RE.finditer(t):
            if inside_any(m.start(), spans):
                continue
            idx = m.group('idx')
            token = '${ }^{' + idx + '}$'  # canonicalize
            ctx = preceding_context_fallback(t, m.start(), spans)
            hits.append({"index": idx, "intext_citation": token, "preceding_text": ctx, "start": m.start()})
        return hits

    guarded = guard_text_outside_blocks(text, spans)
    hits = []

    for rx in (_NUMBER_BRACKETS_RE, _DOT_PAREN_RE, _NUMBER_PLAIN_PUNCT_RE,
               _WORD_DOT_NUMBER_RE, _WORD_TIGHT_NUM_RE):
        for m in rx.finditer(guarded):
            idx = _idx(m)
            if not idx:
                continue
            pos = m.start()
            ctx = preceding_context_fallback(text, pos, spans)
            hits.append({
                "index": str(int(idx)),  # normalize
                "intext_citation": m.group(0),
                "preceding_text": ctx,
                "start": pos
            })
    # De-dup by position+index to reduce spam
    uniq = {}
    for h in hits:
        uniq[(h["start"], h["index"])] = h
    return list(uniq.values())


def hybrid_parser(text: str, references=None):
    """
    Try TeX superscripts first; if that yields no footnote matches, scan for numeric
    variants (brackets, dot-parenthesis, plain) and link to the same footnote items.
    """

    def _is_block_line(line: str) -> bool:
        # Treat blank lines as inside the block, and lines with ≥2 leading spaces/tabs as indented.
        if not line.strip():
            return False

        return bool(re.match(r'^(?:\t| {2,})', line))

    def footnote_block_spans_all(t: str):
        spans = []
        _BLOCK_HDR_RE = re.compile(
            r'(?m)^(?P<hdr>[ \t]*)\[\^(?P<idx>\d{1,4})\]\s*:\s*(?:\r?\n|$)'
        )

        for m in _BLOCK_HDR_RE.finditer(t):
            start = m.start()
            pos = m.end()
            end = pos
            while True:
                nl = t.find('\n', pos)
                if nl == -1:
                    end = len(t)
                    break
                line = t[pos:nl + 1]
                if _is_block_line(line):
                    end = nl + 1
                    pos = nl + 1
                    continue
                end = pos
                break
            spans.append((start, end))
        return spans

    # ----------------------------
    # Itemization inside blocks
    # ----------------------------
    # Accept TeX (${ }^{n}$ | ${}^{n}$ | $^{n}$) OR bare "n" with optional delimiter; body spans to next item.
    _ITEM_RE = re.compile(r'''
        ^\s*
        (?:
            \$\s*(?:\{\s*\})?\s*\^\{(?P<n1>\d{1,4})\}\$      # TeX opener variants
          |
            (?P<n2>\d{1,4})\s*(?:[.)]|[–—-])?\s*             # bare number, OCR-tolerant spacing
        )
        (?P<body>.*?)
        (?=
            ^\s*(?:\$\s*(?:\{\s*\})?\s*\^\{\d{1,4}\}\$|\d{1,4}\s*(?:[.)]|[–—-])?)\s+  # next item
          | \Z
        )
    ''', re.M | re.S | re.X)

    def collect_items_from_span(t: str, span):
        s, e = span
        block = t[s:e]
        items = {}
        for m in _ITEM_RE.finditer(block):
            idx = m.group('n1') or m.group('n2')
            body = (m.group('body') or '').strip()
            if idx and body and idx not in items:
                items[idx] = body
        return items

    # ----------------------------
    # In-text scanner (TeX superscripts)
    # ----------------------------
    _INTEXT_RE = re.compile(r"""
        \$\s*                            # opening $
        (?:\\?[^{\$]|\{[^}]*\})*?        # any junk before the superscript
        \^\{\s*(?P<idx>\d{1,4})\s*\}     # allow spaces inside the braces
        (?:                              # trailing macros or punctuation
          (?:\\[A-Za-z]+\{[^}]*\})
          | [^\$]
        )*?
        \$                                # closing $
    """, re.X)

    from bisect import bisect_right

    def build_span_index(spans):
        spans_sorted = sorted(spans)
        merged = []
        for a, b in spans_sorted:
            if not merged:
                merged.append([a, b])
                continue
            last = merged[-1]
            if a <= last[1]:
                if b > last[1]:
                    last[1] = b
            else:
                merged.append([a, b])
        starts = [a for a, _ in merged]
        ends = [b for _, b in merged]
        return starts, ends

    def inside_any(pos, starts, ends):
        i = bisect_right(starts, pos) - 1
        return i >= 0 and pos < ends[i]

    def guard_text_outside_blocks(t: str, spans):
        pieces, last = [], 0
        for s, e in spans:
            pieces.append(t[last:s])
            pieces.append('\uFFFF' * (e - s))  # mask block to avoid second-pass matches
            last = e
        pieces.append(t[last:])
        return ''.join(pieces)

    # Preceding-text fallback with header/block skipping and a short-window rescue.
    def preceding_context_fallback(t: str, pos: int, spans):
        prefix = t[:pos]
        lines = prefix.splitlines()
        i = len(lines) - 1

        while i >= 0:
            ln = lines[i].strip()

            if (not ln
                    or re.match(r'^(#{1,6}\s+|={2,}\s*$|-{2,}\s*$)', ln)
                    or re.match(r'^\[\^0\]\s*:?\s*$', ln)):
                i -= 1
                continue

            window = prefix[-600:]

            dbl = window.rfind('\n\n')
            if dbl != -1:
                cand = window[dbl:].strip()
            else:
                puncts = [window.rfind('.'), window.rfind('?'), window.rfind('!')]
                last_end = max(puncts)
                if last_end == -1:
                    cand = window.strip()
                else:
                    prev_slice = window[:last_end]
                    prev_puncts = [prev_slice.rfind('.'), prev_slice.rfind('?'), prev_slice.rfind('!')]
                    prev_end = max(prev_puncts)

                    start = prev_end + 1
                    cand = window[start:last_end + 1].strip()

            cand = re.sub(r'\s+', ' ', cand).strip()
            if cand:
                out = cand
                if len(out) > 280:
                    cut = out[-280:]
                    ws = cut.find(' ')
                    out = cut[ws + 1:] if ws != -1 else cut
                return out

            break

        j = len(lines) - 1
        while j >= 0 and not lines[j].strip():
            j -= 1

        out = lines[j].strip() if j >= 0 else ''
        if len(out) > 80:
            cut = out[-80:]
            ws = cut.find(' ')
            out = cut[ws + 1:] if ws != -1 else cut
        return out

    def find_intext_hits(t: str, spans):
        span_starts, span_ends = build_span_index(spans)
        tail_cutoff = _infer_reference_tail_start(t)
        hits = []
        for m in _INTEXT_RE.finditer(t):
            pos = m.start()
            if tail_cutoff != -1 and pos >= tail_cutoff:
                continue
            if inside_any(pos, span_starts, span_ends):
                continue

            idx = m.group('idx')
            token = '${ }^{' + idx + '}$'
            ctx = preceding_context_fallback(t, pos, spans)
            hits.append({"index": idx, "intext_citation": token, "preceding_text": ctx, "start": pos})
        return hits

    items_primary = {}
    if references:
        for line in references[0].splitlines():
            m = re.match(r'^\s*(?:\$\s*\{\s*\}\s*\^\{\s*(\d{1,4})\s*\}\$|(\d{1,4}))\s*(.*\S)', line)
            if m:
                idx = m.group(1) or m.group(2)
                body = (m.group(3) or "").strip()
                token_canon = '${ }^{' + idx + '}$'
                items_primary[token_canon] = body
                items_primary[idx] = body

    # Normalize spaces so \s matches NBSP, etc., and prepare block spans
    t = text.replace('\u00A0', ' ').replace('\u202F', ' ')
    t = re.sub(
        r'(?m)^(?P<h>\[\^\d{1,4}\]\s*:)\s*(?=\S)',
        r'\g<h>\n    ',
        t
    )
    spans = footnote_block_spans_all(t)

    # Pull multi-line items from true blocks in text
    items_from_text = {}
    for sp in spans:
        for k, v in collect_items_from_span(t, sp).items():
            k = str(k)
            token_canon = '${ }^{' + k + '}$'
            items_from_text[k] = v
            items_from_text[token_canon] = v

    # Supplemental: bare-number bibliography lines indented
    tex_line_re = re.compile(r'(?m)^\s*\$\s*(?:\{\s*\})?\s*\^\{(?P<idx>\d{1,4})\}\$\s+(?P<body>.+\S)\s*$')
    for m in tex_line_re.finditer(t):
        idx, body = m.group('idx'), m.group('body').strip()
        token_canon = '${ }^{' + idx + '}$'
        items_from_text.setdefault(idx, body)
        items_from_text.setdefault(token_canon, body)

    # 1) TeX hits (outside blocks)
    intexts_tex = find_intext_hits(t, spans)

    # 2) Numeric family hits (outside blocks)
    intexts_num = _hybrid_collect_numeric_hits(t, spans)
    tail_cutoff = _infer_reference_tail_start(t)
    if tail_cutoff != -1:
        intexts_num = [h for h in intexts_num if int(h.get("start", 0)) < tail_cutoff]

    # Union items; primary wins
    items = {**items_from_text, **items_primary}

    global_footnotes = parse_footnotes_globally(t)
    known_numeric = {
        k for k in (set(items.keys()) | set(global_footnotes.keys()))
        if str(k).isdigit()
    }

    # Try to resolve TeX first; if no successes, use numeric
    def _resolve(hits):
        results = []
        for it in hits:
            idx = it["index"]
            if known_numeric and idx not in known_numeric:
                continue
            token = '${ }^{' + idx + '}$'
            foot = items.get(token) or items.get(idx) or global_footnotes.get(token) or global_footnotes.get(idx)
            results.append({
                "index": idx,
                "intext_citation": it["intext_citation"],
                "preceding_text": it["preceding_text"],
                "footnote": foot
            })
        return results

    results_tex = _resolve(intexts_tex)
    success_tex = any(r["footnote"] for r in results_tex)

    results = results_tex if success_tex else _resolve(intexts_num)

    # --- Stats ---
    intext_total = len(results)
    success_occurrences = sum(1 for r in results if r["footnote"])
    success_unique = len({r["index"] for r in results if r["footnote"]})
    seen_idxs = {int(r["index"]) for r in results} if results else set()
    max_seen = max(seen_idxs) if seen_idxs else 0
    expected = set(range(1, max_seen)) if max_seen > 1 else set()
    missing_intext_seq = sorted(expected - seen_idxs)

    union_keys = set(items.keys()) | set(global_footnotes.keys())
    footnotes_total = len(union_keys)

    missing_foot_for_seen = sorted(int(i) for i in (set(str(i) for i in seen_idxs) - union_keys))
    uncited_footnotes = sorted(
        int(k) for k in union_keys if k.isdigit() and int(k) not in seen_idxs
    )

    stats = {
        "intext_total": intext_total,
        "success_occurrences": success_occurrences,
        "success_unique": success_unique,
        "bib_unique_total": footnotes_total,
        "occurrence_match_rate": success_occurrences / intext_total if intext_total else 0.0,
        "bib_coverage_rate": success_unique / footnotes_total if footnotes_total else 0.0,
        "success_percentage": round((success_occurrences / intext_total * 100) if intext_total else 0.0, 2),
        "missing_intext_expected_total": len(missing_intext_seq),
        "missing_intext_indices": missing_intext_seq,
        "highest_intext_index": max_seen,
        "missing_footnotes_for_seen_total": len(missing_foot_for_seen),
        "missing_footnotes_for_seen_intext": missing_foot_for_seen,
        "uncited_footnote_total": len(uncited_footnotes),
        "uncited_footnote_indices": uncited_footnotes,
        "style": STYLE_HYBRID,
    }
    flat_text = make_flat_text(t, STYLE_HYBRID)
    return {"total": stats, "results": results, "flat_text": flat_text}




def parse_bibliography_numeric(text: str) -> tuple[dict[int, str], int]:
    """
    Parses numeric bibliography entries in markdown footnote style:
      [^1]: first entry
      [^2]: second entry
    Returns (refs_map, bib_start), where refs_map maps each integer to its footnote text,
    and bib_start is the index in text where the first footnote appears (or -1 if none).
    """
    refs_map = {}
    # find all "[^n]: ..." blocks
    pattern = re.compile(r'^\[\^(\d+)\]:\s*(.+?)(?=\n\[\^\d+\]:|\Z)', re.MULTILINE | re.DOTALL)
    matches = list(pattern.finditer(text))
    if not matches:
        return {}, -1
    bib_start = matches[0].start()
    for m in matches:
        idx = int(m.group(1))
        body = m.group(2).strip().replace("\n", " ")
        refs_map[idx] = body
    return refs_map, bib_start


def parse_numeric_intext_and_link(text: str, references=None) -> dict:
    """
    Numeric in-text parser that links [n]-style citations to bibliography.
    It now also consumes a standalone references block passed via `references`
    (e.g., refs_raw) where entries begin with “[n] …”.
    """
    # 1) Build refs_map from either refs_raw or the main text
    refs_map = {}
    if references:
        refs_text = pick_references_block(references)
        refs_map = parse_bibliography_numeric_from_refs(refs_text)
    if not refs_map:
        refs_map, bib_start = parse_bibliography_numeric(text)
    else:
        bib_start = -1

    # Fallback for OCR/legal layouts: recover plain numbered endnote runs.
    if not refs_map:
        global_items = parse_footnotes_globally(text)
        refs_map = {int(k): v for k, v in global_items.items() if str(k).isdigit()}
    if not refs_map:
        tail_refs = _infer_reference_tail_block(text)
        refs_map = parse_bibliography_numeric_from_refs(tail_refs) if tail_refs else {}

    # 2) Find in-text [n], [n;m], [n–m] (optionally wrapped in $ … $)
    if bib_start != -1:
        search_text = text[:bib_start]
    else:
        inferred_start = _infer_reference_tail_start(text)
        search_text = text[:inferred_start] if inferred_start != -1 else text
    cite_re = re.compile(
        r'\$?\[\s*'
        r'(?P<body>\d+(?:\s*[–-]\s*\d+)?'
        r'(?:\s*[,;]\s*\d+(?:\s*[–-]\s*\d+)?)*?)'
        r'\s*\]\$?'
    )

    def _expand_token(tok: str) -> list[int]:
        tok = tok.strip()
        if re.search(r'[–-]', tok):
            a, b = re.split(r'[–-]', tok, maxsplit=1)
            a, b = int(a.strip()), int(b.strip())
            step = 1 if a <= b else -1
            return list(range(a, b + step, step))
        return [int(tok)] if tok else []

    def _expand_group(body: str) -> list[int]:
        out, seen = [], set()
        # split on both commas and semicolons so “16, 22” becomes ["16","22"]
        for part in re.split(r'[;,]', body):
            part = part.strip()
            for n in _expand_token(part):
                if n not in seen:
                    seen.add(n);
                    out.append(n)
        return out

    results = []
    for m in cite_re.finditer(search_text):
        nums = _expand_group(m.group('body'))
        if not nums:
            continue
        if refs_map:
            # When bibliography indices are known, drop bracketed years/non-footnote
            # numerals (e.g. [2020]) that are not actual note indices.
            nums = [n for n in nums if n in refs_map]
            if not nums:
                continue
        ctx = _preceding_context(text, m.start(), max_chars=220)
        raw = m.group(0)
        for n in nums:
            results.append({
                "index": str(n),
                "intext_citation": raw,
                "preceding_text": ctx,
                "footnote": refs_map.get(n)
            })

    intext_total = len(results)
    success_occurrences = sum(1 for r in results if r["footnote"])
    success_unique = len({r["index"] for r in results if r["footnote"]})
    bib_unique_total = len(refs_map)

    stats = {
        "intext_total": intext_total,
        "success_occurrences": success_occurrences,
        "success_unique": success_unique,
        "bib_unique_total": bib_unique_total,
        "occurrence_match_rate": (success_occurrences / intext_total) if intext_total else 0.0,
        "bib_coverage_rate": (success_unique / bib_unique_total) if bib_unique_total else 0.0,
        "success_percentage": round((success_occurrences / intext_total * 100.0) if intext_total else 0.0, 2),
        "style": "numeric",
    }

    flat = re.sub(r'^\[\^\d+\]:.*?(?=\n\[\^\d+\]:|\Z)', '', text, flags=re.S | re.M)
    flat = re.sub(r'\$?\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\]\$?', '', flat)
    flat = re.sub(r'[ \t]+$', '', flat, flags=re.M)
    flat = re.sub(r'\n{3,}', '\n\n', flat).strip()

    return {"total": stats, "results": results, "flat_text": flat}


def parse_bibliography_numeric_from_refs(refs_text: str) -> dict[int, str]:
    """
    Extracts “[n] …” (or “n. …”) entries from a standalone References block.
    Collapses multi-line bodies and normalizes spacing.
    """
    if not refs_text:
        return {}

    hdr = re.search(r'(?im)^##\s*References\b', refs_text)
    block = refs_text[hdr.end():] if hdr else refs_text

    out: dict[int, str] = {}
    for m in re.finditer(
            r'(?m)^\s*\[(\d{1,4})\]\s*(.+?)(?=^\s*\[\d{1,4}\]\s*|\Z)',
            block, flags=re.S
    ):
        n = int(m.group(1))
        body = " ".join(line.strip() for line in m.group(2).splitlines())
        out[n] = re.sub(r'\s+', ' ', body)

    if not out:
        for m in re.finditer(
                r'(?m)^\s*(\d{1,4})\.\s*(.+?)(?=^\s*\d{1,4}\.\s*|\Z)',
                block, flags=re.S
        ):
            n = int(m.group(1))
            body = " ".join(line.strip() for line in m.group(2).splitlines())
            out[n] = re.sub(r'\s+', ' ', body)

    return out


import re
from typing import Any, Dict, List

# in-text citation patterns
_SUP_TAG_RE = re.compile(r'<sup>(\d+)</sup>')
_SUP_UNI_RE = re.compile(r'([\u00B9\u00B2\u00B3\u2070\u2074-\u2079]+)')

# footnote definitions:
#  1) sup‐tagged at line start
#  2) bare leading number at line start
_FOOT_DEF_RE = re.compile(
    r'^(?:\s*<sup>(?P<sup1>\d+)</sup>\s*|'  # group "sup1"
    r'\s*(?P<sup2>\d+)\s+|'  # or group "sup2"
    r'\s*(?P<sup3>[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]{1,8})\s+)'  # Unicode superscript index
    r'(?P<text>.+)$',
    flags=re.M
)

# map Unicode superscript chars → digits
_SUP_MAP = {
    '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5',
    '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁰': '0'
}


def _uni_to_int(uni: str) -> int:
    return int(''.join(_SUP_MAP[c] for c in uni))


def sup_parser(md_text: str) -> Dict[str, Any]:
    # 1) build footnote map
    foot_map: Dict[int, str] = {}
    for m in _FOOT_DEF_RE.finditer(md_text):
        if m.group('sup3'):
            idx = _uni_to_int(m.group('sup3'))
        else:
            idx = int(m.group('sup1') or m.group('sup2'))
        foot_map[idx] = m.group('text').strip()

    # 2) find in-text citations
    results: List[Dict[str, Any]] = []
    # combined regex to catch either <sup>n</sup> or bare Unicode superscripts
    combined = re.compile(rf'(?:{_SUP_TAG_RE.pattern}|{_SUP_UNI_RE.pattern})')
    for m in combined.finditer(md_text):
        raw = m.group(0)
        if m.group(1):  # matched <sup>n</sup>
            idx = int(m.group(1))
        else:
            idx = _uni_to_int(m.group(2))
        if foot_map and idx not in foot_map:
            # Ignore superscript-like noise when we already know note indices.
            continue
        start = m.start()
        # capture up to 30 chars before, after last sentence boundary
        ctx = md_text[max(0, start - 30):start]
        if '.' in ctx:
            ctx = ctx.rsplit('.', 1)[-1].strip()
        results.append({
            "index": idx,
            "intext_citation": raw,
            "preceding_text": ctx,
            "footnote": foot_map.get(idx),
            "position": start
        })

    # 3) compute stats
    total_occurrences = len(results)
    success_occurrences = sum(1 for r in results if r["footnote"])
    unique_with_foot = {r["index"] for r in results if r["footnote"]}
    stats = {
        "intext_total": total_occurrences,
        "success_occurrences": success_occurrences,
        "success_unique": len(unique_with_foot),
        "bib_unique_total": len(foot_map),
        "occurrence_match_rate": (
            success_occurrences / total_occurrences
            if total_occurrences else 0.0
        ),
        "bib_coverage_rate": (
            len(unique_with_foot) / len(foot_map)
            if foot_map else 0.0
        ),
        "success_percentage": round(
            (success_occurrences / total_occurrences * 100)
            if total_occurrences else 0.0, 2
        ),
        "style": "superscript",
    }

    # 4) produce a “flat” version with all in-text tags and defs removed
    flat = _SUP_TAG_RE.sub('', md_text)
    flat = _SUP_UNI_RE.sub('', flat)
    flat = _FOOT_DEF_RE.sub('', flat)
    flat = re.sub(r'[ \t]+$', '', flat, flags=re.M)
    flat = re.sub(r'\n{3,}', '\n\n', flat).strip()

    return {
        "total": stats,
        "results": results,
        "flat_text": flat
    }


# =========================
# 6) Dispatcher
# =========================
# --------------------------------------------------
# 3. link_citations_to_footnotes – keep structure,
#    just replace the inner loop (lookup section)
# --------------------------------------------------
def link_citations_to_footnotes(text: str, refs_raw=None):
    """
    Unified orchestrator (NO regex/cleaner changes).
    - Always retrieves footnotes (items + in-text hits) into a dedicated `footnotes` bucket.
    - Runs all parsers in parallel:
        * TeX/superscript (or hybrid) -> `tex`
        * Numeric [n]                  -> `numeric`
        * Author–Year                  -> `author_year`
    - Returns combined structure with per-family stats/results and a top-level flat_text
      chosen from the detected dominant style.

    Output schema:
    {
      "style": <detected>,
      "flat_text": <flat text for detected style>,
      "footnotes": {
        "items": { "1": "...", "2": "...", ... },      # index → body (numeric keys only)
        "intext": [ {index, intext_citation, preceding_text, footnote?}, ... ],
        "stats": { ... }                                # coverage + success metrics
      },
      "tex":        {"total": {...}, "results": [...], "flat_text": "..."},
      "numeric":    {"total": {...}, "results": [...], "flat_text": "..."},
      "author_year":{"total": {...}, "results": [...], "flat_text": "..."}
    }
    """
    # 1) Detect dominant style (uses your existing detector)
    style = detect_citation_style(text) or "unknown"

    # 2) Always run all parsers (use safest fallbacks; do NOT alter regexes/cleaners)
    # TeX-family: prefer exact style, else still try a TeX-capable parser
    try:
        if style == STYLE_SUP:
            tex_out = sup_parser(text)
        elif style == STYLE_HYBRID:
            tex_out = hybrid_parser(text, references=refs_raw)
        else:
            # covers STYLE_TEX, legacy 'tex_superscript_1', and unknown — this is robust
            tex_out = tex_parser(text, refs_raw)
    except Exception:
        # guaranteed minimal shape on failure
        tex_out = {"total": {"intext_total": 0, "style": "tex_superscript"},
                   "results": [], "flat_text": make_flat_text(text, STYLE_TEX)}

    try:
        numeric_out = parse_numeric_intext_and_link(text, references=refs_raw)
    except Exception:
        numeric_out = {"total": {"intext_total": 0, "style": "numeric"},
                       "results": [], "flat_text": make_flat_text(text, STYLE_NUMERIC)}

    try:
        ay_out = author_year_parser(text, references=refs_raw)
    except Exception:
        ay_out = {"total": {"intext_total": 0, "style": "author_year"},
                  "results": [], "flat_text": make_flat_text(text, STYLE_AUTHOR)}

    # 3) Always build a dedicated footnotes bucket (index→body) + in-text TeX hits
    #    (rely ONLY on your existing extractors)
    items_union = {}
    try:
        items_union.update(extract_footnote_items_tex(text))
    except Exception:
        pass
    try:
        items_union.update(extract_footnote_items_tex_default_no_dots(text))
    except Exception:
        pass
    try:
        items_union.update(parse_footnotes_globally(text))
    except Exception:
        pass

    # Keep numeric indices only (normalize to str keys)
    foot_items = {str(k): v for k, v in items_union.items() if str(k).isdigit()}

    # In-text TeX superscript hits (outside any regex changes)
    try:
        intext_hits = extract_intext_citations_tex(text)
    except Exception:
        intext_hits = []

    # Attach resolved footnote text when available
    foot_results = []
    for h in intext_hits:
        idx = str(h.get("index", "")).strip()
        foot_results.append({
            "index": idx,
            "intext_citation": h.get("intext_citation"),
            "preceding_text": h.get("preceding_text"),
            "footnote": foot_items.get(idx)
        })

    # Footnote coverage stats
    foot_intext_total = len(foot_results)
    foot_success_occ = sum(1 for r in foot_results if r["footnote"])
    foot_success_unique = len({r["index"] for r in foot_results if r["footnote"]})
    foot_bib_total = len(foot_items)

    seen_idxs = {int(r["index"]) for r in foot_results if r["index"].isdigit()}
    max_seen = max(seen_idxs) if seen_idxs else 0
    expected_seq = set(range(1, max_seen)) if max_seen > 1 else set()
    missing_intext_seq = sorted(expected_seq - seen_idxs)

    missing_foot_for_seen = sorted(
        int(i) for i in {r["index"] for r in foot_results if r["index"].isdigit()}
        if str(i) not in foot_items
    )
    uncited_footnotes = sorted(
        int(k) for k in foot_items.keys() if k.isdigit() and int(k) not in seen_idxs
    )

    foot_stats = {
        "intext_total": foot_intext_total,
        "success_occurrences": foot_success_occ,
        "success_unique": foot_success_unique,
        "bib_unique_total": foot_bib_total,
        "occurrence_match_rate": (foot_success_occ / foot_intext_total) if foot_intext_total else 0.0,
        "bib_coverage_rate": (foot_success_unique / foot_bib_total) if foot_bib_total else 0.0,
        "success_percentage": round((foot_success_occ / foot_intext_total * 100.0) if foot_intext_total else 0.0, 2),
        "missing_intext_expected_total": len(missing_intext_seq),
        "missing_intext_indices": missing_intext_seq,
        "highest_intext_index": max_seen,
        "missing_footnotes_for_seen_total": len(missing_foot_for_seen),
        "missing_footnotes_for_seen_intext": missing_foot_for_seen,
        "uncited_footnote_total": len(uncited_footnotes),
        "uncited_footnote_indices": uncited_footnotes,
        "style": "footnotes",
    }

    # 4) Pick top-level style/flat_text, with fallback to best-performing bucket.
    bucket_out = {
        "tex": tex_out,
        "numeric": numeric_out,
        "author_year": ay_out,
    }

    def _succ(name: str) -> float:
        return float((bucket_out.get(name, {}).get("total", {}) or {}).get("success_occurrences", 0) or 0)

    def _intext(name: str) -> float:
        return float((bucket_out.get(name, {}).get("total", {}) or {}).get("intext_total", 0) or 0)

    def _bib(name: str) -> float:
        return float((bucket_out.get(name, {}).get("total", {}) or {}).get("bib_unique_total", 0) or 0)

    if style == STYLE_NUMERIC:
        selected_bucket = "numeric"
    elif style == STYLE_AUTHOR:
        selected_bucket = "author_year"
    elif style in (STYLE_TEX, STYLE_HYBRID, STYLE_SUP):
        selected_bucket = "tex"
    else:
        selected_bucket = max(
            ("tex", "numeric", "author_year"),
            key=lambda b: (_succ(b), _intext(b))
        )

    # If detected bucket has no successes, automatically fallback to best bucket.
    if _succ(selected_bucket) == 0:
        best_bucket = max(
            ("tex", "numeric", "author_year"),
            key=lambda b: (_succ(b), _intext(b))
        )
        if _succ(best_bucket) > 0:
            selected_bucket = best_bucket
            # expose the effective style for downstream consumers/reports
            if best_bucket == "numeric":
                style = STYLE_NUMERIC
            elif best_bucket == "author_year":
                style = STYLE_AUTHOR
            else:
                style = (tex_out.get("total", {}) or {}).get("style", style) or style
        else:
            # If nothing links anywhere, prefer the most conservative bucket
            # (fewest in-text detections) to avoid counting parser noise as failures.
            selected_bucket = min(
                ("tex", "numeric", "author_year"),
                key=lambda b: (_intext(b), -_bib(b))
            )
            if selected_bucket == "numeric":
                style = STYLE_NUMERIC
            elif selected_bucket == "author_year":
                style = STYLE_AUTHOR
            else:
                style = (tex_out.get("total", {}) or {}).get("style", style) or style

    if selected_bucket == "numeric":
        flat = numeric_out.get("flat_text", make_flat_text(text, STYLE_NUMERIC))
    elif selected_bucket == "author_year":
        flat = ay_out.get("flat_text", make_flat_text(text, STYLE_AUTHOR))
    else:
        flat = tex_out.get("flat_text", make_flat_text(text, STYLE_TEX))

    # 5) Return everything
    return {
        "style": style,
        "flat_text": flat,
        "footnotes": {
            "items": foot_items,  # {"1":"...", "2":"...", ...}
            "intext": foot_results,  # linked in-text superscripts (with resolved bodies when available)
            "stats": foot_stats
        },
        "tex": tex_out,  # TeX/superscript (or hybrid if detected)
        "numeric": numeric_out,  # [n]-style
        "author_year": ay_out  # (Author Year)-style
    }


# def link_citations_to_footnotes( text,refs_raw):
#
#
#
#
#     # ---------- helpers for flat_text ----------
#     CITATION_TEX_RE = re.compile(r'\$\s*\{\s*\}\s*\^\{\s*\d+\s*\}[^$]*\$', re.MULTILINE)
#     CITATION_NUMERIC_RE = re.compile(r'\[\s*\d+(?:\s*(?:[-–,]\s*\d+))*\s*\]', re.MULTILINE)
#     FOOTNOTE_BLOCK_ENTRY_RE = re.compile(r'^\[\^\d+\]:[^\n]*?(?:\n(?!\s*\n).*)*', re.MULTILINE)
#
#     # tolerant "outside-the-block" single-line footnote pattern
#     SECOND_PASS_RE = re.compile(r"""
#        ^\s*                                   # indentation
#        (?:[-*•]\s*)?                          # optional bullet
#        (?:\$\s*\{\s*\}\s*\^\{\d+\}\s*\$\s*)?  # optional pasted TeX superscript
#        (?P<idx>\d{1,4})                       # number
#        \s*(?:[.)]|[–—-])?\s+                  # delimiter
#        (?P<body>.+?)\s*$                      # entry body
#     """, re.VERBOSE | re.MULTILINE)
#
#     def first_footnote_block_span(txt):
#         """
#         Returns a (start, end) span that covers the main markdown footnote block(s).
#         Uses _footnote_block_spans(txt) if available; otherwise finds the first block.
#         """
#         try:
#             spans = _footnote_block_spans(txt)  # existing util in your module
#             if spans:
#                 # cover from first block start to last block end
#                 return spans[0][0], spans[-1][1]
#             return (0, 0)
#         except NameError:
#             m = re.search(r'^\[\^\d+\]:', txt, re.MULTILINE)
#             if not m:
#                 return (0, 0)
#             tail = txt[m.start():]
#             end_m = re.search(r'\n\s*\n', tail)
#             end = m.start() + (end_m.start() if end_m else len(tail))
#             return (m.start(), end)
#
#     def _remove_with_single_newline_guard(text_, pattern):
#         guard = re.compile('(?:' + pattern.pattern + r')(?:\n(?!\n))?', pattern.flags)
#         return guard.sub('', text_)
#
#     def _remove_intext_citations(text_, style_):
#         if style_ in ('tex_superscript', 'tex_default', 'default', 'STYLE_DEFAULT_LABEL'):
#             return _remove_with_single_newline_guard(text_, CITATION_TEX_RE)
#         elif style_ == 'numeric':
#             return _remove_with_single_newline_guard(text_, CITATION_NUMERIC_RE)
#         else:  # author_year
#             return _remove_with_single_newline_guard(text_, INTEXT_RE)  # uses your existing regex
#
#     def _remove_footnotes_everywhere(text_):
#         # 1) remove canonical [^n]: entries (each entry up to the next blank line)
#         t = _remove_with_single_newline_guard(text_, FOOTNOTE_BLOCK_ENTRY_RE)
#
#         # 2) guard the main block span (if any), then remove stray outside lines
#         b0, b1 = first_footnote_block_span(t)
#         if b1 > b0:
#             guarded = t[:b0] + ("\uFFFF" * (b1 - b0)) + t[b1:]
#         else:
#             guarded = t
#         removed_outside = SECOND_PASS_RE.sub(lambda m: '', guarded)
#
#         # 3) unguard and normalize spacing
#         removed = removed_outside.replace('\uFFFF', '')
#         removed = re.sub(r'[ \t]+$', '', removed, flags=re.MULTILINE)
#         removed = re.sub(r'\n{3,}', '\n\n', removed)
#         return removed.strip()
#
#     def make_flat_text(text_, style_):
#         t = _remove_intext_citations(text_, style_)
#         t = _remove_footnotes_everywhere(t)
#         return t
#
#     # ---------- main logic ----------
#     style = detect_citation_style(text)
#     # ---------- TeX-superscript (explicit label) ----------
#     if style == STYLE_SUP:
#         return sup_parser(text)
#     if style == "tex_superscript_1":
#         intexts = extract_intext_citations_tex(text)
#
#         # 1) BUILD THE PRIMARY MAP
#         items_primary = extract_footnote_items_tex(text)
#         items_primary.update(extract_footnote_items_tex_default_no_dots(text))
#
#         # ALSO harvest all numbered lines under the single [^0]: block
#         zero_block = re.search(r'\[\^0\]:\s*(.+?)(?=\n\[\^|\Z)', text, re.S)
#         if zero_block:
#             for num, body in re.findall(
#                     r'^\s*(\d{1,4})\s+(.*?)\s*(?=\n\s*\d{1,4}\s|\Z)',
#                     zero_block.group(1),
#                     re.M | re.S):
#                 items_primary[num] = body.strip()
#
#         # If we found *every* index that shows up in-text we're done.
#         missing = {hit["index"] for hit in intexts} - items_primary.keys()
#         if not missing:
#             return items_primary
#
#         # 2) SECOND–PASS SCAN  ––  look *outside* the block for stragglers
#         block_start, block_end = first_footnote_block_span(text)
#         guarded = text[:block_start] + ("\uFFFF" * (block_end - block_start)) + text[block_end:]
#
#         SECOND_PASS_RE = re.compile(r"""…""", re.VERBOSE | re.MULTILINE)
#         fallback_map = {
#             m["idx"]: m["body"].strip()
#             for m in SECOND_PASS_RE.finditer(guarded)
#             if m["idx"] in missing
#         }
#
#         foot_map = {**fallback_map, **items_primary}
#
#         # fallback for very-early citations with no prior period
#         def get_preceding(ctx):
#             if not ctx or '.' not in ctx:
#                 return ctx.strip()[-30:].lstrip()
#             return ctx.rsplit('.', 1)[-1].strip()
#
#         results = []
#         for it in intexts:
#             idx = it["index"]
#             pre = it["preceding_text"] or get_preceding(it.get("_ctx_raw", ""))
#             results.append({
#                 "index": idx,
#                 "intext_citation": it["intext_citation"],
#                 "preceding_text": pre,
#                 "footnote": foot_map.get(idx),
#             })
#
#         total = len(results)
#         success_occ = sum(1 for r in results if r["footnote"])
#         success_uniq = len({r["index"] for r in results if r["footnote"]})
#         bib_total = len(foot_map)
#
#         stats = {
#             "intext_total": total,
#             "success_occurrences": success_occ,
#             "success_unique": success_uniq,
#             "bib_unique_total": bib_total,
#             "occurrence_match_rate": success_occ / total if total else 0.0,
#             "bib_coverage_rate": success_uniq / bib_total if bib_total else 0.0,
#             "success_percentage": round((success_occ / total * 100.0) if total else 0.0, 2),
#             "style": "tex_superscript",
#         }
#         flat_text = make_flat_text(text, style)
#         return {"total": stats, "results": results, "flat_text": flat_text}
#
#     # ---------- TeX-superscript (default label) ----------
#     if style == STYLE_TEX   :
#         return tex_parser(text,refs_raw)
#         # Author–Year
#     if style == STYLE_AUTHOR:
#         return author_year_parser(text,references=refs_raw)
#     # ---------- Numeric ([n]) ----------
#     if style == STYLE_NUMERIC:
#         return parse_numeric_intext_and_link(text, references=refs_raw)
#
#     # ---------- Author–Year ----------
#     # NB: skip AY matches that live inside footnote blocks
#     refs_text = pick_references_block(refs_raw)
#     ay_map_dict = parse_bibliography_author_year_from_block(refs_text)
#     ay_map = {f"{a}|{y}": entry for (a, y), entry in ay_map_dict.items()}
#
#     bib_entries = [
#         {
#             "entry": entry,
#             "entry_norm": re.sub(r"\s+", " ", entry).lower(),
#             "entry_key": _norm_key(entry),
#         }
#         for (a, y), entry in ay_map_dict.items()
#     ]
#
#     block_spans = _footnote_block_spans(text)
#
#     results = []
#     for m in INTEXT_RE.finditer(text):
#         if _inside_any(m.start(), block_spans):
#             continue  # ignore citations inside footnote blocks
#
#         key = intext_key(m)
#         foot = ay_map.get(key) if key else None
#
#         # Fallback: presence-based match
#         authors, year = ([], None)
#         if not foot:
#             authors, year = parse_intext_authors_year(m.group(0))
#             foot = find_entry_by_presence(authors, year, refs_text)
#
#         results.append({
#             "index": key or (f"{_norm_key(authors[0])}|{year}" if authors else ""),
#             "intext_citation": m.group(0),
#             "preceding_text": text[:m.start()].rsplit('.', 1)[-1].strip(),
#             "footnote": foot
#         })
#
#     intext_total = len(results)
#     success_occurrences = sum(1 for r in results if r["footnote"])
#     success_unique = len({r["index"] for r in results if r["footnote"]})
#     bib_unique_total = len(ay_map)
#
#     stats = {
#         "intext_total": intext_total,
#         "success_occurrences": success_occurrences,
#         "success_unique": success_unique,
#         "bib_unique_total": bib_unique_total,
#         "occurrence_match_rate": success_occurrences / intext_total if intext_total else 0.0,
#         "bib_coverage_rate": success_unique / bib_unique_total if bib_unique_total else 0.0,
#         "success_percentage": round((success_occurrences / intext_total * 100.0) if intext_total else 0.0, 2),
#         "style": "author_year",
#     }
#     flat_text = make_flat_text(text, style)
#     return {"total": stats, "results": results, "flat_text": flat_text}


"""1.
[^0]
[^0]:    75 Ibid 35 (Rule 7 [3]).
    76 Ibid 34 (Rule 7).
    77 Tadic (International Criminal Tribunal for the Former Yugoslavia, Appeals Chamber, Case No IT-94-1-A, 15 July 1999) [145].
    78 Schmitt, above n 1, 81 (Rule 22, [6]).
    79 Ibid.
    80 Nicaragua [1986] ICJ Rep 14, 62 [110].




    """





