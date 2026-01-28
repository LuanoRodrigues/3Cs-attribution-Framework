# bibliometric_analysis_tool/ui/data_loader_widget.py
from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QGroupBox, QLabel,
                             QLineEdit, QPushButton, QFileDialog, QMessageBox,
                             QHBoxLayout, QFormLayout, QSizePolicy, QProgressBar)  # Added QProgressBar
from PyQt6.QtCore import pyqtSignal, QThread, QObject, Qt  # Added QThread, QObject
from pathlib import Path
import pandas as pd

from bibliometric_analysis_tool.core.common_styles import COMMON_QSS, ThemeManager
from bibliometric_analysis_tool.utils.Zotero_loader_to_df import load_data_from_source_for_widget
from bibliometric_analysis_tool.utils.data_processing import zot


# Import the actual data loading function



# --- Worker for Data Loading ---
class DataLoaderWorker(QObject):
    finished = pyqtSignal(object, str)  # Emits DataFrame (or None on error) and source_description
    progress = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(self, source_type, file_path=None, collection_name=None, zotero_client=None, cache_config=None):
        super().__init__()
        self.source_type = source_type
        self.file_path = file_path
        self.collection_name = collection_name
        self.zotero_client = zot
        self.cache_config = cache_config

    def run(self):
        try:
            self.progress.emit(f"Starting data load from {self.source_type}...")
            # Call the actual loading function from data_processing.py
            df = load_data_from_source_for_widget(
                source_type=self.source_type,
                file_path=self.file_path,
                collection_name=self.collection_name,
                progress_callback=self.progress.emit,
                # zotero_client=zot# Pass the progress signal's emit method
            )

            if df is not None:
                source_desc = ""
                if self.source_type == "zotero":
                    collection_display_name = f"collection '{self.collection_name}'" if self.collection_name else "entire library"
                    source_desc = f"Zotero: {collection_display_name}"
                elif self.source_type == "file" and self.file_path:
                    source_desc = f"File: {Path(self.file_path).name}"

                if not df.empty:
                    self.progress.emit(f"Successfully loaded {len(df)} items from {source_desc}.")
                else:
                    self.progress.emit(f"Load complete from {source_desc}, but no data items found/processed.")
                self.finished.emit(df, source_desc)
            else:
                self.error.emit(f"Failed to load data from {self.source_type}.")
                self.finished.emit(None, "Load Error")  # Emit None for DataFrame on error

        except Exception as e:
            error_msg = f"Critical error during data loading ({self.source_type}): {e}"
            self.progress.emit(error_msg)  # Also send to progress for immediate UI update
            self.error.emit(error_msg)
            self.finished.emit(None, "Critical Load Error")


class DataLoaderWidget(QWidget):
    data_loaded = pyqtSignal(pd.DataFrame, list, str)
    status_updated = pyqtSignal(str, int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.current_data_file_path = None
        self.current_zotero_collection_name = None
        self.worker_thread = None  # To hold the QThread instance
        self.data_loader_worker = None  # To hold the worker instance

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(12, 10, 12, 10)
        zotero_group = QGroupBox("Load from Zotero")

        zotero_group.setObjectName("panelGroup")
        zotero_form_layout = QFormLayout()
        zotero_form_layout.setHorizontalSpacing(14)
        zotero_form_layout.setVerticalSpacing(10)
        zotero_form_layout.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self.zotero_collection_input = QLineEdit()
        self.zotero_collection_input.setObjectName("collectionInput")
        self.zotero_collection_input.setPlaceholderText("Collection name (blank for entire library)")
        self.zotero_collection_input.setText("cyber attribution refined")  # Your default
        self.zotero_collection_input.setMaximumWidth(420)
        self.zotero_collection_input.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Fixed)
        zotero_form_layout.addRow(QLabel("Zotero Collection:"), self.zotero_collection_input)

        self.load_zotero_btn = QPushButton("Load from Zotero")
        self.load_zotero_btn.setObjectName("primaryButton")
        self.load_zotero_btn.setMinimumHeight(34)
        self.load_zotero_btn.clicked.connect(self._trigger_zotero_load)

        zotero_button_layout = QHBoxLayout()
        zotero_button_layout.setContentsMargins(0, 4, 0, 0)
        zotero_button_layout.setSpacing(10)
        zotero_button_layout.addStretch(1)
        zotero_button_layout.addWidget(self.load_zotero_btn)
        zotero_form_layout.addRow(zotero_button_layout)

        zotero_group.setLayout(zotero_form_layout)
        main_layout.addWidget(zotero_group)

        file_group = QGroupBox("Load from File")
        file_group.setObjectName("panelGroup")
        file_layout = QVBoxLayout()
        file_layout.setSpacing(10)
        self.load_file_btn = QPushButton("Select and Load File (.csv, .xlsx)")
        self.load_file_btn.setObjectName("secondaryButton")
        self.load_file_btn.setMinimumHeight(34)
        self.load_file_btn.clicked.connect(self._trigger_file_load)
        file_layout.addWidget(self.load_file_btn)
        file_group.setLayout(file_layout)
        main_layout.addWidget(file_group)

        # --- Progress Bar and Status ---
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)  # Initially hidden
        self.progress_bar.setRange(0, 0)  # Indeterminate
        main_layout.addWidget(self.progress_bar)

        self.status_label = QLabel("No data loaded.")
        self.status_label.setObjectName("statusLabel")
        main_layout.addWidget(self.status_label)

        main_layout.addStretch(1)
        self.setLayout(main_layout)

        # Assign a root id for optional scoping and apply common styles
        self.setObjectName("DataLoaderWidget")
        self._apply_styles()

    def _apply_styles(self):
        """
        ###1. app theme
        Apply a single app-wide palette + QSS. Safe if called multiple times.
        """
        ThemeManager.apply(theme="dark", accent="#5B9BFF", radius=10)
    def _set_loading_state(self, loading: bool):
        """Enable/disable UI elements during loading."""
        self.load_zotero_btn.setEnabled(not loading)
        self.load_file_btn.setEnabled(not loading)
        self.zotero_collection_input.setEnabled(not loading)
        self.progress_bar.setVisible(loading)

    def _handle_worker_progress(self, message: str):
        self.status_label.setText(message)
        self.status_updated.emit(message)  # Forward to main window status bar if needed

    def _handle_worker_error(self, error_message: str):
        self._set_loading_state(False)
        QMessageBox.critical(self, "Data Loading Error", error_message)
        self.status_label.setText(f"Error: {error_message}")

    def _handle_worker_finished(self, df: pd.DataFrame | None, source_description: str):
        self._set_loading_state(False)
        if df is not None:
            if not df.empty:
                self.data_loaded.emit(df, source_description)
                self.status_label.setText(f"Data loaded from {source_description} ({len(df)} rows).")
            else:
                self.status_label.setText(f"Load from {source_description} resulted in empty dataset.")
                QMessageBox.information(self, "Load Note",
                                        f"No data items were found or processed from {source_description}.")
        else:
            # Error message should have been shown by _handle_worker_error
            self.status_label.setText(f"Failed to load data. Check logs for details ({source_description}).")

        # Clean up thread and worker
        if self.worker_thread:
            self.worker_thread.quit()
            self.worker_thread.wait()
            self.worker_thread.deleteLater()  # Schedule for deletion
            self.data_loader_worker.deleteLater()
            self.worker_thread = None
            self.data_loader_worker = None

    def _start_loading_task(self, source_type: str, file_path: str | None = None, collection_name: str | None = None):
        if self.worker_thread and self.worker_thread.isRunning():
            QMessageBox.warning(self, "Busy", "A data loading process is already running.")
            return

        self._set_loading_state(True)
        self.status_label.setText(f"Preparing to load from {source_type}...")

        self.worker_thread = QThread()
        self.data_loader_worker = DataLoaderWorker(source_type=source_type, file_path=file_path, collection_name=collection_name,zotero_client=zot)
        self.data_loader_worker.moveToThread(self.worker_thread)

        # Connect signals from worker to slots in this widget
        self.data_loader_worker.finished.connect(self._handle_worker_finished)
        self.data_loader_worker.progress.connect(self._handle_worker_progress)
        self.data_loader_worker.error.connect(self._handle_worker_error)

        # Connect thread's started signal to worker's run method
        self.worker_thread.started.connect(self.data_loader_worker.run)

        # Clean up worker and thread once finished (important)
        # self.worker_thread.finished.connect(self.data_loader_worker.deleteLater) # Moved to _handle_worker_finished for more control
        # self.worker_thread.finished.connect(self.worker_thread.deleteLater)

        self.worker_thread.start()

    def _trigger_zotero_load(self):
        self.current_zotero_collection_name = self.zotero_collection_input.text().strip()
        self._start_loading_task(
            source_type="zotero",
            collection_name=self.current_zotero_collection_name
        )

    def _trigger_file_load(self):
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Open Bibliographic Data File", "",
            "Data Files (*.csv *.xlsx *.xls);;CSV Files (*.csv);;Excel Files (*.xlsx *.xls);;All Files (*)"
        )
        if file_path:
            self.current_data_file_path = file_path
            self._start_loading_task(
                source_type="file",
                file_path=self.current_data_file_path
            )
        else:
            self.status_label.setText("File loading cancelled.")
            self.status_updated.emit("File loading cancelled.")

    def stop_loading_process(self):  # If you add a cancel button
        if self.worker_thread and self.worker_thread.isRunning():
            self.status_label.setText("Attempting to stop loading process...")
            self.worker_thread.quit()  # Request thread to stop
            self.worker_thread.wait(3000)  # Wait up to 3 seconds
            if self.worker_thread.isRunning():  # If still running, terminate (less graceful)
                self.worker_thread.terminate()
                self.worker_thread.wait()
            self._set_loading_state(False)
            self.status_label.setText("Loading process stopped by user.")
            self.worker_thread = None
            self.data_loader_worker = None