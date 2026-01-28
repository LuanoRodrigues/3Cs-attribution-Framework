# bibliometric_analysis_tool/ui/data_screener_widget.py
import logging
import pandas as pd

from PyQt6.QtCore import pyqtSignal, Qt, QTimer
from PyQt6.QtGui import QTextBlockFormat
from PyQt6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QGroupBox,
    QRadioButton,
    QButtonGroup,
    QTextEdit,
    QScrollArea,
    QSplitter,
    QMessageBox,
    QTextBrowser,
    QSizePolicy,
    QGridLayout,
)

from ..core.app_constants import THEME
from ..utils.data_processing import reconstruct_extra_field, zot

from Z_Corpus_analysis.Preview_pdf import PreviewPanel


def format_chicago_style_html(record: pd.Series) -> str:
    authors = str(record.get("authors", "N/A")).replace(";", ", ").strip()
    title = str(record.get("title", "N/A")).strip()
    year = str(record.get("year", "N/A")).strip()
    source = str(record.get("source", "N/A")).strip()
    url = str(record.get("url", "")).strip()

    accent = THEME["ACCENT_PRIMARY"]
    text = THEME["TEXT_PRIMARY"]
    muted = THEME["TEXT_SECONDARY"]

    link_html = ""
    if url:
        link_html = f" · <a href='{url}'>link</a>"

    html = f"""
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <style>
        html, body {{
          margin: 0;
          padding: 0;
          background: transparent;
          color: {text};
          font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }}
        .wrap {{
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 2px 2px;
        }}
        .line1 {{
          font-size: 12px;
          line-height: 1.25;
          font-weight: 650;
          letter-spacing: 0.1px;
          opacity: 0.96;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }}
        .line2 {{
          font-size: 11px;
          line-height: 1.2;
          color: {muted};
          opacity: 0.92;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }}
        a {{
          color: {accent};
          text-decoration: none;
          font-weight: 650;
        }}
        a:hover {{
          text-decoration: underline;
        }}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="line1">{authors} ({year}). {title}</div>
        <div class="line2">{source}{link_html}</div>
      </div>
    </body>
    </html>
    """
    return html.strip()


class DataScreenerWidget(QWidget):
    data_record_updated = pyqtSignal(int, dict)
    status_updated = pyqtSignal(str, int)
    request_zotero_update = pyqtSignal(int, dict)

    def __init__(self, parent=None):
        super().__init__(parent)

        self.df = None
        self.raw_zotero_items = None
        self.current_raw_item = None
        self.current_index = -1

        # key -> QTextEdit (textarea semantics)
        self.editable_fields = {}

        self.zotero_client = zot
        self._is_saving = False
        self._nav_direction_pending = 0

        self._init_ui()
        self._apply_stylesheet()

    def _init_ui(self) -> None:
        self.main_layout = QVBoxLayout(self)
        self.main_layout.setContentsMargins(12, 12, 12, 12)
        self.main_layout.setSpacing(8)

        # --- Top bar (compact, premium) ---
        self.top_bar = QWidget(self)
        self.top_bar.setObjectName("TopBar")
        self.top_bar.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

        self.top_bar_layout = QHBoxLayout(self.top_bar)
        self.top_bar_layout.setContentsMargins(10, 8, 10, 8)
        self.top_bar_layout.setSpacing(10)

        self.title_label = QLabel("Screen", self.top_bar)
        self.title_label.setObjectName("pageTitleLabel")
        self.top_bar_layout.addWidget(self.title_label, 0, Qt.AlignmentFlag.AlignVCenter)

        self.item_status_label = QLabel("No Data Loaded", self.top_bar)
        self.item_status_label.setObjectName("statusLabel")
        self.top_bar_layout.addWidget(self.item_status_label, 1, Qt.AlignmentFlag.AlignVCenter)

        self.prev_button = QPushButton("◀ Save & Prev", self.top_bar)
        self.next_button = QPushButton("Save & Next ▶", self.top_bar)
        self.prev_button.setObjectName("navBtnPrev")
        self.next_button.setObjectName("navBtnNext")
        self.prev_button.clicked.connect(self.prev_record)
        self.next_button.clicked.connect(self.next_record)

        self.top_bar_layout.addWidget(self.prev_button, 0, Qt.AlignmentFlag.AlignVCenter)
        self.top_bar_layout.addWidget(self.next_button, 0, Qt.AlignmentFlag.AlignVCenter)

        self.main_layout.addWidget(self.top_bar)

        # --- Bibliographic header (HTML) ---
        self.biblio_browser = QTextBrowser(self)
        self.biblio_browser.setObjectName("biblioHeader")
        self.biblio_browser.setOpenExternalLinks(True)
        self.biblio_browser.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.biblio_browser.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.biblio_browser.setFixedHeight(54)
        self.biblio_browser.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.main_layout.addWidget(self.biblio_browser)

        # --- Main split ---
        self.main_splitter = QSplitter(Qt.Orientation.Horizontal, self)
        self.main_splitter.setObjectName("mainSplitter")
        self.main_splitter.setChildrenCollapsible(False)
        self.main_splitter.setHandleWidth(2)
        self.main_layout.addWidget(self.main_splitter, 1)

        # Left: Preview (PDF takes full panel)
        self.preview_panel = PreviewPanel(self)
        self.preview_panel.setObjectName("recordPreviewPanel")
        self.preview_panel.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.main_splitter.addWidget(self.preview_panel)

        # Right: Scroll panel with Abstract + Metadata + Review
        self.right_panel_scroll = QScrollArea(self)
        self.right_panel_scroll.setWidgetResizable(True)
        self.right_panel_scroll.setObjectName("optionsScrollArea")
        self.main_splitter.addWidget(self.right_panel_scroll)

        self.right_panel_widget = QWidget(self.right_panel_scroll)
        self.right_panel_widget.setObjectName("RightPanel")
        self.right_panel_scroll.setWidget(self.right_panel_widget)

        self.right_layout = QVBoxLayout(self.right_panel_widget)
        self.right_layout.setContentsMargins(10, 10, 10, 10)
        self.right_layout.setSpacing(10)

        # Abstract (dominant height)
        self.abstract_group = QGroupBox("Abstract", self.right_panel_widget)
        self.abstract_group.setObjectName("AbstractGroup")

        self.abstract_layout = QVBoxLayout(self.abstract_group)
        self.abstract_layout.setContentsMargins(10, 10, 10, 10)
        self.abstract_layout.setSpacing(8)

        self.abstract_browser = QTextEdit(self.abstract_group)
        self.abstract_browser.setPlaceholderText("Abstract…")
        self.abstract_browser.setObjectName("abstractBrowser")
        self.abstract_browser.setMinimumHeight(340)

        doc = self.abstract_browser.document()
        option = doc.defaultTextOption()
        option.setAlignment(Qt.AlignmentFlag.AlignJustify)
        doc.setDefaultTextOption(option)

        cursor = self.abstract_browser.textCursor()
        bf = cursor.blockFormat()
        bf.setLineHeight(150, QTextBlockFormat.LineHeightTypes.ProportionalHeight.value)
        cursor.setBlockFormat(bf)
        self.abstract_browser.setTextCursor(cursor)

        self.abstract_layout.addWidget(self.abstract_browser)
        self.right_layout.addWidget(self.abstract_group, 3)

        # Editable metadata (textarea for each key; two-column grid; compact height)
        self.metadata_group = QGroupBox("Editable metadata", self.right_panel_widget)
        self.metadata_group.setObjectName("MetadataGroup")

        self.metadata_grid = QGridLayout(self.metadata_group)
        self.metadata_grid.setContentsMargins(10, 10, 10, 10)
        self.metadata_grid.setHorizontalSpacing(10)
        self.metadata_grid.setVerticalSpacing(8)

        self._metadata_defs = [
            ("department", "Department"),
            ("institution", "Institution"),
            ("country", "Country"),
            ("citations", "Citations"),
            ("theoretical_orientation", "Theoretical orientation"),
            ("ontology", "Ontology"),
            ("argumentation_logic", "Argumentation logic"),
            ("evidence_source_base", "Evidence source base"),
            ("methodology", "Methodology"),
            ("methods", "Methods"),
            ("framework_model", "Framework/model"),
            ("contribution_type", "Contribution type"),
            ("attribution_lens_focus", "Attribution lens focus"),
            ("controlled_vocabulary_terms", "Controlled vocabulary terms"),
        ]

        # 2 columns: (label,input) + (label,input)
        row = 0
        col_pair = 0
        for key, label_text in self._metadata_defs:
            lab = QLabel(label_text, self.metadata_group)
            lab.setObjectName("metaLabel")

            ta = QTextEdit(self.metadata_group)
            ta.setObjectName(f"meta_{key}")
            ta.setPlaceholderText(label_text)
            ta.setAcceptRichText(False)
            ta.setMinimumHeight(44)
            ta.setMaximumHeight(56)

            self.editable_fields[key] = ta

            c = col_pair * 2
            self.metadata_grid.addWidget(lab, row, c, 1, 1, Qt.AlignmentFlag.AlignTop)
            self.metadata_grid.addWidget(ta, row, c + 1, 1, 1)

            col_pair += 1
            if col_pair == 2:
                col_pair = 0
                row += 1

        # Balance the grid
        self.metadata_grid.setColumnStretch(1, 1)
        self.metadata_grid.setColumnStretch(3, 1)

        self.right_layout.addWidget(self.metadata_group, 0)

        # Review
        self.review_group = QGroupBox("User review", self.right_panel_widget)
        self.review_group.setObjectName("ReviewGroup")

        self.review_layout = QVBoxLayout(self.review_group)
        self.review_layout.setContentsMargins(10, 10, 10, 10)
        self.review_layout.setSpacing(10)

        self.decision_box = QGroupBox("Decision", self.review_group)
        self.decision_box.setObjectName("DecisionBox")

        self.decision_layout = QHBoxLayout(self.decision_box)
        self.decision_layout.setContentsMargins(8, 10, 8, 8)
        self.decision_layout.setSpacing(10)

        self.decision_group = QButtonGroup(self)
        for name in ["Include", "Exclude", "Maybe", "Unreviewed"]:
            rb = QRadioButton(name, self.decision_box)
            rb.setObjectName(name)
            if name == "Unreviewed":
                rb.setChecked(True)
            self.decision_group.addButton(rb)
            self.decision_layout.addWidget(rb)

        self.review_layout.addWidget(self.decision_box)

        self.notes_box = QGroupBox("Notes", self.review_group)
        self.notes_box.setObjectName("NotesBox")

        self.notes_layout = QVBoxLayout(self.notes_box)
        self.notes_layout.setContentsMargins(8, 10, 8, 8)
        self.notes_layout.setSpacing(8)

        self.notes_edit = QTextEdit(self.notes_box)
        self.notes_edit.setObjectName("notesEdit")
        self.notes_edit.setPlaceholderText("Enter screening notes…")
        self.notes_edit.setMinimumHeight(120)
        self.notes_layout.addWidget(self.notes_edit)

        self.review_layout.addWidget(self.notes_box)
        self.right_layout.addWidget(self.review_group, 0)

        self.right_layout.addStretch(1)

        self.main_splitter.setSizes([int(self.width() * 0.72), int(self.width() * 0.28)])

    def _apply_stylesheet(self) -> None:
        self.setStyleSheet(
            f"""
            DataScreenerWidget {{
                background-color: {THEME["BACKGROUND_CONTENT_AREA"]};
            }}

            #TopBar {{
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                  stop:0 {THEME["BACKGROUND_SECONDARY"]},
                  stop:1 {THEME["BACKGROUND_TERTIARY"]}
                );
                border: 1px solid {THEME["BORDER_PRIMARY"]};
                border-radius: 12px;
            }}

            #pageTitleLabel {{
                font-size: 16px;
                font-weight: 750;
                color: {THEME["TEXT_PRIMARY"]};
                letter-spacing: 0.2px;
            }}

            #statusLabel {{
                font-size: 12px;
                font-weight: 650;
                color: {THEME["TEXT_SECONDARY"]};
            }}

            QPushButton#navBtnPrev,
            QPushButton#navBtnNext {{
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                  stop:0 {THEME["ACCENT_PRIMARY"]},
                  stop:1 {THEME["ACCENT_HOVER"]}
                );
                color: white;
                border: 1px solid rgba(255,255,255,0.10);
                font-weight: 800;
                padding: 7px 12px;
                border-radius: 10px;
                min-width: 124px;
            }}
            QPushButton#navBtnPrev:hover,
            QPushButton#navBtnNext:hover {{
                border: 1px solid rgba(255,255,255,0.18);
            }}
            QPushButton#navBtnPrev:pressed,
            QPushButton#navBtnNext:pressed {{
                padding-top: 8px;
                padding-bottom: 6px;
            }}
            QPushButton#navBtnPrev:disabled,
            QPushButton#navBtnNext:disabled {{
                background: {THEME["BACKGROUND_TERTIARY"]};
                border: 1px solid {THEME["BORDER_SECONDARY"]};
                color: {THEME["TEXT_SECONDARY"]};
            }}

            #biblioHeader {{
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                  stop:0 rgba(255,255,255,0.05),
                  stop:1 rgba(255,255,255,0.02)
                );
                border: 1px solid {THEME["BORDER_PRIMARY"]};
                border-radius: 12px;
                padding: 6px 10px;
            }}
            #biblioHeader QWidget {{
                background: transparent;
            }}

            #optionsScrollArea {{
                border: none;
                background: transparent;
            }}

            QGroupBox {{
                font-weight: 800;
                font-size: 12px;
                color: {THEME["TEXT_PRIMARY"]};
                border: 1px solid {THEME["BORDER_PRIMARY"]};
                border-radius: 14px;
                margin-top: 10px;
                padding: 12px;
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                  stop:0 rgba(255,255,255,0.04),
                  stop:1 rgba(255,255,255,0.02)
                );
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                subcontrol-position: top left;
                padding: 0 8px;
                margin-left: 10px;
            }}

            QLabel#metaLabel {{
                font-weight: 650;
                font-size: 11px;
                color: {THEME["TEXT_SECONDARY"]};
                padding-top: 2px;
            }}

            QTextEdit {{
                border: 1px solid {THEME["BORDER_SECONDARY"]};
                border-radius: 12px;
                padding: 8px 10px;
                background-color: {THEME["BACKGROUND_TERTIARY"]};
                color: {THEME["TEXT_PRIMARY"]};
                selection-background-color: {THEME["ACCENT_PRIMARY"]};
            }}
            QTextEdit:focus {{
                border: 1px solid {THEME["ACCENT_PRIMARY"]};
            }}

            /* Abstract: larger, readable */
            #abstractBrowser {{
                font-family: "Georgia", "Times New Roman", Times, serif;
                font-size: 14px;
                line-height: 1.65;
            }}

            /* Metadata textareas: compact font */
            QTextEdit[objectName^="meta_"] {{
                font-size: 11px;
                line-height: 1.35;
                font-weight: 600;
            }}

            /* Notes: slightly smaller than abstract */
            #notesEdit {{
                font-size: 12px;
                line-height: 1.55;
            }}

            QRadioButton {{
                color: {THEME["TEXT_PRIMARY"]};
                spacing: 8px;
                font-weight: 750;
                font-size: 12px;
            }}

            QSplitter::handle {{
                background-color: {THEME["BORDER_PRIMARY"]};
            }}
            QSplitter::handle:hover {{
                background-color: {THEME["ACCENT_PRIMARY"]};
            }}
            """
        )

    def set_zotero_client(self, client) -> None:
        self.zotero_client = client

    def set_data(self, df: pd.DataFrame, raw_items: list = None) -> None:
        self._is_saving = False
        self.df = df.copy() if df is not None else None
        self.raw_zotero_items = raw_items

        if self.df is not None and not self.df.empty:
            self.current_index = 0
            self.display_current_record()
        else:
            self.current_index = -1
            self.clear_display()

    def _build_preview_payload(self, record: pd.Series) -> dict:
        item_key = str(record.get("item_key", "")).strip()
        if item_key == "":
            item_key = str(record.get("key", "")).strip()

        pdf_path = str(record.get("pdf_path", "")).strip()
        pdf_page = str(record.get("pdf_page", "")).strip()

        page_val = 1
        if pdf_page.isdigit():
            page_val = int(pdf_page)
        else:
            page_val = int(record.get("page", 1) or 1)

        section_title = str(record.get("section_title", "")).strip()
        if section_title == "":
            section_title = "Abstract"

        section_text = str(record.get("section_text", "")).strip()
        if section_text == "":
            section_text = str(record.get("abstract", "")).strip()

        rq_question = str(record.get("rq_question", "")).strip()
        if rq_question == "":
            rq_question = str(record.get("research_question", "")).strip()

        payload = {
            # --- REQUIRED by Z_Corpus_analysis/PDF_widget.PdfViewer.load_payload (strict) ---
            "item_key": item_key,
            "pdf_path": pdf_path,
            "page": page_val,
            "first_author_last": str(record.get("first_author_last", "")).strip(),
            "year": str(record.get("year", "")).strip(),
            "theme": str(record.get("theme", "")).strip(),
            "route": str(record.get("route", "")).strip(),
            "evidence_type": str(record.get("evidence_type", "")).strip(),
            "direct_quote_clean": str(record.get("direct_quote_clean", "")).strip(),
            # --- Additional fields consumed by your viewer / overlays ---
            "url": str(record.get("url", "")).strip(),
            "author_summary": str(record.get("author_summary", "")).strip(),
            "title": str(record.get("title", "")).strip(),
            "source": str(record.get("source", "")).strip(),
            "section_title": section_title,
            "section_text": section_text,
            "rq_question": rq_question,
            "overarching_theme": str(record.get("overarching_theme", "")).strip(),
            "gold_theme": str(record.get("gold_theme", "")).strip(),
            "potential_theme": str(record.get("potential_theme", "")).strip(),
            "evidence_type_norm": str(record.get("evidence_type_norm", "")).strip(),
            "direct_quote": str(record.get("direct_quote", "")).strip(),
            "paraphrase": str(record.get("paraphrase", "")).strip(),
            "researcher_comment": str(record.get("researcher_comment", "")).strip(),
        }
        return payload

    def display_current_record(self) -> None:
        if self.df is None or self.current_index == -1:
            self.clear_display()
            return

        record = self.df.iloc[self.current_index]

        if self.raw_zotero_items and 0 <= self.current_index < len(self.raw_zotero_items):
            self.current_raw_item = self.raw_zotero_items[self.current_index]
        else:
            self.current_raw_item = None

        self.biblio_browser.setHtml(format_chicago_style_html(record))

        payload = self._build_preview_payload(record)
        pdf_path = str(payload.get("pdf_path") or "").strip()
        url = str(payload.get("url") or "").strip()

        if pdf_path != "":
            self.preview_panel.show_pdf(payload)
        else:
            if url.startswith("http://") or url.startswith("https://"):
                self.preview_panel.show_payload_raw(payload)
            else:
                self.preview_panel.show_payload_raw(
                    {
                        "title": payload.get("title") or "",
                        "year": payload.get("year") or "",
                        "source": payload.get("source") or "",
                        "section_text": "No valid URL or local PDF path provided for preview.",
                    }
                )

        self.abstract_browser.setText(str(record.get("abstract", "")))

        for key, widget in self.editable_fields.items():
            widget.setPlainText(str(record.get(key, "")))

        decision = record.get("user_decision", "Unreviewed")
        for button in self.decision_group.buttons():
            if button.objectName() == decision:
                button.setChecked(True)

        self.notes_edit.setText(str(record.get("user_notes", "")))
        self.update_nav_status()

    def _process_navigation(self, direction: int) -> None:
        if self._is_saving:
            return

        self._is_saving = True
        self.update_nav_status()
        self._nav_direction_pending = direction

        all_ui_values = self._get_all_ui_values()
        for key, value in all_ui_values.items():
            self.df.loc[self.df.index[self.current_index], key] = value
        self.data_record_updated.emit(self.current_index, all_ui_values)

        if self.zotero_client and self.current_raw_item:
            zotero_payload = self._prepare_zotero_payload()
            if zotero_payload:
                self.status_updated.emit(f"Saving Record {self.current_index + 1}...", 0)
                self.request_zotero_update.emit(self.current_index, zotero_payload)
            else:
                self.on_zotero_update_finished(True, self.current_index, self.current_raw_item)
        else:
            self._navigate_to_record()

    def on_zotero_update_finished(self, success: bool, index: int, updated_raw_item: dict) -> None:
        if success:
            if updated_raw_item:
                self.raw_zotero_items[index] = updated_raw_item
        else:
            QMessageBox.critical(self, "Zotero Update Failed", f"Could not save changes for record {index + 1}.")

        if self._nav_direction_pending != 0:
            self._navigate_to_record()
        else:
            self._is_saving = False
            self.update_nav_status()

    def _navigate_to_record(self) -> None:
        new_index = self.current_index + self._nav_direction_pending
        if 0 <= new_index < len(self.df):
            self.current_index = new_index

        QTimer.singleShot(50, self.display_current_record)

        self._is_saving = False
        self._nav_direction_pending = 0
        QTimer.singleShot(60, self.update_nav_status)

    def _prepare_zotero_payload(self) -> dict:
        if not self.current_raw_item:
            return {}

        payload = {}
        item_data = self.current_raw_item.get("data", {})

        new_abstract = self.abstract_browser.toPlainText()
        if new_abstract != item_data.get("abstractNote", ""):
            payload["abstractNote"] = new_abstract

        extra_ui_vals = {}
        for k, w in self.editable_fields.items():
            extra_ui_vals[k] = w.toPlainText().strip()

        extra_ui_vals["user_notes"] = self.notes_edit.toPlainText()

        original_extra = item_data.get("extra", "")
        new_extra = reconstruct_extra_field(item_data.get("extra", ""), extra_ui_vals)

        if original_extra.strip().replace("\r\n", "\n") != new_extra.strip().replace("\r\n", "\n"):
            payload["extra"] = new_extra

        return payload

    def _get_all_ui_values(self) -> dict:
        if self.df is None or self.current_index == -1:
            return {}

        vals = {"abstract": self.abstract_browser.toPlainText()}

        numeric_fields = {"citations"}

        for k, w in self.editable_fields.items():
            v = w.toPlainText()
            if k in numeric_fields:
                s = str(v).strip()
                if s == "":
                    vals[k] = pd.NA
                else:
                    vals[k] = int(s)
            else:
                vals[k] = v

        vals["user_decision"] = self.decision_group.checkedButton().objectName()
        vals["user_notes"] = self.notes_edit.toPlainText()
        return vals

    def next_record(self) -> None:
        if self.df is not None and self.current_index < len(self.df) - 1:
            self._process_navigation(direction=1)

    def prev_record(self) -> None:
        if self.df is not None and self.current_index > 0:
            self._process_navigation(direction=-1)

    def update_nav_status(self) -> None:
        enabled = not self._is_saving
        has_data = self.df is not None and not self.df.empty

        self.prev_button.setEnabled(enabled and has_data and self.current_index > 0)
        self.next_button.setEnabled(enabled and has_data and self.current_index < len(self.df) - 1)

        if has_data:
            self.item_status_label.setText(f"Record {self.current_index + 1} / {len(self.df)}")
        else:
            self.item_status_label.setText("No Data Loaded")

    def clear_display(self) -> None:
        self.biblio_browser.clear()
        self.abstract_browser.clear()

        self.preview_panel._on_close()

        for widget in self.editable_fields.values():
            widget.clear()

        unreviewed_button = self.findChild(QRadioButton, "Unreviewed")
        if unreviewed_button:
            unreviewed_button.setChecked(True)

        self.notes_edit.clear()
        self.update_nav_status()
