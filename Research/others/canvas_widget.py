# canvaswidget.py

import hashlib
import json
import logging
import re
import uuid
from collections import defaultdict, Counter
from typing import List, Dict, Tuple, Any, Optional

from pathlib import Path

from PyQt6.QtCore import (
    Qt, QPointF, QRectF, pyqtSignal, QTimer, QSizeF, pyqtSlot, QRect, QUrl, QSize, QPoint
)
from PyQt6.QtGui import (
    QColor, QBrush, QPen, QFont, QPainter, QFontMetrics, QPainterPath,
    QMouseEvent, QKeyEvent, QCursor, QImage, QFocusEvent, QWheelEvent, QTextDocument,
    QTextCharFormat, QTextCursor, QShortcut, QKeySequence
)
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QGraphicsView, QGraphicsScene,
    QGraphicsObject, QGraphicsPathItem, QGraphicsItem, QTextBrowser,
    QPushButton, QInputDialog, QMenu, QFileDialog, QColorDialog,
    QApplication, QStyleOptionGraphicsItem, QMessageBox, QTextEdit,
    QLabel, QListWidget, QListWidgetItem, QSplitter, QStyle, QToolTip,
    QGraphicsSceneHoverEvent, QSizePolicy, QGraphicsProxyWidget  # Added QSizePolicy
)

# Assuming rapidfuzz will be available in the environment
from rapidfuzz import fuzz


# --- Placeholder imports for modules/classes that will be in other files ---
# from .keyword_builder import KeywordHierarchyBuilder # Will be in keyword_builder.py
# from .project_reader import ProjectBasedReader # For type hinting, will be in project_reader.py
# from .utils import build_index, clean_canvas # Will be in utils.py

# --- Start: Dummy placeholders for now, to be replaced by actual imports ---
class KeywordHierarchyBuilder:  # Dummy
    def __init__(self, provider): pass

    def build_indexes_from_provider(self): return False

    def get_llm_based_hierarchy(self, max_roots, max_children_per_node): return {"name": "Dummy", "id": "dummy",
                                                                                 "children": []}


class ProjectBasedReader:  # Dummy for type hint
    pass


def build_index(keyword_cache: Dict[str, list]) -> Tuple[
    Dict[str, str], Dict[str, str], Dict[str, int], Dict[str, list]]:  # Dummy
    return {}, {}, {}, defaultdict(list)


def clean_canvas(raw: dict, sim_threshold: int = 92, prefer_keyword_id: bool = True) -> dict:  # Dummy
    return raw


# --- End: Dummy placeholders ---


# --- Cache Directories specific to Canvas or used by it ---
BASE_CACHE_DIR = Path(__file__).parent / ".cache"  # Assume .cache in the same dir as canvaswidget.py
BASE_CACHE_DIR.mkdir(exist_ok=True, parents=True)
MINDMAP_CACHE_DIR = BASE_CACHE_DIR / "mindmap_cache"
MINDMAP_CACHE_DIR.mkdir(exist_ok=True, parents=True)

# --- Configuration & Constants for Canvas ---
NODE_H_PADDING = 12
NODE_V_PADDING = 8
INDICATOR_AREA_WIDTH = 20
CORNER_RADIUS = 6
LEVEL_X_SPACING = 200
NODE_Y_SPACING = 40
INITIAL_X_OFFSET = 60
INITIAL_Y_OFFSET = 60
MAX_INITIAL_ROOT_CHILDREN = 10
MAX_EXPAND_CHILDREN = 10
DEFAULT_NODE_WIDTH = 160
DEFAULT_NODE_HEIGHT = 40
DEFAULT_FONT_SIZE = 10
MIN_FONT_SIZE = 8
MAX_FONT_SIZE = 20
# NORMALISE_RX from utils.py will be used if nodes do internal normalization

# --- Theme Colors (Essential for CanvasNodeItem, AdvancedCanvasWidget) ---
THEME_COLORS = {
    "dark": {
        "canvas_bg": QColor("#202023"), "node_bg": QColor("#3C3C3F"),
        "node_border": QColor("#5A5A5E"), "node_text": QColor(Qt.GlobalColor.white),
        "node_indicator": QColor("#AAAAAA"), "node_expanded_bg": QColor("#4A4A4F"),
        "node_selected_border": QColor(Qt.GlobalColor.cyan), "edge": QColor("#707075"),
        "list_bg": QColor("#2A2A2D"), "list_text": QColor(Qt.GlobalColor.white),
        "list_selected_bg": QColor("#4A4A4F"), "list_item_border": QColor("#404043"),
        "button_bg": QColor("#3C3C3F"), "button_text": QColor(Qt.GlobalColor.white),
        "button_border": QColor("#5A5A5E"), "details_text": QColor("#D0D0D0"),
    },
    "light": {
        "canvas_bg": QColor("#F0F0F0"), "node_bg": QColor("#FFFFFF"),
        "node_border": QColor("#B0B0B0"), "node_text": QColor(Qt.GlobalColor.black),
        "node_indicator": QColor("#555555"), "node_expanded_bg": QColor("#E8E8E8"),
        "node_selected_border": QColor(Qt.GlobalColor.blue), "edge": QColor("#777777"),
        "list_bg": QColor(Qt.GlobalColor.white), "list_text": QColor(Qt.GlobalColor.black),
        "list_selected_bg": QColor("#D0D0FF"), "list_item_border": QColor("#DCDCDC"),
        "button_bg": QColor("#E0E0E0"), "button_text": QColor(Qt.GlobalColor.black),
        "button_border": QColor("#C0C0C0"), "details_text": QColor("#333333"),
    }
}

# --- CSS for QTextBrowser content (e.g., in HoverTextBrowser) ---
# This is a simplified version, focusing on elements HoverTextBrowser might use.
# The full KEYWORD_VIEWER_CSS might be in a constants file or utils if needed elsewhere.
HOVER_BROWSER_CSS = """
<style>
body { margin:0; padding: 2px; /* Minimal body style for snippets */ }
mark { background:#ffe564; color:#000; padding: 1px 3px; border-radius: 3px; }
a { color:#8ab4f8; text-decoration:none; }
a:hover { text-decoration: underline; }
</style>
"""


class HoverTextBrowser(QTextBrowser):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.setMouseTracking(True)
        self.setOpenExternalLinks(True)

    def wheelEvent(self, event: QWheelEvent):
        event.ignore()

    def mouseMoveEvent(self, event: QMouseEvent):
        anchor = self.anchorAt(event.pos())
        if anchor:
            QToolTip.showText(self.mapToGlobal(event.pos()), anchor, self)
        else:
            QToolTip.hideText()
        super().mouseMoveEvent(event)


class CanvasNodeItem(QGraphicsObject):
    node_clicked_signal = pyqtSignal(object)
    node_double_clicked_signal = pyqtSignal(object)
    node_moved_signal = pyqtSignal(object)
    node_selection_changed_signal = pyqtSignal(object, bool)
    node_title_changed_signal = pyqtSignal(object)

    EXPAND_INDICATOR = "▶"
    COLLAPSE_INDICATOR = "▼"

    def __init__(self, title: str = "New Node", x: float = 0, y: float = 0, node_id: str = None,
                 is_keyword_node: bool = False, keyword_data: Optional[Dict] = None, parent_widget=None,
                 initial_font_size: int = DEFAULT_FONT_SIZE, color_override: Optional[QColor] = None,
                 is_synthetic_root: bool = False):
        super().__init__()
        self.id = node_id if node_id else str(uuid.uuid4())
        self.html_title_text = title
        self._plain_title_for_editing = self._html_to_plain(self.html_title_text)
        self.is_keyword_node = is_keyword_node
        self.keyword_data = keyword_data if keyword_data else {}
        self.is_expanded_in_map = False
        self.parent_widget = parent_widget  # Expected to be AdvancedCanvasWidget
        self.child_map_items: List[CanvasNodeItem] = []
        self.parent_map_item: Optional[CanvasNodeItem] = None
        self.edge_to_map_parent: Optional[CanvasConnectionItem] = None
        self.is_synthetic_root = is_synthetic_root
        self.current_font_size = initial_font_size
        self.background_color_override = QColor(color_override) if isinstance(color_override, str) \
            else color_override if isinstance(color_override, QColor) else None

        self.setPos(x, y)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, True)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges, True)
        self.setAcceptHoverEvents(True)
        self.setZValue(1)

        self.font = QFont("Arial", self.current_font_size)
        self.font_metrics = QFontMetrics(self.font)
        self._width = DEFAULT_NODE_WIDTH
        self._height = DEFAULT_NODE_HEIGHT

        self.text_edit_input_widget: Optional[QGraphicsProxyWidget] = None
        self.editor_widget: Optional[QTextEdit] = None
        self._hovered = False
        self.colors = THEME_COLORS["dark"]
        if parent_widget and hasattr(parent_widget, 'colors'):
            self.colors = parent_widget.colors

        self._recalculate_size_from_text()  # Call after all essential members are set
        self.update_tooltip()

    @property
    def title_text(self) -> str:
        return self._plain_title_for_editing

    def _html_to_plain(self, html_content: str) -> str:
        if not html_content: return ""
        doc = QTextDocument()
        doc.setHtml(html_content)
        return doc.toPlainText().strip()

    def update_tooltip(self):
        tt = self.title_text.replace('\n', ' ').strip()
        if self.is_keyword_node and self.keyword_data and not self.is_synthetic_root:
            count = self.keyword_data.get("count", "N/A")
            tt += f' (Mentions: {count})'
        self.setToolTip(tt)

    def _update_font(self):
        self.font.setPointSize(self.current_font_size)
        self.font_metrics = QFontMetrics(self.font)
        self._recalculate_size_from_text()
        if self.scene(): self.scene().update(self.boundingRect().translated(self.pos()))

    def set_font_size(self, size: int):
        new_size = max(MIN_FONT_SIZE, min(MAX_FONT_SIZE, size))
        if self.current_font_size != new_size:
            self.current_font_size = new_size
            self._update_font()
            self.node_title_changed_signal.emit(self)

    def set_background_color(self, color: Optional[QColor] = None):
        if self.background_color_override != color:
            self.background_color_override = color
            self.update()
            self.node_title_changed_signal.emit(self)

    def _recalculate_size_from_text(self):
        self.prepareGeometryChange()
        doc = QTextDocument()
        doc.setDefaultFont(self.font)
        doc.setHtml(self.html_title_text or " ")

        plain_text_equiv = doc.toPlainText()
        lines = plain_text_equiv.split('\n')
        max_text_w = 0
        if not lines or (len(lines) == 1 and not lines[0].strip()):
            max_text_w = self.font_metrics.horizontalAdvance("  ")
        else:
            for line in lines:
                max_text_w = max(max_text_w, self.font_metrics.horizontalAdvance(line))

        show_indicator = self.is_keyword_node and \
                         not self.is_synthetic_root and \
                         (self.is_expanded_in_map or
                          (self.parent_widget and hasattr(self.parent_widget, '_node_has_potential_map_children') and \
                           self.parent_widget._node_has_potential_map_children(self)))

        self._width = max(DEFAULT_NODE_WIDTH / 2,
                          max_text_w + 2 * NODE_H_PADDING + (INDICATOR_AREA_WIDTH if show_indicator else 0))
        text_area_width_for_height_calc = self._width - 2 * NODE_H_PADDING - \
                                          (INDICATOR_AREA_WIDTH if show_indicator else 0)
        doc.setTextWidth(max(1, text_area_width_for_height_calc))
        text_h = doc.size().height()
        self._height = max(DEFAULT_NODE_HEIGHT / 2, text_h + 2 * NODE_V_PADDING)
        self.update()

    def set_title(self, new_html_title: str):
        new_html_title = new_html_title.strip()
        if not new_html_title: new_html_title = " "
        if self.html_title_text != new_html_title:
            self.html_title_text = new_html_title
            self._plain_title_for_editing = self._html_to_plain(self.html_title_text)
            self._recalculate_size_from_text()
            self.update_tooltip()
            self.node_title_changed_signal.emit(self)

    def boundingRect(self) -> QRectF:
        return QRectF(0, 0, self._width, self._height)

    def shape(self) -> QPainterPath:
        path = QPainterPath()
        path.addRoundedRect(self.boundingRect(), CORNER_RADIUS, CORNER_RADIUS)
        return path

    def paint(self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: Optional[QWidget] = None):
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        is_selected = option.state & QStyle.StateFlag.State_Selected
        base_bg_color = self.background_color_override if self.background_color_override else \
            (self.colors["node_expanded_bg"] if self.is_expanded_in_map else self.colors["node_bg"])
        current_bg = base_bg_color.lighter(120) if self._hovered or is_selected else base_bg_color
        painter.setBrush(QBrush(current_bg))
        pen_color = self.colors["node_selected_border"] if is_selected else self.colors["node_border"]
        pen = QPen(pen_color, 1.5)
        painter.setPen(pen)
        painter.drawRoundedRect(self.boundingRect(), CORNER_RADIUS, CORNER_RADIUS)

        show_indicator = self.is_keyword_node and \
                         not self.is_synthetic_root and \
                         (self.is_expanded_in_map or
                          (self.parent_widget and hasattr(self.parent_widget, '_node_has_potential_map_children') and \
                           self.parent_widget._node_has_potential_map_children(self)))

        text_margin_x = NODE_H_PADDING
        indicator_space = INDICATOR_AREA_WIDTH if show_indicator else 0
        text_area_width = self._width - (2 * text_margin_x) - indicator_space
        text_render_rect = QRectF(text_margin_x, NODE_V_PADDING,
                                  max(1, text_area_width),
                                  max(1, self._height - (2 * NODE_V_PADDING)))

        if self.html_title_text and text_render_rect.width() > 0 and text_render_rect.height() > 0:
            painter.save()
            painter.setClipRect(text_render_rect)
            doc = QTextDocument()
            effective_html = f"<div style='color:{self.colors['node_text'].name()};'>{self.html_title_text}</div>"
            doc.setHtml(effective_html)
            doc.setDefaultFont(self.font)
            doc.setTextWidth(text_render_rect.width())
            text_actual_height = doc.size().height()
            y_offset = (text_render_rect.height() - text_actual_height) / 2
            y_offset = max(0, y_offset)
            painter.translate(text_render_rect.topLeft() + QPointF(0, y_offset))
            doc.drawContents(painter)
            painter.restore()

        if show_indicator:
            indicator = self.COLLAPSE_INDICATOR if self.is_expanded_in_map else self.EXPAND_INDICATOR
            indicator_fm = QFontMetrics(self.font)
            indicator_char_width = indicator_fm.horizontalAdvance(indicator)
            indicator_area_x_start = self._width - indicator_space - NODE_H_PADDING / 2
            indicator_x = indicator_area_x_start + (indicator_space - indicator_char_width) / 2
            indicator_y = (self._height - indicator_fm.height()) / 2 + indicator_fm.ascent()
            painter.setPen(self.colors["node_indicator"])
            painter.setFont(self.font)
            painter.drawText(QPointF(indicator_x, indicator_y), indicator)

    def itemChange(self, change: QGraphicsItem.GraphicsItemChange, value: Any) -> Any:
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionHasChanged:
            self.node_moved_signal.emit(self)
        elif change == QGraphicsItem.GraphicsItemChange.ItemSelectedHasChanged:
            self.node_selection_changed_signal.emit(self, bool(value))
        return super().itemChange(change, value)

    def mousePressEvent(self, event: QMouseEvent):
        super().mousePressEvent(event)
        if event.button() == Qt.MouseButton.LeftButton:
            if self.is_keyword_node and not self.is_synthetic_root and \
                    (self.parent_widget and hasattr(self.parent_widget, '_node_has_potential_map_children') and \
                     self.parent_widget._node_has_potential_map_children(self)):
                indicator_rect_local = QRectF(
                    self._width - INDICATOR_AREA_WIDTH - NODE_H_PADDING, 0,
                    INDICATOR_AREA_WIDTH + NODE_H_PADDING, self._height
                )
                if indicator_rect_local.contains(event.pos()):
                    if self.parent_widget and hasattr(self.parent_widget, '_toggle_map_node_expansion'):
                        self.parent_widget._toggle_map_node_expansion(self)
                        event.accept()
                        return
            self.node_clicked_signal.emit(self)

    def mouseDoubleClickEvent(self, event: QMouseEvent):
        if self.is_keyword_node and not self.is_synthetic_root:
            indicator_rect_local = QRectF(
                self._width - INDICATOR_AREA_WIDTH - NODE_H_PADDING, 0,
                INDICATOR_AREA_WIDTH + NODE_H_PADDING, self._height
            )
            if indicator_rect_local.contains(event.pos()):
                event.accept()
                return
        self.node_double_clicked_signal.emit(self)
        event.accept()

    def hoverEnterEvent(self, event: QGraphicsSceneHoverEvent):
        self._hovered = True
        self.update()
        super().hoverEnterEvent(event)

    def hoverLeaveEvent(self, event: QGraphicsSceneHoverEvent):
        self._hovered = False
        self.update()
        super().hoverLeaveEvent(event)

    def start_editing(self, scene: QGraphicsScene):
        if self.text_edit_input_widget or not self.parent_widget: return
        if hasattr(self.parent_widget, '_set_scene_items_enabled_for_editing'):
            self.parent_widget._set_scene_items_enabled_for_editing(self, False)

        self.editor_widget = QTextEdit()
        self.editor_widget.setAcceptRichText(True)
        self.editor_widget.setHtml(self.html_title_text or "")
        self.editor_widget.setFont(self.font)
        editor_palette = self.editor_widget.palette()
        editor_palette.setColor(editor_palette.ColorRole.Text, self.colors["node_text"])
        editor_palette.setColor(editor_palette.ColorRole.Base, self.colors["node_bg"].lighter(110))
        self.editor_widget.setPalette(editor_palette)
        self.editor_widget.setFrameStyle(QTextEdit.Shape.NoFrame)
        self.editor_widget.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.editor_widget.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        show_indicator = self.is_keyword_node and not self.is_synthetic_root and \
                         (self.is_expanded_in_map or (self.parent_widget and hasattr(self.parent_widget,
                                                                                     '_node_has_potential_map_children') and \
                                                      self.parent_widget._node_has_potential_map_children(self)))
        edit_padding = 2
        editor_width = self._width - 2 * NODE_H_PADDING - (
            INDICATOR_AREA_WIDTH if show_indicator else 0) - 2 * edit_padding
        editor_height = self._height - 2 * NODE_V_PADDING - 2 * edit_padding
        self.editor_widget.setFixedSize(max(20, int(editor_width)), max(20, int(editor_height)))

        self.text_edit_input_widget = scene.addWidget(self.editor_widget)
        edit_pos_x = self.scenePos().x() + NODE_H_PADDING + edit_padding
        edit_pos_y = self.scenePos().y() + NODE_V_PADDING + edit_padding
        self.text_edit_input_widget.setPos(edit_pos_x, edit_pos_y)
        self.text_edit_input_widget.setZValue(self.zValue() + 10)
        self.editor_widget.setFocus(Qt.FocusReason.MouseFocusReason)
        self.editor_widget.selectAll()
        self._original_html_title_while_editing = self.html_title_text
        self.editor_widget.focusOutEvent = self._editor_focus_out_event_handler
        self.editor_widget.keyPressEvent = self._editor_key_press_event_handler

    def _editor_focus_out_event_handler(self, event: QFocusEvent):
        if self.editor_widget:
            focused_widget = QApplication.focusWidget()
            if focused_widget is not self.editor_widget and \
                    (not self.text_edit_input_widget or focused_widget is not self.text_edit_input_widget.widget()):
                QTimer.singleShot(0, lambda: self.stop_editing(True) if self.editor_widget else None)
            QTextEdit.focusOutEvent(self.editor_widget, event)

    def _editor_key_press_event_handler(self, event: QKeyEvent):
        if not self.editor_widget:
            if self.parentItem(): super().keyPressEvent(event)
            return
        key = event.key()
        modifiers = event.modifiers()
        if key == Qt.Key.Key_Escape:
            self.stop_editing(False);
            event.accept()
        elif key in (Qt.Key.Key_Return, Qt.Key.Key_Enter) and not (modifiers & Qt.KeyboardModifier.ShiftModifier):
            self.stop_editing(True);
            event.accept()
        elif modifiers == Qt.KeyboardModifier.ControlModifier:
            cursor = self.editor_widget.textCursor()
            fmt = cursor.charFormat()
            if key == Qt.Key.Key_B:
                fmt.setFontWeight(QFont.Weight.Bold if fmt.fontWeight() != QFont.Weight.Bold else QFont.Weight.Normal)
                cursor.mergeCharFormat(fmt);
                self.editor_widget.setCurrentCharFormat(fmt);
                event.accept()
            elif key == Qt.Key.Key_I:
                fmt.setFontItalic(not fmt.fontItalic())
                cursor.mergeCharFormat(fmt);
                self.editor_widget.setCurrentCharFormat(fmt);
                event.accept()
            else:
                QTextEdit.keyPressEvent(self.editor_widget, event)
        else:
            QTextEdit.keyPressEvent(self.editor_widget, event)

    def stop_editing(self, commit_changes: bool = True):
        if not self.text_edit_input_widget or not self.editor_widget: return
        new_html_content = self.editor_widget.toHtml() if commit_changes else self._original_html_title_while_editing
        self.text_edit_input_widget.hide()
        if self.text_edit_input_widget.scene():
            self.text_edit_input_widget.scene().removeItem(self.text_edit_input_widget)
        self.text_edit_input_widget.deleteLater()
        self.editor_widget.deleteLater()
        self.text_edit_input_widget = None;
        self.editor_widget = None

        if commit_changes:
            new_html_content = re.sub(r'^<!DOCTYPE[^>]*>', '', new_html_content,
                                      flags=re.IGNORECASE | re.DOTALL).strip()
            new_html_content = re.sub(r'<meta[^>]*name="qrichtext"[^>]*>', '', new_html_content,
                                      flags=re.IGNORECASE).strip()
            new_html_content = re.sub(r'<style[^>]*>.*?</style>', '', new_html_content,
                                      flags=re.IGNORECASE | re.DOTALL).strip()
            new_html_content = re.sub(r'</?html[^>]*>', '', new_html_content, flags=re.IGNORECASE | re.DOTALL).strip()
            new_html_content = re.sub(r'</?head[^>]*>', '', new_html_content, flags=re.IGNORECASE | re.DOTALL).strip()
            new_html_content = re.sub(r'</?body[^>]*>', '', new_html_content, flags=re.IGNORECASE | re.DOTALL).strip()
            new_html_content = re.sub(
                r'<p style="[^"]*margin-top:0px; margin-bottom:0px; margin-left:0px; margin-right:0px; -qt-block-indent:0; text-indent:0px;?[^"]*">',
                '<p>', new_html_content)
            new_html_content = re.sub(r'<p>\s*</p>', '', new_html_content, flags=re.IGNORECASE | re.DOTALL).strip()
            new_html_content = new_html_content.replace('<p></p>', '').strip()
            self.set_title(new_html_content)
        else:
            self.set_title(self._original_html_title_while_editing)

        if hasattr(self, '_original_html_title_while_editing'):
            delattr(self, '_original_html_title_while_editing')
        self.update()
        if self.parent_widget:
            if hasattr(self.parent_widget, '_set_scene_items_enabled_for_editing'):
                self.parent_widget._set_scene_items_enabled_for_editing(self, True)
            if hasattr(self.parent_widget, '_update_connections_for_node'):
                self.parent_widget._update_connections_for_node(self)
            if hasattr(self.parent_widget, '_fit_view_to_scene_content_if_needed'):
                QTimer.singleShot(0, self.parent_widget._fit_view_to_scene_content_if_needed)
            if self.parent_widget.view:
                self.parent_widget.view.setFocus(Qt.FocusReason.OtherFocusReason)


class CanvasConnectionItem(QGraphicsPathItem):
    def __init__(self, start_node: CanvasNodeItem, end_node: CanvasNodeItem,
                 conn_id: Optional[str] = None, conn_type: str = "manual", parent_widget=None):
        super().__init__()
        self.id = conn_id if conn_id else str(uuid.uuid4())
        self.start_node = start_node
        self.end_node = end_node
        self.type = conn_type
        self.parent_widget = parent_widget
        self.colors = THEME_COLORS["dark"]
        if parent_widget and hasattr(parent_widget, 'colors'):
            self.colors = parent_widget.colors
        self.setPen(QPen(self.colors["edge"], 1.5))
        self.setZValue(0)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, True)
        self.update_path()

    def update_path(self):
        if not self.start_node or not self.end_node or \
                not self.start_node.scene() or not self.end_node.scene():
            if self.scene(): self.scene().removeItem(self)
            return
        p1_offset = QPointF(self.start_node.boundingRect().width(), self.start_node.boundingRect().height() / 2)
        p2_offset = QPointF(0, self.end_node.boundingRect().height() / 2)
        p1 = self.start_node.mapToScene(p1_offset)
        p2 = self.end_node.mapToScene(p2_offset)
        path = QPainterPath()
        path.moveTo(p1)
        dx = abs(p2.x() - p1.x()) * 0.5
        path.cubicTo(p1.x() + dx, p1.y(), p2.x() - dx, p2.y(), p2.x(), p2.y())
        self.setPath(path)

    def paint(self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: Optional[QWidget] = None):
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        pen = self.pen()
        if option.state & QStyle.StateFlag.State_Selected:
            pen.setColor(self.colors["node_selected_border"])
            pen.setWidthF(2.5)
        else:
            pen.setColor(self.colors["edge"])
            pen.setWidthF(1.5)
        painter.setPen(pen)
        painter.drawPath(self.path())


class AdvancedCanvasWidget(QWidget):
    canvas_changed_signal = pyqtSignal()
    open_source_in_reader_requested = pyqtSignal(str, str, str)  # filename, para_id, item_key

    def __init__(self, parent: Optional[QWidget] = None, project_reader: Optional[ProjectBasedReader] = None):
        super().__init__(parent)
        self.setObjectName("AdvancedCanvasWidget")
        self.nodes: Dict[str, CanvasNodeItem] = {}
        self.connections: Dict[str, CanvasConnectionItem] = {}
        self.keyword_map_root_node_id: Optional[str] = None

        self.project_reader = project_reader  # Store reference if provided
        self.keyword_cache_data: defaultdict[str, list] = defaultdict(list)
        self.project_keyword_counts_data: Counter = Counter()

        self.current_theme_key = "dark"
        self.colors = THEME_COLORS[self.current_theme_key]

        self._init_ui()
        self._connect_signals()
        self.apply_theme(self.current_theme_key)
        self._init_shortcuts()

        if self.project_reader:
            self.load_keyword_data_from_reader()
            # QTimer.singleShot(100, lambda: self.generate_initial_mindmap(use_llm=True)) # Auto-generate

    def _init_ui(self):
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(2, 2, 2, 2)
        main_layout.setSpacing(5)

        canvas_area_widget = QWidget()
        canvas_layout = QVBoxLayout(canvas_area_widget)
        canvas_layout.setContentsMargins(0, 0, 0, 0)
        canvas_layout.setSpacing(3)

        toolbar_widget = QWidget()
        toolbar_widget.setObjectName("CanvasToolbar")
        toolbar_layout = QHBoxLayout(toolbar_widget)
        toolbar_layout.setContentsMargins(5, 3, 5, 3)
        toolbar_layout.setSpacing(5)
        self.btn_add_node = QPushButton("Add Node")
        self.btn_connect_nodes = QPushButton("Connect (2)")
        self.btn_delete_selected = QPushButton("Delete")
        self.btn_toggle_theme = QPushButton("Toggle Theme")
        self.btn_regen_map = QPushButton("Regen Map (LLM)")
        toolbar_layout.addWidget(self.btn_add_node)
        toolbar_layout.addWidget(self.btn_connect_nodes)
        toolbar_layout.addWidget(self.btn_delete_selected)
        toolbar_layout.addWidget(self.btn_toggle_theme)
        toolbar_layout.addWidget(self.btn_regen_map)
        toolbar_layout.addStretch(1)
        self.btn_export_image = QPushButton("Export Image...")
        self.btn_save_canvas = QPushButton("Save Canvas...")
        self.btn_load_canvas = QPushButton("Load Canvas...")
        toolbar_layout.addWidget(self.btn_export_image)
        toolbar_layout.addWidget(self.btn_save_canvas)
        toolbar_layout.addWidget(self.btn_load_canvas)
        canvas_layout.addWidget(toolbar_widget)

        self.scene = QGraphicsScene(self)
        self.view = QGraphicsView(self.scene)
        self.view.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.view.setDragMode(QGraphicsView.DragMode.RubberBandDrag)
        self.view.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.view.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorViewCenter)
        self.view.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        canvas_layout.addWidget(self.view)
        self.setup_view_interaction()

        self.right_panel_widget = QWidget()
        self.right_panel_widget.setMinimumWidth(300)
        self.right_panel_widget.setMaximumWidth(500)
        right_panel_layout = QVBoxLayout(self.right_panel_widget)
        right_panel_layout.setContentsMargins(8, 8, 8, 8)
        right_panel_layout.setSpacing(6)
        self.selected_node_details_label = QLabel("Node Details")
        self.selected_node_details_label.setStyleSheet("font-weight: bold;")
        right_panel_layout.addWidget(self.selected_node_details_label)
        self.selected_node_title_display = QLabel("Title: N/A")
        self.selected_node_title_display.setWordWrap(True)
        right_panel_layout.addWidget(self.selected_node_title_display)
        self.selected_node_type_display = QLabel("Type: N/A")
        right_panel_layout.addWidget(self.selected_node_type_display)
        self.selected_node_count_display = QLabel("Mentions: N/A")
        right_panel_layout.addWidget(self.selected_node_count_display)
        self.selected_node_count_display.hide()
        right_panel_layout.addSpacing(10)
        self.sources_label = QLabel("Associated Sources")
        self.sources_label.setStyleSheet("font-weight: bold;")
        right_panel_layout.addWidget(self.sources_label)
        self.sources_list_widget = QListWidget()
        self.sources_list_widget.setObjectName("CanvasSourcesList")
        self.sources_list_widget.setVerticalScrollMode(QListWidget.ScrollMode.ScrollPerPixel)
        self.sources_list_widget.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        right_panel_layout.addWidget(self.sources_list_widget, 1)

        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        self.splitter.addWidget(canvas_area_widget)
        self.splitter.addWidget(self.right_panel_widget)
        self.splitter.setCollapsible(0, False)
        self.splitter.setCollapsible(1, True)
        self.splitter.setSizes([self.width() - 350 if self.width() > 500 else 500, 350])
        self.splitter.setStretchFactor(0, 1)
        self.splitter.setStretchFactor(1, 0)
        main_layout.addWidget(self.splitter)
        self.setLayout(main_layout)

    # ... (Keep methods from the merged AdvancedCanvasWidget, adapting as needed)
    # Methods like: _init_shortcuts, _nudge_selected_nodes, _zoom_in, _zoom_out, _reset_zoom_and_fit
    # _connect_signals, apply_theme, _toggle_theme, load_keyword_data_from_reader,
    # generate_initial_mindmap, _build_simple_cooccurrence_hierarchy, _render_hierarchy_to_canvas,
    # _add_node_to_canvas, _add_connection_to_canvas, _handle_node_click_for_sources,
    # _handle_node_selection_change, _handle_node_double_click, _handle_node_title_changed,
    # _set_scene_items_enabled_for_editing, _populate_sources_list, _on_source_list_double_clicked,
    # setup_view_interaction, _view_wheel_event_handler, keyPressEvent, _update_connections_for_node,
    # _add_new_node_interactive, _connect_selected_nodes_interactive, _delete_selected_items_interactive,
    # _node_has_potential_map_children, _get_mind_map_children_for_node, _layout_and_draw_map_children,
    # _collapse_map_children, _toggle_map_node_expansion, _fit_view_to_scene_content,
    # _fit_view_to_scene_content_if_needed, save_canvas_state_interactive, save_canvas_state_to_file,
    # load_canvas_state_interactive, load_canvas_state_from_file, _rebuild_map_structure_from_loaded_connections,
    # export_as_image, _show_view_context_menu, _change_node_color_interactive,
    # _change_node_font_size_interactive, _get_first_selected_node

    def _init_shortcuts(self):
        QShortcut(QKeySequence(Qt.Key.Key_Delete), self, self._delete_selected_items_interactive)
        QShortcut(QKeySequence(Qt.Key.Key_Backspace), self, self._delete_selected_items_interactive)
        QShortcut(QKeySequence("Ctrl+="), self, self._zoom_in)
        QShortcut(QKeySequence("Ctrl++"), self, self._zoom_in)
        QShortcut(QKeySequence("Ctrl+-"), self, self._zoom_out)
        QShortcut(QKeySequence("Ctrl+0"), self, self._reset_zoom_and_fit)
        QShortcut(QKeySequence(Qt.Key.Key_Up), self, lambda: self._nudge_selected_nodes(0, -10))
        QShortcut(QKeySequence(Qt.Key.Key_Down), self, lambda: self._nudge_selected_nodes(0, 10))
        QShortcut(QKeySequence(Qt.Key.Key_Left), self, lambda: self._nudge_selected_nodes(-10, 0))
        QShortcut(QKeySequence(Qt.Key.Key_Right), self, lambda: self._nudge_selected_nodes(10, 0))

    def _nudge_selected_nodes(self, dx: int, dy: int):
        selected_nodes = [item for item in self.scene.selectedItems() if isinstance(item, CanvasNodeItem)]
        if not selected_nodes:
            self.view.horizontalScrollBar().setValue(self.view.horizontalScrollBar().value() - dx * 2)
            self.view.verticalScrollBar().setValue(self.view.verticalScrollBar().value() - dy * 2)
            return
        for node in selected_nodes:
            node.moveBy(dx, dy)
        self.canvas_changed_signal.emit()

    def _zoom_in(self):
        self.view.scale(1.2, 1.2)

    def _zoom_out(self):
        self.view.scale(1 / 1.2, 1 / 1.2)

    def _reset_zoom_and_fit(self):
        self.view.resetTransform()
        self._fit_view_to_scene_content()

    def _connect_signals(self):
        self.btn_add_node.clicked.connect(lambda: self._add_new_node_interactive())
        self.btn_connect_nodes.clicked.connect(self._connect_selected_nodes_interactive)
        self.btn_delete_selected.clicked.connect(self._delete_selected_items_interactive)
        self.btn_export_image.clicked.connect(self.export_as_image)
        self.btn_save_canvas.clicked.connect(self.save_canvas_state_interactive)
        self.btn_load_canvas.clicked.connect(self.load_canvas_state_interactive)
        self.btn_toggle_theme.clicked.connect(self._toggle_theme)
        self.btn_regen_map.clicked.connect(lambda: self.generate_initial_mindmap(use_llm=True, force_rebuild_llm=True))
        self.view.customContextMenuRequested.connect(self._show_view_context_menu)
        self.sources_list_widget.itemDoubleClicked.connect(self._on_source_list_double_clicked)

    def apply_theme(self, theme_key="dark"):
        self.current_theme_key = theme_key
        self.colors = THEME_COLORS.get(theme_key, THEME_COLORS["dark"])
        self.setStyleSheet(f"QWidget#AdvancedCanvasWidget {{ background-color: {self.colors['canvas_bg'].name()}; }}")
        self.scene.setBackgroundBrush(QBrush(self.colors["canvas_bg"]))
        self.view.setStyleSheet(f"QGraphicsView {{ border: 1px solid {self.colors['node_border'].name()}; }}")
        for node in self.nodes.values():
            node.colors = self.colors;
            node.update()
        for conn in self.connections.values():
            conn.colors = self.colors;
            pen = conn.pen();
            pen.setColor(self.colors["edge"]);
            conn.setPen(pen);
            conn.update()
        self.right_panel_widget.setStyleSheet(f"background-color: {self.colors['list_bg'].name()};")
        details_label_style = f"color: {self.colors['details_text'].name()};"
        details_header_style = f"color: {self.colors['details_text'].name()}; font-weight: bold;"
        self.selected_node_details_label.setStyleSheet(details_header_style)
        self.selected_node_title_display.setStyleSheet(details_label_style)
        self.selected_node_type_display.setStyleSheet(details_label_style)
        self.selected_node_count_display.setStyleSheet(details_label_style)
        self.sources_label.setStyleSheet(details_header_style)
        self.sources_list_widget.setStyleSheet(f"""
            QListWidget {{ background-color: {self.colors['list_bg'].name()}; color: {self.colors['list_text'].name()}; border: 1px solid {self.colors['node_border'].name()}; }}
            QListWidget::item:selected {{ background-color: {self.colors['list_selected_bg'].name()}; border: 1px solid {self.colors['node_selected_border'].name()}; }}
        """)
        toolbar_style = f"QFrame#CanvasToolbar {{ background-color: {self.colors['canvas_bg'].darker(110).name()}; border-bottom: 1px solid {self.colors['node_border'].name()}; }}"
        # self.findChild(QWidget,"CanvasToolbar").setStyleSheet(toolbar_style) # findChild can be problematic
        if self.btn_add_node.parentWidget().objectName() == "CanvasToolbar":  # Check if toolbar exists by checking a button's parent
            self.btn_add_node.parentWidget().setStyleSheet(toolbar_style)

        button_style = f"""
            QPushButton {{ background-color:{self.colors['button_bg'].name()};color:{self.colors['button_text'].name()};border:1px solid {self.colors['button_border'].name()};padding:5px 8px;border-radius:{CORNER_RADIUS - 2}px;}}
            QPushButton:hover {{background-color:{self.colors['button_bg'].lighter(130).name()};}} QPushButton:pressed {{background-color:{self.colors['button_bg'].darker(110).name()};}}
        """
        for btn in [self.btn_add_node, self.btn_connect_nodes, self.btn_delete_selected, self.btn_export_image,
                    self.btn_save_canvas, self.btn_load_canvas, self.btn_toggle_theme, self.btn_regen_map]:
            if btn: btn.setStyleSheet(button_style)
        self.scene.update()
        self._refresh_sources_list_theme()

    def _refresh_sources_list_theme(self):
        selected_node = self._get_first_selected_node()
        if selected_node:
            self._handle_node_click_for_sources(selected_node)
        else:
            self.sources_list_widget.clear()

    def _toggle_theme(self):
        self.apply_theme("light" if self.current_theme_key == "dark" else "dark")

    def load_keyword_data_from_reader(self):
        if self.project_reader and hasattr(self.project_reader, 'keyword_cache') and hasattr(self.project_reader,
                                                                                             'project_keyword_counts'):
            if not self.project_reader.keyword_cache or not self.project_reader.project_keyword_counts:
                if hasattr(self.project_reader, '_build_keyword_cache'): self.project_reader._build_keyword_cache()
            self.keyword_cache_data = self.project_reader.keyword_cache
            self.project_keyword_counts_data = self.project_reader.project_keyword_counts
            logging.info("Keyword data loaded into AdvancedCanvasWidget from ProjectReader.")
        else:
            logging.warning("AdvancedCanvasWidget: ProjectReader or its keyword data not available.")

    def generate_initial_mindmap(self, use_llm: bool = True, force_rebuild_llm: bool = False):
        self.scene.clear();
        self.nodes.clear();
        self.connections.clear();
        self.keyword_map_root_node_id = None
        if not self.project_keyword_counts_data and self.project_reader: self.load_keyword_data_from_reader()
        if not self.project_keyword_counts_data:
            QMessageBox.warning(self, "No Data", "Keyword data not loaded.");
            logging.warning("generate_initial_mindmap: No keyword data.");
            self._add_node_to_canvas("Error: No Keyword Data", INITIAL_X_OFFSET, INITIAL_Y_OFFSET);
            return
        hierarchy_data = None;
        cache_key_base = "llm_hierarchy" if use_llm else "cooccurrence_hierarchy"
        counts_hash = hashlib.sha256(
            json.dumps(dict(self.project_keyword_counts_data), sort_keys=True).encode()).hexdigest()[:10]
        cache_file = MINDMAP_CACHE_DIR / f"{cache_key_base}_{counts_hash}.json"
        if use_llm and not force_rebuild_llm and cache_file.is_file():
            try:
                with cache_file.open("r", encoding="utf-8") as f:
                    hierarchy_data = json.load(f)
                logging.info(f"LLM hierarchy loaded from cache: {cache_file.name}")
            except Exception as e:
                logging.warning(f"Failed to load LLM hierarchy from cache: {e}"); hierarchy_data = None
        if hierarchy_data is None:
            if use_llm:
                logging.info("Generating new LLM hierarchy...");
                builder = KeywordHierarchyBuilder(self)
                if not builder.build_indexes_from_provider(): QMessageBox.critical(self, "Data Error",
                                                                                   "Failed to init keyword indexes for LLM."); return
                hierarchy_data = builder.get_llm_based_hierarchy(max_roots=7,
                                                                 max_children_per_node=MAX_INITIAL_ROOT_CHILDREN)
                try:
                    with cache_file.open("w", encoding="utf-8") as f:
                        json.dump(hierarchy_data, f, indent=2)
                    logging.info(f"LLM hierarchy cached to {cache_file.name}")
                except Exception as e:
                    logging.warning(f"Could not write LLM hierarchy cache: {e}")
            else:
                logging.info("Generating new co-occurrence hierarchy...");
                hierarchy_data = self._build_simple_cooccurrence_hierarchy(max_roots=10,
                                                                           max_children=MAX_INITIAL_ROOT_CHILDREN)
        if hierarchy_data:
            self._render_hierarchy_to_canvas(hierarchy_data); QTimer.singleShot(100, self._fit_view_to_scene_content)
        else:
            self._add_node_to_canvas("Failed to generate hierarchy", INITIAL_X_OFFSET, INITIAL_Y_OFFSET); logging.error(
                "Hierarchy generation failed.")
        self.canvas_changed_signal.emit()

    def _build_simple_cooccurrence_hierarchy(self, max_roots: int, max_children: int) -> Dict:
        if not self.project_keyword_counts_data or not self.keyword_cache_data: return {"name": "Keywords",
                                                                                        "id": "root", "children": []}
        id2label, label2id, id2count, id2entries = build_index(self.keyword_cache_data)
        if not id2count: return {"name": "Keywords", "id": "root", "children": []}
        roots = [kw_id for kw_id, _ in Counter(id2count).most_common(max_roots)]
        hierarchy = {"name": "Keywords", "id": "synthetic_root", "children": []}
        for root_id in roots:
            if root_id not in id2label: continue
            root_node_data = {"name": id2label[root_id], "id": root_id, "size": id2count.get(root_id, 0),
                              "children": []}
            co_counts = Counter()
            for entry in id2entries.get(root_id, []):
                para_keywords = entry.get("para_obj", {}).get("keywords", [])
                for kw_text in para_keywords:
                    # This simplified norm_kw lookup might need to be more robust (e.g. using label2id from build_index)
                    norm_kw = kw_text.strip().lower()  # Example simple norm
                    child_id = None
                    for i, l in id2label.items():  # Inefficient, better to use label2id or precomputed norm_label -> id
                        if l.strip().lower() == norm_kw: child_id = i; break
                    if child_id and child_id != root_id: co_counts[child_id] += 1
            for child_kw_id, cnt in co_counts.most_common(max_children):
                if child_kw_id not in id2label: continue
                root_node_data["children"].append(
                    {"name": id2label[child_kw_id], "id": child_kw_id, "size": cnt, "children": []})
            hierarchy["children"].append(root_node_data)
        return hierarchy

    def _render_hierarchy_to_canvas(self, tree: dict, parent_item: Optional[CanvasNodeItem] = None, depth: int = 0,
                                    y_offset_map: Optional[Dict[int, float]] = None,
                                    sibling_index_map: Optional[Dict[int, int]] = None):
        if y_offset_map is None: y_offset_map = defaultdict(lambda: INITIAL_Y_OFFSET)
        if sibling_index_map is None: sibling_index_map = defaultdict(int)
        if depth == 0 and parent_item is None:
            num_total_keywords = sum(self.project_keyword_counts_data.values())
            root_display_title = tree.get("name", "Keywords") + f" ({num_total_keywords})"
            synthetic_root_node = self._add_node_to_canvas(root_display_title, INITIAL_X_OFFSET, y_offset_map[depth],
                                                           node_id=tree.get("id",
                                                                            "canvas_root_" + str(uuid.uuid4())[:4]),
                                                           is_keyword_node=True,
                                                           keyword_data={"name": "_ROOT_", "count": num_total_keywords},
                                                           is_synthetic_root=True, is_expanded=True)
            self.keyword_map_root_node_id = synthetic_root_node.id
            y_offset_map[depth] += synthetic_root_node.boundingRect().height() + NODE_Y_SPACING * 2
            for child_node_data in tree.get("children", []):
                self._render_hierarchy_to_canvas(child_node_data, synthetic_root_node, depth + 1, y_offset_map,
                                                 sibling_index_map)
            self.canvas_changed_signal.emit();
            QTimer.singleShot(150, self._fit_view_to_scene_content);
            return
        if not parent_item: logging.error("_render_hierarchy_to_canvas recursively called without parent_item."); return
        node_x = parent_item.x() + parent_item.boundingRect().width() + LEVEL_X_SPACING
        node_y = y_offset_map[depth]
        kw_id = tree.get("id", tree.get("name", "unknown_id"))
        kw_name = tree.get("name", "Unknown")
        kw_count = tree.get("size",
                            self.project_keyword_counts_data.get(kw_id, 0) if self.project_keyword_counts_data else 0)
        node_item = self._add_node_to_canvas(kw_name, node_x, node_y, node_id=kw_id, is_keyword=True,
                                             keyword_data={"name": kw_name, "count": kw_count}, is_expanded=False)
        conn = self._add_connection_to_canvas(parent_item.id, node_item.id, conn_type="auto")
        if conn:
            node_item.edge_to_map_parent = conn;
            node_item.parent_map_item = parent_item
            if node_item not in parent_item.child_map_items: parent_item.child_map_items.append(node_item)
        y_offset_map[depth] += node_item.boundingRect().height() + NODE_Y_SPACING
        sibling_index_map[depth] += 1
        if tree.get("children") and (parent_item.is_synthetic_root or depth < 1):
            node_item.is_expanded_in_map = True;
            original_y_for_children = y_offset_map[depth + 1]
            if parent_item.child_map_items and node_item == parent_item.child_map_items[0]: y_offset_map[
                depth + 1] = node_item.y()
            for child_data in tree.get("children", []):
                self._render_hierarchy_to_canvas(child_data, node_item, depth + 1, y_offset_map, sibling_index_map)
            if parent_item.child_map_items and node_item != parent_item.child_map_items[-1]:
                y_offset_map[depth + 1] = original_y_for_children
            elif not parent_item.child_map_items:
                y_offset_map[depth + 1] = INITIAL_Y_OFFSET

    # _add_node_to_canvas = CanvasNodeItem._add_node_to_canvas  # Delegate from previous combined version
    # _add_connection_to_canvas = CanvasConnectionItem._add_connection_to_canvas  # Delegate

    @pyqtSlot(object)
    def _handle_node_click_for_sources(self, node: CanvasNodeItem):
        self.selected_node_title_display.setText(f"Title: {node.title_text}")
        node_type_str = "Keyword" if node.is_keyword_node else "Custom Note"
        if node.is_synthetic_root: node_type_str = "Mind Map Root"
        self.selected_node_type_display.setText(f"Type: {node_type_str}")
        self.sources_list_widget.clear()
        if node.is_keyword_node and node.keyword_data and not node.is_synthetic_root:
            count = node.keyword_data.get('count', "N/A")
            self.selected_node_count_display.setText(f"Mentions: {count}");
            self.selected_node_count_display.show()
            keyword_name_for_lookup = node.keyword_data.get("name")
            if keyword_name_for_lookup:
                self._populate_sources_list(keyword_name_for_lookup.lower())
            else:
                logging.warning(f"Node {node.id} is keyword node but has no 'name' in keyword_data.")
        else:
            self.selected_node_count_display.hide()

    @pyqtSlot(object, bool)
    def _handle_node_selection_change(self, node: CanvasNodeItem, is_selected: bool):
        selected_items = self.scene.selectedItems()
        is_node_canvas_item = [isinstance(item, CanvasNodeItem) for item in selected_items]
        if is_selected and sum(is_node_canvas_item) == 1 and selected_items[0] == node:
            self._handle_node_click_for_sources(node)
        elif not any(is_node_canvas_item):
            self.selected_node_title_display.setText("Title: N/A");
            self.selected_node_type_display.setText("Type: N/A")
            self.selected_node_count_display.hide();
            self.sources_list_widget.clear()

    @pyqtSlot(object)
    def _handle_node_double_click(self, node: CanvasNodeItem):
        if (hasattr(node, 'text_edit_input_widget') and node.text_edit_input_widget) or \
                (hasattr(node, 'editor_widget') and node.editor_widget and node.editor_widget.isVisible()): return
        for other_node_id, other_node_obj in self.nodes.items():
            if other_node_obj != node and hasattr(other_node_obj, 'editor_widget') and other_node_obj.editor_widget:
                other_node_obj.stop_editing(commit_changes=True)
        node.start_editing(self.scene)

    @pyqtSlot(object)
    def _handle_node_title_changed(self, node: CanvasNodeItem):
        self._update_connections_for_node(node)
        if node.isSelected() and len(self.scene.selectedItems()) == 1: self._handle_node_click_for_sources(node)
        self.canvas_changed_signal.emit()

    def _set_scene_items_enabled_for_editing(self, editing_node: CanvasNodeItem, enable_others: bool):
        for item in self.scene.items():
            if item is not editing_node and isinstance(item, (CanvasNodeItem, CanvasConnectionItem)): item.setEnabled(
                enable_others)
            if hasattr(editing_node,
                       'text_edit_input_widget') and item is editing_node.text_edit_input_widget: item.setEnabled(True)

    def _populate_sources_list(self, keyword_name_lower: str):
        self.sources_list_widget.clear();
        if not keyword_name_lower: return
        source_entries = self.keyword_cache_data.get(keyword_name_lower, [])
        if not source_entries:
            item = QListWidgetItem("No sources found for this keyword.");
            font = item.font();
            font.setItalic(True);
            item.setFont(font)
            item.setForeground(self.colors['details_text'].darker(120));
            self.sources_list_widget.addItem(item);
            return
        for src_idx, src_info in enumerate(source_entries):
            para_obj = src_info.get('para_obj', {});
            title = para_obj.get('paragraph_title', 'Untitled Source').strip()
            html_txt = para_obj.get('html', 'N/A').strip()  # Assumed to have <mark> tags
            filename = src_info.get('source_filename', 'unknown_file');
            para_id = src_info.get('paragraph_id', f'para_{src_idx}');
            item_key = src_info.get('zotero_item_key', 'unknown_key')

            # Using HoverTextBrowser for each item
            browser_content_html = f"""
            <div style="color:{self.colors['list_text'].name()}; padding:1px;">
                <div style="font-weight:bold; margin-bottom:4px; font-size:9pt;">{title}</div>
                <div style="font-size:8pt; line-height:1.3;">{html_txt}</div>
            </div>"""
            full_html_for_browser = f"""<html><head>{HOVER_BROWSER_CSS}</head>
             <body style="background-color:transparent; color:{self.colors['list_text'].name()}; font-family: Arial, sans-serif;">
                {browser_content_html}</body></html>"""

            browser = HoverTextBrowser();
            browser.document().setDefaultStyleSheet(
                f"body {{ background-color:transparent; color:{self.colors['list_text'].name()}; }} " + HOVER_BROWSER_CSS)
            browser.setHtml(full_html_for_browser)
            browser.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff);
            browser.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
            browser.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.MinimumExpanding)
            item = QListWidgetItem(self.sources_list_widget);
            item.setData(Qt.ItemDataRole.UserRole, (filename, para_id, item_key))
            doc = browser.document();
            list_viewport_width = self.sources_list_widget.viewport().width()
            available_width = max(50,
                                  list_viewport_width - self.sources_list_widget.verticalScrollBar().sizeHint().width() - 10)
            doc.setTextWidth(available_width);
            content_height = doc.size().height();
            item_height = content_height + 10
            item.setSizeHint(QSize(int(available_width), int(item_height)));
            self.sources_list_widget.setItemWidget(item, browser)

    def _on_source_list_double_clicked(self, item: QListWidgetItem):
        data = item.data(Qt.ItemDataRole.UserRole)
        if data and isinstance(data, tuple) and len(data) == 3:
            filename, para_id, item_key = data
            logging.info(
                f"Source DClicked. Emitting open_source_in_reader_requested for {filename}, P_ID:{para_id}, Z_Key:{item_key}")
            self.open_source_in_reader_requested.emit(filename, str(para_id), str(item_key))
        else:
            logging.warning(f"Could not process double-click for source item. Data: {data}")

    def setup_view_interaction(self):
        self.view.setDragMode(QGraphicsView.DragMode.ScrollHandDrag)
        self.view.wheelEvent = self._view_wheel_event_handler

    def _view_wheel_event_handler(self, event: QWheelEvent):
        modifiers = QApplication.keyboardModifiers();
        delta = event.angleDelta()
        if modifiers == Qt.KeyboardModifier.ControlModifier:
            if delta.y() > 0:
                self._zoom_in()
            else:
                self._zoom_out()
            event.accept()
        elif modifiers == Qt.KeyboardModifier.ShiftModifier:
            scroll_val = 0
            if not delta.isNull():
                if delta.x() != 0:
                    scroll_val = -delta.x()
                elif delta.y() != 0:
                    scroll_val = -delta.y()
            if scroll_val != 0:
                h_bar = self.view.horizontalScrollBar();
                h_bar.setValue(h_bar.value() + scroll_val // 6);
                event.accept()
            else:
                QGraphicsView.wheelEvent(self.view, event)
        else:
            QGraphicsView.wheelEvent(self.view, event)

    def keyPressEvent(self, event: QKeyEvent):
        active_editor_node = None
        for node in self.nodes.values():
            if hasattr(node,
                       'editor_widget') and node.editor_widget and node.editor_widget.hasFocus(): active_editor_node = node; break
        if active_editor_node: event.accept(); return
        key = event.key()
        if key in (Qt.Key.Key_Up, Qt.Key.Key_Down, Qt.Key.Key_Left,
                   Qt.Key.Key_Right) and not self.scene.selectedItems():
            pan_step = 20;
            h_bar = self.view.horizontalScrollBar();
            v_bar = self.view.verticalScrollBar()
            if key == Qt.Key.Key_Up:
                v_bar.setValue(v_bar.value() - pan_step)
            elif key == Qt.Key.Key_Down:
                v_bar.setValue(v_bar.value() + pan_step)
            elif key == Qt.Key.Key_Left:
                h_bar.setValue(h_bar.value() - pan_step)
            elif key == Qt.Key.Key_Right:
                h_bar.setValue(h_bar.value() + pan_step)
            event.accept();
            return
        super().keyPressEvent(event)

    def _update_connections_for_node(self, node: CanvasNodeItem):
        for conn_id in list(self.connections.keys()):
            conn = self.connections.get(conn_id)
            if conn and (conn.start_node == node or conn.end_node == node): conn.update_path()
        self.canvas_changed_signal.emit()

    def _add_new_node_interactive(self, scene_pos: Optional[QPointF] = None):
        if scene_pos is None: view_center = self.view.viewport().rect().center(); scene_pos = self.view.mapToScene(
            view_center)
        title, ok = QInputDialog.getText(self, "New Node", "Enter node title:", text="New Node")
        if ok and title:
            new_node = self._add_node_to_canvas(title.strip(), scene_pos.x(), scene_pos.y())
            self.scene.clearSelection();
            new_node.setSelected(True)
            self.canvas_changed_signal.emit();
            self._fit_view_to_scene_content_if_needed()

    def _connect_selected_nodes_interactive(self):
        selected = [item for item in self.scene.selectedItems() if isinstance(item, CanvasNodeItem)]
        if len(selected) == 2:
            self._add_connection_to_canvas(selected[0].id, selected[1].id,
                                           conn_type="manual"); self.canvas_changed_signal.emit()
        else:
            QMessageBox.information(self, "Connect Nodes", "Please select exactly two nodes to connect.")

    def _delete_selected_items_interactive(self):
        items_to_delete = self.scene.selectedItems();
        if not items_to_delete: return
        reply = QMessageBox.question(self, "Delete Items", f"Delete {len(items_to_delete)} selected item(s)?",
                                     QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                                     QMessageBox.StandardButton.No)
        if reply == QMessageBox.StandardButton.No: return
        for item in items_to_delete:
            if isinstance(item, CanvasNodeItem):
                if item.is_keyword_node and item.is_expanded_in_map: self._collapse_map_children(item,
                                                                                                 delete_children_permanently=True)
                node_id_to_delete = item.id
                for conn_id in list(self.connections.keys()):
                    conn = self.connections.get(conn_id)
                    if conn and (conn.start_node.id == node_id_to_delete or conn.end_node.id == node_id_to_delete):
                        self.scene.removeItem(conn);
                        del self.connections[conn_id]
                if item.parent_map_item and item in item.parent_map_item.child_map_items: item.parent_map_item.child_map_items.remove(
                    item)
                self.scene.removeItem(item)
                if node_id_to_delete in self.nodes: del self.nodes[node_id_to_delete]
                if self.keyword_map_root_node_id == node_id_to_delete: self.keyword_map_root_node_id = None
            elif isinstance(item, CanvasConnectionItem):
                conn_id_to_delete = item.id;
                self.scene.removeItem(item)
                if conn_id_to_delete in self.connections: del self.connections[conn_id_to_delete]
        self.canvas_changed_signal.emit();
        self._handle_node_selection_change(None, False)

    def _node_has_potential_map_children(self, parent_node: CanvasNodeItem) -> bool:
        if not parent_node.is_keyword_node or not self.keyword_cache_data: return False
        node_kw_data = parent_node.keyword_data;
        parent_kw_name_lower = node_kw_data.get("name", "").lower() if node_kw_data else None
        if not parent_kw_name_lower: return False
        if parent_kw_name_lower == "_root_": return bool(self.project_keyword_counts_data)
        if parent_kw_name_lower in self.keyword_cache_data:
            ancestor_names = set();
            temp_p = parent_node.parent_map_item
            while temp_p:
                if temp_p.keyword_data and temp_p.keyword_data.get("name"): ancestor_names.add(
                    temp_p.keyword_data.get("name").lower())
                temp_p = temp_p.parent_map_item
            for para_info in self.keyword_cache_data[parent_kw_name_lower]:
                para_obj = para_info.get('para_obj', {});
                if 'keywords' in para_obj:
                    for kw_text in para_obj['keywords']:
                        kw_l = kw_text.strip().lower()
                        if kw_l != parent_kw_name_lower and kw_l not in ancestor_names: return True
        return False

    def _get_mind_map_children_for_node(self, parent_node: CanvasNodeItem) -> List[Dict]:
        parent_kw_data = parent_node.keyword_data;
        parent_kw_name_lower = parent_kw_data.get("name", "").lower() if parent_kw_data else None
        if not parent_kw_name_lower: return []
        children_kw_data = []
        if parent_kw_name_lower == "_root_":
            sorted_kws = sorted(self.project_keyword_counts_data.items(), key=lambda x: x[1], reverse=True)
            for kw, count in sorted_kws[:MAX_INITIAL_ROOT_CHILDREN]: children_kw_data.append(
                {"name": kw, "count": count, "id": kw})
        else:
            cooccurrences = Counter();
            ancestor_names = set();
            temp_p = parent_node.parent_map_item
            while temp_p:
                if temp_p.keyword_data and temp_p.keyword_data.get("name"): ancestor_names.add(
                    temp_p.keyword_data.get("name").lower())
                temp_p = temp_p.parent_map_item
            if parent_kw_name_lower in self.keyword_cache_data:
                for para_info in self.keyword_cache_data[parent_kw_name_lower]:
                    para_obj = para_info.get('para_obj', {});
                    keywords_in_para = para_obj.get('keywords', [])
                    for kw_text in keywords_in_para:
                        kw_l = kw_text.strip().lower()
                        if kw_l and kw_l != parent_kw_name_lower and kw_l not in ancestor_names: cooccurrences[
                            kw_l] += 1
            for kw, count in cooccurrences.most_common(MAX_EXPAND_CHILDREN): children_kw_data.append(
                {"name": kw, "count": count, "id": kw})
        return children_kw_data

    def _layout_and_draw_map_children(self, parent_node: CanvasNodeItem, children_kw_data: list):
        if not children_kw_data: parent_node.is_expanded_in_map = False; parent_node.update(); return
        parent_rect = parent_node.boundingRect();
        parent_pos = parent_node.pos()
        current_x = parent_pos.x() + parent_rect.width() + LEVEL_X_SPACING
        num_children = len(children_kw_data);
        est_children_total_height = num_children * (DEFAULT_NODE_HEIGHT + NODE_Y_SPACING) - NODE_Y_SPACING
        start_y = parent_pos.y() + parent_rect.height() / 2 - est_children_total_height / 2;
        current_y = start_y
        parent_node.child_map_items.clear()
        for child_data in children_kw_data:
            child_kw_name = child_data.get("name", "Unnamed");
            child_id = child_data.get("id", child_kw_name);
            child_count = child_data.get("count", 0)
            child_node = self.nodes.get(child_id)
            if child_node:
                child_node.setPos(current_x, current_y)
            else:
                child_node = self._add_node_to_canvas(child_kw_name, current_x, current_y, node_id=child_id,
                                                      is_keyword=True,
                                                      kw_data={"name": child_kw_name, "count": child_count},
                                                      is_expanded=False)
            child_node.parent_map_item = parent_node;
            parent_node.child_map_items.append(child_node)
            conn = self._add_connection_to_canvas(parent_node.id, child_node.id, conn_type="auto")
            if conn: child_node.edge_to_map_parent = conn
            current_y += child_node.boundingRect().height() + NODE_Y_SPACING
        parent_node.is_expanded_in_map = True;
        parent_node.update();
        self.canvas_changed_signal.emit()

    def _collapse_map_children(self, parent_node: CanvasNodeItem, delete_children_permanently: bool = False):
        if not parent_node.is_expanded_in_map or not parent_node.child_map_items:
            parent_node.is_expanded_in_map = False;
            parent_node.update();
            return
        children_to_process = list(parent_node.child_map_items);
        parent_node.child_map_items.clear()
        for child_node in children_to_process:
            if child_node.is_expanded_in_map: self._collapse_map_children(child_node, delete_children_permanently)
            if child_node.edge_to_map_parent and child_node.edge_to_map_parent.id in self.connections and child_node.edge_to_map_parent.type == "auto":
                self.scene.removeItem(child_node.edge_to_map_parent);
                del self.connections[child_node.edge_to_map_parent.id];
                child_node.edge_to_map_parent = None
            if delete_children_permanently and child_node.id in self.nodes:
                self.scene.removeItem(child_node);
                del self.nodes[child_node.id]
            child_node.parent_map_item = None
        parent_node.is_expanded_in_map = False;
        parent_node.update();
        self.canvas_changed_signal.emit()

    def _toggle_map_node_expansion(self, node: CanvasNodeItem):
        if not node.is_keyword_node: return
        if node.is_expanded_in_map:
            self._collapse_map_children(node, delete_children_permanently=True)
        else:
            if not self._node_has_potential_map_children(node):
                QToolTip.showText(QCursor.pos(), "No further unshown keywords.", self.view, QRect(), 2000);
                node.is_expanded_in_map = False;
                node.update();
                return
            children_data = self._get_mind_map_children_for_node(node)
            if children_data:
                self._layout_and_draw_map_children(node, children_data)
            else:
                node.is_expanded_in_map = False; node.update(); QToolTip.showText(QCursor.pos(),
                                                                                  "No co-occurring keywords.",
                                                                                  self.view, QRect(), 2000)
        self.canvas_changed_signal.emit();
        QTimer.singleShot(50, self._fit_view_to_scene_content_if_needed)

    def _fit_view_to_scene_content(self, padding=50):
        if self.scene.items():
            try:
                items_rect = self.scene.itemsBoundingRect()
                if not items_rect.isValid() or items_rect.isEmpty(): self.view.setSceneRect(-300, -200, 600,
                                                                                            400); return
                padded_rect = items_rect.adjusted(-padding, -padding, padding, padding)
                self.view.setSceneRect(padded_rect);
                self.view.fitInView(padded_rect, Qt.AspectRatioMode.KeepAspectRatio)
            except Exception as e:
                logging.error(f"Error in _fit_view_to_scene_content: {e}")
        else:
            self.view.setSceneRect(-self.view.width() / 2, -self.view.height() / 2, self.view.width(),
                                   self.view.height())

    def _fit_view_to_scene_content_if_needed(self):
        if not self.scene.items(): return
        items_rect = self.scene.itemsBoundingRect().adjusted(-INITIAL_X_OFFSET, -INITIAL_Y_OFFSET, INITIAL_X_OFFSET,
                                                             INITIAL_Y_OFFSET)
        if not items_rect.isValid(): return
        current_view_scene_rect = self.view.mapToScene(self.view.viewport().rect()).boundingRect()
        if not current_view_scene_rect.contains(items_rect) or \
                items_rect.width() < current_view_scene_rect.width() * 0.5 or items_rect.height() < current_view_scene_rect.height() * 0.5 or \
                items_rect.width() > current_view_scene_rect.width() * 1.5 or items_rect.height() > current_view_scene_rect.height() * 1.5:
            self._fit_view_to_scene_content()

    def save_canvas_state_interactive(self):
        fp, _ = QFileDialog.getSaveFileName(self, "Save Canvas", "", "Canvas JSON (*.json)")
        if fp:
            if not fp.endswith(".json"): fp += ".json"
            self.save_canvas_state_to_file(fp)

    def save_canvas_state_to_file(self, filepath: str):
        try:
            data = {"nodes": [], "connections": []}
            for node_id, node in self.nodes.items():
                node_data = {"id": node.id, "html_title": node.html_title_text, "x": node.x(), "y": node.y(),
                             "width": node._width, "height": node._height, "is_keyword_node": node.is_keyword_node,
                             "is_expanded_in_map": node.is_expanded_in_map, "font_size": node.current_font_size,
                             "color_override": node.background_color_override.name(
                                 QColor.NameFormat.HexArgb) if node.background_color_override else None,
                             "is_synthetic_root": node.is_synthetic_root}
                if node.keyword_data: node_data["keyword_data"] = node.keyword_data
                data["nodes"].append(node_data)
            for conn_id, conn in self.connections.items(): data["connections"].append(
                {"id": conn.id, "type": conn.type, "start_node_id": conn.start_node.id,
                 "end_node_id": conn.end_node.id})
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            logging.info(f"Canvas state saved to {filepath}");
            QMessageBox.information(self, "Canvas Saved", f"Canvas state saved to:\n{filepath}")
        except Exception as e:
            logging.error(f"Error saving canvas state: {e}"); QMessageBox.critical(self, "Save Error",
                                                                                   f"Could not save canvas state: {e}")

    def load_canvas_state_interactive(self):
        fp, _ = QFileDialog.getOpenFileName(self, "Load Canvas", "", "Canvas JSON (*.json)")
        if fp: self.load_canvas_state_from_file(fp)

    def load_canvas_state_from_file(self, filepath: str):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self.scene.clear();
            self.nodes.clear();
            self.connections.clear();
            self.keyword_map_root_node_id = None
            for node_data in data.get("nodes", []):
                title = node_data.get("html_title", node_data.get("title", "Untitled"))
                node = self._add_node_to_canvas(title, node_data["x"], node_data["y"], node_id=node_data["id"],
                                                is_keyword=node_data.get("is_keyword_node", False),
                                                kw_data=node_data.get("keyword_data"),
                                                is_expanded=node_data.get("is_expanded_in_map", False),
                                                w=node_data.get("width"), h=node_data.get("height"),
                                                font_size=node_data.get("font_size", DEFAULT_FONT_SIZE),
                                                color_override_hex=node_data.get("color_override"),
                                                is_synthetic_root=node_data.get("is_synthetic_root", False))
                if node.is_synthetic_root and node.keyword_data and node.keyword_data.get(
                    "name") == "_ROOT_": self.keyword_map_root_node_id = node.id
            for conn_data in data.get("connections", []): self._add_connection_to_canvas(conn_data["start_node_id"],
                                                                                         conn_data["end_node_id"],
                                                                                         conn_id=conn_data["id"],
                                                                                         conn_type=conn_data.get("type",
                                                                                                                 "manual"))
            self._rebuild_map_structure_from_loaded_connections()
            logging.info(f"Canvas state loaded from {filepath}");
            QTimer.singleShot(100, self._fit_view_to_scene_content);
            self.canvas_changed_signal.emit();
            self.apply_theme(self.current_theme_key)
        except Exception as e:
            logging.error(f"Error loading canvas state: {e}"); QMessageBox.critical(self, "Load Error",
                                                                                    f"Could not load canvas state from {filepath}: {e}")

    def _rebuild_map_structure_from_loaded_connections(self):
        for conn in self.connections.values():
            if conn.type == "auto":
                parent_node = conn.start_node;
                child_node = conn.end_node
                if isinstance(parent_node, CanvasNodeItem) and isinstance(child_node, CanvasNodeItem):
                    if parent_node.is_keyword_node and child_node.is_keyword_node:
                        child_node.parent_map_item = parent_node
                        if child_node not in parent_node.child_map_items: parent_node.child_map_items.append(child_node)
                        child_node.edge_to_map_parent = conn
                        if parent_node.child_map_items: parent_node.is_expanded_in_map = True; parent_node.update()

    def export_as_image(self):
        fp, _ = QFileDialog.getSaveFileName(self, "Export Image", "", "PNG (*.png);;JPEG (*.jpg *.jpeg)")
        if not fp: return
        try:
            self.scene.clearSelection();
            items_rect = self.scene.itemsBoundingRect()
            if not items_rect.isValid() or items_rect.isEmpty(): QMessageBox.warning(self, "Export Error",
                                                                                     "Canvas is empty."); return
            padding = 20;
            img_rect = items_rect.adjusted(-padding, -padding, padding, padding)
            img_size = QSizeF(img_rect.width(), img_rect.height()).toSize()
            if img_size.width() <= 0 or img_size.height() <= 0: QMessageBox.warning(self, "Export Error",
                                                                                    "Cannot export zero-size image."); return
            if img_size.width() > 16384 or img_size.height() > 16384: QMessageBox.warning(self, "Export Error",
                                                                                          "Canvas too large to export."); return
            image = QImage(img_size, QImage.Format.Format_ARGB32_Premultiplied);
            image.fill(self.colors["canvas_bg"])
            painter = QPainter(image);
            painter.setRenderHint(QPainter.RenderHint.Antialiasing)
            target_render_rect = QRectF(0, 0, img_size.width(), img_size.height());
            source_scene_rect = img_rect
            self.scene.render(painter, target=target_render_rect, source=source_scene_rect,
                              aspectRatioMode=Qt.AspectRatioMode.IgnoreAspectRatio)
            painter.end()
            if image.save(fp):
                QMessageBox.information(self, "Export Successful", f"Exported to:\n{fp}")
            else:
                QMessageBox.critical(self, "Export Error", f"Failed to save image to:\n{fp}")
        except Exception as e:
            logging.error(f"Error exporting image: {e}"); QMessageBox.critical(self, "Export Error",
                                                                               f"Error during export: {e}")

    def _show_view_context_menu(self, pos_in_view_coords: QPoint):
        scene_pos = self.view.mapToScene(pos_in_view_coords)
        items_under_cursor = self.scene.items(scene_pos)
        node_item = next((item for item in items_under_cursor if isinstance(item, CanvasNodeItem)), None)
        conn_item = next(
            (item for item in items_under_cursor if isinstance(item, CanvasConnectionItem) and not node_item), None)
        menu = QMenu(self)
        if node_item:
            if not node_item.isSelected(): self.scene.clearSelection(); node_item.setSelected(True)
            menu.addAction(f"Edit '{node_item.title_text[:20]}...' Title",
                           lambda: self._handle_node_double_click(node_item))
            if node_item.is_keyword_node and self._node_has_potential_map_children(
                    node_item) and not node_item.is_synthetic_root:
                action_text = "Collapse Branch" if node_item.is_expanded_in_map else "Expand Branch"
                menu.addAction(action_text, lambda: self._toggle_map_node_expansion(node_item))
            menu.addSeparator();
            menu.addAction("Change Node Color...", lambda: self._change_node_color_interactive(node_item))
            font_menu = menu.addMenu("Font Size");
            font_menu.addAction("Increase (+2)", lambda: self._change_node_font_size_interactive(node_item, 2))
            font_menu.addAction("Decrease (-2)", lambda: self._change_node_font_size_interactive(node_item, -2))
            font_menu.addAction(f"Default ({DEFAULT_FONT_SIZE}pt)",
                                lambda: self._change_node_font_size_interactive(node_item, DEFAULT_FONT_SIZE,
                                                                                reset_to_default=True))
            menu.addSeparator();
            menu.addAction("Delete Node", self._delete_selected_items_interactive)
        elif conn_item:
            if not conn_item.isSelected(): self.scene.clearSelection(); conn_item.setSelected(True)
            menu.addAction("Delete Connection", self._delete_selected_items_interactive)
        else:
            menu.addAction("Add New Node Here", lambda: self._add_new_node_interactive(scene_pos))
            if self.project_keyword_counts_data:
                menu.addAction("Regenerate Full Map (LLM)",
                               lambda: self.generate_initial_mindmap(use_llm=True, force_rebuild_llm=True))
                menu.addAction("Regenerate Full Map (Co-occurrence)",
                               lambda: self.generate_initial_mindmap(use_llm=False))
            menu.addSeparator();
            menu.addAction("Fit View to Content", self._fit_view_to_scene_content)
            drag_mode_menu = menu.addMenu("Drag Mode");
            action_pan = drag_mode_menu.addAction("Pan (Hand Tool)");
            action_select = drag_mode_menu.addAction("Select (Rubber Band)")
            action_pan.setCheckable(True);
            action_select.setCheckable(True);
            current_drag_mode = self.view.dragMode()
            action_pan.setChecked(current_drag_mode == QGraphicsView.DragMode.ScrollHandDrag);
            action_select.setChecked(current_drag_mode == QGraphicsView.DragMode.RubberBandDrag)
            action_pan.triggered.connect(lambda: self.view.setDragMode(QGraphicsView.DragMode.ScrollHandDrag));
            action_select.triggered.connect(lambda: self.view.setDragMode(QGraphicsView.DragMode.RubberBandDrag))
        menu.exec(self.view.mapToGlobal(pos_in_view_coords))

    def _change_node_color_interactive(self, node: CanvasNodeItem):
        if not node: return
        current_color = node.background_color_override if node.background_color_override else node.colors["node_bg"]
        if not isinstance(current_color, QColor) or not current_color.isValid(): current_color = node.colors["node_bg"]
        dialog = QColorDialog(self);
        dialog.setCurrentColor(current_color);
        dialog.setOption(QColorDialog.ColorDialogOption.ShowAlphaChannel, True)
        for color_name, color_val in self.colors.items():
            if isinstance(color_val, QColor) and "node" in color_name: dialog.setCustomColor(
                list(self.colors.keys()).index(color_name) % 16, color_val)
        if dialog.exec():
            color = dialog.selectedColor()
            if color.isValid(): node.set_background_color(color); self.canvas_changed_signal.emit()

    def _change_node_font_size_interactive(self, node: CanvasNodeItem, value: int, reset_to_default: bool = False):
        if not node: return
        if reset_to_default:
            node.set_font_size(DEFAULT_FONT_SIZE)
        else:
            node.set_font_size(node.current_font_size + value)
        # Signal is emitted by node.set_font_size itself

    def _get_first_selected_node(self) -> Optional[CanvasNodeItem]:
        selected = self.scene.selectedItems()
        for item in selected:
            if isinstance(item, CanvasNodeItem): return item
        return None

# --- End of canvaswidget.py ---

