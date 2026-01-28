import pandas as pd
import numpy as np
from PyQt6.QtCore import (QAbstractTableModel, Qt, QModelIndex, QSize)
from PyQt6.QtGui import (QColor, QBrush, QPen, QFont)
from PyQt6.QtWidgets import (QStyledItemDelegate, QStyleOptionViewItem, QStyle)

from ..core.app_constants import THEME


# ──────────────────────────────────────────────────────────────────────────────
#  DATA MODEL
# ──────────────────────────────────────────────────────────────────────────────
class PandasTableModel(QAbstractTableModel):
    """Editable Qt model backed by a Pandas DataFrame."""

    def __init__(self, data: pd.DataFrame, parent=None):
        super().__init__(parent)
        self._data = data.copy()
        # convenience for views/proxies that need the current df

    def get_dataframe(self) -> pd.DataFrame:
        try:
            return self._data
        except Exception:
            import pandas as _pd
            return _pd.DataFrame()
    # ------------- basic shape -------------------------------------------------
    def rowCount(self, parent=QModelIndex()) -> int:
        return self._data.shape[0]

    def columnCount(self, parent=QModelIndex()) -> int:
        return self._data.shape[1]

    # ------------- data retrieval ---------------------------------------------
    def data(self, index: QModelIndex, role: int = Qt.ItemDataRole.DisplayRole):
        if not index.isValid():
            return None

        value = self._data.iat[index.row(), index.column()]

        def _stringify(v) -> str:
            # Handle common sequence types by joining non-empty stringified parts
            if isinstance(v, (list, np.ndarray, pd.Series, pd.Index)):
                parts = []
                for x in list(v):
                    try:
                        if pd.isna(x):
                            continue
                    except Exception:
                        pass
                    sx = str(x).strip()
                    if sx and sx.lower() not in ("nan", "<na>"):
                        parts.append(sx)
                return "; ".join(parts)
            # Dicts: fall back to JSON if possible for readability
            if isinstance(v, dict):
                try:
                    import json as _json
                    return _json.dumps(v, ensure_ascii=False, sort_keys=True)
                except Exception:
                    return str(v)
            # Scalars: safe NaN/NA/None handling
            try:
                if pd.isna(v):
                    return ""
            except Exception:
                pass
            if v is None:
                return ""
            sv = str(v).strip()
            return "" if sv.lower() in ("nan", "<na>") else sv

        if role in (Qt.ItemDataRole.DisplayRole, Qt.ItemDataRole.EditRole):
            return _stringify(value)

            # Sort key (numeric/date-aware) ----------------------------------------
        if role == Qt.ItemDataRole.UserRole:
            try:
                col = index.column()
                dtype = self._data.dtypes[col]
            except Exception:
                dtype = None

            # normalise NAs early
            try:
                is_missing = pd.isna(value)
            except Exception:
                is_missing = value is None

            # numbers
            try:
                if dtype is not None and pd.api.types.is_numeric_dtype(dtype):
                    v = pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]
                    return (True, 0.0) if pd.isna(v) else (False, float(v))
            except Exception:
                pass

            # datetimes
            try:
                if dtype is not None and pd.api.types.is_datetime64_any_dtype(dtype):
                    ts = pd.to_datetime(value, errors="coerce")
                    # tuples guarantee consistent ordering with NAs last
                    return (True, pd.Timestamp.min) if pd.isna(ts) else (False, pd.Timestamp(ts))
            except Exception:
                pass

            # strings (case-insensitive, stripped)
            try:
                s = "" if is_missing else str(value).strip().lower()
                return (s == "", s)
            except Exception:
                return (True, "")

            # Background for zebra-striping ----------------------------------------
        if role == Qt.ItemDataRole.BackgroundRole:
            base = QColor(THEME.get("BACKGROUND_CONTENT_AREA", "#2b2b2b"))
            alt = base.lighter(110)
            return QBrush(alt if index.row() % 2 else base)

            # Tooltip with full text ------------------------------------------------
        if role == Qt.ItemDataRole.ToolTipRole:
            return _stringify(value)

        return None

    # ------------- editing -----------------------------------------------------
    def _coerce_for_column(self, col_idx: int, value):
        """
        Coerce an incoming editor value to the column's dtype, handling pandas nullable dtypes.
        Rules:
          • empty string / whitespace -> pd.NA
          • Int64 (nullable int): allow int or numeric string; else pd.NA
          • Float64: numeric or pd.NA
          • boolean / boolean[pyarrow]: accept truthy strings
          • datetime64[ns]: try pandas to_datetime (errors='coerce')
          • everything else -> str(value)
        """
        import pandas as _pd
        import numpy as _np

        # Normalize editor value
        if value is None:
            return _pd.NA

        if isinstance(value, str):
            s = value.strip()
            if s == "" or s.lower() in {"na", "nan", "<na>", "none", "null"}:
                return _pd.NA
        else:
            s = value

        dtype = self._data.dtypes[col_idx]

        # Nullable integer (e.g., Int64, Int32, etc.)
        if _pd.api.types.is_integer_dtype(dtype) and getattr(dtype, "name", "").startswith("Int"):
            try:
                # accept numeric strings / floats cleanly
                v = _pd.to_numeric(_pd.Series([s]), errors="coerce").iloc[0]
                if _pd.isna(v):
                    return _pd.NA
                return int(v)
            except Exception:
                return _pd.NA

        # Float dtypes
        if _pd.api.types.is_float_dtype(dtype):
            v = _pd.to_numeric(_pd.Series([s]), errors="coerce").iloc[0]
            return _pd.NA if _pd.isna(v) else float(v)

        # Boolean (including nullable BooleanDtype)
        if _pd.api.types.is_bool_dtype(dtype):
            if isinstance(s, str):
                sl = s.lower()
                if sl in {"true", "t", "yes", "y", "1"}:
                    return True
                if sl in {"false", "f", "no", "n", "0"}:
                    return False
                return _pd.NA
            return bool(s)

        # Datetime
        if _pd.api.types.is_datetime64_any_dtype(dtype):
            try:
                ts = _pd.to_datetime(s, errors="coerce")
                return _pd.NaT if _pd.isna(ts) else ts
            except Exception:
                return _pd.NaT

        # Everything else becomes a clean string (but keep NA if appropriate)
        if isinstance(s, str):
            return s
        try:
            return str(s)
        except Exception:
            return s

    def setData(self, index: QModelIndex, value, role: int = Qt.ItemDataRole.EditRole):
        if role == Qt.ItemDataRole.EditRole and index.isValid():
            try:
                col = index.column()
                coerced = self._coerce_for_column(col, value)
                self._data.iat[index.row(), col] = coerced
                self.dataChanged.emit(index, index, [role])
                return True
            except Exception as e:
                # As a last resort, store as string to avoid UI crash (you can log this if you like)
                try:
                    self._data.iat[index.row(), index.column()] = "" if value is None else str(value)
                    self.dataChanged.emit(index, index, [role])
                    return True
                except Exception:
                    return False
        return False

    def flags(self, index: QModelIndex) -> Qt.ItemFlag:
        base = Qt.ItemFlag.ItemIsSelectable | Qt.ItemFlag.ItemIsEnabled
        return base | Qt.ItemFlag.ItemIsEditable
    # ------------- headers -----------------------------------------------------
    def headerData(self, section: int, orientation: Qt.Orientation, role: int = Qt.ItemDataRole.DisplayRole):
        if orientation == Qt.Orientation.Horizontal:
            if role == Qt.ItemDataRole.DisplayRole:
                return str(self._data.columns[section])
            if role == Qt.ItemDataRole.FontRole:
                font = QFont(); font.setBold(True); return font
            if role == Qt.ItemDataRole.TextAlignmentRole:
                return Qt.AlignmentFlag.AlignCenter
            if role == Qt.ItemDataRole.ForegroundRole:
                return QBrush(QColor(THEME.get("TEXT_PRIMARY", "#fafafa")))
        else:  # Vertical index
            if role == Qt.ItemDataRole.DisplayRole:
                return str(section + 1)
            if role == Qt.ItemDataRole.TextAlignmentRole:
                return Qt.AlignmentFlag.AlignCenter
        return None

    # ------------- helper ------------------------------------------------------
    def get_dataframe(self) -> pd.DataFrame:
        return self._data.copy()


# ──────────────────────────────────────────────────────────────────────────────
#  DELEGATE (custom painting + interactivity)
# ──────────────────────────────────────────────────────────────────────────────
class HighlightDelegate(QStyledItemDelegate):
    """Spreadsheet-like editing: proper editors, no over-paint while editing, compact rows."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.missing_bg = QColor("#FF6B6B").lighter(120)   # pleasant red
        self.missing_fg = QColor("#ffffff")
        self.hover_bg   = QColor("#3a3d44")                # dark hover
        self.zebra_alt  = QColor("#2e3036")                # subtle zebra
        self.sel_bg = QColor(THEME.get("ACCENT_PRIMARY", "#5B9BFF"))

    # Editors -----------------------------------------------------------------
    def createEditor(self, parent, option, index):
        """Choose a sensible editor by dtype/column name; make it fill the cell."""
        from PyQt6.QtWidgets import (QLineEdit, QPlainTextEdit, QComboBox, QSpinBox, QDoubleSpinBox)
        import pandas as _pd

        # Read dtype from model's DataFrame if available
        model = index.model()
        dtype = None
        try:
            if hasattr(model, "_data") and isinstance(model._data, _pd.DataFrame):
                dtype = model._data.dtypes[index.column()]
        except Exception:
            pass

        col_name = ""
        try:
            if hasattr(model, "_data"):
                col_name = str(model._data.columns[index.column()])
        except Exception:
            pass

        # Long-text / abstract-like columns -> multiline editor
        long_text_cols = {"abstract", "user_notes", "notes", "comment", "comments", "summary"}
        if col_name.lower() in long_text_cols:
            ed = QPlainTextEdit(parent)
            ed.setTabChangesFocus(True)
            ed.setWordWrapMode(3)  # QTextOption.WrapAtWordBoundaryOrAnywhere
            ed.setMinimumHeight(max(60, option.rect.height()))
            ed.setContentsMargins(0, 0, 0, 0)
            return ed

        # Numeric editors
        if dtype is not None:
            name = getattr(dtype, "name", "").lower()
            if name.startswith("int"):  # pandas nullable Int64/Int32 etc. still shows 'Int64'
                sb = QSpinBox(parent)
                sb.setRange(-2_147_483_648, 2_147_483_647)
                sb.setAccelerated(True)
                sb.setButtonSymbols(sb.ButtonSymbols.NoButtons)
                sb.setMinimumHeight(max(26, option.rect.height() - 2))
                return sb
            if "float" in name:
                dsb = QDoubleSpinBox(parent)
                dsb.setRange(-1e12, 1e12)
                dsb.setDecimals(6)
                dsb.setAccelerated(True)
                dsb.setButtonSymbols(dsb.ButtonSymbols.NoButtons)
                dsb.setMinimumHeight(max(26, option.rect.height() - 2))
                return dsb
            if "bool" in name:
                cb = QComboBox(parent)
                cb.addItems(["", "True", "False"])
                cb.setMinimumHeight(max(26, option.rect.height() - 2))
                return cb
            if "datetime" in name:
                # keep it simple: free text; model coercion handles parsing
                pass

        # Fallback: wide single-line editor
        le = QLineEdit(parent)
        le.setMinimumHeight(max(26, option.rect.height() - 2))
        le.setContentsMargins(0, 0, 0, 0)
        return le

    def setEditorData(self, editor, index):
        """Populate editor with model value (human-friendly)."""
        from PyQt6.QtWidgets import QLineEdit, QPlainTextEdit, QComboBox, QSpinBox, QDoubleSpinBox
        val = index.data(Qt.ItemDataRole.EditRole)
        sval = "" if val is None else str(val)

        if isinstance(editor, QPlainTextEdit):
            editor.setPlainText(sval)
        elif isinstance(editor, QLineEdit):
            editor.setText(sval)
            editor.selectAll()
        elif isinstance(editor, QComboBox):
            # map truthy/falsy strings
            sval = sval.strip().lower()
            if sval in {"true", "t", "1", "yes", "y"}:
                editor.setCurrentText("True")
            elif sval in {"false", "f", "0", "no", "n"}:
                editor.setCurrentText("False")
            else:
                editor.setCurrentText("")
        elif isinstance(editor, QSpinBox):
            try:
                editor.setValue(int(float(sval))) if sval != "" else None
            except Exception:
                pass
        elif isinstance(editor, QDoubleSpinBox):
            try:
                editor.setValue(float(sval)) if sval != "" else None
            except Exception:
                pass

    def setModelData(self, editor, model, index):
        """Extract editor value and push back to model (model does final coercion)."""
        from PyQt6.QtWidgets import QLineEdit, QPlainTextEdit, QComboBox, QSpinBox, QDoubleSpinBox
        if isinstance(editor, QPlainTextEdit):
            model.setData(index, editor.toPlainText(), Qt.ItemDataRole.EditRole)
        elif isinstance(editor, QLineEdit):
            model.setData(index, editor.text(), Qt.ItemDataRole.EditRole)
        elif isinstance(editor, QComboBox):
            model.setData(index, editor.currentText(), Qt.ItemDataRole.EditRole)
        elif isinstance(editor, (QSpinBox, QDoubleSpinBox)):
            model.setData(index, editor.text(), Qt.ItemDataRole.EditRole)
        else:
            # fallback
            try:
                model.setData(index, editor.text(), Qt.ItemDataRole.EditRole)
            except Exception:
                pass
