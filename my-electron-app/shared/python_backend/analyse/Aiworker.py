from Z_Corpus_analysis.help_widgets import ZoteroMiniWindow, ProgressEvent
from bibliometric_analysis_tool.utils.Zotero_loader_to_df import load_data_from_source_for_widget

from thematic_functions_legacy import  process_widget_data
from typing import Optional, Callable, TYPE_CHECKING, cast, Dict, Any, TypeVar, Protocol, \
    Generic, List

from PyQt6.QtWidgets import QDialog, QLabel

import pandas as pd

import re


from pydantic import BaseModel, Field
from PyQt6.QtCore import QObject, pyqtSignal, QThread, Qt
from PyQt6.QtWidgets import (

    QTextEdit)

from PyQt6.QtWidgets import (
    QHBoxLayout,
    QPushButton,
    QVBoxLayout,
    QCheckBox,
     QComboBox,
    QWidget,

    QSpinBox, QGridLayout

)



def _build_flat_card(row: dict) -> dict:
    """
    Turn one flattened row (from _gather_scope_payloads / _build_flat_payloads / etc.)
    into the shape that grouping_widget_data() and batching_widget_data() expect.

    We return ONLY plain dicts — no dataclasses / Pydantic.

    {
        "payload": {...},    # semantic content (RQ, theme, quote, etc.)
        "metadata": {...}    # citation / context / provenance
    }

    Key goals:
    - Never emit None (we coerce to "") so JSON dumps don't show null.
    - Preserve item_key, potential_theme, score_bucket, etc.
    - Carry through rq_question / overarching_theme from any alias.
    - Carry through 'route' if it's already known upstream.
    """

    def _s(v):
        """Stringify a scalar, but map None -> ''. Also keep ints nicely."""
        if v is None:
            return ""
        try:
            # keep "2021" instead of "2021.0"
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                if isinstance(v, float) and v.is_integer():
                    return str(int(v))
                return str(v)
        except Exception:
            pass
        return str(v).strip()

    # -------------------------
    # Research question (RQ)
    # -------------------------
    rq_val = _s(
        row.get("rq_question")
        or row.get("rq")
        or row.get("rq_key")
        or row.get("_rq_question")
    )

    # -------------------------
    # High-level / "gold" theme
    # -------------------------
    gold_val = _s(
        row.get("overarching_theme")
        or row.get("gold_theme")
        or row.get("_overarching_theme")
    )

    # -------------------------
    # Theme label (leaf theme)
    # -------------------------
    theme_val = _s(
        row.get("theme")
        or row.get("batch_theme")
        or row.get("payload_theme")
        or row.get("potential_theme")
    ) or "(unspecified)"

    # -------------------------
    # Evidence type
    # -------------------------
    ev_raw = (
            row.get("ev")
            or row.get("evidence_type")
            or row.get("evidence_type_norm")
            or "mixed"
    )
    ev_val = _s(ev_raw).lower() or "mixed"

    # -------------------------
    # Other per-record bits
    # -------------------------
    year_val = _s(row.get("year"))
    direct_quote_id_val = _s(row.get("direct_quote_id"))
    direct_quote_val = _s(row.get("direct_quote"))
    paraphrase_val = _s(row.get("paraphrase"))
    researcher_comment = _s(row.get("researcher_comment"))
    relevance_score_val = _s(row.get("relevance_score"))
    potential_theme_val = _s(row.get("potential_theme"))
    item_key_val = _s(row.get("item_key"))

    # -------------------------
    # Metadata / provenance bits
    # -------------------------
    score_bucket_val = _s(row.get("score_bucket"))

    first_author_last_val = _s(
        row.get("first_author_last")
        or row.get("author_summary")
    )
    author_summary_val = _s(row.get("author_summary"))
    author_full_val = _s(row.get("author"))

    title_val = _s(row.get("title"))
    source_val = _s(row.get("source") or row.get("publicationTitle"))
    url_val = _s(row.get("url"))

    page_val = _s(row.get("page"))
    section_title_val = _s(row.get("section_title"))
    section_text_val = _s(row.get("section_text"))

    # route (if this row came from a batch that already tracked layer structure)
    route_val = _s(
        row.get("route")
        or row.get("layer_structure")
        or row.get("layer_route")
    )

    # -------------------------
    # payload block
    # -------------------------
    payload_block = {
        # keep raw JSON blob if upstream provided it (else "")
        "payload_json": row.get("payload_json") or "",

        # keys used by grouping_widget_data() for hierarchical grouping
        "rq_question": rq_val,
        "rq": rq_val,  # fallback (some code still looks at 'rq')
        "overarching_theme": gold_val,
        "gold_theme": gold_val,
        "theme": theme_val,
        "potential_theme": potential_theme_val,
        "evidence_type": ev_val,

        # record-level identifiers / content
        "direct_quote_id": direct_quote_id_val,
        "direct_quote": direct_quote_val,
        "paraphrase": paraphrase_val,
        "researcher_comment": researcher_comment,

        # scoring / misc
        "relevance_score": relevance_score_val,
        "item_key": item_key_val,

        # year (for temporal bucketing)
        "year": year_val,
    }

    # -------------------------
    # metadata block
    # -------------------------
    metadata_block = {
        "score_bucket": score_bucket_val,

        # author-ish
        "first_author_last": first_author_last_val,
        "author_summary": author_summary_val,
        "author": author_full_val,

        # citation-ish
        "title": title_val,
        "source": source_val,
        "url": url_val,

        # location in source
        "page": page_val,
        "section_title": section_title_val,
        "section_text": section_text_val,

        # duplicates for convenience
        "year": year_val,
        "gold_theme": gold_val,

        # routing / provenance
        "route": route_val,
    }

    return {
        "payload": payload_block,
        "metadata": metadata_block,
    }


def to_ai_modal_result(
        *,
        payloads: List[dict],
        dates: str,
        filters: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Build the object we print in [AI_MODAL_RESULT] and feed into
    grouping_widget_data().

    We now return ONLY plain dicts:
    {
        "data":    [ { "payload": {...}, "metadata": {...} }, ... ],
        "dates":   "...",
        "filters": {
            "search": "...",
            "rq": [...],
            "evidence_type": [...],
            "theme": [...],
            "tags": [...],
            "authors": [...],
            "years": [...],
            "page": int,
            "page_size": int
        }
    }
    """

    def _coerce_list_str(v) -> List[str]:
        if v is None:
            return []
        if isinstance(v, (list, tuple, set)):
            out = []
            for x in v:
                if x is None:
                    continue
                s = str(x).strip()
                if s:
                    out.append(s)
            return out
        if isinstance(v, str):
            s = v.strip()
            return [s] if s else []
        return [str(v).strip()]

    def _coerce_int_or_zero(v) -> int:
        try:
            return int(v)
        except Exception:
            return 0

    cards: List[Dict[str, Any]] = [
        _build_flat_card(row) for row in (payloads or [])
    ]

    filters_state: Dict[str, Any] = {
        "search": str(filters.get("search", "")),
        "rq": _coerce_list_str(filters.get("rq")),
        "evidence_type": _coerce_list_str(
            filters.get("evidence_type") or filters.get("evidence")
        ),
        "theme": _coerce_list_str(filters.get("theme")),
        "tags": _coerce_list_str(filters.get("tags")),
        "authors": _coerce_list_str(filters.get("authors")),
        "years": _coerce_list_str(filters.get("years")),
        "page": _coerce_int_or_zero(filters.get("page")),
        "page_size": _coerce_int_or_zero(filters.get("page_size")),
    }

    return {
        "data": cards,
        "dates": str(dates),
        "filters": filters_state,
    }


class AiScopeChoice(BaseModel):
    data_scope: str = Field(default="Whole data")
    date_ranges: str = Field(default="")
    batch_size: int = Field(default=20)
    batch_overlapping: int = Field(default=10)
    extra_prompt: str = Field(default="")
    framework_analysis: bool = Field(default=True)
    round2: str = Field(default="sections")  # one of: "paragraphs" | "sections"
    rows: List[Dict[str, Any]] = Field(default_factory=list)
    filters: Dict[str, Any] = Field(default_factory=dict)



class AiScopeDialog(QDialog):
    """
    Premium AI modal.

    Fields:
      • Data scope dropdown
      • Date ranges (editable combo)
      • Batch size (spin box)
      • Overlap (spin box)
      • Framework analysis (checkbox)
      • Round-2 mode (paragraphs/sections)
      • Additional prompt (multiline text)

    On accept(), self.choice is an AiScopeChoice.
    """

    def __init__(self, parent: Optional[QWidget] = None, show_selected: bool = False) -> None:
        from pydantic import BaseModel

        class _UiCfg(BaseModel):
            min_width: int

        super().__init__(parent)
        cfg = _UiCfg(min_width=360)

        self.setWindowTitle("AI Coding")
        self.setWindowModality(Qt.WindowModality.ApplicationModal)
        self.setMinimumWidth(cfg.min_width)

        self.choice: Optional[AiScopeChoice] = None

        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(16, 16, 16, 16)
        root_layout.setSpacing(12)

        scope_layout = QVBoxLayout()
        lbl_scope = QLabel("Data")
        self.cmb_scope = QComboBox()
        scope_options: List[str] = []
        if show_selected:
            scope_options.append("Selected items")
        scope_options.extend(["All pages", "Current page", "Whole data"])
        self.cmb_scope.addItems(scope_options)
        scope_layout.addWidget(lbl_scope)
        scope_layout.addWidget(self.cmb_scope)
        root_layout.addLayout(scope_layout)

        date_layout = QVBoxLayout()
        lbl_dates = QLabel("Split by dates")
        self.cmb_dates = QComboBox()
        self.cmb_dates.setEditable(True)
        self.cmb_dates.addItems([
            "1999-2009,2010-2018,2019-2025",

            "1999-2009,2009-2014,2014-2025",
            "none",
            ""
        ])
        self.cmb_dates.setCurrentIndex(0)
        date_layout.addWidget(lbl_dates)
        date_layout.addWidget(self.cmb_dates)
        root_layout.addLayout(date_layout)

        batch_layout = QGridLayout()
        lbl_batch = QLabel("Batch size")
        self.spn_batch = QSpinBox()
        self.spn_batch.setMinimum(1)
        self.spn_batch.setMaximum(1000)
        self.spn_batch.setValue(20)

        lbl_overlap = QLabel("Overlap")
        self.spn_overlap = QSpinBox()
        self.spn_overlap.setMinimum(0)
        self.spn_overlap.setMaximum(500)
        self.spn_overlap.setValue(10)

        batch_layout.addWidget(lbl_batch, 0, 0)
        batch_layout.addWidget(self.spn_batch, 0, 1)
        batch_layout.addWidget(lbl_overlap, 1, 0)
        batch_layout.addWidget(self.spn_overlap, 1, 1)
        root_layout.addLayout(batch_layout)

        fx_layout = QGridLayout()
        self.chk_framework = QCheckBox("Framework analysis")
        self.chk_framework.setChecked(False)
        lbl_round2 = QLabel("Round-2 mode")
        self.cmb_round2 = QComboBox()
        self.cmb_round2.addItems(["sections", "paragraphs"])
        fx_layout.addWidget(self.chk_framework, 0, 0, 1, 2)
        fx_layout.addWidget(lbl_round2, 1, 0)
        fx_layout.addWidget(self.cmb_round2, 1, 1)
        root_layout.addLayout(fx_layout)

        prompt_layout = QVBoxLayout()
        lbl_prompt = QLabel("Additional prompt")
        self.txt_prompt = QTextEdit()
        self.txt_prompt.setPlaceholderText(
            "Optional:\nTell the AI how to summarise, extract policy recs,\ncompare states, etc."
        )
        self.txt_prompt.setMinimumHeight(90)
        prompt_layout.addWidget(lbl_prompt)
        prompt_layout.addWidget(self.txt_prompt)
        root_layout.addLayout(prompt_layout)

        btn_layout = QHBoxLayout()
        btn_ok = QPushButton("Run")
        btn_cancel = QPushButton("Cancel")
        btn_ok.clicked.connect(self._on_accept)
        btn_cancel.clicked.connect(self.reject)
        btn_layout.addStretch(1)
        btn_layout.addWidget(btn_cancel)
        btn_layout.addWidget(btn_ok)
        root_layout.addLayout(btn_layout)

    def _on_accept(self) -> None:
        scope_val: str = str(self.cmb_scope.currentText() or "").strip()
        dates_val: str = str(self.cmb_dates.currentText() or "").strip()
        batch_val: int = int(self.spn_batch.value())
        overlap_val: int = int(self.spn_overlap.value())
        prompt_val: str = str(self.txt_prompt.toPlainText() or "").strip()
        framework_val: bool = bool(self.chk_framework.isChecked())
        round2_val: str = str(self.cmb_round2.currentText() or "paragraphs").strip()

        self.choice = AiScopeChoice(
            data_scope=scope_val,
            date_ranges=dates_val,
            batch_size=batch_val,
            batch_overlapping=overlap_val,
            extra_prompt=prompt_val,
            framework_analysis=framework_val,
            round2=round2_val,
        )
        self.accept()
class RoundRunnerSignals(QObject):
    progress = pyqtSignal(str)
    percent = pyqtSignal(int)
    finished = pyqtSignal(dict)


class _RunnerSignals(QObject):
    progress = pyqtSignal(str)
    percent = pyqtSignal(int)
    finished = pyqtSignal(dict)

T = TypeVar("T")

if TYPE_CHECKING:
    class _SignalT(Protocol, Generic[T]):
        def connect(self, slot: Callable[[T], None]) -> None: ...

        def emit(self, value: T) -> None: ...

class RoundRunnerWorker(QObject):
    """
    Background worker for the AI pipeline.
    It materialises rows from indices, echoes items to the mini window,
    runs process_widget_data, and streams progress — including framework/round2 settings.
    """

    class _Signals(QObject):
        progress = pyqtSignal(str)
        percent = pyqtSignal(int)
        item_collected = pyqtSignal(str)
        finished = pyqtSignal(dict)
        error_occurred = pyqtSignal(object)

        def connect_progress(self, slot: Callable[[str], None]) -> None:
            cast(Any, self.progress).connect(slot, Qt.ConnectionType.QueuedConnection)

        def emit_progress(self, value: str) -> None:
            cast(Any, self.progress).emit(value)

        def connect_percent(self, slot: Callable[[int], None]) -> None:
            cast(Any, self.percent).connect(slot, Qt.ConnectionType.QueuedConnection)

        def emit_percent(self, value: int) -> None:
            cast(Any, self.percent).emit(value)

        def connect_item_collected(self, slot: Callable[[str], None]) -> None:
            cast(Any, self.item_collected).connect(slot, Qt.ConnectionType.QueuedConnection)

        def emit_item_collected(self, value: str) -> None:
            cast(Any, self.item_collected).emit(value)

        def connect_finished(self, slot: Callable[[dict], None]) -> None:
            cast(Any, self.finished).connect(slot, Qt.ConnectionType.QueuedConnection)

        def emit_finished(self, value: Dict[str, Any]) -> None:
            cast(Any, self.finished).emit(value)

        def connect_error_occurred(self, slot: Callable[[object], None]) -> None:
            cast(Any, self.error_occurred).connect(slot, Qt.ConnectionType.QueuedConnection)

        def emit_error_occurred(self, value: object) -> None:
            cast(Any, self.error_occurred).emit(value)

    if TYPE_CHECKING:
        _Signals.progress: "_SignalT[str]"
        _Signals.percent: "_SignalT[int]"
        _Signals.item_collected: "_SignalT[str]"
        _Signals.finished: "_SignalT[Dict[str, Any]]"
        _Signals.error_occurred: "_SignalT[object]"

    def __init__(
            self,
            *,
            ai_choice: "AiScopeChoice",
            ai_modal_result: Dict[str, Any],
            dir_base: str,
            batch_label: str,
            zotero_collection: str,
            df: Any,
            batch_size: int,
            batch_overlapping: int,
            idx_for_scope: list[int],
            batches_raw: list[dict],
            payload_rows_flat: list[dict],
    ) -> None:
        super().__init__()
        self.signals: RoundRunnerWorker._Signals = RoundRunnerWorker._Signals()
        self.ai_choice: "AiScopeChoice" = ai_choice
        self.ai_modal_result: Dict[str, Any] = dict(ai_modal_result)
        self.dir_base: str = dir_base
        self.batch_label: str = batch_label
        self.zotero_collection: str = zotero_collection
        self.df: Any = df
        self.batch_size: int = int(batch_size)
        self.batch_overlapping: int = int(batch_overlapping)
        self.idx_for_scope: list[int] = list(idx_for_scope or [])
        self.batches_raw: list[dict] = list(batches_raw or [])
        self.payload_rows_flat: list[dict] = list(payload_rows_flat or [])

    @staticmethod
    def _collect_payloads_from_idx(idx_set: list[int], payload_rows_flat: list[dict], batches_raw: list[dict]) -> list[
        dict]:
        out: list[dict] = []
        for i in idx_set:
            r: dict = payload_rows_flat[i]
            b: dict = batches_raw[r["batch_index"]]
            p: dict = b["payloads"][r["payload_pos"]]
            out.append(p)
        return out

    def run(self) -> None:
        """
        Run the background pipeline with DF hydration, item streaming, and processing.
        No try/except: if something fails, the thread errors and the app reflects that state.
        """
        from pydantic import BaseModel, Field

        class _DfLoadNote(BaseModel):
            ok: bool = Field(default=False)
            rows: int = Field(default=0)

        self.signals.emit_progress("Starting background run…")
        self.signals.emit_percent(2)

        # DF hydration on the worker thread
        self.signals.emit_progress("Hydrating Zotero dataframe…")
        self.signals.emit_percent(4)
        local_df: Any = self.df
        if local_df is None:
            local_df = load_df_for_collection_like(zotero_collection=self.zotero_collection)
        note = _DfLoadNote(ok=True, rows=int(getattr(local_df, "shape", (0, 0))[0]))
        self.df = local_df
        self.signals.emit_progress(f"DF ready: {note.rows} rows")
        self.signals.emit_percent(6)

        # Stream items to UI as we gather them
        self.signals.emit_progress("Gathering items…")
        self.signals.emit_percent(8)

        rows: list[dict] = []
        if self.idx_for_scope:
            for k, i in enumerate(self.idx_for_scope, start=1):
                r: dict = self.payload_rows_flat[i]
                b: dict = self.batches_raw[r["batch_index"]]
                p: dict = b["payloads"][r["payload_pos"]]
                rows.append(p)

                author: str = (p.get("first_author_last") or p.get("author") or "").strip()
                year: str = str(p.get("year") or "").strip()
                title: str = (p.get("title") or "").strip()
                label: str = " · ".join(x for x in [author, year, title] if x)
                if label:
                    self.signals.emit_item_collected(label)
                if k % 25 == 0:
                    self.signals.emit_progress(f"Collected {k} items…")

        # Final collection count for visibility
        self.signals.emit_progress(f"Collected {len(rows)} items total.")

        # Build ai_modal_result data and carry new modal options downstream

        self.ai_modal_result["data_scope"] = self.ai_choice.data_scope
        self.ai_modal_result["batch_overlapping"] = getattr(self.ai_choice, "batch_overlapping", 10)
        self.ai_modal_result["framework_analysis"] = bool(getattr(self.ai_choice, "framework_analysis", True))
        self.ai_modal_result["round2"] = str(getattr(self.ai_choice, "round2", "paragraphs")).strip()

        data_rows = []
        for r in rows:
            row = dict(r or {})

            meta = {
                "rq_question": (
                        row.get("_rq_question")
                        or row.get("rq_question")
                        or ""
                ),
                "overarching_theme": (
                        row.get("_overarching_theme")
                        or row.get("overarching_theme")
                        or row.get("gold_theme")
                        or ""
                ),
                "route": row.get("route") or "",
                "theme": (
                        row.get("theme")
                        or row.get("payload_theme")
                        or row.get("potential_theme")
                        or ""
                ),
                "potential_theme": row.get("potential_theme") or "",
                "gold_theme": row.get("gold_theme") or "",
                "all_potential_themes": row.get("all_potential_themes") or [],
                "score_bucket": row.get("score_bucket"),
                "relevance_score": row.get("relevance_score"),
                "page": row.get("page") or "",
                "section_title": row.get("section_title") or "",
                "section_text": row.get("section_text") or "",
                "item_key": row.get("item_key") or "",
                "payload_json": row.get("payload_json") or "",
            }

            data_rows.append(
                {
                    "payload": row,
                    "metadata": meta,
                }
            )

        self.ai_modal_result["data"] = data_rows

        self.signals.emit_progress("Round 1: preparing data grouping…")
        self.signals.emit_percent(10)

        payload: Dict[str, Any] = process_widget_data(
            ai_modal_result=self.ai_modal_result,
            dir_base=self.dir_base,
            batch_label=self.batch_label,
            zotero_collection=self.zotero_collection,
            df=self.df,
            batch_size=self.batch_size,
            batch_overlapping=self.batch_overlapping,
            progress_cb=self.signals.emit_progress,
            percent_cb=self.signals.emit_percent,
        )

        self.signals.emit_percent(100)
        self.signals.emit_progress("Background run finished.")
        self.signals.emit_finished(payload)


def _slug_for_label(value: str) -> str:
    import re
    s = (value or "").strip()
    s = (
        s.replace("/", " ")
        .replace("\\", " ")
        .replace("|", " ")
        .replace(":", " ")
    )
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^A-Za-z0-9._\-]+", "", s)
    return s.strip("-_.") or "all"


def _safe_collection_name(
        *,
        filters: Dict[str, Any],
        dates: str,
        batch_size: int,
) -> str:
    from collections import OrderedDict
    fields: "OrderedDict[str, str]" = OrderedDict()

    rq_sel = filters.get("rq") or []
    if rq_sel:
        head = rq_sel[0].get("label") if isinstance(rq_sel[0], dict) else str(rq_sel[0])
        fields["rq"] = _slug_for_label(head)

    years_sel = filters.get("years") or []
    if years_sel:
        fields["years"] = _slug_for_label(str(years_sel[0]))

    theme_sel = filters.get("theme") or []
    if theme_sel:
        head = theme_sel[0].get("label") if isinstance(theme_sel[0], dict) else str(theme_sel[0])
        fields["theme"] = _slug_for_label(head)

    dslug = (dates or "").strip() or "no-dates"
    fields["dates"] = _slug_for_label(dslug)

    fields["bs"] = str(batch_size)

    parts: List[str] = []
    for k, v in fields.items():
        if v:
            parts.append(f"{k}__{v}")
    base = "__".join(parts) if parts else "themes"
    return base[:120] if len(base) > 120 else base


def _has_any(val: Any) -> bool:
    if val is None:
        return False
    if isinstance(val, str):
        return bool(val.strip())
    if isinstance(val, (list, tuple, set)):
        return len(val) > 0
    return bool(val)


def _coerce_int(v: Any, default: int) -> int:
    s = str(v).strip() if v is not None else ""
    return int(s) if s.isdigit() else int(default)


def _status_line(head: str, tail: str) -> str:
    return head + ": " + tail


def _now_stamp() -> str:
    from datetime import datetime
    return datetime.now().strftime("%Y%m%d_%H%M%S")


from typing import Tuple, List, Any, Dict


def load_df_for_collection_like(zotero_collection: str) -> pd.DataFrame:
    """
    Resolve a dataframe for a collection-like identifier by
    delegating to the existing loader.
    """
    df, _raw, _aux = load_data_from_source_for_widget(collection_name=zotero_collection, cache=True)
    return df


def load_df_for_collection(zotero_collection: str) -> pd.DataFrame:
    return load_df_for_collection_like(zotero_collection=zotero_collection)


def collection_label_for(*, filters: Dict[str, Any], dates: str, batch_size: int, batch_overlapping: int) -> str:
    """
    Semantic label used as the remote collection_name.
    Prefers a single RQ, else a single author, else timestamp.
    Appends compacted date ranges (no separators) for determinism.
    """

    def _as_label(v: Any) -> str:
        if isinstance(v, dict):
            for k in ("label", "value", "text", "name", "title", "rq", "question"):
                s = v.get(k)
                if isinstance(s, str) and s.strip():
                    return s.strip()
            return re.sub(r"\s+", " ", str(v)).strip()
        if isinstance(v, str):
            return v.strip()
        return str(v).strip()

    def _slug(s: str) -> str:
        s = (s or "").strip()
        s = s.replace("/", " ").replace("\\", " ").replace("|", " ").replace(":", " ")
        s = re.sub(r"\s+", "-", s)
        s = re.sub(r"[^A-Za-z0-9._\-]+", "", s)
        return s.strip("-_.") or "all"

    def _dates_compact(d: str) -> str:
        s = (d or "").strip()
        if not s or s.lower() == "none":
            return "no-dates"
        s = s.replace(" ", "").replace(";", ",")
        parts = [p for p in s.split(",") if p]
        return "".join(parts) if parts else "no-dates"

    rq_vals = (filters or {}).get("rq")
    au_vals = (filters or {}).get("authors")
    if isinstance(rq_vals, (list, tuple)) and len(rq_vals) == 1:
        head = f"rq__{_slug(_as_label(rq_vals[0]))}"
    elif isinstance(au_vals, (list, tuple)) and len(au_vals) == 1:
        head = f"author__{_slug(_as_label(au_vals[0]))}"
    else:
        head = f"run__"

    return f"{head}__{_dates_compact(dates)}"


def ai_choice_to_modal_result(choice: "AiScopeChoice") -> Dict[str, Any]:
    return _ai_choice_to_modal_result(choice=choice)


def _ai_choice_to_modal_result(*, choice: "AiScopeChoice") -> Dict[str, Any]:
    out = {
        "data": list(choice.rows or []),
        "dates": str(choice.date_ranges or ""),
        "filters": dict(choice.filters or {}),
        "batch_size": int(choice.batch_size or 50),
        "batch_overlapping": int(getattr(choice, "batch_overlapping", 10) or 10),
        "prompt": str(choice.extra_prompt or "").strip(),
        "data_scope": str(getattr(choice, "data_scope", "") or ""),
    }
    print("[AI-MODAL] scope=", out["data_scope"])
    print("[AI-MODAL] dates='", out["dates"], "'", sep="")
    print("[AI-MODAL] batch_size=", out["batch_size"], " overlap=", out["batch_overlapping"])
    print("[AI-MODAL] filters keys=", list(out["filters"].keys()))
    print("[AI-MODAL] rows.count=", len(out["data"]))
    if out["data"]:
        first = out["data"][0]
        print("sample:", out["data"][0])
        print("[AI-MODAL] rows[0] keys:", list(first.keys()))
        if "payload" in first:
            print("[AI-MODAL] rows[0].payload keys:", list((first.get("payload") or {}).keys()))
    return out


def _derive_overlap_from_choice(*, choice: "AiScopeChoice", fallback: int) -> int:
    ov = getattr(choice, "batch_overlapping", None)
    if isinstance(ov, int):
        return int(ov)
    ov2 = getattr(choice, "overlap", None)
    if isinstance(ov2, int):
        return int(ov2)
    return int(fallback)


def _df_for_collection(*, collection_id: str, loader: Any) -> Any:
    return loader(collection_id)


def _out_dir_for_run(*, dir_base: str) -> str:
    from pathlib import Path
    p = Path(dir_base)
    return str(p)


def _emit_boot_logs(win: ZoteroMiniWindow, lines: List[str], pct: int) -> None:
    for s in lines:
        win.append_log(ProgressEvent(message=s, percent=None))
    win.append_log(ProgressEvent(message="—", percent=pct))


def _connect_worker_signals(
        *,
        win: ZoteroMiniWindow,
        worker: RoundRunnerWorker,
        done_cb: Any,
) -> None:
    worker.signals.progress.connect(lambda s: win.append_log(ProgressEvent(message=s, percent=None)))
    worker.signals.percent.connect(lambda n: win.append_log(ProgressEvent(message="progress", percent=n)))
    worker.signals.finished.connect(done_cb)


def _start_background_thread(worker: RoundRunnerWorker) -> QThread:
    th = QThread()
    worker.moveToThread(th)
    th.started.connect(worker.run)
    th.start()
    return th


def _on_rounds_done_factory(
        *,
        win: ZoteroMiniWindow,
        parent: Any,
) -> Any:
    def _done(payload: Dict[str, Any]) -> None:
        msg = _status_line("Background run finished", "artifacts exported")
        win.append_log(ProgressEvent(message=msg, percent=100))
        win.append_log(ProgressEvent(message=str(payload.get("export_paths", {})), percent=None))

    return _done


def _collection_label(
        *,
        filters: Dict[str, Any],
        dates: str,
        batch_size: int,
) -> str:
    head = _safe_collection_name(filters=filters, dates=dates, batch_size=batch_size)
    return head + "__" + _now_stamp()


def _ai_choice_extract(
        *,
        choice: "AiScopeChoice",
) -> Tuple[List[Dict[str, Any]], str, Dict[str, Any], int, str]:
    rows = choice.rows or []
    dates = choice.date_ranges or ""
    filters = choice.filters or {}
    bs = int(choice.batch_size or 50)
    collection_id = str(choice.collection_id or "")
    return rows, dates, filters, bs, collection_id


def _build_zotero_window() -> ZoteroMiniWindow:
    w = ZoteroMiniWindow("Zotero — Background AI Run")
    return w


def _make_worker_bundle(
        *,
        ai_modal_result: Dict[str, Any],
        dir_base: str,
        batch_label: str,
        zotero_collection: str,
        df: Any,
        batch_size: int,
        batch_overlapping: int,
) -> RoundRunnerWorker:
    return RoundRunnerWorker(
        ai_modal_result=ai_modal_result,
        dir_base=dir_base,
        batch_label=batch_label,
        zotero_collection=zotero_collection,
        df=df,
        batch_size=batch_size,
        batch_overlapping=batch_overlapping,
    )


def _emit_start_banner(win: ZoteroMiniWindow, collection: str, label: str) -> None:
    lines = [
        _status_line("Collection", collection),
        _status_line("Batch label", label),
        "Starting background pyramid rounds…",
    ]
    _emit_boot_logs(win, lines, 3)


def _ai_choice_outdir(*, base_dir: str) -> str:
    return _out_dir_for_run(dir_base=base_dir)


def _show_window(win: ZoteroMiniWindow) -> None:
    win.show()
    win.raise_()
    win.activateWindow()


def _validate_inputs(zotero_collection: str, base_dir: str) -> bool:
    has_coll = _has_any(zotero_collection)
    has_dir = _has_any(base_dir)
    return bool(has_coll and has_dir)


def _choice_overlap_scaled(*, choice: "AiScopeChoice") -> int:
    ov = _derive_overlap_from_choice(choice=choice, fallback=10)
    return int(ov)


def _derive_r2_scalars(*, batch_size: int, overlap: int) -> Tuple[int, int]:
    return int(batch_size), int(overlap)


def _choice_prompt(choice: "AiScopeChoice") -> str:
    return str(choice.extra_prompt or "").strip()


def _derive_label(filters: Dict[str, Any], dates: str, bs: int) -> str:
    return _collection_label(filters=filters, dates=dates, batch_size=bs)


def _ai_modal_dict(choice: "AiScopeChoice") -> Dict[str, Any]:
    return _ai_choice_to_modal_result(choice=choice)


def _dir_for_run(base_dir: str) -> str:
    return _ai_choice_outdir(base_dir=base_dir)


def _wiring(win: ZoteroMiniWindow, worker: RoundRunnerWorker, parent: Any) -> QThread:
    done_cb = _on_rounds_done_factory(win=win, parent=parent)
    _connect_worker_signals(win=win, worker=worker, done_cb=done_cb)
    th = _start_background_thread(worker)
    return th


def _prepare_worker(
        *,
        choice: "AiScopeChoice",
        base_dir: str,
) -> Tuple[RoundRunnerWorker, ZoteroMiniWindow, QThread]:
    rows, dates, filters, bs, zid = _ai_choice_extract(choice=choice)
    ai_dict = _ai_modal_dict(choice=choice)
    label = _derive_label(filters=filters, dates=dates, bs=bs)
    df, _raw, _aux = load_data_from_source_for_widget(zid)
    ov = _choice_overlap_scaled(choice=choice)
    bs_r2, ov_r2 = _derive_r2_scalars(batch_size=bs, overlap=ov)
    win = _build_zotero_window()
    _emit_start_banner(win, zid, label)
    worker = _make_worker_bundle(
        ai_modal_result=ai_dict,
        dir_base=_dir_for_run(base_dir=base_dir),
        batch_label=label,
        zotero_collection=zid,
        df=df,
        batch_size=bs_r2,
        batch_overlapping=ov_r2,
    )
    th = _wiring(win, worker, parent=None)
    _show_window(win)
    return worker, win, th


def _confirm_summary(win: ZoteroMiniWindow, choice: "AiScopeChoice") -> None:
    rows, dates, _, bs, _ = _ai_choice_extract(choice=choice)
    summary = (
            "Items: " + str(len(rows)) + "\n"
            + "Dates: " + str(dates) + "\n"
            + "Batch size: " + str(bs) + "\n"
            + "Running in background.\n"
            + "You can continue using the main application."
    )
    win.append_log(ProgressEvent(message=summary, percent=8))


def _on_ai_modal_confirm(self, choice: "AiScopeChoice") -> None:
    rows, dates, filters, bs, zid = _ai_choice_extract(choice=choice)
    base_dir = str(self._current_dir)
    ok = _validate_inputs(zotero_collection=zid, base_dir=base_dir)
    if not ok:
        return
    worker, win, _thread = _prepare_worker(choice=choice, base_dir=base_dir)
    _confirm_summary(win, choice)


class _LabelParts(BaseModel):
    filters: Dict[str, Any]
    dates: str
    batch_size: int
    batch_overlapping: int


def _build_label(parts: _LabelParts) -> str:
    bits: list[str] = []
    for k, v in sorted((parts.filters or {}).items()):
        s = str(v).strip() if v is not None else ""
        if s:
            bits.append(f"{k}{s}")
    fslug = "all" if not bits else "__".join(bits)
    dslug = (parts.dates or "").replace(",", "_").replace(" ", "")
    return f"{dslug}__{fslug}__b{int(parts.batch_size)}o{int(parts.batch_overlapping)}"
