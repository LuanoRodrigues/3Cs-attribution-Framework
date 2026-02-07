
import hashlib
import os


import pyarrow.parquet as pq

from Z_Corpus_analysis.Aiworker import RoundRunnerWorker, AiScopeDialog, AiScopeChoice, collection_label_for
from Z_Corpus_analysis.Editor import PreviewPanel
from Z_Corpus_analysis.help_widgets import CARD_LANE_WIDTH, NotesOverlay, SearchBarWidget, FilterSection, CheckList, \
    ZoteroMiniWindow, ErrorInfo, SectionOverlay, ProgressEvent
from Z_Corpus_analysis.pages_2_3 import L2SectionsPage
from Z_Corpus_analysis.sections_page import L1SectionsPage, L3SectionsPage
from bibliometric_analysis_tool.core.common_styles import add_soft_shadow, divider, _hash_color, ACCENT_LIST, \
  soft_pill
from Z_Corpus_analysis.help_functions import _extract_author_summary_from_meta
from thematic_functions_legacy import PYR_L1_PROMPT
from typing import Union

import pandas as pd

import unicodedata

from PyQt6.QtWidgets import  QApplication, QLabel
from PyQt6.QtCore import Qt


from pathlib import Path

import re

from PyQt6.QtGui import QGuiApplication,  QClipboard

from typing import Any, Dict, List, Optional
from pydantic import BaseModel
from PyQt6.QtCore import pyqtSignal, QThread


from PyQt6.QtWidgets import (

    QVBoxLayout,
    QSizePolicy, QMessageBox, QCheckBox,

    QWidget,
     QFrame,

     QLayout

)



library_id = os.environ.get("LIBRARY_ID")
api_key = os.environ.get("API_KEY")
library_type = os.environ.get("LIBRARY_TYPE")
token = os.environ.get("TOKEN")
# chat_name= "summary"
chat_name = "summary"

chat_args = {
    # "session_token":token,
    # "conversation_id":'208296a2-adb8-4dc0-87f2-b23e23c0fc79',
    # "chat_id": chat_name,
    "os": "win",
    "library_id": library_id,
    "api_key": api_key
}





class CodedCorpusTab(QWidget):
    """
    Wrapper around L1BatchesPage.
    This tab appears as 'Coded Corpus'.
    """

    def __init__(
            self,
            df: Optional["pd.DataFrame"] = None,
            parent: Optional[QWidget] = None,
    ) -> None:
        class _InitState(BaseModel):
            has_df: bool

        _InitState(has_df=df is not None)

        super().__init__(parent)
        self._run_obj: object | None = None

        # this page knows how to load pyr_l1_batches.* from a run dir
        self.page = L1BatchesPage(themes_dir=None, df=df)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(self.page)

    def refresh(self, run_obj: object | None) -> None:
        """
        Update the underlying L1BatchesPage with the selected run.
        """

        class _RefreshPayload(BaseModel):
            run_name: Optional[str]

        _RefreshPayload(
            run_name=(getattr(run_obj, "name", None) if run_obj is not None else None)
        )

        self._run_obj = run_obj

        if run_obj is None:
            self.page.clear_view()
            return

        run_dir = Path(getattr(run_obj, "path", "")).resolve()
        self.page.load_from_run_dir(run_dir)


class Round1Tab(QWidget):
    """
    Wrapper around L1SectionsPage.
    This tab appears as 'Round 1' and shows pyr_l1_sections.* (Round 1 coding).
    """

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        class _InitState(BaseModel):
            has_parent: bool

        _InitState(has_parent=parent is not None)

        super().__init__(parent)
        self._run_obj: object | None = None

        # this page knows how to load pyr_l1_sections.* from a run dir
        self.page = L1SectionsPage(themes_dir=None)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(self.page)

    def refresh(self, run_obj: object | None) -> None:
        """
        Update the underlying L1SectionsPage with the selected run.
        """

        class _RefreshPayload(BaseModel):
            run_name: Optional[str]

        _RefreshPayload(
            run_name=(getattr(run_obj, "name", None) if run_obj is not None else None)
        )

        self._run_obj = run_obj

        if run_obj is None:
            self.page.clear_view()
            return

        run_dir = Path(getattr(run_obj, "path", "")).resolve()
        self.page.load_from_run_dir(run_dir)


class Round2Tab(QWidget):
    """
    This tab appears as "Round 2" and shows pyr_l2_sections
    for the currently selected thematic run in the sidebar.
    """

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        self.page = L2SectionsPage()
        layout.addWidget(self.page)

    def refresh(self, run_obj: object | None) -> None:
        """
        Called by DashboardPage whenever the selected run changes.
        If run_obj is None, clear the view.
        Otherwise, point L2SectionsPage at the run dir and reload.
        """
        if run_obj is None:
            print("[Round2Tab] no run selected, clearing view")
            self.page.themes_dir = None
            self.page.all_sections = []
            self.page.apply_filters()
            return

        run_path = getattr(run_obj, "path", None)
        if not isinstance(run_path, Path):
            run_path = Path(str(run_path)) if run_path is not None else None

        if run_path is None or (not run_path.exists()):
            print(f"[Round2Tab] invalid run path: {run_path}")
            self.page.themes_dir = None
            self.page.all_sections = []
            self.page.apply_filters()
            return

        print(f"[Round2Tab] loading Round-2 sections from {run_path}")
        self.page.themes_dir = run_path
        self.page.load_data()


class Round3Tab(QWidget):
    """
    This tab appears as "Round 3" and shows pyr_l3_sections
    for the currently selected thematic run in the sidebar.
    Mirrors Round 2 behaviour but uses L3SectionsPage.
    """

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        self.page = L3SectionsPage()
        layout.addWidget(self.page)

    def refresh(self, run_obj: object | None) -> None:
        """
        Called by DashboardPage whenever the selected run changes.
        If run_obj is None, clear the view.
        Otherwise, point L3SectionsPage at the run dir and reload.
        """
        if run_obj is None:
            print("[Round3Tab] no run selected, clearing view")
            self.page.themes_dir = None
            self.page.all_sections = []
            self.page.apply_filters()
            return

        run_path = getattr(run_obj, "path", None)
        if not isinstance(run_path, Path):
            run_path = Path(str(run_path)) if run_path is not None else None

        if run_path is None or (not run_path.exists()):
            print(f"[Round3Tab] invalid run path: {run_path}")
            self.page.themes_dir = None
            self.page.all_sections = []
            self.page.apply_filters()
            return

        print(f"[Round3Tab] loading Round-3 sections from {run_path}")
        self.page.themes_dir = run_path
        self.page.load_data()
class BatchCard(QFrame):
    noteRequested = pyqtSignal(str, QWidget)
    sectionRequested = pyqtSignal(str, QWidget)

    payloadClicked = pyqtSignal(dict)
    selectionToggled = pyqtSignal(int, bool)  # (flat idx, checked)

    def __init__(self, batch: Dict[str, Any], selected_idx: set[int] | None = None):
        super().__init__()
        self.setObjectName("Panel")
        self._selected_idx = set(selected_idx or [])

        self.setFixedWidth(CARD_LANE_WIDTH)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Minimum)
        add_soft_shadow(self, 22, 0.30)

        root = QVBoxLayout(self)
        root.setSpacing(10)
        root.setContentsMargins(14, 14, 14, 14)
        root.setSizeConstraint(QLayout.SizeConstraint.SetMinimumSize)

        payloads = list(batch.get("payloads") or [])
        for i, p in enumerate(payloads):
            if i:
                root.addWidget(divider())
            root.addWidget(self._payload_block(p))

    def _page_segment(self, item: dict) -> str:
        """
        Return 'p. 37' if the payload has a clean page number,
        otherwise return ''.

        We look at several possible keys: page, page_number, page_num, pg.
        """
        from pydantic import BaseModel
        import re

        class _PgState(BaseModel):
            raw_text: str

        page_keys = ["page", "page_number", "page_num", "pg"]

        candidate_txt = ""
        for k in page_keys:
            if k in item:
                val = str(item.get(k)).strip()
                if val != "":
                    candidate_txt = val
                    break

        state = _PgState(raw_text=candidate_txt)

        # accept simple positive integers only
        if re.match(r"^[0-9]+$", state.raw_text):
            return "p. " + state.raw_text

        return ""

    def _wrap_label(self, text: str, point_size: int | None = None, italic: bool = False) -> QLabel:
        lbl = QLabel(text or "")
        lbl.setWordWrap(True)
        lbl.setTextFormat(Qt.TextFormat.PlainText)
        lbl.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        lbl.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        lbl.setMinimumWidth(1)
        f = lbl.font()
        if point_size is not None:
            f.setPointSize(point_size)
        f.setItalic(italic)
        lbl.setFont(f)
        lbl.setStyleSheet("padding: 1px 2px;")
        return lbl

    def _payload_block(self, item: dict) -> QWidget:
        """
        Render one payload:
        - top row: [✔] [theme pill] [Notes ▸]
        - middle: paraphrase / direct quote
        - bottom: bibliographic line with optional page after the year:
            "Smith (2022, p. 37) · Journal · <em>Title</em> · link"
        """
        from pydantic import BaseModel
        from PyQt6.QtWidgets import (
            QFrame,
            QVBoxLayout,
            QHBoxLayout,
            QLabel,
            QToolButton,
            QCheckBox,
            QSizePolicy,
        )
        from PyQt6.QtCore import Qt
        import html, re

        class _BiblioParts(BaseModel):
            author_display: str
            year_text: str
            page_seg: str
            source_text: str
            title_text: str
            url_text: str
            key_text: str

        w = QFrame()
        w.setObjectName("Section")
        w.setProperty("class", "PayloadSection")

        lay = QVBoxLayout(w)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)

        # ---------- top row: checkbox | theme pill | Notes ▸ ----------
        top = QHBoxLayout()
        top.setContentsMargins(0, 0, 0, 0)
        top.setSpacing(6)
        lay.addLayout(top)

        flat_idx = item.get("__idx")
        if isinstance(flat_idx, int):
            chk = QCheckBox()
            chk.setChecked(flat_idx in self._selected_idx)
            chk.toggled.connect(lambda checked, i=flat_idx: self.selectionToggled.emit(i, checked))
            top.addWidget(chk)

        theme_val = str(
            item.get("payload_theme")
            or item.get("theme")
            or item.get("potential_theme")
            or ""
        )
        top.addWidget(soft_pill(theme_val or "—", _hash_color(theme_val or "—", ACCENT_LIST)))

        top.addStretch(1)

        note_txt = (item.get("researcher_comment") or "").strip()
        btn_notes = QToolButton()
        btn_notes.setText("Notes ▸")
        btn_notes.setAutoRaise(True)
        btn_notes.setProperty("class", "Link")
        btn_notes.setEnabled(bool(note_txt))
        if note_txt != "":
            btn_notes.clicked.connect(
                lambda _=False, n=note_txt, anchor=btn_notes: self.noteRequested.emit(n, anchor))
        top.addWidget(btn_notes)

        # ---------- middle body: paraphrase + quote block ----------
        body = QVBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(6)
        lay.addLayout(body)

        # helper: clean_text to show in HTML
        def _html_txt(s: str) -> str:
            return html.escape(s)

        para_raw = str(item.get("paraphrase") or "")
        if para_raw.strip() != "":
            lbl_para = QLabel()
            lbl_para.setWordWrap(True)
            lbl_para.setTextFormat(Qt.TextFormat.RichText)
            lbl_para.setText(
                "<div style='font-size:13px; line-height:1.5; color:#E7ECF3;'>"
                + _html_txt(para_raw)
                + "</div>"
            )
            body.addWidget(lbl_para)

        dq_raw = str(item.get("direct_quote") or "")
        if dq_raw.strip() != "":
            lbl_dq = QLabel()
            lbl_dq.setWordWrap(True)
            lbl_dq.setTextFormat(Qt.TextFormat.RichText)
            lbl_dq.setObjectName("QuoteBox")
            lbl_dq.setStyleSheet(
                "QLabel#QuoteBox {"
                "  background: rgba(255,255,255,0.03);"
                "  border-left: 3px solid rgba(125,211,252,0.75);"
                "  border-radius: 8px;"
                "  padding: 8px 10px;"
                "  color: #E7ECF3;"
                "  font-size:13px;"
                "  line-height:1.5;"
                "}"
            )
            lbl_dq.setText("“" + _html_txt(dq_raw) + "”")
            body.addWidget(lbl_dq)

        # breathing room before footer
        body.addSpacing(10)

        # ---------- bottom meta line ----------
        # cleaner: strip "na", "n/a", "none", "null", "-" etc. → ""
        def _clean_field(v: object) -> str:
            s = str(v or "").strip()
            if s == "":
                return ""
            low = s.casefold()
            bad_tokens = {
                "n/a", "na", "none", "null", "nil", "unspecified",
                "unknown", "-", "--", "—", "(n/a)", "(na)"
            }
            if low in bad_tokens:
                return ""
            return s

        # author
        author_disp_raw = (
                item.get("first_author_last")
                or item.get("author_summary")
                or item.get("author")
                or ""
        )
        # cut junk like ";", "·", "(" etc.
        if author_disp_raw != "":
            parts = re.split(r"[;·(]\s*", author_disp_raw)
            if len(parts) > 0:
                author_disp_raw = parts[0].strip()
        author_disp = _clean_field(author_disp_raw)

        # year
        year_txt = _clean_field(item.get("year"))

        # page -> "p. 37" or ""
        page_seg_clean = self._page_segment(item)
        # self._page_segment() already returns "" if invalid, so no NA problem there

        # source (journal / book / etc)
        source_txt = _clean_field(item.get("source"))

        # title
        title_txt = _clean_field(item.get("title"))

        # url
        url_txt = _clean_field(item.get("url"))

        # key fallback
        key_txt = _clean_field(item.get("item_key"))

        class _BiblioParts(BaseModel):
            author_display: str
            year_text: str
            page_seg: str
            source_text: str
            title_text: str
            url_text: str
            key_text: str

        bib = _BiblioParts(
            author_display=author_disp,
            year_text=year_txt,
            page_seg=page_seg_clean,
            source_text=source_txt,
            title_text=title_txt,
            url_text=url_txt,
            key_text=key_txt,
        )

        # Build "(2022, p. 37)" / "(2022)" / "(p. 37)" but never "(N/A)"
        paren_parts: list[str] = []
        if bib.year_text != "":
            paren_parts.append(bib.year_text)
        if bib.page_seg != "":
            paren_parts.append(bib.page_seg)
        paren_join = ", ".join(paren_parts)

        # "Rid (2022, p. 37)" / "Rid (2022)" / "Rid" / "(2022, p. 37)"
        author_year_chunk = ""
        if bib.author_display != "" and paren_join != "":
            author_year_chunk = bib.author_display + " (" + paren_join + ")"
        elif bib.author_display != "":
            author_year_chunk = bib.author_display
        elif paren_join != "":
            author_year_chunk = paren_join

        # source bold, title italic – only if they’re not NA/empty
        source_html = ""
        if bib.source_text != "":
            source_html = "<strong>" + html.escape(bib.source_text) + "</strong>"

        title_html = ""
        if bib.title_text != "":
            title_html = "<em>" + html.escape(bib.title_text) + "</em>"

        # final "Author (2022, p. 37) · <strong>Source</strong> · <em>Title</em>"
        meta_chunks: list[str] = []
        if author_year_chunk != "":
            meta_chunks.append(html.escape(author_year_chunk))
        if source_html != "":
            meta_chunks.append(source_html)
        if title_html != "":
            meta_chunks.append(title_html)

        meta_line_html = " · ".join(meta_chunks)

        # add link if we have URL
        if meta_line_html != "" and bib.url_text != "":
            meta_line_html = (
                    meta_line_html
                    + " · <a href='"
                    + html.escape(bib.url_text, quote=True)
                    + "' style='color:#9CB8FF; text-decoration:underline;'>link</a>"
            )

        # fallback: if literally nothing survived (author empty, source empty, etc.)
        # Only show Key: … if key is meaningful (not 'NA', not 'n/a', etc.)
        if meta_line_html.strip() == "":
            if bib.key_text != "":
                meta_line_html = "Key: " + html.escape(bib.key_text)
            else:
                meta_line_html = ""

        meta_lbl = QLabel()
        meta_lbl.setTextFormat(Qt.TextFormat.RichText)
        meta_lbl.setTextInteractionFlags(Qt.TextInteractionFlag.TextBrowserInteraction)
        meta_lbl.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        meta_lbl.setMinimumWidth(1)
        if meta_line_html != "":
            meta_lbl.setText(
                "<div style='font-size:11.5px; line-height:1.4; color:#AEB7C4;'>"
                + meta_line_html +
                "</div>"
            )
        else:
            # nothing to display at all, just don't show anything visible
            meta_lbl.setText("")

        lay.addWidget(meta_lbl)

        # ---------- click -> preview ----------
        w.setCursor(Qt.CursorShape.PointingHandCursor)

        def _on_click(ev, it=item) -> None:
            if ev.button() == Qt.MouseButton.LeftButton:
                self.payloadClicked.emit(it)
            QFrame.mousePressEvent(w, ev)

        w.mousePressEvent = _on_click

        return w

    def _author_display_from_payload(self, p: Dict[str, Any]) -> str:
        v = str(p.get("first_author_last") or "").strip()
        if v: return v
        v = str(p.get("author_summary") or "").strip()
        if v:
            import re
            block = v.split(";")[0].strip()
            block = re.split(r"·|\(|\d{4}", block)[0].strip()
            return block
        v = str(p.get("author") or "").strip()
        if v: return v
        return ""



# ============================ L1 PAGE ============================
class L1BatchesPage(QWidget):

    def __init__(self, themes_dir: Optional[Path] = None, df: Optional[pd.DataFrame] = None) -> None:

        from PyQt6.QtCore import Qt
        from PyQt6.QtWidgets import (
            QWidget, QHBoxLayout, QVBoxLayout, QSplitter, QScrollArea, QFrame,
            QPushButton, QLabel, QToolButton, QSizePolicy, QLayout,
            QComboBox, QMenu, QStackedWidget,
        )

        super().__init__()

        # ===== basic state =====
        self.themes_dir: Path | None = Path(themes_dir) if themes_dir else None
        self.thematics_out_dir: Path | None = None
        self.zotero_collection_name: str = ""

        self.themes_dir: Optional[Path] = themes_dir
        self.df: Optional[pd.DataFrame] = df
        self._in_apply_filters: bool = False

        # predeclare attrs that other methods expect later
        self.card_list: Optional[QWidget] = None
        self.card_layout: Optional[QVBoxLayout] = None
        self.notes_overlay: Optional[NotesOverlay] = None
        # data indexes
        self.meta_by_key: Dict[str, Dict[str, Any]] = self._build_meta_index(self.df)
        self.all_batches: List[Dict[str, Any]] = []
        self.filtered: List[Dict[str, Any]] = []
        self.page_size: int = 50
        self.page: int = 1

        # payload-level cache for fast filtering/counting
        self.payload_rows: List[Dict[str, Any]] = []
        self.batch_index_to_payload_indices: Dict[int, List[int]] = {}

        # selection status for export / AI scope
        self._selected_idx: set[int] = set()  # indices of payload_rows selected via BatchCard checkboxes
        self._last_page_idx_set: set[int] = set()  # last rendered page indices
        self._kept_idx_full: List[int] = []  # full filtered list reference
        self._total_items: int = 0

        # aggregates for filter sidepanel counts
        self._full_rq_counts: Dict[str, int] = {}
        self._full_ev_counts: Dict[str, int] = {}
        self._full_theme_counts: Dict[str, int] = {}
        self._full_tag_counts: Dict[str, int] = {}
        self._full_author_counts: Dict[str, int] = {}

        # ===== root layout =====
        main_h = QHBoxLayout(self)
        main_h.setContentsMargins(0, 0, 0, 0)

        splitter = QSplitter(self)
        splitter.setChildrenCollapsible(False)
        main_h.addWidget(splitter)

        # ------------------------------------------------------------------
        # LEFT SIDEBAR: filters
        # ------------------------------------------------------------------
        # code for replacement
        left_wrap = QWidget()
        left_wrap_lay = QVBoxLayout(left_wrap)
        left_wrap_lay.setContentsMargins(0, 0, 0, 0)

        # make sidebar a bit wider by default, but RESIZABLE via splitter
        # we clamp it so it can't get stupidly tiny or eat the whole screen
        left_wrap.setMinimumWidth(320)
        left_wrap.setMaximumWidth(520)

        # let the splitter manage actual width at runtime
        pol = left_wrap.sizePolicy()
        pol.setHorizontalPolicy(QSizePolicy.Policy.Preferred)
        pol.setVerticalPolicy(QSizePolicy.Policy.Expanding)
        left_wrap.setSizePolicy(pol)

        sidebar_scroll = QScrollArea()
        sidebar_scroll.setWidgetResizable(True)
        sidebar_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        sidebar_inner = QWidget()
        sidebar_inner_lay = QVBoxLayout(sidebar_inner)
        sidebar_inner_lay.setSpacing(10)
        sidebar_inner_lay.setContentsMargins(8, 8, 8, 8)

        # --- Search text box
        self.search_bar = SearchBarWidget()
        sidebar_inner_lay.addWidget(FilterSection("Search", self.search_bar))

        # --- Checklists
        self.chk_rq = CheckList({})
        self.chk_ev = CheckList({})
        self.chk_theme = CheckList({})
        self.chk_tags = CheckList({}, top_n=10)
        self.chk_authors = CheckList({}, top_n=10)
        self.chk_years = CheckList({})

        self._sec_rq = FilterSection("Research questions", self.chk_rq, full_values={})
        self._sec_ev = FilterSection("Evidence type (from items)", self.chk_ev, full_values={})
        self._sec_theme = FilterSection("Overarching theme", self.chk_theme, full_values={})
        self._sec_tags = FilterSection("Tags (Top 10)", self.chk_tags, full_values={})
        self._sec_authors = FilterSection("Top authors", self.chk_authors, full_values={})
        self._sec_year = FilterSection("Year (Top 10)", self.chk_years, full_values={})

        self.chk_score = CheckList({}, top_n=10)
        self._sec_score = FilterSection("Relevance score", self.chk_score, full_values={})

        sidebar_inner_lay.addWidget(self._sec_rq)
        sidebar_inner_lay.addWidget(self._sec_ev)
        sidebar_inner_lay.addWidget(self._sec_theme)
        sidebar_inner_lay.addWidget(self._sec_tags)
        sidebar_inner_lay.addWidget(self._sec_authors)
        sidebar_inner_lay.addWidget(self._sec_year)
        sidebar_inner_lay.addWidget(self._sec_score)

        # --- Apply / Reset buttons
        action_row = QWidget()
        action_row_lay = QHBoxLayout(action_row)
        action_row_lay.setContentsMargins(0, 0, 0, 0)

        self.btn_apply = QPushButton("Apply")
        self.btn_apply.setProperty("class", "Primary")

        self.btn_reset = QPushButton("Reset")
        self.btn_reset.setProperty("class", "Subtle")

        action_row_lay.addWidget(self.btn_apply)
        action_row_lay.addWidget(self.btn_reset)

        sidebar_inner_lay.addWidget(action_row)
        sidebar_inner_lay.addStretch(1)

        sidebar_scroll.setWidget(sidebar_inner)

        # wrap sidebar in a premium card
        sidebar_card = QFrame()
        sidebar_card.setObjectName("Panel")
        add_soft_shadow(sidebar_card, 22, 0.25)

        sidebar_card_lay = QVBoxLayout(sidebar_card)
        sidebar_card_lay.setContentsMargins(10, 10, 10, 10)
        sidebar_card_lay.addWidget(sidebar_scroll)

        left_wrap_lay.addWidget(sidebar_card)

        splitter.addWidget(left_wrap)

        # ------------------------------------------------------------------
        # RIGHT MAIN AREA: header toolbar + main content + coder sidebar
        # ------------------------------------------------------------------
        right_wrap = QWidget()
        right_wrap_lay = QVBoxLayout(right_wrap)
        right_wrap_lay.setContentsMargins(8, 8, 8, 8)

        # ===== top toolbar =====
        toolbar_card = QFrame()
        toolbar_card.setObjectName("Panel")
        add_soft_shadow(toolbar_card, 18, 0.22)

        toolbar_lay = QHBoxLayout(toolbar_card)
        toolbar_lay.setContentsMargins(12, 10, 12, 10)

        # --- coder toggle button
        self.btn_coder = QToolButton()
        self.btn_coder.setText("Coder ▸")
        self.btn_coder.setCheckable(True)
        self.btn_coder.setAutoRaise(True)

        # --- ai modal trigger button (not checkable)
        self.btn_ai = QToolButton()
        self.btn_ai.setText("AI")
        self.btn_ai.setCheckable(False)
        self.btn_ai.setAutoRaise(True)

        # --- page size dropdown
        lbl_ps = QLabel("Page size")
        self.cmb_page_size = QComboBox()
        self.cmb_page_size.addItems(["10", "50", "100"])
        self.cmb_page_size.setCurrentIndex(1)  # 50 default

        # --- export dropdown
        self.btn_export_page = QToolButton()
        self.btn_export_page.setText("Export")
        self.btn_export_page.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)

        self.menu_export_page = QMenu(self.btn_export_page)
        self.act_exp_page = self.menu_export_page.addAction("HTML: Current page")
        self.act_copy_page = self.menu_export_page.addAction("Copy: Current page (HTML)")
        self.menu_export_page.addSeparator()
        self.act_exp_sel = self.menu_export_page.addAction("HTML: Selected items")
        self.act_copy_sel = self.menu_export_page.addAction("Copy: Selected items (HTML)")
        self.menu_export_page.addSeparator()
        self.act_exp_all = self.menu_export_page.addAction("HTML: All results")
        self.act_copy_all = self.menu_export_page.addAction("Copy: All results (HTML)")
        self.btn_export_page.setMenu(self.menu_export_page)

        # initially selection export disabled until user actually selects
        self.act_exp_sel.setEnabled(False)
        self.act_copy_sel.setEnabled(False)

        # --- pager controls
        # --- pager controls + dedup toggle
        self.btn_prev = QPushButton("Prev")
        self.btn_next = QPushButton("Next")
        self.lbl_page = QLabel("Page 1/1 (0 items)")
        self.lbl_page.setProperty("class", "Subtle")

        # toggle to hide duplicates
        self.chk_dedup = QCheckBox("Deduplicate")
        self.chk_dedup.setToolTip("Hide repeated evidence across themes")
        self.chk_dedup.setProperty("class", "Tiny")
        self.chk_dedup.setChecked(True)

        def _on_toggle_dedup(_checked: bool) -> None:
            self.page = 1
            self.apply_filters()

        self.chk_dedup.toggled.connect(_on_toggle_dedup)

        # pack toolbar
        toolbar_lay.addWidget(self.btn_coder)
        toolbar_lay.addWidget(self.btn_ai)
        toolbar_lay.addSpacing(10)
        toolbar_lay.addWidget(lbl_ps)
        toolbar_lay.addWidget(self.cmb_page_size)
        toolbar_lay.addWidget(self.btn_export_page)

        # spacer pushes pager & dedup to the far right
        toolbar_lay.addStretch(1)

        toolbar_lay.addWidget(self.chk_dedup)
        toolbar_lay.addWidget(self.btn_prev)
        toolbar_lay.addWidget(self.btn_next)
        toolbar_lay.addWidget(self.lbl_page)
        right_wrap_lay.addWidget(toolbar_card)

        # ===== split main / coder / preview sidebar =====
        self.right_split = QSplitter(Qt.Orientation.Horizontal)
        self.right_split.setChildrenCollapsible(False)
        right_wrap_lay.addWidget(self.right_split, 1)

        # ---------- LEFT MAIN COLUMN: cards only ----------
        left_main = QWidget()
        left_main_lay = QVBoxLayout(left_main)
        left_main_lay.setContentsMargins(0, 0, 0, 0)
        left_main_lay.setSpacing(8)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setAlignment(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop)

        self.card_list = QWidget()
        self.card_list.setObjectName("CardLane")
        self.card_list.setFixedWidth(CARD_LANE_WIDTH)
        self.card_list.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Minimum)

        self.card_layout = QVBoxLayout(self.card_list)
        self.card_layout.setSpacing(14)
        self.card_layout.setContentsMargins(6, 6, 6, 6)
        self.card_layout.setSizeConstraint(QLayout.SizeConstraint.SetMinimumSize)

        self.scroll.setWidget(self.card_list)
        left_main_lay.addWidget(self.scroll, 1)

        self.right_split.addWidget(left_main)

        # ---------- RIGHT SIDEBAR STACK: Preview + Coder ----------
        self.right_stack = QStackedWidget()
        self.right_split.addWidget(self.right_stack)

        # helper to wrap any panel in a titled card with close/minimise
        def _wrap_with_header(title: str, inner: QWidget) -> QWidget:

            class _Hdr(BaseModel):
                ttl: str

            st = _Hdr(ttl=title)

            wrap_card = QFrame()
            wrap_card.setObjectName("Panel")
            add_soft_shadow(wrap_card, 18, 0.22)

            wrap_lay = QVBoxLayout(wrap_card)
            wrap_lay.setContentsMargins(10, 10, 10, 10)
            wrap_lay.setSpacing(8)

            hdr = QHBoxLayout()
            hdr.setContentsMargins(0, 0, 0, 0)

            lbl_title = QLabel(st.ttl)
            lbl_title.setObjectName("Title")
            hdr.addWidget(lbl_title)

            hdr.addStretch(1)

            btn_min = QToolButton()
            btn_min.setText("–")
            btn_min.setAutoRaise(True)
            btn_min.setToolTip("Minimize panel")
            hdr.addWidget(btn_min)

            btn_close = QToolButton()
            btn_close.setText("✕")
            btn_close.setAutoRaise(True)
            btn_close.setToolTip("Close panel")
            hdr.addWidget(btn_close)

            wrap_lay.addLayout(hdr)
            wrap_lay.addWidget(divider())
            wrap_lay.addWidget(inner, 1)

            def _do_minimize() -> None:
                self._collapse_right_sidebar()
                self.btn_coder.setChecked(False)

            def _do_close() -> None:
                self._collapse_right_sidebar()
                self.btn_coder.setChecked(False)

            btn_min.clicked.connect(_do_minimize)
            btn_close.clicked.connect(_do_close)

            return wrap_card

        # build preview panel (vertical reading pane)
        self.preview = PreviewPanel()
        self.preview_container = _wrap_with_header("Preview", self.preview)
        self.right_stack.addWidget(self.preview_container)

        # build coder panel
        # coll_name = self._resolve_collection_name()
        # self.coder = CoderPanel( collection_name=coll_name)
        # # when coder picks a payload, show it in preview sidebar
        # self.coder.payloadSelected.connect(self._show_preview_payload)
        #
        # self.coder_container = _wrap_with_header("Coder", self.coder)
        # self.right_stack.addWidget(self.coder_container)

        # right sidebar defaults
        self.right_stack.setMinimumWidth(360)
        self.right_split.setStretchFactor(0, 1)
        self.right_split.setStretchFactor(1, 0)
        self._collapse_right_sidebar()

        # ===== sidebar toggle logic (Coder only button in toolbar) =====
        def _sync_toggles(show: Optional[str]) -> None:
            """
            show == "coder":   open coder sidebar
            show == "preview": open preview sidebar
            show == None:      collapse sidebar
            """
            if show == "coder":
                # self.right_stack.setCurrentWidget(self.coder_container)
                self._expand_right_sidebar()
                self.btn_coder.setChecked(True)
                self.btn_coder.setText("Coder ◂")
                return

            if show == "preview":
                self.right_stack.setCurrentWidget(self.preview_container)
                self._expand_right_sidebar()
                # coder toggle is NOT 'on' here
                self.btn_coder.setChecked(False)
                self.btn_coder.setText("Coder ▸")
                return

            # None = collapse
            self.btn_coder.setChecked(False)
            self._collapse_right_sidebar()
            self.btn_coder.setText("Coder ▸")

        def _on_toggle_coder(checked: bool) -> None:
            if checked:
                _sync_toggles("coder")
            else:
                _sync_toggles(None)

        # connect controls
        self.btn_coder.toggled.connect(_on_toggle_coder)
        self._bg_refs: list[tuple[QThread, RoundRunnerWorker, ZoteroMiniWindow]] = []

        self.btn_ai.clicked.connect(self._open_ai_modal)

        # provide a helper for preview clicks elsewhere
        def _show_preview(item: dict) -> None:
            self._show_preview_payload(item)

        self._sync_toggles = _sync_toggles  # keep ref for later use
        self._show_preview = _show_preview  # keep ref

        # ===== finish outer splitter =====
        splitter.addWidget(right_wrap)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([420, 1000])

        # Overlays anchored to the card scroll viewport
        self.notes_overlay = NotesOverlay(self.scroll.viewport())
        self.section_overlay = SectionOverlay(self.scroll.viewport())

        self.scroll.verticalScrollBar().valueChanged.connect(lambda _: self.notes_overlay.reposition())
        self.scroll.horizontalScrollBar().valueChanged.connect(lambda _: self.notes_overlay.reposition())
        self.scroll.verticalScrollBar().valueChanged.connect(lambda _: self.section_overlay.reposition())
        self.scroll.horizontalScrollBar().valueChanged.connect(lambda _: self.section_overlay.reposition())



        # --- Ensure OK in “Expand…” actually applies (all sections incl. Year)
        def _wire_expand_apply(section, checklist):
            if not section or not checklist:
                return

            def _on_apply():
                sel = None
                if hasattr(section, "checked") and callable(section.checked):
                    sel = set(section.checked())
                elif hasattr(section, "selected") and callable(section.selected):
                    sel = set(section.selected())
                elif hasattr(section, "currentSelection") and callable(section.currentSelection):
                    sel = set(section.currentSelection())

                if sel is not None and hasattr(checklist, "set_checked_raw") and callable(checklist.set_checked_raw):
                    checklist.set_checked_raw(sel)

                self.apply_filters()

            # Connect only the signals that exist on the section
            if hasattr(section, "applied"):
                section.applied.connect(_on_apply)
            if hasattr(section, "accepted"):
                section.accepted.connect(_on_apply)
            if hasattr(section, "selectionApplied"):
                section.selectionApplied.connect(_on_apply)
            if hasattr(section, "filtersApplied"):
                section.filtersApplied.connect(_on_apply)

        _wire_expand_apply(self._sec_rq, self.chk_rq)
        _wire_expand_apply(self._sec_ev, self.chk_ev)
        _wire_expand_apply(self._sec_theme, self.chk_theme)
        _wire_expand_apply(self._sec_tags, self.chk_tags)
        _wire_expand_apply(self._sec_authors, self.chk_authors)
        _wire_expand_apply(self._sec_year, self.chk_years)

        # Debounced live changes from the *sidebar* checklists
        for cl in (
                self.chk_rq,
                self.chk_ev,
                self.chk_theme,
                self.chk_tags,
                self.chk_authors,
                self.chk_years,
                self.chk_score,
        ):
            cl.changed.connect(self.apply_filters)

            # search bar emits (text, scope)
        self.search_bar.changed.connect(lambda _t, _s: self.apply_filters())

        # Buttons & pager
        self.btn_apply.clicked.connect(self.apply_filters)
        self.btn_reset.clicked.connect(self.reset_filters)
        self.cmb_page_size.currentIndexChanged.connect(self._on_page_size_change)
        self.btn_prev.clicked.connect(lambda: self._go_page(-1))
        self.btn_next.clicked.connect(lambda: self._go_page(+1))

        # Export actions
        self.act_exp_page.triggered.connect(lambda: self._export_idx_set(self._last_page_idx_set, title="Current page"))
        self.act_copy_page.triggered.connect(lambda: self._copy_idx_set(self._last_page_idx_set, title="Current page"))
        self.act_exp_sel.triggered.connect(lambda: self._export_idx_set(self._selected_idx, title="Selected items"))
        self.act_copy_sel.triggered.connect(lambda: self._copy_idx_set(self._selected_idx, title="Selected items"))
        self.act_exp_all.triggered.connect(lambda: self._export_idx_set(set(self._kept_idx_full), title="All results"))
        self.act_copy_all.triggered.connect(lambda: self._copy_idx_set(set(self._kept_idx_full), title="All results"))

        if self.themes_dir:
            self.load_data()

    # ---------------- Right dock helpers (Coder/AI) ----------------
    def _expand_right_sidebar(self):
        try:
            self.right_split.setSizes([1000, 380])
        except Exception:
            pass

    def _collapse_right_sidebar(self):
        try:
            self.right_split.setSizes([1, 0])
        except Exception:
            pass

    # ---------------- AI context helpers ----------------
    def _payloads_from_batches(self, batches: list[dict]) -> list[dict]:
        out: list[dict] = []
        for b in (batches or []):
            out.extend(b.get("payloads") or [])
        return out

    def _compose_ai_context_from_payloads(self, payloads: list[dict]) -> str:
        if not payloads:
            return ""
        lines: list[str] = []
        for i, p in enumerate(payloads, 1):
            theme = (p.get("payload_theme") or p.get("theme") or p.get("potential_theme") or "").strip()
            para = (p.get("paraphrase") or "").strip()
            dq = (p.get("direct_quote") or "").strip()
            author = (p.get("first_author_last") or p.get("author_summary") or p.get("author") or "").strip()
            if author:
                import re
                author = re.split(r"[;·(]\s*", author)[0].strip()
            year = str(p.get("year") or "").strip()
            title = (p.get("title") or "").strip()
            source = (p.get("source") or "").strip()
            url = (p.get("url") or "").strip()
            page = str(p.get("page") or "").strip()
            sect = (p.get("section_title") or "").strip()

            head_parts = []
            if theme: head_parts.append(f"[{theme}]")
            if author or year: head_parts.append((" ".join([author, f"({year})" if year else ""]).strip()))
            if source: head_parts.append(source)
            head = " · ".join([h for h in head_parts if h])

            lines.append(f"#{i} {head}".strip())
            if title: lines.append(f"Title: {title}")
            if para:  lines.append(f"Paraphrase: {para}")
            if dq:    lines.append(f'Direct quote: "{dq}"')
            if page or sect:
                loc = " / ".join([s for s in [f"p.{page}" if page else "", sect] if s])
                lines.append(f"Location: {loc}")
            if url:   lines.append(f"URL: {url}")
            lines.append("---")
        return "\n".join(lines).rstrip("-\n").strip()

    def _collect_selected_payloads(self) -> list[dict]:
        """
        Returns selected payload dicts. If you track selection as a set of direct_quote_id,
        adapt this to filter from the full dataset. Falls back to current page if empty.
        """
        selected: list[dict] = []
        # If you maintain a set like self._selected_dqids:
        try:
            ids = getattr(self, "_selected_dqids", set())
            if ids:
                # walk over all raw batches
                for b in (getattr(self, "_all_batches_raw", []) or []):
                    for p in (b.get("payloads") or []):
                        if (p.get("direct_quote_id") or "") in ids:
                            selected.append(p)
        except Exception:
            selected = []

        if not selected:
            # If no explicit selection mechanism exists, return the visible page payloads
            for b in (self.filtered or []):
                selected.extend(b.get("payloads") or [])
        return selected

    def _provide_ai_context(self, mode: str) -> tuple[str, str]:
        """
        mode: 'selected' | 'page' | 'all'
        Returns (context_text, source_label) for the AI panel.
        """
        if mode == "selected":
            payloads = self._collect_selected_payloads()
            if not payloads:
                payloads = self._payloads_from_batches(self.filtered)
            src = "Selected items" if payloads else "Current page"
        elif mode == "page":
            payloads = self._payloads_from_batches(self.filtered)
            src = "Current page"
        else:
            payloads = self._payloads_from_batches(getattr(self, "_all_batches_raw", []) or [])
            src = "All data"
        text = self._compose_ai_context_from_payloads(payloads)
        return text, src

    # ---------------- Year helpers ----------------
    def _ensure_year_column(self, df):
        import pandas as pd
        if df is None or df.empty:
            return df
        df = df.copy()
        if "year_synth" in df.columns:
            return df
        cand = None
        if "source_year" in df.columns:
            cand = df["source_year"]
        elif "year" in df.columns:
            cand = df["year"]
        elif "source_meta" in df.columns:
            cand = df["source_meta"].apply(lambda m: (m or {}).get("year") if isinstance(m, dict) else None)
        else:
            cand = None
        ser = pd.to_numeric(cand, errors="coerce") if cand is not None else None
        if ser is None:
            df["year_synth"] = pd.Series([pd.NA] * len(df), dtype="Int64")
        else:
            ser = ser.astype("Int64")
            ser = ser.where((ser >= 1900) & (ser <= 2100))
            df["year_synth"] = ser
        return df

    def _top_years_from_df(self, df, n=10):
        if df is None or df.empty:
            return []
        df2 = self._ensure_year_column(df)
        vc = df2["year_synth"].dropna().astype(int).value_counts()
        return [int(y) for y in vc.index[:n].tolist()]

    # ---------------- Author / tag helpers ----------------
    def _norm_author_label(self, s: str) -> str:
        s = unicodedata.normalize("NFKD", s)
        s = "".join(ch for ch in s if not unicodedata.combining(ch))
        s = re.sub(r"[.\s]+", " ", s).strip()
        return s.casefold()

    def _primary_author_from_meta(self, md: Dict[str, Any]) -> str:
        for key in ("authors", "authors_list", "creator", "creators"):
            v = md.get(key)
            if isinstance(v, list) and v:
                a0 = v[0]
                if isinstance(a0, dict):
                    last = str(a0.get("lastName") or a0.get("family") or "").strip()
                    first = str(a0.get("firstName") or a0.get("given") or "").strip()
                    if last and first: return f"{last}, {first}"
                    if last: return last
                    if first: return first
                elif isinstance(a0, str) and a0.strip():
                    tok = a0.split(";")[0].strip()
                    return tok
        for key in ("author_summary", "creator_summary"):
            s = str(md.get(key) or "").strip()
            if s:
                block = s.split(";")[0].strip()
                block = re.split(r"·|\(|\d{4}", block)[0].strip()
                return block
        if md.get("title"):
            return md["title"].split()[0]
        return ""

    def _pick_display_for_norm(self, norm: str) -> str:
        variants = self.author_norm_to_variants.get(norm)
        if not variants:
            return norm
        return sorted(variants, key=lambda s: (-len(s), s.casefold()))[0]

    def _build_author_and_tag_indexes(self):
        from collections import defaultdict
        self.key_to_author_norm: dict[str, str] = {}
        self.author_norm_to_keys: dict[str, set[str]] = defaultdict(set)
        self.author_norm_to_variants: dict[str, set[str]] = defaultdict(set)
        self.tags_to_keys: dict[str, set[str]] = defaultdict(set)

        keys_in_batches: set[str] = set()
        for b in self.all_batches:
            for p in (b.get("payloads") or []):
                k = str(p.get("item_key") or "").strip()
                if k:
                    keys_in_batches.add(k)
                raw_t = (p.get("theme") or "")
                if raw_t:
                    tokens = {s.strip() for s in re.split(r"[|,;/]", raw_t) if s.strip()}
                    for t in tokens:
                        self.tags_to_keys[t].add(k)

        for k in keys_in_batches:
            md = self.meta_by_key.get(k) or {}
            disp = self._primary_author_from_meta(md) if hasattr(self, "_primary_author_from_meta") else ""
            if not disp:
                summary = _extract_author_summary_from_meta(md)
                if summary:
                    disp = summary.split(";")[0]
                    disp = re.split(r"·|\(|\d{4}", disp)[0].strip()
            if not disp:
                continue
            norm = self._norm_author_label(disp) if hasattr(self, "_norm_author_label") else disp.casefold()
            self.key_to_author_norm[k] = norm
            self.author_norm_to_keys[norm].add(k)
            self.author_norm_to_variants[norm].add(disp)

    def _extract_int_year(self, raw: object) -> int | None:
        import re
        if raw is None:
            return None
        s = str(raw).strip()
        try:
            iv = int(float(s))
            if 1900 <= iv <= 2100:
                return iv
        except Exception:
            pass
        m = re.search(r"\b(19\d{2}|20\d{2}|2100)\b", s)
        return int(m.group(1)) if m else None

    # ---------------- Metadata index ----------------
    def _build_meta_index(self, df: Optional[pd.DataFrame]) -> Dict[str, Dict[str, Any]]:
        idx: Dict[str, Dict[str, Any]] = {}
        if df is None or not isinstance(df, pd.DataFrame) or df.empty:
            return idx

        def clean(v: Any) -> Any:
            return None if (pd.isna(v) if isinstance(v, (float, int, str)) else v is None) else v

        def clean_str(v: Any) -> str:
            v = clean(v)
            return str(v).strip() if isinstance(v, str) else (
                str(int(v)) if isinstance(v, (int, float)) and not pd.isna(v) else "")

        for _, r in df.iterrows():
            key = clean_str(r.get("key"))
            if not key:
                continue
            md: Dict[str, Any] = {}

            s_author_summary = clean_str(r.get("author_summary"))
            if s_author_summary:
                md["author_summary"] = s_author_summary

            for col in ("authors", "authors_list", "creator", "creators"):
                val = clean(r.get(col))
                if isinstance(val, (list, dict)):
                    md[col] = val
                elif isinstance(val, str) and val.strip():
                    md[col] = val.strip()

            s_creator_summary = clean_str(r.get("creator_summary"))
            if s_creator_summary:
                md["creator_summary"] = s_creator_summary

            s_title = clean_str(r.get("title"))
            if s_title:
                md["title"] = s_title

            y = clean(r.get("year"))
            if isinstance(y, (int, float)) and not pd.isna(y):
                md["year"] = str(int(y)) if float(y).is_integer() else str(y)
            elif isinstance(y, str) and y.strip():
                md["year"] = y.strip()

            src = clean(r.get("source")) or clean(r.get("publicationTitle"))
            if isinstance(src, str) and src.strip():
                md["source"] = src.strip()

            url = clean(r.get("url"))
            if isinstance(url, str) and url.strip():
                md["url"] = url.strip()

            idx[key] = md
        return idx

    # ---------------- Loading ----------------
    def _find_first_existing(self, base: Path, names: list[str]) -> Path | None:
        search_dirs = [base, base / "out", base / "exports", base / "themes", base / "theme_exports",
                       base / "artifacts"]
        for d in search_dirs:
            for n in names:
                p = d / n
                if p.exists():
                    return p
        for d in search_dirs:
            if not d.exists():
                continue
            for child in d.iterdir():
                if child.is_dir():
                    for n in names:
                        p = child / n
                        if p.exists():
                            return p
        return None

    def _read_jsonl_maybe_zst(self, path: Path) -> list[dict]:
        recs: list[dict] = []
        if path.suffix == ".zst":
            try:
                import zstandard as zstd  # type: ignore
                import io, json
                with open(path, "rb") as f:
                    dctx = zstd.ZstdDecompressor()
                    with dctx.stream_reader(f) as zr:
                        for line in io.TextIOWrapper(zr, encoding="utf-8"):
                            line = line.strip()
                            if line:
                                recs.append(json.loads(line))
                return recs
            except Exception:
                pass
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    recs.append(json.loads(line))
        return recs

    def load_data(self):
        """
        Loader with NO DataFrame dependency.
        Reads Parquet/JSONL(.zst)/JSON into a list of payload records (dicts),
        then groups them into batches by (rq_question, overarching_theme).
        Each payload already carries author/year/title/source/url — we keep them.
        """
        from pathlib import Path
        import json

        def _s(v: object) -> str:
            if v is None: return ""
            try:
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    if isinstance(v, float) and v.is_integer():
                        return str(int(v))
                    return str(v)
            except Exception:
                pass
            return str(v).strip()

        themes_dir = (self.themes_dir or Path("."))
        records: list[dict] = []

        cand_parquet = self._find_first_existing(themes_dir, [
            "pyr_l1_batches.parquet", "pyr_l1_batches_pre_hydrate.parquet", "batches.parquet",
        ])
        cand_jsonl = self._find_first_existing(themes_dir, [
            "pyr_l1_batches.jsonl.zst", "pyr_l1_batches.jsonl", "batches.jsonl.zst", "batches.jsonl",
        ])
        cand_json_array = self._find_first_existing(themes_dir, [
            "pyr_l1_batches.json", "batches.json",
        ])

        if cand_parquet and not records:
            tbl = pq.read_table(str(cand_parquet))
            records = tbl.to_pylist()

        if not records and cand_jsonl:
            try:
                records = self._read_jsonl_maybe_zst(cand_jsonl)
            except Exception:
                records = []

        if not records and cand_json_array:
            try:
                with open(cand_json_array, "r", encoding="utf-8") as f:
                    blob = json.load(f)
                records = blob if isinstance(blob, list) else []
            except Exception:
                records = []

        if not records:
            QMessageBox.critical(self, "Load error", "No batches data found.")
            self._all_batches_raw = []
            self._build_flat_payloads()
            self._populate_filter_sections_and_cards()
            return

        from collections import defaultdict

        groups: dict[tuple[str, str], list[dict]] = defaultdict(list)

        for r in records:
            # prefer explicit rq_question / overarching_theme, but fall back
            # to legacy aliases, including the underscored fields from batches.json
            rq_raw = ""
            for cand in (r.get("rq_question"), r.get("rq"), r.get("_rq_question")):
                if cand not in (None, ""):
                    rq_raw = cand
                    break
            rq = _s(rq_raw)

            over_raw = ""
            for cand in (r.get("overarching_theme"), r.get("gold_theme"), r.get("_overarching_theme")):
                if cand not in (None, ""):
                    over_raw = cand
                    break
            over = _s(over_raw)

            all_pot = r.get("all_potential_themes")
            all_potential_themes = all_pot if isinstance(all_pot, list) else []

            payload = {
                "direct_quote_id": _s(r.get("direct_quote_id")),
                "direct_quote": _s(r.get("direct_quote")),
                "paraphrase": _s(r.get("paraphrase")),
                "researcher_comment": _s(r.get("researcher_comment")),
                "evidence_type": _s(r.get("evidence_type") or r.get("evidence_type_norm") or "mixed").lower(),
                "theme": _s(r.get("payload_theme") or r.get("theme") or r.get("potential_theme")),
                "potential_theme": _s(r.get("potential_theme")),
                "item_key": _s(r.get("item_key")),
                "author_summary": _s(r.get("author_summary")),
                "first_author_last": _s(r.get("first_author_last")),
                "author": _s(r.get("author")),
                "year": _s(r.get("year")),
                "title": _s(r.get("title")),
                "source": _s(r.get("source") or r.get("publicationTitle")),
                "url": _s(r.get("url")),
                "page": _s(r.get("page")),
                "section_title": _s(r.get("section_title")),
                "section_text": _s(r.get("section_text")),

                "score_bucket": _s(r.get("score_bucket")),
                "relevance_score": r.get("relevance_score"),
                "payload_json": _s(r.get("payload_json")),
                "all_potential_themes": all_potential_themes,
                "route": _s(r.get("route")),
                "gold_theme": _s(r.get("gold_theme")),
            }

            key = (rq, over)
            payload["_rq_question"] = rq
            payload["_overarching_theme"] = over
            groups[key].append(payload)

        batches: list[dict] = []
        for (rq, over), payloads in groups.items():
            batches.append(
                {
                    "rq_question": rq,
                    "overarching_theme": over,
                    "payloads": payloads,
                    "size": len(payloads),
                }
            )

        self._all_batches_raw = batches
        self._build_flat_payloads()
        self._populate_filter_sections_and_cards()

    # ---------------- Filters ----------------
    def reset_filters(self) -> None:
        """
        Clear all facet filters and reapply.
        """
        if self._in_apply_filters:
            return
        self._in_apply_filters = True

        for cl in (
                self.chk_rq,
                self.chk_ev,
                self.chk_theme,
                self.chk_tags,
                self.chk_authors,
                self.chk_years,
                self.chk_score,
        ):
            cl.set_all(False)

        self._in_apply_filters = False
        self.apply_filters()

    def _score_bucket_for_row(self, row: dict) -> str:
        """
        ###1. prefer 'score_bucket' (string bucket)
        ###2. fall back to 'relevance_score' (numeric)
        """
        raw_bucket = row.get("score_bucket")
        if raw_bucket not in (None, ""):
            return str(raw_bucket).strip()

        raw_score = row.get("relevance_score")
        if raw_score in (None, ""):
            return ""
        return str(raw_score).strip()

    def _match_text(self, batch: Dict[str, Any], needle: str) -> bool:
        return (needle.lower() in (batch.get("_blob") or "")) if needle else True

    def apply_filters(self):
        """
        1. Read sidebar selections (RQ, evidence, theme, tags, authors, years, score, search)
        2. Filter payload_rows via _filter_payload_indices
        3. Rebuild kept index lists + dedup view
        4. Recompute facet counts with _compute_box_counts so all boxes update together
        5. Update checklist widgets (show Top 10 per facet + any selected values)
        6. Reset to page 1 and render
        """
        if self._in_apply_filters:
            return
        self._in_apply_filters = True

        from collections import OrderedDict

        def _top_n_local(d: dict[str, int], n: int = 10) -> "OrderedDict[str, int]":
            items = []
            for k, v in d.items():
                label = str(k).strip()
                if label:
                    items.append((label, int(v)))
            items.sort(key=lambda kv: (-kv[1], kv[0].casefold()))
            return OrderedDict(items[:n])

        def _merge_top(d: dict[str, int], selected: set[str], n: int = 10) -> "OrderedDict[str, int]":
            base = _top_n_local(d, n)
            merged: "OrderedDict[str, int]" = OrderedDict()
            for raw in sorted(selected, key=lambda s: s.casefold()):
                merged[raw] = int(d.get(raw, 0))
            for k, v in base.items():
                if k not in merged:
                    merged[k] = int(v)
            return merged

        # --- gather current selections from UI ---

        sel_rq = set(self.chk_rq.checked() or [])
        sel_th = set(self.chk_theme.checked() or [])
        sel_ev = set(self.chk_ev.checked() or [])
        sel_tags_disp = set(self.chk_tags.checked() or [])
        sel_auth_disp = set(self.chk_authors.checked() or [])
        sel_score = set(self.chk_score.checked() or [])

        raw_years = set(self.chk_years.checked() or [])
        sel_years: set[int] = set()
        for v in raw_years:
            s = str(v).strip()
            if s.isdigit():
                sel_years.add(int(s))

        sel_auth_norm: set[str] = set()
        for disp in sel_auth_disp:
            if disp:
                sel_auth_norm.add(self._norm_author_label(disp))

        sel_tags_norm: set[str] = set()
        for t in sel_tags_disp:
            if not t:
                continue
            if hasattr(self, "_norm_tag"):
                sel_tags_norm.add(self._norm_tag(t))
            else:
                sel_tags_norm.add(str(t).strip().casefold())

        search_txt = self.search_bar.text().strip().lower()
        search_scope = self.search_bar.scope()

        # --- core filtering on payload_rows -> index set ---

        kept_idx_full = self._filter_payload_indices(
            sel_rq=sel_rq,
            sel_th=sel_th,
            sel_ev=sel_ev,
            sel_tags_norm=sel_tags_norm,
            sel_auth_norm=sel_auth_norm,
            sel_years=sel_years,
            sel_score=sel_score,
            search_text=search_txt,
            search_scope=search_scope,
        )

        self._kept_idx_full = sorted(list(kept_idx_full))

        # build global dedup list (by direct_quote_id) once per filter state
        self._kept_idx_dedup_full = self._build_dedup_list(self._kept_idx_full)

        # sync “visible” indices + total_items according to dedup toggle
        self._sync_visible_idx_full()

        # choose the effective base set for facet counts:
        # - when dedup is ON, facet numbers use the deduplicated set
        # - when dedup is OFF, they use the full filtered set
        if self.chk_dedup.isChecked():
            kept_effective = set(self._kept_idx_dedup_full)
        else:
            kept_effective = set(kept_idx_full)

        # --- recompute facet counts so every box updates ---

        counts = self._compute_box_counts(
            sel_rq=sel_rq,
            sel_th=sel_th,
            sel_ev=sel_ev,
            sel_tags_norm=sel_tags_norm,
            sel_auth_norm=sel_auth_norm,
            sel_auth_disp=sel_auth_disp,
            sel_years=sel_years,
            sel_score=sel_score,
            search_text=search_txt,
            search_scope=search_scope,
            kept_idx_full=kept_effective,
        )

        rq_counts = counts.get("rq", {})
        th_counts = counts.get("theme", {})
        ev_counts = counts.get("ev", {})
        tag_counts = counts.get("tag", {})
        author_counts = counts.get("author", {})
        year_counts = counts.get("year", {})
        score_counts = counts.get("score", {})

        # --- build “top 10 + selected” views for each facet ---

        rq_view = _merge_top(rq_counts, sel_rq, 10)
        th_view = _merge_top(th_counts, sel_th, 10)
        ev_view = _merge_top(ev_counts, sel_ev, 10)
        tag_view = _merge_top(tag_counts, sel_tags_disp, 10)
        author_view = _merge_top(author_counts, sel_auth_disp, 10)

        year_selected_labels = {str(y) for y in sel_years}
        year_view = _merge_top(year_counts, year_selected_labels, 10)
        score_view = _merge_top(score_counts, sel_score, 10)

        # --- push counts back into UI without firing change handlers ---

        blk = self.chk_rq.blockSignals(True)
        self.chk_rq.set_values(dict(rq_view))
        self.chk_rq.set_checked_raw(sel_rq)
        self.chk_rq.blockSignals(blk)
        self._sec_rq.set_full_values(dict(rq_counts))

        blk = self.chk_theme.blockSignals(True)
        self.chk_theme.set_values(dict(th_view))
        self.chk_theme.set_checked_raw(sel_th)
        self.chk_theme.blockSignals(blk)
        self._sec_theme.set_full_values(dict(th_counts))

        blk = self.chk_ev.blockSignals(True)
        self.chk_ev.set_values(dict(ev_view))
        self.chk_ev.set_checked_raw(sel_ev)
        self.chk_ev.blockSignals(blk)
        self._sec_ev.set_full_values(dict(ev_counts))

        blk = self.chk_tags.blockSignals(True)
        self.chk_tags.set_values(dict(tag_view))
        self.chk_tags.set_checked_raw(sel_tags_disp)
        self.chk_tags.blockSignals(blk)
        self._sec_tags.set_full_values(dict(tag_counts))

        blk = self.chk_authors.blockSignals(True)
        self.chk_authors.set_values(dict(author_view))
        self.chk_authors.set_checked_raw(sel_auth_disp)
        self.chk_authors.blockSignals(blk)
        self._sec_authors.set_full_values(dict(author_counts))

        blk = self.chk_years.blockSignals(True)
        self.chk_years.set_values(dict(year_view))
        self.chk_years.set_checked_raw(year_selected_labels)
        self.chk_years.blockSignals(blk)
        self._sec_year.set_full_values(dict(year_counts))

        blk = self.chk_score.blockSignals(True)
        self.chk_score.set_values(dict(score_view))
        self.chk_score.set_checked_raw(sel_score)
        self.chk_score.blockSignals(blk)
        self._sec_score.set_full_values(dict(score_counts))

        # --- paging + render ---

        ps_text = str(self.cmb_page_size.currentText()).strip()
        if ps_text.isdigit():
            self.page_size = int(ps_text)
        else:
            self.page_size = 10

        self.page = 1
        self.render_page()

        self._in_apply_filters = False

    def _prune_excluded(
            self,
            kept_idx: set[int],
            rq_excl: set[str],
            th_excl: set[str],
            ev_excl: set[str],
            tags_norm_excl: set[str],
            auth_norm_excl: set[str],
            years_excl: set[int],
    ) -> set[int]:
        """
        Take the set of payload-row indices that passed INCLUDE conditions,
        and remove rows that match any EXCLUDE condition.
        This is called inside apply_filters().
        """
        from pydantic import BaseModel
        from typing import Set

        class _Excl(BaseModel):
            rq: Set[str]
            th: Set[str]
            ev: Set[str]
            tg: Set[str]
            au: Set[str]
            yr: Set[int]

        excl = _Excl(
            rq=set(rq_excl),
            th=set(th_excl),
            ev=set(ev_excl),
            tg=set(tags_norm_excl),
            au=set(auth_norm_excl),
            yr=set(years_excl),
        )

        final: set[int] = set()
        for i in kept_idx:
            r = self.payload_rows[i]

            # RQ
            if excl.rq and r.get("rq") in excl.rq:
                continue

            # Theme / overarching theme
            if excl.th and r.get("batch_theme") in excl.th:
                continue

            # Evidence type
            if excl.ev and r.get("ev") in excl.ev:
                continue

            # Authors (compare normalized)
            if excl.au and r.get("author_norm") in excl.au:
                continue

            # Tags (if any excluded tag_norm is present in this row)
            if excl.tg:
                row_tn = r.get("tags_norm", set())
                inter = set(row_tn).intersection(excl.tg)
                if inter:
                    continue

            # Years
            if excl.yr:
                y = r.get("year")
                if isinstance(y, int) and y in excl.yr:
                    continue

            final.add(i)

        return final

    def get_filtered_items(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Return trimmed batch objects that match an arbitrary filter spec.
        This is used by downstream consumers (AI export etc.) without touching UI widgets.

        `filters` can contain:
            "rq": list[str]
            "theme": list[str]
            "evidence": list[str]
            "tags": list[str]
            "authors": list[str]
            "years": list[str|int]
            "search": str
            "search_scope": str  (one of "all","note","quote","rq","evidence","theme","tag","author")
            "score": list[str]   (score buckets or relevance_score values)

        If search_scope is missing, we default to "all".
        """
        from pydantic import BaseModel
        from typing import Set

        class _In(BaseModel):
            rq: Set[str]
            th: Set[str]
            ev: Set[str]
            tags_disp: Set[str]
            auth_disp: Set[str]
            years_cast: Set[int]
            search_txt: str
            search_scope: str
            auth_norm: Set[str]
            tags_norm: Set[str]
            score: Set[str]

        # no filters at all → just return full dataset
        if not filters:
            return list(self._all_batches_raw)

        # --- extract raw selections ---
        sel_rq = set(filters.get("rq", []) or [])
        sel_th = set(filters.get("theme", []) or [])
        sel_ev = set(filters.get("evidence", []) or [])
        sel_tags_disp = set(filters.get("tags", []) or [])
        sel_auth_disp = set(filters.get("authors", []) or [])
        sel_score = set(filters.get("score", []) or [])

        # years: cast to int safely without new try/except
        sel_years_cast: set[int] = set()
        for y in (filters.get("years") or []):
            s_y = str(y).strip()
            if s_y.isdigit():
                sel_years_cast.add(int(s_y))

        # search text + scope
        search_txt = str(filters.get("search") or "").strip().lower()
        search_scope = str(filters.get("search_scope") or "all").strip().lower() or "all"

        # normalised author/tag (so we match same as sidebar)
        sel_auth_norm = {self._norm_author_label(v) for v in sel_auth_disp}
        sel_tags_norm = {self._norm_tag(v) for v in sel_tags_disp}

        snapshot = _In(
            rq=sel_rq,
            th=sel_th,
            ev=sel_ev,
            tags_disp=sel_tags_disp,
            auth_disp=sel_auth_disp,
            years_cast=sel_years_cast,
            search_txt=search_txt,
            search_scope=search_scope,
            auth_norm=sel_auth_norm,
            tags_norm=sel_tags_norm,
            score=sel_score,
        )

        # --- run core filter on row indices ---
        kept_idx = self._filter_payload_indices(
            sel_rq=snapshot.rq,
            sel_th=snapshot.th,
            sel_ev=snapshot.ev,
            sel_tags_norm=snapshot.tags_norm,
            sel_auth_norm=snapshot.auth_norm,
            sel_years=snapshot.years_cast,
            sel_score=snapshot.score,
            search_text=snapshot.search_txt,
            search_scope=snapshot.search_scope,
        )

        # --- convert surviving row indices back to trimmed batch objects ---
        return self._make_trimmed_batches_from_idx(kept_idx)

    def _counts_for_indices(self, idxs: set[int]) -> dict[str, dict[str, int]]:
        from collections import Counter
        rq_c = Counter()
        th_c = Counter()
        ev_c = Counter()
        tg_c = Counter()
        au_c = Counter()
        for i in idxs:
            r = self.payload_rows[i]
            if r["rq"]:
                rq_c[r["rq"]] += 1
            if r["batch_theme"]:
                th_c[r["batch_theme"]] += 1
            if r["ev"]:
                ev_c[r["ev"]] += 1
            for t in (r["tags"] or ()):
                tg_c[t] += 1
            if r["author_display"]:
                au_c[r["author_display"]] += 1
        return {
            "rq": dict(rq_c),
            "theme": dict(th_c),
            "ev": dict(ev_c),
            "tag": dict(tg_c),
            "author": dict(au_c),
        }

    def _count_on_indices(self, idx_set: set[int], dim: str) -> dict[str, int]:
        from collections import Counter
        c = Counter()
        if not idx_set:
            return {}

        for i in idx_set:
            r = self.payload_rows[i]

            if dim == "rq":
                v = r.get("rq")
                if v:
                    c[str(v)] += 1

            elif dim == "theme":
                v = r.get("batch_theme")
                if v:
                    c[str(v)] += 1

            elif dim == "ev":
                v = r.get("ev")
                if v:
                    c[str(v)] += 1

            elif dim == "author":
                v = r.get("author_display")
                if v:
                    c[str(v)] += 1

            elif dim == "year":
                y = r.get("year")
                if isinstance(y, int):
                    c[str(y)] += 1
                else:
                    s_y = str(y).strip()
                    if s_y.isdigit():
                        c[str(int(s_y))] += 1

            elif dim == "score":
                bucket_val = self._score_bucket_for_row(r)
                if bucket_val:
                    c[bucket_val] += 1

        return dict(c)

    def _count_tags_on_indices(self, idx_set: set[int]) -> dict[str, int]:
        from collections import Counter
        c = Counter()
        if not idx_set:
            return {}
        for i in idx_set:
            for t in self.payload_rows[i]["tags"]:
                c[t] += 1
        return dict(c)

    def _override_with_selected_counts(
            self,
            counts: dict[str, int],
            kept_idx_full: set[int],
            selected: set[str],
            dim: str,
    ) -> dict[str, int]:
        if not selected:
            return counts
        actual = self._count_on_indices(kept_idx_full, dim=dim)
        out = dict(counts)
        for val in selected:
            out[val] = actual.get(val, 0)
        return out

    def _override_with_selected_tag_counts(
            self,
            counts: dict[str, int],
            kept_idx_full: set[int],
            selected: set[str],
    ) -> dict[str, int]:
        if not selected:
            return counts
        actual = self._count_tags_on_indices(kept_idx_full)
        out = dict(counts)
        for val in selected:
            out[val] = actual.get(val, 0)
        return out

    def _filter_payload_indices(
            self,
            sel_rq: set[str],
            sel_th: set[str],
            sel_ev: set[str],
            sel_tags_norm: set[str],
            sel_auth_norm: set[str],
            sel_years: set[int],
            sel_score: set[str],
            search_text: str,
            search_scope: str,
            base_idx: set[int] | None = None,
    ) -> set[int]:
        search = (search_text or "").strip().lower()
        scope = (search_scope or "All").strip()

        if base_idx:
            indices = base_idx
        else:
            indices = range(len(self.payload_rows))

        kept: set[int] = set()

        for idx in indices:
            row = self.payload_rows[idx]
            meta = row.get("meta") or {}
            rq = str(meta.get("rq") or "").strip()
            th = str(meta.get("gold_theme") or "").strip()
            ev = str(meta.get("evidence_type") or "").strip()
            author = str(meta.get("author") or "").strip()
            year = row.get("year")
            score = row.get("score_bucket") or ""

            tags_raw = row.get("tags") or []
            tags_norm: set[str] = set()
            if isinstance(tags_raw, str):
                tags_norm = {t.strip().casefold() for t in tags_raw.split(";") if t.strip()}
            else:
                tags_norm = {str(t).strip().casefold() for t in tags_raw if str(t).strip()}

            if sel_rq and rq not in sel_rq: continue
            if sel_th and th not in sel_th: continue
            if sel_ev and ev not in sel_ev: continue
            if sel_auth_norm and author.casefold() not in sel_auth_norm: continue
            if sel_score and str(score) not in sel_score: continue

            if sel_years:
                y = str(year).strip()
                if not y.isdigit(): continue
                if int(y) not in sel_years: continue

            if sel_tags_norm and not (tags_norm & sel_tags_norm): continue

            if search:
                hay = [rq, th, ev, author, str(year or ""), " ".join(sorted(tags_norm))]
                if scope in ("Body", "All"):
                    hay.append(str(row.get("plain_text") or ""))

                if search not in " ".join(hay).lower(): continue

            kept.add(idx)

        return kept

    def _compute_box_counts(
            self,
            sel_rq: set[str],
            sel_th: set[str],
            sel_ev: set[str],
            sel_tags_norm: set[str],
            sel_auth_norm: set[str],
            sel_auth_disp: set[str],
            sel_years: set[int],
            sel_score: set[str],
            search_text: str,
            search_scope: str,
            kept_idx_full: set[int],
    ) -> dict[str, dict[str, int]]:

        base = set(kept_idx_full)

        idx_rq = self._filter_payload_indices(sel_rq=set(), sel_th=sel_th, sel_ev=sel_ev,
                                              sel_tags_norm=sel_tags_norm, sel_auth_norm=sel_auth_norm,
                                              sel_years=sel_years, sel_score=sel_score,
                                              search_text=search_text, search_scope=search_scope,
                                              base_idx=base)
        rq_counts = self._count_on_indices(idx_rq, "rq")

        idx_th = self._filter_payload_indices(sel_rq=sel_rq, sel_th=set(), sel_ev=sel_ev,
                                              sel_tags_norm=sel_tags_norm, sel_auth_norm=sel_auth_norm,
                                              sel_years=sel_years, sel_score=sel_score,
                                              search_text=search_text, search_scope=search_scope,
                                              base_idx=base)
        th_counts = self._count_on_indices(idx_th, "theme")

        idx_ev = self._filter_payload_indices(sel_rq=sel_rq, sel_th=sel_th, sel_ev=set(),
                                              sel_tags_norm=sel_tags_norm, sel_auth_norm=sel_auth_norm,
                                              sel_years=sel_years, sel_score=sel_score,
                                              search_text=search_text, search_scope=search_scope,
                                              base_idx=base)
        ev_counts = self._count_on_indices(idx_ev, "ev")

        idx_tag = self._filter_payload_indices(sel_rq=sel_rq, sel_th=sel_th, sel_ev=sel_ev,
                                               sel_tags_norm=set(), sel_auth_norm=sel_auth_norm,
                                               sel_years=sel_years, sel_score=sel_score,
                                               search_text=search_text, search_scope=search_scope,
                                               base_idx=base)
        tag_counts = self._count_tags_on_indices(idx_tag)
        tag_counts = self._override_with_selected_tag_counts(tag_counts, base,
                                                             {t for t in (self.chk_tags.checked() or [])})

        idx_auth = self._filter_payload_indices(sel_rq=sel_rq, sel_th=sel_th, sel_ev=sel_ev,
                                                sel_tags_norm=sel_tags_norm, sel_auth_norm=set(),
                                                sel_years=sel_years, sel_score=sel_score,
                                                search_text=search_text, search_scope=search_scope,
                                                base_idx=base)
        author_counts = self._count_on_indices(idx_auth, "author")

        idx_year = self._filter_payload_indices(sel_rq=sel_rq, sel_th=sel_th, sel_ev=sel_ev,
                                                sel_tags_norm=sel_tags_norm, sel_auth_norm=sel_auth_norm,
                                                sel_years=set(), sel_score=sel_score,
                                                search_text=search_text, search_scope=search_scope,
                                                base_idx=base)
        year_counts = self._count_on_indices(idx_year, "year")

        idx_score = self._filter_payload_indices(sel_rq=sel_rq, sel_th=sel_th, sel_ev=sel_ev,
                                                 sel_tags_norm=sel_tags_norm, sel_auth_norm=sel_auth_norm,
                                                 sel_years=sel_years, sel_score=set(),
                                                 search_text=search_text, search_scope=search_scope,
                                                 base_idx=base)
        score_counts = self._count_on_indices(idx_score, "score")

        return {
            "rq": rq_counts,
            "theme": th_counts,
            "ev": ev_counts,
            "tag": tag_counts,
            "author": author_counts,
            "year": year_counts,
            "score": score_counts,
        }

    def _build_payload_cache_from_batches(self) -> None:
        """
        Flatten _all_batches_raw into payload_rows.
        Each payload_rows[i] is one evidence fragment.

        Adds score_bucket/relevance_score fields so that score filters can be applied.
        Also initializes facet counts for sidebar.
        """
        from collections import Counter

        self.payload_rows = []
        self.batch_index_to_payload_indices = {}

        c_rq = Counter()
        c_ev = Counter()
        c_theme = Counter()
        c_auth = Counter()
        c_score = Counter()

        batches = getattr(self, "_all_batches_raw", []) or []
        for b_idx, batch in enumerate(batches):
            rq = (batch.get("rq_question") or "").strip()
            over = (batch.get("overarching_theme") or batch.get("gold_theme") or "").strip()
            payloads = batch.get("payloads") or []

            start = len(self.payload_rows)
            for p in payloads:
                item_key = (p.get("item_key") or "").strip()

                author = (p.get("author_summary") or p.get("first_author_last") or p.get("author") or "").strip()
                year_raw = str(p.get("year") or "").strip()
                year_i: Optional[int] = None
                if year_raw.isdigit():
                    year_i = int(year_raw)

                # tags
                tag_src = (p.get("theme") or p.get("potential_theme") or "") or ""
                raw_tags = {t.strip() for t in re.split(r"[|,/]", str(tag_src)) if t.strip()}
                tags_norm = {self._norm_tag(t) for t in raw_tags}

                row: Dict[str, Any] = {
                    "batch_index": b_idx,
                    "rq": rq,
                    "batch_theme": over,
                    "item_key": item_key,
                    "ev": (p.get("evidence_type") or "mixed").strip().lower(),
                    "tags": raw_tags,
                    "tags_norm": tags_norm,
                    "author_display": author,
                    "author_norm": self._norm_author_label(author) if author else "",
                    "year": year_i,
                    "payload_pos": len(self.payload_rows) - start,  # will be overridden below
                    "payload_blob": " ".join(
                        str(x)
                        for x in [
                            rq,
                            over,
                            p.get("paraphrase") or "",
                            p.get("direct_quote") or "",
                            p.get("researcher_comment") or "",
                            author,
                            p.get("title") or "",
                        ]
                    ).lower(),
                }

                # attach score fields from payload
                score_bucket_raw = p.get("score_bucket")
                relevance_raw = p.get("relevance_score")

                if score_bucket_raw not in (None, ""):
                    row["score_bucket"] = str(score_bucket_raw).strip()
                if relevance_raw not in (None, ""):
                    row["relevance_score"] = relevance_raw

                self.payload_rows.append(row)

                if rq:
                    c_rq[rq] += 1
                if row["ev"]:
                    c_ev[row["ev"]] += 1
                if over:
                    c_theme[over] += 1
                if author:
                    c_auth[author] += 1

                bucket_val = self._score_bucket_for_row(row)
                if bucket_val:
                    c_score[bucket_val] += 1

            end = len(self.payload_rows)
            if end > start:
                # fix payload_pos to relative index within batch
                rel = 0
                for i in range(start, end):
                    self.payload_rows[i]["payload_pos"] = rel
                    rel += 1
                self.batch_index_to_payload_indices[b_idx] = list(range(start, end))

        self._full_rq_counts = dict(c_rq)
        self._full_ev_counts = dict(c_ev)
        self._full_theme_counts = dict(c_theme)
        self._full_author_counts = dict(c_auth)
        self._full_score_counts = dict(c_score)

    def _populate_filter_sections_and_cards(self) -> None:
        """
        Initialize sidebar facet checklists (including score bucket)
        using precomputed full counts and payload_rows.
        """
        if hasattr(self, "chk_rq"):
            self.chk_rq.set_options(getattr(self, "_full_rq_counts", {}) or {})
        if hasattr(self, "chk_ev"):
            self.chk_ev.set_options(getattr(self, "_full_ev_counts", {}) or {})
        if hasattr(self, "chk_theme"):
            self.chk_theme.set_options(getattr(self, "_full_theme_counts", {}) or {})
        if hasattr(self, "chk_authors"):
            auth_all = getattr(self, "_full_author_counts", {}) or {}
            top10 = dict(sorted(auth_all.items(), key=lambda kv: kv[1], reverse=True)[:10])
            self.chk_authors.set_options(top10)

        # Years
        if hasattr(self, "chk_years"):
            from collections import Counter

            c = Counter()
            for r in (self.payload_rows or []):
                y = r.get("year")
                if isinstance(y, int):
                    c[str(y)] += 1

            def _to_year_int(s: str) -> int:
                s_clean = str(s).strip()
                if s_clean.isdigit():
                    return int(s_clean)
                return -10 ** 9

            years_sorted = sorted(c.keys(), key=lambda k: _to_year_int(k), reverse=True)
            year_top10 = {k: c[k] for k in years_sorted[:10]}
            self.chk_years.set_options(year_top10)
            if hasattr(self, "_sec_year") and self._sec_year:
                self._sec_year.set_full_values(dict(c))

        # Score buckets
        if hasattr(self, "chk_score"):
            score_full = getattr(self, "_full_score_counts", {}) or {}
            self.chk_score.set_options(score_full)
            if hasattr(self, "_sec_score") and self._sec_score:
                self._sec_score.set_full_values(score_full)

        self.apply_filters()

    # ---------------- Tag/author normalization ----------------
    def _author_display_from_payload(self, p: Dict[str, Any]) -> str:
        v = str(p.get("first_author_last") or "").strip()
        if v: return v
        v = str(p.get("author_summary") or "").strip()
        if v:
            import re
            block = v.split(";")[0].strip()
            block = re.split(r"·|\(|\d{4}", block)[0].strip()
            return block
        v = str(p.get("author") or "").strip()
        if v: return v
        return ""

    def _norm_tag(self, s: str) -> str:
        import re
        return re.sub(r"\s+", " ", (s or "").strip()).casefold()

    def _build_dedup_list(self, idx_order: list[int]) -> list[int]:
        """
        Produce a new ordered index list with duplicates removed.
        Duplicates are detected using a stable per-payload ID (dqid).
        The first time we see a dqid we keep it; later repeats are dropped.

        idx_order: list of payload_rows indices (self.payload_rows[i]) in the
                   order we currently consider "filtered".
        """
        from typing import List, Set
        from pydantic import BaseModel

        class _State(BaseModel):
            seen: Set[str]
            out: List[int]

        st = _State(seen=set(), out=[])

        for i in idx_order:
            row = self.payload_rows[i]

            # pull the row's unique quote ID; fallback to index if missing
            dqid_raw = str(row.get("dqid") or "").strip()
            if dqid_raw == "":
                dqid_raw = "__idx__" + str(i)

            if dqid_raw in st.seen:
                # already kept a payload with this dqid, skip this one
                continue

            st.seen.add(dqid_raw)
            st.out.append(i)

        return st.out

    def _sync_visible_idx_full(self) -> None:
        """
        Decide which filtered index list should currently drive pagination and
        update self._visible_idx_full and self._total_items accordingly.

        If the 'Deduplicate' toggle is ON we use the deduped list.
        Otherwise we use the full list.
        """
        from pydantic import BaseModel
        from typing import List

        class _View(BaseModel):
            active: List[int]
            n: int

        dedup_on = hasattr(self, "chk_dedup") and self.chk_dedup.isChecked()

        if dedup_on:
            active_list = list(self._kept_idx_dedup_full)
        else:
            active_list = list(self._kept_idx_full)

        view_state = _View(active=active_list, n=len(active_list))

        self._visible_idx_full = view_state.active
        self._total_items = view_state.n

    def _build_flat_payloads(self) -> None:
        """
        Flatten self._all_batches_raw into self.payload_rows for fast filtering / paging.
        Each payload_rows[i] is one evidence fragment.

        Stored fields:
        - rq (RQ question string)
        - batch_theme (overarching theme / gold theme)
        - ev (evidence type)
        - tags / tags_norm sets
        - author_display / author_norm
        - year (int or None)
        - dqid (direct_quote_id; used for dedup)
        - paraphrase / direct_quote / researcher_comment
        - payload_blob (lowercased searchable blob for scope="all")
        - batch_index, payload_pos (for reconstructing page cards)

        Also initializes facet counts for sidebar.
        """
        from collections import defaultdict
        from pydantic import BaseModel

        class _RowBuild(BaseModel):
            rq: str
            batch_theme: str
            ev: str
            adisp: str
            anorm: str
            yi: int | None
            toks_disp: set[str]
            toks_norm: set[str]
            dqid: str
            paraphrase: str
            direct_quote: str
            researcher_comment: str
            payload_blob: str
            batch_index: int
            payload_pos: int

        self.payload_rows = []
        self.batch_index_to_payload_indices = defaultdict(list)

        for b_idx, b in enumerate(self._all_batches_raw or []):
            rq_val = str(b.get("rq_question") or "")
            theme_val = str(b.get("overarching_theme") or b.get("gold_theme") or b.get("theme") or "")
            payloads_list = b.get("payloads") or []

            for p_pos, p in enumerate(payloads_list):
                # stable ID for dedup
                raw_dqid = str(p.get("direct_quote_id") or "").strip()

                ev_val = str(p.get("evidence_type") or "mixed").strip().lower()
                key_val = str(p.get("item_key") or "").strip()

                disp = self._author_display_from_payload(p) or ""
                norm_disp = self._norm_author_label(disp) if disp else ""

                year_int = self._extract_int_year(p.get("year"))

                # collect tags
                tag_src = str(p.get("theme") or p.get("potential_theme") or "")
                raw_tags_list = []
                parts_split = re.split(r"[|,;/]", tag_src)
                for tok in parts_split:
                    t = tok.strip()
                    if t != "":
                        raw_tags_list.append(t)
                toks_disp = set(raw_tags_list)

                toks_norm_local = set()
                for t in toks_disp:
                    toks_norm_local.add(self._norm_tag(t))

                para_txt = str(p.get("paraphrase") or "")
                quote_txt = str(p.get("direct_quote") or "")
                note_txt = str(p.get("researcher_comment") or "")

                # build big search blob for scope="all"
                blob_parts: list[str] = []
                blob_parts.append(rq_val)
                blob_parts.append(theme_val)
                blob_parts.append(para_txt)
                blob_parts.append(quote_txt)
                blob_parts.append(note_txt)
                blob_parts.append(str(p.get("theme") or ""))
                blob_parts.append(str(p.get("potential_theme") or ""))
                blob_parts.append(disp or "")
                blob_parts.append(str(p.get("title") or ""))
                blob_parts.append(str(p.get("source") or ""))
                blob_parts.append(str(p.get("year") or ""))
                blob_parts.append(str(p.get("section_title") or ""))
                blob_parts.append(str(p.get("section_text") or ""))
                blob_parts.append(str(p.get("page") or ""))

                lowered_blob = (" \n ".join(blob_parts)).lower()

                built = _RowBuild(
                    rq=rq_val,
                    batch_theme=theme_val,
                    ev=ev_val,
                    adisp=disp,
                    anorm=norm_disp,
                    yi=year_int,
                    toks_disp=toks_disp,
                    toks_norm=toks_norm_local,
                    dqid=raw_dqid,
                    paraphrase=para_txt,
                    direct_quote=quote_txt,
                    researcher_comment=note_txt,
                    payload_blob=lowered_blob,
                    batch_index=b_idx,
                    payload_pos=p_pos,
                )

                row_idx_payload = {
                    "rq": built.rq,
                    "batch_theme": built.batch_theme,
                    "ev": built.ev,
                    "tags": built.toks_disp,
                    "tags_norm": built.toks_norm,
                    "item_key": key_val,
                    "author_display": built.adisp,
                    "author_norm": built.anorm,
                    "year": built.yi,
                    "dqid": built.dqid,
                    "paraphrase": built.paraphrase,
                    "direct_quote": built.direct_quote,
                    "researcher_comment": built.researcher_comment,
                    "payload_blob": built.payload_blob,
                    "batch_index": built.batch_index,
                    "payload_pos": built.payload_pos,
                    "score_bucket": p.get("score_bucket"),
                    "relevance_score": p.get("relevance_score"),
                }

                new_row_idx = len(self.payload_rows)
                self.payload_rows.append(row_idx_payload)
                self.batch_index_to_payload_indices[b_idx].append(new_row_idx)

        # initialize full facet counts (unfiltered)
        all_idx = set(range(len(self.payload_rows)))
        full_counts = self._counts_for_indices(all_idx)
        self._full_rq_counts = full_counts.get("rq", {})
        self._full_ev_counts = full_counts.get("ev", {})
        self._full_theme_counts = full_counts.get("theme", {})
        self._full_author_counts = full_counts.get("author", {})
        self._full_tag_counts = full_counts.get("tag", {})

    # ---------------- Pagination & Render ----------------
    def _on_page_size_change(self):
        try:
            self.page_size = int(self.cmb_page_size.currentText())
        except Exception:
            self.page_size = 50
        import math
        total = getattr(self, "_total_items", 0)
        ps = max(1, int(self.page_size))
        max_page = max(1, math.ceil(max(0, total) / ps))
        self.page = min(max(1, self.page), max_page)
        self.render_page()

    def _go_page(self, delta: int):
        import math
        total = max(0, int(self._total_items))
        ps = max(1, int(self.page_size))
        max_page = max(1, math.ceil(total / ps))
        self.page = max(1, min(max_page, self.page + delta))
        self.render_page()

    def render_page(self) -> None:
        """
        Render current page of batches into card lane.
        Uses self._visible_idx_full so cards, pager, exports and filters
        all share the same underlying set (dedup or not).
        """
        from pydantic import BaseModel
        from typing import Set
        import math

        class _PageState(BaseModel):
            total_items: int
            page_size: int
            max_page: int
            start: int
            end: int

        if self.card_list is None:
            self.card_list = QWidget()
            self.card_list.setObjectName("CardLane")
            self.card_list.setFixedWidth(CARD_LANE_WIDTH)
            self.card_list.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Minimum)
            self.card_layout = QVBoxLayout(self.card_list)
            self.card_layout.setSpacing(14)
            self.card_layout.setContentsMargins(6, 6, 6, 6)
            self.card_layout.setSizeConstraint(QLayout.SizeConstraint.SetMinimumSize)
            self.scroll.setWidget(self.card_list)

        if self.notes_overlay is None:
            self.notes_overlay = NotesOverlay(self.scroll.viewport())
            self.scroll.verticalScrollBar().valueChanged.connect(lambda _: self.notes_overlay.reposition())
            self.scroll.horizontalScrollBar().valueChanged.connect(lambda _: self.notes_overlay.reposition())

        for i in reversed(range(self.card_layout.count())):
            it = self.card_layout.itemAt(i)
            w = it.widget() if it else None
            if w is not None:
                self.card_layout.removeWidget(w)
                w.deleteLater()
            else:
                self.card_layout.removeItem(it)

        src_list = list(getattr(self, "_visible_idx_full", getattr(self, "_kept_idx_full", [])))
        total_now = len(src_list)
        page_size_now = max(1, int(self.page_size) if isinstance(self.page_size, int) else 10)

        if total_now == 0 and self.payload_rows:
            self._kept_idx_full = list(range(len(self.payload_rows)))
            self._kept_idx_dedup_full = self._build_dedup_list(self._kept_idx_full)
            self._sync_visible_idx_full()
            src_list = list(getattr(self, "_visible_idx_full", self._kept_idx_full))
            total_now = len(src_list)

        self._total_items = total_now

        if total_now == 0:
            self.lbl_page.setText("Page 1/1 (0 items)")
            self.btn_prev.setEnabled(False)
            self.btn_next.setEnabled(False)
            self._last_page_idx_set = set()
            self._update_export_actions_enabled()
            return

        max_page_now = max(1, math.ceil(total_now / page_size_now))
        if self.page < 1:
            self.page = 1
        if self.page > max_page_now:
            self.page = max_page_now

        st = _PageState(
            total_items=total_now,
            page_size=page_size_now,
            max_page=max_page_now,
            start=(self.page - 1) * page_size_now,
            end=min(total_now, (self.page - 1) * page_size_now + page_size_now),
        )

        page_idx_set: Set[int] = set(src_list[st.start:st.end])
        self._last_page_idx_set = page_idx_set

        page_batches_raw = self._make_trimmed_batches_from_idx(page_idx_set)

        if hasattr(self, "chk_dedup") and self.chk_dedup.isChecked():
            page_batches = self._dedup_page_batches(page_batches_raw)
        else:
            page_batches = page_batches_raw

        self.filtered = page_batches

        lane = self.card_list
        for b in page_batches:
            card = BatchCard(b, selected_idx=self._selected_idx)
            card.noteRequested.connect(lambda text, anchor, lw=lane: self.notes_overlay.show_for(anchor, text, lw))
            card.payloadClicked.connect(self.preview.show_payload)
            card.selectionToggled.connect(self._on_payload_selection_toggled)
            self.card_layout.addWidget(card)

        self.lbl_page.setText(f"Page {self.page}/{st.max_page} ({st.total_items} items)")
        self.btn_prev.setEnabled(self.page > 1)
        self.btn_next.setEnabled(self.page < st.max_page)

        self._update_export_actions_enabled()

    def _on_payload_selection_toggled(self, idx: int, checked: bool):
        if not isinstance(idx, int):
            return
        if checked:
            self._selected_idx.add(idx)
        else:
            self._selected_idx.discard(idx)
        self._update_export_actions_enabled()

    # ---------------- Export helpers ----------------
    def _current_page_indices(self) -> set[int]:
        total = max(0, int(getattr(self, "_total_items", 0)))
        ps = max(1, int(self.page_size) if isinstance(self.page_size, int) else 10)
        import math
        if total == 0:
            return set()
        max_page = max(1, math.ceil(total / ps))
        page = max(1, min(max_page, int(getattr(self, "page", 1))))
        start = (page - 1) * ps
        end = min(total, start + ps)
        src = getattr(self, "_visible_idx_full", getattr(self, "_kept_idx_full", []))
        src_list = list(src)
        return set(src_list[start:end])

    def _collect_payloads_from_idx(self, idx_set: set[int]) -> list[dict]:
        out = []
        for i in sorted(idx_set):
            r = self.payload_rows[i]
            b = self._all_batches_raw[r["batch_index"]]
            p = b["payloads"][r["payload_pos"]]
            out.append(p)
        return out

    def _build_export_html(self, payloads: list[dict], title: str) -> str:
        def esc(s: str) -> str:
            import html
            return html.escape(s or "")

        css = """
        body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; margin: 32px; color:#1e1e1e; }
        h1 { margin: 0 0 16px; font-size: 24px; }
        .card { background:#fff; border-radius:12px; box-shadow:0 6px 18px rgba(0,0,0,0.08); padding:16px; margin:14px 0; max-width: 980px; }
        .pill { display:inline-block; padding:2px 8px; border-radius:999px; background:#eef2ff; color:#3730a3; font-size:12px; margin-right:8px; }
        .meta { color:#64748b; font-size:13px; margin-top:8px; }
        blockquote { border-left:4px solid rgba(125,211,252,0.75); background:rgba(241,245,249,0.6); padding:8px 12px; margin:10px 0; border-radius:8px; }
        .rc { color:#334155; font-size:13px; margin-top:8px; }
        a { color:#2b579a; text-decoration:none; } a:hover { text-decoration:underline; }
        """

        parts = [f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{esc(title)}</title><style>{css}</style></head><body>
<h1>{esc(title)}</h1>
"""]

        for p in payloads:
            theme = (p.get("payload_theme") or p.get("theme") or p.get("potential_theme") or "").strip()
            paraphrase = p.get("paraphrase") or ""
            dq = (p.get("direct_quote") or "").strip()
            rc = (p.get("researcher_comment") or "").strip()

            class _MetaPartsExport(BaseModel):
                author: str
                year: str
                page: str
                source: str
                title_txt: str
                url: str

            raw_author = (
                    p.get("first_author_last")
                    or p.get("author_summary")
                    or p.get("author")
                    or ""
            )
            clean_author = raw_author
            if raw_author:
                split_a = re.split(r"[;·(]\s*", raw_author)
                if len(split_a) > 0:
                    clean_author = split_a[0].strip()

            year_val = str(p.get("year") or "").strip()
            page_val = str(p.get("page") or "").strip()
            source_val = str(p.get("source") or "").strip()
            title_txt = str(p.get("title") or "").strip()
            url_val = str(p.get("url") or "").strip()

            # same rule as in cards:
            #   - "2021, p. 42" if both
            #   - "2021" if only year
            #   - "p. 42" if only page
            year_page_segment = ""
            if year_val and page_val:
                year_page_segment = year_val + ", p. " + page_val
            elif year_val:
                year_page_segment = year_val
            elif page_val:
                year_page_segment = "p. " + page_val

            meta_bits_list = []
            if clean_author:
                meta_bits_list.append(clean_author)
            if year_page_segment:
                meta_bits_list.append(year_page_segment)
            if source_val:
                meta_bits_list.append(source_val)

            meta_line = " · ".join(meta_bits_list)

            parts_model = _MetaPartsExport(
                author=clean_author,
                year=year_val,
                page=page_val,
                source=source_val,
                title_txt=title_txt,
                url=url_val,
            )

            title_html = ""
            if title_txt:
                title_html = " · <em>" + esc(title_txt) + "</em>"

            link_html = ""
            if url_val:
                link_html = (
                        " · <a href='"
                        + esc(url_val)
                        + "' target='_blank' rel='noopener'>link</a>"
                )

            quote_html = f"<blockquote>“{esc(dq)}”</blockquote>" if dq else ""
            rc_html = f"<div class='rc'>{esc(rc)}</div>" if rc else ""
            pill = f"<span class='pill'>{esc(theme)}</span>" if theme else ""

            parts.append(f"""
<div class="card">
  <div>{pill}</div>
  <div style="font-size:16px; line-height:1.5; margin-top:6px;">{esc(paraphrase)}</div>
  {quote_html}
  {rc_html}
<div class="meta">{esc(meta_line)}{title_html}{link_html}</div>
</div>
""")

        parts.append("</body></html>")
        return "".join(parts)

    def _sanitize_filename(self, s: str) -> str:
        import re
        s = (s or "export").strip().lower()
        s = re.sub(r"\s+", "_", s)
        s = re.sub(r"[^\w\-\.]+", "", s)
        return s or "export"

    def _export_idx_set(self, idx_set: set[int], *, title: str):
        """
        Export given indices; if empty and title looks like current page, fall back to current page indices.
        Always prompts user for a save location.
        """
        from PyQt6.QtWidgets import QFileDialog, QMessageBox
        if not idx_set and "current page" in title.casefold():
            idx_set = self._current_page_indices()

        if not idx_set:
            QMessageBox.information(self, "Export", "No items to export.")
            return

        payloads = self._collect_payloads_from_idx(idx_set)
        html_str = self._build_export_html(payloads, title=title)

        from pathlib import Path
        start_dir = str(self.themes_dir or Path.home())
        suggested = self._sanitize_filename(title) + ".html"
        path, _ = QFileDialog.getSaveFileName(
            self, "Save HTML", str(Path(start_dir) / suggested),
            "HTML files (*.html);;All files (*.*)"
        )
        if not path:
            return

        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(html_str)
            QMessageBox.information(self, "Export complete", f"Saved {len(payloads)} items to:\n{path}")
        except Exception as e:
            QMessageBox.critical(self, "Export failed", str(e))

    def _copy_idx_set(self, idx_set: set[int], *, title: str):
        """
        Copy HTML for given indices; if empty and 'Current page', fall back to current page indices.
        """


        if not idx_set and "current page" in title.casefold():
            idx_set = self._current_page_indices()

        if not idx_set:
            QMessageBox.information(self, "Copy", "No items to copy.")
            return

        payloads = self._collect_payloads_from_idx(idx_set)
        html_str = self._build_export_html(payloads, title=title)

        QGuiApplication.clipboard().setText(html_str, QClipboard.Mode.Clipboard)
        QMessageBox.information(self, "Copied", f"Copied {len(payloads)} items to clipboard as HTML.")

    def _update_export_actions_enabled(self):
        has_sel = bool(getattr(self, "_selected_idx", set()))
        self.act_exp_sel.setEnabled(has_sel)
        self.act_copy_sel.setEnabled(has_sel)

    # ---------------- Batches building for page ----------------
    def _dedup_page_batches(self, batches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Given page_batches (list of batch dicts with .payloads[], each having dqid),
        return a new list where duplicate dqid payloads have been removed globally.

        We keep the FIRST occurrence of each dqid we see.
        Later batches silently lose that duplicate payload.

        Batches that become empty are dropped.

        This is purely a presentation layer. Under the hood, filters and exports
        still work with the full sets.
        """
        from pydantic import BaseModel
        from typing import Dict, List, Any, Set

        class _Seen(BaseModel):
            dq_seen: Set[str]

        state = _Seen(dq_seen=set())

        deduped_batches: List[Dict[str, Any]] = []

        for b in batches:
            out_payloads: List[Dict[str, Any]] = []
            for p in (b.get("payloads") or []):
                dqid_val = str(p.get("dqid") or "").strip()
                use_key = dqid_val if dqid_val != "" else ("__idx__" + str(p.get("__idx", "")))
                # skip if we've already shown this evidence
                if use_key in state.dq_seen:
                    continue
                state.dq_seen.add(use_key)
                out_payloads.append(p)

            if len(out_payloads) > 0:
                new_b = dict(b)
                new_b["payloads"] = out_payloads
                new_b["size"] = len(out_payloads)
                deduped_batches.append(new_b)

        return deduped_batches

    def _make_trimmed_batches_from_idx(self, kept_idx: set[int]) -> List[Dict[str, Any]]:
        """
        Build the list[batch] actually used to render cards for the page.
        Each payload dict in those batches gains:
            __idx  -> global payload_rows index
            dqid   -> stable dedupe key
        """
        from pydantic import BaseModel
        from collections import defaultdict
        from typing import Dict, List, Set, Tuple, Any

        class _MapState(BaseModel):
            pos_to_idx: Dict[Tuple[int, int], int]

        pos_to_idx_local: Dict[tuple[int, int], int] = {}
        for i, r in enumerate(self.payload_rows):
            pos_to_idx_local[(r["batch_index"], r["payload_pos"])] = i

        pos_by_batch: Dict[int, Set[int]] = defaultdict(set)
        for i in kept_idx:
            r = self.payload_rows[i]
            pos_by_batch[r["batch_index"]].add(r["payload_pos"])

        st = _MapState(pos_to_idx=pos_to_idx_local)

        trimmed: List[Dict[str, Any]] = []
        for b_idx, pos_set in pos_by_batch.items():
            orig_batch = self._all_batches_raw[b_idx]
            new_b = dict(orig_batch)

            orig_payloads = list(orig_batch.get("payloads") or [])
            new_payloads: List[Dict[str, Any]] = []

            for pos in sorted(pos_set):
                p_src = dict(orig_payloads[pos])
                global_idx = st.pos_to_idx[(b_idx, pos)]
                dqid_val = self.payload_rows[global_idx].get("dqid", "")
                p_src["__idx"] = global_idx
                p_src["dqid"] = dqid_val
                new_payloads.append(p_src)

            new_b["payloads"] = new_payloads
            new_b["size"] = len(new_payloads)
            trimmed.append(new_b)

        return trimmed

    # ---------------- Small utils ----------------
    def _update_full_values(self, section: object, data: dict[str, int]) -> None:
        if not section:
            return
        setter = getattr(section, "set_full_values", None)
        if callable(setter):
            setter(data)  # type: ignore[attr-defined]
            return
        try:
            setattr(section, "full_values", data)  # type: ignore[attr-defined]
        except Exception:
            pass
        if hasattr(section, "setProperty"):
            try:
                section.setProperty("full_values", data)  # type: ignore[attr-defined]
            except Exception:
                pass

    def _top_n(self, d: Dict[str, int], n: int = 10) -> Dict[str, int]:
        return dict(sorted(d.items(), key=lambda kv: (-kv[1], kv[0].casefold()))[:n])

    # --- AI context = same job format as process_rq_theme_claims -----------------

    def _payloads_for_mode(self, mode: str) -> list[dict]:
        """
        Collect raw payload dicts from the UI, depending on scope.
        mode: 'selected' | 'page' | 'all'
        """
        if mode == "selected":
            idx = set(self._selected_idx or set())
            if not idx:  # fallback to current page if nothing explicitly selected
                idx = self._current_page_indices()
        elif mode == "page":
            idx = self._current_page_indices()
        else:
            idx = set(range(len(self.payload_rows)))  # ALL filtered rows (respecting filters)
        return self._collect_payloads_from_idx(idx)

    def _dominant_label(self, values: list[str]) -> str:
        """Pick the majority label; falls back to 'mixed' when no majority."""
        from collections import Counter
        vals = [str(v).strip() for v in values if isinstance(v, str) and v and str(v).strip()]
        if not vals:
            return "mixed"
        c = Counter(vals)
        (lab, cnt) = c.most_common(1)[0]
        return lab if cnt > (sum(c.values()) / 2) else "mixed"

    def _sanitize_ai_row(self, row: dict, gold_theme: str, evidence_type: str) -> dict:
        """
        Mirror the sanitizer used in process_rq_theme_claims → _sanitize_row.
        """

        pt = (row.get("potential_theme") or row.get("theme") or "").strip() or "(unspecified)"

        dqid = (row.get("direct_quote_id") or "").strip()
        if not dqid:
            anchor = (row.get("direct_quote") or row.get("paraphrase") or row.get("researcher_comment") or "").strip()
            base = f"{row.get('item_key', '')}||{anchor}"
            dqid = hashlib.md5(base.encode("utf-8")).hexdigest()[:10]

        def strip_rq_refs(text: str) -> str:
            """
            Remove inline RQ markers like 'RQ1', 'RQ-2', '[RQ3]', '(RQ 4)', 'RQ1:' from a string.
            Leaves the rest of the text intact.
            """
            import re
            if not text:
                return ""

            s = str(text)

            # [RQ1], (RQ 1), {RQ-2}, etc.
            s = re.sub(r'[\(\[\{]\s*RQ\s*[-:]?\s*\d+[a-z]?\s*[\)\]\}]', ' ', s, flags=re.IGNORECASE)

            # Bare forms: RQ1, RQ-1, RQ 1, RQ1:, RQ 2.
            s = re.sub(r'\bRQ\s*[-:]?\s*\d+[a-z]?\b[:.]?', ' ', s, flags=re.IGNORECASE)

            # Occasionally authors write “RQs 1–3”; strip the “RQs 1–3” chunk
            s = re.sub(r'\bRQs?\s*\d+\s*[-–]\s*\d+\b', ' ', s, flags=re.IGNORECASE)

            # Collapse extra whitespace
            s = re.sub(r'\s{2,}', ' ', s).strip()
            return s

        # try to use global strip_rq_refs if present, otherwise no-op
        try:
            stripped_para = strip_rq_refs(row.get("paraphrase") or "")
        except Exception:
            stripped_para = row.get("paraphrase") or ""

        return {
            "item_key": row.get("item_key"),
            "direct_quote": row.get("direct_quote"),
            "paraphrase": stripped_para,
            "researcher_comment": row.get("researcher_comment"),
            "evidence_type": (row.get("evidence_type") or evidence_type or "mixed"),
            "direct_quote_id": dqid,
            "theme": pt,
        }

    def get_ai_jobs(self, mode: str) -> list[tuple[dict, str]]:
        """
        Return a list of (job_dict, prompt_str) tuples identical to the input
        expected by process_rq_theme_claims Round-1.
        - Groups payloads by (rq_question, overarching_theme)
        - Computes dominant potential_theme and evidence_type per group
        - Sanitizes rows to the exact minimal schema used in the pipeline
        - Preserves scoring fields (relevance_score, score_bucket) for downstream use.
        """
        payloads = self._payloads_for_mode(mode)

        from collections import defaultdict
        groups: dict[tuple[str, str], list[dict]] = defaultdict(list)

        def _s(x: object) -> str:
            if x is None:
                return ""
            return str(x).strip()

        for p in (payloads or []):
            rq = _s(p.get("_rq_question") or p.get("rq_question"))
            gold = _s(
                p.get("_overarching_theme")
                or p.get("overarching_theme")
                or p.get("gold_theme")
            )

            p2 = dict(p or {})
            p2["rq_question"] = rq
            p2["gold_theme"] = gold
            p2["potential_theme"] = _s(p.get("potential_theme") or p.get("theme"))
            p2["evidence_type"] = _s(p.get("evidence_type") or "mixed").lower()

            if "score_bucket" in p:
                p2["score_bucket"] = p.get("score_bucket")
            if "relevance_score" in p:
                p2["relevance_score"] = p.get("relevance_score")

            groups[(rq, gold)].append(p2)

        jobs: list[tuple[dict, str]] = []
        for (rq, gold), rows in groups.items():
            ev_dom = self._dominant_label(
                [_s(r.get("evidence_type") or "mixed") for r in rows]
            )
            pt_dom = self._dominant_label(
                [_s(r.get("potential_theme")) for r in rows]
            )

            clean_rows: list[dict] = []
            for r in rows:
                clean = self._sanitize_ai_row(
                    r,
                    gold_theme=gold,
                    evidence_type=ev_dom,
                )
                if "score_bucket" in r and "score_bucket" not in clean:
                    clean["score_bucket"] = r.get("score_bucket")
                if "relevance_score" in r and "relevance_score" not in clean:
                    clean["relevance_score"] = r.get("relevance_score")
                clean_rows.append(clean)

            job = {
                "rq_question": rq,
                "theme": gold or "(gold)",
                "potential_theme": pt_dom or "(unspecified)",
                "evidence_type": ev_dom or "mixed",
                "route": "adhoc",
                "payloads": clean_rows,
            }

            prompt = PYR_L1_PROMPT.format(
                research_question=rq or "",
                overarching_theme=gold or "",
                evidence_type=ev_dom or "mixed",
            )

            jobs.append((job, prompt))

        return jobs

    def get_ai_context_summary_text(self, mode: str) -> str:
        """
        Optional: build a compact, human-readable summary of the jobs to display in the AI panel
        while still sending structured jobs to your backend.
        """
        jobs = self.get_ai_jobs(mode)
        lines = []
        total_payloads = 0
        for i, (job, _p) in enumerate(jobs, 1):
            n = len(job.get("payloads") or [])
            total_payloads += n
            lines.append(
                f"{i}. RQ: {job.get('rq_question') or '—'} | Gold: {job.get('theme') or '—'} | ET: {job.get('evidence_type') or 'mixed'} | items={n}")
        lines.append(f"---\nTotal groups: {len(jobs)} | Total items: {total_payloads}")
        return "\n".join(lines)

    # ---------- AI modal integration ----------
    def _gather_scope_payloads(self, scope: str) -> List[Dict[str, Any]]:
        """
        Return a list of RAW payload dicts (full fidelity) based on the user's chosen scope.
        We map the UI selection/page/all → global payload indices,
        then reconstruct each original payload dict (with paraphrase, direct_quote, etc.)
        via _collect_payloads_from_idx.
        """

        # figure out which payload-row indices to include
        if scope == "Selected items":
            idx = set(getattr(self, "_selected_idx", set()) or set())
            if not idx:  # graceful fallback
                idx = set(getattr(self, "_last_page_idx_set", set()) or set())

        elif scope == "Current page":
            idx = set(getattr(self, "_last_page_idx_set", set()) or set())

        elif scope == "All pages":
            # "all pages" == everything that survived current filters (self._kept_idx_full)
            kept_list = getattr(self, "_kept_idx_full", [])
            idx = set(kept_list or [])
            if not idx:
                idx = set(getattr(self, "_last_page_idx_set", set()) or set())

        else:
            # "Whole data": all loaded rows (ignores current filters)
            total_rows = len(getattr(self, "payload_rows", []) or [])
            idx = set(range(total_rows))

        # now turn those indices into the REAL payload dicts
        return self._collect_payloads_from_idx(idx)

    def _snapshot_filters(self) -> dict:
        """
        Snapshot the *visible* filter state at the moment the user clicks
        'Code data'. We want the human-readable selections, not internal keys.

        Returns a dict that goes straight into ai_modal_result["filters"].
        """

        # tiny helper so we don't crash if a widget is missing
        def _safe_checked(widget) -> list[str]:
            if widget is None:
                return []
            # Prefer .checked() (returns the label text of each checked box)
            if hasattr(widget, "checked") and callable(widget.checked):
                vals = widget.checked()
            # Fallback: some legacy widgets only expose .checked_keys()
            elif hasattr(widget, "checked_keys") and callable(widget.checked_keys):
                vals = widget.checked_keys()
            else:
                vals = []
            # normalize to a plain list of nonempty strings
            out = []
            for v in vals or []:
                if isinstance(v, str):
                    t = v.strip()
                    if t:
                        out.append(t)
                else:
                    # just in case the widget returns tuples/objects
                    out.append(str(v))
            return out

        return {
            "search": self.search_bar.text().strip() if hasattr(self, "search_bar") else "",
            "rq": _safe_checked(getattr(self, "chk_rq", None)),
            "evidence_type": _safe_checked(getattr(self, "chk_ev", None)),
            "theme": _safe_checked(getattr(self, "chk_theme", None)),
            "tags": _safe_checked(getattr(self, "chk_tags", None)),
            "authors": _safe_checked(getattr(self, "chk_authors", None)),
            "years": _safe_checked(getattr(self, "chk_years", None)),
            "page": getattr(self, "current_page", 1),
            "page_size": getattr(self, "page_size", 50),
        }

    def _on_ai_modal_confirm(self, choice: AiScopeChoice) -> None:
        """
        Deprecated in favour of background runner. Kept for compatibility, delegates to _open_ai_modal().
        """
        self._open_ai_modal()

    def _open_ai_modal(self) -> None:
        """
        Open AI scope dialog and, if accepted, kick off the background run.
        The mini window opens immediately; all heavy work (DF hydration, row materialisation)
        runs in a worker thread to keep the UI responsive.
        """
        from PyQt6.QtWidgets import QDialog
        from PyQt6.QtCore import QThread
        from pathlib import Path
        from pydantic import BaseModel

        has_sel: bool = bool(getattr(self, "_selected_idx", set()))
        dlg = AiScopeDialog(parent=self, show_selected=has_sel)
        if dlg.exec() != QDialog.DialogCode.Accepted or dlg.choice is None:
            return

        choice = dlg.choice

        # Mini window FIRST to remove perceived delay
        win = ZoteroMiniWindow("Zotero — Background AI Run")
        win.show()
        win.raise_()
        win.activateWindow()

        # Resolve paths/ids
        base_dir: str = str(self.thematics_out_dir or (self.themes_dir / "thematics_outputs"))
        zotero_collection: str = str((self.themes_dir or Path(".")).name)

        # Snapshot filters; heavy work moves to the worker
        filter_state: dict = self._snapshot_filters()

        # ai_modal_result shell; 'data' filled by worker
        # Canonical shell for ai_modal_result; 'data' will be filled in by worker
        ai_modal_result: dict = {
            "data": [],
            "dates": str(choice.date_ranges or ""),
            "filters": dict(filter_state or {}),
            "batch_size": int(choice.batch_size),
            "batch_overlapping": int(choice.batch_overlapping),
            "prompt": str(choice.extra_prompt or "").strip(),
            "data_scope": str(choice.data_scope or ""),
            "framework_analysis": bool(choice.framework_analysis),
            "round2": str(choice.round2 or "paragraphs"),
        }

        # Human-friendly label for model collection/batch ids
        batch_label: str = collection_label_for(
            filters=ai_modal_result.get("filters", {}),
            dates=ai_modal_result.get("dates", ""),
            batch_size=int(choice.batch_size),
            batch_overlapping=int(choice.batch_overlapping),
        )

        # Compute only the index set for the selected scope (cheap), not the rows
        def _compute_idx_for_scope(scope: str) -> list[int]:
            if scope == "Selected items":
                idx: list[int] = list(sorted(getattr(self, "_selected_idx", set()) or set()))
                if not idx:
                    idx = list(sorted(getattr(self, "_last_page_idx_set", set()) or set()))
                return idx
            if scope == "Current page":
                return list(sorted(getattr(self, "_last_page_idx_set", set()) or set()))
            if scope == "All pages":
                kept_list: list[int] = getattr(self, "_kept_idx_full", []) or []
                if not kept_list:
                    kept_list = list(sorted(getattr(self, "_last_page_idx_set", set()) or set()))
                return list(sorted(set(kept_list)))
            total_rows: int = len(getattr(self, "payload_rows", []) or [])
            return list(range(total_rows))

        idx_for_scope: list[int] = _compute_idx_for_scope(choice.data_scope)

        # Grab immutable data blobs for background reconstruction
        batches_raw: list[dict] = list(getattr(self, "_all_batches_raw", []) or [])
        payload_rows_flat: list[dict] = list(getattr(self, "payload_rows", []) or [])

        # Immediate snapshot to the mini window
        win.append_log(ProgressEvent(message=f"[AI-OPEN] scope= {ai_modal_result['data_scope']}", percent=2))
        win.append_log(ProgressEvent(message=f"[AI-OPEN] dates= {ai_modal_result['dates']}", percent=3))
        win.append_log(
            ProgressEvent(message=f"[AI-OPEN] filters= {list((ai_modal_result['filters'] or {}).keys())}", percent=4)
        )
        win.append_log(ProgressEvent(message=f"[AI-OPEN] batch_size= {ai_modal_result['batch_size']}", percent=5))
        win.append_log(ProgressEvent(message=f"[AI-OPEN] overlap= {ai_modal_result['batch_overlapping']}", percent=6))
        win.append_log(ProgressEvent(message=f"[AI-OPEN] idx.count= {len(idx_for_scope)}", percent=7))

        # Start worker with full context and cheap index set
        # Start worker with full context and cheap index set
        worker = RoundRunnerWorker(
            ai_choice=choice,
            ai_modal_result=ai_modal_result,
            dir_base=base_dir,
            batch_label=batch_label,
            zotero_collection=zotero_collection,
            df=None,  # DF hydration happens inside the worker
            batch_size=int(choice.batch_size),
            batch_overlapping=int(choice.batch_overlapping),
            idx_for_scope=idx_for_scope,
            batches_raw=batches_raw,
            payload_rows_flat=payload_rows_flat,
        )

        th = QThread(self)
        worker.moveToThread(th)

        # Wire signals to the mini window (logs, percentage, items feed)
        worker.signals.progress.connect(lambda s: win.append_log(ProgressEvent(message=s, percent=None)))
        worker.signals.percent.connect(lambda n: win.append_log(ProgressEvent(message=f"progress  ({n}%)", percent=n)))
        worker.signals.item_collected.connect(win.append_item)
        worker.signals.finished.connect(
            lambda payload: win.append_log(
                ProgressEvent(
                    message=f"[DONE] exports={payload.get('export_paths', {})}",
                    percent=100
                )
            )
        )

        class _ErrorEnvelope(BaseModel):
            text: str

        def _append_full_error(payload: Union[ErrorInfo, str]) -> None:
            if isinstance(payload, ErrorInfo):
                header: str = f"[{payload.exc_type}] {payload.message}"
                location: str = f"{payload.filename}:{payload.lineno} in {payload.funcname}"
                previous: str = f"{payload.prev_filename}:{payload.prev_lineno} in {payload.prev_funcname}"
                body: str = payload.formatted
                win.append_log(
                    ProgressEvent(
                        message=f"{header}\n{location}\nprev: {previous}\n\n{body}",
                        percent=None
                    )
                )
                return
            env = _ErrorEnvelope(text=str(payload))
            win.append_log(ProgressEvent(message=f"[ERROR]\n{env.text}", percent=None))

        worker.signals.error_occurred.connect(_append_full_error)

        # Announce start to the mini window and flush UI immediately
        win.append_log(ProgressEvent(message="Starting AI coding…", percent=0))
        QApplication.processEvents()

        th.started.connect(worker.run)
        th.start()

        # keep strong refs so the thread and worker are not GC'd
        self._bg_refs.append((th, worker, win))

    def load_from_run_dir(self, run_dir: Path) -> None:
        """
        Dashboard hook: display batches for a *specific* run directory.
        """
        run_dir = Path(run_dir).resolve()
        print(f"[L1BatchesPage] load_from_run_dir -> {run_dir}")

        # same idea: point the page at that run, then reload
        self.themes_dir = run_dir

        if hasattr(self, "load_data") and callable(self.load_data):
            self.load_data()
        else:
            print("[L1BatchesPage] WARNING: no load_data() method defined")

    def clear_view(self) -> None:
        print("[L1BatchesPage] clear_view()")
        try:
            # wipe UI cards
            if hasattr(self, "card_layout") and self.card_layout:
                while self.card_layout.count():
                    it = self.card_layout.takeAt(0)
                    w = it.widget()
                    if w:
                        w.deleteLater()

            # reset summary label
            if hasattr(self, "lbl_page"):
                self.lbl_page.setText("Page 0/0 (0 items)")

            # clear in-memory data
            self.all_batches = []
            self.filtered = []
            self._kept_idx_full = []
            self._last_page_idx_set = set()
            self._selected_idx = set()
            self._total_items = 0
        except Exception as e:
            print(f"[L1BatchesPage] clear_view() suppressed error: {e}")

    def _show_preview_payload(self, item: dict) -> None:
        """
        Called when user clicks a payload in a BatchCard OR from coder panel.
        We route it into PreviewPanel, then make sure the sidebar is showing 'preview'.
        """
        from pydantic import BaseModel

        class _In(BaseModel):
            payload: dict

        _In(payload=dict(item or {}))

        # send data to PreviewPanel
        self.preview.show_payload(item)

        # ensure preview page is visible in the right sidebar
        if hasattr(self, "right_stack") and hasattr(self, "preview_container"):
            self.right_stack.setCurrentWidget(self.preview_container)
        # expand sidebar in preview mode
        if hasattr(self, "_sync_toggles"):
            self._sync_toggles("preview")


# ============================ SECTIONS: CARD ============================


from pathlib import Path


def load_paragraphs(run_dir: Path) -> list[dict]:
    """
    Load paragraph-level Pyramid output from a given run directory.

    Expects one of:
      - pyr_l1_sections_paragraphs.json
      - pyr_l1_sections_paragraphs.feather

    Returns a list[dict] shaped like SectionsTab expects:
        {
          "meta": {
              "custom_id": "...",
              "rq": "...",
              "gold_theme": "...",
              "evidence_type": "...",
              "route": "..."
          },
          "section_html": "<p> ... paragraph html ... </p>"
        }

    We normalize feather → same shape so ParagraphsTab can just reuse SectionCard.
    """
    import json
    import pandas as pd

    run_dir = Path(run_dir)

    json_path = run_dir / "pyr_l1_sections_paragraphs.json"
    if json_path.is_file():
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # we assume JSON already matches the {"meta":..., "section_html":...} shape
        print(f"[load_paragraphs] loaded {len(data)} paras from {json_path}")
        return data

    feather_path = run_dir / "pyr_l1_sections_paragraphs.feather"
    if feather_path.is_file():
        df = pd.read_feather(feather_path)

        out: list[dict] = []
        for _, row in df.iterrows():
            meta = {
                "custom_id": str(row.get("custom_id", "")),
                "rq": str(row.get("rq", "")),
                "gold_theme": str(row.get("gold_theme", "")),
                "evidence_type": str(row.get("evidence_type", "")),
                "route": str(row.get("route", "")),
            }

            # exporter might have either `paragraph_html` or `section_html`
            html_val = row.get("paragraph_html", None)
            if html_val is None:
                html_val = row.get("section_html", "")

            out.append({
                "meta": meta,
                "section_html": html_val,
            })

        print(f"[load_paragraphs] rebuilt {len(out)} paras from {feather_path}")
        return out

    print(f"[load_paragraphs] no paragraphs file in {run_dir}")
    return []
