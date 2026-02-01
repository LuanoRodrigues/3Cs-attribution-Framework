#search_engine_front.py
import csv, hashlib ,  os, sys

from PyQt6.QtCore import QCoreApplication, Qt

QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_UseSoftwareOpenGL, True)
QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts, True)
def _dbg_preview_record(rec: dict, label: str = "RECORD"):
    """
    Print a stable preview of a paper record for debugging.
    """
    if not isinstance(rec, dict):
        print(f"[{label}] not a dict: {type(rec)}", flush=True)
        return

    keys = [
        "title", "authors", "year", "venue", "doi", "url",
        "source", "external_id", "pdf_url", "oa_status",
        "abstract",
    ]
    print(f"\n[{label}] keys={sorted(rec.keys())}", flush=True)

    for k in keys:
        v = rec.get(k)
        if k == "abstract":
            if isinstance(v, str):
                v2 = (v[:240] + "…") if len(v) > 240 else v
                print(f"[{label}] {k}({len(v)} chars): {v2!r}", flush=True)
            else:
                print(f"[{label}] {k}: {v!r}", flush=True)
        else:
            print(f"[{label}] {k}: {v!r}", flush=True)

def _dbg_preview_graph_seed(seed_input: str, rec: dict):
    print("\n[GRAPH_SEED] seed_input=", repr(seed_input), flush=True)
    _dbg_preview_record(rec, "GRAPH_SEED_RECORD")

def setup_crash_logging(app_dir):
    import faulthandler
    import io
    import os
    import sys
    import time
    import traceback

    crash_dir = app_dir
    crash_dir.mkdir(parents=True, exist_ok=True)

    ts = time.strftime("%Y%m%d-%H%M%S")
    crash_log_path = crash_dir / f"crash-{ts}.log"

    f = open(crash_log_path, "a", encoding="utf-8", buffering=1)

    class _Tee(io.TextIOBase):
        def __init__(self, *streams):
            self._streams = [s for s in streams if s is not None]

        def write(self, s):
            for st in self._streams:
                st.write(s)
                st.flush()
            return len(s)

        def flush(self):
            for st in self._streams:
                st.flush()

    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = _Tee(old_out, f)
    sys.stderr = _Tee(old_err, f)

    faulthandler.enable(file=f, all_threads=True)

    def _excepthook(exc_type, exc, tb):
        traceback.print_exception(exc_type, exc, tb, file=sys.stderr)
        try:
            sys.stderr.flush()
            f.flush()
        except Exception:
            pass

    sys.excepthook = _excepthook

    os.environ["CRASH_LOG_PATH"] = str(crash_log_path)
    print(f"CRASH_LOG_PATH={crash_log_path}", flush=True)
    print(f"[ScholarDesk] Crash log (copy this): {crash_log_path}", flush=True)

    return crash_log_path, f


from PyQt6.QtCore import QDateTime, QSortFilterProxyModel






from PyQt6.QtGui import QAction, QDesktopServices, QFont, QKeySequence
from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest, QNetworkProxy
from PyQt6.QtSql import QSqlDatabase, QSqlQuery, QSqlTableModel
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDockWidget,
    QFormLayout,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLineEdit,
    QMainWindow,
    QPushButton,
    QSpinBox,
    QSplitter,
    QStatusBar,
    QTabWidget,
    QTableView,
    QTextBrowser,
    QToolBar,
    QWidget,
    QProgressBar,
    QMenu,
    QInputDialog, )


import openpyxl
APP_NAME = "ScholarDesk"
DB_FILENAME = "scholardesk.sqlite3"
ENV_FILENAME = ".env"
def load_env(env_path):
    """
    ###1. resolve candidate .env locations
    ###2. parse KEY=VALUE
    ###3. return dict + path used
    """
    candidates = []
    p = Path(env_path)

    candidates.append(p)
    candidates.append(Path.cwd() / p.name)

    script_dir = Path(__file__).resolve().parent
    candidates.append(script_dir / p.name)
    candidates.append(script_dir.parent / p.name)
    candidates.append(script_dir.parent.parent / p.name)

    chosen = None
    for c in candidates:
        if c.exists() and c.is_file():
            chosen = c
            break

    env = {}
    if not chosen:
        return env, None

    for raw in chosen.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        env[k] = v

    return env, str(chosen)



def mask_key(s):
    if not s:
        return ""
    if len(s) <= 6:
        return "*" * len(s)
    return s[:3] + "*" * (len(s) - 6) + s[-3:]


def ensure_app_dir():
    """
    ###1. pick per-user app dir
    ###2. create it
    """
    base = Path.home() / f".{APP_NAME.lower()}"
    base.mkdir(parents=True, exist_ok=True)
    return base

def init_db(db_path):
    """
    ###1. open sqlite
    ###2. create tables
    ###3. return QSqlDatabase
    """
    db = QSqlDatabase.addDatabase("QSQLITE")
    db.setDatabaseName(str(db_path))
    ok = db.open()

    q = QSqlQuery()
    q.exec(
        """
        CREATE TABLE IF NOT EXISTS papers
        (
            id
            INTEGER
            PRIMARY
            KEY
            AUTOINCREMENT,
            title
            TEXT,
            authors
            TEXT,
            year
            INTEGER,
            venue
            TEXT,
            doi
            TEXT,
            url
            TEXT,
            abstract
            TEXT,
            source
            TEXT,
            external_id
            TEXT,
            pdf_url
            TEXT,
            oa_status
            TEXT,
            created_at
            TEXT
        )
        """
    )
    q.exec("CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi)")
    q.exec("CREATE INDEX IF NOT EXISTS idx_papers_title ON papers(title)")
    q.exec("CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year)")

    q.exec(
        """
        CREATE TABLE IF NOT EXISTS tags
        (
            id
            INTEGER
            PRIMARY
            KEY
            AUTOINCREMENT,
            name
            TEXT
            UNIQUE
        )
        """
    )
    q.exec(
        """
        CREATE TABLE IF NOT EXISTS paper_tags
        (
            paper_id
            INTEGER,
            tag_id
            INTEGER,
            UNIQUE
        (
            paper_id,
            tag_id
        )
            )
        """
    )

    q.exec(
        """
        CREATE TABLE IF NOT EXISTS request_cache
        (
            cache_key
            TEXT
            PRIMARY
            KEY,
            provider
            TEXT,
            url
            TEXT,
            response_json
            TEXT,
            created_at
            TEXT
        )
        """
    )
    q.exec("CREATE INDEX IF NOT EXISTS idx_request_cache_provider ON request_cache(provider)")
    q.exec("CREATE INDEX IF NOT EXISTS idx_request_cache_created_at ON request_cache(created_at)")

    q.exec(
        """
        CREATE TABLE IF NOT EXISTS workspace_tabs
        (
            tab_id
            TEXT
            PRIMARY
            KEY,
            title
            TEXT,
            config_json
            TEXT,
            results_json
            TEXT,
            created_at
            TEXT,
            updated_at
            TEXT
        )
        """
    )
    q.exec("CREATE INDEX IF NOT EXISTS idx_workspace_tabs_updated_at ON workspace_tabs(updated_at)")

    return db, ok

def normalize_doi(s):
    if not s:
        return ""
    s = s.strip()
    s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s, flags=re.I)
    s = s.strip()
    return s


def now_iso():
    return QDateTime.currentDateTime().toString(Qt.DateFormat.ISODate)

from PyQt6.QtCore import QUrlQuery
def qurl_with_query(base, params):
    """
    ###1. build url + query
    ###2. force percent-encoding
    ###3. return QUrl
    """
    u = QUrl(base)
    q = QUrlQuery()
    for k, v in (params or {}).items():
        if v is None:
            continue
        if isinstance(v, bool):
            v = "true" if v else "false"
        else:
            v = str(v)
        # FIXED: Removed .replace(" ", "+"). Qt handles encoding automatically.
        q.addQueryItem(str(k), v)
    u.setQuery(q)
    return QUrl.fromEncoded(u.toEncoded())

def safe_int(x, default=0):
    if x is None:
        return default
    if isinstance(x, int):
        return x
    if isinstance(x, str) and x.strip().isdigit():
        return int(x.strip())
    return default


def authors_to_str(auth_list):
    if not auth_list:
        return ""
    if isinstance(auth_list, str):
        return auth_list
    out = []
    for a in auth_list:
        if isinstance(a, str):
            out.append(a)
        elif isinstance(a, dict):
            n = a.get("name") or a.get("family") or ""
            g = a.get("given") or ""
            n = (g + " " + n).strip() if g else n.strip()
            if n:
                out.append(n)
    return ", ".join([x for x in out if x])


def bibtex_key_from(title, year, authors):
    a = authors.split(",")[0].strip() if authors else "anon"
    a = re.sub(r"[^A-Za-z0-9]+", "", a) or "anon"
    y = str(year) if year else "nd"
    t = re.sub(r"[^A-Za-z0-9]+", "", (title or "")[:16]) or "paper"
    return f"{a}{y}{t}"


def to_bibtex(record):
    title = (record.get("title") or "").replace("{", "").replace("}", "")
    authors = record.get("authors") or ""
    year = record.get("year") or ""
    venue = record.get("venue") or ""
    doi = record.get("doi") or ""
    url = record.get("url") or ""
    key = bibtex_key_from(title, year, authors)
    lines = []
    lines.append(f"@article{{{key},")
    if title:
        lines.append(f"  title = {{{title}}},")
    if authors:
        lines.append(f"  author = {{{authors}}},")
    if venue:
        lines.append(f"  journal = {{{venue}}},")
    if year:
        lines.append(f"  year = {{{year}}},")
    if doi:
        lines.append(f"  doi = {{{doi}}},")
    if url:
        lines.append(f"  url = {{{url}}},")
    lines.append("}")
    return "\n".join(lines)


def sql_exec(query_text, binds):
    q = QSqlQuery()
    q.prepare(query_text)
    for k, v in (binds or {}).items():
        name = k if isinstance(k, str) else str(k)
        if name and not name.startswith(":"):
            name = ":" + name
        q.bindValue(name, v)
    ok = q.exec()
    return q, ok



def sql_scalar(query_text, binds):
    q, ok = sql_exec(query_text, binds)
    if not ok:
        return None
    if q.next():
        return q.value(0)
    return None


def paper_exists_by_doi_or_external(doi, source, external_id):
    doi = normalize_doi(doi)
    if doi:
        n = sql_scalar("SELECT COUNT(1) FROM papers WHERE doi = :doi", {"doi": doi})
        return safe_int(n) > 0
    if source and external_id:
        n = sql_scalar(
            "SELECT COUNT(1) FROM papers WHERE source = :s AND external_id = :e",
            {"s": source, "e": external_id},
        )
        return safe_int(n) > 0
    return False


def insert_paper(record):
    doi = normalize_doi(record.get("doi") or "")
    source = record.get("source") or ""
    external_id = record.get("external_id") or ""
    if paper_exists_by_doi_or_external(doi, source, external_id):
        return False

    q, ok = sql_exec(
        """
        INSERT INTO papers (title, authors, year, venue, doi, url, abstract, source, external_id, pdf_url, oa_status, created_at)
        VALUES (:title, :authors, :year, :venue, :doi, :url, :abstract, :source, :external_id, :pdf_url, :oa_status, :created_at)
        """,
        {
            "title": record.get("title") or "",
            "authors": record.get("authors") or "",
            "year": record.get("year"),
            "venue": record.get("venue") or "",
            "doi": doi,
            "url": record.get("url") or "",
            "abstract": record.get("abstract") or "",
            "source": source,
            "external_id": external_id,
            "pdf_url": record.get("pdf_url") or "",
            "oa_status": record.get("oa_status") or "",
            "created_at": now_iso(),
        },
    )
    return ok


def update_oa_by_doi(doi, oa_status, pdf_url):
    doi = normalize_doi(doi)
    if not doi:
        return False
    q, ok = sql_exec(
        "UPDATE papers SET oa_status = :s, pdf_url = :p WHERE doi = :d",
        {"s": oa_status or "", "p": pdf_url or "", "d": doi},
    )
    return ok

def record_to_graph_seed_node(rec: dict) -> dict:
    """
    Convert a search-engine record into the node.data shape expected by graph_view.html.
    Ensures authors are BOTH:
      - authors: list[{"name": "..."}]  (SemanticScholar-like)
      - authors_str: "A, B, C"          (easy UI display)
    """
    def _authors_list_from_any(x):
        if not x:
            return []
        if isinstance(x, list):
            out = []
            for a in x:
                if isinstance(a, str) and a.strip():
                    out.append({"name": a.strip()})
                elif isinstance(a, dict):
                    nm = (a.get("name") or "").strip()
                    if not nm:
                        g = (a.get("given") or "").strip()
                        f = (a.get("family") or "").strip()
                        nm = (g + " " + f).strip()
                    if nm:
                        out.append({"name": nm})
            return out

        # string case: "A, B, C"
        if isinstance(x, str):
            parts = [p.strip() for p in x.split(",") if p.strip()]
            return [{"name": p} for p in parts]

        return []

    def _authors_str(x):
        if not x:
            return ""
        if isinstance(x, str):
            return x.strip()
        if isinstance(x, list):
            names = []
            for a in x:
                if isinstance(a, str) and a.strip():
                    names.append(a.strip())
                elif isinstance(a, dict):
                    nm = (a.get("name") or "").strip()
                    if not nm:
                        g = (a.get("given") or "").strip()
                        f = (a.get("family") or "").strip()
                        nm = (g + " " + f).strip()
                    if nm:
                        names.append(nm)
            return ", ".join(names)
        return str(x)

    paper_id = (rec.get("paperId") or rec.get("external_id") or "").strip()
    doi = (rec.get("doi") or "").strip()
    url = (rec.get("url") or "").strip()

    node_id = paper_id or (("DOI:" + doi) if doi else "") or url or (rec.get("title") or "seed")

    authors_list = _authors_list_from_any(rec.get("authors"))
    authors_str = _authors_str(rec.get("authors"))

    data = {
        "id": str(node_id),
        "label": (rec.get("title") or "").strip() or str(node_id),
        "title": (rec.get("title") or "").strip(),
        "authors": authors_list,          # IMPORTANT: list-of-dicts
        "authors_str": authors_str,       # IMPORTANT: keep the full string too
        "year": rec.get("year"),
        "venue": (rec.get("venue") or "").strip(),
        "doi": doi,
        "url": url,
        "abstract": (rec.get("abstract") or "").strip(),
        "citations": int(rec.get("citations") or 0),
        "source": (rec.get("source") or "").strip(),
        "external_id": (rec.get("external_id") or "").strip(),
        "pdf_url": (rec.get("pdf_url") or "").strip(),
        "oa_status": (rec.get("oa_status") or "").strip(),
    }

    # cytoscape node wrapper
    return {"data": data}

def format_authors_list(auth_list, key_name="display_name"):
    """Return a comma-separated author string."""
    if not isinstance(auth_list, list):
        return ""
    out = []
    for a in auth_list:
        if isinstance(a, dict):
            name = (a.get(key_name) or "").strip()
            if name:
                out.append(name)
    return ", ".join(out)


def normalize_external_ids(id_obj):
    """Common external ID extraction (DOI, etc.)."""
    if not isinstance(id_obj, dict):
        return ""
    doi = id_obj.get("doi") or id_obj.get("DOI") or ""
    return str(doi).strip()

def parse_crossref(data):
    items = []
    total = 0
    next_offset = None

    if not isinstance(data, dict):
        return [], 0, None

    message = data.get("message") or {}
    items_list = message.get("items") or []
    total = int(message.get("total-results") or 0)

    # Simple offset pagination:
    if "offset" in message and "rows" in message:
        offset = message.get("offset") or 0
        rows = message.get("rows") or 0
        next_offset = offset + rows if items_list else None

    for p in items_list:
        if not isinstance(p, dict):
            continue

        # Authors
        authors = []
        for a in p.get("author") or []:
            given = a.get("given") or ""
            family = a.get("family") or ""
            name = " ".join([x for x in (given, family) if x])
            if name:
                authors.append(name)

        doi = (p.get("DOI") or "").strip()

        rec = {
            "title": (p.get("title")[0] if isinstance(p.get("title"), list) and p.get("title") else "").strip(),
            "authors": ", ".join(authors),
            "year": p.get("issued", {}).get("date-parts", [[None]])[0][0] or 0,
            "venue": (p.get("container-title")[0] if isinstance(p.get("container-title"), list) and p.get("container-title") else "").strip(),
            "doi": doi,
            "url": (p.get("URL") or "").strip(),
            "abstract": (p.get("abstract") or "").strip(),
            "source": "crossref",
            "external_id": doi,
            # Crossref-specific metrics
            "crossref_type": p.get("type"),
            "crossref_publisher": (p.get("publisher") or "").strip(),
            "crossref_license": p.get("license") or [],
            "crossref_funder": p.get("funder") or [],
            "crossref_reference_count": int(p.get("reference-count") or 0),
        }
        items.append(rec)

    return items, total, next_offset

def parse_elsevier(payload):
    root = payload or {}
    sr = root.get("search-results") or {}
    entries = sr.get("entry") or []
    if isinstance(entries, dict):
        entries = [entries]
    if not isinstance(entries, list):
        entries = []

    def pick_url(e):
        links = e.get("link") or []
        if isinstance(links, dict):
            links = [links]
        if not isinstance(links, list):
            links = []
        for ref in ("scidir", "scopus", "self"):
            for L in links:
                if not isinstance(L, dict):
                    continue
                if (L.get("@ref") or "").strip().lower() == ref:
                    href = (L.get("@href") or "").strip()
                    if href:
                        return href
        u = (e.get("prism:url") or "").strip()
        return u

    out = []
    for e in entries:
        if not isinstance(e, dict):
            continue

        title = (e.get("dc:title") or "").strip()
        cover = (e.get("prism:coverDate") or "").strip()
        year = safe_int(cover[:4], None) if cover else None
        venue = (e.get("prism:publicationName") or "").strip()
        doi = (e.get("prism:doi") or "").strip()
        url = pick_url(e)

        auth = (e.get("dc:creator") or "").strip()
        abstract = (e.get("dc:description") or "").strip()

        eid = (e.get("eid") or "").strip()
        ident = (e.get("dc:identifier") or "").strip()
        ext = eid or ident or doi or url

        out.append(
            {
                "title": title,
                "authors": auth,
                "year": year,
                "venue": venue,
                "doi": doi,
                "url": url,
                "abstract": abstract,
                "source": "elsevier",
                "external_id": ext,
                "pdf_url": "",
                "oa_status": "",
            }
        )

    total = safe_int(sr.get("opensearch:totalResults"), 0)
    return out, total, None
def openalex_abstract_from_inverted(inv):
    if not isinstance(inv, dict) or not inv:
        return ""
    pairs = []
    for word, positions in inv.items():
        if not isinstance(word, str):
            continue
        if not isinstance(positions, list):
            continue
        for p in positions:
            if isinstance(p, int) and p >= 0:
                pairs.append((p, word))
    if not pairs:
        return ""
    pairs.sort(key=lambda x: x[0])
    return " ".join([w for _, w in pairs]).strip()
def parse_openalex(data):
    """
    OpenAlex search response parser.

    Returns:
      items: list[dict]
      total: int
      next_cursor: str|None
    """
    import re

    def _as_str(x):
        return "" if x is None else str(x)

    def _strip(s):
        return _as_str(s).strip()

    def _norm_doi(doi_val: str) -> str:
        s = _strip(doi_val)
        if not s:
            return ""
        s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s, flags=re.I).strip()
        return s

    def _rebuild_abstract(inv):
        """
        OpenAlex: abstract_inverted_index is {word: [positions...]}
        Rebuild into a plain string by placing each word at its positions.
        """
        if not isinstance(inv, dict) or not inv:
            return ""
        try:
            max_pos = -1
            for w, poses in inv.items():
                if not poses:
                    continue
                for p in poses:
                    if isinstance(p, int) and p > max_pos:
                        max_pos = p
            if max_pos < 0:
                return ""

            words = [""] * (max_pos + 1)
            for w, poses in inv.items():
                if not w or not isinstance(poses, list):
                    continue
                w_clean = _strip(w)
                if not w_clean:
                    continue
                for p in poses:
                    if isinstance(p, int) and 0 <= p <= max_pos:
                        words[p] = w_clean

            # remove blanks + join
            out = " ".join([w for w in words if w])
            return out.strip()
        except Exception:
            return ""

    def _pick_pdf_url(p):
        """
        Try several OpenAlex locations for best PDF.
        """
        if not isinstance(p, dict):
            return ""

        # newer-ish structure: open_access + locations
        oa = p.get("open_access") if isinstance(p.get("open_access"), dict) else {}
        if isinstance(oa, dict):
            # sometimes has oa_url / any repo URL, rarely direct pdf_url
            pdf = _strip(oa.get("pdf_url"))
            if pdf:
                return pdf

        best = p.get("best_oa_location")
        if isinstance(best, dict):
            pdf = _strip(best.get("pdf_url"))
            if pdf:
                return pdf
            url = _strip(best.get("landing_page_url"))
            if url:
                return url

        prim = p.get("primary_location")
        if isinstance(prim, dict):
            pdf = _strip(prim.get("pdf_url"))
            if pdf:
                return pdf
            src = prim.get("source") if isinstance(prim.get("source"), dict) else {}
            # landing page sometimes present
            lp = _strip(prim.get("landing_page_url"))
            if lp:
                return lp

        # locations list (common)
        locs = p.get("locations")
        if isinstance(locs, list):
            for loc in locs:
                if not isinstance(loc, dict):
                    continue
                pdf = _strip(loc.get("pdf_url"))
                if pdf:
                    return pdf
                lp = _strip(loc.get("landing_page_url"))
                if lp:
                    return lp

        return ""

    items = []
    total = 0
    next_cursor = None

    if not isinstance(data, dict):
        return [], 0, None

    rows = data.get("results") or []
    meta = data.get("meta") or {}
    try:
        total = int(meta.get("count") or 0)
    except Exception:
        total = 0

    next_cursor = meta.get("next_cursor")

    for p in rows:
        if not isinstance(p, dict):
            continue

        work_id = _strip(p.get("id"))
        title = _strip(p.get("display_name"))
        year = p.get("publication_year") or 0

        doi = _norm_doi(p.get("doi"))
        url = ""
        if doi:
            url = f"https://doi.org/{doi}"
        else:
            # OpenAlex has a work "id" URL; keep as fallback if no DOI
            url = _strip(p.get("id"))

        # venue: host_venue.display_name
        venue = ""
        hv = p.get("host_venue")
        if isinstance(hv, dict):
            venue = _strip(hv.get("display_name"))

        # authors: from authorships[].author.display_name
        authors = []
        auths = p.get("authorships") or []
        if isinstance(auths, list):
            for a in auths:
                if not isinstance(a, dict):
                    continue
                au = a.get("author")
                if isinstance(au, dict):
                    nm = _strip(au.get("display_name"))
                    if nm:
                        authors.append(nm)

        # abstract
        abstract = _rebuild_abstract(p.get("abstract_inverted_index"))

        # OA flags + pdf candidates
        is_oa = bool(p.get("is_oa")) if p.get("is_oa") is not None else False
        open_access_pdf = _pick_pdf_url(p)

        cited_by = 0
        try:
            cited_by = int(p.get("cited_by_count") or 0)
        except Exception:
            cited_by = 0

        rec = {
            # common
            "title": title,
            "authors": ", ".join(authors),
            "year": year,
            "venue": venue,
            "doi": doi,
            "url": url,
            "abstract": abstract,
            "source": "openalex",
            "external_id": work_id,

            # cross-provider compatibility (graph expects 'citations' commonly)
            "citations": cited_by,

            # OpenAlex-specific fields you listed
            "oa_status": is_oa,
            "open_access_pdf": open_access_pdf,
            "openalex_cited_by_count": cited_by,
            "openalex_authorships": p.get("authorships") or [],
            "openalex_primary_location": p.get("primary_location") or {},
            "openalex_x_concepts": p.get("x_concepts") or [],
        }

        items.append(rec)

    return items, total, next_cursor




def parse_unpaywall(payload):
    doi = payload.get("doi") or ""
    is_oa = payload.get("is_oa")
    oa_status = payload.get("oa_status") or ("open" if is_oa else "closed")
    best = payload.get("best_oa_location") or {}
    pdf = best.get("url_for_pdf") or best.get("url") or ""
    return normalize_doi(doi), oa_status, pdf

" E2P6bzkS4R3U3FqqqQkehay6N9EsfVaM8aFXtb2A"
def parse_wos_starter(payload):
    root = payload if isinstance(payload, dict) else {}
    hits = root.get("hits") or []
    if isinstance(hits, dict):
        hits = [hits]
    if not isinstance(hits, list):
        hits = []

    out = []
    for h in hits:
        if not isinstance(h, dict):
            continue

        title = (h.get("title") or "").strip()
        uid = (h.get("uid") or "").strip()

        src = h.get("source") or {}
        venue = ""
        year = None
        url = ""
        doi = ""

        if isinstance(src, dict):
            venue = (src.get("sourceTitle") or "").strip()
            year = safe_int(src.get("publishYear"), None)

        links = h.get("links") or []
        if isinstance(links, dict):
            links = [links]
        if isinstance(links, list):
            for L in links:
                if not isinstance(L, dict):
                    continue
                href = (L.get("url") or L.get("link") or "").strip()
                if href:
                    url = href
                    break

        ids = h.get("identifiers") or {}
        if isinstance(ids, dict):
            doi = (ids.get("doi") or ids.get("DOI") or "").strip()

        names = h.get("names") or {}
        authors = ""
        if isinstance(names, dict):
            a = names.get("authors") or []
            if isinstance(a, dict):
                a = [a]
            if isinstance(a, list):
                parts = []
                for it in a:
                    if not isinstance(it, dict):
                        continue
                    nm = (it.get("displayName") or it.get("wosStandard") or "").strip()
                    if nm:
                        parts.append(nm)
                authors = ", ".join(parts)

        abstract = ""
        out.append(
            {
                "title": title,
                "authors": authors,
                "year": year,
                "venue": venue,
                "doi": doi,
                "url": url,
                "abstract": abstract,
                "source": "wos",
                "external_id": uid or doi or url,
                "pdf_url": "",
                "oa_status": "",
            }
        )

    meta = root.get("metadata") or {}
    total = safe_int(meta.get("total"), 0) if isinstance(meta, dict) else 0
    page = safe_int(meta.get("page"), 1) if isinstance(meta, dict) else 1
    limit = safe_int(meta.get("limit"), 0) if isinstance(meta, dict) else 0
    next_page = (page + 1) if (limit and (page * limit) < total) else None

    return out, total, next_page
PROVIDER_CAPS = {
"cos": {
    "label": "COS (Crossref + OpenAlex + Semantic)",
    "operators": "Uses each provider’s native behaviour; results merged and deduplicated by DOI else title+year.",
    "remote_filters": [
        "Crossref: from-pub-date/until-pub-date",
        "OpenAlex: from_publication_date/to_publication_date",
        "Semantic Scholar: year=YYYY-YYYY",
    ],
    "local_filters": [
        "dedupe/merge by DOI else title+year",
        "any existing local filters you already apply",
    ],
    "examples": [
        {
            "title": "Example — merged search",
            "query": '"cyber attribution" deception',
            "remote": "Queries each provider separately; merges results",
            "local": "Duplicates merged; missing fields filled where possible",
        }
    ],
    "filter_notes": [
        "Best for coverage; metadata quality varies by provider.",
    ],
},

    "semantic_scholar": {
        "label": "Semantic Scholar",
        "operators": "Plain text + quotes. AND/OR/() are treated as text (no boolean parsing).",
        "remote_filters": [
            "year_range via year=YYYY-YYYY",
            "limit/offset pagination",
        ],
        "local_filters": [
            "author contains",
            "venue contains",
            "only with DOI",
            "only with abstract",
            "year from/to (extra local check)",
        ],
        "examples": [
            {
                "title": "Example 1 — cyber attribution (phrase + simple terms)",
                "query": '"cyber attribution" false flag',
                "remote": "Year from/to uses Semantic Scholar year=YYYY-YYYY",
                "local": "Use local Author/Venue/DOI/Abstract filters if needed",
            },
            {
                "title": "Example 2 — nesting shown, but treated as literal text",
                "query": '("cyber attribution" AND (APT OR "false flag"))',
                "remote": "Parentheses/AND/OR are NOT interpreted as boolean",
                "local": "If you need boolean-like precision, narrow with local filters",
            },
            {
                "title": "Example 3 — combined (query + years + local filters)",
                "query": '"attribution" "zero knowledge" ANDPT',
                "remote": "Set Year from=2016, Year to=2025 in UI (sent as year=2016-2025)",
                "local": "Author contains=clark; Only with DOI=on; Only with abstract=on",
            },
        ],
        "filter_notes": [
            "Remote years: Yes (year=YYYY-YYYY).",
            "Remote author/venue/DOI filters: No (use local filters).",
            "Boolean operators: No (treated as text).",
        ],
    },
    "semantic_scholar_bulk": {
        "label": "Semantic Scholar (Bulk)",
        "operators": "Plain text + quotes. AND/OR/() are treated as text (no boolean parsing).",
        "remote_filters": [
            "year_range via year=YYYY-YYYY",
            "cursor token pagination (token=...)",
        ],
        "local_filters": [
            "author contains",
            "venue contains",
            "only with DOI",
            "only with abstract",
            "year from/to (extra local check)",
        ],
        "examples": [
            {
                "title": "Example 1 — cyber attribution (phrase + qualifiers)",
                "query": '"cyber attribution" deception',
                "remote": "Year from/to is sent as year=YYYY-YYYY",
                "local": "Apply DOI/Abstract/Author/Venue locally",
            },
            {
                "title": "Example 2 — nesting shown, but treated as literal text",
                "query": '("cyber attribution" AND (deception OR "false flag"))',
                "remote": "No boolean parsing; bulk endpoint returns via token cursor",
                "local": "Use local filters for precision",
            },
            {
                "title": "Example 3 — combined",
                "query": '"attribution" "international relations" (AND OR NOT)',
                "remote": "Year from=2010, Year to=2025 in UI",
                "local": "Venue contains=security; Only with abstract=on",
            },
        ],
        "filter_notes": [
            "Remote years: Yes (year=YYYY-YYYY).",
            "Remote boolean: No.",
            "Remote author/venue: No (local only).",
        ],
    },
    "crossref": {
        "label": "Crossref",
        "operators": "No reliable boolean. AND/OR/() are treated as text. Quotes help for phrases.",
        "remote_filters": [
            "from-pub-date:YYYY-01-01 / until-pub-date:YYYY-12-31 (via filter=...)",
            "rows/offset pagination",
            "sort/order (limited)",
        ],
        "local_filters": [
            "author contains",
            "venue contains",
            "only with DOI",
            "only with abstract (often sparse in Crossref)",
            "year from/to (extra local check)",
        ],
        "examples": [
            {
                "title": "Example 1 — cyber attribution (phrase + keywords)",
                "query": '"cyber attribution" APT',
                "remote": "UI year range becomes filter=from-pub-date.../until-pub-date...",
                "local": "Use local Author/Venue/DOI/Abstract filters",
            },
            {
                "title": "Example 2 — nesting shown, but treated as literal text",
                "query": '("cyber attribution" AND (APT OR "false flag"))',
                "remote": "Crossref will not interpret boolean structure",
                "local": "If you must approximate: use more quoted phrases + local filters",
            },
            {
                "title": "Example 3 — combined",
                "query": '"attribution" "threat intelligence"',
                "remote": "Set Year from=2015, Year to=2025; Sort=year",
                "local": "DOI only=on; Venue contains=IEEE",
            },
        ],
        "filter_notes": [
            "Remote years: Yes (from-pub-date/until-pub-date).",
            "Remote boolean: No.",
            "Remote author/venue fields: Not implemented here (local only in this app).",
        ],
    },
    "elsevier": {
        "label": "Scopus (Elsevier Search API)",
        "operators": "Supports AND/OR/NOT and parentheses via Scopus advanced query syntax.",
        "remote_filters": [
            "Scopus query fields (e.g., TITLE-ABS-KEY(...), AUTH(...), SRCTITLE(...))",
            "year_from/to via PUBYEAR >= and <= (appends if absent)",
            "count/start pagination",
            "sort (limited)",
        ],
        "local_filters": [
            "author contains (post-filter)",
            "venue contains (post-filter)",
            "only with DOI",
            "only with abstract",
        ],
        "examples": [
            {
                "title": "Example 1 — cyber attribution with operators",
                "query": 'TITLE-ABS-KEY("cyber attribution" AND deception)',
                "remote": "True boolean supported inside Scopus query",
                "local": "Optional local DOI/Abstract filters",
            },
            {
                "title": "Example 2 — nesting (recommended style for Scopus)",
                "query": 'TITLE-ABS-KEY(("cyber attribution" OR "threat attribution") AND (APT OR "false flag"))',
                "remote": "Nested parentheses + OR/AND are evaluated by Scopus",
                "local": "Use local filters only as a second pass",
            },
            {
                "title": "Example 3 — combined (fields + boolean + years)",
                "query": 'TITLE-ABS-KEY(("cyber attribution" AND (APT OR "false flag")) AND ("international relations"))',
                "remote": "UI years add PUBYEAR constraints if you did not include PUBYEAR",
                "local": "Venue contains=Security; DOI only=on; Abstract only=on",
            },
        ],
        "filter_notes": [
            "Remote years: Yes (PUBYEAR constraints).",
            "Remote boolean: Yes (AND/OR/NOT + parentheses).",
            "Remote fielded search: Yes (TITLE-ABS-KEY, etc.).",
        ],
    },
    "openalex": {
        "label": "OpenAlex",
        "operators": "Supports AND/OR/NOT and parentheses (uppercase operators recommended).",
        "remote_filters": [
            "from_publication_date/to_publication_date (via filter=...)",
            "cursor pagination",
            "per-page (up to 200)",
        ],
        "local_filters": [
            "author contains",
            "venue contains",
            "only with DOI",
            "only with abstract",
        ],
        "examples": [
            {
                "title": "Example 1 — attribution with operators",
                "query": '"cyber attribution" AND deception',
                "remote": "Boolean is supported by the OpenAlex search parser",
                "local": "Use local filters for DOI/Abstract/Author/Venue",
            },
            {
                "title": "Example 2 — nesting (works when parser accepts parentheses)",
                "query": '("cyber attribution" OR "threat attribution") AND (APT OR "false flag")',
                "remote": "Nested boolean expected to work (uppercase operators safer)",
                "local": "Local filters still apply after retrieval",
            },
            {
                "title": "Example 3 — combined (boolean + years + local filters)",
                "query": '("cyber attribution" AND (APT OR deception)) AND "international relations"',
                "remote": "UI years become from_publication_date/to_publication_date",
                "local": "Author contains=rid; Only with DOI=on; Only with abstract=on",
            },
        ],
        "filter_notes": [
            "Remote years: Yes (from_publication_date/to_publication_date).",
            "Remote boolean: Yes (parser-dependent; uppercase operators safer).",
            "Remote fielded search: Not exposed in this app (uses OpenAlex 'search=').",
        ],
    },
    "wos": {
        "label": "Web of Science (Starter API)",
        "operators": "Supports AND/OR/NOT and parentheses via field-tag query (e.g., TS=(...) AND PY=(...)).",
        "remote_filters": [
            "year_from/to via PY=(YYYY-YYYY) appended when missing",
            "page/limit pagination",
            "field tags like TS=, TI=, AU= (if you write them in the query)",
        ],
        "local_filters": [
            "author contains",
            "venue contains",
            "only with DOI",
            "only with abstract",
        ],
        "examples": [
            {
                "title": "Example 1 — attribution with operators (WoS fielded query)",
                "query": 'TS=("cyber attribution" AND deception)',
                "remote": "True boolean supported within TS=(...)",
                "local": "Optional DOI/Abstract/Author/Venue post-filters",
            },
            {
                "title": "Example 2 — nesting (WoS style)",
                "query": 'TS=(("cyber attribution" OR "threat attribution") AND (APT OR "false flag"))',
                "remote": "Nested boolean + parentheses supported",
                "local": "Post-filter if you want extra constraints",
            },
            {
                "title": "Example 3 — combined (boolean + PY years + local)",
                "query": 'TS=(("cyber attribution" AND (APT OR deception)) AND "international relations")',
                "remote": "UI years become PY=(YYYY-YYYY) if PY is absent",
                "local": "Venue contains=Journal; DOI only=on",
            },
        ],
        "filter_notes": [
            "Remote years: Yes (PY=(YYYY-YYYY)).",
            "Remote boolean: Yes (AND/OR/NOT + parentheses).",
            "Remote fielded search: Yes (TS=..., etc.) if you provide it.",
        ],
    },
}

def provider_help_text(spec):
    pid = (spec or {}).get("id") or ""
    caps = PROVIDER_CAPS.get(pid) or {}

    label = caps.get("label") or pid or "Provider"
    ops = caps.get("operators") or "Unknown."

    remote_filters = caps.get("remote_filters") or []
    local_filters = caps.get("local_filters") or []
    filter_notes = caps.get("filter_notes") or []
    examples = caps.get("examples") or []

    rf = "\n".join([f"- {x}" for x in remote_filters]) if remote_filters else "- None"
    lf = "\n".join([f"- {x}" for x in local_filters]) if local_filters else "- None"
    fn = "\n".join([f"- {x}" for x in filter_notes]) if filter_notes else "- (no notes)"

    ex_lines = []
    for ex in examples[:3]:
        title = (ex or {}).get("title") or "Example"
        q = (ex or {}).get("query") or ""
        remote = (ex or {}).get("remote") or ""
        local = (ex or {}).get("local") or ""
        ex_lines.append(f"{title}\nQuery:\n{q}")
        if remote:
            ex_lines.append(f"Remote:\n{remote}")
        if local:
            ex_lines.append(f"Local:\n{local}")
        ex_lines.append("")

    ex_txt = "\n".join(ex_lines).strip() if ex_lines else "(no examples)"

    return (
        f"{label}\n\n"
        f"Query operators:\n{ops}\n\n"
        f"Remote filters (sent to provider API):\n{rf}\n\n"
        f"Local filters (applied after download):\n{lf}\n\n"
        f"Notes:\n{fn}\n\n"
        f"Examples:\n{ex_txt}"
    )


def scopus_query_with_year(query, year_from, year_to):
    q = (query or "").strip()
    q_up = q.upper()
    if "PUBYEAR" in q_up:
        return q
    parts = [q] if q else []
    if isinstance(year_from, int) and year_from > 0:
        parts.append(f"PUBYEAR >= {year_from}")
    if isinstance(year_to, int) and year_to > 0:
        parts.append(f"PUBYEAR <= {year_to}")
    return " AND ".join([p for p in parts if p])

def wos_query_with_year(query, year_from, year_to):
    q = (query or "").strip()
    if not q:
        return q
    q_up = q.upper()
    if "PY=" in q_up:
        return q
    y1 = year_from if isinstance(year_from, int) and year_from > 0 else None
    y2 = year_to if isinstance(year_to, int) and year_to > 0 else None
    if not y1 and not y2:
        return q
    if y1 and y2:
        return f"{q} AND PY=({y1}-{y2})"
    if y1 and not y2:
        return f"{q} AND PY=({y1}-{y1})"
    return f"{q} AND PY=({y2}-{y2})"

def parse_semantic(data):
    items = []
    total = 0
    next_cursor = None

    if not isinstance(data, dict):
        return [], 0, None

    rows = data.get("data")
    if not isinstance(rows, list):
        rows = []

    total = int(data.get("total") or 0)

    if isinstance(data.get("offset"), int):
        offset = int(data.get("offset") or 0)
        limit = int(data.get("limit") or len(rows) or 0)
        next_cursor = offset + limit if rows else None
    else:
        token = data.get("token")
        next_cursor = token if isinstance(token, str) and token else None

    def _authors_to_str(authors):
        if isinstance(authors, str):
            return authors.strip()
        if not isinstance(authors, list):
            return ""
        names = []
        for a in authors:
            if isinstance(a, dict):
                n = (a.get("name") or "").strip()
                if n:
                    names.append(n)
            elif isinstance(a, str) and a.strip():
                names.append(a.strip())
        return ", ".join(names)

    def _doi_from_external_ids(external_ids):
        if not isinstance(external_ids, dict):
            return ""
        doi = external_ids.get("DOI") or external_ids.get("doi") or ""
        return str(doi).strip()

    for p in rows:
        if not isinstance(p, dict):
            continue

        paper_id = str(p.get("paperId") or "").strip()
        external_ids = p.get("externalIds") if isinstance(p.get("externalIds"), dict) else {}
        doi = _doi_from_external_ids(external_ids)

        open_access_pdf = p.get("openAccessPdf") if isinstance(p.get("openAccessPdf"), dict) else {}
        tldr = p.get("tldr") if isinstance(p.get("tldr"), dict) else {}

        rec = {
            "title": (p.get("title") or "").strip(),
            "authors": _authors_to_str(p.get("authors")),
            "year": p.get("year") or 0,
            "venue": (p.get("venue") or "").strip(),
            "doi": doi,
            "url": (p.get("url") or "").strip(),
            "abstract": (p.get("abstract") or "").strip(),
            "source": "semantic_scholar",
            "external_id": paper_id or (external_ids.get("CorpusId") or ""),
            "pdf_url": (open_access_pdf.get("url") or "").strip() if isinstance(open_access_pdf, dict) else "",
            "oa_status": (open_access_pdf.get("status") or "").strip() if isinstance(open_access_pdf, dict) else "",

            "ss_paperId": paper_id,
            "ss_externalIds": external_ids,
            "ss_citationCount": int(p.get("citationCount") or 0),
            "ss_referenceCount": int(p.get("referenceCount") or 0),
            "ss_influentialCitationCount": int(p.get("influentialCitationCount") or 0),
            "ss_isOpenAccess": bool(p.get("isOpenAccess")) if p.get("isOpenAccess") is not None else False,
            "ss_publicationDate": (p.get("publicationDate") or "").strip(),
            "ss_publicationTypes": p.get("publicationTypes") if isinstance(p.get("publicationTypes"), list) else [],
            "ss_publicationVenue": p.get("publicationVenue") if isinstance(p.get("publicationVenue"), dict) else {},
            "ss_journal": p.get("journal") if isinstance(p.get("journal"), dict) else {},
            "ss_fieldsOfStudy": p.get("fieldsOfStudy") if isinstance(p.get("fieldsOfStudy"), list) else [],
            "ss_s2FieldsOfStudy": p.get("s2FieldsOfStudy") if isinstance(p.get("s2FieldsOfStudy"), list) else [],
            "ss_tldr": (tldr.get("text") or "").strip() if isinstance(tldr, dict) else "",
        }

        items.append(rec)

    return items, total, next_cursor


def provider_specs(env):
    semantic_key = (
        env.get("SEMANTIC_API")
        or env.get("SEMANTIC_SCHOLAR_API_KEY")
        or os.environ.get("SEMANTIC_API")
        or os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
        or ""
    ).strip()

    elsevier_key = (
        env.get("ELSEVIER_KEY")
        or os.environ.get("ELSEVIER_KEY")
        or env.get("ELSEVIER_API")
        or os.environ.get("ELSEVIER_API")
        or ""
    )

    wos_key = (env.get("wos_api_key") or os.environ.get("wos_api_key") or "").strip()
    unpaywall_email = env.get("UNPAYWALL_EMAIL") or os.environ.get("UNPAYWALL_EMAIL") or ""

    return {
        "COS": {
    "id": "cos",
    "desc": "Merged multi-provider search (Semantic Scholar + OpenAlex + Crossref).",
},

        "Semantic Scholar": {
            "id": "semantic_scholar",
            "rate_ms": 1000,
            "key_masked": mask_key(semantic_key),
            "key_present": bool(semantic_key),
            "search": {
                "base": "https://api.semanticscholar.org/graph/v1/paper/search",
                "headers": (lambda: {
                    "x-api-key": semantic_key,
                    "Accept": "application/json",
                    "User-Agent": "ScholarDesk/1.0",
                } if semantic_key else {
                    "Accept": "application/json",
                    "User-Agent": "ScholarDesk/1.0",
                }),
                "build": (lambda query, year_from, year_to, limit, offset, sort: qurl_with_query(
                    "https://api.semanticscholar.org/graph/v1/paper/search",
                    {
                        "query": query,
                        "limit": min(limit, 100) if limit > 0 else 100,
                        "offset": offset,
                        "fields": ",".join([
                            "paperId",
                            "externalIds",
                            "title",
                            "abstract",
                            "year",
                            "venue",
                            "publicationVenue",
                            "publicationDate",
                            "publicationTypes",
                            "journal",
                            "url",
                            "authors",
                            "citationCount",
                            "referenceCount",
                            "influentialCitationCount",
                            "isOpenAccess",
                            "openAccessPdf",
                            "fieldsOfStudy",
                            "s2FieldsOfStudy",
                            "tldr",
                        ]),
                        "year": f"{year_from}-{year_to}" if year_from and year_to else None,
                    },
                )),
                "parse": parse_semantic,
            },
        },
        "Crossref": {
            "id": "crossref",
            "rate_ms": 250,
            "key_masked": "",
            "key_present": True,
            "search": {
                "base": "https://api.crossref.org/works",
                "headers": (lambda: {"Accept": "application/json"}),
                "build": (lambda query, year_from, year_to, limit, offset, sort: qurl_with_query(
                    "https://api.crossref.org/works",
                    {
                        "query.bibliographic": query,
                        "rows": limit,
                        "offset": offset,
                        "sort": "published" if sort == "year" else None,
                        "order": "desc" if sort in ("relevance", "year") else None,
                        "filter": ",".join(
                            [x for x in [
                                f"from-pub-date:{year_from}-01-01" if year_from else "",
                                f"until-pub-date:{year_to}-12-31" if year_to else "",
                            ] if x]
                        ) or None,
                    },
                )),
                "parse": parse_crossref,
            },
        },

        "OpenAlex": {
            "id": "openalex",
            "rate_ms": 250,
            "key_masked": "",
            "key_present": True,
            "search": {
                "base": "https://api.openalex.org/works",
                "headers": (lambda: {"Accept": "application/json"}),
                "build": (lambda query, year_from, year_to, limit, cursor, sort: qurl_with_query(
                    "https://api.openalex.org/works",
                    {
                        "search": query,
                        "per-page": min(limit if isinstance(limit, int) and limit > 0 else 100, 200),
                        "cursor": "*" if (cursor == 0 or isinstance(cursor, int)) else str(cursor),
                        "filter": ",".join(
                            [x for x in [
                                f"from_publication_date:{year_from}-01-01" if year_from else "",
                                f"to_publication_date:{year_to}-12-31" if year_to else "",
                            ] if x]
                        ) or None,
                    },
                )),
                "parse": parse_openalex,
            },
        },

        "Elsevier (Scopus Search API)": {
            "id": "elsevier",
            "rate_ms": 400,
            "key_masked": mask_key(elsevier_key),
            "key_present": bool(elsevier_key),
            "search": {
                "base": "https://api.elsevier.com/content/search/scopus",
                "headers": (lambda: {"X-ELS-APIKey": elsevier_key, "Accept": "application/json"} if elsevier_key else {"Accept": "application/json"}),
                "build": (lambda query, year_from, year_to, limit, offset, sort: qurl_with_query(
                    "https://api.elsevier.com/content/search/scopus",
                    {
                        "query": scopus_query_with_year(query, year_from, year_to),
                        "count": limit,
                        "start": offset,
                        "sort": "-coverDate" if sort == "year" else None,
                        "view": "COMPLETE",
                    },
                )),
                "parse": parse_elsevier,
            },
        },

        "Web of Science (Starter API)": {
            "id": "wos",
            "rate_ms": 650,
            "key_masked": mask_key(wos_key),
            "key_present": bool(wos_key),
            "search": {
                "base": "https://api.clarivate.com/apis/wos-starter/v1/documents",
                "headers": (lambda: {"X-ApiKey": wos_key, "Accept": "application/json"} if wos_key else {"Accept": "application/json"}),
                "build": (lambda query, year_from, year_to, limit, page, sort: qurl_with_query(
                    "https://api.clarivate.com/apis/wos-starter/v1/documents",
                    {
                        "q": wos_query_with_year(f'TS=("{query}")', year_from, year_to),
                        "db": "WOS",
                        "limit": limit,
                        "page": (page if isinstance(page, int) and page > 0 else 1),
                    },
                )),
                "parse": parse_wos_starter,
            },
        },

        "Google (no official API)": {
            "id": "google_placeholder",
            "rate_ms": 800,
            "key_masked": "",
            "key_present": False,
            "search": None,
        },

        "Paywall check (Unpaywall by DOI)": {
            "id": "unpaywall",
            "rate_ms": 400,
            "key_masked": mask_key(unpaywall_email),
            "key_present": bool(unpaywall_email),
            "search": {
                "base": "https://api.unpaywall.org/v2/",
                "headers": (lambda: {}),
                "build": (lambda doi: qurl_with_query(
                    f"https://api.unpaywall.org/v2/{normalize_doi(doi)}",
                    {"email": unpaywall_email} if unpaywall_email else {},
                )),
                "parse": parse_unpaywall,
            },
        },
    }





def make_label(text, bold=False):
    lbl = QLabel(text)
    if bold:
        f = QFont()
        f.setBold(True)
        lbl.setFont(f)
    return lbl


def set_status(sb, text):
    sb.showMessage(text, 8000)


def json_from_reply(reply):
    b = bytes(reply.readAll())
    if not b:
        return {}
    t = b[:1]
    if t not in (b"{", b"["):
        return {}
    return json.loads(b.decode("utf-8", errors="replace"))


# Database Helpers for Tags
def db_add_tag(name):
    sql_exec("INSERT OR IGNORE INTO tags (name) VALUES (:n)", {":n": name.strip()})
    return sql_scalar("SELECT id FROM tags WHERE name = :n", {":n": name.strip()})


def db_link_tag(paper_id, tag_id):
    sql_exec("INSERT OR IGNORE INTO paper_tags (paper_id, tag_id) VALUES (:p, :t)", {":p": paper_id, ":t": tag_id})


def db_get_tags(paper_id):
    q = QSqlQuery()
    q.prepare("SELECT t.name FROM tags t JOIN paper_tags pt ON t.id = pt.tag_id WHERE pt.paper_id = :p")
    q.bindValue(":p", paper_id)
    q.exec()
    tags = []
    while q.next(): tags.append(q.value(0))
    return tags


def db_remove_tag(paper_id, tag_name):
    sql_exec("""
             DELETE
             FROM paper_tags
             WHERE paper_id = :p
               AND tag_id = (SELECT id FROM tags WHERE name = :n)
             """, {":p": paper_id, ":n": tag_name})


from pathlib import Path

from PyQt6.QtCore import QUrl, QTimer
from PyQt6.QtWidgets import QVBoxLayout, QLabel, QMessageBox, QFileDialog


# Safe caching and rate limiting
CACHE = {}
LAST_TS = 0
RATE_INTERVAL = 1.0  # ~1 request/sec
def fetch_semantic_graph_details(paper_ids: list[str], callback, *, env: dict, net):
    """
    Fetch citation and reference lists for a batch of Semantic Scholar paper IDs.
    Uses the Academic Graph API /paper/batch with fields including references.paperId and citations.paperId.
    """
    import json
    import os
    from PyQt6.QtNetwork import QNetworkRequest

    if not paper_ids:
        callback(None, 0, {}, False)
        return

    base = "https://api.semanticscholar.org/graph/v1/paper/batch"
    params = {
        "fields": ",".join(
            [
                "paperId",
                "externalIds",
                "title",
                "abstract",
                "year",
                "venue",
                "publicationVenue",
                "publicationDate",
                "publicationTypes",
                "journal",
                "url",
                "authors",
                "citationCount",
                "referenceCount",
                "influentialCitationCount",
                "isOpenAccess",
                "openAccessPdf",
                "fieldsOfStudy",
                "s2FieldsOfStudy",
                "tldr",
                "references.paperId",
                "citations.paperId",
            ]
        )
    }

    qurl = qurl_with_query(base, params)

    api_key = (env.get("SEMANTIC_API") or os.environ.get("SEMANTIC_SCHOLAR_API_KEY") or "").strip()
    hdrs = {"x-api-key": api_key} if api_key else {}

    req = QNetworkRequest(qurl)
    for k, v in hdrs.items():
        if v:
            req.setRawHeader(str(k).encode("utf-8"), str(v).encode("utf-8"))

    reply = net.post(req, json.dumps({"ids": paper_ids}).encode("utf-8"))

    def on_reply():
        status = int(reply.attribute(QNetworkRequest.Attribute.HttpStatusCodeAttribute) or 0)
        raw = bytes(reply.readAll())

        data = {}
        if raw and raw.strip()[:1] in (b"{", b"["):
            data = json.loads(raw.decode("utf-8", errors="replace"))

        err = reply.error()
        callback(err, status, data, False)
        reply.deleteLater()

    reply.finished.connect(on_reply)
import re
import json

def _norm_title_for_key(t: str) -> str:
    t = (t or "").strip().lower()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"[^\w\s]", "", t)  # remove punctuation
    return t.strip()

def _norm_year(y):
    try:
        yi = int(y)
        return yi if yi > 0 else None
    except Exception:
        return None

def _record_key(rec: dict) -> str:
    """
    Stable dedup key:
    1) DOI (preferred)
    2) title+year
    3) title only (last resort)
    """
    if not isinstance(rec, dict):
        return ""

    doi = normalize_doi(rec.get("doi") or "")
    if doi:
        return f"doi::{doi}"

    title = _norm_title_for_key(rec.get("title") or "")
    year = _norm_year(rec.get("year"))
    if title and year:
        return f"ty::{title}::{year}"
    if title:
        return f"t::{title}"

    # fallback to external id if nothing else
    ext = (rec.get("external_id") or "").strip()
    if ext:
        return f"ext::{ext}"
    return ""

def _is_empty_value(v) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and v.strip() == "":
        return True
    if isinstance(v, (list, tuple, set)) and len(v) == 0:
        return True
    if isinstance(v, dict) and len(v) == 0:
        return True
    return False

def _merge_values(a, b):
    """
    Merge two values with simple heuristics:
    - Prefer non-empty over empty
    - For strings: prefer longer (usually more informative)
    - For dicts: prefer one with more keys; shallow-merge if both dict
    - For lists: union unique (by json signature / string)
    - Otherwise: keep a if present else b
    """
    if _is_empty_value(a) and not _is_empty_value(b):
        return b
    if not _is_empty_value(a) and _is_empty_value(b):
        return a

    if isinstance(a, str) and isinstance(b, str):
        aa, bb = a.strip(), b.strip()
        return bb if len(bb) > len(aa) else aa

    if isinstance(a, dict) and isinstance(b, dict):
        # shallow merge; prefer b on conflicts only if it is "better"
        out = dict(a)
        for k, vb in b.items():
            va = out.get(k)
            out[k] = _merge_values(va, vb)
        return out

    if isinstance(a, list) and isinstance(b, list):
        seen = set()
        out = []

        def _sig(x):
            try:
                return json.dumps(x, sort_keys=True, ensure_ascii=False)
            except Exception:
                return str(x)

        for x in a + b:
            s = _sig(x)
            if s in seen:
                continue
            seen.add(s)
            out.append(x)
        return out

    # numeric: prefer non-null, then max (often counts)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        # for counts, max is generally safer
        return a if a >= b else b

    return a if not _is_empty_value(a) else b

def merge_records(base: dict, incoming: dict) -> dict:
    """
    Merge incoming into base, field-by-field.
    Keeps base['source'] but adds a sources list for provenance.
    """
    if not isinstance(base, dict):
        base = {}
    if not isinstance(incoming, dict):
        return base

    out = dict(base)

    # provenance
    srcs = set()
    for s in [base.get("source"), incoming.get("source")]:
        if isinstance(s, str) and s.strip():
            srcs.add(s.strip())
    if "sources" in out and isinstance(out["sources"], list):
        for s in out["sources"]:
            if isinstance(s, str) and s.strip():
                srcs.add(s.strip())
    out["sources"] = sorted(srcs)

    # merge all keys
    all_keys = set(out.keys()) | set(incoming.keys())
    for k in all_keys:
        if k == "sources":
            continue
        out[k] = _merge_values(out.get(k), incoming.get(k))

    # normalise DOI at end
    out["doi"] = normalize_doi(out.get("doi") or "")

    # ensure URL reasonable
    if _is_empty_value(out.get("url")):
        doi = out.get("doi") or ""
        if doi:
            out["url"] = f"https://doi.org/{doi}"

    return out

def deduplicate_and_merge_rows(rows: list) -> list:
    """
    Deduplicate and merge all records into a single canonical row per key.
    """
    if not isinstance(rows, list):
        return []

    bucket = {}
    order = []  # stable output order

    for r in rows:
        if not isinstance(r, dict):
            continue
        key = _record_key(r)
        if not key:
            # keep truly-unkeyed entries unique by object id
            key = f"raw::{id(r)}"
        if key not in bucket:
            bucket[key] = dict(r)
            # ensure sources list exists
            bucket[key]["sources"] = sorted({(r.get("source") or "").strip()} - {""})
            order.append(key)
        else:
            bucket[key] = merge_records(bucket[key], r)

    return [bucket[k] for k in order]

def search_engine_front(
    env: dict | None = None,
    embedded: bool = False,
    parent: QWidget | None = None,
    exports: dict | None = None,
):

    # --- 1. SETUP & CONFIGURATION ---
    app_dir = ensure_app_dir()

    env_loaded, env_used = load_env(Path(__file__).resolve().parent / ENV_FILENAME)
    if env is not None:
        env_loaded, env_used = env, ""

    print(f"Loaded .env from: {env_used}", flush=True)
    print(f"SEMANTIC_API in env: {env_loaded.get('SEMANTIC_API') or '(not present)'}", flush=True)

    specs = provider_specs(env_loaded)

    app = QApplication.instance()
    if not embedded:
        app = QApplication(sys.argv)
        app.setApplicationName(APP_NAME)

    if app is None:
        raise RuntimeError("QApplication is not running; cannot embed without an existing QApplication.")

    crash_log_path, crash_log_fh = setup_crash_logging(app_dir)

    try:
        cb = app.clipboard()
        if cb is not None:
            cb.setText(str(crash_log_path))
            print("CRASH_LOG_PATH_COPIED_TO_CLIPBOARD=1", flush=True)
    except Exception as e:
        print(f"CRASH_LOG_PATH_COPIED_TO_CLIPBOARD=0 ({e})", flush=True)

    QNetworkProxy.setApplicationProxy(QNetworkProxy(QNetworkProxy.ProxyType.DefaultProxy))

    db_path = app_dir / DB_FILENAME
    db, db_ok = init_db(db_path)

    from PyQt6.QtNetwork import QSslSocket
    if not QSslSocket.supportsSsl():
        QMessageBox.critical(
            (parent if parent is not None else None),
            "Network error",
            "Qt SSL is not available (QSslSocket.supportsSsl() is False).\n"
            "QNetworkAccessManager cannot perform HTTPS requests.\n\n"
            "Semantic Scholar will fail here even though requests works."
        )

    win = QMainWindow(parent)
    win.setWindowTitle(APP_NAME)
    win.resize(1280, 820)

    sb = QStatusBar(win)
    win.setStatusBar(sb)

    toolbar = QToolBar("Main", win)
    win.addToolBar(toolbar)
    act_quit = QAction("Quit", win)
    act_quit.setShortcut(QKeySequence.StandardKey.Quit)
    act_quit.triggered.connect(app.quit)
    toolbar.addAction(act_quit)

    net = QNetworkAccessManager(win)

    # --- 2. UI LAYOUTS & WIDGETS ---
    tabs = QTabWidget()
    win.setCentralWidget(tabs)

    workspace_tab = QWidget()
    search_tab = QWidget()
    lib_tab = QWidget()
    settings_tab = QWidget()

    tabs.addTab(workspace_tab, "Workspace")
    tabs.addTab(search_tab, "Search")
    tabs.addTab(lib_tab, "Library")
    tabs.addTab(settings_tab, "Settings")

    state = {
        "results": [],
        "selected": None,
        "page_offset": 0,
        "page_total": 0,
        "page_limit": 1000,
        "provider": "Semantic Scholar",
        "running": False,
        "last_query": "",
        "sort": "relevance",
        "year_from": 0,
        "year_to": 0,
        "fetched": 0,
        "_right_stack": None,
        "_graph_host": None,
        "_graph_host_layout": None,
        "_graph_widget": None,
        "_graph_detached_dialog": None,
        "_graph_back_btn": None,
        "_graph_detach_btn": None,
        "_graph_full_btn": None,
        "_graph_close_btn": None,
    }


    # Search Controls
    query_input = QLineEdit()
    query_input.setPlaceholderText("Query (supports AND OR parentheses as plain text)")

    provider_combo = QComboBox()

    searchable = []
    for name, spec in (specs or {}).items():
        pid = (spec.get("id") or "").strip().lower()
        search_spec = spec.get("search") or {}
        if pid in ("unpaywall", "google_placeholder"):
            continue
        if pid == "cos":
            searchable.append(name)
            continue
        build = search_spec.get("build")
        parse = search_spec.get("parse")
        headers_fn = search_spec.get("headers")
        if callable(build) and callable(parse) and callable(headers_fn):
            searchable.append(name)

    provider_combo.addItems(searchable)
    provider_combo.setCurrentText("OpenAlex" if "OpenAlex" in searchable else (
        "Semantic Scholar" if "Semantic Scholar" in searchable else (searchable[0] if searchable else "")))

    provider_help = QLabel("?")
    provider_help.setAlignment(Qt.AlignmentFlag.AlignCenter)
    provider_help.setFixedWidth(18)
    provider_help.setStyleSheet("QLabel { border: 1px solid #999; border-radius: 9px; font-weight: 700; }")
    provider_help.setToolTip("Select a provider to see capabilities.")

    sort_combo = QComboBox()
    sort_combo.addItems(["relevance", "year"])

    limit_spin = QSpinBox()
    limit_spin.setRange(0, 1000)
    limit_spin.setValue(1000)
    limit_spin.setSpecialValueText("All")

    year_from = QSpinBox()
    year_from.setRange(0, 2100)
    year_from.setValue(0)
    year_from.setSpecialValueText("Any")

    year_to = QSpinBox()
    year_to.setRange(0, 2100)
    year_to.setValue(0)
    year_to.setSpecialValueText("Any")

    author_filter = QLineEdit()
    author_filter.setPlaceholderText("Filter: author contains (local)")

    venue_filter = QLineEdit()
    venue_filter.setPlaceholderText("Filter: venue contains (local)")

    doi_only = QCheckBox("Only with DOI")
    abstract_only = QCheckBox("Only with abstract")

    btn_search = QPushButton("Search")

    # Export Controls
    export_format = QComboBox()
    export_format.addItems(["CSV", "XLSX", "RIS"])
    export_format.setEnabled(False)
    btn_export = QPushButton("Export")
    btn_export.setEnabled(False)

    # Navigation Controls
    btn_prev = QPushButton("Prev")
    btn_next = QPushButton("Next")
    btn_prev.setEnabled(False)
    btn_next.setEnabled(False)

    # Results View
    results_view = QTableView()
    results_view.setSelectionBehavior(QTableView.SelectionBehavior.SelectRows)
    results_view.setSelectionMode(QTableView.SelectionMode.ExtendedSelection)
    results_view.horizontalHeader().setStretchLastSection(True)

    # ----------------------------
    # DETAILS + GRAPH (embedded) UI
    # ----------------------------
    from PyQt6.QtWidgets import QStackedWidget

    details = QTextBrowser()
    details.setOpenExternalLinks(False)
    details.setStyleSheet("QTextBrowser { padding: 10px; }")

    # Detail Buttons
    btn_open = QPushButton("Open URL")
    btn_save = QPushButton("Save to Library")
    btn_bib = QPushButton("Copy BibTeX")
    btn_oa = QPushButton("Paywall / OA (Unpaywall)")
    btn_graph = QPushButton("Network Graph")

    btn_open.setEnabled(False)
    btn_save.setEnabled(False)
    btn_bib.setEnabled(False)
    btn_oa.setEnabled(False)
    btn_graph.setEnabled(False)

    btns = QHBoxLayout()
    btns.addWidget(btn_open)
    btns.addWidget(btn_save)
    btns.addWidget(btn_bib)
    btns.addWidget(btn_oa)
    btns.addWidget(btn_graph)

    right_stack = QStackedWidget()

    # Page 0: details
    details_page = QWidget()
    details_page_l = QVBoxLayout()
    details_page_l.setContentsMargins(0, 0, 0, 0)
    details_page_l.addWidget(details, 1)
    details_page.setLayout(details_page_l)

    # Page 1: graph host + toolbar
    graph_page = QWidget()
    graph_page_l = QVBoxLayout()
    graph_page_l.setContentsMargins(0, 0, 0, 0)

    graph_toolbar = QHBoxLayout()
    btn_graph_back = QPushButton("Back to Details")
    btn_graph_detach = QPushButton("Detach")
    btn_graph_full = QPushButton("Fullscreen")
    btn_graph_close = QPushButton("Close Graph")
    graph_toolbar.addWidget(btn_graph_back)
    graph_toolbar.addStretch(1)
    graph_toolbar.addWidget(btn_graph_detach)
    graph_toolbar.addWidget(btn_graph_full)
    graph_toolbar.addWidget(btn_graph_close)

    graph_host = QWidget()
    graph_host_l = QVBoxLayout()
    graph_host_l.setContentsMargins(0, 0, 0, 0)
    graph_host.setLayout(graph_host_l)

    graph_page_l.addLayout(graph_toolbar)
    graph_page_l.addWidget(graph_host, 1)
    graph_page.setLayout(graph_page_l)

    right_stack.addWidget(details_page)  # 0
    right_stack.addWidget(graph_page)    # 1
    right_stack.setCurrentIndex(0)

    # Store refs
    state["_right_stack"] = right_stack
    state["_graph_host"] = graph_host
    state["_graph_host_layout"] = graph_host_l
    state["_graph_widget"] = None
    state["_graph_detached_dialog"] = None
    state["_graph_back_btn"] = btn_graph_back
    state["_graph_detach_btn"] = btn_graph_detach
    state["_graph_full_btn"] = btn_graph_full
    state["_graph_close_btn"] = btn_graph_close

    def _graph_back():
        from PyQt6.QtWidgets import QStackedWidget

        rs = state.get("_right_stack")
        if isinstance(rs, QStackedWidget):
            rs.setCurrentIndex(0)

    def _graph_close():
        from PyQt6.QtWidgets import QLayout, QStackedWidget, QWidget

        g = state.get("_graph_widget")
        host_l = state.get("_graph_host_layout")

        if isinstance(g, QWidget) and isinstance(host_l, QLayout):
            host_l.removeWidget(g)
            g.setParent(None)
            g.deleteLater()
            state["_graph_widget"] = None

        rs = state.get("_right_stack")
        if isinstance(rs, QStackedWidget):
            rs.setCurrentIndex(0)

    def _graph_detach():
        from PyQt6.QtWidgets import QWidget, QDialog, QVBoxLayout

        g = state.get("_graph_widget")
        if not isinstance(g, QWidget):
            return

        dlg = QDialog(win)
        dlg.setWindowTitle("Network Graph")
        dlg.resize(1100, 800)

        lay = QVBoxLayout()
        dlg.setLayout(lay)

        host_l = state.get("_graph_host_layout")
        if isinstance(host_l, QVBoxLayout):
            host_l.removeWidget(g)

        g.setParent(dlg)
        g.setWindowFlags(Qt.WindowType.Widget)
        lay.addWidget(g)

        state["_graph_detached_dialog"] = dlg

        def _on_detached_closed(_result=0):
            g2 = state.get("_graph_widget")
            if not isinstance(g2, QWidget):
                return

            h = state.get("_graph_host")
            hl = state.get("_graph_host_layout")
            if not isinstance(h, QWidget):
                return
            if not isinstance(hl, QVBoxLayout):
                return

            g2.setParent(h)
            hl.addWidget(g2)
            g2.show()

        dlg.finished.connect(_on_detached_closed)
        dlg.show()

    def _graph_fullscreen():
        from PyQt6.QtWidgets import QDialog

        dlg = state.get("_graph_detached_dialog")
        if not isinstance(dlg, QDialog):
            _graph_detach()
            dlg = state.get("_graph_detached_dialog")

        if isinstance(dlg, QDialog):
            dlg.showFullScreen()
            dlg.raise_()
            dlg.activateWindow()

    btn_graph_back.clicked.connect(_graph_back)
    btn_graph_close.clicked.connect(_graph_close)
    btn_graph_detach.clicked.connect(_graph_detach)
    btn_graph_full.clicked.connect(_graph_fullscreen)

    # --- 3. LAYOUT ASSEMBLY ---
    search_top = QGroupBox("Search controls")
    top_layout = QGridLayout()

    top_layout.addWidget(make_label("Provider", True), 0, 0)
    provider_row = QHBoxLayout()
    provider_row.addWidget(provider_combo, 1)
    provider_row.addWidget(provider_help, 0)
    provider_frame = QFrame()
    provider_frame.setLayout(provider_row)
    top_layout.addWidget(provider_frame, 0, 1)

    top_layout.addWidget(make_label("Sort", True), 0, 2)
    top_layout.addWidget(sort_combo, 0, 3)
    top_layout.addWidget(make_label("Limit", True), 0, 4)
    top_layout.addWidget(limit_spin, 0, 5)

    top_layout.addWidget(make_label("Query", True), 1, 0)
    top_layout.addWidget(query_input, 1, 1, 1, 5)

    top_layout.addWidget(make_label("Year from", True), 2, 0)
    top_layout.addWidget(year_from, 2, 1)
    top_layout.addWidget(make_label("Year to", True), 2, 2)
    top_layout.addWidget(year_to, 2, 3)
    top_layout.addWidget(btn_search, 2, 4)

    nav_box = QHBoxLayout()
    nav_box.addWidget(btn_prev)
    nav_box.addWidget(btn_next)
    nav_box.addWidget(export_format)
    nav_box.addWidget(btn_export)
    nav_box.addStretch(1)
    nav_frame = QFrame()
    nav_frame.setLayout(nav_box)
    top_layout.addWidget(nav_frame, 2, 5)

    top_layout.addWidget(make_label("Filters", True), 3, 0)
    top_layout.addWidget(author_filter, 3, 1, 1, 2)
    top_layout.addWidget(venue_filter, 3, 3, 1, 2)

    filters_row = QHBoxLayout()
    filters_row.addWidget(doi_only)
    filters_row.addWidget(abstract_only)
    filters_row.addStretch(1)
    filters_frame = QFrame()
    filters_frame.setLayout(filters_row)
    top_layout.addWidget(filters_frame, 3, 5)

    google_note = QLabel("Google option is a placeholder. There is no official Google Scholar API.")
    google_note.setWordWrap(True)
    google_note.setStyleSheet("color: #777;")
    top_layout.addWidget(google_note, 4, 0, 1, 6)

    search_top.setLayout(top_layout)

    left = QWidget()
    left_layout = QVBoxLayout()
    left_layout.addWidget(search_top)
    left_layout.addWidget(results_view, 1)
    left.setLayout(left_layout)

    right = QWidget()
    right_layout = QVBoxLayout()
    right_layout.addWidget(make_label("Details", True))
    right_layout.addWidget(right_stack, 1)  # stack: details / graph
    right_layout.addLayout(btns)
    right.setLayout(right_layout)

    splitter = QSplitter()
    splitter.addWidget(left)
    splitter.addWidget(right)
    splitter.setStretchFactor(0, 3)
    splitter.setStretchFactor(1, 2)

    search_layout = QVBoxLayout()
    search_layout.addWidget(splitter)
    search_tab.setLayout(search_layout)

    # Workspace & Library Setup
    workspace_layout = QVBoxLayout()
    workspace_controls = QHBoxLayout()
    btn_new_search = QPushButton("New search tab")
    workspace_controls.addWidget(btn_new_search)
    workspace_controls.addStretch(1)
    workspace_layout.addLayout(workspace_controls)
    workspace_tabs = QTabWidget()
    workspace_layout.addWidget(workspace_tabs, 1)
    workspace_tab.setLayout(workspace_layout)

    lib_model = QSqlTableModel(db=db)
    lib_model.setTable("papers")
    lib_model.setEditStrategy(QSqlTableModel.EditStrategy.OnManualSubmit)
    lib_model.select()

    lib_filter = QLineEdit()
    lib_filter.setPlaceholderText("Filter library...")
    lib_view = QTableView()
    lib_view.setModel(lib_model)
    lib_view.setSelectionBehavior(QTableView.SelectionBehavior.SelectRows)

    lib_l = QVBoxLayout()
    lib_l.addWidget(lib_filter)
    lib_l.addWidget(lib_view)
    lib_tab.setLayout(lib_l)

    # Settings & Progress Dock
    settings_layout = QVBoxLayout()
    settings_box = QGroupBox("Status")
    form = QFormLayout()
    form.addRow("Loaded .env", QLabel(env_used or "None"))
    settings_box.setLayout(form)
    settings_layout.addWidget(settings_box)
    settings_tab.setLayout(settings_layout)

    dock = QDockWidget("Search progress")
    dock.setAllowedAreas(Qt.DockWidgetArea.BottomDockWidgetArea)
    win.addDockWidget(Qt.DockWidgetArea.BottomDockWidgetArea, dock)
    pr = QWidget()
    pl = QVBoxLayout()
    pbar = QProgressBar()
    pstats = QLabel("Ready")
    pl.addWidget(pbar)
    pl.addWidget(pstats)
    pr.setLayout(pl)
    dock.setWidget(pr)

    def log(msg):
        pstats.setText(msg)

    def _dbg_preview_record(rec, label="REC"):
        if not isinstance(rec, dict):
            print(f"[{label}] not a dict: {type(rec)}", flush=True)
            return

        keys = sorted(rec.keys())
        head = keys[:20]
        print(f"[{label}] keys={len(keys)} head={head}", flush=True)

        title = rec.get("title")
        doi = rec.get("doi")
        ext = rec.get("external_id")
        src = rec.get("source")
        year = rec.get("year")
        print(f"[{label}] title={title!r}", flush=True)
        print(f"[{label}] year={year!r} doi={doi!r} external_id={ext!r} source={src!r}", flush=True)

    def deduplicate_and_merge_rows(rows):
        """
        ###1. build stable key (doi else title+year)
        ###2. merge non-empty values
        ###3. keep first-seen order
        """
        import re
        import json

        if not isinstance(rows, list):
            return []

        def _norm_title(s):
            t = (s or "").strip().lower()
            t = re.sub(r"\s+", " ", t)
            t = re.sub(r"[^\w\s\-:;,.\(\)\[\]']", "", t)
            return t

        def _norm_doi(s):
            ss = (s or "").strip()
            ss = re.sub(r"^https?://(dx\.)?doi\.org/", "", ss, flags=re.I).strip()
            return ss

        def _dedupe_key(rec):
            doi = _norm_doi(rec.get("doi") or "")
            if doi:
                return ("doi", doi)

            title = _norm_title(rec.get("title") or rec.get("label") or "")
            year = rec.get("year")
            if isinstance(year, str):
                year_s = year.strip()
                year = int(year_s) if year_s.isdigit() else 0
            if isinstance(year, (int, float)):
                year = int(year)
            if year is None:
                year = 0

            return ("ty", title, year)

        def _is_empty(v):
            if v is None:
                return True
            if isinstance(v, str) and not v.strip():
                return True
            if isinstance(v, (list, dict)) and not v:
                return True
            return False

        def _merge_values(a, b):
            if _is_empty(a) and not _is_empty(b):
                return b
            if not _is_empty(a) and _is_empty(b):
                return a
            if _is_empty(a) and _is_empty(b):
                return a

            if isinstance(a, dict) and isinstance(b, dict):
                out = dict(a)
                for k, vb in b.items():
                    va = out.get(k)
                    if _is_empty(va) and not _is_empty(vb):
                        out[k] = vb
                    elif isinstance(va, dict) and isinstance(vb, dict):
                        out[k] = _merge_values(va, vb)
                return out

            if isinstance(a, list) and isinstance(b, list):
                seen = set()
                out = []
                for x in a + b:
                    if isinstance(x, (dict, list)):
                        key = json.dumps(x, sort_keys=True, ensure_ascii=False)
                    else:
                        key = str(x)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(x)
                return out

            return a

        merged = {}
        order = []

        for r in rows:
            if not isinstance(r, dict):
                continue

            k = _dedupe_key(r)
            if k not in merged:
                merged[k] = dict(r)
                order.append(k)
                continue

            base = merged[k]
            for kk, vv in r.items():
                base[kk] = _merge_values(base.get(kk), vv)

            s0 = base.get("source")
            s1 = r.get("source")
            if isinstance(s0, str) and isinstance(s1, str) and s0 and s1 and s0 != s1:
                base["source"] = ",".join(sorted(set(x.strip() for x in (s0 + "," + s1).split(",") if x.strip())))

        return [merged[k] for k in order]

    # --- 4. EXPORT HELPERS (Defined BEFORE usage) ---
    def export_rows_csv(rows, path):
        cols = ["title", "authors", "year", "venue", "doi", "url", "source", "external_id", "oa_status", "pdf_url",
                "abstract"]
        try:
            with open(path, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(cols)
                for r in rows:
                    w.writerow([r.get(c, "") for c in cols])
        except Exception as e:
            QMessageBox.critical(win, "Export Error", str(e))

    def export_rows_xlsx(rows, path):
        if not openpyxl:
            QMessageBox.warning(win, "Error", "openpyxl not installed. Install with: pip install openpyxl")
            return
        cols = ["title", "authors", "year", "venue", "doi", "url", "source", "external_id", "oa_status", "pdf_url",
                "abstract"]
        try:
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "results"
            ws.append(cols)
            for r in rows:
                ws.append([r.get(c, "") for c in cols])
            wb.save(path)
        except Exception as e:
            QMessageBox.critical(win, "Export Error", str(e))

    def export_rows_ris(rows, path):
        def ris_escape(s):
            s = "" if s is None else str(s)
            return s.replace("\r", " ").replace("\n", " ").strip()

        lines = []
        for r in rows:
            lines.append("TY  - JOUR")
            if r.get("title"): lines.append(f"TI  - {ris_escape(r.get('title'))}")
            if r.get("authors"):
                for a in r.get("authors").split(","):
                    lines.append(f"AU  - {ris_escape(a)}")
            if r.get("year"): lines.append(f"PY  - {ris_escape(r.get('year'))}")
            if r.get("venue"): lines.append(f"JO  - {ris_escape(r.get('venue'))}")
            if r.get("doi"): lines.append(f"DO  - {ris_escape(r.get('doi'))}")
            if r.get("url"): lines.append(f"UR  - {ris_escape(r.get('url'))}")
            if r.get("abstract"): lines.append(f"AB  - {ris_escape(r.get('abstract'))}")
            lines.append("ER  - \n")

        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
        except Exception as e:
            QMessageBox.critical(win, "Export Error", str(e))

    def export_current_csv():
        rows = state.get("results") or []
        if not rows: return
        path, _ = QFileDialog.getSaveFileName(win, "Export CSV", "results.csv", "CSV Files (*.csv)")
        if path: export_rows_csv(rows, path)

    def export_current_xlsx():
        rows = state.get("results") or []
        if not rows: return
        path, _ = QFileDialog.getSaveFileName(win, "Export XLSX", "results.xlsx", "Excel Files (*.xlsx)")
        if path: export_rows_xlsx(rows, path)

    def export_current_ris():
        rows = state.get("results") or []
        if not rows: return
        path, _ = QFileDialog.getSaveFileName(win, "Export RIS", "results.ris", "RIS Files (*.ris)")
        if path: export_rows_ris(rows, path)

    def export_dispatch():
        fmt = export_format.currentText()
        if fmt == "CSV":
            export_current_csv()
        elif fmt == "XLSX":
            export_current_xlsx()
        elif fmt == "RIS":
            export_current_ris()

    # --- 5. WORKSPACE & HELPER LOGIC (Defined BEFORE usage) ---

    def ws_load_tabs():
        q = QSqlQuery()
        q.exec("SELECT tab_id, title, config_json, results_json FROM workspace_tabs ORDER BY updated_at ASC")
        rows = []
        while q.next():
            tab_id = q.value(0) or ""
            title = q.value(1) or ""
            cfg_s = q.value(2) or ""
            res_s = q.value(3) or ""
            cfg = json.loads(cfg_s) if cfg_s else {}
            res = json.loads(res_s) if res_s else []
            rows.append((tab_id, title, cfg, res))
        return rows

    def ws_save_tab(tab_id, title, cfg, results):
        sql_exec(
            """
            INSERT OR REPLACE INTO workspace_tabs (tab_id, title, config_json, results_json, created_at, updated_at)
            VALUES (
                :id,
                :title,
                :cfg,
                :res,
                COALESCE((SELECT created_at FROM workspace_tabs WHERE tab_id = :id), :now),
                :now
            )
            """,
            {
                "id": tab_id,
                "title": title or "",
                "cfg": json.dumps(cfg or {}, ensure_ascii=False),
                "res": json.dumps(results or [], ensure_ascii=False),
                "now": now_iso(),
            },
        )

    def workspace_tab_id():
        seed = now_iso() + "|" + str(id(win)) + "|" + str(workspace_tabs.count())
        return hashlib.sha256(seed.encode("utf-8")).hexdigest()

    def clone_search_to_workspace(tab_id=None, initial_cfg=None, initial_results=None, initial_title=None):


        panel = QWidget()
        lay = QVBoxLayout()

        q = QLineEdit()
        q.setText((initial_cfg or {}).get("query") or query_input.text())

        p = QComboBox()
        safe_keys = []
        for k, v in (specs or {}).items():
            pid = (v.get("id") or "").strip().lower()
            if pid in ("google_placeholder", "unpaywall"):
                continue
            search_spec = (v or {}).get("search") or {}
            if pid == "cos":
                safe_keys.append(k)
                continue
            build = search_spec.get("build")
            parse = search_spec.get("parse")
            headers_fn = search_spec.get("headers")
            if callable(build) and callable(parse) and callable(headers_fn):
                safe_keys.append(k)

        p.addItems(safe_keys)

        p.setCurrentText((initial_cfg or {}).get("provider") or provider_combo.currentText())

        ws_provider_help = QLabel("?")
        ws_provider_help.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ws_provider_help.setFixedWidth(18)
        ws_provider_help.setStyleSheet("QLabel { border: 1px solid #999; border-radius: 9px; font-weight: 700; }")

        srt = QComboBox()
        srt.addItems(["relevance", "year"])
        srt.setCurrentText((initial_cfg or {}).get("sort") or sort_combo.currentText())

        lim = QSpinBox()
        lim.setRange(0, 1000)
        lim.setValue(int((initial_cfg or {}).get("limit") or limit_spin.value()))
        lim.setSpecialValueText("All")

        yf = QSpinBox()
        yf.setRange(0, 2100)
        yf.setValue(int((initial_cfg or {}).get("year_from") or 0))
        yf.setSpecialValueText("Any")

        yt = QSpinBox()
        yt.setRange(0, 2100)
        yt.setValue(int((initial_cfg or {}).get("year_to") or 0))
        yt.setSpecialValueText("Any")

        btn_run = QPushButton("Run Search")

        ws_view = QTableView()
        ws_view.setSelectionBehavior(QTableView.SelectionBehavior.SelectRows)
        ws_view.setSelectionMode(QTableView.SelectionMode.ExtendedSelection)
        ws_view.horizontalHeader().setStretchLastSection(True)
        ws_view.verticalHeader().setVisible(False)
        ws_view.setAlternatingRowColors(True)

        from PyQt6.QtWidgets import QStackedWidget, QDialog

        ws_info = QTextBrowser()
        ws_info.setOpenExternalLinks(False)
        ws_info.setStyleSheet("QTextBrowser { padding: 10px; }")

        # --- Embedded Details/Graph stack for Workspace tab ---
        ws_right_stack = QStackedWidget()

        # Page 0: bibliographic details
        ws_details_page = QWidget()
        ws_details_l = QVBoxLayout()
        ws_details_l.setContentsMargins(0, 0, 0, 0)
        ws_details_l.addWidget(ws_info, 1)
        ws_details_page.setLayout(ws_details_l)

        # Page 1: graph page
        ws_graph_page = QWidget()
        ws_graph_l = QVBoxLayout()
        ws_graph_l.setContentsMargins(0, 0, 0, 0)

        ws_graph_toolbar = QHBoxLayout()
        ws_btn_graph_back = QPushButton("Back to Details")
        ws_btn_graph_detach = QPushButton("Detach")
        ws_btn_graph_full = QPushButton("Fullscreen")
        ws_btn_graph_close = QPushButton("Close Graph")
        ws_graph_toolbar.addWidget(ws_btn_graph_back)
        ws_graph_toolbar.addStretch(1)
        ws_graph_toolbar.addWidget(ws_btn_graph_detach)
        ws_graph_toolbar.addWidget(ws_btn_graph_full)
        ws_graph_toolbar.addWidget(ws_btn_graph_close)

        ws_graph_host = QWidget()
        ws_graph_host_l = QVBoxLayout()
        ws_graph_host_l.setContentsMargins(0, 0, 0, 0)
        ws_graph_host.setLayout(ws_graph_host_l)

        ws_graph_l.addLayout(ws_graph_toolbar)
        ws_graph_l.addWidget(ws_graph_host, 1)
        ws_graph_page.setLayout(ws_graph_l)

        ws_right_stack.addWidget(ws_details_page)  # 0
        ws_right_stack.addWidget(ws_graph_page)  # 1
        ws_right_stack.setCurrentIndex(0)

        # Per-workspace-tab graph state (kept inside this closure)
        ws_graph_state = {
            "stack": ws_right_stack,
            "host_layout": ws_graph_host_l,
            "widget": None,
            "detached": None,
        }

        def ws_graph_back():
            ws_graph_state["stack"].setCurrentIndex(0)

        def ws_graph_close():
            g = ws_graph_state.get("widget")
            if g is not None:
                ws_graph_state["host_layout"].removeWidget(g)
                g.setParent(None)
                g.deleteLater()
                ws_graph_state["widget"] = None
            ws_graph_state["stack"].setCurrentIndex(0)

        def ws_graph_detach():
            g = ws_graph_state.get("widget")
            if g is None:
                return

            dlg = QDialog(win)
            dlg.setWindowTitle("Network Graph")
            dlg.resize(1100, 800)
            lay = QVBoxLayout()
            dlg.setLayout(lay)

            ws_graph_state["host_layout"].removeWidget(g)
            g.setParent(dlg)
            lay.addWidget(g)

            ws_graph_state["detached"] = dlg

            def _on_closed(_result=0):
                g2 = ws_graph_state.get("widget")
                if g2 is None:
                    return
                g2.setParent(ws_graph_host)
                ws_graph_state["host_layout"].addWidget(g2)
                g2.show()

            dlg.finished.connect(_on_closed)
            dlg.show()

        def ws_graph_fullscreen():
            dlg = ws_graph_state.get("detached")
            if dlg is None:
                ws_graph_detach()
                dlg = ws_graph_state.get("detached")
            if dlg is not None:
                dlg.showMaximized()

        ws_btn_graph_back.clicked.connect(ws_graph_back)
        ws_btn_graph_close.clicked.connect(ws_graph_close)
        ws_btn_graph_detach.clicked.connect(ws_graph_detach)
        ws_btn_graph_full.clicked.connect(ws_graph_fullscreen)

        ws_export_fmt = QComboBox()
        ws_export_fmt.addItems(["CSV", "XLSX", "RIS"])
        ws_btn_export = QPushButton("Export Tab")

        btn_open_ws = QPushButton("Open URL")
        btn_save_ws = QPushButton("Save to Library")
        btn_bib_ws = QPushButton("Copy BibTeX")
        btn_oa_ws = QPushButton("Paywall / OA")
        btn_graph_ws = QPushButton("Network Graph")

        btn_open_ws.setEnabled(False)
        btn_save_ws.setEnabled(False)
        btn_bib_ws.setEnabled(False)
        btn_oa_ws.setEnabled(False)
        btn_graph_ws.setEnabled(False)
        ws_btn_export.setEnabled(bool(initial_results))

        g = QGridLayout()
        g.addWidget(QLabel("Provider"), 0, 0)

        hbox = QHBoxLayout()
        hbox.addWidget(p, 1)
        hbox.addWidget(ws_provider_help, 0)
        g.addLayout(hbox, 0, 1)

        g.addWidget(QLabel("Sort"), 0, 2)
        g.addWidget(srt, 0, 3)

        g.addWidget(QLabel("Limit"), 0, 4)
        g.addWidget(lim, 0, 5)

        g.addWidget(QLabel("Query"), 1, 0)
        g.addWidget(q, 1, 1, 1, 5)

        g.addWidget(QLabel("Year from"), 2, 0)
        g.addWidget(yf, 2, 1)

        g.addWidget(QLabel("Year to"), 2, 2)
        g.addWidget(yt, 2, 3)

        g.addWidget(btn_run, 2, 4)

        g.addWidget(ws_export_fmt, 2, 5)
        g.addWidget(ws_btn_export, 3, 5)

        gb = QGroupBox("Controls")
        gb.setLayout(g)

        r_btns = QHBoxLayout()
        r_btns.addWidget(btn_open_ws)
        r_btns.addWidget(btn_save_ws)
        r_btns.addWidget(btn_bib_ws)
        r_btns.addWidget(btn_oa_ws)
        r_btns.addWidget(btn_graph_ws)

        splitter = QSplitter()

        left = QWidget()
        left_l = QVBoxLayout()
        left_l.addWidget(gb)
        left_l.addWidget(ws_view, 1)
        left.setLayout(left_l)

        right = QWidget()
        right_l = QVBoxLayout()
        right_l.addWidget(QLabel("Details"))
        right_l.addWidget(ws_right_stack, 1)  # <<< stack: details / graph
        right_l.addLayout(r_btns)

        right.setLayout(right_l)

        splitter.addWidget(left)
        splitter.addWidget(right)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

        lay.addWidget(splitter)
        panel.setLayout(lay)

        ws_id = tab_id or workspace_tab_id()
        panel.setProperty("ws_tab_id", ws_id)
        ws_state = {"results": initial_results or [], "fetched": 0, "selected": None}

        def ws_update_provider_ui():
            prov_name = p.currentText()
            spec = specs.get(prov_name) or {}

            ws_provider_help.setToolTip(provider_help_text(spec))

            pid = (spec.get("id") or "").strip()

            # Boolean operator support in query box:
            # - Elsevier/WoS/OpenAlex: yes
            # - Semantic/Crossref: no (in this app)
            # - COS: mixed (OpenAlex yes, others no)
            if pid in ("openalex", "elsevier", "wos"):
                q.setPlaceholderText("Query (supports AND OR NOT and parentheses)")
            elif pid == "cos":
                q.setPlaceholderText(
                    "Query (COS: mixed support; OpenAlex parses AND/OR/NOT, Semantic/Crossref treat as text)")
            else:
                q.setPlaceholderText('Query (AND/OR/() treated as text; use quotes for phrases)')

            # Year widgets enabled?
            year_ok = pid in ("semantic_scholar", "semantic_scholar_bulk", "crossref", "openalex", "elsevier", "wos", "cos")

            yf.setEnabled(year_ok)
            yt.setEnabled(year_ok)

            # Sort enabled?
            sort_ok = pid in ("crossref", "openalex", "elsevier", "wos", "semantic_scholar", "semantic_scholar_bulk", "cos")

            srt.setEnabled(sort_ok)

        def update_model(rows):
            import json
            from PyQt6.QtCore import Qt
            from PyQt6.QtGui import QStandardItemModel, QStandardItem
            from PyQt6.QtWidgets import QHeaderView

            if not isinstance(rows, list):
                rows = []

            all_keys = set()
            for r in rows:
                if isinstance(r, dict):
                    all_keys.update(r.keys())

            preferred = [
                "title", "authors", "year", "venue", "doi", "url",
                "external_id", "source", "abstract",
                "oa_status", "pdf_url", "open_access_pdf",
                "openalex_cited_by_count", "openalex_primary_location",
                "openalex_authorships", "openalex_x_concepts",
                "ss_citationCount", "ss_referenceCount", "ss_influentialCitationCount",
                "ss_isOpenAccess", "ss_fieldsOfStudy", "ss_s2FieldsOfStudy",
                "ss_publicationVenue", "ss_publicationDate", "ss_publicationTypes",
                "ss_journal", "ss_tldr", "ss_externalIds", "ss_paperId",
            ]

            cols = [c for c in preferred if c in all_keys]
            cols.extend(sorted([k for k in all_keys if k not in cols]))

            def pretty(k):
                mapping = {
                    "title": "Title",
                    "authors": "Authors",
                    "year": "Year",
                    "venue": "Venue",
                    "doi": "DOI",
                    "url": "URL",
                    "external_id": "External ID",
                    "oa_status": "OA Status",
                    "pdf_url": "PDF URL",
                    "open_access_pdf": "Open Access PDF",
                    "source": "Source",
                    "abstract": "Abstract",
                    "openalex_cited_by_count": "Cited By (OpenAlex)",
                    "openalex_primary_location": "Primary Location (OpenAlex)",
                    "openalex_authorships": "Authorships (OpenAlex)",
                    "openalex_x_concepts": "Concepts (OpenAlex)",
                    "ss_citationCount": "Citations (Semantic)",
                    "ss_referenceCount": "References (Semantic)",
                    "ss_influentialCitationCount": "Influential (Semantic)",
                    "ss_isOpenAccess": "Open Access (Semantic)",
                    "ss_fieldsOfStudy": "Fields (Semantic)",
                    "ss_s2FieldsOfStudy": "S2 Fields (Semantic)",
                    "ss_publicationVenue": "Publication Venue (Semantic)",
                    "ss_publicationDate": "Publication Date (Semantic)",
                    "ss_publicationTypes": "Publication Types (Semantic)",
                    "ss_journal": "Journal (Semantic)",
                    "ss_tldr": "TL;DR (Semantic)",
                    "ss_externalIds": "External IDs (Semantic)",
                    "ss_paperId": "Paper ID (Semantic)",
                }
                return mapping.get(k, k)

            def cell_text(v):
                if v is None:
                    return ""
                if isinstance(v, (dict, list)):
                    try:
                        return json.dumps(v, ensure_ascii=False)
                    except Exception:
                        return str(v)
                return str(v)

            m = QStandardItemModel()
            m.setColumnCount(len(cols))
            m.setHorizontalHeaderLabels([pretty(k) for k in cols])

            for r in rows:
                if not isinstance(r, dict):
                    continue
                row_items = []
                for j, key in enumerate(cols):
                    val = r.get(key)
                    if key == "doi":
                        val = normalize_doi(val or "")
                    it = QStandardItem(cell_text(val))
                    it.setEditable(False)
                    if j == 0:
                        it.setData(r, Qt.ItemDataRole.UserRole)
                    row_items.append(it)
                m.appendRow(row_items)

            proxy = QSortFilterProxyModel(ws_view)
            proxy.setSourceModel(m)
            proxy.setDynamicSortFilter(True)

            ws_view.setModel(proxy)
            ws_view.setSortingEnabled(True)

            ws_view.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
            ws_view.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
            ws_view.setWordWrap(False)
            ws_view.setTextElideMode(Qt.TextElideMode.ElideRight)

            hdr = ws_view.horizontalHeader()
            hdr.setStretchLastSection(False)

            if len(cols) > 0:
                hdr.setSectionResizeMode(0, QHeaderView.ResizeMode.Interactive)
                ws_view.setColumnWidth(0, 520)

            for c in range(1, len(cols)):
                hdr.setSectionResizeMode(c, QHeaderView.ResizeMode.Interactive)

            try:
                ws_view.resizeColumnsToContents()
            except Exception:
                pass

        if initial_results:
            update_model(initial_results)

        def run_ws_search():
            from PyQt6.QtCore import QTimer
            from PyQt6.QtNetwork import QNetworkReply

            prov = (p.currentText() or "").strip()
            qtxt = (q.text() or "").strip()
            if not qtxt:
                return

            target_limit = int(lim.value() or 0)  # 0 => "All"
            want_all = (target_limit == 0)

            y1 = int(yf.value() or 0)
            y2 = int(yt.value() or 0)
            y1 = y1 if y1 > 0 else None
            y2 = y2 if y2 > 0 else None

            sort_mode = (srt.currentText() or "").strip() or "relevance"

            ws_btn_export.setEnabled(False)
            btn_run.setEnabled(False)
            ws_state["fetched"] = 0

            pbar.setValue(0)
            log(f"WS: Starting search on {prov}...")

            def finish(reason: str, rows_raw: list):
                merged = deduplicate_and_merge_rows(rows_raw or [])

                ws_state["results"] = merged
                update_model(merged)

                ws_btn_export.setEnabled(bool(merged))
                btn_run.setEnabled(True)

                cfg = {
                    "query": qtxt,
                    "provider": prov,
                    "sort": (srt.currentText() or "").strip(),
                    "limit": target_limit,
                    "year_from": int(yf.value() or 0),
                    "year_to": int(yt.value() or 0),
                }
                ws_save_tab(ws_id, qtxt, cfg, merged)

                pbar.setValue(100 if merged else 0)
                log(f"WS Finished: raw={len(rows_raw)} merged={len(merged)} ({reason}).")

            if prov.strip().upper() == "COS":
                providers = ["Crossref", "OpenAlex", "Semantic Scholar"]
                all_rows = []
                ws_state["fetched"] = 0

                if want_all:
                    per_provider_limit = 100
                else:
                    per_provider_limit = max(10, int(target_limit / max(1, len(providers))))

                def fetch_provider(i: int):
                    if i >= len(providers):
                        finish("done", all_rows)
                        return

                    prov_i = providers[i]
                    spec_i = specs.get(prov_i) or {}
                    search_i = spec_i.get("search") or {}
                    if not search_i:
                        log(f"WS COS: provider '{prov_i}' missing search spec, skipped.")
                        QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                        return

                    build = search_i.get("build")
                    parse = search_i.get("parse")
                    headers_fn = search_i.get("headers")
                    if not callable(build) or not callable(parse) or not callable(headers_fn):
                        log(f"WS COS: provider '{prov_i}' incomplete search config, skipped.")
                        QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                        return

                    hdrs = headers_fn() or {}

                    cursor0 = 0
                    url = build(qtxt, y1, y2, per_provider_limit, cursor0, sort_mode)
                    log(f"WS COS: {prov_i}: fetching (limit={per_provider_limit}, cursor={cursor0})")

                    def on_done(err, status, data, cached):
                        if cached:
                            log(f"Cache hit (WS COS): {prov_i} cursor={cursor0}")

                        if err != QNetworkReply.NetworkError.NoError:
                            log(f"WS COS: {prov_i}: network err={err} http={status} (skipping)")
                            QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                            return

                        if status not in (200, 201):
                            log(f"WS COS: {prov_i}: http error {status} (skipping)")
                            QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                            return

                        try:
                            rows, total, next_cursor = parse(data)
                        except Exception as e:
                            log(f"WS COS: {prov_i}: parse error {e} (skipping)")
                            QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                            return

                        if rows:
                            all_rows.extend(rows)

                        ws_state["fetched"] = len(all_rows)

                        if not want_all and target_limit > 0:
                            merged_now = deduplicate_and_merge_rows(all_rows)
                            pct = int((min(target_limit, len(merged_now)) / max(1, target_limit)) * 100)
                            pbar.setValue(min(95, max(0, pct)))
                        else:
                            pbar.setValue(min(95, int(((i + 1) / max(1, len(providers))) * 100)))

                        QTimer.singleShot(0, lambda: fetch_provider(i + 1))

                    request_json(
                        prov_i,
                        url,
                        hdrs,
                        on_done,
                        {"ws": True, "cursor": cursor0, "cos": True, "provider": prov_i},
                    )

                fetch_provider(0)
                return

            spec = specs.get(prov) or {}
            search_spec = spec.get("search") or {}
            if not search_spec:
                QMessageBox.warning(win, "Provider", "Search not configured for this provider.")
                btn_run.setEnabled(True)
                return

            build = search_spec.get("build")
            parse = search_spec.get("parse")
            headers_fn = search_spec.get("headers")
            if not callable(build) or not callable(parse) or not callable(headers_fn):
                QMessageBox.information(win, "Provider", "Provider search configuration is incomplete.")
                btn_run.setEnabled(True)
                return

            hdrs = headers_fn() or {}

            all_rows = []
            ws_state["fetched"] = 0
            cursor0 = 0

            def fetch(cursor):
                req_limit = 100
                if not want_all:
                    rem = target_limit - len(all_rows)
                    if rem <= 0:
                        finish("target limit reached", all_rows)
                        return
                    req_limit = min(rem, 100)

                url = build(qtxt, y1, y2, req_limit, cursor, sort_mode)
                log(f"WS: Fetching batch. (cursor={cursor} total_so_far={len(all_rows)})")

                def on_done(err, status, data, cached):
                    if cached:
                        log(f"Cache hit (WS): {prov} cursor={cursor}")

                    if err != QNetworkReply.NetworkError.NoError:
                        finish(f"network err={err} http={status}", all_rows)
                        return

                    if status not in (200, 201):
                        finish(f"http error {status}", all_rows)
                        return

                    try:
                        rows, total, next_cursor = parse(data)
                    except Exception as e:
                        log(f"WS parse error: {e}")
                        finish("parse exception", all_rows)
                        return

                    rows = rows or []
                    if rows:
                        all_rows.extend(rows)

                    ws_state["fetched"] = len(all_rows)

                    if not want_all and target_limit > 0:
                        pct = int((len(all_rows) / max(1, target_limit)) * 100)
                        pbar.setValue(min(95, max(0, pct)))
                    else:
                        pbar.setValue(min(95, max(0, pbar.value() + 5)))

                    if not rows:
                        finish("no more rows returned", all_rows)
                        return

                    if not want_all and len(all_rows) >= target_limit:
                        finish("limit reached", all_rows)
                        return

                    if not next_cursor:
                        finish("no next page cursor", all_rows)
                        return

                    if isinstance(next_cursor, int) and isinstance(cursor, int) and next_cursor <= cursor:
                        finish("cursor stuck", all_rows)
                        return

                    QTimer.singleShot(100, lambda: fetch(next_cursor))

                request_json(
                    prov,
                    url,
                    hdrs,
                    on_done,
                    {"ws": True, "cursor": cursor, "provider": prov},
                )

            fetch(cursor0)

        def ws_set_selected(rec):
            ws_state["selected"] = rec
            _dbg_preview_record(rec, "SELECTED")

            if not rec:
                ws_info.setHtml("")
                btn_open_ws.setEnabled(False)
                btn_save_ws.setEnabled(False)
                btn_bib_ws.setEnabled(False)
                btn_oa_ws.setEnabled(False)
                btn_graph_ws.setEnabled(False)
                return

            tags_html = ""
            doi = normalize_doi(rec.get("doi") or "")
            if doi:
                pid = sql_scalar("SELECT id FROM papers WHERE doi = :d", {":d": doi})
                if pid:
                    tags = db_get_tags(pid)
                    if tags:
                        tags_html = f"<p><b>Tags:</b> {', '.join(tags)}</p>"

            html = (
                f"<h3>{rec.get('title')}</h3>"
                f"<p>{rec.get('year')} {rec.get('venue')}</p>"
                f"<p><i>{rec.get('authors')}</i></p>"
                f"<hr><p>{rec.get('abstract')}</p>"
                f"{tags_html}"
            )
            ws_info.setHtml(html)

            btn_open_ws.setEnabled(bool(rec.get("url")))
            btn_save_ws.setEnabled(True)
            btn_bib_ws.setEnabled(True)
            btn_graph_ws.setEnabled(True)

            has_oa = bool(specs.get("Paywall check (Unpaywall by DOI)", {}).get("key_present"))
            btn_oa_ws.setEnabled(has_oa and bool(doi))

        def on_ws_select():
            idx = ws_view.selectionModel().currentIndex()
            if not idx.isValid():
                return
            model = ws_view.model()
            if isinstance(model, QSortFilterProxyModel):
                idx = model.mapToSource(idx)
            rec = idx.siblingAtColumn(0).data(Qt.ItemDataRole.UserRole)
            ws_set_selected(rec)

        def ws_launch_graph():
            rec = ws_state.get("selected")
            if not isinstance(rec, dict):
                return

            rows = ws_state.get("results") or []
            if not isinstance(rows, list) or not rows:
                QMessageBox.information(win, "Graph",
                                        "No workspace results to build a graph from. Run a workspace search first.")
                return

            prov_name = p.currentText()
            prov_spec = (specs.get(prov_name) or {})
            prov_id = (prov_spec.get("id") or "").strip()

            print("\n[WS_GRAPH_BTN] Build graph from FULL workspace result list", flush=True)
            print(f"[WS_GRAPH_BTN] provider={prov_name} id={prov_id} rows={len(rows)}", flush=True)

            seed_node = record_to_graph_seed_node(rec)
            print(f"[WS_GRAPH_BTN] seed_node.id={seed_node.get('data', {}).get('id')!r}", flush=True)
            print(f"[WS_GRAPH_BTN] seed_node.title={seed_node.get('data', {}).get('title')!r}", flush=True)

            try:
                from Search_engine.Citations_graph.Graph_widget import ConnectedPapersLikeGraph
            except Exception as e:
                QMessageBox.critical(win, "Graph import failed", f"Could not import Graph_widget. Error:\n{e}")
                return

            # Remove previous embedded graph (if any)
            old = ws_graph_state.get("widget")
            if old is not None:
                try:
                    ws_graph_state["host_layout"].removeWidget(old)
                except Exception:
                    pass
                old.setParent(None)
                old.deleteLater()
                ws_graph_state["widget"] = None

            g = ConnectedPapersLikeGraph(seed_input="", parent=ws_graph_host)

            # Inject full context
            if hasattr(g, "set_seed_node"):
                g.set_seed_node(seed_node)
            else:
                g._seed_node = seed_node

            if hasattr(g, "set_records"):
                g.set_records(rows)
            else:
                g._all_records = rows

            headers_fn = (prov_spec.get("search") or {}).get("headers")
            headers = (headers_fn() or {}) if callable(headers_fn) else {}

            env0 = env if isinstance(env, dict) else {}
            semantic_key = (env0.get("SEMANTIC_API") or env0.get("SEMANTIC_SCHOLAR_API_KEY") or "").strip()

            if hasattr(g, "set_provider_context"):
                g.set_provider_context(
                    provider_id=prov_id,
                    provider_name=prov_name,
                    headers=headers,
                    semantic_api_key=semantic_key,
                )
            else:
                g._provider_id = prov_id
                g._provider_name = prov_name
                g._headers = headers
                g._semantic_api_key = semantic_key

            ws_graph_state["host_layout"].addWidget(g)
            ws_graph_state["widget"] = g

            ws_graph_state["stack"].setCurrentIndex(1)

            try:
                QTimer.singleShot(0, g.build)
            except Exception:
                pass

        def ws_save_lib():
            rec = ws_state.get("selected")
            if rec and insert_paper(rec):
                lib_model.select()
                log("WS: Saved to library.")

        def ws_export():
            rows = ws_state["results"]
            if not rows:
                return
            fmt = ws_export_fmt.currentText()
            path, _ = QFileDialog.getSaveFileName(win, f"Export {fmt}", f"ws.{fmt.lower()}", f"*.{fmt.lower()}")
            if not path:
                return
            if fmt == "CSV":
                export_rows_csv(rows, path)
            if fmt == "XLSX":
                export_rows_xlsx(rows, path)
            if fmt == "RIS":
                export_rows_ris(rows, path)

        p.currentTextChanged.connect(ws_update_provider_ui)
        btn_run.clicked.connect(run_ws_search)
        ws_btn_export.clicked.connect(ws_export)
        ws_view.clicked.connect(on_ws_select)

        btn_graph_ws.clicked.connect(ws_launch_graph)
        btn_save_ws.clicked.connect(ws_save_lib)
        btn_open_ws.clicked.connect(
            lambda: QDesktopServices.openUrl(QUrl(ws_state["selected"]["url"])) if ws_state["selected"] else None)

        ws_view.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)

        def ws_show_menu(pos):
            m = QMenu()
            a1 = m.addAction("Snowball: References")
            a2 = m.addAction("Snowball: Citations")
            act = m.exec(ws_view.mapToGlobal(pos))
            if act == a1:
                run_snowball("references", from_ws=ws_state.get("selected"))
            if act == a2:
                run_snowball("citations", from_ws=ws_state.get("selected"))

        ws_view.customContextMenuRequested.connect(ws_show_menu)

        ws_update_provider_ui()
        ws_btn_export.setEnabled(bool(ws_state["results"]))

        title = (initial_title or q.text() or "Search").strip()
        idx = workspace_tabs.addTab(panel, title[:20])
        workspace_tabs.setCurrentIndex(idx)

    def restore_workspace_tabs():
        from PyQt6.QtCore import QTimer

        rows = ws_load_tabs() or []
        i = 0

        def step():
            nonlocal i
            if i >= len(rows):
                return

            tab_id, title, cfg, res = rows[i]
            i += 1

            try:
                clone_search_to_workspace(tab_id, cfg, res, title)
            except Exception as e:
                print(f"[workspace_restore] tab_id={tab_id} failed: {e}", flush=True)

            QTimer.singleShot(0, step)

        QTimer.singleShot(0, step)

    # --- 6. CORE APP LOGIC (Now defined AFTER helpers) ---

    # Define request_json helper (Network logic)
    queue = []
    mem_cache = {}



    def cache_get(cache_key):
        if cache_key in mem_cache:
            return mem_cache[cache_key]
        s = sql_scalar("SELECT response_json FROM request_cache WHERE cache_key = :k", {"k": cache_key})
        if not s:
            return None
        payload = json.loads(s)
        mem_cache[cache_key] = payload
        return payload

    def cache_put(cache_key, provider_name, url, payload):
        mem_cache[cache_key] = payload
        sql_exec(
            """
            INSERT OR REPLACE INTO request_cache (cache_key, provider, url, response_json, created_at)
            VALUES (:k, :p, :u, :r, :t)
            """,
            {
                "k": cache_key,
                "p": provider_name,
                "u": (url.toString() if isinstance(url, QUrl) else str(url)),
                "r": json.dumps(payload, ensure_ascii=False),
                "t": now_iso(),
            },
        )

    def cache_key_for(provider_name, url, headers, context):
        u = url if isinstance(url, QUrl) else QUrl(str(url))
        url_s = bytes(u.toEncoded()).decode("utf-8", errors="replace")
        h = headers or {}

        auth_keys = ("x-api-key", "x-els-apikey", "x-apikey", "authorization")
        auth_pairs = []
        for k, v in h.items():
            if v is None:
                continue
            k_l = str(k).strip().lower()
            if k_l in auth_keys:
                auth_pairs.append((k_l, str(v)))

        auth_pairs.sort()
        auth_blob = json.dumps(auth_pairs, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        auth_sig = hashlib.sha256(auth_blob).hexdigest() if auth_pairs else ""

        key_bits = {
            "provider": str(provider_name),
            "url": url_s,
            "auth_sig": auth_sig,
            "context": (context or {}),
        }
        blob = json.dumps(key_bits, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(blob).hexdigest()

    def request_json(prov, url, headers, callback, ctx):
        import requests
        from PyQt6.QtNetwork import QSslSocket

        hdrs = headers or {}
        ck = cache_key_for(prov, url, hdrs, ctx or {})
        cached_payload = cache_get(ck)
        if cached_payload is not None:
            callback(QNetworkReply.NetworkError.NoError, 200, cached_payload, True)
            return

        qurl = url if isinstance(url, QUrl) else QUrl(str(url))

        if not QSslSocket.supportsSsl():
            final_url = qurl.toString()
            r = requests.get(final_url, headers=hdrs, timeout=25)

            status = int(r.status_code or 0)
            payload = {}
            body0 = (r.content or b"").lstrip()

            if body0[:1] in (b"{", b"["):
                payload = json.loads(body0.decode("utf-8", errors="replace"))
            else:
                txt = body0[:200].decode("utf-8", errors="replace") if body0 else ""
                log(f"Non-JSON reply ({prov}) status={status} err=requests: {txt}")

            ok_http = status in (200, 201)
            err = QNetworkReply.NetworkError.NoError if ok_http else QNetworkReply.NetworkError.UnknownNetworkError

            if ok_http:
                cache_put(ck, prov, QUrl(r.url), payload)

            callback(err, status, payload, False)
            return

        req = QNetworkRequest(qurl)

        attr = getattr(QNetworkRequest.Attribute, "RedirectPolicyAttribute", None)
        policy = getattr(QNetworkRequest.RedirectPolicy, "NoLessSafeRedirectPolicy", None)
        if attr is not None and policy is not None:
            req.setAttribute(attr, policy)

        for k, v in hdrs.items():
            if v is None:
                continue
            req.setRawHeader(str(k).encode("utf-8"), str(v).encode("utf-8"))

        reply = net.get(req)

        def on_ssl_errors(errs):
            parts = []
            for e in errs or []:
                parts.append(str(getattr(e, "errorString", lambda: "")()) or str(e))
            msg = "; ".join([p for p in parts if p])
            log(f"SSL errors ({prov}): {msg}")

        if hasattr(reply, "sslErrors"):
            reply.sslErrors.connect(on_ssl_errors)

        def on_repl():
            status = reply.attribute(QNetworkRequest.Attribute.HttpStatusCodeAttribute)
            status = int(status) if status is not None else 0
            err = reply.error()
            body = bytes(reply.readAll())

            payload = {}
            body0 = body.lstrip()
            if body0[:1] in (b"{", b"["):
                payload = json.loads(body0.decode("utf-8", errors="replace"))
            else:
                txt = body0[:200].decode("utf-8", errors="replace") if body0 else ""
                log(f"Non-JSON reply ({prov}) status={status} err={err}: {txt}")

            ok_http = (err == QNetworkReply.NetworkError.NoError) and (status in (200, 201))
            if ok_http:
                cache_put(ck, prov, reply.url(), payload)

            callback(err, status, payload, False)
            reply.deleteLater()

        reply.finished.connect(on_repl)

    # Define Snowball Logic (Uses clone_search_to_workspace)
    def run_snowball(direction, from_ws=None):
        rec = from_ws if isinstance(from_ws, dict) else (state.get("selected") if isinstance(state, dict) else None)
        if not isinstance(rec, dict):
            return

        pid = rec.get("external_id") or ""
        doi = (rec.get("doi") or "").strip()
        if not pid and doi:
            pid = f"DOI:{doi}"
        if not pid:
            QMessageBox.warning(win, "Error", "No ID for snowballing")
            return

        target_url = f"https://api.semanticscholar.org/graph/v1/paper/{pid}/{direction}"

        env0 = env if isinstance(env, dict) else (env_loaded if isinstance(env_loaded, dict) else {})
        raw_key = (env0.get("SEMANTIC_API") or env0.get("SEMANTIC_SCHOLAR_API_KEY") or "").strip()

        log(f"Snowballing {direction}...")

        def on_done(err, status, data, cached):
            if cached:
                log(f"Snowball cache hit: {direction} pid={pid}")

            if err != QNetworkReply.NetworkError.NoError or status not in (200, 201):
                log(f"Snowball failed: http={status} err={err}")
                return

            rows, _, _ = specs["Semantic Scholar"]["search"]["parse"](data)

            title = (rec.get("title") or "Paper").strip()
            clone_search_to_workspace(
                initial_results=rows,
                initial_title=f"{direction}: {title[:10]}",
                initial_cfg={"query": f"{direction} of {title}"},
            )
            log(f"Snowball complete. {len(rows)} results.")

        qurl = QUrl(
            qurl_with_query(
                target_url,
                {
                    "limit": 200,
                    "fields": ",".join(
                        [
                            "paperId",
                            "externalIds",
                            "title",
                            "abstract",
                            "year",
                            "venue",
                            "publicationVenue",
                            "publicationDate",
                            "publicationTypes",
                            "journal",
                            "url",
                            "authors",
                            "citationCount",
                            "referenceCount",
                            "influentialCitationCount",
                            "isOpenAccess",
                            "openAccessPdf",
                            "fieldsOfStudy",
                            "s2FieldsOfStudy",
                            "tldr",
                        ]
                    ),
                },
            )
        )
        hdrs = {"x-api-key": raw_key} if raw_key else {}
        request_json("Snowball", qurl, hdrs, on_done, {"snowball": True, "direction": direction, "pid": pid})

    # Define on_provider_changed
    def on_provider_changed():
        p = provider_combo.currentText()
        state["provider"] = p
        google_note.setVisible(p == "Google (no official API)")
        set_status(sb, f"Provider: {p}")

    # Define Results List Logic
    results_model = None
    results_proxy = None

    def set_results(rows):
        """
        Build a results table with dynamic columns (union of keys across rows),
        stable preferred ordering, and a QTableView configuration that actually
        exposes all columns (horizontal scroll enabled).
        """
        nonlocal results_model, results_proxy

        import json
        from PyQt6.QtCore import Qt
        from PyQt6.QtGui import QStandardItemModel, QStandardItem
        from PyQt6.QtWidgets import QHeaderView

        # Defensive normalisation
        if not isinstance(rows, list):
            rows = []

        results_model = QStandardItemModel()

        # 1) Union of all keys across rows
        all_keys: set[str] = set()
        for r in rows:
            if isinstance(r, dict):
                all_keys.update(r.keys())

        # 2) Stable preferred ordering, then append anything else (sorted)
        preferred = [
            # Common core (keep first)
            "title", "authors", "year", "venue", "doi", "url",
            "external_id", "source", "abstract",

            # OA / PDFs
            "oa_status", "pdf_url", "open_access_pdf",

            # OpenAlex-specific
            "openalex_cited_by_count", "openalex_primary_location",
            "openalex_authorships", "openalex_x_concepts",

            # Semantic Scholar-specific
            "ss_citationCount", "ss_referenceCount", "ss_influentialCitationCount",
            "ss_isOpenAccess", "ss_fieldsOfStudy", "ss_s2FieldsOfStudy",
            "ss_publicationVenue", "ss_publicationDate", "ss_publicationTypes",
            "ss_journal", "ss_tldr", "ss_externalIds", "ss_paperId",
        ]

        cols = [c for c in preferred if c in all_keys]
        remaining = sorted([k for k in all_keys if k not in cols])
        cols.extend(remaining)

        # 3) Pretty headers
        def pretty(k: str) -> str:
            mapping = {
                "title": "Title",
                "authors": "Authors",
                "year": "Year",
                "venue": "Venue",
                "doi": "DOI",
                "url": "URL",
                "external_id": "External ID",
                "oa_status": "OA Status",
                "pdf_url": "PDF URL",
                "open_access_pdf": "Open Access PDF",
                "source": "Source",
                "abstract": "Abstract",
                "openalex_cited_by_count": "Cited By (OpenAlex)",
                "openalex_primary_location": "Primary Location (OpenAlex)",
                "openalex_authorships": "Authorships (OpenAlex)",
                "openalex_x_concepts": "Concepts (OpenAlex)",
                "ss_citationCount": "Citations (Semantic)",
                "ss_referenceCount": "References (Semantic)",
                "ss_influentialCitationCount": "Influential (Semantic)",
                "ss_isOpenAccess": "Open Access (Semantic)",
                "ss_fieldsOfStudy": "Fields (Semantic)",
                "ss_s2FieldsOfStudy": "S2 Fields (Semantic)",
                "ss_publicationVenue": "Publication Venue (Semantic)",
                "ss_publicationDate": "Publication Date (Semantic)",
                "ss_publicationTypes": "Publication Types (Semantic)",
                "ss_journal": "Journal (Semantic)",
                "ss_tldr": "TL;DR (Semantic)",
                "ss_externalIds": "External IDs (Semantic)",
                "ss_paperId": "Paper ID (Semantic)",
            }
            return mapping.get(k, k)

        results_model.setColumnCount(len(cols))
        results_model.setHorizontalHeaderLabels([pretty(k) for k in cols])

        # Helper: keep DOI display consistent
        def _norm_doi(val) -> str:
            try:
                return normalize_doi(val or "")
            except Exception:
                return str(val or "")

        # Helper: stringify nested structures for table cells
        def _cell_text(val) -> str:
            if val is None:
                return ""
            if isinstance(val, (dict, list)):
                try:
                    return json.dumps(val, ensure_ascii=False)
                except Exception:
                    return str(val)
            return str(val)

        # 4) Fill model rows
        for r in rows:
            if not isinstance(r, dict):
                continue

            row_items = []
            for j, key in enumerate(cols):
                val = r.get(key)

                if key == "doi":
                    val = _norm_doi(val)

                text = _cell_text(val)
                item = QStandardItem(text)
                item.setEditable(False)

                # Store full record on the first column item
                if j == 0:
                    item.setData(r, Qt.ItemDataRole.UserRole)

                row_items.append(item)

            results_model.appendRow(row_items)

        # 5) Proxy + view wiring
        results_proxy = QSortFilterProxyModel()
        results_proxy.setSourceModel(results_model)
        results_proxy.setDynamicSortFilter(True)

        results_view.setModel(results_proxy)
        results_view.setSortingEnabled(True)

        # 6) Force the table to actually expose all columns
        results_view.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        results_view.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        results_view.setWordWrap(False)
        results_view.setTextElideMode(Qt.TextElideMode.ElideRight)

        hdr = results_view.horizontalHeader()
        hdr.setStretchLastSection(False)

        # Title column should be usable; others should not collapse.
        if len(cols) > 0:
            hdr.setSectionResizeMode(0, QHeaderView.ResizeMode.Interactive)
            results_view.setColumnWidth(0, 520)

        # For everything else: interactive + reasonable initial sizing
        for c in range(1, len(cols)):
            hdr.setSectionResizeMode(c, QHeaderView.ResizeMode.Interactive)

        # Optional: do one pass of resize-to-contents to give sensible defaults,
        # without locking future interaction.

    def set_selected(rec):
        state["selected"] = rec
        if not rec:
            details.setHtml("")
            btn_open.setEnabled(False)
            btn_save.setEnabled(False)
            btn_bib.setEnabled(False)
            btn_oa.setEnabled(False)
            btn_graph.setEnabled(False)
            return

        tags_html = ""
        doi = normalize_doi(rec.get("doi") or "")
        if doi:
            pid = sql_scalar("SELECT id FROM papers WHERE doi = :d", {":d": doi})
            if pid:
                tags = db_get_tags(pid)
                if tags:
                    tags_html = f"<p><b>Tags:</b> {', '.join(tags)}</p>"

        html = (
            f"<h3>{rec.get('title')}</h3>"
            f"<p>{rec.get('year')} {rec.get('venue')}</p>"
            f"<p><i>{rec.get('authors')}</i></p>"
            f"<hr><p>{rec.get('abstract')}</p>"
            f"{tags_html}"
        )
        details.setHtml(html)

        btn_open.setEnabled(bool(rec.get("url")))
        btn_save.setEnabled(True)
        btn_bib.setEnabled(True)

        has_oa = bool(specs.get("Paywall check (Unpaywall by DOI)", {}).get("key_present"))
        btn_oa.setEnabled(has_oa and bool(doi))

        btn_graph.setEnabled(True)

    def on_result_selected():
        idx = results_view.selectionModel().currentIndex()
        if not idx.isValid(): return
        if isinstance(results_view.model(), QSortFilterProxyModel): idx = results_view.model().mapToSource(idx)
        rec = idx.siblingAtColumn(0).data(Qt.ItemDataRole.UserRole)
        set_selected(rec)

    # Define Main Search Logic
    def do_search(offset):
        import re
        import json
        from PyQt6.QtCore import QTimer
        from PyQt6.QtNetwork import QNetworkReply
        from PyQt6.QtWidgets import QMessageBox

        prov = (provider_combo.currentText() or "").strip()
        qtxt = (query_input.text() or "").strip()
        if not qtxt:
            return

        # -----------------------------
        # State + filters
        # -----------------------------
        state["page_offset"] = int(offset or 0)
        state["page_limit"] = int(limit_spin.value() or 0)  # 0 => "All"
        want_all = (state["page_limit"] == 0)
        target_limit = state["page_limit"]

        y1 = int(year_from.value() or 0)
        y2 = int(year_to.value() or 0)
        y1 = y1 if y1 > 0 else None
        y2 = y2 if y2 > 0 else None

        sort_mode = (sort_combo.currentText() or "").strip() or "relevance"

        # -----------------------------
        # Normalisation / dedupe helpers
        # -----------------------------
        def _norm_title(s: str) -> str:
            t = (s or "").strip().lower()
            t = re.sub(r"\s+", " ", t)
            t = re.sub(r"[^\w\s\-:;,.\(\)\[\]']", "", t)
            return t

        def _norm_doi(s: str) -> str:
            ss = (s or "").strip()
            ss = re.sub(r"^https?://(dx\.)?doi\.org/", "", ss, flags=re.I).strip()
            return ss

        def _dedupe_key(rec: dict):
            doi = _norm_doi(rec.get("doi") or "")
            if doi:
                return ("doi", doi)

            title = _norm_title(rec.get("title") or rec.get("label") or "")
            year = rec.get("year")
            try:
                year = int(year) if year not in (None, "", "n/a") else 0
            except Exception:
                year = 0

            return ("ty", title, year)

        def _is_empty(v):
            if v is None:
                return True
            if isinstance(v, str) and not v.strip():
                return True
            if isinstance(v, (list, dict)) and not v:
                return True
            return False

        def _merge_values(a, b):
            """
            Merge b into a (preferring non-empty).
            - strings: keep a if non-empty else b
            - dicts: shallow merge; keep existing keys unless empty
            - lists: concatenate unique where feasible
            """
            if _is_empty(a) and not _is_empty(b):
                return b
            if not _is_empty(a) and _is_empty(b):
                return a
            if _is_empty(a) and _is_empty(b):
                return a

            if isinstance(a, dict) and isinstance(b, dict):
                out = dict(a)
                for k, vb in b.items():
                    va = out.get(k)
                    if _is_empty(va) and not _is_empty(vb):
                        out[k] = vb
                    elif isinstance(va, dict) and isinstance(vb, dict):
                        out[k] = _merge_values(va, vb)
                return out

            if isinstance(a, list) and isinstance(b, list):
                seen = set()
                out = []
                for x in a + b:
                    try:
                        key = json.dumps(x, sort_keys=True, ensure_ascii=False)
                    except Exception:
                        key = str(x)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(x)
                return out

            # default: keep a
            return a

        def dedupe_and_merge(rows):
            """
            Deduplicate and merge records:
              key = DOI else (title+year)
            """
            merged = {}
            order = []
            for r in rows or []:
                if not isinstance(r, dict):
                    continue
                k = _dedupe_key(r)
                if k not in merged:
                    merged[k] = dict(r)
                    order.append(k)
                else:
                    base = merged[k]
                    for kk, vv in r.items():
                        base[kk] = _merge_values(base.get(kk), vv)

                    # combine sources
                    s0 = base.get("source")
                    s1 = r.get("source")
                    if isinstance(s0, str) and isinstance(s1, str) and s0 and s1 and s0 != s1:
                        base["source"] = ",".join(
                            sorted(
                                set(
                                    x.strip()
                                    for x in (s0 + "," + s1).split(",")
                                    if x.strip()
                                )
                            )
                        )
            return [merged[k] for k in order]

        # -----------------------------
        # UI pre-state
        # -----------------------------
        pbar.setValue(0)
        log(f"Searching {prov}...")
        export_format.setEnabled(False)
        btn_export.setEnabled(False)

        # -----------------------------
        # Shared finish()
        # -----------------------------
        def finish(reason: str, rows_raw: list):
            merged = deduplicate_and_merge_rows(rows_raw or [])

            state["results"] = merged
            set_results(merged)

            has_rows = bool(merged)
            export_format.setEnabled(has_rows)
            btn_export.setEnabled(has_rows)

            pbar.setValue(100 if has_rows else 0)
            log(f"{prov}: raw={len(rows_raw)} merged={len(merged)} ({reason}).")

        # -----------------------------
        # COS: Crossref + OpenAlex + Semantic Scholar
        # (single orchestrator; removes the duplicate ws_* branch)
        # -----------------------------
        if prov.strip().upper() == "COS":
            providers = ["Crossref", "OpenAlex", "Semantic Scholar"]
            all_rows = []
            state["fetched"] = 0

            # Keep COS light: one page per provider by default.
            if want_all:
                per_provider_limit = 100
            else:
                per_provider_limit = max(10, int(target_limit / max(1, len(providers))))

            def fetch_provider(i: int):
                if i >= len(providers):
                    finish("done", all_rows)
                    return

                prov_i = providers[i]
                spec_i = specs.get(prov_i) or {}
                search_i = spec_i.get("search") or {}
                if not search_i:
                    log(f"COS: provider '{prov_i}' missing search spec, skipped.")
                    QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                    return

                build = search_i.get("build")
                parse = search_i.get("parse")
                headers_fn = search_i.get("headers")
                if not callable(build) or not callable(parse) or not callable(headers_fn):
                    log(f"COS: provider '{prov_i}' incomplete search config, skipped.")
                    QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                    return

                hdrs = headers_fn() or {}

                # Cursor semantics are provider-dependent; your build() should handle it.
                cursor0 = 0
                url = build(qtxt, y1, y2, per_provider_limit, cursor0, sort_mode)
                log(f"COS: {prov_i}: fetching (limit={per_provider_limit}, cursor={cursor0})")

                def on_done(err, status, data, cached):
                    if cached:
                        log(f"Cache hit (COS): {prov_i} cursor={cursor0}")

                    if err != QNetworkReply.NetworkError.NoError:
                        log(f"COS: {prov_i}: network err={err} http={status} (skipping)")
                        QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                        return

                    if status not in (200, 201):
                        log(f"COS: {prov_i}: http error {status} (skipping)")
                        QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                        return

                    try:
                        rows, total, next_cursor = parse(data)
                    except Exception as e:
                        log(f"COS: {prov_i}: parse error {e} (skipping)")
                        QTimer.singleShot(0, lambda: fetch_provider(i + 1))
                        return

                    if rows:
                        all_rows.extend(rows)

                    state["fetched"] = len(all_rows)

                    # progress (rough)
                    if not want_all and target_limit > 0:
                        try:
                            merged_now = dedupe_and_merge(all_rows)
                            pct = int((min(target_limit, len(merged_now)) / max(1, target_limit)) * 100)
                            pbar.setValue(min(95, max(0, pct)))
                        except Exception:
                            pbar.setValue(min(95, int(((i + 1) / max(1, len(providers))) * 100)))
                    else:
                        pbar.setValue(min(95, int(((i + 1) / max(1, len(providers))) * 100)))

                    # One page per provider (by design)
                    QTimer.singleShot(0, lambda: fetch_provider(i + 1))

                request_json(
                    prov_i,
                    url,
                    hdrs,
                    on_done,
                    {"main_search": True, "cursor": cursor0, "cos": True, "provider": prov_i},
                )

            fetch_provider(0)
            return

        # -----------------------------
        # Standard single-provider search
        # -----------------------------
        spec = specs.get(prov) or {}
        search_spec = spec.get("search") or {}
        if not search_spec:
            QMessageBox.warning(win, "Provider", "Search not configured for this provider.")
            return

        build = search_spec.get("build")
        parse = search_spec.get("parse")
        headers_fn = search_spec.get("headers")
        if not callable(build) or not callable(parse) or not callable(headers_fn):
            QMessageBox.information(win, "Provider", "Provider search configuration is incomplete.")
            return

        hdrs = headers_fn() or {}

        all_rows = []
        state["fetched"] = 0
        state["page_total"] = 0
        state["next_cursor"] = None

        def fetch(cursor):
            # Request sizing: keep batches sane.
            req_limit = 100
            if not want_all:
                rem = target_limit - len(all_rows)
                if rem <= 0:
                    finish("target limit reached", all_rows)
                    return
                req_limit = min(rem, 100)

            url = build(qtxt, y1, y2, req_limit, cursor, sort_mode)
            log(f"Search: Fetching batch... (cursor={cursor} total_so_far={len(all_rows)})")

            def on_done(err, status, data, cached):
                if cached:
                    log(f"Cache hit (Search): {prov} cursor={cursor}")

                if err != QNetworkReply.NetworkError.NoError:
                    finish(f"network err={err} http={status}", all_rows)
                    return

                if status not in (200, 201):
                    finish(f"http error {status}", all_rows)
                    return

                try:
                    rows, total, next_cursor = parse(data)
                except Exception as e:
                    log(f"Search parse error: {e}")
                    finish("parse exception", all_rows)
                    return

                rows = rows or []
                if rows:
                    all_rows.extend(rows)

                state["fetched"] = len(all_rows)
                state["page_total"] = int(total or 0)
                state["next_cursor"] = next_cursor

                # progress
                if not want_all and target_limit > 0:
                    pct = int((len(all_rows) / max(1, target_limit)) * 100)
                    pbar.setValue(min(95, max(0, pct)))
                else:
                    # for "All", keep it indeterminate-ish
                    pbar.setValue(min(95, max(0, pbar.value() + 5)))

                # stopping conditions
                if not rows:
                    finish("no more rows returned", all_rows)
                    return

                if not want_all and len(all_rows) >= target_limit:
                    finish("limit reached", all_rows)
                    return

                if not next_cursor:
                    finish("no next page cursor", all_rows)
                    return

                if isinstance(next_cursor, int) and isinstance(cursor, int) and next_cursor <= cursor:
                    finish("cursor stuck", all_rows)
                    return

                QTimer.singleShot(100, lambda: fetch(next_cursor))

            request_json(
                prov,
                url,
                hdrs,
                on_done,
                {"main_search": True, "cursor": cursor, "provider": prov},
            )

        fetch(state["page_offset"])

    # --- 7. CONNECTIONS ---
    btn_search.clicked.connect(lambda: do_search(0))
    query_input.returnPressed.connect(lambda: do_search(0))

    # Export
    btn_export.clicked.connect(export_dispatch)

    # Details Buttons
    def open_url_wrapper():
        if state["selected"]: QDesktopServices.openUrl(QUrl(state["selected"]["url"]))

    btn_open.clicked.connect(open_url_wrapper)

    def save_wrapper():
        if state["selected"] and insert_paper(state["selected"]):
            lib_model.select()
            log("Saved to library.")

    btn_save.clicked.connect(save_wrapper)
    # Keep a strong reference so the dialog is not garbage-collected
    state["_graph_dialog"] = None

    def graph_wrapper():
        from PyQt6.QtCore import QTimer
        from PyQt6.QtWidgets import QStackedWidget, QVBoxLayout, QWidget

        rec = state.get("selected")
        if not isinstance(rec, dict):
            QMessageBox.information(win, "Graph", "Select a record first.")
            return

        prov_name = provider_combo.currentText()
        prov_spec = (specs.get(prov_name) or {})
        prov_id = (prov_spec.get("id") or "").strip()

        try:
            from Search_engine.Citations_graph.Graph_widget import ConnectedPapersLikeGraph
        except Exception as e:
            QMessageBox.critical(win, "Graph import failed", f"Could not import Graph_widget. Error:\n{e}")
            return

        seed_node = record_to_graph_seed_node(rec)

        host_l = state.get("_graph_host_layout")
        right_stack = state.get("_right_stack")
        host = state.get("_graph_host")

        if not isinstance(host_l, QVBoxLayout) or not isinstance(right_stack, QStackedWidget) or not isinstance(host, QWidget):
            QMessageBox.critical(win, "Graph", "Graph host UI is not initialised.")
            return

        old = state.get("_graph_widget")
        if old is not None and isinstance(old, QWidget):
            host_l.removeWidget(old)
            old.setParent(None)
            old.deleteLater()
            state["_graph_widget"] = None

        right_stack.setCurrentIndex(1)

        g = ConnectedPapersLikeGraph(seed_input="", parent=host)

        if hasattr(g, "set_seed_node"):
            g.set_seed_node(seed_node)
        else:
            g._seed_node = seed_node

        if hasattr(g, "set_records"):
            g.set_records(rows)
        else:
            g._all_records = rows

        headers_fn = (prov_spec.get("search") or {}).get("headers")
        headers = (headers_fn() or {}) if callable(headers_fn) else {}

        env0 = env if isinstance(env, dict) else {}
        semantic_key = (env0.get("SEMANTIC_API") or env0.get("SEMANTIC_SCHOLAR_API_KEY") or "").strip()

        if hasattr(g, "set_provider_context"):
            g.set_provider_context(
                provider_id=prov_id,
                provider_name=prov_name,
                headers=headers,
                semantic_api_key=semantic_key,
            )
        else:
            g._provider_id = prov_id
            g._provider_name = prov_name
            g._headers = headers
            g._semantic_api_key = semantic_key

        host_l.addWidget(g)
        state["_graph_widget"] = g

        g.show()

        if hasattr(g, "request_build"):
            QTimer.singleShot(0, g.request_build)
        else:
            QTimer.singleShot(0, g.build)


    btn_graph.clicked.connect(graph_wrapper)

    results_view.clicked.connect(lambda: on_result_selected())

    # Context Menus
    results_view.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)

    def show_res_menu(pos):
        m = QMenu()
        a1 = m.addAction("Snowball: References")
        a2 = m.addAction("Snowball: Citations")
        act = m.exec(results_view.mapToGlobal(pos))
        if act == a1: run_snowball("references")
        if act == a2: run_snowball("citations")

    results_view.customContextMenuRequested.connect(show_res_menu)

    lib_view.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)

    def show_lib_menu(pos):
        idx = lib_view.indexAt(pos)
        if not idx.isValid(): return
        m = QMenu();
        a1 = m.addAction("Add Tag");
        a2 = m.addAction("Remove Tag")
        act = m.exec(lib_view.mapToGlobal(pos))
        pid = lib_model.data(lib_model.index(idx.row(), 0))
        if act == a1:
            t, ok = QInputDialog.getText(win, "Tag", "Name:")
            if ok and t: db_link_tag(pid, db_add_tag(t))
        if act == a2:
            t, ok = QInputDialog.getText(win, "Untag", "Name:")
            if ok and t: db_remove_tag(pid, t)

    lib_view.customContextMenuRequested.connect(show_lib_menu)

    # --- 8. EXPORT LOCAL API FOR EMBEDDING (optional) ---
    if isinstance(exports, dict):
        exports.update(
            {
                "window": win,
                "tabs": tabs,
                "state": state,
                "specs": specs,
                "db": db,
                "db_ok": db_ok,
                "net": net,
                "do_search": do_search,
                "clone_search_to_workspace": clone_search_to_workspace,
                "restore_workspace_tabs": restore_workspace_tabs,
                "run_snowball": run_snowball,
                "set_results": set_results,
                "set_selected": set_selected,
                "on_provider_changed": on_provider_changed,
            }
        )

    # Final Init
    from PyQt6.QtCore import QTimer

    provider_combo.currentTextChanged.connect(on_provider_changed)
    on_provider_changed()

    set_status(sb, "Ready.")

    def _post_show_init():
        # heavy work goes here
        try:
            restore_workspace_tabs()
        except Exception as e:
            print(f"[SearchEngine] restore_workspace_tabs failed: {e}", flush=True)

    QTimer.singleShot(0, _post_show_init)

    if embedded:
        return win
    win.show()
    sys.exit(app.exec())


def test_springer_call():
    import requests
    from pathlib import Path

    env, env_used = load_env(Path(__file__).resolve().parent / ".env")

    api_key = (
        env.get("SPRINGER_key")
        or env.get("SPRINGER_KEY")
        or env.get("SPRINGER_API")
        or os.environ.get("SPRINGER_key")
        or os.environ.get("SPRINGER_KEY")
        or os.environ.get("SPRINGER_API")
        or ""
    ).strip()

    url = "https://api.springernature.com/metadata/json"
    params = {
        "q": "cyber attribution",
        "p": 5,
        "s": 1,
        "api_key": api_key if api_key else None,
    }

    r = requests.get(url, params={k: v for k, v in params.items() if v is not None}, timeout=25)

    print("SPRINGER env_used:", env_used)
    print("status:", r.status_code)
    print("api_key_present:", bool(api_key))
    print("final_url:", r.url)
    print("response_snippet:", r.text[:800])


def test_wos_starter_call():
    import requests
    from pathlib import Path

    env, env_used = load_env(Path(__file__).resolve().parent / ".env")

    wos_key = (env.get("wos_api_key") or os.environ.get("wos_api_key") or "").strip()
    if not wos_key:
        raise RuntimeError(f"wos_api_key not found in {env_used}")

    q = 'TS=("cyber attribution")'
    headers = {"X-ApiKey": wos_key, "Accept": "application/json"}

    url1 = "https://api.clarivate.com/apis/wos-starter/v1/documents"
    params1 = {"q": q, "db": "WOS", "limit": 5, "page": 1}
    r1 = requests.get(url1, params=params1, headers=headers, timeout=25)

    print("WOS env_used:", env_used)
    print("key_length:", len(wos_key))
    print("v1 status:", r1.status_code)
    print("v1 final_url:", r1.url)
    print("v1 response_snippet:", r1.text[:800])

    url2 = "https://api.clarivate.com/apis/wos-starter/documents"
    params2 = {"q": q, "db": "WOS", "limit": 5, "page": 1}
    r2 = requests.get(url2, params=params2, headers=headers, timeout=25)

    print("non-v1 status:", r2.status_code)
    print("non-v1 final_url:", r2.url)
    print("non-v1 response_snippet:", r2.text[:800])


def test_semantic_scholar_call():
    import requests
    from pathlib import Path

    env, env_used = load_env(Path(__file__).resolve().parent / ".env")

    api_key = (env.get("SEMANTIC_API") or "").strip()
    if not api_key:
        raise RuntimeError(f"SEMANTIC_API not found in {env_used}")

    url = "https://api.semanticscholar.org/graph/v1/paper/search"
    params = {
        "query": "cyber attribution",
        "limit": 5,
        "fields": ",".join([
            "paperId",
            "externalIds",
            "title",
            "abstract",
            "year",
            "venue",
            "publicationVenue",
            "publicationDate",
            "publicationTypes",
            "journal",
            "url",
            "authors",
            "citationCount",
            "referenceCount",
            "influentialCitationCount",
            "isOpenAccess",
            "openAccessPdf",
            "fieldsOfStudy",
            "s2FieldsOfStudy",
            "tldr",
        ]),
    }

    headers = {"x-api-key": api_key}

    r = requests.get(url, params=params, headers=headers, timeout=20)

    print("SEMANTIC env_used:", env_used)
    print("status:", r.status_code)
    print("api_key_length:", len(api_key))
    print("final_url:", r.url)
    print("response_snippet:", r.text[:800])





if __name__ == "__main__":

#     if "--graph-child" in sys.argv:
#         i = sys.argv.index("--graph-child")
#         json_path = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
#         _graph_child_main(json_path)
#         sys.exit(0)
# #
    search_engine_front()

    # test_semantic_scholar_call()
    # test_springer_call()
    # test_wos_starter_call()
