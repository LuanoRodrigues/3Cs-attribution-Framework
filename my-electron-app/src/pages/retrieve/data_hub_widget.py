# bibliometric_analysis_tool/ui/data_hub_widget.py
import json
from pathlib import Path
import logging
from typing import Optional

import pandas as pd
import re
from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QPushButton, QFileDialog,
                             QGroupBox, QLineEdit, QLabel,
                             QMessageBox, QHBoxLayout, QTableView, QHeaderView,
                             QMenu, QAbstractItemView, QApplication, QSizePolicy, QInputDialog)
from PyQt6.QtCore import pyqtSignal, QThread, QObject, Qt, QSortFilterProxyModel, pyqtSlot
from PyQt6.QtGui import QAction


from bibliometric_analysis_tool.utils.Zotero_loader_to_df import  load_data_from_source_for_widget
from ..core.app_constants import ZOTERO_CACHE_DIR_NAME, ZOTERO_CACHE_EXPIRY_SECONDS
from .custom_table_widgets import PandasTableModel, HighlightDelegate
from ..utils.data_processing import MAIN_APP_CACHE_DIR


class _NAExtractThread(QThread):
    """Background: either extract_na (All) or extract_na_flat (specific properties) → optional affiliations."""
    finished_ok = pyqtSignal(bool, str)  # (ok, message)

    def __init__(self, client, collection_name: str, na_properties: Optional[list[str]] = None,
                 do_affiliations: bool = True, read: bool = False, store_only: bool = True,
                 cache: bool = True, parent=None,
                 items_by_folder: Optional[dict[str, list[str]]] = None,
                 item_keys: Optional[list[str]] = None):
        super().__init__(parent)
        self.client = client
        self.collection_name = collection_name
        self.na_properties = na_properties if na_properties is not None else None
        self.do_affiliations = do_affiliations
        self.read = read
        self.store_only = store_only
        self.cache = cache
        self.items_by_folder = items_by_folder or {}
        self.item_keys = item_keys or []

    def run(self):
        """
        Execute NA extraction with the same semantics regardless of whether the
        selection came from 'Resolve NA' or from 'Coding columns':
          - na_properties == []     → 'All' → extract_na(items_by_folder=...)
          - na_properties == ['x']  → single field → extract_na_flat(property=['x'], item_keys=...)
        Always forwards item lists (may be empty).
        """
        ok = False
        try:
            if self.na_properties is None:
                ok = False

            elif len(self.na_properties) == 0:
                ok = bool(self.client.extract_na(
                    collection_name=self.collection_name,
                    read=self.read, store_only=self.store_only, cache=self.cache,
                    items_by_folder=self.items_by_folder
                ))

            else:
                ok = bool(self.client.extract_na_flat(
                    collection_name=self.collection_name,
                    read=self.read, store_only=self.store_only, cache=self.cache,
                    property=self.na_properties,
                    item_keys=self.item_keys
                ))



            self.finished_ok.emit(ok, "NA extraction complete." if ok else "NA extraction returned False.")
        except Exception as e:
            self.finished_ok.emit(False, f"NA extraction failed: {e}")



def _emit_status(self, text: str, pct: int) -> None:
    try:
        self.status_updated.emit(text, pct)
    except Exception:
        pass
def _confirm_and_run_extract_na(self) -> None:
    """Prompt + run extract_na or extract_na_flat (followed by entities/affiliations) in the background)."""
    if not getattr(self, "zotero_client", None):
        QMessageBox.information(self, "Zotero", "Zotero client not configured.")
        return
    coll = self._collection_name_or_empty()
    if not coll:
        QMessageBox.information(self, "Zotero", "Please enter a Zotero collection name first.")
        return

    # Describe the current scope: All vs specific field(s)
    scope = "All NA properties" if not self._selected_na_property else f"Property: {', '.join(self._selected_na_property)}"
    resp = QMessageBox.question(
        self, "Resolve NA values",
        f"Run NA extraction for collection:\n\n{coll}\n\nScope: {scope}",
        QMessageBox.StandardButton.Ok | QMessageBox.StandardButton.Cancel
    )
    if resp != QMessageBox.StandardButton.Ok:
        return

    # --- Build payloads from the current table ---
    import pandas as pd

    df = self.current_dataframe if isinstance(self.current_dataframe, pd.DataFrame) else None
    items_by_folder: dict[str, list[str]] = {}
    item_keys: list[str] = []

    def _is_missing_series(s: pd.Series) -> pd.Series:
        miss = s.isna()
        try:
            miss = miss | s.astype(str).str.strip().eq("")
        except Exception:
            pass
        return miss

    if df is not None and not df.empty and "key" in df.columns:
        # If specific field(s) selected → collect keys missing that field (use first if multiple)
        if isinstance(self._selected_na_property, list) and len(self._selected_na_property) == 1:
            fld = self._selected_na_property[0]
            if fld in df.columns:
                mask = _is_missing_series(df[fld])
                item_keys = [str(k).strip() for k in df.loc[mask, "key"].dropna().astype(str).tolist() if str(k).strip()]
        else:
            # All mode → build folders dict based on active codebook columns
            try:
                from ..core.app_constants import CODEBOOKS
                active_key = getattr(self, "_active_codebook_key", None) or "codebook_1"
                allow = [c for c in CODEBOOKS.get(active_key, []) if c and c in df.columns]
            except Exception:
                allow = [c for c in df.columns if c not in ("key",)]
            if allow:
                miss_df = pd.DataFrame({c: _is_missing_series(df[c]) for c in allow}, index=df.index)
                for idx in miss_df.index[miss_df.any(axis=1)]:
                    miss_cols = [c for c in allow if bool(miss_df.at[idx, c])]
                    if not miss_cols:
                        continue
                    folder = "__".join(sorted(miss_cols))
                    k = str(df.at[idx, "key"]).strip()
                    if not k:
                        continue
                    items_by_folder.setdefault(folder, []).append(k)
                for f in list(items_by_folder.keys()):
                    # de-dup & stable
                    items_by_folder[f] = sorted(list(dict.fromkeys(items_by_folder[f])))

    # Trace
    try:
        print(f"[Confirm NA] collection='{coll}', selection={self._selected_na_property}, "
              f"folders={ {k: len(v) for k,v in items_by_folder.items()} }, item_keys_count={len(item_keys)}")
        logging.info("[Confirm NA] collection='%s', selection=%s, folders=%s, item_keys=%s",
                     coll, self._selected_na_property,
                     {k: len(v) for k, v in items_by_folder.items()},
                     len(item_keys))
    except Exception:
        pass

    self._set_settings_enabled(False)
    self._emit_status("Resolving NA values…", 10)

    # Hand the chosen property list + payloads to the worker
    self._na_thread = _NAExtractThread(
        client=self.zotero_client,
        collection_name=coll,
        na_properties=self._selected_na_property,   # None/[] → All ; ['x'] → flat
        do_affiliations=True,
        read=False, store_only=True, cache=True, parent=self,
        items_by_folder=items_by_folder,
        item_keys=item_keys
    )
    self._na_thread.finished_ok.connect(self._on_extract_na_finished)
    self._na_thread.start()


@pyqtSlot(bool, str)
def _on_extract_na_finished(self, ok: bool, message: str) -> None:
    self._set_settings_enabled(True)
    self._emit_status(message, 100 if ok else 0)
    if not ok:
        QMessageBox.warning(self, "Resolve NA values", message)
        return

    # Refresh NA/codebook menus if data present (counts may change after updates)
    try:
        if isinstance(self.current_dataframe, pd.DataFrame) and not self.current_dataframe.empty:
            self._refresh_resolve_na_menu(self.current_dataframe)
            self._refresh_codebook_menus(self.current_dataframe)
    except Exception:
        pass
class AnyColumnFilterProxy(QSortFilterProxyModel):
    """Row filter that matches a substring against ANY column (case-insensitive)."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self._needle = ""

    def setNeedle(self, text: str) -> None:
        self._needle = (text or "").strip().lower()
        self.invalidateFilter()

    def filterAcceptsRow(self, source_row: int, source_parent) -> bool:
        if not self._needle:
            return True
        model = self.sourceModel()
        if model is None:
            return True
        cols = getattr(model, "columnCount", lambda _=None: 0)()
        needle = self._needle
        for c in range(cols):
            idx = model.index(source_row, c)
            val = model.data(idx, Qt.ItemDataRole.DisplayRole)
            if val is None:
                continue
            try:
                if needle in str(val).lower():
                    return True
            except Exception:
                continue
        return False

    def get_dataframe(self) -> pd.DataFrame:
        """
        Return the currently displayed (filtered) DataFrame.
        If the source model lacks get_dataframe(), reconstruct from the model.
        """
        src = self.sourceModel()
        if src is None:
            return pd.DataFrame()

        # Preferred: model exposes its df
        if hasattr(src, "get_dataframe"):
            df = src.get_dataframe()
            if df is None or getattr(df, "empty", False):
                return pd.DataFrame()
            rows = [self.mapToSource(self.index(r, 0)).row() for r in range(self.rowCount())]
            return df.iloc[rows].reset_index(drop=True)

        # Fallback: rebuild from model data
        cols = src.columnCount()
        rows = [self.mapToSource(self.index(r, 0)).row() for r in range(self.rowCount())]
        headers = [src.headerData(c, Qt.Orientation.Horizontal, Qt.ItemDataRole.DisplayRole) for c in range(cols)]
        data = []
        for r in rows:
            row_vals = []
            for c in range(cols):
                idx = src.index(r, c)
                row_vals.append(src.data(idx, Qt.ItemDataRole.DisplayRole))
            data.append(row_vals)
        try:
            return pd.DataFrame(data, columns=headers)
        except Exception:
            return pd.DataFrame(data)


class DataLoaderWorker(QObject):
    finished = pyqtSignal(object, object, str)
    progress = pyqtSignal(str)
    error    = pyqtSignal(str)

    def __init__(self, source_type, file_path=None, collection_name=None,
                 zotero_client=None, cache_config=None):
        super().__init__()
        self.source_type    = source_type
        self.file_path      = file_path
        self.collection_name= collection_name
        # CORRECTLY store the passed client instead of 'zot'
        base_cfg = cache_config or {}
        self.cache_config = {
            **base_cfg,
            "zotero_client": zotero_client,  # <-- make client discoverable
            "dir": base_cfg.get("dir", MAIN_APP_CACHE_DIR),
            "expiry": int(base_cfg.get("expiry", ZOTERO_CACHE_EXPIRY_SECONDS)),
            "default_collection_name": collection_name or base_cfg.get("default_collection_name", ""),
            "use_latest_cache_if_no_collection": True,
        }



    def run(self):
        """
        Executes the long-running data loading task. This method is called on a background thread.
        """
        df, raw_items, message = load_data_from_source_for_widget(
            source_type=self.source_type, file_path=self.file_path, collection_name=self.collection_name,
            progress_callback=self.progress.emit,  cache_config=self.cache_config
        )

        self.progress.emit(message)
        self.finished.emit(df, raw_items, message)


class DataHubWidget(QWidget):
    """
    A central hub for data operations, combining a collapsible loader section
    and a primary data visualization table with full functionality.
    """
    data_loaded = pyqtSignal(pd.DataFrame, list, str, str)
    dataframe_updated = pyqtSignal(pd.DataFrame)
    status_updated = pyqtSignal(str, int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.zotero_client = None
        self.worker_thread: QThread | None = None
        self.current_dataframe: pd.DataFrame | None = None
        # declare now so it's always present (lint-safe); actual instance set later
        from typing import Optional
        self._proxy: Optional[AnyColumnFilterProxy] = None
        self.model: PandasTableModel | None = None
        # NEW: holds {'column': 'framework_model', 'keys': [..]} for latest summary
        self._last_missing_context: dict | None = None
        self._active_codebook_key: str | None = "codebook_1"  # default applied on first load
        self._active_code_columns: list[str] | None = None  # None means: use codebook selection
        self._init_ui()

        # Only tag objectNames here; app-wide theme is applied in MainWindow
        self.setObjectName("DataHubWidget")
        self.loader_group.setObjectName("panelGroup")
        self.visualizer_container.setObjectName("panelGroup")
        self.zotero_collection_input.setObjectName("collectionInput")
        self.zotero_load_button.setObjectName("primaryButton")
        for b in (self.select_file_button, self.clear_cache_button, self.export_excel_button,
                  self.resolve_na_button, self.codebook_button, self.codes_button):
            b.setObjectName("secondaryButton")

    def set_zotero_client(self, client):
        """Receives the Zotero client instance from the main window."""
        self.zotero_client = client
        is_ready = client is not None
        self.zotero_load_button.setEnabled(is_ready)
        self.clear_cache_button.setEnabled(is_ready)
        if hasattr(self, "resolve_na_button"):
            has_data = self.current_dataframe is not None and not getattr(self.current_dataframe, "empty", True)
            self.resolve_na_button.setEnabled(has_data)

    def _set_settings_enabled(self, enabled: bool) -> None:
        """
        Enable/disable the loader + settings row cohesively.
        Uses the existing set_buttons_enabled for loader buttons,
        and gates the settings buttons based on data presence.
        """
        # loader buttons
        self.set_buttons_enabled(enabled)
        # settings buttons
        has_data = bool(self.current_dataframe is not None and not getattr(self.current_dataframe, "empty", True))
        for w in (getattr(self, "export_excel_button", None),
                  getattr(self, "resolve_na_button", None),
                  getattr(self, "codebook_button", None),
                  getattr(self, "codes_button", None)):
            if w is not None:
                w.setEnabled(enabled and has_data)
    def _init_ui(self):
        """Builds the inline loader bar and maximised table view without renaming any variables."""

        # --- root layout --------------------------------------------------------------
        self.main_layout = QVBoxLayout(self)
        self.main_layout.setContentsMargins(10, 10, 10, 8)
        self.main_layout.setSpacing(8)

        # --------------------------------------------------------------------------------
        #  Inline loader controls (still collapsible via QGroupBox so user can minimise)
        # --------------------------------------------------------------------------------
        self.loader_group = QGroupBox("Load / Export")
        self.loader_group.setObjectName("panelGroup")

        loader_vbox = QVBoxLayout()
        loader_vbox.setContentsMargins(6, 4, 6, 4)
        loader_vbox.setSpacing(6)

        # Row 1 — Collection / load controls ------------------------------------------
        loader_bar = QHBoxLayout()
        loader_bar.setContentsMargins(2, 2, 2, 2)
        loader_bar.setSpacing(8)

        loader_bar.addWidget(QLabel("Collection:"))

        self.zotero_collection_input = QLineEdit()
        self.zotero_collection_input.setObjectName("collectionInput")  # <-- styled input
        self.zotero_collection_input.setPlaceholderText("Leave blank for entire library")


        self.zotero_collection_input.setFixedWidth(260)
        loader_bar.addWidget(self.zotero_collection_input)

        self.zotero_load_button = QPushButton("Load Zotero")
        self.zotero_load_button.setObjectName("primaryButton")  # prominent button style
        self.zotero_load_button.setFixedHeight(28)

        self.zotero_load_button.clicked.connect(self.load_from_zotero)
        loader_bar.addWidget(self.zotero_load_button)

        self.select_file_button = QPushButton("Load File")
        self.select_file_button.setObjectName("secondaryButton")
        self.select_file_button.setFixedHeight(28)


        self.select_file_button.clicked.connect(self.load_from_file)
        loader_bar.addWidget(self.select_file_button)

        self.clear_cache_button = QPushButton("Clear Cache")
        self.clear_cache_button.setObjectName("secondaryButton")
        self.clear_cache_button.setFixedHeight(28)

        self.clear_cache_button.setToolTip("Deletes cached Zotero data for the collection named above.")
        self.clear_cache_button.clicked.connect(self.clear_and_reload_zotero_cache)
        loader_bar.addWidget(self.clear_cache_button)

        self.export_excel_button = QPushButton("Export Excel")
        self.export_excel_button.setObjectName("secondaryButton")
        self.export_excel_button.setFixedHeight(28)


        self.export_excel_button.clicked.connect(self.export_table_to_excel)
        loader_bar.addWidget(self.export_excel_button)

        loader_bar.addStretch(1)
        loader_vbox.addLayout(loader_bar)

        # Row 2 — Settings -------------------------------------------------------------
        settings_row = QHBoxLayout()
        settings_row.setContentsMargins(2, 0, 2, 2)
        settings_row.setSpacing(8)

        settings_row.addWidget(QLabel("Settings:"))

        from PyQt6.QtWidgets import QToolButton, QMenu

        # 2a) Resolve NA values (dropdown + pipeline)
        self.resolve_na_button = QToolButton(self)
        self.resolve_na_button.setObjectName("secondaryButton")
        self.resolve_na_button.setText("Resolve NA: (none)")

        self.resolve_na_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.resolve_na_button.setToolTip("Pick a missing field (or All) and run the NA extraction.")
        self.resolve_na_button.setEnabled(False)
        # own the menu at the widget level and attach it, so it persists
        self.resolve_na_menu = QMenu(self)
        self.resolve_na_button.setMenu(self.resolve_na_menu)
        settings_row.addWidget(self.resolve_na_button)

        # 2b) Codebook selector (No coding + named codebooks)
        self.codebook_button = QToolButton(self)
        self.codebook_button.setText("Codebook: No coding")
        self.codebook_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.codebook_button.setToolTip("Choose a codebook to show its columns alongside core fields.")
        self.codebook_menu = QMenu(self.codebook_button)
        self.codebook_button.setMenu(self.codebook_menu)
        self.codebook_button.setEnabled(False)
        settings_row.addWidget(self.codebook_button)

        # 2c) Individual coding column selector (All coding fields + each coding col)
        self.codes_button = QToolButton(self)
        self.codes_button.setObjectName("secondaryButton")
        self.codes_button.setText("Coding columns (none)")

        self.codes_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.codes_button.setToolTip("Show core fields + a single coding column, or all coding fields.")
        self.codes_menu = QMenu(self.codes_button)
        self.codes_button.setMenu(self.codes_menu)
        self.codes_button.setEnabled(False)
        settings_row.addWidget(self.codes_button)

        settings_row.addStretch(1)
        loader_vbox.addLayout(settings_row)

        self.loader_group.setLayout(loader_vbox)
        self.main_layout.addWidget(self.loader_group)

        self._na_filter_column: Optional[str] = None
        self._na_selection: Optional[list[str]] = None  # None=no action; []=All; ['institution']=specific
        self._na_should_run_on_next_load: bool = False

        # coding-columns (independent from Resolve NA)
        self._active_codebook_key: str | None = "codebook_1"
        self._active_code_columns: list[str] | None = None  # purely for table view
        self._codes_selection: Optional[list[str]] = None  # None=no action; ['x']=single; ['a','b',..]=ALL properties
        self._codes_should_run_on_next_load: bool = False
        # --------------------------------------------------------------------------------
        #  Data table container (fills remainder of window) -----------------------------
        # --------------------------------------------------------------------------------
        self.visualizer_container = QGroupBox("")  # no built-in title; we’ll render our own header
        self.visualizer_container.setObjectName("panelGroup")
        self.visualizer_container.setVisible(False)

        viz_layout = QVBoxLayout(self.visualizer_container)
        viz_layout.setContentsMargins(8, 8, 8, 8)
        viz_layout.setSpacing(8)

        # Section header (title + badges)
        header_row = QHBoxLayout()
        header_row.setContentsMargins(0, 0, 0, 0)
        header_row.setSpacing(8)

        self.table_title_label = QLabel("Data Table")
        self.table_title_label.setObjectName("sectionHeader")
        header_row.addWidget(self.table_title_label, 0, Qt.AlignmentFlag.AlignVCenter)

        header_row.addStretch(1)

        # Badges (live stats)
        self.badge_rows = QLabel("Rows: 0")
        self.badge_rows.setObjectName("badge")
        header_row.addWidget(self.badge_rows, 0, Qt.AlignmentFlag.AlignVCenter)

        self.badge_cols = QLabel("Cols: 0")
        self.badge_cols.setObjectName("badgeAlt")
        header_row.addWidget(self.badge_cols, 0, Qt.AlignmentFlag.AlignVCenter)

        self.badge_filtered = QLabel("Filtered: 0")
        self.badge_filtered.setObjectName("badgeSoft")
        header_row.addWidget(self.badge_filtered, 0, Qt.AlignmentFlag.AlignVCenter)

        viz_layout.addLayout(header_row)

        # Toolbar (filter + quick actions)
        toolbar_row = QHBoxLayout()
        toolbar_row.setContentsMargins(0, 0, 0, 0)
        toolbar_row.setSpacing(8)

        self.toolbar_container = QWidget()
        self.toolbar_container.setObjectName("toolbar")
        toolbar_layout = QHBoxLayout(self.toolbar_container)
        toolbar_layout.setContentsMargins(8, 6, 8, 6)
        toolbar_layout.setSpacing(8)

        filter_label = QLabel("Filter")
        filter_label.setObjectName("toolbarLabel")
        toolbar_layout.addWidget(filter_label)

        self.filter_input = QLineEdit()
        self.filter_input.setPlaceholderText("Type to filter data…")
        self.filter_input.textChanged.connect(self.filter_table_data)
        self.filter_input.setObjectName("toolbarFilter")
        toolbar_layout.addWidget(self.filter_input, 1)

        self.fit_columns_btn = QPushButton("Fit Columns")
        self.fit_columns_btn.setObjectName("secondaryButton")
        self.fit_columns_btn.setFixedHeight(26)
        self.fit_columns_btn.clicked.connect(lambda: self.table_view.resizeColumnsToContents())
        toolbar_layout.addWidget(self.fit_columns_btn)

        self.copy_rows_btn = QPushButton("Copy Rows")
        self.copy_rows_btn.setObjectName("secondaryButton")
        self.copy_rows_btn.setFixedHeight(26)
        self.copy_rows_btn.clicked.connect(self.copy_selected_rows)
        toolbar_layout.addWidget(self.copy_rows_btn)

        self.export_csv_btn = QPushButton("Export CSV")
        self.export_csv_btn.setObjectName("secondaryButton")
        self.export_csv_btn.setFixedHeight(26)
        self.export_csv_btn.clicked.connect(self.export_displayed_table_to_csv)
        toolbar_layout.addWidget(self.export_csv_btn)

        toolbar_row.addWidget(self.toolbar_container)
        viz_layout.addLayout(toolbar_row)

        # Divider
        divider = QWidget()
        divider.setObjectName("divider")
        divider.setFixedHeight(1)
        viz_layout.addWidget(divider)

        # Table view
        self.table_view = QTableView()
        self.table_view.setItemDelegate(HighlightDelegate(self))
        self.table_view.setSortingEnabled(True)

        # create and keep a persistent proxy (now _proxy is guaranteed to exist)
        self._proxy = AnyColumnFilterProxy(self)
        self._proxy.setDynamicSortFilter(True)
        self._proxy.setSortCaseSensitivity(Qt.CaseSensitivity.CaseInsensitive)
        self.table_view.setModel(self._proxy)

        # Spreadsheet-like editing
        self.table_view.setEditTriggers(
            QAbstractItemView.EditTrigger.DoubleClicked
            | QAbstractItemView.EditTrigger.SelectedClicked
            | QAbstractItemView.EditTrigger.EditKeyPressed  # F2 / Enter
        )
        self.table_view.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectItems)
        self.table_view.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.table_view.setTabKeyNavigation(True)

        header = self.table_view.horizontalHeader()
        header.setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        header.setStretchLastSection(True)

        self.table_view.verticalHeader().setDefaultSectionSize(26)
        self.table_view.setAlternatingRowColors(False)
        self.table_view.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.table_view.customContextMenuRequested.connect(self.show_table_context_menu)
        self.table_view.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        viz_layout.addWidget(self.table_view)

        self.main_layout.addWidget(self.visualizer_container, 1)

        try:
            self.loader_group.setVisible(True)
            self.visualizer_container.setVisible(True)  # it will hide itself when empty
        except Exception:
            pass

    def clear_and_reload_zotero_cache(self):
        """
        Confirms with the user, clears the cache for the specified collection,
        and then triggers a fresh data load from Zotero.
        """
        collection_name = self.zotero_collection_input.text().strip()
        display_name = f"'{collection_name}'" if collection_name else "'All Items' (Entire Library)"

        reply = QMessageBox.question(
            self,
            "Confirm Cache Deletion",
            f"Are you sure you want to delete the cache for collection:\n\n{display_name}?\n\nThis will force a fresh download from the Zotero API.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )

        if reply == QMessageBox.StandardButton.Yes:
            try:
                from ..utils.data_processing import clear_cache_for_collection

                # Use the authoritative cache directory from the data_processing module
                success, message = clear_cache_for_collection(collection_name, MAIN_APP_CACHE_DIR)

                if success:
                    QMessageBox.information(self, "Cache Cleared", message)
                    self.status_updated.emit("Cache cleared. Reloading data from Zotero...", 0)
                    # Automatically trigger a reload
                    self.load_from_zotero()
                else:
                    QMessageBox.warning(self, "Cache Not Found", message)

            except Exception as e:
                QMessageBox.critical(self, "Error", f"An unexpected error occurred while clearing the cache: {e}")
                logging.error(f"Failed to clear cache: {e}", exc_info=True)

    def display_data(self, df: pd.DataFrame, source_description: str):
        """Displays the loaded DataFrame in the table view and manages UI state."""
        self.current_dataframe = df
        has_data = df is not None and not df.empty

        if has_data:
            self.model = PandasTableModel(df.copy())
            # keep proxy stable; just swap its source
            self._proxy.setSourceModel(self.model)
            self.model.dataChanged.connect(self._on_table_data_changed)
            try:
                self._update_table_header_stats(df, filtered_count=len(df))
            except Exception:
                pass
            self.update_summary(df)
            self.visualizer_container.setVisible(True)

        self.export_excel_button.setEnabled(has_data)
        self.export_csv_btn.setEnabled(has_data)
        self.fit_columns_btn.setEnabled(has_data)
        self.copy_rows_btn.setEnabled(has_data)
        if hasattr(self, "resolve_na_button"):
            self.resolve_na_button.setEnabled(has_data)
            try:
                self._refresh_resolve_na_menu(self.current_dataframe if has_data else None)
            except Exception as _e:
                logging.exception("Failed to refresh Resolve NA menu: %s", _e)

        if hasattr(self, "codebook_button"):
            self.codebook_button.setEnabled(has_data)
            try:
                self._refresh_codebook_menus(self.current_dataframe if has_data else None)
            except Exception as _e:
                logging.exception("Failed to refresh codebook menus: %s", _e)

        if hasattr(self, "codes_button"):
            self.codes_button.setEnabled(has_data)
            try:
                self._refresh_codebook_menus(self.current_dataframe if has_data else None)
            except Exception as _e:
                logging.exception("Failed to refresh code columns menu: %s", _e)

    def _update_table_header_stats(self, df: pd.DataFrame | None, *, filtered_count: int | None = None) -> None:
        """
        Refresh the header badges (Rows / Cols / Filtered). Safe if badges don't exist.
        """
        try:
            total_rows = 0 if df is None or (hasattr(df, "empty") and df.empty) else len(df)  # type: ignore[arg-type]
            total_cols = 0 if df is None or (hasattr(df, "empty") and df.empty) else len(getattr(df, "columns", []))
            if hasattr(self, "badge_rows") and self.badge_rows is not None:
                self.badge_rows.setText(f"Rows: {total_rows}")
            if hasattr(self, "badge_cols") and self.badge_cols is not None:
                self.badge_cols.setText(f"Cols: {total_cols}")
            if hasattr(self, "badge_filtered") and self.badge_filtered is not None:
                self.badge_filtered.setText(f"Filtered: {filtered_count if filtered_count is not None else total_rows}")
        except Exception as e:
            import logging
            logging.exception("Failed to update table header stats: %s", e)
    def _on_table_data_changed(self):
        """Handles the dataChanged signal from the table model to update the main DataFrame."""
        if self.model:
            self.current_dataframe = self.model.get_dataframe()
            self.dataframe_updated.emit(self.current_dataframe.copy())
            self.update_summary(self.current_dataframe)

    def filter_table_data(self, text: str):
        """Filters rows via the persistent proxy (any-column contains ‘text’)."""
        if self._proxy is None:
            return
        self._proxy.setNeedle(text)
        try:
            filtered = self._proxy.rowCount()
            base_df = self.current_dataframe
            self._update_table_header_stats(base_df, filtered_count=int(filtered))
        except Exception:
            pass
            # Update header badges using the current filter result size
            try:
                # Count rows currently passing the proxy
                filtered = self._proxy.rowCount()
                base_df = self.current_dataframe
                self._update_table_header_stats(base_df, filtered_count=filtered if filtered is not None else 0)
            except Exception:
                pass

    def update_summary(self, df: pd.DataFrame):
        """
        Menu-only refresh (no UI text): keeps Settings menus in sync and caches 'most-missing' context.
        """
        import pandas as pd
        import logging

        # Keep settings dropdowns fresh
        try:
            self._refresh_resolve_na_menu(df if (isinstance(df, pd.DataFrame) and not df.empty) else None)
            self._refresh_codebook_menus(df if (isinstance(df, pd.DataFrame) and not df.empty) else None)
            if hasattr(self, "resolve_na_button"):
                self.resolve_na_button.setEnabled(isinstance(df, pd.DataFrame) and not df.empty)
            if hasattr(self, "codebook_button"):
                self.codebook_button.setEnabled(isinstance(df, pd.DataFrame) and not df.empty)
            if hasattr(self, "codes_button"):
                self.codes_button.setEnabled(isinstance(df, pd.DataFrame) and not df.empty)
        except Exception as _e:
            logging.exception("Failed to refresh Settings menus in update_summary: %s", _e)

        # Cache context for NA → Zotero action (no label)
        self._last_missing_context = None
        if not (isinstance(df, pd.DataFrame) and not df.empty):
            return

        def _is_missing_series(s: pd.Series) -> pd.Series:
            miss = s.isna()
            try:
                miss = miss | s.astype(str).str.strip().eq("")
            except Exception:
                pass

            def _empty_container(x) -> bool:
                return isinstance(x, (list, tuple, set, dict)) and len(x) == 0

            try:
                miss = miss | s.map(_empty_container)
            except Exception:
                pass
            return miss

        display_key_map = {
            "affiliation": "Affiliation",
            "theoretical_orientation": "Theoretical Orientation",
            "ontology": "Ontology",
            "epistemology": "Epistemology",
            "argumentation_logic": "Argumentation Logic",
            "evidence_source_base": "Evidence Source Base",
            "methods": "Methods",
            "method_type": "Method Type",
            "framework_model": "Framework/Model",
            "contribution_type": "Contribution Type",
            "attribution_lens_focus": "Attribution Lens Focus",
            "research_question_purpose": "Research Question/Purpose",
            "controlled_vocabulary_terms": "Controlled Vocabulary Terms",
            "abstract": "Abstract",
        }
        target_cols = [c for c in display_key_map if c in df.columns]
        if not target_cols:
            return

        missing_counts = {}
        for col in target_cols:
            try:
                missing_counts[col] = int(_is_missing_series(df[col]).sum())
            except Exception:
                missing_counts[col] = int(df[col].isna().sum())

        if not missing_counts or max(missing_counts.values()) <= 0:
            return

        target_col = max(missing_counts, key=lambda c: missing_counts[c])
        mask = _is_missing_series(df[target_col])
        keys = (df.loc[mask, "key"].astype(str).tolist() if "key" in df.columns
                else df.index[mask].astype(str).tolist())
        self._last_missing_context = {"column": target_col, "keys": keys}

    def clear_display(self):
        """Clears the data table and resets the view (keeps proxy installed)."""
        self.visualizer_container.setVisible(False)
        self.current_dataframe = None
        self.model = None
        if self._proxy is not None:
            self._proxy.setSourceModel(None)
        try:
            self._update_table_header_stats(None, filtered_count=0)
        except Exception:
            pass


    def _start_loading_task(self, source_type, file_path=None, collection_name=None):
            """Initializes and starts a background thread to load data, keeping the UI responsive."""
            if hasattr(self, 'worker_thread') and self.worker_thread and self.worker_thread.isRunning():
                logging.warning("Data loading task requested, but one is already running.")
                QMessageBox.warning(self, "Busy", "A data loading process is already running.")
                return

            logging.info("Starting new data loading task…")
            self.set_buttons_enabled(False)
            self.status_updated.emit(f"Starting to load from {source_type}...", 0)

            # 1) Create a new thread and worker for each task.
            #    The `self` parent ensures they are eventually cleaned up by Qt.
            self.worker_thread = QThread(self)
            _cfg = {
                'dir': MAIN_APP_CACHE_DIR,
                'expiry': ZOTERO_CACHE_EXPIRY_SECONDS,
                'codebook_key': getattr(self, "_active_codebook_key", None) or "codebook_1",
                'code_columns': list(getattr(self, "_active_code_columns", []) or []),
                # you may already pass zotero_client elsewhere; include here if your loader reads it
                'zotero_client': getattr(self, "zotero_client", None),
            }

            # Trace the NA selection (None → no action; [] → All; ['field'] → specific)
            na_state = getattr(self, "_na_selection", None)
            try:
                # print(f"[Load Zotero] collection='{(self.zotero_collection_input.text() or '').strip()}', "
                #       f"codebook='{_cfg['codebook_key']}', code_columns={_cfg['code_columns']}, "
                #       f"na_selection={na_state}")
                logging.info("[Load Zotero] collection='%s', codebook='%s', code_columns=%s, na_selection=%s",
                             (self.zotero_collection_input.text() or "").strip(),
                             _cfg['codebook_key'], _cfg['code_columns'], na_state)
            except Exception:
                pass
            self.worker = DataLoaderWorker(
                source_type=source_type,
                file_path=file_path,
                collection_name=collection_name,
                zotero_client=self.zotero_client,
                cache_config=_cfg
            )

            # 2) Move the worker to the thread
            self.worker.moveToThread(self.worker_thread)
            logging.info(f"Worker created and moved to thread {self.worker_thread}")

            # 3) Wire up signals
            #    a) Start worker.run() when thread starts
            self.worker_thread.started.connect(self.worker.run)

            #    b) Route worker signals back to UI
            self.worker.finished.connect(self._handle_load_finished)
            self.worker.error.connect(self._handle_load_error)
            self.worker.progress.connect(lambda msg: self.status_updated.emit(msg, 4000))


            self.worker.finished.connect(self.worker_thread.quit)
            self.worker_thread.finished.connect(self.worker.deleteLater)
            self.worker_thread.finished.connect(self.worker_thread.deleteLater)
            #       This line sets the member variable to None, preventing dangling references.
            self.worker_thread.finished.connect(self._on_thread_finished)

            # 4) Start!
            self.worker_thread.start()
            logging.info(f"Thread started; isRunning={self.worker_thread.isRunning()}")

    def _on_thread_finished(self):
            """A cleanup slot to be called after the thread has safely finished."""
            logging.info(f"Thread has finished and is being cleaned up.")
            self.worker_thread = None
            self.worker = None

    def load_from_zotero(self):
        """Starts the data loading task for a Zotero source, capturing current settings."""
        coll = (self.zotero_collection_input.text() or "").strip()
        self._last_collection_name = coll  # persist last-used collection

        # snapshot current settings at click-time (for traceability)
        codebook = getattr(self, "_active_codebook_key", None) or "codebook_1"
        code_cols = list(getattr(self, "_codes_selection", []) or [])
        na_sel = getattr(self, "_na_selection", None)

        # print(
        #     f"[Load Zotero CLICK] collection='{coll}', codebook='{codebook}', code_columns={code_cols}, na_selection={na_sel}")
        # logging.info("[Load Zotero CLICK] collection='%s', codebook='%s', code_columns=%s, na_selection=%s",
        #              coll, codebook, code_cols, na_sel)

        self._start_loading_task("zotero", collection_name=coll)

    def load_from_file(self, file_path=None):
        """Starts the data loading task for a file source."""
        if not file_path:
            file_path, _ = QFileDialog.getOpenFileName(self, "Select Data File", "", "Data Files (*.csv *.xlsx *.xls)")
        if file_path: self._start_loading_task("file", file_path=file_path)

    def _handle_load_finished(self, df, raw_items, message):
        """
        Called when the background loader finishes. Updates UI, emits signals,
        and—on *fresh* Zotero loads only—automatically files NA cases to a child collection.
        """
        try:
            # 1) Restore UI
            self.set_buttons_enabled(True)
            self.status_updated.emit(message, 100)

            # 2) Work out the source description (for listeners/UI)
            source_type = "zotero" if self.sender() and getattr(self.sender(), "source_type",
                                                                None) == "zotero" else "file"
            if source_type == "zotero":
                source_value = self.zotero_collection_input.text().strip()
                source_desc = f"Zotero: {source_value or 'All Items'}"
            else:
                source_value = getattr(self, "current_file_path", "") or ""
                source_desc = f"File: {Path(source_value).name}" if source_value else "File"

            # 3) Surface the table + summary in the UI
            if df is not None and not df.empty:
                self.display_data(df, source_desc)
                # Apply default view: explicit columns (if user set), else active codebook (default "codebook_1")
                try:
                    if self._active_code_columns:  # explicit choice wins
                        self._apply_codebook_view(code_columns=self._active_code_columns, mode="single")
                    else:
                        cbooks = self._codebooks_def()
                        cols = cbooks.get(self._active_codebook_key or "", []) if self._active_codebook_key else []
                        self._apply_codebook_view(code_columns=cols, mode="codebook")
                        self._refresh_resolve_na_menu(
                            self.current_dataframe if isinstance(self.current_dataframe, pd.DataFrame) else None)

                except Exception as _e:
                    logging.exception("Post-load view application failed: %s", _e)
            else:
                self.clear_display()

            # 4) Notify listeners
            self.data_loaded.emit(df, raw_items, source_type, source_value)

            # Decide whether to auto-run NA after a Zotero load
            try:
                cond_src = (source_type == "zotero")
                cond_df = isinstance(self.current_dataframe, pd.DataFrame) and not self.current_dataframe.empty

                # (A) Resolve-NA (missing-only) — driven by Resolve-NA dropdown
                na_flag = bool(getattr(self, "_na_should_run_on_next_load", False))
                na_sel = (self._na_selection is not None)
                logging.info("[Post-load][Resolve-NA] src=%s df=%s run_flag=%s selection=%s",
                             cond_src, cond_df, na_flag, self._na_selection)
                if cond_src and cond_df and na_flag and na_sel:
                    self._na_should_run_on_next_load = False
                    self._run_na_based_on_selection(auto=True)

                # (B) Coding-columns recode (entire dataset) — driven by Coding-columns menu
                code_flag = bool(getattr(self, "_codes_should_run_on_next_load", False))
                code_sel = (isinstance(self._codes_selection, list) and len(self._codes_selection) > 0)
                logging.info("[Post-load][Recode] src=%s df=%s run_flag=%s props=%s",
                             cond_src, cond_df, code_flag, self._codes_selection)
                if cond_src and cond_df and code_flag and code_sel:
                    self._codes_should_run_on_next_load = False
                    self._run_codes_recode(auto=True)
            except Exception as _e:
                logging.exception("Auto post-load actions failed: %s", _e)

            if hasattr(self, "resolve_na_button"):
                has_data = df is not None and not getattr(df, "empty", True)
                self.resolve_na_button.setEnabled(has_data)
                try:
                    self._refresh_resolve_na_menu(df if has_data else None)
                except Exception as _e:
                    logging.exception("Failed to refresh Resolve NA menu on load-finished: %s", _e)
            if hasattr(self, "codebook_button"):
                self.codebook_button.setEnabled(has_data)
            if hasattr(self, "codes_button"):
                self.codes_button.setEnabled(has_data)
            try:
                self._refresh_codebook_menus(df if has_data else None)
            except Exception as _e:
                logging.exception("Failed to refresh codebook menus on load-finished: %s", _e)

        except Exception as e:
            logging.exception("Error in _handle_load_finished: %s", e)
            QMessageBox.critical(self, "Load Error", f"An error occurred after loading: {e}")

    def _run_codes_recode(self, *, auto: bool = True) -> None:
        """
        Recode pipeline driven by 'Coding columns' menu.
        Always uses ALL item keys from the current DataFrame.
          • properties = self._codes_selection  (list[str])
          • item_keys  = ALL keys in df['key']
        """
        if not getattr(self, "zotero_client", None):
            QMessageBox.information(self, "Zotero", "Zotero client not configured.")
            return
        props = list(self._codes_selection or [])
        if not props:
            return
        coll = (self.zotero_collection_input.text() or "").strip()
        if not coll:
            QMessageBox.information(self, "Zotero", "Please enter a Zotero collection name first.")
            return

        import pandas as pd
        df = self.current_dataframe if isinstance(self.current_dataframe, pd.DataFrame) else None
        if df is None or df.empty or "key" not in df.columns:
            QMessageBox.information(self, "Recode", "No data or 'key' column missing.")
            return

        # ALL item keys (stable, deduped)
        item_keys = list(dict.fromkeys([str(k).strip() for k in df["key"].dropna().tolist() if str(k).strip()]))

        # Trace
        try:
            print(f"[Recode] collection='{coll}', props={props}, item_keys_count={len(item_keys)}")
            logging.info("[Recode] collection='%s', props=%s, item_keys=%s", coll, props, len(item_keys))
        except Exception:
            pass

        # Disable UI + status
        self._set_settings_enabled(False)
        self._emit_status("Recoding dataset…", 15)

        # Single thread invocation using extract_na_flat over ALL keys
        self._na_thread = _NAExtractThread(
            client=self.zotero_client,
            collection_name=coll,
            na_properties=props,  # flat properties
            do_affiliations=True,
            read=False, store_only=True, cache=True, parent=self,
            items_by_folder={},  # not used in flat mode
            item_keys=item_keys  # ALL keys
        )
        self._na_thread.finished_ok.connect(self._on_extract_na_finished)
        self._na_thread.start()
    def _core_columns(self) -> list[str]:
        """
        Source of truth for 'core' (non-coding) columns. Mirrors Zotero_loader_to_df.CORE_COLUMNS.
        Falls back to a minimal safe set if import path changes.
        """
        try:
            from bibliometric_analysis_tool.utils.Zotero_loader_to_df import CORE_COLUMNS as _CORES
            return list(_CORES)
        except Exception:
            base = ['key', 'title', 'year', 'authors', 'url', 'source', 'citations', 'item_type', 'user_decision',
                    'user_notes']
            return base

    def _all_coding_columns(self, df: pd.DataFrame | None) -> list[str]:
        if df is None or df.empty:
            return []
        core = set(self._core_columns())
        return [c for c in df.columns if c not in core]

    def _codebooks_def(self) -> dict[str, list[str]]:
        """
        Named codebooks. If available, import from Zotero_loader_to_df.CODEBOOKS;
        otherwise use the default mapping.
        """
        try:
            from bibliometric_analysis_tool.utils.Zotero_loader_to_df import CODEBOOKS as _CBOOKS
            return dict(_CBOOKS)
        except Exception:
            return {
                "codebook_1": [
                    "controlled_vocabulary_terms", "abstract",
                    "institution", "country", "place", "affiliation",
                    "word_count_for_attribution", "attribution_mentions",
                    "department",
                ],
                "codebook_2": [
                    "evidence_source_base",
                    "methods",
                    "framework_model",
                    "overarching_theme",
                ],
                "codebook_3": [
                    "evaluative", "descriptive", "analytical",
                ],
            }

    def _refresh_codebook_menus(self, df: pd.DataFrame | None):
        """
        Rebuild menus using df:
          • Codebook menu (single-choice)
          • Coding columns menu (multi-select) = codebook fields intersect df.columns
            - show missing counts per present field
            - disable fields not present in df (still visible)
        """
        # --- Codebook (single-choice) ---
        if hasattr(self, "codebook_button"):
            from ..core.app_constants import CODEBOOKS
            cb_menu = QMenu(self)
            active_key = getattr(self, "_active_codebook_key", None) or "codebook_1"

            # 'No coding'
            none_act = cb_menu.addAction("No coding")
            none_act.setCheckable(True)
            none_act.setChecked(active_key is None)
            none_act.triggered.connect(lambda: self._on_codebook_selected(None))

            cb_menu.addSeparator()
            labels = {"codebook_1": "Codebook 1", "codebook_2": "Codebook 2", "codebook_3": "Codebook 3"}
            for key in ["codebook_1", "codebook_2", "codebook_3"]:
                if key in CODEBOOKS:
                    act = cb_menu.addAction(labels.get(key, key))
                    act.setCheckable(True)
                    act.setChecked(key == active_key)
                    act.triggered.connect(lambda _, k=key: self._on_codebook_selected(k))

            self.codebook_button.setMenu(cb_menu)
            cur_label = "No coding" if active_key is None else labels.get(active_key, str(active_key))
            self.codebook_button.setText(f"Codebook: {cur_label}")

        # --- Coding columns (multi-select) ---
        if not hasattr(self, "codes_button"):
            return

        from ..core.app_constants import CODEBOOKS
        active_key = getattr(self, "_active_codebook_key", None) or "codebook_1"
        all_props = list(CODEBOOKS.get(active_key, []))

        # df-aware helpers
        is_df = isinstance(df, pd.DataFrame) and not df.empty
        cols_present = set(df.columns) if is_df else set()

        def _is_missing_series(s: pd.Series) -> pd.Series:
            miss = s.isna()
            try:
                miss = miss | s.astype(str).str.strip().eq("")
            except Exception:
                pass
            return miss

        # compute missing counts for present fields
        missing_counts: dict[str, int] = {}
        if is_df:
            for p in all_props:
                if p in cols_present:
                    try:
                        missing_counts[p] = int(_is_missing_series(df[p]).sum())
                    except Exception:
                        missing_counts[p] = int(df[p].isna().sum())

        # build menu
        codes_menu = QMenu(self)

        # header actions
        sel_all = codes_menu.addAction("Select all (current codebook)")
        sel_all.triggered.connect(lambda: self._codes_check_all(True, all_props))
        clr_all = codes_menu.addAction("Clear selection")
        clr_all.triggered.connect(lambda: self._codes_check_all(False, all_props))
        codes_menu.addSeparator()

        # present first (sorted by missing desc/name), then absent (disabled)
        present_items = [(p, missing_counts.get(p, 0)) for p in all_props if p in cols_present]
        absent_items = [p for p in all_props if p not in cols_present]
        present_items.sort(key=lambda kv: (-kv[1], kv[0]))
        absent_items.sort()

        # track actions
        self._codes_actions: dict[str, QAction] = {}

        current = set(self._codes_selection or [])
        for p, n in present_items:
            label = f"{p} ({n})"
            a = codes_menu.addAction(label)
            a.setCheckable(True)
            a.setChecked(p in current)
            a.toggled.connect(lambda checked, prop=p: self._on_codes_action_toggled(prop, checked))
            self._codes_actions[p] = a

        if absent_items:
            codes_menu.addSection("Not in data")
            for p in absent_items:
                a = codes_menu.addAction(p)
                a.setEnabled(False)  # visible but disabled (not in df)
                self._codes_actions[p] = a  # keep reference (in case you want to enable later)

        codes_menu.addSeparator()
        apply_act = codes_menu.addAction("Apply selection")
        apply_act.triggered.connect(self._apply_codes_selection)

        self.codes_button.setMenu(codes_menu)

        # Button label
        sel = list(self._codes_selection or [])
        if not sel:
            self.codes_button.setText("Coding columns")
        else:
            # show compact summary
            if len(sel) == len(all_props):
                self.codes_button.setText("Coding columns: All")
            elif len(sel) == 1:
                self.codes_button.setText(f"Coding columns: {sel[0]}")
            else:
                preview = ", ".join(sel[:2]) + ("…" if len(sel) > 2 else "")
                self.codes_button.setText(f"Coding columns: {preview}")

    def _on_codes_action_toggled(self, prop: str, checked: bool) -> None:
        """
        Track multi-select state locally without affecting Resolve-NA selection.
        """
        sel = set(self._codes_selection or [])
        if checked:
            sel.add(prop)
        else:
            sel.discard(prop)
        self._codes_selection = sorted(sel)

    def _codes_check_all(self, check: bool, props: list[str]) -> None:
        """
        Tick/untick all properties in the current codebook menu visually and in state.
        """
        self._codes_selection = list(props) if check else []
        for p in props:
            act = self._codes_actions.get(p)
            if act is not None:
                # blockSignals avoids recursive toggled() loops
                old = act.blockSignals(True)
                act.setChecked(check)
                act.blockSignals(old)

    def _apply_codes_selection(self) -> None:
        """
        Apply the chosen coding columns to the table view and arm full-dataset recode
        (independent of Resolve-NA). Does NOT alter _na_selection.
        """
        sel = list(self._codes_selection or [])
        if not sel:
            self.codes_button.setText("Coding columns: (none)")
            self._active_code_columns = []
            self._apply_codebook_view(code_columns=[], mode="single")
            self._codes_should_run_on_next_load = False
            return

        # Update button text and table view
        label = "All" if self._is_codes_selection_all(sel) else ", ".join(sel[:2]) + ("…" if len(sel) > 2 else "")
        self.codes_button.setText(f"Coding columns: {label}")
        self._active_code_columns = sel
        self._apply_codebook_view(code_columns=sel, mode="single")

        # Arm independent “recode-all-keys” run on next Load Zotero
        self._codes_should_run_on_next_load = True

    def _is_codes_selection_all(self, sel: list[str]) -> bool:
        try:
            from ..core.app_constants import CODEBOOKS
            active_key = self._active_codebook_key or "codebook_1"
            all_props = list(CODEBOOKS.get(active_key, []))
            return sorted(sel) == sorted(all_props)
        except Exception:
            return False
    def _on_codebook_selected(self, key: str | None):
        """
        Update state and show: CORE + selected codebook columns. None => core only.
        Also reset explicit single-column selection.
        """
        self._active_codebook_key = key
        self._active_code_columns = None  # codebook takes precedence unless user picks explicit column(s)
        label = "No coding" if key is None else {"codebook_1": "Codebook 1", "codebook_2": "Codebook 2",
                                                 "codebook_3": "Codebook 3"}.get(key, key)
        self.codebook_button.setText(f"Codebook: {label}")
        cbooks = self._codebooks_def()
        cols = cbooks.get(key, []) if key else []
        self._apply_codebook_view(code_columns=cols, mode="codebook")

    def _on_codecolumn_selected(self, col: str):
        """
        Update table view (CORE + chosen coding col(s)) and set an *independent*
        recode selection to re-run on next 'Load Zotero', **without** touching the
        Resolve-NA dropdown state.

          • "All coding fields"  → recode all codebook fields
          • Single column 'x'    → recode only property 'x'

        Recode always uses ALL item keys (full dataset), not just missing ones.
        """
        # Visual: what columns to show
        if col == "__ALL__":
            self.codes_button.setText("Coding columns: All")
            cols_for_view = self._all_coding_columns(self.current_dataframe)
            # Recode selection: all properties from active codebook
            try:
                from ..core.app_constants import CODEBOOKS
                active_key = self._active_codebook_key or "codebook_1"
                self._codes_selection = [c for c in CODEBOOKS.get(active_key, []) if c]
            except Exception:
                self._codes_selection = list(cols_for_view)  # fallback to all non-core seen
            logging.info("[Coding columns] Recode selection set to ALL (%d props).", len(self._codes_selection or []))
        else:
            self.codes_button.setText(f"Coding columns: {col}")
            cols_for_view = [col]
            self._codes_selection = [col]
            logging.info("[Coding columns] Recode selection set to property: %s", col)

        # These affect only the table view layout
        self._active_code_columns = cols_for_view
        self._apply_codebook_view(code_columns=cols_for_view, mode="single")

        # Arm independent recode-on-load flag; do NOT touch Resolve-NA state
        self._codes_should_run_on_next_load = True
    def _apply_codebook_view(self, *, code_columns: list[str], mode: str):
        """
        Build a view DataFrame with only CORE + requested 'code_columns', if available.
        Does NOT mutate self.current_dataframe; it just swaps the proxy's source model.
        """
        df = self.current_dataframe
        if df is None or df.empty:
            return
        core = list(self._core_columns())
        for c in (code_columns or []):
            if c not in df.columns:
                df[c] = ""  # NA-friendly; your NA checks already treat "" as missing

        wanted = core + [c for c in (code_columns or []) if c not in core]
        view_df = df.loc[:, [c for c in wanted if c in df.columns]].copy()

        display_model = PandasTableModel(view_df)
        if self._proxy is not None:
            self._proxy.setSourceModel(display_model)
        else:
            self.table_view.setModel(display_model)  # hard fallback

    def _on_resolve_na_toggled(self, col: str, checked: bool) -> None:
        sel = set(self._na_selection or [])
        if checked:
            sel.add(col)
        else:
            sel.discard(col)
        # Keep as list (no “All” here; All is [] and set via Select all / Apply with none ticked)
        self._na_selection = sorted(sel)

    def _resolve_na_check_all(self, check: bool, props: list[str]) -> None:
        self._na_selection = list(props) if check else []
        for p in props:
            act = self._na_actions.get(p)
            if act is not None and act.isEnabled():
                old = act.blockSignals(True)
                act.setChecked(check)
                act.blockSignals(old)

    def _resolve_na_apply_selection(self) -> None:
        """
        Commit selection to the button label and arm 'run on next load'.
        [] => 'All', non-empty list => the chosen fields.
        """
        sel = list(self._na_selection or [])
        if not sel:
            self.resolve_na_button.setText("Resolve NA: All")
        elif len(sel) == 1:
            self.resolve_na_button.setText(f"Resolve NA: {sel[0]}")
        else:
            preview = ", ".join(sel[:2]) + ("…" if len(sel) > 2 else "")
            self.resolve_na_button.setText(f"Resolve NA: {preview}")
        # don’t alter coding-columns state
        self._na_filter_column = None  # don’t auto-filter here
        self._na_should_run_on_next_load = True

    def _refresh_resolve_na_menu(self, df: pd.DataFrame | None):
        """
        Multi-select Resolve NA:
          • “Select all / Clear”
          • tick multiple fields (from active codebook), counts next to present columns
          • “Apply selection” commits self._na_selection = [] (All) or list[str] (≥1 fields)
        """
        if not hasattr(self, "resolve_na_button"):
            return

        from ..core.app_constants import CODEBOOKS
        active_key = getattr(self, "_active_codebook_key", None) or "codebook_1"
        allow = list(CODEBOOKS.get(active_key, []))

        # df-aware counts
        is_df = isinstance(df, pd.DataFrame) and not df.empty
        cols_present = set(df.columns) if is_df else set()

        def _is_missing_series(s: pd.Series) -> pd.Series:
            miss = s.isna()
            try:
                miss = miss | s.astype(str).str.strip().eq("")
            except Exception:
                pass

            def _empty_container(x) -> bool:
                return isinstance(x, (list, tuple, set, dict)) and len(x) == 0

            try:
                miss = miss | s.map(_empty_container)
            except Exception:
                pass
            return miss

        counts: dict[str, int] = {}
        if is_df:
            for c in allow:
                if c in cols_present:
                    try:
                        counts[c] = int(_is_missing_series(df[c]).sum())
                    except Exception:
                        counts[c] = int(df[c].isna().sum())

        # Build menu
        menu = QMenu(self)

        # Header: select/clear all
        sel_all = menu.addAction("Select all (current codebook)")
        sel_all.triggered.connect(lambda: self._resolve_na_check_all(True, allow))
        clr_all = menu.addAction("Clear selection")
        clr_all.triggered.connect(lambda: self._resolve_na_check_all(False, allow))
        menu.addSeparator()

        # Actions map + current selection set
        self._na_actions: dict[str, QAction] = {}
        current = set(self._na_selection or [])
        # Note: “All” is represented by [] — handled via header “Select all” or “Apply selection: All”

        # Present first (sorted by missing desc), absent (disabled) after
        present_items = [(c, counts.get(c, 0)) for c in allow if c in counts]
        absent_items = [c for c in allow if c not in counts]
        present_items.sort(key=lambda kv: (-kv[1], kv[0]))
        absent_items.sort()

        for c, n in present_items:
            act = menu.addAction(f"{c} ({n})")
            act.setCheckable(True)
            act.setChecked(c in current)
            act.toggled.connect(lambda checked, col=c: self._on_resolve_na_toggled(col, checked))
            self._na_actions[c] = act

        if absent_items:
            menu.addSection("Not in data")
            for c in absent_items:
                act = menu.addAction(c)
                act.setEnabled(False)
                # keep a reference (optional)
                self._na_actions[c] = act

        menu.addSeparator()
        apply_act = menu.addAction("Apply selection")
        apply_act.triggered.connect(self._resolve_na_apply_selection)

        self.resolve_na_menu = menu
        self.resolve_na_button.setMenu(menu)

    def _on_resolve_na_selected(self, col_name: Optional[str]) -> None:
        if col_name is None:
            self._na_selection = []  # All
            caption = "Resolve NA: All"
        else:
            self._na_selection = [str(col_name)]  # Specific field
            caption = f"Resolve NA: {self._na_selection[0]}"

        # reflect in button
        if hasattr(self, "resolve_na_button") and self.resolve_na_button:
            self.resolve_na_button.setText(caption)

        # refresh menu checkmarks
        try:
            df = self.current_dataframe if isinstance(self.current_dataframe, pd.DataFrame) else None
            self._refresh_resolve_na_menu(df)
        except Exception:
            pass

        # preview NA rows for that field (or clear preview if All)
        self._na_filter_column = col_name or None
        self._apply_na_filter()

        # run on next Zotero load
        self._na_should_run_on_next_load = True

    def _resolve_na_build_payload(self, df: pd.DataFrame) -> tuple[dict[str, list[str]], list[str]]:
        """
        Build the payload for Resolve-NA based on current selection and active codebook.

        Always returns concrete structures:
          - All selected     → (items_by_folder: dict[str, list[str]], item_keys: [])
          - Single field     → (items_by_folder: {}, item_keys: list[str])
          - No selection/df  → ({}, [])
        """
        # Defaults (always return structures)
        empty_folders: dict[str, list[str]] = {}
        empty_keys: list[str] = []

        if not isinstance(df, pd.DataFrame) or df.empty:
            return empty_folders, empty_keys
        if getattr(self, "_na_selection", None) is None:
            return empty_folders, empty_keys

        # active codebook columns
        try:
            from ..core.app_constants import CODEBOOKS
            active_key = getattr(self, "_active_codebook_key", None) or "codebook_1"
            allow = [c for c in CODEBOOKS.get(active_key, []) if c]
        except Exception:
            allow = []

        # helper to check missingness
        def _is_missing_series(s: pd.Series) -> pd.Series:
            miss = s.isna()
            try:
                miss = miss | s.astype(str).str.strip().eq("")
            except Exception:
                pass
            return miss

        # guard
        if "key" not in df.columns:
            return empty_folders, empty_keys

        # Single-field mode → item_keys only
        if isinstance(self._na_selection, list) and len(self._na_selection) >= 1:
            fields = [f for f in self._na_selection if f in df.columns]
            if not fields:
                return empty_folders, empty_keys
            miss_any = None
            for f in fields:
                m = _is_missing_series(df[f])
                miss_any = m if miss_any is None else (miss_any | m)
            keys = [str(k).strip() for k in df.loc[miss_any, "key"].dropna().astype(str).tolist() if str(k).strip()]
            # de-dup + stable
            keys = list(dict.fromkeys(keys))
            return empty_folders, keys

        # All-fields (codebook) → folders dict by exact-miss set (unchanged)
        if isinstance(self._na_selection, list) and len(self._na_selection) == 0:
            present = [c for c in allow if c in df.columns]
            if not present:
                return empty_folders, empty_keys
            miss_df = pd.DataFrame({c: _is_missing_series(df[c]) for c in present}, index=df.index)
            folders: dict[str, list[str]] = {}
            for idx in miss_df.index[miss_df.any(axis=1)]:
                row_miss = [c for c in present if bool(miss_df.at[idx, c])]
                if not row_miss:
                    continue
                folder = "__".join(sorted(row_miss))
                k = str(df.at[idx, "key"]).strip()
                if not k:
                    continue
                folders.setdefault(folder, []).append(k)
            for f in list(folders.keys()):
                folders[f] = sorted(list(dict.fromkeys(folders[f])))
            return folders, empty_keys

        return empty_folders, empty_keys
    def _run_na_based_on_selection(self, *, auto: bool = True) -> None:
        """
        Start NA extraction based on current selection:
          • None   → do nothing
          • []     → extract_na (all codebook fields) with items_by_folder (dict)
          • ['x']  → extract_na_flat(property=['x']) with item_keys (list)
        Always passes the computed payload (even if empty).
        """
        if not getattr(self, "zotero_client", None):
            QMessageBox.information(self, "Zotero", "Zotero client not configured.")
            return

        if getattr(self, "_na_selection", None) is None:
            return

        coll = (self.zotero_collection_input.text() or "").strip()
        if not coll:
            QMessageBox.information(self, "Zotero", "Please enter a Zotero collection name first.")
            return

        if not auto and hasattr(self, "_confirm_and_run_extract_na"):
            self._confirm_and_run_extract_na()
            return

        # Compute payload from the CURRENT TABLE
        df = self.current_dataframe if isinstance(self.current_dataframe, pd.DataFrame) else None
        items_by_folder, item_keys = ({}, [])
        try:
            if df is not None and not df.empty:
                items_by_folder, item_keys = self._resolve_na_build_payload(df)
        except Exception as _e:
            logging.warning("Resolve-NA payload build failed: %s", _e)

        # Disable UI + status
        self._set_settings_enabled(False)
        self._emit_status("Resolving NA values…", 15)

        # Map tri-state to props
        props: list[str] | None = None
        if isinstance(self._na_selection, list):
            # [] => All (grouped, items_by_folder),  >=1 => flat properties list
            props = [] if len(self._na_selection) == 0 else list(self._na_selection)

        # Trace exactly what will be sent
        try:
            print(f"[Resolve NA] collection='{coll}', props={props}, "
                  f"folders={ {k: len(v) for k, v in (items_by_folder or {}).items()} }, "
                  f"item_keys_count={len(item_keys or [])}")
            logging.info("[Resolve NA] collection='%s', props=%s, folders=%s, item_keys=%s",
                         coll, props,
                         {k: len(v) for k, v in (items_by_folder or {}).items()},
                         len(item_keys or []))
        except Exception:
            pass

        # Thread + START it
        self._na_thread = _NAExtractThread(
            client=self.zotero_client,
            collection_name=coll,
            na_properties=props,
            do_affiliations=True,
            read=False, store_only=True, cache=True, parent=self,
            items_by_folder=items_by_folder,
            item_keys=item_keys
        )
        self._na_thread.finished_ok.connect(self._on_extract_na_finished)
        self._na_thread.start()
    def _apply_na_filter(self):
        model_df = self.current_dataframe if self.current_dataframe is not None else None
        if model_df is None or model_df.empty:
            return

        if not self._na_filter_column:
            # Clear NA-filter; show full df (still subject to text filter)
            self.filter_table_data(self.filter_input.text())
            return

        col = self._na_filter_column
        df = model_df

        def _is_missing_series(s: pd.Series) -> pd.Series:
            miss = s.isna()
            try:
                miss = miss | s.astype(str).str.strip().eq("")
            except Exception:
                pass

            def _empty_container(x) -> bool:
                return isinstance(x, (list, tuple, set, dict)) and len(x) == 0

            try:
                miss = miss | s.map(_empty_container)
            except Exception:
                pass
            return miss

        if col not in df.columns:
            QMessageBox.information(self, "Column not found", f"Column '{col}' not present in the dataset.")
            return

        mask = _is_missing_series(df[col])
        filtered_df = df.loc[mask].copy()

        display_model = PandasTableModel(filtered_df)
        if self._proxy is not None:
            self._proxy.setSourceModel(display_model)
        else:
            self.table_view.setModel(display_model)  # hard fallback

    @pyqtSlot(bool, str)
    def _on_extract_na_finished(self, ok: bool, message: str) -> None:
        """
        Callback for NA extraction thread completion.
        Re-enables settings, updates status, and refreshes menus safely.
        """
        try:
            # Re-enable top controls
            if hasattr(self, "_set_settings_enabled"):
                self._set_settings_enabled(True)
            elif hasattr(self, "set_buttons_enabled"):
                # Fallback to your existing helper if the consolidated one isn't present
                self.set_buttons_enabled(True)

            # Surface status
            if hasattr(self, "_emit_status"):
                self._emit_status(message, 100 if ok else 0)

            # Notify on failure
            if not ok:
                try:
                    from PyQt6.QtWidgets import QMessageBox
                    QMessageBox.warning(self, "Resolve NA values", message)
                except Exception:
                    pass
                return

            # On success, refresh menus (NA counts / codebook menus may change)
            try:
                import pandas as _pd
                df = self.current_dataframe if isinstance(self.current_dataframe, _pd.DataFrame) else None
                if df is not None and not df.empty:
                    if hasattr(self, "_refresh_resolve_na_menu"):
                        self._refresh_resolve_na_menu(df)
                    if hasattr(self, "_refresh_codebook_menus"):
                        self._refresh_codebook_menus(df)
            except Exception:
                pass

            # Optionally update table header stats if available
            try:
                if hasattr(self, "_update_table_header_stats"):
                    base = self.current_dataframe
                    filtered = self._proxy.rowCount() if hasattr(self, "_proxy") and self._proxy is not None else (
                        len(base) if base is not None else 0)
                    self._update_table_header_stats(base, filtered_count=int(filtered))
            except Exception:
                pass
        finally:
            # Clean thread handle
            if hasattr(self, "_na_thread"):
                self._na_thread = None

    def _emit_status(self, text: str, pct: int | None = None) -> None:
        """
        Safe status update helper that avoids direct attribute references.
        Emits `status_updated(text, percent)` if available; otherwise tries a label if present.
        """
        # Emit signal if present
        try:
            sig = getattr(self, "status_updated", None)
            if sig is not None:
                try:
                    val = 0 if pct is None else max(0, min(100, int(pct)))
                    sig.emit(text, val)  # type: ignore[attr-defined]
                except Exception:
                    try:
                        sig.emit(text)  # type: ignore[attr-defined]
                    except Exception:
                        pass
        except Exception:
            pass

        # Optional label fallback (accessed via getattr to appease linters)
        try:
            lbl = getattr(self, "status_label", None)
            if lbl is not None:
                lbl.setText(text)
        except Exception:
            pass

        # Let the UI repaint
        try:
            from PyQt6.QtWidgets import QApplication
            QApplication.processEvents()
        except Exception:
            pass

    def _auto_file_na_collection(self, df: pd.DataFrame, allow: list[str] | None = None):
        """
        Group items by the *exact set* of missing coding columns, but ensure each Zotero key is
        added to ONE group only. We prioritise groups with the *most* missing fields first
        (higher specificity), then fall back to less specific groups after de-duplicating keys.

        Subcollection name pattern: "<feature1>_<feature2>_..._NA" (features sorted).

        If `allow is None`, use the *currently active codebook* to define which columns
        count as "coding" (falls back to a safe default if unavailable).
        """
        try:
            if self.zotero_client is None:
                logging.info("Zotero client not set; skipping grouped NA auto-file.")
                return

            parent_name = (self.zotero_collection_input.text() or "").strip()
            if not parent_name:
                logging.info("No parent collection name provided; skipping grouped NA auto-file.")
                return

            # Resolve columns to evaluate
            if allow is None:
                # Prefer app-level CODEBOOKS
                try:
                    from ..core.app_constants import CODEBOOKS  # mapping like {"codebook_1":[...], ...}
                    active_key = getattr(self, "_active_codebook_key", None) or "codebook_1"
                    allow = list(CODEBOOKS.get(active_key, []))
                except Exception:
                    # Fallback hard-coded list
                    allow = [
                        "theoretical_orientation", "ontology", "epistemology", "argumentation_logic",
                        "evidence_source_base", "methods", "method_type", "framework_model",
                        "contribution_type", "attribution_lens_focus", "research_question_purpose",
                        "controlled_vocabulary_terms", "abstract",
                    ]

            allow = [c for c in (allow or []) if c]  # clean
            present = [c for c in allow if c in df.columns]
            if not present:
                logging.info("No coding columns present for active codebook; skipping grouped NA auto-file.")
                return

            def _is_missing(series: pd.Series) -> pd.Series:
                miss = series.isna()
                try:
                    miss = miss | series.astype(str).str.strip().eq("")
                except Exception:
                    pass
                return miss

            # Boolean DF of missingness for allowed columns
            miss_df = pd.DataFrame({c: _is_missing(df[c]) for c in present}, index=df.index)

            # Require a key column to map items back to Zotero
            if "key" not in df.columns:
                logging.info("DataFrame has no 'key' column; cannot file to Zotero.")
                return

            # 1) Aggregate per KEY: union of missing columns across duplicate rows
            key_to_missing: dict[str, set] = {}
            for idx in miss_df.index[miss_df.any(axis=1)]:
                item_key = str(df.at[idx, "key"]).strip()
                if not item_key:
                    continue
                miss_set = {c for c in present if bool(miss_df.at[idx, c])}
                if not miss_set:
                    continue
                key_to_missing.setdefault(item_key, set()).update(miss_set)

            if not key_to_missing:
                logging.info("No items with missing coding values; nothing to group.")
                return

            # 2) Invert: frozenset(missing_cols) -> set(keys)
            from collections import defaultdict
            group_map: dict[frozenset, set] = defaultdict(set)
            for k, miss_set in key_to_missing.items():
                group_map[frozenset(miss_set)].add(k)

            # 3) Sort groups by: (descending number of missing fields, descending size, name)
            def group_sort_key(item):
                miss_set, keys = item
                name = "_".join(sorted(miss_set))
                return (-len(miss_set), -len(keys), name)

            groups_sorted = sorted(group_map.items(), key=group_sort_key)

            # 4) Create/fetch parent collection once
            top_key = self.zotero_client.find_or_create_top_collection(parent_name)
            parent_key = self.zotero_client.find_or_create_subcollection(parent_key=top_key,
                                                                         subcoll_name=f"0_NA_{parent_name}")
            # 5) Iterate groups, de-duplicating keys so each key appears once
            already_assigned: set[str] = set()
            created_count = 0
            total_items = 0

            for miss_set, keys in groups_sorted:
                remaining = sorted(set(keys) - already_assigned)
                if not remaining:
                    continue

                sub_name = f"{'__'.join(sorted(miss_set))}"
                try:
                    sub_key = self.zotero_client.find_or_create_subcollection(parent_key=parent_key,
                                                                              subcoll_name=sub_name)
                    if not sub_key:
                        logging.error("Failed to create/find subcollection '%s' under '%s'. Skipping.", sub_name,
                                      parent_name)
                        continue

                    self.zotero_client.add_items_to_collection(collection_key=sub_key, items_keys=remaining)
                    already_assigned.update(remaining)
                    created_count += 1
                    total_items += len(remaining)

                    logging.info(
                        "Grouped NA: added %d item(s) to '%s' → '%s' (%s). Missing-set size=%d",
                        len(remaining), parent_name, sub_name, sub_key, len(miss_set)
                    )
                except Exception as e:
                    logging.error("Failed to add group '%s' (%d items): %s", sub_name, len(remaining), e, exc_info=True)

            logging.info(
                "Grouped NA auto-file (deduped) complete: %d subcollection(s), %d item(s) total. Uniqueness enforced per key.",
                created_count, total_items
            )

        except Exception as e:
            logging.exception("Failed during grouped NA auto-collection push: %s", e)

    def _handle_load_error(self, error_msg):
        """Slot to handle the `error` signal from the DataLoaderWorker."""
        logging.error(f"Worker 'error' signal received: {error_msg}")
        self.set_buttons_enabled(True)
        QMessageBox.critical(self, "Data Loading Error", error_msg)

    def set_buttons_enabled(self, enabled: bool):
        """Enables or disables the data-loading buttons during a task."""
        self.select_file_button.setEnabled(enabled)
        if self.zotero_client:
            self.zotero_load_button.setEnabled(enabled)
            self.clear_cache_button.setEnabled(enabled) # Keep this if you want it disabled during load

    def export_table_to_excel(self):
        """Exports the data currently visible in the table to an Excel file."""
        model = self.table_view.model()
        if model is None or not hasattr(model, 'get_dataframe') or model.get_dataframe().empty:
            QMessageBox.information(self, "Export Error", "No data to export.")
            return

        df_to_export = model.get_dataframe()
        default_filename = "data_export.xlsx"
        file_path, _ = QFileDialog.getSaveFileName(
            self, "Save Displayed Table Data", default_filename, "Excel Files (*.xlsx)"
        )
        if file_path:
            try:
                df_to_export.to_excel(file_path, index=False)
                QMessageBox.information(self, "Export Successful", f"Table data saved to {file_path}")
            except Exception as e:
                QMessageBox.critical(self, "Export Failed", f"Could not save data: {e}")

    def start_fresh_session(self, reason: str = ""):
        """
        ###1. clear UI + in-memory dataset state
        ###2. keep app usable when no session can be restored
        """
        self.set_buttons_enabled(True)

        if hasattr(self, "zotero_collection_input"):
            self.zotero_collection_input.setText("")

        self.current_dataframe = None
        self.current_raw_items = None
        self.current_source_desc = ""

        self.clear_display()

        msg = "Fresh session started."
        if str(reason or "").strip():
            msg = f"{msg} ({reason})"
        self.status_updated.emit(msg, 300)

    def load_from_session(self, session_info: dict):
        """Loads data based on a saved session dictionary."""
        info = session_info if isinstance(session_info, dict) else {}
        source_type = str(info.get("type") or "").strip()
        file_path = info.get("path")
        collection_name = info.get("collection_name")

        logging.info("DataHub received request to load from session: %r", info)

        if source_type == "zotero":
            self.zotero_collection_input.setText(collection_name or "")
            self.load_from_zotero()
            return

        if source_type == "file":
            if file_path and Path(file_path).exists():
                self.load_from_file(file_path=file_path)
                return
            if file_path:
                QMessageBox.warning(self, "Session Load Error", f"Could not find the last session file:\n{file_path}")
                self.start_fresh_session(reason="session file path missing on disk")
                return
            QMessageBox.warning(self, "Session Load Error",
                                "Session specified a file source, but the path was missing.")
            self.start_fresh_session(reason="session file path missing")
            return

        self.start_fresh_session(reason=f"unknown session source_type='{source_type or '∅'}'")

    def clear_zotero_cache(self):
        """Clears cached Zotero dataframe pickles for a specific collection (or all-items)."""
        collection_name = self.zotero_collection_input.text().strip()

        def _stable_cache_tag(name: str) -> str:
            s = str(name or "").strip().casefold()
            s = re.sub(r"\s+", "_", s)
            s = re.sub(r"[^\w\-_.]+", "_", s)
            s = re.sub(r"_+", "_", s).strip("_")
            return s or "all_items"

        tag = _stable_cache_tag(collection_name)

        cache_dir = ZOTERO_DF_CACHE_DIR
        cache_dir.mkdir(parents=True, exist_ok=True)

        candidates = []
        candidates.extend([p for p in cache_dir.glob(f"*{tag}*.pkl") if p.is_file()])
        candidates.extend([p for p in cache_dir.glob(f"*{tag}*.pickle") if p.is_file()])

        seen = set()
        uniq = []
        for p in sorted(candidates, key=lambda x: x.stat().st_mtime, reverse=True):
            k = str(p.resolve())
            if k in seen:
                continue
            seen.add(k)
            uniq.append(p)

        if not uniq:
            QMessageBox.information(
                self,
                "Cache Empty",
                f"No Zotero cache files found for:\n\n'{collection_name or 'All Items'}'\n\nCache dir:\n{cache_dir}",
            )
            return

        reply = QMessageBox.question(
            self,
            "Confirm Cache Deletion",
            "Are you sure you want to delete cached Zotero dataframes for:\n\n"
            f"'{collection_name or 'All Items'}'?\n\n"
            "This will force a fresh download from the Zotero API on the next load.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )

        if reply != QMessageBox.StandardButton.Yes:
            return

        deleted = 0
        failed = 0
        for p in uniq:
            try:
                p.unlink(missing_ok=True)
                deleted += 1
                logging.info("Deleted cache file: %s", p.name)
            except Exception:
                failed += 1

        if failed:
            QMessageBox.warning(
                self,
                "Cache Cleared (Partial)",
                f"Deleted {deleted} file(s) in:\n{cache_dir}\n\nFailed to delete {failed} file(s). Check logs.",
            )
            return

        QMessageBox.information(
            self,
            "Cache Cleared",
            f"Deleted {deleted} cache file(s) for:\n\n'{collection_name or 'All Items'}'\n\nCache dir:\n{cache_dir}",
        )

    def show_table_context_menu(self, position):
        """Shows a context menu for the table view (with Zotero push)."""
        menu = QMenu()

        has_selection = bool(self.table_view.selectedIndexes())
        if has_selection:
            copy_cell = QAction("Copy Cell Value", self)
            copy_cell.triggered.connect(self.copy_selected_cell_value)
            menu.addAction(copy_cell)

            copy_row = QAction("Copy Selected Row(s)", self)
            copy_row.triggered.connect(self.copy_selected_rows)
            menu.addAction(copy_row)

            add_to_zot = QAction("Add selected to new Zotero collection…", self)
            add_to_zot.triggered.connect(self.add_selected_to_new_collection)
            add_to_zot.setEnabled(self.zotero_client is not None)
            menu.addAction(add_to_zot)

        # NEW: push NA items for the most-missing coding column
        add_na_auto = QAction("Add NA items (most-missing) to Zotero…", self)
        add_na_auto.triggered.connect(self.add_most_missing_na_to_collection)
        add_na_auto.setEnabled(self.zotero_client is not None and bool(getattr(self, "_last_missing_context", None)))
        menu.addAction(add_na_auto)

        export_table = QAction("Export Displayed Data to CSV", self)
        export_table.triggered.connect(self.export_displayed_table_to_csv)
        menu.addAction(export_table)

        menu.exec(self.table_view.viewport().mapToGlobal(position))

    def add_most_missing_na_to_collection(self):
        """
        Take the cached NA keys for the most-missing coding column and push them
        to a subcollection '<parent>_NA' under a top-level collection chosen by the user.
        Uses zotero_client.find_or_create_top_collection / find_or_create_subcollection / add_items_to_collection.
        """
        try:
            if not getattr(self, "zotero_client", None):
                QMessageBox.warning(self, "Zotero not configured", "No Zotero client set on this widget.")
                return

            ctx = getattr(self, "_last_missing_context", None)
            if not ctx or not ctx.get("keys"):
                QMessageBox.information(self, "Nothing to add", "No cached NA items for the most-missing column.")
                return

            # Ask for the PARENT collection name (seed from input box if present)
            default_parent = self.zotero_collection_input.text().strip() if hasattr(self,
                                                                                    "zotero_collection_input") else ""
            parent_name, ok = QInputDialog.getText(self, "Zotero Collection", "Top collection name:",
                                                   text=default_parent)
            if not ok or not parent_name.strip():
                return
            parent_name = parent_name.strip()

            # 1) Ensure/fetch the TOP collection key
            parent_key = self.zotero_client.find_or_create_top_collection(parent_name)
            if not parent_key:
                QMessageBox.critical(self, "Error", f"Failed to find/create top collection '{parent_name}'.")
                return

            # 2) Ensure/fetch the '<parent>_NA' subcollection key
            sub_name = f"00_{parent_name}_NA"
            na_key = self.zotero_client.find_or_create_subcollection(parent_key=parent_key, subcoll_name=sub_name)
            if not na_key:
                QMessageBox.critical(self, "Error", f"Failed to find/create subcollection '{sub_name}'.")
                return

            # 3) Add items
            item_keys = list(dict.fromkeys([str(k) for k in ctx["keys"] if str(k).strip()]))  # unique, non-empty
            if not item_keys:
                QMessageBox.information(self, "Nothing to add", "No valid item keys found in the cached context.")
                return

            self.zotero_client.add_items_to_collection(collection_key=na_key, items_keys=item_keys)

            QMessageBox.information(
                self,
                "Done",
                f"Added {len(item_keys)} item(s) to '{parent_name}' → '{sub_name}'."
            )
            logging.info(
                "Added %d items to Zotero collection '%s' → '%s' (%s). Column='%s'",
                len(item_keys), parent_name, sub_name, na_key, ctx.get("column")
            )

        except Exception as e:
            logging.exception("add_most_missing_na_to_collection failed: %s", e)
            QMessageBox.critical(self, "Error", f"Failed to add items to collection: {e}")

    def add_selected_to_new_collection(self):
        """
        Create/find a TOP collection, then create an '_NA' subcollection under it,
        and add the SELECTED table items (by 'key') to that subcollection using the zotero_client wrapper.
        Flow:
          parent_key = self.zotero_client.find_or_create_top_collection(parent_name)
          na_key     = self.zotero_client.find_or_create_subcollection(parent_key=parent_key,
                                                                       subcoll_name=f"{parent_name}_NA")
          self.zotero_client.add_items_to_collection(collection_key=na_key, items_keys=item_keys)
        """
        try:
            if not getattr(self, "zotero_client", None):
                QMessageBox.warning(self, "Zotero not configured", "No Zotero client set on this widget.")
                return

            model = self.table_view.model()
            if model is None or not hasattr(model, "get_dataframe"):
                QMessageBox.warning(self, "No data", "No table model with data is available.")
                return

            df = model.get_dataframe()
            if "key" not in df.columns:
                QMessageBox.warning(self, "Missing column", "The table has no 'key' column to identify Zotero items.")
                return

            # Selected rows → item keys
            rows = sorted({idx.row() for idx in self.table_view.selectedIndexes()})
            if not rows:
                QMessageBox.information(self, "Nothing selected", "Please select one or more rows first.")
                return
            item_keys = df.iloc[rows]["key"].astype(str).dropna().unique().tolist()
            if not item_keys:
                QMessageBox.information(self, "No keys", "Selected rows do not contain valid item keys.")
                return

            # Ask for the PARENT collection name (seed from input box if present)
            default_parent = self.zotero_collection_input.text().strip() if hasattr(self,
                                                                                    "zotero_collection_input") else ""
            parent_name, ok = QInputDialog.getText(self, "Zotero Collection", "Top collection name:",
                                                   text=default_parent)
            if not ok or not parent_name.strip():
                return
            parent_name = parent_name.strip()

            # 1) Ensure/fetch the TOP collection key
            parent_key = self.zotero_client.find_or_create_top_collection(parent_name)
            if not parent_key:
                QMessageBox.critical(self, "Error", f"Failed to find/create top collection '{parent_name}'.")
                return

            # 2) Build the NA subcollection name and ensure it exists
            sub_name = f"{parent_name}_NA"
            na_key = self.zotero_client.find_or_create_subcollection(parent_key=parent_key, subcoll_name=sub_name)
            if not na_key:
                QMessageBox.critical(self, "Error", f"Failed to find/create subcollection '{sub_name}'.")
                return

            # 3) Add items
            self.zotero_client.add_items_to_collection(collection_key=na_key, items_keys=item_keys)

            QMessageBox.information(self, "Done", f"Added {len(item_keys)} item(s) to '{parent_name}' → '{sub_name}'.")
            logging.info("Added %d items to Zotero collection '%s' → '%s' (%s): %s",
                         len(item_keys), parent_name, sub_name, na_key, ", ".join(item_keys))
        except Exception as e:
            logging.exception("add_selected_to_new_collection failed: %s", e)
            QMessageBox.critical(self, "Error", f"Failed to add items to collection: {e}")

    def copy_selected_cell_value(self):
        """Copies the value of the currently selected cell to the clipboard."""
        if self.table_view.selectedIndexes(): QApplication.clipboard().setText(
            self.table_view.selectedIndexes()[0].data())

    def copy_selected_rows(self):
        """Copies the selected rows (as tab-separated values) to the clipboard."""
        if not self.table_view.selectedIndexes() or self.model is None: return
        model = self.table_view.model()
        if not hasattr(model, 'get_dataframe'): return

        selected_rows = sorted(list(set(index.row() for index in self.table_view.selectedIndexes())))
        rows_data_df = model.get_dataframe().iloc[selected_rows]
        QApplication.clipboard().setText(rows_data_df.to_csv(index=False, sep='\t'))

    def export_displayed_table_to_csv(self):
        """Exports the data currently visible in the table to a CSV file."""
        model = self.table_view.model()
        if model is None or not hasattr(model, 'get_dataframe') or model.get_dataframe().empty:
            QMessageBox.information(self, "Export Error", "No data to export.")
            return

        displayed_df = model.get_dataframe()
        default_filename = "data_export.csv"
        file_path, _ = QFileDialog.getSaveFileName(self, "Save Displayed Table Data", default_filename,
                                                   "CSV Files (*.csv)")
        if file_path:
            try:
                displayed_df.to_csv(file_path, index=False)
                QMessageBox.information(self, "Export Successful", f"Table data saved to {file_path}")
            except Exception as e:
                QMessageBox.critical(self, "Export Failed", f"Could not save data: {e}")